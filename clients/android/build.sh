#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
: "${ANDROID_PLATFORM:?设置为 Android 35 平台目录（包含 android.jar）}"
: "${ANDROID_TOOLS:?设置为 Android build-tools 35.0.0 目录}"
: "${FIRSTMOVE_KEYSTORE:?设置为本地签名密钥库路径}"
: "${FIRSTMOVE_STORE_PASS:?设置密钥库密码}"
export PATH="${JAVA_HOME:?需要 JDK 17}/bin:$PATH"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
out="$root/dist/FirstMove-0.3.2-android.apk"
mkdir -p "$tmp/res/drawable-nodpi" "$tmp/classes" "$tmp/dex" "$root/dist"
cp "$root/clients/icons/app-512.png" "$tmp/res/drawable-nodpi/icon.png"
"$ANDROID_TOOLS/aapt2" compile --dir "$tmp/res" -o "$tmp/res.zip"
"$ANDROID_TOOLS/aapt2" link -I "$ANDROID_PLATFORM/android.jar" --manifest "$root/clients/android/AndroidManifest.xml" -o "$tmp/base.apk" "$tmp/res.zip"
javac --release 8 -encoding UTF-8 -classpath "$ANDROID_PLATFORM/android.jar" -d "$tmp/classes" "$root/clients/android/src/io/github/yraguo/firstmove/MainActivity.java"
jar cf "$tmp/classes.jar" -C "$tmp/classes" .
"$ANDROID_TOOLS/d8" --release --min-api 24 --lib "$ANDROID_PLATFORM/android.jar" --output "$tmp/dex" "$tmp/classes.jar"
(cd "$tmp/dex" && zip -q "$tmp/base.apk" classes.dex)
"$ANDROID_TOOLS/zipalign" -f 4 "$tmp/base.apk" "$tmp/aligned.apk"
"$ANDROID_TOOLS/apksigner" sign --ks "$FIRSTMOVE_KEYSTORE" --ks-key-alias firstmove --ks-pass env:FIRSTMOVE_STORE_PASS --out "$tmp/signed.apk" "$tmp/aligned.apk"
"$ANDROID_TOOLS/apksigner" verify --verbose --print-certs "$tmp/signed.apk"
cp "$tmp/signed.apk" "$out"
