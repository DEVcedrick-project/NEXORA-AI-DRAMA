import { readFile, stat } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const html = await readFile("www/index.html", "utf8");
if (pkg.dependencies?.["@supabase/supabase-js"] !== "2.119.2") {
  throw new Error("Supabase SDK must remain pinned to exact version 2.119.2.");
}
if (!html.includes('import { createClient } from "/vendor/supabase.js";')) {
  throw new Error("App must import the local Supabase SDK bundle.");
}
if (/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/i.test(html)) {
  throw new Error("Remote Supabase SDK CDN import remains in www/index.html.");
}
const bundle = await stat("www/vendor/supabase.js");
if (bundle.size < 50_000) {
  throw new Error(`Local Supabase SDK bundle is missing or unexpectedly small: ${bundle.size} bytes.`);
}
console.log(`Local Supabase SDK verified (${bundle.size} bytes, version 2.119.2).`);
