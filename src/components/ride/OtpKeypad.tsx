import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { colors } from '@/theme/colors';

interface OtpKeypadProps {
  expectedLength?: number;
  onSubmit: (code: string) => void;
  loading?: boolean;
  error?: string | null;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const;

export function OtpKeypad({
  expectedLength = 4,
  onSubmit,
  loading = false,
  error = null,
}: OtpKeypadProps) {
  const [value, setValue] = useState('');

  const cells = useMemo(
    () =>
      Array.from({ length: expectedLength }, (_, i) => value[i] ?? ''),
    [expectedLength, value],
  );

  const onKey = (key: string) => {
    if (key === '⌫') {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (!key || value.length >= expectedLength) return;
    setValue((v) => v + key);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Enter passenger OTP</Text>
      <View style={styles.cells}>
        {cells.map((digit, index) => (
          <View
            key={index}
            style={[styles.cell, digit ? styles.cellFilled : null]}
          >
            <Text style={styles.digit}>{digit || '·'}</Text>
          </View>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.pad}>
        {KEYS.map((key, index) => (
          <Pressable
            key={`${key}-${index}`}
            disabled={!key}
            onPress={() => onKey(key)}
            style={({ pressed }) => [
              styles.key,
              !key && styles.keyEmpty,
              pressed && key ? styles.keyPressed : null,
            ]}
          >
            <Text style={styles.keyLabel}>{key}</Text>
          </Pressable>
        ))}
      </View>

      <PrimaryButton
        label="Start Trip"
        loading={loading}
        disabled={value.length !== expectedLength}
        onPress={() => onSubmit(value)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 16,
    paddingBottom: 24,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  cells: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  cell: {
    width: 48,
    height: 56,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFilled: {
    borderColor: colors.accent,
  },
  digit: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  error: {
    color: colors.danger,
    textAlign: 'center',
    fontSize: 13,
  },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  key: {
    width: '30%',
    maxWidth: 96,
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: {
    opacity: 0,
  },
  keyPressed: {
    backgroundColor: colors.bgElevated,
  },
  keyLabel: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '600',
  },
});
