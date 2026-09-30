/**
 * Medication reminder — BB.medsReminder (native apps only).
 *
 * Set from the journal's medication step (🔔 pill under "Manage medications").
 * At the chosen time the phone shows "Time for your medication"; if the user
 * hasn't confirmed, it asks again every hour — up to MAX_FOLLOWUPS more times,
 * never past midnight — until they tap ✅ Taken (a button on the notification
 * itself, or the prompt the app shows when a reminder is tapped open).
 *
 * How it's scheduled. A repeating OS notification can't be skipped for one
 * day, and cancelling it cancels every day, so every reminder is a one-off:
 * the base reminder plus its follow-ups, planned DAYS_AHEAD days ahead and
 * re-planned whenever a page that loads this module opens (and on every
 * confirm), so the horizon keeps moving. 7 days × (1 + 6) = 49 notifications,
 * inside iOS's 64-pending cap alongside the daily mood reminder (id 1), the
 * weekly summary (id 2) and "on this day" anniversaries (10000+).
 *
 * IDs: 3000 + dayOffset * 10 + n (n = 0 base, 1..6 follow-ups).
 *
 * Device-only by design — it is an alarm on this phone. Nothing here syncs to
 * Firestore, and nothing about the medication itself is stored: the settings
 * are on/off + a time, and "confirmed" is just today's date.
 *
 * localStorage (all bb*, cleared by the journal's delete-all):
 *   bbMedsReminder       '1' when on
 *   bbMedsReminderTime   'HH:MM' (default 21:00)
 *   bbMedsTakenDay       'YYYY-MM-DD' — the day ✅ Taken was last pressed
 *
 * @file js/shared/meds-reminder.js
 */
