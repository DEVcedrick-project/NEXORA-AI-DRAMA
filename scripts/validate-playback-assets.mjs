import fs from "node:fs";

const html = fs.readFileSync("www/index.html", "utf8");
const bundlePath = "www/vendor/hls.min.js";

if (!html.includes('<script defer src="/vendor/hls.min.js"></script>')) {
  throw new Error("The app must load HLS.js from its bundled local asset.");
}
if (/https:\/\/cdn\.jsdelivr\.net\/npm\/hls\.js/i.test(html)) {
  throw new Error("An external HLS.js CDN dependency remains in the app shell.");
}
if (!fs.existsSync(bundlePath)) {
  throw new Error("The local HLS.js bundle was not generated before Android sync.");
}
const bundle = fs.statSync(bundlePath);
if (!bundle.isFile() || bundle.size < 100_000) {
  throw new Error(`The local HLS.js bundle is missing or incomplete (${bundle.size} bytes).`);
}
if (!html.includes("window.Hls") || !html.includes("Hls.Events.MANIFEST_PARSED")) {
  throw new Error("The player no longer exposes the HLS.js playback integration expected by the app.");
}
console.log(`PASS: local HLS.js bundle exists (${bundle.size} bytes); player no longer requires the HLS CDN.`);
