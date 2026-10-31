/** Provincial motorcycle fare model (PHP) — tune per LGU / campus contract */
export const FARE = {
  currency: 'PHP' as const,
  baseFee: 25,
  perKm: 12,
  /** Applied 21:00–05:00 local for remote sudlunon routes */
  lateNightSurcharge: 15,
  lateNightStartHour: 21,
  lateNightEndHour: 5,
  minFare: 40,
} as const;

export function isLateNight(date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= FARE.lateNightStartHour || hour < FARE.lateNightEndHour;
}

export function estimateFare(distanceKm: number, at = new Date()) {
  const distanceFee = Math.max(0, distanceKm) * FARE.perKm;
  const lateNightSurcharge = isLateNight(at) ? FARE.lateNightSurcharge : 0;
  const raw = FARE.baseFee + distanceFee + lateNightSurcharge;
  const total = Math.max(FARE.minFare, Math.round(raw));

  return {
    distanceKm: Number(distanceKm.toFixed(2)),
    baseFee: FARE.baseFee,
    lateNightSurcharge,
    total,
    currency: FARE.currency,
  };
}
