import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CampusMap } from '@/components/maps/CampusMap';
import { FareEstimateCard } from '@/components/ride/FareEstimateCard';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { SwitchRoleButton } from '@/components/ui/SwitchRoleButton';
import { estimateFare } from '@/constants/fare';
import { createDemoRide, DEMO_NEARBY_DRIVERS } from '@/lib/demoMode';
import { useAuth } from '@/providers/AuthProvider';
import { createRideRequest } from '@/services/rides';
import { colors } from '@/theme/colors';
import { distanceKm } from '@/utils/geo';
import type { CampusHub, LatLng } from '@/types/database';

/** Demo hubs — replace with Supabase campus_hubs query */
const DEMO_HUBS: CampusHub[] = [
  {
    id: 'hub-1',
    name: 'Main Campus Gate',
    campus_code: 'CAMPUS-A',
    location: { type: 'Point', coordinates: [123.8854, 10.3157] },
    is_active: true,
  },
  {
    id: 'hub-2',
    name: 'Library Loop',
    campus_code: 'CAMPUS-A',
    location: { type: 'Point', coordinates: [123.887, 10.3172] },
    is_active: true,
  },
];

const DEFAULT_PICKUP: LatLng = { latitude: 10.3157, longitude: 123.8854 };

/** Quick-pick destinations tuned for provincial + interior ("sudlunon") runs. */
interface SudlunonPreset {
  key: string;
  icon: string;
  label: string;
  address: string;
  location: LatLng;
  routeLabel: string;
  complexity: string;
}

const SUDLUNON_PRESETS: SudlunonPreset[] = [
  {
    key: 'kanto',
    icon: '📍',
    label: 'Kanto / Main Highway',
    address: 'Kanto junction, Main Highway',
    location: { latitude: 10.3138, longitude: 123.8812 },
    routeLabel: 'Campus → Kanto junction, Main Highway',
    complexity: 'Paved Highway — Straight Shot',
  },
  {
    key: 'interior',
    icon: '🏠',
    label: 'Interior Sudlunon Gate',
    address: 'Interior Sudlunon gate, after the unlit bend',
    location: { latitude: 10.3105, longitude: 123.8934 },
    routeLabel: 'Campus → Interior sudlunon home gate',
    complexity: 'Rough / Unlit Path — Verified Local Driver Assigned',
  },
  {
    key: 'gate2',
    icon: '🏫',
    label: 'Campus Gate 2',
    address: 'Campus Gate 2, rear entrance',
    location: { latitude: 10.3172, longitude: 123.8871 },
    routeLabel: 'Campus → Gate 2 rear entrance',
    complexity: 'Campus Interior — Short Haul',
  },
  {
    key: 'barangay',
    icon: '🏪',
    label: 'Barangay Hall / Crossing',
    address: 'Barangay hall crossing, poblacion',
    location: { latitude: 10.3089, longitude: 123.8901 },
    routeLabel: 'Campus → Barangay hall crossing',
    complexity: 'Mixed Road — Landmark Crossing',
  },
];

/**
 * FLOW A.1–A.2 — Home map + booking panel with provincial fare estimate.
 * The displayed fare is an estimate; `create_ride` computes the real amount.
 */
