/**
 * Journal insights: the life chart and opt-in early-warning nudges.
 *
 * Loaded on journal.html right AFTER js/journal.js (and before fab.js). It
 * only ever reads the already-decrypted entry list that journal.js hands it
 * (`BBInsights.render(entries)` from loadEntries()) — there is no extra
 * decryption path and no network call here. The one Firestore write is the
 * `earlyWarnEnabled` setting itself, merged into userSettings/{uid} exactly
 * like the other synced toggles.
 *
 *   BBInsights.render(entries)      draw the life chart; evaluate nudges if a
 *                                   save or a stats-open asked for it
 *   BBInsights.noteSaved()          call just before loadEntries() after a save
 *   BBInsights.onStatsOpen()        call when the journal/stats card opens
 *   BBInsights.syncSettingUI()      refresh the settings toggle from storage
 *   BBInsights.drawLifeChartPdf(doc, entries, opts) → new y (jsPDF, mm)
 *
 * Life chart (NIMH life-chart style): one bar per day above/below a "stable"
 * baseline (elevated/manic above, low/depressed below), a medication strip
 * (missed / unsure days) and sleep hours underneath, on one scrollable time
 * axis. The markers use the day's single medication answer (adherence, not
 * list changes); per-medicine doses (1.44) are in js/journal-meds.js.
 *
 * Blood results (v358), only with Settings → "Show blood results on my
 * charts" ticked (BB.bloodCharts, off by default): a 🩸 button on the day of
 * each result in a strip under the sleep bars (tap / click / focus shows
 * "Lithium 0.7 mmol/L · 12 Mar"); from 6M up, one test's results joined by a
 * thin line over the mood area on its own right-hand scale, with the range
 * the person typed in shaded (never a default range). Lithium first; a
 * picker when two or more tests have a line (bbBloodChartTest, this device).
 *
 * Early warnings are OFF by default (`earlyWarnEnabled` in localStorage and
 * userSettings). Everything is computed on this device from the user's own
 * history; wording is deliberately calm and non-diagnostic. Each pattern is
 * shown at most once per ~3 days (`bbEarlyWarnSeen`, localStorage only).
 *
 * The pure detection helpers are exported (module.exports under Node) so they
 * can be unit-tested without a DOM.
 *
 * @file js/journal-insights.js
 */
