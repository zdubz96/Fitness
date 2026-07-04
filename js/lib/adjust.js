import { sendMessageForJSON } from "../anthropic.js";
import { buildCoachContext, contextToPromptText } from "./context.js";
import { getLocal, save } from "../state.js";

const SYSTEM_PROMPT = `You are an AI personal trainer. Your client is mid-workout and needs a quick
in-workout adjustment to ONE exercise — either a substitution request or a reported pain/issue.
Given the exercise, their note, and their full context (profile, recovery, recent logs), decide
the best replacement or modification. If they reported pain, prioritize safety: swap to something
that avoids loading the affected area, and say so in the reason.

Respond with ONLY a JSON object (no markdown fences, no commentary):
{
  "updated_exercise": { "name": string, "sets": number, "reps": string, "rest_seconds": number, "rpe_target": number, "notes": string },
  "reason": string  // one or two sentences explaining the change, shown to the client
}`;

export async function requestExerciseAdjustment(exercise, userNote) {
  const ctx = buildCoachContext();
  const userMessage = `Exercise to adjust: ${JSON.stringify(exercise)}\nClient's note: "${userNote}"\n\n${contextToPromptText(ctx)}`;
  const result = await sendMessageForJSON(SYSTEM_PROMPT, [{ role: "user", content: userMessage }], { maxTokens: 1536 });
  return result; // { updated_exercise, reason }
}

/** Applies an adjustment to today's workout in place and persists it. */
export async function applyAdjustmentToTodaysWorkout(exerciseIdx, adjustment, originalNote) {
  const workouts = getLocal("workouts");
  const ctx = buildCoachContext();
  const idx = workouts.findIndex((w) => w.date === ctx.today);
  if (idx < 0) throw new Error("Today's workout not found");
  const workout = workouts[idx];
  const original = workout.exercises[exerciseIdx];
  workout.exercises[exerciseIdx] = {
    ...adjustment.updated_exercise,
    completed_sets: original.completed_sets || [],
    adjustment_log: [
      ...(original.adjustment_log || []),
      { at: new Date().toISOString(), note: originalNote, reason: adjustment.reason, replaced: original.name },
    ],
  };
  const next = [...workouts.slice(0, idx), workout, ...workouts.slice(idx + 1)];
  await save("workouts", next, `chore: in-workout adjustment for ${original.name}`);
  return workout;
}
