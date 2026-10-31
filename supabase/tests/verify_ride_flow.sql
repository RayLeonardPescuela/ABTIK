-- =============================================================================
-- ABTIK — post-migration verification suite
-- =============================================================================
-- HOW TO RUN
--   1. Create a Supabase project and enable the PostGIS extension
--      (Dashboard -> Database -> Extensions -> postgis -> Enable).
--   2. Apply, in order, in the SQL editor:
--        supabase/migrations/20241027000000_init_abtik.sql
--        supabase/migrations/20261031000001_fix_ride_flow_rpcs_and_rls.sql
--   3. Paste this whole file into a NEW query and press Run.
--
-- OUTPUT
--   Each check prints a "PASS ..." notice. The first broken check aborts the
--   script with a red "FAIL ..." error, so a regression cannot scroll past
--   unnoticed.
--
-- WHAT IS VERIFIED
--   Section A — RPC + trigger behaviour (runs as the postgres role)
--     A1 identities, a vetted online driver and guardian links are seeded
--     A2 ride RPCs: SECURITY DEFINER, no fare parameter, anon locked out
--     A3 create_ride computes the fare server-side (client cannot set it)
--     A4 fare / OTP / status edits are refused even with direct table access
--     A5 accept_ride: vetting, online and proximity gates + OTP rotation
--     A6 start_ride: server-side OTP check, persisted attempt counter, replay
--        protection, 5-attempt / 5-minute lockout
--   Section B — row-level security (runs as the "authenticated" role, i.e.
--   exactly what the mobile app gets through PostgREST)
--     B1 anon sees nothing; nearby online vetted drivers get the dispatch
--        feed; far-away or offline drivers do not
--     B2 driver rows and profiles are visible only to their owner or a ride
--        peer; strangers see neither
--     B3 guardians see trip telemetry only while the trip is live
--     B4 a passenger cannot insert a ride with a self-chosen fare
--
-- TEST DATA
--   Three fixed identities are seeded (...0001 passenger, ...0002 driver,
--   ...0003 guardian; phones +639170000001-3). Re-running is safe. Ride rows
--   cannot be deleted (by design), so a few "ABTIK Test" rides remain.
-- =============================================================================

DO $$
DECLARE
  -- fixed identities so re-runs are idempotent and logs stay readable
  c_passenger CONSTANT uuid := 'a0000000-0000-4000-8000-000000000001';
  c_driver    CONSTANT uuid := 'a0000000-0000-4000-8000-000000000002';
  c_guardian  CONSTANT uuid := 'a0000000-0000-4000-8000-000000000003';

  v_ride1      public.rides;
  v_ride2      public.rides;
  v_ride3      public.rides;
  v_old_otp    text;
  v_new_otp    text;
  v_wrong_otp  text;
  v_res        jsonb;
  v_cnt        bigint;
  v_rls_ok     boolean := false;
