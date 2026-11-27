#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ID="com.devcedrick.nexoraaidrama"
NEW_APK="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is not set}/android/app/build/outputs/apk/release/NEXORA-AI-DRAMA-release.apk"
PREVIOUS_APK="/tmp/NEXORA-previous.apk"
PREVIOUS_METADATA="/tmp/nexora-previous-release.txt"

cd "$GITHUB_WORKSPACE"

if [[ ! -s "$NEW_APK" ]]; then
  echo "::error::New signed APK is missing: $NEW_APK"
  echo "APK files found in build outputs:"
  find "$GITHUB_WORKSPACE/android/app/build/outputs" -maxdepth 5 -type f -name '*.apk' -print 2>/dev/null || true
  exit 1
fi

if [[ ! -s "$GITHUB_WORKSPACE/update.json" ]]; then
  echo "::error::Previous release manifest is missing or empty: $GITHUB_WORKSPACE/update.json"
  exit 1
fi

# update.json still points to the previous published release because publishing
# happens only after this test passes. Validate its URL and digest before download.
python - <<'PY'
import json
import re
from pathlib import Path

manifest = json.loads(Path("update.json").read_text())
version = str(manifest.get("version", "")).removeprefix("v")
url = str(manifest.get("downloadUrl", ""))
sha256 = str(manifest.get("sha256", "")).lower()
release_prefix = "https://github.com/DEVcedrick-project/NEXORA-AI-DRAMA/releases/download/"
if not re.fullmatch(r"\d+\.\d+\.\d+", version):
    raise SystemExit("Previous update.json has no valid semantic version; refusing upgrade test.")
if not url.startswith(release_prefix) or not url.endswith("/NEXORA-AI-DRAMA-release.apk"):
    raise SystemExit("Previous update.json does not point to the official signed APK; refusing upgrade test.")
if not re.fullmatch(r"[0-9a-f]{64}", sha256):
    raise SystemExit("Previous update.json has an invalid SHA-256 digest; refusing upgrade test.")
Path("/tmp/nexora-previous-release.txt").write_text(f"{url}\n{sha256}\n{version}\n")
PY

mapfile -t PREVIOUS < "$PREVIOUS_METADATA"
PREVIOUS_URL="${PREVIOUS[0]}"
PREVIOUS_SHA="${PREVIOUS[1]}"
PREVIOUS_VERSION="${PREVIOUS[2]}"
CURRENT_VERSION="$(node -p "require('./package.json').version")"

if [[ "$(printf '%s\n%s\n' "$PREVIOUS_VERSION" "$CURRENT_VERSION" | sort -V | tail -n 1)" != "$CURRENT_VERSION" || "$PREVIOUS_VERSION" == "$CURRENT_VERSION" ]]; then
  echo "::error::Upgrade test requires a strictly newer app version. Previous release: $PREVIOUS_VERSION; current build: $CURRENT_VERSION."
  echo "Do not rerun a release after update.json already points to the same version; publish a new patch version first."
  exit 1
fi

echo "Downloading previous official signed APK v$PREVIOUS_VERSION..."
curl --fail --location --retry 4 --retry-all-errors --connect-timeout 20 --max-time 240 "$PREVIOUS_URL" -o "$PREVIOUS_APK"
if [[ ! -s "$PREVIOUS_APK" ]]; then
  echo "::error::Previous signed APK download is missing or empty: $PREVIOUS_APK"
  exit 1
fi
printf '%s  %s\n' "$PREVIOUS_SHA" "$PREVIOUS_APK" | sha256sum --check -

BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)"
if [[ -z "$BUILD_TOOLS" || ! -x "$BUILD_TOOLS/aapt" || ! -x "$BUILD_TOOLS/apksigner" ]]; then
  echo "::error::Android build-tools with aapt and apksigner were not found under $ANDROID_HOME/build-tools."
  exit 1
fi

