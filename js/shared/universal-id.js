/**
 * Universal ID — the UNI·SIM sign-in, in front of Bipolar Bear's Firebase account.
 *
 * Exposes `BB.uid`. Loaded in <head> on every page that loads fab.js (index,
 * journal, survival-kit), and needs nothing else on the page: the Firebase
 * Functions SDK is not loaded everywhere, so the two Cloud Functions are called
 * over plain HTTPS with the callable protocol.
 *
 * How it fits together (James chose this "front door" design on 2026-10-05):
 *
 *   1. Universal ID signs the person in — a 6-digit code emailed to them, or
 *      their Universal ID password. That is Supabase Auth on the shared UNI·SIM
 *      project, called by hand here (no npm, no @unisim/sdk in this repo).
 *   2. `uidSignIn` (functions/index.js) checks that Supabase session and hands
 *      back a Firebase custom token for the Bipolar Bear account it belongs to,
 *      creating that account the first time.
 *   3. If a Bipolar Bear account already has that email, the function does NOT
 *      hand it over: the person types its old password once (a Firebase
 *      password sign-in), and `uidLink` then joins the two. Personal details
 *      are stored unencrypted, so an email match alone must never be enough.
 *   4. Firestore, its rules and the journal's end-to-end encryption carry on
 *      underneath unchanged. A Universal ID sign-in carries no password, so the
 *      journal asks for its own journal password when it needs the key (see
 *      `_ensureUserKey` in js/journal.js).
 *
 * ⚠️ PRIVACY. Supabase learns only that this person has a UNI·SIM account —
 * never that they use Bipolar Bear: no redirect URL, no metadata, no product
 * code is sent, and the user-count beat stays anonymous (privacy.html promises
 * the install id "is never linked to your account"). The Supabase user id ↔
 * Firebase uid join lives only in Firestore (`uidLinks`, Cloud Functions only).
 *
 * The session is kept in localStorage and dropped whenever Firebase reports
 * nobody signed in, so it never outlives the Bipolar Bear sign-in it opened.
 *
 * @file js/shared/universal-id.js
 */
