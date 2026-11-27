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
- Explicit deny-all policies were added to social likes, saves, and comments; the Firebase-token-verifying `nexora-social` Edge Function continues to access them with server credentials. The live security advisor now reports only one informational no-policy notice on `nexora_payment_orders`, which is outside this audit scope. Do not add client access to that table as part of this work.
- Performance advisor reported one unused social-saves index. No index was removed without workload evidence.

### Published catalog and social access

- Live catalog inspection confirmed 2 published dramas and 28 published episodes; all 28 video URLs and all populated thumbnail URLs use HTTPS.
- The viewer previously interpolated the genre field directly into an inline JavaScript handler and trusted catalog IDs/media URLs. The client now accepts only UUID drama IDs, bounded integer episode numbers, HTTPS media URLs without embedded credentials, and escaped/encoded genre text. CI now includes a regression validator for these boundaries.
- The privileged `nexora-social` Edge Function previously accepted arbitrary series IDs without checking that the target was published. It now validates UUID format and confirms the drama exists with `status='published'` before any social read/write. The function is deployed at version 5 and its source is now tracked in this repository.
- Live RLS inspection confirms public SELECT access is limited to published catalog rows and client access to social, push, wallet and unlock tables is denied. Privileged server functions therefore remain responsible for all social and push writes.

### Push notifications

- The project has active `nexora-push-register`, `nexora-push-broadcast`, `nexora-social`, and `studio-content-sync` Edge Functions.
- The broadcast function requires a server-side release secret and Firebase service-account JSON. Secret presence and real FCM delivery were not verified in this audit.
- New registrations require a Firebase ID token whose signature, issuer, audience and expiry are verified; the Firebase UID is stored with the device and registration is capped at five devices per account. Registration now rejects a token already associated with a different account unless the same installation is switching accounts. The live function is deployed at version 9 and CI checks the ownership guard.
- Live database inspection currently shows 1 registered device row without a Firebase UID. It is a legacy registration and is not linked to an authenticated account yet; a fresh app registration is needed to associate it.
- Firebase App Check / Play Integrity attestation and request rate limiting are still not configured. Real foreground/background delivery and tap routing still need physical-device testing.
- Physical foreground/background notification delivery and tap routing still need device testing.

### Additional runtime and supply-chain findings

- The app currently loads Tailwind from its browser CDN and Lucide from an unpinned `@latest` URL at runtime; Google Fonts and HLS.js are also remote. There is no Content Security Policy or Subresource Integrity in the HTML. A cold launch or playback can therefore depend on network/CDN availability, and unpinned third-party code is a supply-chain exposure. Bundle/pin runtime assets locally and add a tested restrictive CSP before treating offline startup as reliable.
- The repository has no `package-lock.json`, while CI runs `npm install` against caret-ranged dependencies. This makes dependency resolution less reproducible between builds. Generate and commit a lockfile, then use `npm ci`.
- The Android workflow previously used `cancel-in-progress: true`, so successive pushes cancelled an active emulator/release verification. This is now disabled to let a running verification finish; GitHub still keeps only one pending run per concurrency group, so avoid rapid batches of commits.
- A complete account deletion path is still absent: the viewer contains sign-out but no Firebase account deletion call or public deletion-request page.
- Coin balances, rewarded-ad rewards and episode unlock state remain local-device state, not server-authoritative. This is not a subscription finding; it is an integrity and cross-device persistence limitation. Do not represent local rewards as secure or transferable.
- The Supabase performance advisor currently reports two informational unused indexes: `nexora_social_saves_user_idx` and `nexora_push_devices_user_id_idx`. Do not drop either without workload evidence; the device index may become useful as registration grows.

### Android updater and release workflow

- The in-place upgrade shell test was moved to a standalone Bash script because the emulator runner evaluates shell script lines separately.
- The shell sentinel-write and V3 signing-certificate fingerprint parsing defects are corrected. Workflow run 45930027241 completed successfully. The subsequent catalog/push security hardening has a new CI verification queued; do not treat those newest changes as release-verified until that run succeeds.
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
