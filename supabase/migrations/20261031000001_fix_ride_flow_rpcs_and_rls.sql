-- =============================================================================
-- ABTIK — 20261031000001_fix_ride_flow_rpcs_and_rls.sql
-- Phase 1: ride-flow RPCs, RLS corrections and server-side fare
--
--  1. accept_ride(p_ride_id)   — vetted + online drivers accept requested rides
--                                (fixes the RLS deadlock in the old client UPDATE)
--  2. start_ride(p_ride_id, p_otp) — server-side OTP verification with an
--                                attempt counter / lockout. Never raises on a
--                                wrong code so failed attempts actually persist.
--  3. create_ride(...)         — fare computed with PostGIS ST_Distance +
--                                LGU surcharge; p_fare_amount removed (clients
--                                can no longer set their own price).
--  4. RLS                      — nearby requested-ride feed for online vetted
--                                drivers, guardian trip logs scoped to active
--                                rides, driver rows no longer world-readable,
--                                rides INSERT forced through create_ride().
--  5. Hardening                — ride column immutability + status transition
--                                guard, admin-only vetting/rating, crypto
--                                strong OTP that rotates on acceptance,
--                                find_nearby_drivers locked to authenticated.
--
-- Run AFTER 20241027000000_init_abtik.sql.
-- (20241027000001_create_ride_rpc.sql has been deleted: it duplicated init.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECTION 1 — Schema deltas: OTP brute-force protection
-- -----------------------------------------------------------------------------
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS otp_attempts     SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE public.rides ADD COLUMN IF NOT EXISTS otp_locked_until TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rides_otp_attempts_nonneg'
  ) THEN
    ALTER TABLE public.rides
      ADD CONSTRAINT rides_otp_attempts_nonneg CHECK (otp_attempts >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.rides.otp_attempts IS
  'Failed start_ride() attempts since the current OTP was issued.';
COMMENT ON COLUMN public.rides.otp_locked_until IS
  'When set, start_ride() refuses to verify until this moment.';

-- -----------------------------------------------------------------------------
-- SECTION 2 — Server-side fare model
--   Keep the constants in sync with the display-only estimate in
--   src/constants/fare.ts (base 25, 12/km, +15 between 21:00-05:00 PHT, min 40).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_fare(
  p_pickup GEOGRAPHY,
  p_dropoff GEOGRAPHY,
  p_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_km NUMERIC;
  v_hour INTEGER;
  v_surcharge NUMERIC := 0;
BEGIN
  IF p_pickup IS NULL OR p_dropoff IS NULL THEN
    RETURN 40;
  END IF;

  v_km := (ST_Distance(p_pickup, p_dropoff) / 1000.0)::NUMERIC;

  -- ABTIK operates on Philippine time regardless of the database server TZ.
  v_hour := EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Asia/Manila'))::INTEGER;
  IF v_hour >= 21 OR v_hour < 5 THEN
    v_surcharge := 15;
  END IF;

  RETURN GREATEST(40, ROUND(25 + (v_km * 12) + v_surcharge));
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_fare(GEOGRAPHY, GEOGRAPHY, TIMESTAMPTZ) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.compute_fare(GEOGRAPHY, GEOGRAPHY, TIMESTAMPTZ)
  FROM PUBLIC, anon;

-- -----------------------------------------------------------------------------
-- SECTION 3 — Crypto-strong OTP helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_otp()
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT LPAD(
    (
      (
        get_byte(gen_random_bytes(1), 0)::BIGINT * 16777216 +
        get_byte(gen_random_bytes(1), 0)::BIGINT * 65536 +
        get_byte(gen_random_bytes(1), 0)::BIGINT * 256 +
        get_byte(gen_random_bytes(1), 0)::BIGINT
      ) % 10000
    )::TEXT,
    4,
    '0'
  );
$$;

-- Replace the RANDOM()-based generator with the pgcrypto-backed one.
CREATE OR REPLACE FUNCTION public.generate_ride_otp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.otp_code IS NULL OR NEW.otp_code = '' THEN
    NEW.otp_code := public.generate_otp();
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- SECTION 4 — create_ride(): fare is computed in the database
--   The p_fare_amount parameter is intentionally dropped: a client-supplied
--   price would make the server-side fare model meaningless.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_ride(
  UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT, NUMERIC
);

CREATE OR REPLACE FUNCTION public.create_ride(
  p_passenger_id      UUID,
  p_pickup_lng        DOUBLE PRECISION,
  p_pickup_lat        DOUBLE PRECISION,
  p_pickup_address    TEXT,
  p_dropoff_lng       DOUBLE PRECISION,
  p_dropoff_lat       DOUBLE PRECISION,
  p_dropoff_address   TEXT,
  p_landmark_notes    TEXT DEFAULT NULL,
  p_landmark_image_url TEXT DEFAULT NULL
)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pickup  GEOGRAPHY;
  v_dropoff GEOGRAPHY;
  v_ride    public.rides;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_passenger_id THEN
    RAISE EXCEPTION 'passenger_id must match authenticated user';
  END IF;

  IF p_pickup_lat IS NULL OR p_pickup_lng IS NULL
     OR p_dropoff_lat IS NULL OR p_dropoff_lng IS NULL
     OR p_pickup_lat  NOT BETWEEN -90 AND 90
     OR p_dropoff_lat  NOT BETWEEN -90 AND 90
     OR p_pickup_lng   NOT BETWEEN -180 AND 180
     OR p_dropoff_lng  NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'invalid pickup/drop-off coordinates';
  END IF;

  v_pickup  := ST_SetSRID(ST_MakePoint(p_pickup_lng,  p_pickup_lat),  4326)::geography;
  v_dropoff := ST_SetSRID(ST_MakePoint(p_dropoff_lng, p_dropoff_lat), 4326)::geography;

  INSERT INTO public.rides (
    passenger_id,
    pickup_location,
    pickup_address,
    dropoff_location,
    dropoff_address,
    landmark_notes,
    landmark_image_url,
    fare_amount,
    status
  ) VALUES (
    p_passenger_id,
    v_pickup,
    p_pickup_address,
    v_dropoff,
    p_dropoff_address,
    p_landmark_notes,
    p_landmark_image_url,
    public.compute_fare(v_pickup, v_dropoff),
    'requested'
  )
  RETURNING * INTO v_ride;

  RETURN v_ride;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_ride(
  UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ride(
  UUID, DOUBLE PRECISION, DOUBLE PRECISION, TEXT,
  DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT, TEXT
) TO authenticated;

-- -----------------------------------------------------------------------------
-- SECTION 5 — accept_ride(): the single, race-safe way to assign a driver
--   The old client-side UPDATE could never work: rides_update_participants
--   requires the *existing* row to belong to the caller, and a 'requested'
--   ride belongs to the passenger. This RPC is SECURITY DEFINER.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_ride(p_ride_id UUID)
RETURNS public.rides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver public.drivers;
  v_ride   public.rides;
  v_radius CONSTANT DOUBLE PRECISION := 5000; -- must match rides_select_requested_feed
BEGIN
  PERFORM set_config('abtik.internal', '1', true);

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no driver profile for this account';
  END IF;
  IF NOT v_driver.vetted_status THEN
    RAISE EXCEPTION 'driver is not vetted yet';
  END IF;
  IF NOT v_driver.is_online THEN
    RAISE EXCEPTION 'go online before accepting rides';
  END IF;
  IF v_driver.current_location IS NULL THEN
    RAISE EXCEPTION 'driver location unavailable — toggle online again';
  END IF;

  UPDATE public.rides
     SET driver_id = auth.uid(),
         status    = 'accepted',
         otp_code  = public.generate_otp(), -- rotate: any pre-accept leak is void
         otp_attempts = 0,
         otp_locked_until = NULL
   WHERE id = p_ride_id
     AND status = 'requested'
     AND driver_id IS NULL
     AND ST_DWithin(pickup_location, v_driver.current_location, v_radius)
  RETURNING * INTO v_ride;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ride is no longer available';
  END IF;

  RETURN v_ride;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_ride(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_ride(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- SECTION 6 — start_ride(): server-side OTP check + attempt limit
--   Returns jsonb instead of raising so that failed-attempt counters survive
--   the request (an EXCEPTION would roll the whole PostgREST transaction back).
--   The ride row is refetched by the client: keeps geography serialization on
--   the normal table-select path.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_ride(p_ride_id UUID, p_otp TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ride    public.rides;
  v_max     CONSTANT SMALLINT := 5;
  v_failed  SMALLINT;
BEGIN
  PERFORM set_config('abtik.internal', '1', true);

  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'authentication required');
  END IF;

  SELECT * INTO v_ride FROM public.rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ride not found');
  END IF;

  IF v_ride.driver_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'only the assigned driver can start this ride'
    );
  END IF;

  IF v_ride.status NOT IN ('accepted', 'arrived') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('ride cannot be started while it is %s', v_ride.status)
    );
  END IF;

  IF v_ride.otp_locked_until IS NOT NULL AND v_ride.otp_locked_until > now() THEN
    RETURN jsonb_build_object(
      'success', false,
      'locked', true,
      'error', format(
        'too many failed attempts — locked until %s (Philippine time)',
        to_char(v_ride.otp_locked_until AT TIME ZONE 'Asia/Manila', 'HH24:MI')
      ),
      'attempts_remaining', 0
    );
  END IF;

  IF v_ride.otp_code IS DISTINCT FROM COALESCE(p_otp, '') THEN
    v_failed := COALESCE(v_ride.otp_attempts, 0) + 1;

    IF v_failed >= v_max THEN
      UPDATE public.rides
         SET otp_attempts = 0,
             otp_locked_until = now() + interval '5 minutes'
       WHERE id = p_ride_id;
      RETURN jsonb_build_object(
        'success', false,
        'locked', true,
        'attempts_remaining', 0,
        'error', format('invalid OTP — %s failed attempts allowed. Locked for 5 minutes.', v_max)
      );
    END IF;

    UPDATE public.rides SET otp_attempts = v_failed WHERE id = p_ride_id;
    RETURN jsonb_build_object(
      'success', false,
      'attempts_remaining', (v_max - v_failed)::INTEGER,
      'error', format('invalid OTP — %s attempt(s) remaining', (v_max - v_failed)::INTEGER)
    );
  END IF;

  UPDATE public.rides
     SET status = 'in_progress',
         started_at = now(),
         otp_attempts = 0,
         otp_locked_until = NULL
   WHERE id = p_ride_id
  RETURNING * INTO v_ride;

  RETURN jsonb_build_object('success', true, 'ride_id', v_ride.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_ride(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_ride(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- SECTION 7 — find_nearby_drivers(): not enumerable by anonymous clients
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.find_nearby_drivers(GEOGRAPHY, DOUBLE PRECISION, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_nearby_drivers(GEOGRAPHY, DOUBLE PRECISION, INTEGER)
  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_driver_location(
  DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN
) FROM PUBLIC, anon;

-- -----------------------------------------------------------------------------
-- SECTION 8 — Ride integrity trigger
--   RPCs flag themselves with the transaction-local GUC 'abtik.internal';
--   everything else is treated as an untrusted client statement.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rides_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_internal BOOLEAN := COALESCE(current_setting('abtik.internal', true), '') = '1';
  v_uid      UUID    := auth.uid();
BEGIN
  -- SECURITY DEFINER RPCs (accept_ride / start_ride) validate themselves,
  -- and service-role / SQL-editor statements are trusted.
  IF v_internal OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. Pricing, identity, OTP and route are server-owned.
  IF NEW.passenger_id IS DISTINCT FROM OLD.passenger_id
     OR NEW.otp_code IS DISTINCT FROM OLD.otp_code
     OR NEW.otp_attempts IS DISTINCT FROM OLD.otp_attempts
     OR NEW.otp_locked_until IS DISTINCT FROM OLD.otp_locked_until
     OR NEW.fare_amount IS DISTINCT FROM OLD.fare_amount
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.started_at IS DISTINCT FROM OLD.started_at
     OR NEW.pickup_address IS DISTINCT FROM OLD.pickup_address
     OR NEW.dropoff_address IS DISTINCT FROM OLD.dropoff_address
     OR NEW.pickup_location::text IS DISTINCT FROM OLD.pickup_location::text
     OR NEW.dropoff_location::text IS DISTINCT FROM OLD.dropoff_location::text
  THEN
    RAISE EXCEPTION 'ABTIK: fare, OTP and route fields are managed by the server';
  END IF;

  -- 2. Driver assignment only through accept_ride().
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    IF OLD.driver_id IS NOT NULL AND NEW.driver_id IS NULL THEN
      IF NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'ABTIK: driver can only be cleared when a ride is cancelled';
      END IF;
    ELSIF OLD.driver_id IS NULL AND NEW.driver_id IS NOT NULL THEN
      IF NEW.driver_id <> v_uid THEN
        RAISE EXCEPTION 'ABTIK: a driver may only assign themselves via accept_ride()';
      END IF;
      IF OLD.status <> 'requested' OR NEW.status <> 'accepted' THEN
        RAISE EXCEPTION 'ABTIK: invalid accept transition';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.drivers d
        WHERE d.id = v_uid AND d.vetted_status = TRUE AND d.is_online = TRUE
      ) THEN
        RAISE EXCEPTION 'ABTIK: only vetted, online drivers can accept rides';
      END IF;
    ELSE
      RAISE EXCEPTION 'ABTIK: assigned driver cannot be changed';
    END IF;
  END IF;

  -- 3. Status state machine.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'requested'   AND NEW.status IN ('accepted', 'cancelled'))
      OR (OLD.status = 'accepted'    AND NEW.status IN ('arrived', 'in_progress', 'cancelled'))
      OR (OLD.status = 'arrived'     AND NEW.status IN ('in_progress', 'cancelled'))
      OR (OLD.status = 'in_progress' AND NEW.status IN ('completed', 'cancelled'))
    ) THEN
      RAISE EXCEPTION 'ABTIK: invalid ride transition % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'completed' AND NEW.driver_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'ABTIK: only the assigned driver can complete a trip';
    END IF;

    IF NEW.status = 'accepted' AND NEW.driver_id IS NULL THEN
      RAISE EXCEPTION 'ABTIK: an accepted ride must have an assigned driver';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rides_guard ON public.rides;
CREATE TRIGGER rides_guard
  BEFORE UPDATE ON public.rides
  FOR EACH ROW EXECUTE FUNCTION public.rides_guard();

-- -----------------------------------------------------------------------------
-- SECTION 9 — Driver integrity trigger: vetting & rating are admin-only,
--   and a client can never insert itself as vetted or onto someone else's id.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.drivers_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_internal BOOLEAN := COALESCE(current_setting('abtik.internal', true), '') = '1';
  v_uid      UUID    := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NULL OR v_internal THEN
      RETURN NEW; -- service role / seed data
    END IF;
    IF NEW.id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'ABTIK: drivers can only create their own row';
    END IF;
    NEW.vetted_status := FALSE; -- admin verification required
    NEW.rating := 5.00;
    RETURN NEW;
  END IF;

  IF v_internal OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'ABTIK: driver id cannot be changed';
  END IF;
  IF NEW.vetted_status IS DISTINCT FROM OLD.vetted_status
     OR NEW.rating IS DISTINCT FROM OLD.rating THEN
    RAISE EXCEPTION 'ABTIK: vetting status and rating are managed by ABTIK operations';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS drivers_guard ON public.drivers;
CREATE TRIGGER drivers_guard
  BEFORE INSERT OR UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.drivers_guard();

-- -----------------------------------------------------------------------------
-- SECTION 10 — RLS: incoming ride feed
--   postgres_changes only delivers rows the subscriber can SELECT, so the old
--   participant-only policy meant drivers never saw 'requested' rides. Online,
--   vetted drivers now receive requests within 5 km of their current location.
--   (Pre-accept OTP leaks are neutralised by rotation in accept_ride().)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "rides_select_requested_feed" ON public.rides;
CREATE POLICY "rides_select_requested_feed"
  ON public.rides FOR SELECT
  TO authenticated
  USING (
    status = 'requested'
    AND EXISTS (
      SELECT 1
      FROM public.drivers d
      WHERE d.id = auth.uid()
        AND d.is_online = TRUE
        AND d.vetted_status = TRUE
        AND d.current_location IS NOT NULL
        AND ST_DWithin(d.current_location, rides.pickup_location, 5000)
    )
  );

-- Ride creation must go through create_ride() so the fare is server-computed.
DROP POLICY IF EXISTS "rides_insert_passenger" ON public.rides;

-- -----------------------------------------------------------------------------
-- SECTION 11 — RLS: guardians only see telemetry while a trip is live
--   (participants keep full replay for their own trips.)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "trip_logs_select_circle" ON public.trip_location_logs;
CREATE POLICY "trip_logs_select_circle"
  ON public.trip_location_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = trip_location_logs.ride_id
        AND (r.passenger_id = auth.uid() OR r.driver_id = auth.uid())
    )
    OR EXISTS (
      SELECT 1
      FROM public.rides r
      JOIN public.safety_circles sc ON sc.passenger_id = r.passenger_id
      JOIN public.profiles g ON g.phone_number = sc.guardian_phone
      WHERE r.id = trip_location_logs.ride_id
        AND g.id = auth.uid()
        AND sc.auto_notify = TRUE
        AND r.status IN ('accepted', 'arrived', 'in_progress')
    )
  );

-- -----------------------------------------------------------------------------
-- SECTION 12 — Cross-table policy helpers (RLS anti-recursion)
--
-- Policies that directly query a table whose own policies query back create a
-- cycle, and PostgreSQL fails with:
--   ERROR: infinite recursion detected in policy for relation "rides"
-- SECURITY DEFINER helpers run as the migration role, so their inner SELECTs
-- bypass RLS and terminate the evaluation graph. (The init migration's
-- profiles ↔ rides policies had this latent cycle.)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_profile_ride_peer(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE (r.passenger_id = auth.uid() AND r.driver_id = p_profile_id)
       OR (r.driver_id = auth.uid() AND r.passenger_id = p_profile_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_driver_ride_peer(p_driver_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rides r
    WHERE (r.driver_id = p_driver_id AND r.passenger_id = auth.uid())
       OR (r.passenger_id = p_driver_id AND r.driver_id = auth.uid())
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_profile_ride_peer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_profile_ride_peer(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_driver_ride_peer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_driver_ride_peer(UUID) TO authenticated;

-- profiles: ride-peer check no longer queries `rides` from inside policy.
-- Scoped to authenticated so the helper only ever runs for roles holding EXECUTE.
DROP POLICY IF EXISTS "profiles_select_own_or_ride_peer" ON public.profiles;
CREATE POLICY "profiles_select_own_or_ride_peer"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_profile_ride_peer(id));

-- -----------------------------------------------------------------------------
-- SECTION 13 — RLS: driver rows are no longer world-readable
--   (previously USING (TRUE) exposed live GPS + license_number to everyone)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "drivers_select_authenticated" ON public.drivers;

DROP POLICY IF EXISTS "drivers_select_own" ON public.drivers;
DROP POLICY IF EXISTS "drivers_select_ride_peers" ON public.drivers;
DROP POLICY IF EXISTS "drivers_select_own_or_peer" ON public.drivers;
CREATE POLICY "drivers_select_own_or_peer"
  ON public.drivers FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_driver_ride_peer(id));
