#!/usr/bin/env bash
#
# bump-version.sh — bump the BipolarBear app version across BOTH repos at once.
#
# Unified scheme: build number N  ->  marketing version "1.N".
# Single command instead of hand-editing the web repo and the native repo
# separately (which is how they drifted apart before).
#
# Usage:   scripts/bump-version.sh <buildNumber>
#   e.g.   scripts/bump-version.sh 13      # -> version 1.13, build 13
#
# Native repo path defaults to ~/Github/UNISIM/Bipolar_Bear_Mobile/bipolarbear-native
# (see local notes). Override:
#          NATIVE_REPO=/path/to/native scripts/bump-version.sh 13
#
# It edits files only — it does NOT commit, push, rsync, or cap-sync. Review the
# printed diffs, then commit in both repos and run the usual release steps
# (rsync www -> npx cap sync -> Xcode / Android Studio build) from your local notes.
#
set -euo pipefail

BUILD="${1:?Usage: bump-version.sh <buildNumber>   (e.g. 13 -> v1.13 build 13)}"
[[ "$BUILD" =~ ^[0-9]+$ ]] || { echo "error: build number must be an integer, got '$BUILD'"; exit 1; }
VER="1.$BUILD"

WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Locate the native repo. Order: explicit NATIVE_REPO override, then the sibling
# layout next to the web repo (works on Windows/D: where $HOME is on C:), then the
# documented home-dir path (macOS). First existing candidate wins.
_default_native() {
  local c
  for c in \
    "$WEB/../Bipolar_Bear_Mobile/bipolarbear-native" \
    "$HOME/Github/UNISIM/Bipolar_Bear_Mobile/bipolarbear-native" ; do
    [[ -d "$c" ]] && { (cd "$c" && pwd); return; }
  done
  echo "$HOME/Github/UNISIM/Bipolar_Bear_Mobile/bipolarbear-native"  # for the error below
}
NATIVE="${NATIVE_REPO:-$(_default_native)}"
[[ -d "$NATIVE" ]] || { echo "error: native repo not found at '$NATIVE' (set NATIVE_REPO=...)"; exit 1; }

PBX="$NATIVE/ios/App/BipolarBear.xcodeproj/project.pbxproj"   # main app + widget, Debug+Release
GRADLE="$NATIVE/android/app/build.gradle"
BRAND="$WEB/js/shared/brand-config.js"
SW="$WEB/service-worker.js"
for f in "$PBX" "$GRADLE" "$BRAND" "$SW"; do
  [[ -f "$f" ]] || { echo "error: expected file missing: $f"; exit 1; }
done

# Edit in place; abort if the pattern matched nothing, so a renamed/moved field
# surfaces loudly instead of silently no-op'ing. Uses a temp file + copy-back
# instead of `sed -i` so it's portable across GNU sed (Linux/Git-Bash on Windows)
# and BSD sed (macOS), which disagree on `-i`'s argument. Copy-back (not mv)
# preserves the original file's permissions/line endings.
bump() { # <file> <grep-ere-to-confirm-present> <sed-ere>
  local f="$1" check="$2" expr="$3" tmp
  grep -Eq "$check" "$f" || { echo "error: pattern not found in $f -> /$check/"; exit 1; }
  tmp="$(mktemp)"
  sed -E "$expr" "$f" > "$tmp" && cat "$tmp" > "$f"
  rm -f "$tmp"
}

# ── iOS (4 entries each: main app + widget extension, Debug + Release) ──
bump "$PBX"    'MARKETING_VERSION = [0-9.]+;'      "s/(MARKETING_VERSION = )[0-9.]+;/\\1$VER;/g"
bump "$PBX"    'CURRENT_PROJECT_VERSION = [0-9]+;' "s/(CURRENT_PROJECT_VERSION = )[0-9]+;/\\1$BUILD;/g"
# ── Android ──
bump "$GRADLE" 'versionName "[0-9.]+"'             "s/(versionName )\"[0-9.]+\"/\\1\"$VER\"/"
bump "$GRADLE" 'versionCode [0-9]+'                "s/(versionCode )[0-9]+/\\1$BUILD/"
# ── Web: app version shown in UI ──
bump "$BRAND"  "_APP_VERSION = '[0-9.]+'"          "s/(_APP_VERSION = ')[0-9.]+'/\\1$VER'/"
# ── Web: service-worker cache name (independent counter, +1 each release) ──
CUR="$(grep -oE 'bipolarbear-v[0-9]+' "$SW" | head -1 | grep -oE '[0-9]+')"
NEXT=$((CUR + 1))
bump "$SW"     "bipolarbear-v$CUR" "s/bipolarbear-v$CUR/bipolarbear-v$NEXT/g"

echo "Bumped to $VER (build $BUILD).  service-worker cache: bipolarbear-v$CUR -> v$NEXT"
echo
echo "=== Bipolar_Bear (web) — $WEB ==="
git -C "$WEB" --no-pager diff --stat
echo "=== bipolarbear-native — $NATIVE ==="
git -C "$NATIVE" --no-pager diff --stat
echo
echo "Next: add a CACHE_NAME changelog note in service-worker.js, commit BOTH repos,"
echo "then rsync www -> npx cap sync -> build (see your local release notes)."
