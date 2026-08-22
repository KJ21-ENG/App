#!/usr/bin/env bash
set -euo pipefail

export PATH="$ANDROID_SDK_ROOT/platform-tools:$PATH"
EVIDENCE="$GITHUB_WORKSPACE/android-regression-evidence"
APK="$(find /tmp/apk/extracted -type f -name '*.apk' -print -quit)"
AAPT="$(find "$ANDROID_SDK_ROOT/build-tools" -type f -name aapt -print | sort -V | tail -1)"
test -x "$AAPT"
command -v adb

nohup "$ANDROID_SDK_ROOT/emulator/emulator" \
  -avd pr93877 \
  -no-window \
  -noaudio \
  -no-boot-anim \
  -no-snapshot \
  -wipe-data \
  -accel on \
  -gpu swiftshader_indirect \
  -camera-back none \
  -camera-front none \
  -memory 4096 \
  > "$EVIDENCE/emulator-console.txt" 2>&1 &
EMULATOR_PID=$!
echo "$EMULATOR_PID" > "$EVIDENCE/emulator.pid"

sleep 8
if ! kill -0 "$EMULATOR_PID" 2>/dev/null; then
  echo 'Emulator exited during startup.' >&2
  cat "$EVIDENCE/emulator-console.txt" >&2 || true
  exit 1
fi

if ! timeout 180 adb wait-for-device; then
  echo 'Timed out waiting for an ADB device.' >&2
  ps -ef > "$EVIDENCE/processes-on-boot-timeout.txt" || true
  cat "$EVIDENCE/emulator-console.txt" >&2 || true
  exit 1
fi

booted=''
for attempt in $(seq 1 120); do
  booted="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
  if [ "$booted" = '1' ]; then
    break
  fi
  sleep 2
done
if [ "$booted" != '1' ]; then
  echo 'ADB connected, but Android did not finish booting.' >&2
  adb shell getprop > "$EVIDENCE/getprop-on-boot-timeout.txt" 2>&1 || true
  cat "$EVIDENCE/emulator-console.txt" >&2 || true
  exit 1
fi

adb shell input keyevent 82 || true
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0

"$AAPT" dump badging "$APK" > "$EVIDENCE/apk-badging.txt"
PACKAGE="$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" "$EVIDENCE/apk-badging.txt" | head -1)"
ACTIVITY="$(sed -n "s/^launchable-activity: name='\([^']*\)'.*/\1/p" "$EVIDENCE/apk-badging.txt" | head -1)"
test -n "$PACKAGE"
printf 'package=%s\nactivity=%s\n' "$PACKAGE" "$ACTIVITY" | tee "$EVIDENCE/app-identifiers.txt"

adb install -r -g "$APK" 2>&1 | tee "$EVIDENCE/adb-install.txt"
adb shell pm list packages -f | sort > "$EVIDENCE/packages.txt"
adb shell dumpsys package "$PACKAGE" > "$EVIDENCE/package-dumpsys.txt"
adb logcat -c

{
  echo '=== run-as probe ==='
  adb shell run-as "$PACKAGE" sh -c 'id; pwd; find . -maxdepth 3 \( -type f -o -type d \) -print | sort | head -400' || true
  echo '=== package paths ==='
  adb shell pm path "$PACKAGE" || true
} > "$EVIDENCE/run-as-probe.txt" 2>&1

adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 > "$EVIDENCE/launch.txt" 2>&1 || true
sleep 25
adb exec-out screencap -p > "$EVIDENCE/01-initial-launch.png"
adb shell uiautomator dump /sdcard/initial-window.xml >/dev/null 2>&1 || true
adb pull /sdcard/initial-window.xml "$EVIDENCE/01-initial-window.xml" >/dev/null 2>&1 || true
adb shell dumpsys activity activities > "$EVIDENCE/01-activities.txt"

adb shell am start -W -a android.intent.action.VIEW -d 'new-expensify://settings/troubleshoot' -p "$PACKAGE" > "$EVIDENCE/deeplink-troubleshoot.txt" 2>&1 || true
sleep 15
adb exec-out screencap -p > "$EVIDENCE/02-troubleshoot-deeplink.png"
adb shell uiautomator dump /sdcard/troubleshoot-window.xml >/dev/null 2>&1 || true
adb pull /sdcard/troubleshoot-window.xml "$EVIDENCE/02-troubleshoot-window.xml" >/dev/null 2>&1 || true
adb shell dumpsys activity activities > "$EVIDENCE/02-activities.txt"

adb shell input keyevent 4 || true
sleep 3
adb shell am force-stop "$PACKAGE" || true
adb shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >> "$EVIDENCE/relaunch.txt" 2>&1 || true
sleep 12
adb exec-out screencap -p > "$EVIDENCE/03-relaunch.png"
adb shell uiautomator dump /sdcard/relaunch-window.xml >/dev/null 2>&1 || true
adb pull /sdcard/relaunch-window.xml "$EVIDENCE/03-relaunch-window.xml" >/dev/null 2>&1 || true

adb logcat -d -v threadtime > "$EVIDENCE/logcat-full.txt"
grep -Eai 'FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|SIG(SEGV|ABRT)|ErrorBoundary|Unhandled|TypeError|ReferenceError|Invariant Violation' "$EVIDENCE/logcat-full.txt" > "$EVIDENCE/logcat-important.txt" || true
adb shell dumpsys meminfo "$PACKAGE" > "$EVIDENCE/meminfo.txt" || true
adb shell dumpsys gfxinfo "$PACKAGE" > "$EVIDENCE/gfxinfo.txt" || true

{
  echo "package=$PACKAGE"
  echo "activity=$ACTIVITY"
  echo "initial_xml=$(test -s "$EVIDENCE/01-initial-window.xml" && echo yes || echo no)"
  echo "troubleshoot_xml=$(test -s "$EVIDENCE/02-troubleshoot-window.xml" && echo yes || echo no)"
  echo "important_log_lines=$(wc -l < "$EVIDENCE/logcat-important.txt")"
} | tee "$EVIDENCE/probe-summary.txt"
