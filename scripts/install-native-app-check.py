from pathlib import Path
import re
import shutil

source = Path("scripts/android/NexoraAppCheckPlugin.java")
target_dir = Path("android/app/src/main/java/com/devcedrick/nexoraaidrama")
target_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(source, target_dir / source.name)

gradle = Path("android/app/build.gradle")
if not gradle.exists():
    raise SystemExit("Android app Gradle file not found")
text = gradle.read_text()
dependency = "implementation 'com.google.firebase:firebase-appcheck-playintegrity:19.0.1'"
if dependency not in text:
    match = re.search(r"dependencies\\s*\\{", text)
    if not match:
        raise SystemExit("Could not find Android app dependencies block")
    text = text[:match.end()] + "\\n    " + dependency + text[match.end():]
    gradle.write_text(text)

main = Path("android/app/src/main/java/com/devcedrick/nexoraaidrama/MainActivity.java")
if not main.exists():
    candidates = list(Path("android/app/src/main/java").rglob("MainActivity.java"))
    if len(candidates) != 1:
        raise SystemExit(f"Expected one generated MainActivity.java; found {len(candidates)}")
    main = candidates[0]
source_text = main.read_text()
plugin_import = "import com.devcedrick.nexoraaidrama.NexoraAppCheckPlugin;"
if plugin_import not in source_text:
    source_text = source_text.replace(
        "import com.getcapacitor.BridgeActivity;",
        "import com.getcapacitor.BridgeActivity;\\n" + plugin_import,
        1
    )
registration = "registerPlugin(NexoraAppCheckPlugin.class);"
if registration not in source_text:
    updater_registration = "registerPlugin(NexoraUpdaterPlugin.class);"
    if updater_registration in source_text:
        source_text = source_text.replace(updater_registration, updater_registration + "\\n        " + registration, 1)
    else:
        match = re.search(r"super\\.onCreate\\(savedInstanceState\\);", source_text)
        if not match:
            raise SystemExit("Could not locate MainActivity onCreate for App Check registration")
        source_text = source_text[:match.start()] + registration + "\\n        " + source_text[match.start():]
main.write_text(source_text)

if dependency not in gradle.read_text() or registration not in main.read_text():
    raise SystemExit("Native App Check dependency or Capacitor plugin registration is missing")
print("Installed NEXORA native Firebase App Check bridge with Play Integrity provider.")
