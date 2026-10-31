import type { GeoJsonPoint, LatLng } from '@/types/database';

const EARTH_RADIUS_KM = 6371;

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Haversine distance in kilometers */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function geoJsonToLatLng(point: GeoJsonPoint): LatLng {
  const [lng, lat] = point.coordinates;
  return { latitude: lat, longitude: lng };
}

export function latLngToGeoJson(point: LatLng): GeoJsonPoint {
  return {
    type: 'Point',
    coordinates: [point.longitude, point.latitude],
  };
}

/** PostGIS WKT helper for inserts via RPC / raw SQL clients */
export function toWktPoint(point: LatLng): string {
  return `SRID=4326;POINT(${point.longitude} ${point.latitude})`;
}

export function dropoffComplexityLabel(notes: string | null | undefined): {
  label: string;
  level: 'simple' | 'landmark' | 'complex';
} {
  if (!notes || notes.trim().length === 0) {
    return { label: 'Mapped drop-off', level: 'simple' };
  }
  if (notes.length > 80 || /gate|sudlunon|unlit|interior|barangay/i.test(notes)) {
    return { label: 'Complex interior drop-off', level: 'complex' };
  }
  return { label: 'Landmark-assisted', level: 'landmark' };
}
