/**
 * My safety plan, and the gentle "things have been hard lately" card.
 *
 * ── My safety plan ─────────────────────────────────────────────────────────
 * A plan the person writes ahead of time, while they feel OK, in the
 * Stanley-Brown Safety Planning format (the approach behind the NHS-backed
 * Staying Safe plan): warning signs → things I can do on my own → people and
 * places that take my mind off things → people I can ask for help →
 * professionals and services → making where I am safer → reasons for living.
 *
 * Where it is stored, and why:
 *   - On this device, in localStorage `bbSafetyPlan` (JSON, see blankPlan()),
 *     like the rest of the Survival Kit. It has to be: the plan is for a
 *     crisis, so it must open offline, instantly, and (only if the person
 *     opts in) from the PIN lock screen before anything is unlocked.
 *   - Signed in: ALSO in the person's own `userSettings/{uid}` doc, but only
 *     as `safetyPlanEnc` — AES-GCM ciphertext under the same end-to-end data
 *     key the journal entries use (sessionStorage `bb_user_key`, put there by
 *     js/journal.js). The plaintext never leaves the device, so the plan is
 *     unreadable to anyone but the person even if the Firestore rules were
 *     ever loosened. When the key isn't in this session yet (the journal
 *     hasn't been opened) the plan just stays local and is pushed later.
 *     Never written to any new or shared collection.
 *   - Guests: this device only.
 * Conflict rule (sync()): a device that has never synced takes the account's
 * copy if there is one (same "never overwrite the account" rule as
 * js/shared/guest-data.js); after that, the newer `updatedAt` wins.
 * Cleared on logout and on reset/delete with the other Survival Kit data
 * (BB.safetyPlan.clearLocal()).
 *
 * Opt-ins, both unticked by default (suite convention):
 *   bbSafetyPlanOnLock = '1'  → a "🛟 My safety plan" button on both PIN lock
 *                               screens opens the plan read-only.
 *   contact.onWidget = true   → that one phone number goes to the native
 *                               "Call for support" home-screen widget
 *                               (BipolarBearWidget setSharedData `safetyCall`).
 *                               Without one the widget offers the country's
 *                               crisis line (js/shared/crisis.js) instead.
 *
 * ── The low-days card ──────────────────────────────────────────────────────
 * When 3 or more of the last 5 logged days (within the last 10, auto-filled
 * estimates ignored) were Depressed — the lowest of the five moods, or 0–1 on
 * the spectrum — and the most recent of them is still Low or Depressed, a
 * calm, dismissible card offers the person's own people from the plan, then
 * the crisis lines for the country they're in. Never a pop-up, never a push.
 * Shown at most once every 4 days (the card stays for the rest of the day it
 * first appears until dismissed). Turned off by the journal setting
 * "Don't suggest support when I've had low days" (bbLowMoodSupportOff = '1',
 * unticked by default) or the card's own "Don't suggest this again".
 * Evaluated by the journal from decrypted entries (it alone sees autoFilled);
 * the home page only reads the resulting `bbLowMoodDue` date and draws the
 * card once the PIN lock (if any) is open. Device-only, nothing synced.
 * Wording follows the Samaritans guidance for online services: kind, no
 * assumptions, short, two or three signposts, 24/7 services, user in control.
 *
 * Exposes window.BB.safetyPlan and window.BB.lowMoodSupport. The pure
 * detection helpers are module.exports under Node for scripts/test-safety-plan.js.
 *
 * Loaded on index / journal / survival-kit after js/shared/i18n.js and
 * js/shared/crisis.js. Strings live under `safety.*` in i18n.js.
 *
 * @file js/shared/safety-plan.js
 */
