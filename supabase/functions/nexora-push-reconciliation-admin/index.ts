import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { allowedOrigin, hasPushAdminRole, parseReconciliationRequest } from "./security.ts";

const configuredOrigins = Deno.env.get("NEXORA_ADMIN_ALLOWED_ORIGINS") || "";
const corsHeaders = (origin: string | null) => ({
  ...(origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
});

Deno.serve(async (req: Request) => {
  const origin = allowedOrigin(req.headers.get("origin"), configuredOrigins);
  if (req.headers.has("origin") && !origin) return json({ error: "Origin not allowed" }, 403, null);
  if (req.method === "OPTIONS") return new Response("ok", { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "Authentication required" }, 401, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration unavailable" }, 503, origin);

  const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await verifier.auth.getUser(match[1]);
  if (authError || !authData.user || !hasPushAdminRole(authData.user)) {
    return json({ error: "Forbidden" }, authError || !authData.user ? 401 : 403, origin);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (req.method === "GET") {
    const rawLimit = new URL(req.url).searchParams.get("limit");
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return json({ error: "limit must be between 1 and 100" }, 400, origin);
    const { data, error } = await admin.from("nexora_push_deliveries")
      .select("delivery_id,event_key,status,last_error_code,attempt_count,last_attempt_at,updated_at")
      .eq("status", "unknown").order("updated_at", { ascending: false }).limit(limit);
    if (error) return json({ error: "Could not load unknown deliveries" }, 500, origin);
    return json({ ok: true, deliveries: data || [] }, 200, origin);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400, origin); }
  const parsed = parseReconciliationRequest(body);
  if (!parsed) return json({ error: "A valid deliveryId, evidenceReference, and reason are required" }, 400, origin);

  const { data, error } = await admin.rpc("nexora_reconcile_push_delivery_by_id_v1", {
    p_delivery_id: parsed.deliveryId,
    p_evidence_reference: parsed.evidenceReference,
    p_reason: parsed.reason,
    p_operator_reference: authData.user.id,
  });
  if (error) {
    const code = error.code || "";
    if (code === "P0002") return json({ error: "Delivery not found" }, 404, origin);
    if (code === "55000") return json({ error: "Only unknown deliveries can be confirmed" }, 409, origin);
    if (code === "22023") return json({ error: "Invalid reconciliation input" }, 400, origin);
    return json({ error: "Reconciliation failed" }, 500, origin);
  }
  return json({ ok: true, result: data }, 200, origin);
});

function json(value: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(value), { status, headers: corsHeaders(origin) });
}
