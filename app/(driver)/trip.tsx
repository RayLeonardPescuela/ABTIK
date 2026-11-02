import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CampusMap } from '@/components/maps/CampusMap';
import { OtpKeypad } from '@/components/ride/OtpKeypad';
import {
  PassengerIdCard,
  type PassengerIdentity,
} from '@/components/ride/PassengerIdCard';
import { Badge } from '@/components/ui/Badge';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SwitchRoleButton } from '@/components/ui/SwitchRoleButton';
import { useBackgroundLocation } from '@/hooks/useBackgroundLocation';
import {
  DEMO_COMMUTER_TYPE,
  DEMO_PASSENGER,
  getDemoRideView,
  startDemoRideWithOtp,
  subscribeDemoRides,
  updateDemoRideStatus,
} from '@/lib/demoMode';
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
  const { userId, isDemo } = useAuth();
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

    if (isDemo) {
      // Shared store read — completes on a microtask so `loading` still
      // flips inside a promise handler (never in the mount effect body).
      return Promise.resolve().then(() => {
        try {
          setView(getDemoRideView(rideId));
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load trip');
        }
        setLoading(false);
      });
    }

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
  }, [rideId, isDemo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!rideId) return;
    if (isDemo) {
      // Shared store: passenger booking / status changes land here live.
      return subscribeDemoRides(() => {
        void load();
      });
    }
    return subscribeToRideStatus(rideId, (ride) => {
      // Never let a realtime payload introduce an OTP into driver state.
      setView((prev) =>
        prev
          ? { ...prev, ride: { ...ride, otp_code: prev.ride.otp_code } }
          : prev,
      );
    });
  }, [rideId, isDemo, load]);

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

      if (isDemo) {
        // Same attempt/lockout semantics as `start_ride`, against the store.
        const ride = startDemoRideWithOtp(rideId, code);
        setView((prev) => (prev ? { ...prev, ride } : prev));
      } else {
        // Server compares the OTP (attempt-limited); returns the refreshed row.
        const ride = await startRideWithOtp(rideId, code);
        setView((prev) => (prev ? { ...prev, ride } : prev));

        const tracking = await startTracking(rideId);
        if (!tracking) {
          setActionError(
            'Trip started, but background GPS did not start — check location permissions so Safety Circle can follow.',
          );
        }
      }

      // Navigation is best-effort; failures surface as navError, not OTP
      // errors. Skipped in demo mode so the stage never leaves the app.
      if (!isDemo) {
        void openTurnByTurn();
      }
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
      const ride = isDemo
        ? updateDemoRideStatus(rideId, 'arrived')
        : await updateRideStatus(rideId, 'arrived');
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
      if (isDemo) {
        updateDemoRideStatus(rideId, 'completed', {
          completed_at: new Date().toISOString(),
        });
      } else {
        await updateRideStatus(rideId, 'completed', {
          completed_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not complete the trip',
      );
      return; // keep streaming — the trip is not finished server-side
    }

    if (!isDemo) {
      try {
        await stopTracking();
      } catch (err) {
        console.warn('[ABTIK] stopTracking after completion failed', err);
      }
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
  // Demo mode shows the streaming indicator as live — Expo Go cannot
  // background-stream GPS, and no permission prompts should fire on stage.
  const streaming = isDemo || isTracking;
  const passengerIdentity: PassengerIdentity | null = isDemo
    ? { name: DEMO_PASSENGER.full_name, commuterType: DEMO_COMMUTER_TYPE }
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.mapPane}>
        <CampusMap hubs={[]} pickup={pickup} dropoff={dropoff} />
        <View style={styles.navOverlay}>
          <View style={styles.navRow}>
            <Badge
              tone={streaming ? 'live' : 'muted'}
              label={
                streaming
                  ? 'GPS streaming to Safety Circle'
                  : 'GPS idle — start trip to stream'
              }
            />
            <SwitchRoleButton />
          </View>
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
        <ScrollView
          style={styles.panelScroll}
          contentContainerStyle={styles.panelContent}
          keyboardShouldPersistTaps="handled"
        >
          <PassengerIdCard
            identity={passengerIdentity}
            pickupAddress={ride.pickup_address}
            dropoffAddress={ride.dropoff_address}
          />

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
        </ScrollView>
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
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  navBtn: {
    backgroundColor: colors.overlay,
  },
  panel: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '55%',
  },
  panelScroll: {
    flexShrink: 1,
  },
  panelContent: {
    gap: 12,
    paddingBottom: 32,
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
