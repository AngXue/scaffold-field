#!/usr/bin/env bash
#
# Builds the web bundle and packages it into an Android APK.
#
# All toolchain paths live under .toolchain/, so this needs no sudo and writes
# nothing outside the repository.
#
# Usage:
#   bash scripts/build-apk.sh            # debug APK (default)
#   bash scripts/build-apk.sh release    # release APK
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN="$ROOT/.toolchain"

VARIANT="$(printf '%s' "${1:-debug}" | tr '[:upper:]' '[:lower:]')"
case "$VARIANT" in
  debug)
    GRADLE_TASK="assembleDebug"
    APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
    ;;
  release)
    GRADLE_TASK="assembleRelease"
    APK_PATH="app/build/outputs/apk/release/app-release.apk"
    ;;
  *)
    echo "Unknown variant '$VARIANT'. Use 'debug' or 'release'." >&2
    exit 1
    ;;
esac

if [ ! -x "$TOOLCHAIN/jdk/Contents/Home/bin/java" ] || [ ! -d "$TOOLCHAIN/android-sdk/platforms/android-36" ]; then
  echo "Android toolchain not found. Run this first:" >&2
  echo "  bash scripts/setup-android-toolchain.sh" >&2
  exit 1
fi

export JAVA_HOME="$TOOLCHAIN/jdk/Contents/Home"
export ANDROID_HOME="$TOOLCHAIN/android-sdk"
export ANDROID_USER_HOME="$TOOLCHAIN/android-user"
export GRADLE_USER_HOME="$TOOLCHAIN/gradle-home"
export PATH="$JAVA_HOME/bin:$PATH"
mkdir -p "$ANDROID_USER_HOME" "$GRADLE_USER_HOME"

echo "==> Building web bundle"
cd "$ROOT"
npm run build

echo "==> Syncing Capacitor"
npx cap sync android

echo "==> Gradle $GRADLE_TASK"
cd "$ROOT/android"
chmod +x ./gradlew
./gradlew "$GRADLE_TASK" --no-daemon

APK="$ROOT/android/$APK_PATH"
if [ -f "$APK" ]; then
  echo
  echo "APK built: $APK"
  ls -lh "$APK"
else
  echo "Expected APK not found at $APK" >&2
  exit 1
fi