(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var PLAN_KEY = 'bbSafetyPlan';
  var SYNCED_KEY = 'bbSafetyPlanSyncedAt';
  var LOCK_KEY = 'bbSafetyPlanOnLock';
  var LOW_OFF_KEY = 'bbLowMoodSupportOff';
  var LOW_DUE_KEY = 'bbLowMoodDue';
  var LOW_SHOWN_KEY = 'bbLowMoodShown';
  var LOW_DISMISSED_KEY = 'bbLowMoodDismissed';
  var LOW_GAP_DAYS = 4;
  var MAX_ITEMS = 20;
  var MAX_LEN = 300;

  // Section order is the Stanley-Brown order: what I notice → what I can do
  // alone → who / where takes my mind off it → who I can ask → professionals →
  // making things safer → why it matters.
  var SECTIONS = [
    { id: 'warningSigns',  icon: '🌦️', kind: 'text' },
    { id: 'coping',        icon: '🧘', kind: 'text' },
    { id: 'distraction',   icon: '🚶', kind: 'text' },
    { id: 'helpPeople',    icon: '🤝', kind: 'contact' },
    { id: 'professionals', icon: '🩺', kind: 'contact' },
    { id: 'safeEnv',       icon: '🏠', kind: 'text' },
    { id: 'reasons',       icon: '💛', kind: 'text' },
  ];

  // English fallbacks, used only if a key is missing from js/shared/i18n.js.
  var EN = {
    plan: {
      title: 'My safety plan', lockBtn: '🛟 My safety plan',
      intro: "Write this while you're feeling OK, so it's ready if a hard moment comes. Start anywhere: a few words in one section is a good start.",
      viewIntro: 'You made this plan for moments like this. Take it one step at a time, starting at the top.',
      emptyAll: "You haven't written a safety plan yet.",
      write: 'Write my plan', edit: 'Edit', done: 'Done', close: 'Close', add: 'Add',
      remove: 'Remove {item}', name: 'Name', phone: 'Phone number', call: 'Call {name}',
      onLock: 'Show my safety plan on the lock screen',
      onLockDesc: 'Lets you read it without your PIN. Anyone holding your phone could read it too.',
      onWidget: 'Call from the home-screen widget',
      widgetHelp: 'Add the “Call for support” widget to your home screen to call this person in one tap.',
      savedSignedIn: 'Saved on this phone and, end-to-end encrypted, to your account. Only you can read it.',
      savedGuest: 'Saved on this phone only.',
      delete: 'Delete my safety plan',
      deleteConfirm: "Delete your whole safety plan? This can't be undone.",
      crisisHeading: 'Someone to talk to, any time',
      source: 'Based on the Stanley-Brown Safety Plan, the approach behind the NHS-backed Staying Safe plan.',
      bannerSub: 'Warning signs, people to call, reasons to keep going',
      bannerSubEmpty: "Write it now, while you're feeling OK",
      widgetTitle: 'Call for support', widgetEmpty: 'Choose someone in My safety plan',
      fromPlan: 'From my safety plan',
    },
    sec: {
      warningSigns: { title: 'Warning signs', hint: 'Thoughts, feelings or situations that tell me a hard time might be starting', ph: 'e.g. not sleeping, keeping away from people' },
      coping: { title: 'Things I can do on my own', hint: 'To take my mind off things for a while, without needing anyone else', ph: 'e.g. a walk, a hot shower, my playlist' },
      distraction: { title: 'People and places that take my mind off things', hint: "Somewhere to go or someone to be with. I don't have to talk about how I feel", ph: 'e.g. the café on the corner, my cousin' },
      helpPeople: { title: 'People I can ask for help', hint: "Friends or family I can tell how I'm really feeling" },
      professionals: { title: 'Professionals and services', hint: "My GP, care team or crisis team, and a helpline that's open 24/7" },
      safeEnv: { title: 'Making where I am safer', hint: 'Ways to make my surroundings safer while things feel hard, like asking someone I trust to look after things I might use to hurt myself', ph: "e.g. stay at a friend's tonight" },
      reasons: { title: 'My reasons for living', hint: 'People, pets, plans and hopes: whatever matters to me', ph: 'e.g. my dog, seeing my niece grow up' },
    },
    low: {
      title: 'It looks like things have been hard lately',
      body: "Your last few check-ins have been really low. That can be exhausting, and you don't have to get through it on your own. If it would help to talk, these are here for you, any time.",
      yourPeople: 'Your people',
      openPlan: '🛟 Open my safety plan', makePlan: '🛟 Make a safety plan',
      notNow: 'Not now', dontSuggest: "Don't suggest this again",
      turnedOff: 'Okay. You can turn this back on any time in {settings} → {where}.',
      settingTitle: "💙 Don't suggest support when I've had low days",
      settingDesc: 'When several of your recent check-ins are {mood}, Bipolar Bear gently shows people you can talk to, at most once every few days. Worked out on this phone only.',
      close: 'Close', region: 'Support suggestion',
    },
  };

  // ── small helpers ─────────────────────────────────────────────────────────
  function _fallback(key) {
    var parts = key.split('.'), cur = EN;
    for (var i = 0; i < parts.length; i++) { if (!cur) return null; cur = cur[parts[i]]; }
    return typeof cur === 'string' ? cur : null;
  }
  function tr(key, vars) {
    var full = 'safety.' + key, v = null;
    try { if (root.BB && root.BB.t) v = root.BB.t(full, vars); } catch (_) {}
    if (v == null || v === full) {
      v = _fallback(key) || key;
      if (vars) Object.keys(vars).forEach(function (k) { v = v.split('{' + k + '}').join(String(vars[k])); });
    }
    return v;
  }
  function tAny(key, fallback) {
    var v = null;
    try { if (root.BB && root.BB.t) v = root.BB.t(key); } catch (_) {}
    return (v && v !== key) ? v : fallback;
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }
  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayDiff(a, b) { // whole days from key a to key b
    var pa = String(a).split('-'), pb = String(b).split('-');
    var da = new Date(+pa[0], +pa[1] - 1, +pa[2]), db = new Date(+pb[0], +pb[1] - 1, +pb[2]);
    return Math.round((db - da) / DAY_MS);
  }
  function isNative() {
    try { return !!(root.BB && root.BB.platform && root.BB.platform.isNative()); } catch (_) { return false; }
  }
  /** Element builder — text only ever goes in via textContent. */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function telOf(phone) { return String(phone || '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, ''); }
  function clip(s) { return String(s == null ? '' : s).trim().slice(0, MAX_LEN); }

  // ── plan storage ──────────────────────────────────────────────────────────
  function blankPlan() {
    var p = { v: 1, updatedAt: 0 };
    SECTIONS.forEach(function (s) { p[s.id] = []; });
    return p;
  }
  /** Coerce anything (old shapes, decrypted remote data) into a clean plan. */
  function normalise(raw) {
    var p = blankPlan();
    if (!raw || typeof raw !== 'object') return p;
    p.updatedAt = Number(raw.updatedAt) || 0;
    var widgetTaken = false;
    SECTIONS.forEach(function (s) {
      var list = Array.isArray(raw[s.id]) ? raw[s.id] : [];
      list.slice(0, MAX_ITEMS).forEach(function (it) {
        if (s.kind === 'text') {
          var t = clip(it);
          if (t) p[s.id].push(t);
        } else if (it && typeof it === 'object') {
          var c = { name: clip(it.name), phone: clip(it.phone).slice(0, 40) };
          if (!c.name && !c.phone) return;
          if (it.onWidget && !widgetTaken && telOf(c.phone)) { c.onWidget = true; widgetTaken = true; }
          p[s.id].push(c);
        }
      });
    });
    return p;
  }
  function get() {
    var raw = null;
    try { raw = JSON.parse(lsGet(PLAN_KEY) || 'null'); } catch (_) {}
    return normalise(raw);
  }
  function hasContent(p) {
    p = p || get();
    return SECTIONS.some(function (s) { return p[s.id] && p[s.id].length > 0; });
  }
  /** Contacts with a usable number, people first, then professionals. */
  function contacts(p) {
    p = p || get();
    return (p.helpPeople || []).concat(p.professionals || []).filter(function (c) { return telOf(c.phone); });
  }
  function save(p, opts) {
    p = normalise(p);
    p.updatedAt = Date.now();
    // An emptied plan is still written (with its timestamp) so the delete syncs.
    lsSet(PLAN_KEY, JSON.stringify(p));
    if (!opts || opts.sync !== false) sync();
    refreshLockButtons();
    syncWidget();
    refreshBanner();
    return p;
  }
  function clearLocal() {
    [PLAN_KEY, SYNCED_KEY, LOCK_KEY].forEach(lsDel);
    refreshLockButtons();
    syncWidget();
    refreshBanner();
  }
  function lockEnabled() { return lsGet(LOCK_KEY) === '1'; }
  function setLockEnabled(on) {
    if (on) lsSet(LOCK_KEY, '1'); else lsDel(LOCK_KEY);
    refreshLockButtons();
  }

  // ── end-to-end encrypted sync to userSettings/{uid}.safetyPlanEnc ─────────
  // Uses ONLY the key js/journal.js has already put in sessionStorage. It never
  // calls SecureStorage itself: the journal reads the Keychain once per session
  // (`_bbSSAttempted`), and a second caller could take that one attempt away.
  function _b64(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
  function _unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
  function _key() {
    var b64 = null;
    try { b64 = sessionStorage.getItem('bb_user_key'); } catch (_) {}
    if (!b64 || !root.crypto || !crypto.subtle) return Promise.resolve(null);
    return crypto.subtle.importKey('raw', _unb64(b64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
      .catch(function () { return null; });
  }
  function _encrypt(key, obj) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)))
      .then(function (c) { return { _enc: _b64(c), _iv: _b64(iv) }; });
  }
  function _decrypt(key, enc) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: _unb64(enc._iv) }, key, _unb64(enc._enc))
      .then(function (p) { return JSON.parse(new TextDecoder().decode(p)); });
  }
  function _user() {
    try {
      var u = root.firebase && firebase.apps && firebase.apps.length && firebase.auth().currentUser;
      return (u && !u.isAnonymous) ? u : null;
    } catch (_) { return null; }
  }
  var _syncing = null;
  function sync() {
    if (_syncing) return _syncing;
    var user = _user();
    if (!user) return Promise.resolve('no-user');
    _syncing = _key().then(function (key) {
      if (!key) return 'no-key';
      var ref = firebase.firestore().collection('userSettings').doc(user.uid);
      return ref.get().then(function (doc) {
        var remote = doc.exists ? doc.data().safetyPlanEnc : null;
        var local = get();
        var syncedAt = Number(lsGet(SYNCED_KEY)) || 0;
        var rAt = remote && Number(remote.updatedAt) || 0;
        var pull = remote && remote._enc && rAt !== syncedAt && (!syncedAt || rAt > local.updatedAt);
        if (pull) {
          return _decrypt(key, remote).then(function (plain) {
            var p = normalise(plain); p.updatedAt = rAt;
            // First sync on this device, an empty account copy (a deleted
            // plan) and a plan written here as a guest: keep this one.
            if (!syncedAt && !hasContent(p) && hasContent(local)) {
              return _encrypt(key, local).then(function (enc) {
                enc.updatedAt = local.updatedAt || Date.now();
                return ref.set({ safetyPlanEnc: enc }, { merge: true }).then(function () {
                  lsSet(SYNCED_KEY, String(enc.updatedAt)); return 'pushed';
                });
              });
            }
            lsSet(PLAN_KEY, JSON.stringify(p));
            lsSet(SYNCED_KEY, String(rAt));
            refreshLockButtons(); syncWidget(); refreshBanner(); _rerenderOpen();
            return 'pulled';
          });
        }
        var hasLocal = lsGet(PLAN_KEY) != null;
        if (hasLocal && local.updatedAt && local.updatedAt !== syncedAt && local.updatedAt > rAt) {
          return _encrypt(key, local).then(function (enc) {
            enc.updatedAt = local.updatedAt;
            return ref.set({ safetyPlanEnc: enc }, { merge: true });
          }).then(function () { lsSet(SYNCED_KEY, String(local.updatedAt)); return 'pushed'; });
        }
        return 'same';
      });
    }).catch(function (e) {
      try { console.warn('safety plan sync', e && e.message); } catch (_) {}
      return 'error';
    }).then(function (r) { _syncing = null; return r; });
    return _syncing;
  }
  // Auth arrives after this file loads (Firebase SDKs come later in the page),
  // and the journal puts the key in sessionStorage during its own auth
  // listener — so try on load, then a few more times while there's no key.
  function _watchAuth() {
    try {
      if (!(root.firebase && firebase.apps && firebase.apps.length)) return;
      firebase.auth().onAuthStateChanged(function (u) {
        if (!u || u.isAnonymous) return;
        var tries = 0;
        (function attempt() {
          sync().then(function (r) {
            if (r === 'no-key' && ++tries < 8) setTimeout(attempt, 2500);
          });
        })();
      });
    } catch (_) {}
  }

  // ── native widget ("Call for support") ────────────────────────────────────
  function widgetPayload() {
    var c = null;
    contacts().some(function (x) { if (x.onWidget) { c = x; return true; } return false; });
    if (c) {
      return { kind: 'contact', title: tr('plan.widgetTitle'), name: c.name || c.phone,
        sub: c.name ? c.phone : tr('plan.fromPlan'), tel: telOf(c.phone), empty: tr('plan.widgetEmpty') };
    }
    var line = null;
    try {
      var g = root.BB && BB.crisis && BB.crisis.get();
      (g && g.lines || []).some(function (l) { if (/^tel:/.test(l.href)) { line = l; return true; } return false; });
    } catch (_) {}
    if (line) {
      return { kind: 'crisis', title: tr('plan.widgetTitle'), name: line.name, sub: line.sub,
        tel: line.href.slice(4), empty: tr('plan.widgetEmpty') };
    }
    return { kind: 'none', title: tr('plan.widgetTitle'), name: '', sub: '', tel: '', empty: tr('plan.widgetEmpty') };
  }
  function syncWidget() {
    if (!isNative()) return;
    var payload = { safetyCall: JSON.stringify(widgetPayload()) };
    try {
      var wk = root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.setSharedData;
      if (wk) { wk.postMessage(payload); return; }
      var plugin = root.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BipolarBearWidget;
      if (plugin && plugin.setSharedData) {
        var r = plugin.setSharedData(payload);
        if (r && r.catch) r.catch(function () {});
      }
    } catch (_) {}
  }

  // ── styles (injected once) ────────────────────────────────────────────────
  var CSS = [
    '.bbsp-sheet{position:fixed;inset:0;z-index:10005;background:rgba(20,12,4,.55);display:flex;align-items:stretch;justify-content:center;}',
    '.bbsp-panel{position:relative;background:#fffaf4;color:#2b2118;width:100%;max-width:560px;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;font-family:inherit;box-sizing:border-box;padding:0 16px calc(28px + env(safe-area-inset-bottom));}',
    '@media (min-width:620px){.bbsp-sheet{align-items:center;padding:24px}.bbsp-panel{height:auto;max-height:92vh;border-radius:20px;box-shadow:0 10px 40px rgba(0,0,0,.3)}}',
    '.bbsp-bar{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;background:#fffaf4;padding:calc(10px + env(safe-area-inset-top)) 0 10px;border-bottom:1px solid #f0e2d0;margin-bottom:12px;}',
    '.bbsp-bar h2{flex:1;margin:0;font-size:1.15em;font-weight:800;color:#5a2a00;}',
    '.bbsp-btn{min-height:44px;min-width:44px;padding:8px 14px;border-radius:22px;border:1.5px solid #d9c3a8;background:#fff;color:#5a2a00;font:inherit;font-weight:700;font-size:.9em;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    '.bbsp-btn.primary{background:var(--brand-btn,#b5470b);border-color:transparent;color:#fff;}',
    '.bbsp-btn.ghost{border-color:transparent;background:none;color:#6b5a48;font-weight:600;}',
    '.bbsp-btn:focus-visible,.bbsp-call:focus-visible,.bbsp-x:focus-visible,.bbsp-card a:focus-visible{outline:3px solid #1c7ed6;outline-offset:2px;}',
    '.bbsp-x{width:44px;height:44px;border-radius:50%;border:none;background:#f3e7d8;color:#5a2a00;font-size:1.3em;line-height:1;cursor:pointer;flex-shrink:0;}',
    '.bbsp-intro{font-size:.92em;line-height:1.5;color:#5b4a3a;margin:0 2px 14px;}',
    '.bbsp-sec{background:#fff;border:1px solid #f0e2d0;border-radius:14px;padding:12px 14px;margin-bottom:12px;}',
    '.bbsp-sec h3{margin:0 0 2px;font-size:1em;font-weight:800;color:#5a2a00;display:flex;gap:8px;align-items:center;}',
    '.bbsp-step{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:11px;background:#ffe8cc;color:#8a4500;font-size:.75em;font-weight:800;}',
    '.bbsp-hint{font-size:.8em;color:#6b5a48;line-height:1.4;margin:2px 0 8px;}',
    '.bbsp-list{list-style:none;margin:0;padding:0;}',
    '.bbsp-list li{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid #f6ece0;font-size:.95em;line-height:1.4;word-break:break-word;}',
    '.bbsp-list li:first-child{border-top:none;}',
    '.bbsp-list li > span{flex:1;min-width:0;}',
    '.bbsp-rm{width:44px;height:44px;flex-shrink:0;border:none;background:none;color:#a33;font-size:1.15em;cursor:pointer;border-radius:50%;}',
    '.bbsp-add{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;}',
    '.bbsp-add input{flex:1 1 140px;min-width:0;min-height:44px;padding:8px 12px;border:1.5px solid #e3d2bd;border-radius:10px;font:inherit;font-size:.95em;background:#fff;color:#2b2118;box-sizing:border-box;}',
    '.bbsp-call{display:flex;align-items:center;gap:12px;min-height:48px;padding:10px 14px;border-radius:12px;background:#eef3ff;border:1.5px solid #5c7cfa;color:#2b2118;text-decoration:none;margin:6px 0;}',
    '.bbsp-call .ico{font-size:1.35em;line-height:1;}',
    '.bbsp-call .nm{font-weight:700;font-size:.95em;display:block;}',
    '.bbsp-call .sb{font-size:.82em;color:#5b4a3a;display:block;margin-top:1px;}',
    '.bbsp-wid{display:flex;align-items:center;gap:6px;font-size:.8em;color:#5b4a3a;margin:-2px 0 4px 2px;min-height:32px;}',
    '.bbsp-opt{display:flex;gap:12px;align-items:flex-start;padding:12px 2px;font-size:.92em;line-height:1.4;}',
    '.bbsp-opt input{width:22px;height:22px;flex-shrink:0;margin-top:1px;accent-color:#b5470b;}',
    '.bbsp-small{font-size:.8em;color:#6b5a48;line-height:1.45;margin:8px 2px;}',
    '.bbsp-danger{color:#b02a2a;border-color:#e8b4b4;}',
    '.bbsp-card{position:relative;background:#fff;color:#2b2118;border-radius:16px;border-left:5px solid #5c7cfa;padding:16px 16px 12px;margin:14px auto;max-width:520px;box-shadow:0 3px 14px rgba(0,0,0,.12);text-align:left;}',
    '.bbsp-card h2{margin:0 40px 6px 0;font-size:1.05em;font-weight:800;color:#2f3e8f;line-height:1.35;}',
    '.bbsp-card p{margin:0 0 8px;font-size:.9em;line-height:1.5;color:#3d342b;}',
    '.bbsp-card h3{margin:10px 0 2px;font-size:.78em;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#6b5a48;}',
    '.bbsp-card .bbsp-x{position:absolute;top:8px;right:8px;background:#eef1fb;color:#2f3e8f;}',
    '.bbsp-row{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-top:8px;}',
    '.bbsp-lockbtn[hidden]{display:none!important;}',
    'html.theme-dark .bbsp-panel,html.theme-dark .bbsp-bar{background:var(--dk-bg,#1c1612);color:var(--dk-text,#f5ebdd);border-color:var(--dk-line,#4a3d30);}',
    'html.theme-dark .bbsp-bar h2,html.theme-dark .bbsp-sec h3{color:var(--dk-text,#f5ebdd);}',
    'html.theme-dark .bbsp-sec,html.theme-dark .bbsp-card{background:var(--dk-surface,#262019);border-color:var(--dk-line,#4a3d30);color:var(--dk-text,#f5ebdd);}',
    'html.theme-dark .bbsp-card{border-left-color:#748ffc;}',
    'html.theme-dark .bbsp-card h2{color:#bac8ff;}',
    'html.theme-dark .bbsp-intro,html.theme-dark .bbsp-hint,html.theme-dark .bbsp-small,html.theme-dark .bbsp-wid,html.theme-dark .bbsp-card p,html.theme-dark .bbsp-card h3,html.theme-dark .bbsp-call .sb,html.theme-dark .bbsp-opt{color:var(--dk-muted,#bfae98);}',
    'html.theme-dark .bbsp-card p{color:var(--dk-text-2,#e3d5c3);}',
    'html.theme-dark .bbsp-list li{border-color:var(--dk-line,#4a3d30);}',
    'html.theme-dark .bbsp-btn{background:var(--dk-surface-2,#30281f);border-color:var(--dk-line,#4a3d30);color:var(--dk-text,#f5ebdd);}',
    'html.theme-dark .bbsp-btn.primary{background:var(--brand-btn);color:#fff;border-color:transparent;}',
    'html.theme-dark .bbsp-btn.ghost{background:none;border-color:transparent;color:var(--dk-muted,#bfae98);}',
    'html.theme-dark .bbsp-x{background:var(--dk-surface-3,#3b3127);color:var(--dk-text,#f5ebdd);}',
    'html.theme-dark .bbsp-step{background:#4a3018;color:#ffc078;}',
    'html.theme-dark .bbsp-add input{background:var(--dk-surface-2,#30281f);border-color:var(--dk-line,#4a3d30);color:var(--dk-text,#f5ebdd);}',
    'html.theme-dark .bbsp-call{background:#252b45;border-color:#748ffc;color:var(--dk-text,#f5ebdd);}',
    'html.theme-dark .bbsp-rm{color:#ff8787;}',
    'html.theme-dark .bbsp-danger{color:#ff8787;border-color:#7a3a3a;}',
    '@media (prefers-reduced-motion:no-preference){.bbsp-card{animation:bbspIn .35s ease}@keyframes bbspIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}}',
  ].join('\n');
  function _css() {
    if (document.getElementById('bbspCss')) return;
    var s = document.createElement('style');
    s.id = 'bbspCss';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ── a row that calls someone ──────────────────────────────────────────────
  function callRow(name, sub, href, icon, external) {
    var a = h('a', { class: 'bbsp-call', href: href, target: external ? '_blank' : null, rel: external ? 'noopener' : null }, [
      h('span', { class: 'ico', 'aria-hidden': 'true', text: icon || '📞' }),
      h('span', null, [h('span', { class: 'nm', text: name }), sub ? h('span', { class: 'sb', text: sub }) : null]),
    ]);
    return a;
  }
  function crisisRows(withEmergency) {
    var out = [];
    var g = null;
    try { g = root.BB && BB.crisis && BB.crisis.get(); } catch (_) {}
    if (!g) return out;
    g.lines.forEach(function (l) { out.push(callRow(l.name, l.sub, l.href, l.icon, l.external)); });
    if (withEmergency && g.emergency) {
      out.push(callRow(tAny('crisis.emergency', 'Emergency'), tAny('crisis.callN', 'Call {n}').replace('{n}', g.emergency), 'tel:' + g.emergency, '🚑'));
    }
    return out;
  }
  function contactRow(c) {
    var tel = telOf(c.phone);
    if (!tel) return h('div', { class: 'bbsp-call', style: 'border-style:dashed' }, [
      h('span', { class: 'ico', 'aria-hidden': 'true', text: '👤' }),
      h('span', null, [h('span', { class: 'nm', text: c.name })]),
    ]);
    var a = callRow(c.name || c.phone, c.name ? c.phone : '', 'tel:' + tel, '📞');
    a.setAttribute('aria-label', tr('plan.call', { name: c.name || c.phone }) + (c.name ? ', ' + c.phone : ''));
    return a;
  }

  // ── the plan sheet (view + edit) ──────────────────────────────────────────
  var _sheet = null, _opener = null, _mode = 'view', _fromLock = false;

  function _close() {
    if (!_sheet) return;
    document.removeEventListener('keydown', _onKey, true);
    _sheet.remove();
    _sheet = null;
    try { document.body.style.overflow = _sheetPrevOverflow; } catch (_) {}
    if (_opener && _opener.focus) { try { _opener.focus(); } catch (_) {} }
    _opener = null;
  }
  var _sheetPrevOverflow = '';
  function _onKey(e) {
    if (!_sheet) return;
    if (e.key === 'Escape') { e.preventDefault(); _close(); return; }
    if (e.key === 'Tab') { // keep focus inside the dialog
      var f = _sheet.querySelectorAll('a[href],button:not([disabled]),input,select,textarea');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  function _rerenderOpen() { if (_sheet) _render(); }

  function open(opts) {
    opts = opts || {};
    _css();
    _fromLock = !!opts.fromLock;
    // From the lock screen the plan can only be read, and only if opted in.
    if (_fromLock && !(lockEnabled() && hasContent())) return;
    _mode = (!_fromLock && (opts.edit || !hasContent())) ? 'edit' : 'view';
    _opener = document.activeElement;
    if (_sheet) _sheet.remove();
    _sheet = h('div', { class: 'bbsp-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bbspTitle',
      onclick: function (e) { if (e.target === _sheet) _close(); } });
    _sheetPrevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.appendChild(_sheet);
    document.addEventListener('keydown', _onKey, true);
    _render();
    var t = _sheet.querySelector('#bbspTitle');
    if (t) { t.setAttribute('tabindex', '-1'); try { t.focus(); } catch (_) {} }
  }

  function _render(focusSel) {
    var p = get();
    var panel = h('div', { class: 'bbsp-panel' });
    var toggle = _fromLock ? null : h('button', { type: 'button', class: 'bbsp-btn' + (_mode === 'edit' ? ' primary' : ''),
      text: _mode === 'edit' ? tr('plan.done') : tr('plan.edit'),
      onclick: function () {
        if (_mode === 'edit' && !hasContent()) { _close(); return; }
        _mode = _mode === 'edit' ? 'view' : 'edit'; _render();
        var tt = _sheet && _sheet.querySelector('#bbspTitle'); if (tt) try { tt.focus(); } catch (_) {}
      } });
    panel.appendChild(h('div', { class: 'bbsp-bar' }, [
      h('h2', { id: 'bbspTitle', text: '🛟 ' + tr('plan.title') }),
      toggle,
      h('button', { type: 'button', class: 'bbsp-x', 'aria-label': tr('plan.close'), title: tr('plan.close'), text: '×', onclick: _close }),
    ]));

    if (_mode === 'view') _renderView(panel, p); else _renderEdit(panel, p);

    _sheet.textContent = '';
    _sheet.appendChild(panel);
    if (focusSel) { var f = panel.querySelector(focusSel); if (f) try { f.focus(); } catch (_) {} }
  }

  function _renderView(panel, p) {
    if (!hasContent(p)) {
      panel.appendChild(h('p', { class: 'bbsp-intro', text: tr('plan.emptyAll') }));
      if (!_fromLock) panel.appendChild(h('button', { type: 'button', class: 'bbsp-btn primary', text: tr('plan.write'),
        onclick: function () { _mode = 'edit'; _render(); } }));
    } else {
      panel.appendChild(h('p', { class: 'bbsp-intro', text: tr('plan.viewIntro') }));
      var n = 0;
      SECTIONS.forEach(function (s) {
        var items = p[s.id] || [];
        n++;
        if (!items.length) return;
        var sec = h('section', { class: 'bbsp-sec', 'aria-labelledby': 'bbspS_' + s.id }, [
          h('h3', { id: 'bbspS_' + s.id }, [h('span', { class: 'bbsp-step', 'aria-hidden': 'true', text: String(n) }), h('span', { 'aria-hidden': 'true', text: s.icon }), h('span', { text: tr('sec.' + s.id + '.title') })]),
        ]);
        if (s.kind === 'text') {
          var ul = h('ul', { class: 'bbsp-list' });
          items.forEach(function (t) { ul.appendChild(h('li', null, [h('span', { text: t })])); });
          sec.appendChild(ul);
        } else {
          items.forEach(function (c) { sec.appendChild(contactRow(c)); });
        }
        panel.appendChild(sec);
      });
    }
    // The country's crisis lines are always at the foot of the plan.
    var cs = h('section', { class: 'bbsp-sec', 'aria-labelledby': 'bbspCrisis' }, [
      h('h3', { id: 'bbspCrisis' }, [h('span', { 'aria-hidden': 'true', text: '🆘' }), h('span', { text: tr('plan.crisisHeading') })]),
    ]);
    crisisRows(true).forEach(function (r) { cs.appendChild(r); });
    try { if (root.BB && BB.crisis) cs.appendChild(h('p', { class: 'bbsp-small', text: BB.crisis.dangerSub() })); } catch (_) {}
    panel.appendChild(cs);
    panel.appendChild(h('p', { class: 'bbsp-small', text: tr('plan.source') }));
  }

  function _signedIn() { return !!_user(); }

  function _renderEdit(panel, p) {
    panel.appendChild(h('p', { class: 'bbsp-intro', text: tr('plan.intro') }));
    var n = 0;
    SECTIONS.forEach(function (s) {
      n++;
      var items = p[s.id] || [];
      var secId = 'bbspE_' + s.id;
      var sec = h('section', { class: 'bbsp-sec', 'aria-labelledby': secId }, [
        h('h3', { id: secId }, [h('span', { class: 'bbsp-step', 'aria-hidden': 'true', text: String(n) }), h('span', { 'aria-hidden': 'true', text: s.icon }), h('span', { text: tr('sec.' + s.id + '.title') })]),
        h('div', { class: 'bbsp-hint', id: secId + '_hint', text: tr('sec.' + s.id + '.hint') }),
      ]);
      var ul = h('ul', { class: 'bbsp-list' });
      items.forEach(function (it, i) {
        var label = s.kind === 'text' ? it : ((it.name || '') + (it.phone ? ' · ' + it.phone : ''));
        var li = h('li', null, [
          h('span', { text: label }),
          h('button', { type: 'button', class: 'bbsp-rm', 'aria-label': tr('plan.remove', { item: label }), title: tr('plan.remove', { item: label }), text: '✕',
            onclick: function () {
              var q = get(); q[s.id].splice(i, 1); save(q);
              _render('#' + secId + '_in');
            } }),
        ]);
        ul.appendChild(li);
        if (s.kind === 'contact' && isNative() && telOf(it.phone)) {
          var cbId = 'bbspW_' + s.id + '_' + i;
          var cb = h('input', { type: 'checkbox', id: cbId });
          cb.checked = !!it.onWidget;
          cb.addEventListener('change', function () {
            var q = get();
            SECTIONS.forEach(function (ss) { if (ss.kind === 'contact') (q[ss.id] || []).forEach(function (x) { x.onWidget = false; }); });
            if (cb.checked) q[s.id][i].onWidget = true;
            save(q);
            _render('#' + cbId);
          });
          ul.appendChild(h('li', { class: 'bbsp-wid' }, [cb, h('label', { for: cbId, text: '📱 ' + tr('plan.onWidget') })]));
        }
      });
      if (items.length) sec.appendChild(ul);

      var add = h('form', { class: 'bbsp-add' });
      var inp, ph;
      if (s.kind === 'text') {
        inp = h('input', { type: 'text', id: secId + '_in', maxlength: String(MAX_LEN), placeholder: tr('sec.' + s.id + '.ph'),
          'aria-label': tr('sec.' + s.id + '.title'), 'aria-describedby': secId + '_hint', autocomplete: 'off' });
        add.appendChild(inp);
      } else {
        inp = h('input', { type: 'text', id: secId + '_in', maxlength: '80', placeholder: tr('plan.name'), 'aria-label': tr('sec.' + s.id + '.title') + ': ' + tr('plan.name'), autocomplete: 'off' });
        ph = h('input', { type: 'tel', id: secId + '_ph', maxlength: '40', inputmode: 'tel', placeholder: tr('plan.phone'), 'aria-label': tr('sec.' + s.id + '.title') + ': ' + tr('plan.phone'), autocomplete: 'off' });
        add.appendChild(inp); add.appendChild(ph);
      }
      var full = items.length >= MAX_ITEMS;
      if (full) { inp.disabled = true; if (ph) ph.disabled = true; }
      add.appendChild(h('button', { type: 'submit', class: 'bbsp-btn', text: tr('plan.add'), disabled: full }));
      add.addEventListener('submit', function (e) {
        e.preventDefault();
        var q = get();
        if (s.kind === 'text') {
          var v = clip(inp.value);
          if (!v) { inp.focus(); return; }
          q[s.id].push(v);
        } else {
          var nm = clip(inp.value).slice(0, 80), pn = clip(ph.value).slice(0, 40);
          if (!nm && !pn) { inp.focus(); return; }
          q[s.id].push({ name: nm, phone: pn });
        }
        save(q);
        _render('#' + secId + '_in');
      });
      sec.appendChild(add);
      if (s.kind === 'contact' && s.id === 'helpPeople' && isNative()) {
        sec.appendChild(h('p', { class: 'bbsp-small', text: tr('plan.widgetHelp') }));
      }
      panel.appendChild(sec);
    });

    // Lock-screen opt-in (unticked by default).
    var lockCb = h('input', { type: 'checkbox', id: 'bbspLock', 'aria-describedby': 'bbspLockDesc' });
    lockCb.checked = lockEnabled();
    lockCb.addEventListener('change', function () { setLockEnabled(lockCb.checked); });
    panel.appendChild(h('div', { class: 'bbsp-sec' }, [
      h('div', { class: 'bbsp-opt' }, [lockCb, h('div', null, [
        h('label', { for: 'bbspLock', style: 'font-weight:700', text: tr('plan.onLock') }),
        h('div', { class: 'bbsp-hint', id: 'bbspLockDesc', style: 'margin:2px 0 0', text: tr('plan.onLockDesc') }),
      ])]),
    ]));
    panel.appendChild(h('p', { class: 'bbsp-small', text: '🔒 ' + tr(_signedIn() ? 'plan.savedSignedIn' : 'plan.savedGuest') }));
    if (hasContent(p)) {
      panel.appendChild(h('button', { type: 'button', class: 'bbsp-btn bbsp-danger', text: tr('plan.delete'), onclick: function () {
        if (!confirm(tr('plan.deleteConfirm'))) return;
        save(blankPlan());
        setLockEnabled(false);
        _render();
      } }));
    }
    panel.appendChild(h('p', { class: 'bbsp-small', text: tr('plan.source') }));
  }

  // ── PIN-screen buttons + Survival Kit banner ──────────────────────────────
  function refreshLockButtons() {
    if (typeof document === 'undefined') return;
    var show = lockEnabled() && hasContent();
    var btns = document.querySelectorAll('.bbsp-lockbtn');
    for (var i = 0; i < btns.length; i++) {
      if (show) btns[i].removeAttribute('hidden'); else btns[i].setAttribute('hidden', '');
    }
  }
  function refreshBanner() {
    if (typeof document === 'undefined') return;
    var sub = document.getElementById('skPlanSub');
    if (sub) sub.textContent = tr(hasContent() ? 'plan.bannerSub' : 'plan.bannerSubEmpty');
    var title = document.getElementById('skPlanTitle');
    if (title) title.textContent = tr('plan.title');
  }

  // ══ Low-days support card ═════════════════════════════════════════════════

  /** Any mood value → one of the five categories (mirrors _moodCat in journal.js). */
  function moodCat(m) {
    if (m == null || m === '') return null;
    if (typeof m === 'number' || /^\d+(\.\d+)?$/.test(String(m))) {
      var n = Number(m);
      if (n <= 1) return 'depressed';
      if (n <= 3) return 'low';
      if (n <= 6) return 'stable';
      if (n <= 8) return 'elevated';
      return 'manic';
    }
    if (m === 'good') return 'stable';
    return ['manic', 'elevated', 'stable', 'low', 'depressed'].indexOf(m) >= 0 ? m : null;
  }

  /**
   * Pure: does the recent pattern call for the card?
   * @param {Object<string,string>} byDay  {"YYYY-MM-DD": category} of LOGGED days (no estimates)
   * @param {string} today                 "YYYY-MM-DD"
   * @returns {{due:boolean, depressed:number, of:number}}
   */
  function detectLowRun(byDay, today) {
    var days = Object.keys(byDay || {}).filter(function (d) {
      var diff = dayDiff(d, today);
      return diff >= 0 && diff < 10 && byDay[d];
    }).sort().reverse().slice(0, 5);
    var dep = days.filter(function (d) { return byDay[d] === 'depressed'; }).length;
    var latest = days.length ? byDay[days[0]] : null;
    var due = days.length >= 3 && dep >= 3 && (latest === 'depressed' || latest === 'low');
    return { due: due, depressed: dep, of: days.length };
  }

  /** Journal entries → {day: category}, the latest entry per day, estimates skipped. */
  function byDayFromEntries(entries) {
    var out = {}, stamp = {};
    (entries || []).forEach(function (e) {
      if (!e || !e.date || e.autoFilled) return;
      var cat = moodCat(e.mood);
      if (!cat) return;
      var dt = new Date(e.date);
      if (isNaN(dt)) return;
      var k = dayKey(dt), ts = Number(e.timestamp) || 0;
      if (!(k in stamp) || ts >= stamp[k]) { out[k] = cat; stamp[k] = ts; }
    });
    return out;
  }

  function lowOff() { return lsGet(LOW_OFF_KEY) === '1'; }
  function setLowOff(off) {
    if (off) { lsSet(LOW_OFF_KEY, '1'); _removeCards(); } else lsDel(LOW_OFF_KEY);
    var chk = typeof document !== 'undefined' && document.getElementById('lowMoodSupportToggle');
    if (chk) chk.checked = !!off;
  }

  /** Pure: may the card show today? (frequency rules) */
  function shouldShow(state, today) {
    if (state.off) return false;
    if (!state.due || dayDiff(state.due, today) > 1 || dayDiff(state.due, today) < 0) return false;
    if (state.shown) {
      var gap = dayDiff(state.shown, today);
      if (gap >= 0 && gap < LOW_GAP_DAYS) return state.shown === today && state.dismissed !== today;
    }
    return true;
  }
  function _state() {
    return { off: lowOff(), due: lsGet(LOW_DUE_KEY), shown: lsGet(LOW_SHOWN_KEY), dismissed: lsGet(LOW_DISMISSED_KEY) };
  }

  /** Journal: re-evaluate after every load of decrypted entries. */
  function evaluateEntries(entries) {
    var today = dayKey(new Date());
    var r = detectLowRun(byDayFromEntries(entries), today);
    if (r.due) lsSet(LOW_DUE_KEY, today); else lsDel(LOW_DUE_KEY);
    render();
    return r;
  }

  function _removeCards() {
    if (typeof document === 'undefined') return;
    var cs = document.querySelectorAll('.bbsp-card');
    for (var i = 0; i < cs.length; i++) cs[i].remove();
  }

  // The home page paints under its PIN overlay; never draw the card until it's open.
  function _locked() {
    var ids = ['guestPinOverlay', 'pinOverlay'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && el.style.display && el.style.display !== 'none') return true;
    }
    return false;
  }

  function render() {
    if (typeof document === 'undefined') return;
    var slot = document.getElementById('lowMoodSupportSlot');
    if (!slot) return;
    var today = dayKey(new Date());
    if (_locked() || !shouldShow(_state(), today)) { slot.textContent = ''; return; }
    _css();
    if (lsGet(LOW_SHOWN_KEY) !== today) {
      lsSet(LOW_SHOWN_KEY, today);
      lsDel(LOW_DISMISSED_KEY);
    }
    var plan = get();
    var card = h('section', { class: 'bbsp-card', 'aria-labelledby': 'bbspLowTitle', 'aria-label': null });
    function dismiss() {
      lsSet(LOW_DISMISSED_KEY, today);
      slot.textContent = '';
    }
    card.appendChild(h('button', { type: 'button', class: 'bbsp-x', 'aria-label': tr('low.close'), title: tr('low.close'), text: '×', onclick: dismiss }));
    card.appendChild(h('h2', { id: 'bbspLowTitle' }, [h('span', { 'aria-hidden': 'true', text: '💙 ' }), tr('low.title')]));
    card.appendChild(h('p', { text: tr('low.body') }));

    var people = contacts(plan).slice(0, 2);
    if (!people.length) {
      // No plan contacts: fall back to the Personal Details emergency contact.
      var ec = lsGet('personalEmergencyContact') || '';
      var num = (ec.match(/[\d\s+\-()]{6,}/) || [''])[0].trim();
      if (num) people = [{ name: ec.replace(num, '').replace(/[:\-–,]+\s*$/, '').trim() || num, phone: num }];
    }
    if (people.length) {
      card.appendChild(h('h3', { text: tr('low.yourPeople') }));
      people.forEach(function (c) { card.appendChild(contactRow(c)); });
    }
    card.appendChild(h('h3', { text: tr('plan.crisisHeading') }));
    crisisRows(false).slice(0, 2).forEach(function (r) { card.appendChild(r); });

    var planBtn = h('button', { type: 'button', class: 'bbsp-btn primary',
      text: hasContent(plan) ? tr('low.openPlan') : tr('low.makePlan'),
      onclick: function () { open({ edit: !hasContent() }); } });
    var notNow = h('button', { type: 'button', class: 'bbsp-btn ghost', text: tr('low.notNow'), onclick: dismiss });
    var never = h('button', { type: 'button', class: 'bbsp-btn ghost', text: tr('low.dontSuggest'), onclick: function () {
      setLowOff(true);
      slot.textContent = '';
      var note = h('p', { class: 'bbsp-small', role: 'status', style: 'text-align:center;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.35)',
        text: tr('low.turnedOff', {
          settings: tAny('journal.settings.title', 'Settings').replace(/^[^\p{L}]+/u, ''),
          where: tAny('journal.settings.journalOptions', 'Journal Options'),
        }) });
      slot.appendChild(note);
      setTimeout(function () { if (note.parentNode) note.remove(); }, 8000);
    } });
    card.appendChild(h('div', { class: 'bbsp-row' }, [planBtn]));
    card.appendChild(h('div', { class: 'bbsp-row', style: 'margin-top:2px' }, [notNow, never]));

    slot.textContent = '';
    slot.appendChild(card);
  }

  /** Journal → Settings → Journal Options row: "Don't suggest support…" (unticked = on). */
  function renderSettingRow() {
    var host = document.getElementById('lowMoodSupportSettingRow');
    if (!host) return;
    host.textContent = '';
    var chk = h('input', { type: 'checkbox', id: 'lowMoodSupportToggle' });
    chk.checked = lowOff();
    chk.addEventListener('change', function () {
      setLowOff(!!chk.checked);
      if (!chk.checked) render();
    });
    var row = h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px;' }, [
      h('div', null, [
        h('label', { for: 'lowMoodSupportToggle', style: 'display:block;font-weight:600;color:#495057;font-size:0.95em;cursor:pointer;', text: tr('low.settingTitle') }),
        h('div', { style: 'color:#6c757d;font-size:0.82em;margin-top:2px;', text: tr('low.settingDesc', { mood: tAny('mood.depressed', 'Depressed') }) }),
      ]),
      h('label', { class: 'bb-switch' }, [chk, h('span', { class: 'bb-slider' })]),
    ]);
    host.appendChild(row);
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  function _boot() {
    refreshLockButtons();
    refreshBanner();
    renderSettingRow();
    render();
    syncWidget();
    // Re-check the card when a PIN overlay opens or closes.
    ['guestPinOverlay', 'pinOverlay'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && root.MutationObserver) new MutationObserver(function () { render(); }).observe(el, { attributes: true, attributeFilter: ['style'] });
    });
    // #safety-plan opens the plan (Survival Kit deep link, widget with no contact).
    if (/^#safety-plan$/.test(location.hash) && !_locked()) open();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot);
    else _boot();
    root.addEventListener('load', _watchAuth);
    document.addEventListener('bb:languagechange', function () {
      refreshBanner(); renderSettingRow(); render(); syncWidget(); _rerenderOpen();
    });
  }

  var api = {
    SECTIONS: SECTIONS, get: get, save: save, hasContent: hasContent, contacts: contacts,
    clearLocal: clearLocal, lockEnabled: lockEnabled, setLockEnabled: setLockEnabled,
    open: open, openViewer: function (o) { open(Object.assign({}, o || {}, { edit: false })); },
    close: _close, sync: sync, syncWidget: syncWidget, widgetPayload: widgetPayload,
    refreshLockButtons: refreshLockButtons, blankPlan: blankPlan, normalise: normalise,
  };
  var low = {
    evaluateEntries: evaluateEntries, render: render, renderSettingRow: renderSettingRow,
    detectLowRun: detectLowRun, byDayFromEntries: byDayFromEntries, shouldShow: shouldShow,
    moodCat: moodCat, isOff: lowOff, setOff: setLowOff,
    clearLocal: function () { [LOW_OFF_KEY, LOW_DUE_KEY, LOW_SHOWN_KEY, LOW_DISMISSED_KEY].forEach(lsDel); _removeCards(); },
  };
  root.BB = root.BB || {};
  root.BB.safetyPlan = api;
  root.BB.lowMoodSupport = low;
  if (typeof module !== 'undefined' && module.exports) module.exports = { safetyPlan: api, lowMoodSupport: low };
})(typeof window !== 'undefined' ? window : globalThis);
