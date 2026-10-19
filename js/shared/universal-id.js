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
    var get = body === null; // null body = GET (e.g. 'user')
    return fetch(SUPABASE_URL + '/auth/v1/' + path, {
      method: get ? 'GET' : 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + (accessToken || SUPABASE_KEY),
        'Content-Type': 'application/json',
      },
      body: get ? undefined : JSON.stringify(body || {}),
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
    else if (code === 'otp_expired' || code === 'mfa_verification_failed' || code === 'mfa_challenge_expired' || /expired|invalid.*(otp|token|code)|token.*(expired|invalid)/i.test(msg)) reason = 'invalid_code';
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
        throw { code: String(e.status || res.status).toLowerCase().replace(/_/g, '-'), message: e.message || ('HTTP ' + res.status), details: e.details || null };
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
  function finishSignIn(opts) {
    // `create: false` after Apple, Google or a passkey: the server answers
    // `{ status: 'new' }` instead of making an account, and the sheet asks.
    var create = !(opts && opts.create === false);
    _busy = true;
    return _accessToken().then(function (token) {
      if (!token) throw { code: 'no-session', message: '' };
      return _callFunction('uidSignIn', create ? { token: token } : { token: token, create: false });
    }).then(function (r) {
      if (r && r.status === 'link') return { status: 'link', email: r.email || '' };
      if (r && r.status === 'new') return { status: 'new', email: r.email || '', relay: !!r.relay };
      if (!r || !r.customToken) throw { code: 'internal', message: 'No sign-in token' };
      return firebase.auth().signInWithCustomToken(r.customToken)
        .then(function () { return { status: 'signed-in', created: !!r.created }; });
    }).then(function (out) {
      _busy = false;
      // 'link' and 'new' still need this session for the person's answer.
      if (out.status === 'signed-in') _hold = false;
      return out;
    }, function (err) { _busy = false; throw err; });
  }

  // ── Apple, Google and passkeys (2026-10-19) ──────────────────────────────
  // Each one ends in an ordinary Universal ID session, so everything after it
  // is the emailed code's path: uidSignIn → the same uidLinks join → the same
  // Firebase uid → the same journal and its key. Supabase links a provider to
  // an existing Universal ID by itself when the provider's address is verified
  // and matches; any other address is a different Universal ID, and
  // finishSignIn({ create: false }) makes sure that never silently becomes a
  // second, empty Bipolar Bear account.
  //
  //   Web: Apple and Google go to Supabase's /authorize with PKCE and come back
  //     to this page with ?uidReturn=1&code=… (the code is useless without the
  //     verifier kept in sessionStorage). Tokens in a URL are never accepted.
  //   Native: the app's own BBSignIn plugin (bipolarbear-native). Apple on
  //     iPhone is the system sheet (App Review 4.8); Google, and Apple on
  //     Android, run in the system browser (ASWebAuthenticationSession / a
  //     Custom Tab) and come back to <app id>://auth-callback with a code.
  //   Passkeys: the Hub's passkeys, relying party app.unisim.co.uk (moving it
  //     would orphan every passkey). The apps use the system passkey sheet,
  //     allowed by the Hub's apple-app-site-association (webcredentials) and
  //     assetlinks.json, and the session counts as two-step (0294). The
  //     website can't run a ceremony for app.unisim.co.uk (hosted Supabase
  //     refuses other origins, so Related Origin Requests are out): it goes
  //     to app.unisim.co.uk/passkey-handoff, which runs it there and comes
  //     back with a single-use code and our state in the fragment
  //     (#bb_passkey=…&state=…). That session is an emailed-link one (aal1),
  //     so an account with an authenticator app is asked for its code.
  //
  // ⚠️ A provider sign-in tells Supabase this site's address (the redirect).
  // That is the price of Apple and Google; the emailed code still sends none.
  // Apple's name is not asked for or kept.

  var NATIVE_PLUGIN = 'BBSignIn';
  var PKCE_KEY = 'bbUidPkce';
  var RETURN_PARAM = 'uidReturn';
  /** How long a provider round trip may take before its verifier is refused. */
  var PKCE_MAX_AGE_MS = 15 * 60 * 1000;
  var PASSKEY_RP_ID = 'app.unisim.co.uk';
  /** The Hub page that runs a passkey sign-in for this website. */
  var PASSKEY_HANDOFF_URL = 'https://app.unisim.co.uk/passkey-handoff';
  /** The pages that Hub page will send a code back to (src/lib/bearPasskey.ts there). */
  var PASSKEY_WEB_ORIGINS = ['https://www.bipolarbear.app', 'https://bipolarbear.app'];
  var PASSKEY_STATE_KEY = 'bbUidPasskeyState';

  /** Keeps a just-made session alive through Firebase's first "nobody signed in". */
  var _hold = false;

  function _isNative() {
    try { var c = window.Capacitor; return !!(c && c.isNativePlatform && c.isNativePlatform()); } catch (e) { return false; }
  }

  function _plugin() {
    if (!_isNative()) return null;
    try {
      var c = window.Capacitor;
      if (c.isPluginAvailable && !c.isPluginAvailable(NATIVE_PLUGIN)) return null;
      return (c.Plugins && c.Plugins[NATIVE_PLUGIN]) || null;
    } catch (e) { return null; }
  }

  var _supportP = null;
  /** What this app's native half can do, or null (a browser, or a build without it). */
  function _nativeSupport() {
    var p = _plugin();
    if (!p || typeof p.support !== 'function') return Promise.resolve(null);
    if (!_supportP) {
      _supportP = Promise.resolve().then(function () { return p.support(); }).then(function (s) {
        return s && (s.platform === 'ios' || s.platform === 'android') && _isCallback(s.callbackUrl) ? s : null;
      }, function () { return null; });
    }
    return _supportP;
  }

  function _b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** A PKCE verifier and its S256 challenge ('plain' only where WebCrypto is missing). */
  function _pkce() {
    var bytes = crypto.getRandomValues(new Uint8Array(32));
    var verifier = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    var plain = { verifier: verifier, challenge: verifier, method: 'plain' };
    var subtle = window.crypto && window.crypto.subtle;
    if (!subtle || typeof TextEncoder === 'undefined') return Promise.resolve(plain);
    return subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (d) {
      return { verifier: verifier, challenge: _b64url(new Uint8Array(d)), method: 's256' };
    }, function () { return plain; });
  }

  function _authorizeUrl(provider, redirectTo, p) {
    return SUPABASE_URL + '/auth/v1/authorize?provider=' + encodeURIComponent(provider) +
      '&redirect_to=' + encodeURIComponent(redirectTo) +
      '&code_challenge=' + encodeURIComponent(p.challenge) +
      '&code_challenge_method=' + p.method;
  }

  /** Store a token response from Supabase as this app's session. */
  function _saveTokens(j) {
    if (!j || !j.access_token || !j.refresh_token) throw { code: 'invalid_response', message: '' };
    _save(_sessionFrom(j));
  }

  function _exchangeCode(code, verifier) {
    return _auth('token?grant_type=pkce', { auth_code: code, code_verifier: verifier }).then(_saveTokens);
  }

  /** `scheme://auth-callback`, split by hand (old Android WebViews mis-parse custom schemes). */
  function _splitCallback(value) {
    var m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(String(value || ''));
    if (!m) return null;
    return {
      scheme: m[1].toLowerCase(), host: m[2].toLowerCase(),
      query: new URLSearchParams((m[4] || '').slice(1)), fragment: new URLSearchParams((m[5] || '').slice(1)),
    };
  }

  function _isCallback(url) {
    var c = _splitCallback(url);
    return !!(c && c.host === 'auth-callback' && c.scheme !== 'http' && c.scheme !== 'https');
  }

  function _errorFrom(params) {
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      var msg = p.get('error_description') || p.get('error') || p.get('error_code');
      if (msg) return String(msg).replace(/\+/g, ' ');
    }
    return null;
  }

  /**
   * Read what came back to the app's callback address. Only a `code` is
   * accepted: tokens in a fragment are refused, because on Android any app
   * can fire this address at us, and a code is worthless without our verifier.
   */
  function _parseCallback(received, expected) {
    var got = _splitCallback(received), want = _splitCallback(expected);
    if (!got || !want || got.scheme !== want.scheme || got.host !== want.host) return { invalid: true };
    var err = _errorFrom([got.query, got.fragment]);
    if (err) return { error: err };
    var code = got.query.get('code');
    return code ? { code: code } : { invalid: true };
  }

  function _providerFailure(message) {
    return { ok: false, reason: /cancel|denied|access_denied/i.test(message || '') ? 'cancelled' : 'provider', message: message || '', retryAfter: null };
  }

  function _nativeProvider(plugin, provider) {
    return _nativeSupport().then(function (s) {
      if (!s) throw { code: 'native-unavailable', message: '' };
      if (provider === 'apple' && s.appleNative) {
        return Promise.resolve(plugin.appleSignIn()).then(function (r) {
          if (r && r.cancelled) return { ok: false, reason: 'cancelled', message: '', retryAfter: null };
          if (!r || !r.identityToken || !r.nonce) throw { code: 'apple_no_token', message: '' };
          // The RAW nonce: Apple was sent its SHA-256, and Supabase compares the two.
          return _auth('token?grant_type=id_token', { provider: 'apple', id_token: r.identityToken, nonce: r.nonce })
            .then(_saveTokens).then(function () { return { ok: true }; });
        });
      }
      return _pkce().then(function (p) {
        return Promise.resolve(plugin.oauthStart({ url: _authorizeUrl(provider, s.callbackUrl, p) })).then(function (r) {
          if (r && r.cancelled) return { ok: false, reason: 'cancelled', message: '', retryAfter: null };
          var cb = _parseCallback(r && r.url, s.callbackUrl);
          if (cb.error) return _providerFailure(cb.error);
          if (!cb.code) throw { code: 'invalid_callback', message: '' };
          return _exchangeCode(cb.code, p.verifier).then(function () { return { ok: true }; });
        });
      });
    });
  }

  /**
   * Sign in to Universal ID with Apple or Google. Resolves `{ ok: true }` with
   * the session stored (then call `finishSignIn({ create: false })`), or
   * `{ ok: true, redirected: true }` on the web, where the page is leaving for
   * the provider and `pendingReturn()` finishes the job when it comes back.
   * Never rejects.
   */
  function startProvider(provider) {
    if (provider !== 'apple' && provider !== 'google') return Promise.resolve(_failure({}));
    _challenge = null;
    if (_isNative()) {
      var plugin = _plugin();
      if (!plugin) return Promise.resolve(_failure({ code: 'native-unavailable' }));
      return _nativeProvider(plugin, provider).catch(_failure);
    }
    return _pkce().then(function (p) {
      var back = location.origin + location.pathname + '?' + RETURN_PARAM + '=1';
      try {
        sessionStorage.setItem(PKCE_KEY, JSON.stringify({ v: p.verifier, provider: provider, at: Date.now() }));
      } catch (e) {
        // Without the verifier the code that comes back can't be redeemed.
        return _failure({});
      }
      location.assign(_authorizeUrl(provider, back, p));
      return { ok: true, redirected: true };
    }).catch(_failure);
  }

  /**
   * The web return leg, read once when this script loads: null when this page
   * load is not coming back from Apple or Google, else `{ ok: true, provider }`
   * with the session stored, or a failure. The parameters leave the address
   * bar straight away, so a reload never repeats it.
   */
  var _returnP = (function () {
    if (_isNative() || typeof location === 'undefined' || typeof URL !== 'function') return Promise.resolve(null);
    var url;
    try { url = new URL(location.href); } catch (e) { return Promise.resolve(null); }
    var frag = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (frag.has('bb_passkey') || frag.has('bb_passkey_error')) return _passkeyReturn(url, frag);
    if (url.searchParams.get(RETURN_PARAM) !== '1') return Promise.resolve(null);
    var code = url.searchParams.get('code');
    var err = _errorFrom([url.searchParams, new URLSearchParams(url.hash.replace(/^#/, ''))]);
    [RETURN_PARAM, 'code', 'error', 'error_code', 'error_description', 'state'].forEach(function (k) { url.searchParams.delete(k); });
    // Tokens or an error in the fragment are dropped, never used.
    if (/(^|[#&])(access_token|refresh_token|error)/.test(url.hash)) url.hash = '';
    try { history.replaceState(history.state, '', url.pathname + url.search + url.hash); } catch (e) {}
    var stored = null;
    try { stored = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null'); sessionStorage.removeItem(PKCE_KEY); } catch (e) {}
    var provider = stored && stored.provider || null;
    if (err) return Promise.resolve(Object.assign(_providerFailure(err), { provider: provider }));
    if (!code || !stored || !stored.v || !(Date.now() - Number(stored.at) < PKCE_MAX_AGE_MS)) {
      // Not a sign-in this tab started (or it took too long): nothing to redeem.
      return Promise.resolve(code ? Object.assign(_providerFailure(''), { provider: provider }) : null);
    }
    _hold = true;
    return _exchangeCode(code, stored.v).then(function () {
      return { ok: true, provider: provider };
    }, function (e) {
      _hold = false;
      return Object.assign(_failure(e), { provider: provider });
    });
  })();

  /** Back from app.unisim.co.uk/passkey-handoff: redeem its code if our state matches. */
  function _passkeyReturn(url, frag) {
    var tokenHash = frag.get('bb_passkey'), err = frag.get('bb_passkey_error'), state = frag.get('state');
    try { history.replaceState(history.state, '', url.pathname + url.search); } catch (e) {}
    var stored = null;
    try { stored = JSON.parse(sessionStorage.getItem(PASSKEY_STATE_KEY) || 'null'); sessionStorage.removeItem(PASSKEY_STATE_KEY); } catch (e) {}
    var fail = function (reason) { return { ok: false, reason: reason, message: '', retryAfter: null, provider: 'passkey' }; };
    // A code this tab did not ask for is never used: it could be someone
    // else's account, and this person's journal would be saved into it.
    if (!stored || !stored.s || stored.s !== state || !(Date.now() - Number(stored.at) < PKCE_MAX_AGE_MS)) {
      return Promise.resolve(tokenHash ? fail('provider') : null);
    }
    if (err || !tokenHash) return Promise.resolve(fail(err === 'cancelled' ? 'cancelled' : 'provider'));
    _hold = true;
    return _auth('verify', { type: 'magiclink', token_hash: tokenHash }).then(_saveTokens).then(function () {
      return { ok: true, provider: 'passkey' };
    }, function (e) {
      _hold = false;
      return Object.assign(_failure(e), { provider: 'passkey' });
    });
  }

  function pendingReturn() { return _returnP; }

  // ── Passkeys and security keys ──

  var _settingsP = null;
  /** Supabase's public auth settings (which providers are on), cached per page. */
  function _settings() {
    if (!_settingsP) {
      _settingsP = _auth('settings', null).then(function (j) { return j || {}; }, function () {
        _settingsP = null;
        return {};
      });
    }
    return _settingsP;
  }

  /** Whether a passkey sign-in can be offered here. */
  function _passkeyHere() {
    if (_isNative()) return _nativeSupport().then(function (s) { return !!(s && s.passkeys); });
    try {
      // Only on the pages the Hub sends a code back to, in a browser with WebAuthn.
      return Promise.resolve(PASSKEY_WEB_ORIGINS.indexOf(location.origin) !== -1 && !!window.PublicKeyCredential);
    } catch (e) { return Promise.resolve(false); }
  }

  /**
   * Which of Apple / Google / a passkey this sheet can offer here. Never rejects.
   * ⚠️ App Review 4.8: an iPhone app offers Google only alongside Apple.
   */
  function signInOptions() {
    return Promise.all([_settings(), _isNative() ? _nativeSupport() : Promise.resolve(null), _passkeyHere()])
      .then(function (a) {
        var ext = (a[0] && a[0].external) || {}, s = a[1];
        var apple = ext.apple === true, google = ext.google === true;
        if (_isNative() && !s) apple = google = false;
        if (s && s.platform === 'ios' && !apple) google = false;
        return { apple: apple, google: google, passkey: a[0].passkeys_enabled === true && a[2] === true };
      }, function () { return { apple: false, google: false, passkey: false }; });
  }

  /**
   * Sign in to Universal ID with a passkey or a security key (one the person
   * added on the UNI·SIM Hub). The key must check it's you (PIN, fingerprint,
   * Face ID). Native: the system passkey sheet; resolves `{ ok: true }` with
   * the session stored. Web: `{ ok: true, redirected: true }`, the page is
   * leaving for the Hub and `pendingReturn()` finishes it. Else a failure
   * whose reason is 'cancelled', 'no-passkey' or a usual one. Never rejects.
   */
  /** The website's passkey sign-in: off to the Hub page, with a state only this tab knows. */
  function _webPasskey() {
    try {
      var bytes = crypto.getRandomValues(new Uint8Array(32));
      var state = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      sessionStorage.setItem(PASSKEY_STATE_KEY, JSON.stringify({ s: state, at: Date.now() }));
      location.assign(PASSKEY_HANDOFF_URL + '?return=' + encodeURIComponent(location.origin + location.pathname) +
        '&state=' + state);
      return Promise.resolve({ ok: true, redirected: true });
    } catch (e) {
      return Promise.resolve(_failure({}));
    }
  }

  function signInWithPasskey() {
    _challenge = null;
    if (!_isNative()) return _webPasskey();
    var plugin = _plugin();
    if (!plugin) return Promise.resolve(_failure({ code: 'native-unavailable' }));
    return _auth('passkeys/authentication/options', {}).then(function (start) {
      var options = start && start.options;
      if (!start || !start.challenge_id || !options || options.rpId !== PASSKEY_RP_ID) {
        throw { code: 'invalid_response', message: '' };
      }
      options.userVerification = 'required';
      return Promise.resolve(plugin.passkeyGet({ options: JSON.stringify(options) })).then(function (r) {
        if (r && r.cancelled) throw { code: 'cancelled', message: '' };
        if (r && r.noCredential) throw { code: 'no-passkey', message: '' };
        var c = r && r.credential;
        if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) { c = null; } }
        if (!c || !c.id || !c.response) throw { code: 'invalid_response', message: '' };
        return c;
      }).then(function (credential) {
        return _auth('passkeys/authentication/verify', { challenge_id: start.challenge_id, credential: credential });
      });
    }).then(function (j) {
      _saveTokens(j);
      return { ok: true };
    }).catch(function (e) {
      var code = e && e.code;
      if (code === 'cancelled' || code === 'no-passkey') {
        return { ok: false, reason: code, message: (e && e.message) || '', retryAfter: null };
      }
      return _failure(e);
    });
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
      // reload() brings user.emailVerified up to date as well.
      var u = firebase.auth().currentUser;
      return u ? u.getIdToken(true).then(function () { return u.reload(); }) : undefined;
    });
  }

  // ── Two-step verification (an authenticator app, set up on the UNI·SIM Hub) ──
  // A code or a password alone leaves an aal1 session. An account with a
  // verified TOTP factor owes the authenticator code before it is aal2, and
  // uidSignIn refuses anything less (the server is the lock; this is the door).

  /** The assurance level claimed by an access token ('aal1' / 'aal2'), or null. */
  function _aal(token) {
    try {
      var part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (part.length % 4) part += '=';
      return JSON.parse(atob(part)).aal || null;
    } catch (e) { return null; }
  }

  var _challenge = null; // { factorId, challengeId } between the two round trips

  /**
   * The verified authenticator this session still owes a code for, or null
   * when none is owed. Rejects with `{ code }` if Supabase can't be asked.
   * @returns {Promise<?string>} factor id
   */
  function twoStepFactor() {
    return _accessToken().then(function (token) {
      if (!token) throw { code: 'no-session', message: '' };
      if (_aal(token) === 'aal2') return null;
      return _auth('user', null, token).then(function (u) {
        var f = ((u && u.factors) || []).filter(function (x) {
          return x && x.status === 'verified' && x.factor_type === 'totp';
        })[0];
        return f ? f.id : null;
      });
    });
  }

  /** Start (or restart) a challenge against that authenticator. Rejects with `{ code }`. */
  function startTwoStep(factorId) {
    return _accessToken().then(function (token) {
      if (!token) throw { code: 'no-session', message: '' };
      return _auth('factors/' + encodeURIComponent(factorId) + '/challenge', {}, token);
    }).then(function (ch) {
      _challenge = { factorId: factorId, challengeId: ch.id };
    });
  }

  /**
   * Check the authenticator code. On success the session is aal2. On failure a
   * fresh challenge is made, because Supabase burns one on the first attempt.
   * Never rejects.
   */
  function verifyTwoStep(code) {
    var c = String(code || '').replace(/\s+/g, '');
    if (!_challenge || !/^\d{6}$/.test(c)) {
      return Promise.resolve({ ok: false, reason: 'invalid_code', message: '', retryAfter: null });
    }
    var ch = _challenge;
    return _accessToken().then(function (token) {
      if (!token) throw { code: 'no-session', message: '' };
      return _auth('factors/' + encodeURIComponent(ch.factorId) + '/verify',
        { challenge_id: ch.challengeId, code: c }, token);
    }).then(function (j) {
      _save(_sessionFrom(j));
      _challenge = null;
      return { ok: true };
    }, function (err) {
      return startTwoStep(ch.factorId).catch(function () {}).then(function () { return _failure(err); });
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

  /**
   * Prove that the Universal ID session belongs to the Firebase account
   * `expectedUid`, WITHOUT signing in to anything: `uidSignIn` checks the
   * session (and its two-step level) and mints a custom token for the account
   * it maps to; the token's `uid` claim is compared and the token thrown away.
   * Used by "Forgot PIN?" (js/shared/pin-reauth.js) after a FRESH emailed code,
   * so a different account can never end up signed in. Resolves false on any
   * failure, including `{ status: 'link' }`.
   */
  function proveAccount(expectedUid) {
    if (!expectedUid) return Promise.resolve(false);
    return _accessToken().then(function (token) {
      if (!token) return false;
      return _callFunction('uidSignIn', { token: token }).then(function (r) {
        if (!r || !r.customToken) return false;
        try {
          var part = String(r.customToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          while (part.length % 4) part += '=';
          return JSON.parse(atob(part)).uid === expectedUid;
        } catch (e) { return false; }
      });
    }).catch(function () { return false; });
  }

  /** Forget the Universal ID session here (and tell Supabase, best effort). */
  function signOut() {
    var s = _load();
    _clear();
    _challenge = null;
    _hold = false;
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
      if (!user && !_busy && !_hold && _load()) signOut();
    });
  })(0);

  window.BB.uid = {
    hasSession: function () { return !!_load(); },
    sendCode: sendCode,
    verifyCode: verifyCode,
    signInWithPassword: signInWithPassword,
    finishSignIn: finishSignIn,
    startProvider: startProvider,
    pendingReturn: pendingReturn,
    signInWithPasskey: signInWithPasskey,
    signInOptions: signInOptions,
    linkCurrentAccount: linkCurrentAccount,
    twoStepFactor: twoStepFactor,
    startTwoStep: startTwoStep,
    verifyTwoStep: verifyTwoStep,
    refreshFirebaseSignIn: refreshFirebaseSignIn,
    proveAccount: proveAccount,
    signOut: signOut,
    isUidOnly: isUidOnly,
  };
})();
