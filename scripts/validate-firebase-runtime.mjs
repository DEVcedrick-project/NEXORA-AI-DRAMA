import { readFile, stat } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const html = await readFile("www/index.html", "utf8");
const builder = await readFile("scripts/build-native-plugins.mjs", "utf8");
const entry = await readFile("scripts/firebase-runtime-entry.js", "utf8");
const workflow = await readFile(".github/workflows/android-apk.yml", "utf8");

if (packageJson.dependencies?.firebase !== "11.6.1") {
  throw new Error("Firebase SDK must remain pinned to 11.6.1.");
}
for (const specifier of [
  'from "/vendor/firebase.js";'
]) {
  if ((html.match(new RegExp(specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length !== 3) {
    throw new Error("Expected all three Firebase module imports to use the local bundle.");
  }
}
if (/https:\/\/www\.gstatic\.com\/firebasejs\//.test(html)) {
  throw new Error("Remote Firebase SDK imports remain in www/index.html.");
}
for (const symbol of [
  "initializeApp", "getApps", "deleteApp", "getAuth", "browserLocalPersistence",
  "setPersistence", "signInAnonymously", "signInWithCustomToken",
  "createUserWithEmailAndPassword", "signInWithEmailAndPassword",
  "EmailAuthProvider", "linkWithCredential", "updateProfile",
  "sendPasswordResetEmail", "signOut", "getDatabase", "ref", "get",
  "onValue", "update", "serverTimestamp"
]) {
  if (!entry.includes(symbol)) throw new Error(`Firebase bundle entry is missing ${symbol}.`);
}
if (!builder.includes('entryPoints: ["scripts/firebase-runtime-entry.js"]') ||
    !builder.includes('outfile: "www/vendor/firebase.js"')) {
  throw new Error("Firebase SDK is not included in the native asset build.");
}
if (!workflow.includes("node scripts/validate-firebase-runtime.mjs")) {
  throw new Error("Firebase runtime validation is missing from Android CI.");
}
const bundle = await stat("www/vendor/firebase.js").catch(() => null);
if (bundle && bundle.size < 100_000) {
  throw new Error(`Bundled Firebase SDK is unexpectedly small (${bundle.size} bytes).`);
}
console.log(bundle
  ? `Local Firebase runtime validation passed (${bundle.size} bytes).`
  : "Firebase runtime source validation passed; bundle size will be checked after build.");
