# BipolarBear — Notes for Claude (and other AI assistants)

Static site + Capacitor wrapper. Mood-tracking app (orange theme) plus an
anonymous peer-community board (yellow theme). No build system, no bundler —
files served as-is by Cloudflare Pages and bundled into the iOS/Android
shells by Capacitor.

For deep technical reference (encryption design, scoring algorithms, Firestore
rules, function deploys) see `DOCS.md`. This file is the cheat-sheet for
making safe edits.

## Pages

```
index.html         Home, navigation, FAB dock, streak badges
journal.html       Mood entries (E2E encrypted), stats, focused mode, PDF export
survival-kit.html  Coping resources, goals, medications, memories
anonymous.html     Anonymous community board (yellow theme)
beta.html          Web access gate (Capacitor bypasses)
privacy.html       Static
```

## Source layout

Each page is a thin HTML shell that pulls in one stylesheet and one script:

- `css/<page>.css`
- `js/<page>.js`

Plus four shared modules loaded in `<head>` of every page:

- `js/shared/platform.js`        — `isNative() / isIOS() / isAndroid()` and `window.BB.platform.*`
- `js/shared/debug.js`           — `BB.log()` gated by `localStorage.bbDebug`
- `js/shared/firebase-config.js` — `window.BB_FIREBASE_CONFIG`
- `js/shared/onboarding.js`      — `BB.onboarding.getStep()` and `resolvePointerPosition()` (index + journal only)

`fab.js` is a self-contained IIFE that injects the floating action bar dock
plus the auth/account modals. Loaded on `index`, `journal`, `survival-kit`
(NOT `anonymous` — that page has its own yellow-themed UI).

## Things that must stay inline in HTML — do not extract

- The `<style>body{background:...}</style>` one-liner — paint-blocking critical CSS
- The beta-gate `<script>` — must redirect before any render
- The native-PIN-gate one-liner (where present) — same reason
- The home-stats early-paint `<script>` in `index.html` (right after the badge
  divs) — renders the streak / stability / survival-progress badges from cached
  localStorage synchronously, before the four blocking Firebase SDK `<script>`
  tags. Moving it after them (or into `js/index.js`) reintroduces the ~1s blank
  badges for returning users. Keep its badge formats in sync with
  `_updateStreakBadge()` + the survival-progress counter in `js/index.js`
- `window.Capacitor = window.Capacitor || null` shim (journal only)
- The "Isolated safety net" 8s timeout in journal.html — must survive errors in the main script body
- The pre-activation IIFE in anonymous.html — picks the initial screen synchronously before Firebase auth resolves
- The theme one-liner in anonymous.html `<head>` — sets `html.theme-dark` from `localStorage.bbAnonTheme` (auto / light / dark) before first paint; `applyTheme()` in `js/anonymous.js` mirrors it

## Loading order

In every page's HTML, scripts must appear in this order:

1. Shared helpers (`js/shared/*`) — synchronous in `<head>`
2. Inline critical scripts (above)
3. Firebase compat SDKs (`<script src=https://gstatic...>`) — `defer` on journal.html
4. `js/<page>.js` — comes AFTER the Firebase SDKs
5. `fab.js` — last

If you put `js/<page>.js` before the Firebase SDKs, init code will see
`firebase` as undefined. Most pages handle this defensively but don't rely
on the catch.

## Native build flow

> **Native project locations.** These repos are part of the UNI·SIM
> workspace (moved 2026-09-18). The web repo is `~/Github/UNISIM/Bipolar_Bear`
> and both Capacitor projects sit beside it under
> `~/Github/UNISIM/Bipolar_Bear_Mobile/` — `bipolarbear-native/` and
> `bipolaranonymous-native/`. They used to live in `~/Github/James/`; on the
> Mac that path is now only a symlink to the new place, so don't write it
> into anything. (Before that they sat directly in the home dir at
> `~/bipolarbear-native` / `~/bipolaranonymous-native` — dead paths.)
>
> **On Windows** the whole Github tree lives on the `D:` drive (not the
> home dir), so the real paths are
> `D:\Github\UNISIM\Bipolar_Bear_Mobile\bipolarbear-native\` and
> `…\bipolaranonymous-native\` — siblings of the web repo
> `D:\Github\UNISIM\Bipolar_Bear`. Translate the `~/Github/UNISIM/…` paths
> below accordingly. `scripts/bump-version.sh` auto-detects this sibling
> layout; for other commands pass the `D:` path (or `NATIVE_REPO=…`).

### BipolarBear app (`com.bipolarbear.app`)

```bash
# In the repo (working copy):
git pull

