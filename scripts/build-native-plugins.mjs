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
console.log("Bundled Capacitor push and local notification bridges for offline-safe APK startup.");
