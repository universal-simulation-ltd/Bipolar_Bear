/**
 * Medicine reminders — BB.medsReminder (1.45: one reminder per medicine).
 *
 * Set in 💊 My medicines (js/journal-meds.js, the 🔔 Reminders card on the
 * Doses tab; the journal's medication step has a 🔔 pill that opens it). Each
 * medicine on the list can have its own reminder times, none by default.
 * The master switch "Remind me to take my medicines" (`bbMedsReminder`, the
 * key the single reminder used) turns them all on or off without losing the
 * times. At each time the phone shows "Time for your medication"; if the user
 * hasn't confirmed, it asks again every hour — up to MAX_FOLLOWUPS more times,
 * never past midnight — until they tap ✅ Taken (a button on the notification
 * itself, or the prompt the app shows when a reminder is tapped open).
 *
 * Medicines with the same time share one notification (a "slot"); ✅ Taken
 * covers that slot for today. The notification names no medicine unless
 * "Show the medicine names in reminders" is ticked (`bbMedsRemindNames`,
 * unticked by default): the text can be read on a locked phone.
 *
 * How it's scheduled (phone app). A repeating OS notification can't be
 * skipped for one day, and cancelling it cancels every day, so every reminder
 * is a one-off, planned DAYS_AHEAD days ahead and re-planned whenever a page
 * that loads this module opens (and on every change or confirm), so the
 * horizon keeps moving. iOS keeps at most 64 pending notifications for the
 * app, shared with the daily mood reminder (id 1), the weekly summary (id 2),
 * the blood test reminder (4000–4009) and "on this day" (10000+), so this
 * module plans at most BUDGET (49, what the single reminder used): every slot's
 * first reminder for the next 7 days first, then the follow-ups, soonest first.
 * IDs: ID_BASE + i, i < BUDGET; ID_BASE … ID_BASE + ID_SPAN − 1 is cancelled
 * before each plan (it covers the single reminder's old 3000 + day * 10 + n).
 *
 * On the web there is no way to schedule a notification for later, so the
 * reminders fire only while Bipolar Bear is open in a tab: a timer per
 * reminder for the next 36 hours, shown as the in-app prompt when the tab is
 * in front, else as a browser notification (the browser's permission; the
 * service worker's notificationclick brings the tab forward).
 *
 * Device-only by design — it is an alarm on this phone / browser. Nothing here
 * syncs to Firestore. The times are keyed by the medicine's name in lower case
 * (already on the device in currentMedList), so they are cleared on sign-out
 * and reset along with the list.
 *
 * localStorage (all bb*):
 *   bbMedsReminder       '1' when on (the master switch)
 *   bbMedsReminders      JSON {"<medicine, lower case>": ["HH:MM", …], "*": […]}
 *                        "*" = all my medicines (only from the single
 *                        reminder, when there was no medicine list to copy it to)
 *   bbMedsRemindNames    '1' = name the medicines in the notification
 *   bbMedsTaken          JSON {day: 'YYYY-MM-DD', slots: ['HH:MM', …]} — ✅ Taken today
 *   bbMedsReminderTime   the single reminder's time; read once, by the move
 *   bbMedsTakenDay       the single reminder's "taken" day; moved, then removed
 *
 * @file js/shared/meds-reminder.js
 */
