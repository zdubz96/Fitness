// Claude API access — now routed through the coach-proxy edge function so the Anthropic key
// never reaches the browser and per-user quotas are enforced server-side. Thin re-export shim
// over js/supabase/anthropic.js so every lib/view file importing from "../anthropic.js" keeps
// working unchanged. See docs/SUPABASE_SETUP.md Part 7.
export { sendMessage, sendMessageForJSON, QuotaExceededError } from "./supabase/anthropic.js";
