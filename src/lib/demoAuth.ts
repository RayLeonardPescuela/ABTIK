/**
 * ABTIK demo authentication (presentation mode).
 *
 * Signs into REAL Supabase accounts with email/password — no SMS anywhere —
 * so the app holds a genuine session JWT and `auth.uid()` resolves server-side.
 * RLS policies and SECURITY DEFINER RPCs therefore behave exactly as in the
 * production phone-OTP flow; only the credential entry point differs.
 *
 * Accounts are created by `scripts/seed-demo-accounts.sql`:
 *   supabase db query --local -f scripts/seed-demo-accounts.sql
 */

import { supabase } from '@/lib/supabaseClient';

/** Demo roles that can be entered straight from the index screen. */
export const DEMO_ROLES = ['passenger', 'driver'] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

/** Shared password for both demo accounts (demo databases only). */
const DEMO_PASSWORD = 'abtik-demo-2026';

export const DEMO_ACCOUNTS: Record<DemoRole, { email: string; fullName: string }> = {
  passenger: { email: 'demo.passenger@abtik.local', fullName: 'Ana (Demo)' },
  driver: { email: 'demo.driver@abtik.local', fullName: 'Kuya Ben (Demo)' },
};

/**
 * Opens a full Supabase session for the chosen demo role.
 *
 * Throws a Supabase Auth error (annotated with the seed command) when the
 * demo accounts do not exist yet — the UI shows that message verbatim.
 */
export async function signInAsDemo(role: DemoRole): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({
    email: DEMO_ACCOUNTS[role].email,
    password: DEMO_PASSWORD,
  });
  if (error) {
    throw new Error(
      `${error.message}\n\nDemo accounts missing? Seed them once with:\n` +
        'supabase db query --local -f scripts/seed-demo-accounts.sql',
    );
  }
}
