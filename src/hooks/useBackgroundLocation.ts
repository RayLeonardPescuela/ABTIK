/**
 * SECTION 3: Background GPS Tracking Hook
 * ----------------------------------------
 * Streams driver location every ~3 seconds or 10 meters while a trip is
 * `in_progress`. The TaskManager worker itself is registered at app startup
 * (src/tasks/driverLocationTask.ts, imported by app/_layout.tsx) so streaming
 * survives locked screens and OS relaunches; this hook only owns permissions
 * and the start/stop lifecycle.
 *
 * Each sample is:
 *  1. Broadcast on Realtime channel `ride_${rideId}_location`
 *  2. Inserted into `trip_location_logs` for Safety Circle replay
 */

import { useCallback, useState } from 'react';
import * as Location from 'expo-location';

import { beginTripStream, endTripStream } from '@/lib/activeTripStream';
import { ABTIK_DRIVER_BACKGROUND_LOCATION } from '@/tasks/driverLocationTask';

/** Configuration knobs for the background stream. */
export interface UseBackgroundLocationOptions {
  /**
   * Minimum time between GPS samples in milliseconds.
   * @default 3000
   */
  timeIntervalMs?: number;
  /**
   * Minimum distance between GPS samples in meters.
   * @default 10
   */
  distanceIntervalM?: number;
}

/** Public API returned by {@link useBackgroundLocation}. */
export interface UseBackgroundLocationResult {
  /** True while TaskManager location updates are running. */
  isTracking: boolean;
  /** Last permission / stream error message, if any. */
  lastError: string | null;
  /** `true` when Always/Background location is granted. */
  permissionGranted: boolean | null;
  /**
   * Starts background streaming for a ride.
   * @param rideId - Ride UUID currently `in_progress`
   * @returns `true` when streaming actually started (background permission
   *          may be denied, in which case `lastError` explains why).
   */
  startTracking: (rideId: string) => Promise<boolean>;
  /** Stops the background task and disposes the Realtime publisher. */
  stopTracking: () => Promise<void>;
}

/**
 * Driver-side hook that owns background GPS permissions and stream lifecycle.
 *
 * @example
 * ```tsx
 * const { startTracking, isTracking } = useBackgroundLocation();
 * await startTracking(ride.id); // after OTP verification
 * ```
 */
export function useBackgroundLocation(
  options: UseBackgroundLocationOptions = {},
): UseBackgroundLocationResult {
  const { timeIntervalMs = 3000, distanceIntervalM = 10 } = options;

  const [isTracking, setIsTracking] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);

  const ensurePermissions = useCallback(async (): Promise<boolean> => {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== 'granted') {
      setPermissionGranted(false);
      setLastError('Foreground location permission denied');
      return false;
    }

    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== 'granted') {
      setPermissionGranted(false);
      setLastError(
        'Background location denied — Safety Circle requires “Always Allow”',
      );
      return false;
    }

    setPermissionGranted(true);
    return true;
  }, []);

  const stopTracking = useCallback(async () => {
    const started = await Location.hasStartedLocationUpdatesAsync(
      ABTIK_DRIVER_BACKGROUND_LOCATION,
    ).catch(() => false);

    if (started) {
      await Location.stopLocationUpdatesAsync(
        ABTIK_DRIVER_BACKGROUND_LOCATION,
      ).catch((err) => console.warn('[ABTIK] stopLocationUpdates failed', err));
    }

    await endTripStream();
    setIsTracking(false);
  }, []);

  const startTracking = useCallback(
    async (rideId: string): Promise<boolean> => {
      setLastError(null);

      const ok = await ensurePermissions();
      if (!ok) return false;

      await stopTracking();

      beginTripStream(rideId);

      try {
        await Location.startLocationUpdatesAsync(ABTIK_DRIVER_BACKGROUND_LOCATION, {
          accuracy: Location.Accuracy.High,
          timeInterval: timeIntervalMs,
          distanceInterval: distanceIntervalM,
          showsBackgroundLocationIndicator: true,
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.AutomotiveNavigation,
          foregroundService: {
            notificationTitle: 'ABTIK Trip Active',
            notificationBody:
              'Live location is sharing with the passenger Safety Circle.',
            notificationColor: '#F5A524',
          },
        });
      } catch (err) {
        await endTripStream();
        const message =
          err instanceof Error ? err.message : 'Failed to start GPS updates';
        setLastError(message);
        return false;
      }

      setIsTracking(true);
      return true;
    },
    [distanceIntervalM, ensurePermissions, stopTracking, timeIntervalMs],
  );

  return {
    isTracking,
    lastError,
    permissionGranted,
    startTracking,
    stopTracking,
  };
}
