import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAppCheckAllowed, verifyAppCheckToken } from "./app-check.ts";

const PROJECT_ID = "nexora-ai-drama";
const APP_ID = "com.devcedrick.nexoraaidrama";
const MAX_DEVICES_PER_USER = 5;
const MAX_BODY_BYTES = 8192;
const PROJECT_NUMBER = "201389649043";
const FIREBASE_APP_ID = "1:201389649043:android:4dd0433ed5959b5e85f166";
const APP_CHECK_JWKS = createRemoteJWKSet(
  new URL("https://firebaseappcheck.googleapis.com/v1/jwks"),
  { cacheMaxAge: 6 * 60 * 60 * 1000 },
);
async function verifyAppCheck(req: Request) {
  const token = (req.headers.get("x-firebase-appcheck") || "").trim();
  return await verifyAppCheckToken(token, FIREBASE_APP_ID, async (value) => {
    return await jwtVerify(value, APP_CHECK_JWKS, {
      algorithms: ["RS256"],
      issuer: `https://firebaseappcheck.googleapis.com/${PROJECT_NUMBER}`,
      audience: `projects/${PROJECT_NUMBER}`,
    });
  });
}
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-nexora-app-id, x-firebase-appcheck",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const appCheckStatus = await verifyAppCheck(req);
  const appCheckEnforcementEnabled = Deno.env.get("NEXORA_APP_CHECK_ENFORCE") === "true";
  if (!isAppCheckAllowed(appCheckStatus, appCheckEnforcementEnabled)) {
    return json({ error: "A valid NEXORA app attestation is required" }, 401);
  }
  if (appCheckStatus !== "valid") {
    console.info("[NEXORA App Check] Push registration attestation status:", appCheckStatus);
  }


  const appId = req.headers.get("x-nexora-app-id") || "";
  if (appId !== APP_ID) return json({ error: "Invalid app identity" }, 403);

  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    return json({ error: "Content-Type must be application/json" }, 415);
  }

  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
      return json({ error: "Request body is too large" }, 413);
    }
  }

  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "Firebase authentication required" }, 401);

  let userId = "";
  try {
    const verified = await jwtVerify(match[1], FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    });
    userId = typeof verified.payload.sub === "string" ? verified.payload.sub : "";
    if (!userId || userId.length > 128 || verified.payload.user_id !== userId) {
      return json({ error: "Invalid Firebase user identity" }, 401);
    }
  } catch {
    return json({ error: "Invalid or expired Firebase ID token" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Server configuration unavailable" }, 500);

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: allowed, error: rateError } = await admin.rpc(
      "nexora_check_push_registration_rate_limit",
      { p_user_id: userId },
    );
    if (rateError) {
      console.error("[NEXORA Push] Registration rate-limit check failed:", rateError.code || "unknown");
      return json({ error: "Device registration is temporarily unavailable" }, 503);
    }
    if (allowed !== true) {
      return new Response(JSON.stringify({ error: "Too many registration attempts. Please try again in one minute." }), {
        status: 429,
        headers: { ...cors, "Retry-After": "60" },
      });
    }
  } catch {
    return json({ error: "Device registration is temporarily unavailable" }, 503);
  }

  let rawBody: string;
  try {
    if (!req.body) return json({ error: "Request body is required" }, 400);
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return json({ error: "Request body is too large" }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return json({ error: "Invalid request body encoding" }, 400);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "JSON object required" }, 400);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON request body" }, 400);
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const version = typeof body.app_version === "string" ? body.app_version.trim() : "";
  const installId = typeof body.install_id === "string" ? body.install_id.trim() : "";

  if (token.length < 80 || token.length > 4096 || !/^[A-Za-z0-9:_-]+$/.test(token)) {
    return json({ error: "Invalid FCM registration token" }, 400);
  }
  if (version.length > 32 || !/^v?\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(version)) {
    return json({ error: "Invalid app version" }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(installId)) {
    return json({ error: "Invalid installation identifier" }, 400);
  }

  try {
    const { data: registration, error } = await admin.rpc("nexora_register_push_device", {
      p_token: token,
      p_user_id: userId,
      p_app_version: version,
      p_install_id: installId,
    });

    if (error) {
      console.error("[NEXORA Push] Atomic device registration failed:", error.code || "unknown");
      return json({ error: "Device registration is temporarily unavailable" }, 503);
    }
    if (registration === "device_limit") {
      return json({ error: `A maximum of ${MAX_DEVICES_PER_USER} devices can be registered per account` }, 429);
    }
    if (registration === "token_conflict") {
      return json({ error: "This notification token is already linked to another account" }, 409);
    }
    if (registration !== "registered") {
      console.error("[NEXORA Push] Unexpected registration result.");
      return json({ error: "Device registration failed" }, 503);
    }

    return json({ ok: true, registered: true, maxDevices: MAX_DEVICES_PER_USER });
  } catch (error) {
    console.error("[NEXORA Push] Registration service failure:", error instanceof Error ? error.name : "unknown");
    return json({ error: "Device registration is temporarily unavailable" }, 503);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