OLD_BADGING="$("$BUILD_TOOLS/aapt" dump badging "$PREVIOUS_APK")"
NEW_BADGING="$("$BUILD_TOOLS/aapt" dump badging "$NEW_APK")"
grep -F "package: name='$PACKAGE_ID'" <<< "$OLD_BADGING"
grep -F "versionName='$PREVIOUS_VERSION'" <<< "$OLD_BADGING"
grep -F "package: name='$PACKAGE_ID'" <<< "$NEW_BADGING"
grep -F "versionName='$CURRENT_VERSION'" <<< "$NEW_BADGING"
"$BUILD_TOOLS/apksigner" verify --verbose "$PREVIOUS_APK"
"$BUILD_TOOLS/apksigner" verify --verbose "$NEW_APK"

# Both builds must be signed by the same permanent Android keystore certificate.
OLD_CERT="$("$BUILD_TOOLS/apksigner" verify --print-certs "$PREVIOUS_APK" | awk '/certificate SHA-256 digest:/ {print $NF; exit}')"
NEW_CERT="$("$BUILD_TOOLS/apksigner" verify --print-certs "$NEW_APK" | awk '/certificate SHA-256 digest:/ {print $NF; exit}')"
if [[ -z "$OLD_CERT" || -z "$NEW_CERT" ]]; then
  echo "::error::Could not read the signing certificate SHA-256 digest from both APKs."
  exit 1
fi
if [[ "$OLD_CERT" != "$NEW_CERT" ]]; then
  echo "::error::New APK signing certificate differs from the previous official release."
  echo "Previous certificate: $OLD_CERT"
  echo "New certificate:      $NEW_CERT"
  exit 1
fi

echo "Installing previous official APK v$PREVIOUS_VERSION..."
adb install "$PREVIOUS_APK"
adb shell monkey -p "$PACKAGE_ID" 1
sleep 3

# Seed app-specific external storage with a unique value. Android package
# replacement must preserve this data; uninstall/reinstall would remove it.
EXTERNAL_FILES="/sdcard/Android/data/$PACKAGE_ID/files"
SENTINEL_FILE="$EXTERNAL_FILES/nexora-inplace-upgrade-sentinel.txt"
SENTINEL="nexora-upgrade-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$CURRENT_VERSION"
adb shell mkdir -p "$EXTERNAL_FILES"
adb shell sh -c "printf '%s\\n' '$SENTINEL' > '$SENTINEL_FILE'"
SAVED_SENTINEL="$(adb shell cat "$SENTINEL_FILE" | tr -d '\r')"
if [[ "$SAVED_SENTINEL" != "$SENTINEL" ]]; then
  echo "::error::Could not seed the app-specific data sentinel before upgrade."
  exit 1
fi

PACKAGE_UID_BEFORE="$(adb shell dumpsys package "$PACKAGE_ID" | awk '/userId=/ {sub(/.*userId=/, ""); print $1; exit}' | tr -d '\r')"
if [[ -z "$PACKAGE_UID_BEFORE" ]]; then
  echo "::error::Could not read the installed app UID before upgrade."
  exit 1
fi

echo "Installing new signed APK v$CURRENT_VERSION over the previous installation..."
adb install -r "$NEW_APK"
adb shell dumpsys package "$PACKAGE_ID" | grep -F "versionName=$CURRENT_VERSION"
adb shell monkey -p "$PACKAGE_ID" 1

RESTORED_SENTINEL="$(adb shell cat "$SENTINEL_FILE" | tr -d '\r')"
if [[ "$RESTORED_SENTINEL" != "$SENTINEL" ]]; then
  echo "::error::App-specific external data sentinel did not survive the in-place APK upgrade."
  exit 1
fi
PACKAGE_UID_AFTER="$(adb shell dumpsys package "$PACKAGE_ID" | awk '/userId=/ {sub(/.*userId=/, ""); print $1; exit}' | tr -d '\r')"
if [[ "$PACKAGE_UID_AFTER" != "$PACKAGE_UID_BEFORE" ]]; then
  echo "::error::Installed app UID changed during upgrade (before=$PACKAGE_UID_BEFORE, after=$PACKAGE_UID_AFTER)."
  exit 1
fi

echo "PASS: v$PREVIOUS_VERSION upgraded in place to v$CURRENT_VERSION with the same signing certificate, unchanged app UID, and preserved app-specific data sentinel."
