import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme/colors';
import type { UserRole } from '@/types/database';

const FEATURES = [
  {
    icon: '🛡️',
    title: 'Safety-first rides',
    body: 'Vetted drivers, server-verified trip OTPs and a one-tap SOS that always reaches your Safety Circle.',
  },
  {
    icon: '📍',
    title: 'Live trip sharing',
    body: 'Guardians follow every active ride in real time — background GPS keeps streaming on a locked screen.',
  },
  {
    icon: '🌙',
    title: 'Built for the province',
    body: 'Smart campus pickups, server-side fares with night surcharge, and honest map fallbacks.',
  },
] as const;

/**
 * Landing page — fully scrollable welcome screen with a prominent
 * "Get Started" CTA pinned to the bottom. There is no SMS/OTP step:
 * Get Started enters the app straight through Role Selection (demo-mode
 * sign-in) or, when a session already exists, the role dashboard.
 */
export default function LandingScreen() {
  const { session, profile, loading, signOut } = useAuth();

  const onGetStarted = () => {
    if (loading) return;
    if (session && profile) {
      const role: UserRole = profile.role;
      router.replace(
        role === 'driver' ? '/(driver)/dashboard' : '/(passenger)/home',
      );
    } else {
      router.replace('/role-select');
    }
  };

  const onSwitchAccount = async () => {
    try {
      await signOut();
    } catch (err) {
      console.warn('[ABTIK] sign out failed', err);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.brand}>ABTIK</Text>
          <View style={styles.brandBar} />
          <Text style={styles.tagline}>
            Smart campus & provincial mobility — safe rides on sudlunon roads.
          </Text>
        </View>

        <View style={styles.features}>
          {FEATURES.map((feature) => (
            <View key={feature.title} style={styles.featureCard}>
              <Text style={styles.featureIcon}>{feature.icon}</Text>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureBody}>{feature.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator
            color={colors.accent}
            size="large"
            style={styles.spinner}
          />
        ) : session && profile ? (
          <View style={styles.accountRow}>
            <Text style={styles.accountText}>
              Signed in as {profile.full_name} · {profile.role}
            </Text>
            <Pressable hitSlop={8} onPress={() => void onSwitchAccount()}>
              <Text style={styles.switchLink}>Switch account</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.ctaBlock}>
          <PrimaryButton
            label="Get Started"
            onPress={onGetStarted}
            style={styles.cta}
          />
          <Text style={styles.ctaHint}>
            Demo mode — one tap straight into Passenger or Driver, no SMS codes.
          </Text>
        </View>
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
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 24,
    flexGrow: 1,
  },
  hero: {
    marginTop: 16,
    gap: 12,
  },
  brand: {
    color: colors.text,
    fontSize: 46,
    fontWeight: '900',
    letterSpacing: 3,
  },
  brandBar: {
    width: 56,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  tagline: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 320,
  },
  features: {
    gap: 12,
  },
  featureCard: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
  },
  featureIcon: {
    fontSize: 26,
    lineHeight: 30,
  },
  featureText: {
    flex: 1,
    gap: 4,
  },
  featureTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  featureBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  spinner: {
    alignSelf: 'center',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  accountText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  switchLink: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  ctaBlock: {
    marginTop: 'auto',
    gap: 12,
  },
  cta: {
    minHeight: 60,
    borderRadius: 16,
    elevation: 6,
    shadowColor: colors.accent,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  ctaHint: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
