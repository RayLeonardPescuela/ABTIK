import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/theme/colors';
import type { FareEstimate } from '@/types/database';

interface FareEstimateCardProps {
  estimate: FareEstimate;
  landmarkNotes: string;
  onLandmarkNotesChange: (value: string) => void;
}

export function FareEstimateCard({
  estimate,
  landmarkNotes,
  onLandmarkNotesChange,
}: FareEstimateCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Fare estimate</Text>

      <View style={styles.row}>
        <Text style={styles.label}>Distance</Text>
        <Text style={styles.value}>{estimate.distanceKm.toFixed(1)} km</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Base fee</Text>
        <Text style={styles.value}>₱{estimate.baseFee.toFixed(0)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Late-night provincial surcharge</Text>
        <Text style={styles.value}>
          {estimate.lateNightSurcharge > 0
            ? `₱${estimate.lateNightSurcharge.toFixed(0)}`
            : '—'}
        </Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>₱{estimate.total.toFixed(0)}</Text>
      </View>

      <Text style={styles.notesLabel}>Drop-off landmark notes</Text>
      <TextInput
        value={landmarkNotes}
        onChangeText={onLandmarkNotesChange}
        placeholder='e.g. "Near orange gate, after the unlit bend"'
        placeholderTextColor={colors.textDim}
        multiline
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  heading: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    flex: 1,
  },
  value: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  totalLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  totalValue: {
    color: colors.accent,
    fontSize: 22,
    fontWeight: '800',
  },
  notesLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  input: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    fontSize: 14,
  },
});
