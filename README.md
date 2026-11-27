# NEXORA AI DRAMA

NEXORA AI DRAMA is the public-facing vertical micro-drama Android application. Its main application source is the web app in `www/`, packaged for Android with Capacitor 8.

## Main application structure

- `www/index.html` — NEXORA AI DRAMA viewer application.
- `package.json` — Capacitor 8, Android platform, AdMob and splash-screen dependencies.
- `capacitor.config.json` — Android application identity and splash-screen configuration.
- `supabase/schema.sql` — default-deny schema baseline for wallet and unlocked-episode data.
- `.github/workflows/android-apk.yml` — GitHub Actions Android APK build.

The Android project is generated from this Capacitor project during the GitHub Actions build. The old standalone Kotlin/Jetpack Compose project is no longer the source of the app.

## Build an APK on GitHub

1. Open the repository's **Actions** tab.
2. Select **Build NEXORA AI DRAMA APK**.
3. Choose **Run workflow** or push a change to `main`.
4. Open the completed workflow run and download the `NEXORA-AI-DRAMA-debug-APK` artifact.

The workflow creates a debug APK for testing. It creates a signed release APK only when all four permanent signing secrets are configured in GitHub Actions: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Keep the same keystore for every release; changing it breaks Android in-place updates.

## App identity

- App name: NEXORA AI DRAMA
- Application ID: `com.devcedrick.nexoraaidrama`
- Web app directory: `www`
- Android packaging: Capacitor 8

## User registration and sign-in status

- The app includes Create Account, Sign In and password-reset screens using Firebase Authentication.
- Firebase web configuration for the NEXORA AI DRAMA Firebase project is present in the app source. Firebase web API keys are client configuration, not service-account secrets; production security depends on correctly configured Firebase Authentication providers and Realtime Database rules.
- Verify Email/Password sign-in is enabled in Firebase Authentication and test account creation, sign-in, password reset, session persistence, and user-scoped Realtime Database access on a real Android device before release.
- The app does not use localStorage as a password vault. It does persist app state and local account snapshots in localStorage; review this storage behavior and provide account/data deletion before production release.

## Configuration and production safety

Configure Firebase, Supabase and AdMob values in the app's configuration section before production use. Never put Firebase service-account credentials, Supabase service-role keys, private signing keys or other secrets in this public repository.

The included `supabase/schema.sql` is a default-deny baseline for legacy wallet and unlocked-episode tables. It enables and forces RLS, revokes direct client access, and intentionally creates no anonymous or authenticated write policies. Wallet and entitlement changes must go through a trusted server that verifies Firebase identity and reward/payment events. The live AI DRAMA project currently keeps these tables inaccessible to direct clients; do not weaken those policies to make client-side wallet sync appear to work.

## Live NEXORA STUDIO drama catalog

The viewer app reads its published catalog from the dedicated NEXORA AI DRAMA Supabase destination project (`vureiymqoosubwubhvdu`), not directly from the NEXORA STUDIO database:

- `public.ai_dramas` — only dramas with `status = 'published'` are visible.
- `public.ai_drama_episodes` — only episodes with `status = 'published'` and a valid `video_url` are playable.
- Cover and episode thumbnail URLs are used as posters; episode video URLs are played as MP4 or HLS streams.
- The app refreshes the destination catalog at launch, when the app returns to the foreground, and every 60 seconds while open.
- Draft, pending, rejected, archived, and unpublished episodes are never included in the public viewer catalog.
- The app uses the destination project's publishable key and read-only anonymous SELECT/RLS policies. It does not write to the NEXORA STUDIO database.

NEXORA STUDIO remains the private source/editor project. The `studio-content-sync` Edge Function is intended to copy only AI DRAMA catalog records and their media objects into the destination project after an authorized Studio-owner sync event. The full Studio database is not migrated. A catalog row pointing to a Studio Storage URL is not proof that its media has been copied; the migration is complete only when the corresponding object exists in the destination bucket and the destination URL plays successfully.

## App update checks

- The app checks `update.json` at startup and every six hours while it is open.
- To publish an update, upload a release APK signed with the **same permanent signing key** as the installed app, then update `version`, `notes`, and `downloadUrl` in `update.json`.
- Android's installer must confirm the installation. Existing app data is retained only when the application ID and signing certificate match.
- The GitHub Actions workflow produces a debug APK until the four permanent signing secrets are configured. Once configured, it also produces a signed release APK. The signing keystore must be backed up securely and reused for every update. A new signing key cannot update an app signed by a different key; one migration reinstall may be required if the currently installed app was signed with a temporary debug key.
- Do not set `downloadUrl` until a real signed APK is published. An empty URL intentionally prevents a fake update action.

## Android notifications

The app includes native FCM registration and active `nexora-push-register` and `nexora-push-broadcast` Edge Functions. New device registrations now require a cryptographically verified Firebase ID token and are capped at five devices per Firebase account; the app-ID header is only an additional check. Firebase App Check attestation is still not configured, and the two existing device records have not yet been linked to a Firebase UID until an updated app re-registers them. The broadcast function depends on Firebase service-account and release-webhook secrets stored outside this repository. Verify those secrets and perform real foreground/background delivery tests before claiming push delivery is production-ready. In-app catalog alerts are not proof of background system-tray delivery.
