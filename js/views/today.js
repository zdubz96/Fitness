import { getLocal, refresh, save } from "../state.js";
import { computeRecoveryStatus } from "../lib/recovery.js";
import { showRestTimer } from "../components/timer.js";
import { toast } from "../components/toast.js";
import { generateTodayWorkout } from "../lib/workoutgen.js";
import { requestExerciseAdjustment, applyAdjustmentToTodaysWorkout } from "../lib/adjust.js";
import { needsWeeklyReview, generateWeeklyReview } from "../lib/weeklyreview.js";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export async function render(container) {
  let wellness = getLocal("garmin_wellness");
  let health = getLocal("garmin_health");
  let activities = getLocal("garmin_activities");
  let workouts = getLocal("workouts");
  let reviews = getLocal("weekly_reviews");

  paint();

  // Refresh from GitHub in the background, repaint if anything changed.
  Promise.all([refresh("garmin_wellness"), refresh("garmin_health"), refresh("garmin_activities"), refresh("workouts")])
    .then(([w, h, a, wk]) => {
      wellness = w; health = h; activities = a; workouts = wk;
      paint();
    })
    .catch((e) => console.warn("Today refresh failed", e));

  function paint() {
    const recovery = computeRecoveryStatus({ wellness, health, activities });
    const today = todayStr();
    const todaysWellness = wellness.find((w) => w.date === today) || {};
    const todaysWorkout = workouts.find((w) => w.date === today);
    const recent7Load = activities
      .filter((a) => a.training_load)
      .slice(-7)
      .reduce((sum, a) => sum + (a.training_load || 0), 0);

    const showReviewBanner = needsWeeklyReview(reviews);
    const profile = getLocal("trainer_profile") || {};
    const showAssessmentBanner = !profile.baseline;

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

      <div class="card">
        <h2>Today's Workout</h2>
        ${todaysWorkout ? renderWorkout(todaysWorkout) : `<p>No workout planned for today yet.</p><button id="gen-workout">Generate today's workout</button>`}
        ${todaysWorkout && !todaysWorkout.feedback ? `<button id="finish-workout" class="secondary" style="margin-top:10px;width:100%">Finish workout</button>` : ""}
        ${todaysWorkout?.feedback ? `<p style="margin-top:10px;font-size:13px">Feedback logged: <strong>${escapeHtml(todaysWorkout.feedback.difficulty)}</strong>${todaysWorkout.feedback.note ? ` — ${escapeHtml(todaysWorkout.feedback.note)}` : ""}</p>` : ""}
      </div>
    `;

    document.getElementById("recovery-card").addEventListener("click", () => showRecoveryModal(recovery));

    const reviewBtn = document.getElementById("gen-review");
    if (reviewBtn) {
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

    const finishBtn = document.getElementById("finish-workout");
    if (finishBtn) finishBtn.addEventListener("click", () => showFeedbackModal(todaysWorkout));

    if (todaysWorkout) { wireWorkout(todaysWorkout); wireLongPress(todaysWorkout); }

    const genBtn = document.getElementById("gen-workout");
    if (genBtn) {
      genBtn.addEventListener("click", async () => {
        genBtn.disabled = true;
        genBtn.textContent = "Generating...";
        try {
          const workout = await generateTodayWorkout();
          workouts = getLocal("workouts");
          toast("Workout generated", "success");
          paint();
        } catch (e) {
          toast(e.message, "error");
          genBtn.disabled = false;
          genBtn.textContent = "Generate today's workout";
        }
      });
    }
  }

  function renderWorkout(workout) {
    const rationale = workout.rationale ? `<p style="font-style:italic">"${escapeHtml(workout.rationale)}"</p>` : "";
    const exercises = workout.exercises
      .map((ex, exIdx) => {
        const completed = ex.completed_sets || [];
        const setsHtml = Array.from({ length: ex.sets || 1 })
          .map((_, setIdx) => {
            const done = completed[setIdx];
            return `<label style="display:flex;align-items:center;gap:8px;padding:4px 0">
              <input type="checkbox" data-ex="${exIdx}" data-set="${setIdx}" ${done ? "checked" : ""} style="width:20px;height:20px" />
              <span>Set ${setIdx + 1}: ${ex.reps} reps${ex.rpe_target ? ` @ RPE ${ex.rpe_target}` : ""}</span>
            </label>`;
          })
          .join("");
        const allDone = completed.length && completed.filter(Boolean).length === (ex.sets || 1);
        return `<div class="checklist-item ${allDone ? "done" : ""}" data-exercise-idx="${exIdx}" data-exercise-name="${escapeHtml(ex.name)}">
          <div class="title">${escapeHtml(ex.name)}</div>
          <div class="meta">${ex.sets}x${ex.reps} · rest ${ex.rest_seconds}s${ex.notes ? ` · ${escapeHtml(ex.notes)}` : ""}</div>
          <div style="margin-top:6px">${setsHtml}</div>
          <div style="margin-top:4px;font-size:11px;color:var(--text-dim)">Long-press to talk to coach about this exercise</div>
        </div>`;
      })
      .join("");
    return `${rationale}${exercises}`;
  }

  function wireWorkout(workout) {
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
        await applyAdjustmentToTodaysWorkout(exIdx, adjustment, note);
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
        <button id="fb-submit" style="margin-top:10px;width:100%" disabled>Submit</button>
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

      const allWorkouts = getLocal("workouts");
      const idx = allWorkouts.findIndex((w) => w.date === workout.date);
      if (idx >= 0) allWorkouts[idx] = workout;

      const logEntries = workout.exercises
        .filter((ex) => (ex.completed_sets || []).some(Boolean))
        .map((ex) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          date: workout.date,
          exercise: ex.name,
          sets: (ex.completed_sets || []).map((done, i) => (done ? { reps: ex.reps, weight: null } : null)).filter(Boolean),
          note: null,
          source: "planned",
          feedback: workout.feedback,
          created_at: new Date().toISOString(),
        }));

      try {
        await save("workouts", allWorkouts, "chore: post-workout feedback");
        if (logEntries.length) {
          const log = getLocal("exercise_log");
          await save("exercise_log", [...log, ...logEntries], "log: planned workout completion");
        }
        overlay.remove();
        toast("Thanks — logged", "success");
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
