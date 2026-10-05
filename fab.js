/**
 * @file fab.js — Shared floating action bar (FAB dock) for BipolarBear.
 *
 * Loaded by index.html, journal.html and survival-kit.html. NOT loaded by
 * anonymous.html (that page uses its own yellow-themed FAB layout).
 *
 * Self-contained IIFE that on load:
 *   1. Marks the first run (every default FAB shows, Crisis Support in slot 1).
 *   2. Injects all FAB markup, CSS and modals into the document.
 *   3. Wires global handlers exposed on `window.*` for inline `onclick=` use.
 *
 * Cross-block dependencies (set by the page's inline script *before* fab.js
 * runs in practice — but we defensively check at call-time):
 *   - window.db          → firebase.firestore() instance
 *   - window.currentUser → signed-in Firebase user, or undefined when guest
 *   - window.firebase    → Firebase compat SDK global
 *   - window._fabOnSignOut, window._fabOpenAuth, window._fabBeforeSignIn,
 *     window._fabOnSignUp, window._fabOpenPersonalInfo,
 *     window._onFabFeedbackClose
 *     → optional page-specific hooks.
 *
 * Symbols this module *defines* on window for inline `onclick=` use and
 * for cross-page reuse (so any page that loads fab.js can call them):
 *   - window._nukeGuestData / window._confirmDeleteGuestData
 *     → guest-data wipe; powers the "🗑 Delete all guest data" button in
 *       the shared auth modal, plus the guest-PIN "forgot" path in
 *       js/index.js.
 *
 * localStorage keys this module reads/writes:
 *   bbFabSlot_1..4            — id of FAB assigned to each slot
 *   bbWaFabHidden             — chat (Crisis Support) hidden
 *   bbQuickNoteFabHidden      — security (Data Security) hidden
 *   bbCoffeeFabHidden         — coffee FAB hidden
 *   bbFeedbackFabHidden       — feedback FAB hidden
 *   bbReviewFabHidden         — review (app-store rating) FAB hidden
 *   bbFooterHidden            — entire footer hidden
 *   bbFabsUnlocked            — '1' once the onboarding tutorial has unlocked the dock
 *   bbFabFirstRunDone         — '1' after first-run defaults applied (one-shot)
 *   bbQuickNotes              — JSON array of saved quick notes
 */
