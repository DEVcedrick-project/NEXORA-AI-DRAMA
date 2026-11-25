from pathlib import Path
import re, shutil

package_dir = Path("android/app/src/main/java/com/devcedrick/nexoraaidrama")
package_dir.mkdir(parents=True, exist_ok=True)
source = Path("scripts/android/NexoraUpdaterPlugin.java")
shutil.copy2(source, package_dir / source.name)

manifest = Path("android/app/src/main/AndroidManifest.xml")
xml = manifest.read_text()
if "android.permission.REQUEST_INSTALL_PACKAGES" not in xml:
    xml = xml.replace("<application", ' <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\\n    <application', 1)
manifest.write_text(xml)

main = Path("android/app/src/main/java/com/devcedrick/nexoraaidrama/MainActivity.java")
if not main.exists():
    candidates = list(Path("android/app/src/main/java").rglob("MainActivity.java"))
    if len(candidates) != 1:
        raise SystemExit(f"Expected one generated MainActivity.java; found {len(candidates)}")
    main = candidates[0]
text = main.read_text()
if "NexoraUpdaterPlugin" not in text:
    if "import com.getcapacitor.BridgeActivity;" not in text:
        raise SystemExit("Unexpected Capacitor MainActivity template: BridgeActivity import not found")
    text = text.replace("import com.getcapacitor.BridgeActivity;",
                        "import com.getcapacitor.BridgeActivity;\\nimport com.devcedrick.nexoraaidrama.NexoraUpdaterPlugin;")
    text = re.sub(r"extends BridgeActivity\\s*\\{",
                  "extends BridgeActivity {\\n    @Override\\n    public void onCreate(android.os.Bundle savedInstanceState) {\\n        registerPlugin(NexoraUpdaterPlugin.class);\\n        super.onCreate(savedInstanceState);\\n    }",
                  text, count=1)
    if "registerPlugin(NexoraUpdaterPlugin.class)" not in text:
        raise SystemExit("Could not register native NEXORA updater plugin")
    main.write_text(text)
print("Installed and registered the native NEXORA APK downloader.")
