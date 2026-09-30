#!/usr/bin/env bash
#
# Downloads the JDK and Android SDK needed to build the APK into .toolchain/.
#
# Everything stays inside the repository, so this needs no sudo and does not
# touch /opt/homebrew, ~/Library/Android/sdk or ~/.gradle. Re-running is safe:
# already-installed pieces are skipped.
#
# Usage: bash scripts/setup-android-toolchain.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN="$ROOT/.toolchain"
DOWNLOADS="$TOOLCHAIN/downloads"
SDK_DIR="$TOOLCHAIN/android-sdk"
USER_DIR="$TOOLCHAIN/android-user"

JDK_DIR="$TOOLCHAIN/jdk"
JDK_URL="https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jdk/hotspot/normal/eclipse"

# Android SDK command-line tools. Bump this and CMDLINE_URL together when needed.
CMDLINE_URL="https://dl.google.com/android/repository/commandlinetools-mac-15641748_latest.zip"

# Packages the Capacitor Android project asks for (see android/variables.gradle).
SDK_PACKAGES=("platform-tools" "platforms;android-36" "build-tools;36.0.0")

# dl.google.com throttles long single connections hard; fetching a file as
# several ranges in parallel is dramatically faster.
fetch_parallel() {
  local url="$1" out="$2" connections="${3:-6}"

  local total
  total="$(curl -sIL --max-time 60 "$url" \
    | tr -d '\r' \
    | awk 'BEGIN{IGNORECASE=1} /^content-length:/{v=$2} END{print v}')"

  if [ -z "$total" ]; then
    echo "  -> size unknown, falling back to a single connection"
    curl -L --fail -o "$out" "$url"
    return
  fi

  local chunk=$(( (total + connections - 1) / connections ))
  local parts=()
  local pids=()

  for ((i = 0; i < connections; i++)); do
    local start=$(( i * chunk ))
    local end=$(( start + chunk - 1 ))
    if [ "$end" -ge "$total" ]; then end=$(( total - 1 )); fi
    if [ "$start" -gt "$end" ]; then break; fi

    local part="$DOWNLOADS/part-$i"
    parts+=("$part")
    curl -sL --fail --max-time 900 -r "$start-$end" -o "$part" "$url" &
    pids+=("$!")
  done

  local pid
  for pid in "${pids[@]}"; do wait "$pid"; done

  cat "${parts[@]}" > "$out"
  rm -f "${parts[@]}"

  local actual
  actual="$(stat -f%z "$out")"
  if [ "$actual" != "$total" ]; then
    echo "ERROR: $out is $actual bytes, expected $total" >&2
    rm -f "$out"
    return 1
  fi
  echo "  -> $(basename "$out") ($total bytes)"
}

mkdir -p "$DOWNLOADS" "$USER_DIR"

# --- JDK ---------------------------------------------------------------------
if [ -x "$JDK_DIR/Contents/Home/bin/java" ]; then
  echo "JDK already present, skipping."
else
  echo "Downloading Temurin JDK 21..."
  rm -rf "$JDK_DIR" "$DOWNLOADS/jdk21.tar.gz"
  curl -L --fail --max-time 1800 -o "$DOWNLOADS/jdk21.tar.gz" "$JDK_URL"
  rm -rf "$DOWNLOADS/jdk-extract"
  mkdir -p "$DOWNLOADS/jdk-extract"
  tar -xzf "$DOWNLOADS/jdk21.tar.gz" -C "$DOWNLOADS/jdk-extract"
  # The macOS archive nests the real JDK under <name>/Contents/Home.
  mv "$(find "$DOWNLOADS/jdk-extract" -maxdepth 1 -mindepth 1 -type d | head -1)" "$JDK_DIR"
  rm -rf "$DOWNLOADS/jdk-extract" "$DOWNLOADS/jdk21.tar.gz"
  "$JDK_DIR/Contents/Home/bin/java" -version
fi

export JAVA_HOME="$JDK_DIR/Contents/Home"
export ANDROID_HOME="$SDK_DIR"
export ANDROID_USER_HOME="$USER_DIR"
export PATH="$JAVA_HOME/bin:$PATH"

# --- Android command-line tools ---------------------------------------------
SDKMANAGER="$SDK_DIR/cmdline-tools/latest/bin/sdkmanager"
if [ -x "$SDKMANAGER" ]; then
  echo "Android command-line tools already present, skipping."
else
  echo "Downloading Android command-line tools..."
  rm -f "$DOWNLOADS/cmdline-tools.zip"
  fetch_parallel "$CMDLINE_URL" "$DOWNLOADS/cmdline-tools.zip"

  if ! unzip -tq "$DOWNLOADS/cmdline-tools.zip" > /dev/null; then
    echo "ERROR: downloaded command-line tools archive is corrupt" >&2
    exit 1
  fi

  rm -rf "$DOWNLOADS/cmdline-tools-extract"
  mkdir -p "$DOWNLOADS/cmdline-tools-extract" "$SDK_DIR/cmdline-tools"
  unzip -q "$DOWNLOADS/cmdline-tools.zip" -d "$DOWNLOADS/cmdline-tools-extract"
  rm -rf "$SDK_DIR/cmdline-tools/latest"
  mv "$DOWNLOADS/cmdline-tools-extract/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
  rm -rf "$DOWNLOADS/cmdline-tools-extract"
fi

# --- SDK packages ------------------------------------------------------------
echo "Installing SDK packages: ${SDK_PACKAGES[*]}"
# sdkmanager asks for licence acceptance; nothing here is redistributed.
yes | "$SDKMANAGER" --sdk_root="$SDK_DIR" --install "${SDK_PACKAGES[@]}" > /dev/null
yes | "$SDKMANAGER" --sdk_root="$SDK_DIR" --licenses > /dev/null

# AGP also reads the SDK location from local.properties.
printf 'sdk.dir=%s\n' "$SDK_DIR" > "$ROOT/android/local.properties"

# --- Signing key -------------------------------------------------------------
# AGP would otherwise create its debug keystore in ~/.android, outside the
# project. An in-repo key keeps the build self-contained and the signature stable
# across upgrades.
KEYSTORE="$TOOLCHAIN/keystore/scaffold-field.jks"
if [ -f "$KEYSTORE" ]; then
  echo "Signing key already present, skipping."
else
  echo "Generating local signing key..."
  mkdir -p "$TOOLCHAIN/keystore"
  "$JAVA_HOME/bin/keytool" -genkeypair \
    -keystore "$KEYSTORE" \
    -alias scaffold-field \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass scaffoldfield -keypass scaffoldfield \
    -dname "CN=Scaffold Field, OU=Field Tool, O=Scaffold Field, L=Site, ST=Site, C=CN"
fi

# storeFile is relative to the android/ project directory.
cat > "$ROOT/android/keystore.properties" <<'EOF'
# Local signing key for the Android build, generated by
# scripts/setup-android-toolchain.sh and gitignored.
storeFile=../.toolchain/keystore/scaffold-field.jks
storePassword=scaffoldfield
keyAlias=scaffold-field
keyPassword=scaffoldfield
EOF

echo
echo "Toolchain ready:"
echo "  JAVA_HOME=$JAVA_HOME"
echo "  ANDROID_HOME=$ANDROID_HOME"
echo
echo "Build the APK with: npm run apk"
