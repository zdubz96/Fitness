import { sendMessageForJSON } from "../anthropic.js";
import { buildCoachContext, contextToPromptText } from "./context.js";
import { getLocal, save } from "../state.js";

const GENERATE_PROMPT = `You are an AI personal trainer designing a one-session BASELINE DIAGNOSTIC
for a new client, based on their onboarding profile (experience, injuries, equipment, schedule,
goals, cardio history, age/sex) and any Garmin data available. The goal is to measure where they
are right now so future programming and progress tracking have an accurate starting point.

Pick 4-7 tests appropriate to their level and equipment. Typical building blocks (adapt freely):
- Strength: a comfortable heavy set on 1-3 key lifts to estimate working weight (e.g. "work up to
  a challenging set of 5" — NOT a true 1RM for a beginner), max push-ups, bodyweight rows
- Core: plank hold
- Cardio: an appropriate field test given their cardio history (e.g. 12-min distance, 1-mile time,
  or a brisk 20-min steady effort with avg HR if they wear their Garmin)
- Mobility/movement: e.g. deep bodyweight squat hold, noting difficulty

Respect injuries and limitations strictly. Keep total session under ~60 minutes.

Respond with ONLY a JSON object (no markdown fences, no commentary):
{
  "intro": string,  // 2-3 sentence explanation of the session, warm and encouraging
  "tests": [
    {
      "id": string,             // short slug, e.g. "goblet_squat_5rm"
      "name": string,
      "category": "strength"|"cardio"|"core"|"mobility",
      "protocol": string,       // exactly what to do, including warm-up guidance
      "record": "weight_reps"|"reps"|"time_seconds"|"distance_meters"|"note",
      "record_label": string    // e.g. "Weight x reps of your best set"
    }
  ]
}`;

const DISTILL_PROMPT = `You are an AI personal trainer. Your new client just completed their baseline
diagnostic session. Given the tests, their recorded results, and their profile, distill an accurate
fitness baseline. Estimate working 1RMs conservatively from rep maxes (Epley), characterize cardio
fitness, and note any movement/mobility limitations observed.

Respond with ONLY a JSON object (no markdown fences, no commentary):
{
  "strength": [ { "exercise": string, "estimated_1rm": number|null, "working_weight": number|null, "notes": string } ],
  "cardio": { "level": string, "details": string },
  "core": string,
  "mobility": string,
  "summary": string,            // 3-4 sentences: where they are now, said encouragingly but honestly
  "programming_notes": string   // guidance to your future self for programming their workouts
}`;

export async function generateBaselineAssessment() {
  const ctx = buildCoachContext();
  const result = await sendMessageForJSON(
    GENERATE_PROMPT,
    [{ role: "user", content: `Design my baseline diagnostic session.\n\n${contextToPromptText(ctx)}` }],
    { maxTokens: 2048 }
  );
  const profile = getLocal("trainer_profile") || {};
  const assessment = { ...result, created_at: new Date().toISOString(), results: {} };
  await save("trainer_profile", { ...profile, pending_assessment: assessment }, "chore: create baseline assessment");
  return assessment;
}

export async function submitBaselineResults(results) {
  const profile = getLocal("trainer_profile") || {};
  const assessment = profile.pending_assessment;
  if (!assessment) throw new Error("No pending assessment found");

  const ctx = buildCoachContext();
  const payload = assessment.tests.map((t) => ({ ...t, result: results[t.id] ?? null }));
  const baseline = await sendMessageForJSON(
    DISTILL_PROMPT,
    [{ role: "user", content: `Tests and results: ${JSON.stringify(payload)}\n\n${contextToPromptText(ctx)}` }],
    { maxTokens: 3000 }
  );

  const units = profile.units || "lb";
  const nextProfile = {
    ...profile,
    baseline: { ...baseline, units, assessed_at: new Date().toISOString(), raw_results: payload },
  };
  delete nextProfile.pending_assessment;
  // The baseline itself is the important artifact — save it first so a later blip can't lose it.
  await save("trainer_profile", nextProfile, "chore: save fitness baseline");

  // Best-effort: seed strength results into the exercise log so 1RM trends start from the
  // baseline. If this save fails (transient network), the baseline is already safely stored.
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const logEntries = payload
      .filter((t) => t.category === "strength" && t.result && typeof t.result === "object" && t.result.weight && t.result.reps)
      .map((t) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date: dateStr,
        exercise: t.name,
        sets: [{ reps: Number(t.result.reps), weight: Number(t.result.weight), weight_unit: units }],
        note: "Baseline assessment",
        source: "assessment",
        created_at: new Date().toISOString(),
      }));
    if (logEntries.length) {
      const log = getLocal("exercise_log");
      await save("exercise_log", [...log, ...logEntries], "log: baseline assessment results");
    }
  } catch (e) {
    console.warn("baseline saved, but seeding exercise log failed", e);
  }

  return nextProfile.baseline;
}

/**
 * Re-run just the coach's ANALYSIS on the test results already recorded, using fresh context
 * (e.g. after updating body weight, age/sex, or HR zones). Does not touch the exercise log —
 * those sets were already logged when the baseline was first submitted.
 */
export async function reanalyzeBaseline() {
  const profile = getLocal("trainer_profile") || {};
  const existing = profile.baseline;
  if (!existing || !existing.raw_results) {
    throw new Error("No recorded results to re-analyze. Run the assessment first.");
  }

  const ctx = buildCoachContext();
  const payload = existing.raw_results;
  const baseline = await sendMessageForJSON(
    DISTILL_PROMPT,
    [{ role: "user", content: `Tests and results: ${JSON.stringify(payload)}\n\n${contextToPromptText(ctx)}` }],
    { maxTokens: 3000 }
  );

  const units = profile.units || existing.units || "lb";
  const nextBaseline = {
    ...baseline,
    units,
    raw_results: payload,
    assessed_at: existing.assessed_at, // preserve original test date
    reanalyzed_at: new Date().toISOString(),
  };
  await save("trainer_profile", { ...profile, baseline: nextBaseline }, "chore: re-analyze fitness baseline");
  return nextBaseline;
}
