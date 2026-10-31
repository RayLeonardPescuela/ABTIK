/**
 * SECTION 2: Supabase Client & Realtime Utilities
 * ------------------------------------------------
 * Initializes the ABTIK Supabase client with secure (Keychain/Keystore) session
 * persistence and exposes WebSocket helpers for live trip GPS streaming
 * on channel `ride_${rideId}_location`.
 */

import 'react-native-url-polyfill/auto';

import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from '@supabase/supabase-js';

import { authStorage } from '@/lib/authStorage';
import type { LocationPayload, Ride, RideStatus } from '@/types/database';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[ABTIK] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  );
}

/**
 * Singleton Supabase client.
 * Auth tokens are persisted in the device keystore so sessions survive app
 * restarts without living in plaintext storage.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * Builds the canonical Realtime channel name for a ride's GPS stream.
 * @param rideId - UUID of the active ride
 */
export function rideLocationChannelName(rideId: string): string {
  return `ride_${rideId}_location`;
}

/** Callback invoked whenever a new {@link LocationPayload} arrives. */
export type LocationCallback = (payload: LocationPayload) => void;

/** Id of the signed-in user (local session read — no network round trip). */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * Blanks `otp_code` unless the viewer is the ride's passenger.
 *
 * OTP verification happens server-side (`start_ride` RPC); no driver-facing
 * code path should ever hold the passenger's code.
 *
 * @param ride - Ride row about to be handed to UI state
 */
export async function applyOtpVisibility(ride: Ride): Promise<Ride> {
  const uid = await currentUserId();
  if (uid && ride.passenger_id === uid) return ride;
  return { ...ride, otp_code: '' };
}

/**
 * Long-lived publisher used by background GPS tasks.
 * Keeps one Realtime channel alive for the trip instead of reconnecting per sample.
 *
 * @param rideId - Active ride UUID
 */
export function createRideLocationPublisher(rideId: string) {
  const channel = supabase.channel(rideLocationChannelName(rideId));
  let ready = false;

  const readyPromise = new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ready = true;
        resolve();
      }
      if (status === 'CHANNEL_ERROR') reject(new Error('Realtime channel error'));
      if (status === 'TIMED_OUT') reject(new Error('Realtime subscribe timed out'));
    });
  });

  return {
    /**
     * Sends one GPS sample (broadcast + durable insert).
     * @param sample - Location fields without rideId
     */
    async send(sample: Omit<LocationPayload, 'rideId'>): Promise<void> {
      if (!ready) await readyPromise;

      const payload: LocationPayload = { rideId, ...sample };

      await channel.send({
        type: 'broadcast',
        event: 'location',
        payload,
      });

      const { error } = await supabase.from('trip_location_logs').insert({
        ride_id: rideId,
        lat: sample.lat,
        lng: sample.lng,
        speed: sample.speed,
        heading: sample.heading,
        timestamp: sample.timestamp,
      });

      if (error) throw error;
    },

    /** Tears down the Realtime channel. Call when the trip ends. */
    async dispose(): Promise<void> {
      await supabase.removeChannel(channel);
    },
  };
}

/**
 * Subscribes to live driver GPS updates for a ride.
 *
 * @param rideId - Ride UUID to listen on
 * @param callback - Invoked for each `location` broadcast event
 * @param onStatus - Optional channel status listener (SUBSCRIBED / ERROR / …)
 * @returns Unsubscribe / cleanup function
 */
export function subscribeToRideLocation(
  rideId: string,
  callback: LocationCallback,
  onStatus?: (status: string) => void,
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(rideLocationChannelName(rideId), {
      config: { broadcast: { self: false } },
    })
    .on('broadcast', { event: 'location' }, ({ payload }) => {
      callback(payload as LocationPayload);
    })
    .subscribe((status) => {
      onStatus?.(status);
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Listens for `postgres_changes` UPDATE events on a single ride row.
 * Used by passenger/driver UIs to react to status transitions.
 *
 * @param rideId - Ride UUID
 * @param onUpdate - Called with the new ride row
 */
export function subscribeToRideStatus(
  rideId: string,
  onUpdate: (ride: Ride) => void,
): () => void {
  const channel = supabase
    .channel(`ride_status_${rideId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: `id=eq.${rideId}`,
      },
      (payload) => {
        onUpdate(payload.new as Ride);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Subscribes to newly requested rides (driver matching inbox).
 *
 * RLS scopes this feed to online, vetted drivers within 5 km of the pickup.
 * The pre-accept OTP is stripped before the payload ever reaches app state —
 * `accept_ride()` rotates the code anyway, but drivers should never hold it.
 *
 * @param onRequest - Called for each INSERT where status = requested
 */
export function subscribeToIncomingRides(onRequest: (ride: Ride) => void): () => void {
  const channel = supabase
    .channel('incoming_rides')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'rides',
        filter: 'status=eq.requested',
      },
      (payload) => {
        onRequest({ ...(payload.new as Ride), otp_code: '' });
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/**
 * Updates ride status (and optional timestamp fields).
 *
 * Enforced server-side by the `rides_guard` trigger (allowed transitions only,
 * driver must complete their own trip, pricing/OTP fields immutable).
 *
 * @param rideId - Ride UUID
 * @param status - Target {@link RideStatus}
 * @param extra - Optional driver_id / started_at / completed_at patches
 */
export async function updateRideStatus(
  rideId: string,
  status: RideStatus,
  extra: Partial<Pick<Ride, 'driver_id' | 'started_at' | 'completed_at'>> = {},
): Promise<Ride> {
  const { data, error } = await supabase
    .from('rides')
    .update({ status, ...extra })
    .eq('id', rideId)
    .select()
    .single();

  if (error) throw error;
  return applyOtpVisibility(data as Ride);
}
