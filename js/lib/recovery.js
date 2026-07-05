// Local computation of recovery/overtraining indicators. Run on every app open (Today view)
// and passed into workout generation + weekly review as plain-language + numeric context.

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
 * Effective training load for an activity. Uses Garmin's own training_load when present; otherwise
 * estimates from duration and average HR so unplanned efforts (e.g. hikes) that Garmin didn't score
 * still count toward weekly load and the acute:chronic ratio.
 */
export function effectiveLoad(a) {
  if (typeof a.training_load === "number") return a.training_load;
  if (typeof a.duration_seconds !== "number") return null;
  const minutes = a.duration_seconds / 60;
  const hr = a.avg_hr;
  let factor = 0.8; // unknown intensity default
  if (typeof hr === "number") {
    if (hr >= 150) factor = 2.0;
    else if (hr >= 130) factor = 1.3;
    else if (hr >= 110) factor = 0.9;
    else factor = 0.6;
  }
  return Math.round(minutes * factor);
}

/**
 * @param {object} data
 * @param {Array} data.wellness - garmin_wellness.json rows {date, resting_hr, sleep_seconds}
 * @param {Array} data.health - garmin_health.json rows {date, hrv_avg_ms}
 * @param {Array} data.activities - garmin_activities.json rows {date, training_load}
 */
export function computeRecoveryStatus({ wellness = [], health = [], activities = [] }) {
  const reasons = [];
  let flagCount = 0;

  // Include unplanned/unscored activities in load by attaching an effective load to each.
  const loadedActivities = activities.map((a) => ({ ...a, _load: effectiveLoad(a) }));

  // --- Resting HR: 7-day avg vs prior-30-day baseline (days 8-37 back) ---
  const rhr7 = avg(windowValues(wellness, "resting_hr", 0, 7));
  const rhrBaseline = avg(windowValues(wellness, "resting_hr", 7, 37));
  const rhrElevatedDays = wellness.filter((r) => {
    const d = daysAgo(r.date);
    return d >= 0 && d < 7 && typeof r.resting_hr === "number" && rhrBaseline && r.resting_hr > rhrBaseline + 3;
  }).length;
  let rhrFlag = false;
  if (rhr7 != null && rhrBaseline != null) {
    if (rhrElevatedDays >= 3) {
      rhrFlag = true;
      reasons.push(
        `Resting heart rate has been elevated on ${rhrElevatedDays} of the last 7 days (avg ${rhr7.toFixed(1)} bpm vs your ~${rhrBaseline.toFixed(1)} bpm baseline) — a classic early sign of accumulating fatigue.`
      );
    }
  }
  if (rhrFlag) flagCount++;

  // --- Sleep: 7-day avg vs 30-day baseline ---
  const sleep7 = avg(windowValues(wellness, "sleep_seconds", 0, 7));
  const sleepBaseline = avg(windowValues(wellness, "sleep_seconds", 7, 37));
  let sleepFlag = false;
  if (sleep7 != null && sleepBaseline != null) {
    const deltaMin = (sleep7 - sleepBaseline) / 60;
    if (deltaMin <= -30) {
      sleepFlag = true;
      reasons.push(
        `Sleep is trending down — averaging ${(sleep7 / 3600).toFixed(1)}h/night this week vs your ~${(sleepBaseline / 3600).toFixed(1)}h baseline (${Math.round(deltaMin)} min less).`
      );
    }
  }
  if (sleepFlag) flagCount++;

  // --- HRV: suppressed for multiple days vs baseline ---
  const hrv7 = avg(windowValues(health, "hrv_avg_ms", 0, 7));
  const hrvBaseline = avg(windowValues(health, "hrv_avg_ms", 7, 37));
  const hrvSuppressedDays = health.filter((r) => {
    const d = daysAgo(r.date);
    return d >= 0 && d < 7 && typeof r.hrv_avg_ms === "number" && hrvBaseline && r.hrv_avg_ms < hrvBaseline * 0.9;
  }).length;
  let hrvFlag = false;
  if (hrv7 != null && hrvBaseline != null && hrvSuppressedDays >= 3) {
    hrvFlag = true;
    reasons.push(
      `HRV has been suppressed on ${hrvSuppressedDays} of the last 7 nights (avg ${hrv7.toFixed(0)}ms vs your ~${hrvBaseline.toFixed(0)}ms baseline) — your nervous system is signaling it hasn't fully recovered.`
    );
  }
  if (hrvFlag) flagCount++;

  // --- Acute:chronic training load ratio (7-day vs 28-day) ---
  // Uses effective load so unplanned activities (hikes etc.) are included.
  const acute = avg(windowValues(loadedActivities, "_load", 0, 7));
  const chronic = avg(windowValues(loadedActivities, "_load", 0, 28));
  let loadRatio = null;
  let loadFlag = false;
  let loadFlagLevel = null;
  if (acute != null && chronic != null && chronic > 0) {
    loadRatio = acute / chronic;
    if (loadRatio > 1.5) {
      loadFlag = true;
      loadFlagLevel = "red";
      reasons.push(
        `Training load has spiked — your 7-day load is running ${loadRatio.toFixed(2)}x your 28-day average, well above the ~1.3x injury-risk threshold.`
      );
    } else if (loadRatio > 1.3) {
      loadFlag = true;
      loadFlagLevel = "yellow";
      reasons.push(`Training load ratio is ${loadRatio.toFixed(2)}x (acute:chronic) — trending high, worth watching.`);
    }
  }
  if (loadFlag) flagCount++;

  let level = "green";
  if (flagCount >= 2 || loadFlagLevel === "red") level = "red";
  else if (flagCount === 1) level = "yellow";

  if (level === "green" && !reasons.length) {
    reasons.push("Resting HR, sleep, HRV, and training load all look within your normal range.");
  }

  return {
    level,
    reasons,
    metrics: {
      resting_hr_7d: rhr7,
      resting_hr_baseline: rhrBaseline,
      sleep_7d_hours: sleep7 != null ? sleep7 / 3600 : null,
      sleep_baseline_hours: sleepBaseline != null ? sleepBaseline / 3600 : null,
      hrv_7d: hrv7,
      hrv_baseline: hrvBaseline,
      acute_load: acute,
      chronic_load: chronic,
      load_ratio: loadRatio,
    },
  };
}
