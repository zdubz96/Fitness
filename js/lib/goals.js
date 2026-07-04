import { sendMessageForJSON } from "../anthropic.js";
import { buildCoachContext, contextToPromptText } from "./context.js";
import { getLocal, save } from "../state.js";

const SYSTEM_PROMPT = `You are an AI personal trainer estimating progress on ONE of your client's
goals, using their full context (recent logs, Garmin data, profile). Give your best concrete
estimate even if the data is imperfect — say so in the summary if you're extrapolating.

Respond with ONLY a JSON object (no markdown fences, no commentary):
{ "progress_pct": number|null, "summary": string }`;

export async function estimateGoalProgress(goal) {
  const ctx = buildCoachContext();
  const userMessage = `Goal: ${JSON.stringify(goal)}\n\n${contextToPromptText(ctx)}`;
  const result = await sendMessageForJSON(SYSTEM_PROMPT, [{ role: "user", content: userMessage }], { maxTokens: 1024 });

  const goals = getLocal("goals");
  const idx = goals.findIndex((g) => g.id === goal.id);
  if (idx >= 0) {
    goals[idx] = { ...goals[idx], progress: { ...result, at: new Date().toISOString() } };
    await save("goals", goals, `chore: estimate progress for ${goal.text}`);
  }
  return result;
}
