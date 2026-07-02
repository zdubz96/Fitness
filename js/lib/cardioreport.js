import { sendMessage } from "../anthropic.js";
import { buildCoachContext, contextToPromptText } from "./context.js";
import { getLocal, save } from "../state.js";

const SYSTEM_PROMPT = `You are an AI personal trainer writing a quarterly cardiovascular health
report for your client in plain language (not JSON — a few short paragraphs). Summarize: VO2 max
trajectory over the period, resting heart rate change, and fitness age movement. Be specific with
numbers where the data supports it, and end with one or two concrete recommendations for the
next quarter.`;

export async function generateQuarterlyCardioReport() {
  const ctx = buildCoachContext();
  const userMessage = `Write this quarter's cardio health report.\n\n${contextToPromptText(ctx)}`;
  const text = await sendMessage(SYSTEM_PROMPT, [{ role: "user", content: userMessage }], { maxTokens: 1024 });

  const profile = getLocal("trainer_profile") || {};
  const report = { at: new Date().toISOString(), text };
  const nextProfile = { ...profile, cardio_reports: [...(profile.cardio_reports || []), report] };
  await save("trainer_profile", nextProfile, "chore: quarterly cardio report");
  return report;
}
