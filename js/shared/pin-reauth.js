/**
 * @file js/shared/pin-reauth.js — BB.pinReauth: "Forgot PIN?" proves it's you.
 *
 * James, 2026-10-09: "Forgot PIN?" on the native app PIN and on the old account
 * PIN used to switch the PIN off after a confirm, so anyone holding the phone
 * got past the lock. Turning it off now needs one of:
 *
 *   • the phone's own lock: Face ID / Touch ID / fingerprint, or the device
 *     passcode (native shell only, through @aparajita/capacitor-biometric-auth,
 *     registered as Capacitor.Plugins.BiometricAuthNative — added to
 *     bipolarbear-native on 2026-10-10, so store builds before that one don't
 *     have it and get only the account route);
 *   • signing in to the account again:
 *       – a Bipolar Bear password account: its password
 *         (reauthenticateWithCredential, so it can only be THIS account);
 *       – a Universal ID account (DOCS §2.17): a fresh code emailed to the
 *         account's own address (not one typed here), plus the authenticator
 *         code if two-step is on, then BB.uid.proveAccount(uid) checks that the
 *         Universal ID maps to THIS Firebase account — nothing is signed in.
 *
 * Nothing else changes: entries, settings and the journal key are untouched.
 * The guest PIN's "Forgot PIN?" (the PIN IS the encryption key) still wipes
 * the guest data and does not come here.
 *
 * The wrong-PIN lockout (js/shared/pin-guard.js) is left alone: cancelling or
 * failing here keeps the keypad locked for as long as it was; only a proved
 * identity lets the caller clear the PIN (and with it the count).
 *
 * Loaded in <head> by index.html and journal.html, after i18n.js and
 * universal-id.js. Builds its sheet on first use.
 *
 *   BB.pinReauth.confirm({ device: true }) → Promise<'ok' | 'cancel' | 'unavailable'>
 *     'unavailable': no way to prove it here (signed out, and no phone lock to
 *     use). The sheet has already said so; the caller decides what happens.
 */
