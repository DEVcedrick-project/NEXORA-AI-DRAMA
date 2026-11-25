import { mkdir } from "node:fs/promises";
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
console.log("Bundled Capacitor push and local notification bridges for offline-safe APK startup.");
