/**
 * Driver background location task.
 *
 * `TaskManager.defineTask` must run during app initialization — a task that
 * fires after the OS relaunches the app headless (locked screen, killed app)
 * cannot be registered from a screen module. `app/_layout.tsx` imports this
 * module for its side effect, so registration always happens at startup.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { publishDriverSample } from '@/lib/activeTripStream';

/**
 * Stable TaskManager identifier for the driver background location worker.
 * Do not rename without migrating installed builds.
 */
export const ABTIK_DRIVER_BACKGROUND_LOCATION = 'ABTIK_DRIVER_BACKGROUND_LOCATION';

if (!TaskManager.isTaskDefined(ABTIK_DRIVER_BACKGROUND_LOCATION)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
    ABTIK_DRIVER_BACKGROUND_LOCATION,
    async ({ data, error }) => {
      if (error) {
        console.error('[ABTIK] Background location task error', error);
        return;
      }

      const locations = data?.locations;
      const latest = locations?.[locations.length - 1];
      if (!latest) return;

      try {
        await publishDriverSample({
          lat: latest.coords.latitude,
          lng: latest.coords.longitude,
          speed: latest.coords.speed,
          heading: latest.coords.heading,
          timestamp: new Date(latest.timestamp).toISOString(),
        });
      } catch (err) {
        console.error('[ABTIK] Failed to publish background location', err);
      }
    },
  );
}
