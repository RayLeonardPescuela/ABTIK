import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IncomingRideModal } from '@/components/ride/IncomingRideModal';
import { Badge } from '@/components/ui/Badge';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SwitchRoleButton } from '@/components/ui/SwitchRoleButton';
import {
  DEMO_COMMUTER_TYPE,
  DEMO_DRIVER_ROW,
  DEMO_PASSENGER,
  acceptDemoRide,
  declineDemoRide,
  getFirstRequestedDemoRide,
  subscribeDemoRides,
} from '@/lib/demoMode';
import { subscribeToIncomingRides } from '@/lib/supabaseClient';
import { useAuth } from '@/providers/AuthProvider';
import {
  createMyDriverRow,
  fetchMyDriverRow,
  type DriverSetupInput,
} from '@/services/drivers';
import { acceptRide, fetchPendingRideRequest, setDriverOnline } from '@/services/rides';
import { colors } from '@/theme/colors';
import type { Driver, Ride } from '@/types/database';

const EMPTY_SETUP: DriverSetupInput = {
  vehiclePlate: '',
  vehicleModel: '',
  licenseNumber: '',
};

/**
 * FLOW B.1–B.2 — Online toggle + incoming ride alert modal.
 *
 * Gates: a `drivers` row must exist (created below) and ABTIK operations must
 * set `vetted_status` before the feed (and accept_ride) will hand over trips.
 */
