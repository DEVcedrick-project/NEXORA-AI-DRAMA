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

const pushFunction = fs.readFileSync("supabase/functions/nexora-push-register/index.ts", "utf8");
assert(source.includes('"Authorization": "Bearer " + idToken'),
  "FCM registration must send a Firebase ID token.");
assert(pushFunction.includes("jwtVerify") && pushFunction.includes("securetoken.google.com/"),
  "Push registration must cryptographically verify Firebase ID tokens.");
assert(pushFunction.includes(String.raw`authorization.match(/^Bearer\s+(.+)$/i)`),
  "Push registration must parse the standard Bearer authorization header.");
assert(pushFunction.includes(String.raw`/\\s/.test(token)`) === false,
  "FCM token whitespace validation must use the whitespace character class, not a literal backslash.");
assert(pushFunction.includes(String.raw`/\s/.test(token)`),
  "FCM registration must reject whitespace in device tokens.");
assert(pushFunction.includes(String.raw`/^v?\d+\.\d+\.\d+$/`),
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
const pushCleanupMigration = fs.readFileSync("supabase/migrations/20261127170000_nexora_push_stale_device_cleanup.sql", "utf8");
assert(pushCleanupMigration.includes("last_seen_at < pg_catalog.now() - interval '180 days'") &&
  pushCleanupMigration.includes("token <> p_token") &&
  pushCleanupMigration.includes("v_device_count >= 5"),
  "Push registration must retire dormant devices before enforcing the five-device cap.");
assert(pushCleanupMigration.includes("pg_advisory_xact_lock") &&
  pushCleanupMigration.includes("token_conflict"),
  "Stale-device cleanup must preserve atomic registration locks and cross-account token protection.");

const pushClient = block("// Keep the latest FCM token", "// Native Android push notifications (FCM).");
assert(pushClient.includes("for (let attempt = 0; attempt < 3; attempt++)"),
  "FCM registration must retry transient failures with a bounded attempt count.");
assert(pushClient.includes("firebaseUser.getIdToken(true)"),
  "FCM registration must refresh an expired Firebase ID token after an authentication failure.");
assert(pushClient.includes('window.addEventListener("online", recover)') &&
  pushClient.includes('document.addEventListener("visibilitychange", recover)'),
  "FCM registration must recover after network reconnection and app resume.");
assert(source.includes("onAuthStateChanged") &&
  pushClient.includes("nexoraPushAuthObserverInstalled") &&
  pushClient.includes("Auth-change registration recovery failed"),
  "FCM registration must observe Firebase account changes and retry for the active identity.");
assert(pushClient.includes("const registrationUid = firebaseUser.uid") &&
  pushClient.includes("runtime.fbAuth?.currentUser?.uid !== registrationUid"),
  "A stale in-flight push registration must stop when the Firebase account changes.");
assert(pushClient.includes("getNexoraAppCheckToken") &&
  pushClient.includes('headers["X-Firebase-AppCheck"] = appCheckToken'),
  "Push registration must attach a native App Check token when available.");

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

assert(socialFunction.includes("nexora_check_social_request_rate_limit") &&
  socialFunction.includes("trustedNetworkHash") && socialFunction.includes("cf-connecting-ip") && socialFunction.includes("x-real-ip"),
  "Every social action must be protected by a trusted network-scoped and per-account limiter.");
assert(socialFunction.includes("nexora_toggle_social_reaction") &&
  socialFunction.includes("nexora_create_social_comment"),
  "Social reactions and comments must use their atomic database operations.");
assert(socialFunction.includes('"Retry-After":"60"') &&
  socialFunction.includes("Secure request network metadata unavailable"),
  "Rate-limited requests must return a retry hint and fail closed without trusted network metadata.");
assert(!socialFunction.includes("recentCount") &&
  !socialFunction.includes('db.from("nexora_social_comments").insert'),
  "The Edge Function must not bypass atomic comment-rate-limit enforcement.");

assert(socialFunction.includes("SOCIAL_COMMENT_PAGE_SIZE = 30") &&
  socialFunction.includes(".limit(SOCIAL_COMMENT_PAGE_SIZE+1)") &&
  socialFunction.includes('.order("created_at",{ascending:false}).order("id",{ascending:false})'),
  "Social comment reads must use a bounded 30-item page with deterministic newest-first ordering.");
assert(socialFunction.includes("cursorCreatedAt") && socialFunction.includes("cursorId") &&
  socialFunction.includes("created_at.lt.") && socialFunction.includes("id.lt.") &&
  socialFunction.includes("Invalid comment pagination cursor"),
  "Social comment pagination must validate and apply a stable keyset cursor.");
assert(socialFunction.includes("hasMoreComments,nextCursor"),
  "Social comment responses must expose continuation metadata.");
const socialClientPagination = block("function renderSocialComments(seriesId)", "function openCommentDrawer(seriesId)");
assert(socialClientPagination.includes("Load older comments") &&
  socialClientPagination.includes("loadOlderSocialComments") &&
  socialClientPagination.includes("socialCommentHasMore"),
  "The comment drawer must expose a guarded Load older comments action.");
const olderComments = block("async function loadOlderSocialComments(id)", "function setupFeedIntersectionObserver()");
assert(olderComments.includes("cursorCreatedAt: cursor.createdAt") &&
  olderComments.includes("cursorId: cursor.id") &&
  olderComments.includes("new Set(existing.map(comment => comment.id))") &&
  olderComments.includes("state.commentsBySeries[id] = [...existing, ...older]"),
  "Older comment pages must use the cursor and append deduplicated rows without replacing the current page.");

assert(socialFunction.includes("APP_CHECK_JWKS") &&
  socialFunction.includes("firebaseappcheck.googleapis.com/v1/jwks") &&
  socialFunction.includes("NEXORA_APP_CHECK_ENFORCE") &&
  socialFunction.includes("compatibility mode"),
  "Social API must verify Firebase App Check tokens in shadow mode before enforcement.");
assert(socialFunction.includes("x-firebase-appcheck") &&
  socialFunction.includes("APP_CHECK_PROJECT_NUMBER"),
  "Social API must accept and validate project-scoped Firebase App Check tokens.");
assert(socialFunction.includes("APP_CHECK_ALLOWED_APP_IDS.has(subject)") &&
  socialFunction.includes('1:201389649043:android:4dd0433ed5959b5e85f166'),
  "Social API must bind App Check tokens to the explicitly allowed NEXORA AI DRAMA app IDs.");
assert(source.includes("PlayIntegrityAppCheckProviderFactory") === false,
  "Web source must not import native-only Play Integrity SDK classes.");
const socialClient = block("async function getNexoraAppCheckToken()", "function applyNexoraSocialSnapshot(");
assert(socialClient.includes("plugin.getToken()") &&
  socialClient.includes("X-Firebase-AppCheck") &&
  socialClient.includes("if (appCheckToken)"),
  "Social client must attach a native App Check token when available without blocking legacy clients.");

const nativeEntry = fs.readFileSync("scripts/native-plugins-entry.js", "utf8");
const nativeAppCheck = fs.readFileSync("scripts/android/NexoraAppCheckPlugin.java", "utf8");
const appCheckInstaller = fs.readFileSync("scripts/install-native-app-check.py", "utf8");
assert(nativeEntry.includes('export const NexoraAppCheck = registerPlugin("NexoraAppCheck");'),
  "The local Capacitor runtime must register the native App Check bridge.");
assert(nativeAppCheck.includes("PlayIntegrityAppCheckProviderFactory.getInstance()") &&
  nativeAppCheck.includes("setTokenAutoRefreshEnabled(true)") &&
  nativeAppCheck.includes("getAppCheckToken(false)"),
  "The native Android bridge must use Play Integrity, auto-refresh and return App Check tokens.");
assert(appCheckInstaller.includes("firebase-appcheck-playintegrity:19.0.1") &&
  appCheckInstaller.includes("registerPlugin(NexoraAppCheckPlugin.class)"),
  "The Android build must install the native Play Integrity SDK and register its Capacitor bridge.");
const appCheckClient = block("let nexoraAppCheckInitPromise = null;", "async function callNexoraSocial(");
assert(appCheckClient.includes("NexoraAppCheck.initialize()") &&
  appCheckClient.includes("plugin.getToken()"),
  "The client must initialize the native bridge and retrieve App Check tokens.");
assert(appCheckClient.includes("setTimeout(() => resolve(null), 2500)") &&
  appCheckClient.includes("clearTimeout(timeoutId)"),
  "App Check token lookup must be time-bounded so unavailable attestation cannot stall push or social requests.");
assert(appCheckClient.includes("nexoraAppCheckInitPromise = null") &&
  appCheckClient.includes("if (!window.Capacitor?.isNativePlatform?.()) return ''"),
  "Failed App Check initialization must be retryable and non-native clients must continue without attestation.");
assert(pushClient.includes("getNexoraAppCheckToken") &&
  pushClient.includes('headers["X-Firebase-AppCheck"] = appCheckToken'),
  "Push registration must attach a native App Check token when available.");
assert(socialClient.includes("plugin.getToken()") &&
  socialClient.includes("X-Firebase-AppCheck") &&
  socialClient.includes("if (appCheckToken)"),
  "Social requests must attach a native App Check token when available without blocking legacy clients.");
for (const [name, fn] of [["social", socialFunction], ["push registration", pushFunction]]) {
  assert(fn.includes("MAX_APP_CHECK_TOKEN_LENGTH = 8192") &&
    fn.includes("token.length > MAX_APP_CHECK_TOKEN_LENGTH"),
    `The ${name} endpoint must reject oversized Firebase App Check tokens before JWT parsing.`);
  assert(fn.includes("https://firebaseappcheck.googleapis.com/v1/jwks") &&
    /algorithms:\\s*\\["RS256"\\]/.test(fn) &&
    fn.includes("https://firebaseappcheck.googleapis.com/") &&
    fn.includes("projects/"),
    `The ${name} endpoint must verify App Check signatures and Firebase project claims.`);
}
assert(socialFunction.includes("APP_CHECK_ALLOWED_APP_IDS") &&
  socialFunction.includes("1:201389649043:web:fd6846443425fbe885f166") &&
  socialFunction.includes("1:201389649043:android:4dd0433ed5959b5e85f166") &&
  !socialFunction.includes("1:201389649043:android:9393d9ec1a9dba0b85f166"),
  "Social App Check must allow only the NEXORA AI DRAMA web and Android app IDs, not NEXORA STUDIO.");
assert(pushFunction.includes("APP_CHECK_ALLOWED_APP_ID") &&
  pushFunction.includes("subject === APP_CHECK_ALLOWED_APP_ID"),
  "Push registration App Check must require the exact NEXORA AI DRAMA Android app ID.");
assert(pushFunction.includes("NEXORA_APP_CHECK_ENFORCE") &&
  pushFunction.includes("attestation status"),
  "Push registration must remain monitor-only until the enforcement flag is deliberately enabled.");
assert(socialFunction.includes("NEXORA_APP_CHECK_ENFORCE") &&
  socialFunction.includes("compatibility mode"),
  "Social API must remain compatible with existing clients until enforcement is deliberately enabled.");

console.log("PASS: Profile-only cloud sync, server-owned wallet boundaries authenticated FCM device registration, and published-only social access are enforced.");
