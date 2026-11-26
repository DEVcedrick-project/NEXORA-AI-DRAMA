# NEXORA AI DRAMA — PayMongo setup

The app's payment flow uses PayMongo Hosted Checkout. The app never receives or stores the PayMongo secret key. The backend creates a fixed-price checkout session, and only a verified PayMongo webhook can credit the wallet.

## Supabase Edge Function secrets

In the Supabase Dashboard for project `vureiymqoosubwubhvdu`, open **Project Settings → Edge Functions → Secrets** and add:

- `PAYMONGO_SECRET_KEY` — use the PayMongo test secret key first (`sk_test_...`); replace it with the live secret key only after live merchant activation and successful sandbox testing.
- `PAYMONGO_WEBHOOK_SECRET` — the signing secret for the matching test-mode or live-mode webhook endpoint.

Do not put either value in `www/index.html`, GitHub source files, the APK, or client-side configuration. The Supabase-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are read only by the Edge Function.

## PayMongo webhook

In PayMongo Dashboard → Developers / Webhooks, create an endpoint:

```
https://vureiymqoosubwubhvdu.supabase.co/functions/v1/nexora-payments
```

Subscribe to:

- `checkout_session.payment.paid`

Copy the webhook signing secret into `PAYMONGO_WEBHOOK_SECRET` in Supabase. Test and live webhook endpoints have separate secrets; when changing modes, set the secret that matches the active API key and endpoint. The handler verifies the raw-body HMAC signature and timestamp before processing any payment.

## Enable payment methods

Complete PayMongo business verification / KYC and activate GCash and Maya in the PayMongo dashboard. Checkout sessions are restricted to the method selected by the customer (GCash, Maya, or QR Ph).

## Safe release checklist

1. Set test API and webhook secrets.
2. Send a test webhook and confirm the order becomes `test_paid`; test payments must never change a real wallet.
3. Verify an invalid signature is rejected and duplicate webhook deliveries do not duplicate credits.
4. Activate GCash and Maya for the merchant account.
5. Switch both Supabase secrets to the matching live credentials and register/enable the live webhook.
6. Complete a small live transaction before advertising purchases as available.

The live API key and webhook secret are merchant credentials and must be supplied by the account owner. This repository intentionally contains no payment credentials.
