import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_ID = "com.devcedrick.nexoraaidrama";
const DEVICE_PAGE_SIZE = 500;
const DELIVERY_BATCH_SIZE = 100;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-nexora-release-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

Deno.serve(async (req: Request) => {
  let claimAdmin: any = null;
  let claimedEventKey = "";
  let claimToken = "";
  let deliveredThisAttempt = 0;
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
    if (!url || !key) return json({ error: "Server configuration unavailable" }, 500);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    claimAdmin = admin;
    const eventKey = "app_update:" + version;
    const serviceJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    if (!serviceJson) return json({ error: "Firebase sender is not configured" }, 500);
    const account = JSON.parse(serviceJson);
    if (account.project_id !== "nexora-ai-drama" || !account.client_email || !account.private_key) {
      return json({ error: "Firebase service-account configuration is invalid" }, 500);
    }

    const { data: firstDevices, error: firstDeviceError } = await admin
      .from("nexora_push_devices").select("token")
      .eq("app_id", APP_ID).eq("platform", "android").not("user_id", "is", null)
      .order("token", { ascending: true }).range(0, DEVICE_PAGE_SIZE - 1);
    if (firstDeviceError) throw firstDeviceError;
    if (!firstDevices?.length) {
      return json({ ok: true, version, sent: 0, reason: "No eligible NEXORA AI DRAMA Android devices yet; retry after registration" });
    }

    claimToken = crypto.randomUUID();
    const { data: claimed, error: claimError } = await admin.rpc("nexora_claim_push_event", {
      p_event_key: eventKey, p_claim_token: claimToken
    });
    if (claimError) throw claimError;
    if (claimed !== true) return json({ ok: true, duplicate: true, sent: 0 });
    claimedEventKey = eventKey;

    // Seed every registered device in bounded pages. Supabase applies a
    // default row cap to unbounded selects; explicit ranges prevent silently
    // omitting devices once the audience grows beyond that cap.
    let devicePage = firstDevices;
    let deviceOffset = 0;
    while (devicePage?.length) {
      const progressRows = devicePage.map((device: { token: string }) => ({
        event_key: eventKey, token: device.token, status: "pending"
      }));
      const { error: seedError } = await admin.from("nexora_push_deliveries")
        .upsert(progressRows, { onConflict: "event_key,token", ignoreDuplicates: true });
      if (seedError) throw seedError;
      if (devicePage.length < DEVICE_PAGE_SIZE) break;
      deviceOffset += DEVICE_PAGE_SIZE;
      const { data: nextPage, error: nextPageError } = await admin
        .from("nexora_push_devices").select("token")
        .eq("app_id", APP_ID).eq("platform", "android").not("user_id", "is", null)
        .order("token", { ascending: true })
        .range(deviceOffset, deviceOffset + DEVICE_PAGE_SIZE - 1);
      if (nextPageError) throw nextPageError;
      devicePage = nextPage || [];
    }

    const accessToken = await getFirebaseAccessToken(account);
    let invalidTokensRemoved = 0;
    let pendingBatch: { token: string; attempt_count: number }[] = [];
    do {
      const { data, error: pendingError } = await admin.from("nexora_push_deliveries")
        .select("token,attempt_count").eq("event_key", eventKey).eq("status", "pending")
        .order("token", { ascending: true }).limit(DELIVERY_BATCH_SIZE);
      if (pendingError) throw pendingError;
      pendingBatch = data || [];
      for (const device of pendingBatch) {
      const attemptedAt = new Date().toISOString();
      const { error: attemptError } = await admin.from("nexora_push_deliveries")
        .update({ attempt_count: Number(device.attempt_count || 0) + 1, last_attempt_at: attemptedAt, updated_at: attemptedAt })
        .eq("event_key", eventKey).eq("token", device.token).eq("status", "pending");
      if (attemptError) throw attemptError;

      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: {
          token: device.token,
          notification: {
            title: "NEXORA AI DRAMA update available",
            body: `Version ${version} is ready. Tap to check for the update.`
          },
          data: {
            type: "app_update", version,
            updateUrl: "https://raw.githubusercontent.com/DEVcedrick-project/NEXORA-AI-DRAMA/main/update.json"
          },
          android: { priority: "HIGH", notification: { channel_id: "nexora_updates", sound: "default" } }
        }})
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        deliveredThisAttempt++;
        const sentAt = new Date().toISOString();
        const { error: markSentError } = await admin.from("nexora_push_deliveries")
          .update({ status: "sent", sent_at: sentAt, updated_at: sentAt })
          .eq("event_key", eventKey).eq("token", device.token).eq("status", "pending");
        if (markSentError) throw markSentError;
      } else {
        const code = result?.error?.details?.find((item: any) => item?.errorCode)?.errorCode;
        if (code === "UNREGISTERED") {
          const { error: markInvalidError } = await admin.from("nexora_push_deliveries")
            .update({ status: "invalid", updated_at: new Date().toISOString() })
            .eq("event_key", eventKey).eq("token", device.token).eq("status", "pending");
          if (markInvalidError) throw markInvalidError;
          const { error: deleteError } = await admin.from("nexora_push_devices")
            .delete().eq("token", device.token).eq("app_id", APP_ID);
          if (deleteError) throw deleteError;
          invalidTokensRemoved++;
        } else {
          throw new Error(`FCM send failed (${response.status}): ${JSON.stringify(result).slice(0, 400)}`);
        }
      }
      }
    } while (pendingBatch.length === DELIVERY_BATCH_SIZE);

    const { count: sentTotal, error: countError } = await admin.from("nexora_push_deliveries")
      .select("token", { count: "exact", head: true }).eq("event_key", eventKey).eq("status", "sent");
    if (countError) throw countError;
    const { data: completed, error: completeError } = await admin.rpc("nexora_complete_push_event", {
      p_event_key: eventKey, p_claim_token: claimToken
    });
    if (completeError) throw completeError;
    if (completed !== true) throw new Error("Could not finalize update notification event");
    claimedEventKey = "";
    return json({ ok: true, version, sent: sentTotal || 0, sentThisAttempt: deliveredThisAttempt, invalidTokensRemoved });
  } catch (error) {
    if (claimAdmin && claimedEventKey && claimToken && deliveredThisAttempt === 0) {
      await claimAdmin.rpc("nexora_release_push_event", {
        p_event_key: claimedEventKey, p_claim_token: claimToken
      }).catch(() => {});
    }
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

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
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600
  });
  const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = Uint8Array.from(atob(pem), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", binary, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + "." + base64Url(new Uint8Array(signature));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
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
