// Supabase Edge Function: garmin-ingest
// Optional "bring your own Garmin sync" path. A user who wants Garmin data runs
// scripts/garmin_sync.py themselves (their own GitHub Actions, their own Garmin
// credentials — this project never holds those) and points it at this endpoint with
// their personal ingest token (generated in Settings, stored in user_settings).
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided).

import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_PAYLOAD_BYTES = 500_000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-ingest-token, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const token = req.headers.get("X-Ingest-Token");
    if (!token) return json({ error: "missing_token" }, 401);

    const rawBody = await req.text();
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    const { data: settingsRow, error: findErr } = await db
      .from("user_settings")
      .select("user_id")
      .eq("garmin_ingest_token", token)
      .maybeSingle();
    if (findErr || !settingsRow) {
      return json({ error: "invalid_token" }, 401);
    }
    const userId = settingsRow.user_id;

    const body = JSON.parse(rawBody);
    const { activities = [], wellness = [], health = [] } = body ?? {};

    if (activities.length) {
      const rows = activities.map((a: Record<string, unknown>) => ({
        user_id: userId,
        activity_id: a.id,
        date: a.date,
        data: a,
      }));
      const { error } = await db.from("garmin_activities").upsert(rows, { onConflict: "user_id,activity_id" });
      if (error) throw error;
    }
    if (wellness.length) {
      const rows = wellness.map((w: Record<string, unknown>) => ({ user_id: userId, date: w.date, data: w }));
      const { error } = await db.from("garmin_wellness").upsert(rows, { onConflict: "user_id,date" });
      if (error) throw error;
    }
    if (health.length) {
      const rows = health.map((h: Record<string, unknown>) => ({ user_id: userId, date: h.date, data: h }));
      const { error } = await db.from("garmin_health").upsert(rows, { onConflict: "user_id,date" });
      if (error) throw error;
    }

    return json({ ok: true, counts: { activities: activities.length, wellness: wellness.length, health: health.length } }, 200);
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
