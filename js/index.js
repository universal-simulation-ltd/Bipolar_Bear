/**
 * Bipolar Bear home-page logic, extracted from inline <script> blocks in
 * index.html. Loads after the Firebase compat SDK and after the shared
 * helpers in <head> (platform.js, debug.js, firebase-config.js,
 * onboarding.js).
 *
 * The original inline scripts ran at different positions in the document.
 * They're concatenated here in source order — each block is wrapped in its
 * own scope (most are IIFEs already), and each block's top-level code runs
 * at the same point: when this file finishes loading, after the Firebase
 * SDK has loaded and the entire page DOM has been parsed.
 *
 * Block index (lookup by `// ── BLOCK N ──` markers below):
 *   1. Static feature copy (journalFeatures, survivalFeatures arrays).
 *   2. Firebase init + onAuthStateChanged callback (auth state, settings
 *      restore on sign-in, FAB sync, anon profile mirror, streak recompute,
 *      tutorial advance helpers, hint pointer logic, logo easter egg).
 *   3. Today entry tick — does the user already have an entry for today?
 *   4. Survival-kit completion tick.
 *   5. Celebration confetti + toast (streak / stable / both).
 *   6. WhatsApp button bootstrap on native shell.
 *   7. Navigation handlers + onboarding-step advance helpers.
 *   8. PIN lock overlay (guest encryption PIN or native logged-in PIN).
 *
 * @file js/index.js
 */

/**
 * Escape HTML-significant characters in user-controlled strings before
 * injecting them into innerHTML. Use for any value that came from
 * localStorage.bbAnon_* or another user-supplied source.
 *
 * @param {string} s
 * @returns {string}
 */
function _escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Translate an i18n key, falling back to the given English literal if the
 * i18n module hasn't loaded yet. `vars` are interpolated by BB.t.
 * @param {string} key
 * @param {string} fallback English text to show if i18n is unavailable
 * @param {Object} [vars]
 * @returns {string}
 */
function _tr(key, fallback, vars) {
  return (window.BB && window.BB.t) ? window.BB.t(key, vars) : fallback;
}

/**
 * Style the dock's single auth FAB (#bbAuthFab, injected by fab.js) for the
 * current auth state: solid orange "profile" look when signed in, white-outline
 * "sign in" look when signed out. Click behaviour is wired separately via
 * window._fabOpenAuth. No-ops if the FAB hasn't been injected yet.
 * @param {boolean} signedIn
 * @returns {void}
 */
function _setHomeAuthFab(signedIn) {
  const fab = document.getElementById('bbAuthFab');
  if (!fab) return;
  fab.textContent = '👤';
  if (signedIn) {
    fab.title = 'Profile';
    fab.style.background = 'var(--brand-primary)';
    fab.style.color = 'white';
    fab.style.border = 'none';
    fab.style.boxShadow = '0 2px 10px rgba(255,149,0,0.35)';
  } else {
    fab.title = 'Profile / Sign in';
    fab.style.background = 'white';
    fab.style.color = 'var(--brand-primary)';
    fab.style.border = '2px solid var(--brand-primary)';
    fab.style.boxShadow = '0 2px 10px rgba(255,149,0,0.25)';
  }
}

// ── BLOCK 1: feature copy used by other blocks for hover cards ──
const journalFeatures = [
      { icon: '📈', title: 'Visual Insights', desc: 'See your mood patterns over time with charts' },
      { icon: '🔒', title: 'Private & Secure', desc: 'Your data stays safe with you' },
      { icon: '🎯', title: 'Stay On Track', desc: 'Build healthy habits with streaks' }
    ];

    const survivalFeatures = [
      { icon: '⭐', title: 'Celebrities', desc: 'Stories from famous people living with bipolar' },
      { icon: '🔬', title: 'Research', desc: 'Latest studies and evidence-based information' },
      { icon: '🤝', title: 'Support', desc: 'Resources and tools for crisis moments' }
    ];

// ── Skeleton minimum-display-time + reveal helper ──
// Every populate site below sets its text/content immediately (still under
// the blur), then calls `_revealBadge(el, finalDisplay)` instead of clearing
// the skeleton class directly. The helper enforces a minimum visible time
// for the skeleton so users always perceive a brief "loading" state, even
// when data resolved instantly from localStorage. After the minimum elapses
// the skeleton class is removed; CSS handles the unblur via transition.
//
// For the 0-data case ("signed in but no streak yet") the helper also
// deferrs the display:none switch, so the skeleton row doesn't flash and
// vanish before the user can see it.
//
// 5-second safety net at the bottom handles any badge no populate path
// touched (e.g. signed-in user who isn't verified for Anonymous).
var SKELETON_MIN_VISIBLE_MS = 450;
var _skelStart = Date.now();

function _revealBadge(el, finalDisplay) {
  if (!el) return;
  var remaining = Math.max(0, SKELETON_MIN_VISIBLE_MS - (Date.now() - _skelStart));
  var apply = function () {
    el.classList.remove('bb-skeleton');
    if (finalDisplay !== undefined) el.style.display = finalDisplay;
  };
  if (remaining === 0) apply();
  else setTimeout(apply, remaining);
}

setTimeout(function () {
  try {
    var skel = document.querySelectorAll('.btn-subnote.bb-skeleton');
    for (var i = 0; i < skel.length; i++) {
      skel[i].classList.remove('bb-skeleton');
      if (!skel[i].textContent || !skel[i].textContent.trim()) {
        skel[i].style.display = 'none';
      }
    }
  } catch (_) {}
}, 5000);

/**
 * Paint the "N people are using Bipolar Bear" line above the footer.
 *
 * Renders the cached value first — instant, and still right on an offline load
 * or when the Firebase SDKs fail to download — then refreshes it from
 * `counters/userCount` if Firestore is up. Deliberately defined outside the
 * Firebase init block so the cached paint survives an init failure.
 *
 * The line stays hidden until there is a real number to show: a counter we've
 * never managed to read is nothing to advertise, and "0 people" would be worse
 * than no line at all.
 * @returns {void}
 */
let _ucTotal = null;   // people who have ever used the app (accounts)
let _ucLive  = null;   // sessions live right now, or null while unknown
let _ucPresenceStarted = false;
let _ucSuite = null;   // {total, live} across every UNI·SIM app, or null while unknown

/**
 * Paint the footer line from whatever we currently know. The total is the
 * headline; the live count is appended in parentheses only once it resolves
 * to at least one session, so the line never reads "(0 live)" while presence
 * is still settling.
 * @returns {void}
 */
function _paintUserCount() {
  const el = document.getElementById('userCountLine');
  if (!el || !window.BB || !BB.userCount) return;

  // Two figures share this line: Bipolar Bear's own, and the whole UNI·SIM
  // suite's. A tap switches, and the choice is remembered. Whichever was
  // chosen, the other stands in while it is still missing — a returning user
  // should not meet a blank space, and each wording says plainly which figure
  // it is, so standing in for the other can't mislead.
  // (`suite` can be missing for the moment a new page script runs beside an
  // older cached user-count.js — the figure above still shows.)
  const suite = BB.userCount.suite;
  let showSuite = !!suite && suite.scope() === 'suite';
  const suiteTotal = suite ? (_ucSuite ? _ucSuite.total : suite.cached()) : null;
  const suiteLive  = _ucSuite ? _ucSuite.live : null;
  const haveSuite = typeof suiteTotal === 'number' && suiteTotal > 0;
  const haveApp   = typeof _ucTotal === 'number' && _ucTotal > 0;
  if (showSuite && !haveSuite) showSuite = false;
  if (!showSuite && !haveApp && haveSuite) showSuite = true;

  const total = showSuite ? suiteTotal : _ucTotal;
  const live  = showSuite ? suiteLive : _ucLive;
  if (typeof total !== 'number' || total <= 0) return;  // nothing honest to show yet

  const n = BB.userCount.format(total);
  let text = showSuite
    ? _tr(
        'common.suiteCount',
        '🌍 ' + n + ' ' + (total === 1 ? 'person uses' : 'people use') + ' UNI·SIM apps',
        { n: n, count: total }
      )
    : _tr(
        'home.userCount',
        '🐻 ' + n + ' ' + (total === 1 ? 'person uses' : 'people use') + ' Bipolar Bear',
        { n: n, count: total }
      );
  if (typeof live === 'number' && live > 0) {
    text += ' ' + _tr('common.live', '(' + live + ' live)', { n: live });
  }
  el.textContent = text;
  el.style.display = 'block';
  if (suite) _wireUserCountTap(el);
}

/**
 * Make the count line switch between Bipolar Bear's figure and the suite's.
 * The switching itself lives in the shared module; what belongs here is what
 * to do afterwards — repaint from what we already have so the tap is instant,
 * then refresh whichever figure was switched to, so a tap that has been
 * sitting on a week-old cached number doesn't keep showing it.
 * @param {HTMLElement} el
 * @returns {void}
 */
function _wireUserCountTap(el) {
  BB.userCount.suite.wireTap(
    el,
    _tr('common.countTapHint', 'Tap to switch between this app and all UNI·SIM apps'),
    () => {
      _paintUserCount();
      if (BB.userCount.suite.scope() === 'suite') {
        BB.userCount.suite.refresh(c => { _ucSuite = c; _paintUserCount(); });
      } else {
        _refreshUserCount();
      }
    }
  );
}

/**
 * Refresh the community total above the footer.
 *
 * Renders the cached value first — instant, and still right on an offline load
 * or when the Firebase SDKs fail to download — then refreshes it from
 * `counters/userCount` if Firestore is up. Deliberately defined outside the
 * Firebase init block so the cached paint survives an init failure.
 *
 * The line stays hidden until there is a real number to show: a counter we've
 * never managed to read is nothing to advertise, and "0 people" would be worse
 * than no line at all.
 * @returns {void}
 */
function _refreshUserCount() {
  if (!window.BB || !BB.userCount) return;
  const cached = BB.userCount.cached('app');
  if (typeof cached === 'number') { _ucTotal = cached; _paintUserCount(); }
  BB.userCount.load(window.db || null, 'app').then(n => {
    if (typeof n === 'number') { _ucTotal = n; _paintUserCount(); }
  });
}
_refreshUserCount();

// Join the UNI·SIM suite-wide counter (migrations 0175/0177/0179). Deliberately
// out here rather than in the Firebase block below, and not waiting on auth:
// the beat has nothing to do with Firestore, and a page whose Firebase init
// fails should still count its reader and still be able to offer the figure.
if (window.BB && BB.userCount && BB.userCount.suite) {
  const _ucSuiteCached = BB.userCount.suite.cached();
  if (typeof _ucSuiteCached === 'number') {
    _ucSuite = { total: _ucSuiteCached, live: null };
    _paintUserCount();
  }
  BB.userCount.suite.start(
    'app',
    () => BB.userCount.suite.scope() === 'suite',
    counts => { _ucSuite = counts; _paintUserCount(); }
  );
}

