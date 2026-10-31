import React, { useState } from 'react';
import { Alert, StyleSheet, Text, Pressable } from 'react-native';

import type { SosOutcome } from '@/services/rides';
import { colors } from '@/theme/colors';

interface SosButtonProps {
  rideId: string;
  onTrigger: (rideId: string) => Promise<SosOutcome>;
}

/**
 * Instant SOS. Confirms before dispatch to avoid accidental taps on bumpy
 * roads, then reports the *actual* outcome:
 *   sent     → backend acknowledged
 *   fallback → backend down; SMS/phone handoff opened for the user to send
 *   failed   → nothing was delivered — say so loudly
 */
export function SosButton({ rideId, onTrigger }: SosButtonProps) {
  const [sending, setSending] = useState(false);

  const handlePress = () => {
    Alert.alert(
      'Trigger SOS?',
      'This alerts your Safety Circle guardians and flags the trip as an emergency.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send SOS',
          style: 'destructive',
          onPress: () => {
            void sendSos();
          },
        },
      ],
    );
  };

  const sendSos = async () => {
    setSending(true);
    try {
      const outcome: SosOutcome = await onTrigger(rideId);

      if (outcome.status === 'sent') {
        Alert.alert('SOS sent', outcome.detail);
        return;
      }

      if (outcome.status === 'fallback') {
        Alert.alert('SOS fallback engaged', outcome.detail, [
          { text: 'OK' },
        ]);
        return;
      }

      // status === 'failed' — never dress this up as a success.
      Alert.alert('SOS FAILED', outcome.detail, [
        { text: 'Understood', style: 'destructive' },
      ]);
    } catch (err) {
      Alert.alert(
        'SOS FAILED',
        `The SOS could not be sent (${
          err instanceof Error ? err.message : 'unexpected error'
        }). Call campus security or 911 manually now.`,
        [{ text: 'Understood', style: 'destructive' }],
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="SOS Emergency"
      disabled={sending}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        sending && styles.disabled,
      ]}
    >
      <Text style={styles.label}>{sending ? 'SENDING…' : 'SOS'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.danger,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  pressed: {
    transform: [{ scale: 0.96 }],
  },
  disabled: {
    opacity: 0.7,
  },
  label: {
    color: colors.white,
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 1,
  },
});
