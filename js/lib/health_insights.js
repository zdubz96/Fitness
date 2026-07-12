// Deterministic, zero-cost "so what" insights for the Health tab (HT-4). No LLM calls here —
// this must render instantly on every tab open. Deeper narrative interpretation still lives in
// the quarterly cardio report (js/lib/cardioreport.js), which is LLM-generated on demand.
import { defaultZones, estimateActivityZoneMinutes } from "./zones.js";

const ZONE2_WEEKLY_TARGET_MIN = 150;
const GRAY_ZONE_WARNING_PCT = 30; // Zone 3 minutes above this % of weekly zone minutes -> flag

function daysAgo(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}

function avg(nums) {
  const clean = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function windowValues(rows, field, fromDaysAgo, toDaysAgo) {
  return rows
    .filter((r) => {
      const d = daysAgo(r.date);
      return d >= fromDaysAgo && d < toDaysAgo;
    })
    .map((r) => r[field])
    .filter((v) => typeof v === "number");
}

/**
 * @param {object} data
 * @param {Array} data.wellness - garmin_wellness rows {date, resting_hr}
 * @param {Array} data.health - garmin_health rows {date, hrv_avg_ms, vo2max_running, vo2max_cycling}
 * @param {Array} data.activities - garmin_activities rows {date, avg_hr, duration_seconds}
 * @param {object} data.profile - trainer_profile (for max_hr/zones)
 * @returns {{level: "good"|"watch"|"info", text: string}[]}
 */
export function computeHealthInsights({ wellness = [], health = [], activities = [], profile = {} } = {}) {
  const insights = [];

  const hasAnyData = wellness.length > 0 || health.length > 0 || activities.length > 0;
  if (!hasAnyData) {
    return [{ level: "info", text: "Connect Garmin or log activities manually to start building health insights." }];
  }

  // --- Zone-2 weekly target gap ---
  const zones = profile.zones || (profile.max_hr ? defaultZones(profile.max_hr) : null);
  if (zones) {
    const last7Activities = activities.filter((a) => daysAgo(a.date) < 7);
    let zone2Min = 0;
    let zone3Min = 0;
    let totalZoneMin = 0;
    last7Activities.forEach((a) => {
      const est = estimateActivityZoneMinutes(a, zones);
      if (!est) return;
      totalZoneMin += est.minutes;
      if (est.zone.includes("Zone 2")) zone2Min += est.minutes;
      if (est.zone.includes("Zone 3")) zone3Min += est.minutes;
    });
    if (totalZoneMin > 0) {
      const remaining = Math.max(0, ZONE2_WEEKLY_TARGET_MIN - zone2Min);
      if (remaining > 0) {
        const extraSessions = Math.ceil(remaining / 30);
        insights.push({
          level: "watch",
          text: `Zone 2: ${Math.round(zone2Min)} of ${ZONE2_WEEKLY_TARGET_MIN} min this week — ${extraSessions === 1 ? "one more ~30-min easy session" : `about ${extraSessions} more ~30-min easy sessions`} closes the gap.`,
        });
      } else {
        insights.push({ level: "good", text: `Zone 2 target hit: ${Math.round(zone2Min)} of ${ZONE2_WEEKLY_TARGET_MIN} min this week.` });
      }

      // --- Polarization / gray-zone check ---
      const zone3Pct = (zone3Min / totalZoneMin) * 100;
      if (zone3Pct > GRAY_ZONE_WARNING_PCT) {
        insights.push({
          level: "watch",
          text: `${Math.round(zone3Pct)}% of this week's cardio sits in the moderate "gray zone" (Zone 3) — favor easy Zone 2 plus short hard intervals instead for better VO2 max returns.`,
        });
      }
    }
  }

  // --- Resting HR trend: last 7d vs prior 30d baseline ---
  const rhr7 = avg(windowValues(wellness, "resting_hr", 0, 7));
  const rhrBaseline = avg(windowValues(wellness, "resting_hr", 7, 37));
  if (rhr7 != null && rhrBaseline != null) {
    const delta = rhr7 - rhrBaseline;
    if (Math.abs(delta) >= 1) {
      insights.push({
        level: delta < 0 ? "good" : "watch",
        text: `Resting HR trending ${delta < 0 ? "down" : "up"} over 30 days (${rhrBaseline.toFixed(0)} → ${rhr7.toFixed(0)} bpm) — ${delta < 0 ? "good sign" : "worth watching"}.`,
      });
    }
  }

  // --- HRV trend: last 7d vs prior 30d baseline ---
  const hrv7 = avg(windowValues(health, "hrv_avg_ms", 0, 7));
  const hrvBaseline = avg(windowValues(health, "hrv_avg_ms", 7, 37));
  if (hrv7 != null && hrvBaseline != null) {
    const delta = hrv7 - hrvBaseline;
    if (Math.abs(delta) >= 2) {
      insights.push({
        level: delta > 0 ? "good" : "watch",
        text: `HRV trending ${delta > 0 ? "up" : "down"} over 30 days (${hrvBaseline.toFixed(0)} → ${hrv7.toFixed(0)} ms) — ${delta > 0 ? "good sign" : "worth watching"}.`,
      });
    }
  }

  // --- VO2 max trajectory ---
  const vo2Points = health
    .filter((h) => typeof h.vo2max_running === "number" || typeof h.vo2max_cycling === "number")
    .map((h) => ({ date: h.date, value: h.vo2max_running ?? h.vo2max_cycling }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (vo2Points.length >= 3) {
    const delta = vo2Points[vo2Points.length - 1].value - vo2Points[0].value;
    if (Math.abs(delta) >= 0.5) {
      insights.push({
        level: delta > 0 ? "good" : "watch",
        text: `VO2 max ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} over your logged history — ${delta > 0 ? "trending the right way" : "keep an eye on training volume/intensity"}.`,
      });
    }
  } else if (vo2Points.length > 0) {
    insights.push({ level: "info", text: "Too early to call a VO2 max trend yet — keep logging." });
  }

  // --- Missing-data notices ---
  const last7Health = health.filter((h) => daysAgo(h.date) < 7);
  const hasIntensityData = last7Health.some(
    (h) => typeof h.intensity_minutes_moderate === "number" || typeof h.intensity_minutes_vigorous === "number"
  );
  if (health.length > 0 && !hasIntensityData) {
    insights.push({ level: "info", text: "Garmin isn't reporting intensity minutes — check that your watch tracks moderate/vigorous minutes." });
  }

  if (!insights.length) {
    insights.push({ level: "info", text: "Not enough data yet this week to surface trends — check back after a few more days of logging." });
  }

  return insights;
}
