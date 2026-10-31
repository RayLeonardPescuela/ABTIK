import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PhoneAuthForm } from '@/components/auth/PhoneAuthForm';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { DEMO_ROLES, signInAsDemo, type DemoRole } from '@/lib/demoAuth';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme/colors';
import type { UserRole } from '@/types/database';

/**
 * Entry gate — phone OTP sign-in (or one-tap Demo Mode), then role-based
 * routing. `auth.uid()` is only valid once this screen has a real session,
 * so every downstream screen reads ids from the auth context instead of
 * hardcoding them. Demo sign-in opens a real password session, so server-side
 * auth behaves identically to the phone flow — no SMS anywhere.
 */
export default function RoleGateScreen() {
  const { session, profile, loading, signOut, refreshProfile } = useAuth();
  const [demoBusy, setDemoBusy] = useState<DemoRole | null>(null);

  const onContinue = () => {
    const role: UserRole = profile?.role ?? 'passenger';
    router.push(role === 'driver' ? '/(driver)/dashboard' : '/(passenger)/home');
  };

  const onDemoSignIn = async (role: DemoRole) => {
    setDemoBusy(role);
    try {
      await signInAsDemo(role);
    } catch (err) {
      Alert.alert(
        'Demo sign-in failed',
        err instanceof Error ? err.message : 'Unknown error',
      );
    } finally {
      setDemoBusy(null);
    }
  };

  const onSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.warn('[ABTIK] sign out failed', err);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.hero}>
        <Text style={styles.brand}>ABTIK</Text>
        <Text style={styles.tagline}>
          Smart Campus & Provincial Mobility — safe rides on sudlunon roads.
        </Text>
      </View>

      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.accent} size="large" />
        ) : !session ? (
          <>
            <PhoneAuthForm />
            <View style={styles.demoCard}>
              <Text style={styles.demoDivider}>— or present with Demo Mode —</Text>
              <Text style={styles.demoTitle}>One-tap role switch, no SMS</Text>
              <Text style={styles.demoHint}>
                Signs into seeded demo accounts with a real Supabase session,
                so auth.uid() and every RLS rule behave exactly like
                production. Use Sign out to switch roles.
              </Text>
              {DEMO_ROLES.map((role) => (
                <PrimaryButton
                  key={role}
                  label={`Enter as ${role === 'driver' ? 'Driver' : 'Passenger'}`}
                  loading={demoBusy === role}
                  onPress={() => void onDemoSignIn(role)}
                />
              ))}
            </View>
          </>
        ) : !profile ? (
          <View style={styles.sessionCard}>
            <Text style={styles.sessionTitle}>Profile not loaded yet</Text>
            <Text style={styles.sessionMeta}>
              Your account is signed in but the profile row could not be read —
              check your connection and retry.
            </Text>
            <PrimaryButton
              label="Retry"
              loading={loading}
              onPress={() => void refreshProfile()}
            />
            <PrimaryButton label="Sign out" variant="ghost" onPress={() => void onSignOut()} />
          </View>
        ) : (
          <View style={styles.sessionCard}>
            <Text style={styles.sessionTitle}>
              Signed in as {profile.full_name}
            </Text>
            <Text style={styles.sessionMeta}>
              {profile.phone_number ?? 'No phone on file'} · {profile.role}
            </Text>
            {profile.role === 'driver' ? (
              <Text style={styles.driverNote}>
                Driver accounts must be vetted by ABTIK operations before trips
                can be accepted.
              </Text>
            ) : null}
            <PrimaryButton label="Continue" onPress={onContinue} />
            <PrimaryButton
              label="Sign out"
              variant="ghost"
              onPress={() => void onSignOut()}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  hero: {
    marginTop: 72,
    gap: 12,
  },
  brand: {
    color: colors.accent,
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: 2,
  },
  tagline: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 320,
  },
  body: {
    marginBottom: 36,
    gap: 12,
  },
  sessionCard: {
    gap: 12,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
  },
  sessionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  sessionMeta: {
    color: colors.textMuted,
    fontSize: 13,
  },
  driverNote: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 18,
  },
  demoCard: {
    gap: 10,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 18,
    padding: 16,
  },
  demoDivider: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  demoTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  demoHint: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
