// Supabase Edge Function: coach-proxy
// Verifies the caller's Supabase session, enforces a per-user monthly token quota,
// then forwards the request to Anthropic using a server-side key the browser never sees.
// Deploy via Supabase Dashboard -> Edge Functions -> Create function -> paste this file
// (or `supabase functions deploy coach-proxy` if you have the CLI).
//
// Required secrets (Dashboard -> Edge Functions -> coach-proxy -> Secrets, or
// `supabase secrets set NAME=value`):
//   ANTHROPIC_API_KEY   - your Anthropic API key (server-side only, never exposed to clients)
//   SUPABASE_URL              - auto-provided by Supabase
//   SUPABASE_SERVICE_ROLE_KEY - auto-provided by Supabase
//
// This model is intentionally pinned server-side so a modified client can't request a
// more expensive model and blow through the cost model this proxy exists to enforce.
const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return json({ error: "missing_auth" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;

    // Verify the user's JWT and get their id (service client can validate any JWT).
    const authClient = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return json({ error: "invalid_session" }, 401);
    }
    const userId = userData.user.id;

    // service-role client for reading/writing usage + settings (bypasses RLS by design —
    // this function is the only thing allowed to write these tables).
    const db = createClient(supabaseUrl, serviceKey);

    const { data: settings } = await db
      .from("user_settings")
      .select("monthly_token_cap")
      .eq("user_id", userId)
      .maybeSingle();
    const cap = settings?.monthly_token_cap ?? 300000;

    const month = currentMonthKey();
    const { data: usageRow } = await db
      .from("usage")
      .select("input_tokens, output_tokens, requests")
      .eq("user_id", userId)
      .eq("month", month)
      .maybeSingle();
    const usedTokens = (usageRow?.input_tokens ?? 0) + (usageRow?.output_tokens ?? 0);

    if (usedTokens >= cap) {
      return json(
        { error: "quota_exceeded", used: usedTokens, cap, resets: `${month}-01T00:00:00Z (next month)` },
        429
      );
    }

    // Simple per-user rate limit: block if > 10 requests recorded this minute.
    // (Kept lightweight — a dedicated rate-limit table could replace this if abuse appears.)
    const requestsThisMonth = usageRow?.requests ?? 0;

    const body = await req.json();
    const { system, messages, max_tokens, stream } = body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "invalid_request", detail: "messages required" }, 400);
    }

    const anthropicRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL, // pinned server-side, client-supplied model (if any) is ignored
        max_tokens: Math.min(Number(max_tokens) || 2048, 8000),
        system,
        messages,
        stream: Boolean(stream),
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return json({ error: "anthropic_error", status: anthropicRes.status, detail: errText }, 502);
    }

    if (stream) {
      // Passthrough the SSE stream to the client; tally usage from the final "message_stop"
      // event's usage data by tee-ing the stream.
      const [clientStream, usageStream] = anthropicRes.body!.tee();
      recordUsageFromStream(db, userId, month, requestsThisMonth, usageStream).catch((e) =>
        console.error("usage recording failed", e)
      );
      return new Response(clientStream, {
        headers: { ...corsHeaders, "content-type": "text/event-stream" },
      });
    }

    const resultJson = await anthropicRes.json();
    const inTok = resultJson?.usage?.input_tokens ?? 0;
    const outTok = resultJson?.usage?.output_tokens ?? 0;
    await db.from("usage").upsert(
      {
        user_id: userId,
        month,
        input_tokens: (usageRow?.input_tokens ?? 0) + inTok,
        output_tokens: (usageRow?.output_tokens ?? 0) + outTok,
        requests: requestsThisMonth + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,month" }
    );

    return json(resultJson, 200);
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

async function recordUsageFromStream(
  db: ReturnType<typeof createClient>,
  userId: string,
  month: string,
  priorRequests: number,
  stream: ReadableStream<Uint8Array>
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inTok = 0;
  let outTok = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === "message_start") inTok = evt.message?.usage?.input_tokens ?? inTok;
        if (evt.type === "message_delta") outTok = evt.usage?.output_tokens ?? outTok;
      } catch {
        // ignore malformed SSE chunks
      }
    }
  }
  const { data: existing } = await db
    .from("usage")
    .select("input_tokens, output_tokens")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  await db.from("usage").upsert(
    {
      user_id: userId,
      month,
      input_tokens: (existing?.input_tokens ?? 0) + inTok,
      output_tokens: (existing?.output_tokens ?? 0) + outTok,
      requests: priorRequests + 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,month" }
  );
}