// ── BLOCK 2: Firebase init + auth listener + onboarding helpers ──
    // ── Firebase init ──
    // Config lives in js/shared/firebase-config.js so every page reads the
    // same source of truth.
    const firebaseConfig = window.BB_FIREBASE_CONFIG;
    let auth, db, currentUser = null;
    try {
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      // Expose to window so other <script> blocks (and shared modules like
      // fab.js) can access them. `let` declarations don't attach to window,
      // and a number of call sites — including fab.js's _syncFabsToFirestore
      // and the journal toggle handlers — gate on window.db / window.currentUser.
      window.auth = auth;
      window.db = db;

      /**
       * Paint the Bipolar Anonymous "new messages" badge from posts newer than
       * this device's last board visit.
       *
       * Excluded from the count:
       *   - the user's own posts (matched on monika)
       *   - the daily discussion topic (`isTopic`) and system posts. The topic is
       *     an auto-generated conversation-starter written by the app itself, and
       *     it's created the moment the board is opened for the day — so simply
       *     visiting the board, replying to the topic and coming home reported
       *     "1 new message" that was really the app's own prompt, with nothing in
       *     the thread but the user's own reply.
       *   - deleted posts
       *
       * If the monika isn't known yet (fresh device, before the Firestore profile
       * lands) the badge is left as-is rather than counted, because without it
       * every one of the user's own posts would read as somebody else's.
       */
      function _refreshAnonMessagesBadge() {
        const _badge = document.getElementById('anonMessagesBadge');
        if (!_badge) return;
        const _lastVisit = parseInt(BB.storage.get('AnonLastVisit') || '0', 10);
        if (!_lastVisit) {
          // Never opened the board — nothing has been read, so the tick stays
          // inactive (unless they've posted today; _refreshAnonTick decides).
          BB.storage.set('Anon_allRead', '0');
          if (window._refreshAnonTick) window._refreshAnonTick();
          _badge.textContent = _tr('home.anonTapJoin', '💬 Tap to join the community');
          _revealBadge(_badge, 'block');
          return;
        }
        if (!navigator.onLine) {
          // Offline — skip the live count, hide the row after the skeleton
          // min-time; we'll re-check next time we're online.
          _revealBadge(_badge, 'none');
          return;
        }
        const _myMonika = BB.storage.get('Anon_monika') || '';
        if (!_myMonika) return; // profile not hydrated yet — a later pass repaints
        db.collection(BB_BRAND.collections.posts)
          .where('timestamp', '>', firebase.firestore.Timestamp.fromMillis(_lastVisit))
          .limit(5)
          .get()
          .then(snap => {
            const _newCount = snap.docs.filter(d => {
              const p = d.data();
              return !p.deleted && !p.isTopic && !p.isSystem && p.name !== _myMonika;
            }).length;
            // `count` drives Intl.PluralRules inside BB.t; `n` fills the
            // placeholder. Without count it always rendered the plural form,
            // so a single post read "1 new messages".
            _badge.textContent = _newCount > 0
              ? _tr('home.anonNewMessages', '💬 ' + _newCount + ' new message' + (_newCount === 1 ? '' : 's'), { n: _newCount, count: _newCount })
              : _tr('home.anonNoMessages', '✓ No new messages');
            // Caught up on the board counts as "done" for the day, same as the
            // journal tick — cache the verdict so the tick paints from
            // localStorage on the next load instead of waiting for this query.
            BB.storage.set('Anon_allRead', _newCount > 0 ? '0' : '1');
            if (window._refreshAnonTick) window._refreshAnonTick();
            _revealBadge(_badge, 'block');
          })
          .catch(() => {});
      }

      auth.onAuthStateChanged(user => {
        currentUser = user && !user.isAnonymous ? user : null;
        window.currentUser = currentUser;

        // Auth has resolved, so the loading splash has done its job. Drop it on
        // the next frame rather than here: rAF runs after this callback returns,
        // which is after every synchronous chrome update below has been applied,
        // so the page is revealed already correct instead of correcting itself
        // in view — the whole point of the splash. Signing out resolves too, and
        // the signed-out home is then the honest thing to show.
        if (window.BB && BB.authSplash) {
          requestAnimationFrame(() => BB.authSplash.hide());
        }

        // Community size (footer). Runs on every auth state so the Firestore
        // read happens once auth has settled, not before it.
        _refreshUserCount();
        // "(N live)" — report this session as live and count the others. Once
        // per page: the auth listener can fire more than once, and a second
        // heartbeat loop would double-count this very session.
        if (!_ucPresenceStarted && window.BB && BB.userCount) {
          _ucPresenceStarted = true;
          BB.userCount.startPresence(db, 'app', live => { _ucLive = live; _paintUserCount(); });
        }
        // Count this account towards the total, exactly once ever. Existing
        // accounts are picked up here too — the flag lives in their own
        // userSettings document, so nobody is counted twice.
        if (currentUser && window.BB && BB.userCount) {
          BB.userCount.countOnce(
            db, 'app', db.collection('userSettings').doc(currentUser.uid), 'userCounted'
          ).then(counted => { if (counted) _refreshUserCount(); });
        }

        // survival-kit.html has no delete flow of its own, so fab.js sends the
        // user here with ?deleteAccount=1 (App Store 5.1.1(v)). Fire it from
        // the auth callback so confirmDeleteAll() sees the resolved user
        // rather than a null currentUser on first paint.
        _maybeAutoDeleteAccount();

        // Clear stale guest PIN if it was set by a different account.
        // Guest PINs (bbGuestPinSalt) are only valid for the account that created them.
        if (user && !user.isAnonymous) {
          const _hasGuestPin = !!BB.storage.get('GuestPinSalt');
          const _pinUID      = BB.storage.get('PinLinkedUID');
          if (_hasGuestPin && _pinUID !== user.uid) {
            BB.storage.remove('GuestPinSalt');
            BB.storage.remove('PinCode');
            BB.storage.remove('PinEnabled');
            BB.storage.remove('PinLinkedUID');
            sessionStorage.setItem('bbPinUnlocked', '1');
            const _pinOv = document.getElementById('guestPinOverlay');
            if (_pinOv && _pinOv.style.display !== 'none') _pinOv.style.display = 'none';
          }
        }

        // Bipolar Anonymous button — unlocked only when signed in
        const anonBtn  = document.getElementById('anonymousBtn');
        const anonNote = document.getElementById('anonymousSignInNote');
        if (anonBtn) {
          if (currentUser) {
            anonBtn.classList.remove('locked');
            if (anonNote) anonNote.style.display = 'none';
            // New messages badge — only if they've verified for Anonymous
            if (BB.storage.get('Anon_verified') === 'true') _refreshAnonMessagesBadge();
          } else {
            anonBtn.classList.add('locked');
            if (anonNote) anonNote.style.display = 'block';
          }
        }

        const signinBtn = document.getElementById('signinBtn');
        const userInfo = document.getElementById('userInfo');
        const userEmail = document.getElementById('userEmail');
        if (user && !user.isAnonymous) {
          if (signinBtn) signinBtn.style.display = 'none';
          if (userInfo) { userInfo.style.display = 'flex'; }
          if (userEmail) userEmail.textContent = user.email;
          window._fabOpenAuth = window.showProfileModal;
          _setHomeAuthFab(true);
          // Email verification is now handled on the Bipolar Anonymous board
          // (anonymous.html) — no need to nag here. If a stale banner from an
          // older client version is still in the DOM, clear it.
          const _vBanner = document.getElementById('bbEmailVerifyBanner');
          if (_vBanner) _vBanner.remove();
          // Load user settings from Firestore (logo variant + survival kit data for ticks)
          db.collection('userSettings').doc(user.uid).get().then(doc => {
            // Back guest-entered data (meds, goals, coping strategies, mood
            // definitions, …) up to the account. Guest data lives only in
            // localStorage; signup/login only ever pulled settings down, so
            // anything authored before creating an account was never backed up
            // and was lost when localStorage cleared. Runs before the
            // !doc.exists return so brand-new accounts are covered. Idempotent
            // and non-destructive — only uploads what the account is missing.
            if (window.BB && BB.claimGuestData) BB.claimGuestData(db, user, doc);
            if (!doc.exists) return;
            const d = doc.data();
            if (d.logoVariant !== undefined) {
              localStorage.setItem('logoVariant', d.logoVariant);
              applyLogoVariant(d.logoVariant);
            }
            // Sync onboarding step from Firestore FIRST (needed to set completion flags before tick update)
            const _serverStep = d.onboardingStep || 0;
            const _localStep = _getOnboardingStep();
            let _finalStep = Math.max(_serverStep, _localStep);
            // Step 9 (WA hint) removed from tutorial — skip on all platforms
            if (_finalStep === 9) _finalStep = 10;
            if (_finalStep !== _localStep) {
              BB.storage.set('OnboardingStep', String(_finalStep));
              db.collection('userSettings').doc(user.uid).set({ onboardingStep: _finalStep }, { merge: true }).catch(() => {});
            } else if (_localStep > _serverStep) {
              db.collection('userSettings').doc(user.uid).set({ onboardingStep: _localStep }, { merge: true }).catch(() => {});
            }
            // Restore hint flags from Firestore
            if (d.personalHintDone) BB.storage.set('PersonalHintDone', '1');
            if (d.tutorialToastShown) BB.storage.set('TutorialToastShown', '1');
            // If tutorial is complete, silently ensure all completion flags are set on login.
            // Never show the tutorial-complete popup here — it only fires via _advanceOnboardingStep.
            if (_finalStep >= 12) {
              BB.storage.set('TutorialToastShown', '1');
              BB.storage.set('FabsUnlocked', '1');
              // Prevent survival-kit celebration toast from re-firing on a new device/browser
              BB.storage.set('SurvivalCelebDone', '1');
              ['WelcomeShown','SurvivalKitVisited','MedHintDone','MoodDefHintDone',
               '_fmChooseMoodHintDone','_fmMoodInfoCloseHintDone','SettingsHintDone',
               'CustomiseFormHintDone','CustomiseAdditionalHintDone','CloseSettingsHintDone',
               '_fmMoodTipShown'].forEach(f => { if (!BB.storage.get(f)) BB.storage.set(f, '1'); });
              if (!d.tutorialToastShown) {
                db.collection('userSettings').doc(user.uid).set({ tutorialToastShown: true }, { merge: true }).catch(() => {});
              }
            }
            // Populate survival kit keys so the tick check works without visiting the page first.
            // Must happen AFTER completion flags are set so MutationObserver doesn't fire celebration toast.
            if (d.moodDefinitions !== undefined) localStorage.setItem('moodDefinitions', JSON.stringify(d.moodDefinitions));
            if (d.copingStrategies !== undefined) localStorage.setItem('copingStrategies', JSON.stringify(d.copingStrategies));
            if (d.currentMedList  !== undefined) localStorage.setItem('currentMedList',  JSON.stringify(d.currentMedList));
            if (d.dailyGoals      !== undefined) localStorage.setItem('dailyGoals',      JSON.stringify(d.dailyGoals));
            // The remaining five survival-kit keys. Without them the home
            // progress counter could never see those sections as done on a
            // freshly signed-in device — it counted 7 / 12 (the 4 info-only
            // sections + the 3 keys mirrored above) until the user opened
            // survival-kit.html, which hydrates the full set, and came back.
            if (d.survivalGratitude !== undefined) localStorage.setItem('survivalGratitude', JSON.stringify(d.survivalGratitude));
            if (d.moodMemories     !== undefined) localStorage.setItem('moodMemories',     JSON.stringify(d.moodMemories));
            if (d.myCommitments    !== undefined) localStorage.setItem('myCommitments',    JSON.stringify(d.myCommitments));
            if (d.customReminders  !== undefined) localStorage.setItem('customReminders',  JSON.stringify(d.customReminders));
            if (d.rememberThis     !== undefined) localStorage.setItem('rememberThis',     d.rememberThis);
            if (d.stableStreak    !== undefined) {
              BB.storage.set('StableStreak', String(d.stableStreak || 0));
            }
            if (typeof d.currentStreak === 'number') {
              BB.storage.set('CurrentStreak', String(d.currentStreak));
            }
            // Restore unlocked achievements so journal.html doesn't re-toast already-earned ones
            if (Array.isArray(d.unlockedAchievements)) {
              localStorage.setItem('unlockedAchievements', JSON.stringify(d.unlockedAchievements));
            }
            // Restore FAB customisation (slot assignments + hidden flags)
            if (d.fabState && typeof d.fabState === 'object') {
              const _fs = d.fabState;
              for (let s = 1; s <= 4; s++) {
                if (_fs['slot' + s]) BB.storage.set('FabSlot_' + s, _fs['slot' + s]);
              }
              ['bbWaFabHidden','bbQuickNoteFabHidden','bbCoffeeFabHidden','bbFeedbackFabHidden','bbReviewFabHidden','bbFooterHidden'].forEach(k => {
                if (_fs[k] === '1') localStorage.setItem(k, '1');
              });
              if (typeof window._applyFabDock === 'function') window._applyFabDock();
            }
            // Restore Profile → Customise preferences (home-button + stats visibility).
            // Survival / Anonymous are opt-in: hidden until the user enables them, so the
            // stored flag means "enabled" ('1'), not "hidden". Stats default to visible.
            if (typeof d.homeSurvivalEnabled === 'boolean') BB.storage.set('SurvivalBtnEnabled', d.homeSurvivalEnabled ? '1' : '0');
            if (typeof d.homeAnonEnabled     === 'boolean') BB.storage.set('AnonBtnEnabled',     d.homeAnonEnabled     ? '1' : '0');
            if (typeof d.homeStatsEnabled    === 'boolean') BB.storage.set('HomeStatsEnabled',   d.homeStatsEnabled    ? '1' : '0');
            if (typeof d.homeQuickCheckinEnabled === 'boolean') BB.storage.set('HomeQuickCheckin', d.homeQuickCheckinEnabled ? '1' : '0');
            if (typeof window._applyOnboardingGating === 'function') window._applyOnboardingGating();
            const _ap = d.anonProfile || {};
            if (typeof _ap.visitStreak === 'number') {
              BB.storage.set('Anon_streak', String(_ap.visitStreak));
            }
            // Also restore the last-visit date so BB.anonLiveStreak() can tell
            // whether that streak is still live on a fresh device (where the
            // board hasn't run to set AnonVisitDate locally yet).
            if (_ap.visitDate) BB.storage.set('AnonVisitDate', _ap.visitDate);
            if (_ap.monika) BB.storage.set('Anon_monika', _ap.monika);
            if (_ap.verified) BB.storage.set('Anon_verified', 'true');
            _updateStreakBadge(); // refresh badge from the values we just wrote
            // Then recompute from entries to fix the stale-currentStreak case
            // (Firestore field only updates when journal.html opens). Best-effort.
            _recomputeStreakFromEntries(user);
            // Refresh anonymous "new messages" badge now that monika/verified are in place
            if (currentUser && BB.storage.get('Anon_verified') === 'true') _refreshAnonMessagesBadge();
            // Refresh the "posted today" tick next to Bipolar Anonymous.
            // Query only the user's own posts by monika (single-field, so no
            // composite index needed) and check whether any landed today. The
            // synchronous BLOCK 3b below already painted the cached value for
            // an instant tick; this reconciles it (cross-device / cache lies).
            if (currentUser && navigator.onLine) {
              const _monika = BB.storage.get('Anon_monika') || '';
              if (_monika) {
                const _n = new Date();
                const _todayKey = `${_n.getFullYear()}-${String(_n.getMonth()+1).padStart(2,'0')}-${String(_n.getDate()).padStart(2,'0')}`;
                const _isToday = ts => {
                  if (!ts) return false;
                  try { const dt = ts.toDate ? ts.toDate() : new Date(ts); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}` === _todayKey; } catch(_) { return false; }
                };
                db.collection(BB_BRAND.collections.posts)
                  .where('name', '==', _monika)
                  .get().then(snap => {
                    const done = snap.docs.some(dd => { const x = dd.data(); return !x.deleted && _isToday(x.timestamp); });
                    if (done) BB.storage.set('Anon_lastPostDate', _todayKey);
                    else if (BB.storage.get('Anon_lastPostDate') === _todayKey) BB.storage.remove('Anon_lastPostDate');
                    // Repaint through the shared helper rather than setting
                    // data-done directly — "posted today" is only one half of
                    // the tick, and writing false here would wipe the tick off
                    // a user who is simply all caught up on the board.
                    if (window._refreshAnonTick) window._refreshAnonTick();
                  }).catch(() => {});
              }
            }
            // Re-run the survival tick check now that localStorage is populated
            const sTick = document.getElementById('survivalTick');
            if (sTick) {
              try {
                const defs  = JSON.parse(localStorage.getItem('moodDefinitions') || '{}');
                const strats = JSON.parse(localStorage.getItem('copingStrategies') || '{}');
                const meds  = JSON.parse(localStorage.getItem('currentMedList') || '[]');
                const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
                const done  = Object.values(defs).some(v => v && String(v).trim()) &&
                              Object.values(strats).some(arr => Array.isArray(arr) && arr.length > 0) &&
                              Array.isArray(meds) && meds.length > 0 &&
                              Array.isArray(goals) && goals.length > 0;
                sTick.setAttribute('data-done', done ? 'true' : 'false');
              } catch(e) {}
            }
            // …and the "N / 12 sections complete" counter, which ran during the
            // synchronous page render, before any of the keys above existed.
            if (typeof window._updateSurvivalProgress === 'function') window._updateSurvivalProgress();
            _applyOnboardingGating();
          }).catch(() => {});
          // Check Firestore for the current entry if the local cache is missing or stale.
          // Skip entirely when offline — the cached tick state is good enough.
          (function() {
            if (!navigator.onLine) return;
            const useToday = localStorage.getItem('journalDefaultToday') === 'true';
            const target = new Date(); target.setHours(0, 0, 0, 0);
            if (!useToday) target.setDate(target.getDate() - 1);
            const toKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            const targetKey = toKey(target);
            // Always reconcile against Firestore when online — a cached
            // `done:true` can be stale (e.g. an entry deleted on another
            // device), and trusting it here left the home tick wrongly ticked
            // until the user opened the journal and back. The synchronous
            // BLOCK 3 above already painted the cached value for an instant
            // tick; this just corrects it if the cache lies.
            // Single-field query only (compound queries need a Firestore index which may not exist)
            db.collection('entries')
              .where('userId', '==', user.uid)
              .get()
              .then(snap => {
                const done = snap.docs.some(doc => {
                  // Encrypted entries keep only userId + timestamp in plaintext;
                  // `date` sits inside the ciphertext. Reading `date` alone made
                  // every encrypted entry look missing, so this "correction"
                  // un-ticked a day the user had logged. timestamp is the
                  // entry's local noon (saveEntry), so its local day is the
                  // entry's day. `date` stays as the fallback for old plaintext
                  // entries.
                  const ts = doc.data().timestamp;
                  if (typeof ts === 'number') return toKey(new Date(ts)) === targetKey;
                  const d = doc.data().date;
                  if (!d) return false;
                  if (typeof d === 'string') return d.slice(0, 10) === targetKey;
                  try { const dt = d.toDate ? d.toDate() : new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}` === targetKey; } catch(_) { return false; }
                });
                const tick = document.getElementById('journalEntryTick');
                if (tick) tick.setAttribute('data-done', done ? 'true' : 'false');
                try { BB.storage.set('_entryStatus', JSON.stringify({ key: targetKey, done })); } catch(e) {}
              }).catch(() => {});
          })();
        } else {
          if (signinBtn) signinBtn.style.display = '';
          if (userInfo) userInfo.style.display = 'none';
          const _pdHint = document.getElementById('personalDetailsHint');
          if (_pdHint) _pdHint.style.display = 'none';
          // Guests open the Profile modal (not the sign-in form): customise is
          // available without an account, and the Customise panel carries its
          // own "Sign up / in" button so backing up stays one tap away.
          window._fabOpenAuth = window.showProfileModal;
          _setHomeAuthFab(false);
          // Hide stats from a previous account when Firebase fires with no
          // user (token expiry, sign-out via another tab, or just a signed-
          // out visit). logout() already clears these on the in-app Sign Out
          // path, but if the session lapsed without that hook running, the
          // streak/anon badges otherwise display stale values from the
          // last-signed-in account. Guests with their own guest-PIN
          // localStorage data keep their badges — those are real local
          // stats, not residue from a sync.
          if (!BB.storage.get('GuestPinSalt')) {
            _revealBadge(document.getElementById('journalStreakBadge'), 'none');
            _revealBadge(document.getElementById('anonStreakBadge'),    'none');
            _revealBadge(document.getElementById('anonMessagesBadge'),  'none');
          }
          if (typeof window._applyFabDock === 'function') window._applyFabDock();
        }
      });
    } catch(e) { console.warn('Firebase init failed on index.html', e); }

    // ── Onboarding step helpers ──
    // _getOnboardingStep() is provided by js/shared/onboarding.js — the
    // implementation here delegates to it. The local function name is kept
    // because inline event handlers (e.g. onclick="…_advanceOnboardingStep(12)")
    // resolve against the script's lexical scope.
    /**
     * @returns {number} Current onboarding step (0–12).
     */
    function _getOnboardingStep() {
      return window.BB.onboarding.getStep();
    }
    /**
     * Advance the user's onboarding step. No-op if `to` is not strictly
     * greater than the current step. Persists to localStorage and to
     * Firestore (`userSettings/{uid}.onboardingStep`) when signed in.
     * Triggers the tutorial-complete modal the first time step ≥ 12.
     *
     * @param {number} to Target step.
     */
    function _advanceOnboardingStep(to) {
      const cur = _getOnboardingStep();
      if (to <= cur) return;
      if (to === 9) to = 10; // step 9 (WA hint) removed from tutorial on all platforms
      BB.storage.set('OnboardingStep', String(to));
      if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined' && db) {
        db.collection('userSettings').doc(currentUser.uid).set({ onboardingStep: to }, { merge: true }).catch(() => {});
      }
      // Unlock the FAB dock (incl. the settings/auth FAB) after the first entry
      // (step 1), so users can sign in as soon as they've logged something.
      if (to >= 1) BB.storage.set('FabsUnlocked', '1');
      _applyOnboardingGating();
      // Show tutorial finale (account hint, then complete popup) the first time step reaches 12
      if (to >= 12 && BB.storage.get('TutorialToastShown') !== '1') {
        BB.storage.set('TutorialToastShown', '1');
        setTimeout(_showTutorialFinale, 400);
      }
    }
    window._getOnboardingStep = _getOnboardingStep;
    window._advanceOnboardingStep = _advanceOnboardingStep;

    // _resolvePointerPosition is provided by js/shared/onboarding.js.
    // Local alias kept so existing call sites in this script work unchanged.
    const _resolvePointerPosition = window.BB.onboarding.resolvePointerPosition;
    function _showIndexHintPointer(targetEl) {
      document.getElementById('_bbIdxHintPointer')?.remove();
      const rect = targetEl.getBoundingClientRect();
      const tx = rect.left + rect.width / 2;
      const ty = rect.top + rect.height / 2;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const angle = Math.atan2(ty - cy, tx - cx) * 180 / Math.PI + 90;
      const ptr = document.createElement('div');
      ptr.id = '_bbIdxHintPointer';
      ptr.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:510;pointer-events:none;animation:hintFade 1.8s ease-in-out infinite;';
      ptr.innerHTML = `<div style="position:relative;width:72px;height:72px;display:flex;align-items:center;justify-content:center;"><svg width="72" height="72" viewBox="0 0 72 72" fill="none" style="position:absolute;inset:0;"><circle cx="36" cy="36" r="34" stroke="rgba(255,255,255,0.55)" stroke-width="2"/></svg><svg width="52" height="52" viewBox="0 0 52 52" fill="none" style="transform:rotate(${angle}deg);filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4));"><line x1="26" y1="44" x2="26" y2="10" stroke="white" stroke-width="4" stroke-linecap="round"/><polyline points="14,22 26,10 38,22" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></div>`;
      document.body.appendChild(ptr);
      _resolvePointerPosition(ptr, Array.from(document.querySelectorAll('.bb-hint-elevated')));
    }
    function _hideIndexHintPointer() {
      document.getElementById('_bbIdxHintPointer')?.remove();
    }

    function _showTutorialCompleteModal() {
      if (document.getElementById('tutorialCompleteModal')) return;
      const overlay = document.createElement('div');
      overlay.id = 'tutorialCompleteModal';
      overlay.innerHTML = `<div style="background:linear-gradient(135deg,var(--brand-primary-mid),var(--brand-primary-light));border-radius:20px;padding:28px 32px;text-align:center;max-width:300px;width:calc(100vw - 64px);box-shadow:0 12px 48px rgba(255,107,0,0.55);">
        <div style="font-size:2.6em;margin-bottom:10px;">🎓</div>
        <div style="font-weight:800;font-size:1.1em;color:white;margin-bottom:6px;">${_tr('home.tutorialCompleteTitle', 'Tutorial Complete!')}</div>
        <div style="font-size:0.88em;color:rgba(255,255,255,0.9);line-height:1.5;margin-bottom:16px;">${_tr('home.tutorialCompleteBody', 'Done for now! There will be a few more hints as you progress.')}</div>
        <div style="font-size:0.78em;color:rgba(255,255,255,0.65);">${_tr('home.tapDismiss', 'Tap to dismiss')}</div>
      </div>`;
      Object.assign(overlay.style, {
        position:'fixed', inset:'0', display:'flex', alignItems:'center', justifyContent:'center',
        background:'rgba(0,0,0,0.55)', zIndex:'9999', cursor:'pointer',
      });
      overlay.addEventListener('click', () => {
        overlay.remove();
      });
      document.body.appendChild(overlay);
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.3s ease';
      requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    }

    /**
     * Tutorial finale. Before the "Tutorial Complete!" popup, guests get a
     * blocking hint pointing at the profile FAB — "Create an account to
     * customise your experience". The dimmer makes everything except the
     * elevated profile button inert; tapping the dimmer just nudges the
     * label. One-shot: bbAccountHintShown is set the moment the hint
     * appears, so quitting mid-hint can never re-block a later visit (the
     * lesson from the removed step-4/step-5 blocking gates). Skipped for
     * signed-in users and whenever the profile FAB isn't on screen; the
     * complete popup follows once the hint resolves.
     */
    function _showTutorialFinale(_attempt) {
      const fab = document.getElementById('bbAuthFab');
      const hint = document.getElementById('signinHint');
      // The dock is injected by fab.js, which loads after this script and
      // after the Firebase SDKs — on a cold load it may not exist yet when
      // the 400ms finale timer fires. Retry for up to ~4s before giving up.
      const notReady = !fab || !hint || getComputedStyle(fab).display === 'none';
      if (notReady && (_attempt || 0) < 16) {
        setTimeout(() => _showTutorialFinale((_attempt || 0) + 1), 250);
        return;
      }
      const skip = notReady || window.currentUser ||
        BB.storage.get('AccountHintShown') === '1';
      if (skip) { _showTutorialCompleteModal(); return; }
      BB.storage.set('AccountHintShown', '1');
      window._bbAccountHintActive = true;

      // The finale points the user at the profile button (Customise panel).
      // Pre-enable the Survival Kit + Bipolar Anonymous home buttons so they
      // show up already selected in that panel and are visible on the home
      // screen the moment they close it — they discover the features instead
      // of having to find the toggles. Only flip each the first time (when it
      // has never been set), so a user who deliberately turned one off later
      // isn't overridden on a repeat finale.
      let _btnsPreEnabled = false;
      if (BB.storage.get('SurvivalBtnEnabled') == null) {
        BB.storage.set('SurvivalBtnEnabled', '1');
        _btnsPreEnabled = true;
      }
      if (BB.storage.get('AnonBtnEnabled') == null) {
        BB.storage.set('AnonBtnEnabled', '1');
        _btnsPreEnabled = true;
      }
      if (_btnsPreEnabled && typeof window._applyOnboardingGating === 'function') window._applyOnboardingGating();

      // If the What's New popup beat the hint onto the screen, put it away
      // and un-mark it so it re-shows on the next visit instead.
      const _wn = document.getElementById('whatsNewPopup');
      if (_wn && _wn.style.display === 'block') {
        _wn.style.display = 'none';
        BB.storage.remove('LastSeenVersion');
      }

      const overlay = document.getElementById('bbHintOverlay');
      const hintInner = document.getElementById('signinHintInner');
      const hintLabel = document.getElementById('signinHintLabel');
      const hintStored = hint.querySelector('[data-i18n="home.signinHintStored"]');
      const prevFabZ = fab.style.zIndex;
      const prevInnerAnim = hintInner ? hintInner.style.animation : '';

      if (hintStored) hintStored.style.display = 'none';
      if (hintLabel) {
        hintLabel.setAttribute('data-i18n', 'home.accountHint');
        hintLabel.textContent = (window.BB && window.BB.t)
          ? window.BB.t('home.accountHint')
          : '🐻 Sign in to back up your data (optional)';
        hintLabel.style.whiteSpace = 'normal';
        hintLabel.style.maxWidth = 'min(280px, calc(100vw - 48px))';
        hintLabel.style.textAlign = 'center';
      }
      hint.style.display = 'flex';
      hint.style.zIndex = '601';
      fab.style.zIndex = '601'; // already position:fixed — sits above the 500 dimmer

      if (overlay) {
        overlay.style.display = '';
        overlay.style.pointerEvents = 'auto';
        overlay.onclick = () => {
          // Not a dismiss — the profile button is the way forward. Nudge the label.
          if (!hintInner) return;
          hintInner.style.animation = 'bbHintNudge 0.5s ease';
          setTimeout(() => { hintInner.style.animation = prevInnerAnim; }, 520);
        };
      }

      const _cleanup = () => {
        window._bbAccountHintActive = false;
        if (overlay) { overlay.style.display = 'none'; overlay.style.pointerEvents = 'none'; overlay.onclick = null; }
        hint.style.display = 'none';
        hint.style.zIndex = '';
        fab.style.zIndex = prevFabZ;
        fab.removeEventListener('click', _onFabClick);
      };
      const _onFabClick = () => {
        _cleanup();
        // Show the complete popup only after the auth modal has been dealt
        // with, so it never covers the sign-up form. Poll rather than chain
        // _fabOnCloseAuth: polling also catches the modal never opening.
        // _bbFinaleToastPending lets the post-sign-up profile popup
        // (_fabOnSignUp) hold back until the toast has actually appeared.
        window._bbFinaleToastPending = true;
        const _showToast = () => { window._bbFinaleToastPending = false; _showTutorialCompleteModal(); };
        // Guests now land in the Profile modal (which carries the sign-in
        // button); signed-up flows still open the auth modal directly. Either
        // counts as "the modal was dealt with", so watch both.
        const _finaleModalOpen = () => {
          const a = document.getElementById('bbAuthModal');
          const p = document.getElementById('idxProfileModal');
          return (a && a.classList.contains('active')) || (p && p.classList.contains('active'));
        };
        let waited = 0;
        const _openPoll = setInterval(() => {
          waited += 200;
          if (_finaleModalOpen()) {
            clearInterval(_openPoll);
            const _closePoll = setInterval(() => {
              if (!_finaleModalOpen()) {
                clearInterval(_closePoll);
                setTimeout(_showToast, 350);
              }
            }, 300);
          } else if (waited >= 1600) {
            clearInterval(_openPoll); // modal never opened — don't lose the popup
            _showToast();
          }
        }, 200);
      };
      fab.addEventListener('click', _onFabClick);
    }

    function _applyOnboardingGating() {
      const step = _getOnboardingStep();

      // Auto-set bbFabsUnlocked when tutorial completes
      if (BB.storage.get('FabsUnlocked') !== '1' &&
          step >= 12 && BB.storage.get('TutorialToastShown') === '1' &&
          !document.getElementById('tutorialCompleteModal')) {
        BB.storage.set('FabsUnlocked', '1');
      }
      const _fabsUnlocked = BB.storage.get('FabsUnlocked') === '1';

      // First-run "🆘 Need help now?" stands in for the dock's 🆘 FAB until
      // the dock unlocks (index.html #firstRunHelp).
      const _frHelp = document.getElementById('firstRunHelp');
      if (_frHelp) _frHelp.style.display = _fabsUnlocked ? 'none' : '';

      // Step 4 was the "save your progress" sign-in blocking step. Auth FAB and
      // Anonymous button are now hidden until tutorial completes, so step 4 is
      // skipped automatically — advance straight to 5 (logo hint).
      if (step === 4) {
        _advanceOnboardingStep(5);
        return;
      }

      // Profile → Customise toggles: the home screen shows only the Mood Journal
      // by default. Survival Kit / Bipolar Anonymous are opt-in — the user turns
      // them on from the profile. Folded in here so this function stays the single
      // source of truth for home-button visibility.
      const _showSurvival = BB.storage.get('SurvivalBtnEnabled') === '1';
      const _showAnon     = BB.storage.get('AnonBtnEnabled') === '1';
      const _btnsWrap = document.querySelector('.buttons');
      if (_btnsWrap) _btnsWrap.classList.toggle('bb-hide-stats', BB.storage.get('HomeStatsEnabled') !== '1');

      // Anonymous button: hidden until tutorial complete. (The auth FAB is the
      // dock's #bbAuthFab, owned entirely by fab.js — it stays visible in every
      // phase, so it is intentionally not touched here.)
      const _anonContainer = document.getElementById('anonymousContainer');
      if (_anonContainer) _anonContainer.style.display = (_fabsUnlocked && _showAnon) ? '' : 'none';
      // The 💬 streak on the quick check-in card and the widget follows the
      // button: refresh both whenever its visibility is (re)applied.
      const _qcStreaks = document.querySelector('#qcWeek .qc-week-streaks');
      if (_qcStreaks && BB._qcWeekStreaks) _qcStreaks.innerHTML = BB._qcWeekStreaks();
      try { BB.platform.syncWidgetMoods(); } catch (_) {}

      // Survival kit: opt-in — shown only once enabled (and after step 6 onboarding gate)
      const _survival = document.getElementById('survivalContainer');
      if (_survival) _survival.style.display = (step < 6 || !_showSurvival) ? 'none' : '';

      // Footer (community count): visible from step 12
      const _footer = document.getElementById('homeFooter');
      if (_footer) _footer.style.display = step >= 12 ? '' : 'none';

      // is-new-user class: steps 0-3 only
      if (step < 4) document.body.classList.add('is-new-user');
      else document.body.classList.remove('is-new-user');

      // Privacy note: shown until first journal button click
      const _pn = document.getElementById('privacyNote');
      if (_pn) _pn.style.display = BB.storage.get('PrivacyNoteDismissed') === '1' ? 'none' : '';

      // ── Hints ──
      // Hint 1 (journalStartHint): step 0 only
      const _h1 = document.getElementById('journalStartHint');
      if (_h1) _h1.style.display = step === 0 ? 'flex' : 'none';

      // Logo hint: step 5 only, and only on iOS (logo tap easter egg not implemented on Android)
      const _logoHint = document.getElementById('logoHint');
      const _isAndroid = window.BB && window.BB.platform && window.BB.platform.isAndroid();
      if (_isAndroid && step === 5) {
        // Skip the logo easter egg step on Android — advance straight to step 6
        _advanceOnboardingStep(6);
        return;
      }
      if (_logoHint) _logoHint.style.display = step === 5 ? '' : 'none';

      // Survival kit hint removed — user finds it freely
      const _h6 = document.getElementById('survivalKitHint');
      if (_h6) _h6.style.display = 'none';

      // WA hint: permanently hidden (native-only, post-tutorial)
      const _waLbl = document.getElementById('waFabLabel');
      if (_waLbl) _waLbl.style.display = 'none';
      // Feedback hint: don't force-hide at step 12 — popup dismiss handler shows it

      // Sign-in hint hidden (step 4 removed from tutorial flow) — unless the
      // tutorial-finale account hint is borrowing it right now.
      const _siHint = document.getElementById('signinHint');
      if (_siHint && !window._bbAccountHintActive) _siHint.style.display = 'none';

      // ── Hint overlay ──
      // Step 5 (logo hint) was previously blocking — it intercepted all clicks so
      // users had to click the logo. But if someone quit mid-tutorial and returned,
      // every portal button was silently dead. The logo hint still shows at step 5;
      // it just no longer hard-gates navigation.
      const _blockingSteps = new Set([]);
      const _isBlocking = _blockingSteps.has(step);
      const _overlay = document.getElementById('bbHintOverlay');
      if (_overlay && !window._bbAccountHintActive) _overlay.style.display = _isBlocking ? '' : 'none';

      // Elevate hint + target above overlay when blocking
      document.querySelectorAll('.bb-hint-elevated').forEach(el => {
        el.classList.remove('bb-hint-elevated');
        el.style.zIndex = el.dataset.prevZIndex !== undefined ? el.dataset.prevZIndex : '';
        delete el.dataset.prevZIndex;
      });
      if (_isBlocking) {
        const _elevMap = {
          5:  [document.getElementById('logoHint'),   document.querySelector('.logo-bounce-wrapper')],
        };
        (_elevMap[step] || []).filter(Boolean).forEach(el => {
          el.dataset.prevZIndex = el.style.zIndex;
          el.style.zIndex = '601';
          if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
          el.classList.add('bb-hint-elevated');
        });
        _hideIndexHintPointer();
      } else {
        _hideIndexHintPointer();
      }

      // Journal tutorial progress: X/3 entries needed (hidden once advanced tutorial complete)
      const _prog = document.getElementById('journalTutorialProgress');
      if (_prog) {
        // Count completed tutorial milestones directly from flags — not from step number,
        // since step can reach 10+ via logo/survival/feedback flow without multiple entries.
        const _e1 = BB.storage.get('HasEntries') === '1';                     // Entry 1: first real entry
        const _e2 = BB.storage.get('SettingsHintDone') === '1';               // Entry 2: settings hint seen
        const _e3 = BB.storage.get('CloseSettingsHintDone') === '1';          // Entry 3: settings tutorial done
        const _e4 = BB.storage.get('_fmMoodTipShown') === '1';               // Entry 4: tap & hold hint done
        if (_e4) {
          _prog.style.display = 'none';
        } else {
          const _done = [_e1, _e2, _e3].filter(Boolean).length;
          const _remaining = 4 - _done;
          const _progKey = _remaining === 1 ? 'home.tutorialProgressOne' : 'home.tutorialProgressMany';
          const _progTxt = window.BB && window.BB.t ? window.BB.t(_progKey, { n: _remaining }) : '';
          _prog.textContent = (_progTxt && _progTxt !== _progKey) ? _progTxt
            : _remaining + ' more ' + (_remaining === 1 ? 'entry' : 'entries') + ' needed to complete tutorial';
          _prog.style.display = '';
        }
      }

      // Quick check-in bears + 7-day strip (BLOCK 3c) share this gate.
      if (typeof window._renderQuickCheckin === 'function') window._renderQuickCheckin();

      if (typeof window._applyFabDock === 'function') window._applyFabDock();
    }
    window._applyOnboardingGating = _applyOnboardingGating;

    // ── Onboarding page lock ──
    (function() {
      // step → [targetId, hintId]
      // Step 5 removed: the logo-click easter egg hint is now non-blocking so
      // returning users aren't trapped with dead portal buttons.
      const _isNatLock = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
      const _map = {
      };
      function _getTarget(s) { const e = _map[s]; if (!e) return null; const id = e[0]; return id.startsWith('.') ? document.querySelector(id) : document.getElementById(id); }
      function _getHint(s)   { const e = _map[s]; if (!e) return null; return document.getElementById(e[1]); }
      function _nudge() {
        const s = _getOnboardingStep();
        let tgt = _getTarget(s);
        [_getHint(s), tgt].forEach(el => {
          if (!el) return;
          const _prev = el.style.animation;
          el.style.animation = 'none';
          el.offsetHeight;
          el.style.animation = 'bbHintNudge 0.5s ease';
          setTimeout(() => { el.style.animation = _prev; }, 520);
        });
      }
      function _isModalOpen() {
        return !!(document.querySelector('.overlay-modal.active, .wa-modal.active, .feedback-modal.active, .bb-auth-overlay.active, .bb-account-overlay.active'));
      }
      document.addEventListener('click', function(e) {
        const s = _getOnboardingStep();
        if (!_map[s]) return;
        if (_isModalOpen()) return;
        const t = _getTarget(s);
        if (!t || t === e.target || t.contains(e.target)) return;
        e.stopPropagation(); e.preventDefault();
        _nudge();
      }, true);
    })();

    // Show offline banner + disable sign-in when there's no network
    function updateOnlineStatus() {
      const online = navigator.onLine;
      const banner = document.getElementById('offlineBanner');
      if (banner) banner.style.display = online ? 'none' : '';
      // Dim the auth FAB for signed-out users when offline (sign-in needs
      // Firebase). Signed-in users keep it — the profile modal is local and
      // works offline.
      const fab = document.getElementById('bbAuthFab');
      if (!fab) return;
      if (!online && !window.currentUser) {
        fab.style.opacity = '0.35';
        fab.style.pointerEvents = 'none';
      } else {
        fab.style.opacity = '';
        fab.style.pointerEvents = '';
      }
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // Streak badges under journal + anonymous buttons
    /**
     * Render the journal + anonymous streak badges from current localStorage values.
     * Cheap synchronous read — call after any mutation to bbCurrentStreak,
     * bbStableStreak, bbAnon_streak, bbAnon_monika.
     */
    function _updateStreakBadge() {
      const streak = parseInt(BB.storage.get('CurrentStreak') || '0', 10);
      const stable = parseInt(BB.storage.get('StableStreak')  || '0', 10);
      // Lapse-aware: the raw Anon_streak doesn't self-expire, so validate it
      // against the last visit date (see BB.anonLiveStreak). Returns 0 once
      // the streak has broken, which falls through to the monika-only branch.
      const anon   = BB.anonLiveStreak();
      const hasAnon = !!BB.storage.get('Anon_monika');

      // Journal badge: 🔥 + 🧘
      const badge = document.getElementById('journalStreakBadge');
      if (badge) {
        if (streak > 0) {
          const stablePart = stable > 0 ? ` &nbsp;🧘 ${stable}d` : '';
          badge.innerHTML    = `🔥 ${streak} day${streak === 1 ? '' : 's'}` + stablePart;
          badge.style.cursor = 'pointer';
          _revealBadge(badge, 'block');
        } else {
          // No streak yet — hide the badge after the skeleton min-time so
          // its reserved row collapses cleanly.
          _revealBadge(badge, 'none');
        }
      }

      // The same two streaks on the quick check-in card's "Last 7 days" line.
      const qcStreaks = document.querySelector('#qcWeek .qc-week-streaks');
      if (qcStreaks && BB._qcWeekStreaks) qcStreaks.innerHTML = BB._qcWeekStreaks();

      // Anonymous badge: 👋 monika + 💬 streak
      const anonBadge = document.getElementById('anonStreakBadge');
      if (anonBadge) {
        if (hasAnon && anon > 0) {
          // _monika is user-supplied (Bipolar Anonymous nickname) — escape it
          // before splicing into innerHTML so a tampered localStorage value
          // can't inject markup. The rest of the template is static.
          const _monika = _escHtml(BB.storage.get('Anon_monika') || '');
          const _monikaStr = _monika ? `👋 ${_monika} &nbsp;·&nbsp; ` : '';
          anonBadge.innerHTML = `${_monikaStr}💬 ${anon} day${anon === 1 ? '' : 's'} streak`;
          _revealBadge(anonBadge, 'block');
        } else if (hasAnon) {
          const _monika = _escHtml(BB.storage.get('Anon_monika') || '');
          if (_monika) {
            anonBadge.innerHTML = `👋 ${_monika}`;
            _revealBadge(anonBadge, 'block');
          } else {
            _revealBadge(anonBadge, 'none');
          }
        } else {
          _revealBadge(anonBadge, 'none');
        }
      }
    }
    /**
     * Synchronous test for "is/was there a Firebase user logged in here".
     * Firebase v8 persists auth state under `firebase:authUser:<apiKey>:...`
     * in localStorage; that key disappears on sign-out. We use it to skip
     * the initial streak-badge render when the user is signed out, so the
     * previous account's stats don't flash on screen before the (async)
     * auth listener resolves and hides them.
     */
    function _hasCachedFbUser() {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf('firebase:authUser:') === 0) {
            const v = localStorage.getItem(k);
            if (v && v !== 'null' && v.length > 5) return true;
          }
        }
      } catch (_) {}
      return false;
    }
    // Only render the cached streak/anon badges if the user is plausibly
    // signed in, or is a real guest (has guest-PIN data of their own). The
    // auth listener re-runs this once auth resolves.
    if (_hasCachedFbUser() || BB.storage.get('GuestPinSalt')) {
      _updateStreakBadge();
    }

    /**
     * Recompute the journal streak by reading the user's entries collection
     * directly. Used on sign-in to fix the stale-streak bug: the
     * userSettings.currentStreak field is only refreshed by journal.html when
     * the user opens the journal page, so on a fresh device login the cached
     * value can lag well behind the truth (e.g. 1 day shown when reality is 600).
     *
     * Mirrors the streak algorithm in journal.html (see displayStats around
     * the entryDates Set). If the two ever drift, factor into js/shared/streak.js.
     *
     * Reads only the plaintext `timestamp` field — entry payloads are E2E
     * encrypted, but timestamp + userId are stored alongside in cleartext.
     *
     * @param {firebase.User} user The signed-in Firebase user.
     */
    async function _recomputeStreakFromEntries(user) {
      if (!db || !user) return;
      if (!navigator.onLine) { _updateStreakBadge(); return; }
      const _fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      try {
        const snap = await db.collection('entries')
          .where('userId', '==', user.uid)
          .get();
        const entryDates = new Set();
        snap.forEach(doc => {
          const ts = doc.data().timestamp;
          if (typeof ts !== 'number') return;
          entryDates.add(_fmt(new Date(ts)));
        });
        if (entryDates.size === 0) return; // never overwrite a real value with 0

        const useToday = localStorage.getItem('journalDefaultToday') === 'true';
        const today = new Date(); today.setHours(0, 0, 0, 0);
        let checkDate = new Date(today);
        if (!useToday) checkDate.setDate(checkDate.getDate() - 1);
        // If the anchor day has no entry, slide one day back so streaks don't
        // break the moment the user hasn't logged today (or yesterday) yet.
        if (!entryDates.has(_fmt(checkDate))) {
          checkDate.setDate(checkDate.getDate() - 1);
        }
        let streak = 0;
        while (entryDates.has(_fmt(checkDate))) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        }

        BB.storage.set('CurrentStreak', String(streak));
        db.collection('userSettings').doc(user.uid)
          .set({ currentStreak: streak }, { merge: true }).catch(() => {});
        _updateStreakBadge();
      } catch (e) {
        if (window.BB && window.BB.warn) window.BB.warn('[index] streak recompute failed:', e);
      }
    }
    window._recomputeStreakFromEntries = _recomputeStreakFromEntries;

    // Tap badge → explain both counters
    (function() {
      const badge = document.getElementById('journalStreakBadge');
      if (!badge) return;

      // Build tooltip card once
      const tip = document.createElement('div');
      tip.id = 'streakTooltip';
      Object.assign(tip.style, {
        display: 'none', position: 'absolute', zIndex: '999',
        background: '#fff', borderRadius: '14px', padding: '14px 16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)', fontSize: '13px',
        lineHeight: '1.6', color: '#1C1004', maxWidth: '260px',
        left: '50%', transform: 'translateX(-50%)', marginTop: '8px',
        textAlign: 'left',
      });
      tip.innerHTML =
        '<div style="font-weight:800;margin-bottom:8px;">' + _tr('home.counterTipTitle', 'Your counters') + '</div>' +
        '<div style="margin-bottom:8px;">' + _tr('home.counterTipStreak', "🔥 Streak — consecutive days you've logged your mood. Resets if you miss a day.") + '</div>' +
        '<div>' + _tr('home.counterTipStability', "🧘 Stability — consecutive days you've logged your mood as Stable, counted back from your most recent entry. Resets when any other mood is logged.") + '</div>';

      // Insert after badge
      badge.style.position = 'relative';
      badge.parentNode.insertBefore(tip, badge.nextSibling);

      badge.addEventListener('click', function(e) {
        e.stopPropagation();
        const show = tip.style.display === 'none';
        tip.style.display = show ? 'block' : 'none';
      });
      document.addEventListener('click', function() { tip.style.display = 'none'; });
    })();

    function logout() {
      // Clear all user-specific cached data before signing out.
      // bbOnboardingStep is intentionally NOT cleared here — Firestore preserves it
      // so the user resumes at the same onboarding step on re-login on any device.
      // Brand-prefixed keys: cleared via BB.storage so the same code works
      // across variants (the 'bb' prefix comes from BB_BRAND.storagePrefix).
      // 'OnboardingStep' is intentionally NOT here — Firestore preserves it
      // so the user resumes at the same onboarding step on re-login.
      const bbKeysToRemove = [
        '_entryStatus', '_recentMoods',
        'HasEntries',
        // Streaks & stats — must clear so they don't leak between accounts
        'CurrentStreak', 'StableStreak',
        // Anonymous board state
        'Anon_streak', 'Anon_monika', 'Anon_verified', 'AnonLastVisit', 'Anon_lastPostDate',
        'Anon_allRead',
        // Mood step tutorial hints
        '_moodTipShown', '_fmMoodTipShown',
        '_fmChooseMoodHintDone', '_fmMoodInfoCloseHintDone',
        // Settings / customise tutorial hints
        'SettingsHintDone',
        'CustomiseFormHintDone', 'CustomiseAdditionalHintDone', 'CloseSettingsHintDone',
        'AdvancedTutorialToastShown',
        // Advanced settings badge + tap-hold hint pending
        'AdvancedBadgePending', 'AdvancedBadgeVisible',
        '_fmTapHoldHintPending', '_fmTapHoldHintReady',
        // Misc hints
        'PersonalHintDone',
        'FavouriteHintSeen', 'PrivateHintSeen', 'FavAnniShown',
        'FeedbackFabHidden', 'WaFabHidden', 'CoffeeFabHidden', 'QuickNoteFabHidden', 'ReviewFabHidden', 'FooterHidden', 'FabsUnlocked',
        'FabSlot_1', 'FabSlot_2', 'FabSlot_3', 'FabSlot_4',
        'LogoEasterEggFound',
        'PinEnabled', 'PinCode',
        'WelcomeShown',
        // "Already counted in counters/userCount" mirror — account-specific,
        // so the next account signing in on this device still counts itself.
        'UserCounted', 'Anon_counted',
      ];
      bbKeysToRemove.forEach(k => BB.storage.remove(k));
      try { BB.platform.syncWidgetMoods(); } catch (_) {}
      // The safety plan is synced (encrypted) to the account, so it goes with it.
      try { BB.safetyPlan.clearLocal(); BB.lowMoodSupport.clearLocal(); } catch (_) {}

      // Non-prefixed user-data keys: shared across variants, cleared via
      // raw localStorage.
      const otherKeysToRemove = [
        'moodDefinitions', 'copingStrategies',
        'currentMedList', 'dailyGoals',
        'unlockedAchievements',
      ];
      otherKeysToRemove.forEach(k => localStorage.removeItem(k));
      sessionStorage.removeItem('bbPinUnlocked');

      // Reset both ticks to inactive
      const jTick = document.getElementById('journalEntryTick');
      if (jTick) jTick.setAttribute('data-done', 'false');
      const sTick = document.getElementById('survivalTick');
      if (sTick) sTick.setAttribute('data-done', 'false');
      const aTick = document.getElementById('anonEntryTick');
      if (aTick) aTick.setAttribute('data-done', 'false');

      // Hide streak / anon badges so old account's stats don't linger on the home page.
      // Sign-out is a user-driven action, not a page-load load state — call apply
      // immediately rather than going through the skeleton min-time gate.
      const _jBadge = document.getElementById('journalStreakBadge');
      if (_jBadge) { _jBadge.classList.remove('bb-skeleton'); _jBadge.style.display = 'none'; }
      const _aBadge = document.getElementById('anonStreakBadge');
      if (_aBadge) { _aBadge.classList.remove('bb-skeleton'); _aBadge.style.display = 'none'; }
      const _amBadge = document.getElementById('anonMessagesBadge');
      if (_amBadge) { _amBadge.classList.remove('bb-skeleton'); _amBadge.style.display = 'none'; }
      // Reset survival kit progress count to default (4 always-complete sections = 4/12)
      const _sp = document.getElementById('survivalProgress');
      if (_sp) { _sp.classList.remove('bb-skeleton'); _sp.textContent = _tr('home.survivalProgress', '4 / 12 sections complete', { c: 4 }); }

      if (auth) auth.signOut();
    }

    // ── Auth hooks (modals now live in fab.js) ──
    window._fabOnShowAuth = function () {
      const _step = _getOnboardingStep();
      if (_step === 4) _advanceOnboardingStep(5);
    };
    window._fabOnCloseAuth = function () {
      // Briefly block pointer events to prevent tap-through after modal close
      const _container = document.querySelector('.container');
      if (_container) {
        _container.style.pointerEvents = 'none';
        setTimeout(() => { _container.style.pointerEvents = ''; }, 400);
      }
    };
    window._fabOnSignOut = logout;
    window._fabOpenPersonalInfo = function () {
      window.closeAccountModal();
      if (typeof window.closeProfileModal === 'function') window.closeProfileModal();
      showPersonalDetailsModal();
    };

    const _pdFields = [
      ['pdName','personalName'], ['pdDOB','personalDOB'], ['pdMedNum','personalMedicalNum'],
      ['pdDiagnosis','personalDiagnosis'], ['pdDiagDate','personalDiagnosisDate'],
      ['pdAddress','personalAddress'], ['pdMobile','personalMobile'],
      ['pdEmail','personalEmail'], ['pdEmergency','personalEmergencyContact'], ['pdNotes','personalNotes']
    ];

    async function showPersonalDetailsModal() {
      // Load from localStorage immediately so the modal opens without delay
      _pdFields.forEach(([elId, lsKey]) => {
        const el = document.getElementById(elId);
        if (el) el.value = localStorage.getItem(lsKey) || '';
      });
      document.getElementById('personalDetailsModal').classList.add('active');
      // Then try to freshen from Firestore in the background
      if (currentUser && db) {
        try {
          const doc = await db.collection('personalDetails').doc(currentUser.uid).get();
          if (doc.exists) {
            const d = doc.data();
            _pdFields.forEach(([elId, lsKey]) => {
              if (d[lsKey] !== undefined) {
                localStorage.setItem(lsKey, d[lsKey]);
                const el = document.getElementById(elId);
                if (el) el.value = d[lsKey];
              }
            });
          }
        } catch(e) {}
      }
    }
    function closePersonalDetailsModal() {
      document.getElementById('personalDetailsModal').classList.remove('active');
    }
    async function savePersonalDetails() {
      const data = {};
      _pdFields.forEach(([elId, lsKey]) => {
        const val = (document.getElementById(elId) || {}).value || '';
        localStorage.setItem(lsKey, val);
        data[lsKey] = val;
      });
      if (currentUser && db) {
        try { await db.collection('personalDetails').doc(currentUser.uid).set(data, { merge: true }); } catch(e) {}
      }
      closePersonalDetailsModal();
    }
    // ── Profile / Account modal (multi-panel: Customise → Account → Danger) ──
    // Replaces the shared fab.js account popup on the home screen. Opened by
    // the signed-in 👤 button and the centre auth FAB (window._fabOpenAuth).

    /** Home-button toggle definitions for the Customise panel. */
    // Survival / Anonymous are opt-in: their flag stores the *enabled* state
    // ('1' = on). Unset/'0' = off, so the home screen shows only the Journal
    // until the user activates them here. Journal is always on (locked).
    const _HOME_BTN_TOGGLES = [
      { id: 'journal',  icon: '📔', label: 'Journal', labelKey: 'home.toggleJournal', locked: true,  flag: null },
      { id: 'survival', icon: '🆘', label: 'Survival', labelKey: 'home.toggleSurvival', locked: false, flag: 'SurvivalBtnEnabled' },
      { id: 'anon',     icon: '💬', label: 'Anonymous', labelKey: 'home.toggleAnonymous', locked: false, flag: 'AnonBtnEnabled' },
    ];

    /**
     * Post-sign-up "NEW" hint state for the Survival / Anonymous toggles.
     * bbCustomiseNewPending is set when a brand-new account is created
     * (_fabOnSignUp) and cleared once both buttons are enabled or after the
     * Customise panel has been seen 3 times — so the badge can't nag forever.
     */
    function _customiseNewActive() {
      return BB.storage.get('CustomiseNewPending') === '1';
    }

    /** Render the active/inactive icon+text toggle buttons (journal style). */
    function _renderHomeBtnToggles() {
      const row = document.getElementById('idxHomeBtnToggles');
      if (!row) return;
      const _newHintOn = _customiseNewActive();
      row.innerHTML = _HOME_BTN_TOGGLES.map(t => {
        const on = t.locked || BB.storage.get(t.flag) === '1';
        const _border = on ? 'var(--brand-primary)' : '#dee2e6';
        const _bg     = on ? 'rgba(255,149,0,0.1)' : 'white';
        const _color  = on ? 'var(--brand-primary)' : '#adb5bd';
        const _click  = t.locked ? '' : ` onclick="_toggleHomeBtn('${t.id}')"`;
        const _cursor = t.locked ? 'default' : 'pointer';
        const _lock   = t.locked ? '<span style="position:absolute;top:4px;right:6px;font-size:0.7em;">🔒</span>' : '';
        const _isNew  = _newHintOn && !t.locked && !on;
        const _pill   = _isNew ? `<span class="bb-new-pill">${_tr('home.newPill', 'NEW')}</span>` : '';
        return `<button${_click}${_isNew ? ' class="bb-new-toggle"' : ''} style="position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 14px;border-radius:12px;border:1.5px solid ${_border};background:${_bg};color:${_color};cursor:${_cursor};font-size:0.82em;font-weight:600;min-width:64px;-webkit-tap-highlight-color:transparent;">${_lock}${_pill}<span style="font-size:1.3em;">${t.icon}</span><span>${_tr(t.labelKey, t.label)}</span></button>`;
      }).join('');
    }

    /** Sync a freshly-changed boolean customise pref to Firestore (best-effort). */
    function _syncHomeCustomise() {
      if (!db || !currentUser) return;
      db.collection('userSettings').doc(currentUser.uid).set({
        homeSurvivalEnabled: BB.storage.get('SurvivalBtnEnabled') === '1',
        homeAnonEnabled:     BB.storage.get('AnonBtnEnabled') === '1',
        homeStatsEnabled:    BB.storage.get('HomeStatsEnabled') === '1',
        homeQuickCheckinEnabled: BB.storage.get('HomeQuickCheckin') === '1',
      }, { merge: true }).catch(() => {});
    }

    /** Toggle a home button's hidden flag, re-render, re-apply, sync. */
    function _toggleHomeBtn(which) {
      const t = _HOME_BTN_TOGGLES.find(x => x.id === which);
      if (!t || t.locked || !t.flag) return;
      const nowEnabled = BB.storage.get(t.flag) !== '1';
      BB.storage.set(t.flag, nowEnabled ? '1' : '0');
      // Both opt-in buttons enabled → the NEW hint has done its job
      if (_customiseNewActive() &&
          BB.storage.get('SurvivalBtnEnabled') === '1' &&
          BB.storage.get('AnonBtnEnabled') === '1') {
        BB.storage.remove('CustomiseNewPending');
      }
      _renderHomeBtnToggles();
      if (typeof window._applyOnboardingGating === 'function') window._applyOnboardingGating();
      _syncHomeCustomise();
    }
    window._toggleHomeBtn = _toggleHomeBtn;

    /** Paint the "Show stats" pill toggle to match the current flag. */
    function _paintShowStatsToggle() {
      const btn = document.getElementById('idxShowStatsToggle');
      if (!btn) return;
      const on = BB.storage.get('HomeStatsEnabled') === '1';
      btn.style.background = on ? 'var(--brand-primary)' : '#ccc';
      const thumb = btn.querySelector('span');
      if (thumb) thumb.style.left = on ? '23px' : '3px';
    }

    /** Toggle the stat badges (streaks / progress) under the home buttons. */
    function _toggleHomeStats() {
      const nowEnabled = BB.storage.get('HomeStatsEnabled') !== '1';
      BB.storage.set('HomeStatsEnabled', nowEnabled ? '1' : '0');
      _paintShowStatsToggle();
      if (typeof window._applyOnboardingGating === 'function') window._applyOnboardingGating();
      _syncHomeCustomise();
    }
    window._toggleHomeStats = _toggleHomeStats;

    /** Paint the "Quick check-in" pill toggle to match HomeQuickCheckin. */
    function _paintQuickCheckinToggle() {
      const btn = document.getElementById('idxQuickCheckinToggle');
      if (!btn) return;
      const on = BB.storage.get('HomeQuickCheckin') === '1';
      btn.style.background = on ? 'var(--brand-primary)' : '#ccc';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      const thumb = btn.querySelector('span');
      if (thumb) thumb.style.left = on ? '23px' : '3px';
    }

    /** Toggle the quick check-in widget (replaces the Mood Journal button). */
    function _toggleHomeQuickCheckin() {
      const nowEnabled = BB.storage.get('HomeQuickCheckin') !== '1';
      BB.storage.set('HomeQuickCheckin', nowEnabled ? '1' : '0');
      _paintQuickCheckinToggle();
      if (typeof window._applyOnboardingGating === 'function') window._applyOnboardingGating();
      _syncHomeCustomise();
    }
    window._toggleHomeQuickCheckin = _toggleHomeQuickCheckin;

    /** Switch between the Customise / Account / Danger panels. */
    function _profileShowPanel(name) {
      const panels = { customise: 'idxProfilePanelCustomise', account: 'idxProfilePanelAccount', danger: 'idxProfilePanelDanger' };
      Object.entries(panels).forEach(([k, id]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = (k === name) ? '' : 'none';
      });
      if (name === 'account') {
        // Reset collapsible sub-forms each time the panel is shown
        ['idxPassFields', 'idxEmailFields'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
        ['idxPassToggleBtn', 'idxEmailToggleBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
        ['idxCurrentPass', 'idxNewPass', 'idxNewEmail', 'idxEmailPass'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const msg = document.getElementById('idxProfileMsg');
        if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
        // Guests get a stripped Account page: just the delete/reset option.
        // Account management (password/email/personal info) and the in-profile
        // sign-in prompt are signed-in only. Guests can still sign in via the
        // auth FAB on the home screen.
        const signedIn = !!currentUser;
        const si = document.getElementById('idxAccountSignedIn');
        const gu = document.getElementById('idxAccountGuest');
        const pi = document.getElementById('idxPersonalInfoBtn');
        if (si) si.style.display = signedIn ? '' : 'none';
        if (gu) gu.style.display = 'none';
        if (pi) pi.style.display = signedIn ? '' : 'none';
      }
      if (name === 'danger') {
        const signedIn = !!currentUser;
        const _dt = document.getElementById('idxDangerTitle');
        const _dd = document.getElementById('idxDangerDesc');
        const _db = document.getElementById('idxDangerBtnLabel');
        if (_dt) _dt.textContent = signedIn ? _tr('home.danger.deleteTitle', 'Delete Account') : _tr('home.danger.resetTitle', 'Full Reset');
        if (_dd) _dd.textContent = signedIn
          ? _tr('home.danger.deleteDesc', 'Permanently delete your account, all journal entries, and reset everything on this device. This cannot be undone.')
          : _tr('home.danger.resetDesc', 'Permanently delete all journal entries and reset all settings to their defaults on this device. This cannot be undone.');
        if (_db) _db.textContent = signedIn ? _tr('home.danger.deleteBtn', '🗑️ Delete Account & Reset') : _tr('home.danger.resetBtn', '🗑️ Delete All Data & Reset');
      }
    }
    window._profileShowPanel = _profileShowPanel;

    /** Open the profile modal (always starts on the Customise panel). */
    window.showProfileModal = function () {
      // NEW-hint wear-out: after the Customise panel has been seen 3 times
      // the badge stops showing, even if the buttons were never enabled.
      if (_customiseNewActive()) {
        const _seen = parseInt(BB.storage.get('CustomiseNewSeen') || '0', 10) + 1;
        if (_seen > 3) BB.storage.remove('CustomiseNewPending');
        else BB.storage.set('CustomiseNewSeen', String(_seen));
      }
      _renderHomeBtnToggles();
      _paintShowStatsToggle();
      _paintQuickCheckinToggle();
      const email = (currentUser && currentUser.email) || '';
      const _e1 = document.getElementById('idxProfileEmailCustomise');
      const _e2 = document.getElementById('idxProfileEmail');
      if (_e1) _e1.textContent = email;
      if (_e2) _e2.textContent = email;
      // Guest-only sign up / in button on the Customise page
      const _siBtn = document.getElementById('idxCustomiseSignIn');
      if (_siBtn) _siBtn.style.display = currentUser ? 'none' : '';
      // A Universal ID account has no Bipolar Bear password, and its email is
      // the Universal ID's (kept in step at each sign-in): nothing to change here.
      const _uidOnly = !!(currentUser && window.BB && BB.uid && BB.uid.isUidOnly(currentUser));
      ['idxPassToggleBtn', 'idxEmailToggleBtn'].forEach(id => {
        const b = document.getElementById(id);
        if (b && b.parentElement) b.parentElement.style.display = _uidOnly ? 'none' : '';
      });
      const _uidLink = document.getElementById('idxUidLink');
      if (_uidLink) _uidLink.style.display = (_uidOnly || (window.BB && BB.uid && BB.uid.hasSession())) ? 'block' : 'none';
      const langSel = document.getElementById('idxLangSelect');
      if (langSel && window.BB && window.BB.i18n) langSel.value = window.BB.i18n.getLang();
      const verEl = document.getElementById('idxProfileVersion');
      if (verEl) {
        const _v = (window.BB && window.BB.versionLabel) ? window.BB.versionLabel() : '';
        verEl.textContent = (_v ? _v + ' · ' : '') + _tr('home.changelogLink', 'Changelog');
      }
      _profileShowPanel('customise');
      document.getElementById('idxProfileModal').classList.add('active');
    };

    window.closeProfileModal = function () {
      const m = document.getElementById('idxProfileModal');
      if (m) m.classList.remove('active');
      if (typeof window._fabOnCloseAuth === 'function') window._fabOnCloseAuth();
    };

    /**
     * fab.js hook: a brand-new account was just created on this page. Arm the
     * NEW hint on the Survival / Anonymous customise toggles and auto-open
     * the profile popup — but only once the moment is quiet: currentUser
     * mirrored (so the email shows), and the tutorial-finale "Tutorial
     * Complete!" toast (if this sign-up came from the account hint) shown
     * and dismissed. Gives up silently after ~2 minutes (user wandered off).
     */
    window._fabOnSignUp = function () {
      BB.storage.set('CustomiseNewPending', '1');
      BB.storage.remove('CustomiseNewSeen');
      let waited = 0;
      const _poll = setInterval(() => {
        waited += 300;
        if (waited > 120000) { clearInterval(_poll); return; }
        if (!window.currentUser) return;
        if (window._bbFinaleToastPending) return;
        if (document.getElementById('tutorialCompleteModal')) return;
        clearInterval(_poll);
        window.showProfileModal();
      }, 300);
    };

    /** Sign-out from the account panel. */
    window._idxAccountLogout = function () {
      window.closeProfileModal();
      logout();
    };

    /** Show a transient status banner inside the account panel. */
    function _idxProfileShowMsg(text, ok) {
      const msg = document.getElementById('idxProfileMsg');
      if (!msg) return;
      msg.textContent = text;
      msg.style.color = ok ? '#2ECC40' : '#dc3545';
      msg.style.background = ok ? 'rgba(46,204,64,0.08)' : 'rgba(220,53,69,0.08)';
      msg.style.display = 'block';
    }

    window._idxSubmitPasswordChange = function () {
      const user = (firebase && firebase.auth) ? firebase.auth().currentUser : null;
      if (!user) return;
      const currentPass = (document.getElementById('idxCurrentPass').value || '').trim();
      const newPass     = (document.getElementById('idxNewPass').value     || '').trim();
      if (!currentPass || !newPass) { _idxProfileShowMsg(_tr('account.msg.fillBothFields', '⚠️ Please fill in both fields.'), false); return; }
      if (newPass.length < 6)       { _idxProfileShowMsg(_tr('account.msg.passwordTooShort', '⚠️ New password must be at least 6 characters.'), false); return; }
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPass);
      user.reauthenticateWithCredential(credential)
        .then(() => user.updatePassword(newPass))
        .then(() => {
          _idxProfileShowMsg(_tr('account.msg.passwordUpdated', '✅ Password updated successfully.'), true);
          document.getElementById('idxPassFields').style.display = 'none';
          document.getElementById('idxPassToggleBtn').style.display = '';
          document.getElementById('idxCurrentPass').value = '';
          document.getElementById('idxNewPass').value = '';
        })
        .catch(err => {
          const wrongPass = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential';
          _idxProfileShowMsg(wrongPass ? _tr('account.msg.wrongPassword', '⚠️ Current password is incorrect.') : (err.message ? '⚠️ ' + err.message : _tr('account.msg.passwordUpdateFailed', '⚠️ Could not update password.')), false);
        });
    };

    window._idxSubmitEmailChange = function () {
      const user = (firebase && firebase.auth) ? firebase.auth().currentUser : null;
      if (!user) return;
      const newEmail = (document.getElementById('idxNewEmail').value  || '').trim();
      const pass     = (document.getElementById('idxEmailPass').value || '').trim();
      if (!newEmail || !pass) { _idxProfileShowMsg(_tr('account.msg.fillBothFields', '⚠️ Please fill in both fields.'), false); return; }
      if (!newEmail.includes('@') || !newEmail.includes('.')) { _idxProfileShowMsg(_tr('account.msg.invalidEmail', '⚠️ Please enter a valid email address.'), false); return; }
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, pass);
      user.reauthenticateWithCredential(credential)
        .then(() => user.updateEmail(newEmail))
        .then(() => {
          _idxProfileShowMsg(_tr('account.msg.emailUpdated', '✅ Email updated to ' + newEmail, { email: newEmail }), true);
          const _e1 = document.getElementById('idxProfileEmail');
          const _e2 = document.getElementById('idxProfileEmailCustomise');
          if (_e1) _e1.textContent = newEmail;
          if (_e2) _e2.textContent = newEmail;
          document.getElementById('idxEmailFields').style.display = 'none';
          document.getElementById('idxEmailToggleBtn').style.display = '';
          document.getElementById('idxNewEmail').value = '';
          document.getElementById('idxEmailPass').value = '';
        })
        .catch(err => {
          const wrongPass = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential';
          const inUse     = err.code === 'auth/email-already-in-use';
          _idxProfileShowMsg(wrongPass ? _tr('account.msg.wrongPassword', '⚠️ Current password is incorrect.') : inUse ? _tr('account.msg.emailInUse', '⚠️ That email is already in use.') : (err.message ? '⚠️ ' + err.message : _tr('account.msg.emailUpdateFailed', '⚠️ Could not update email.')), false);
        });
    };

    // ── Full-reset / account-delete flow (ported from journal.js) ──
    // Signed in → deletes the Firebase account + all Firestore data + local
    // wipe. Guest → deletes local entries + resets settings. Either way any
    // leftover guest data is wiped. Mirrors journal.html's confirmDeleteAll /
    // deleteAllEntries so the home-screen Delete button behaves identically.

    /** Best-effort count of journal entries cached locally (for the prompts). */
    function _countLocalEntries() {
      let n = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('entry:')) n++;
      }
      return n;
    }

    function confirmDeleteAll() {
      const isSignedIn = !!currentUser;
      const count = _countLocalEntries();
      const countLine = count ? `${count} entries` : 'all entries';
      const accountLine = isSignedIn ? `Account: ${currentUser.email}\n` : `(Guest mode — browser storage)\n`;
      const action = isSignedIn
        ? `permanently delete your BipolarBear account, ${countLine}, and reset everything`
        : `permanently delete ${countLine} AND reset all settings to defaults`;
      const message = `⚠️ ${isSignedIn ? 'DELETE ACCOUNT' : 'FULL RESET'}?\n\n${accountLine}\nThis will ${action}.\n\nThis CANNOT be undone! Make sure to export a backup first.`;
      if (!confirm(message)) return;
      const finalLine = isSignedIn
        ? `FINAL WARNING: Permanently delete account ${currentUser.email}?\n\nThis CANNOT be undone.`
        : `FINAL WARNING: Delete ${countLine} and reset settings for guest?\n\nThis CANNOT be undone.`;
      if (!confirm(finalLine)) return;
      deleteAllEntries({ deleteAccount: isSignedIn });
    }
    window.confirmDeleteAll = confirmDeleteAll;

    /**
     * Honour ?deleteAccount=1 (set by fab.js on survival-kit, which has no
     * delete flow of its own). One-shot: the query param is stripped before
     * prompting so a refresh or back-navigation can't re-arm the dialog.
     */
    let _autoDeleteFired = false;
    function _maybeAutoDeleteAccount() {
      if (_autoDeleteFired) return;
      let wanted = false;
      try { wanted = new URLSearchParams(location.search).get('deleteAccount') === '1'; } catch (e) { return; }
      if (!wanted) return;
      _autoDeleteFired = true;
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
      setTimeout(confirmDeleteAll, 0);
    }

    async function deleteAllEntries(opts) {
      opts = opts || {};
      const deleteAccount = !!opts.deleteAccount;

      // Re-authenticate upfront for account deletion so a wrong password aborts
      // before we touch any data.
      if (deleteAccount && currentUser && window.BB && BB.uid && BB.uid.isUidOnly(currentUser)) {
        // A Universal ID account has no Bipolar Bear password to re-enter:
        // sign in afresh from the Universal ID session instead.
        if (!(await BB.uid.refreshFirebaseSignIn())) {
          alert(_tr('uid.deleteSignInAgain', 'Please sign out, sign in again, and then delete your account.'));
          return;
        }
        currentUser = firebase.auth().currentUser;
        window.currentUser = currentUser;
      } else if (deleteAccount && currentUser) {
        const _pw = prompt('Re-enter your password to confirm account deletion:');
        if (!_pw) return;
        try {
          const _cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, _pw);
          await currentUser.reauthenticateWithCredential(_cred);
        } catch (_e) {
          alert('Wrong password. Account not deleted.');
          return;
        }
      }

      let _accountDeleted = false;
      let deleted = 0;

      try {
        if (currentUser) {
          const snapshot = await db.collection('entries').where('userId', '==', currentUser.uid).get();
          const batch = db.batch();
          snapshot.forEach(doc => { batch.delete(doc.ref); deleted++; });
          await batch.commit();
        } else {
          const keysToDelete = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('entry:')) keysToDelete.push(key);
          }
          keysToDelete.forEach(key => { localStorage.removeItem(key); deleted++; });
        }

        // Clear all flags — full reset means truly starting from scratch.
        ['unlockedAchievements','bbFavAnniShown',
         'bbPrivateHintSeen','bbFavouriteHintSeen','bb_moodTipShown','bb_fmMoodTipShown',
         'bb_fmChooseMoodHintDone','bb_fmMoodInfoCloseHintDone',
         'bbAdvancedBadgePending','bbAdvancedBadgeVisible',
         'bb_fmTapHoldHintPending','bb_fmTapHoldHintReady',
         'bbHasEntries','bbOnboardingStep',
         'bbCurrentStreak','bbStableStreak',
         'bbFeedbackFabHidden','bbWaFabHidden','bbReviewFabHidden','bbFooterHidden',
         'bbFabSlot_1','bbFabSlot_2','bbFabSlot_3','bbFabSlot_4',
         'bbFabsUnlocked','bbFabFirstRunDone',
         'bbLogoEasterEggFound','bbCustomFieldHintDone',
         'bbSurvivalBtnEnabled','bbAnonBtnEnabled','bbHomeStatsEnabled','bbHomeQuickCheckin',
         'bbCustomiseNewPending','bbCustomiseNewSeen',
         'personalName','personalDOB','personalMedicalNum','personalDiagnosis',
         'personalDiagnosisDate','personalAddress','personalMobile','personalEmail',
         'personalEmergencyContact','personalNotes',
        ].forEach(k => localStorage.removeItem(k));

        BB.storage.remove('_draft');
        BB.storage.remove('_entryStatus');
        BB.storage.remove('_recentMoods');
        try { BB.platform.syncWidgetMoods(); } catch (_) {}
        try { BB.safetyPlan.clearLocal(); BB.lowMoodSupport.clearLocal(); } catch (_) {}
        ['moodDefinitions','copingStrategies','moodMemories','survivalGratitude',
         'rememberThis','myCommitments','customReminders','currentMedList',
         'dailyGoals','dailyBudget','logoVariant'].forEach(k => localStorage.removeItem(k));

        localStorage.setItem('focusedModeEnabled', '1');
        [
          'fmConfirmStep', 'fmAutoAdvance', 'fmAutoAdvanceMoreData',
          'elaborateResponsesEnabled', 'intentionEnabled',
          'incognitoMode', 'pdfHideByDefault',
          'showMoodSuggestion', 'moreDataOpenByDefault',
          'achievementToastsEnabled', 'statsStartDate', 'weeklySummaryEnabled',
          'earlyWarnEnabled', 'bbEarlyWarnSeen', 'bbJournalView', 'bbJournalRange',
          'customiseFormEnabled', 'disabledSteps', 'moodLinkingEnabled',
          'customTrackingFields', 'deletedDefaultCustomFields', 'deletedBuiltinFields',
          'bbPinEnabled', 'bbPinCode', 'bbNativePinEnabled',
          'bbHealthSyncEnabled', 'reminderEnabled', 'reminderTime',
          'journalDefaultToday', 'bbCoffeeFabHidden', 'bbQuickNoteFabHidden', 'bbSecurityFabHidden', 'bbQuickNotes',
        ].forEach(k => localStorage.removeItem(k));
        sessionStorage.removeItem('bbPinUnlocked');

        try {
          const _notif = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
          if (_notif) _notif.cancel({ notifications: [{ id: 1 }, { id: 2 }] }).catch(() => {});
        } catch (_) {}

        Object.keys(localStorage).filter(k =>
          k.startsWith('trackCustom_') || k.startsWith('_labelOverride_') ||
          ['trackGoals','trackBudget','trackExercise','trackOutside','trackAnxiety','trackEmotions','trackAlcohol'].includes(k)
        ).forEach(k => localStorage.removeItem(k));

        localStorage.removeItem('bipolarHelpedVoted');
        ['PersonalHintDone','MedHintDone','SettingsHintDone','CustomiseFormHintDone',
         'CustomiseAdditionalHintDone','CloseSettingsHintDone','CustomiseFormCollapsed',
         'AdvancedTutorialToastShown','SurvivalKitVisited','MoodDefHintDone',
         'PrivacyNoteDismissed','TutorialToastShown','WelcomeShown','AccountHintShown'].forEach(k => BB.storage.remove(k));

        // Firestore cleanup.
        if (currentUser && db) {
          if (deleteAccount) {
            await db.collection('userSettings').doc(currentUser.uid).delete().catch(() => {});
            await db.collection('personalDetails').doc(currentUser.uid).delete().catch(() => {});
            const _monika = BB.storage.get('Anon_monika');
            if (_monika) {
              await db.collection(BB_BRAND.collections.monikas).doc(_monika.toLowerCase()).delete().catch(() => {});
            }
            const _hashEmail = async (email) => {
              const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase().trim()));
              return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
            };
            const _emails = [currentUser.email, BB.storage.get('Anon_email')]
              .filter(Boolean).filter((e, i, arr) => arr.indexOf(e) === i);
            for (const _e of _emails) {
              try {
                const _hash = await _hashEmail(_e);
                await db.collection('anonProfiles').doc(_hash).delete().catch(() => {});
              } catch (_) {}
            }
          } else {
            db.collection('userSettings').doc(currentUser.uid).set({
              currentMedList: [], dailyGoals: [], dailyBudget: '', logoVariant: 0,
              focusedModeEnabled: true, fmConfirmStep: false, elaborateResponsesEnabled: false,
              intentionEnabled: false, incognitoMode: false, moreDataOpenByDefault: false,
              achievementToastsEnabled: true, showMoodSuggestion: false, moodLinkingEnabled: false, earlyWarnEnabled: false,
              customTrackingFields: [], trackingFields: {}, labelOverrides: {},
              moodDefinitions: {}, copingStrategies: {}, safetyPlanEnc: null,
              onboardingStep: 0, helpedVoted: false, healthSyncEnabled: false,
              personalHintDone: false,
              homeSurvivalEnabled: false, homeAnonEnabled: false, homeStatsEnabled: false,
            }, { merge: true }).catch(() => {});
            db.collection('personalDetails').doc(currentUser.uid).delete().catch(() => {});
          }
        }

        // Clear anon-board localStorage so the next user on this browser starts clean.
        ['Anon_monika','Anon_email','Anon_verified','Anon_isAdmin',
         'Anon_streak','Anon_med','Anon_medList','Anon_showMeds',
         'Anon_showStable','Anon_stableSince','Anon_stableStreak',
         'Anon_colorKey','Anon_initials','Anon_liked','Anon_hasPosted',
         'Anon_lastPostDate','Anon_allRead',
         'AnonLastVisit','AnonVisitDate'].forEach(k => BB.storage.remove(k));
        if (typeof applyLogoVariant === 'function') applyLogoVariant(0);

        // Final explicit PIN clear before reload.
        BB.storage.remove('NativePinEnabled');
        BB.storage.remove('PinEnabled');
        BB.storage.remove('PinCode');
        BB.storage.remove('GuestPinSalt');
        sessionStorage.removeItem('bbPinUnlocked');
        try { window.Capacitor?.Plugins?.SecureStorage?.removeItem?.('bb_native_pin')?.catch?.(() => {}); } catch (e) {}

        if (deleteAccount && currentUser) {
          try { await currentUser.delete(); _accountDeleted = true; }
          catch (_e) { console.error('user.delete failed', _e); }
        }

        alert(deleteAccount
          ? (_accountDeleted ? '✅ Account deleted.' : '⚠️ Data deleted but the auth account could not be removed. Please contact support.')
          : `Successfully deleted ${deleted} entries.`);
      } catch (error) {
        console.error('Error deleting all entries:', error);
        alert('Some cleanup steps failed: ' + error.message + '\n\nThe page will reload so you can start fresh.');
      } finally {
        if (!_accountDeleted && auth && currentUser) {
          auth.signOut().catch(() => {});
        }
        location.replace('index.html');
      }
    }
    window.deleteAllEntries = deleteAllEntries;

    // ── Logo easter egg with persistence ──
    const logoImg = document.querySelector('.logo-img');
    const srcs = ['images/logos/good_logo.png', 'images/logos/elevated_logo.png', 'images/logos/sad_logo.png'];
    let currentIndex = parseInt(localStorage.getItem('logoVariant') || '0');
    let clickCount = 0;
    let resetTimer = null;

    function applyLogoVariant(idx) {
      currentIndex = idx;
      logoImg.src = srcs[idx];
    }

    function saveLogoVariant(idx) {
      localStorage.setItem('logoVariant', idx);
      if (currentUser && db) {
        db.collection('userSettings').doc(currentUser.uid).set({ logoVariant: idx }, { merge: true }).catch(() => {});
      }
      if (window.webkit?.messageHandlers?.setSharedData) {
        window.webkit.messageHandlers.setSharedData.postMessage({ logoVariant: idx });
      } else if (window.Capacitor?.getPlatform?.() === 'android') {
        window.Capacitor?.Plugins?.BipolarBearWidget?.setSharedData({ logoVariant: idx });
      }
    }

    // Restore on load
    applyLogoVariant(currentIndex);
    logoImg.style.cursor = 'pointer';

    // Logo hint — visibility controlled by _applyOnboardingGating (shown at step 4 only)
    const _logoHintText = document.getElementById('logoHintText');

    logoImg.addEventListener('click', () => {
      clearTimeout(resetTimer);
      clickCount++;

      // Update hint text during step 4 (logo hint active)
      const _logoHintEl = document.getElementById('logoHint');
      if (_logoHintEl && _logoHintEl.style.display !== 'none') {
        _logoHintEl.style.animation = 'none';
        _logoHintEl.style.opacity = '1';
        if (clickCount === 1 && _logoHintText) _logoHintText.textContent = _tr('home.logoHintAgain', 'Click me again!');
        else if (clickCount === 2 && _logoHintText) _logoHintText.textContent = _tr('home.logoHintAndAgain', 'and again…');
        else if (clickCount >= 3 && _logoHintText) _logoHintText.textContent = _tr('home.logoHintQuicker', 'tap quicker…');
      }

      logoImg.style.transition = 'transform 0.1s ease';
      logoImg.style.transform = 'scale(1.15) rotate(5deg)';
      setTimeout(() => { logoImg.style.transform = ''; logoImg.style.transition = ''; }, 120);

      if (clickCount === 5) {
        clickCount = 0;
        // Advance to step 6 (survival kit revealed) then trigger easter egg
        _advanceOnboardingStep(6);
        _doLogoCycle();
      } else {
        resetTimer = setTimeout(() => { clickCount = 0; }, 1500);
      }
    });

    // ── Logo 5-second tap+hold: skip or restart tutorial ──
    (function() {
      let _lpHoldTimer = null;
      let _lpProgress = null;

      function _cancelLogoHold() {
        clearTimeout(_lpHoldTimer);
        _lpHoldTimer = null;
        if (_lpProgress) { _lpProgress.remove(); _lpProgress = null; }
      }

      function _startLogoHold(e) {
        _cancelLogoHold();

        _lpHoldTimer = setTimeout(() => {
          _cancelLogoHold();
          const _step = _getOnboardingStep();
          if (_step >= 12) {
            // Confirm dock reset
            const _confirmOverlay = document.createElement('div');
            _confirmOverlay.innerHTML = `<div style="background:white;border-radius:20px;padding:24px 24px 20px;text-align:center;max-width:290px;width:calc(100vw - 64px);box-shadow:0 12px 48px rgba(0,0,0,0.25);">
              <div style="font-weight:800;font-size:1em;color:#333;margin-bottom:10px;">${_tr('home.resetDockTitle', 'Reset Dock?')}</div>
              <div style="font-size:0.88em;color:#666;line-height:1.55;margin-bottom:18px;">${_tr('home.resetDockBody', 'This will restore all hidden dock buttons back to their default positions.')}</div>
              <div style="display:flex;gap:10px;">
                <button id="_dockCancelBtn" style="flex:1;padding:11px;background:#f8f9fa;color:#495057;border:2px solid #e9ecef;border-radius:10px;font-weight:600;font-size:0.9em;cursor:pointer;">${_tr('common.cancel', 'Cancel')}</button>
                <button id="_dockConfirmBtn" style="flex:1;padding:11px;background:var(--brand-btn);color:white;border:none;border-radius:10px;font-weight:600;font-size:0.9em;cursor:pointer;">${_tr('home.resetDockConfirm', 'Reset')}</button>
              </div>
            </div>`;
            Object.assign(_confirmOverlay.style, {
              position:'fixed', inset:'0', display:'flex', alignItems:'center', justifyContent:'center',
              background:'rgba(0,0,0,0.55)', zIndex:'9999',
            });
            document.body.appendChild(_confirmOverlay);
            document.getElementById('_dockCancelBtn').addEventListener('click', () => _confirmOverlay.remove());
            document.getElementById('_dockConfirmBtn').addEventListener('click', () => {
              _confirmOverlay.remove();
              ['WaFabHidden','QuickNoteFabHidden','CoffeeFabHidden','FeedbackFabHidden','ReviewFabHidden','FabSlot_1','FabSlot_2','FabSlot_3','FabSlot_4'].forEach(k => BB.storage.remove(k));
              _applyOnboardingGating();
              const _t = document.createElement('div');
              Object.assign(_t.style, { position:'fixed', top:'calc(env(safe-area-inset-top,0px) + 12px)', left:'50%', transform:'translateX(-50%)', background:'var(--brand-primary)', color:'white', padding:'10px 20px', borderRadius:'20px', fontWeight:'700', fontSize:'0.9em', zIndex:'9999', whiteSpace:'nowrap', boxShadow:'0 4px 16px rgba(0,0,0,0.2)', pointerEvents:'none' });
              _t.textContent = _tr('home.toastDockReset', '✅ Dock reset');
              document.body.appendChild(_t);
              setTimeout(() => _t.remove(), 2000);
            });
          } else {
            // Skip tutorial — jump to step 12 and mark all tutorial flags as done
            BB.storage.remove('OnboardingStep');
            // Pre-set flags so _advanceOnboardingStep doesn't show the popup
            BB.storage.set('TutorialToastShown', '1');
            BB.storage.set('FabsUnlocked', '1');
            _advanceOnboardingStep(12);
            [
              'TutorialToastShown', 'WelcomeShown', 'SurvivalKitVisited',
              '_fmChooseMoodHintDone', '_fmMoodInfoCloseHintDone', '_fmMoodTipShown',
              'SettingsHintDone', 'CustomiseFormHintDone', 'CustomiseAdditionalHintDone',
              'CloseSettingsHintDone', 'AdvancedTutorialToastShown', 'MedHintDone',
              'MoodDefHintDone', 'PersonalHintDone',
            ].forEach(k => BB.storage.set(k, '1'));
            _applyOnboardingGating();
            const _t = document.createElement('div');
            Object.assign(_t.style, { position:'fixed', top:'calc(env(safe-area-inset-top,0px) + 12px)', left:'50%', transform:'translateX(-50%)', background:'var(--brand-primary)', color:'white', padding:'10px 20px', borderRadius:'20px', fontWeight:'700', fontSize:'0.9em', zIndex:'9999', whiteSpace:'nowrap', boxShadow:'0 4px 16px rgba(0,0,0,0.2)', pointerEvents:'none' });
            _t.textContent = _tr('home.toastTutorialSkipped', '✅ Tutorial skipped — enjoy the app!');
            document.body.appendChild(_t);
            setTimeout(() => _t.remove(), 2800);
          }
        }, 5000);
      }

      logoImg.addEventListener('touchstart', _startLogoHold, { passive: true });
      logoImg.addEventListener('touchend', _cancelLogoHold);
      logoImg.addEventListener('touchcancel', _cancelLogoHold);
      logoImg.addEventListener('mousedown', _startLogoHold);
      logoImg.addEventListener('mouseup', _cancelLogoHold);
      logoImg.addEventListener('mouseleave', _cancelLogoHold);
    })();

