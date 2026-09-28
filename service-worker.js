/**
 * BipolarBear PWA service worker.
 *
 * Strategy: network-first with a cache fallback. Successful GETs are cached as
 * we see them so the app keeps working when the device drops offline. We
 * bypass Google/Firebase/CDN traffic entirely — Firestore handles its own
 * offline persistence and we don't want to fight it.
 *
 * Bump CACHE_NAME whenever a precached asset changes; old caches are deleted
 * on activate. Currently registered from journal.html and survival-kit.html
 * (see `navigator.serviceWorker.register('/service-worker.js')` in those
 * files); the other pages still benefit because the cache is shared per-origin.
 *
 * @file service-worker.js
 */

// Bump this string to invalidate every client's cache. Format: <slug>-vN.
// v4: per-page CSS/JS were extracted to css/* and js/* in Phase 4 of the
//     2026-Q2 refactor — every old client must drop its v3 cache.
// v5: fix journal.js boot crash (setDefaultDate ran before #entryDate existed,
//     leaving logoCurrentIndex in TDZ → broke delete-all + easter egg).
// v6: move <script src="js/journal.js"> to end of <body> in journal.html so
//     all DOM nodes the script touches at top-level exist when it runs.
// v7: anonymous.html + js/anonymous.js — add Sign Out button for standalone
//     (email-code) users in the Monika settings overlay.
// v8: css/anonymous.css + js/anonymous.js — make Monika settings sheet
//     scrollable, hide duplicate "Discover BipolarBear" link on anon domain.
// v9: js/anonymous.js — hide Stability Counter on Monika sheet for
//     standalone (anon-direct) users; BB-app users only.
// v10: beta.html / css / js — remove WhatsApp group link.
// v11: js/anonymous.js — fix duplicate chat messages (initBoard handler
//     wiring is now one-time; Post button has an in-flight guard).
// v12: js/anonymous.js — _bbRestoreProfile falls back to
//     anonProfiles/{hash(email)} when userSettings has no anonProfile, so
//     a BB account whose email was already used standalone reuses the
//     existing monika instead of prompting for a new one.
// v13: add js/shared/brand-config.js + css/theme.css scaffolding (Phase 1
//     of the multi-variant refactor). Additive only — nothing consumes
//     them yet, but they are linked from every HTML page so must be in
//     the offline cache.
// v14: Phase 2 of the multi-variant refactor — sweep brand-coloured hex
//     literals in css/{index,journal,survival-kit,anonymous,beta}.css
//     onto the var(--brand-*) tokens defined in theme.css. Visually
//     identical, but every CSS-precached file changed so v13 caches
//     would still serve the old palette.
// v15: extend the same sweep to inline style="..." attributes in the
//     five page HTML files. Paint-blocking <style>body{...}</style>
//     blocks and <meta theme-color> values intentionally still use hex
//     literals (one can't see :root tokens at parse time, the other
//     isn't CSS).
// v16: complete the Phase 2 sweep across js/{index,journal,survival-kit,
//     anonymous}.js and fab.js. Brand hex literals in template-literal
//     style="..." strings, .style.X assignments, Object.assign({style,
//     background, color}), and confetti/toast colour arrays now resolve
//     via var(--brand-*). All five files still parse via `node --check`.
// v17: Phase 3a of the multi-variant refactor — add BB.storage helper to
//     brand-config.js and sweep the 19 'bbAnon{Posts,Monikas,Reports}'
//     Firestore collection literals onto BB_BRAND.collections.*. Runtime
//     behaviour identical (the resolved values match the old literals).
// v18: Phase 3b — sweep ~390 localStorage call sites across js/shared/{
//     debug,onboarding}.js, js/{index,journal,survival-kit,anonymous,
//     beta}.js, fab.js onto BB.storage. brand-config.js moved to first
//     in the shared-helpers script load so debug.js + onboarding.js can
//     read through BB.storage. sessionStorage and a small set of
//     mixed/dual-use array literals intentionally still use raw
//     localStorage (documented in commit notes); they don't block the
//     multi-variant goal because they don't hardcode the prefix
//     anywhere a future variant would need to override.
// v19: move _nukeGuestData / _confirmDeleteGuestData from js/index.js to
//     fab.js so the "🗑 Delete all guest data" button in the shared auth
//     modal works on /journal and /survival-kit too (was a silent no-op
//     because window._confirmDeleteGuestData was only defined on /).
// v21: brand-config.js gains BB_BRAND.bundle + BB.isAnonymousApp() so the
//     standalone Bipolar Anonymous app can detect itself when running
//     natively (where location.hostname is 'localhost' and the existing
//     domain check missed). js/anonymous.js sweeps onto the helper. The
//     precached brand-config.js content changed, so old clients must
//     drop their v20 cache.
// v23: js/anonymous.js — hide the "0" comment count on posts with no
//     comments yet (only the 💬 emoji shows; count appears once > 0).
// v24: v1.0 — fix stale signed-out home stats and the signed-in journal
//     redirect loop on native; show app version in the profile FAB popup
//     (window._APP_VERSION = '1.0'). Touches js/index.js, fab.js,
//     js/shared/brand-config.js, journal.html, survival-kit.html — every
//     old client must drop v23.
// v25: anonymous.html / css / js — surface app version (window._APP_VERSION)
//     in the About overlay footer, and drop the 52px top-padding floor on
//     .board-header so mobile Safari (where env(safe-area-inset-top) is 0)
//     no longer renders an empty yellow spacer above the board header. The
//     Capacitor shell + PWA standalone still get the inset because the rule
//     is now calc(16px + env(safe-area-inset-top)).
// v26: js/anonymous.js — stack the ADMIN chip on its own line beneath the
//     monika in the board header pill so the streak + birthday badges no
//     longer overflow off the right edge of the bar for admin accounts.
// v27: v1.1 — pull BipolarBear stability streak and account creation date
//     into the Anonymous board when signing in with a linked BB email.
// v28: js/index.js — unlock the settings/auth FAB the moment the onboarding
//     tutorial reaches step 12, instead of waiting for the user to dismiss
//     the "Tutorial Complete!" popup.
// v29: v1.2 — settings/auth FAB unlocks after first journal entry (not tutorial completion).
// v30: v1.2 — wire mood-form heading and view-entry label through i18n (was hardcoded English).
// v31: v1.2 — translate focused-mode wizard step titles, date phrases, and tracking field labels.
// v32: v1.2 — translate submit buttons, save-confirm modal, edit button states, draft status.
// v33: v1.2 — translate calendar entry rows and delete-field-confirm modal.
// v34: v1.2 — translate mood-info modal labels, Bipolar UK toggle, and mood-linking buttons.
// v35: v1.2 — translate missing-entries banner (with pluralization), calendar empty state, focused-mode preview chips.
// v36: v1.2 — fix syntax error in index.js (smart quotes in _WHATS_NEW_HEADLINES broke home page: hint, logo tap, profile button, anon link, survival kit nav).
// v37: security — escape Firestore-sourced gradient/streak/icon fields in anonymous-board renderers; 6-digit code boxes.
// v38: v1.3 — version bump for the security release; refresh precached brand-config.js (_APP_VERSION='1.3') and js/index.js (new _WHATS_NEW_HEADLINES entry).
// v39: Wiki feature Phase 1 — extract KNOWN_MEDS from survival-kit.js into shared js/shared/medications.js so the anonymous-board Wiki tab (forthcoming) and survival-kit read the same source.
// v40: Wiki feature Phase 2 — add 📖 Wiki tab + hidden wiki-section to anonymous.html; setTab in anonymous.js routes wiki tab (hides post list, hides compose FAB). i18n 'anon.board.wiki' added across 10 locales.
// v41: Wiki feature Phase 3 — populate wiki section with sub-section pills (Medications / Support Groups / Community Wisdom), renderers in anonymous.js, wiki CSS, and precache wiki JSON data.
// v42: Wiki feature Phase 4 — add 🔍 search FAB that toggles an inline search bar in the wiki tab (per-section substring filter); convert wiki strings to i18n keys (English populated, other locales fall back).
// v43: Wiki — add 🧠 Conditions pill with peer-friendly definitions of Bipolar I, Bipolar II, Cyclothymia, and Other Specified Bipolar (NOS). Single disclaimer at top, NHS link per card. i18n keys pillConditions + conditionsDisclaimer added to English.
// v44: Wiki — stack pill chips across two rows on mobile (<520px), and slowly rotate the row that doesn't contain the active pill when its content overflows the screen.
// v45: Wiki — add Rapid Cycling card to the Conditions section (course specifier, not a separate diagnosis).
// v46: Wiki — broaden the Conditions section with Mixed Features, Seasonal Pattern, Major Depressive Disorder, Anxiety Disorders, ADHD, BPD/EUPD, and Schizophrenia & Schizoaffective. Each card has an NHS info link.
// v47: Wiki — add 8 new sections: Therapies, Lifestyle, Warning Signs, Side Effects, Hospital, Workplace, Pregnancy, and Books & Films. New shared _renderWikiSimpleCards helper. i18n keys for pill labels + per-section disclaimers added to English locale.
// v48: Wiki — add For Loved Ones section (partners, family, carers): early signs, what to say, helping during mania / depression, hospital admissions, carer wellbeing, carer rights, and when to call for help.
// v49: Wiki — rebalance pill rows 7/6 (was 6/7). Hospital moves from row 1 to row 0 alongside the rest of the clinical group.
// v50: Wiki — drop the auto-marquee (broken in Firefox; conflicted with manual scroll). Both pill rows are now independently scrollable; CSS mask-image fades the edge that has more content; first wiki open per session triggers a one-time peek nudge so the user sees the rows can be swiped.
// v51: Mobile UX — `touch-action: manipulation` on anonymous/beta/privacy pages kills the 300ms double-tap-zoom delay; tapping a wiki pill now smooth-scrolls the pill to the left edge of its row to reveal more pills.
// v52: v1.4 — version bump for the Wiki release. Refreshes precached brand-config.js (_APP_VERSION='1.4') and js/index.js (new _WHATS_NEW_HEADLINES['1.4'] entry).
// v53: Wiki — each card now shows the source website (e.g. "NHS.uk", "Mind", "Bipolar UK") and an "AI summary" / "Direct quote" badge above the link button; link button text now reads "Read on {site} ↗".
// v54: Wiki Books & Films — each media card now reserves a 72×108 cover slot (book jacket / film poster) at images/wiki-media/<slug>.jpg. Missing files hide themselves so unfilled entries render the same as before.
// v55: add js/shared/version-check.js — fetches /version.json and shows a top banner when a newer release is available (web → refresh, native → open store). New <script> tag added to index/journal/survival-kit/anonymous.html. Also: index.html shows a "v1.4 · iOS" chip below the auth FAB (populated by BB.versionLabel()); four home-page badges (journal streak, survival progress, anon messages, anon streak) get blurred-text skeleton placeholders that reserve their layout row until js/index.js swaps in real values — kills the empty-to-populated layout jump on the home screen for signed-in / guest-PIN users. fab.js now delegates its version label to BB.versionLabel() (single source of truth). Old v54 caches must drop so the new shared script, HTML, CSS, and JS all land together.
// v56: survival-kit.html / .css / .js — add 6 quick-add medication chips (Lithium, Quetiapine, Lamotrigine, Sodium Valproate, Olanzapine, Aripiprazole) in the My Medications modal. Tapping a chip fills the name input and focuses the dosage field.
// v57: remove the beta landing page / web access gate — `/` now serves index.html directly (worker.js), and the inline + js beta-gate redirects are gone. Dropped beta.html, css/beta.css, js/beta.js from the precache. Also: fixed the broken social-share image (og:image now points at the new haloed bear via images/og-card.png instead of a 404'd favicons path), added a real 1200×630 share card, fixed site.webmanifest, and added robots.txt + sitemap.xml.
// v58: extend "deleted by admin" tombstone visibility from 1 hour to 24 hours on the anonymous board.
// v59: in-app confirmation popup before enabling notifications/health sync on native (consent gate that survives account deletion, since OS permission grants can't be revoked programmatically); journal settings version label now reads the canonical window._APP_VERSION instead of a hardcoded 1.2, so it stays in sync with the home page.
// v60: permission-prompt fixes (journal.js). Notifications no longer prompt at startup/during the tutorial — initNotifications() now uses the non-prompting checkPermissions() and only re-schedules if already granted, so the OS notification sheet is raised solely by the reminder/weekly toggles. Health-sync toggle now actually requests OS Health access at the moment it's enabled (it previously only set a flag, so users saw "Not yet authorised" and were never asked); auto-sync on mood/focused-mode steps is gated behind checkHealthPermissions so a Firestore-rehydrated flag after reinstall can't pop a surprise sheet from ordinary navigation. When iOS suppresses the Health sheet (stuck grant after reinstall), the toggle offers a deep-link to Apple Health settings. iOS health status label no longer over-promises "Authorised" (read grants are opaque on iOS) — Android wording unchanged.
// v61: add the public marketing/landing page — worker.js now serves
//      marketing.html at `/` (the web app moved to /index.html). Precache
//      marketing.html + css/marketing.css + js/marketing.js so the new
//      homepage works offline. Installed PWAs still open the app directly
//      (manifest start_url is now /index.html).
// v62: add the Bipolar Anonymous marketing page — worker.js now serves
//      marketing-anonymous.html at `/` on bipolaranonymous.app (the board
//      stays at /anonymous). Precache it; it reuses css/marketing.css +
//      js/marketing.js, already cached.
// v63: js/marketing.js — hold each showcase carousel on its hero screenshot
//      until it scrolls into view, instead of auto-advancing from page load.
// v64: drop the (yellow) Bipolar Anonymous screenshot from the Bipolar Bear
//      carousel on both marketing pages — it clashed with the orange section.
// v65: v1.5 — version bump for the permission-prompt / HealthKit-reinstall
//      fix. _APP_VERSION='1.5' (brand-config.js), version.json web=1.5
//      (app stays 1.4 until the native build ships), new _WHATS_NEW_HEADLINES
//      ['1.5'] entry in js/index.js.
// v66: re-version onto the unified scheme — display = "1." + build number
//      (zero-padded). The journal.js permission fix ships as build 9, so
//      _APP_VERSION='1.09', version.json web=1.09 (app stays 1.4 until the
//      native 1.09 / build 9 build is live). Native: MARKETING_VERSION 1.09,
//      CURRENT_PROJECT_VERSION 9 (iOS app+widget); versionName 1.09,
//      versionCode 9 (Android).
// v68: root routing fix — wrangler.json now sets assets.run_worker_first so
//      worker.js actually runs for `/` and serves marketing.html (previously
//      Cloudflare served index.html directly and the worker was bypassed).
//      Bumped to drop any stale runtime-cached `/` → app-shell entry so
//      returning visitors land on the marketing page.
// v69: marketing showcase carousels are now dressed as a phone — the viewport
//      is a dark device body (bezel + dynamic-island pill) with the screenshot
//      clipped to the rounded screen inside it (css/marketing.css +
//      js/marketing.js).
// v70: home screen is now Journal-only by default. Survival Kit / Bipolar
//      Anonymous AND the stat badges are opt-in — enabled from Profile →
//      Customise (flags flipped from "hide" opt-out to "enabled" opt-in:
//      bbSurvivalBtnEnabled / bbAnonBtnEnabled / bbHomeStatsEnabled + Firestore
//      homeSurvivalEnabled / homeAnonEnabled / homeStatsEnabled). Account delete
//      / full reset returns to Journal-only with stats off. Also: Android
//      hardware/swipe back on journal.html + survival-kit.html now returns to
//      the home screen instead of exiting the app (js/journal.js,
//      js/survival-kit.js); and the guest Profile → Account page is stripped to
//      just the delete/reset option (index.html + js/index.js). Refresh precache.
// v71: consolidate the home-screen auth FAB. index.html shipped its own
//      #authFabWrapper (pre-dock auth button) on top of fab.js's #bbAuthFab at
//      the SAME bottom-centre coordinates — two stacked buttons toggled by
//      bbFabsUnlocked, with index.js and fab.js setting the wrapper's display
//      to opposite values (a latent desync). Removed the wrapper; #bbAuthFab is
//      now the single auth/profile button, always visible (fab.js owns it).
//      index.js restyles it per auth state + dims it offline; version chip is a
//      standalone #bbHomeVersion. Touches index.html, js/index.js, fab.js.
// v72: rename the landing route /marketing → /welcome. marketing.html →
//      welcome.html, marketing-anonymous.html → welcome-anonymous.html,
//      css/marketing.css → css/welcome.css, js/marketing.js → js/welcome.js.
//      worker.js now serves the host-aware landing at both `/` and `/welcome`
//      (wrangler run_worker_first gains "/welcome"). Precache paths updated.
// v73: js/anonymous.js — fix comment threads for standalone (email-code)
//      users. Firestore rules require auth on the comments subcollection
//      while bbAnonPosts itself is open, so posting worked but threads
//      silently failed. The board now signs in anonymously
//      (_ensureAuthSession) before subscribing/sending; send failures keep
//      the typed text and show a hint instead of vanishing; listener errors
//      no longer masquerade as "No comments yet".
// v74: welcome carousels — hide the prev/next arrows while the hero
//      screenshot (slide 1) is showing; they fade in once the carousel
//      auto-advances. Touches js/welcome.js, css/welcome.css.
// v75: mood-meter bear shadow moved off filter:drop-shadow onto a
//      .mood-stage::after ellipse — iOS Safari painted the drop-shadow as a
//      grey rectangle behind the transparent PNG. Touches css/welcome.css.
// v76: home buttons vertically centred between the logo and the FAB dock;
//      home stats (streak/stability/survival progress) now paint instantly
//      from cache for returning users via an inline early-paint script;
//      welcome hero gains a faded bear backdrop on mobile. Touches
//      index.html, css/index.css, welcome.html, css/welcome.css.
// v77: stats-off users no longer see the skeleton placeholders blur-flash on
//      load — the early-paint script applies bb-hide-stats synchronously when
//      the Show-stats preference is off. Touches index.html.
// v78: App Store review fixes — the ☕ donation FAB is suppressed in the iOS
//      native shell (Guideline 3.1.1: external donation links must use IAP;
//      web + Android unchanged), and the health-sync UI now names Apple
//      Health / Health Connect explicitly instead of "your phone's health
//      app" (Guideline 2.5.1). Touches fab.js, journal.html, js/journal.js.
// v79: App Store hardening round 2 — anonymous board gains a per-user mute
//      (🙈 on each post, persisted in bbAnon_muted, managed from the About
//      sheet) to satisfy Apple UGC guideline 1.2's block-user requirement;
//      all user-facing "BETA" labels renamed "Experimental" (2.3.10 risk).
//      Touches anonymous.html, js/anonymous.js, journal.html, js/journal.js.
// v80: version bump to 1.11 (build 11) for the App Store resubmission —
//      _APP_VERSION in brand-config.js + what's-new headline in js/index.js.
// v81: home polish — logo now vertically centred between the page top and
//      the Mood Journal button (css/index.css auto margin) so the default
//      single-button home looks balanced; tutorial finale gains a blocking
//      "Create an account to customise your experience" hint pointing at the
//      profile FAB before the complete popup (js/index.js, one-shot via
//      bbAccountHintShown). Touches css/index.css, js/index.js, js/journal.js.
// v82: post-sign-up onboarding — creating an account now auto-opens the
//      profile popup (after the tutorial-complete toast, if any) with the
//      Survival / Anonymous customise toggles pulsing under a NEW pill
//      (cleared once both are enabled or after 3 views). New optional
//      _fabOnSignUp hook in fab.js. Touches fab.js, js/index.js,
//      css/index.css.
// v83: App Store 2.5.1 — surface the Apple Health (HealthKit) sync card at the
//      top of the journal Settings panel (was buried under Advanced), and
//      confirm iOS read access by probing real data ("Connected to Apple
//      Health"). Touches journal.html, js/journal.js.
// v84: v1.12 — build-12 version bump (_APP_VERSION 1.12). Touches
//      js/shared/brand-config.js.
// v85: i18n pass + home live-data fixes — mood labels (Manic/Elevated/Stable/
//      Low/Depressed) and focused-mode step options (energy, sleep quality,
//      medication, anxiety/stress/irritability, yes/no) now go through BB.t
//      (EN + FR complete); auth/account modal "Create an account" cluster
//      wired to i18n. Home: entry tick now paints synchronously from cache
//      (validated against today/yesterday so a stale day no longer sticks)
//      and the online reconcile no longer trusts a stale done:true. Touches
//      js/shared/i18n.js, js/journal.js, journal.html, fab.js, js/index.js,
//      index.html.
// v86: i18n pass round 2 (EN + FR) — wired the remaining hardcoded strings:
//      classic (non-focused) journal form (sleep quality, medication, more-
//      data question rows + yes/no/normal answers, notes), edit-entry mood +
//      medication dropdowns, focused-mode placeholders/buttons (notes,
//      intention, "More details", budget/goals "Set"/"Change", Over budget/
//      On track), the empty-entries state, and the fab.js feedback modal,
//      quick-note modal, FAB picker, account change-password/email modal +
//      its success/error messages. Touches js/shared/i18n.js, js/journal.js,
//      journal.html, fab.js.
// v87: i18n pass round 3 (EN + FR) — focused-mode step titles (anxiety/
//      stress/irritability/exercise/outside/alcohol/budget), the full edit-
//      entry modal (Date/Energy/Sleep/Notes labels, all 8 advanced group
//      labels + "Not recorded"/option values, Save Changes), the Missing
//      Entries modal, and the common confirm dialogs (select mood, discard
//      changes, delete-all-entries). Touches js/shared/i18n.js, js/journal.js,
//      journal.html.
// v88: v1.13 — build-13 version bump (_APP_VERSION 1.13). App Store Guideline
//      5.1.1(iv) fix: removed the cancelable in-app confirm() that sat before
//      the HealthKit / Health Connect permission request when enabling the
//      health-sync toggle. Flipping the toggle on now goes straight to the OS
//      permission sheet (the real consent gate) — no exit button between the
//      user's action and the request. Touches js/journal.js, brand-config.js.
// v89: Full EN/FR i18n pass (moods, focused-mode steps + titles, journal
//      labels, FAB strings, edit-entry modal, confirm dialogs, Missing Entries
//      modal). Home live-data fix. Touches js/shared/i18n.js, js/journal.js,
//      js/index.js, journal.html, fab.js.
// v90: Home anonymous visit-streak badge is now lapse-aware. The cached
//      Anon_streak didn't self-expire, so a broken streak kept painting on the
//      home page until the board recomputed it (the "2-day streak that wasn't"
//      bug). New BB.anonLiveStreak() validates against AnonVisitDate; index.html
//      early-paint + _updateStreakBadge() use it, and the home auth listener now
//      restores AnonVisitDate from Firestore. Touches js/shared/brand-config.js,
//      js/index.js, index.html.
// v91: Anonymous privacy sheet rewritten to be accurate — posts are plaintext
//      on Firestore, so the old "End-to-End Encrypted / Messages are encrypted"
//      claims were false. Now states posts are public, identity is hashed, and
//      data is encrypted in transit + at rest. Updated across all 10 languages
//      in js/shared/i18n.js + anonymous.html defaults. Also added an App Store
//      reviewer bypass (test@bipolarbear.app) to js/anonymous.js.
// v92: Sign-in is now optional everywhere — all features (customise journal +
//      home) work as a guest, and signing in only backs up/syncs data. The
//      home profile FAB opens the Profile modal for guests (was the sign-in
//      form), the journal dock FAB opens Settings for guests (was the sign-in
//      form) and Settings gained a guest-only "Sign in to back up" button, and
//      the tutorial-finale account hint is reframed around optional backup.
//      Touches js/index.js, js/journal.js, journal.html, js/shared/i18n.js.
// v93: v1.14 (build 14) release — version bump only, rolls up the v90–v92
//      web changes (lapse-aware anon streak, accurate privacy sheet,
//      optional sign-in) into a fresh App Store build.
// v94: Settings/profile tidy-up — drop the duplicate "Health data:" status
//      line from the top Apple Health sync card (it already shows in the
//      settings footer), and move the guest "Sign up / in" button below the
//      language picker in the home Profile modal to mirror the Settings menu.
//      Also fixes the journal open/close button rendering its raw i18n key
//      (duplicate journal.btn block in the en + fr locales). Touches
//      journal.html, index.html, js/shared/i18n.js.
// v95: Move the Apple Health (HealthKit) sync card off the top level of
//      Settings into the Advanced "Mobile Settings" panel, below the Daily
//      Mood Reminder. Touches journal.html.
// v96: Tutorial finale auto-enables the Survival Kit home button (only if the
//      flag was never set) when it points the user at the profile button, so
//      the Survival Kit is pre-selected in the Customise panel and visible on
//      the home screen once they close it. Touches js/index.js.
// v97: In-app changelog updated for v1.14 — added a "What's New" headline
//      (js/index.js) and a v1.14 block in the full Changelog modal
//      (journal.html) covering this release's user-facing changes.
// v98: Tutorial finale now also auto-enables the Bipolar Anonymous home
//      button alongside the Survival Kit (each only if its flag was never
//      set), so both are pre-selected in the Customise panel. Touches
//      js/index.js.
// v99: First journal visit after the tutorial shows a one-shot blocking hint
//      (index-finale style: dimmer + elevated FAB + label) pointing at the dock
//      Settings FAB. New i18n key journal.hint.settingsFab in all 10 locales.
//      Touches js/journal.js, js/shared/i18n.js, journal.html (changelog).
// v100: Spelling fix — user-facing "Monika" → "Moniker" (the correct English
//       word for a chosen handle) across all 10 locales + hardcoded HTML/JS
//       copy. Internal identifiers untouched (Firestore bbAnonMonikas,
//       localStorage Anon_monika, element ids, i18n key names, openMonikaSettings).
// v101: EN/FR language coverage pass — wired the remaining hardcoded English
//       strings on the Bipolar Anonymous board (anonymous.js: relative times,
//       button states, empty/error states, medication subtitles, status rows,
//       aria-labels) through BB.t, and fully internationalised the public
//       marketing landing pages (welcome.html, welcome-anonymous.html,
//       js/welcome.js — new lp.* namespace, data-no-lang-picker opt-out) and
//       the Survival Kit (survival-kit.html, js/survival-kit.js — new sk.*
//       namespace covering the mood scale, strategies, mind games, reading/
//       media, and dynamic modal titles/buttons). English + French added in
//       js/shared/i18n.js. Touches js/shared/i18n.js, js/anonymous.js,
//       welcome.html, welcome-anonymous.html, js/welcome.js, survival-kit.html,
//       js/survival-kit.js.
// v103: Bipolar Anonymous App Store compliance — in-app account deletion
//       (guideline 5.1.1) plus a signup terms-acceptance gate, a zero-tolerance
//       Community Guidelines & Terms overlay, and an in-app contact (guideline
//       1.2) in anonymous.html / js/anonymous.js; a mobile top-bar overflow fix
//       (css/anonymous.css); and the contact email switched to
//       bipolar@unisim.co.uk (privacy.html + anonymous board).
// v104: Daily discussion topic on the Anonymous board — a rotating inline
//       prompt post (data/daily-topics.json, js/anonymous.js, css/anonymous.css)
//       that advances only after the board sees activity.
// v105: Guest data-loss fix — guest-entered data (medications, daily goals,
//       budget, coping strategies, mood definitions, memories, reminders,
//       commitments, gratitude) lived only in localStorage; creating an account
//       never uploaded it, so it vanished when localStorage was cleared
//       (reinstall, eviction, new device). New shared helper
//       js/shared/guest-data.js (BB.claimGuestData) backs guest data up to
//       userSettings on sign-in/sign-up when the account has none yet —
//       idempotent + non-destructive. Wired into the auth listeners on
//       index.html, journal.html, survival-kit.html (js/index.js, js/journal.js,
//       js/survival-kit.js) + precached in STATIC_ASSETS.
// v106: Duplicate "Today's topic" fix — the capped (60-doc, unordered) feed
//       listener could drop the live topic from its snapshot, so the rotation
//       saw no current topic and re-bootstrapped a second one under a new day's
//       doc id without deleting the first (two identical topic threads). The
//       rotation now reads topics via a direct isTopic== query (immune to the
//       cap), sweeps every topic but one, and a render-side dedupeTopics guard
//       only ever shows the newest. js/anonymous.js.
// v107: Anonymous board UGC hardening (Apple guideline 1.2) — adds a
//       client-side content filter (slur/explicit-language blocklist that
//       rejects posts + comments before they reach Firestore; crisis language
//       and UK slang deliberately not blocked) and an admin "ban user"
//       mechanism (new bbAnonBanned collection + 🚫 button) that hides the
//       user's content everywhere and blocks them from posting. Touches
//       js/anonymous.js, js/shared/brand-config.js, anonymous.html.
// v108: iPad full-screen fix — on a real device (esp. iPad, ≈1024px wide) the
//       ≥920px desktop device-frame mockup was rendering inside the native
//       app, so the live iPad app — and its App Store screenshots — looked
//       like a marketing mockup on a grey backdrop rather than the app in use
//       (App Store screenshot rejection). js/shared/platform.js now tags <html>
//       with .is-native, and css/{index,journal,survival-kit}.css suppress the
//       frame for native builds (full-bleed brand background, centred column).
//       fab.js docks the FAB to the viewport on native. Web desktop keeps the
//       framed mockup. Touches platform.js, fab.js, index/journal/survival-kit CSS.
// v109: Anonymous board — guarantee a single "Today's topic" card. The render-side
//       dedupe now lives inside renderPosts (the one choke point every render funnels
//       through) instead of only assembleGeneralPosts, so the optimistic-compose path
//       can no longer bypass it and surface duplicate topic cards. That path also now
//       routes through assembleGeneralPosts so it keeps the greeting/seed cards.
// v110: Anonymous board — daily topics are now archived, not deleted, when they
//       rotate: an outgoing topic that got a reply is demoted in place to an
//       ordinary BipolarBear post (same doc id, so its reply thread carries over)
//       instead of being swept away; empty topics are still removed. Rotation
//       also now requires a reply on the current topic — a topic with no
//       responses stays up until it gets one, then rotates on the next UTC day.
// v111: Nunito ships as the app-wide font (css/fonts.css + fonts/*.woff2,
//       matching the App Store artwork), and the journal form's synced
//       steps (sleep, energy) get the mockup treatment: big emoji, large
//       value readout, "Synced from Apple/Android Health" badge, and a
//       full-screen focused-mode layout with a slider-wheel option picker.
// v112: Anonymous board — the two example (seed) posts at the foot of the General
//       feed now rotate through a pool every 7 days (the same window real posts
//       age out on), and a footer note tells users "Posts and replies here
//       automatically disappear after 7 days". Retention/rotation/footer all read
//       one shared POST_RETENTION_DAYS constant.
// v113: Focused mode spinner polish — wheels are always swipeable (edge padding
//       computed per wheel so the first/last pill can centre, even when all
//       pills fit on screen), a dial arrow + outline ring frame the centred
//       pill with a light haptic tick per slot change, ghost previews show the
//       emoji at full visibility inside the dashed ring, hero/pill icons get a
//       gentle looping bob, and the medication step moves "Manage medications"
//       below the wheel to the bottom of the page.
// v114: Focused mode — sleep is asked before energy (step order + full-form
//       section order + review-list order), ← / → cycle the spinner on
//       desktop, and sparks fly off the hero emoji (the active centre item).
// v115: Fix — the home-page PIN lock init ran while the document was still
//       parsing (js/index.js sits above the #guestPinOverlay markup), so for
//       a locked guest it threw, the unlock overlay never appeared, and
//       journal.html's PIN gate bounced every Mood Journal tap straight back
//       to the home screen. PIN lock + dimmer wiring now defer to
//       DOMContentLoaded.
// v116: Focused mode — sleep-quality step joins the spinner-wheel design,
//       sleep long-press only fires on the centred pill, icon-specific hero
//       effects (zzz / rocket exhaust / rain / money / tear / halo), iOS
//       wheel swipe fixes (touch-action pan-x + snap released around
//       programmatic centring), blocking tutorial hints scroll their target
//       into view, and the exited view gains a delete-draft bin + a
//       "Show more" collapsible over the rest of the landing screen (with
//       the nav header forced visible).
// v117: Focused mode — the form background now follows the wheel: spinning to
//       a slot washes the card in a pale tint of that slot's colour (e.g. 6-7h
//       sleep → pale orange), falling back to the mood-based default per step.
//       Also fixes the 2-option medication wheel refusing to swipe on iOS
//       Safari — its scroll range was too small for scroll-snap:mandatory, so
//       short wheels now get momentum padding + proximity snapping.
// v118: Focused mode fixes for v117 regressions on iOS —
//       (1) the wheel background wash used CSS color-mix(), which older iOS
//       Safari silently drops, so the tint never showed; it is now computed in
//       JS as a plain rgb() value (resolves hex + var(--brand-*) alike).
//       (2) the medication wheel's proximity snapping let it rest between
//       slots, spilling a pill off the screen edge ("not contained"); short
//       wheels keep MANDATORY snapping now (a pill always settles centred) and
//       get generous ~300px momentum room so the swipe still works.
// v119: Focused mode — the v118 momentum padding pushed the short-wheel pill
//       off-centre (no longer under the dial arrow). Reverted to exact
//       centring, and instead of fighting iOS scroll-snap on a 2–3 pill wheel,
//       a horizontal swipe on a short wheel now steps to the adjacent pill
//       programmatically (same path as the ← / → keys) — reliable on iOS and
//       always lands centred.
// v120: Focused mode — motion-sensitivity compromise. Under
//       prefers-reduced-motion the big travelling particle effects (sparks,
//       pill bob, drifting zzz/flame/rain/money/tear auras) stay suppressed,
//       but the gentle in-place idle motion (hero float + stable-bear halo
//       glow) is now allowed through so the form still feels alive.
// v121: Focused mode — small "Reduced motion" badge in the card header that
//       appears only when the device has Reduce Motion enabled (revealed
//       purely by the prefers-reduced-motion media query), so it's clear why
//       the animations are held back.
// v122: Anonymous board — fix the "stuck on Loading posts…" boot hang when the
//       Firebase SDK is blocked or slow (ad blockers, offline first paint,
//       restricted networks). The 2.5s fallback boot referenced
//       _anonInitialBoot, which was scoped inside initFirebase(), so the
//       fallback threw a ReferenceError instead of booting the board. The flag
//       now lives at file scope in js/anonymous.js.
// v123: Focused mode — (1) short wheels (medication) now swipe reliably: native
//       scroll is disabled and a horizontal drag steps to the adjacent pill
//       programmatically (iOS scroll-snap could never flick a 2-pill wheel).
//       (2) a unique aura per mood + per energy/sleep/quality emoji when it's
//       the active choice (elevated ▴rise, 💀 ghost, 🪫 drain, ⚡ zap, 🔋 charge,
//       😫 sweat, 😕 sigh, 😊 bliss, 😐 meh — plus the existing zzz/flame/rain/
//       money/tear/halo). (3) the exited-view "Show more" toggle is hidden
//       during the tutorial, when there's nothing more to reveal.
// v124: Focused mode — medication (short) wheel actually spins everywhere.
//       The v123 stepper left scroll-snap:x mandatory armed, and on iOS the
//       snap re-targets the programmatic smooth scroll back to the pill it
//       started on — the wheel looked frozen; snapping is now off for good on
//       short wheels and movement is a rAF scrollLeft animation. Desktop was
//       worse off: overflow:hidden killed native scrolling but the drag
//       handler was touch-only, so a mouse couldn't spin the wheel at all —
//       mouse drag and trackpad/mouse-wheel scrolling now step between pills.
// v125: Release 1.17 (build 17) — version bump across web _APP_VERSION,
//       version.json web channel, iOS (app + widget) and Android, plus the
//       1.17 What's-New headline and changelog entries. Also: medication
//       wheel — third (and root-cause) iOS swipe fix. The stylesheet's
//       touch-action:pan-x let WebKit claim horizontal drags as native pans,
//       but the short wheel has no native scroll (overflow:hidden), so iOS
//       swallowed the gesture before the JS stepper's threshold tripped —
//       invisible in Chromium touch emulation, which is why v123/v124 passed
//       verification but failed on-device. Short wheels now force
//       touch-action:pan-y (wheel + pills), plus a touchend fallback catches
//       sub-26px flicks. The med list also moved from the top of the step to
//       directly above "Manage medications".
// v126: Release 1.18 (build 18) — version bump across web _APP_VERSION,
//       version.json web channel, iOS (app + widget) and Android, plus the
//       1.18 What's-New headline and changelog entries. Focused mode fixes:
//       (1) Medication (and sleep-quality) short-wheel swipe — FOURTH attempt,
//       and this time it stops fighting WebKit. The prior three suppressed
//       native scrolling (overflow:hidden) and drove a JS stepper via
//       touch-action + a rAF animation; all passed in Chromium and failed
//       on-device because WebKit arbitrates the gesture differently (and a
//       backgrounded WebView starves rAF). Short wheels now scroll NATIVELY,
//       identical to the long mood/energy wheels that already work on-device
//       (overflow-x:auto, touch-action:pan-x) — only CSS mandatory snap (which
//       snaps a short-track flick straight back) is swapped for a JS
//       snap-to-nearest on scroll-settle. (2) First journal step no longer
//       opens with a large empty gap between the top bar and the question —
//       on the fresh first step (summary bar hidden) the flexible header
//       spacer is collapsed so the header sits under the nav.
// v127: Release 1.19 (build 19) — medication/sleep-quality wheel swipe, FIFTH
//       attempt, and the simplest yet: stop treating short wheels as special at
//       all. v126 still ran a bespoke path (JS snap-to-nearest); it kept failing
//       on-device. The 5-pill mood/energy wheels have always worked because they
//       use plain native scroll + CSS scroll-snap and nothing else. So the whole
//       short-wheel branch is deleted — medication (2) and sleep-quality (3) now
//       run that identical path. The only reason a 2–3 pill row misbehaved is
//       it's too narrow for iOS to treat as a scroll surface (a flick snaps
//       straight back), so short wheels get a big invisible runway of edge
//       padding (~55% of the wheel width each side); with mandatory snap you
//       can never rest on the runway, so it acts like blank cards to swipe from,
//       blocked at the two ends. Version bump across web _APP_VERSION,
//       version.json web channel, iOS (app+widget) + Android, plus 1.19
//       What's-New + changelog.
// v128: Release 1.20 (build 20) — medication/sleep-quality wheel swipe, SIXTH
//       attempt, per the user's own plan: don't approximate a working wheel,
//       BUILD one. The 5-pill mood/energy wheels always worked on-device; the
//       2–3 pill wheels never did, through five attempts (JS steppers, JS
//       settle, native scroll, runway padding). So medication and sleep-quality
//       are now literally 5-pill wheels, wired to real answers with duplicates:
//       medication = [Not taken, Not taken, (blank), Taken, Taken] (blank centre
//       is a neutral, non-committable start); sleep-quality = [Bad, Bad, OK,
//       Good, Good]. Identical DOM + native-scroll + CSS-snap to the working
//       wheels, so behaviour must match. New .fm-wheel-blank CSS = an invisible
//       non-selectable spacer slot. Version bump across web _APP_VERSION,
//       version.json web channel, iOS (app+widget) + Android, plus 1.20
//       What's-New + changelog.
// v129: Release 1.21 (build 21) — medication step gains a third answer,
//       "🤷 Unsure", as the neutral centre slot of the 5-pill wheel (was an
//       invisible blank). It's a real saved value: displayed honestly as
//       Unsure everywhere it appears (focused review + summary chips, calendar
//       chips, stat detail, calendar row label, PDF/CSV export, the regular
//       form buttons + edit-entry <select>), and counts as NOT taken for the
//       medication adherence % and the med streak (per user's choice — all the
//       adherence checks already gate on === 'taken', so Unsure is excluded
//       automatically). New i18n key journal.med.unsure (English; other locales
//       fall back to it). Warning-sign mood scoring still fires only on a
//       definite 'not-taken', not 'unsure'. Version bump across web
//       _APP_VERSION, version.json web channel, iOS (app+widget) + Android,
//       plus 1.21 What's-New + changelog.
// v130: Anonymous board — comments inside a thread now carry the same
//       moderation controls the feed posts do (report / mute / SOS, admin
//       delete + ban, self-remove your own comment). Previously replies had no
//       controls at all. js/anonymous.js + css/anonymous.css touched.
// v131: Focused mode — medication + sleep-quality wheels hide their duplicate
//       outer answers. The 5-pill scroll surface stays (iOS needs it) but the
//       two outer copies render as invisible runway, so only the three distinct
//       answers show. js/journal.js + css/journal.css touched. (Web-only interim
//       deploy; folded into the v1.22 store release below.)
// v132: Release 1.22 (build 22) — ships the v131 focused-mode wheel change to
//       the App Store / Play Store. Version bump across web _APP_VERSION, iOS
//       (app+widget) + Android, plus 1.22 What's-New + changelog.
// v133: Focused mode — block the medication/sleep-quality wheels from settling
//       on the hidden runway slots (scroll-snap-align:none on .fm-wheel-runway),
//       so a flick can only come to rest on the three real answers. Folded into
//       the still-unreleased build 22 (asset-only fix; no version bump).
//       css/journal.css touched.
// v134: Release 1.23 (build 23) — version-only rebump of the main app to match
//       the Bipolar Anonymous app (which went to 1.23/23 for an Android
//       launcher-icon hotfix). No new main-app content vs the unreleased 1.22;
//       the focused-mode wheel change now ships as 1.23. Bump across web
//       _APP_VERSION, iOS (app+widget) + Android; What's-New + changelog relabel
//       1.22 -> 1.23 (the store builds never shipped as 1.22).
// v135: Focused mode — collapse the dead space above the "Additional tracking"
//       (more_data) step. It has no hero, so the flexible header spacer floated
//       the heading down over a ~165px gap; a new .fm-flat-top class collapses
//       the spacer (like the fresh-first step) so the heading rides up under the
//       summary chips. Folded into the still-unreleased build 23 (asset-only fix;
//       no version bump). js/journal.js + css/journal.css touched.
// v136: Bipolar Anonymous gains iPad support. css/anonymous.css: gate the
//       #iphone-frame device-mockup on <html>.is-native so native iPad renders
//       full-screen (centred 620px column) instead of a fake iPhone on grey —
//       the same mockup trap that got the main app's iPad screenshots rejected.
//       (Originally bumped to 1.24 in lockstep, then re-pinned to 1.23 — see v137.)
// v137: Ship the iPad support as part of 1.23 / build 23 (NOT 1.24) — the user
//       had already uploaded the other 1.23 builds and the anon app had no
//       upload since the rejected build 22, so the icon-fix + iPad ship together
//       as one clean 1.23/23 anon build. Reverted _APP_VERSION 1.24 -> 1.23, iOS
//       (app+widget) + Android build 24 -> 23 in both native repos, and the
//       What's-New + changelog relabel back to 1.23.
// v138: anonymous.html — add a "Post actions" box to the ℹ️ About screen
//       explaining every post action button (💛 Like, 💬 Comment, 🆘 SOS,
//       🚨 Report, 🙈 Mute, 🗑️ Remove), plus a "Moderators only" sub-section
//       for the admin buttons (📌 Pin, 🗑️ Delete, 🚫 Ban).
// v139: Three UI tweaks — (1) focused-mode medication wheel defaults to
//       'Taken' instead of 'Unsure'; (2) the Bipolar Anonymous board header
//       drops its 'Anonymous / BipolarBear' wordmark to just the logo icon
//       when the identity pill (moniker, streaks, birthday) needs the room;
//       (3) the home page shows a 'posted today' tick next to Bipolar
//       Anonymous when you've posted or commented on the board today.
//       index.html + js/index.js + js/anonymous.js + js/journal.js +
//       css/anonymous.css touched. (Web-only interim deploy; no version bump.)
// v140: Release 1.24 (build 24) — ships the interim web-only work since 1.23 as
//       a store build. Bundles: (1) admin authors are masked as 'Bipolar Bear
//       Admin' on the Anonymous board (js/anonymous.js — this was a prior
//       web-only deploy that never got its own SW note); (2) the v138 "Post
//       actions" About-screen guide box; (3) the v139 trio (med wheel defaults
//       to 'Taken', anon header wordmark drop, home 'posted today' tick).
//       Version bump across web _APP_VERSION 1.23 -> 1.24, version.json web
//       channel 1.21 -> 1.24, iOS (app+widget) + Android build 23 -> 24, plus
//       1.24 What's-New + in-app changelog + CHANGELOG.md (backfilled 1.17-1.23).
// v141: Marketing landing pages — repoint the iPhone screenshot carousels at the
//       renamed store-asset files after the reorg (iphone/02-sleep -> 04-sleep,
//       04-patterns -> 06-patterns, 05-survivalkit -> 07-survivalkit, 06-pin ->
//       08-pin, anonymous/iphone/01b-hero-light -> 01-hero); the old paths 404'd
//       so every carousel slide but the hero was blank in production. Also append
//       the 'MBE' honorific to the James Markey founder credit everywhere it
//       appears. Touches welcome.html, welcome-anonymous.html, index.html,
//       js/shared/i18n.js (all precached — bump so returning users get fresh HTML).
// v142: Landing-page carousels — add the second hero panel (02-hero) as slide 2
//       of both showcases on both pages. The 01/02-hero shots are a matched
//       diptych ("Every high. Every low." + "Track every mood in seconds";
//       "You're not alone" + "Real people who get it") but the carousels
//       jumped straight from hero to the feature screens, dropping 02-hero.
//       Touches welcome.html + welcome-anonymous.html (precached — bump).
// v143: Anon hero — the blindfolded Bipolar Anonymous bear logo now peeks out
//       behind the top of the "You'll post as…" monika card (top half only,
//       from the blindfold up; the card body hides the rest). New .monika-stage
//       wrapper + .monika-bear in welcome-anonymous.html / css/welcome.css.
// v144: App Store review fixes for Bipolar Bear 1.2 (build 23).
//       5.1.1(v) — account deletion was only reachable from the home profile
//       modal and the journal Danger Zone; the reviewer found neither. The
//       shared account modal (fab.js, shown on index/journal/survival-kit) now
//       carries a "🗑️ Delete account" button. index/journal delegate to their
//       existing confirmDeleteAll(); survival-kit has no delete flow of its own
//       so it hands off via index.html?deleteAccount=1 (js/index.js).
//       1.2 — signed-in BipolarBear users skipped anonymous.html's verify
//       screen, and with it the 18+/zero-tolerance checkbox, so they reached
//       the board having agreed to nothing. New screen-agree gates that path;
//       agreement persists as bbAnon_agreedTerms + anonProfile.termsAccepted.
//       Also removed the Bipolar Anonymous section from survival-kit.html
//       (board stays on the home screen); its Bipolar UK Groups link moved to
//       the crisis box, and the kit's section count drops 13 → 12.
//       Touches fab.js, js/index.js, index.html, survival-kit.html,
//       js/survival-kit.js, anonymous.html, js/anonymous.js, js/shared/i18n.js.
// v145: Translate v144's five new i18n keys into the other 9 locales. They
//       were added in English only, so t()'s English fallback rendered them
//       in English beside correctly-translated neighbours (e.g. a Dutch user
//       saw "← Startpagina" above an English "Before you join 👋"). Adds
//       anon.agree.{title,sub,continue} and account.{deleteAccount,deleteLocked}
//       to es/fr/de/it/pt/nl/pl/sv/zh. Touches js/shared/i18n.js (precached).
// v146: i18n audit — fab.js pass. The shared FAB dock (index/journal/
//       survival-kit) had six fully-English modals (Crisis, Security, Coffee,
//       Celebrity, Goals, Stats), English tooltips, the add-to-dock picker
//       labels, and hardcoded confirm/alert/toast/error strings. Wire them all
//       to a new fab.* i18n namespace across all 10 locales. Touches fab.js +
//       js/shared/i18n.js (both precached).
// v147: i18n audit — index page pass. The home Profile/Account/Danger modal,
//       offline banner, PIN E2EE panel, footer, account status messages, PIN
//       errors + disable/reset confirms, streak/anon/survival badges, tutorial
//       & welcome modals, reset-dock dialog, celebration toasts and logo hints
//       were all hardcoded English. Wire index.html + js/index.js to new home.*
//       and pin.* keys (reusing account.msg.*, pin.incorrect, common.*, fab.*)
//       across all 10 locales. Deferred: the delete-account confirm/alert flow
//       and the What's-New changelog headlines. Touches index.html, js/index.js,
//       js/shared/i18n.js (all precached).
// v148: i18n audit — journal Settings stack. The entire settings modal
//       (main panel, mobile/reminder panel, Focus Mode, Journal Options,
//       Stats, Danger Zone, Achievements) was hardcoded English. Wire
//       journal.html to a new journal.settings.* namespace (42 keys) across
//       all 10 locales, reusing common.back/save and account.deleteLocked.
//       Touches journal.html + js/shared/i18n.js (both precached).
// v149: i18n audit — journal medication/goals/budget/export/import modals
//       wired to a new journal.mods.* namespace. English source added and
//       HTML wired; the 9 non-English locales land in v150.
//       Touches journal.html + js/shared/i18n.js (both precached).
// v150: i18n audit — journal.mods translated into es/fr/de/it/pt/nl/pl/sv/zh.
//       Completes v149. Touches js/shared/i18n.js (precached).
// v151: i18n audit — journal Personal Details, Field Picker, Calendar-day
//       and Remove-field modals. Personal Details reuses the existing pd.*
//       namespace; the picker/remove-field add 5 keys to journal.mods across
//       all 10 locales. Touches journal.html + js/shared/i18n.js (precached).
// v152: i18n audit — journal calendar/stat/depressed-support/favourites/PIN/
//       anniversary modals wired to journal.mods.* (15 new keys) + reused
//       pin.title/pin.forgot. English source + HTML wired here; the 9
//       non-English locales land in v153. Touches journal.html + i18n.js.
// v153: i18n audit — translate v152's 15 journal.mods keys (calendar,
//       depressed-support, favourites, PIN setup, anniversary) into the 9
//       non-English locales. Completes v152. Touches js/shared/i18n.js.
// v154: i18n audit — journal header tooltips (Survival Kit, Change date,
//       Favourite), the offline banner, and the focused-mode card (Switch to
//       focused, Exit/Skip/Next, Reduced motion + tooltip, Go-to-save, Delete
//       draft) wired to 12 new journal.mods keys across all 10 locales. Also
//       routes journal.js's runtime fmSkipBtn label through journal.mods.fmSkip.
//       Touches journal.html, js/journal.js, js/shared/i18n.js (all precached).
// v155: i18n audit — journal health-sync modals (sleep + steps import,
//       "Mobile app only" web fallbacks) wired to 7 new journal.mods keys
//       across all 10 locales. Completes the journal.html static-text pass;
//       the JS-branded healthSyncLabel/Desc stay in journal.js. Touches
//       journal.html + js/shared/i18n.js (both precached).
// v156: Full Mood Spectrum — new advanced setting to track mood on a 0–10 scale
//       (spinnable wheel in focused mode, slider in the standard form) instead
//       of the five fixed moods. Touches journal.html, js/journal.js,
//       css/journal.css (all precached). [merged from origin/main, PR #84]
// v157: i18n audit — survival-kit. Wire the two <video> fallback strings to
//       the existing sk.memories.videoFallback key, and the med-accordion
//       "NHS info ↗" link to the existing anon.wiki.nhsInfo (same text, already
//       translated in all 10 locales). Touches survival-kit.html +
//       js/survival-kit.js (both precached).
// v158: i18n audit — anonymous board moderation overlays. Wire the Mute, Ban
//       and Comments (thread) sheets to a new anon.mute/ban/thread namespace,
//       and route anonymous.js's name-interpolated mute/ban bodies through it
//       (via _wt now forwarding {name}). Touches anonymous.html,
//       js/anonymous.js, js/shared/i18n.js (all precached).
// v159: i18n audit — translate the anon.mute/ban/thread overlay keys into the
//       9 non-English locales (with the {name} interpolation token preserved).
//       Touches js/shared/i18n.js.
// v160: i18n audit — anonymous About-screen help sections (Community
//       guidelines, Post actions, Moderators-only lists + labels) wired and
//       translated into all 10 locales, preserving <br>/<strong>/&nbsp; markup
//       and the 18+/zero-tolerance meaning. Touches anonymous.html +
//       js/shared/i18n.js.
// v161: i18n audit — anonymous board FAB tooltips (moniker settings, About,
//       Announcements, Write a post, Search wiki, General Chat, Privacy info)
//       wired to a new anon.tips namespace across all 10 locales, plus the
//       "Loading posts…" empty-state to the existing anon.board.loading. This
//       completes anonymous.html's static-text i18n pass (data-i18n up to 139).
//       Touches anonymous.html + js/shared/i18n.js.
// v162: i18n audit — translate v161's anon.toast namespace (24 anonymous-board
//       runtime showHint toasts: moderation warnings, pin/SOS/report, mute/ban
//       with {name}, moniker/account messages) into the 9 non-English locales.
//       Touches js/shared/i18n.js.
// v163: i18n audit — anonymous board email-verification screen messages (12
//       anon.verifyMsg strings: code sent/expired, incorrect/invalid, service
//       unavailable, rate-limit, demo-code) wired to a new anon.verifyMsg
//       namespace and translated into all 10 locales. Touches js/anonymous.js +
//       js/shared/i18n.js.
// v164: i18n audit — anonymous board feed & moderation runtime strings wired
//       to new anon.modbtn (15 tooltips), anon.feed (greetings, Today's-topic,
//       announcements, delete-overlay comment copy, footer, tombstone, reply
//       CTA) and anon.seed (8 sample posts) namespaces, plus anon.ui.loading /
//       loadingComments and anon.sos.bodyNamed — translated into all 10
//       locales. Touches js/anonymous.js + js/shared/i18n.js.
// v165: i18n audit — journal.js runtime dialogs (64 alerts/confirms/prompts/
//       toasts under a new journal.dlg namespace: save/storage errors, PDF/CSV/
//       backup export + import, the delete-account / full-reset confirmation
//       flow with {email}/{count} interpolation, med/goal dialogs, health-
//       permission recovery, notification + new-version prompts) translated
//       into all 10 locales. Touches js/journal.js + js/shared/i18n.js.
// v166: i18n audit — journal.js high-visibility innerHTML labels (16 keys under
//       journal.ui: export/import + account row, personal-details + manage-
//       medications buttons, favourites/meds/goals/missing-entries empty-states,
//       install-app banner, Current Streak stat) translated into all 10 locales.
//       Touches js/journal.js + js/shared/i18n.js.
// v167: i18n audit — 32 more journal.ui labels translated into all 10 locales:
//       mood-form field toggles (goal/outside/budget/customise/add-fields/
//       hide-from-PDF/notes/intention/link chips/undo), personalised-feedback +
//       Bipolar-Bear-thinks blocks with experimental disclaimers, achievement
//       toast, calendar-unlock hint, insights empty-states, and the mood-summary
//       Sleep/Energy/Medication row labels + quality/status enums.
//       Touches js/shared/i18n.js.
// v168: i18n audit — final journal.js chrome (14 journal.ui keys): attribute
//       tooltips (Private/Favourite/Edit entry/First/Last/Dismiss/how-calculated/
//       Edit/Pick emoji), input placeholders (e.g. 180, Field name), and the
//       mini-calendar today/yest./tmrw day labels — translated into all 10
//       locales. This completes journal.js's runtime-string i18n pass (62
//       journal.ui + 64 journal.dlg keys). Touches js/journal.js + i18n.js.
// v169: i18n audit — journal.js entries-list load-error message and the
//       focused-mode "Tap {mood} again to skip" link hint (with interpolation;
//       Cancel reuses common.cancel) wired + translated into all 10 locales.
//       Touches js/journal.js + js/shared/i18n.js.
// v170: i18n audit — anonymous board "Unmute" button in the muted-users list
//       (About overlay) wired to anon.mute.unmute and translated into all 10
//       locales. Touches js/anonymous.js + js/shared/i18n.js.
// v171: anonymous board admin-delete tombstone lifetime reverted 24h → 1h
//       (DELETED_TOMBSTONE_MS). Touches js/anonymous.js.
// v172: i18n — anonymous board 18+/Terms consent gate (screen-verify +
//       screen-agree) split into anon.agree.line1/termsLink/line2 and translated
//       into all 10 locales (age + zero-tolerance meaning preserved). Wiki
//       articles wired to translate via _wikiTxt (English arrays remain the
//       source + fallback) and every wiki section now shows a "based on
//       UK-issued guidance" note (anon.wiki.ukGuidance). Touches anonymous.html,
//       js/anonymous.js, css/anonymous.css, js/shared/i18n.js.
// v173: i18n — full clinical wiki corpus translated into all 9 non-English
//       locales: 96 articles (conditions, therapies, lifestyle, warning signs,
//       side effects, hospital, workplace, pregnancy, media, loved-ones, and the
//       8 medication entries) — titles + bodies — under anon.wiki.a.<slug>, plus
//       the translated "based on UK-issued guidance" notice. Clinical meaning,
//       drug names, and UK service references (NHS/NICE/CMHT/Section 3/Bipolar
//       UK/Samaritans) preserved. Touches js/shared/i18n.js.
// v174: i18n — landing pages (welcome.html + welcome-anonymous.html) had three
//       untagged initial-paint strings (mood-meter name/tag + sample post);
//       tagged them to reuse the existing translated lp.meter.stable.* /
//       lp.meter.posts.p1 keys so the first paint matches the active language
//       (welcome.js already swaps them at runtime). Store badges left as
//       official assets. Touches welcome.html + welcome-anonymous.html.
// v175: i18n — privacy.html brought into the i18n system (shared scripts +
//       data-i18n on all 12 sections + a "convenience translation, English is
//       authoritative" banner) and translated into all 10 locales (HTML tags,
//       URLs, emails, GDPR/Firebase/Apple-Health terms preserved). Clinician PDF
//       export report wired to a new journal.pdf namespace (section headers,
//       patient-detail + metric labels, 12-month chart titles, disclaimers;
//       reuses journal.value.*/label.* for shared words) and translated into all
//       10 locales. Touches privacy.html, js/journal.js, js/shared/i18n.js.
// v177: journal form-mode layout refinements — dropped the big floating emoji +
//       value readout from the energy/sleep steps (step count + sleep time
//       already sit in the section headers), leaving only the compact "✓ Synced
//       from …" badge when health data is present. Energy buttons now show emoji
//       + short symbol (- -, -, Normal, +, ++) so each fits one line, and the
//       three medication responses are a 3-across single-line row. Touches
//       js/journal.js, css/journal.css.
// v178: release 1.25 — Full Mood Spectrum (0–10 mood scale, advanced setting,
//       #84) reaches the store build alongside the journal form-mode layout
//       refinements already cached at v177. Version-bump invalidation only; no
//       new precached assets beyond v177.
// v179: PDF export fixes (js/journal.js). Left-column mood distribution now
//       divides period-filtered mood counts by that period's own entry total
//       (allEntries.length) instead of the all-time count, so a 30-day column
//       no longer reads "3% stable / 0% low". Additional Data rows now show an
//       explicit "N yes · N no · N untracked" breakdown per field instead of a
//       single ambiguous "Nd · N% <verb>" figure.
// v185: weekly summary notification no longer mirrors the week's average mood
//       back at the user — the emoji is now always positive (🎉 for a full 7/7,
//       🙂 otherwise) instead of the old 😄/🙂/😐/😔/😞 scale, so a low-mood week
//       can't arrive on the lock screen as a sad face. Touches js/journal.js.
// v186: release 1.28 (build 28). Version-only invalidation so returning web
//       clients pick up the new _APP_VERSION — the only content change since
//       v185 is the rebuilt social share cards (images/og-card*.png), which
//       are not precached runtime assets.
// v187: focus mode (plain/non-wheel) — the card now hugs its own content
//       instead of stretching to the full viewport, so there's no dead band
//       under Continue and the page no longer scrolls the top bar out of view.
//       Also fixes the one-shot "Tap Settings" hint being stranded: it can fire
//       before focused mode opens, and body.bb-fm-full then hid the very FAB its
//       arrow pointed at. Touches css/journal.css, js/journal.js, journal.html.
// v188: new-device sign-in fixes. Notification/Health settings sync across
//       devices but their OS grants don't, so a fresh phone showed the toggles
//       ON with nothing scheduled — now reconciled (and switched off locally)
//       against the real grants. Home mirrors all 8 survival-kit keys and
//       recounts, instead of freezing at "7 / 12" until survival-kit.html was
//       visited; survival-kit re-renders its section ticks after the cloud copy
//       lands. The Anonymous badge no longer counts the auto-generated daily
//       topic as a new message. Also: the save-confirm modal no longer shows a
//       second, dead copy of the Clear/Save row, and 7–9h of Health sleep now
//       suggests "stable". Touches js/journal.js, js/index.js,
//       js/survival-kit.js, js/shared/i18n.js.
// v189: "Full Mood Spectrum" is now "Full spectrum" and covers sleep + energy
//       too — an hour-by-hour ≤4h…≥12h sleep scale and a 0–10 energy scale
//       (5 = normal), shown as msc sliders in plain focus mode and as the full
//       set of stops in wheel mode. Wheel mode moved into the focus-mode
//       sub-options (it only affects focus mode) and now switches off with it.
//       Touches css/journal.css, journal.html, js/journal.js, js/shared/i18n.js.
// v190: Your Journey — the 60d / 90d (and 60+ custom) timeframes now show a
//       per-month completeness box under the calendar: green when every
//       in-window day of that month has an entry, amber when any are missing,
//       future days excluded. Tapping one opens that month in the calendar.
//       Touches js/journal.js.
// v191: Journey month boxes score up to yesterday, not today. Today is still
//       in progress, so counting it left the current month permanently amber
//       until the moment the day was logged. On the 1st the current month now
//       has no finished days and its box drops out rather than reading 0/0.
//       Touches js/journal.js.
// v192: release 1.29 (build 29). Version-only invalidation so returning web
//       clients pick up the new _APP_VERSION — the runtime assets themselves
//       are unchanged since v191.
// v193: full spectrum reaches the classic form (sleep + energy sliders there
//       too, driven off the existing hidden buttons via a MutationObserver);
//       the fitted focus card centres instead of leaving a slab of background
//       underneath, and focus mode reclaims the hidden dock's 168px of chrome
//       so the page no longer scrolls at all; the Anonymous badge pluralises
//       ("1 new message") across all ten locales; changelog entries for
//       v1.26-v1.28. Touches css/journal.css, journal.html, js/journal.js,
//       js/index.js, js/shared/i18n.js.
// v194: release 1.30 (build 30). Version-only invalidation on top of v193 so
//       returning web clients pick up the new _APP_VERSION.
// v195: the home Bipolar Anonymous tick now activates when the board is all
//       read, not only when the user posted that day — reading everything is
//       the common case ("✓ No new messages"), so the tick sat dashed for
//       anyone who kept up without posting. Cached in bbAnon_allRead so it
//       paints on load. Touches js/index.js, js/anonymous.js, js/journal.js.
// v196: new "Leave a Review" dock button (⭐) — a fifth default FAB that takes
//       the first free slot (slot 1 on a new install, slot 3 on iOS where the
//       coffee FAB is suppressed) and opens a modal linking to the App Store
//       and Google Play. Native builds show only their own store; the web
//       shows both. The dock's slot resolution now relocates a default whose
//       natural slot is taken instead of stacking two FABs on the same
//       coordinates, and the picker offers any default that could not be
//       placed. Touches fab.js, js/index.js, js/journal.js, js/shared/i18n.js.
// v197: release 1.31 (build 31). Packages v195 (Anonymous tick on all-read) and
//       v196 (Leave a Review dock button) for release, plus the matching
//       user-facing changelog entry. Touches journal.html.
// v198: Anonymous board: per-thread unread replies. A post whose commentCount
//       runs ahead of the comment count last seen in its thread pulses its 💬
//       button (and the daily-topic card its 💬 head icon) until the thread is
//       opened. Read state is a per-post count in bbAnon_threadSeen; threads
//       are baselined on first render so a first load doesn't light up
//       wholesale. Content you wrote yourself is never unread to you: posts
//       and replies are marked read as they are sent, and the tab badge skips
//       your own posts the way the home-screen count already did. Touches
//       js/anonymous.js, css/anonymous.css, js/shared/i18n.js, anonymous.html.
// v199: the Anonymous daily topic is no longer signed by the BipolarBear admin
//       account — it posts under a member-style name (Sarah, adam76, Emma_27,
//       ChloeR …) with an avatar gradient and a streak, derived from the
//       topic's UTC day so every device shows the same author. The name is
//       written onto the topic doc and carried over when the topic retires
//       into an ordinary post; topics archived under the old admin identity
//       are re-attributed at render time. Touches js/anonymous.js,
//       css/anonymous.css.
// v200: community user counts. New shared module js/shared/user-count.js reads
//       and maintains two Firestore counters — counters/userCount (Bipolar Bear
//       accounts, shown above the home footer) and counters/anonUserCount
//       (Bipolar Anonymous members, shown in the board header). Each account
//       counts itself exactly once by writing a one-time flag into its own
//       profile document in the same transaction, so pre-existing accounts are
//       picked up on their next visit and nobody is counted twice. Touches
//       index.html, journal.html, anonymous.html, js/index.js, js/anonymous.js,
//       js/journal.js, js/survival-kit.js, js/shared/{user-count,i18n}.js,
//       css/index.css, css/anonymous.css, scripts/build-anonymous.js.
// v201: release 1.32 (build 32). Packages v200 (community user counts) and the
//       version bump itself — _APP_VERSION, the version.json web channel (which
//       had drifted back at 1.25), the What's New headline and the in-app
//       changelog. Touches js/shared/brand-config.js, version.json, js/index.js,
//       journal.html, CHANGELOG.md.
// v202: user counts are no longer silent when they fail. js/shared/user-count.js
//       now logs what the counter read resolved to (value / missing doc) and
//       warns with the Firestore error code when a read, a count or a decrement
//       is rejected — so a rules denial is distinguishable from "nobody counted
//       yet" without guessing.
// v203: the community counters gain a live-now figure — "12 people have used
//       Bipolar Bear (2 live)" on the home screen, "842 members (3 live)" on
//       the board. Each open page heartbeats a presence document (random
//       per-tab id, lastSeen only, no identity) into bbPresence /
//       bbAnonPresence every 45s while visible; live = beat within 2 min, so a
//       closed tab ages out on its own. Both totals reworded to the past tense
//       ("have used") so the pair reads correctly. Touches
//       js/shared/{user-count,i18n}.js, js/index.js, js/anonymous.js.
// v204: the live-now figure now counts journal and survival-kit sessions too,
//       not just people sitting on the home screen. Those pages heartbeat in
//       beat-only mode (no callback -> no count query, no sweep), and the
//       per-tab session id means home -> journal -> kit in one tab stays one
//       live person. survival-kit.html picks up js/shared/user-count.js.
//       Touches js/shared/user-count.js, js/journal.js, js/survival-kit.js,
//       survival-kit.html.
// v205: home counter copy — "12 people use Bipolar Bear (2 live)" rather than
//       "have used". Present tense across all ten locales. js/shared/i18n.js,
//       js/index.js.
// v206: release 1.33 (build 33). Packages v202-v205 — the live-now figure on
//       both counters, presence heartbeats from the journal and survival kit,
//       the diagnostics behind a missing count, and the present-tense copy.
//       Touches js/shared/brand-config.js, version.json, js/index.js,
//       journal.html, CHANGELOG.md.
// v207: i18n — every locale now carries every en key. es/de/it/pt/nl/sv/zh/pl
//       were missing the 646 keys added since the survival kit, landing pages,
//       focused-mode journal, feedback/quick-note modals and wiki UI were wired
//       up (users on those languages saw English), fr was missing 42, and the
//       fr block declared anon.ui twice so its 17 real translations were being
//       discarded at runtime. Touches js/shared/i18n.js only.
// v208: release 1.34 (build 34). Auto-complete for missing entries — the
//       missing-entries modal can now fill every gap day in one pass from
//       health data (aggregated steps + sleep) or the user's recent typical
//       day, with a per-day preview first. Filled days carry autoFilled:true
//       and show an AUTO badge in the list, a note in the PDF and a column in
//       the CSV. Touches journal.html, js/journal.js, js/shared/i18n.js,
//       js/shared/brand-config.js, version.json, DOCS.md, CHANGELOG.md.
// v209: auto-complete preview dates are formatted 'en-US' rather than with the
//       device locale, so they read the same way as the missing-dates list the
//       preview opens on top of. Touches js/journal.js only.
// v210: anonymous board — users who arrived from BipolarBear now see the
//       BipolarBear icon and wordmark in the board's top-left corner with a
//       small "← Go back" line under it, instead of the Anonymous wordmark
//       that was silently tappable. Standalone (email-code) users and the
//       Bipolar Anonymous app are unchanged. Touches anonymous.html,
//       css/anonymous.css, js/anonymous.js, js/shared/i18n.js (new
//       anon.ui.goBack across all ten locales).
// v211: anonymous board — only the admin can publish an announcement. Anyone
//       else composing on the Announcements tab now writes a suggestion to
//       bbAnonAnnSuggestions, which renders as a faded card to its author
//       ("waiting for approval") and to the admin, who publishes or refuses
//       it. Touches anonymous.html, css/anonymous.css, js/anonymous.js,
//       js/shared/brand-config.js, js/shared/i18n.js (anon.sugg.* + four
//       toasts across all ten locales), DOCS.md.
// v212: anonymous board — notification settings. New js/shared/anon-push.js
//       (FCM registration + the bbAnonPush token document), a one-time opt-in
//       sheet after a member's first post, and a Notifications row in the
//       settings sheet with three switches: replies to your posts, new
//       announcements, weekly summary. Feature-detected end to end — with no
//       push plugin and no VAPID key it reports itself unavailable rather
//       than failing. Touches anonymous.html, css/anonymous.css,
//       js/anonymous.js, js/shared/anon-push.js (new),
//       js/shared/firebase-config.js, js/shared/i18n.js,
//       firebase-messaging-sw.js (new, not precached),
//       scripts/build-anonymous.js.
// v213: anonymous board — opening a comment thread lands on the newest
//       comment instead of the top. Later replies only follow the reader down
//       if they were already at the live end (scrolling up to re-read is never
//       yanked back), and always after they send one themselves. Touches
//       js/anonymous.js only.
// v214: search-result thumbnails. The landing pages (and privacy.html) gained
//       JSON-LD carrying the same card in 1:1, 4:3 and 16:9, so Google can fill
//       its square mobile thumbnail instead of letterboxing the 1.91:1
//       og:image between grey bars. New images/search/*.jpg, built by
//       store-assets/build-search-cards.mjs. Touches welcome.html,
//       welcome-anonymous.html, privacy.html (all precached — bump so
//       returning browsers get the markup).
// v215: the Bipolar Anonymous store badges on both landing pages are live
//       links instead of inert placeholders — Google Play, then the App Store
//       listing (id6768005853) once it went live. Every badge on both pages
//       now points at a real listing. js/shared/version-check.js can offer
//       iOS Anonymous users their listing too, instead of falling back to
//       generic "update via your app store" copy. Touches welcome.html,
//       welcome-anonymous.html, js/welcome.js, js/shared/version-check.js
//       (all precached).
// v216: focused mode hides the whole FAB dock again — the "Leave a Review"
//       star (added in v196) was missing from the bb-fm-full hide list, so it
//       stayed on screen mid-entry as a lone floating button after the rest of
//       the dock disappeared. Touches css/journal.css (precached).
// v217: anonymous-board notifications gain a fourth switch, "New posts" —
//       every member post in General Chat, off by default, sent by the new
//       onAnonPostCreated function (never to the author's own devices; one
//       collapse id so a burst replaces rather than stacks). Touches
//       js/anonymous.js, js/shared/anon-push.js, js/shared/i18n.js (all
//       precached).
// v218: the first-post notification sheet asks "Would you like to be notified
//       when someone posts?" and leads with the New posts switch, on. Members
//       subscribed before that switch existed (or who posted before
//       notifications did) get it once on their next post; a past "Not now"
//       is respected. Accepting no longer reports success when the bbAnonPush
//       write fails. Touches anonymous.html, js/anonymous.js,
//       js/shared/anon-push.js, js/shared/i18n.js (all precached).
// v219: web push for the anonymous board is switched on — BB_PUSH_VAPID_KEY
//       is filled in. firebase-messaging-sw.js now registers under its own
//       scope instead of '/', where it would have evicted this worker (and
//       been evicted back on the next journal visit, dropping pushes). It no
//       longer double-shows a push Firebase already displayed, and a click
//       opens the board. bbAnonPush writes sign in anonymously first (the
//       rules require request.auth). Touches js/shared/firebase-config.js,
//       js/shared/anon-push.js, js/anonymous.js (all precached).
// v220: the first-post notification sheet could stay hidden for good.
//       enable() marked the member "asked" before checking the device could
//       deliver push, so any switch tapped in an older build (or on the web
//       before v219) read as a past "Not now". It now marks only once the OS
//       prompt is actually reachable, and the flags are renamed so the stale
//       ones are ignored. Skipped sheets log why under bbDebug. Touches
//       js/shared/anon-push.js, js/anonymous.js (all precached).
// v221: the notification sheet is offered after a reply too, not only after a
//       new post, and now stacks above the thread sheet — both overlays were
//       z-index 100 and the thread comes later in the DOM, so the sheet would
//       have opened hidden behind it. Touches js/anonymous.js,
//       css/anonymous.css (both precached).
// v222: release 1.34 — in-app changelog: What's New headline for 1.34
//       (js/index.js) and a v1.34 block in the journal's changelog modal
//       (journal.html). Bipolar Anonymous native rebumped to 1.34 (build 34)
//       to match. Touches js/index.js, journal.html (both precached).
// v223: feedback form fixes (fab.js). It no longer thanks the user when
//       Firestore isn't available (the feedback silently went nowhere), and a
//       guest is signed in through the SDK's own auth when a page doesn't
//       mirror window.auth — survival-kit didn't, so guest feedback from there
//       was refused by the rules. Touches fab.js (precached).
// v224: release 1.35 (build 35) — iOS widget fix (native only: the App Group
//       ID in Swift didn't match the entitlements, so the widget never saw a
//       log). In-app changelog: What's New headline for 1.35 (js/index.js) and
//       a v1.35 block in the changelog modal (journal.html). Bipolar Anonymous
//       native rebumped to 1.35 (build 35) to match. Touches js/index.js,
//       journal.html, js/shared/brand-config.js (all precached).
// v226: auto-complete for yesterday. Focused mode's first (mood) step now
//       carries an "✨ Auto-fill from health" button when the entry is a new
//       one for yesterday on a native build with health sync on. It reads that
//       day's sleep and steps from the health app, derives mood and energy
//       from them with the same rules as the missing-days auto-complete
//       (_suggestMoodFromHealth / _energyFromSteps) and drops the user on the
//       summary step to review and save. The saved entry carries the same AUTO
//       mark unless the user changed one of those three values first. Touches
//       js/journal.js, js/shared/i18n.js (new journal.autofill.day* across all
//       ten locales) — both precached.
// v227: loading splash while a cached session restores. Firebase Auth resolves
//       asynchronously, so the home screen painted its signed-out chrome (the
//       locked Bipolar Anonymous button, "Sign in to join the community", the
//       Sign In FAB) and then corrected itself a beat later — a returning user
//       was told they were logged out every cold load. New shared module
//       js/shared/auth-splash.js raises a splash (app icon with a line running
//       round its outline) from <head>, before <body> parses, and only when
//       localStorage actually holds a Firebase session — a guest never waits
//       behind it. js/index.js drops it on the frame after auth resolves; the
//       module's own 6s timeout drops it regardless, so a Firebase failure
//       degrades to the old flash rather than a stuck page. Touches
//       index.html, css/theme.css, js/index.js, js/shared/auth-splash.js (new,
//       precached).
// v228: release 1.36 (build 36). Android edge-to-edge: Android 15+ draws the
//       WebView behind the gesture / nav bar, so the dock sat on it.
//       platform.js now tags <html> with is-android / is-ios, and fab.js +
//       css/index.css lift the dock, its buttons, the dock hint and the home
//       version label by the bottom inset on Android only: the larger of
//       env(safe-area-inset-bottom) and Capacitor's --safe-area-inset-bottom
//       (older WebViews report env() as 0; both 0 on Android ≤14; iOS unchanged). The home tutorial-progress line is
//       translated (home.tutorialProgressOne/Many, all ten languages). In-app
//       store review prompt merged (js/journal.js). In-app changelog: What's
//       New headline + a v1.36 block in the changelog modal. Touches
//       js/shared/platform.js, fab.js, css/index.css, js/index.js,
//       js/shared/i18n.js, js/journal.js, journal.html,
//       js/shared/brand-config.js (all precached).
// v229: both apps join the UNI·SIM suite-wide user count. The Firestore
//       counters are unchanged and stay each app's own figure; alongside them
//       the app now beats Supabase's app_presence_beat() (migrations 0175 /
//       0179) so its users are part of "N people use UNI·SIM apps", and the
//       count line is tappable — tap for the suite figure, tap back, the
//       choice remembered under the same localStorage key the rest of the
//       suite uses. New common.suiteCount / common.countTapHint in all ten
//       languages. Privacy policy §2 and §6 say what the beat sends (a random
//       install id, nothing else) and who receives it; §6's "the only
//       third-party service" is now plural. Touches js/shared/user-count.js,
//       js/index.js, js/anonymous.js, js/shared/i18n.js, privacy.html
//       (all precached).
// v230: the suite counter reads once on load whatever the scope, so the suite
//       figure can stand in when this app's own is missing (offline, or
//       Firestore refused) rather than only when a cache happens to hold one;
//       after that it still only reads while the line is showing it. The
//       board's line stays members-only — no stand-in the other way, so
//       somebody who has not joined still sees nothing there unless they have
//       chosen the suite figure themselves. Touches js/shared/user-count.js,
//       js/anonymous.js (both precached).
// v231: Bipolar Anonymous auto-translates what members write. A post, daily
//       topic, announcement or reply written in another language is shown in
//       the reader's, with a "Show original" toggle under it naming the
//       language it was written in — nothing is ever swapped silently.
//       Translation happens on read through a new `translateAnonTexts`
//       callable, which caches every result in Firestore so the board pays
//       for each (text, language) pair once; the client caches locally too, so
//       a re-render never flickers back to the original. A new Language &
//       translation sheet in settings carries the app-language picker (the
//       board had none) and the auto-translate switch. Needs the Cloud
//       Translation API enabled on the Firebase project — until it is, every
//       post simply reads as written. New js/shared/translate.js (precached),
//       touches anonymous.html, css/anonymous.css, js/anonymous.js,
//       js/shared/i18n.js, functions/index.js, scripts/build-anonymous.js.
// v232: the home community count now sits under the "Being built by James
//       Markey MBE" chip rather than above it, so the credit chip closes the
//       page and the count reads as a footnote to it. Spacing moved with it —
//       the chip's own bottom margin carries the gap. Touches index.html,
//       css/index.css (both precached).
// v233: Bipolar Anonymous 12 Steps — a new "🙏 12 Steps" wiki section
//       carrying the twelve steps from the main app's Survival Kit, grouped
//       1–3 / 4–10 / 11–12 with a "what this looks like in practice" note per
//       step, plus a built-in announcement that links straight to it. Built-in
//       announcements always render at the top of the Announcements tab (the
//       existing announcementPosts() demo pair still only shows while the
//       collection is empty). Touches js/anonymous.js, css/anonymous.css,
//       js/shared/i18n.js.
// v234: release 1.37 — _APP_VERSION 1.37, What's New headline and the
//       changelog modal's v1.37 block. Touches js/shared/brand-config.js,
//       js/index.js, journal.html.
// v235: the suite counter's beat now sends p_platform ('ios' / 'android' inside
//       the Capacitor shells, 'web' otherwise), so these apps' users land in
//       the suite's web / native split (migration 0187) instead of neither.
//       Touches js/shared/user-count.js.
// v236: on the web, the suite counter's first beat now waits for a tap, key,
//       touch, wheel or scroll (as @unisim/sdk 0.158 does), so a visit that
//       lands and leaves is not counted. Native shells beat on open as before.
//       Touches js/shared/user-count.js.
// v237: release 1.38 — _APP_VERSION 1.38 and the changelog modal's v1.38
//       block (no What's New popup: nothing new to point at). Carries the
//       suite counter's p_platform (v235) and interaction gate (v236) into the
//       store builds. Touches js/shared/brand-config.js, journal.html.
// v238: Bipolar Anonymous UX pass — the ⋯ post menu (and press-and-hold),
//       saved posts, pull to refresh, loading skeletons, author chips, dark
//       mode with an Appearance setting, a Need help now sheet, swipe a reply
//       to answer it, illustrated empty states, wiki section colours. Touches
//       anonymous.html, css/anonymous.css, js/anonymous.js, js/shared/i18n.js,
//       icons/anon-bear-256.png (new).
// v239: Bipolar Bear UX pass — mood bears + last-7-days strip on home and
//       AA-contrast home buttons; Survival Kit tile grid with a crisis banner
//       and labelled tabs; bigger check-in bears with pop, haptic and mood
//       tint, journal.html?mood= deep link (home + native widgets); life chart
//       (also in the PDF) and opt-in early-warning nudges in
//       js/journal-insights.js (new). Touches index.html, js/index.js,
//       css/index.css, survival-kit.html, js/survival-kit.js,
//       css/survival-kit.css, journal.html, js/journal.js, css/journal.css,
//       js/shared/i18n.js.
const CACHE_NAME = 'bipolarbear-v239';

