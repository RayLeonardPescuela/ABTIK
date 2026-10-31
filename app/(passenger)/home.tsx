import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
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
import { estimateFare } from '@/constants/fare';
import { useAuth } from '@/providers/AuthProvider';
import { createRideRequest } from '@/services/rides';
import { colors } from '@/theme/colors';
import { distanceKm } from '@/utils/geo';
import type { CampusHub, LatLng } from '@/types/database';

/** Demo hubs — replace with Supabase campus_hubs query */
const DEMO_HUBS: CampusHub[] = [
  {
    id: 'hub-1',
    name: 'Main Gate Hub',
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

/**
 * FLOW A.1–A.2 — Home map + booking panel with provincial fare estimate.
 * The displayed fare is an estimate; `create_ride` computes the real amount.
 */
export default function PassengerHomeScreen() {
  const { userId } = useAuth();
  const [pickup] = useState<LatLng>(DEFAULT_PICKUP);
  const [dropoff, setDropoff] = useState<LatLng | null>(null);
  const [landmarkNotes, setLandmarkNotes] = useState('');
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

  const onRequestRide = async () => {
    if (!userId) return;
    if (!dropoff) {
      setError('Tap the map to set your interior-road drop-off pin.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const ride = await createRideRequest({
        passengerId: userId, // must equal auth.uid() server-side
        pickup,
        pickupAddress: 'Main Gate Hub',
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
            onMapPress={setDropoff}
            showsUserLocation={canShowUserLocation}
          />
          <View style={styles.mapHint}>
            <Text style={styles.mapHintText}>
              Tap map to pin sudlunon drop-off
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.panel}
          contentContainerStyle={styles.panelContent}
          keyboardShouldPersistTaps="handled"
        >
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
});
