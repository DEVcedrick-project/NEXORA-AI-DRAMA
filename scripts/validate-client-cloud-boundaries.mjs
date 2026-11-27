import fs from "node:fs";

const source = fs.readFileSync("www/index.html", "utf8");

function block(start, end) {
  const a = source.indexOf(start);
  if (a < 0) throw new Error(`Missing source function: ${start}`);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`Missing end marker: ${end}`);
  return source.slice(a, b);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const profileSync = block("async function pushLocalStateToFirebaseNow()", "function updateFirebaseSyncBadges()");
assert(profileSync.includes("profile:"), "Profile sync must remain available.");
for (const forbidden of ["wallet:", "vipStatus:", "unlockedEpisodes:"]) {
  assert(!profileSync.includes(forbidden), `Profile sync must not write protected ${forbidden} data.`);
}

const rewardCredit = block("function creditCoins(", "function unlockEpisodeWithRewardedAd(");
assert(!/update\(ref\([^)]*wallet/.test(rewardCredit), "Client coin rewards must not write Firebase wallet balances.");

const rewardedUnlock = block("function unlockEpisodeWithRewardedAd(", "function unlockEpisodeWithCoins(");
assert(!/update\(ref\(/.test(rewardedUnlock), "Rewarded-ad callbacks must not write server entitlements.");

const coinUnlock = block("function unlockEpisodeWithCoins(", "function syncWalletUI(");
assert(!/update\(ref\(/.test(coinUnlock), "Coin unlocks must not write server wallet or entitlement records.");

const walletSync = block("async function syncStateToSupabaseNow(", "function getCapacitorAdMobPlugin()");
assert(!/\.from\(['"](?:user_wallets|unlocked_episodes)['"]\)/.test(walletSync),
  "The public Supabase client must not read or write protected wallet tables.");

const signOut = block("async function handleSignOutAccount()", "function cycleUserAvatar()");
assert(!/update\(ref\(/.test(signOut), "Account switching must not flush protected data from the client.");

const nativeEntry = fs.readFileSync("scripts/native-plugins-entry.js", "utf8");
const nativeAppCheck = fs.readFileSync("scripts/android/NexoraAppCheckPlugin.java", "utf8");
const appCheckInstaller = fs.readFileSync("scripts/install-native-app-check.py", "utf8");
assert(!JSON.parse(fs.readFileSync("package.json", "utf8")).dependencies?.["@capacitor-firebase/app-check"],
  "The native bridge must not force an incompatible Firebase JavaScript SDK upgrade.");
assert(nativeEntry.includes('export const NexoraAppCheck = registerPlugin("NexoraAppCheck");'),
  "The local Capacitor runtime must register the native App Check bridge.");
assert(nativeAppCheck.includes("PlayIntegrityAppCheckProviderFactory.getInstance()") &&
  nativeAppCheck.includes("setTokenAutoRefreshEnabled(true)") &&
  nativeAppCheck.includes("getAppCheckToken(false)"),
  "The native Android bridge must use Play Integrity, auto-refresh and return App Check tokens.");
assert(appCheckInstaller.includes("firebase-appcheck-playintegrity:19.0.1") &&
  appCheckInstaller.includes("registerPlugin(NexoraAppCheckPlugin.class)"),
  "The Android build must install the native Play Integrity SDK and register its Capacitor bridge.");
const appCheckClient = block('async function getNexoraAppCheckToken()', 'const NEXORA_DEFAULT_CONFIG');
assert(appCheckClient.includes("NexoraAppCheck.initialize()") &&
  appCheckClient.includes("NexoraAppCheck.getToken()"),
  "The client must initialize the native bridge and retrieve App Check tokens.");
assert(appCheckClient.includes("setTimeout(() => resolve(null), 2500)") &&
  appCheckClient.includes("clearTimeout(timeoutId)"),
  "App Check token lookup must be time-bounded so unavailable attestation cannot stall push or social requests.");
assert(appCheckClient.includes("nexoraAppCheckInitPromise = null"),
  "Failed App Check initialization must be retryable without reinstalling or signing out the user.");
assert(appCheckClient.includes("if (!window.Capacitor?.isNativePlatform?.()) return") &&
  appCheckClient.includes('return ""') &&
  appCheckClient.includes("continuing in monitor-only mode"),
  "App Check must remain native-only and fail open while server enforcement is disabled.");
assert(source.includes('...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {})') &&
  source.includes("...(appCheckToken ? { 'x-firebase-appcheck': appCheckToken } : {})"),
  "Both push registration and social requests must attach an available App Check token without blocking legacy clients.");
assert(source.includes('const appCheckToken = await getNexoraAppCheckToken();'),
  "Push and social requests must request the current App Check token.");
assert(source.includes("await firebaseUser.getIdToken()") && source.includes("await user.getIdToken()"),
  "App Check integration must retain Firebase ID-token authentication.");

const pushFunction = fs.readFileSync("supabase/functions/nexora-push-register/index.ts", "utf8");
assert(source.includes('"Authorization": "Bearer " + idToken'),
  "FCM registration must send a Firebase ID token.");
assert(pushFunction.includes("jwtVerify") && pushFunction.includes("securetoken.google.com/"),
  "Push registration must cryptographically verify Firebase ID tokens.");
assert(pushFunction.includes(String.raw`authorization.match(/^Bearer\s+(.+)$/i)`),
  "Push registration must parse the standard Bearer authorization header.");
assert(pushFunction.includes(String.raw`/\\s/.test(token)`) === false,
  "FCM token whitespace validation must use the whitespace character class, not a literal backslash.");
assert(pushFunction.includes("!/^[A-Za-z0-9:_-]+$/.test(token)"),
  "FCM registration must allow only valid token characters, rejecting whitespace and other invalid characters.");
assert(pushFunction.includes(String.raw`/^v?\d{1,6}\.\d{1,6}\.\d{1,6}$/`),
  "FCM registration must accept semantic app versions.");
assert(pushFunction.includes('audience: PROJECT_ID') && pushFunction.includes('issuer: `https://securetoken.google.com/${PROJECT_ID}`'),
  "Push registration must validate the Firebase token issuer and audience.");
assert(pushFunction.includes("MAX_DEVICES_PER_USER = 5"),
  "Push registration must keep the five-device account limit.");
assert(pushFunction.includes('admin.rpc("nexora_register_push_device"'),
  "Push registration must use the atomic database registration RPC.");
assert(pushFunction.includes("p_token: token") &&
  pushFunction.includes("p_user_id: userId") &&
  pushFunction.includes("p_app_version: version") &&
  pushFunction.includes("p_install_id: installId"),
  "The atomic registration RPC must receive the verified Firebase identity and validated device metadata.");
assert(pushFunction.includes('registration === "device_limit"') &&
  pushFunction.includes('registration === "token_conflict"'),
  "Push registration must handle atomic device-limit and token-conflict outcomes.");
assert(!pushFunction.includes(".upsert("),
  "Push registration must not bypass the atomic database registration RPC.");

const pushClient = block("// Keep the latest FCM token", "// Native Android push notifications (FCM).");
assert(pushClient.includes("for (let attempt = 0; attempt < 3; attempt++)"),
  "FCM registration must retry transient failures with a bounded attempt count.");
assert(pushClient.includes("firebaseUser.getIdToken(true)"),
  "FCM registration must refresh an expired Firebase ID token after an authentication failure.");
assert(pushClient.includes('window.addEventListener("online", recover)') &&
  pushClient.includes('document.addEventListener("visibilitychange", recover)'),
  "FCM registration must recover after network reconnection and app resume.");

const broadcastFunction = fs.readFileSync("supabase/functions/nexora-push-broadcast/index.ts", "utf8");
assert(broadcastFunction.includes('.eq("app_id", APP_ID)') &&
  broadcastFunction.includes('.eq("platform", "android")'),
  "Release broadcasts must target only NEXORA AI DRAMA Android devices.");
assert(broadcastFunction.includes("nexora_push_deliveries") &&
  broadcastFunction.includes('.eq("status", "pending")'),
  "Release broadcasts must track per-device delivery and skip completed devices.");
assert(broadcastFunction.includes('code === "UNREGISTERED"') &&
  !broadcastFunction.includes('code === "INVALID_ARGUMENT"'),
  "Only confirmed unregistered FCM tokens may be removed.");

const socialFunction = fs.readFileSync("supabase/functions/nexora-social/index.ts", "utf8");
assert(socialFunction.includes("A valid published drama ID is required"),
  "Social actions must reject malformed catalog IDs.");
assert(socialFunction.includes('.eq("id",seriesId).eq("status","published").maybeSingle()'),
  "Social actions must authorize the target against the published drama catalog.");
assert(socialFunction.includes('if(!publishedDrama) return reply(404,{error:"Published drama not found"})'),
  "Social actions must reject draft, hidden and nonexistent dramas.");
assert(socialFunction.includes('nexora_check_social_read_rate_limit') &&
  !/if\s*\(action\s*===\s*["']read["']\)\s*\{[\s\S]*?nexora_check_social_read_rate_limit/.test(socialFunction),
  "Every social action must pass through the per-user request rate limiter, not only feed reads.");
assert(socialFunction.includes('status:429') && socialFunction.includes('"Retry-After":"60"'),
  "Social rate limiting must return HTTP 429 with a one-minute Retry-After header.");

console.log("PASS: Profile-only cloud sync, server-owned wallet boundaries authenticated FCM device registration, and published-only social access are enforced.");
