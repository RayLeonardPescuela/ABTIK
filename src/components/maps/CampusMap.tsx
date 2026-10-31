import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';

import { colors } from '@/theme/colors';
import { geoJsonToLatLng } from '@/utils/geo';
import type { CampusHub, LatLng } from '@/types/database';

interface CampusMapProps {
  hubs: CampusHub[];
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  driverLocation?: LatLng | null;
  onMapPress?: (coord: LatLng) => void;
  initialRegion?: Region;
  showsUserLocation?: boolean;
}

const DEFAULT_REGION: Region = {
  // Replace with your campus centroid
  latitude: 10.3157,
  longitude: 123.8854,
  latitudeDelta: 0.04,
  longitudeDelta: 0.04,
};

export function CampusMap({
  hubs,
  pickup,
  dropoff,
  driverLocation,
  onMapPress,
  initialRegion = DEFAULT_REGION,
  showsUserLocation = true,
}: CampusMapProps) {
  const mapRef = useRef<MapView>(null);

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
          <Marker coordinate={pickup} title="Pickup" pinColor={colors.accent} />
        ) : null}

        {dropoff ? (
          <Marker coordinate={dropoff} title="Drop-off" pinColor={colors.success} />
        ) : null}

        {driverLocation ? (
          <Marker
            coordinate={driverLocation}
            title="Driver"
            pinColor={colors.live}
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
  { elementType: 'geometry', stylers: [{ color: '#0B1220' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9AA8C0' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0B1220' }] },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#1C2740' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#243049' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#071018' }],
  },
  {
    featureType: 'poi',
    stylers: [{ visibility: 'off' }],
  },
];
