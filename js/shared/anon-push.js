/**
 * Push notifications for the Bipolar Anonymous board.
 *
 * Four things can notify a member — a reply to their post, a new
 * announcement, a new post in General Chat, and the weekly digest — and all
 * four are sent by Cloud Functions through Firebase Cloud Messaging (see
 * `functions/index.js`). This module is the client half: it asks for
 * permission, gets an FCM registration token, and keeps one document per
 * token in `bbAnonPush` carrying the member's monika and which ones they want.
 *
 * Delivery paths, in the order they're tried:
 *
 *   1. `FirebaseMessaging` (@capacitor-firebase/messaging) — the native
 *      path for both iOS and Android. Returns a real FCM token, which is
 *      what the admin SDK sends to.
 *   2. `PushNotifications` (@capacitor/push-notifications) — Android only.
 *      Its token is an FCM token there; on iOS it hands back a raw APNs
 *      token, which `admin.messaging()` cannot send to, so iOS without the
 *      plugin above is reported as unsupported rather than half-working.
 *   3. Web push — `firebase-messaging-compat` plus `firebase-messaging-sw.js`,
 *      gated on `window.BB_PUSH_VAPID_KEY` being filled in.
 *
 * Everything is feature-detected. With no plugin installed and no VAPID key
 * set, `isSupported()` is false, the settings rows explain why, and nothing
 * throws — so this ships safely ahead of the native/console setup it needs
 * (setup steps are kept in local notes).
 *
 * Loaded by anonymous.html only. `configure()` must be called with the
 * page's Firestore handle before anything else does something useful.
 *
 * @file js/shared/anon-push.js
 */
