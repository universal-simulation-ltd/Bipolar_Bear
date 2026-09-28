/**
 * Global community-size counters.
 *
 * Two Firestore counter documents, both living in the existing `counters/`
 * collection alongside `helpedCount` / `appCosts`:
 *
 *   counters/userCount      — Bipolar Bear accounts (main app)
 *   counters/anonUserCount  — Bipolar Anonymous members (board)
 *
 * Counting is client-side and idempotent per account, not a live `count()`
 * aggregate: `userSettings/{uid}` and `anonProfiles/{hash}` are only readable
 * by their own owner, so nobody can count them from the client. Instead each
 * account writes a one-time "I've been counted" flag into its OWN profile
 * document inside the same transaction that bumps the counter — so an account
 * can be counted exactly once, however many devices it signs in from, and
 * accounts that existed before this shipped are picked up the first time they
 * open the app (no backfill migration needed).
 *
 * A localStorage mirror of the flag short-circuits the transaction entirely on
 * every subsequent load, so the steady-state cost is one document read for the
 * display and nothing else.
 *
 * Displayed values are cached in localStorage so a returning user sees the
 * last known number immediately instead of a gap while Firestore resolves.
 *
 * Below all of that, `userCount.suite` is a second, independent counter: the
 * UNI·SIM suite-wide figure both apps joined on 2026-09-17, over Supabase
 * rather than Firestore. It is what puts these users into "a total of X users
 * across all UNI·SIM apps", and what each app's count line offers on a tap.
 * The two never mix — see the comment above `userCount.suite`.
 *
 * @file js/shared/user-count.js
 */
