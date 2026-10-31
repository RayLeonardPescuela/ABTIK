-- =============================================================================
-- ABTIK — demo accounts for presentation mode (no SMS anywhere)
-- =============================================================================
-- Creates two email/password accounts the app can enter with one tap
-- (src/lib/demoAuth.ts). They receive REAL Supabase sessions, so auth.uid(),
-- RLS and every SECURITY DEFINER RPC behave exactly like production — only
-- the credential entry point differs.
--
--   demo.passenger@abtik.local  (+639171111111)  "Ana (Demo)"      passenger
--   demo.driver@abtik.local     (+639172222222)  "Kuya Ben (Demo)" vetted driver
--   password for both: abtik-demo-2026
--
-- Also seeds: a vetted (but offline) driver row parked on the campus pickup
-- point, and a Safety Circle linking the passenger to the driver's phone so
-- SOS / guardian demos have a contact to fall back to.
--
-- HOW TO RUN (idempotent — safe to re-run):
--   supabase db query --local -f scripts/seed-demo-accounts.sql
-- or paste into Studio -> SQL (http://127.0.0.1:54323).
-- Wrapped in a single DO block so it also runs under `supabase db query`,
-- which executes one statement at a time.
-- =============================================================================

DO $$
DECLARE
  v_passenger uuid;
  v_driver    uuid;
BEGIN
  -- ---- demo passenger ------------------------------------------------------
  SELECT id INTO v_passenger FROM auth.users WHERE email = 'demo.passenger@abtik.local';
  IF v_passenger IS NULL THEN
    v_passenger := gen_random_uuid();
    INSERT INTO auth.users (instance_id, id, aud, role, email, phone, encrypted_password,
                            email_confirmed_at, phone_confirmed_at, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, phone_change,
                            email_change_token_current, email_change_token_new,
                            phone_change_token, reauthentication_token,
                            raw_app_meta_data, raw_user_meta_data)
    VALUES ('00000000-0000-0000-0000-000000000000', v_passenger, 'authenticated', 'authenticated',
            'demo.passenger@abtik.local', '+639171111111',
            crypt('abtik-demo-2026', gen_salt('bf')),
            now(), now(), now(), now(),
            '', '', '', '', '', '', '', '',
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('role', 'passenger', 'full_name', 'Ana (Demo)',
                               'phone_number', '+639171111111'));
  END IF;

  -- ---- demo driver ---------------------------------------------------------
  SELECT id INTO v_driver FROM auth.users WHERE email = 'demo.driver@abtik.local';
  IF v_driver IS NULL THEN
    v_driver := gen_random_uuid();
    INSERT INTO auth.users (instance_id, id, aud, role, email, phone, encrypted_password,
                            email_confirmed_at, phone_confirmed_at, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, phone_change,
                            email_change_token_current, email_change_token_new,
                            phone_change_token, reauthentication_token,
                            raw_app_meta_data, raw_user_meta_data)
    VALUES ('00000000-0000-0000-0000-000000000000', v_driver, 'authenticated', 'authenticated',
            'demo.driver@abtik.local', '+639172222222',
            crypt('abtik-demo-2026', gen_salt('bf')),
            now(), now(), now(), now(),
            '', '', '', '', '', '', '', '',
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('role', 'driver', 'full_name', 'Kuya Ben (Demo)',
                               'phone_number', '+639172222222'));
  END IF;

  -- ---- token columns: GoTrue stores '' (empty string), never NULL ---------
  -- Its password-grant scan fails on ANY NULL token column ("converting NULL
  -- to string is unsupported"), so repair rows created by earlier seed runs.
  UPDATE auth.users
     SET confirmation_token     = coalesce(confirmation_token, ''),
         recovery_token         = coalesce(recovery_token, ''),
         email_change           = coalesce(email_change, ''),
         phone_change           = coalesce(phone_change, ''),
         email_change_token_current = coalesce(email_change_token_current, ''),
         email_change_token_new     = coalesce(email_change_token_new, ''),
         phone_change_token     = coalesce(phone_change_token, ''),
         reauthentication_token = coalesce(reauthentication_token, '')
   WHERE id IN (v_passenger, v_driver);

  -- ---- profiles: trigger creates them on insert; repair on re-runs ---------
  UPDATE public.profiles
     SET role = 'passenger'::public.user_role, full_name = 'Ana (Demo)',
         phone_number = '+639171111111'
   WHERE id = v_passenger;
  UPDATE public.profiles
     SET role = 'driver'::public.user_role, full_name = 'Kuya Ben (Demo)',
         phone_number = '+639172222222'
   WHERE id = v_driver;

  -- ---- vetted demo driver, parked on the campus pickup point --------------
  -- Starts OFFLINE on purpose: "driver goes online" is part of the demo story.
  INSERT INTO public.drivers (id, vehicle_plate, vehicle_model, license_number,
                              is_online, vetted_status, current_location)
  VALUES (v_driver, 'ABTIK DEMO', 'Honda TMX 125', 'DL-DEMO-0001', false, true,
          ST_SetSRID(ST_MakePoint(123.8854, 10.3157), 4326)::geography)
  ON CONFLICT (id) DO UPDATE
    SET vetted_status    = TRUE,
        is_online        = FALSE,
        vehicle_plate    = EXCLUDED.vehicle_plate,
        vehicle_model    = EXCLUDED.vehicle_model,
        license_number   = EXCLUDED.license_number,
        current_location = EXCLUDED.current_location;

  -- ---- safety circle so SOS/guardian have a contact on stage --------------
  INSERT INTO public.safety_circles (passenger_id, guardian_phone, guardian_name, relationship)
  VALUES (v_passenger, '+639172222222', 'Kuya Ben (Demo)', 'family')
  ON CONFLICT (passenger_id, guardian_phone) DO NOTHING;

  RAISE NOTICE 'Demo accounts ready: demo.passenger@abtik.local / demo.driver@abtik.local (password: abtik-demo-2026)';
END $$;
