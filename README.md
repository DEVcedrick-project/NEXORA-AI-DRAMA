# NEXORA AI DRAMA

NEXORA AI DRAMA is the public-facing vertical micro-drama Android application. Its main application source is the web app in `www/`, packaged for Android with Capacitor 8.

## Main application structure

- `www/index.html` — NEXORA AI DRAMA viewer application.
- `package.json` — Capacitor 8, Android platform, AdMob and splash-screen dependencies.
- `capacitor.config.json` — Android application identity and splash-screen configuration.
- `supabase/schema.sql` — legacy development schema for wallet and unlocked-episode data.
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
- The repository does not contain a Firebase Web API key or Android Firebase configuration, so real account registration is not ready until the owner supplies the Firebase project configuration and enables Email/Password sign-in.
- When Firebase is not configured, signup, sign-in and password reset show a clear unavailable message instead of pretending to create an online account.
- The app no longer falls back to storing user passwords in localStorage. Do not distribute the app as having working online registration until Firebase is configured and tested on a device.

## Configuration and production safety

Configure Firebase, Supabase and AdMob values in the app's configuration section before production use. Never put Firebase service-account credentials, Supabase service-role keys, private signing keys or other secrets in this public repository.

The included `supabase/schema.sql` contains permissive development policies for anonymous clients. Do **not** apply those policies to a production project without replacing them with authenticated, user-scoped access policies and server-side validation of wallet/reward transactions.

## Live NEXORA STUDIO drama catalog

The viewer app reads its published catalog directly from the existing NEXORA STUDIO Supabase project:

- `public.ai_dramas` — only dramas with `status = 'published'` are visible.
- `public.ai_drama_episodes` — only episodes with `status = 'published'` and a valid `video_url` are playable.
- Cover and episode thumbnail URLs are used as posters; episode video URLs are played as MP4 or HLS streams.
- The app refreshes the catalog at launch, when the app returns to the foreground, and every 60 seconds while open.
- Draft, pending, rejected, archived, and unpublished episodes are never included in the public viewer catalog.
- The app uses the project's public publishable key and the existing anonymous SELECT/RLS policies. It does not write to the Studio database.

NEXORA STUDIO remains a separate project and was not modified for this integration. When the Studio owner publishes a drama and its episodes, they appear in the viewer app automatically without an APK rebuild or reinstall.

## App update checks

- The app checks `update.json` at startup and every six hours while it is open.
- To publish an update, upload a release APK signed with the **same permanent signing key** as the installed app, then update `version`, `notes`, and `downloadUrl` in `update.json`.
- Android's installer must confirm the installation. Existing app data is retained only when the application ID and signing certificate match.
- The GitHub Actions workflow produces a debug APK until the four permanent signing secrets are configured. Once configured, it also produces a signed release APK. The signing keystore must be backed up securely and reused for every update. A new signing key cannot update an app signed by a different key; one migration reinstall may be required if the currently installed app was signed with a temporary debug key.
- Do not set `downloadUrl` until a real signed APK is published. An empty URL intentionally prevents a fake update action.

## Android notifications

The app currently creates in-app alerts when the published NEXORA STUDIO catalog refresh detects a newly published drama or episode while the app is running. System-tray notifications that arrive while the app is closed require Firebase Cloud Messaging (FCM), Android Firebase configuration, and a trusted server-side sender. Those credentials and native FCM setup are not present in this repository yet; do not treat the current in-app alert as background push delivery.