# Sync to the Capacitor project. Capacitor's `cap copy` bundles EVERYTHING in
# www/ into the app (`.assetsignore` is NOT read by @capacitor/cli — it's only
# used by @capacitor/assets for icon generation), so keep non-runtime files out
# of www/ here or they bloat the APK/AAB/IPA. store-assets (~57MB screenshots),
# functions (Cloud Functions source), www-anonymous (the other app's bundle),
# .wrangler, scripts and the *.md docs are none of them needed at runtime.
rsync -av --delete \
  --exclude='.git' --exclude='.claude' --exclude='.github' --exclude='.DS_Store' \
  --exclude='www-anonymous' --exclude='scripts' --exclude='functions' \
  --exclude='store-assets' --exclude='.wrangler' --exclude='*.md' \
  ./ ~/Github/UNISIM/Bipolar_Bear_Mobile/bipolarbear-native/www/

# On Windows (no rsync) the equivalent is robocopy /MIR with the same excludes
# via /XD (dirs) + /XF '*.md', then delete any of the above already in www/.

# Then open native IDE:
cd ~/Github/UNISIM/Bipolar_Bear_Mobile/bipolarbear-native && npx cap sync
npx cap open ios       # or: npx cap open android
```

### Bipolar Anonymous app (`com.bipolaranonymous.app`)

A second native project, fed from a built bundle rather than the repo
root — only the files the anon page actually uses get copied, and
`anonymous.html` is renamed to `index.html` so the WebView opens it
on launch.

```bash
git pull

# Build the bundle (idempotent — wipes www-anonymous/ each run):
node scripts/build-anonymous.js

