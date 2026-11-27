# NEXORA AI DRAMA — App Check, Anonymous Auth & Account Ownership Audit

Audit date: 2026-11-28  
Repository: `DEVcedrick-project/NEXORA-AI-DRAMA`  
Audited source: `fix/social-network-aware-rate-limit` at `3846a8f6186ef22e1faac2d91b37abbdec168954`  
Scope: NEXORA AI DRAMA only. Subscription/billing code and NEXORA STUDIO are excluded.

## Executive result

**Do not enable production App Check enforcement yet.** The current client has no App Check initialization or attestation provider, and no evidence in this repository that an Android Play Integrity App Check token is obtained and attached to Firebase requests. Enforcing before shipping a compatible client would risk breaking legitimate existing installations.

Three confirmed areas need follow-up:

1. App Check is absent from the current Firebase client initialization.
2. Anonymous Firebase accounts are automatically created during startup and after sign-out, with no application-level abuse controls visible in this repository.
3. UID-scoped backend access is mostly sound, but account-owned wallet/VIP/unlock values are also restored from mutable local storage and briefly hydrated before Firebase identity is confirmed. These local values must not be treated as authoritative entitlements.

This is a source audit, not a live Firebase Console or penetration test.

## 1. App Check enforcement compatibility

### Evidence

- `www/index.html` imports Firebase App, Auth and Realtime Database functions from `/vendor/firebase.js`; it does not import `firebase/app-check`.
- Firebase initialization calls `initializeApp`, `getAuth`, `setPersistence` and Auth operations, but does not call `initializeAppCheck`.
- `scripts/firebase-runtime-entry.js` exports Auth and Realtime Database APIs only; no App Check APIs are bundled from this entry.
- No App Check provider, Play Integrity token bridge, debug-token handling, or App Check compatibility test is present in the inspected tree.
- The Android app is a Capacitor WebView application. A web-only reCAPTCHA provider is not a substitute for native Android Play Integrity attestation.

### Risk

Turning on enforcement for a Firebase product before a compatible client obtains valid App Check tokens can reject legitimate traffic from already-installed APKs and cause apparent sign-in, database, or other Firebase service failures. App Check enforcement is product-specific; do not assume enabling one product protects every Firebase endpoint or a Supabase Edge Function.

### Required safe rollout

1. Identify the exact Firebase products used by this app and confirm current App Check support/enforcement availability for each.
2. Implement a maintained Capacitor/native Android Play Integrity bridge and a JS token provider that supplies its attestation token to the Firebase App Check SDK before protected Firebase services are used. Keep debug providers restricted to development builds and never ship debug tokens.
3. Verify token refresh, cold start, offline/reconnect, app update, emulator/debug, and supported physical-device behavior.
4. Roll out in monitoring mode first; inspect valid/invalid/missing-token metrics and existing app-version coverage.
5. Enforce one Firebase product at a time only after compatibility evidence is satisfactory, with a documented rollback path.
6. If Supabase Edge Functions also need attestation, explicitly transmit and verify the Firebase App Check token server-side; Firebase App Check does not automatically protect custom HTTP endpoints.

No enforcement setting or Firebase Console configuration was changed by this audit.

## 2. Anonymous account creation abuse

### Evidence

- `initFirebaseRealtimeSync` restores Auth persistence, waits for `auth.authStateReady()`, then calls `signInAnonymously(auth)` whenever there is no restored user and no custom token.
- `handleSignOutAccount` signs out and immediately attempts another `signInAnonymously`.
- Native push initialization also contains a fallback anonymous sign-in if no Firebase user exists.
- The app intentionally tolerates anonymous sign-in being disabled, but the inspected client contains no CAPTCHA, attestation gate, per-install creation budget, or server-enforced account-creation throttle.
- Existing social restrictions deny anonymous likes/saves/comments while allowing anonymous reads; this does not prevent creation of many anonymous Firebase identities.

### Risk

A caller can repeatedly clear app data, reinstall, or use multiple devices/emulators to obtain new anonymous UIDs. Client-side counters or install IDs are bypassable and must not be the security boundary. App Check reduces abuse from unauthenticated scripts but does not stop valid app/device farms by itself.

### Required controls

- Configure and monitor Firebase Authentication/Identity Platform quotas and abuse protections for anonymous sign-in; verify current project-level limits in the Firebase Console.
- Add server-side rate limits for anonymous account creation based on trusted attestation and network signals, with privacy-conscious retention and fail-closed behavior where appropriate.
- Keep anonymous users read-only for sensitive social mutations and privileged operations.
- Set an explicit guest lifecycle/retention policy and clean up stale anonymous accounts using a trusted scheduled backend process only after confirming account ownership/data migration requirements.
- Prefer linking a guest identity to a permanent credential when the user chooses to register if preserving guest-owned content is the intended product behavior. Do not silently create a fresh identity during a credential-link flow.
- Test provider-disabled, quota-exceeded, offline, repeated sign-out, app-data-clear, and multi-device cases.

No Firebase Auth provider settings, quotas, user records, or cleanup jobs were changed.