// ── BLOCK 3: today entry tick (does the user already have an entry today?) ──
// ── Entry status tick ──
    (function() {
      const useToday = localStorage.getItem('journalDefaultToday') === 'true';
      const target = new Date(); target.setHours(0, 0, 0, 0);
      if (!useToday) target.setDate(target.getDate() - 1);
      const toKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const targetKey = toKey(target);

      function setTickDone(done) {
        const tick = document.getElementById('journalEntryTick');
        if (tick) tick.setAttribute('data-done', done ? 'true' : 'false');
      }

      // 1. Check cached status written by journal.html on load
      try {
        const cached = JSON.parse(BB.storage.get('_entryStatus') || 'null');
        if (cached && cached.key === targetKey) { setTickDone(cached.done); return; }
      } catch(e) {}

      // 2. Fallback: scan guest entry:* localStorage keys
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith('entry:')) continue;
        try {
          const e = JSON.parse(localStorage.getItem(k) || '{}');
          if (e.date && toKey(new Date(e.date)) === targetKey) { setTickDone(true); return; }
        } catch(e) {}
      }
    })();

// ── BLOCK 3c: quick check-in bears + last-7-days mood strip ──
    (function() {
      // Every home load re-sends the native widget's 7-day dots, so a clear
      // done anywhere (logout, reset, PIN on) reaches the home screen too.
      try { BB.platform.syncWidgetMoods(); } catch (_) {}
      const card = document.getElementById('quickCheckin');
      if (!card) return;
      const MOODS = ['manic', 'elevated', 'stable', 'low', 'depressed'];
      // Same palette as the journal's entry list (moodColors in js/journal.js).
      const MOOD_COLORS = { manic: '#ff6b6b', elevated: '#d2be00', stable: '#51cf66', low: '#845ef7', depressed: '#5c7cfa' };
      const toKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

      // BB.t, falling back to the English literal while a key is untranslated
      // (BB.t returns the key itself when it has no string for it).
      function qt(key, fallback, vars) {
        let s = null;
        try { s = (window.BB && window.BB.t) ? window.BB.t(key, vars) : null; } catch (_) {}
        if (s && s !== key) return s;
        let out = fallback;
        if (vars) Object.keys(vars).forEach(k => { out = out.split('{' + k + '}').join(vars[k]); });
        return out;
      }

      // Journal mood value → one of MOODS. Mirrors _moodCat() in js/journal.js:
      // 'good' is the legacy name for stable; numbers come from the 0–10 spectrum.
      function moodCat(m) {
        if (m == null || m === '') return null;
        if (typeof m === 'number' || /^\d+(\.\d+)?$/.test(String(m))) {
          const n = Number(m);
          if (n <= 1) return 'depressed';
          if (n <= 3) return 'low';
          if (n <= 6) return 'stable';
          if (n <= 8) return 'elevated';
          return 'manic';
        }
        if (m === 'good') return 'stable';
        return MOODS.indexOf(m) >= 0 ? m : null;
      }

      // Which day the journal is asking about: yesterday by default, today when
      // "journalDefaultToday" is on (same rule as BLOCK 3 and journal.html).
      function targetDate() {
        const d = new Date(); d.setHours(0, 0, 0, 0);
        if (localStorage.getItem('journalDefaultToday') !== 'true') d.setDate(d.getDate() - 1);
        return d;
      }

      // Day key → mood category, from data already on this device. Never
      // decrypts: guest entries saved as plaintext `entry:<ts>` JSON carry a
      // mood; PIN-encrypted ones (`_enc`) are skipped. Signed-in entries live
      // only in Firestore (encrypted) unless the journal has left a
      // `bb_recentMoods` map ({"YYYY-MM-DD": mood}) behind — read if present.
      function localMoodsByDay() {
        const byDay = {};
        const stamp = {};
        try {
          // Belt and braces: the journal never leaves the map behind with
          // incognito or a PIN on (this screen paints before the unlock), but
          // a setting synced from another device may not have reached it yet.
          const blocked = localStorage.getItem('incognitoMode') === 'true'
            || BB.storage.get('NativePinEnabled') === '1' || !!BB.storage.get('GuestPinSalt');
          if (blocked) BB.storage.remove('_recentMoods');
          const cached = blocked ? null : JSON.parse(BB.storage.get('_recentMoods') || 'null');
          if (cached && typeof cached === 'object') {
            Object.keys(cached).forEach(k => {
              const c = moodCat(cached[k]);
              if (c && /^\d{4}-\d{2}-\d{2}$/.test(k)) { byDay[k] = c; stamp[k] = 0; }
            });
          }
        } catch (_) {}
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || k.indexOf('entry:') !== 0) continue;
          try {
            const e = JSON.parse(localStorage.getItem(k) || 'null');
            if (!e || e._enc || !e.date) continue;
            const c = moodCat(e.mood);
            if (!c) continue;
            const day = toKey(new Date(e.date));
            const ts = Number(e.timestamp) || Number(k.slice(6)) || 0;
            if (!(day in stamp) || ts >= stamp[day]) { byDay[day] = c; stamp[day] = ts; }
          } catch (_) {}
        }
        return byDay;
      }

      function weekdayFmt(style) {
        let lang = 'en';
        try { lang = (window.BB && BB.i18n && BB.i18n.getLang && BB.i18n.getLang()) || 'en'; } catch (_) {}
        if (lang === 'zh') lang = 'zh-Hans';
        try { return new Intl.DateTimeFormat(lang, { weekday: style }); }
        catch (_) { return new Intl.DateTimeFormat('en', { weekday: style }); }
      }

      // "🔥 797  💬 63" on the right of the "Last 7 days" line, as the
      // home-screen widget shows it: the journal streak, then the Bipolar
      // Anonymous visit streak (💬, as on the Anonymous badge), each only
      // when it is live. Refreshed by _updateStreakBadge too.
      function qcWeekStreaks() {
        const journal = parseInt(BB.storage.get('CurrentStreak') || '0', 10);
        // Only while the Bipolar Anonymous button is on the home page.
        const anon = BB.anonButtonShown() ? BB.anonLiveStreak() : 0;
        return (journal > 0 ? '<span>🔥 ' + journal + '</span>' : '') +
               (anon > 0 ? '<span>💬 ' + anon + '</span>' : '');
      }
      window.BB._qcWeekStreaks = qcWeekStreaks;

      function renderWeek() {
        const btn = document.getElementById('qcWeek');
        if (!btn) return;
        const byDay = localMoodsByDay();
        const end = targetDate();
        const days = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(end); d.setDate(d.getDate() - i);
          days.push({ d, mood: byDay[toKey(d)] || null });
        }
        if (!days.some(x => x.mood)) { btn.style.display = 'none'; btn.innerHTML = ''; return; }
        const narrow = weekdayFmt('narrow');
        const long = weekdayFmt('long');
        const moodName = c => qt('mood.' + c, c.charAt(0).toUpperCase() + c.slice(1));
        const noEntry = qt('home.quick.noEntry', 'No entry');
        const spoken = days.map(x => qt('home.quick.dayMood', '{day}: {mood}',
          { day: long.format(x.d), mood: x.mood ? moodName(x.mood) : noEntry })).join(', ');
        btn.setAttribute('aria-label', qt('home.quick.weekLabel', 'Last 7 days — open Mood Journal') + '. ' + spoken);
        btn.innerHTML =
          '<span class="qc-week-head" aria-hidden="true">' +
            '<span class="qc-week-title">' + _escHtml(qt('home.quick.last7', 'Last 7 days')) + '</span>' +
            '<span class="qc-week-streaks">' + qcWeekStreaks() + '</span>' +
          '</span>' +
          '<span class="qc-week-days" aria-hidden="true">' + days.map(x =>
            '<span class="qc-day">' +
              '<span class="qc-dot' + (x.mood ? '' : ' qc-dot-empty') + '"' +
                (x.mood ? ' style="background:' + MOOD_COLORS[x.mood] + '"' : '') + '></span>' +
              '<span class="qc-wd">' + _escHtml(narrow.format(x.d)) + '</span>' +
            '</span>').join('') +
          '</span>';
        btn.style.display = '';
      }

      function render() {
        const useToday = localStorage.getItem('journalDefaultToday') === 'true';
        const prompt = document.getElementById('qcPrompt');
        if (prompt) {
          const k = useToday ? 'journal.prompt.howToday' : 'journal.prompt.howYesterday';
          prompt.setAttribute('data-i18n', k);
          prompt.textContent = qt(k, useToday ? 'How is today going?' : 'How was yesterday?');
        }
        const tick = document.getElementById('journalEntryTick');
        const done = !!(tick && tick.getAttribute('data-done') === 'true');
        card.setAttribute('data-done', done ? 'true' : 'false');
        const note = document.getElementById('qcDoneNote');
        if (note) note.textContent = done
          ? (useToday ? qt('home.quick.doneToday', '✓ Today is logged — nice one')
                      : qt('home.quick.doneYesterday', '✓ Yesterday is logged — nice one'))
          : '';
        // Mood names double as the bears' accessible names.
        card.querySelectorAll('.qc-bear').forEach(b => {
          const m = b.getAttribute('data-mood');
          b.setAttribute('aria-label', qt('mood.' + m, m));
          b.tabIndex = done ? -1 : 0;
        });
        renderWeek();
      }

      // Visibility follows onboarding: hidden during the first-run steps 0–3
      // (the journal's own first-entry tutorial runs from the Mood Journal
      // button), shown to everyone past it — i.e. whenever the Mood Journal
      // button is the normal home button. Called from _applyOnboardingGating.
      // Opt-in (Profile → Customise → Quick check-in). When shown, the card
      // takes the Mood Journal button's place: the button's container is hidden
      // and its streak line moves to sit under the card, so "Show stats" still
      // puts the figures under whatever the journal's home entry point is.
      const journalBox = document.getElementById('journalContainer');
      const streakBadge = document.getElementById('journalStreakBadge');
      window._renderQuickCheckin = function () {
        let step = 12;
        try { step = window.BB.onboarding.getStep(); } catch (_) {}
        const on = step >= 4 && BB.storage.get('HomeQuickCheckin') === '1';
        card.style.display = on ? '' : 'none';
        if (journalBox) journalBox.style.display = on ? 'none' : '';
        if (streakBadge) {
          if (on && streakBadge.previousElementSibling !== card) card.after(streakBadge);
          else if (!on && journalBox && streakBadge.parentElement !== journalBox) journalBox.appendChild(streakBadge);
        }
        if (on) render();
      };

      let navigating = false;
      card.addEventListener('click', function (ev) {
        const bear = ev.target.closest && ev.target.closest('.qc-bear');
        const week = ev.target.closest && (ev.target.closest('#qcWeek') || ev.target.closest('#qcOpen'));
        if (!bear && !week) return;
        if (navigating) return;
        if (bear && card.getAttribute('data-done') === 'true') return;
        navigating = true;
        // Same side-effects as the Mood Journal button.
        try { localStorage.setItem('bbPrivacyNoteDismissed', '1'); } catch (_) {}
        const pn = document.getElementById('privacyNote'); if (pn) pn.style.display = 'none';
        let url = 'journal.html';
        if (bear) {
          const mood = bear.getAttribute('data-mood');
          if (MOODS.indexOf(mood) >= 0) url = 'journal.html?mood=' + encodeURIComponent(mood);
          bear.classList.add('qc-picked');
          card.classList.add('qc-leaving');
          // Light tap on native (Capacitor's bundled Haptics plugin); no-op on web.
          try {
            const H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
            if (H && H.impact) H.impact({ style: 'LIGHT' }).catch(function () {});
          } catch (_) {}
        }
        // Let the press animation read before the page swaps.
        setTimeout(function () { location.replace(url); }, bear ? 180 : 0);
      });
      // Back-forward cache: a restored page must be tappable again.
      window.addEventListener('pageshow', function () {
        navigating = false;
        card.classList.remove('qc-leaving');
        card.querySelectorAll('.qc-picked').forEach(b => b.classList.remove('qc-picked'));
      });

      // The ✓ on the Mood Journal button is corrected asynchronously (Firestore
      // reconcile in BLOCK 2) — follow it so the row goes quiet the moment it flips.
      const tick = document.getElementById('journalEntryTick');
      if (tick && window.MutationObserver) {
        new MutationObserver(function () { if (card.style.display !== 'none') render(); })
          .observe(tick, { attributes: true, attributeFilter: ['data-done'] });
      }
      document.addEventListener('bb:languagechange', function () { if (card.style.display !== 'none') render(); });

      window._renderQuickCheckin();
    })();