# Sync into the separate native project:
rsync -av --delete ./www-anonymous/ ~/Github/UNISIM/Bipolar_Bear_Mobile/bipolaranonymous-native/www/
cd ~/Github/UNISIM/Bipolar_Bear_Mobile/bipolaranonymous-native && npx cap sync
npx cap open ios       # or: npx cap open android
```

The build script also flips `BB_BRAND.bundle` from `'main'` to
`'anonymous'` in the copied `brand-config.js`, which is what
`BB.isAnonymousApp()` reads in the native shell (the public-domain
check can't fire there — `location.hostname` is `localhost`).

The script is platform-agnostic — it only produces the `www-anonymous/`
bundle. The same bundle feeds both the iOS and Android targets inside
`~/Github/UNISIM/Bipolar_Bear_Mobile/bipolaranonymous-native/`.

### Android first-time setup (Bipolar Anonymous)

Only needed once per machine. After this, the normal build flow above
covers both platforms.

```bash
cd ~/Github/UNISIM/Bipolar_Bear_Mobile/bipolaranonymous-native
npx cap add android
```

Then in `android/app/build.gradle` confirm:

- `applicationId "com.bipolaranonymous.app"`
- `versionCode 1` / `versionName "1.0"` — bump both for every Play release

Per-release in Android Studio:

1. **Build → Generate Signed App Bundle / APK → Android App Bundle**
2. First release: create a **new keystore** dedicated to
   `com.bipolaranonymous.app`. Do **not** reuse the BipolarBear keystore
   — Play treats the two apps as independent and a shared keystore is a
   blast-radius footgun. Store the `.jks` + passwords somewhere durable
   (keystore loss = app permanently un-updateable).
3. Pick **release** variant → Finish. Signed `.aab` lands in
   `android/app/release/`.

### Firebase wiring for the Android anonymous app

The anonymous app reads/writes the same Firestore project as the main
build. It needs to be registered as a **separate Android app** in that
project so auth/Firestore accept its package ID:

1. Firebase Console → Project settings → **Add app** → Android
2. Package name: `com.bipolaranonymous.app`
3. SHA-1: from Android Studio's Gradle panel → `:app → Tasks → android
   → signingReport` (use the **release** SHA-1, not debug)
4. Download `google-services.json` → drop into
   `~/Github/UNISIM/Bipolar_Bear_Mobile/bipolaranonymous-native/android/app/google-services.json`
   (overwrites the placeholder Capacitor scaffolded)

The existing Firestore security rules already allow writes from any
authenticated user, so no rules changes are required.

### Google Play Console: creating the second app

`com.bipolaranonymous.app` is a separate Play listing — it does NOT
share a console entry with Bipolar Bear.

1. Play Console → **All apps → Create app**
2. App name: `Bipolar Anonymous`; defaults: Free, App (not Game)
3. Work through **Set up your app** checklist:
   - Privacy policy URL (point at the `privacy.html` on the live domain)
   - Data safety form — declare what the anonymous board collects
     (posts, monika, anonProfile email hash). Posts are plaintext on
     Firestore, NOT E2E encrypted — be honest about that.
   - Content rating, target audience, ads declaration
   - Main store listing: icon, feature graphic, screenshots (yellow
     theme), short + full description
4. **Test and release → Testing → Internal testing → Create new release**
   → upload `.aab` → release notes → Save → Review → Start rollout
5. **Testers** tab → create email list → save → copy opt-in URL → email
   it out manually (Play does not send invites automatically)

Initial Play review for a brand-new app can take a few hours before
internal testers can actually install — the upload itself is instant
but the listing isn't live until review clears.

## Firestore collections

```
entries/{auto}              E2E encrypted. Plaintext fields: userId, timestamp.
userSettings/{uid}          Settings + nested anonProfile + currentStreak/stableStreak/fabState
personalDetails/{uid}       PDF-export contact details
counters/{...}              appCosts, peopleHelped, peopleHelpedApp, helpedCount
bbAnonPosts/{auto}          Community posts (plaintext)
bbAnonAnnSuggestions/{auto} Member-suggested announcements awaiting the admin
bbAnonPush/{fcmToken}       Push registration + notification prefs (never client-readable)
bbAnonMonikas/{lowercase}   Monika reservation (uniqueness)
bbAnonTranslations/{hash}   Cached post/comment translations (server-written only)
bbAnonTranslateUsage/{uid}  Per-reader daily translation budget (server-written only)
anonProfiles/{sha256email}  Cross-device anon profile lookup (standalone path)
bbPresence/{sessionId}      Live-now heartbeat, main app (lastSeen only)
bbAnonPresence/{sessionId}  Live-now heartbeat, anonymous board
betaSignups/{auto}          Beta access requests
feedback/{auto}             In-app feedback submissions
```

Cloud Functions region: `europe-west1`.

Push notifications for the anonymous board (replies / announcements /
weekly digest) need account + native setup that isn't in the repo — see
`NOTIFICATIONS.md`. Until it's done the app reports them unavailable
rather than failing.

Auto-translation of board posts (`translateAnonTexts`) needs the **Cloud
Translation API** enabled on the Firebase project — see `DOCS.md` §2.15.
Until it's done every post reads as written; nothing breaks.

## localStorage key categories

| Prefix             | Purpose                                                  |
|--------------------|----------------------------------------------------------|
| `bb*`              | Main app state (FAB, onboarding, hints, streaks)         |
| `bbAnon_*`         | Anonymous board state                                    |
| `entry:<ts>`       | Cached journal entry (per-entry)                         |
| `trackCustom_*`    | Custom tracking field toggles                            |
| `_labelOverride_*` | User-renamed UI labels                                   |

Settings that live in BOTH localStorage AND `userSettings/{uid}`:

`moodLinkingEnabled, moodSpectrumEnabled, wheelModeEnabled, showMoodSuggestion,
healthSyncEnabled, focusedModeEnabled, incognitoMode, achievementToastsEnabled,
reminderEnabled, reminderTime, weeklySummaryEnabled, customiseFormEnabled,
disabledSteps, currentStreak, stableStreak, fabState, earlyWarnEnabled`

## When adding a new feature

If it adds a localStorage key, also consider updating:

- `logout()` in `js/journal.js` — clear-list (only if the value shouldn't survive logout)
- `deleteAllEntries()` in `js/journal.js` — clear-list (for full reset / account delete)
- `userSettings` write+read in the journal auth listener — if it should sync cross-device
- The home-screen auth listener in `js/index.js` — if it affects the home screen

If it adds a CSS or JS file:

- Add it to `STATIC_ASSETS` in `service-worker.js`
- Bump `CACHE_NAME` (`bipolarbear-vN`) so existing clients drop their stale cache

## Gotchas (from real bugs we fixed)

- **`let db` does not attach to `window`.** If you declare module state with
  `let`/`const` in an inline `<script>` block, other `<script>` tags (and
  fab.js) cannot see it via `window.db`. Use `var` OR explicitly mirror with
  `window.db = db;`. Same for `currentUser` and `auth`. Already done in
  `index.html` and `journal.html` — preserve it.

- **innerHTML + user-supplied data → escape it.** Each page has a helper:

  | File                     | Helper       |
  |--------------------------|--------------|
  | `js/index.js`            | `_escHtml()` |
  | `js/anonymous.js`        | `esc()`      |
  | `js/survival-kit.js`     | `_esc()`     |
  | `js/journal.js`          | `_esc()`     |

  Use them when splicing localStorage / Firestore strings into innerHTML.

- **Firebase Auth requires recent re-login** for `user.delete()` and
  `user.updateEmail()`. Always re-authenticate (prompt for password and call
  `reauthenticateWithCredential`) BEFORE these operations, so a wrong password
  aborts cleanly without leaving the user in a half-deleted state.

- **Firestore writes need `window.currentUser`** to be defined. Many toggle
  handlers gate writes on `if (window.db && window.currentUser)`. If
  `currentUser` isn't mirrored to window, writes silently no-op.

- **Encrypted entries**: only `userId` and `timestamp` are plaintext on
  Firestore. Everything else (mood, energy, sleep, notes…) is in an
  encrypted blob. To read entry dates without decryption — for example to
  recompute streaks from the home page — use the plaintext `timestamp`
  (JS millisecond Unix timestamp).

- **Service worker cache name** must be bumped (`bipolarbear-vN`) on every
  release that changes precached assets, otherwise users see stale files.

- **Widget CFBundleVersion** must match the main app's `CFBundleVersion`.
  Bump both together — App Store Connect rejects mismatches.

- **Cloudflare Pages auto-deploys** on every push to `main`. There is no
  staging — `main` IS production for the web build. iOS/Android builds are
  manual through Xcode / Android Studio.

- **Two Capacitor configs** ship two distinct apps:

  | Config                              | App ID                       | Manifest                  |
  |-------------------------------------|------------------------------|---------------------------|
  | `capacitor.config.json`             | `com.bipolarbear.app`        | `manifest.json`           |
  | `capacitor-anonymous.config.json`   | `com.bipolaranonymous.app`   | `manifest-anonymous.json` |

- **`worker.js` (Cloudflare Worker, edge) ≠ `service-worker.js` (browser).**
  Don't confuse them. `worker.js` routes hostnames at the edge;
  `service-worker.js` caches assets in the browser.

## iPhone-frame markup

Every page wraps content in `#iphone-frame > #app-shell > #scroll-view`.
Below `520px` the frame styles are no-ops (mobile + Capacitor). At `≥520px`
the frame renders as a desktop iPhone 15 Pro mockup. At `≥920px` it scales
up to an iPad-sized frame.

