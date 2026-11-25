#!/usr/bin/env bash
set -euo pipefail
sdk="$ANDROID_HOME"
tools="$(find "$sdk/build-tools" -name aapt2 -printf '%h\n' | sort -V | tail -1)"
platform="$(find "$sdk/platforms" -name android.jar | sort -V | tail -1)"
mkdir -p apk-work/assets/web apk-work/res/drawable apk-work/classes apk-work/dex dist
cp -r index.html js plugins manifest.json sw.js icon-512.png apk-work/assets/web/
cp icon-192.png.png apk-work/assets/web/icon-192.png
cp icon-512.png apk-work/res/drawable/app_icon.png
cp android-apk/android-bridge.js apk-work/assets/web/
python3 - <<'PY'
from pathlib import Path
p = Path('apk-work/assets/web/index.html')
s = p.read_text()
i = s.index('<script src="./plugins/os-notify.js')
p.write_text(s[:i] + '<script src="./android-bridge.js"></script>\n    ' + s[i:])
p = Path('apk-work/assets/web/plugins/os-notify.js')
s = p.read_text()
needle = "async function getActiveSwRegistration() {"
if needle in s:
    p.write_text(s.replace(needle, needle + "\n        if (window.MouxiAndroid) return null;", 1))
else:
    raise ValueError('Missing notification registration integration point')
PY
"$tools/aapt2" compile --dir apk-work/res -o apk-work/resources.zip
"$tools/aapt2" link -o apk-work/unsigned.apk -I "$platform" --manifest android-apk/AndroidManifest.xml -A apk-work/assets apk-work/resources.zip
javac --release 8 -cp "$platform" -d apk-work/classes android-apk/MainActivity.java
jar cf apk-work/classes.jar -C apk-work/classes .
"$tools/d8" --lib "$platform" --min-api 26 --output apk-work/dex apk-work/classes.jar
(cd apk-work/dex && zip -q ../unsigned.apk classes.dex)
"$tools/zipalign" -f 4 apk-work/unsigned.apk apk-work/aligned.apk
cp apk-work/aligned.apk dist/Mouxi-Android-0.1.1-unsigned.apk
cp "$tools/lib/apksigner.jar" dist/apksigner.jar
"$tools/zipalign" -c 4 dist/Mouxi-Android-0.1.1-unsigned.apk
"$tools/aapt2" dump badging dist/Mouxi-Android-0.1.1-unsigned.apk | sed -n '1,15p'
unzip -tq dist/Mouxi-Android-0.1.1-unsigned.apk
sha256sum dist/*
