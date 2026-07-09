// Manual wellness check-in (PROD-6): a 5-second optional sleep/soreness/energy log so the
// recovery/deload feature works for users without a Garmin. Stored in body_metrics rows
// (Supabase) alongside body weight — same table, different fields — so no new table is
// needed. Not wired into any view yet; intended for a small prompt at the top of Today.
import { getLocal, save } from "../supabase/state.js";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** True if today's manual check-in hasn't been logged yet (used to decide whether to prompt). */
export function needsCheckinToday() {
  const today = todayStr();
  const metrics = getLocal("body_metrics");
  const entry = metrics.find((m) => m.date === today);
  return !entry || (entry.sleep_quality == null && entry.soreness == null && entry.energy == null);
}

/** sleepQuality/soreness/energy are each 1-5. Merges into today's body_metrics row. */
export async function logWellnessCheckin({ sleepQuality, soreness, energy }) {
  const today = todayStr();
  const metrics = getLocal("body_metrics");
  const idx = metrics.findIndex((m) => m.date === today);
  const entry = {
    ...(idx >= 0 ? metrics[idx] : { date: today }),
    sleep_quality: sleepQuality ?? null,
    soreness: soreness ?? null,
    energy: energy ?? null,
  };
  const next = idx >= 0 ? [...metrics.slice(0, idx), entry, ...metrics.slice(idx + 1)] : [...metrics, entry];
  await save("body_metrics", next);
  return entry;
}

/**
 * Derive a rough recovery signal from manual check-ins when Garmin data is absent, so the
 * deload/readiness feature degrades gracefully instead of going blank. 7-day average energy/
 * soreness vs a simple fixed baseline (no wearable to compare against, so this is intentionally
 * coarser than the Garmin-based computeRecoveryStatus in js/lib/recovery.js).
 */
export function computeManualRecoverySignal(bodyMetrics) {
  const now = Date.now();
  const last7 = bodyMetrics.filter((m) => {
    const days = Math.floor((now - new Date(m.date + "T00:00:00").getTime()) / 86400000);
    return days >= 0 && days < 7 && (m.sleep_quality != null || m.soreness != null || m.energy != null);
  });
  if (!last7.length) return { level: "unknown", reasons: ["No manual check-ins logged this week."] };

  const avg = (field) => {
    const vals = last7.map((m) => m[field]).filter((v) => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const sleep = avg("sleep_quality");
  const soreness = avg("soreness");
  const energy = avg("energy");

  const reasons = [];
  let flags = 0;
  if (sleep != null && sleep <= 2.5) { flags++; reasons.push(`Sleep quality has averaged ${sleep.toFixed(1)}/5 this week.`); }
  if (soreness != null && soreness >= 4) { flags++; reasons.push(`Soreness has averaged ${soreness.toFixed(1)}/5 this week — running high.`); }
  if (energy != null && energy <= 2.5) { flags++; reasons.push(`Energy has averaged ${energy.toFixed(1)}/5 this week.`); }

  const level = flags >= 2 ? "red" : flags === 1 ? "yellow" : "green";
  if (level === "green" && !reasons.length) reasons.push("Self-reported sleep, soreness, and energy all look okay this week.");
  return { level, reasons, metrics: { sleep, soreness, energy }, source: "manual" };
}
