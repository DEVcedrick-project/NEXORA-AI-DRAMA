# NEXORA AI DRAMA — Trusted Wallet Backend Plan

Status: design approved for implementation; not deployed.
Date: 2026-11-25

## Project boundary

The only connected Supabase project currently visible is **NEXORA-STUDIO** (`gbpjixlubrmgzqflbkwz`). The viewer app uses it for the published drama catalog. Its configured catalog URL is present, but the separate wallet Supabase URL and key in the viewer app are empty by default.

Do not put viewer wallet tables, wallet functions, or viewer-specific policies into NEXORA-STUDIO. Keep the studio catalog and existing Studio integrations isolated. The user's current payment instruction is no Xendit and no automatic Maya/GCash verification; this design does not enable checkout or payment fulfillment.

## Required dedicated backend

Provision a separate Supabase project for NEXORA AI DRAMA wallet services (or use another explicitly approved trusted backend). No project was created because the organization and any recurring cost have not been approved.

## Authentication

- Android client obtains a Firebase Authentication ID token from the currently signed-in Firebase user.
- Edge Function validates the token signature using Google's Firebase Secure Token public keys.
- Validate `aud` equals `nexora-ai-drama`, `iss` equals `https://securetoken.google.com/nexora-ai-drama`, expiry, subject and issuer.
- Never accept a client-supplied Firebase UID as proof of identity.
- Use the verified token subject as the only user key.
- Keep Supabase secret/service-role credentials only in Edge Function secrets; never in the APK or repository.

## Wallet operations

- Server-owned wallet and append-only transaction ledger.
- Atomic, idempotent server operations for spend and fulfillment.
- Client may request wallet balance and submit an episode unlock intent; server computes price, checks balance, debits and records the entitlement in one transaction.
- Never accept client-provided balance, VIP flag, price, reward amount, transaction status, or entitlement as authoritative.
- Return server-computed balance and entitlement after each operation.
- Apply per-user rate limits and transaction idempotency keys.

## Rewarded ads

- A client-side AdMob reward callback is not a trusted server receipt.
- Configure AdMob Server-Side Verification (SSV) with a callback to a dedicated HTTPS endpoint.
- Verify Google signature and key ID using the current official AdMob verification procedure, validate app/ad unit/user identity and reward parameters, enforce timestamp/replay protection, and process each transaction ID exactly once.
- Only then credit the reward ledger. Until SSV is configured and verified, do not claim rewarded coins are tamper-proof.

## Payments

- No Xendit or automatic personal Maya/GCash QR verification is enabled by this plan.
- Do not credit paid coins or VIP based on screenshots, client button presses, or manual unverified references.
- For Play-distributed digital goods, integrate Google Play Billing or a policy-approved alternative before enabling purchases.

## Launch sequence

1. Create and approve a dedicated NEXORA AI DRAMA backend project and budget.
2. Apply wallet/ledger schema and deny all direct client writes.
3. Deploy Firebase-ID-token-authenticated wallet Edge Function.
4. Integrate wallet read/spend calls into the Android client.
5. Configure and test AdMob SSV before enabling ad-funded credits.
6. Add server-side account deletion and data cleanup.
7. Run database advisors, negative authorization tests, replay tests and device tests.
8. Rebuild signed APK/AAB only after all server and client tests pass.

## Current verified findings

- NEXORA-STUDIO is the only Supabase project visible to the connected account and is healthy.
- Its security advisor reports one warning: leaked-password protection is disabled. This was not changed because the project is NEXORA-STUDIO and changing Auth settings could affect the separate Studio product.
- NEXORA AI DRAMA's configured Studio catalog uses the Studio project; its separate wallet Supabase URL/key are blank by default.
- Existing local wallet state is not server-authoritative.
- No backend deployment or live database modification was made as part of this plan.
