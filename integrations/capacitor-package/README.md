# NEXORA AI DRAMA — Capacitor package integration

This directory preserves the uploaded Capacitor 8 package separately from the existing native Kotlin Android app at the repository root. It is intentionally isolated: do not copy these files over the root Gradle/Kotlin project.

## Package contents
- `package.json` — Capacitor 8 and AdMob dependencies.
- `capacitor.config.json` — app ID and splash-screen settings.
- `.github/workflows/nexora-capacitor-apk.yml` — manual and push-triggered debug APK workflow, isolated from the native Kotlin build.
- `supabase/schema.sql` — source database schema, for review before applying.
- `www/index.html` — original app entry point from the uploaded ZIP; this large file still needs to be transferred as a separate Git commit before this folder is buildable.

## Important security note
The supplied SQL grants broad `anon` and `authenticated` access to wallet and unlocked-episode rows. Do not run it in production until policies are redesigned around authenticated `auth.uid()` ownership and wallet mutations are server-validated. Do not put service-role keys in the client.

## Build
After `www/index.html` is added, run `npm install`, `npx cap add android`, `npx cap sync android`, and `cd android && ./gradlew assembleDebug` from this directory.
