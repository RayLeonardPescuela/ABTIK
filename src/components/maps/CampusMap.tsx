import React, { useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  Region,
} from 'react-native-maps';

import { DarkFallbackMap } from '@/components/maps/DarkFallbackMap';
import { colors } from '@/theme/colors';
import { geoJsonToLatLng } from '@/utils/geo';
import type { CampusHub, LatLng } from '@/types/database';

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

const DEFAULT_REGION: Region = {
  // Provincial Campus centroid (Toledo City area)
  latitude: 10.3157,
  longitude: 123.8854,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

/**
 * Reads the platform Google Maps SDK key from app.json (via expo-constants).
 * Placeholder values (`YOUR_...`) count as missing — local dev and Expo Go
 * demos run without a key, so Google tiles would never load.
 */
function readGoogleMapsApiKey(): string | null {
  const config = Constants.expoConfig;
  const androidKey = (
    config?.android as
      | { config?: { googleMaps?: { apiKey?: string } } }
      | undefined
  )?.config?.googleMaps?.apiKey;
  const iosKey = (
    config?.ios as { config?: { googleMapsApiKey?: string } } | undefined
  )?.config?.googleMapsApiKey;
  const key = Platform.OS === 'ios' ? iosKey : androidKey;
  const trimmed = typeof key === 'string' ? key.trim() : '';
  return trimmed.length > 0 && !trimmed.startsWith('YOUR_') ? trimmed : null;
}

const googleMapsApiKey = readGoogleMapsApiKey();

export function CampusMap({
  hubs,
  pickup,
  dropoff,
  driverLocation,
  nearbyDrivers,
  onMapPress,
  initialRegion = DEFAULT_REGION,
  showsUserLocation = true,
}: CampusMapProps) {
  const mapRef = useRef<MapView>(null);

  // No SDK key configured (local dev / Expo Go demo): swap blank Google
  // tiles for the styled dark vector preview — same markers, same tap flow.
  if (!googleMapsApiKey) {
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

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        customMapStyle={DARK_MAP_STYLE}
        showsUserLocation={showsUserLocation}
        showsMyLocationButton={false}
        onPress={(e) => {
          if (!onMapPress) return;
          const { latitude, longitude } = e.nativeEvent.coordinate;
          onMapPress({ latitude, longitude });
        }}
      >
        {hubs.map((hub) => {
          const coord = geoJsonToLatLng(hub.location);
          return (
            <Marker
              key={hub.id}
              coordinate={coord}
              title={hub.name}
              description="Campus pickup hub"
              pinColor={colors.info}
            />
          );
        })}

        {pickup ? (
          <Marker
            coordinate={pickup}
            title="Current Location"
            description="Campus / Workplace"
            pinColor={colors.accent}
          />
        ) : null}

        {dropoff ? (
          <Marker
            coordinate={dropoff}
            title="Destination Pin"
            description="Interior home gate"
            pinColor={colors.success}
          />
        ) : null}

        {driverLocation ? (
          <Marker
            coordinate={driverLocation}
            title="Verified driver"
            pinColor={colors.live}
          />
        ) : null}

        {nearbyDrivers?.map((coord, index) => (
          <Marker
            key={`nearby-${index}`}
            coordinate={coord}
            title="Verified local driver"
            description="Habal-habal on standby"
            pinColor={colors.live}
          />
        ))}

        {pickup && dropoff ? (
          <Polyline
            coordinates={[pickup, dropoff]}
            strokeColor={colors.accent}
            strokeWidth={3}
          />
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.mapRoad,
  },
});

/** Night-oriented Google Maps style — keeps interior roads readable */
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: colors.bg }] },
  { elementType: 'labels.text.fill', stylers: [{ color: colors.textMuted }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: colors.bg }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: colors.mapRoad }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: colors.border }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#071024' }],
  },
  {
    featureType: 'poi',
    stylers: [{ visibility: 'off' }],
  },
];
