# NEXORA AI DRAMA — Trusted Wallet Backend Plan

Status: design approved for implementation; not deployed.
Date: 2026-11-25

## Project boundary

The dedicated **NEXORA-NEXORA-AI-DRAMA** Supabase project now exists (`vureiymqoosubwubhvdu`, region `ap-northeast-1`, status `ACTIVE_HEALTHY`). **NEXORA-STUDIO** (`gbpjixlubrmgzqflbkwz`) remains separate and is used only for the Studio product/source integrations. The viewer app reads its published catalog from the dedicated AI DRAMA project; the client wallet backend is not yet integrated.

Do not put viewer wallet tables, wallet functions, or viewer-specific policies into NEXORA-STUDIO. Keep the studio catalog and existing Studio integrations isolated. The user's current payment instruction is no Xendit and no automatic Maya/GCash verification; this design does not enable checkout or payment fulfillment.

## Required dedicated backend

Provision a separate Supabase project for NEXORA AI DRAMA wallet services (or use another explicitly approved trusted backend). The dedicated project has since been provisioned. No wallet Edge Function, trusted wallet ledger, or Firebase-token-authenticated wallet API has yet been deployed.

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

## Current verified findings (2026-11-27)

- The dedicated NEXORA-NEXORA-AI-DRAMA Supabase project is `ACTIVE_HEALTHY` and is separate from NEXORA-STUDIO.
- The dedicated project contains `user_wallets` and `unlocked_episodes` with RLS enabled and explicit client-deny policies.
- The viewer client has been changed to stop direct wallet/unlock reads and writes; its wallet and coin unlock state remains local-only until the trusted API is deployed.
- The live security advisor now reports only the no-policy informational notice on `nexora_payment_orders`, which is outside this plan's scope.
- Existing local wallet state is not server-authoritative and must not be imported as trusted balances without a verified migration policy.
- No wallet API or ledger has yet been deployed. The separate project was inspected and its social-table deny policies were hardened, but no Studio project or Studio data was modified.
