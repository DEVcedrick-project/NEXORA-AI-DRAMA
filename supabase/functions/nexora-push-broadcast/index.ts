import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processPushEvent, PAGE_SIZE, type PushWorkerStore, type SendResult } from "./worker.ts";

const APP_ID = "com.devcedrick.nexoraaidrama";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-nexora-release-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const expected = (Deno.env.get("NEXORA_RELEASE_WEBHOOK_SECRET") || "").trim();
  const supplied = (req.headers.get("x-nexora-release-secret") || "").trim();
  if (!expected) return json({ error: "Webhook secret is not configured on the server" }, 503);
  if (!supplied || !constantTimeEqual(supplied, expected)) return json({ error: "Unauthorized: webhook secret mismatch" }, 401);

  try {
    const body = await req.json();
    const version = typeof body.version === "string" ? body.version.slice(0, 32) : "";
    if (!/^\d+\.\d+\.\d+$/.test(version)) return json({ error: "Valid version is required" }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const serviceJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!url || !key || !serviceJson) return json({ error: "Server configuration unavailable" }, 500);
    const account = JSON.parse(serviceJson);
    if (account.project_id !== "nexora-ai-drama" || !account.client_email || !account.private_key) {
      return json({ error: "Firebase service-account configuration is invalid" }, 500);
    }

    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: firstPage, error: deviceCheckError } = await admin
      .from("nexora_push_devices").select("token").eq("app_id", APP_ID)
      .eq("platform", "android").not("user_id", "is", null)
      .order("token", { ascending: true }).limit(1);
    if (deviceCheckError) throw deviceCheckError;
    if (!firstPage?.length) {
      return json({ ok: true, version, sent: 0, reason: "No eligible NEXORA AI DRAMA Android devices yet; retry after registration" });
    }

    const accessToken = await getFirebaseAccessToken(account);
    const eventKey = "app_update:" + version;
    const store: PushWorkerStore = {
      async claim(event, token, seconds) {
        const { data, error } = await admin.rpc("nexora_claim_push_event_v2", {
          p_event_key: event, p_claim_token: token, p_lease_seconds: seconds,
        });
        if (error) throw error;
        return data === true;
      },
      async renew(event, token, seconds) {
        const { data, error } = await admin.rpc("nexora_renew_push_event_v2", {
          p_event_key: event, p_claim_token: token, p_lease_seconds: seconds,
        });
        if (error) throw error;
        return data === true;
      },
      async listDevices(after, limit) {
        let query = admin.from("nexora_push_devices").select("token")
          .eq("app_id", APP_ID).eq("platform", "android").not("user_id", "is", null)
          .order("token", { ascending: true }).limit(limit);
        if (after) query = query.gt("token", after);
        const { data, error } = await query;
        if (error) throw error;
        return (data || []).map((row: { token: string }) => row.token);
      },
      async seed(event, tokens) {
        const rows = tokens.map((token) => ({ event_key: event, token, status: "pending" }));
        const { error } = await admin.from("nexora_push_deliveries")
          .upsert(rows, { onConflict: "event_key,token", ignoreDuplicates: true });
        if (error) throw error;
      },
      async listDue(event, after, limit) {
        let query = admin.from("nexora_push_deliveries")
          .select("token,attempt_count").eq("event_key", event).eq("status", "pending")
          .lte("next_attempt_at", new Date().toISOString())
          .order("token", { ascending: true }).limit(limit);
        if (after) query = query.gt("token", after);
        const { data, error } = await query;
        if (error) throw error;
        return (data || []).map((row: { token: string; attempt_count: number }) => ({
          token: row.token, attempt_count: row.attempt_count || 0,
        }));
      },
      async markSending(event, token, attempt, at) {
        const { data, error } = await admin.from("nexora_push_deliveries")
          .update({ status: "sending", attempt_count: attempt, last_attempt_at: at, updated_at: at })
          .eq("event_key", event).eq("token", token).eq("status", "pending")
          .select("token").maybeSingle();
        if (error) throw error;
        return !!data;
      },
      async markSent(event, token, at) {
        const { data, error } = await admin.from("nexora_push_deliveries")
          .update({ status: "sent", sent_at: at, updated_at: at })
          .eq("event_key", event).eq("token", token).eq("status", "sending")
          .select("token").maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("push_delivery_sent_transition_conflict");
      },
      async markInvalid(event, token, at, code) {
        const { data, error } = await admin.from("nexora_push_deliveries")
          .update({ status: "invalid", last_error_code: safeCode(code), updated_at: at })
          .eq("event_key", event).eq("token", token).eq("status", "sending")
          .select("token").maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("push_delivery_invalid_transition_conflict");
      },
      async removeDevice(token) {
        const { error } = await admin.from("nexora_push_devices")
          .delete().eq("token", token).eq("app_id", APP_ID);
        if (error) throw error;
      },
      async markRetry(event, token, next, at, code) {
        const { data, error } = await admin.from("nexora_push_deliveries")
          .update({ status: "pending", next_attempt_at: next, last_error_code: safeCode(code), updated_at: at })
          .eq("event_key", event).eq("token", token).eq("status", "sending")
          .select("token").maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("push_delivery_retry_transition_conflict");
      },
      async markFailed(event, token, at, code) {
        const { data, error } = await admin.from("nexora_push_deliveries")
          .update({ status: "failed", last_error_code: safeCode(code), updated_at: at })
          .eq("event_key", event).eq("token", token).eq("status", "sending")
          .select("token").maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("push_delivery_failed_transition_conflict");
      },
      async complete(event, token) {
        const { data, error } = await admin.rpc("nexora_complete_push_event_v2", {
          p_event_key: event, p_claim_token: token,
        });
        if (error) throw error;
        return data === true;
      },
      async release(event, token) {
        const { data, error } = await admin.rpc("nexora_release_push_event_v2", {
          p_event_key: event, p_claim_token: token,
        });
        if (error) throw error;
        return data === true;
      },
    };

    const result = await processPushEvent(store, (token) => sendFcm(account, accessToken, token, version, eventKey), eventKey);
    const { count, error: countError } = await admin.from("nexora_push_deliveries")
      .select("token", { count: "exact", head: true }).eq("event_key", eventKey).eq("status", "sent");
    if (countError) throw countError;
    return json({ ok: true, version, sent: count || 0, sentThisAttempt: result.sent,
      invalidTokensRemoved: result.invalid, retried: result.retried, failed: result.failed,
      skipped: result.skipped, duplicate: result.duplicate });
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : "push_worker_failed";
    return json({ error: safeMessage.slice(0, 180) }, 500);
  }
});

