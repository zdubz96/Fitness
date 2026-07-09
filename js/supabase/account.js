// Account lifecycle helpers for the Supabase-backed app: data export and account deletion
// (PROD-16). Not wired into any view yet — intended for a new "Account" section in
// js/views/settings.js once the cutover happens.
import { supabase, getSession } from "./client.js";
import { refreshAll } from "./state.js";

/** Downloads a single JSON file containing everything this user has stored. */
export async function exportAllData() {
  const all = await refreshAll();
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ai-trainer-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Permanently deletes the signed-in user's account and all their data.
 * Requires a `delete-account` edge function (uses the admin API + service_role to actually
 * remove the auth.users row; the `on delete cascade` foreign keys in schema.sql take care of
 * every data table automatically once that happens). See docs/SUPABASE_SETUP.md.
 */
export async function deleteAccount() {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  const { SUPABASE_URL } = await import("./config.js");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "Could not delete account.");
  }
  await supabase.auth.signOut();
  Object.keys(localStorage)
    .filter((k) => k.startsWith("ft_"))
    .forEach((k) => localStorage.removeItem(k));
}

export async function signOut() {
  await supabase.auth.signOut();
  Object.keys(localStorage)
    .filter((k) => k.startsWith("ft_cache_"))
    .forEach((k) => localStorage.removeItem(k));
}
