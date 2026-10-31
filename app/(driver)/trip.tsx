import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CampusMap } from '@/components/maps/CampusMap';
import { OtpKeypad } from '@/components/ride/OtpKeypad';
import { Badge } from '@/components/ui/Badge';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useBackgroundLocation } from '@/hooks/useBackgroundLocation';
import { useAuth } from '@/providers/AuthProvider';
import { subscribeToRideStatus, updateRideStatus } from '@/lib/supabaseClient';
import { fetchActiveRideView, startRideWithOtp } from '@/services/rides';
import { colors } from '@/theme/colors';
import { geoJsonToLatLng } from '@/utils/geo';
import type { ActiveRideView } from '@/types/database';

/**
 * FLOW B.3 — Trip execution: OTP start, nav overlay, background GPS stream.
 */
export default function DriverTripScreen() {
  const { userId } = useAuth();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [view, setView] = useState<ActiveRideView | null>(null);
  const [loading, setLoading] = useState(true);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [navError, setNavError] = useState<string | null>(null);

  const { isTracking, lastError, startTracking, stopTracking } =
    useBackgroundLocation({ timeIntervalMs: 3000, distanceIntervalM: 10 });

  // `loading` starts true; state only changes inside promise handlers.
  const load = useCallback((): Promise<void> => {
    if (!rideId) return Promise.resolve();

    return fetchActiveRideView(rideId)
      .then((data) => {
        setView(data);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load trip');
      })
      .then(() => {
        setLoading(false);
      });
  }, [rideId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!rideId) return;
    return subscribeToRideStatus(rideId, (ride) => {
      // Never let a realtime payload introduce an OTP into driver state.
      setView((prev) =>
        prev
          ? { ...prev, ride: { ...ride, otp_code: prev.ride.otp_code } }
          : prev,
      );
    });
  }, [rideId]);

  /**
   * Opens turn-by-turn navigation, trying platform-native schemes first and
   * falling back to Google Maps on the web. Never throws — devices without a
   * maps app must not crash or surface as an OTP error.
   */
  const openTurnByTurn = async () => {
    if (!view) return;
    const drop = geoJsonToLatLng(view.ride.dropoff_location);
    const coords = `${drop.latitude},${drop.longitude}`;
    const webFallback = `https://www.google.com/maps/dir/?api=1&destination=${coords}`;

    const candidates: string[] =
      Platform.OS === 'ios'
        ? [`https://maps.apple.com/?daddr=${coords}&dirflg=d`, webFallback]
        : Platform.OS === 'android'
          ? [`google.navigation:q=${coords}&mode=d`, webFallback]
          : [webFallback];

    for (const url of candidates) {
      try {
        await Linking.openURL(url);
        setNavError(null);
        return;
      } catch {
        // Try the next candidate.
      }
    }

    setNavError(
      'No navigation app could be opened — use the drop-off address above.',
    );
  };

  const onSubmitOtp = async (code: string) => {
    if (!rideId) return;
    try {
      setOtpLoading(true);
      setOtpError(null);
      setActionError(null);

      // Server compares the OTP (attempt-limited); returns the refreshed row.
      const ride = await startRideWithOtp(rideId, code);
      setView((prev) => (prev ? { ...prev, ride } : prev));

      const tracking = await startTracking(rideId);
      if (!tracking) {
        setActionError(
          'Trip started, but background GPS did not start — check location permissions so Safety Circle can follow.',
        );
      }

      // Navigation is best-effort; failures surface as navError, not OTP errors.
      void openTurnByTurn();
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'OTP verification failed');
    } finally {
      setOtpLoading(false);
    }
  };

  const onMarkArrived = async () => {
    if (!rideId) return;
    try {
      setActionError(null);
      const ride = await updateRideStatus(rideId, 'arrived');
      setView((prev) => (prev ? { ...prev, ride } : prev));
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not update arrival',
      );
    }
  };

  const onComplete = async () => {
    if (!rideId) return;
    try {
      setActionError(null);
      await updateRideStatus(rideId, 'completed', {
        completed_at: new Date().toISOString(),
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not complete the trip',
      );
      return; // keep streaming — the trip is not finished server-side
    }

    try {
      await stopTracking();
    } catch (err) {
      console.warn('[ABTIK] stopTracking after completion failed', err);
    }
    router.replace('/(driver)/dashboard');
  };

  if (!userId) {
    return <Redirect href="/" />;
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (error || !view) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error ?? 'Trip unavailable'}</Text>
      </View>
    );
  }

  const { ride } = view;
  const pickup = geoJsonToLatLng(ride.pickup_location);
  const dropoff = geoJsonToLatLng(ride.dropoff_location);
  const needsOtp = ride.status === 'accepted' || ride.status === 'arrived';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.mapPane}>
        <CampusMap hubs={[]} pickup={pickup} dropoff={dropoff} />
        <View style={styles.navOverlay}>
          <Badge
            tone={isTracking ? 'live' : 'muted'}
            label={
              isTracking
                ? 'GPS streaming to Safety Circle'
                : 'GPS idle — start trip to stream'
            }
          />
          {ride.status === 'in_progress' ? (
            <PrimaryButton
              label="Open Navigation"
              variant="ghost"
              style={styles.navBtn}
              onPress={() => void openTurnByTurn()}
            />
          ) : null}
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.address}>{ride.dropoff_address}</Text>
        {ride.landmark_notes ? (
          <Text style={styles.notes}>{ride.landmark_notes}</Text>
        ) : null}

        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
        {navError ? <Text style={styles.error}>{navError}</Text> : null}
        {lastError ? <Text style={styles.error}>{lastError}</Text> : null}

        {ride.status === 'accepted' ? (
          <PrimaryButton
            label="I've Arrived at Pickup"
            onPress={() => void onMarkArrived()}
          />
        ) : null}

        {needsOtp ? (
          <OtpKeypad
            onSubmit={(code) => void onSubmitOtp(code)}
            loading={otpLoading}
            error={otpError}
          />
        ) : null}

        {ride.status === 'in_progress' ? (
          <PrimaryButton
            label="Complete Trip"
            onPress={() => void onComplete()}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  mapPane: { flex: 1.2, position: 'relative' },
  navOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    gap: 10,
  },
  navBtn: {
    backgroundColor: colors.overlay,
  },
  panel: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 12,
    maxHeight: '55%',
  },
  address: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  notes: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
