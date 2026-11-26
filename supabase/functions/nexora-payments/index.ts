import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const FIREBASE_PROJECT_ID = "nexora-ai-drama";
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PAYMONGO_SECRET_KEY = Deno.env.get("PAYMONGO_SECRET_KEY") || "";
const PAYMONGO_WEBHOOK_SECRET = Deno.env.get("PAYMONGO_WEBHOOK_SECRET") || "";
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/nexora-payments`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const PRODUCTS: Record<string, {
  title: string; amount: number; coins: number; purchasedCoins: number; bonusCoins: number; vipDays: number;
}> = {
  vip7: { title: "7-Day Binge Pass", amount: 69, coins: 0, purchasedCoins: 0, bonusCoins: 0, vipDays: 7 },
  vip30: { title: "30-Day VIP Pass (+150 Coins)", amount: 99, coins: 150, purchasedCoins: 0, bonusCoins: 150, vipDays: 30 },
  starter: { title: "First-Time Starter Bundle (160 Coins)", amount: 49, coins: 160, purchasedCoins: 100, bonusCoins: 60, vipDays: 0 },
  pack1: { title: "300 + 30 Bonus Coins", amount: 149, coins: 330, purchasedCoins: 300, bonusCoins: 30, vipDays: 0 },
  pack2: { title: "650 + 100 Bonus Coins", amount: 299, coins: 750, purchasedCoins: 650, bonusCoins: 100, vipDays: 0 },
  pack3: { title: "1,600 + 350 Bonus Coins", amount: 699, coins: 1950, purchasedCoins: 1600, bonusCoins: 350, vipDays: 0 },
};
const PAYMENT_METHODS: Record<string, string> = {
  GCash: "gcash",
  Maya: "paymaya",
  "QR Ph": "qrph",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function htmlPage(title: string, message: string) {
  const safeTitle = title.replace(/[<>&"]/g, "");
  const safeMessage = message.replace(/[<>&"]/g, "");
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#09090f"><title>${safeTitle}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090f;color:#fff;font:16px system-ui;padding:24px;box-sizing:border-box}.card{max-width:420px;text-align:center;background:#171722;border:1px solid #333344;border-radius:24px;padding:32px}h1{font-size:24px}p{color:#b7b7c6;line-height:1.6}</style></head><body><main class="card"><h1>${safeTitle}</h1><p>${safeMessage}</p><p>You can return to NEXORA AI DRAMA and tap “Check payment status”. VIP and coins are granted only after PayMongo confirms payment.</p></main></body></html>`, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
async function authenticate(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token === req.headers.get("apikey")) throw new Error("AUTH_REQUIRED");
  const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });
  const userId = String(payload.sub || "");
  const firebase = (payload.firebase || {}) as Record<string, unknown>;
  if (!userId || userId.length > 128 || firebase.sign_in_provider === "anonymous") {
    throw new Error("PERMANENT_ACCOUNT_REQUIRED");
  }
  return userId;
}
function dbClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("PAYMENT_BACKEND_NOT_CONFIGURED");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifyPayMongoSignature(rawBody: string, header: string, livemode: boolean) {
  if (!PAYMONGO_WEBHOOK_SECRET) throw new Error("PAYMONGO_WEBHOOK_SECRET_MISSING");
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const index = part.indexOf("=");
    return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ["", ""];
  }));
  const timestamp = parts.t;
  const supplied = livemode ? parts.li : parts.te;
  if (!timestamp || !supplied || !/^\d+$/.test(timestamp)) return false;
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(PAYMONGO_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  return constantTimeEqual(bytesToHex(new Uint8Array(signature)), supplied.toLowerCase());
}

