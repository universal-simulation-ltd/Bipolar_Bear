/**
 * @file js/shared/bio-unlock.js — BB.bioUnlock: open the app's PIN lock with
 * Face ID / Touch ID / a fingerprint (1.44, DOCS §2.7).
 *
 * Opt-in: journal → ⚙️ Settings → "Unlock with Face ID" (or Touch ID / your
 * fingerprint), UNticked by default, shown in the phone app only, only while a
 * PIN lock is on and the phone has biometrics set up. The PIN always stays:
 * the keypad is still there, and cancelling or failing the scan leaves it.
 * localStorage.bbBioUnlock = '1' (this phone only, never synced).
 *
 * Which lock:
 *   • the app lock of a signed-in user (bbNativePinEnabled, the PIN in the
 *     Keychain): the PIN only guards the screen, so a good scan is enough;
 *   • a guest's PIN (bbGuestPinSalt): the PIN IS the key the entries are
 *     encrypted with, so a scan can only open them if the key is kept. Turning
 *     this on (while unlocked) keeps the PIN-derived key in the Keychain /
 *     Keystore (@aparajita/capacitor-secure-storage, 'bb_guest_bio_key', with
 *     the salt it belongs to), the same place the account journal's device
 *     key lives (bb_user_key). A key for another salt (the PIN was changed or
 *     removed) is never used and is deleted. Turning it off deletes it.
 *
 * Biometrics only (allowDeviceCredential: false): the phone's passcode is not
 * offered here, because the PIN is the fallback. "Forgot PIN?" still takes the
 * passcode (js/shared/pin-reauth.js).
 *
 * Uses Capacitor.Plugins.BiometricAuthNative through its native methods
 * (checkBiometry, internalAuthenticate), as pin-reauth.js does.
 */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};

  var FLAG = 'bbBioUnlock';
  var GUEST_KEY = 'bb_guest_bio_key';

  var EN = {
    face: 'Unlock with Face ID',
    touch: 'Unlock with Touch ID',
    finger: 'Unlock with your fingerprint',
    other: 'Unlock with your face or fingerprint',
    rowDesc: 'Instead of typing your PIN. Your PIN still works if it doesn’t recognise you.',
    reason: 'Unlock Bipolar Bear',
    usePin: 'Use PIN',
    turnOnFailed: 'It didn’t recognise you, so it’s still off.',
    needUnlock: 'Enter your PIN on the lock screen once, then turn this on.',
    keyGone: 'Your PIN changed, so enter it this time. Turn this on again in Settings to use it.',
  };

  function tr(k, vars) {
    var key = 'bio144.' + k;
    var s = (BB.t ? BB.t(key, vars) : '') || '';
    return s && s !== key ? s : (EN[k] || '');
  }

  function isNative() {
    try { return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); } catch (_) { return false; }
  }
  function plugin() {
    try {
      var p = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BiometricAuthNative;
      return p && typeof p.checkBiometry === 'function' && typeof p.internalAuthenticate === 'function' ? p : null;
    } catch (_) { return null; }
  }
  function within(ms, promise, fallback) {
    return Promise.race([promise, new Promise(function (res) { setTimeout(function () { res(fallback); }, ms); })]);
  }
  function ss() { try { return BB.secureStorage || null; } catch (_) { return null; } }

  // iOS LABiometryType: 1 Touch ID, 2 Face ID, 4 Optic ID. Android: 3
  // fingerprint, 4 face, 5 iris (the plugin's BiometryType).
  function typeName(r) {
    var t = Number(r && r.biometryType);
    var ios = !!(window.Capacitor && Capacitor.getPlatform && Capacitor.getPlatform() === 'ios');
    if (ios) return t === 2 ? 'face' : t === 1 ? 'touch' : 'other';
    return t === 3 ? 'finger' : 'other';
  }

  var _avail = null;
  /** → Promise<{ ok, type }>: biometrics enrolled on this phone (not just a passcode). */
  function available() {
    if (_avail) return _avail;
    var p = plugin();
    if (!isNative() || !p) return Promise.resolve({ ok: false, type: 'other' });
    _avail = within(3000, Promise.resolve().then(function () { return p.checkBiometry(); }).then(function (r) {
      return { ok: !!(r && r.isAvailable), type: typeName(r) };
    }, function () { return { ok: false, type: 'other' }; }), { ok: false, type: 'other' });
    // A phone can gain or lose Face ID between visits: ask afresh next time.
    _avail.then(function () { setTimeout(function () { _avail = null; }, 30000); });
    return _avail;
  }

  function isOn() {
    try { return isNative() && localStorage.getItem(FLAG) === '1'; } catch (_) { return false; }
  }

  function scan() {
    var p = plugin();
    if (!p) return Promise.resolve(false);
    return Promise.resolve().then(function () {
      return p.internalAuthenticate({
        reason: tr('reason'),
        cancelTitle: tr('usePin'),
        iosFallbackTitle: tr('usePin'),
        allowDeviceCredential: false,
        androidTitle: tr('reason'),
        androidConfirmationRequired: false,
      });
    }).then(function () { return true; }, function () { return false; });
  }

  /**
   * Turn it on. guest: true for a guest PIN, whose key (sessionStorage
   * bb_guest_key, there while unlocked) is kept with its salt.
   * → 'ok' | 'failed' | 'needUnlock' | 'unavailable'
   */
  function turnOn(opts) {
    opts = opts || {};
    return available().then(function (a) {
      if (!a.ok) return 'unavailable';
      var key = null, salt = null;
      if (opts.guest) {
        try { key = sessionStorage.getItem('bb_guest_key'); salt = BB.storage.get('GuestPinSalt'); } catch (_) {}
        if (!key || !salt || !ss()) return 'needUnlock';
      }
      return scan().then(function (ok) {
        if (!ok) return 'failed';
        var save = opts.guest
          ? Promise.resolve().then(function () { return ss().setItem(GUEST_KEY, JSON.stringify({ salt: salt, key: key })); })
          : Promise.resolve();
        return save.then(function () {
          try { localStorage.setItem(FLAG, '1'); } catch (_) {}
          return 'ok';
        }, function () { return 'failed'; });
      });
    });
  }

  /** Turn it off and forget the kept guest key. */
  function turnOff() {
    try { localStorage.removeItem(FLAG); } catch (_) {}
    var s = ss();
    if (!s) return Promise.resolve();
    return within(3000, Promise.resolve().then(function () { return s.removeItem(GUEST_KEY); }).catch(function () {}), null);
  }

  /**
   * On the lock screen. mode: 'native' (the app lock) or 'guest'.
   * → { ok: true, guestKey? } | { ok: false, reason: 'off'|'cancel'|'keyGone' }
   */
  function unlock(mode) {
    if (!isOn()) return Promise.resolve({ ok: false, reason: 'off' });
    return available().then(function (a) {
      if (!a.ok) return { ok: false, reason: 'off' };
      if (mode !== 'guest') {
        return scan().then(function (ok) { return ok ? { ok: true } : { ok: false, reason: 'cancel' }; });
      }
      var s = ss();
      var salt = null;
      try { salt = BB.storage.get('GuestPinSalt'); } catch (_) {}
      if (!s || !salt) return { ok: false, reason: 'off' };
      return within(3000, Promise.resolve().then(function () { return s.getItem(GUEST_KEY); }).catch(function () { return null; }), null)
        .then(function (raw) {
          var rec = null;
          try { rec = raw ? JSON.parse(raw) : null; } catch (_) {}
          if (!rec || rec.salt !== salt || !rec.key) {
            // Kept for an older PIN (or lost): never used. Off, and say why.
            return turnOff().then(function () { return { ok: false, reason: 'keyGone' }; });
          }
          return scan().then(function (ok) { return ok ? { ok: true, guestKey: rec.key } : { ok: false, reason: 'cancel' }; });
        });
    });
  }

  /** The setting's label for this phone's kind of biometrics. */
  function label(type) { return tr(type === 'face' || type === 'touch' || type === 'finger' ? type : 'other'); }

  BB.bioUnlock = {
    available: available,
    isOn: isOn,
    turnOn: turnOn,
    turnOff: turnOff,
    unlock: unlock,
    label: label,
    text: tr,
  };
})();
