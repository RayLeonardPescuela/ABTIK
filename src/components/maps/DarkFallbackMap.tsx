import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { geoJsonToLatLng } from '@/utils/geo';
import type { CampusHub, LatLng } from '@/types/database';

/**
 * Keyless dark map — rendered whenever no Google Maps SDK key is configured
 * (local dev, Expo Go demos). A stylized midnight-navy vector preview
 * centered on the Provincial Campus / Toledo City area keeps the booking
 * flow fully interactive (tap-to-pin, markers, estimated route) without
 * ever waiting on tile loading.
 */

interface FallbackRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

interface DarkFallbackMapProps {
  hubs: CampusHub[];
  pickup?: LatLng | null;
  dropoff?: LatLng | null;
  driverLocation?: LatLng | null;
  nearbyDrivers?: LatLng[];
  onMapPress?: (coord: LatLng) => void;
  initialRegion: FallbackRegion;
}

type MarkerTone = 'pickup' | 'destination' | 'driver';

const GRID_LINES = [1, 2, 3, 4] as const;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Labeled pin: emoji chip + accent stem anchored on the coordinate. */
function MapChip({
  position,
  tone,
  icon,
  label,
  sub,
}: {
  position: { left: number; top: number };
  tone: MarkerTone;
  icon: string;
  label: string;
  sub: string;
}) {
  const accent =
    tone === 'destination'
      ? colors.success
      : tone === 'driver'
        ? colors.live
        : colors.accent;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.chipWrap,
        { left: `${position.left}%`, top: `${position.top}%` },
      ]}
    >
      <View style={[styles.chip, { borderColor: accent }]}>
        <Text style={styles.chipIcon}>{icon}</Text>
        <View style={styles.chipTexts}>
          <Text style={styles.chipLabel} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.chipSub} numberOfLines={1}>
            {sub}
          </Text>
        </View>
      </View>
      <View style={[styles.chipStem, { backgroundColor: accent }]} />
      <View style={[styles.chipAnchor, { borderColor: accent }]} />
    </View>
  );
}

