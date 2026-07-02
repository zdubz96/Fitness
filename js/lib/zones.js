// Heart-rate zone math. Zones are % of max HR (5-zone model).
export function estimateMaxHR(age) {
  return Math.round(208 - 0.7 * age); // Tanaka formula, more accurate than 220-age
}

const ZONE_DEFS = [
  { name: "Zone 1 (Recovery)", low: 0.5, high: 0.6 },
  { name: "Zone 2 (Easy/Base)", low: 0.6, high: 0.7 },
  { name: "Zone 3 (Moderate)", low: 0.7, high: 0.8 },
  { name: "Zone 4 (Threshold)", low: 0.8, high: 0.9 },
  { name: "Zone 5 (VO2 Max)", low: 0.9, high: 1.0 },
];

export function defaultZones(maxHR) {
  return ZONE_DEFS.map((z) => ({
    name: z.name,
    low: Math.round(z.low * maxHR),
    high: Math.round(z.high * maxHR),
  }));
}

/** Given a list of {avg_hr} samples (e.g. HR time series or per-activity avg), bucket into zones. */
export function zoneForHR(hr, zones) {
  for (let i = zones.length - 1; i >= 0; i--) {
    if (hr >= zones[i].low) return zones[i].name;
  }
  return zones[0]?.name;
}

/**
 * Rough time-in-zone estimate for an activity using its avg HR (Garmin's public API doesn't
 * expose second-by-second HR streams through python-garminconnect's simple endpoints, so we
 * bucket the whole activity duration into the zone containing its average HR).
 */
export function estimateActivityZoneMinutes(activity, zones) {
  if (!activity.avg_hr || !activity.duration_seconds) return null;
  const zoneName = zoneForHR(activity.avg_hr, zones);
  return { zone: zoneName, minutes: activity.duration_seconds / 60 };
}