(function () {
  window.BB = window.BB || {};

  /** Firestore doc id in `counters/` per counter kind. */
  var DOC_ID = { app: 'userCount', anon: 'anonUserCount' };
  /** localStorage key holding the last known value (via BB.storage prefix). */
  var CACHE_KEY = { app: 'UserCountCache', anon: 'AnonUserCountCache' };
  /** localStorage key mirroring "this account has already been counted". */
  var FLAG_KEY = { app: 'UserCounted', anon: 'Anon_counted' };

  /**
   * Presence ("live right now") collections. One document per open session,
   * doc id = a random per-tab id, contents = a single `lastSeen` timestamp.
   * Deliberately carries NO uid, email or monika: a live count should never
   * become a record of who was reading a mental-health app and when.
   */
  var PRESENCE = { app: 'bbPresence', anon: 'bbAnonPresence' };
  /** A session counts as live for this long after its last heartbeat. */
  var LIVE_WINDOW_MS = 120000;   // 2 min
  /** How often an open, visible page re-beats and re-counts. */
  var BEAT_MS = 45000;           // 45 s
  /** Presence docs older than this are swept opportunistically. */
  var STALE_MS = 1800000;        // 30 min
  /** Safety cap on a live-count query that can't use the count() aggregate. */
  var LIVE_CAP = 500;

  /** BB.log / BB.warn if debug.js loaded, plain console otherwise. */
  function _log(msg, extra) {
    var f = (window.BB && window.BB.log) || (window.console && console.log);
    if (f) extra === undefined ? f(msg) : f(msg, extra);
  }
  function _warn(msg, extra) {
    var f = (window.BB && window.BB.warn) || (window.console && console.warn);
    if (f) extra === undefined ? f(msg) : f(msg, extra);
  }

  /** True while the page is backgrounded — a hidden tab is not someone using
   *  the app, so neither counter beats. */
  function _hidden() {
    try { return document.visibilityState === 'hidden'; } catch (_) { return false; }
  }

  /**
   * Random per-tab session id for the presence document, kept in
   * sessionStorage so a reload reuses it (and a new tab gets its own).
   * @returns {string}
   */
  function _sessionId() {
    var KEY = 'bbPresenceId';
    try {
      var existing = sessionStorage.getItem(KEY);
      if (existing) return existing;
    } catch (_) { /* private mode — fall through to a per-load id */ }
    var id = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { sessionStorage.setItem(KEY, id); } catch (_) {}
    return id;
  }

  function _counterRef(db, kind) {
    return db.collection('counters').doc(DOC_ID[kind] || DOC_ID.app);
  }

  /** Read a possibly-nested field ('anonProfile.counted') off a plain object. */
  function _readPath(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /** Build `{a: {b: value}}` from 'a.b' — a merge-safe patch for one field. */
  function _patchPath(path, value) {
    var parts = path.split('.');
    var out = value;
    for (var i = parts.length - 1; i >= 0; i--) {
      var wrap = {};
      wrap[parts[i]] = out;
      out = wrap;
    }
    return out;
  }

  var userCount = {
    /**
     * Last known value for a counter, or null if we've never read one.
     * @param {'app'|'anon'} kind
     * @returns {number|null}
     */
    cached: function (kind) {
      var raw = parseInt(window.BB.storage.get(CACHE_KEY[kind]) || '', 10);
      return isNaN(raw) || raw < 0 ? null : raw;
    },

    /**
     * Fetch the current counter value, refreshing the localStorage cache.
     * Never rejects — falls back to the cached value (or null) on any
     * network/permission error so a counter is never a broken page.
     * @param {object} db  Firestore instance
     * @param {'app'|'anon'} kind
     * @returns {Promise<number|null>}
     */
    load: function (db, kind) {
      var self = this;
      if (!db) return Promise.resolve(this.cached(kind));
      return _counterRef(db, kind).get()
        .then(function (snap) {
          var n = snap.exists ? snap.data().count : null;
          if (typeof n !== 'number' || !isFinite(n) || n < 0) {
            // Missing doc (nobody has been counted yet) or a junk value — the
            // caller hides its line rather than showing a zero.
            _log('[userCount] no value for ' + DOC_ID[kind] +
              (snap.exists ? ' (doc exists, count=' + JSON.stringify(n) + ')' : ' (doc does not exist yet)'));
            return self.cached(kind);
          }
          window.BB.storage.set(CACHE_KEY[kind], String(n));
          _log('[userCount] ' + DOC_ID[kind] + ' = ' + n);
          return n;
        })
        .catch(function (e) {
          // Never fatal, but never silent either — a permission-denied here is
          // the difference between "no users yet" and "rules block the read".
          _warn('[userCount] read of counters/' + DOC_ID[kind] + ' failed:', e && (e.code || e.message || e));
          return self.cached(kind);
        });
    },

    /**
     * Count this account exactly once, then never again.
     *
     * Runs a transaction over the account's own profile document: if the flag
     * at `flagPath` isn't set yet, set it and increment the counter in the
     * same atomic write (so two devices racing can't double-count). A
     * localStorage mirror means the transaction only ever runs once per
     * device anyway.
     *
     * @param {object} db        Firestore instance
     * @param {'app'|'anon'} kind
     * @param {object} profileRef  DocumentReference the account owns and can write
     * @param {string} flagPath    Field path for the flag, e.g. 'anonProfile.counted'
     * @returns {Promise<boolean>} true if this call was the one that counted them
     */
    countOnce: function (db, kind, profileRef, flagPath) {
      var self = this;
      if (!db || !profileRef) return Promise.resolve(false);
      if (window.BB.storage.get(FLAG_KEY[kind]) === '1') return Promise.resolve(false);
      var counterRef = _counterRef(db, kind);
      return db.runTransaction(function (tx) {
        return tx.get(profileRef).then(function (snap) {
          var data = snap.exists ? snap.data() : {};
          if (_readPath(data, flagPath) === true) return false;
          tx.set(profileRef, _patchPath(flagPath, true), { merge: true });
          tx.set(
            counterRef,
            { count: window.firebase.firestore.FieldValue.increment(1) },
            { merge: true }
          );
          return true;
        });
      }).then(function (counted) {
        window.BB.storage.set(FLAG_KEY[kind], '1');
        _log('[userCount] ' + DOC_ID[kind] + ': this account ' +
          (counted ? 'counted (+1)' : 'was already counted'));
        if (counted) {
          var c = self.cached(kind);
          if (c !== null) window.BB.storage.set(CACHE_KEY[kind], String(c + 1));
        }
        return counted;
      }).catch(function (e) {
        _warn('[userCount] counting this account into counters/' + DOC_ID[kind] + ' failed:',
          e && (e.code || e.message || e));
        return false;
      });
    },

    /**
     * Give the count back when an account is deleted. No-op unless this device
     * knows the account was counted (the profile document holding the flag is
     * being destroyed by the same delete flow, so the local mirror is the only
     * thing left to check).
     * @param {object} db  Firestore instance
     * @param {'app'|'anon'} kind
     * @returns {Promise<boolean>} true if a decrement was sent
     */
    uncount: function (db, kind) {
      var self = this;
      if (window.BB.storage.get(FLAG_KEY[kind]) !== '1') return Promise.resolve(false);
      window.BB.storage.remove(FLAG_KEY[kind]);
      if (!db) return Promise.resolve(false);
      return _counterRef(db, kind)
        .set(
          { count: window.firebase.firestore.FieldValue.increment(-1) },
          { merge: true }
        )
        .then(function () {
          var c = self.cached(kind);
          if (c !== null) window.BB.storage.set(CACHE_KEY[kind], String(Math.max(0, c - 1)));
          return true;
        })
        .catch(function (e) {
          _warn('[userCount] decrement of counters/' + DOC_ID[kind] + ' failed:', e && (e.code || e.message || e));
          return false;
        });
    },

    /**
     * Start reporting this session as live, and report back how many sessions
     * are live, roughly every 45 seconds.
     *
     * Each open page owns one presence document (random id, held in
     * sessionStorage so a reload keeps the same one) carrying nothing but a
     * `lastSeen` timestamp. "Live" is then simply "beat within the last two
     * minutes", so a closed tab drops out on its own even if its delete never
     * lands. Heartbeats pause while the tab is hidden — a backgrounded tab
     * isn't someone using the app.
     *
     * Everything here is best-effort: if the writes or the query are refused,
     * it warns once per failure and the caller simply never gets a live number.
     *
     * @param {object} db  Firestore instance
     * @param {'app'|'anon'} kind
     * @param {function(number)} [onCount]  called with the live session count.
     *   Omit it on pages that don't display a figure (journal, survival kit):
     *   they then only heartbeat, skipping the count query and the sweep, so
     *   being present costs one write per 45s and nothing else.
     * @returns {function()} stop function (clears the timer, drops the doc)
     */
    startPresence: function (db, kind, onCount) {
      var noop = function () {};
      if (!db || !window.firebase || !window.firebase.firestore) return noop;

      var coll = db.collection(PRESENCE[kind] || PRESENCE.app);
      var ref  = coll.doc(_sessionId());
      var timer = null;
      var stopped = false;
      var sweeps = 0;

      function beat() {
        return ref.set(
          { lastSeen: window.firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        ).catch(function (e) {
          _warn('[userCount] presence beat on ' + (PRESENCE[kind] || PRESENCE.app) + ' failed:',
            e && (e.code || e.message || e));
        });
      }

      function count() {
        var cutoff = window.firebase.firestore.Timestamp.fromMillis(Date.now() - LIVE_WINDOW_MS);
        var q = coll.where('lastSeen', '>', cutoff);
        // Prefer the count() aggregate (one read regardless of how many are
        // live); fall back to a capped document read on SDKs without it.
        var p = (typeof q.count === 'function')
          ? q.count().get().then(function (agg) { return agg.data().count; })
          : q.limit(LIVE_CAP).get().then(function (snap) { return snap.size; });
        return p.then(function (n) {
          _log('[userCount] ' + (PRESENCE[kind] || PRESENCE.app) + ': ' + n + ' live');
          if (!stopped && typeof onCount === 'function') onCount(n);
          return n;
        }).catch(function (e) {
          _warn('[userCount] live count on ' + (PRESENCE[kind] || PRESENCE.app) + ' failed:',
            e && (e.code || e.message || e));
        });
      }

      // Sweep abandoned documents now and then so the collection doesn't grow
      // without bound. Every 10th tick, a handful at a time, failures ignored —
      // it's tidying, not correctness (the lastSeen window already excludes them).
      function sweep() {
        if (sweeps++ % 10 !== 0) return;
        var old = window.firebase.firestore.Timestamp.fromMillis(Date.now() - STALE_MS);
        coll.where('lastSeen', '<', old).limit(10).get()
          .then(function (snap) { snap.forEach(function (d) { d.ref.delete().catch(function () {}); }); })
          .catch(function () {});
      }

      function tick() {
        if (stopped || _hidden()) return;
        var beating = beat();
        // Pages that don't show a figure only report themselves — no count
        // query, no sweep. Every open page adding reads would make the live
        // number cost more the more people are using the app.
        if (typeof onCount === 'function') beating.then(count).then(sweep);
      }

      tick();
      timer = setInterval(tick, BEAT_MS);
      // Coming back to a backgrounded tab should refresh immediately rather
      // than waiting out the rest of the interval.
      try {
        document.addEventListener('visibilitychange', function () { if (!_hidden()) tick(); });
      } catch (_) {}
      // Best-effort tidy-up; the 2-minute window covers us when it doesn't land.
      try {
        window.addEventListener('pagehide', function () { ref.delete().catch(function () {}); });
      } catch (_) {}

      return function stop() {
        stopped = true;
        if (timer) clearInterval(timer);
        ref.delete().catch(function () {});
      };
    },

    /**
     * Format a count for display. Fixed en-US grouping so the number reads the
     * same on every device locale — matches fmtCount() on the survival kit's
     * people-helped counter.
     * @param {number} n
     * @returns {string}
     */
    format: function (n) { return Number(n).toLocaleString('en-US'); },
  };


  // ── The UNI·SIM suite-wide counter ──────────────────────────────────────────
  //
  // Bipolar Bear and Bipolar Anonymous joined the Universal Simulation suite on
  // 2026-09-17, and with it the count every other suite app shows. Two calls,
  // both against Supabase's REST endpoint, both deliberately separate from the
  // Firestore counters above:
  //
  //   * a BEAT — app_presence_beat {p_product, p_install_id, p_platform}, on
  //     load and every 45 s while the page is visible (migration 0175; the
  //     platform since 0187), which is what puts this app's users INTO the
  //     suite figure, and into its web or native column;
  //   * a READ — suite_user_counts {} → {total, live} (migration 0177), for
  //     when somebody taps the line to see that figure.
  //
  // The Firestore counters are untouched and stay what each app says about
  // ITSELF: they count accounts rather than installs, so they are the better
  // number, and they have the app's whole history behind them. The suite figure
  // is the second face of the same line, one tap away, and `scope()` remembers
  // which face somebody last chose.
  //
  // What is sent: a product name, a random install id, nothing else. No uid, no
  // email, no monika, no journal, nothing about what was read or written. An
  // account here is a FIREBASE account, unknown to Supabase, so every beat goes
  // up anonymous — the suite sees a device, never a person, and cannot join one
  // to the next. See migration 0179's header.
  //
  // The key below is a PUBLISHABLE anon key; it ships in every suite web bundle
  // by design. `app_presence` has RLS on with no policies at all, so this key
  // reaches that table through these two functions and in no other way.
  //
  // All of it is best-effort. Offline, blocked, or refused, every call fails
  // quietly and the line simply never offers the suite figure.

  var SUITE_URL = 'https://rygfxgalojojppxmhddo.supabase.co';
  var SUITE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5Z2Z4Z2Fsb2pvanBweG1oZGRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NTY4MjUsImV4cCI6MjA5NDMzMjgyNX0.hLy_vt9vY_rdPKF3nL32yAuMCD604E3CH5VM7D7CaNE';
  /** `product_code` enum value per counter kind (migration 0179). */
  var SUITE_PRODUCT = { app: 'bipolar_bear', anon: 'bipolar_anonymous' };
  /** Raw localStorage keys, spelled exactly as @unisim/sdk spells them. */
  var INSTALL_ID_KEY = 'unisim:install-id';
  var SCOPE_KEY = 'unisim:user-count-scope';
  /** Last known suite TOTAL (via BB.storage). Never the live figure: a stale
   *  "live" is a lie, where a stale total is merely a little behind. */
  var SUITE_CACHE_KEY = 'SuiteUserCountCache';

  /**
   * A v4 UUID. `crypto.randomUUID` is missing on the older WebViews this app
   * still runs in (iOS < 15.4, Chrome < 92), so fall back to random bytes, and
   * to Math.random on the oldest of all — an install id only has to be unique,
   * not unguessable.
   * @returns {string}
   */
  function _uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
    var bytes = new Uint8Array(16);
    try { crypto.getRandomValues(bytes); }
    catch (_) { for (var i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256); }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;   // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80;   // variant 10x
    var hex = '';
    for (var j = 0; j < 16; j++) hex += (bytes[j] + 0x100).toString(16).slice(1);
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
           hex.slice(16, 20) + '-' + hex.slice(20);
  }

  /**
   * This device's suite install id, minted once and kept forever.
   *
   * Deliberately raw localStorage rather than BB.storage: the key is the
   * suite's, not this app's, and it is the same key the React apps and
   * Universal Screens use. Blocked storage (private mode) falls back to a
   * per-load id, which counts the session and is forgotten — the same trade the
   * SDK makes.
   * @returns {string}
   */
  function _installId() {
    try {
      var existing = localStorage.getItem(INSTALL_ID_KEY);
      if (existing) return existing;
      var id = _uuid();
      localStorage.setItem(INSTALL_ID_KEY, id);
      return id;
    } catch (_) {
      return _uuid();
    }
  }

  /**
   * Which column of the suite's web / native split this device belongs in
   * (migration 0187). 'ios' / 'android' inside the Capacitor shells, 'web' on
   * bipolarbear.app. Without it every row landed in neither column, so the
   * suite's native figure was missing this app's users entirely.
   * @returns {'ios'|'android'|'web'}
   */
  function _platform() {
    try {
      var c = window.Capacitor;
      if (c && c.isNativePlatform && c.isNativePlatform()) {
        var p = c.getPlatform && c.getPlatform();
        if (p === 'ios' || p === 'android') return p;
      }
    } catch (_) {}
    return 'web';
  }

  /**
   * POST to a Supabase RPC as the anon role. Rejects on anything but a 2xx.
   * @param {string} fn    function name
   * @param {object} body  arguments
   * @returns {Promise<*>}
   */
  function _suiteRpc(fn, body) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('no fetch'));
    return fetch(SUITE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'apikey': SUITE_KEY,
        'Authorization': 'Bearer ' + SUITE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      if (!res.ok) throw new Error(fn + ': ' + res.status);
      return res.text();
    }).then(function (text) {
      return text ? JSON.parse(text) : null;
    });
  }

  userCount.suite = {
    /**
     * Which figure the line is currently showing: this app's own, or the whole
     * suite's. 'app' unless somebody has tapped through — each app's own number
     * is the one it has always shown, and stays what a first-time visitor sees.
     * @returns {'app'|'suite'}
     */
    scope: function () {
      try { return localStorage.getItem(SCOPE_KEY) === 'suite' ? 'suite' : 'app'; }
      catch (_) { return 'app'; }
    },

    /**
     * Remember which figure to show. Same key the rest of the suite uses, so a
     * browser that has both keeps one answer.
     * @param {'app'|'suite'} s
     * @returns {'app'|'suite'} what was stored
     */
    setScope: function (s) {
      var v = s === 'suite' ? 'suite' : 'app';
      try { localStorage.setItem(SCOPE_KEY, v); } catch (_) {}
      return v;
    },

    /** Flip between the two figures. @returns {'app'|'suite'} the new scope */
    toggleScope: function () {
      return this.setScope(this.scope() === 'suite' ? 'app' : 'suite');
    },

    /**
     * Last known suite total, so a tap paints instantly instead of gapping
     * while the read resolves. No live figure — see SUITE_CACHE_KEY.
     * @returns {number|null}
     */
    cached: function () {
      var raw = parseInt(window.BB.storage.get(SUITE_CACHE_KEY) || '', 10);
      return isNaN(raw) || raw <= 0 ? null : raw;
    },

    /**
     * Read the suite figure. Never rejects: any failure (offline, blocked,
     * refused) resolves null and the caller keeps showing whatever it had.
     * @returns {Promise<{total: number, live: number}|null>}
     */
    load: function () {
      return _suiteRpc('suite_user_counts', {}).then(function (rows) {
        var row = (rows && rows.length !== undefined) ? rows[0] : rows;
        var total = row ? Number(row.total) : NaN;
        var live = row ? Number(row.live) : NaN;
        if (!isFinite(total) || total <= 0) {
          _log('[userCount] suite: no usable figure yet');
          return null;
        }
        if (!isFinite(live) || live < 0) live = 0;
        window.BB.storage.set(SUITE_CACHE_KEY, String(total));
        _log('[userCount] suite: ' + total + ' total, ' + live + ' live');
        return { total: total, live: live };
      }).catch(function (e) {
        _warn('[userCount] suite_user_counts failed:', e && (e.message || e));
        return null;
      });
    },

    /**
     * Join the suite counter, and keep the caller supplied with the suite
     * figure for as long as its line is showing one.
     *
     * Mirrors startPresence() above — beat now, then every 45 s while the page
     * is visible, and again the moment a backgrounded tab comes back — but
     * against Supabase rather than Firestore, and with no dependency on
     * Firebase having initialised, so it runs on a page whose Firestore
     * counter never resolves.
     *
     * After one read on the first tick, the READ is skipped unless `wantsSuite()`
     * says the line is showing the suite figure — so a page nobody taps costs
     * one small POST per 45 s and nothing else.
     *
     * @param {'app'|'anon'} kind
     * @param {function(): boolean} wantsSuite  is the line showing the suite figure?
     * @param {function({total: number, live: number})} onCounts  called with a fresh figure
     * @returns {function()} stop function (clears the timer; the row ages out on its own)
     */
    start: function (kind, wantsSuite, onCounts) {
      var self = this;
      var product = SUITE_PRODUCT[kind] || SUITE_PRODUCT.app;
      var id = _installId();
      var timer = null;
      var stopped = false;
      var beaten = false;
      var first = true;

      function beat() {
        return _suiteRpc('app_presence_beat', { p_product: product, p_install_id: id, p_platform: _platform() })
          .then(function () { beaten = true; })
          .catch(function (e) {
            _warn('[userCount] suite beat for ' + product + ' failed:', e && (e.message || e));
          });
      }

      function read() {
        if (stopped || typeof onCounts !== 'function') return;
        // Read once on the first tick whatever the scope — that one read is what
        // lets the suite figure stand in when this app's own is missing (offline,
        // or Firestore refused), which a first-time visitor has no cache for.
        // After that, only while the line is actually showing it.
        if (first) first = false;
        else if (typeof wantsSuite === 'function' && !wantsSuite()) return;
        return self.load().then(function (counts) {
          if (stopped || !counts) return;
          // Whoever is reading this is using a suite app right now; a read that
          // raced its own beat must not answer "(0 live)".
          if (beaten && counts.live < 1) counts.live = 1;
          onCounts(counts);
        });
      }

      function tick() {
        if (stopped || _hidden()) return;
        beat().then(read);
      }

      tick();
      timer = setInterval(tick, BEAT_MS);
      try {
        document.addEventListener('visibilitychange', function () { if (!_hidden()) tick(); });
      } catch (_) {}

      return function stop() {
        stopped = true;
        if (timer) clearInterval(timer);
      };
    },

    /**
     * Make a count line switch between this app's figure and the suite's when
     * it is tapped, clicked or given Enter/Space.
     *
     * Safe to call on every repaint: the hint is re-applied each time so it
     * follows a language change, and the listeners are attached once (a data
     * attribute on the element, so it holds across both pages' repaints).
     *
     * ⚠ No aria-label. With `role="button"` the accessible name comes from the
     * element's text, and an aria-label would read the hint out INSTEAD OF THE
     * NUMBER — exactly what somebody came to the line for. The hint is a
     * `title`, which assistive tech offers as a description alongside it.
     *
     * @param {HTMLElement} el         the line
     * @param {string} hint            localised "tap to switch" text
     * @param {function()} onToggle    called once the scope has flipped
     * @returns {void}
     */
    wireTap: function (el, hint, onToggle) {
      if (!el) return;
      if (hint) el.title = hint;
      if (el.getAttribute('data-suite-tap') === '1') return;
      el.setAttribute('data-suite-tap', '1');
      el.style.cursor = 'pointer';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      var fire = function () {
        userCount.suite.toggleScope();
        if (typeof onToggle === 'function') onToggle();
      };
      el.addEventListener('click', fire);
      el.addEventListener('keydown', function (e) {
        var k = e.key;
        if (k === 'Enter' || k === ' ' || k === 'Spacebar') { e.preventDefault(); fire(); }
      });
    },

    /** Read the suite figure once, on demand — for a tap that wants it now. */
    refresh: function (onCounts) {
      return this.load().then(function (counts) {
        if (counts && typeof onCounts === 'function') onCounts(counts);
        return counts;
      });
    },
  };

  window.BB.userCount = userCount;
})();
