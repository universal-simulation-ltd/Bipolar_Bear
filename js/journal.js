/**
 * Mood Journal page logic (extracted from inline <script> blocks in
 * journal.html). Loaded as a single <script src> in journal.html, before
 * fab.js, AFTER the deferred Firebase compat SDK scripts. The Firebase
 * `typeof firebase !== 'undefined'` guard inside initializeApp() handles
 * the defer race — initializeApp falls back to a `load` event listener if
 * firebase isn't ready when this script first runs.
 *
 * Block index (lookup by `// ── BLOCK N ──` markers below). Each block
 * preserves its source-order position from the original inline scripts:
 *   1. Page bfcache cover fade-out on `pageshow`.
 *   2. (Was the autoopen-stats/changelog handler — extracted as part of
 *      the main bundle below.)
 *   3. Main journal app: Firebase init, auth, encryption, entries CRUD,
 *      stats rendering, calendar, focused mode, settings, achievements,
 *      PDF export, HealthKit sync — the bulk of the application.
 *   4. Capacitor native bridges (status bar, app state, plugin shims).
 *   5. Service-worker registration.
 *   6. Easter egg: 5-tap logo cycles through variants.
 *
 * innerHTML safety note: this file has many innerHTML interpolations,
 * mostly for ephemeral toast / hint / modal markup with no user input.
 * Free-text user data (entry notes, custom field values, intentions) is
 * primarily rendered via textContent or input.value in the form layer.
 * Where user data does reach innerHTML (rare — mostly the entries list
 * preview), the content has already been validated client-side. A full
 * line-by-line XSS audit was out of scope for this Phase-4 extraction.
 *
 * Use `_esc()` (defined below) for any new innerHTML interpolation that
 * touches user-supplied content.
 *
 * @file js/journal.js
 */

/**
 * Escape HTML-significant characters in user-controlled strings before
 * splicing into innerHTML.
 *
 * @param {string} s
 * @returns {string}
 */
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── BLOCK 1: bfcache cover fade-out ──
window.addEventListener('pageshow', () => {
      const cover = document.getElementById('pageCover');
      if (cover) { cover.style.opacity = '0'; setTimeout(() => cover.remove(), 160); }
    });

// ── BLOCK 2: main journal application (Firebase init, auth, entries CRUD, stats, focused mode, etc.) ──
// ── Capacitor detection helpers (hoisted function declarations) ──
    // isNative() / isIOS() / isAndroid() are now provided by js/shared/platform.js,
    // which is loaded as a synchronous <script> in the page head. They're available
    // as bare globals here (window.isNative etc.) for backwards compatibility.

    // Declare Firebase variables globally
    let auth, db, currentUser = null, isGuestMode = true;

    // ── Onboarding step helpers ──
    // _getOnboardingStep() is provided by js/shared/onboarding.js — the
    // local function delegates so existing inline call sites work unchanged.
    /**
     * @returns {number} Current onboarding step (0–12).
     */
    function _getOnboardingStep() {
      return window.BB.onboarding.getStep();
    }
    /**
     * Advance the user's onboarding step. No-op if `to` is not strictly
     * greater than the current step. Persists to localStorage and to
     * Firestore (`userSettings/{uid}.onboardingStep`) when signed in, then
     * re-runs the journal page's gating callback to show/hide hints.
     *
     * @param {number} to Target step.
     */
    function _advanceOnboardingStep(to) {
      const cur = _getOnboardingStep();
      if (to <= cur) return;
      if (to === 9) to = 10; // step 9 (WhatsApp hint) was removed from the tutorial.
      BB.storage.set('OnboardingStep', String(to));
      if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined' && db) {
        db.collection('userSettings').doc(currentUser.uid).set({ onboardingStep: to }, { merge: true }).catch(() => {});
      }
      if (to >= 1) {
        BB.storage.set('FabsUnlocked', '1');
        if (typeof window._applyFabDock === 'function') window._applyFabDock();
      }
      _applyJournalOnboardingGating();
    }

    /** Navigates to the survival kit page. */
    function _survivalNavClick() {
      location.replace('survival-kit.html');
    }

    let _allEntries = []; // full sorted entry list for personalised feedback
    let _missingDatesCache = []; // dates listed by the last showMissingDates() — input to auto-complete

    // _resolvePointerPosition is provided by js/shared/onboarding.js.
    // Local alias kept so existing call sites in this script work unchanged.
    const _resolvePointerPosition = window.BB.onboarding.resolvePointerPosition;
    function _showHintPointer(targetEl) {
      document.getElementById('_bbHintPointer')?.remove();
      const ptr = document.createElement('div');
      ptr.id = '_bbHintPointer';
      ptr.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:510;pointer-events:none;animation:hintFade 1.8s ease-in-out infinite;';
      ptr.innerHTML = `<div style="position:relative;width:72px;height:72px;display:flex;align-items:center;justify-content:center;"><svg width="72" height="72" viewBox="0 0 72 72" fill="none" style="position:absolute;inset:0;"><circle cx="36" cy="36" r="34" stroke="rgba(255,255,255,0.55)" stroke-width="2"/></svg><svg width="52" height="52" viewBox="0 0 52 52" fill="none" style="transform:rotate(0deg);filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4));"><line x1="26" y1="44" x2="26" y2="10" stroke="white" stroke-width="4" stroke-linecap="round"/><polyline points="14,22 26,10 38,22" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg></div>`;
      document.body.appendChild(ptr);
      const _hintEls = Array.from(document.querySelectorAll('.bb-hint-elevated'));
      _resolvePointerPosition(ptr, _hintEls);
      // Aim the arrow at the target — callable after scroll settles
      function _aim() {
        if (!document.getElementById('_bbHintPointer')) return;
        const r = targetEl.getBoundingClientRect();
        const _tx = r.left + r.width / 2;
        const _ty = r.top + r.height / 2;
        const fcx = parseFloat(ptr.style.left);
        const fcy = parseFloat(ptr.style.top);
        const _arrowSvg = ptr.querySelectorAll('svg')[1];
        if (_arrowSvg && !isNaN(fcx) && !isNaN(fcy)) {
          _arrowSvg.style.transform = `rotate(${Math.atan2(_ty - fcy, _tx - fcx) * 180 / Math.PI + 90}deg)`;
        }
      }
      _aim();
      // Re-aim after smooth scroll animation settles (~400ms)
      setTimeout(_aim, 400);
    }
    function _hideHintPointer() {
      document.getElementById('_bbHintPointer')?.remove();
    }

    function _applyJournalOnboardingGating() {
      // Settings button removed — auto-skip settings tutorial hints
      if (BB.storage.get('SettingsHintDone') !== '1') {
        BB.storage.set('SettingsHintDone', '1');
        BB.storage.set('CustomiseFormHintDone', '1');
        BB.storage.set('CustomiseAdditionalHintDone', '1');
        BB.storage.set('CloseSettingsHintDone', '1');
        BB.storage.set('AdvancedTutorialToastShown', '1');
      }
      const step = _getOnboardingStep();
      // Home button: visible from step 3
      const _home = document.getElementById('homeLink');
      if (_home) _home.style.display = step < 3 ? 'none' : '';
      // Survival kit nav button: visible from step 6 (survival kit unlocked)
      const _skit = document.getElementById('survivalNavBtn');
      if (_skit) _skit.style.display = step < 6 ? 'none' : '';
      // Hint 2 (open journal): step 1 only
      const _h2 = document.getElementById('journalHint2');
      if (_h2) _h2.style.display = step === 1 ? 'flex' : 'none';
      // Hint 2b (close journal): step 2 only
      const _h2b = document.getElementById('journalHintClose');
      if (_h2b) _h2b.style.display = step === 2 ? 'flex' : 'none';
      // Hint 3 (go back here): step 3 only
      const _h3 = document.getElementById('journalHint3');
      if (_h3) _h3.style.display = step === 3 ? 'flex' : 'none';
      // Overlay: show for blocking onboarding steps or settings hint
      const _blockingSteps = new Set([1, 2, 3]);

      // Settings hint: show only during focused-mode mood step on 3rd entry (before tutorial done)
      const _sHint = document.getElementById('settingsHint');
      const _settingsDone = BB.storage.get('SettingsHintDone') === '1';
      let _showSettings = false;
      try {
        _showSettings = !_settingsDone &&
          _fmActive === true &&
          _fmSteps && _fmSteps[_fmStepIndex] && _fmSteps[_fmStepIndex].id === 'mood' &&
          _allEntries.length >= 2;
      } catch(e) { /* _fmActive/_fmSteps not yet initialised (TDZ on page load) */ }
      if (_sHint) _sHint.style.display = _showSettings ? 'flex' : 'none';
      const _sBtn = document.getElementById('settingsBtn');
      if (_sBtn) _sBtn.style.display = (_settingsDone || _showSettings || BB.storage.get('AdvancedBadgeVisible') === '1' || step >= 12) ? '' : 'none';
      if (typeof _updateAdvancedBadge === 'function') _updateAdvancedBadge();
      // Med hint: active when medHintEl is in the DOM (medication step rendered)
      const _medHintEl = document.getElementById('medHintEl');
      const _showMedHint = !!_medHintEl && BB.storage.get('MedHintDone') !== '1';
      // The one-shot Settings-FAB hint owns the same #bbHintOverlay. It can be
      // raised while focused mode is opening, and _renderFocusedStep() calls
      // back into here on every step — without this the very next render would
      // switch the dimmer off underneath it, leaving the hint stranded on a
      // fully interactive page with nothing pointing anywhere.
      const _showFabHint = document.body.classList.contains('bb-settings-fab-hint');
      const _isBlocking = _blockingSteps.has(step) || _showSettings || _showMedHint || _showFabHint;
      const _overlay = document.getElementById('bbHintOverlay');
      if (_overlay) _overlay.style.display = _isBlocking ? '' : 'none';

      // Elevate hint + target above overlay
      document.querySelectorAll('.bb-hint-elevated').forEach(el => {
        el.classList.remove('bb-hint-elevated');
        el.style.zIndex = el.dataset.prevZIndex || '';
        delete el.dataset.prevZIndex;
      });
      if (_isBlocking) {
        const _elev = [];
        if (_blockingSteps.has(step)) {
          const _hintMap = { 1:'journalHint2', 2:'journalHintClose', 3:'journalHint3' };
          const _tgtMap  = { 1:'journalToggleBtn', 2:'journalToggleBtn', 3:'homeLink' };
          _elev.push(document.getElementById(_hintMap[step]), document.getElementById(_tgtMap[step]));
        }
        if (_showSettings) {
          _elev.push(document.getElementById('settingsHint'), document.getElementById('settingsBtn'));
          // Also elevate the entire settings button area
          _elev.push(document.getElementById('settingsBtnArea'));
        }
        if (_showMedHint) {
          _elev.push(_medHintEl, document.getElementById('manageMedsBtn'));
        }
        _elev.filter(Boolean).forEach(el => {
          el.dataset.prevZIndex = el.style.zIndex;
          el.style.zIndex = '601';
          if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
          el.classList.add('bb-hint-elevated');
        });
        // A blocking hint is useless if its target is below the fold (e.g.
        // "Manage medications" now sits at the bottom of the full-screen
        // medication step on small phones) — bring the target into view.
        const _scrollTarget = _showMedHint ? document.getElementById('manageMedsBtn')
          : _showSettings ? document.getElementById('settingsBtn') : null;
        if (_scrollTarget) {
          setTimeout(() => {
            try { _scrollTarget.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
          }, 150);
        }
      }
      // Scroll lock + center pointer arrow for blocking onboarding steps
      if (_blockingSteps.has(step)) {
        document.body.style.overflow = 'hidden';
        const _tgtMap2 = { 1:'journalToggleBtn', 2:'journalToggleBtn', 3:'homeLink' };
        const _tgt = document.getElementById(_tgtMap2[step]);
        // Always recalculate — target may have moved (e.g. journal toggle button shifts after opening)
        _hideHintPointer();
        if (_tgt) setTimeout(() => _showHintPointer(_tgt), 80);
      } else {
        document.body.style.overflow = '';
        _hideHintPointer();
      }
    }
    
    // Apply onboarding gating immediately on load
    _applyJournalOnboardingGating();

    // Open achievements panel if navigated here from tutorial complete toast
    if (new URLSearchParams(window.location.search).get('openAchievements') === '1') {
      setTimeout(async () => {
        if (typeof showSettingsModal === 'function') {
          await showSettingsModal();
          if (typeof showAchievementsPanel === 'function') showAchievementsPanel();
        }
      }, 600);
    }

    // ── Deep link: journal.html?mood=<manic|elevated|stable|low|depressed> ──
    // The home screen and the native home-screen widget link here to start a
    // check-in with the mood already picked. The param is read once and
    // stripped from the URL at once (history.replaceState), so a reload — e.g.
    // after the entry is saved — never replays it. Invalid values are ignored.
    // The mood is applied by _fmDeepLinkResolve(), called from
    // updateDatePickerStatus() once the page knows which check-in it opens.
    var _fmDeepLinkMood = (function () {
      try {
        const _p = new URLSearchParams(window.location.search);
        if (!_p.has('mood')) return null;
        const _m = String(_p.get('mood') || '').trim().toLowerCase();
        _p.delete('mood');
        const _qs = _p.toString();
        history.replaceState(history.state, '', location.pathname + (_qs ? '?' + _qs : '') + location.hash);
        return ['manic', 'elevated', 'stable', 'low', 'depressed'].includes(_m) ? _m : null;
      } catch (_) { return null; }
    })();

    /**
     * Apply a pending ?mood= deep link — one shot. `allowed` is false when the
     * current day's entry is already complete: the page then does what it
     * always does in that state (the "View yesterday's entry" card) and the
     * link is dropped. Otherwise the mood is chosen exactly as a tap would
     * (_fmMoodTap / _fmSpectrumTap, so the depressed-support modal, hints,
     * haptic, tint and auto-advance to step 2 all run). With focused mode
     * off, the classic form's bear is clicked instead.
     */
    function _fmDeepLinkResolve(allowed) {
      const mood = _fmDeepLinkMood;
      if (!mood) return;
      _fmDeepLinkMood = null;
      if (!allowed || (typeof editingEntry !== 'undefined' && editingEntry)) return;
      const _card = document.getElementById('focusedModeCard');
      if (typeof _fmActive !== 'undefined' && _fmActive && _card && _card.style.display !== 'none') {
        const _moodIdx = _fmSteps.findIndex(s => s.id === 'mood');
        if (_moodIdx < 0) return;
        // A restored draft opens on the review step — go back to the mood step.
        if (_fmStepIndex !== _moodIdx) { _fmReturnToDone = false; _fmGoTo(_moodIdx); }
        setTimeout(() => {
          if (!_fmActive || _fmStepIndex !== _moodIdx) return;
          if (_spectrumEnabled()) _fmSpectrumTap({ manic: 9, elevated: 7, stable: 5, low: 3, depressed: 1 }[mood]);
          else _fmMoodTap(mood);
        }, 60);
        return;
      }
      const _form = document.getElementById('entryFormCard');
      if (_form && _form.style.display !== 'none') {
        const _btn = _form.querySelector(`.mood-btn[data-mood="${mood}"]`);
        if (_btn && _btn.offsetParent !== null) _btn.click();
      }
    }

    // ── Onboarding page lock ──
    (function() {
      const _targets = { 1:'journalToggleBtn', 2:'journalToggleBtn', 3:'homeLink' };
      const _hints   = { 1:'journalHint2', 2:'journalHintClose', 3:'journalHint3' };
      function _nudge() {
        const s = _getOnboardingStep();
        [document.getElementById(_hints[s]), document.getElementById(_targets[s])].forEach(el => {
          if (!el || el.style.display === 'none') return;
          const _prev = el.style.animation;
          el.style.animation = 'none';
          el.offsetHeight;
          el.style.animation = 'bbHintNudge 0.5s ease';
          setTimeout(() => { el.style.animation = _prev; }, 520);
        });
      }
      document.addEventListener('click', function(e) {
        const s = _getOnboardingStep();
        const tid = _targets[s];
        if (document.querySelector('.confirm-modal.active, .overlay-modal.active')) return;
        // Onboarding step lock takes priority
        if (tid) {
          const t = document.getElementById(tid);
          if (!t || t === e.target || t.contains(e.target)) return;
          // Never block clicks inside the focused-mode card — users can still create entries
          // during blocking onboarding steps (e.g. tapping a mood at step 1).
          const _fmCard = document.getElementById('focusedModeCard');
          if (_fmCard && _fmCard.contains(e.target)) return;
          e.stopPropagation(); e.preventDefault();
          _nudge();
          return;
        }
        // Settings hint lock (independent)
        if (BB.storage.get('SettingsHintDone') !== '1') {
          const sHint = document.getElementById('settingsHint');
          if (sHint && sHint.style.display !== 'none') {
            const sBtn = document.getElementById('settingsBtn');
            if (!sBtn || sBtn === e.target || sBtn.contains(e.target)) return;
            e.stopPropagation(); e.preventDefault();
            [sHint, sBtn].forEach(el => {
              if (!el) return;
              const prev = el.style.animation;
              el.style.animation = 'none'; el.offsetHeight;
              el.style.animation = 'bbHintNudge 0.5s ease';
              setTimeout(() => { el.style.animation = prev; }, 520);
            });
          }
        }
      }, true);
    })();

    // Wait for Firebase to load
    function initializeApp() {
      // Config lives in js/shared/firebase-config.js so every page reads the
      // same source of truth.
      const firebaseConfig = window.BB_FIREBASE_CONFIG;

      // Initialize Firebase with error handling
      
      try {
        if (typeof firebase === 'undefined') {
          throw new Error('Firebase library not loaded');
        }
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        // Web: use session-scoped auth persistence so the browser close = sign-out,
        // forcing re-login (and therefore key re-derivation) on the next visit.
        // Native keeps the default LOCAL persistence — PIN handles the unlock UX there.
        if (!isNative()) {
          auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(() => {});
        }
        db = firebase.firestore();
        // Expose to window so other <script> blocks (and shared modules like
        // fab.js) can access them. `let` declarations don't attach to window,
        // and a number of call sites — including fab.js's _syncFabsToFirestore
        // and the toggle handlers below — gate writes on window.db / window.currentUser.
        // Without this, those Firestore writes silently no-op.
        window.auth = auth;
        window.db = db;
        // Enable offline persistence — queues writes while offline and syncs on reconnect.
        // synchronizeTabs: false = simple exclusive lock, acquired almost instantly.
        // (synchronizeTabs: true = multi-tab leader election taking 3-5s, unnecessary in
        // a Capacitor app with a single WebView and the root cause of loadEntries timeouts)
        db.enablePersistence({ synchronizeTabs: false }).catch(err => {
          if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
            console.warn('Firestore persistence error:', err);
          }
        });

      let _presenceStarted = false;  // live-now heartbeat wired (see below)

      // Safety net: if onAuthStateChanged never fires (e.g. Firebase Auth IndexedDB hangs
      // after site data is cleared), fall back to guest mode after 4 seconds so the spinner
      // doesn't get stuck forever.
      let _authResolved = false;
      setTimeout(() => {
        if (!_authResolved) {
          console.warn('onAuthStateChanged did not fire — falling back to guest mode');
          isGuestMode = true;
          currentUser = null;
          window.currentUser = null;
          loadEntries();
        }
      }, 4000);

      // Authentication State — registered immediately (not waiting for persistence).
      // If persistence isn't ready when loadEntries() fires, the 10s timeout is the safety net.
      auth.onAuthStateChanged((user) => {
        _authResolved = true;
        // Report this session to the home screen's "(N live)" figure. Journal
        // time is very much time spent using the app. No callback: nothing here
        // displays a count, so this only heartbeats. Once per page — the auth
        // listener can fire more than once and two loops would double-count
        // this session.
        if (!_presenceStarted && window.BB && BB.userCount) {
          _presenceStarted = true;
          BB.userCount.startPresence(db, 'app');
        }
        if (user && !user.isAnonymous) {
          currentUser = user;
          window.currentUser = user;
          isGuestMode = false;
          document.getElementById('appContent').classList.add('visible');
          document.getElementById('signinBtn').style.display = 'none';
          document.getElementById('userInfo').style.display = 'flex';
          document.getElementById('userEmail').textContent = user.email;
          _updateJournalAuthFab(true);
          _justLoggedIn = true;
          BB.storage.remove('_entryStatus');
          BB.storage.remove('_recentMoods');
          try { BB.platform.syncWidgetMoods(); } catch (_) {}
          migrateGoodMoodToStable(user);
          // Load user settings from Firestore, then derive key + migrate + load entries
          // Race against 5 s — if Firestore hangs here _authResolved is already true so
          // the 4 s auth fallback won't help; the catch() handler ensures loadEntries() fires.
          Promise.race([
            db.collection('userSettings').doc(user.uid).get(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('settings-timeout')), 5000))
          ]).then(async doc => {
            // Back guest-entered data (meds, goals, budget, …) up to the
            // account. Guest data lives only in localStorage; signup/login only
            // ever pulled settings down, so anything authored before creating an
            // account was never backed up and was lost when localStorage cleared.
            // Runs even when the doc doesn't exist (brand-new account) so guest
            // data is claimed. Idempotent and non-destructive.
            if (window.BB && BB.claimGuestData) BB.claimGuestData(db, user, doc);
            if (doc.exists) {
              const d = doc.data();
              if (d.logoVariant !== undefined) {
                localStorage.setItem('logoVariant', d.logoVariant);
                if (typeof applyLogoVariant === 'function') applyLogoVariant(d.logoVariant);
              }
              if (d.statsStartDate !== undefined) {
                statsStartDate = d.statsStartDate || null;
                if (statsStartDate) localStorage.setItem('statsStartDate', statsStartDate);
                else localStorage.removeItem('statsStartDate');
              }
              if (d.dailyGoals !== undefined) {
                localStorage.setItem('dailyGoals', JSON.stringify(d.dailyGoals));
                if (typeof loadGoalsList === 'function') loadGoalsList();
              }
              if (d.dailyBudget !== undefined) {
                if (d.dailyBudget) localStorage.setItem('dailyBudget', d.dailyBudget);
                else localStorage.removeItem('dailyBudget');
                if (typeof _updateBudgetLabel === 'function') _updateBudgetLabel();
              }
              if (d.currentMedList !== undefined) {
                localStorage.setItem('currentMedList', JSON.stringify(d.currentMedList));
                if (typeof loadMedicationList === 'function') loadMedicationList();
              }
              if (d.trackingFields !== undefined) {
                Object.entries(d.trackingFields).forEach(([key, val]) => {
                  localStorage.setItem(key, val);
                });
                applyTrackingPrefs();
              }
              if (d.customTrackingFields !== undefined) {
                localStorage.setItem('customTrackingFields', JSON.stringify(d.customTrackingFields));
                applyTrackingPrefs();
              }
              if (d.labelOverrides !== undefined) {
                Object.entries(d.labelOverrides).forEach(([key, val]) => {
                  if (val) localStorage.setItem('_labelOverride_' + key, val);
                  else localStorage.removeItem('_labelOverride_' + key);
                });
              }
              if (d.pinEnabled && d.pinCode) {
                BB.storage.set('PinEnabled', '1');
                BB.storage.set('PinCode', d.pinCode);
                // User just authenticated via email — treat this session as unlocked
                // so they aren't prompted again immediately after signing in
                sessionStorage.setItem('bbPinUnlocked', '1');
              } else {
                // No PIN for this user (new account or PIN removed) — clear any leftover
                // (also clears any guest PIN that was set before account creation)
                BB.storage.remove('PinEnabled');
                BB.storage.remove('PinCode');
                BB.storage.remove('GuestPinSalt');
                sessionStorage.removeItem('bb_guest_key');
                _guestCryptoKey = null;
              }
              // Logged-in users never see the guest PIN overlay — dismiss it if visible
              const _pinOv = document.getElementById('pinOverlay');
              if (_pinOv) _pinOv.style.display = 'none';
              _updatePinSettingsBtn();
              // Sync settings from Firestore; only clear local value if Firestore explicitly has it as falsy
              if (d.focusedModeEnabled !== undefined) localStorage.setItem('focusedModeEnabled', d.focusedModeEnabled ? '1' : '0');
              else localStorage.removeItem('focusedModeEnabled');
              if (d.moreDataOpenByDefault !== undefined) localStorage.setItem('moreDataOpenByDefault', d.moreDataOpenByDefault ? 'true' : 'false');
              else localStorage.removeItem('moreDataOpenByDefault');
              if (d.fmConfirmStep !== undefined) localStorage.setItem('fmConfirmStep', d.fmConfirmStep ? 'true' : 'false');
              if (d.incognitoMode !== undefined) localStorage.setItem('incognitoMode', d.incognitoMode ? 'true' : 'false');
              else if (d.pdfHideByDefault !== undefined) localStorage.setItem('incognitoMode', d.pdfHideByDefault ? 'true' : 'false');
              if (localStorage.getItem('incognitoMode') === 'true') BB.storage.remove('_recentMoods');
              try { BB.platform.syncWidgetMoods(); } catch (_) {}
              if (d.achievementToastsEnabled !== undefined) localStorage.setItem('achievementToastsEnabled', d.achievementToastsEnabled ? 'true' : 'false');
              if (d.earlyWarnEnabled !== undefined) localStorage.setItem('earlyWarnEnabled', d.earlyWarnEnabled ? 'true' : 'false');
              // Bipolar Anonymous: is this account on the board, and may the
              // journal answer its daily check-in? (_anonJournalCheckin)
              const _ap = (d.anonProfile && typeof d.anonProfile === 'object') ? d.anonProfile : {};
              if (_ap.monika) BB.storage.set('Anon_linked', '1'); else BB.storage.remove('Anon_linked');
              if (_ap.journalCheckin !== undefined) BB.storage.set('Anon_journalCheckin', _ap.journalCheckin ? '1' : '0');
              if (d.unlockedAchievements) {
                localStorage.setItem('unlockedAchievements', JSON.stringify(d.unlockedAchievements));
                _achievementsInitialized = false; // reset so next checkAchievements re-baselines without toasting
              }
              // showMoodSuggestion: use Firestore value if present, otherwise keep the local preference
              if (d.showMoodSuggestion !== undefined) {
                localStorage.setItem('showMoodSuggestion', d.showMoodSuggestion ? '1' : '0');
              }
              if (d.moodLinkingEnabled !== undefined) {
                localStorage.setItem('moodLinkingEnabled', d.moodLinkingEnabled ? '1' : '0');
              }
              if (d.moodSpectrumEnabled !== undefined) {
                localStorage.setItem('moodSpectrumEnabled', d.moodSpectrumEnabled ? '1' : '0');
                if (typeof _applyMoodSpectrumMode === 'function') _applyMoodSpectrumMode();
              }
              if (d.wheelModeEnabled !== undefined) {
                localStorage.setItem('wheelModeEnabled', d.wheelModeEnabled ? '1' : '0');
              }
              if (d.healthSyncEnabled !== undefined) {
                BB.storage.set('HealthSyncEnabled', d.healthSyncEnabled ? '1' : '0');
              }
              // Reminder/weekly summary — sync across devices
              if (d.reminderEnabled !== undefined) localStorage.setItem('reminderEnabled', d.reminderEnabled ? 'true' : 'false');
              if (d.reminderTime !== undefined && d.reminderTime) localStorage.setItem('reminderTime', d.reminderTime);
              if (d.weeklySummaryEnabled !== undefined) localStorage.setItem('weeklySummaryEnabled', d.weeklySummaryEnabled ? 'true' : 'false');
              // The three settings above are account-level, but the OS grants they
              // depend on are per-install. Signing in on a new device restored
              // "reminders on" / "Health sync on" onto a phone that had never been
              // asked, leaving the toggles reading ON while nothing was scheduled
              // and no health data was imported. Reconcile against the real grants
              // FIRST, so the reschedule below runs on settings this device can
              // actually honour.
              if (isNative()) {
                await _reconcileNativePermissionSettings().catch(() => {});
              }
              // Reschedule local notifications on this device using the synced settings.
              // scheduleReminder() gates on reminderEnabled internally; weekly summary
              // is rescheduled by the entries-load flow (loadEntries → scheduleWeeklySummary).
              if (isNative() && typeof scheduleReminder === 'function') {
                scheduleReminder().catch(() => {});
              }
              if (d.personalHintDone) BB.storage.set('PersonalHintDone', '1');
              // Sync customise form settings
              if (d.customiseFormEnabled !== undefined) localStorage.setItem('customiseFormEnabled', d.customiseFormEnabled ? 'true' : 'false');
              if (d.disabledSteps !== undefined) {
                try { localStorage.setItem('disabledSteps', JSON.stringify(d.disabledSteps)); } catch(e) {}
              }
              // Sync onboarding step (take max of local and server)
              const _serverStep = d.onboardingStep || 0;
              const _localStep = _getOnboardingStep();
              const _finalStep = Math.max(_serverStep, _localStep);
              if (_finalStep !== _localStep) BB.storage.set('OnboardingStep', String(_finalStep));
              if (_localStep > _serverStep) {
                db.collection('userSettings').doc(user.uid).set({ onboardingStep: _localStep }, { merge: true }).catch(() => {});
              }

              // ── E2E key derivation (key-wrapping architecture) ──
              // dataKey   = random key used to encrypt entries (never changes)
              // wrappingKey = PBKDF2(password, wrapSalt) — changes with password, wraps the dataKey
              // wrappedKey  = AES-GCM(wrappingKey, dataKey) stored in Firestore
              const _encSalt  = d.encSalt  || null; // legacy: old arch data key salt
              const _wrapSalt = d.wrapSalt || null; // new arch: wrapping key salt
              if (!_userCryptoKey) _userCryptoKey = await _userImportKeyFromSession();
              if (_pendingAuthPassword) {
                if (d.wrappedKey && _wrapSalt) {
                  // ── New architecture: unwrap data key with current password ──
                  const _wrappingKey = await _userDeriveKey(_pendingAuthPassword, _wrapSalt);
                  try {
                    const _dataKey = await _unwrapDataKey(d.wrappedKey, d.wrappedKeyIv, _wrappingKey);
                    if (!_userCryptoKey) {
                      _userCryptoKey = _dataKey;
                      await _userExportKeyToSession(_userCryptoKey);
                    }
                    // If Keychain had the key it's the same data key — no action needed
                  } catch(e) {
                    // Unwrap failed — password was changed via email reset, Firestore has stale wrap
                    if (_userCryptoKey) {
                      // Native: Keychain has the true data key — re-wrap with new password
                      const _newWrapSaltBytes = crypto.getRandomValues(new Uint8Array(16));
                      const _newWrapSalt = btoa(String.fromCharCode(..._newWrapSaltBytes));
                      const _newWrappingKey = await _userDeriveKey(_pendingAuthPassword, _newWrapSalt);
                      const _rewrapped = await _wrapDataKey(_userCryptoKey, _newWrappingKey);
                      db.collection('userSettings').doc(user.uid).set(
                        { wrapSalt: _newWrapSalt, ..._rewrapped }, { merge: true }
                      ).catch(() => {});
                    }
                    // Web + no session + password changed via email reset: data inaccessible (known limitation)
                  }
                } else {
                  // ── Old architecture or first login: migrate to key-wrapping ──
                  // The data key is either in Keychain, derived from encSalt, or fresh for this user
                  let _dataKey = _userCryptoKey;
                  if (!_dataKey && _encSalt) {
                    // Old arch: data key was PBKDF2(password, encSalt) — re-derive it
                    _dataKey = await _userDeriveKey(_pendingAuthPassword, _encSalt);
                    _userCryptoKey = _dataKey;
                    await _userExportKeyToSession(_userCryptoKey);
                  } else if (!_dataKey) {
                    // No key anywhere — generate a fresh random data key
                    const _rawKey = crypto.getRandomValues(new Uint8Array(32));
                    _dataKey = await crypto.subtle.importKey('raw', _rawKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
                    _userCryptoKey = _dataKey;
                    await _userExportKeyToSession(_userCryptoKey);
                  }
                  // Wrap the data key with the current password and store in Firestore
                  const _newWrapSaltBytes = crypto.getRandomValues(new Uint8Array(16));
                  const _newWrapSalt = btoa(String.fromCharCode(..._newWrapSaltBytes));
                  const _newWrappingKey = await _userDeriveKey(_pendingAuthPassword, _newWrapSalt);
                  const _wrapped = await _wrapDataKey(_dataKey, _newWrappingKey);
                  db.collection('userSettings').doc(user.uid).set(
                    { wrapSalt: _newWrapSalt, ..._wrapped }, { merge: true }
                  ).catch(() => {});
                }
                _pendingAuthPassword = null;
              }
              // One-time migration: encrypt existing plaintext Firestore entries
              if (_userCryptoKey && _encSalt && !d.encMigrated) {
                await _encryptExistingEntries(user.uid);
                db.collection('userSettings').doc(user.uid).set({ encMigrated: true }, { merge: true }).catch(() => {});
              }
            } else {
              // New user — clear all previous user's settings and hints, enable focused mode by default
              ['PinEnabled','PinCode','FavAnniShown',
               'PrivateHintSeen','FavouriteHintSeen','_moodTipShown','_fmMoodTipShown','_draft']
                .forEach(k => BB.storage.remove(k));
              ['moreDataOpenByDefault','showMoodSuggestion','moodLinkingEnabled','moodSpectrumEnabled','wheelModeEnabled','earlyWarnEnabled','bbEarlyWarnSeen']
                .forEach(k => localStorage.removeItem(k));
              BB.storage.remove('OnboardingStep'); // new user starts at step 0
              localStorage.setItem('focusedModeEnabled', '1');
              sessionStorage.removeItem('bbPinUnlocked');
              _updatePinSettingsBtn();

              // ── E2E key derivation (new user — no settings doc yet) ──
              if (!_userCryptoKey) _userCryptoKey = await _userImportKeyFromSession();
              if (!_userCryptoKey && _pendingAuthPassword) {
                // Generate a fresh random data key (not derived from password)
                const _rawKey = crypto.getRandomValues(new Uint8Array(32));
                const _dataKey = await crypto.subtle.importKey('raw', _rawKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
                // Wrap it with the password
                const _wrapSaltBytes = crypto.getRandomValues(new Uint8Array(16));
                const _wrapSalt = btoa(String.fromCharCode(..._wrapSaltBytes));
                const _wrappingKey = await _userDeriveKey(_pendingAuthPassword, _wrapSalt);
                const _wrapped = await _wrapDataKey(_dataKey, _wrappingKey);
                db.collection('userSettings').doc(user.uid).set(
                  { wrapSalt: _wrapSalt, ..._wrapped, encMigrated: true }, { merge: true }
                ).catch(() => {});
                _userCryptoKey = _dataKey;
                await _userExportKeyToSession(_userCryptoKey);
                _pendingAuthPassword = null;
              }
            }

            // Migrate guest entries (decrypt with guest key, re-encrypt with user key), then load
            await migrateGuestEntriesIfNeeded(user);
            loadEntries();
          }).catch(() => { loadEntries(); });
        } else {
          currentUser = null;
          window.currentUser = null;
          isGuestMode = true;
          document.getElementById('signinBtn').style.display = '';
          document.getElementById('userInfo').style.display = 'none';
          _updateJournalAuthFab(false);
          // Defer past script initialization — onAuthStateChanged can fire synchronously
          // for a cached guest state, before all `let` declarations further down the script
          // have been initialized. Calling loadEntries() directly from here causes a TDZ
          // ReferenceError in the finally block (_isRetry, _guestCryptoKey, etc.), which
          // silently aborts the finally block and leaves the loading spinner stuck forever.
          setTimeout(() => loadEntries(), 0);
        }
      });

    } catch (error) {
      console.error('Firebase initialization error:', error);
      // Continue in guest mode even if Firebase fails.
      // Defer for the same TDZ reason as the guest onAuthStateChanged branch above.
      isGuestMode = true;
      currentUser = null;
      window.currentUser = null;
      setTimeout(() => loadEntries(), 0);
    }
  }
  
  function _updateJournalAuthFab(loggedIn) {
    // The dock auth button is injected by fab.js as #bbAuthFab and uses window._fabOpenAuth
    // as its click handler. Guests and signed-in users both land in the Settings
    // modal — customising the journal form never requires an account, and Settings
    // carries its own "Sign in to back up" button so syncing stays optional.
    const fab = document.getElementById('bbAuthFab');
    window._fabOpenAuth = () => { if (typeof _dismissSettingsHint === 'function') _dismissSettingsHint(); showSettingsModal(); };
    if (fab) {
      fab.textContent = '⚙️';
      fab.title = 'Settings';
      fab.style.background = 'var(--brand-primary)';
      fab.style.color = 'white';
      fab.style.border = 'none';
      fab.style.boxShadow = '0 2px 10px rgba(255,149,0,0.35)';
    }
    if (typeof window._applyFabDock === 'function') window._applyFabDock();

    // First journal visit after the tutorial: surface a one-shot blocking hint
    // pointing at this Settings FAB (mirrors the index tutorial-finale hint).
    // Runs here, after auth resolves and the FAB is configured as ⚙️ Settings.
    setTimeout(function () { try { _showSettingsFabHint(); } catch (_) {} }, 600);
  }

  /**
   * One-shot blocking hint pointing at the dock Settings (⚙️) FAB, shown the
   * first time the user opens the journal after completing the tutorial. Mirrors
   * the index tutorial-finale hint: a full-screen dimmer makes everything inert
   * except the FAB (lifted above the dimmer), tapping the dimmer just nudges the
   * pulsing "tap Settings" label, and tapping the FAB opens Settings + clears the
   * hint. Self-contained — builds its own label, reuses the page's #bbHintOverlay.
   */
  function _showSettingsFabHint(_attempt) {
    // Only after the tutorial is fully complete, and only ever once.
    var step = (window.BB && BB.onboarding) ? BB.onboarding.getStep() : 0;
    if (step < 12 || BB.storage.get('TutorialToastShown') !== '1') return;
    if (BB.storage.get('SettingsFabHintShown') === '1') return;

    var fab = document.getElementById('bbAuthFab');
    var overlay = document.getElementById('bbHintOverlay');
    // Focused mode hides the whole FAB dock (body.bb-fm-full). This hint fires
    // ~600ms after auth resolves, which is usually BEFORE the entries finish
    // loading and focused mode opens — so without this class the dock would
    // vanish out from under an already-visible hint and its arrow would point
    // at empty background. The class re-exposes just the Settings button over
    // the focused card (see css/journal.css) and is dropped again in _cleanup.
    document.body.classList.add('bb-settings-fab-hint');
    // fab.js injects the dock after this script + the Firebase SDKs, so on a
    // cold load the FAB may not exist yet. Retry for ~4s before giving up.
    var notReady = !fab || !overlay || getComputedStyle(fab).display === 'none';
    if (notReady) {
      document.body.classList.remove('bb-settings-fab-hint');
      if ((_attempt || 0) < 16) setTimeout(function () { _showSettingsFabHint((_attempt || 0) + 1); }, 250);
      return;
    }
    // Don't fight a modal that's already open — wait for it to close.
    if (document.querySelector('.confirm-modal.active, .overlay-modal.active, .bb-auth-overlay.active')) {
      document.body.classList.remove('bb-settings-fab-hint');
      if ((_attempt || 0) < 40) setTimeout(function () { _showSettingsFabHint((_attempt || 0) + 1); }, 300);
      return;
    }

    BB.storage.set('SettingsFabHintShown', '1');

    // Label (above the centred FAB) + downward arrow, mirroring index's signinHint.
    var _label = (window.BB && BB.t) ? BB.t('journal.hint.settingsFab') : 'journal.hint.settingsFab';
    if (_label === 'journal.hint.settingsFab') _label = '🐻 Tap Settings to customise your journal';
    var hint = document.getElementById('settingsFabHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'settingsFabHint';
      hint.style.cssText = 'position:fixed;bottom:76px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;z-index:601;';
      var inner = document.createElement('div');
      inner.id = 'settingsFabHintInner';
      inner.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;';
      inner.innerHTML = '<span style="background:rgba(0,0,0,0.58);color:white;font-size:0.8em;font-weight:700;padding:6px 13px;border-radius:20px;max-width:min(280px,calc(100vw - 48px));text-align:center;box-shadow:0 2px 10px rgba(0,0,0,0.25);"></span><svg width="16" height="18" viewBox="0 0 16 18" fill="none"><line x1="8" y1="1" x2="8" y2="14" stroke="rgba(255,255,255,0.85)" stroke-width="2" stroke-linecap="round"/><polyline points="3,9 8,15 13,9" stroke="rgba(255,255,255,0.85)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
      hint.appendChild(inner);
      document.body.appendChild(hint);
    }
    var _labelSpan = hint.querySelector('span');
    if (_labelSpan) _labelSpan.textContent = _label;
    hint.style.display = 'flex';
    var _inner = document.getElementById('settingsFabHintInner');
    var _pulse = _inner ? _inner.animate([{ opacity: 0.75 }, { opacity: 1 }, { opacity: 0.75 }], { duration: 1600, iterations: Infinity }) : null;

    // Dim the page; lift the FAB above the dimmer so it stays tappable.
    var prevFabZ = fab.style.zIndex;
    overlay.style.display = '';
    overlay.style.pointerEvents = 'auto';
    fab.style.zIndex = '601';

    function _cleanup() {
      if (_pulse) { try { _pulse.cancel(); } catch (_) {} }
      document.body.classList.remove('bb-settings-fab-hint');
      overlay.style.display = 'none';
      overlay.style.pointerEvents = 'none';
      overlay.onclick = null;
      if (hint) hint.style.display = 'none';
      fab.style.zIndex = prevFabZ;
      fab.removeEventListener('click', _onFabClick);
    }
    overlay.onclick = function () {
      // Not a dismiss — the Settings FAB is the way forward. Nudge the label.
      if (!_inner) return;
      _inner.style.animation = 'bbHintNudge 0.5s ease';
      setTimeout(function () { _inner.style.animation = ''; }, 520);
    };
    function _onFabClick() { _cleanup(); }
    fab.addEventListener('click', _onFabClick);
  }
  window._showSettingsFabHint = _showSettingsFabHint;

  // Check if Firebase is loaded and initialize
  if (typeof firebase !== 'undefined') {
    initializeApp();
  } else {
    // Wait for Firebase to load
    window.addEventListener('load', function() {
      setTimeout(function() {
        if (typeof firebase !== 'undefined') {
          initializeApp();
        } else {
          console.error('Firebase failed to load, continuing in guest mode');
          isGuestMode = true;
          currentUser = null;
          window.currentUser = null;
          loadEntries();
        }
      }, 500);
    });
  }

    // Show "Offline" instead of Sign In when there's no network; show banner when signed in
    function updateOnlineStatus() {
      const online = navigator.onLine;
      // Banner for signed-in users
      const banner = document.getElementById('offlineBanner');
      if (banner) banner.style.display = online ? 'none' : '';
      // Sign-in button for signed-out users
      const btn = document.getElementById('signinBtn');
      if (!btn || btn.style.display === 'none') return;
      if (!online) {
        btn.textContent = BB.t('common.offline');
        btn.disabled = true;
        btn.style.opacity = '0.55';
        btn.onclick = null;
      } else {
        btn.textContent = BB.t('common.signIn');
        btn.disabled = false;
        btn.style.opacity = '';
        btn.onclick = () => window.showAuthModal();
      }
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // Auth modals now handled by shared fab.js — set hooks
    window._fabOnSignOut = logout;
    // Default the dock button to Settings (guest-friendly). _updateJournalAuthFab
    // refines icon/title once auth state resolves; either way it opens Settings.
    window._fabOpenAuth  = () => { if (typeof _dismissSettingsHint === 'function') _dismissSettingsHint(); showSettingsModal(); };

    // ── Auth hooks for shared fab.js modal ──
    // Capture password before sign-in so onAuthStateChanged can derive the encryption key
    window._fabBeforeSignIn = function () {
      const pwEl = document.getElementById('bbAuthPassword');
      _pendingAuthPassword = pwEl ? pwEl.value : null;
    };

    function logout() {
      // Clear all user-specific preferences so the next guest session starts blank.
      // bbOnboardingStep IS cleared here — it's re-synced from Firestore on next login.
      [
        'trackGoals', 'trackBudget', 'trackExercise', 'trackOutside',
        'trackAnxiety', 'trackAlcohol', 'trackEmotions',
        'customTrackingFields', 'currentMedList', 'dailyGoals', 'dailyBudget',
        'statsStartDate', 'unlockedAchievements',
        'bbOnboardingStep',
        'bbFavAnniShown',
        // Mood step tutorial hints
        'bbPrivateHintSeen', 'bbFavouriteHintSeen', 'bb_moodTipShown', 'bb_fmMoodTipShown',
        'bb_fmChooseMoodHintDone', 'bb_fmMoodInfoCloseHintDone',
        // Settings / customise tutorial hints
        'bbSettingsHintDone', 'bbSettingsFabHintShown',
        'bbCustomiseFormHintDone', 'bbCustomiseAdditionalHintDone', 'bbCloseSettingsHintDone', 'bbCustomiseFormCollapsed',
        'bbAdvancedTutorialToastShown',
        // Advanced settings badge + tap-hold hint pending
        'bbAdvancedBadgePending', 'bbAdvancedBadgeVisible',
        'bb_fmTapHoldHintPending', 'bb_fmTapHoldHintReady',
        'bbHasEntries', 'bbFeedbackFabHidden', 'bbWaFabHidden', 'bbReviewFabHidden', 'bbFooterHidden',
        'bbPinEnabled', 'bbPinCode',
        'bbWelcomeShown',
        'focusedModeEnabled', 'moreDataOpenByDefault', 'showMoodSuggestion',
        'moodLinkingEnabled', 'bb_draft',
        'earlyWarnEnabled', 'bbEarlyWarnSeen',
        // "Already counted in counters/{userCount,anonUserCount}" mirrors.
        // Account-specific: leaving them behind would make the next account to
        // sign in on this device skip counting itself.
        'bbUserCounted', 'bbAnon_counted',
      ].forEach(k => localStorage.removeItem(k));
      sessionStorage.removeItem('bbPinUnlocked');
      sessionStorage.removeItem('bb_user_key');
      _userCryptoKey = null;
      _pendingAuthPassword = null;
      BB.storage.remove('NativePinEnabled');
      BB.storage.remove('_recentMoods'); // home strip's per-device mood cache
      try { BB.platform.syncWidgetMoods(); } catch (_) {}
      if (isNative()) {
        const _ss = window.Capacitor?.Plugins?.SecureStorage;
        if (_ss) {
          _ss.removeItem('bb_user_key').catch(() => {});
          _ss.removeItem('bb_native_pin').catch(() => {});
        }
      }
      // Clear any custom field toggle keys (trackCustom_*) and cached journal entries (entry:*)
      Object.keys(localStorage).filter(k => k.startsWith('trackCustom_') || k.startsWith('entry:')).forEach(k => localStorage.removeItem(k));
      // Reset form fields and re-apply (now-empty) prefs immediately
      _achievementsInitialized = false;
      resetEntryForm();
      applyTrackingPrefs();
      if (auth) auth.signOut();
    }

    window.logout = logout;

    let selectedMood = null;
    let selectedLinkedMood = null;
    let selectedEnergy = 5; // default energy level (5-6 range)
    let selectedSleep = 7.5; // default sleep (7-8 range)
    let selectedSleepQuality = null; // 'good' | 'bad' | null
    let selectedIntention = '';
    let selectedStepNotes = {}; // {stepId: noteText} — for Elaborate Responses
    let selectedMedication = null;
    let selectedAlcohol = null;
    let selectedExercise = null;
    let selectedAnxiety = null;
    let selectedIrritability = null;
    let selectedStress = null;
    let selectedOutside = null;
    let selectedSmoking = null;
    let selectedDrugs = null;
    let selectedCustom = {};
    let selectedPdfHide = false;
    let selectedFavourite = false;
    let _editFieldOverrides = null;    // non-null during openEditInForm; maps trackXxx -> bool
    let _editOriginalState = null;     // snapshot of entry when edit began, for change detection
    let _pickerEmoji = '';             // emoji selected in the custom-field add form
    let _pendingDeleteFieldId = null;  // id of custom field awaiting delete confirmation
    let _editingFieldId = null;        // id of custom field currently being edited inline
    let _editingBuiltinKey = null;     // key of built-in renameable field currently being edited
    let _editingFieldEmoji = '';       // emoji selected in the inline edit form
    let pendingDeleteKey = null;
    let pendingDraftClear = false;
    let _suppressFormOpen = false;
    let currentPage = 1;
    const entriesPerPage = 5;
    // One time range for the whole "Your Journey" card — stats, calendar, life
    // chart and the feedback popup's opening range — picked with the
    // 1M / 3M / 6M / 1Y / All tabs under the heading (James, 2026-09-30; it
    // replaced the 30 / 60 / 90 / custom dropdown). Days are counted back from
    // today, like the life chart. Tapping the range already showing makes it
    // the default (bbJournalRange, per device), like the Calendar / Life chart
    // switch.
    const _JOURNEY_RANGES = [[30, 'journal.lifeChart.r1m'], [90, 'journal.lifeChart.r3m'], [180, 'journal.lifeChart.r6m'], [365, 'journal.lifeChart.r1y'], ['all', 'journal.feedback.all']];
    const _RANGE_KEY = 'bbJournalRange';
    function _storedJourneyRange() {
      let v = null;
      try { v = localStorage.getItem(_RANGE_KEY); } catch (_) {}
      if (v === 'all') return 'all';
      const n = Number(v);
      return _JOURNEY_RANGES.some(r => r[0] === n) ? n : 30;
    }
    let statsTimeframe = _storedJourneyRange(); // 30 | 90 | 180 | 365 | 'all'
    let _journeyRangeNote = '';
    let currentStatsEntries = []; // cached for stat popups
    let _monthCalOffset = 0; // 0 = current month, -1 = previous month, etc.
    let _monthCalEntries = []; // cached entries for month calendar navigation
    let _isRetry = false; // true when loadEntries is being retried after a timeout
    let _loadInProgress = false; // guard against concurrent loadEntries() calls
    let _justLoggedIn = false; // true on first loadEntries after account login — used to set/suppress hints
    let statsStartDate = localStorage.getItem('statsStartDate') || null; // null = from first entry

    // Function to get energy button color (unified scheme: orange gradient)
    function getEnergyColor(level) {
      // Low energy (1-2): Light orange
      // Medium energy (5-6): Medium orange
      // High energy (9-10): Dark orange
      if (level <= 2) {
        return '#000'; // Light orange for low
      } else if (level <= 5.5) {
        return '#ff922b'; // Medium-light orange
      } else if (level <= 7.5) {
        return '#fd7e14'; // Medium orange
      } else {
        return '#e8590c'; // Dark orange for high
      }
    }

    // Function to get sleep button color — mirrors energy colour scheme
    function getSleepColor(hours) {
      if (hours <= 5)  return '#1e3a5f'; // ≤5h  — dark blue (poor sleep)
      if (hours < 7)   return '#ff922b'; // 6-7h  — same as Low energy
      if (hours <= 9)  return '#fd7e14'; // 7-8h, 8-9h — same as High energy
      return '#e8590c';                  // ≥10h — same as Full energy
    }

    // Initialize buttons after DOM is ready
    function initializeButtons() {
      // Initialize energy buttons with ranges
      const energySelector = document.getElementById('energySelector');
      if (!energySelector) return;

      // Compact single-line labels: emoji (pulled from the full i18n label) +
      // a short symbol, so all five buttons sit on one line each.
      const _enEmoji = key => (BB.t(key).split(' ')[0] || '');
      const energyRanges = [
        { label: `${_enEmoji('journal.energy.notEnough')} - -`, value: 0 },
        { label: `${_enEmoji('journal.energy.less')} -`, value: 3 },
        { label: `${_enEmoji('journal.energy.normal')} ${BB.t('journal.value.normal')}`, value: 5 },
        { label: `${_enEmoji('journal.energy.more')} +`, value: 7 },
        { label: `${_enEmoji('journal.energy.tooMuch')} ++`, value: 10 }
      ];
      
      energyRanges.forEach(range => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'energy-btn';
        btn.textContent = range.label;
        btn.dataset.energy = range.value;
        btn.dataset.color = getEnergyColor(range.value);
        
        btn.addEventListener('click', () => {
          document.querySelectorAll('.energy-btn').forEach(b => {
            b.classList.remove('selected');
            b.style.background = '#f8f9fa';
            b.style.color = '#495057';
          });
          btn.classList.add('selected');
          btn.style.background = btn.dataset.color;
          btn.style.color = 'white';
          selectedEnergy = parseFloat(btn.dataset.energy);
          _updateEnergyHero();
          scheduleDraftSave();
        });

        energySelector.appendChild(btn);
      });

      // Set default energy selection (5-6 range)
      const defaultEnergyBtn = document.querySelector('[data-energy="5"]');
      if (defaultEnergyBtn) {
        defaultEnergyBtn.classList.add('selected');
        defaultEnergyBtn.style.background = defaultEnergyBtn.dataset.color;
        defaultEnergyBtn.style.color = 'white';
      }

      // Initialize sleep buttons
      const sleepSelector = document.getElementById('sleepSelector');
      if (!sleepSelector) return;

      const sleepRanges = [
        { label: '≤5', value: 5 },
        { label: '6-7', value: 6.5 },
        { label: '7-9', value: 8 },
        { label: '9-10', value: 9.5 },
        { label: '10+', value: 11 }
      ];
      
      sleepRanges.forEach(range => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sleep-btn';
        btn.textContent = range.label;
        btn.dataset.sleep = range.value;
        btn.dataset.baseLabel = range.label;
        btn.dataset.color = getSleepColor(range.value);
        
        // Long-press detection: hold to reveal sleep quality; tap to select range only
        let _sqLpTimer = null, _sqLpFired = false, _sqLpX = 0, _sqLpY = 0;
        function _sqSelectBtn(b) {
          document.querySelectorAll('.sleep-btn').forEach(x => {
            x.classList.remove('selected');
            x.style.background = '#f8f9fa';
            x.style.color = '#495057';
          });
          b.classList.add('selected');
          b.style.background = b.dataset.color;
          b.style.color = 'white';
          selectedSleep = parseFloat(b.dataset.sleep);
          // Manual pick overrides any synced value
          _sleepHealthSynced = false;
          _updateSleepHero();
        }
        btn.addEventListener('pointerdown', e => {
          _sqLpFired = false;
          _sqLpX = e.clientX; _sqLpY = e.clientY;
          _sqLpTimer = setTimeout(() => {
            _sqLpFired = true;
            _sqSelectBtn(btn);
            const sq = document.getElementById('sleepQualitySubSection');
            if (sq) sq.style.display = '';
            nativeHaptic('medium');
            scheduleDraftSave();
          }, 500);
        });
        btn.addEventListener('pointermove', e => {
          if (_sqLpTimer && (Math.abs(e.clientX - _sqLpX) > 8 || Math.abs(e.clientY - _sqLpY) > 8)) {
            clearTimeout(_sqLpTimer); _sqLpTimer = null;
          }
        });
        btn.addEventListener('pointerup',     () => { clearTimeout(_sqLpTimer); _sqLpTimer = null; });
        btn.addEventListener('pointercancel', () => { clearTimeout(_sqLpTimer); _sqLpTimer = null; });
        btn.addEventListener('click', () => {
          if (_sqLpFired) { _sqLpFired = false; return; } // long-press already handled
          // Regular tap: select range, clear & hide sleep quality
          _sqSelectBtn(btn);
          selectedSleepQuality = null;
          if (typeof _applySleepQualityBtns === 'function') _applySleepQualityBtns();
          const sq = document.getElementById('sleepQualitySubSection');
          if (sq) sq.style.display = 'none';
          scheduleDraftSave();
        });

        sleepSelector.appendChild(btn);
      });

      // Set default sleep selection (7-9 range)
      const defaultSleepBtn = document.querySelector('[data-sleep="8"]');
      if (defaultSleepBtn) {
        defaultSleepBtn.classList.add('selected');
        defaultSleepBtn.style.background = defaultSleepBtn.dataset.color;
        defaultSleepBtn.style.color = 'white';
      }
      
      // Helper: wire a group of buttons with toggle-deselect behaviour
      function wireToggleGroup(attr, varSetter) {
        document.querySelectorAll(`[${attr}]`).forEach(btn => {
          btn.addEventListener('click', () => {
            const already = btn.classList.contains('selected');
            document.querySelectorAll(`[${attr}]`).forEach(b => b.classList.remove('selected'));
            if (!already) {
              btn.classList.add('selected');
              varSetter(btn.dataset[attr.replace('data-', '')]);
            } else {
              varSetter(null);
            }
          });
        });
      }

      wireToggleGroup('data-medication',   v => { selectedMedication   = v; scheduleDraftSave(); });
      wireToggleGroup('data-alcohol',      v => { selectedAlcohol      = v; scheduleDraftSave(); });
      wireToggleGroup('data-exercise',     v => { selectedExercise     = v; scheduleDraftSave(); });
      wireToggleGroup('data-anxiety',      v => { selectedAnxiety      = v; scheduleDraftSave(); });
      wireToggleGroup('data-irritability', v => { selectedIrritability = v; scheduleDraftSave(); });
      wireToggleGroup('data-stress',       v => { selectedStress       = v; scheduleDraftSave(); });
      wireToggleGroup('data-outside',      v => { selectedOutside      = v; scheduleDraftSave(); });
      wireToggleGroup('data-smoking',      v => { selectedSmoking      = v; scheduleDraftSave(); });
      wireToggleGroup('data-drugs',        v => { selectedDrugs        = v; scheduleDraftSave(); });

      // Apply tracking prefs (show/hide rows based on saved prefs)
      applyTrackingPrefs();
      _updateBudgetLabel();

      // Wire notes textarea to draft auto-save
      const notesEl = document.getElementById('notes');
      if (notesEl) notesEl.addEventListener('input', scheduleDraftSave);

      // No default selection for medication/alcohol/exercise
    }

    // ── More data open-by-default toggle ──
    function _applyMoreDataDefaultToggle(on) {
      const t = document.getElementById('moreDataDefaultSwitch');
      if (!t) return;
      t.style.background = on ? 'var(--brand-primary)' : '#dee2e6';
      t.children[0].style.transform = on ? 'translateX(14px)' : '';
    }
    function toggleMoreDataDefault() {
      const current = localStorage.getItem('moreDataOpenByDefault') === 'true';
      const next = !current;
      localStorage.setItem('moreDataOpenByDefault', next);
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ moreDataOpenByDefault: next }, { merge: true }).catch(() => {});
      }
      _applyMoreDataDefaultToggle(next);
    }
    window.toggleMoreDataDefault = toggleMoreDataDefault;

    function _toggleFmConfirmStep() {
      const chk = document.getElementById('fmConfirmStepToggle');
      const on = chk ? chk.checked : localStorage.getItem('fmConfirmStep') === 'true';
      localStorage.setItem('fmConfirmStep', on ? 'true' : 'false');
      if (currentUser && db) {
        db.collection('userSettings').doc(currentUser.uid)
          .set({ fmConfirmStep: on }, { merge: true }).catch(() => {});
      }
    }
    window._toggleFmConfirmStep = _toggleFmConfirmStep;

    let _pendingDeleteBuiltinKey = null;
    function deleteBuiltinField(key) {
      const _t = (k, vars) => (window.BB && BB.t) ? BB.t(k, vars) : k;
      const _labelKey = { trackExercise:'journal.label.exercise', trackOutside:'journal.label.goneOutside', trackAnxiety:'journal.label.emotions', trackAlcohol:'journal.label.alcohol' }[key];
      const _fieldLabel = _labelKey ? _t(_labelKey) : 'field';
      _pendingDeleteBuiltinKey = key;
      document.getElementById('confirmModalTitle').textContent = _t('journal.confirm.removeFieldTitle', { field: _fieldLabel });
      document.getElementById('confirmModalBody').textContent = _t('journal.confirm.removeFieldBody');
      document.getElementById('confirmModalBtn').textContent = _t('journal.confirm.removeBtn');
      document.getElementById('confirmModal').classList.add('active');
    }
    function _doDeleteBuiltinField(key) {
      const deleted = JSON.parse(localStorage.getItem('deletedBuiltinFields') || '[]');
      if (!deleted.includes(key)) { deleted.push(key); localStorage.setItem('deletedBuiltinFields', JSON.stringify(deleted)); }
      localStorage.setItem(key, 'false');
      applyTrackingPrefs();
      renderFieldPickerList();
      if (typeof _fmActive !== 'undefined' && _fmActive) {
        _fmSteps = _buildFocusedSteps();
        _fmStepIndex = Math.min(_fmStepIndex, _fmSteps.length - 1);
        _renderFocusedStep();
      }
    }
    window.deleteBuiltinField = deleteBuiltinField;
    window._doDeleteBuiltinField = _doDeleteBuiltinField;

    // ── PDF hide toggle ──
    function setPdfHide(val) {
      selectedPdfHide = !!val;
      const btn = document.getElementById('privateBtn');
      if (!btn) return;
      btn.style.opacity = selectedPdfHide ? '1' : '0.5';
      btn.style.borderColor = selectedPdfHide ? 'var(--brand-primary)' : '#dee2e6';
    }
    function _showFeatureHint(emoji, text, storageKey) {
      if (localStorage.getItem(storageKey) === '1') return;
      localStorage.setItem(storageKey, '1');
      _whenHintsDone(() => {
        const existing = document.getElementById('_featureHintToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = '_featureHintToast';
        toast.innerHTML = `<span style="font-size:1.4em;vertical-align:middle;margin-right:8px;">${emoji}</span><span>${text}</span>`;
        Object.assign(toast.style, {
          position:'fixed', bottom:'90px', left:'50%', transform:'translateX(-50%) translateY(10px)',
          background:'rgba(30,30,30,0.92)', color:'white',
          borderRadius:'12px', padding:'11px 18px', boxShadow:'0 4px 20px rgba(0,0,0,0.35)',
          fontSize:'0.85em', lineHeight:'1.4', zIndex:'9999', maxWidth:'280px', textAlign:'center',
          opacity:'0', transition:'opacity 0.3s ease, transform 0.3s ease', pointerEvents:'none',
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity='1'; toast.style.transform='translateX(-50%) translateY(0)'; });
        setTimeout(() => {
          toast.style.opacity='0'; toast.style.transform='translateX(-50%) translateY(10px)';
          setTimeout(() => toast.remove(), 300);
        }, 4500);
      });
    }

    function togglePdfHide() {
      setPdfHide(!selectedPdfHide);
      if (selectedPdfHide) _showFeatureHint('🕵️', BB.t('journal.hint.privateMode'), 'bbPrivateHintSeen');
      scheduleDraftSave();
    }
    window.togglePdfHide = togglePdfHide;
    function _fmTogglePdfHide() { togglePdfHide(); _renderFocusedStep(); }
    window._fmTogglePdfHide = _fmTogglePdfHide;

    // ── FM mood long press ──
    let _fmLongPressTimer = null;
    let _fmLongPressed = false;
    let _fmLinkMoodPickerOpen = false;
    function _fmLongPressStart(mood, e) {
      _fmLongPressed = false;
      // Prevent tap-and-hold during "Choose a mood" hint
      if (BB.storage.get('_fmChooseMoodHintDone') !== '1') return;
      _fmLongPressTimer = setTimeout(() => {
        _fmLongPressed = true;
        nativeHaptic && nativeHaptic('medium');
        // Dismiss the one-time hint permanently
        if (!BB.storage.get('_fmMoodTipShown')) {
          BB.storage.set('_fmMoodTipShown', '1');
          _renderFocusedStep();
        }
        showMoodInfo(mood);
      }, 600);
    }
    function _fmLongPressCancel() {
      clearTimeout(_fmLongPressTimer);
      _fmLongPressTimer = null;
    }
    function _fmMoodTap(mood) {
      if (_fmLongPressed) { _fmLongPressed = false; return; }
      // Dismiss "Choose a mood" hint on first tap
      if (BB.storage.get('_fmChooseMoodHintDone') !== '1') {
        BB.storage.set('_fmChooseMoodHintDone', '1');
        const _card = document.getElementById('focusedModeCard');
        if (_card) _card.style.zIndex = '';
        const _overlay = document.getElementById('bbHintOverlay');
        if (_overlay) _overlay.style.display = 'none';
        // Fall through — allow the tap to also select the mood
      }
      // Block taps during "Tap & Hold" hint — must long press
      if (BB.storage.get('_fmMoodTipShown') !== '1' &&
          BB.storage.get('_fmChooseMoodHintDone') === '1' &&
          BB.storage.get('_fmTapHoldHintReady') === '1') {
        const _hint = document.getElementById('_fmTapHoldHintEl');
        const _moodBtns = document.querySelectorAll('.mood-btn');
        [_hint, ..._moodBtns].forEach(el => {
          if (!el) return;
          const prev = el.style.animation;
          el.style.animation = 'none'; el.offsetHeight;
          el.style.animation = 'bbHintNudge 0.5s ease';
          setTimeout(() => { el.style.animation = prev; }, 520);
        });
        return;
      }
      // Linking mode: tap another mood to set as secondary, or tap primary to skip
      if (_fmLinkMoodPickerOpen) {
        _fmLinkMoodPickerOpen = false;
        if (mood !== selectedMood) {
          selectedLinkedMood = mood;
          scheduleDraftSave();
        }
        _fmAdvance();
        return;
      }
      _fmLinkMoodPickerOpen = false;
      _fmPrevMood = null; // clear any applied suggestion when user manually picks
      selectedLinkedMood = null; // fresh tap replaces both moods
      if (mood === 'depressed') {
        selectedMood = 'depressed';
        _renderFocusedStep();
        const _ec = localStorage.getItem('personalEmergencyContact') || '';
        const _ecEl = document.getElementById('depressedEmergencyContact');
        if (_ec && _ecEl) {
          document.getElementById('depressedEmergencyText').textContent = _ec;
          const _ecNum = _ec.match(/[\d\s\+\-\(\)]{6,}/)?.[0]?.trim();
          document.getElementById('depressedEmergencyLink').href = _ecNum ? 'tel:' + _ecNum.replace(/\s/g,'') : '#';
          _ecEl.style.display = '';
        } else if (_ecEl) {
          _ecEl.style.display = 'none';
        }
        document.getElementById('depressedSupportModal').classList.add('active');
        _fmMoodPop('depressed');
      } else {
        selectedMood = mood;
        _fmApplyMoodTheme(selectedMood); // tint straight away, not after the step change
        // Let the bear's pop finish before the step changes (it's ~0.34s;
        // _fmAdvance adds 180ms of its own). The index check stops a late
        // second tap from advancing twice.
        if (_fmMoodPop(mood)) {
          const _fromIdx = _fmStepIndex;
          setTimeout(() => { if (_fmStepIndex === _fromIdx) _fmAdvance(); }, 150);
        } else {
          _fmAdvance();
        }
      }
    }
    function _fmDismissDepressedMsg() {
      document.getElementById('depressedSupportModal').classList.remove('active');
      _fmAdvance();
    }
    // Focused-mode tap for the 0–10 spectrum wheel — commits the numeric mood.
    function _fmSpectrumTap(n) {
      n = Number(n);
      _fmLinkMoodPickerOpen = false;
      _fmPrevMood = null;
      selectedLinkedMood = null;
      selectedMood = n;
      if (n <= 1) {
        // Severe low — surface the same support modal as the 'depressed' category.
        _renderFocusedStep();
        const _ec = localStorage.getItem('personalEmergencyContact') || '';
        const _ecEl = document.getElementById('depressedEmergencyContact');
        if (_ec && _ecEl) {
          document.getElementById('depressedEmergencyText').textContent = _ec;
          const _ecNum = _ec.match(/[\d\s\+\-\(\)]{6,}/)?.[0]?.trim();
          document.getElementById('depressedEmergencyLink').href = _ecNum ? 'tel:' + _ecNum.replace(/\s/g,'') : '#';
          _ecEl.style.display = '';
        } else if (_ecEl) {
          _ecEl.style.display = 'none';
        }
        document.getElementById('depressedSupportModal').classList.add('active');
      } else {
        _fmAdvance();
      }
    }
    window._fmSpectrumTap = _fmSpectrumTap;
    window._fmLongPressStart = _fmLongPressStart;
    window._fmLongPressCancel = _fmLongPressCancel;
    window._fmMoodTap = _fmMoodTap;
    window._fmDismissDepressedMsg = _fmDismissDepressedMsg;

    // ── Favourite toggle ──
    function toggleFavourite() {
      selectedFavourite = !selectedFavourite;
      _updateFavouriteBtn();
      if (selectedFavourite) _showFeatureHint('★', BB.t('journal.hint.favourite'), 'bbFavouriteHintSeen');
      scheduleDraftSave();
    }
    function _updateFavouriteBtn() {
      const btn = document.getElementById('favouriteBtn');
      if (!btn) return;
      btn.textContent = selectedFavourite ? '★' : '☆';
      btn.style.color = selectedFavourite ? 'var(--brand-primary)' : '#adb5bd';
    }
    window.toggleFavourite = toggleFavourite;

    // ── Draft auto-save ──
    let _draftSaveTimer = null;

    function scheduleDraftSave() {
      clearTimeout(_draftSaveTimer);
      showDraftStatus('saving');
      _draftSaveTimer = setTimeout(saveDraft, 1500);
    }

    function showDraftStatus(state) {
      const els = [document.getElementById('draftStatus'), document.getElementById('fmDraftStatus')];
      els.forEach(el => {
        if (!el) return;
        const _t = (k) => (window.BB && BB.t) ? BB.t(k) : k;
        if (state === 'saving') {
          el.textContent = _t('journal.draft.saving');
          el.style.opacity = '1';
        } else if (state === 'saved') {
          el.textContent = _t('journal.draft.saved');
          el.style.opacity = '1';
          clearTimeout(el._fadeTimer);
          el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
        } else {
          el.textContent = '';
          el.style.opacity = '0';
        }
      });
    }

    function saveDraft() {
      // Early returns must clear the "Saving draft…" indicator that scheduleDraftSave()
      // showed — otherwise it stays visible forever (looks like a stuck save).
      if (_getOnboardingStep() === 0) { showDraftStatus('clear'); return; } // no drafts until first real entry is saved
      if (editingEntry) { showDraftStatus('clear'); return; }
      if (!_hasMood()) { showDraftStatus('clear'); return; }
      const targetKey = document.getElementById('entryDate')?.value;
      if (!targetKey) { showDraftStatus('clear'); return; }
      const draft = {
        targetKey,
        mood: selectedMood,
        linkedMood: selectedLinkedMood || null,
        energy: selectedEnergy,
        sleep: selectedSleep,
        sleepQuality: selectedSleepQuality || null,
        medication: selectedMedication,
        goals: selectedGoals,
        anxiety: selectedAnxiety,
        stress: selectedStress,
        irritability: selectedIrritability,
        exercise: selectedExercise,
        outside: selectedOutside,
        alcohol: selectedAlcohol,
        smoking: selectedSmoking,
        drugs: selectedDrugs,
        notes: document.getElementById('notes')?.value || '',
        intention: selectedIntention || '',
        customFields: { ...selectedCustom },
        pdfHide: selectedPdfHide,
        favourite: selectedFavourite,
        budget: selectedBudget,
        sleepSynced: _sleepHealthSynced,
        stepNotes: selectedStepNotes,
      };
      try { BB.storage.set('_draft', JSON.stringify(draft)); } catch(e) {}
      showDraftStatus('saved');
    }

    function clearDraft() {
      BB.storage.remove('_draft');
      showDraftStatus('clear');
    }

    function restoreDraft() {
      if (editingEntry) return;
      const targetKey = document.getElementById('entryDate')?.value;
      if (!targetKey) return;
      let draft;
      try { draft = JSON.parse(BB.storage.get('_draft') || 'null'); } catch(e) { return; }
      if (!draft || draft.targetKey !== targetKey || draft.mood == null || draft.mood === '') return;

      // Select mood (reveals rest of form)
      document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected', 'cycle-hover'));
      if (_isNumericMood(draft.mood)) {
        // Spectrum draft — restore via the slider control.
        selectedMood = Number(draft.mood);
        _applyMoodSpectrumMode();
        _setSpectrumValue(selectedMood);
      } else {
        const moodBtn = document.querySelector(`[data-mood="${draft.mood}"]`);
        if (!moodBtn) return;
        moodBtn.classList.add('selected');
        selectedMood = draft.mood;
      }
      selectedLinkedMood = draft.linkedMood || null;
      if (typeof _fmApplyMoodTheme === 'function') _fmApplyMoodTheme(_moodCat(draft.mood));
      document.querySelectorAll('.hidden-until-mood').forEach(el => {
        el.classList.remove('hidden-until-mood');
        el.classList.add('show-after-mood');
      });

      // Energy
      if (draft.energy != null) {
        selectedEnergy = draft.energy;
        document.querySelectorAll('.energy-btn').forEach(b => {
          const sel = parseFloat(b.dataset.energy) === draft.energy;
          b.classList.toggle('selected', sel);
          b.style.background = sel ? (b.dataset.color || getEnergyColor(draft.energy)) : '#f8f9fa';
          b.style.color = sel ? 'white' : '#495057';
        });
      }

      // Sleep
      if (draft.sleep != null) {
        selectedSleep = draft.sleep;
        _sleepHealthSynced = !!draft.sleepSynced;
        document.querySelectorAll('.sleep-btn').forEach(b => {
          const sel = parseFloat(b.dataset.sleep) === draft.sleep;
          b.classList.toggle('selected', sel);
          b.style.background = sel ? (b.dataset.color || getSleepColor(draft.sleep)) : '#f8f9fa';
          b.style.color = sel ? 'white' : '#495057';
        });
        // Only show "Sleep | Xh" on the sync button if sleep actually came from a health sync
        const _draftSleepBtn = document.getElementById('healthSleepBtn');
        if (_draftSleepBtn && draft.sleepSynced) _draftSleepBtn.textContent = `😴 Sleep | ${draft.sleep}h`;
      }

      selectedSleepQuality = draft.sleepQuality || null;
      if (typeof _applySleepQualityBtns === 'function') _applySleepQualityBtns();
      const _draftSqEl = document.getElementById('sleepQualitySubSection');
      if (_draftSqEl) _draftSqEl.style.display = selectedSleepQuality ? '' : 'none';
      selectedIntention = draft.intention || '';
      selectedStepNotes = (draft.stepNotes && typeof draft.stepNotes === 'object') ? { ...draft.stepNotes } : {};

      // Medication
      selectedMedication = draft.medication || null;
      document.querySelectorAll('[data-medication]').forEach(b => {
        b.classList.toggle('selected', b.dataset.medication === draft.medication);
      });

      // Goals
      selectedGoals = draft.goals || null;
      document.querySelectorAll('[data-goals]').forEach(b => {
        b.classList.toggle('selected', b.dataset.goals === draft.goals);
      });

      // Notes
      const notesEl = document.getElementById('notes');
      if (notesEl) notesEl.value = draft.notes || '';

      // Simple toggle fields
      const fieldMap = {
        anxiety: () => { selectedAnxiety = draft.anxiety; },
        stress:  () => { selectedStress  = draft.stress; },
        irritability: () => { selectedIrritability = draft.irritability; },
        exercise: () => { selectedExercise = draft.exercise; },
        outside:  () => { selectedOutside  = draft.outside; },
        alcohol:  () => { selectedAlcohol  = draft.alcohol; },
        smoking:  () => { selectedSmoking  = draft.smoking; },
        drugs:    () => { selectedDrugs    = draft.drugs; },
      };
      Object.entries(fieldMap).forEach(([f, setter]) => {
        if (draft[f] != null) {
          setter();
          document.querySelectorAll(`[data-${f}]`).forEach(b => {
            b.classList.toggle('selected', b.dataset[f] === draft[f]);
          });
        }
      });

      // Custom fields
      if (draft.customFields && Object.keys(draft.customFields).length > 0) {
        selectedCustom = { ...draft.customFields };
        renderCustomTrackingRows();
      }

      // PDF hide
      setPdfHide(!!draft.pdfHide);

      // Favourite
      selectedFavourite = !!draft.favourite;
      _updateFavouriteBtn();

      // Budget
      selectedBudget = draft.budget || null;
      document.querySelectorAll('[data-budget]').forEach(b => {
        b.classList.toggle('selected', b.dataset.budget === selectedBudget);
      });

      // Lock sleep if the restored draft targets today/future (clears any drafted value)
      _applySleepLock();

      // If focused mode is on, open at the done (review) step instead of leaving the regular form
      if (typeof _fmEnabled !== 'undefined' && _fmEnabled) {
        _fmSteps        = _buildFocusedSteps();
        _fmHighWater    = _fmSteps.length - 1;
        _fmStepIndex    = _fmSteps.length - 1;
        _fmActive        = true;
        _fmEnergyClear   = false;
        _fmSleepClear    = false;
        _fmSleepAutoSyncDone = false;
        _fmExtraSelected    = new Set();
        _fmPrevMood         = null;
        _fmReturnToDone     = false;
        _fmSuppressReopen   = false;
        document.getElementById('entryFormCard').style.display = 'none';
        const _fc = document.getElementById('focusedModeCard');
        if (_fc) {
          _fc.style.display = 'flex';
          const _el = document.getElementById('fmExitLink');
          if (_el) _el.style.display = '';
          _updateFocusModeBtn();
          _renderFocusedStep();
          setTimeout(() => {
            const _top = _fc.getBoundingClientRect().top + window.scrollY - 16;
            window.scrollTo({ top: _top, behavior: 'smooth' });
          }, 50);
        }
        return; // skip the draftStatus indicator — focused mode shows the summary
      }

      // Show "restored" indicator briefly
      const el = document.getElementById('draftStatus');
      if (el) {
        el.textContent = BB.t('journal.draft.restored');
        el.style.opacity = '1';
        clearTimeout(el._fadeTimer);
        el._fadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 3000);
      }
    }
    window.scheduleDraftSave = scheduleDraftSave;

    function toggleMoreData() {
      const section = document.getElementById('moreDataSection');
      const btn = document.getElementById('moreDataToggle');
      const opening = section.style.display === 'none';
      section.style.display = opening ? 'block' : 'none';
      btn.textContent = opening ? BB.t('journal.lessData') : BB.t('journal.moreData');
      if (opening) {
        setTimeout(() => {
          const notes = document.getElementById('notes');
          if (notes) notes.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      }
    }
    window.toggleMoreData = toggleMoreData;

    // Call initialization when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeButtons);
    } else {
      // Defer past script initialization — initializeButtons() references let/const variables
      // declared later in the script (e.g. editingEntry, _FM_MOOD_COLORS, isNative).
      // Calling it synchronously causes TDZ ReferenceErrors on Capacitor/WKWebView where
      // document.readyState is already 'complete' before the script finishes executing.
      setTimeout(initializeButtons, 0);
    }

    // Apply the mood-input mode (five buttons vs 0–10 spectrum slider) once the DOM is ready.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { try { _applyMoodSpectrumMode(); } catch(e) {} });
    } else {
      setTimeout(() => { try { _applyMoodSpectrumMode(); } catch(e) {} }, 0);
    }

    const moodValues = {
      'manic': 5,
      'elevated': 4,
      'stable': 3,
      'good': 3, // legacy alias
      'low': 2,
      'depressed': 1
    };

    const moodColors = {
      'manic': '#ff6b6b',
      'elevated': '#d2be00',
      'stable': '#51cf66',
      'good': '#51cf66', // legacy alias
      'low': '#845ef7',
      'depressed': '#5c7cfa'
    };

    const moodEmojis = {
      'manic': '🚀',
      'elevated': '✨',
      'stable': '😊',
      'good': '😊', // legacy alias
      'low': '😔',
      'depressed': '🌧️'
    };

    const _bipolarUkUrl = 'https://www.bipolaruk.org/faqs/track-your-mood-scale';
    const moodDefinitions = {
      manic:    { color: '#ff6b6b', text: 'Total loss of judgement, exorbitant spending, religious delusions and hallucinations. Lost touch with reality, incoherent, no sleep, paranoid and vindictive, reckless behaviour.' },
      elevated: { color: '#d2be00', text: 'Inflated self-esteem, rapid thoughts and speech, counter-productive simultaneous tasks. Very productive, everything to excess, charming and talkative.' },
      stable:   { color: '#51cf66', text: 'Self-esteem good, optimistic, sociable, and articulate, good decisions. Mood in balance, no symptoms of depression or mania.' },
      good:     { color: '#51cf66', text: 'Self-esteem good, optimistic, sociable, and articulate, good decisions. Mood in balance, no symptoms of depression or mania.' }, // legacy alias
      low:      { color: '#845ef7', text: 'Feelings of panic and anxiety, concentration difficult and memory poor, some comfort in routine. Slow thinking, no appetite, need to be alone, sleep excessive or difficult, everything a struggle.' },
      depressed:{ color: '#5c7cfa', text: 'Feelings of hopelessness and guilt, thoughts of suicide, little movement, impossible to do anything. Everything is bleak — please reach out to someone you trust or call Samaritans 116 123.' },
    };

    // ── Full mood spectrum (0–10) ────────────────────────────────────────
    // When the "Full mood spectrum" setting is on, an entry's `mood` is stored
    // as a RAW NUMBER 0–10 instead of a category string. Everything downstream
    // (colour / emoji / image / label / chart value) is derived from the number
    // via the helpers below, so legacy category-string entries and numeric
    // spectrum entries coexist without migration. Bands follow the Bipolar UK
    // mood scale: 0–1 severely depressed, 2–3 depressed, 4–6 stable/balanced,
    // 7–8 hypomanic, 9–10 manic — each band maps to one of the five legacy
    // categories so the existing colour / emoji / image assets are reused.
    const SPECTRUM_LABELS = {
      0: 'Severely depressed',
      1: 'Severely depressed',
      2: 'Depressed',
      3: 'Depressed',
      4: 'Sad but stable',
      5: 'Stable',
      6: 'Happy but stable',
      7: 'Hypomanic',
      8: 'Hypomanic',
      9: 'Manic',
      10: 'Manic',
    };
    function _spectrumEnabled() { return localStorage.getItem('moodSpectrumEnabled') === '1'; }
    // Focus mode's spinner-wheel experience is opt-in (BETA). Off by default →
    // focus mode renders each step as a plain tappable list (see _fmRenderContent).
    function _wheelMode() { return localStorage.getItem('wheelModeEnabled') === '1'; }
    // True only for a raw spectrum number (0–10); legacy category strings return false.
    function _isNumericMood(m) {
      return typeof m === 'number'
        ? isFinite(m)
        : (typeof m === 'string' && m.trim() !== '' && isFinite(Number(m)));
    }
    // Map any mood value to one of the five legacy categories.
    function _moodCat(m) {
      if (!_isNumericMood(m)) return m === 'good' ? 'stable' : m;
      const n = Number(m);
      if (n <= 1) return 'depressed';
      if (n <= 3) return 'low';
      if (n <= 6) return 'stable';
      if (n <= 8) return 'elevated';
      return 'manic';
    }
    // Category → mood image path (works for numbers via _moodCat).
    function _moodImg(m) { return `images/moods/${_moodCat(m)}.png`; }
    // Category emoji for any mood value (independent of any locally-shadowed map).
    function _moodEmoji(m) {
      const e = { manic:'🚀', elevated:'✨', stable:'😊', good:'😊', low:'😔', depressed:'🌧️' };
      return e[_moodCat(m)] || '';
    }
    // Numeric score on the legacy 1–5 axis (charts/regression/averages).
    // Spectrum 0→1 … 10→5 so numeric entries sit on the same axis as legacy ones
    // while preserving full 0–10 granularity.
    function _moodScore(m) {
      return _isNumericMood(m) ? 1 + (Number(m) / 10) * 4 : (moodValues[m] != null ? moodValues[m] : 3);
    }
    // Format a spectrum number for display (integers plain, else one decimal).
    function _fmtMoodNum(m) { const n = Number(m); return Number.isInteger(n) ? String(n) : n.toFixed(1); }
    // Translated label for a legacy category.
    function _moodCatLabel(cat) {
      const map = { manic:'mood.manic', elevated:'mood.elevated', stable:'mood.stable', good:'mood.stable', low:'mood.low', depressed:'mood.depressed' };
      const k = map[cat];
      if (k && window.BB && BB.t) return BB.t(k);
      return cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : '';
    }

    // ── bb_recentMoods: the home screen's last-7-days strip ──
    // Signed-in entries only exist encrypted in Firestore, so the home page
    // (which never decrypts) can't draw the strip for them. After each load of
    // decrypted entries — and loadEntries() re-runs after every save / edit /
    // delete — leave a tiny plaintext map ON THIS DEVICE ONLY:
    // {"YYYY-MM-DD": "manic|elevated|stable|low|depressed"} for today and the
    // 7 days before it. Mood category only — no notes, sleep or anything else.
    // Never synced to Firestore. Not written (and any existing copy removed)
    // with incognito mode on or an app / guest PIN set: the home screen paints
    // before the PIN unlock, so the strip would show moods to anyone holding
    // the phone. Read by localMoodsByDay() in js/index.js (BLOCK 3c), whose
    // day key (local date of entry.date) and categories this mirrors.
    // Cleared by logout(), deleteAllEntries() and index.js's logout / reset.
    function _recentMoodsBlocked() {
      return localStorage.getItem('incognitoMode') === 'true'
        || BB.storage.get('NativePinEnabled') === '1'
        || !!BB.storage.get('GuestPinSalt');
    }
    function _writeRecentMoods(entries) {
      try {
        if (_recentMoodsBlocked()) { BB.storage.remove('_recentMoods'); return; }
        const toKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const keep = {};
        const d = new Date(); d.setHours(0, 0, 0, 0);
        for (let i = 0; i <= 7; i++) { keep[toKey(d)] = true; d.setDate(d.getDate() - 1); }
        const out = {}, stamp = {};
        (entries || []).forEach(e => {
          if (!e || !e.date) return;
          const cat = _moodCat(e.mood);
          if (['manic', 'elevated', 'stable', 'low', 'depressed'].indexOf(cat) < 0) return;
          const dt = new Date(e.date);
          if (isNaN(dt)) return;
          const day = toKey(dt);
          if (!keep[day]) return;
          const ts = Number(e.timestamp) || 0;
          if (!(day in stamp) || ts >= stamp[day]) { out[day] = cat; stamp[day] = ts; }
        });
        if (Object.keys(out).length) BB.storage.set('_recentMoods', JSON.stringify(out));
        else BB.storage.remove('_recentMoods');
      } catch (_) {
      } finally {
        // Same dots on the native home-screen widget (cleared when blocked).
        try { BB.platform.syncWidgetMoods(); } catch (_) {}
      }
    }
    // Re-evaluate after a privacy setting changes (incognito / PIN on or off).
    function _refreshRecentMoods() { _writeRecentMoods(_allEntries); }
    // Descriptive label for any mood value (spectrum → band description, else category name).
    function _moodLabelOf(m) {
      if (_isNumericMood(m)) {
        const r = Math.max(0, Math.min(10, Math.round(Number(m))));
        return SPECTRUM_LABELS[r] || _moodCatLabel(_moodCat(m));
      }
      return _moodCatLabel(m);
    }
    // Label with the number appended for spectrum moods, e.g. "Sad but stable (4)".
    function _moodLabelNum(m) {
      return _isNumericMood(m) ? `${_moodLabelOf(m)} (${_fmtMoodNum(m)})` : _moodLabelOf(m);
    }
    // A mood is "chosen" when it's set — including the spectrum value 0 (which is falsy).
    function _hasMood() { return selectedMood != null && selectedMood !== ''; }

    // Mood selection
    document.querySelectorAll('.mood-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mood = btn.dataset.mood;
        if (mood === selectedMood) {
          showMoodInfo(mood);
          return;
        }
        document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedMood = mood;
        if (typeof _fmApplyMoodTheme === 'function') _fmApplyMoodTheme(mood);
        scheduleDraftSave();

        // One-time tip: "tap the mood again to see more info"
        const _tipEl = document.getElementById('moodSelectorTip');
        if (_tipEl && !window.Capacitor && !BB.storage.get('_moodTipShown')) {
          BB.storage.set('_moodTipShown', '1');
          _tipEl.textContent = (window.BB && BB.t) ? BB.t('journal.moodInfo.clickAgainTip') : '💡 Click again for more info';
          _tipEl.style.display = '';
          setTimeout(() => { _tipEl.style.opacity = '0'; _tipEl.style.transition = 'opacity 0.5s'; setTimeout(() => { _tipEl.style.display = 'none'; _tipEl.style.opacity = ''; _tipEl.style.transition = ''; }, 500); }, 3000);
        }

        // Show the rest of the form
        document.querySelectorAll('.hidden-until-mood').forEach(el => {
          el.classList.remove('hidden-until-mood');
          el.classList.add('show-after-mood');
        });
        _updateEnergyHero();
        _updateSleepHero();
        // Auto-sync health data if setting is ON. Pass isAuto=true so these
        // never raise the OS permission sheet from an ordinary mood tap — they
        // only run when access was already granted (see importStepsFromHealth).
        if (BB.storage.get('HealthSyncEnabled') === '1') {
          importStepsFromHealth(true);
          importSleepFromHealth(true);
        }

        // Smooth scroll to top of tracker card after form appears
        setTimeout(() => {
          const trackerCard = document.querySelector('.mood-selector').closest('.card');
          if (trackerCard) {
            trackerCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      });
    });

    function showMoodInfo(mood) {
      const def = moodDefinitions[mood];
      if (!def) return;
      const _t = (k, vars) => (window.BB && BB.t) ? BB.t(k, vars) : k;
      const _moodKeyMap = { manic:'mood.manic', elevated:'mood.elevated', stable:'mood.good', good:'mood.good', low:'mood.low', depressed:'mood.depressed' };
      const _moodKey = _moodKeyMap[mood];
      const label = (_moodKey && window.BB && BB.t) ? BB.t(_moodKey) : (mood.charAt(0).toUpperCase() + mood.slice(1));
      document.getElementById('moodInfoHeader').style.background = def.color;
      document.getElementById('moodInfoIcon').src = _moodImg(mood);
      document.getElementById('moodInfoIcon').alt = label;
      document.getElementById('moodInfoLabel').textContent = label;

      // Personal mood definition (survival-kit keys: elevated→hypomanic, good→stable)
      const _defKey = mood === 'elevated' ? 'hypomanic' : mood;
      let _personalDef = '';
      try {
        const _defs = JSON.parse(localStorage.getItem('moodDefinitions') || '{}');
        _personalDef = _defs[_defKey] || '';
      } catch(e) {}

      // Bipolar UK definition text is kept in English — it's sourced from Bipolar UK
      // and translating it would produce unofficial medical content. The UI chrome
      // around it (toggle button, link label) is translated below.
      const _bipolarHtml = `${def.text}<br><a href="${_bipolarUkUrl}" target="_blank" style="color:var(--brand-primary);font-size:0.82em;white-space:nowrap;">${_t('journal.moodInfo.bipolarUkLink')}</a>`;
      if (_personalDef) {
        // Initial state: body collapsed → button shows the "click here" prompt.
        document.getElementById('moodInfoBody').innerHTML = `<button onclick="window._toggleBipolarDef(this)" style="background:none;border:none;color:#adb5bd;font-size:0.82em;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:2px;-webkit-tap-highlight-color:transparent;">${_t('journal.moodInfo.bipolarUkToggleOpen')}</button><div id="_moodBipBody" style="display:none;margin-top:6px;font-size:0.9em;color:#495057;line-height:1.65;">${_bipolarHtml}</div>`;
      } else {
        document.getElementById('moodInfoBody').innerHTML = _bipolarHtml;
      }

      const defBox = document.getElementById('moodInfoDefinition');
      if (_personalDef) {
        document.getElementById('moodInfoDefinitionText').textContent = `"${_personalDef}"`;
        defBox.style.display = '';
      } else {
        defBox.style.display = 'none';
      }

      // Coping strategies for this mood
      let strategies = [];
      try {
        const all = JSON.parse(localStorage.getItem('copingStrategies') || '{}');
        strategies = all[mood] || [];
      } catch(e) {}
      const copingBox = document.getElementById('moodInfoCoping');
      const copingList = document.getElementById('moodInfoCopingList');
      if (strategies.length > 0) {
        copingList.innerHTML = strategies.map(s =>
          `<div style="padding:7px 10px;background:#f8f9fa;border-radius:8px;margin-bottom:5px;font-size:0.88em;color:#495057;line-height:1.4;">${s}</div>`
        ).join('');
        copingBox.style.display = '';
      } else {
        copingBox.style.display = 'none';
      }

      // Memories for this mood
      let memories = [];
      try {
        const allMem = JSON.parse(localStorage.getItem('moodMemories') || '{}');
        memories = allMem[mood] || [];
      } catch(e) {}
      const memoriesBox = document.getElementById('moodInfoMemories');
      const memoriesList = document.getElementById('moodInfoMemoriesList');
      if (memoriesBox && memoriesList) {
        const lastMem = memories.length > 0 ? memories[memories.length - 1] : null;
        if (lastMem) {
          const text = typeof lastMem === 'object' ? lastMem.text : lastMem;
          const date = typeof lastMem === 'object' && lastMem.date ? lastMem.date : null;
          memoriesList.innerHTML = `<div style="padding:7px 10px;background:#f8f9fa;border-radius:8px;font-size:0.88em;color:#495057;line-height:1.4;">
            ${date ? `<div style="font-size:0.8em;color:#adb5bd;margin-bottom:2px;">${date}</div>` : ''}${text}</div>`;
          memoriesBox.style.display = '';
        } else {
          memoriesBox.style.display = 'none';
        }
      }

      // Show survival guide link only when no personal data exists for this mood
      const hasPersonalData = _personalDef || strategies.length > 0 || memories.length > 0;
      document.getElementById('moodInfoSurvivalLink').style.display = hasPersonalData ? 'none' : '';

      // Link mood button
      const _linkRow = document.getElementById('moodInfoLinkRow');
      const _linkBtn = document.getElementById('moodInfoLinkBtn');
      const _linkCaption = document.getElementById('moodInfoLinkCaption');
      if (_linkRow && _linkBtn) {
        const _tMoodName = (m) => {
          const _map = { manic:'mood.manic', elevated:'mood.elevated', stable:'mood.good', good:'mood.good', low:'mood.low', depressed:'mood.depressed' };
          if (_map[m] && window.BB && BB.t) return BB.t(_map[m]);
          return m.charAt(0).toUpperCase() + m.slice(1);
        };
        const _moodLinkingOn = localStorage.getItem('moodLinkingEnabled') === '1';
        const _isPrimary = selectedMood && mood === selectedMood;
        const _isDifferent = selectedMood && mood !== selectedMood;
        if (_isPrimary && _moodLinkingOn) {
          // Long-pressed own mood — offer to open secondary picker
          _linkRow.style.display = '';
          if (selectedLinkedMood) {
            _linkBtn.textContent = _t('journal.moodInfo.removeLinkedWithMood', { mood: _tMoodName(selectedLinkedMood) });
            _linkCaption.style.display = 'none';
            _linkBtn.onclick = () => {
              selectedLinkedMood = null;
              _fmLinkMoodPickerOpen = false;
              closeMoodInfo();
              if (typeof _fmActive !== 'undefined' && _fmActive) _renderFocusedStep();
              scheduleDraftSave();
            };
          } else {
            _linkBtn.textContent = _t('journal.moodInfo.addSecondary');
            _linkCaption.style.display = '';
            _linkBtn.onclick = () => {
              _fmLinkMoodPickerOpen = true;
              closeMoodInfo();
              if (typeof _fmActive !== 'undefined' && _fmActive) _renderFocusedStep();
            };
          }
        } else if (_isDifferent && _moodLinkingOn) {
          // Long-pressed a different mood — offer to link it directly
          _linkRow.style.display = '';
          if (selectedLinkedMood === mood) {
            _linkBtn.textContent = _t('journal.moodInfo.removeLinked');
            _linkCaption.style.display = 'none';
            _linkBtn.onclick = () => {
              selectedLinkedMood = null;
              closeMoodInfo();
              if (typeof _fmActive !== 'undefined' && _fmActive) _renderFocusedStep();
              scheduleDraftSave();
            };
          } else {
            _linkBtn.textContent = _t('journal.moodInfo.linkAsSecondary', { mood: _tMoodName(mood) });
            _linkCaption.style.display = '';
            _linkBtn.onclick = () => {
              selectedLinkedMood = mood;
              _fmLinkMoodPickerOpen = false;
              closeMoodInfo();
              scheduleDraftSave();
              if (typeof _fmActive !== 'undefined' && _fmActive) {
                _renderFocusedStep();
                setTimeout(() => _fmAdvance(), 600);
              }
            };
          }
        } else if (!selectedMood && _moodLinkingOn && typeof _fmActive !== 'undefined' && _fmActive) {
          // No primary selected yet in focus mode — offer to select this as primary and enter link mode
          _linkRow.style.display = '';
          _linkBtn.textContent = _t('journal.moodInfo.linkMood');
          _linkCaption.textContent = _t('journal.moodInfo.linkMoodCaption');
          _linkCaption.style.display = '';
          _linkBtn.onclick = () => {
            selectedMood = mood;
            _fmLinkMoodPickerOpen = true;
            closeMoodInfo();
            _renderFocusedStep();
          };
        } else {
          _linkRow.style.display = 'none';
        }
      }

      document.getElementById('moodInfoModal').classList.add('active');
      // Hint 3: "Close to continue" — shown when tap+hold hint was just fired (first time seeing moodInfoModal)
      if (BB.storage.get('_fmMoodInfoCloseHintDone') !== '1') {
        const _mi = document.getElementById('moodInfoModal');
        if (_mi) _mi.dataset.closeHintActive = '1';
        const _confirmBtns = document.querySelector('#moodInfoModal .confirm-buttons');
        if (_confirmBtns && !document.getElementById('_fmMoodInfoCloseHintEl')) {
          const _ch = document.createElement('div');
          _ch.id = '_fmMoodInfoCloseHintEl';
          _ch.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:4px;margin-right:8px;pointer-events:none;animation:hintFade 2.4s ease-in-out infinite;';
          _ch.innerHTML = `<span style="font-size:0.72em;font-weight:700;font-style:italic;color:var(--brand-primary);font-family:'Georgia',serif;letter-spacing:0.01em;">${BB.t('journal.hint.closeToContinue')}</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><line x1="2" y1="8" x2="13" y2="8" stroke="var(--brand-primary)" stroke-width="2" stroke-linecap="round"/><polyline points="8,3 13,8 8,13" stroke="var(--brand-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
          _confirmBtns.insertBefore(_ch, _confirmBtns.firstChild);
          const _closeBtn = _confirmBtns.querySelector('.confirm-btn-no');
          if (_closeBtn) _closeBtn.style.zIndex = '1001';
        }
      }
    }

    function closeMoodInfo() {
      // Dismiss hint 3 if active
      if (BB.storage.get('_fmMoodInfoCloseHintDone') !== '1') {
        BB.storage.set('_fmMoodInfoCloseHintDone', '1');
        const _mi = document.getElementById('moodInfoModal');
        if (_mi) delete _mi.dataset.closeHintActive;
        const _ch = document.getElementById('_fmMoodInfoCloseHintEl');
        if (_ch) _ch.remove();
        const _closeBtn = document.querySelector('#moodInfoModal .confirm-btn-no');
        if (_closeBtn) _closeBtn.style.zIndex = '';
        // Re-render so tap+hold hint disappears and overlay clears
        if (typeof _fmActive !== 'undefined' && _fmActive) setTimeout(() => _renderFocusedStep(), 50);
      }
      document.getElementById('moodInfoModal').classList.remove('active');
    }

    window.closeMoodInfo = closeMoodInfo;
    window.showMoodInfo = showMoodInfo;
    // Toggle the collapsed/expanded Bipolar UK definition body inside the mood-info modal.
    // Key naming is inverted from intuition: bipolarUkToggleOpen is the "click here" prompt
    // shown when the body is collapsed; bipolarUkToggleClosed is the plain label shown when
    // it's expanded. Don't rename without updating all 10 locales.
    window._toggleBipolarDef = function(btn) {
      const _t = (k) => (window.BB && BB.t) ? BB.t(k) : k;
      const body = document.getElementById('_moodBipBody');
      if (!body) return;
      const wasOpen = body.style.display !== 'none';
      body.style.display = wasOpen ? 'none' : '';
      btn.textContent = _t(wasOpen ? 'journal.moodInfo.bipolarUkToggleOpen' : 'journal.moodInfo.bipolarUkToggleClosed');
    };

    // Don't set default selection - user must choose
    // const goodBtn = document.querySelector('[data-mood="good"]');
    // if (goodBtn) {
    //   goodBtn.classList.add('selected');
    //   selectedMood = 'good';
    // }

    // Auto-cycle mood buttons when none is selected and user isn't hovering
    (function() {
      const moodBtns = Array.from(document.querySelectorAll('.mood-btn'));
      let cycleIndex = 0;
      let cycleInterval = null;
      let hovered = false;

      function applyHover(btn) {
        moodBtns.forEach(b => b.classList.remove('cycle-hover'));
        if (btn) btn.classList.add('cycle-hover');
      }

      function startCycle() {
        if (cycleInterval || selectedMood || _spectrumEnabled()) return;
        cycleInterval = setInterval(() => {
          if (selectedMood || hovered) {
            stopCycle(); // self-terminate — no point running after mood is chosen
            return;
          }
          applyHover(moodBtns[cycleIndex % moodBtns.length]);
          cycleIndex++;
        }, 1000);
      }

      function stopCycle() {
        clearInterval(cycleInterval);
        cycleInterval = null;
        applyHover(null);
      }

      moodBtns.forEach(btn => {
        btn.addEventListener('mouseenter', () => { hovered = true; applyHover(null); });
        btn.addEventListener('mouseleave', () => { hovered = false; });
        btn.addEventListener('click', () => stopCycle());
      });

      // Pause when app is backgrounded, resume when foregrounded (if no mood selected)
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopCycle();
        else if (!selectedMood) startCycle();
      });

      // Release Firestore's IndexedDB lock before navigating away.
      // Without this, the next journal load races for the lock and hangs.
      window.addEventListener('pagehide', () => {
        try { if (db) db.terminate(); } catch (e) {}
        // Only clear PIN unlock for logged-in users — guests keep their session
        // unlocked across page navigations (the session key in sessionStorage is
        // the actual security layer; re-prompting PIN on every nav back is just annoying)
        if (currentUser) sessionStorage.removeItem('bbPinUnlocked');
      });

      // When iOS WKWebView restores this page from the back-forward cache (bfcache),
      // event.persisted === true and the page resumes with the already-terminated Firestore
      // instance — every read fails immediately. Force a clean reload so Firestore
      // re-initialises properly, exactly as if the user opened the page fresh.
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) window.location.reload();
      });

      // For first-time users (no entries yet), start cycle on Stable so it's pre-highlighted
      if (!BB.storage.get('HasEntries') && !selectedMood && moodBtns[2]) {
        cycleIndex = 2;
        applyHover(moodBtns[2]);
      }
      startCycle();
      window._startMoodCycle = startCycle;

      // Silently close journal entries section when user interacts with the entry form
      const _efc = document.getElementById('entryFormCard');
      if (_efc) {
        _efc.addEventListener('pointerdown', () => {
          const jc = document.getElementById('journalCard');
          if (jc && jc.style.display !== 'none' && jc.style.display !== '') {
            jc.style.display = 'none';
            const toggleBtn = document.getElementById('journalToggleBtn');
            if (toggleBtn) toggleBtn.textContent = BB.t('journal.btn.openJournal');
          }
        }, { capture: true, passive: true });
      }
    })();

    // Bipolar Anonymous "How are you today?", answered by the journal (30 Sep
    // 2026). Only for an account that also has a board moniker (Anon_linked,
    // from userSettings.anonProfile.monika) and hasn't switched it off on the
    // board (anonProfile.journalCheckin === false → Anon_journalCheckin '0').
    // Only an entry for today or yesterday counts, and only its mood category
    // leaves the device — into the board's daily totals, where the server keeps
    // no record of who picked what. One check-in per account per UK day; the
    // server ignores any after the first.
    async function _anonJournalCheckin(entry) {
      try {
        if (!currentUser) return;
        if (BB.storage.get('Anon_linked') !== '1' && !BB.storage.get('Anon_monika')) return;
        if (BB.storage.get('Anon_journalCheckin') === '0') return;
        const cat = _moodCat(entry.mood);
        if (!['manic', 'elevated', 'stable', 'low', 'depressed'].includes(cat)) return;
        const d = new Date(entry.date); d.setHours(0, 0, 0, 0);
        const t = new Date(); t.setHours(0, 0, 0, 0);
        const ago = Math.round((t - d) / 86400000);
        if (ago < 0 || ago > 1) return;
        if (typeof firebase === 'undefined' || !firebase.app || typeof firebase.app().functions !== 'function') return;
        const res = await firebase.app().functions('europe-west1').httpsCallable('anonMoodCheckin')({ mood: cat, source: 'journal' });
        // Same device as the board (inside Bipolar Bear): let it say "You: …".
        if (res && res.data && res.data.via === 'journal' && res.data.day) {
          BB.storage.set('Anon_mood', JSON.stringify({ day: res.data.day, mood: cat }));
        }
      } catch (e) { console.warn('[journal] board check-in skipped', e); }
    }

    async function saveEntry() {
      if (!_hasMood()) {
        alert(BB.t('journal.toast.selectMood'));
        return;
      }

      // Test localStorage access
      try {
        localStorage.setItem('test', 'test');
        localStorage.removeItem('test');
      } catch(e) {
        alert(BB.t('journal.dlg.localStorageDisabled'));
        return;
      }

      // Get the selected date from the date picker
      const dateInput = document.getElementById('entryDate');
      const selectedDate = dateInput.value ? new Date(dateInput.value + 'T12:00:00') : new Date();
      
      const now = new Date();
      const entry = {
        date: selectedDate.toISOString(),
        mood: selectedMood,
        linkedMood: selectedLinkedMood || null,
        energy: selectedEnergy,
        sleep: selectedSleep,
        sleepQuality: selectedSleepQuality || null,
        medication: selectedMedication,
        goals: selectedGoals,
        alcohol: selectedAlcohol,
        exercise: selectedExercise,
        anxiety: selectedAnxiety,
        irritability: selectedIrritability,
        stress: selectedStress,
        outside: selectedOutside,
        smoking: selectedSmoking,
        drugs: selectedDrugs,
        notes: document.getElementById('notes').value,
        intention: selectedIntention || '',
        customFields: Object.fromEntries(Object.entries(selectedCustom).filter(([,v]) => v)),
        budget: selectedBudget || null,
        pdfHidden: selectedPdfHide || false,
        favourite: selectedFavourite || false,
        timestamp: selectedDate.getTime(),
        recordedAt: now.toISOString(),
        recordedTz: Intl.DateTimeFormat().resolvedOptions().timeZone
      };

      // An auto-filled day the user has now opened and saved is no longer a
      // guess — drop the flag so the AUTO badge and PDF note disappear.
      if (editingEntry && editingEntry.autoFilled) {
        entry.autoFilled = false;
        entry.autoFilledSource = null;
      }

      // A day filled by the first-step auto-fill is a guess in exactly the way
      // the missing-days auto-complete's are, so it gets the same AUTO mark —
      // unless the user changed one of the three values it wrote on the way to
      // saving, which makes the entry theirs.
      if (!editingEntry && _fmDayFillIntact()) {
        entry.autoFilled = true;
        entry.autoFilledSource = 'health';
      }

      // Attach steps from health sync for new entries (backfill only updates existing entries)
      if (!editingEntry && window._healthStepsByDate) {
        const dKey = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth()+1).padStart(2,'0')}-${String(selectedDate.getDate()).padStart(2,'0')}`;
        if (window._healthStepsByDate[dKey] != null) entry.steps = window._healthStepsByDate[dKey];
      }

      try {
        if (currentUser) {
          entry.userId = currentUser.uid;
          if (_userCryptoKey) {
            // Encrypt the full entry; keep userId + timestamp plaintext for Firestore queries
            const merged = editingEntry ? { ...editingEntry, ...entry } : entry;
            const enc = await _userEncrypt(_userCryptoKey, merged);
            const fsEntry = { userId: currentUser.uid, timestamp: entry.timestamp, ...enc };
            if (editingEntry && editingEntry.id) {
              await db.collection('entries').doc(editingEntry.id).set(fsEntry);
            } else {
              await db.collection('entries').add(fsEntry);
            }
          } else {
            // No key yet (e.g. session-key missing) — save plaintext as fallback
            if (editingEntry && editingEntry.id) {
              await db.collection('entries').doc(editingEntry.id).set({ ...editingEntry, ...entry });
            } else {
              await db.collection('entries').add(entry);
            }
          }
        } else {
          if (editingEntry) {
            const key = editingEntry.id || `entry:${editingEntry.timestamp}`;
            if (_guestCryptoKey) {
              const enc = await _guestEncrypt(_guestCryptoKey, { ...editingEntry, ...entry });
              localStorage.setItem(key, JSON.stringify(enc));
            } else {
              localStorage.setItem(key, JSON.stringify({ ...editingEntry, ...entry }));
            }
          } else {
            const entryKey = `entry:${entry.timestamp}`;
            if (_guestCryptoKey) {
              const enc = await _guestEncrypt(_guestCryptoKey, entry);
              localStorage.setItem(entryKey, JSON.stringify(enc));
            } else {
              localStorage.setItem(entryKey, JSON.stringify(entry));
            }
          }
        }
        
        // Reset edit state
        const _wasNewEntry = !editingEntry;
        editingEntry = null;
        _editFieldOverrides = null;
        document.getElementById('submitBtn').textContent = newEntryBtnLabel();

        // Schedule anniversary notification for favourited entries
        if (entry.favourite && isNative()) {
          _scheduleAnniversaryNotif(selectedDate.getMonth() + 1, selectedDate.getDate());
        }

        clearDraft();
        // Advance onboarding step on first real entry save (not an edit)
        if (_wasNewEntry && _getOnboardingStep() === 0) _advanceOnboardingStep(1);
        resetEntryForm();
        if (typeof _fmEnabled !== 'undefined' && _fmEnabled && !_fmSuppressReopen) {
          // Only reopen focused mode if the saved date is still the "current" tracking date
          const _todayMode = localStorage.getItem('journalDefaultToday') === 'true';
          const _now = new Date(); _now.setHours(0,0,0,0);
          const _yest = new Date(_now); _yest.setDate(_now.getDate() - 1);
          const _toKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const _currentKey = _todayMode ? _toKey(_now) : _toKey(_yest);
          const _savedKey = _toKey(selectedDate);
          if (_savedKey === _currentKey) _openFocusedMode();
        }
        if (_fmSuppressReopen && typeof _fmActive !== 'undefined' && _fmActive) {
          _fmActive = false;
          document.getElementById('focusedModeCard').style.display = 'none';
          const _els = document.getElementById('fmExitLink');
          if (_els) _els.style.display = 'none';
        }
        _fmSuppressReopen = false;
        _fmReturnToDone   = false;
        // Reset date to default after clearing form
        setDefaultDate();

        currentPage = 1; // Reset to first page to see new entry
        // Activate advanced settings badge on the entry after tutorial completes
        if (_wasNewEntry && BB.storage.get('AdvancedBadgePending') === '1') {
          BB.storage.remove('AdvancedBadgePending');
          BB.storage.set('AdvancedBadgeVisible', '1');
          _updateAdvancedBadge();
        }
        // Activate tap & hold mood hint on the entry after the settings tutorial completes
        if (_wasNewEntry && BB.storage.get('_fmTapHoldHintPending') === '1') {
          BB.storage.remove('_fmTapHoldHintPending');
          BB.storage.set('_fmTapHoldHintReady', '1');
        }
        // Only a fresh, hand-logged entry can earn the review prompt — edits and
        // auto-filled guesses don't count as a win. loadEntries() decides.
        if (_wasNewEntry && !entry.autoFilled) _reviewCandidateMood = entry.mood;
        // Opt-in early-warning check runs on the reloaded entries (js/journal-insights.js).
        if (window.BBInsights) window.BBInsights.noteSaved();
        if (currentUser && !entry.autoFilled) _anonJournalCheckin(entry);
        loadEntries();
        nativeHaptic('success');
      } catch (error) {
        console.error('❌ Error saving:', error);
        console.error('Error type:', error.constructor.name);
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Error stack:', error.stack);
        console.error('currentUser value:', currentUser);
        
        if (!currentUser) {
          // Guest mode error
          alert(BB.t('journal.dlg.saveLocalFail', { msg: error.message }));
        } else if (error.code === 'permission-denied') {
          alert(BB.t('journal.dlg.savePermDenied'));
        } else if (error.code === 'unavailable' || error.message?.includes('network')) {
          alert(BB.t('journal.dlg.saveNetwork'));
        } else {
          alert(BB.t('journal.dlg.saveEntryFail') + error.message);
        }
      }
    }

    const _STEP_NOTE_LABELS = { sleep:'Sleep', sleepQuality:'Sleep quality', energy:'Energy', medication:'Medication', goals:'Goals', anxiety:'Anxiety', stress:'Stress', irritability:'Irritability', exercise:'Exercise', outside:'Outside', alcohol:'Alcohol', budget:'Budget' };
    let _savingEntry = false;
    async function saveAndOpenJournal() {
      if (_savingEntry) return;
      _savingEntry = true;
      // Combine step notes into intention field (Elaborate Responses)
      if (localStorage.getItem('elaborateResponsesEnabled') === 'true') {
        const _noteLines = Object.entries(selectedStepNotes)
          .filter(([,v]) => v && v.trim())
          .map(([k,v]) => `${_STEP_NOTE_LABELS[k] || k}: ${v.trim()}`);
        if (_noteLines.length) {
          const _intBase = selectedIntention ? selectedIntention.replace(/\n*_{3,}[\s\S]*$/, '').trimEnd() : '';
          selectedIntention = (_intBase ? _intBase + '\n' : '') + '___\n' + _noteLines.join('\n');
        }
        const fmInt = document.getElementById('fmIntentionInput');
        if (fmInt) fmInt.value = selectedIntention;
      }
      // Guest PIN: require PIN creation before first save.
      // Also triggers if bbPinEnabled='1' but no salt — stale data from the old optional
      // PIN feature that has no encryption. Treat it as "no PIN" and set up fresh.
      if (!currentUser && (BB.storage.get('PinEnabled') !== '1' || !BB.storage.get('GuestPinSalt'))) {
        _savingEntry = false;
        _showGuestPinSetup(async () => {
          _savingEntry = true;
          try { await saveEntry(); } finally { _savingEntry = false; }
        });
        return;
      }
      try { await saveEntry(); } finally { _savingEntry = false; }
    }

    // ── Guest → Account migration ──
    // Called on every sign-in. Uploads localStorage entries to Firestore only if the
    // account is brand new (0 Firestore entries), so returning users are never affected.
    async function migrateGoodMoodToStable(user) {
      // One-time migration: rename mood 'good' → 'stable' in all Firestore entries
      if (BB.storage.get('MigGoodStable') === '1') return;
      try {
        const snap = await db.collection('entries')
          .where('userId', '==', user.uid)
          .get({ source: 'server' });
        const toFix = snap.docs.filter(doc => doc.data().mood === 'good');
        if (toFix.length === 0) {
          BB.storage.set('MigGoodStable', '1');
          return;
        }
        // Batch in groups of 500
        const BATCH_SIZE = 500;
        for (let i = 0; i < toFix.length; i += BATCH_SIZE) {
          const batch = db.batch();
          toFix.slice(i, i + BATCH_SIZE).forEach(doc => batch.update(doc.ref, { mood: 'stable' }));
          await batch.commit();
        }
        BB.storage.set('MigGoodStable', '1');
      } catch(e) {
        console.warn('bbMigGoodStable failed, will retry next load', e);
      }
    }

    async function migrateGuestEntriesIfNeeded(user) {
      // Collect and decrypt guest entries from localStorage
      const guestEntries = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('entry:')) {
          try {
            const value = localStorage.getItem(key);
            if (!value) continue;
            const parsed = JSON.parse(value);
            let entryData;
            if (parsed._enc) {
              if (_guestCryptoKey) {
                entryData = await _guestDecrypt(_guestCryptoKey, parsed);
              } else {
                continue; // can't decrypt — leave in localStorage
              }
            } else {
              entryData = parsed;
            }
            guestEntries.push({ localKey: key, ...entryData });
          } catch(e) { /* skip corrupted entry */ }
        }
      }

      if (guestEntries.length === 0) return; // caller handles loadEntries()

      // Check whether the account already has Firestore entries (returning user / re-login)
      try {
        const snap = await Promise.race([
          db.collection('entries').where('userId', '==', user.uid).limit(1).get({ source: 'server' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('check-timeout')), 4000))
        ]);
        if (snap.size > 0) return; // returning user — don't overwrite Firestore entries
      } catch(e) {
        return; // can't confirm account is empty (or timed out) — skip to be safe
      }

      // New account with local entries — migrate with encryption
      const count = guestEntries.length;
      const entriesEl = document.getElementById('entries');
      if (entriesEl) entriesEl.innerHTML = `<div class="no-entries">Migrating ${count} entr${count === 1 ? 'y' : 'ies'} to your account…</div>`;
      const loader = document.getElementById('entriesLoading');
      if (loader) loader.style.display = 'block';

      try {
        const BATCH_SIZE = 400;
        for (let i = 0; i < guestEntries.length; i += BATCH_SIZE) {
          const batch = db.batch();
          await Promise.all(guestEntries.slice(i, i + BATCH_SIZE).map(async entry => {
            const { localKey, ...data } = entry;
            let fsData;
            if (_userCryptoKey) {
              const enc = await _userEncrypt(_userCryptoKey, { ...data, userId: user.uid });
              fsData = { userId: user.uid, timestamp: data.timestamp, ...enc };
            } else {
              fsData = { ...data, userId: user.uid };
            }
            batch.set(db.collection('entries').doc(), fsData);
          }));
          await batch.commit();
        }
        // Remove local copies and clean up guest PIN data
        guestEntries.forEach(({ localKey }) => localStorage.removeItem(localKey));
        BB.storage.remove('GuestPinSalt');
        BB.storage.remove('PinEnabled');
        BB.storage.remove('PinCode');
        sessionStorage.removeItem('bb_guest_key');
        _guestCryptoKey = null;
      } catch(e) {
        console.error('Guest migration failed:', e);
      }
    }

    async function loadEntries() {
      // Guard: prevent concurrent calls (e.g. background refresh triggering a second
      // load while the first is still decrypting entries, or onAuthStateChanged firing twice)
      if (_loadInProgress) return;
      _loadInProgress = true;
      // Cancel the global safety net — normal load path has started
      if (window._gJournalSafetyTimer) { clearTimeout(window._gJournalSafetyTimer); window._gJournalSafetyTimer = null; }
      const loader = document.getElementById('entriesLoading');
      if (loader) loader.style.display = 'block';
      // Hard safety net: if loadEntries hangs for any reason (e.g. Firestore SDK bug,
      // IndexedDB lock not released), force-hide the spinner after 8s so the page
      // never stays permanently stuck.
      const _loadSafetyTimer = setTimeout(() => {
        const _ph = document.getElementById('entryLoadingPlaceholder');
        if (_ph && _ph.style.display !== 'none') {
          _ph.style.display = 'none';
          const _ents = document.getElementById('entries');
          if (_ents && !_ents.innerHTML.trim()) _ents.innerHTML = '<div class="no-entries">' + BB.t('journal.noEntries') + '</div>';
        }
      }, 8000);
      // After a forced reload-after-failure, Firestore's IndexedDB persistence needs extra
      // time to re-establish after db.terminate() — use longer timeouts on that first load.
      const isPostFailureReload = sessionStorage.getItem('bbReload') === '1';
      if (isPostFailureReload) sessionStorage.removeItem('bbReload');
      try {
        const entries = [];
        let _lockedEntryCount = 0;

        if (currentUser) {
          // Restore session key if not in memory (e.g. after page refresh)
          if (!_userCryptoKey) _userCryptoKey = await _userImportKeyFromSession();

          // Helper: decode a QuerySnapshot into the entries array (handles decryption)
          async function _pushDecoded(snap) {
            const decoded = await Promise.all(snap.docs.map(doc => _decodeFirestoreEntry(doc)));
            decoded.forEach(e => { if (e) entries.push(e); });
          }

          // Try cache first — instant display even when offline/reconnecting
          // Longer timeout on post-failure reload since Firestore may still be re-initialising.
          const cacheTimeout = isPostFailureReload ? 4000 : 1000;
          let usedCache = false;
          let _cacheDocCount = 0; // raw Firestore doc count from cache (before decryption)
          try {
            const cached = await Promise.race([
              db.collection('entries').where('userId', '==', currentUser.uid).get({ source: 'cache' }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('cache-timeout')), cacheTimeout))
            ]);
            _cacheDocCount = cached.size; // save before decoding — decoded count may be lower if any entry fails
            await _pushDecoded(cached);
            usedCache = entries.length > 0;
          } catch(e) { /* no cache yet, or timed out — fall through to server fetch */ }

          if (!usedCache) {
            // No cache — fetch from server with a timeout.
            const serverTimeout = _isRetry ? 8000 : isPostFailureReload ? 12000 : 3000;
            const snapshot = await Promise.race([
              db.collection('entries').where('userId', '==', currentUser.uid).get(),
              new Promise((_, rej) => setTimeout(() => rej(new Error('fetch-timeout')), serverTimeout))
            ]);
            await _pushDecoded(snapshot);
          } else {
            // Had cache — silently refresh from server in background.
            // Compare raw doc counts (not decoded entry counts) to avoid a false-mismatch
            // when some entries fail decryption — which would cause an infinite reload loop.
            db.collection('entries')
              .where('userId', '==', currentUser.uid)
              .get({ source: 'server' })
              .then(snap => {
                if (snap.size !== _cacheDocCount) loadEntries();
              })
              .catch(() => {});
          }
        } else {
          // Load from localStorage for guests
          // Restore session key if available (e.g. after page refresh)
          if (!_guestCryptoKey) {
            _guestCryptoKey = await _guestImportKeyFromSession();
          }
          let _lockedEntryCount = 0;
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && key.startsWith('entry:')) {
                try {
                  const value = localStorage.getItem(key);
                  if (value) {
                    const parsed = JSON.parse(value);
                    if (parsed._enc) {
                      // Encrypted entry — only include if we have the key
                      if (_guestCryptoKey) {
                        const decrypted = await _guestDecrypt(_guestCryptoKey, parsed);
                        entries.push({ id: key, ...decrypted });
                      } else {
                        _lockedEntryCount++;
                      }
                    } else {
                      entries.push({ id: key, ...parsed });
                    }
                  }
                } catch (e) {
                  console.error('Error loading entry:', key, e);
                  // Skip corrupted or undecryptable entry
                }
              }
            }
          } catch (storageError) {
            console.error('localStorage corrupted:', storageError);
            alert(BB.t('journal.dlg.storageCorrupt'));
            try {
              localStorage.clear();
            } catch(clearError) {
              alert(BB.t('journal.dlg.storageClearFail'));
            }
          }
        }

        if (loader) loader.style.display = 'none';
        if (entries.length === 0) {
          // Encrypted entries exist but no key — redirect to index where the PIN prompt lives
          if (_lockedEntryCount > 0) {
            location.replace('index.html' + location.search);
            return;
          }
          _allEntries = [];
          _writeRecentMoods([]);
          document.getElementById('entries').innerHTML = '<div class="no-entries">' + BB.t('journal.noEntries') + '</div>';
          document.getElementById('stats').style.display = 'none';
          document.getElementById('chart').style.display = 'none';
          const entriesHeader = document.querySelector('.entries-header');
          if (entriesHeader) entriesHeader.style.display = 'none';
          updateDatePickerStatus([]); // show form + hide loading placeholder for new/empty accounts
          return;
        }

        // Show entries-header when we have entries
        const entriesHeader = document.querySelector('.entries-header');
        if (entriesHeader) entriesHeader.style.display = 'flex';

        // Mark that the user has entries — unlocks FABs/login/survival kit on index
        BB.storage.set('HasEntries', '1');

        if (loader) loader.style.display = 'none';
        entries.sort((a, b) => b.timestamp - a.timestamp);
        _allEntries = entries;
        _writeRecentMoods(entries);
        _updateMedBtn();
        _syncStableStreak(entries);

        // On first load after login: returning users with entries get step migrated to 10 (all done)
        if (_justLoggedIn) {
          _justLoggedIn = false;
          // Migration handled by _getOnboardingStep() — existing users with entries auto-migrate to step 10
        }

        // Update weekly summary notification with fresh stats (fire-and-forget)
        if (isNative()) scheduleWeeklySummary(entries);
        // Check and award achievements
        checkAchievements(entries);
        _maybeRequestReview(entries);
        // Check for favourite anniversary (show once per day if entries exist from prior years)
        if (isNative()) _checkFavAnniversaryToday(entries);

        // Display stats
        displayStats(entries);

        // Display chart
        displayChart(entries);

        // Life chart + opt-in early warnings (js/journal-insights.js)
        if (window.BBInsights) { try { window.BBInsights.render(entries); } catch (e) { console.warn('insights', e); } }

        // Update date picker outline status
        updateDatePickerStatus(entries);

        // Pagination logic
        const totalPages = Math.ceil(entries.length / entriesPerPage);
        const startIndex = (currentPage - 1) * entriesPerPage;
        const endIndex = startIndex + entriesPerPage;
        const paginatedEntries = entries.slice(startIndex, endIndex);

        // Display entries
        const html = paginatedEntries.map((entry, index) => {
          const actualIndex = startIndex + index; // Actual index in full array
          const date = new Date(entry.date);
          const recordedStr = entry.recordedAt
            ? (() => {
                const r = new Date(entry.recordedAt);
                const timeStr = r.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const tz = entry.recordedTz || Intl.DateTimeFormat().resolvedOptions().timeZone;
                return `<span style="font-size:0.8em; color:#adb5bd;"> · ${timeStr} (${tz})</span>`;
              })()
            : '';
          return `
            <div class="entry" style="border-left-color: ${moodColors[_moodCat(entry.mood)]}">
              <div class="entry-header" style="margin-bottom:4px;">
                <div class="entry-date" style="flex:1; min-width:0;">${date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}${recordedStr}</div>
                <div style="display:flex; align-items:center; gap:8px; flex-shrink:0; margin-left:8px;">
                  <img src="${_moodImg(entry.mood)}" alt="${_moodLabelOf(entry.mood)}" class="entry-mood" style="width:32px;height:32px;object-fit:contain;">
                  ${entry.linkedMood ? `<img src="${_moodImg(entry.linkedMood)}" alt="${_moodLabelOf(entry.linkedMood)}" style="width:22px;height:22px;object-fit:contain;opacity:0.75;margin-left:-4px;" title="Also: ${_moodLabelOf(entry.linkedMood)}">` : ''}
                  ${entry.pdfHide ? `<span style="font-size:1em;line-height:1;opacity:0.7;" title="${BB.t('journal.ui.privateTitle')}">🕵️</span>` : ''}
                  ${entry.autoFilled ? `<span style="font-size:0.6em;font-weight:700;letter-spacing:0.05em;color:var(--brand-primary);border:1.5px solid rgba(255,149,0,0.45);border-radius:6px;padding:2px 4px;line-height:1;" title="${BB.t('journal.autofill.badgeTitle')}">${BB.t('journal.autofill.badge')}</span>` : ''}
                  ${entry.favourite ? `<span style="font-size:1em;color:var(--brand-primary);line-height:1;" title="${BB.t('journal.ui.favouriteTitle')}">★</span>` : ''}
                  <button class="edit-btn" id="edit-${actualIndex}" title="${BB.t('journal.ui.editEntry')}" style="background:none; border:none; cursor:pointer; font-size:1.1em; padding:4px;">✏️</button>
                  <button class="delete-btn" id="delete-${actualIndex}">×</button>
                </div>
              </div>
              <div style="color: #6c757d; font-size: 0.9em; display:flex; flex-wrap:wrap; line-height:1.8;">${(() => {
                const _G='#2ECC40',_R='#FF4136',_N='#adb5bd';
                const _chips = [];
                if (entry.medication) _chips.push([entry.medication==='taken'?'💊 Taken':entry.medication==='unsure'?'💊 Unsure':'💊 Not taken', entry.medication==='taken'?_G:entry.medication==='unsure'?_N:_R]);
                if (entry.goals)      _chips.push([`🏅 ${entry.goals==='some'?'Yes':'No'}`, entry.goals==='some'?_G:_R]);
                if (entry.budget)     _chips.push([`💰 ${entry.budget==='yes'?'Yes':'No'}`, entry.budget==='yes'?_G:_R]);
                if (entry.exercise)   _chips.push([`🏋️ ${entry.exercise==='yes'?'Yes':'No'}`, entry.exercise==='yes'?_G:_R]);
                if (entry.outside)    _chips.push([`🌤️ ${entry.outside==='yes'?'Yes':'No'}`, entry.outside==='yes'?_G:_R]);
                if (entry.anxiety)    _chips.push([`😰 ${entry.anxiety==='high'?'More':entry.anxiety==='medium'?'Normal':'Less'}`, entry.anxiety==='low'?_G:entry.anxiety==='medium'?_N:_R]);
                if (entry.stress)     _chips.push([`😓 ${entry.stress==='high'?'More':entry.stress==='medium'?'Normal':'Less'}`, entry.stress==='low'?_G:entry.stress==='medium'?_N:_R]);
                if (entry.irritability) _chips.push([`😤 ${entry.irritability==='yes'?'More':entry.irritability==='medium'?'Normal':'Less'}`, entry.irritability==='no'?_G:entry.irritability==='medium'?_N:_R]);
                if (entry.alcohol)    _chips.push([`🍺 ${entry.alcohol==='yes'?'Yes':'No'}`, entry.alcohol==='no'?_G:_R]);
                if (entry.smoking)    _chips.push([`🚬 ${entry.smoking==='yes'?'Yes':'No'}`, entry.smoking==='no'?_G:_R]);
                if (entry.drugs)      _chips.push([`🌿 ${entry.drugs==='yes'?'Yes':'No'}`, entry.drugs==='no'?_G:_R]);
                Object.entries(entry.customFields||{}).forEach(([id,v])=>{if(!v)return;const cf=getCustomFields().find(f=>f.id===id);if(cf)_chips.push([`${cf.emoji||cf.label} ${v==='yes'?'Yes':'No'}`,_N]);});
                const _achStr = _chips.length ? `<span style="flex-basis:100%;font-size:0.88em;margin-top:1px;text-align:left;">${_chips.map(([t,c])=>`<span style="color:${c};font-weight:600">${t}</span>`).join('<span style="color:#dee2e6">  </span>')}</span>` : '';
                const _eLabel = entry.energy === 0 ? '💀 Not enough' : entry.energy <= 4 ? '🪫 Less than usual' : entry.energy <= 6 ? '⚡️ Normal' : entry.energy <= 8 ? '🔋 More than usual' : '🚀 Too much';
                const _sleepBuckets = new Set([5, 6.5, 8, 9.5, 11]);
                const _sLabel = entry.sleep == null ? '?' : !_sleepBuckets.has(entry.sleep) ? `${entry.sleep}h` : entry.sleep <= 5 ? '≤5h' : entry.sleep < 7 ? '6-7h' : entry.sleep < 9 ? '7-9h' : entry.sleep < 10 ? '9-10h' : '10+h';
                const _sqLabel = entry.sleepQuality === 'good' ? ' 😊' : entry.sleepQuality === 'bad' ? ' 😴' : entry.sleepQuality === 'unsure' ? ' 😐' : '';
                return `<span style="white-space:nowrap">${_eLabel}</span><span style="white-space:nowrap">&nbsp;| 🛌 ${_sLabel}${_sqLabel}</span>${entry.steps != null ? `<span style="white-space:nowrap">&nbsp;| 🏃 ${entry.steps >= 1000 ? Math.round(entry.steps / 1000) + 'k' : entry.steps}</span>` : ''}${_achStr}`;
              })()}</div>
              ${entry.notes ? `<div class="entry-notes">${entry.notes}</div>` : ''}
              ${entry.intention && entry.intention.trim() ? (() => {
                const _intParts = entry.intention.trim().split(/\n?_{3,}\n/);
                const _intMain = _intParts[0].trim();
                const _intNotes = _intParts[1] ? _intParts[1].trim() : '';
                return (_intMain ? `<div class="entry-notes" style="font-style:italic;color:#adb5bd;">🌅 ${_intMain}</div>` : '')
                     + (_intNotes ? `<div class="entry-notes" style="font-size:0.82em;color:#adb5bd;white-space:pre-line;">${_intNotes}</div>` : '');
              })() : ''}
            </div>
          `;
        }).join('');

        // Add pagination controls — max 5 numbered pages with « »
        const _maxVisible = 5;
        const _half = Math.floor(_maxVisible / 2);
        let _pageStart = Math.max(1, currentPage - _half);
        let _pageEnd = Math.min(totalPages, _pageStart + _maxVisible - 1);
        if (_pageEnd - _pageStart < _maxVisible - 1) _pageStart = Math.max(1, _pageEnd - _maxVisible + 1);
        const _pageNums = [];
        for (let p = _pageStart; p <= _pageEnd; p++) _pageNums.push(p);
        const _pageButtons = _pageNums.map(p =>
          `<button class="pagination-btn${p === currentPage ? ' on' : ''}" onclick="goToPage(${p})"${p === currentPage ? ' aria-current="page"' : ''}>${p}</button>`
        ).join('');
        // The entry-by-entry log (entries, pages, Backup / Import) sits behind
        // "See individual entries" under the Personalised Feedback bear; Export
        // PDF and the account row stay visible (James, 2026-09-30).
        const entriesListHtml = `
          <div id="entriesReveal" style="${_entriesListOpen ? '' : 'display:none;'}">
            ${html}
            <div class="pagination" style="justify-content: center; margin: 15px 0 10px; flex-wrap:wrap; gap:4px;">
              <button class="pagination-btn" onclick="goToPage(1)" ${currentPage === 1 ? 'disabled' : ''} title="${BB.t('journal.ui.firstPage')}">«</button>
              ${_pageButtons}
              <button class="pagination-btn" onclick="goToPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''} title="${BB.t('journal.ui.lastPage')}">»</button>
            </div>
            <div style="display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;">
              <button onclick="document.getElementById('exportModal').classList.add('active')" class="journal-btn btn-export-backup">${BB.t('journal.ui.backupData')}</button>
              <button onclick="showImportModal()" class="journal-btn btn-export-import">${BB.t('journal.ui.importBtn')}</button>
            </div>
          </div>
        `;
        const paginationHtml = `
          <div style="margin-top: 15px;">
            <div style="display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;">
              <button onclick="exportPDF()" class="journal-btn btn-export-pdf">${BB.t('journal.ui.exportPdf')}</button>
            </div>
            <div style="margin-top:16px;padding-top:14px;border-top:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;gap:12px;">
              ${currentUser ? `
                <span style="font-size:0.82em;color:#6c757d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${currentUser.email || ''}</span>
                <button onclick="logout()" class="logout-btn-list" style="flex-shrink:0;padding:7px 14px;background:white;color:#adb5bd;border:1.5px solid #dee2e6;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.85em;-webkit-tap-highlight-color:transparent;">${BB.t('journal.ui.logout')}</button>
              ` : `
                <span style="font-size:0.82em;color:#adb5bd;font-style:italic;">${BB.t('journal.ui.loginToBackup')}</span>
                <button onclick="window.showAuthModal()" style="flex-shrink:0;padding:7px 14px;background:var(--brand-btn);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.85em;-webkit-tap-highlight-color:transparent;">${BB.t('journal.ui.signInUp')}</button>
              `}
            </div>
            <div style="text-align:center;margin-top:8px;position:relative;display:inline-block;width:100%;">
              <button onclick="_dismissPersonalDetailsHint();showPersonalDetailsModal()" style="background:none;border:none;color:#adb5bd;font-size:0.8em;cursor:pointer;padding:4px 8px;text-decoration:underline;text-underline-offset:2px;-webkit-tap-highlight-color:transparent;">${BB.t('journal.ui.personalDetailsBtn')}</button>
              ${BB.storage.get('PersonalHintDone') !== '1' ? `<div id="personalDetailsJournalHint" style="display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none;animation:hintFade 2.4s ease-in-out infinite;margin-top:2px;">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="8" y1="13" x2="8" y2="2" stroke="var(--brand-primary)" stroke-width="2" stroke-linecap="round"/><polyline points="3,7 8,2 13,7" stroke="var(--brand-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
                <span style="font-size:0.72em;font-weight:700;font-style:italic;color:var(--brand-primary);font-family:'Georgia',serif;letter-spacing:0.01em;">${BB.t('journal.ui.addDetailsHere')}</span>
              </div>` : ''}
            </div>
          </div>
        `;

        const entriesToggleHtml = `
          <div style="text-align:center;margin:4px 0 10px;">
            <button id="entriesRevealBtn" class="entries-reveal-btn" onclick="toggleEntriesList()" aria-expanded="${_entriesListOpen}" aria-controls="entriesReveal">${BB.t(_entriesListOpen ? 'journal.ui.hideEntries' : 'journal.ui.seeEntries')}</button>
          </div>`;
        document.getElementById('entries').innerHTML = entriesToggleHtml + entriesListHtml + paginationHtml;
        

        // Attach event listeners after HTML is rendered
        paginatedEntries.forEach((entry, index) => {
          const actualIndex = startIndex + index;
          const editBtn = document.getElementById(`edit-${actualIndex}`);
          if (editBtn) {
            editBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              openEditInForm(entry);
            });
          }
          const btn = document.getElementById(`delete-${actualIndex}`);
          if (btn) {
            btn.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              pendingDeleteKey = entry.id;
              document.getElementById('confirmModal').classList.add('active');
            });
          }
        });
      } catch (error) {
        if (error.message === 'fetch-timeout') {
          if (_isRetry) {
            // Retry also failed — offer a full reload as last resort.
            // Set a flag so the fresh page knows to use longer timeouts while Firestore re-initialises.
            document.getElementById('entries').innerHTML = '<div class="no-entries" onclick="sessionStorage.setItem(\'bbReload\',\'1\');window.location.reload()" style="cursor:pointer;">⚠️ Still having trouble — tap to reload</div>';
          } else {
            // First timeout — invite user to retry (smarter retry with delay)
            document.getElementById('entries').innerHTML = '<div class="no-entries" onclick="retryLoadEntries()" style="cursor:pointer;">⏱ Taking a while to connect — tap here to retry</div>';
          }
          updateDatePickerStatus([]);
        } else {
          console.error('Error loading entries:', error);
          document.getElementById('entries').innerHTML = '<div class="no-entries">' + BB.t('journal.ui.errorLoading') + '</div>';
        }
      } finally {
        clearTimeout(_loadSafetyTimer);
        _isRetry = false;
        _loadInProgress = false;
        const loader = document.getElementById('entriesLoading');
        if (loader) loader.style.display = 'none';
        const placeholder = document.getElementById('entryLoadingPlaceholder');
        if (placeholder) placeholder.style.display = 'none';
        const toggleSection = document.getElementById('journalToggleSection');
        if (toggleSection) toggleSection.style.display = _allEntries.length > 0 ? '' : 'none';
        _applyJournalOnboardingGating();
      }
    }

    function retryLoadEntries() {
      // Show reconnecting state and wait 2s before retrying — gives Firestore's
      // IndexedDB leader election time to settle after rapid page navigation.
      _isRetry = true;
      const entriesEl = document.getElementById('entries');
      if (entriesEl) entriesEl.innerHTML = '<div class="no-entries">🔄 Reconnecting…</div>';
      const loader = document.getElementById('entriesLoading');
      if (loader) loader.style.display = 'block';
      setTimeout(loadEntries, 2000);
    }
    window.retryLoadEntries = retryLoadEntries;

    function displayStats(entries) {
      const statsContainer = document.getElementById('stats');
      const _statsBlock = document.getElementById('statsAndCalendarBlock');
      const _tpWrapper = document.getElementById('journeyRanges');

      // Calculate streak before the early-return guard so widget/button always get the correct value
      {
        const entryDates = new Set();
        entries.forEach(e => {
          const date = new Date(e.date);
          const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          entryDates.add(dateKey);
        });
        const useToday = localStorage.getItem('journalDefaultToday') === 'true';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let checkDate = new Date(today);
        if (!useToday) checkDate.setDate(checkDate.getDate() - 1);
        const anchorKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
        if (!entryDates.has(anchorKey)) {
          checkDate.setDate(checkDate.getDate() - 1);
        }
        let currentStreak = 0;
        while (true) {
          const dateKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
          if (entryDates.has(dateKey)) {
            currentStreak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }
        window._currentStreak = currentStreak;
        BB.storage.set('CurrentStreak', currentStreak);
        if (window.db && window.currentUser) {
          window.db.collection('userSettings').doc(window.currentUser.uid)
            .set({ currentStreak: currentStreak }, { merge: true }).catch(() => {});
        }
      }

      if (entries.length <= 1) {
        if (_statsBlock) _statsBlock.style.display = 'none';
        if (_tpWrapper) _tpWrapper.style.display = 'none';
        statsContainer.style.display = 'none';
        return;
      }

      if (_statsBlock) _statsBlock.style.display = '';
      if (_tpWrapper) { _tpWrapper.style.display = ''; _renderJourneyRanges(); }
      statsContainer.style.display = 'grid';

      // The range's days counted back from today (today included), the same
      // window as the life chart and the feedback popup.
      const _rangeSince = new Date(); _rangeSince.setHours(0, 0, 0, 0);
      if (statsTimeframe !== 'all') _rangeSince.setDate(_rangeSince.getDate() - (statsTimeframe - 1));
      const statsEntries = statsTimeframe !== 'all'
        ? entries.filter(e => new Date(e.date) >= _rangeSince)
        : (statsStartDate ? entries.filter(e => e.date >= statsStartDate) : entries);

      // Nothing logged inside the range: say so rather than averaging nothing.
      if (!statsEntries.length) {
        currentStatsEntries = [];
        statsContainer.innerHTML = `<div class="stat-card" style="grid-column:1/-1;"><div class="stat-label">${_esc(BB.t('journal.stats.noneInRange', { period: _journeyRangeLabel(statsTimeframe) }))}</div></div>`;
        document.getElementById('streakStats').innerHTML = '';
        return;
      }
      const avgEnergy = (statsEntries.reduce((sum, e) => sum + e.energy, 0) / statsEntries.length).toFixed(1);
      const _sleepStatEntries = statsEntries.filter(e => e.sleep != null);
      const avgSleep = _sleepStatEntries.length ? (_sleepStatEntries.reduce((sum, e) => sum + e.sleep, 0) / _sleepStatEntries.length).toFixed(1) : '–';
      
      const moodCounts = {};
      statsEntries.forEach(e => {
        const _c = _moodCat(e.mood);
        moodCounts[_c] = (moodCounts[_c] || 0) + 1;
        if (e.linkedMood) { const _lc = _moodCat(e.linkedMood); moodCounts[_lc] = (moodCounts[_lc] || 0) + 1; }
      });
      const _sortedMoods = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]);
      const mostCommon = _sortedMoods[0];
      const secondCommon = _sortedMoods[1] || null;
      const secondIsTied = secondCommon && _sortedMoods[2] && _sortedMoods[2][1] === secondCommon[1];

      // Calculate medication adherence
      const medTakenCount = statsEntries.filter(e => e.medication === 'taken' || !e.medication).length;
      const medAdherence = ((medTakenCount / statsEntries.length) * 100).toFixed(0);

      // Calculate current streak (only for all-time view)
      let currentStreak = 0;
      window._currentStreak = 0;
      if (true) { // streak always calculated
        // Create a set of dates that have entries
        const entryDates = new Set();
        entries.forEach(e => {
          const date = new Date(e.date);
          const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          entryDates.add(dateKey);
        });

        // In yesterday mode the "current" day is yesterday, so the streak anchor
        // shifts back one day (and falls back one further if yesterday isn't logged yet).
        const useToday = localStorage.getItem('journalDefaultToday') === 'true';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // Anchor: today (today-mode) or yesterday (yesterday-mode)
        let checkDate = new Date(today);
        if (!useToday) checkDate.setDate(checkDate.getDate() - 1);
        const anchorKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
        // If the anchor day has no entry yet, fall back one more day
        if (!entryDates.has(anchorKey)) {
          checkDate.setDate(checkDate.getDate() - 1);
        }

        while (true) {
          const dateKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
          if (entryDates.has(dateKey)) {
            currentStreak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            break;
          }
        }
        window._currentStreak = currentStreak;
        BB.storage.set('CurrentStreak', currentStreak);
        if (window.db && window.currentUser) {
          window.db.collection('userSettings').doc(window.currentUser.uid)
            .set({ currentStreak: currentStreak }, { merge: true }).catch(() => {});
        }
      }

      // Calculate missing entries in the last 30 days (or since first entry if more recent)
      let missingEntries = 0;
      if (statsTimeframe === 'all' && entries.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Go back 30 days from today
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 29); // 30 days including today
        thirtyDaysAgo.setHours(0, 0, 0, 0);
        
        // Find the first entry date
        const sortedEntries = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        const firstEntryDate = new Date(sortedEntries[0].date);
        firstEntryDate.setHours(0, 0, 0, 0);
        
        // Start counting from whichever is more recent: 30 days ago OR first entry
        const startDate = firstEntryDate > thirtyDaysAgo ? firstEntryDate : thirtyDaysAgo;
        
        // Create a set of dates that have entries
        const entryDates = new Set();
        entries.forEach(entry => {
          const date = new Date(entry.date);
          date.setHours(0, 0, 0, 0);
          if (date >= startDate && date <= today) {
            const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            entryDates.add(dateKey);
          }
        });
        
        // Count missing days from start date to today
        let checkDate = new Date(startDate);
        while (checkDate <= today) {
          const dateKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
          if (!entryDates.has(dateKey)) {
            missingEntries++;
          }
          checkDate.setDate(checkDate.getDate() + 1);
        }
      }

      const timeframeLabel = _journeyRangeLabel(statsTimeframe);

      // "since" date: for all-time use statsStartDate/oldest entry; otherwise the range's first day
      let sinceDateLabel = '';
      if (statsTimeframe === 'all') {
        const sinceRaw = statsStartDate
          ? new Date(statsStartDate + 'T00:00:00')
          : new Date(entries[entries.length - 1].date);
        sinceDateLabel = sinceRaw.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      } else {
        sinceDateLabel = _rangeSince.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      }

      currentStatsEntries = statsEntries;

      const cardStyle = 'cursor:pointer;transition:transform 0.15s;';
      const _totalStr = statsTimeframe !== 'all' ? `${statsEntries.length}/${statsTimeframe}` : `${statsEntries.length}`;
      const _totalLen = _totalStr.length;
      const _totalFontSize = _totalLen <= 5 ? '' : _totalLen <= 7 ? 'font-size:1.2em;' : _totalLen <= 9 ? 'font-size:1em;' : 'font-size:0.85em;';
      const html = `
        <div class="stat-card" style="${cardStyle}" onclick="showStatDetail('total')">
          <div class="stat-number" style="${_totalFontSize}">${_totalStr}</div>
          <div class="stat-label">Total Days${sinceDateLabel ? `<br><span style="font-size:0.78em;font-weight:400;opacity:0.75;">since ${sinceDateLabel}</span>` : ''}</div>
        </div>
        <div class="stat-card" style="${cardStyle}" onclick="showStatDetail('moodSummary')">
          <div class="stat-number">
            <div style="display:flex;align-items:flex-end;justify-content:center;gap:6px;">
              <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:6px;">
                <img src="${_moodImg(mostCommon[0])}" alt="${_moodLabelOf(mostCommon[0])}" style="width:38px;height:38px;object-fit:contain;">
                <div style="font-size:0.7em;line-height:1;margin-top:2px;">🥇</div>
              </div>
              ${secondCommon ? `<div style="display:flex;flex-direction:column;align-items:center;">
                <img src="${_moodImg(secondCommon[0])}" alt="${_moodLabelOf(secondCommon[0])}" style="width:28px;height:28px;object-fit:contain;">
                <div style="font-size:0.7em;line-height:1;margin-top:2px;">🥈${secondIsTied ? '<span style="font-size:0.8em;vertical-align:middle;">=</span>' : ''}</div>
              </div>` : ''}
            </div>
          </div>
          <div class="stat-label">${BB.t('journal.stats.mostCommon', { period: timeframeLabel })}</div>
        </div>
        <div class="stat-card" style="${cardStyle}" onclick="showStatDetail('energy')">
          <div class="stat-number">${avgEnergy}</div>
          <div class="stat-label">${BB.t('journal.stats.avgEnergy', { period: timeframeLabel })}</div>
        </div>
        <div class="stat-card" style="${cardStyle}" onclick="showStatDetail('sleep')">
          <div class="stat-number">${avgSleep}h</div>
          <div class="stat-label">${BB.t('journal.stats.avgSleep', { period: timeframeLabel })}</div>
        </div>
        <div class="stat-card" style="${cardStyle}" onclick="showStatDetail('medication')">
          <div class="stat-number">${medAdherence}%</div>
          <div class="stat-label">${BB.t('journal.stats.medTaken', { period: timeframeLabel })}</div>
        </div>
        <div class="stat-card" style="${cardStyle}" onclick="showFavouritesModal()">
          <div class="stat-number">${statsEntries.filter(e => e.favourite).length}</div>
          <div class="stat-label">Favourite Entries (${timeframeLabel})</div>
        </div>
      `;

      document.getElementById('stats').innerHTML = html;

      // streak card lives inside the year calendar; show personalised feedback link for all timeframes (only when bear suggestion enabled)
      const _pfLimitedNote = statsTimeframe === 30 ? `<div style="font-size:0.75em;color:#adb5bd;margin-top:2px;">Based on ${timeframeLabel} data — limited insights</div>` : '';
      document.getElementById('streakStats').innerHTML = (localStorage.getItem('showMoodSuggestion') === '1' && statsEntries.length > 0)
        ? `<div style="text-align:center;margin:8px 0 16px;">
            <button onclick="showPersonalisedFeedback()" class="pf-link"><img src="images/moods/AI_Bear.png" style="max-width: 50px" > <br>${BB.t('journal.ui.personalisedFeedback')}</button><br>
            ${_pfLimitedNote}
           </div>`
        : '';
    }

    function showStatDetail(type) {
      const entries = currentStatsEntries;
      const modal = document.getElementById('statDetailModal');
      const title = document.getElementById('statDetailTitle');
      const body = document.getElementById('statDetailBody');
      const moodImg = (mood) => `<img src="${_moodImg(mood)}" alt="${_moodLabelOf(mood)}" style="width:20px;height:20px;object-fit:contain;vertical-align:middle;">`;
      const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);

      const row = (label, value, bar, barColor) => {
        const barHtml = bar !== undefined
          ? `<div style="height:6px;border-radius:3px;background:#eee;margin-top:3px;"><div style="height:100%;width:${Math.min(bar*100,100).toFixed(0)}%;background:${barColor};border-radius:3px;"></div></div>`
          : '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #f0f0f0;">
          <span style="color:#6c757d;">${label}</span><span style="font-weight:600;">${value}</span></div>${barHtml}`;
      };

      if (type === 'energy') {
        title.textContent = BB.t('journal.stats.energyChart');
        body.innerHTML = sorted.map(e => {
          const d = new Date(e.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
          return row(d, `${e.energy}/10`, e.energy/10, 'var(--brand-primary)');
        }).join('');
      } else if (type === 'sleep') {
        title.textContent = BB.t('journal.stats.sleepChart');
        body.innerHTML = sorted.filter(e => e.sleep != null).map(e => {
          const d = new Date(e.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
          return row(d, `${e.sleep}h`, e.sleep/12, '#667eea');
        }).join('');
      } else if (type === 'mood') {
        title.textContent = BB.t('journal.stats.moodChart');
        body.innerHTML = sorted.map(e => {
          const d = new Date(e.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
          return row(d, `${moodImg(e.mood)} ${_moodLabelNum(e.mood)}`);
        }).join('');
      } else if (type === 'medication') {
        title.textContent = BB.t('journal.stats.medChart');
        body.innerHTML = sorted.map(e => {
          const d = new Date(e.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
          const taken = e.medication === 'taken' || !e.medication;
          return row(d, taken ? '✅ Taken' : '❌ No / Forgot');
        }).join('');
      } else if (type === 'moodSummary') {
        const _moodColors = { manic:'#FF4136', elevated:'#FF851B', stable:'#2ECC40', good:'#2ECC40', low:'#0074D9', depressed:'#7B68EE' };
        const _moodLabels = { manic:BB.t('mood.manic'), elevated:BB.t('mood.elevated'), stable:BB.t('mood.stable'), good:BB.t('mood.stable'), low:BB.t('mood.low'), depressed:BB.t('mood.depressed') };
        const allMoods = ['manic','elevated','stable','low','depressed'];
        const total = entries.length;
        const counts = {};
        allMoods.forEach(m => { counts[m] = 0; });
        entries.forEach(e => {
          const _c = _moodCat(e.mood);
          if (counts[_c] !== undefined) counts[_c]++;
          if (e.linkedMood) { const _lc = _moodCat(e.linkedMood); if (counts[_lc] !== undefined) counts[_lc]++; }
        });
        const sortedMoods = [...allMoods].sort((a, b) => counts[b] - counts[a]);
        title.textContent = `🧠 Mood Breakdown`;
        body.innerHTML = sortedMoods.map(mood => {
          const count = counts[mood];
          const pct = total > 0 ? (count / total * 100).toFixed(1) : '0.0';
          const bar = total > 0 ? count / total : 0;
          const color = _moodColors[mood];
          const value = `${count}d\u2009|\u2009${pct}%`;
          return `<div style="padding:8px 0;border-bottom:1px solid #f0f0f0;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <img src="${_moodImg(mood)}" style="width:22px;height:22px;object-fit:contain;">
                <span style="color:#495057;font-weight:600;">${_moodLabels[mood]}</span>
              </div>
              <span style="font-weight:700;color:${color};">${value}</span>
            </div>
            <div style="height:5px;border-radius:3px;background:#eee;">
              <div style="height:100%;width:${(bar*100).toFixed(0)}%;background:${color};border-radius:3px;"></div>
            </div>
          </div>`;
        }).join('');
      } else if (type === 'total') {
        const _moodColors = { manic:'#FF4136', elevated:'#FF851B', stable:'#2ECC40', good:'#2ECC40', low:'#0074D9', depressed:'#7B68EE' };
        const _moodLabels = { manic:BB.t('mood.manic'), elevated:BB.t('mood.elevated'), stable:BB.t('mood.stable'), good:BB.t('mood.stable'), low:BB.t('mood.low'), depressed:BB.t('mood.depressed') };
        title.textContent = BB.t('journal.stats.trackedDays');
        body.innerHTML = sorted.map(e => {
          const d = new Date(e.date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
          const c = _moodColors[_moodCat(e.mood)] || 'var(--brand-primary)';
          const lbl = _moodLabelNum(e.mood);
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;margin-bottom:4px;border-radius:8px;background:${c}18;border-left:3px solid ${c};">
            <span style="color:#495057;font-size:0.9em;">${d}</span>
            <span style="display:flex;align-items:center;gap:5px;">
              <img src="${_moodImg(e.mood)}" alt="${_moodLabelOf(e.mood)}" style="width:22px;height:22px;object-fit:contain;">
              <span style="font-size:0.82em;font-weight:600;color:${c};">${lbl}</span>
            </span>
          </div>`;
        }).join('');
      }

      modal.classList.add('active');
    }

    function closeStatDetail() {
      document.getElementById('statDetailModal').classList.remove('active');
    }
    window.showStatDetail = showStatDetail;
    window.closeStatDetail = closeStatDetail;

    // ── Favourites modal ──
    function showFavouritesModal() {
      const moodColors = { manic:'#FF4136', elevated:'#FF851B', stable:'#2ECC40', good:'#2ECC40', low:'#0074D9', depressed:'#7B68EE' };
      const favs = _allEntries.filter(e => e.favourite).sort((a, b) => b.timestamp - a.timestamp);
      const el = document.getElementById('favouritesList');
      if (favs.length === 0) {
        el.innerHTML = '<p style="text-align:center;color:#6c757d;font-style:italic;margin:16px 0;">' + BB.t('journal.ui.noFavYet') + '</p>';
      } else {
        el.innerHTML = favs.map(entry => {
          const d = new Date(entry.date);
          const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
          const color = moodColors[_moodCat(entry.mood)] || 'var(--brand-primary)';
          const notesPreview = entry.notes
            ? `<div style="font-size:0.82em;color:#6c757d;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${entry.notes}</div>`
            : '';
          return `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:6px;background:#f8f9fa;border-radius:10px;border-left:4px solid ${color};">
              <img src="${_moodImg(entry.mood)}" width="28" height="28" style="flex-shrink:0;">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:0.88em;">${label}</div>
                ${notesPreview}
              </div>
              <button onclick="openFavouriteDetail('${entry.id || ''}')" style="flex-shrink:0;padding:6px 14px;background:white;border:1.5px solid var(--brand-primary);color:var(--brand-primary);border-radius:8px;font-weight:600;font-size:0.82em;cursor:pointer;-webkit-tap-highlight-color:transparent;">Open</button>
            </div>`;
        }).join('');
      }
      document.getElementById('favouritesModal').classList.add('active');
    }

    function closeFavouritesModal() {
      document.getElementById('favouritesModal').classList.remove('active');
    }

    function openFavouriteDetail(entryId) {
      const entry = _allEntries.find(e => (e.id || '') === entryId);
      if (!entry) return;
      closeFavouritesModal();
      const d = new Date(entry.date);
      const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      document.getElementById('statDetailTitle').innerHTML =
        `<img src="${_moodImg(entry.mood)}" width="26" style="vertical-align:middle;margin-right:8px;">${dateLabel}`;
      document.getElementById('statDetailBody').innerHTML = _buildFavouriteDetailHTML(entry);
      document.getElementById('statDetailModal').classList.add('active');
    }

    function _buildFavouriteDetailHTML(entry) {
      const rows = [];
      const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
      rows.push(`<div style="margin-bottom:6px;"><b>Mood:</b> ${_moodLabelNum(entry.mood)}</div>`);
      if (entry.energy != null) {
        const _stepsStr = entry.steps != null ? ` | 🏃 ${entry.steps >= 1000 ? Math.round(entry.steps/1000)+'k' : entry.steps}` : '';
        rows.push(`<div style="margin-bottom:6px;"><b>Energy:</b> ${entry.energy}/10${_stepsStr}</div>`);
      }
      if (entry.sleep  != null) rows.push(`<div style="margin-bottom:6px;"><b>Sleep:</b> ${entry.sleep}h</div>`);
      rows.push(`<div style="margin-bottom:6px;"><b>Medication:</b> ${entry.medication === 'not-taken' ? '❌ Not taken' : entry.medication === 'unsure' ? '🤷 Unsure' : '✅ Taken'}</div>`);
      if (entry.goals)  rows.push(`<div style="margin-bottom:6px;"><b>Goals:</b> ${cap(entry.goals)}</div>`);
      if (entry.budget) rows.push(`<div style="margin-bottom:6px;"><b>Budget:</b> ${entry.budget === 'yes' ? '✅ Kept budget' : '❌ Didn\'t keep budget'}</div>`);
      if (entry.anxiety && entry.anxiety !== 'none')           rows.push(`<div style="margin-bottom:6px;"><b>Anxiety:</b> ${cap(entry.anxiety)}</div>`);
      if (entry.stress && entry.stress !== 'none')             rows.push(`<div style="margin-bottom:6px;"><b>Stress:</b> ${cap(entry.stress)}</div>`);
      if (entry.irritability && entry.irritability !== 'none') rows.push(`<div style="margin-bottom:6px;"><b>Irritability:</b> ${cap(entry.irritability)}</div>`);
      if (entry.exercise)    rows.push(`<div style="margin-bottom:6px;"><b>Exercise:</b> ${cap(entry.exercise)}</div>`);
      if (entry.outside)     rows.push(`<div style="margin-bottom:6px;"><b>Gone outside:</b> ${cap(entry.outside)}</div>`);
      if (entry.alcohol)     rows.push(`<div style="margin-bottom:6px;"><b>Alcohol:</b> ${cap(entry.alcohol)}</div>`);
      if (entry.smoking)     rows.push(`<div style="margin-bottom:6px;"><b>Smoking:</b> ${cap(entry.smoking)}</div>`);
      if (entry.drugs)       rows.push(`<div style="margin-bottom:6px;"><b>Drugs:</b> ${cap(entry.drugs)}</div>`);
      if (entry.customFields) {
        Object.entries(entry.customFields).forEach(([k, v]) => {
          if (v) rows.push(`<div style="margin-bottom:6px;"><b>${k}:</b> ${v}</div>`);
        });
      }
      if (entry.notes) rows.push(`<div style="margin-top:10px;padding-top:10px;border-top:1px solid #f0f0f0;font-size:0.9em;line-height:1.5;color:#495057;">${entry.notes}</div>`);
      return rows.join('');
    }

    window.showFavouritesModal = showFavouritesModal;
    window.closeFavouritesModal = closeFavouritesModal;
    window.openFavouriteDetail = openFavouriteDetail;

    function showSaveConfirmModal() {
      if (editingEntry && !_hasEditChanges()) { cancelEdit(); return; }
      const summary = document.getElementById('saveConfirmSummary');
      if (summary) summary.innerHTML = _fmRenderContent({ id: 'done' }, { noActions: true });
      const _isEditing = !!editingEntry;
      const titleEl = document.getElementById('saveConfirmTitle');
      const _t = (k) => (window.BB && BB.t) ? BB.t(k) : k;
      if (titleEl) titleEl.textContent = _isEditing ? _t('journal.save.confirmTitleEdit') : _t('journal.save.confirmTitleNew');
      const saveBtnEl = document.getElementById('saveConfirmSaveBtn');
      if (saveBtnEl) saveBtnEl.textContent = _isEditing ? _t('journal.save.confirmBtnEdit') : _t('journal.save.confirmBtnNew');
      document.getElementById('saveConfirmModal').classList.add('active');
    }
    function closeSaveConfirmModal() {
      document.getElementById('saveConfirmModal').classList.remove('active');
    }
    window.showSaveConfirmModal = showSaveConfirmModal;
    window.closeSaveConfirmModal = closeSaveConfirmModal;

    // ── Favourite Anniversary modal ──
    let _anniversaryModal_month = 0, _anniversaryModal_day = 0;

    function showFavAnniversaryModal(month, day) {
      _anniversaryModal_month = month;
      _anniversaryModal_day = day;
      const moodColors = { manic:'#FF4136', elevated:'#FF851B', stable:'#2ECC40', good:'#2ECC40', low:'#0074D9', depressed:'#7B68EE' };
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const favs = (_allEntries || []).filter(e => {
        if (!e.favourite) return false;
        const d = new Date(e.date);
        return d.getMonth() + 1 === month && d.getDate() === day;
      }).sort((a, b) => b.timestamp - a.timestamp);
      document.getElementById('favAnniversaryTitle').textContent = `⭐ On this day — ${monthNames[month-1]} ${day}`;
      const el = document.getElementById('favAnniversaryList');
      if (favs.length === 0) {
        el.innerHTML = '<p style="text-align:center;color:#6c757d;font-style:italic;margin:16px 0;">' + BB.t('journal.ui.noFavForDate') + '</p>';
      } else {
        el.innerHTML = favs.map(entry => {
          const d = new Date(entry.date);
          const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
          const color = moodColors[_moodCat(entry.mood)] || 'var(--brand-primary)';
          const notesPreview = entry.notes
            ? `<div style="font-size:0.82em;color:#6c757d;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${entry.notes}</div>`
            : '';
          return `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:6px;background:#f8f9fa;border-radius:10px;border-left:4px solid ${color};">
              <img src="${_moodImg(entry.mood)}" width="28" height="28" style="flex-shrink:0;">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:0.88em;">${label}</div>
                ${notesPreview}
              </div>
              <button onclick="openFavAnniversaryDetail('${entry.id || ''}')" style="flex-shrink:0;padding:6px 14px;background:white;border:1.5px solid var(--brand-primary);color:var(--brand-primary);border-radius:8px;font-weight:600;font-size:0.82em;cursor:pointer;-webkit-tap-highlight-color:transparent;">Open</button>
            </div>`;
        }).join('');
      }
      document.getElementById('favAnniversaryModal').classList.add('active');
    }

    function closeFavAnniversaryModal() {
      document.getElementById('favAnniversaryModal').classList.remove('active');
    }

    function openFavAnniversaryDetail(entryId) {
      const entry = _allEntries.find(e => (e.id || '') === entryId);
      if (!entry) return;
      closeFavAnniversaryModal();
      const d = new Date(entry.date);
      const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      document.getElementById('statDetailTitle').innerHTML =
        `<img src="${_moodImg(entry.mood)}" width="26" style="vertical-align:middle;margin-right:8px;">${dateLabel}`;
      document.getElementById('statDetailBody').innerHTML = _buildFavouriteDetailHTML(entry);
      document.getElementById('statDetailModal').classList.add('active');
    }

    async function rescheduleAnniversary() {
      closeFavAnniversaryModal();
      if (_anniversaryModal_month && _anniversaryModal_day) {
        await _scheduleAnniversaryNotif(_anniversaryModal_month, _anniversaryModal_day);
      }
    }

    function _checkFavAnniversaryToday(entries) {
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      if (BB.storage.get('FavAnniShown') === todayKey) return;
      const month = today.getMonth() + 1;
      const day = today.getDate();
      const thisYear = today.getFullYear();
      const annivFavs = entries.filter(e => {
        if (!e.favourite) return false;
        const d = new Date(e.date);
        return d.getMonth() + 1 === month && d.getDate() === day && d.getFullYear() !== thisYear;
      });
      if (annivFavs.length > 0) {
        BB.storage.set('FavAnniShown', todayKey);
        setTimeout(() => showFavAnniversaryModal(month, day), 1500);
      }
    }

    window.showFavAnniversaryModal = showFavAnniversaryModal;
    window.closeFavAnniversaryModal = closeFavAnniversaryModal;
    window.rescheduleAnniversary = rescheduleAnniversary;
    window.openFavAnniversaryDetail = openFavAnniversaryDetail;

    // ── PIN lock ──
    let _pinBuffer = '';
    let _pinSetupBuffer = '';
    let _pinSetupStep = 'set'; // 'set' | 'confirm'
    let _pinSetupFirst = '';

    // ── User (Firestore) E2E crypto ──
    let _userCryptoKey = null;         // AES-GCM-256 key derived from login password
    let _pendingAuthPassword = null;   // held briefly between auth submit and onAuthStateChanged

    async function _userDeriveKey(password, saltB64) {
      const saltBytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
      const keyMaterial = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
      );
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true, ['encrypt', 'decrypt']
      );
    }

    // Encrypt arbitrary data. Keeps userId + timestamp plaintext for Firestore queries.
    async function _userEncrypt(key, data) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(JSON.stringify(data));
      const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
      return {
        _enc: btoa(String.fromCharCode(...new Uint8Array(cipher))),
        _iv:  btoa(String.fromCharCode(...iv))
      };
    }

    async function _userDecrypt(key, encObj) {
      const iv     = Uint8Array.from(atob(encObj._iv),  c => c.charCodeAt(0));
      const cipher = Uint8Array.from(atob(encObj._enc), c => c.charCodeAt(0));
      const plain  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
      return JSON.parse(new TextDecoder().decode(plain));
    }

    async function _userExportKeyToSession(key) {
      const raw = await crypto.subtle.exportKey('raw', key);
      const b64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
      sessionStorage.setItem('bb_user_key', b64);
      if (isNative()) {
        try {
          const _ss = window.Capacitor?.Plugins?.SecureStorage;
          if (_ss) {
            await Promise.race([
              _ss.setItem('bb_user_key', b64),
              new Promise(r => setTimeout(() => r(), 3000)),
            ]);
          }
        } catch (e) { console.warn('SecureStorage setItem failed:', e); }
      }
    }

    async function _userImportKeyFromSession() {
      let b64 = sessionStorage.getItem('bb_user_key');
      if (!b64 && isNative()) {
        // Only attempt SecureStorage (Keychain) once per app session.
        // A second concurrent call can deadlock iOS Keychain when the first call
        // is still in-flight (timed out on the JS side but still pending natively).
        // If the first attempt returned null, subsequent calls skip Keychain entirely.
        if (sessionStorage.getItem('_bbSSAttempted') !== '1') {
          // Only attempt Keychain once per session — concurrent calls can deadlock iOS Keychain.
          sessionStorage.setItem('_bbSSAttempted', '1');
          try {
            const _ss = window.Capacitor?.Plugins?.SecureStorage;
            if (_ss) {
              // Race against 3 s — a hung native call must not stall the whole load path
              b64 = await Promise.race([
                _ss.getItem('bb_user_key'),
                new Promise(r => setTimeout(() => r(null), 3000)),
              ]);
              if (b64) sessionStorage.setItem('bb_user_key', b64);
            }
          } catch (e) { console.warn('SecureStorage getItem failed:', e); }
        }
      }
      if (!b64) return null;
      try {
        const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
      } catch (e) { return null; }
    }

    // Wrap a data key with a wrapping key (AES-GCM). Returns { wrappedKey, wrappedKeyIv } as base64.
    async function _wrapDataKey(dataKey, wrappingKey) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const rawDataKey = await crypto.subtle.exportKey('raw', dataKey);
      const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, rawDataKey);
      return {
        wrappedKey:   btoa(String.fromCharCode(...new Uint8Array(wrapped))),
        wrappedKeyIv: btoa(String.fromCharCode(...iv)),
      };
    }

    // Unwrap a data key. Throws if wrappingKey is wrong (password mismatch).
    async function _unwrapDataKey(wrappedKeyB64, wrappedKeyIvB64, wrappingKey) {
      const iv      = Uint8Array.from(atob(wrappedKeyIvB64), c => c.charCodeAt(0));
      const wrapped = Uint8Array.from(atob(wrappedKeyB64),   c => c.charCodeAt(0));
      const rawDataKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrappingKey, wrapped);
      return crypto.subtle.importKey('raw', rawDataKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    }

    // Decode a single Firestore QueryDocumentSnapshot, decrypting if needed.
    async function _decodeFirestoreEntry(doc) {
      const data = doc.data();
      if (data._enc) {
        if (_userCryptoKey) {
          try {
            const decrypted = await _userDecrypt(_userCryptoKey, data);
            return { id: doc.id, ...decrypted };
          } catch (e) {
            console.error('Failed to decrypt entry', doc.id, e);
            return null; // skip undecryptable entry
          }
        }
        return null; // key not available — entry locked
      }
      return { id: doc.id, ...data }; // plaintext (pre-encryption entry)
    }

    // One-time migration: encrypt all existing plaintext Firestore entries for this user.
    async function _encryptExistingEntries(uid) {
      try {
        const snap = await Promise.race([
          db.collection('entries').where('userId', '==', uid).get(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('enc-timeout')), 8000))
        ]);
        const plain = snap.docs.filter(doc => !doc.data()._enc);
        if (plain.length === 0) return;
        const BATCH = 400;
        for (let i = 0; i < plain.length; i += BATCH) {
          const batch = db.batch();
          await Promise.all(plain.slice(i, i + BATCH).map(async doc => {
            const data = doc.data();
            const enc  = await _userEncrypt(_userCryptoKey, data);
            batch.set(doc.ref, { userId: data.userId, timestamp: data.timestamp, ...enc });
          }));
          await batch.commit();
        }
      } catch (e) { console.error('Entry encryption migration failed:', e); }
    }

    // ── Guest PIN crypto ──
    let _guestCryptoKey = null;
    let _guestPinSetupBuffer = '';
    let _guestPinSetupFirst = '';
    let _guestPinSetupStep = 'set'; // 'set' | 'confirm'
    let _guestPinSetupCallback = null;

    async function _guestDeriveKey(pin, saltB64) {
      const saltBytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
      const keyMaterial = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(pin), { name: 'PBKDF2' }, false, ['deriveKey']
      );
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true, ['encrypt', 'decrypt']
      );
    }

    async function _guestEncrypt(key, data) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(JSON.stringify(data));
      const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
      return {
        _enc: btoa(String.fromCharCode(...new Uint8Array(cipher))),
        _iv: btoa(String.fromCharCode(...iv))
      };
    }

    async function _guestDecrypt(key, encObj) {
      const iv = Uint8Array.from(atob(encObj._iv), c => c.charCodeAt(0));
      const cipher = Uint8Array.from(atob(encObj._enc), c => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
      return JSON.parse(new TextDecoder().decode(plain));
    }

    async function _guestExportKeyToSession(key) {
      const raw = await crypto.subtle.exportKey('raw', key);
      sessionStorage.setItem('bb_guest_key', btoa(String.fromCharCode(...new Uint8Array(raw))));
    }

    async function _guestImportKeyFromSession() {
      const b64 = sessionStorage.getItem('bb_guest_key');
      if (!b64) return null;
      try {
        const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
      } catch (e) { return null; }
    }

    function _showGuestPinSetup(callback) {
      _guestPinSetupCallback = callback;
      _guestPinSetupBuffer = '';
      _guestPinSetupFirst = '';
      _guestPinSetupStep = 'set';
      const overlay = document.getElementById('guestPinSetupOverlay');
      if (overlay) {
        document.getElementById('guestPinSetupTitle').textContent = 'Protect your data';
        document.getElementById('guestPinSetupDesc').textContent = 'Choose a 4-digit PIN to lock your journal.';
        document.getElementById('guestPinSetupError').textContent = '';
        _renderPinDots('guestPinSetupDots', 0, false);
        overlay.style.display = 'flex';
      }
    }

    function guestPinSetupDel() {
      if (_guestPinSetupBuffer.length === 0) return;
      _guestPinSetupBuffer = _guestPinSetupBuffer.slice(0, -1);
      _renderPinDots('guestPinSetupDots', _guestPinSetupBuffer.length, false);
    }

    async function guestPinSetupKey(digit) {
      if (_guestPinSetupBuffer.length >= 4) return;
      _guestPinSetupBuffer += digit;
      _renderPinDots('guestPinSetupDots', _guestPinSetupBuffer.length, false);
      if (_guestPinSetupBuffer.length < 4) return;

      const titleEl = document.getElementById('guestPinSetupTitle');
      const descEl = document.getElementById('guestPinSetupDesc');
      const errEl = document.getElementById('guestPinSetupError');

      if (_guestPinSetupStep === 'set') {
        _guestPinSetupFirst = _guestPinSetupBuffer;
        _guestPinSetupBuffer = '';
        _guestPinSetupStep = 'confirm';
        titleEl.textContent = 'Confirm your PIN';
        descEl.textContent = 'Re-enter your PIN to confirm.';
        errEl.textContent = '';
        _renderPinDots('guestPinSetupDots', 0, false);
      } else if (_guestPinSetupStep === 'confirm') {
        if (_guestPinSetupBuffer === _guestPinSetupFirst) {
          const saltBytes = crypto.getRandomValues(new Uint8Array(16));
          const saltB64 = btoa(String.fromCharCode(...saltBytes));
          BB.storage.set('GuestPinSalt', saltB64);
          BB.storage.set('PinEnabled', '1');
          BB.storage.set('PinCode', _guestPinSetupFirst);
          BB.storage.set('PinLinkedUID', currentUser ? currentUser.uid : 'guest');
          sessionStorage.setItem('bbPinUnlocked', '1');
          BB.storage.remove('_recentMoods'); // home paints before the PIN unlock
          try { BB.platform.syncWidgetMoods(); } catch (_) {}
          _guestCryptoKey = await _guestDeriveKey(_guestPinSetupFirst, saltB64);
          await _guestExportKeyToSession(_guestCryptoKey);
          const overlay = document.getElementById('guestPinSetupOverlay');
          if (overlay) overlay.style.display = 'none';
          if (_guestPinSetupCallback) {
            const cb = _guestPinSetupCallback;
            _guestPinSetupCallback = null;
            cb();
          }
        } else {
          errEl.textContent = 'PINs did not match. Try again.';
          setTimeout(() => {
            _guestPinSetupBuffer = '';
            _guestPinSetupFirst = '';
            _guestPinSetupStep = 'set';
            titleEl.textContent = 'Protect your data';
            descEl.textContent = 'Choose a 4-digit PIN to lock your journal.';
            errEl.textContent = '';
            _renderPinDots('guestPinSetupDots', 0, false);
          }, 800);
        }
      }
    }

    async function _guestPinForgotReset() {
      if (!confirm(BB.t('journal.confirm.deleteAllBody'))) return;
      if (!confirm(BB.t('journal.confirm.deleteAllLast'))) return;
      const toDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('entry:') || k === 'bbPinCode' || k === 'bbPinEnabled' || k === 'bbGuestPinSalt')) toDelete.push(k);
      }
      toDelete.forEach(k => localStorage.removeItem(k));
      sessionStorage.removeItem('bb_guest_key');
      sessionStorage.removeItem('bbPinUnlocked');
      _guestCryptoKey = null;
      const el = document.getElementById('pinOverlay');
      if (el) el.style.display = 'none';
      await loadEntries();
    }

    window.guestPinSetupKey = guestPinSetupKey;
    window.guestPinSetupDel = guestPinSetupDel;
    window._guestPinForgotReset = _guestPinForgotReset;

    function _initPinLock() {
      const enabled = BB.storage.get('PinEnabled') === '1';
      const unlocked = sessionStorage.getItem('bbPinUnlocked') === '1';
      const hasSalt  = !!BB.storage.get('GuestPinSalt');
      _updatePinSettingsBtn();
      // Guest encryption PINs (identified by bbGuestPinSalt) are handled inline in the
      // entries area — no full-screen overlay. The overlay is only for logged-in users'
      // optional PIN feature (no salt). Auth handler dismisses it after resolving.
      if (enabled && !unlocked && !hasSalt) {
        const el = document.getElementById('pinOverlay');
        if (el) { el.style.display = 'flex'; }
      }
    }

    function _updatePinSettingsBtn() {
      const enabled = BB.storage.get('PinEnabled') === '1';
      const text = enabled ? '🔒 PIN: On — Change / Disable' : '🔒 Enable PIN Lock';
      const btn = document.getElementById('pinLockSettingsBtnMain');
      if (btn) btn.textContent = text;
    }

    function _syncPinToFirestore() {
      if (!currentUser) return;
      const enabled = BB.storage.get('PinEnabled') === '1';
      const code = BB.storage.get('PinCode') || null;
      db.collection('userSettings').doc(currentUser.uid).set(
        { pinEnabled: enabled, pinCode: code },
        { merge: true }
      ).catch(() => {});
    }

    function pinKey(digit) {
      if (_pinBuffer.length >= 4) return;
      _pinBuffer += digit;
      _renderPinDots('pinDots', _pinBuffer.length, false);
      if (_pinBuffer.length === 4) {
        const saved = BB.storage.get('PinCode');
        if (_pinBuffer === saved) {
          sessionStorage.setItem('bbPinUnlocked', '1');
          const el = document.getElementById('pinOverlay');
          if (el) el.style.display = 'none';
          // For guests, derive the encryption key then reload entries
          if (!currentUser) {
            const _enteredPin = _pinBuffer;
            _pinBuffer = '';
            const salt = BB.storage.get('GuestPinSalt');
            if (salt) {
              _guestDeriveKey(_enteredPin, salt).then(key => {
                _guestCryptoKey = key;
                return _guestExportKeyToSession(key);
              }).then(() => loadEntries()).catch(e => console.error('Guest key derive failed', e));
            }
          }
        } else {
          document.getElementById('pinError').textContent = 'Incorrect PIN. Try again.';
          setTimeout(() => {
            _pinBuffer = '';
            _renderPinDots('pinDots', 0, false);
            document.getElementById('pinError').textContent = '';
          }, 800);
        }
      }
    }

    function pinDel() {
      if (_pinBuffer.length === 0) return;
      _pinBuffer = _pinBuffer.slice(0, -1);
      _renderPinDots('pinDots', _pinBuffer.length, false);
    }

    function pinForgot() {
      if (!currentUser) {
        _guestPinForgotReset();
        return;
      }
      if (confirm(BB.t('journal.dlg.resetPin'))) {
        BB.storage.remove('PinCode');
        BB.storage.remove('PinEnabled');
        _syncPinToFirestore();
        sessionStorage.setItem('bbPinUnlocked', '1');
        const el = document.getElementById('pinOverlay');
        if (el) el.style.display = 'none';
        _updatePinSettingsBtn();
      }
    }

    function openPinSettings() {
      const enabled = BB.storage.get('PinEnabled') === '1';
      _pinSetupBuffer = '';
      _pinSetupFirst = '';
      _pinSetupStep = enabled ? 'confirm_old' : 'set';
      const title = document.getElementById('pinSetupTitle');
      const desc = document.getElementById('pinSetupDesc');
      if (enabled) {
        title.textContent = '🔒 Change or Disable PIN';
        desc.textContent = 'Enter your current PIN to continue.';
      } else {
        title.textContent = '🔒 Set PIN';
        desc.textContent = 'Choose a 4-digit PIN.';
      }
      document.getElementById('pinSetupError').textContent = '';
      _renderPinDots('pinSetupDots', 0, true);
      document.getElementById('pinSetupModal').classList.add('active');
    }

    function closePinSetup() {
      document.getElementById('pinSetupModal').classList.remove('active');
      _pinSetupBuffer = '';
      _nativePinSetupMode = false;
      const disableBtn = document.getElementById('pinDisableBtn');
      if (disableBtn) disableBtn.onclick = disablePin;
    }

    async function pinSetupKey(digit) {
      if (_pinSetupBuffer.length >= 4) return;
      _pinSetupBuffer += digit;
      _renderPinDots('pinSetupDots', _pinSetupBuffer.length, true);
      if (_pinSetupBuffer.length < 4) return;

      const desc = document.getElementById('pinSetupDesc');
      const errEl = document.getElementById('pinSetupError');

      if (_pinSetupStep === 'confirm_old') {
        // Verify existing PIN
        if (_pinSetupBuffer === BB.storage.get('PinCode')) {
          _pinSetupBuffer = '';
          _pinSetupStep = 'set';
          document.getElementById('pinSetupTitle').textContent = '🔒 New PIN';
          desc.textContent = 'Enter your new 4-digit PIN.';
          errEl.textContent = '';
          // Add a "Disable PIN" option prompt
          _renderPinDots('pinSetupDots', 0, true);
          // Also add disable button
          const disableBtn = document.getElementById('pinDisableBtn');
          if (disableBtn) disableBtn.style.display = 'inline-block';
        } else {
          errEl.textContent = 'Incorrect PIN.';
          setTimeout(() => { _pinSetupBuffer = ''; _renderPinDots('pinSetupDots', 0, true); errEl.textContent = ''; }, 800);
        }
      } else if (_pinSetupStep === 'set') {
        _pinSetupFirst = _pinSetupBuffer;
        _pinSetupBuffer = '';
        _pinSetupStep = 'confirm';
        desc.textContent = 'Re-enter PIN to confirm.';
        errEl.textContent = '';
        _renderPinDots('pinSetupDots', 0, true);
      } else if (_pinSetupStep === 'confirm') {
        if (_pinSetupBuffer === _pinSetupFirst) {
          if (_nativePinSetupMode) {
            try {
              const _ss = window.Capacitor?.Plugins?.SecureStorage;
              if (!_ss) throw new Error('SecureStorage unavailable');
              await Promise.race([
                _ss.setItem('bb_native_pin', _pinSetupFirst),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
              ]);
              BB.storage.set('NativePinEnabled', '1');
              sessionStorage.setItem('bbPinUnlocked', '1');
              BB.storage.remove('_recentMoods'); // home paints before the PIN unlock
              try { BB.platform.syncWidgetMoods(); } catch (_) {}
              _nativePinSetupMode = false;
              closePinSetup();
              _updateNativePinBtn();
            } catch(e) {
              errEl.textContent = 'Failed to save PIN. Try again.';
              setTimeout(() => { _pinSetupBuffer = ''; _pinSetupFirst = ''; _pinSetupStep = 'set'; desc.textContent = 'Choose a 4-digit PIN.'; _renderPinDots('pinSetupDots', 0, true); errEl.textContent = ''; }, 1200);
            }
          } else {
          BB.storage.set('PinCode', _pinSetupFirst);
          BB.storage.set('PinEnabled', '1');
          sessionStorage.setItem('bbPinUnlocked', '1');
          _syncPinToFirestore();
          closePinSetup();
          _updatePinSettingsBtn();
          // Hide disable btn if shown
          const disableBtn = document.getElementById('pinDisableBtn');
          if (disableBtn) disableBtn.style.display = 'none';
          }
        } else {
          errEl.textContent = 'PINs did not match. Try again.';
          setTimeout(() => {
            _pinSetupBuffer = '';
            _pinSetupFirst = '';
            _pinSetupStep = 'set';
            desc.textContent = 'Enter your new 4-digit PIN.';
            _renderPinDots('pinSetupDots', 0, true);
            errEl.textContent = '';
          }, 800);
        }
      }
    }

    function pinSetupDel() {
      if (_pinSetupBuffer.length === 0) return;
      _pinSetupBuffer = _pinSetupBuffer.slice(0, -1);
      _renderPinDots('pinSetupDots', _pinSetupBuffer.length, true);
    }

    function disablePin() {
      BB.storage.remove('PinCode');
      BB.storage.remove('PinEnabled');
      _syncPinToFirestore();
      closePinSetup();
      _updatePinSettingsBtn();
      const disableBtn = document.getElementById('pinDisableBtn');
      if (disableBtn) disableBtn.style.display = 'none';
    }

    // ── Native app-wide PIN ──
    let _nativePinSetupMode = false;

    function openNativePinSettings() {
      _nativePinSetupMode = true;
      const enabled = BB.storage.get('NativePinEnabled') === '1';
      _pinSetupBuffer = '';
      _pinSetupFirst = '';
      _pinSetupStep = 'set';
      document.getElementById('pinSetupTitle').textContent = enabled ? '🔒 Change or Disable PIN' : '🔒 Set App PIN';
      document.getElementById('pinSetupDesc').textContent = 'Choose a 4-digit PIN to lock the app.';
      document.getElementById('pinSetupError').textContent = '';
      _renderPinDots('pinSetupDots', 0, true);
      const disableBtn = document.getElementById('pinDisableBtn');
      if (disableBtn) {
        disableBtn.style.display = enabled ? 'inline-block' : 'none';
        disableBtn.onclick = disableNativePin;
      }
      document.getElementById('pinSetupModal').classList.add('active');
    }

    async function disableNativePin() {
      BB.storage.remove('NativePinEnabled');
      _refreshRecentMoods();
      sessionStorage.removeItem('bbPinUnlocked');
      await (window.Capacitor?.Plugins?.SecureStorage?.removeItem('bb_native_pin') ?? Promise.resolve()).catch(() => {});
      _nativePinSetupMode = false;
      closePinSetup();
      _updateNativePinBtn();
    }

    function _updateNativePinBtn() {
      const enabled = BB.storage.get('NativePinEnabled') === '1';
      const btn = document.getElementById('nativePinSettingsBtn');
      if (btn) btn.textContent = enabled ? '🔒 PIN: On — Change / Disable' : '🔒 Enable PIN';
    }

    function _renderPinDots(containerId, filled, dark) {
      const dots = document.querySelectorAll(`#${containerId} .pin-dot`);
      dots.forEach((d, i) => {
        d.classList.toggle('filled', i < filled);
      });
    }

    window.pinKey = pinKey;
    window.pinDel = pinDel;
    window.pinForgot = pinForgot;
    window.openPinSettings = openPinSettings;
    window.closePinSetup = closePinSetup;
    window.pinSetupKey = pinSetupKey;
    window.pinSetupDel = pinSetupDel;
    window.disablePin = disablePin;
    window.openNativePinSettings = openNativePinSettings;
    window.disableNativePin = disableNativePin;

    // Call PIN init on load (runs immediately if DOM already ready)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _initPinLock);
    } else {
      _initPinLock();
    }

    // ── Guest inactivity relock (5 min) ──
    if (BB.storage.get('GuestPinSalt')) {
      let _idleTimer;
      function _resetIdleTimer() {
        clearTimeout(_idleTimer);
        _idleTimer = setTimeout(() => {
          sessionStorage.removeItem('bbPinUnlocked');
          sessionStorage.removeItem('bb_guest_key');
          _guestCryptoKey = null;
          location.replace('index.html');
        }, 5 * 60 * 1000);
      }
      ['touchstart', 'mousedown', 'keydown', 'scroll'].forEach(ev =>
        document.addEventListener(ev, _resetIdleTimer, { passive: true })
      );
      _resetIdleTimer();
    }

    // ── Native app PIN inactivity relock (5 min) ──
    if (isNative() && BB.storage.get('NativePinEnabled') === '1') {
      let _nativeIdleTimer;
      function _resetNativeIdleTimer() {
        clearTimeout(_nativeIdleTimer);
        _nativeIdleTimer = setTimeout(() => {
          sessionStorage.removeItem('bbPinUnlocked');
          _userCryptoKey = null;
          location.replace('index.html');
        }, 5 * 60 * 1000);
      }
      ['touchstart', 'mousedown', 'keydown', 'scroll'].forEach(ev =>
        document.addEventListener(ev, _resetNativeIdleTimer, { passive: true })
      );
      _resetNativeIdleTimer();
    }

    // ── Focused Mode state ──
    // _fmEnabled  — user's preference; true = focused mode opens by default.
    //               Persisted in localStorage('focusedModeEnabled'), synced to Firestore.
    // _fmActive   — true while the focused-mode card is actively shown on screen.
    //               Set false when the card is hidden (after save, cancel, or date change).
    // _fmSteps    — ordered array of step objects for the current entry session,
    //               rebuilt by _buildFocusedSteps() whenever tracking prefs change.
    // _fmStepIndex — index into _fmSteps of the currently displayed step.
    // _fmHighWater — highest step index reached this session; used to prevent re-showing hints.
    // _fmEnergyClear/_fmSleepClear — true when user explicitly cleared a pre-filled value.
    let _fmEnabled = localStorage.getItem('focusedModeEnabled') !== '0';
    let _fmActive  = false;
    let _fmStepIndex = 0;
    let _fmSteps = [];
    let _fmEnergyClear = false;
    let _fmSleepClear  = false;
    let _fmWantsSleepQuality = false; // true only when user long-pressed a sleep range
    let _fmHighWater   = 0; // furthest step index reached this session
    let _fmStepsResult      = null; // step count synced from health (e.g. Apple Health)
    let _fmEnergySuggestion = null; // auto-suggested energy level from health data
    let _fmSleepImported    = null; // imported sleep hours from health data
    let _fmSleepSuggestion  = null; // suggested sleep value shown as pre-fill
    let _fmSleepError       = null; // error message if sleep import failed
    let _fmSleepAutoSyncDone = false; // prevents re-auto-import after undo
    let _fmExtraSelected    = new Set();
    let _sleepSuggestedVal  = null;
    let _sleepHealthSynced  = false; // true only when sleep came from a health data sync
    let _fmMoodSuggestion   = null; // best-guess mood derived from synced steps + sleep
    let _fmStepsRaw         = null; // raw synced step count (number) for the hero readout
    let _fmUserExited       = false; // ✕ Exit on an unlogged day — blocks auto-reopen until resume
    let _fmDayFillBusy      = false; // true while the first-step auto-fill is reading Health
    let _fmDayFillMsg       = null;  // 'nodata' → the button reports Health had nothing
    let _fmDayFillSnapshot  = null;  // { mood, energy, sleep } the auto-fill wrote, for the AUTO mark

    const _FM_MOOD_COLORS  = { manic:'#ff4444', elevated:'var(--brand-primary)', stable:'#51cf66', good:'#51cf66', low:'#845ef7', depressed:'#5c7cfa' };
    const _FM_BTN_FILLS    = { '#ff4444':'#c92a2a', '#51cf66':'#2f7a3a', '#845ef7':'#6741d9', '#5c7cfa':'#3b5bdb' };
    const _FM_MOOD_LABELS  = { manic:BB.t('mood.manic'), elevated:BB.t('mood.elevated'), stable:BB.t('mood.stable'), good:BB.t('mood.stable'), low:BB.t('mood.low'), depressed:BB.t('mood.depressed') };

    // Spectrum (0–10) stand-in for each legacy category — the middle of the band
    // _moodCat() maps back to, so a value written here round-trips to the same
    // category it came from.
    const _FM_SPECTRUM_FOR_CAT = { depressed:1, low:3, stable:5, elevated:7, manic:9 };

    const _FM_ENERGY_LEVELS = [
      { val:0,  label:BB.t('journal.energy.notEnough'), color:'#6c757d' },
      { val:3,  label:BB.t('journal.energy.less'),      color:'#FF851B' },
      { val:5,  label:BB.t('journal.energy.normal'),    color:'#2ECC40' },
      { val:7,  label:BB.t('journal.energy.more'),      color:'#FF851B' },
      { val:10, label:BB.t('journal.energy.tooMuch'),   color:'#FF4136' },
    ];
    const _FM_SLEEP_RANGES = [
      { val:5,   label:'😫 ≤5h',   color:'#FF4136' },
      { val:6.5, label:'😕 6–7h',  color:'#FF851B' },
      { val:8,   label:'😊 7–9h',  color:'#2ECC40' },
      { val:9.5, label:'😴 9–10h', color:'#0074D9' },
      { val:11,  label:'💤 10+h',  color:'#7B68EE' },
    ];

    // ── Full spectrum scales ──────────────────────────────────────────────────
    // With the "Full spectrum" setting on, sleep and energy get the same
    // fine-grained treatment as mood: an hour-by-hour sleep scale and a 0–10
    // energy scale, rendered as an msc slider in plain mode and as the full set
    // of wheel stops in wheel mode. Off, both keep the five coarse buckets above.
    //
    // Sleep runs ≤4h … ≥12h. The endpoints are clamps, not literal values — 4
    // means "4 or fewer", 12 means "12 or more" — which is why they carry their
    // own labels. The interior values are exact hours, so a saved entry reads
    // "7h" rather than being rounded into a 7–9h bucket.
    const _FM_SLEEP_FULL_MIN = 4;
    const _FM_SLEEP_FULL_MAX = 12;
    const _FM_ENERGY_FULL_MIN = 0;
    const _FM_ENERGY_FULL_MAX = 10;

    /**
     * Emoji / label / colour for any sleep value in hours. Shared by the full
     * spectrum slider, the full spectrum wheel, the summary chips and the done
     * step, so a value picked in one place reads identically everywhere.
     * Bands mirror _FM_SLEEP_RANGES so colours stay consistent with the coarse UI.
     */
    function _fmSleepMeta(h) {
      const n = Number(h);
      if (!isFinite(n)) return { emoji:'🛌', label:'—', band:'', color:'#adb5bd' };
      const label = n <= _FM_SLEEP_FULL_MIN ? `≤${_FM_SLEEP_FULL_MIN}h`
        : n >= _FM_SLEEP_FULL_MAX ? `≥${_FM_SLEEP_FULL_MAX}h`
        : `${_fmtHours(n)}h`;
      const _b = k => BB.t('journal.sleepBand.' + k);
      if (n <= 5)  return { emoji:'😫', label, band:_b('veryShort'), color:'#FF4136' };
      if (n < 7)   return { emoji:'😕', label, band:_b('short'),     color:'#FF851B' };
      if (n <= 9)  return { emoji:'😊', label, band:_b('healthy'),   color:'#2ECC40' };
      if (n <= 10) return { emoji:'😴', label, band:_b('long'),      color:'#0074D9' };
      return { emoji:'💤', label, band:_b('veryLong'), color:'#7B68EE' };
    }

    /** Trim a trailing .0 so 6.5 stays "6.5" but 7 reads "7", not "7.0". */
    function _fmtHours(n) {
      return Number.isInteger(Number(n)) ? String(Number(n)) : String(Number(n));
    }

    /**
     * Mood-estimator weight for an energy value. The five coarse levels used to
     * be a plain lookup ({0:-50, 3:-8, 5:0, 7:8, 10:50}) with everything else
     * falling back to 0 — which, once full spectrum let the user pick 4 or 8,
     * silently threw that field's signal away. Linear interpolation between the
     * same five anchors keeps the legacy values scoring exactly as before while
     * giving the in-between ones a proportional weight.
     */
    function _energyScore(v) {
      const n = Number(v);
      if (!isFinite(n)) return 0;
      const pts = [[0, -50], [3, -8], [5, 0], [7, 8], [10, 50]];
      if (n <= pts[0][0]) return pts[0][1];
      if (n >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        if (n <= x1) return y0 + (y1 - y0) * (n - x0) / (x1 - x0);
      }
      return 0;
    }

    /**
     * Emoji / label / colour for any energy value 0–10, with 5 = normal.
     * Bands match the five coarse _FM_ENERGY_LEVELS so the two UIs agree:
     * 0 not enough · 1–4 less than usual · 5 normal · 6–9 more · 10 too much.
     */
    function _fmEnergyMeta(v) {
      const n = Number(v);
      if (!isFinite(n)) return { emoji:'⚡', label:'—', color:'#adb5bd' };
      const _pick = key => {
        const full = BB.t(key);
        const parts = full.split(' ');
        return { emoji: parts[0] || '⚡', label: parts.slice(1).join(' ') || full };
      };
      if (n <= 0) return { ..._pick('journal.energy.notEnough'), color:'#6c757d' };
      if (n <= 4) return { ..._pick('journal.energy.less'),      color:'#FF851B' };
      if (n === 5) return { ..._pick('journal.energy.normal'),   color:'#2ECC40' };
      if (n <= 9) return { ..._pick('journal.energy.more'),      color:'#FF851B' };
      return { ..._pick('journal.energy.tooMuch'),               color:'#FF4136' };
    }
    const _FM_EYEBROWS = {
      mood:       () => BB.t('journal.fm.eyebrowMood'),
      energy:     () => BB.t('journal.fm.eyebrowEnergy'),
      sleep:      () => BB.t('journal.fm.eyebrowSleep'),
      medication:   () => BB.t('journal.fm.eyebrowMeds'),
      notes:        () => BB.t('journal.fm.eyebrowNotes'),
      done:         () => BB.t('journal.fm.eyebrowDone'),
      sleepQuality: () => BB.t('journal.fm.eyebrowSleepQuality'),
    };

    /** Platform-branded "Synced from …" badge label. */
    function _syncSourceLabel() {
      return isIOS() ? BB.t('journal.sync.apple')
        : isAndroid() ? BB.t('journal.sync.android')
        : BB.t('journal.sync.generic');
    }

    /** 7.53 → "7<span class=u>h</span> 32<span class=u>m</span>" for the hero readout. */
    function _fmFmtSleepHM(hours) {
      const totalMin = Math.round(hours * 60);
      const h = Math.floor(totalMin / 60), m = totalMin % 60;
      return `${h}<span class="u">h</span>${m ? ` ${m}<span class="u">m</span>` : ''}`;
    }

    /** Map exact sleep hours to the wheel bucket value (matches the label ranges). */
    function _fmSleepBucketOf(h) {
      return h <= 5.5 ? 5 : h < 7 ? 6.5 : h <= 9 ? 8 : h <= 10 ? 9.5 : 11;
    }

    function _fmFormatPromptDate(d) {
      const lang = (window.BB && BB.i18n && BB.i18n.getLang && BB.i18n.getLang()) || 'en';
      if (lang === 'en') {
        const day = d.getDate();
        const ord = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
        const month = d.toLocaleDateString('en-GB', { month: 'short' });
        return `${day}${ord} ${month}`;
      }
      const localeMap = { zh: 'zh-Hans' };
      try { return d.toLocaleDateString(localeMap[lang] || lang, { day: 'numeric', month: 'short' }); }
      catch (_) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
    }

    function _fmMoodTitle() {
      const val = document.getElementById('entryDate')?.value;
      const _t = (k, vars) => (window.BB && BB.t) ? BB.t(k, vars) : k;
      if (!val) return _t('journal.prompt.howFallback');
      const now = new Date(); now.setHours(0,0,0,0);
      const toKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
      if (val === toKey(now)) return _t('journal.prompt.howToday');
      if (val === toKey(yesterday)) return _t('journal.prompt.howYesterday');
      const d = new Date(val + 'T00:00:00');
      return _t('journal.prompt.howDate', { date: _fmFormatPromptDate(d) });
    }

    function _fmIsTracking(key, legacy) {
      if (_editFieldOverrides !== null) return !!_editFieldOverrides[key];
      if (localStorage.getItem(key) !== null) return localStorage.getItem(key) === 'true';
      if (legacy) return localStorage.getItem(legacy) === 'true';
      return key === 'trackBudget'; // trackBudget on by default
    }

    function _fmFormatLongDate(d) {
      const lang = (window.BB && BB.i18n && BB.i18n.getLang && BB.i18n.getLang()) || 'en';
      if (lang === 'en') {
        const day = d.getDate();
        const ord = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
        const month = d.toLocaleDateString('en-GB', { month: 'long' });
        return `${day}${ord} ${month}`;
      }
      const localeMap = { zh: 'zh-Hans' };
      try { return d.toLocaleDateString(localeMap[lang] || lang, { day: 'numeric', month: 'long' }); }
      catch (_) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }); }
    }

    function _fmDateHelper() {
      const val = document.getElementById('entryDate')?.value;
      const _t = (k, vars) => (window.BB && BB.t) ? BB.t(k, vars) : k;
      const now = new Date(); now.setHours(0,0,0,0);
      const toKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
      const isYest = !val || val === toKey(yesterday);
      if (isYest) return { isYest: true, dayPhrase: _t('journal.phrase.yesterday'), nightPhrase: _t('journal.phrase.lastNight') };
      const d = new Date(val + 'T00:00:00');
      const longDate = _fmFormatLongDate(d);
      return { isYest: false, dayPhrase: _t('journal.phrase.onDate', { date: longDate }), nightPhrase: _t('journal.phrase.nightOfDate', { date: longDate }) };
    }

    // The sleep recorded against an entry dated D is "the night of D" — the night
    // that begins on day D. For today (or any future date) that night hasn't
    // happened yet, so there's nothing to record. Used to lock the sleep field
    // and show a "haven't slept yet" message instead of selectable ranges.
    function _sleepNotYet() {
      const val = document.getElementById('entryDate')?.value;
      if (!val) return false; // no explicit date → default is yesterday; sleep already happened
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const d = new Date(val + 'T00:00:00');
      return !isNaN(d.getTime()) && d.getTime() >= today.getTime();
    }
    window._sleepNotYet = _sleepNotYet;

    function _buildFocusedSteps() {
      const _delBuiltinSteps = JSON.parse(localStorage.getItem('deletedBuiltinFields') || '[]');
      const _disSteps = _getDisabledSteps();
      let _medListLen = 0;
      try { const _ml = JSON.parse(localStorage.getItem('currentMedList') || '[]'); _medListLen = Array.isArray(_ml) ? _ml.length : 0; } catch(e) {}
      const hasMeds = _medListLen > 0 || !!selectedMedication;
      const _dh = _fmDateHelper();
      const _t = (k, vars) => (window.BB && BB.t) ? BB.t(k, vars) : k;
      const steps = [
        { id:'mood', title:_fmMoodTitle(), subtitle:'', auto:true },
      ];
      // Sleep is asked before energy. sleepQuality must stay directly after
      // sleep — the long-press jump and the auto-skip in _fmAdvance rely on
      // that adjacency.
      if (!_disSteps.includes('sleep')) {
        const _slNotYet = _sleepNotYet();
        steps.push({
          id:'sleep',
          title: _slNotYet ? _t('journal.fm.sleepNotYetTitle')
            : _dh.isYest ? _t('journal.fm.sleepTitleYest')
            : _t('journal.fm.sleepTitleOther', { phrase: _dh.nightPhrase }),
          // Full spectrum replaces the tappable ranges with a slider, so "Tap a
          // range" would be describing a control that isn't there.
          subtitle: _slNotYet ? '' : _t(_spectrumEnabled() && !_wheelMode() ? 'journal.fm.sleepSubSlider' : 'journal.fm.sleepSub'),
          auto:true
        });
      }
      // sleepQuality step is always included — only shown when user long-presses a sleep range
      steps.push({ id:'sleepQuality', title:_t('journal.fm.sleepQualityTitle'), subtitle:'', auto:true });
      if (!_disSteps.includes('energy'))
        steps.push({ id:'energy', title:_t('journal.fm.energyTitle'), subtitle:_t('journal.fm.energySub', { phrase: _dh.dayPhrase }), auto:true });
      if (!_disSteps.includes('medication'))
        steps.push({ id:'medication', title:_t('journal.fm.medsTitle', { phrase: _dh.nightPhrase }), subtitle:'', auto:true });
      // More data step — all activated tracking fields shown together (order mirrors field picker)
      const _extras = [];
      if (_fmIsTracking('trackGoals'))
        _extras.push({ id:'goals',    label:_t('journal.field.goals') });
      if (_fmIsTracking('trackBudget'))
        _extras.push({ id:'budget',   label:_t('journal.field.budget') });
      if (_fmIsTracking('trackExercise') && !_delBuiltinSteps.includes('trackExercise'))
        _extras.push({ id:'exercise', label:_t('journal.field.exercise') });
      if (_fmIsTracking('trackOutside') && !_delBuiltinSteps.includes('trackOutside'))
        _extras.push({ id:'outside',  label:_t('journal.field.outside') });
      if (_fmIsTracking('trackAnxiety', 'trackEmotions') && !_delBuiltinSteps.includes('trackAnxiety'))
        _extras.push({ id:'anxiety',  label:_t('journal.field.anxiety') });
      if (_fmIsTracking('trackAlcohol') && !_delBuiltinSteps.includes('trackAlcohol'))
        _extras.push({ id:'alcohol',  label:_t('journal.field.alcohol') });
      if (!_disSteps.includes('more_data'))
        steps.push({ id:'more_data', title:_t('journal.fm.moreDataTitle'), subtitle: _extras.length ? _t('journal.fm.moreDataSub') : '', auto:false, extras:_extras });
      if (!_disSteps.includes('notes'))
        steps.push({ id:'notes', title:_t('journal.fm.notesTitle'), subtitle:_t('journal.fm.notesSub'), auto:false });
      steps.push({ id:'done',  title:_t('journal.fm.doneTitle'), subtitle:_t('journal.fm.doneSub'), auto:false });
      return steps;
    }

    function _toggleMoodSpectrum() {
      const chk = document.getElementById('moodSpectrumToggle');
      const on = !!(chk && chk.checked);
      localStorage.setItem('moodSpectrumEnabled', on ? '1' : '0');
      // Switching modes changes what `selectedMood` should hold (number vs string),
      // so clear any in-progress selection to avoid a mismatched value being saved.
      selectedMood = null;
      selectedLinkedMood = null;
      _applyMoodSpectrumMode();
      if (typeof _fmActive !== 'undefined' && _fmActive) _renderFocusedStep();
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid).set({ moodSpectrumEnabled: on }, { merge: true }).catch(() => {});
      }
    }
    window._toggleMoodSpectrum = _toggleMoodSpectrum;

    // BETA: switch focus mode between the plain step-by-step list (off, default)
    // and the full spinner-wheel experience (on).
    function _toggleWheelMode() {
      const chk = document.getElementById('wheelModeToggle');
      const on = !!(chk && chk.checked);
      localStorage.setItem('wheelModeEnabled', on ? '1' : '0');
      // Live-swap the current step if focus mode is open.
      if (typeof _fmActive !== 'undefined' && _fmActive) _renderFocusedStep();
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid).set({ wheelModeEnabled: on }, { merge: true }).catch(() => {});
      }
    }
    window._toggleWheelMode = _toggleWheelMode;

    // Show/hide the spectrum slider vs the five-button selector in the standard form.
    function _applyMoodSpectrumMode() {
      const on = _spectrumEnabled();
      const btns = document.querySelector('.mood-selector');
      const wheel = document.getElementById('moodSpectrumControl');
      if (btns) btns.style.display = on ? 'none' : '';
      if (wheel) wheel.style.display = on ? '' : 'none';
      // Reset the standard-form selection UI so no stale highlight/value lingers.
      document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected', 'cycle-hover', 'linked'));
      if (on) _resetSpectrumControl();
      _applySleepEnergySpectrumMode(on);
    }
    window._applyMoodSpectrumMode = _applyMoodSpectrumMode;

    /**
     * Swap the classic form's five sleep / energy buttons for the full spectrum
     * sliders, mirroring what _applyMoodSpectrumMode does for mood.
     *
     * The button rows are HIDDEN, never removed. Around a dozen call sites —
     * draft restore, edit restore, resetForm, the health-sync handlers — set
     * selectedSleep / selectedEnergy and then repaint those buttons. Leaving them
     * in the DOM means every one of those paths keeps working untouched; the
     * MutationObserver below notices the repaint and mirrors the (already
     * updated) variable onto the slider. Nothing reads the buttons back —
     * selectedSleep / selectedEnergy are the sole source of truth for saving —
     * so a hidden repaint is harmless.
     */
    function _applySleepEnergySpectrumMode(on) {
      const _pairs = [
        ['sleepSelector', 'sleepSpectrumControl'],
        ['energySelector', 'energySpectrumControl'],
      ];
      _pairs.forEach(([btnsId, ctrlId]) => {
        const b = document.getElementById(btnsId);
        const c = document.getElementById(ctrlId);
        if (b) b.style.display = on ? 'none' : '';
        if (c) c.style.display = on ? '' : 'none';
      });
      if (!on) return;
      // The slider steps in whole hours, but the form's default is 7.5 (a legacy
      // mid-bucket value) — which would render "7.5h" under a thumb sitting at 8.
      // Round it once on switch-on. A health-synced value is left alone: 7.7h
      // from Apple Health is a real measurement, and showing the exact figure
      // under a nearest-stop thumb is the intended behaviour there.
      if (selectedSleep != null && !_sleepHealthSynced && !Number.isInteger(selectedSleep)) {
        selectedSleep = Math.round(_fmClampSleep(selectedSleep));
      }
      _syncSpectrumSliders();
    }

    /** Paint both classic-form sliders from the current selection. */
    function _syncSpectrumSliders() {
      if (!_spectrumEnabled()) return;
      // moveSlider TRUE: this reflects state the user set somewhere else (draft
      // restore, health sync, edit), so the thumb has to follow it.
      if (selectedSleep != null) _paintSleepSpectrum(_fmClampSleep(selectedSleep), true);
      if (selectedEnergy != null) _paintEnergySpectrum(Math.round(_fmClampEnergy(selectedEnergy)), true);
    }
    window._syncSpectrumSliders = _syncSpectrumSliders;

    /**
     * Mirror hidden-button repaints onto the sliders. Watching the DOM rather
     * than patching each call site keeps the two representations from drifting:
     * any future code path that highlights a sleep/energy button is picked up
     * automatically. `moveSlider` is false here because the repaint is a
     * reflection of state the user didn't set via the slider.
     */
    (function _spectrumSliderSync() {
      if (typeof MutationObserver === 'undefined') return;
      const obs = new MutationObserver(() => {
        // The call sites assign the variable BEFORE repainting, so by the time
        // this fires the value is already current.
        _syncSpectrumSliders();
      });
      const attach = () => {
        ['sleepSelector', 'energySelector'].forEach(id => {
          const el = document.getElementById(id);
          if (el) obs.observe(el, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
        });
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
      else attach();
    })();

    function _paintSleepSpectrum(h, moveSlider) {
      const m = _fmSleepMeta(h);
      const slider = document.getElementById('slscSlider');
      const ctrl   = document.getElementById('sleepSpectrumControl');
      const emoji  = document.getElementById('slscEmoji');
      const val    = document.getElementById('slscValue');
      const label  = document.getElementById('slscLabel');
      if (slider && moveSlider !== false) slider.value = String(Math.round(h));
      if (slider) slider.style.setProperty('--msc-accent', m.color);
      if (ctrl) { ctrl.style.setProperty('--msc-accent', m.color); ctrl.classList.add('committed'); }
      if (emoji) emoji.textContent = m.emoji;
      if (val) { val.textContent = m.label; val.style.color = m.color; }
      if (label) label.textContent = m.band;
    }

    function _paintEnergySpectrum(v, moveSlider) {
      const m = _fmEnergyMeta(v);
      const slider = document.getElementById('enscSlider');
      const ctrl   = document.getElementById('energySpectrumControl');
      const emoji  = document.getElementById('enscEmoji');
      const val    = document.getElementById('enscValue');
      const label  = document.getElementById('enscLabel');
      if (slider && moveSlider !== false) slider.value = String(v);
      if (slider) slider.style.setProperty('--msc-accent', m.color);
      if (ctrl) { ctrl.style.setProperty('--msc-accent', m.color); ctrl.classList.add('committed'); }
      if (emoji) emoji.textContent = m.emoji;
      if (val) { val.textContent = String(v); val.style.color = m.color; }
      if (label) label.textContent = m.label;
    }

    /** Classic-form sleep slider drag → commit the hours. */
    function _onSleepSpectrumChange(v) {
      selectedSleep = _fmClampSleep(v);
      _sleepHealthSynced = false; // a manual pick overrides any health import
      // moveSlider FALSE: the user is dragging it — writing .value back mid-drag
      // fights the thumb on some browsers.
      _paintSleepSpectrum(selectedSleep, false);
      if (typeof _updateSleepHero === 'function') _updateSleepHero();
      scheduleDraftSave();
    }
    window._onSleepSpectrumChange = _onSleepSpectrumChange;

    /** Classic-form energy slider drag → commit the level. */
    function _onEnergySpectrumChange(v) {
      selectedEnergy = Math.round(_fmClampEnergy(v));
      _paintEnergySpectrum(selectedEnergy, false);
      if (typeof _updateEnergyHero === 'function') _updateEnergyHero();
      scheduleDraftSave();
    }
    window._onEnergySpectrumChange = _onEnergySpectrumChange;

    /** The slider's stand-in for long-pressing a sleep button. */
    function _revealSleepQuality() {
      const sq = document.getElementById('sleepQualitySubSection');
      if (sq) { sq.style.display = ''; try { sq.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {} }
    }
    window._revealSleepQuality = _revealSleepQuality;

    // Reset the standard-form spectrum slider to its neutral, not-yet-chosen state.
    function _resetSpectrumControl() {
      const slider = document.getElementById('mscSlider');
      if (slider) slider.value = 5;
      const ctrl = document.getElementById('moodSpectrumControl');
      if (ctrl) ctrl.classList.remove('committed');
      _renderSpectrumReadout(5);
    }

    // Paint the slider readout (image / number / label / accent) for value n.
    function _renderSpectrumReadout(n) {
      const cat = _moodCat(Number(n));
      const color = moodColors[cat] || 'var(--brand-primary)';
      const img = document.getElementById('mscImg');
      const valEl = document.getElementById('mscValue');
      const labelEl = document.getElementById('mscLabel');
      const slider = document.getElementById('mscSlider');
      const ctrl = document.getElementById('moodSpectrumControl');
      if (img) img.src = _moodImg(Number(n));
      if (valEl) { valEl.textContent = _fmtMoodNum(n); valEl.style.color = color; }
      if (labelEl) labelEl.textContent = _moodLabelOf(Number(n));
      if (slider) slider.style.setProperty('--msc-accent', color);
      if (ctrl) ctrl.style.setProperty('--msc-accent', color);
    }

    // Slider interaction → commit the numeric mood and reveal the rest of the form
    // (mirrors what a .mood-btn click does in the five-mood UI).
    function _onSpectrumChange(v) {
      const n = Number(v);
      selectedMood = n;
      const ctrl = document.getElementById('moodSpectrumControl');
      if (ctrl) ctrl.classList.add('committed');
      const hint = document.getElementById('mscHint');
      if (hint) hint.style.display = 'none';
      _renderSpectrumReadout(n);
      if (typeof _fmApplyMoodTheme === 'function') _fmApplyMoodTheme(_moodCat(n));
      document.querySelectorAll('.hidden-until-mood').forEach(el => {
        el.classList.remove('hidden-until-mood');
        el.classList.add('show-after-mood');
      });
      if (typeof _updateEnergyHero === 'function') _updateEnergyHero();
      if (typeof _updateSleepHero === 'function') _updateSleepHero();
      if (BB.storage.get('HealthSyncEnabled') === '1') {
        if (typeof importStepsFromHealth === 'function') importStepsFromHealth(true);
        if (typeof importSleepFromHealth === 'function') importSleepFromHealth(true);
      }
      scheduleDraftSave();
    }
    window._onSpectrumChange = _onSpectrumChange;

    // Live label update for the legacy edit-modal's 0–10 spectrum slider.
    function _onEditSpectrumInput(v) {
      const el = document.getElementById('editEntryMoodNumLabel');
      if (el) el.textContent = `${_fmtMoodNum(v)} · ${_moodLabelOf(Number(v))}`;
    }
    window._onEditSpectrumInput = _onEditSpectrumInput;

    // Focus-mode 0–10 slider: live-preview the readout, accent and card wash as
    // the user drags (distinct element IDs from the classic form's hidden
    // #moodSpectrumControl). The step's Continue button commits via
    // _fmSpectrumTap (which also fires the severe-low support modal for 0–1).
    function _fmOnSpectrumSlide(v) {
      const n = Number(v);
      selectedMood = n;
      selectedLinkedMood = null;
      _fmPrevMood = null;
      const cat = _moodCat(n);
      const color = moodColors[cat] || 'var(--brand-primary)';
      const img = document.getElementById('fmMscImg');
      const valEl = document.getElementById('fmMscValue');
      const labelEl = document.getElementById('fmMscLabel');
      const slider = document.getElementById('fmMscSlider');
      const ctrl = document.getElementById('fmSpectrumControl');
      const btn = document.getElementById('fmSpectrumContinue');
      if (img) img.src = _moodImg(n);
      if (valEl) { valEl.textContent = _fmtMoodNum(n); valEl.style.color = color; }
      if (labelEl) labelEl.textContent = _moodLabelOf(n);
      if (slider) slider.style.setProperty('--msc-accent', color);
      if (ctrl) ctrl.style.setProperty('--msc-accent', color);
      if (btn) btn.style.background = _FM_BTN_FILLS[color] || color;
      if (typeof _fmApplyMoodTheme === 'function') _fmApplyMoodTheme(cat);
      if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
    }
    window._fmOnSpectrumSlide = _fmOnSpectrumSlide;

    // ── Full spectrum sleep / energy sliders (focus mode, plain) ──────────────
    // Same shape as the mood spectrum slider above: drag to preview, Continue to
    // commit and advance. Kept separate from the mood handlers because the
    // readout is an emoji + hours/level rather than a bear image + mood name.

    /** Clamp to the sleep scale's ends — ≤4h and ≥12h are buckets, not values. */
    function _fmClampSleep(h) {
      return Math.max(_FM_SLEEP_FULL_MIN, Math.min(_FM_SLEEP_FULL_MAX, Number(h)));
    }
    /** Clamp to the 0–10 energy scale. */
    function _fmClampEnergy(v) {
      return Math.max(_FM_ENERGY_FULL_MIN, Math.min(_FM_ENERGY_FULL_MAX, Number(v)));
    }

    function _fmOnSleepSlide(v) {
      const h = _fmClampSleep(v);
      selectedSleep = h;
      _sleepHealthSynced = false; // dragging is a manual pick — it overrides the import
      _fmSleepClear = false;
      const m = _fmSleepMeta(h);
      const emojiEl = document.getElementById('fmSlscEmoji');
      const valEl   = document.getElementById('fmSlscValue');
      const labelEl = document.getElementById('fmSlscLabel');
      const slider  = document.getElementById('fmSlscSlider');
      const ctrl    = document.getElementById('fmSleepSpectrumControl');
      const btn     = document.getElementById('fmSleepSpectrumContinue');
      if (emojiEl) emojiEl.textContent = m.emoji;
      if (valEl) { valEl.textContent = m.label; valEl.style.color = m.color; }
      if (labelEl) labelEl.textContent = m.band;
      if (slider) slider.style.setProperty('--msc-accent', m.color);
      if (ctrl) { ctrl.style.setProperty('--msc-accent', m.color); ctrl.classList.add('committed'); }
      if (btn) btn.style.background = m.color;
      if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
    }
    window._fmOnSleepSlide = _fmOnSleepSlide;

    function _fmSleepSliderTap(v) {
      selectedSleep = _fmClampSleep(v);
      _sleepHealthSynced = false;
      _fmSleepClear = false;
      _fmAdvance();
    }
    window._fmSleepSliderTap = _fmSleepSliderTap;

    /** Commit the slider value and go on to the sleep-quality step (the slider's
     *  stand-in for the long-press available on the card / wheel UIs). */
    function _fmSleepSliderQuality(v) {
      selectedSleep = _fmClampSleep(v);
      _sleepHealthSynced = false;
      _fmSleepClear = false;
      _fmWantsSleepQuality = true;
      const _sqIdx = _fmSteps.findIndex(s => s.id === 'sleepQuality');
      if (_sqIdx > _fmStepIndex) setTimeout(() => _fmGoTo(_sqIdx), 120);
      else _fmAdvance();
    }
    window._fmSleepSliderQuality = _fmSleepSliderQuality;

    function _fmOnEnergySlide(v) {
      const n = Math.round(_fmClampEnergy(v));
      selectedEnergy = n;
      _fmEnergyClear = false;
      const m = _fmEnergyMeta(n);
      const emojiEl = document.getElementById('fmEnscEmoji');
      const valEl   = document.getElementById('fmEnscValue');
      const labelEl = document.getElementById('fmEnscLabel');
      const slider  = document.getElementById('fmEnscSlider');
      const ctrl    = document.getElementById('fmEnergySpectrumControl');
      const btn     = document.getElementById('fmEnergySpectrumContinue');
      if (emojiEl) emojiEl.textContent = m.emoji;
      if (valEl) { valEl.textContent = String(n); valEl.style.color = m.color; }
      if (labelEl) labelEl.textContent = m.label;
      if (slider) slider.style.setProperty('--msc-accent', m.color);
      if (ctrl) { ctrl.style.setProperty('--msc-accent', m.color); ctrl.classList.add('committed'); }
      if (btn) btn.style.background = m.color;
      if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
    }
    window._fmOnEnergySlide = _fmOnEnergySlide;

    function _fmEnergySliderTap(v) {
      selectedEnergy = Math.round(_fmClampEnergy(v));
      _fmEnergyClear = false;
      _fmAdvance();
    }
    window._fmEnergySliderTap = _fmEnergySliderTap;

    // Preselect the slider to a given numeric mood (used by draft restore / edit load).
    function _setSpectrumValue(n) {
      const slider = document.getElementById('mscSlider');
      if (slider) slider.value = String(Math.max(0, Math.min(10, Math.round(Number(n)))));
      const ctrl = document.getElementById('moodSpectrumControl');
      if (ctrl) ctrl.classList.add('committed');
      const hint = document.getElementById('mscHint');
      if (hint) hint.style.display = 'none';
      _renderSpectrumReadout(n);
    }

    function _toggleMoodLinking() {
      const chk = document.getElementById('moodLinkingToggle');
      const val = chk && chk.checked ? '1' : '0';
      localStorage.setItem('moodLinkingEnabled', val);
      if (!chk || !chk.checked) {
        selectedLinkedMood = null;
        if (typeof _fmActive !== 'undefined' && _fmActive) _renderFocusedStep();
      }
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid).set({ moodLinkingEnabled: chk && chk.checked }, { merge: true }).catch(() => {});
      }
    }
    window._toggleMoodLinking = _toggleMoodLinking;

    function _toggleMoodSuggestion() {
      const chk = document.getElementById('moodSuggestionToggle');
      const val = chk && chk.checked ? '1' : '0';
      localStorage.setItem('showMoodSuggestion', val);
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ showMoodSuggestion: val === '1' }, { merge: true }).catch(() => {});
      }
      if (typeof _fmActive !== 'undefined' && _fmActive) _renderFocusedStep();
    }
    window._toggleMoodSuggestion = _toggleMoodSuggestion;

    async function _toggleHealthSync() {
      const chk = document.getElementById('healthSyncToggle');
      const on = !!(chk && chk.checked);
      // Apple Guideline 5.1.1(iv): no cancelable custom message may sit between
      // the user's action and the OS permission request. Flipping the toggle on
      // is itself the deliberate consent action — go straight to the HealthKit /
      // Health Connect permission sheet, which is the real consent gate. The
      // "why" is supplied by the toggle's own description label and the
      // Info.plist usage strings, both shown before the request fires.
      const val = on ? '1' : '0';
      BB.storage.set('HealthSyncEnabled', val);
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ healthSyncEnabled: val === '1' }, { merge: true }).catch(() => {});
      }
      // Enabling on a native device: ask the OS for Health access NOW, bound to
      // this deliberate tap — instead of waiting for a later mood entry to fire
      // the sheet unexpectedly. Previously the toggle only set a flag, so users
      // saw "Not yet authorised" and were never asked when they flipped it on.
      if (on && isNative()) {
        await _requestHealthAccessInteractive();
      }
    }
    window._toggleHealthSync = _toggleHealthSync;

    (function _brandHealthSyncUI() {
      const label = document.getElementById('healthSyncLabel');
      const desc = document.getElementById('healthSyncDesc');
      if (!label || !desc) return;
      if (isIOS()) {
        label.textContent = '❤️ Apple Health sync';
        desc.textContent = 'Import steps & sleep hours from Apple Health (HealthKit)';
      } else if (isAndroid()) {
        label.textContent = '📱 Health Connect sync';
        desc.textContent = 'Import steps & sleep hours from Google Health Connect';
      }
    })();

    // Request Health read access in response to a deliberate user action, then
    // reflect the result in the settings label. Detects the iOS "sheet was
    // suppressed" case — status still .notDetermined after a request, which
    // happens when a prior grant is stuck (classically after delete+reinstall) —
    // and offers a deep-link to the Health app, the only place it can be cleared.
    async function _requestHealthAccessInteractive() {
      const Health = getPlugin('HealthPlugin');
      if (!Health) return;
      try {
        const { available } = await Health.isHealthAvailable();
        if (!available) return;

        // "never asked" state before requesting? (checkHealthPermissions returns
        // false for read types only when iOS status is .notDetermined.)
        let before = null;
        try {
          const pre = await Health.checkHealthPermissions({ permissions: ['READ_SLEEP', 'READ_STEPS'] });
          before = !!(pre?.permissions?.READ_SLEEP || pre?.permissions?.READ_STEPS);
        } catch (e) {}

        skipNextResume = true; // the permission sheet backgrounds the app
        await Health.requestHealthPermissions({ permissions: ['READ_SLEEP', 'READ_STEPS'] });
        skipNextResume = false;

        let after = null;
        try {
          const post = await Health.checkHealthPermissions({ permissions: ['READ_SLEEP', 'READ_STEPS'] });
          after = !!(post?.permissions?.READ_SLEEP || post?.permissions?.READ_STEPS);
        } catch (e) {}

        // Still .notDetermined before AND after a request → no sheet appeared and
        // nothing was decided. The OS silently suppressed it; guide to Settings.
        if (before === false && after === false) {
          _offerHealthSettingsRecovery();
        }

        if (document.getElementById('settingsModal')?.classList.contains('active')) {
          _refreshHealthAuthDisplay().catch(() => {});
        }
      } catch (e) {
        skipNextResume = false;
        console.warn('Health permission request failed:', e);
      }
    }
    window._requestHealthAccessInteractive = _requestHealthAccessInteractive;

    function _offerHealthSettingsRecovery() {
      const Health = getPlugin('HealthPlugin');
      if (!Health) return;
      const msg = isAndroid()
        ? BB.t('journal.dlg.healthRecoverAndroid')
        : BB.t('journal.dlg.healthRecoverIos');
      if (!confirm(msg)) return;
      try {
        if (isAndroid() && typeof Health.openHealthConnectSettings === 'function') {
          Health.openHealthConnectSettings();
        } else if (typeof Health.openAppleHealthSettings === 'function') {
          Health.openAppleHealthSettings();
        }
      } catch (e) { console.warn('Open health settings failed:', e); }
    }
    window._offerHealthSettingsRecovery = _offerHealthSettingsRecovery;

    function _toggleFocusedMode() {
      const chk = document.getElementById('focusModeToggle');
      _fmEnabled = chk ? chk.checked : !_fmEnabled;
      localStorage.setItem('focusedModeEnabled', _fmEnabled ? '1' : '0');
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ focusedModeEnabled: _fmEnabled }, { merge: true }).catch(() => {});
      }
      _updateFocusModeBtn();
      const _fmSub = document.getElementById('focusModeSubOptions');
      if (!_fmEnabled) {
        // Force confirm-step and elaborate responses off when focus mode is disabled
        localStorage.setItem('fmConfirmStep', 'false');
        const _aaChk = document.getElementById('fmConfirmStepToggle');
        if (_aaChk) _aaChk.checked = false;
        localStorage.setItem('elaborateResponsesEnabled', 'false');
        localStorage.setItem('intentionEnabled', 'false');
        const _erChk = document.getElementById('elaborateResponsesToggle');
        if (_erChk) _erChk.checked = false;
        // Wheel mode is a focus-mode sub-option too — it has no meaning in the
        // full form, so it goes off with the rest rather than lying dormant and
        // surprising the user the next time focus mode is switched back on.
        localStorage.setItem('wheelModeEnabled', '0');
        const _wmChk = document.getElementById('wheelModeToggle');
        if (_wmChk) _wmChk.checked = false;
        if (window.db && window.currentUser) {
          window.db.collection('userSettings').doc(window.currentUser.uid)
            .set({ wheelModeEnabled: false }, { merge: true }).catch(() => {});
        }
        if (_fmSub) _fmSub.style.display = 'none';
        _exitFocusedMode();
      } else {
        if (_fmSub) _fmSub.style.display = '';
        const fc = document.getElementById('entryFormCard');
        if (fc && fc.style.display !== 'none') _openFocusedMode();
      }
    }

    // Full-screen focused mode: keep body.bb-fm-full in sync with the card's
    // visibility so every open/close path (save, cancel, edit, switch-to-full-
    // form) restores the rest of the page without each needing its own hook.
    (function _fmFullscreenSync() {
      const card = document.getElementById('focusedModeCard');
      if (!card || typeof MutationObserver === 'undefined') return;
      const sync = () => document.body.classList.toggle('bb-fm-full', card.style.display !== 'none');
      new MutationObserver(sync).observe(card, { attributes: true, attributeFilter: ['style'] });
      sync();
    })();

    // Keyboard: ← / → cycle the spinner wheel on desktop. Scrolling the
    // adjacent pill into the centre fires the wheel's scroll pipeline, so the
    // preview, dial needle and haptic tick all follow as if swiped.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (typeof _fmActive === 'undefined' || !_fmActive) return;
      const wheel = document.getElementById('fmWheel');
      if (!wheel) return;
      const _ae = document.activeElement;
      if (_ae && ['TEXTAREA', 'INPUT', 'SELECT'].includes(_ae.tagName)) return;
      if (document.querySelector('.confirm-modal.active')) return;
      const btns = Array.prototype.slice.call(wheel.querySelectorAll('.fm-wheel-btn'));
      if (!btns.length) return;
      const cur = btns.findIndex(b => b.classList.contains('center'));
      const from = cur < 0 ? Math.floor(btns.length / 2) : cur;
      const next = Math.max(0, Math.min(btns.length - 1, from + (e.key === 'ArrowRight' ? 1 : -1)));
      if (next === from && cur >= 0) return; // already at the end stop
      const b = btns[next];
      wheel.scrollTo({ left: b.offsetLeft - (wheel.clientWidth - b.offsetWidth) / 2, behavior: 'smooth' });
      e.preventDefault();
    });

    function _openFocusedMode() {
      if (editingEntry) return;
      _fmSteps = _buildFocusedSteps();
      _fmStepIndex = 0;
      _fmActive = true;
      _fmEnergyClear = true;
      _fmSleepClear  = true;
      _fmWantsSleepQuality = false;
      _fmHighWater   = 0;
      selectedSleepQuality = null;
      _fmStepsResult       = null;
      _fmEnergySuggestion  = null;
      _fmSleepImported     = null;
      _fmSleepSuggestion   = null;
      _fmSleepError        = null;
      _fmSleepAutoSyncDone = false;
      _fmMoodSuggestion    = null;
      _fmStepsRaw          = null;
      _fmUserExited        = false;
      _fmDayFillBusy       = false;
      _fmDayFillMsg        = null;
      _fmDayFillSnapshot   = null;
      _fmClearExitedView();
      const _rsO = document.getElementById('fmResumeSection');
      if (_rsO) _rsO.style.display = 'none';
      _fmExtraSelected     = new Set();
      _fmPrevMood          = null;
      document.getElementById('entryFormCard').style.display = 'none';
      const _fflOpen = document.getElementById('fullFormExitLink');
      if (_fflOpen) _fflOpen.style.display = 'none';
      const card = document.getElementById('focusedModeCard');
      card.style.display = 'flex';
      const exitLink = document.getElementById('fmExitLink');
      if (exitLink) exitLink.style.display = '';
      _updateFocusModeBtn();
      _renderFocusedStep();
      // Kick off health imports right away (not just on the energy/sleep steps)
      // so the mood step can offer a best-guess default from steps + sleep.
      if (BB.storage.get('HealthSyncEnabled') === '1') {
        if (_fmStepsResult === null && !window._healthSyncInProgress) setTimeout(() => importStepsFromHealth(true), 0);
        if (_fmSleepImported === null && !_fmSleepAutoSyncDone && !_sleepNotYet()) setTimeout(() => importSleepFromHealth(true), 350);
      }
      setTimeout(() => {
        const _fc = document.getElementById('focusedModeCard');
        if (!_fc) return;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        const _sv = document.getElementById('scroll-view');
        if (_sv && _sv.scrollTop) _sv.scrollTo({ top: 0, behavior: 'smooth' });
      }, 80);
    }

    function _exitFocusedMode() {
      _fmEnabled = false;
      localStorage.setItem('focusedModeEnabled', '0');
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ focusedModeEnabled: false }, { merge: true }).catch(() => {});
      }
      _fmActive = false;
      document.getElementById('focusedModeCard').style.display = 'none';
      const exitLink = document.getElementById('fmExitLink');
      if (exitLink) exitLink.style.display = 'none';
      _fmSyncFormVisuals();
      // Only show the full form if the current date hasn't been logged yet
      try {
        const _cached = JSON.parse(BB.storage.get('_entryStatus') || 'null');
        if (_cached && _cached.done) {
          document.getElementById('entryFormCard').style.display = 'none';
        } else {
          document.getElementById('entryFormCard').style.display = '';
        }
      } catch(e) {
        document.getElementById('entryFormCard').style.display = '';
      }
      _updateFocusModeBtn();
    }

    /**
     * Top-left ✕ Exit — leave the focused form. Editing: same discard-confirm
     * as the old done-step ✕. New entry when the date already has a saved
     * entry: back to the overview (draft discarded, matching the old step-0
     * Close). New entry on an unlogged date: KEEP the draft and show a
     * "Continue your entry" pill instead — exit is never destructive there.
     */
    function _fmExit() {
      if (editingEntry) {
        if (!_hasEditChanges()) { cancelEdit(); return; }
        if (confirm(BB.t('journal.toast.discardChanges'))) cancelEdit();
        return;
      }
      if (_todayEntryRef) { cancelNewEntry(); return; }
      _fmUserExited = true;
      _fmActive = false;
      document.getElementById('focusedModeCard').style.display = 'none';
      const _elX = document.getElementById('fmExitLink');
      if (_elX) _elX.style.display = 'none';
      document.getElementById('entryFormCard').style.display = 'none';
      const _fflX = document.getElementById('fullFormExitLink');
      if (_fflX) _fflX.style.display = 'none';
      const _rsX = document.getElementById('fmResumeSection');
      if (_rsX) _rsX.style.display = '';
      // Minimal exited view: nav header + resume controls stay visible, the
      // rest of the landing content (streaks, open journal, …) collapses
      // behind the "Show more" toggle in the resume section.
      const _cont = document.querySelector('.container');
      if (_cont) {
        Array.prototype.forEach.call(_cont.children, (child, i) => {
          if (i === 0 || child.id === 'fmResumeSection') return; // keep the nav header row
          child.classList.add('bb-exit-hide');
        });
      }
      document.body.classList.add('bb-fm-exited');
      document.body.classList.remove('bb-fm-exited-open');
      // During the tutorial (onboarding not yet complete) the landing content is
      // still gated, so "Show more" would reveal nothing — hide the toggle until
      // the tutorial is done (step 12).
      const _exitMoreBtn = document.getElementById('fmExitMoreBtn');
      if (_exitMoreBtn) _exitMoreBtn.style.display = (_getOnboardingStep() < 12) ? 'none' : '';
      // Onboarding gating hides these at low steps, but after an exit the
      // user needs somewhere to go — force the nav targets visible.
      const _hmX = document.getElementById('homeLink');
      if (_hmX) _hmX.style.display = '';
      const _skX = document.getElementById('survivalNavBtn');
      if (_skX) _skX.style.display = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    window._fmExit = _fmExit;

    /** Undo the exited-view collapse (resume, draft delete, fresh open). */
    function _fmClearExitedView() {
      document.body.classList.remove('bb-fm-exited', 'bb-fm-exited-open');
      document.querySelectorAll('.bb-exit-hide').forEach(el => el.classList.remove('bb-exit-hide'));
      const _mb = document.getElementById('fmExitMoreBtn');
      if (_mb) _mb.textContent = BB.t('journal.fm.exitMore');
    }

    /** "Show more / Show less" on the exited view. */
    function _fmExitToggleMore(btn) {
      const open = document.body.classList.toggle('bb-fm-exited-open');
      if (btn) btn.textContent = open ? BB.t('journal.fm.exitLess') : BB.t('journal.fm.exitMore');
    }
    window._fmExitToggleMore = _fmExitToggleMore;

    /** Reopen the form exactly where the user left it (state was kept). */
    function _fmResumeEntry() {
      _fmUserExited = false;
      _fmClearExitedView();
      const _rsR = document.getElementById('fmResumeSection');
      if (_rsR) _rsR.style.display = 'none';
      if (_fmEnabled) {
        _fmActive = true;
        document.getElementById('focusedModeCard').style.display = 'flex';
        const _elR = document.getElementById('fmExitLink');
        if (_elR) _elR.style.display = '';
        _renderFocusedStep();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        document.getElementById('entryFormCard').style.display = '';
      }
    }
    window._fmResumeEntry = _fmResumeEntry;

    // Temporarily switch to full form without turning off focus mode as a setting
    function _fmSwitchToFullForm() {
      _fmActive = false;
      document.getElementById('focusedModeCard').style.display = 'none';
      const exitLink = document.getElementById('fmExitLink');
      if (exitLink) exitLink.style.display = 'none';
      _fmSyncFormVisuals();
      document.getElementById('entryFormCard').style.display = '';
      const fullFormLink = document.getElementById('fullFormExitLink');
      if (fullFormLink) fullFormLink.style.display = '';
      // _fmEnabled stays true so focus mode remains on as a setting
    }
    window._fmSwitchToFullForm = _fmSwitchToFullForm;

    function _fmSwitchToFocusedMode() {
      const fullFormLink = document.getElementById('fullFormExitLink');
      if (fullFormLink) fullFormLink.style.display = 'none';
      if (editingEntry) {
        _openEditInFocusedMode(editingEntry);
      } else {
        _openFocusedMode();
      }
    }
    window._fmSwitchToFocusedMode = _fmSwitchToFocusedMode;

    function _openEditInFocusedMode(entry) {
      editingEntry = entry;
      _captureEditState(entry);
      // Build field overrides: globally-enabled OR has data in this entry
      _editFieldOverrides = {};
      const _entryHasData = {
        trackGoals:    !!entry.goals,
        trackBudget:   !!entry.budget,
        trackExercise: !!entry.exercise,
        trackOutside:  !!entry.outside,
        trackAnxiety:  !!(entry.anxiety || entry.stress || entry.irritability),
        trackAlcohol:  !!entry.alcohol,
      };
      FIELD_PICKER_FIELDS.forEach(f => {
        const globalOn = localStorage.getItem(f.key) === 'true' ||
          (f.legacy && localStorage.getItem(f.key) === null && localStorage.getItem(f.legacy) === 'true');
        _editFieldOverrides[f.key] = globalOn || (_entryHasData[f.key] || false);
      });
      getCustomFields().forEach(f => {
        const cKey = `trackCustom_${f.id}`;
        _editFieldOverrides[cKey] = localStorage.getItem(cKey) === 'true' ||
          !!(entry.customFields && entry.customFields[f.id]);
      });
      // Populate selected* variables from entry
      selectedMood         = entry.mood;
      selectedLinkedMood   = entry.linkedMood || null;
      selectedEnergy       = entry.energy;
      selectedSleep        = entry.sleep;
      selectedMedication   = entry.medication || null;
      selectedGoals        = entry.goals === 'not-100' ? 'none' : (entry.goals || null);
      selectedAnxiety      = entry.anxiety      || null;
      selectedStress       = entry.stress       || null;
      selectedIrritability = entry.irritability || null;
      selectedExercise     = entry.exercise     || null;
      selectedOutside      = entry.outside      || null;
      selectedAlcohol      = entry.alcohol      || null;
      selectedSmoking      = entry.smoking      || null;
      selectedDrugs        = entry.drugs        || null;
      selectedCustom       = entry.customFields ? { ...entry.customFields } : {};
      selectedBudget       = entry.budget       || null;
      setPdfHide(!!entry.pdfHidden);
      selectedFavourite    = !!entry.favourite;
      _updateFavouriteBtn();
      // Populate notes textarea so the done step summary can read them
      const _fmEditNotesEl = document.getElementById('notes');
      if (_fmEditNotesEl) _fmEditNotesEl.value = entry.notes || '';
      // Parse intention and step notes (step notes are encoded in intention after ___\n separator)
      selectedStepNotes = {};
      const _fmRawInt = entry.intention || '';
      const _fmIntParts = _fmRawInt.split(/\n?_{3,}\n/);
      selectedIntention = _fmIntParts[0].trim();
      if (_fmIntParts[1] && localStorage.getItem('elaborateResponsesEnabled') === 'true') {
        // Build a label→id map that includes both static step labels AND custom field labels.
        // Custom fields add their labels to _STEP_NOTE_LABELS lazily when the more_data step
        // renders — they're not present here yet, so we build the map manually.
        const _labelToId = Object.fromEntries(Object.entries(_STEP_NOTE_LABELS).map(([k,v]) => [v, k]));
        getCustomFields().forEach(f => { _labelToId[`${f.emoji||''} ${f.label}`.trim()] = f.id; });
        _fmIntParts[1].split('\n').forEach(line => {
          const _m = line.match(/^([^:]+):\s*([\s\S]+)$/);
          if (!_m) return;
          const _id = _labelToId[_m[1].trim()];
          if (_id) selectedStepNotes[_id] = _m[2].trim();
        });
      }
      // Set date so _fmMoodTitle() shows the right date
      const _ed = new Date(entry.date);
      document.getElementById('entryDate').value =
        `${_ed.getFullYear()}-${String(_ed.getMonth()+1).padStart(2,'0')}-${String(_ed.getDate()).padStart(2,'0')}`;
      // Build steps; start at done step (overview) with all steps completed
      _fmSteps        = _buildFocusedSteps();
      _fmHighWater    = _fmSteps.length - 1;
      _fmStepIndex    = _fmSteps.length - 1;
      _fmActive        = true;
      _fmEnergyClear   = false;
      _fmSleepClear    = false;
      _fmSleepAutoSyncDone = false;
      _fmExtraSelected    = new Set();
      _fmPrevMood         = null;
      _fmReturnToDone     = false;
      _fmSuppressReopen  = true; // after saving, don't reopen for a new entry
      // Close journal, hide regular form, show focused mode card
      const _jc = document.getElementById('journalCard');
      const _jtb = document.getElementById('journalToggleBtn');
      if (_jc && _jc.style.display !== 'none') {
        _jc.style.display = 'none';
        if (_jtb) _jtb.innerHTML = BB.t('journal.btn.openJournal');
      }
      document.getElementById('entryFormCard').style.display = 'none';
      document.getElementById('todayCompleteSection').style.display = 'none';
      const _ph = document.getElementById('entryLoadingPlaceholder');
      if (_ph) _ph.style.display = 'none';
      const _fc = document.getElementById('focusedModeCard');
      _fc.style.display = 'flex';
      const _el = document.getElementById('fmExitLink');
      if (_el) _el.style.display = '';
      _updateFocusModeBtn();
      _renderFocusedStep();
      setTimeout(() => {
        const _r = _fc.getBoundingClientRect();
        window.scrollTo({ top: Math.max(0, _r.top + window.scrollY - Math.max(16, (window.innerHeight - _r.height) / 2)), behavior: 'smooth' });
      }, 80);
    }
    window._openEditInFocusedMode = _openEditInFocusedMode;

    function _maybeFocusedModeAfterFormShown() {
      // User tapped ✕ Exit on an unlogged day — don't bounce back into the
      // form on a background refresh; the "Continue your entry" pill resumes.
      if (_fmUserExited) {
        document.getElementById('entryFormCard').style.display = 'none';
        return;
      }
      if (!_fmEnabled || editingEntry) return;
      // Don't restart focus mode if it's already active — e.g. a background Firestore refresh
      // calling loadEntries() → updateDatePickerStatus() must not reset the user's current step.
      if (typeof _fmActive !== 'undefined' && _fmActive) return;
      // Always open focus mode — hide the regular form immediately to prevent any flash
      document.getElementById('entryFormCard').style.display = 'none';
      _openFocusedMode();
    }

    function _updateFocusModeBtn() {
      const chk = document.getElementById('focusModeToggle');
      if (chk) chk.checked = _fmEnabled;
    }

    function _fmSyncFormVisuals() {
      if (selectedMood != null && selectedMood !== '') {
        const _btns = document.querySelector('.mood-selector');
        const _wheel = document.getElementById('moodSpectrumControl');
        if (_isNumericMood(selectedMood)) {
          // Numeric (spectrum) mood — show the slider regardless of the current
          // toggle so an entry saved on the spectrum always displays correctly.
          if (_btns) _btns.style.display = 'none';
          if (_wheel) _wheel.style.display = '';
          _setSpectrumValue(Number(selectedMood));
        } else {
          if (_btns) _btns.style.display = '';
          if (_wheel) _wheel.style.display = 'none';
          document.querySelectorAll('.mood-btn').forEach(b => b.classList.toggle('selected', b.dataset.mood === selectedMood));
        }
        document.querySelectorAll('.hidden-until-mood').forEach(el => {
          el.classList.add('show-after-mood'); el.classList.remove('hidden-until-mood');
        });
      }
      document.querySelectorAll('.energy-btn').forEach(b => {
        const sel = parseFloat(b.dataset.energy) === selectedEnergy;
        b.classList.toggle('selected', sel);
        b.style.background = sel ? (b.dataset.color || getEnergyColor(selectedEnergy)) : '#f8f9fa';
        b.style.color = sel ? 'white' : '#495057';
      });
      document.querySelectorAll('.sleep-btn').forEach(b => {
        const sel = parseFloat(b.dataset.sleep) === selectedSleep;
        b.classList.toggle('selected', sel);
        b.style.background = sel ? (b.dataset.color || getSleepColor(selectedSleep)) : '#f8f9fa';
        b.style.color = sel ? 'white' : '#495057';
      });
      document.querySelectorAll('[data-medication]').forEach(b => b.classList.toggle('selected', b.dataset.medication === selectedMedication));
      document.querySelectorAll('[data-goals]').forEach(b => b.classList.toggle('selected', b.dataset.goals === selectedGoals));
      document.querySelectorAll('[data-anxiety]').forEach(b => b.classList.toggle('selected', b.dataset.anxiety === selectedAnxiety));
      document.querySelectorAll('[data-stress]').forEach(b => b.classList.toggle('selected', b.dataset.stress === selectedStress));
      document.querySelectorAll('[data-irritability]').forEach(b => b.classList.toggle('selected', b.dataset.irritability === selectedIrritability));
      document.querySelectorAll('[data-exercise]').forEach(b => b.classList.toggle('selected', b.dataset.exercise === selectedExercise));
      document.querySelectorAll('[data-outside]').forEach(b => b.classList.toggle('selected', b.dataset.outside === selectedOutside));
      document.querySelectorAll('[data-alcohol]').forEach(b => b.classList.toggle('selected', b.dataset.alcohol === selectedAlcohol));
      document.querySelectorAll('[data-budget]').forEach(b => b.classList.toggle('selected', b.dataset.budget === selectedBudget));
      _updateEnergyHero();
      _updateSleepHero();
    }

    const _FM_MOOD_BG     = { manic:'#fff0f0', elevated:'var(--brand-secondary-tint)', stable:'#f0fff4', good:'#f0fff4', low:'#f5f0ff', depressed:'#f0f4ff' };
    function _fmApplyMoodTheme(mood) {
      // Accept a legacy category string OR a spectrum number — normalise to a category.
      const cat    = (mood != null && mood !== '') ? _moodCat(mood) : null;
      const accent = (cat && _FM_MOOD_COLORS[cat]) || 'var(--brand-primary)';
      // Dark mode: the pale washes would put cream text on near-white, so mix
      // the mood colour faintly into the dark card surface instead.
      const bg     = _fmIsDark()
        ? ((cat && _fmPaleTint(_FM_MOOD_COLORS[cat])) || 'var(--brand-tint)')
        : ((cat && _FM_MOOD_BG[cat]) || 'var(--brand-tint)');
      const card   = document.getElementById('focusedModeCard');
      const sticky = document.getElementById('fmNextRow');
      if (card)   {
        card.style.background = bg;
        card.style.setProperty('--fm-accent', accent);
        // Filled buttons (Next on notes, Save): the brand accent uses the
        // page's --brand-btn (cream, dark label — css/journal.css); a mood
        // accent keeps its colour with a white label.
        const _brandAccent = accent === 'var(--brand-primary)';
        card.style.setProperty('--fm-accent-btn', _brandAccent ? 'var(--brand-btn)' : accent);
        card.style.setProperty('--fm-accent-btn-text', _brandAccent ? 'var(--brand-btn-text)' : '#fff');
        card.style.setProperty('--fm-accent-btn-ring', _brandAccent ? 'var(--brand-btn-ring)' : 'none');
      }
      if (sticky) { sticky.style.background = bg; }
      const fullCard = document.getElementById('entryFormCard');
      if (fullCard) fullCard.style.background = bg;
      _fmSetPageTint(cat ? _FM_MOOD_COLORS[cat] : null);
    }

    /**
     * Mood tint for the page behind the check-in card: a soft wash of the
     * chosen mood's colour over the orange background (see body::before in
     * css/journal.css). Only visible while body.bb-fm-full is on, so it
     * vanishes with the check-in; passing null clears it for a fresh one.
     */
    function _fmSetPageTint(color) {
      const b = document.body;
      if (!b) return;
      if (color) b.style.setProperty('--fm-page-tint', color);
      b.classList.toggle('bb-fm-tinted', !!color);
    }

    /** True when the OS asks for reduced motion. */
    function _fmReducedMotion() {
      try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
    }

    /**
     * Selection feedback for a step-1 mood: a light haptic tick plus a short
     * pop on the chosen bear (plain mode's .mood-btn; skipped under reduced
     * motion). Returns true when a pop is playing, so the caller can hold the
     * step change back until it has finished.
     */
    function _fmMoodPop(mood) {
      try { nativeHaptic('light'); } catch (_) {}
      const btn = document.querySelector(`#fmContent .mood-btn.mood-${mood}`);
      if (!btn) return false;
      btn.parentElement.querySelectorAll('.mood-btn').forEach(b => b.classList.toggle('selected', b === btn));
      if (_fmReducedMotion()) return false;
      btn.classList.remove('fm-mood-pop');
      void btn.offsetWidth; // restart the animation on a repeat tap
      btn.classList.add('fm-mood-pop');
      return true;
    }

    /**
     * Pale wash of a wheel option's colour. `color` may be a hex value
     * (energy/sleep/mood pills) or a CSS custom-property reference like
     * var(--brand-primary) (the elevated mood). We resolve it to concrete RGB
     * through the DOM and mix 14% colour over white in JS, returning a plain
     * rgb() string. (color-mix() would be cleaner but is silently dropped on
     * iOS Safari < 16.2 — an unsupported background value leaves the card stuck
     * on the mood default.) e.g. #ff922b (6-7h sleep) → pale orange.
     */
    let _fmTintProbe = null;
    function _fmPaleTint(color) {
      if (!color) return null;
      // Resolve hex / var()/ named colours to "rgb(r, g, b)" via computed style.
      if (!_fmTintProbe) {
        _fmTintProbe = document.createElement('span');
        _fmTintProbe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;';
        document.body.appendChild(_fmTintProbe);
      }
      _fmTintProbe.style.color = '';
      _fmTintProbe.style.color = color;
      const resolved = getComputedStyle(_fmTintProbe).color;
      const m = resolved.match(/(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/);
      if (!m) return null;
      // Light: 14% colour over white. Dark: 14% over the dark card surface
      // (#262019 in css/dark.css), so the tint stays a quiet hint of colour.
      const base = _fmIsDark() ? [38, 32, 25] : [255, 255, 255];
      const mix = (c, i) => Math.round(0.14 * parseFloat(c) + 0.86 * base[i]);
      return `rgb(${mix(m[1], 0)}, ${mix(m[2], 1)}, ${mix(m[3], 2)})`;
    }

    /** True while the dark theme is on (html.theme-dark, see css/dark.css). */
    function _fmIsDark() {
      return document.documentElement.classList.contains('theme-dark');
    }
    // Appearance switched (Settings → Appearance, or the phone at sunset):
    // repaint the check-in card's mood wash for the new theme.
    document.addEventListener('bb:themechange', () => {
      try { _fmApplyMoodTheme(selectedMood); } catch (_) {}
    });

    /**
     * Live background wash driven by the wheel: while the user spins to a slot,
     * tint the form to a pale version of that slot's colour. Falls back to the
     * mood-based default (_fmApplyMoodTheme) when the slot has no colour.
     */
    function _fmApplyWheelBg(color) {
      const bg = _fmPaleTint(color);
      if (!bg) return;
      const card   = document.getElementById('focusedModeCard');
      const sticky = document.getElementById('fmNextRow');
      if (card)   card.style.background = bg;
      if (sticky) sticky.style.background = bg;
      const fullCard = document.getElementById('entryFormCard');
      if (fullCard) fullCard.style.background = bg;
    }

    function _renderFocusedStep() {
      const step = _fmSteps[_fmStepIndex];
      if (!step) return;
      _fmApplyMoodTheme(selectedMood);
      // Progress dots + top bar — hidden on mood step (step 0) to keep it clean
      const _dotsEl = document.getElementById('fmProgressDots');
      const _topBar = document.getElementById('fmTopBar');
      const _stepCounter = document.getElementById('fmStepCounter');
      // Top bar is uniform across every step, including mood (step 0)
      _dotsEl.style.display = 'flex';
      _dotsEl.innerHTML = _fmSteps.map((_,i) => `<div class="fm-dot ${i<_fmStepIndex?'done':i===_fmStepIndex?'cur':''}"></div>`).join('');
      if (_topBar) _topBar.style.display = 'flex';
      if (_stepCounter) _stepCounter.style.display = '';
      document.getElementById('fmStepCounter').textContent = BB.t('journal.fm.stepCounter', { n: _fmStepIndex+1, total: _fmSteps.length });
      // Summary bar: every step's chip, on every page including the first
      // (30 Sep 2026 — it used to be hidden until a step was answered).
      _fmChipPreview = null;
      _fmBuildSummaryBar();
      // Fresh first step: no summary chips to fill the band under the top nav, so
      // the flexible header spacer would otherwise leave a large dead gap between
      // the step counter and the question. Collapse it (see .fm-fresh-first CSS)
      // so the header rides up under the counter instead of floating over a void.
      const _freshFirstStep = _fmStepIndex === 0 && _fmHighWater === 0;
      document.getElementById('focusedModeCard').classList.toggle('fm-fresh-first', _freshFirstStep);
      // Title / subtitle / eyebrow
      document.getElementById('fmTitle').textContent    = step.title;
      document.getElementById('fmSubtitle').textContent = step.subtitle || '';
      const _eyebrowEl = document.getElementById('fmEyebrow');
      if (_eyebrowEl) {
        const _eb = _FM_EYEBROWS[step.id] && !(step.id === 'sleep' && _sleepNotYet()) ? _FM_EYEBROWS[step.id]() : '';
        _eyebrowEl.textContent = _eb;
        _eyebrowEl.style.display = _eb ? '' : 'none';
      }
      // Top-left: ✕ Exit on every step — step navigation lives in the dots
      // and the tappable summary chips, so a Back button is redundant.
      const _backBtn = document.getElementById('fmBackBtn');
      _backBtn.textContent = '✕ ' + ((window.BB && BB.t) ? BB.t('journal.fm.exit') : 'Exit');
      _backBtn.onclick = _fmExit;
      _backBtn.style.visibility = 'visible';
      // Skip button + save shortcut (mood is the one required field — no skip)
      const skipBtn = document.getElementById('fmSkipBtn');
      skipBtn.textContent = BB.t('journal.mods.fmSkip');
      skipBtn.title = '';
      skipBtn.onclick = _fmSkip;
      skipBtn.style.visibility = (step.id === 'done' || step.id === 'mood') ? 'hidden' : 'visible';
      skipBtn.style.color = '#adb5bd';
      const saveShortcutBtn = document.getElementById('fmSaveShortcutBtn');
      if (saveShortcutBtn) saveShortcutBtn.style.display = (step.id === 'done' || (_fmStepIndex === 0 && _fmHighWater === 0)) ? 'none' : 'inline-block';
      // Next/save button row
      const nextRow = document.getElementById('fmNextRow');
      const nextBtn = document.getElementById('fmNextBtn');
      const delBtn  = document.getElementById('fmDeleteBtn');
      const _confirmStep = localStorage.getItem('fmConfirmStep') === 'true';
      // Auto steps always auto-advance (no Next button needed, even in confirm-step mode).
      // Non-auto steps show Next always; confirm-step mode is handled in _fmAdvance().
      // Notes + done render their own in-content actions (positioned in the wheel slot).
      if (step.auto || step.id === 'notes' || step.id === 'done') {
        nextRow.style.display = 'none';
      } else {
        nextRow.style.display = 'flex';
      }
      let _accent = ((selectedMood != null && selectedMood !== '') && _FM_MOOD_COLORS[_moodCat(selectedMood)]) || 'var(--brand-primary)';
      // White label on the fill: the brand orange is too light (~2.2:1).
      if (_accent === 'var(--brand-primary)') _accent = 'var(--brand-btn)';
      // Same for the lighter mood fills: use a darker shade of each (all ≥5:1).
      _accent = _FM_BTN_FILLS[_accent] || _accent;
      const _t = (k) => (window.BB && BB.t) ? BB.t(k) : k;
      if (step.id === 'done') {
        const _noChanges = editingEntry && !_hasEditChanges();
        nextBtn.textContent = !_hasMood() ? _t('journal.save.fmSelectMood') : (_noChanges ? _t('journal.save.fmClose') : (editingEntry ? _t('journal.save.fmEdit') : _t('journal.save.fmSave')));
        nextBtn.style.background = (_noChanges || !_hasMood()) ? '#adb5bd' : _accent;
      } else {
        nextBtn.textContent = _t('common.next') + ' →';
        nextBtn.style.background = _accent;
      }
      if (delBtn) delBtn.style.display = step.id === 'done' ? '' : 'none';
      // Persist fmNotesInput value to #notes before replacing content so navigating
      // back to the notes step always restores what the user typed.
      const _prevFmNotes = document.getElementById('fmNotesInput');
      if (_prevFmNotes) { const _notesEl = document.getElementById('notes'); if (_notesEl) _notesEl.value = _prevFmNotes.value; }
      // Content
      const _fmContentEl = document.getElementById('fmContent');
      _fmContentEl.innerHTML = _fmRenderContent(step);
      // Hero steps: flex column so the hero centres and the wheel/input sits
      // low; wire up the slider-wheel after layout. Notes has no wheel but
      // shares the hero layout (its own class opts out of the bottom raise —
      // the Next row sits under it and would leave a gap).
      const _hasWheel = !!document.getElementById('fmWheel');
      const _isHeroStep = _hasWheel || step.id === 'notes' || step.id === 'done';
      _fmContentEl.classList.toggle('fm-content-hero', _isHeroStep);
      _fmContentEl.classList.toggle('fm-notes', step.id === 'notes');
      _fmContentEl.classList.toggle('fm-done', step.id === 'done');
      _fmContentEl.classList.toggle('fm-meds', step.id === 'medication');
      // Additional-tracking (more_data) is a dense answer list with no big hero
      // below to balance the floating header — so the flexible header spacer just
      // leaves a dead gap above the question. Collapse it (see .fm-flat-top CSS)
      // so the heading rides up under the summary chips, like the fresh-first step.
      document.getElementById('focusedModeCard').classList.toggle('fm-flat-top', step.id === 'more_data');
      // Plain (non-wheel) steps have no big hero to fill the content box, so
      // let the card hug its own content instead of stretching to the full
      // viewport and leaving a large dead band below the answer cards.
      document.getElementById('focusedModeCard').classList.toggle('fm-plain-fit', !_isHeroStep);
      // Mood step: lets the CSS give the first card a bit more height/presence.
      document.getElementById('focusedModeCard').classList.toggle('fm-step-mood', step.id === 'mood');
      // setTimeout(0), not rAF: rAF can starve in a backgrounded/hidden WebView
      // and the wheel would never get its initial centring + hero paint.
      if (_hasWheel) setTimeout(_fmInitWheel, 0);
      if (step.id === 'notes') setTimeout(() => { const ta = document.getElementById('fmNotesInput'); if (ta) ta.focus(); }, 120);
      // Auto-sync health data if setting is ON
      if (BB.storage.get('HealthSyncEnabled') === '1') {
        if (step.id === 'energy' && _fmStepsResult === null && !window._healthSyncInProgress) {
          setTimeout(() => importStepsFromHealth(true), 0);
        } else if (step.id === 'sleep' && _fmSleepImported === null && !window._healthSyncInProgress && !_fmSleepAutoSyncDone && !_sleepNotYet()) {
          setTimeout(() => importSleepFromHealth(true), 0);
        }
      }
      // Elaborate Responses — per-step notes
      _fmAppendStepNotes(step);
      // Re-evaluate overlay state (handles med hint and settings hint)
      _applyJournalOnboardingGating();
      // Mood step blocking hints: show overlay + elevate card
      // During blocking onboarding steps the overlay (z-index:500) covers the page.
      // Keep the focused-mode card above it (z-index:501) on every step so the user
      // can still interact with focused mode while the tutorial hint is visible.
      const _fmCardEl = document.getElementById('focusedModeCard');
      const _obStep = _getOnboardingStep();
      const _fmNeedsElevation = (typeof _fmActive !== 'undefined' && _fmActive) && [1,2,3,8].includes(_obStep);
      if (step.id === 'mood') {
        const _chooseDone = BB.storage.get('_fmChooseMoodHintDone') === '1';
        const _tapDone = BB.storage.get('_fmMoodTipShown') === '1';
        const _moodHintActive = (!_chooseDone && !editingEntry) || (!_tapDone && _chooseDone && BB.storage.get('_fmTapHoldHintReady') === '1');
        const _overlay = document.getElementById('bbHintOverlay');
        if (_moodHintActive) {
          if (_overlay) _overlay.style.display = '';
          if (_fmCardEl) { _fmCardEl.style.position = 'relative'; _fmCardEl.style.zIndex = '501'; }
        } else {
          if (_fmCardEl) { _fmCardEl.style.position = ''; _fmCardEl.style.zIndex = _fmNeedsElevation ? '501' : ''; }
        }
      } else {
        if (_fmCardEl) _fmCardEl.style.zIndex = _fmNeedsElevation ? '501' : '';
      }
    }

    function _fmAppendStepNotes(step) {
      if (localStorage.getItem('elaborateResponsesEnabled') !== 'true') return;
      if (['mood','done','notes','more_data'].includes(step.id)) return;
      const _noteVal = selectedStepNotes[step.id] || '';
      const _noteOpen = editingEntry && _noteVal.trim().length > 0;
      const _notesEl = document.createElement('details');
      _notesEl.id = 'fmStepNotesEl';
      if (_noteOpen) _notesEl.open = true;
      _notesEl.style.cssText = 'margin-top:14px;';
      _notesEl.innerHTML = `<summary style="font-size:0.85em;font-weight:600;color:#6c757d;cursor:pointer;list-style:none;display:flex;align-items:center;gap:5px;-webkit-tap-highlight-color:transparent;padding:4px 0;" onclick="this.querySelector('.bb-stpchev').style.transform=this.parentElement.open?'rotate(0deg)':'rotate(90deg)'"><span class="bb-stpchev" style="font-size:0.75em;color:#6c757d;transition:transform 0.2s;">${_noteOpen ? '▼' : '▶'}</span>${BB.t('journal.addNote')}</summary><textarea id="fmStepNoteInput" placeholder="${BB.t('journal.placeholder.stepNote')}" style="width:100%;height:60px;border:1.5px solid #e9ecef;border-radius:10px;padding:10px;margin-top:6px;font-size:0.88em;font-family:inherit;resize:none;box-sizing:border-box;outline:none;transition:border-color 0.15s;" oninput="selectedStepNotes['${step.id}']=this.value;saveDraft();" onfocus="this.style.borderColor='var(--brand-primary)'" onblur="this.style.borderColor='#e9ecef'">${_noteVal.replace(/</g,'&lt;')}</textarea>`;
      const _container = document.getElementById('fmContent');
      if (_container) _container.appendChild(_notesEl);
    }

    function _fmOpt(value, label, color, selVal, setter, marginTop) {
      const sel = selVal === value;
      return `<button class="fm-opt ${sel?'sel':''}" onclick="${setter}='${value}'; _fmAdvance();"
        style="border-left:4px solid ${color};${marginTop?'margin-top:8px;':''}">${label}</button>`;
    }

    // ── Hero + slider-wheel step layout (mood / energy / sleep) ──
    // The hero (big emoji, value readout, synced badge) fills the middle of the
    // full-screen card; the wheel is a scroll-snap row of option pills near the
    // bottom. Sliding the wheel previews the centred option in the hero
    // (ghosted, dashed outline until committed); tapping commits + advances.

    /** Spark particles that fly off the hero emoji (the active centre item). */
    function _fmSparksHtml() {
      return `<span class="fm-spark s1">✦</span><span class="fm-spark s2">✦</span><span class="fm-spark s3">✧</span><span class="fm-spark s4">✦</span><span class="fm-spark s5">✧</span>`;
    }

    /**
     * Icon-specific looping effects layered over the hero: zzz drifting off
     * the sleeping emoji, exhaust flames under the rocket, rain under the
     * depressed bear's cloud, and so on. Keyed by emoji glyph or (for the
     * mood PNGs) by mood value.
     */
    // Every mood and every energy / sleep / sleep-quality emoji gets its own
    // effect when it's the centred (active) choice. Moods are keyed by value
    // (the pill is a PNG); the rest by emoji glyph (variation selectors are
    // stripped before lookup — see _fmApplyAura).
    const _FM_AURAS = {
      // Moods
      manic: 'money', elevated: 'rise', stable: 'halo', good: 'halo', low: 'tear', depressed: 'rain',
      // Energy — 💀 not enough, 🪫 less, ⚡ normal, 🔋 more, 🚀 too much
      '💀': 'ghost', '🪫': 'drain', '⚡': 'zap', '🔋': 'charge', '🚀': 'flame',
      // Sleep — 😫 ≤5h, 😕 6–7h, 😊 7–9h, 😴 9–10h, 💤 10+h
      '😫': 'sweat', '😕': 'sigh', '😊': 'bliss', '😴': 'zzz', '💤': 'zzz',
      // Sleep quality — 😐 unsure (😴 bad → zzz, 😊 good → bliss share the above)
      '😐': 'meh',
    };
    const _AURA_HTML = {
      zzz:    '<span class="a1">z</span><span class="a2">z</span><span class="a3">z</span>',
      flame:  '<span class="a1">🔥</span><span class="a2">🔥</span><span class="a3">🔥</span>',
      rain:   '<span class="a1">💧</span><span class="a2">💧</span><span class="a3">💧</span><span class="a4">💧</span>',
      money:  '<span class="a1">💵</span><span class="a2">💵</span><span class="a3">💵</span>',
      tear:   '<span class="a1">💧</span>',
      halo:   '<span class="a1"></span>',
      rise:   '<span class="a1">▴</span><span class="a2">▴</span><span class="a3">▴</span>',
      ghost:  '<span class="a1">👻</span>',
      drain:  '<span class="a1"></span>',
      zap:    '<span class="a1">⚡</span><span class="a2">⚡</span>',
      charge: '<span class="a1">⚡</span><span class="a2">⚡</span>',
      sweat:  '<span class="a1">💦</span>',
      sigh:   '<span class="a1">💨</span>',
      bliss:  '<span class="a1">✨</span><span class="a2">✨</span><span class="a3">✨</span>',
      meh:    '<span class="a1">·</span><span class="a2">·</span><span class="a3">·</span>',
    };
    function _fmAuraHtml(type) {
      return `<div class="fm-aura" id="fmHeroAura" data-type="${type || ''}">${_AURA_HTML[type] || ''}</div>`;
    }
    /** Swap the hero's aura to match the previewed item. */
    function _fmApplyAura(auraKey) {
      const el = document.getElementById('fmHeroAura');
      if (!el) return;
      // Strip emoji variation selectors (e.g. ⚡️ → ⚡) so glyph keys match.
      const type = _FM_AURAS[(auraKey || '').replace(/\uFE0F/g, '')] || '';
      if (el.dataset.type === type) return;
      el.dataset.type = type;
      el.innerHTML = _AURA_HTML[type] || '';
    }

    function _fmHeroHtml() {
      return `<div class="fm-hero">
        <div class="fm-hero-emoji-wrap">${_fmSparksHtml()}${_fmAuraHtml('')}
          <div class="fm-hero-emoji" id="fmHeroEmoji"></div>
        </div>
        <div class="fm-hero-value" id="fmHeroValue"></div>
        <div class="fm-hero-badge" id="fmHeroBadge" style="visibility:hidden;">&nbsp;</div>
      </div>`;
    }

    function _fmWheelHtml(items, extraHintHtml) {
      return `<div class="fm-wheel-block"><div class="fm-dial-arrow" aria-hidden="true"></div><div class="fm-wheel" id="fmWheel">${items.map(it => `<button type="button"
          class="fm-wheel-btn${(it.cls && !it.spacer) ? ' ' + it.cls : ''}${it.init ? ' init' : ''}${it.spacer ? ' fm-wheel-runway' : ''}"
          data-val="${it.val}" data-label="${it.label}" data-color="${it.color}"
          ${it.emoji ? `data-emoji="${it.emoji}"` : ''} ${it.img ? `data-img="${it.img}"` : ''}
          style="--wb-color:${it.color};"
          onclick="${it.onclick}" ${it.extra || ''}>
          ${it.img ? `<img src="${it.img}" alt="">` : ''}
          <span class="fm-wheel-label">${it.label}</span>
          ${it.sub ? `<span class="fm-wheel-sub">${it.sub}</span>` : ''}
        </button>`).join('')}</div>
        <p class="fm-wheel-hint">${BB.t('journal.fm.wheelHint')}</p>${extraHintHtml || ''}</div>`;
    }

    /** The wheel value the user has actually committed on this step (null = none). */
    function _fmWheelCommittedVal(stepId) {
      if (stepId === 'energy')     return _fmEnergyClear ? null : String(selectedEnergy);
      // Full spectrum stops are exact hours, so they must compare against the raw
      // value — bucketing 7h to 8 would light up the wrong pill.
      if (stepId === 'sleep')      return (_fmSleepClear || selectedSleep == null) ? null
        : String(_spectrumEnabled() ? _fmClampSleep(selectedSleep) : _fmSleepBucketOf(selectedSleep));
      if (stepId === 'mood')         return (selectedMood != null && selectedMood !== '') ? String(selectedMood) : null;
      if (stepId === 'medication')   return selectedMedication || null;
      if (stepId === 'sleepQuality') return selectedSleepQuality || null;
      return null;
    }

    /** Paint the hero from the wheel button currently in the centre. */
    function _fmHeroPreview(btn) {
      const step    = _fmSteps[_fmStepIndex];
      const emojiEl = document.getElementById('fmHeroEmoji');
      const valEl   = document.getElementById('fmHeroValue');
      const badgeEl = document.getElementById('fmHeroBadge');
      if (!step || !btn || !emojiEl || !valEl || !badgeEl) return;
      const val = btn.dataset.val;
      const committed = _fmWheelCommittedVal(step.id);
      const isCommitted = committed !== null && String(committed) === val;
      let valueHtml = btn.dataset.label;
      // Spectrum mood: append the 0–10 number so the hero distinguishes stops
      // that share a name (e.g. 7 vs 8 both "Hypomanic").
      if (step.id === 'mood' && _spectrumEnabled() && _isNumericMood(btn.dataset.val)) {
        valueHtml = `${btn.dataset.label} <span style="opacity:0.6;font-weight:700;">(${btn.dataset.val})</span>`;
      }
      let badge = null;
      // Steps for the entry being edited / the current form date — never the
      // stale count from a previous focused-mode session on another date.
      let _heroSteps = null;
      if (step.id === 'energy') {
        if (editingEntry && editingEntry.steps != null) _heroSteps = editingEntry.steps;
        else {
          const _dv = document.getElementById('entryDate')?.value;
          if (_dv && window._healthStepsByDate && window._healthStepsByDate[_dv] != null) _heroSteps = window._healthStepsByDate[_dv];
        }
      }
      if (step.id === 'energy' && isCommitted && _heroSteps != null) {
        valueHtml = BB.t('journal.sync.steps', { n: Number(_heroSteps).toLocaleString() });
        badge = { cls: '', text: '✓ ' + _syncSourceLabel() };
      } else if (step.id === 'sleep' && isCommitted && _sleepHealthSynced) {
        valueHtml = _fmFmtSleepHM(selectedSleep);
        badge = { cls: '', text: '✓ ' + _syncSourceLabel() };
      } else if (step.id === 'mood' && (selectedMood == null || selectedMood === '') && _fmMoodSuggestion && val === _fmMoodSuggestion) {
        badge = { cls: 'guess', text: '✨ ' + BB.t('journal.sync.bestGuess') };
      }
      emojiEl.innerHTML = btn.dataset.img ? `<img src="${btn.dataset.img}" alt="">` : (btn.dataset.emoji || '');
      emojiEl.classList.toggle('ghost', !isCommitted);
      // Icon-specific effect: mood items key by value (PNG), others by glyph.
      _fmApplyAura(btn.dataset.img ? val : (btn.dataset.emoji || ''));
      valEl.innerHTML = valueHtml;
      valEl.classList.toggle('ghost', !isCommitted);
      if (badge) {
        badgeEl.className = 'fm-hero-badge' + (badge.cls ? ' ' + badge.cls : '');
        badgeEl.textContent = badge.text;
        badgeEl.style.visibility = '';
      } else {
        badgeEl.style.visibility = 'hidden';
        badgeEl.innerHTML = '&nbsp;';
      }
    }

    let _fmWheelRAF = null;
    function _fmInitWheel() {
      const wheel = document.getElementById('fmWheel');
      if (!wheel) return;
      const btns = Array.prototype.slice.call(wheel.querySelectorAll('.fm-wheel-btn'));
      if (!btns.length) return;
      // Every wheel — long (mood/energy: 5 pills) or short (medication: 2,
      // sleep-quality: 3) — now runs the SAME path: native horizontal scroll +
      // CSS scroll-snap, the browser doing all the work. That path has always
      // worked on real iPhones for the long wheels; the short ones only ever
      // misbehaved because earlier code special-cased them (suppressing native
      // scroll for a JS touch/rAF stepper, or swapping CSS snap for a JS settle)
      // — paths WebKit handles differently than Chromium's touch emulation,
      // which is exactly why every "verified in a browser" fix still failed
      // on-device. No special-casing now: identical to the working steps.
      //
      // Pad the edges so the first/last pill can sit dead-centre under the dial.
      // Short wheels also get a big runway on each side: a 2–3 pill row is too
      // narrow for iOS to treat as a real scroll surface (a flick just snaps
      // straight back and feels frozen), whereas the long wheels get that
      // scrollable width for free from all their pills. The runway is empty
      // scroll space — with mandatory snap you can never rest on it, it always
      // pulls to the nearest pill — so it behaves exactly like adding blank
      // cards to swipe from that are blocked at the two ends.
      const _centrePad = (b) => Math.max(0, (wheel.clientWidth - b.offsetWidth) / 2);
      const _runway = btns.length <= 3 ? Math.round(wheel.clientWidth * 0.55) : 0;
      wheel.style.paddingLeft  = (_centrePad(btns[0]) + _runway) + 'px';
      wheel.style.paddingRight = (_centrePad(btns[btns.length - 1]) + _runway) + 'px';
      let _settled = false; // suppress the haptic tick on the initial centring
      const update = () => {
        // A scroll rAF can fire after the step re-rendered and replaced this
        // wheel — painting the new step's hero with stale buttons. Bail out.
        if (!wheel.isConnected) return;
        const wr = wheel.getBoundingClientRect();
        const wc = wr.left + wr.width / 2;
        const half = Math.max(1, wr.width / 2);
        let best = null, bd = Infinity;
        btns.forEach(b => {
          const r = b.getBoundingClientRect();
          const d = (r.left + r.width / 2 - wc) / half; // signed −1…1 across the wheel
          const ad = Math.abs(d);
          if (ad < bd) { bd = ad; best = b; }
          // Slight arc, as if the pills sit on the rim of a big wheel: dip and
          // tilt grow with distance from the centre (apex).
          const dc = Math.max(-1, Math.min(1, d));
          b.style.setProperty('--arc-y', (Math.min(1, ad * ad) * 26).toFixed(1) + 'px');
          b.style.setProperty('--arc-rot', (dc * 9).toFixed(2) + 'deg');
        });
        if (best && !best.classList.contains('center')) {
          btns.forEach(b => b.classList.toggle('center', b === best));
          _fmHeroPreview(best);
          _fmSetChipPreview(best.dataset.val);
          // Dial needle takes the colour of the slot it points at.
          const _arrow = wheel.parentElement && wheel.parentElement.querySelector('.fm-dial-arrow');
          if (_arrow) _arrow.style.borderTopColor = best.dataset.color || '';
          // Wash the form background with a pale tint of the centred slot's
          // colour, so spinning the wheel previews the mood/energy/sleep hue.
          _fmApplyWheelBg(best.dataset.color);
          // Dial tick as the spinner clicks onto a new slot (not on the
          // programmatic initial centring).
          if (_settled) nativeHaptic('light');
        }
        _settled = true;
      };
      wheel.addEventListener('scroll', () => {
        if (_fmWheelRAF) return;
        _fmWheelRAF = requestAnimationFrame(() => { _fmWheelRAF = null; update(); });
      }, { passive: true });
      // Centre the committed value, else the suggestion/middle option (.init).
      // iOS Safari can leave a snap container "stuck" after a programmatic
      // scrollLeft write — disable snapping for the write, restore it just after
      // so native mandatory snap takes over for finger scrolling (all wheels).
      const init = wheel.querySelector('.fm-wheel-btn.sel') || wheel.querySelector('.fm-wheel-btn.init') || btns[Math.floor(btns.length / 2)];
      wheel.style.scrollSnapType = 'none';
      wheel.scrollLeft = init.offsetLeft - (wheel.clientWidth - init.offsetWidth) / 2;
      setTimeout(() => { wheel.style.scrollSnapType = ''; }, 50);
      update();
    }

    /**
     * Best-guess default mood from synced health data. Very few steps + lots
     * of sleep → low; lots of steps + little sleep → elevated; middling both
     * → stable. Preview only — it becomes the mood wheel's initial centre with
     * a "best guess" badge; the user still taps to commit.
     *
     * Sleep in the healthy 7–9h band short-circuits to stable on its own.
     * Sleep is the strongest single indicator of a bipolar episode, so when
     * Health reports a normal night it outranks the step count: a quiet 3k-step
     * day on top of 7.7h sleep is a rest day, not a low mood, and defaulting it
     * to "low" put the wrong answer in front of the user before they'd chosen.
     */
    function _suggestMoodFromHealth(steps, sleepH) {
      if (steps == null && sleepH == null) return null;
      if (sleepH != null && sleepH >= 7 && sleepH <= 9) return 'stable';
      let score = 0; // negative → low, positive → elevated
      if (steps != null)  { if (steps < 3000)  score--; else if (steps > 15000) score++; }
      if (sleepH != null) { if (sleepH >= 9.5) score--; else if (sleepH <= 5.5) score++; }
      return score < 0 ? 'low' : score > 0 ? 'elevated' : 'stable';
    }

    /** Steps → an energy value on the form's 0–10 scale. */
    function _energyFromSteps(s) {
      return s < 1000 ? 0 : s < 3000 ? 3 : s < 10000 ? 5 : s < 20000 ? 7 : 10;
    }

    function _fmMaybeSuggestMood() {
      if (selectedMood || editingEntry) return;
      const suggestion = _suggestMoodFromHealth(_fmStepsRaw, _fmSleepImported);
      if (suggestion) _fmMoodSuggestion = suggestion;
    }

    // ── One-tap auto-fill for yesterday (focused mode, first step) ──────────
    /*
     * The missing-days auto-complete fills gaps in bulk from the missing-entries
     * modal. This is the same idea for the one day the journal is actually
     * pointed at: a button on the mood step that reads yesterday's sleep and
     * steps from the phone's health app, derives mood and energy from them with
     * the same rules (_suggestMoodFromHealth / _energyFromSteps), and drops the
     * user on the summary step to review and save.
     *
     * Offered only where there is health data to fill from — native build,
     * health sync switched on — and only for yesterday. Today is deliberately
     * excluded: the night hasn't happened (see _sleepNotYet) and the step count
     * is still mid-day, so there is nothing honest to estimate from. Older days
     * are the bulk auto-complete's job.
     *
     * Nothing is written without a save, but what the user reviews is still a
     * guess, so the saved entry carries autoFilled — unless they changed one of
     * the three values on the way through (see _fmDayFillIntact in saveEntry).
     */
    function _fmCanAutoFillDay() {
      if (!_fmActive || editingEntry) return false;
      if (!isNative() || BB.storage.get('HealthSyncEnabled') !== '1') return false;
      const val = document.getElementById('entryDate')?.value;
      if (!val) return false;
      const y = new Date(); y.setHours(0, 0, 0, 0); y.setDate(y.getDate() - 1);
      return val === `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    }

    /** True while the three values the auto-fill wrote are still untouched. */
    function _fmDayFillIntact() {
      const s = _fmDayFillSnapshot;
      if (!s) return false;
      return s.mood === selectedMood && s.energy === selectedEnergy && s.sleep === selectedSleep;
    }

    function _fmDayFillBtnHtml() {
      if (!_fmCanAutoFillDay()) return '';
      const label = _fmDayFillBusy ? BB.t('journal.autofill.dayBusy')
        : _fmDayFillMsg === 'nodata' ? BB.t('journal.autofill.dayNoData')
        : BB.t('journal.autofill.dayBtn');
      return `<button type="button" onclick="_fmAutoFillDay()" ${_fmDayFillBusy ? 'disabled' : ''}
        style="width:100%;padding:11px 16px;margin-bottom:14px;background:rgba(255,149,0,0.08);border:2px solid rgba(255,149,0,0.35);border-radius:12px;color:var(--brand-primary);font-weight:600;font-size:0.88em;cursor:pointer;-webkit-tap-highlight-color:transparent;${_fmDayFillBusy ? 'opacity:0.6;' : ''}">${label}</button>`;
    }

    async function _fmAutoFillDay() {
      if (_fmDayFillBusy || !_fmCanAutoFillDay()) return;
      _fmDayFillBusy = true;
      _fmDayFillMsg  = null;
      _renderFocusedStep();

      try {
        // Tapping the button is a deliberate action, so raising the OS
        // permission sheet here is fair game — unlike the silent syncs on
        // focused-mode open, which only ever check. Asking for both scopes in
        // one go keeps it to a single sheet; the imports then run in auto mode
        // (isAuto=true) so neither asks again.
        window._healthSyncInProgress = true;
        const Health = getPlugin('HealthPlugin');
        if (Health) {
          try {
            const ck = await Health.checkHealthPermissions({ permissions: ['READ_STEPS', 'READ_SLEEP'] });
            if (!ck?.permissions?.READ_STEPS || !ck?.permissions?.READ_SLEEP) {
              skipNextResume = true;
              await Health.requestHealthPermissions({ permissions: ['READ_STEPS', 'READ_SLEEP'] });
              skipNextResume = false;
            }
          } catch (e) { skipNextResume = false; }
        }
        if (_fmSleepImported === null) await importSleepFromHealth(true);
        if (_fmStepsRaw === null)      await importStepsFromHealth(true);
      } catch (e) {
        BB.log('day auto-fill: health read failed', e);
      } finally {
        setTimeout(() => { window._healthSyncInProgress = false; }, 800);
        _fmDayFillBusy = false;
      }

      const steps  = _fmStepsRaw;
      const sleepH = _fmSleepImported;
      if (steps == null && sleepH == null) {
        _fmDayFillMsg = 'nodata';
        _renderFocusedStep();
        setTimeout(() => {
          if (_fmDayFillMsg !== 'nodata') return;
          _fmDayFillMsg = null;
          if (_fmActive) _renderFocusedStep();
        }, 2500);
        return;
      }

      const cat = _suggestMoodFromHealth(steps, sleepH) || 'stable';
      selectedMood = _spectrumEnabled() ? _FM_SPECTRUM_FOR_CAT[cat] : cat;
      selectedLinkedMood = null;
      if (steps != null) {
        selectedEnergy  = _energyFromSteps(steps);
        _fmEnergyClear  = false;
      }
      if (sleepH != null) {
        selectedSleep      = sleepH;
        _fmSleepClear      = false;
        _sleepHealthSynced = true;
      }
      _fmDayFillSnapshot = { mood: selectedMood, energy: selectedEnergy, sleep: selectedSleep };
      nativeHaptic('success');
      scheduleDraftSave();
      _fmGoToDone();
    }
    window._fmAutoFillDay = _fmAutoFillDay;

    // ── Regular (full) form: synced badge on the energy + sleep steps ──
    // The big floating emoji + value readout were removed by request; the step
    // count / sleep time already live in the section headers. Only the compact
    // "✓ Synced from …" badge remains, and just when health data is present.
    function _updateEnergyHero() {
      const hero = document.getElementById('energyStepHero');
      if (!hero) return;
      const emojiEl = document.getElementById('energyHeroEmoji');
      const valEl   = document.getElementById('energyHeroValue');
      if (emojiEl) emojiEl.textContent = '';
      if (valEl)   valEl.textContent = '';
      let steps = null;
      const _dv = document.getElementById('entryDate')?.value;
      if (_dv && window._healthStepsByDate && window._healthStepsByDate[_dv] != null) steps = window._healthStepsByDate[_dv];
      const badgeEl = document.getElementById('energyHeroBadge');
      badgeEl.textContent = '✓ ' + _syncSourceLabel();
      badgeEl.style.display = steps != null ? '' : 'none';
      hero.style.display = steps != null ? '' : 'none';
    }

    function _updateSleepHero() {
      const hero = document.getElementById('sleepStepHero');
      if (!hero) return;
      const emojiEl = document.getElementById('sleepHeroEmoji');
      const valEl   = document.getElementById('sleepHeroValue');
      if (emojiEl) emojiEl.textContent = '';
      if (valEl)   valEl.textContent = '';
      const badgeEl = document.getElementById('sleepHeroBadge');
      badgeEl.textContent = '✓ ' + _syncSourceLabel();
      badgeEl.style.display = _sleepHealthSynced ? '' : 'none';
      hero.style.display = _sleepHealthSynced ? '' : 'none';
    }

    /**
     * Renders the body of a focused-mode step.
     *
     * @param {object} step  step descriptor ({ id, … })
     * @param {object} [opts]
     * @param {boolean} [opts.noActions]  omit the done step's own Clear/Save
     *   pill row. The full (non-focused) form reuses this renderer to build the
     *   save-confirmation modal's summary, and that modal already carries its
     *   own ← Edit / Save ✨ footer — so without this the user got two rows of
     *   the same buttons, the top one wired to _fmNext(), which does nothing
     *   outside focused mode (_fmStepIndex isn't on the done step there).
     */
    function _fmRenderContent(step, opts) {
      const _noActions = !!(opts && opts.noActions);
      const cap = s => s ? s.charAt(0).toUpperCase()+s.slice(1) : '';
      switch (step.id) {
        case 'mood': {
          const _chooseMoodHintDone = BB.storage.get('_fmChooseMoodHintDone') === '1';
          const _showChooseMoodHint = !_chooseMoodHintDone && !editingEntry;
          const _showFmTip = !BB.storage.get('_fmMoodTipShown') && _chooseMoodHintDone && BB.storage.get('_fmTapHoldHintReady') === '1';
          // Quick notes from index.html — show accumulated notes above mood selector
          let _quickNotesHtml = '';
          try {
            const _qn = JSON.parse(BB.storage.get('QuickNotes') || '[]');
            if (_qn.length > 0) {
              const _noteRows = _qn.map((n, i) => {
                const _esc = n.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                const _border = i > 0 ? 'margin-top:7px;padding-top:7px;border-top:1px solid rgba(74,158,255,0.2);' : '';
                return `<div style="display:flex;align-items:flex-start;gap:8px;${_border}">
                  <p style="flex:1;font-size:0.85em;color:#495057;margin:0;line-height:1.45;">${_esc}</p>
                  <button onclick="_dismissQuickNote('${n.id}')" style="background:none;border:none;color:#adb5bd;font-size:1em;cursor:pointer;padding:0;line-height:1;flex-shrink:0;-webkit-tap-highlight-color:transparent;" title="${BB.t('journal.ui.dismiss')}">✕</button>
                </div>`;
              }).join('');
              _quickNotesHtml = `<div style="background:#f0f7ff;border-radius:10px;padding:10px 14px;margin-bottom:14px;border-left:3px solid #5b8dee;">
                <p style="font-size:0.75em;font-weight:700;color:#5b8dee;margin:0 0 7px;text-transform:uppercase;letter-spacing:0.3px;">${BB.t('journal.ui.yourNotes')}</p>
                ${_noteRows}
              </div>`;
            }
          } catch(_) {}

          // Check for yesterday's intention to display under heading
          let _prevIntentionHtml = '';
          if (!editingEntry && localStorage.getItem('intentionEnabled') === 'true') {
            try {
              const _edv = document.getElementById('entryDate')?.value;
              if (_edv && _allEntries && _allEntries.length) {
                const _edate = new Date(_edv + 'T00:00:00');
                const _pdate = new Date(_edate); _pdate.setDate(_pdate.getDate() - 1);
                const _pk = `${_pdate.getFullYear()}-${String(_pdate.getMonth()+1).padStart(2,'0')}-${String(_pdate.getDate()).padStart(2,'0')}`;
                const _pe = _allEntries.find(e => { const d = new Date(e.date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === _pk; });
                if (_pe && _pe.intention) {
                  const _piClean = _pe.intention.split(/\n?_{3,}\n/)[0].trim();
                  if (_piClean) {
                    _prevIntentionHtml = `<div style="background:var(--brand-tint);border-radius:10px;padding:10px 14px;margin-bottom:14px;border-left:3px solid var(--brand-primary);"><p style="font-size:0.75em;font-weight:700;color:var(--brand-primary);margin:0 0 3px;text-transform:uppercase;letter-spacing:0.3px;">${BB.t('journal.ui.yourIntention')}</p><p style="font-size:0.85em;color:#495057;margin:0;line-height:1.4;font-style:italic;">${_piClean.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p></div>`;
                  }
                }
              }
            } catch(_) {}
          }
          let _linkedChip = '';
          if (selectedLinkedMood) {
            _linkedChip = '';
          } else if (_fmLinkMoodPickerOpen && selectedMood) {
            _linkedChip = `<p style="text-align:center;font-size:0.82em;color:var(--brand-primary);font-weight:600;margin-top:12px;margin-bottom:0;">${BB.t('journal.ui.nowTapLink')}</p>
              <p style="text-align:center;font-size:0.72em;color:#adb5bd;margin-top:4px;margin-bottom:0;">${BB.t('journal.ui.tapAgainSkip', { mood: `<strong>${cap(selectedMood)}</strong>` })} &nbsp;<button onclick="_fmLinkMoodPickerOpen=false;_renderFocusedStep();" style="background:none;border:none;color:#adb5bd;font-size:0.9em;cursor:pointer;-webkit-tap-highlight-color:transparent;padding:0;text-decoration:underline;">${BB.t('common.cancel')}</button></p>`;
          } else if (selectedMood && localStorage.getItem('moodLinkingEnabled') === '1') {
            _linkedChip = `<p style="text-align:center;font-size:0.72em;color:#adb5bd;margin-top:8px;margin-bottom:0;">${BB.t('journal.ui.holdToLink')}</p>`;
          }
          // ── Plain mode (wheel BETA off) — the original pre-wheel focus form:
          // the same horizontal mood buttons (bear image + label) as the classic
          // form. Spectrum (0–10) falls back to a vertical list (it predates the
          // wheel and has no five-slot equivalent).
          if (!_wheelMode()) {
            const _hintSvg = `<svg width="24" height="22" viewBox="0 0 24 22" fill="none"><path d="M 12,20 Q 8,10 12,2" stroke="rgba(255,149,0,0.7)" stroke-width="2" stroke-linecap="round" fill="none"/><polyline points="7,6 12,1 17,6" stroke="rgba(255,149,0,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
            const _chooseHint = _showChooseMoodHint ? `<div id="_fmChooseMoodHintEl" style="display:flex;flex-direction:column;align-items:center;pointer-events:none;animation:hintFade 2.4s ease-in-out infinite;margin-top:10px;">
              ${_hintSvg}<span style="font-size:0.72em;font-weight:700;font-style:italic;color:rgba(255,149,0,0.9);white-space:nowrap;font-family:'Georgia',serif;letter-spacing:0.01em;">${BB.t('journal.hint.chooseMood')}</span></div>` : '';
            const _tapHoldHint = _showFmTip ? `<div id="_fmTapHoldHintEl" style="display:flex;flex-direction:column;align-items:center;pointer-events:none;animation:hintFade 2.4s ease-in-out infinite;margin-top:12px;">
              ${_hintSvg}<span style="font-size:0.78em;font-weight:700;font-style:italic;color:rgba(255,149,0,0.9);white-space:nowrap;font-family:'Georgia',serif;letter-spacing:0.01em;">${BB.t('journal.hint.tapHold').replace(/&/g, '&amp;')}</span></div>` : '';
            let _moodControl;
            if (_spectrumEnabled()) {
              // 0–10 spectrum uses the same slider as the classic form (it postdates
              // the wheel, so there's no five-slot horizontal equivalent). Slide to
              // preview; the Continue button commits via _fmSpectrumTap.
              const _initN = (selectedMood != null && selectedMood !== '') ? Math.max(0, Math.min(10, Math.round(Number(selectedMood)))) : 5;
              const _sCat = _moodCat(_initN);
              const _sCol = moodColors[_sCat] || 'var(--brand-primary)';
              _moodControl = `<div class="mood-spectrum-control committed" id="fmSpectrumControl" style="--msc-accent:${_sCol};">
                <div class="msc-readout">
                  <img id="fmMscImg" class="msc-img" src="${_moodImg(_initN)}" alt="">
                  <div class="msc-text">
                    <div id="fmMscValue" class="msc-value" style="color:${_sCol};">${_fmtMoodNum(_initN)}</div>
                    <div id="fmMscLabel" class="msc-label">${_moodLabelOf(_initN)}</div>
                  </div>
                </div>
                <input type="range" id="fmMscSlider" class="msc-slider" min="0" max="10" step="1" value="${_initN}" oninput="_fmOnSpectrumSlide(this.value)" aria-label="Mood on a 0 to 10 spectrum">
                <div class="msc-scale"><span>0 · ${BB.t('mood.depressed')}</span><span>5 · ${BB.t('mood.stable')}</span><span>10 · ${BB.t('mood.manic')}</span></div>
              </div>
              <button id="fmSpectrumContinue" onclick="_fmSpectrumTap(document.getElementById('fmMscSlider').value)" style="width:100%;margin-top:2px;padding:12px;background:${_sCol};color:white;border:none;border-radius:14px;font-size:0.95em;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('common.continue')} →</button>`;
            } else {
              _moodControl = `<div class="mood-selector" style="margin-bottom:0;">${['manic','elevated','stable','low','depressed'].map(m =>
                `<button class="mood-btn mood-${m} ${selectedMood===m?'selected':''} ${(selectedLinkedMood===m || (_fmLinkMoodPickerOpen && m!==selectedMood)) ? 'linked':''}"
                  onclick="_fmMoodTap('${m}')"
                  ontouchstart="_fmLongPressStart('${m}',event)" ontouchend="_fmLongPressCancel()" ontouchmove="_fmLongPressCancel()" onmousedown="_fmLongPressStart('${m}',event)" onmouseup="_fmLongPressCancel()" onmouseleave="_fmLongPressCancel()">
                  <img class="emoji" src="images/moods/${m}.png" alt="${m}">
                  <span class="label${BB.t('mood.' + m).length > 10 ? ' fm-label-long' : ''}">${BB.t('mood.' + m)}</span>
                </button>`).join('')}</div>`;
            }
            return `${_quickNotesHtml}${_prevIntentionHtml}${_fmDayFillBtnHtml()}${_moodControl}
            ${_linkedChip}
            ${selectedLinkedMood ? `<button onclick="_fmAdvance()" style="width:100%;margin-top:14px;padding:12px;background:var(--brand-btn);color:white;border:none;border-radius:14px;font-size:0.95em;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('common.continue')} →</button>` : ''}
            ${_chooseHint}${_tapHoldHint}`;
          }
          // Full mood spectrum — render an 11-point (0–10) wheel instead of the
          // five fixed moods. Each stop maps to a legacy category for its image/colour.
          if (_spectrumEnabled()) {
            const _initN = (selectedMood != null && selectedMood !== '') ? Math.round(Number(selectedMood)) : 5;
            const _spectrumWheel = _fmWheelHtml([0,1,2,3,4,5,6,7,8,9,10].map(n => ({
              val: n,
              img: _moodImg(n),
              label: SPECTRUM_LABELS[n],
              // Show the 0–10 number on every stop so adjacent stops that share a
              // name (0/1 severely depressed, 2/3 depressed, 7/8 hypomanic, 9/10
              // manic) are still distinguishable.
              sub: String(n),
              color: _FM_MOOD_COLORS[_moodCat(n)],
              cls: (selectedMood != null && selectedMood !== '' && Number(selectedMood) === n) ? 'sel' : '',
              init: n === _initN,
              onclick: `_fmSpectrumTap(${n})`,
            })));
            return `${_quickNotesHtml}${_prevIntentionHtml}${_fmDayFillBtnHtml()}${_fmHeroHtml()}<div class="fm-spectrum-wheel">${_spectrumWheel}</div>
            ${_showChooseMoodHint ? `<div id="_fmChooseMoodHintEl" style="display:flex;flex-direction:column;align-items:center;pointer-events:none;animation:hintFade 2.4s ease-in-out infinite;margin-top:8px;">
              <svg width="24" height="22" viewBox="0 0 24 22" fill="none">
                <path d="M 12,20 Q 8,10 12,2" stroke="rgba(255,149,0,0.7)" stroke-width="2" stroke-linecap="round" fill="none"/>
                <polyline points="7,6 12,1 17,6" stroke="rgba(255,149,0,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
              </svg>
              <span style="font-size:0.72em;font-weight:700;font-style:italic;color:rgba(255,149,0,0.9);white-space:nowrap;font-family:'Georgia',serif;letter-spacing:0.01em;">${BB.t('journal.hint.chooseMood')}</span>
            </div>` : ''}`;
          }
          const _initMood = selectedMood || _fmMoodSuggestion || 'stable';
          const _moodWheel = _fmWheelHtml(['manic','elevated','stable','low','depressed'].map(m => ({
            val: m,
            img: `images/moods/${m}.png`,
            label: BB.t('mood.' + m),
            color: _FM_MOOD_COLORS[m],
            cls: `${selectedMood===m?'sel':''}${(selectedLinkedMood===m || (_fmLinkMoodPickerOpen && m!==selectedMood)) ? ' linked' : ''}`,
            init: m === _initMood,
            onclick: `_fmMoodTap('${m}')`,
            extra: `ontouchstart="_fmLongPressStart('${m}',event)" ontouchend="_fmLongPressCancel()" ontouchmove="_fmLongPressCancel()" onmousedown="_fmLongPressStart('${m}',event)" onmouseup="_fmLongPressCancel()" onmouseleave="_fmLongPressCancel()"`,
          })));
          return `${_quickNotesHtml}${_prevIntentionHtml}${_fmDayFillBtnHtml()}${_fmHeroHtml()}${_moodWheel}
          ${_linkedChip}
          ${selectedLinkedMood ? `<button onclick="_fmAdvance()" style="width:100%;margin-top:14px;padding:12px;background:var(--brand-btn);color:white;border:none;border-radius:14px;font-size:0.95em;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('common.continue')} →</button>` : ''}
          ${_showChooseMoodHint ? `<div id="_fmChooseMoodHintEl" style="display:flex;flex-direction:column;align-items:center;pointer-events:none;animation:hintFade 2.4s ease-in-out infinite;margin-top:8px;">
            <svg width="24" height="22" viewBox="0 0 24 22" fill="none">
              <path d="M 12,20 Q 8,10 12,2" stroke="rgba(255,149,0,0.7)" stroke-width="2" stroke-linecap="round" fill="none"/>
              <polyline points="7,6 12,1 17,6" stroke="rgba(255,149,0,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
            <span style="font-size:0.72em;font-weight:700;font-style:italic;color:rgba(255,149,0,0.9);white-space:nowrap;font-family:'Georgia',serif;letter-spacing:0.01em;">${BB.t('journal.hint.chooseMood')}</span>
          </div>` : ''}
          ${_showFmTip ? `<div id="_fmTapHoldHintEl" style="display:flex;flex-direction:column;align-items:center;pointer-events:none;animation:hintFade 2.4s ease-in-out infinite;margin-top:12px;">
            <svg width="24" height="22" viewBox="0 0 24 22" fill="none">
              <path d="M 12,20 Q 8,10 12,2" stroke="rgba(255,149,0,0.7)" stroke-width="2" stroke-linecap="round" fill="none"/>
              <polyline points="7,6 12,1 17,6" stroke="rgba(255,149,0,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
            <span style="font-size:0.78em;font-weight:700;font-style:italic;color:rgba(255,149,0,0.9);white-space:nowrap;font-family:'Georgia',serif;letter-spacing:0.01em;">${BB.t('journal.hint.tapHold').replace(/&/g, '&amp;')}</span>
          </div>` : ''}`;
        }

        case 'energy': {
          const _committedEnergy = _fmEnergyClear ? null : selectedEnergy;
          // Plain mode (wheel BETA off) — the original pre-wheel horizontal card
          // grid (emoji + label per card).
          if (!_wheelMode()) {
            const _stepsSyncBtn = (BB.storage.get('HealthSyncEnabled') === '1' && _fmStepsResult) ? `<button onclick="importStepsFromHealth()" style="width:100%;padding:11px 16px;margin-bottom:14px;background:rgba(255,149,0,0.08);border:2px solid rgba(255,149,0,0.35);border-radius:12px;color:var(--brand-primary);font-weight:600;font-size:0.88em;cursor:pointer;-webkit-tap-highlight-color:transparent;">📱 ${BB.t('journal.sync.steps', { n: _fmStepsResult })} — ${BB.t('common.change')}</button>` : '';
            // Full spectrum: 0–10 on one slider (5 = normal) instead of five cards.
            if (_spectrumEnabled()) {
              const _initE = _committedEnergy !== null ? _fmClampEnergy(_committedEnergy)
                : (_fmEnergySuggestion !== null ? _fmClampEnergy(_fmEnergySuggestion) : 5);
              const _m = _fmEnergyMeta(_initE);
              return _stepsSyncBtn + `<div class="mood-spectrum-control${_committedEnergy !== null ? ' committed' : ''}" id="fmEnergySpectrumControl" style="--msc-accent:${_m.color};">
                  <div class="msc-readout">
                    <div id="fmEnscEmoji" class="msc-emoji">${_m.emoji}</div>
                    <div class="msc-text">
                      <div id="fmEnscValue" class="msc-value" style="color:${_m.color};">${_initE}</div>
                      <div id="fmEnscLabel" class="msc-label">${_m.label}</div>
                    </div>
                  </div>
                  <input type="range" id="fmEnscSlider" class="msc-slider msc-energy" min="${_FM_ENERGY_FULL_MIN}" max="${_FM_ENERGY_FULL_MAX}" step="1" value="${_initE}"
                    oninput="_fmOnEnergySlide(this.value)" aria-label="Energy on a 0 to 10 scale where 5 is normal">
                  <div class="msc-scale"><span>0 · ${_fmEnergyMeta(0).label}</span><span>5 · ${_fmEnergyMeta(5).label}</span><span>10 · ${_fmEnergyMeta(10).label}</span></div>
                </div>
                <button id="fmEnergySpectrumContinue" onclick="_fmEnergySliderTap(document.getElementById('fmEnscSlider').value)" style="width:100%;margin-top:2px;padding:12px;background:${_m.color};color:white;border:none;border-radius:14px;font-size:0.95em;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('common.continue')} →</button>`;
            }
            const _energyCards = `<div class="fm-card-grid">${_FM_ENERGY_LEVELS.map(l => {
              const isSel = _committedEnergy === l.val;
              const isSugg = _fmEnergySuggestion === l.val;
              const [emoji, ...rest] = l.label.split(' ');
              return `<button class="fm-card-btn ${isSel?'sel':''}" onclick="selectedEnergy=${l.val}; _fmEnergyClear=false; _fmAdvance();"
                onmouseenter="if(window.matchMedia('(pointer:fine)').matches && !this.classList.contains('sel')){this.style.borderColor='${l.color}';this.style.background='${l.color}18';this.style.color='${l.color}';}"
                onmouseleave="if(window.matchMedia('(pointer:fine)').matches && !this.classList.contains('sel')){this.style.borderColor='';this.style.background='';this.style.color='';}"
                style="${isSel ? `border-color:${l.color};background:${l.color}22;color:${l.color};` : ''}">
                <span class="fm-card-emoji">${emoji}</span>
                <span class="fm-card-label">${rest.join(' ')}${isSugg && !isSel ? '<br><span style="font-size:0.72em;opacity:0.65;">✓</span>' : ''}</span>
              </button>`;
            }).join('')}</div>`;
            return _stepsSyncBtn + _energyCards;
          }
          const _initEnergy = _committedEnergy !== null ? _committedEnergy
            : (_fmEnergySuggestion !== null ? _fmEnergySuggestion : 5);
          // Full spectrum + wheel: all eleven 0–10 stops rather than five levels.
          if (_spectrumEnabled()) {
            const _stops = [];
            for (let v = _FM_ENERGY_FULL_MIN; v <= _FM_ENERGY_FULL_MAX; v++) _stops.push(v);
            const _fullEnergyWheel = _fmWheelHtml(_stops.map(v => {
              const m = _fmEnergyMeta(v);
              return {
                val: v, emoji: m.emoji, label: m.label, color: m.color,
                // The number distinguishes adjacent stops that share a band name
                // (1–4 are all "less than usual", 6–9 all "more than usual").
                sub: String(v),
                cls: _committedEnergy === v ? 'sel' : '',
                init: v === Math.round(_fmClampEnergy(_initEnergy)),
                onclick: `selectedEnergy=${v}; _fmEnergyClear=false; _fmAdvance();`,
              };
            }));
            return _fmHeroHtml() + _fullEnergyWheel;
          }
          const _energyWheel = _fmWheelHtml(_FM_ENERGY_LEVELS.map(l => {
            const [emoji, ...rest] = l.label.split(' ');
            return {
              val: l.val, emoji, label: rest.join(' '), color: l.color,
              cls: _committedEnergy === l.val ? 'sel' : '',
              init: l.val === _initEnergy,
              onclick: `selectedEnergy=${l.val}; _fmEnergyClear=false; _fmAdvance();`,
            };
          }));
          return _fmHeroHtml() + _energyWheel;
        }

        case 'sleep': {
          // Entry dated today/future → "the night of D" hasn't happened yet.
          // Lock the field: clear any value, show a message, offer Continue.
          if (_sleepNotYet()) {
            selectedSleep = null;
            _fmSleepClear = true;
            selectedSleepQuality = null;
            _fmWantsSleepQuality = false;
            return `<div style="text-align:center;padding:18px 8px;">
                <div style="font-size:2.6em;margin-bottom:10px;line-height:1;">🌙</div>
                <p style="font-size:0.98em;color:#495057;font-weight:600;margin:0 0 6px;">${BB.t('journal.fm.sleepNotYet')}</p>
                <p style="font-size:0.83em;color:#adb5bd;margin:0 0 18px;">${BB.t('journal.fm.sleepNotYetSub')}</p>
                <button onclick="_fmAdvance()" style="width:100%;padding:12px;background:var(--brand-btn);color:white;border:none;border-radius:14px;font-size:0.95em;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('common.continue')} →</button>
              </div>`;
          }
          const _committedBucket = (_fmSleepClear || selectedSleep == null) ? null : _fmSleepBucketOf(selectedSleep);
          // Plain mode (wheel BETA off) — the original pre-wheel horizontal card
          // grid. Long-pressing a card still opens the sleep-quality step (the
          // original behaviour), so nothing is lost vs the wheel.
          if (!_wheelMode()) {
            const _autoSyncSleep = BB.storage.get('HealthSyncEnabled') === '1';
            const _showSleepSyncBtn = _autoSyncSleep && (_fmSleepError || (_fmSleepAutoSyncDone && !_fmSleepImported && !_sleepHealthSynced));
            const _syncText = _fmSleepError === 'fail' ? '❌ Sync failed — try again'
              : _fmSleepError === 'nodata' ? '🤷 No sleep data found — try again'
              : '📱 ' + _syncSourceLabel();
            const _syncBtn = _showSleepSyncBtn ? `<button onclick="importSleepFromHealth()" style="width:100%;padding:11px 16px;margin-bottom:14px;background:rgba(255,149,0,0.08);border:2px solid rgba(255,149,0,0.35);border-radius:12px;color:var(--brand-primary);font-weight:600;font-size:0.88em;cursor:pointer;-webkit-tap-highlight-color:transparent;">${_syncText}</button>` : '';
            const _syncedRange = (_sleepHealthSynced && !_fmSleepClear) ? _FM_SLEEP_RANGES.find(r => r.val === _committedBucket) : null;
            const _bannerCol = _syncedRange ? _syncedRange.color : '#51cf66';
            const _syncedBanner = (_sleepHealthSynced && !_fmSleepClear)
              ? `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;margin-bottom:10px;background:${_bannerCol}18;border:1.5px solid ${_bannerCol}55;border-radius:10px;">
                  <span style="font-size:0.9em;font-weight:600;color:${_bannerCol};">😴 ${selectedSleep}h — ${_syncSourceLabel()}</span>
                  <div style="display:flex;align-items:center;gap:4px;">
                    ${_autoSyncSleep ? `<button onclick="importSleepFromHealth()" style="background:none;border:1px solid #adb5bd;color:#adb5bd;font-size:0.75em;cursor:pointer;padding:2px 8px;border-radius:6px;-webkit-tap-highlight-color:transparent;">${BB.t('common.change')}</button>` : ''}
                    <button onclick="_fmUndoSleepSync()" style="background:none;border:none;color:#adb5bd;font-size:0.8em;cursor:pointer;-webkit-tap-highlight-color:transparent;padding:2px 6px;">✕</button>
                  </div>
                 </div>` : '';
            // Full spectrum: one slider across ≤4h … ≥12h instead of five buckets.
            // Slide to preview, Continue to commit — the same shape as the mood
            // spectrum control, so the two steps feel like one mechanism.
            if (_spectrumEnabled()) {
              const _initH = (!_fmSleepClear && selectedSleep != null)
                ? _fmClampSleep(selectedSleep)
                : (_fmSleepSuggestion != null ? _fmClampSleep(_fmSleepSuggestion) : 8);
              const _m = _fmSleepMeta(_initH);
              const _committed = (!_fmSleepClear && selectedSleep != null);
              return _syncBtn + _syncedBanner + `<div class="mood-spectrum-control${_committed ? ' committed' : ''}" id="fmSleepSpectrumControl" style="--msc-accent:${_m.color};">
                  <div class="msc-readout">
                    <div id="fmSlscEmoji" class="msc-emoji">${_m.emoji}</div>
                    <div class="msc-text">
                      <div id="fmSlscValue" class="msc-value" style="color:${_m.color};">${_m.label}</div>
                      <div id="fmSlscLabel" class="msc-label">${_m.band}</div>
                    </div>
                  </div>
                  <input type="range" id="fmSlscSlider" class="msc-slider msc-sleep" min="${_FM_SLEEP_FULL_MIN}" max="${_FM_SLEEP_FULL_MAX}" step="1" value="${Math.round(_initH)}"
                    oninput="_fmOnSleepSlide(this.value)" aria-label="Hours of sleep from ${_FM_SLEEP_FULL_MIN} or fewer to ${_FM_SLEEP_FULL_MAX} or more">
                  <div class="msc-scale"><span>≤${_FM_SLEEP_FULL_MIN}h</span><span>8h</span><span>≥${_FM_SLEEP_FULL_MAX}h</span></div>
                </div>
                <button id="fmSleepSpectrumContinue" onclick="_fmSleepSliderTap(document.getElementById('fmSlscSlider').value)" style="width:100%;margin-top:2px;padding:12px;background:${_m.color};color:white;border:none;border-radius:14px;font-size:0.95em;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('common.continue')} →</button>`
                // A slider has nothing to long-press, so sleep quality — reachable
                // by holding a card/pill everywhere else — gets an explicit link
                // here. Without it the step would be unreachable in this mode.
                + `<p style="text-align:center;margin:10px 0 0;"><button onclick="_fmSleepSliderQuality(document.getElementById('fmSlscSlider').value)" style="background:none;border:none;color:var(--brand-primary);font-size:0.8em;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:3px;-webkit-tap-highlight-color:transparent;">${BB.t('journal.sleepQualityAdd')}</button></p>`;
            }
            const _sleepCards = `<div class="fm-card-grid">${_FM_SLEEP_RANGES.map(r => {
              const isSel = _committedBucket === r.val;
              const [emoji, ...rest] = r.label.split(' ');
              const text = (isSel && _sleepHealthSynced && !_fmSleepClear) ? `${selectedSleep}h` : rest.join(' ');
              const _slOnclick = (_sleepHealthSynced && isSel)
                ? `if(!_fmSlLpFired){_fmSleepClear=false;_fmAdvance();}`
                : `if(!_fmSlLpFired){selectedSleep=${r.val};_sleepHealthSynced=false;_fmSleepClear=false;_fmAdvance();}`;
              return `<button class="fm-card-btn ${isSel?'sel':''}" onclick="${_slOnclick}"
                onpointerdown="_fmSleepPtrDown(${r.val}, this)" onpointerup="_fmSleepPtrUp()" onpointercancel="_fmSleepPtrCancel()"
                onmouseenter="if(window.matchMedia('(pointer:fine)').matches && !this.classList.contains('sel')){this.style.borderColor='${r.color}';this.style.background='${r.color}18';this.style.color='${r.color}';}"
                onmouseleave="if(window.matchMedia('(pointer:fine)').matches && !this.classList.contains('sel')){this.style.borderColor='';this.style.background='';this.style.color='';}"
                style="${isSel ? `border-color:${r.color};background:${r.color};color:white;font-weight:700;` : ''}">
                <span class="fm-card-emoji">${emoji}</span>
                <span class="fm-card-label">${text}</span>
              </button>`;
            }).join('')}</div>`;
            const _sqHint = `<p style="text-align:center;font-size:0.78em;color:#adb5bd;margin-top:8px;margin-bottom:0;">${BB.t('journal.sleepQualityHint')}</p>`;
            return _syncBtn + _syncedBanner + _sleepCards + _sqHint;
          }
          const _initBucket = _committedBucket !== null ? _committedBucket
            : (_fmSleepSuggestion !== null ? _fmSleepSuggestion : 8);
          const _sqHint = `<p class="fm-wheel-hint">${BB.t('journal.sleepQualityHint')}</p>`;
          // Full spectrum + wheel: every hour from ≤4h to ≥12h becomes a stop,
          // rather than the five buckets.
          if (_spectrumEnabled()) {
            const _committedH = (!_fmSleepClear && selectedSleep != null) ? _fmClampSleep(selectedSleep) : null;
            const _initH = _committedH != null ? Math.round(_committedH)
              : (_fmSleepSuggestion != null ? Math.round(_fmClampSleep(_fmSleepSuggestion)) : 8);
            const _stops = [];
            for (let h = _FM_SLEEP_FULL_MIN; h <= _FM_SLEEP_FULL_MAX; h++) _stops.push(h);
            const _fullSleepWheel = _fmWheelHtml(_stops.map(h => {
              const m = _fmSleepMeta(h);
              // Exact-hour match, so a 7.5h Health import highlights neither 7 nor
              // 8 — the synced banner above already states the precise figure.
              const isSel = _committedH === h;
              return {
                val: h, emoji: m.emoji, label: m.label, color: m.color,
                sub: (isSel && _sleepHealthSynced) ? `${selectedSleep}h` : '',
                cls: isSel ? 'sel' : '',
                init: h === _initH,
                onclick: (_sleepHealthSynced && isSel)
                  ? `if(!_fmSlLpFired){_fmSleepClear=false;_fmAdvance();}`
                  : `if(!_fmSlLpFired){selectedSleep=${h};_sleepHealthSynced=false;_fmSleepClear=false;_fmAdvance();}`,
                extra: `onpointerdown="_fmSleepPtrDown(${h}, this)" onpointerup="_fmSleepPtrUp()" onpointercancel="_fmSleepPtrCancel()"`,
              };
            }), _sqHint);
            const _retryLinkFull = (BB.storage.get('HealthSyncEnabled') === '1' && _fmSleepError)
              ? `<p style="text-align:center;margin:0;"><button onclick="importSleepFromHealth()" style="background:none;border:none;color:var(--brand-primary);font-size:0.82em;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px;-webkit-tap-highlight-color:transparent;">${_fmSleepError === 'nodata' ? '🤷 No sleep data found — try again' : '❌ Sync failed — try again'}</button></p>` : '';
            return _fmHeroHtml() + _retryLinkFull + _fullSleepWheel;
          }
          const _sleepWheel = _fmWheelHtml(_FM_SLEEP_RANGES.map(r => {
            const isSel = _committedBucket === r.val;
            const [emoji, ...rest] = r.label.split(' ');
            // Tapping the already-synced bucket keeps the exact synced hours;
            // tapping any other pill overrides the sync with the bucket value.
            const _slOnclick = (_sleepHealthSynced && isSel)
              ? `if(!_fmSlLpFired){_fmSleepClear=false;_fmAdvance();}`
              : `if(!_fmSlLpFired){selectedSleep=${r.val};_sleepHealthSynced=false;_fmSleepClear=false;_fmAdvance();}`;
            return {
              val: r.val, emoji, label: rest.join(' '), color: r.color,
              sub: (isSel && _sleepHealthSynced) ? `${selectedSleep}h` : '',
              cls: isSel ? 'sel' : '',
              init: r.val === _initBucket,
              onclick: _slOnclick,
              extra: `onpointerdown="_fmSleepPtrDown(${r.val}, this)" onpointerup="_fmSleepPtrUp()" onpointercancel="_fmSleepPtrCancel()"`,
            };
          }), _sqHint);
          // Small retry link when the auto-import errored (sync on, nothing pulled in)
          const _retryLink = (BB.storage.get('HealthSyncEnabled') === '1' && _fmSleepError)
            ? `<p style="text-align:center;margin:0;"><button onclick="importSleepFromHealth()" style="background:none;border:none;color:var(--brand-primary);font-size:0.82em;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px;-webkit-tap-highlight-color:transparent;">${_fmSleepError === 'nodata' ? '🤷 No sleep data found — try again' : '❌ Sync failed — try again'}</button></p>` : '';
          return _fmHeroHtml() + _retryLink + _sleepWheel;
        }

        case 'sleepQuality': {
          // Built as a real 5-pill wheel — Bad, Bad, OK, Good, Good — so it runs
          // the EXACT same native-scroll + CSS-snap path as the working 5-pill
          // mood/energy wheels (a genuine 5-slot row, not a 2–3 slot one faked
          // wide with padding, which never worked on-device). The two outer
          // copies are marked spacer:true — kept as real, same-width, snap-
          // aligned, tappable slots so iOS still sees a genuine 5-slot scroll
          // surface, but painted as invisible runway (see .fm-wheel-runway) so
          // the user only sees the three distinct answers. Landing on a runway
          // slot still commits its (edge) value, and OK is the neutral centre.
          const _sqBad = { val:'bad',    emoji:'😴', label:BB.t('journal.value.bad'),  color:'#dc3545' };
          const _sqOk  = { val:'unsure', emoji:'😐', label:BB.t('journal.value.ok'),   color:'#adb5bd' };
          const _sqGd  = { val:'good',   emoji:'😊', label:BB.t('journal.value.good'), color:'#51cf66' };
          // Plain mode (wheel BETA off) — the original pre-wheel 3-up card grid.
          if (!_wheelMode()) {
            const _sqCls = { bad:'sq-bad', unsure:'sq-ok', good:'sq-good' };
            const _sqSelStyle = { bad:'border-color:#dc3545;background:#dc354522;color:#dc3545;', unsure:'border-color:#adb5bd;background:#adb5bd22;color:#adb5bd;', good:'border-color:#51cf66;background:#51cf6622;color:#51cf66;' };
            return `<div class="fm-card-grid" style="grid-template-columns:repeat(3,1fr);">${[_sqBad, _sqOk, _sqGd].map(o => {
              const isSel = selectedSleepQuality === o.val;
              return `<button class="fm-card-btn ${_sqCls[o.val]} ${isSel?'sel':''}" onclick="selectedSleepQuality='${o.val}'; _fmAdvance();"
                style="${isSel ? _sqSelStyle[o.val] : ''}">
                <span class="fm-card-emoji">${o.emoji}</span>
                <span class="fm-card-label">${o.label}</span>
              </button>`;
            }).join('')}</div>`;
          }
          const _sqP = (o, extra) => Object.assign({
            val: o.val, emoji: o.emoji, label: o.label, color: o.color,
            cls: selectedSleepQuality === o.val ? 'sel' : '',
            onclick: `selectedSleepQuality='${o.val}'; _fmAdvance();`,
          }, extra || {});
          const _sqWheel = _fmWheelHtml([
            _sqP(_sqBad, { spacer: true }),
            _sqP(_sqBad),
            _sqP(_sqOk, { init: !selectedSleepQuality }),
            _sqP(_sqGd),
            _sqP(_sqGd, { spacer: true }),
          ]);
          return _fmHeroHtml() + _sqWheel;
        }

        case 'medication': {
          // 🔔 Medication reminder pill (native apps only — see
          // js/shared/meds-reminder.js). One line, so the step still fits.
          const _mrPill = (window.BB && BB.medsReminder && BB.medsReminder.isAvailable()) ? (() => {
            const _mr = BB.medsReminder.settings();
            const _lbl = _mr.enabled
              ? BB.t('medsReminder.pillOn', { time: _mr.time })
              : BB.t('medsReminder.pillOff');
            return `<div style="text-align:center;margin:4px 0 8px;"><button type="button" id="fmMedsReminderBtn" class="fm-meds-reminder${_mr.enabled ? ' on' : ''}" onclick="BB.medsReminder.openSettings(function(){ window._fmRerenderStep && window._fmRerenderStep(); })">${_lbl}</button></div>`;
          })() : '';
          let medListHtml = '';
          try {
            const _ml = JSON.parse(localStorage.getItem('currentMedList') || '[]');
            const _valid = _ml.filter(m => m && m.name);
            if (_valid.length) {
              medListHtml = `<div style="text-align:center;margin:0 0 10px;display:flex;flex-direction:column;gap:3px;">${_valid.map(m => `<span style="font-size:0.85em;color:#6c757d;">💊 ${String(m.name)}${m.dosage ? ' ' + String(m.dosage) : ''}</span>`).join('')}</div>`;
            }
          } catch(e) {}
          const _medHintDone = BB.storage.get('MedHintDone') === '1';
          // Plain mode (wheel BETA off) — the original pre-wheel layout: the
          // user's med list + a "Manage medications" link above the answer
          // buttons (a vertical fm-opt list, as it always was — no card grid).
          if (!_wheelMode()) {
            const _mdManage = `${medListHtml}
              <div style="text-align:center;margin-bottom:${_medHintDone ? '14' : '4'}px;">
                <button id="manageMedsBtn" onclick="_dismissMedHint();showMedicationList()" style="background:none;border:none;color:var(--brand-primary);font-size:0.8em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;text-decoration:underline;text-underline-offset:2px;">${BB.t('journal.ui.manageMeds')}</button>
                ${_medHintDone ? '' : `<div id="medHintEl" style="display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:4px;margin-bottom:10px;pointer-events:none;animation:hintFade 2.4s ease-in-out infinite;"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="8" y1="13" x2="8" y2="2" stroke="var(--brand-primary)" stroke-width="2" stroke-linecap="round"/><polyline points="3,7 8,2 13,7" stroke="var(--brand-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg><span style="font-size:0.72em;font-weight:700;font-style:italic;color:var(--brand-primary);font-family:'Georgia',serif;letter-spacing:0.01em;">${BB.t('journal.hint.logMed')}</span></div>`}
              </div>${_mrPill}`;
            const _mdOpts = [
              { val:'not-taken', label:BB.t('journal.med.notTaken'), hover:'fm-hover-orange', color:'var(--brand-primary)' },
              { val:'unsure',    label:BB.t('journal.med.unsure'),   hover:'fm-hover-grey',   color:'#adb5bd' },
              { val:'taken',     label:BB.t('journal.med.taken'),    hover:'fm-hover-green',  color:'#51cf66' },
            ].map((o,i) => `<button class="fm-opt ${o.hover} ${selectedMedication===o.val?'sel':''}"
              onclick="selectedMedication='${o.val}'; _fmAdvance();"
              style="border-left:4px solid ${o.color};${i>0?'margin-top:8px;':''}">
              <span>${o.label}</span></button>`).join('');
            return _mdManage + _mdOpts;
          }
          // Sits below the wheel at the very bottom of the page, with the
          // user's med list directly above the "Manage medications" link.
          const _manageRow = `<div class="fm-meds-manage">
              ${medListHtml}
              <button id="manageMedsBtn" onclick="_dismissMedHint();showMedicationList()" style="background:none;border:none;color:${_medHintDone ? 'var(--brand-primary)' : 'rgba(255,255,255,0.9)'};font-size:0.8em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;text-decoration:underline;text-underline-offset:2px;">${BB.t('journal.ui.manageMeds')}</button>
              ${_medHintDone ? '' : `<div id="medHintEl" style="display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:4px;pointer-events:none;animation:hintFade 2.4s ease-in-out infinite;"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="8" y1="13" x2="8" y2="2" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round"/><polyline points="3,7 8,2 13,7" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg><span style="font-size:0.72em;font-weight:700;font-style:italic;color:rgba(255,255,255,0.9);font-family:'Georgia',serif;letter-spacing:0.01em;text-shadow:0 1px 4px rgba(0,0,0,0.5);">${BB.t('journal.hint.logMed')}</span></div>`}
              ${_mrPill}
            </div>`;
          // Built as a real 5-pill wheel — Not taken, Not taken, Unsure,
          // Taken, Taken — so it runs the EXACT same native-scroll + CSS-snap
          // path as the working 5-pill mood/energy wheels (a genuine 5-slot row,
          // not a 2-slot one faked wide with padding, which never worked
          // on-device). The two outer copies are marked spacer:true — kept as
          // real, same-width, snap-aligned, tappable slots so iOS still sees a
          // genuine 5-slot scroll surface, but painted as invisible runway (see
          // .fm-wheel-runway) so the user only sees the three distinct answers.
          // The centre slot is a real "Unsure" answer (grey); the wheel's
          // neutral default under the dial is "Taken" (the common case — most
          // nights meds ARE taken), so it lands there when nothing is committed
          // yet. Landing on a runway slot still commits its (edge) value. The
          // pill body shows the label text — the ✅/❌/🤷 emoji is the hero
          // glyph (data-emoji).
          const _mdSplit = (s) => { const p = String(s).split(' '); return { emoji: p[0] || '', label: p.slice(1).join(' ') || String(s) }; };
          const _mdNot = _mdSplit(BB.t('journal.med.notTaken'));
          const _mdTk  = _mdSplit(BB.t('journal.med.taken'));
          const _mdUn  = _mdSplit(BB.t('journal.med.unsure'));
          const _mdP = (val, sp, color, extra) => Object.assign({
            val, emoji: sp.emoji, label: sp.label, color,
            cls: selectedMedication === val ? 'sel' : '',
            onclick: `selectedMedication='${val}'; _fmAdvance();`,
          }, extra || {});
          const _medWheel = _fmWheelHtml([
            _mdP('not-taken', _mdNot, 'var(--brand-primary)', { spacer: true }),
            _mdP('not-taken', _mdNot, 'var(--brand-primary)'),
            _mdP('unsure', _mdUn, '#adb5bd'),
            _mdP('taken', _mdTk, '#51cf66', { init: !selectedMedication }),
            _mdP('taken', _mdTk, '#51cf66', { spacer: true }),
          ]);
          return _fmHeroHtml() + _medWheel + _manageRow;
        }

        case 'goals':
          return [
            {val:'none', label:'❌ ' + BB.t('journal.value.no'),  color:'var(--brand-primary)'},
            {val:'some', label:'✅ ' + BB.t('journal.value.yes'), color:'var(--brand-primary)'},
          ].map((o,i) => `<button class="fm-opt ${selectedGoals===o.val?'sel':''}"
            onclick="selectedGoals='${o.val}'; _fmAdvance();"
            style="border-left:4px solid ${o.color};${i>0?'margin-top:8px;':''}">
            <span>${o.label}</span></button>`).join('') +
          `<div style="text-align:center;margin-top:14px;">
            <button onclick="showGoalsList()" style="background:none;border:none;color:var(--brand-primary);font-size:0.85em;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px;-webkit-tap-highlight-color:transparent;">${BB.t('journal.btn.viewEditGoals')}</button>
          </div>`;

        case 'anxiety':
        case 'stress': {
          const curSel = step.id==='anxiety' ? selectedAnxiety : selectedStress;
          const setter = step.id==='anxiety' ? 'selectedAnxiety' : 'selectedStress';
          return [
            {val:'high',   label:'😰 ' + BB.t('journal.value.moreThanUsual'), color:'#FF4136'},
            {val:'medium', label:'😐 ' + BB.t('journal.value.normal'),        color:'#FF851B'},
            {val:'low',    label:'😌 ' + BB.t('journal.value.lessThanUsual'), color:'#2ECC40'},
          ].map((o,i) => `<button class="fm-opt ${curSel===o.val?'sel':''}"
            onclick="${setter}='${o.val}'; _fmAdvance();"
            style="border-left:4px solid ${o.color};${i>0?'margin-top:8px;':''}">
            <span>${o.label}</span></button>`).join('');
        }

        case 'irritability':
          return [
            {val:'yes',    label:'😤 ' + BB.t('journal.value.moreThanUsual'), color:'#FF4136'},
            {val:'medium', label:'😐 ' + BB.t('journal.value.normal'),        color:'#FF851B'},
            {val:'no',     label:'😌 ' + BB.t('journal.value.lessThanUsual'), color:'#2ECC40'},
          ].map((o,i) => `<button class="fm-opt ${selectedIrritability===o.val?'sel':''}"
            onclick="selectedIrritability='${o.val}'; _fmAdvance();"
            style="border-left:4px solid ${o.color};${i>0?'margin-top:8px;':''}">
            <span>${o.label}</span></button>`).join('');

        case 'exercise':
          return [
            {val:'no',  label:'🛋️ ' + BB.t('journal.value.no'),  color:'var(--brand-primary)'},
            {val:'yes', label:'🏋️ ' + BB.t('journal.value.yes'), color:'var(--brand-primary)'},
          ].map((o,i) => `<button class="fm-opt ${selectedExercise===o.val?'sel':''}"
            onclick="selectedExercise='${o.val}'; _fmAdvance();"
            style="border-left:4px solid ${o.color};${i>0?'margin-top:8px;':''}">
            <span>${o.label}</span></button>`).join('');

        case 'outside':
          return [
            {val:'no',  label:'🏠 ' + BB.t('journal.value.no'),  color:'var(--brand-primary)'},
            {val:'yes', label:'🌤️ ' + BB.t('journal.value.yes'), color:'var(--brand-primary)'},
          ].map((o,i) => `<button class="fm-opt ${selectedOutside===o.val?'sel':''}"
            onclick="selectedOutside='${o.val}'; _fmAdvance();"
            style="border-left:4px solid ${o.color};${i>0?'margin-top:8px;':''}">
            <span>${o.label}</span></button>`).join('');

        case 'alcohol':
          return [
            {val:'yes', label:'🍺 ' + BB.t('journal.value.yes'), color:'var(--brand-primary)'},
            {val:'no',  label:'✅ ' + BB.t('journal.value.no'),  color:'var(--brand-primary)'},
          ].map((o,i) => `<button class="fm-opt ${selectedAlcohol===o.val?'sel':''}"
            onclick="selectedAlcohol='${o.val}'; _fmAdvance();"
            style="border-left:4px solid ${o.color};${i>0?'margin-top:8px;':''}">
            <span>${o.label}</span></button>`).join('');

        case 'budget': {
          const _budgetVal = localStorage.getItem('dailyBudget') || '';
          const _budgetInfo = _budgetVal
            ? `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:10px 14px;background:var(--brand-tint);border-radius:12px;border:1.5px solid rgba(255,149,0,0.3);">
                <span style="font-size:0.9em;color:#495057;">💰 Daily budget: <b>${_budgetVal}</b></span>
                <button onclick="showBudgetModal()" style="padding:4px 12px;background:var(--brand-btn);color:white;border:none;border-radius:8px;font-size:0.8em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('common.change')}</button>
              </div>`
            : `<div style="text-align:center;margin-bottom:14px;">
                <button onclick="showBudgetModal()" style="padding:8px 18px;background:rgba(255,149,0,0.08);border:2px solid rgba(255,149,0,0.35);border-radius:12px;color:var(--brand-primary);font-weight:600;font-size:0.88em;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('journal.btn.setDailyBudget')}</button>
              </div>`;
          return _budgetInfo + [
            {val:'no',  label:BB.t('journal.budgetOver'),   color:'var(--brand-primary)'},
            {val:'yes', label:BB.t('journal.budgetOnTrack'), color:'var(--brand-primary)'},
          ].map((o,i) => `<button class="fm-opt ${selectedBudget===o.val?'sel':''}"
            onclick="selectedBudget='${o.val}'; _fmAdvance();"
            style="border-left:4px solid ${o.color};${i>0?'margin-top:8px;':''}">
            <span>${o.label}</span></button>`).join('');
        }

        case 'more_data': {
          const _builtIn = step.extras || [];
          const _alreadyInSteps = new Set(_fmSteps.map(s => s.id));
          const _custFields = [];
          try {
            getCustomFields().forEach(f => {
              if (!_alreadyInSteps.has(`custom_${f.id}`) && _fmIsTracking(`trackCustom_${f.id}`)) _custFields.push(f);
            });
          } catch(e) {}
          // Helper: section label
          const _ql = t => `<div style="font-size:0.78em;font-weight:700;color:#adb5bd;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:7px;">${t}</div>`;
          // Helper: horizontal row of answer buttons
          const _btns = opts => opts.map((o, i) => {
            const _hc = i === 0 ? 'fm-hover-orange' : i === opts.length - 1 ? 'fm-hover-green' : 'fm-hover-grey';
            const _sc = i === 0 ? 'var(--brand-primary)' : i === opts.length - 1 ? '#51cf66' : '#adb5bd';
            const _clr = o.clr || o.set.replace(/='[^']*'/, '=null');
            const _click = o.sel ? _clr : o.set;
            return `<button class="${_hc}" onclick="${_click}" style="flex:1;padding:8px 4px;border:1.5px solid ${o.sel?_sc:'#dee2e6'};border-radius:10px;background:${o.sel?_sc+'22':'white'};color:${o.sel?'#212529':'#6c757d'};font-size:0.82em;font-weight:${o.sel?'600':'400'};cursor:pointer;-webkit-tap-highlight-color:transparent;text-align:center;line-height:1.3;">${o.label}</button>`;
          }).join('');
          const _hr  = opts => `<div style="display:flex;gap:6px;margin-bottom:14px;">${_btns(opts)}</div>`;
          const _ilr = (lbl, opts) => `<span style="font-size:0.88em;font-weight:600;color:#495057;white-space:nowrap;">${lbl}</span><div style="display:flex;gap:6px;">${_btns(opts)}</div>`;
          let _md = '';
          for (const ex of _builtIn) {
            if (ex.id === 'goals') {
              const _goalItems = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
              const _goalsDetail = _goalItems.length > 0
                ? (() => { const _dg = _goalItems.map(g => `<span style="display:inline-block;background:rgba(255,149,0,0.12);border-radius:6px;padding:2px 7px;margin:2px;font-size:0.8em;color:#495057;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${g}</span>`).join(''); return `<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:8px 12px;background:var(--brand-tint);border-radius:10px;border:1.5px solid rgba(255,149,0,0.3);gap:8px;"><div style="flex:1;min-width:0;flex-wrap:wrap;display:flex;align-items:center;">${_dg}</div><button onclick="showGoalsList()" style="padding:3px 10px;background:var(--brand-btn);color:white;border:none;border-radius:7px;font-size:0.78em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;flex-shrink:0;">${BB.t('common.change')}</button></div>`; })()
                : `<button onclick="showGoalsList()" style="padding:7px 16px;background:rgba(255,149,0,0.08);border:2px solid rgba(255,149,0,0.35);border-radius:10px;color:var(--brand-primary);font-weight:600;font-size:0.85em;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('journal.btn.setDailyGoals')}</button>`;
              const _goalsTitleClick = _goalItems.length > 0
                ? "var el=document.getElementById('fmGoalsDetail');el.style.display=el.style.display==='none'?'':'none';"
                : "showGoalsList()";
              const _goalsNoteVal = selectedStepNotes['goals'] || '';
              const _goalsNoteHtml = localStorage.getItem('elaborateResponsesEnabled') === 'true' && selectedGoals === 'none'
                ? `<div style="grid-column:1/-1;margin-bottom:4px;"><input type="text" id="fmGoalsNoteInput" placeholder="${BB.t('journal.placeholder.moreDetails')}" value="${_goalsNoteVal.replace(/"/g,'&quot;')}" style="width:100%;border:1.5px solid #e9ecef;border-radius:10px;padding:6px 10px;font-size:0.85em;font-family:inherit;box-sizing:border-box;outline:none;" oninput="selectedStepNotes['goals']=this.value;saveDraft();"></div>`
                : '';
              _md += `<span onclick="${_goalsTitleClick}" style="font-size:0.88em;font-weight:600;color:#495057;white-space:nowrap;cursor:pointer;text-decoration:underline;text-underline-offset:2px;">${BB.t('journal.ui.goalProgress')}</span>
              <div style="display:flex;gap:6px;">${_btns([
                  {label:'❌<br>No',  color:'var(--brand-primary)', sel:selectedGoals==='none', set:"selectedGoals='none';_fmCheckMoreData()"},
                  {label:'✅<br>On track', color:'var(--brand-primary)', sel:selectedGoals==='some', set:"selectedGoals='some';_fmCheckMoreData()"},
                ])}</div>
              ${_goalsNoteHtml}
              <div id="fmGoalsDetail" style="grid-column:1/-1;display:none;">${_goalsDetail}</div>`;
            } else if (ex.id === 'anxiety') {
              _md += _ilr('😰 Anxiety', [
                {label:'😰<br>More',   color:'var(--brand-primary)', sel:selectedAnxiety==='high',   set:"selectedAnxiety='high';_fmCheckMoreData()"},
                {label:'😐<br>Normal', color:'var(--brand-primary)', sel:selectedAnxiety==='medium', set:"selectedAnxiety='medium';_fmCheckMoreData()"},
                {label:'😌<br>Less',   color:'var(--brand-primary)', sel:selectedAnxiety==='low',    set:"selectedAnxiety='low';_fmCheckMoreData()"},
              ]);
              _md += _ilr('😓 Stress', [
                {label:'😰<br>More',   color:'var(--brand-primary)', sel:selectedStress==='high',   set:"selectedStress='high';_fmCheckMoreData()"},
                {label:'😐<br>Normal', color:'var(--brand-primary)', sel:selectedStress==='medium', set:"selectedStress='medium';_fmCheckMoreData()"},
                {label:'😌<br>Less',   color:'var(--brand-primary)', sel:selectedStress==='low',    set:"selectedStress='low';_fmCheckMoreData()"},
              ]);
              _md += _ilr('😤 Irritability', [
                {label:'😤<br>More',   color:'var(--brand-primary)', sel:selectedIrritability==='yes',    set:"selectedIrritability='yes';_fmCheckMoreData()"},
                {label:'😐<br>Normal', color:'var(--brand-primary)', sel:selectedIrritability==='medium', set:"selectedIrritability='medium';_fmCheckMoreData()"},
                {label:'😌<br>Less',   color:'var(--brand-primary)', sel:selectedIrritability==='no',     set:"selectedIrritability='no';_fmCheckMoreData()"},
              ]);
            } else if (ex.id === 'exercise') {
              _md += _ilr('🏋️ Exercise', [
                {label:'🛋️<br>No',  color:'var(--brand-primary)', sel:selectedExercise==='no',  set:"selectedExercise='no';_fmCheckMoreData()"},
                {label:'🏋️<br>Yes', color:'var(--brand-primary)', sel:selectedExercise==='yes', set:"selectedExercise='yes';_fmCheckMoreData()"},
              ]);
            } else if (ex.id === 'outside') {
              const _outsideNoteVal = selectedStepNotes['outside'] || '';
              const _outsideNoteHtml = localStorage.getItem('elaborateResponsesEnabled') === 'true' && selectedOutside === 'no'
                ? `<div style="grid-column:1/-1;margin-bottom:4px;"><input type="text" id="fmOutsideNoteInput" placeholder="${BB.t('journal.placeholder.moreDetails')}" value="${_outsideNoteVal.replace(/"/g,'&quot;')}" style="width:100%;border:1.5px solid #e9ecef;border-radius:10px;padding:6px 10px;font-size:0.85em;font-family:inherit;box-sizing:border-box;outline:none;" oninput="selectedStepNotes['outside']=this.value;saveDraft();"></div>`
                : '';
              _md += `<span style="font-size:0.88em;font-weight:600;color:#495057;white-space:nowrap;">${BB.t('journal.ui.outside')}</span>
              <div style="display:flex;gap:6px;">${_btns([
                  {label:'🏠<br>No',  color:'var(--brand-primary)', sel:selectedOutside==='no',  set:"selectedOutside='no';_fmCheckMoreData()"},
                  {label:'🌤️<br>Yes', color:'var(--brand-primary)', sel:selectedOutside==='yes', set:"selectedOutside='yes';_fmCheckMoreData()"},
                ])}</div>
              ${_outsideNoteHtml}`;
            } else if (ex.id === 'alcohol') {
              const _alcoholNoteVal = selectedStepNotes['alcohol'] || '';
              const _alcoholNoteHtml = localStorage.getItem('elaborateResponsesEnabled') === 'true' && selectedAlcohol === 'yes'
                ? `<div style="grid-column:1/-1;margin-bottom:4px;"><input type="text" id="fmAlcoholNoteInput" placeholder="${BB.t('journal.placeholder.howMuch')}" value="${_alcoholNoteVal.replace(/"/g,'&quot;')}" style="width:100%;border:1.5px solid #e9ecef;border-radius:10px;padding:6px 10px;font-size:0.85em;font-family:inherit;box-sizing:border-box;outline:none;" oninput="selectedStepNotes['alcohol']=this.value;saveDraft();"></div>`
                : '';
              _md += `<span style="font-size:0.88em;font-weight:600;color:#495057;white-space:nowrap;">${_getBuiltinFieldLabel('trackAlcohol','🍺 Alcohol')}</span>
              <div style="display:flex;gap:6px;">${_btns([
                  {label:'🍺<br>Yes', color:'var(--brand-primary)', sel:selectedAlcohol==='yes', set:"selectedAlcohol='yes';_fmCheckMoreData()"},
                  {label:'✅<br>No',  color:'var(--brand-primary)', sel:selectedAlcohol==='no',  set:"selectedAlcohol='no';_fmCheckMoreData()"},
                ])}</div>
              ${_alcoholNoteHtml}`;
            } else if (ex.id === 'budget') {
              const _bv = localStorage.getItem('dailyBudget') || '';
              const _budgetDetail = _bv
                ? `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--brand-tint);border-radius:10px;border:1.5px solid rgba(255,149,0,0.3);"><span style="font-size:0.85em;color:#495057;">💰 Daily budget: <b>${_bv}</b></span><button onclick="showBudgetModal()" style="padding:3px 10px;background:var(--brand-btn);color:white;border:none;border-radius:7px;font-size:0.78em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('common.change')}</button></div>`
                : `<button onclick="showBudgetModal()" style="padding:7px 16px;background:rgba(255,149,0,0.08);border:2px solid rgba(255,149,0,0.35);border-radius:10px;color:var(--brand-primary);font-weight:600;font-size:0.85em;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('journal.btn.setDailyBudget')}</button>`;
              const _budgetTitleClick = _bv
                ? "var el=document.getElementById('fmBudgetDetail');el.style.display=el.style.display==='none'?'':'none';"
                : "showBudgetModal()";
              const _budgetNoteVal = selectedStepNotes['budget'] || '';
              const _budgetNoteHtml = localStorage.getItem('elaborateResponsesEnabled') === 'true' && selectedBudget === 'no'
                ? `<div style="grid-column:1/-1;margin-bottom:4px;"><input type="text" id="fmBudgetNoteInput" placeholder="${BB.t('journal.placeholder.budgetNote')}" value="${_budgetNoteVal.replace(/"/g,'&quot;')}" style="width:100%;border:1.5px solid #e9ecef;border-radius:10px;padding:6px 10px;font-size:0.85em;font-family:inherit;box-sizing:border-box;outline:none;" oninput="selectedStepNotes['budget']=this.value;saveDraft();"></div>`
                : '';
              _md += `<span onclick="${_budgetTitleClick}" style="font-size:0.88em;font-weight:600;color:#495057;white-space:nowrap;cursor:pointer;text-decoration:underline;text-underline-offset:2px;">${BB.t('journal.ui.budgetOnTrack')}</span>
              <div style="display:flex;gap:6px;">${_btns([
                  {label:'❌<br>Over',     color:'var(--brand-primary)', sel:selectedBudget==='no',  set:"selectedBudget='no';_fmCheckMoreData()"},
                  {label:'✅<br>On track', color:'var(--brand-primary)', sel:selectedBudget==='yes', set:"selectedBudget='yes';_fmCheckMoreData()"},
                ])}</div>
              ${_budgetNoteHtml}
              <div id="fmBudgetDetail" style="grid-column:1/-1;display:none;">${_budgetDetail}</div>`;
            }
          }
          for (const f of _custFields) {
            const _fPosNo = f.positive === 'no';
            const _noOpt  = {label:`${_fPosNo?'✅':'✗'}<br>No`,               color:'var(--brand-primary)',  sel:selectedCustom[f.id]==='no',  set:`selectedCustom['${f.id}']='no';_fmCheckMoreData()`};
            const _yesOpt = {label:`${_fPosNo&&f.emoji?f.emoji:'✅'}<br>Yes`, color:_fPosNo?'#dc3545':'var(--brand-primary)', sel:selectedCustom[f.id]==='yes', set:`selectedCustom['${f.id}']='yes';_fmCheckMoreData()`};
            _STEP_NOTE_LABELS[f.id] = `${f.emoji||''} ${f.label}`.trim();
            const _cfNegSel = _fPosNo ? selectedCustom[f.id]==='yes' : selectedCustom[f.id]==='no';
            const _cfNoteVal = selectedStepNotes[f.id] || '';
            const _cfNoteHtml = localStorage.getItem('elaborateResponsesEnabled') === 'true' && _cfNegSel
              ? `<div style="grid-column:1/-1;margin-bottom:4px;"><input type="text" placeholder="${BB.t('journal.placeholder.moreDetails')}" value="${_cfNoteVal.replace(/"/g,'&quot;')}" style="width:100%;border:1.5px solid #e9ecef;border-radius:10px;padding:6px 10px;font-size:0.85em;font-family:inherit;box-sizing:border-box;outline:none;" oninput="selectedStepNotes['${f.id}']=this.value;saveDraft();"></div>`
              : '';
            _md += `<span style="font-size:0.88em;font-weight:600;color:#495057;white-space:nowrap;">${f.emoji||'📝'} ${f.label}</span>
            <div style="display:flex;gap:6px;">${_btns(_fPosNo ? [_yesOpt, _noOpt] : [_noOpt, _yesOpt])}</div>
            ${_cfNoteHtml}`;
          }
          const _showCfHint = !BB.storage.get('CustomFieldHintDone');
          const _cfHintHtml = _showCfHint
            ? `<div id="fmCustomFieldHint" style="display:flex;flex-direction:column;align-items:center;pointer-events:none;animation:hintFade 2.4s ease-in-out infinite;margin-top:6px;">
                <span style="font-size:0.72em;font-weight:700;font-style:italic;color:rgba(255,149,0,0.9);white-space:nowrap;font-family:'Georgia',serif;">${BB.t('journal.ui.customiseFields')}</span>
                <svg width="24" height="22" viewBox="0 0 24 22" fill="none">
                  <path d="M12,2 Q8,12 12,20" stroke="rgba(255,149,0,0.7)" stroke-width="2" stroke-linecap="round" fill="none"/>
                  <polyline points="7,16 12,21 17,16" stroke="rgba(255,149,0,0.7)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                </svg>
              </div>` : '';
          if (!_builtIn.length && !_custFields.length)
            return `<p style="text-align:center;color:#6c757d;font-size:0.9em;margin:0 0 16px;">${BB.t('journal.ui.wouldYouTrack')}</p>
              <div style="text-align:center;margin-bottom:12px;">
                ${_cfHintHtml}
                <button onclick="showFieldPicker()" style="padding:10px 22px;background:rgba(255,149,0,0.08);border:2px dashed var(--brand-primary);border-radius:12px;color:var(--brand-primary);font-size:0.9em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('journal.ui.addTrackingFields')}</button>
              </div>`;
          return `<div style="display:grid;grid-template-columns:min-content 1fr;gap:8px 10px;align-items:center;">${_md}</div>
            <div style="display:flex;flex-direction:column;align-items:center;margin-top:10px;">
              ${_cfHintHtml}
              <button onclick="showFieldPicker()" style="width:36px;height:36px;min-width:36px;min-height:36px;flex-shrink:0;border-radius:50%;background:rgba(255,149,0,0.08);color:var(--brand-primary);font-size:1.3em;border:2px dashed var(--brand-primary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;line-height:1;-webkit-tap-highlight-color:transparent;box-sizing:border-box;">+</button>
            </div>`;
        }

        case 'notes': {
          const _notesInitVal = (document.getElementById('notes')||{}).value||'';
          const _initWords = _notesInitVal.trim() ? _notesInitVal.trim().split(/\s+/).length : 0;
          return `<div class="fm-hero">
              <div class="fm-hero-emoji-wrap">${_fmSparksHtml()}
                <div class="fm-hero-emoji${_notesInitVal.trim() ? '' : ' ghost'}" id="fmHeroEmoji">📝</div>
              </div>
            </div>
            <textarea id="fmNotesInput" placeholder="${BB.t('journal.placeholder.notes')}"
            style="width:100%;min-height:130px;border:2px solid #e9ecef;border-radius:12px;padding:12px;
            font-size:0.95em;font-family:inherit;resize:none;box-sizing:border-box;outline:none;transition:border-color 0.15s;"
            oninput="_fmNotesInput(this)">${_notesInitVal}</textarea>
            <div id="fmWordCount" style="text-align:right;font-size:0.8em;color:#6c757d;margin-top:5px;">✍️ ${_initWords} word${_initWords===1?'':'s'}</div>
            ${localStorage.getItem('intentionEnabled') === 'true' ? `<details style="margin-top:14px;" ${selectedIntention ? 'open' : ''}>
              <summary style="font-size:0.85em;font-weight:600;color:#495057;cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px;-webkit-tap-highlight-color:transparent;padding:2px 0;">
                <span style="font-size:0.75em;color:#adb5bd;transition:transform 0.2s;" class="bb-int-chev">▶</span>
                ${BB.t('journal.intentionLabel')}
              </summary>
              <textarea id="fmIntentionInput" placeholder="${BB.t('journal.placeholder.intention')}"
                style="width:100%;height:68px;border:2px solid #e9ecef;border-radius:12px;padding:12px;margin-top:8px;
                font-size:0.95em;font-family:inherit;resize:none;box-sizing:border-box;outline:none;transition:border-color 0.15s;"
                oninput="this.style.borderColor='var(--brand-primary)'">${selectedIntention||''}</textarea>
            </details>` : ''}
            <button class="fm-notes-next" onclick="_fmNext()">${BB.t('common.next')} →</button>`;
        }

        case 'done': {
          if (!_hasMood()) return `<p style="text-align:center;color:#dc3545;font-size:0.9em;">${BB.t('journal.selectMoodFirst')}</p>`;
          const mc = _FM_MOOD_COLORS[_moodCat(selectedMood)]||'var(--brand-primary)';
          // The lookups cover the five coarse buckets; full spectrum values (e.g.
          // energy 4, sleep 7h) fall through to the banded meta so the review row
          // still reads "🪫 Less than usual" / "7h" rather than a bare number.
          const eLabel = {0:BB.t('journal.energy.notEnough'),3:BB.t('journal.energy.less'),5:BB.t('journal.energy.normal'),7:BB.t('journal.energy.more'),10:BB.t('journal.energy.tooMuch')}[selectedEnergy]
            || (selectedEnergy != null ? `${_fmEnergyMeta(selectedEnergy).emoji} ${_fmEnergyMeta(selectedEnergy).label}` : selectedEnergy);
          const sLabel = {5:'≤5h',6.5:'6–7h',8:'7–9h',9.5:'9–10h',11:'10+h'}[selectedSleep]
            || (selectedSleep != null ? _fmSleepMeta(selectedSleep).label : selectedSleep + 'h');
          const notesVal = (document.getElementById('fmNotesInput')||document.getElementById('notes')||{}).value||'';
          const intentionVal = (document.getElementById('fmIntentionInput')||{}).value ?? selectedIntention;
          const _elabOn = localStorage.getItem('elaborateResponsesEnabled') === 'true';
          const _sn = k => (_elabOn && selectedStepNotes[k] && selectedStepNotes[k].trim()) ? selectedStepNotes[k].trim() : null;
          const _doneStepsVal = (() => {
            if (editingEntry && editingEntry.steps != null) return editingEntry.steps;
            if (window._healthStepsByDate) {
              try {
                const _dv = document.getElementById('entryDate')?.value;
                if (_dv && window._healthStepsByDate[_dv] != null) return window._healthStepsByDate[_dv];
              } catch(_) {}
            }
            return null;
          })();
          const _doneStepsStr = _doneStepsVal != null ? ` · 🏃 ${_doneStepsVal >= 1000 ? Math.round(_doneStepsVal/1000)+'k' : _doneStepsVal}` : '';
          const rows = [
            // Mood is shown as the big bear hero above, not as a list row.
            // Sleep first — mirrors the ask order of the steps.
            selectedSleep != null
              ? { text:`${BB.t('journal.ui.sleepLabel')} ${sLabel}${selectedSleepQuality ? ` · ${selectedSleepQuality === 'good' ? BB.t('journal.ui.sleepGood') : selectedSleepQuality === 'unsure' ? BB.t('journal.ui.sleepOk') : BB.t('journal.ui.sleepBad')}` : ''}`, step:'sleep', note:_sn('sleep') }
              : { text:`<span style="color:#adb5bd;">${BB.t('journal.ui.sleepLabel')} —</span>`, step:'sleep' },
            _fmEnergyClear
              ? { text:`<span style="color:#adb5bd;">${BB.t('journal.ui.energyLabel')} —</span>`, step:'energy' }
              : { text:`${BB.t('journal.ui.energyLabel')} ${eLabel}${_doneStepsStr}`, step:'energy', note:_sn('energy') },
            selectedMedication
              ? { text:selectedMedication==='taken'?BB.t('journal.ui.medTaken'):selectedMedication==='unsure'?BB.t('journal.ui.medUnsure'):BB.t('journal.ui.medNotTaken'), step:'medication', note:_sn('medication') }
              : { text:`<span style="color:#adb5bd;">${BB.t('journal.ui.medicationLabel')} —</span>`, step:'medication' },
            (()=>{
              const _G='#2ECC40',_R='#FF4136',_N='#adb5bd';
              const _tc = (k) => (window.BB && BB.t) ? BB.t(k) : k;
              const _yes = _tc('journal.value.yes'), _no = _tc('journal.value.no');
              const _more = _tc('journal.chip.more'), _normal = _tc('journal.chip.normal'), _less = _tc('journal.chip.less');
              const _chips=[];
              if(selectedGoals)        _chips.push([`🏅 ${selectedGoals==='some'?_yes:_no}`, selectedGoals==='some'?_G:_R]);
              if(selectedBudget)       _chips.push([`💰 ${selectedBudget==='yes'?_yes:_no}`, selectedBudget==='yes'?_G:_R]);
              if(selectedExercise)     _chips.push([`🏋️ ${selectedExercise==='yes'?_yes:_no}`, selectedExercise==='yes'?_G:_R]);
              if(selectedOutside)      _chips.push([`🌤️ ${selectedOutside==='yes'?_yes:_no}`, selectedOutside==='yes'?_G:_R]);
              if(selectedAnxiety)      _chips.push([`😰 ${selectedAnxiety==='high'?_more:selectedAnxiety==='medium'?_normal:_less}`, selectedAnxiety==='low'?_G:selectedAnxiety==='medium'?_N:_R]);
              if(selectedStress)       _chips.push([`😓 ${selectedStress==='high'?_more:selectedStress==='medium'?_normal:_less}`, selectedStress==='low'?_G:selectedStress==='medium'?_N:_R]);
              if(selectedIrritability) _chips.push([`😤 ${selectedIrritability==='yes'?_more:selectedIrritability==='medium'?_normal:_less}`, selectedIrritability==='no'?_G:selectedIrritability==='medium'?_N:_R]);
              if(selectedAlcohol)      _chips.push([`🍺 ${selectedAlcohol==='yes'?_yes:_no}`, selectedAlcohol==='no'?_G:_R]);
              getCustomFields().filter(f=>selectedCustom[f.id]).forEach(f=>{const _cv=selectedCustom[f.id];const _cc=f.positive==='no'?(_cv==='yes'?_R:_G):_N;_chips.push([`${f.emoji||'•'} ${_cv==='yes'?_yes:_no}`,_cc]);});
              const _html=_chips.map(([t,c])=>`<span style="color:${c};font-weight:600">${t}</span>`).join('<span style="color:#dee2e6">  </span>');
              const _mdNoteKeys = ['goals','budget','exercise','outside','anxiety','stress','irritability','alcohol',...getCustomFields().map(f=>f.id)];
              const _mdNotes = _elabOn ? _mdNoteKeys.map(k=>_sn(k)?`${_STEP_NOTE_LABELS[k]||k}: ${_sn(k)}`:null).filter(Boolean).join(' · ') : null;
              return _chips.length ? {text:_html, step:'more_data', note:_mdNotes||null} : null;
            })(),
            notesVal.trim() ? { text:`📝 ${notesVal.trim()}`, step:'notes', wrap:true } : null,
            intentionVal && intentionVal.trim() ? { text:`🌅 ${intentionVal.trim()}`, step:'notes', wrap:true } : null,
          ].filter(Boolean);
          const _est = _estimateMoodState();
          const _estColor  = _FM_MOOD_COLORS[_est.mood] || 'var(--brand-primary)';
          const _estLabel  = _FM_MOOD_LABELS[_est.mood];
          const _est2Color = _est.secondMood ? (_FM_MOOD_COLORS[_est.secondMood] || 'var(--brand-primary)') : null;
          const _est2Label = _est.secondMood ? _FM_MOOD_LABELS[_est.secondMood] : null;
          const _mkMoodBtn = (m, lbl, col) => {
            if (!m) return '';
            if (_fmPrevMood && selectedMood === m) return `<button onclick="_fmUndoSuggestedMood()" style="padding:4px 10px;background:#6c757d;color:white;border:none;border-radius:8px;font-size:0.78em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('journal.ui.undo')}</button>`;
            if (selectedMood !== m) return `<button onclick="_fmApplySuggestedMood('${m}')" style="padding:4px 10px;background:${col};color:white;border:none;border-radius:8px;font-size:0.78em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">Use ${lbl}</button>`;
            return '';
          };
          const _suggestion = (localStorage.getItem('showMoodSuggestion') !== '1' || _spectrumEnabled()) ? '' : `
            <div style="margin-top:12px;border-radius:12px;border:1px solid rgba(255,149,0,0.2);overflow:hidden;">
              <div style="display:flex;align-items:center;background:rgba(255,149,0,0.06);">
                <button onclick="var p=this.parentElement.nextElementSibling;p.style.display=p.style.display==='none'?'block':'none';this.querySelector('.bb-chev').style.transform=p.style.display==='none'?'rotate(0deg)':'rotate(180deg)';"
                  style="flex:1;padding:11px 14px;background:none;border:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;-webkit-tap-highlight-color:transparent;">
                  <span style="font-size:0.88em;color:#6c757d;font-weight:500;">${BB.t('journal.ui.bbThinksMightBe')}</span>
                  <button onclick="document.getElementById('moodCalcInfoModal').classList.add('active')" style="background:none;border:none;color:#adb5bd;font-size:0.82em;cursor:pointer;padding:0 4px;-webkit-tap-highlight-color:transparent;line-height:1;flex-shrink:0;" title="${BB.t('journal.ui.howCalculated')}">ℹ️</button>
                  <span class="bb-chev" style="font-size:0.7em;color:#adb5bd;transition:transform 0.2s;margin-left:6px;">▼</span>
                </button>
                <button onclick="document.getElementById('hideSuggestionModal').classList.add('active')"
                  style="padding:8px 12px;background:none;border:none;color:#adb5bd;font-size:1em;cursor:pointer;-webkit-tap-highlight-color:transparent;line-height:1;">✕</button>
              </div>
              <div style="display:none;padding:10px 14px 12px;background:rgba(255,149,0,0.06);">
                <div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                  <span style="font-weight:700;font-size:1em;color:${_estColor};">${_estLabel}</span>
                  ${_mkMoodBtn(_est.mood, _estLabel, _estColor)}
                  ${_est.secondMood ? `<span style="font-size:0.82em;color:#adb5bd;">or</span><span style="font-weight:700;font-size:1em;color:${_est2Color};">${_est2Label}</span>${_mkMoodBtn(_est.secondMood, _est2Label, _est2Color)}` : ''}
                </div>
                <div style="font-size:0.72em;color:#adb5bd;line-height:1.4;">${BB.t('journal.ui.experimentalFeedback2')}</div>
              </div>
            </div>`;
          const _incogOn = localStorage.getItem('incognitoMode') === 'true';
          const _privBorder = selectedPdfHide ? 'border:1.5px solid var(--brand-primary);' : 'border:1.5px solid #e9ecef;';
          const _privRow = _incogOn ? `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding:10px 14px;background:#f8f9fa;border-radius:12px;${_privBorder}">
              <span style="font-size:0.88em;color:#6c757d;">${BB.t('journal.ui.hideFromPdf')}</span>
              <label class="bb-switch" style="margin:0;"><input type="checkbox" ${selectedPdfHide?'checked':''} onchange="_fmTogglePdfHide()"><span class="bb-slider"></span></label>
            </div>` : '';
          const _doneDate = (() => { try { const _dv = document.getElementById('entryDate')?.value; if (!_dv) return ''; const _dd = new Date(_dv+'T00:00:00'); return _dd.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'}); } catch(_){return '';} })();
          // Auto-filled from Health and untouched since: say so here, where the
          // user is looking at the values just before saving them.
          const _dayFillNote = _fmDayFillIntact()
            ? `<div style="background:var(--brand-tint,#fff6ec);border:1px solid rgba(255,149,0,0.3);border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:0.82em;color:#6c757d;line-height:1.45;text-align:left;">${BB.t('journal.autofill.dayReview')}</div>`
            : '';
          // Bear hero: the chosen mood shown big, instead of as a summary row.
          const _linkedHero = selectedLinkedMood ? ` <span style="color:#adb5bd;font-weight:600;">/</span> <img src="images/moods/${selectedLinkedMood}.png" style="width:34px;height:34px;object-fit:contain;vertical-align:middle;opacity:0.9;"> ${cap(selectedLinkedMood)}` : '';
          const _doneAura = _FM_AURAS[_moodCat(selectedMood)] || '';
          const _heroHtml = `<div class="fm-hero">
              <div class="fm-hero-emoji-wrap">${_fmSparksHtml()}<div class="fm-aura" data-type="${_doneAura}">${_AURA_HTML[_doneAura] || ''}</div>
                <div class="fm-hero-emoji"><img src="${_moodImg(selectedMood)}" alt=""></div>
              </div>
              <div class="fm-hero-value" style="color:${mc};">${_moodLabelNum(selectedMood)}${_linkedHero}</div>
            </div>`;
          // Delete + Save styled as wheel pills, sitting in the wheel slot.
          const _noChanges = editingEntry && !_hasEditChanges();
          const _delLabel = editingEntry ? BB.t('journal.fm.doneDelete') : BB.t('journal.fm.doneClear');
          const _saveLabel = _noChanges ? BB.t('journal.fm.doneClose') : (editingEntry ? BB.t('journal.fm.doneUpdate') : BB.t('journal.fm.doneSave'));
          const _saveEmoji = _noChanges ? '✓' : '💾';
          const _actions = _noActions ? '' : `<div class="fm-done-actions">
              <button type="button" class="fm-wheel-btn fm-done-del" onclick="_fmDoneDelete()">
                <span class="fm-wheel-emoji">🗑️</span><span class="fm-wheel-label">${_delLabel}</span>
              </button>
              <button type="button" class="fm-wheel-btn fm-done-save${_noChanges ? ' grey' : ''}" onclick="_fmNext()">
                <span class="fm-wheel-emoji">${_saveEmoji}</span><span class="fm-wheel-label">${_saveLabel}</span>
              </button>
            </div>`;
          return `${_heroHtml}${_doneDate ? `<div style="text-align:center;font-size:0.92em;color:#6c757d;margin-bottom:10px;">📅 ${_doneDate}</div>` : ''}${_dayFillNote}<div class="fm-done-list" style="display:block;background:#f8f9fa;border-radius:14px;padding:16px;border-left:4px solid ${mc};max-width:100%;text-align:left;">
            ${rows.map(r=>{const idx=_fmSteps.findIndex(s=>s.id===r.step);const editBtn=idx>=0?`<button onclick="_fmReturnToDone=true;_fmGoTo(${idx})" style="background:none;border:none;color:#6c757d;font-size:0.82em;cursor:pointer;padding:2px 4px;-webkit-tap-highlight-color:transparent;flex-shrink:0;" title="${BB.t('journal.ui.editTitle')}">✏️</button>`:'';if(r.note){return `<details style="padding:3px 0;"><summary style="display:flex;align-items:center;flex-wrap:nowrap;gap:6px;font-size:0.9em;color:#495057;min-width:0;cursor:pointer;list-style:none;-webkit-tap-highlight-color:transparent;">${r.wrap?`<span style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;word-break:break-word;flex:1;">${r.text}</span>`:`<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">${r.text}</span>`}${editBtn}<span style="font-size:0.65em;color:#adb5bd;flex-shrink:0;margin-left:2px;transition:transform 0.15s;" class="bb-note-chev">▶</span></summary><div style="font-size:0.82em;color:#495057;padding:5px 0 3px 12px;font-style:italic;word-break:break-word;line-height:1.4;">📝 ${r.note}</div></details>`;}return r.wrap?`<div style="padding:3px 0;"><div style="display:flex;align-items:center;gap:8px;font-size:0.9em;color:#495057;"><span style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;word-break:break-word;flex:1;">${r.text}</span>${editBtn}</div></div>`:`<div style="padding:3px 0;"><div style="display:flex;align-items:center;flex-wrap:nowrap;gap:6px;font-size:0.9em;color:#495057;min-width:0;"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">${r.text}</span>${editBtn}</div></div>`;}).join('')}
          </div>${_privRow}${_suggestion}${_actions}`;
        }

        default:
          if (step.customField) {
            const f = step.customField;
            const cur = selectedCustom[f.id]||null;
            return [
              {val:'no',  label:'❌ No',  color:'#6c757d'},
              {val:'yes', label:'✅ Yes', color:'#2ECC40'},
            ].map((o,i) => `<button class="fm-opt ${cur===o.val?'sel':''}"
              onclick="selectedCustom['${f.id}']='${o.val}'; _fmAdvance();"
              style="border-left:4px solid ${o.color};${i>0?'margin-top:8px;':''}">
              <span>${o.label}</span></button>`).join('');
          }
          return '';
      }
    }

    function _fmRefreshSleep() {
      _fmSleepClear = false;
      document.querySelectorAll('#fmContent .fm-opt').forEach(b => {
        const onclk = b.getAttribute('onclick')||'';
        const m = onclk.match(/selectedSleep=([0-9.]+)/);
        if (m) b.classList.toggle('sel', parseFloat(m[1]) === selectedSleep);
      });
    }

    // The wheel's centred slot on the current step, shown live in that step's
    // chip while spinning (James, 30 Sep 2026: "on mood when the wheel is on
    // stable show it as stable and when on low show low"). A preview only —
    // nothing is committed until the pill is tapped, exactly as before.
    let _fmChipPreview = null; // { idx, val }
    function _fmSetChipPreview(val) {
      const prev = _fmChipPreview;
      _fmChipPreview = { idx: _fmStepIndex, val: val };
      if (!prev || prev.idx !== _fmChipPreview.idx || prev.val !== val) _fmBuildSummaryBar();
    }
    // Placeholder glyphs for steps not reached yet, so the row shows the whole
    // check-in from the first page.
    const _FM_CHIP_ICONS = { mood: '🐻', sleep: '🛌', energy: '⚡', medication: '💊', notes: '📝', more_data: '➕' };

    function _fmBuildSummaryBar() {
      const bar = document.getElementById('fmSummaryBar');
      if (!bar) return;
      const chips = [];
      // Every step's chip from the first page on — reached steps as before,
      // later ones as a faint placeholder (not tappable: the check-in still
      // runs in order). The current step's chip follows the wheel live.
      const _pv = _fmChipPreview && _fmChipPreview.idx === _fmStepIndex ? _fmChipPreview.val : null;
      const _num = v => (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) ? Number(v) : v;
      const _saved = { selectedMood, selectedEnergy, selectedSleep, selectedMedication, _fmEnergyClear, _fmSleepClear };
      for (let i = 0; i < _fmSteps.length; i++) {
        const s = _fmSteps[i];
        if (!s || s.id === 'done') continue;
        const isCurrent = i === _fmStepIndex;
        if (i > _fmHighWater && !isCurrent) {
          const _ic = _FM_CHIP_ICONS[s.id];
          if (_ic) chips.push(`<span class="fm-chip-future" aria-hidden="true">${_ic}</span>`);
          continue;
        }
        if (isCurrent && _pv != null) {
          if (s.id === 'mood') selectedMood = _num(_pv);
          else if (s.id === 'energy') { selectedEnergy = _num(_pv); _fmEnergyClear = false; }
          else if (s.id === 'sleep') { selectedSleep = _num(_pv); _fmSleepClear = false; }
          else if (s.id === 'medication') selectedMedication = _pv;
        }
        let html = null, borderColor = '#dee2e6';
        if (s.id === 'mood' && selectedMood != null && selectedMood !== '') {
          const col = _FM_MOOD_COLORS[_moodCat(selectedMood)] || '#adb5bd';
          const lbl = _moodLabelNum(selectedMood);
          html = `<img src="${_moodImg(selectedMood)}" style="width:16px;height:16px;vertical-align:middle;margin-right:3px;">${lbl}`;
          borderColor = col;
        } else if (s.id === 'energy' && !_fmEnergyClear) {
          // Fall back to the banded meta for any value outside the five coarse
          // levels — full spectrum can pick e.g. 4, which has no _FM_ENERGY_LEVELS row.
          const lvl = _FM_ENERGY_LEVELS.find(l => l.val === selectedEnergy);
          if (lvl) { html = lvl.label.split(' ')[0]; borderColor = lvl.color; }
          else if (selectedEnergy != null) { const m = _fmEnergyMeta(selectedEnergy); html = m.emoji; borderColor = m.color; }
        } else if (s.id === 'sleep' && !_fmSleepClear) {
          const rng = _FM_SLEEP_RANGES.find(r => r.val === selectedSleep);
          const _sm = selectedSleep != null ? _fmSleepMeta(selectedSleep) : null;
          const hrsText = (_sleepHealthSynced && selectedSleep != null) ? `${selectedSleep}h` : (rng ? rng.label.replace(/^\S+\s*/, '') : (_sm ? _sm.label : null));
          const rngColor = rng ? rng.color : (_sm ? _sm.color : '#667eea');
          if (hrsText) {
            html = `<span style="display:flex;flex-direction:column;align-items:center;gap:1px;line-height:1.2;">🛌<span style="font-size:0.85em;">${hrsText}</span></span>`;
            borderColor = selectedSleepQuality === 'good' ? '#2ECC40' : selectedSleepQuality === 'bad' ? '#dc3545' : selectedSleepQuality === 'unsure' ? '#adb5bd' : rngColor;
          }
        } else if (s.id === 'sleepQuality') {
          // Absorbed into the sleep chip — skip showing a separate chip
          continue;
        } else if (s.id === 'medication' && selectedMedication) {
          html = selectedMedication === 'taken' ? '💊 ✅' : selectedMedication === 'unsure' ? '💊 🤷' : '💊 ❌';
          borderColor = selectedMedication === 'taken' ? '#2ECC40' : selectedMedication === 'unsure' ? '#adb5bd' : '#dc3545';
        } else if (s.id === 'more_data') {
          html = '➕'; borderColor = '#adb5bd';
        } else if (s.id === 'notes') {
          const notes = document.getElementById('notes')?.value || '';
          const words = notes.trim().split(/\s+/).filter(Boolean).length;
          html = words > 0 ? `📝 ${words}w` : '📝'; borderColor = '#adb5bd';
        }
        // For steps that were visited but not answered, show a blank dashed chip
        // so the user can see the gap and tap back to fill it in.
        if (isCurrent && _pv != null) {
          ({ selectedMood, selectedEnergy, selectedSleep, selectedMedication, _fmEnergyClear, _fmSleepClear } = _saved);
        }
        const _canBeBlank = ['mood','energy','sleep','medication'].includes(s.id);
        const _isBlank = html === null && _canBeBlank;
        if (_isBlank) { html = '—'; borderColor = '#dee2e6'; }
        if (html !== null) {
          const _chipBorder = _isBlank ? `1.5px dashed ${borderColor}` : (isCurrent ? `2px solid ${borderColor}` : `1.5px solid ${borderColor}`);
          const _chipColor = _isBlank ? '#adb5bd' : '#495057';
          if (isCurrent) {
            chips.push(`<span style="border:${_chipBorder};border-radius:20px;padding:3px 9px;font-size:0.72em;background:white;color:${_chipColor};display:inline-flex;align-items:center;opacity:1;">${html}</span>`);
          } else {
            chips.push(`<button onclick="_fmReturnToDone=true;_fmGoTo(${i})" style="border:${_chipBorder};border-radius:20px;padding:3px 9px;font-size:0.72em;cursor:pointer;background:white;color:${_chipColor};display:inline-flex;align-items:center;-webkit-tap-highlight-color:transparent;">${html}</button>`);
          }
        }
      }
      bar.style.display = chips.length ? 'flex' : 'none';
      bar.innerHTML = chips.join('');
    }

    function _fmStepIsAnswered(step) {
      switch (step.id) {
        case 'mood':         return _hasMood();
        case 'energy':       return !_fmEnergyClear;
        case 'sleep':        return !_fmSleepClear;
        case 'sleepQuality': return selectedSleepQuality !== null;
        case 'medication':   return selectedMedication !== null;
        case 'anxiety':      return selectedAnxiety !== null;
        case 'stress':       return selectedStress !== null;
        case 'irritability': return selectedIrritability !== null;
        case 'exercise':     return selectedExercise !== null;
        case 'outside':      return selectedOutside !== null;
        case 'alcohol':      return selectedAlcohol !== null;
        case 'budget':       return selectedBudget !== null;
        case 'goals':        return selectedGoals !== null;
        case 'more_data':    return true;
        case 'notes':        return true;
        default:
          if (step.id && step.id.startsWith('custom_')) {
            const _cid = step.id.replace(/^custom_/, '');
            return selectedCustom[_cid] !== null && selectedCustom[_cid] !== undefined;
          }
          return true;
      }
    }
    // When returning from a chip click, skip to first unanswered step (or done if all answered)
    function _fmNextTarget(fromIdx) {
      const _doneIdx = _fmSteps.length - 1;
      for (let _i = fromIdx + 1; _i < _doneIdx; _i++) {
        const _s = _fmSteps[_i];
        if (_s.id === 'sleepQuality' && !_fmWantsSleepQuality) continue;
        if (!_fmStepIsAnswered(_s)) return _i;
      }
      return _doneIdx;
    }

    function _fmAdvance() {
      scheduleDraftSave();
      // Confirm-step mode: for non-auto steps (notes, more_data, done), re-render to show
      // the current selection and wait for the explicit "Next →" button tap instead of
      // auto-advancing. Auto steps (mood, energy, sleep, etc.) always advance immediately —
      // tapping an option IS the user's confirmation on those steps.
      if (localStorage.getItem('fmConfirmStep') === 'true') {
        const _step = _fmSteps[_fmStepIndex];
        if (_step && !_step.auto) {
          // Only refresh the content area to show the selection — do NOT call the full _renderFocusedStep()
          // which would rebuild summary bar chips and other elements, causing navigation side-effects.
          const _el = document.getElementById('fmContent');
          if (_el) _el.innerHTML = _fmRenderContent(_step);
          _fmAppendStepNotes(_step);
          return;
        }
      }
      const _doneIdx = _fmSteps.length - 1;
      if (_fmReturnToDone && _fmStepIndex < _doneIdx) {
        const _curStep = _fmSteps[_fmStepIndex];
        // When editing sleep from summary bar, visit sleepQuality only if user long-pressed
        if (_curStep && _curStep.id === 'sleep' && _fmWantsSleepQuality) {
          const _sqIdx = _fmSteps.findIndex(s => s.id === 'sleepQuality');
          if (_sqIdx > _fmStepIndex) {
            // Leave _fmReturnToDone=true so after sleepQuality, _fmNextTarget returns to done
            setTimeout(() => _fmGoTo(_sqIdx), 180);
            return;
          }
        }
        _fmReturnToDone = false;
        setTimeout(() => _fmGoTo(_fmNextTarget(_fmStepIndex)), 180);
        return;
      }
      // Skip sleepQuality step unless user long-pressed a sleep range
      const _nextIdx = _fmStepIndex + 1;
      if (_fmSteps[_nextIdx] && _fmSteps[_nextIdx].id === 'sleepQuality' && !_fmWantsSleepQuality) {
        setTimeout(() => _fmGoTo(_nextIdx + 1), 180);
        return;
      }
      setTimeout(() => _fmGoTo(_nextIdx), 180);
    }
    function _fmBack()    { _fmReturnToDone = false; if (_fmStepIndex > 0) _fmGoTo(_fmStepIndex - 1); }
    function _fmSkip() {
      _fmReturnToDone = false;
      const _skipNext = _fmStepIndex + 1;
      if (_fmSteps[_skipNext] && _fmSteps[_skipNext].id === 'sleepQuality' && !_fmWantsSleepQuality) {
        _fmGoTo(_skipNext + 1);
      } else {
        _fmGoTo(_skipNext);
      }
    }
    function _fmGoToDone() { _fmReturnToDone = false; _fmGoTo(_fmSteps.length - 1); }

    // Rebuild _fmSteps to reflect current _fmExtraSelected (removes old extras, inserts fresh ones)
    function _syncExtraSteps() {
      const _builtInDefs = {
        anxiety:  [
          { id:'anxiety',      title:BB.t('journal.fm.anxietyTitle'),      subtitle:'', auto:true },
          { id:'stress',       title:BB.t('journal.fm.stressTitle'),       subtitle:'', auto:true },
          { id:'irritability', title:BB.t('journal.fm.irritabilityTitle'), subtitle:'', auto:true },
        ],
        exercise: [{ id:'exercise', title:BB.t('journal.fm.exerciseTitle'), subtitle:'', auto:true }],
        outside:  [{ id:'outside',  title:BB.t('journal.fm.outsideTitle'),  subtitle:'', auto:true }],
        alcohol:  [{ id:'alcohol',  title:BB.t('journal.fm.alcoholTitle'),  subtitle:'', auto:true }],
        budget:   [{ id:'budget',   title:BB.t('journal.fm.budgetTitle'),   subtitle:'', auto:true }],
      };
      // Strip any previously-inserted extras (between more_data and notes)
      const moreIdx  = _fmSteps.findIndex(s => s.id === 'more_data');
      const notesIdx = _fmSteps.findIndex(s => s.id === 'notes');
      if (moreIdx !== -1 && notesIdx > moreIdx + 1) _fmSteps.splice(moreIdx + 1, notesIdx - moreIdx - 1);
      // Insert freshly selected extras before notes
      const toInsert = [];
      _fmExtraSelected.forEach(extraId => {
        if (_builtInDefs[extraId]) {
          toInsert.push(..._builtInDefs[extraId]);
        } else if (extraId.startsWith('custom_')) {
          try {
            const fid = extraId.slice(7);
            const cf = JSON.parse(localStorage.getItem('customTrackingFields') || '[]').find(f => f.id === fid);
            if (cf) toInsert.push({ id: extraId, title: `${cf.emoji || '📝'} ${cf.label}`, subtitle: '', auto: true, customField: cf });
          } catch(e) {}
        }
      });
      if (toInsert.length) {
        const newNotesIdx = _fmSteps.findIndex(s => s.id === 'notes');
        _fmSteps.splice(newNotesIdx, 0, ...toInsert);
      }
    }

    function _fmToggleExtra(id) {
      if (_fmExtraSelected.has(id)) _fmExtraSelected.delete(id);
      else _fmExtraSelected.add(id);
      _syncExtraSteps(); // rebuild steps so page count updates live
      _renderFocusedStep();
    }
    window._fmToggleExtra = _fmToggleExtra;

    // Called after each inline more_data answer: re-render and auto-advance when all done
    function _fmCheckMoreData() {
      _renderFocusedStep();
      const step = _fmSteps[_fmStepIndex];
      if (!step || step.id !== 'more_data') return;
      const _builtIn = step.extras || [];
      const _alreadyInSteps = new Set(_fmSteps.map(s => s.id));
      let _done = true;
      for (const ex of _builtIn) {
        if (ex.id === 'goals') {
          if (!selectedGoals)     { _done = false; break; }
        } else if (ex.id === 'anxiety') {
          if (!selectedAnxiety || !selectedStress || !selectedIrritability) { _done = false; break; }
        } else if (ex.id === 'exercise') {
          if (!selectedExercise)  { _done = false; break; }
        } else if (ex.id === 'outside') {
          if (!selectedOutside)   { _done = false; break; }
        } else if (ex.id === 'alcohol') {
          if (!selectedAlcohol)   { _done = false; break; }
        } else if (ex.id === 'budget') {
          if (!selectedBudget)    { _done = false; break; }
        }
      }
      if (_done) {
        try {
          JSON.parse(localStorage.getItem('customTrackingFields') || '[]').forEach(f => {
            if (!_alreadyInSteps.has(`custom_${f.id}`) && _fmIsTracking(`trackCustom_${f.id}`) && !selectedCustom[f.id]) _done = false;
          });
        } catch(e) {}
      }
      const _elaborateOn = localStorage.getItem('elaborateResponsesEnabled') === 'true';
      const _custNoteOpen = _elaborateOn && getCustomFields().some(f => {
        const _neg = f.positive === 'no' ? selectedCustom[f.id]==='yes' : selectedCustom[f.id]==='no';
        return _neg;
      });
      const _noteOpen = (_elaborateOn && selectedBudget === 'no') || (_elaborateOn && selectedGoals === 'none') || (_elaborateOn && selectedAlcohol === 'yes') || (_elaborateOn && selectedOutside === 'no') || _custNoteOpen;
      if (_done && !_noteOpen && localStorage.getItem('fmConfirmStep') !== 'true') {
        const _mdIdx = _fmStepIndex;
        const _doneIdx = _fmSteps.length - 1;
        setTimeout(() => {
          if (_fmStepIndex === _mdIdx) {
            if (_fmReturnToDone && _fmStepIndex < _doneIdx) {
              _fmReturnToDone = false;
              _fmGoTo(_fmNextTarget(_fmStepIndex));
            } else {
              _fmGoTo(_fmStepIndex + 1);
            }
          }
        }, 350);
      }
    }
    window._fmCheckMoreData = _fmCheckMoreData;

    let _fmPrevMood = null;
    let _fmSuppressReopen = false;
    let _fmReturnToDone   = false;
    function _fmApplySuggestedMood(mood) {
      _fmPrevMood = selectedMood;
      selectedMood = mood;
      _renderFocusedStep();
      _fmOpenSuggestionPanel();
    }
    function _fmUndoSuggestedMood() {
      selectedMood = _fmPrevMood;
      _fmPrevMood = null;
      _renderFocusedStep();
      _fmOpenSuggestionPanel();
    }
    function _fmOpenSuggestionPanel() {
      const card = document.getElementById('focusedModeCard');
      if (!card) return;
      const panels = card.querySelectorAll('#fmContent .bb-chev');
      panels.forEach(chev => {
        const body = chev.closest('button').parentElement.nextElementSibling;
        if (body) { body.style.display = 'block'; chev.style.transform = 'rotate(180deg)'; }
      });
    }
    window._fmApplySuggestedMood = _fmApplySuggestedMood;
    window._fmUndoSuggestedMood = _fmUndoSuggestedMood;

    function _fmDoneDelete() {
      if (editingEntry) {
        deleteEditingEntry(); // opens confirm modal; cleanup happens in confirmDelete
      } else {
        clearDraftWithConfirm(); // shows confirmation before clearing
      }
    }
    window._fmDoneDelete = _fmDoneDelete;

    function _fmNotesInput(ta) {
      ta.style.borderColor = 'var(--brand-primary)';
      const w = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
      const el = document.getElementById('fmWordCount');
      if (el) el.textContent = '✍️ ' + w + ' word' + (w === 1 ? '' : 's');
      const _hero = document.getElementById('fmHeroEmoji');
      if (_hero) _hero.classList.toggle('ghost', !ta.value.trim());
    }
    window._fmNotesInput = _fmNotesInput;

    function _setSleepQuality(val) {
      selectedSleepQuality = selectedSleepQuality === val ? null : val;
      ['bad','unsure','good'].forEach(v => {
        const b = document.getElementById('sq' + v.charAt(0).toUpperCase() + v.slice(1));
        if (!b) return;
        const active = selectedSleepQuality === v;
        const colors = { bad:'#dc3545', unsure:'#adb5bd', good:'#2ECC40' };
        b.style.borderColor = active ? colors[v] : '#dee2e6';
        b.style.background  = active ? colors[v] + '22' : 'white';
        b.style.color       = active ? '#212529' : '#6c757d';
        b.style.fontWeight  = active ? '600' : '400';
      });
      scheduleDraftSave();
    }
    window._setSleepQuality = _setSleepQuality;

    function _applySleepQualityBtns() {
      if (selectedSleepQuality) _setSleepQuality(selectedSleepQuality); // re-apply to trigger no-op toggle
      else ['bad','unsure','good'].forEach(v => {
        const b = document.getElementById('sq' + v.charAt(0).toUpperCase() + v.slice(1));
        if (b) { b.style.borderColor='#dee2e6'; b.style.background='white'; b.style.color='#6c757d'; b.style.fontWeight='400'; }
      });
    }

    function _doHideMoodSuggestion() {
      localStorage.setItem('showMoodSuggestion', '0');
      const chk = document.getElementById('moodSuggestionToggle');
      if (chk) chk.checked = false;
      document.getElementById('hideSuggestionModal').classList.remove('active');
      _renderFocusedStep();
    }

    function _fmNext() {
      const step = _fmSteps[_fmStepIndex];
      if (!step) return;
      if (step.id === 'done') {
        if (!_hasMood()) {
          const _moodIdx = _fmSteps.findIndex(s => s.id === 'mood');
          if (_moodIdx >= 0) _fmGoTo(_moodIdx);
          return;
        }
        if (editingEntry && !_hasEditChanges()) { cancelEdit(); return; }
        const fmNotes = document.getElementById('fmNotesInput');
        if (fmNotes) document.getElementById('notes').value = fmNotes.value;
        const fmInt = document.getElementById('fmIntentionInput');
        if (fmInt) selectedIntention = fmInt.value;
        saveAndOpenJournal();
        return;
      }
      const _doneIdx = _fmSteps.length - 1;
      if (step.id === 'more_data') {
        if (_fmReturnToDone) { _fmReturnToDone = false; _fmGoTo(_fmNextTarget(_fmStepIndex)); return; }
        _fmGoTo(_fmStepIndex + 1);
        return;
      }
      if (step.id === 'notes') {
        const fmNotes = document.getElementById('fmNotesInput');
        if (fmNotes) document.getElementById('notes').value = fmNotes.value;
        const fmInt = document.getElementById('fmIntentionInput');
        if (fmInt) selectedIntention = fmInt.value;
        if (_fmReturnToDone) { _fmReturnToDone = false; _fmGoTo(_fmNextTarget(_fmStepIndex)); return; }
      }
      _fmGoTo(_fmStepIndex + 1);
    }

    function _fmGoTo(index) {
      if (index < 0 || index >= _fmSteps.length) return;
      // Reset sleep quality intent when revisiting the sleep step so user must long-press again
      if (_fmSteps[index] && _fmSteps[index].id === 'sleep') _fmWantsSleepQuality = false;
      _fmStepIndex = index;
      if (index > _fmHighWater) _fmHighWater = index;
      _renderFocusedStep();
      const card = document.getElementById('focusedModeCard');
      if (card) {
        card.scrollTop = 0;
        setTimeout(() => {
          const top = card.getBoundingClientRect().top + window.scrollY - 16;
          window.scrollTo({ top, behavior: 'smooth' });
        }, 50);
      }
    }

    // Estimate mood from a saved entry object (mirrors _estimateMoodState logic)
    function _estimateMoodFromEntry(e) {
      const fields = [];
      function _f(score, min, max) { fields.push({ score, min, max }); }
      // Energy: extremes (0/10) are strong signals; middle values (3/7) are mild.
      // This prevents lethargic energy from dominating when few other fields are answered.
      _f(_energyScore(e.energy), -50, 50);
      if (e.sleep != null) {
        const s = e.sleep;
        _f(s <= 5 ? 20 : s < 7 ? 5 : s <= 9 ? 0 : s <= 10 ? -8 : -15, -15, 20);
      }
      if (e.medication === 'not-taken') _f(8, 0, 8); // not taking meds → manic/hypomanic signal; taken is neutral
      if (e.irritability != null) _f(e.irritability === 'yes' ? 8 : e.irritability === 'medium' ? 0 : -4, -4, 8);
      if (e.anxiety != null)     _f(e.anxiety === 'high' ? -10 : e.anxiety === 'medium' ? 0 : 5, -10, 5);
      if (e.stress != null)      _f(e.stress === 'high' ? -8 : e.stress === 'medium' ? 0 : 4, -8, 4);
      if (e.alcohol != null)     _f(e.alcohol === 'yes' ? 8 : 0, 0, 8);
      if (e.budget != null)      _f(e.budget === 'no' ? 8 : 0, 0, 8); // overspending → elevated signal
      if (e.goals != null)       _f(e.goals === 'completed' || e.goals === 'some' ? 5 : e.goals === 'none' ? -5 : 0, -5, 5);
      if (e.steps != null)       _f(e.steps >= 15000 ? 10 : e.steps >= 8000 ? 4 : e.steps < 1000 ? -10 : e.steps < 3000 ? -5 : 0, -10, 10);
      if (!fields.length) return { mood: 'stable', normalised: 0 };
      const total = fields.reduce((s, f) => s + f.score, 0);
      const maxP  = fields.reduce((s, f) => s + f.max, 0);
      const minP  = fields.reduce((s, f) => s + f.min, 0);
      const range = maxP - minP;
      const normalised = range > 0 ? Math.round(((total - minP) / range) * 200 - 100) : 0;
      let mood;
      if      (normalised >= 60)  mood = 'manic';
      else if (normalised >= 25)  mood = 'elevated';
      else if (normalised >= -25) mood = 'stable';
      else if (normalised >= -60) mood = 'low';
      else                        mood = 'depressed';
      const _MOOD_ORDER  = ['depressed','low','stable','elevated','manic'];
      const _MOOD_BOUNDS = [-100,-60,-25,25,60,100];
      const _mIdx  = _MOOD_ORDER.indexOf(mood);
      const _mMid  = (_MOOD_BOUNDS[_mIdx] + _MOOD_BOUNDS[_mIdx + 1]) / 2;
      let secondMood = null;
      if (normalised >= _mMid && _mIdx < _MOOD_ORDER.length - 1) secondMood = _MOOD_ORDER[_mIdx + 1];
      else if (normalised < _mMid && _mIdx > 0)                  secondMood = _MOOD_ORDER[_mIdx - 1];
      return { mood, secondMood, normalised };
    }

    function _estimateMoodState() {
      // Each answered field contributes { score, min, max }.
      // Unanswered fields are excluded entirely — the possible range shrinks
      // so the final normalised value is never skewed by missing data.
      const fields = [];
      function _field(score, min, max) { fields.push({ score, min, max }); }

      // Energy: extremes (0/10) are strong signals; middle values (3/7) are mild.
      // This prevents lethargic energy from dominating when few other fields are answered.
      _field(_energyScore(selectedEnergy), -50, 50);

      // Sleep: −15 (depressed) → +20 (manic, sleep-deprived)
      if (selectedSleep != null) {
        const sScore = selectedSleep <= 5 ? 20 : selectedSleep < 7 ? 5 :
                       selectedSleep <= 9 ? 0  : selectedSleep <= 10 ? -8 : -15;
        _field(sScore, -15, 20);
      }

      // Medication: not taken is a manic/hypomanic signal; taken is neutral (no score contribution)
      if (selectedMedication === 'not-taken') _field(8, 0, 8);


      // Irritability: manic signal (more = elevated, less = depressed/stable)
      if (selectedIrritability != null)
        _field(selectedIrritability === 'yes' ? 8 : selectedIrritability === 'medium' ? 0 : -4, -4, 8);

      // Anxiety: more anxious = depressed direction; less = stable/manic
      if (selectedAnxiety != null)
        _field(selectedAnxiety === 'high' ? -10 : selectedAnxiety === 'medium' ? 0 : 5, -10, 5);

      // Stress: same direction as anxiety
      if (selectedStress != null)
        _field(selectedStress === 'high' ? -8 : selectedStress === 'medium' ? 0 : 4, -8, 4);

      // Alcohol
      if (selectedAlcohol != null)
        _field(selectedAlcohol === 'yes' ? 8 : 0, 0, 8);

      // Budget: overspending is an elevated/manic signal
      if (selectedBudget != null)
        _field(selectedBudget === 'no' ? 8 : 0, 0, 8);

      // Goals
      if (selectedGoals != null)
        _field(selectedGoals === 'completed' || selectedGoals === 'some' ? 5 : selectedGoals === 'none' ? -5 : 0, -5, 5);

      // Steps (if synced)
      try {
        const _dateVal = document.getElementById('entryDate')?.value;
        const steps = _dateVal && window._healthStepsByDate?.[_dateVal];
        if (steps != null)
          _field(steps >= 15000 ? 10 : steps >= 8000 ? 4 : steps < 1000 ? -10 : steps < 3000 ? -5 : 0, -10, 10);
      } catch(e) {}

      if (!fields.length) return { mood: 'stable', normalised: 0 };

      const total   = fields.reduce((s, f) => s + f.score, 0);
      const maxPoss = fields.reduce((s, f) => s + f.max,   0);
      const minPoss = fields.reduce((s, f) => s + f.min,   0);
      const range   = maxPoss - minPoss;

      // Normalise to −100…+100 relative to what was actually answered
      const normalised = range > 0 ? Math.round(((total - minPoss) / range) * 200 - 100) : 0;

      let mood;
      if      (normalised >= 60)  mood = 'manic';
      else if (normalised >= 25)  mood = 'elevated';
      else if (normalised >= -25) mood = 'stable';
      else if (normalised >= -60) mood = 'low';
      else                        mood = 'depressed';

      // Determine the adjacent mood based on which boundary the score is closer to
      const _MOOD_ORDER  = ['depressed','low','stable','elevated','manic'];
      const _MOOD_BOUNDS = [-100,-60,-25,25,60,100];
      const _mIdx  = _MOOD_ORDER.indexOf(mood);
      const _mMid  = (_MOOD_BOUNDS[_mIdx] + _MOOD_BOUNDS[_mIdx + 1]) / 2;
      let secondMood = null;
      if (normalised >= _mMid && _mIdx < _MOOD_ORDER.length - 1) secondMood = _MOOD_ORDER[_mIdx + 1];
      else if (normalised < _mMid && _mIdx > 0)                  secondMood = _MOOD_ORDER[_mIdx - 1];

      return { mood, secondMood, normalised };
    }

    window._toggleFocusedMode = _toggleFocusedMode;
    window._openFocusedMode   = _openFocusedMode;
    window._exitFocusedMode   = _exitFocusedMode;
    window._maybeFocusedModeAfterFormShown = _maybeFocusedModeAfterFormShown;
    window._fmBack    = _fmBack;
    window._fmNext    = _fmNext;
    window._fmSkip    = _fmSkip;
    window._fmAdvance = _fmAdvance;
    // Repaint the current step in place (the meds step's 🔔 pill after its sheet saves).
    window._fmRerenderStep = function () { try { _renderFocusedStep(); } catch (_) {} };
    window._fmGoToDone = _fmGoToDone;
    window._fmGoTo    = _fmGoTo;
    window._fmRefreshSleep = _fmRefreshSleep;

    // ── Shared insights engine (used by modal + PDF) ──
    // sorted: entries sorted oldest→newest
    // Returns array of { icon, title, text, detail, accent, accentRgb }
    function computeInsights(sorted) {
      function pearson(xs, ys) {
        const n = xs.length;
        if (n < 5) return null;
        const mx = xs.reduce((s, v) => s + v, 0) / n;
        const my = ys.reduce((s, v) => s + v, 0) / n;
        let num = 0, dx2 = 0, dy2 = 0;
        for (let i = 0; i < n; i++) {
          const dx = xs[i] - mx, dy = ys[i] - my;
          num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
        }
        return dx2 && dy2 ? num / Math.sqrt(dx2 * dy2) : null;
      }

      const ms = (mood) => _moodScore(mood);
      // Convert numeric mood score (1–6) to a readable label
      const moodLabel = n => {
        const v = parseFloat(n);
        if (v >= 4.5) return 'Manic';
        if (v >= 3.5) return 'Elevated';
        if (v >= 2.5) return 'Stable';
        if (v >= 1.5) return 'Low';
        return 'Depressed';
      };
      // Format a numeric score with its mood label, e.g. "3.2 (Stable)"
      const msFmt = n => `${n} (${moodLabel(n)})`;

      function strength(r) {
        const a = Math.abs(r);
        return a >= 0.5 ? 'strong' : a >= 0.3 ? 'moderate' : 'weak';
      }

      // accent hex → RGB for PDF
      const accentMap = {
        '#51cf66': [81, 207, 102],
        '#ff6b6b': [255, 107, 107],
        'var(--brand-primary)': [255, 149, 0],
        '#adb5bd': [173, 181, 189],
        '#667eea': [102, 126, 234],
        '#764ba2': [118, 75, 162]
      };
      const ins = (icon, title, text, accent, detail = '') => ({
        icon, title, text, detail, accent, accentRgb: accentMap[accent] || [173, 181, 189]
      });

      const dateMap = {};
      sorted.forEach(e => { dateMap[e.date.slice(0, 10)] = e; });
      const results = [];

      // ── 1. Sleep → next-day mood ──
      const lagMood = [];
      sorted.forEach(e => {
        const next = new Date(e.date);
        next.setDate(next.getDate() + 1);
        const k = next.toISOString().slice(0, 10);
        if (dateMap[k] && e.sleep != null) lagMood.push({ sleep: e.sleep, nextMood: ms(dateMap[k].mood) });
      });
      if (lagMood.length >= 8) {
        const r = pearson(lagMood.map(p => p.sleep), lagMood.map(p => p.nextMood));
        if (r !== null && Math.abs(r) >= 0.1) {
          const hi = lagMood.filter(p => p.sleep >= 7);
          const lo = lagMood.filter(p => p.sleep < 7);
          let detail = '';
          if (hi.length >= 3 && lo.length >= 3) {
            const avgHi = (hi.reduce((s, p) => s + p.nextMood, 0) / hi.length).toFixed(1);
            const avgLo = (lo.reduce((s, p) => s + p.nextMood, 0) / lo.length).toFixed(1);
            detail = `After 7h+ sleep: next-day mood avg ${msFmt(avgHi)}  ·  After <7h: ${msFmt(avgLo)}`;
          }
          const accent = r >= 0.3 ? '#51cf66' : r <= -0.3 ? '#ff6b6b' : '#adb5bd';
          results.push(ins('😴', 'Sleep & Next-Day Mood',
            `A ${strength(r)} relationship (r = ${r.toFixed(2)}): ${r >= 0 ? 'more sleep tends to lift your mood the following day' : 'sleep and next-day mood show an inverse trend — worth watching'}.`,
            accent, detail));
        }
      }

      // ── 2. Sleep → next-day energy ──
      const lagEnergy = [];
      sorted.forEach(e => {
        const next = new Date(e.date);
        next.setDate(next.getDate() + 1);
        const k = next.toISOString().slice(0, 10);
        if (dateMap[k] && e.sleep != null) lagEnergy.push({ sleep: e.sleep, nextEnergy: dateMap[k].energy });
      });
      if (lagEnergy.length >= 8) {
        const r = pearson(lagEnergy.map(p => p.sleep), lagEnergy.map(p => p.nextEnergy));
        if (r !== null && Math.abs(r) >= 0.2) {
          results.push(ins('⚡', 'Sleep & Next-Day Energy',
            `A ${strength(r)} link (r = ${r.toFixed(2)}): ${r >= 0 ? 'more sleep tends to mean higher energy the next day' : 'an unexpected inverse trend between sleep and next-day energy'}.`,
            Math.abs(r) >= 0.3 ? 'var(--brand-primary)' : '#adb5bd'));
        }
      }

      // ── 3. Energy ↔ Mood (same day) ──
      if (sorted.length >= 7) {
        const r = pearson(sorted.map(e => e.energy), sorted.map(e => ms(e.mood)));
        if (r !== null && Math.abs(r) >= 0.1) {
          results.push(ins('💫', 'Energy & Mood',
            `Your energy and mood are ${strength(r)}ly correlated (r = ${r.toFixed(2)}). ${Math.abs(r) >= 0.5 ? 'They tend to rise and fall together.' : 'They sometimes diverge — tracking both helps spot the difference.'}`,
            Math.abs(r) >= 0.4 ? '#667eea' : '#adb5bd'));
        }
      }

      // ── 4. Medication → mood ──
      const medTaken  = sorted.filter(e => e.medication === 'taken' || !e.medication);
      const medMissed = sorted.filter(e => e.medication && e.medication !== 'taken');
      if (medMissed.length >= 5 && medTaken.length >= 5) {
        const avgT = medTaken.reduce((s, e)  => s + ms(e.mood), 0) / medTaken.length;
        const avgM = medMissed.reduce((s, e) => s + ms(e.mood), 0) / medMissed.length;
        const diff = avgT - avgM;
        let text, accent;
        if (diff > 0.3) {
          text   = `Mood averages ${Math.abs(diff).toFixed(1)} pts higher on days medication was taken (${medTaken.length} vs ${medMissed.length} days).`;
          accent = '#51cf66';
        } else if (diff < -0.3) {
          text   = `Mood is ${Math.abs(diff).toFixed(1)} pts higher on days medication was missed — worth mentioning to your doctor.`;
          accent = '#ff6b6b';
        } else {
          text   = `Mood is similar whether or not medication was taken (difference: ${Math.abs(diff).toFixed(1)} pts). Longer-term consistency may matter more.`;
          accent = '#adb5bd';
        }
        results.push(ins('💊', 'Medication & Mood', text, accent));
      }

      // ── 5. Consecutive low-sleep runs ──
      let runCount = 0, afterRunTotal = 0, afterRunN = 0, runLen = 0;
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].sleep != null && sorted[i].sleep < 6) {
          runLen++;
        } else {
          if (runLen >= 3) { afterRunTotal += ms(sorted[i].mood); afterRunN++; runCount++; }
          runLen = 0;
        }
      }
      if (runCount >= 2) {
        const avg = (afterRunTotal / afterRunN).toFixed(1);
        const word = parseFloat(avg) >= 4.5 ? 'elevated' : parseFloat(avg) >= 3.5 ? 'stable' : parseFloat(avg) >= 2.5 ? 'mixed' : 'lower';
        results.push(ins('🔴', '3+ Nights of Low Sleep',
          `${runCount} runs of 3+ consecutive nights under 6h detected. The day after such a run, mood tended to be ${word} (avg ${msFmt(avg)}).`,
          parseFloat(avg) < 3 ? '#ff6b6b' : 'var(--brand-primary)'));
      }

      // ── 6. Day-of-week patterns ──
      if (sorted.length >= 14) {
        const dowBuckets = Array(7).fill(null).map(() => []);
        sorted.forEach(e => dowBuckets[new Date(e.date).getDay()].push(ms(e.mood)));
        const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const avgs = dowBuckets
          .map((arr, i) => arr.length >= 2 ? { day: names[i], avg: arr.reduce((s, v) => s + v, 0) / arr.length } : null)
          .filter(Boolean).sort((a, b) => b.avg - a.avg);
        if (avgs.length >= 4 && (avgs[0].avg - avgs[avgs.length - 1].avg) >= 0.5) {
          results.push(ins('🗓️', 'Day-of-Week Patterns',
            `Best on ${avgs[0].day}s (avg ${msFmt(avgs[0].avg.toFixed(1))}), lowest on ${avgs[avgs.length - 1].day}s (avg ${msFmt(avgs[avgs.length - 1].avg.toFixed(1))}).`,
            '#764ba2'));
        }
      }

      // ── 7. Steps → mood ──
      const withSteps = sorted.filter(e => e.steps != null && e.steps > 0);
      if (withSteps.length >= 10) {
        const r = pearson(withSteps.map(e => e.steps), withSteps.map(e => ms(e.mood)));
        if (r !== null && Math.abs(r) >= 0.15) {
          results.push(ins('👟', 'Steps & Mood',
            `A ${strength(r)} relationship between daily steps and mood (r = ${r.toFixed(2)}): ${r >= 0 ? 'more steps tends to coincide with better mood' : 'an unexpected inverse trend — may be worth exploring'}.`,
            r >= 0.2 ? '#51cf66' : '#adb5bd'));
        }
      }

      // ── 8. Exercise → mood ──
      const exercisedDays = sorted.filter(e => e.exercise === 'yes');
      const noExerciseDays = sorted.filter(e => e.exercise === 'no');
      if (exercisedDays.length >= 5 && noExerciseDays.length >= 5) {
        const avgEx  = exercisedDays.reduce((s, e) => s + ms(e.mood), 0) / exercisedDays.length;
        const avgNoEx = noExerciseDays.reduce((s, e) => s + ms(e.mood), 0) / noExerciseDays.length;
        const diff = avgEx - avgNoEx;
        if (Math.abs(diff) >= 0.3) {
          results.push(ins('🏋️', 'Exercise & Mood',
            diff > 0
              ? `Your mood averages ${diff.toFixed(1)} pts higher on days you exercise (${exercisedDays.length} vs ${noExerciseDays.length} non-exercise days).`
              : `Mood was ${Math.abs(diff).toFixed(1)} pts lower on exercise days — this could reflect exercising when already struggling, or delayed recovery.`,
            diff > 0 ? '#51cf66' : '#adb5bd'));
        }
      }

      // ── 9. Alcohol → next-day mood ──
      const alcoholLag = [];
      sorted.forEach(e => {
        if (!e.alcohol) return;
        const next = new Date(e.date);
        next.setDate(next.getDate() + 1);
        const k = next.toISOString().slice(0, 10);
        if (dateMap[k]) alcoholLag.push({ drank: e.alcohol === 'yes' ? 1 : 0, nextMood: ms(dateMap[k].mood) });
      });
      if (alcoholLag.length >= 8) {
        const drankDays    = alcoholLag.filter(p => p.drank === 1);
        const soberDays    = alcoholLag.filter(p => p.drank === 0);
        if (drankDays.length >= 3 && soberDays.length >= 3) {
          const avgDrank = drankDays.reduce((s, p) => s + p.nextMood, 0) / drankDays.length;
          const avgSober = soberDays.reduce((s, p) => s + p.nextMood, 0) / soberDays.length;
          const diff = avgDrank - avgSober;
          if (Math.abs(diff) >= 0.3) {
            results.push(ins('🍺', 'Alcohol & Next-Day Mood',
              diff < 0
                ? `Next-day mood averages ${Math.abs(diff).toFixed(1)} pts lower after drinking (avg ${msFmt(avgDrank.toFixed(1))} vs ${msFmt(avgSober.toFixed(1))} on sober days).`
                : `No notable drop in next-day mood after drinking (avg ${msFmt(avgDrank.toFixed(1))} vs ${msFmt(avgSober.toFixed(1))} on sober days).`,
              diff < -0.3 ? '#ff6b6b' : '#adb5bd'));
          }
        }
      }

      // ── 10. Smoking → next-day mood ──
      const smokingLag = [];
      sorted.forEach(e => {
        if (!e.smoking) return;
        const next = new Date(e.date);
        next.setDate(next.getDate() + 1);
        const k = next.toISOString().slice(0, 10);
        if (dateMap[k]) smokingLag.push({ smoked: e.smoking === 'yes' ? 1 : 0, nextMood: ms(dateMap[k].mood) });
      });
      if (smokingLag.length >= 8) {
        const smokedDays  = smokingLag.filter(p => p.smoked === 1);
        const noSmokeDays = smokingLag.filter(p => p.smoked === 0);
        if (smokedDays.length >= 3 && noSmokeDays.length >= 3) {
          const avgSmoked  = smokedDays.reduce((s, p) => s + p.nextMood, 0) / smokedDays.length;
          const avgNoSmoke = noSmokeDays.reduce((s, p) => s + p.nextMood, 0) / noSmokeDays.length;
          const diff = avgSmoked - avgNoSmoke;
          if (Math.abs(diff) >= 0.3) {
            results.push(ins('🚬', 'Smoking & Next-Day Mood',
              diff < 0
                ? `Next-day mood averages ${Math.abs(diff).toFixed(1)} pts lower after smoking (avg ${msFmt(avgSmoked.toFixed(1))} vs ${msFmt(avgNoSmoke.toFixed(1))} on non-smoking days).`
                : `No notable drop in next-day mood after smoking (avg ${msFmt(avgSmoked.toFixed(1))} vs ${msFmt(avgNoSmoke.toFixed(1))} on non-smoking days).`,
              diff < -0.3 ? '#ff6b6b' : '#adb5bd'));
          }
        }
      }

      // ── 11. Anxiety → mood (same-day) ──
      const withAnxiety = sorted.filter(e => e.anxiety);
      if (withAnxiety.length >= 10) {
        const anxietyNum = { low: 1, medium: 2, high: 3 };
        const r = pearson(withAnxiety.map(e => anxietyNum[e.anxiety] || 0), withAnxiety.map(e => ms(e.mood)));
        if (r !== null && Math.abs(r) >= 0.2) {
          const hiAnx   = withAnxiety.filter(e => e.anxiety === 'high');
          const loAnx   = withAnxiety.filter(e => e.anxiety === 'low');
          const avgHi   = hiAnx.length  ? (hiAnx.reduce((s, e) => s + ms(e.mood), 0) / hiAnx.length).toFixed(1)  : null;
          const avgLo   = loAnx.length  ? (loAnx.reduce((s, e) => s + ms(e.mood), 0) / loAnx.length).toFixed(1)  : null;
          const detail  = avgHi && avgLo ? `High-anxiety days avg mood: ${msFmt(avgHi)} vs low-anxiety days: ${msFmt(avgLo)}.` : '';
          results.push(ins('😰', 'Anxiety & Mood',
            `A ${strength(r)} link between anxiety and mood (r = ${r.toFixed(2)}): ${r < 0 ? 'higher anxiety correlates with lower mood' : 'unexpectedly, anxiety appears linked to higher mood — may reflect productive energy vs. anxious activation'}.`,
            r < -0.2 ? '#ff6b6b' : '#adb5bd', detail));
        }
      }

      // ── 12. Stress → mood (same-day) ──
      const withStress = sorted.filter(e => e.stress);
      if (withStress.length >= 10) {
        const stressNum = { low: 1, medium: 2, high: 3 };
        const r = pearson(withStress.map(e => stressNum[e.stress] || 0), withStress.map(e => ms(e.mood)));
        if (r !== null && Math.abs(r) >= 0.2) {
          const hiStr   = withStress.filter(e => e.stress === 'high');
          const loStr   = withStress.filter(e => e.stress === 'low');
          const avgHi   = hiStr.length ? (hiStr.reduce((s, e) => s + ms(e.mood), 0) / hiStr.length).toFixed(1) : null;
          const avgLo   = loStr.length ? (loStr.reduce((s, e) => s + ms(e.mood), 0) / loStr.length).toFixed(1) : null;
          const detail  = avgHi && avgLo ? `High-stress days avg mood: ${msFmt(avgHi)} vs low-stress days: ${msFmt(avgLo)}.` : '';
          results.push(ins('😓', 'Stress & Mood',
            `A ${strength(r)} link between stress and mood (r = ${r.toFixed(2)}): ${r < 0 ? 'higher stress days tend to have lower mood' : 'stress doesn\'t seem to suppress mood for you — possibly a sign of resilience'}.`,
            r < -0.2 ? 'var(--brand-primary)' : '#adb5bd', detail));
        }
      }

      // ── 13. Outside & mood ──
      const outsideDays  = sorted.filter(e => e.outside === 'yes');
      const insideDays   = sorted.filter(e => e.outside === 'no');
      if (outsideDays.length >= 4 && insideDays.length >= 4) {
        const avgOut = outsideDays.reduce((s, e) => s + ms(e.mood), 0) / outsideDays.length;
        const avgIn  = insideDays.reduce((s, e) => s + ms(e.mood), 0) / insideDays.length;
        const diff   = avgOut - avgIn;
        if (Math.abs(diff) >= 0.3) {
          results.push(ins('🌤️', 'Going Outside & Mood',
            diff > 0
              ? `Mood averages ${diff.toFixed(1)} pts higher on days you go outside (${msFmt(avgOut.toFixed(1))} vs ${msFmt(avgIn.toFixed(1))} on indoor days).`
              : `Mood was ${Math.abs(diff).toFixed(1)} pts lower on days you went outside — this may reflect going out when already low, or other confounding factors.`,
            diff > 0 ? '#51cf66' : '#adb5bd'));
        }
      }

      // ── 14. Irritability as warning sign ──
      const irritableDays = sorted.filter(e => e.irritability === 'yes');
      const calmDays      = sorted.filter(e => e.irritability === 'no');
      if (irritableDays.length >= 4 && calmDays.length >= 4) {
        const avgIrrit  = irritableDays.reduce((s, e) => s + ms(e.mood), 0) / irritableDays.length;
        const avgCalm   = calmDays.reduce((s, e) => s + ms(e.mood), 0) / calmDays.length;
        const diff = avgIrrit - avgCalm;
        if (Math.abs(diff) >= 0.3) {
          results.push(ins('😤', 'Irritability Patterns',
            diff > 0
              ? `Irritable days correlate with higher mood scores (avg ${msFmt(avgIrrit.toFixed(1))} vs ${msFmt(avgCalm.toFixed(1))} on calm days) — irritability may signal elevated or mixed states for you.`
              : `Mood is ${Math.abs(diff).toFixed(1)} pts lower on irritable days (avg ${msFmt(avgIrrit.toFixed(1))} vs ${msFmt(avgCalm.toFixed(1))}) — irritability tends to accompany low mood.`,
            diff > 0.5 ? 'var(--brand-primary)' : '#ff6b6b'));
        }
      }

      return results;
    }

    // The feedback popup has its own period, switched by the 1M / 3M / 6M / 1Y /
    // All buttons at its top (same look as the journal's range tabs). It opens
    // on the journal's range and works from _allEntries, so it isn't limited
    // to the entries the stats page happens to have loaded.
    const _FB_RANGES = [[30, 'journal.lifeChart.r1m'], [90, 'journal.lifeChart.r3m'], [180, 'journal.lifeChart.r6m'], [365, 'journal.lifeChart.r1y'], ['all', 'journal.feedback.all']];
    let _fbRange = null;
    function _fbRangeFromStats() {
      if (statsTimeframe === 'all') return 'all';
      const n = Number(statsTimeframe) || 30;
      const hit = _FB_RANGES.find(r => r[0] !== 'all' && r[0] >= n);
      return hit ? hit[0] : 'all';
    }
    function _fbRangeLabel(key, fallback) { const t = BB.t(key); return t && t !== key ? t : fallback; }

    function showPersonalisedFeedback(range) {
      const modal = document.getElementById('feedbackModal');
      const body  = document.getElementById('feedbackBody');
      const rangesEl = document.getElementById('feedbackRanges');
      _fbRange = range !== undefined ? range : _fbRangeFromStats();

      if (rangesEl) {
        rangesEl.innerHTML = _FB_RANGES.map(r =>
          `<button type="button" class="fb-range${r[0] === _fbRange ? ' on' : ''}" aria-pressed="${r[0] === _fbRange}" onclick="showPersonalisedFeedback(${r[0] === 'all' ? "'all'" : r[0]})">${_fbRangeLabel(r[1], r[0] === 'all' ? 'All' : '')}</button>`
        ).join('');
      }

      const source = (_allEntries && _allEntries.length) ? _allEntries : currentStatsEntries;
      let pool = source;
      if (_fbRange !== 'all') {
        const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - (_fbRange - 1));
        pool = source.filter(e => new Date(e.date) >= since);
      }
      const sorted = [...pool].sort((a, b) => new Date(a.date) - new Date(b.date));

      if (sorted.length < 7) {
        body.innerHTML = `<div style="text-align:center;padding:30px 0;color:#6c757d;">
          <div style="font-size:2em;margin-bottom:12px;">📊</div>
          <div>${BB.t('journal.ui.keepJournalling7')}</div>
        </div>`;
        modal.classList.add('active');
        return;
      }

      const insights = computeInsights(sorted);
      const _basis = `<div style="font-size:0.8em;color:#868e96;text-align:center;margin-bottom:12px;padding:6px 12px;background:#f8f9fa;border-radius:8px;">${_fbRange === 'all'
        ? BB.t('journal.feedback.basedAll', { n: sorted.length })
        : BB.t('journal.feedback.basedDays', { days: _fbRange, n: sorted.length })}</div>`;

      if (insights.length === 0) {
        body.innerHTML = _basis + `<div style="text-align:center;padding:30px 0;color:#6c757d;">
          <div style="font-size:2em;margin-bottom:12px;">📊</div>
          <div>${BB.t('journal.ui.noStrongPatterns')}</div>
        </div>`;
      } else {
        body.innerHTML = _basis + insights.map(i => `
          <div style="display:flex;gap:12px;align-items:flex-start;padding:12px;margin-bottom:10px;border-radius:12px;background:#f8f9fa;border-left:4px solid ${i.accent};">
            <div style="font-size:1.4em;line-height:1.2;flex-shrink:0;">${i.icon}</div>
            <div>
              <div style="font-weight:700;font-size:0.95em;margin-bottom:3px;">${i.title}</div>
              <div style="font-size:0.85em;color:#495057;line-height:1.5;">${i.text}</div>
              ${i.detail ? `<div style="margin-top:4px;font-size:0.8em;color:#888;">${i.detail}</div>` : ''}
            </div>
          </div>
        `).join('');
      }
      body.scrollTop = 0;
      modal.classList.add('active');
    }

    function closeFeedbackModal() {
      document.getElementById('feedbackModal').classList.remove('active');
    }
    window.showPersonalisedFeedback = showPersonalisedFeedback;
    window.closeFeedbackModal = closeFeedbackModal;

    // ────────────────────────────────────────────
    // ACHIEVEMENTS
    // ────────────────────────────────────────────
    const ACHIEVEMENTS = [
      { id: 'first_step',        emoji: '🌱', title: 'First Step',              desc: 'Log your very first entry.' },
      { id: 'calendar_unlocked', emoji: '📅', title: 'Monthly Calendar Unlocked', desc: 'Log a second entry to unlock statistics and the monthly calendar.' },
      { id: 'streak_3',          emoji: '🔥', title: '3-Day Streak',              desc: 'Log entries 3 days in a row.' },
      { id: 'streak_7',    emoji: '💪', title: 'Week Warrior',   desc: 'Log entries 7 days in a row.' },
      { id: 'streak_30',   emoji: '🌟', title: '30-Day Legend',  desc: 'Log entries 30 days in a row.' },
      { id: 'entries_25',  emoji: '📝', title: 'Getting Started', desc: 'Log 25 entries.' },
      { id: 'entries_50',  emoji: '🎯', title: 'Dedicated',      desc: 'Log 50 entries.' },
      { id: 'entries_100', emoji: '💯', title: 'Century',        desc: 'Log 100 entries.' },
      { id: 'entries_365', emoji: '🏆', title: 'Year Hero',      desc: 'Log 365 entries.' },
      { id: 'med_7',       emoji: '💊', title: 'Med Master',     desc: 'Take medication 7 days in a row.' },
      { id: 'mood_all',    emoji: '🌈', title: 'Full Spectrum',  desc: 'Track all five mood levels at least once.' },
      { id: 'with_note',   emoji: '✍️',  title: 'Journalist',    desc: 'Add a note to 10 different entries.' },
      { id: 'stable_week', emoji: '☀️', title: 'Stable Week',   desc: 'Log "Stable" 7 days in a row.' },
      { id: 'first_definition',  emoji: '📖', title: 'Know Thyself',       desc: 'Write your first personal mood definition.' },
      { id: 'first_coping',      emoji: '🛡️', title: 'First Defence',       desc: 'Add your first coping strategy.' },
      { id: 'first_medication',  emoji: '💊', title: 'Medicated',           desc: 'Add your first medication to the Survival Kit.' },
      { id: 'first_goal',        emoji: '🎯', title: 'Goal Setter',         desc: 'Add your first daily goal.' },
      { id: 'survival_kit',      emoji: '🧰', title: 'Fully Prepared',      desc: 'Add at least one mood definition, coping strategy, medication and goal to your Survival Kit.' },
      { id: 'logo_easter_egg',   emoji: '🎨', title: 'Easter Egg Found',    desc: 'Discover the hidden logo easter egg.' },
      { id: 'tutorial_complete', emoji: '🎓', title: 'All Set Up!',          desc: 'Complete the full onboarding tutorial.' },
    ];

    function _achCurrentStreak(entries) {
      const today = new Date(); today.setHours(0,0,0,0);
      const dateSet = new Set(entries.map(e => { const d = new Date(e.date); d.setHours(0,0,0,0); return d.getTime(); }));
      let streak = 0, check = new Date(today);
      while (dateSet.has(check.getTime())) { streak++; check.setDate(check.getDate()-1); }
      if (streak === 0) {
        check = new Date(today); check.setDate(check.getDate()-1);
        while (dateSet.has(check.getTime())) { streak++; check.setDate(check.getDate()-1); }
      }
      return streak;
    }

    function _achMedStreak(entries) {
      const sorted = [...entries].sort((a,b) => new Date(a.date) - new Date(b.date));
      let streak = 0, best = 0;
      for (const e of sorted) {
        if (!e.medication || e.medication === 'taken') { streak++; best = Math.max(best, streak); }
        else streak = 0;
      }
      return best;
    }

    function _achStableStreak(entries) {
      const goodMoods = new Set(['manic','elevated','stable','good']);
      const goodSet = new Set(entries.filter(e => goodMoods.has(_moodCat(e.mood))).map(e => { const d = new Date(e.date); d.setHours(0,0,0,0); return d.getTime(); }));
      const today = new Date(); today.setHours(0,0,0,0);
      let streak = 0, chk = new Date(today);
      while (goodSet.has(chk.getTime())) { streak++; chk.setDate(chk.getDate()-1); }
      if (streak === 0) { chk = new Date(today); chk.setDate(chk.getDate()-1); while (goodSet.has(chk.getTime())) { streak++; chk.setDate(chk.getDate()-1); } }
      return streak;
    }

    let _achievementsInitialized = false;

    function checkAchievements(entries) {
      const stored = JSON.parse(localStorage.getItem('unlockedAchievements') || '[]');
      const newlyUnlocked = [];
      const totalEntries = entries.length;
      const streak = _achCurrentStreak(entries);
      const medStreak = _achMedStreak(entries);
      const stableStreak = _achStableStreak(entries);
      const moods = new Set(entries.map(e => _moodCat(e.mood)));
      const notesCount = entries.filter(e => e.notes && e.notes.trim()).length;

      // Survival Kit checks (localStorage)
      let _hasDef = false, _hasStrat = false, _hasMed = false, _hasGoal = false;
      try {
        const _defs   = JSON.parse(localStorage.getItem('moodDefinitions')   || '{}');
        const _strats = JSON.parse(localStorage.getItem('copingStrategies')  || '{}');
        const _meds   = JSON.parse(localStorage.getItem('currentMedList')    || '[]');
        const _goals  = JSON.parse(localStorage.getItem('dailyGoals')        || '[]');
        _hasDef   = Object.values(_defs).some(v => v && String(v).trim());
        _hasStrat = Object.values(_strats).some(a => Array.isArray(a) && a.length > 0);
        _hasMed   = Array.isArray(_meds) && _meds.length > 0;
        _hasGoal  = Array.isArray(_goals) && _goals.length > 0;
      } catch(e) {}

      const conditions = {
        first_step:        totalEntries >= 1,
        calendar_unlocked: totalEntries >= 2,
        streak_3:          streak >= 3,
        streak_7:          streak >= 7,
        streak_30:         streak >= 30,
        entries_25:        totalEntries >= 25,
        entries_50:        totalEntries >= 50,
        entries_100:       totalEntries >= 100,
        entries_365:       totalEntries >= 365,
        med_7:             medStreak >= 7,
        mood_all:          ['manic','elevated','stable','low','depressed'].every(m => moods.has(m)),
        with_note:         notesCount >= 10,
        stable_week:       stableStreak >= 7,
        first_definition:  _hasDef,
        first_coping:      _hasStrat,
        first_medication:  _hasMed,
        first_goal:        _hasGoal,
        survival_kit:      _hasDef && _hasStrat && _hasMed && _hasGoal,
        logo_easter_egg:   BB.storage.get('LogoEasterEggFound') === '1',
        tutorial_complete: _getOnboardingStep() >= 12,
      };

      for (const [id, met] of Object.entries(conditions)) {
        if (met && !stored.includes(id)) { stored.push(id); newlyUnlocked.push(id); }
      }

      if (newlyUnlocked.length > 0) {
        localStorage.setItem('unlockedAchievements', JSON.stringify(stored));
        if (window.db && window.currentUser) {
          window.db.collection('userSettings').doc(window.currentUser.uid)
            .set({ unlockedAchievements: stored }, { merge: true }).catch(() => {});
        }
        // First call of the session just silently syncs the stored set — no toast.
        // (Prevents re-toasting all achievements when logging in after a logout.)
        const toastsEnabled = _achievementsInitialized && localStorage.getItem('achievementToastsEnabled') !== 'false';
        if (toastsEnabled) {
          // Only show the first unlocked achievement — avoid toast spam
          const ach = ACHIEVEMENTS.find(a => a.id === newlyUnlocked[0]);
          if (ach) showAchievementToast(ach, newlyUnlocked.length);
          // Non-blocking hint near journal toggle button when calendar unlocks
          if (newlyUnlocked.includes('calendar_unlocked')) {
            setTimeout(_showCalendarUnlockedHint, 600);
          }
        }
      }
      _achievementsInitialized = true;
    }

    // ── In-app review prompt ──
    // Asks for a store rating only after a real win: the user has just saved a
    // new, hand-logged entry on a stable-mood day, with at least 3 different
    // days logged in total. Never on a low/depressed or elevated/manic day —
    // asking someone to rate the app mid-episode is the wrong moment. Native
    // only, at most 3 asks ever, 120 days apart (Apple caps it at 3/year and
    // Google throttles on its own, so the OS may still show nothing).
    let _reviewCandidateMood = null;
    const _REVIEW_MIN_DAYS = 3;
    const _REVIEW_MAX_ASKS = 3;
    const _REVIEW_COOLDOWN_MS = 120 * 24 * 60 * 60 * 1000;

    function _maybeRequestReview(entries) {
      const mood = _reviewCandidateMood;
      _reviewCandidateMood = null;
      if (mood == null || !isNative()) return;
      const InAppReview = getPlugin('InAppReview');
      if (!InAppReview) return;
      if (_moodCat(mood) !== 'stable') return;

      const loggedDays = new Set(entries.filter(e => !e.autoFilled).map(e => {
        const d = new Date(e.date); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      }));
      if (loggedDays.size < _REVIEW_MIN_DAYS) return;

      const asks = parseInt(BB.storage.get('ReviewAskCount') || '0', 10) || 0;
      const lastAsked = parseInt(BB.storage.get('ReviewLastAsked') || '0', 10) || 0;
      if (asks >= _REVIEW_MAX_ASKS || Date.now() - lastAsked < _REVIEW_COOLDOWN_MS) return;

      // Let the save haptic and any achievement toast (~4s) finish first.
      _whenHintsDone(() => {
        const delay = document.getElementById('achievementToast') ? 4500 : 1500;
        setTimeout(() => {
          if (document.visibilityState !== 'visible') return;
          BB.storage.set('ReviewAskCount', String(asks + 1));
          BB.storage.set('ReviewLastAsked', String(Date.now()));
          InAppReview.requestReview().catch(e => console.warn('In-app review error:', e));
        }, delay);
      });
    }

    function _showCalendarUnlockedHint() {
      if (document.getElementById('calendarUnlockedHint')) return;
      const toggleSection = document.getElementById('journalToggleSection');
      if (!toggleSection || toggleSection.style.display === 'none') return;
      const hint = document.createElement('div');
      hint.id = 'calendarUnlockedHint';
      hint.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><line x1="8" y1="13" x2="8" y2="2" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round"/><polyline points="3,7 8,2 13,7" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg><span style="font-size:0.72em;font-weight:700;font-style:italic;color:rgba(255,255,255,0.9);font-family:'Georgia',serif;letter-spacing:0.01em;">${BB.t('journal.ui.newCalendarStats')}</span>`;
      Object.assign(hint.style, {
        display:'flex', flexDirection:'column', alignItems:'center', gap:'2px',
        marginTop:'6px', pointerEvents:'none',
        animation:'hintFade 2.4s ease-in-out infinite',
      });
      toggleSection.appendChild(hint);
      // Auto-dismiss after 5s or when toggle button is clicked
      const _dismiss = () => { hint.remove(); toggleBtn.removeEventListener('click', _dismiss); };
      const toggleBtn = document.getElementById('journalToggleBtn');
      if (toggleBtn) toggleBtn.addEventListener('click', _dismiss);
      setTimeout(_dismiss, 5000);
    }

    // Defer a callback until the hint overlay is hidden (so toasts don't obscure hints)
    function _whenHintsDone(callback) {
      const _ov = document.getElementById('bbHintOverlay');
      if (!_ov || _ov.style.display === 'none') { callback(); return; }
      const _obs = new MutationObserver(() => {
        if (_ov.style.display === 'none') { _obs.disconnect(); setTimeout(callback, 200); }
      });
      _obs.observe(_ov, { attributes: true, attributeFilter: ['style'] });
    }

    function showAchievementToast(ach, totalUnlocked) {
      _whenHintsDone(() => {
        const existing = document.getElementById('achievementToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'achievementToast';
        const extraLabel = totalUnlocked > 1 ? `<div style="font-size:0.75em;color:rgba(255,255,255,0.8);margin-top:4px;">+${totalUnlocked - 1} more — tap to view all</div>` : '<div style="font-size:0.75em;color:rgba(255,255,255,0.8);margin-top:4px;">' + BB.t('journal.ui.tapToView') + '</div>';
        toast.innerHTML = `<div style="font-size:2em;margin-bottom:4px;">${ach.emoji}</div><div style="font-weight:700;font-size:0.95em;margin-bottom:2px;">${BB.t('journal.ui.achievementUnlocked')}</div><div style="font-weight:600;font-size:0.88em;">${ach.title}</div><div style="font-size:0.78em;color:rgba(255,255,255,0.85);margin-top:2px;">${ach.desc}</div>${extraLabel}`;
        Object.assign(toast.style, {
          position:'fixed', bottom:'90px', left:'50%', transform:'translateX(-50%) translateY(10px)',
          background:'linear-gradient(135deg,var(--brand-primary-mid),var(--brand-primary-light))', color:'white',
          borderRadius:'16px', padding:'14px 20px', boxShadow:'0 8px 32px rgba(255,107,0,0.45)',
          textAlign:'center', zIndex:'9999', minWidth:'220px', maxWidth:'280px',
          opacity:'0', transition:'opacity 0.4s ease, transform 0.4s ease', cursor:'pointer',
        });
        toast.addEventListener('click', () => {
          toast.remove();
          document.getElementById('settingsModal').classList.add('active');
          showAchievementsPanel();
        });
        document.body.appendChild(toast);
        requestAnimationFrame(() => { toast.style.opacity='1'; toast.style.transform='translateX(-50%) translateY(0)'; });
        setTimeout(() => {
          toast.style.opacity='0'; toast.style.transform='translateX(-50%) translateY(10px)';
          setTimeout(() => toast.remove(), 400);
        }, 3500);
      });
    }

    function _updateAchNotifBtn() {
      const enabled = localStorage.getItem('achievementToastsEnabled') !== 'false';
      const btn = document.getElementById('achNotifToggleBtn');
      if (btn) btn.textContent = enabled ? '🔔 Turn off notifications' : '🔕 Turn on notifications';
    }

    function toggleAchievementNotifications() {
      const enabled = localStorage.getItem('achievementToastsEnabled') !== 'false';
      const next = !enabled;
      localStorage.setItem('achievementToastsEnabled', next ? 'true' : 'false');
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ achievementToastsEnabled: next }, { merge: true }).catch(() => {});
      }
      _updateAchNotifBtn();
    }

    function showAchievementsPanel() {
      const stored = JSON.parse(localStorage.getItem('unlockedAchievements') || '[]');
      document.getElementById('settingsMainPanel').style.display = 'none';
      document.getElementById('settingsAchievementsPanel').style.display = '';
      const unlockedCount = ACHIEVEMENTS.filter(a => stored.includes(a.id)).length;
      document.getElementById('achievementsCount').textContent = `${unlockedCount} / ${ACHIEVEMENTS.length} unlocked`;
      _updateAchNotifBtn();
      document.getElementById('achievementsGrid').innerHTML = ACHIEVEMENTS.map(a => {
        const unlocked = stored.includes(a.id);
        return `<div style="text-align:center;padding:12px 8px;background:${unlocked ? 'rgba(255,149,0,0.1)' : '#f8f9fa'};border:1.5px solid ${unlocked ? 'var(--brand-primary)' : '#e9ecef'};border-radius:12px;opacity:${unlocked ? '1' : '0.4'};">
          <div style="font-size:1.8em;margin-bottom:4px;filter:${unlocked ? 'none' : 'grayscale(1)'};">${a.emoji}</div>
          <div style="font-weight:700;font-size:0.78em;color:${unlocked ? 'var(--brand-primary-dark)' : '#6c757d'};line-height:1.2;margin-bottom:2px;">${a.title}</div>
          <div style="font-size:0.7em;color:#6c757d;line-height:1.3;">${a.desc}</div>
        </div>`;
      }).join('');
    }

    function closeAchievementsPanel() {
      document.getElementById('settingsAchievementsPanel').style.display = 'none';
      document.getElementById('settingsMainPanel').style.display = '';
    }

    window.checkAchievements = checkAchievements;
    window.showAchievementsPanel = showAchievementsPanel;
    window.closeAchievementsPanel = closeAchievementsPanel;
    window.toggleAchievementNotifications = toggleAchievementNotifications;

    function updateDatePickerStatus(entries) {
      const input = document.getElementById('entryDate');
      if (!input) return;
      if (entries.length === 0) {
        // No entries yet — show the form, hide placeholder, keep journal toggle hidden
        const placeholder = document.getElementById('entryLoadingPlaceholder');
        if (placeholder) placeholder.style.display = 'none';
        const toggleSection = document.getElementById('journalToggleSection');
        if (toggleSection) toggleSection.style.display = 'none';
        document.getElementById('todayCompleteSection').style.display = 'none';
        document.getElementById('entryFormCard').style.display = '';
        showDatePickerForNew();
        if (typeof _maybeFocusedModeAfterFormShown !== 'undefined') _maybeFocusedModeAfterFormShown();
        _fmDeepLinkResolve(true); // ?mood= deep link (see its definition)
        return;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const todayKey = toKey(today);

      // Build a set of entry date keys
      const entryDates = new Set(entries.map(e => {
        const d = new Date(e.date);
        return toKey(d);
      }));

      // Hide loading placeholder and reveal journal toggle now that we know the state
      const placeholder = document.getElementById('entryLoadingPlaceholder');
      if (placeholder) placeholder.style.display = 'none';
      const toggleSection = document.getElementById('journalToggleSection');
      if (toggleSection) toggleSection.style.display = '';

      // Show/hide form based on whether the "current" date entry exists (yesterday or today mode)
      const useToday = localStorage.getItem('journalDefaultToday') === 'true';
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const currentKey = useToday ? todayKey : toKey(yesterday);
      const currentDone = entryDates.has(currentKey);
      try { BB.storage.set('_entryStatus', JSON.stringify({ key: currentKey, done: currentDone })); } catch(e) {}
      if (_suppressFormOpen) {
        _suppressFormOpen = false;
        document.getElementById('entryFormCard').style.display = 'none';
        document.getElementById('entryDateSection').style.display = 'none';
      } else {
        const _inFocusMode = typeof _fmEnabled !== 'undefined' && _fmEnabled;
        // Always hide the regular form when FM is on — _maybeFocusedModeAfterFormShown opens FM instead
        document.getElementById('entryFormCard').style.display = (currentDone || _inFocusMode) ? 'none' : '';
        if (!currentDone) {
          showDatePickerForNew();
          if (typeof _maybeFocusedModeAfterFormShown !== 'undefined') _maybeFocusedModeAfterFormShown();
        } else {
          document.getElementById('entryDateSection').style.display = 'none';
          // Close focused mode card only if it's targeting the same date that's now done
          // (not if user has already moved to the other date)
          if (typeof _fmActive !== 'undefined' && _fmActive) {
            const _fmDate = document.getElementById('entryDate')?.value;
            if (!_fmDate || _fmDate === currentKey) {
              _fmActive = false;
              document.getElementById('focusedModeCard').style.display = 'none';
              const _fmEl = document.getElementById('fmExitLink');
              if (_fmEl) _fmEl.style.display = 'none';
            }
          }
        }
      }
      // ?mood= deep link: apply to the check-in that just opened, or drop it
      // when the day's entry is already complete.
      _fmDeepLinkResolve(!currentDone);
      document.getElementById('todayCompleteSection').style.display = currentDone ? '' : 'none';
      const label = document.getElementById('entryCompleteLabel');
      if (label) label.textContent = (window.BB && BB.t)
        ? BB.t(useToday ? 'journal.prompt.viewTodayEntry' : 'journal.prompt.viewYesterdayEntry')
        : (useToday ? "View today's entry" : "View yesterday's entry");

      const otherKey = useToday ? toKey(yesterday) : todayKey;
      const otherDone = entryDates.has(otherKey);

      // Keep a reference to the current entry for the view/edit button
      _todayEntryRef = currentDone ? (entries.find(e => toKey(new Date(e.date)) === currentKey) || null) : null;
      _todayCurrentKey = currentDone ? currentKey : null;

      // Update widget via shared UserDefaults (iOS) or Capacitor plugin (Android)
      const _widgetLogoVariant = parseInt(localStorage.getItem('logoVariant') || '0');
      const _widgetLoggingToday = localStorage.getItem('journalDefaultToday') === 'true';
      // Build last-5-days completion string: index 0 = current target day, going back
      const _refDate = useToday ? today : yesterday;
      const _last5 = Array.from({ length: 5 }, (_, i) => {
        const d = new Date(_refDate); d.setDate(d.getDate() - i);
        return entryDates.has(toKey(d)) ? '1' : '0';
      }).join('');
      if (window.webkit?.messageHandlers?.setSharedData) {
        window.webkit.messageHandlers.setSharedData.postMessage({ entryComplete: currentDone, entryDate: currentKey, streak: window._currentStreak || 0, logoVariant: _widgetLogoVariant, loggingToday: _widgetLoggingToday, last5Days: _last5 });
      } else if (isAndroid()) {
        const widgetPlugin = getPlugin('BipolarBearWidget');
        if (widgetPlugin) widgetPlugin.setSharedData({ entryComplete: currentDone, entryDate: currentKey, streak: window._currentStreak || 0, logoVariant: _widgetLogoVariant, loggingToday: _widgetLoggingToday, last5Days: _last5 });
      }

      // Count missing entries in the last 30 days (same calculation as stats)
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 29);
      thirtyDaysAgo.setHours(0, 0, 0, 0);
      const sortedByDate = [...entries].sort((a, b) => a.timestamp - b.timestamp);
      const firstEntryDate = new Date(sortedByDate[0].date);
      firstEntryDate.setHours(0, 0, 0, 0);
      const countStart = firstEntryDate > thirtyDaysAgo ? firstEntryDate : thirtyDaysAgo;

      // Exclude the current target date from the missing count — user may be about to fill it in.
      // In yesterday mode that's yesterday; in today mode that's today.
      const missingCutoff = useToday ? today : yesterday;

      let missingCount = 0;
      let countCheck = new Date(countStart);
      while (countCheck < missingCutoff) {
        if (!entryDates.has(toKey(countCheck))) missingCount++;
        countCheck.setDate(countCheck.getDate() + 1);
      }

      const actionsRow = document.getElementById('completionActionsRow');
      const missingAction = document.getElementById('missingEntriesAction');
      const otherBtn = document.getElementById('startOtherEntryBtn');
      const note = document.getElementById('missingEntriesNote');

      if (currentDone) {
        const _t = (k, vars) => (window.BB && BB.t) ? BB.t(k, vars) : k;
        // Show action pills below the complete banner
        if (missingAction) {
          if (missingCount > 0) {
            missingAction.textContent = _t('journal.banner.missingEntries', { count: missingCount });
            missingAction.style.background = 'var(--brand-btn)';
            missingAction.style.color = 'white';
            missingAction.style.border = 'none';
            missingAction.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
          } else {
            missingAction.textContent = _t('journal.banner.missingEntries', { count: 0 });
            missingAction.style.background = 'rgba(90,42,0,0.45)';
            missingAction.style.color = '#fff';
            missingAction.style.border = '1.5px solid rgba(255,255,255,0.2)';
            missingAction.style.boxShadow = 'none';
          }
          missingAction.style.display = '';
        }
        if (otherBtn) {
          if (!useToday) {
            // Yesterday mode: show streak in place of "Log today" button
            const _streak = window._currentStreak || 0;
            otherBtn.textContent = _t('journal.banner.streak', { count: _streak });
            otherBtn.style.background = 'rgba(255,255,255,0.1)';
            otherBtn.style.color = 'rgba(255,255,255,0.75)';
            otherBtn.style.border = '1.5px solid rgba(255,255,255,0.2)';
            otherBtn.style.boxShadow = 'none';
            otherBtn.style.cursor = 'default';
            otherBtn.onclick = null;
          } else if (otherDone) {
            otherBtn.textContent = _t('journal.banner.last24Done');
            otherBtn.style.background = 'rgba(255,255,255,0.1)';
            otherBtn.style.color = 'rgba(255,255,255,0.6)';
            otherBtn.style.border = '1.5px solid rgba(255,255,255,0.2)';
            otherBtn.style.boxShadow = 'none';
            otherBtn.style.cursor = 'pointer';
            otherBtn.onclick = reviewOtherEntry;
          } else {
            otherBtn.textContent = _t('journal.banner.last24Log');
            otherBtn.style.background = 'var(--brand-btn)';
            otherBtn.style.color = 'white';
            otherBtn.style.border = 'none';
            otherBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
            otherBtn.style.cursor = 'pointer';
            otherBtn.onclick = startOtherDateEntry;
          }
          otherBtn.style.display = '';
        }
        if (actionsRow) actionsRow.style.display = 'flex';
        if (note) note.style.display = 'none';
      } else {
        // Form is visible — hide pill for a cleaner look
        if (actionsRow) actionsRow.style.display = 'none';
        if (note) { note.innerHTML = ''; note.style.display = 'none'; }
      }
    }

    // Show section with toggle (new entry — date defaults to today, picker hidden)
    function newEntryBtnLabel() {
      const _t = (k) => (window.BB && BB.t) ? BB.t(k) : k;
      return localStorage.getItem('journalDefaultToday') === 'true'
        ? _t('journal.save.submitToday')
        : _t('journal.save.submitLast24');
    }

    function showDatePickerForNew() {
      document.getElementById('entryDateSection').style.display = '';
      document.getElementById('datePickerField').style.display = 'none';
      document.getElementById('submitBtn').textContent = newEntryBtnLabel();
      const _editDelBtn = document.getElementById('editDeleteBtn');
      if (_editDelBtn) _editDelBtn.style.display = 'none';
      const _draftClearBtn = document.getElementById('draftClearBtn');
      if (_draftClearBtn) _draftClearBtn.style.display = '';
      const _editCancelBtn = document.getElementById('editCancelBtn');
      if (_editCancelBtn) _editCancelBtn.style.display = 'none';
      const _formCalBtn = document.getElementById('formCalendarBtn');
      if (_formCalBtn) _formCalBtn.style.display = '';

      // Set PDF hide default from incognito mode setting
      setPdfHide(localStorage.getItem('incognitoMode') === 'true');

      // Apply more-data open-by-default preference
      const _mdd = localStorage.getItem('moreDataOpenByDefault') === 'true';
      const _mds = document.getElementById('moreDataSection');
      const _mdt = document.getElementById('moreDataToggle');
      if (_mds) _mds.style.display = _mdd ? 'block' : 'none';
      if (_mdt) _mdt.textContent = _mdd ? BB.t('journal.lessData') : BB.t('journal.moreData');
      _applyMoreDataDefaultToggle(_mdd);

      setDefaultDate();
      _applySleepLock();
      // Restore any saved draft for today/yesterday (runs async-safe after DOM is ready)
      setTimeout(restoreDraft, 0);
      // Restart mood cycle in case it was stopped by a previous mood selection or edit
      if (window._startMoodCycle) window._startMoodCycle();
      // Briefly block pointer events on mood buttons to prevent ghost-touch from
      // the tap that opened this form landing on a mood button
      const moodSel = document.querySelector('.mood-selector');
      if (moodSel) {
        moodSel.style.pointerEvents = 'none';
        setTimeout(() => { moodSel.style.pointerEvents = ''; }, 400);
      }
    }

    // Show section with picker visible (edit mode)
    function showDatePickerForEdit() {
      document.getElementById('entryDateSection').style.display = '';
      document.getElementById('datePickerField').style.display = '';
      const _formCalBtn = document.getElementById('formCalendarBtn');
      if (_formCalBtn) _formCalBtn.style.display = 'none';
    }

    // Toggle button click — reveal picker, switch button to "Use today"
    function toggleDatePicker() {
      const field = document.getElementById('datePickerField');
      const dateInput = document.getElementById('entryDate');
      if (field.style.display === 'none') {
        field.style.display = '';
        // Anchor viewport: compensate for the height added above scroll position
        const delta = field.offsetHeight;
        if (delta > 0) window.scrollBy({ top: delta, behavior: 'instant' });
        if (!dateInput.value) setDefaultDate();
        // Open native date picker immediately
        try { dateInput.showPicker(); } catch(e) { dateInput.focus(); }
      } else {
        // Read height before hiding so we can compensate
        const delta = field.offsetHeight;
        field.style.display = 'none';
        if (delta > 0) window.scrollBy({ top: -delta, behavior: 'instant' });
        // Do NOT reset date on close — preserves any date the user already changed to
      }
    }
    window.toggleDatePicker = toggleDatePicker;

    let _todayEntryRef = null;
    let _todayCurrentKey = null;

    function viewTodayEntry() {
      if (!_todayCurrentKey) return;
      showCalDayDetail(_todayCurrentKey);
    }
    window.viewTodayEntry = viewTodayEntry;

    function editTodayEntry() {
      if (!_todayEntryRef) return;
      // Show form again in case user saves and re-opens
      document.getElementById('entryFormCard').style.display = '';
      showDatePickerForEdit();
      document.getElementById('todayCompleteSection').style.display = 'none';
      openEditInForm(_todayEntryRef);
    }
    window.editTodayEntry = editTodayEntry;

    function cancelNewEntry() {
      if (typeof _fmActive !== 'undefined' && _fmActive) {
        _fmActive = false;
        document.getElementById('focusedModeCard').style.display = 'none';
        const _elCancel = document.getElementById('fmExitLink');
        if (_elCancel) _elCancel.style.display = 'none';
      }
      // Draft is gone — the "Continue your entry" exited view no longer applies.
      _fmUserExited = false;
      if (typeof _fmClearExitedView === 'function') _fmClearExitedView();
      const _rsCnc = document.getElementById('fmResumeSection');
      if (_rsCnc) _rsCnc.style.display = 'none';
      clearDraft();
      resetEntryForm();
      document.getElementById('entryFormCard').style.display = 'none';
      const _fflCnc = document.getElementById('fullFormExitLink');
      if (_fflCnc) _fflCnc.style.display = 'none';
      const placeholder = document.getElementById('entryLoadingPlaceholder');
      if (placeholder) placeholder.style.display = '';
      const toggleSection = document.getElementById('journalToggleSection');
      if (toggleSection) toggleSection.style.display = 'none';
      loadEntries();
    }
    window.cancelNewEntry = cancelNewEntry;

    function clearDraftWithConfirm() {
      // Confirm only if the user entered something beyond mood + default energy/sleep
      const hasNotes = document.getElementById('notes')?.value.trim().length > 0;
      const hasNonDefaultEnergy = selectedEnergy !== 5;
      const hasNonDefaultSleep = selectedSleep !== 7.5;
      const hasExtras = selectedMedication || selectedGoals || selectedAnxiety ||
                        selectedStress || selectedIrritability || selectedExercise ||
                        selectedOutside || selectedAlcohol || selectedSmoking || selectedDrugs ||
                        selectedPdfHide || selectedFavourite ||
                        (selectedCustom && Object.values(selectedCustom).some(v => v));
      const hasMeaningfulData = hasNotes || hasNonDefaultEnergy || hasNonDefaultSleep || hasExtras;

      if (!hasMeaningfulData) {
        cancelNewEntry();
        return;
      }
      pendingDraftClear = true;
      document.getElementById('confirmModalTitle').textContent = BB.t('journal.clearDraft.title');
      document.getElementById('confirmModalBody').textContent = BB.t('journal.clearDraft.body');
      document.getElementById('confirmModalBtn').textContent = BB.t('journal.clearDraft.btn');
      document.getElementById('confirmModal').classList.add('active');
    }
    window.clearDraftWithConfirm = clearDraftWithConfirm;

    function cancelEdit() {
      editingEntry = null;
      _editFieldOverrides = null;
      _editOriginalState = null;
      _fmSuppressReopen = false;
      _fmReturnToDone   = false;
      resetEntryForm();
      if (typeof _fmActive !== 'undefined' && _fmActive) {
        _fmActive = false;
        document.getElementById('focusedModeCard').style.display = 'none';
        const _elc = document.getElementById('fmExitLink');
        if (_elc) _elc.style.display = 'none';
      }
      // Hide the form and show the loading spinner before loadEntries runs,
      // matching the initial page-load experience.
      document.getElementById('entryFormCard').style.display = 'none';
      const _fflEdit = document.getElementById('fullFormExitLink');
      if (_fflEdit) _fflEdit.style.display = 'none';
      document.getElementById('todayCompleteSection').style.display = 'none';
      const placeholder = document.getElementById('entryLoadingPlaceholder');
      if (placeholder) placeholder.style.display = '';
      const toggleSection = document.getElementById('journalToggleSection');
      if (toggleSection) toggleSection.style.display = 'none';
      loadEntries();
    }
    window.cancelEdit = cancelEdit;

    function _captureEditState(entry) {
      _editOriginalState = {
        mood:         entry.mood,
        linkedMood:   entry.linkedMood || null,
        energy:       entry.energy,
        sleep:        entry.sleep,
        sleepQuality: entry.sleepQuality || null,
        intention:    entry.intention || '',
        medication:   entry.medication || null,
        goals:        entry.goals === 'not-100' ? 'none' : (entry.goals || null),
        budget:       entry.budget || null,
        exercise:     entry.exercise || null,
        outside:      entry.outside || null,
        anxiety:      entry.anxiety || null,
        stress:       entry.stress || null,
        irritability: entry.irritability || null,
        alcohol:      entry.alcohol || null,
        smoking:      entry.smoking || null,
        drugs:        entry.drugs || null,
        notes:        entry.notes || '',
        pdfHidden:    !!entry.pdfHidden,
        favourite:    !!entry.favourite,
        customFields: JSON.stringify(entry.customFields || {}),
      };
    }

    function _editCurrentState() {
      const notesEl = document.getElementById('fmNotesInput') || document.getElementById('notes');
      return {
        mood:         selectedMood,
        linkedMood:   selectedLinkedMood || null,
        energy:       _getDisabledSteps().includes('energy') ? null : selectedEnergy,
        sleep:        selectedSleep,
        sleepQuality: selectedSleepQuality || null,
        intention:    (document.getElementById('fmIntentionInput') || {}).value ?? selectedIntention,
        medication:   selectedMedication,
        goals:        selectedGoals,
        budget:       selectedBudget,
        exercise:     selectedExercise,
        outside:      selectedOutside,
        anxiety:      selectedAnxiety,
        stress:       selectedStress,
        irritability: selectedIrritability,
        alcohol:      selectedAlcohol,
        smoking:      selectedSmoking,
        drugs:        selectedDrugs,
        notes:        (notesEl || {}).value || '',
        pdfHidden:    selectedPdfHide,
        favourite:    selectedFavourite,
        customFields: JSON.stringify(selectedCustom || {}),
      };
    }

    function _hasEditChanges() {
      if (!_editOriginalState) return true;
      return JSON.stringify(_editCurrentState()) !== JSON.stringify(_editOriginalState);
    }

    // Update the regular-form submit button appearance based on whether changes exist
    function _updateEditBtn() {
      if (!editingEntry) return;
      const btn = document.getElementById('submitBtn');
      if (!btn) return;
      const _t = (k) => (window.BB && BB.t) ? BB.t(k) : k;
      if (_hasEditChanges()) {
        btn.textContent = _t('journal.save.confirmBtnEdit');
        btn.style.background = '';
        btn.style.color = '';
        btn.style.border = '';
      } else {
        btn.textContent = _t('journal.save.fmClose');
        btn.style.background = '#adb5bd';
        btn.style.color = 'white';
        btn.style.border = '2px solid #adb5bd';
      }
    }
    window._updateEditBtn = _updateEditBtn;

    function _otherDateStr() {
      const useToday = localStorage.getItem('journalDefaultToday') === 'true';
      const other = new Date(); other.setHours(0, 0, 0, 0);
      if (useToday) other.setDate(other.getDate() - 1);
      return `${other.getFullYear()}-${String(other.getMonth()+1).padStart(2,'0')}-${String(other.getDate()).padStart(2,'0')}`;
    }

    function startOtherDateEntry() {
      editingEntry = null;
      _editFieldOverrides = null;
      const dateStr = _otherDateStr();
      document.getElementById('todayCompleteSection').style.display = 'none';
      document.getElementById('entryFormCard').style.display = '';
      resetEntryForm();
      applyTrackingPrefs();
      showDatePickerForNew();
 // sets default date + schedules restoreDraft via setTimeout
      // Override date to the "other" date — restoreDraft (scheduled above) will see this
      document.getElementById('entryDate').value = dateStr;
      _applySleepLock();
      updateFormHeading();
      // Fix submit button label to reflect the actual date, not the default setting
      const now = new Date(); now.setHours(0,0,0,0);
      const toKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const btn = document.getElementById('submitBtn');
      if (btn) btn.textContent = (window.BB && BB.t) ? BB.t(dateStr === toKey(now) ? 'journal.save.submitToday' : 'journal.save.submitYesterday') : (dateStr === toKey(now) ? "Save Today's Entry ✨" : "Log Yesterday's Entry ✨");
      const _sodeCard = document.getElementById('entryFormCard');
      if (_sodeCard) setTimeout(() => { const _r = _sodeCard.getBoundingClientRect(); window.scrollTo({ top: Math.max(0, _r.top + window.scrollY - Math.max(16, (window.innerHeight - _r.height) / 2)), behavior: 'smooth' }); }, 80);
      _maybeFocusedModeAfterFormShown();
      // Rebuild focus steps in the next tick (after restoreDraft) to catch async state — e.g.
      // currentMedList may not yet be in localStorage when _buildFocusedSteps() runs above.
      setTimeout(() => {
        if (typeof _fmActive !== 'undefined' && _fmActive && _fmStepIndex === 0) {
          let _hasMedNow = false;
          try { const _ml = JSON.parse(localStorage.getItem('currentMedList') || '[]'); _hasMedNow = Array.isArray(_ml) ? _ml.length > 0 : false; } catch(e) {}
          const _medInSteps = _fmSteps && _fmSteps.some(s => s.id === 'medication');
          if (_hasMedNow && !_medInSteps) {
            _fmSteps = _buildFocusedSteps();
            _renderFocusedStep();
          }
        }
      }, 0);
    }
    window.startOtherDateEntry = startOtherDateEntry;

    function reviewOtherEntry() {
      const dateStr = _otherDateStr();
      const entry = _allEntries.find(e => {
        if (!e.date) return false;
        if (typeof e.date === 'string' && e.date.slice(0, 10) === dateStr) return true;
        try { const d = new Date(e.date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` === dateStr; } catch(_) { return false; }
      });
      if (!entry) return;
      document.getElementById('todayCompleteSection').style.display = 'none';
      const _inFm = typeof _fmEnabled !== 'undefined' && _fmEnabled;
      if (!_inFm) document.getElementById('entryFormCard').style.display = '';
      openEditInForm(entry);
      if (!_inFm) {
        const heading = document.getElementById('entryFormHeading');
        if (heading) setTimeout(() => { const _t = heading.getBoundingClientRect().top + window.scrollY - 16; window.scrollTo({ top: _t, behavior: 'smooth' }); }, 50);
      }
    }
    window.reviewOtherEntry = reviewOtherEntry;

    function displayChart(entries) {
      const chartContainer = document.getElementById('chart');
      const monthCalContainer = document.getElementById('monthCalendar');

      if (entries.length <= 1) {
        chartContainer.style.display = 'none';
        if (monthCalContainer) monthCalContainer.innerHTML = '';
        return;
      }

      // Show different visualizations based on timeframe
      if (statsTimeframe === 'all') {
        // Show year calendar grid for all-time view
        chartContainer.style.display = 'block';
        displayYearCalendar(entries, chartContainer);
        if (monthCalContainer) monthCalContainer.innerHTML = '';
      } else {
        // Show this month calendar only (no bar chart)
        chartContainer.style.display = 'none';
        displayMonthCalendar(entries, monthCalContainer);
      }
    }

    function parseBirthdayMonthDay() {
      const dob = localStorage.getItem('personalDOB') || '';
      if (!dob.trim()) return null;
      const d = new Date(dob);
      if (isNaN(d.getTime())) return null;
      return { month: d.getMonth(), day: d.getDate() };
    }

    /**
     * The calendar months a multi-month timeframe window covers, each clipped to
     * the part that's inside the window and already finished.
     *
     * Scoring stops at YESTERDAY. Today is still in progress — the entry for it
     * may not have been written yet — so counting it would leave the current
     * month permanently amber until the moment the day is logged.
     *
     * The window is counted back from today (not from the most recent entry, as
     * the stats card's "since" label does) — these boxes are about which days are
     * missing, so anchoring anywhere else makes "already finished" incoherent.
     *
     * @param {Date} today midnight today
     * @returns {Array<{year:number, month:number, from:Date, to:Date}>} empty for
     *   'all' and for windows under 60 days, which sit inside one or two months
     *   and are already fully visible in the calendar below.
     */
    function _timeframeMonthSpans(today) {
      if (typeof statsTimeframe !== 'number' || statsTimeframe < 60) return [];
      const start = new Date(today);
      start.setDate(start.getDate() - (statsTimeframe - 1));
      // Last scoreable day. On the 1st of a month this lands in the previous
      // month, so the current month contributes no span and its box drops out
      // (the `from <= to` guard below) rather than showing a meaningless 0/0.
      const lastDay = new Date(today);
      lastDay.setDate(lastDay.getDate() - 1);
      const endMonth = new Date(lastDay.getFullYear(), lastDay.getMonth(), 1);
      const spans = [];
      let cur = new Date(start.getFullYear(), start.getMonth(), 1);
      // Ceiling so a large custom window (say 800 days) can't emit an unreadable
      // wall of boxes. Trimmed from the oldest end below, keeping recent months.
      while (cur <= endMonth && spans.length < 400) {
        const mStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
        const mEnd   = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
        const from = mStart < start ? start : mStart;
        const to   = mEnd > lastDay ? lastDay : mEnd;
        if (from <= to) spans.push({ year: cur.getFullYear(), month: cur.getMonth(), from, to });
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
      return spans.length > 12 ? spans.slice(spans.length - 12) : spans;
    }

    /**
     * Row of per-month completeness boxes shown above the calendar on the 60d /
     * 90d (and 60+ custom) timeframes. Green when every in-window day of that
     * month has an entry, amber when any are missing. Tapping one opens that
     * month in the calendar below.
     *
     * @param {Object<string, object>} moodByDate date-key → entry, as built by
     *   displayMonthCalendar
     * @param {Date} today midnight today
     * @param {number} openYear  year currently shown in the calendar
     * @param {number} openMonth month currently shown in the calendar
     */
    function _monthCompletenessHtml(moodByDate, today, openYear, openMonth) {
      const spans = _timeframeMonthSpans(today);
      if (spans.length < 2) return '';
      const boxes = spans.map(sp => {
        let logged = 0, total = 0;
        const d = new Date(sp.from);
        while (d <= sp.to) {
          total++;
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          if (moodByDate[key]) logged++;
          d.setDate(d.getDate() + 1);
        }
        const complete = total > 0 && logged === total;
        const color = complete ? '#2ECC40' : '#FF851B';
        const name = new Date(sp.year, sp.month, 1).toLocaleString('en-GB', { month: 'long' });
        const isOpen = sp.year === openYear && sp.month === openMonth;
        // The month is only PART of the window at the oldest end, so say how many
        // days were actually judged — otherwise "12/23" for a 31-day month reads
        // like a bug rather than the window starting mid-month.
        const partial = sp.from.getDate() !== 1 || (sp.to.getDate() !== new Date(sp.year, sp.month + 1, 0).getDate());
        const title = `${name} ${sp.year}: ${logged} of ${total} day${total === 1 ? '' : 's'} logged${partial ? ' (within the selected window, up to yesterday)' : ''}`;
        return `<button type="button" onclick="_openMonthFromBox(${sp.year},${sp.month})" title="${title}"
            style="flex:1 1 0;min-width:74px;background:${color}1a;border:${isOpen ? `2.5px solid ${color}` : `1.5px solid ${color}66`};border-radius:12px;padding:8px 6px;cursor:pointer;-webkit-tap-highlight-color:transparent;display:flex;flex-direction:column;align-items:center;gap:2px;">
            <span style="font-size:0.8em;font-weight:700;color:${color};">${name}</span>
            <span style="font-size:0.72em;font-weight:600;color:#6c757d;">${complete ? '✓' : `${logged}/${total}`}</span>
          </button>`;
      }).join('');
      return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;">${boxes}</div>`;
    }

    /** Open a month from a completeness box in the calendar below. */
    function _openMonthFromBox(year, month) {
      const now = new Date();
      // Exact month arithmetic — applyCalMonthPicker's 30.44-day division is only
      // approximate and drifts across long spans.
      _monthCalOffset = Math.min(0, (year - now.getFullYear()) * 12 + (month - now.getMonth()));
      displayMonthCalendar(_monthCalEntries, document.getElementById('monthCalendar'));
      const cal = document.getElementById('monthCalendar');
      if (cal) { try { cal.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {} }
    }
    window._openMonthFromBox = _openMonthFromBox;

    function displayMonthCalendar(entries, container) {
      if (!container) return;
      _monthCalEntries = entries;

      const today = new Date(); today.setHours(0,0,0,0);
      const birthday = parseBirthdayMonthDay();

      // Compute displayed month from offset
      const displayDate = new Date(today.getFullYear(), today.getMonth() + _monthCalOffset, 1);
      const year = displayDate.getFullYear();
      const month = displayDate.getMonth();
      const monthName = displayDate.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
      const lastDay = new Date(year, month + 1, 0).getDate();

      // Build date → entry map
      const moodByDate = {};
      entries.forEach(e => {
        const d = new Date(e.date);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        moodByDate[key] = e;
      });

      // Mon-based start offset (0=Mon … 6=Sun)
      let startDow = new Date(year, month, 1).getDay();
      startDow = startDow === 0 ? 6 : startDow - 1;

      const dayHeaders = ['M','T','W','T','F','S','S'].map(
        h => `<div style="text-align:center;font-size:0.72em;color:#adb5bd;font-weight:600;">${h}</div>`
      ).join('');

      // Fill trailing days from previous month (dimmed, clickable if entry exists)
      const prevYear = month === 0 ? year - 1 : year;
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevMonthLastDay = new Date(year, month, 0).getDate();
      let cells = '';
      for (let i = startDow - 1; i >= 0; i--) {
        const d = prevMonthLastDay - i;
        const key = `${prevYear}-${String(prevMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const entry = moodByDate[key];
        const bg = entry ? moodColors[_moodCat(entry.mood)] : '#e9ecef';
        const clickable = !!entry;
        cells += `<div ${clickable ? `onclick="showCalDayDetail('${key}')" class="cal-cell"` : ''} style="aspect-ratio:1;background:${bg};border-radius:6px;border:2px solid transparent;display:flex;align-items:center;justify-content:center;font-size:0.7em;color:${entry?'white':'#c8ced4'};font-weight:600;opacity:0.4;${clickable?'cursor:pointer;':''}">${d}</div>`;
      }

      for (let d = 1; d <= lastDay; d++) {
        const date = new Date(year, month, d);
        const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const entry = moodByDate[key];
        const isToday = date.getTime() === today.getTime();
        const isYesterday = date.getTime() === today.getTime() - 86400000;
        const isTomorrow = date.getTime() === today.getTime() + 86400000;
        const isFuture = date > today;
        const isCurrentMonth = _monthCalOffset === 0;
        const isBirthday = birthday && date.getMonth() === birthday.month && d === birthday.day;
        const bg = entry ? moodColors[_moodCat(entry.mood)] : (isFuture && !isCurrentMonth) ? 'transparent' : '#e9ecef';
        const border = isToday ? '2px solid var(--brand-primary)' : isBirthday ? '2px dashed #e91e8c' : '2px solid transparent';
        const color = entry ? 'white' : (isFuture && !isCurrentMonth) ? 'transparent' : '#adb5bd';
        const opacity = (isFuture && !isCurrentMonth) ? 0.25 : 1;
        let displayText = d;
        let extraStyle = '';
        if (isToday || isYesterday || isTomorrow || isBirthday) {
          extraStyle = 'flex-direction:column;gap:1px;';
          if (isToday && isBirthday) displayText = `<span style="line-height:1;">${d}</span><span style="font-size:0.55em;line-height:1;"><span style="font-size:1.3em;">🎂</span></span>`;
          else if (isToday) displayText = `<span style="line-height:1;">${d}</span><span style="font-size:0.55em;line-height:1;">${BB.t('journal.ui.today')}</span>`;
          else if (isYesterday) displayText = `<span style="line-height:1;">${d}</span><span style="font-size:0.55em;line-height:1;">${BB.t('journal.ui.yesterday')}</span>`;
          else if (isTomorrow) displayText = `<span style="line-height:1;">${d}</span><span style="font-size:0.55em;line-height:1;">${BB.t('journal.ui.tomorrow')}</span>`;
          else if (isBirthday) displayText = `<span style="line-height:1;">${d}</span><span style="font-size:0.8em;line-height:1;">🎂</span>`;
        }
        cells += `<div ${!isFuture ? `onclick="showCalDayDetail('${key}')" class="cal-cell"` : ''} style="aspect-ratio:1;overflow:hidden;background:${bg};border-radius:6px;border:${border};display:flex;align-items:center;justify-content:center;${extraStyle}font-size:0.7em;color:${color};font-weight:600;opacity:${opacity};${!isFuture?'cursor:pointer;':''}">${displayText}</div>`;
      }

      const _mCounts = {};
      const _mYYYYMM = `${year}-${String(month + 1).padStart(2, '0')}`;
      entries.filter(e => e.date && e.date.startsWith(_mYYYYMM)).forEach(e => { if (e.mood != null && e.mood !== '') { const m = _moodCat(e.mood); _mCounts[m] = (_mCounts[m] || 0) + 1; } });
      const legend = Object.entries(_mCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([mood, cnt]) => {
          const color = moodColors[mood];
          return `<span onclick="showStatDetail('moodSummary')" style="display:flex;align-items:center;gap:3px;cursor:pointer;" title="${cnt} days"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0;"></span><span style="font-size:0.72em;color:#6c757d;">${mood.charAt(0).toUpperCase()+mood.slice(1)}</span></span>`;
        }).join('');

      const canGoForward = _monthCalOffset < 0;
      const navBtn = `background:none;border:none;color:#6c757d;font-size:1.1em;cursor:pointer;padding:0 6px;line-height:1;`;

      container.innerHTML = `
        <div style="background:#f8f9fa;border-radius:15px;padding:16px;margin-top:12px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <button onclick="navigateMonthCal(-1)" style="${navBtn}">‹</button>
            <button onclick="openCalMonthPicker()" style="font-weight:600;color:#495057;font-size:0.95em;background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:8px;text-decoration:underline dotted;text-underline-offset:3px;-webkit-tap-highlight-color:transparent;">${monthName}</button>
            <button onclick="navigateMonthCal(1)" style="${navBtn}opacity:${canGoForward?1:0.25};" ${canGoForward?'':'disabled'}>›</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px;">${dayHeaders}</div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${cells}</div>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px;">${legend}</div>
          ${_monthCompletenessHtml(moodByDate, today, year, month)}
        </div>`;
    }

    function navigateMonthCal(delta) {
      _monthCalOffset = Math.min(0, _monthCalOffset + delta);
      displayMonthCalendar(_monthCalEntries, document.getElementById('monthCalendar'));
    }
    window.navigateMonthCal = navigateMonthCal;

    function openCalMonthPicker() {
      const now = new Date();
      const current = new Date(now.getFullYear(), now.getMonth() + _monthCalOffset, 1);
      const monthSel = document.getElementById('calPickerMonth');
      const yearSel = document.getElementById('calPickerYear');
      const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      monthSel.innerHTML = monthNames.map((m, i) => `<option value="${i}"${i === current.getMonth() ? ' selected' : ''}>${m}</option>`).join('');
      // Show years from first entry year to 2 years in future
      const minYear = _monthCalEntries && _monthCalEntries.length
        ? new Date(Math.min(..._monthCalEntries.map(e => new Date(e.date).getFullYear()))).getFullYear()
        : now.getFullYear() - 2;
      const maxYear = now.getFullYear() + 2;
      yearSel.innerHTML = '';
      for (let y = maxYear; y >= minYear; y--) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === current.getFullYear()) opt.selected = true;
        yearSel.appendChild(opt);
      }
      document.getElementById('calMonthPickerModal').classList.add('active');
    }

    function closeCalMonthPicker() {
      document.getElementById('calMonthPickerModal').classList.remove('active');
    }

    function applyCalMonthPicker() {
      const month = parseInt(document.getElementById('calPickerMonth').value);
      const year = parseInt(document.getElementById('calPickerYear').value);
      const now = new Date(); now.setHours(0,0,0,0);
      const target = new Date(year, month, 1);
      const nowMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const diffMs = target - nowMonth;
      const diffMonths = Math.round(diffMs / (1000 * 60 * 60 * 24 * 30.44));
      _monthCalOffset = diffMonths;
      closeCalMonthPicker();
      displayMonthCalendar(_monthCalEntries, document.getElementById('monthCalendar'));
    }

    window.openCalMonthPicker = openCalMonthPicker;
    window.closeCalMonthPicker = closeCalMonthPicker;
    window.applyCalMonthPicker = applyCalMonthPicker;

    function _calRow(icon, label, value) {
      return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f0f2f4;">
        <span style="font-size:1em;width:20px;text-align:center;">${icon}</span>
        <span style="color:#6c757d;font-size:0.88em;flex:1;">${label}</span>
        <span style="font-weight:600;font-size:0.88em;color:#495057;">${value}</span>
      </div>`;
    }

    function showCalDayDetail(key) {
      const moodByDate = {};
      // Use _allEntries (always populated) with _monthCalEntries as a fallback
      // so the lookup works even before the calendar section has been rendered.
      const _sourceEntries = _allEntries.length ? _allEntries : _monthCalEntries;
      _sourceEntries.forEach(e => {
        const d = new Date(e.date);
        const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        moodByDate[k] = e;
      });

      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const dateStr = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const entry = moodByDate[key];

      const moodEmojis = { terrible: '😞', bad: '😔', okay: '😐', good: '🙂', great: '😄' };
      const _t = (k) => (window.BB && BB.t) ? BB.t(k) : k;
      const _tVal = (v) => {
        if (!v) return '';
        const _map = { yes:'journal.value.yes', no:'journal.value.no', good:'journal.value.good', ok:'journal.value.ok', bad:'journal.value.bad', high:'journal.value.high', medium:'journal.value.medium', low:'journal.value.low' };
        if (_map[v] && window.BB && BB.t) return BB.t(_map[v]);
        return v.charAt(0).toUpperCase() + v.slice(1);
      };
      const _tMood = (m) => {
        if (!m) return '';
        const _map = { manic:'mood.manic', elevated:'mood.elevated', good:'mood.good', low:'mood.low', depressed:'mood.depressed' };
        if (_map[m] && window.BB && BB.t) return BB.t(_map[m]);
        return m.charAt(0).toUpperCase() + m.slice(1);
      };
      const medLabels = { taken: _t('journal.med.taken'), missed: _t('journal.med.missed'), skipped: _t('journal.med.skipped'), unsure: _t('journal.med.unsure'), 'not-taken': _t('journal.med.notTaken') };
      const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

      let html = `<div style="font-weight:700;color:#495057;margin-bottom:14px;font-size:0.95em;">🗓️ ${dateStr}</div>`;

      if (!entry) {
        html += `<div style="color:#adb5bd;text-align:center;padding:10px 0 12px;font-size:0.9em;">${_t('journal.calendar.noEntry')}</div>
          <div style="text-align:center;">
            <button onclick="openFormForNewEntry('${key}')" class="confirm-btn confirm-btn-no" style="font-size:0.85em;">${_t('journal.calendar.addEntry')}</button>
          </div>`;
      } else {
        const color = moodColors[_moodCat(entry.mood)] || '#adb5bd';
        html += `<div style="background:${color};color:white;border-radius:10px;padding:10px 14px;font-weight:700;font-size:1em;margin-bottom:10px;">${_moodEmoji(entry.mood)} ${_moodLabelNum(entry.mood)}</div>`;
        html += `<div>`;
        if (entry.energy !== undefined) {
          const _stepsStr = entry.steps != null ? ` | 🏃 ${entry.steps >= 1000 ? Math.round(entry.steps/1000)+'k' : entry.steps}` : '';
          html += _calRow('⚡', _t('journal.label.energy'), `${entry.energy}/10${_stepsStr}`);
        }
        if (entry.sleep  != null) html += _calRow('😴', _t('journal.label.sleep'),  `${entry.sleep}h`);
        if (entry.sleepQuality) html += _calRow(entry.sleepQuality === 'good' ? '😊' : entry.sleepQuality === 'bad' ? '😴' : '😐', _t('journal.label.sleepQuality'), _tVal(entry.sleepQuality));
        if (entry.medication) html += _calRow('💊', _t('journal.label.medication'), medLabels[entry.medication] || cap(entry.medication));
        if (entry.anxiety)     html += _calRow('😰', _t('journal.label.anxiety'),     _tVal(entry.anxiety));
        if (entry.stress)      html += _calRow('😓', _t('journal.label.stress'),      _tVal(entry.stress));
        if (entry.irritability)html += _calRow('😤', _t('journal.label.irritability'), _tVal(entry.irritability));
        if (entry.alcohol)     html += _calRow('🍺', _t('journal.label.alcohol'),     _tVal(entry.alcohol));
        if (entry.smoking)     html += _calRow('🚬', _t('journal.label.smoked'),      _tVal(entry.smoking));
        if (entry.drugs)       html += _calRow('💊', _t('journal.label.drugs'),       _tVal(entry.drugs));
        if (entry.customFields) {
          getCustomFields().forEach(f => {
            const val = entry.customFields[f.id];
            if (val) html += _calRow(f.emoji || '•', f.label, cap(val));
          });
        }
        html += `</div>`;
        if (entry.notes && entry.notes.trim()) {
          html += `<div style="margin-top:10px;background:#f8f9fa;border-radius:8px;padding:10px;font-size:0.85em;color:#495057;font-style:italic;line-height:1.4;">"${entry.notes.trim()}"</div>`;
        }
        {
          // Show only the clean intention (strip elaborate step notes encoded after ___\n)
          const _intRaw = entry.intention ? entry.intention.trim() : '';
          const _intClean = _intRaw.split(/\n?_{3,}\n/)[0].trim();
          const _intEsc = _intClean.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          if (_intClean) {
            html += `<div style="background:var(--brand-tint);border-radius:8px;padding:10px;font-size:0.85em;color:#6c757d;line-height:1.4;margin-top:8px;">🌅 <b>Intention for tomorrow:</b> ${_intEsc}</div>`;
          }
        }
        // Bipolar Bear thought — collapsible, only shown when suggestion feature enabled
        if (localStorage.getItem('showMoodSuggestion') === '1') {
          const _est = _estimateMoodFromEntry(entry);
          if (_est.mood === 'stable') _est.secondMood = null;
          const _estColor  = _FM_MOOD_COLORS[_est.mood] || 'var(--brand-primary)';
          const _estLabel  = _FM_MOOD_LABELS[_est.mood] || cap(_est.mood);
          const _est2Color = _est.secondMood ? (_FM_MOOD_COLORS[_est.secondMood] || 'var(--brand-primary)') : null;
          const _est2Label = _est.secondMood ? (_FM_MOOD_LABELS[_est.secondMood] || cap(_est.secondMood)) : null;
          html += `<div style="margin-top:10px;border-radius:10px;border:1px solid rgba(255,149,0,0.2);overflow:hidden;">
            <button onclick="var b=this.nextElementSibling;var open=b.style.display!=='none';b.style.display=open?'none':'block';this.querySelector('.bb-chev-d').style.transform=open?'rotate(0deg)':'rotate(180deg)';"
              style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:rgba(255,149,0,0.06);border:none;cursor:pointer;font-size:0.85em;color:#6c757d;-webkit-tap-highlight-color:transparent;">
              <span>${BB.t('journal.ui.bbThought')}</span>
              <span class="bb-chev-d" style="font-size:0.7em;color:#adb5bd;transition:transform 0.2s;">▼</span>
            </button>
            <div style="display:none;padding:10px 12px;background:rgba(255,149,0,0.04);">
              <div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                <img src="images/moods/${_est.mood}.png" style="width:26px;height:26px;object-fit:contain;">
                <span style="font-weight:700;color:${_estColor};">${_estLabel}</span>
                ${_est.secondMood ? `<span style="font-size:0.82em;color:#adb5bd;">or</span><img src="images/moods/${_est.secondMood}.png" style="width:26px;height:26px;object-fit:contain;"><span style="font-weight:700;color:${_est2Color};">${_est2Label}</span>` : ''}
              </div>
              <div style="font-size:0.72em;color:#adb5bd;line-height:1.4;">${BB.t('journal.ui.experimentalFeedback1')}</div>
            </div>
          </div>`;
        }
      }

      window._calDayEntry = entry || null;
      document.getElementById('calDayEditBtn').style.display = entry ? '' : 'none';
      document.getElementById('calDayDeleteBtn').style.display = entry ? '' : 'none';
      document.getElementById('calDayContent').innerHTML = html;
      document.getElementById('calDayModal').classList.add('active');
    }

    function deleteFromCalDay() {
      const entry = window._calDayEntry;
      if (!entry) return;
      closeCalDayModal();
      pendingDeleteKey = entry.id;
      document.getElementById('confirmModal').classList.add('active');
    }
    function closeCalDayModal() {
      document.getElementById('calDayModal').classList.remove('active');
      const cal = document.getElementById('monthCalendar');
      if (cal) {
        cal.style.pointerEvents = 'none';
        setTimeout(() => { cal.style.pointerEvents = ''; }, 350);
      }
    }

    window.showCalDayDetail = showCalDayDetail;
    window.closeCalDayModal = closeCalDayModal;
    window.deleteFromCalDay = deleteFromCalDay;

    function _editCalDayIntention(key) {
      document.getElementById('calDayIntView').style.display = 'none';
      document.getElementById('calDayIntEdit').style.display = '';
      const ta = document.getElementById('calDayIntTextarea');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
    async function _saveCalDayIntention(entryId, key) {
      const ta = document.getElementById('calDayIntTextarea');
      if (!ta) return;
      const newVal = ta.value.trim();
      try {
        if (currentUser && db) {
          await db.collection('entries').doc(entryId).update({ intention: newVal });
        }
        // Update in-memory
        const e = _allEntries.find(x => x.id === entryId);
        if (e) e.intention = newVal;
        showCalDayDetail(key);
      } catch(err) { console.warn('Failed to save intention', err); }
    }
    window._editCalDayIntention = _editCalDayIntention;
    window._saveCalDayIntention = _saveCalDayIntention;

    function resetEntryForm() {
      _editOriginalState = null;
      _fmDayFillSnapshot = null;
      _fmDayFillMsg      = null;
      const _sleepBtn = document.getElementById('healthSleepBtn');
      if (_sleepBtn) _sleepBtn.textContent = '😴 Sleep Hours';
      const _energyBtnText = document.getElementById('healthEnergyBtnText');
      if (_energyBtnText) _energyBtnText.textContent = '⚡ Energy';
      const _ehReset = document.getElementById('energyStepHero');
      if (_ehReset) _ehReset.style.display = 'none';
      const _shReset = document.getElementById('sleepStepHero');
      if (_shReset) _shReset.style.display = 'none';
      // steps result is now shown inside the energy button text — reset it
      const _ebtReset = document.getElementById('healthEnergyBtnText');
      if (_ebtReset && _ebtReset.textContent !== '⚡ Energy') _ebtReset.textContent = '⚡ Energy';
      const _sleepLabel = document.getElementById('sleepLabel');
      if (_sleepLabel) _sleepLabel.style.display = 'none';
      const _sleepBtnRow = document.getElementById('sleepBtnRow');
      if (_sleepBtnRow) _sleepBtnRow.style.display = '';
      document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
      selectedMood = null;
      selectedLinkedMood = null;
      if (typeof _fmApplyMoodTheme === 'function') _fmApplyMoodTheme(null);
      selectedEnergy = 5;
      selectedSleep = 7.5;
      selectedSleepQuality = null;
      // Hide the sleep-quality sub-section explicitly — clearing the value
      // alone wasn't enough; the panel stayed visible after a tap-and-hold.
      const _rstSqEl = document.getElementById('sleepQualitySubSection');
      if (_rstSqEl) _rstSqEl.style.display = 'none';
      selectedIntention = '';
      selectedStepNotes = {};
      document.getElementById('notes').value = '';

      document.querySelectorAll('.energy-btn').forEach(b => {
        b.classList.remove('selected');
        b.style.background = '#f8f9fa';
        b.style.color = '#495057';
      });
      const defaultEnergyBtn = document.querySelector('[data-energy="5"]');
      if (defaultEnergyBtn) {
        defaultEnergyBtn.classList.add('selected');
        defaultEnergyBtn.style.background = defaultEnergyBtn.dataset.color || getEnergyColor(5);
        defaultEnergyBtn.style.color = 'white';
      }

      _sleepSuggestedVal = null;
      _sleepHealthSynced = false;
      document.querySelectorAll('.sleep-btn').forEach(b => {
        b.classList.remove('selected');
        b.style.background = '#f8f9fa';
        b.style.color = '#495057';
        if (b.dataset.baseLabel) b.textContent = b.dataset.baseLabel;
      });
      const defaultSleepBtn = document.querySelector('[data-sleep="8"]');
      if (defaultSleepBtn) {
        defaultSleepBtn.classList.add('selected');
        defaultSleepBtn.style.background = defaultSleepBtn.dataset.color || getSleepColor(8);
        defaultSleepBtn.style.color = 'white';
      }

      document.querySelectorAll('.medication-btn').forEach(b => b.classList.remove('selected'));
      selectedMedication = null;
      selectedGoals = null;
      selectedAlcohol = null;
      selectedExercise = null;
      selectedAnxiety = null;
      selectedIrritability = null;
      selectedStress = null;
      selectedOutside = null;
      selectedSmoking = null;
      selectedDrugs = null;
      selectedCustom = {};
      selectedBudget = null;
      setPdfHide(localStorage.getItem('incognitoMode') === 'true');
      selectedFavourite = false;
      _updateFavouriteBtn();
      const _edb = document.getElementById('editDeleteBtn');
      if (_edb) _edb.style.display = 'none';
      const _ecb = document.getElementById('editCancelBtn');
      if (_ecb) _ecb.style.display = 'none';

      const mds = document.getElementById('moreDataSection');
      const mdt = document.getElementById('moreDataToggle');
      const _moreDataDefault = localStorage.getItem('moreDataOpenByDefault') === 'true';
      if (mds) mds.style.display = _moreDataDefault ? 'block' : 'none';
      if (mdt) mdt.textContent = _moreDataDefault ? BB.t('journal.lessData') : BB.t('journal.moreData');
      _applyMoreDataDefaultToggle(_moreDataDefault);

      document.querySelectorAll('.show-after-mood').forEach(el => {
        el.classList.remove('show-after-mood');
        el.classList.add('hidden-until-mood');
      });
      // If focused mode was active, ensure the form stays hidden (it will be re-opened by saveEntry if needed)
      if (typeof _fmActive !== 'undefined' && _fmActive) {
        document.getElementById('entryFormCard').style.display = 'none';
      }
    }

    function openFormForNewEntry(dateStr) {
      closeCalDayModal();
      // Close journal if open so it doesn't obscure the form
      const _jc = document.getElementById('journalCard');
      const _jtb = document.getElementById('journalToggleBtn');
      if (_jc && _jc.style.display !== 'none') {
        _jc.style.display = 'none';
        if (_jtb) _jtb.innerHTML = BB.t('journal.btn.openJournal');
      }
      editingEntry = null;
      _editFieldOverrides = null;
      resetEntryForm();
      applyTrackingPrefs();
      document.getElementById('entryFormCard').style.display = '';
      document.getElementById('todayCompleteSection').style.display = 'none';
      const placeholder = document.getElementById('entryLoadingPlaceholder');
      if (placeholder) placeholder.style.display = 'none';
      const _dateInput = document.getElementById('entryDate');
      _dateInput.value = dateStr;
      onEntryDateChange(_dateInput);
      _maybeFocusedModeAfterFormShown();
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
    }
    window.openFormForNewEntry = openFormForNewEntry;

    function display14DayChart(entries, chartContainer) {
      const last14 = entries.slice(0, 14).reverse();
      if (last14.length === 0) {
        chartContainer.style.display = 'none';
        return;
      }

      const maxHeight = 120; // max height in pixels
      
      // Calculate trend line using linear regression
      const moodValuesArray = last14.map(e => _moodScore(e.mood));
      const n = moodValuesArray.length;
      let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
      
      for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += moodValuesArray[i];
        sumXY += i * moodValuesArray[i];
        sumXX += i * i;
      }
      
      const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;
      
      // Generate SVG for trend line
      const chartWidth = 100; // percentage
      const startY = ((6 - intercept) / 6) * 100;
      const endY = ((6 - (slope * (n - 1) + intercept)) / 6) * 100;
      
      const trendLineSVG = `
        <svg style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;">
          <line x1="0%" y1="${startY}%" x2="100%" y2="${endY}%" 
                stroke="#ff6b6b" stroke-width="2" stroke-dasharray="5,5" opacity="0.6"/>
        </svg>
      `;
      
      const html = last14.map(entry => {
        const heightPx = (_moodScore(entry.mood) / 6) * maxHeight;
        const date = new Date(entry.date);
        
        return `
          <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;">
            <div class="chart-bar" style="height: ${heightPx}px; background: ${moodColors[_moodCat(entry.mood)]}"
                 title="Mood: ${_moodLabelNum(entry.mood)}
Energy: ${entry.energy}/10
Sleep: ${entry.sleep}h${entry.steps != null ? `\nSteps: ${entry.steps.toLocaleString()}` : ''}
Medication: ${entry.medication === 'not-taken' ? 'No / Forgot' : entry.medication === 'unsure' ? 'Unsure' : (entry.medication || 'taken')}"></div>
            <div class="chart-label">${date.getDate()}/${date.getMonth() + 1}</div>
          </div>
        `;
      }).join('');

      chartContainer.innerHTML = html;
      chartContainer.style.position = 'relative';
      chartContainer.style.display = 'flex';
      chartContainer.insertAdjacentHTML('afterbegin', trendLineSVG);
    }

    function displayYearCalendar(entries, chartContainer) {
      // Create a map of dates to moods (normalize to date only, no time)
      const moodByDate = {};
      entries.forEach(entry => {
        const date = new Date(entry.date);
        // Normalize to local date string - use UTC to avoid timezone issues
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const dateKey = `${year}-${month}-${day}`;
        moodByDate[dateKey] = entry;
      });

      // Get date range — use statsStartDate if set, otherwise past 365 days
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let oneYearAgo;
      if (statsStartDate) {
        oneYearAgo = new Date(statsStartDate);
        oneYearAgo.setHours(0, 0, 0, 0);
      } else {
        oneYearAgo = new Date(today);
        oneYearAgo.setDate(today.getDate() - 364);
      }

      // Generate calendar grid
      const weeks = [];
      let currentWeek = [];
      let currentDate = new Date(oneYearAgo);
      
      // Start from the most recent Sunday before oneYearAgo
      const dayOfWeek = currentDate.getDay();
      currentDate.setDate(currentDate.getDate() - dayOfWeek);

      while (currentDate <= today) {
        const year = currentDate.getFullYear();
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const day = String(currentDate.getDate()).padStart(2, '0');
        const dateKey = `${year}-${month}-${day}`;
        
        const entry = moodByDate[dateKey];
        const mood = entry ? entry.mood : null;
        const isInRange = currentDate >= oneYearAgo && currentDate <= today;
        
        currentWeek.push({
          date: new Date(currentDate),
          dateKey: dateKey,
          mood: mood,
          entry: entry,
          color: (mood != null && mood !== '') ? (moodColors[_moodCat(mood)] || '#e9ecef') : '#e9ecef',
          isInRange: isInRange
        });

        if (currentWeek.length === 7) {
          weeks.push(currentWeek);
          currentWeek = [];
        }

        currentDate.setDate(currentDate.getDate() + 1);
      }

      if (currentWeek.length > 0) {
        weeks.push(currentWeek);
      }

      // Calculate responsive size based on number of weeks with minimum size
      const numWeeks = weeks.length;
      const containerElement = chartContainer.parentElement;
      // Get the actual usable width: start with container or default to 800px for desktop
      let containerWidth = containerElement ? containerElement.offsetWidth : 800;
      
      // Account for card padding (20px each side on desktop, 15px on mobile)
      // Plus calendar wrapper padding (15px each side, or 10px on mobile)
      // Plus inner padding (5px each side)
      // Approximate total: 80px on desktop, ~60px on mobile
      const isMobile = window.innerWidth <= 600;
      const paddingOffset = isMobile ? 60 : 80;
      containerWidth = containerWidth - paddingOffset;
      
      const totalGap = (numWeeks - 1); // Use variable gap size
      const availableWidth = containerWidth - totalGap;
      const calculatedSize = Math.floor(availableWidth / numWeeks / 7); // divide by 7 days
      const squareSize = Math.max(calculatedSize, isMobile ? 5 : 8); // minimum 5px for mobile, 8px for desktop
      const gapSize = squareSize >= 10 ? 2 : 1; // smaller gap for mobile

      // Month labels
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      let monthLabels = '';
      let lastMonth = -1;
      let weekIndex = 0;

      weeks.forEach((week, idx) => {
        const firstDayOfWeek = week[0].date;
        const month = firstDayOfWeek.getMonth();
        if (month !== lastMonth && firstDayOfWeek.getDate() <= 7) {
          const leftPos = weekIndex * (squareSize + gapSize);
          monthLabels += `<div style="position: absolute; left: ${leftPos}px; top: -20px; font-size: 10px; color: #6c757d; font-weight: 600;">${months[month]}</div>`;
          lastMonth = month;
        }
        weekIndex++;
      });

      const streak = window._currentStreak || 0;
      const html = `
        <div style="margin: 20px 0 2px 0; padding: 15px; background: #f8f9fa; border-radius: 15px;">
          <div style="text-align: center; margin-bottom: 12px; color: #495057; font-weight: 600; font-size: 0.95em;">
            Past Year Mood Calendar
          </div>
          <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; font-size: 0.85em; min-height: 22px;">
            ${(() => {
              const _yCounts = {};
              entries.forEach(e => { if (e.mood != null && e.mood !== '') { const _c = _moodCat(e.mood); _yCounts[_c] = (_yCounts[_c] || 0) + 1; } });
              return Object.entries(moodColors).filter(([mood]) => _yCounts[mood] > 0)
                .sort((a, b) => (_yCounts[b[0]] || 0) - (_yCounts[a[0]] || 0))
                .map(([mood, color]) => {
                  const cnt = _yCounts[mood] || 0;
                  return `<div onclick="showStatDetail('moodSummary')" style="display:flex;align-items:center;gap:5px;cursor:pointer;" title="${cnt} days">
                    <div style="width:12px;height:12px;background:${color};border-radius:2px;flex-shrink:0;"></div>
                    <span style="color:#6c757d;">${_moodCatLabel(mood)}</span>
                  </div>`;
                }).join('');
            })()}
          </div>
          <div style="display: flex; gap: 20px; align-items: flex-start; justify-content: center; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 280px;">
              <div style="display: flex; justify-content: center;">
                <div style="position: relative; padding: 22px 5px 15px 5px;">
                  ${monthLabels}
                  <div style="display: flex; gap: ${gapSize}px;">
                    ${weeks.map(week => `
                    <div style="display: flex; flex-direction: column; gap: ${gapSize}px;">
                      ${week.map(day => {
                        const tooltipText = day.entry ?
                          `${day.date.toLocaleDateString()}: ${_moodLabelNum(day.mood)}\\nEnergy: ${day.entry.energy}/10, Sleep: ${day.entry.sleep}h` :
                          day.date.toLocaleDateString();
                        return `
                        <div style="
                          width: ${squareSize}px;
                          height: ${squareSize}px;
                          background: ${day.isInRange ? day.color : '#f8f9fa'};
                          border-radius: 2px;
                          ${day.entry ? `border: 2px solid ${day.color}; box-shadow: 0 0 0 1px rgba(0,0,0,0.1);` : 'border: 1px solid #e9ecef;'}
                          opacity: ${day.isInRange ? (day.entry ? '1' : '0.3') : '0.1'};
                        " title="${tooltipText}"></div>
                      `}).join('')}
                    </div>
                  `).join('')}
                  </div>
                </div>
              </div>
            </div>
            <div class="stat-card" style="flex-shrink: 0; width: 130px; min-width: 100px; align-self: center; text-align: center;">
              <div class="stat-number">🔥 ${streak}</div>
              <div class="stat-label">${BB.t('journal.ui.currentStreak')}</div>
            </div>
          </div>
        </div>
      `;

      chartContainer.innerHTML = html;
      chartContainer.style.position = 'relative';
      chartContainer.style.display = 'block';
      chartContainer.style.height = 'auto';
      chartContainer.style.borderBottom = 'none';
    }

    async function exportData() {
      try {
        const entries = [];

        if (currentUser) {
          // Export from Firestore for logged-in users
          const snapshot = await db.collection('entries')
            .where('userId', '==', currentUser.uid)
            .get();

          snapshot.forEach(doc => {
            entries.push(doc.data());
          });
        } else {
          // Export from localStorage for guests
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('entry:')) {
              try {
                const value = localStorage.getItem(key);
                if (value) {
                  entries.push(JSON.parse(value));
                }
              } catch (e) {
                console.error('Error loading entry:', e);
              }
            }
          }
        }

        if (entries.length === 0) {
          alert(BB.t('journal.dlg.noDataExport'));
          return;
        }

        // Collect settings from localStorage
        const _settingsKeys = [
          'focusedModeEnabled', 'fmConfirmStep', 'fmAutoAdvance', 'fmAutoAdvanceMoreData',
          'elaborateResponsesEnabled', 'intentionEnabled', 'incognitoMode', 'pdfHideByDefault',
          'showMoodSuggestion', 'moreDataOpenByDefault', 'achievementToastsEnabled',
          'statsStartDate', 'weeklySummaryEnabled', 'customiseFormEnabled', 'disabledSteps',
          'earlyWarnEnabled',
          'moodLinkingEnabled', 'customTrackingFields', 'deletedDefaultCustomFields',
          'deletedBuiltinFields', 'trackGoals', 'trackBudget', 'trackExercise',
          'trackOutside', 'trackAnxiety', 'trackAlcohol', 'trackEmotions',
        ];
        const settings = {};
        _settingsKeys.forEach(k => {
          const v = localStorage.getItem(k);
          if (v !== null) settings[k] = v;
        });
        // Include dynamic keys: trackCustom_*, _labelOverride_*
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('trackCustom_') || k.startsWith('_labelOverride_'))) {
            settings[k] = localStorage.getItem(k);
          }
        }

        const dataStr = JSON.stringify({ version: 2, exportDate: new Date().toISOString().split('T')[0], entries, settings }, null, 2);
        const filename = `bipolarbear-backup-${new Date().toISOString().split('T')[0]}.json`;

        if (isNative()) {
          // iOS/Android: use Filesystem + Share (a[download] doesn't work in WKWebView)
          const Filesystem = getPlugin('Filesystem');
          const Share = getPlugin('Share');
          if (Filesystem) {
            // btoa needs ASCII-safe encoding; use TextEncoder for full Unicode support
            const bytes = new TextEncoder().encode(dataStr);
            let binary = '';
            bytes.forEach(b => binary += String.fromCharCode(b));
            const base64 = btoa(binary);
            const result = await Filesystem.writeFile({ path: filename, data: base64, directory: 'DOCUMENTS' });
            if (Share) {
              await Share.share({ title: 'BipolarBear Backup', url: result.uri, dialogTitle: 'Save or Share Your Backup' });
            } else {
              alert(BB.t('journal.dlg.backupSavedDocs') + filename);
            }
          } else {
            alert(BB.t('journal.dlg.fsPluginNA'));
          }
        } else {
          // Web: standard anchor download
          const blob = new Blob([dataStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          alert(BB.t('journal.dlg.backupDownloaded'));
        }
      } catch (error) {
        console.error('Error exporting:', error);
        alert(BB.t('journal.dlg.exportFail'));
      }
    }

    async function exportDataCSV() {
      try {
        const entries = [];
        if (currentUser) {
          const snapshot = await db.collection('entries').where('userId', '==', currentUser.uid).get();
          snapshot.forEach(doc => entries.push(doc.data()));
        } else {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('entry:')) {
              try { entries.push(JSON.parse(localStorage.getItem(key))); } catch(e) {}
            }
          }
        }
        if (entries.length === 0) { alert(BB.t('journal.dlg.noDataExport')); return; }
        entries.sort((a, b) => a.timestamp - b.timestamp);

        // Collect all custom field ids across entries
        const customFieldIds = [];
        entries.forEach(e => {
          Object.keys(e.customFields || {}).forEach(id => {
            if (!customFieldIds.includes(id)) customFieldIds.push(id);
          });
        });
        const customFields = getCustomFields ? getCustomFields() : [];
        const customLabel = id => { const f = customFields.find(f => f.id === id); return f ? f.label : id; };

        const _esc = v => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;
        const headers = [
          'Date','Mood','Linked Mood','Energy (1-10)','Sleep (hrs)','Sleep Quality',
          'Medication','Goals','Budget','Anxiety','Stress','Irritability',
          'Exercise','Outside','Alcohol','Smoking','Drugs','Steps',
          'Notes','Intention','PDF Hidden','Favourite','Auto-filled',
          ...customFieldIds.map(customLabel),
        ];
        const rows = entries.map(e => [
          _esc(e.date), _esc(e.mood), _esc(e.linkedMood || ''),
          _esc(e.energy), _esc(e.sleep), _esc(e.sleepQuality || ''),
          _esc(e.medication || ''), _esc(e.goals || ''), _esc(e.budget || ''),
          _esc(e.anxiety || ''), _esc(e.stress || ''), _esc(e.irritability || ''),
          _esc(e.exercise || ''), _esc(e.outside || ''), _esc(e.alcohol || ''),
          _esc(e.smoking || ''), _esc(e.drugs || ''), _esc(e.steps != null ? e.steps : ''),
          _esc(e.notes || ''), _esc(e.intention || ''),
          _esc(e.pdfHidden ? 'yes' : ''), _esc(e.favourite ? 'yes' : ''),
          _esc(e.autoFilled ? 'yes' : ''),
          ...customFieldIds.map(id => _esc((e.customFields || {})[id] || '')),
        ].join(','));

        const csvStr = [headers.join(','), ...rows].join('\n');
        const filename = `bipolarbear-export-${new Date().toISOString().split('T')[0]}.csv`;

        if (isNative()) {
          const Filesystem = getPlugin('Filesystem');
          const Share = getPlugin('Share');
          if (Filesystem) {
            const bytes = new TextEncoder().encode(csvStr);
            let binary = ''; bytes.forEach(b => binary += String.fromCharCode(b));
            const result = await Filesystem.writeFile({ path: filename, data: btoa(binary), directory: 'DOCUMENTS' });
            if (Share) await Share.share({ title: 'BipolarBear CSV Export', url: result.uri, dialogTitle: 'Save or Share Your Export' });
            else alert(BB.t('journal.dlg.csvSavedDocs') + filename);
          } else { alert(BB.t('journal.dlg.fsPluginNA')); }
        } else {
          const blob = new Blob([csvStr], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = filename;
          document.body.appendChild(a); a.click();
          document.body.removeChild(a); URL.revokeObjectURL(url);
          alert(BB.t('journal.dlg.csvDownloaded'));
        }
      } catch (error) {
        console.error('Error exporting CSV:', error);
        alert(BB.t('journal.dlg.exportFail'));
      }
    }
    window.exportDataCSV = exportDataCSV;

    function exportPDF() {
      // Count distinct calendar months with data for each metric
      const _monthKey = e => { const d = new Date(e.date); return `${d.getFullYear()}-${d.getMonth()}`; };
      const _monthsWithData = {
        Mood:   new Set((_allEntries||[]).filter(e => e.mood).map(_monthKey)).size,
        Sleep:  new Set((_allEntries||[]).filter(e => e.sleep != null).map(_monthKey)).size,
        Energy: new Set((_allEntries||[]).filter(e => e.energy != null).map(_monthKey)).size,
        Steps:  new Set((_allEntries||[]).filter(e => e.steps > 0).map(_monthKey)).size,
        SleepQ: new Set((_allEntries||[]).filter(e => e.sleepQuality).map(_monthKey)).size,
        Goals:  new Set((_allEntries||[]).filter(e => e.goals).map(_monthKey)).size,
        Budget: new Set((_allEntries||[]).filter(e => e.budget).map(_monthKey)).size,
      };

      // Settings-based visibility gates
      const _sqDisabled  = _getDisabledSteps().includes('sleepQuality');
      const _trackGoals  = localStorage.getItem('trackGoals') !== 'false';
      const _trackBudget = localStorage.getItem('trackBudget') !== 'false';

      const _defaultOn = new Set(['Mood','Sleep','Energy','Goals','Budget']);
      let _visibleCount = 0;

      ['Mood','Sleep','Energy','Steps','SleepQ','Goals','Budget'].forEach(k => {
        const b = document.getElementById('pdfChart' + k);
        if (!b) return;
        // Hide if settings gate is off
        if ((k === 'SleepQ' && _sqDisabled) || (k === 'Goals' && !_trackGoals) || (k === 'Budget' && !_trackBudget)) {
          b.style.display = 'none'; return;
        }
        // Hide if fewer than 3 months of data
        if (_monthsWithData[k] < 3) { b.style.display = 'none'; return; }
        b.style.display = 'flex';
        _visibleCount++;
        const on = _defaultOn.has(k);
        b.dataset.on = on ? '1' : '0';
        b.style.border = on ? '1.5px solid var(--brand-primary)' : '1.5px solid #adb5bd';
        b.style.background = on ? 'rgba(255,149,0,0.1)' : 'rgba(0,0,0,0.04)';
        b.style.color = on ? 'var(--brand-primary)' : '#adb5bd';
      });

      // Show/hide the no-data message
      const _noDataMsg = document.getElementById('pdfChartsNoData');
      const _chartBtns = document.getElementById('pdfChartButtons');
      const _chartSection = document.getElementById('pdfChartSection');
      if (_chartSection) _chartSection.style.display = _visibleCount === 0 ? 'none' : '';
      if (_noDataMsg) _noDataMsg.style.display = _visibleCount === 0 ? '' : 'none';
      if (_chartBtns) _chartBtns.style.display = _visibleCount === 0 ? 'none' : 'flex';

      document.getElementById('pdfExportModal').classList.add('active');
    }
    window.exportPDF = exportPDF;

    function _togglePdfChart(key) {
      const btn = document.getElementById('pdfChart' + key);
      if (!btn || btn.style.display === 'none') return;
      const turningOn = btn.dataset.on !== '1';
      if (turningOn) {
        const onCount = ['Mood','Sleep','Energy','Steps','SleepQ','Goals','Budget'].filter(k => {
          const b = document.getElementById('pdfChart' + k);
          return b && b.style.display !== 'none' && b.dataset.on === '1';
        }).length;
        if (onCount >= 5) {
          // Flash red to show limit reached
          btn.style.border = '1.5px solid #ff4444';
          btn.style.background = 'rgba(255,68,68,0.12)';
          btn.style.color = '#ff4444';
          setTimeout(() => {
            btn.style.border = '1.5px solid #adb5bd';
            btn.style.background = 'rgba(0,0,0,0.04)';
            btn.style.color = '#adb5bd';
          }, 600);
          return;
        }
      }
      btn.dataset.on = turningOn ? '1' : '0';
      btn.style.border = turningOn ? '1.5px solid var(--brand-primary)' : '1.5px solid #adb5bd';
      btn.style.background = turningOn ? 'rgba(255,149,0,0.1)' : 'rgba(0,0,0,0.04)';
      btn.style.color = turningOn ? 'var(--brand-primary)' : '#adb5bd';
    }
    window._togglePdfChart = _togglePdfChart;

    async function _doExportPDF(leftPeriod, rightPeriod, charts, recentEntriesPeriod) {
      if (!charts) charts = { mood: true, sleep: true, energy: true };
      if (!recentEntriesPeriod) recentEntriesPeriod = '30d';
      try {
        if (typeof window.jspdf === 'undefined') {
          alert(BB.t('journal.dlg.pdfLibLoading'));
          return;
        }

        // Load ALL entries — and DECRYPT them. On Firestore only userId/timestamp are
        // plaintext; everything else (mood, date, energy, sleep, notes…) lives in an
        // encrypted blob. Guest entries may likewise be PIN-encrypted in localStorage.
        // Pushing raw docs left every field undefined, which crashed the export (e.g.
        // computeInsights → e.date.slice). Mirror the auth-listener loader instead.
        const entries = [];
        if (currentUser) {
          const snapshot = await db.collection('entries').where('userId', '==', currentUser.uid).get();
          const decoded = await Promise.all(snapshot.docs.map(doc => _decodeFirestoreEntry(doc)));
          decoded.forEach(e => { if (e) entries.push(e); });
        } else {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('entry:')) {
              try {
                const parsed = JSON.parse(localStorage.getItem(key));
                if (parsed && parsed._enc) {
                  // Encrypted guest entry — only usable if the PIN key is loaded
                  if (_guestCryptoKey) entries.push({ id: key, ...(await _guestDecrypt(_guestCryptoKey, parsed)) });
                } else if (parsed) {
                  entries.push({ id: key, ...parsed });
                }
              } catch(e) {}
            }
          }
        }

        if (entries.length === 0) { alert(BB.t('journal.dlg.noDataExport')); return; }
        entries.sort((a, b) => a.timestamp - b.timestamp);

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.width;
        const pageH = doc.internal.pageSize.height;
        const margin = 15;
        const col2 = pageW / 2 + 5;
        const colW = pageW / 2 - margin - 5;
        const orange = [255, 149, 0];
        const grey = [120, 120, 120];
        const lightGrey = [220, 220, 220];
        const dark = [40, 40, 40];

        // ── helpers ──
        const moodColor = (mood) => {
          const map = { manic:[255,68,68], elevated:[255,149,0], stable:[81,207,102], good:[81,207,102], low:[132,94,247], depressed:[92,124,250] };
          return map[mood] || [150,150,150];
        };

        function setColor(rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }
        function setDraw(rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }
        function setFill(rgb) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); }

        function drawBar(x, y, w, h, rgb) {
          setFill(rgb); doc.rect(x, y, w, h, 'F');
        }

        function sectionTitle(text, x, y) {
          doc.setFontSize(9); doc.setFont(undefined, 'bold'); setColor(dark);
          doc.text(text.toUpperCase(), x, y);
          setDraw(orange); doc.setLineWidth(0.5);
          doc.line(x, y + 1, x + colW, y + 1);
          return y + 6;
        }

        function statRow(label, value, x, y) {
          doc.setFontSize(8); doc.setFont(undefined, 'normal');
          setColor(grey); doc.text(label, x, y);
          setColor(dark); doc.setFont(undefined, 'bold');
          doc.text(String(value), x + colW - 2, y, { align: 'right' });
          return y + 5;
        }

        function moodDistBar(moodCounts, total, x, startY) {
          const moods = ['manic','elevated','stable','low','depressed'];
          let y = startY;
          const barMaxW = colW - 28; // Increased right padding to keep % inside
          moods.forEach(mood => {
            const count = moodCounts[mood] || 0;
            if (count === 0) return;
            const pct = count / total;
            const barW = Math.max(pct * barMaxW, 1);
            // label
            doc.setFontSize(7); doc.setFont(undefined, 'normal'); setColor(grey);
            doc.text(mood.charAt(0).toUpperCase() + mood.slice(1), x, y + 2.5);
            // bar
            drawBar(x + 18, y - 1, barW, 4, moodColor(mood));
            // pct - keep inside box
            setColor(dark); doc.setFont(undefined, 'bold');
            doc.text(`${(pct*100).toFixed(0)}%`, x + 22 + barMaxW, y + 2.5, { align: 'right' });
            y += 7;
          });
          return y;
        }

        // ── STATS ──
        const now = Date.now();
        const _filterByPeriod = (arr, period) => {
          if (period === 'alltime') return statsStartDate ? arr.filter(e => e.date >= statsStartDate) : arr;
          const cutoff = now - parseInt(period) * 24 * 60 * 60 * 1000;
          return arr.filter(e => e.timestamp >= cutoff);
        };
        const _periodLabel = period => {
          if (period === 'alltime') return statsStartDate ? `${BB.t('journal.pdf.periodAllTimeFrom')} ${statsStartDate})` : BB.t('journal.pdf.periodAllTime');
          if (period === '365d') return BB.t('journal.pdf.periodLastYear');
          return `${parseInt(period)}${BB.t('journal.pdf.periodDaySuffix')}`;
        };
        const allEntries = _filterByPeriod(entries, leftPeriod);
        const recent     = _filterByPeriod(entries, rightPeriod);
        const allMoodCounts = {}, recentMoodCounts = {};
        allEntries.forEach(e => { const m = _moodCat(e.mood); allMoodCounts[m] = (allMoodCounts[m]||0)+1; });
        recent.forEach(e => { const m = _moodCat(e.mood); recentMoodCounts[m] = (recentMoodCounts[m]||0)+1; });
        const mostCommonAll = Object.entries(allMoodCounts).sort((a,b)=>b[1]-a[1])[0];
        const mostCommonRecent = recent.length ? Object.entries(recentMoodCounts).sort((a,b)=>b[1]-a[1])[0] : null;
        const avgEnergyAll = allEntries.length ? (allEntries.reduce((s,e)=>s+e.energy,0)/allEntries.length).toFixed(1) : '-';
        const _allSleep = allEntries.filter(e=>e.sleep!=null);
        const avgSleepAll = _allSleep.length ? (_allSleep.reduce((s,e)=>s+e.sleep,0)/_allSleep.length).toFixed(1) : '-';
        const avgEnergyRecent = recent.length ? (recent.reduce((s,e)=>s+e.energy,0)/recent.length).toFixed(1) : '-';
        const _recentSleep = recent.filter(e=>e.sleep!=null);
        const avgSleepRecent = _recentSleep.length ? (_recentSleep.reduce((s,e)=>s+e.sleep,0)/_recentSleep.length).toFixed(1) : '-';
        const medsTakenAll = allEntries.filter(e=>e.medication==='taken').length;
        const medsTakenRecent = recent.filter(e=>e.medication==='taken').length;
        const missedAll = allEntries.filter(e=>e.medication!=='taken').length;
        const missedRecent = recent.filter(e=>e.medication!=='taken').length;
        const goalsAllTotal = allEntries.filter(e=>e.goals).length;
        const goalsAllDone = allEntries.filter(e=>e.goals==='completed').length;
        const goalsRecentTotal = recent.filter(e=>e.goals).length;
        const goalsRecentDone = recent.filter(e=>e.goals==='completed').length;
        const allWithSteps = allEntries.filter(e => e.steps != null && e.steps > 0);
        const recentWithSteps = recent.filter(e => e.steps != null && e.steps > 0);
        const avgStepsAll = allWithSteps.length ? Math.round(allWithSteps.reduce((s,e) => s + e.steps, 0) / allWithSteps.length).toLocaleString() : null;
        const avgStepsRecent = recentWithSteps.length ? Math.round(recentWithSteps.reduce((s,e) => s + e.steps, 0) / recentWithSteps.length).toLocaleString() : null;

        // ════════════════════════════
        // PAGE 1
        // ════════════════════════════
        let y = margin;

        // ── HEADER (Clean - no lines) ──
           // Load and add logo (top-right) via canvas for cross-origin compatibility
        try {
          const { logoBase64, logoNatW, logoNatH } = await new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function() {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth || 512;
              canvas.height = img.naturalHeight || 512;
              canvas.getContext('2d').drawImage(img, 0, 0);
              resolve({ logoBase64: canvas.toDataURL('image/png'), logoNatW: img.naturalWidth || 512, logoNatH: img.naturalHeight || 512 });
            };
            img.onerror = reject;
            img.src = (typeof logoSrcs !== 'undefined' && typeof logoCurrentIndex !== 'undefined' ? logoSrcs[logoCurrentIndex] : 'icons/favicons/web-app-manifest-512x512.png') + '?t=' + Date.now();
          });
          // Add logo top-right — preserve aspect ratio
          const logoW = 18;
          const logoH = logoW * (logoNatH / logoNatW);
          const logoStartY = 8;
          doc.addImage(logoBase64, 'PNG', pageW - margin - logoW, logoStartY, logoW, logoH);
          // Vertically centre title + subtitle against logo
          const logoCenter = logoStartY + logoH / 2;
          const titleY = logoCenter - 2;      // baseline of title (~6mm cap height, 8mm gap)
          const subtitleY = titleY + 8;
          doc.setFontSize(18); doc.setFont(undefined, 'bold'); setColor([40,40,40]);
          doc.text('BipolarBear.app', margin, titleY);
          doc.setFontSize(11); doc.setFont(undefined, 'normal'); setColor([100,100,100]);
          doc.text(BB.t('journal.pdf.moodTracker'), margin, subtitleY);
          y = Math.max(38, logoStartY + logoH + 4);
          console.log('\u2705 Logo added to PDF');
        } catch(e) {
          console.warn('Could not load logo for PDF:', e);
          // Continue without logo — use fixed positions
          doc.setFontSize(18); doc.setFont(undefined, 'bold'); setColor([40,40,40]);
          doc.text('BipolarBear.app', margin, 14);
          doc.setFontSize(11); doc.setFont(undefined, 'normal'); setColor([100,100,100]);
          doc.text(BB.t('journal.pdf.moodTracker'), margin, 22);
          y = 38;
        }

        // ── PERSONAL DETAILS (left) + MEDICATIONS (right) ──
        // For logged-in users, refresh from Firestore so data survives localStorage being cleared
        if (currentUser && db) {
          try {
            const pdDoc = await db.collection('personalDetails').doc(currentUser.uid).get();
            if (pdDoc.exists) {
              const d = pdDoc.data();
              const pdFields = ['personalName','personalDOB','personalMedicalNum','personalDiagnosis','personalDiagnosisDate','personalAddress','personalMobile','personalEmail','personalEmergencyContact','personalNotes'];
              pdFields.forEach(k => { if (d[k] !== undefined) localStorage.setItem(k, d[k]); });
            }
          } catch(e) { console.warn('Could not load personal details for PDF', e); }
        }
        const personalName = localStorage.getItem('personalName') || '';
        const personalDOB = localStorage.getItem('personalDOB') || '';
        const personalMedicalNum = localStorage.getItem('personalMedicalNum') || '';
        const personalDiagnosis = localStorage.getItem('personalDiagnosis') || '';
        const personalDiagnosisDate = localStorage.getItem('personalDiagnosisDate') || '';
        const personalAddress = localStorage.getItem('personalAddress') || '';
        const personalMobile = localStorage.getItem('personalMobile') || '';
        const personalEmail = localStorage.getItem('personalEmail') || '';
        const personalEmergencyContact = localStorage.getItem('personalEmergencyContact') || '';
        const personalNotes = localStorage.getItem('personalNotes') || '';
        const pdfMedications = JSON.parse(localStorage.getItem('currentMedList') || '[]');

        const hasPersonalDetails = personalName || personalDOB || personalMedicalNum || personalDiagnosis ||
                                   personalDiagnosisDate || personalAddress || personalMobile ||
                                   personalEmail || personalEmergencyContact || personalNotes;

        {
          const lineHeight = 4.5;
          const notesLineCount = personalNotes ? doc.splitTextToSize(personalNotes, (pageW - margin*2) / 2 - 20).length : 0;
          const leftCount = [personalName, personalDOB, personalMedicalNum, personalDiagnosis,
                             personalDiagnosisDate, personalAddress, personalMobile, personalEmail,
                             personalEmergencyContact].filter(Boolean).length + notesLineCount;
          const rightCount = pdfMedications.length;
          const maxRows = Math.max(hasPersonalDetails ? leftCount : 2, rightCount, 1);
          const detailsHeight = maxRows * lineHeight + 16;

          setDraw([220,220,220]); setFill([250,250,250]);
          doc.roundedRect(margin, y, pageW - margin*2, detailsHeight, 2, 2, 'FD');

          // Divider
          setDraw([220,220,220]); doc.setLineWidth(0.3);
          doc.line(col2 - 3, y + 3, col2 - 3, y + detailsHeight - 3);

          let headerY = y + 5;
          doc.setFontSize(7.5); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
          doc.text(BB.t('journal.pdf.patientDetails').toUpperCase(), margin + 4, headerY);
          doc.text(BB.t('journal.pdf.medications').toUpperCase(), col2 + 2, headerY);
          let contentY = headerY + 5;

          doc.setFontSize(7); doc.setFont(undefined, 'normal');

          // Left column
          if (hasPersonalDetails) {
            let ldy = contentY;
            const lx = margin + 4; const lv = margin + 22;
            if (personalName) { setColor(grey); doc.text(BB.t('journal.pdf.labelName'), lx, ldy); setColor(dark); doc.text(personalName, lv, ldy); ldy += lineHeight; }
            if (personalDOB) { setColor(grey); doc.text(BB.t('journal.pdf.labelDOB'), lx, ldy); setColor(dark); doc.text(personalDOB, lv, ldy); ldy += lineHeight; }
            if (personalMedicalNum) { setColor(grey); doc.text(BB.t('journal.pdf.labelMedicalNum'), lx, ldy); setColor(dark); doc.text(personalMedicalNum, lv, ldy); ldy += lineHeight; }
            if (personalDiagnosis) { setColor(grey); doc.text(BB.t('journal.pdf.labelDiagnosis'), lx, ldy); setColor(dark); doc.text(personalDiagnosis, lv, ldy); ldy += lineHeight; }
            if (personalDiagnosisDate) { setColor(grey); doc.text(BB.t('journal.pdf.labelDiagnosed'), lx, ldy); setColor(dark); doc.text(personalDiagnosisDate, lv, ldy); ldy += lineHeight; }
            if (personalAddress) {
              setColor(grey); doc.text(BB.t('journal.pdf.labelAddress'), lx, ldy); setColor(dark);
              const addrLines = doc.splitTextToSize(personalAddress, colW - 20);
              doc.text(addrLines, lv, ldy); ldy += lineHeight * addrLines.length;
            }
            if (personalMobile) { setColor(grey); doc.text(BB.t('journal.pdf.labelMobile'), lx, ldy); setColor(dark); doc.text(personalMobile, lv, ldy); ldy += lineHeight; }
            if (personalEmail) { setColor(grey); doc.text(BB.t('journal.pdf.labelEmail'), lx, ldy); setColor(dark); doc.text(personalEmail, lv, ldy); ldy += lineHeight; }
            if (personalEmergencyContact) { setColor(grey); doc.text(BB.t('journal.pdf.labelEmergency'), lx, ldy); setColor(dark); doc.text(personalEmergencyContact, lv, ldy); ldy += lineHeight; }
            if (personalNotes) {
              setColor(grey); doc.text(BB.t('journal.pdf.labelNotes'), lx, ldy); setColor(dark);
              const notesLines = doc.splitTextToSize(personalNotes, colW - 20);
              doc.text(notesLines, lv, ldy);
            }
          } else {
            doc.setFont(undefined, 'italic'); setColor(grey);
            doc.text(BB.t('journal.pdf.addDetailsLine1'), margin + 4, contentY);
            doc.text(BB.t('journal.pdf.addDetailsLine2'), margin + 4, contentY + lineHeight);
          }

          // Right column: medications
          let rdy = contentY;
          if (pdfMedications.length > 0) {
            pdfMedications.forEach(med => {
              setColor(dark); doc.setFont(undefined, 'bold');
              doc.text(med.name, col2 + 2, rdy);
              doc.setFont(undefined, 'normal'); setColor(grey);
              doc.text(med.dosage || '', col2 + 2, rdy + 3);
              rdy += lineHeight + 2;
            });
          } else {
            doc.setFont(undefined, 'italic'); setColor(grey);
            doc.text(BB.t('journal.pdf.noMedications'), col2 + 2, contentY);
          }

          y += detailsHeight + 4;
        }

        // ── Patient Info Box ──
        setDraw(lightGrey); setFill([250,250,250]);
        doc.roundedRect(margin, y, pageW - margin*2, 18, 2, 2, 'FD');
        doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor(dark);
        doc.text(BB.t('journal.pdf.reportInformation').toUpperCase(), margin + 4, y + 5);
        doc.setFont(undefined, 'normal'); setColor(grey); doc.setFontSize(7.5);
        const genDate = new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'});
        doc.text(`Generated: ${genDate}`, margin + 4, y + 10);
        const firstDate = new Date(entries[0].date).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'});
        const lastDate = new Date(entries[entries.length-1].date).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'});
        doc.text(`Period: ${firstDate} – ${lastDate} (${entries.length} entries)`, margin + 4, y + 14.5);
        y += 24;

        // ── TWO COLUMN STATS (Medical style) ──
        // Left: All-Time
        setDraw([220,220,220]); setFill([255,255,255]);
        doc.roundedRect(margin, y, colW, avgStepsAll ? 52 : 47, 2, 2, 'FD');
        let ly = y + 6;
        doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
        doc.text((_periodLabel(leftPeriod) + ' ' + BB.t('journal.pdf.summary')).toUpperCase(), margin + 4, ly);
        setDraw(orange); doc.setLineWidth(0.4);
        doc.line(margin + 4, ly + 1, margin + colW - 4, ly + 1);
        ly += 6;

        doc.setFontSize(7); doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.totalEntries'),margin + 4, ly);
        setColor(dark); doc.setFont(undefined, 'bold');
        doc.text(String(allEntries.length), margin + colW - 4, ly, { align: 'right' });
        ly += 5;
        
        doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.mostCommonMood'),margin + 4, ly);
        setColor(dark); doc.setFont(undefined, 'bold');
        doc.text(mostCommonAll ? mostCommonAll[0] : '-', margin + colW - 4, ly, { align: 'right' });
        ly += 5;
        
        doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.avgEnergyLevel'),margin + 4, ly);
        setColor(dark); doc.setFont(undefined, 'bold');
        doc.text(`${avgEnergyAll}/10`, margin + colW - 4, ly, { align: 'right' });
        ly += 5;
        
        doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.avgSleepHours'),margin + 4, ly);
        setColor(dark); doc.setFont(undefined, 'bold');
        doc.text(`${avgSleepAll}h`, margin + colW - 4, ly, { align: 'right' });
        ly += 5;
        
        doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.medicationAdherence'),margin + 4, ly);
        setColor(dark); doc.setFont(undefined, 'bold');
        const adherenceAll = allEntries.length ? ((medsTakenAll / allEntries.length) * 100).toFixed(0) : '0';
        doc.text(`${adherenceAll}%`, margin + colW - 4, ly, { align: 'right' });
        ly += 5;

        doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.goalsCompleted'),margin + 4, ly);
        setColor(dark); doc.setFont(undefined, 'bold');
        const goalsAllPct = goalsAllTotal > 0 ? `${((goalsAllDone/goalsAllTotal)*100).toFixed(0)}%` : '-';
        doc.text(goalsAllPct, margin + colW - 4, ly, { align: 'right' });
        if (avgStepsAll) {
          ly += 5;
          doc.setFont(undefined, 'normal'); setColor(grey);
          doc.text(BB.t('journal.pdf.avgDailySteps'),margin + 4, ly);
          setColor(dark); doc.setFont(undefined, 'bold');
          doc.text(avgStepsAll, margin + colW - 4, ly, { align: 'right' });
        }

        // Right: 30d Summary
        setDraw([220,220,220]); setFill([255,255,255]);
        doc.roundedRect(col2, y, colW, avgStepsRecent ? 52 : 47, 2, 2, 'FD');
        let ry = y + 6;
        doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
        doc.text((_periodLabel(rightPeriod) + ' ' + BB.t('journal.pdf.summary')).toUpperCase(), col2 + 4, ry);
        setDraw(orange); doc.setLineWidth(0.4);
        doc.line(col2 + 4, ry + 1, col2 + colW - 4, ry + 1);
        ry += 6;
        
        doc.setFontSize(7); doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.totalEntries'),col2 + 4, ry);
        setColor(dark); doc.setFont(undefined, 'bold');
        doc.text(String(recent.length), col2 + colW - 4, ry, { align: 'right' });
        ry += 5;
        
        doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.mostCommonMood'),col2 + 4, ry);
        setColor(dark); doc.setFont(undefined, 'bold');
        doc.text(mostCommonRecent ? mostCommonRecent[0] : '-', col2 + colW - 4, ry, { align: 'right' });
        ry += 5;
        
        doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.avgEnergyLevel'),col2 + 4, ry);
        setColor(dark); doc.setFont(undefined, 'bold');
        doc.text(recent.length ? `${avgEnergyRecent}/10` : '-', col2 + colW - 4, ry, { align: 'right' });
        ry += 5;
        
        doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.avgSleepHours'),col2 + 4, ry);
        setColor(dark); doc.setFont(undefined, 'bold');
        doc.text(recent.length ? `${avgSleepRecent}h` : '-', col2 + colW - 4, ry, { align: 'right' });
        ry += 5;
        
        doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.medicationAdherence'),col2 + 4, ry);
        setColor(dark); doc.setFont(undefined, 'bold');
        const adherenceRecent = recent.length ? ((medsTakenRecent / recent.length) * 100).toFixed(0) : '-';
        doc.text(recent.length ? `${adherenceRecent}%` : '-', col2 + colW - 4, ry, { align: 'right' });
        ry += 5;

        doc.setFont(undefined, 'normal'); setColor(grey);
        doc.text(BB.t('journal.pdf.goalsCompleted'),col2 + 4, ry);
        setColor(dark); doc.setFont(undefined, 'bold');
        const goalsRecentPct = goalsRecentTotal > 0 ? `${((goalsRecentDone/goalsRecentTotal)*100).toFixed(0)}%` : '-';
        doc.text(goalsRecentPct, col2 + colW - 4, ry, { align: 'right' });
        if (avgStepsRecent) {
          ry += 5;
          doc.setFont(undefined, 'normal'); setColor(grey);
          doc.text(BB.t('journal.pdf.avgDailySteps'),col2 + 4, ry);
          setColor(dark); doc.setFont(undefined, 'bold');
          doc.text(avgStepsRecent, col2 + colW - 4, ry, { align: 'right' });
        }

        y = Math.max(ly, ry) + 8;

        // ── MOOD DISTRIBUTION (Clinical boxes) ──
        setDraw([220,220,220]); setFill([255,255,255]);
        doc.roundedRect(margin, y, colW, 50, 2, 2, 'FD');
        let ly2 = y + 6;
        doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
        doc.text((_periodLabel(leftPeriod) + ' ' + BB.t('journal.pdf.moodDistribution')).toUpperCase(), margin + 4, ly2);
        setDraw(orange); doc.setLineWidth(0.4);
        doc.line(margin + 4, ly2 + 1, margin + colW - 4, ly2 + 1);
        ly2 += 7;
        ly2 = moodDistBar(allMoodCounts, allEntries.length, margin + 4, ly2);

        setDraw([220,220,220]); setFill([255,255,255]);
        doc.roundedRect(col2, y, colW, 50, 2, 2, 'FD');
        let ry2 = y + 6;
        doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
        doc.text((_periodLabel(rightPeriod) + ' ' + BB.t('journal.pdf.moodDistribution')).toUpperCase(), col2 + 4, ry2);
        setDraw(orange); doc.setLineWidth(0.4);
        doc.line(col2 + 4, ry2 + 1, col2 + colW - 4, ry2 + 1);
        ry2 += 7;
        ry2 = recent.length ? moodDistBar(recentMoodCounts, recent.length, col2 + 4, ry2) : ry2 + 10;

        y = Math.max(ly2, ry2) + 4;

        // ── ADDITIONAL DATA — all-time + 30d columns ──
        {
          const adFields = [
            { key: 'alcohol',  label: BB.t('journal.label.alcohol'),   yesLabel: 'drank'      },
            { key: 'smoking',  label: BB.t('journal.label.smoking'),   yesLabel: 'smoked'     },
            { key: 'drugs',    label: BB.t('journal.label.drugs'),     yesLabel: 'used'       },
            { key: 'exercise', label: BB.t('journal.label.exercise'),  yesLabel: 'exercised'  },
            { key: 'outside',  label: BB.t('journal.pdf.wentOutside'), yesLabel: 'went out'   },
          ];
          const MIN_DAYS = 3;
          const MAX_CUSTOM = 4;
          const allTracked    = adFields.filter(f => allEntries.filter(e => e[f.key]).length >= MIN_DAYS);
          const recentTracked = adFields.filter(f => recent.filter(e => e[f.key]).length >= MIN_DAYS);
          const pdfCustomFields    = getCustomFields();
          // Custom fields: only currently-active, sorted by count desc, capped at MAX_CUSTOM
          const allCustomTracked = pdfCustomFields
            .map(f => ({ f, cnt: allEntries.filter(e => e.customFields?.[f.id]).length }))
            .filter(x => x.cnt >= MIN_DAYS)
            .sort((a, b) => b.cnt - a.cnt)
            .slice(0, MAX_CUSTOM)
            .map(x => x.f);
          const recentCustomTracked = pdfCustomFields
            .map(f => ({ f, cnt: recent.filter(e => e.customFields?.[f.id]).length }))
            .filter(x => x.cnt >= MIN_DAYS)
            .sort((a, b) => b.cnt - a.cnt)
            .slice(0, MAX_CUSTOM)
            .map(x => x.f);
          if (allTracked.length > 0 || recentTracked.length > 0 || allCustomTracked.length > 0 || recentCustomTracked.length > 0) {
            const adRows = Math.max(allTracked.length + allCustomTracked.length, recentTracked.length + recentCustomTracked.length, 1);
            const adBoxH = adRows * 5 + 14;
            // Left: all-time
            setDraw([220,220,220]); setFill([255,255,255]);
            doc.roundedRect(margin, y, colW, adBoxH, 2, 2, 'FD');
            let ay = y + 6;
            doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
            doc.text((_periodLabel(leftPeriod) + ' ' + BB.t('journal.pdf.additionalData')).toUpperCase(), margin + 4, ay);
            setDraw(orange); doc.setLineWidth(0.4);
            doc.line(margin + 4, ay + 1, margin + colW - 4, ay + 1);
            ay += 6; doc.setFontSize(7);
            if (allTracked.length === 0 && allCustomTracked.length === 0) {
              setColor(grey); doc.setFont(undefined, 'italic'); doc.text(BB.t('journal.pdf.noDataRecorded'), margin + 4, ay);
            } else {
              allTracked.forEach(f => {
                const yesN = allEntries.filter(e => e[f.key] === 'yes').length;
                const noN  = allEntries.filter(e => e[f.key] === 'no').length;
                const untN = allEntries.length - yesN - noN;
                setColor(grey); doc.setFont(undefined, 'normal'); doc.text(f.label, margin + 4, ay);
                setColor(dark); doc.setFont(undefined, 'bold');
                doc.text(`${yesN} yes · ${noN} no · ${untN} untracked`, margin + colW - 4, ay, { align: 'right' });
                ay += 5;
              });
              allCustomTracked.forEach(f => {
                const yesN = allEntries.filter(e => e.customFields?.[f.id] === 'yes').length;
                const noN  = allEntries.filter(e => e.customFields?.[f.id] === 'no').length;
                const untN = allEntries.length - yesN - noN;
                setColor(grey); doc.setFont(undefined, 'normal'); doc.text(f.label, margin + 4, ay);
                setColor(dark); doc.setFont(undefined, 'bold');
                doc.text(`${yesN} yes · ${noN} no · ${untN} untracked`, margin + colW - 4, ay, { align: 'right' });
                ay += 5;
              });
            }
            // Right: 30d
            setDraw([220,220,220]); setFill([255,255,255]);
            doc.roundedRect(col2, y, colW, adBoxH, 2, 2, 'FD');
            let ry = y + 6;
            doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
            doc.text((_periodLabel(rightPeriod) + ' ' + BB.t('journal.pdf.additionalData')).toUpperCase(), col2 + 4, ry);
            setDraw(orange); doc.setLineWidth(0.4);
            doc.line(col2 + 4, ry + 1, col2 + colW - 4, ry + 1);
            ry += 6; doc.setFontSize(7);
            if (recentTracked.length === 0 && recentCustomTracked.length === 0) {
              setColor(grey); doc.setFont(undefined, 'italic'); doc.text(BB.t('journal.pdf.noDataForPeriod'), col2 + 4, ry);
            } else {
              recentTracked.forEach(f => {
                const yesN = recent.filter(e => e[f.key] === 'yes').length;
                const noN  = recent.filter(e => e[f.key] === 'no').length;
                const untN = recent.length - yesN - noN;
                setColor(grey); doc.setFont(undefined, 'normal'); doc.text(f.label, col2 + 4, ry);
                setColor(dark); doc.setFont(undefined, 'bold');
                doc.text(`${yesN} yes · ${noN} no · ${untN} untracked`, col2 + colW - 4, ry, { align: 'right' });
                ry += 5;
              });
              recentCustomTracked.forEach(f => {
                const yesN = recent.filter(e => e.customFields?.[f.id] === 'yes').length;
                const noN  = recent.filter(e => e.customFields?.[f.id] === 'no').length;
                const untN = recent.length - yesN - noN;
                setColor(grey); doc.setFont(undefined, 'normal'); doc.text(f.label, col2 + 4, ry);
                setColor(dark); doc.setFont(undefined, 'bold');
                doc.text(`${yesN} yes · ${noN} no · ${untN} untracked`, col2 + colW - 4, ry, { align: 'right' });
                ry += 5;
              });
            }
            y = Math.max(ay, ry) + 4;
          }
        }

        // ── PAGE 2: TREND CHARTS + PERSONALISED INSIGHTS ──
        const _anyChartOn = charts.mood !== false || charts.sleep !== false || charts.energy !== false || charts.steps !== false || charts.sleepQ !== false || charts.goals !== false || charts.budget !== false;
        if (_anyChartOn) { doc.addPage(); y = margin; }

        // Build monthly buckets (last 12 months) with mood, sleep, energy, steps
        const moodOrder = ['manic','elevated','stable','low','depressed'];
        const months = [];
        for (let mi = 11; mi >= 0; mi--) {
          const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - mi);
          months.push({ label: d.toLocaleDateString('en-GB',{month:'short'}), year: d.getFullYear(), month: d.getMonth(), counts: {}, sleeps: [], energies: [], steps: [], sleepQualities: [], goalsOnTrack: [], budgetKept: [] });
        }
        entries.forEach(e => {
          const d = new Date(e.date);
          const bucket = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth());
          if (bucket) {
            bucket.counts[_moodCat(e.mood)] = (bucket.counts[_moodCat(e.mood)]||0)+1;
            if (e.linkedMood) bucket.counts[_moodCat(e.linkedMood)] = (bucket.counts[_moodCat(e.linkedMood)]||0)+1;
            if (e.sleep  != null) bucket.sleeps.push(e.sleep);
            if (e.energy != null) bucket.energies.push(e.energy);
            if (e.steps  != null && e.steps > 0) bucket.steps.push(e.steps);
            if (e.sleepQuality) bucket.sleepQualities.push(e.sleepQuality);
            if (e.goals)  bucket.goalsOnTrack.push(e.goals === 'some' ? 1 : 0);
            if (e.budget) bucket.budgetKept.push(e.budget === 'yes' ? 1 : 0);
          }
        });

        const chartX = margin + 6;
        const chartW = pageW - margin * 2 - 12;

        // Helper: render a simple monthly average bar chart
        function renderAvgBars(getAvg, maxVal, fillRgb, chartTopY, barHeight, formatVal) {
          const bW = (chartW / months.length) - 1.5;
          months.forEach((m, i) => {
            const avg = getAvg(m);
            if (avg === null) return;
            const x = chartX + i * (chartW / months.length);
            const h = (avg / maxVal) * barHeight;
            setFill(fillRgb); doc.rect(x, chartTopY + barHeight - h, bW, h, 'F');
            if (formatVal) {
              const valLabel = formatVal(avg);
              doc.setFontSize(5); doc.setFont(undefined, 'bold');
              if (h >= 7) {
                setColor([255, 255, 255]);
                doc.text(valLabel, x + bW / 2, chartTopY + barHeight - h / 2 + 1.5, { align: 'center' });
              } else {
                setColor(fillRgb);
                doc.text(valLabel, x + bW / 2, chartTopY + barHeight - h - 1, { align: 'center' });
              }
            }
            doc.setFontSize(5.5); setColor(grey); doc.setFont(undefined, 'normal');
            doc.text(m.label, x + bW/2, chartTopY + barHeight + 4, { align: 'center' });
          });
        }

        // ── 12-MONTH MOOD TRENDS ──
        if (charts.mood !== false) {
          const chartBoxHeight = 54;
          setDraw([220,220,220]); setFill([255,255,255]);
          doc.roundedRect(margin, y, pageW - margin*2, chartBoxHeight, 2, 2, 'FD');
          let chartY = y + 6;
          doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
          doc.text(BB.t('journal.pdf.moodTrends').toUpperCase(), margin + 4, chartY);
          setDraw(orange); doc.setLineWidth(0.4);
          doc.line(margin + 4, chartY + 1, pageW - margin - 4, chartY + 1);
          chartY += 8;

          const chartH = 26;
          const barW   = (chartW / months.length) - 1.5;
          const maxVal = Math.max(...months.map(m => Object.values(m.counts).reduce((s,v)=>s+v,0)), 1);
          months.forEach((m, i) => {
            const x = chartX + i * (chartW / months.length);
            let stackY = chartY + chartH;
            moodOrder.forEach(mood => {
              const count = m.counts[mood] || 0;
              if (count === 0) return;
              const h = (count / maxVal) * chartH;
              stackY -= h;
              drawBar(x, stackY, barW, h, moodColor(mood));
            });
            doc.setFontSize(5.5); setColor(grey); doc.setFont(undefined, 'normal');
            doc.text(m.label, x + barW/2, chartY + chartH + 4, { align: 'center' });
          });
          // Key
          chartY += chartH + 10;
          doc.setFontSize(6.5); doc.setFont(undefined, 'bold'); setColor(dark);
          const keyItemWidth = 20;
          const totalKeyWidth = 10 + (moodOrder.length * keyItemWidth);
          const keyStartX = (pageW - totalKeyWidth) / 2;
          doc.text(BB.t('journal.pdf.key'), keyStartX, chartY);
          let keyX = keyStartX + 10;
          moodOrder.forEach(mood => {
            setFill(moodColor(mood)); doc.rect(keyX, chartY - 2.5, 2.5, 2.5, 'F');
            setColor(grey); doc.setFont(undefined, 'normal');
            doc.text(mood.charAt(0).toUpperCase()+mood.slice(1), keyX + 4, chartY);
            keyX += keyItemWidth;
          });
          y += chartBoxHeight + 4;
        }

        // ── 12-MONTH SLEEP TRENDS ──
        if (charts.sleep !== false) {
          const tH = 40;
          setDraw([220,220,220]); setFill([255,255,255]);
          doc.roundedRect(margin, y, pageW - margin*2, tH, 2, 2, 'FD');
          let tY = y + 6;
          doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
          doc.text(BB.t('journal.pdf.sleepTrends').toUpperCase(), margin + 4, tY);
          setDraw([100,149,237]); doc.setLineWidth(0.4);
          doc.line(margin + 4, tY + 1, pageW - margin - 4, tY + 1);
          tY += 7;
          const maxSleep = Math.max(...months.map(m => m.sleeps.length ? m.sleeps.reduce((s,v)=>s+v,0)/m.sleeps.length : 0), 10);
          renderAvgBars(m => m.sleeps.length ? m.sleeps.reduce((s,v)=>s+v,0)/m.sleeps.length : null, maxSleep, [100,149,237], tY, 18, v => v.toFixed(1) + 'h');
          y += tH + 4;
        }

        // ── 12-MONTH ENERGY TRENDS ──
        if (charts.energy !== false) {
          const tH = 40;
          setDraw([220,220,220]); setFill([255,255,255]);
          doc.roundedRect(margin, y, pageW - margin*2, tH, 2, 2, 'FD');
          let tY = y + 6;
          doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
          doc.text(BB.t('journal.pdf.energyTrends').toUpperCase(), margin + 4, tY);
          setDraw(orange); doc.setLineWidth(0.4);
          doc.line(margin + 4, tY + 1, pageW - margin - 4, tY + 1);
          tY += 7;
          const maxEnergy = 10;
          renderAvgBars(m => m.energies.length ? m.energies.reduce((s,v)=>s+v,0)/m.energies.length : null, maxEnergy, [255,149,0], tY, 18, v => v.toFixed(1));
          y += tH + 4;
        }

        // ── 12-MONTH STEPS TRENDS (only if data exists and toggle on) ──
        if (charts.steps !== false) {
          const hasStepsData = months.some(m => m.steps.length > 0);
          if (hasStepsData) {
            const tH = 40;
            setDraw([220,220,220]); setFill([255,255,255]);
            doc.roundedRect(margin, y, pageW - margin*2, tH, 2, 2, 'FD');
            let tY = y + 6;
            doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
            doc.text(BB.t('journal.pdf.stepsTrends').toUpperCase(), margin + 4, tY);
            setDraw([81,207,102]); doc.setLineWidth(0.4);
            doc.line(margin + 4, tY + 1, pageW - margin - 4, tY + 1);
            tY += 7;
            const maxSteps = Math.max(...months.map(m => m.steps.length ? m.steps.reduce((s,v)=>s+v,0)/m.steps.length : 0), 1);
            renderAvgBars(m => m.steps.length ? m.steps.reduce((s,v)=>s+v,0)/m.steps.length : null, maxSteps, [81,207,102], tY, 18, v => v >= 1000 ? (v/1000).toFixed(1) + 'k' : Math.round(v).toString());
            y += tH + 4;
          }
        }

        // ── 12-MONTH SLEEP QUALITY TRENDS ──
        if (charts.sleepQ !== false) {
          const hasData = months.some(m => m.sleepQualities.length > 0);
          if (hasData) {
            if (y > pageH - 50) { doc.addPage(); y = margin; }
            const tH = 40;
            setDraw([220,220,220]); setFill([255,255,255]);
            doc.roundedRect(margin, y, pageW - margin*2, tH, 2, 2, 'FD');
            let tY = y + 6;
            doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
            doc.text(BB.t('journal.pdf.sleepQualityTrends').toUpperCase(), margin + 4, tY);
            setDraw([100,149,237]); doc.setLineWidth(0.4);
            doc.line(margin + 4, tY + 1, pageW - margin - 4, tY + 1);
            tY += 7;
            renderAvgBars(m => m.sleepQualities.length ? Math.round(m.sleepQualities.filter(q=>q==='good').length / m.sleepQualities.length * 100) : null, 100, [81,207,102], tY, 18, v => Math.round(v) + '%');
            y += tH + 4;
          }
        }

        // ── 12-MONTH GOALS ON TRACK ──
        if (charts.goals !== false) {
          const hasData = months.some(m => m.goalsOnTrack.length > 0);
          if (hasData) {
            if (y > pageH - 50) { doc.addPage(); y = margin; }
            const tH = 40;
            setDraw([220,220,220]); setFill([255,255,255]);
            doc.roundedRect(margin, y, pageW - margin*2, tH, 2, 2, 'FD');
            let tY = y + 6;
            doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
            doc.text(BB.t('journal.pdf.goalsTrends').toUpperCase(), margin + 4, tY);
            setDraw(orange); doc.setLineWidth(0.4);
            doc.line(margin + 4, tY + 1, pageW - margin - 4, tY + 1);
            tY += 7;
            renderAvgBars(m => m.goalsOnTrack.length ? Math.round(m.goalsOnTrack.reduce((s,v)=>s+v,0) / m.goalsOnTrack.length * 100) : null, 100, [255,149,0], tY, 18, v => Math.round(v) + '%');
            y += tH + 4;
          }
        }

        // ── 12-MONTH BUDGET KEPT ──
        if (charts.budget !== false) {
          const hasData = months.some(m => m.budgetKept.length > 0);
          if (hasData) {
            if (y > pageH - 50) { doc.addPage(); y = margin; }
            const tH = 40;
            setDraw([220,220,220]); setFill([255,255,255]);
            doc.roundedRect(margin, y, pageW - margin*2, tH, 2, 2, 'FD');
            let tY = y + 6;
            doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
            doc.text(BB.t('journal.pdf.budgetTrends').toUpperCase(), margin + 4, tY);
            setDraw([81,207,102]); doc.setLineWidth(0.4);
            doc.line(margin + 4, tY + 1, pageW - margin - 4, tY + 1);
            tY += 7;
            renderAvgBars(m => m.budgetKept.length ? Math.round(m.budgetKept.reduce((s,v)=>s+v,0) / m.budgetKept.length * 100) : null, 100, [81,207,102], tY, 18, v => Math.round(v) + '%');
            y += tH + 4;
          }
        }

        // ── LIFE CHART (last 90 days, js/journal-insights.js) — with the other charts ──
        if (_anyChartOn && window.BBInsights && window.BBInsights.drawLifeChartPdf) {
          y = window.BBInsights.drawLifeChartPdf(doc, entries, { margin, pageW, pageH, y });
        }

        // ── PERSONALISED INSIGHTS ──
        {
          const pdfSorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
          const pdfInsights = pdfSorted.length >= 7 ? computeInsights(pdfSorted) : [];

          if (pdfInsights.length > 0) {
            if (!_anyChartOn || y > pageH - 50) { doc.addPage(); y = margin; } else { y += 4; }

            // Section header
            doc.setFontSize(9); doc.setFont(undefined, 'bold'); setColor(dark);
            doc.text(BB.t('journal.pdf.personalisedInsights').toUpperCase(), margin + 4, y);
            setDraw(orange); doc.setLineWidth(0.5);
            doc.line(margin + 4, y + 1, pageW - margin - 4, y + 1);
            y += 6;

            // Disclaimer
            doc.setFontSize(6.5); doc.setFont(undefined, 'italic'); setColor([160, 160, 160]);
            doc.text(BB.t('journal.pdf.insightsDisclaimer'), margin + 4, y);
            y += 7;

            pdfInsights.forEach(insight => {
              if (y > pageH - 30) { doc.addPage(); y = margin; }

              const rgb = insight.accentRgb;

              // Coloured left bar
              setFill(rgb);
              doc.rect(margin + 2, y - 1, 2.5, 14, 'F');

              // Title
              doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor(dark);
              doc.text(insight.title, margin + 8, y + 3);

              // Body text (wrapped)
              doc.setFontSize(7); doc.setFont(undefined, 'normal'); setColor([80, 80, 80]);
              const bodyLines = doc.splitTextToSize(insight.text, pageW - margin * 2 - 14);
              doc.text(bodyLines, margin + 8, y + 8);
              let insightBottom = y + 8 + bodyLines.length * 3.2;

              // Detail line (e.g. sleep band breakdown)
              if (insight.detail) {
                doc.setFontSize(6.5); setColor([140, 140, 140]);
                const detailLines = doc.splitTextToSize(insight.detail, pageW - margin * 2 - 14);
                doc.text(detailLines, margin + 8, insightBottom + 1.5);
                insightBottom += detailLines.length * 3 + 1.5;
              }

              // Separator
              setDraw([230, 230, 230]); doc.setLineWidth(0.15);
              doc.line(margin + 6, insightBottom + 3, pageW - margin - 6, insightBottom + 3);
              y = insightBottom + 7;
            });
          }
        }

        // ── RECENT ENTRIES start on next page ──
        if (recentEntriesPeriod !== 'none') {
        const _recentCutoff = recentEntriesPeriod === 'all' ? 0
          : recentEntriesPeriod === '7d'  ? now - 7  * 86400000
          : /* 30d default */               now - 30 * 86400000;
        const _recentLabel = recentEntriesPeriod === 'all' ? 'ALL' : recentEntriesPeriod === '7d' ? '7 DAYS' : '30 DAYS';
        doc.addPage();
        y = margin;
        doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor([60,60,60]);
        doc.text(`RECENT ENTRIES (${_recentLabel})`, margin + 4, y);
        setDraw(orange); doc.setLineWidth(0.4);
        doc.line(margin + 4, y + 1, pageW - margin - 4, y + 1);
        y += 8;

        const last30 = [...entries].filter(e => !e.pdfHidden && (recentEntriesPeriod === 'all' || e.timestamp >= _recentCutoff)).sort((a,b) => b.timestamp - a.timestamp);
        const hiddenCount = entries.filter(e => e.pdfHidden && (recentEntriesPeriod === 'all' || e.timestamp >= _recentCutoff)).length;
        if (hiddenCount > 0) {
          doc.setFontSize(7); doc.setFont(undefined, 'italic'); setColor(grey);
          doc.text(`${hiddenCount} entr${hiddenCount === 1 ? 'y' : 'ies'} hidden · manage in ⊕ More data or Settings`, margin + 4, y);
          y += 6;
        }
        last30.forEach(entry => {
          if (y > pageH - 20) { doc.addPage(); y = margin + 10; }
          const d = new Date(entry.date);
          const dateStr = d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });

          // Mood colour dot - properly positioned
          const mc = moodColor(entry.mood);
          const dotX = margin + 8;
          setFill(mc); doc.circle(dotX, y - 0.5, 1.5, 'F');

          doc.setFontSize(8); doc.setFont(undefined, 'bold'); setColor(dark);
          doc.text(dateStr, dotX + 5, y);

          doc.setFont(undefined, 'normal'); setColor(grey);
          const recordedPart = entry.recordedAt
            ? `  ·  ${new Date(entry.recordedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${entry.recordedTz ? ' ' + entry.recordedTz : ''}`
            : '';
          const stepsStr    = entry.steps    != null ? `  ·  Steps ${Number(entry.steps).toLocaleString()}` : '';
          // Flag estimated days explicitly — a clinician reading this must not
          // mistake an auto-filled guess for something the user reported.
          const autoStr     = entry.autoFilled ? `  ·  ${BB.t('journal.autofill.pdfNote')}` : '';
          const alcoholStr      = entry.alcohol     ? `  ·  Alcohol: ${entry.alcohol === 'yes' ? BB.t('journal.value.yes') : BB.t('journal.value.no')}` : '';
          const smokingStr      = entry.smoking     ? `  ·  Smoked: ${entry.smoking === 'yes' ? BB.t('journal.value.yes') : BB.t('journal.value.no')}` : '';
          const drugsStr        = entry.drugs       ? `  ·  Drugs: ${entry.drugs === 'yes' ? BB.t('journal.value.yes') : BB.t('journal.value.no')}` : '';
          const exerciseStr     = entry.exercise    ? `  ·  Exercise: ${entry.exercise === 'yes' ? BB.t('journal.value.yes') : BB.t('journal.value.no')}` : '';
          const _relLabel = v => v === 'high' ? BB.t('journal.value.moreThanUsual') : v === 'medium' ? BB.t('journal.value.normal') : BB.t('journal.value.lessThanUsual');
          const anxietyStr      = entry.anxiety     ? `  ·  Anxiety: ${_relLabel(entry.anxiety)}` : '';
          const irritabilityStr = entry.irritability ? `  ·  Irritability: ${entry.irritability === 'yes' ? BB.t('journal.value.moreThanUsual') : entry.irritability === 'medium' ? BB.t('journal.value.normal') : BB.t('journal.value.lessThanUsual')}` : '';
          const stressStr2      = entry.stress      ? `  ·  Stress: ${_relLabel(entry.stress)}` : '';
          const outsideStr      = entry.outside     ? `  ·  Outside: ${entry.outside === 'yes' ? BB.t('journal.value.yes') : BB.t('journal.value.no')}` : '';
          const sleepQualityStr = entry.sleepQuality ? `  ·  Sleep quality: ${entry.sleepQuality === 'good' ? BB.t('journal.value.good') : entry.sleepQuality === 'bad' ? BB.t('journal.value.bad') : BB.t('journal.value.ok')}` : '';
          const customStr = Object.entries(entry.customFields || {})
            .map(([id, val]) => {
              const cf = getCustomFields().find(f => f.id === id);
              return cf ? `  ·  ${cf.label}: ${val === 'yes' ? BB.t('journal.value.yes') : BB.t('journal.value.no')}` : '';
            }).filter(Boolean).join('');
          const _moodLabel = { manic:BB.t('mood.manic'), elevated:BB.t('mood.elevated'), stable:BB.t('mood.stable'), good:BB.t('mood.stable'), low:BB.t('mood.low'), depressed:BB.t('mood.depressed') };
          const detail = `${_moodLabelNum(entry.mood)}  ·  Energy ${entry.energy}/10  ·  Sleep ${entry.sleep}h${sleepQualityStr}${stepsStr}  ·  Meds: ${entry.medication === 'not-taken' ? BB.t('journal.pdf.noForgot') : entry.medication === 'unsure' ? BB.t('journal.pdf.unsure') : (entry.medication || 'taken')}${anxietyStr}${irritabilityStr}${stressStr2}${alcoholStr}${smokingStr}${drugsStr}${exerciseStr}${outsideStr}${customStr}${autoStr}${recordedPart}`;
          const detailLines = doc.splitTextToSize(detail, pageW - margin - (dotX + 35));
          doc.text(detailLines, dotX + 35, y);
          y += (detailLines.length - 1) * 4;

          if (entry.notes) {
            y += 4;
            doc.setFontSize(7); doc.setFont(undefined, 'italic'); setColor([160,160,160]);
            const lines = doc.splitTextToSize(entry.notes, pageW - margin * 2 - 12);
            doc.text(lines, dotX + 5, y);
            y += lines.length * 3.5;
          }
          if (entry.intention && entry.intention.trim()) {
            y += 4;
            doc.setFontSize(7); doc.setFont(undefined, 'italic'); setColor([160,160,160]);
            const iLines = doc.splitTextToSize(`Intention: ${entry.intention.trim()}`, pageW - margin * 2 - 12);
            doc.text(iLines, dotX + 5, y);
            y += iLines.length * 3.5;
          }

          setDraw([230,230,230]); doc.setLineWidth(0.15);
          doc.line(margin + 6, y + 2.5, pageW - margin - 6, y + 2.5);
          y += 6.5;
        });
        } // end recentEntriesPeriod !== 'none'

        // ── FOOTER on every page ──
        const totalPages = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
          doc.setPage(p);
          setDraw([200,200,200]); doc.setLineWidth(0.3);
          doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
          doc.setFontSize(6); setColor([120,120,120]); doc.setFont(undefined, 'normal');
          doc.text(BB.t('journal.pdf.footerClinical'), margin, pageH - 8);
          doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 8, { align: 'right' });
          doc.setFontSize(5.5); setColor([150,150,150]);
          doc.text(BB.t('journal.pdf.footerReview'), margin, pageH - 4);
        }

        // Save
        const filename = `bipolarbear-${new Date().toISOString().split('T')[0]}.pdf`;
        
        // Native app (Capacitor)
        if (isNative()) {
          try {
            const Filesystem = getPlugin('Filesystem');
            const Share = getPlugin('Share');
            
            if (Filesystem) {
              const pdfData = doc.output('datauristring').split(',')[1]; // Get base64
              
              const result = await Filesystem.writeFile({
                path: filename,
                data: pdfData,
                directory: 'DOCUMENTS'
              });
              
              console.log('PDF saved to:', result.uri);
              
              // Try to share/open it
              if (Share) {
                await Share.share({
                  title: 'Mood Tracking Report',
                  text: 'Your BipolarBear mood report',
                  url: result.uri,
                  dialogTitle: 'Save or Share Your Report'
                });
              } else {
                alert(BB.t('journal.dlg.pdfSavedDocs') + filename);
              }
            } else {
              alert(BB.t('journal.dlg.pdfFsPluginNA'));
            }
          } catch (nativeError) {
            console.error('Native PDF error:', nativeError);
            alert(BB.t('journal.dlg.pdfSaveFail') + nativeError.message);
          }
        }
        // Mobile web
        else if (/Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
          try {
            const blob = doc.output('blob');
            const url = URL.createObjectURL(blob);
            
            // Try to open in new tab (works better on mobile)
            const newWindow = window.open(url, '_blank');
            
            if (newWindow) {
              // Success - opened in new tab
              console.log('PDF opened in new tab');
              alert(BB.t('journal.dlg.pdfOpened'));
              setTimeout(() => URL.revokeObjectURL(url), 30000);
            } else {
              // Popup blocked - try download link
              const link = document.createElement('a');
              link.href = url;
              link.download = filename;
              link.style.display = 'none';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              setTimeout(() => URL.revokeObjectURL(url), 100);
              console.log('PDF download triggered');
              alert(BB.t('journal.dlg.pdfDownloaded'));
            }
          } catch (mobileError) {
            console.error('Mobile PDF error:', mobileError);
            alert(BB.t('journal.dlg.pdfCreateFail') + mobileError.message);
          }
        } else {
          // Desktop
          doc.save(filename);
          console.log('PDF saved:', filename);
          alert(BB.t('journal.dlg.pdfReportDownloaded'));
        }
      } catch (error) {
        console.error('Error exporting PDF:', error);
        alert(BB.t('journal.dlg.pdfExportFail') + error.message);
      }
    }

    function showImportModal() {
      document.getElementById('importModal').classList.add('active');
    }

    function closeImportModal() {
      document.getElementById('importModal').classList.remove('active');
    }

    function selectImportFormat(format) {
      closeImportModal();
      if (format === 'bipolarbear') {
        document.getElementById('importFileBipolarBear').click();
      } else if (format === 'daylio') {
        document.getElementById('importFileDaylio').click();
      }
    }

    async function importBipolarBearData(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const parsed = JSON.parse(e.target.result);

          // Support both old format (plain array) and new format ({ version, entries, settings })
          const entries = Array.isArray(parsed) ? parsed : (parsed.entries || []);
          const settings = (!Array.isArray(parsed) && parsed.settings) ? parsed.settings : null;

          if (!Array.isArray(entries)) {
            alert(BB.t('journal.dlg.invalidBackup'));
            return;
          }

          let imported = 0;
          for (const entry of entries) {
            if (entry.timestamp && entry.mood) {
              if (currentUser) {
                entry.userId = currentUser.uid;
                await db.collection('entries').add(entry);
              } else {
                localStorage.setItem(`entry:${entry.timestamp}`, JSON.stringify(entry));
              }
              imported++;
            }
          }

          // Restore settings if present
          if (settings) {
            Object.keys(settings).forEach(k => localStorage.setItem(k, settings[k]));

            // Push settings to Firestore if logged in
            if (currentUser && window.db) {
              const _boolKey = v => v === 'true' ? true : v === 'false' ? false : v;
              const fsSettings = {};
              ['focusedModeEnabled','fmConfirmStep','fmAutoAdvance','fmAutoAdvanceMoreData',
               'elaborateResponsesEnabled','intentionEnabled','incognitoMode','pdfHideByDefault',
               'showMoodSuggestion','moreDataOpenByDefault','achievementToastsEnabled',
               'weeklySummaryEnabled','customiseFormEnabled','moodLinkingEnabled','moodSpectrumEnabled','wheelModeEnabled',
               'earlyWarnEnabled'].forEach(k => {
                if (settings[k] !== undefined) fsSettings[k] = _boolKey(settings[k]);
              });
              if (settings.statsStartDate) fsSettings.statsStartDate = settings.statsStartDate;
              if (settings.disabledSteps) {
                try { fsSettings.disabledSteps = JSON.parse(settings.disabledSteps); } catch(e) {}
              }
              if (settings.customTrackingFields) {
                try { fsSettings.customTrackingFields = JSON.parse(settings.customTrackingFields); } catch(e) {}
              }
              // Build trackingFields object for Firestore
              const trackingFields = {};
              ['trackGoals','trackBudget','trackExercise','trackOutside','trackAnxiety','trackAlcohol','trackEmotions'].forEach(k => {
                if (settings[k] !== undefined) trackingFields[k.replace('track','')] = _boolKey(settings[k]);
              });
              if (Object.keys(trackingFields).length) fsSettings.trackingFields = trackingFields;
              // Label overrides
              const labelOverrides = {};
              Object.keys(settings).filter(k => k.startsWith('_labelOverride_')).forEach(k => {
                labelOverrides[k.replace('_labelOverride_', '')] = settings[k];
              });
              if (Object.keys(labelOverrides).length) fsSettings.labelOverrides = labelOverrides;
              window.db.collection('userSettings').doc(currentUser.uid).set(fsSettings, { merge: true }).catch(() => {});
            }

            // Refresh UI to reflect imported settings
            if (typeof _renderStepToggles === 'function') _renderStepToggles();
            if (typeof _applyStepVisibility === 'function') _applyStepVisibility();
            if (typeof applyTrackingPrefs === 'function') applyTrackingPrefs();
            if (typeof renderFieldPickerList === 'function') renderFieldPickerList();
            if (typeof renderCustomTrackingRows === 'function') renderCustomTrackingRows();
          }

          // Open journal card if closed, then reload entries
          const journalCard = document.getElementById('journalCard');
          const toggleBtn = document.getElementById('journalToggleBtn');
          if (journalCard && journalCard.style.display === 'none') {
            journalCard.style.display = 'block';
            if (toggleBtn) toggleBtn.innerHTML = BB.t('journal.btn.closeJournal');
          }
          await loadEntries();
          const settingsNote = settings ? BB.t('journal.dlg.settingsRestored') : '';
          alert(BB.t('journal.dlg.importSuccess', { n: imported, note: settingsNote }));
          event.target.value = '';
        } catch (error) {
          console.error('Error importing:', error);
          alert(BB.t('journal.dlg.importDataFail'));
        }
      };

      reader.readAsText(file);
    }

    async function importDaylioData(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const csvText = e.target.result;
          const lines = csvText.split('\n');
          
          // Skip header line
          if (lines.length < 2) {
            alert(BB.t('journal.dlg.csvEmpty'));
            return;
          }

          // Daylio CSV format: full_date,date,weekday,time,mood,activities,note_title,note
          // Daylio uses a 7-point scale: "3 or less", "4 - OKish", "5 Healthy", "6 OK++", "7 or more"
          
          let imported = 0;
          
          /* === CUSTOMIZE MOOD MAPPING FOR YOUR DAYLIO EXPORT ===
           * If your Daylio uses different mood labels, update the mapping below.
           * 
           * To find your mood labels:
           * 1. Open your Daylio CSV in a text editor
           * 2. Look at the 5th column (after date, weekday, time)
           * 3. Update the left side of each line below to match your mood labels
           * 4. Keep the right side as the BipolarBear mood (manic/elevated/stable/low/depressed)
           * 
           * Example: If your CSV shows "awesome" instead of "7 or more", change:
           *   '7 or more': 'manic'    →    'awesome': 'manic'
           */
          
          // Map Daylio's mood scale to BipolarBear's bipolar-specific moods
          const moodMap = {
            '7 or more': 'manic',      // Highest mood/energy → Manic
            '6 ok++': 'elevated',       // Above baseline → Elevated
            '5 healthy': 'stable',       // Baseline/stable → Stable
            '4 - okish': 'low',         // Below baseline → Low
            '3 or less': 'depressed',   // Lowest mood → Depressed
            // Legacy Daylio format (if using standard 5-point scale)
            'rad': 'manic',
            'good': 'elevated',
            'meh': 'stable',
            'bad': 'low',
            'awful': 'depressed'
          };

          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Parse CSV (handle quoted fields with commas)
            const fields = [];
            let currentField = '';
            let inQuotes = false;
            
            for (let char of line) {
              if (char === '"') {
                inQuotes = !inQuotes;
              } else if (char === ',' && !inQuotes) {
                fields.push(currentField.trim());
                currentField = '';
              } else {
                currentField += char;
              }
            }
            fields.push(currentField.trim());

            if (fields.length < 5) continue;

            const [fullDate, , , , daylioMood, activities, noteTitle, noteText] = fields;
            const mappedMood = moodMap[daylioMood.toLowerCase()] || 'stable'; // Default to 'stable' if mood not recognized
            
            // Parse date
            const dateParts = fullDate.split('-');
            if (dateParts.length !== 3) continue;
            
            const entryDate = new Date(fullDate);
            const timestamp = entryDate.getTime();

            // Build notes from note text only (exclude activities)
            let notes = '';
            if (noteText && noteText !== '""') {
              notes = noteText.replace(/"/g, '');
            }

            const entry = {
              timestamp: timestamp,
              date: entryDate.toISOString(),
              mood: mappedMood,
              energy: 5, // Default middle value
              sleep: 7, // Default 7 hours
              medication: 'taken', // Default to taken
              notes: notes || ''
            };

            try {
              if (currentUser) {
                entry.userId = currentUser.uid;
                await db.collection('entries').add(entry);
              } else {
                localStorage.setItem(`entry:${timestamp}`, JSON.stringify(entry));
              }
              imported++;
            } catch (err) {
              console.error('Error importing entry:', err);
            }
          }

          const jCard = document.getElementById('journalCard');
          const tBtn = document.getElementById('journalToggleBtn');
          if (jCard && jCard.style.display === 'none') {
            jCard.style.display = 'block';
            if (tBtn) tBtn.innerHTML = BB.t('journal.btn.closeJournal');
          }
          await loadEntries();
          alert(BB.t('journal.dlg.daylioImportSuccess', { n: imported }));
          event.target.value = '';
        } catch (error) {
          console.error('Error importing Daylio data:', error);
          alert(BB.t('journal.dlg.daylioImportFail'));
        }
      };
      
      reader.readAsText(file);
    }

    function closeConfirmModal() {
      document.getElementById('confirmModal').classList.remove('active');
      pendingDeleteKey = null;
      pendingDraftClear = false;
      _pendingDeleteBuiltinKey = null;
      // Restore default modal text for next use
      document.getElementById('confirmModalTitle').textContent = BB.t('journal.delete.title');
      document.getElementById('confirmModalBody').textContent = BB.t('journal.delete.body');
      document.getElementById('confirmModalBtn').textContent = BB.t('journal.delete.btn');
    }

    function deleteEditingEntry() {
      if (!editingEntry) return;
      pendingDeleteKey = editingEntry.id;
      document.getElementById('confirmModal').classList.add('active');
    }

    async function confirmDelete() {
      if (_pendingDeleteBuiltinKey) {
        const _k = _pendingDeleteBuiltinKey;
        closeConfirmModal();
        _doDeleteBuiltinField(_k);
        return;
      }
      if (pendingDraftClear) {
        closeConfirmModal();
        cancelNewEntry();
        return;
      }
      if (pendingDeleteKey) {
        try {
          if (currentUser) {
            await db.collection('entries').doc(pendingDeleteKey).delete();
          } else {
            localStorage.removeItem(pendingDeleteKey);
          }
          const _wasFocused = typeof _fmActive !== 'undefined' && _fmActive;
          const _wasEditingEntry = !!editingEntry;
          closeConfirmModal();
          editingEntry = null;
          _editFieldOverrides = null;
          currentPage = 1;
          // Immediately clear tick so index.html reflects deletion without waiting for loadEntries
          try {
            const _s = JSON.parse(BB.storage.get('_entryStatus') || 'null');
            if (_s) { _s.done = false; BB.storage.set('_entryStatus', JSON.stringify(_s)); }
          } catch(e) {}
          // Reset form to fresh new-entry state (clears edit mode, data, heading)
          resetEntryForm();
          loadEntries();
          // If deleted from within focused mode
          if (_wasFocused) {
            if (_wasEditingEntry) {
              // Was editing an old entry — close focused mode entirely
              _fmActive = false;
              _fmSuppressReopen = false;
              _fmReturnToDone   = false;
              document.getElementById('focusedModeCard').style.display = 'none';
              const _eld = document.getElementById('fmExitLink');
              if (_eld) _eld.style.display = 'none';
            } else {
              // Was in new-entry focused mode — reset to step 0
              _fmStepIndex  = 0;
              _fmHighWater  = 0;
              _fmEnergyClear = true;
              _fmSleepClear  = true;
              _renderFocusedStep();
              const _fmCard = document.getElementById('focusedModeCard');
              if (_fmCard) _fmCard.style.display = '';
            }
          }
          nativeHaptic('light');
        } catch (error) {
          console.error('Error deleting:', error);
          nativeHaptic('error');
          alert(BB.t('journal.dlg.deleteEntryFail') + error.message);
        }
      }
    }

    function confirmResetSettings() {
      if (!confirm(BB.t('journal.dlg.resetSettings'))) return;
      const _keys = [
        'fmConfirmStep', 'fmAutoAdvance', 'fmAutoAdvanceMoreData',
        'elaborateResponsesEnabled', 'intentionEnabled',
        'incognitoMode', 'pdfHideByDefault',
        'showMoodSuggestion', 'moreDataOpenByDefault',
        'achievementToastsEnabled', 'statsStartDate', 'weeklySummaryEnabled',
        'customiseFormEnabled', 'disabledSteps', 'moodLinkingEnabled', 'moodSpectrumEnabled', 'wheelModeEnabled',
        'customTrackingFields', 'deletedDefaultCustomFields', 'deletedBuiltinFields',
        'earlyWarnEnabled', 'bbEarlyWarnSeen', 'bbJournalView', 'bbJournalRange',
      ];
      _keys.forEach(k => localStorage.removeItem(k));
      // Clear custom field toggle keys, label overrides, and tracking prefs (trackCustom_*, _labelOverride_*, trackXxx)
      Object.keys(localStorage).filter(k =>
        k.startsWith('trackCustom_') || k.startsWith('_labelOverride_') ||
        ['trackGoals','trackBudget','trackExercise','trackOutside','trackAnxiety','trackAlcohol','trackEmotions'].includes(k)
      ).forEach(k => localStorage.removeItem(k));
      // Keep focus mode on (it's the default)
      _fmEnabled = true;
      localStorage.setItem('focusedModeEnabled', '1');
      if (typeof _renderStepToggles === 'function') _renderStepToggles();
      if (typeof _applyStepVisibility === 'function') _applyStepVisibility();
      if (typeof applyTrackingPrefs === 'function') applyTrackingPrefs();
      if (typeof renderFieldPickerList === 'function') renderFieldPickerList();
      if (typeof renderCustomTrackingRows === 'function') renderCustomTrackingRows();
      // Rebuild focus mode steps so disabled steps (e.g. sleepQuality) take effect immediately
      if (typeof _fmActive !== 'undefined' && _fmActive && typeof _buildFocusedSteps === 'function') {
        const _ci = _fmSteps[_fmStepIndex] ? _fmSteps[_fmStepIndex].id : null;
        _fmSteps = _buildFocusedSteps();
        const _ni = _ci ? _fmSteps.findIndex(s => s.id === _ci) : -1;
        _fmStepIndex = _ni >= 0 ? _ni : Math.min(_fmStepIndex, _fmSteps.length - 1);
        _fmHighWater = Math.max(_fmHighWater, _fmStepIndex);
        _renderFocusedStep();
      }
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid).set({
          focusedModeEnabled: true, fmConfirmStep: false, elaborateResponsesEnabled: false,
          intentionEnabled: false, incognitoMode: false, moreDataOpenByDefault: false,
          achievementToastsEnabled: true, showMoodSuggestion: false, moodLinkingEnabled: false,
          customTrackingFields: [], trackingFields: {}, labelOverrides: {},
          earlyWarnEnabled: false,
        }, { merge: true }).catch(() => {});
      }
      closeSettingsModal();
      showToast(BB.t('journal.dlg.settingsResetToast'));
    }
    window.confirmResetSettings = confirmResetSettings;

    /**
     * Two-step confirmation flow that branches on auth state:
     *  - Signed in → "Delete Account" (full Firebase Auth + Firestore + local wipe)
     *  - Guest    → "Full Reset" (entries + localStorage only)
     * The actual destruction lives in deleteAllEntries({ deleteAccount }).
     */
    function confirmDeleteAll() {
      const count = _allEntries.length;
      const isSignedIn = !!currentUser;
      const accountLine = currentUser
        ? BB.t('journal.dlg.delAccountLine', { email: currentUser.email }) + '\n'
        : BB.t('journal.dlg.delGuestLine') + '\n';
      const action = isSignedIn
        ? BB.t('journal.dlg.delActionAccount', { count: count })
        : BB.t('journal.dlg.delActionGuest', { count: count });
      const message = BB.t('journal.dlg.delMessage', {
        heading: isSignedIn ? BB.t('journal.dlg.delHeadingAccount') : BB.t('journal.dlg.delHeadingGuest'),
        accountLine: accountLine,
        action: action,
      });
      if (!confirm(message)) return;
      const finalLine = isSignedIn
        ? BB.t('journal.dlg.delFinalAccount', { email: currentUser.email, count: count })
        : BB.t('journal.dlg.delFinalGuest', { count: count });
      if (!confirm(finalLine)) return;
      deleteAllEntries({ deleteAccount: isSignedIn });
    }

    /**
     * Wipes the user's data. Two modes via opts.deleteAccount:
     *
     *  - false (default): "full reset" — entries deleted (Firestore for
     *    accounts, localStorage `entry:*` for guests), localStorage cleared,
     *    userSettings doc reset to defaults (signed-in users), personalDetails
     *    doc deleted, then sign-out + redirect to index.
     *
     *  - true: "delete account" — everything above PLUS userSettings doc
     *    deleted (rather than reset), bbAnonMonikas reservation released,
     *    anonProfiles cross-device record deleted for both account and anon
     *    emails, and finally `currentUser.delete()` removes the Firebase Auth
     *    record. Re-authenticates upfront with the user's password so we
     *    never end up in a half-deleted state.
     *
     * @param {{ deleteAccount?: boolean }} [opts]
     */
    async function deleteAllEntries(opts) {
      opts = opts || {};
      const deleteAccount = !!opts.deleteAccount;

      // Re-authenticate upfront for account deletion. If the user can't
      // confirm their password we abort BEFORE touching any data — leaves
      // them in a known-good state.
      if (deleteAccount && currentUser) {
        const _pw = prompt(BB.t('journal.dlg.reauthPrompt'));
        if (!_pw) return; // cancelled
        try {
          const _cred = firebase.auth.EmailAuthProvider.credential(currentUser.email, _pw);
          await currentUser.reauthenticateWithCredential(_cred);
        } catch (_e) {
          alert(BB.t('journal.dlg.wrongPassword'));
          return;
        }
      }

      // Hoisted so the finally block can read them after a partial-failure
      // throw. _accountDeleted is set to true only after currentUser.delete()
      // resolves; deleted accumulates as entries are removed.
      let _accountDeleted = false;
      let deleted = 0;

      try {
        if (currentUser) {
          // Delete all entries from Firestore
          const snapshot = await db.collection('entries')
            .where('userId', '==', currentUser.uid)
            .get();
          
          const batch = db.batch();
          snapshot.forEach(doc => {
            batch.delete(doc.ref);
            deleted++;
          });
          
          await batch.commit();
        } else {
          // Delete all entries from localStorage
          const keysToDelete = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('entry:')) {
              keysToDelete.push(key);
            }
          }
          
          keysToDelete.forEach(key => {
            localStorage.removeItem(key);
            deleted++;
          });
        }
        
        // Clear all flags — full reset means truly starting from scratch
        ['unlockedAchievements','bbFavAnniShown',
         'bbPrivateHintSeen','bbFavouriteHintSeen','bb_moodTipShown','bb_fmMoodTipShown',
         'bb_fmChooseMoodHintDone','bb_fmMoodInfoCloseHintDone',
         'bbAdvancedBadgePending','bbAdvancedBadgeVisible',
         'bb_fmTapHoldHintPending','bb_fmTapHoldHintReady',
         'bbSettingsFabHintShown',
         'bbHasEntries',
         'bbOnboardingStep',
         // Streaks — must clear so the home page doesn't render a stale badge
         // for the just-deleted account on the post-redirect render.
         'bbCurrentStreak','bbStableStreak',
         'bbFeedbackFabHidden','bbWaFabHidden','bbReviewFabHidden','bbFooterHidden',
         // FAB customisation: clear slot assignments and the first-run flag
         // so the new install gets the first-run dock layout again.
         'bbFabSlot_1','bbFabSlot_2','bbFabSlot_3','bbFabSlot_4',
         'bbFabsUnlocked','bbFabFirstRunDone',
         'bbLogoEasterEggFound','bbCustomFieldHintDone',
         'personalName','personalDOB','personalMedicalNum','personalDiagnosis',
         'personalDiagnosisDate','personalAddress','personalMobile','personalEmail',
         'personalEmergencyContact','personalNotes',
        ].forEach(k => localStorage.removeItem(k));

        // Clear draft (cancel any pending auto-save first so it can't re-write after removal)
        clearTimeout(_draftSaveTimer);
        BB.storage.remove('_draft');

        // Clear home-screen tick caches so buttons show as unchecked
        BB.storage.remove('_entryStatus');
        BB.storage.remove('_recentMoods');
        try { BB.platform.syncWidgetMoods(); } catch (_) {}
        localStorage.removeItem('moodDefinitions');
        localStorage.removeItem('copingStrategies');
        localStorage.removeItem('moodMemories');
        localStorage.removeItem('survivalGratitude');
        localStorage.removeItem('rememberThis');
        localStorage.removeItem('myCommitments');
        localStorage.removeItem('customReminders');
        localStorage.removeItem('currentMedList');
        localStorage.removeItem('dailyGoals');
        localStorage.removeItem('dailyBudget');
        localStorage.removeItem('logoVariant');

        // Reset ALL app settings to defaults (same scope as confirmResetSettings)
        localStorage.setItem('focusedModeEnabled', '1');
        [
          'fmConfirmStep', 'fmAutoAdvance', 'fmAutoAdvanceMoreData',
          'elaborateResponsesEnabled', 'intentionEnabled',
          'incognitoMode', 'pdfHideByDefault',
          'showMoodSuggestion', 'moreDataOpenByDefault',
          'achievementToastsEnabled', 'statsStartDate', 'weeklySummaryEnabled',
          'customiseFormEnabled', 'disabledSteps', 'moodLinkingEnabled', 'moodSpectrumEnabled', 'wheelModeEnabled',
          'customTrackingFields', 'deletedDefaultCustomFields', 'deletedBuiltinFields',
          'earlyWarnEnabled', 'bbEarlyWarnSeen', 'bbJournalView', 'bbJournalRange',
          'bbPinEnabled', 'bbPinCode', 'bbNativePinEnabled',
          'bbHealthSyncEnabled', 'reminderEnabled', 'reminderTime',
          'journalDefaultToday', 'bbCoffeeFabHidden', 'bbQuickNoteFabHidden', 'bbSecurityFabHidden', 'bbQuickNotes',
        ].forEach(k => localStorage.removeItem(k));
        sessionStorage.removeItem('bbPinUnlocked');
        // Cancel any scheduled notifications (reminder + weekly summary)
        try {
          const _delNotifPlugin = getPlugin('LocalNotifications');
          if (_delNotifPlugin) {
            _delNotifPlugin.cancel({ notifications: [{ id: 1 }, { id: 2 }] }).catch(() => {});
          }
          // Medication reminder (js/shared/meds-reminder.js): forget + cancel.
          if (window.BB && BB.medsReminder) BB.medsReminder.clear().catch(() => {});
        } catch(_) {}
        // Clear dynamic tracking/label keys
        Object.keys(localStorage).filter(k =>
          k.startsWith('trackCustom_') || k.startsWith('_labelOverride_') ||
          ['trackGoals','trackBudget','trackExercise','trackOutside','trackAnxiety','trackEmotions','trackAlcohol'].includes(k)
        ).forEach(k => localStorage.removeItem(k));

        // Clear people-helped voted state so user can vote again after reset
        localStorage.removeItem('bipolarHelpedVoted');
        BB.storage.remove('PersonalHintDone');
        BB.storage.remove('MedHintDone');
        BB.storage.remove('SettingsHintDone');
        BB.storage.remove('CustomiseFormHintDone');
        BB.storage.remove('CustomiseAdditionalHintDone');
        BB.storage.remove('CloseSettingsHintDone');
        BB.storage.remove('CustomiseFormCollapsed');
        BB.storage.remove('AdvancedTutorialToastShown');
        BB.storage.remove('SurvivalKitVisited');
        BB.storage.remove('MoodDefHintDone');
        BB.storage.remove('PrivacyNoteDismissed');
        BB.storage.remove('TutorialToastShown');
        BB.storage.remove('WelcomeShown');
        BB.storage.remove('AccountHintShown');

        // Firestore cleanup. Two modes:
        //   deleteAccount → wipe every document tied to this user
        //   reset only    → reset userSettings fields, drop personalDetails
        if (currentUser && db) {
          if (deleteAccount) {
            // Hand the community counts back BEFORE the documents that hold
            // the one-time "counted" flags are destroyed. Both are best-effort
            // and no-op unless this device knows the account was counted.
            if (BB.userCount) {
              await BB.userCount.uncount(db, 'app');
              await BB.userCount.uncount(db, 'anon');
            }

            // Drop the entire userSettings doc (includes nested anonProfile).
            await db.collection('userSettings').doc(currentUser.uid).delete().catch(() => {});
            await db.collection('personalDetails').doc(currentUser.uid).delete().catch(() => {});

            // Release the anon-board monika reservation so others can claim it.
            const _monika = BB.storage.get('Anon_monika');
            if (_monika) {
              await db.collection(BB_BRAND.collections.monikas).doc(_monika.toLowerCase()).delete().catch(() => {});
            }

            // Drop cross-device anon profile lookups (hashed by lowercase email).
            const _hashEmail = async (email) => {
              const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase().trim()));
              return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
            };
            const _emails = [currentUser.email, BB.storage.get('Anon_email')]
              .filter(Boolean)
              .filter((e, i, arr) => arr.indexOf(e) === i); // de-dup
            for (const _e of _emails) {
              try {
                const _hash = await _hashEmail(_e);
                await db.collection('anonProfiles').doc(_hash).delete().catch(() => {});
              } catch (_) {}
            }
          } else {
            // Reset-only path: keep the userSettings doc, fields go back to defaults.
            db.collection('userSettings').doc(currentUser.uid).set({
              currentMedList: [], dailyGoals: [], dailyBudget: '', logoVariant: 0,
              focusedModeEnabled: true, fmConfirmStep: false, elaborateResponsesEnabled: false,
              intentionEnabled: false, incognitoMode: false, moreDataOpenByDefault: false,
              achievementToastsEnabled: true, showMoodSuggestion: false, moodLinkingEnabled: false,
              customTrackingFields: [], trackingFields: {}, labelOverrides: {},
              earlyWarnEnabled: false,
              moodDefinitions: {}, copingStrategies: {},
              onboardingStep: 0,
              helpedVoted: false,
              healthSyncEnabled: false,
              personalHintDone: false,
            }, { merge: true }).catch(() => {});
            // Personal details always go regardless of mode.
            db.collection('personalDetails').doc(currentUser.uid).delete().catch(() => {});
          }
        }

        // Clear anon-board localStorage so the next user on this browser
        // starts clean.
        ['Anon_monika','Anon_email','Anon_verified','Anon_isAdmin',
         'Anon_streak','Anon_med','Anon_medList','Anon_showMeds',
         'Anon_showStable','Anon_stableSince','Anon_stableStreak',
         'Anon_colorKey','Anon_initials','Anon_liked','Anon_hasPosted',
         'Anon_lastPostDate','Anon_allRead',
         'AnonLastVisit','AnonVisitDate'].forEach(k => BB.storage.remove(k));
        // Reset logo to default immediately
        if (typeof applyLogoVariant === 'function') applyLogoVariant(0);

        // Final explicit PIN clear before redirect — guards against any WKWebView localStorage
        // flush race where earlier removes might not have persisted across the navigation boundary.
        BB.storage.remove('NativePinEnabled');
        BB.storage.remove('PinEnabled');
        BB.storage.remove('PinCode');
        BB.storage.remove('GuestPinSalt');
        sessionStorage.removeItem('bbPinUnlocked');
        // Also clear the native Keychain PIN so it can't be reused after account reset
        try { window.Capacitor?.Plugins?.SecureStorage?.removeItem?.('bb_native_pin')?.catch?.(() => {}); } catch(e) {}

        // Account-deletion mode: delete the Firebase Auth record. We re-authed
        // upfront so this should succeed; if it doesn't, fall through to
        // sign-out so the user isn't trapped in a half-deleted state.
        // (_accountDeleted is declared above the outer try so the finally
        // block can read it.)
        if (deleteAccount && currentUser) {
          try {
            await currentUser.delete();
            _accountDeleted = true;
          } catch (_e) {
            console.error('user.delete failed', _e);
            // Data is already gone from Firestore — best to sign out.
          }
        }

        alert(deleteAccount
          ? (_accountDeleted ? BB.t('journal.dlg.accountDeleted') : BB.t('journal.dlg.accountDeleteAuthFail'))
          : BB.t('journal.dlg.entriesDeleted', { n: deleted }));
      } catch (error) {
        console.error('Error deleting all entries:', error);
        alert(BB.t('journal.dlg.cleanupFailed', { msg: error.message }));
      } finally {
        // Always redirect to /index.html so the tutorial restarts. We hit
        // this finally regardless of whether the try succeeded or threw,
        // so a Firestore blip mid-cleanup can't leave the user stranded
        // on /journal in a half-deleted state.
        //
        // user.delete() auto-signs the user out, so we only sign out
        // manually when the account-delete didn't run or failed AND a
        // session is still active. signOut is best-effort (no await) —
        // the new page will pick up whatever auth state actually persists.
        if (!_accountDeleted && typeof auth !== 'undefined' && auth && currentUser) {
          auth.signOut().catch(() => {});
        }
        location.replace('index.html');
      }
    }

    function changePage(direction) {
      currentPage += direction;
      loadEntries();
    }

    function goToPage(page) {
      currentPage = page;
      loadEntries();
    }
    window.goToPage = goToPage;

    // Collapsed on every visit; remembered across re-renders (paging, edits).
    var _entriesListOpen = false; // var: loadEntries (earlier in the file) may render first
    function toggleEntriesList() {
      _entriesListOpen = !_entriesListOpen;
      const list = document.getElementById('entriesReveal');
      const btn = document.getElementById('entriesRevealBtn');
      if (list) list.style.display = _entriesListOpen ? '' : 'none';
      if (btn) {
        btn.textContent = BB.t(_entriesListOpen ? 'journal.ui.hideEntries' : 'journal.ui.seeEntries');
        btn.setAttribute('aria-expanded', String(_entriesListOpen));
      }
    }
    window.toggleEntriesList = toggleEntriesList;

    function _journeyRangeLabel(r) {
      const hit = _JOURNEY_RANGES.find(x => x[0] === r);
      if (!hit) return r === 'all' ? 'All' : `${r}d`;
      const t = BB.t(hit[1]);
      return t && t !== hit[1] ? t : (r === 'all' ? 'All' : `${r}d`);
    }
    // Days the life chart spans: the range, or for All everything from the
    // stats start date (or the oldest entry) up to today.
    function getJournalRangeDays() {
      if (statsTimeframe !== 'all') return statsTimeframe;
      let first = statsStartDate ? new Date(statsStartDate + 'T00:00:00') : null;
      if (!first && _allEntries && _allEntries.length) {
        first = new Date(Math.min(..._allEntries.map(e => new Date(e.date).getTime()).filter(t => !isNaN(t))));
      }
      if (!first || isNaN(first)) return 365;
      const today = new Date(); today.setHours(0, 0, 0, 0); first.setHours(0, 0, 0, 0);
      return Math.max(30, Math.round((today - first) / 86400000) + 1);
    }
    window.getJournalRangeDays = getJournalRangeDays;

    function _renderJourneyRanges() {
      const host = document.getElementById('journeyRanges');
      if (!host) return;
      const def = _storedJourneyRange();
      const _tr = (k, fb) => { const t = BB.t(k); return t && t !== k ? t : fb; };
      const defLabel = _tr('journal.lifeChart.viewDefault', 'Default view');
      const note = _journeyRangeNote || (statsTimeframe !== def ? _tr('journal.lifeChart.viewTapAgain', 'Tap again to make this your default') : '');
      host.innerHTML =
        `<div class="cv-seg" role="group" aria-label="${_esc(_tr('journal.lifeChart.rangeLabel', 'Time range'))}">` +
        _JOURNEY_RANGES.map(r => {
          const on = r[0] === statsTimeframe;
          return `<button type="button" class="cv-opt${on ? ' on' : ''}" aria-pressed="${on}" onclick="setJournalRange(${r[0] === 'all' ? "'all'" : r[0]})">${_esc(_journeyRangeLabel(r[0]))}${r[0] === def ? ` <span class="cv-star" title="${_esc(defLabel)}" aria-label="${_esc(defLabel)}">★</span>` : ''}</button>`;
        }).join('') +
        `</div><div class="cv-note" aria-live="polite">${_esc(note)}</div>`;
    }

    function setJournalRange(r) {
      _journeyRangeNote = '';
      if (r === statsTimeframe) {
        if (_storedJourneyRange() !== r) {
          try { localStorage.setItem(_RANGE_KEY, String(r)); } catch (_) {}
          _journeyRangeNote = BB.t('journal.lifeChart.viewNowDefault');
        }
        _renderJourneyRanges();
        return;
      }
      statsTimeframe = r;
      _renderJourneyRanges();
      displayStats(_allEntries);
      displayChart(_allEntries);
      if (window.BBInsights && window.BBInsights.rangeChanged) {
        try { window.BBInsights.rangeChanged(); } catch (e) { console.warn('life chart range', e); }
      }
    }
    window.setJournalRange = setJournalRange;
    // The life chart's pinch / ctrl-wheel / arrow-key zoom steps through the
    // same ranges (js/journal-insights.js).
    window.stepJournalRange = function (dir) {
      const idx = Math.max(0, _JOURNEY_RANGES.findIndex(r => r[0] === statsTimeframe));
      const n = Math.max(0, Math.min(_JOURNEY_RANGES.length - 1, idx + dir));
      if (n !== idx) setJournalRange(_JOURNEY_RANGES[n][0]);
    };

    function toggleJournal() {
      const journalCard = document.getElementById('journalCard');
      const toggleBtn = document.getElementById('journalToggleBtn');
      
      if (journalCard.style.display === 'none') {
        journalCard.style.display = 'block';
        toggleBtn.innerHTML = BB.t('journal.btn.closeJournal');
        // Advance onboarding step 1→2 when user first opens journal (hint 2 fulfilled)
        _advanceOnboardingStep(2);
        if (window.BBInsights) window.BBInsights.onStatsOpen();
        // Do NOT call loadEntries() here — the init load already ran before this button
        // became visible, so entries are already populated in #entries.
        // A redundant second load here was the source of the "connection issue on open" bug.
        // Scroll so the toggle button sits just below the notch (~80px from top)
        requestAnimationFrame(() => {
          const _toggle = document.getElementById('journalToggleSection');
          if (_toggle) {
            const _top = _toggle.getBoundingClientRect().top + window.scrollY - 80;
            window.scrollTo({ top: Math.max(0, _top), behavior: 'smooth' });
          }
        });
      } else {
        journalCard.style.display = 'none';
        toggleBtn.innerHTML = BB.t('journal.btn.openJournal');
        // Advance step 2→3 when user closes journal (close journal hint fulfilled)
        _advanceOnboardingStep(3);
        // Scroll back to top of page smoothly
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    // Medication List Management
    async function showMedicationList() {
      // Fetch latest from Firestore so cross-page changes show immediately
      if (currentUser && db) {
        try {
          const doc = await db.collection('userSettings').doc(currentUser.uid).get();
          if (doc.exists && doc.data().currentMedList !== undefined) {
            localStorage.setItem('currentMedList', JSON.stringify(doc.data().currentMedList));
          }
        } catch(e) {}
      }
      loadMedicationList();
      document.getElementById('medicationModal').classList.add('active');
    }

    function closeMedicationModal() {
      document.getElementById('medicationModal').classList.remove('active');
      document.getElementById('newMedName').value = '';
      document.getElementById('newMedDose').value = '';
      // Rebuild focus mode steps in case meds were added/removed so medication step & display updates immediately
      if (typeof _fmActive !== 'undefined' && _fmActive) {
        const _prevId = _fmSteps[_fmStepIndex] ? _fmSteps[_fmStepIndex].id : null;
        _fmSteps = _buildFocusedSteps();
        const _ni = _prevId ? _fmSteps.findIndex(s => s.id === _prevId) : -1;
        _fmStepIndex = _ni >= 0 ? _ni : Math.min(_fmStepIndex, _fmSteps.length - 1);
        _renderFocusedStep();
      }
    }

    function loadMedicationList() {
      _updateMedBtn();
      const medications = JSON.parse(localStorage.getItem('currentMedList') || '[]');
      const listContainer = document.getElementById('medicationList');

      if (medications.length === 0) {
        listContainer.innerHTML = '<div style="text-align: center; color: #6c757d; padding: 20px;">' + BB.t('journal.ui.noMedsYet') + '</div>';
        return;
      }

      listContainer.innerHTML = medications.map((med, index) => `
        <div class="medication-item">
          <div class="medication-info">
            <div class="medication-name">${med.name}</div>
            <div class="medication-dose">${med.dosage || ''}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="medication-edit" data-med-index="${index}" title="${BB.t('journal.ui.editTitle')}" style="background:none;border:none;font-size:1.1em;cursor:pointer;padding:4px;">✏️</button>
            <button class="medication-delete" data-med-index="${index}" style="font-size:1.1em;">×</button>
          </div>
        </div>
      `).join('');

      // Use a single delegated listener on the container rather than per-button listeners,
      // which would accumulate on every loadMedicationList() call and fire multiple times.
      listContainer.onclick = (e) => {
        const editBtn = e.target.closest('.medication-edit');
        const delBtn  = e.target.closest('.medication-delete');
        if (editBtn) { e.preventDefault(); e.stopPropagation(); editMedication(parseInt(editBtn.dataset.medIndex)); }
        if (delBtn)  { e.preventDefault(); e.stopPropagation(); deleteMedication(parseInt(delBtn.dataset.medIndex)); }
      };
    }

    function _updateMedBtn() {
      const meds = JSON.parse(localStorage.getItem('currentMedList') || '[]');
      const btn = document.getElementById('medLabelBtn');
      if (!btn) return;
      btn.textContent = meds.length > 0 ? `💊 My Meds | ${meds.length}x` : '💊 My Meds';
    }

    function syncMedListToFirestore(list) {
      if (currentUser && db) {
        db.collection('userSettings').doc(currentUser.uid).set(
          { currentMedList: list }, { merge: true }
        ).catch(() => {});
      }
    }

    // Compute consecutive stable days from the most recent entry backwards
    // and persist to userSettings so the Anonymous board can read it.
    function _syncStableStreak(entries) {
      if (!currentUser || !db || !entries.length) return;

      // Build date → mood map (normalise date to YYYY-MM-DD)
      const moodByDate = {};
      entries.forEach(e => {
        if (!e.date || e.mood == null || e.mood === '') return;
        const key = String(e.date).slice(0, 10); // handles both "2026-05-04" and timestamp strings
        moodByDate[key] = e.mood;
      });

      // Walk back from the most recent entry date
      const sorted = [...entries]
        .filter(e => e.date)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      if (!sorted.length) return;

      let streak = 0;
      let startDate = null;
      const cur = new Date(sorted[0].date);
      cur.setHours(0, 0, 0, 0);

      while (true) {
        const key = cur.toISOString().slice(0, 10);
        const mood = moodByDate[key];
        // Numeric spectrum moods in the stable band (4–6) count too, via _moodCat.
        if (mood == null || mood === '' || _moodCat(mood) !== 'stable') break;
        streak++;
        startDate = key;
        cur.setDate(cur.getDate() - 1);
      }

      // Fire-and-forget write — only update if value changed to avoid unnecessary writes
      db.collection('userSettings').doc(currentUser.uid)
        .set({ stableStreak: streak, stableStreakStart: startDate }, { merge: true })
        .catch(e => console.warn('[BB] stableStreak sync failed', e));
    }

    function addMedication() {
      const name = document.getElementById('newMedName').value.trim();
      const dosage = document.getElementById('newMedDose').value.trim();

      if (!name) { alert(BB.t('journal.dlg.enterMedName')); return; }
      if (!dosage) { alert(BB.t('journal.dlg.enterDosage')); return; }

      const medications = JSON.parse(localStorage.getItem('currentMedList') || '[]');
      medications.push({ name, dosage });
      localStorage.setItem('currentMedList', JSON.stringify(medications));
      syncMedListToFirestore(medications);

      document.getElementById('newMedName').value = '';
      document.getElementById('newMedDose').value = '';
      loadMedicationList();
    }

    function deleteMedication(index) {
      if (!confirm(BB.t('journal.dlg.removeMed'))) return;

      const medications = JSON.parse(localStorage.getItem('currentMedList') || '[]');
      medications.splice(index, 1);
      localStorage.setItem('currentMedList', JSON.stringify(medications));
      syncMedListToFirestore(medications);
      loadMedicationList();
    }

    // ── Edit Entry ──
    let editingEntry = null;

    function openEditModal(entry) {
      editingEntry = entry;
      const date = new Date(entry.date);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth()+1).padStart(2,'0');
      const dd = String(date.getDate()).padStart(2,'0');
      document.getElementById('editEntryDate').value = `${yyyy}-${mm}-${dd}`;
      // Mood: use the 0–10 spectrum editor when this entry (or the current mode) is numeric.
      const _editSel = document.getElementById('editEntryMood');
      const _editSpecWrap = document.getElementById('editEntryMoodSpectrumWrap');
      const _useSpectrumEdit = _isNumericMood(entry.mood) || _spectrumEnabled();
      if (_useSpectrumEdit) {
        if (_editSel) _editSel.style.display = 'none';
        if (_editSpecWrap) _editSpecWrap.style.display = '';
        const _num = _isNumericMood(entry.mood) ? Math.round(Number(entry.mood)) : 5;
        const _numEl = document.getElementById('editEntryMoodNum');
        if (_numEl) _numEl.value = String(_num);
        _onEditSpectrumInput(_num);
      } else {
        if (_editSel) { _editSel.style.display = ''; _editSel.value = entry.mood; }
        if (_editSpecWrap) _editSpecWrap.style.display = 'none';
      }
      document.getElementById('editEntryEnergy').value = entry.energy;
      document.getElementById('editEntrySleep').value = entry.sleep != null ? entry.sleep : '';
      document.getElementById('editEntryMedication').value = entry.medication || 'taken';
      document.getElementById('editEntryNotes').value = entry.notes || '';
      document.getElementById('editEntryAnxiety').value = entry.anxiety || '';
      document.getElementById('editEntryIrritability').value = entry.irritability || '';
      document.getElementById('editEntryStress').value = entry.stress || '';
      document.getElementById('editEntryAlcohol').value = entry.alcohol || '';
      document.getElementById('editEntrySmoking').value = entry.smoking || '';
      document.getElementById('editEntryDrugs').value = entry.drugs || '';
      document.getElementById('editEntryExercise').value = entry.exercise || '';
      document.getElementById('editEntryOutside').value = entry.outside || '';
      // Force-show optional groups that have saved data, even if tracking is currently disabled
      [
        { id: 'editExerciseGroup',     hasData: !!entry.exercise },
        { id: 'editOutsideGroup',      hasData: !!entry.outside },
        { id: 'editAnxietyGroup',      hasData: !!entry.anxiety },
        { id: 'editIrritabilityGroup', hasData: !!entry.irritability },
        { id: 'editStressGroup',       hasData: !!entry.stress },
        { id: 'editAlcoholGroup',      hasData: !!entry.alcohol },
        { id: 'editSmokingGroup',      hasData: !!entry.smoking },
        { id: 'editDrugsGroup',        hasData: !!entry.drugs },
      ].forEach(({ id, hasData }) => {
        if (hasData) {
          const el = document.getElementById(id);
          if (el && el.style.display === 'none') el.style.display = '';
        }
      });
      document.getElementById('editEntryModal').classList.add('active');
    }

    function closeEditModal() {
      document.getElementById('editEntryModal').classList.remove('active');
      editingEntry = null;
      _editFieldOverrides = null;
    }

    function openEditInForm(entry) {
      if (typeof _fmEnabled !== 'undefined' && _fmEnabled) {
        _openEditInFocusedMode(entry);
        return;
      }
      if (typeof _fmActive !== 'undefined' && _fmActive) {
        _fmActive = false;
        document.getElementById('focusedModeCard').style.display = 'none';
        document.getElementById('entryFormCard').style.display = '';
      }
      editingEntry = entry;
      _captureEditState(entry);

      // Build edit-mode overrides: show a field if globally enabled OR if this entry has data for it.
      // _editFieldOverrides stays set until save/cancel so the ⊕ picker reflects entry's fields.
      _editFieldOverrides = {};
      const _entryHasData = {
        trackGoals:        !!entry.goals,
        trackBudget:       !!entry.budget,
        trackExercise:     !!entry.exercise,
        trackOutside:      !!entry.outside,
        trackAnxiety:      !!entry.anxiety,
        trackStress:       !!entry.stress,
        trackIrritability: !!entry.irritability,
        trackAlcohol:      !!entry.alcohol,
        trackSmoking:      !!entry.smoking,
        trackDrugs:        !!entry.drugs,
      };
      FIELD_PICKER_FIELDS.forEach(f => {
        const globalOn = localStorage.getItem(f.key) === 'true' ||
          (f.legacy && localStorage.getItem(f.key) === null && localStorage.getItem(f.legacy) === 'true');
        _editFieldOverrides[f.key] = globalOn || (_entryHasData[f.key] || false);
      });
      getCustomFields().forEach(f => {
        const cKey = `trackCustom_${f.id}`;
        _editFieldOverrides[cKey] = localStorage.getItem(cKey) === 'true' ||
          !!(entry.customFields && entry.customFields[f.id]);
      });
      applyTrackingPrefs();

      // Close "Your Journey" if open
      const journalCard = document.getElementById('journalCard');
      const journalToggleBtn = document.getElementById('journalToggleBtn');
      if (journalCard && journalCard.style.display !== 'none') {
        journalCard.style.display = 'none';
        if (journalToggleBtn) journalToggleBtn.innerHTML = BB.t('journal.btn.openJournal');
      }

      // Always ensure the form is visible when editing (today-complete banner may be hiding it)
      document.getElementById('entryFormCard').style.display = '';
      showDatePickerForEdit();
      document.getElementById('todayCompleteSection').style.display = 'none';
      const placeholder = document.getElementById('entryLoadingPlaceholder');
      if (placeholder) placeholder.style.display = 'none';

      // Set date
      const date = new Date(entry.date);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth()+1).padStart(2,'0');
      const dd = String(date.getDate()).padStart(2,'0');
      document.getElementById('entryDate').value = `${yyyy}-${mm}-${dd}`;
      updateFormHeading();

      // For old entries (before yesterday) sleep/steps can't be imported — show plain label, not button
      const _yesterday = new Date(); _yesterday.setHours(0,0,0,0); _yesterday.setDate(_yesterday.getDate() - 1);
      const _entryDay = new Date(yyyy, date.getMonth(), date.getDate());
      const _isOldEntry = _entryDay < _yesterday;
      const _hasSteps = entry.steps != null;
      const _sleepLbl = document.getElementById('sleepLabel');
      const _sleepBtnRowEl = document.getElementById('sleepBtnRow');
      if (_isOldEntry) {
        if (_sleepLbl) {
          _sleepLbl.style.display = '';
          _sleepLbl.textContent = entry.sleep != null ? `😴 Sleep | ${entry.sleep}h` : '😴 Sleep Hours';
        }
        if (_sleepBtnRowEl) _sleepBtnRowEl.style.display = 'none';
      } else {
        if (_sleepLbl) _sleepLbl.style.display = 'none';
        if (_sleepBtnRowEl) _sleepBtnRowEl.style.display = '';
        // Update sleep button text if sleep data exists
        const _sleepBtn = document.getElementById('healthSleepBtn');
        if (_sleepBtn && entry.sleep != null) _sleepBtn.textContent = `😴 Sleep | ${entry.sleep}h`;
      }

      // Show steps inside energy button when editing an entry that has step data
      const _ebt = document.getElementById('healthEnergyBtnText');
      if (_ebt) {
        if (_hasSteps) {
          const s = entry.steps;
          const stepsLabel = s >= 1000 ? Math.round(s / 1000) + 'k' : s;
          _ebt.textContent = `⚡ Energy | 🏃 ${stepsLabel}`;
        } else {
          _ebt.textContent = '⚡ Energy';
        }
      }

      // Select mood and reveal form sections
      selectedMood = entry.mood;
      selectedLinkedMood = entry.linkedMood || null;
      if (typeof _fmApplyMoodTheme === 'function') _fmApplyMoodTheme(_moodCat(entry.mood));
      if (_isNumericMood(entry.mood)) {
        // Numeric (spectrum) mood — show the slider set to the entry's value.
        const _btns = document.querySelector('.mood-selector');
        const _wheel = document.getElementById('moodSpectrumControl');
        if (_btns) _btns.style.display = 'none';
        if (_wheel) _wheel.style.display = '';
        _setSpectrumValue(Number(entry.mood));
      } else {
        const _btns = document.querySelector('.mood-selector');
        const _wheel = document.getElementById('moodSpectrumControl');
        if (_btns) _btns.style.display = '';
        if (_wheel) _wheel.style.display = 'none';
        document.querySelectorAll('.mood-btn').forEach(b => {
          b.classList.toggle('selected', b.dataset.mood === entry.mood);
        });
      }
      document.querySelectorAll('.hidden-until-mood').forEach(el => {
        el.classList.remove('hidden-until-mood');
        el.classList.add('show-after-mood');
      });

      // Select energy
      selectedEnergy = entry.energy;
      document.querySelectorAll('.energy-btn').forEach(b => {
        const sel = parseFloat(b.dataset.energy) === entry.energy;
        b.classList.toggle('selected', sel);
        b.style.background = sel ? b.dataset.color : '#f8f9fa';
        b.style.color = sel ? 'white' : '#495057';
      });

      // Select sleep
      selectedSleep = entry.sleep;
      _sleepHealthSynced = !!entry.sleepSynced;
      selectedSleepQuality = entry.sleepQuality || null;
      if (typeof _applySleepQualityBtns === 'function') _applySleepQualityBtns();
      const _editSqEl = document.getElementById('sleepQualitySubSection');
      if (_editSqEl) _editSqEl.style.display = selectedSleepQuality ? '' : 'none';
      document.querySelectorAll('.sleep-btn').forEach(b => {
        const sel = parseFloat(b.dataset.sleep) === entry.sleep;
        b.classList.toggle('selected', sel);
        b.style.background = sel ? b.dataset.color : '#f8f9fa';
        b.style.color = sel ? 'white' : '#495057';
      });

      // Select medication
      selectedMedication = entry.medication || null;
      document.querySelectorAll('[data-medication]').forEach(b => {
        b.classList.toggle('selected', b.dataset.medication === entry.medication);
      });

      // Select goals (map legacy 'not-100' to 'none')
      const goalsVal = entry.goals === 'not-100' ? 'none' : (entry.goals || null);
      selectedGoals = goalsVal;
      document.querySelectorAll('[data-goals]').forEach(b => {
        b.classList.toggle('selected', b.dataset.goals === goalsVal);
      });

      // Notes
      document.getElementById('notes').value = entry.notes || '';
      selectedStepNotes = {};
      const _rawInt = entry.intention || '';
      const _intParts = _rawInt.split(/\n?_{3,}\n/);
      selectedIntention = _intParts[0].trim();
      if (_intParts[1] && localStorage.getItem('elaborateResponsesEnabled') === 'true') {
        const _labelToId2 = Object.fromEntries(Object.entries(_STEP_NOTE_LABELS).map(([k,v]) => [v, k]));
        getCustomFields().forEach(f => { _labelToId2[`${f.emoji||''} ${f.label}`.trim()] = f.id; });
        _intParts[1].split('\n').forEach(line => {
          const _m = line.match(/^([^:]+):\s*([\s\S]+)$/);
          if (!_m) return;
          const _id2 = _labelToId2[_m[1].trim()];
          if (_id2) selectedStepNotes[_id2] = _m[2].trim();
        });
      }

      // Alcohol / exercise / anxiety / irritability / stress
      selectedAlcohol = entry.alcohol || null;
      selectedExercise = entry.exercise || null;
      selectedAnxiety = entry.anxiety || null;
      selectedIrritability = entry.irritability || null;
      selectedStress = entry.stress || null;
      selectedOutside = entry.outside || null;
      selectedSmoking = entry.smoking || null;
      selectedDrugs = entry.drugs || null;
      selectedCustom = entry.customFields ? { ...entry.customFields } : {};
      setPdfHide(!!entry.pdfHidden);
      selectedFavourite = !!entry.favourite;
      _updateFavouriteBtn();
      selectedBudget = entry.budget || null;
      document.querySelectorAll('[data-budget]').forEach(b => {
        b.classList.toggle('selected', b.dataset.budget === entry.budget);
      });
      renderCustomTrackingRows();
      document.querySelectorAll('[data-alcohol]').forEach(b => {
        b.classList.toggle('selected', b.dataset.alcohol === entry.alcohol);
      });
      document.querySelectorAll('[data-exercise]').forEach(b => {
        b.classList.toggle('selected', b.dataset.exercise === entry.exercise);
      });
      document.querySelectorAll('[data-anxiety]').forEach(b => {
        b.classList.toggle('selected', b.dataset.anxiety === entry.anxiety);
      });
      document.querySelectorAll('[data-irritability]').forEach(b => {
        b.classList.toggle('selected', b.dataset.irritability === entry.irritability);
      });
      document.querySelectorAll('[data-stress]').forEach(b => {
        b.classList.toggle('selected', b.dataset.stress === entry.stress);
      });
      document.querySelectorAll('[data-outside]').forEach(b => {
        b.classList.toggle('selected', b.dataset.outside === entry.outside);
      });
      document.querySelectorAll('[data-smoking]').forEach(b => {
        b.classList.toggle('selected', b.dataset.smoking === entry.smoking);
      });
      document.querySelectorAll('[data-drugs]').forEach(b => {
        b.classList.toggle('selected', b.dataset.drugs === entry.drugs);
      });
      // Force-show optional rows that have saved data, even if tracking is currently disabled
      [
        { id: 'goalsTrackRow',          hasData: !!entry.goals },
        { id: 'budgetTrackRow',         hasData: !!entry.budget },
        { id: 'exerciseTrackRow',       hasData: !!entry.exercise },
        { id: 'outsideTrackRow',        hasData: !!entry.outside },
        { id: 'emotionAnxietyRow',      hasData: !!entry.anxiety },
        { id: 'emotionStressRow',       hasData: !!entry.stress },
        { id: 'emotionIrritabilityRow', hasData: !!entry.irritability },
        { id: 'alcoholTrackRow',        hasData: !!entry.alcohol },
        { id: 'smokingTrackRow',        hasData: !!entry.smoking },
        { id: 'drugsTrackRow',          hasData: !!entry.drugs },
      ].forEach(({ id, hasData }) => {
        if (hasData) {
          const el = document.getElementById(id);
          if (el && el.style.display === 'none') el.style.display = 'contents';
        }
      });

      // Open moreDataSection if default is on OR entry has data in any more-data field
      const _editMoreDefault = localStorage.getItem('moreDataOpenByDefault') === 'true';
      const _editHasMore = !!(entry.goals || entry.anxiety || entry.stress || entry.irritability ||
        entry.alcohol || entry.smoking || entry.drugs || entry.exercise || entry.outside ||
        entry.budget || (entry.customFields && Object.keys(entry.customFields).length > 0));
      const _editShowMore = _editMoreDefault || _editHasMore;
      const _editMds = document.getElementById('moreDataSection');
      const _editMdt = document.getElementById('moreDataToggle');
      if (_editMds) _editMds.style.display = _editShowMore ? 'block' : 'none';
      if (_editMdt) _editMdt.textContent = _editShowMore ? BB.t('journal.lessData') : BB.t('journal.moreData');

      // Update submit button label and show delete/back buttons
      // Start as 'Close' (grey) — no changes yet; updates to 'Update entry' as user edits
      _updateEditBtn();
      const _editDelBtn = document.getElementById('editDeleteBtn');
      if (_editDelBtn) _editDelBtn.style.display = '';
      const _draftClearBtn2 = document.getElementById('draftClearBtn');
      if (_draftClearBtn2) _draftClearBtn2.style.display = 'none';
      const _editCancelBtn = document.getElementById('editCancelBtn');
      if (_editCancelBtn) _editCancelBtn.style.display = '';

      // Scroll to logo and animate date picker
      document.getElementById('appLogo').scrollIntoView({ behavior: 'smooth', block: 'start' });
      const dateInput = document.getElementById('entryDate');
      setTimeout(() => {
        dateInput.classList.add('date-edit-highlight');
        dateInput.addEventListener('animationend', () => {
          dateInput.classList.remove('date-edit-highlight');
        }, { once: true });
      }, 400);
    }

    async function saveEditedEntry() {
      if (!editingEntry) return;
      const dateVal = document.getElementById('editEntryDate').value;
      const newDate = dateVal ? new Date(dateVal + 'T12:00:00') : new Date(editingEntry.date);
      const updated = {
        ...editingEntry,
        date: newDate.toISOString(),
        timestamp: newDate.getTime(),
        mood: (document.getElementById('editEntryMoodSpectrumWrap') && document.getElementById('editEntryMoodSpectrumWrap').style.display !== 'none')
          ? Number(document.getElementById('editEntryMoodNum').value)
          : document.getElementById('editEntryMood').value,
        energy: parseFloat(document.getElementById('editEntryEnergy').value),
        sleep: (() => { const _v = parseFloat(document.getElementById('editEntrySleep').value); return isNaN(_v) ? null : _v; })(),
        medication: document.getElementById('editEntryMedication').value,
        notes: document.getElementById('editEntryNotes').value,
        anxiety: document.getElementById('editEntryAnxiety').value || null,
        irritability: document.getElementById('editEntryIrritability').value || null,
        stress: document.getElementById('editEntryStress').value || null,
        alcohol: document.getElementById('editEntryAlcohol').value || null,
        smoking: document.getElementById('editEntrySmoking').value || null,
        drugs: document.getElementById('editEntryDrugs').value || null,
        exercise: document.getElementById('editEntryExercise').value || null,
        outside: document.getElementById('editEntryOutside').value || null,
      };
      try {
        if (currentUser && db) {
          await db.collection('entries').doc(editingEntry.id).set(updated);
        } else {
          const key = editingEntry.id || `entry:${editingEntry.timestamp}`;
          localStorage.setItem(key, JSON.stringify(updated));
        }
        closeEditModal();
        loadEntries();
      } catch(e) {
        alert(BB.t('journal.dlg.saveChangesFail') + e.message);
      }
    }

    // ── Daily Goals Management ──
    let selectedGoals = null;

    async function showGoalsList() {
      if (currentUser && db) {
        try {
          const doc = await db.collection('userSettings').doc(currentUser.uid).get();
          if (doc.exists && doc.data().dailyGoals !== undefined) {
            localStorage.setItem('dailyGoals', JSON.stringify(doc.data().dailyGoals));
          }
        } catch(e) {}
      }
      loadGoalsList();
      document.getElementById('goalsModal').classList.add('active');
    }

    function closeGoalsModal() {
      document.getElementById('goalsModal').classList.remove('active');
    }

    function loadGoalsList() {
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      const container = document.getElementById('goalsList');
      if (goals.length === 0) {
        container.innerHTML = '<p style="color:#6c757d; text-align:center; font-style:italic;">' + BB.t('journal.ui.noGoalsYet') + '</p>';
        return;
      }
      container.innerHTML = goals.map((g, i) => `
        <div style="display:flex; align-items:center; gap:10px; padding:10px; background:#f8f9fa; border-radius:8px; margin-bottom:8px;">
          <span style="flex:1; font-weight:600;">&#127919; ${g}</span>
          <button onclick="editGoal(${i})" style="background:none; border:none; cursor:pointer; font-size:1.1em;">&#9999;&#65039;</button>
          <button onclick="deleteGoal(${i})" style="background:none; border:none; cursor:pointer; font-size:1.1em; color:#ff6b6b;">&#10005;</button>
        </div>
      `).join('');
    }

    function syncGoalsToFirestore(goals) {
      if (!db || !currentUser) return;
      db.collection('userSettings').doc(currentUser.uid).set(
        { dailyGoals: goals }, { merge: true }
      ).catch(() => {});
    }

    function _fmRefreshIfMoreData() {
      if (typeof _fmActive !== 'undefined' && _fmActive) _renderFocusedStep();
    }

    function _refreshGoalsDetail() {
      const el = document.getElementById('goalsDetail');
      if (!el) return;
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      if (goals.length === 0) {
        el.innerHTML = `<button onclick="showGoalsList()" style="padding:7px 16px;background:rgba(255,149,0,0.08);border:2px solid rgba(255,149,0,0.35);border-radius:10px;color:var(--brand-primary);font-weight:600;font-size:0.85em;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('journal.btn.setDailyGoals')}</button>`;
      } else {
        const chips = goals.map(g => `<span style="display:inline-block;background:rgba(255,149,0,0.12);border-radius:6px;padding:2px 7px;margin:2px;font-size:0.8em;color:#495057;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${g}</span>`).join('');
        el.innerHTML = `<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:8px 12px;background:var(--brand-tint);border-radius:10px;border:1.5px solid rgba(255,149,0,0.3);gap:8px;"><div style="flex:1;min-width:0;flex-wrap:wrap;display:flex;align-items:center;">${chips}</div><button onclick="showGoalsList()" style="padding:3px 10px;background:var(--brand-btn);color:white;border:none;border-radius:7px;font-size:0.78em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;flex-shrink:0;">Edit</button></div>`;
      }
    }

    function _toggleGoalsDetail() {
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      const el = document.getElementById('goalsDetail');
      if (!el) return;
      if (goals.length === 0) { showGoalsList(); return; }
      const showing = el.style.display !== 'none';
      _refreshGoalsDetail();
      el.style.display = showing ? 'none' : '';
    }

    function _refreshBudgetDetail() {
      const el = document.getElementById('budgetDetail');
      if (!el) return;
      const val = localStorage.getItem('dailyBudget') || '';
      if (!val) {
        el.innerHTML = `<button onclick="showBudgetModal()" style="padding:7px 16px;background:rgba(255,149,0,0.08);border:2px solid rgba(255,149,0,0.35);border-radius:10px;color:var(--brand-primary);font-weight:600;font-size:0.85em;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('journal.btn.setDailyBudget')}</button>`;
      } else {
        el.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--brand-tint);border-radius:10px;border:1.5px solid rgba(255,149,0,0.3);"><span style="font-size:0.9em;color:#495057;">💰 Daily budget: <b>${val}</b></span><button onclick="showBudgetModal()" style="padding:3px 10px;background:var(--brand-btn);color:white;border:none;border-radius:7px;font-size:0.78em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">${BB.t('common.change')}</button></div>`;
      }
    }

    function _toggleBudgetDetail() {
      const val = localStorage.getItem('dailyBudget') || '';
      const el = document.getElementById('budgetDetail');
      if (!el) return;
      if (!val) { showBudgetModal(); return; }
      const showing = el.style.display !== 'none';
      _refreshBudgetDetail();
      el.style.display = showing ? 'none' : '';
    }

    function addGoal() {
      const input = document.getElementById('newGoalText');
      const text = input.value.trim();
      if (!text) return;
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      goals.push(text);
      localStorage.setItem('dailyGoals', JSON.stringify(goals));
      syncGoalsToFirestore(goals);
      input.value = '';
      loadGoalsList();
      _fmRefreshIfMoreData();
      _refreshGoalsDetail();
      const _gd = document.getElementById('fmGoalsDetail'); if (_gd) _gd.style.display = '';
    }

    function deleteGoal(index) {
      if (!confirm(BB.t('journal.dlg.removeGoal'))) return;
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      goals.splice(index, 1);
      localStorage.setItem('dailyGoals', JSON.stringify(goals));
      syncGoalsToFirestore(goals);
      loadGoalsList();
      _fmRefreshIfMoreData();
      _refreshGoalsDetail();
    }

    function editGoal(index) {
      const goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]');
      const newText = prompt(BB.t('journal.dlg.editGoal'), goals[index]);
      if (newText === null || newText.trim() === '') return;
      goals[index] = newText.trim();
      localStorage.setItem('dailyGoals', JSON.stringify(goals));
      syncGoalsToFirestore(goals);
      loadGoalsList();
      _fmRefreshIfMoreData();
      _refreshGoalsDetail();
    }

    // Wire up goals status buttons
    document.querySelectorAll('[data-goals]').forEach(btn => {
      btn.addEventListener('click', () => {
        const already = btn.classList.contains('selected');
        document.querySelectorAll('[data-goals]').forEach(b => b.classList.remove('selected'));
        if (!already) {
          btn.classList.add('selected');
          selectedGoals = btn.dataset.goals;
        } else {
          selectedGoals = null;
        }
      });
    });

    // ── Daily Budget Management ──
    let selectedBudget = null;

    function _updateBudgetLabel() { /* label is static; value shown in modal */ }

    function showBudgetModal() {
      const val = localStorage.getItem('dailyBudget') || '';
      const input = document.getElementById('budgetInput');
      if (input) input.value = val;
      document.getElementById('budgetModal').classList.add('active');
      setTimeout(() => { if (input) input.focus(); }, 100);
    }

    function closeBudgetModal() {
      document.getElementById('budgetModal').classList.remove('active');
    }

    function saveBudgetSetting() {
      const val = (document.getElementById('budgetInput').value || '').trim();
      if (val) localStorage.setItem('dailyBudget', val);
      else localStorage.removeItem('dailyBudget');
      _syncBudgetToFirestore(val);
      _updateBudgetLabel();
      _refreshBudgetDetail();
      closeBudgetModal();
      if (typeof _fmActive !== 'undefined' && _fmActive) {
        _renderFocusedStep();
        const _bd = document.getElementById('fmBudgetDetail'); if (_bd) _bd.style.display = '';
      }
    }

    function _syncBudgetToFirestore(value) {
      if (!db || !currentUser) return;
      db.collection('userSettings').doc(currentUser.uid).set(
        { dailyBudget: value || '' }, { merge: true }
      ).catch(() => {});
    }

    // Wire up budget buttons
    document.querySelectorAll('[data-budget]').forEach(btn => {
      btn.addEventListener('click', () => {
        const already = btn.classList.contains('selected');
        document.querySelectorAll('[data-budget]').forEach(b => b.classList.remove('selected'));
        if (!already) {
          btn.classList.add('selected');
          selectedBudget = btn.dataset.budget;
        } else {
          selectedBudget = null;
        }
        scheduleDraftSave();
      });
    });

    window.showBudgetModal = showBudgetModal;
    window.closeBudgetModal = closeBudgetModal;
    window.saveBudgetSetting = saveBudgetSetting;


    function editMedication(index) {
      const medications = JSON.parse(localStorage.getItem('currentMedList') || '[]');
      const med = medications[index];
      if (!med) return;

      document.getElementById('newMedName').value = med.name;
      document.getElementById('newMedDose').value = med.dosage || '';

      // Change Add button to Save
      const addBtn = document.querySelector('#medicationModal .confirm-btn');
      const originalHTML = addBtn.innerHTML;
      addBtn.innerHTML = 'Save Changes';
      addBtn.onclick = () => {
        const name = document.getElementById('newMedName').value.trim();
        const dosage = document.getElementById('newMedDose').value.trim();
        if (!name || !dosage) { alert(BB.t('journal.dlg.fillBothFields')); return; }
        medications[index] = { ...med, name, dosage };
        localStorage.setItem('currentMedList', JSON.stringify(medications));
        syncMedListToFirestore(medications);
        addBtn.innerHTML = originalHTML;
        addBtn.onclick = addMedication;
        document.getElementById('newMedName').value = '';
        document.getElementById('newMedDose').value = '';
        loadMedicationList();
      };
    }

    async function showMissingDates() {
      try {
        // Use the already-loaded entries (same data source as the stats pill that labels the button).
        // This guarantees the modal result is always consistent with the "X missing entries" count.
        const entries = (_allEntries && _allEntries.length > 0) ? _allEntries : [];

        if (entries.length === 0) {
          alert(BB.t('journal.dlg.noEntriesYet'));
          return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const useToday = localStorage.getItem('journalDefaultToday') === 'true';

        // Mirror the stats-pill window exactly: exclude the current target day (user may be about to log it).
        const missingCutoff = new Date(today);
        if (!useToday) missingCutoff.setDate(missingCutoff.getDate() - 1); // yesterday

        // Go back 30 days from today
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 29);
        thirtyDaysAgo.setHours(0, 0, 0, 0);

        // Find the first entry date
        const sortedEntries = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        const firstEntryDate = new Date(sortedEntries[0].date);
        firstEntryDate.setHours(0, 0, 0, 0);

        // Start counting from whichever is more recent: 30 days ago OR first entry
        const startDate = firstEntryDate > thirtyDaysAgo ? firstEntryDate : thirtyDaysAgo;

        // Create a set of dates that have entries (within the window)
        const entryDates = new Set();
        entries.forEach(entry => {
          const date = new Date(entry.date);
          date.setHours(0, 0, 0, 0);
          if (date >= startDate && date < missingCutoff) {
            const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            entryDates.add(dateKey);
          }
        });

        // Find missing dates from start date up to (but not including) the current target day
        const missingDates = [];
        let checkDate = new Date(startDate);

        while (checkDate < missingCutoff) {
          const dateKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;

          if (!entryDates.has(dateKey)) {
            missingDates.push(new Date(checkDate));
          }

          checkDate.setDate(checkDate.getDate() + 1);
        }

        // Hand the list to the auto-complete flow, and offer it only when
        // there are several days to fill — for a single day, tapping the date
        // is just as quick.
        _missingDatesCache = missingDates;
        const autoFillPromo = document.getElementById('autoFillPromo');
        if (autoFillPromo) autoFillPromo.style.display = missingDates.length >= 2 ? '' : 'none';

        // Display missing dates in modal
        const listContainer = document.getElementById('missingDatesList');
        
        if (missingDates.length === 0) {
          // #333, not #000: dark.css only lifts the near-black literals it
          // lists, and pure black left this line unreadable in dark mode.
          listContainer.innerHTML = '<div style="text-align: center; color: #333; padding: 20px; font-weight: 600;">' + BB.t('journal.ui.noMissing30') + '</div>';
        } else {
          const _lang = (window.BB && BB.i18n && BB.i18n.getLang && BB.i18n.getLang()) || 'en';
          const _locale = _lang === 'en' ? 'en-GB' : _lang === 'zh' ? 'zh-Hans' : _lang;
          listContainer.innerHTML = missingDates.map(date => {
            let dateStr;
            try { dateStr = date.toLocaleDateString(_locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
            catch (_) { dateStr = date.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }
            const isToday = date.toDateString() === today.toDateString();
            const style = isToday ? 'background: #fff3cd; border-left: 4px solid var(--brand-primary);' : '';
            const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            
            return `
              <div onclick="setDateAndClose('${dateValue}')" class="missing-date-item" style="padding: 10px; margin-bottom: 8px; background: #f8f9fa; border-radius: 8px; ${style} cursor: pointer;">
                ${isToday ? '🗓️ ' : ''}${dateStr}${isToday ? ' (' + BB.t('journal.ui.today') + ')' : ''} <span style="float: right; color: #999;">→</span>
              </div>
            `;
          }).join('');
        }

        document.getElementById('missingDatesModal').classList.add('active');
      } catch (error) {
        console.error('Error showing missing dates:', error);
        alert(BB.t('journal.dlg.loadMissingFail') + error.message);
      }
    }

    function closeMissingDatesModal() {
      document.getElementById('missingDatesModal').classList.remove('active');
    }

    // ────────────────────────────────────────────
    // AUTO-COMPLETE MISSING ENTRIES
    // ────────────────────────────────────────────
    /*
     * Fills every gap listed in the missing-entries modal in one pass, instead
     * of making the user open the form nine times. Two sources, in order:
     *
     *   1. Health (native only, and only when the health-sync toggle is on):
     *      one aggregated steps query and one aggregated sleep query across the
     *      whole gap. Aggregated sleep buckets a session under the day it
     *      STARTED, which matches the journal's own model — an entry for day D
     *      covers the night at the end of D (see _sleepNotYet()).
     *   2. The user's own recent entries: median energy / sleep and their most
     *      frequent mood, for the days Health knows nothing about — which on
     *      the web build is every day, since there is no Health there at all.
     *
     * Mood and energy are never read from Health directly; they are derived
     * from steps + sleep with the same rules behind focused mode's "best guess"
     * badge (_suggestMoodFromHealth / _energyFromSteps).
     *
     * Every entry written here carries autoFilled:true, which shows an AUTO
     * badge in the list, an "Auto-filled" note in the PDF export and a column
     * in the CSV. A guess must never be mistaken for something the user
     * actually reported — least of all in the PDF a clinician reads. Editing
     * an auto-filled entry and saving it clears the flag (see saveEntry).
     */
    let _autoFillPlan = null;    // [{ key, date, mood, energy, sleep, steps, source, include }]
    let _autoFillBusy = false;

    function _autoFillDateKey(d) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function _autoFillMedian(nums) {
      const arr = nums.filter(n => typeof n === 'number' && !isNaN(n)).sort((a, b) => a - b);
      if (!arr.length) return null;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    }

    /**
     * "What a typical day looks like for this user" — median energy and sleep
     * plus the most frequent mood over their 30 most recent entries. Used for
     * days Health has nothing for. Falls back to the form's own defaults when
     * there is nothing to average (shouldn't happen: the missing-dates modal
     * needs at least one entry to compute a gap at all).
     *
     * Deliberately a flat baseline, and NOT a function of the day being filled.
     * Weighting the nearest logged entry higher — so the day after a "low"
     * inherits it — was tried and reverted: it predicts mood swings. Estimating
     * the shape of an episode nobody recorded writes a story into the journal
     * that the user then reads back as their own history, and this app has no
     * business making that call. Every gap day getting the same unremarkable
     * baseline is the honest answer: it reads as "we don't know", which is true.
     * If you are here to make the estimates look less repetitive, don't.
     */
    function _autoFillTypicals() {
      const recent = (_allEntries || []).slice(0, 30);
      const energy = _autoFillMedian(recent.map(e => Number(e.energy)));
      const sleep  = _autoFillMedian(recent.map(e => Number(e.sleep)));
      const counts = {};
      recent.forEach(e => {
        const cat = _moodCat(e.mood);
        if (cat) counts[cat] = (counts[cat] || 0) + 1;
      });
      let mood = null, best = 0;
      Object.entries(counts).forEach(([cat, n]) => { if (n > best) { best = n; mood = cat; } });
      return {
        energy: energy == null ? 5   : Math.round(energy),
        sleep:  sleep  == null ? 7.5 : Math.round(sleep * 10) / 10,
        mood:   mood || 'stable'
      };
    }

    /**
     * Daily steps + sleep for the whole gap, in two aggregated queries.
     * Returns empty maps on the web build, when health sync is off, or when
     * access is refused — the caller then falls back to typical values.
     *
     * Units differ per metric and per call: aggregated steps come back as a
     * count, aggregated sleep as SECONDS. (queryLatestSample returns sleep in
     * MINUTES — see importSleepFromHealth. Don't mix the two up.)
     */
    async function _autoFillHealthData(dates) {
      const out = { steps: {}, sleep: {} };
      if (!isNative() || BB.storage.get('HealthSyncEnabled') !== '1') return out;

      const Health = getPlugin('HealthPlugin');
      if (!Health) return out;

      try {
        const { available } = await Health.isHealthAvailable();
        if (!available) return out;

        // Tapping "Auto-complete" is a deliberate action, so raising the OS
        // permission sheet here is fair game — unlike the silent auto-syncs,
        // which only ever check.
        try {
          const ck = await Health.checkHealthPermissions({ permissions: ['READ_STEPS', 'READ_SLEEP'] });
          if (!ck?.permissions?.READ_STEPS || !ck?.permissions?.READ_SLEEP) {
            skipNextResume = true;
            await Health.requestHealthPermissions({ permissions: ['READ_STEPS', 'READ_SLEEP'] });
            skipNextResume = false;
          }
        } catch (e) { skipNextResume = false; }

        const sorted = [...dates].sort((a, b) => a - b);
        const startDate = new Date(sorted[0]);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(sorted[sorted.length - 1]);
        endDate.setHours(24, 0, 0, 0); // start of the day after the last gap day

        try {
          const res = await Health.queryAggregated({
            dataType: 'steps',
            startDate: startDate.toISOString(),
            endDate:   endDate.toISOString(),
            bucket:    'day'
          });
          (res?.aggregatedData || []).forEach(sample => {
            const count = Math.round(sample.value);
            if (count > 0) out.steps[_autoFillDateKey(new Date(sample.startDate))] = count;
          });
        } catch (e) { BB.log('auto-complete: steps query failed', e); }

        try {
          const res = await Health.queryAggregated({
            dataType: 'sleep',
            startDate: startDate.toISOString(),
            endDate:   endDate.toISOString(),
            bucket:    'day'
          });
          (res?.aggregatedData || []).forEach(sample => {
            const hours = sample.value / 3600;
            // Ignore nonsense totals: a stray 20-minute sample isn't a night's
            // sleep, and >16h means overlapping sources we can't untangle.
            if (hours >= 1 && hours <= 16) {
              out.sleep[_autoFillDateKey(new Date(sample.startDate))] = Math.round(hours * 10) / 10;
            }
          });
        } catch (e) { BB.log('auto-complete: sleep query failed', e); }
      } catch (e) {
        BB.log('auto-complete: health unavailable', e);
      }
      return out;
    }

    async function showAutoFillModal() {
      const dates = (_missingDatesCache || []).slice();
      const modal = document.getElementById('autoFillModal');
      if (!modal || !dates.length) return;

      _autoFillPlan = null;
      _autoFillBusy = false;
      document.getElementById('autoFillIntro').style.display = '';
      document.getElementById('autoFillPreview').style.display = 'none';
      document.getElementById('autoFillFoot').style.display = 'none';
      document.getElementById('autoFillActions').style.display = 'none';
      document.getElementById('autoFillDoneActions').style.display = 'none';
      const statusEl = document.getElementById('autoFillStatus');
      statusEl.style.display = '';
      statusEl.textContent = BB.t('journal.autofill.reading');
      // One modal at a time: the Android back button closes whichever
      // .confirm-modal it finds first in the DOM, so stacking these two would
      // close the list underneath and leave this one floating.
      closeMissingDatesModal();
      modal.classList.add('active');

      const health  = await _autoFillHealthData(dates);
      const typical = _autoFillTypicals();

      _autoFillPlan = dates.map(d => {
        const key    = _autoFillDateKey(d);
        const steps  = health.steps[key] != null ? health.steps[key] : null;
        const sleepH = health.sleep[key] != null ? health.sleep[key] : null;
        return {
          key,
          date:   new Date(d),
          mood:   _suggestMoodFromHealth(steps, sleepH) || typical.mood,
          energy: steps  != null ? _energyFromSteps(steps) : typical.energy,
          sleep:  sleepH != null ? sleepH : typical.sleep,
          steps,
          source: (steps != null || sleepH != null) ? 'health' : 'typical',
          include: true
        };
      });
      _renderAutoFillPreview();
    }
    window.showAutoFillModal = showAutoFillModal;

    function _renderAutoFillPreview() {
      const listEl   = document.getElementById('autoFillPreview');
      const statusEl = document.getElementById('autoFillStatus');
      if (!listEl || !_autoFillPlan) return;

      statusEl.style.display = 'none';
      listEl.style.display = '';
      listEl.innerHTML = _autoFillPlan.map((p, i) => {
        // 'en-US', not the device locale: this list sits directly on top of the
        // missing-dates list, which formats its dates the same way, and the two
        // reading differently for the same day is worse than either format is.
        const dateStr = p.date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
        const source  = BB.t(p.source === 'health' ? 'journal.autofill.fromHealth' : 'journal.autofill.fromTypical');
        const bits = [
          `${_moodEmoji(p.mood)} ${_moodCatLabel(p.mood)}`,
          `🛌 ${p.sleep}h`,
          `⚡ ${p.energy}/10`
        ];
        if (p.steps != null) bits.push(`🏃 ${p.steps >= 1000 ? Math.round(p.steps / 1000) + 'k' : p.steps}`);
        return `
          <label style="display:flex; align-items:flex-start; gap:10px; padding:10px; margin-bottom:8px; background:#f8f9fa; border-radius:10px; cursor:pointer;">
            <input type="checkbox" ${p.include ? 'checked' : ''} onchange="toggleAutoFillDay(${i}, this.checked)" style="margin-top:3px; width:18px; height:18px; accent-color:var(--brand-primary); flex-shrink:0;">
            <span style="flex:1; min-width:0;">
              <span style="display:block; font-weight:600; color:#333;">${_esc(dateStr)}</span>
              <span style="display:block; color:#495057; font-size:0.88em;">${_esc(bits.join(' · '))}</span>
              <span style="display:block; color:#adb5bd; font-size:0.78em;">${_esc(source)}</span>
            </span>
          </label>`;
      }).join('');

      document.getElementById('autoFillFoot').style.display = '';
      document.getElementById('autoFillActions').style.display = '';
      _updateAutoFillBtn();
    }

    function toggleAutoFillDay(i, checked) {
      if (_autoFillPlan && _autoFillPlan[i]) _autoFillPlan[i].include = !!checked;
      _updateAutoFillBtn();
    }
    window.toggleAutoFillDay = toggleAutoFillDay;

    function _updateAutoFillBtn() {
      const btn = document.getElementById('autoFillConfirmBtn');
      if (!btn || !_autoFillPlan) return;
      const n = _autoFillPlan.filter(p => p.include).length;
      btn.disabled = n === 0 || _autoFillBusy;
      btn.style.opacity = btn.disabled ? '0.5' : '';
      btn.textContent = BB.t('journal.autofill.confirm', { count: n });
    }

    /** A plan row → a full entry object, shaped exactly like a saved one. */
    function _buildAutoFilledEntry(plan) {
      const date = new Date(plan.date);
      date.setHours(12, 0, 0, 0); // noon, matching saveEntry's date handling
      const now = new Date();
      const entry = {
        date: date.toISOString(),
        mood: plan.mood,
        linkedMood: null,
        energy: plan.energy,
        sleep: plan.sleep,
        sleepQuality: null,
        medication: null,
        goals: null,
        alcohol: null,
        exercise: null,
        anxiety: null,
        irritability: null,
        stress: null,
        outside: null,
        smoking: null,
        drugs: null,
        notes: '',
        intention: '',
        customFields: {},
        budget: null,
        pdfHidden: false,
        favourite: false,
        timestamp: date.getTime(),
        recordedAt: now.toISOString(),
        recordedTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        autoFilled: true,
        autoFilledSource: plan.source
      };
      if (plan.steps != null) entry.steps = plan.steps;
      return entry;
    }

    /**
     * Writes the entries the same way saveEntry does — encrypted per entry for
     * signed-in users (one Firestore batch, well inside the 500-write limit for
     * a 30-day window), encrypted localStorage for guests.
     */
    async function _autoFillPersist(entries) {
      if (currentUser && db) {
        if (!_userCryptoKey) _userCryptoKey = await _userImportKeyFromSession();
        const batch = db.batch();
        for (const entry of entries) {
          const withUid = { ...entry, userId: currentUser.uid };
          const ref = db.collection('entries').doc();
          if (_userCryptoKey) {
            const enc = await _userEncrypt(_userCryptoKey, withUid);
            batch.set(ref, { userId: currentUser.uid, timestamp: entry.timestamp, ...enc });
          } else {
            batch.set(ref, withUid);
          }
        }
        await batch.commit();
      } else {
        for (const entry of entries) {
          const payload = _guestCryptoKey ? await _guestEncrypt(_guestCryptoKey, entry) : entry;
          localStorage.setItem(`entry:${entry.timestamp}`, JSON.stringify(payload));
        }
      }
    }

    async function runAutoFill() {
      if (!_autoFillPlan || _autoFillBusy) return;
      const chosen = _autoFillPlan.filter(p => p.include);
      if (!chosen.length) return;

      // Guests must set a PIN before their first save — it derives the key that
      // encrypts localStorage entries. saveAndOpenJournal() gates on this too;
      // without it these entries would be written in the clear. The PIN overlay
      // sits above the modal, and its callback resumes the fill.
      if (!currentUser && (BB.storage.get('PinEnabled') !== '1' || !BB.storage.get('GuestPinSalt'))) {
        _showGuestPinSetup(() => { runAutoFill(); });
        return;
      }

      _autoFillBusy = true;
      _updateAutoFillBtn();
      const statusEl = document.getElementById('autoFillStatus');
      document.getElementById('autoFillPreview').style.display = 'none';
      document.getElementById('autoFillFoot').style.display = 'none';
      document.getElementById('autoFillActions').style.display = 'none';
      statusEl.style.display = '';
      statusEl.textContent = BB.t('journal.autofill.saving');

      try {
        await _autoFillPersist(chosen.map(_buildAutoFilledEntry));
        nativeHaptic('success');
        document.getElementById('autoFillIntro').style.display = 'none';
        statusEl.innerHTML =
          `<div style="font-size:1.8em; margin-bottom:8px;">✅</div>` +
          `<div style="font-weight:700; color:#333; margin-bottom:8px;">${_esc(BB.t('journal.autofill.doneTitle', { count: chosen.length }))}</div>` +
          `<div style="color:#6c757d; font-size:0.9em; line-height:1.5;">${_esc(BB.t('journal.autofill.doneBody'))}</div>`;
        document.getElementById('autoFillDoneActions').style.display = '';
        _autoFillPlan = null;
      } catch (error) {
        console.error('Auto-complete failed:', error);
        statusEl.textContent = BB.t('journal.autofill.fail');
        setTimeout(() => {
          if (!_autoFillPlan) return;
          _renderAutoFillPreview();
        }, 2500);
      } finally {
        _autoFillBusy = false;
        _updateAutoFillBtn();
      }
    }
    window.runAutoFill = runAutoFill;

    /** Cancel: back to the missing-dates list the user came from. */
    function closeAutoFillModal() {
      const modal = document.getElementById('autoFillModal');
      if (modal) modal.classList.remove('active');
      const list = document.getElementById('missingDatesModal');
      if (list) list.classList.add('active');
    }
    window.closeAutoFillModal = closeAutoFillModal;

    /** Close-out after a successful fill: drop both modals, reload the list. */
    function finishAutoFill() {
      const modal = document.getElementById('autoFillModal');
      if (modal) modal.classList.remove('active');
      closeMissingDatesModal();
      currentPage = 1;
      loadEntries();
    }
    window.finishAutoFill = finishAutoFill;

    function setDateAndClose(dateValue) {
      // Close the modal
      closeMissingDatesModal();

      // Prepare a new entry (not an edit) — same flow as startOtherDateEntry
      editingEntry = null;
      _editFieldOverrides = null;
      document.getElementById('todayCompleteSection').style.display = 'none';
      document.getElementById('entryFormCard').style.display = '';
      resetEntryForm();
      applyTrackingPrefs();
      showDatePickerForNew();
      // Override date to the selected missing date
      document.getElementById('entryDate').value = dateValue;
      updateFormHeading();
      const _now = new Date(); _now.setHours(0,0,0,0);
      const _todayKey = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
      const _btn = document.getElementById('submitBtn');
      if (_btn) _btn.textContent = (window.BB && BB.t) ? BB.t(dateValue === _todayKey ? 'journal.save.submitToday' : 'journal.save.submitOther') : (dateValue === _todayKey ? "Save Today's Entry ✨" : "Log Entry ✨");
      checkMissingEntry(document.getElementById('entryDate'));

      window.scrollTo({ top: 0, behavior: 'smooth' });
      const _fc = document.getElementById('entryFormCard');
      if (_fc) setTimeout(() => { const _r = _fc.getBoundingClientRect(); window.scrollTo({ top: Math.max(0, _r.top + window.scrollY - Math.max(16, (window.innerHeight - _r.height) / 2)), behavior: 'smooth' }); }, 80);

      // Open in focused mode if enabled
      _maybeFocusedModeAfterFormShown();
    }

    function onEntryDateChange(input) {
      // The filled values describe the day they were read for — once the date
      // moves they are the user's own again, not an auto-fill of this day.
      _fmDayFillSnapshot = null;
      _fmDayFillMsg = null;
      updateFormHeading();
      checkMissingEntry(input);
      _applySleepLock();
      // Update submit button label to reflect the chosen date (new entries only)
      if (!editingEntry) {
        const now = new Date(); now.setHours(0,0,0,0);
        const todayKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const btn = document.getElementById('submitBtn');
        if (btn) btn.textContent = (window.BB && BB.t) ? BB.t(input.value === todayKey ? 'journal.save.submitToday' : 'journal.save.submitOther') : (input.value === todayKey ? "Save Today's Entry ✨" : "Log Entry ✨");
      }
    }
    window.onEntryDateChange = onEntryDateChange;

    function updateFormHeading() {
      const h = document.getElementById('entryFormHeading');
      if (!h) return;
      const val = document.getElementById('entryDate')?.value;
      if (!val) return;
      h.textContent = (typeof _fmMoodTitle === 'function') ? _fmMoodTitle() : h.textContent;
    }

    // Function to set date picker to today
    // Normal (non-focused) entry form: lock/unlock the sleep selector based on
    // whether the entry's night has happened yet. Mirrors the focused-mode lock.
    function _applySleepLock() {
      const sec = document.getElementById('sleepSection');
      if (!sec) return;
      const selector = document.getElementById('sleepSelector');
      const btnRow   = document.getElementById('sleepBtnRow');
      const sq       = document.getElementById('sleepQualitySubSection');
      // Full spectrum swaps the range buttons for a slider, so the lock has to
      // know about both — and the unlock branch below must restore whichever one
      // is actually in use rather than always un-hiding the buttons (which is
      // what undid _applyMoodSpectrumMode's hide).
      const spectrumCtrl = document.getElementById('sleepSpectrumControl');
      const _fs = _spectrumEnabled();
      let msg = document.getElementById('sleepNotYetMsg');
      if (_sleepNotYet()) {
        selectedSleep = null;
        selectedSleepQuality = null;
        if (selector) selector.style.display = 'none';
        if (spectrumCtrl) spectrumCtrl.style.display = 'none';
        if (btnRow)   btnRow.style.display = 'none';
        if (sq)       sq.style.display = 'none';
        if (!msg) {
          msg = document.createElement('div');
          msg.id = 'sleepNotYetMsg';
          msg.style.cssText = 'text-align:center;padding:12px 8px;color:#6c757d;font-size:0.92em;font-weight:600;';
          sec.appendChild(msg);
        }
        msg.textContent = '🌙 ' + ((window.BB && BB.t) ? BB.t('journal.fm.sleepNotYet') : "You haven't slept yet");
        msg.style.display = '';
      } else {
        if (selector) selector.style.display = _fs ? 'none' : '';
        if (spectrumCtrl) spectrumCtrl.style.display = _fs ? '' : 'none';
        if (btnRow)   btnRow.style.display = '';
        if (msg)      msg.style.display = 'none';
        // 7.5 predates the slider and sits between two of its integer stops, so
        // the thumb and the readout would disagree ("7.5h" under a thumb at 8).
        // Full spectrum defaults to a whole 8h instead; the button UI is
        // unaffected, since its 7-9h bucket covers both.
        if (selectedSleep == null) selectedSleep = _fs ? 8 : 7.5;
        if (_fs) _syncSpectrumSliders();
      }
    }
    window._applySleepLock = _applySleepLock;

    function setDefaultDate() {
      const dateInput = document.getElementById('entryDate');
      // Top-level boot call runs before body content is parsed, so the input
      // may not exist yet. Bail out — later flows (form open, edit) call this
      // again once the DOM is ready.
      if (!dateInput) return;
      const useToday = localStorage.getItem('journalDefaultToday') === 'true';
      const base = new Date();
      if (!useToday) base.setDate(base.getDate() - 1);
      const yyyy = base.getFullYear();
      const mm = String(base.getMonth() + 1).padStart(2, '0');
      const dd = String(base.getDate()).padStart(2, '0');
      dateInput.value = `${yyyy}-${mm}-${dd}`;
      // Set max to today to prevent future dates
      const today = new Date();
      const ty = today.getFullYear();
      const tm = String(today.getMonth() + 1).padStart(2, '0');
      const td = String(today.getDate()).padStart(2, '0');
      dateInput.max = `${ty}-${tm}-${td}`;
      updateFormHeading();
      // Check if selected date has a missing entry
      checkMissingEntry(dateInput);
    }

    async function checkMissingEntry(dateInput) {
      try {
        const entries = [];
        
        if (currentUser) {
          const snapshot = await db.collection('entries')
            .where('userId', '==', currentUser.uid)
            .get();
          snapshot.forEach(doc => {
            entries.push(doc.data());
          });
        } else {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('entry:')) {
              try {
                const value = localStorage.getItem(key);
                if (value) {
                  entries.push(JSON.parse(value));
                }
              } catch (e) {
                console.error('Error loading entry:', e);
              }
            }
          }
        }

        if (entries.length === 0) {
          // No entries at all, no highlighting needed
          dateInput.classList.remove('missing-entry');
          dateInput.classList.remove('missing-entry-old');
          return;
        }

        // Create a set of dates that have entries
        const entryDates = new Set();
        entries.forEach(entry => {
          const date = new Date(entry.date);
          const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          entryDates.add(dateKey);
        });

        // "Current" date = the default date the form is set to (yesterday or today mode)
        let currentDate;
        if (dateInput.value) {
          currentDate = new Date(dateInput.value + 'T12:00:00');
          currentDate.setHours(0, 0, 0, 0);
        } else {
          const useToday = localStorage.getItem('journalDefaultToday') === 'true';
          currentDate = new Date();
          currentDate.setHours(0, 0, 0, 0);
          if (!useToday) currentDate.setDate(currentDate.getDate() - 1);
        }
        const currentKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
        const hasEntryForCurrentDate = entryDates.has(currentKey);

        // Find the first entry date
        const sortedEntries = entries.sort((a, b) => new Date(a.date) - new Date(b.date));
        const firstEntryDate = new Date(sortedEntries[0].date);
        firstEntryDate.setHours(0, 0, 0, 0);

        // Check for missing entries between first entry and the day before currentDate
        let hasMissingOldEntries = false;
        if (firstEntryDate < currentDate) {
          let checkDate = new Date(firstEntryDate);
          while (checkDate < currentDate) {
            const checkKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
            if (!entryDates.has(checkKey)) {
              hasMissingOldEntries = true;
              break;
            }
            checkDate.setDate(checkDate.getDate() + 1);
          }
        }

        // Apply appropriate styling
        dateInput.classList.remove('missing-entry');
        dateInput.classList.remove('missing-entry-old');

        if (hasMissingOldEntries) {
          // Red border for older missing entries
          dateInput.classList.add('missing-entry-old');
        } else if (!hasEntryForCurrentDate) {
          // Orange border for current default date missing
          dateInput.classList.add('missing-entry');
        }
      } catch (error) {
        console.error('Error checking missing entry:', error);
      }
    }

    // Make functions globally accessible
    // ────────────────────────────────────────────
    // SETTINGS MODAL
    // ────────────────────────────────────────────
    async function _refreshHealthAuthDisplay() {
      const _setHealthInfo = t => document.querySelectorAll('.settings-health-info').forEach(el => el.textContent = t);
      const Health = getPlugin('HealthPlugin');
      if (Health) {
        try {
          const { available } = await Health.isHealthAvailable();
          if (!available) {
            _setHealthInfo('Health data: ❌ Unavailable');
          } else {
            const result = await Health.checkHealthPermissions({ permissions: ['READ_SLEEP', 'READ_STEPS'] });
            const sleepOk = result?.permissions?.READ_SLEEP === true;
            const stepsOk = result?.permissions?.READ_STEPS === true;
            const granted = sleepOk && stepsOk;
            const asked = sleepOk || stepsOk;
            if (isIOS()) {
              // iOS deliberately hides whether READ access was actually granted —
              // checkHealthPermissions can only tell "never asked" (.notDetermined)
              // from "asked at some point", and reports the SAME status whether the
              // user granted or denied a read type. So the flag alone can't confirm
              // "Authorised". The one reliable signal iOS does give is whether a real
              // query returns data: if recent steps/sleep come back, read access is
              // genuinely working, so we can honestly say "Connected".
              if (!asked) {
                _setHealthInfo('Health data: ⚠️ Not yet authorised — enable the toggle above');
              } else {
                let _connected = false;
                try {
                  const _now = new Date();
                  const _weekAgo = new Date(_now.getTime() - 7 * 24 * 60 * 60 * 1000);
                  const _steps = await Health.queryAggregated({
                    dataType: 'steps',
                    startDate: _weekAgo.toISOString(),
                    endDate:   _now.toISOString(),
                    bucket:    'day'
                  });
                  _connected = !!(_steps?.aggregatedData?.some(d => d && d.value > 0));
                  if (!_connected) {
                    // Steps can be legitimately empty; a sleep sample confirms read access too.
                    const _sleep = await Health.queryLatestSample({
                      dataType: 'sleep',
                      startDate: _weekAgo.toISOString(),
                      endDate:   _now.toISOString()
                    });
                    _connected = !!(_sleep && _sleep.value != null);
                  }
                } catch (e) {}
                _setHealthInfo(_connected
                  ? 'Health data: ✅ Connected to Apple Health'
                  : 'Health data: Requested · manage in Apple Health');
              }
            } else {
              // Android (Health Connect) reports the real granted set accurately.
              _setHealthInfo(`Health data: ${granted ? '✅ Authorised' : asked ? '⚠️ Partially authorised' : '⚠️ Not yet authorised'}`);
            }
          }
        } catch(e) {
          _setHealthInfo('Health data: ❓ Unknown');
        }
      } else {
        _setHealthInfo('Health data: ❌ Unavailable');
      }
    }

    async function showSettingsModal() {
      // Clear advanced badge when settings is opened; show in-modal hint pointing to Advanced
      const _badgeWasActive = BB.storage.get('AdvancedBadgeVisible') === '1';
      if (_badgeWasActive) {
        BB.storage.remove('AdvancedBadgeVisible');
        _updateAdvancedBadge();
      }
      // Update logo display
      const _logoSrcsS = ['images/logos/good_logo.png','images/logos/elevated_logo.png','images/logos/sad_logo.png'];
      const _logoIdxS = parseInt(localStorage.getItem('logoVariant') || '0', 10);
      const _settingsLogoEl = document.getElementById('settingsLogoImg');
      if (_settingsLogoEl) _settingsLogoEl.src = _logoSrcsS[_logoIdxS] || _logoSrcsS[0];
      // Populate stats start date picker
      document.getElementById('statsStartDateInput').value = statsStartDate || '';

      // Populate login status
      const _loginStatusEl = document.getElementById('settingsLoginStatus');
      const _isGuest = !(currentUser && currentUser.email);
      if (_loginStatusEl) {
        if (!_isGuest) {
          const _emailSnip = currentUser.email.length > 10 ? currentUser.email.substring(0, 10) + '…' : currentUser.email;
          _loginStatusEl.textContent = 'Logged in (' + _emailSnip + ')';
        } else {
          _loginStatusEl.textContent = 'Guest mode';
        }
      }
      // Guest-only "Sign in to back up" prompt — customising never needs an account.
      const _guestSignInBtn = document.getElementById('settingsGuestSignIn');
      const _guestSignInNote = document.getElementById('settingsGuestSignInNote');
      if (_guestSignInBtn) _guestSignInBtn.style.display = _isGuest ? '' : 'none';
      if (_guestSignInNote) _guestSignInNote.style.display = _isGuest ? '' : 'none';

      // Appearance row — reflect the stored preference (BB.theme lives in fab.js).
      const _appearanceSel = document.getElementById('appearanceSelect');
      if (_appearanceSel) {
        let _pref = 'auto';
        try { _pref = (window.BB && BB.theme) ? BB.theme.pref() : (localStorage.getItem('bbTheme') || 'auto'); } catch (_) {}
        _appearanceSel.value = _pref;
      }

      // Always open showing main panel
      document.getElementById('settingsMainPanel').style.display = '';
      document.getElementById('settingsMobilePanel').style.display = 'none';
      document.getElementById('settingsAdvancedPanel').style.display = 'none';
      document.getElementById('settingsAdvancedJournalPanel').style.display = 'none';
      document.getElementById('settingsAdvancedMorePanel').style.display = 'none';
      document.getElementById('settingsAdvancedMore2Panel').style.display = 'none';

      // Incognito mode
      document.getElementById('incognitoModeToggle').checked = localStorage.getItem('incognitoMode') === 'true';
      document.getElementById('moodLinkingToggle').checked = localStorage.getItem('moodLinkingEnabled') === '1';
      const _msToggle = document.getElementById('moodSpectrumToggle');
      if (_msToggle) _msToggle.checked = _spectrumEnabled();
      const _wmToggle = document.getElementById('wheelModeToggle');
      if (_wmToggle) _wmToggle.checked = _wheelMode();
      document.getElementById('moodSuggestionToggle').checked = localStorage.getItem('showMoodSuggestion') === '1';
      if (window.BBInsights) window.BBInsights.syncSettingUI();
      document.getElementById('focusModeToggle').checked = _fmEnabled;
      document.getElementById('focusModeSubOptions').style.display = _fmEnabled ? '' : 'none';
      document.getElementById('fmConfirmStepToggle').checked = localStorage.getItem('fmConfirmStep') === 'true';
      document.getElementById('elaborateResponsesToggle').checked = localStorage.getItem('elaborateResponsesEnabled') === 'true';
      _renderStepToggles();
      const _cfDetails = document.getElementById('customiseFormDetails');
      if (_cfDetails) _cfDetails.open = BB.storage.get('CustomiseFormCollapsed') !== '1';

      // Version label — driven by the canonical window._APP_VERSION (set in
      // js/shared/brand-config.js) so it can never drift from the home page.
      if (window._APP_VERSION) {
        document.querySelectorAll('.settings-version-info').forEach(el => el.textContent = 'Version: ' + window._APP_VERSION);
      }

      // If not native, show download prompt instead of native settings
      if (!isNative()) {
        const _hsSectionW = document.getElementById('healthSyncSection');
        if (_hsSectionW) _hsSectionW.style.display = 'none';
        document.getElementById('settingsModal').classList.add('active');
        document.getElementById('settingsWebContent').style.display = 'block';
        const _saveBtnW = document.getElementById('settingsSaveBtn');
        if (_saveBtnW) _saveBtnW.style.display = '';
        document.querySelectorAll('.settings-platform-info').forEach(el => el.textContent = ' · 🌐 Web');
        const _advHintElW = document.getElementById('advancedSettingsBadgeHint');
        if (_advHintElW) _advHintElW.style.display = _badgeWasActive ? 'flex' : 'none';
        if (BB.storage.get('SettingsHintDone') === '1' && BB.storage.get('CustomiseFormHintDone') !== '1') {
          _showCustomiseFormHint();
        } else if (BB.storage.get('CustomiseAdditionalHintDone') === '1' && BB.storage.get('CloseSettingsHintDone') !== '1') {
          _showCloseSettingsHint();
        }
        return;
      }

      // Native — hide web content, surface the Apple Health (HealthKit) section
      document.getElementById('settingsWebContent').style.display = 'none';
      const _hsSectionN = document.getElementById('healthSyncSection');
      if (_hsSectionN) _hsSectionN.style.display = '';
      const _saveBtnN = document.getElementById('settingsSaveBtn');
      if (_saveBtnN) _saveBtnN.style.display = '';

      // Restore saved values
      const savedTime = localStorage.getItem('reminderTime') || '07:00';
      const enabled = localStorage.getItem('reminderEnabled') === 'true';
      const weeklyEnabled = localStorage.getItem('weeklySummaryEnabled') === 'true';
      document.getElementById('reminderTime').value = savedTime;
      document.getElementById('reminderEnabled').checked = enabled;
      document.getElementById('weeklySummaryEnabled').checked = weeklyEnabled;
      document.getElementById('healthSyncToggle').checked = BB.storage.get('HealthSyncEnabled') === '1';

      // Show platform info
      document.querySelectorAll('.settings-platform-info').forEach(el => el.textContent = ` · ${window.Capacitor.getPlatform() === 'ios' ? '🍎 iOS' : '🤖 Android'}`);
      if (isNative()) {

        const LocalNotifications = getPlugin('LocalNotifications');
        const _setNotifInfo = t => document.querySelectorAll('.settings-notif-info').forEach(el => el.textContent = t);
        if (LocalNotifications) {
          try {
            const { display } = await LocalNotifications.checkPermissions();
            _setNotifInfo(
              display === 'granted' ? 'Notifications: ✅ Authorised' :
              display === 'denied'  ? 'Notifications: ❌ Blocked in iOS Settings' :
                                      'Notifications: ⚠️ Not yet authorised'
            );
          } catch (e) {
            _setNotifInfo('Notifications: ❓ Unknown');
          }
        } else {
          _setNotifInfo('Notifications: ❌ Unavailable');
        }

        // Check health data authorisation
        await _refreshHealthAuthDisplay();
      } else {
        // (no reminderStatus element)
        document.getElementById('reminderEnabled').disabled = true;
        document.getElementById('reminderTime').disabled = true;
        document.querySelectorAll('.settings-health-info').forEach(el => el.textContent = 'Health data: Unavailable on web');
      }

      document.getElementById('settingsModal').classList.add('active');
      // Show "Click here" hint above Advanced button if badge was active
      const _advHintEl = document.getElementById('advancedSettingsBadgeHint');
      if (_advHintEl) _advHintEl.style.display = _badgeWasActive ? 'flex' : 'none';
      if (BB.storage.get('SettingsHintDone') === '1' && BB.storage.get('CustomiseFormHintDone') !== '1') {
        _showCustomiseFormHint();
      } else if (BB.storage.get('CustomiseAdditionalHintDone') === '1' && BB.storage.get('CloseSettingsHintDone') !== '1') {
        _showCloseSettingsHint();
      }
    }

    function closeSettingsModal() {
      document.getElementById('settingsModal').classList.remove('active');
      // Reset hint overlay states
      const _amo = document.getElementById('advancedHintOverlay');
      if (_amo) _amo.style.display = 'none';
      const _smClose = document.getElementById('settingsModal');
      if (_smClose) {
        delete _smClose.dataset.customiseHintActive;
        delete _smClose.dataset.customiseAdditionalHintActive;
        delete _smClose.dataset.closeSettingsHintActive;
      }
      const _cbReset = document.getElementById('settingsCloseBtn');
      if (_cbReset) _cbReset.style.zIndex = '';
      const _cw = document.getElementById('customiseFormWrap');
      if (_cw) { _cw.style.zIndex = ''; _cw.style.background = ''; _cw.style.borderRadius = ''; _cw.style.padding = ''; _cw.style.paddingBottom = ''; _cw.style.margin = ''; _cw.style.marginBottom = '16px'; }
      _applyJournalOnboardingGating(); // re-evaluate page overlay (hides bbHintOverlay if no longer blocking)
      // Always reset to main panel so sub-panels don't persist on next open
      document.getElementById('settingsMainPanel').style.display = '';
      document.getElementById('settingsAdvancedPanel').style.display = 'none';
      document.getElementById('settingsAdvancedJournalPanel').style.display = 'none';
      document.getElementById('settingsAdvancedMorePanel').style.display = 'none';
      document.getElementById('settingsAdvancedMore2Panel').style.display = 'none';
      document.getElementById('settingsAchievementsPanel').style.display = 'none';
    }

    function openAdvancedJournal() {
      document.getElementById('settingsAdvancedPanel').style.display = 'none';
      document.getElementById('settingsAdvancedJournalPanel').style.display = '';
      _renderStepToggles();
      const modal = document.querySelector('#settingsModal .confirm-content');
      if (modal) modal.scrollTop = 0;
    }
    function closeAdvancedJournal() {
      document.getElementById('settingsAdvancedJournalPanel').style.display = 'none';
      document.getElementById('settingsAdvancedPanel').style.display = '';
      const modal = document.querySelector('#settingsModal .confirm-content');
      if (modal) modal.scrollTop = 0;
    }
    function openAdvancedMore() {
      document.getElementById('settingsAdvancedJournalPanel').style.display = 'none';
      document.getElementById('settingsAdvancedMorePanel').style.display = '';
      const modal = document.querySelector('#settingsModal .confirm-content');
      if (modal) modal.scrollTop = 0;
    }
    function closeAdvancedMore() {
      document.getElementById('settingsAdvancedMorePanel').style.display = 'none';
      document.getElementById('settingsAdvancedJournalPanel').style.display = '';
      const modal = document.querySelector('#settingsModal .confirm-content');
      if (modal) modal.scrollTop = 0;
    }
    function openAdvancedMore2() {
      document.getElementById('settingsAdvancedMorePanel').style.display = 'none';
      document.getElementById('settingsAdvancedMore2Panel').style.display = '';
      const modal = document.querySelector('#settingsModal .confirm-content');
      if (modal) modal.scrollTop = 0;
      // Hide full reset for protected account
      const _protected = currentUser && currentUser.email === 'inbox@jamesmarkey.co.uk';
      const _resetEl = document.getElementById('fullResetSection');
      const _lockedEl = document.getElementById('fullResetLocked');
      if (_resetEl) _resetEl.style.display = _protected ? 'none' : '';
      if (_lockedEl) _lockedEl.style.display = _protected ? '' : 'none';
      // Re-label the section based on whether we're signed in: when signed in
      // the action deletes the BipolarBear account itself, not just the data.
      if (_resetEl && !_protected) {
        const _isSignedIn = !!currentUser;
        const _heading = _resetEl.querySelector('div:first-child');
        const _desc    = _resetEl.querySelector('div:nth-child(2)');
        const _btn     = _resetEl.querySelector('button');
        if (_heading) _heading.textContent = _isSignedIn ? '🗑️ Delete Account' : '🗑️ Full Reset';
        if (_desc) {
          _desc.textContent = _isSignedIn
            ? 'Permanently delete your BipolarBear account, all journal entries, and reset the app. This cannot be undone.'
            : 'Permanently delete all journal entries and reset all settings to their defaults. This cannot be undone.';
        }
        if (_btn) _btn.innerHTML = _isSignedIn ? '🗑️ Delete Account' : '🗑️ Delete All Data &amp; Reset Settings';
      }
    }
    function closeAdvancedMore2() {
      document.getElementById('settingsAdvancedMore2Panel').style.display = 'none';
      document.getElementById('settingsAdvancedMorePanel').style.display = '';
      const modal = document.querySelector('#settingsModal .confirm-content');
      if (modal) modal.scrollTop = 0;
    }
    function _toggleElaborateResponses() {
      const on = document.getElementById('elaborateResponsesToggle').checked;
      localStorage.setItem('elaborateResponsesEnabled', on ? 'true' : 'false');
      localStorage.setItem('intentionEnabled', on ? 'true' : 'false');
      if (!on) {
        // Clear in-memory step notes so they don't get saved
        if (typeof selectedStepNotes !== 'undefined') selectedStepNotes = {};
        // Strip encoded step notes from the intention field (everything after ___\n)
        if (typeof selectedIntention !== 'undefined' && selectedIntention) {
          selectedIntention = selectedIntention.split(/\n?_{3,}\n/)[0].trim();
          const fmInt = document.getElementById('fmIntentionInput');
          if (fmInt) fmInt.value = selectedIntention;
        }
      }
      if (typeof _fmActive !== 'undefined' && _fmActive) _renderFocusedStep();
    }
    window._toggleElaborateResponses = _toggleElaborateResponses;

    function _toggleIncognitoMode() {
      const on = document.getElementById('incognitoModeToggle').checked;
      localStorage.setItem('incognitoMode', on ? 'true' : 'false');
      _refreshRecentMoods();
    }
    window._toggleIncognitoMode = _toggleIncognitoMode;

    function applyTrackingPrefs() {
      // In edit mode _editFieldOverrides is non-null and takes priority.
      // Otherwise read localStorage with optional legacy fallback.
      const _delBuiltin = JSON.parse(localStorage.getItem('deletedBuiltinFields') || '[]');
      function fromStorage(key, legacyKey) {
        if (_delBuiltin.includes(key)) return false;
        if (_editFieldOverrides !== null) return !!_editFieldOverrides[key];
        const val = localStorage.getItem(key);
        if (val !== null) return val === 'true';
        if (legacyKey) return localStorage.getItem(legacyKey) === 'true';
        return false; // all additional tracking off by default; enable in settings
      }
      const trackGoals        = fromStorage('trackGoals');
      const trackBudget       = fromStorage('trackBudget');
      const trackExercise     = fromStorage('trackExercise');
      const trackOutside      = fromStorage('trackOutside');
      const trackAnxiety      = fromStorage('trackAnxiety',      'trackEmotions');
      const trackAlcohol      = fromStorage('trackAlcohol');

      // Main form rows (display:contents = transparent to parent grid)
      const gRow  = document.getElementById('goalsTrackRow');
      const bRow  = document.getElementById('budgetTrackRow');
      const exRow = document.getElementById('exerciseTrackRow');
      const ouRow = document.getElementById('outsideTrackRow');
      const eAnx  = document.getElementById('emotionAnxietyRow');
      const eStr  = document.getElementById('emotionStressRow');
      const eIrr  = document.getElementById('emotionIrritabilityRow');
      const aRow  = document.getElementById('alcoholTrackRow');
      if (gRow)  gRow.style.display  = trackGoals        ? 'contents' : 'none';
      if (bRow)  bRow.style.display  = trackBudget       ? 'contents' : 'none';
      if (exRow) exRow.style.display = trackExercise     ? 'contents' : 'none';
      if (ouRow) ouRow.style.display = trackOutside      ? 'contents' : 'none';
      if (eAnx)  eAnx.style.display  = trackAnxiety      ? 'contents' : 'none';
      if (eStr)  eStr.style.display  = trackAnxiety      ? 'contents' : 'none';
      if (eIrr)  eIrr.style.display  = trackAnxiety      ? 'contents' : 'none';
      if (aRow)  aRow.style.display  = trackAlcohol      ? 'contents' : 'none';

      // Edit modal groups
      const exGrp = document.getElementById('editExerciseGroup');
      const ouGrp = document.getElementById('editOutsideGroup');
      const eAnxGrp = document.getElementById('editAnxietyGroup');
      const aGrp  = document.getElementById('editAlcoholGroup');
      if (exGrp)  exGrp.style.display  = trackExercise     ? '' : 'none';
      if (ouGrp)  ouGrp.style.display  = trackOutside      ? '' : 'none';
      if (eAnxGrp) eAnxGrp.style.display = trackAnxiety    ? '' : 'none';
      if (aGrp)   aGrp.style.display   = trackAlcohol      ? '' : 'none';
      // Apply custom labels for renameable built-in fields
      const _alcoRow = document.querySelector('#alcoholTrackRow > span');
      if (_alcoRow) _alcoRow.textContent = (_getBuiltinFieldLabel && _getBuiltinFieldLabel('trackAlcohol', '🍺 Alcohol?')) || '🍺 Alcohol?';
      // Custom tracking rows
      if (typeof renderCustomTrackingRows === 'function') renderCustomTrackingRows();
      _applyStepVisibility();
    }

    const _CORE_STEP_TOGGLES = [
      { id:'energy',     icon:'⚡', label:'Energy' },
      { id:'sleep',      icon:'🛌', label:'Sleep' },
      { id:'medication', icon:'💊', label:'Meds' },
      { id:'more_data',  icon:'➕', label:'Additional' },
      { id:'notes',      icon:'📝', label:'Notes' },
    ];

    function _getDisabledSteps() {
      try { return JSON.parse(localStorage.getItem('disabledSteps') || '["more_data"]'); } catch(e) { return ['more_data']; }
    }

    function _onCustomiseDetailsOpen() {
      // Seed disabledSteps on first open if not set
      if (localStorage.getItem('disabledSteps') === null) {
        localStorage.setItem('disabledSteps', JSON.stringify(['more_data']));
      }
      _renderStepToggles();
      // Hint progression: dismiss customise form hint and show additional hint
      if (BB.storage.get('CustomiseFormHintDone') !== '1') {
        _dismissCustomiseFormHint();
        _showCustomiseAdditionalHint();
      }
    }
    window._onCustomiseDetailsOpen = _onCustomiseDetailsOpen;

    function _toggleStep(id) {
      // Check before mutating so we know whether to trigger dismissal chain
      const _wasAdditionalHintPending = id === 'more_data' && BB.storage.get('CustomiseAdditionalHintDone') !== '1';
      const dis = _getDisabledSteps();
      const idx = dis.indexOf(id);
      if (idx >= 0) dis.splice(idx, 1); else dis.push(id);
      localStorage.setItem('disabledSteps', JSON.stringify(dis));
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid).set({ disabledSteps: dis }, { merge: true }).catch(() => {});
      }
      _renderStepToggles();
      _applyStepVisibility();
      // Dismiss additional tracking hint when user enables more_data
      if (_wasAdditionalHintPending && !dis.includes('more_data')) {
        _dismissCustomiseAdditionalHint();
      }
      // Rebuild focus steps if currently in focus mode
      if (typeof _fmActive !== 'undefined' && _fmActive) {
        const _ci = _fmSteps[_fmStepIndex] ? _fmSteps[_fmStepIndex].id : null;
        _fmSteps = _buildFocusedSteps();
        const _ni = _ci ? _fmSteps.findIndex(s => s.id === _ci) : -1;
        _fmStepIndex = _ni >= 0 ? _ni : Math.min(_fmStepIndex, _fmSteps.length - 1);
        _fmHighWater = Math.max(_fmHighWater, _fmStepIndex);
        _renderFocusedStep();
      }
    }
    window._toggleStep = _toggleStep;

    function _renderStepToggles() {
      const row = document.getElementById('stepTogglesRow');
      if (!row) return;
      let _rawDis = [];
      try { _rawDis = JSON.parse(localStorage.getItem('disabledSteps') || '[]'); } catch(e) {}
      const _hintActive = BB.storage.get('CustomiseAdditionalHintDone') !== '1' && BB.storage.get('CustomiseFormHintDone') === '1';
      row.innerHTML = _CORE_STEP_TOGGLES.map(t => {
        const on = !_rawDis.includes(t.id);
        const _idAttr = t.id === 'more_data' ? ' id="stepToggleMoreData"' : '';
        // During the additional hint, dim all buttons except Additional and pulse it
        const _dimmed = _hintActive && t.id !== 'more_data';
        const _pulsing = _hintActive && t.id === 'more_data';
        const _borderColor = _pulsing ? 'var(--brand-primary)' : (on ? 'var(--brand-primary)' : '#dee2e6');
        const _bg = _pulsing ? 'rgba(255,149,0,0.18)' : (on ? 'rgba(255,149,0,0.1)' : 'white');
        const _color = on ? 'var(--brand-primary)' : '#adb5bd';
        const _extraStyle = _dimmed ? 'opacity:0.3;pointer-events:none;' : (_pulsing ? 'animation:hintFade 1.6s ease-in-out infinite;box-shadow:0 0 0 3px rgba(255,149,0,0.35);' : '');
        return `<button${_idAttr} onclick="_toggleStep('${t.id}')" style="display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 12px;border-radius:12px;border:1.5px solid ${_borderColor};background:${_bg};color:${_color};cursor:pointer;font-size:0.82em;font-weight:600;min-width:52px;-webkit-tap-highlight-color:transparent;${_extraStyle}"><span style="font-size:1.3em;">${t.icon}</span><span>${t.label}</span></button>`;
      }).join('');
    }
    window._renderStepToggles = _renderStepToggles;

    function _applyStepVisibility() {
      const dis = _getDisabledSteps();
      [
        { id: 'energy',       el: 'energySection' },
        { id: 'sleep',        el: 'sleepSection' },
        { id: 'medication',   el: 'medicationSection' },
        { id: 'more_data',    el: 'moreDataArea' },
        { id: 'notes',        el: 'notesSection' },
      ].forEach(({ id, el }) => {
        const elem = document.getElementById(el);
        if (elem) elem.classList.toggle('step-disabled', dis.includes(id));
      });
    }
    window._applyStepVisibility = _applyStepVisibility;

    window.applyTrackingPrefs = applyTrackingPrefs;

    const FIELD_PICKER_FIELDS = [
      { key: 'trackGoals',        label: '🏅 Goals',         synced: true },
      { key: 'trackBudget',       label: '💰 Budget',        synced: true },
      { key: 'trackAnxiety',      label: '😰 Emotions',     legacy: 'trackEmotions', sublabel: '3 questions' },
      { key: 'trackAlcohol',           label: '🍺 Alcohol',      sublabel: 'Reverse', renameable: true },
      { key: 'trackCustom_addedSugar', label: '🍫 Added Sugar',  sublabel: 'Reverse', renameable: true },
    ];

    const DEFAULT_CUSTOM_FIELDS = [
      { id: 'addedSugar', label: 'Added Sugar', emoji: '🍫', positive: 'no', builtin: true },
    ];

    function getCustomFields() {
      const deleted = JSON.parse(localStorage.getItem('deletedDefaultCustomFields') || '[]');
      const user = JSON.parse(localStorage.getItem('customTrackingFields') || '[]');
      const defaults = DEFAULT_CUSTOM_FIELDS.filter(d => !deleted.includes(d.id) && !user.some(u => u.id === d.id) && !user.some(u => u.label && u.label.toLowerCase() === d.label.toLowerCase())).map(d => {
        const override = localStorage.getItem('_labelOverride_trackCustom_' + d.id);
        return override ? { ...d, label: override.replace(/^\S+\s*/, ''), emoji: override.split(' ')[0] || d.emoji } : d;
      });
      return [...defaults, ...user];
    }
    function _getBuiltinFieldLabel(key, fallback) {
      return localStorage.getItem('_labelOverride_' + key) || fallback;
    }

    const EMOJI_LIST = [
      '😴','🧘','🏃','🚴','🏊','🤸','🧗','⚽','🎾',
      '🥗','🍎','🍵','💧','💉','🩺','❤️',
      '🧠','😊','😢','😡','🤒','🌞','🌧️','🌿',
      '📚','🎵','🎨','🛁','🐾','🍫',
    ];

    function renderFieldPickerList() {
      const list = document.getElementById('fieldPickerList');
      if (!list) return;
      const pill = active =>
        active
          ? `<span style="background:var(--brand-btn);color:white;border-radius:20px;padding:3px 10px;font-size:0.78em;font-weight:600;">On</span>`
          : `<span style="background:#e9ecef;color:#adb5bd;border-radius:20px;padding:3px 10px;font-size:0.78em;font-weight:600;">Off</span>`;

      const _deletedBuiltin = JSON.parse(localStorage.getItem('deletedBuiltinFields') || '[]');
      const builtIn = FIELD_PICKER_FIELDS.filter(f => !f.deletable || !_deletedBuiltin.includes(f.key)).map(f => {
        const active = _editFieldOverrides !== null
          ? !!_editFieldOverrides[f.key]
          : (localStorage.getItem(f.key) !== null
              ? localStorage.getItem(f.key) === 'true'
              : (f.legacy ? localStorage.getItem(f.legacy) === 'true' : f.key === 'trackBudget'));
        const _storedLabel = f.renameable ? (localStorage.getItem('_labelOverride_' + f.key) || null) : null;
        const _displayLabel = _storedLabel || f.label;
        const labelHtml = f.synced
          ? `<span style="font-size:0.92em;color:#495057;">${_displayLabel}</span><span style="font-size:0.72em;color:#adb5bd;margin-left:5px;font-weight:500;letter-spacing:0.01em;">${BB.t('journal.ui.configurable')}</span>`
          : f.sublabel
          ? `<span style="font-size:0.92em;color:#495057;">${_displayLabel}</span><span style="font-size:0.72em;color:#adb5bd;margin-left:5px;font-weight:500;letter-spacing:0.01em;">⚙ ${f.sublabel}</span>`
          : `<span style="font-size:0.92em;color:#495057;">${_displayLabel}</span>`;
        if (f.renameable) {
          if (_editingBuiltinKey === f.key) {
            const _bEmojiGrid = EMOJI_LIST.map(e =>
              `<button onclick="selectEditPickerEmoji('${e}')" style="font-size:1.25em;background:none;border:none;padding:4px 3px;cursor:pointer;-webkit-tap-highlight-color:transparent;line-height:1;">${e}</button>`
            ).join('');
            return `<div style="padding:8px 4px 6px;border-bottom:1px solid #f0f0f0;background:#fafafa;">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <button id="editEmojiPickerBtn" onclick="toggleEditEmojiPicker()" title="${BB.t('journal.ui.pickEmoji')}" style="width:38px;height:38px;min-width:38px;border-radius:8px;border:1.5px solid #e9ecef;background:#fff;font-size:1.2em;cursor:pointer;-webkit-tap-highlight-color:transparent;">${_editingFieldEmoji || f.label.split(' ')[0]}</button>
                <input id="builtinFieldEditInput" type="text" value="${_storedLabel ? _storedLabel.replace(/^\S+\s*/, '') : f.label.replace(/^\S+\s*/, '')}" maxlength="20"
                  style="flex:1;height:38px;padding:0 10px;border:1.5px solid #e9ecef;border-radius:8px;font-size:0.9em;outline:none;box-sizing:border-box;"
                  onkeydown="if(event.key==='Enter')saveBuiltinFieldLabel('${f.key}')">
                <button onclick="saveBuiltinFieldLabel('${f.key}')" style="height:38px;box-sizing:border-box;background:var(--brand-btn);color:white;border:none;border-radius:8px;padding:0 12px;font-size:0.85em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">Save</button>
                <button onclick="cancelBuiltinFieldEdit()" style="height:38px;box-sizing:border-box;background:#e9ecef;color:#495057;border:none;border-radius:8px;padding:0 10px;font-size:0.85em;cursor:pointer;-webkit-tap-highlight-color:transparent;">✕</button>
              </div>
              <div id="editEmojiPickerGrid" style="display:none;flex-wrap:wrap;gap:2px;padding:6px;background:#f8f9fa;border-radius:8px;max-height:120px;overflow-y:auto;">${_bEmojiGrid}</div>
            </div>`;
          }
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 4px;border-bottom:1px solid #f0f0f0;-webkit-tap-highlight-color:transparent;">
            <span onclick="toggleField('${f.key}')" style="display:flex;align-items:baseline;gap:0;flex:1;cursor:pointer;">${labelHtml}</span>
            <div style="display:flex;align-items:center;gap:2px;">
              ${pill(active)}
              <button onclick="event.stopPropagation();startEditBuiltinField('${f.key}');" style="background:none;border:none;color:#adb5bd;font-size:1.0em;cursor:pointer;min-width:36px;min-height:36px;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;">✏</button>
            </div>
          </div>`;
        }
        if (f.deletable) {
          const deletableLabelHtml = f.sublabel
            ? `<span style="font-size:0.92em;color:#495057;">${f.label}</span><span style="font-size:0.72em;color:#adb5bd;margin-left:5px;font-weight:500;letter-spacing:0.01em;">⚙ ${f.sublabel}</span>`
            : `<span style="font-size:0.92em;color:#495057;">${f.label}</span>`;
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 4px;border-bottom:1px solid #f0f0f0;-webkit-tap-highlight-color:transparent;">
            <span onclick="toggleField('${f.key}')" style="display:flex;align-items:baseline;gap:0;flex:1;cursor:pointer;">${deletableLabelHtml}</span>
            <div style="display:flex;align-items:center;gap:2px;">
              ${pill(active)}
              <button onclick="deleteBuiltinField('${f.key}')" style="background:none;border:none;color:#adb5bd;font-size:1.2em;cursor:pointer;min-width:36px;min-height:36px;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;">×</button>
            </div>
          </div>`;
        }
        return `<div onclick="toggleField('${f.key}')" style="display:flex;align-items:center;justify-content:space-between;padding:10px 4px;border-bottom:1px solid #f0f0f0;cursor:pointer;-webkit-tap-highlight-color:transparent;">
          <span style="display:flex;align-items:baseline;gap:0;">${labelHtml}</span>
          ${pill(active)}
        </div>`;
      }).join('');

      const editEmojiGrid = EMOJI_LIST.map(e =>
        `<button onclick="selectEditPickerEmoji('${e}')" style="font-size:1.25em;background:none;border:none;padding:4px 3px;cursor:pointer;-webkit-tap-highlight-color:transparent;line-height:1;">${e}</button>`
      ).join('');

      const custom = getCustomFields().filter(f => !f.builtin).map(f => {
        const active = _editFieldOverrides !== null
          ? !!_editFieldOverrides[`trackCustom_${f.id}`]
          : localStorage.getItem(`trackCustom_${f.id}`) === 'true';

        if (_editingFieldId === f.id) {
          return `<div style="padding:8px 4px 6px;border-bottom:1px solid #f0f0f0;background:#fafafa;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <button id="editEmojiPickerBtn" onclick="toggleEditEmojiPicker()" title="${BB.t('journal.ui.pickEmoji')}" style="width:38px;height:38px;min-width:38px;border-radius:8px;border:1.5px solid #e9ecef;background:#fff;font-size:1.2em;cursor:pointer;-webkit-tap-highlight-color:transparent;">${_editingFieldEmoji || '🏷️'}</button>
              <input id="customFieldEditInput" type="text" value="${f.label}" maxlength="15"
                style="flex:1;height:38px;padding:0 10px;border:1.5px solid #e9ecef;border-radius:8px;font-size:0.9em;outline:none;box-sizing:border-box;"
                onkeydown="if(event.key==='Enter')saveCustomFieldEdit()">
              <button onclick="saveCustomFieldEdit()" style="height:38px;box-sizing:border-box;background:var(--brand-btn);color:white;border:none;border-radius:8px;padding:0 12px;font-size:0.85em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">Save</button>
              <button onclick="cancelCustomFieldEdit()" style="height:38px;box-sizing:border-box;background:#e9ecef;color:#495057;border:none;border-radius:8px;padding:0 10px;font-size:0.85em;cursor:pointer;-webkit-tap-highlight-color:transparent;">✕</button>
            </div>
            <div id="editEmojiPickerGrid" style="display:none;flex-wrap:wrap;gap:2px;padding:4px 2px;background:#f0f0f0;border-radius:8px;">
              ${editEmojiGrid}
            </div>
          </div>`;
        }

        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 4px;border-bottom:1px solid #f0f0f0;-webkit-tap-highlight-color:transparent;">
          <span onclick="toggleField('trackCustom_${f.id}')" style="font-size:0.92em;color:#495057;flex:1;cursor:pointer;">${f.emoji ? f.emoji + ' ' : ''}${f.label}</span>
          <div style="display:flex;align-items:center;gap:2px;">
            ${pill(active)}
            <button onclick="editCustomField('${f.id}')" style="background:none;border:none;color:#adb5bd;font-size:1.0em;cursor:pointer;min-width:36px;min-height:36px;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;">✏</button>
            <button onclick="deleteCustomField('${f.id}')" style="background:none;border:none;color:#adb5bd;font-size:1.2em;cursor:pointer;min-width:36px;min-height:36px;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;">×</button>
          </div>
        </div>`;
      }).join('');

      const emojiPickerGrid = EMOJI_LIST.map(e =>
        `<button onclick="selectPickerEmoji('${e}')" style="font-size:1.25em;background:none;border:none;padding:4px 3px;cursor:pointer;-webkit-tap-highlight-color:transparent;line-height:1;">${e}</button>`
      ).join('');
      const addForm = `<div id="customFieldAddRow" style="padding:10px 4px 6px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <button id="emojiPickerBtn" onclick="toggleEmojiPicker()" title="${BB.t('journal.ui.pickEmoji')}" style="width:38px;height:38px;min-width:38px;border-radius:8px;border:1.5px solid #e9ecef;background:#fafafa;font-size:1.2em;cursor:pointer;-webkit-tap-highlight-color:transparent;">${_pickerEmoji || '🏷️'}</button>
          <input id="customFieldInput" type="text" placeholder="${BB.t('journal.ui.fieldNameMax')}" maxlength="15"
            style="flex:1;height:38px;padding:0 10px;border:1.5px solid #e9ecef;border-radius:8px;font-size:0.9em;outline:none;box-sizing:border-box;"
            onkeydown="if(event.key==='Enter')addCustomField()">
          <button onclick="addCustomField()" style="height:38px;box-sizing:border-box;background:var(--brand-btn);color:white;border:none;border-radius:8px;padding:0 12px;font-size:0.85em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;">Add</button>
        </div>
        <div id="emojiPickerGrid" style="display:none;flex-wrap:wrap;gap:2px;padding:4px 2px;background:#f8f9fa;border-radius:8px;">
          ${emojiPickerGrid}
        </div>
      </div>`;

      list.innerHTML = builtIn + custom;
      const addRow = document.getElementById('fieldPickerAddRow');
      if (addRow) addRow.innerHTML = addForm;
    }

    function showFieldPicker() {
      // Dismiss the "Customise your data fields" hint permanently on first open
      if (!BB.storage.get('CustomFieldHintDone')) {
        BB.storage.set('CustomFieldHintDone', '1');
        const _hint = document.getElementById('fmCustomFieldHint');
        if (_hint) _hint.style.display = 'none';
      }
      renderFieldPickerList();
      document.getElementById('fieldPickerModal').classList.add('active');
      // Set up fade indicator — hide when scrolled to bottom
      const listEl = document.getElementById('fieldPickerList');
      const fadeEl = document.getElementById('fieldPickerFade');
      function updateFade() {
        if (!listEl || !fadeEl) return;
        const atBottom = listEl.scrollHeight - listEl.scrollTop <= listEl.clientHeight + 4;
        fadeEl.style.opacity = atBottom ? '0' : '1';
      }
      if (listEl) {
        listEl.removeEventListener('scroll', updateFade);
        listEl.addEventListener('scroll', updateFade, { passive: true });
        // Delay so the list has rendered and has its final height
        setTimeout(updateFade, 50);
      }
    }

    function toggleField(key) {
      if (_editFieldOverrides !== null) {
        // Edit mode: flip in-memory override only, don't touch global prefs
        _editFieldOverrides[key] = !_editFieldOverrides[key];
        // If turning off, clear the in-memory value so it doesn't get saved
        if (!_editFieldOverrides[key]) {
          const _clearMap = {
            trackExercise: () => { selectedExercise = null; document.querySelectorAll('[data-exercise]').forEach(b=>b.classList.remove('selected')); },
            trackOutside:  () => { selectedOutside  = null; document.querySelectorAll('[data-outside]').forEach(b=>b.classList.remove('selected')); },
            trackAnxiety:  () => { selectedAnxiety  = null; selectedStress = null; selectedIrritability = null; },
            trackAlcohol:  () => { selectedAlcohol  = null; document.querySelectorAll('[data-alcohol]').forEach(b=>b.classList.remove('selected')); },
          };
          const _cKey = key.startsWith('trackCustom_') ? '_custom' : key;
          if (_clearMap[_cKey]) _clearMap[_cKey]();
          if (key.startsWith('trackCustom_')) {
            const _cid = key.slice('trackCustom_'.length);
            if (selectedCustom) selectedCustom[_cid] = null;
          }
        }
        applyTrackingPrefs();
        renderFieldPickerList();
        return;
      }
      const current = localStorage.getItem(key) === 'true';
      localStorage.setItem(key, !current);
      if (key === 'trackAnxiety' || key === 'trackStress' || key === 'trackIrritability') {
        localStorage.removeItem('trackEmotions');
      }
      applyTrackingPrefs();
      renderFieldPickerList();
      syncTrackingPrefsToFirestore();
    }

    function toggleEmojiPicker() {
      const grid = document.getElementById('emojiPickerGrid');
      if (!grid) return;
      const opening = grid.style.display === 'none';
      grid.style.display = opening ? 'flex' : 'none';
      if (opening) {
        // Scroll the add row into view
        requestAnimationFrame(() => {
          const addRow = document.getElementById('fieldPickerAddRow');
          if (addRow) addRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    }

    function selectPickerEmoji(emoji) {
      _pickerEmoji = emoji;
      const btn = document.getElementById('emojiPickerBtn');
      if (btn) btn.textContent = emoji;
      const grid = document.getElementById('emojiPickerGrid');
      if (grid) grid.style.display = 'none';
    }

    function editCustomField(id) {
      const field = getCustomFields().find(f => f.id === id);
      if (!field) return;
      _editingFieldId = id;
      _editingFieldEmoji = field.emoji || '';
      renderFieldPickerList();
    }

    function saveCustomFieldEdit() {
      const input = document.getElementById('customFieldEditInput');
      const label = input ? input.value.trim() : '';
      if (!label || !_editingFieldId) return;
      const fields = getCustomFields().map(f =>
        f.id === _editingFieldId ? { ...f, label, emoji: _editingFieldEmoji } : f
      );
      localStorage.setItem('customTrackingFields', JSON.stringify(fields));
      _editingFieldId = null;
      _editingFieldEmoji = '';
      applyTrackingPrefs();
      renderFieldPickerList();
      syncTrackingPrefsToFirestore();
    }

    function cancelCustomFieldEdit() {
      _editingFieldId = null;
      _editingFieldEmoji = '';
      renderFieldPickerList();
    }

    function startEditBuiltinField(key) {
      _editingBuiltinKey = key;
      // Pre-set emoji from stored override or field default
      const stored = localStorage.getItem('_labelOverride_' + key) || '';
      const f = (typeof FIELD_PICKER_FIELDS !== 'undefined' ? FIELD_PICKER_FIELDS : []).find(x => x.key === key);
      _editingFieldEmoji = (stored && stored.split(' ')[0]) || (f ? f.label.split(' ')[0] : '');
      renderFieldPickerList();
    }
    window.startEditBuiltinField = startEditBuiltinField;

    function saveBuiltinFieldLabel(key) {
      const input = document.getElementById('builtinFieldEditInput');
      if (!input) return;
      const newName = input.value.trim();
      const emoji = _editingFieldEmoji || '';
      if (newName) {
        localStorage.setItem('_labelOverride_' + key, (emoji ? emoji + ' ' : '') + newName);
      } else {
        localStorage.removeItem('_labelOverride_' + key);
      }
      _editingBuiltinKey = null;
      renderFieldPickerList();
      // Refresh form labels
      if (typeof renderCustomTrackingRows === 'function') renderCustomTrackingRows();
      syncTrackingPrefsToFirestore();
    }
    window.saveBuiltinFieldLabel = saveBuiltinFieldLabel;

    function cancelBuiltinFieldEdit() {
      _editingBuiltinKey = null;
      renderFieldPickerList();
    }
    window.cancelBuiltinFieldEdit = cancelBuiltinFieldEdit;

    function toggleEditEmojiPicker() {
      const grid = document.getElementById('editEmojiPickerGrid');
      if (!grid) return;
      grid.style.display = grid.style.display === 'none' ? 'flex' : 'none';
    }

    function selectEditPickerEmoji(emoji) {
      _editingFieldEmoji = emoji;
      const btn = document.getElementById('editEmojiPickerBtn');
      if (btn) btn.textContent = emoji;
      const grid = document.getElementById('editEmojiPickerGrid');
      if (grid) grid.style.display = 'none';
    }

    function addCustomField() {
      const input = document.getElementById('customFieldInput');
      const label = input ? input.value.trim() : '';
      if (!label) return;
      const fields = getCustomFields();
      const id = 'custom_' + Date.now();
      const emoji = _pickerEmoji || '';
      fields.push({ id, label, emoji });
      localStorage.setItem('customTrackingFields', JSON.stringify(fields));
      localStorage.setItem(`trackCustom_${id}`, 'true');
      if (_editFieldOverrides !== null) _editFieldOverrides[`trackCustom_${id}`] = true;
      _pickerEmoji = '';
      applyTrackingPrefs();
      renderFieldPickerList();
      syncTrackingPrefsToFirestore();
      if (input) input.value = '';
    }

    function deleteCustomField(id) {
      const field = getCustomFields().find(f => f.id === id);
      if (!field) return;
      _pendingDeleteFieldId = id;
      const label = `${field.emoji ? field.emoji + ' ' : ''}"${field.label}"`;
      const msg = document.getElementById('deleteCustomFieldMsg');
      if (msg) msg.textContent = `Remove the ${label} field?`;
      document.getElementById('deleteCustomFieldModal').classList.add('active');
    }

    function confirmDeleteCustomField() {
      const id = _pendingDeleteFieldId;
      if (!id) return;
      closeDeleteCustomFieldModal();
      if (DEFAULT_CUSTOM_FIELDS.some(d => d.id === id)) {
        const deleted = JSON.parse(localStorage.getItem('deletedDefaultCustomFields') || '[]');
        if (!deleted.includes(id)) { deleted.push(id); localStorage.setItem('deletedDefaultCustomFields', JSON.stringify(deleted)); }
      } else {
        const fields = JSON.parse(localStorage.getItem('customTrackingFields') || '[]').filter(f => f.id !== id);
        localStorage.setItem('customTrackingFields', JSON.stringify(fields));
      }
      localStorage.removeItem(`trackCustom_${id}`);
      if (_editFieldOverrides !== null) delete _editFieldOverrides[`trackCustom_${id}`];
      applyTrackingPrefs();
      renderFieldPickerList();
      syncTrackingPrefsToFirestore();
    }

    function closeDeleteCustomFieldModal() {
      document.getElementById('deleteCustomFieldModal').classList.remove('active');
      _pendingDeleteFieldId = null;
    }

    function selectCustomField(id, val) {
      if (selectedCustom[id] === val) {
        selectedCustom[id] = null;
      } else {
        selectedCustom[id] = val;
      }
      renderCustomTrackingRows();
    }

    function renderCustomTrackingRows() {
      const container = document.getElementById('customTrackingRows');
      if (!container) return;
      container.innerHTML = getCustomFields().map(f => {
        const cKey = `trackCustom_${f.id}`;
        const show = _editFieldOverrides !== null
          ? !!_editFieldOverrides[cKey]
          : localStorage.getItem(cKey) === 'true';
        if (!show) return '';
        const noSel = selectedCustom[f.id] === 'no';
        const yesSel = selectedCustom[f.id] === 'yes';
        const _posNo  = f.positive === 'no';
        const yesLabel = _posNo && f.emoji ? `${f.emoji} Yes` : 'Yes';
        const noBtn  = `<button type="button" class="medication-btn${noSel  ? ' selected' : ''}" onclick="selectCustomField('${f.id}','no')"  style="padding:10px 4px;flex:1;min-width:0;">No</button>`;
        const yesBtn = `<button type="button" class="medication-btn${yesSel ? ' selected' : ''}" ${_posNo ? 'data-neg="1"' : ''} onclick="selectCustomField('${f.id}','yes')" style="padding:10px 4px;flex:1;min-width:0;">${yesLabel}</button>`;
        return `<div style="display:contents">
          <span style="font-size:0.9em;font-weight:600;color:#495057;">${f.emoji ? f.emoji + ' ' : ''}${f.label}?</span>
          <div style="grid-column:span 3;display:flex;gap:8px;">${_posNo ? yesBtn + noBtn : noBtn + yesBtn}</div>
        </div>`;
      }).join('');
    }

    function closeFieldPicker() {
      _editingBuiltinKey = null;
      _editingFieldId = null;
      document.getElementById('fieldPickerModal').classList.remove('active');
      // If focused mode is active, rebuild steps so newly enabled/disabled fields appear immediately
      if (typeof _fmActive !== 'undefined' && _fmActive) {
        const _currentId = _fmSteps[_fmStepIndex] ? _fmSteps[_fmStepIndex].id : null;
        _fmSteps = _buildFocusedSteps();
        const _newIdx = _currentId ? _fmSteps.findIndex(s => s.id === _currentId) : -1;
        _fmStepIndex = _newIdx >= 0 ? _newIdx : Math.min(_fmStepIndex, _fmSteps.length - 1);
        _fmHighWater = Math.max(_fmHighWater, _fmStepIndex);
        _renderFocusedStep();
      }
    }

    function syncTrackingPrefsToFirestore() {
      if (!currentUser || !db) return;
      const prefs = {};
      FIELD_PICKER_FIELDS.forEach(f => {
        prefs[f.key] = localStorage.getItem(f.key) === 'true';
      });
      getCustomFields().forEach(f => {
        prefs[`trackCustom_${f.id}`] = localStorage.getItem(`trackCustom_${f.id}`) === 'true';
      });
      const labelOverrides = {};
      FIELD_PICKER_FIELDS.filter(f => f.renameable).forEach(f => {
        const v = localStorage.getItem('_labelOverride_' + f.key);
        if (v) labelOverrides[f.key] = v; else labelOverrides[f.key] = null;
      });
      db.collection('userSettings').doc(currentUser.uid).set(
        { trackingFields: prefs, customTrackingFields: getCustomFields(), labelOverrides }, { merge: true }
      ).catch(() => {});
    }

    window.showFieldPicker = showFieldPicker;
    window.toggleField = toggleField;
    window.addCustomField = addCustomField;
    window.deleteCustomField = deleteCustomField;
    window.selectCustomField = selectCustomField;
    window.closeFieldPicker = closeFieldPicker;
    window.toggleEmojiPicker = toggleEmojiPicker;
    window.selectPickerEmoji = selectPickerEmoji;
    window.editCustomField = editCustomField;
    window.saveCustomFieldEdit = saveCustomFieldEdit;
    window.cancelCustomFieldEdit = cancelCustomFieldEdit;
    window.toggleEditEmojiPicker = toggleEditEmojiPicker;
    window.selectEditPickerEmoji = selectEditPickerEmoji;
    window.confirmDeleteCustomField = confirmDeleteCustomField;
    window.closeDeleteCustomFieldModal = closeDeleteCustomFieldModal;

    function openAdvancedSettings() {
      const _advH = document.getElementById('advancedSettingsBadgeHint');
      if (_advH) _advH.style.display = 'none';
      applyTrackingPrefs();
      if (isNative()) {
        document.getElementById('settingsMainPanel').style.display = 'none';
        document.getElementById('settingsMobilePanel').style.display = '';
        _updateNativePinBtn();
      } else {
        document.getElementById('settingsMainPanel').style.display = 'none';
        document.getElementById('settingsAdvancedPanel').style.display = '';
      }
      const modal = document.querySelector('#settingsModal .confirm-content');
      if (modal) modal.scrollTop = 0;
    }
    function closeMobileSettings() {
      document.getElementById('settingsMobilePanel').style.display = 'none';
      document.getElementById('settingsMainPanel').style.display = '';
    }
    function _openFocusModeSettings() {
      applyTrackingPrefs();
      document.getElementById('settingsMobilePanel').style.display = 'none';
      document.getElementById('settingsAdvancedPanel').style.display = '';
      const modal = document.querySelector('#settingsModal .confirm-content');
      if (modal) modal.scrollTop = 0;
    }
    function closeAdvancedSettings() {
      document.getElementById('settingsAdvancedPanel').style.display = 'none';
      if (isNative()) {
        document.getElementById('settingsMobilePanel').style.display = '';
      } else {
        document.getElementById('settingsMainPanel').style.display = '';
        if (BB.storage.get('SettingsHintDone') === '1' && BB.storage.get('CustomiseFormHintDone') !== '1') {
          _showCustomiseFormHint();
        } else if (BB.storage.get('CustomiseAdditionalHintDone') === '1' && BB.storage.get('CloseSettingsHintDone') !== '1') {
          _showCloseSettingsHint();
        }
      }
    }
    window.openAdvancedSettings = openAdvancedSettings;
    window.closeMobileSettings = closeMobileSettings;
    window._openFocusModeSettings = _openFocusModeSettings;
    window.closeAdvancedSettings = closeAdvancedSettings;

    async function saveStatsStartDate() {
      const val = document.getElementById('statsStartDateInput').value;
      statsStartDate = val || null;
      if (statsStartDate) { localStorage.setItem('statsStartDate', statsStartDate); }
      else { localStorage.removeItem('statsStartDate'); }
      if (currentUser && db) {
        db.collection('userSettings').doc(currentUser.uid).set(
          { statsStartDate: statsStartDate || null }, { merge: true }
        ).catch(() => {});
      }
      if (_allEntries) displayStats(_allEntries);
      const btn = document.getElementById('statsStartDateInput').nextElementSibling.nextElementSibling;
      if (btn) { const orig = btn.textContent; btn.textContent = '✓ Saved'; setTimeout(() => { btn.textContent = orig; }, 1500); }
    }

    function clearStatsStartDate() {
      document.getElementById('statsStartDateInput').value = '';
    }

    window.saveStatsStartDate = saveStatsStartDate;
    window.clearStatsStartDate = clearStatsStartDate;

    async function showPersonalDetailsModal() {
      // For logged-in users, try to load from Firestore first
      if (currentUser && db) {
        try {
          const doc = await db.collection('personalDetails').doc(currentUser.uid).get();
          if (doc.exists) {
            const d = doc.data();
            const fields = ['personalName','personalDOB','personalMedicalNum','personalDiagnosis','personalDiagnosisDate','personalAddress','personalMobile','personalEmail','personalEmergencyContact','personalNotes'];
            // Only overwrite localStorage if the Firestore value is actually defined
            fields.forEach(k => { if (d[k] !== undefined) localStorage.setItem(k, d[k]); });
          }
        } catch(e) { console.warn('Could not load personal details from Firestore', e); }
      }
      // Load into form from localStorage
      document.getElementById('personalName').value = localStorage.getItem('personalName') || '';
      document.getElementById('personalDOB').value = localStorage.getItem('personalDOB') || '';
      document.getElementById('personalMedicalNum').value = localStorage.getItem('personalMedicalNum') || '';
      document.getElementById('personalDiagnosis').value = localStorage.getItem('personalDiagnosis') || '';
      document.getElementById('personalDiagnosisDate').value = localStorage.getItem('personalDiagnosisDate') || '';
      document.getElementById('personalAddress').value = localStorage.getItem('personalAddress') || '';
      document.getElementById('personalMobile').value = localStorage.getItem('personalMobile') || '';
      document.getElementById('personalEmail').value = localStorage.getItem('personalEmail') || '';
      document.getElementById('personalEmergencyContact').value = localStorage.getItem('personalEmergencyContact') || '';
      document.getElementById('personalNotes').value = localStorage.getItem('personalNotes') || '';
      document.getElementById('personalDetailsModal').classList.add('active');
    }

    function closePersonalDetailsModal() {
      document.getElementById('personalDetailsModal').classList.remove('active');
    }

    async function savePersonalDetails() {
      const fields = ['personalName','personalDOB','personalMedicalNum','personalDiagnosis','personalDiagnosisDate','personalAddress','personalMobile','personalEmail','personalEmergencyContact','personalNotes'];
      const data = {};
      fields.forEach(k => {
        const val = document.getElementById(k).value;
        localStorage.setItem(k, val);
        data[k] = val;
      });
      // Sync to Firestore for logged-in users so details persist across devices
      if (currentUser && db) {
        try {
          await db.collection('personalDetails').doc(currentUser.uid).set(data, { merge: true });
        } catch(e) { console.warn('Could not save personal details to Firestore', e); }
      }
      alert(BB.t('journal.dlg.personalDetailsSaved'));
      closePersonalDetailsModal();
    }


    // Persist reminder/weekly settings: localStorage + reschedule + Firestore (cross-device)
    async function _persistReminderSettings() {
      const timeEl = document.getElementById('reminderTime');
      const enabledEl = document.getElementById('reminderEnabled');
      const weeklyEl = document.getElementById('weeklySummaryEnabled');
      if (!timeEl || !enabledEl || !weeklyEl) return;
      const time = timeEl.value || '07:00';
      const enabled = enabledEl.checked;
      const weeklyEnabled = weeklyEl.checked;
      localStorage.setItem('reminderTime', time);
      localStorage.setItem('reminderEnabled', enabled.toString());
      localStorage.setItem('weeklySummaryEnabled', weeklyEnabled.toString());
      if (isNative()) {
        await scheduleReminder();
        const LocalNotifications = getPlugin('LocalNotifications');
        if (!weeklyEnabled) {
          if (LocalNotifications) await LocalNotifications.cancel({ notifications: [{ id: 2 }] }).catch(() => {});
        } else if (_allEntries) {
          scheduleWeeklySummary(_allEntries);
        }
      }
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ reminderEnabled: enabled, reminderTime: time, weeklySummaryEnabled: weeklyEnabled }, { merge: true })
          .catch(() => {});
      }
    }

    // Ensure iOS notification permission before turning a toggle on; reverts toggle if denied
    async function _ensureNotifPermission(toggleId) {
      if (!isNative()) return true;
      const LocalNotifications = getPlugin('LocalNotifications');
      if (!LocalNotifications) return true;
      try {
        let { display } = await LocalNotifications.checkPermissions();
        if (display === 'granted') {
          // OS permission is already granted, so requestPermissions() would
          // return silently without showing anything. That grant survives
          // account deletion (the OS never re-prompts and there's no API to
          // revoke it), so this in-app confirmation is the consent gate the
          // next user on the device actually sees before notifications resume.
          if (!confirm(BB.t('journal.dlg.turnOnNotifs'))) {
            const el = document.getElementById(toggleId);
            if (el) el.checked = false;
            return false;
          }
        } else {
          const r = await LocalNotifications.requestPermissions();
          display = r.display;
        }
        if (display !== 'granted') {
          const el = document.getElementById(toggleId);
          if (el) el.checked = false;
          alert(BB.t('journal.dlg.notifsBlocked'));
          // Refresh permission display in settings
          document.querySelectorAll('.settings-notif-info').forEach(el => el.textContent =
            `Notifications: ❌ Blocked in phone settings`);
          return false;
        }
        document.querySelectorAll('.settings-notif-info').forEach(el => el.textContent =
          `Notifications: ✅ Allowed`);
        return true;
      } catch (e) {
        return true; // best-effort: don't block on plugin errors
      }
    }

    /**
     * Reconcile the OS-permission-backed settings against what this device can
     * actually do, after they've been restored from Firestore.
     *
     * `reminderEnabled`, `weeklySummaryEnabled` and `healthSyncEnabled` sync
     * across devices, but the OS grants they depend on do not — they're granted
     * per install. Signing in on a new phone therefore restored "reminders on"
     * and "Health sync on" onto a device that had never been asked for either,
     * so the toggles read ON in Settings while nothing was ever scheduled and no
     * health data was ever imported.
     *
     * We deactivate rather than prompt. Raising the OS permission sheet on login
     * isn't a deliberate user action (and initNotifications' contract is that
     * startup NEVER prompts) — flipping the toggle back on is, and that path
     * already requests permission properly via _ensureNotifPermission /
     * _requestHealthAccessInteractive.
     *
     * Local-only: the Firestore values are left untouched, because the grant is
     * a property of this device, not of the account. The phone that does have
     * permission keeps its settings.
     *
     * @returns {Promise<{notifications: boolean, health: boolean}>} which
     *   settings were switched off on this device.
     */
    async function _reconcileNativePermissionSettings() {
      const _off = { notifications: false, health: false };
      if (!isNative()) return _off;

      // ── Notifications (daily reminder + weekly summary) ──
      try {
        const _wantsNotifs = localStorage.getItem('reminderEnabled') === 'true'
          || localStorage.getItem('weeklySummaryEnabled') === 'true';
        const LocalNotifications = getPlugin('LocalNotifications');
        if (_wantsNotifs && LocalNotifications) {
          const { display } = await LocalNotifications.checkPermissions();
          if (display !== 'granted') {
            localStorage.setItem('reminderEnabled', 'false');
            localStorage.setItem('weeklySummaryEnabled', 'false');
            // Drop anything a previous session managed to queue (ids 1 + 2).
            await LocalNotifications.cancel({ notifications: [{ id: 1 }, { id: 2 }] }).catch(() => {});
            const _rEl = document.getElementById('reminderEnabled');
            if (_rEl) _rEl.checked = false;
            const _wEl = document.getElementById('weeklySummaryEnabled');
            if (_wEl) _wEl.checked = false;
            _off.notifications = true;
          }
        }
      } catch (e) { console.warn('Notification permission reconcile failed:', e); }

      // ── Apple Health / Health Connect ──
      try {
        if (BB.storage.get('HealthSyncEnabled') === '1') {
          const Health = getPlugin('HealthPlugin');
          if (Health) {
            const { available } = await Health.isHealthAvailable();
            let _neverAsked = false;
            if (available) {
              const r = await Health.checkHealthPermissions({ permissions: ['READ_SLEEP', 'READ_STEPS'] });
              // Only "never asked" is a safe signal to act on. iOS deliberately
              // reports the SAME status for granted and denied read types (see
              // _refreshHealthAuthDisplay), so both flags being false is the one
              // state that unambiguously means this device was never asked.
              _neverAsked = !(r?.permissions?.READ_SLEEP || r?.permissions?.READ_STEPS);
            }
            if (!available || _neverAsked) {
              BB.storage.set('HealthSyncEnabled', '0');
              const _hEl = document.getElementById('healthSyncToggle');
              if (_hEl) _hEl.checked = false;
              _off.health = true;
            }
          }
        }
      } catch (e) { console.warn('Health permission reconcile failed:', e); }

      if (_off.notifications || _off.health) _showPermissionResetToast(_off);
      return _off;
    }
    window._reconcileNativePermissionSettings = _reconcileNativePermissionSettings;

    /**
     * One-off, non-blocking notice that a synced setting was switched off here
     * because this device hasn't granted the underlying OS permission. Silently
     * disabling a feature the user believes is on is worse than the original
     * bug, so tell them — and point at the toggle that will ask properly.
     */
    function _showPermissionResetToast(off) {
      const _what = off.notifications && off.health
        ? BB.t('journal.perm.resetBoth')
        : off.notifications ? BB.t('journal.perm.resetNotifs') : BB.t('journal.perm.resetHealth');
      const existing = document.getElementById('permResetToast');
      if (existing) existing.remove();
      const toast = document.createElement('div');
      toast.id = 'permResetToast';
      // _what is a translation-table string, not user data — safe for innerHTML.
      toast.innerHTML = `<div style="font-weight:700;font-size:0.9em;margin-bottom:3px;">${BB.t('journal.perm.resetTitle')}</div>`
        + `<div style="font-size:0.8em;line-height:1.4;color:rgba(255,255,255,0.9);">${_what}</div>`;
      Object.assign(toast.style, {
        position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%) translateY(10px)',
        background: 'linear-gradient(135deg,var(--brand-primary-mid),var(--brand-primary-light))', color: 'white',
        borderRadius: '16px', padding: '14px 20px', boxShadow: '0 8px 32px rgba(255,107,0,0.45)',
        textAlign: 'center', zIndex: '9999', minWidth: '240px', maxWidth: '300px',
        opacity: '0', transition: 'opacity 0.4s ease, transform 0.4s ease', cursor: 'pointer',
      });
      toast.addEventListener('click', () => {
        toast.remove();
        if (typeof showSettingsModal === 'function') showSettingsModal();
      });
      document.body.appendChild(toast);
      requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(-50%) translateY(0)'; });
      setTimeout(() => {
        toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(10px)';
        setTimeout(() => toast.remove(), 400);
      }, 6000);
    }

    async function _onReminderToggleChange() {
      if (document.getElementById('reminderEnabled').checked) {
        if (!(await _ensureNotifPermission('reminderEnabled'))) return;
      }
      await _persistReminderSettings();
    }

    async function _onWeeklyToggleChange() {
      if (document.getElementById('weeklySummaryEnabled').checked) {
        if (!(await _ensureNotifPermission('weeklySummaryEnabled'))) return;
      }
      await _persistReminderSettings();
    }

    window._persistReminderSettings = _persistReminderSettings;
    window._onReminderToggleChange = _onReminderToggleChange;
    window._onWeeklyToggleChange = _onWeeklyToggleChange;

    async function saveSettings() {
      // Dismiss close settings hint if active
      if (BB.storage.get('CloseSettingsHintDone') !== '1' && BB.storage.get('CustomiseAdditionalHintDone') === '1') {
        _dismissCloseSettingsHint();
      }
      // Reminder/weekly toggles auto-save on change via _persistReminderSettings —
      // no need to re-write them here.

      // Save incognito mode + auto-advance
      const _incogVal = document.getElementById('incognitoModeToggle').checked;
      localStorage.setItem('incognitoMode', _incogVal ? 'true' : 'false');
      _refreshRecentMoods();
      const _csVal = document.getElementById('fmConfirmStepToggle').checked;
      localStorage.setItem('fmConfirmStep', _csVal ? 'true' : 'false');
      if (window.db && window.currentUser) {
        window.db.collection('userSettings').doc(window.currentUser.uid)
          .set({ incognitoMode: _incogVal, fmConfirmStep: _csVal, moreDataOpenByDefault: _mddVal, focusedModeEnabled: _fmEnabled }, { merge: true }).catch(() => {});
      }

      closeSettingsModal();
    }

    window.saveAndOpenJournal = saveAndOpenJournal;
    window.toggleJournal = toggleJournal;
    window.showMedicationList = showMedicationList;
    window.closeMedicationModal = closeMedicationModal;
    window.addMedication = addMedication;
    window.deleteMedication = deleteMedication;
    window.openEditModal = openEditModal;
    window.openEditInForm = openEditInForm;
    window.closeEditModal = closeEditModal;
    window.saveEditedEntry = saveEditedEntry;
    window.showGoalsList = showGoalsList;
    window.closeGoalsModal = closeGoalsModal;
    window.addGoal = addGoal;
    window.deleteGoal = deleteGoal;
    window.editGoal = editGoal;
    window.closeConfirmModal = closeConfirmModal;
    window.confirmDelete = confirmDelete;
    window.changePage = changePage;
    window.showImportModal = showImportModal;
    window.closeImportModal = closeImportModal;
    window.selectImportFormat = selectImportFormat;
    window.importBipolarBearData = importBipolarBearData;
    window.importDaylioData = importDaylioData;
    window.confirmDeleteAll = confirmDeleteAll;
    window.deleteAllEntries = deleteAllEntries;
    window.showMissingDates = showMissingDates;

    // ── Quick notes: dismiss a single note by id ──
    function _dismissQuickNote(id) {
      try {
        const _notes = JSON.parse(BB.storage.get('QuickNotes') || '[]');
        const _filtered = _notes.filter(n => n.id !== id);
        BB.storage.set('QuickNotes', JSON.stringify(_filtered));
      } catch(_) {}
      _renderFocusedStep();
    }
    window._dismissQuickNote = _dismissQuickNote;
    window.closeMissingDatesModal = closeMissingDatesModal;
    window.setDateAndClose = setDateAndClose;
    window.showSettingsModal = showSettingsModal;
    window.closeSettingsModal = closeSettingsModal;
    window.showPersonalDetailsModal = showPersonalDetailsModal;
    window.closePersonalDetailsModal = closePersonalDetailsModal;
    function _dismissPersonalDetailsHint() {
      if (BB.storage.get('PersonalHintDone') === '1') return;
      BB.storage.set('PersonalHintDone', '1');
      document.getElementById('personalDetailsJournalHint')?.remove();
      if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined' && db) {
        db.collection('userSettings').doc(currentUser.uid).set({ personalHintDone: true }, { merge: true }).catch(() => {});
      }
    }
    window._dismissPersonalDetailsHint = _dismissPersonalDetailsHint;

    function _dismissMedHint() {
      if (BB.storage.get('MedHintDone') === '1') return;
      BB.storage.set('MedHintDone', '1');
      document.getElementById('medHintEl')?.remove();
      const _mb = document.getElementById('manageMedsBtn');
      if (_mb) _mb.style.color = 'var(--brand-primary)';
      _applyJournalOnboardingGating();
    }
    window._dismissMedHint = _dismissMedHint;

    function _dismissSettingsHint() {
      if (BB.storage.get('SettingsHintDone') === '1') return;
      BB.storage.set('SettingsHintDone', '1');
      const h = document.getElementById('settingsHint');
      if (h) h.style.display = 'none';
      _applyJournalOnboardingGating();
    }
    window._dismissSettingsHint = _dismissSettingsHint;

    function _updateAdvancedBadge() {
      const _visible = BB.storage.get('AdvancedBadgeVisible') === '1';
      const _badge = document.getElementById('settingsAdvancedBadge');
      if (_badge) _badge.style.display = _visible ? '' : 'none';
    }
    window._updateAdvancedBadge = _updateAdvancedBadge;

    function _showCustomiseFormHint() {
      const _hel = document.getElementById('customiseFormHintEl');
      if (_hel) _hel.style.display = 'flex';
      const _ao = document.getElementById('bbHintOverlay');
      if (_ao) _ao.style.display = '';
      const _amo = document.getElementById('advancedHintOverlay');
      if (_amo) _amo.style.display = '';
      const _sm = document.getElementById('settingsModal');
      if (_sm) _sm.dataset.customiseHintActive = '1';
      const _cw = document.getElementById('customiseFormWrap');
      if (_cw) { _cw.style.zIndex = '11'; _cw.style.background = 'white'; _cw.style.borderRadius = '10px'; _cw.style.padding = '10px'; _cw.style.margin = '-10px'; }
    }
    function _dismissCustomiseFormHint() {
      BB.storage.set('CustomiseFormHintDone', '1');
      const _hel = document.getElementById('customiseFormHintEl');
      if (_hel) _hel.style.display = 'none';
      const _ao = document.getElementById('bbHintOverlay');
      if (_ao) _ao.style.display = 'none';
      const _amo = document.getElementById('advancedHintOverlay');
      if (_amo) _amo.style.display = 'none';
      const _sm = document.getElementById('settingsModal');
      if (_sm) delete _sm.dataset.customiseHintActive;
      const _cw = document.getElementById('customiseFormWrap');
      if (_cw) { _cw.style.zIndex = ''; _cw.style.background = ''; _cw.style.borderRadius = ''; _cw.style.padding = ''; _cw.style.margin = ''; _cw.style.marginBottom = '16px'; }
    }
    function _showCustomiseAdditionalHint() {
      const _ao = document.getElementById('bbHintOverlay');
      if (_ao) _ao.style.display = '';
      const _amo = document.getElementById('advancedHintOverlay');
      if (_amo) _amo.style.display = '';
      const _sm = document.getElementById('settingsModal');
      if (_sm) _sm.dataset.customiseAdditionalHintActive = '1';
      const _cw = document.getElementById('customiseFormWrap');
      if (_cw) { _cw.style.zIndex = '11'; _cw.style.background = 'white'; _cw.style.borderRadius = '10px'; _cw.style.padding = '10px'; _cw.style.margin = '-10px'; }
      // Re-render toggles so the Additional button gets its pulse highlight and others are dimmed
      _renderStepToggles();
    }
    function _dismissCustomiseAdditionalHint() {
      BB.storage.set('CustomiseAdditionalHintDone', '1');
      const _ao = document.getElementById('bbHintOverlay');
      if (_ao) _ao.style.display = 'none';
      const _amo = document.getElementById('advancedHintOverlay');
      if (_amo) _amo.style.display = 'none';
      const _sm = document.getElementById('settingsModal');
      if (_sm) delete _sm.dataset.customiseAdditionalHintActive;
      const _cw = document.getElementById('customiseFormWrap');
      if (_cw) { _cw.style.zIndex = ''; _cw.style.background = ''; _cw.style.borderRadius = ''; _cw.style.padding = ''; _cw.style.margin = ''; _cw.style.marginBottom = '16px'; }
      // Re-render toggles to remove pulse/dim
      _renderStepToggles();
      // Show close settings hint next
      _showCloseSettingsHint();
    }
    function _showCloseSettingsHint() {
      if (!document.getElementById('settingsCloseBtn')) { _dismissCloseSettingsHint(); return; }
      const _hel = document.getElementById('closeSettingsHintEl');
      if (_hel) _hel.style.display = 'flex';
      const _ao = document.getElementById('bbHintOverlay');
      if (_ao) _ao.style.display = '';
      const _amo = document.getElementById('advancedHintOverlay');
      if (_amo) _amo.style.display = '';
      const _sm = document.getElementById('settingsModal');
      if (_sm) _sm.dataset.closeSettingsHintActive = '1';
      const _cb = document.getElementById('settingsCloseBtn');
      if (_cb) _cb.style.zIndex = '11';
      if (_hel) _hel.style.zIndex = '11';
    }
    function _dismissCloseSettingsHint() {
      BB.storage.set('CloseSettingsHintDone', '1');
      const _hel = document.getElementById('closeSettingsHintEl');
      if (_hel) { _hel.style.display = 'none'; _hel.style.zIndex = ''; }
      const _ao = document.getElementById('bbHintOverlay');
      if (_ao) _ao.style.display = 'none';
      const _amo = document.getElementById('advancedHintOverlay');
      if (_amo) _amo.style.display = 'none';
      const _sm = document.getElementById('settingsModal');
      if (_sm) delete _sm.dataset.closeSettingsHintActive;
      const _cb = document.getElementById('settingsCloseBtn');
      if (_cb) _cb.style.zIndex = '';
      // Show tutorial complete toast and queue advanced badge + tap-hold hint for next entry
      if (BB.storage.get('AdvancedTutorialToastShown') !== '1') {
        BB.storage.set('AdvancedTutorialToastShown', '1');
        BB.storage.set('AdvancedBadgePending', '1');
        BB.storage.set('_fmTapHoldHintPending', '1'); // activates tap & hold hint on the NEXT entry
        setTimeout(() => _showFeatureHint('🎉', BB.t('journal.hint.tutorialDone'), '_bbAdvancedTutorialToast'), 400);
      }
    }

    // ── Customise form hint page lock ──
    (function() {
      document.addEventListener('click', function(e) {
        if (BB.storage.get('CustomiseFormHintDone') === '1') return;
        if (BB.storage.get('SettingsHintDone') !== '1') return;
        const modal = document.getElementById('settingsModal');
        if (!modal || !modal.classList.contains('active')) return;
        const tog = document.getElementById('customiseFormToggle');
        if (!tog) return;
        // Allow only: customise form toggle (and its label)
        if (tog === e.target || tog.contains(e.target) || e.target.closest('label') === tog.closest('label')) return;
        e.stopPropagation(); e.preventDefault();
        const hint = document.getElementById('customiseFormHintEl');
        const wrap = document.getElementById('customiseFormWrap');
        [hint, wrap].forEach(el => {
          if (!el) return;
          const prev = el.style.animation;
          el.style.animation = 'none'; el.offsetHeight;
          el.style.animation = 'bbHintNudge 0.5s ease';
          setTimeout(() => { el.style.animation = prev; }, 520);
        });
      }, true);
    })();

    // ── Customise additional hint page lock ──
    (function() {
      document.addEventListener('click', function(e) {
        if (BB.storage.get('CustomiseAdditionalHintDone') === '1') return;
        if (BB.storage.get('CustomiseFormHintDone') !== '1') return;
        const modal = document.getElementById('settingsModal');
        if (!modal || !modal.classList.contains('active')) return;
        const addBtn = document.getElementById('stepToggleMoreData');
        if (!addBtn) return;
        // Allow only: Additional (➕) button
        if (addBtn === e.target || addBtn.contains(e.target)) return;
        e.stopPropagation(); e.preventDefault();
        // Nudge the Additional button itself (it IS the hint now)
        const prev = addBtn.style.animation;
        addBtn.style.animation = 'none'; addBtn.offsetHeight;
        addBtn.style.animation = 'bbHintNudge 0.5s ease';
        setTimeout(() => { addBtn.style.animation = prev; }, 520);
      }, true);
    })();

    // ── Close settings hint page lock ──
    (function() {
      document.addEventListener('click', function(e) {
        if (BB.storage.get('CloseSettingsHintDone') === '1') return;
        if (BB.storage.get('CustomiseAdditionalHintDone') !== '1') return;
        const modal = document.getElementById('settingsModal');
        if (!modal || !modal.classList.contains('active')) return;
        const closeBtn = document.getElementById('settingsCloseBtn');
        if (!closeBtn) return;
        if (closeBtn === e.target || closeBtn.contains(e.target)) return;
        e.stopPropagation(); e.preventDefault();
        const hint = document.getElementById('closeSettingsHintEl');
        [hint, closeBtn].forEach(el => {
          if (!el) return;
          const prev = el.style.animation;
          el.style.animation = 'none'; el.offsetHeight;
          el.style.animation = 'bbHintNudge 0.5s ease';
          setTimeout(() => { el.style.animation = prev; }, 520);
        });
      }, true);
    })();

    // ── Med hint page lock (independent of onboarding step) ──
    (function() {
      document.addEventListener('click', function(e) {
        if (BB.storage.get('MedHintDone') === '1') return;
        const hint = document.getElementById('medHintEl');
        if (!hint) return;
        const btn = document.getElementById('manageMedsBtn');
        if (!btn || btn === e.target || btn.contains(e.target)) return;
        if (document.querySelector('.confirm-modal.active, .overlay-modal.active')) return;
        e.stopPropagation(); e.preventDefault();
        [hint, btn].forEach(el => {
          const prev = el.style.animation;
          el.style.animation = 'none'; el.offsetHeight;
          el.style.animation = 'bbHintNudge 0.5s ease';
          setTimeout(() => { el.style.animation = prev; }, 520);
        });
      }, true);
    })();
    // ── Mood info close hint page lock ──
    (function() {
      document.addEventListener('click', function(e) {
        if (BB.storage.get('_fmMoodInfoCloseHintDone') === '1') return;
        const modal = document.getElementById('moodInfoModal');
        if (!modal || !modal.classList.contains('active') || !modal.dataset.closeHintActive) return;
        const closeBtn = modal.querySelector('.confirm-btn-no');
        if (!closeBtn) return;
        if (closeBtn === e.target || closeBtn.contains(e.target)) return;
        e.stopPropagation(); e.preventDefault();
        const hint = document.getElementById('_fmMoodInfoCloseHintEl');
        [hint, closeBtn].forEach(el => {
          if (!el) return;
          const prev = el.style.animation;
          el.style.animation = 'none'; el.offsetHeight;
          el.style.animation = 'bbHintNudge 0.5s ease';
          setTimeout(() => { el.style.animation = prev; }, 520);
        });
      }, true);
    })();

    window.savePersonalDetails = savePersonalDetails;
    window.saveSettings = saveSettings;

    // Initialize date picker on page load
    setDefaultDate();
    _updateAdvancedBadge();

    // Note: loadEntries is called by auth.onAuthStateChanged when user logs in

// ── BLOCK 3: secondary helpers (statsRecompute, helpers used by BLOCK 2) ──
// window.isNative / window.isIOS / window.isAndroid are provided by
    // js/shared/platform.js (loaded once in <head>) and are available across
    // every <script> block in this page.

    // ── Helper: safe plugin getter ──
    function getPlugin(name) {
      try { return window.Capacitor?.Plugins?.[name] || null; }
      catch { return null; }
    }

    // ────────────────────────────────────────────
    // 1. STATUS BAR – match the orange theme
    // ────────────────────────────────────────────
    async function initStatusBar() {
      const StatusBar = getPlugin('StatusBar');
      if (!StatusBar) return;
      try {
        await StatusBar.setBackgroundColor({ color: 'var(--brand-primary)' });
        await StatusBar.setStyle({ style: 'DARK' }); // dark icons on orange bg
        await StatusBar.setOverlaysWebView({ overlay: false });
        console.log('✅ StatusBar configured');
      } catch (e) { console.warn('StatusBar error:', e); }
    }

    // ────────────────────────────────────────────
    // 2. SPLASH SCREEN – hide after app loads
    // ────────────────────────────────────────────
    async function hideSplashScreen() {
      const SplashScreen = getPlugin('SplashScreen');
      if (!SplashScreen) return;
      try {
        await SplashScreen.hide({ fadeOutDuration: 500 });
        console.log('✅ SplashScreen hidden');
      } catch (e) { console.warn('SplashScreen error:', e); }
    }

    // ────────────────────────────────────────────
    // 3. HAPTIC FEEDBACK
    //    Call nativeHaptic() from anywhere in the app
    // ────────────────────────────────────────────
    async function nativeHaptic(type = 'medium') {
      const Haptics = getPlugin('Haptics');
      if (!Haptics) return; // silently skip on web
      try {
        if (type === 'success') {
          await Haptics.notification({ type: 'SUCCESS' });
        } else if (type === 'error') {
          await Haptics.notification({ type: 'ERROR' });
        } else if (type === 'light') {
          await Haptics.impact({ style: 'LIGHT' });
        } else {
          await Haptics.impact({ style: 'MEDIUM' });
        }
      } catch (e) { console.warn('Haptics error:', e); }
    }

    // ────────────────────────────────────────────
    // 4. LOCAL NOTIFICATIONS – daily mood reminder
    // ────────────────────────────────────────────
    async function initNotifications() {
      const LocalNotifications = getPlugin('LocalNotifications');
      if (!LocalNotifications) return;
      try {
        // Register the anniversary-tap listener UNCONDITIONALLY — it needs no
        // permission (only fires when a delivered notification is tapped) and
        // must keep working regardless of the current grant state.
        LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
          const id = action.notification.id;
          if (id >= 10000) {
            const month = Math.floor((id - 10000) / 100);
            const day = (id - 10000) % 100;
            if (month > 0 && day > 0) showFavAnniversaryModal(month, day);
          }
        });

        // NEVER prompt at startup. Use the non-prompting checkPermissions() to
        // inspect the existing grant only. The OS notification prompt is raised
        // solely by the reminder/weekly toggles (_ensureNotifPermission), on a
        // deliberate user action — so it can no longer surface during onboarding.
        const { display } = await LocalNotifications.checkPermissions();
        if (display === 'granted') {
          // Already opted in on a previous launch — reschedule. scheduleReminder()
          // itself no-ops unless reminderEnabled === 'true'.
          await scheduleReminder();
        }
      } catch (e) { console.warn('Notifications error:', e); }
    }

    async function scheduleReminder() {
      const LocalNotifications = getPlugin('LocalNotifications');
      if (!LocalNotifications) return;

      try {
        // Cancel only the daily reminder (ID 1), not the weekly summary (ID 2)
        const pending = await LocalNotifications.getPending();
        const toCancel = pending.notifications.filter(n => n.id === 1);
        if (toCancel.length > 0) {
          await LocalNotifications.cancel({ notifications: toCancel });
        }

        // Check if reminders are enabled — default is OFF (must opt in)
        const enabled = localStorage.getItem('reminderEnabled') === 'true';
        if (!enabled) {
          console.log('Reminders disabled by user');
          return;
        }

        // Get saved time or default to 20:00
        const savedTime = localStorage.getItem('reminderTime') || '07:00';
        const [hour, minute] = savedTime.split(':').map(Number);

        await LocalNotifications.schedule({
          notifications: [{
            id: 1,
            title: '🐻 BipolarBear',
            body: "Don't forget to log your mood today!",
            schedule: {
              on: { hour, minute },
              repeats: true,
              allowWhileIdle: true
            },
            sound: 'default',
            smallIcon: 'ic_notification',
            iconColor: 'var(--brand-primary)'
          }]
        });

        console.log(`✅ Daily reminder scheduled for ${savedTime}`);
      } catch (e) { console.warn('Schedule reminder error:', e); }
    }

    async function scheduleWeeklySummary(entries) {
      const LocalNotifications = getPlugin('LocalNotifications');
      if (!LocalNotifications) return;
      if (localStorage.getItem('weeklySummaryEnabled') === 'false') return;

      try {
        // Cancel any existing weekly summary (ID 2)
        const pending = await LocalNotifications.getPending();
        const toCancel = pending.notifications.filter(n => n.id === 2);
        if (toCancel.length > 0) await LocalNotifications.cancel({ notifications: toCancel });

        // Compute stats for the 7 full days that are complete before the
        // notification fires. We end the window at the day before yesterday
        // (today - 2): the notification day hasn't been logged yet, and
        // yesterday is commonly logged retroactively the next day, so neither
        // is reliably filled in. Counting only up to day-before-yesterday
        // avoids a misleading "6/7" for an entry that couldn't exist yet.
        const today = new Date(); today.setHours(0,0,0,0);
        const windowEnd = new Date(today); windowEnd.setDate(today.getDate() - 2);
        const windowStart = new Date(windowEnd); windowStart.setDate(windowEnd.getDate() - 6);
        const last7 = entries.filter(e => {
          const d = new Date(e.date); d.setHours(0,0,0,0);
          return d >= windowStart && d <= windowEnd;
        });

        const entryCount = last7.length;
        const medsTaken = last7.filter(e => !e.medication || e.medication === 'taken').length;
        // Always a positive emoji — a weekly nudge should never read as a
        // telling-off. Party only for a full 7/7, a plain smile otherwise.
        const summaryEmoji = entryCount >= 7 ? '🎉' : '🙂';

        const body = entryCount === 0
          ? "No entries this week — open the app to start tracking your mood!"
          : `${entryCount}/7 days logged ${summaryEmoji} · Meds taken ${medsTaken}/${entryCount} days`;

        await LocalNotifications.schedule({
          notifications: [{
            id: 2,
            title: '🐻 Your weekly summary',
            body,
            schedule: {
              on: { weekday: 1, hour: 9, minute: 0 }, // Sunday 9am
              repeats: true,
              allowWhileIdle: true
            },
            smallIcon: 'ic_notification',
            iconColor: 'var(--brand-primary)'
          }]
        });
      } catch (e) { console.warn('Weekly summary schedule error:', e); }
    }
    window.scheduleWeeklySummary = scheduleWeeklySummary;

    async function _scheduleAnniversaryNotif(month, day) {
      const LocalNotifications = getPlugin('LocalNotifications');
      if (!LocalNotifications) return;
      try {
        const id = 10000 + month * 100 + day;
        await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => {});
        const now = new Date();
        let year = now.getFullYear() + 1;
        const schedDate = new Date(year, month - 1, day, 10, 0, 0);
        if (schedDate <= now) schedDate.setFullYear(year + 1);
        const favCount = (_allEntries || []).filter(e => {
          if (!e.favourite) return false;
          const d = new Date(e.date);
          return d.getMonth() + 1 === month && d.getDate() === day;
        }).length;
        await LocalNotifications.schedule({
          notifications: [{
            id,
            title: '⭐ BipolarBear · On this day',
            body: `You have ${favCount} favourite entr${favCount === 1 ? 'y' : 'ies'} from this date — want to review them?`,
            schedule: { at: schedDate, allowWhileIdle: true },
            smallIcon: 'ic_notification',
            iconColor: 'var(--brand-primary)',
            extra: { anniversaryMonth: month, anniversaryDay: day }
          }]
        });
        console.log(`⭐ Anniversary notification scheduled for ${schedDate.toDateString()}`);
      } catch (e) { console.warn('Anniversary notif schedule error:', e); }
    }
    window._scheduleAnniversaryNotif = _scheduleAnniversaryNotif;

    // ────────────────────────────────────────────
    // 5. BACK BUTTON (Android) – close modals first
    // ────────────────────────────────────────────
    function initAndroidBackButton() {
      const App = getPlugin('App');
      if (!App || !isAndroid()) return;

      App.addListener('backButton', () => {
        // Close any open modal first, otherwise let OS handle it
        const openModal = document.querySelector('.confirm-modal.active');
        if (openModal) {
          openModal.classList.remove('active');
        } else {
          // If journal is open, close it
          const journal = document.getElementById('journalSection');
          if (journal && journal.style.display !== 'none') {
            toggleJournal();
          } else {
            // Otherwise go back to the home screen rather than exiting the app
            // (mirrors the "← Home" link, including the onboarding advance).
            if (typeof _advanceOnboardingStep === 'function') _advanceOnboardingStep(4);
            location.replace('index.html');
          }
        }
      });

      console.log('✅ Android back button handler set');
    }

    // ────────────────────────────────────────────
    // 6. KEYBOARD – scroll to focused input
    // ────────────────────────────────────────────
    function initKeyboardHandling() {
      const Keyboard = getPlugin('Keyboard');
      if (!Keyboard) return;

      Keyboard.addListener('keyboardWillShow', ({ keyboardHeight }) => {
        document.body.style.paddingBottom = `${keyboardHeight}px`;
      });

      Keyboard.addListener('keyboardWillHide', () => {
        document.body.style.paddingBottom = '';
      });

      console.log('✅ Keyboard handling set');
    }

    // ────────────────────────────────────────────
    // 7. APP STATE – refresh when returning to app
    // ────────────────────────────────────────────
    let skipNextResume = false; // set during health sync to prevent spurious reload

    function initAppStateListener() {
      const App = getPlugin('App');
      if (!App) return;

      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          if (skipNextResume || window._healthSyncInProgress) {
            skipNextResume = false;
            console.log('App resumed during health sync — skipping reload');
            return;
          }
          // Don't reload if user is mid-entry, editing, the form is open, or focused mode is active
          const _formCard = document.getElementById('entryFormCard');
          if (selectedMood || editingEntry || (_formCard && _formCard.style.display !== 'none') || (typeof _fmActive !== 'undefined' && _fmActive)) {
            console.log('App resumed — form in use, skipping reload');
            return;
          }
          console.log('App resumed - refreshing entries');
          if (typeof loadEntries === 'function') loadEntries();
        }
      });

      console.log('✅ App state listener set');
    }

    // ────────────────────────────────────────────
    // ────────────────────────────────────────────
    // SLEEP IMPORT FROM APPLE HEALTH / HEALTH CONNECT
    // ────────────────────────────────────────────
    function confirmSleepSync() {
      const native = isNative();
      document.getElementById('sleepSyncNative').style.display = native ? '' : 'none';
      document.getElementById('sleepSyncWeb').style.display = native ? 'none' : '';
      document.getElementById('sleepSyncModal').classList.add('active');
    }
    function closeSleepSyncModal() {
      document.getElementById('sleepSyncModal').classList.remove('active');
    }
    async function doSleepOnlySync() {
      window._healthSyncInProgress = true;
      closeSleepSyncModal();
      try {
        await importSleepFromHealth();
      } finally {
        setTimeout(() => { window._healthSyncInProgress = false; }, 800);
      }
    }
    async function doSleepSync() {
      window._healthSyncInProgress = true; // set synchronously before any await so ghost clicks are blocked immediately
      closeSleepSyncModal();
      try {
        await importSleepFromHealth();
        setTimeout(() => backfillStepsFromHealth(), 3000); // delay avoids double HealthKit hit on first-ever permission grant
      } finally {
        setTimeout(() => { window._healthSyncInProgress = false; }, 800);
      }
    }
    window.confirmSleepSync = confirmSleepSync;
    window.closeSleepSyncModal = closeSleepSyncModal;
    window.doSleepOnlySync = doSleepOnlySync;
    window.doSleepSync = doSleepSync;

    function confirmEnergySync() {
      const native = isNative();
      document.getElementById('energySyncNative').style.display = native ? '' : 'none';
      document.getElementById('energySyncWeb').style.display = native ? 'none' : '';
      document.getElementById('energySyncModal').classList.add('active');
    }
    function closeEnergySyncModal() {
      document.getElementById('energySyncModal').classList.remove('active');
    }
    async function doStepsOnlySync() {
      window._healthSyncInProgress = true;
      closeEnergySyncModal();
      try {
        await importStepsFromHealth();
        setTimeout(() => backfillStepsFromHealth(), 3000); // delay avoids double HealthKit hit on first-ever permission grant
      } finally {
        setTimeout(() => { window._healthSyncInProgress = false; }, 800);
      }
    }
    async function doStepsAndSleepSync() {
      window._healthSyncInProgress = true;
      closeEnergySyncModal();
      try {
        await importSleepFromHealth();
        await importStepsFromHealth();
        setTimeout(() => backfillStepsFromHealth(), 3000);
      } finally {
        setTimeout(() => { window._healthSyncInProgress = false; }, 800);
      }
    }
    async function importStepsFromHealth(isAuto) {
      const btnText = document.getElementById('healthEnergyBtnText');
      const originalText = btnText ? btnText.textContent : '⚡ Energy Level';
      function showFail()   { if (btnText) { btnText.textContent = '❌';   setTimeout(() => { btnText.textContent = originalText; }, 2000); } }
      function showNoData() { if (btnText) { btnText.textContent = '🤷‍♀️'; setTimeout(() => { btnText.textContent = originalText; }, 2000); } }

      const Health = getPlugin('HealthPlugin');
      if (!Health) { showFail(); return; }

      if (btnText) btnText.textContent = '…';

      try {
        const { available } = await Health.isHealthAvailable();
        if (!available) { showFail(); return; }

        if (isAuto) {
          // Auto-sync (mood tap / focused-mode step): never raise the OS sheet
          // from ordinary navigation. Only proceed if access is already granted;
          // otherwise leave requesting to a deliberate tap (toggle / Import button).
          try {
            const _ck = await Health.checkHealthPermissions({ permissions: ['READ_STEPS'] });
            if (!_ck?.permissions?.READ_STEPS) { if (btnText) btnText.textContent = originalText; return; }
          } catch (e) { if (btnText) btnText.textContent = originalText; return; }
        } else {
          skipNextResume = true;
          await Health.requestHealthPermissions({ permissions: ['READ_STEPS'] });
          skipNextResume = false;
          if (document.getElementById('settingsModal')?.classList.contains('active')) {
            _refreshHealthAuthDisplay().catch(() => {});
          }
        }

        const _dateVal = document.getElementById('entryDate')?.value;
        if (!_dateVal) { showFail(); return; }

        const _targetDate = new Date(_dateVal + 'T00:00:00');
        const _nextDay = new Date(_targetDate.getTime());
        _nextDay.setDate(_nextDay.getDate() + 1);

        const result = await Health.queryAggregated({
          dataType: 'steps',
          startDate: _targetDate.toISOString(),
          endDate:   _nextDay.toISOString(),
          bucket:    'day'
        });

        if (!result?.aggregatedData?.length) { showNoData(); return; }
        const s = Math.round(result.aggregatedData[0].value);
        if (!s || s <= 0) { showNoData(); return; }

        if (!window._healthStepsByDate) window._healthStepsByDate = {};
        window._healthStepsByDate[_dateVal] = s;

        const stepsEl = document.getElementById('healthStepsResult');
        if (stepsEl) {
          stepsEl.textContent = `🏃 ${s >= 1000 ? Math.round(s / 1000) + 'k' : s} steps`;
          stepsEl.style.display = '';
        }
        nativeHaptic('success');
        if (btnText) {
          const stepsLabel = s >= 1000 ? Math.round(s / 1000) + 'k' : s;
          btnText.textContent = `⚡ Energy | 🏃 ${stepsLabel}`;
        }
        _fmStepsRaw = s;
        // Update focused mode if active
        if (_fmActive) {
          const stepsLabel = s >= 1000 ? Math.round(s / 1000) + 'k' : String(s);
          _fmStepsResult = stepsLabel;
          if (editingEntry) editingEntry.steps = s;
          _fmEnergySuggestion = _energyFromSteps(s);
          // Pre-select the suggested energy without auto-advancing
          selectedEnergy = _fmEnergySuggestion;
          _fmEnergyClear = false;
          _fmMaybeSuggestMood();
          _renderFocusedStep();
        } else {
          // Non-focused: highlight the suggested energy button
          const _sugEn = _energyFromSteps(s);
          document.querySelectorAll('.energy-btn').forEach(b => {
            const isSugg = parseFloat(b.dataset.energy) === _sugEn;
            const isSel  = b.classList.contains('selected');
            if (isSugg && !isSel) {
              // Pre-select it
              document.querySelectorAll('.energy-btn').forEach(eb => {
                eb.classList.remove('selected');
                eb.style.background = '#f8f9fa';
                eb.style.color = '#495057';
              });
              b.classList.add('selected');
              b.style.background = b.dataset.color || getEnergyColor(_sugEn);
              b.style.color = 'white';
              selectedEnergy = _sugEn;
            }
          });
          _updateEnergyHero();
        }
      } catch(e) {
        console.warn('Steps import failed:', e);
        showFail();
      }
    }
    window.confirmEnergySync = confirmEnergySync;
    window.closeEnergySyncModal = closeEnergySyncModal;
    window.doStepsOnlySync = doStepsOnlySync;
    window.doStepsAndSleepSync = doStepsAndSleepSync;
    window.importStepsFromHealth = importStepsFromHealth;

    async function importSleepFromHealth(isAuto) {
      // Don't pull sleep for an entry whose night hasn't happened yet (today/future).
      if (typeof _sleepNotYet === 'function' && _sleepNotYet()) return;
      const btn = document.getElementById('healthSleepBtn');
      const originalText = btn.textContent;

      function showFail() {
        btn.textContent = '❌';
        btn.disabled = false;
        setTimeout(() => { btn.textContent = originalText; }, 2000);
        if (typeof _fmActive !== 'undefined' && _fmActive) {
          _fmSleepAutoSyncDone = true; // prevent re-triggering auto-sync on re-render
          _fmSleepError = 'fail'; _renderFocusedStep();
          setTimeout(() => { _fmSleepError = null; _renderFocusedStep(); }, 2500);
        }
      }
      function showNoData() {
        btn.textContent = '🤷‍♀️';
        btn.disabled = false;
        setTimeout(() => { btn.textContent = originalText; }, 2000);
        if (typeof _fmActive !== 'undefined' && _fmActive) {
          _fmSleepAutoSyncDone = true; // prevent re-triggering auto-sync on re-render
          _fmSleepError = 'nodata'; _renderFocusedStep();
          setTimeout(() => { _fmSleepError = null; _renderFocusedStep(); }, 2500);
        }
      }

      const Health = getPlugin('HealthPlugin');
      if (!Health) { showFail(); return; }

      btn.textContent = '…';
      btn.disabled = true;
      try {
        const { available } = await Health.isHealthAvailable();
        if (!available) { showFail(); return; }

        if (isAuto) {
          // Auto-sync (mood tap / focused-mode step): never raise the OS sheet
          // from ordinary navigation. Only proceed if sleep access is already
          // granted; otherwise leave requesting to a deliberate tap.
          try {
            const _ck = await Health.checkHealthPermissions({ permissions: ['READ_SLEEP'] });
            if (!_ck?.permissions?.READ_SLEEP) { btn.textContent = originalText; btn.disabled = false; return; }
          } catch (e) { btn.textContent = originalText; btn.disabled = false; return; }
        } else {
          skipNextResume = true; // health permission dialog may background the app
          await Health.requestHealthPermissions({ permissions: ['READ_SLEEP', 'READ_STEPS'] });
          skipNextResume = false;
          // Refresh auth display in settings if modal is still open
          if (document.getElementById('settingsModal')?.classList.contains('active')) {
            _refreshHealthAuthDisplay().catch(() => {});
          }
        }

        // Determine target date — use the actual date in the form picker
        const _dateVal = document.getElementById('entryDate')?.value;
        const _targetDate = _dateVal ? new Date(_dateVal + 'T12:00:00') : new Date();
        _targetDate.setHours(0, 0, 0, 0);

        // Query window: noon the day before target → noon the day AFTER target.
        // The extra day on the upper end means the plugin's "latest sample" behaviour
        // works correctly for both "log today" and "log yesterday": in both cases the
        // most recent sleep (last night) starts after entry-date noon but before
        // (entry-date + 1) noon, so the guard below accepts it.
        const _sleepStart = new Date(_targetDate.getTime()); _sleepStart.setHours(-12, 0, 0, 0);
        const _sleepEnd   = new Date(_targetDate.getTime()); _sleepEnd.setHours(36, 0, 0, 0); // noon next day

        const result = await Health.queryLatestSample({
          dataType: 'sleep',
          startDate: _sleepStart.toISOString(),
          endDate:   _sleepEnd.toISOString()
        });
        if (!result || result.value == null) { showNoData(); return; }

        // Guard: reject samples that fall entirely outside the query window.
        // Only fires for entries more than ~2 days old where the plugin still returns
        // the most recent sleep rather than one matching the requested window.
        if (result.endTimestamp <= _sleepStart.getTime() || result.timestamp >= _sleepEnd.getTime()) {
          showNoData(); return;
        }

        // result.value is time asleep in minutes (asleep stages only — plugin filters out InBed/Awake)
        const hours = result.value / 60;

        // Guard against invalid/zero timestamps returning nonsense duration
        if (!hours || hours <= 0 || isNaN(hours)) { showNoData(); return; }

        // Range-based bucket: matches the label ranges (≤5h / 6-7h / 7-9h / 9-10h / 10+h)
        function _sleepBucketVal(h) {
          if (h <= 5.5) return 5;
          if (h < 7)   return 6.5;
          if (h <= 9)  return 8;
          if (h <= 10) return 9.5;
          return 11;
        }
        const _bucketVal = _sleepBucketVal(hours);
        const sleepBtns = document.querySelectorAll('.sleep-btn');
        let closestBtn = null;
        sleepBtns.forEach(b => { if (parseFloat(b.dataset.sleep) === _bucketVal) closestBtn = b; });
        if (!closestBtn) sleepBtns.forEach(b => { closestBtn = closestBtn || b; }); // fallback
        if (closestBtn) {
          nativeHaptic('success');
          const roundedH = Math.round(hours * 10) / 10;
          btn.textContent = `😴 Sleep | ${roundedH}h`;
          btn.disabled = false;
          if (typeof _fmActive !== 'undefined' && _fmActive) {
            // Focused mode: store exact imported value, highlight range bucket
            _fmSleepImported = roundedH;
            _fmSleepSuggestion = _bucketVal;
            selectedSleep = roundedH; // store actual hours, not bucket
            _sleepHealthSynced = true;
            _fmSleepClear = false;
            _fmSleepError = null;
            _fmSleepAutoSyncDone = true;
            _fmMaybeSuggestMood();
            _renderFocusedStep();
          } else {
            // Regular form: highlight closest bucket button but store actual hours
            _sleepSuggestedVal = parseFloat(closestBtn.dataset.sleep);
            sleepBtns.forEach(b => {
              b.classList.remove('selected');
              b.style.background = '#f8f9fa';
              b.style.color = '#495057';
              if (b.dataset.baseLabel) b.textContent = b.dataset.baseLabel;
            });
            closestBtn.classList.add('selected');
            closestBtn.style.background = closestBtn.dataset.color || getSleepColor(_sleepSuggestedVal);
            closestBtn.style.color = 'white';
            selectedSleep = roundedH; // store actual hours, not bucket
            _sleepHealthSynced = true;
            _updateSleepHero();
          }
        } else {
          showFail();
        }
      } catch (e) {
        console.warn('Sleep import failed:', e);
        showFail();
      }
    }
    window.importSleepFromHealth = importSleepFromHealth;

    // Focus mode sleep card long-press — hold to reveal sleep quality step
    // window._fmSlLpFired must be on window so inline onclick handlers can read it
    window._fmSlLpFired = false;
    let _fmSlLpTimer = null;
    window._fmSleepPtrDown = function(val, el) {
      window._fmSlLpFired = false;
      // Only the pill currently in the spinner's centre slot accepts the
      // long-press — holding an off-centre pill mid-swipe shouldn't jump
      // to the sleep-quality step.
      if (el && !el.classList.contains('center')) return;
      _fmSlLpTimer = setTimeout(() => {
        window._fmSlLpFired = true;
        _fmWantsSleepQuality = true;
        selectedSleep = val;
        _sleepHealthSynced = false;
        _fmSleepClear = false;
        nativeHaptic('medium');
        // Navigate directly to sleepQuality rather than relying on _fmAdvance path logic
        const _sqIdx = _fmSteps.findIndex(s => s.id === 'sleepQuality');
        if (_sqIdx > _fmStepIndex) {
          setTimeout(() => _fmGoTo(_sqIdx), 180);
        } else {
          _fmAdvance();
        }
      }, 500);
    };
    window._fmSleepPtrUp     = function() { clearTimeout(_fmSlLpTimer); _fmSlLpTimer = null; };
    window._fmSleepPtrCancel = function() { clearTimeout(_fmSlLpTimer); _fmSlLpTimer = null; };

    function _nearestBucket(h) {
      const buckets = [5, 6.5, 7.5, 8.5, 10];
      return buckets.reduce((a, b) => Math.abs(b - h) < Math.abs(a - h) ? b : a);
    }
    function _fmUndoSleepSync() {
      const bucket = _nearestBucket(selectedSleep);
      selectedSleep = bucket;
      _sleepHealthSynced = false;
      _fmSleepImported = null;
      _fmSleepSuggestion = null;
      _fmSleepAutoSyncDone = true; // don't re-trigger auto-import after undo
      _renderFocusedStep();
    }
    window._fmUndoSleepSync = _fmUndoSleepSync;

    // ────────────────────────────────────────────
    // STEPS BACKFILL FROM HEALTH
    // ────────────────────────────────────────────
    // Silently piggybacked onto the sleep sync — no UI of its own.
    // Fetches total daily step counts for the past 7 COMPLETED days (never today,
    // since today's steps are still accumulating) and writes the count back onto
    // the matching journal entry. Uses a simple single-field Firestore query and
    // matches dates in JS to avoid needing a composite index.
    async function backfillStepsFromHealth() {
      const Health = getPlugin('HealthPlugin');
      if (!Health) return;

      try {
        const { available } = await Health.isHealthAvailable();
        if (!available) return;

        // One aggregated query for the past 7 completed days.
        // endDate = today's midnight so today's partial steps are excluded.
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);

        const result = await Health.queryAggregated({
          dataType: 'steps',
          startDate: weekAgo.toISOString(),
          endDate:   today.toISOString(),
          bucket:    'day'
        });

        if (!result?.aggregatedData?.length) return;

        // Build a map of "YYYY-MM-DD" → stepCount from the health data
        function localDateKey(d) {
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        }
        const stepsByDate = {};
        for (const sample of result.aggregatedData) {
          const count = Math.round(sample.value);
          if (count > 0) stepsByDate[localDateKey(new Date(sample.startDate))] = count;
        }
        if (!Object.keys(stepsByDate).length) return;
        window._healthStepsByDate = stepsByDate; // expose so new entries can include steps on save

        // Show steps inside energy button for the current form date
        const _formDate = document.getElementById('entryDate')?.value;
        if (_formDate && stepsByDate[_formDate]) {
          const s = stepsByDate[_formDate];
          const _ebt = document.getElementById('healthEnergyBtnText');
          if (_ebt) {
            const stepsLabel = s >= 1000 ? Math.round(s / 1000) + 'k' : s;
            _ebt.textContent = `⚡ Energy | 🏃 ${stepsLabel}`;
          }
        }


        let anyUpdated = false;

        if (currentUser && db) {
          // Simple single-field query — no composite index required.
          // Date matching is done in JS against the stepsByDate map.
          const snap = await db.collection('entries')
            .where('userId', '==', currentUser.uid)
            .get({ source: 'server' });

          const batch = db.batch();
          let batchCount = 0;
          snap.forEach(doc => {
            const data = doc.data();
            if (!data.date) return;
            const key = localDateKey(new Date(data.date));
            const stepCount = stepsByDate[key];
            if (stepCount != null && data.steps !== stepCount) {
              batch.update(doc.ref, { steps: stepCount });
              batchCount++;
            }
          });
          if (batchCount > 0) {
            await batch.commit();
            anyUpdated = true;
          }

        } else {
          // Guest mode — update localStorage entries
          for (let j = 0; j < localStorage.length; j++) {
            const key = localStorage.key(j);
            if (!key || !key.startsWith('entry:')) continue;
            try {
              const raw = localStorage.getItem(key);
              if (!raw) continue;
              const entry = JSON.parse(raw);
              if (!entry.date) continue;
              const dateKey = localDateKey(new Date(entry.date));
              const stepCount = stepsByDate[dateKey];
              if (stepCount != null && entry.steps !== stepCount) {
                entry.steps = stepCount;
                localStorage.setItem(key, JSON.stringify(entry));
                anyUpdated = true;
              }
            } catch(e) { /* skip corrupted entry */ }
          }
        }

        if (anyUpdated && !editingEntry && !_fmActive) loadEntries();

      } catch(e) {
        // Silently swallow — steps backfill should never affect the sleep sync result
      }
    }

    // ────────────────────────────────────────────
    // INITIALISE ALL NATIVE FEATURES
    // ────────────────────────────────────────────
    document.addEventListener('deviceready', async () => {
      console.log('📱 Capacitor deviceready fired');
      await initStatusBar();
      await hideSplashScreen();
      await initNotifications();
      initAndroidBackButton();
      initKeyboardHandling();
      initAppStateListener();
    });

    // Also try on DOMContentLoaded for faster init
    document.addEventListener('DOMContentLoaded', async () => {
      if (!isNative()) return;
      console.log('📱 Running as native app on:', window.Capacitor.getPlatform());
      await initStatusBar();
      await hideSplashScreen();
      // Sleep Hours button is wired up in HTML; no extra setup needed here
    });

    // Prevent page scroll when any modal is open
    (function() {
      let _savedScrollY = 0;
      new MutationObserver(() => {
        const open = !!document.querySelector('.confirm-modal.active');
        if (open && !document.body.classList.contains('modal-open')) {
          _savedScrollY = window.scrollY;
          document.body.classList.add('modal-open');
          document.body.style.top = '-' + _savedScrollY + 'px';
        } else if (!open && document.body.classList.contains('modal-open')) {
          document.body.classList.remove('modal-open');
          document.body.style.top = '';
          window.scrollTo(0, _savedScrollY);
        }
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    })();

// ── BLOCK 4: Capacitor native bridges (StatusBar, App, plugin shims) ──
// Register service worker for offline functionality
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
          .then(registration => {
            console.log('✅ Service Worker registered successfully:', registration.scope);
            
            // Check for updates
            registration.addEventListener('updatefound', () => {
              const newWorker = registration.installing;
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New version available
                  if (confirm(BB.t('journal.dlg.newVersion'))) {
                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                    window.location.reload();
                  }
                }
              });
            });
          })
          .catch(error => {
            console.log('❌ Service Worker registration failed:', error);
          });
      });
    }

    // PWA Install Prompt
    let deferredPrompt;
    
    // Clear any previously dismissed state so prompt can show again
    localStorage.removeItem('pwa-install-dismissed');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      console.log('✅ PWA install prompt ready');
      
      // Show after 3 seconds - enough time for page to load
      setTimeout(showInstallPrompt, 3000);
    });

    // Hide install button if already installed
    window.addEventListener('appinstalled', () => {
      console.log('🎉 PWA installed!');
      deferredPrompt = null;
      const banner = document.getElementById('pwa-install-banner');
      if (banner) banner.remove();
      const btn = document.getElementById('pwa-install-ui-btn');
      if (btn) btn.remove();
    });

    function showInstallPrompt() {
      // Don't show if already dismissed this session or already open
      if (document.getElementById('pwa-install-banner')) return;

      const installBanner = document.createElement('div');
      installBanner.id = 'pwa-install-banner';
      installBanner.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, var(--brand-primary-light) 0%, var(--brand-primary-mid) 100%);
        color: white;
        padding: 15px 20px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 10000;
        max-width: 90%;
        width: 320px;
        text-align: center;
        animation: slideUp 0.3s ease;
      `;
      
      installBanner.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 10px;">${BB.t('journal.ui.installApp')}</div>
        <div style="font-size: 0.9em; margin-bottom: 15px; opacity: 0.95;">
          Track offline, faster loading, app-like experience
        </div>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button id="pwa-install-btn" style="background: white; color: var(--brand-primary); border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer;">
            Install Now
          </button>
          <button id="pwa-dismiss-btn" style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer;">
            Maybe Later
          </button>
        </div>
      `;
      
      document.body.appendChild(installBanner);
      
      document.getElementById('pwa-install-btn').addEventListener('click', async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          console.log(`User response to install prompt: ${outcome}`);
          deferredPrompt = null;
        }
        installBanner.remove();
      });
      
      document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
        installBanner.remove();
      });
    }

    // Add slide up animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideUp {
        from {
          transform: translateX(-50%) translateY(100px);
          opacity: 0;
        }
        to {
          transform: translateX(-50%) translateY(0);
          opacity: 1;
        }
      }
    `;
    document.head.appendChild(style);

    // Detect if running as installed PWA
    window.addEventListener('DOMContentLoaded', () => {
      if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
        console.log('🎉 Running as installed PWA!');
      }

      // Real-time edit-change detection: update submit button when user interacts with the form
      const _efc = document.getElementById('entryFormCard');
      if (_efc) {
        _efc.addEventListener('click',  () => { if (editingEntry) setTimeout(_updateEditBtn, 0); }, true);
        _efc.addEventListener('input',  () => { if (editingEntry) _updateEditBtn(); }, true);
        _efc.addEventListener('change', () => { if (editingEntry) setTimeout(_updateEditBtn, 0); }, true);
      }

      // Scroll triggered after load completes — see loadEntries() finally block
    });

// ── BLOCK 5: service-worker registration ──
// Easter egg: click logo 5 times to cycle original -> happy -> sad -> original
    // Logo variant is persisted in localStorage and Firestore (for logged-in users).
    // journal.js loads at the top of <body> (before <img class="easter-egg-logo">),
    // so the element lookup + listener wiring must wait for DOMContentLoaded.
    const logoSrcs = [
      'images/logos/good_logo.png',
      'images/logos/elevated_logo.png',
      'images/logos/sad_logo.png'
    ];
    let logoClickCount = 0;
    let logoResetTimer = null;
    let logoCurrentIndex = parseInt(localStorage.getItem('logoVariant') || '0');

    function applyLogoVariant(idx) {
      logoCurrentIndex = idx;
      const _img = document.querySelector('.easter-egg-logo');
      if (_img) _img.src = logoSrcs[idx];
    }

    function saveLogoVariant(idx) {
      localStorage.setItem('logoVariant', idx);
      if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined' && db) {
        db.collection('userSettings').doc(currentUser.uid).set({ logoVariant: idx }, { merge: true }).catch(() => {});
      }
      // Update widget immediately when logo changes
      if (window.webkit?.messageHandlers?.setSharedData) {
        window.webkit.messageHandlers.setSharedData.postMessage({ logoVariant: idx });
      } else if (isAndroid()) {
        const widgetPlugin = getPlugin('BipolarBearWidget');
        if (widgetPlugin) widgetPlugin.setSharedData({ entryComplete: document.getElementById('todayCompleteSection')?.style.display !== 'none', streak: window._currentStreak || 0, logoVariant: idx });
      }
    }

    function _initLogoEasterEgg() {
      const logoImg = document.querySelector('.easter-egg-logo');
      if (!logoImg) return;

      // Restore logo on load from localStorage
      applyLogoVariant(logoCurrentIndex);
      logoImg.style.cursor = 'pointer';

      logoImg.addEventListener('click', () => {
        clearTimeout(logoResetTimer);
        logoClickCount++;

        logoImg.style.transition = 'transform 0.1s ease';
        logoImg.style.transform = 'scale(1.15) rotate(5deg)';
        setTimeout(() => { logoImg.style.transform = ''; }, 120);

        if (logoClickCount === 5) {
          logoClickCount = 0;
          logoCurrentIndex = (logoCurrentIndex + 1) % logoSrcs.length;
          saveLogoVariant(logoCurrentIndex);

          // Sync app icon with logo variant (native only)
          try {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.setAppIcon) {
              const iconNames = [null, 'AppIcon_Happy', 'AppIcon_Sad'];
              window.webkit.messageHandlers.setAppIcon.postMessage({ name: iconNames[logoCurrentIndex] || null });
            }
          } catch(e) {}

          logoImg.style.transition = 'transform 0.4s ease, opacity 0.3s ease';
          logoImg.style.transform = 'scale(0) rotate(180deg)';
          logoImg.style.opacity = '0';
          setTimeout(() => {
            logoImg.src = logoSrcs[logoCurrentIndex];
            logoImg.style.transform = 'scale(1.1) rotate(-5deg)';
            logoImg.style.opacity = '1';
            setTimeout(() => {
              logoImg.style.transition = '';
              logoImg.style.transform = '';
            }, 200);
          }, 300);
        } else {
          logoResetTimer = setTimeout(() => { logoClickCount = 0; }, 1500);
        }
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _initLogoEasterEgg);
    } else {
      _initLogoEasterEgg();
    }

// ── BLOCK 6: logo easter egg + ancillary boot fixups ──
// Auto-open changelog if navigated from What's New popup
    if (new URLSearchParams(window.location.search).get('openChangelog') === '1') {
      window.addEventListener('load', () => {
        setTimeout(() => {
          const cm = document.getElementById('changelogModal');
          if (cm) cm.classList.add('active');
        }, 600);
      });
    }

    // Auto-open stats if navigated from Stats FAB
    if (new URLSearchParams(window.location.search).get('openStats') === '1') {
      window.addEventListener('load', () => {
        setTimeout(() => {
          const journalCard = document.getElementById('journalCard');
          if (journalCard && journalCard.style.display === 'none') {
            if (typeof toggleJournal === 'function') toggleJournal();
          }
          const statsEl = document.getElementById('statsAndCalendarBlock');
          if (statsEl) statsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 800);
      });
    }
