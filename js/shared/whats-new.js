/**
 * @file js/shared/whats-new.js — BB.whatsNew: the "New features" sheet
 * (James, 2026-10-20: "every time we add a major new feature … a message when
 * they first open the app [that] says 'New features' and shows the switches …
 * to activate the new features"). A suite-wide rule: @unisim/sdk will get a
 * React copy of this, so the registry shape below is kept plain and portable.
 * DOCS.md §2.25 is the reference.
 *
 * Registry (one per app), keyed by release:
 *
 *   { '<version>': [ {
 *       id:       'bloodCharts',              // stable, unique in the release
 *       icon:     '🩸',
 *       titleKey: 'whatsnew.b144BloodTitle',  // i18n keys (the page's BB.t)
 *       bodyKey:  'whatsnew.b144BloodBody',   // ONE plain sentence
 *       setting:  { key: 'bbBloodOnCharts',   // the SAME setting as in Settings
 *                   get: () => boolean,
 *                   set: (on) => boolean | string | Promise<boolean|string> },
 *                 // set → true when it took, false / a message when it didn't
 *                 // (the switch then shows what get() says, and the message).
 *                 // setting: null → a one-line note with no switch.
 *       applies:  () => boolean,              // only items that apply are shown
 *   } ] }
 *
 * seenVersion: a localStorage key (Bipolar Bear: `bbWhatsNewSeen`) holding the
 * newest release already shown or skipped. Reset clears it.
 *
 *   var wn = BB.whatsNew.create({ releases, seenKey, t })
 *   wn.shouldShow({ isFreshInstall, isBlocked }) → boolean
 *     false when the newest release is already seen; when isFreshInstall()
 *     (onboarding not done) it marks it seen without showing (a new user has
 *     nothing to "update" from); false while isBlocked() (PIN lock, a crisis
 *     or safety-plan sheet, any open dialog, an entry in progress); when no
 *     item applies it marks it seen. Otherwise true.
 *   wn.show()    the sheet; marks the release seen. Every switch starts as
 *                get() says (all off for a new feature): nothing turns on
 *                without a tap.
 *   wn.start({ isFreshInstall, isBlocked }) waits until the screen is idle
 *                (visible, not blocked, no touch / key for a moment) and shows
 *                it once. Gives up after a few minutes; the next page load
 *                tries again.
 *   BB.whatsNew.screenBusy()  the generic "something is on top" check.
 *
 * Bipolar Bear's entries are in bearReleases() at the bottom; js/index.js and
 * js/journal.js call BB.whatsNew.startBear().
 */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /** -1 / 0 / 1 for dotted versions ('1.44' < '1.45' < '1.100'). */
  function cmp(a, b) {
    var x = String(a || '0').split('.'), y = String(b || '0').split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (Number(x[i]) || 0) - (Number(y[i]) || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  // Anything on top of the page: the PIN screens, the sign-in sheet, the
  // splash, the crisis chat / safety plan, and any open dialog or modal.
  var BLOCKERS = ['#guestPinOverlay', '#pinOverlay', '#pinSleepOverlay', '#pinE2eeModal', '#bbPinReauth',
    '#bbAuthSplash', '#bbAuthModal', '#bbHintOverlay', '#bbWelcomeModal', '.bb-fab-modal.open', '.confirm-modal.active',
    '.bbm-back', '.bbsp-sheet', '[aria-modal="true"]', '.bbwn-back'];
  function visible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    try {
      var cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
    } catch (_) { return true; }
  }
  function screenBusy() {
    for (var i = 0; i < BLOCKERS.length; i++) {
      var list;
      try { list = document.querySelectorAll(BLOCKERS[i]); } catch (_) { continue; }
      for (var j = 0; j < list.length; j++) if (visible(list[j])) return true;
    }
    return false;
  }

  var _lastInput = Date.now();
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
    try { document.addEventListener(ev, function () { _lastInput = Date.now(); }, { capture: true, passive: true }); } catch (_) {}
  });

  var STYLE =
    '.bbwn-back{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px 12px calc(16px + env(safe-area-inset-bottom,0px));}' +
    '.bbwn-sheet{background:#fff;color:#212529;width:100%;max-width:420px;max-height:calc(100vh - 32px);overflow-y:auto;border-radius:20px;padding:20px 18px 16px;box-shadow:0 10px 40px rgba(0,0,0,.25);font-family:inherit;animation:bbwnUp .22s ease;}' +
    '@keyframes bbwnUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}' +
    '@media (prefers-reduced-motion: reduce){.bbwn-sheet{animation:none}}' +
    '.bbwn-h{font-size:1.2em;font-weight:800;margin:0;text-align:center}' +
    '.bbwn-v{text-align:center;font-size:.82em;color:#6c5f52;margin:2px 0 14px;font-weight:600}' +
    '.bbwn-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}' +
    '.bbwn-item{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1.5px solid #e9ecef;border-radius:14px;text-align:left}' +
    '.bbwn-ico{font-size:1.5em;line-height:1;flex:0 0 auto}' +
    '.bbwn-txt{flex:1 1 auto;min-width:0}.bbwn-t{display:block;font-weight:700;font-size:.92em;cursor:pointer}.bbwn-note .bbwn-t{cursor:default}' +
    '.bbwn-b{font-size:.8em;color:#5c534a;line-height:1.4;margin-top:2px}' +
    '.bbwn-msg{font-size:.78em;color:#c92a2a;margin-top:4px}.bbwn-msg:empty{display:none}' +
    '.bbwn-sw{position:relative;flex:0 0 auto;width:50px;height:30px}' +
    '.bbwn-sw input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;z-index:1}' +
    '.bbwn-sw span{position:absolute;inset:0;border-radius:15px;background:#ccc;transition:background .2s}' +
    '.bbwn-sw span:before{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .2s}' +
    '.bbwn-sw input:checked+span{background:var(--brand-primary,#ff9500)}.bbwn-sw input:checked+span:before{left:23px}' +
    '.bbwn-sw input:focus-visible+span{outline:2px solid var(--brand-primary,#ff9500);outline-offset:2px}' +
    '.bbwn-sw input:disabled+span{opacity:.6}' +
    '.bbwn-later{font-size:.8em;color:#6c5f52;text-align:center;margin:12px 0 10px}' +
    '.bbwn-done{width:100%;padding:13px;min-height:48px;border:none;border-radius:12px;background:var(--brand-btn,#c2410c);color:var(--brand-btn-text,#fff);box-shadow:var(--brand-btn-ring,none);font:inherit;font-weight:700;font-size:1em;cursor:pointer}' +
    'html.theme-dark .bbwn-sheet{background:#2a221b;color:#f3e9dc}html.theme-dark .bbwn-item{border-color:#4a3d31}' +
    'html.theme-dark .bbwn-v,html.theme-dark .bbwn-later{color:#c9b8a5}html.theme-dark .bbwn-b{color:#d8c9b6}' +
    'html.theme-dark .bbwn-sw span{background:#5a4a3a}html.theme-dark .bbwn-sw span:before{background:#f5ebdd}html.theme-dark .bbwn-msg{color:#ff8787}' +
    // ⚠️ After the dark track: `html.theme-dark .bbwn-sw span` has the same
    // specificity as `.bbwn-sw input:checked+span`, so without this an ON
    // switch stayed brown in dark mode (only the knob moved). css/dark.css
    // does the same for the settings page's .bb-switch.
    'html.theme-dark .bbwn-sw input:checked+span{background:var(--brand-primary,#ff9500)}';
  function injectStyle() {
    if (document.getElementById('bbwnStyle')) return;
    var st = document.createElement('style');
    st.id = 'bbwnStyle';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  function create(opts) {
    var releases = opts.releases || {};
    var seenKey = opts.seenKey || 'bbWhatsNewSeen';
    var t = opts.t || function (k, v) { try { return BB.t(k, v); } catch (_) { return k; } };
    function latest() {
      return Object.keys(releases).sort(cmp).pop() || null;
    }
    function isSeen(v) { var s = lsGet(seenKey); return !!s && cmp(s, v) >= 0; }
    function markSeen() { var v = latest(); if (v) lsSet(seenKey, v); }
    function items() {
      var v = latest();
      return (v ? releases[v] || [] : []).filter(function (it) {
        try { return typeof it.applies !== 'function' || !!it.applies(); } catch (_) { return false; }
      });
    }
    function shouldShow(o) {
      o = o || {};
      var v = latest();
      if (!v || isSeen(v)) return false;
      if (o.isFreshInstall && o.isFreshInstall()) { markSeen(); return false; }
      if (o.isBlocked && o.isBlocked()) return false;
      if (!items().length) { markSeen(); return false; }
      return true;
    }
    function show() {
      var v = latest(), list = items();
      markSeen();
      if (!list.length || document.querySelector('.bbwn-back')) return null;
      injectStyle();
      var back = document.createElement('div');
      back.className = 'bbwn-back';
      var rows = list.map(function (it, i) {
        var id = 'bbwn_' + i;
        var title = t(it.titleKey), body = t(it.bodyKey);
        var on = false;
        try { on = !!(it.setting && it.setting.get()); } catch (_) {}
        return '<li class="bbwn-item' + (it.setting ? '' : ' bbwn-note') + '" data-id="' + esc(it.id) + '">' +
          '<span class="bbwn-ico" aria-hidden="true">' + esc(it.icon) + '</span>' +
          '<div class="bbwn-txt">' + (it.setting ? '<label class="bbwn-t" for="' + id + '">' + esc(title) + '</label>' : '<span class="bbwn-t">' + esc(title) + '</span>') +
          '<div class="bbwn-b" id="' + id + '_d">' + esc(body) + '</div><div class="bbwn-msg" role="status" aria-live="polite"></div></div>' +
          (it.setting ? '<span class="bbwn-sw"><input type="checkbox" role="switch" id="' + id + '" data-i="' + i + '" aria-describedby="' + id + '_d"' + (on ? ' checked' : '') + '><span></span></span>' : '') +
          '</li>';
      }).join('');
      var hasSwitch = list.some(function (it) { return !!it.setting; });
      back.innerHTML = '<div class="bbwn-sheet" role="dialog" aria-modal="true" aria-labelledby="bbwnTitle" aria-describedby="bbwnVer">' +
        '<h2 class="bbwn-h" id="bbwnTitle" tabindex="-1">✨ ' + esc(t('whatsnew.title')) + '</h2>' +
        '<div class="bbwn-v" id="bbwnVer">' + esc(t('whatsnew.newIn', { v: v })) + '</div>' +
        '<ul class="bbwn-list">' + rows + '</ul>' +
        (hasSwitch ? '<div class="bbwn-later">' + esc(t('whatsnew.changeLater')) + '</div>' : '<div style="height:12px"></div>') +
        '<button type="button" class="bbwn-done">' + esc(t('whatsnew.done')) + '</button></div>';
      var opener = document.activeElement;
      function close() {
        back.remove();
        document.removeEventListener('keydown', onKey, true);
        try { if (opener && opener.focus) opener.focus(); } catch (_) {}
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key !== 'Tab') return;
        var f = back.querySelectorAll('input,button');
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      Array.prototype.forEach.call(back.querySelectorAll('input[data-i]'), function (el) {
        el.addEventListener('change', function () {
          var it = list[Number(el.getAttribute('data-i'))], want = !!el.checked;
          var msg = el.closest('.bbwn-item').querySelector('.bbwn-msg');
          msg.textContent = '';
          el.disabled = true;
          Promise.resolve().then(function () { return it.setting.set(want); }).then(function (r) {
            if (typeof r === 'string' && r) msg.textContent = r;
          }, function () {}).then(function () {
            el.disabled = false;
            try { el.checked = !!it.setting.get(); } catch (_) {}
            if (typeof opts.onChange === 'function') { try { opts.onChange(it.id, el.checked); } catch (_) {} }
          });
        });
      });
      back.querySelector('.bbwn-done').addEventListener('click', close);
      back.addEventListener('click', function (e) { if (e.target === back) close(); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(back);
      try { back.querySelector('#bbwnTitle').focus(); } catch (_) {}
      return back;
    }
    var _timer = null;
    function start(o) {
      o = o || {};
      var idleMs = o.idleMs == null ? 2500 : o.idleMs, pollMs = o.pollMs || 1000, giveUp = Date.now() + (o.giveUpMs || 5 * 60e3);
      clearTimeout(_timer);
      (function tick() {
        var v = latest();
        if (!v || isSeen(v) || Date.now() > giveUp) return;
        var ready = document.visibilityState !== 'hidden' && Date.now() - _lastInput >= idleMs;
        if (ready && shouldShow(o)) { show(); return; }
        if (v && isSeen(v)) return; // marked seen (fresh install / nothing applies)
        _timer = setTimeout(tick, pollMs);
      })();
    }
    return { latest: latest, items: items, shouldShow: shouldShow, show: show, start: start, markSeen: markSeen, isSeen: isSeen };
  }

  // ── Bipolar Bear ───────────────────────────────────────────────────────────
  var SEEN_KEY = 'bbWhatsNewSeen';
  var BIO_ICON = { face: '🙂', touch: '👆', finger: '👆', other: '🔓' };
  /**
   * ctx: { bioMode(): 'native'|'guest'|null (a PIN lock this phone can
   * unlock with a scan), bioType: 'face'|'touch'|'finger'|'other'|null
   * (resolved before; null = no biometrics), isNative(): boolean,
   * afterChange?(id) }
   */
  function bearReleases(ctx) {
    var bt = ctx.bioType || 'other';
    return {
      '1.44': [
        { id: 'bloodCharts', icon: '🩸', titleKey: 'whatsnew.b144BloodTitle', bodyKey: 'whatsnew.b144BloodBody',
          setting: {
            key: 'bbBloodOnCharts',
            get: function () { return !!(BB.bloodCharts && BB.bloodCharts.isOn()); },
            set: function (on) { return BB.bloodCharts.set(on); },
          },
          applies: function () { return !!BB.bloodCharts; } },
        { id: 'bioUnlock', icon: BIO_ICON[bt] || '🔓', titleKey: 'bio144.' + bt, bodyKey: 'bio144.rowDesc',
          setting: {
            key: 'bbBioUnlock',
            get: function () { return !!(BB.bioUnlock && BB.bioUnlock.isOn()); },
            set: function (on) {
              if (!on) return BB.bioUnlock.turnOff().then(function () { return true; });
              var mode = ctx.bioMode();
              if (!mode) return false;
              return BB.bioUnlock.turnOn({ guest: mode === 'guest' }).then(function (r) {
                return r === 'ok' ? true : BB.bioUnlock.text(r === 'needUnlock' ? 'needUnlock' : 'turnOnFailed');
              });
            },
          },
          applies: function () { return !!(BB.bioUnlock && ctx.bioType && ctx.bioMode()); } },
        // The mood buttons on the daily reminder are always there (no switch):
        // a note, on phones only.
        { id: 'moodButtons', icon: '🔔', titleKey: 'whatsnew.b144MoodTitle', bodyKey: 'whatsnew.b144MoodBody',
          setting: null, applies: function () { return !!ctx.isNative(); } },
      ],
    };
  }
  /** Existing user = onboarding done, or entries already on this device. */
  function bearFreshInstall() {
    var step = 0;
    try { step = BB.onboarding && BB.onboarding.getStep ? BB.onboarding.getStep() : 0; } catch (_) {}
    var has = false;
    try { has = !!(BB.storage && BB.storage.get('HasEntries') === '1'); } catch (_) {}
    return !(step >= 12 || has);
  }
  /**
   * Start Bipolar Bear's sheet on this page. opts: { isBusy(): boolean (the
   * page's own "mid-entry" etc.), bioMode(), isNative(), onChange? }.
   * Resolves the engine (tests use it).
   */
  function startBear(opts) {
    opts = opts || {};
    var isNative = opts.isNative || function () { try { return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); } catch (_) { return false; } };
    var bioMode = opts.bioMode || function () { return null; };
    // Whether the phone has Face ID / a fingerprint is asked once here; whether
    // a PIN lock is on (bioMode) is asked each time the sheet is considered.
    var bio = isNative() && BB.bioUnlock ? BB.bioUnlock.available() : Promise.resolve({ ok: false });
    return Promise.resolve(bio).catch(function () { return { ok: false }; }).then(function (a) {
      var ctx = { bioMode: bioMode, bioType: a && a.ok ? a.type : null, isNative: isNative };
      var wn = create({ releases: bearReleases(ctx), seenKey: SEEN_KEY, onChange: opts.onChange });
      wn.start({
        isFreshInstall: bearFreshInstall,
        isBlocked: function () { return screenBusy() || !!(opts.isBusy && opts.isBusy()); },
        idleMs: opts.idleMs, pollMs: opts.pollMs,
      });
      BB.whatsNew.current = wn;
      return wn;
    });
  }

  BB.whatsNew = {
    create: create,
    screenBusy: screenBusy,
    compare: cmp,
    SEEN_KEY: SEEN_KEY,
    bearReleases: bearReleases,
    bearFreshInstall: bearFreshInstall,
    startBear: startBear,
    current: null,
  };
})();
