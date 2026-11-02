import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEMO_ROLES, type DemoRole } from '@/lib/demoMode';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme/colors';

const ROLE_CARDS: Record<
  DemoRole,
  { icon: string; title: string; blurb: string; points: readonly string[] }
> = {
  passenger: {
    icon: '🙋',
    title: 'I Need a Ride',
    blurb: 'Book campus & provincial trips',
    points: [
      'Live driver tracking',
      'One-tap SOS to Safety Circle',
      'Fare shown before you ride',
    ],
  },
  driver: {
    icon: '🛵',
    title: 'I Want to Drive',
    blurb: 'Accept trips and earn',
    points: [
      'Incoming ride radar',
      'Server-verified trip OTP',
      'Background GPS streaming',
    ],
  },
};

/**
 * Role Selection — the instant demo entry after "Get Started".
 *
 * Tapping a card enters in-memory demo mode and navigates straight to that
 * role's dashboard: no login screens, SMS codes, email forms, ID checks or
 * verification dialogs anywhere in the flow. Fixtures (map, rides, Safety
 * Circle) are already in memory, so the dashboard renders interactive on
 * the very next frame.
 */
export default function RoleSelectScreen() {
  const { enterDemoMode } = useAuth();

  const onPick = (role: DemoRole) => {
    enterDemoMode(role);
    router.replace(
      role === 'driver' ? '/(driver)/dashboard' : '/(passenger)/home',
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose your role</Text>
        <Text style={styles.subtitle}>
          One tap into the full ABTIK experience — no login, no SMS, no
          verification. Swap roles anytime with the ⇄ Switch Role button.
        </Text>
      </View>

      <View style={styles.cards}>
        {DEMO_ROLES.map((role) => {
          const card = ROLE_CARDS[role];
          return (
            <Pressable
              key={role}
              onPress={() => onPick(role)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
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
              <Text style={styles.chevron}>→</Text>
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
