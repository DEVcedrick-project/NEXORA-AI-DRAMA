import { enforceNexoraAppCheck, verifyNexoraAppCheck } from "../_shared/nexora-app-check.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJECT_ID = "nexora-ai-drama";
const MAX_DEVICES_PER_USER = 5;
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-nexora-app-id, x-firebase-appcheck",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const appCheckStatus = await verifyNexoraAppCheck(req);
  if (enforceNexoraAppCheck(appCheckStatus)) {
    return json({ error: "A valid NEXORA app attestation is required" }, 401);
  }
  if (appCheckStatus !== "valid") {
    console.info("[NEXORA App Check] Push registration attestation status:", appCheckStatus);
  }

  const appId = req.headers.get("x-nexora-app-id") || "";
  if (appId !== "com.devcedrick.nexoraaidrama") {
    return json({ error: "Invalid app identity" }, 403);
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
    if (!userId || userId.length > 128) {
      return json({ error: "Invalid Firebase user identity" }, 401);
    }
  } catch {
    return json({ error: "Invalid or expired Firebase ID token" }, 401);
  }

  try {
    const body = await req.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const version = typeof body?.app_version === "string" ? body.app_version.trim() : "";
    const installId = typeof body?.install_id === "string" ? body.install_id.trim() : "";

    if (token.length < 80 || token.length > 4096 || /\s/.test(token)) {
      return json({ error: "Invalid FCM registration token" }, 400);
    }
    if (!/^v?\d+\.\d+\.\d+$/.test(version)) {
      return json({ error: "Invalid app version" }, 400);
    }
    if (!/^[0-9a-f-]{36}$/i.test(installId)) {
      return json({ error: "Invalid installation identifier" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ error: "Server configuration unavailable" }, 500);

    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

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
    console.error("[NEXORA Push] Invalid registration request:", error);
    return json({ error: "Invalid registration request" }, 400);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
