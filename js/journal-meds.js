/**
 * Per-medicine tracking and the before / after comparison (1.44).
 *
 * Loaded on journal.html after js/journal.js and js/journal-insights.js. It
 * reads only the decrypted entry list journal.js hands it
 * (`BBMeds.setEntries(entries)` from loadEntries()) and the device copies
 * of the medicine lists; the account copies go through js/shared/secure-store.js
 * (BB.medHistory, BB.medLog), encrypted like `currentMedList`.
 *
 * Data model
 * ----------
 * An entry keeps `medication` ('taken' | 'not-taken' | 'unsure'), the one
 * answer for the whole day that every older build reads and writes, and now
 * also `medDoses: { "<medicine name>": "taken" | "missed" }` for the
 * medicines on the list that day. A day saved by an older build has no
 * `medDoses`: `dosesOf()` reads it as the single answer for every medicine
 * ("migrate on read"); nothing is rewritten, so nothing is lost. A new day
 * still gets `medication` (all taken → 'taken', any missed → 'not-taken').
 *
 * Side effects, blood levels and changes from before the medicine history
 * began live in BB.medLog (medSideEffects / medBloodLevels / medPastChanges).
 *
 * The comparison (James, 2026-10-17): pick a change to the medicines; the
 * journal before it is set beside the same number of days after it (at most
 * 90). Each side needs at least 21 logged days; auto-filled days don't count.
 * Other medicine changes inside either window are named. It is framed as
 * patterns in the person's own journal, not proof.
 *
 * The pure helpers are exported (module.exports under Node) for
 * scripts/test-med-tracking.mjs.
 *
 * @file js/journal-meds.js
 */
