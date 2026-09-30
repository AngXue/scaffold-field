#!/usr/bin/env bash
#
# Runs the repo-local adb.
#
# adb keeps its authentication keys in $HOME/.android, which is outside this
# project and therefore blocked. Pointing HOME at .toolchain/adb-home keeps the
# keys (and the adb server's state) inside the repository.
#
# Usage: bash scripts/adb.sh devices
#        bash scripts/adb.sh connect 192.168.31.15:33203
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADB="$ROOT/.toolchain/android-sdk/platform-tools/adb"

if [ ! -x "$ADB" ]; then
  echo "adb not found. Run: npm run android:setup" >&2
  exit 1
fi

export HOME="$ROOT/.toolchain/adb-home"
mkdir -p "$HOME"

exec "$ADB" "$@"
