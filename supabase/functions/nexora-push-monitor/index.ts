import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://github.com",
  "Access-Control-Allow-Headers": "x-nexora-release-secret",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "GET required" }, 405);

  const expected = (Deno.env.get("NEXORA_RELEASE_WEBHOOK_SECRET") || "").trim();
  const supplied = (req.headers.get("x-nexora-release-secret") || "").trim();
  if (!expected) return json({ error: "Monitoring secret is not configured" }, 503);
  if (!supplied || !constantTimeEqual(supplied, expected)) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server configuration unavailable" }, 500);

  try {
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.from("nexora_push_deliveries")
      .select("event_key,status,attempt_count,last_attempt_at,updated_at,response_status,last_error_code")
      .order("updated_at", { ascending: false }).limit(500);
    if (error) throw error;

    const now = Date.now();
    const events = new Map<string, any>();
    for (const row of data || []) {
      if (!events.has(row.event_key)) events.set(row.event_key, {
        eventKey: row.event_key,
        counts: { pending: 0, sending: 0, sent: 0, failed: 0, invalid: 0 },
        stalePending: 0,
        stuckSending: [],
        lastUpdatedAt: row.updated_at,
      });
      const event = events.get(row.event_key);
      if (event.counts[row.status] !== undefined) event.counts[row.status]++;
      if (row.status === "pending" && now - new Date(row.updated_at).getTime() > 10 * 60 * 1000) event.stalePending++;
      if (row.status === "sending" && now - new Date(row.updated_at).getTime() > 10 * 60 * 1000) event.stuckSending.push({
        attempts: row.attempt_count,
        lastAttemptAt: row.last_attempt_at,
        updatedAt: row.updated_at,
        
      });
    }
    return json({
      ok: true,
      generatedAt: new Date(now).toISOString(),
      stalePendingThresholdMinutes: 10,
      events: [...events.values()],
      truncated: (data || []).length === 500,
      note: "Sending rows older than the threshold are ambiguous: the sender persisted the sending state before calling FCM. They are not automatically retried. Sent means FCM accepted the request, not that Android displayed the notification.",
    });
  } catch (_error) {
    return json({ error: "Push monitoring query failed" }, 503);
  }
});

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
