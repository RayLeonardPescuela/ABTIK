/**
 * ABTIK in-memory demo state (presentation build).
 *
 * The role cards on `app/role-select.tsx` enter demo mode *synchronously* —
 * no network, no auth, no dialogs — and every dashboard reads/writes this
 * one shared store, so the whole passenger ⇄ driver story stays coherent on
 * a single device: the passenger's booking pops up in the driver's radar,
 * and the driver's accept/start/complete flips the passenger's live screen.
 *
 * Nothing here talks to Supabase. The real backend paths remain intact for
 * signed-in sessions (`isDemo === false` in AuthProvider).
 */

import { Linking, Platform } from 'react-native';

import { estimateFare } from '@/constants/fare';
import type { SosOutcome } from '@/services/rides';
import type {
  ActiveRideView,
  Driver,
  LatLng,
  Profile,
  Ride,
  RideStatus,
  SafetyCircle,
} from '@/types/database';
import { distanceKm, latLngToGeoJson } from '@/utils/geo';

/** Which demo persona the app is currently wearing. */
export type DemoRole = 'passenger' | 'driver';

/** Roles offered on the instant role-picker cards. */
export const DEMO_ROLES = ['passenger', 'driver'] as const;

const NOW = new Date().toISOString();

export const DEMO_PASSENGER: Profile = {
  id: 'demo-passenger-0001',
  full_name: 'Ana (Demo)',
  phone_number: '+639171111111',
  avatar_url: null,
  role: 'passenger',
  created_at: NOW,
};

export const DEMO_DRIVER_PROFILE: Profile = {
  id: 'demo-driver-0001',
  full_name: 'Kuya Ben (Demo)',
  phone_number: '+639172222222',
  avatar_url: null,
  role: 'driver',
  created_at: NOW,
};

/** Vetted, campus-parked driver row — skips onboarding straight to the dashboard. */
export const DEMO_DRIVER_ROW: Driver = {
  id: DEMO_DRIVER_PROFILE.id,
  vehicle_plate: 'ABTIK DEMO',
  vehicle_model: 'Honda TMX 125',
  license_number: 'DL-DEMO-0001',
  is_online: false,
  current_location: latLngToGeoJson({ latitude: 10.3157, longitude: 123.8854 }),
  rating: 4.9,
  vetted_status: true,
  updated_at: NOW,
};

/** Passenger's Safety Circle — shows on banners and receives demo SOS handoffs. */
export const DEMO_SAFETY_CIRCLES: SafetyCircle[] = [
  {
    id: 'demo-circle-0001',
    passenger_id: DEMO_PASSENGER.id,
    guardian_phone: '+639175550123',
    guardian_name: 'Nanay Reyes (Demo)',
    relationship: 'family',
    auto_notify: true,
    created_at: NOW,
  },
];

/**
 * Static campus position for the driver marker on the passenger map.
 * Expo Go cannot background-stream GPS, so demo mode shows the marker at the
 * driver's park position instead of pretending a live feed is flowing.
 */
export const DEMO_DRIVER_POSITION: LatLng = {
  latitude: 10.316,
  longitude: 123.885,
};

/** Unclaimed verified drivers circling campus — the nearby-radar flavor. */
export const DEMO_NEARBY_DRIVERS: LatLng[] = [
  { latitude: 10.3149, longitude: 123.8843 },
  { latitude: 10.3168, longitude: 123.8866 },
  { latitude: 10.3151, longitude: 123.8876 },
];

/** Trip code both sides read in demo mode (no server-side rotation needed). */
const DEMO_OTP = '4821';

const PICKUP: LatLng = { latitude: 10.3157, longitude: 123.8854 };
const DROPOFF: LatLng = { latitude: 10.3105, longitude: 123.8934 };

// ---------------------------------------------------------------------------
// Store — module-level singleton with a tiny pub/sub (same JS realm on the
// single presentation device, so both personas see one world).
// ---------------------------------------------------------------------------

let rideSeq = 0;
let rides: Ride[] = [];
/** Rides the presenter dismissed with Decline — never re-pop automatically. */
const declinedRideIds = new Set<string>();

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

