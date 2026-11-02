import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CampusMap } from '@/components/maps/CampusMap';
import { OtpDisplay } from '@/components/ride/OtpDisplay';
import { SafetyCircleBanner } from '@/components/ride/SafetyCircleBanner';
import { SosButton } from '@/components/ride/SosButton';
import { Badge } from '@/components/ui/Badge';
import { SwitchRoleButton } from '@/components/ui/SwitchRoleButton';
import { useRideLocation } from '@/hooks/useRideLocation';
import {
  DEMO_DRIVER_POSITION,
  getDemoRideView,
  subscribeDemoRides,
  triggerDemoSos,
} from '@/lib/demoMode';
import { useAuth } from '@/providers/AuthProvider';
import { subscribeToRideStatus } from '@/lib/supabaseClient';
import { fetchActiveRideView, triggerSos } from '@/services/rides';
import { colors } from '@/theme/colors';
import { geoJsonToLatLng } from '@/utils/geo';
import type { ActiveRideView, RideStatus } from '@/types/database';

const STATUS_LABEL: Record<RideStatus, string> = {
  requested: 'Finding driver…',
  accepted: 'Driver assigned',
  arrived: 'Driver arrived',
  in_progress: 'Trip in progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Local-credential trust badges shown once a driver is matched. */
const LOCAL_CREDENTIALS = [
  'Verified Local Resident',
  'Vetted Habal-Habal Driver',
  'Sudlunon Navigation Expert',
] as const;

/**
 * FLOW A.3 — Passenger Active Ride Screen
 * Map + OTP + Safety Circle live status + SOS.
 */
export default function PassengerActiveRideScreen() {
  const { userId, isDemo } = useAuth();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [view, setView] = useState<ActiveRideView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const watchRideId =
    view?.ride.status === 'in_progress' || view?.ride.status === 'accepted'
      ? rideId
      : null;
  const { location: driverLiveLocation, isLive, isFresh } = useRideLocation(
    // Demo mode has no GPS stream — the map shows the static driver marker.
    isDemo ? null : watchRideId,
  );

  // `loading` starts true; state only changes inside promise handlers (never
  // synchronously from the mount effect).
  const load = useCallback(
    (options?: { silent?: boolean }): Promise<void> => {
      if (!rideId) return Promise.resolve();
      const silent = options?.silent ?? false;

      if (isDemo) {
        // Shared store read — completes on a microtask so `loading` still
        // flips inside a promise handler (never in the mount effect body).
        return Promise.resolve().then(() => {
          try {
            setView(getDemoRideView(rideId));
            setError(null);
          } catch (err) {
            if (silent) {
              console.warn('[ABTIK] background ride refresh failed', err);
            } else {
              setError(err instanceof Error ? err.message : 'Failed to load ride');
            }
          }
          if (!silent) setLoading(false);
        });
      }

      return fetchActiveRideView(rideId)
        .then((data) => {
          setView(data);
          setError(null);
        })
        .catch((err: unknown) => {
          if (silent) {
            console.warn('[ABTIK] background ride refresh failed', err);
          } else {
            setError(err instanceof Error ? err.message : 'Failed to load ride');
          }
        })
        .then(() => {
          if (!silent) setLoading(false);
        });
    },
    [rideId, isDemo],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime status updates: keep the current OTP until the silent refetch
  // below delivers the (rotated) post-acceptance code.
  useEffect(() => {
    if (!rideId) return;
    if (isDemo) {
      // Shared store: the driver's accept/start/complete lands here live.
      return subscribeDemoRides(() => {
        void load({ silent: true });
      });
    }
    return subscribeToRideStatus(rideId, (next) => {
      setView((prev) =>
        prev
          ? { ...prev, ride: { ...next, otp_code: prev.ride.otp_code } }
          : prev,
      );
    });
  }, [rideId, isDemo, load]);

  // Re-fetch joins (driver, vehicle, profile, rotated OTP) as soon as a driver
  // is assigned or arrives — the realtime payload only carries the ride row.
  const previousStatusRef = useRef<RideStatus | null>(null);
  useEffect(() => {
    const next = view?.ride.status ?? null;
    const previous = previousStatusRef.current;
    previousStatusRef.current = next;
    if (!previous || previous === next) return;
    if (next === 'accepted' || next === 'arrived') {
      void load({ silent: true });
    }
  }, [view?.ride.status, load]);

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
        <Text style={styles.error}>{error ?? 'Ride unavailable'}</Text>
      </View>
    );
  }

  const { ride, driver, driverProfile, safetyCircles } = view;
  const pickup = geoJsonToLatLng(ride.pickup_location);
  const dropoff = geoJsonToLatLng(ride.dropoff_location);
  const showOtp =
    ride.status === 'accepted' ||
    ride.status === 'arrived' ||
    ride.status === 'requested';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.mapPane}>
        <CampusMap
          hubs={[]}
          pickup={pickup}
          dropoff={dropoff}
          driverLocation={isDemo ? DEMO_DRIVER_POSITION : driverLiveLocation}
          showsUserLocation
        />
        <SwitchRoleButton style={styles.switchRole} />
      </View>

      <ScrollView
        style={styles.sheet}
        contentContainerStyle={styles.sheetContent}
      >
        <View style={styles.statusRow}>
          <Badge
            tone={ride.status === 'in_progress' ? 'live' : 'accent'}
            label={STATUS_LABEL[ride.status]}
          />
          <Text style={styles.fare}>₱{Number(ride.fare_amount).toFixed(0)}</Text>
        </View>

        {driver && driverProfile ? (
          <View style={styles.driverCard}>
            <Text style={styles.driverName}>{driverProfile.full_name}</Text>
            <Text style={styles.driverMeta}>
              {driver.vehicle_model} · {driver.vehicle_plate}
            </Text>
            <Text style={styles.driverMeta}>
              ★ {Number(driver.rating).toFixed(1)}
              {driver.vetted_status ? ' · Vetted' : ''}
            </Text>
            <View style={styles.trustRow}>
              {LOCAL_CREDENTIALS.map((label) => (
                <View key={label} style={styles.trustBadge}>
                  <Text style={styles.trustBadgeText}>✓ {label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <Text style={styles.waiting}>Matching a vetted motorcycle driver…</Text>
        )}

        {showOtp && ride.otp_code ? <OtpDisplay code={ride.otp_code} /> : null}

        <SafetyCircleBanner
          circles={safetyCircles}
          isLive={isLive && isFresh && ride.status === 'in_progress'}
        />

        {ride.landmark_notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>Landmark notes</Text>
            <Text style={styles.notes}>{ride.landmark_notes}</Text>
          </View>
        ) : null}

        <View style={styles.sosRow}>
          <SosButton rideId={ride.id} onTrigger={isDemo ? triggerDemoSos : triggerSos} />
          <Text style={styles.sosHint}>
            SOS alerts guardians & campus security for this trip.
          </Text>
        </View>
      </ScrollView>
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
    padding: 24,
  },
  error: { color: colors.danger, textAlign: 'center' },
  mapPane: { flex: 1 },
  switchRole: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  sheet: {
    maxHeight: '52%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -12,
  },
  sheetContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 32,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fare: {
    color: colors.accent,
    fontSize: 22,
    fontWeight: '800',
  },
  driverCard: {
    backgroundColor: colors.bgPanel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 4,
  },
  driverName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  driverMeta: {
    color: colors.textMuted,
    fontSize: 13,
  },
  trustRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  trustBadge: {
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  trustBadgeText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '700',
  },
  waiting: {
    color: colors.textMuted,
    fontSize: 14,
  },
  notesBox: {
    gap: 4,
  },
  notesLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  notes: {
    color: colors.text,
    fontSize: 14,
  },
  sosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 4,
  },
  sosHint: {
    flex: 1,
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
});
