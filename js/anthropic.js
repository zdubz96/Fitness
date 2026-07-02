// All Claude API calls go through here. Direct browser calls per project spec.
import { getSettings } from "./state.js";

const MODEL = "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";

/**
 * @param {string} system - system prompt (trainer profile + context goes here)
 * @param {{role: "user"|"assistant", content: string}[]} messages
 * @param {{maxTokens?: number}} [opts]
 * @returns {Promise<string>} the assistant's text reply
 */
export async function sendMessage(system, messages, opts = {}) {
  const { anthropicKey } = getSettings();
  if (!anthropicKey) throw new Error("Anthropic API key is not configured yet.");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: opts.maxTokens || 2048,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }
  const body = await res.json();
  return (body.content || []).map((block) => block.text || "").join("");
}

/** Same as sendMessage but parses the reply as JSON, stripping ```json fences if present. */
export async function sendMessageForJSON(system, messages, opts = {}) {
  const text = await sendMessage(system, messages, opts);
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Coach reply was not valid JSON: ${e.message}\n${text}`);
  }
}