If you add a fixed-position element: position it relative to `#app-shell`
on `≥920px` (the shell creates a containing block via `transform:
translateZ(0)`), and to the viewport otherwise. See `_applyFabDock()` in
`fab.js` for the canonical pattern.

## Testing checklist after a major change

- [ ] Bump version in BOTH repos at once: `scripts/bump-version.sh <buildNumber>` (build N → v1.N across web `_APP_VERSION`, `service-worker.js` `CACHE_NAME`, and `bipolarbear-native` iOS pbxproj + Android gradle). Then add the `CACHE_NAME` changelog note and commit both repos.
- [ ] Web local: `python3 -m http.server 8765` from repo root, then hard-refresh in browser
- [ ] iPhone: rsync → `npx cap sync` → Xcode build
- [ ] Android: rsync → `npx cap sync` → Android Studio build
- [ ] If `service-worker.js` `CACHE_NAME` bumped, hard-refresh on every device once
- [ ] If a Firestore-synced setting changed, test signed-out (guest) AND signed-in paths

## What `claude-code` should default to doing

- Branch off `main` for any non-trivial change. Don't commit directly to `main`.
- Push at meaningful checkpoints (per phase, per logical change) — not just at the end.
- Don't skip git pre-commit hooks. If a hook fails, fix the cause; don't `--no-verify`.
- Don't create PRs unless asked. Direct merge / fast-forward is fine for solo work.
- For big refactors, do one commit per phase so individual phases stay revertable.
- After creating a PR, auto-subscribe to PR activity (`subscribe_pr_activity`) without asking — watch CI and review comments by default.
