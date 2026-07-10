import { getLocal, refresh, save } from "../state.js";
import { toast } from "../components/toast.js";
import { unitLabel, displayWeight } from "../lib/units.js";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export async function render(container) {
  let log = getLocal("exercise_log");
  let bodyMetrics = getLocal("body_metrics");
  let pendingSets = []; // sets being built for the current strength entry before saving
  const units = unitLabel();

  paint();
  refresh("exercise_log").then((l) => { log = l; paint(); }).catch(() => {});
  refresh("body_metrics").then((b) => { bodyMetrics = b; paint(); }).catch(() => {});

  function latestWeight() {
    return bodyMetrics[bodyMetrics.length - 1] || {};
  }

  function recentExerciseNames() {
    const seen = [];
    for (let i = log.length - 1; i >= 0 && seen.length < 8; i--) {
      const e = log[i];
      if (e.type === "activity") continue;
      if (e.exercise && !seen.includes(e.exercise)) seen.push(e.exercise);
    }
    return seen;
  }

  function recentActivityNames() {
    const seen = [];
    for (let i = log.length - 1; i >= 0 && seen.length < 8; i--) {
      const e = log[i];
      if (e.type !== "activity") continue;
      if (e.exercise && !seen.includes(e.exercise)) seen.push(e.exercise);
    }
    return seen;
  }

  function paint() {
    const today = todayStr();
    const recentEntries = log.slice().reverse().slice(0, 15);
    const recents = recentExerciseNames();
    const recentActivities = recentActivityNames();

    container.innerHTML = `
      <h1>Log</h1>

      <div class="card stack">
        <h2>New entry</h2>
        <label for="ex-date">Date</label>
        <input id="ex-date" type="date" value="${today}" max="${today}" />
        <label for="ex-name">Exercise</label>
        <input id="ex-name" type="text" list="recent-exercises" placeholder="e.g. Bench Press" />
        <datalist id="recent-exercises">
          ${recents.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("")}
        </datalist>
        ${recents.length ? `<div class="row" style="flex-wrap:wrap;gap:6px">${recents
          .map((n) => `<button type="button" class="secondary shortcut" style="min-height:36px;padding:6px 10px;font-size:13px" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`)
          .join("")}</div>` : ""}

        <div class="grid-3">
          <div>
            <label for="set-reps">Reps</label>
            <input id="set-reps" type="number" inputmode="numeric" />
          </div>
          <div>
            <label for="set-weight">Weight (${units})</label>
            <input id="set-weight" type="number" inputmode="decimal" />
          </div>
          <div>
            <label for="set-rpe">RPE</label>
            <input id="set-rpe" type="number" inputmode="numeric" step="0.5" min="1" max="10" />
          </div>
        </div>
        <button id="add-set" class="secondary">+ Add set</button>

        <div id="pending-sets">${renderPendingSets()}</div>

        <label for="ex-note">Note (optional)</label>
        <textarea id="ex-note" placeholder="How did it feel?"></textarea>

        <button id="save-entry">Save entry</button>
      </div>

      <div class="card stack">
        <h2>Log an activity</h2>
        <p style="font-size:13px;color:var(--text-dim)">For anything that isn't sets/reps — BJJ, a run, a hike, a pickup game.</p>
        <label for="act-date">Date</label>
        <input id="act-date" type="date" value="${today}" max="${today}" />
        <label for="act-name">Activity</label>
        <input id="act-name" type="text" list="recent-activities" placeholder="e.g. Brazilian Jiu-Jitsu" />
        <datalist id="recent-activities">
          ${recentActivities.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("")}
        </datalist>
        ${recentActivities.length ? `<div class="row" style="flex-wrap:wrap;gap:6px">${recentActivities
          .map((n) => `<button type="button" class="secondary shortcut-activity" style="min-height:36px;padding:6px 10px;font-size:13px" data-name="${escapeHtml(n)}">${escapeHtml(n)}</button>`)
          .join("")}</div>` : ""}
        <label for="act-duration">Duration (minutes)</label>
        <input id="act-duration" type="number" inputmode="numeric" placeholder="60" />
        <label for="act-note">Note (optional)</label>
        <textarea id="act-note" placeholder="How did it feel?"></textarea>
        <button id="save-activity">Save activity</button>
      </div>

      <div class="card stack">
        <h2>Body weight</h2>
        ${bodyMetrics.length ? `<p style="font-size:13px">Last: <strong>${displayWeight(latestWeight().weight, latestWeight().weight_unit)} ${units}</strong> on ${latestWeight().date}</p>` : `<p style="font-size:13px">No weigh-ins logged yet.</p>`}
        <div class="row">
          <input id="bw-value" type="number" inputmode="decimal" placeholder="Weight (${units})" />
          <button id="log-bw" class="secondary" style="white-space:nowrap">Log</button>
        </div>
      </div>

      <div class="card">
        <h2>Recent entries</h2>
        ${recentEntries.length ? recentEntries.map(renderEntry).join("") : `<p>Nothing logged yet.</p>`}
      </div>
    `;

    const logBwBtn = document.getElementById("log-bw");
    if (logBwBtn) {
      logBwBtn.addEventListener("click", async () => {
        const value = Number(document.getElementById("bw-value").value);
        if (!value) return toast("Enter a weight first", "error");
        const entry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          date: today,
          weight: value,
          weight_unit: units,
          created_at: new Date().toISOString(),
        };
        // One weigh-in per day: replace any existing entry for today.
        const next = [...bodyMetrics.filter((b) => b.date !== today), entry].sort((a, b) => (a.date < b.date ? -1 : 1));
        try {
          await save("body_metrics", next, "log: body weight");
          bodyMetrics = next;
          toast("Weight logged", "success");
          paint();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    }

    container.querySelectorAll(".shortcut").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("ex-name").value = btn.dataset.name;
      });
    });
    container.querySelectorAll(".shortcut-activity").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("act-name").value = btn.dataset.name;
      });
    });

    document.getElementById("add-set").addEventListener("click", () => {
      const reps = Number(document.getElementById("set-reps").value);
      const weight = Number(document.getElementById("set-weight").value) || 0;
      const rpe = Number(document.getElementById("set-rpe").value) || null;
      if (!reps) return toast("Enter reps first", "error");
      pendingSets.push({ reps, weight, rpe, weight_unit: units });
      document.getElementById("set-reps").value = "";
      document.getElementById("set-weight").value = "";
      document.getElementById("set-rpe").value = "";
      document.getElementById("pending-sets").innerHTML = renderPendingSets();
    });

    document.getElementById("save-entry").addEventListener("click", async () => {
      const date = document.getElementById("ex-date").value || today;
      const name = document.getElementById("ex-name").value.trim();
      const note = document.getElementById("ex-note").value.trim();
      if (!name) return toast("Enter an exercise name", "error");
      if (!pendingSets.length) return toast("Add at least one set", "error");
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date,
        exercise: name,
        type: "strength",
        sets: pendingSets,
        note: note || null,
        source: "manual",
        created_at: new Date().toISOString(),
      };
      const next = [...log, entry];
      try {
        await save("exercise_log", next, `log: ${name}`);
        log = next;
        pendingSets = [];
        document.getElementById("ex-note").value = "";
        toast("Logged", "success");
        paint();
      } catch (e) {
        toast(e.message, "error");
      }
    });

    document.getElementById("save-activity").addEventListener("click", async () => {
      const date = document.getElementById("act-date").value || today;
      const name = document.getElementById("act-name").value.trim();
      const duration = Number(document.getElementById("act-duration").value);
      const note = document.getElementById("act-note").value.trim();
      if (!name) return toast("Enter an activity name", "error");
      if (!duration) return toast("Enter a duration in minutes", "error");
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date,
        exercise: name,
        type: "activity",
        duration_minutes: duration,
        sets: [],
        note: note || null,
        source: "manual",
        created_at: new Date().toISOString(),
      };
      const next = [...log, entry];
      try {
        await save("exercise_log", next, `log: ${name}`);
        log = next;
        toast("Logged", "success");
        paint();
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }

  function renderPendingSets() {
    if (!pendingSets.length) return `<p style="font-size:13px">No sets added yet.</p>`;
    return `<div class="stack" style="gap:4px">${pendingSets
      .map((s, i) => `<div class="row" style="font-size:14px"><span>Set ${i + 1}: ${s.reps} reps${s.weight ? ` @ ${s.weight} ${units}` : ""}${s.rpe ? ` (RPE ${s.rpe})` : ""}</span></div>`)
      .join("")}</div>`;
  }

  function renderEntry(e) {
    const dateLabel = e.date === todayStr() ? "Today" : formatDate(e.date);
    if (e.type === "activity") {
      return `<div class="checklist-item">
        <div class="title">${escapeHtml(e.exercise)}</div>
        <div class="meta">${dateLabel} · ${e.duration_minutes} min${e.note ? ` · ${escapeHtml(e.note)}` : ""}</div>
      </div>`;
    }
    const setsText = (e.sets || [])
      .map((s) => `${s.reps}${s.weight ? `@${displayWeight(s.weight, s.weight_unit)}${units}` : ""}`)
      .join(", ");
    return `<div class="checklist-item">
      <div class="title">${escapeHtml(e.exercise)}</div>
      <div class="meta">${dateLabel} · ${setsText}${e.note ? ` · ${escapeHtml(e.note)}` : ""}</div>
    </div>`;
  }
}
