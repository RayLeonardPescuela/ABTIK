import { useEffect, useState } from 'react';

import { subscribeToRideLocation } from '@/lib/supabaseClient';
import type { LocationPayload, LatLng } from '@/types/database';

/** No GPS sample for this long ⇒ stop claiming the stream is live. */
const STREAM_STALE_MS = 15000;
/** How often to re-check freshness while samples are expected. */
const FRESHNESS_CHECK_MS = 5000;

/**
 * Passenger / guardian hook — consumes Realtime broadcast of driver GPS.
 *
 * - `isLive`   — the channel reports SUBSCRIBED
 * - `isFresh`  — a sample arrived within {@link STREAM_STALE_MS} (and expires
 *                on a timer when the driver's stream dies)
 * - `lastSampleAt` — epoch ms of the newest sample, for custom staleness UI
 *
 * All state updates happen inside subscription callbacks or timers, never in
 * an effect body (React "no setState during effect" rule).
 */
export function useRideLocation(rideId: string | null | undefined) {
  const [location, setLocation] = useState<LatLng | null>(null);
  const [lastSample, setLastSample] = useState<LocationPayload | null>(null);
  const [lastSampleAt, setLastSampleAt] = useState<number | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [isFresh, setIsFresh] = useState(false);

  useEffect(() => {
    if (!rideId) return;

    const unsubscribe = subscribeToRideLocation(
      rideId,
      (payload) => {
        const receivedAt = Date.now();
        setLastSample(payload);
        setLastSampleAt(receivedAt);
        setLocation({ latitude: payload.lat, longitude: payload.lng });
        setIsFresh(true);
      },
      (status) => setIsLive(status === 'SUBSCRIBED'),
    );

    return () => {
      unsubscribe();
    };
  }, [rideId]);

  // Expiry: the interval callback flips `isFresh` off once samples stop.
  // Recreated when a new sample lands (so a flowing stream never expires).
  useEffect(() => {
    if (!rideId || !lastSampleAt) return;

    const timer = setInterval(() => {
      setIsFresh(Date.now() - lastSampleAt < STREAM_STALE_MS);
    }, FRESHNESS_CHECK_MS);

    return () => clearInterval(timer);
  }, [rideId, lastSampleAt]);

  return { location, lastSample, lastSampleAt, isLive, isFresh };
}