(function (root) {
  'use strict';

  var ID_BASE = 3000, ID_SPAN = 100, BUDGET = 49;
  var DAYS_AHEAD = 7;
  var MAX_FOLLOWUPS = 6;
  var WEB_HORIZON_H = 36;
  var ACTION_TYPE = 'BB_MEDS';
  var ALL = '*';
  var K_ON = 'bbMedsReminder', K_TIMES = 'bbMedsReminders', K_NAMES = 'bbMedsRemindNames', K_TAKEN = 'bbMedsTaken';
  var K_OLD_TIME = 'bbMedsReminderTime', K_OLD_TAKEN = 'bbMedsTakenDay';
  var HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

  function t(key, fallback, vars) {
    var s = null;
    try { s = (root.BB && BB.t) ? BB.t(key, vars) : null; } catch (_) {}
    if (s && s !== key) return s;
    var out = fallback;
    if (vars) Object.keys(vars).forEach(function (k) { out = out.split('{' + k + '}').join(vars[k]); });
    return out;
  }
  function get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (_) {} }
  function readJson(k, dflt) { try { var v = JSON.parse(get(k) || 'null'); return v == null ? dflt : v; } catch (_) { return dflt; } }

  function isNative() {
    try { var C = root.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); } catch (_) { return false; }
  }
  function plugin() {
    try {
      if (!isNative()) return null;
      return (Capacitor.Plugins && Capacitor.Plugins.LocalNotifications) || null;
    } catch (_) { return null; }
  }
  function webOk() {
    try { return !isNative() && typeof root.Notification === 'function' && root.isSecureContext !== false; } catch (_) { return false; }
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }

  /** The medicine list on this device: [{name, dosage}]. */
  function medList() {
    var v = readJson('currentMedList', []);
    return (Array.isArray(v) ? v : []).filter(function (m) { return m && typeof m === 'object' && String(m.name == null ? '' : m.name).trim(); })
      .map(function (m) { return { name: String(m.name).trim(), dosage: String(m.dosage == null ? '' : m.dosage).trim() }; });
  }

  function cleanTimes(arr) {
    var out = [];
    (Array.isArray(arr) ? arr : []).forEach(function (x) { x = String(x); if (HHMM.test(x) && out.indexOf(x) < 0) out.push(x); });
    return out.sort();
  }
  /** {key: [times]} — keys are medicine names in lower case, or ALL. */
  function readTimes() {
    var v = readJson(K_TIMES, {});
    var out = {};
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.keys(v).forEach(function (k) { var c = cleanTimes(v[k]); if (c.length) out[k] = c; });
    }
    return out;
  }
  function writeTimes(obj) {
    var out = {};
    Object.keys(obj || {}).forEach(function (k) { var c = cleanTimes(obj[k]); if (c.length) out[k] = c; });
    set(K_TIMES, JSON.stringify(out));
    return out;
  }

  /**
   * The single reminder (before 1.45) moves into the new model once, so nobody
   * loses it: its time goes on every medicine on the list (they then share one
   * notification at that time, as before), or on "all my medicines" when the
   * list is empty here. Runs while bbMedsReminders doesn't exist yet.
   */
  function migrate() {
    if (get(K_TIMES) != null) return false;
    var on = get(K_ON) === '1';
    var time = get(K_OLD_TIME);
    if (!HHMM.test(time || '')) time = '21:00';
    var obj = {};
    if (on) {
      var list = medList();
      if (list.length) list.forEach(function (m) { obj[norm(m.name)] = [time]; });
      else obj[ALL] = [time];
    }
    writeTimes(obj);
    var took = get(K_OLD_TAKEN);
    if (on && took) set(K_TAKEN, JSON.stringify({ day: took, slots: [time] }));
    del(K_OLD_TAKEN);
    return on;
  }

  function enabled() { return get(K_ON) === '1'; }
  function showNames() { return get(K_NAMES) === '1'; }

  /**
   * The reminder slots: one per distinct time, with the medicines due then.
   * Only medicines on the list count (and ALL). → [{time, meds: [names], all}]
   */
  function slotsFrom(times, list) {
    var byTime = {};
    var named = {};
    (list || []).forEach(function (m) { named[norm(m.name)] = m.name; });
    Object.keys(times || {}).forEach(function (k) {
      if (k !== ALL && !named[k]) return;
      (times[k] || []).forEach(function (tm) {
        var s = byTime[tm] || (byTime[tm] = { time: tm, meds: [], all: false });
        if (k === ALL) s.all = true; else if (s.meds.indexOf(named[k]) < 0) s.meds.push(named[k]);
      });
    });
    return Object.keys(byTime).sort().map(function (k) { return byTime[k]; });
  }

  function takenState() {
    var v = readJson(K_TAKEN, null);
    return v && typeof v === 'object' && typeof v.day === 'string' ? { day: v.day, slots: Array.isArray(v.slots) ? v.slots : [] } : { day: '', slots: [] };
  }
  function takenToday(slot) {
    var s = takenState();
    return s.day === dayKey(new Date()) && (slot == null ? s.slots.length > 0 : s.slots.indexOf(slot) >= 0);
  }

  /**
   * Pure: what to schedule. o: {slots, now: Date, taken: {day, slots},
   * budget, daysAhead, followups}. Every slot's first reminder over the days
   * ahead first (soonest first), then the hourly follow-ups (soonest first)
   * with what is left of the budget. A follow-up never passes midnight, and a
   * slot ✅ Taken for its day gets nothing that day.
   * → [{at: Date, day, slot, n, meds, all}] sorted by time
   */
  function plan(o) {
    var now = o.now || new Date();
    var budget = o.budget == null ? BUDGET : o.budget;
    var days = o.daysAhead == null ? DAYS_AHEAD : o.daysAhead;
    var fu = o.followups == null ? MAX_FOLLOWUPS : o.followups;
    var taken = o.taken || { day: '', slots: [] };
    var bases = [], follows = [];
    for (var d = 0; d < days; d++) {
      (o.slots || []).forEach(function (s) {
        var hm = s.time.split(':').map(Number);
        var base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, hm[0], hm[1], 0, 0);
        var day = dayKey(base);
        if (taken.day === day && taken.slots.indexOf(s.time) >= 0) return;
        for (var n = 0; n <= fu; n++) {
          var at = new Date(base.getTime() + n * 3600000);
          if (dayKey(at) !== day) break;   // never past midnight
          if (at <= now) continue;
          (n === 0 ? bases : follows).push({ at: at, day: day, slot: s.time, n: n, meds: s.meds.slice(), all: !!s.all });
        }
      });
    }
    var byAt = function (a, b) { return a.at - b.at; };
    bases.sort(byAt); follows.sort(byAt);
    var out = bases.slice(0, budget);
    out = out.concat(follows.slice(0, Math.max(0, budget - out.length)));
    return out.sort(byAt);
  }

  /** The notification's words. Names only when ticked; never for "all my medicines". */
  function content(item, names) {
    var list = names && item.meds && item.meds.length ? item.meds.join(', ') : '';
    if (item.n === 0) {
      return {
        title: list ? t('medsRem145.titleNamed', '💊 Time for {names}', { names: list }) : t('medsReminder.title', '💊 Time for your medication'),
        body: t('medsReminder.body', "Tap ✅ Taken once you've had it — I'll check again in an hour until you do."),
      };
    }
    return {
      title: list ? t('medsRem145.titleAgainNamed', '💊 Have you taken {names}?', { names: list }) : t('medsReminder.titleAgain', '💊 Have you taken your medication?'),
      body: t('medsReminder.bodyAgain', "Just checking in. Tap ✅ Taken to stop today's reminders."),
    };
  }

  function settings() {
    var times = readTimes(), list = medList();
    var slots = slotsFrom(times, list);
    return {
      enabled: enabled(),
      showNames: showNames(),
      reminders: times,
      slots: slots,
      times: slots.map(function (s) { return s.time; }),
      // Kept for older callers: the first time, or the old default.
      time: slots.length ? slots[0].time : '21:00',
    };
  }

  // ── Buttons on the notification ────────────────────────────────────────
  /** {types: [...]} — this module's ✅ Taken plus the daily reminder's mood
   *  buttons: iOS replaces every category on each registerActionTypes call,
   *  so both are always registered together. */
  function actionTypes() {
    var types = [];
    try { if (root.BB && BB.moodQueue && BB.moodQueue.actionTypes) types = (BB.moodQueue.actionTypes().types || []).slice(); } catch (_) {}
    types.push({ id: ACTION_TYPE, actions: [{ id: 'taken', title: t('medsReminder.actionTaken', '✅ Taken'), foreground: true }] });
    return { types: types };
  }
  var _typesRegistered = false;
  async function registerTypes(LN) {
    if (_typesRegistered || !LN.registerActionTypes) return;
    _typesRegistered = true;
    try { await LN.registerActionTypes(actionTypes()); } catch (e) { _typesRegistered = false; }
  }
  function allIds() {
    var ids = [];
    for (var i = 0; i < ID_SPAN; i++) ids.push({ id: ID_BASE + i });
    return ids;
  }
  function isMine(n) {
    return !!n && ((n.extra && n.extra.bbMeds) || (n.id >= ID_BASE && n.id < ID_BASE + ID_SPAN));
  }

  // ── Scheduling ─────────────────────────────────────────────────────────
  /** Cancel everything this module owns, then (if on) plan ahead. → number planned */
  async function schedule() {
    if (webOk()) return scheduleWeb();
    var LN = plugin();
    if (!LN) return 0;
    try { await LN.cancel({ notifications: allIds() }); } catch (_) {}
    var s = settings();
    if (!s.enabled || !s.slots.length) return 0;
    try {
      var perm = await LN.checkPermissions();
      if (!perm || perm.display !== 'granted') return 0;
    } catch (_) { return 0; }
    await registerTypes(LN);
    var items = plan({ slots: s.slots, now: new Date(), taken: takenState() });
    var list = items.map(function (it, i) {
      var c = content(it, s.showNames);
      return {
        id: ID_BASE + i,
        title: c.title,
        body: c.body,
        schedule: { at: it.at, allowWhileIdle: true },
        actionTypeId: ACTION_TYPE,
        extra: { bbMeds: 1, day: it.day, slot: it.slot },
        sound: 'default',
        smallIcon: 'ic_stat_notify',
        iconColor: '#FF9500',
      };
    });
    if (!list.length) return 0;
    try { await LN.schedule({ notifications: list }); }
    catch (e) { console.warn('[medsReminder] schedule failed', e); return 0; }
    return list.length;
  }

  // Web: timers while the page is open.
  var _webTimers = [];
  function clearWebTimers() { _webTimers.forEach(function (h) { clearTimeout(h); }); _webTimers = []; }
  function webPermission() { try { return root.Notification.permission; } catch (_) { return 'denied'; } }
  function scheduleWeb() {
    clearWebTimers();
    var s = settings();
    if (!s.enabled || !s.slots.length || webPermission() !== 'granted') return 0;
    var now = new Date();
    var items = plan({ slots: s.slots, now: now, taken: takenState(), budget: 200, daysAhead: 3 })
      .filter(function (it) { return it.at - now <= WEB_HORIZON_H * 3600000; });
    items.forEach(function (it) {
      _webTimers.push(setTimeout(function () { fireWeb(it); }, Math.max(0, it.at - Date.now())));
    });
    // Plan again before the window runs out.
    _webTimers.push(setTimeout(scheduleWeb, 12 * 3600000));
    return items.length;
  }
  function fireWeb(it) {
    if (!enabled() || takenToday(it.slot)) return;
    if (document.visibilityState === 'visible' && document.hasFocus && document.hasFocus()) { askTaken(it.slot); return; }
    var c = content(it, showNames());
    var opts = { body: c.body, tag: 'bbmeds-' + it.slot, icon: 'icons/favicons/android-chrome-192x192.png', data: { bbMeds: 1, slot: it.slot, day: it.day } };
    try {
      var n = new root.Notification(c.title, opts);
      n.onclick = function () { try { root.focus(); } catch (_) {} n.close(); askTaken(it.slot); };
      return;
    } catch (_) { /* Android Chrome: only through the service worker */ }
    try {
      if (navigator.serviceWorker) {
        navigator.serviceWorker.getRegistration().then(function (reg) { if (reg) reg.showNotification(c.title, opts); }).catch(function () {});
      }
    } catch (_) {}
  }

  /** ✅ Taken: this slot is done today (no slot: every slot today). */
  async function confirmTaken(slot) {
    var today = dayKey(new Date());
    var s = takenState();
    var slots = s.day === today ? s.slots.slice() : [];
    var todays = settings().slots.map(function (x) { return x.time; });
    (slot ? [slot] : todays).forEach(function (x) { if (slots.indexOf(x) < 0) slots.push(x); });
    set(K_TAKEN, JSON.stringify({ day: today, slots: slots }));
    var LN = plugin();
    if (LN) {
      try {
        var shown = await LN.getDeliveredNotifications();
        var mine = ((shown && shown.notifications) || []).filter(function (n) {
          if (!isMine(n)) return false;
          var ns = n.extra && n.extra.slot;
          return !slot || !ns || ns === slot;
        });
        if (mine.length && LN.removeDeliveredNotifications) await LN.removeDeliveredNotifications({ notifications: mine });
      } catch (_) {}
    }
    await schedule();
    changed();
    toast(t('medsReminder.confirmed', "✅ Noted — no more medication reminders today."));
  }

  // ── Changing the settings ──────────────────────────────────────────────
  function changed() {
    try { root.dispatchEvent(new CustomEvent('bb:medsreminder')); } catch (_) {}
  }
  async function askPermission() {
    if (webOk()) {
      var p = webPermission();
      if (p === 'granted') return true;
      if (p === 'denied') return false;
      try { p = await root.Notification.requestPermission(); } catch (_) { p = 'denied'; }
      return p === 'granted';
    }
    var LN = plugin();
    if (!LN) return false;
    try {
      var r = await LN.checkPermissions();
      if (!r || r.display !== 'granted') r = await LN.requestPermissions();
      return !!r && r.display === 'granted';
    } catch (_) { return false; }
  }
  /** The master switch. → Promise<true> when it took, or the reason it didn't (a string). */
  async function setEnabled(on) {
    if (!on) { del(K_ON); await schedule(); changed(); return true; }
    if (!isAvailable()) return t('medsRem145.unavailable', 'Reminders need the Bipolar Bear app, or a browser that allows notifications.');
    if (!(await askPermission())) {
      del(K_ON); changed();
      return webOk()
        ? t('medsRem145.blockedWeb', 'Notifications are blocked for this site — allow them in your browser’s settings, then try again.')
        : t('medsReminder.blocked', 'Notifications are turned off for Bipolar Bear — allow them in your phone’s Settings, then try again.');
    }
    set(K_ON, '1');
    await schedule();
    changed();
    return true;
  }
  async function setShowNames(on) {
    if (on) set(K_NAMES, '1'); else del(K_NAMES);
    await schedule();
    changed();
    return true;
  }
  /** A medicine's times (key: its name, or ALL). */
  function timesFor(name) { var k = name === ALL ? ALL : norm(name); return readTimes()[k] || []; }
  async function setTimes(name, times) {
    var all = readTimes();
    var k = name === ALL ? ALL : norm(name);
    if (!k) return false;
    all[k] = cleanTimes(times);
    writeTimes(all);
    await schedule();
    changed();
    return true;
  }
  function addTime(name, time) {
    if (!HHMM.test(time || '')) return Promise.resolve(false);
    return setTimes(name, timesFor(name).concat([time]));
  }
  function removeTime(name, time) {
    return setTimes(name, timesFor(name).filter(function (x) { return x !== time; }));
  }
  /**
   * The medicine list changed (journal.js BBMedList.save): a renamed medicine
   * keeps its times; a removed one loses them. opts.rename: {from, to}.
   */
  function onListChange(prev, next, opts) {
    var all = readTimes();
    var before = JSON.stringify(all);
    var r = opts && opts.rename;
    if (r && r.from && r.to && norm(r.from) !== norm(r.to) && all[norm(r.from)]) {
      all[norm(r.to)] = cleanTimes((all[norm(r.to)] || []).concat(all[norm(r.from)]));
      delete all[norm(r.from)];
    }
    var keep = {};
    (next || []).forEach(function (m) { if (m && m.name) keep[norm(m.name)] = 1; });
    (prev || []).forEach(function (m) {
      var k = m && m.name ? norm(m.name) : '';
      if (k && !keep[k]) delete all[k];
    });
    if (JSON.stringify(all) !== before) writeTimes(all);
    // The list itself changed too (names in the notification, new slots).
    setTimeout(function () { schedule().then(changed, changed); }, 0);
  }

  /** Sign-out / delete-all / account reset: forget every reminder and cancel them. */
  async function clear() {
    [K_ON, K_TIMES, K_NAMES, K_TAKEN, K_OLD_TIME, K_OLD_TAKEN].forEach(del);
    clearWebTimers();
    var LN = plugin();
    if (LN) { try { await LN.cancel({ notifications: allIds() }); } catch (_) {} }
    changed();
  }

  function isAvailable() { return !!plugin() || webOk(); }

  // ── Small UI: the "taken yet?" prompt and a toast ──────────────────────
  // Self-contained (own <style>, built on demand) so any page that loads this
  // module can show them without its own markup.
  function injectStyle() {
    if (document.getElementById('bbMedsStyle')) return;
    var st = document.createElement('style');
    st.id = 'bbMedsStyle';
    st.textContent =
      '.bbm-back{position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;padding:16px 12px calc(16px + env(safe-area-inset-bottom,0px));}' +
      '.bbm-sheet{background:#fff;color:#212529;width:100%;max-width:420px;border-radius:20px;padding:20px 18px 16px;box-shadow:0 10px 40px rgba(0,0,0,.25);font-family:inherit;text-align:center;animation:bbmUp .22s ease;}' +
      '@keyframes bbmUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}' +
      '@media (prefers-reduced-motion: reduce){.bbm-sheet{animation:none}}' +
      '.bbm-ico{font-size:2em;line-height:1;margin-bottom:6px}.bbm-title{font-weight:800;font-size:1.08em;margin-bottom:6px}' +
      '.bbm-sub{font-size:.86em;color:var(--text-muted-ink);line-height:1.45;margin-bottom:14px}' +
      '.bbm-btns{display:flex;gap:10px;margin-top:6px}.bbm-btns button{flex:1;padding:12px;border-radius:12px;font:inherit;font-weight:700;font-size:.95em;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.bbm-no{background:#f8f9fa;color:#495057;border:1.5px solid #e9ecef}.bbm-yes{background:var(--brand-btn,#c2410c);color:#fff;border:none}' +
      '.bbm-toast{position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:3001;background:rgba(33,37,41,.92);color:#fff;padding:10px 16px;border-radius:12px;font-size:.88em;font-weight:600;max-width:88vw;text-align:center}' +
      'html.theme-dark .bbm-sheet{background:#2a221b;color:#f3e9dc}html.theme-dark .bbm-sub{color:#c9b8a5}' +
      'html.theme-dark .bbm-no{background:#3a2f25;color:#f3e9dc;border-color:#4a3d31}';
    document.head.appendChild(st);
  }
  function toast(msg) {
    try {
      injectStyle();
      var el = document.createElement('div');
      el.className = 'bbm-toast';
      el.setAttribute('role', 'status');
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 3200);
    } catch (_) {}
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /** Opened from a reminder (or a web timer with the tab in front): ask once, in the app. */
  function askTaken(slot) {
    if (takenToday(slot || null) || document.querySelector('.bbm-back')) return;
    var sl = slot ? settings().slots.filter(function (x) { return x.time === slot; })[0] : null;
    var names = showNames() && sl && sl.meds.length ? sl.meds.join(', ') : '';
    injectStyle();
    var back = document.createElement('div');
    back.className = 'bbm-back';
    back.innerHTML = '<div class="bbm-sheet" role="dialog" aria-modal="true" aria-labelledby="bbmAskTitle">' +
      '<div class="bbm-ico" aria-hidden="true">💊</div>' +
      '<div class="bbm-title" id="bbmAskTitle">' + esc(names ? t('medsRem145.askNamed', 'Have you taken {names}?', { names: names }) : t('medsReminder.askTitle', 'Have you taken your medication?')) + '</div>' +
      '<div class="bbm-sub">' + esc(t('medsReminder.askSub', "Tap ✅ Taken and I'll stop reminding you today.")) + '</div>' +
      '<div class="bbm-btns"><button type="button" class="bbm-no">' + esc(t('medsReminder.notYet', 'Not yet')) + '</button><button type="button" class="bbm-yes">' + esc(t('medsReminder.actionTaken', '✅ Taken')) + '</button></div></div>';
    back.addEventListener('click', function (e) { if (e.target === back) back.remove(); });
    back.querySelector('.bbm-no').addEventListener('click', function () { back.remove(); });
    back.querySelector('.bbm-yes').addEventListener('click', function () { back.remove(); confirmTaken(slot || null); });
    document.body.appendChild(back);
  }

  /** The settings live in 💊 My medicines (journal); elsewhere, go there. */
  function openSettings() {
    if (root.BBMeds && BBMeds.open) { BBMeds.open('doses', { reminders: true }); return; }
    location.href = 'journal.html?openMeds=1';
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  // Capacitor keeps an unconsumed localNotificationActionPerformed until a
  // listener attaches, so whichever page opens first (home, or the journal
  // via a deep link) receives the tap.
  function init() {
    migrate();
    var LN = plugin();
    if (LN) {
      try {
        LN.addListener('localNotificationActionPerformed', function (a) {
          var n = a && a.notification;
          if (!isMine(n)) return;
          var slot = (n.extra && n.extra.slot) || null;
          if (a.actionId === 'taken') confirmTaken(slot);
          else setTimeout(function () { askTaken(slot); }, 600);
        });
      } catch (_) {}
      if (enabled()) schedule();
      return;
    }
    if (webOk()) {
      // The service worker's notificationclick (service-worker.js) asks this tab.
      try {
        if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) {
          var d = e && e.data;
          if (d && d.bbMedsAsk) askTaken(typeof d.slot === 'string' ? d.slot : null);
        });
      } catch (_) {}
      if (enabled()) scheduleWeb();
    }
  }

  root.BB = root.BB || {};
  root.BB.medsReminder = {
    ALL: ALL,
    isAvailable: isAvailable,
    isNative: function () { return !!plugin(); },
    isWeb: webOk,
    settings: settings,
    takenToday: takenToday,
    timesFor: timesFor,
    setTimes: setTimes,
    addTime: addTime,
    removeTime: removeTime,
    setEnabled: setEnabled,
    setShowNames: setShowNames,
    onListChange: onListChange,
    schedule: schedule,
    confirmTaken: confirmTaken,
    askTaken: askTaken,
    clear: clear,
    openSettings: openSettings,
    actionTypes: actionTypes,
    // Pure helpers (tests)
    plan: plan,
    slotsFrom: slotsFrom,
    content: content,
    migrate: migrate,
    BUDGET: BUDGET,
    ID_BASE: ID_BASE,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
