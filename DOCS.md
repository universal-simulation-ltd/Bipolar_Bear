# Bipolar Bear — Technical Documentation

---

## Table of Contents

1. [Tech Stack](#1-tech-stack)
2. [Technical Specification](#2-technical-specification)
3. [Algorithm Flowcharts](#3-algorithm-flowcharts)
4. [Mood Suggestion — How It Works](#4-mood-suggestion--how-it-works)

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla HTML/CSS/JavaScript — no framework, no build step |
| **Pages** | `index.html`, `journal.html`, `survival-kit.html`, `anonymous.html`, `beta.html` |
| **Shared JS** | `fab.js` — FAB dock system loaded on every app page |
| **Database** | Firebase Firestore (NoSQL, real-time sync) |
| **Authentication** | Universal ID (the UNI·SIM account, Supabase Auth) in front of Firebase Auth via custom tokens — §2.17; Firebase email/password still works |
| **Backend** | Firebase Cloud Functions v2 (`functions/index.js`) — Node 22, deployed to `europe-west1` |
| **Email** | Resend API (`resend` npm package) — transactional email for anonymous verification codes |
| **Firebase plan** | **Blaze (pay-as-you-go)** required — Cloud Functions and Secret Manager need it |
| **Native wrapper** | Capacitor 8 (iOS + Android WebView) |
| **Health data** | iOS HealthKit + Android Health Connect via `@flomentumsolutions/capacitor-health-extended` |
| **Offline storage** | Firestore offline persistence + `localStorage` cache |
| **PDF export** | jsPDF (client-side, no server) |
| **Notifications** | Capacitor Local Notifications |
| **PWA** | Web App Manifest + service worker (offline-capable) |
| **Hosting** | **Cloudflare Pages** — auto-deploys from GitHub on every push to `main` |
| **Domains** | `bipolarbear.app` (main app) · `bipolaranonymous.app` (alias — serves identical content) |

### Why no framework?

The app runs inside a Capacitor WebView where bundle size, cold start time and network access matter. A single self-contained HTML file loads instantly from disk, requires no bundler, and avoids the complexity of a SPA router operating inside a native shell.

### Hosting — Cloudflare Pages

The app is hosted on **Cloudflare Pages**, connected directly to the GitHub repository. Every push to `main` triggers an automatic deployment — no manual upload needed.

Both custom domains are configured in the Cloudflare Pages project:
- `bipolarbear.app` — main app
- `bipolaranonymous.app` — alias domain serving identical content (URL bar stays as-is)

Both domains have their nameservers pointed at Cloudflare (configured in Namecheap). Both are listed as **Authorised Domains** in Firebase Console → Authentication → Settings, which is required for Firebase Auth sign-in to work from either domain.

The native iOS/Android app (Capacitor) is unaffected by domains — it loads all files locally from the device.

### Local development

```bash
# Serve from the www/ directory on port 8765
cd www
python -m http.server 8765
# Open http://localhost:8765
```

The beta gate (`beta.html`) is bypassed for `localhost` and `file://` origins. The app also requires Firebase to be configured — `firebaseConfig` is inlined in each HTML page.

### Cloud Functions setup

```bash
cd functions
npm install
# Set Resend API key as a Firebase secret
firebase functions:secrets:set RESEND_API_KEY
# Deploy functions
firebase deploy --only functions
```

The repo carries a `.firebaserc` naming `bipolarbear-app` as the default
project, so these run bare. Without it every `firebase` command in this repo
fails with "No currently active project" until you pass
`--project bipolarbear-app` or run `firebase use --add` — which is what
happened for the first eighteen months of this project's life. The file holds
only the project id, which is already public in `js/shared/firebase-config.js`.

After deploying, go to **Google Cloud Console → Cloud Run** and set each function's security to **Allow unauthenticated invocations** (the `invoker: 'public'` option in code is correct but org policy may require the console override).

---

## 2. Technical Specification

### 2.1 Pages & Responsibilities

```
index.html          Home screen — navigation hub, entry tick, day streak, anonymous badge,
                    tutorial onboarding, logo easter egg, sign in/out
journal.html        Core journal — mood logging, stats, calendar, focused mode, HealthKit sync
survival-kit.html   Survival guide — mood definitions, coping strategies, medications,
                    goals, memories, commitments, quotes, remember-this
anonymous.html      Bipolar Anonymous board — email-verified anonymous chat;
                    requires BipolarBear account (Firebase Auth) + email verification code
beta.html           Password gate for web preview (Capacitor bypasses this entirely)
privacy.html        Privacy policy (static)
```

### 2.2 Shared JavaScript

```
fab.js                       Floating action bar dock (loaded on index/journal/survival-kit)
js/shared/firebase-config.js Single source of truth for the Firebase Web SDK config object,
                             exposed as window.BB_FIREBASE_CONFIG. Each page's inline init
                             block reads from this rather than redeclaring a literal.
js/shared/platform.js        Capacitor platform detection helpers — exposes isNative(),
                             isIOS(), isAndroid() as bare globals (legacy) and via
                             window.BB.platform.* (canonical namespace).
js/shared/debug.js           Optional console.log gating. window.BB.log() is a no-op when
                             localStorage.bbDebug === '0'; warn/error always pass through.
```

Loading order: every page includes `<script src="js/shared/platform.js">`, then
`debug.js`, then `firebase-config.js` near the top of `<head>`, before the inline
script that calls `firebase.initializeApp()`. They have no external dependencies
and are safe to load synchronously.

#### Working on Android (Android Studio)

```bash
npx cap sync android       # copy webDir + js/shared into the Android project
npx cap open android       # opens Android Studio; build & run from there
```

To enable verbose Chrome DevTools logging from a connected Android device:
`chrome://inspect` in Chrome on the host machine, then inspect the WebView. The
`bbDebug` flag (see `js/shared/debug.js`) is on by default; set
`localStorage.bbDebug = '0'` from the DevTools console to silence info logs.

#### fab.js

`fab.js` is loaded on `index.html`, `journal.html`, and `survival-kit.html`. It provides:

- **FAB dock** — up to 4 configurable floating action buttons (Chat, E2EE, Coffee, Feedback, Stats, Celebrity, Goals, Quick Note)
- **Account modal** — sign in, sign up, change password, change email, personal information, delete account
- **Stats modal** — mood distribution, correlations, AI feedback
- Dock layout persisted in `localStorage` (`bbFabSlot_1` … `bbFabSlot_4`); hidden buttons tracked per-key (e.g. `bbWaFabHidden`)

### 2.3 Data Architecture

#### Firestore Collections

```
entries/
  {docId}
    userId        string   — Firebase Auth UID
    date          string   — ISO 8601 e.g. "2025-03-22T00:00:00.000Z"
    mood          string   — "manic" | "elevated" | "stable" | "low" | "depressed"
    energy        number   — 0 | 3 | 5 | 7 | 10
    sleep         number   — 5 | 6.5 | 7.5 | 8.5 | 10
    medication    string?  — "taken" | "not-taken"
    goals         string?  — "completed" | "some" | "none"
    budget        string?  — "yes" | "no"
    exercise      string?  — "yes" | "no"
    outside       string?  — "yes" | "no"
    anxiety       string?  — "high" | "medium" | "low"
    stress        string?  — "high" | "medium" | "low"
    irritability  string?  — "yes" | "medium" | "no"
    alcohol       string?  — "yes" | "no"
    notes         string?  — free text journal entry
    steps         number?  — step count from HealthKit
    autoFilled    bool?    — true when the day was created by auto-complete (§2.13)
                             rather than logged by the user; cleared when the
                             user edits and saves the entry
    autoFilledSource string? — "health" | "typical" — where the estimate came from
    pdfHidden     bool     — exclude from PDF export
    favourite     bool     — starred entry
    customFields  object   — user-defined extra fields { [id]: "yes"|"no" }
    timestamp     number   — ms since epoch (for ordering)
    recordedAt    string   — ISO timestamp of when the form was submitted
    recordedTz    string   — IANA timezone e.g. "Europe/London"

userSettings/
  {uid}
    dailyGoals          string[]        — user's daily goal list
    currentMedList      {name,dosage}[] — medication list
    moodDefinitions     object          — per-mood personal definitions
    copingStrategies    object          — per-mood coping strategies
    logoVariant         number          — 0|1|2 (easter egg logo index)
    onboardingStep      number          — highest tutorial step reached (0–12)
    tutorialToastShown  bool            — "tutorial complete" popup has been shown
    personalHintDone    bool            — personal info hint dismissed
    survivalKitVisited  bool            — user has visited the survival kit (deprecated — now localStorage only)
    firstName           string?         — deprecated; name now from personalDetails
    safetyPlanEnc       {_enc,_iv,updatedAt}? — My safety plan (§2.16), AES-GCM under the
                                          journal's E2E data key; the plaintext never
                                          leaves the device. null after a reset.

personalDetails/
  {uid}
    personalName               string
    personalDOB                string
    personalMedicalNum         string
    personalDiagnosis          string
    personalDiagnosisDate      string
    personalAddress            string
    personalMobile             string
    personalEmail              string
    personalEmergencyContact   string
    personalNotes              string

bbAnonPosts/
  {docId}
    userId      string    — hashed or anonymous identifier
    message     string    — post content
    timestamp   Timestamp — Firestore server timestamp
    deleted     bool?     — soft-delete flag (admin only)
    isAdmin     bool?     — true if posted by admin account
    reactions   object?   — emoji reaction counts { [emoji]: number }
    userReactions object? — per-user reaction tracking { [userId]: emoji }
    reports     string[]? — UIDs that have reported this post
    reported    bool?     — flagged as reported

Firestore rules
  The rules are in firestore.rules at the repo root, tested against the
  emulator by scripts/firestore-rules (`npm install && npm test` there; needs
  the Firebase CLI and Java). Deploy with
  `firebase deploy --only firestore:rules`. The suite holds every Firestore
  call the shipped apps make, so add the call there when a client gains one.
  legacyClients() at the top of the rules keeps app builds <= 1.39 working
  (board writes without an owner uid, profile restore before sign-in); set it
  to false once those builds are no longer in use.

bbAnonLinks/
  {uid}                   — written by verifyAnonCode (Admin SDK) only
    emailHash   string    — sha256(email) this session proved with a code
    verifiedAt  Timestamp
  Never readable by clients; the rules use it to recognise the owner of
  anonProfiles/{emailHash} (and the admin on the email-code path).

anonVerify/
  {sessionId}             — created by sendAnonCode Cloud Function
    email       string    — email address the code was sent to
    code        string    — 4-digit verification code (plaintext, TTL 10 min)
    createdAt   Timestamp — used for rate limiting and expiry
    verified    bool?     — set to true by verifyAnonCode on success
    uid         string?   — Firebase Auth UID, set on verification

  Security rules: allow read, write: if false;
  Only accessible via Cloud Functions using the Admin SDK.

counters/
  peopleHelped
    count   number   — global increment counter
  userCount
    count   number   — Bipolar Bear accounts. Incremented once per account by
                       js/shared/user-count.js, in the same transaction that
                       sets userSettings/{uid}.userCounted = true.
  anonUserCount
    count   number   — Bipolar Anonymous members. Incremented once per member,
                       paired with anonProfiles/{sha256email}.counted = true.
```

#### User counts

`js/shared/user-count.js` owns both counter documents above. It exists because
neither `userSettings` nor `anonProfiles` can be counted with an aggregate
query from the client — a user may only read their own document — so the total
is maintained incrementally instead:

- **Counting is idempotent per account.** The increment and the account's
  one-time `counted` flag are written in the same Firestore transaction, so two
  devices racing on the same account can only produce one increment.
- **Accounts that predate the feature** carry no flag, so they count themselves
  the first time they open the app / board — and a dormant one that never comes
  back is swept up by the `backfillUserCounts` Cloud Function below.
- **Anonymous members are keyed on `anonProfiles/{sha256(email)}`** — the one
  document shared by both entry paths (BipolarBear account and standalone
  email-code), so the same person can't be counted twice.
- **Deleting an account decrements** (`js/journal.js` delete-account flow,
  `deleteAnonAccount()` on the board), guarded by a localStorage mirror of the
  flag — the document holding the real flag is being deleted in the same pass.
- Displayed values are cached in `localStorage` (`bbUserCountCache`,
  `bbAnonUserCountCache`) and both lines stay hidden until a real, non-zero
  number resolves.

##### Backfilling accounts that predate the counters

`backfillUserCounts` (`functions/index.js`, callable, `europe-west1`) exists
because incremental counting starts from zero: everyone who joined before the
feature shipped is missing from the total until they next open the app, which
for a dormant account may be never. The client can't fix it — `userSettings`
and `anonProfiles` are readable only by their owner — so this runs with the
Admin SDK.

What it counts, matching the client's definitions exactly:

| Counter          | Population                                                                                                   |
|------------------|--------------------------------------------------------------------------------------------------------------|
| `userCount`      | One per `userSettings/{uid}` whose uid still exists in Firebase Auth                                          |
| `anonUserCount`  | One per `sha256(email)` across `userSettings/{uid}.anonProfile.monika` **and** `anonProfiles/{hash}.monika`   |

Both are de-duplicated by key, so a member who uses both entry paths counts
once. `userSettings` documents whose Auth account is gone are leftovers from a
deleted account — reported as `orphaned`, not counted.

It writes each account's `counted` flag **before** setting the counters to the
computed totals, so a backfilled account can never count itself again on its
next visit. Run it signed in as `inbox@jamesmarkey.co.uk` (any other caller is
refused), dry-run first:

```js
const fn = firebase.app().functions('europe-west1')
             .httpsCallable('backfillUserCounts');
(await fn({ apply: false })).data   // report only — writes nothing
(await fn({ apply: true  })).data   // write the flags, set the counters
```

Both modes return `{bear, anon}` with `total`, `alreadyCounted`, `toCount`,
`was` (the counter's value before the run) and, for `bear`, `orphaned`.
Repeatable: it recomputes the same totals and only flags what is still
unflagged, so it's also the way to repair a counter that has drifted.

Deploy with `firebase deploy --only functions:backfillUserCounts`.

#### Live counts ("(N live)")

`BB.userCount.startPresence(db, kind, cb)` maintains one document per open
page in `bbPresence/` (home) or `bbAnonPresence/` (board):

```
bbPresence/{sessionId}
  lastSeen   Timestamp   — server timestamp, re-written every 45s
```

- **Doc id is a random per-tab id** held in `sessionStorage.bbPresenceId`. The
  document carries no uid, email or monika — a live count must not become a
  record of who was reading a mental-health app and when.
- **"Live" = beat within the last 2 minutes**, so a closed tab drops out on its
  own even when its delete never lands (unload deletes are best-effort).
- **Hidden tabs stop beating**, so a backgrounded tab ages out of the window.
- The count uses the `count()` aggregate where the SDK exposes it (one read
  regardless of how many are live) and falls back to a capped document read.
- Documents idle for 30 min are swept opportunistically, ten at a time, on
  every tenth tick.
- **Which pages beat:** home, journal and survival kit (all `bbPresence`) plus
  the board (`bbAnonPresence`) — time in the journal is time using the app, so
  it counts. Only the pages that display a figure pass a callback; the rest run
  in beat-only mode, skipping the count query and the sweep, so an extra open
  page costs one write per 45s and no reads.
- The session id lives in `sessionStorage`, so moving home → journal → survival
  kit in one tab reuses one presence document and reads as one live person.

#### The UNI·SIM suite-wide count

Both apps moved into the `universal-simulation-ltd` organisation on 2026-09-17
and joined the counter every Universal Simulation app shows. `BB.userCount.suite`
is that counter, and it is **entirely separate** from everything above: Supabase
rather than Firestore, and a second figure rather than a replacement for the
ones the apps already had.

```
POST {supabase}/rest/v1/rpc/app_presence_beat  {p_product, p_install_id, p_platform}
POST {supabase}/rest/v1/rpc/suite_user_counts  {}  → [{total, live}]
```

- **The beat is what matters.** It runs on load and every 45 s while the page
  is visible — same cadence, same hidden-tab rule as `startPresence()` — and is
  what puts these users into the suite figure. `p_product` is `bipolar_bear`
  from the home page and `bipolar_anonymous` from the board (migration 0179).
- **It does not wait for Firebase.** It is started at module scope in
  `js/index.js` and `js/anonymous.js`, not inside the auth chain: it has nothing
  to do with Firestore, and a page whose Firebase init fails should still count
  its reader.
- **What is sent:** the product name and a random install id. No uid, no email,
  no monika, nothing read or written. A Bipolar Bear account is a *Firebase*
  account and means nothing to that server, so every beat is anonymous — which
  also means the suite sees a device, not a person, and one user on a phone and
  a laptop counts twice there (the Firestore counters do not have this problem,
  which is why they stay).
- **The install id is shared, deliberately:** raw `localStorage['unisim:install-id']`,
  the same key `@unisim/sdk` uses. On bipolarbear.app the home page and the
  board are one origin, so reading both is one person suite-wide, not two. The
  standalone Bipolar Anonymous app has its own storage and is its own install.
- ⚠ **These two apps open on their OWN figure — do not "fix" this.** Every
  other app in the suite opens on the suite figure and taps through to its own
  (SDK 0.150.0, James: *"show across unisim first"*). Asked directly on
  2026-09-17 whether these should follow, James chose **the bear first**: this
  app's number is a different kind of number — Firestore counts *accounts*, a
  real headcount, where the suite figure can only count devices here — and it is
  the line the suite's counter was copied from. So an absent
  `unisim:user-count-scope` means **the app** in these two, the opposite of
  everywhere else; only an explicit `'suite'` opens on the globe.
- **The count line is a button.** `BB.userCount.suite.wireTap(el, hint, cb)`
  makes it switch between this app's figure and the suite's on click, tap or
  Enter/Space; the choice is remembered in `localStorage['unisim:user-count-scope']`,
  again the suite's key, so a browser that has both keeps one answer. Default is
  the app's own figure. No `aria-label` — with `role="button"` that would read
  the hint out instead of the number.
- **Everything is best-effort.** Offline or refused, every call fails quietly
  and the line simply never offers the suite figure. Whichever figure is
  missing, the other stands in, and the wording always says which is which.
- The suite side is documented in `universal-platform`: migrations
  `0175_app_presence_user_counts.sql`, `0177_suite_user_counts.sql` and
  `0179_product_code_bipolar.sql`.

#### localStorage Keys

```
── Entry / Journal ──────────────────────────────────────────────────────────
bb_entryStatus          {key, done}   — today's/yesterday's entry status cache
bb_draft                object        — autosaved form state
bbHasEntries            "1"           — user has at least one saved entry
bbCurrentStreak         string        — current day streak count (set by journal.html)

── Settings ─────────────────────────────────────────────────────────────────
journalDefaultToday     "true"|null   — log today vs yesterday
focusedModeEnabled      "true"|null   — focused mode on/off
showMoodSuggestion      "1"|"0"       — mood suggestion toggle
moreDataOpenByDefault   "true"|null   — expand extra fields by default
achievementToastsEnabled "true"|null  — achievement toast toggle
pdfHideByDefault        "true"|null   — default PDF hide setting
logoVariant             "0"|"1"|"2"   — cached logo variant

── Cached Firestore data ────────────────────────────────────────────────────
moodDefinitions         JSON object   — per-mood personal definitions
copingStrategies        JSON object   — per-mood coping strategies
currentMedList          JSON array    — cached medication list
dailyGoals              JSON array    — cached goals
personalName            string        — cached from personalDetails
personalEmergencyContact string       — cached from personalDetails

── Achievements ─────────────────────────────────────────────────────────────
unlockedAchievements    JSON array    — list of unlocked achievement IDs

── Onboarding / Tutorial ────────────────────────────────────────────────────
bbOnboardingStep        string        — highest tutorial step (0–12); synced to Firestore
bbTutorialToastShown    "1"           — "tutorial complete" popup shown; synced to Firestore
bbFabsUnlocked          "1"           — FAB dock fully unlocked (set at step 12)
bbWelcomeShown          "1"           — first-ever welcome popup shown
bbSurvivalKitVisited    "1"           — user has opened the survival kit
bbSurvivalCelebDone     "1"           — "survival kit filled in" celebration toast shown (once)
bbPersonalHintDone      "1"           — personal info hint dismissed; synced to Firestore
bbMedHintDone           "1"           — medications hint dismissed
bbMoodDefHintDone       "1"           — mood definitions hint dismissed
bb_fmChooseMoodHintDone "1"           — focused-mode choose-mood hint dismissed
bb_fmMoodInfoCloseHintDone "1"        — focused-mode mood info close hint dismissed
bb_fmMoodTipShown       "1"           — focused-mode mood tip shown
bbSettingsHintDone      "1"           — settings hint dismissed (settings removed; auto-set)
bbCustomiseFormHintDone "1"           — customise form hint dismissed
bbCustomiseAdditionalHintDone "1"     — customise additional hint dismissed
bbCloseSettingsHintDone "1"           — close-settings hint dismissed
bbAdvancedTutorialToastShown "1"      — advanced tutorial complete toast shown

── PIN Lock ─────────────────────────────────────────────────────────────────
bbPinEnabled            "1"           — PIN lock is active
bbPinCode               string        — the PIN scrambled: "pbkdf2$<iter>$<salt>$<hash>"
                                        (js/shared/pin-guard.js). Builds before
                                        2026-10-05 stored it plain; any page with
                                        pin-guard.js replaces that on load
bbGuestPinSalt          string        — guest PIN: salt for the journal encryption key
bbPinFails              number        — wrong PINs in a row (cleared on a right one)
bbPinLockUntil          ms timestamp  — keypad locked until then (5 wrong → 30 s,
                                        then 1 / 5 / 15 / 60 min per further miss)
bbPinLinkedUID          string        — Firebase Auth UID that this PIN belongs to
                                        Cleared on sign-in if UID doesn't match,
                                        preventing lock-out when switching accounts

── My safety plan + low-days card (§2.16, js/shared/safety-plan.js) ───────
bbSafetyPlan            JSON          — the plan (device copy; synced only encrypted)
bbSafetyPlanSyncedAt    ms string     — updatedAt of the copy last pushed/pulled
bbSafetyPlanOnLock      "1"           — opt-in: plan readable from the PIN screens
bbLowMoodSupportOff     "1"           — "Don't suggest support when I've had low days"
bbLowMoodDue            "YYYY-MM-DD"  — the journal last found the low-days pattern
bbLowMoodShown          "YYYY-MM-DD"  — the card first showed in this 4-day window
bbLowMoodDismissed      "YYYY-MM-DD"  — the card was closed that day

── Bipolar Anonymous ────────────────────────────────────────────────────────
bbAnon_verified         "true"        — user has completed email verification for the board
bbAnonLastVisit         string        — ms timestamp of last visit to anonymous.html;
                                        used to compute "new messages since last visit" badge

── FAB dock ─────────────────────────────────────────────────────────────────
bbFabSlot_1 … bbFabSlot_4  string    — FAB ID assigned to each dock slot
bbWaFabHidden           "1"           — WhatsApp FAB permanently hidden
bbQuickNoteFabHidden    "1"           — Quick Note FAB permanently hidden
bbCoffeeFabHidden       "1"           — Buy Me a Coffee FAB permanently hidden
bbFeedbackFabHidden     "1"           — Feedback FAB permanently hidden

── UNI·SIM suite counter (NOT bb-prefixed — shared with the whole suite) ────
unisim:install-id       uuid          — this install, as the suite knows it
unisim:user-count-scope "app"|"suite" — which figure the count line is showing
bbSuiteUserCountCache   string        — last known suite TOTAL (never the live one)

── Misc ─────────────────────────────────────────────────────────────────────
bbWebUnlocked           "true"        — beta gate bypass (web preview)
statsStartDate          string        — custom stats window start date
bbLogoEasterEggFound    "1"           — logo easter egg discovered
bbLastSeenVersion       string        — last app version shown in "What's New" popup
bbPrivacyNoteDismissed  "1"           — privacy note on home screen dismissed
```

#### sessionStorage Keys

```
bbPinUnlocked           "1"    — PIN verified for this session; cleared on pagehide
bbReload                "1"    — set before forced reload after Firestore failure
```

### 2.4 Navigation Model

All inter-page navigation uses `location.replace()` rather than `href` links. This prevents the browser's back/forward cache (bfcache) from restoring a stale Firestore connection when navigating back — critical in Capacitor's WKWebView.

```
index.html  ──replace()──▶  journal.html
index.html  ──replace()──▶  survival-kit.html
index.html  ──replace()──▶  anonymous.html
journal.html  ──replace()──▶  / (index)
survival-kit.html  ──replace()──▶  / (index)
survival-kit.html  ──replace()──▶  journal.html
anonymous.html  ──replace()──▶  / (index)  [on sign-out]
```

`pagehide` event on each page calls `db.terminate()` to release the IndexedDB lock before navigation, preventing lock contention on the destination page.

### 2.5 Firestore Reliability Pattern

```
Persistence:  enablePersistence({ synchronizeTabs: false })
              — single-tab exclusive lock, acquired instantly
              — synchronizeTabs:true adds 3-5s leader election (broken in Capacitor)

Cache read:   1s Promise.race timeout (guards IndexedDB lock contention)
Server read:  3s timeout on first attempt
              8s on retry (_isRetry flag)
              12s after forced reload (sessionStorage.bbReload = '1')

Retry flow:   Show "🔄 Reconnecting…" → wait 2s → retry with 8s timeout
              If retry also fails → set sessionStorage.bbReload → reload page
```

### 2.6 Authentication Flow

```
Email/password  →  full account with Firestore sync
Guest mode      →  entries stored in localStorage as entry:{timestamp}
Migration       →  on first sign-in, guest localStorage entries are batch-uploaded
                   to Firestore (only if account has 0 existing entries)

Change email    →  re-auth required (current password), then firebase updateEmail()
                   Available via the account modal in fab.js
```

**Anonymous board** uses a separate email verification layer on top of Firebase Auth — see section 2.11.

**Universal ID** (the UNI·SIM account) signs people in from the same sheet and hands them their Firebase account — see section 2.17.

#### Loading splash while a session restores

Firebase Auth resolves asynchronously: the SDK has to download, initialise and
read its own localStorage record before `onAuthStateChanged` fires. Until it
does, every page paints its signed-out chrome — the locked Bipolar Anonymous
button, "Sign in to join the community", the Sign In FAB — so a returning user
was told they were logged out on every cold load and then corrected a beat
later.

`js/shared/auth-splash.js` covers that gap with the app icon and a line
tracing its outline (`#bbAuthSplash` markup, styles in `css/theme.css`):

- **Armed only when a session is actually coming back.** It looks for a
  populated `firebase:authUser:*` key in localStorage — the same probe the
  early-paint script in `index.html` uses. A genuine guest has none and goes
  straight to the signed-out home rather than waiting behind a splash for a
  sign-in that isn't coming.
  ⚠ That key is Firebase **v8**'s. The pages load v10 compat, whose default
  LOCAL persistence is IndexedDB, so the key can be absent for a signed-in
  user (the splash then never arms). The early-paint scripts in `index.html`
  and `_hasCachedFbUser()` also accept `bbSignedInHint`, which the home auth
  listener sets/clears (2026-10-09, v289); the splash still uses the old probe
  only, deliberately — arming it from the hint would put a splash in front of
  every return to home on native.
- **Raised before first paint.** The module is loaded synchronously in
  `<head>`, ahead of the stylesheet links, and only adds a class to `<html>`
  (`.bb-auth-restoring`) — safe before `<body>` exists. The `#bbAuthSplash`
  div is the first element in `<body>` so nothing can paint ahead of it.
- **Dropped on the frame after auth resolves.** `js/index.js` calls
  `BB.authSplash.hide()` from a `requestAnimationFrame` at the top of its auth
  listener, so every synchronous chrome update in that listener has already
  been applied and the page is revealed already correct.
- **It always comes down.** `hide()` is idempotent and the module sets its own
  6s timeout, so a Firebase CDN failure or a thrown error in a page script
  degrades to the old brief flash rather than a page nobody can use.
- z-index 9998 — under `#guestPinOverlay` (9999), which is an interactive gate
  that must stay reachable.

Currently wired on `index.html` only. Another page opts in by loading the
module in `<head>`, carrying the same `#bbAuthSplash` markup as the first
element in `<body>`, and calling `BB.authSplash.hide()` once its own auth
listener resolves.

### 2.7 PIN Lock

- PIN stored scrambled in `localStorage.bbPinCode` — PBKDF2-SHA256 (WebCrypto,
  100,000 iterations, random 16-byte salt per PIN), as `pbkdf2$<iter>$<salt>$<hash>`;
  `BB.pin.hash` / `BB.pin.verify` in `js/shared/pin-guard.js`. A plain PIN left by a
  build before 2026-10-05 is hashed on page load (and on the next right unlock).
  A 4-digit PIN has 10,000 values, so the hash keeps it from being read, not from
  being guessed offline; the lockout below is what slows guessing on the keypad
- The optional account PIN syncs as `userSettings/{uid}.pinHash`; the old plain
  `pinCode` field is deleted when an account signs in or the PIN changes. Builds
  before 2026-10-05 read only `pinCode`, so on those the synced PIN reads as off
- Wrong PINs: 5 in a row lock the keypad (30 s, then 1 / 5 / 15 / 60 min for each
  further miss), kept in `bbPinFails` / `bbPinLockUntil` so a reload doesn't reset
  it; "Forgot PIN?" still works while locked
- Re-lock: after 5 min idle, and when the page / app comes back after more than a
  minute in the background (`visibilitychange`, Capacitor `pause`/`resume`, and
  `@capacitor/app` `appStateChange` where installed) — `BB.pin.watchBackground`
- Session unlock stored in `sessionStorage.bbPinUnlocked`
- `sessionStorage` is cleared on `pagehide`, so PIN is required every time the page is opened
- `bbPinLinkedUID` stores the Firebase Auth UID of the account that created the PIN
- On `onAuthStateChanged`, if the signed-in UID doesn't match `bbPinLinkedUID`, all PIN keys are cleared and the overlay is hidden — prevents a different account from being locked out by another user's PIN

### 2.8 Health Data Sync (iOS + Android)

```
Plugin:   @flomentumsolutions/capacitor-health-extended
          iOS     → Apple HealthKit
          Android → Google Health Connect (watch/Wear OS data flows in here)
Data:     Sleep duration  →  selectedSleep bucket (5 / 6.5 / 8 / 9.5 / 11h)
          Step count      →  entry.steps (shown inline with energy)

Permissions: READ_SLEEP, READ_STEPS (requested only on a deliberate user
          action — toggle on, or Import button — per Apple Guideline 5.1.1(iv);
          Health Connect also caps repeat prompts, then routes to its settings)

Steps:    importStepsFromHealth() → queryAggregated({dataType:'steps', bucket:'day'})
Sleep:    importSleepFromHealth() → queryLatestSample({dataType:'sleep'})
          value is minutes-asleep (asleep stages only; InBed/Awake filtered out)
          queryLatestSample ignores the date window and returns the most recent
          session (~36h); a timestamp guard rejects samples outside the target day
Backfill: backfillStepsFromHealth() writes step counts onto the past 7 days'
          entries (Firestore batch when signed in, localStorage when guest)

Timing:   Sleep sync reads last night's record; valid if it ended within ~36h
          Steps sync runs on page load / mood tap for recent dates

Auth UI:  _refreshHealthAuthDisplay() — iOS can only report "asked at some point"
          so it probes a real query to confirm "Connected"; Android Health Connect
          reports the true granted set (Authorised / Partially / Not yet)

Guard:    _healthSyncInProgress flag prevents form navigation during async sync

Android native (lives in the separate bipolarbear-native project, NOT this repo):
          AndroidManifest needs the Health Connect <queries> block, READ_* perms,
          a PermissionsRationaleActivity, and the Android 14+ permission-usage
          activity-alias — without these the OS sheet never appears.
```

### 2.9 Focused Mode

A step-by-step entry wizard, built as an alternative to the full form.

```
Step sequence (default):
  mood → energy → sleep → medication → [optional extras] → notes → done

Extras (shown if enabled in More Data settings):
  goals, budget, exercise, outside, anxiety+stress+irritability, alcohol

Step rendering:   _renderFocusedStep()  ─▶  _fmRenderContent(step)
Step navigation:  _fmGoTo(index)  /  _fmNext()  /  _fmBack()  /  _fmSkip()
High-water mark:  _fmHighWater — furthest step reached (controls summary chips)
Edit mode:        _openEditInFocusedMode(entry) — starts at done step, all steps pre-filled
Change detection: _editOriginalState snapshot + _hasEditChanges() comparison
                  → "Close" (grey) if no changes, "Update entry" (orange) if changed
```

### 2.10 Onboarding / Tutorial System

A 12-step guided onboarding for new users. Step progress is synced to Firestore (`userSettings/{uid}.onboardingStep`) so it resumes on any device.

```
Step  0   — First launch; welcome popup shown
Step  1   — "Click here to get started" hint on journal button
Step  2   — First journal entry opened
Step  3   — First entry saved; home button revealed
Step  4   — Sign-in hint (auth FAB revealed)
Step  5   — Logo hint shown
Step  6   — Survival kit button revealed (5-click logo easter egg)
Step  7   — (reserved)
Step  8   — Journal navigated from home
Step  9   — (removed; WhatsApp hint; skipped automatically → step 10)
Step 10   — WhatsApp / WA modal shown
Step 11   — (reserved)
Step 12   — Tutorial complete; FABs unlocked; "Tutorial Complete 🎓" popup shown
```

**Completion flags set at step 12** (silently on login if already completed):
`bbTutorialToastShown`, `bbFabsUnlocked`, `bbSurvivalCelebDone`, and all hint keys.

**Key functions:**
```
_getOnboardingStep()          — reads bbOnboardingStep from localStorage
_advanceOnboardingStep(n)     — advances to step n if n > current; syncs to Firestore;
                                 shows "Tutorial Complete" popup on first reach of 12
_applyOnboardingGating()      — shows/hides elements based on current step
                                 (auth FAB, survival kit button, hints, footer)
```

**On login** (`onAuthStateChanged`): the server step is compared with the local step; the maximum is used. If the combined step is ≥ 12, all completion flags are silently set in localStorage before `_applyOnboardingGating()` runs — this prevents the tutorial popup from appearing on every login and ensures the FAB dock is always accessible for existing users.

**Tutorial skip**: available via the logo easter egg (5 taps). Instantly sets step to 12 and marks all flags, with a "✅ Tutorial skipped" toast.

### 2.11 Bipolar Anonymous Board

`anonymous.html` provides a verified-anonymous community chat board. Users must:
1. Be signed in to BipolarBear (Firebase Auth)
2. Verify their account email address via a one-time 4-digit code

The email address is locked to the Firebase account email and cannot be changed in this flow. If a user needs to change email, they do so via the account modal in the main app.

#### Verification flow

```
User opens anonymous.html
      │
      ├─ Not signed in? → show error with link to sign in; block access
      ├─ Already verified (bbAnon_verified = 'true')? → skip to board
      │
      └─ Show verify UI
            Email field pre-filled and read-only (locked to account email)
            │
            User taps "Send code"
            │
            ▼
      sendAnonCode Cloud Function
            ├─ Rate limit: max 3 codes per email per 10 minutes
            ├─ Generate 4-digit code
            ├─ Write to anonVerify/{sessionId} (TTL: 10 min)
            └─ Send email via Resend API
            │
            ▼
      User enters 4-digit code (paste-to-fill supported)
            │
            ▼
      verifyAnonCode Cloud Function
            ├─ Look up sessionId in anonVerify collection
            ├─ Check code matches, not expired (10 min), not already verified
            ├─ Set anonVerify/{sessionId}.verified = true
            └─ Return success
            │
            ▼
      localStorage.setItem('bbAnon_verified', 'true')
      → Boot the board (initBoard)
```

#### Error codes from Cloud Functions

| Code | Meaning |
|---|---|
| `functions/unauthenticated` | Wrong verification code |
| `functions/deadline-exceeded` | Code expired — auto-resend triggered |
| `functions/resource-exhausted` | Rate limit hit — redirect back to email step |
| `functions/not-found` | Session not found — redirect back to email step |

#### Board features

- Posts listed newest-first, real-time Firestore listener
- Reactions (emoji) per post
- Report post (flags for admin review)
- Admin accounts (`profile.isAdmin`) can soft-delete posts
- `bbAnonLastVisit` timestamp written to localStorage when the board loads; used by `index.html` to show "X new messages" badge under the Anonymous button

#### Announcements are admin-only; members suggest

Publishing to the **Announcements** tab is restricted to the admin account
(`ADMIN_EMAIL` in `js/anonymous.js`). When anyone else composes on that tab the
sheet switches to *suggestion* mode (`composeMode()` → `'suggest'`) and the text
goes to `bbAnonAnnSuggestions` instead of `bbAnonPosts`:

```
bbAnonAnnSuggestions/{auto}
  name, initials, grad1, grad2, streak, joinedAt   — author identity, as on a post
  text                                             — the suggested announcement
  status: 'pending' | 'approved' | 'rejected'
  timestamp, reviewedAt
```

Suggestions render as faded, dashed cards above the published announcements
(`renderSuggestion`, `.sugg-card`), and only for the two people they concern:

| Viewer | pending | rejected | approved |
|---|---|---|---|
| Admin | sees it, with **Publish** / **Refuse** | hidden | hidden (it's a real announcement now) |
| Author | "Waiting for approval" | "Not published" + Dismiss | hidden |
| Everyone else | hidden | hidden | sees the announcement |

A suggestion carries a monika, not an account, so "mine" can't be queried —
the author's own card is driven off `bbAnon_mySuggestions` (ids written on this
device). Members with no suggestions of their own and no admin flag never start
the listener at all. Publishing copies the suggestion into `bbAnonPosts` with
`tab: 'announcements'`, still credited to the member who wrote it (plus
`suggestedBy`), which is also what fires the new-announcement push.

The Firestore rules that enforce this live in `firestore.rules` (see
"Firestore rules" below): only the admin creates or moves a post into the
Announcements tab and reviews the queue; a member may delete a suggestion only
once it has been refused. The admin is the BipolarBear account
(`request.auth.token.email`) or a session that entered an email code for the
admin address (`bbAnonLinks`, written by `verifyAnonCode`).

### 2.12 Home Screen Badges (index.html)

Three sub-labels appear under the navigation buttons:

| Button | Element | Content |
|---|---|---|
| Mood Journal | `#journalStreakBadge` | `🔥 N days` — current streak from `bbCurrentStreak` |
| Your Survival Kit | `#survivalProgress` | `N / 13 sections complete` — counts filled localStorage sections |
| Bipolar Anonymous | `#anonMessagesBadge` | `💬 N new messages` or `✓ No new messages` (Firestore query since `bbAnonLastVisit`) |

All three use the shared CSS class `.btn-subnote` (bold, white, `font-size: 0.78em`). The Anonymous sign-in fallback note uses `.btn-subnote-muted` (same size but dimmed + italic).

### 2.13 Auto-complete Missing Entries

The "Missing Entries" modal (`showMissingDates()`) offers an **Auto-complete**
panel whenever 2+ days are missing. It creates one entry per gap day from data
the app already has, instead of making the user open the form N times.

```
Entry point:  #autoFillPromoBtn → showAutoFillModal()   (journal.js)
Input:        _missingDatesCache — the exact list the modal just rendered

Sources, per day, in priority order:
  1. Health (native only, and only when the health-sync toggle is on)
     _autoFillHealthData() runs TWO aggregated queries across the whole gap:
       queryAggregated({dataType:'steps', bucket:'day'})  → count
       queryAggregated({dataType:'sleep', bucket:'day'})  → SECONDS
     (queryLatestSample returns sleep in MINUTES — different unit, same plugin.)
     Aggregated sleep buckets a session under the day it STARTED, which matches
     the journal's model: an entry for day D covers the night at the end of D
     (see _sleepNotYet()). Totals outside 1–16h are discarded as unusable.
     Permissions are requested here, not just checked — the tap is deliberate.
  2. _autoFillTypicals() — median energy, median sleep and most frequent mood
     over the 30 most recent entries. Used for every day Health knows nothing
     about, which on the web build is all of them.
     A flat baseline by design: every such day gets the same values, and the
     estimate does NOT lean towards whatever was logged nearest to it.
     Recency-weighting the nearest entry was tried and reverted — it amounts to
     predicting mood swings, and inventing the shape of an unrecorded episode
     puts a story in the journal the user will read back as their own history.
     Repetition here is the honest signal, not a defect to smooth out.

Derived, never read directly from Health:
  mood    ← _suggestMoodFromHealth(steps, sleepH)   (same rule as focused
            mode's "best guess": 7–9h sleep short-circuits to stable)
  energy  ← _energyFromSteps(steps)                 (same mapping as the
            single-day steps import)

UI:       preview lists every day with its values and its source, each with a
          checkbox (all ticked by default) so the user can drop any day before
          anything is written. Confirm → _autoFillPersist().

Writes:   signed in → one encrypted Firestore batch (max 30 days, well under
                      the 500-write limit)
          guest     → encrypted localStorage, behind the same first-save PIN
                      gate as saveAndOpenJournal()
          No other field is filled: medication, notes, goals etc. stay empty.

Marking:  every entry carries autoFilled:true → an AUTO badge in the entry list,
          "Auto-filled estimate" in the PDF export and an Auto-filled column in
          the CSV. Editing and saving the entry clears the flag (saveEntry).
          A guess must never read as something the user reported — least of all
          in the PDF a clinician sees.
```

**One-day fill — yesterday, from the first step.** The same idea for the day
the journal is already pointed at, rather than a run of gaps:

```
Entry point:  ✨ Auto-fill from health — a button on focused mode's FIRST
              (mood) step → _fmAutoFillDay()

Shown when:   _fmCanAutoFillDay() — focused mode active, a new entry (not an
              edit), native build, health sync on, and the form's date is
              YESTERDAY. Today is excluded on purpose: its night hasn't
              happened (_sleepNotYet) and its step count is still mid-day, so
              there is nothing honest to estimate from. Older days belong to
              the bulk auto-complete above.

Reads:        one permission ask for READ_STEPS + READ_SLEEP (a tap is
              deliberate), then importSleepFromHealth(true) /
              importStepsFromHealth(true) — the same single-day importers the
              focused-mode steps use, in auto mode so neither asks again.
              Both are skipped when the silent sync on open already has the
              values. Nothing from Health at all → the button reports
              "No health data for yesterday" and the user stays on step 1.

Fills:        sleep  ← Health, as recorded
              steps  ← Health (saveEntry attaches it to the entry)
              mood   ← _suggestMoodFromHealth(steps, sleepH), mapped through
                       _FM_SPECTRUM_FOR_CAT when full-spectrum mood is on
              energy ← _energyFromSteps(steps)
              then jumps to the summary (done) step, which carries a note
              saying where the values came from.

Marking:      nothing is written without the user's Save, but what they are
              reviewing is still a guess, so the entry carries the same
              autoFilled:true / autoFilledSource:'health' as a bulk-filled day
              — unless they changed the mood, energy or sleep on the way
              through, which makes it their own report (_fmDayFillSnapshot →
              _fmDayFillIntact, checked in saveEntry). The snapshot is dropped
              on form reset, on focused-mode open and whenever the date
              changes.
```

---

### 2.14 Bipolar Anonymous Notifications

Four notifications, each behind its own switch in the board's settings sheet
(🔔 Notifications) and all sent by Cloud Functions over FCM:

| Preference | Fires on | Function |
|---|---|---|
| `replies` | a comment on a post you wrote (never your own comment) | `onAnonCommentCreated` |
| `announcements` | any post created with `tab: 'announcements'` — posted by the admin, or a member's suggestion they approved | `onAnonAnnouncementCreated` |
| `posts` | any member post created with `tab: 'general'` — never to the author's own devices; the daily topic (`isTopic`) and system cards don't count. Every one shares the collapse id `anon-new-post`, so a burst replaces the notification in the tray instead of stacking | `onAnonPostCreated` |
| `weekly` | Sunday 18:00 Europe/London; skipped entirely in a week with no posts | `weeklyAnonDigest` |

**No notification carries post or comment text.** A notification is read on a
lock screen by whoever is nearby; "someone replied to your post" is enough to
bring a member back, and it can't out them to the person next to them.

#### Client (`js/shared/anon-push.js`)

Asks for OS permission, gets an FCM registration token, and keeps one document
per token:

```
bbAnonPush/{fcmToken}
  prefs: { replies, announcements, posts, weekly }
  monikaLower   — the reply address: posts carry a monika, not an account
  emailHash     — sha256(email), the same key anonProfiles uses
  platform      — 'ios' | 'android' | 'web'
  bundle        — 'main' | 'anonymous'
  lang          — one of the ten locales; the sender picks its copy from it
  updatedAt
```

Three delivery paths, tried in order: `FirebaseMessaging`
(`@capacitor-firebase/messaging`) on either native platform;
`PushNotifications` (`@capacitor/push-notifications`) on Android only — its
iOS token is an APNs token, which `admin.messaging()` cannot send to, so iOS
without the first plugin reports unsupported rather than half-working; and web
push via `firebase-messaging-compat` + `firebase-messaging-sw.js`, gated on
`window.BB_PUSH_VAPID_KEY`.

Lifecycle:

- **Asked once**, right after a member's first post or reply (`maybeAskNotifications`):
  "Would you like to be notified when someone posts?", with New posts listed
  first and the other three beneath it. Nothing starts ticked: a member who
  has never chosen (`defaultPrefs()`) sees all four off and turns on what they
  want; a member with saved choices sees exactly those (only an explicit
  stored `'true'` reads as on, so a missing key is never a yes).
  Members who were subscribed before the posts switch existed, or who posted
  before notifications did, get the same sheet once on their next post or reply
  (`bbAnon_notifPostsAsked2`). Anyone who has declined is never asked again —
  declining sets `bbAnon_notifAsked2` + `bbAnon_notifPostsAsked2`, and settings
  is the way back in. Ticking nothing and accepting counts as declining.
- **Accepting only sticks if the registration was saved.** The switches are
  written locally after the `bbAnonPush` write succeeds, so a refused write
  (e.g. the Firestore rule not yet published) shows a failure toast instead
  of switches that are on while nothing can be delivered.
- **`refresh()` on every board init** — tokens rotate and permission can be
  revoked in the OS between visits. A revoked permission clears the local
  preferences and deletes the token document, so the sheet can't claim to be
  on while nothing is delivered.
- **Renaming a monika** rewrites the document (replies are addressed by
  monika); **signing out**, **deleting the account** and **turning the last
  switch off** delete it.
- Preferences are never stored when `isSupported()` is false — a switch that
  is on while nothing can be sent is a lie, so the sheet shows the reason
  instead.

Dead tokens are collected on send: FCM's
`registration-token-not-registered` (and the two invalid-token codes) delete
the document.

Setup that isn't in the repo — APNs key, `GoogleService-Info.plist` per bundle
id, plugin install + `cap sync`, and the Web Push VAPID key — is in
`NOTIFICATIONS.md`, along with the Firestore rules for `bbAnonPush`.

### 2.15 Bipolar Anonymous Auto-translation

The board is one community reading in ten languages. Before this, a post
written in Portuguese was simply unreadable to most of the people who might
have answered it. Member-written text is now translated into whatever language
the reader has the app set to, with **the original always one tap away** —
nothing is ever quietly swapped for a machine's version of it.

What is translated: posts, daily topics, announcements, member-suggested
announcements and comments. What is not: the app's own copy, which is
hand-translated in `js/shared/i18n.js`, and the Wiki tab, which is curated UK
resources (NHS, Bipolar UK, Mind) whose wording is deliberately theirs.

#### How it hangs together

```
renderPosts() / openThread()          markup carries data-tt on member text
        ↓
BB.translate.scan(el)                 js/shared/translate.js
        ↓  cache hit → applied synchronously (no flicker on re-render)
        ↓  miss → batched (60ms, ≤30 texts, ≤10k chars per call)
translateAnonTexts                    callable, europe-west1
        ↓  Firestore cache hit → returned
        ↓  miss → Cloud Translation API v2 (auto-detect source)
bbAnonTranslations/{sha256(target+text)[:40]}
```

**Translation happens on read, never on write.** A post is stored once, in the
language it was written in; only the languages someone actually reads it in are
ever paid for. Nothing about a post changes when it is translated — no new
field, no second copy on the post document.

#### The DOM contract

`js/shared/translate.js` translates any element carrying `data-tt`, wherever it
came from. A new kind of card gets translation by adding that one attribute and
calling `BB.translate.scan()` on its container after rendering — the render
functions don't know translation exists.

| Attribute | Written by | Means |
|---|---|---|
| `data-tt` | the render functions | this element holds member-written text |
| `data-tt-orig` | `scan()` | the text as written, kept for the toggle |
| `data-tt-key` | `scan()` | `<lang>:<hash>` — the cache key, and what the toggle acts on |

A translated element gets a `.tt-bar` inserted after it: "Translated from
Português" and a **Show original** / **Show translation** button. Toggling acts
on the *key*, so the same text showing twice (a post and a quote of it) moves
together. A text already in the reader's language gets no bar at all — the
backend reports it unchanged and nothing on screen moves.

#### Caching, in three places

1. **Firestore** (`bbAnonTranslations`, server-written only) — content
   addressed on `sha256(target + text)`, so the board buys each (text,
   language) pair **once, for everybody**. On a board where most posts have
   already been read, almost every call is a Firestore read rather than a
   translation.
2. **localStorage** (`bbAnonXlateCache`, 400 entries, oldest dropped) — so a
   re-render, a tab switch or the next visit applies translations
   synchronously and never flickers back to the original.
3. **In memory**, for the life of the page.

A result marked `same` (already in the reader's language) is cached too — an
English post on an English board is asked about once per device, ever.

#### Limits in the code

These bound a single caller, not the bill — see "What it costs" for the
ceiling that actually holds.

- Per call: ≤40 texts, ≤2000 characters each, ≤16000 total.
- Per caller: 120 000 translated characters a day
  (`bbAnonTranslateUsage/{uid}`, keyed by UTC day so it resets without a
  sweep). Only cache **misses** are charged, so a reader scrolling a board
  everyone else has read spends nothing. Over budget → the client is told, and
  stops asking for the rest of the session.
- Auth is required (anonymous Firebase auth counts — every board reader has a
  session by the time they can read a post).

#### Setup — owner-gated

The function needs the **Cloud Translation API** enabled, with billing active.

⚠️ **Both console steps are in the Google Cloud console, not Firebase.** They
are two consoles onto the same project (`bipolarbear-app`); quotas exist only
on the Cloud side. Firebase's Project settings → Users and permissions tab
looks like the right place and is not — it only does roles.

1. **Enable it** — [console.cloud.google.com/apis/library/translate.googleapis.com?project=bipolarbear-app](https://console.cloud.google.com/apis/library/translate.googleapis.com?project=bipolarbear-app)
   (the long way: Google Cloud console → project `bipolarbear-app` → APIs &
   Services → Enable APIs → "Cloud Translation API").
2. **Cap it** — [console.cloud.google.com/apis/api/translate.googleapis.com/quotas?project=bipolarbear-app](https://console.cloud.google.com/apis/api/translate.googleapis.com/quotas?project=bipolarbear-app),
   which is the Quotas tab on the Translation API itself, already filtered to
   it (the long way: ☰ → IAM & Admin → **Quotas** → filter by service). The row
   is **"v2 and v3 general model characters per day"** — the function calls the
   v2 endpoint with no `model` parameter, so the general (NMT) model is what it
   bills against. Tick it → **Edit Quotas** → a number you are happy to pay
   for. Ignore anything saying *custom model*, *AutoML* or *Translation LLM*
   (different products, unused here), and leave the **per minute** sibling
   alone — that is a burst limiter, and lowering it makes normal use fail
   intermittently without capping anything.

   **A number to start from: 50 000/day.** The free tier works out at ~16 400
   a day; this board today runs ~9 000 across three languages, or ~30 000 if
   all ten are represented. 50 000 leaves real headroom and caps the worst case
   near $20/month. The default is effectively unlimited — a billion a day — so
   this is adding a ceiling, not tightening a sensible one. See "What it costs"
   below for why this, and not a budget alert, is the ceiling that holds.

   Hitting the cap is safe but **silent**: the API refuses, the function
   reports `unavailable`, and posts read as written. If translation ever seems
   to have stopped, check this quota first.
3. Nothing else in the console: the function authenticates as its own default
   service account through `google-auth-library`. No API key, no secret.
4. Deploy: `firebase deploy --only functions:translateAnonTexts`. Pushing to
   `main` deploys the web build through Cloudflare Pages; it does **not**
   deploy Cloud Functions.

Until that is done the function returns `unavailable: true`, the client stops
asking, and **every post reads exactly as it was written** — the board works as
it did before, and the settings sheet says translation is unavailable rather
than pretending.

No Firestore rules change is needed: both new collections are written by the
Admin SDK, which bypasses rules, and no client reads them directly.

#### What it costs

Cloud Translation Basic (v2) is **$20 per million characters**, with the first
**500 000 characters a month free** — a standing monthly allowance, not a
trial credit. Characters are counted on what is *sent*; auto-detection is part
of the translate call, not a separate charge. A text that turns out to be
already in the reader's language **still costs** the characters it took to
find that out — once per language, after which the cache answers for ever.

Because `bbAnonTranslations` is keyed on the text rather than the post, the
board pays for each (text, language) pair **once, for everybody**. Only the
first reader of a post in a given language costs anything; every reader after
them is a Firestore read. At roughly 20 new posts and replies a day of about
150 characters each:

| Who is reading | Characters/month | Cost |
|---|---|---|
| members across ~3 languages | ~270k | £0 — inside the free tier |
| all ten languages represented | ~900k | ~$8/month |
| ten times the posting volume, all ten languages | ~9M | ~$170/month |

**The per-caller daily budget is not a spending cap.** 120 000 characters a day
per uid raises the bar against a scripted client, but anonymous Firebase uids
are free to mint, so it bounds one caller, not the bill. A Cloud **budget
alert** doesn't stop anything either — it emails after the money is spent. The
only hard ceiling is the API **quota** in step 2: past it the API refuses, the
function reports `unavailable`, and the board falls back to reading as written,
which is the same degraded state it already handles.

#### Settings

A new **🌐 Language & translation** sheet (`ov-translate`), reached from the
moniker settings sheet, holds two things:

- **App language** — the board had no language picker at all before this; the
  shared `BB.i18n.showPicker()` overlay is the main app's orange, so the board
  renders the same ten languages as yellow-themed chips. Choosing one fires
  `bb:languagechange`, which re-applies every `data-i18n` string, re-renders
  the feed, and puts translated posts back to the language they were written in
  before translating them into the new one.
- **Auto-translate posts** — on by default. Off restores every visible post to
  the text as written and removes the translation bars; nothing further is
  sent.

#### Privacy

Post text is sent to Google Cloud Translation, and nothing else is: no email
address, no moniker, no post id. It is disclosed in the privacy policy §6
(`privacy.s6li3`, all ten languages). Board posts were already plaintext on
Firestore — this does not change what a post is, only where its text is read.

### 2.16 My Safety Plan and the Low-Days Card

Both live in `js/shared/safety-plan.js` (loaded by index, journal and the
Survival Kit, after `i18n.js` and `crisis.js`; strings under `safety.*`). Pure
helpers are tested by `node scripts/test-safety-plan.js`.

#### My safety plan

Opened from the **🛟 My safety plan** banner under the Survival Kit's SOS
banner (not one of the 12 counted sections), from the low-days card, from
`survival-kit.html#safety-plan`, and — opt-in — from both PIN lock screens.
Seven sections in the Stanley-Brown order (the approach behind the NHS-backed
Staying Safe plan): warning signs, things I can do on my own, people and
places that take my mind off things, people I can ask for help (name +
number), professionals and services (name + number), making where I am safer,
my reasons for living. A full-screen dialog (`role=dialog`, focus trapped,
Esc closes) with a read view (tap-to-call contacts, then the country's crisis
lines and emergency number from `crisis.js`) and an edit view that saves on
every add / remove. All text goes in through `textContent`.

**Storage — and why.** The plan must open instantly, offline, and (if opted
in) before the PIN unlock, so the working copy is on the device
(`bbSafetyPlan`), like the rest of the Survival Kit. Signed in, it is also
written to the user's own `userSettings/{uid}` — but only as `safetyPlanEnc`,
AES-GCM ciphertext under the same end-to-end data key as the journal entries
(`sessionStorage.bb_user_key`, placed there by `js/journal.js`). So the plan is
unreadable to anyone else even if the Firestore rules were loosened, and it is
in no new or shared collection. The module never calls SecureStorage itself
(the journal reads the Keychain once per session; a second caller could take
that attempt away), so until the journal has run in this session the plan
just stays local and is pushed later (it retries for ~20 s after sign-in).
Guests: device only. Sync rule: a device that has never synced takes the
account's copy if it has content (the `guest-data.js` "never overwrite the
account" rule); after that the newer `updatedAt` wins. Cleared on logout and
reset with the other Survival Kit data; `safetyPlanEnc: null` on reset.

**Lock screen (opt-in, unticked by default).** "Show my safety plan on the
lock screen" (`bbSafetyPlanOnLock`) un-hides a `.bbsp-lockbtn` beside "Need
help now?" on `#guestPinOverlay` and `#pinOverlay`; it opens the plan
read-only (no Edit) above the lock (z-index 10005).

**Widget.** On native, each contact with a number gets a "Call from the
home-screen widget" tick (one at most). `BB.safetyPlan.syncWidget()` sends
`setSharedData({ safetyCall: JSON })` — `{kind: contact|crisis|none, title,
name, sub, tel, empty}`, already localised — on every page load and save. With
no contact ticked the widget offers the country's first crisis line. The
native "Call for support" widget is in `bipolarbear-native`.

#### The low-days card

The journal calls `BB.lowMoodSupport.evaluateEntries(entries)` after each
`loadEntries()`. Rule: of the last **5 logged days within the last 10**
(auto-filled estimates ignored; one mood per day, the latest), **3 or more were
Depressed** (the lowest of the five moods, 0–1 on the spectrum) **and the most
recent is still Low or Depressed**. Low alone never triggers it — people with
bipolar log Low often, and crisis lines for an ordinary low week would be
alarming and would soon be ignored. When due, the journal stores only the
date (`bbLowMoodDue`); the home page reads that and never sees moods.

The card (`#lowMoodSupportSlot` on home and in the journal) is calm and
dismissible: "It looks like things have been hard lately", up to two of the
person's own contacts (or the Personal Details emergency contact), then up to
two crisis lines for the country, a button to open or make the plan, **Not
now** and **Don't suggest this again**. Never a pop-up, never a push. At most
once every 4 days: once shown it stays for the rest of that day until
closed, then not again for 4 days. Never drawn while a PIN overlay is up.
Off via Journal → Settings → Journal Options → "Don't suggest support when
I've had low days" (`bbLowMoodSupportOff`, unticked = suggestions on). Device
only; nothing is synced. Wording follows the Samaritans guidance for online
services: kind, no assumptions, short, two or three signposts, 24/7 services,
the person in control.

### 2.17 Universal ID sign-in (the UNI·SIM account)

**Added 2026-10-05**, at James's ask: "a Universal ID front door, Firebase stays
behind it". People sign in with Universal ID, the UNI·SIM account (Supabase
Auth on the shared suite project), and get their Bipolar Bear **Firebase**
account behind it. Firestore, its rules and the journal's end-to-end
encryption are unchanged underneath.

```
fab.js sign-in sheet                     js/shared/universal-id.js (BB.uid)
  email ─► "Email me a sign-in code" ─►   POST /auth/v1/otp      (Supabase)
  code  ─► 6 digits                  ─►   POST /auth/v1/verify   → UID session (localStorage bbUidSession)
                                     ─►   uidSignIn (Cloud Function) ─► Supabase /auth/v1/user
                                                 │
            uidLinks/{supabaseUserId} exists ────┼─► custom token for that Firebase uid
            Firebase account with this email,    │
              has a password ────────────────────┼─► { status: 'link' } ─► "Connect your Bipolar
                                                 │      Bear account": its password, once,
                                                 │      then uidLink joins the two
            none ────────────────────────────────┴─► createUser({email, emailVerified}) + link
                                                     ─► custom token (created: true)
  signInWithCustomToken ─► the page's onAuthStateChanged as usual
```

- **Routes on the sheet.** The main route is the emailed code, and it makes new
  accounts too (no separate sign-up). "Use a password instead" tries a **Bipolar
  Bear** password first (most people with a password have one), then a
  **Universal ID** password. The old route still works, so nobody is locked out.
- **Joining an existing account needs its password, never just the email.**
  `personalDetails` is stored unencrypted, and an address can have been
  registered by someone who never owned it. `uidLink` insists on a Firebase
  *password* sign-in less than 15 minutes old with the same email.
- **`uidLinks/{supabaseUserId}`** holds `{ firebaseUid, email, via, linkedAt }`.
  Only Cloud Functions read or write it (the rules deny every client). A link
  whose Firebase account has been deleted is removed at the next sign-in. An
  account with no password is adopted only if no *other* Universal ID is joined
  to it, so someone who changed their Universal ID email can't lose their
  account to the address's next owner.
- **Email kept in step.** Each `uidSignIn` copies the Universal ID's (confirmed)
  email onto the Firebase account and marks it verified. That is what lets the
  Bipolar Anonymous board skip its own code (`isReal && user.emailVerified` in
  `boot()`) and what the rules' `tokenEmailHashIs()` reads.
- **The journal password.** A Universal ID sign-in carries no password, so the
  journal can't unwrap its data key at sign-in. `_promptJournalKey` in
  `js/journal.js` asks for it instead: **unlock** (the account has a wrap: for
  anyone who used Bipolar Bear before, it is the password they signed in with)
  or **choose** (no wrap yet: a new 8+ character password, saved with
  `journalPw: true`, after which any entries saved unencrypted get encrypted).
  It's asked once per device on native (Keychain) and once per browser session
  on the web. "Not now" goes back home, because a signed-in journal without its
  key could only show nothing and save unencrypted. This also closes two
  **older holes**. A password sign-in made on the home page never handed the
  password to the journal, so entries were hidden and new ones went up
  unencrypted (`saveEntry`, guest migration and auto-fill all fell back to
  plaintext). And accounts created on the home page never got a key at all.
  All three now refuse to write without the key. With `journalPw` set, a
  password sign-in whose unwrap fails no longer re-wraps over the journal
  password.
- **Two-step verification** (an authenticator app, set up on the UNI·SIM Hub).
  The emailed code or a password alone gives an `aal1` session. `uidSignIn` and
  `uidLink` refuse that session for any account with a verified factor, with
  `failed-precondition` and `details.reason: 'two-step'`. The server is the
  lock. The sheet's `twostep` step is the door: after the code or password it
  asks `BB.uid.twoStepFactor()`, then challenges and verifies over Supabase's
  `/factors/{id}/challenge` and `/verify`, which upgrades the session to
  `aal2`. A refreshed `aal2` session stays `aal2`, so deleting the account
  doesn't ask again. Every wrong code gets a fresh challenge, because Supabase
  burns one on the first try.
- **Managing the Universal ID** (password, email, two-step) happens on the Hub
  (`app.unisim.co.uk/profile`). Both account screens link to it ("Manage your
  Universal ID ↗") for a Universal ID-only account, or when a Universal ID
  session is present.
- **Account screens.** A Universal ID-only account (no `password` provider) has
  no Change password / Change email (`BB.uid.isUidOnly`). Deleting it signs in
  afresh from the Universal ID session (`BB.uid.refreshFirebaseSignIn`) instead
  of the password prompt. Deleting the Bipolar Bear account leaves the Universal
  ID alone, because other UNI·SIM apps use it (privacy.html §6 says so).
- **Privacy.** Supabase is told nothing about Bipolar Bear: no redirect URL, no
  metadata, no product code. The user-count beat stays anonymous, because
  privacy.html promises the install id "is never linked to your account". The
  Supabase ↔ Firebase join exists only in `uidLinks`.
- **Server setup.** `uidSignIn` mints custom tokens, which needs the functions'
  runtime service account (`566288727451-compute@developer.gserviceaccount.com`)
  to hold **Service Account Token Creator** (`roles/iam.serviceAccountTokenCreator`)
  on itself. Without it, `uidSignIn` answers `INTERNAL` at that step.
- **Not yet:** Google / Apple sign-in (needs the origins and native deep links),
  Universal ID on the Bipolar Anonymous page and app, and a "Change journal
  password" setting.

### 2.18 Standard and Private journals

**Added 2026-10-06** (James: "Can E2E be a choice? Not everyone wants a password and a passphrase"; Standard by default).

| | **Standard** (default) | **Private** (opt-in: Settings → 🔐 Private journal, unticked) |
|---|---|---|
| Wrap fields in `userSettings/{uid}` | `stdWrappedKey` + `stdWrappedKeyIv` (and the password wrap too, if it used to be Private) | `wrapSalt` + `wrappedKey` + `wrappedKeyIv` only (`journalPw: true`) |
| A new device | Opens with nothing to type: `journalWrapKey` returns the per-account key | Asks for the journal password |
| Forgotten password | Nothing lost | Journal lost: nobody can reset it |
| Who can read it | You, plus someone holding `JOURNAL_KEY_SECRET` **and** the database | Only you |

- The data key never changes. The two modes are only about what it's wrapped
  with. Entries are encrypted on the device in both.
- **`journalWrapKey`** (Cloud Function) returns HMAC-SHA256(`JOURNAL_KEY_SECRET`,
  `bb-journal-wrap:v1:<uid>`) to a signed-in, non-anonymous caller.
  ⚠️ **Never rotate or delete `JOURNAL_KEY_SECRET`**: every Standard journal
  would become unreadable. A copy is kept outside Secret Manager (see the
  handover).
- **Which mode:** `_keyModeOf(d)`: `stdWrappedKey` means Standard; a password
  wrap or `encSalt` alone means Private; neither means no key yet.
- **Getting the key without a password** (`_resolveUserKey`): Standard unwrap;
  else the Private unlock prompt; else create a Standard key. Creation runs in a
  Firestore transaction, so two devices can't mint two keys.
- **The password sign-in branch never mints a key for a Standard account.**
  It would split the journal.
- **The unlock prompt** has an unticked "Don't ask on my new devices again",
  which adds the Standard wrap.
- **Switching:**
  - Private → Standard: confirm, then add the Standard wrap. The password wrap
    stays, so the password and older app builds still open it.
  - Standard → Private: choose a journal password, wrap with it, then delete
    the Standard wrap.
- **Wording:** "end-to-end encrypted" became "encrypted on your device", with
  Private named as the way to make it unreadable even to UNI·SIM. This covers
  the sign-in sheet, the PIN screen's explainer, the security panel, the safety
  plan, the welcome pages, and privacy policy §10, in all 10 languages.
  ⚠️ **The store listings and screenshots** (`store-assets/`) still say
  end-to-end. That stays true for the store builds until a native release ships
  this; update them with that release.

## 3. Algorithm Flowcharts

### 3.1 Entry Save Flow

```
User clicks Save
      │
      ▼
showSaveConfirmModal()
      │
      ├─ editingEntry && no changes? ──▶ cancelEdit() ──▶ loadEntries()  [DONE]
      │
      ▼
Render summary (mood, energy, sleep, extras, notes)
Show modal
      │
User clicks "Save ✨" / "Update entry ✏️"
      │
      ▼
saveAndOpenJournal()
      │
      ▼
saveEntry()  [async]
      ├─ Build entry object from selected* variables
      ├─ currentUser?  ──YES──▶  Firestore: add() or set() on existing doc
      │                ──NO───▶  localStorage: entry:{timestamp}
      ├─ clearDraft()
      ├─ resetEntryForm()
      ├─ loadEntries()  ←── refreshes stats + entries list
      └─ nativeHaptic('success')
      │
      ▼
Open journalCard (if closed)
Scroll to #stats after 150ms  ←── deferred so DOM settles after loadEntries
```

### 3.2 Page Load & Entry Status (index.html)

```
Page loads
      │
      ├── IIFE runs synchronously
      │     ├─ Check localStorage bb_entryStatus
      │     │     ├─ key matches today/yesterday AND done=true?  ──▶ show tick  [DONE]
      │     │     └─ no match → continue
      │     └─ Scan entry:* localStorage keys (guest mode)
      │           └─ match found?  ──▶ show tick  [DONE]
      │
      └── Firebase onAuthStateChanged fires  [async]
            │
            ├─ user signed in?
            │     ├─ Load userSettings from Firestore
            │     │     ├─ Compute _finalStep (max of server + local onboardingStep)
            │     │     ├─ If _finalStep >= 12: set all completion flags before tick update
            │     │     ├─ Restore survival kit data to localStorage
            │     │     └─ Update survival tick; call _applyOnboardingGating()
            │     ├─ bb_entryStatus cache done=true for today? ──▶ skip query  [DONE]
            │     └─ Query Firestore: all entries where userId == uid
            │           ├─ find entry matching target date?  ──▶ set tick + cache  [DONE]
            │           └─ no match  ──▶ clear tick
            │
            └─ not signed in → show Sign In button, lock Anonymous button
```

### 3.3 Firestore Load with Retry (journal.html)

```
loadEntries()
      │
      ├─ Try cache (1s timeout)
      │     ├─ Success  ──▶ render with cached data  ──▶ also fetch server in bg
      │     └─ Timeout/fail  ──▶ show spinner, try server
      │
      ├─ Try server (3s timeout, or 8s if _isRetry, or 12s if isPostFailureReload)
      │     ├─ Success  ──▶ render, update cache
      │     └─ Fail
      │           │
      │           ▼
      │     _isRetry already set?
      │           ├─ YES  ──▶ set sessionStorage.bbReload = '1'
      │           │              window.location.reload()
      │           └─ NO   ──▶ retryLoadEntries()
      │                         show "🔄 Reconnecting…"
      │                         wait 2s, retry with _isRetry=true
      │
      └─ finally: hide spinners, show journal toggle button, _doInitialScroll()
```

### 3.4 Edit Entry Change Detection

```
openEditInForm(entry)  or  _openEditInFocusedMode(entry)
      │
      ├─ _captureEditState(entry)  ──▶  store JSON snapshot as _editOriginalState
      │
      └─ Populate form from entry values

User interacts with form
      │
      ▼
Event listener on entryFormCard (click / input / change)  [captured, bubbling]
      │
      ▼
_updateEditBtn()
      │
      ├─ _hasEditChanges()
      │     └─ JSON.stringify(_editCurrentState()) !== JSON.stringify(_editOriginalState)
      │
      ├─ Changes detected  ──▶ "Update entry ✏️"  (orange)
      └─ No changes        ──▶ "Close"             (grey)

User clicks button
      │
      ├─ "Close" (no changes)  ──▶  cancelEdit()  ──▶  loadEntries()
      └─ "Update entry"         ──▶  showSaveConfirmModal()  ──▶  saveEntry()
```

---

## 4. Mood Suggestion — How It Works

The mood suggestion is a **normalised weighted score** calculated from the fields the user has answered. Unanswered fields are excluded entirely — the possible range shrinks to match what was actually logged, so a missing field never pulls the result towards stable.

### 4.1 Scoring Table

Each answered field contributes a raw score within a defined range:

| Field | Response | Score | Range |
|---|---|---|---|
| **Energy** | Not enough (0) | −50 | −50 … +50 |
| | Less than usual (3) | −8 | |
| | Normal (5) | 0 | |
| | More than usual (7) | +8 | |
| | Too much (10) | +50 | |
| **Sleep** | ≤5h | +20 | −15 … +20 |
| | 6–7h | +5 | |
| | 7–8h | 0 | |
| | 8–9h | −8 | |
| | 9+h | −15 | |
| **Medication** | Taken | −8 | −8 … +8 |
| | Not taken | +8 | |
| **Irritability** | More than usual | +8 | −4 … +8 |
| | Normal | 0 | |
| | Less than usual | −4 | |
| **Anxiety** | High | −10 | −10 … +5 |
| | Normal | 0 | |
| | Low | +5 | |
| **Stress** | High | −8 | −8 … +4 |
| | Normal | 0 | |
| | Low | +4 | |
| **Alcohol** | Yes | +8 | 0 … +8 |
| | No | 0 | |
| **Goals** | Completed | +5 | −5 … +5 |
| | Some | 0 | |
| | None | −5 | |
| **Steps** | ≥15,000 | +10 | −10 … +10 |
| | 8,000–14,999 | +4 | |
| | 3,000–7,999 | 0 | |
| | 1,000–2,999 | −5 | |
| <1,000 | −10 | |

> **Direction:** Positive scores indicate manic/elevated signals (high energy, poor sleep, irritability, alcohol). Negative scores indicate depressed signals (low energy, long sleep, high anxiety/stress).

### 4.2 Normalisation Formula

```
total    = sum of all answered field scores
maxPoss  = sum of all answered fields' maximum values
minPoss  = sum of all answered fields' minimum values
range    = maxPoss − minPoss

normalised = ((total − minPoss) / range) × 200 − 100
```

This maps the result to **−100 … +100**, relative to the fields that were actually answered.

### 4.3 Mood Thresholds

```
normalised ≥  60  →  Manic
normalised ≥  25  →  Elevated
normalised ≥ −25  →  Stable
normalised ≥ −60  →  Low
normalised  < −60  →  Depressed
```

### 4.4 Worked Example

**Scenario:** User logs the following responses:

| Field | Response | Score | Min | Max |
|---|---|---|---|---|
| Energy | Too much (10) | +50 | −50 | +50 |
| Sleep | ≤5h | +20 | −15 | +20 |
| Medication | Not taken | +8 | −8 | +8 |
| Irritability | More than usual | +8 | −4 | +8 |
| Anxiety | Low | +5 | −10 | +5 |

**Step 1 — Sum the scores:**
```
total = 50 + 20 + 8 + 8 + 5 = 91
```

**Step 2 — Sum the ranges:**
```
maxPoss = 50 + 20 + 8 + 8 + 5 = 91
minPoss = −50 + −15 + −8 + −4 + −10 = −87
range   = 91 − (−87) = 178
```

**Step 3 — Normalise:**
```
normalised = ((91 − (−87)) / 178) × 200 − 100
           = (178 / 178) × 200 − 100
           = 200 − 100
           = 100
```

**Result:** `100 ≥ 60` → **Manic**

---

**Scenario 2:** More moderate responses:

| Field | Response | Score | Min | Max |
|---|---|---|---|---|
| Energy | Normal (5) | 0 | −50 | +50 |
| Sleep | 7–8h | 0 | −15 | +20 |
| Medication | Taken | −8 | −8 | +8 |
| Anxiety | Normal | 0 | −10 | +5 |

**Step 1:**
```
total = 0 + 0 + −8 + 0 = −8
```

**Step 2:**
```
maxPoss = 50 + 20 + 8 + 5 = 83
minPoss = −50 + −15 + −8 + −10 = −83
range   = 83 − (−83) = 166
```

**Step 3:**
```
normalised = ((−8 − (−83)) / 166) × 200 − 100
           = (75 / 166) × 200 − 100
           = 90.4 − 100
           = −9.6  →  rounded to −10
```

**Result:** `−10` falls in `−25 … +25` → **Stable**

---

### 4.5 Design Decisions

**Why exclude unanswered fields rather than score them as 0?**
Scoring missing fields as 0 would treat them as "normal" responses and bias the result towards stable. A user who only answers energy and sleep gets a result based purely on those two signals — their possible range is just ±70, not ±100.

**Why are energy extremes (0/10) scored at ±50 but middle values (3/7) only ±8?**
Very high or very low energy are among the strongest clinical indicators of a mood episode. A mild deviation from normal energy is much less diagnostic. The non-linear scale ensures extremes dominate appropriately without middle-ground values overwhelming other signals.

**Why does medication taken score negative (−8)?**
The score axis is manic (+) / depressed (−). Medication adherence is a stabilising/grounding behaviour — it signals the depressed direction on this axis, not because medication causes depression, but because it counteracts the manic signals.

**Why is this labelled BETA?**
This is a pattern-recognition heuristic, not a clinical diagnostic tool. It is designed to prompt self-reflection and spark conversation, not to replace professional assessment.