(function () {
  'use strict';

  window.BB = window.BB || {};

  // Same project and PUBLISHABLE anon key as js/shared/user-count.js.
  var SUPABASE_URL = 'https://rygfxgalojojppxmhddo.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5Z2Z4Z2Fsb2pvanBweG1oZGRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NTY4MjUsImV4cCI6MjA5NDMzMjgyNX0.hLy_vt9vY_rdPKF3nL32yAuMCD604E3CH5VM7D7CaNE';
  var FUNCTIONS_REGION = 'europe-west1';
  var SESSION_KEY = 'bbUidSession';
  /** Refresh the access token when it has less than this left (seconds). */
  var REFRESH_MARGIN_S = 120;

  /** True while a sign-in is mid-flight, so its own "signed out" moment is ignored. */
  var _busy = false;

  // ── Session storage ───────────────────────────────────────────────────────

  function _load() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      var s = raw ? JSON.parse(raw) : null;
      return s && s.access_token && s.refresh_token ? s : null;
    } catch (e) { return null; }
  }

  function _save(s) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function _clear() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /** Keep only what this app uses from a GoTrue session response. */
  function _sessionFrom(j) {
    var now = Math.floor(Date.now() / 1000);
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || (now + (j.expires_in || 3600)),
      email: (j.user && j.user.email) || '',
    };
  }

  // ── Supabase Auth over REST ───────────────────────────────────────────────

  /**
   * POST to Supabase Auth. Resolves the parsed body on a 2xx and rejects with
   * `{ code, message, status }` otherwise (or `{ code: 'network' }` offline).
   */
  function _auth(path, body, accessToken) {
    if (typeof fetch !== 'function') return Promise.reject({ code: 'network', message: '' });
    return fetch(SUPABASE_URL + '/auth/v1/' + path, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + (accessToken || SUPABASE_KEY),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.text().then(function (text) {
        var j = null;
        try { j = text ? JSON.parse(text) : null; } catch (e) {}
        if (res.ok) return j;
        j = j || {};
        throw {
          status: res.status,
          code: j.error_code || j.code || j.error || null,
          message: j.msg || j.error_description || j.message || j.error || ('HTTP ' + res.status),
        };
      });
    }, function () {
      throw { code: 'network', message: '' };
    });
  }

  /** A failure as the sign-in screens want it: a reason they can word, plus detail. */
  function _failure(err) {
    var e = err || {};
    var msg = String(e.message || '');
    var code = String(e.code || '');
    var seconds = /after (\d+) seconds?/i.exec(msg);
    var reason = 'other';
    if (code === 'network') reason = 'network';
    else if (seconds || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || e.status === 429) reason = 'rate_limited';
    else if (code === 'otp_expired' || /expired|invalid.*(otp|token|code)|token.*(expired|invalid)/i.test(msg)) reason = 'invalid_code';
    else if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) reason = 'bad_credentials';
    else if (code === 'email_address_invalid' || /invalid.*email|email.*invalid/i.test(msg)) reason = 'bad_email';
    return { ok: false, reason: reason, message: msg, retryAfter: seconds ? Number(seconds[1]) : null };
  }

  /**
   * A live access token, refreshed first if it is about to run out. Resolves
   * null (and forgets the session) if it can no longer be refreshed.
   */
  function _accessToken() {
    var s = _load();
    if (!s) return Promise.resolve(null);
    var now = Math.floor(Date.now() / 1000);
    if (s.expires_at - now > REFRESH_MARGIN_S) return Promise.resolve(s.access_token);
    return _auth('token?grant_type=refresh_token', { refresh_token: s.refresh_token })
      .then(function (j) { var n = _sessionFrom(j); _save(n); return n.access_token; })
      .catch(function (err) {
        // Offline: keep the session for later. Refused: it is over.
        if (!err || err.code !== 'network') _clear();
        return null;
      });
  }

  // ── Bipolar Bear's Cloud Functions (callable protocol over fetch) ────────

  function _functionsUrl(name) {
    var cfg = window.BB_FIREBASE_CONFIG || {};
    return 'https://' + FUNCTIONS_REGION + '-' + cfg.projectId + '.cloudfunctions.net/' + name;
  }

  /**
   * Call a callable Cloud Function. Sends the Firebase ID token when someone
   * is signed in to Firebase. Rejects with `{ code, message }`.
   */
  function _callFunction(name, data) {
    var user = null;
    try { user = window.firebase && firebase.auth && firebase.auth().currentUser; } catch (e) {}
    var idToken = user ? user.getIdToken() : Promise.resolve(null);
    return idToken.then(function (token) {
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      return fetch(_functionsUrl(name), {
        method: 'POST', headers: headers, body: JSON.stringify({ data: data || {} }),
      }).catch(function () { throw { code: 'network', message: '' }; });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (res.ok && j && 'result' in j) return j.result;
        var e = (j && j.error) || {};
        throw { code: String(e.status || res.status).toLowerCase(), message: e.message || ('HTTP ' + res.status) };
      });
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Email a 6-digit Universal ID code. A new address gets an account made when
   * the code is typed. Never rejects.
   * @returns {Promise<{ok:true}|{ok:false, reason:string, message:string, retryAfter:?number}>}
   */
  function sendCode(email) {
    email = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Promise.resolve({ ok: false, reason: 'bad_email', message: '', retryAfter: null });
    }
    return _auth('otp', { email: email, create_user: true })
      .then(function () { return { ok: true }; }, _failure);
  }

  /**
   * Check a typed code. On success the Universal ID session is stored; the
   * caller then runs `finishSignIn()`. Never rejects.
   */
  function verifyCode(email, code) {
    var token = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6,10}$/.test(token)) {
      return Promise.resolve({ ok: false, reason: 'invalid_code', message: '', retryAfter: null });
    }
    return _auth('verify', { type: 'email', email: String(email || '').trim(), token: token })
      .then(function (j) { _save(_sessionFrom(j)); return { ok: true }; }, _failure);
  }

  /** Universal ID password sign-in (existing Universal ID accounts only). Never rejects. */
  function signInWithPassword(email, password) {
    return _auth('token?grant_type=password', { email: String(email || '').trim(), password: String(password || '') })
      .then(function (j) { _save(_sessionFrom(j)); return { ok: true }; }, _failure);
  }

  /**
   * Swap the Universal ID session for a Firebase sign-in.
   * @returns {Promise<{status:'signed-in', created:boolean}|{status:'link', email:string}>}
   *   `link`: a Bipolar Bear account already has this email and must be
   *   proved with its password first (then `linkCurrentAccount`).
   *   Rejects with `{ code, message }`.
   */
  function finishSignIn() {
    _busy = true;
    return _accessToken().then(function (token) {
      if (!token) throw { code: 'no-session', message: '' };
      return _callFunction('uidSignIn', { token: token });
    }).then(function (r) {
      if (r && r.status === 'link') return { status: 'link', email: r.email || '' };
      if (!r || !r.customToken) throw { code: 'internal', message: 'No sign-in token' };
      return firebase.auth().signInWithCustomToken(r.customToken)
        .then(function () { return { status: 'signed-in', created: !!r.created }; });
    }).then(function (out) { _busy = false; return out; }, function (err) { _busy = false; throw err; });
  }

  /**
   * Join the Bipolar Bear account that is signed in right now (by password,
   * moments ago) to the Universal ID session. Rejects with `{ code, message }`.
   */
  function linkCurrentAccount() {
    return _accessToken().then(function (token) {
      if (!token) throw { code: 'no-session', message: '' };
      return _callFunction('uidLink', { token: token });
    }).then(function () {
      // The function marked the email verified: refresh the ID token so the
      // Firestore rules (and the Bipolar Anonymous board) see it now.
      var u = firebase.auth().currentUser;
      return u ? u.getIdToken(true).then(function () {}) : undefined;
    });
  }

  /**
   * Sign in to Firebase again from the Universal ID session — a fresh sign-in,
   * which is what deleting the account requires. Resolves false when there is
   * no usable session.
   */
  function refreshFirebaseSignIn() {
    if (!_load()) return Promise.resolve(false);
    return finishSignIn().then(function (r) { return r.status === 'signed-in'; }, function () { return false; });
  }

  /** Forget the Universal ID session here (and tell Supabase, best effort). */
  function signOut() {
    var s = _load();
    _clear();
    if (s) _auth('logout?scope=local', {}, s.access_token).catch(function () {});
  }

  /**
   * True when this Firebase user can only be re-proved through Universal ID
   * (no Bipolar Bear password on the account).
   */
  function isUidOnly(user) {
    if (!user) return false;
    var providers = (user.providerData || []).map(function (p) { return p && p.providerId; });
    return providers.indexOf('password') === -1;
  }

  // Drop the session whenever Firebase says nobody is signed in — sign-out in
  // any page, an expired web session, a deleted account. Firebase initialises
  // in each page's own script, so wait for it.
  (function _attach(tries) {
    var ready = false;
    try { ready = !!(window.firebase && firebase.apps && firebase.apps.length && firebase.auth); } catch (e) {}
    if (!ready) {
      if (tries < 60) setTimeout(function () { _attach(tries + 1); }, 500);
      return;
    }
    firebase.auth().onAuthStateChanged(function (user) {
      if (!user && !_busy && _load()) signOut();
    });
  })(0);

  window.BB.uid = {
    hasSession: function () { return !!_load(); },
    sendCode: sendCode,
    verifyCode: verifyCode,
    signInWithPassword: signInWithPassword,
    finishSignIn: finishSignIn,
    linkCurrentAccount: linkCurrentAccount,
    refreshFirebaseSignIn: refreshFirebaseSignIn,
    signOut: signOut,
    isUidOnly: isUidOnly,
  };
})();
