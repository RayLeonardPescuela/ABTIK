import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors } from '@/theme/colors';

type BadgeTone = 'live' | 'accent' | 'danger' | 'muted' | 'info';

const TONE_STYLES: Record<BadgeTone, { bg: string; fg: string }> = {
  live: { bg: 'rgba(0, 229, 168, 0.16)', fg: colors.live },
  accent: { bg: colors.accentSoft, fg: colors.accent },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  muted: { bg: colors.bgElevated, fg: colors.textMuted },
  info: { bg: 'rgba(96, 165, 250, 0.16)', fg: colors.info },
};

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: ViewStyle;
}

export function Badge({ label, tone = 'muted', style }: BadgeProps) {
  const palette = TONE_STYLES[tone];

  return (
    <View style={[styles.base, { backgroundColor: palette.bg }, style]}>
      {tone === 'live' ? <View style={styles.dot} /> : null}
      <Text style={[styles.text, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.live,
  },
});