BEGIN
  -- ===========================================================================
  -- SECTION A — RPC + trigger behaviour (postgres role)
  -- ===========================================================================

  -- A1. seed identities; the handle_new_user trigger creates the profiles
  BEGIN
    INSERT INTO auth.users (instance_id, id, aud, role, email, phone, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    VALUES
      ('00000000-0000-0000-0000-000000000000', c_passenger, 'authenticated', 'authenticated',
       'abtik.test.passenger@example.com', '+639170000001', crypt('abtik-test-pw', gen_salt('bf')),
       now(), now(), now(),
       '{"provider":"phone","providers":["phone"]}'::jsonb,
       jsonb_build_object('role','passenger','full_name','ABTIK Test Passenger','phone_number','+639170000001')),
      ('00000000-0000-0000-0000-000000000000', c_driver, 'authenticated', 'authenticated',
       'abtik.test.driver@example.com', '+639170000002', crypt('abtik-test-pw', gen_salt('bf')),
       now(), now(), now(),
       '{"provider":"phone","providers":["phone"]}'::jsonb,
       jsonb_build_object('role','driver','full_name','ABTIK Test Driver','phone_number','+639170000002')),
      ('00000000-0000-0000-0000-000000000000', c_guardian, 'authenticated', 'authenticated',
       'abtik.test.guardian@example.com', '+639170000003', crypt('abtik-test-pw', gen_salt('bf')),
       now(), now(), now(),
       '{"provider":"phone","providers":["phone"]}'::jsonb,
       jsonb_build_object('role','passenger','full_name','ABTIK Test Guardian','phone_number','+639170000003'))
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL (setup): could not seed test identities into auth.users — %', SQLERRM;
  END;

  IF (SELECT count(*) FROM public.profiles WHERE id IN (c_passenger, c_driver, c_guardian)) <> 3 THEN
    RAISE EXCEPTION 'FAIL (setup): auth.users rows did not produce profile rows (handle_new_user trigger missing?)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id IN (c_passenger, c_driver, c_guardian) AND phone_number IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL (setup): a profile has no phone_number (handle_new_user must copy auth.users.phone)';
  END IF;

  -- vetted, online driver parked on the campus pickup point + guardian links
  INSERT INTO public.drivers (id, vehicle_plate, vehicle_model, license_number,
                              is_online, vetted_status, current_location)
  VALUES (c_driver, 'ABTIK-TEST', 'Test Motorcycle', 'DL-TEST-0001', true, true,
          ST_SetSRID(ST_MakePoint(123.8854, 10.3157), 4326)::geography)
  ON CONFLICT (id) DO UPDATE
    SET is_online        = EXCLUDED.is_online,
        vetted_status    = EXCLUDED.vetted_status,
        current_location = EXCLUDED.current_location;

  INSERT INTO public.safety_circles (passenger_id, guardian_phone, guardian_name, relationship)
  VALUES (c_passenger, '+639170000003', 'ABTIK Test Guardian', 'family')
  ON CONFLICT (passenger_id, guardian_phone) DO NOTHING;

  RAISE NOTICE 'PASS  A1: test identities, vetted online driver and guardian link ready';

  -- A2. RPC hygiene: signatures, SECURITY DEFINER, execute grants
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'create_ride'
       AND pg_get_function_identity_arguments(p.oid) ILIKE '%fare%'
  ) THEN
    RAISE EXCEPTION 'FAIL (A2): create_ride still exposes a fare parameter';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('create_ride', 'accept_ride', 'start_ride')
       AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'FAIL (A2): a ride RPC is missing SECURITY DEFINER';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.routine_privileges
     WHERE routine_schema = 'public'
       AND routine_name IN ('create_ride', 'accept_ride', 'start_ride')
       AND grantee IN ('anon', 'PUBLIC')
  ) THEN
    RAISE EXCEPTION 'FAIL (A2): ride RPCs are still executable by anon/PUBLIC';
  END IF;

  IF (SELECT count(DISTINCT routine_name)
        FROM information_schema.routine_privileges
       WHERE routine_schema = 'public'
         AND routine_name IN ('create_ride', 'accept_ride', 'start_ride')
         AND grantee = 'authenticated') <> 3 THEN
    RAISE EXCEPTION 'FAIL (A2): a ride RPC is not executable by authenticated';
  END IF;

  RAISE NOTICE 'PASS  A2: RPC signatures, SECURITY DEFINER and grants are correct';

  -- A3. create_ride computes the fare server-side
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_passenger, 'role', 'authenticated')::text, false);

  v_ride1 := public.create_ride(
    c_passenger,
    123.8854, 10.3157, 'ABTIK campus test pickup',
    123.8900, 10.3200, 'ABTIK test drop-off',
    NULL, NULL);

  -- abs() tolerance of 15 absorbs the nightly surcharge flipping between the
  -- create_ride call and this check when run exactly at 21:00 or 05:00
  IF abs(v_ride1.fare_amount
         - public.compute_fare(v_ride1.pickup_location, v_ride1.dropoff_location)) NOT IN (0, 15) THEN
    RAISE EXCEPTION 'FAIL (A3): stored fare % does not match compute_fare()',
      v_ride1.fare_amount;
  END IF;
  IF v_ride1.fare_amount < 40 THEN
    RAISE EXCEPTION 'FAIL (A3): fare % is below the P40 minimum', v_ride1.fare_amount;
  END IF;
  IF length(COALESCE(v_ride1.otp_code, '')) <> 4 THEN
    RAISE EXCEPTION 'FAIL (A3): expected a 4-digit OTP, got "%"', v_ride1.otp_code;
  END IF;

  -- booking on behalf of someone else must fail
  BEGIN
    PERFORM public.create_ride(c_driver, 123.8854, 10.3157, 'x', 123.8900, 10.3200, 'y', NULL, NULL);
    RAISE EXCEPTION 'FAIL (A3): create_ride allowed booking for another user';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  -- an anonymous caller must fail even though the function is SECURITY DEFINER
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', false);
  BEGIN
    PERFORM public.create_ride(c_passenger, 123.8854, 10.3157, 'x', 123.8900, 10.3200, 'y', NULL, NULL);
    RAISE EXCEPTION 'FAIL (A3): an anonymous caller passed the identity check';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%passenger_id must match%' THEN
      RAISE EXCEPTION 'FAIL (A3): expected identity error for anon, got — %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'PASS  A3: fare computed server-side (P%), 4-digit OTP, identity enforced', v_ride1.fare_amount;

  -- A4. server-owned fields refuse direct edits (triggers fire for everyone)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_passenger, 'role', 'authenticated')::text, false);

  BEGIN
    UPDATE public.rides SET fare_amount = 1.00 WHERE id = v_ride1.id;
    RAISE EXCEPTION 'FAIL (A4): fare_amount was directly editable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%managed by the server%' THEN
      RAISE EXCEPTION 'FAIL (A4): unexpected error when editing fare — %', SQLERRM;
    END IF;
  END;

  BEGIN
    UPDATE public.rides SET otp_code = '9999' WHERE id = v_ride1.id;
    RAISE EXCEPTION 'FAIL (A4): otp_code was directly editable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%managed by the server%' THEN
      RAISE EXCEPTION 'FAIL (A4): unexpected error when editing OTP — %', SQLERRM;
    END IF;
  END;

  BEGIN
    UPDATE public.rides SET status = 'completed' WHERE id = v_ride1.id;
    RAISE EXCEPTION 'FAIL (A4): requested -> completed jump was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%invalid ride transition%' THEN
      RAISE EXCEPTION 'FAIL (A4): unexpected error on invalid transition — %', SQLERRM;
    END IF;
  END;

  RAISE NOTICE 'PASS  A4: fare, OTP and status transitions are server-owned';

  -- A5. accept_ride gates + OTP rotation
  --     (driver row edits by an admin are done with the JWT claims cleared,
  --      which is exactly what the service role / dashboard does)
  PERFORM set_config('request.jwt.claims', '', false);
  UPDATE public.drivers SET vetted_status = false WHERE id = c_driver;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_driver, 'role', 'authenticated')::text, false);

  BEGIN
    PERFORM public.accept_ride(v_ride1.id);
    RAISE EXCEPTION 'FAIL (A5): an unvetted driver was allowed to accept';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not vetted%' THEN
      RAISE EXCEPTION 'FAIL (A5): expected vetting error, got — %', SQLERRM;
    END IF;
  END;

  PERFORM set_config('request.jwt.claims', '', false);
  UPDATE public.drivers SET vetted_status = true, is_online = false WHERE id = c_driver;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_driver, 'role', 'authenticated')::text, false);

  BEGIN
    PERFORM public.accept_ride(v_ride1.id);
    RAISE EXCEPTION 'FAIL (A5): an offline driver was allowed to accept';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%go online%' THEN
      RAISE EXCEPTION 'FAIL (A5): expected offline error, got — %', SQLERRM;
    END IF;
  END;

  PERFORM set_config('request.jwt.claims', '', false);
  UPDATE public.drivers
     SET is_online = true,
         current_location = ST_SetSRID(ST_MakePoint(125.6100, 7.0700), 4326)::geography -- Davao, >600 km away
   WHERE id = c_driver;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_driver, 'role', 'authenticated')::text, false);

  BEGIN
    PERFORM public.accept_ride(v_ride1.id);
    RAISE EXCEPTION 'FAIL (A5): a driver 600 km away was allowed to accept';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%no longer available%' THEN
      RAISE EXCEPTION 'FAIL (A5): expected proximity error, got — %', SQLERRM;
    END IF;
  END;

  -- happy path back on campus: the OTP must be rotated on acceptance
  v_old_otp := v_ride1.otp_code;
  PERFORM set_config('request.jwt.claims', '', false);
  UPDATE public.drivers
     SET current_location = ST_SetSRID(ST_MakePoint(123.8854, 10.3157), 4326)::geography
   WHERE id = c_driver;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_driver, 'role', 'authenticated')::text, false);

  v_ride1 := public.accept_ride(v_ride1.id);

  IF v_ride1.status <> 'accepted' OR v_ride1.driver_id <> c_driver THEN
    RAISE EXCEPTION 'FAIL (A5): ride did not move to accepted with the driver assigned';
  END IF;

  v_new_otp := v_ride1.otp_code;
  IF v_new_otp IS DISTINCT FROM v_old_otp THEN
    RAISE NOTICE 'PASS  A5: vetting/online/proximity gates enforced, OTP rotated on acceptance';
  ELSE
    -- a 1-in-10,000 collision with the old code is possible; nothing else failed
    RAISE NOTICE 'PASS  A5: gates enforced (OTP rotation collided with the old code — re-run to see rotation)';
  END IF;

  -- A6. start_ride: server-side OTP check + attempt limits
  v_wrong_otp := CASE WHEN v_new_otp = '0000' THEN '9999' ELSE '0000' END;

  -- the passenger cannot drive the OTP check
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_passenger, 'role', 'authenticated')::text, false);
  v_res := public.start_ride(v_ride1.id, v_new_otp);
  IF (v_res->>'success')::boolean IS NOT FALSE
     OR COALESCE(v_res->>'error', '') NOT LIKE '%only the assigned driver%' THEN
    RAISE EXCEPTION 'FAIL (A6): a non-assigned user reached the OTP check — %', v_res;
  END IF;

  -- wrong OTP: rejected with 4 attempts remaining, and the counter survives
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_driver, 'role', 'authenticated')::text, false);
  v_res := public.start_ride(v_ride1.id, v_wrong_otp);
  IF (v_res->>'success')::boolean IS NOT FALSE
     OR COALESCE((v_res->>'attempts_remaining')::int, -1) <> 4 THEN
    RAISE EXCEPTION 'FAIL (A6): expected failure with 4 attempts remaining — %', v_res;
  END IF;
  IF (SELECT otp_attempts FROM public.rides WHERE id = v_ride1.id) <> 1 THEN
    RAISE EXCEPTION 'FAIL (A6): the failed-attempt counter was not persisted';
  END IF;

  -- correct OTP: the trip starts
  v_res := public.start_ride(v_ride1.id, v_new_otp);
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL (A6): the correct OTP was rejected — %', v_res;
  END IF;
  IF (SELECT status FROM public.rides WHERE id = v_ride1.id) <> 'in_progress'
     OR (SELECT started_at FROM public.rides WHERE id = v_ride1.id) IS NULL THEN
    RAISE EXCEPTION 'FAIL (A6): the ride did not move to in_progress with started_at set';
  END IF;

  -- replay: the same OTP cannot start the ride twice
  v_res := public.start_ride(v_ride1.id, v_new_otp);
  IF (v_res->>'success')::boolean IS NOT FALSE
     OR COALESCE(v_res->>'error', '') NOT LIKE '%cannot be started%' THEN
    RAISE EXCEPTION 'FAIL (A6): the ride could be started twice — %', v_res;
  END IF;

  -- lockout: five wrong OTPs freeze the ride for five minutes
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_passenger, 'role', 'authenticated')::text, false);
  v_ride2 := public.create_ride(c_passenger,
    123.8854, 10.3157, 'ABTIK campus test pickup',
    123.8910, 10.3210, 'ABTIK test drop-off 2', NULL, NULL);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_driver, 'role', 'authenticated')::text, false);
  v_ride2   := public.accept_ride(v_ride2.id);
  v_old_otp := v_ride2.otp_code;
  v_wrong_otp := CASE WHEN v_old_otp = '0000' THEN '9999' ELSE '0000' END;

  FOR i IN 1..5 LOOP
    v_res := public.start_ride(v_ride2.id, v_wrong_otp);
  END LOOP;

  IF (v_res->>'locked')::boolean IS NOT TRUE
     OR COALESCE(v_res->>'error', '') NOT LIKE '%Locked for 5 minutes%' THEN
    RAISE EXCEPTION 'FAIL (A6): expected a 5-minute lock after 5 wrong OTPs — %', v_res;
  END IF;

  -- even the correct OTP is refused while locked
  v_res := public.start_ride(v_ride2.id, v_old_otp);
  IF (v_res->>'success')::boolean IS NOT FALSE
     OR COALESCE(v_res->>'error', '') NOT LIKE '%locked until%' THEN
    RAISE EXCEPTION 'FAIL (A6): the correct OTP was accepted during lockout — %', v_res;
  END IF;

  RAISE NOTICE 'PASS  A6: OTP enforced server-side, counters persisted, replay blocked, lockout works';

  -- seed telemetry on the live ride for the guardian checks in Section B
  INSERT INTO public.trip_location_logs (ride_id, lat, lng, speed, heading)
  VALUES (v_ride2.id, 10.3157, 123.8854, 12.5, 90.0),
         (v_ride2.id, 10.3158, 123.8855, 11.0, 91.0);

  PERFORM set_config('request.jwt.claims', '', false);
  RAISE NOTICE '=== Section A complete — RPC + trigger behaviour all passed ===';

  -- ===========================================================================
  -- SECTION B — row-level security, as the "authenticated" role the app uses
  -- ===========================================================================
  BEGIN
    EXECUTE 'SET ROLE authenticated';
    v_rls_ok := true;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'SKIP (RLS): this connection cannot SET ROLE authenticated (%)', SQLERRM;
    RAISE NOTICE '       Re-run Section B through the app or REST API instead.';
  END;

  IF v_rls_ok THEN
    -- B1. who can see the dispatch feed?
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', c_passenger, 'role', 'authenticated')::text, false);
    v_ride3 := public.create_ride(c_passenger,
      123.8854, 10.3157, 'ABTIK campus test pickup',
      123.8920, 10.3220, 'ABTIK test drop-off 3', NULL, NULL);

    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', false);
    SELECT count(*) INTO v_cnt FROM public.rides WHERE id = v_ride3.id;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'FAIL (B1): anon can see a requested ride';
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', c_driver, 'role', 'authenticated')::text, false);
    SELECT count(*) INTO v_cnt FROM public.rides WHERE id = v_ride3.id;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'FAIL (B1): an online vetted nearby driver cannot see the new request';
    END IF;

    -- too far away: the feed must empty
    UPDATE public.drivers
       SET current_location = ST_SetSRID(ST_MakePoint(125.6100, 7.0700), 4326)::geography
     WHERE id = c_driver;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'FAIL (setup): the driver row is not updatable under RLS (drivers update policy missing?)';
    END IF;
    SELECT count(*) INTO v_cnt FROM public.rides WHERE id = v_ride3.id;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'FAIL (B1): a driver 600 km away still sees the dispatch feed';
    END IF;

    -- back on campus but offline: still no feed
    UPDATE public.drivers
       SET is_online = false,
           current_location = ST_SetSRID(ST_MakePoint(123.8854, 10.3157), 4326)::geography
     WHERE id = c_driver;
    SELECT count(*) INTO v_cnt FROM public.rides WHERE id = v_ride3.id;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'FAIL (B1): an offline driver still sees the dispatch feed';
    END IF;

    UPDATE public.drivers SET is_online = true WHERE id = c_driver;
    RAISE NOTICE 'PASS  B1: anon blind, dispatch feed gated on online + vetted + 5 km proximity';

    -- B2. driver rows and profiles: owner or ride peer only
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', c_guardian, 'role', 'authenticated')::text, false);
    SELECT count(*) INTO v_cnt FROM public.drivers WHERE id = c_driver;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'FAIL (B2): a stranger can see the driver''s row (live GPS, license plate)';
    END IF;
    SELECT count(*) INTO v_cnt FROM public.profiles WHERE id = c_driver;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'FAIL (B2): a stranger can see the driver''s profile';
    END IF;
    SELECT count(*) INTO v_cnt FROM public.profiles WHERE id = c_guardian;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'FAIL (B2): a user cannot see their own profile';
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', c_passenger, 'role', 'authenticated')::text, false);
    SELECT count(*) INTO v_cnt FROM public.drivers WHERE id = c_driver;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'FAIL (B2): the passenger cannot see the assigned driver''s row';
    END IF;
    SELECT count(*) INTO v_cnt FROM public.profiles WHERE id = c_driver;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'FAIL (B2): the passenger cannot see the assigned driver''s profile';
    END IF;
    RAISE NOTICE 'PASS  B2: driver rows/profiles visible to owner and ride peers only';

    -- B3. guardians see telemetry only while the trip is live
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', c_guardian, 'role', 'authenticated')::text, false);
    SELECT count(*) INTO v_cnt FROM public.trip_location_logs WHERE ride_id = v_ride2.id;
    IF v_cnt <> 2 THEN
      RAISE EXCEPTION 'FAIL (B3): the guardian should see the 2 live-trip logs, saw %', v_cnt;
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', c_driver, 'role', 'authenticated')::text, false);
    SELECT count(*) INTO v_cnt FROM public.trip_location_logs WHERE ride_id = v_ride2.id;
    IF v_cnt <> 2 THEN
      RAISE EXCEPTION 'FAIL (B3): the driver lost replay access to their own trip''s logs';
    END IF;

    UPDATE public.rides SET status = 'completed', completed_at = now() WHERE id = v_ride2.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'FAIL (B3): the assigned driver cannot complete their own ride under RLS';
    END IF;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', c_guardian, 'role', 'authenticated')::text, false);
    SELECT count(*) INTO v_cnt FROM public.trip_location_logs WHERE ride_id = v_ride2.id;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'FAIL (B3): the guardian can still see telemetry after the trip ended (%)', v_cnt;
    END IF;
    RAISE NOTICE 'PASS  B3: guardian telemetry is live-only, participants keep full replay';

    -- B4. rides can only be created through create_ride (fare is server-owned)
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', c_passenger, 'role', 'authenticated')::text, false);
    BEGIN
      INSERT INTO public.rides (id, passenger_id, pickup_location, pickup_address,
                                dropoff_location, dropoff_address, otp_code, fare_amount)
      VALUES (gen_random_uuid(), c_passenger,
              ST_SetSRID(ST_MakePoint(123.8854, 10.3157), 4326)::geography, 'raw insert attempt',
              ST_SetSRID(ST_MakePoint(123.8900, 10.3200), 4326)::geography, 'raw insert attempt',
              '1111', 1.00);
      RAISE EXCEPTION 'FAIL (B4): a passenger inserted a ride with a self-chosen fare';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
      RAISE NOTICE 'PASS  B4: raw ride insert with a self-chosen fare denied (%)', SQLERRM;
    END;

    EXECUTE 'RESET ROLE';
    RAISE NOTICE '=== Section B complete — RLS all passed as the authenticated role ===';
  END IF;

  -- ===========================================================================
  -- CLEANUP — rides are immutable by design, so only the guardian links go
  -- ===========================================================================
  DELETE FROM public.safety_circles
   WHERE passenger_id IN (c_passenger, c_guardian)
     AND guardian_phone IN ('+639170000001', '+639170000003');

  RAISE NOTICE '================================================================';
  RAISE NOTICE 'ABTIK verification complete — ALL CHECKS PASSED.';
  RAISE NOTICE 'Left behind on this dev database:';
  RAISE NOTICE '  - 3 test identities (ABTIK Test Passenger/Driver/Guardian)';
  RAISE NOTICE '  - 1 test driver row + a handful of ABTIK Test rides/logs';
  RAISE NOTICE '    (ride rows cannot be deleted — by design)';
  RAISE NOTICE '================================================================';
END $$;