(function () {
  'use strict';

  // ── Guest-data wipe ───────────────────────────────────────────────────────

  /**
   * Wipe every localStorage + sessionStorage key for this origin and reload
   * the page.
   *
   * Lives in fab.js (not js/index.js) so the "🗑 Delete all guest data"
   * button in the shared auth modal works identically on every page that
   * loads fab.js (index, journal, survival-kit). Pre-fix the button was a
   * no-op on /journal and /survival-kit because window._confirmDeleteGuestData
   * was only defined on /index.
   *
   * @returns {void}
   */
  function _nukeGuestData() {
    localStorage.clear();
    sessionStorage.clear();
    location.replace(location.pathname);
  }

  /**
   * Two-step confirmation wrapper around `_nukeGuestData`. Bails out as
   * soon as either confirm() returns false.
   *
   * @returns {void}
   */
  function _confirmDeleteGuestData() {
    if (!confirm(_bbT('fab.guestDelete1', 'This will permanently delete all your guest data — journal entries, settings, and preferences. There is no way to recover them.\n\nAre you absolutely sure?'))) return;
    if (!confirm(_bbT('fab.guestDelete2', 'Last chance — everything will be deleted and you will start fresh. Continue?'))) return;
    _nukeGuestData();
  }

  window._nukeGuestData = _nukeGuestData;
  window._confirmDeleteGuestData = _confirmDeleteGuestData;

  // ── Cross-device persistence ──────────────────────────────────────────────

  /**
   * Mirror the current FAB customisation (slot assignments + hidden flags)
   * to Firestore so the layout follows the user across devices. Restored on
   * sign-in by index.html's auth listener.
   *
   * No-op when not signed in — `window.currentUser` is undefined for guests
   * (and was previously undefined for everyone before the bug fix that
   * exposes it on window — see the v0.99 settings-persistence fix).
   *
   * @returns {void}
   */
  function _syncFabsToFirestore() {
    if (!window.db || !window.currentUser) return;
    const fabState = {};
    for (let s = 1; s <= 4; s++) {
      const v = BB.storage.get('FabSlot_' + s);
      if (v) fabState['slot' + s] = v;
    }
    ['bbWaFabHidden','bbQuickNoteFabHidden','bbCoffeeFabHidden','bbFeedbackFabHidden','bbReviewFabHidden','bbFooterHidden'].forEach(k => {
      if (localStorage.getItem(k) === '1') fabState[k] = '1';
    });
    window.db.collection('userSettings').doc(window.currentUser.uid)
      .set({ fabState: fabState }, { merge: true }).catch(() => {});
  }
  window._syncFabsToFirestore = _syncFabsToFirestore;

  // ── First-run defaults ────────────────────────────────────────────────────

  /**
   * One-shot first-run marker. New installs keep every default FAB, so the
   * Crisis Support (🆘) FAB sits in slot 1 from the start; with four slots
   * for five defaults, the review FAB is then left out of the dock and
   * offered in the picker instead (on iOS, where the coffee FAB is
   * suppressed, it takes slot 3).
   *
   * Installs from before 2026-10-05 ran an older version of this block that
   * hid Crisis Support on a brand-new install (bbWaFabHidden = '1'), which
   * handed slot 1 to "Leave a Review". That flag is indistinguishable from a
   * user's own choice, so it is left alone — existing docks don't change.
   *
   * Idempotent via the bbFabFirstRunDone flag (set on first run, never reset
   * except by full account/data deletion).
   */
  (function _applyFirstRunFabDefaults() {
    if (BB.storage.get('FabFirstRunDone') === '1') return;
    BB.storage.set('FabFirstRunDone', '1');
  })();

  // ── Config ────────────────────────────────────────────────────────────────

  /**
   * Apple Guideline 3.1.1: donations towards the app's development must use
   * In-App Purchase on iOS — external donation links (buymeacoffee) are not
   * allowed. The coffee FAB is therefore suppressed entirely in the iOS
   * native shell: never shown in the dock, never offered in the picker.
   * Web and Android keep it.
   */
  const _COFFEE_BLOCKED = !!(window.BB && BB.platform && BB.platform.isIOS());

  /**
   * Store listings for the review FAB. The `?action=write-review` query param
   * makes the App Store open straight on the review composer; Play has no
   * equivalent parameter, so the listing page is the best we can do there.
   */
  const _STORE_URLS = {
    ios:     'https://apps.apple.com/gb/app/bipolar-bear/id6766637453?action=write-review',
    android: 'https://play.google.com/store/apps/details?id=com.bipolarbear.app',
  };

  /**
   * Default FABs, one per slot. `hiddenKey` is the localStorage flag that
   * removes the FAB from the dock when set to '1'. Reordering this array
   * does not move existing users' FABs — slot persistence is keyed on `id`
   * via bbFabSlot_*.
   */
  const _FAB_DEFAULTS = [
    { id: 'chat',     icon: '🆘', label: 'Crisis Support',  desc: 'Samaritans & community chat', hiddenKey: 'bbWaFabHidden',        slotNum: 1 },
    { id: 'e2ee',     icon: '🔐', label: 'Data Security',   desc: 'How your data is kept safe',  hiddenKey: 'bbQuickNoteFabHidden',  slotNum: 2 },
    { id: 'coffee',   icon: '☕', label: 'Buy Us a Coffee', desc: 'Support Bipolar Bear',         hiddenKey: 'bbCoffeeFabHidden',     slotNum: 3 },
    { id: 'feedback', icon: '📣', label: 'Send Feedback',   desc: 'Help us make it better',      hiddenKey: 'bbFeedbackFabHidden',   slotNum: 4 },
    // The dock only has four slots, so `review` is the one default without a
    // slot of its own — it claims the first free slot (slot 3 on iOS, where
    // the coffee FAB is suppressed; slot 1 on installs from before
    // 2026-10-05, whose first run hid Crisis Support). When every slot is
    // taken it stays out of the dock and is offered in the picker instead.
    { id: 'review',   icon: '⭐', label: 'Leave a Review',  desc: 'Rate Bipolar Bear on the app store', hiddenKey: 'bbReviewFabHidden', slotNum: 1 },
  ];
  /**
   * Extra FABs available via the picker — never auto-assigned, only added
   * by the user. Each maps to a hidden `<button id="<id>ExtraFab">` injected
   * by `_injectHTML()` and revealed by `_applyFabDock()` when assigned.
   */
  const _FAB_EXTRAS = [
    { id: 'quicknote', icon: '📝', label: 'Quick Note', desc: 'Reminder for your next journal entry' },
    { id: 'stats',     icon: '📊', label: 'Statistics',  desc: 'Open your mood journal stats' },
    { id: 'celeb',     icon: '⭐', label: 'Celebrity',   desc: 'Famous people with bipolar disorder' },
    { id: 'goals',     icon: '🎯', label: 'Goals',       desc: 'View your survival kit goals' },
  ];

  /** Public figures shown by the Celebrity FAB. `wiki` is the URL slug. */
  const _CELEBS = [
    { name: 'Mariah Carey',        field: 'Singer',                        wiki: 'Mariah_Carey' },
    { name: 'Kanye West',          field: 'Musician & Artist',              wiki: 'Kanye_West' },
    { name: 'Demi Lovato',         field: 'Singer & Actress',               wiki: 'Demi_Lovato' },
    { name: 'Stephen Fry',         field: 'Actor & Author',                 wiki: 'Stephen_Fry' },
    { name: 'Carrie Fisher',       field: 'Actress & Author',               wiki: 'Carrie_Fisher' },
    { name: 'Catherine Zeta-Jones',field: 'Actress',                        wiki: 'Catherine_Zeta-Jones' },
    { name: 'Pete Davidson',       field: 'Comedian & Actor',               wiki: 'Pete_Davidson' },
    { name: 'Brian Wilson',        field: 'Musician — The Beach Boys',      wiki: 'Brian_Wilson_(musician)' },
    { name: 'Ted Turner',          field: 'Media Mogul, Founder of CNN',    wiki: 'Ted_Turner' },
    { name: 'Mike Tyson',          field: 'Professional Boxer',             wiki: 'Mike_Tyson' },
    { name: 'Mel Gibson',          field: 'Actor & Director',               wiki: 'Mel_Gibson' },
    { name: 'Robbie Williams',     field: 'Singer',                         wiki: 'Robbie_Williams' },
    { name: 'Ben Stiller',         field: 'Actor & Director',               wiki: 'Ben_Stiller' },
    { name: 'Bebe Rexha',          field: 'Singer',                         wiki: 'Bebe_Rexha' },
    { name: 'Halsey',              field: 'Singer',                         wiki: 'Halsey_(singer)' },
    { name: 'Patty Duke',          field: 'Actress & Bipolar Advocate',     wiki: 'Patty_Duke' },
    { name: 'Vincent van Gogh',    field: 'Artist',                         wiki: 'Vincent_van_Gogh' },
    { name: 'Ernest Hemingway',    field: 'Author',                         wiki: 'Ernest_Hemingway' },
    { name: 'Buzz Aldrin',         field: 'Astronaut',                      wiki: 'Buzz_Aldrin' },
    { name: 'Lil Wayne',           field: 'Rapper',                         wiki: 'Lil_Wayne' },
    { name: 'Taylor Tomlinson',    field: 'Comedian',                       wiki: 'Taylor_Tomlinson' },
    { name: 'Virginia Woolf',      field: 'Author',                         wiki: 'Virginia_Woolf' },
    { name: 'Syd Barrett',         field: 'Musician — Pink Floyd',          wiki: 'Syd_Barrett' },
    { name: 'Axl Rose',            field: "Musician — Guns N' Roses",       wiki: 'Axl_Rose' },
  ];
  /** Map from extra FAB id → DOM id of the injected button. */
  const _extraMap = { stats: 'statsExtraFab', celeb: 'celebExtraFab', goals: 'goalsExtraFab', quicknote: 'quicknoteExtraFab' };

  // ── Appearance (automatic / light / dark) ─────────────────────────────────
  // Stored in localStorage.bbTheme ('auto' | 'light' | 'dark', default auto =
  // follow the phone). Per device, never synced, and deliberately left off the
  // logout / reset clear-lists so signing out doesn't flip someone back into a
  // bright screen at 2 a.m. The inline one-liner in each page's <head> applies
  // it before first paint; this keeps it right afterwards — the setting
  // changing (journal Settings → Appearance) or the phone switching at sunset.
  // Styles live in css/dark.css. Anything that draws its own colours listens
  // for the `bb:themechange` event on document and redraws.
  const _THEME_KEY = 'bbTheme';
  const _darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function _themePref() {
    try { const v = localStorage.getItem(_THEME_KEY); return (v === 'light' || v === 'dark') ? v : 'auto'; }
    catch (e) { return 'auto'; }
  }
  function _applyTheme() {
    const pref = _themePref();
    const dark = pref === 'dark' || (pref === 'auto' && !!(_darkQuery && _darkQuery.matches));
    const root = document.documentElement;
    const changed = root.classList.contains('theme-dark') !== dark;
    root.classList.toggle('theme-dark', dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#1c1612' : '#ff9500');
    if (changed) {
      try { document.dispatchEvent(new CustomEvent('bb:themechange', { detail: { dark: dark } })); } catch (e) {}
    }
    return dark;
  }
  function _setThemePref(pref) {
    if (pref !== 'light' && pref !== 'dark') pref = 'auto';
    try { localStorage.setItem(_THEME_KEY, pref); } catch (e) {}
    return _applyTheme();
  }
  if (_darkQuery) {
    const _onSchemeChange = () => { if (_themePref() === 'auto') _applyTheme(); };
    if (_darkQuery.addEventListener) _darkQuery.addEventListener('change', _onSchemeChange);
    else if (_darkQuery.addListener) _darkQuery.addListener(_onSchemeChange);
  }
  window.BB = window.BB || {};
  window.BB.theme = {
    pref: _themePref,
    set: _setThemePref,
    apply: _applyTheme,
    isDark: () => document.documentElement.classList.contains('theme-dark'),
  };
  _applyTheme();

  // ── CSS ───────────────────────────────────────────────────────────────────
  // All FAB styling is injected into <head> as a single <style> so pages
  // don't need to copy this CSS. Selectors are namespaced (`fab-*`, `bb-*`)
  // to avoid collisions with the host page's stylesheet.
  const _styleEl = document.createElement('style');
  _styleEl.textContent = `
    .fab-footer {
      position: fixed; bottom: 0; left: 0; right: 0;
      height: 80px; background: white;
      border-radius: 28px 28px 0 0; z-index: 45;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.10); pointer-events: none;
    }
    .whatsapp-fab, .placeholder-fab, .coffee-fab, .feedback-fab, .review-fab, .bb-extra-fab {
      position: fixed; bottom: 24px;
      width: 44px; height: 44px; border-radius: 50%;
      background: rgba(255,149,0,0.13); border: none; color: var(--brand-primary); font-size: 1.2em;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.10); z-index: 50;
      -webkit-tap-highlight-color: transparent;
      transition: background 0.18s, transform 0.15s;
    }
    @media (hover: hover) and (pointer: fine) {
      .whatsapp-fab:hover, .placeholder-fab:hover, .coffee-fab:hover,
      .feedback-fab:hover, .review-fab:hover, .bb-extra-fab:hover { background: rgba(255,149,0,0.22); transform: scale(1.08); }
    }
    .fab-dot-placeholder {
      position: fixed; bottom: 24px;
      width: 44px; height: 44px; border-radius: 50%;
      background: transparent; border: 2px dashed rgba(255,149,0,0.45);
      color: rgba(255,149,0,0.6); font-size: 1.3em;
      cursor: pointer; display: none; align-items: center; justify-content: center;
      z-index: 50; -webkit-tap-highlight-color: transparent;
      transition: border-color 0.18s, color 0.18s;
    }
    @media (hover: hover) and (pointer: fine) {
      .fab-dot-placeholder:hover { border-color: rgba(255,149,0,0.75); color: rgba(255,149,0,0.85); }
    }
    .bb-auth-fab {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      width: 44px; height: 44px; border-radius: 50%;
      background: white; border: 2px solid var(--brand-primary); color: var(--brand-primary); font-size: 1.15em;
      cursor: pointer; display: none; align-items: center; justify-content: center;
      box-shadow: 0 2px 10px rgba(255,149,0,0.25); z-index: 50;
      -webkit-tap-highlight-color: transparent; transition: transform 0.15s;
    }
    @media (hover: hover) and (pointer: fine) {
      .bb-auth-fab:hover { transform: translateX(-50%) scale(1.08); }
    }
    /* Android 15+ draws the WebView edge-to-edge, behind the gesture / nav bar
       (Play's "edge-to-edge" warning). Lift the whole dock by the bottom inset so
       its buttons clear the bar. Older WebViews (e.g. Chrome 124) report env() as
       0, so also read the --safe-area-inset-bottom Capacitor's SystemBars plugin
       injects; both are 0 on Android 14 and below, where the system still
       reserves that space. iOS keeps the layout it shipped with. */
    html.is-android .fab-footer { height: calc(80px + max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px))); }
    html.is-android .whatsapp-fab, html.is-android .placeholder-fab, html.is-android .coffee-fab,
    html.is-android .feedback-fab, html.is-android .review-fab, html.is-android .bb-extra-fab,
    html.is-android .fab-dot-placeholder, html.is-android .bb-auth-fab {
      bottom: calc(24px + max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px)));
    }
    @media (min-width: 520px) {
      .fab-footer { border-bottom-left-radius: 42px; border-bottom-right-radius: 42px; }
    }
    .bb-fab-modal {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.5); z-index: 9998;
      align-items: center; justify-content: center; padding: 20px;
    }
    .bb-fab-modal.open { display: flex; }
    .bb-feedback-modal {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.5); z-index: 1000;
      justify-content: center; align-items: center;
      overflow: hidden; padding: 20px; box-sizing: border-box;
    }
    .bb-feedback-modal.open { display: flex; }
    .bb-feedback-content {
      background: white; padding: 28px; border-radius: 20px;
      max-width: 420px; width: 100%; max-height: 85dvh;
      overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      box-sizing: border-box;
    }
    .bb-fb-type-btn {
      flex: 1; padding: 10px 8px; border: 2px solid #e9ecef;
      border-radius: 10px; background: #f8f9fa; color: #495057;
      font-weight: 600; font-size: 0.9em; cursor: pointer;
      transition: all 0.2s ease; -webkit-tap-highlight-color: transparent;
    }
    .bb-fb-type-btn.selected { border-color: var(--brand-primary); background: rgba(255,149,0,0.08); color: var(--brand-primary); }
    /* ── Auth modal ── */
    .bb-auth-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.5); z-index: 9990;
      align-items: center; justify-content: center; padding: 20px;
    }
    .bb-auth-overlay.active { display: flex; }
    .bb-auth-box {
      background: white; border-radius: 20px; padding: 24px 24px 20px;
      max-width: 320px; width: 100%; box-sizing: border-box;
      box-shadow: 0 8px 32px rgba(0,0,0,0.22);
    }
    .bb-auth-input {
      width: 100%; padding: 12px 14px; border: 2px solid #e9ecef;
      border-radius: 10px; font-size: 0.95em; box-sizing: border-box;
      margin-bottom: 10px; outline: none; font-family: inherit; display: block;
    }
    .bb-auth-input:focus { border-color: var(--brand-primary); }
    /* ── Account modal ── */
    .bb-account-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.5); z-index: 9990;
      align-items: center; justify-content: center; padding: 20px;
    }
    .bb-account-overlay.active { display: flex; }
    .bb-account-box {
      background: white; border-radius: 20px; padding: 24px 24px 20px;
      max-width: 300px; width: 100%; box-sizing: border-box;
      box-shadow: 0 8px 32px rgba(0,0,0,0.22);
    }
  `;
  document.head.appendChild(_styleEl);

  // ── HTML injection ────────────────────────────────────────────────────────

  /**
   * Build and inject every FAB button + every modal into the page. Targets
   * `#app-shell` when present (so FABs sit inside the iPhone-style frame on
   * journal/index/survival-kit) and falls back to `<body>`.
   *
   * Triggered once on DOM ready (or immediately if the document is already
   * parsed). After injection, defers `_applyFabDock()` past two animation
   * frames so the layout has settled and `#app-shell.offsetWidth` is valid
   * for slot positioning.
   *
   * @returns {void}
   */
  function _injectHTML() {
    const _wrap = document.createElement('div');
    _wrap.innerHTML = `
      <div class="fab-footer" aria-hidden="true"></div>

      <!-- Core default FABs -->
      <button class="whatsapp-fab" id="chatFab" onclick="openChatModal()" title="Crisis support" data-i18n-title="fab.crisis.tooltip">🆘</button>
      <div id="chatModal" class="bb-fab-modal" onclick="if(event.target===this)closeChatModal()">
        <div style="background:white;border-radius:20px;padding:24px 24px 20px;text-align:center;max-width:300px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.22);">
          <div style="font-size:2em;margin-bottom:8px;">🆘</div>
          <div style="font-weight:700;font-size:1.05em;color:#212529;margin-bottom:6px;" data-i18n="fab.crisis.title">Crisis Support</div>
          <p style="font-size:0.84em;color:#6c757d;margin-bottom:14px;" data-i18n="fab.crisis.body">If you're struggling and need to talk to someone:</p>
          <div id="chatModalLines">
          <a href="tel:116123" style="display:flex;align-items:center;gap:12px;padding:13px 14px;background:#f8f9fa;border-radius:12px;text-decoration:none;color:#212529;margin-bottom:14px;text-align:left;">
            <span style="font-size:1.6em;line-height:1;">📞</span>
            <div>
              <div style="font-weight:700;font-size:0.95em;">Samaritans</div>
              <div style="color:#6c757d;font-size:0.82em;margin-top:1px;" data-i18n="fab.crisis.samaritansInfo">116 123 · Free · 24/7</div>
            </div>
          </a>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button onclick="closeChatModal()" style="padding:12px;background:var(--brand-btn);color:white;border:none;border-radius:12px;font-weight:700;font-size:0.95em;cursor:pointer;" data-i18n="common.close">Close</button>
            <button id="chatModalHide" onclick="closeChatModal();window._showHidePermanently('chat')" style="padding:8px;background:none;border:none;color:#adb5bd;font-size:0.8em;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="common.hideButton">🙈 Hide this button</button>
          </div>
        </div>
      </div>

      <button class="placeholder-fab" id="quickNoteFab" onclick="openSecurityModal()" title="Your data security" data-i18n-title="fab.security.tooltip">🔐</button>
      <div id="securityModal" class="bb-fab-modal" onclick="if(event.target===this)closeSecurityModal()">
        <div style="background:white;border-radius:20px;padding:24px 24px 20px;text-align:center;max-width:300px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.22);">
          <div style="font-size:2em;margin-bottom:8px;">🔐</div>
          <div style="font-weight:700;font-size:1.05em;color:#212529;margin-bottom:12px;" data-i18n="fab.security.title">How your data stays safe</div>
          <div style="text-align:left;font-size:0.84em;color:#495057;line-height:1.65;margin-bottom:16px;">
            <p style="margin-bottom:8px;" data-i18n-html="fab.security.pinBody"><strong>🔑 Your PIN</strong> locks the app locally on your device. Without it, nobody can open Bipolar Bear — even if they have your phone.</p>
            <p style="margin-bottom:8px;" data-i18n-html="fab.security.passwordBody"><strong>🔒 Your password</strong> encrypts your journal entries before they ever leave your device. The data is scrambled using a key only you hold.</p>
            <p style="margin-bottom:8px;" data-i18n-html="fab.security.firebaseBody"><strong>☁️ Firebase (our database)</strong> stores only the encrypted version. Even we can't read your entries — they're meaningless without your password.</p>
            <p style="margin-bottom:0;" data-i18n-html="fab.security.e2eeBody"><strong>🛡️ End-to-end encryption</strong> means your data is protected at every step — on your device, in transit, and in storage.</p>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <button onclick="closeSecurityModal()" style="padding:12px;background:var(--brand-btn);color:white;border:none;border-radius:12px;font-weight:700;font-size:0.95em;cursor:pointer;" data-i18n="common.gotIt">Got it</button>
            <button onclick="closeSecurityModal();window._showHidePermanently('quicknote')" style="padding:10px;background:none;border:none;color:#adb5bd;font-size:0.8em;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="common.hideButton">🙈 Hide this button</button>
          </div>
        </div>
      </div>

      <button class="coffee-fab" id="coffeeFab" onclick="openCoffeeModal()" title="Support Bipolar Bear" data-i18n-title="fab.coffee.tooltip">☕</button>
      <div id="coffeeModal2" class="bb-fab-modal" onclick="if(event.target===this)closeCoffeeModal()">
        <div style="background:white;border-radius:20px;padding:24px 24px 20px;text-align:center;max-width:300px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.22);">
          <div style="font-size:2em;margin-bottom:8px;">☕</div>
          <div style="font-weight:700;font-size:1.05em;color:#212529;margin-bottom:8px;" data-i18n="fab.coffee.title">Keep Bipolar Bear Going</div>
          <p style="font-size:0.88em;color:#6c757d;line-height:1.55;margin-bottom:6px;" data-i18n-html="fab.coffee.body">Running BipolarBear costs around <strong>£25/month</strong> for servers, hosting and services.</p>
          <p id="bbCoffeeFundedText" style="font-size:0.82em;color:var(--brand-primary);font-weight:600;margin-bottom:16px;display:none;"></p>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <a href="https://buymeacoffee.com/jamesmarkey" target="_blank" rel="noopener noreferrer" onclick="closeCoffeeModal()"
              style="display:block;padding:13px;background:var(--brand-btn);color:white;border-radius:12px;text-decoration:none;font-weight:700;font-size:0.95em;text-align:center;">
              <span data-i18n="fab.coffee.send">☕ Send me a coffee</span>
            </a>
            <button onclick="window._showHidePermanently('coffee')"
              style="padding:10px;background:none;border:none;color:#adb5bd;font-size:0.8em;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="common.hideButton">
              🙈 Hide this button
            </button>
          </div>
        </div>
      </div>

      <button class="feedback-fab" onclick="openFabFeedback()" title="Send feedback" data-i18n-title="fab.feedbackTip">📣</button>
      <div class="bb-feedback-modal" id="bbFabFeedbackModal" onclick="if(event.target===this)closeFabFeedback()">
        <div class="bb-feedback-content">
          <h3 style="margin-bottom:4px;color:#333;" data-i18n="feedback.title">Share Feedback</h3>
          <p id="bbFbMeta" style="font-size:0.78em;color:#adb5bd;margin-bottom:4px;"></p>
          <p style="font-size:0.85em;color:#6c757d;margin-bottom:16px;" data-i18n="feedback.subtitle">Help us make Bipolar Bear better.</p>
          <div style="display:flex;gap:8px;margin-bottom:16px;">
            <button class="bb-fb-type-btn" id="bbFbTypeBug" onclick="selectFabFeedbackType('bug')">🐛 <span data-i18n="feedback.typeBug">Bug</span></button>
            <button class="bb-fb-type-btn" id="bbFbTypeComment" onclick="selectFabFeedbackType('comment')">💬 <span data-i18n="feedback.typeComment">Comment</span></button>
            <button class="bb-fb-type-btn" id="bbFbTypeIdea" onclick="selectFabFeedbackType('idea')">💡 <span data-i18n="feedback.typeIdea">Idea</span></button>
          </div>
          <textarea id="bbFbMessage" placeholder="Tell us what's on your mind…" data-i18n-placeholder="feedback.messagePlaceholder" rows="4"
            style="width:100%;padding:10px;border:2px solid #e9ecef;border-radius:10px;font-size:0.95em;box-sizing:border-box;resize:none;font-family:inherit;margin-bottom:12px;"></textarea>
          <div id="bbFbEmailRow" style="margin-bottom:12px;display:none;">
            <input type="email" id="bbFbEmail" placeholder="Your email (optional)" data-i18n-placeholder="feedback.emailPlaceholder"
              style="width:100%;padding:10px;border:2px solid #e9ecef;border-radius:10px;font-size:0.95em;box-sizing:border-box;font-family:inherit;">
          </div>
          <div style="margin-bottom:12px;">
            <label id="bbFbScreenshotLabel" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.88em;color:#6c757d;padding:8px 12px;border:2px dashed #e9ecef;border-radius:10px;">
              <span style="font-size:1.2em;">📎</span>
              <span data-i18n="feedback.screenshotLabel">Attach a screenshot (optional)</span>
              <input type="file" id="bbFbScreenshot" accept="image/*" style="display:none;" onchange="_onFbScreenshotChange(this)">
            </label>
            <div id="bbFbScreenshotPreview" style="display:none;margin-top:8px;position:relative;display:none;">
              <img id="bbFbScreenshotThumb" style="max-width:100%;max-height:120px;border-radius:8px;border:1px solid #e9ecef;object-fit:contain;" alt="">
              <button onclick="_clearFbScreenshot()" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.55);color:white;border:none;border-radius:50%;width:22px;height:22px;font-size:0.8em;cursor:pointer;line-height:1;padding:0;">✕</button>
            </div>
          </div>
          <label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;font-size:0.88em;color:#495057;margin-bottom:18px;user-select:none;">
            <span data-i18n="feedback.notifyLabel">Keep me informed about my submission</span>
            <span style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;"
              onclick="var cb=document.getElementById('bbFbNotify');cb.checked=!cb.checked;document.getElementById('bbFbNotifyTrack').style.background=cb.checked?'var(--brand-primary)':'#ccc';document.getElementById('bbFbNotifyThumb').style.transform=cb.checked?'translateX(20px)':'translateX(0)';">
              <input type="checkbox" id="bbFbNotify" checked style="opacity:0;width:0;height:0;position:absolute;pointer-events:none;">
              <span id="bbFbNotifyTrack" style="position:absolute;inset:0;border-radius:24px;background:var(--brand-primary);transition:background 0.2s;"></span>
              <span id="bbFbNotifyThumb" style="position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:white;box-shadow:0 1px 3px rgba(0,0,0,0.3);transition:transform 0.2s;transform:translateX(20px);"></span>
            </span>
          </label>
          <div id="bbFbError" style="color:#dc3545;font-size:0.85em;margin-bottom:10px;display:none;"></div>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button onclick="submitFabFeedback()" style="padding:11px 24px;background:var(--brand-btn);color:white;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:0.95em;" data-i18n="common.send">Send</button>
            <button onclick="closeFabFeedback()" style="padding:11px 24px;background:white;color:#495057;border:2px solid #e9ecef;border-radius:10px;font-weight:600;cursor:pointer;font-size:0.95em;" data-i18n="common.cancel">Cancel</button>
          </div>
          <button onclick="window._showHidePermanently('feedback')"
            style="display:block;width:100%;margin-top:12px;padding:8px;background:none;border:none;color:#adb5bd;font-size:0.8em;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="common.hideButton">
            🙈 Hide this button
          </button>
        </div>
      </div>

      <button class="review-fab" id="reviewFab" onclick="openReviewModal()" title="Leave a review" data-i18n-title="fab.review.tooltip">⭐</button>
      <div id="bbReviewModal" class="bb-fab-modal" onclick="if(event.target===this)closeReviewModal()">
        <div style="background:white;border-radius:20px;padding:24px 24px 20px;text-align:center;max-width:300px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.22);">
          <div style="font-size:2em;margin-bottom:8px;">⭐⭐⭐</div>
          <div style="font-weight:700;font-size:1.05em;color:#212529;margin-bottom:8px;" data-i18n="fab.review.title">Enjoying Bipolar Bear?</div>
          <p style="font-size:0.88em;color:#6c757d;line-height:1.55;margin-bottom:16px;" data-i18n="fab.review.body">A review helps other people going through the same thing find the app. It only takes a moment.</p>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <a id="bbReviewIosLink" href="#" target="_blank" rel="noopener noreferrer" onclick="closeReviewModal()"
              style="display:none;padding:13px;background:#000;color:white;border-radius:12px;text-decoration:none;font-weight:700;font-size:0.95em;text-align:center;">
              <span data-i18n="fab.review.appStore">🍎 Review on the App Store</span>
            </a>
            <a id="bbReviewAndroidLink" href="#" target="_blank" rel="noopener noreferrer" onclick="closeReviewModal()"
              style="display:none;padding:13px;background:#01875f;color:white;border-radius:12px;text-decoration:none;font-weight:700;font-size:0.95em;text-align:center;">
              <span data-i18n="fab.review.googlePlay">▶️ Review on Google Play</span>
            </a>
            <button onclick="closeReviewModal()" style="padding:10px;background:#f8f9fa;color:#6c757d;border:none;border-radius:12px;font-size:0.9em;cursor:pointer;" data-i18n="fab.review.later">Maybe later</button>
            <button onclick="window._showHidePermanently('review')"
              style="padding:8px;background:none;border:none;color:#adb5bd;font-size:0.8em;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="common.hideButton">
              🙈 Hide this button
            </button>
          </div>
        </div>
      </div>

      <!-- Center auth FAB (always at 50%, not part of slot system) -->
      <button id="bbAuthFab" class="bb-auth-fab" onclick="(window._fabOpenAuth||function(){})()" title="Profile / Sign in">👤</button>

      <!-- Placeholder dots -->
      <button class="fab-dot-placeholder" id="fabPh1" onclick="window._openFabPicker(1)" title="Add to dock">+</button>
      <button class="fab-dot-placeholder" id="fabPh2" onclick="window._openFabPicker(2)" title="Add to dock">+</button>
      <button class="fab-dot-placeholder" id="fabPh3" onclick="window._openFabPicker(3)" title="Add to dock">+</button>
      <button class="fab-dot-placeholder" id="fabPh4" onclick="window._openFabPicker(4)" title="Add to dock">+</button>

      <!-- Extra assignable FABs (hidden until assigned) -->
      <button class="bb-extra-fab" id="statsExtraFab" onclick="openStatsModal()" title="Statistics" style="display:none;">📊</button>
      <button class="bb-extra-fab" id="celebExtraFab" onclick="openCelebModal()" title="Famous people with bipolar" style="display:none;">⭐</button>
      <button class="bb-extra-fab" id="goalsExtraFab" onclick="openGoalsModal()" title="My goals" style="display:none;">🎯</button>
      <button class="bb-extra-fab" id="quicknoteExtraFab" onclick="openQuickNoteModal()" title="Quick note" style="display:none;">📝</button>

      <!-- FAB picker sheet -->
      <div id="bbFabPickerModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;align-items:flex-end;justify-content:center;" onclick="if(event.target===this)closeFabPicker();">
        <div style="background:white;border-radius:20px 20px 0 0;padding:24px;max-width:420px;width:100%;box-shadow:0 -4px 32px rgba(0,0,0,0.18);">
          <div style="font-weight:700;font-size:1.05em;color:#212529;margin-bottom:16px;text-align:center;" data-i18n="fabPicker.addToDock">Add to dock</div>
          <div id="bbFabPickerOptions" style="display:flex;flex-direction:column;gap:10px;"></div>
          <button onclick="closeFabPicker()" style="display:block;width:100%;margin-top:14px;padding:12px;background:#f8f9fa;color:#6c757d;border:none;border-radius:12px;font-weight:600;font-size:0.95em;cursor:pointer;" data-i18n="common.cancel">Cancel</button>
        </div>
      </div>

      <!-- Quick Note modal -->
      <div id="bbQuickNoteModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)closeQuickNoteModal();">
        <div style="background:white;border-radius:20px;padding:24px;max-width:300px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.22);">
          <div style="font-size:2em;text-align:center;margin-bottom:6px;">📝</div>
          <div style="font-weight:700;font-size:1.05em;color:#212529;margin-bottom:4px;text-align:center;" data-i18n="quickNote.title">Quick Note</div>
          <p style="font-size:0.82em;color:#adb5bd;margin-bottom:12px;text-align:center;" data-i18n="quickNote.subtitle">Shows on your next journal entry</p>
          <textarea id="bbQuickNoteInput" placeholder="Something to remember..." data-i18n-placeholder="quickNote.placeholder" style="width:100%;min-height:90px;border:1.5px solid #e9ecef;border-radius:10px;padding:10px 12px;font-size:0.9em;color:#495057;resize:vertical;box-sizing:border-box;font-family:inherit;line-height:1.5;outline:none;"></textarea>
          <div style="display:flex;gap:10px;margin-top:12px;">
            <button onclick="closeQuickNoteModal()" style="flex:1;padding:11px;background:white;color:#adb5bd;border:1.5px solid #e9ecef;border-radius:12px;font-weight:600;font-size:0.9em;cursor:pointer;" data-i18n="common.cancel">Cancel</button>
            <button onclick="saveQuickNote()" style="flex:1;padding:11px;background:var(--brand-btn);color:white;border:none;border-radius:12px;font-weight:700;font-size:0.9em;cursor:pointer;"><span data-i18n="common.save">Save</span> ✓</button>
          </div>
          <button onclick="closeQuickNoteModal();window._hideExtraFab('quicknote')" style="display:block;margin:10px auto 0;padding:6px 10px;background:none;border:none;color:#adb5bd;font-size:0.8em;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="common.hideButton">🙈 Hide this button</button>
        </div>
      </div>

      <!-- Celebrity modal -->
      <div id="bbCelebModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)closeCelebModal();">
        <div style="background:white;border-radius:20px;padding:24px;max-width:300px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.22);text-align:center;">
          <div style="font-size:0.78em;color:#adb5bd;margin-bottom:12px;font-style:italic;" data-i18n="fab.celeb.subtitle">Famous people with bipolar disorder</div>
          <div id="bbCelebPhotoWrap" style="width:80px;height:80px;border-radius:50%;margin:0 auto 12px;overflow:hidden;background:#fff3e0;display:flex;align-items:center;justify-content:center;font-size:2.2em;">⭐</div>
          <div id="bbCelebName" style="font-weight:700;font-size:1.1em;color:#212529;margin-bottom:4px;"></div>
          <div id="bbCelebField" style="color:#6c757d;font-size:0.85em;margin-bottom:16px;"></div>
          <div style="display:flex;gap:8px;margin-bottom:12px;">
            <button onclick="nextCeleb()" style="flex:1;padding:10px;background:#f8f9fa;color:#495057;border:1.5px solid #e9ecef;border-radius:12px;font-weight:600;font-size:0.9em;cursor:pointer;" data-i18n="fab.celeb.next">Next ›</button>
            <a id="bbCelebWiki" href="#" target="_blank" rel="noopener noreferrer" style="flex:1;padding:10px;background:var(--brand-btn);color:white;border-radius:12px;font-weight:700;font-size:0.9em;text-decoration:none;display:flex;align-items:center;justify-content:center;" data-i18n="fab.celeb.wiki">Wikipedia ↗</a>
          </div>
          <div style="display:flex;gap:8px;">
            <button onclick="closeCelebModal()" style="flex:1;padding:10px;background:#f8f9fa;color:#6c757d;border:none;border-radius:12px;font-size:0.85em;cursor:pointer;" data-i18n="common.close">Close</button>
            <button onclick="closeCelebModal();window._hideExtraFab('celeb')" style="flex:1;padding:10px;background:none;border:none;color:#adb5bd;font-size:0.8em;cursor:pointer;" data-i18n="common.hideButton">🙈 Hide this button</button>
          </div>
        </div>
      </div>

      <!-- Goals modal -->
      <div id="bbGoalsModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)closeGoalsModal();">
        <div style="background:white;border-radius:20px;padding:24px;max-width:320px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.22);max-height:80dvh;overflow-y:auto;">
          <div style="font-size:1.8em;text-align:center;margin-bottom:8px;">🎯</div>
          <div style="font-weight:700;font-size:1.05em;color:#212529;margin-bottom:16px;text-align:center;" data-i18n="fab.goals.title">My Goals</div>
          <div id="bbGoalsList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;"></div>
          <a href="survival-kit.html#goals" style="display:block;text-align:center;color:var(--brand-primary);font-size:0.88em;text-decoration:none;margin-bottom:14px;padding:10px;border:1.5px solid #ffe0b2;border-radius:10px;" data-i18n="fab.goals.manage">Manage goals in Survival Kit ↗</a>
          <button onclick="closeGoalsModal()" style="display:block;width:100%;padding:12px;background:var(--brand-btn);color:white;border:none;border-radius:12px;font-weight:700;cursor:pointer;margin-bottom:8px;" data-i18n="common.close">Close</button>
          <button onclick="closeGoalsModal();window._hideExtraFab('goals')" style="display:block;width:100%;padding:8px;background:none;border:none;color:#adb5bd;font-size:0.8em;cursor:pointer;" data-i18n="common.hideButton">🙈 Hide this button</button>
        </div>
      </div>

      <!-- Stats modal -->
      <div id="bbStatsModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9998;align-items:center;justify-content:center;padding:20px;" onclick="if(event.target===this)this.style.display='none';">
        <div style="background:white;border-radius:20px;padding:24px;max-width:300px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.22);text-align:center;">
          <div style="font-size:2em;margin-bottom:8px;">📊</div>
          <div style="font-weight:700;font-size:1.05em;color:#212529;margin-bottom:8px;" data-i18n="fab.stats.title">Mood Statistics</div>
          <p style="font-size:0.85em;color:#6c757d;margin-bottom:18px;" data-i18n="fab.stats.body">View your mood patterns, streaks, and trends in the journal.</p>
          <button onclick="document.getElementById('bbStatsModal').style.display='none';window.location.href='journal.html?openStats=1'" style="display:block;width:100%;padding:12px;background:var(--brand-btn);color:white;border:none;border-radius:12px;font-weight:700;cursor:pointer;margin-bottom:8px;" data-i18n="fab.stats.open">Open Statistics ↗</button>
          <button onclick="document.getElementById('bbStatsModal').style.display='none'" style="display:block;width:100%;padding:10px;background:#f8f9fa;color:#6c757d;border:none;border-radius:12px;font-size:0.9em;cursor:pointer;margin-bottom:8px;" data-i18n="common.cancel">Cancel</button>
          <button onclick="document.getElementById('bbStatsModal').style.display='none';window._hideExtraFab('stats')" style="display:block;width:100%;padding:8px;background:none;border:none;color:#adb5bd;font-size:0.8em;cursor:pointer;" data-i18n="common.hideButton">🙈 Hide this button</button>
        </div>
      </div>

      <!-- Shared auth modal (sign in / sign up) -->
      <div class="bb-auth-overlay" id="bbAuthModal" onclick="if(event.target===this)window.closeAuthModal()">
        <div class="bb-auth-box">
          <h3 id="bbAuthTitle" style="margin:0 0 14px;font-size:1.1em;color:#212529;text-align:center;" data-i18n="auth.welcome">Welcome to Bipolar Bear 🐻</h3>
          <div id="bbAuthError" style="display:none;color:#dc3545;font-size:0.85em;padding:8px 12px;background:rgba(220,53,69,0.08);border-radius:8px;margin-bottom:10px;"></div>
          <input type="email" id="bbAuthEmail" class="bb-auth-input" placeholder="Email" data-i18n-placeholder="auth.emailPlaceholder" autocomplete="email">
          <input type="password" id="bbAuthPassword" class="bb-auth-input" placeholder="Password" data-i18n-placeholder="auth.passwordPlaceholder" autocomplete="current-password">
          <button id="bbAuthSubmit" style="width:100%;padding:13px;background:var(--brand-btn);color:white;border:none;border-radius:10px;font-weight:700;font-size:0.95em;cursor:pointer;margin-bottom:8px;" data-i18n="common.signIn">Sign In</button>
          <button onclick="window.closeAuthModal()" style="width:100%;padding:11px;background:#f8f9fa;color:#6c757d;border:2px solid #e9ecef;border-radius:10px;font-size:0.9em;font-weight:600;cursor:pointer;margin-bottom:10px;-webkit-tap-highlight-color:transparent;" data-i18n="auth.continueGuest">Continue as Guest</button>
          <div id="bbAuthToggle" style="text-align:center;font-size:0.85em;color:#6c757d;cursor:pointer;padding:4px;">Don't have an account? <span style="color:var(--brand-primary);font-weight:600;">Sign up</span></div>
          <button onclick="(window._confirmDeleteGuestData||function(){})()" style="display:block;width:100%;margin-top:10px;background:none;border:none;color:#adb5bd;font-size:0.78em;cursor:pointer;padding:4px 8px;-webkit-tap-highlight-color:transparent;text-align:center;" data-i18n="auth.deleteGuestData">🗑 Delete all guest data</button>
          <div id="bbAuthVersion" style="margin-top:8px;text-align:center;font-size:0.7em;color:#adb5bd;letter-spacing:0.02em;"></div>
        </div>
      </div>

      <!-- Shared account modal (profile management) -->
      <div class="bb-account-overlay" id="bbAccountModal" onclick="if(event.target===this)window.closeAccountModal()">
        <div class="bb-account-box">
          <div style="font-size:1.6em;margin-bottom:4px;text-align:center;">👤</div>
          <div id="bbAccountEmail" style="font-size:0.85em;color:#6c757d;margin-bottom:16px;word-break:break-all;text-align:center;"></div>
          <div id="bbAccountMsg" style="font-size:0.85em;margin-bottom:12px;display:none;padding:8px 12px;border-radius:8px;"></div>
          <button onclick="window._bbAccountLogout()" style="width:100%;padding:12px;background:white;color:#dc3545;border:2px solid #dc3545;border-radius:10px;font-size:0.95em;font-weight:600;cursor:pointer;margin-bottom:10px;-webkit-tap-highlight-color:transparent;" data-i18n="account.signOut">Sign out</button>
          <div id="bbAccountPassSection" style="margin-bottom:10px;">
            <div id="bbAccountPassFields" style="display:none;margin-bottom:8px;">
              <input type="password" id="bbAccountCurrentPass" placeholder="Current password" data-i18n-placeholder="account.currentPassword" style="width:100%;padding:10px 12px;border:2px solid #e9ecef;border-radius:8px;font-size:0.9em;box-sizing:border-box;margin-bottom:6px;outline:none;font-family:inherit;">
              <input type="password" id="bbAccountNewPass" placeholder="New password" data-i18n-placeholder="account.newPassword" style="width:100%;padding:10px 12px;border:2px solid #e9ecef;border-radius:8px;font-size:0.9em;box-sizing:border-box;margin-bottom:8px;outline:none;font-family:inherit;">
              <div style="display:flex;gap:8px;">
                <button onclick="window._bbSubmitPasswordChange()" style="flex:1;padding:10px;background:var(--brand-btn);color:white;border:none;border-radius:8px;font-size:0.9em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="common.save">Save</button>
                <button onclick="document.getElementById('bbAccountPassFields').style.display='none';document.getElementById('bbAccountPassToggleBtn').style.display='';" style="padding:10px 14px;background:#f8f9fa;color:#6c757d;border:2px solid #e9ecef;border-radius:8px;font-size:0.9em;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="common.cancel">Cancel</button>
              </div>
            </div>
            <button id="bbAccountPassToggleBtn" onclick="document.getElementById('bbAccountPassFields').style.display='';document.getElementById('bbAccountPassToggleBtn').style.display='none';document.getElementById('bbAccountCurrentPass').focus();" style="width:100%;padding:12px;background:#f8f9fa;color:#495057;border:2px solid #e9ecef;border-radius:10px;font-size:0.95em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="account.changePassword">Change password</button>
          </div>
          <div id="bbAccountEmailSection" style="margin-bottom:10px;">
            <div id="bbAccountEmailFields" style="display:none;margin-bottom:8px;">
              <input type="email" id="bbAccountNewEmail" placeholder="New email address" data-i18n-placeholder="account.newEmail" style="width:100%;padding:10px 12px;border:2px solid #e9ecef;border-radius:8px;font-size:0.9em;box-sizing:border-box;margin-bottom:6px;outline:none;font-family:inherit;">
              <input type="password" id="bbAccountEmailPass" placeholder="Current password" data-i18n-placeholder="account.currentPassword" style="width:100%;padding:10px 12px;border:2px solid #e9ecef;border-radius:8px;font-size:0.9em;box-sizing:border-box;margin-bottom:8px;outline:none;font-family:inherit;">
              <div style="display:flex;gap:8px;">
                <button onclick="window._bbSubmitEmailChange()" style="flex:1;padding:10px;background:var(--brand-btn);color:white;border:none;border-radius:8px;font-size:0.9em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="common.save">Save</button>
                <button onclick="document.getElementById('bbAccountEmailFields').style.display='none';document.getElementById('bbAccountEmailToggleBtn').style.display='';" style="padding:10px 14px;background:#f8f9fa;color:#6c757d;border:2px solid #e9ecef;border-radius:8px;font-size:0.9em;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="common.cancel">Cancel</button>
              </div>
            </div>
            <button id="bbAccountEmailToggleBtn" onclick="document.getElementById('bbAccountEmailFields').style.display='';document.getElementById('bbAccountEmailToggleBtn').style.display='none';document.getElementById('bbAccountNewEmail').focus();" style="width:100%;padding:12px;background:#f8f9fa;color:#495057;border:2px solid #e9ecef;border-radius:10px;font-size:0.95em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="account.changeEmail">Change email</button>
          </div>
          <div style="margin-bottom:10px;">
            <div style="font-size:0.78em;font-weight:600;color:#6c757d;margin-bottom:6px;" data-i18n="account.language">Language</div>
            <select id="bbLangSelect" onchange="window.BB&&window.BB.i18n&&window.BB.i18n.setLanguage(this.value)" style="width:100%;padding:10px 12px;border:2px solid #e9ecef;border-radius:8px;font-size:0.9em;font-family:inherit;color:#495057;background:white;cursor:pointer;-webkit-appearance:none;appearance:none;">
              <option value="en">🇬🇧 English</option>
              <option value="es">🇪🇸 Español</option>
              <option value="fr">🇫🇷 Français</option>
              <option value="de">🇩🇪 Deutsch</option>
              <option value="it">🇮🇹 Italiano</option>
              <option value="pt">🇵🇹 Português</option>
              <option value="nl">🇳🇱 Nederlands</option>
              <option value="pl">🇵🇱 Polski</option>
              <option value="sv">🇸🇪 Svenska</option>
              <option value="zh">🇨🇳 中文</option>
            </select>
          </div>
          <button onclick="(window._fabOpenPersonalInfo||function(){})()" style="width:100%;padding:12px;background:white;color:#495057;border:2px solid #e9ecef;border-radius:10px;font-size:0.95em;font-weight:600;cursor:pointer;margin-bottom:10px;-webkit-tap-highlight-color:transparent;" data-i18n="fab.personalInfo">👤 Personal information</button>
          <!-- App Store guideline 5.1.1(v): account deletion must be reachable
               from wherever account management lives. This modal is the only
               account UI on survival-kit, and the one reviewers find first on
               index/journal, so the entry point belongs here. -->
          <div id="bbAccountDeleteSection" style="margin-bottom:10px;padding-top:10px;border-top:1px solid #e9ecef;">
            <button onclick="window._bbAccountDelete()" style="width:100%;padding:12px;background:rgba(201,42,42,0.08);color:#c92a2a;border:2px solid #c92a2a;border-radius:10px;font-size:0.95em;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="account.deleteAccount">🗑️ Delete account</button>
          </div>
          <div id="bbAccountDeleteLocked" style="display:none;margin-bottom:10px;padding-top:10px;border-top:1px solid #e9ecef;">
            <div style="color:#6c757d;font-size:0.82em;padding:10px;border:1.5px solid #dee2e6;border-radius:10px;text-align:center;" data-i18n="account.deleteLocked">🔒 Account cannot be deleted</div>
          </div>
          <button onclick="window.closeAccountModal()" style="width:100%;padding:10px;background:#f8f9fa;color:#6c757d;border:2px solid #e9ecef;border-radius:10px;font-size:0.9em;cursor:pointer;-webkit-tap-highlight-color:transparent;" data-i18n="common.cancel">Cancel</button>
          <div id="bbAccountVersion" style="margin-top:10px;text-align:center;font-size:0.7em;color:#adb5bd;letter-spacing:0.02em;"></div>
        </div>
      </div>
    `;
    const _target = document.getElementById('app-shell') || document.body;
    while (_wrap.firstChild) _target.appendChild(_wrap.firstChild);
    // Defer until after layout so #app-shell.offsetWidth is valid
    requestAnimationFrame(() => requestAnimationFrame(() => _applyFabDock()));
    // Apply translations to freshly-injected HTML
    if (window.BB && window.BB.i18n) window.BB.i18n.applyAll();
    // Wire auth modal listeners now that elements are in the DOM
    _bbWireAuthListeners();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _injectHTML);
  } else {
    _injectHTML();
  }

  // ── FAB dock: visibility + slot positioning ───────────────────────────────

  /**
   * Recompute every FAB's visibility and horizontal position based on the
   * current localStorage state. Called on first injection, on every window
   * resize, and after any state change (picker action, hide-permanently).
   *
   * Behaviour summary:
   *   - Pre-tutorial (`bbFabsUnlocked !== '1'`): everything hidden, returns early.
   *   - Default FABs render in their assigned slot (or `slotNum` fallback).
   *   - Hidden defaults free their slot for an extra FAB or placeholder.
   *   - Truly empty slots show the dotted `+` placeholder which opens the picker.
   *
   * Slot horizontal positions are derived from `#app-shell.offsetWidth` on
   * desktop (≥920px, where the shell creates a containing block via
   * `transform: translateZ(0)`) and from `window.innerWidth` on mobile.
   *
   * @returns {void}
   */
  /**
   * Ids of the default FABs that got a slot on the last `_applyFabDock()`
   * run. The picker uses it to offer any visible-but-unplaced default (there
   * are five defaults for four slots), so a FAB squeezed out of the dock is
   * still reachable.
   * @type {Set<string>}
   */
  let _placedDefaults = new Set();

  function _applyFabDock() {
    const _fabsUnlocked = BB.storage.get('FabsUnlocked') === '1';
    const _footer = document.querySelector('.fab-footer');

    // Center auth FAB: always visible. It's the single auth/profile button on
    // every page — shown during onboarding (when the rest of the dock is still
    // locked) and after. (index.html used to ship its own pre-dock
    // #authFabWrapper for the locked phase; that's been removed in favour of
    // this one to avoid two buttons stacked at the same coordinates.)
    const _authFab = document.getElementById('bbAuthFab');
    if (_authFab) _authFab.style.display = 'flex';

    if (!_fabsUnlocked) {
      if (_footer) _footer.style.display = 'none';
      [document.getElementById('chatFab'), document.getElementById('quickNoteFab'),
       document.getElementById('coffeeFab'), document.querySelector('.feedback-fab'),
       document.getElementById('reviewFab')].forEach(el => { if (el) el.style.display = 'none'; });
      Object.values(_extraMap).forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
      for (let s = 1; s <= 4; s++) { const ph = document.getElementById('fabPh' + s); if (ph) ph.style.display = 'none'; }
      return;
    }

    if (_footer) _footer.style.display = '';

    // Slot positions relative to the fixed-positioning containing block.
    // At ≥920px on the web, #app-shell has transform:translateZ(0) so
    // position:fixed is relative to it → use offsetWidth.
    // At <920px, position:fixed is viewport-relative regardless of app-shell width → use innerWidth.
    // On native (Capacitor) the device-frame is suppressed and #app-shell has
    // transform:none (see the html.is-native CSS override), so the dock is
    // viewport-relative there too even on a wide iPad → use innerWidth.
    const _native = document.documentElement.classList.contains('is-native');
    const _appShell = document.getElementById('app-shell');
    const _shellW = (window.innerWidth >= 920 && !_native)
      ? ((_appShell && _appShell.offsetWidth) || window.innerWidth)
      : window.innerWidth;
    const _slotPos = {
      1: Math.round(_shellW * 0.10 - 22) + 'px',
      2: Math.round(_shellW * 0.30 - 22) + 'px',
      3: Math.round(_shellW * 0.70 - 22) + 'px',
      4: Math.round(_shellW * 0.90 - 22) + 'px',
    };

    const _defVis = {
      chat:     BB.storage.get('WaFabHidden')        !== '1',
      e2ee:     BB.storage.get('QuickNoteFabHidden') !== '1',
      coffee:   !_COFFEE_BLOCKED && BB.storage.get('CoffeeFabHidden') !== '1',
      feedback: BB.storage.get('FeedbackFabHidden')  !== '1',
      review:   BB.storage.get('ReviewFabHidden')    !== '1',
    };
    const _defEl = {
      chat:     document.getElementById('chatFab'),
      e2ee:     document.getElementById('quickNoteFab'),
      coffee:   document.getElementById('coffeeFab'),
      feedback: document.querySelector('.feedback-fab'),
      review:   document.getElementById('reviewFab'),
    };

    // Resolve which slot each visible default FAB lives in, in three passes:
    //   1. an explicit picker assignment (bbFabSlot_N === id) always wins;
    //   2. otherwise the FAB's natural `slotNum`, if still free;
    //   3. otherwise the lowest free slot.
    // There are five defaults and only four slots, so a FAB can end up with no
    // slot at all — it is then left out of the dock and offered in the picker
    // (see `_placedDefaults`). Hidden defaults never reserve a slot, which is
    // what frees slot 1 when Crisis Support is hidden and slot 3 on iOS.
    const _defaultSlotMap = {};
    const _slotOccupied = {};
    const _visibleDefaults = _FAB_DEFAULTS.filter(_def => _defVis[_def.id]);
    const _unassigned = [];
    _visibleDefaults.forEach(_def => {
      let _found = null;
      for (let s = 1; s <= 4; s++) {
        if (BB.storage.get('FabSlot_' + s) === _def.id) { _found = s; break; }
      }
      if (_found !== null) {
        _defaultSlotMap[_def.id] = _found;
        _slotOccupied[_found] = true;
      } else {
        _unassigned.push(_def);
      }
    });
    _unassigned.forEach(_def => {
      if (!_slotOccupied[_def.slotNum]) {
        _defaultSlotMap[_def.id] = _def.slotNum;
        _slotOccupied[_def.slotNum] = true;
      }
    });
    // Slots the user has explicitly given to an extra FAB are off-limits to
    // pass 3, so adding `review` never evicts a button the user chose to dock.
    const _extraClaimed = {};
    for (let s = 1; s <= 4; s++) {
      const _a = BB.storage.get('FabSlot_' + s);
      if (_a && _extraMap[_a]) _extraClaimed[s] = true;
    }
    _unassigned.forEach(_def => {
      if (_defaultSlotMap[_def.id]) return;
      for (let s = 1; s <= 4; s++) {
        if (!_slotOccupied[s] && !_extraClaimed[s]) {
          _defaultSlotMap[_def.id] = s; _slotOccupied[s] = true; return;
        }
      }
    });

    _placedDefaults = new Set(Object.keys(_defaultSlotMap));

    _FAB_DEFAULTS.forEach(_def => {
      const _el = _defEl[_def.id];
      if (!_el) return;
      const _slot = _defaultSlotMap[_def.id];
      _el.style.display = _slot ? (_def.id === 'feedback' ? '' : 'flex') : 'none';
      if (_slot) _el.style.left = _slotPos[_slot];
    });

    // Hide all extras first, then show the assigned ones
    Object.values(_extraMap).forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    for (let s = 1; s <= 4; s++) {
      if (!_slotOccupied[s]) {
        const _assigned = BB.storage.get('FabSlot_' + s);
        if (_assigned && _extraMap[_assigned]) {
          const _ef = document.getElementById(_extraMap[_assigned]);
          if (_ef) { _ef.style.display = 'flex'; _ef.style.left = _slotPos[s]; }
        }
      }
    }

    // Placeholder dots for truly empty slots
    for (let s = 1; s <= 4; s++) {
      const _ph = document.getElementById('fabPh' + s);
      if (!_ph) continue;
      const _assigned = BB.storage.get('FabSlot_' + s);
      const _hasExtra = _assigned && _extraMap[_assigned] && !_slotOccupied[s];
      _ph.style.display = (!_slotOccupied[s] && !_hasExtra) ? 'flex' : 'none';
      _ph.style.left = _slotPos[s];
    }
  }
  window._applyFabDock = _applyFabDock;
  window.addEventListener('resize', _applyFabDock);

  // ── FAB picker ────────────────────────────────────────────────────────────

  /** Slot the picker is currently choosing for (1–4). Captured per-open. */
  let _fabPickerSlot = null;

  /**
   * Open the picker sheet for `slot`. Lists every default FAB the user has
   * hidden (so they can re-add it) plus every extra FAB not currently
   * assigned to another slot. Selecting an option clears that FAB's hidden
   * flag, removes it from any other slot it occupies, assigns it to `slot`,
   * re-renders the dock and syncs to Firestore.
   *
   * @param {number} slot Target slot (1–4).
   */
  window._openFabPicker = function (slot) {
    _fabPickerSlot = slot;
    const _opts = document.getElementById('bbFabPickerOptions');
    if (!_opts) return;
    _opts.innerHTML = '';
    _FAB_DEFAULTS.forEach(_def => {
      if (_def.id === 'coffee' && _COFFEE_BLOCKED) return;
      // Offer a default when the user hid it, and also when it is visible but
      // could not be placed (more defaults than slots — see _placedDefaults).
      if (localStorage.getItem(_def.hiddenKey) === '1' || !_placedDefaults.has(_def.id)) {
        const _btn = document.createElement('button');
        _btn.style.cssText = 'display:flex;align-items:center;gap:14px;width:100%;padding:13px 14px;background:#f8f9fa;border:1.5px solid #e9ecef;border-radius:14px;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent;';
        _btn.innerHTML = `<span style="font-size:1.6em;line-height:1;">${_def.icon}</span><div><div style="font-weight:700;font-size:0.95em;color:#212529;">${_bbT('fab.picker.' + _def.id + 'Label', _def.label)}</div><div style="font-size:0.8em;color:#adb5bd;margin-top:2px;">${_bbT('fab.picker.' + _def.id + 'Desc', _def.desc)}</div></div>`;
        _btn.addEventListener('click', () => {
          localStorage.removeItem(_def.hiddenKey);
          for (let s = 1; s <= 4; s++) {
            if (BB.storage.get('FabSlot_' + s) === _def.id) BB.storage.remove('FabSlot_' + s);
          }
          BB.storage.set('FabSlot_' + _fabPickerSlot, _def.id);
          closeFabPicker();
          _applyFabDock();
          _syncFabsToFirestore();
        });
        _opts.appendChild(_btn);
      }
    });
    const _assignedExtras = new Set();
    for (let s = 1; s <= 4; s++) {
      const v = BB.storage.get('FabSlot_' + s);
      if (v && _extraMap[v]) _assignedExtras.add(v);
    }
    _FAB_EXTRAS.forEach(_extra => {
      if (!_assignedExtras.has(_extra.id)) {
        const _btn = document.createElement('button');
        _btn.style.cssText = 'display:flex;align-items:center;gap:14px;width:100%;padding:13px 14px;background:#f8f9fa;border:1.5px solid #e9ecef;border-radius:14px;cursor:pointer;text-align:left;-webkit-tap-highlight-color:transparent;';
        _btn.innerHTML = `<span style="font-size:1.6em;line-height:1;">${_extra.icon}</span><div><div style="font-weight:700;font-size:0.95em;color:#212529;">${_bbT('fab.picker.' + _extra.id + 'Label', _extra.label)}</div><div style="font-size:0.8em;color:#adb5bd;margin-top:2px;">${_bbT('fab.picker.' + _extra.id + 'Desc', _extra.desc)}</div></div>`;
        _btn.addEventListener('click', () => {
          for (let s = 1; s <= 4; s++) {
            if (BB.storage.get('FabSlot_' + s) === _extra.id) BB.storage.remove('FabSlot_' + s);
          }
          BB.storage.set('FabSlot_' + _fabPickerSlot, _extra.id);
          closeFabPicker();
          _applyFabDock();
          _syncFabsToFirestore();
        });
        _opts.appendChild(_btn);
      }
    });
    if (!_opts.firstChild) {
      _opts.innerHTML = '<div style="text-align:center;color:#adb5bd;font-size:0.9em;padding:16px 0;">' + _bbT('fab.pickerEmpty', 'No buttons available to add.') + '</div>';
    }
    const _m = document.getElementById('bbFabPickerModal');
    if (_m) _m.style.display = 'flex';
  };
  /** Dismiss the picker without making a change. */
  window.closeFabPicker = function () {
    const _m = document.getElementById('bbFabPickerModal');
    if (_m) _m.style.display = 'none';
  };

  /**
   * Remove an extra FAB from whichever slot it occupies. Called from the
   * "🙈 Hide this button" links inside extra-FAB modals.
   * @param {string} extraId One of the `_FAB_EXTRAS[].id` values.
   */
  window._hideExtraFab = function (extraId) {
    for (let s = 1; s <= 4; s++) {
      if (BB.storage.get('FabSlot_' + s) === extraId) BB.storage.remove('FabSlot_' + s);
    }
    _applyFabDock();
    _syncFabsToFirestore();
  };

  // ── Core FAB modal open/close ─────────────────────────────────────────────
  // Thin show/hide handlers wired to inline `onclick=` attributes.

  /** @returns {void} */
  /**
   * Opens the 🆘 sheet. Its markup is the UK's (Samaritans); on a phone
   * anywhere else the row is swapped for that country's crisis lines plus its
   * emergency number (js/shared/crisis.js), or findahelpline.com where the
   * country isn't listed. `fromLock` is the PIN lock screen's "Need help now?"
   * link: the sheet then sits above the lock overlay and drops the
   * "Hide this button" option, which means nothing there.
   */
  window.openChatModal = function (fromLock) {
    const modal = document.getElementById('chatModal');
    if (!modal) return;
    const C = window.BB && BB.crisis;
    const box = document.getElementById('chatModalLines');
    if (C && box) {
      const g = C.get();
      if (!g.uk) {
        const cls = {
          rowStyle: 'display:flex;align-items:center;gap:12px;padding:13px 14px;background:#f8f9fa;border-radius:12px;text-decoration:none;color:#212529;margin-bottom:10px;text-align:left;',
          icoStyle: 'font-size:1.6em;line-height:1;',
          textTag: 'div',
          nameStyle: 'font-weight:700;font-size:0.95em;',
          subStyle: 'color:#6c757d;font-size:0.82em;margin-top:1px;',
        };
        box.textContent = '';
        g.lines.forEach(l => box.appendChild(C.row(l, cls)));
        if (g.emergency) {
          box.appendChild(C.row({ name: BB.t('crisis.emergency'), href: 'tel:' + g.emergency, icon: '🚑',
            sub: BB.t('crisis.callN', { n: g.emergency }) }, cls));
        }
        if (g.cc) {
          const more = document.createElement('a');
          more.href = g.findUrl; more.target = '_blank'; more.rel = 'noopener';
          more.style.cssText = 'display:block;font-size:0.8em;color:#6c757d;margin:2px 0 14px;';
          more.textContent = BB.t('crisis.elsewhere');
          box.appendChild(more);
        } else if (box.lastChild) {
          box.lastChild.style.marginBottom = '14px';
        }
      }
    }
    const hide = document.getElementById('chatModalHide');
    if (hide) hide.style.display = fromLock ? 'none' : '';
    modal.style.zIndex = fromLock ? '10003' : '';
    modal.classList.add('open');
  };
  /** @returns {void} */
  window.closeChatModal = function () { document.getElementById('chatModal').classList.remove('open'); };
  /** @returns {void} */
  window.openSecurityModal = function () { document.getElementById('securityModal').classList.add('open'); };
  /** @returns {void} */
  window.closeSecurityModal = function () { document.getElementById('securityModal').classList.remove('open'); };

  /**
   * Open the "Leave a review" modal. In the native shells only the store the
   * app was actually installed from is offered (linking an iOS user at Google
   * Play is dead weight, and App Store guideline 3.1.1 dislikes pointing at
   * other storefronts); on the web both listings are shown so the visitor can
   * pick whichever platform they're on.
   *
   * @returns {void}
   */
  window.openReviewModal = function () {
    const _ios     = !!(window.BB && BB.platform && BB.platform.isIOS());
    const _android = !!(window.BB && BB.platform && BB.platform.isAndroid());
    const _native  = !!(window.BB && BB.platform && BB.platform.isNative());
    const _showIos     = !_native || _ios;
    const _showAndroid = !_native || _android;
    const _iosLink = document.getElementById('bbReviewIosLink');
    if (_iosLink) {
      _iosLink.href = _STORE_URLS.ios;
      _iosLink.style.display = _showIos ? 'block' : 'none';
    }
    const _androidLink = document.getElementById('bbReviewAndroidLink');
    if (_androidLink) {
      _androidLink.href = _STORE_URLS.android;
      _androidLink.style.display = _showAndroid ? 'block' : 'none';
    }
    document.getElementById('bbReviewModal').classList.add('open');
  };
  /** @returns {void} */
  window.closeReviewModal = function () { document.getElementById('bbReviewModal').classList.remove('open'); };

  /**
   * Open the "Buy us a coffee" modal and best-effort fetch the current
   * funding percentage from `counters/appCosts` in Firestore. Fails silently
   * on network/permission errors — the modal still opens.
   * @returns {Promise<void>}
   */
  window.openCoffeeModal = async function () {
    document.getElementById('coffeeModal2').classList.add('open');
    const _db = window.db || (window.firebase && window.firebase.firestore ? window.firebase.firestore() : null);
    if (_db) {
      try {
        const _snap = await _db.collection('counters').doc('appCosts').get();
        if (_snap.exists) {
          const d = _snap.data();
          const pct = d.totalFunded && d.monthlyTarget ? Math.round((d.totalFunded / d.monthlyTarget) * 100) : null;
          const _el = document.getElementById('bbCoffeeFundedText');
          if (_el && pct !== null) { _el.textContent = (window.BB && window.BB.t) ? window.BB.t('fab.coffee.funded', { pct: pct }) : (pct + '% of this month funded — thank you!'); _el.style.display = ''; }
        }
      } catch (e) {}
    }
  };
  /** @returns {void} */
  window.closeCoffeeModal = function () { document.getElementById('coffeeModal2').classList.remove('open'); };

  // ── Feedback FAB ──────────────────────────────────────────────────────────

  /** Currently-selected feedback type ('bug' | 'comment' | 'idea') or null. */
  let _fbType = null;
  /** Base64-encoded compressed screenshot, or null. */
  let _fbScreenshotData = null;

  /**
   * Compress an image File to a base64 JPEG (max 900px on longest side,
   * quality 0.65) using an off-screen canvas.
   * @param {File} file
   * @returns {Promise<string>} data-URL string
   */
  function _compressFbImage(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          const MAX = 900;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else       { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.65));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  window._onFbScreenshotChange = async function (input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const preview = document.getElementById('bbFbScreenshotPreview');
    const thumb   = document.getElementById('bbFbScreenshotThumb');
    const errEl   = document.getElementById('bbFbError');
    try {
      const dataUrl = await _compressFbImage(file);
      // Firestore document limit ~1MB; base64 JPEG should be well under that.
      // Guard anyway: ~750 KB of base64 ≈ 1MB binary.
      if (dataUrl.length > 768000) {
        if (errEl) { errEl.textContent = _bbT('fab.fb.imgTooLarge', 'Screenshot is too large — please crop or resize it first.'); errEl.style.display = ''; }
        input.value = '';
        return;
      }
      _fbScreenshotData = dataUrl;
      if (thumb) thumb.src = dataUrl;
      if (preview) preview.style.display = '';
    } catch (_) {
      if (errEl) { errEl.textContent = _bbT('fab.fb.imgUnreadable', 'Could not read image — please try a different file.'); errEl.style.display = ''; }
      input.value = '';
    }
  };

  window._clearFbScreenshot = function () {
    _fbScreenshotData = null;
    const input   = document.getElementById('bbFbScreenshot');
    const preview = document.getElementById('bbFbScreenshotPreview');
    const thumb   = document.getElementById('bbFbScreenshotThumb');
    if (input)   input.value = '';
    if (thumb)   thumb.src = '';
    if (preview) preview.style.display = 'none';
  };

  /**
   * Open the feedback modal, resetting type selection and message field, and
   * filling in the page/version metadata line.
   */
  window.openFabFeedback = function () {
    _fbType = null;
    const _modal = document.getElementById('bbFabFeedbackModal');
    const _meta = document.getElementById('bbFbMeta');
    const _msg = document.getElementById('bbFbMessage');
    const _err = document.getElementById('bbFbError');
    document.querySelectorAll('.bb-fb-type-btn').forEach(b => b.classList.remove('selected'));
    if (_msg) _msg.value = '';
    if (_err) { _err.style.display = 'none'; _err.textContent = ''; }
    if (_meta) {
      const _page = document.title || window.location.pathname;
      const _ver = window._APP_VERSION ? ' · v' + window._APP_VERSION : '';
      _meta.textContent = _page + _ver;
    }
    window._clearFbScreenshot();
    if (_modal) _modal.classList.add('open');
  };
  /**
   * Close the feedback modal and fire the optional `_onFabFeedbackClose`
   * page hook (used by index/journal to advance onboarding state).
   */
  window.closeFabFeedback = function () {
    const _modal = document.getElementById('bbFabFeedbackModal');
    if (_modal) _modal.classList.remove('open');
    if (typeof window._onFabFeedbackClose === 'function') window._onFabFeedbackClose();
  };

  /**
   * Toggle which feedback-type chip is selected. Also reveals the optional
   * email input for bug reports (so we can follow up).
   * @param {'bug'|'comment'|'idea'} type
   */
  window.selectFabFeedbackType = function (type) {
    _fbType = type;
    document.querySelectorAll('.bb-fb-type-btn').forEach(b => b.classList.remove('selected'));
    const _map = { bug: 'bbFbTypeBug', comment: 'bbFbTypeComment', idea: 'bbFbTypeIdea' };
    const _el = document.getElementById(_map[type]);
    if (_el) _el.classList.add('selected');
    const _emailRow = document.getElementById('bbFbEmailRow');
    if (_emailRow) _emailRow.style.display = type === 'bug' ? '' : 'none';
  };
  /**
   * Validate and submit feedback to Firestore (`feedback` collection). Signs
   * the user in anonymously if they're a guest so the write is allowed by
   * the security rules. Shows a thank-you alert on success.
   * @returns {Promise<void>}
   */
  window.submitFabFeedback = async function () {
    const _errEl = document.getElementById('bbFbError');
    const _msgEl = document.getElementById('bbFbMessage');
    const _msg = _msgEl ? _msgEl.value.trim() : '';
    if (!_fbType) { if (_errEl) { _errEl.textContent = _bbT('fab.fb.pickType', 'Please pick a type.'); _errEl.style.display = ''; } return; }
    if (!_msg)    { if (_errEl) { _errEl.textContent = _bbT('fab.fb.writeFirst', 'Please write something first.'); _errEl.style.display = ''; } return; }
    const _notifyEl = document.getElementById('bbFbNotify');
    const _emailEl  = document.getElementById('bbFbEmail');
    const payload = {
      type: _fbType, message: _msg, page: window.location.pathname,
      version: window._APP_VERSION || null,
      platform: _getFbPlatform(),
      notify: _notifyEl ? _notifyEl.checked : false,
      email: (_emailEl && _emailEl.value.trim()) ? _emailEl.value.trim() : (window.currentUser ? window.currentUser.email || null : null),
      uid: window.currentUser ? window.currentUser.uid : null,
      ts: Date.now(),
      screenshot: _fbScreenshotData || null,
    };
    try {
      const _fb   = window.firebase;
      const _db   = window.db || (_fb && _fb.firestore ? _fb.firestore() : null);
      // Not every page mirrors its auth handle onto window (survival-kit keeps
      // `let auth`), so fall back to the SDK's own — and go by the SDK's real
      // session, not window.currentUser, which pages null out for anonymous users.
      const _auth = window.auth || (_fb && _fb.auth ? _fb.auth() : null);
      // No Firestore means nothing gets sent: say so, rather than thanking the
      // user for feedback that went nowhere.
      if (!_db) throw new Error('feedback: Firestore unavailable');
      // The rules only accept feedback from a signed-in session, so a guest
      // gets an anonymous one first.
      if (_auth && !_auth.currentUser) { try { await _auth.signInAnonymously(); } catch (e) {} }
      await _db.collection('feedback').add(payload);
      window.closeFabFeedback();
      alert(_bbT('fab.fb.thanks', 'Thanks for your feedback! 🐻'));
    } catch (e) {
      if (_errEl) { _errEl.textContent = _bbT('fab.fb.sendFail', 'Could not send — please try again.'); _errEl.style.display = ''; }
    }
  };

  /**
   * Tag feedback submissions with their runtime so we can triage by platform.
   * @returns {'native'|'pwa'|'web'}
   */
  function _getFbPlatform() {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return 'native';
    if (window.matchMedia('(display-mode: standalone)').matches) return 'pwa';
    return 'web';
  }

  // ── Extra FAB modals ──────────────────────────────────────────────────────

  /** Open the Statistics teaser modal — links across to journal.html. */
  window.openStatsModal = function () {
    const _m = document.getElementById('bbStatsModal');
    if (_m) _m.style.display = 'flex';
  };

  /**
   * Open the Goals modal, populating the list from the user's `dailyGoals`
   * localStorage entry (set by the survival-kit page). Empty-state message
   * shown when nothing is configured.
   */
  window.openGoalsModal = function () {
    const _list = document.getElementById('bbGoalsList');
    if (_list) {
      let _goals = [];
      try { _goals = JSON.parse(localStorage.getItem('dailyGoals') || '[]'); } catch (e) {}
      if (_goals.length === 0) {
        _list.innerHTML = '<div style="text-align:center;color:#adb5bd;font-size:0.9em;padding:16px 0;">' + _bbT('fab.goals.empty', 'No goals added yet.<br>Add goals in the Survival Kit.') + '</div>';
      } else {
        _list.innerHTML = _goals.map(g => `<div style="padding:12px 14px;background:#fff3e0;border-radius:12px;font-size:0.9em;color:#333;border-left:3px solid var(--brand-primary);">${g.text || g.title || String(g)}</div>`).join('');
      }
    }
    const _m = document.getElementById('bbGoalsModal');
    if (_m) _m.style.display = 'flex';
  };
  /** Hide the Goals modal. */
  window.closeGoalsModal = function () {
    const _m = document.getElementById('bbGoalsModal');
    if (_m) _m.style.display = 'none';
  };

  /** Currently displayed index into `_CELEBS` (random on load for variety). */
  let _celebIdx = Math.floor(Math.random() * _CELEBS.length);
  /** Wikipedia thumbnail URL cache, keyed by `wiki` slug. `null` = no thumbnail. */
  const _celebImgCache = {};

  /** Open the Celebrity modal showing the current celebrity. */
  window.openCelebModal = function () {
    _renderCeleb();
    const _m = document.getElementById('bbCelebModal');
    if (_m) _m.style.display = 'flex';
  };
  /** Hide the Celebrity modal. */
  window.closeCelebModal = function () {
    const _m = document.getElementById('bbCelebModal');
    if (_m) _m.style.display = 'none';
  };
  /** Advance to the next celebrity (wraps). */
  window.nextCeleb = function () {
    _celebIdx = (_celebIdx + 1) % _CELEBS.length;
    _renderCeleb();
  };

  /**
   * Paint name + field for the current celebrity and lazy-fetch their
   * Wikipedia thumbnail (cached per slug). Falls back to a ⭐ glyph when no
   * image is available or the fetch fails.
   * @returns {Promise<void>}
   */
  async function _renderCeleb() {
    const c = _CELEBS[_celebIdx];
    const _nameEl  = document.getElementById('bbCelebName');
    const _fieldEl = document.getElementById('bbCelebField');
    const _wikiEl  = document.getElementById('bbCelebWiki');
    const _photoWrap = document.getElementById('bbCelebPhotoWrap');
    if (_nameEl)  _nameEl.textContent  = c.name;
    if (_fieldEl) _fieldEl.textContent = c.field;
    if (_wikiEl)  _wikiEl.href = 'https://en.wikipedia.org/wiki/' + c.wiki;
    if (_photoWrap) {
      _photoWrap.textContent = '⭐';
      if (!_celebImgCache.hasOwnProperty(c.wiki)) {
        try {
          const _res = await fetch('https://en.wikipedia.org/w/api.php?action=query&titles=' + encodeURIComponent(c.wiki.replace(/_/g, ' ')) + '&prop=pageimages&format=json&pithumbsize=120&origin=*');
          const _data = await _res.json();
          const _pages = _data.query.pages;
          const _page = _pages[Object.keys(_pages)[0]];
          _celebImgCache[c.wiki] = (_page && _page.thumbnail) ? _page.thumbnail.source : null;
        } catch (e) { _celebImgCache[c.wiki] = null; }
      }
      const _src = _celebImgCache[c.wiki];
      if (_src) {
        _photoWrap.innerHTML = `<img src="${_src}" alt="${c.name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      }
    }
  }

  /**
   * Open the Quick Note modal with an empty textarea and focus it after a
   * short delay (gives the modal CSS time to settle on iOS).
   */
  window.openQuickNoteModal = function () {
    const _m   = document.getElementById('bbQuickNoteModal');
    const _inp = document.getElementById('bbQuickNoteInput');
    if (_inp) _inp.value = '';
    if (_m) _m.style.display = 'flex';
    setTimeout(() => { if (_inp) _inp.focus(); }, 120);
  };

  /** Hide the Quick Note modal. */
  window.closeQuickNoteModal = function () {
    const _m = document.getElementById('bbQuickNoteModal');
    if (_m) _m.style.display = 'none';
  };

  /**
   * Append the current textarea content to `bbQuickNotes` in localStorage
   * and show a transient "Note saved!" toast. Empty input → close-only.
   * Notes are read by journal.html on the next entry compose to surface
   * them as reminders.
   */
  window.saveQuickNote = function () {
    const _inp  = document.getElementById('bbQuickNoteInput');
    const _text = _inp ? _inp.value.trim() : '';
    window.closeQuickNoteModal();
    if (!_text) return;
    const _notes = JSON.parse(BB.storage.get('QuickNotes') || '[]');
    _notes.push({ text: _text, ts: Date.now(), id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5) });
    BB.storage.set('QuickNotes', JSON.stringify(_notes));
    const _t = document.createElement('div');
    _t.textContent = _bbT('fab.noteSaved', '📝 Note saved!');
    Object.assign(_t.style, { position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.72)', color: 'white', padding: '9px 18px', borderRadius: '20px',
      fontSize: '0.85em', fontWeight: '600', zIndex: '9999', pointerEvents: 'none', whiteSpace: 'nowrap' });
    (document.getElementById('app-shell') || document.body).appendChild(_t);
    setTimeout(() => _t.remove(), 2000);
  };

  // ── Shared auth modal ────────────────────────────────────────────────────
  // Sign-in / sign-up dialog used by every page that loads fab.js. The page
  // wires up optional hooks (_fabOnShowAuth, _fabOnCloseAuth, _fabOnSignOut,
  // _fabBeforeSignIn) before calling showAuthModal().

  /** Whether the auth modal is currently in sign-up mode (toggled by the link). */
  let _bbIsSignUp = false;

  /** Translate a key, falling back to the English literal if i18n isn't ready. */
  function _bbT(key, fallback) {
    return (window.BB && window.BB.t) ? window.BB.t(key) : fallback;
  }

  /** Build the sign-in/up toggle prompt with its highlighted link word. */
  function _bbToggleHtml(isSignUp) {
    const prompt = isSignUp ? _bbT('auth.hasAccount', 'Already have an account?')
                            : _bbT('auth.noAccount', "Don't have an account?");
    const link   = isSignUp ? _bbT('auth.signInLink', 'Sign in')
                            : _bbT('auth.signUpLink', 'Sign up');
    return prompt + ' <span style="color:var(--brand-primary);font-weight:600;">' + link + '</span>';
  }

  /**
   * Show the sign-in / sign-up dialog. Resets all fields and switches to
   * sign-in mode (reset by the toggle link). Fires `_fabOnShowAuth` if the
   * page provided one.
   */
  window.showAuthModal = function () {
    _bbIsSignUp = false;
    const title  = document.getElementById('bbAuthTitle');
    const submit = document.getElementById('bbAuthSubmit');
    const toggle = document.getElementById('bbAuthToggle');
    const err    = document.getElementById('bbAuthError');
    const email  = document.getElementById('bbAuthEmail');
    const pw     = document.getElementById('bbAuthPassword');
    if (title)  title.textContent = _bbT('auth.welcome', 'Welcome to Bipolar Bear 🐻');
    if (submit) submit.textContent = _bbT('common.signIn', 'Sign In');
    if (toggle) toggle.innerHTML = _bbToggleHtml(false);
    if (err)    { err.style.display = 'none'; err.textContent = ''; }
    if (email)  email.value = '';
    if (pw)     pw.value = '';
    const verEl = document.getElementById('bbAuthVersion');
    if (verEl) verEl.textContent = (window.BB && window.BB.versionLabel) ? window.BB.versionLabel() : '';
    const modal = document.getElementById('bbAuthModal');
    if (modal) modal.classList.add('active');
    if (typeof window._fabOnShowAuth === 'function') window._fabOnShowAuth();
  };

  /**
   * Hide the auth modal and fire the optional `_fabOnCloseAuth` page hook.
   */
  window.closeAuthModal = function () {
    const modal = document.getElementById('bbAuthModal');
    if (modal) modal.classList.remove('active');
    if (typeof window._fabOnCloseAuth === 'function') window._fabOnCloseAuth();
  };

  /**
   * Show the account-management dialog (signed-in users only). Reads the
   * current Firebase Auth user fresh each call. Resets all sub-panels
   * (change password / change email) to their collapsed state.
   */
  window.showAccountModal = function () {
    const _fb  = window.firebase;
    const user = _fb && _fb.auth ? _fb.auth().currentUser : null;
    const emailEl    = document.getElementById('bbAccountEmail');
    const msg        = document.getElementById('bbAccountMsg');
    const passFields = document.getElementById('bbAccountPassFields');
    const passToggle = document.getElementById('bbAccountPassToggleBtn');
    const cp         = document.getElementById('bbAccountCurrentPass');
    const np         = document.getElementById('bbAccountNewPass');
    if (emailEl && user) emailEl.textContent = user.email || '';
    if (msg)        { msg.style.display = 'none'; msg.textContent = ''; }
    if (passFields) passFields.style.display = 'none';
    if (passToggle) passToggle.style.display = '';
    if (cp) cp.value = '';
    if (np) np.value = '';
    const emailFields  = document.getElementById('bbAccountEmailFields');
    const emailToggle  = document.getElementById('bbAccountEmailToggleBtn');
    const newEmailEl   = document.getElementById('bbAccountNewEmail');
    const emailPassEl  = document.getElementById('bbAccountEmailPass');
    if (emailFields) emailFields.style.display = 'none';
    if (emailToggle) emailToggle.style.display = '';
    if (newEmailEl)  newEmailEl.value  = '';
    if (emailPassEl) emailPassEl.value = '';
    const langSel = document.getElementById('bbLangSelect');
    if (langSel && window.BB && window.BB.i18n) langSel.value = window.BB.i18n.getLang();
    // Protected demo/owner account can't be deleted — mirrors the same guard
    // on the journal Danger Zone (see _protected in js/journal.js).
    const _protected = !!(user && user.email === 'inbox@jamesmarkey.co.uk');
    const delSection = document.getElementById('bbAccountDeleteSection');
    const delLocked  = document.getElementById('bbAccountDeleteLocked');
    if (delSection) delSection.style.display = _protected ? 'none' : '';
    if (delLocked)  delLocked.style.display  = _protected ? '' : 'none';
    const verEl = document.getElementById('bbAccountVersion');
    if (verEl) verEl.textContent = (window.BB && window.BB.versionLabel) ? window.BB.versionLabel() : '';
    const modal = document.getElementById('bbAccountModal');
    if (modal) modal.classList.add('active');
    if (typeof window._fabOnShowAuth === 'function') window._fabOnShowAuth();
  };

  // (Version label string is built by BB.versionLabel() in
  // js/shared/version-check.js — single source of truth shared with the
  // home-screen version chip.)

  /** Hide the account modal. */
  window.closeAccountModal = function () {
    const modal = document.getElementById('bbAccountModal');
    if (modal) modal.classList.remove('active');
  };

  /**
   * Sign-out handler for the account modal. Prefers the page-supplied
   * `_fabOnSignOut` hook (lets index/journal clear localStorage, cancel
   * notifications, etc.) and falls back to a plain Firebase sign-out.
   */
  window._bbAccountLogout = function () {
    window.closeAccountModal();
    if (typeof window._fabOnSignOut === 'function') {
      window._fabOnSignOut();
    } else {
      const _fb = window.firebase;
      if (_fb && _fb.auth) _fb.auth().signOut();
    }
  };

  /**
   * Account-deletion handler for the account modal (App Store 5.1.1(v)).
   * index.html and journal.html both define confirmDeleteAll() — the full
   * re-auth → Firestore wipe → user.delete() flow. survival-kit.html has no
   * such code, so it hands off to the home page via ?deleteAccount=1 rather
   * than duplicating the destructive path a third time.
   */
  window._bbAccountDelete = function () {
    window.closeAccountModal();
    if (typeof window.confirmDeleteAll === 'function') {
      window.confirmDeleteAll();
    } else {
      location.href = 'index.html?deleteAccount=1';
    }
  };

  /**
   * Show a transient status banner inside the account modal.
   * @param {string} text Message to display.
   * @param {boolean} ok  true → green/success, false → red/error.
   */
  function _bbAccountShowMsg(text, ok) {
    const msg = document.getElementById('bbAccountMsg');
    if (!msg) return;
    msg.textContent      = text;
    msg.style.color      = ok ? '#2ECC40'                  : '#dc3545';
    msg.style.background = ok ? 'rgba(46,204,64,0.08)'    : 'rgba(220,53,69,0.08)';
    msg.style.display    = 'block';
  }

  /**
   * Validate inputs, re-authenticate with the current password, then call
   * Firebase `updatePassword`. Shows a green status on success or a red
   * "Current password is incorrect" / generic error otherwise.
   */
  window._bbSubmitPasswordChange = function () {
    const _fb  = window.firebase;
    const user = _fb && _fb.auth ? _fb.auth().currentUser : null;
    if (!user) return;
    const currentPass = (document.getElementById('bbAccountCurrentPass').value || '').trim();
    const newPass     = (document.getElementById('bbAccountNewPass').value     || '').trim();
    if (!currentPass || !newPass) { _bbAccountShowMsg(_bbT('account.msg.fillBothFields', '⚠️ Please fill in both fields.'), false); return; }
    if (newPass.length < 6)       { _bbAccountShowMsg(_bbT('account.msg.passwordTooShort', '⚠️ New password must be at least 6 characters.'), false); return; }
    const credential = _fb.auth.EmailAuthProvider.credential(user.email, currentPass);
    user.reauthenticateWithCredential(credential)
      .then(() => user.updatePassword(newPass))
      .then(() => {
        _bbAccountShowMsg(_bbT('account.msg.passwordUpdated', '✅ Password updated successfully.'), true);
        document.getElementById('bbAccountPassFields').style.display  = 'none';
        document.getElementById('bbAccountPassToggleBtn').style.display = '';
        document.getElementById('bbAccountCurrentPass').value = '';
        document.getElementById('bbAccountNewPass').value     = '';
      })
      .catch(err => {
        const wrongPass = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential';
        _bbAccountShowMsg(wrongPass ? _bbT('account.msg.wrongPassword', '⚠️ Current password is incorrect.') : (err.message ? '⚠️ ' + err.message : _bbT('account.msg.passwordUpdateFailed', '⚠️ Could not update password.')), false);
      });
  };

  /**
   * Validate inputs, re-authenticate with the current password, then call
   * Firebase `updateEmail`. Distinguishes between wrong-password,
   * email-already-in-use, and generic errors in the status banner.
   */
  window._bbSubmitEmailChange = function () {
    const _fb  = window.firebase;
    const user = _fb && _fb.auth ? _fb.auth().currentUser : null;
    if (!user) return;
    const newEmail  = (document.getElementById('bbAccountNewEmail').value  || '').trim();
    const pass      = (document.getElementById('bbAccountEmailPass').value || '').trim();
    if (!newEmail || !pass) { _bbAccountShowMsg(_bbT('account.msg.fillBothFields', '⚠️ Please fill in both fields.'), false); return; }
    if (!newEmail.includes('@') || !newEmail.includes('.')) { _bbAccountShowMsg(_bbT('account.msg.invalidEmail', '⚠️ Please enter a valid email address.'), false); return; }
    const credential = _fb.auth.EmailAuthProvider.credential(user.email, pass);
    user.reauthenticateWithCredential(credential)
      .then(() => user.updateEmail(newEmail))
      .then(() => {
        _bbAccountShowMsg(_bbT('account.msg.emailUpdated', '✅ Email updated to {email}').replace('{email}', newEmail), true);
        document.getElementById('bbAccountEmail').textContent = newEmail;
        document.getElementById('bbAccountEmailFields').style.display   = 'none';
        document.getElementById('bbAccountEmailToggleBtn').style.display = '';
        document.getElementById('bbAccountNewEmail').value = '';
        document.getElementById('bbAccountEmailPass').value = '';
      })
      .catch(err => {
        const wrongPass = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential';
        const inUse     = err.code === 'auth/email-already-in-use';
        _bbAccountShowMsg(wrongPass ? _bbT('account.msg.wrongPassword', '⚠️ Current password is incorrect.') : inUse ? _bbT('account.msg.emailInUse', '⚠️ That email is already in use.') : (err.message ? '⚠️ ' + err.message : _bbT('account.msg.emailUpdateFailed', '⚠️ Could not update email.')), false);
      });
  };

  /**
   * Attach the toggle-mode and submit handlers for the auth modal. Called
   * once from `_injectHTML` after the modal markup is in the DOM.
   *
   * Submit behaviour:
   *   - Sign in: Firebase `signInWithEmailAndPassword`, then close modal.
   *   - Sign up: createUser, then close modal. Email verification is handled
   *     on the Bipolar Anonymous board, not here.
   */
  function _bbWireAuthListeners() {
    const toggle = document.getElementById('bbAuthToggle');
    const submit = document.getElementById('bbAuthSubmit');
    if (toggle) {
      toggle.addEventListener('click', function () {
        _bbIsSignUp = !_bbIsSignUp;
        const titleEl  = document.getElementById('bbAuthTitle');
        const submitEl = document.getElementById('bbAuthSubmit');
        const errEl    = document.getElementById('bbAuthError');
        if (titleEl)  titleEl.textContent  = _bbIsSignUp ? _bbT('auth.createAccount', 'Create Account') : _bbT('auth.welcome', 'Welcome to Bipolar Bear 🐻');
        if (submitEl) submitEl.textContent = _bbIsSignUp ? _bbT('common.signUp', 'Sign Up') : _bbT('common.signIn', 'Sign In');
        toggle.innerHTML = _bbToggleHtml(_bbIsSignUp);
        if (errEl) errEl.style.display = 'none';
      });
    }
    if (submit) {
      submit.addEventListener('click', async function () {
        const _fb = window.firebase;
        if (!_fb || !_fb.auth) return;
        const auth     = _fb.auth();
        const email    = (document.getElementById('bbAuthEmail').value    || '').trim();
        const password =  document.getElementById('bbAuthPassword').value || '';
        const errEl    =  document.getElementById('bbAuthError');
        if (errEl) errEl.style.display = 'none';
        if (typeof window._fabBeforeSignIn === 'function') window._fabBeforeSignIn();
        try {
          if (_bbIsSignUp) {
            await auth.createUserWithEmailAndPassword(email, password);
            window.closeAuthModal();
            // Brand-new account: let the page react (index.js opens the
            // profile popup to surface the customise toggles).
            if (typeof window._fabOnSignUp === 'function') window._fabOnSignUp();
          } else {
            await auth.signInWithEmailAndPassword(email, password);
            window.closeAuthModal();
          }
        } catch (e) {
          if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
        }
      });
    }
  }

  // ── Hide permanently ──────────────────────────────────────────────────────

  /**
   * Permanently hide a default FAB. Closes the matching modal, sets the
   * relevant `bbXxxFabHidden` flag, re-renders the dock and syncs to
   * Firestore. The hidden FAB then appears in the picker as a re-addable
   * option.
   *
   * @param {'chat'|'wa'|'quicknote'|'feedback'|'coffee'|'review'} type
   */
  window._showHidePermanently = function (type) {
    if (type === 'chat' || type === 'wa') {
      window.closeChatModal();
      BB.storage.set('WaFabHidden', '1');
    } else if (type === 'quicknote') {
      window.closeSecurityModal();
      BB.storage.set('QuickNoteFabHidden', '1');
    } else if (type === 'feedback') {
      window.closeFabFeedback();
      BB.storage.set('FeedbackFabHidden', '1');
    } else if (type === 'coffee') {
      window.closeCoffeeModal();
      BB.storage.set('CoffeeFabHidden', '1');
    } else if (type === 'review') {
      window.closeReviewModal();
      BB.storage.set('ReviewFabHidden', '1');
    }
    _applyFabDock();
    _syncFabsToFirestore();
  };

})();
