#!/usr/bin/env bash
#
# bump-anonymous-version.sh — bump the *Bipolar Anonymous* app build number
# (and optionally its marketing version) in the separate native project.
#
# This is the anonymous-app counterpart to bump-version.sh. They are kept
# separate on purpose:
#   - bump-version.sh        → main app (~/bipolarbear-native), couples
#                              marketing version to build (build N → "1.N"),
#                              and also bumps the SHARED web _APP_VERSION +
#                              service-worker cache.
#   - this script            → anonymous app (~/bipolaranonymous-native),
#                              build number and marketing version are
#                              INDEPENDENT (the App Store listing rides at
#                              "1.0" with the build number incrementing per
#                              upload). It deliberately does NOT touch the web
#                              _APP_VERSION, because that constant is shared by
#                              BOTH apps — bumping it here would silently
#                              re-version the main BipolarBear app too.
#
# Usage:   scripts/bump-anonymous-version.sh <buildNumber> [marketingVersion]
#   e.g.   scripts/bump-anonymous-version.sh 2          # build 2, keep version
#          scripts/bump-anonymous-version.sh 2 1.0      # build 2, version 1.0
#
# Native repo path defaults to ~/bipolaranonymous-native (see local notes).
# Override:  NATIVE_REPO=/path/to/native scripts/bump-anonymous-version.sh 2
#
# Runs on macOS (BSD sed). It edits files only — it does NOT commit, push,
# rsync, or cap-sync. Review the printed diffs, then archive in Xcode per the
# release steps in your local notes.
#
set -euo pipefail

BUILD="${1:?Usage: bump-anonymous-version.sh <buildNumber> [marketingVersion]   (e.g. 2, or 2 1.0)}"
[[ "$BUILD" =~ ^[0-9]+$ ]] || { echo "error: build number must be an integer, got '$BUILD'"; exit 1; }
MARKETING="${2:-}"
if [[ -n "$MARKETING" ]]; then
  [[ "$MARKETING" =~ ^[0-9]+(\.[0-9]+)*$ ]] || { echo "error: marketing version must look like 1.0, got '$MARKETING'"; exit 1; }
fi

NATIVE="${NATIVE_REPO:-$HOME/bipolaranonymous-native}"
[[ -d "$NATIVE" ]] || { echo "error: native repo not found at '$NATIVE' (set NATIVE_REPO=...)"; exit 1; }

# Auto-discover the Xcode project — Capacitor scaffolds ios/App/App.xcodeproj,
# but don't assume the name. Require exactly one match so an unexpected layout
# surfaces loudly instead of editing the wrong file.
shopt -s nullglob
PBX_MATCHES=("$NATIVE"/ios/App/*.xcodeproj/project.pbxproj)
shopt -u nullglob
case "${#PBX_MATCHES[@]}" in
  0) echo "error: no project.pbxproj under $NATIVE/ios/App/*.xcodeproj/"; exit 1 ;;
  1) PBX="${PBX_MATCHES[0]}" ;;
  *) echo "error: multiple .xcodeproj found under $NATIVE/ios/App/ — disambiguate:"; printf '  %s\n' "${PBX_MATCHES[@]}"; exit 1 ;;
esac
GRADLE="$NATIVE/android/app/build.gradle"   # optional — Android may not be set up yet

# Edit in place (BSD/macOS sed); abort if the pattern matched nothing, so a
# renamed/moved field surfaces loudly instead of silently no-op'ing.
bump() { # <file> <grep-ere-to-confirm-present> <sed-ere>
  local f="$1" check="$2" expr="$3"
  grep -Eq "$check" "$f" || { echo "error: pattern not found in $f -> /$check/"; exit 1; }
  sed -i '' -E "$expr" "$f"
}

# ── iOS build number (Debug + Release; +widget if the anon app ever adds one) ──
bump "$PBX" 'CURRENT_PROJECT_VERSION = [0-9]+;' "s/(CURRENT_PROJECT_VERSION = )[0-9]+;/\\1$BUILD;/g"
if [[ -n "$MARKETING" ]]; then
  bump "$PBX" 'MARKETING_VERSION = [0-9.]+;' "s/(MARKETING_VERSION = )[0-9.]+;/\\1$MARKETING;/g"
fi

# ── Android (optional — only if the second native target has been added) ──
if [[ -f "$GRADLE" ]]; then
  bump "$GRADLE" 'versionCode [0-9]+' "s/(versionCode )[0-9]+/\\1$BUILD/"
  [[ -n "$MARKETING" ]] && bump "$GRADLE" 'versionName "[0-9.]+"' "s/(versionName )\"[0-9.]+\"/\\1\"$MARKETING\"/"
  ANDROID_NOTE="android build.gradle"
else
  ANDROID_NOTE="(android skipped — $GRADLE not found)"
fi

echo "Bumped Bipolar Anonymous to build $BUILD${MARKETING:+, version $MARKETING}."
echo "  iOS:     $PBX"
echo "  Android: $ANDROID_NOTE"
echo
echo "=== git diff ($NATIVE) ==="
git -C "$NATIVE" --no-pager diff -- "${PBX#$NATIVE/}" 2>/dev/null || git -C "$NATIVE" --no-pager diff || true
echo
echo "Next: review the diff, then archive in Xcode (untick iPad first if you haven't),"
echo "upload, select the new build on the rejected version, and resubmit."
