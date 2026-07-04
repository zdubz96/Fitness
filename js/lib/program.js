// Weekly training program. The coach authors a rolling 7-day plan (from today); each day is
// stored as a dated workout in workouts.json so the existing Today checklist, rest timer, and
// post-workout feedback all keep working unchanged. Program-level metadata (which workouts
// belong to the active week) lives in trainer_profile.active_program.
import { sendMessageForJSON } from "../anthropic.js";
import { buildCoachContext, contextToPromptText } from "./context.js";
import { getLocal, save } from "../state.js";

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAY_SCHEMA = `{
  "day_offset": number,      // 0 = today, 1 = tomorrow, ... 6
  "focus": string,           // short, e.g. "Lower strength", "Zone 2 cardio", "Rest"
  "is_rest_day": boolean,
  "duration_min": number,    // estimated total minutes (0 for rest days)
  "exercises": [             // empty for rest days; at most 6 for training days
    { "name": string, "sets": number, "reps": string, "rest_seconds": number, "rpe_target": number, "notes": string }
  ],
  "rationale": string        // one short sentence
}`;

const GENERATE_PROMPT = `You are an AI personal trainer building a client's 7-day training program
(a rolling week starting today, day_offset 0). Use their full context: profile (experience,
injuries, equipment, SCHEDULE / days-per-week available, preferences, goals), baseline (anchor
starting loads to it), recovery indicators, recent Garmin data and logs.

Rules:
- Return EXACTLY 7 day objects, day_offset 0 through 6, in order.
- Honor their schedule: include rest days so training days match how many days/week they can train.
- Balance strength with structured cardio when they have a cardiovascular goal (Zone 2 base volume
  plus some interval work — the two levers for VO2 max), and avoid burying everything in the
  moderate "gray zone".
- Respect injuries strictly. Apply progressive overload vs. their recent logged working weights.
- If recovery is flagged yellow/red, reduce volume/intensity and/or add rest.
- Keep every "notes" field to one short phrase. Be concise so the whole plan fits.

Respond with ONLY a JSON object (no markdown fences, no commentary):
{ "days": [ ${DAY_SCHEMA} ] }`;

const READJUST_PROMPT = `You are an AI personal trainer REVISING the remainder of a client's current
7-day program because they missed one or more sessions (or need it reworked). You are given the
full week with each day's status (completed / missed / planned / rest) and the exact dates that
still need a plan. Keep already-completed days as they are (do not resend them). Redistribute the
missed work sensibly across the remaining days without overloading any single day or compromising
recovery — it's fine to drop lower-priority work rather than cram everything in.

Return plans ONLY for the remaining dates you're given, in the same order. Use the same day schema
${DAY_SCHEMA}
Respond with ONLY a JSON object (no markdown fences): { "days": [ ... ] }  // one per remaining date, in order`;

export function activeProgram() {
  const profile = getLocal("trainer_profile") || {};
  const ap = profile.active_program;
  if (!ap) return null;
  const today = todayStr();
  // Program is "active" only while today falls within its rolling 7-day window.
  if (today < ap.start_date || today > addDays(ap.start_date, 6)) return null;
  return ap;
}

/** The 7 dated workout entries belonging to the active program, sorted by date. */
export function programDays() {
  const ap = activeProgram();
  if (!ap) return [];
  return getLocal("workouts")
    .filter((w) => w.program_id === ap.program_id)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function toWorkoutEntry(programId, startDate, day) {
  const date = addDays(startDate, day.day_offset);
  return {
    date,
    program_id: programId,
    day_offset: day.day_offset,
    focus: day.focus || (day.is_rest_day ? "Rest" : "Training"),
    is_rest_day: !!day.is_rest_day,
    duration_min: day.duration_min || null,
    exercises: (day.exercises || []).map((e) => ({ ...e, completed_sets: [] })),
    rationale: day.rationale || "",
    status: day.is_rest_day ? "rest" : "planned",
    generated_at: new Date().toISOString(),
  };
}

export async function generateWeeklyProgram() {
  const ctx = buildCoachContext();
  const result = await sendMessageForJSON(
    GENERATE_PROMPT,
    [{ role: "user", content: `Build my 7-day program starting today (${ctx.today}).\n\n${contextToPromptText(ctx)}` }],
    { maxTokens: 8000 }
  );
  const days = (result.days || []).slice(0, 7);
  const programId = `prog-${Date.now()}`;
  const startDate = ctx.today;

  const newEntries = days.map((d) => toWorkoutEntry(programId, startDate, d));
  const newDates = new Set(newEntries.map((e) => e.date));
  const kept = getLocal("workouts").filter((w) => !newDates.has(w.date));
  const next = [...kept, ...newEntries].sort((a, b) => (a.date < b.date ? -1 : 1));
  await save("workouts", next, "chore: generate weekly program");

  const profile = getLocal("trainer_profile") || {};
  await save(
    "trainer_profile",
    { ...profile, active_program: { program_id: programId, start_date: startDate, generated_at: new Date().toISOString() } },
    "chore: set active program"
  );
  return programDays();
}

export async function setDayStatus(date, status) {
  const workouts = getLocal("workouts");
  const idx = workouts.findIndex((w) => w.date === date && w.program_id);
  if (idx < 0) throw new Error("That day isn't part of your current program.");
  workouts[idx] = { ...workouts[idx], status };
  await save("workouts", workouts, `chore: mark ${date} ${status}`);
  return workouts[idx];
}

export function hasMissedDays() {
  return programDays().some((d) => d.status === "missed");
}

export async function readjustRemainingWeek() {
  const ap = activeProgram();
  if (!ap) throw new Error("No active program to readjust.");
  const ctx = buildCoachContext();
  const today = ctx.today;
  const days = programDays();

  // Days still to be planned: today onward, not already completed. (Completed days stay put.)
  const remaining = days.filter((d) => d.date >= today && d.status !== "completed");
  if (!remaining.length) throw new Error("No upcoming days left to readjust.");
  const remainingDates = remaining.map((d) => d.date);

  const weekSummary = days.map((d) => ({ date: d.date, focus: d.focus, status: d.status, is_rest_day: d.is_rest_day }));
  const result = await sendMessageForJSON(
    READJUST_PROMPT,
    [
      {
        role: "user",
        content: `Current week (with statuses): ${JSON.stringify(weekSummary)}\n\nProduce plans for exactly these remaining dates, in this order: ${JSON.stringify(
          remainingDates
        )}. day_offset in your response should be the index within this remaining list (0-based).\n\n${contextToPromptText(ctx)}`,
      },
    ],
    { maxTokens: 8000 }
  );

  const revised = (result.days || []).slice(0, remainingDates.length);
  const workouts = getLocal("workouts");
  revised.forEach((day, i) => {
    const date = remainingDates[i];
    const entry = toWorkoutEntry(ap.program_id, date, { ...day, day_offset: 0 });
    entry.date = date;
    entry.day_offset = days.find((d) => d.date === date)?.day_offset ?? i;
    const idx = workouts.findIndex((w) => w.date === date);
    if (idx >= 0) workouts[idx] = entry;
    else workouts.push(entry);
  });
  const next = workouts.sort((a, b) => (a.date < b.date ? -1 : 1));
  await save("workouts", next, "chore: readjust remaining week");
  return programDays();
}