async function sendFcm(
  account: { project_id: string },
  accessToken: string,
  token: string,
  version: string,
  eventKey: string,
): Promise<SendResult> {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: {
      token,
      notification: {
        title: "NEXORA AI DRAMA update available",
        body: `Version ${version} is ready. Tap to check for the update.`,
      },
      data: {
        type: "app_update", version,
        updateUrl: "https://raw.githubusercontent.com/DEVcedrick-project/NEXORA-AI-DRAMA/main/update.json",
      },
      android: {
        priority: "HIGH",
        collapse_key: eventKey,
        notification: { channel_id: "nexora_updates", sound: "default", tag: eventKey },
      },
    }) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.ok) return { kind: "sent" };

  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  const detailCode = details.find((item: any) => item?.errorCode)?.errorCode;
  const code = safeCode(detailCode || payload?.error?.status || `HTTP_${response.status}`);
  if (code === "UNREGISTERED") return { kind: "invalid", code };
  if (response.status === 429 || response.status >= 500 ||
      ["UNAVAILABLE", "INTERNAL", "QUOTA_EXCEEDED", "RESOURCE_EXHAUSTED"].includes(code)) {
    return { kind: "retryable", code };
  }
  return { kind: "permanent", code };
}

function safeCode(value: unknown): string {
  const code = String(value || "UNKNOWN").toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
  return code || "UNKNOWN";
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function getFirebaseAccessToken(account: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = encode({ alg: "RS256", typ: "JWT" }) + "." + encode({
    iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  });
  const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = Uint8Array.from(atob(pem), (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", binary, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + "." + base64Url(new Uint8Array(signature));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw new Error("Firebase OAuth token exchange failed");
  return result.access_token;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
