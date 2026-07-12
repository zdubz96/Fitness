import { getLocal, refresh } from "../state.js";
import { lineChart, lineChartWithBands, barChart, hasEnoughPoints } from "../lib/charts.js";
import { getVO2MaxBands, classifyVO2Max } from "../lib/vo2max.js";
import { defaultZones, estimateActivityZoneMinutes } from "../lib/zones.js";
import { generateQuarterlyCardioReport } from "../lib/cardioreport.js";
import { computeHealthInsights } from "../lib/health_insights.js";
import { toast } from "../components/toast.js";

const ZONE2_WEEKLY_TARGET_MIN = 150;
const WHO_INTENSITY_TARGET_MIN = 150;
const GRAY_ZONE_WARNING_PCT = 30;

// HT-6: one color per zone, used everywhere a zone is drawn.
const ZONE_COLORS = {
  "Zone 1 (Recovery)": "#97a6bd",
  "Zone 2 (Easy/Base)": "#34d399",
  "Zone 3 (Moderate)": "#fbbf24",
  "Zone 4 (Threshold)": "#fb923c",
  "Zone 5 (VO2 Max)": "#f87171",
};

const INSIGHT_DOT = { good: "🟢", watch: "🟡", info: "⚪" };

function daysAgo(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function avg(nums) {
  const clean = nums.filter((n) => typeof n === "number" && !Number.isNaN(n));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}
function windowRows(rows, field, fromDaysAgo, toDaysAgo) {
  return rows
    .filter((r) => {
      const d = daysAgo(r.date);
      return d >= fromDaysAgo && d < toDaysAgo;
    })
    .map((r) => r[field])
    .filter((v) => typeof v === "number");
}

function vo2BadgeClass(cls) {
  if (cls === "Below average") return "red";
  if (cls === "Average") return "yellow";
  return "green"; // Good / Excellent
}

/** HT-3: a compact trend delta chip, e.g. "↓3 vs prior 30d". `goodDirection` is -1 (down=good, e.g. RHR) or +1 (up=good, e.g. HRV). */
function deltaChip(current, baseline, goodDirection, unit = "") {
  if (current == null || baseline == null) return "";
  const delta = current - baseline;
  if (Math.abs(delta) < 0.5) return `<span class="badge yellow">steady vs prior 30d</span>`;
  const improving = Math.sign(delta) === goodDirection || (goodDirection < 0 && delta < 0) || (goodDirection > 0 && delta > 0);
  const arrow = delta > 0 ? "↑" : "↓";
  const cls = improving ? "green" : "red";
  return `<span class="badge ${cls}">${arrow}${Math.abs(delta).toFixed(1)}${unit} vs prior 30d</span>`;
}

export async function render(container) {
  let health = getLocal("garmin_health");
  let wellness = getLocal("garmin_wellness");
  let activities = getLocal("garmin_activities");
  const profile = getLocal("trainer_profile") || {};

  paint();
  Promise.all([refresh("garmin_health"), refresh("garmin_wellness"), refresh("garmin_activities")])
    .then(([h, w, a]) => { health = h; wellness = w; activities = a; paint(); })
    .catch(() => {});

  function paint() {
    const last90Health = health.filter((h) => daysAgo(h.date) < 90).sort((a, b) => (a.date < b.date ? -1 : 1));
    const last90Wellness = wellness.filter((w) => daysAgo(w.date) < 90).sort((a, b) => (a.date < b.date ? -1 : 1));

    const vo2Series = last90Health
      .filter((h) => typeof h.vo2max_running === "number" || typeof h.vo2max_cycling === "number")
      .map((h) => ({ date: h.date, value: h.vo2max_running ?? h.vo2max_cycling }));
    const latestVo2 = vo2Series[vo2Series.length - 1];
    const vo2Value = latestVo2?.value ?? null;
    const bands = profile.age ? getVO2MaxBands(profile.age, profile.sex, vo2Value) : [];
    const vo2Class = vo2Value != null && profile.age ? classifyVO2Max(vo2Value, profile.age, profile.sex) : null;

    const rhrSeries = last90Wellness.map((w) => ({ date: w.date, value: w.resting_hr }));
    const hrvSeries = last90Health.map((h) => ({ date: h.date, value: h.hrv_avg_ms }));

    const rhr7 = avg(windowRows(wellness, "resting_hr", 0, 7));
    const rhrBaseline = avg(windowRows(wellness, "resting_hr", 7, 37));
    const hrv7 = avg(windowRows(health, "hrv_avg_ms", 0, 7));
    const hrvBaseline = avg(windowRows(health, "hrv_avg_ms", 7, 37));

    const zones = profile.zones || (profile.max_hr ? defaultZones(profile.max_hr) : null);
    const last7Activities = activities.filter((a) => daysAgo(a.date) < 7);
    const zoneMinutes = {};
    let zone2Minutes = 0;
    let zone3Minutes = 0;
    let totalZoneMinutes = 0;
    if (zones) {
      zones.forEach((z) => { zoneMinutes[z.name] = 0; }); // HT-5: always show all 5 zones, incl. zeros
      last7Activities.forEach((a) => {
        const est = estimateActivityZoneMinutes(a, zones);
        if (!est) return;
        zoneMinutes[est.zone] = (zoneMinutes[est.zone] || 0) + est.minutes;
        totalZoneMinutes += est.minutes;
        if (est.zone.includes("Zone 2")) zone2Minutes += est.minutes;
        if (est.zone.includes("Zone 3")) zone3Minutes += est.minutes;
      });
    }
    const grayZoneFlag = totalZoneMinutes > 0 && (zone3Minutes / totalZoneMinutes) * 100 > GRAY_ZONE_WARNING_PCT;

    // HT-5: distinguish "Garmin sent no intensity data" from "you did zero intensity minutes".
    const last7Health = health.filter((h) => daysAgo(h.date) < 7);
    const hasIntensityData = last7Health.some(
      (h) => typeof h.intensity_minutes_moderate === "number" || typeof h.intensity_minutes_vigorous === "number"
    );
    const weeklyIntensityMinutes = last7Health.reduce(
      (sum, h) => sum + (h.intensity_minutes_moderate || 0) + 2 * (h.intensity_minutes_vigorous || 0),
      0
    );
    const weeklyIntensitySeries = weekBuckets(health, (h) => (h.intensity_minutes_moderate || 0) + 2 * (h.intensity_minutes_vigorous || 0));

    const reports = profile.cardio_reports || [];
    const latestReport = reports[reports.length - 1];

    const insights = computeHealthInsights({ wellness, health, activities, profile });

    container.innerHTML = `
      <h1>Health</h1>

      <div class="card stack">
        <h2 style="margin:0">This week</h2>
        ${insights.map((i) => `<div class="row" style="align-items:flex-start;gap:8px"><span>${INSIGHT_DOT[i.level] || "⚪"}</span><span style="font-size:13px;flex:1">${escapeHtml(i.text)}</span></div>`).join("")}
      </div>

      <div class="card">
        <div class="row"><h2 style="margin:0">VO2 Max</h2><span style="font-size:11px;color:var(--text-dim)">Last 90 days</span></div>
        ${vo2Value != null ? `
          <div class="row" style="margin-top:6px">
            <div style="font-size:28px;font-weight:800">${vo2Value.toFixed(1)}</div>
            ${vo2Class ? `<span class="badge ${vo2BadgeClass(vo2Class)}">${vo2Class}</span>` : ""}
          </div>
          ${bands.length && vo2Class ? `<p style="font-size:12px;color:var(--text-dim);margin:2px 0 0">${vo2BandPositionText(vo2Value, bands, vo2Class)}</p>` : ""}
        ` : `<p>No VO2 max data yet.</p>`}
        ${bands.length && hasEnoughPoints(vo2Series, 2) ? lineChartWithBands(vo2Series, bands) : ""}
        ${!bands.length && hasEnoughPoints(vo2Series) ? lineChart(vo2Series) : ""}
        ${vo2Value != null && !hasEnoughPoints(vo2Series, 2) ? `<p style="font-size:12px;color:var(--text-dim)">Not enough history for a trend yet.</p>` : ""}
        ${!profile.age ? `<p style="font-size:12px">Set your age in onboarding/profile to see percentile bands.</p>` : ""}
      </div>

      <div class="card">
        <div class="row"><h2 style="margin:0">Resting Heart Rate</h2><span style="font-size:11px;color:var(--text-dim)">Last 90 days</span></div>
        ${rhr7 != null ? `<div class="row" style="margin-top:6px"><div style="font-size:24px;font-weight:800">${rhr7.toFixed(0)} bpm</div>${deltaChip(rhr7, rhrBaseline, -1)}</div>` : `<p>No resting HR data yet.</p>`}
        ${hasEnoughPoints(rhrSeries) ? lineChart(rhrSeries, { height: 100, color: "#34d399" }) : rhr7 != null ? `<p style="font-size:12px;color:var(--text-dim)">Not enough history for a trend yet.</p>` : ""}
      </div>

      <div class="card">
        <div class="row"><h2 style="margin:0">HRV</h2><span style="font-size:11px;color:var(--text-dim)">Last 90 days</span></div>
        ${hrv7 != null ? `<div class="row" style="margin-top:6px"><div style="font-size:24px;font-weight:800">${hrv7.toFixed(0)} ms</div>${deltaChip(hrv7, hrvBaseline, 1)}</div>` : `<p>No HRV data yet.</p>`}
        ${hasEnoughPoints(hrvSeries) ? lineChart(hrvSeries, { height: 100, color: "#fbbf24" }) : hrv7 != null ? `<p style="font-size:12px;color:var(--text-dim)">Not enough history for a trend yet.</p>` : ""}
      </div>

      <div class="card">
        <div class="row"><h2 style="margin:0">Intensity Minutes</h2><span style="font-size:11px;color:var(--text-dim)">Last 7 days</span></div>
        ${hasIntensityData ? `
          <div class="row" style="margin-top:6px"><div style="font-size:24px;font-weight:800">${Math.round(weeklyIntensityMinutes)} / ${WHO_INTENSITY_TARGET_MIN} min</div><span style="font-size:11px;color:var(--text-dim)">WHO guideline</span></div>
          ${barChart(weeklyIntensitySeries, { target: WHO_INTENSITY_TARGET_MIN, height: 100 })}
        ` : `<p>No intensity-minutes data from Garmin yet.</p>`}
      </div>

      <div class="card">
        <div class="row"><h2 style="margin:0">Zone Distribution</h2><span style="font-size:11px;color:var(--text-dim)">Last 7 days</span></div>
        ${zones ? `
          <p style="font-size:11px;color:var(--text-dim);margin-top:0">Estimated from each activity's average heart rate — treat as approximate.</p>
          <div class="row" style="font-size:13px;margin-top:4px"><span>Zone 2 progress</span><span>${Math.round(zone2Minutes)} / ${ZONE2_WEEKLY_TARGET_MIN} min</span></div>
          <div style="background:var(--bg-elev-2);border-radius:6px;height:8px;overflow:hidden;margin-top:4px"><div style="width:${Math.min(100, Math.round((zone2Minutes / ZONE2_WEEKLY_TARGET_MIN) * 100))}%;background:${ZONE_COLORS["Zone 2 (Easy/Base)"]};height:100%"></div></div>
          <div style="margin-top:14px">${renderZoneBreakdown(zoneMinutes, totalZoneMinutes, grayZoneFlag)}</div>
        ` : `<p>Set your max HR in Settings to enable zone tracking.</p>`}
      </div>

      <div class="card">
        <h2>Quarterly Cardio Report</h2>
        ${latestReport ? `<p style="font-size:12px;color:var(--text-dim)">Generated ${new Date(latestReport.at).toLocaleDateString()}</p><p>${escapeHtml(latestReport.text)}</p>` : `<p>No report yet.</p>`}
        <button id="gen-cardio-report" class="secondary">Generate report</button>
        ${reports.length > 1 ? `<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--text-dim)">Past reports (${reports.length - 1})</summary>${reports.slice(0, -1).reverse().map((r) => `<div class="checklist-item"><div class="meta">${new Date(r.at).toLocaleDateString()}</div><p>${escapeHtml(r.text)}</p></div>`).join("")}</details>` : ""}
      </div>
    `;

    document.getElementById("gen-cardio-report").addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Generating...";
      try {
        await generateQuarterlyCardioReport();
        toast("Cardio report generated", "success");
        paint();
      } catch (err) {
        toast(err.message, "error");
        e.target.disabled = false;
        e.target.textContent = "Generate report";
      }
    });
  }

  function renderZoneBreakdown(zoneMinutes, total, grayZoneFlag) {
    return Object.entries(zoneMinutes)
      .map(([zone, minutes]) => {
        const pct = total > 0 ? Math.round((minutes / total) * 100) : 0;
        const color = ZONE_COLORS[zone] || "var(--accent)";
        const isGrayZone = grayZoneFlag && zone.includes("Zone 3");
        return `<div style="margin-bottom:10px">
          <div class="row" style="font-size:13px">
            <span>${escapeHtml(zone)}${isGrayZone ? ` <span class="badge yellow" style="font-size:10px">gray zone</span>` : ""}</span>
            <span>${Math.round(minutes)} min</span>
          </div>
          <div style="background:var(--bg-elev-2);border-radius:6px;height:8px;overflow:hidden;margin-top:3px"><div style="width:${pct}%;background:${color};height:100%"></div></div>
        </div>`;
      })
      .join("");
  }
}

function vo2BandPositionText(value, bands, cls) {
  const band = bands.find((b) => b.label.toLowerCase() === cls.toLowerCase());
  if (!band) return "";
  if (cls === "Excellent") return `Excellent for your age/sex — ${(value - band.low).toFixed(1)} above the Excellent threshold.`;
  const gap = band.high - value;
  const nextBand = bands[bands.indexOf(band) + 1];
  return nextBand ? `${gap.toFixed(1)} below ${nextBand.label} for your age/sex.` : "";
}

function weekBuckets(rows, valueFn) {
  const buckets = {};
  rows.forEach((r) => {
    const d = daysAgo(r.date);
    if (d >= 84) return;
    const weekIdx = Math.floor(d / 7);
    buckets[weekIdx] = (buckets[weekIdx] || 0) + valueFn(r);
  });
  return Array.from({ length: 12 }, (_, i) => ({ value: buckets[11 - i] || 0 }));
}
