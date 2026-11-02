import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  PassengerIdCard,
  type PassengerIdentity,
} from '@/components/ride/PassengerIdCard';
import { Badge } from '@/components/ui/Badge';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { colors } from '@/theme/colors';
import { dropoffComplexityLabel, geoJsonToLatLng } from '@/utils/geo';
import type { Ride } from '@/types/database';

interface IncomingRideModalProps {
  ride: Ride | null;
  visible: boolean;
  acceptSeconds?: number;
  /** Passenger identity (demo fixtures, or a resolved ride-peer profile). */
  passenger?: PassengerIdentity | null;
  onAccept: (rideId: string) => void;
  onDecline: (rideId: string) => void;
}

/**
 * Accept-countdown badge.
 *
 * Owns its own timer state so the parent never has to reset state inside an
 * effect, and remounts (fresh counter) whenever `key` changes. The expiry
 * callback lives in a ref so re-renders never restart the countdown.
 */
function Countdown({
  seconds,
  onExpire,
}: {
  seconds: number;
  onExpire: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(seconds);

  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    let remaining = seconds;

    const timer = setInterval(() => {
      remaining -= 1;
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        onExpireRef.current();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [seconds]);

  return <Badge tone="accent" label={`${Math.max(secondsLeft, 0)}s`} />;
}

export function IncomingRideModal({
  ride,
  visible,
  acceptSeconds = 20,
  passenger = null,
  onAccept,
  onDecline,
}: IncomingRideModalProps) {
  if (!ride) return null;

  const complexity = dropoffComplexityLabel(ride.landmark_notes);
  const pickup = geoJsonToLatLng(ride.pickup_location);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.header}>
              <Text style={styles.title}>Incoming ride</Text>
              {/* key=ride id ⇒ a new request always starts a full countdown */}
              <Countdown
                key={ride.id}
                seconds={acceptSeconds}
                onExpire={() => onDecline(ride.id)}
              />
            </View>

            <PassengerIdCard
              identity={passenger}
              pickupAddress={ride.pickup_address}
              dropoffAddress={ride.dropoff_address}
            />

            <Text style={styles.coords}>
              📍 Pickup point {pickup.latitude.toFixed(5)},{' '}
              {pickup.longitude.toFixed(5)}
            </Text>
            {ride.landmark_notes ? (
              <Text style={styles.notes}>🏷 {ride.landmark_notes}</Text>
            ) : null}

            <Badge
              tone={complexity.level === 'complex' ? 'danger' : 'info'}
              label={complexity.label}
            />

            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Fare</Text>
              <Text style={styles.fare}>
                ₱{Number(ride.fare_amount).toFixed(0)}
              </Text>
            </View>

            <View style={styles.actions}>
              <PrimaryButton
                label="Decline"
                variant="ghost"
                style={styles.actionBtn}
                onPress={() => onDecline(ride.id)}
              />
              <PrimaryButton
                label="Accept"
                style={styles.actionBtn}
                onPress={() => onAccept(ride.id)}
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '86%',
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetContent: {
    gap: 8,
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  coords: {
    color: colors.textDim,
    fontSize: 12,
  },
  notes: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fareLabel: {
    color: colors.textMuted,
    fontSize: 14,
  },
  fare: {
    color: colors.accent,
    fontSize: 28,
    fontWeight: '800',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
  },
});
