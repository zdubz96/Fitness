// Supabase-backed replacement for js/anthropic.js. Calls the coach-proxy edge function
// instead of Anthropic directly — the API key never reaches the browser, and the proxy
// enforces the per-user monthly token quota. Same public API as js/anthropic.js
// (sendMessage, sendMessageForJSON) so callers don't need to change on cutover.
import { getAccessToken } from "./client.js";
import { SUPABASE_URL } from "./config.js";

const PROXY_URL = `${SUPABASE_URL}/functions/v1/coach-proxy`;

export class QuotaExceededError extends Error {
  constructor(detail) {
    super("You've used this month's coaching budget. It resets at the start of next month.");
    this.name = "QuotaExceededError";
    this.detail = detail;
  }
}

export async function sendMessage(system, messages, opts = {}) {
  const token = await getAccessToken();
  if (!token) throw new Error("Not signed in.");

  const body = JSON.stringify({
    max_tokens: opts.maxTokens || 2048,
    system,
    messages,
  });

  const TIMEOUT_MS = 90000;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429) {
        const errJson = await res.json().catch(() => ({}));
        throw new QuotaExceededError(errJson);
      }
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Coach service error ${res.status}: ${errText}`);
      }
      const json = await res.json();
      return (json.content || []).map((block) => block.text || "").join("");
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof QuotaExceededError) throw e;
      if (e.message && e.message.startsWith("Coach service error")) throw e;
      lastErr = e;
      if (attempt === 0) continue; // one retry on pure network failure
    }
  }
  const reason = lastErr?.name === "AbortError" ? "timed out" : "network request failed";
  throw new Error(`Couldn't reach the coach (${reason}). Check your connection and try again.`);
}

/** Same brace-matching JSON extraction as js/anthropic.js — see that file for rationale. */
function extractJSON(text) {
  const fenced = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(fenced);
  } catch {
    /* fall through */
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
  return null;
}

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