export function DarkFallbackMap({
  hubs,
  pickup,
  dropoff,
  driverLocation,
  nearbyDrivers = [],
  onMapPress,
  initialRegion,
}: DarkFallbackMapProps) {
  const center = {
    latitude: initialRegion.latitude,
    longitude: initialRegion.longitude,
  };
  const latSpan = initialRegion.latitudeDelta;
  const lngSpan = initialRegion.longitudeDelta;
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  /** Projects a coordinate to clamped canvas percentages. */
  const project = (coord: LatLng) => ({
    left: clamp(
      ((coord.longitude - center.longitude) / lngSpan + 0.5) * 100,
      3,
      97,
    ),
    top: clamp(
      ((center.latitude - coord.latitude) / latSpan + 0.5) * 100,
      5,
      95,
    ),
  });

  // Estimated route: evenly spaced accent dots between pickup and drop-off.
  const routeDots =
    pickup && dropoff
      ? Array.from({ length: 12 }, (_, index) => {
          const t = (index + 1) / 13;
          return {
            latitude:
              pickup.latitude + (dropoff.latitude - pickup.latitude) * t,
            longitude:
              pickup.longitude + (dropoff.longitude - pickup.longitude) * t,
          };
        })
      : [];

  return (
    <Pressable
      style={styles.canvas}
      onLayout={(event) =>
        setCanvasSize({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        })
      }
      onPress={(event) => {
        // Tap-to-pin keeps working without real tiles: invert the projection.
        if (!onMapPress || canvasSize.width === 0 || canvasSize.height === 0) {
          return;
        }
        const { locationX, locationY } = event.nativeEvent;
        onMapPress({
          latitude:
            center.latitude - (locationY / canvasSize.height - 0.5) * latSpan,
          longitude:
            center.longitude + (locationX / canvasSize.width - 0.5) * lngSpan,
        });
      }}
    >
      {/* Survey grid */}
      {GRID_LINES.map((index) => (
        <View
          key={`v-${index}`}
          pointerEvents="none"
          style={[styles.gridV, { left: `${index * 20}%` }]}
        />
      ))}
      {GRID_LINES.map((index) => (
        <View
          key={`h-${index}`}
          pointerEvents="none"
          style={[styles.gridH, { top: `${index * 20}%` }]}
        />
      ))}

      {/* Campus grounds + arterial roads */}
      <View pointerEvents="none" style={styles.campusZone}>
        <Text style={styles.campusZoneLabel}>CAMPUS ZONE</Text>
      </View>
      <View pointerEvents="none" style={[styles.road, styles.roadHighway]} />
      <View pointerEvents="none" style={[styles.road, styles.roadInterior]} />

      {/* Estimated route to the interior drop-off */}
      {routeDots.map((dot, index) => {
        const pos = project(dot);
        return (
          <View
            key={`route-${index}`}
            pointerEvents="none"
            style={[
              styles.routeDot,
              { left: `${pos.left}%`, top: `${pos.top}%` },
            ]}
          />
        );
      })}

      {/* Pickup hubs */}
      {hubs.map((hub) => {
        const pos = project(geoJsonToLatLng(hub.location));
        return (
          <View
            key={hub.id}
            pointerEvents="none"
            style={[styles.hubDot, { left: `${pos.left}%`, top: `${pos.top}%` }]}
          />
        );
      })}

      {/* 🛵 Unclaimed verified local drivers */}
      {nearbyDrivers.map((driver, index) => {
        const pos = project(driver);
        return (
          <View
            key={`nearby-${index}`}
            pointerEvents="none"
            style={[
              styles.driverDot,
              { left: `${pos.left}%`, top: `${pos.top}%` },
            ]}
          >
            <Text style={styles.driverDotEmoji}>🛵</Text>
            <View style={styles.driverVerified} />
          </View>
        );
      })}

      {/* Labeled pins */}
      {pickup ? (
        <MapChip
          position={project(pickup)}
          tone="pickup"
          icon="🏫"
          label="Current Location"
          sub="Campus / Workplace"
        />
      ) : null}
      {dropoff ? (
        <MapChip
          position={project(dropoff)}
          tone="destination"
          icon="🏠"
          label="Destination Pin"
          sub="Interior home gate"
        />
      ) : null}
      {driverLocation ? (
        <MapChip
          position={project(driverLocation)}
          tone="driver"
          icon="🛵"
          label="Verified Driver"
          sub="En route"
        />
      ) : null}

      <View pointerEvents="none" style={styles.attribution}>
        <Text style={styles.attributionText}>
          Provincial Campus · Toledo City · offline preview
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    backgroundColor: colors.bgElevated, // deep navy per design spec
    overflow: 'hidden',
  },
  gridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.borderSoft,
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.borderSoft,
  },
  campusZone: {
    position: 'absolute',
    left: '30%',
    top: '34%',
    width: '40%',
    height: '30%',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accentBorder,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
  },
  campusZoneLabel: {
    position: 'absolute',
    top: 4,
    left: 8,
    color: colors.accent,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
  },
  road: {
    position: 'absolute',
    backgroundColor: colors.mapRoad,
    borderRadius: 5,
  },
  roadHighway: {
    left: '-8%',
    right: '-8%',
    top: '63%',
    height: 9,
    opacity: 0.9,
    transform: [{ rotate: '-4deg' }],
  },
  roadInterior: {
    left: '18%',
    right: '18%',
    top: '50%',
    height: 5,
    opacity: 0.7,
    transform: [{ rotate: '24deg' }],
  },
  routeDot: {
    position: 'absolute',
    width: 7,
    height: 7,
    marginLeft: -3.5,
    marginTop: -3.5,
    borderRadius: 4,
    backgroundColor: colors.accent,
    opacity: 0.9,
  },
  hubDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    marginLeft: -5,
    marginTop: -5,
    borderRadius: 5,
    backgroundColor: colors.info,
    borderWidth: 2,
    borderColor: colors.bgElevated,
  },
  driverDot: {
    position: 'absolute',
    width: 30,
    height: 30,
    marginLeft: -15,
    marginTop: -15,
    borderRadius: 15,
    backgroundColor: colors.bgPanel,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverDotEmoji: {
    fontSize: 14,
  },
  driverVerified: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.live,
    borderWidth: 1.5,
    borderColor: colors.bgElevated,
  },
  chipWrap: {
    position: 'absolute',
    width: 150,
    height: 60,
    marginLeft: -75,
    marginTop: -60,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 150,
    backgroundColor: colors.bgElevated,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  chipIcon: {
    fontSize: 14,
  },
  chipTexts: {
    flexShrink: 1,
  },
  chipLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
  },
  chipSub: {
    color: colors.textDim,
    fontSize: 9,
  },
  chipStem: {
    width: 2,
    height: 8,
    borderRadius: 1,
  },
  chipAnchor: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    backgroundColor: colors.bgElevated,
  },
  attribution: {
    position: 'absolute',
    bottom: 8,
    left: 10,
  },
  attributionText: {
    color: colors.textDim,
    fontSize: 9,
    letterSpacing: 0.4,
  },
});
