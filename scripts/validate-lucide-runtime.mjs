import { readFile, stat } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const html = await readFile("www/index.html", "utf8");
const entry = await readFile("scripts/lucide-runtime-entry.js", "utf8");
const bundlePath = "www/vendor/lucide.js";

if (packageJson.dependencies?.lucide !== "1.81.0") {
  throw new Error("Lucide must remain pinned to the exact reviewed version 1.81.0.");
}
if (!html.includes('<script defer src="/vendor/lucide.js"></script>')) {
  throw new Error("The app must load the local Lucide bundle.");
}
if (/https:\/\/unpkg\.com\/lucide(?:@|\/)/i.test(html)) {
  throw new Error("A remote Lucide CDN reference remains in www/index.html.");
}
if (!entry.includes("createIcons") || !entry.includes("window.lucide")) {
  throw new Error("The local Lucide entry must preserve window.lucide.createIcons().");
}

const bundle = await stat(bundlePath);
if (bundle.size < 20_000) {
  throw new Error(`Local Lucide bundle is missing or unexpectedly small: ${bundle.size} bytes.`);
}
console.log(`Local Lucide runtime verified (${bundle.size} bytes, version ${packageJson.dependencies.lucide}).`);
