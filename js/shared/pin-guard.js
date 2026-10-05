/**
 * @file js/shared/pin-guard.js — BB.pin: how the app PIN is stored and guarded.
 *
 * Loaded by index.html, journal.html and survival-kit.html (after
 * brand-config.js and i18n.js). Three jobs:
 *
 * 1. Scrambled storage. A PIN is never kept as typed. `BB.pin.hash(pin)`
 *    returns "pbkdf2$<iterations>$<salt>$<hash>" (PBKDF2-SHA256 via WebCrypto,
 *    a fresh random salt per PIN), which is what goes in localStorage
 *    `bbPinCode` and in Firestore `userSettings/{uid}.pinHash`.
 *    `BB.pin.verify(pin, stored)` accepts either that form or a legacy plain
 *    PIN (stored by builds before 2026-10-05) and reports `legacy: true` for
 *    the latter, so the caller can replace it with a hash on that successful
 *    unlock. A plain `bbPinCode` left on the device is also replaced by its
 *    hash as soon as a page loading this file opens (`upgradeStored`). Honest limit: a 4-digit PIN has 10,000 values, so anyone holding
 *    the hash can still try them all offline — the hash keeps the PIN from
 *    being read at a glance (device backups, the Firestore console), the
 *    lockout below is what slows guessing on the lock screen.
 *
 * 2. Wrong-PIN lockout. After 5 wrong PINs in a row the keypad locks for
 *    30 s, then 1, 5, 15 and 60 minutes for each further wrong PIN. The count
 *    and the lock end live in localStorage (`bbPinFails`, `bbPinLockUntil`),
 *    so a reload doesn't reset them; a correct PIN, "Forgot PIN" or setting a
 *    new PIN clears them. `BB.pin.guard(errEl)` returns true (and shows a
 *    live "Try again in 0:30" on errEl) while locked.
 *
 * 3. Re-lock in the background. `BB.pin.watchBackground({ applies, relock })`
 *    calls `relock()` when the page (or, in the native shell, the app — via
 *    @capacitor/app's appStateChange where it's installed) comes back after
 *    more than a minute away, if `applies()` says a PIN is on and unlocked.
 */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};

  var PREFIX = 'pbkdf2$';
  var ITERATIONS = 100000;           // matches the journal's key derivation
  var FAILS_KEY = 'PinFails';        // BB.storage keys (bbPinFails, bbPinLockUntil)
  var UNTIL_KEY = 'PinLockUntil';
  var FREE_TRIES = 5;
  var LOCK_STEPS = [30e3, 60e3, 5 * 60e3, 15 * 60e3, 60 * 60e3];
  var BACKGROUND_RELOCK_MS = 60e3;

  function _pfx() { return (window.BB_BRAND && window.BB_BRAND.storagePrefix) || 'bb'; }
  function _ls(k) { try { return localStorage.getItem(_pfx() + k); } catch (_) { return null; } }
  function _lsSet(k, v) { try { localStorage.setItem(_pfx() + k, v); } catch (_) {} }
  function _lsDel(k) { try { localStorage.removeItem(_pfx() + k); } catch (_) {} }

  function _b64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function _unb64(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function _derive(pin, saltBytes, iterations) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), { name: 'PBKDF2' }, false, ['deriveBits'])
      .then(function (km) {
        return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations: iterations, hash: 'SHA-256' }, km, 256);
      })
      .then(function (bits) { return _b64(new Uint8Array(bits)); });
  }

  /** True when `stored` is a scrambled PIN rather than a legacy plain one. */
  function isHashed(stored) {
    return typeof stored === 'string' && stored.indexOf(PREFIX) === 0;
  }

  /** Scramble a PIN for storage. Resolves to "pbkdf2$<iter>$<salt>$<hash>". */
  function hash(pin) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    return _derive(pin, salt, ITERATIONS).then(function (h) {
      return PREFIX + ITERATIONS + '$' + _b64(salt) + '$' + h;
    });
  }

  /**
   * Check a typed PIN against what's stored. Resolves to
   * { ok: boolean, legacy: boolean } — `legacy` means `stored` was a plain
   * PIN, which the caller should replace with `hash(pin)` when ok.
   */
  function verify(pin, stored) {
    if (!pin || !stored) return Promise.resolve({ ok: false, legacy: false });
    if (!isHashed(stored)) return Promise.resolve({ ok: String(pin) === String(stored), legacy: true });
    var parts = stored.split('$');
    var iter = parseInt(parts[1], 10);
    if (parts.length !== 4 || !(iter > 0)) return Promise.resolve({ ok: false, legacy: false });
    var salt;
    try { salt = _unb64(parts[2]); } catch (_) { return Promise.resolve({ ok: false, legacy: false }); }
    return _derive(pin, salt, iter).then(function (h) {
      var a = h, b = parts[3], diff = a.length ^ b.length;
      for (var i = 0; i < Math.min(a.length, b.length); i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
      return { ok: diff === 0, legacy: false };
    });
  }

  // ── Wrong-PIN lockout ────────────────────────────────────────────────────

  /** Milliseconds left on the current lockout (0 when not locked). */
  function lockRemaining() {
    var until = parseInt(_ls(UNTIL_KEY) || '0', 10) || 0;
    var left = until - Date.now();
    if (left <= 0) return 0;
    // The phone's clock was set back: never wait longer than the longest step.
    var max = LOCK_STEPS[LOCK_STEPS.length - 1];
    if (left > max) { _lsSet(UNTIL_KEY, String(Date.now() + max)); left = max; }
    return left;
  }

  /** Record a wrong PIN. Returns the lockout it started, in ms (0 = none). */
  function recordFailure() {
    var n = (parseInt(_ls(FAILS_KEY) || '0', 10) || 0) + 1;
    _lsSet(FAILS_KEY, String(n));
    if (n < FREE_TRIES) return 0;
    var ms = LOCK_STEPS[Math.min(n - FREE_TRIES, LOCK_STEPS.length - 1)];
    _lsSet(UNTIL_KEY, String(Date.now() + ms));
    return ms;
  }

  /** A correct PIN (or a reset / new PIN): forget the wrong tries. */
  function clearFailures() {
    _lsDel(FAILS_KEY);
    _lsDel(UNTIL_KEY);
  }

  function _fmt(ms) {
    var s = Math.ceil(ms / 1000), m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function lockedMessage(ms) {
    var vars = { time: _fmt(ms) };
    var txt = BB.t ? BB.t('pin.locked', vars) : '';
    if (!txt || txt === 'pin.locked') txt = 'Too many tries. Try again in ' + vars.time + '.';
    return txt;
  }

  var _timers = typeof WeakMap === 'function' ? new WeakMap() : null;

  /**
   * While locked: show the countdown on `errEl` (if given), keep it ticking
   * until the lock ends, then clear it and call `onUnlocked` — and return
   * true, so the caller ignores the key press. Returns false when not locked.
   */
  function guard(errEl, onUnlocked) {
    var left = lockRemaining();
    if (!left) return false;
    if (errEl) {
      errEl.textContent = lockedMessage(left);
      if (_timers && !_timers.get(errEl)) {
        var id = setInterval(function () {
          var l = lockRemaining();
          if (l) { errEl.textContent = lockedMessage(l); return; }
          clearInterval(id);
          _timers.delete(errEl);
          errEl.textContent = '';
          if (typeof onUnlocked === 'function') onUnlocked();
        }, 1000);
        _timers.set(errEl, id);
      }
    }
    return true;
  }

  // ── Re-lock after time in the background ─────────────────────────────────

  /**
   * opts.applies() → true when a PIN is on and currently unlocked.
   * opts.relock()  → lock it again (show the keypad / go to the lock screen).
   */
  function watchBackground(opts) {
    if (!opts || typeof opts.relock !== 'function') return;
    var hiddenAt = 0;
    function away() { if (!hiddenAt) hiddenAt = Date.now(); }
    function back() {
      if (!hiddenAt) return;
      var gone = Date.now() - hiddenAt;
      hiddenAt = 0;
      if (gone < BACKGROUND_RELOCK_MS) return;
      var applies = true;
      try { applies = typeof opts.applies === 'function' ? !!opts.applies() : true; } catch (_) {}
      if (applies) opts.relock();
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) away(); else back();
    });
    // Capacitor fires these on document when the app is paused / resumed.
    document.addEventListener('pause', away, false);
    document.addEventListener('resume', back, false);
    try {
      var App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (App && typeof App.addListener === 'function') {
        App.addListener('appStateChange', function (s) { if (s && s.isActive) back(); else away(); });
      }
    } catch (_) {}
  }

  // ── Upgrade a plain PIN left by an older build ───────────────────────────

  var _upgrading = null;
  /** Replace a plain bbPinCode with its hash. Safe to call repeatedly. */
  function upgradeStored() {
    if (_upgrading) return _upgrading;
    var plain = _ls('PinCode');
    if (!plain || isHashed(plain) || !(window.crypto && crypto.subtle)) return Promise.resolve(false);
    _upgrading = hash(plain).then(function (h) {
      // Only if nothing changed it meanwhile (a new PIN set, or a sign-out).
      if (_ls('PinCode') === plain) _lsSet('PinCode', h);
      return true;
    }).catch(function () { return false; }).then(function (r) { _upgrading = null; return r; });
    return _upgrading;
  }
  upgradeStored();

  BB.pin = {
    upgradeStored: upgradeStored,
    isHashed: isHashed,
    hash: hash,
    verify: verify,
    lockRemaining: lockRemaining,
    recordFailure: recordFailure,
    clearFailures: clearFailures,
    lockedMessage: lockedMessage,
    guard: guard,
    watchBackground: watchBackground,
  };
})();
