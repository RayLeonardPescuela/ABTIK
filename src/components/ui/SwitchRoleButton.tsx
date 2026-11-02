import React from 'react';
import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { router } from 'expo-router';

import { colors } from '@/theme/colors';

interface SwitchRoleButtonProps {
  /** Optional positioning — screens over maps pass an absolute style. */
  style?: ViewStyle;
}

/**
 * Subtle "⇄ Switch Role" pill on every demo dashboard — returns to the
 * landing screen so the presenter can swap Passenger ⇄ Driver in two taps.
 * Demo state (rides in flight) survives the switch: the shared in-memory
 * store keeps the passenger⇄ driver story coherent on a single device.
 */
export function SwitchRoleButton({ style }: SwitchRoleButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Switch role"
      hitSlop={6}
      onPress={() => router.replace('/')}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed, style]}
    >
      <Text style={styles.text}>⇄ Switch Role</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  text: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
