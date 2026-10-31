import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { colors } from '@/theme/colors';
import type { SafetyCircle } from '@/types/database';

interface SafetyCircleBannerProps {
  circles: SafetyCircle[];
  isLive: boolean;
}

export function SafetyCircleBanner({ circles, isLive }: SafetyCircleBannerProps) {
  const active = circles.filter((c) => c.auto_notify);
  const count = active.length;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Badge
          tone={isLive && count > 0 ? 'live' : 'muted'}
          label={
            isLive && count > 0
              ? 'Live tracking active'
              : count > 0
                ? 'Safety Circle ready'
                : 'No guardians linked'
          }
        />
        {count > 0 ? (
          <Text style={styles.count}>
            {count} Guardian{count === 1 ? '' : 's'}
          </Text>
        ) : null}
      </View>

      {count > 0 ? (
        <Text style={styles.subtitle}>
          Sharing live trip status with{' '}
          {active.map((c) => c.guardian_name).join(', ')}.
        </Text>
      ) : (
        <Text style={styles.subtitle}>
          Add a guardian before night trips on interior roads.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bgPanel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  count: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
});
