import { getLocal, refresh, save } from "../state.js";
import { computeRecoveryStatus, effectiveLoad } from "../lib/recovery.js";
import { showRestTimer } from "../components/timer.js";
import { toast } from "../components/toast.js";
import { unitLabel, displayWeight } from "../lib/units.js";
import { requestExerciseAdjustment, applyAdjustmentToTodaysWorkout } from "../lib/adjust.js";
import { needsWeeklyReview, generateWeeklyReview } from "../lib/weeklyreview.js";
import {
  generateWeeklyProgram,
  programDays,
  activeProgram,
  setDayStatus,
  readjustRemainingWeek,
  todayStr,
} from "../lib/program.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function dowLabel(dateStr) {
  return DOW[new Date(dateStr + "T00:00:00").getDay()];
}

const STATUS_DOT = { completed: "🟢", missed: "🔴", rest: "⚪", planned: "🔵" };

export async function render(container) {
  let wellness = getLocal("garmin_wellness");
  let health = getLocal("garmin_health");
  let activities = getLocal("garmin_activities");
  let workouts = getLocal("workouts");
  let reviews = getLocal("weekly_reviews");
  let selectedDate = todayStr();

  paint();

  Promise.all([refresh("garmin_wellness"), refresh("garmin_health"), refresh("garmin_activities"), refresh("workouts"), refresh("trainer_profile")])
    .then(([w, h, a, wk]) => {
      wellness = w; health = h; activities = a; workouts = wk;
      paint();
    })
    .catch((e) => console.warn("Today refresh failed", e));

  function paint() {
    const recovery = computeRecoveryStatus({ wellness, health, activities });
    const today = todayStr();
    const todaysWellness = wellness.find((w) => w.date === today) || {};
    const recent7Load = activities.slice(-7).reduce((s, a) => s + (effectiveLoad(a) || 0), 0);

    const showReviewBanner = needsWeeklyReview(reviews);
    const profile = getLocal("trainer_profile") || {};
    const showAssessmentBanner = !profile.baseline;
    const program = activeProgram();
    const days = programDays();
    if (!days.some((d) => d.date === selectedDate)) selectedDate = today;
    const selected = days.find((d) => d.date === selectedDate);

    container.innerHTML = `
      <h1>Today</h1>

      ${showAssessmentBanner ? `<div class="card" style="border-color:var(--accent)">
        <div class="row">
          <div><strong>${profile.pending_assessment ? "Diagnostic in progress" : "Get your baseline"}</strong><p style="margin:2px 0 0">${profile.pending_assessment ? "Finish your diagnostic session and record results." : "Do a one-off diagnostic session so your coach knows exactly where you're starting from."}</p></div>
          <a href="#/assessment"><button class="secondary">${profile.pending_assessment ? "Continue" : "Start"}</button></a>
        </div>
      </div>` : ""}

      ${showReviewBanner ? `<div class="card" style="border-color:var(--accent)">
        <div class="row">
          <div><strong>New week</strong><p style="margin:2px 0 0">Your weekly Coach Review is ready to generate.</p></div>
          <button id="gen-review" class="secondary">Generate</button>
        </div>
      </div>` : ""}

      <div class="card" id="recovery-card" style="cursor:pointer">
        <div class="row">
          <h2 style="margin:0">Recovery</h2>
          <span class="badge ${recovery.level}">${recovery.level === "green" ? "Ready" : recovery.level === "yellow" ? "Caution" : "Fatigued"}</span>
        </div>
        <p style="margin:8px 0 0;font-size:13px">Tap for details</p>
      </div>

      <div class="grid-3">
        <div class="card" style="margin:0;text-align:center">
          <div style="font-size:12px;color:var(--text-dim)">Sleep</div>
          <div style="font-size:20px;font-weight:700">${todaysWellness.sleep_seconds ? (todaysWellness.sleep_seconds / 3600).toFixed(1) + "h" : "—"}</div>
        </div>
        <div class="card" style="margin:0;text-align:center">
          <div style="font-size:12px;color:var(--text-dim)">Resting HR</div>
          <div style="font-size:20px;font-weight:700">${todaysWellness.resting_hr ?? "—"}</div>
        </div>
        <div class="card" style="margin:0;text-align:center">
          <div style="font-size:12px;color:var(--text-dim)">7d Load</div>
          <div style="font-size:20px;font-weight:700">${recent7Load ? Math.round(recent7Load) : "—"}</div>
        </div>
      </div>

      ${program ? renderProgram(days, selected, today) : renderNoProgram()}
    `;

    document.getElementById("recovery-card").addEventListener("click", () => showRecoveryModal(recovery));
    wireReviewBanner();
    if (program) wireProgram(days, selected, today);
    else wireGenerateProgram();
  }

  function renderNoProgram() {
    return `<div class="card stack">
      <h2>This week's program</h2>
      <p>Your coach will build a rolling 7-day plan from today — training days, rest days, and specific exercises tailored to your schedule, goals, and recovery.</p>
      <button id="gen-program">Generate this week's program</button>
    </div>`;
  }

  function renderProgram(days, selected, today) {
    const strip = days
      .map((d) => {
        const isSel = d.date === selectedDate;
        const isToday = d.date === today;
        const dot = STATUS_DOT[d.status] || STATUS_DOT.planned;
        return `<button type="button" class="day-chip ${isSel ? "sel" : ""}" data-date="${d.date}"
          style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:64px;padding:8px 6px;border-radius:12px;border:1px solid ${isSel ? "var(--accent)" : "var(--border)"};background:${isSel ? "var(--bg-elev-2)" : "var(--bg-elev)"};color:var(--text)">
          <span style="font-size:11px;color:var(--text-dim)">${dowLabel(d.date)}${isToday ? " •" : ""}</span>
          <span style="font-size:15px">${dot}</span>
          <span style="font-size:10px;color:var(--text-dim);max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.is_rest_day ? "Rest" : d.focus)}</span>
        </button>`;
      })
      .join("");

    return `
      <div class="card">
        <div class="row">
          <h2 style="margin:0">This week</h2>
          <div style="display:flex;gap:4px">
            <button id="readjust" class="ghost">Readjust</button>
            <button id="regen-program" class="ghost">Regenerate</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;overflow-x:auto;padding:8px 2px 4px">${strip}</div>
      </div>
      <div class="card" id="day-detail">
        ${selected ? renderDayDetail(selected, today) : `<p>Pick a day.</p>`}
      </div>
    `;
  }

  function renderDayDetail(day, today) {
    const isToday = day.date === today;
    const statusBadge = { completed: "green", missed: "red", rest: "yellow", planned: "yellow" }[day.status] || "yellow";
    const statusText = { completed: "Completed", missed: "Missed", rest: "Rest day", planned: "Planned" }[day.status] || day.status;
    const header = `<div class="row">
      <div><strong>${dowLabel(day.date)}${isToday ? " (today)" : ""}</strong> · ${escapeHtml(day.focus)}${day.duration_min ? ` · ~${day.duration_min}m` : ""}</div>
      <span class="badge ${statusBadge}">${statusText}</span>
    </div>`;

    if (day.is_rest_day) {
      return `${header}<p style="margin-top:10px">${escapeHtml(day.rationale || "Recovery day — rest, walk, mobility, and eat well.")}</p>`;
    }

    const rationale = day.rationale ? `<p style="font-style:italic;margin-top:8px">"${escapeHtml(day.rationale)}"</p>` : "";
    const units = unitLabel();

    const warmupHtml = day.warmup
      ? `<div class="checklist-item" style="background:var(--bg-elev)"><div class="title">🔥 Warm-up${day.warmup_min ? ` · ${day.warmup_min}m` : ""}</div><div class="meta">${escapeHtml(day.warmup)}</div></div>`
      : "";
    const cooldownHtml = day.cooldown
      ? `<div class="checklist-item" style="background:var(--bg-elev)"><div class="title">🧊 Cool-down${day.cooldown_min ? ` · ${day.cooldown_min}m` : ""}</div><div class="meta">${escapeHtml(day.cooldown)}</div></div>`
      : "";

    const exercises = day.exercises
      .map((ex, exIdx) => {
        const completed = ex.completed_sets || [];
        const setsHtml = Array.from({ length: ex.sets || 1 })
          .map((_, setIdx) => {
            const done = completed[setIdx];
            return `<label style="display:flex;align-items:center;gap:8px;padding:4px 0">
              <input type="checkbox" data-ex="${exIdx}" data-set="${setIdx}" ${done ? "checked" : ""} style="width:20px;height:20px" />
              <span>Set ${setIdx + 1}: ${escapeHtml(String(ex.reps))} reps${ex.rpe_target ? ` @ RPE ${ex.rpe_target}` : ""}</span>
            </label>`;
          })
          .join("");
        const allDone = completed.length && completed.filter(Boolean).length === (ex.sets || 1);

        // Weight logging: skip for holds/time/distance-based movements. Prefill with what's already
        // logged this session; otherwise hint with last time's weight (or "baseline" if brand new).
        const weighted = !/hold|min|sec|km|mile/i.test(String(ex.reps));
        const last = lastLoggedWeight(ex.name);
        const prefill = ex.logged_weight != null ? ex.logged_weight : "";
        const hint = last ? `last: ${displayWeight(last.value, last.unit)} ${units}` : "baseline — log what you use";
        const weightHtml = weighted
          ? `<div style="margin-top:6px;display:flex;align-items:center;gap:8px">
               <label style="margin:0;font-size:12px;color:var(--text-dim)">Weight (${units})</label>
               <input type="number" inputmode="decimal" data-weight-ex="${exIdx}" value="${prefill}" placeholder="${hint}" style="max-width:150px" />
             </div>`
          : "";

        return `<div class="checklist-item ${allDone ? "done" : ""}" data-exercise-idx="${exIdx}" data-exercise-name="${escapeHtml(ex.name)}">
          <div class="title">${escapeHtml(ex.name)}</div>
          <div class="meta">${ex.sets}x${escapeHtml(String(ex.reps))} · rest ${ex.rest_seconds}s${ex.notes ? ` · ${escapeHtml(ex.notes)}` : ""}</div>
          <div style="margin-top:6px">${setsHtml}</div>
          ${weightHtml}
          ${isToday ? `<div style="margin-top:4px;font-size:11px;color:var(--text-dim)">Long-press to talk to coach about this exercise</div>` : ""}
        </div>`;
      })
      .join("");

    const actions = `<div class="grid-2" style="margin-top:12px">
      <button class="mark-done">${day.status === "completed" ? "✓ Done" : "Mark done"}</button>
      <button class="mark-missed secondary">${day.status === "missed" ? "Missed" : "Mark missed"}</button>
    </div>
    ${day.feedback ? `<p style="margin-top:10px;font-size:13px">Feedback: <strong>${escapeHtml(day.feedback.difficulty)}</strong>${day.feedback.note ? ` — ${escapeHtml(day.feedback.note)}` : ""}</p>` : ""}`;

    return `${header}${rationale}${warmupHtml}${exercises}${cooldownHtml}${actions}`;
  }

  function lastLoggedWeight(name) {
    const log = getLocal("exercise_log");
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].exercise !== name) continue;
      const withW = (log[i].sets || []).filter((s) => s.weight);
      if (withW.length) {
        const last = withW[withW.length - 1];
        return { value: last.weight, unit: last.weight_unit };
      }
    }
    return null;
  }

  // ---- wiring ----

  function wireReviewBanner() {
    const reviewBtn = document.getElementById("gen-review");
    if (!reviewBtn) return;
    reviewBtn.addEventListener("click", async () => {
      reviewBtn.disabled = true;
      reviewBtn.textContent = "Generating...";
      try {
        await generateWeeklyReview();
        reviews = getLocal("weekly_reviews");
        toast("Weekly review ready — see Progress tab", "success");
        paint();
      } catch (e) {
        toast(e.message, "error");
        reviewBtn.disabled = false;
        reviewBtn.textContent = "Generate";
      }
    });
  }

  function wireGenerateProgram() {
    const btn = document.getElementById("gen-program");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Building your week...";
      try {
        await generateWeeklyProgram();
        workouts = getLocal("workouts");
        selectedDate = todayStr();
        toast("Weekly program ready", "success");
        paint();
      } catch (e) {
        toast(e.message, "error");
        btn.disabled = false;
        btn.textContent = "Generate this week's program";
      }
    });
  }

  function wireProgram(days, selected, today) {
    container.querySelectorAll(".day-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        selectedDate = chip.dataset.date;
        paint();
      });
    });

    const regenBtn = document.getElementById("regen-program");
    if (regenBtn) {
      regenBtn.addEventListener("click", async () => {
        if (!confirm("Generate a fresh 7-day program from today? This replaces your current week (completed days will be overwritten).")) return;
        regenBtn.disabled = true;
        regenBtn.textContent = "Rebuilding...";
        try {
          await generateWeeklyProgram();
          workouts = getLocal("workouts");
          selectedDate = todayStr();
          toast("New program ready", "success");
          paint();
        } catch (e) {
          toast(e.message, "error");
          regenBtn.disabled = false;
          regenBtn.textContent = "Regenerate";
        }
      });
    }

    const readjustBtn = document.getElementById("readjust");
    if (readjustBtn) {
      readjustBtn.addEventListener("click", async () => {
        if (!confirm("Ask the coach to rework the rest of your week around what actually happened (missed sessions and any unplanned activity like hikes)?")) return;
        readjustBtn.disabled = true;
        readjustBtn.textContent = "Reworking...";
        try {
          await readjustRemainingWeek();
          workouts = getLocal("workouts");
          toast("Week readjusted", "success");
          paint();
        } catch (e) {
          toast(e.message, "error");
          readjustBtn.disabled = false;
          readjustBtn.textContent = "Readjust";
        }
      });
    }

    if (!selected || selected.is_rest_day) return;
    wireWorkout(selected);
    if (selected.date === today) wireLongPress(selected);

    container.querySelector(".mark-done")?.addEventListener("click", () => showFeedbackModal(selected));
    container.querySelector(".mark-missed")?.addEventListener("click", async () => {
      try {
        await setDayStatus(selected.date, "missed");
        workouts = getLocal("workouts");
        toast("Marked missed — tap Readjust week to rework the plan", "");
        paint();
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }

  function wireWorkout(workout) {
    container.querySelectorAll("input[data-weight-ex]").forEach((inp) => {
      inp.addEventListener("change", async () => {
        const exIdx = Number(inp.dataset.weightEx);
        workout.exercises[exIdx].logged_weight = Number(inp.value) || null;
        workout.exercises[exIdx].logged_weight_unit = unitLabel();
        const all = getLocal("workouts");
        const idx = all.findIndex((w) => w.date === workout.date);
        if (idx >= 0) all[idx] = workout;
        try {
          await save("workouts", all, "chore: log exercise weight");
          workouts = all;
        } catch (e) {
          toast(e.message, "error");
        }
      });
    });

    container.querySelectorAll('input[type="checkbox"][data-ex]').forEach((box) => {
      box.addEventListener("change", async (e) => {
        const exIdx = Number(e.target.dataset.ex);
        const setIdx = Number(e.target.dataset.set);
        const exercise = workout.exercises[exIdx];
        exercise.completed_sets = exercise.completed_sets || [];
        exercise.completed_sets[setIdx] = e.target.checked;

        const allWorkouts = getLocal("workouts");
        const idx = allWorkouts.findIndex((w) => w.date === workout.date);
        if (idx >= 0) allWorkouts[idx] = workout;
        try {
          await save("workouts", allWorkouts, "chore: update workout progress");
          workouts = allWorkouts;
        } catch (err) {
          toast(err.message, "error");
        }

        if (e.target.checked && exercise.rest_seconds) {
          const remainingSets = (exercise.sets || 1) - (setIdx + 1);
          await showRestTimer({
            seconds: exercise.rest_seconds,
            exerciseLabel: exercise.name,
            nextLabel: remainingSets > 0 ? `Set ${setIdx + 2} of ${exercise.sets}` : "Last set complete",
          });
        }
        paint();
      });
    });
  }

  function wireLongPress(workout) {
    container.querySelectorAll(".checklist-item[data-exercise-idx]").forEach((item) => {
      let timer = null;
      const start = (e) => {
        if (e.target.closest("input")) return;
        timer = setTimeout(() => {
          timer = null;
          showAdjustModal(workout, Number(item.dataset.exerciseIdx));
        }, 550);
      };
      const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
      item.addEventListener("pointerdown", start);
      item.addEventListener("pointerup", cancel);
      item.addEventListener("pointerleave", cancel);
      item.addEventListener("pointermove", cancel);
    });
  }

  function showAdjustModal(workout, exIdx) {
    const exercise = workout.exercises[exIdx];
    const overlay = document.createElement("div");
    overlay.className = "timer-overlay";
    overlay.style.padding = "24px";
    overlay.innerHTML = `
      <div class="card" style="max-width:420px;width:100%">
        <h2 style="margin-top:0">Talk to coach: ${escapeHtml(exercise.name)}</h2>
        <label for="adjust-note">What's going on? (pain, want a swap, equipment unavailable...)</label>
        <textarea id="adjust-note" placeholder="e.g. my left knee hurts on this movement"></textarea>
        <div class="row" style="margin-top:12px">
          <button id="adjust-cancel" class="secondary">Cancel</button>
          <button id="adjust-submit">Ask coach</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector("#adjust-cancel").addEventListener("click", () => overlay.remove());
    overlay.querySelector("#adjust-submit").addEventListener("click", async () => {
      const note = overlay.querySelector("#adjust-note").value.trim();
      if (!note) return toast("Tell the coach what's going on first", "error");
      const submitBtn = overlay.querySelector("#adjust-submit");
      submitBtn.disabled = true;
      submitBtn.textContent = "Thinking...";
      try {
        const adjustment = await requestExerciseAdjustment(exercise, note);
        await applyAdjustmentToTodaysWorkout(exIdx, adjustment, note, workout.date);
        workouts = getLocal("workouts");
        overlay.remove();
        toast(adjustment.reason || "Exercise updated", "success");
        paint();
      } catch (e) {
        toast(e.message, "error");
        submitBtn.disabled = false;
        submitBtn.textContent = "Ask coach";
      }
    });
  }

  function showFeedbackModal(workout) {
    const overlay = document.createElement("div");
    overlay.className = "timer-overlay";
    overlay.style.padding = "24px";
    overlay.innerHTML = `
      <div class="card" style="max-width:420px;width:100%">
        <h2 style="margin-top:0">How was that workout?</h2>
        <div class="grid-3">
          <button type="button" class="secondary fb-choice" data-v="too_easy">Too easy</button>
          <button type="button" class="secondary fb-choice" data-v="right">Right</button>
          <button type="button" class="secondary fb-choice" data-v="too_hard">Too hard</button>
        </div>
        <label for="fb-note">Note (optional)</label>
        <textarea id="fb-note" placeholder="Anything the coach should know?"></textarea>
        <button id="fb-submit" style="margin-top:10px;width:100%" disabled>Submit &amp; mark done</button>
      </div>
    `;
    document.body.appendChild(overlay);
    let chosen = null;
    overlay.querySelectorAll(".fb-choice").forEach((btn) => {
      btn.addEventListener("click", () => {
        chosen = btn.dataset.v;
        overlay.querySelectorAll(".fb-choice").forEach((b) => (b.style.outline = ""));
        btn.style.outline = "2px solid var(--accent)";
        overlay.querySelector("#fb-submit").disabled = false;
      });
    });
    overlay.querySelector("#fb-submit").addEventListener("click", async () => {
      const note = overlay.querySelector("#fb-note").value.trim();
      workout.feedback = { difficulty: chosen, note: note || null, at: new Date().toISOString() };
      workout.status = "completed";

      const allWorkouts = getLocal("workouts");
      const idx = allWorkouts.findIndex((w) => w.date === workout.date);
      if (idx >= 0) allWorkouts[idx] = workout;

      const logEntries = workout.exercises
        .filter((ex) => (ex.completed_sets || []).some(Boolean))
        .map((ex) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          date: workout.date,
          exercise: ex.name,
          sets: (ex.completed_sets || [])
            .map((done) => (done ? { reps: ex.reps, weight: ex.logged_weight ?? null, weight_unit: ex.logged_weight_unit || unitLabel() } : null))
            .filter(Boolean),
          note: null,
          source: "planned",
          feedback: workout.feedback,
          created_at: new Date().toISOString(),
        }));

      try {
        await save("workouts", allWorkouts, "chore: post-workout feedback");
        workouts = allWorkouts;
        if (logEntries.length) {
          // Idempotent: drop any prior planned entries for this day so re-marking done
          // doesn't create duplicate log rows (which would inflate volume/1RM trends).
          const log = getLocal("exercise_log").filter((e) => !(e.source === "planned" && e.date === workout.date));
          await save("exercise_log", [...log, ...logEntries], "log: planned workout completion");
        }
        overlay.remove();
        toast("Nice work — logged", "success");
        paint();
      } catch (e) {
        toast(e.message, "error");
      }
    });
  }
}

function showRecoveryModal(recovery) {
  const overlay = document.createElement("div");
  overlay.className = "timer-overlay";
  overlay.style.padding = "24px";
  overlay.innerHTML = `
    <div class="card" style="max-width:420px;width:100%">
      <div class="row">
        <h2 style="margin:0">Recovery details</h2>
        <span class="badge ${recovery.level}">${recovery.level.toUpperCase()}</span>
      </div>
      <ul style="padding-left:18px;color:var(--text-dim)">
        ${recovery.reasons.map((r) => `<li style="margin-bottom:8px">${escapeHtml(r)}</li>`).join("")}
      </ul>
      <button id="close-recovery" class="secondary" style="width:100%">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#close-recovery").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