async function createCheckout(userId: string, body: Record<string, unknown>) {
  if (!PAYMONGO_SECRET_KEY) return json(503, { error: "PayMongo is not configured. Add the server-side payment secret first." });
  const sku = String(body.sku || "");
  const method = String(body.method || "");
  const product = PRODUCTS[sku];
  const paymentType = PAYMENT_METHODS[method];
  if (!product || !paymentType) return json(400, { error: "Unsupported package or payment method." });

  const db = dbClient();
  const { data: order, error: insertError } = await db.from("nexora_payment_orders").insert({
    user_id: userId,
    sku,
    title: product.title,
    amount_php: product.amount,
    coins_granted: product.coins,
    purchased_coins_granted: product.purchasedCoins,
    bonus_coins_granted: product.bonusCoins,
    vip_days: product.vipDays,
    payment_method: paymentType,
    status: "pending",
  }).select("reference_number").single();
  if (insertError || !order) {
    console.error("[nexora-payments] order creation failed", insertError?.message);
    return json(500, { error: "Could not create your payment order. Please try again." });
  }

  const reference = String(order.reference_number);
  const returnBase = FUNCTION_URL;
  const payload = {
    data: {
      attributes: {
        line_items: [{
          name: product.title,
          amount: product.amount * 100,
          currency: "PHP",
          quantity: 1,
        }],
        payment_method_types: [paymentType],
        success_url: `${returnBase}?result=success&ref=${encodeURIComponent(reference)}`,
        cancel_url: `${returnBase}?result=cancel&ref=${encodeURIComponent(reference)}`,
        reference_number: reference,
        send_email_receipt: true,
        metadata: { nexora_user_id: userId, sku },
      },
    },
  };

  try {
    const response = await fetch("https://api.paymongo.com/v2/checkout_sessions", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(PAYMONGO_SECRET_KEY + ":")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    const checkoutUrl = result?.data?.attributes?.checkout_url;
    const sessionId = result?.data?.id;
    if (!response.ok || typeof checkoutUrl !== "string" || typeof sessionId !== "string") {
      console.error("[nexora-payments] PayMongo session creation failed", response.status, result?.errors?.[0]?.code || "unknown");
      await db.from("nexora_payment_orders").update({ status: "failed", updated_at: new Date().toISOString() }).eq("reference_number", reference);
      return json(502, { error: "PayMongo could not start checkout. No payment was taken." });
    }
    const { error: updateError } = await db.from("nexora_payment_orders")
      .update({ paymongo_session_id: sessionId, checkout_url: checkoutUrl, updated_at: new Date().toISOString() })
      .eq("reference_number", reference).eq("user_id", userId);
    if (updateError) {
      console.error("[nexora-payments] session persistence failed", updateError.message);
      return json(500, { error: "Checkout was created but could not be linked to your order. Contact support before paying." });
    }
    return json(200, { ok: true, reference, checkoutUrl, amount: product.amount, title: product.title });
  } catch (error) {
    console.error("[nexora-payments] checkout request failed", error);
    await db.from("nexora_payment_orders").update({ status: "failed", updated_at: new Date().toISOString() }).eq("reference_number", reference);
    return json(502, { error: "Could not connect to PayMongo. Please try again." });
  }
}

async function checkStatus(userId: string, body: Record<string, unknown>) {
  const reference = String(body.reference || "").trim();
  if (!reference || reference.length > 80) return json(400, { error: "A valid payment reference is required." });
  const db = dbClient();
  const { data: order, error } = await db.from("nexora_payment_orders")
    .select("reference_number,sku,title,amount_php,status,payment_method,paid_at")
    .eq("reference_number", reference).eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("[nexora-payments] status lookup failed", error.message);
    return json(500, { error: "Could not check payment status." });
  }
  if (!order) return json(404, { error: "Payment order not found." });
  if (order.status !== "paid") return json(200, { ok: true, status: order.status, paid: false });
  const { data: wallet, error: walletError } = await db.from("user_wallets")
    .select("purchased_coins,bonus_coins,is_vip,vip_expires_at,vip_plan_label")
    .eq("user_id", userId).maybeSingle();
  if (walletError) {
    console.error("[nexora-payments] wallet refresh failed", walletError.message);
    return json(500, { error: "Payment is confirmed, but wallet refresh failed. Reopen the app to sync." });
  }
  return json(200, { ok: true, status: "paid", paid: true, wallet });
}

