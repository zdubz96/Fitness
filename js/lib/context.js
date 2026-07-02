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

/** Renders the context bundle into a compact text block for a Claude system prompt. */
export function contextToPromptText(ctx) {
  return `
TODAY'S DATE: ${ctx.today}

TRAINER PROFILE:
${JSON.stringify(ctx.profile, null, 2)}

GOALS:
${JSON.stringify(ctx.goals, null, 2)}

RECOVERY INDICATORS (computed locally, trust these numbers):
level: ${ctx.recovery.level}
reasons: ${ctx.recovery.reasons.join(" | ")}
metrics: ${JSON.stringify(ctx.recovery.metrics)}

LAST 14 DAYS OF GARMIN ACTIVITIES:
${JSON.stringify(ctx.last14Activities)}

LAST 14 DAYS OF WELLNESS (sleep, resting HR, steps):
${JSON.stringify(ctx.last14Wellness)}

LAST 14 DAYS OF HEALTH (VO2 max, HRV, intensity minutes):
${JSON.stringify(ctx.last14Health)}

LAST 14 DAYS OF LOGGED EXERCISES:
${JSON.stringify(ctx.last14Logs)}

TODAY'S PLANNED WORKOUT (if already generated):
${JSON.stringify(ctx.todaysWorkout)}

MOST RECENT WEEKLY REVIEW:
${JSON.stringify(ctx.latestReview)}
`.trim();
}
