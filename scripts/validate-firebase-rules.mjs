import fs from "node:fs";

const path = "firebase/database.rules.production.template.json";
const document = JSON.parse(fs.readFileSync(path, "utf8"));
const rules = document.rules;

function requireRule(condition, message) {
  if (!condition) throw new Error(message);
}

requireRule(rules[".read"] === false, "Root reads must remain denied.");
requireRule(rules[".write"] === false, "Root writes must remain denied.");
requireRule(rules.series?.[".read"] === true, "Published legacy catalog reads must remain available.");
requireRule(rules.series?.[".write"] === false, "Public catalog writes must remain denied.");

const user = rules.users?.["$uid"];
requireRule(user?.[".read"] === "auth != null && auth.uid === $uid", "User reads must remain UID-scoped.");
requireRule(
  user?.profile?.[".write"] === "auth != null && auth.uid === $uid",
  "Profile writes must remain UID-scoped."
);
requireRule(
  user?.connectionCheck?.[".write"] === "auth != null && auth.uid === $uid",
  "Connection checks must be writable only by the matching authenticated UID."
);
requireRule(
  user?.connectionCheck?.[".validate"] === "newData.hasChildren(['lastVerifiedAt']) && newData.numChildren() === 1 && newData.child('lastVerifiedAt').isNumber()",
  "Connection checks must contain only a numeric lastVerifiedAt timestamp."
);

for (const key of ["wallet", "vipStatus", "unlockedEpisodes"]) {
  requireRule(user?.[key]?.[".write"] === false, `${key} must remain server-write-only.`);
}

console.log("PASS: Firebase rules keep root/private data locked, scope user access, permit only the user's validated connection check, and protect wallet/VIP/unlocks.");
