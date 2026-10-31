/**
 * ABTIK domain models — mirror of Supabase PostgreSQL schema.
 * Keep synchronized with `supabase/migrations/*.sql`.
 */

/** App identity roles bound to `profiles.role`. */
export type UserRole = 'passenger' | 'driver' | 'guardian';

/** Lifecycle states for a motorcycle ride request. */
export type RideStatus =
  | 'requested'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/** WGS84 coordinate pair used by maps and PostGIS helpers. */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Live GPS sample broadcast on Realtime channel `ride_${rideId}_location`.
 * Also persisted into `trip_location_logs` for guardian replay.
 */
export interface LocationPayload {
  /** Ride UUID owning this sample. */
  rideId: string;
  /** Latitude in decimal degrees. */
  lat: number;
  /** Longitude in decimal degrees. */
  lng: number;
  /** Ground speed in m/s when available. */
  speed: number | null;
  /** Course over ground in degrees when available. */
  heading: number | null;
  /** ISO-8601 timestamp from the device GPS clock. */
  timestamp: string;
}

/** GeoJSON Point as returned by PostGIS via Supabase. Coordinates are `[lng, lat]`. */
export interface GeoJsonPoint {
  type: 'Point';
  coordinates: [number, number];
}

/** Row shape for `public.profiles`. */
export interface Profile {
  id: string;
  full_name: string;
  phone_number: string | null;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
}

/** Row shape for `public.drivers`. */
export interface Driver {
  id: string;
  vehicle_plate: string;
  vehicle_model: string;
  license_number: string;
  is_online: boolean;
  current_location: GeoJsonPoint | null;
  rating: number;
  vetted_status: boolean;
  updated_at: string;
}

/** Row shape for `public.safety_circles`. */
export interface SafetyCircle {
  id: string;
  passenger_id: string;
  guardian_phone: string;
  guardian_name: string;
  relationship: string;
  auto_notify: boolean;
  created_at: string;
}

/** Row shape for `public.rides`. */
export interface Ride {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  pickup_location: GeoJsonPoint;
  pickup_address: string;
  dropoff_location: GeoJsonPoint;
  dropoff_address: string;
  landmark_notes: string | null;
  landmark_image_url: string | null;
  landmark_audio_url: string | null;
  /**
   * 4-digit trip code. Only ever populated for the **passenger** viewer —
   * driver-facing fetches blank it (verification happens server-side in the
   * `start_ride` RPC).
   */
  otp_code: string;
  /** Failed server-side OTP attempts. Managed by `start_ride` only. */
  otp_attempts: number;
  /** Lockout deadline after too many failed OTP attempts. */
  otp_locked_until: string | null;
  fare_amount: number;
  status: RideStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Row shape for `public.trip_location_logs`. */
export interface TripLocationLog {
  id: number;
  ride_id: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  timestamp: string;
}

/** Row shape for `public.campus_hubs`. */
export interface CampusHub {
  id: string;
  name: string;
  campus_code: string;
  location: GeoJsonPoint;
  is_active: boolean;
}

/** Aggregated view model for Active Ride UIs. */
export interface ActiveRideView {
  ride: Ride;
  driver: Driver | null;
  driverProfile: Profile | null;
  safetyCircles: SafetyCircle[];
}

/** Provincial motorcycle fare breakdown (PHP). */
export interface FareEstimate {
  distanceKm: number;
  baseFee: number;
  lateNightSurcharge: number;
  total: number;
  currency: 'PHP';
}
