#!/usr/bin/env python3
from pathlib import Path
import re

manifest = Path("android/app/src/main/AndroidManifest.xml")
if not manifest.is_file():
    raise SystemExit("Android manifest not found; Capacitor project generation must run first.")

xml = manifest.read_text(encoding="utf-8")
if 'android:scheme="nexora"' in xml and 'android:host="episode"' in xml:
    print("NEXORA episode deep-link intent filter already present.")
    raise SystemExit(0)

activity = re.search(r'<activity\b[^>]*android:name="[^"]*MainActivity"[^>]*>', xml)
if not activity:
    raise SystemExit("Could not locate the Capacitor MainActivity declaration.")
closing = xml.find("</activity>", activity.end())
if closing < 0:
    raise SystemExit("Could not locate the MainActivity closing tag.")

intent_filter = """
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="nexora" android:host="episode" />
            </intent-filter>
"""
xml = xml[:closing] + intent_filter + xml[closing:]
manifest.write_text(xml, encoding="utf-8")
assert 'android:scheme="nexora"' in xml and 'android:host="episode"' in xml
print("Installed the nexora://episode Android intent filter.")