export default function DriverDashboardScreen() {
  const { userId, profile, loading: authLoading, isDemo } = useAuth();

  const [driverRow, setDriverRow] = useState<Driver | null>(null);
  /** Whose profile was last loaded — derives the loading flag without setState in effects. */
  const [driverLoadedFor, setDriverLoadedFor] = useState<string | null>(null);
  const [setup, setSetup] = useState<DriverSetupInput>(EMPTY_SETUP);
  const [setupBusy, setSetupBusy] = useState(false);

  const [isOnline, setIsOnline] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [incoming, setIncoming] = useState<Ride | null>(null);
  const [error, setError] = useState<string | null>(null);

  const driverLoading = userId !== null && driverLoadedFor !== userId;

  const loadDriverRow = useCallback((): Promise<void> => {
    if (!userId) return Promise.resolve();

    if (isDemo) {
      // Vetted demo driver — skips onboarding straight to availability.
      return Promise.resolve().then(() => {
        setDriverRow(DEMO_DRIVER_ROW);
        setError(null);
        setDriverLoadedFor(userId);
      });
    }

    return fetchMyDriverRow()
      .then((row) => {
        setDriverRow(row);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load driver profile');
      })
      .then(() => {
        setDriverLoadedFor(userId);
      });
  }, [userId, isDemo]);

  useEffect(() => {
    void loadDriverRow();
  }, [loadDriverRow]);

  const vetted = driverRow?.vetted_status ?? false;
  const readyForTrips = Boolean(driverRow) && vetted;

  // Nearby request feed: RLS only delivers to online, vetted drivers anyway.
  useEffect(() => {
    if (!isOnline || !readyForTrips) return;

    if (isDemo) {
      // Shared store: the passenger's booking pops the modal live, and the
      // catch-up read surfaces the request pending since app start.
      const sync = () => {
        const ride = getFirstRequestedDemoRide();
        setIncoming(
          (current) => current ?? (ride ? { ...ride, otp_code: '' } : null),
        );
      };
      sync();
      return subscribeDemoRides(sync);
    }

    // Catch up on requests that were already pending when the driver came
    // online (app restart, relogin, single-device demo) — the realtime
    // subscription only fires for requests inserted from now on.
    void fetchPendingRideRequest()
      .then((ride) => {
        if (ride) setIncoming((current) => current ?? ride);
      })
      .catch(() => {
        // Feed nicety — new requests still arrive over realtime below.
      });

    return subscribeToIncomingRides((ride) => {
      setIncoming((current) => current ?? ride);
    });
  }, [isOnline, readyForTrips, isDemo]);

  const onToggleOnline = useCallback(
    async (next: boolean) => {
      if (next && !readyForTrips) {
        setError('Vetting required before you can go online.');
        return;
      }

      if (isDemo) {
        // Instant: no GPS permission prompt, no RPC — the feed reads the
        // shared store directly.
        setIsOnline(next);
        if (!next) setIncoming(null);
        return;
      }

      try {
        setToggling(true);
        setError(null);

        let location: Location.LocationObject | null = null;
        if (next) {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (permission.status !== 'granted') {
            setError('Location permission required to go online');
            return;
          }
          location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
        }

        await setDriverOnline(
          next,
          location
            ? {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              }
            : undefined,
        );

        setIsOnline(next);
        if (!next) setIncoming(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update status');
      } finally {
        setToggling(false);
      }
    },
    [readyForTrips, isDemo],
  );

  const onAccept = useCallback(
    async (rideId: string) => {
      try {
        if (isDemo) {
          acceptDemoRide(rideId);
        } else {
          await acceptRide(rideId);
        }
        setIncoming(null);
        router.push({ pathname: '/(driver)/trip', params: { rideId } });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Accept failed');
        setIncoming(null);
      }
    },
    [isDemo],
  );

  const onDecline = useCallback(
    (rideId: string) => {
      if (isDemo) declineDemoRide(rideId);
      setIncoming((current) => (current?.id === rideId ? null : current));
    },
    [isDemo],
  );

  const onCreateDriverRow = async () => {
    try {
      setSetupBusy(true);
      setError(null);
      const created = await createMyDriverRow(setup);
      setDriverRow(created);
      setSetup(EMPTY_SETUP);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save driver profile');
    } finally {
      setSetupBusy(false);
    }
  };

  if (!userId) {
    return <Redirect href="/" />;
  }

  if (authLoading || driverLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // ---- Step 1: driver onboarding -----------------------------------------
  if (!driverRow) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.card}>
          <Text style={styles.title}>Driver setup</Text>
          <Text style={styles.subtitle}>
            Register your motorcycle so passengers see your plate before the
            trip. Your license is verified by ABTIK operations.
          </Text>

          <TextInput
            value={setup.vehiclePlate}
            onChangeText={(vehiclePlate) => setSetup((s) => ({ ...s, vehiclePlate }))}
            placeholder="Plate, e.g. ABC 1234"
            placeholderTextColor={colors.textDim}
            autoCapitalize="characters"
            style={styles.input}
          />
          <TextInput
            value={setup.vehicleModel}
            onChangeText={(vehicleModel) => setSetup((s) => ({ ...s, vehicleModel }))}
            placeholder="Motorcycle, e.g. Honda TMX 125"
            placeholderTextColor={colors.textDim}
            style={styles.input}
          />
          <TextInput
            value={setup.licenseNumber}
            onChangeText={(licenseNumber) => setSetup((s) => ({ ...s, licenseNumber }))}
            placeholder="Driver's license number"
            placeholderTextColor={colors.textDim}
            autoCapitalize="characters"
            style={styles.input}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <PrimaryButton
            label="Save driver profile"
            loading={setupBusy}
            onPress={() => void onCreateDriverRow()}
          />
          <PrimaryButton
            label="Back to sign-in"
            variant="ghost"
            onPress={() => router.replace('/')}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ---- Step 2: availability ------------------------------------------------
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>ABTIK · Driver</Text>
        <SwitchRoleButton />
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <View>
            <Text style={styles.title}>Availability</Text>
            <Text style={styles.subtitle}>
              Go online to receive campus → sudlunon requests
            </Text>
          </View>
          <Switch
            value={isOnline}
            disabled={toggling || !readyForTrips}
            onValueChange={(next) => void onToggleOnline(next)}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.white}
          />
        </View>
        <Badge
          tone={readyForTrips ? (isOnline ? 'live' : 'muted') : 'accent'}
          label={
            !readyForTrips
              ? 'Pending vetting — cannot accept trips yet'
              : isOnline
                ? 'Online — listening for rides'
                : 'Offline'
          }
          style={styles.badge}
        />
        {!readyForTrips ? (
          <Text style={styles.vettingNote}>
            {profile?.role === 'driver' ? 'Your ' : 'This '}
            license is queued for ABTIK verification. You can browse the app
            now, but trips are released only to vetted drivers.
          </Text>
        ) : null}
      </View>

      <View style={styles.tips}>
        <Text style={styles.tipsTitle}>Trip checklist</Text>
        <Text style={styles.tip}>1. Accept only if drop-off complexity fits your route knowledge.</Text>
        <Text style={styles.tip}>2. Meet at campus hub and verify passenger OTP.</Text>
        <Text style={styles.tip}>3. Keep ABTIK open — background GPS feeds Safety Circles.</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <IncomingRideModal
        ride={incoming}
        visible={Boolean(incoming)}
        passenger={
          isDemo
            ? {
                name: DEMO_PASSENGER.full_name,
                commuterType: DEMO_COMMUTER_TYPE,
              }
            : null
        }
        onAccept={(rideId) => void onAccept(rideId)}
        onDecline={onDecline}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 16,
    gap: 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarTitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 280,
  },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  badge: {
    alignSelf: 'flex-start',
  },
  vettingNote: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  tips: {
    gap: 8,
    paddingHorizontal: 4,
  },
  tipsTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  tip: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
});
