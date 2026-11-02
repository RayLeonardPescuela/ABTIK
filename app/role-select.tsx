import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEMO_ROLES, signInAsDemo, type DemoRole } from '@/lib/demoAuth';
import { colors } from '@/theme/colors';

const ROLE_CARDS: Record<
  DemoRole,
  { icon: string; title: string; blurb: string; points: readonly string[] }
> = {
  passenger: {
    icon: '🙋',
    title: 'I need a ride',
    blurb: 'Book campus & provincial trips',
    points: [
      'Live driver tracking',
      'One-tap SOS to Safety Circle',
      'Fare shown before you ride',
    ],
  },
  driver: {
    icon: '🛵',
    title: 'I drive',
    blurb: 'Accept trips and earn',
    points: [
      'Incoming ride radar',
      'Server-verified trip OTP',
      'Background GPS streaming',
    ],
  },
};

/**
 * Role Selection — the post-"Get Started" screen. Each card signs into a
 * seeded demo account (real Supabase session, so `auth.uid()` and RLS work)
 * and lands straight on the matching dashboard. No SMS/OTP anywhere.
 */
export default function RoleSelectScreen() {
  const [busy, setBusy] = useState<DemoRole | null>(null);

  const onPick = useCallback(async (role: DemoRole) => {
    setBusy(role);
    try {
      await signInAsDemo(role);
      router.replace(
        role === 'driver' ? '/(driver)/dashboard' : '/(passenger)/home',
      );
    } catch (err) {
      setBusy(null);
      Alert.alert(
        'Could not enter demo',
        err instanceof Error ? err.message : 'Unknown error',
      );
    }
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose your role</Text>
        <Text style={styles.subtitle}>
          One tap into the full ABTIK experience — real sessions, zero SMS
          codes. Switch roles anytime from the landing screen.
        </Text>
      </View>

      <View style={styles.cards}>
        {DEMO_ROLES.map((role) => {
          const card = ROLE_CARDS[role];
          const isLoading = busy === role;
          const isDisabled = busy !== null;
          return (
            <Pressable
              key={role}
              disabled={isDisabled}
              onPress={() => void onPick(role)}
              style={({ pressed }) => [
                styles.card,
                pressed && !isDisabled && styles.cardPressed,
                isDisabled && !isLoading && styles.cardDim,
              ]}
            >
              <Text style={styles.cardIcon}>{card.icon}</Text>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{card.title}</Text>
                <Text style={styles.cardBlurb}>{card.blurb}</Text>
                <View style={styles.points}>
                  {card.points.map((point) => (
                    <Text key={point} style={styles.point}>
                      ✓ {point}
                    </Text>
                  ))}
                </View>
              </View>
              {isLoading ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={styles.chevron}>→</Text>
              )}
            </Pressable>
          );
        })}
      </View>

      <Pressable
        hitSlop={8}
        onPress={() => router.replace('/')}
        style={styles.back}
      >
        <Text style={styles.backText}>← Back to landing</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  header: {
    gap: 10,
    marginBottom: 24,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 360,
  },
  cards: {
    gap: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    padding: 20,
  },
  cardPressed: {
    borderColor: colors.accent,
    transform: [{ scale: 0.99 }],
  },
  cardDim: {
    opacity: 0.5,
  },
  cardIcon: {
    fontSize: 34,
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  cardBlurb: {
    color: colors.textMuted,
    fontSize: 13,
  },
  points: {
    gap: 3,
    marginTop: 6,
  },
  point: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 17,
  },
  chevron: {
    color: colors.accent,
    fontSize: 22,
    fontWeight: '700',
  },
  back: {
    marginTop: 'auto',
    alignSelf: 'center',
    padding: 12,
  },
  backText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
});