(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var SETTING_KEY = 'earlyWarnEnabled';
  var SEEN_KEY = 'bbEarlyWarnSeen';
  var THROTTLE_MS = 3 * DAY_MS;

  // Same palette as `moodColors` in journal.js (on-screen charts/calendar).
  var MOOD_COLORS = {
    manic: '#ff6b6b', elevated: '#d2be00', stable: '#51cf66',
    low: '#845ef7', depressed: '#5c7cfa'
  };
  // Same palette as the PDF export's moodColor() in journal.js.
  var PDF_MOOD_RGB = {
    manic: [255, 68, 68], elevated: [255, 149, 0], stable: [81, 207, 102],
    low: [132, 94, 247], depressed: [92, 124, 250]
  };
  var SLEEP_COLOR = '#6495ed';

  // English fallbacks — used only until the journal.lifeChart / journal.earlyWarn
  // keys are present in js/shared/i18n.js (BB.t returns the key when missing).
  var EN = {
    lifeChart: {
      title: '📈 Life chart',
      subtitle: 'Your mood day by day — above the line is elevated, below is low — with sleep underneath. Swipe to move through time.',
      rangeLabel: 'Time range',
      earlier: 'Earlier days', later: 'Later days',
      r1m: '1M', r3m: '3M', r6m: '6M', r1y: '1Y',
      stable: 'Stable',
      sleep: 'Sleep',
      meds: 'Meds',
      legendSleep: 'Hours slept',
      legendMeds: 'Meds missed or unsure',
      legendGap: 'Blank = no entry',
      tapHint: 'Tap a day to see it.',
      dayNoEntry: '{date}: no entry',
      sleepHours: '{h}h sleep',
      medsMissed: 'meds missed',
      medsUnsure: 'meds unsure',
      autoFilled: 'auto-filled',
      pdfTitle: 'Life chart — last 90 days',
      pdfNote: 'Bars above the line are elevated/manic days, below it low/depressed days. Blue bars show hours slept; red marks show days medication was missed or unsure. Gaps are days with no entry.',
      viewLabel: 'View',
      viewCalendar: '📅 Calendar',
      viewLife: '📈 Life chart',
      viewTapAgain: 'Double-tap to make this your default',
      viewClickAgain: 'Double-click to make this your default',
      viewNowDefault: 'Now your default view',
      viewDefault: 'Default view'
    },
    earlyWarn: {
      settingTitle: '🌱 Early-warning nudges',
      settingDesc: 'Off by default. Gently lets you know when your recent entries follow a pattern worth keeping an eye on. Worked out on this device only — nothing is sent anywhere.',
      cardTitle: '🌱 Something to keep an eye on',
      shortSleep: 'You have slept less than usual on {n} of the last 4 nights (about {avg}h, when you usually get around {base}h). You might want to keep an eye on your sleep.',
      shortSleepNoBase: 'You have had under 6 hours of sleep on {n} of the last 4 nights. You might want to keep an eye on your sleep.',
      elevatedRun: 'You have logged an elevated or manic mood {n} days in a row. You might want to keep an eye on how the next few days go.',
      lowRun: 'You have logged a low or depressed mood {n} days in a row. You might want to be extra gentle with yourself and keep an eye on how you are doing.',
      swing: 'Your mood has moved quite a lot over the last couple of days ({from} → {to}). You might want to keep an eye on it.',
      histSleepUp: 'The last time you slept this little for a few nights, the week after was mostly elevated.',
      histSleepDown: 'The last time you slept this little for a few nights, the week after was mostly low.',
      histSleepStable: 'The last time you slept this little for a few nights, the week after stayed mostly stable.',
      histRun: 'The last time you had a run like this, it lasted {n} days.',
      strategies: '🧠 Open my strategies',
      careTeam: "If you're worried, talk to your care team.",
      help: 'Support contacts',
      dismiss: 'Dismiss',
      onDevice: 'Worked out on this device only.'
    }
  };

  // ── i18n ────────────────────────────────────────────────────────────────
  function _fallback(key) {
    var parts = key.split('.'), cur = EN;
    for (var i = 0; i < parts.length; i++) { if (!cur) return null; cur = cur[parts[i]]; }
    return typeof cur === 'string' ? cur : null;
  }
  function tr(key, vars) {
    var full = 'journal.' + key, v = null;
    try { if (root.BB && root.BB.t) v = root.BB.t(full, vars); } catch (_) {}
    if (v == null || v === full) {
      v = _fallback(key) || key;
      if (vars) Object.keys(vars).forEach(function (k) { v = v.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k])); });
    }
    return v;
  }
  function moodName(cat) {
    var k = 'mood.' + cat, v = null;
    try { if (root.BB && root.BB.t) v = root.BB.t(k); } catch (_) {}
    if (!v || v === k) v = cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : '';
    return v;
  }
  function lang() {
    var l = 'en';
    try { if (root.BB && root.BB.i18n && root.BB.i18n.getLang) l = root.BB.i18n.getLang() || 'en'; } catch (_) {}
    return l === 'zh' ? 'zh-CN' : l;
  }
  function fmtNum(n) {
    try { return new Intl.NumberFormat(lang(), { maximumFractionDigits: 1 }).format(n); } catch (_) { return String(Math.round(n * 10) / 10); }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Pure helpers (exported for tests) ─────────────────────────────────────
  function isNumericMood(m) {
    return typeof m === 'number' ? isFinite(m) : (typeof m === 'string' && m.trim() !== '' && isFinite(Number(m)));
  }
  /** Mirror of journal.js _moodCat(): any mood value → one of five categories. */
  function moodCat(m) {
    if (m == null || m === '') return null;
    if (!isNumericMood(m)) return m === 'good' ? 'stable' : (PDF_MOOD_RGB[m] ? m : null);
    var n = Number(m);
    if (n <= 1) return 'depressed';
    if (n <= 3) return 'low';
    if (n <= 6) return 'stable';
    if (n <= 8) return 'elevated';
    return 'manic';
  }
  /** Mirror of journal.js _moodScore(): 1 (depressed) … 3 (stable) … 5 (manic). */
  function moodScore(m) {
    if (isNumericMood(m)) return 1 + (Number(m) / 10) * 4;
    var v = { manic: 5, elevated: 4, stable: 3, good: 3, low: 2, depressed: 1 }[m];
    return v != null ? v : null;
  }
  function isUp(cat) { return cat === 'elevated' || cat === 'manic'; }
  function isDown(cat) { return cat === 'low' || cat === 'depressed'; }

  function dayStart(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /**
   * Collapse entries into one record per calendar day, contiguous from the
   * earlier of the first entry / `minStart` up to `end` (default today).
   * Days with no entry have cat/score/sleep/med = null.
   *
   * @param {Array<object>} entries decrypted journal entries
   * @param {{end?:Date, minStart?:Date, skipHidden?:boolean}} [opts]
   * @returns {Array<{t:number,key:string,cat:?string,score:?number,sleep:?number,med:?string,auto:boolean}>}
   */
  function buildDays(entries, opts) {
    opts = opts || {};
    var end = dayStart(opts.end || new Date());
    var byKey = {};
    var first = null;
    (entries || []).forEach(function (e) {
      if (!e || (opts.skipHidden && e.pdfHidden)) return;
      var d = e.date ? new Date(e.date) : (e.timestamp ? new Date(e.timestamp) : null);
      if (!d || isNaN(d.getTime())) return;
      var k = dayKey(d);
      var prev = byKey[k];
      var ts = e.recordedAt ? Date.parse(e.recordedAt) || e.timestamp || 0 : (e.timestamp || 0);
      if (prev && prev._ts > ts) return;
      var sleep = e.sleep != null && e.sleep !== '' && isFinite(Number(e.sleep)) ? Number(e.sleep) : null;
      // 🤏 Some (2026-10-25): `some` marks the day in the medication strip;
      // `dose` is "Quetiapine 100 mg (usual 200 mg)" when a dose changed.
      var dose = null;
      if (e.medSome && root.BBMeds && typeof root.BBMeds.someMarker === 'function') { try { dose = root.BBMeds.someMarker(e); } catch (_) {} }
      byKey[k] = {
        _ts: ts, cat: moodCat(e.mood), score: moodScore(e.mood), sleep: sleep,
        med: e.medication || null, auto: !!e.autoFilled, some: !!e.medSome, dose: dose
      };
      var ds = dayStart(d);
      if (!first || ds < first) first = ds;
    });
    var start = first || end;
    if (opts.minStart && dayStart(opts.minStart) < start) start = dayStart(opts.minStart);
    if (start > end) start = end;
    var days = [];
    var cur = new Date(start);
    while (cur <= end && days.length < 20000) {
      var k2 = dayKey(cur), r = byKey[k2];
      days.push({
        t: cur.getTime(), key: k2,
        cat: r ? r.cat : null, score: r ? r.score : null, sleep: r ? r.sleep : null,
        med: r ? r.med : null, auto: r ? r.auto : false,
        some: r ? r.some : false, dose: r ? r.dose : null
      });
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  /** Category used for pattern detection — auto-filled guesses don't count as a mood. */
  function warnCat(day) { return day && !day.auto ? day.cat : null; }

  /** Median sleep over the 30 days before index `beforeIdx` (needs ≥7 nights). */
  function sleepBaseline(days, beforeIdx) {
    var vals = [];
    for (var i = Math.max(0, beforeIdx - 30); i < beforeIdx; i++) if (days[i].sleep != null) vals.push(days[i].sleep);
    return vals.length >= 7 ? median(vals) : null;
  }
  /**
   * A night is "short" when it is ≥1.5h under the personal baseline, or under
   * 6h. The flat 6h rule is skipped for people whose own normal is itself
   * under 6.5h, so a naturally short sleeper isn't nudged every night.
   */
  function isShortNight(sleep, base) {
    if (sleep == null) return null;
    if (base != null) return sleep <= base - 1.5 || (base >= 6.5 && sleep < 6);
    return sleep < 6;
  }
  /** Short-sleep pattern ending at `endIdx`: 3+ short nights in the last 4. */
  function shortSleepAt(days, endIdx) {
    if (endIdx < 3) return null;
    var base = sleepBaseline(days, endIdx - 3);
    var logged = 0, short = 0, sum = 0;
    for (var i = endIdx - 3; i <= endIdx; i++) {
      var s = isShortNight(days[i].sleep, base);
      if (s === null) continue;
      logged++;
      if (s) { short++; sum += days[i].sleep; }
    }
    if (logged < 3 || short < 3) return null;
    return { n: short, avg: sum / short, base: base };
  }
  /** Outcome of the 7 days after `idx`: 'up' | 'down' | 'stable' | null (too few / mixed). */
  function weekAfter(days, idx) {
    var logged = 0, up = 0, down = 0, stable = 0;
    for (var i = idx + 1; i <= idx + 7 && i < days.length; i++) {
      var c = warnCat(days[i]);
      if (!c) continue;
      logged++;
      if (isUp(c)) up++; else if (isDown(c)) down++; else stable++;
    }
    if (logged < 4) return null;
    if (up / logged >= 0.5) return 'up';
    if (down / logged >= 0.5) return 'down';
    if (stable / logged >= 0.5) return 'stable';
    return null;
  }
  /** Run of consecutive days ending at `endIdx` whose category satisfies `pred`. */
  function runEndingAt(days, endIdx, pred) {
    var n = 0;
    for (var i = endIdx; i >= 0 && pred(warnCat(days[i])); i--) n++;
    return n;
  }
  /** Most recent earlier run (≥ minLen) of `pred` that ended before index `beforeIdx`. */
  function previousRun(days, beforeIdx, pred, minLen) {
    for (var i = beforeIdx; i >= 0; i--) {
      if (!pred(warnCat(days[i]))) continue;
      var len = runEndingAt(days, i, pred);
      if (len >= minLen) return len;
      i -= len - 1; // skip the whole (too short) run
    }
    return null;
  }

  /**
   * Evaluate the early-warning patterns on a contiguous day series.
   *
   * @param {Array<object>} days output of buildDays (last element = today)
   * @returns {Array<{id:string, vars:object, hist:?{key:string, vars?:object}}>}
   */
  function detectWarnings(days) {
    var out = [];
    if (!days || !days.length) return out;
    // Anchor on the latest logged day, and only if it is recent (today, yesterday
    // or the day before) — a nudge about a stretch weeks ago isn't useful.
    var anchor = -1;
    for (var a = days.length - 1; a >= Math.max(0, days.length - 3); a--) {
      if (days[a].cat || days[a].sleep != null) { anchor = a; break; }
    }
    if (anchor < 0) return out;

    // 1) Short sleep: 3+ of the last 4 nights.
    var ss = shortSleepAt(days, anchor);
    if (ss) {
      var w = { id: 'shortSleep', vars: { n: ss.n, avg: ss.avg, base: ss.base }, hist: null };
      // Personalise: the most recent past stretch whose following week is fully
      // in the past AND doesn't overlap the current 4-night window.
      for (var j = anchor - 11; j >= 3; j--) {
        if (!shortSleepAt(days, j)) continue;
        var o = weekAfter(days, j);
        if (o === 'up') w.hist = { key: 'histSleepUp' };
        else if (o === 'down') w.hist = { key: 'histSleepDown' };
        else if (o === 'stable') w.hist = { key: 'histSleepStable' };
        break; // only "the last time" — never older episodes
      }
      out.push(w);
    }

    // 2) Runs: 3+ days elevated/manic, or 5+ days low/depressed.
    var upRun = runEndingAt(days, anchor, isUp);
    if (upRun >= 3) {
      var pu = previousRun(days, anchor - upRun - 1, isUp, 3);
      out.push({ id: 'elevatedRun', vars: { n: upRun }, hist: pu ? { key: 'histRun', vars: { n: pu } } : null });
    }
    var downRun = runEndingAt(days, anchor, isDown);
    if (downRun >= 5) {
      var pd = previousRun(days, anchor - downRun - 1, isDown, 5);
      out.push({ id: 'lowRun', vars: { n: downRun }, hist: pd ? { key: 'histRun', vars: { n: pd } } : null });
    }

    // 3) Sharp swing: low/depressed ↔ elevated/manic within 2 days, ending on
    //    one of the two most recent days.
    var swing = null;
    for (var to = anchor; to >= anchor - 1 && to >= 1 && !swing; to--) {
      var ct = warnCat(days[to]);
      if (!isUp(ct) && !isDown(ct)) continue;
      for (var from = to - 1; from >= to - 2 && from >= 0; from--) {
        var cf = warnCat(days[from]);
        if ((isDown(cf) && isUp(ct)) || (isUp(cf) && isDown(ct))) { swing = { from: cf, to: ct }; break; }
      }
    }
    if (swing) out.push({ id: 'swing', vars: swing, hist: null });
    return out;
  }

  /** Filter out patterns shown within the throttle window. */
  function filterThrottled(warnings, seen, now) {
    seen = seen || {};
    return warnings.filter(function (w) { return !(seen[w.id] && now - seen[w.id] < THROTTLE_MS); });
  }

  // ── Storage helpers ───────────────────────────────────────────────────────
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function enabled() { return lsGet(SETTING_KEY) === 'true'; }
  function readSeen() { try { return JSON.parse(lsGet(SEEN_KEY) || '{}') || {}; } catch (_) { return {}; } }

  // ── Life chart (DOM) ──────────────────────────────────────────────────────
  // The chart's span is the journal's 1M / 3M / 6M / 1Y / All range, shared
  // with the stats above it (window.getJournalRangeDays in js/journal.js).
  // 90 days only if that isn't there (tests).
  function rangeDays() {
    try { if (typeof root.getJournalRangeDays === 'function') return Math.max(2, root.getJournalRangeDays() || 90); } catch (_) {}
    return 90;
  }
  var _range = 90;
  var _entries = [];
  var _days = [];
  var _px = 3;
  var LABEL_W = 60, RIGHT_W = 36, BLOOD_H = 22;
  var SOME_COLOR = '#e67700'; // 🤏 Some in the medication strip
  var LINE_KEY = 'bbBloodChartTest';
  var LINE_MIN_DAYS = 180; // 6M, 1Y and All
  var TOP = 6, MOOD_H = 120, MID = TOP + MOOD_H / 2, UNIT = (MOOD_H / 2) / 2.2;

  function yForDev(dev) { return MID - dev * UNIT; }

  function buildSvg(days, px, hasMeds, blood, doses) {
    var medsY = TOP + MOOD_H + 8, medsH = 6;
    var sleepTop = hasMeds ? medsY + medsH + 8 : TOP + MOOD_H + 10;
    // 🤏 A changed dose: a 💊 on its day in a row under the sleep bars, above
    // the blood results' row.
    var sleepH = 36, doseY = sleepTop + sleepH + 4 + BLOOD_H / 2;
    var bloodY = sleepTop + sleepH + 4 + (doses ? BLOOD_H : 0) + BLOOD_H / 2;
    var axisY = sleepTop + sleepH + 14 + (blood ? BLOOD_H : 0) + (doses ? BLOOD_H : 0), H = axisY + 4;
    var W = Math.max(1, Math.round(days.length * px));
    var gap = px > 5 ? 1 : 0;
    var bw = Math.max(px - gap, 0.8);
    var p = [];
    // Grid: faint bands for ±1 / ±2 and the stable baseline.
    [2, 1, -1, -2].forEach(function (d) {
      p.push('<line x1="0" x2="' + W + '" y1="' + yForDev(d) + '" y2="' + yForDev(d) + '" class="lc-grid"/>');
    });
    p.push('<line x1="0" x2="' + W + '" y1="' + MID + '" y2="' + MID + '" class="lc-base"/>');
    p.push('<line x1="0" x2="' + W + '" y1="' + (sleepTop + sleepH) + '" y2="' + (sleepTop + sleepH) + '" class="lc-grid"/>');
    // Personal median sleep as a dashed guide.
    var sl = days.map(function (d) { return d.sleep; }).filter(function (v) { return v != null; });
    var med = median(sl);
    if (med != null) {
      var my = sleepTop + sleepH - Math.min(med, 12) / 12 * sleepH;
      p.push('<line x1="0" x2="' + W + '" y1="' + my + '" y2="' + my + '" class="lc-sleepmed"/>');
    }
    var lg = lang();
    var lastLabelEnd = -Infinity;
    function axisLabel(x, text, cls) {
      // Rough width at 9px; skip a label that would collide with the previous one.
      var w = String(text).length * 5.4 + 4;
      if (x < lastLabelEnd) return;
      lastLabelEnd = x + w;
      p.push('<text x="' + x.toFixed(1) + '" y="' + axisY + '" class="' + cls + '">' + esc(text) + '</text>');
    }
    for (var i = 0; i < days.length; i++) {
      var d = days[i], x = (i * px).toFixed(2);
      var dt = new Date(d.t);
      // Axis: month starts (plus weekly day numbers on the 1M view). January
      // is labelled with the year when months are too narrow for "Jan 2026".
      if (dt.getDate() === 1) {
        p.push('<line x1="' + x + '" x2="' + x + '" y1="' + TOP + '" y2="' + (axisY - 9) + '" class="lc-month"/>');
        var ml = dt.getMonth() === 0
          ? (px * 31 < 60 ? String(dt.getFullYear()) : dt.toLocaleDateString(lg, { month: 'short' }) + ' ' + dt.getFullYear())
          : dt.toLocaleDateString(lg, { month: 'short' });
        axisLabel(+x + 2, ml, 'lc-axis');
      } else if (px >= 8 && dt.getDay() === 1) {
        axisLabel(+x + 1, dt.getDate(), 'lc-axis lc-axis-sm');
      }
      if (d.score != null && d.cat) {
        var dev = Math.max(-2.2, Math.min(2.2, d.score - 3));
        var col = MOOD_COLORS[d.cat] || '#adb5bd';
        var op = d.auto ? ' opacity="0.45"' : '';
        if (Math.abs(dev) < 0.2) {
          p.push('<rect x="' + x + '" y="' + (MID - 2) + '" width="' + bw + '" height="4" fill="' + col + '"' + op + '/>');
        } else {
          var y0 = yForDev(dev), top = Math.min(y0, MID), h = Math.abs(MID - y0);
          p.push('<rect x="' + x + '" y="' + top.toFixed(1) + '" width="' + bw + '" height="' + h.toFixed(1) + '" fill="' + col + '"' + op + '/>');
        }
      }
      if (hasMeds && d.some) {
        p.push('<rect class="lc-some" x="' + x + '" y="' + medsY + '" width="' + Math.max(bw, 1.5) + '" height="' + medsH + '" fill="' + SOME_COLOR + '"/>');
      } else if (hasMeds && (d.med === 'not-taken' || d.med === 'unsure')) {
        p.push('<rect x="' + x + '" y="' + medsY + '" width="' + Math.max(bw, 1.5) + '" height="' + medsH + '" fill="' + (d.med === 'unsure' ? '#adb5bd' : '#ff6b6b') + '"/>');
      }
      if (d.sleep != null) {
        var sh = Math.min(Math.max(d.sleep, 0), 12) / 12 * sleepH;
        p.push('<rect x="' + x + '" y="' + (sleepTop + sleepH - sh).toFixed(1) + '" width="' + bw + '" height="' + Math.max(sh, 0.5).toFixed(1) + '" fill="' + SLEEP_COLOR + '" opacity="0.75"/>');
      }
    }
    // One test's results as a thin line over the mood area, on its own scale,
    // with the person's range shaded.
    if (blood && blood.line) {
      var ln = blood.line, sc = ln.scale;
      var vy = function (v) { return TOP + (sc.hi - v) / (sc.hi - sc.lo) * MOOD_H; };
      if (ln.band) {
        var bt = vy(ln.band[1]), bb = vy(ln.band[0]);
        p.push('<rect class="lc-bband" x="0" width="' + W + '" y="' + bt.toFixed(1) + '" height="' + Math.max(1, bb - bt).toFixed(1) + '"/>');
      }
      var pts = ln.points.map(function (q) { return [(q.idx * px + px / 2), vy(q.value)]; });
      if (pts.length > 1) p.push('<polyline class="lc-bline" points="' + pts.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' ') + '"/>');
      pts.forEach(function (q) { p.push('<circle class="lc-bdot" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="2.6"/>'); });
    }
    p.push('<rect id="lcHl" x="-10" y="' + TOP + '" width="' + Math.max(px, 2) + '" height="' + (sleepTop + sleepH - TOP) + '" class="lc-hl"/>');
    return {
      svg: '<svg class="lc-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' + esc(tr('lifeChart.title')) + '">' + p.join('') + '</svg>',
      H: H, W: W, medsY: medsY, sleepTop: sleepTop, sleepH: sleepH, bloodY: bloodY, doseY: doseY
    };
  }

  function labelsHtml(g, hasMeds) {
    var L = [];
    function lab(y, text, cls) { L.push('<div class="lc-ylab ' + (cls || '') + '" style="top:' + (y - 6) + 'px">' + esc(text) + '</div>'); }
    lab(yForDev(2), moodName('manic'), 'lc-c-manic');
    lab(yForDev(1), moodName('elevated'), 'lc-c-elevated');
    lab(MID, tr('lifeChart.stable'), 'lc-c-stable');
    lab(yForDev(-1), moodName('low'), 'lc-c-low');
    lab(yForDev(-2), moodName('depressed'), 'lc-c-depressed');
    if (hasMeds) lab(g.medsY + 3, tr('lifeChart.meds'), 'lc-c-meds');
    lab(g.sleepTop + g.sleepH / 2, tr('lifeChart.sleep'), 'lc-c-sleep');
    if (g.doses) lab(g.doseY, sm('chartLabel'), 'lc-c-dose');
    if (g.blood) lab(g.bloodY, bt('chartLabel'), 'lc-c-blood');
    return '<div class="lc-ylabels" style="height:' + g.H + 'px">' + L.join('') + '</div>';
  }

  // ── Blood results on the chart (v358) ─────────────────────────────────────
  function meds() { return root.BBMeds && typeof root.BBMeds.chartData === 'function' ? root.BBMeds : null; }
  function bt(k, vars) { var M = meds(); return M ? M.tb(k, vars) : k; }
  /** What to draw: markers in the span, and (6M+) the line for one test. */
  function bloodLayer(days, range) {
    var M = meds(), data = null;
    try { data = M ? M.chartData() : null; } catch (_) {}
    if (!data || !days.length) return null;
    var first = days[0].key, last = days[days.length - 1].key;
    var idxOf = {};
    days.forEach(function (d, i) { idxOf[d.key] = i; });
    var marks = M.markersIn(data.levels, first, last).map(function (m) { m.idx = idxOf[m.date]; return m; })
      .filter(function (m) { return m.idx != null; });
    var out = { marks: marks, line: null, tests: [] };
    if (range >= LINE_MIN_DAYS && data.lineTests.length) {
      out.tests = data.lineTests.map(function (x) { return x.test; });
      var want = lsGet(LINE_KEY), s = null;
      data.lineTests.forEach(function (x) { if (!s && want && M.norm(x.test) === M.norm(want)) s = x; });
      s = s || data.lineTests[0];
      var plan = M.planOf(data.plans, s.test);
      var pts = s.points.filter(function (q) { return idxOf[q.date] != null; }).map(function (q) { return { idx: idxOf[q.date], value: q.value }; });
      if (pts.length) {
        out.line = {
          test: s.test, unit: s.unit, points: pts,
          scale: M.valueScale(s.points.map(function (q) { return q.value; }), plan),
          band: M.hasRange(plan) ? [Number(plan.low), Number(plan.high)] : null,
        };
      }
    }
    return out.marks.length || out.line ? out : null;
  }
  function rightLabelsHtml(g, line) {
    var sc = line.scale, L = [];
    var M = meds();
    [sc.hi - sc.pad, (sc.hi + sc.lo) / 2, sc.lo + sc.pad].forEach(function (v) {
      var y = TOP + (sc.hi - v) / (sc.hi - sc.lo) * MOOD_H;
      L.push('<div class="lc-rlab" style="top:' + (y - 6).toFixed(1) + 'px">' + esc(M ? M.fmtNum(v, 2) : String(v)) + '</div>');
    });
    return '<div class="lc-yright" style="height:' + g.H + 'px" aria-hidden="true">' + L.join('') + '</div>';
  }
  /** 🤏 The changed-dose markers: one 💊 per day, its text on tap / focus. */
  function sm(k, vars) {
    var full = 'medSome.' + k, v = null;
    try { if (root.BB && root.BB.t) v = root.BB.t(full, vars); } catch (_) {}
    return v == null ? full : v;
  }
  function doseMarks(days) {
    var out = [];
    days.forEach(function (d, i) { if (d.dose) out.push({ idx: i, key: d.key, text: d.dose }); });
    return out.length ? out : null;
  }
  function doseMarkersHtml(g, marks, px) {
    var lg = lang(), yr = new Date().getFullYear();
    return marks.map(function (m) {
      var dt = new Date(m.key + 'T12:00:00');
      var o = { day: 'numeric', month: 'short' };
      if (dt.getFullYear() !== yr) o.year = 'numeric';
      var label = sm('markerLabel', { text: m.text, date: dt.toLocaleDateString(lg, o) });
      var x = m.idx * px + px / 2;
      return '<button type="button" class="lc-blood lc-dose" data-date="' + m.key + '" style="left:' + (x - 11).toFixed(1) + 'px;top:' + (g.doseY - 11).toFixed(1) + 'px" aria-label="' + esc(label) + '" data-label="' + esc(label) + '">💊</button>';
    }).join('');
  }
  function markersHtml(g, blood, px) {
    var M = meds();
    return blood.marks.map(function (m, i) {
      var label = M.markerText(m);
      var x = m.idx * px + px / 2;
      return '<button type="button" class="lc-blood" data-i="' + i + '" data-date="' + m.date + '" data-test="' + esc(m.test) + '" style="left:' + (x - 11).toFixed(1) + 'px;top:' + (g.bloodY - 11).toFixed(1) + 'px" aria-label="' + esc(label) + '" data-label="' + esc(label) + '">🩸</button>';
    }).join('') + '<div class="lc-tip" role="tooltip" id="lcBloodTip" hidden></div>';
  }
  function wireMarkers(host) {
    var tip = host.querySelector('#lcBloodTip'), det = host.querySelector('.lc-detail');
    if (!tip) return;
    var plot = host.querySelector('.lc-plot');
    var show = function (b, announce) {
      tip.textContent = b.getAttribute('data-label');
      tip.hidden = false;
      var left = b.offsetLeft + 11, w = tip.offsetWidth, max = plot.offsetWidth;
      tip.style.left = Math.max(2, Math.min(max - w - 2, left - w / 2)) + 'px';
      tip.style.top = (b.offsetTop - tip.offsetHeight - 4) + 'px';
      b.setAttribute('aria-describedby', 'lcBloodTip');
      if (announce && det) det.textContent = b.getAttribute('data-label');
    };
    var hide = function () { tip.hidden = true; };
    Array.prototype.forEach.call(host.querySelectorAll('.lc-blood'), function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); show(b, true); });
      b.addEventListener('focus', function () { show(b, false); });
      b.addEventListener('blur', hide);
      b.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hide(); } });
    });
    var svg = host.querySelector('.lc-svg');
    if (svg) svg.addEventListener('click', hide);
  }

  function renderLifeChart(keepCentre) {
    var host = document.getElementById('lifeChart');
    if (!host) return;
    var logged = (_entries || []).filter(function (e) { return e && e.mood != null && e.mood !== ''; });
    if (logged.length < 2) { host.innerHTML = ''; host.style.display = 'none'; _lifeOk = false; applyView(); return; }
    host.style.display = '';
    // Show/hide via the switch BEFORE measuring, so a freshly chosen life
    // chart is laid out at its real width.
    _lifeOk = true;
    applyView();

    var oldScroller = host.querySelector('.lc-scroll');
    var centreT = null;
    // A hidden card (journal closed) measures 0 wide — then there is no
    // meaningful centre to keep, so fall back to showing the newest days.
    // Viewing the newest days (scrolled to the right edge) stays anchored there
    // when the range changes; otherwise the day in the middle stays in the middle.
    if (keepCentre && oldScroller && oldScroller.clientWidth > 0 && _days.length &&
        oldScroller.scrollLeft + oldScroller.clientWidth < oldScroller.scrollWidth - 4) {
      var ci = Math.floor((oldScroller.scrollLeft + oldScroller.clientWidth / 2) / _px);
      if (_days[ci]) centreT = _days[ci].t;
    }

    _range = rangeDays();
    var today = dayStart(new Date());
    var minStart = new Date(today); minStart.setDate(minStart.getDate() - (_range - 1));
    _days = buildDays(_entries, { minStart: minStart });
    var hasMeds = _days.some(function (d) { return d.med != null; });
    var blood = null;
    try { blood = bloodLayer(_days, _range); } catch (e) { try { console.warn('life chart blood', e); } catch (_) {} }
    var doses = doseMarks(_days);
    var hasSome = _days.some(function (d) { return d.some; });

    // Width available to the plot: card width minus the fixed label column(s).
    var avail = Math.max(160, (host.clientWidth || 320) - LABEL_W - (blood && blood.line ? RIGHT_W : 0));
    _px = avail / _range;
    var g = buildSvg(_days, _px, hasMeds, blood, doses);
    g.blood = !!blood;
    g.doses = !!doses;

    var legend =
      '<span class="lc-key"><i style="background:' + MOOD_COLORS.elevated + '"></i><i style="background:' + MOOD_COLORS.manic + '"></i>' + esc(moodName('elevated')) + ' / ' + esc(moodName('manic')) + '</span>' +
      '<span class="lc-key"><i style="background:' + MOOD_COLORS.low + '"></i><i style="background:' + MOOD_COLORS.depressed + '"></i>' + esc(moodName('low')) + ' / ' + esc(moodName('depressed')) + '</span>' +
      '<span class="lc-key"><i style="background:' + SLEEP_COLOR + '"></i>' + esc(tr('lifeChart.legendSleep')) + '</span>' +
      (hasMeds ? '<span class="lc-key"><i style="background:#ff6b6b"></i>' + esc(tr('lifeChart.legendMeds')) + '</span>' : '') +
      (hasMeds && hasSome ? '<span class="lc-key"><i style="background:' + SOME_COLOR + '"></i>' + esc(sm('legend')) + '</span>' : '') +
      (doses ? '<span class="lc-key"><span aria-hidden="true">💊</span>' + esc(sm('legendDose')) + '</span>' : '') +
      (blood && blood.marks.length ? '<span class="lc-key"><span aria-hidden="true">🩸</span>' + esc(bt('legendMarker')) + '</span>' : '') +
      (blood && blood.line ? '<span class="lc-key"><i class="lc-key-line"></i>' + esc(bt('legendLine', { test: blood.line.test, unit: blood.line.unit || '' }).replace(' ()', '')) + '</span>' : '') +
      (blood && blood.line && blood.line.band ? '<span class="lc-key"><i class="lc-key-band"></i>' + esc(bt('legendRange')) + '</span>' : '') +
      '<span class="lc-key lc-key-gap">' + esc(tr('lifeChart.legendGap')) + '</span>';
    var M = meds();
    var picker = blood && blood.line && blood.tests.length > 1 ?
      '<label class="lc-bpick"><span>' + esc(bt('lineLabel')) + '</span><select id="lcBloodPick">' + blood.tests.map(function (x) {
        return '<option value="' + esc(x) + '"' + (M.norm(x) === M.norm(blood.line.test) ? ' selected' : '') + '>' + esc(x) + '</option>';
      }).join('') + '</select></label>' : '';
    var plotInner = (doses ? doseMarkersHtml(g, doses, _px) : '') + (blood && blood.marks.length ? markersHtml(g, blood, _px) : '');
    if (doses && !(blood && blood.marks.length)) plotInner += '<div class="lc-tip" role="tooltip" id="lcBloodTip" hidden></div>';

    host.innerHTML =
      '<div class="lc-head">' +
        '<div class="lc-title">' + esc(tr('lifeChart.title')) + '</div>' + picker +
      '</div>' +
      '<div class="lc-sub">' + esc(tr('lifeChart.subtitle')) + '</div>' +
      '<div class="lc-frame">' + labelsHtml(g, hasMeds) +
        // The scroller in a frame that shows when there is more chart either
        // side (James, 2026-10-04): an edge fade and a ‹ / › to step through.
        '<div class="lc-scrollwrap">' +
          '<div class="lc-scroll" tabindex="0"><div class="lc-plot" data-first="' + (_days.length ? _days[0].key : '') + '" data-px="' + _px + '" style="width:' + g.W + 'px;height:' + g.H + 'px">' + g.svg + plotInner + '</div></div>' +
          '<button type="button" class="lc-nudge lc-nudge-l" data-dir="-1" aria-label="' + esc(tr('lifeChart.earlier')) + '">‹</button>' +
          '<button type="button" class="lc-nudge lc-nudge-r" data-dir="1" aria-label="' + esc(tr('lifeChart.later')) + '">›</button>' +
        '</div>' + (blood && blood.line ? rightLabelsHtml(g, blood.line) : '') +
      '</div>' +
      '<div class="lc-detail" aria-live="polite">' + esc(tr('lifeChart.tapHint')) + '</div>' +
      '<div class="lc-legend">' + legend + '</div>';

    var scroller = host.querySelector('.lc-scroll');
    var targetIdx = _days.length;
    if (centreT != null) {
      for (var i = 0; i < _days.length; i++) if (_days[i].t >= centreT) { targetIdx = i; break; }
      scroller.scrollLeft = Math.max(0, targetIdx * _px - scroller.clientWidth / 2);
    } else {
      scroller.scrollLeft = scroller.scrollWidth; // newest at the right edge
    }
    wireChart(host, scroller);
    if ((blood && blood.marks.length) || doses) wireMarkers(host);
    var pk = host.querySelector('#lcBloodPick');
    if (pk) pk.addEventListener('change', function () { lsSet(LINE_KEY, pk.value); renderLifeChart(true); });

    // More-chart cues: the fade and ‹ / › show on a side only while there is
    // more to scroll that way, and hide at either end.
    var wrap = host.querySelector('.lc-scrollwrap');
    var edges = function () {
      var max = scroller.scrollWidth - scroller.clientWidth;
      wrap.classList.toggle('can-l', scroller.scrollLeft > 4);
      wrap.classList.toggle('can-r', scroller.scrollLeft < max - 4);
    };
    scroller.addEventListener('scroll', edges, { passive: true });
    Array.prototype.forEach.call(host.querySelectorAll('.lc-nudge'), function (b) {
      b.addEventListener('click', function () {
        scroller.scrollBy({ left: Number(b.getAttribute('data-dir')) * scroller.clientWidth * 0.8, behavior: 'smooth' });
      });
    });
    edges();
    requestAnimationFrame(edges);
  }

  // ── Calendar / life chart switch ────────────────────────────────────────
  // One view at a time under the stats (#calViewSwitch in journal.html). One
  // tap switches; a DOUBLE tap (double-click) on a choice makes it the default
  // for next time — the suite's gesture, the same as every UNI·SIM app's
  // useDefaultView in @unisim/sdk (Bipolar Bear has no SDK, so it is redone
  // here): a second tap on the same button within 350 ms, a pop, and the
  // default drawn orange (filled while it is showing, outlined while it is
  // not). James, 2026-10-09; it replaced "tap the choice already showing"
  // (2026-09-30). The default is per device (localStorage bbJournalView,
  // unchanged, so defaults saved before carry over). With fewer than two
  // logged moods there is no life chart, so the switch hides and the calendar
  // shows. Hiding is by class on #statsAndCalendarBlock (css/journal.css), so
  // it never fights the inline display journal.js sets on #chart.
  var VIEW_KEY = 'bbJournalView';
  var DOUBLE_TAP_MS = 350;
  var _view = null;      // the view showing; read from the default on first use
  var _lifeOk = false;   // enough entries for a life chart
  var _viewNote = '';    // one-off confirmation after a default is set
  var _lastTap = null;   // { view, at } — the previous tap, for the double tap
  var _popView = null;   // the button to pop on the next render

  /** The view saved as the default, or null when none has been chosen. */
  function savedView() {
    var v = null;
    try { v = localStorage.getItem(VIEW_KEY); } catch (_) {}
    return v === 'life' || v === 'calendar' ? v : null;
  }
  function storedView() { return savedView() || 'calendar'; }

  /** True when this tap is the second of a double tap on the same view. */
  function isDoubleTap(v) {
    var now = Date.now();
    var prev = _lastTap;
    _lastTap = { view: v, at: now };
    if (!prev || prev.view !== v || now - prev.at >= DOUBLE_TAP_MS) return false;
    _lastTap = null;
    return true;
  }

  function coarsePointer() {
    try { return !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches); } catch (_) { return false; }
  }

  function applyView() {
    var block = document.getElementById('statsAndCalendarBlock');
    var sw = document.getElementById('calViewSwitch');
    if (!block || !sw) return;
    if (_view == null) _view = storedView();
    var view = _lifeOk ? _view : 'calendar';
    block.classList.toggle('cv-life', view === 'life');
    if (!_lifeOk) { sw.style.display = 'none'; sw.innerHTML = ''; return; }
    sw.style.display = '';
    var saved = savedView();
    var hint = tr(coarsePointer() ? 'lifeChart.viewTapAgain' : 'lifeChart.viewClickAgain');
    var opt = function (v, key) {
      var on = v === view;
      var isDef = v === saved;
      return '<button type="button" class="cv-opt' + (on ? ' on' : '') + (v === _popView ? ' cv-pop' : '') + '" data-view="' + v + '" aria-pressed="' + on + '"' +
        (isDef ? ' data-default-view="true"' : '') +
        ' title="' + esc(isDef ? tr('lifeChart.viewDefault') : hint) + '">' +
        esc(tr('lifeChart.' + key)) + '</button>';
    };
    var note = _viewNote || (view !== storedView() ? hint : '');
    sw.innerHTML =
      '<div class="cv-seg" role="group" aria-label="' + esc(tr('lifeChart.viewLabel')) + '">' +
        opt('calendar', 'viewCalendar') + opt('life', 'viewLife') +
      '</div>' +
      '<div class="cv-note" aria-live="polite">' + esc(note) + '</div>';
    _popView = null;
    sw.querySelectorAll('.cv-opt').forEach(function (b) {
      b.addEventListener('click', function () { pickView(b.getAttribute('data-view')); });
    });
  }

  function pickView(v) {
    _viewNote = '';
    if (isDoubleTap(v)) {
      try { localStorage.setItem(VIEW_KEY, v); } catch (_) {}
      _viewNote = tr('lifeChart.viewNowDefault');
      _popView = v;
    }
    if (v === _view) { applyView(); return; }
    _view = v;
    if (v === 'life') renderLifeChart(false); // it was hidden, so re-measure (calls applyView)
    else applyView();
  }

  // Pinch / ctrl-wheel / arrow-key zoom steps the shared range, which
  // redraws the stats too and calls rangeChanged() back.
  function stepRange(dir) {
    if (typeof root.stepJournalRange === 'function') root.stepJournalRange(dir);
  }
  function rangeChanged() { if (_entries.length) renderLifeChart(true); }

  function showDay(host, idx) {
    var d = _days[idx];
    var det = host.querySelector('.lc-detail');
    var hl = host.querySelector('#lcHl');
    if (!d || !det) return;
    if (hl) hl.setAttribute('x', (idx * _px).toFixed(2));
    var date = new Date(d.t).toLocaleDateString(lang(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (!d.cat && d.sleep == null) { det.textContent = tr('lifeChart.dayNoEntry', { date: date }); return; }
    var bits = [];
    if (d.cat) bits.push(moodName(d.cat));
    if (d.sleep != null) bits.push(tr('lifeChart.sleepHours', { h: fmtNum(d.sleep) }));
    if (d.some) bits.push(d.dose ? sm('detailLabel', { list: d.dose }) : sm('legendShort'));
    else if (d.med === 'not-taken') bits.push(tr('lifeChart.medsMissed'));
    if (d.med === 'unsure') bits.push(tr('lifeChart.medsUnsure'));
    if (d.auto) bits.push(tr('lifeChart.autoFilled'));
    det.textContent = date + ': ' + bits.join(' · ');
  }

  function wireChart(host, scroller) {
    var svg = scroller.querySelector('svg');
    var downX = null;
    svg.addEventListener('pointerdown', function (e) { downX = e.clientX; });
    svg.addEventListener('click', function (e) {
      if (downX != null && Math.abs(e.clientX - downX) > 6) return; // was a swipe
      var rect = svg.getBoundingClientRect();
      showDay(host, Math.floor((e.clientX - rect.left) / _px));
    });
    // Pinch (touch) and ctrl/⌘-wheel (trackpad pinch) step between ranges.
    var pinch = null;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
    scroller.addEventListener('touchstart', function (e) {
      pinch = e.touches.length === 2 ? { d0: dist(e.touches), done: false } : null;
    }, { passive: true });
    scroller.addEventListener('touchmove', function (e) {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      if (pinch.done) return;
      var ratio = dist(e.touches) / pinch.d0;
      if (ratio > 1.3) { pinch.done = true; stepRange(-1); }
      else if (ratio < 0.77) { pinch.done = true; stepRange(1); }
    }, { passive: false });
    scroller.addEventListener('touchend', function () { pinch = null; }, { passive: true });
    var wheelLock = 0;
    scroller.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      var now = Date.now();
      if (now - wheelLock < 350) return;
      wheelLock = now;
      stepRange(e.deltaY < 0 ? -1 : 1);
    }, { passive: false });
    scroller.addEventListener('keydown', function (e) {
      if (e.key === '+' || e.key === '=') stepRange(-1);
      else if (e.key === '-') stepRange(1);
    });
  }

  // ── Early-warning card ────────────────────────────────────────────────────
  var _pendingCheck = false;
  var _statsOpenPending = false;

  function messageFor(w) {
    var v = w.vars || {};
    if (w.id === 'shortSleep') {
      return v.base != null
        ? tr('earlyWarn.shortSleep', { n: v.n, avg: fmtNum(v.avg), base: fmtNum(v.base) })
        : tr('earlyWarn.shortSleepNoBase', { n: v.n });
    }
    if (w.id === 'elevatedRun') return tr('earlyWarn.elevatedRun', { n: v.n });
    if (w.id === 'lowRun') return tr('earlyWarn.lowRun', { n: v.n });
    if (w.id === 'swing') return tr('earlyWarn.swing', { from: moodName(v.from), to: moodName(v.to) });
    return '';
  }

  function showCard(warnings) {
    var slot = document.getElementById('earlyWarnSlot');
    if (!slot || !warnings.length) return;
    var items = warnings.map(function (w) {
      var hist = w.hist ? '<div class="ew-hist">' + esc(tr('earlyWarn.' + w.hist.key, w.hist.vars)) + '</div>' : '';
      return '<li data-ew="' + esc(w.id) + '"><div>' + esc(messageFor(w)) + '</div>' + hist + '</li>';
    }).join('');
    slot.innerHTML =
      '<div class="ew-card" role="status">' +
        '<button type="button" class="ew-close" aria-label="' + esc(tr('earlyWarn.dismiss')) + '" title="' + esc(tr('earlyWarn.dismiss')) + '">×</button>' +
        '<div class="ew-title">' + esc(tr('earlyWarn.cardTitle')) + '</div>' +
        '<ul class="ew-list">' + items + '</ul>' +
        '<a class="ew-strat" href="survival-kit.html#coping-strategies">' + esc(tr('earlyWarn.strategies')) + '</a>' +
        '<div class="ew-care">' + esc(tr('earlyWarn.careTeam')) + ' <a href="survival-kit.html#help" class="ew-help">' + esc(tr('earlyWarn.help')) + '</a></div>' +
        '<div class="ew-device">' + esc(tr('earlyWarn.onDevice')) + '</div>' +
      '</div>';
    var seen = readSeen(), now = Date.now();
    warnings.forEach(function (w) { seen[w.id] = now; });
    lsSet(SEEN_KEY, JSON.stringify(seen));
    slot.querySelector('.ew-close').addEventListener('click', function () { slot.innerHTML = ''; });
    // Same navigation style as the journal's own survival-kit button.
    slot.querySelector('.ew-strat').addEventListener('click', function (e) {
      e.preventDefault(); location.replace('survival-kit.html#coping-strategies');
    });
    slot.querySelector('.ew-help').addEventListener('click', function (e) {
      if (typeof root.openChatModal === 'function' && document.getElementById('chatModal')) {
        e.preventDefault(); root.openChatModal();
      } else {
        e.preventDefault(); location.replace('survival-kit.html#help');
      }
    });
  }

  function checkWarnings() {
    if (!enabled()) return;
    var ws = filterThrottled(detectWarnings(buildDays(_entries)), readSeen(), Date.now());
    if (ws.length) showCard(ws);
  }

  // ── Settings row ──────────────────────────────────────────────────────────
  function renderSettingRow() {
    var host = document.getElementById('earlyWarnSettingRow');
    if (!host || host.dataset.rendered) return;
    host.dataset.rendered = '1';
    host.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
        '<div>' +
          '<div style="font-weight:600;color:#495057;font-size:0.95em;">' + esc(tr('earlyWarn.settingTitle')) + '</div>' +
          '<div style="color:var(--text-muted-ink);font-size:0.82em;margin-top:2px;">' + esc(tr('earlyWarn.settingDesc')) + '</div>' +
        '</div>' +
        '<label class="bb-switch"><input type="checkbox" id="earlyWarnToggle"><span class="bb-slider"></span></label>' +
      '</div>';
    var chk = host.querySelector('#earlyWarnToggle');
    chk.checked = enabled();
    chk.addEventListener('change', function () {
      var on = !!chk.checked;
      lsSet(SETTING_KEY, on ? 'true' : 'false');
      if (root.db && root.currentUser) {
        root.db.collection('userSettings').doc(root.currentUser.uid).set({ earlyWarnEnabled: on }, { merge: true }).catch(function () {});
      }
      if (!on) { var slot = document.getElementById('earlyWarnSlot'); if (slot) slot.innerHTML = ''; }
    });
  }
  function syncSettingUI() {
    renderSettingRow();
    var chk = document.getElementById('earlyWarnToggle');
    if (chk) chk.checked = enabled();
  }

  // ── PDF (jsPDF, mm units) ─────────────────────────────────────────────────
  /**
   * Draw the last 90 days as a life chart into a jsPDF document. Entries marked
   * "hide from PDF" are left out (drawn as gaps), matching the entry list.
   *
   * @returns {number} the y position below the chart
   */
  function drawLifeChartPdf(doc, entries, o) {
    try {
      var end = dayStart(new Date());
      var start = new Date(end); start.setDate(start.getDate() - 89);
      var all = buildDays(entries, { skipHidden: true, minStart: start });
      var days = all.filter(function (d) { return d.t >= start.getTime(); });
      if (days.filter(function (d) { return d.cat; }).length < 7) return o.y;
      var margin = o.margin, pageW = o.pageW, pageH = o.pageH, y = o.y;
      var boxH = 74;
      if (o.newPage || y > pageH - boxH - 10) { doc.addPage(); y = margin; }
      doc.setDrawColor(220, 220, 220); doc.setFillColor(255, 255, 255);
      doc.roundedRect(margin, y, pageW - margin * 2, boxH, 2, 2, 'FD');
      var ty = y + 6;
      doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(60, 60, 60);
      doc.text(tr('lifeChart.pdfTitle').toUpperCase(), margin + 4, ty);
      doc.setDrawColor(255, 149, 0); doc.setLineWidth(0.4);
      doc.line(margin + 4, ty + 1, pageW - margin - 4, ty + 1);

      var labW = 18, cx = margin + 4 + labW, cw = pageW - margin * 2 - 8 - labW;
      var px = cw / days.length;
      var mTop = ty + 5, mH = 30, mid = mTop + mH / 2, unit = (mH / 2) / 2.2;
      var hasMeds = days.some(function (d) { return d.med != null; });
      var medsY = mTop + mH + 2, medsH = 1.6;
      var sTop = medsY + medsH + 2.5, sH = 12;
      // grid + labels
      doc.setLineWidth(0.1); doc.setDrawColor(230, 230, 230);
      [2, 1, -1, -2].forEach(function (d) { doc.line(cx, mid - d * unit, cx + cw, mid - d * unit); });
      doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.25);
      doc.line(cx, mid, cx + cw, mid);
      doc.setFontSize(5.5); doc.setFont(undefined, 'normal');
      [[2, 'manic'], [1, 'elevated'], [0, null], [-1, 'low'], [-2, 'depressed']].forEach(function (r) {
        var c = r[1] ? PDF_MOOD_RGB[r[1]] : PDF_MOOD_RGB.stable;
        doc.setTextColor(c[0], c[1], c[2]);
        doc.text(r[1] ? moodName(r[1]) : tr('lifeChart.stable'), cx - 1.5, mid - r[0] * unit + 1.5, { align: 'right' });
      });
      doc.setTextColor(100, 149, 237);
      doc.text(tr('lifeChart.sleep'), cx - 1.5, sTop + sH / 2 + 1.5, { align: 'right' });
      if (hasMeds) { doc.setTextColor(200, 80, 80); doc.text(tr('lifeChart.meds'), cx - 1.5, medsY + 1.6, { align: 'right' }); }
      doc.setDrawColor(230, 230, 230); doc.setLineWidth(0.1);
      doc.line(cx, sTop + sH, cx + cw, sTop + sH);

      var bw = Math.max(px - 0.25, 0.3);
      var lg = lang();
      days.forEach(function (d, i) {
        var x = cx + i * px;
        var dt = new Date(d.t);
        if (dt.getDate() === 1 || i === 0) {
          doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.1);
          if (dt.getDate() === 1) doc.line(x, mTop, x, sTop + sH);
          doc.setFontSize(5.5); doc.setTextColor(120, 120, 120);
          doc.text(dt.toLocaleDateString(lg, { day: 'numeric', month: 'short' }), x + 0.5, sTop + sH + 4);
        }
        if (d.cat && d.score != null) {
          var c = PDF_MOOD_RGB[d.cat] || [150, 150, 150];
          doc.setFillColor(c[0], c[1], c[2]);
          var dev = Math.max(-2.2, Math.min(2.2, d.score - 3));
          if (Math.abs(dev) < 0.2) doc.rect(x, mid - 0.6, bw, 1.2, 'F');
          else { var yy = mid - dev * unit; doc.rect(x, Math.min(yy, mid), bw, Math.abs(mid - yy), 'F'); }
        }
        if (hasMeds && d.some) {
          doc.setFillColor(230, 119, 0);
          if (d.dose) doc.rect(x, medsY - 1, Math.max(bw, 0.6), medsH + 1, 'F');
          else doc.rect(x, medsY, Math.max(bw, 0.5), medsH, 'F');
        } else if (hasMeds && (d.med === 'not-taken' || d.med === 'unsure')) {
          if (d.med === 'unsure') doc.setFillColor(173, 181, 189); else doc.setFillColor(255, 107, 107);
          doc.rect(x, medsY, Math.max(bw, 0.5), medsH, 'F');
        }
        if (d.sleep != null) {
          var h = Math.min(Math.max(d.sleep, 0), 12) / 12 * sH;
          doc.setFillColor(100, 149, 237);
          doc.rect(x, sTop + sH - h, bw, Math.max(h, 0.2), 'F');
        }
      });
      doc.setFontSize(5.5); doc.setTextColor(120, 120, 120); doc.setFont(undefined, 'normal');
      var someDays = days.some(function (d) { return d.some; });
      var note = doc.splitTextToSize(tr('lifeChart.pdfNote') + (someDays ? ' ' + sm('pdfNote') : ''), pageW - margin * 2 - 8);
      doc.text(note, margin + 4, sTop + sH + 9);
      return y + boxH + 4;
    } catch (e) {
      try { console.warn('life chart PDF skipped', e); } catch (_) {}
      return o.y;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────
  function render(entries) {
    _entries = Array.isArray(entries) ? entries : [];
    try { renderLifeChart(false); } catch (e) { try { console.warn('life chart failed', e); } catch (_) {} }
    if (_pendingCheck || _statsOpenPending) {
      _pendingCheck = false; _statsOpenPending = false;
      try { checkWarnings(); } catch (e) { try { console.warn('early warning check failed', e); } catch (_) {} }
    }
  }
  function noteSaved() { _pendingCheck = true; }
  function onStatsOpen() {
    try {
      if (_entries.length) checkWarnings(); else _statsOpenPending = true;
      // The card was hidden when the chart first rendered, so it measured the
      // wrong width — redraw now it is visible, scrolled to the newest days.
      renderLifeChart(false);
    } catch (e) {}
  }

  var api = {
    render: render,
    noteSaved: noteSaved,
    onStatsOpen: onStatsOpen,
    rangeChanged: rangeChanged,
    syncSettingUI: syncSettingUI,
    drawLifeChartPdf: drawLifeChartPdf,
    // pure helpers, exposed for tests
    _pure: {
      moodCat: moodCat, moodScore: moodScore, buildDays: buildDays, median: median,
      isShortNight: isShortNight, shortSleepAt: shortSleepAt, weekAfter: weekAfter,
      runEndingAt: runEndingAt, previousRun: previousRun,
      detectWarnings: detectWarnings, filterThrottled: filterThrottled, EN: EN
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.BBInsights = api;
    var boot = function () { try { renderSettingRow(); } catch (_) {} };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    // Re-measure on rotation / resize so the visible range still fits.
    // The Settings tick, a new / deleted result, a new range: redraw.
    ['bb:bloodcharts', 'bb:bloodchange', 'bb:secure-sync'].forEach(function (ev) {
      window.addEventListener(ev, function () { try { if (_entries.length) renderLifeChart(true); } catch (_) {} });
    });
    var rz = null;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () { try { if (_entries.length) renderLifeChart(true); } catch (_) {} }, 200);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
