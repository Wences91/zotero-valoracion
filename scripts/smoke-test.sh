#!/usr/bin/env bash
# Smoke test: installs the plugin in a real Zotero running on a throwaway profile and data
# directory, drives it through the UI and reports the result. Your own profile and library
# are not touched, and it can run while your Zotero is open. macOS only.
#
#   scripts/smoke-test.sh [locale]              run the checks (default locale: en-US)
#   scripts/smoke-test.sh <locale> --shots DIR  save a screenshot with sample data into DIR
#
# Set ZOTERO_APP to test against a Zotero installed somewhere other than /Applications.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
LOCALE="${1:-en-US}"
SHOTS=""
if [ "${2:-}" = "--shots" ]; then
  mkdir -p "$3"
  SHOTS="$(cd "$3" && pwd)"
fi
APP="${ZOTERO_APP:-/Applications/Zotero.app}"

XPI="$ROOT/$(./scripts/build.sh | sed -n 1p)"
WORK="$(mktemp -d)"
PROFILE="$WORK/profile"
cleanup() {
  # The driver quits Zotero itself; give it a moment, then stop the test instance if it is still up
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f -- "-profile $PROFILE" > /dev/null || break
    sleep 1
  done
  pkill -f -- "-profile $PROFILE" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$PROFILE/extensions" "$WORK/data"
cp "$XPI" "$PROFILE/extensions/valoracion@wences91.github.io.xpi"
(cd tests/smoke/driver && find . -mindepth 1 | LC_ALL=C sort | zip -q -X -@ "$PROFILE/extensions/valoracion-test@local.test.xpi")

# Besides loading the two plugins, these keep the temporary instance from doing anything
# outside its own folders: no first-run page, no update checks, no word processor plugin
# installers, and a connector port that does not clash with a Zotero that is already open.
cat > "$PROFILE/user.js" <<PREFS
user_pref("intl.locale.requested", "$LOCALE");
user_pref("valoracionTest.out", "$WORK/result.json");
user_pref("valoracionTest.shots", "$SHOTS");
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.sideloadScopes", 15);
user_pref("extensions.startupScanScopes", 15);
user_pref("extensions.update.enabled", false);
user_pref("app.update.auto", false);
user_pref("app.update.disabledForTesting", true);
user_pref("extensions.zotero.firstRun2", false);
user_pref("extensions.zotero.firstRunGuidance", false);
user_pref("extensions.zotero.showPostUpgradeBanner", false);
user_pref("extensions.zotero.automaticScraperUpdates", false);
user_pref("extensions.zotero.httpServer.port", 23931);
user_pref("extensions.zotero.sync.autoSync", false);
user_pref("extensions.zotero.retractions.enabled", false);
user_pref("extensions.zoteroMacWordIntegration.skipInstallation", true);
user_pref("extensions.zoteroOpenOfficeIntegration.skipInstallation", true);
PREFS

open -g -n -a "$APP" --args -profile "$PROFILE" -datadir "$WORK/data" -no-remote

for _ in $(seq 1 170); do
  [ -f "$WORK/result.txt" ] && break
  sleep 1
done
if [ ! -f "$WORK/result.txt" ]; then
  echo "No result: Zotero did not finish the test run" >&2
  exit 1
fi
cat "$WORK/result.txt"
! grep -q -E '^(FAIL|FATAL)' "$WORK/result.txt"
