/**
 * Active trip GPS stream state.
 *
 * TaskManager callbacks run outside React and cannot close over component
 * state, so the publisher for the trip currently in progress lives here.
 * It is shared by:
 *   - src/tasks/driverLocationTask.ts (writes samples from the background task)
 *   - src/hooks/useBackgroundLocation.ts (starts / stops the stream)
 */

import { createRideLocationPublisher, supabase } from '@/lib/supabaseClient';

type Publisher = ReturnType<typeof createRideLocationPublisher>;

/** Refresh `drivers.current_location` every N samples so the nearby-request
 *  feed (5 km RLS radius) stays anchored to where the driver actually is. */
export const DRIVER_LOCATION_REFRESH_EVERY_N_SAMPLES = 15;

let publisher: Publisher | null = null;
let rideId: string | null = null;
let samplesSinceDriverPing = 0;

/** Starts streaming GPS for `nextRideId`, replacing any previous stream. */
export function beginTripStream(nextRideId: string): void {
  void endTripStream();
  publisher = createRideLocationPublisher(nextRideId);
  rideId = nextRideId;
  samplesSinceDriverPing = 0;
}

/** Stops streaming and disposes the Realtime channel. Safe to call twice. */
export async function endTripStream(): Promise<void> {
  const active = publisher;
  publisher = null;
  rideId = null;
  samplesSinceDriverPing = 0;
  if (active) await active.dispose();
}

export interface DriverSample {
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  timestamp: string;
}

/**
 * Publishes one background GPS sample: Realtime broadcast → durable
 * `trip_location_logs` insert → periodic driver-location refresh.
 * No-ops when no trip stream is active (e.g. a late task firing after
 * the trip completed).
 */
export async function publishDriverSample(sample: DriverSample): Promise<void> {
  const active = publisher;
  if (!active || !rideId) return;

  await active.send(sample);

  samplesSinceDriverPing += 1;
  if (samplesSinceDriverPing >= DRIVER_LOCATION_REFRESH_EVERY_N_SAMPLES) {
    samplesSinceDriverPing = 0;
    const { error } = await supabase.rpc('update_driver_location', {
      p_lng: sample.lng,
      p_lat: sample.lat,
      p_is_online: true,
    });
    // Non-fatal: the feed radius is a matching optimisation, not trip data.
    if (error) console.warn('[ABTIK] driver location refresh failed', error.message);
  }
}