(function () {
  'use strict';

  var SDK_VERSION = '10.7.1';           // must match the compat SDKs in anonymous.html
  var COLLECTION  = 'bbAnonPush';       // one doc per registration token
  var TOKEN_KEY   = 'Anon_pushToken';
  // '1' once the member has answered the opt-in sheet, or been shown the OS
  // permission prompt from settings. The '2' drops flags written before v220:
  // until then enable() set this even on a device with nothing to deliver
  // with, so a switch tapped in an older build (or before web push existed)
  // read as "declined" and hid the sheet for good.
  var ASKED_KEY   = 'Anon_notifAsked2';
  // Same, for the sheet since it started leading with new posts. Kept apart
  // from ASKED_KEY so members asked before the posts switch existed can still
  // be offered it — once.
  var POSTS_ASKED_KEY = 'Anon_notifPostsAsked2';
  var PREF_KEYS   = {
    replies:       'Anon_notifReplies',
    announcements: 'Anon_notifAnn',
    posts:         'Anon_notifPosts',
    weekly:        'Anon_notifWeekly',
  };
  // What the opt-in sheet shows a member who has never chosen: every switch
  // off. Suite rule — nothing is ticked on someone's behalf; they turn on what
  // they want. getPrefs() reads only an explicit stored 'true', so a member who
  // already saved choices keeps exactly those (a missing key is never a yes).
  var DEFAULT_PREFS = { replies: false, announcements: false, posts: false, weekly: false };

  function allOff() {
    var out = {};
    Object.keys(PREF_KEYS).forEach(function (k) { out[k] = false; });
    return out;
  }

  var _db       = null;
  var _identity = function () { return {}; };  // () => { monika, emailHash }
  var _onMessage = null;                       // foreground push handler
  // () => Promise — makes sure there's a Firebase Auth session before a
  // bbAnonPush write (the rules require one). Deletes don't need it.
  var _ensureAuth = function () { return Promise.resolve(); };
  var _wired    = false;                       // native listeners attached once

  function store() { return (window.BB && window.BB.storage) || null; }
  function get(k)      { var s = store(); return s ? s.get(k) : null; }
  function set(k, v)   { var s = store(); if (s) s.set(k, v); }
  function remove(k)   { var s = store(); if (s) s.remove(k); }

  function plugin(name) {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name];
  }
  function isNative() {
    return !!(window.BB && window.BB.platform && window.BB.platform.isNative());
  }
  function isIOS() {
    return !!(window.BB && window.BB.platform && window.BB.platform.isIOS());
  }
  function log() {
    if (window.BB && window.BB.log) window.BB.log.apply(null, arguments);
  }

  // ── Preferences ─────────────────────────────────────────────────────────

  function getPrefs() {
    var out = {};
    Object.keys(PREF_KEYS).forEach(function (k) { out[k] = get(PREF_KEYS[k]) === 'true'; });
    return out;
  }
  function writePrefsLocally(prefs) {
    Object.keys(PREF_KEYS).forEach(function (k) {
      set(PREF_KEYS[k], prefs[k] ? 'true' : 'false');
    });
  }
  function anyOn(prefs) {
    return Object.keys(PREF_KEYS).some(function (k) { return !!prefs[k]; });
  }
  function hasBeenAsked()  { return get(ASKED_KEY) === '1'; }
  function hasBeenAskedAboutPosts() { return get(POSTS_ASKED_KEY) === '1'; }
  function markAsked()     { set(ASKED_KEY, '1'); set(POSTS_ASKED_KEY, '1'); }

  // ── Capability ──────────────────────────────────────────────────────────

  function webSupported() {
    return !!(window.BB_PUSH_VAPID_KEY
      && typeof Notification !== 'undefined'
      && 'serviceWorker' in navigator
      && window.isSecureContext);
  }
  function nativeSupported() {
    if (plugin('FirebaseMessaging')) return true;
    // Android's PushNotifications token IS an FCM token; iOS's is not.
    return !isIOS() && !!plugin('PushNotifications');
  }
  function isSupported() {
    return isNative() ? nativeSupported() : webSupported();
  }

  /**
   * OS-level permission as it stands right now.
   * @returns {Promise<'granted'|'denied'|'prompt'|'unsupported'>}
   */
  function permissionState() {
    if (!isSupported()) return Promise.resolve('unsupported');
    if (isNative()) {
      var fm = plugin('FirebaseMessaging') || plugin('PushNotifications');
      return fm.checkPermissions()
        .then(function (r) { return normalisePermission(r && r.receive); })
        .catch(function () { return 'prompt'; });
    }
    return Promise.resolve(normalisePermission(Notification.permission));
  }

  function normalisePermission(value) {
    if (value === 'granted')           return 'granted';
    if (value === 'denied')            return 'denied';
    return 'prompt';                   // 'prompt', 'prompt-with-rationale', 'default'
  }

  function requestPermission() {
    if (isNative()) {
      var fm = plugin('FirebaseMessaging') || plugin('PushNotifications');
      return fm.requestPermissions()
        .then(function (r) { return normalisePermission(r && r.receive); })
        .catch(function () { return 'denied'; });
    }
    return Notification.requestPermission()
      .then(normalisePermission)
      .catch(function () { return 'denied'; });
  }

  // ── Token acquisition ───────────────────────────────────────────────────

  function nativeToken() {
    var fm = plugin('FirebaseMessaging');
    if (fm) {
      return fm.getToken()
        .then(function (r) { return (r && r.token) || null; })
        .catch(function (e) { log('[anonPush] FirebaseMessaging.getToken failed', e); return null; });
    }
    // @capacitor/push-notifications hands the token to a listener rather than
    // returning it, so register() and the listener are raced against a timeout.
    var pn = plugin('PushNotifications');
    if (!pn) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (t) { if (!done) { done = true; resolve(t); } };
      pn.addListener('registration', function (t) { finish((t && t.value) || null); });
      pn.addListener('registrationError', function (e) {
        log('[anonPush] registrationError', e);
        finish(null);
      });
      pn.register().catch(function (e) { log('[anonPush] register failed', e); finish(null); });
      setTimeout(function () { finish(null); }, 8000);
    });
  }

  // Load firebase-messaging-compat on demand. Web push is a minority path and
  // the page already blocks on four SDK scripts — this one only costs the
  // members who turn notifications on.
  function loadMessagingSdk() {
    if (window.firebase && window.firebase.messaging) return Promise.resolve(true);
    if (!window.firebase) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var el = document.createElement('script');
      el.src = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-messaging-compat.js';
      el.onload  = function () { resolve(!!(window.firebase && window.firebase.messaging)); };
      el.onerror = function () { resolve(false); };
      document.head.appendChild(el);
    });
  }

  function webToken() {
    return loadMessagingSdk().then(function (ok) {
      if (!ok) return null;
      // Its own scope, never '/': service-worker.js (the offline cache) owns
      // '/', and one scope holds one worker — registering this one there
      // would evict the cache worker, and the next journal visit would evict
      // this one back, silently dropping every push. Push events reach a
      // registration whatever its scope; this is the scope Firebase itself
      // uses when it registers its own worker.
      return navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/firebase-cloud-messaging-push-scope',
      })
        .then(function (reg) {
          var messaging = firebase.messaging();
          if (_onMessage && !messaging._bbOnMessageWired) {
            messaging._bbOnMessageWired = true;
            messaging.onMessage(function (payload) { _onMessage(payload); });
          }
          return messaging.getToken({
            vapidKey: window.BB_PUSH_VAPID_KEY,
            serviceWorkerRegistration: reg,
          });
        })
        .catch(function (e) { log('[anonPush] web getToken failed', e); return null; });
    });
  }

  function fetchToken() {
    return (isNative() ? nativeToken() : webToken()).then(function (token) {
      if (token) set(TOKEN_KEY, token);
      return token;
    });
  }

  // Foreground pushes land in-app rather than in the notification tray, so the
  // page shows them itself (a hint toast — see configure()).
  function wireNativeListeners() {
    if (_wired || !isNative()) return;
    var fm = plugin('FirebaseMessaging');
    if (fm) {
      _wired = true;
      fm.addListener('notificationReceived', function (e) {
        if (_onMessage) _onMessage(e && e.notification ? { notification: e.notification } : e);
      });
      return;
    }
    var pn = plugin('PushNotifications');
    if (pn) {
      _wired = true;
      pn.addListener('pushNotificationReceived', function (n) {
        if (_onMessage) _onMessage({ notification: n });
      });
    }
  }

  // ── The token document ──────────────────────────────────────────────────

  function tokenDoc(token, prefs) {
    var who  = _identity() || {};
    var brand = window.BB_BRAND || {};
    return {
      token:       token,
      prefs:       {
        replies:       !!prefs.replies,
        announcements: !!prefs.announcements,
        posts:         !!prefs.posts,
        weekly:        !!prefs.weekly,
      },
      // Replies are addressed by monika: a post carries a name, not an account.
      monikaLower: (who.monika || '').toLowerCase() || null,
      emailHash:   who.emailHash || null,
      platform:    isNative() ? (isIOS() ? 'ios' : 'android') : 'web',
      bundle:      brand.bundle || 'main',
      lang:        (window.BB && window.BB.i18n && window.BB.i18n.getLang()) || 'en',
      updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
    };
  }

  function writeToken(token, prefs) {
    if (!_db || !token) return Promise.resolve(false);
    return Promise.resolve()
      .then(function () { return _ensureAuth(); })
      .catch(function () {})   // no session → the write below reports the refusal
      .then(function () {
        return _db.collection(COLLECTION).doc(token).set(tokenDoc(token, prefs), { merge: true });
      })
      .then(function () { return true; })
      .catch(function (e) { log('[anonPush] token write failed', e); return false; });
  }

  function deleteToken(token) {
    if (!_db || !token) return Promise.resolve();
    return _db.collection(COLLECTION).doc(token).delete().catch(function () {});
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Turn notifications on: ask the OS, get a token, store the preferences.
   * @param {{replies:boolean, announcements:boolean, posts:boolean, weekly:boolean}} prefs
   * @returns {Promise<{ok:boolean, reason?:string}>} reason: 'unsupported' | 'denied' | 'no-token'
   */
  function enable(prefs) {
    prefs = prefs || DEFAULT_PREFS;
    // Nothing to deliver with (no plugin installed, no VAPID key): don't
    // store a preference the app can't honour — the settings sheet would
    // then show a switch that is on while nothing is ever sent. Nor count it
    // as having asked: no permission prompt was ever shown, and the
    // first-post sheet must still appear once push works on this device.
    if (!isSupported()) return Promise.resolve({ ok: false, reason: 'unsupported' });
    markAsked();
    return requestPermission().then(function (state) {
      if (state !== 'granted') return { ok: false, reason: 'denied' };
      wireNativeListeners();
      return fetchToken().then(function (token) {
        if (!token) return { ok: false, reason: 'no-token' };
        // The server only sends to what it can see. If the registration was
        // refused (rules not published, offline), don't show switches as on.
        return writeToken(token, prefs).then(function (ok) {
          if (!ok) {
            // Not registered server-side, so not ours to remember either —
            // otherwise the next settings change would take the "already
            // registered" path and update a document that doesn't exist.
            remove(TOKEN_KEY);
            return { ok: false, reason: 'no-token' };
          }
          writePrefsLocally(prefs);
          return { ok: true };
        });
      });
    });
  }

  /**
   * Persist a preference change made from the settings sheet. Turning the
   * last one off deletes the token document — the server then has nothing to
   * send to, which is the honest meaning of "off".
   * @param {{replies:boolean, announcements:boolean, posts:boolean, weekly:boolean}} prefs
   * @returns {Promise<{ok:boolean, reason?:string}>}
   */
  function savePrefs(prefs) {
    var before = getPrefs();
    writePrefsLocally(prefs);
    var token = get(TOKEN_KEY);
    if (!anyOn(prefs)) {
      remove(TOKEN_KEY);
      return deleteToken(token).then(function () { return { ok: true }; });
    }
    if (token) {
      // Refused: the server still holds the old preferences, so show those.
      return writeToken(token, prefs).then(function (ok) {
        if (!ok) writePrefsLocally(before);
        return { ok: ok };
      });
    }
    // First row switched on from settings. Nothing was registered before, so a
    // refusal puts every switch back off rather than leaving one claiming on.
    return enable(prefs).then(function (res) {
      if (!res.ok) writePrefsLocally(allOff());
      return res;
    });
  }

  /**
   * Keep an existing registration current: tokens rotate, monikas change, and
   * a member can revoke permission in the OS between visits. Safe to call on
   * every board init — it no-ops unless something is actually subscribed.
   * @returns {Promise<void>}
   */
  function refresh() {
    var prefs = getPrefs();
    if (!anyOn(prefs) || !isSupported()) return Promise.resolve();
    return permissionState().then(function (state) {
      if (state !== 'granted') {
        // Revoked in Settings — stop claiming they're subscribed, and stop the
        // server sending into the void.
        writePrefsLocally(allOff());
        var stale = get(TOKEN_KEY);
        remove(TOKEN_KEY);
        return deleteToken(stale);
      }
      wireNativeListeners();
      return fetchToken().then(function (token) {
        if (token) return writeToken(token, prefs);
      });
    });
  }

  /**
   * Drop this device's registration entirely — sign-out and account deletion.
   * The token document is what the server sends to, so deleting it is what
   * actually stops the notifications; the local keys go with it.
   * @returns {Promise<void>}
   */
  function unregister() {
    var token = get(TOKEN_KEY);
    remove(TOKEN_KEY);
    remove(ASKED_KEY);
    remove(POSTS_ASKED_KEY);
    writePrefsLocally(allOff());
    return deleteToken(token);
  }

  /**
   * Wire the module to the page.
   * @param {object} opts
   * @param {object} opts.db          Firestore handle (compat SDK)
   * @param {function} opts.identity  () => ({ monika, emailHash })
   * @param {function} [opts.onMessage] called with a push received in the foreground
   */
  function configure(opts) {
    opts = opts || {};
    if (opts.db)        _db = opts.db;
    if (opts.identity)  _identity = opts.identity;
    if (opts.onMessage) _onMessage = opts.onMessage;
    if (opts.ensureAuth) _ensureAuth = opts.ensureAuth;
  }

  window.BB = window.BB || {};
  window.BB.anonPush = {
    configure:       configure,
    isSupported:     isSupported,
    permissionState: permissionState,
    getPrefs:        getPrefs,
    defaultPrefs:    function () { return Object.assign({}, DEFAULT_PREFS); },
    anyOn:           function (p) { return anyOn(p || getPrefs()); },
    hasBeenAsked:    hasBeenAsked,
    hasBeenAskedAboutPosts: hasBeenAskedAboutPosts,
    markAsked:       markAsked,
    enable:          enable,
    unregister:      unregister,
    savePrefs:       savePrefs,
    refresh:         refresh,
  };
})();
