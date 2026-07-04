import { getLocal, save } from "../state.js";
import { generateBaselineAssessment, submitBaselineResults, reanalyzeBaseline } from "../lib/assessment.js";
import { toast } from "../components/toast.js";
import { unitLabel } from "../lib/units.js";

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

export async function render(container) {
  const profile = getLocal("trainer_profile") || {};

  // A pending assessment (fresh or a redo-in-progress) takes priority over an existing baseline,
  // so you can resume/complete it; the old baseline stays saved until you submit the new one.
  if (profile.pending_assessment) {
    renderAssessment(container, profile.pending_assessment, Boolean(profile.baseline));
    return;
  }

  if (profile.baseline) {
    renderBaseline(container, profile.baseline);
    return;
  }

  container.innerHTML = `
    <h1>Baseline Diagnostic</h1>
    <div class="card stack">
      <p>Your coach will design a one-off diagnostic session based on your profile — a few key
      strength, cardio, core, and mobility tests — so your programming starts from an accurate
      picture of where you are right now.</p>
      <button id="gen-assessment">Design my diagnostic session</button>
    </div>
  `;
  document.getElementById("gen-assessment").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Designing...";
    try {
      const assessment = await generateBaselineAssessment();
      renderAssessment(container, assessment);
    } catch (err) {
      toast(err.message, "error");
      e.target.disabled = false;
      e.target.textContent = "Design my diagnostic session";
    }
  });
}

function renderAssessment(container, assessment, isRedo = false) {
  container.innerHTML = `
    <h1>Baseline Diagnostic</h1>
    <div class="card"><p>${escapeHtml(assessment.intro)}</p></div>
    <div class="stack" id="tests">
      ${assessment.tests.map(renderTest).join("")}
    </div>
    <div class="card stack">
      <p style="font-size:13px">Fill in results as you complete each test (skip any you couldn't do), then submit — your coach will distill your baseline.</p>
      <button id="submit-assessment">Submit results</button>
      ${isRedo ? `<button id="cancel-redo" class="ghost">Cancel — keep my current baseline</button>` : ""}
    </div>
  `;

  const cancelBtn = document.getElementById("cancel-redo");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", async () => {
      cancelBtn.disabled = true;
      try {
        const profile = getLocal("trainer_profile") || {};
        const next = { ...profile };
        delete next.pending_assessment;
        await save("trainer_profile", next, "chore: cancel assessment redo");
        renderBaseline(container, next.baseline);
      } catch (err) {
        toast(err.message, "error");
        cancelBtn.disabled = false;
      }
    });
  }

  document.getElementById("submit-assessment").addEventListener("click", async (e) => {
    const results = {};
    let anyFilled = false;
    assessment.tests.forEach((t) => {
      const value = collectResult(t);
      if (value !== null) {
        results[t.id] = value;
        anyFilled = true;
      }
    });
    if (!anyFilled) return toast("Enter at least one result first", "error");
    e.target.disabled = true;
    e.target.textContent = "Analyzing...";
    try {
      const baseline = await submitBaselineResults(results);
      toast("Baseline saved", "success");
      renderBaseline(container, baseline);
    } catch (err) {
      toast(err.message, "error");
      e.target.disabled = false;
      e.target.textContent = "Submit results";
    }
  });
}

function renderTest(t) {
  const inputs = {
    weight_reps: `<div class="grid-2">
        <div><label>Weight (${unitLabel()})</label><input type="number" inputmode="decimal" data-test="${t.id}" data-field="weight" /></div>
        <div><label>Reps</label><input type="number" inputmode="numeric" data-test="${t.id}" data-field="reps" /></div>
      </div>`,
    reps: `<label>${escapeHtml(t.record_label || "Reps")}</label><input type="number" inputmode="numeric" data-test="${t.id}" data-field="value" />`,
    time_seconds: `<label>${escapeHtml(t.record_label || "Time (seconds)")}</label><input type="number" inputmode="numeric" data-test="${t.id}" data-field="value" />`,
    distance_meters: `<label>${escapeHtml(t.record_label || "Distance (meters)")}</label><input type="number" inputmode="numeric" data-test="${t.id}" data-field="value" />`,
    note: `<label>${escapeHtml(t.record_label || "Notes")}</label><textarea data-test="${t.id}" data-field="value"></textarea>`,
  };
  return `<div class="card">
    <div class="row"><strong>${escapeHtml(t.name)}</strong><span class="badge green">${escapeHtml(t.category)}</span></div>
    <p style="font-size:14px">${escapeHtml(t.protocol)}</p>
    ${inputs[t.record] || inputs.note}
  </div>`;
}

