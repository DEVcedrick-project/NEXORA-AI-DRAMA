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


const socialFunction = fs.readFileSync("supabase/functions/nexora-social/index.ts", "utf8");
assert(socialFunction.includes("A valid published drama ID is required"),
  "Social actions must reject malformed catalog IDs.");
assert(socialFunction.includes('.eq("id",seriesId).eq("status","published").maybeSingle()'),
  "Social actions must authorize the target against the published drama catalog.");
assert(socialFunction.includes('if(!publishedDrama) return reply(404,{error:"Published drama not found"})'),
  "Social actions must reject draft, hidden and nonexistent dramas.");

console.log("PASS: Profile-only cloud sync, server-owned wallet boundaries authenticated FCM device registration, and published-only social access are enforced.");
