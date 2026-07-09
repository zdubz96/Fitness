// Supabase Edge Function: delete-account
// Permanently deletes the signed-in user's auth account. Every data table in schema.sql has
// `on delete cascade` on its user_id foreign key, so removing the auth.users row removes all
// of that user's rows automatically — no manual per-table cleanup needed.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided).

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "missing_auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await db.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "invalid_session" }, 401);

    const { error: deleteErr } = await db.auth.admin.deleteUser(userData.user.id);
    if (deleteErr) return json({ error: "delete_failed", detail: deleteErr.message }, 500);

    return json({ ok: true }, 200);
  } catch (e) {
    console.error(e);
    return json({ error: "internal_error", detail: String(e) }, 500);
  }
});

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
