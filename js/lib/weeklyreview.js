import { sendMessageForJSON } from "../anthropic.js";
import { buildCoachContext, contextToPromptText } from "./context.js";
import { getLocal, save } from "../state.js";
import { COACHING_PRINCIPLES } from "./principles.js";

const SYSTEM_PROMPT = `${COACHING_PRINCIPLES}

You are an AI personal trainer writing this week's Coach Review for your
client, using their full context (profile, goals, recovery indicators, last 14 days of Garmin
data, recent logs). Report progress vs. their goals with concrete numbers where you can compute
or estimate them, what went well, what to adjust, and next week's focus. Also report specifically
on cardio progress if they have a cardio goal: VO2 max movement, Zone 2 volume, and whether their
easy/hard training polarization looks right (flag if too much training sits in the moderate
"gray zone" between Zone 2 and threshold).

Keep each field tight and scannable — a few sentences at most, not an essay. This renders on a
phone. Respond with ONLY a JSON object (no markdown fences, no commentary):
{
  "progress": string,       // progress vs goals, with concrete numbers (<= ~4 sentences)
  "wins": string,           // <= ~3 sentences
  "adjustments": string,    // <= ~3 sentences
  "next_week_focus": string,// <= ~3 sentences
  "cardio_notes": string    // VO2 max/zone/polarization commentary, or "" if no cardio goal
}`;

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function currentWeekKey() {
  return isoWeekKey(new Date());
}

export function needsWeeklyReview(reviews) {
  const key = currentWeekKey();
  return !reviews.some((r) => r.week === key);
}

export async function generateWeeklyReview() {
  const ctx = buildCoachContext();
  const userMessage = `Write this week's Coach Review.\n\n${contextToPromptText(ctx)}`;
  const result = await sendMessageForJSON(SYSTEM_PROMPT, [{ role: "user", content: userMessage }], { maxTokens: 3000 });

  const review = {
    week: currentWeekKey(),
    generated_at: new Date().toISOString(),
    ...result,
  };

  const reviews = getLocal("weekly_reviews");
  const next = [...reviews.filter((r) => r.week !== review.week), review];
  await save("weekly_reviews", next, `chore: weekly review ${review.week}`);
  return review;
}
