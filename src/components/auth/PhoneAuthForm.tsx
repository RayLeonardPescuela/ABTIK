/**
 * Phone-OTP sign-in (primary auth path for provincial users).
 *
 * Step 1 collects an E.164 phone number + the account role (role only routes
 * the UI — real capabilities such as accepting rides are gated server-side by
 * `vetted_status`). Step 2 verifies the SMS code.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useAuth } from '@/providers/AuthProvider';
import { colors } from '@/theme/colors';
import type { UserRole } from '@/types/database';

type Step = 'phone' | 'code';

/**
 * Normalizes common Philippine input formats to E.164.
 * `09171234567` → `+639171234567`, `639171234567` → `+639171234567`.
 * Returns null when the input cannot be a valid MSISDN.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\s()-]/g, '');
  if (!trimmed) return null;

  if (trimmed.startsWith('+')) {
    const plus = `+${trimmed.slice(1).replace(/\D/g, '')}`;
    return plus.length >= 10 && plus.length <= 16 ? plus : null;
  }

  const digits = trimmed.replace(/\D/g, '');
  let e164: string;
  if (digits.startsWith('0') && digits.length === 11) {
    e164 = `+63${digits.slice(1)}`;
  } else if (digits.startsWith('63') && digits.length >= 12) {
    e164 = `+${digits}`;
  } else {
    return null;
  }
  return e164.length <= 16 ? e164 : null;
}

const ROLES: { role: UserRole; label: string; hint: string }[] = [
  { role: 'passenger', label: 'Passenger', hint: 'Book campus & interior rides' },
  { role: 'driver', label: 'Driver', hint: 'Accept trips (vetting required)' },
];

export function PhoneAuthForm() {
  const { signInWithPhone, verifyOtp } = useAuth();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('passenger');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizePhone(phone);

  const onSendCode = async () => {
    if (!normalized) {
      setError('Enter a valid mobile number, e.g. 0917 123 4567.');
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await signInWithPhone(normalized, role);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async () => {
    if (code.trim().length < 4) {
      setError('Enter the code from your SMS.');
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await verifyOtp(normalized ?? phone, code.trim());
      // Session established — the root gate routes by profile.role.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    if (!normalized) return;
    try {
      setBusy(true);
      setError(null);
      await signInWithPhone(normalized, role);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>
        {step === 'phone' ? 'Sign in to ABTIK' : 'Enter your code'}
      </Text>

      {step === 'phone' ? (
        <>
          <View style={styles.roles}>
            {ROLES.map((option) => {
              const selected = role === option.role;
              return (
                <Pressable
                  key={option.role}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setRole(option.role)}
                  style={[styles.roleWrap, selected && styles.roleWrapSelected]}
                >
                  <Text style={[styles.role, selected && styles.roleSelected]}>
                    {option.label}
                  </Text>
                  <Text style={styles.roleHint}>{option.hint}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={phone}
            onChangeText={(next) => {
              setPhone(next);
              setError(null);
            }}
            placeholder="0917 123 4567"
            placeholderTextColor={colors.textDim}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            style={styles.input}
            editable={!busy}
          />

          <PrimaryButton
            label="Send SMS code"
            loading={busy}
            onPress={() => void onSendCode()}
          />
        </>
      ) : (
        <>
          <Text style={styles.caption}>
            Code sent to {normalized ?? phone}. Enter the 6-digit code to continue.
          </Text>

          <TextInput
            value={code}
            onChangeText={(next) => {
              setCode(next.replace(/\D/g, '').slice(0, 6));
              setError(null);
            }}
            placeholder="123456"
            placeholderTextColor={colors.textDim}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            style={[styles.input, styles.codeInput]}
            editable={!busy}
          />

          <PrimaryButton
            label="Verify & continue"
            loading={busy}
            onPress={() => void onVerify()}
          />

          <View style={styles.codeActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setStep('phone');
                setCode('');
                setError(null);
              }}
            >
              <Text style={styles.link}>Change number</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void onResend()}>
              <Text style={styles.link}>Resend code</Text>
            </Pressable>
          </View>
        </>
      )}

      {busy && !error ? <ActivityIndicator color={colors.accent} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 14,
    width: '100%',
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
  },
  caption: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  roles: {
    gap: 10,
  },
  roleWrap: {
    backgroundColor: colors.bgPanel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 2,
  },
  roleWrapSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  role: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: '700',
  },
  roleSelected: {
    color: colors.accent,
  },
  roleHint: {
    color: colors.textDim,
    fontSize: 12,
  },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.text,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  codeInput: {
    letterSpacing: 6,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  codeActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  link: {
    color: colors.info,
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
});
