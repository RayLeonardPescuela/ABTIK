/**
 * Route error boundary (expo-router `error.tsx`).
 *
 * Any render-phase crash inside a screen lands here instead of a blank
 * screen: the message is shown on the app's dark canvas so a failing
 * feature is readable (and screenshot-able) during a live demo.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';

export default function RouteErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          The app hit an unexpected error on this screen. You can try again,
          or restart the demo from the landing page.
        </Text>

        <View style={styles.errorBox}>
          <Text style={styles.errorText} selectable>
            {error?.message ?? String(error)}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={reset}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonLabel}>Try again</Text>
        </Pressable>

        <Text style={styles.hint}>
          If this keeps happening, reinstall the latest build from the EAS
          link.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 16,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  body: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  errorBox: {
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
    padding: 14,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  hint: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