(function () {
  'use strict';
  var BB = window.BB = window.BB || {};

  var EN = {
    title: "Confirm it's you",
    body: "To turn off your PIN, confirm it's you. Your journal and everything in the app stay as they are.",
    device: "🔓 Use Face ID, fingerprint or your phone's passcode",
    deviceReason: 'Confirm it’s you to turn off your Bipolar Bear PIN',
    deviceFailed: "Couldn't confirm it's you on this phone. Try again, or sign in below.",
    orSignIn: 'or sign in again',
    passwordLabel: 'Your Bipolar Bear password',
    confirm: 'Confirm',
    codeLabel: "We'll email a sign-in code to {email}.",
    sendCode: 'Email me a code',
    codeSent: 'Code sent. Check your email.',
    codePlaceholder: '6-digit code',
    twoStepLabel: 'Now enter the code from your authenticator app.',
    wrongPassword: "That password isn't right.",
    wrongCode: "That code isn't right, or it has expired.",
    rateLimited: 'Too many tries. Wait a little and try again.',
    network: "You're offline. Try again when you're connected.",
    failed: "That didn't work. Try again.",
    unavailable: "There's no way to confirm it's you here: sign in to your account on this device first. Until then, keep using your PIN.",
    cancel: 'Cancel',
    close: 'Close',
  };

  function tr(k, vars) {
    var key = 'pinReauth.' + k;
    var s = (BB.t ? BB.t(key, vars) : '') || '';
    if (!s || s === key) {
      s = EN[k] || '';
      if (vars) Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(String(vars[v])); });
    }
    return s;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isNative() {
    try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (_) { return false; }
  }

  function bioPlugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BiometricAuthNative) || null; } catch (_) { return null; }
  }

  /** The phone can prove it's you: biometrics enrolled, or at least a passcode set. */
  function deviceAvailable() {
    var p = bioPlugin();
    if (!isNative() || !p || typeof p.checkBiometry !== 'function') return Promise.resolve(false);
    return Promise.race([
      p.checkBiometry().then(function (r) { return !!(r && (r.isAvailable || r.deviceIsSecure)); }, function () { return false; }),
      new Promise(function (res) { setTimeout(function () { res(false); }, 3000); }),
    ]);
  }

  /** Resolves when Firebase Auth has said who is signed in (or after 6 s). */
  function authReady() {
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (!done) { done = true; resolve(); } }
      setTimeout(finish, 6000);
      (function wait(tries) {
        var ok = false;
        try { ok = !!(window.firebase && firebase.apps && firebase.apps.length && firebase.auth); } catch (_) {}
        if (!ok) { if (tries < 24 && !done) setTimeout(function () { wait(tries + 1); }, 250); else finish(); return; }
        try {
          var off = firebase.auth().onAuthStateChanged(function () { finish(); try { off(); } catch (_) {} });
        } catch (_) { finish(); }
      })(0);
    });
  }

  function currentUser() {
    try {
      var u = window.firebase && firebase.auth && firebase.auth().currentUser;
      return u && !u.isAnonymous ? u : null;
    } catch (_) { return null; }
  }

  function hasPassword(u) {
    return ((u && u.providerData) || []).some(function (p) { return p && p.providerId === 'password'; });
  }

  function firebaseReason(err) {
    var c = (err && err.code) || '';
    if (c === 'auth/wrong-password' || c === 'auth/invalid-credential' || c === 'auth/invalid-login-credentials') return 'wrongPassword';
    if (c === 'auth/too-many-requests') return 'rateLimited';
    if (c === 'auth/network-request-failed') return 'network';
    return 'failed';
  }

  function uidReason(r) {
    var why = r && r.reason;
    if (why === 'invalid_code') return 'wrongCode';
    if (why === 'rate_limited') return 'rateLimited';
    if (why === 'network') return 'network';
    return 'failed';
  }

  var STYLE_ID = 'bbPinReauthStyle';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = [
      '#bbPinReauth{position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;}',
      '#bbPinReauth .pr-card{background:#fff;color:#343a40;border-radius:16px;max-width:360px;width:100%;padding:22px 20px 16px;box-shadow:0 12px 40px rgba(0,0,0,.3);max-height:calc(100vh - 40px);overflow-y:auto;font-family:inherit;}',
      '#bbPinReauth h3{margin:0 0 8px;font-size:1.1em;}',
      '#bbPinReauth p{margin:0 0 12px;font-size:.88em;line-height:1.45;color:#495057;}',
      '#bbPinReauth .pr-btn{display:block;width:100%;margin:8px 0 0;padding:11px 14px;border-radius:12px;border:0;font:inherit;font-weight:700;font-size:.92em;cursor:pointer;background:var(--brand-primary,#ff9500);color:#fff;}',
      '#bbPinReauth .pr-btn.pr-quiet{background:none;color:#6c757d;font-weight:600;}',
      '#bbPinReauth .pr-btn[disabled]{opacity:.6;cursor:default;}',
      '#bbPinReauth .pr-or{text-align:center;margin:14px 0 6px;font-size:.78em;color:#868e96;}',
      '#bbPinReauth label{display:block;font-size:.82em;font-weight:600;margin:4px 0 4px;color:#495057;}',
      '#bbPinReauth input{display:block;width:100%;box-sizing:border-box;padding:10px 12px;border:2px solid #e9ecef;border-radius:10px;font:inherit;font-size:16px;color:#343a40;background:#fff;}',
      '#bbPinReauth .pr-err{min-height:1.2em;margin:6px 0 0;font-size:.8em;color:#c92a2a;}',
      '#bbPinReauth .pr-msg{min-height:1.2em;margin:6px 0 0;font-size:.8em;color:#2b8a3e;}',
      '#bbPinReauth .pr-err:empty,#bbPinReauth .pr-msg:empty{min-height:0;margin:0;}',
      'html.theme-dark #bbPinReauth .pr-card{background:var(--dk-surface,#262019);color:var(--dk-text,#f5ebdd);}',
      'html.theme-dark #bbPinReauth p,html.theme-dark #bbPinReauth label{color:var(--dk-muted,#bfae98);}',
      'html.theme-dark #bbPinReauth input{background:var(--dk-surface-2,#30281f);border-color:var(--dk-line,#4a3d30);color:var(--dk-text,#f5ebdd);}',
      'html.theme-dark #bbPinReauth .pr-err{color:#ff8787;}',
      'html.theme-dark #bbPinReauth .pr-msg{color:#69db7c;}',
    ].join('\n');
    document.head.appendChild(st);
  }

  var _open = null; // the promise of the sheet that is up, so a double tap doesn't stack two

  /**
   * @param {{device?: boolean}} [opts] device: offer the phone's own lock (native only).
   * @returns {Promise<'ok'|'cancel'|'unavailable'>}
   */
  function confirm(opts) {
    if (_open) return _open;
    opts = opts || {};
    _open = Promise.all([authReady(), opts.device ? deviceAvailable() : Promise.resolve(false)])
      .then(function (r) { return show(r[1], currentUser()); })
      .then(function (out) { _open = null; return out; }, function () { _open = null; return 'cancel'; });
    return _open;
  }

  function show(canDevice, user) {
    ensureStyle();
    var canPassword = !!(user && user.email && hasPassword(user));
    var canCode = !!(user && user.email && BB.uid && typeof BB.uid.proveAccount === 'function' &&
      (!hasPassword(user) || (BB.uid.hasSession && BB.uid.hasSession())));
    var none = !canDevice && !canPassword && !canCode;

    return new Promise(function (resolve) {
      var root = document.createElement('div');
      root.id = 'bbPinReauth';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-labelledby', 'bbPinReauthTitle');
      var h = '<div class="pr-card">' +
        '<h3 id="bbPinReauthTitle">' + esc(tr('title')) + '</h3>';
      if (none) {
        h += '<p>' + esc(tr('unavailable')) + '</p>' +
          '<button type="button" class="pr-btn pr-quiet" data-act="cancel">' + esc(tr('close')) + '</button></div>';
      } else {
        h += '<p>' + esc(tr('body')) + '</p>';
        if (canDevice) {
          h += '<button type="button" class="pr-btn" data-act="device">' + esc(tr('device')) + '</button>' +
            '<div class="pr-err" data-err="device" aria-live="polite"></div>';
        }
        if (canDevice && (canPassword || canCode)) h += '<div class="pr-or">' + esc(tr('orSignIn')) + '</div>';
        if (canPassword) {
          h += '<form data-form="password" novalidate>' +
            '<label for="bbPinReauthPw">' + esc(tr('passwordLabel')) + '</label>' +
            '<input id="bbPinReauthPw" type="password" autocomplete="current-password" required>' +
            '<div class="pr-err" data-err="password" aria-live="polite"></div>' +
            '<button type="submit" class="pr-btn">' + esc(tr('confirm')) + '</button></form>';
        }
        if (canCode) {
          h += '<div data-form="code"' + (canPassword ? ' style="margin-top:14px"' : '') + '>' +
            '<p style="margin-bottom:4px">' + esc(tr('codeLabel', { email: user.email })) + '</p>' +
            '<button type="button" class="pr-btn" data-act="send">' + esc(tr('sendCode')) + '</button>' +
            '<form data-form="verify" novalidate style="display:none;margin-top:8px">' +
              '<input id="bbPinReauthCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="' + esc(tr('codePlaceholder')) + '" aria-label="' + esc(tr('codePlaceholder')) + '">' +
              '<button type="submit" class="pr-btn">' + esc(tr('confirm')) + '</button></form>' +
            '<form data-form="twostep" novalidate style="display:none;margin-top:8px">' +
              '<label for="bbPinReauthTotp">' + esc(tr('twoStepLabel')) + '</label>' +
              '<input id="bbPinReauthTotp" inputmode="numeric" autocomplete="one-time-code" maxlength="6">' +
              '<button type="submit" class="pr-btn">' + esc(tr('confirm')) + '</button></form>' +
            '<div class="pr-msg" data-msg="code" aria-live="polite"></div>' +
            '<div class="pr-err" data-err="code" aria-live="polite"></div></div>';
        }
        h += '<button type="button" class="pr-btn pr-quiet" data-act="cancel">' + esc(tr('cancel')) + '</button></div>';
      }
      root.innerHTML = h;
      document.body.appendChild(root);

      var finished = false;
      function done(out) {
        if (finished) return;
        finished = true;
        if (root.parentNode) root.parentNode.removeChild(root);
        resolve(out);
      }
      function q(sel) { return root.querySelector(sel); }
      function setErr(which, key) { var el = q('[data-err="' + which + '"]'); if (el) el.textContent = key ? tr(key) : ''; }
      function busy(el, on) { if (el) el.disabled = !!on; }

      q('[data-act="cancel"]').addEventListener('click', function () { done(none ? 'unavailable' : 'cancel'); });
      root.addEventListener('keydown', function (e) { if (e.key === 'Escape') done(none ? 'unavailable' : 'cancel'); });

      // ── The phone's own lock ──
      var devBtn = q('[data-act="device"]');
      if (devBtn) devBtn.addEventListener('click', function () {
        var p = bioPlugin();
        setErr('device', '');
        busy(devBtn, true);
        var reason = tr('deviceReason');
        Promise.resolve().then(function () {
          return p.internalAuthenticate({
            reason: reason,
            cancelTitle: tr('cancel'),
            allowDeviceCredential: true,
            androidTitle: tr('title'),
            androidSubtitle: reason,
            androidConfirmationRequired: false,
          });
        }).then(function () { done('ok'); }, function () {
          busy(devBtn, false);
          setErr('device', 'deviceFailed');
        });
      });

      // ── Bipolar Bear password ──
      var pwForm = q('form[data-form="password"]');
      if (pwForm) pwForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var pw = q('#bbPinReauthPw').value;
        var btn = pwForm.querySelector('button');
        setErr('password', '');
        if (!pw) { setErr('password', 'wrongPassword'); return; }
        busy(btn, true);
        var u = currentUser();
        if (!u || u.uid !== user.uid) { busy(btn, false); setErr('password', 'failed'); return; }
        var cred;
        try { cred = firebase.auth.EmailAuthProvider.credential(u.email, pw); } catch (err) { busy(btn, false); setErr('password', 'failed'); return; }
        u.reauthenticateWithCredential(cred).then(function (res) {
          var got = res && res.user ? res.user.uid : (currentUser() || {}).uid;
          if (got !== user.uid) throw { code: 'mismatch' };
          done('ok');
        }).catch(function (err) {
          busy(btn, false);
          setErr('password', firebaseReason(err));
        });
      });

      // ── Universal ID: a fresh emailed code (+ two-step) ──
      var sendBtn = q('[data-act="send"]');
      var verifyForm = q('form[data-form="verify"]');
      var totpForm = q('form[data-form="twostep"]');
      function setMsg(key) { var el = q('[data-msg="code"]'); if (el) el.textContent = key ? tr(key) : ''; }
      function prove() {
        return BB.uid.proveAccount(user.uid).then(function (ok) {
          if (ok) { done('ok'); return; }
          setErr('code', 'failed');
        });
      }
      if (sendBtn) sendBtn.addEventListener('click', function () {
        setErr('code', ''); setMsg('');
        busy(sendBtn, true);
        BB.uid.sendCode(user.email).then(function (r) {
          busy(sendBtn, false);
          if (!r || !r.ok) { setErr('code', uidReason(r)); return; }
          setMsg('codeSent');
          verifyForm.style.display = '';
          try { q('#bbPinReauthCode').focus(); } catch (_) {}
        });
      });
      if (verifyForm) verifyForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = verifyForm.querySelector('button');
        setErr('code', ''); setMsg('');
        busy(btn, true);
        BB.uid.verifyCode(user.email, q('#bbPinReauthCode').value).then(function (r) {
          if (!r || !r.ok) { busy(btn, false); setErr('code', uidReason(r)); return null; }
          return BB.uid.twoStepFactor().then(function (factorId) {
            if (!factorId) return prove().then(function () { busy(btn, false); });
            return BB.uid.startTwoStep(factorId).then(function () {
              busy(btn, false);
              verifyForm.style.display = 'none';
              if (sendBtn) sendBtn.style.display = 'none';
              totpForm.style.display = '';
              try { q('#bbPinReauthTotp').focus(); } catch (_) {}
            });
          });
        }).catch(function (err) {
          busy(btn, false);
          setErr('code', err && err.code === 'network' ? 'network' : 'failed');
        });
      });
      if (totpForm) totpForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = totpForm.querySelector('button');
        setErr('code', '');
        busy(btn, true);
        BB.uid.verifyTwoStep(q('#bbPinReauthTotp').value).then(function (r) {
          if (!r || !r.ok) { busy(btn, false); setErr('code', uidReason(r)); return null; }
          return prove().then(function () { busy(btn, false); });
        }).catch(function () { busy(btn, false); setErr('code', 'failed'); });
      });

      var first = q('[data-act="device"]') || q('#bbPinReauthPw') || q('[data-act="send"]') || q('[data-act="cancel"]');
      try { first.focus(); } catch (_) {}
    });
  }

  BB.pinReauth = {
    confirm: confirm,
    deviceAvailable: deviceAvailable,
    /** Resolves once Firebase Auth has reported (max 6 s); then signedIn() is reliable. */
    authReady: authReady,
    signedIn: function () { return !!currentUser(); },
  };
})();
