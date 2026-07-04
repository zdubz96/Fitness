import { getLocal, refresh, save } from "../state.js";
import { lineChart, barChart } from "../lib/charts.js";
import { estimateGoalProgress } from "../lib/goals.js";
import { toast } from "../components/toast.js";
import { unitLabel, displayWeight } from "../lib/units.js";

function daysAgo(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function epley1RM(weight, reps) {
  if (!weight || !reps) return null;
  return weight * (1 + reps / 30);
}

export async function render(container) {
  let log = getLocal("exercise_log");
  let activities = getLocal("garmin_activities");
  let wellness = getLocal("garmin_wellness");
  let reviews = getLocal("weekly_reviews");
  let goals = getLocal("goals");
  let bodyMetrics = getLocal("body_metrics");
  const units = unitLabel();

  paint();
  Promise.all([refresh("exercise_log"), refresh("garmin_activities"), refresh("garmin_wellness"), refresh("weekly_reviews"), refresh("goals"), refresh("body_metrics")])
    .then(([l, a, w, r, g, b]) => { log = l; activities = a; wellness = w; reviews = r; goals = g; bodyMetrics = b; paint(); })
    .catch(() => {});

  function paint() {
    // Volume in the current display unit (convert each set's weight from the unit it was logged in).
    const volumeSeries = weekBuckets(log, (e) => e.date, (e) =>
      e.sets.reduce((sum, s) => sum + (s.reps || 0) * (displayWeight(s.weight, s.weight_unit) || 0), 0)
    );

    const bodyWeightSeries = bodyMetrics
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((b) => ({ value: displayWeight(b.weight, b.weight_unit) }));

    const exerciseCounts = {};
    log.forEach((e) => { exerciseCounts[e.exercise] = (exerciseCounts[e.exercise] || 0) + 1; });
    const topExercises = Object.entries(exerciseCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);

    const cardioSeries = weekBuckets(activities, (a) => a.date, (a) => (a.duration_seconds || 0) / 60);
    const rhrSeries = wellness
      .filter((w) => daysAgo(w.date) < 90)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((w) => ({ value: w.resting_hr }));

    container.innerHTML = `
      <h1>Progress</h1>

      <div class="card">
        <h2>Volume (weekly, 12wk · ${units})</h2>
        ${barChart(volumeSeries, { height: 100 })}
      </div>

      <div class="card">
        <h2>Body weight (${units})</h2>
        ${bodyWeightSeries.length ? lineChart(bodyWeightSeries, { height: 90, color: "#fbbf24" }) : `<p>Log your body weight in the Log tab to see a trend.</p>`}
      </div>

      <div class="card">
        <h2>Estimated 1RM trends</h2>
        ${topExercises.length ? topExercises.map((name) => renderOneRMTrend(name)).join("") : `<p>Log some sets with weight to see 1RM trends.</p>`}
      </div>

      <div class="card">
        <h2>Weekly cardio minutes</h2>
        ${barChart(cardioSeries, { height: 100, color: "#34d399" })}
      </div>

      <div class="card">
        <h2>Resting HR trend</h2>
        ${lineChart(rhrSeries, { height: 90, color: "#34d399" })}
      </div>

      <div class="card">
        <h2>Goals</h2>
        <div id="goals-list" class="stack">${goals.length ? goals.map(renderGoal).join("") : `<p>No goals yet.</p>`}</div>
        <label for="new-goal">Add a goal</label>
        <div class="row">
          <input id="new-goal" type="text" placeholder="e.g. Squat 1.5x bodyweight" />
        </div>
        <select id="new-goal-type" style="margin-top:8px">
          <option value="strength">Strength</option>
          <option value="cardio">Cardiovascular</option>
          <option value="weight">Body weight</option>
          <option value="other">Other</option>
        </select>
        <button id="add-goal" style="margin-top:8px">Add goal</button>
      </div>

      <div class="card">
        <h2>Coach Review archive</h2>
        ${reviews.length ? reviews.slice().reverse().map(renderReview).join("") : `<p>No weekly reviews yet.</p>`}
      </div>
    `;

    document.getElementById("add-goal").addEventListener("click", async () => {
      const input = document.getElementById("new-goal");
      const text = input.value.trim();
      if (!text) return;
      const type = document.getElementById("new-goal-type").value;
      const goal = { id: `${Date.now()}`, text, type, created_at: new Date().toISOString() };
      const next = [...goals, goal];
      try {
        await save("goals", next, `chore: add goal ${text}`);
        goals = next;
        toast("Goal added", "success");
        paint();
      } catch (e) {
        toast(e.message, "error");
      }
    });

    container.querySelectorAll(".estimate-progress").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const goalId = btn.dataset.id;
        const goal = goals.find((g) => g.id === goalId);
        btn.disabled = true;
        btn.textContent = "Estimating...";
        try {
          await estimateGoalProgress(goal);
          goals = getLocal("goals");
          paint();
        } catch (e) {
          toast(e.message, "error");
          btn.disabled = false;
          btn.textContent = "Estimate progress";
        }
      });
    });
  }

  function renderOneRMTrend(name) {
    const entries = log
      .filter((e) => e.exercise === name)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const series = entries.map((e) => {
      const best = Math.max(...e.sets.map((s) => epley1RM(displayWeight(s.weight, s.weight_unit), s.reps) || 0));
      return { value: best || null };
    });
    const latest = [...series].reverse().find((p) => p.value)?.value;
    return `<div style="margin-bottom:14px">
      <div class="row"><strong>${escapeHtml(name)}</strong>${latest ? `<span>${latest.toFixed(0)} ${units} est. 1RM</span>` : ""}</div>
      ${lineChart(series, { height: 80 })}
    </div>`;
  }

  function renderGoal(g) {
    return `<div class="checklist-item">
      <div class="row">
        <div>
          <div class="title">${escapeHtml(g.text)}</div>
          <div class="meta">${escapeHtml(g.type)}</div>
        </div>
        <button class="ghost estimate-progress" data-id="${g.id}">Estimate progress</button>
      </div>
      ${g.progress ? `<div style="margin-top:8px">
        ${typeof g.progress.progress_pct === "number" ? `<div style="background:var(--bg-elev);border-radius:6px;height:8px;overflow:hidden"><div style="width:${g.progress.progress_pct}%;background:var(--accent);height:100%"></div></div>` : ""}
        <p style="font-size:13px;margin-top:6px">${escapeHtml(g.progress.summary)}</p>
      </div>` : ""}
    </div>`;
  }

  function renderReview(r) {
    return `<div class="checklist-item">
      <div class="title">${escapeHtml(r.week)}</div>
      <p><strong>Progress:</strong> ${escapeHtml(r.progress)}</p>
      <p><strong>Wins:</strong> ${escapeHtml(r.wins)}</p>
      <p><strong>Adjustments:</strong> ${escapeHtml(r.adjustments)}</p>
      <p><strong>Next week:</strong> ${escapeHtml(r.next_week_focus)}</p>
      ${r.cardio_notes ? `<p><strong>Cardio:</strong> ${escapeHtml(r.cardio_notes)}</p>` : ""}
    </div>`;
  }
}

function weekBuckets(rows, dateFn, valueFn) {
  const buckets = {};
  rows.forEach((r) => {
    const d = daysAgo(dateFn(r));
    if (d >= 84 || d < 0) return;
    const weekIdx = Math.floor(d / 7);
    buckets[weekIdx] = (buckets[weekIdx] || 0) + valueFn(r);
  });
  return Array.from({ length: 12 }, (_, i) => ({ value: buckets[11 - i] || 0 }));
}
