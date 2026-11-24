# NEXORA AI DRAMA

NEXORA AI DRAMA is the public-facing vertical micro-drama Android application. Its main application source is the web app in `www/`, packaged for Android with Capacitor 8.

## Main application structure

- `www/index.html` — NEXORA AI DRAMA viewer application.
- `package.json` — Capacitor 8, Android platform, AdMob and splash-screen dependencies.
- `capacitor.config.json` — Android application identity and splash-screen configuration.
- `supabase/schema.sql` — development schema for wallet and unlocked-episode data.
- `.github/workflows/android-apk.yml` — GitHub Actions Android APK build.

The Android project is generated from this Capacitor project during the GitHub Actions build. The old standalone Kotlin/Jetpack Compose project is no longer the source of the app.

## Build an APK on GitHub

1. Open the repository's **Actions** tab.
2. Select **Build NEXORA AI DRAMA APK**.
3. Choose **Run workflow** or push a change to `main`.
4. Open the completed workflow run and download the `NEXORA-AI-DRAMA-debug-APK` artifact.

The workflow currently creates a debug APK. A debug APK is for testing and direct installation; it is not a Play Store release and does not provide a permanent signing identity for reliable in-place updates.

## App identity

- App name: NEXORA AI DRAMA
- Application ID: `com.nexora.aidrama`
- Web app directory: `www`
- Android packaging: Capacitor 8

## Configuration and production safety

Configure Firebase, Supabase and AdMob values in the app's configuration section before production use. Never put Firebase service-account credentials, Supabase service-role keys, private signing keys or other secrets in this public repository.

The included `supabase/schema.sql` contains permissive development policies for anonymous clients. Do **not** apply those policies to a production project without replacing them with authenticated, user-scoped access policies and server-side validation of wallet/reward transactions.

NEXORA STUDIO remains a separate project; this repository is the public NEXORA AI DRAMA application.