// ── BLOCK 3b: Bipolar Anonymous tick — posted today OR board all read ──
    (function() {
      // The tick means "nothing outstanding on the board". Two ways to earn it:
      //   - posted today (bbAnon_lastPostDate)
      //   - all caught up: no unread posts since the last board visit
      //     (bbAnon_allRead, cached by _refreshAnonMessagesBadge in BLOCK 2)
      // Reading everything is the common case — the badge says "✓ No new
      // messages" — so gating the tick on posting alone left it permanently
      // dashed for anyone who reads the board without posting.
      // Exposed on window so BLOCK 2's async Firestore callbacks can repaint it
      // once the live counts land.
      window._refreshAnonTick = function () {
        const tick = document.getElementById('anonEntryTick');
        if (!tick) return;
        const d = new Date();
        const todayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const postedToday = BB.storage.get('Anon_lastPostDate') === todayKey;
        const allRead     = BB.storage.get('Anon_allRead') === '1';
        tick.setAttribute('data-done', (postedToday || allRead) ? 'true' : 'false');
      };
      window._refreshAnonTick();
    })();

// ── BLOCK 4: survival-kit completion tick ──
// ── Survival Kit setup tick ──
    (function() {
      const tick = document.getElementById('survivalTick');
      if (!tick) return;

      function check() {
        try {
          const defs = JSON.parse(localStorage.getItem('moodDefinitions') || '{}');
          if (!Object.values(defs).some(v => v && String(v).trim())) return false;
        } catch(e) { return false; }
        try {
          const strats = JSON.parse(localStorage.getItem('copingStrategies') || '{}');
          if (!Object.values(strats).some(arr => Array.isArray(arr) && arr.length > 0)) return false;
        } catch(e) { return false; }
        try {
          const meds = JSON.parse(localStorage.getItem('currentMedList') || '[]');
          if (!Array.isArray(meds) || meds.length === 0) return false;
        } catch(e) { return false; }
        try {
          const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
          if (!Array.isArray(goals) || goals.length === 0) return false;
        } catch(e) { return false; }
        return true;
      }

      tick.setAttribute('data-done', check() ? 'true' : 'false');

      // Survival kit progress counter. Exposed (not just run inline) because the
      // survival-kit keys arrive asynchronously from Firestore on a freshly
      // signed-in device — the auth listener re-runs this once they've landed so
      // the count doesn't sit at 7 / 12 until the user visits survival-kit.html
      // and comes back.
      window._updateSurvivalProgress = function () {
        const _prog = document.getElementById('survivalProgress');
        if (!_prog) return;
        const _arr = k => { try { const v = JSON.parse(localStorage.getItem(k)||'[]'); return Array.isArray(v) && v.length > 0; } catch(e){ return false; } };
        const _obj = k => { try { const v = JSON.parse(localStorage.getItem(k)||'{}'); return Object.values(v).some(a => Array.isArray(a) && a.length > 0); } catch(e){ return false; } };
        let _c = 4; // mood-scale, books, media, spiritual — always complete
        if (_arr('currentMedList')) _c++;
        if (_arr('dailyGoals')) _c++;
        if (_arr('survivalGratitude')) _c++;
        const _rt = localStorage.getItem('rememberThis'); if (_rt && _rt.trim()) _c++;
        if (_obj('copingStrategies')) _c++;
        if (_obj('moodMemories')) _c++;
        if (_arr('myCommitments')) _c++;
        if (_arr('customReminders')) _c++;
        _prog.textContent = _c >= 12
          ? _tr('home.survivalAllDone', '✓ All sections completed')
          : _tr('home.survivalProgress', _c + ' / 12 sections complete', { c: _c });
        _revealBadge(_prog, 'block');
      };
      window._updateSurvivalProgress();
    })();

