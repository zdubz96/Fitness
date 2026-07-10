// Garmin "bring your own sync" setup (PROD-7). The user runs scripts/garmin_sync.py
// themselves (their own GitHub Actions, their own Garmin credentials — this app never holds
// those) and points it at the garmin-ingest edge function using this per-user token.
import { supabase, getSession } from "./client.js";
import { SUPABASE_URL } from "./config.js";

export function ingestUrl() {
  return `${SUPABASE_URL}/functions/v1/garmin-ingest`;
}

export async function getIngestToken() {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  const { data, error } = await supabase
    .from("user_settings")
    .select("garmin_ingest_token")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  return data?.garmin_ingest_token ?? null;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Generates a fresh token, overwriting any existing one (old token stops working immediately). */
export async function regenerateIngestToken() {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  const token = randomToken();
  const { error } = await supabase
    .from("user_settings")
    .update({ garmin_ingest_token: token })
    .eq("user_id", session.user.id);
  if (error) throw error;
  return token;
}

export async function clearIngestToken() {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  const { error } = await supabase
    .from("user_settings")
    .update({ garmin_ingest_token: null })
    .eq("user_id", session.user.id);
  if (error) throw error;
}
