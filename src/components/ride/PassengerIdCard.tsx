import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { colors } from '@/theme/colors';

/** Passenger identity surfaced to the driver (demo fixtures or peer profile). */
export interface PassengerIdentity {
  name: string;
  commuterType?: string | null;
}

interface PassengerIdCardProps {
  identity: PassengerIdentity | null;
  pickupAddress: string;
  dropoffAddress: string;
}

/**
 * Passenger identification card — name + commuter-type badge + pickup and
 * drop-off locations. Shown on the driver's incoming-request modal and on
 * the active trip panel so the driver always knows who and where.
 */
export function PassengerIdCard({
  identity,
  pickupAddress,
  dropoffAddress,
}: PassengerIdCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>Passenger</Text>
        {identity?.commuterType ? (
          <Badge tone="accent" label={`🌙 ${identity.commuterType}`} />
        ) : null}
      </View>
      <Text style={styles.name}>{identity?.name ?? 'Passenger'}</Text>

      <View style={styles.row}>
        <Text style={styles.rowIcon}>📍</Text>
        <View style={styles.rowTexts}>
          <Text style={styles.rowLabel}>Pickup Location</Text>
          <Text style={styles.rowValue}>{pickupAddress}</Text>
        </View>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowIcon}>🏠</Text>
        <View style={styles.rowTexts}>
          <Text style={styles.rowLabel}>Drop-off Location</Text>
          <Text style={styles.rowValue}>{dropoffAddress}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  name: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  rowIcon: {
    fontSize: 14,
    lineHeight: 20,
  },
  rowTexts: {
    flex: 1,
    gap: 1,
  },
  rowLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  rowValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