// ── BLOCK 5: celebration confetti + toast ──
// ── Celebration confetti + toast (three states) ──
    (function() {
      const journalTick  = document.getElementById('journalEntryTick');
      const survivalTick = document.getElementById('survivalTick');

      function isDone(el) { return el && el.getAttribute('data-done') === 'true'; }

      // Inject confetti keyframe once
      const _cfStyle = document.createElement('style');
      _cfStyle.textContent = `@keyframes bbConfettiFall {
        0%   { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
        80%  { opacity: 1; }
        100% { transform: translateY(105vh) rotate(720deg) scale(0.8); opacity: 0; }
      }`;
      document.head.appendChild(_cfStyle);

      function launchConfetti(count, colors) {
        for (let i = 0; i < count; i++) {
          const el = document.createElement('div');
          const color = colors[Math.floor(Math.random() * colors.length)];
          const w = 6 + Math.random() * 8;
          const h = Math.random() > 0.5 ? w : w * 0.45;
          const x = Math.random() * 100;
          const delay = Math.random() * 1.4;
          const dur = 2.2 + Math.random() * 1.8;
          Object.assign(el.style, {
            position: 'fixed', top: '-12px', left: `${x}vw`,
            width: `${w}px`, height: `${h}px`, background: color,
            borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            zIndex: '9998', pointerEvents: 'none',
            animation: `bbConfettiFall ${dur}s ${delay}s ease-in forwards`,
          });
          document.body.appendChild(el);
          setTimeout(() => el.remove(), (dur + delay + 0.5) * 1000);
        }
      }

      function showToast(msg, bg) {
        const t = document.createElement('div');
        Object.assign(t.style, {
          position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 10px)', left: '50%',
          transform: 'translateX(-50%) translateY(-12px)',
          background: bg, color: 'white',
          padding: '10px 20px', borderRadius: '20px',
          fontWeight: '700', fontSize: '0.95em',
          boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
          whiteSpace: 'nowrap', zIndex: '9999', pointerEvents: 'none',
          animation: 'bbCelebToast 3.2s ease forwards',
        });
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3400);
      }

      function _doLogoCycle() {
        currentIndex = (currentIndex + 1) % srcs.length;
        saveLogoVariant(currentIndex);
        // Mark easter egg found on first discovery
        const _firstFind = !BB.storage.get('LogoEasterEggFound');
        if (_firstFind) BB.storage.set('LogoEasterEggFound', '1');
        // Sync app icon (native only)
        try {
          if (window.webkit?.messageHandlers?.setAppIcon) {
            const _iconNames = [null, 'AppIcon_Happy', 'AppIcon_Sad'];
            window.webkit.messageHandlers.setAppIcon.postMessage({ name: _iconNames[currentIndex] || null });
          }
        } catch(e) {}
        // Animate logo swap
        logoImg.style.transition = 'transform 0.4s ease, opacity 0.3s ease';
        logoImg.style.transform = 'scale(0) rotate(180deg)';
        logoImg.style.opacity = '0';
        setTimeout(() => {
          logoImg.src = srcs[currentIndex];
          logoImg.style.transform = 'scale(1.2) rotate(-5deg)';
          logoImg.style.opacity = '1';
          setTimeout(() => {
            logoImg.style.transition = '';
            logoImg.style.transform = '';
            // Celebration
            launchConfetti(18, ['var(--brand-primary)', 'var(--brand-primary-dark)', '#ffd43b', '#ffffff', '#ff8c42']);
            if (_firstFind) showToast(_tr('home.toastEasterEgg', '🎨 Easter egg found!'), 'var(--brand-primary)');
          }, 200);
        }, 300);
      }

      const _journalColors  = ['var(--brand-primary)','var(--brand-primary-dark)','#ffd43b','#ffec99','#ff8c42','#fab005'];
      const _survivalColors = ['#51cf66','#339af0','#20c997','#74c0fc','#63e6be','#4dabf7'];
      const _bothColors     = ['var(--brand-primary)','var(--brand-primary-dark)','#51cf66','#339af0','#f06595','#ffd43b','#a9e34b','#cc5de8'];

      // Survival toast fires only once ever (localStorage); journal + combined fire every launch
      let _bothFired = false;

      function _fire(type) {
        if (type === 'both') {
          if (_bothFired) return;
          _bothFired = true;
          launchConfetti(90, _bothColors);
          showToast(_tr('home.toastAllDone', '🎉 All done today — great work!'), 'linear-gradient(135deg,var(--brand-primary-light),var(--brand-primary-mid))');
        } else if (type === 'journal') {
          if (_bothFired) return; // combined already fired, skip individual
          launchConfetti(45, _journalColors);
          showToast(_tr('home.toastJournalUpToDate', '📔 Journal up to date!'), 'linear-gradient(135deg,var(--brand-primary-light),var(--brand-primary-mid))');
        } else if (type === 'survival') {
          if (BB.storage.get('SurvivalCelebDone') === '1') return;
          BB.storage.set('SurvivalCelebDone', '1');
          launchConfetti(45, _survivalColors);
          showToast(_tr('home.toastSurvivalFilled', '🆘 Survival kit filled in!'), 'linear-gradient(135deg,var(--brand-primary-light),var(--brand-primary-mid))');
        }
      }

      function celebrate(changed) {
        const jDone = isDone(journalTick);
        const sDone = isDone(survivalTick);
        if (jDone && sDone) { _fire('both'); }
        else if (jDone && (changed === journalTick || changed === null)) { _fire('journal'); }
        else if (sDone && (changed === survivalTick || changed === null)) { _fire('survival'); }
      }

      // Check sync state immediately (ticks already set by earlier scripts)
      celebrate(null);

      // Also watch for async tick updates (Firestore path)
      const obs = new MutationObserver(mutations => {
        mutations.forEach(m => { if (m.attributeName === 'data-done') celebrate(m.target); });
      });
      if (journalTick)  obs.observe(journalTick,  { attributes: true, attributeFilter: ['data-done'] });
      if (survivalTick) obs.observe(survivalTick, { attributes: true, attributeFilter: ['data-done'] });
      setTimeout(() => obs.disconnect(), 10000);

      // Expose logo cycle globally so click handler (in earlier script block) can call it
      window._doLogoCycle = _doLogoCycle;
    })();

