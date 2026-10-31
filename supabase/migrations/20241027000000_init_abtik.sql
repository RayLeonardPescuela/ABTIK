-- =============================================================================
-- SECTION 1: ABTIK Database Migration
-- Smart Campus & Provincial Mobility — Supabase PostgreSQL + PostGIS
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- -----------------------------------------------------------------------------
-- Custom ENUM types
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('passenger', 'driver', 'guardian');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.ride_status AS ENUM (
    'requested',
    'accepted',
    'arrived',
    'in_progress',
    'completed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- profiles — 1:1 with auth.users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  phone_number  TEXT UNIQUE,
  avatar_url    TEXT,
  role          public.user_role NOT NULL DEFAULT 'passenger',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- drivers — motorcycle operator profile + live geography point
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drivers (
  id               UUID PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  vehicle_plate    TEXT NOT NULL,
  vehicle_model    TEXT NOT NULL,
  license_number   TEXT NOT NULL UNIQUE,
  is_online        BOOLEAN NOT NULL DEFAULT FALSE,
  current_location GEOGRAPHY(POINT, 4326),
  rating           NUMERIC(3, 2) NOT NULL DEFAULT 5.00
                   CHECK (rating >= 0 AND rating <= 5),
  vetted_status    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- safety_circles — Life360-style guardians for night trips
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.safety_circles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id   UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  guardian_phone TEXT NOT NULL,
  guardian_name  TEXT NOT NULL,
  relationship   TEXT NOT NULL DEFAULT 'family',
  auto_notify    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT safety_circles_passenger_phone_unique UNIQUE (passenger_id, guardian_phone)
);

-- -----------------------------------------------------------------------------
-- rides — campus pickup → sudlunon drop-off with OTP + landmark notes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rides (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id       UUID NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  driver_id          UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  pickup_location    GEOGRAPHY(POINT, 4326) NOT NULL,
  pickup_address     TEXT NOT NULL,
  dropoff_location   GEOGRAPHY(POINT, 4326) NOT NULL,
  dropoff_address    TEXT NOT NULL,
  landmark_notes     TEXT,
  landmark_image_url TEXT,
  landmark_audio_url TEXT,
  otp_code           VARCHAR(4) NOT NULL,
  fare_amount        NUMERIC(10, 2) NOT NULL CHECK (fare_amount >= 0),
  status             public.ride_status NOT NULL DEFAULT 'requested',
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- trip_location_logs — durable GPS telemetry for Safety Circle / forensics
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trip_location_logs (
  id          BIGSERIAL PRIMARY KEY,
  ride_id     UUID NOT NULL REFERENCES public.rides (id) ON DELETE CASCADE,
  lat         DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  speed       DOUBLE PRECISION,
  heading     DOUBLE PRECISION,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional campus hub pins for Home map
CREATE TABLE IF NOT EXISTS public.campus_hubs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  campus_code TEXT NOT NULL,
  location    GEOGRAPHY(POINT, 4326) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- -----------------------------------------------------------------------------
-- GiST spatial indexes + hot-path indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS drivers_online_gist_idx
  ON public.drivers USING GIST (current_location)
  WHERE is_online = TRUE;

CREATE INDEX IF NOT EXISTS drivers_is_online_idx
  ON public.drivers (is_online)
  WHERE is_online = TRUE;

CREATE INDEX IF NOT EXISTS rides_pickup_gist_idx
  ON public.rides USING GIST (pickup_location);

CREATE INDEX IF NOT EXISTS rides_dropoff_gist_idx
  ON public.rides USING GIST (dropoff_location);

CREATE INDEX IF NOT EXISTS rides_status_idx
  ON public.rides (status);

CREATE INDEX IF NOT EXISTS rides_passenger_created_idx
  ON public.rides (passenger_id, created_at DESC);

CREATE INDEX IF NOT EXISTS rides_driver_active_idx
  ON public.rides (driver_id, status)
  WHERE status IN ('accepted', 'arrived', 'in_progress');

CREATE INDEX IF NOT EXISTS trip_logs_ride_ts_idx
  ON public.trip_location_logs (ride_id, "timestamp" DESC);

CREATE INDEX IF NOT EXISTS safety_circles_passenger_idx
  ON public.safety_circles (passenger_id);

CREATE INDEX IF NOT EXISTS campus_hubs_gist_idx
  ON public.campus_hubs USING GIST (location);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_set_updated_at ON public.rides;
CREATE TRIGGER rides_set_updated_at
  BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS drivers_set_updated_at ON public.drivers;
CREATE TRIGGER drivers_set_updated_at
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone_number, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', 'ABTIK User'),
    NEW.phone,
    COALESCE((NEW.raw_user_meta_data ->> 'role')::public.user_role, 'passenger')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.generate_ride_otp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.otp_code IS NULL OR NEW.otp_code = '' THEN
    NEW.otp_code := LPAD((FLOOR(RANDOM() * 10000))::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_generate_otp ON public.rides;
CREATE TRIGGER rides_generate_otp
  BEFORE INSERT ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.generate_ride_otp();

-- Nearest online vetted drivers (PostGIS KNN)
CREATE OR REPLACE FUNCTION public.find_nearby_drivers(
  p_pickup GEOGRAPHY,
  p_radius_meters DOUBLE PRECISION DEFAULT 5000,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  driver_id UUID,
  distance_meters DOUBLE PRECISION,
  rating NUMERIC,
  vehicle_plate TEXT,
  vehicle_model TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    d.id AS driver_id,
    ST_Distance(d.current_location, p_pickup) AS distance_meters,
    d.rating,
    d.vehicle_plate,
    d.vehicle_model
  FROM public.drivers d
  WHERE d.is_online = TRUE
    AND d.vetted_status = TRUE
    AND d.current_location IS NOT NULL
    AND ST_DWithin(d.current_location, p_pickup, p_radius_meters)
  ORDER BY d.current_location <-> p_pickup
  LIMIT p_limit;
$$;

-- Safe geography inserts from the mobile client
CREATE OR REPLACE FUNCTION public.create_ride(
  p_passenger_id UUID,
  p_pickup_lng DOUBLE PRECISION,
  p_pickup_lat DOUBLE PRECISION,
  p_pickup_address TEXT,
  p_dropoff_lng DOUBLE PRECISION,
  p_dropoff_lat DOUBLE PRECISION,
  p_dropoff_address TEXT,
  p_landmark_notes TEXT DEFAULT NULL,
  p_landmark_image_url TEXT DEFAULT NULL,
  p_fare_amount NUMERIC DEFAULT 40
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_ride public.rides;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_passenger_id THEN
    RAISE EXCEPTION 'passenger_id must match authenticated user';
  END IF;

  INSERT INTO public.rides (
    passenger_id,
    pickup_location,
    pickup_address,
    dropoff_location,
    dropoff_address,
    landmark_notes,
    landmark_image_url,
    otp_code,
    fare_amount,
    status
  ) VALUES (
    p_passenger_id,
    ST_SetSRID(ST_MakePoint(p_pickup_lng, p_pickup_lat), 4326)::geography,
    p_pickup_address,
    ST_SetSRID(ST_MakePoint(p_dropoff_lng, p_dropoff_lat), 4326)::geography,
    p_dropoff_address,
    p_landmark_notes,
    p_landmark_image_url,
    LPAD((FLOOR(RANDOM() * 10000))::TEXT, 4, '0'),
    p_fare_amount,
    'requested'
  )
  RETURNING * INTO new_ride;

  RETURN new_ride;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_ride TO authenticated;

CREATE OR REPLACE FUNCTION public.update_driver_location(
  p_lng DOUBLE PRECISION,
  p_lat DOUBLE PRECISION,
  p_is_online BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.drivers
  SET
    current_location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    is_online = p_is_online,
    updated_at = NOW()
  WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_driver_location TO authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_location_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_hubs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_or_ride_peer" ON public.profiles;
CREATE POLICY "profiles_select_own_or_ride_peer"
  ON public.profiles FOR SELECT
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE (r.passenger_id = auth.uid() AND r.driver_id = profiles.id)
         OR (r.driver_id = auth.uid() AND r.passenger_id = profiles.id)
    )
  );

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "drivers_select_authenticated" ON public.drivers;
CREATE POLICY "drivers_select_authenticated"
  ON public.drivers FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "drivers_upsert_own" ON public.drivers;
CREATE POLICY "drivers_upsert_own"
  ON public.drivers FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "safety_circles_owner_all" ON public.safety_circles;
CREATE POLICY "safety_circles_owner_all"
  ON public.safety_circles FOR ALL
  USING (passenger_id = auth.uid())
  WITH CHECK (passenger_id = auth.uid());

DROP POLICY IF EXISTS "safety_circles_guardian_select" ON public.safety_circles;
CREATE POLICY "safety_circles_guardian_select"
  ON public.safety_circles FOR SELECT
  USING (
    guardian_phone = (SELECT phone_number FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "rides_select_participants" ON public.rides;
CREATE POLICY "rides_select_participants"
  ON public.rides FOR SELECT
  USING (
    passenger_id = auth.uid()
    OR driver_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.safety_circles sc
      JOIN public.profiles g ON g.phone_number = sc.guardian_phone
      WHERE sc.passenger_id = rides.passenger_id
        AND g.id = auth.uid()
        AND rides.status IN ('accepted', 'arrived', 'in_progress')
    )
  );

DROP POLICY IF EXISTS "rides_insert_passenger" ON public.rides;
CREATE POLICY "rides_insert_passenger"
  ON public.rides FOR INSERT
  WITH CHECK (passenger_id = auth.uid());

DROP POLICY IF EXISTS "rides_update_participants" ON public.rides;
CREATE POLICY "rides_update_participants"
  ON public.rides FOR UPDATE
  USING (passenger_id = auth.uid() OR driver_id = auth.uid())
  WITH CHECK (passenger_id = auth.uid() OR driver_id = auth.uid());

DROP POLICY IF EXISTS "trip_logs_select_circle" ON public.trip_location_logs;
CREATE POLICY "trip_logs_select_circle"
  ON public.trip_location_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = trip_location_logs.ride_id
        AND (
          r.passenger_id = auth.uid()
          OR r.driver_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.safety_circles sc
            JOIN public.profiles g ON g.phone_number = sc.guardian_phone
            WHERE sc.passenger_id = r.passenger_id AND g.id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "trip_logs_insert_driver" ON public.trip_location_logs;
CREATE POLICY "trip_logs_insert_driver"
  ON public.trip_location_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = ride_id
        AND r.driver_id = auth.uid()
        AND r.status = 'in_progress'
    )
  );

DROP POLICY IF EXISTS "campus_hubs_select" ON public.campus_hubs;
CREATE POLICY "campus_hubs_select"
  ON public.campus_hubs FOR SELECT
  TO authenticated
  USING (is_active = TRUE);

-- -----------------------------------------------------------------------------
-- Realtime publication (location streaming + ride status)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_location_logs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