function collectResult(t) {
  if (t.record === "weight_reps") {
    const weight = document.querySelector(`[data-test="${t.id}"][data-field="weight"]`)?.value;
    const reps = document.querySelector(`[data-test="${t.id}"][data-field="reps"]`)?.value;
    if (!weight && !reps) return null;
    return { weight: Number(weight) || null, reps: Number(reps) || null };
  }
  const value = document.querySelector(`[data-test="${t.id}"][data-field="value"]`)?.value?.trim();
  if (!value) return null;
  return t.record === "note" ? value : Number(value);
}

function renderBaseline(container, baseline) {
  container.innerHTML = `
    <h1>Your Baseline</h1>
    <div class="card"><p>${escapeHtml(baseline.summary)}</p></div>
    ${baseline.strength?.length ? `<div class="card">
      <h2>Strength</h2>
      ${baseline.strength.map((s) => `<div class="checklist-item">
        <div class="title">${escapeHtml(s.exercise)}</div>
        <div class="meta">${s.estimated_1rm ? `est. 1RM ${s.estimated_1rm} ${baseline.units || unitLabel()}` : ""}${s.working_weight ? ` · working weight ${s.working_weight} ${baseline.units || unitLabel()}` : ""}${s.notes ? ` · ${escapeHtml(s.notes)}` : ""}</div>
      </div>`).join("")}
    </div>` : ""}
    ${baseline.cardio ? `<div class="card"><h2>Cardio</h2><p><strong>${escapeHtml(baseline.cardio.level)}</strong> — ${escapeHtml(baseline.cardio.details)}</p></div>` : ""}
    ${baseline.core ? `<div class="card"><h2>Core</h2><p>${escapeHtml(baseline.core)}</p></div>` : ""}
    ${baseline.mobility ? `<div class="card"><h2>Mobility</h2><p>${escapeHtml(baseline.mobility)}</p></div>` : ""}
    <div class="card stack">
      <button id="reanalyze">Re-run analysis</button>
      <p style="font-size:12px;color:var(--text-dim);margin:0">Re-scores your recorded test results with your latest profile (body weight, age/sex, HR zones) — no need to redo the exercises.</p>
      <button id="redo-full" class="secondary">Redo full assessment</button>
      <p style="font-size:12px;color:var(--text-dim);margin:0">Design and perform a brand-new diagnostic session from scratch.</p>
    </div>
    <div class="card">
      <a href="#/today">← Back to Today</a>
    </div>
  `;

  const reanalyzeBtn = document.getElementById("reanalyze");
  if (reanalyzeBtn) {
    reanalyzeBtn.addEventListener("click", async () => {
      reanalyzeBtn.disabled = true;
      reanalyzeBtn.textContent = "Re-analyzing...";
      try {
        const updated = await reanalyzeBaseline();
        toast("Baseline re-analyzed", "success");
        renderBaseline(container, updated);
      } catch (err) {
        toast(err.message, "error");
        reanalyzeBtn.disabled = false;
        reanalyzeBtn.textContent = "Re-run analysis";
      }
    });
  }

  const redoBtn = document.getElementById("redo-full");
  if (redoBtn) {
    redoBtn.addEventListener("click", async () => {
      if (!confirm("Design a new diagnostic session? Your current baseline stays until you submit new results.")) return;
      redoBtn.disabled = true;
      redoBtn.textContent = "Designing...";
      try {
        const assessment = await generateBaselineAssessment();
        renderAssessment(container, assessment, true);
      } catch (err) {
        toast(err.message, "error");
        redoBtn.disabled = false;
        redoBtn.textContent = "Redo full assessment";
      }
    });
  }
}
