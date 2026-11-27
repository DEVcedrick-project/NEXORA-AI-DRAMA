from pathlib import Path
import re, shutil

package_dir = Path("android/app/src/main/java/com/devcedrick/nexoraaidrama")
package_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(Path("scripts/android") / "NexoraUpdaterPlugin.java", package_dir / "NexoraUpdaterPlugin.java")

manifest = Path("android/app/src/main/AndroidManifest.xml")
xml = manifest.read_text()
for permission in (
    "android.permission.REQUEST_INSTALL_PACKAGES",
    "android.permission.POST_NOTIFICATIONS",
):
    if permission not in xml:
        xml = xml.replace("<application", f'    <uses-permission android:name="{permission}" />\n    <application', 1)

provider_name = "androidx.core.content.FileProvider"
provider_authority = "nexora-updater.fileprovider"
if provider_authority not in xml:
    provider = """
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.nexora-updater.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/nexora_updater_file_paths" />
        </provider>
"""
    if "</application>" not in xml:
        raise SystemExit("Android manifest has no application closing tag")
    xml = xml.replace("</application>", provider + "    </application>", 1)
if provider_name not in xml or provider_authority not in xml:
    raise SystemExit("Could not register the private APK FileProvider")
manifest.write_text(xml)

paths = Path("android/app/src/main/res/xml")
paths.mkdir(parents=True, exist_ok=True)
(paths / "nexora_updater_file_paths.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<paths xmlns:android="http://schemas.android.com/apk/res/android">\n'
    '    <external-files-path name="nexora_updates" path="." />\n'
    '</paths>\n'
)

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
                        "import com.getcapacitor.BridgeActivity;\nimport com.devcedrick.nexoraaidrama.NexoraUpdaterPlugin;")
    text = re.sub(r"extends BridgeActivity\s*\{",
                  "extends BridgeActivity {\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(NexoraUpdaterPlugin.class);\n        super.onCreate(savedInstanceState);\n    }",
                  text, count=1)
    if "registerPlugin(NexoraUpdaterPlugin.class)" not in text:
        raise SystemExit("Could not register native NEXORA updater plugin")
    main.write_text(text)

# Configure Android WebView to allow launch-time media playback with sound.
# Capacitor's default gesture gate can block autoplay even when HTML calls play().
activity_text = main.read_text()
gesture_setting = "getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);"
if gesture_setting not in activity_text:
    activity_text = activity_text.replace(
        "super.onCreate(savedInstanceState);",
        "super.onCreate(savedInstanceState);\n        // Permit automatic drama audio playback on app launch.\n        if (getBridge() != null && getBridge().getWebView() != null) {\n            " + gesture_setting + "\n        }",
        1
    )
    if gesture_setting not in activity_text:
        raise SystemExit("Could not configure Android WebView audio autoplay")
    main.write_text(activity_text)


# Install Firebase App Check with Play Integrity and expose short-lived tokens to the WebView.
app_gradle = Path("android/app/build.gradle")
gradle_text = app_gradle.read_text()
bom = 'implementation platform("com.google.firebase:firebase-bom:35.2.0")'
dependency = 'implementation "com.google.firebase:firebase-appcheck-playintegrity"'
if "firebase-appcheck-playintegrity" not in gradle_text:
    match = re.search(r"(?m)^\s*dependencies\s*\{", gradle_text)
    if match:
        insert_at = match.end()
        gradle_text = gradle_text[:insert_at] + "\n    " + bom + "\n    " + dependency + gradle_text[insert_at:]
    else:
        # Some Capacitor templates omit an app-level dependency block entirely.
        gradle_text += "\n\ndependencies {\n    " + bom + "\n    " + dependency + "\n}\n"
    app_gradle.write_text(gradle_text)

appcheck_plugin = package_dir / "NexoraAppCheckPlugin.java"
appcheck_plugin.write_text("""package com.devcedrick.nexoraaidrama;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.appcheck.FirebaseAppCheck;

@CapacitorPlugin(name = "NexoraAppCheck")
public class NexoraAppCheckPlugin extends Plugin {
    @PluginMethod
    public void getToken(PluginCall call) {
        try {
            FirebaseAppCheck.getInstance().getAppCheckToken(false)
                .addOnSuccessListener(token -> {
                    JSObject result = new JSObject();
                    result.put("token", token.getToken());
                    result.put("expireTimeMillis", token.getExpireTimeMillis());
                    call.resolve(result);
                })
                .addOnFailureListener(error -> call.reject("Firebase App Check token unavailable", error));
        } catch (Exception error) {
            call.reject("Firebase App Check is not initialized", error);
        }
    }
}
""")

main = Path("android/app/src/main/java/com/devcedrick/nexoraaidrama/MainActivity.java")
main_text = main.read_text()
if "NexoraAppCheckPlugin" not in main_text:
    main_text = main_text.replace(
        "import com.devcedrick.nexoraaidrama.NexoraUpdaterPlugin;",
        "import com.devcedrick.nexoraaidrama.NexoraUpdaterPlugin;\nimport com.devcedrick.nexoraaidrama.NexoraAppCheckPlugin;"
    )
    main_text = main_text.replace(
        "registerPlugin(NexoraUpdaterPlugin.class);",
        "registerPlugin(NexoraUpdaterPlugin.class);\n        registerPlugin(NexoraAppCheckPlugin.class);"
    )
if "PlayIntegrityAppCheckProviderFactory" not in main_text:
    main_text = main_text.replace(
        "import com.getcapacitor.BridgeActivity;",
        "import com.getcapacitor.BridgeActivity;\nimport com.google.firebase.FirebaseApp;\nimport com.google.firebase.appcheck.FirebaseAppCheck;\nimport com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory;"
    )
    main_text = main_text.replace(
        "    public void onCreate(android.os.Bundle savedInstanceState) {",
        "    public void onCreate(android.os.Bundle savedInstanceState) {\n        FirebaseApp.initializeApp(this);\n        FirebaseAppCheck.getInstance().installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance());"
    )
main.write_text(main_text)

print("Installed native updater plus Firebase App Check Play Integrity bridge.")
