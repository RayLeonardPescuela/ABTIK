/**
 * ABTIK authentication context.
 *
 * Wraps Supabase Auth (phone OTP) and exposes the signed-in user together
 * with their `profiles` row. Every screen that talks to the database must
 * read ids from here — `auth.uid()` on the server only resolves correctly
 * when the request carries a real session.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabaseClient';
import type { Profile, UserRole } from '@/types/database';

/** How long to wait for the `handle_new_user` trigger before retrying. */
const PROFILE_RETRY_DELAY_MS = 600;

interface AuthContextValue {
  /** Raw Supabase session (null when signed out). */
  session: Session | null;
  /** Signed-in user id — the value behind `auth.uid()`. */
  userId: string | null;
  /** `profiles` row for the signed-in user (role, name, phone). */
  profile: Profile | null;
  /** True while the session or profile is still being resolved. */
  loading: boolean;
  /** Sends an SMS code. `role` is stored as metadata on first sign-up. */
  signInWithPhone: (phone: string, role: UserRole) => Promise<void>;
  /** Verifies the SMS code and opens the session. */
  verifyOtp: (phone: string, token: string) => Promise<void>;
  /** Signs out and clears the local profile. */
  signOut: () => Promise<void>;
  /** Re-reads the profile row (e.g. after onboarding). */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  /**
   * Which user's profile has been fetched. `profileLoading` is *derived*
   * from it so effects never need to set loading state synchronously.
   */
  const [profileLoadedFor, setProfileLoadedFor] = useState<string | null>(null);

  const userId = session?.user.id ?? null;
  const profileLoading = userId !== null && profileLoadedFor !== userId;

  // Track the session (initial load + refreshes + sign in/out).
  useEffect(() => {
    let mounted = true;

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setSessionLoading(false);
      })
      .catch(() => {
        if (mounted) setSessionLoading(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setSessionLoading(false);
      if (!nextSession) {
        // Signed out / session expired — drop the stale profile here (event
        // callback), not in an effect body.
        setProfile(null);
        setProfileLoadedFor(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Load the profile whenever the signed-in user changes. Everything after
  // the first `await` runs in a microtask, so no setState happens in the
  // effect body itself.
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    const load = async (attempt: number): Promise<void> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.warn('[ABTIK] profile load failed', error.message);
        setProfileLoadedFor(userId);
        return;
      }

      if (!data && attempt === 0) {
        // handle_new_user trigger may still be catching up right after signup.
        setTimeout(() => {
          if (!cancelled) void load(attempt + 1);
        }, PROFILE_RETRY_DELAY_MS);
        return;
      }

      setProfile((data as Profile | null) ?? null);
      setProfileLoadedFor(userId);
    };

    void load(0);

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const signInWithPhone = useCallback(async (phone: string, role: UserRole) => {
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: {
        // Consumed by the handle_new_user trigger on first verification.
        data: { role },
      },
    });
    if (error) throw error;
  }, []);

  const verifyOtp = useCallback(async (phone: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    setProfile(null);
    setProfileLoadedFor(null);
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    setProfile((data as Profile | null) ?? null);
    setProfileLoadedFor(userId);
  }, [userId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      userId,
      profile,
      loading: sessionLoading || (userId !== null && profileLoading),
      signInWithPhone,
      verifyOtp,
      signOut,
      refreshProfile,
    }),
    [
      session,
      userId,
      profile,
      sessionLoading,
      profileLoading,
      signInWithPhone,
      verifyOtp,
      signOut,
      refreshProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the auth context. Throws outside {@link AuthProvider}. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
