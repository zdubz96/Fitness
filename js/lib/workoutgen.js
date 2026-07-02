import { sendMessageForJSON } from "../anthropic.js";
import { buildCoachContext, contextToPromptText } from "./context.js";
import { getLocal, save } from "../state.js";

const SYSTEM_PROMPT = `You are an expert AI personal trainer generating today's workout for your client.

You will be given their trainer profile (experience, injuries/limitations, equipment, schedule,
preferences, goals, cardio history, age/sex/max HR), locally-computed recovery indicators
(resting HR trend, sleep trend, HRV trend, acute:chronic training load ratio), their last 14
days of Garmin activity/wellness/health data, and their recent exercise log.

Factor in: recovery signals (reduce volume/intensity if flagged yellow/red — see RECOVERY
INDICATORS), completed vs skipped work from recent logs, progressive overload versus their
recent working weights/reps, their available equipment and schedule, and any cardiovascular
goals (balance strength work with Zone 2 base + interval work — the two main levers for VO2
max — when a cardio goal is present).

Respond with ONLY a single JSON object (no markdown fences, no commentary) matching this shape:
{
  "exercises": [
    {
      "name": string,
      "sets": number,
      "reps": string,        // e.g. "8-10" or "12"
      "rest_seconds": number,
      "rpe_target": number,  // 1-10
      "notes": string        // brief coaching cue or substitution note
    }
  ],
  "rationale": string  // 2-4 sentences explaining today's plan given recovery + progression
}`;

export async function generateTodayWorkout() {
  const ctx = buildCoachContext();
  const userMessage = `Generate today's workout.\n\n${contextToPromptText(ctx)}`;
  const result = await sendMessageForJSON(SYSTEM_PROMPT, [{ role: "user", content: userMessage }], { maxTokens: 2048 });

  const workout = {
    date: ctx.today,
    exercises: (result.exercises || []).map((ex) => ({ ...ex, completed_sets: [] })),
    rationale: result.rationale || "",
    generated_at: new Date().toISOString(),
  };

  const all = getLocal("workouts");
  const idx = all.findIndex((w) => w.date === ctx.today);
  const next = idx >= 0 ? [...all.slice(0, idx), workout, ...all.slice(idx + 1)] : [...all, workout];
  await save("workouts", next, "chore: generate today's workout");
  return workout;
}
