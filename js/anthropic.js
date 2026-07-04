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

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: opts.maxTokens || 2048,
    system,
    messages,
  });

  // Mobile browsers (esp. iOS Safari) throw an opaque "Load failed"/"Failed to fetch" when a
  // long request is dropped mid-flight. Give each attempt a generous timeout and retry once on
  // a pure network failure (never on a real API error, which we surface immediately).
  const TIMEOUT_MS = 90000;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${errText}`);
      }
      const json = await res.json();
      return (json.content || []).map((block) => block.text || "").join("");
    } catch (e) {
      clearTimeout(timer);
      // Real API errors (4xx/5xx) shouldn't be retried — only network/abort failures.
      if (e.message && e.message.startsWith("Anthropic API error")) throw e;
      lastErr = e;
      if (attempt === 0) continue; // one retry
    }
  }
  const reason = lastErr?.name === "AbortError" ? "timed out" : "network request failed";
  throw new Error(`Couldn't reach the coach (${reason}). Check your connection and try again.`);
}

/**
 * Extract the first complete JSON object/array from a string, tolerating prose before/after,
 * ```json fences, and trailing chatter. Uses brace matching (string-aware) so nested braces
 * don't trip it up.
 */
function extractJSON(text) {
  // Fast path: already clean or simply fenced.
  const fenced = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(fenced);
  } catch {
    /* fall through to brace scanning */
  }

  const startIdx = (() => {
    const obj = text.indexOf("{");
    const arr = text.indexOf("[");
    if (obj === -1) return arr;
    if (arr === -1) return obj;
    return Math.min(obj, arr);
  })();
  if (startIdx === -1) return null;

  const open = text[startIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(startIdx, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null; // never closed -> likely truncated
}

/** Same as sendMessage but parses the reply as JSON, tolerating fences and surrounding prose. */
export async function sendMessageForJSON(system, messages, opts = {}) {
  const text = await sendMessage(system, messages, opts);
  const parsed = extractJSON(text);
  if (parsed === null) {
    throw new Error(
      `The coach's response couldn't be read as structured data (it may have been cut off). Please try again.\n\nRaw reply:\n${text.slice(0, 500)}`
    );
  }
  return parsed;
}
