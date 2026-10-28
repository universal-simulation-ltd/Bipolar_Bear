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

- **FAB dock** — up to 4 configurable floating action buttons (Chat, Game, Feedback, E2EE, Coffee, Review, Stats, Celebrity, Goals, Quick Note). Default dock (2026-10-12): 🆘 Crisis Support · empty `+` · 🕹️ Bear Arcade · 📣 Send Feedback; E2EE, Coffee and Review are `auto: false` defaults, docked only from the picker
- **🕹️ Bear Arcade** — `js/shared/bear-arcade.js`, loaded on the first tap (`openArcade()`): a random retro game (Bear Snake, Flappy Bear, Bear Bricks, the bipolar-themed Stay Stable, Self-care Catch and Sleep Guard, and the memory games Bear Says, Mood Pairs and Mood Week), never the one played last, drawn with `images/moods/sm/*` and the mood colours. Add a game by writing a factory and listing it in `GAMES` (see the file header). **Easter egg on Bipolar Anonymous (v371):** five taps on the board's top-left logo within 2.5 s open the same arcade (`_boardLogoTap` / `_openArcade` in `js/anonymous.js`, no "Hide this button"). Where that logo also goes back to Bipolar Bear, a single tap still does, after 350 ms. `scripts/build-anonymous.js` copies `bear-arcade.js` into the Anonymous app. Announced in the suite changelog (2026.10.20.17). Test: `scripts/test-anon-arcade.mjs` (5)
- **Account modal** — sign in, sign up, change password, change email, personal information, delete account
- **Stats modal** — mood distribution, correlations, AI feedback
- Dock layout persisted in `localStorage` (`bbFabSlot_1` … `bbFabSlot_4`); hidden buttons tracked per-key (e.g. `bbWaFabHidden`)
- **Locked dock** (`bbFabsUnlocked !== '1'`, before the first journal entry): only the centre auth FAB and the 🆘 Crisis Support FAB (slot 1) show, no footer bar. The 🆘 shows even if `bbWaFabHidden` is set, and `openChatModal()` hides "Hide this button" while locked, so the only crisis link on the page can't be hidden. (Replaced home's `#firstRunHelp` "Need help now?" pill, v291.) The PIN lock screen keeps its own "Need help now?" pill (`openChatModal(true)`).

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
    secureEnc           {_enc,_iv,v,updatedAt} — since 2026-10-12 (§2.20): the
                                          sensitive fields currentMedList,
                                          moodDefinitions, moodMemories,
                                          copingStrategies, myCommitments,
                                          customReminders, survivalGratitude,
                                          rememberThis, medHistory (v343) — no
                                          longer stored as plaintext fields
    logoVariant         number          — 0|1|2 (easter egg logo index)
    onboardingStep      number          — highest tutorial step reached (0–12)
    tutorialToastShown  bool            — "tutorial complete" popup has been shown
    homeSurvivalEnabled bool            — home 🆘 button on (§2.10); only read once homeBtnsVersion ≥ 2
    homeAnonEnabled     bool            — home 💬 button on (§2.10); same rule
    homeBtnsVersion     number          — 2 = the 2026-10-23 home-buttons migration reached this account
    personalHintDone    bool            — personal info hint dismissed
    survivalKitVisited  bool            — user has visited the survival kit (deprecated — now localStorage only)
    firstName           string?         — deprecated; name now from personalDetails
    safetyPlanEnc       {_enc,_iv,updatedAt}? — My safety plan (§2.16), AES-GCM under the
                                          journal's E2E data key; the plaintext never
                                          leaves the device. null after a reset.

personalDetails/
  {uid}                    — since 2026-10-12 only: secureEnc {_enc,_iv,v,updatedAt}
                             + updatedAt (AES-GCM of the fields below; §2.20).
                             Older store builds may still add the plaintext
                             fields; the next current-build sync folds them in.
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
  to false once those builds are no longer in use. legacyAdminClients() next
  to it lets a device write an admin-label post (isAdmin: true) itself, as
  every build up to 1.41 / 1.40 does; current clients use adminAnonPost
  (§2.20). Only the admin is affected, so set it to false once the admin's
  own devices run a later build. The suite runs three rule sets: legacy,
  strict (both switches off) and adminStrict (only the admin switch off).

bbAnonAdminAuthored/
  {path with '/' → '__'}  — Cloud Functions only (adminAnonPost, createAnonPoll,
                            the anonOwnerOn* triggers, privacySweep)
    path        string    — the admin-label post or reply
    postId      string
    uid         string    — the admin session that wrote it
    createdAt   Timestamp
  Never readable by clients. Admin-label posts carry no owner, so this is
  how account deletion finds them; onAnonPostDeleted and privacySweep remove
  records whose post is gone.

