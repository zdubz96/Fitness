import { getLocal, refresh } from "../state.js";
import { lineChart, lineChartWithBands, barChart } from "../lib/charts.js";
import { getVO2MaxBands, classifyVO2Max } from "../lib/vo2max.js";
import { defaultZones, estimateActivityZoneMinutes } from "../lib/zones.js";
import { generateQuarterlyCardioReport } from "../lib/cardioreport.js";
import { toast } from "../components/toast.js";

const ZONE2_WEEKLY_TARGET_MIN = 150;
const WHO_INTENSITY_TARGET_MIN = 150;

function daysAgo(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function vo2BadgeClass(cls) {
  if (cls === "Below average") return "red";
  if (cls === "Average") return "yellow";
  return "green"; // Good / Excellent
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

    const vo2Series = last90Health.map((h) => ({ value: h.vo2max_running || h.vo2max_cycling }));
    const latestVo2 = [...last90Health].reverse().find((h) => h.vo2max_running || h.vo2max_cycling);
    const vo2Value = latestVo2?.vo2max_running || latestVo2?.vo2max_cycling;
    const bands = profile.age ? getVO2MaxBands(profile.age, profile.sex, vo2Value) : [];
    const vo2Class = vo2Value && profile.age ? classifyVO2Max(vo2Value, profile.age, profile.sex) : null;

    const rhrSeries = last90Wellness.map((w) => ({ value: w.resting_hr }));
    const hrvSeries = last90Health.map((h) => ({ value: h.hrv_avg_ms }));

    const zones = profile.zones || (profile.max_hr ? defaultZones(profile.max_hr) : null);
    const last7Activities = activities.filter((a) => daysAgo(a.date) < 7);
    const zoneMinutes = {};
    let zone2Minutes = 0;
    if (zones) {
      last7Activities.forEach((a) => {
        const est = estimateActivityZoneMinutes(a, zones);
        if (!est) return;
        zoneMinutes[est.zone] = (zoneMinutes[est.zone] || 0) + est.minutes;
        if (est.zone.includes("Zone 2")) zone2Minutes += est.minutes;
      });
    }

    const last7Health = health.filter((h) => daysAgo(h.date) < 7);
    const weeklyIntensityMinutes = last7Health.reduce(
      (sum, h) => sum + (h.intensity_minutes_moderate || 0) + 2 * (h.intensity_minutes_vigorous || 0),
      0
    );

    const weeklyIntensitySeries = weekBuckets(health, (h) => (h.intensity_minutes_moderate || 0) + 2 * (h.intensity_minutes_vigorous || 0));

    const reports = profile.cardio_reports || [];
    const latestReport = reports[reports.length - 1];

    container.innerHTML = `
      <h1>Health</h1>

      <div class="card">
        <h2>VO2 Max</h2>
        ${vo2Value ? `<div class="row"><div style="font-size:28px;font-weight:800">${vo2Value.toFixed(1)}</div>${vo2Class ? `<span class="badge ${vo2BadgeClass(vo2Class)}">${vo2Class}</span>` : ""}</div>` : `<p>No VO2 max data yet.</p>`}
        ${bands.length ? lineChartWithBands(vo2Series, bands) : (vo2Series.length ? lineChart(vo2Series) : "")}
        ${!profile.age ? `<p style="font-size:12px">Set your age in onboarding/profile to see percentile bands.</p>` : ""}
      </div>

      <div class="card">
        <h2>Cardio Dashboard</h2>
        <div class="grid-2">
          <div>
            <div style="font-size:12px;color:var(--text-dim)">Resting HR (90d)</div>
            ${lineChart(rhrSeries, { height: 90, color: "#34d399" })}
          </div>
          <div>
            <div style="font-size:12px;color:var(--text-dim)">HRV avg (90d)</div>
            ${lineChart(hrvSeries, { height: 90, color: "#fbbf24" })}
          </div>
        </div>
        <div style="margin-top:12px">
          <div class="row"><span style="font-size:13px">Zone 2 minutes (7d)</span><span style="font-size:13px">${Math.round(zone2Minutes)} / ${ZONE2_WEEKLY_TARGET_MIN} min</span></div>
          <div style="margin-top:12px" class="row"><span style="font-size:13px">Intensity minutes (7d)</span><span style="font-size:13px">${Math.round(weeklyIntensityMinutes)} / ${WHO_INTENSITY_TARGET_MIN} min (WHO)</span></div>
          ${barChart(weeklyIntensitySeries, { target: WHO_INTENSITY_TARGET_MIN, height: 90 })}
        </div>
      </div>

      <div class="card">
        <h2>Zone Distribution (7d)</h2>
        ${zones ? renderZoneBreakdown(zoneMinutes) : `<p>Set your max HR in Settings to enable zone tracking.</p>`}
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

  function renderZoneBreakdown(zoneMinutes) {
    const total = Object.values(zoneMinutes).reduce((a, b) => a + b, 0);
    if (!total) return `<p>No zone data from the last 7 days yet.</p>`;
    return Object.entries(zoneMinutes)
      .map(([zone, minutes]) => {
        const pct = Math.round((minutes / total) * 100);
        return `<div style="margin-bottom:8px">
          <div class="row" style="font-size:13px"><span>${escapeHtml(zone)}</span><span>${Math.round(minutes)} min</span></div>
          <div style="background:var(--bg-elev-2);border-radius:6px;height:8px;overflow:hidden"><div style="width:${pct}%;background:var(--accent);height:100%"></div></div>
        </div>`;
      })
      .join("");
  }
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
