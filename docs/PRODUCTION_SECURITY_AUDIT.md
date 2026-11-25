# NEXORA AI DRAMA — Production Security Audit

Audit date: 2026-11-25
Repository: NEXORA-AI-DRAMA
Application ID: com.devcedrick.nexoraaidrama
Release inspected: v2.5.6

## Executive result

**NOT production-safe for monetized public launch yet.** The Android build and APK/AAB signing pipeline pass, but source review found client-trust issues that cannot be solved by packaging alone.

## Critical findings

### 1. Supabase wallet tables had public write policies — FIXED IN REPOSITORY

The previous `supabase/schema.sql` granted `anon` and `authenticated` unrestricted row access (`USING (true)` / `WITH CHECK (true)`) to wallet and episode-entitlement tables. A public client could modify another user's balance or unlock records by supplying a different `user_id`.

The schema now drops those policies, enables and forces RLS, revokes direct client table privileges, and intentionally creates no client policies. **This change is not active in a live Supabase project until the SQL is executed there.**

Important identity mismatch: app wallet rows use Firebase UIDs while the Supabase client authenticates with a public key, not a Firebase-backed Supabase JWT. A simple `auth.uid() = user_id` policy would not secure this integration.

### 2. Firebase Realtime Database rules are not in this repository — ACTION REQUIRED

The app writes client-supplied wallet and entitlement values under `users/{uid}`. Source code alone cannot establish the deployed RTDB rules. A rules template is included at `firebase/database.rules.production.template.json`.

The template permits users to read their own data and edit profile only; wallet, VIP and unlocked-episode writes are server-only. Public catalog reads are limited to `series`. Review compatibility with the actual Firebase database structure before deploying.

### 3. Client-side wallet and reward state is not authoritative — OPEN BLOCKER

The app stores balances and unlocks in localStorage and updates them from client code. Rewarded-ad callbacks can grant local rewards; coin unlocks debit local state. A modified client can tamper with local values. AdMob reward callbacks in the app are useful UX signals but are not a trusted ledger.

Before monetized launch:
- Implement a trusted backend that verifies Firebase ID tokens.
- Verify AdMob server-side verification (SSV) callbacks for rewarded ads.
- Record idempotent reward transactions server-side.
- Calculate coin debits and episode entitlements on the server.
- Never accept client-supplied balance, VIP status, price, or reward amount as authoritative.
- Reconcile wallet state from the server after sign-in.

### 4. Purchases are not implemented — safe failure currently

The purchase confirmation handler explicitly reports that secure checkout is not connected and does not grant coins/VIP. Do not advertise paid purchases as operational. For digital content/coins sold in the Play-distributed app, implement Google Play Billing unless the app qualifies for and is enrolled in an approved alternative billing program.

### 5. Account deletion and privacy disclosures — OPEN BLOCKER

The repository does not show a complete account deletion flow or a public account-deletion request page. Implement account deletion for Firebase Auth and associated user data, revoke sessions, and publish a verified privacy policy before Play submission.

## Production Firebase RTDB rules template

See `firebase/database.rules.production.template.json`. This is a template, not a deployed ruleset. Verify that all other app reads/writes match the rules before publishing.

## Verification limits

This audit reviewed repository source and workflow configuration only. It did not access or change the live Firebase or Supabase project, inspect deployed database rules, verify production AdMob SSV, perform penetration testing, or test on a physical Android device.

## Release decision

- Build pipeline: PASS (Build #83).
- Signed APK/AAB packaging: PASS.
- Monetized production security: BLOCKED pending server-authoritative wallet/rewards and deployed database rules.
- Play Store readiness: BLOCKED pending account deletion, final privacy policy, policy declarations, and real-device testing.