/**
 * Files that should be available offline. Each entry is precached on `install`.
 * Keep entries to ones we always want offline; per-request caching below
 * picks up everything else as the user navigates.
 */
const STATIC_ASSETS = [
  './welcome.html',
  './welcome-anonymous.html',
  './index.html',
  './journal.html',
  './survival-kit.html',
  './anonymous.html',
  './privacy.html',

  // FAB dock + page-specific JS (extracted from inline scripts in Phase 4).
  './fab.js',
  './js/welcome.js',
  './js/index.js',
  './js/journal.js',
  './js/journal-insights.js',
  './js/survival-kit.js',
  './js/anonymous.js',

  // Shared modules — small, loaded by every page.
  './js/shared/platform.js',
  './js/shared/debug.js',
  './js/shared/brand-config.js',
  './js/shared/firebase-config.js',
  './js/shared/onboarding.js',
  './js/shared/medications.js',
  './js/shared/version-check.js',
  './js/shared/i18n.js',
  './js/shared/translate.js',
  './js/shared/guest-data.js',
  './js/shared/user-count.js',
  './js/shared/auth-splash.js',
  './js/shared/anon-push.js',

  // NOTE: firebase-messaging-sw.js is deliberately NOT precached either — it
  // is a service worker in its own right, registered by js/shared/anon-push.js,
  // and must be fetched by the browser's own worker update check rather than
  // served from this cache.

  // NOTE: /version.json is deliberately NOT precached. It must always be
  // fetched fresh so a new release reaches stale clients on next page load
  // — see worker.js for the no-store header.

  // Shared theme tokens (loaded before page-specific CSS).
  './css/theme.css',

  // App-wide display font (Nunito variable, self-hosted).
  './css/fonts.css',
  './fonts/nunito-latin.woff2',
  './fonts/nunito-latin-ext.woff2',

  // Page-specific stylesheets (extracted from inline <style> in Phase 4).
  './css/welcome.css',
  './css/index.css',
  './css/journal.css',
  './css/survival-kit.css',
  './css/anonymous.css',

  // Manifests. Icons are deliberately not precached — they're served from
  // /icons/favicons/ (referenced in <link rel="icon">) and the browser's
  // own image cache handles them adequately.
  './manifest.json',
  './manifest-anonymous.json',

  // Wiki tab data (fetched by js/anonymous.js renderers).
  './data/wiki-support-groups.json',
  './data/wiki-posts.json',
  // Daily discussion-topic pool (fetched by maybePostDailyTopic).
  './data/daily-topics.json',
];

/**
 * Hostnames whose responses we deliberately bypass. Firebase and Google CDNs
 * have their own caching and offline behaviour — caching them here would
 * stale-pin SDK builds.
 */
const BYPASS_HOSTS = ['googleapis.com', 'firebase', 'gstatic.com'];

self.addEventListener('install', (event) => {
  // Take over as soon as installation finishes — we don't need the old SW
  // to keep serving while the new one warms up.
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      // Best-effort: a missing file shouldn't block install.
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  // Drop every cache that isn't ours, then claim open clients so the new SW
  // controls them without a reload.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Service workers only see GETs in practice, but be defensive.
  if (req.method !== 'GET') return;

  // Don't intercept Firebase / Google traffic — let it go straight to network.
  const url = req.url;
  if (BYPASS_HOSTS.some((h) => url.includes(h))) return;

  event.respondWith(
    fetch(req)
      .then((response) => {
        // Cache successful responses for next time.
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() =>
        // Network failed: serve from cache. For top-level navigations,
        // fall back to index.html so the app shell renders rather than a
        // bare offline error.
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('', { status: 503, statusText: 'Offline' });
        })
      )
  );
});

self.addEventListener('message', (event) => {
  // Lets a page force-activate a waiting service worker:
  //   navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
