import React from 'react';

import { DarkFallbackMap } from '@/components/maps/DarkFallbackMap';
import type { CampusHub, LatLng } from '@/types/database';

/** Matches react-native-maps' Region shape without importing it (web build). */
interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

const DEFAULT_REGION: Region = {
  // Provincial Campus centroid (Toledo City area) — same as native CampusMap
  latitude: 10.3157,
  longitude: 123.8854,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

interface CampusMapProps {
  hubs: CampusHub[];
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  driverLocation?: LatLng | null;
  /** Unclaimed verified drivers shown as a local-radar cluster. */
  nearbyDrivers?: LatLng[];
  onMapPress?: (coord: LatLng) => void;
  initialRegion?: Region;
  showsUserLocation?: boolean;
}

/**
 * Web build of CampusMap.
 *
 * `react-native-maps` is native-only (Google Maps SDK / Apple Maps), so the
 * web bundle must never import it. Metro resolves this `.web.tsx` file ahead
 * of `CampusMap.tsx` when `platform=web`, keeping the interactive dark
 * vector preview (markers + tap-to-pin) as the browser experience.
 */
export function CampusMap({
  hubs,
  pickup,
  dropoff,
  driverLocation,
  nearbyDrivers,
  onMapPress,
  initialRegion = DEFAULT_REGION,
}: CampusMapProps) {
  return (
    <DarkFallbackMap
      hubs={hubs}
      pickup={pickup}
      dropoff={dropoff}
      driverLocation={driverLocation}
      nearbyDrivers={nearbyDrivers}
      onMapPress={onMapPress}
      initialRegion={initialRegion}
    />
  );
}
