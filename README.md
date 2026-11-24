# NEXORA AI DRAMA

Public Android streaming app for dramas and episodes published from the private **NEXORA STUDIO** owner dashboard.

## How the two apps work

- **NEXORA STUDIO** remains the private owner control center. Use its AI Drama Management screen to create and edit drama titles, upload cover art, manage individual episodes, upload episode thumbnails/videos, and publish or unpublish content.
- **NEXORA AI DRAMA** is the separate public viewer APK. It reads only published dramas and published episodes from the same Supabase project. It has no owner dashboard and no create, edit, or delete controls.
- Publishing a drama or episode in NEXORA STUDIO makes it available to the viewer app after the viewer refreshes its catalog.

## Viewer features

- Published drama catalog with cover artwork and genre
- Search by drama title or genre
- Drama details and synopsis
- Episode list ordered by Studio episode number/order
- Online playback of published episode video URLs
- Native Android splash screen and NEXORA launcher icon
- Premium dark interface with NEXORA gold accents

## Backend

The viewer uses the existing NEXORA STUDIO Supabase project:
- Project URL: `https://gbpjixlubrmgzqflbkwz.supabase.co`
- Tables: `ai_dramas` and `ai_drama_episodes`
- Public video bucket: `nexora-videos`
- Public artwork bucket: `studio-thumbnails`

The database grants anonymous clients **read-only access to published dramas and published episodes whose parent drama is published**. Studio's authenticated owner policies continue to control all management operations. The Android app embeds only the Supabase publishable key; never place a service-role or secret key in this app or repository.

Current Studio storage limits are 50 MB per video and 5 MB per thumbnail. Published video and image URLs are publicly retrievable, so upload only media that NEXORA is allowed to distribute publicly.

## Build an APK

A GitHub Actions workflow builds a debug APK on pushes to `main` and on manual runs:

1. Open the repository's **Actions** tab.
2. Select **Build NEXORA AI DRAMA APK**.
3. Choose **Run workflow** if you want to start a build manually.
4. Open the completed run and download the `NEXORA-AI-DRAMA-debug-APK` artifact.

The debug APK is for testing and direct installation. It is signed with GitHub's temporary debug key and is not suitable for reliable in-place updates. For updates that install over the previous release without uninstalling or losing app data, configure one permanent Android signing key and keep it unchanged. The workflow then builds a signed release APK and increments the version code on every run. A Play Store release also needs store listing assets and Play Console review.

## Stable signing for in-place updates and Play Store

Generate a permanent upload key once on a trusted computer and keep a secure backup. Never commit the keystore to this public repository:

```bash
keytool -genkeypair -v -keystore nexora-upload-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias nexora-ai-drama
base64 < nexora-upload-key.jks | tr -d '\\n'
```

Add the base64 output and the key details under **GitHub → Settings → Secrets and variables → Actions** using these exact secret names:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

After these secrets are configured, GitHub Actions creates the debug test APK, a signed release APK, and a signed Android App Bundle (`.aab`) for Play Console. The same application ID (`com.devcedrick.nexoraaidrama`) and the same signing key must be kept for every release; the workflow automatically increases `versionCode` on each run. Losing or changing the signing key prevents Android from installing an update over the existing signed app.

## Android configuration

- Application ID: `com.devcedrick.nexoraaidrama`
- Minimum Android: 7.0 (API 24)
- Target SDK: 35
- Kotlin + Jetpack Compose + Media3 playback
- Build command: `gradle assembleDebug`
