#!/usr/bin/env bash
set -euo pipefail
export PATH="$ANDROID_SDK_ROOT/platform-tools:$PATH"
mkdir -p "$HOME/.android"
adb start-server
adb devices -l
exec python3 .chatgpt-regression/seeded_table_regression.py
