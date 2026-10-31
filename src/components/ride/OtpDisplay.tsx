import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

interface OtpDisplayProps {
  code: string;
  caption?: string;
}

/** Passenger-facing 4-digit OTP shown until the driver verifies start */
export function OtpDisplay({
  code,
  caption = 'Share this code with your driver to start the trip',
}: OtpDisplayProps) {
  const digits = code.padStart(4, '0').slice(0, 4).split('');

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Trip OTP</Text>
      <View style={styles.digits}>
        {digits.map((digit, index) => (
          <View key={`${digit}-${index}`} style={styles.cell}>
            <Text style={styles.digit}>{digit}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.caption}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  digits: {
    flexDirection: 'row',
    gap: 10,
  },
  cell: {
    width: 52,
    height: 64,
    borderRadius: 12,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: {
    color: colors.accent,
    fontSize: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  caption: {
    color: colors.textDim,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
});