async function handleWebhook(req: Request) {
  if (!PAYMONGO_WEBHOOK_SECRET) return json(503, { error: "Webhook secret is not configured." });
  const rawBody = await req.text();
  const signature = req.headers.get("Paymongo-Signature") || req.headers.get("paymongo-signature") || "";
  let envelope: Record<string, unknown>;
  try { envelope = JSON.parse(rawBody); } catch { return json(400, { error: "Invalid JSON." }); }
  const event = (envelope.data || {}) as Record<string, unknown>;
  const livemode = Boolean(event.livemode);
  let valid = false;
  try { valid = await verifyPayMongoSignature(rawBody, signature, livemode); } catch { return json(401, { error: "Webhook signature could not be verified." }); }
  if (!valid) return json(401, { error: "Invalid webhook signature." });
  if (event.type !== "checkout_session.payment.paid") return json(200, { received: true, ignored: true });

  const session = (event.data || {}) as Record<string, unknown>;
  const attributes = (session.attributes || {}) as Record<string, unknown>;
  const reference = String(attributes.reference_number || "");
  const sessionId = String(session.id || "");
  const payments = Array.isArray(attributes.payments) ? attributes.payments as Record<string, unknown>[] : [];
  const paidPayment = payments.find((payment) => {
    const attrs = (payment.attributes || {}) as Record<string, unknown>;
    return attrs.status === "paid";
  });
  if (!reference || !sessionId || !paidPayment) return json(400, { error: "Paid checkout details are incomplete." });
  const paymentAttributes = (paidPayment.attributes || {}) as Record<string, unknown>;
  const source = (paymentAttributes.source || {}) as Record<string, unknown>;
  const paymentMethodDetails = (paymentAttributes.payment_method_details || {}) as Record<string, unknown>;
  const actualMethod = String(source.type || paymentMethodDetails.type || "");
  const eventId = String(event.id || envelope.id || `${sessionId}:${String(paidPayment.id || "")}`);
  const db = dbClient();
  const { data, error } = await db.rpc("fulfill_nexora_payment", {
    p_reference_number: reference,
    p_session_id: sessionId,
    p_event_id: eventId,
    p_payment_id: String(paidPayment.id || ""),
    p_amount: Number(paymentAttributes.amount),
    p_livemode: livemode,
    p_payment_method: actualMethod || null,
  });
  if (error) {
    console.error("[nexora-payments] fulfillment RPC failed", error.message);
    return json(500, { error: "Payment fulfillment failed; webhook retry is safe." });
  }
  if (!data?.ok) {
    console.error("[nexora-payments] payment requires review", data?.reason || "unknown");
    return json(200, { received: true, review: true });
  }
  return json(200, { received: true, fulfilled: !data.duplicate && !data.test_mode, status: data.status });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method === "GET") {
    const result = new URL(req.url).searchParams.get("result");
    return htmlPage(
      result === "cancel" ? "Payment not completed" : "Thank you",
      result === "cancel" ? "Your checkout was cancelled or not completed." : "Your checkout page has returned. We are checking the payment with PayMongo.",
    );
  }

  if (req.method !== "POST") return json(405, { error: "POST required." });

  // PayMongo webhooks are signed and do not carry a Firebase user token.
  if (req.headers.has("Paymongo-Signature") || req.headers.has("paymongo-signature")) {
    try { return await handleWebhook(req); }
    catch (error) {
      console.error("[nexora-payments] webhook handler failed", error);
      return json(500, { error: "Webhook processing failed; PayMongo may retry safely." });
    }
  }

  try {
    const userId = await authenticate(req);
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "create") return await createCheckout(userId, body);
    if (action === "status") return await checkStatus(userId, body);
    return json(400, { error: "Unsupported payment action." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "AUTH_REQUIRED") return json(401, { error: "Please sign in to a permanent NEXORA account." });
    if (message === "PERMANENT_ACCOUNT_REQUIRED") return json(403, { error: "A permanent NEXORA account is required for purchases." });
    if (message === "PAYMENT_BACKEND_NOT_CONFIGURED") return json(503, { error: "Payment backend is not configured yet." });
    console.error("[nexora-payments] request failed", error);
    return json(500, { error: "Payment request could not be completed." });
  }
});
