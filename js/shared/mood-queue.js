/**
 * @file js/shared/mood-queue.js — BB.moodQueue: moods tapped on the daily
 * reminder, filed into the journal on the app's next open (1.44, DOCS §2.23).
 *
 * The daily reminder (journal.js scheduleReminder, notification id 1) carries
 * the five moods as buttons. Tapping one does NOT open the app, so the page,
 * and with it the journal's key, isn't there. The native side only queues the
 * tap, next to the widget data:
 *
 *   iOS      UserDefaults(suiteName: "group.app.bipolarbear")["moodQueue"]
 *            (MoodReminder.swift: a notification-centre delegate in front of
 *            Capacitor's, so a tap is caught even with the app not running)
 *   Android  SharedPreferences "bipolarbear_widget" → "moodQueue"
 *            (MoodActionReceiver.java; the five bears are drawn by
 *            MoodReminderNotification.java, because Android shows at most
 *            three plain buttons)
 *
 * Each queued tap is { id, mood, at, day }: a unique id, the mood category,
 * the tap time (ms) and the day it is about (yesterday, or today when the
 * journal logs today; the same rule as the widget). Mood category only, never
 * anything else, and it is never shown anywhere (so the PIN / incognito rule
 * that hides the home strip and widget dots doesn't need to apply to it).
 *
 * The app reads it through Capacitor.Plugins.BipolarBearMoodQueue
 * (pending() → { taps }, remove({ ids })). This module:
 *   • plan(taps, opts)   decides, without side effects (scripts/test-mood-queue.mjs):
 *       – one entry per day; the latest tap for a day wins;
 *       – a day that already has an entry is NEVER overwritten: its taps are
 *         dropped, the same rule as the widget's ?mood= link
 *         (journal.js _fmDeepLinkResolve: a day already logged drops the link)
 *         and the missing-days auto-complete (only empty days are filled);
 *       – a tap with no valid mood or day, or a day still in the future, is dropped.
 *   • file(adapter)      is run by the journal after every load. The adapter
 *       is the journal's own: it says whether an encrypted save is possible
 *       right now (signed in with the key in hand and every entry opened, or
 *       a guest whose storage is ready), lists the days already logged
 *       (from the server, not a cache) and saves one entry the way saveEntry
 *       does. A tap leaves the queue only after its entry has been saved
 *       (or it has been dropped by the rules above). Nothing is held in
 *       plaintext by this module and nothing goes to Firestore without the key.
 *   • openJournalIfPending()  is run by the home page: with taps waiting and
 *       no PIN screen up, it opens the journal once per session so they get
 *       filed on this open, not whenever the journal is next visited.
 *   • actionTypes()      the reminder's buttons, for LocalNotifications.registerActionTypes.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var BB = root.BB = root.BB || {};

  var MOODS = ['manic', 'elevated', 'stable', 'low', 'depressed'];
  // The journal's spectrum value for each category (journal.js _FM_SPECTRUM_FOR_CAT),
  // used when "Full spectrum" mood is on, as the widget's ?mood= link does.
  var SPECTRUM = { depressed: 1, low: 3, stable: 5, elevated: 7, manic: 9 };
  var EMOJI = { manic: '🚀', elevated: '✨', stable: '😊', low: '😔', depressed: '🌧️' };
  // The reminder's notification category (actionTypeId) and its button ids.
  // Native code matches these exactly: "bg." = handled without opening the app.
  var ACTION_TYPE = 'bb.mood';
  var ACTION_PREFIX = 'bg.mood.';
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var SESSION_FLAG = 'bbMoodQueueOpened';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /** yyyy-MM-dd in local time, the journal's day key. */
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  /** A day key → noon that day (local), or null when it isn't a real date. */
  function parseDay(key) {
    if (typeof key !== 'string' || !DAY_RE.test(key)) return null;
    var p = key.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2], 12, 0, 0, 0);
    return dayKey(d) === key ? d : null;
  }
  function shiftDay(key, n) {
    var d = parseDay(key);
    if (!d) return null;
    d.setDate(d.getDate() + n);
    return dayKey(d);
  }

  /** The day a tap is about: the native side's `day`, else from its time. */
  function tapDay(tap, loggingToday) {
    if (tap && parseDay(tap.day)) return tap.day;
    var at = Number(tap && tap.at);
    if (!isFinite(at) || at <= 0) return null;
    var k = dayKey(new Date(at));
    return loggingToday ? k : shiftDay(k, -1);
  }

  /**
   * What to do with the queued taps. Pure.
   *   opts.logged        Set or array of day keys that already have an entry
   *   opts.loggingToday  the journal logs today (only for taps without a `day`)
   *   opts.now           Date (tests)
   * → { file: [{ day, mood, at, ids }], drop: [{ day, mood, ids, reason }] }
   *   reason: 'logged' (the day has an entry) | 'invalid'
   */
  function plan(taps, opts) {
    opts = opts || {};
    var logged = opts.logged instanceof Set ? opts.logged : new Set(opts.logged || []);
    var today = dayKey(opts.now || new Date());
    var byDay = {};
    var drop = [];
    (Array.isArray(taps) ? taps : []).forEach(function (t) {
      // Without an id it could never be removed: leave it to the native side.
      if (!t || typeof t.id !== 'string' || !t.id) return;
      var mood = String(t.mood || '').toLowerCase();
      var day = tapDay(t, !!opts.loggingToday);
      if (MOODS.indexOf(mood) < 0 || !day || day > today) {
        drop.push({ day: day, mood: mood, ids: [t.id], reason: 'invalid' });
        return;
      }
      var at = Number(t.at) || 0;
      var g = byDay[day];
      if (!g) g = byDay[day] = { day: day, mood: mood, at: at, ids: [] };
      g.ids.push(t.id);
      if (at >= g.at) { g.at = at; g.mood = mood; }
    });
    var file = [];
    Object.keys(byDay).sort().forEach(function (day) {
      var g = byDay[day];
      if (logged.has(day)) drop.push({ day: day, mood: g.mood, ids: g.ids, reason: 'logged' });
      else file.push(g);
    });
    return { file: file, drop: drop };
  }

  /** A planned day → an entry shaped like saveEntry's, with only the mood. */
  function buildEntry(item, opts) {
    opts = opts || {};
    var date = parseDay(item.day);
    var at = item.at ? new Date(item.at) : new Date();
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
    return {
      date: date.toISOString(),
      mood: opts.spectrum ? SPECTRUM[item.mood] : item.mood,
      linkedMood: null,
      linkedMoods: [],
      energy: null,
      sleep: null,
      sleepQuality: null,
      medication: null,
      goals: null,
      alcohol: null,
      exercise: null,
      anxiety: null,
      irritability: null,
      stress: null,
      outside: null,
      smoking: null,
      drugs: null,
      notes: '',
      intention: '',
      customFields: {},
      budget: null,
      pdfHidden: false,
      favourite: false,
      timestamp: date.getTime(),
      recordedAt: at.toISOString(),
      recordedTz: tz,
      loggedVia: 'reminder'
    };
  }

  /** Day keys for a list of entries (their `date`) and/or plain timestamps. */
  function daysOf(entries, timestamps) {
    var out = new Set();
    (entries || []).forEach(function (e) {
      if (!e) return;
      var d = new Date(e.date != null ? e.date : e.timestamp);
      if (!isNaN(d)) out.add(dayKey(d));
    });
    (timestamps || []).forEach(function (ts) {
      var d = new Date(Number(ts));
      if (!isNaN(d)) out.add(dayKey(d));
    });
    return out;
  }

  // ── The native queue ──────────────────────────────────────────────────

  function plugin() {
    try {
      var C = root.Capacitor;
      if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
      var p = C.Plugins && C.Plugins.BipolarBearMoodQueue;
      return p && typeof p.pending === 'function' ? p : null;
    } catch (_) { return null; }
  }
  function within(ms, promise, fallback) {
    return Promise.race([promise, new Promise(function (res) { setTimeout(function () { res(fallback); }, ms); })]);
  }
  /** The queued taps, or [] (web, an older native build, or no answer in 3 s). */
  function pending() {
    var p = plugin();
    if (!p) return Promise.resolve([]);
    return within(3000, Promise.resolve().then(function () { return p.pending(); }).then(function (r) {
      return r && Array.isArray(r.taps) ? r.taps : [];
    }, function () { return []; }), []);
  }
  /** Removes these taps from the queue. Rejects if the native side says no. */
  function remove(ids) {
    var p = plugin();
    if (!p || !ids || !ids.length) return Promise.resolve();
    return Promise.resolve().then(function () { return p.remove({ ids: ids }); });
  }

  // ── Filing (the journal) ──────────────────────────────────────────────

  var _busy = false;
  var _again = false;

  /**
   * File the queue through the journal's adapter:
   *   ready()        → Promise<bool>  an encrypted save can happen now
   *   loggedDays()   → Promise<Set>   days that already have an entry (authoritative;
   *                                   throw when that can't be known, e.g. offline)
   *   persist(entry) → Promise        save one entry as saveEntry would
   *   loggingToday() → bool
   *   spectrum()     → bool
   *   done(result)   called with { filed, dropped } when anything changed
   * Resolves to { filed, dropped, held } (counts).
   */
  function file(adapter) {
    if (_busy) { _again = true; return Promise.resolve({ filed: 0, dropped: 0, held: 0, busy: true }); }
    _busy = true;
    var filed = [];
    var dropped = [];
    var held = 0;
    return pending().then(function (taps) {
      if (!taps.length) return;
      return Promise.resolve(adapter.ready()).then(function (ok) {
        if (!ok) { held = taps.length; return; }
        return Promise.resolve(adapter.loggedDays()).then(function (logged) {
          var p = plan(taps, { logged: logged, loggingToday: !!adapter.loggingToday() });
          var spectrum = !!(adapter.spectrum && adapter.spectrum());
          // One day at a time: each leaves the queue only once it is saved.
          var chain = Promise.resolve();
          p.file.forEach(function (item) {
            chain = chain.then(function () {
              return Promise.resolve(adapter.persist(buildEntry(item, { spectrum: spectrum }))).then(function () {
                filed.push(item);
                return remove(item.ids).catch(function () {});
              });
            });
          });
          return chain.then(function () {
            var ids = [];
            p.drop.forEach(function (d) { ids = ids.concat(d.ids); });
            dropped = p.drop.filter(function (d) { return d.reason === 'logged'; });
            return remove(ids).catch(function () {});
          });
        });
      });
    }).catch(function (e) {
      // Offline, or a save failed: what wasn't saved stays queued for next time.
      try { console.warn('Reminder moods not filed yet:', e); } catch (_) {}
    }).then(function () {
      _busy = false;
      if ((filed.length || dropped.length) && adapter.done) {
        try { adapter.done({ filed: filed, dropped: dropped }); } catch (_) {}
      }
      if (_again) { _again = false; setTimeout(function () { file(adapter); }, 0); }
      return { filed: filed.length, dropped: dropped.length, held: held };
    });
  }

  // ── The home page ─────────────────────────────────────────────────────

  /**
   * With taps waiting, open the journal so they are filed now. Once for each
   * tap per session (the ids are remembered), so a journal that can't file
   * them yet (a Private journal not unlocked, "Not now") doesn't bounce back
   * here again. Not while the PIN screen is up: the unlock calls this again.
   */
  function pinScreenUp() {
    var ov = root.document && root.document.getElementById('guestPinOverlay');
    return !!(ov && ov.style.display === 'flex');
  }
  function openJournalIfPending() {
    if (pinScreenUp()) return Promise.resolve(false);
    return pending().then(function (taps) {
      if (!taps.length || pinScreenUp()) return false;
      var seen = [];
      try { seen = JSON.parse(root.sessionStorage.getItem(SESSION_FLAG) || '[]') || []; } catch (_) {}
      var fresh = taps.filter(function (t) { return t && t.id && seen.indexOf(t.id) < 0; });
      if (!fresh.length) return false;
      try {
        root.sessionStorage.setItem(SESSION_FLAG, JSON.stringify(seen.concat(fresh.map(function (t) { return t.id; }))));
      } catch (_) { return false; }
      root.location.replace('journal.html');
      return true;
    });
  }

  // ── The reminder's buttons ────────────────────────────────────────────

  function t(key, fallback) {
    var s = BB.t ? BB.t(key) : '';
    return s && s !== key ? s : fallback;
  }
  var EN_MOOD = { manic: 'Manic', elevated: 'Elevated', stable: 'Stable', low: 'Low', depressed: 'Depressed' };
  /** The payload for LocalNotifications.registerActionTypes, in the app's language. */
  function actionTypes() {
    return {
      types: [{
        id: ACTION_TYPE,
        actions: MOODS.map(function (m) {
          // iOS: the phone must be unlocked to log a mood from the lock
          // screen (UNNotificationActionOptions.authenticationRequired).
          return { id: ACTION_PREFIX + m, title: EMOJI[m] + ' ' + t('mood.' + m, EN_MOOD[m]), requiresAuthentication: true };
        })
      }]
    };
  }

  // ── A short note after filing ─────────────────────────────────────────

  function toast(msg) {
    try {
      var doc = root.document;
      var el = doc.createElement('div');
      el.className = 'bb-mq-toast';
      el.setAttribute('role', 'status');
      el.textContent = msg;
      el.style.cssText = 'position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:10001;background:rgba(33,37,41,.94);color:#fff;padding:12px 16px;border-radius:12px;font-size:.88em;font-weight:600;line-height:1.4;white-space:pre-line;max-width:88vw;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.25);';
      doc.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 6000);
    } catch (_) {}
  }

  BB.moodQueue = {
    MOODS: MOODS,
    ACTION_TYPE: ACTION_TYPE,
    ACTION_PREFIX: ACTION_PREFIX,
    dayKey: dayKey,
    tapDay: tapDay,
    plan: plan,
    buildEntry: buildEntry,
    daysOf: daysOf,
    pending: pending,
    remove: remove,
    file: file,
    openJournalIfPending: openJournalIfPending,
    actionTypes: actionTypes,
    toast: toast
  };
})();
