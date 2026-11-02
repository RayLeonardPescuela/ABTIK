/**
 * ABTIK authentication context.
 *
 * Wraps Supabase Auth (demo-mode sessions) and exposes the signed-in user
 * together with their `profiles` row. Every screen reads ids from here —
 * `auth.uid()` on the server only resolves when the request carries a real
 * session.
 *
 * Presentation demo mode (`isDemo`) bypasses all of that: `enterDemoMode()`
 * hands out an in-memory demo profile + id so guards pass instantly with
 * zero network, while the Supabase paths stay intact for real sessions.
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

import { DEMO_DRIVER_PROFILE, DEMO_PASSENGER, type DemoRole } from '@/lib/demoMode';
import { supabase } from '@/lib/supabaseClient';
import type { Profile } from '@/types/database';

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
  /** True when screens should read the in-memory demo fixtures (no backend). */
  isDemo: boolean;
  /** Enters instant demo mode for a role — no network, no auth, no dialogs. */
  enterDemoMode: (role: DemoRole) => void;
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

  /** Active demo persona (null = real session flow). */
  const [demoRole, setDemoRole] = useState<DemoRole | null>(null);
  const isDemo = demoRole !== null;
  const demoProfile =
    demoRole === 'passenger'
      ? DEMO_PASSENGER
      : demoRole === 'driver'
        ? DEMO_DRIVER_PROFILE
        : null;

  const userId = (isDemo ? demoProfile?.id : null) ?? session?.user.id ?? null;
  const profileLoading = userId !== null && profileLoadedFor !== userId;
  /** Demo persona wins over any restored real session. */
  const effectiveProfile = isDemo ? demoProfile : profile;

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
    if (isDemo || !userId) return;

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
  }, [userId, isDemo]);

  const enterDemoMode = useCallback((role: DemoRole) => {
    setDemoRole(role);
  }, []);

  const signOut = useCallback(async () => {
    setDemoRole(null);
    setProfile(null);
    setProfileLoadedFor(null);
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (isDemo || !userId) return;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    setProfile((data as Profile | null) ?? null);
    setProfileLoadedFor(userId);
  }, [userId, isDemo]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      userId,
      profile: effectiveProfile,
      loading: isDemo
        ? false
        : sessionLoading || (userId !== null && profileLoading),
      isDemo,
      enterDemoMode,
      signOut,
      refreshProfile,
    }),
    [
      session,
      userId,
      effectiveProfile,
      isDemo,
      sessionLoading,
      profileLoading,
      enterDemoMode,
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