bbAnonLinks/
  {uid}                   — written by verifyAnonCode / anonProfileId (Admin SDK) only
    emailHash   string    — sha256(email) this session proved with a code
    emailHashes string[]  — every address this session proved (code or account)
    profileIds  string[]  — board profiles it owns ('p2_' + HMAC, §2.20)
    profiles    map       — emailHash → profileId (for moving old profiles)
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
next visit. Run it signed in as the admin account (any other caller is
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

> ⚠️ **Since 2026-10-12 (privacy round, §2.20) these apps send no beat and
> mint no install id** — only the read below, and only after someone taps the
> line to the suite figure. The rest of this section describes the old beat.

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
bbJournalRange          "30"|"90"|"180"|"365"|"all" — the Your Journey range tabs' default;
                                        set by a double tap on a tab (tapJournalRange in
                                        js/journal.js, orange mark; v294 — it was "tap the
                                        range showing" + ★). Pinch / wheel zoom never sets it
bbBloodOnCharts         "1"           — "Show blood results on my charts" (§2.25; unticked = absent)
bbBloodChartsAsked      "1"           — the one-time "Show this on your mood charts?" was offered
bbBloodChartTest        string        — the test the life chart's line shows (picker; §2.25)
bbBloodDueReminder      "1"           — remind me on the day a blood test is due (phone app)
bbMedsReminder          "1"           — medicine reminders on (the master switch; §2.27)
bbMedsReminders         JSON          — {"<medicine, lower case>": ["HH:MM", …], "*": […]}:
                                        each medicine's reminder times, this device only (§2.27)
bbMedsRemindNames       "1"           — name the medicines in the reminders (unticked = absent)
bbMedsTaken             JSON          — {day, slots: ["HH:MM"]}: ✅ Taken today, per time
bbWhatsNewSeen          "1.45"        — newest release whose New features sheet was shown or
                                        skipped (§2.25); Reset clears it, so it shows again
bbJournalView           "calendar"|"life" — the Your Journey card's default view; set by a
                                        double tap on the Calendar / Life chart switch (the
                                        suite's useDefaultView gesture, orange mark; v293)
                                        Under the month calendar: the last 12 months as boxes
                                        (v363, _monthBoxesHtml). A tap sets _journeyAnchor (not
                                        saved): the stats end with that month and go back the
                                        range's months (1M = it, 3M = it + 2 before, 6M, 1Y);
                                        "Back to today" clears it; All ignores it; the life chart
                                        and feedback keep counting from today.
                                        scripts/test-journey-months.mjs

── Settings ─────────────────────────────────────────────────────────────────
journalDefaultToday     "true"|null   — log today vs yesterday (no switch since v0.77: always yesterday, because an entry's sleep is the night after its day)
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
medHistory              JSON array    — dated medication-list changes (v343, §2.20);
                                        device copy of the encrypted secureEnc field
dailyGoals              JSON array    — cached goals
personalName            string        — cached from personalDetails
personalEmergencyContact string       — cached from personalDetails

── Achievements ─────────────────────────────────────────────────────────────
unlockedAchievements    JSON array    — list of unlocked achievement IDs

── Onboarding / Tutorial ────────────────────────────────────────────────────
bbOnboardingStep        string        — highest tutorial step (0–12); synced to Firestore
bbTutorialToastShown    "1"           — "tutorial complete" popup shown; synced to Firestore
bbFabsUnlocked          "1"           — FAB dock unlocked (set from step 1, the first entry)
bbSurvivalBtnEnabled    "0"|"1"       — home 🆘 Survival Kit button; on unless "0" (Profile → Home buttons; synced)
bbAnonBtnEnabled        "0"|"1"       — home 💬 Bipolar Anonymous button; on unless "0" (synced)
bbHomeBtnsV             "2"           — the 2026-10-23 home-buttons migration has run here (§2.10)
bbHomeBtnsRestored      "1"           — that migration brought a button back: the 1.45 New features note
bbWelcomeShown          "1"           — first-ever welcome popup shown
bbSurvivalKitVisited    "1"           — user has opened the survival kit
bbSkVisited             JSON array    — info-only kit sections opened on this device (mood-scale,
                                        books, media, spiritual); they count towards "N / 12"
                                        only once opened (2026-10-16). Device only, cleared on reset
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
bbReviewFabHidden       "1"           — Leave a Review FAB permanently hidden
bbGameFabHidden         "1"           — 🕹️ Bear Arcade FAB permanently hidden
bbArcade                JSON          — {"last":"snake","best":{"snake":12,…}}; device-only, never synced
bbFeedbackName          string        — name typed into the feedback form (asked only when no personalName / account name)

── UNI·SIM suite counter (NOT bb-prefixed — shared with the whole suite) ────
unisim:install-id       uuid          — this install, as the suite knows it
unisim:user-count-scope "app"|"suite" — which figure the count line is showing
bbSuiteUserCountCache   string        — last known suite TOTAL (never the live one)

── Misc ─────────────────────────────────────────────────────────────────────
bbWebUnlocked           "true"        — beta gate bypass (web preview)
statsStartDate          string        — custom stats window start date
bbLogoEasterEggFound    "1"           — logo easter egg discovered
bbLastSeenVersion       string        — last app version shown in "What's New" popup
deletedCustomTrackers   JSON array    — custom tracker ids deleted with their data (§2.22); synced as
                                        userSettings.deletedTrackers so other devices can't bring them back
bbPrivacyNoteDismissed  "1"           — privacy note on home screen dismissed
```

#### sessionStorage Keys

```
bbPinUnlocked           "1"    — PIN verified for this session; cleared on pagehide
bbReload                "1"    — set before forced reload after Firestore failure
bbTrkCleaned            uid|"guest" — the tracker clean-up (§2.22) has run this session for that journal
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
- The index PIN screen's "🔐 More info" sheet (`#pinE2eeModal`) has two
  wordings: the account one (`pin.e2ee1/2`, Private journal + journal
  password) and, when no Firebase user is cached, the guest one
  (`pin.guestE2ee1/2`: the PIN is the only key, entries stay on the device).
  `_initPinLock` swaps the `data-i18n-html` keys so a language change keeps it
- The optional account PIN syncs as `userSettings/{uid}.pinHash`; the old plain
  `pinCode` field is deleted when an account signs in or the PIN changes. Builds
  before 2026-10-05 read only `pinCode`, so on those the synced PIN reads as off
- Wrong PINs: 5 in a row lock the keypad (30 s, then 1 / 5 / 15 / 60 min for each
  further miss), kept in `bbPinFails` / `bbPinLockUntil` so a reload doesn't reset
  it; "Forgot PIN?" still works while locked, and still needs the re-auth below
- **"Forgot PIN?" needs re-authentication** (James, 2026-10-09; v292) for the
  native app PIN (`idxPinForgot`, index) and the account PIN (`pinForgot`,
  journal) — `BB.pinReauth.confirm()` in `js/shared/pin-reauth.js`. Any one of:
  the phone's own lock (native: `@aparajita/capacitor-biometric-auth`, JS name
  `BiometricAuthNative`, `allowDeviceCredential: true`, so Face ID / Touch ID /
  fingerprint OR the device passcode; added to `bipolarbear-native` 2026-10-10,
  so only store builds after that have it); the Bipolar Bear password
  (`reauthenticateWithCredential`); or, for a Universal ID account (or one with
  a Universal ID session on the device), a fresh code emailed to the account's
  own address (+ two-step if set) then `BB.uid.proveAccount(uid)`, which asks
  `uidSignIn` for a token and only compares its `uid` claim (nothing is signed
  in). Only the PIN keys are cleared. Cancel / failure leaves the PIN and the
  lockout as they were. `pinForgot` waits for Firebase Auth first so a
  signed-in account PIN can't fall into the guest wipe. The guest PIN's
  Forgot (two confirms, wipes guest data) is unchanged. Check:
  `scripts/test-pin-reauth.mjs` (Playwright, fakes Firebase/Supabase; the
  native plugin is simulated — real biometrics need a phone)
- Re-lock: after 5 min idle, and when the page / app comes back after more than a
  minute in the background (`visibilitychange`, Capacitor `pause`/`resume`, and
  `@capacitor/app` `appStateChange` where installed) — `BB.pin.watchBackground`
- **Unlock with Face ID / Touch ID / fingerprint** (1.44, v353; `js/shared/bio-unlock.js`,
  `BB.bioUnlock`; strings `bio144.*`). Journal Settings → `#bioUnlockRow`, under 🔒 PIN /
  🔒 App lock: phone app only, shown while a PIN lock is on and `checkBiometry()` says
  biometrics are enrolled; **unticked by default** (`localStorage.bbBioUnlock = '1'`,
  this phone only, never synced). Turning it on runs one scan first. The lock screen
  (`#guestPinOverlay`) then offers the scan each time it comes up (a MutationObserver
  on the overlay; deferred while the page is hidden) and shows a Face ID / fingerprint
  button in the keypad's empty corner (`#idxBioBtn`). Biometrics only
  (`allowDeviceCredential: false`): the PIN is the fallback, and cancelling or failing
  leaves the keypad. "Forgot PIN?" still takes the passcode (pin-reauth.js).
  - The signed-in **app lock** (`bbNativePinEnabled`) only guards the screen, so a good
    scan is enough (`_idxPinRight()`).
  - A **guest PIN** is the encryption key. Turning the switch on keeps the session's
    PIN-derived key (`sessionStorage.bb_guest_key`) in the Keychain / Keystore as
    `bb_guest_bio_key` = `{salt, key}`, where the account journal's device key
    (`bb_user_key`) already lives. A scan puts it back in the session. A record for
    another salt (the PIN changed or was removed) is never used: it is deleted, the
    switch goes off and the lock screen says to type the PIN (`bio144.keyGone`).
    With no PIN lock left, `_syncBioRow` turns the switch off (and deletes the key).
  - iOS: `NSFaceIDUsageDescription` now names unlocking too (11 `InfoPlist.strings`).
  - Test: `node scripts/test-native-144.mjs` (Playwright, plugins simulated).
- Session unlock stored in `sessionStorage.bbPinUnlocked`
- `sessionStorage` is cleared on `pagehide`, so PIN is required every time the page is opened
- `bbPinLinkedUID` stores the Firebase Auth UID of the account that created the PIN
- On `onAuthStateChanged`, if the signed-in UID doesn't match `bbPinLinkedUID`, all PIN keys are cleared and the overlay is hidden — prevents a different account from being locked out by another user's PIN

#### A guest without a PIN, and the signed-in App lock (2026-10-17, v345)

James: "Could we give the user the choice to NOT set a PIN? Maybe they prefer
less security for the convenience", then "Can signed in users opt out of the
pin lock screen?". Strings: `pin143.*`, all 10 languages.

**Guests.** The guest PIN is the key their entries are encrypted with
(`bbGuestPinSalt`, PBKDF2 → AES-GCM, `_guestEncrypt`). Now it's a choice:
- The first save (also the import and missing-days auto-complete, which use
  the same gate, `_guestStorageReady()`) opens `#guestPinSetupOverlay` on its
  choice step: **Set a PIN (recommended)** (the keypad, as before), **Continue
  without a PIN** with the line "Your entries stay on this phone without
  encryption. Anyone who can open your phone can read them.", and **Not now**
  (saves nothing; the entry stays open). Buttons only.
- **Continue without a PIN** sets `bbGuestNoPin='1'` and is never asked
  again. Entries are then plain JSON in `entry:<ts>`, as before the PIN.
  `_guestStoreValue(plain)` is the one writer: encrypted when a salt exists
  (and it throws if the PIN is locked, so a locked PIN never writes
  plaintext), plain otherwise. Drafts (`bb_draft`) were never encrypted.
- **Journal Settings → 🔒 PIN** (`#guestPinRow`, guests only).
  - No PIN: **Set a PIN** goes straight to the keypad. The salt and PIN hash
    are saved first, then `_guestEncryptAll` encrypts every plain entry.
  - A PIN: **Remove PIN** asks for the PIN (same lockout as the keypad), then
    `confirm(pin143.removeConfirm)`. `_guestDecryptAll` decrypts every entry,
    and only then are the salt, `bbPinCode`, `bbPinEnabled` and the session
    key removed and `bbGuestNoPin` set.
- **Failure-safe.** Every entry is converted under its own key in one
  `setItem`, so it is always either its old copy or its new one. A new
  ciphertext is decrypted again and compared before it is written. An entry
  that changed meanwhile is skipped. Already-converted entries are skipped, so
  running it again finishes the job.
  - Remove first opens every encrypted entry. If one won't open with this PIN,
    nothing is written (`pin143.removeLocked`).
  - Remove repeats until no encrypted entry is left. That covers one saved
    while it ran. Then it drops the salt, with no `await` in between.
  - A stop part-way says `pin143.failPartial` ("{done} of {total}… Nothing was
    lost"). With a PIN set and unlocked, `loadEntries()` encrypts any plain
    entries it finds (the sweep), so a stopped Set finishes on the next load.
    `_guestConvertBusy` keeps the sweep away from a running Set / Remove.
- **Unchanged.** The PIN lock screen, the 5-minute and background relocks, the
  PIN gate one-liners, and the home mood strip and widget rule all key off
  `bbGuestPinSalt`, so a guest without one simply has no lock and keeps the
  strip. The journal's idle relock now checks the salt when it fires, so a PIN
  set or removed in Settings counts without a reload.
- **Elsewhere.** The home early-paint and badges treat `bbGuestNoPin` like a
  guest PIN ("a real guest"). The sign-in migration already took plain guest
  entries; it now also clears `bbGuestNoPin`. So do logout, Delete all and the
  guest Forgot PIN wipe.
- **Copy.** The 🔐 pop-up shows `pin143.securityNoPin` for such a guest and
  hides the three lines that aren't true for them. Privacy §3 has
  `pin143.privGuest`, and At a glance has a row for the journal without an
  account (inside `fix143.privGlanceTables`; the static English copy also
  lost a duplicated Bipolar Anonymous table and a stray `</div>`). The welcome
  page's "Encrypted on your device" card uses `pin143.f4Desc`.

**Signed in: Settings → 🔒 App lock (PIN)** (`#appLockRow`, off by default).
There was no way in the UI to set or turn off a lock: `openPinSettings` /
`openNativePinSettings` had no caller. It's one row with two backends:
- **In the app**, it is this phone's lock screen. That is
  `bbNativePinEnabled` with the PIN in the Keychain (`bb_native_pin`), which
  locks home, the journal and the survival kit. **Set a PIN**; **Change PIN**
  checks the current one first; **Turn off** asks for it, or **Forgot PIN?**
  takes the phone's own lock or the account (`BB.pinReauth`), as the lock
  screen does. The native PIN is per phone and isn't synced.
- **The account PIN** (`bbPinEnabled` + `bbPinCode`, synced as
  `userSettings.pinEnabled` + `pinHash`) is what older builds set. It doesn't
  lock this build for a signed-in user, because the auth listener unlocks it
  and only the journal flashed its overlay. So it is offered only to turn
  off, and on the web the row shows only while it is on. Turning off clears
  both and calls `_syncPinToFirestore()`, which writes `pinEnabled:false` and
  deletes `pinHash`. The auth listener takes the account's value on every
  load and never pushes its own, so every other device drops its copy on its
  next load, and a stale local copy can't turn it back on.
- Test: `node scripts/test-guest-pin.mjs` runs the real conversion, save and
  migration functions with real WebCrypto, with failures injected. The browser
  flows (first save, Set / Remove in Settings, a failing write, signed-in
  App lock on web and native) were run with Playwright; see the commit.

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

How it reads now (walked end to end by `scripts/test-tutorial.mjs`, 2026-10-23):

```
Step  0   — Home: welcome popup, then "🐻 Click here to get started!" over the
            Mood Journal button; only the journal on the home page. The
            journal opens in focus mode; a guest's first Save asks about a PIN.
Step  1   — First entry saved (journal.js). The dock unlocks (bbFabsUnlocked),
            and 🆘 Survival Kit + 💬 Bipolar Anonymous now show on the home page.
            Journal hint: "open your past entries" → Open Journal (blocking).
Step  2   — Journal list opened. Hint: close it (blocking).
Step  3   — Journal closed. Hint points at ← Home, which shows now, with the
            journal's 🧰 Survival Kit button beside it (step 6 before 2026-10-23).
Step  4   — Back home (← Home, Android back or the edge swipe). Skipped at
            once → 5 (the old sign-in step).
Step  5   — Logo hint "psst… click me!" (web / iPhone; Android → 6).
Step  6   — Logo tapped 5 times: easter egg (logo + icon change, confetti).
            It used to reveal the Survival Kit button; it no longer reveals anything.
Step  8   — Journal opened from home (_handleIndexJournalNav)
Step 9/10 — (removed; WhatsApp hint) → 12
Step 12   — Tutorial complete.
```

In practice steps 4–11 pass in one go: a home page load at 4–11 with
entries on the device (`bbHasEntries`) completes the tutorial, so a new user
goes 3 → 12 on returning home and sees the **finale**: guests get the
blocking "🐻 Sign in to back up your data (optional)" over the profile button
(which opens 👤 Profile — Customise, with all three home buttons already on),
then "Tutorial Complete 🎓", then the support hint over 📣. The logo hint
(5) only shows at steps 4–5 without entries on the device (e.g. signed out
part-way); tapping 🆘 Survival Kit also finishes the tutorial (→ 12).

**Home buttons** (James, 2026-10-23, reversing 2026-10-12): 🆘 Survival Kit
and 💬 Bipolar Anonymous are **on by default** and show from the first saved
entry (`BB.homeButtonsUnlocked()`: step ≥ 1 or entries on the device;
`BB.homeButtonOn('survival'|'anon')`: on unless `bbSurvivalBtnEnabled` /
`bbAnonBtnEnabled` is `'0'`; both in `js/shared/brand-config.js`, also behind
`BB.anonButtonShown()`, the widget's 💬 streak). 👤 Profile → 🏠 Home buttons
turns either off, synced as `homeSurvivalEnabled` / `homeAnonEnabled` with
`homeBtnsVersion: 2`. The NEW pill went with the old default.

**One-time migration** (`_migrateHomeBtnsLocal()` in `js/index.js`): the old
default was off and Customise wrote `false` for switches nobody touched, so a
stored "off" can't be trusted. On the first load of v379+ each device sets
both to `'1'` and `bbHomeBtnsV = '2'` (synchronously, before the login
read-back). The login read-back then uses the account's two values ONLY when
the account has `homeBtnsVersion >= 2`; otherwise it writes this device's
(migrated) values up with `homeBtnsVersion: 2`. Every Customise change also
writes the version. So the migration happens once per account; an "off"
chosen after it is kept, on that device and on any device that signs in
later, and an old un-migrated device can't write the old state back. When
it brings a button back for an existing user it sets `bbHomeBtnsRestored`,
and the 1.45 New features sheet has a note: "Survival Kit and Bipolar
Anonymous are back … To hide either, go to 👤 Profile → 🏠 Home buttons."
A full reset writes both `true` with the version.

**Completion flags set at step 12** (silently on login if already completed):
`bbTutorialToastShown`, `bbFabsUnlocked`, `bbSurvivalCelebDone`, and all hint keys.

**Key functions:**
```
_getOnboardingStep()          — reads bbOnboardingStep from localStorage
_advanceOnboardingStep(n)     — advances to step n if n > current; syncs to Firestore;
                                 shows "Tutorial Complete" popup on first reach of 12
_applyOnboardingGating()      — shows/hides elements based on current step
                                 (home buttons, hints, footer, quick check-in)
```

**On login** (`onAuthStateChanged`): the server step is compared with the local step; the maximum is used. If the combined step is ≥ 12, all completion flags are silently set in localStorage before `_applyOnboardingGating()` runs — this prevents the tutorial popup from appearing on every login and ensures the FAB dock is always accessible for existing users.

**Support hint** (2026-10-16): the "Tutorial Complete" popup has a line on
where help is (📣 → Support, or bipolar@unisim.co.uk). Dismissing it shows
`_showSupportHint()` once per device (`bbSupportHintShown`): a label over the
📣 button that opens the feedback popup on **Support**. Any other tap, or 8 s,
clears it. Support feedback asks a guest for an email, and the
`onFeedbackSubmitted` email to inbox@unisim.co.uk carries it as `reply_to`.

**Tutorial skip**: hold the logo for 5 seconds before step 12. Instantly sets step to 12 and marks all flags, with a "✅ Tutorial skipped" toast (no finale). At step 12 the same hold offers "Reset Dock?".

Test: `PLAYWRIGHT_MODULE=… node scripts/test-tutorial.mjs` — the walkthrough on
the web, an iPhone-like and an Android-like shell and in Spanish; reloads at
steps 1–3; the logo-hint path; the skip; Customise; the migration (local +
account, a later "off" kept across a reload and a fresh-device sign-in, an old
device signing in); the New features note; every language.

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
- **Android back** (1.44, end of `js/anonymous.js`; Bipolar Anonymous got
  `@capacitor/app` in 1.44): one press closes the top sheet or dialog as a
  backdrop tap would (`BB.a11y.closeTop()`; with the PIN check or the
  first-run language picker on top, back leaves instead), else the wiki search bar, else goes back to the previous board
  tab (a trail kept by wrapping `setTab`), else leaves: `index.html` in the
  Bear app, `App.exitApp()` in Bipolar Anonymous. Test: `scripts/test-native-144.mjs`.

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

#### Reports, SOS flags and bans (2026-10-16)

- **Reports and SOS flags reach the team.** Both write to `bbAnonReports`
  (create-only for clients). `onAnonReportCreated` (functions/index.js,
  europe-west1) emails `FEEDBACK_TO` through Resend: the type, the reason
  (one of the sheet's fixed four), the post and comment ids and a `?post=`
  link that opens the thread. Never the post text or a moniker (privacy.html
  §6, Resend). The board says "sent" only once Firestore has the write
  (`_sendModerationFlag`, 12 s timeout).
- **Bans.** A zero-tolerance breach means a permanent ban, anything else a
  temporary one: the ban sheet offers **Ban for 7 days** (`until` on the
  document) and **Ban permanently** (no `until`). `bbAnonBanned/{lower-case
  moniker}` is the admin's; the banned member's own app copies a live
  moniker ban to `bbAnonBanned/{p2_ profile id}` (`_syncMyBan`), so a new
  moniker doesn't escape it. The rules refuse posts, replies, post renames
  and new moniker reservations from a banned moniker or a banned profile
  (`authorBanned()`, via `bbAnonLinks.profileIds`), let a member write only
  their own profile's ban while their moniker is banned (never shorter), and
  let anyone delete a ban whose `until` has passed (clients do, so builds
  that don't read `until` stop applying it). Ban documents carry no
  `bannedBy`. Rules tests: `scripts/firestore-rules` (security, "bans").
- **Monikers** go through `findBlockedTerm` and `monikaRefused()`: no
  blocked words (also inside CamelCase), nothing that passes for the team
  (Admin, Moderator, Bipolar Bear, Support, Staff, in leetspeak, accents or
  Cyrillic/Greek lookalikes). "rape" / "rapist" are not blocked: survivors
  need to say what happened.
- **Offline.** The feed listeners watch `metadata.fromCache` and errors;
  five seconds on cache only, the phone offline or a dead listener shows
  "Can't reach the board right now" with Try again, and writing pauses. A
  refused post takes its card down and gives the text back.

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
id, plugin install + `cap sync`, and the Web Push VAPID key — is kept in
local notes, along with the Firestore rules for `bbAnonPush`.

### 2.15 Bipolar Anonymous Auto-translation

The board is one community reading in ten languages. Before this, a post
written in Portuguese was simply unreadable to most of the people who might
have answered it. Member-written text is now translated into whatever language
the reader has the app set to, with **the original always one tap away** —
nothing is ever quietly swapped for a machine's version of it.

What is translated: posts, daily topics, announcements, member-suggested
announcements, comments and the wiki's Community Wisdom highlights (members'
own posts). What is not: the app's own copy, which is hand-translated in
`js/shared/i18n.js`, and the Wiki tab's articles, which were translated once
instead (below).

#### The Wiki tab's articles: translated at build time, labelled

The wiki's curated UK material (NHS, Bipolar UK, Mind; 96 articles + the 12
Steps practice notes) is NOT translated on read. It was machine-translated once
and committed as `anon.wiki.a.<slug of the English title>_<field>` in
`js/shared/i18n.js` (July 2026), so it costs nothing to serve, works offline and
in the native shells, and every sentence can be reviewed in a diff. Links are
never part of the text, and phone numbers (999, 111, 116 123, 85258) and
organisation names (NHS, Bipolar UK, Samaritans, Mind, CMHT…) were kept as
written; a re-check on 2026-10-10 found none dropped in any locale. To change an
article, edit the English in `js/anonymous.js` AND its nine translations (the
slug is the key, so retitling an article orphans its translations).

Because the source wording is the authority, every translated article carries a
notice at the top of its body: "Machine-translated from the original English —
the original wording is the authority" (`anon.wiki.mtNotice`) and a **Show
original (English)** button (`_wikiMtBar` / `_wikiMtToggle`) that swaps that
article's title and body (and, on the 12 Steps, the Survival Kit's step
statement, read via `BB.i18n.tEn`) to English, marked `lang="en"`. The choice
is kept per article for the session (`_wikiShowOrig`). English readers, and
articles whose text reads the same in both languages, get no notice.
`scripts/test-wiki-translation.mjs` checks fr + de, light + dark.

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
  stops asking for ten minutes (it used to be the rest of the session, which on
  a phone is days).
- A failed call (offline, a phone that has just woken, a cold function) is
  retried by the client after 3 s, 10 s, 30 s and 90 s, and again when the
  network or the app comes back — not only on the board's next re-render. An
  answer is applied to every element on screen showing that text
  (`[data-tt-key]`), not just the ones that asked, because the board re-renders
  while a call is out (the listener's cached snapshot, then the server's) and
  the fresh card is skipped as already asked for. Before 2026-10-26 that left
  a Portuguese post untranslated on James's iPhone until something else on the
  board changed. Test: `scripts/test-translate.mjs`.
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
asking (for ten minutes at a time), and **every post reads exactly as it was written** — the board works as
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

**The app's PIN screen (opt-in, unticked by default).** "Show my safety plan
on the app's PIN screen" (`bbSafetyPlanOnLock`) un-hides a `.bbsp-lockbtn`
beside "Need help now?" on `#guestPinOverlay` and `#pinOverlay`; it opens the
plan read-only (no Edit) above the lock (z-index 10005). This is the app's own
lock, not the phone's: with no app PIN it does nothing.

**My medications (opt-in, unticked).** "Include my medications"
(`bbSafetyPlanMeds`) lists `currentMedList` (`{name, dosage}`, read-only here)
as a 💊 section after the plan's own sections, in the plan and behind the PIN
screen button. With it on, a plan with no sections of its own still counts as
something to show (`showsSomething()`).

**The phone's lock screen (native, opt-in, unticked).** "Show on my phone's
lock screen" (`bbSafetyPlanPhoneLock`) makes `syncWidget()` also send
`safetyLock: JSON` — `{on, title, meds, call, empty}`: the medications (only if
included) and the support number (the widget contact, else the crisis line).
Never the plan's sections, because anyone can read it there.
**The last few moods (opt-in, unticked, 2026-10-28, v388).** Under it, shown
only while it's ticked: "🐻 Include my last few moods"
(`bbSafetyPlanLockMoods`) adds `moods` to `safetyLock`, the 3 latest days of
the journal's device-only `bb_recentMoods` map as "Tue 27 Stable · Mon 26 Low"
(`lockMoods()`: localised day + date, never "Today", because the card is only
redrawn when the app runs; mood words from `mood.*`). Empty with an app PIN, a
guest PIN or Incognito Mode on (`_moodsBlocked()`, the journal's
`_recentMoodsBlocked()` rule; the journal also removes the map then).
`_writeRecentMoods()` in js/journal.js calls `syncWidget()` so a new entry
reaches the lock screen. Native shows it as a 🐻 line between 💊 and 📞.
iOS: the
"Safety plan" lock-screen widget (`SafetyLockWidget.swift`, accessory
rectangular / inline / circular, deliberately not `privacySensitive`); the
user adds it to the lock screen. Android: an ongoing PUBLIC, silent
notification on channel `safety_plan_lock` (`SafetyLockNotifier.java`, id
7001, re-posted on boot); ticking it asks for the notification permission.
Medications are saved from many pages, so `syncWidget()` also runs whenever
the app is put away (`visibilitychange` → hidden).

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
- **Privacy.** With the emailed code or a password, Supabase is told nothing
  about Bipolar Bear: no redirect URL, no metadata, no product code. Apple and
  Google (2026-10-19) need a redirect, so those sign-ins do tell Supabase this
  site's address or the app's `://auth-callback`; privacy.html §6 names Apple
  and Google. Apple's name is never asked for or kept. The user-count beat stays anonymous, because
  privacy.html promises the install id "is never linked to your account". The
  Supabase ↔ Firebase join exists only in `uidLinks`.
- **Server setup.** `uidSignIn` mints custom tokens, which needs the functions'
  runtime service account
  to hold **Service Account Token Creator** (`roles/iam.serviceAccountTokenCreator`)
  on itself. Without it, `uidSignIn` answers `INTERNAL` at that step.
- **Change journal password** (1.45): Settings → Account; see §2.28.

#### Apple, Google and passkeys (2026-10-19, v356; apps 1.44)

James: "add Google and Apple logins as we do for the app.unisim.co.uk - also
allow security keys". The sheet's email step shows **Continue with Apple**
(first: App Review 4.8), **Continue with Google** and **Use a passkey or
security key**, only where `BB.uid.signInOptions()` says they work (Supabase
`/auth/v1/settings`; on iPhone Google only alongside Apple; old native builds
without the plugin get none). Strings `signin144.*` in
`js/shared/i18n-signin.js`.

| | Web | iPhone | Android |
|---|---|---|---|
| Apple | `/authorize` + PKCE, back to this page `?uidReturn=1&code=` | system sheet → `id_token` grant (raw nonce) | Custom Tab → `com.bipolarbear.app://auth-callback?code=` |
| Google | same as Apple (Google's screen names the Supabase host) | ASWebAuthenticationSession → `com.app.bipolarbear://auth-callback?code=` | Custom Tab |
| Passkey / security key | `app.unisim.co.uk/passkey-handoff` → `#bb_passkey=<code>&state=` → `/verify` magiclink (aal1) | system passkey sheet, RP `app.unisim.co.uk` (aal2) | Credential Manager, RP `app.unisim.co.uk` (aal2) |

- **The same account, the same journal.** Every route ends in an ordinary
  Universal ID session, then the emailed code's path: `uidSignIn` →
  `uidLinks/{supabaseUserId}` → the same Firebase uid → the same
  `journalWrapKey` (keyed on the uid) and the same journal. Supabase links a
  verified provider address to an existing Universal ID with that email by
  itself. Nothing in `js/journal.js` knows how the person signed in.
- **Never a second account unasked.** After Apple, Google or a passkey the
  sheet calls `uidSignIn` with `create: false`. With no link and no Firebase
  account for the address, it answers `{ status: 'new', email, relay }` and
  makes nothing. The sheet's `new` step: **Start a new account** (asks again
  without the flag) or **I already have an account** (drops the session; back
  to the email step with a note that Apple / Google can be added on the Hub).
  `relay` = Apple's private relay address, worded on its own. An address with
  a Bipolar Bear password still gets `link`: the password once, never the
  email alone. Callers without the flag behave as before.
- **Codes only, and only ours.** The web return is redeemed only with the PKCE
  verifier this tab kept (`sessionStorage.bbUidPkce`, 15 minutes); the native
  callback only as a `code` for this app's scheme (tokens in a fragment are
  refused: on Android any app can fire that address). The passkey code only
  with the `state` this tab kept (`bbUidPasskeyState`): without it, anyone
  could send someone to Bear with their own code and have that person's
  journal saved into their account. Parameters leave the address bar at once.
- **Passkeys stay on RP `app.unisim.co.uk`** (moving it orphans every
  passkey). The website can't use WebAuthn Related Origin Requests: hosted
  Supabase refuses `webauthn_rp_origins` outside the RP ID ("hostname must
  equal the RP ID or be a subdomain"). So it uses the Hub page
  (`unisim-central` `src/lib/bearPasskey.ts`), which runs the ceremony
  without keeping a Hub session, swaps it for a single-use magic-link code
  (`session-handoff`) and comes back. That session is aal1, so an account
  with an authenticator app is asked for its code. The apps run the ceremony
  themselves: iOS reports origin `https://app.unisim.co.uk` (Hub AASA
  `webcredentials: ZH9C5TS86A.com.app.bipolarbear`, app entitlement
  `webcredentials:app.unisim.co.uk`); Android reports
  `android:apk-key-hash:8_dpwnbKY380XDiWogM_lI0T_gYQ14EtA7vApZP28pI` (Play
  app signing key, in `webauthn_rp_origins`; Hub assetlinks
  `get_login_creds`). Passkeys are added on the Hub, not here.
- **Session kept while the person decides.** `_hold` stops the "Firebase says
  nobody is signed in" sign-out from dropping a fresh provider session during
  the `link` / `new` / `twostep` steps.
- **Config (2026-10-19, Management API):** `uri_allow_list` +
  `https://www.bipolarbear.app/**`, `https://bipolarbear.app/**`,
  `com.app.bipolarbear://auth-callback`, `com.bipolarbear.app://auth-callback`;
  `external_apple_client_id` + `com.app.bipolarbear`; `webauthn_rp_origins` +
  the Android origin above. Apple App ID `com.app.bipolarbear`: Sign in with
  Apple and Associated Domains.
- **Native:** the app's own `BBSignIn` plugin (bipolarbear-native), not the
  SDK's `UnisimSuiteAuth`: Bear isn't on the suite signing key, and that
  plugin's `SUITE_AUTH` permission would clash on install.
- **Tests:** `node scripts/test-uid-providers.mjs` (the real `uidSignIn`,
  `uidLink`, `journalWrapKey` and `universal-id.js`, mocked network) and
  `scripts/test-signin-sheet.mjs` (the real sheet in Chromium, served at
  https://www.bipolarbear.app; needs Playwright).
- **Never on Bipolar Anonymous** (James, 2026-10-13): no Universal ID on the
  board's page or app, so it stays anonymous for people who download it on
  its own. The board's existing email-code link (`verifyAnonCode`) is unchanged.

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
  would become unreadable. The secret is stored in Secret Manager.
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

#### The device key never wins over the account's (2026-10-16)

A support case (2026-10-16): a journal looked empty on iPhone after an update,
though its entries were on Firestore all along.
- Builds before `_requireUserKey` saved entries **in plaintext** when no key
  was in hand, so some accounts had no key at all.
- On the first load of a current build, `_resolveUserKey` gives such an account
  a Standard key and `_encryptExistingEntries` encrypts everything.
- The device key lives in **one Keychain slot (`bb_user_key`) that belongs to
  no account**, survives deleting the app, and is cleared only by an explicit
  sign-out. Its read is raced against 3 s and tried once per session. A key
  left there earlier, which that load missed or the new key's write never
  replaced, was taken on the next load ahead of the account's key.
  `_decodeFirestoreEntry` then dropped every entry without a word.

Now (`js/journal.js`):
- `_checkDeviceKey(user, d)` runs once per load when a device key is in hand.
  For a Standard account it unwraps the account's key and, if the device's
  differs, adopts the account's (`_preferAccountKey`) and sets the device's
  aside in `_staleUserKeys` (memory only). An account with no key at all
  takes the device's key as its Standard key (in a transaction) and encrypts
  any plaintext entries.
- Every place that gets the key from the account (password unwrap, Standard
  unwrap, unlock prompt, a freshly created key) goes through
  `_preferAccountKey`, so a different device key never stays in charge.
- `_decodeFirestoreEntry` tries the set-aside keys after the current one. An
  entry only a set-aside key opens is re-encrypted under the account's key
  (`_reencryptUnderAccountKey`, once the key is verified).
- Entries nothing opens are counted (`_undecryptableCount`) and shown above
  the list (`journal.undecryptable`). An all-undecryptable journal no longer
  shows "No entries yet" or the import offer.
- After a password reset, the device key may replace the password wrap only
  if it opens one of the account's entries (`_keyOpensAccountEntries`).
- Private accounts can only be checked with their password, which the
  sign-in branch does.
- Test: `node scripts/test-journal-key.mjs` runs the real functions against a
  mocked Firestore.

#### The Keychain slot is never written over (2026-10-22, v377, 1.44 build 64)

Second support case, the same user (2026-10-22): 32 entries, all encrypted in
one batch by 1.42 on 2026-10-15 and never rewritten since. The account's
Standard key didn't open them on the web or on TestFlight 1.44 (63).
- **Cause:** the set-aside key above lived only in memory. Adopting the
  account's key (`_adoptUserKey` → `_userExportKeyToSession`) wrote it into
  `bb_user_key`, over the device key. That included a load whose 3 s Keychain
  read had timed out, where the device key was never read at all. Once the
  slot was overwritten, the only key for those entries was gone.
- **Now:** `_userExportKeyToSession` reads the slot first. A different key
  goes to **`bb_user_key_stale`** (a JSON list of base64 keys, newest 8)
  through `_setAsideDeviceKey`, which reads the list back to confirm the save.
  If the slot can't be read, or the set-aside doesn't save, `bb_user_key` is
  left as it is.
- `_loadStaleKeys()` runs once per page in `loadEntries`, before decoding,
  and adds those keys to `_staleUserKeys`. `_decodeFirestoreEntry` then opens
  what they encrypted and re-encrypts it under the account's key, so the web
  and other devices can read it after that.
- Sign-out still removes `bb_user_key` but keeps `bb_user_key_stale`: a key
  opens nothing without the account that can read the entries.
- Test: the native scenarios at the end of `scripts/test-journal-key.mjs`
  (a mock Keychain shared across launches).
- ⚠️ This can't bring back a key that an older build has already written
  over. An account whose entries no key opens stays locked.

### 2.19 The Friendly neighbourhood Bipolar Bear (crisis auto-reply)

**Why:** on 2026-10-10 a member posted "I need to talk to someone asap" and the
only reply, twelve hours later, was "hang in there". The 🛟 Help sheet existed,
but someone in that state may not open it, and a moderator may be asleep.

**What happens:** two Cloud Functions, `crisisBotOnPost` and
`crisisBotOnComment` (`functions/index.js`), run `looksLikeCrisis()` from
`functions/crisis-bot.js` on every new member post and comment. Admin posts,
announcements, topics and system cards are skipped. On a match the function:

1. Writes a comment into that thread as **Friendly neighbourhood Bipolar Bear**:
   `isBot: true`, `botKind: 'crisis'`, `forName` (the member it answers) and a
   UK `text`. The comment id is a hash of the post id and the member's name,
   and is written with `create()`. So each member gets one reply per thread,
   and a retried trigger cannot post twice.
2. Bumps the post's `commentCount` and `lastActivity`, the same as a member's
   comment.
3. Emails `FEEDBACK_TO` through Resend with what was written and the post id,
   so a person follows up.

The reply push (`onAnonCommentCreated`) goes to the post's author only when the
bear is answering them.

**Rendering:** `renderComment()` → `_crisisBotBody()` ignores the stored text.
It draws the intro from `anon.bot.*` in i18n and the rows from `BB.crisis.get()`
(§ crisis.js). Every reader sees lines for their own country, in their own
language, and UK readers also get NHS 111, as the Help sheet does.
It renders as a `<details>` folded to one line ("🛟 Support lines, if you need
them ▾", `anon.bot.crisisSummary`), so a mistaken match costs one quiet line.
Which ones are open is kept in `_botOpen`, because the comments list re-renders
on every snapshot. A capture-phase `toggle` listener in `setupThread()` keeps
it in step. `authorLabel()` adds the BOT badge. The bear's comment has no ban, SOS, report
or mute buttons, but admins can still delete it. Older builds and the native
apps (until `cap sync`) show the stored UK `text` under the bear's name.

**Matching** is deliberately generous: a false positive costs one kind message.
It never hides, flags or reports anything. English uses word-boundary regexes;
the other nine languages use plain substrings, because `\b` is ASCII-only. Test
with `node scripts/test-crisis-bot.js`, and add a case there when you change a
pattern.

### 2.20 Privacy round (2026-10-12)

James approved the privacy audit ("action all and follow your recs"). Server
side: `functions/privacy.js`; client side: `js/shared/secure-store.js` plus
edits in the page scripts. Rules tests: `scripts/firestore-rules`
(compat-shipped / compat-store141 / compat-next / security).

**Encrypted personal details and survival-kit lists** (`BB.secure`).
`personalDetails/{uid}` and these `userSettings` fields — `currentMedList,
moodDefinitions, moodMemories, copingStrategies, myCommitments,
customReminders, survivalGratitude, rememberThis, medHistory`, and from 1.44
`medSideEffects, medBloodLevels, medPastChanges` (§2.23) and from v358
`medBloodPlans` (§2.25) — live only inside a
`secureEnc` blob (`{_enc,_iv,v,updatedAt}`, AES-GCM under the journal data
key, the safety-plan pattern). localStorage keeps the device copy under the
same keys, so the pages render as before. The key comes from
`sessionStorage.bb_user_key`, or for a Standard account from the
`journalWrapKey` unwrap (never minted here, never SecureStorage). With no key
(Private and not yet unlocked this session) a save is kept on the device and
marked pending (`bbSecurePending`, per uid) and goes up encrypted later —
nothing sensitive is ever written in plaintext. The first sync with a key
folds plaintext into the blob and deletes it in one transaction. Older store
builds still write plaintext: plaintext personal details next to a blob are
newer and win; plaintext settings fill only fields the blob lacks (old builds
re-upload stale device copies through their guest-data claim). The rules
refuse new plaintext once `legacyClients()` is false. `guest-data.js` now
claims only goals/budget; the sensitive fields are claimed by secure-store.

**Medication history** (`BB.medHistory`, in `secure-store.js`, v343 — the
groundwork for the 1.44 before/after mood comparison; nothing on screen
yet). `medHistory` is a dated log of every change to `currentMedList`:
`{at: ISO date-time, type: 'baseline'|'add'|'stop'|'dose'|'rename', name,
from?, to?, source?: 'user'|'import'}`; `from`/`to` are dosages, except for a
rename (old / new name). A dose change is the same name (case and spaces
aside) with another dosage; a rename is an edit that changed the name (the
caller passes `{rename: {from, to}}`). Every writer calls
`BB.medHistory.record(prev, next, opts)` before storing the new list: Survival
Kit `saveMedList` (add / edit / delete), the journal's Manage medications
(`_recordMedChange`: add / edit / delete), the Bipolar UK Mood Tracker
import (`source: 'import'`), and the board's med list in `anonymous.js`
(`_anonSaveMedList`, against the account's decrypted list). **Baseline**:
with no history but a list, one `baseline` event per medicine dated now —
for a guest when Firebase auth resolves with no user, for an account right
after the encrypted settings were read (`_settings`, so another device's
history arrives first), and before the first change otherwise. Sensitive
like the list: device copy in localStorage, the account copy only inside
`userSettings.secureEnc` (in `SETTINGS`, so `resetPatch()` clears it); a
`saveSettings` with `currentMedList` always carries it. Devices merge by
**union on (at, type, name)** (`UNION_FIELDS` in `syncDoc`, when this device
patches it or has it pending), oldest first. In the journal backup
(`settings.medHistory`); a restore merges it in (`mergeIn`), never replaces.
Cleared on logout and reset / account deletion with `currentMedList`. No
rules change: it is never a plaintext field (the rules' `sensitiveSettings()`
list only guards the fields older builds wrote in plaintext). Privacy policy:
the existing medications line covers it. Test: `node
scripts/test-med-history.mjs` (one event per add / dose / rename / stop,
baseline once, backup round-trip, union across two devices, encrypted only,
pending without a key).

**Board documents carry no uid.** Posts, comments and `bbAnonMonikas` carry
`owner = sha256(uid + '/' + document path)` — checkable by the rules
(`ownerStamp()`), different on every document. 1.41-era builds that still
write `uid` are converted on create (`anonOwnerOnPost/OnComment/OnMonika`);
`privacySweep` converts any left over. `createAnonPoll` writes a stamp.

**Admin-label posts carry no owner at all** (James, 2026-10-12: "Yes, via a
function"). The admin posts as "Bipolar Bear Admin" and, with **Post as a
member** on (Your Moniker, admin only), under their moniker. An owner stamp
on an admin-label post comes from the same uid as the stamps on the moniker's
posts, so anyone holding that uid could tie the two together. So the web
client sends admin-label posts and replies to the **`adminAnonPost`**
callable (`{kind:'post', text, tab}` / `{kind:'comment', postId, text}`;
europe-west1). It checks the caller the way the rules' `isAdmin()` does
(admin account email on the token, or `bbAnonLinks` holding the admin address
hash), trims and caps the text (10,000 characters), and writes the neutral
author (`adminLabel()`: Bipolar Bear Admin / BB / yellow / streak 0), no
`owner`, no `uid`; a reply also bumps its post (`lastActivity`,
`commentCount`). `createAnonPoll` does the same for an admin-label poll (and
now recognises the email-code admin too). Who wrote each one goes in the
server-only `bbAnonAdminAuthored`, which `onAuthUserDeleted` uses. The admin
edits, pins and deletes these posts with admin rights, as any post; with no
owner, nobody else can (`ownsExisting()` no longer treats an ownerless
admin-label post as a legacy post anyone may delete).
Store builds up to 1.41 / 1.40 (including the v317 rebuilds) still write
admin-label posts from the device, with a uid, an owner stamp or nothing;
`legacyAdminClients()` keeps that working, and `anonOwnerOnPost` /
`OnComment` drop the uid or stamp as the post lands, put the neutral author
on it (builds before 2026-10-09 wrote the admin's own moniker there) and
record the writer (an owner stamp is matched against the admin's uids).
`privacySweep` does the same for any left over. The rules refuse a
device-written admin-label post once `legacyAdminClients()` is false.
Not covered: an announcement suggestion the admin publishes is credited to
the member who wrote it and still carries the admin's owner stamp. Nothing
in it names the admin's moniker.

**Board profiles keyed by a server secret.** `anonProfiles/p2_<HMAC-SHA256(
ANON_PROFILE_SECRET, 'bb-anon-profile:v1:'+email)>`. `verifyAnonCode`
(returns `profileId`) and the `anonProfileId` callable (Bipolar Bear accounts,
or a session whose link already proves the address) write
`bbAnonLinks/{uid}.{profileIds, emailHashes, profiles}`, which the rules read.
Old sha256 docs move across on the next sign-in, or in `privacySweep` when the
address is known (links, Auth, recent codes). Builds that don't send `v2` get
a short-lived owner-only copy at the old id (`compatCopy`), folded back by
the sweep. The 10-minute restore window and the open delete are gone.
⚠️ **Never rotate or delete `ANON_PROFILE_SECRET`** (Secret Manager).

**Retention** — `privacySweep`, daily 04:10 London (`RETENTION` in
privacy.js; keep privacy.html §8 in step): posts 7 days idle (reported 90),
reports 90, reviewed suggestions 90, translations 7, codes 30 min (a
verified code's address is stripped by `verifyAnonCode` at once, and
`getBBStats` deletes the record when it reads it; each `sendAnonCode` clears
old codes, and the daily sweep is the backstop), presence 1 h, feedback + beta sign-ups 12 months, orphaned replies.
`onAnonPostDeleted` deletes a post's replies whatever deleted it.
`onAuthUserDeleted` (1st gen auth trigger) removes userSettings,
personalDetails, entries, bbAnonLinks, uidLinks, translate usage, mood-seen
markers, feedback, the account email's board profile + push registrations,
and every board document the uid owns.

**Other:** pending announcement suggestions are listable by the admin only
(members watch their own by id); journal → board mood check-in is opt-in
(client and `anonMoodCheckin` both require `anonProfile.journalCheckin ===
true`); the crisis bear's email carries the post id and a `?post=` link, no
text or moniker; push registrations carry no `emailHash`
(`anonPushStripEmailHash` strips older builds'); the native apps keep FCM
auto-init off until opt-in (`getToken()` turns it on; opting out calls
`deleteToken()`); the survival kit's counter uses `helpedVote` (no anonymous
sign-in); no Supabase suite beat (the Firestore live count stays: random
per-tab id, `lastSeen` only); Firebase SDK and jsPDF self-hosted under
`vendor/` (jsPDF loads on export via `BB.loadJsPdf()`); no `measurementId`;
Workers observability off.

#### Service emails and opting out (2026-10-16)

`scripts/send-service-email.mjs` sends a service email (a problem, a fix) to
account holders: one email per person through Resend, from
bipolar@mail.unisim.co.uk, with replies to bipolar@unisim.co.uk. It leaves out
our own and test addresses, de-duplicates, and skips anyone who opted out.
Always run `--count` and `--test` before `--send-all`. The email text lives
outside this public repo.

Every email has an Unsubscribe footer and RFC 8058 `List-Unsubscribe` /
`List-Unsubscribe-Post` headers. The link goes to the `emailOptOut` function
(`functions/email-optout.js`) with `?id=` set to base64url(HMAC-SHA256(
`EMAIL_OPTOUT_SECRET`, `bb-email-optout:v1:` + the lower-cased email)). So:
- the link carries no address, and only whoever holds the secret can make one;
- GET shows a confirm button, because mail scanners open links;
- POST writes `emailOptOuts/{id}` (`{at}`), and that collection has no client
  rule;
- the script compares every recipient's id with that collection.

The header carries the one-click link only, with no `mailto:` fallback. With a
mailto, Apple Mail sends an "unsubscribe" email to bipolar@unisim.co.uk instead,
and nothing records it (it happened on 2026-10-16). If one still arrives, record
it by POSTing that address's id to `emailOptOut`.

⚠️ Never rotate `EMAIL_OPTOUT_SECRET`: every recorded opt-out would stop
matching.

### 2.21 Accessibility (2026-10-16)

The pass that lets both apps declare more of Apple's Accessibility Nutrition
Label (VoiceOver, Voice Control, Larger Text, Sufficient Contrast, Reduced
Motion, Differentiate Without Colour). Keep new UI inside these rules.

**Colour tokens** (`css/theme.css`, dark values under `html.theme-dark` in the
same file so Bipolar Anonymous gets them too):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--brand-ink` | `#a94600` | `#ffa94d` | orange TEXT and links (5.9:1 on white) |
| `--brand-on` | `#3d1f00` | `#fff` | text on the orange page gradient |
| `--on-orange` | `#3d1f00` | same | text on an orange fill that stays orange in dark mode |
| `--text-muted-ink` | `#636b73` | `#bfae98` | small grey hints and captions |
| `--ok-ink` / `--bad-ink` | `#1f7a33` / `#c92a2a` | `#69db7c` / `#ff8787` | good / bad answers in entry chips |
| `--focus-ring` | `#1f5fbf` | `#8ab8ff` | the keyboard focus ring |

`#ff9500` stays for fills, borders and big graphics; never use it (or
`#ff6b00`, `#adb5bd`, `#868e96`) for text. Normal-size text needs 4.5:1 and
large text (24px, or 18.66px bold) 3:1, in light and dark. Mood colours used
as text go through `_fmMoodInk()` (journal); mood fills carry dark `#1a1300`
labels (calendar, day sheet). Board avatars use `_avInk` + `_avBg` (anonymous):
a light or dark scrim is laid over a member's gradient only when it needs one.

**`js/shared/a11y.js` (`BB.a11y`)**, loaded in `<head>` after `i18n.js` on
index, journal, survival kit, Bipolar Anonymous and privacy:
- *Dynamic Type* (iOS app only): reads the `-apple-system-body` font size
  (17px at the default size) and sets the root font to 16px × size ÷ 17, plus
  `html.bb-text-large` (≥130%) / `html.bb-text-xlarge` (≥180%) for layouts that
  must reflow. Text sizes are em/rem off the root — never add px font sizes to
  text (decorative emoji in fixed boxes may stay px). Form controls get
  `font-size: 0.8333rem` (theme.css), the browser's 13.33px at the default.
- *Clickables*: any `[onclick]` div/span gets `role="button"` + `tabindex="0"`
  and Enter/Space; `data-a11y-skip` opts out. Icon-only buttons with a
  `title` get it as their `aria-label`. `<img>` without `alt` gets `alt=""`.
- *Dialogs*: containers in `BB.a11y.dialogSelector` (`.confirm-modal`,
  `.overlay`, `.bb-fab-modal`, the PIN overlays …) get `role="dialog"`,
  `aria-modal`, a label from their heading, focus on open (the heading), a Tab
  trap, Escape (the backdrop click; never on `lockSelector` screens) and focus
  back to the opener on close. New modal patterns: add them to the selector.
- *Reduce Motion*: `BB.a11y.reducedMotion()`; smooth `scrollTo` /
  `scrollIntoView` become instant while it's on. `css/theme.css` stops every
  CSS animation and transition under `prefers-reduced-motion: reduce`;
  confetti, the Survival Kit glide and the settings-hint pulse don't start.
- `BB.a11y.announce(text)` speaks through a polite live region;
  `BB.a11y.keyboardMode` and `html.bb-kbd` say the last input was a keyboard.

**Labels**: `a11y.*` keys in every language (one line right after each
`xx: {` in `js/shared/i18n.js`). The focus-mode wheel is a `radiogroup` of
`radio` pills with a roving tabindex: Tab lands on the centred pill, ← → ↑ ↓
Home End move, Enter picks. Calendar days say "date: mood" and are buttons.

**Checking**: the Playwright audit used for this pass walks every visible text
node (scrolling every scroller) and composites the colour down the real paint
stack; with the accessibility snapshot it counts unnamed controls. Re-run it
for any colour change.

### 2.22 Stopping or deleting a tracker (2026-10-17, v340)

James: "On the individual trackers, there needs to be a way to delete them and
the data … give a prompt to say that the data will be lost", then "if they keep
the data at that point how can they choose to delete it at a later point?".
Code: the `_trk*` block in `js/journal.js` (after `closeDeleteCustomFieldModal`),
`#trkDeleteModal` in `journal.html`, `.trk-*` in `css/journal.css`, strings
`trk143.*`.

- **Delete…** sits in every Track Data row's ✏️ edit row (Goals, Budget and
  Emotions get a ✏️ whose row holds only Delete…). The sheet offers **Stop
  tracking (keep past data)** (the switch goes off; the safe default, focused
  first) or **Delete tracker and all its data** (red), then a second confirm
  with the count from the loaded entries.
- **What a tracker is**: `_TRK_BUILTINS` (goals, budget, emotions =
  anxiety + stress + irritability, alcohol, and the switchless old exercise /
  outside / smoking / drugs) keyed by entry field; Added Sugar and the user's
  own fields by `entry.customFields[id]`; plus "orphans", ids found in
  entries whose definition an older build removed (its Remove modal never
  touched the entries). Since v344 an orphan is listed only when it has a
  name; nameless ones are removed by the clean-up below.
- **Removing the data** (`_trkPurgeFirestore` / `_trkPurgeGuest`): signed in,
  read every entry from the server, decrypt (account key, then set-aside
  keys), drop the key, re-encrypt under the account key, `batch.set` in
  batches of ≤400 with progress. Entries nothing opens are skipped and
  counted. Never without the key (`_requireUserKey` first). Guests: every
  `entry:*` rewritten, encrypted under the PIN key when there is one. A
  failure throws with `done/total`; the sheet says how far it got and **Try
  again** reruns it — done entries no longer match, so it only finishes the
  rest. Only after the data: `_trkForget` drops the definition, its switch,
  its `_labelOverride_*` and its PDF leave-out tick; the draft, the form's
  answers and `_allEntries` lose it; then `loadEntries()`.
- **Layout (v342, James 2026-10-17: "all old ones at bottom in a collapsed
  collapsible … a list at top to reactivate emotions with the switch").**
  *Top*: one list of every tracker with a switch (Goals, Budget, Emotions,
  Alcohol, Added Sugar, the user's own), on or off. A stopped tracker stays
  there switched off; switching it on is how it comes back, history intact.
  Rows carry `data-trk-tid`. The ✏️ edit row keeps rename and Delete….
  *Bottom*: **Old trackers (N)**, a `<details id="trkOldSection">`, closed
  each time the sheet opens (`_trkOldOpen` keeps it open across re-renders;
  hidden when N=0 and while editing one entry). N is `_trkStopped()`: every
  tracker that is off or has no switch and still has an answer in
  `_allEntries` (counted from the decrypted entries already loaded, no
  reads) — the switchless old Exercise / Gone outside / Smoking / Drugs,
  named trackers with no definition (v344), and switched-off trackers with
  data (also listed above). Nothing nameless is listed any more (the v342
  "A tracker you removed earlier" rows and `trk143.unnamed` are gone). Each row: the count (plus "switched off"), **Edit**
  (an inline panel: Track again switch for a switchable one; the name for
  custom / Alcohol / Added Sugar / switchless / nameless ones — Goals, Budget
  and Emotions have no name to change) and **Delete data** (the same counted
  red confirm). Opening the section, or a row's Edit, scrolls it fully into
  the list's view (`_trkRevealIn`, or its top when taller). Clicks go through
  `data-trk-act` with one delegated listener, so tracker ids never sit in
  inline JS. A name given to a switchless built-in or a nameless tracker is
  a `_labelOverride_<pref>`, synced in `labelOverrides`. Strings
  `trk143.old.*`.
- **Sync**: a deleted custom tracker's id goes in `deletedCustomTrackers`
  (localStorage) and `userSettings/{uid}.deletedTrackers` (arrayUnion), and
  `trackingFields.trackCustom_<id>` / `labelOverrides.trackCustom_<id>` are
  deleted. `getCustomFields()` and the sign-in settings read skip those ids,
  so another device's stale `customTrackingFields` can't bring one back.
  Built-ins are just switched off.
- **Clean-up of nameless leftovers (v344, James 2026-10-17: "Surely these
  should just be deleted?", then "Or we track the name from before?").**
  `_trkMaybeAutoClean()` runs after an entry load, in the background, with no
  UI or prompt (`BB.log` only), at most once per session
  (`sessionStorage.bbTrkCleaned`, also after a failure: the next session
  finishes it). Signed in it needs the sign-in `userSettings` read to have
  come from the server this session (`_trkNoteSettingsRead`: a failure, the
  5 s timeout or `metadata.fromCache` means no run) and the journal key in
  memory (never prompts); guests need `onAuthStateChanged` to have answered
  "no user" (not the 4 s / 20 s fallback). `_trkSortLeftovers` takes every
  custom id answered in an entry (read from the server / every `entry:*`,
  not the cache) and:
  1. **a definition** anywhere: Added Sugar, this device's
     `customTrackingFields`, or the account's `customTrackingFields` from that
     fresh read (so a tracker the device hasn't loaded yet is safe) → left alone;
  2. **a name** anywhere: `labelOverrides.trackCustom_<id>` on the account or
     `_labelOverride_trackCustom_<id>` on the device, or an Elaborate
     Responses note line (`<emoji> <label>: <note>` after `___` in the
     intention) in an entry that answered only that tracker, where exactly one
     label isn't a step's (every language, `BB.i18n.tAll`) or a defined
     tracker's, and every such entry agrees → the definition is restored
     (`{id, label, emoji}`, switch `'false'`, synced): it shows under Old
     trackers by that name, with Edit / Delete data, and its top-list switch
     brings it back;
  3. no definition or name but **answered in the last 14 days** → left in the
     entries, not listed (another device may still hold its definition, e.g.
     after two devices' settings overwrote each other's `customTrackingFields`);
  4. otherwise → **removed from every entry** with the v340 rewrite
     (`_trkReadFirestore` / `_trkWriteFirestore`, `_trkReadGuest` /
     `_trkWriteGuest`: decrypt, drop, re-encrypt under the account key, batches
     of ≤400; guests under the PIN key; entries nothing opens are skipped),
     plus its leftover `trackCustom_<id>` switch here and in the account's
     `trackingFields`.
  Ids in `deletedCustomTrackers` are deleted-with-data by the user, so they
  never count as a definition or name and any answers an old build wrote back
  are removed. `trackingFields.trackCustom_<id>` alone is NOT a definition:
  set-merge never removes those keys, so every field ever made on an account
  has one, with no name. Idempotent (a second run finds nothing). A manual
  Delete data waits for a running clean-up. Where names really survive: a
  custom field's name only ever lived in `customTrackingFields` (replaced
  whole on every sync) until v342 let Old trackers name a leftover, so a
  field removed by an older build usually has no name left anywhere the app
  can read; a journal backup file the user kept still holds the old list,
  and importing it restores the definitions.
- **Test**: `node scripts/test-tracker-delete.mjs` (real functions, mocked
  Firestore, real WebCrypto: 950 entries in three batches, partial failure +
  retry, idempotence, unopenable entries, no key, settings sync; v344: the
  clean-up removes orphans from every entry, keeps an account-only
  definition, an account name and a note name, waits on a recent one, does
  nothing on a failed / cached settings read or without the key, runs once,
  is idempotent, and guests stay PIN-encrypted).

**Home quick check-in labels (v340)**: the bears' names use `trk143.qc.*`
(the mood names with soft hyphens). `fitLabels()` in `js/index.js` leaves
names that fit alone; otherwise all five go to 0.62 → 0.58em together, and
if one still doesn't fit they take two lines (`.qc-two`), breaking only at
the soft hyphens. The bears' accessible names stay `mood.*`.

### 2.23 Per-medicine tracking and the before / after comparison (2026-10-19, v352, for 1.44)

`js/journal-meds.js` (`BBMeds`), `css/journal-meds.css`, strings in
`js/shared/i18n-meds.js` (`meds144.*`, 10 languages, added with
`BB.i18n.extend`). Opened from 💊 **My Meds** (the form), **Manage meds**
(focus mode), the medication stat detail and the dock's 💊 **Medication**.

**Your medicines (v362, James 2026-10-20: the sheet replaces the old "My
Medications" window, `#medicationModal`, now gone).** The Doses tab starts
with the list: add a medicine (name + dose, both required, no duplicate
names), ✏️ change its name or dose in place, 🗑️ remove it (asks first). On
phones (native feel) a row taps to change and swipes to remove (`.meds-cur`).
The sheet never writes `currentMedList` itself: `window.BBMedList.save(next,
opts)` in `js/journal.js` records the change in `medHistory` first (add /
dose / rename / stop, dated now; an edited name passes `opts.rename`), then
the device copy, then the encrypted account copy, then
`loadMedicationList()` (the My Meds button, the open sheet, focus mode's
steps). `showMedicationList()` opens the sheet at once and fetches the
account copy after. The survival kit's medicines section is separate and
unchanged.
- **Dock:** `meds` in `_FAB_EXTRAS` (`fab.js`, `#medsExtraFab`,
  `openMedsFromDock`). On the journal it opens the sheet; on the other pages
  it goes to `journal.html?openMeds=1`, which drops the parameter and opens
  the sheet once no PIN lock / splash / welcome is showing (gives up after
  30 s). While 💊 is docked the sheet ends with "🙈 Hide this button".
- **Dock shortcuts (v369):** `survival` (🧰, `openSurvivalFromDock`:
  `survival-kit.html`; on that page, back to all sections at the top) and
  `anon` (💬, `openAnonFromDock`: `anonymous.html`; signed out it opens the
  sign-in dialog, like the home page's locked button). Both go straight
  there, so neither has a sheet with "Hide this button"; hold them to hide.
- **Hold to hide (v370):** any dock button (defaults and extras) held for
  500 ms, or right-clicked, opens `#bbDockHoldModal` "Hide … from the
  dock?" (`fab.js`, `_dockHoldOpen`). Hide uses the existing paths:
  `_hideExtraFab` for extras, `_showHidePermanently` for defaults. The
  release after a hold is swallowed (on a touch it would land on the
  sheet's Cancel). Not while the dock is locked. The first Add to dock
  shows a one-time hint (`bbDockHoldHintDone`). Test:
  `scripts/test-dock-hold.mjs` (7, including a CDP touch hold).
- Test: `scripts/test-meds-list.mjs` (14 checks).

**A day's doses.** An entry keeps `medication` (`taken` | `not-taken` |
`unsure`), the one answer for the day that every older build reads and
writes, and now also `medDoses: {"<name>": "taken" | "missed"}` for the
medicines on the list that day. Old days have no `medDoses`:
`BBMeds.dosesOf(entry)` returns `{status, perMed: null}`, so the single answer
stands for every medicine. Nothing is rewritten. Editing an old day keeps it
that way unless the medication answer is changed (`_medDosesForSave`). New
days still get `medication`: all taken → `taken`, any missed → `not-taken`.
- The medicines for a day: the current list for today; for an earlier day
  the list replayed back from `medHistory` + typed-in past changes
  (`BBMeds.listOnDay`); an entry being edited uses its own `medDoses` names.
- Focus mode: Taken → all taken, and it moves on as before. Not taken with
  two or more medicines shows "Which did you miss?" chips (all missed until
  tapped) and waits for Next. One medicine: the answer is its answer. The
  classic form shows the same chips under the three buttons. Unsure → no
  `medDoses`.
- `medDoses` is inside the entry, so it is encrypted exactly like the rest of
  the entry (journal key; a guest's PIN key, or plain for a guest without a
  PIN).

**Logs** (`BB.medLog` in `secure-store.js`), stored like `medHistory`: a
device copy in localStorage and the account copy only inside
`userSettings.secureEnc` (they are in `SETTINGS`, so `resetPatch()` clears
them; never a plaintext field, so no rules change):
- `medSideEffects` `{id, date, med, text}`
- `medBloodLevels` `{id, date, test, value, unit, note?}` (a decimal comma is
  read), charted per test (SVG on screen, lines in the PDF)
- `medPastChanges` `{id, date, type: add|stop|dose, name, from?, to?}`: a
  change from before `medHistory` began (v343), typed in to compare it.
Each has `updatedAt`. Delete leaves a tombstone `{id, deleted, updatedAt}` with
nothing else in it. Devices merge by id, newer `updatedAt` wins
(`mergeById`, a `UNION_FIELDS` entry). No key (Private, locked) → pending,
as for the other fields.

**Missed doses.** `BBMeds.adherence(entries, from, to)`: taken / missed per
medicine, only from days recorded per medicine; the overall share uses every
answered day. `BBMeds.missedLog()`: newest first; an old not-taken day shows
as "one answer for the whole day".

**Before / after** (`BBMeds.compare(entries, change, {events})`). Changes =
`medHistory` add / stop / dose events (not baselines, renames or imports)
plus typed-in past changes. For change day C: W = min(90, days from the first
logged day to C−1, days from C+1 to today). Before = [C−W, C−1], after =
[C+1, C+W]. A logged day is a non-auto-filled entry with a mood, latest entry
per day. Both sides need ≥21 logged days. If short: `need` = days of daily
logging from tomorrow that would make it ("Keep logging: N more days
needed"); `reason: 'before'` when the widest before-window can't reach 21;
`reason: 'afterGap'` when the widest window is already past and has gaps.
Shown: logged days, stable %, high ↔ low switches a month (polarity changes
between consecutive non-stable days), average sleep and energy, meds taken
%, the mood mix, and custom yes/no trackers (% yes). Other changes inside
either window are named. The framing copy says it's patterns, not proof.
The picked change is remembered on the device (`bbMedsCompareKey`).

**PDF.** After the life chart: a Medicines section (taken per medicine over
90 days, missed doses over 30, side effects, blood levels with a chart), then
a Before / after page for the picked change, or the newest one with enough
data. Each has an unticked "Leave out" tick (`bbPdfOmitMeds`,
`bbPdfOmitCompare`), offered only when the report would have it.

**Backup / CSV / imports.** The backup now carries `currentMedList` (it was
missing) and the three logs. A restore merges: medicines the device lacks are
added by name; logs merge by id; nothing is replaced. The CSV has a
`Medicines` column ("Lithium: taken; Quetiapine: missed"). The Bipolar UK
import sets `medDoses` taken for each medicine with a dose ticked (unticked
ones stay unknown, not missed).

Cleared on logout and reset with the other medicine keys. The sheet's tabs
take a double-tap to set the default tab (`bbMedsHubTab`, cleared by Reset).
Medicine reminders: one per medicine since 1.45 (§2.27). **🤏 Some** (part of
the medication, with the dose taken: `medSome` + `medAmounts`) is §2.30.
Test: `node scripts/test-med-tracking.mjs` (9 scenarios).

### 2.24 Mood buttons on the daily reminder (1.44, v353)

> There is no switch for the buttons: they are on every daily reminder. The
> New features sheet (§2.25) mentions them as a note on phones.

James's feature-gap list (2026-10-13): "log from the reminder notification
without opening the app". The daily reminder (`scheduleReminder`, id 1) has
the five moods as buttons. A tap does not open the app, so the page and the
journal key aren't there: the native side only queues it, and the app files it
on its next open.

```
reminder button "bg.mood.<mood>" (category / actionTypeId "bb.mood")
  iOS      MoodReminder.swift: a UNUserNotificationCenter delegate set in
           AppDelegate.didFinishLaunching, in front of Capacitor's router
           (BridgeViewController.capacitorDidLoad re-takes the delegate and
           forwards everything else). Works with the app not running: iOS
           launches it in the background, no scene, no web view.
           Buttons need the phone unlocked (authenticationRequired).
  Android  MoodReminderNotification.java draws the five bears (Android shows
           at most three plain buttons) through a hook patched into
           @capacitor/local-notifications (patches/, manifest meta-data
           capacitor.localnotifications.customizer). A bear is a broadcast to
           MoodActionReceiver: queue, then a quiet "saved for later" for 4 s.
     │
     ▼ queue: {id, mood, at, day}   (day = yesterday, or today with "log
       today" on: the widget's targetDay rule, from the widget data)
  iOS      UserDefaults(group.app.bipolarbear)["moodQueue"]
  Android  SharedPreferences "bipolarbear_widget" → "moodQueue"
     │      Capacitor.Plugins.BipolarBearMoodQueue: pending() / remove({ids});
     │      a tap with the app open fires window 'bbmoodqueue'
     ▼
index.js   taps waiting, no PIN screen up → journal.html (once per tap per
           session, so a journal that can't file yet doesn't bounce)
journal.js _fileReminderMoods() after every loadEntries(), on visibilitychange
           and on 'bbmoodqueue' → BB.moodQueue.file(_reminderMoodAdapter)
```

- **The rules** (`BB.moodQueue.plan`, pure): one entry per day, the latest tap
  for a day wins; **a day that already has an entry is never overwritten**, its
  taps are dropped (the widget's `?mood=` link does the same when the day is
  logged, and auto-complete only fills empty days); a bad mood, a bad day or a
  future day is dropped.
- **Ready** (`adapter.ready`): signed in with `_userCryptoKey` and no
  undecryptable entries; or a guest whose storage is ready (a PIN, unlocked, or
  "Continue without a PIN"). Otherwise nothing happens and the taps wait. A
  Private journal not unlocked this session waits for the unlock.
- **Logged days** come from the server for an account
  (`get({source: 'server'})`, the plaintext timestamps, nothing decrypted), so a
  cache that misses another device's entry can't let a tap through. Offline it
  throws and the taps wait.
- **Writes** go the saveEntry way: `_userEncrypt` → `entries.add` for an
  account; `_guestStoreValue` for a guest (encrypted under the PIN, or plain
  for a guest who chose no PIN, as every entry of theirs is). The entry has the
  mood only (spectrum value when Full spectrum is on), `recordedAt` = the tap,
  `loggedVia: 'reminder'`, no `autoFilled` (it's the user's own report).
- **The queue is cleared only after a save**, one day at a time: a failed save
  keeps its tap; a tap the native side failed to drop is dropped next time
  because its day is then logged.
- The queue holds the mood category and the day only. It is never shown, so the
  home strip / widget PIN rule doesn't apply. The widget doesn't show queued taps.
- Note after filing: `mq144.filedOne` / `filedMany` / `alreadyLogged`
  (`BB.moodQueue.toast`). Settings → Daily Mood Reminder has a hint line
  (`mq144.settingsHint`, phone app only).
- Tests: `TZ=Europe/London node scripts/test-mood-queue.mjs` (the real module,
  a fake native queue, real AES-GCM) and `scripts/test-native-144.mjs`
  (Playwright: home → journal → filed, encrypted under a guest PIN, a logged
  day kept, nothing written before the guest's storage is ready, the
  reminder's buttons).

### 2.25 Blood results on the charts, the next test, and the New features sheet (2026-10-20, v358, for 1.44)

James agreed the plan on 2026-10-20. Strings: `blood144.*` in
`js/shared/i18n-blood.js` and `whatsnew.*` in `js/shared/i18n-whatsnew.js`
(10 languages, machine translated).

**The Settings tick.** Journal ⚙️ Settings → Advanced → Journal → More, the
**Stats** page (`#settingsAdvancedMorePanel`; since v360, beside Incognito
Mode and the stats start date: settings that change stats or exports live
there) → **🩸 Show blood results on my charts** (`#bloodChartsRow`), unticked by default, this device only
(`BB.bloodCharts` in `secure-store.js`: `isOn()`, `set(on)`, key
`bbBloodOnCharts`; `set` fires `bb:bloodcharts`). The first time anyone
saves a blood result, the Blood levels tab offers it once ("Show this on your
mood charts?"; `bbBloodChartsAsked`), never again.

**Life chart** (`js/journal-insights.js`, the Your Journey card, 1M / 3M / 6M
/ 1Y / All). Only with the tick on (`BBMeds.chartData()` is null otherwise):
- A 🩸 button on the day of each result, in a strip under the sleep bars
  (`.lc-blood`, one per result in the chart's span). Tap / click puts
  "Lithium 0.7 mmol/L · 12 Mar" in a bubble and in the chart's live line;
  keyboard focus shows the bubble; each has that text as its `aria-label` and
  `aria-describedby` the bubble. The year is added when it isn't this year.
- From 6M (range ≥ 180 days): one test's results joined by a thin line over
  the mood area on its own right-hand scale (3 ticks, `.lc-yright`). Lithium
  first (`BBMeds.isLithium`: lithium / litium / litio / lítio / lit / li / 锂,
  or the translated "Lithium"); a picker when two or more tests have ≥2
  results (`bbBloodChartTest`). The person's range, if typed in, is shaded
  behind the line. Redraws on `bb:bloodcharts`, `bb:bloodchange` (a result or
  range saved / deleted) and `bb:secure-sync`.
- The scale is the test's results plus the range, padded 12%
  (`BBMeds.valueScale`).

**PDF.** The 12-month mood chart (`_doExportPDF`, `_pdfStep('charts')`) gets
a small red drop under the month of each result in the 12 months, placed by
day within the month, and "Blood result" in its key; only with the tick on.

**Next test due + the person's range** — `BB.medLog` kind `bloodPlans`,
field `medBloodPlans`, one record per test:
`{id: 't:<test, lower case>', test, due?, low?, high?, dismissed?, updatedAt}`.
Stored like the other medicine logs (§2.23): the device copy in localStorage,
the account copy only inside `userSettings.secureEnc` (in `SETTINGS` and
`UNION_FIELDS`, merged by id; in the backup and merged on restore; cleared
with the other medicine keys). No rules change.
- The add-result form has an optional **Next test due** date; each test's
  card has **Next test and your range** (due date, the optional reminder, and
  From / To). Both ends or neither; the lower first; a decimal comma is read.
- **No default range anywhere** and no "in range / out of range" wording: the
  hint says "the range your prescriber gave you". It is a medical decision.
- **The card** (`BBMeds.renderDueCard`, `#bloodDueSlot` beside the early-
  warning card on the journal page): from the due date on, ONE card for the
  earliest due test (`BBMeds.dueNow`): "Had your lithium test? · Add the
  result". The button opens Blood levels with that test filled in and the
  value box focused. It goes once a result dated on or after the due date is
  added, or on × (`dismissed` = that due date, so a new due date brings it
  back). The day's entry steps fill the screen, so it is never in them, and
  the PIN screen covers the page.
- **The reminder** (phone app only, off unless ticked, `bbBloodDueReminder`,
  this phone only): a local notification at 9:00 on each due date, ids
  4000–4009 (beside 1 daily, 2 weekly, 3000+ medication, 10000+
  anniversaries). The text names no test ("🩸 Blood test due today"). Planned
  again on every plan / result change and on each journal open; cancelled on
  logout and reset. On the web the card is enough.

**The New features sheet** (`js/shared/whats-new.js`, `BB.whatsNew`). A
suite-wide rule (James, 2026-10-20): every app gets one, and @unisim/sdk will
get a React copy, so the registry is plain data plus small functions:

```
{ '<version>': [ {
    id, icon, titleKey, bodyKey,                 // bodyKey = one plain sentence
    setting: { key, get(): boolean,              // the SAME setting as in Settings
               set(on): boolean | string | Promise<boolean|string> }  // string = why it didn't take
             | null,                             // null = a note line, no switch
    applies(): boolean                           // only items that apply are shown
} ] }
```

- `create({releases, seenKey, t})` → `{latest, items, shouldShow, show,
  start, markSeen}`. `seenKey` is the **seenVersion** key (Bear:
  `bbWhatsNewSeen`), holding the newest release shown or skipped; Reset
  clears it.
- `shouldShow({isFreshInstall, isBlocked})`: false when the newest release is
  seen; a fresh install (`isFreshInstall()`, for Bear: onboarding not done and
  no entries on the device) is marked seen and never shown; false while
  `isBlocked()`; marked seen when no item applies; otherwise true.
- `start(...)` polls each second until the page is visible, nothing is in
  the way, and there has been no touch or key for 2.5 s, then shows it once
  (marked seen on show). Gives up after 5 minutes; the next page load tries
  again. `BB.whatsNew.screenBusy()` is the generic "something on top" check:
  the PIN screens, the sign-in sheet and splash, the welcome card, the crisis
  chat and safety plan, any `.confirm-modal.active` / `[aria-modal="true"]`.
  The journal also waits while the day's entry steps (or the classic form)
  are up, and while an account is still restoring.
- The sheet: "✨ New features", "New in 1.44", one row per item (icon, title,
  the sentence, the real switch, every switch as `get()` says, so all off for
  something new), "You can change these any time in Settings", **Done**.
  Nothing turns on without a tap.
- Bipolar Bear's entries: `BB.whatsNew.bearReleases(ctx)`; pages call
  `BB.whatsNew.startBear({isBusy, bioMode, isNative})` (index.js on the home
  screen, journal.js), so whichever is idle first shows it. **1.44**:
  - `bloodCharts` — Show blood results on my charts (`bbBloodOnCharts`).
  - `bioUnlock` — Unlock with Face ID / Touch ID / your fingerprint
    (`bbBioUnlock`, via `BB.bioUnlock.turnOn/turnOff`, so a scan is asked for;
    a failed scan leaves it off with the reason). Only in the phone app with a
    PIN lock on (`_idxBioMode` / `_bioLockMode`) and biometrics enrolled.
  - `moodButtons` — a note, no switch (the reminder's mood buttons are always
    on, §2.24). Phone app only.
- **1.45**: `medsReminders` — A reminder for each medicine (§2.27; the switch
  is `bbMedsReminder`, the reminders' master switch), and `homeButtons` — a
  note (no switch: they are already on) that 🆘 Survival Kit and 💬 Bipolar
  Anonymous are back on the home page, only where the 2026-10-23 migration
  brought one back (`bbHomeBtnsRestored`, §2.10), and `medSome` — a note about
  🤏 Some on the medication question (§2.30). For the next release, add
  `'1.46': [...]` to `bearReleases`; people who missed a release see only the newest entry.

Tests: `node scripts/test-med-tracking.mjs` (11 scenarios; the plan helpers
and `medBloodPlans` encrypted, read back on another device, restored from a
backup) and `PLAYWRIGHT_MODULE=… node scripts/test-blood-charts.mjs` (23
checks, with negative controls; `SHOTS=<dir>` also saves screenshots at
390 px in English and German, light and dark, and the sample PDF).

### 2.26 Native feel on phones (merged v361; stage 3 v364)

`js/shared/native-feel.js` (`BB.nf`), loaded after `platform.js` on index,
journal, survival kit and anonymous (and in `build-anonymous.js`). On only on
phones: `html.is-native`, or a coarse pointer at ≤600px; `localStorage.bbNativeFeel`
`'0'` / `'1'` forces it. It adds `html.nf`. Everything is driven from this one
file, so the page scripts barely change.

- **List rows** (`BB.nf.rows({row, open, del, actions, hide, undo})`): tap a
  row to open it, swipe left for actions, a full swipe deletes. The page's own
  ✏️ / × / ⋯ stay in the DOM for VoiceOver, visually hidden; the actions click
  them.
- **Sheets:** every pop-up is a bottom sheet with a grabber at ≤700px. Swipe
  down clicks the backdrop; failing that the sheet's Cancel / Close / ✕; failing
  that it springs back. A sheet may set `_nfBack()` (go back a page; true if it
  did) and `_nfClose()`.
- **Swipe back** from the left edge (`BB.nf.setBack(fn, can)`; not Android).
- **Stage 3 (James, 2026-10-20): no tab bar or pushed screens; the buttons
  open drawers.**
  - `BB.nf.drawer.open(el, onClose)` / `.close(el)` / `.available()`: a page
    section becomes a bottom drawer over the page (`.nf-drawer-on`, a
    backdrop, a grabber + ✕ row, `role="dialog"`). The survival kit's
    sections use it (`skOpenSection` / `skShowGrid`, `_skDrawer()`); the grid
    stays put. ✕, the backdrop, a swipe down, Escape, the edge swipe and
    Android back close it.
  - Settings (journal): Advanced is an index since v365 (James: "the first
    page of advanced should be like an index"): 📱 Mobile (app only), 📓
    Journal, 🎯 Focus mode, 📊 Stats, 👤 Account (`#settingsIndexPanel`,
    `_openSettingsPage` / `_settingsToIndex` / `_settingsShow` in
    `js/journal.js`; the old open*/close* names are aliases). Account opens
    fab.js `showAccountModal()` over Settings; it has a guest mode (Sign in,
    Delete all data & reset), which replaced the Danger Zone page. Each page
    slides the sheet up again as a new drawer (a MutationObserver on the
    panels, depth `SET_DEPTH`); back drops the page in from above; a swipe
    down presses the page's ← Back (`#settingsModal._nfBack`) and only closes
    on the first page. Test: `scripts/test-settings-index.mjs`.
  - The keyboard: while a text box in a sheet or drawer has focus, the sheet
    sits on the keyboard (`visualViewport`); a textarea makes it full height
    (`.nf-kb`, `.nf-kb-full`). Android resizes the page itself, so the gap is
    0 there and nothing moves.
  - Undo: a rule with `undo` hides the row (`.nf-gone`) behind "Deleted ·
    Undo" for 5 s, then runs the page's own delete with `window.confirm`
    answered yes (`undo` as a function runs a custom path: journal entries
    press `confirmDelete()` behind `.nf-silent`). The next touch elsewhere,
    another delete, hiding the page or leaving it carries it out first, and
    that touch is swallowed. On: entries, goals, survival-kit lists,
    reminders, 💊 My medicines rows, the safety plan. Not the anonymous board
    (server data; it keeps its confirms).
- Test: `scripts/test-native-feel.mjs` (headless Chrome over CDP with real
  touches, 36 checks; it serves and seeds the app itself).

### 2.27 One reminder per medicine (2026-10-22, v378, for 1.45)

Backlog: "one reminder per medicine (`meds-reminder.js` is still one
reminder)". `js/shared/meds-reminder.js` (`BB.medsReminder`, index + journal),
the 🔔 Reminders card in `js/journal-meds.js` (`remindersHtml`, under Your
medicines on the Doses tab), strings `medsRem145.*` in
`js/shared/i18n-medsrem.js` (10 languages, machine translated).

- **Settings, this device only** (an alarm on this phone / browser; nothing
  syncs): the master switch **Remind me to take my medicines** (`bbMedsReminder`,
  unticked; the key the single reminder used), then each medicine's own times
  (`bbMedsReminders`, keyed by the name in lower case; none by default = no
  reminder), then **Show the medicine names in reminders** (`bbMedsRemindNames`,
  unticked). Off keeps the times. The focus-mode medication step's 🔔 pill
  ("🔔 Reminders · 08:00, 20:00") opens the sheet at the card
  (`BBMeds.open('doses', {reminders: true})` scrolls the sheet's body, never the
  modal).
- **Slots.** Medicines with the same time share one notification; ✅ Taken
  (the notification's button, or the in-app "Have you taken …?") covers that
  time today (`bbMedsTaken`). Follow-ups every hour, up to 6, never past midnight.
- **Privacy.** With names unticked a reminder says only "💊 Time for your
  medication" / "Have you taken your medication?" (the single reminder's words).
  Ticked: "💊 Time for Lithium, Quetiapine". The notification's `extra` holds
  `{bbMeds, day, slot}`, never a name. The times are keyed by medicine name, so
  `BB.medsReminder.clear()` runs on sign-out (journal and home) as well as reset
  and delete-all: the single reminder used to survive sign-out.
- **The list.** `BBMedList.save` (journal.js) calls `onListChange(prev, next,
  opts)`: a renamed medicine keeps its times, a removed one loses them. A list
  that arrives from another device re-plans (`loadMedicationList`). Times for a
  medicine not on this device's list are kept but not scheduled.
- **The move from the single reminder** (`migrate()`, once, while
  `bbMedsReminders` doesn't exist): on → its time (`bbMedsReminderTime`, 21:00
  if unset) goes on every medicine on the list, or on `"*"` ("All my
  medicines", shown as its own row) when there is no list on this device; its
  ✅ Taken day becomes that slot's. Off → nothing is moved, and turning the
  switch on later gives no medicine a time.
- **Phone app** (`@capacitor/local-notifications`, as before; the native
  projects need only `cap:sync`). One-off notifications, planned 7 days ahead
  and re-planned on each page open and each change: every slot's first reminder
  for the 7 days first, then the follow-ups, soonest first, **at most 49**
  (`plan()`, pure). IDs `3000 + i`; `3000–3099` is cancelled before each plan
  (the single reminder used `3000 + day * 10 + n`). iOS replaces every
  notification category on each `registerActionTypes`, so ✅ Taken (`BB_MEDS`)
  and the daily reminder's mood buttons (`bb.mood`) are always registered
  together (`BB.medsReminder.actionTypes()`, used by `scheduleReminder` too).
  Icon `ic_stat_notify` + `#FF9500`, like the other reminders.
- **Web.** A browser can't schedule a notification for later, so the reminders
  come only while Bipolar Bear is open in a tab (the card says so): a timer per
  reminder for the next 36 hours, re-planned every 12. Tab in front → the in-app
  prompt; otherwise a notification (`new Notification`, or the service worker's
  `showNotification` on Android Chrome). `service-worker.js`'s
  `notificationclick` focuses the tab and posts `{bbMedsAsk, slot}`. Permission
  is asked when the master switch is turned on; blocked → "Notifications are
  blocked for this site…" and the switch stays off.
- **New features (1.45):** `medsReminders`, its switch = the master switch.
  Turned on there with no times yet, it says "Now give each medicine a reminder
  time in 💊 My medicines". Shown when reminders are available and there's a
  medicine list (or the moved single reminder is on, then shown on).
- Test: `PLAYWRIGHT_MODULE=… node scripts/test-meds-reminders.mjs` (19 checks:
  the move, the plan, the phone path against a fake plugin, the card at 390 px
  in English and German, negative controls; `SHOTS=<dir>` saves screenshots).

### 2.28 Change journal password (2026-10-22, v378, for 1.45)

Settings → Advanced → 👤 Account (fab.js's account sheet, on the journal page)
→ **🔑 Change journal password** (`#bbAccountJournalPwBtn`). Shown only when
the account has a password wrap (`wrapSalt` + `wrappedKey` + `wrappedKeyIv`;
`_journalPwAvailable`, read fresh each time the sheet opens): Private journals,
and Standard ones that kept a password wrap. Strings `jpw145.*` in
`js/shared/i18n-journalpw.js` (journal.html only).

Why it is safe to build: the data key never changes (§2.18), the password only
wraps it. So a change is a re-wrap, not a re-encryption (`_rewrapJournalPassword`
in `js/journal.js`):
1. Read `userSettings/{uid}` from the server (offline: nothing changes).
2. Unwrap with the **current** journal password. Wrong → "That isn't the
   journal password", nothing written.
3. The key must open one of the account's encrypted entries
   (`_keyOpensAccountEntries`), else refuse.
4. Wrap the same key with the new password (new `wrapSalt`), in a transaction
   that refuses if `wrappedKey` / `wrapSalt` changed since step 1 (another
   device) → "changed on another device".
5. Write `wrapSalt`, `wrappedKey`, `wrappedKeyIv`, `journalPw: true` (the
   journal password is now its own: a password sign-in never re-wraps over it).
   The Standard wrap, the entries and other devices' keys are untouched.
- New password: 8+ characters, typed twice, not the current one. The passwords
  are derived on the device (PBKDF2) and never sent, stored or logged (the
  failure log has only the error's code).
- **Not offered:** the oldest accounts with `encSalt` alone (key =
  PBKDF2(password), no wrap): the next unlock gives them a wrap, then it's
  offered. Standard accounts with no password wrap (nothing to change; the
  Private journal switch sets one).
- **Caveat:** app builds from before `journalPw` (2026-10-05) may, after a
  password sign-in whose unwrap fails, re-wrap the key with the sign-in password
  if the device holds the key. That replaces the new journal password with the
  sign-in password; it never loses the journal.
- The sign-in password ("Change password", Firebase) is separate and still
  doesn't touch the wrap.
- Test: `node scripts/test-journal-key.mjs` (the real `_rewrapJournalPassword`
  against a mocked Firestore: the change, Standard kept, and negative controls
  for a wrong password, a wrap changed meanwhile, offline, a key that doesn't
  open the entries, no wrap; no password in the store, the writes or the log).

### 2.29 Medicine names in board posts link to the wiki (2026-10-25, v380)

**Ask (James, 2026-10-25):** "Bipolar Anonymous — if someone mentions a
medication then provide a link to the wiki to learn more about that medication."

**Where:** `js/shared/med-links.js` (`BB.medLinks`, loaded by anonymous.html, so
it covers the Bipolar Anonymous app and the board inside Bipolar Bear alike),
wired up in `js/anonymous.js` (`_scanMemberText`, `_medLinkable`,
`openWikiMedFromPost`, `_medLinkBack`), styles in `css/anonymous.css`
(`a.med-link`, `.wiki-from-post`).

- **Dictionary:** `DICT` maps every name to a page, the first key of a
  `js/shared/medications.js` entry: `lithium`, `lamotrigine`, `quetiapine`,
  `valproate`, `olanzapine`, `aripiprazole`, `risperidone`, `antidepressant`.
  Generic names, UK and other markets' brands (Priadel, Camcolit, Seroquel,
  Lamictal, Depakote, Epilim, Depakine, Zyprexa, Abilify, Risperdal, Zoloft,
  Prozac, Cipralex, Efexor, Cymbalta, Remeron, Seroxat…), local spellings
  (Quétiapine, Lithiumcarbonat, litio, kwetiapina…), common misspellings and
  the Chinese names. A name whose page is missing from medications.js is never
  linked. Add a page there first, then its names here.
- **Matching:** case-insensitive, whole words only (no letter or digit either
  side, with an optional plural "s"/"es"); Chinese characters don't count as
  part of a Latin word, and the Chinese names are specific (碳酸锂, never a bare
  锂). Only the **first mention of each page** in a post links.
- **Render-time only:** the renderers mark member text with `data-medlink`
  (posts, replies, saved posts). `BB.medLinks.scan(root)` splits the text
  nodes and wraps the match in an `<a class="med-link">` built with DOM calls,
  never innerHTML. The 💊 is a CSS `::after`, so it isn't in `textContent`:
  translation requests, `data-tt-orig`, the ⋯ preview and reports see the post
  exactly as written.
- **Translation:** `js/shared/translate.js` now fires `bb:ttchange` on the
  element whenever it swaps a post's text (translation in, original back), and
  med-links lays the links on again.
- **Never linked:** announcements (published, built-in and suggested), daily
  topics, admin / moderator posts and replies, the crisis bear, text that
  `looksLikeCrisis()` (a copy of `functions/crisis-bot.js`'s patterns, checked
  for agreement by the test), and any thread the crisis bear has answered
  (`#ov-thread[data-medlink-skip]`).
- **The tap:** a capture-phase click listener stops the card's own handlers,
  then `openWikiMedFromPost` closes a thread / Saved sheet, opens Wiki → Meds,
  opens that card (`data-wiki-slug`), and puts a note at its top: "You opened
  this from a post. It's information, not advice: talk to your doctor or
  pharmacist before you change or stop any medicine." plus **← Back to the
  post** (back to the tab, the thread or Saved). No navigation, so the native
  apps never leave the app. The wiki's own Meds disclaimer said "talk to your
  prescriber about your medications" but nothing about changing them, hence the
  note.
- **Switch:** "Don't link medicine names" in the Your Medication sheet,
  unticked by default, saved with **Save ✓**. `localStorage.bbAnonMedLinksOff`
  = `'true'`, per device and outside the `bbAnon_*` prefix so signing out keeps
  it.
- **Strings:** `medlink.*` (title, note, back, offLabel, offSub) in all ten
  languages, added with `BB.i18n.extend` from med-links.js.
- **Test:** `PLAYWRIGHT_MODULE=… node scripts/test-med-links.mjs` (28 checks
  at 390 px: matcher, no HTML injection, exclusions, the right card opens, back
  from feed and thread, translation swap, the switch, ten languages, crisis
  parity).

### 2.30 🤏 Some: only part of the medication taken (2026-10-25, v381, for 1.45)

James (2026-10-25): "A way to log if you only took some of your medication
without interrupting normal journaling … last night I took less Quetiapine (on
psychiatrist advice) and would like to see if there's an impact."

- **The answer.** The medication question has **🤏 Some** between 🤷 Unsure
  and ✅ Taken everywhere it is answered: the focus-mode wheel (No · Unsure ·
  Some · Taken, the outer runway copies as before), focus mode's plain list,
  the classic form (`.medication-selector.med4`, four across at 390 px) and the
  unused edit dialog's select. Taken, No and Unsure are exactly as before (one
  tap; No with two or more medicines still asks "Which did you miss?"). The
  auto-fill "Fill in the rest" step keeps its three answers (it can fill
  several days at once).
- **The sheet** (`BBMeds.openSome(opts)` in `js/journal-meds.js`,
  `#medsSomeModal`, a `.confirm-modal` so native feel makes it a bottom sheet
  that rides the keyboard and closes on a swipe down; z-index 1003). "Which did
  you take?": each medicine on the list *that day* (`BBMeds.listForDay`, the
  history replayed for a past day; an edited entry's own medicines) with its
  usual dose, **Took it / Skipped**, and **Dose taken** (`inputmode="decimal"`,
  prefilled with the number from the usual dose, the unit beside it;
  `parseDose("200 mg")` → 200 / mg, a decimal comma is read). Skipped greys the
  dose. **Done** saves; a dose that isn't a number is refused ("Type the dose as
  a number…"); a blank dose is "taken, dose not given". ✕ / the backdrop /
  Escape / a swipe down close without Done: the answer is still Some, with no
  detail. No medicines on the list: it says so and offers **💊 Add them in My
  medicines** (opens the hub; the answer stays Some).
- **Focus mode** (`_fmMedAnswer('some')` → `_medOpenSome('fm')`): Done or a
  close moves on like any answer; "Add them in My medicines" stays on the step.
  Back on the step, a line under the list says what was recorded with
  **✏️ Which ones?** to change it. The classic form shows the same line in
  `#medDosesRow`.
- **The entry** (`_medFieldsForSave` in `js/journal.js`). Every older build
  reads `medication`, so it stays the day's single answer: all taken (even at a
  different dose) → `taken`; any skipped, or Some with no detail → `not-taken`.
  Added:
  `medSome: true`, `medDoses: {name: 'taken'|'missed'}` (as §2.23),
  `medAmounts: {name: {amount: Number, unit, usual}}` for the taken ones
  (`usual` = the list's dose that day, kept so later list changes don't
  rewrite history). All inside the entry, so it is encrypted exactly like the
  rest (journal key for an account, the PIN key for a guest with a PIN). An
  edit that changes the answer away from Some writes `medSome: null,
  medAmounts: null` over the old entry. Old entries have none of it and read
  as before. Drafts carry `medAmounts`. Older builds show a Some day as Taken /
  No and drop the detail if they re-save it.
- **Reading it** (`BBMeds.someOf(e)` → `{detail, meds: [{name, status, amount,
  unit, usual, changed}]}`; `changed` = skipped, or a dose that differs from the
  usual). `entryNote(e)` gives "Quetiapine 100 mg (usual 200 mg) · Lithium
  skipped" (or "usual doses" / "no details"), so the entry list chip
  ("💊 Some"), the day view, the calendar, the focus review step, the 14-day
  chart's tooltip and the PDF's entries all say what was taken. The CSV's
  medication column says `some`; Medicines says "Quetiapine: taken 100 mg
  (usual 200 mg); Lithium: missed". Adherence (Doses tab, stats, Compare) uses
  `medDoses` as before: a lower dose counts as taken, a skipped one as missed.
  The mood suggestion ignores a Some day's `not-taken` (it may be a prescribed
  lower dose). The reminders' ✅ Taken (§2.27) is a per-time "noted" flag on
  the phone, not an entry, so nothing changes there.
- **Seeing the impact.** Life chart (`js/journal-insights.js`): a Some day is
  orange in the medication strip ("Took some" in the key); a day with a changed
  dose gets a 💊 in a **Dose** row under the sleep bars (`.lc-blood.lc-dose`,
  the 🩸 markers' button, bubble and live line): "Quetiapine 100 mg (usual 200
  mg) · 24 Oct". Tapping the day says "Took some: …". The PDF life chart marks
  Some days orange (taller for a changed dose) with a line in its note. The
  Doses tab has **🤏 Different doses** (every Some day, newest first); Compare
  names the changed-dose days inside either window ("Days with a different
  dose: 2 before, 1 after (…)"), on screen and in the PDF; the PDF's Medicines
  box adds "Different doses (last 30 days)".
- **New features (1.45):** `medSome`, a note (no switch), only with a medicine
  list and the medication step not switched off. Web users who already saw
  "New in 1.45" before v381 won't see it (the sheet shows a release once).
- Strings `medSome.*` in `js/shared/i18n-medsome.js` (10 languages, machine
  translated; journal.html and index.html). CSS in `css/journal-meds.css`.
- Test: `PLAYWRIGHT_MODULE=… node scripts/test-med-some.mjs` (18 checks at
  390 px: Taken / No one tap, Some → sheet → 100 mg saved, reload, the 19 old
  entries, the chart's 💊, the Doses tab, close without Done, a refused dose,
  no medicines, the classic form, encrypted under a guest PIN and decrypted,
  the PDF's text, German, the bottom sheet and a swipe down; `SHOTS=<dir>`).

### 2.31 🌬️ Breathing exercises and the journal's breathing prompt (2026-10-26, v383, for 1.46)

James, 2026-10-26: "a breathing section to the Survival Kit of different
breathing techniques … X in and X out with an accompanying noise / animation
… allow them to select their favourite. Then in the journal ask if they'd like
to do a breathing exercise if they responded anything but stable (5) … visible
but discrete enough that they can just continue … an option in settings to
deactivate breathing prompts (switch off by default)".

- **One module, `js/shared/breathing.js` (`BB.breathing`)**, loaded on
  index.html, journal.html and survival-kit.html. Five exercises, each a list
  of `[phase, seconds]` (`in`, `in2` = a short second breath in, `hold`, `out`):
  Longer out-breath 4·6 (the default), Box 4·4·4·4, Even 5·5, 4-7-8, Double
  sigh 2·1·6. `list()` puts the starred one first.
- **The player** (`open({ id })`): a bottom sheet on phones, a centred card
  from 700 px. A row of exercises (the ★ favourite first), the pattern and one
  line on what it's for, a circle that grows over the in-breath and shrinks
  over the out-breath (CSS transition lasting the phase), the step and a
  countdown, the time left. **1 / 3 / 5 min** (`bbBreathMins`); the time is
  checked at the start of each round, so a round is never cut short. Sound is
  made with Web Audio on the Start tap, no files: looped brown noise through a
  low-pass filter that swells and opens up on the in-breath and fades on the
  out-breath, and a quiet sine bell at each step. **🔇 Mute** (`bbBreathMute`,
  unticked = sound on). A light haptic at each step on phones (`BB.nf.haptic`).
  It stops when the page is hidden (iOS suspends Web Audio anyway). Reduced
  motion: the circle stays one size and fades instead. On iPhone the ring /
  silent switch silences Web Audio, so with the phone on silent there is no
  sound; the circle and the taps still lead. `aria-modal`, focus trap, Escape,
  a tap outside, ✕, and swipe down (registered in `js/shared/native-feel.js`'s
  SHEETS) all close it. The step text is a polite live region; the countdown
  is not read out.
- **Favourite** (`bbBreathFav`, device only): ☆ on each card in the kit or
  **☆ Favourite** in the player; one at a time, tapping it again unstars. It
  goes first in both lists, and the journal's prompt opens it.
- **Survival Kit:** a 🌬️ **Breathing exercises** banner under My safety plan,
  a **Breathe** tab after Coping, and a `#breathing` section
  (`renderList(#skBreathList)`: a card per exercise with ▶ Start and ☆). It is
  in `_SK_SECTION_IDS` (opens as a drawer on phones, `survival-kit.html#breathing`
  deep-links to it) but **not** one of the 12 counted sections — it has nothing
  to finish, and the "/ 12" strings in ten languages stay as they are. The tile
  click handler now takes any `[data-sk-open]`, so the banner is a button with it.
- **The journal's prompt** (`_refreshBreathPrompt` in `js/journal.js`): with
  **⚙️ Settings → Advanced → 📓 Journal → 🌬️ Breathing prompts** on, a mood
  other than Stable — category `stable`, or exactly 5 on the 0–10 spectrum (4
  and 6 do ask) — or a held-on other mood that isn't Stable, shows a small
  dashed line "🌬️ A minute of slow breathing? [Breathe] [✕]": under the
  summary chips on every focus-mode step after the mood (`#fmBreathPrompt`),
  under the mood buttons in the form (`#breathPromptForm`). Nothing waits on
  it. ✕ hides it for that entry; **Breathe** opens the player over the entry
  (the draft is untouched) and hides it too; the next entry asks again. Never
  while editing an older entry.
- **The switch** `breathPromptsEnabled` ('1' / '0'; unset = off): synced as
  `userSettings.breathPromptsEnabled` (read in the journal's auth listener,
  written by `BB.breathing.setPrompts`, which any page can call), cleared on
  logout, on a new user and by Reset settings / Delete all (index.js and
  journal.js); exported and imported with the journal's settings. Delete all
  also clears `bbBreathFav`, `bbBreathMins`, `bbBreathMute`.
- **New features (1.46):** `breathing` — a note with a link,
  "Open them in the Survival Kit →" (`survival-kit.html#breathing`; items can
  now carry `link: { href, labelKey }`), and `breathPrompts` — the switch,
  starting off. Web users who saw 1.45 get it at once; someone who missed 1.45
  sees only 1.46 (as the sheet always has).
- **Engine fix (same change):** `start()` now marks a new install seen at
  once. It used to wait for the screen to be idle first, so someone tapping
  straight through the tutorial was shown the newest release afterwards. 1.45
  hid that (none of its items applied to a new user); 1.46's apply to everyone.
- Strings `breathe.*` in `js/shared/i18n-breathe.js` (10 languages, machine
  translated). Player and card CSS is injected by the module (`.bbbr-*`); the
  banner is in `css/survival-kit.css`, the prompt in `css/journal.css`, dark
  in `css/dark.css`.
- Test: `PLAYWRIGHT_MODULE=… node scripts/test-breathing.mjs` (22 checks at
  390 px: the list and favourite order, the kit's banner / section / cards /
  ☆, the player running in → hold → out with the circle and countdown, Stop,
  3 min + Mute kept, Escape and a tap outside, still "/ 12", the deep link;
  the journal: off by default, Low / Elevated / Stable / held-on Low /
  spectrum 5 and 4, carrying on past it, ✕, Breathe opening the favourite,
  the form, the Settings switch; the 1.46 sheet; German; `SHOTS=<dir>`). The
  other tests now seed `bbWhatsNewSeen` '1.46'; test-blood-charts and
  test-tutorial check the 1.45 entries through the registry.

### 2.32 🗓️ Your week (2026-10-27, v386)

James, 2026-10-27: a short story of the week, worked out on the device, after
deciding against sending journal data to an AI service (the parked
`claude/weekly-insight` branch). "Need to be careful it doesn't say things like
'drinking made your mood improve', nothing that's telling off but equally
nothing that could be seen as nudging someone to drink or drugs."

- **Where:** the top of **Personalised feedback** (the AI Bear button on the
  stats page), above the range's own insights, whatever range is picked. It is
  always the last 7 days. Popup only: nothing new on the stats page. The
  existing insights below it are unchanged (James: different people prefer
  different ways).
- **The Sunday summary notification (ID 2)** now opens the popup when tapped.
  A tap that launches the app waits for `loadEntries()` (`_ywOpenPending`).
  The notification's own text is unchanged: no mood details on a lock screen.
  Like the anniversary taps, the listener lives in `js/journal.js`, so it only
  works when the app opens on the journal. **Not tested on a phone yet.**
- **Code:** `js/journal-week.js` (`BBWeek.summarise(entries, {now})` returns keys
  and numbers only; `BBWeek.cardHtml(entries)` translates and escapes). It uses
  `BBInsights._pure` (`moodCat`, `moodScore`, `isShortNight`, `median`), so it
  loads after `js/journal-insights.js`. Strings are in `js/shared/i18n-week.js`
  (`week.*`, 10 languages, machine translated). The care line and strategies
  link reuse `journal.earlyWarn.*`. CSS: `.yw-*` in `css/journal.css` and
  `css/dark.css`.
- **No card when:** there is no logged day in the last 3 days, or fewer than 4
  logged days this week. Auto-filled days (§2.13) never count.

#### The rules (they're in the code's header comment too)

- **"Better" means closer to stable, never higher.** Each day's `off` is
  |moodScore − 3| (0-2). "Steadier" compares averages of that, so an elevated
  day is never good news.
- **Nothing that tells anyone off.** Missed medication, missed entries and
  fewer steps are never mentioned. "Every day logged" and "medication taken on
  every day you logged" appear only when they are true.
- **Substances.** Smoking and drugs are never read. Alcohol gets one factual
  sentence, and only when the days after drinking were less settled than the
  days after not drinking. There's never a "no difference" or better version,
  and never an idea line. A test fails if any idea string mentions a substance,
  or if the alcohol string contains better / steadier / help / improve / lift.
- **Getting outside / exercise** are mentioned only when those days were
  steadier (by 0.5 or more). Less steady is never mentioned, so nothing
  discourages them.
- **Sentences** (top 3 by priority): short nights followed by elevated or low
  days, 2 or more times (6; "Your journal shows this has happened before too"
  when there were 3 or more such pairs in the year before); stable days compared
  with last week, ±2 or more (5); average sleep compared with last week, ±45 min
  or more, worded neutrally (4); outside / exercise (4); high-stress days less
  settled (3); alcohol (3); every day logged, medication (1). Comparisons need
  4 or more logged days in both weeks. A short night uses the early warnings'
  `isShortNight` with a personal 30-night median.
- **Headline:** steadier than last week (2 or more extra stable days and at
  least half stable), else mostly stable (70%), ups and downs (2 or more each
  way), lower (50% low), elevated (50% up), mixed.
- **Idea line (James: keep it):** only from a sentence that is on the card:
  protect sleep (short-night link), time outside, exercise "at whatever level
  feels right", or keep the routine (sleep nearer usual and a steadier week).
  Otherwise there's no idea line.
- **Check-in:** 3 or more depressed or 2 or more manic logged days adds "If
  you're worried, talk to your care team" and 🧠 Open my strategies.

- Tests: `node scripts/test-your-week.js` (no browser: thresholds, headlines,
  the steadier-not-higher rule, the alcohol and substance rules, no missed-meds
  line, top 3, check-in, every key in all ten languages with matching
  placeholders and no unused strings) and
  `PLAYWRIGHT_MODULE=… node scripts/test-your-week.mjs` (7 checks: English
  text, 390 px, dark mode, pl / de / zh / fr, no raw keys; `SHOTS=<dir>`).

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