// ── BLOCK 6: WhatsApp button bootstrap on native shell ──
// Show WhatsApp button only in native app
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      document.body.classList.add('is-native');
    }

    // Handle widget deep link — bipolarbear://journal opens journal page directly
    (function() {
      const App = window.Capacitor?.Plugins?.App;
      if (!App) return;
      App.addListener('appUrlOpen', function(data) {
        if (data && data.url && data.url.includes('journal')) {
          location.replace('journal.html');
        }
      });
    })();

// ── BLOCK 7: navigation handlers + onboarding-step advance helpers ──
function _handleIndexJournalNav() {
      _advanceOnboardingStep(8);
      location.replace('journal.html');
    }
    window._handleIndexJournalNav = _handleIndexJournalNav;

    function _getFbPlatform() {
      if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
        return /android/i.test(navigator.userAgent) ? 'Android' : 'iOS';
      }
      return 'Web';
    }

    function openWhatsAppModal() {
      document.getElementById('waModal').classList.add('active');
      const _ov = document.getElementById('bbHintOverlay');
      if (_ov) _ov.style.display = 'none';
    }
    function _closeWaModal() {
      document.getElementById('waModal').classList.remove('active');
      _advanceOnboardingStep(10);
    }
    window.openWhatsAppModal = openWhatsAppModal;

    // Hook called by fab.js closeFabFeedback — advance onboarding and enable focus mode
    window._onFabFeedbackClose = function () {
      localStorage.setItem('focusedModeEnabled', '1');
      _advanceOnboardingStep(12);
    };

    // Auto-open feedback modal if navigated here with #feedback hash
    if (window.location.hash === '#feedback') {
      history.replaceState(null, '', window.location.pathname);
      window.addEventListener('load', () => setTimeout(openFabFeedback, 300));
    }

    // ── Apply onboarding gating on page load ──
    _applyOnboardingGating();

    // ── Welcome popup (first-ever launch) ──
    function _showWelcomePopup() {
      if (document.getElementById('bbWelcomeModal')) return;
      const overlay = document.createElement('div');
      overlay.id = 'bbWelcomeModal';
      overlay.innerHTML = `<div style="background:linear-gradient(135deg,var(--brand-primary-mid),var(--brand-primary-light));border-radius:20px;padding:28px 28px 24px;text-align:center;max-width:300px;width:calc(100vw - 64px);box-shadow:0 12px 48px rgba(255,107,0,0.55);">
        <div style="font-size:2.4em;margin-bottom:10px;">🐻</div>
        <div style="font-weight:800;font-size:1.05em;color:white;margin-bottom:10px;line-height:1.4;">${_tr('home.welcomeTitle', 'Welcome to your BipolarBear.app!')}</div>
        <div style="font-size:0.88em;color:rgba(255,255,255,0.92);line-height:1.55;margin-bottom:18px;">${_tr('home.welcomeBody', "This will be your mood journal and personalised survival kit going forward. I'm here to help you get started. Let's go!")}</div>
        <div style="font-size:0.78em;color:rgba(255,255,255,0.65);">${_tr('home.tapDismiss', 'Tap to dismiss')}</div>
      </div>`;
      Object.assign(overlay.style, {
        position:'fixed', inset:'0', display:'flex', alignItems:'center', justifyContent:'center',
        background:'rgba(0,0,0,0.6)', zIndex:'9999', cursor:'pointer',
      });
      overlay.addEventListener('click', () => {
        overlay.remove();
        BB.storage.set('WelcomeShown', '1');
      });
      document.body.appendChild(overlay);
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.3s ease';
      requestAnimationFrame(() => { overlay.style.opacity = '1'; });
    }

    // Show welcome popup only on first launch AND only for new users (step 0, no entries)
    if (!BB.storage.get('WelcomeShown') && _getOnboardingStep() === 0 && !BB.storage.get('HasEntries')) {
      setTimeout(_showWelcomePopup, 600);
    }

    // Steps 9 and 10 (WA/feedback hints) removed from tutorial — auto-advance to 12 on all platforms.
    // Also: complete tutorial automatically once the user has saved their first journal entry.
    (function() {
      const _s = _getOnboardingStep();
      if (_s === 10) {
        _advanceOnboardingStep(12);
        if (BB.storage.get('TutorialToastShown') !== '1') {
          BB.storage.set('TutorialToastShown', '1');
          setTimeout(_showTutorialFinale, 400);
        }
      } else if (_s >= 4 && _s < 12 && BB.storage.get('HasEntries') === '1') {
        // User has logged their first entry and returned to home — mark tutorial complete
        _advanceOnboardingStep(12);
      }
    })();

    // ── What's New popup ──
    // window._APP_VERSION is set in js/shared/brand-config.js so every page
    // (and fab.js) reads the same value without depending on this script.
    const _APP_VERSION = window._APP_VERSION;
    const _WHATS_NEW_HEADLINES = {
      '1.37': 'Bipolar Bear is now part of the UNI·SIM suite — tap the community count to see how many people use UNI·SIM apps. Bipolar Anonymous now shows posts in your language.',
      '1.36': 'Opening the app no longer flashes “signed out” while your session loads, and yesterday’s entry can now be filled from your health data in one tap.',
      '1.35': 'The iPhone home-screen widget now updates as soon as you log — it no longer gets stuck on "Yesterday needs logging", and it resets properly at midnight.',
      '1.34': 'Missed a few days? The journal can now fill the gaps in one go from your health data and recent entries — each clearly marked as an estimate. And the Bipolar Anonymous board can now notify you about new posts, replies and announcements, without ever showing what anyone wrote.',
      '1.33': 'The home screen now shows how many people use Bipolar Bear and how many are using it right now, and the Bipolar Anonymous board does the same for its members. The live figure is an anonymous heartbeat that expires after two minutes — it stores nothing about who you are.',
      '1.32': 'Bipolar Bear now shows how many people are using it, just above the credit on the home screen — and the Bipolar Anonymous board shows how many members the community has, at the top of the board.',
      '1.25': 'New Full Mood Spectrum option: track your mood on a 0–10 scale by spinning a wheel or sliding, instead of the five fixed moods (turn it on under Advanced → Journal Options). Plus a cleaner classic journal form — tidier energy, sleep and medication rows.',
      '1.24': 'A round of polish: the medication step now starts on "Taken", the home screen shows a tick when you’ve posted on Bipolar Anonymous today, and the community board is clearer — admins post as "Bipolar Bear Admin" and a new About-screen guide explains every post-action button',
      '1.23': 'The medication and sleep-quality steps look cleaner — the spinner now shows just the answers, without the repeated options that used to appear on either side',
      '1.21': 'The medication step now has an "🤷 Unsure" answer in the middle, for the nights you can’t quite remember',
      '1.20': 'Another go at the medication and sleep-quality steps — the wheels are rebuilt to spin exactly like the mood and energy ones',
      '1.19': 'Swiping the medication and sleep-quality steps now works properly — the shorter wheels spin just like the mood and energy ones',
      '1.18': 'Two journal fixes: swiping the medication step now works properly, and the first step no longer opens with an awkward gap above the question',
      '1.17': 'The journal has a whole new feel — full-screen steps with a spinner wheel, big animated emoji, Apple Health readouts like "7h 32m · synced", a smart mood suggestion from your sleep + steps, and a fresh rounded look across the app',
      '1.14': 'Your Survival Kit now unlocks automatically at the end of the tutorial, Apple Health sync has moved into Advanced settings, and the journal Open/Close button label is fixed',
      '1.11': 'Community: mute anyone on the Anonymous board with the new 🙈 button (unmute from the About screen), plus clearer Apple Health / Health Connect labels in journal settings',
      '1.09': 'Smoother permissions — notification and health-sync access is now only requested when you switch each one on, with a more reliable Apple Health reconnection after reinstalling',
      '1.4': 'New 📖 Wiki tab on the Anonymous board — Medications, Conditions, Therapies, Lifestyle, Warning Signs, Hospital, Workplace, Pregnancy, For Loved Ones, and more, with inline search',
      '1.3': 'Security: hardened the Bipolar Anonymous email-code verification and post-rendering ahead of opening up the codebase',
      '1.2': 'Settings & sign-in button now appears after your first journal entry — no need to finish the tutorial first',
      '1.1': 'Signing in to Bipolar Anonymous with your BipolarBear email now automatically imports your stability streak and account birthday',
      '1.0': 'Signed-out home no longer shows the previous account’s stats, and signed-in users skip the guest PIN gate',
      '0.98': 'Streaks, achievements & FAB dock now sync across your devices when you sign in',
      '0.97': 'Reminders & weekly summary now save instantly and sync across your devices',
      '0.89': 'Sign in & account management now shared across all pages — one place for everything',
      '0.88': 'FAB dock buttons updated to a softer look',
      '0.87': "What's new popup — see new features at a glance every update",
      '0.86': 'Dock buttons can now be hidden and re-added — tap + to customise your dock',
      '0.85': 'Full dock synced across all pages — same buttons everywhere',
      '0.84': 'Survival kit compass removed from tutorial for a smoother experience',
    };
    function _checkWhatsNew() {
      const lastSeen = BB.storage.get('LastSeenVersion');
      if (lastSeen === _APP_VERSION) return;
      const step = _getOnboardingStep();
      if (step < 12 || BB.storage.get('TutorialToastShown') !== '1') return;
      // Don't show if tutorial complete popup is still on screen, or while
      // the tutorial-finale account hint is blocking the page
      if (document.getElementById('tutorialCompleteModal')) return;
      if (window._bbAccountHintActive) return;
      const headline = _WHATS_NEW_HEADLINES[_APP_VERSION];
      if (!headline) return;
      const popup = document.getElementById('whatsNewPopup');
      const vEl = document.getElementById('whatsNewVersion');
      const hEl = document.getElementById('whatsNewHeadline');
      if (!popup) return;
      if (vEl) vEl.textContent = "What's new · v" + _APP_VERSION;
      if (hEl) hEl.textContent = headline;
      popup.style.display = 'block';
      // Mark as seen immediately so navigating away doesn't re-show it
      BB.storage.set('LastSeenVersion', _APP_VERSION);
    }
    function _dismissWhatsNew() {
      BB.storage.set('LastSeenVersion', _APP_VERSION);
      const popup = document.getElementById('whatsNewPopup');
      if (popup) popup.style.display = 'none';
    }
    function _openFullChangelog() {
      _dismissWhatsNew();
      window.location.href = 'journal.html?openChangelog=1';
    }
    window._dismissWhatsNew = _dismissWhatsNew;
    window._openFullChangelog = _openFullChangelog;
    // Fire after a short delay so the page renders first
    setTimeout(_checkWhatsNew, 800);

