# NEXORA AI DRAMA — Complete Capacitor + Firebase + Supabase + AdMob Package

This ZIP archive contains the complete, ready-to-build **NEXORA AI DRAMA** project structure for GitHub, ChatGPT, and Android `.apk` packaging.

## Included Files
- `www/index.html` — Complete self-contained NEXORA AI DRAMA application (Luxury Splash Screen, 4-tab vertical streaming feed, Watch-to-Earn, VIP ₱69/₱99 passes, Live Pop-Up Notifications, Safe In-Place OTA Update System, Continue Watching, APK Icon & Splash Studio, and Firebase/Supabase/AdMob clients).
- `package.json` — Capacitor 8 + `@capacitor-community/admob` + `@capacitor/splash-screen` dependencies.
- `capacitor.config.json` — Configured for `com.nexora.aidrama` (`NEXORA AI DRAMA`) with `webDir: "www"`.
- `supabase/schema.sql` — Ready-to-run Postgres SQL tables (`user_wallets` and `unlocked_episodes`) with Row Level Security policies.
- `.github/workflows/build-apk.yml` — Automated GitHub Actions workflow that builds a downloadable `app-debug.apk` on every push.

## Quick Setup Guide
1. **Configure API Keys**: Open `www/index.html` and fill in `NEXORA_DEFAULT_CONFIG` at the top of `<script type="module">` (Firebase API Key + Database URL, Supabase URL + Anon Key, and Android/iOS AdMob Rewarded Ad Unit IDs).
2. **Create Supabase Tables**: Paste `supabase/schema.sql` into your Supabase SQL Editor and click **Run**.
3. **Export External APK Logo & Splash PNGs**: Open `www/index.html` in any browser, tap **Profile → APK Icon & Splash**, and download the `512x512` launcher icon and `1080x1920` splash PNGs.
4. **Build Android `.apk` Locally or on GitHub**:
   - **GitHub Actions**: Push this folder to a GitHub repo, open the **Actions** tab, and download `nexora-ai-drama-debug-apk`.
   - **Local Terminal**:
     ```bash
     npm install
     npx cap add android
     npx cap sync android
     cd android && ./gradlew assembleDebug
     ```