(function () {
  'use strict';

  var ID_BASE = 3000;
  var DAYS_AHEAD = 7;
  var MAX_FOLLOWUPS = 6;
  var ACTION_TYPE = 'BB_MEDS';
  var K_ON = 'bbMedsReminder', K_TIME = 'bbMedsReminderTime', K_TAKEN = 'bbMedsTakenDay';

  function t(key, fallback, vars) {
    var s = null;
    try { s = (window.BB && BB.t) ? BB.t(key, vars) : null; } catch (_) {}
    if (s && s !== key) return s;
    var out = fallback;
    if (vars) Object.keys(vars).forEach(function (k) { out = out.split('{' + k + '}').join(vars[k]); });
    return out;
  }
  function get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (_) {} }

  function plugin() {
    try {
      var C = window.Capacitor;
      if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
      return (C.Plugins && C.Plugins.LocalNotifications) || null;
    } catch (_) { return null; }
  }
  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function allIds() {
    var ids = [];
    for (var d = 0; d < DAYS_AHEAD; d++) for (var n = 0; n <= MAX_FOLLOWUPS; n++) ids.push({ id: ID_BASE + d * 10 + n });
    return ids;
  }

  function settings() {
    var time = get(K_TIME);
    if (!/^\d{2}:\d{2}$/.test(time || '')) time = '21:00';
    return { enabled: get(K_ON) === '1', time: time };
  }
  function takenToday() { return get(K_TAKEN) === dayKey(new Date()); }

  var _typesRegistered = false;
  async function registerTypes(LN) {
    if (_typesRegistered || !LN.registerActionTypes) return;
    _typesRegistered = true;
    try {
      await LN.registerActionTypes({ types: [{
        id: ACTION_TYPE,
        actions: [{ id: 'taken', title: t('medsReminder.actionTaken', '✅ Taken'), foreground: true }],
      }] });
    } catch (e) { _typesRegistered = false; }
  }

  /** Cancel everything this module owns, then (if on) plan the next DAYS_AHEAD days. */
  async function schedule() {
    var LN = plugin();
    if (!LN) return;
    try { await LN.cancel({ notifications: allIds() }); } catch (_) {}
    var s = settings();
    if (!s.enabled) return;
    try {
      var perm = await LN.checkPermissions();
      if (!perm || perm.display !== 'granted') return;
    } catch (_) { return; }
    await registerTypes(LN);
    var hm = s.time.split(':').map(Number);
    var now = new Date();
    var skipToday = takenToday();
    var list = [];
    for (var d = 0; d < DAYS_AHEAD; d++) {
      if (d === 0 && skipToday) continue;
      var base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, hm[0], hm[1], 0, 0);
      for (var n = 0; n <= MAX_FOLLOWUPS; n++) {
        var at = new Date(base.getTime() + n * 3600000);
        if (at.getDate() !== base.getDate()) break;   // never past midnight
        if (at <= now) continue;
        list.push({
          id: ID_BASE + d * 10 + n,
          title: n === 0 ? t('medsReminder.title', '💊 Time for your medication')
                         : t('medsReminder.titleAgain', '💊 Have you taken your medication?'),
          body: n === 0 ? t('medsReminder.body', "Tap ✅ Taken once you've had it — I'll check again in an hour until you do.")
                        : t('medsReminder.bodyAgain', "Just checking in. Tap ✅ Taken to stop today's reminders."),
          schedule: { at: at, allowWhileIdle: true },
          actionTypeId: ACTION_TYPE,
          extra: { bbMeds: 1, day: dayKey(base) },
          sound: 'default',
          smallIcon: 'ic_notification',
        });
      }
    }
    if (!list.length) return;
    try { await LN.schedule({ notifications: list }); }
    catch (e) { console.warn('[medsReminder] schedule failed', e); }
  }

  /** ✅ Taken: today is done — clear today's remaining nudges and any on screen. */
  async function confirmTaken() {
    set(K_TAKEN, dayKey(new Date()));
    var LN = plugin();
    if (LN) {
      try {
        var shown = await LN.getDeliveredNotifications();
        var mine = ((shown && shown.notifications) || []).filter(function (n) {
          return (n.id >= ID_BASE && n.id < ID_BASE + DAYS_AHEAD * 10) || (n.extra && n.extra.bbMeds);
        });
        if (mine.length && LN.removeDeliveredNotifications) await LN.removeDeliveredNotifications({ notifications: mine });
      } catch (_) {}
    }
    await schedule();
    toast(t('medsReminder.confirmed', "✅ Noted — no more medication reminders today."));
  }

  /** Turn on / off / change the time. Returns false if notifications are blocked. */
  async function save(enabled, time) {
    if (/^\d{2}:\d{2}$/.test(time || '')) set(K_TIME, time);
    if (!enabled) { del(K_ON); await schedule(); return true; }
    var LN = plugin();
    if (!LN) return false;
    try {
      var p = await LN.checkPermissions();
      if (!p || p.display !== 'granted') p = await LN.requestPermissions();
      if (!p || p.display !== 'granted') { del(K_ON); return false; }
    } catch (_) { return false; }
    set(K_ON, '1');
    await schedule();
    return true;
  }

  /** Delete-all / account reset: forget the reminder and cancel it. */
  async function clear() {
    [K_ON, K_TIME, K_TAKEN].forEach(del);
    await schedule();
  }

  // ── Small UI: the settings sheet and the "taken yet?" prompt ────────────
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
      '.bbm-ico{font-size:2em;line-height:1;margin-bottom:6px}.bbm-title{font-weight:800;font-size:1.08em;margin-bottom:6px}' +
      '.bbm-sub{font-size:.86em;color:#6c757d;line-height:1.45;margin-bottom:14px}' +
      '.bbm-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1.5px solid #e9ecef;border-radius:12px;margin-bottom:10px;text-align:left;font-weight:700;font-size:.95em}' +
      '.bbm-row input[type=time]{font:inherit;font-size:1.05em;padding:6px 10px;border:1.5px solid #dee2e6;border-radius:10px;background:#fff;color:#212529}' +
      '.bbm-sw{position:relative;width:46px;height:26px;border-radius:13px;border:none;background:#ccc;cursor:pointer;flex-shrink:0;padding:0;transition:background .2s}' +
      '.bbm-sw span{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:left .2s}' +
      '.bbm-sw[aria-pressed=true]{background:var(--brand-primary,#ff9500)}.bbm-sw[aria-pressed=true] span{left:23px}' +
      '.bbm-msg{font-size:.82em;color:#c92a2a;margin:-2px 0 10px;min-height:0}' +
      '.bbm-btns{display:flex;gap:10px;margin-top:6px}.bbm-btns button{flex:1;padding:12px;border-radius:12px;font:inherit;font-weight:700;font-size:.95em;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
      '.bbm-no{background:#f8f9fa;color:#495057;border:1.5px solid #e9ecef}.bbm-yes{background:var(--brand-btn,#c2410c);color:#fff;border:none}' +
      '.bbm-toast{position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:3001;background:rgba(33,37,41,.92);color:#fff;padding:10px 16px;border-radius:12px;font-size:.88em;font-weight:600;max-width:88vw;text-align:center}' +
      'html.theme-dark .bbm-sheet{background:#2a221b;color:#f3e9dc}html.theme-dark .bbm-sub{color:#c9b8a5}' +
      'html.theme-dark .bbm-row{border-color:#4a3d31}html.theme-dark .bbm-row input[type=time]{background:#1c1612;color:#f3e9dc;border-color:#4a3d31}' +
      'html.theme-dark .bbm-no{background:#3a2f25;color:#f3e9dc;border-color:#4a3d31}';
    document.head.appendChild(st);
  }
  function toast(msg) {
    injectStyle();
    var el = document.createElement('div');
    el.className = 'bbm-toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }
  function sheet(html) {
    injectStyle();
    var back = document.createElement('div');
    back.className = 'bbm-back';
    back.innerHTML = '<div class="bbm-sheet" role="dialog" aria-modal="true">' + html + '</div>';
    back.addEventListener('click', function (e) { if (e.target === back) back.remove(); });
    document.body.appendChild(back);
    return back;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /** The settings sheet (journal medication step). onDone(settings) repaints the pill. */
  function openSettings(onDone) {
    var s = settings();
    var on = s.enabled;
    var back = sheet(
      '<div class="bbm-ico">🔔</div>' +
      '<div class="bbm-title">' + esc(t('medsReminder.sheetTitle', 'Medication reminder')) + '</div>' +
      '<div class="bbm-sub">' + esc(t('medsReminder.sheetSub', "A reminder at this time every day. If you haven't tapped ✅ Taken, I'll ask again every hour — up to 6 more times, and never after midnight.")) + '</div>' +
      '<div class="bbm-row"><span>' + esc(t('medsReminder.remindMe', 'Remind me')) + '</span><button type="button" class="bbm-sw" aria-pressed="' + on + '"><span></span></button></div>' +
      '<div class="bbm-row"><span>' + esc(t('medsReminder.time', 'Time')) + '</span><input type="time" value="' + esc(s.time) + '"></div>' +
      '<div class="bbm-msg"></div>' +
      '<div class="bbm-btns"><button type="button" class="bbm-no">' + esc(t('common.cancel', 'Cancel')) + '</button><button type="button" class="bbm-yes">' + esc(t('common.save', 'Save')) + '</button></div>'
    );
    var sw = back.querySelector('.bbm-sw');
    sw.addEventListener('click', function () { on = !on; sw.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    back.querySelector('.bbm-no').addEventListener('click', function () { back.remove(); });
    back.querySelector('.bbm-yes').addEventListener('click', async function () {
      var time = back.querySelector('input[type=time]').value;
      var ok = await save(on, time);
      if (!ok) {
        back.querySelector('.bbm-msg').textContent = t('medsReminder.blocked', 'Notifications are turned off for Bipolar Bear — allow them in your phone’s Settings, then try again.');
        return;
      }
      back.remove();
      if (on) toast(t('medsReminder.saved', '🔔 Medication reminder set for {time}', { time: settings().time }));
      if (typeof onDone === 'function') onDone(settings());
    });
  }

  /** Opened from a reminder: ask once, in the app. */
  function askTaken() {
    if (takenToday() || document.querySelector('.bbm-back')) return;
    var back = sheet(
      '<div class="bbm-ico">💊</div>' +
      '<div class="bbm-title">' + esc(t('medsReminder.askTitle', 'Have you taken your medication?')) + '</div>' +
      '<div class="bbm-sub">' + esc(t('medsReminder.askSub', "Tap ✅ Taken and I'll stop reminding you today.")) + '</div>' +
      '<div class="bbm-btns"><button type="button" class="bbm-no">' + esc(t('medsReminder.notYet', 'Not yet')) + '</button><button type="button" class="bbm-yes">' + esc(t('medsReminder.actionTaken', '✅ Taken')) + '</button></div>'
    );
    back.querySelector('.bbm-no').addEventListener('click', function () { back.remove(); });
    back.querySelector('.bbm-yes').addEventListener('click', function () { back.remove(); confirmTaken(); });
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  // Capacitor keeps an unconsumed localNotificationActionPerformed until a
  // listener attaches, so whichever page opens first (home, or the journal
  // via a deep link) receives the tap.
  function init() {
    var LN = plugin();
    if (!LN) return;
    try {
      LN.addListener('localNotificationActionPerformed', function (a) {
        var n = a && a.notification;
        var mine = n && ((n.extra && n.extra.bbMeds) || (n.id >= ID_BASE && n.id < ID_BASE + DAYS_AHEAD * 10));
        if (!mine) return;
        if (a.actionId === 'taken') confirmTaken();
        else setTimeout(askTaken, 600);
      });
    } catch (_) {}
    if (settings().enabled) schedule();
  }

  window.BB = window.BB || {};
  window.BB.medsReminder = {
    isAvailable: function () { return !!plugin(); },
    settings: settings,
    takenToday: takenToday,
    save: save,
    schedule: schedule,
    confirmTaken: confirmTaken,
    clear: clear,
    openSettings: openSettings,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