(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var MIN_DAYS = 21;
  var MAX_WINDOW = 90;
  var CATS = ['manic', 'elevated', 'stable', 'low', 'depressed'];
  var MOOD_COLORS = { manic: '#ff6b6b', elevated: '#d2be00', stable: '#51cf66', low: '#845ef7', depressed: '#5c7cfa' };
  var PDF_MOOD_RGB = { manic: [255, 68, 68], elevated: [255, 149, 0], stable: [81, 207, 102], low: [132, 94, 247], depressed: [92, 124, 250] };
  var TAB_KEY = 'bbMedsHubTab';
  var COMPARE_KEY = 'bbMedsCompareKey';

  // ── small helpers ──────────────────────────────────────────────────────────
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromKey(k) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0) : null;
  }
  function addDays(k, n) { var d = fromKey(k); d.setDate(d.getDate() + n); return dayKey(d); }
  /** Whole days from key a to key b (b − a). */
  function diffDays(a, b) { return Math.round((fromKey(b) - fromKey(a)) / DAY_MS); }
  function entryDay(e) {
    if (!e) return null;
    var d = e.date ? new Date(e.date) : (e.timestamp ? new Date(e.timestamp) : null);
    return d && !isNaN(d.getTime()) ? dayKey(d) : null;
  }
  function isNum(v) { return v != null && v !== '' && isFinite(Number(v)); }
  function moodCat(m) {
    if (m == null || m === '') return null;
    if (!isNum(m)) return m === 'good' ? 'stable' : (PDF_MOOD_RGB[m] ? m : null);
    var n = Number(m);
    if (n <= 1) return 'depressed';
    if (n <= 3) return 'low';
    if (n <= 6) return 'stable';
    if (n <= 8) return 'elevated';
    return 'manic';
  }
  function medList(v) {
    return (Array.isArray(v) ? v : []).filter(function (m) { return m && typeof m === 'object' && String(m.name == null ? '' : m.name).trim(); })
      .map(function (m) { return { name: String(m.name).trim(), dosage: String(m.dosage == null ? '' : m.dosage).trim() }; });
  }

  // ── a day's doses ───────────────────────────────────────────────────────────
  var STATUSES = { taken: 1, 'not-taken': 1, unsure: 1 };
  /** 'taken' when every medicine was taken, 'not-taken' when any was missed. */
  function aggregate(per) {
    var names = Object.keys(per || {});
    if (!names.length) return null;
    return names.some(function (n) { return per[n] === 'missed'; }) ? 'not-taken' : 'taken';
  }
  /**
   * What an entry says about medication, whichever build saved it.
   * → {status: 'taken'|'not-taken'|'unsure'|null, perMed: {name: 'taken'|'missed'}|null}
   * A day with only the old single answer has perMed null: that answer
   * stands for all the medicines that day.
   */
  function dosesOf(e) {
    var status = e && STATUSES[e.medication] ? e.medication : null;
    var per = null;
    var md = e && e.medDoses;
    if (md && typeof md === 'object' && !Array.isArray(md)) {
      Object.keys(md).forEach(function (n) {
        var v = md[n];
        if ((v === 'taken' || v === 'missed') && String(n).trim()) { per = per || {}; per[n] = v; }
      });
    }
    if (per && !status) status = aggregate(per);
    return { status: status, perMed: per };
  }
  /**
   * The per-medicine record for an answer. `names`: the medicines that day;
   * `prev`: what was already chosen (kept for "not taken", where the person
   * picks which). Taken → all taken; not taken → the ones already marked,
   * the rest missed; unsure / no answer / no medicines → null.
   */
  function dosesForAnswer(answer, names, prev) {
    names = (names || []).filter(function (n) { return String(n).trim(); });
    if (!names.length || (answer !== 'taken' && answer !== 'not-taken')) return null;
    var out = {};
    var p = {};
    Object.keys(prev || {}).forEach(function (k) { p[norm(k)] = prev[k]; });
    names.forEach(function (n) {
      if (answer === 'taken') out[n] = 'taken';
      else out[n] = p[norm(n)] === 'taken' ? 'taken' : 'missed';
    });
    // "Not taken" with every medicine ticked as taken isn't a real answer:
    // treat it as all missed.
    if (answer === 'not-taken' && aggregate(out) === 'taken') names.forEach(function (n) { out[n] = 'missed'; });
    return out;
  }
  function namesWith(per, v) { return Object.keys(per || {}).filter(function (n) { return per[n] === v; }); }

  // ── the medicine list on a past day ─────────────────────────────────────────
  /** medHistory + typed-in past changes as one list of dated events. */
  function allEvents(history, past) {
    var out = [];
    (Array.isArray(history) ? history : []).forEach(function (e) {
      if (!e || typeof e.at !== 'string' || !e.type || typeof e.name !== 'string') return;
      var d = new Date(e.at);
      if (isNaN(d.getTime())) return;
      out.push({ key: 'h:' + e.at + '|' + e.type + '|' + norm(e.name), at: e.at, day: dayKey(d), type: e.type, name: e.name, from: e.from, to: e.to, source: e.source || 'user' });
    });
    (Array.isArray(past) ? past : []).forEach(function (p) {
      if (!p || p.deleted || !fromKey(p.date) || !p.type || !p.name) return;
      out.push({ key: 'p:' + p.id, id: p.id, at: fromKey(p.date).toISOString(), day: p.date, type: p.type, name: p.name, from: p.from, to: p.to, source: 'user', manual: true });
    });
    out.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    return out;
  }
  /**
   * The medicine list as it was at the end of day `key`: the current list
   * with every later change undone, newest first. Before the history starts
   * it is the earliest list known.
   */
  function listOnDay(events, currentList, key) {
    var list = medList(currentList);
    var evs = (events || []).slice().sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e.day <= key) break;
      var at = -1;
      for (var j = 0; j < list.length; j++) if (norm(list[j].name) === norm(e.type === 'rename' ? e.to : e.name)) { at = j; break; }
      if (e.type === 'add') { if (at >= 0) list.splice(at, 1); }
      else if (e.type === 'stop') { if (at < 0) list.push({ name: e.name, dosage: e.from || '' }); }
      else if (e.type === 'dose') { if (at >= 0) list[at].dosage = e.from || ''; }
      else if (e.type === 'rename') { if (at >= 0) list[at].name = e.from || list[at].name; }
    }
    return list;
  }
  /** Changes that can be compared: started, stopped or a new dose. Newest first. */
  function changeEvents(events) {
    return (events || []).filter(function (e) {
      return (e.type === 'add' || e.type === 'stop' || e.type === 'dose') && e.source !== 'import';
    }).slice().reverse();
  }

  // ── adherence and missed doses ──────────────────────────────────────────────
  function _latestByDay(entries, skipAuto) {
    var by = {};
    (entries || []).forEach(function (e) {
      if (!e || (skipAuto && e.autoFilled)) return;
      var k = entryDay(e);
      if (!k) return;
      var ts = e.recordedAt ? (Date.parse(e.recordedAt) || e.timestamp || 0) : (e.timestamp || 0);
      if (!by[k] || by[k]._ts <= ts) by[k] = { _ts: ts, e: e };
    });
    return by;
  }
  /**
   * Taken / missed per medicine over days [fromKey, toKey] (inclusive), only
   * from days recorded per medicine; plus the overall share of answered days
   * marked taken (old single answers included).
   */
  function adherence(entries, fromK, toK) {
    var by = _latestByDay(entries, false);
    var per = {}, answered = 0, taken = 0, perDays = 0;
    Object.keys(by).forEach(function (k) {
      if ((fromK && k < fromK) || (toK && k > toK)) return;
      var d = dosesOf(by[k].e);
      if (d.status === 'taken' || d.status === 'not-taken') { answered++; if (d.status === 'taken') taken++; }
      if (!d.perMed) return;
      perDays++;
      Object.keys(d.perMed).forEach(function (n) {
        var id = norm(n);
        var r = per[id] || (per[id] = { name: n, taken: 0, missed: 0, last: '' });
        if (k >= r.last) { r.name = n; r.last = k; }
        r[d.perMed[n] === 'taken' ? 'taken' : 'missed']++;
      });
    });
    var meds = Object.keys(per).map(function (id) { var r = per[id]; return { name: r.name, taken: r.taken, missed: r.missed, days: r.taken + r.missed }; })
      .sort(function (a, b) { return b.days - a.days || (a.name < b.name ? -1 : 1); });
    return { meds: meds, answered: answered, taken: taken, perDays: perDays, pct: answered ? Math.round(taken / answered * 100) : null };
  }
  /** Days a dose was missed, newest first: {day, names} (names null = the old one answer for the day). */
  function missedLog(entries, fromK) {
    var by = _latestByDay(entries, false);
    return Object.keys(by).filter(function (k) { return !fromK || k >= fromK; }).sort().reverse().map(function (k) {
      var d = dosesOf(by[k].e);
      if (d.perMed) { var m = namesWith(d.perMed, 'missed'); return m.length ? { day: k, names: m } : null; }
      return d.status === 'not-taken' ? { day: k, names: null } : null;
    }).filter(Boolean);
  }
  /** Blood results grouped by test, oldest first: [{test, unit, points:[{date, value, note}]}]. */
  function bloodSeries(levels) {
    var by = {}, order = [];
    (levels || []).forEach(function (x) {
      if (!x || x.deleted || !isNum(x.value) || !fromKey(x.date)) return;
      var id = norm(x.test);
      if (!by[id]) { by[id] = { test: String(x.test).trim(), unit: x.unit || '', points: [] }; order.push(id); }
      by[id].points.push({ id: x.id, date: x.date, value: Number(x.value), unit: x.unit || '', note: x.note || '' });
      if (x.unit) by[id].unit = x.unit;
    });
    return order.map(function (id) {
      var s = by[id];
      s.points.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      return s;
    });
  }

  // ── blood results on the charts, the next test, the person's range (v358) ──
  // medBloodPlans: one record per test, {id: 't:<test>', test, due?, low?,
  // high?, dismissed?}. The range is only ever what the person typed in:
  // there is no default range anywhere (a medical decision, not ours).
  function planId(test) { return 't:' + norm(test); }
  /** The live plan for a test, or null. */
  function planOf(plans, test) {
    var id = planId(test);
    for (var i = 0; i < (plans || []).length; i++) {
      var p = plans[i];
      if (p && !p.deleted && (p.id === id || norm(p.test) === norm(test))) return p;
    }
    return null;
  }
  function hasRange(p) { return !!p && isNum(p.low) && isNum(p.high) && Number(p.low) <= Number(p.high); }
  /**
   * The one "had your test?" card to show today, or null: a test whose next
   * test was due on or before today, with no result dated on or after that
   * day, and not dismissed for that due date. The earliest due date wins.
   * → {test, due, plan}
   */
  function dueNow(levels, plans, today) {
    var best = null;
    (plans || []).forEach(function (p) {
      if (!p || p.deleted || !fromKey(p.due) || p.due > today || p.dismissed === p.due) return;
      var done = (levels || []).some(function (x) {
        return x && !x.deleted && norm(x.test) === norm(p.test) && typeof x.date === 'string' && x.date >= p.due;
      });
      if (done) return;
      if (!best || p.due < best.due) best = { test: p.test, due: p.due, plan: p };
    });
    return best;
  }
  var LITHIUM_RE = /^(lithium|litium|litio|lítio|lit|li|锂)(\b|$|\s|\(|锂)/;
  function isLithium(test, extra) {
    var n = norm(test);
    return LITHIUM_RE.test(n) || (!!extra && n === norm(extra));
  }
  /** Tests that can have a line (two results or more): lithium first, then by first result. */
  function lineTests(series, lithiumName) {
    var list = (series || []).filter(function (s) { return s.points.length >= 2; });
    var li = list.filter(function (s) { return isLithium(s.test, lithiumName); });
    return li.concat(list.filter(function (s) { return li.indexOf(s) < 0; }));
  }
  /** Results dated between two day keys (inclusive), oldest first: [{test, unit, date, value, id}]. */
  function markersIn(levels, fromK, toK) {
    var out = [];
    bloodSeries(levels).forEach(function (s) {
      s.points.forEach(function (p) {
        if ((fromK && p.date < fromK) || (toK && p.date > toK)) return;
        out.push({ id: p.id, test: s.test, unit: p.unit || s.unit, date: p.date, value: p.value });
      });
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  /** The value scale for a test's line or chart: its results and the person's range, padded. */
  function valueScale(values, plan) {
    var vals = (values || []).filter(isNum).map(Number);
    if (hasRange(plan)) vals.push(Number(plan.low), Number(plan.high));
    if (!vals.length) return { lo: 0, hi: 1, pad: 0 };
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += Math.abs(hi) * 0.1 || 1; lo -= Math.abs(lo) * 0.1 || 1; }
    var pad = (hi - lo) * 0.12;
    return { lo: lo - pad, hi: hi + pad, pad: pad };
  }

  // ── the comparison ──────────────────────────────────────────────────────────
  /** One record per logged day (latest entry; auto-filled days left out). */
  function dayRecords(entries) {
    var by = _latestByDay(entries, true), out = {};
    Object.keys(by).forEach(function (k) {
      var e = by[k].e, cat = moodCat(e.mood);
      if (!cat) return;
      var cf = {};
      Object.keys(e.customFields || {}).forEach(function (id) {
        var v = e.customFields[id];
        if (v === 'yes' || v === 'no') cf[id] = v;
      });
      out[k] = {
        cat: cat,
        sleep: isNum(e.sleep) ? Number(e.sleep) : null,
        energy: isNum(e.energy) ? Number(e.energy) : null,
        med: dosesOf(e).status,
        custom: cf,
      };
    });
    return out;
  }
  function countIn(recs, a, b, extra) {
    var n = 0;
    Object.keys(recs).forEach(function (k) { if (k >= a && k <= b) n++; });
    if (extra) n += extra(a, b);
    return n;
  }
  function windowStats(recs, a, b, w) {
    var days = Object.keys(recs).filter(function (k) { return k >= a && k <= b; }).sort();
    var mix = {}; CATS.forEach(function (c) { mix[c] = 0; });
    var sleep = [], energy = [], answered = 0, taken = 0, custom = {}, switches = 0, lastPole = null;
    days.forEach(function (k) {
      var r = recs[k];
      mix[r.cat]++;
      var pole = r.cat === 'manic' || r.cat === 'elevated' ? 'up' : r.cat === 'low' || r.cat === 'depressed' ? 'down' : null;
      if (pole) { if (lastPole && pole !== lastPole) switches++; lastPole = pole; }
      if (r.sleep != null) sleep.push(r.sleep);
      if (r.energy != null) energy.push(r.energy);
      if (r.med === 'taken' || r.med === 'not-taken' || r.med === 'unsure') { answered++; if (r.med === 'taken') taken++; }
      Object.keys(r.custom).forEach(function (id) {
        var c = custom[id] || (custom[id] = { yes: 0, answered: 0 });
        c.answered++; if (r.custom[id] === 'yes') c.yes++;
      });
    });
    var n = days.length;
    var avg = function (arr) { return arr.length ? arr.reduce(function (s, v) { return s + v; }, 0) / arr.length : null; };
    var pctMix = {}; CATS.forEach(function (c) { pctMix[c] = n ? Math.round(mix[c] / n * 100) : 0; });
    var cOut = {};
    Object.keys(custom).forEach(function (id) { cOut[id] = { pct: Math.round(custom[id].yes / custom[id].answered * 100), answered: custom[id].answered }; });
    return {
      from: a, to: b, days: n,
      stability: n ? Math.round(mix.stable / n * 100) : null,
      mix: pctMix, counts: mix,
      switches: switches, switchesPerMonth: w ? Math.round(switches / w * 30 * 10) / 10 : 0,
      avgSleep: avg(sleep), avgEnergy: avg(energy),
      medsTaken: answered ? Math.round(taken / answered * 100) : null,
      custom: cOut,
    };
  }
  /**
   * Before / after one change. `change`: an event from allEvents(). opts:
   * {today?: Date, events?: all events (for the other-changes flag),
   * minDays?, maxWindow?}.
   * → {ok:true, window, before, after, others:[event], change}
   * | {ok:false, need: days more to log (0 = logging won't help), reason:
   *    'after'|'before', window, beforeDays, afterDays, change}
   */
  function compare(entries, change, opts) {
    opts = opts || {};
    var MIN = opts.minDays || MIN_DAYS, MAXW = opts.maxWindow || MAX_WINDOW;
    var today = dayKey(opts.today || new Date());
    var C = change.day;
    var recs = dayRecords(entries);
    var keys = Object.keys(recs).sort();
    var first = keys.length ? keys[0] : null;
    var beforeSpan = first && first < C ? diffDays(first, C) : 0;   // days first … C−1
    var evaluate = function (ext) {                                  // ext: days logged from tomorrow on (what-if)
      var end = ext ? addDays(today, ext) : today;
      var afterSpan = Math.max(0, diffDays(C, end));                  // days C+1 … end
      var w = Math.min(MAXW, beforeSpan, afterSpan);
      if (w <= 0) return { w: 0, b: 0, a: 0 };
      var b = countIn(recs, addDays(C, -w), addDays(C, -1));
      var a = countIn(recs, addDays(C, 1), addDays(C, w), ext ? function (x, y) {
        // the what-if days between tomorrow and `end` that fall in the window
        var lo = addDays(today, 1) > x ? addDays(today, 1) : x, hi = end < y ? end : y;
        return lo <= hi ? diffDays(lo, hi) + 1 : 0;
      } : null);
      return { w: w, b: b, a: a };
    };
    var now = evaluate(0);
    var base = { change: change, window: now.w, beforeDays: now.b, afterDays: now.a };
    if (now.w >= MIN && now.b >= MIN && now.a >= MIN) {
      var w = now.w;
      var before = windowStats(recs, addDays(C, -w), addDays(C, -1), w);
      var after = windowStats(recs, addDays(C, 1), addDays(C, w), w);
      var lo = addDays(C, -w), hi = addDays(C, w);
      var others = (opts.events || []).filter(function (e) {
        return e.key !== change.key && e.type !== 'baseline' && e.type !== 'rename' && e.source !== 'import' && e.day >= lo && e.day <= hi;
      });
      return { ok: true, window: w, before: before, after: after, others: others, change: change };
    }
    // The before side can only grow to the widest window there is: if that
    // still has too few logged days, more logging won't help.
    var maxW = Math.min(MAXW, beforeSpan);
    var bMax = maxW > 0 ? countIn(recs, addDays(C, -maxW), addDays(C, -1)) : 0;
    if (maxW < MIN || bMax < MIN) return Object.assign(base, { ok: false, need: 0, reason: 'before', beforeDays: bMax });
    // How many more days of logging (one a day from tomorrow) would do it?
    var limit = Math.max(1, diffDays(today, addDays(C, maxW)) + 1);
    for (var d = 1; d <= limit; d++) {
      var r = evaluate(d);
      if (r.w >= MIN && r.b >= MIN && r.a >= MIN) return Object.assign(base, { ok: false, need: d, reason: 'after' });
    }
    // The widest window is already in the past and its after side has gaps.
    return Object.assign(base, { ok: false, need: 0, reason: 'afterGap', afterDays: countIn(recs, addDays(C, 1), addDays(C, maxW)) });
  }

  var api = {
    MIN_DAYS: MIN_DAYS, MAX_WINDOW: MAX_WINDOW,
    norm: norm, dayKey: dayKey, fromKey: fromKey, addDays: addDays, diffDays: diffDays, entryDay: entryDay, moodCat: moodCat,
    aggregate: aggregate, dosesOf: dosesOf, dosesForAnswer: dosesForAnswer, namesWith: namesWith,
    allEvents: allEvents, listOnDay: listOnDay, changeEvents: changeEvents,
    adherence: adherence, missedLog: missedLog, bloodSeries: bloodSeries,
    planId: planId, planOf: planOf, hasRange: hasRange, dueNow: dueNow, isLithium: isLithium,
    lineTests: lineTests, markersIn: markersIn, valueScale: valueScale,
    dayRecords: dayRecords, windowStats: windowStats, compare: compare,
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  // ══ Browser ════════════════════════════════════════════════════════════════
  var BB = root.BB = root.BB || {};
  var _entries = [];

  function t(key, vars) {
    var full = 'meds144.' + key, v = null;
    try { v = BB.t(full, vars); } catch (_) {}
    return v == null ? full : v;
  }
  function tt(key, vars) { try { return BB.t(key, vars); } catch (_) { return key; } }
  /** blood144.* (js/shared/i18n-blood.js): the charts, next test and range strings. */
  function tb(key, vars) {
    var full = 'blood144.' + key, v = null;
    try { v = BB.t(full, vars); } catch (_) {}
    return v == null ? full : v;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function lang() {
    var l = 'en';
    try { l = (BB.i18n && BB.i18n.getLang && BB.i18n.getLang()) || 'en'; } catch (_) {}
    return l === 'zh' ? 'zh-CN' : l;
  }
  function fmtDate(k, o) {
    var d = fromKey(k);
    if (!d) return '';
    try { return d.toLocaleDateString(lang(), o || { day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return k; }
  }
  function fmtNum(n, dp) {
    if (n == null) return t('na');
    try { return new Intl.NumberFormat(lang(), { maximumFractionDigits: dp == null ? 1 : dp }).format(n); } catch (_) { return String(Math.round(n * 10) / 10); }
  }
  function moodName(c) { var v = tt('mood.' + c); return v && v !== 'mood.' + c ? v : c; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }
  function currentList() { try { return medList(JSON.parse(lsGet('currentMedList') || '[]')); } catch (_) { return []; } }
  function history() { try { return (BB.medHistory && BB.medHistory.get()) || []; } catch (_) { return []; } }
  function logList(kind) { try { return (BB.medLog && BB.medLog.list(kind)) || []; } catch (_) { return []; } }
  function events() { return allEvents(history(), logList('pastChanges')); }
  function todayKey() { return dayKey(new Date()); }

  /** The medicines for a day's answer: the list that day (today: the current list). */
  function namesForDay(k) {
    var cur = currentList();
    if (!k || k >= todayKey()) return cur.map(function (m) { return m.name; });
    return listOnDay(events(), cur, k).map(function (m) { return m.name; });
  }

  function describe(ev) {
    if (!ev) return '';
    if (ev.type === 'add') return ev.to ? t('evAddDose', { name: ev.name, dose: ev.to }) : t('evAdd', { name: ev.name });
    if (ev.type === 'stop') return t('evStop', { name: ev.name });
    if (ev.type === 'dose') return t('evDose', { name: ev.name, from: ev.from || t('na'), to: ev.to || t('na') });
    return ev.name;
  }

  // ── chips on the medication step ────────────────────────────────────────────
  /**
   * Markup for the per-medicine chips. `onToggle` is the global function
   * name the chips call with the medicine's index. `ask`: show the "Which
   * did you miss?" heading. Empty with fewer than two medicines (one
   * medicine's answer is the day's answer).
   */
  function chipsHtml(names, doses, onToggle, opts) {
    opts = opts || {};
    if (!names || names.length < 2 || !doses) return '';
    var list = currentList(), dose = {};
    list.forEach(function (m) { dose[norm(m.name)] = m.dosage; });
    var chips = names.map(function (n, i) {
      var missed = doses[n] === 'missed';
      var lbl = t(missed ? 'chipMissed' : 'chipTaken', { name: n });
      return '<button type="button" class="med-dose-chip' + (missed ? ' missed' : '') + '" aria-pressed="' + (!missed) + '" aria-label="' + esc(lbl) + '" onclick="' + onToggle + '(' + i + ')">' +
        '<span aria-hidden="true">' + (missed ? '❌' : '✅') + '</span><span>' + esc(n) + (dose[norm(n)] ? ' <span class="mdc-dose">' + esc(dose[norm(n)]) + '</span>' : '') + '</span></button>';
    }).join('');
    return '<div class="med-doses" role="group" aria-label="' + esc(t('whichMissed')) + '">' +
      (opts.ask ? '<div class="med-doses-q">' + esc(t('whichMissed')) + '</div>' : '') +
      '<div class="med-doses-hint">' + esc(t('tapToChange')) + '</div>' +
      '<div class="med-doses-row">' + chips + '</div>' +
      (opts.nextFn ? '<div class="med-doses-next"><button type="button" onclick="' + opts.nextFn + '()">' + esc(tt('common.next')) + ' →</button></div>' : '') +
      '</div>';
  }
  /** "Missed: Lithium" style text for an entry, or '' (lists, calendar, PDF). */
  function entryNote(e) {
    var d = dosesOf(e);
    if (!d.perMed) return '';
    var m = namesWith(d.perMed, 'missed');
    return m.length ? t('missedList', { names: m.join(', ') }) : '';
  }
  /** "Lithium: taken; Quetiapine: missed" for the CSV. */
  function csvCell(e) {
    var d = dosesOf(e);
    if (!d.perMed) return '';
    return Object.keys(d.perMed).map(function (n) { return n + ': ' + d.perMed[n]; }).join('; ');
  }

  // ── 💊 My medicines sheet ──────────────────────────────────────────────────
  var TABS = ['doses', 'side', 'blood', 'compare'];
  var _tab = null, _lastTap = null, _tabNote = '', _showAllMissed = false;
  function savedTab() { var v = lsGet(TAB_KEY); return TABS.indexOf(v) >= 0 ? v : null; }
  function coarse() { try { return matchMedia('(pointer: coarse)').matches; } catch (_) { return false; } }

  function ensureModal() {
    var m = document.getElementById('medsHubModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'medsHubModal';
    m.className = 'confirm-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'medsHubTitle');
    m.addEventListener('click', function (ev) { if (ev.target === m) close(); });
    document.body.appendChild(m);
    return m;
  }
  /** opts.test: open the Blood levels form ready for that test (the due card's button). */
  function open(tab, opts) {
    _tab = TABS.indexOf(tab) >= 0 ? tab : (savedTab() || 'doses');
    _tabNote = ''; _showAllMissed = false;
    _prefillTest = opts && opts.test ? String(opts.test) : null;
    var m = ensureModal();
    render();
    m.classList.add('active');
    var focused = false;
    if (_prefillTest && _tab === 'blood') {
      var v = m.querySelector('#medsBlAdd input[name="value"]');
      if (v) {
        try { v.focus({ preventScroll: true }); v.scrollIntoView({ block: 'center' }); focused = true; } catch (_) {}
      }
    }
    if (!focused) { try { m.querySelector('.meds-x').focus(); } catch (_) {} }
    document.addEventListener('keydown', _onKey);
  }
  function close() {
    var m = document.getElementById('medsHubModal');
    if (m) m.classList.remove('active');
    document.removeEventListener('keydown', _onKey);
  }
  function _onKey(e) { if (e.key === 'Escape') close(); }
  function pickTab(v) {
    var now = Date.now(), prev = _lastTap;
    _lastTap = { v: v, at: now };
    _tabNote = '';
    if (prev && prev.v === v && now - prev.at < 400) {
      lsSet(TAB_KEY, v); _lastTap = null;
      _tabNote = tt('journal.lifeChart.viewNowDefault');
    }
    _tab = v;
    render();
  }

  function render() {
    var m = ensureModal();
    var saved = savedTab();
    var hint = tt(coarse() ? 'journal.lifeChart.viewTapAgain' : 'journal.lifeChart.viewClickAgain');
    var tabs = TABS.map(function (v) {
      var key = { doses: 'tabDoses', side: 'tabSide', blood: 'tabBlood', compare: 'tabCompare' }[v];
      return '<button type="button" class="meds-tab' + (v === _tab ? ' on' : '') + '" aria-pressed="' + (v === _tab) + '"' +
        (v === saved ? ' data-default-view="true"' : '') + ' title="' + esc(v === saved ? tt('journal.lifeChart.viewDefault') : hint) + '" onclick="BBMeds._tab(\'' + v + '\')">' + esc(t(key)) + '</button>';
    }).join('');
    var body = '';
    try {
      body = _tab === 'side' ? sideHtml() : _tab === 'blood' ? bloodHtml() : _tab === 'compare' ? compareHtml() : dosesHtml();
    } catch (e) { try { console.warn('[meds]', e); } catch (_) {} }
    var keepScroll = m.querySelector('.meds-body');
    var st = keepScroll && keepScroll.dataset.tab === _tab ? keepScroll.scrollTop : 0;
    m.innerHTML = '<div class="confirm-content meds-sheet">' +
      '<div class="meds-head"><h3 id="medsHubTitle">' + esc(t('hubTitle')) + '</h3><button type="button" class="meds-x" aria-label="' + esc(tt('a11y.close')) + '" onclick="BBMeds.close()">✕</button></div>' +
      '<div class="meds-tabs" role="group" aria-label="' + esc(t('tabsLabel')) + '">' + tabs + '</div>' +
      '<div class="meds-tab-note" aria-live="polite">' + esc(_tabNote || (_tab !== (saved || 'doses') ? hint : '')) + '</div>' +
      '<div class="meds-body" data-tab="' + _tab + '">' + body + '</div></div>';
    var nb = m.querySelector('.meds-body');
    if (nb && st) nb.scrollTop = st;
    if (_tab === 'compare') _wireCompare(m);
  }

  // Doses: taken / missed per medicine, and the missed-dose history.
  function dosesHtml() {
    var to = todayKey(), from = addDays(to, -29);
    var a = adherence(_entries, from, to);
    var rows = a.meds.map(function (r) {
      var pct = r.days ? Math.round(r.taken / r.days * 100) : 0;
      return '<div class="meds-row"><div class="mr-main"><strong>' + esc(r.name) + '</strong>' +
        '<div class="mr-sub">' + esc(t('takenOf', { taken: r.taken, days: r.days })) + '</div>' +
        '<div class="meds-bar" aria-hidden="true"><span style="width:' + pct + '%"></span></div></div>' +
        '<div class="mr-date">' + pct + '%</div></div>';
    }).join('');
    var missed = missedLog(_entries);
    var shown = _showAllMissed ? missed : missed.slice(0, 15);
    var mrows = shown.map(function (x) {
      return '<div class="meds-row"><div class="mr-main">' + esc(x.names ? t('missedList', { names: x.names.join(', ') }) : t('missedAll')) + '</div>' +
        '<div class="mr-date">' + esc(fmtDate(x.day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })) + '</div></div>';
    }).join('');
    return '<p class="meds-intro">' + esc(t('dosesIntro')) + '</p>' +
      '<div class="meds-card">' + (rows || '<div class="meds-empty">' + esc(t('dosesNone')) + '</div>') +
      (a.pct != null ? '<div class="mr-sub" style="margin-top:8px;font-size:0.8em;color:var(--text-muted-ink);">' + esc(t('overall', { pct: a.pct })) + '</div>' : '') + '</div>' +
      '<div class="meds-card"><h4>' + esc(t('missedTitle')) + '</h4>' + (mrows || '<div class="meds-empty">' + esc(t('missedNone')) + '</div>') +
      (missed.length > shown.length ? '<button type="button" class="meds-btn link" onclick="BBMeds._more()">' + esc(t('showMore')) + '</button>' : '') + '</div>';
  }

  function medOptions(sel) {
    var names = currentList().map(function (m) { return m.name; });
    history().forEach(function (e) { if (names.map(norm).indexOf(norm(e.name)) < 0) names.push(e.name); });
    return '<option value="">' + esc(t('seMedAny')) + '</option>' + names.map(function (n) {
      return '<option value="' + esc(n) + '"' + (norm(n) === norm(sel) ? ' selected' : '') + '>' + esc(n) + '</option>';
    }).join('');
  }
  function sideHtml() {
    var items = logList('sideEffects').slice().reverse();
    var rows = items.map(function (x) {
      return '<div class="meds-row"><div class="mr-main">' + esc(x.text) + (x.med ? '<div class="mr-sub">💊 ' + esc(x.med) + '</div>' : '') + '</div>' +
        '<div class="mr-date">' + esc(fmtDate(x.date)) + '</div>' +
        '<button type="button" class="meds-del" aria-label="' + esc(t('deleteItem')) + '" title="' + esc(t('deleteItem')) + '" onclick="BBMeds._del(\'sideEffects\',\'' + esc(x.id) + '\')">🗑️</button></div>';
    }).join('');
    return '<p class="meds-intro">' + esc(t('seIntro')) + '</p>' +
      '<div class="meds-card"><h4>' + esc(t('seAdd')) + '</h4><form class="meds-form" onsubmit="event.preventDefault();BBMeds._addSide(this)">' +
      '<label>' + esc(t('seWhat')) + '<textarea name="text" maxlength="500" placeholder="' + esc(t('sePlaceholder')) + '"></textarea></label>' +
      '<label>' + esc(t('seMed')) + '<select name="med">' + medOptions('') + '</select></label>' +
      '<label>' + esc(t('date')) + '<input type="date" name="date" value="' + todayKey() + '" max="' + todayKey() + '"></label>' +
      '<div class="mf-err" aria-live="polite"></div><button type="submit" class="meds-btn primary">' + esc(tt('common.save')) + '</button></form></div>' +
      '<div class="meds-card">' + (rows || '<div class="meds-empty">' + esc(t('seNone')) + '</div>') + '</div>';
  }

  function chartSvg(s, plan) {
    var pts = s.points;
    if (pts.length < 2) return '';
    var W = 320, H = 140, L = 34, R = 10, T = 10, B = 24;
    var sc = valueScale(pts.map(function (p) { return p.value; }), plan);
    var lo = sc.lo, hi = sc.hi, pad_ = sc.pad;
    var t0 = fromKey(pts[0].date).getTime(), t1 = fromKey(pts[pts.length - 1].date).getTime();
    var x = function (k) { return t1 === t0 ? L + (W - L - R) / 2 : L + (fromKey(k).getTime() - t0) / (t1 - t0) * (W - L - R); };
    var y = function (v) { return T + (hi - v) / (hi - lo) * (H - T - B); };
    var grid = [hi - pad_, (hi + lo) / 2, lo + pad_].map(function (v) {
      return '<line class="mc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text x="' + (L - 4) + '" y="' + (y(v) + 3).toFixed(1) + '" text-anchor="end">' + esc(fmtNum(v, 2)) + '</text>';
    }).join('');
    // The person's own range, shaded (only when they typed one in).
    var band = hasRange(plan) ? '<rect class="mc-band" x="' + L + '" width="' + (W - L - R) + '" y="' + y(Number(plan.high)).toFixed(1) +
      '" height="' + Math.max(1, y(Number(plan.low)) - y(Number(plan.high))).toFixed(1) + '"><title>' + esc(tb('legendRange')) + '</title></rect>' : '';
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p.date).toFixed(1) + ' ' + y(p.value).toFixed(1); }).join(' ');
    var dots = pts.map(function (p) { return '<circle class="mc-dot" cx="' + x(p.date).toFixed(1) + '" cy="' + y(p.value).toFixed(1) + '" r="3.2"/>'; }).join('');
    var labels = '<text x="' + L + '" y="' + (H - 6) + '">' + esc(fmtDate(pts[0].date, { day: 'numeric', month: 'short', year: '2-digit' })) + '</text>' +
      '<text x="' + (W - R) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(fmtDate(pts[pts.length - 1].date, { day: 'numeric', month: 'short', year: '2-digit' })) + '</text>';
    return '<svg class="meds-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('blChartLabel', { test: s.test })) + '">' + band + grid + '<path class="mc-line" d="' + path + '"/>' + dots + labels + '</svg>';
  }
  function plans() { return logList('bloodPlans'); }
  function remindOn() { return lsGet(REMIND_KEY) === '1'; }
  function _planHtml(s, plan) {
    var idx = esc(planId(s.test));
    var sum = [];
    if (plan && plan.due) sum.push('<div class="mr-sub bl-plan-line">📅 ' + esc(tb('dueOn', { date: fmtDate(plan.due) })) + '</div>');
    if (hasRange(plan)) sum.push('<div class="mr-sub bl-plan-line">' + esc(tb('rangeShown', { low: fmtNum(plan.low, 3), high: fmtNum(plan.high, 3), unit: s.unit || '' }).trim()) + '</div>');
    var remind = coarseNative() ? '<label class="bl-check"><input type="checkbox" name="remind"' + (remindOn() ? ' checked' : '') + '> <span>' + esc(tb('remind')) + '</span></label>' +
      '<div class="mr-sub" style="margin:-4px 0 6px">' + esc(tb('remindDesc')) + '</div>' : '';
    return sum.join('') +
      '<details class="meds-details bl-plan"' + (_openPlan === idx ? ' open' : '') + ' data-plan="' + idx + '"><summary>' + esc(tb('planFor')) + '</summary>' +
      '<form class="meds-form" onsubmit="event.preventDefault();BBMeds._savePlan(this)">' +
      '<input type="hidden" name="test" value="' + esc(s.test) + '">' +
      '<label>' + esc(tb('nextDueShort')) + '<input type="date" name="due" value="' + esc(plan && plan.due ? plan.due : '') + '"></label>' + remind +
      '<div class="bl-range-h">' + esc(tb('rangeTitle')) + '</div>' +
      '<p class="meds-intro" style="margin:0 0 6px">' + esc(tb('rangeHint')) + '</p>' +
      '<div class="mf-2"><label>' + esc(tb('rangeLow')) + '<input name="low" inputmode="decimal" maxlength="12" value="' + esc(plan && isNum(plan.low) ? fmtNum(plan.low, 3) : '') + '"></label>' +
      '<label>' + esc(tb('rangeHigh')) + '<input name="high" inputmode="decimal" maxlength="12" value="' + esc(plan && isNum(plan.high) ? fmtNum(plan.high, 3) : '') + '"></label></div>' +
      '<div class="mf-err" aria-live="polite"></div><button type="submit" class="meds-btn primary">' + esc(tt('common.save')) + '</button></form></details>';
  }
  function _offerHtml() {
    if (!_offer) return '';
    return '<div class="meds-card bl-offer" role="group" aria-labelledby="blOfferQ"><div class="bl-offer-q" id="blOfferQ">🩸 ' + esc(tb('offerTitle')) + '</div>' +
      '<p class="meds-intro" style="margin:4px 0 10px">' + esc(tb('offerBody')) + '</p>' +
      '<div class="bl-offer-btns"><button type="button" class="meds-btn primary" onclick="BBMeds._offerAnswer(true)">' + esc(tb('offerYes')) + '</button>' +
      '<button type="button" class="meds-btn" onclick="BBMeds._offerAnswer(false)">' + esc(tb('offerNo')) + '</button></div></div>';
  }
  function bloodHtml() {
    var series = bloodSeries(logList('bloodLevels'));
    var pl = plans();
    var cards = series.map(function (s) {
      var plan = planOf(pl, s.test);
      var rows = s.points.slice().reverse().map(function (p) {
        return '<div class="meds-row"><div class="mr-main"><strong>' + esc(fmtNum(p.value, 3)) + (p.unit ? ' ' + esc(p.unit) : '') + '</strong>' +
          (p.note ? '<div class="mr-sub">' + esc(p.note) + '</div>' : '') + '</div><div class="mr-date">' + esc(fmtDate(p.date)) + '</div>' +
          '<button type="button" class="meds-del" aria-label="' + esc(t('deleteItem')) + '" title="' + esc(t('deleteItem')) + '" onclick="BBMeds._del(\'bloodLevels\',\'' + esc(p.id) + '\')">🗑️</button></div>';
      }).join('');
      return '<div class="meds-card"><h4>🩸 ' + esc(s.test) + '</h4>' + _planHtml(s, plan) + chartSvg(s, plan) + rows + '</div>';
    }).join('');
    var tests = series.map(function (s) { return s.test; });
    if (tests.map(norm).indexOf(norm(t('blLithium'))) < 0) tests.unshift(t('blLithium'));
    var last = series.length ? series[series.length - 1] : null;
    var pre = _prefillTest ? (series.filter(function (s) { return norm(s.test) === norm(_prefillTest); })[0] || { test: _prefillTest, unit: '' }) : null;
    var useT = pre || last;
    return '<p class="meds-intro">' + esc(t('blIntro')) + '</p>' + _offerHtml() +
      '<div class="meds-card"><h4>' + esc(t('blAdd')) + '</h4><form class="meds-form" id="medsBlAdd" onsubmit="event.preventDefault();BBMeds._addBlood(this)">' +
      '<div class="mf-2"><label>' + esc(t('blTest')) + '<input name="test" list="medsBlTests" maxlength="60" value="' + esc(useT ? useT.test : t('blLithium')) + '"></label>' +
      '<label>' + esc(t('date')) + '<input type="date" name="date" value="' + todayKey() + '" max="' + todayKey() + '"></label></div>' +
      '<datalist id="medsBlTests">' + tests.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>' +
      '<div class="mf-2"><label>' + esc(t('blValue')) + '<input name="value" inputmode="decimal" maxlength="12" placeholder="0.6"></label>' +
      '<label>' + esc(t('blUnit')) + '<input name="unit" maxlength="20" value="' + esc(useT && useT.unit ? useT.unit : (last && last.unit ? last.unit : 'mmol/L')) + '"></label></div>' +
      '<label>' + esc(t('blNote')) + '<input name="note" maxlength="200" placeholder="' + esc(t('blNotePlaceholder')) + '"></label>' +
      '<label>' + esc(tb('nextDue')) + '<input type="date" name="nextDue" min="' + todayKey() + '"></label>' +
      '<div class="mf-err" aria-live="polite"></div><button type="submit" class="meds-btn primary">' + esc(tt('common.save')) + '</button></form></div>' +
      (cards || '<div class="meds-card"><div class="meds-empty">' + esc(t('blNone')) + '</div></div>');
  }

  // Before / after a change.
  function pickedChange(list) {
    var k = lsGet(COMPARE_KEY);
    for (var i = 0; i < list.length; i++) if (list[i].key === k) return list[i];
    return null;
  }
  /** The change the PDF compares: the one picked last, else the newest with enough data. */
  function reportComparison(entries) {
    var evs = events(), list = changeEvents(evs);
    var p = pickedChange(list);
    if (p) { var r = compare(entries, p, { events: evs }); return r.ok ? r : null; }
    for (var i = 0; i < list.length; i++) { var c = compare(entries, list[i], { events: evs }); if (c.ok) return c; }
    return null;
  }
  function mixHtml(s) {
    var bar = CATS.filter(function (c) { return s.counts[c]; }).map(function (c) {
      return '<span style="width:' + (s.counts[c] / s.days * 100).toFixed(1) + '%;background:' + MOOD_COLORS[c] + '"></span>';
    }).join('');
    var key = CATS.filter(function (c) { return s.counts[c]; }).map(function (c) {
      return '<span><i style="background:' + MOOD_COLORS[c] + '"></i>' + esc(moodName(c)) + ' ' + s.mix[c] + '%</span>';
    }).join('');
    return '<div class="meds-mix" aria-hidden="true">' + bar + '</div><div class="meds-mix-key">' + key + '</div>';
  }
  function customLabel(id) {
    try {
      var list = JSON.parse(lsGet('customTrackingFields') || '[]');
      var f = (Array.isArray(list) ? list : []).filter(function (x) { return x && x.id === id; })[0];
      if (f && f.label) return String(f.label);
    } catch (_) {}
    if (id === 'addedSugar') return tt('t143.j.addedSugar');
    return id;
  }
  function resultRows(r) {
    var b = r.before, a = r.after;
    var pc = function (v) { return v == null ? t('na') : v + '%'; };
    var row = function (label, x, y) { return '<tr><td>' + esc(label) + '</td><td>' + esc(x) + '</td><td>' + esc(y) + '</td></tr>'; };
    var rows = [
      row(t('loggedDays'), String(b.days), String(a.days)),
      row(t('stability'), pc(b.stability), pc(a.stability)),
      row(t('switches'), t('perMonth', { n: fmtNum(b.switchesPerMonth) }), t('perMonth', { n: fmtNum(a.switchesPerMonth) })),
      row(t('avgSleep'), b.avgSleep == null ? t('na') : t('hours', { n: fmtNum(b.avgSleep) }), a.avgSleep == null ? t('na') : t('hours', { n: fmtNum(a.avgSleep) })),
      row(t('avgEnergy'), b.avgEnergy == null ? t('na') : t('outOf10', { n: fmtNum(b.avgEnergy) }), a.avgEnergy == null ? t('na') : t('outOf10', { n: fmtNum(a.avgEnergy) })),
      row(t('medsTaken'), pc(b.medsTaken), pc(a.medsTaken)),
    ];
    var ids = Object.keys(b.custom).concat(Object.keys(a.custom)).filter(function (id, i, arr) { return arr.indexOf(id) === i; });
    var custom = ids.map(function (id) {
      return row(customLabel(id), b.custom[id] ? b.custom[id].pct + '%' : t('na'), a.custom[id] ? a.custom[id].pct + '%' : t('na'));
    });
    return { rows: rows, custom: custom };
  }
  function compareResultHtml(r) {
    if (!r.ok) {
      if (r.reason === 'after' && r.need > 0) {
        return '<div class="meds-short">' + esc(t('keepLogging', { count: r.need })) + '</div>' +
          '<p class="meds-intro">' + esc(t('needWhy', { min: MIN_DAYS, max: MAX_WINDOW })) + '</p>';
      }
      return '<div class="meds-short">' + esc(t(r.reason === 'afterGap' ? 'notEnoughAfter' : 'notEnoughBefore', { n: r.reason === 'afterGap' ? r.afterDays : r.beforeDays, min: MIN_DAYS })) + '</div>' +
        '<p class="meds-intro">' + esc(t('needWhy', { min: MIN_DAYS, max: MAX_WINDOW })) + '</p>';
    }
    var rr = resultRows(r);
    var head = '<thead><tr><th></th><th>' + esc(t('before')) + '<div class="mr-sub" style="font-weight:400">' + esc(t('rangeLine', { from: fmtDate(r.before.from, { day: 'numeric', month: 'short' }), to: fmtDate(r.before.to, { day: 'numeric', month: 'short' }) })) + '</div></th>' +
      '<th>' + esc(t('after')) + '<div class="mr-sub" style="font-weight:400">' + esc(t('rangeLine', { from: fmtDate(r.after.from, { day: 'numeric', month: 'short' }), to: fmtDate(r.after.to, { day: 'numeric', month: 'short' }) })) + '</div></th></tr></thead>';
    var others = r.others.length ? '<div class="meds-flag">⚠️ ' + esc(t('others', { list: r.others.map(function (e) { return describe(e) + ' (' + fmtDate(e.day, { day: 'numeric', month: 'short' }) + ')'; }).join('; ') })) + '</div>' : '';
    return '<div class="mr-sub" style="margin-bottom:6px;font-size:0.8em;color:var(--text-muted-ink);">' + esc(t('window', { count: r.window })) + '</div>' +
      '<table class="meds-cmp">' + head + '<tbody>' + rr.rows.join('') +
      (rr.custom.length ? '<tr><th colspan="3" style="text-align:left;padding-top:12px;color:#343a40;">' + esc(t('trackers')) + '</th></tr>' + rr.custom.join('') : '') + '</tbody></table>' +
      '<div style="display:grid;gap:8px;margin-top:10px;"><div><div class="mr-sub" style="font-weight:700;font-size:0.8em;">' + esc(t('moodMix')) + ' · ' + esc(t('before')) + '</div>' + mixHtml(r.before) + '</div>' +
      '<div><div class="mr-sub" style="font-weight:700;font-size:0.8em;">' + esc(t('moodMix')) + ' · ' + esc(t('after')) + '</div>' + mixHtml(r.after) + '</div></div>' +
      others;
  }
  function compareHtml() {
    var evs = events(), list = changeEvents(evs);
    var sel = pickedChange(list) || list[0] || null;
    var picker = list.length ? '<label class="meds-form"><span style="font-size:0.78em;font-weight:600;">' + esc(t('cmpPick')) + '</span><select id="medsCmpPick">' +
      list.map(function (e) {
        return '<option value="' + esc(e.key) + '"' + (sel && e.key === sel.key ? ' selected' : '') + '>' + esc(fmtDate(e.day) + ' · ' + describe(e) + (e.manual ? ' · ' + t('evManual') : '')) + '</option>';
      }).join('') + '</select></label>' : '<div class="meds-empty">' + esc(t('cmpNoChanges')) + '</div>';
    var result = sel ? '<div class="meds-card" style="margin-top:10px;">' + compareResultHtml(compare(_entries, sel, { events: evs })) + '</div>' : '';
    var past = logList('pastChanges').slice().reverse().map(function (p) {
      return '<div class="meds-row"><div class="mr-main">' + esc(describe({ type: p.type, name: p.name, from: p.from, to: p.to })) + '</div><div class="mr-date">' + esc(fmtDate(p.date)) + '</div>' +
        '<button type="button" class="meds-del" aria-label="' + esc(t('deleteItem')) + '" title="' + esc(t('deleteItem')) + '" onclick="BBMeds._del(\'pastChanges\',\'' + esc(p.id) + '\')">🗑️</button></div>';
    }).join('');
    return '<div class="meds-framing">' + esc(t('cmpFraming')) + '</div>' +
      '<p class="meds-intro">' + esc(t('cmpIntro')) + '</p>' + picker + result +
      '<details class="meds-details meds-card" id="medsPastDetails"><summary>' + esc(t('cmpAddPast')) + '</summary>' +
      '<p class="meds-intro">' + esc(t('cmpPastHint')) + '</p>' +
      '<form class="meds-form" onsubmit="event.preventDefault();BBMeds._addPast(this)">' +
      '<div class="mf-2"><label>' + esc(t('cmpType')) + '<select name="type"><option value="add">' + esc(t('typeAdd')) + '</option><option value="stop">' + esc(t('typeStop')) + '</option><option value="dose">' + esc(t('typeDose')) + '</option></select></label>' +
      '<label>' + esc(t('date')) + '<input type="date" name="date" max="' + todayKey() + '"></label></div>' +
      '<label>' + esc(t('cmpName')) + '<input name="name" maxlength="120" list="medsCmpNames"></label>' +
      '<datalist id="medsCmpNames">' + currentList().map(function (m) { return '<option value="' + esc(m.name) + '">'; }).join('') + '</datalist>' +
      '<div class="mf-2"><label>' + esc(t('cmpFrom')) + '<input name="from" maxlength="60"></label><label>' + esc(t('cmpTo')) + '<input name="to" maxlength="60"></label></div>' +
      '<div class="mf-err" aria-live="polite"></div><button type="submit" class="meds-btn primary">' + esc(tt('common.save')) + '</button></form>' +
      past + '</details>';
  }
  function _wireCompare(m) {
    var s = m.querySelector('#medsCmpPick');
    if (s) s.addEventListener('change', function () { lsSet(COMPARE_KEY, s.value); render(); });
    var det = m.querySelector('#medsPastDetails');
    if (det) {
      if (_pastOpen) det.open = true;
      det.addEventListener('toggle', function () {
        _pastOpen = det.open;
        if (det.open) { try { det.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (_) {} }
      });
    }
  }
  var _pastOpen = false;
  var _prefillTest = null, _offer = false, _openPlan = null;
  var REMIND_KEY = 'bbBloodDueReminder', ASKED_KEY = 'bbBloodChartsAsked';
  function coarseNative() {
    try { return !!(root.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); } catch (_) { return false; }
  }
  function chartsOn() { try { return !!(BB.bloodCharts && BB.bloodCharts.isOn()); } catch (_) { return false; } }

  function _formErr(form, msg) { var el = form.querySelector('.mf-err'); if (el) el.textContent = msg || ''; }
  function _val(form, n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; }
  function _afterSave(res, form) {
    if (!res) { _formErr(form, t('invalid')); return; }
    render();
  }
  var actions = {
    _tab: pickTab,
    _more: function () { _showAllMissed = true; render(); },
    _del: function (kind, id) {
      if (!confirm(t('deleteConfirm'))) return;
      BB.medLog.remove(kind, id).then(render, render).then(function () { if (kind === 'bloodLevels') afterBloodChange(); });
    },
    _addSide: function (form) {
      BB.medLog.put('sideEffects', { date: _val(form, 'date'), text: _val(form, 'text'), med: _val(form, 'med') }).then(function (r) { _afterSave(r, form); });
    },
    _addBlood: function (form) {
      var test = _val(form, 'test'), nextDue = _val(form, 'nextDue');
      BB.medLog.put('bloodLevels', { date: _val(form, 'date'), test: test, value: _val(form, 'value'), unit: _val(form, 'unit'), note: _val(form, 'note') }).then(function (r) {
        if (!r) { _formErr(form, t('invalid')); return; }
        _prefillTest = null;
        // The first result ever: offer once to show results on the charts.
        if (lsGet(ASKED_KEY) !== '1') { lsSet(ASKED_KEY, '1'); if (!chartsOn()) _offer = true; }
        var next = nextDue ? putPlan(test, { due: nextDue }) : Promise.resolve();
        return next.then(function () { render(); afterBloodChange(); });
      });
    },
    _savePlan: function (form) {
      var test = _val(form, 'test');
      var lo = _val(form, 'low'), hi = _val(form, 'high');
      var num = function (v) { return v === '' ? null : Number(v.replace(',', '.')); };
      var l = num(lo), h = num(hi);
      if ((l == null) !== (h == null) || (l != null && (!isFinite(l) || !isFinite(h)))) { _formErr(form, tb('rangeBoth')); return; }
      if (l != null && l > h) { _formErr(form, tb('rangeBad')); return; }
      var rem = form.elements.remind;
      _openPlan = planId(test);
      var setRemind = rem ? setReminder(!!rem.checked) : Promise.resolve(true);
      setRemind.then(function (okR) {
        return putPlan(test, { due: _val(form, 'due') || null, low: l, high: h }).then(function () {
          render();
          if (!okR) { var f = document.querySelector('#medsHubModal details[data-plan="' + _openPlan + '"] .mf-err'); if (f) f.textContent = tt('medsReminder.blocked'); }
          afterBloodChange();
        });
      });
    },
    _offerAnswer: function (yes) {
      _offer = false;
      if (yes && BB.bloodCharts) BB.bloodCharts.set(true);
      _tabNote = yes ? tb('offerDone') : '';
      render();
    },
    _addPast: function (form) {
      _pastOpen = true;
      BB.medLog.put('pastChanges', { date: _val(form, 'date'), type: _val(form, 'type'), name: _val(form, 'name'), from: _val(form, 'from'), to: _val(form, 'to') }).then(function (r) {
        if (r && r.item) lsSet(COMPARE_KEY, 'p:' + r.item.id);
        _afterSave(r, form);
      });
    },
  };

  // ── next test, the "had your test?" card and its reminder ─────────────────
  /** Merge a change into a test's plan (null removes a field). A new due date clears the old dismissal. */
  function putPlan(test, patch) {
    var cur = planOf(plans(), test) || {};
    var next = { test: cur.test || test, due: cur.due, low: cur.low, high: cur.high, dismissed: cur.dismissed };
    Object.keys(patch).forEach(function (k) { next[k] = patch[k] == null ? undefined : patch[k]; });
    if (next.due !== cur.due && !('dismissed' in patch)) next.dismissed = undefined;
    return BB.medLog.put('bloodPlans', next);
  }
  function afterBloodChange() {
    renderDueCard();
    scheduleDue();
    try { root.dispatchEvent(new CustomEvent('bb:bloodchange')); } catch (_) {}
  }
  function _cardTest(test) {
    // "Had your lithium test?" reads better in English; other languages keep it as typed.
    return lang() === 'en' && /^[A-Z][a-z]/.test(test) ? test.charAt(0).toLowerCase() + test.slice(1) : test;
  }
  /** The one card, in #bloodDueSlot on the journal page (not in the entry steps). */
  function renderDueCard() {
    var slot = document.getElementById('bloodDueSlot');
    if (!slot) return null;
    var d = null;
    try { d = dueNow(logList('bloodLevels'), plans(), todayKey()); } catch (_) {}
    if (!d) { slot.innerHTML = ''; return null; }
    slot.innerHTML = '<div class="bd-card" role="region" aria-labelledby="bdTitle">' +
      '<button type="button" class="bd-x" aria-label="' + esc(tb('dueDismiss')) + '" title="' + esc(tb('dueDismiss')) + '" onclick="BBMeds._dismissDue()">×</button>' +
      '<div class="bd-title" id="bdTitle"><span aria-hidden="true">🩸 </span>' + esc(tb('dueCard', { test: _cardTest(d.test) })) + '</div>' +
      '<div class="bd-sub">' + esc(tb('dueSub', { date: fmtDate(d.due, { day: 'numeric', month: 'short' }) })) + '</div>' +
      '<button type="button" class="bd-btn" onclick="BBMeds._openDue()">' + esc(tb('dueBtn')) + '</button></div>';
    return d;
  }
  actions._openDue = function () {
    var d = dueNow(logList('bloodLevels'), plans(), todayKey());
    open('blood', d ? { test: d.test } : null);
  };
  actions._dismissDue = function () {
    var d = dueNow(logList('bloodLevels'), plans(), todayKey());
    if (!d) { renderDueCard(); return; }
    var slot = document.getElementById('bloodDueSlot');
    if (slot) slot.innerHTML = '';
    putPlan(d.test, { dismissed: d.due }).then(renderDueCard, renderDueCard);
  };

  // Optional local notification on the due day, 9:00 (phone app only; off
  // unless ticked; bbBloodDueReminder, this phone only). Ids 4000–4009,
  // beside the mood reminder (1), the weekly summary (2), the medication
  // reminders (3000+) and the anniversaries (10000+). The text names no test.
  var DUE_ID = 4000, DUE_MAX = 10;
  function lnPlugin() {
    if (!coarseNative()) return null;
    try { return (Capacitor.Plugins && Capacitor.Plugins.LocalNotifications) || null; } catch (_) { return null; }
  }
  function dueIds() { var ids = []; for (var i = 0; i < DUE_MAX; i++) ids.push({ id: DUE_ID + i }); return ids; }
  function scheduleDue() {
    var LN = lnPlugin();
    if (!LN) return Promise.resolve(0);
    return Promise.resolve().then(function () { return LN.cancel({ notifications: dueIds() }); }).catch(function () {}).then(function () {
      if (!remindOn()) return 0;
      return LN.checkPermissions().then(function (perm) {
        if (!perm || perm.display !== 'granted') return 0;
        var now = new Date(), list = [], lv = logList('bloodLevels');
        plans().filter(function (p) { return fromKey(p.due); }).sort(function (a, b) { return a.due < b.due ? -1 : 1; }).forEach(function (p) {
          if (list.length >= DUE_MAX) return;
          var at = fromKey(p.due); at.setHours(9, 0, 0, 0);
          if (at <= now) return;
          if (lv.some(function (x) { return norm(x.test) === norm(p.test) && x.date >= p.due; })) return;
          list.push({ id: DUE_ID + list.length, title: tb('notifTitle'), body: tb('notifBody'), schedule: { at: at, allowWhileIdle: true },
            extra: { bbBloodDue: 1 }, sound: 'default', smallIcon: 'ic_stat_notify', iconColor: '#FF9500' });
        });
        return list.length ? Promise.resolve(LN.schedule({ notifications: list })).then(function () { return list.length; }) : 0;
      });
    }).catch(function (e) { try { console.warn('[meds] blood reminder', e); } catch (_) {} return 0; });
  }
  /** Turn the reminder on (asks for notifications) or off. → Promise<boolean> false when blocked. */
  function setReminder(on) {
    if (!on) { lsDel(REMIND_KEY); return scheduleDue().then(function () { return true; }); }
    if (remindOn()) return Promise.resolve(true);
    var LN = lnPlugin();
    if (!LN) return Promise.resolve(false);
    return Promise.resolve().then(function () { return LN.checkPermissions(); }).then(function (p) {
      return p && p.display === 'granted' ? p : LN.requestPermissions();
    }).then(function (p) {
      if (!p || p.display !== 'granted') { lsDel(REMIND_KEY); return false; }
      lsSet(REMIND_KEY, '1');
      return true;
    }, function () { return false; });
  }
  /** Logout / reset: forget the reminder and cancel what is scheduled. */
  function clearDueReminder() {
    lsDel(REMIND_KEY);
    var LN = lnPlugin();
    if (LN) { try { Promise.resolve(LN.cancel({ notifications: dueIds() })).catch(function () {}); } catch (_) {} }
  }

  /**
   * What the mood charts need (life chart, PDF): null while "Show blood
   * results on my charts" is off. → {levels, series, plans, lineTests}
   */
  function chartData() {
    if (!chartsOn()) return null;
    var levels = logList('bloodLevels');
    var series = bloodSeries(levels);
    return { levels: levels, series: series, plans: plans(), lineTests: lineTests(series, t('blLithium')) };
  }
  /** "Lithium 0.7 mmol/L · 12 Mar" (the year too when it isn't this year). */
  function markerText(m) {
    var o = { day: 'numeric', month: 'short' };
    if (String(m.date).slice(0, 4) !== String(new Date().getFullYear())) o.year = 'numeric';
    return tb('markerLabel', { test: m.test, value: fmtNum(m.value, 3) + (m.unit ? ' ' + m.unit : ''), date: fmtDate(m.date, o) });
  }

  // ── PDF (jsPDF, mm) ────────────────────────────────────────────────────────
  function _box(doc, o, y, h, title) {
    if (y + h > o.pageH - 16) { doc.addPage(); y = o.margin; }
    doc.setDrawColor(220, 220, 220); doc.setFillColor(255, 255, 255);
    doc.roundedRect(o.margin, y, o.pageW - o.margin * 2, h, 2, 2, 'FD');
    doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(60, 60, 60);
    doc.text(String(title).toUpperCase(), o.margin + 4, y + 6);
    doc.setDrawColor(255, 149, 0); doc.setLineWidth(0.4);
    doc.line(o.margin + 4, y + 7, o.pageW - o.margin - 4, y + 7);
    return y;
  }
  /**
   * The medicines section: taken per medicine (90 days), missed doses (30
   * days), side effects and blood levels. Skipped when there is nothing.
   * o: {margin, pageW, pageH, y}. Returns the new y.
   */
  function drawPdf(doc, entries, o) {
    try {
      var y = o.y, margin = o.margin, pageW = o.pageW, inner = pageW - margin * 2 - 8;
      var to = todayKey();
      var a = adherence(entries, addDays(to, -89), to);
      var missed = missedLog(entries, addDays(to, -29));
      var side = logList('sideEffects').slice().reverse().slice(0, 12);
      var blood = bloodSeries(logList('bloodLevels'));
      if (!a.meds.length && !side.length && !blood.length) return y;
      var x0 = margin + 4;
      // Taken per medicine + missed doses
      if (a.meds.length || missed.length) {
        doc.setFontSize(7);
        var missedLines = missed.length ? doc.splitTextToSize(missed.slice(0, 20).map(function (m) {
          return fmtDate(m.day, { day: 'numeric', month: 'short' }) + ': ' + (m.names ? m.names.join(', ') : t('missedAll'));
        }).join(' · '), inner) : [t('pdfNoneMissed')];
        var h = 12 + a.meds.length * 5 + 6 + missedLines.length * 3.4 + 4;
        y = _box(doc, o, y, h, t('pdfMedsTitle'));
        var ty = y + 12;
        doc.setFontSize(7); doc.setFont(undefined, 'bold'); doc.setTextColor(60, 60, 60);
        doc.text(t('pdfAdherence'), x0, ty); ty += 4.5;
        a.meds.forEach(function (r) {
          var pct = r.days ? r.taken / r.days : 0;
          doc.setFont(undefined, 'normal'); doc.setTextColor(40, 40, 40);
          doc.text(doc.splitTextToSize(r.name, 50)[0], x0, ty);
          doc.setFillColor(235, 235, 235); doc.rect(x0 + 52, ty - 2.6, 80, 3, 'F');
          doc.setFillColor(81, 207, 102); doc.rect(x0 + 52, ty - 2.6, Math.max(80 * pct, 0.4), 3, 'F');
          doc.setTextColor(120, 120, 120);
          doc.text(t('takenOf', { taken: r.taken, days: r.days }) + ' (' + Math.round(pct * 100) + '%)', x0 + 135, ty);
          ty += 5;
        });
        ty += 1.5;
        doc.setFont(undefined, 'bold'); doc.setTextColor(60, 60, 60);
        doc.text(t('pdfMissed'), x0, ty); ty += 3.8;
        doc.setFont(undefined, 'normal'); doc.setTextColor(40, 40, 40);
        doc.text(missedLines, x0, ty);
        y += h + 4;
      }
      if (side.length) {
        doc.setFontSize(7);
        var lines = [];
        side.forEach(function (s) {
          doc.splitTextToSize(fmtDate(s.date) + (s.med ? ' (' + s.med + ')' : '') + ': ' + s.text, inner).forEach(function (l) { lines.push(l); });
        });
        var hs = 12 + lines.length * 3.4 + 2;
        y = _box(doc, o, y, hs, t('pdfSide'));
        doc.setFont(undefined, 'normal'); doc.setTextColor(40, 40, 40);
        doc.text(lines, x0, y + 12);
        y += hs + 4;
      }
      blood.forEach(function (s) {
        var pts = s.points.slice(-24);
        var hb = 12 + (pts.length >= 2 ? 34 : 0) + Math.ceil(pts.length / 3) * 3.8 + 3;
        y = _box(doc, o, y, hb, t('pdfBlood') + ': ' + s.test + (s.unit ? ' (' + s.unit + ')' : ''));
        var ty = y + 11;
        if (pts.length >= 2) {
          var cx = x0 + 10, cw = inner - 12, ch = 24, top = ty + 1;
          var vals = pts.map(function (p) { return p.value; });
          var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
          if (hi === lo) { hi += 1; lo -= 1; }
          var t0 = fromKey(pts[0].date).getTime(), t1 = fromKey(pts[pts.length - 1].date).getTime() || t0 + 1;
          var px = function (k) { return cx + (t1 === t0 ? cw / 2 : (fromKey(k).getTime() - t0) / (t1 - t0) * cw); };
          var py = function (v) { return top + (hi - v) / (hi - lo) * ch; };
          doc.setDrawColor(230, 230, 230); doc.setLineWidth(0.1);
          doc.line(cx, top, cx + cw, top); doc.line(cx, top + ch, cx + cw, top + ch);
          doc.setFontSize(5.5); doc.setTextColor(120, 120, 120);
          doc.text(fmtNum(hi, 2), cx - 1.5, top + 1.5, { align: 'right' });
          doc.text(fmtNum(lo, 2), cx - 1.5, top + ch + 0.5, { align: 'right' });
          doc.setDrawColor(255, 149, 0); doc.setLineWidth(0.5);
          for (var i = 1; i < pts.length; i++) doc.line(px(pts[i - 1].date), py(pts[i - 1].value), px(pts[i].date), py(pts[i].value));
          doc.setFillColor(255, 149, 0);
          pts.forEach(function (p) { doc.circle(px(p.date), py(p.value), 0.7, 'F'); });
          doc.text(fmtDate(pts[0].date, { day: 'numeric', month: 'short', year: '2-digit' }), cx, top + ch + 3.5);
          doc.text(fmtDate(pts[pts.length - 1].date, { day: 'numeric', month: 'short', year: '2-digit' }), cx + cw, top + ch + 3.5, { align: 'right' });
          ty = top + ch + 10;
        }
        doc.setFontSize(6.5); doc.setTextColor(40, 40, 40); doc.setFont(undefined, 'normal');
        var colW = inner / 3;
        pts.slice().reverse().forEach(function (p, i) {
          doc.text(fmtDate(p.date) + ': ' + fmtNum(p.value, 3) + (p.unit ? ' ' + p.unit : ''), x0 + (i % 3) * colW, ty + Math.floor(i / 3) * 3.8);
        });
        y += hb + 4;
      });
      return y;
    } catch (e) {
      try { console.warn('[meds] PDF section skipped', e); } catch (_) {}
      return o.y;
    }
  }
  /** The before / after page, when a change has enough data. Returns the new y. */
  function drawComparePdf(doc, entries, o) {
    try {
      var r = reportComparison(entries);
      if (!r) return o.y;
      doc.addPage();
      var margin = o.margin, pageW = o.pageW, inner = pageW - margin * 2 - 8, x0 = margin + 4;
      var y = margin;
      var rr = resultRows(r);
      doc.setFontSize(6.8);
      var framing = doc.splitTextToSize(t('cmpFraming'), inner);
      var others = r.others.length ? doc.splitTextToSize(t('others', { list: r.others.map(function (e) { return describe(e) + ' (' + fmtDate(e.day, { day: 'numeric', month: 'short' }) + ')'; }).join('; ') }), inner) : [];
      var rowsN = 6 + rr.custom.length;
      var h = 14 + 6 + rowsN * 5 + 2 + 2 * 9 + others.length * 3.2 + framing.length * 3.2 + 8;
      _box(doc, o, y, h, t('pdfTitle'));
      var ty = y + 12;
      doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(40, 40, 40);
      doc.text(fmtDate(r.change.day) + ': ' + describe(r.change), x0, ty);
      doc.setFont(undefined, 'normal'); doc.setFontSize(6.5); doc.setTextColor(120, 120, 120);
      doc.text(t('window', { count: r.window }), pageW - margin - 4, ty, { align: 'right' });
      ty += 6;
      var c1 = x0 + inner * 0.55, c2 = x0 + inner;
      doc.setFontSize(7); doc.setFont(undefined, 'bold'); doc.setTextColor(60, 60, 60);
      doc.text(t('before') + ' (' + t('rangeLine', { from: fmtDate(r.before.from, { day: 'numeric', month: 'short' }), to: fmtDate(r.before.to, { day: 'numeric', month: 'short' }) }) + ')', c1, ty, { align: 'right' });
      doc.text(t('after') + ' (' + t('rangeLine', { from: fmtDate(r.after.from, { day: 'numeric', month: 'short' }), to: fmtDate(r.after.to, { day: 'numeric', month: 'short' }) }) + ')', c2, ty, { align: 'right' });
      ty += 5;
      var strip = function (html) { return String(html).replace(/<\/td><td>/g, '\u0001').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").split('\u0001'); };
      rr.rows.concat(rr.custom).forEach(function (rowHtml) {
        var c = strip(rowHtml);
        doc.setFont(undefined, 'normal'); doc.setTextColor(110, 110, 110);
        doc.text(doc.splitTextToSize(c[0], inner * 0.35)[0], x0, ty);
        doc.setFont(undefined, 'bold'); doc.setTextColor(40, 40, 40);
        doc.text(c[1], c1, ty, { align: 'right' });
        doc.text(c[2], c2, ty, { align: 'right' });
        doc.setDrawColor(240, 240, 240); doc.setLineWidth(0.1); doc.line(x0, ty + 1.6, c2, ty + 1.6);
        ty += 5;
      });
      ty += 2;
      [['before', r.before], ['after', r.after]].forEach(function (pair) {
        var s = pair[1];
        doc.setFont(undefined, 'bold'); doc.setFontSize(6.5); doc.setTextColor(60, 60, 60);
        doc.text(t('moodMix') + ' · ' + t(pair[0]), x0, ty);
        var bx = x0 + 38, bw = inner - 38, cur = bx;
        CATS.forEach(function (c) {
          if (!s.counts[c]) return;
          var w = s.counts[c] / s.days * bw, rgb = PDF_MOOD_RGB[c];
          doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.rect(cur, ty - 2.6, w, 3.2, 'F');
          if (w > 9) { doc.setTextColor(255, 255, 255); doc.setFontSize(5.5); doc.text(s.mix[c] + '%', cur + w / 2, ty - 0.2, { align: 'center' }); }
          cur += w;
        });
        ty += 4.5;
        doc.setFont(undefined, 'normal'); doc.setFontSize(5.5); doc.setTextColor(110, 110, 110);
        doc.text(CATS.filter(function (c) { return s.counts[c]; }).map(function (c) { return moodName(c) + ' ' + s.mix[c] + '%'; }).join('   '), bx, ty);
        ty += 4.5;
      });
      doc.setFontSize(6.8); doc.setFont(undefined, 'normal');
      if (others.length) { doc.setTextColor(169, 70, 0); doc.text(others, x0, ty); ty += others.length * 3.2 + 1; }
      doc.setTextColor(92, 74, 0); doc.text(framing, x0, ty + 1);
      return y + h + 4;
    } catch (e) {
      try { console.warn('[meds] PDF comparison skipped', e); } catch (_) {}
      return o.y;
    }
  }

  BB.meds = root.BBMeds = Object.assign({}, api, actions, {
    setEntries: function (list) {
      _entries = Array.isArray(list) ? list : [];
      var m = document.getElementById('medsHubModal');
      if (m && m.classList.contains('active')) render();
    },
    open: open, close: close,
    namesForDay: namesForDay, chipsHtml: chipsHtml, entryNote: entryNote, csvCell: csvCell, describe: describe,
    events: events, reportComparison: reportComparison, drawPdf: drawPdf, drawComparePdf: drawComparePdf,
    chartsOn: chartsOn, chartData: chartData, markerText: markerText, tb: tb, fmtNum: fmtNum,
    renderDueCard: renderDueCard, scheduleDue: scheduleDue, setReminder: setReminder, clearDueReminder: clearDueReminder,
    putPlan: putPlan,
  });
  function _boot() { try { renderDueCard(); scheduleDue(); } catch (_) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _boot); else _boot();
  // Another device's lists arrived (secure-store sync): redraw if open.
  root.addEventListener('bb:secure-sync', function () {
    var m = document.getElementById('medsHubModal');
    if (m && m.classList.contains('active')) render();
    renderDueCard();
  });
})(typeof window !== 'undefined' ? window : globalThis);
