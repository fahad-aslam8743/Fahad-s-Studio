#!/usr/bin/env bash
set -eu

APK="android-apk/app-debug.apk"
test -f "$APK" || { echo "Downloaded debug APK not found: $APK"; exit 1; }

adb wait-for-device
adb install -r "$APK"
adb shell am force-stop com.irfan.companion || true
adb logcat -c || true

# A WebView-heavy app can take longer than am start -W's own timeout.
# A timeout from am start -W is not accepted as a pass: require a live process below.
adb shell am start -W -n com.irfan.companion/.MainActivity || true

running=0
for attempt in $(seq 1 20); do
  if adb shell pidof com.irfan.companion 2>/dev/null | tr -d '\r' | grep -Eq '[0-9]+'; then
    running=1
    break
  fi
  sleep 2
done

if [ "$running" -ne 1 ]; then
  echo "Jarvis companion process did not stay running."
  adb logcat -d -t 1500 || true
  exit 1
fi

crash_lines="$(adb logcat -d -t 1500 2>/dev/null | grep -E 'FATAL EXCEPTION|Process: com\.irfan\.companion' || true)"
if [ -n "$crash_lines" ]; then
  echo "Android crash marker found after launch:"
  printf '%s\n' "$crash_lines"
  exit 1
fi

# Screenshot is diagnostic only. A flaky screenshot/ADB transport must not
# turn a successful install + live process + no-crash check into a false failure.
if adb shell screencap -p /sdcard/irfan-home.png && adb pull /sdcard/irfan-home.png android-emulator-home.png; then
  echo "Captured emulator screenshot."
else
  echo "Screenshot unavailable; install/process/crash checks passed."
fi

echo "Android APK installation and process smoke test passed."
