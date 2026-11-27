# NEXORA AI DRAMA — Google Play Readiness Checklist

Status: Technical preparation in progress. This is not a declaration that the app is ready for production review.

## Item 2 — Store assets and information

- [x] App title and package ID recorded: NEXORA AI DRAMA / com.devcedrick.nexoraaidrama.
- [x] Draft short and full store descriptions created in PLAY_STORE_LISTING.md.
- [x] Android build workflow now generates a 512 × 512 PNG app icon at resources/play-store/icon-512.png and uploads it as a workflow artifact.
- [ ] Capture genuine phone screenshots from the final release build.
- [ ] Create the 1024 × 500 feature graphic.
- [ ] Provide a monitored support email and legal publisher name.
- [ ] Publish an approved privacy policy at a public HTTPS URL.
- [ ] Complete the Play Console content rating and app access instructions.

## Item 3 — Production and policy checks

### Blockers to clear before submission

1. **Account deletion:** The app supports account creation/sign-in, but the current source does not show a complete in-app account deletion flow or a public web deletion-request page. Implement and test both.
2. **Firebase security:** Verify production Realtime Database rules are authenticated and scoped to each user's UID. Never use permissive development rules for production.
3. **Supabase security:** The dedicated NEXORA AI DRAMA project has RLS enabled on wallet and unlock tables and denies direct client access. Keep that deny-by-default posture. The viewer client now disables direct wallet reads/upserts; implement a Firebase-token-verifying server API and ledger before enabling wallet or unlock synchronization.
4. **Wallet/rewards integrity:** Verify coin balances, VIP entitlements, episode unlocks, and rewarded-ad credits cannot be altered by editing local app state or making direct client requests.
5. **Digital goods payments:** If coins, VIP, or paid episode access are sold inside the Play-distributed app, review Google Play Billing requirements. Do not ship personal Maya/GCash QR payment links for digital in-app content unless the app is enrolled in an applicable Google-approved alternative billing program and meets its rules.
6. **Ad disclosures and consent:** Complete the Play Console ads declaration and Data safety form. Review AdMob consent requirements for the countries where the app will be distributed.
7. **Content rights and moderation:** Confirm written rights to every drama, video, poster, thumbnail, music track, and other asset. Confirm the content rating matches the actual catalog.
8. **Privacy policy accuracy:** Reconcile PLAY_STORE_PRIVACY_POLICY_DRAFT.md with actual Firebase, Supabase, AdMob, analytics, payment, and CDN settings. Add a real contact and retention/deletion process before publishing.

### Current source observations

- Firebase Authentication is integrated in the app source.
- Firebase Realtime Database is used for account-related data and live catalog listeners.
- The public drama catalog is read from a configured Supabase project.
- Wallet/unlock Supabase synchronization has a separate configuration and must be security-reviewed.
- Rewarded advertising is integrated through the Capacitor AdMob bridge.
- The app stores some preferences and viewing state in localStorage.
- Direct client wallet sync is disabled until a trusted wallet API is deployed; current coin and unlock state is device-local and is not authoritative.
- The source currently does not show a complete account deletion feature.
- Do not claim automatic payment verification for personal e-wallet QR payments.

## Item 5 — Android API target

- [x] GitHub Actions now explicitly sets both compileSdkVersion and targetSdkVersion to API 36 in the generated Capacitor Android project.
- [ ] Confirm the build log reports compileSdkVersion=36 and targetSdkVersion=36.
- [ ] Confirm the final AAB passes Google Play Console pre-launch and policy checks.

## Release acceptance

A successful AAB build is only a packaging milestone. It does not prove Firebase/Supabase security, payment compliance, account deletion, content rights, ad consent, or real-device behavior. Test all of those before requesting production access.
