// Supabase Edge Function: signup
// Gate registration behind an invite code. Client posts { email, password, code } here
// instead of calling supabase.auth.signUp() directly, so an invalid/used code never
// creates an account.
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
    const { email, password, code } = await req.json();
    if (!email || !password || !code) {
      return json({ error: "missing_fields", detail: "email, password, and code are required" }, 400);
    }
    if (String(password).length < 8) {
      return json({ error: "weak_password", detail: "Password must be at least 8 characters" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    const normalizedCode = String(code).trim().toUpperCase();
    const { data: invite, error: inviteErr } = await db
      .from("invite_codes")
      .select("code, max_uses, uses")
      .eq("code", normalizedCode)
      .maybeSingle();

    if (inviteErr || !invite) {
      return json({ error: "invalid_code", detail: "That invite code wasn't found." }, 403);
    }
    if (invite.uses >= invite.max_uses) {
      return json({ error: "code_exhausted", detail: "That invite code has already been used." }, 403);
    }

    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: false, // Supabase sends the confirmation email itself
    });
    if (createErr || !created?.user) {
      return json({ error: "signup_failed", detail: createErr?.message ?? "Could not create account" }, 400);
    }

    await db
      .from("invite_codes")
      .update({ uses: invite.uses + 1, used_by: created.user.id, used_at: new Date().toISOString() })
      .eq("code", normalizedCode);

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
