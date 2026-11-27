import { mkdir, copyFile, stat } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("www/vendor", { recursive: true });
await build({
  entryPoints: ["scripts/native-plugins-entry.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  outfile: "www/vendor/nexora-native-plugins.js",
  legalComments: "none",
  sourcemap: false,
});

// Ship the exact pinned HLS.js runtime inside the APK. Playback no longer
// depends on jsDelivr being reachable when a viewer opens an HLS episode.
const hlsSource = "node_modules/hls.js/dist/hls.min.js";
const hlsTarget = "www/vendor/hls.min.js";
await copyFile(hlsSource, hlsTarget);
const hlsStats = await stat(hlsTarget);
if (hlsStats.size < 100_000) {
  throw new Error(`Bundled HLS.js is unexpectedly small (${hlsStats.size} bytes).`);
}
console.log(`Bundled local HLS.js runtime (${hlsStats.size} bytes) for offline-safe playback startup.`);
// Bundle the pinned Lucide icon runtime locally; the viewer keeps its existing
// window.lucide.createIcons() API and no longer needs unpkg at runtime.
await build({
  entryPoints: ["scripts/lucide-runtime-entry.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  outfile: "www/vendor/lucide.js",
  legalComments: "none",
  sourcemap: false,
});
const lucideStats = await stat("www/vendor/lucide.js");
if (lucideStats.size < 20_000) {
  throw new Error(`Bundled Lucide runtime is unexpectedly small (${lucideStats.size} bytes).`);
}
console.log(`Bundled local Lucide runtime (${lucideStats.size} bytes).`);
console.log("Bundled Capacitor push and local notification bridges for offline-safe APK startup.");

// Bundle the pinned Supabase client as a local ESM asset. The app imports
// this file from its existing module, preserving its createClient API.
await build({
  entryPoints: ["scripts/supabase-runtime-entry.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  outfile: "www/vendor/supabase.js",
  legalComments: "none",
  sourcemap: false,
});
const supabaseStats = await stat("www/vendor/supabase.js");
if (supabaseStats.size < 50_000) {
  throw new Error(`Bundled Supabase client is unexpectedly small (${supabaseStats.size} bytes).`);
}
console.log(`Bundled local Supabase client (${supabaseStats.size} bytes).`);

// Bundle the pinned Firebase modular SDK locally. Authentication and realtime
// database imports share one browser ESM bundle and no longer require gstatic.
await build({
  entryPoints: ["scripts/firebase-runtime-entry.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  outfile: "www/vendor/firebase.js",
  legalComments: "none",
  sourcemap: false,
});
const firebaseStats = await stat("www/vendor/firebase.js");
if (firebaseStats.size < 100_000) {
  throw new Error(`Bundled Firebase SDK is unexpectedly small (${firebaseStats.size} bytes).`);
}
console.log(`Bundled local Firebase SDK (${firebaseStats.size} bytes).`);
