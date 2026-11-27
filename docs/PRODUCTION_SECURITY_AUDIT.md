# NEXORA AI DRAMA — Production Security & Reliability Audit

Audit date: 2026-11-27
Repository: NEXORA-AI-DRAMA
Application ID: com.devcedrick.nexoraaidrama
Scope: Android packaging/updater, Firebase, Supabase catalog/social/push, playback, ads, privacy, account lifecycle and release automation. Subscription and payment flows are intentionally excluded.

## Current assessment

**Not yet certified production-ready.** Several source-level protections are present and the dedicated NEXORA AI DRAMA Supabase project is healthy, but production Firebase rules deployment, backend secret configuration, end-to-end device tests and Play Console compliance remain unverified.

## Confirmed findings and changes

### Firebase Realtime Database

- The app's authenticated initialization reads `series` and writes `users/{uid}/connectionCheck/lastVerifiedAt`.
- The previous rules template denied that connection-check write. That caused initialization to mark Realtime Database disconnected and skip the account listeners when the template was deployed.
- The template now allows only the authenticated matching UID to write a connection-check object containing exactly one numeric `lastVerifiedAt` field.
- Root reads/writes remain denied. User reads remain UID-scoped. Wallet, VIP and episode-unlock writes remain denied to clients.
- Node regression tests validate the Firebase rules and ensure the viewer client does not write protected wallet/VIP/unlock records; both are run by CI.
- **Deployment still required:** the JSON template is not automatically deployed to Firebase. Compare it with the live rules and publish it through the authorized Firebase Console/CLI process.

### Dedicated Supabase project

- Dedicated project `vureiymqoosubwubhvdu` (`NEXORA-NEXORA-AI-DRAMA`) was found and reported `ACTIVE_HEALTHY`. NEXORA STUDIO remains a separate project and is not modified by this audit.
- Published catalog tables have RLS and explicit policies limiting public reads to published dramas and episodes whose parent drama is also published.
- Wallet and unlocked-episode tables have RLS enabled and direct client access denied. This is the correct safe default while a trusted wallet service is not integrated.
- The viewer client has now been changed to fail closed: legacy direct wallet/unlock reads and upserts are disabled, profile-only Firebase sync is retained, and client-side account-switch flushes no longer write wallet/VIP/unlock records. Local coin and unlock state remains device-local and is not authoritative. A trusted Firebase-token-verifying wallet API and client migration are still required before cross-device wallet persistence can be considered complete.
- Security advisor returned four informational `rls_enabled_no_policy` notices for social comments, likes, saves, and payment orders. The social tables are intentionally accessed through the Firebase-token-verifying `nexora-social` Edge Function using server credentials; do not add permissive client policies to silence these notices. Payment tables are outside this audit scope.
- Performance advisor reported one unused social-saves index. No index was removed without workload evidence.

### Push notifications

- The project has active `nexora-push-register`, `nexora-push-broadcast`, `nexora-social`, and `studio-content-sync` Edge Functions.
- The broadcast function requires a server-side release secret and Firebase service-account JSON. Secret presence and real FCM delivery were not verified in this audit.
- The registration endpoint currently checks an app-ID header but does not authenticate Firebase App Check or a Firebase user token. Since a public app-ID header can be spoofed, add attestation/rate limiting before treating device registration as abuse-resistant.
- Physical foreground/background notification delivery and tap routing still need device testing.

### Android updater and release workflow

- The in-place upgrade shell test was moved to a standalone Bash script because the emulator runner evaluates shell script lines separately.
- The test validates official manifest URL/checksum, package ID, semantic version increase, APK signatures, matching signing certificate, install-over-install behavior, app UID, and an app-specific external-storage sentinel.
- The sentinel does not directly prove private WebView localStorage retention; add an app-level data continuity test for that.
- Workflow run 45926173884 failed before emulator testing because Maven Central returned HTTP 429 for multiple Gradle dependencies. A Google-hosted Maven Central mirror fallback has now been added to generated Android Gradle repositories. The follow-up CI run must confirm the fix.
- Production release signing still depends on the repository's permanent Android signing secrets. Never publish a debug APK as an official update.
- Keep the splash screen visible briefly (about 1.5–2 seconds) but never delay app readiness unnecessarily.

### Playback and ads

- HLS playback has fatal network retry and media recovery handling, but HLS/MP4 playback, app background/foreground transitions, low-memory recovery, orientation, audio focus and autoplay behavior have not been verified across physical devices.
- AdMob initialization and interstitial event listeners are present. Real production ad delivery, consent behavior and reward callback handling have not been validated here.
- Client-side rewarded-ad callbacks are not proof of a verified reward. Do not grant trusted wallet value until AdMob Server-Side Verification is deployed and tested.

### Privacy and account lifecycle

- A complete in-app account deletion flow and public deletion-request page were not found in the reviewed source.
- The privacy-policy draft, Play Data safety form, content rating, support contact, publisher details, content rights and genuine store screenshots/feature graphic still require completion.
- Do not submit until data collection and deletion disclosures match the deployed Firebase, Supabase, AdMob, notification and media services.

## Remaining release blockers

1. Deploy and verify the corrected Firebase rules against the live RTDB.
2. Replace legacy client wallet synchronization with a trusted server-authoritative API; keep direct client writes denied.
3. Add attestation/rate limiting to public FCM token registration and verify sender secrets and end-to-end delivery.
4. Complete account deletion and the public deletion-request route.
5. Run Android emulator and physical-device regression tests for updater, player, notifications, ads, app lifecycle and data continuity.
6. Complete Play Console policy, privacy, content-rights and store-asset requirements.
7. Confirm the new Gradle mirror resolves dependencies and the signed APK/AAB plus in-place upgrade test pass.

## Verification limits

This audit includes repository source inspection, live Supabase project metadata/table/policy inspection, Supabase advisors, and GitHub Actions logs. It does not constitute a penetration test. Live Firebase rules were not deployed or inspected; Supabase Edge Function secrets were not read; no production push was sent; AdMob SSV was not tested; and no physical Android device was available.

A successful CI build is a packaging milestone, not proof that all production services are secure or operational.