export default function PassengerHomeScreen() {
  const { userId, isDemo } = useAuth();
  const [pickup] = useState<LatLng>(DEFAULT_PICKUP);
  const [dropoff, setDropoff] = useState<LatLng | null>(null);
  const [landmarkNotes, setLandmarkNotes] = useState('');
  const [routeInfo, setRouteInfo] = useState<{
    label: string;
    complexity: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canShowUserLocation, setCanShowUserLocation] = useState(false);

  useEffect(() => {
    void Location.getForegroundPermissionsAsync().then(({ status }) => {
      if (status === 'granted') {
        setCanShowUserLocation(true);
        return;
      }
      // Non-blocking: booking works with the pinned campus pickup either way.
      void Location.requestForegroundPermissionsAsync().then((result) => {
        setCanShowUserLocation(result.status === 'granted');
      });
    });
  }, []);

  const estimate = useMemo(() => {
    if (!dropoff) {
      return estimateFare(0);
    }
    return estimateFare(distanceKm(pickup, dropoff));
  }, [dropoff, pickup]);

  const onPickPreset = (preset: SudlunonPreset) => {
    setDropoff(preset.location);
    setRouteInfo({ label: preset.routeLabel, complexity: preset.complexity });
    setLandmarkNotes(preset.address);
  };

  const onMapPin = (coord: LatLng) => {
    setDropoff(coord);
    setRouteInfo({
      label: 'Custom map pin → interior drop-off',
      complexity: 'Unmarked Interior Road — Verified Local Driver Assigned',
    });
  };

  const isRoughRoute =
    routeInfo !== null && /rough|unlit|unmarked/i.test(routeInfo.complexity);

  const onRequestRide = async () => {
    if (!userId) return;
    if (!dropoff) {
      setError('Pick a preset above or tap the map to pin your drop-off.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // Demo mode: build the ride in the shared store — zero network — and
      // jump straight to the live screen.
      if (isDemo) {
        const ride = createDemoRide({
          pickup,
          dropoff,
          dropoffAddress: landmarkNotes || 'Pinned interior drop-off',
          landmarkNotes,
        });
        router.push({
          pathname: '/(passenger)/active-ride',
          params: { rideId: ride.id },
        });
        return;
      }

      const ride = await createRideRequest({
        passengerId: userId, // must equal auth.uid() server-side
        pickup,
        pickupAddress: 'Main Campus Gate',
        dropoff,
        dropoffAddress: landmarkNotes || 'Pinned interior drop-off',
        landmarkNotes,
      });

      router.push({
        pathname: '/(passenger)/active-ride',
        params: { rideId: ride.id },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to request ride');
    } finally {
      setSubmitting(false);
    }
  };

  if (!userId) {
    return <Redirect href="/" />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.mapPane}>
          <CampusMap
            hubs={DEMO_HUBS}
            pickup={pickup}
            dropoff={dropoff}
            nearbyDrivers={isDemo ? DEMO_NEARBY_DRIVERS : []}
            onMapPress={onMapPin}
            showsUserLocation={canShowUserLocation}
          />
          <View style={styles.mapHint}>
            <Text style={styles.mapHintText}>
              Tap map or pick a chip to pin your drop-off
            </Text>
          </View>
          <SwitchRoleButton style={styles.switchRole} />
        </View>

        <ScrollView
          style={styles.panel}
          contentContainerStyle={styles.panelContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.presetsBlock}>
            <Text style={styles.presetsHeading}>
              Popular Provincial & Interior Drop-offs
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
              keyboardShouldPersistTaps="handled"
            >
              {SUDLUNON_PRESETS.map((preset) => {
                const active =
                  !!dropoff &&
                  dropoff.latitude === preset.location.latitude &&
                  dropoff.longitude === preset.location.longitude;
                return (
                  <Pressable
                    key={preset.key}
                    onPress={() => onPickPreset(preset)}
                    style={({ pressed }) => [
                      styles.chip,
                      active && styles.chipActive,
                      pressed && styles.chipPressed,
                    ]}
                  >
                    <Text
                      style={[styles.chipText, active && styles.chipTextActive]}
                    >
                      {preset.icon} {preset.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {routeInfo ? (
            <View
              style={[
                styles.routeCard,
                isRoughRoute ? styles.routeCardRough : styles.routeCardSmooth,
              ]}
            >
              <Text style={styles.routeLabel}>{routeInfo.label}</Text>
              <Text
                style={[
                  styles.routeComplexity,
                  isRoughRoute
                    ? styles.routeComplexityRough
                    : styles.routeComplexitySmooth,
                ]}
              >
                {isRoughRoute ? '⚠ ' : '✓ '}
                {routeInfo.complexity}
              </Text>
            </View>
          ) : null}

          <FareEstimateCard
            estimate={estimate}
            landmarkNotes={landmarkNotes}
            onLandmarkNotesChange={setLandmarkNotes}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton
            label="Request Motorcycle"
            loading={submitting}
            disabled={!dropoff}
            onPress={() => void onRequestRide()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  mapPane: { flex: 1.15, position: 'relative' },
  switchRole: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  mapHint: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    backgroundColor: colors.overlay,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  mapHintText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  panel: {
    flex: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: colors.bg,
    marginTop: -16,
  },
  panelContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 28,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  presetsBlock: {
    gap: 8,
  },
  presetsHeading: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  chipsRow: {
    gap: 8,
    paddingRight: 8,
  },
  chip: {
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  chipText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.text,
    fontWeight: '700',
  },
  routeCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  routeCardRough: {
    borderLeftColor: colors.warning,
  },
  routeCardSmooth: {
    borderLeftColor: colors.success,
  },
  routeLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  routeComplexity: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  routeComplexityRough: {
    color: colors.warning,
  },
  routeComplexitySmooth: {
    color: colors.success,
  },
});