// ── BLOCK 8: PIN lock overlay (guest encryption PIN or native logged-in PIN) ──
// ── App-wide PIN lock (guest encryption PIN or native logged-in PIN) ──
    // Deferred to DOMContentLoaded: this script tag sits ABOVE the
    // #guestPinOverlay markup in index.html, so at parse time
    // getElementById returns null. Running inline threw a TypeError for any
    // locked guest, which both suppressed the PIN unlock (journal.html then
    // bounced every visit straight back to an unlockable home screen) and
    // killed every top-level statement after this block.
    // ?mood= carried through journal.html's PIN gate: a bear tapped on home
    // or on the native widget while the app was locked lands here as
    // index.html?mood=<mood>. Read it once and strip it from the URL straight
    // away (so a reload never replays it); _initPinLock keeps it only while
    // the PIN overlay is actually up, and _afterPinUnlock() forwards to the
    // journal with it. With no PIN gate it is simply dropped.
    var _pinPendingMood = (function () {
      try {
        const p = new URLSearchParams(location.search);
        if (!p.has('mood')) return null;
        const m = String(p.get('mood') || '').trim().toLowerCase();
        p.delete('mood');
        const qs = p.toString();
        history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
        return ['manic', 'elevated', 'stable', 'low', 'depressed'].indexOf(m) >= 0 ? m : null;
      } catch (_) { return null; }
    })();

    // Called on every successful unlock (native PIN, guest PIN, native PIN
    // turned off via "Forgot PIN"). Returns true when it navigated away.
    function _afterPinUnlock() {
      const mood = _pinPendingMood;
      _pinPendingMood = null;
      if (!mood) return false;
      location.replace('journal.html?mood=' + encodeURIComponent(mood));
      return true;
    }

    function _initPinLock() {
      const _isNat = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
      // Signed-in users use account-derived encryption, not the guest PIN —
      // a stale bbGuestPinSalt from a pre-sign-in guest session shouldn't
      // gate them out of the home screen with an unenterable PIN dialog.
      // The native app PIN (bbNativePinEnabled) is independent and still
      // applies even when signed in.
      const hasGuestPin = !_hasCachedFbUser() && !!BB.storage.get('GuestPinSalt');
      const hasNativePin = _isNat && BB.storage.get('NativePinEnabled') === '1';
      if (!hasGuestPin && !hasNativePin) { _pinPendingMood = null; return; }

      const unlocked = sessionStorage.getItem('bbPinUnlocked') === '1';
      if (unlocked) _pinPendingMood = null;
      if (!unlocked) {
        const _pinOv = document.getElementById('guestPinOverlay');
        if (_pinOv) _pinOv.style.display = 'flex';
      }

      // A lockout from wrong PINs survives a reload — show its countdown.
      if (!unlocked && window.BB && BB.pin) BB.pin.guard(document.getElementById('idxPinError'));

      function _relock() {
        sessionStorage.removeItem('bbPinUnlocked');
        sessionStorage.removeItem('bb_guest_key');
        _idxPinBuf = '';
        _idxRenderDots(0);
        document.getElementById('idxPinError').textContent = '';
        document.getElementById('guestPinOverlay').style.display = 'flex';
        if (window.BB && BB.pin) BB.pin.guard(document.getElementById('idxPinError'));
      }

      // Inactivity relock after 5 minutes
      let _idleTimer;
      function _resetIdleTimer() {
        clearTimeout(_idleTimer);
        _idleTimer = setTimeout(_relock, 5 * 60 * 1000);
      }
      ['touchstart', 'mousedown', 'keydown', 'scroll'].forEach(ev =>
        document.addEventListener(ev, _resetIdleTimer, { passive: true })
      );
      if (unlocked) _resetIdleTimer(); // only start timer if currently unlocked

      // …and when the app / tab comes back after more than a minute away.
      if (window.BB && BB.pin) {
        BB.pin.watchBackground({
          applies: () => sessionStorage.getItem('bbPinUnlocked') === '1'
            && ((!_hasCachedFbUser() && !!BB.storage.get('GuestPinSalt'))
              || (_isNat && BB.storage.get('NativePinEnabled') === '1')),
          relock: _relock,
        });
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _initPinLock);
    } else {
      _initPinLock();
    }

    let _idxPinBuf = '';

    function _idxRenderDots(filled) {
      document.querySelectorAll('.idx-pin-dot').forEach((d, i) => {
        d.style.background = i < filled ? 'white' : 'rgba(255,255,255,0.4)';
      });
    }

    // Wrong PIN: count it (5 in a row locks the keypad for a while, see
    // js/shared/pin-guard.js), say so, and clear the dots.
    function _idxPinWrong(msgKey, msgFallback, delay) {
      const errEl = document.getElementById('idxPinError');
      const locked = window.BB && BB.pin ? BB.pin.recordFailure() : 0;
      errEl.textContent = _tr(msgKey, msgFallback);
      setTimeout(() => {
        _idxPinBuf = '';
        _idxRenderDots(0);
        errEl.textContent = '';
        if (locked && window.BB && BB.pin) BB.pin.guard(errEl);
      }, delay || 800);
    }

    function _idxPinRight() {
      if (window.BB && BB.pin) BB.pin.clearFailures();
      sessionStorage.setItem('bbPinUnlocked', '1');
      if (_afterPinUnlock()) return;
      document.getElementById('guestPinOverlay').style.display = 'none';
    }

    async function idxPinKey(digit) {
      if (window.BB && BB.pin && BB.pin.guard(document.getElementById('idxPinError'))) return;
      if (_idxPinBuf.length >= 4) return;
      _idxPinBuf += digit;
      _idxRenderDots(_idxPinBuf.length);
      if (_idxPinBuf.length < 4) return;

      // Native logged-in PIN: verify against Keychain
      const _isNat = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
      if (_isNat && BB.storage.get('NativePinEnabled') === '1') {
        try {
          const _ss = window.Capacitor?.Plugins?.SecureStorage;
          const stored = _ss ? await Promise.race([
            _ss.getItem('bb_native_pin'),
            new Promise(r => setTimeout(() => r(null), 3000)),
          ]) : null;
          if (_idxPinBuf !== stored) { _idxPinWrong('pin.incorrect', 'Incorrect PIN. Try again.'); return; }
          _idxPinRight();
          return;
        } catch(e) {
          document.getElementById('idxPinError').textContent = _tr('pin.verifyFailed', 'Verification failed. Try again.');
          setTimeout(() => { _idxPinBuf = ''; _idxRenderDots(0); document.getElementById('idxPinError').textContent = ''; }, 1200);
          return;
        }
      }

      // Guest PIN: verify against the scrambled copy in localStorage (or, once,
      // the plain PIN older builds stored — replaced by a hash right here).
      const saved = BB.storage.get('PinCode');
      const entered = _idxPinBuf;
      let check = { ok: entered === saved, legacy: true };
      if (window.BB && BB.pin) {
        try { check = await BB.pin.verify(entered, saved); }
        catch (e) { _idxPinWrong('pin.verifyFailed', 'Verification failed. Try again.', 1200); return; }
      }
      if (!check.ok) { _idxPinWrong('pin.incorrect', 'Incorrect PIN. Try again.'); return; }
      if (check.legacy && window.BB && BB.pin) {
        try { BB.storage.set('PinCode', await BB.pin.hash(entered)); } catch (e) { /* keep the old copy; retried next unlock */ }
      }

      // Correct — derive key and store in session
      const salt = BB.storage.get('GuestPinSalt');
      if (salt) {
        try {
          const saltBytes = Uint8Array.from(atob(salt), c => c.charCodeAt(0));
          const keyMaterial = await crypto.subtle.importKey(
            'raw', new TextEncoder().encode(entered), { name: 'PBKDF2' }, false, ['deriveKey']
          );
          const key = await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
            keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
          );
          const raw = await crypto.subtle.exportKey('raw', key);
          sessionStorage.setItem('bb_guest_key', btoa(String.fromCharCode(...new Uint8Array(raw))));
        } catch(e) { console.error('PIN derive failed', e); }
      }
      _idxPinRight();
    }

    function idxPinDel() {
      if (_idxPinBuf.length === 0) return;
      _idxPinBuf = _idxPinBuf.slice(0, -1);
      _idxRenderDots(_idxPinBuf.length);
    }

    // ── PIN screen dimmer — saves battery when device left on lock screen ──
    (function() {
      const SLEEP_MS = 3 * 60 * 1000; // 3 minutes
      let _dimTimer = null;
      let _sleeping = false;

      function _startDimTimer() {
        clearTimeout(_dimTimer);
        const ov = document.getElementById('guestPinOverlay');
        if (!ov || ov.style.display === 'none') return;
        _dimTimer = setTimeout(_sleep, SLEEP_MS);
      }

      function _sleep() {
        if (_sleeping) return;
        _sleeping = true;
        const el = document.getElementById('pinSleepOverlay');
        if (!el) return;
        el.style.opacity = '0';
        el.style.transition = 'opacity 1.5s';
        el.style.display = 'flex';
        requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
      }

      window._wakePinDimmer = function() {
        clearTimeout(_dimTimer);
        if (_sleeping) {
          _sleeping = false;
          const el = document.getElementById('pinSleepOverlay');
          if (el) {
            el.style.opacity = '0';
            setTimeout(() => { el.style.display = 'none'; }, 1500);
          }
        }
        _startDimTimer();
      };

      // Watch the PIN overlay for show/hide to start/stop the timer.
      // Deferred to DOMContentLoaded — this script runs above the overlay
      // markup, so a parse-time getElementById would come back null and the
      // dimmer would silently never attach.
      function _wireDimmer() {
        const _ov = document.getElementById('guestPinOverlay');
        if (!_ov) return;
        new MutationObserver(() => {
          if (_ov.style.display !== 'none') {
            _startDimTimer();
          } else {
            clearTimeout(_dimTimer);
            if (_sleeping) window._wakePinDimmer();
          }
        }).observe(_ov, { attributes: true, attributeFilter: ['style'] });
        // Start immediately if overlay is already visible on page load
        if (_ov.style.display === 'flex') _startDimTimer();

        // Any tap/key while PIN overlay is active resets the sleep timer
        ['touchstart', 'mousedown', 'keydown'].forEach(ev =>
          document.addEventListener(ev, () => {
            if (_ov.style.display === 'none') return;
            window._wakePinDimmer();
          }, { passive: true })
        );
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _wireDimmer);
      } else {
        _wireDimmer();
      }
    })();

    // _nukeGuestData / _confirmDeleteGuestData live in fab.js so the
    // "Delete all guest data" button in the shared auth modal works on
    // every page that loads fab.js, not just this one. Both are exposed
    // as window._nukeGuestData / window._confirmDeleteGuestData.

    async function idxPinForgot() {
      const _isNat = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
      if (_isNat && BB.storage.get('NativePinEnabled') === '1') {
        if (!confirm(_tr('pin.disableConfirm', 'This will disable the app PIN. Your journal data stays safe.\n\nContinue?'))) return;
        BB.storage.remove('NativePinEnabled');
        await (window.Capacitor?.Plugins?.SecureStorage?.removeItem('bb_native_pin') ?? Promise.resolve()).catch(() => {});
        if (window.BB && BB.pin) BB.pin.clearFailures();
        sessionStorage.setItem('bbPinUnlocked', '1');
        if (_afterPinUnlock()) return;
        document.getElementById('guestPinOverlay').style.display = 'none';
        return;
      }
      // Guest PIN: full wipe (PIN is the encryption key — no recovery possible)
      if (!confirm(_tr('pin.resetConfirm1', 'Your PIN is the encryption key for your journal. Without it, your entries cannot be recovered.\n\nThis will permanently delete all your data and start fresh.\n\nAre you absolutely sure?'))) return;
      if (!confirm(_tr('pin.resetConfirm2', 'Last chance — all entries and data will be deleted. Continue?'))) return;
      window._nukeGuestData();
    }

    // Home greeting above the Mood Journal button: the Anonymous board's
    // time-of-day line (James, 2026-09-30), with a break after the first
    // sentence — "Hope your afternoon is going well." / "You're doing great. 💛".
    // Same hours as todaySystemPost() in js/anonymous.js.
    (function () {
      function _render() {
        const el = document.getElementById('homeGreeting');
        if (!el) return;
        const h = new Date().getHours();
        const key = h >= 5 && h < 12 ? 'greetMorning' : h >= 12 && h < 17 ? 'greetAfternoon' : h >= 17 && h < 21 ? 'greetEvening' : 'greetNight';
        const text = _tr('anon.feed.' + key, '');
        el.textContent = '';
        if (!text || text === 'anon.feed.' + key) return;
        const m = text.match(/^(.*?[.!?。！？])\s*(\S[\s\S]*)$/);
        const lines = m ? [m[1], m[2]] : [text];
        lines.forEach((line, i) => {
          if (i) el.appendChild(document.createElement('br'));
          el.appendChild(document.createTextNode(line));
        });
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _render); else _render();
      document.addEventListener('bb:languagechange', _render);
      // Keep it right if the app sits open across a greeting boundary.
      document.addEventListener('visibilitychange', () => { if (!document.hidden) _render(); });
    })();

// ── Offline: register the service worker from home too ──
// It used to be registered only by the journal and Survival Kit, so someone
// who only ever opened home (or the board) had no offline copy of the
// Survival Kit's crisis box. Web only — the native shells bundle the files.
if ('serviceWorker' in navigator && !(window.isNative && window.isNative())) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
