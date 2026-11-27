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
assert(pushFunction.includes("MAX_DEVICES_PER_USER = 5") && pushFunction.includes('.eq("user_id", userId)'),
  "Push registration must enforce the per-account device limit.");
assert(pushFunction.includes('.select("token,user_id,install_id")'),
  "Push registration must inspect the existing FCM token owner and install identity.");
assert(pushFunction.includes("existing?.user_id && existing.user_id !== userId && existing.install_id !== installId"),
  "An FCM token must not be reassigned across unrelated accounts.");
assert(pushFunction.includes("existing?.user_id !== userId && (count ?? 0) >= MAX_DEVICES_PER_USER"),
  "The device cap must also apply when a token changes account ownership.");


const socialFunction = fs.readFileSync("supabase/functions/nexora-social/index.ts", "utf8");
assert(socialFunction.includes("A valid published drama ID is required"),
  "Social actions must reject malformed catalog IDs.");
assert(socialFunction.includes('.eq("id",seriesId).eq("status","published").maybeSingle()'),
  "Social actions must authorize the target against the published drama catalog.");
assert(socialFunction.includes('if(!publishedDrama) return reply(404,{error:"Published drama not found"})'),
  "Social actions must reject draft, hidden and nonexistent dramas.");

console.log("PASS: Profile-only cloud sync, server-owned wallet boundaries authenticated FCM device registration, and published-only social access are enforced.");
