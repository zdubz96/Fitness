// Assembles the shared context bundle every coach-facing AI call (workout generation, coach
// chat, weekly review) is built on: profile, goals, recent Garmin data, recent logs, recovery.
import { getLocal } from "../state.js";
import { computeRecoveryStatus } from "./recovery.js";

function daysAgo(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function buildCoachContext() {
  const profile = getLocal("trainer_profile") || {};
  const goals = getLocal("goals") || [];
  const wellness = getLocal("garmin_wellness") || [];
  const health = getLocal("garmin_health") || [];
  const activities = getLocal("garmin_activities") || [];
  const exerciseLog = getLocal("exercise_log") || [];
  const workouts = getLocal("workouts") || [];
  const reviews = getLocal("weekly_reviews") || [];
  const bodyMetrics = getLocal("body_metrics") || [];

  const units = profile.units || "lb";
  const latestBodyWeight = bodyMetrics.length ? bodyMetrics[bodyMetrics.length - 1] : null;
  const recovery = computeRecoveryStatus({ wellness, health, activities });
  const last14Activities = activities.filter((a) => daysAgo(a.date) < 14);
  const last14Wellness = wellness.filter((w) => daysAgo(w.date) < 14);
  const last14Health = health.filter((h) => daysAgo(h.date) < 14);
  const last14Logs = exerciseLog.filter((e) => daysAgo(e.date) < 14);
  const today = todayStr();
  const todaysWorkout = workouts.find((w) => w.date === today) || null;
  const latestReview = reviews.length ? reviews[reviews.length - 1] : null;

  return {
    today,
    profile,
    units,
    latestBodyWeight,
    goals,
    recovery,
    last14Activities,
    last14Wellness,
    last14Health,
    last14Logs,
    todaysWorkout,
    latestReview,
  };
}

const CHAT_SUMMARY_MAX_CHARS = 1200;

/**
 * A version of the profile trimmed for prompt inclusion only (never persisted). Two fields
 * grow without bound the longer someone uses the app — chat_summary (appended to every time
 * old coach chat gets summarized) and cardio_reports (one full quarterly report added every
 * quarter) — and both were being sent in full, pretty-printed, on every single coach call.
 * That's pure token/latency waste: the coach needs recent context, not the full archive.
 */
function trimProfileForPrompt(profile) {
  const trimmed = { ...profile };
  if (typeof trimmed.chat_summary === "string" && trimmed.chat_summary.length > CHAT_SUMMARY_MAX_CHARS) {
    trimmed.chat_summary = `...${trimmed.chat_summary.slice(-CHAT_SUMMARY_MAX_CHARS)}`;
  }
  if (Array.isArray(trimmed.cardio_reports) && trimmed.cardio_reports.length) {
    trimmed.cardio_reports = [trimmed.cardio_reports[trimmed.cardio_reports.length - 1]];
  }
  return trimmed;
}

/** Drop fields the coach doesn't need from a Garmin/log row, keeping only what's referenced elsewhere in this app's prompts. */
function slimActivity(a) {
  const { id, type, date, name, duration_seconds, distance_meters, avg_hr, max_hr, calories, training_load } = a;
  return { id, type, date, name, duration_seconds, distance_meters, avg_hr, max_hr, calories, training_load };
}
function slimWellness(w) {
  const { date, resting_hr, sleep_seconds, steps } = w;
  return { date, resting_hr, sleep_seconds, steps };
}
function slimHealth(h) {
  const { date, vo2max_running, vo2max_cycling, hrv_avg_ms, hrv_status, intensity_minutes_moderate, intensity_minutes_vigorous } = h;
  return { date, vo2max_running, vo2max_cycling, hrv_avg_ms, hrv_status, intensity_minutes_moderate, intensity_minutes_vigorous };
}

/** Renders the context bundle into a compact text block for a Claude system prompt. */
export function contextToPromptText(ctx) {
  return `
TODAY'S DATE: ${ctx.today}
UNITS: all weights are in ${ctx.units}. Use ${ctx.units} in any prescriptions or numbers you give.
${ctx.latestBodyWeight ? `CURRENT BODY WEIGHT: ${ctx.latestBodyWeight.weight} ${ctx.latestBodyWeight.weight_unit || ctx.units} (logged ${ctx.latestBodyWeight.date})` : ""}

TRAINER PROFILE:
${JSON.stringify(trimProfileForPrompt(ctx.profile))}

GOALS:
${JSON.stringify(ctx.goals)}

RECOVERY INDICATORS (computed locally, trust these numbers):
level: ${ctx.recovery.level}
reasons: ${ctx.recovery.reasons.join(" | ")}
metrics: ${JSON.stringify(ctx.recovery.metrics)}

LAST 14 DAYS OF GARMIN ACTIVITIES (includes BOTH planned sessions and any unplanned efforts like
hikes — treat every one as real training stress and reconcile the plan against what actually happened):
${JSON.stringify(ctx.last14Activities.map(slimActivity))}

LAST 14 DAYS OF WELLNESS (sleep, resting HR, steps):
${JSON.stringify(ctx.last14Wellness.map(slimWellness))}

LAST 14 DAYS OF HEALTH (VO2 max, HRV, intensity minutes):
${JSON.stringify(ctx.last14Health.map(slimHealth))}

LAST 14 DAYS OF LOGGED EXERCISES:
${JSON.stringify(ctx.last14Logs)}

TODAY'S PLANNED WORKOUT (if already generated):
${JSON.stringify(ctx.todaysWorkout)}

MOST RECENT WEEKLY REVIEW:
${JSON.stringify(ctx.latestReview)}
`.trim();
}
