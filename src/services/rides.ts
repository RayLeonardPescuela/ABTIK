/**
 * Ride domain services.
 *
 * Every state change goes through a SECURITY DEFINER RPC (or a guarded UPDATE)
 * so fare, OTP and driver assignment are enforced by the database, not by the
 * app:
 *   create_ride  → fare computed with PostGIS ST_Distance + night surcharge
 *   accept_ride  → vetted/online drivers only, race-safe, rotates the OTP
 *   start_ride   → server-side OTP comparison with attempt limit + lockout
 */

import { Linking, Platform } from 'react-native';

import { currentUserId, supabase } from '@/lib/supabaseClient';
import type {
  ActiveRideView,
  Driver,
  LatLng,
  Profile,
  Ride,
  SafetyCircle,
} from '@/types/database';

/**
 * Ride columns exposed to clients — deliberately excludes `otp_code`.
 * Declared as a string literal (not `.join()`) so supabase-js can statically
 * parse the select shape instead of falling back to `GenericStringError`.
 */
const RIDE_COLUMNS =
  'id,passenger_id,driver_id,pickup_location,pickup_address,dropoff_location,dropoff_address,landmark_notes,landmark_image_url,landmark_audio_url,fare_amount,status,started_at,completed_at,created_at,updated_at,otp_attempts,otp_locked_until';

export interface CreateRideInput {
  passengerId: string;
  pickup: LatLng;
  pickupAddress: string;
  dropoff: LatLng;
  dropoffAddress: string;
  landmarkNotes?: string;
  landmarkImageUrl?: string;
}

/**
 * Requests a ride. The fare shown in the UI is an **estimate only** — the
 * authoritative amount is computed inside `create_ride()`.
 */
export async function createRideRequest(input: CreateRideInput): Promise<Ride> {
  // Prefer RPC so PostGIS geography points are constructed server-side
  const { data, error } = await supabase.rpc('create_ride', {
    p_passenger_id: input.passengerId,
    p_pickup_lng: input.pickup.longitude,
    p_pickup_lat: input.pickup.latitude,
    p_pickup_address: input.pickupAddress,
    p_dropoff_lng: input.dropoff.longitude,
    p_dropoff_lat: input.dropoff.latitude,
    p_dropoff_address: input.dropoffAddress,
    p_landmark_notes: input.landmarkNotes ?? null,
    p_landmark_image_url: input.landmarkImageUrl ?? null,
  });

  if (error) throw error;
  return data as Ride;
}

/**
 * Fills `otp_code` for the passenger viewer and blanks it for everyone else.
 * Runs in parallel with the rest of the view assembly.
 */
async function hydrateOtp<T extends Ride>(ride: T): Promise<T> {
  const uid = await currentUserId();
  if (uid && uid === ride.passenger_id) {
    const { data } = await supabase
      .from('rides')
      .select('otp_code')
      .eq('id', ride.id)
      .maybeSingle();
    return { ...ride, otp_code: data?.otp_code ?? '' };
  }
  return { ...ride, otp_code: '' };
}

/** Single ride row without driver/guardian joins. */
async function fetchRideRow(rideId: string): Promise<Ride> {
  const { data, error } = await supabase
    .from('rides')
    .select(RIDE_COLUMNS)
    .eq('id', rideId)
    .single();

  if (error || !data) throw error ?? new Error('Ride not found');
  return hydrateOtp(data as Ride);
}

/** Ride + assigned driver + driver profile + passenger safety circles. */
export async function fetchActiveRideView(rideId: string): Promise<ActiveRideView> {
  const { data: rideRow, error } = await supabase
    .from('rides')
    .select(RIDE_COLUMNS)
    .eq('id', rideId)
    .single();

  if (error || !rideRow) throw error ?? new Error('Ride not found');
  const base = { ...(rideRow as Ride), otp_code: '' };

  const [ride, driverRow, profileRow, circlesRes] = await Promise.all([
    hydrateOtp(base),
    base.driver_id
      ? supabase
          .from('drivers')
          .select('*')
          .eq('id', base.driver_id)
          .maybeSingle()
      : Promise.resolve({ data: null as Driver | null }),
    base.driver_id
      ? supabase
          .from('profiles')
          .select('*')
          .eq('id', base.driver_id)
          .maybeSingle()
      : Promise.resolve({ data: null as Profile | null }),
    supabase.from('safety_circles').select('*').eq('passenger_id', base.passenger_id),
  ]);

  return {
    ride,
    driver: (driverRow.data as Driver | null) ?? null,
    driverProfile: (profileRow.data as Profile | null) ?? null,
    safetyCircles: (circlesRes.data as SafetyCircle[]) ?? [],
  };
}

/**
 * Accepts a requested ride as the signed-in driver.
 * Server checks: online, vetted, within 5 km, status still `requested`.
 */
export async function acceptRide(rideId: string): Promise<Ride> {
  const { data, error } = await supabase.rpc('accept_ride', {
    p_ride_id: rideId,
  });

  if (error) throw error;
  return data as Ride;
}

