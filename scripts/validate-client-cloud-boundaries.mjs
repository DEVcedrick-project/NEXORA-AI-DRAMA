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
assert(pushFunction.includes('audience: PROJECT_ID') && pushFunction.includes('issuer: `https://securetoken.google.com/${PROJECT_ID}`'),
  "Push registration must validate the Firebase token issuer and audience.");
assert(pushFunction.includes("MAX_DEVICES_PER_USER = 5") && pushFunction.includes('admin.rpc("nexora_register_push_device"'),
  "Push registration must enforce its device cap through the atomic database RPC.");
assert(!pushFunction.includes('.from("nexora_push_devices")'),
  "Push registration must not perform a non-atomic read/count/write sequence.");

const registrationMigration = fs.readFileSync("supabase/migrations/202611270001_atomic_push_device_registration.sql", "utf8");
assert(registrationMigration.includes("pg_advisory_xact_lock") && registrationMigration.includes("hashtextextended"),
  "Push device registration must serialize per-user and per-token claims.");
assert(registrationMigration.includes("revoke all on function public.nexora_register_push_device") &&
  registrationMigration.includes("to service_role"),
  "Only the trusted service role may execute the push registration RPC.");

const broadcastFunction = fs.readFileSync("supabase/functions/nexora-push-broadcast/index.ts", "utf8");
assert(broadcastFunction.includes('.from("nexora_push_devices").select("token").not("user_id", "is", null)'),
  "Update broadcasts must never target unowned or unauthenticated device registrations.");
assert(broadcastFunction.includes('admin.rpc("nexora_claim_push_event"') &&
  broadcastFunction.includes('admin.rpc("nexora_complete_push_event"') &&
  broadcastFunction.includes('claimAdmin.rpc("nexora_release_push_event"'),
  "Update broadcasts must use atomic claims, completion, and safe pre-delivery release.");

const socialFunction = fs.readFileSync("supabase/functions/nexora-social/index.ts", "utf8");
assert(socialFunction.includes("A valid published drama ID is required"),
  "Social actions must reject malformed catalog IDs.");
assert(socialFunction.includes('.eq("id",seriesId).eq("status","published").maybeSingle()'),
  "Social actions must authorize the target against the published drama catalog.");
assert(socialFunction.includes('if(!publishedDrama) return reply(404,{error:"Published drama not found"})'),
  "Social actions must reject draft, hidden and nonexistent dramas.");
assert(socialFunction.includes('db.rpc("nexora_create_social_comment"') &&
  socialFunction.includes('if(created!==true) return reply(429'),
  "Social comment rate limits must be enforced atomically in PostgreSQL.");
assert(socialFunction.includes('db.rpc("nexora_toggle_social_reaction"') &&
  !/from\("nexora_social_(?:likes|saves)"\)\.(?:select|insert|delete)/.test(socialFunction),
  "Social like and save toggles must use atomic PostgreSQL operations, not client-side read/write sequences.");
const reactionMigration = fs.readFileSync("supabase/migrations/202611270004_atomic_social_reactions.sql", "utf8");
assert(reactionMigration.includes("pg_advisory_xact_lock") &&
  reactionMigration.includes("nexora_toggle_social_reaction") &&
  reactionMigration.includes("to service_role"),
  "Social reaction toggles must be serialized and service-role-only.");

const appCheckBridge = fs.readFileSync("scripts/install-native-updater.py", "utf8");
const nativePlugins = fs.readFileSync("scripts/native-plugins-entry.js", "utf8");
const appCheckShared = fs.readFileSync("supabase/functions/_shared/nexora-app-check.ts", "utf8");
assert(appCheckBridge.includes("firebase-appcheck-playintegrity") &&
  appCheckBridge.includes("PlayIntegrityAppCheckProviderFactory.getInstance()") &&
  appCheckBridge.includes("NexoraAppCheckPlugin.class"),
  "Android builds must initialize Play Integrity App Check and register its native token bridge.");
assert(nativePlugins.includes('registerPlugin("NexoraAppCheck")') &&
  source.includes('getNexoraAppCheckHeaders()') &&
  source.includes('"X-Firebase-AppCheck": token'),
  "Native app requests must attach Firebase App Check tokens when available.");
assert(appCheckShared.includes("firebaseappcheck.googleapis.com/v1/jwks") &&
  appCheckShared.includes('algorithms: ["RS256"]') &&
  appCheckShared.includes("projects/") &&
  appCheckShared.includes('payload.sub !== APP_ID'),
  "Backend App Check verification must validate Firebase signature, issuer, audience, and app identity.");
assert(appCheckShared.includes('NEXORA_APP_CHECK_ENFORCE') &&
  appCheckShared.includes('=== "true"'),
  "App Check enforcement must remain explicitly opt-in until Firebase Console registration and monitoring are complete.");
for (const [path, code] of [
  ["supabase/functions/nexora-push-register/index.ts", "x-firebase-appcheck"],
  ["supabase/functions/nexora-social/index.ts", "x-firebase-appcheck"],
]) {
  const endpoint = fs.readFileSync(path, "utf8");
  assert(endpoint.includes("verifyNexoraAppCheck") && endpoint.includes(code),
    `${path} must accept and verify App Check tokens.`);
}

const packageVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const publishedVersion = JSON.parse(fs.readFileSync("update.json", "utf8")).version;
const versionParts = value => value.split(".").map(Number);
const [currentMajor, currentMinor, currentPatch] = versionParts(packageVersion);
const [publishedMajor, publishedMinor, publishedPatch] = versionParts(publishedVersion);
const currentVersionCode = currentMajor * 1000000 + currentMinor * 1000 + currentPatch;
const publishedVersionCode = publishedMajor * 1000000 + publishedMinor * 1000 + publishedPatch;
assert(Number.isSafeInteger(currentVersionCode) && Number.isSafeInteger(publishedVersionCode) &&
  currentVersionCode > publishedVersionCode,
  `The next release version (${packageVersion}) must be strictly newer than the published version (${publishedVersion}).`);

const workflow = fs.readFileSync(".github/workflows/android-apk.yml", "utf8");
const upgradeTest = workflow.slice(
  workflow.indexOf("      - name: Test real in-place upgrade from the previous signed release"),
  workflow.indexOf("      - name: Sign release AAB")
);
assert(upgradeTest.includes("github.event_name == 'pull_request'") &&
  upgradeTest.includes("github.ref == 'refs/heads/main'") &&
  upgradeTest.includes("github.event_name == 'push'") &&
  upgradeTest.includes("github.event_name == 'workflow_dispatch'"),
  "The in-place upgrade test must run for signed pull-request builds and production releases.");

console.log("PASS: Profile-only cloud sync, server-owned wallet boundaries, atomic authenticated FCM registration, owned-device broadcasts, and published-only social access are enforced.");
