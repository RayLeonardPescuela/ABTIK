/**
 * Driver onboarding helpers.
 *
 * A driver cannot receive trips until their `drivers` row exists (created
 * here) and ABTIK operations sets `vetted_status` (admin-only — enforced by
 * the `drivers_guard` trigger).
 */

import { currentUserId, supabase } from '@/lib/supabaseClient';
import type { Driver } from '@/types/database';

export interface DriverSetupInput {
  vehiclePlate: string;
  vehicleModel: string;
  licenseNumber: string;
}

/** Loads the signed-in user's driver row, or null before onboarding. */
export async function fetchMyDriverRow(): Promise<Driver | null> {
  const uid = await currentUserId();
  if (!uid) throw new Error('not signed in');

  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('id', uid)
    .maybeSingle();

  if (error) throw error;
  return (data as Driver | null) ?? null;
}

/**
 * Creates the signed-in user's driver row.
 * `vetted_status` and `rating` are forced to their defaults server-side.
 */
export async function createMyDriverRow(
  input: DriverSetupInput,
): Promise<Driver> {
  const uid = await currentUserId();
  if (!uid) throw new Error('not signed in');

  const vehiclePlate = input.vehiclePlate.trim().toUpperCase();
  const vehicleModel = input.vehicleModel.trim();
  const licenseNumber = input.licenseNumber.trim();

  if (!vehiclePlate || !vehicleModel || !licenseNumber) {
    throw new Error('Plate, motorcycle model and license number are required');
  }

  const { data, error } = await supabase
    .from('drivers')
    .insert({
      id: uid,
      vehicle_plate: vehiclePlate,
      vehicle_model: vehicleModel,
      license_number: licenseNumber,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as Driver;
}