/** Fires on every store mutation — screens re-run their `load()` callback. */
export function subscribeDemoRides(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function makeDemoRide(): Ride {
  rideSeq += 1;
  const timestamp = new Date().toISOString();
  return {
    id: `demo-ride-${rideSeq}`,
    passenger_id: DEMO_PASSENGER.id,
    driver_id: null,
    pickup_location: latLngToGeoJson(PICKUP),
    pickup_address: 'Main Gate Hub',
    dropoff_location: latLngToGeoJson(DROPOFF),
    dropoff_address: 'Sudlunon Proper',
    landmark_notes: 'Blue gate near the waiting shed',
    landmark_image_url: null,
    landmark_audio_url: null,
    otp_code: DEMO_OTP,
    otp_attempts: 0,
    otp_locked_until: null,
    fare_amount: estimateFare(distanceKm(PICKUP, DROPOFF)).total,
    status: 'requested',
    started_at: null,
    completed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

// A pending request exists from app start so the driver's radar has content
// the moment they come online — even before the passenger books anything.
rides = [makeDemoRide()];

function getDemoRide(rideId: string): Ride | null {
  return rides.find((ride) => ride.id === rideId) ?? null;
}

function patchRide(rideId: string, patch: Partial<Ride>): Ride {
  const current = getDemoRide(rideId);
  if (!current) throw new Error('Demo ride not found');
  const next: Ride = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  rides = rides.map((ride) => (ride.id === rideId ? next : ride));
  emit();
  return next;
}

// ---------------------------------------------------------------------------
// Reads (mirror the Supabase service functions the screens already call)
// ---------------------------------------------------------------------------

/** Full passenger/driver view with joins — mirrors `fetchActiveRideView`. */
export function getDemoRideView(rideId: string): ActiveRideView {
  const ride = getDemoRide(rideId);
  if (!ride) throw new Error('Ride not found');
  const assigned = ride.driver_id !== null;
  return {
    ride,
    driver: assigned ? DEMO_DRIVER_ROW : null,
    driverProfile: assigned ? DEMO_DRIVER_PROFILE : null,
    safetyCircles: DEMO_SAFETY_CIRCLES,
  };
}

/** Oldest ride still waiting — the driver radar's catch-up read. */
export function getFirstRequestedDemoRide(): Ride | null {
  return (
    rides.find(
      (ride) => ride.status === 'requested' && !declinedRideIds.has(ride.id),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Writes (mirror accept_ride / start_ride / rides_guard semantics, minus
// the network — deliberately no OTP rotation so both screens stay in sync)
// ---------------------------------------------------------------------------

export interface CreateDemoRideInput {
  pickup: LatLng;
  dropoff: LatLng;
  dropoffAddress: string;
  landmarkNotes: string | null;
}

/** Passenger books a trip — fare uses the same estimator the panel displayed. */
export function createDemoRide(input: CreateDemoRideInput): Ride {
  const base = makeDemoRide();
  const ride: Ride = {
    ...base,
    pickup_location: latLngToGeoJson(input.pickup),
    dropoff_location: latLngToGeoJson(input.dropoff),
    dropoff_address: input.dropoffAddress,
    landmark_notes: input.landmarkNotes,
    fare_amount: estimateFare(distanceKm(input.pickup, input.dropoff)).total,
  };
  rides = [...rides, ride];
  emit();
  return ride;
}

/** Driver accepts — mirrors `accept_ride` gates (requested, unassigned). */
export function acceptDemoRide(rideId: string): Ride {
  const ride = getDemoRide(rideId);
  if (!ride || ride.status !== 'requested' || ride.driver_id) {
    throw new Error('That request was already taken');
  }
  return patchRide(rideId, {
    status: 'accepted',
    driver_id: DEMO_DRIVER_ROW.id,
    otp_attempts: 0,
    otp_locked_until: null,
  });
}

/** Driver declines — hides the modal; the request stays bookable by others. */
export function declineDemoRide(rideId: string): void {
  declinedRideIds.add(rideId);
}

/** Status transition with the demo guard rails (driver required to progress). */
export function updateDemoRideStatus(
  rideId: string,
  status: RideStatus,
  extra: Partial<Pick<Ride, 'driver_id' | 'started_at' | 'completed_at'>> = {},
): Ride {
  const ride = getDemoRide(rideId);
  if (!ride) throw new Error('Demo ride not found');
  if (status !== 'requested' && status !== 'cancelled' && !ride.driver_id) {
    throw new Error('No driver assigned to this ride');
  }

  const patch: Partial<Ride> = { status, ...extra };
  if (status === 'in_progress' && !patch.started_at) {
    patch.started_at = new Date().toISOString();
  }
  if (status === 'completed' && !patch.completed_at) {
    patch.completed_at = new Date().toISOString();
  }
  return patchRide(rideId, patch);
}

/**
 * Driver starts the trip — server-side semantics from `start_ride`:
 * attempt counting + lockout, but against the fixed demo code.
 */
export function startDemoRideWithOtp(rideId: string, code: string): Ride {
  const ride = getDemoRide(rideId);
  if (!ride) throw new Error('Demo ride not found');
  if (ride.status !== 'accepted' && ride.status !== 'arrived') {
    throw new Error('Trip is not ready to start');
  }
  if (
    ride.otp_locked_until &&
    new Date(ride.otp_locked_until).getTime() > Date.now()
  ) {
    throw new Error('Too many attempts — trip code locked. Switch roles and retry.');
  }
  if (code !== ride.otp_code) {
    const attempts = ride.otp_attempts + 1;
    const locked = attempts >= 3;
    patchRide(rideId, {
      otp_attempts: attempts,
      otp_locked_until: locked
        ? new Date(Date.now() + 60_000).toISOString()
        : null,
    });
    throw new Error(`Incorrect trip code (${attempts}/3 attempts)`);
  }
  return updateDemoRideStatus(rideId, 'in_progress');
}

// ---------------------------------------------------------------------------
// Demo SOS — straight to the native SMS/phone handoff (no backend to call).
// ---------------------------------------------------------------------------

export async function triggerDemoSos(rideId: string): Promise<SosOutcome> {
  const guardian = DEMO_SAFETY_CIRCLES[0];
  if (!guardian) {
    return { status: 'failed', channel: 'none', detail: 'No Safety Circle contact is configured.' };
  }

  const body = encodeURIComponent(
    `ABTIK SOS: I need help on ride ${rideId}. Please call me now.`,
  );
  const digits = guardian.guardian_phone.replace(/[^\d+]/g, '');
  const candidates: { url: string; channel: 'sms' | 'call' }[] = [
    Platform.OS === 'ios'
      ? { url: `sms:${guardian.guardian_phone}&body=${body}`, channel: 'sms' }
      : { url: `sms:${guardian.guardian_phone}?body=${body}`, channel: 'sms' },
    { url: `tel:${digits}`, channel: 'call' },
  ];

  for (const candidate of candidates) {
    try {
      await Linking.openURL(candidate.url);
      return {
        status: 'fallback',
        channel: candidate.channel,
        detail: `Demo SOS handed off to ${guardian.guardian_name} (${guardian.guardian_phone}) — press send.`,
      };
    } catch {
      // Try the next handoff.
    }
  }

  return {
    status: 'failed',
    channel: 'none',
    detail: 'This device has no SMS/phone app — call campus security or 911 manually.',
  };
}