/** Response shape of the `start_ride` RPC (jsonb). */
export interface StartRideRpcResult {
  success: boolean;
  error?: string;
  locked?: boolean;
  attempts_remaining?: number;
}

/**
 * Starts the trip. The OTP is compared **in the database** with an attempt
 * counter — the driver client never receives the code.
 *
 * @throws Error with the server message (remaining attempts / lockout).
 */
export async function startRideWithOtp(
  rideId: string,
  otpCode: string,
): Promise<Ride> {
  const { data, error } = await supabase.rpc('start_ride', {
    p_ride_id: rideId,
    p_otp: otpCode,
  });

  if (error) throw error;

  const result = data as StartRideRpcResult;
  if (!result.success) {
    throw new Error(result.error ?? 'OTP verification failed');
  }

  return fetchRideRow(rideId);
}

/**
 * Toggles driver availability and, when going online, records the GPS fix the
 * feed radius is measured from. Uses `update_driver_location` (auth.uid()).
 */
export async function setDriverOnline(
  isOnline: boolean,
  location?: LatLng,
): Promise<void> {
  if (location) {
    const { error } = await supabase.rpc('update_driver_location', {
      p_lng: location.longitude,
      p_lat: location.latitude,
      p_is_online: isOnline,
    });
    if (error) throw error;
    return;
  }

  const uid = await currentUserId();
  if (!uid) throw new Error('not signed in');

  const { error } = await supabase
    .from('drivers')
    .update({ is_online: isOnline })
    .eq('id', uid);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// SOS
// -----------------------------------------------------------------------------

/** Outcome of an SOS attempt — never report success the backend didn't earn. */
export type SosOutcome =
  | { status: 'sent'; channel: 'backend'; detail: string }
  | { status: 'fallback'; channel: 'sms' | 'call'; detail: string }
  | { status: 'failed'; channel: 'none'; detail: string };

const SOS_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Newest auto-notify guardian on the passenger's own Safety Circle. */
async function fetchPrimaryGuardian(): Promise<{
  name: string;
  phone: string;
} | null> {
  const { data } = await supabase
    .from('safety_circles')
    .select('guardian_name, guardian_phone')
    .eq('auto_notify', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data?.guardian_phone) return null;
  return { name: data.guardian_name, phone: data.guardian_phone };
}

/** Native SMS composer URL — `&body` on iOS, `?body` on Android. */
function smsUrl(phone: string, body: string): string {
  const encoded = encodeURIComponent(body);
  return Platform.OS === 'ios'
    ? `sms:${phone}&body=${encoded}`
    : `sms:${phone}?body=${encoded}`;
}

async function tryOpenUrl(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Triggers an SOS for `rideId`.
 *
 * 1. Backend (`ride-sos` Edge Function) with an 8s ceiling.
 * 2. On any backend failure: open a native SMS to the primary guardian.
 * 3. Then: dial that guardian.
 * 4. Then: dial 911.
 * 5. Otherwise: report `failed` so the UI can tell the truth.
 */
export async function triggerSos(rideId: string): Promise<SosOutcome> {
  let backendFailure = 'unreachable';

  try {
    const { error } = await withTimeout(
      supabase.functions.invoke('ride-sos', {
        body: { ride_id: rideId, triggered_at: new Date().toISOString() },
      }),
      SOS_TIMEOUT_MS,
    );
    if (!error) {
      return {
        status: 'sent',
        channel: 'backend',
        detail: 'Guardians and campus security were alerted for this trip.',
      };
    }
    backendFailure = error.message;
  } catch (err) {
    backendFailure = err instanceof Error ? err.message : 'network error';
  }

  const message = `ABTIK SOS: I need help on ride ${rideId}. Please call me now.`;
  const guardian = await fetchPrimaryGuardian().catch(() => null);

  if (guardian) {
    if (await tryOpenUrl(smsUrl(guardian.phone, message))) {
      return {
        status: 'fallback',
        channel: 'sms',
        detail: `SOS alert service is down (${backendFailure}). A text to ${guardian.name} (${guardian.phone}) is ready — press send.`,
      };
    }

    const tel = `tel:${guardian.phone.replace(/[^\d+]/g, '')}`;
    if (await tryOpenUrl(tel)) {
      return {
        status: 'fallback',
        channel: 'call',
        detail: `SOS alert service is down (${backendFailure}). Calling ${guardian.name} (${guardian.phone}).`,
      };
    }
  }

  if (await tryOpenUrl('tel:911')) {
    return {
      status: 'fallback',
      channel: 'call',
      detail: `No guardian reachable and the SOS service is down (${backendFailure}). Calling 911.`,
    };
  }

  return {
    status: 'failed',
    channel: 'none',
    detail: `SOS could NOT be delivered (${backendFailure}), and no SMS/phone app opened. Call campus security or 911 manually now.`,
  };
}
