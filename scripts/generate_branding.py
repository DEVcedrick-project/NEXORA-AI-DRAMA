from pathlib import Path
import shutil
import re
import xml.etree.ElementTree as ET
import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MARK = ROOT / "www/assets/nexora-mark.svg"
SPLASH = ROOT / "resources/branding/nexora-splash.svg"
ANDROID_RES = ROOT / "android/app/src/main/res"
PLAY_STORE_ASSETS = ROOT / "resources/play-store"

if not MARK.exists() or not SPLASH.exists():
    raise SystemExit("Branding SVG source files are missing")

ANDROID_RES.mkdir(parents=True, exist_ok=True)
PLAY_STORE_ASSETS.mkdir(parents=True, exist_ok=True)
cairosvg.svg2png(
    url=str(MARK),
    write_to=str(PLAY_STORE_ASSETS / "icon-512.png"),
    output_width=512,
    output_height=512,
)
icon_sizes = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for density, size in icon_sizes.items():
    folder = ANDROID_RES / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    out = folder / "ic_launcher.png"
    cairosvg.svg2png(url=str(MARK), write_to=str(out), output_width=size, output_height=size)
    shutil.copyfile(out, folder / "ic_launcher_round.png")

# Android adaptive icon foreground uses a density-independent drawable.
adaptive_dir = ANDROID_RES / "drawable-nodpi"
adaptive_dir.mkdir(parents=True, exist_ok=True)
cairosvg.svg2png(url=str(MARK), write_to=str(adaptive_dir / "ic_launcher_foreground.png"), output_width=432, output_height=432)
anydpi = ANDROID_RES / "mipmap-anydpi-v26"
anydpi.mkdir(parents=True, exist_ok=True)
for name in ("ic_launcher", "ic_launcher_round"):
    (anydpi / f"{name}.xml").write_text(
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '  <background android:drawable="@color/nexora_icon_background" />\n'
        '  <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
        '</adaptive-icon>\n', encoding="utf-8")

values = ANDROID_RES / "values"
values.mkdir(parents=True, exist_ok=True)
(values / "nexora_brand_colors.xml").write_text(
    '<resources>\n  <color name="nexora_icon_background">#090512</color>\n'
    '  <color name="nexora_splash_background">#090512</color>\n</resources>\n', encoding="utf-8")

# Native splash contains only the emblem and the NEXORA AI DRAMA name.
drawable = ANDROID_RES / "drawable"
drawable.mkdir(parents=True, exist_ok=True)
splash_png = drawable / "splash.png"
cairosvg.svg2png(url=str(SPLASH), write_to=str(splash_png), output_width=1080, output_height=1920)
mark_png = drawable / "nexora-mark-temp.png"
cairosvg.svg2png(url=str(MARK), write_to=str(mark_png), output_width=510, output_height=510)
base = Image.open(splash_png).convert("RGBA")
base.alpha_composite(Image.open(mark_png).convert("RGBA"), (285, 500))
base.save(splash_png, optimize=True)
mark_png.unlink()

manifest = ROOT / "android/app/src/main/AndroidManifest.xml"
if manifest.exists():
    manifest_text = manifest.read_text(encoding="utf-8")
    def apply_launcher_icons(match):
        tag = match.group(0)
        for attr, value in (
            ("icon", "@mipmap/ic_launcher"),
            ("roundIcon", "@mipmap/ic_launcher_round"),
        ):
            pattern = rf'android:{attr}="[^"]*"'
            replacement = f'android:{attr}="{value}"'
            if re.search(pattern, tag):
                tag = re.sub(pattern, replacement, tag, count=1)
            else:
                tag = tag[:-1] + f' {replacement}>'
        return tag
    manifest_text, count = re.subn(r"<application\b[^>]*>", apply_launcher_icons, manifest_text, count=1)
    if count != 1:
        raise SystemExit("Could not find the Android application tag to set the launcher icon")
    manifest.write_text(manifest_text, encoding="utf-8")

strings = values / "strings.xml"
if strings.exists():
    tree = ET.parse(strings)
    root = tree.getroot()
    app_name = root.find("string[@name='app_name']")
    if app_name is None:
        app_name = ET.SubElement(root, "string", {"name": "app_name"})
    app_name.text = "NEXORA AI DRAMA"
    tree.write(strings, encoding="utf-8", xml_declaration=True)
else:
    strings.write_text('<resources>\n  <string name="app_name">NEXORA AI DRAMA</string>\n</resources>\n', encoding="utf-8")

print("Generated NEXORA launcher icons, adaptive icons, and native splash assets.")