## 3. Account switching and data ownership

### Protections confirmed

- Firebase Realtime Database rules deny root access and scope `users/$uid` reads and profile writes to `auth.uid === $uid`.
- Client writes to wallet, VIP status and unlocked-episode records are denied by the rules template.
- Social state is reset when switching identities, and social operations are routed through the Firebase-ID-token-verifying Edge Function.
- Sign-out clears Firebase listeners before changing identity; account-specific realtime listeners are attached under the authenticated UID.
- The app's local account vault uses `uid:<Firebase UID>` as its preferred key rather than email.
- Supabase wallet/unlock tables use RLS with direct client access revoked; this is the correct default until a trusted Firebase-token-verifying service owns those records.

### Findings

**A. Local entitlement snapshots are not trustworthy.**

`restoreLocalAccountWallet(uid, email)` restores purchased coins, bonus coins, VIP state, VIP expiry, starter-pack state, unlocked episodes and wallet history from `localStorage`. The vault is mutable client storage. UID-keying prevents accidental cross-account mixing but does not prove that a stored entitlement was granted by the server. These values can be edited or replayed by a device owner and must not unlock paid/privileged content or be described as secure, transferable balances.

**B. Legacy email-keyed fallback weakens the ownership boundary.**

The restore helper falls back to an email-keyed snapshot when a UID-keyed entry is missing. Email is mutable profile data, not the stable authorization principal. Do not use this fallback for wallet, VIP, purchase or unlock entitlements. It may be retained only for explicitly non-sensitive preferences after a deliberate migration.

**C. Startup hydrates sensitive local state before Firebase identity is confirmed.**

`bootstrapNexoraApp` calls `hydrateAppState()` and renders the local UI before the asynchronous Firebase startup task completes. The persisted snapshot includes UID, coins, VIP and unlock data. Firebase later restores the persisted session, but the app does not establish a verified-UID gate before that initial rendering. This can briefly show stale identity/entitlement data on shared devices or after interrupted account changes.

**D. Account creation intentionally signs out the current user before creating the new email account.**

The registration path saves local state, signs out the current Firebase user, resets wallet state and creates a new account. This avoids silently linking or inheriting the old guest/member identity, but it also means guest data is not migrated into the new account. If guest-data preservation is desired, use Firebase credential linking with explicit user intent and conflict handling; do not merge wallet or entitlements based on local snapshots.

### Required fixes

1. Make server-verified UID the only authority for account-scoped state.
2. Before Firebase Auth restoration completes, render a neutral/loading account state and suppress all wallet/VIP/unlock displays and access decisions.
3. After Auth is ready, reset account-owned state, bind the verified UID, then fetch authoritative records from a trusted backend.
4. Remove local snapshot restoration for purchased coins, VIP, starter packs and unlocked episodes. Local storage may cache non-authoritative display data only, clearly marked stale and never used to authorize access.
5. Remove the email-keyed entitlement fallback. Migrate only non-sensitive preferences if required.
6. Ensure every async callback checks that its captured UID still equals `runtime.fbAuth.currentUser.uid` before applying results; discard late responses from the previous account.
7. Add regression tests for A→B switch, B→A switch, sign-out, failed login, failed account creation, slow network responses, stale listener callbacks, localStorage tampering, and shared-device startup.
8. Preserve UID ownership for profile, social, push registration, and any future trusted wallet service. Never accept a client-supplied UID as proof of ownership.

## 4. Regression matrix before enforcement or release

| Scenario | Required result |
|---|---|
| Existing APK with no App Check token | Continues working while monitoring mode is used |
| Valid Play Integrity attestation | Firebase App Check token is issued and refreshed |
| Missing/invalid attestation | Protected endpoint rejects according to the configured rollout policy; app presents recoverable messaging |
| Anonymous provider disabled or quota exceeded | App remains usable for supported signed-in flows; no crash or infinite retry |
| Repeated guest sign-in attempts | Server-side abuse limits apply; client counters are not trusted |
| Account A switches to B | No A wallet, VIP, unlock, social or profile data appears under B |
| Slow A response arrives after B login | Response is discarded |
| LocalStorage entitlement values are modified | No privileged content or server entitlement is granted |
| Sign-out on shared device | Sensitive account data is cleared before guest/new-account UI appears |
| Guest registers | Explicitly defined link-or-separate-account behavior; no silent entitlement transfer |

## Scope and deployment status

- Repository source audit only.
- No Firebase App Check enforcement toggles changed.
- No Firebase Auth provider/quota settings changed.
- No production Firebase/Supabase data or secrets changed.
- No migrations, Edge Functions, APKs, subscriptions, or NEXORA STUDIO files changed.
- Existing draft PR #20 remains untouched.

## Conclusion

App Check is **not ready for enforcement** until the Capacitor/Play Integrity integration is implemented and verified. Anonymous sign-in currently has no visible server-side creation-abuse control in this repository. UID-scoped database rules and listener resets are good foundations, but local entitlement restoration and pre-auth hydration must be corrected before claiming strict account isolation.
