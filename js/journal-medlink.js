/**
 * 💊 Each medicine on its own: days a medicine wasn't taken set beside days it
 * was, in Personalised feedback (DOCS.md §2.35).
 *
 * James, 2026-11-25: "I've been only taking 2 out of 3 of my medications, and
 * I've been skipping the quetiapine. So it'd be good to see in the feedback a
 * correlation between not taking quetiapine and anything else that's changed,
 * as opposed to just looking at medication as a whole."
 *
 * Worked out on this device from the decrypted entries journal.js already has.
 * No network call, nothing stored, nothing sent anywhere.
 *
 *   BBMedLink.analyse(entries) → [{ name, skipped, taken, findings: [...],
 *                                   together: [names] }]
 *   BBMedLink.insights(entries) → [{ title, text, detail, found }] plain text,
 *                                  translated (computeInsights in journal.js
 *                                  turns them into feedback cards + PDF rows)
 *
 * Data: an entry's `medDoses` ({name: 'taken' | 'missed'}, since 1.44; §2.23,
 * §2.30). Only days recorded per medicine count: an older day with the single
 * answer for the whole day can't say which medicine was missed. A lower dose
 * (🤏 Some) counts as taken, as in the Doses tab. Auto-filled days (§2.13) are
 * estimates and never count, neither as the day nor as the day after.
 *
 * Rules:
 * - **Enough data.** A medicine needs MIN_DAYS (5) days not taken and 5 taken
 *   in the period; each comparison needs 4 days on each side with an answer.
 * - **Only clear differences.** Yes / no outcomes (elevated, low, stable,
 *   high anxiety, high stress, irritable, bad sleep) need a 20-point gap, the
 *   larger side 2 or more days, and Fisher's exact test p ≤ 0.1. Averages
 *   (sleep, energy) need 30 min / 1 point and a permutation test p ≤ 0.1
 *   (seeded, so the same journal always says the same thing). At most 3, the
 *   clearest first; a measure is shown for the same day or the day after,
 *   whichever is clearer, not both.
 * - **Sleep is the night after.** An entry's sleep is last night's, so the
 *   night after a day the medicine wasn't taken is the next day's entry.
 * - **Counts, always.** Every sentence says "x of n days … and y of m days",
 *   or both averages. Never "because", never better / worse: elevated is not
 *   good news. Never tells anyone off; the card ends "a pattern in your
 *   journal, not proof … talk to your prescriber before changing how you take
 *   any medicine".
 * - **Skipped together.** When another medicine was also not taken on most of
 *   those days, the card says these days can't tell the medicines apart.
 *
 * @file js/journal-medlink.js
 */
(function (root) {
  'use strict';

  var MIN_DAYS = 5;        // days not taken AND days taken, per medicine
  var MIN_SIDE = 4;        // days with an answer on each side, per comparison
  var MAX_P = 0.1;
  var MIN_SHARE_GAP = 0.2;
  var MIN_SLEEP_GAP = 0.5;
  var MIN_ENERGY_GAP = 1;
  var MAX_FINDINGS = 3;
  var TOGETHER = 0.6;      // another medicine also not taken on ≥ 60% of the days
  var PERMS = 2000;

  var M = root.BBMeds || (typeof require === 'function' ? require('./journal-meds.js') : null);

  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nextKey(k) {
    var p = k.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2], 12);
    d.setDate(d.getDate() + 1);
    return dayKey(d);
  }
  function norm(s) { return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' '); }
  function num(v) { return v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null; }
  function mean(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  function moodCat(m) {
    if (m == null || m === '') return null;
    if (num(m) == null) return m === 'good' ? 'stable' : ({ manic: 1, elevated: 1, stable: 1, low: 1, depressed: 1 }[m] ? m : null);
    var n = Number(m);
    if (n <= 1) return 'depressed';
    if (n <= 3) return 'low';
    if (n <= 6) return 'stable';
    if (n <= 8) return 'elevated';
    return 'manic';
  }

  /** One record per day (latest entry wins), auto-filled days left out. */
  function byDay(entries) {
    var map = {};
    (entries || []).forEach(function (e) {
      if (!e || e.autoFilled) return;
      var d = e.date ? new Date(e.date) : (e.timestamp ? new Date(e.timestamp) : null);
      if (!d || isNaN(d.getTime())) return;
      var k = dayKey(d);
      var ts = e.recordedAt ? (Date.parse(e.recordedAt) || e.timestamp || 0) : (e.timestamp || 0);
      if (map[k] && map[k]._ts > ts) return;
      var per = null, names = {};
      var doses = M && M.dosesOf ? M.dosesOf(e).perMed : null;
      if (doses) {
        per = {};
        Object.keys(doses).forEach(function (n) { per[norm(n)] = doses[n]; names[norm(n)] = n; });
      }
      var q = e.sleepQuality;
      map[k] = {
        _ts: ts, key: k, per: per, names: names,
        cat: moodCat(e.mood),
        sleep: num(e.sleep),
        quality: q === 'good' || q === 'bad' || q === 'unsure' ? q : null,
        energy: num(e.energy),
        anxiety: e.anxiety || null,
        stress: e.stress || null,
        irrit: e.irritability || null,
      };
    });
    return map;
  }

  // ── The measures. `v(day)` → 1 / 0 (yes / no outcomes), a number, or null. ──
  var MEASURES = [
    { id: 'up', bin: true, lags: [0, 1], v: function (d) { return d.cat ? (d.cat === 'elevated' || d.cat === 'manic' ? 1 : 0) : null; } },
    { id: 'down', bin: true, lags: [0, 1], v: function (d) { return d.cat ? (d.cat === 'low' || d.cat === 'depressed' ? 1 : 0) : null; } },
    { id: 'stable', bin: true, lags: [0, 1], v: function (d) { return d.cat ? (d.cat === 'stable' ? 1 : 0) : null; } },
    { id: 'sleep', bin: false, lags: [1], gap: MIN_SLEEP_GAP, v: function (d) { return d.sleep; } },
    { id: 'quality', bin: true, lags: [1], v: function (d) { return d.quality ? (d.quality === 'bad' ? 1 : 0) : null; } },
    { id: 'energy', bin: false, lags: [0, 1], gap: MIN_ENERGY_GAP, v: function (d) { return d.energy; } },
    { id: 'anxiety', bin: true, lags: [0, 1], v: function (d) { return d.anxiety ? (d.anxiety === 'high' ? 1 : 0) : null; } },
    { id: 'stress', bin: true, lags: [0, 1], v: function (d) { return d.stress ? (d.stress === 'high' ? 1 : 0) : null; } },
    { id: 'irrit', bin: true, lags: [0, 1], v: function (d) { return d.irrit ? (d.irrit === 'yes' ? 1 : 0) : null; } },
  ];

  // ── Statistics ──────────────────────────────────────────────────────────────
  var _lf = [0];
  function logFact(n) { for (var i = _lf.length; i <= n; i++) _lf[i] = _lf[i - 1] + Math.log(i); return _lf[n]; }
  /** Two-sided Fisher's exact test for x of n vs y of m. */
  function fisher(x, n, y, m) {
    var K = x + y, N = n + m;
    var lo = Math.max(0, K - m), hi = Math.min(K, n);
    function lp(a) { return logFact(K) + logFact(N - K) + logFact(n) + logFact(m) - logFact(N) - logFact(a) - logFact(K - a) - logFact(n - a) - logFact(m - K + a); }
    var obs = lp(x), p = 0;
    for (var a = lo; a <= hi; a++) { var l = lp(a); if (l <= obs + 1e-7) p += Math.exp(l); }
    return Math.min(1, p);
  }
  function seedOf(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Permutation test of the difference in means (two-sided), seeded. */
  function permP(A, B, seedStr) {
    var all = A.concat(B), n = A.length, N = all.length;
    var total = all.reduce(function (s, v) { return s + v; }, 0);
    var obs = Math.abs(mean(A) - mean(B));
    var r = rng(seedOf(seedStr)), hit = 0;
    for (var i = 0; i < PERMS; i++) {
      // A partial Fisher-Yates shuffle: the first n are the "not taken" side.
      var s = 0;
      for (var j = 0; j < n; j++) {
        var k = j + Math.floor(r() * (N - j));
        var tmp = all[j]; all[j] = all[k]; all[k] = tmp;
        s += all[j];
      }
      if (Math.abs(s / n - (total - s) / (N - n)) >= obs - 1e-9) hit++;
    }
    return (hit + 1) / (PERMS + 1);
  }

  /** One measure at one lag: null, or {key, lag, p, size, ...counts / averages}. */
  function compareOne(ms, lag, map, skippedKeys, takenKeys, medId) {
    function vals(keys) {
      var out = [];
      keys.forEach(function (k) {
        var d = lag ? map[nextKey(k)] : map[k];
        if (!d) return;
        var v = ms.v(d);
        if (v != null) out.push(v);
      });
      return out;
    }
    var A = vals(skippedKeys), B = vals(takenKeys);
    if (A.length < MIN_SIDE || B.length < MIN_SIDE) return null;
    var key = ms.id + lag;
    if (ms.bin) {
      var x = A.filter(Boolean).length, y = B.filter(Boolean).length;
      var gap = x / A.length - y / B.length;
      if (Math.abs(gap) < MIN_SHARE_GAP || (gap > 0 ? x : y) < 2) return null;
      var p = fisher(x, A.length, y, B.length);
      if (p > MAX_P) return null;
      return { key: key, id: ms.id, lag: lag, p: p, size: Math.abs(gap), x: x, n: A.length, y: y, m: B.length };
    }
    var a = mean(A), b = mean(B);
    if (Math.abs(a - b) < ms.gap) return null;
    var p2 = permP(A, B, medId + '|' + key);
    if (p2 > MAX_P) return null;
    return { key: key, id: ms.id, lag: lag, p: p2, size: Math.abs(a - b) / ms.gap * MIN_SHARE_GAP, a: a, b: b, n: A.length, m: B.length };
  }

  /**
   * @param {Array<object>} entries decrypted journal entries (any order)
   * @returns {Array<{name, skipped, taken, findings, together}>} medicines with enough data, most days first
   */
  function analyse(entries) {
    if (!M || !M.dosesOf) return [];
    var map = byDay(entries);
    var keys = Object.keys(map).sort();
    var meds = {};
    keys.forEach(function (k) {
      var d = map[k];
      if (!d.per) return;
      Object.keys(d.per).forEach(function (id) {
        var r = meds[id] || (meds[id] = { id: id, name: d.names[id], skipped: [], taken: [] });
        r.name = d.names[id];   // the latest spelling
        (d.per[id] === 'missed' ? r.skipped : r.taken).push(k);
      });
    });
    var out = [];
    Object.keys(meds).forEach(function (id) {
      var r = meds[id];
      if (r.skipped.length < MIN_DAYS || r.taken.length < MIN_DAYS) return;
      var found = [];
      MEASURES.forEach(function (ms) {
        var best = null;
        ms.lags.forEach(function (lag) {
          var c = compareOne(ms, lag, map, r.skipped, r.taken, id);
          if (c && (!best || c.p < best.p || (c.p === best.p && c.size > best.size))) best = c;
        });
        if (best) found.push(best);
      });
      found.sort(function (a, b) { return a.p - b.p || b.size - a.size; });
      // "Stable less often" says the same thing as "elevated / low more often"
      // on the same days: keep the more specific one.
      found = found.filter(function (f) {
        return f.id !== 'stable' || !found.some(function (g) { return (g.id === 'up' || g.id === 'down') && g.lag === f.lag; });
      }).slice(0, MAX_FINDINGS);
      // Other medicines not taken on most of the same days.
      var together = [];
      Object.keys(meds).forEach(function (oid) {
        if (oid === id) return;
        var both = 0, also = 0;
        r.skipped.forEach(function (k) {
          var s = map[k].per[oid];
          if (!s) return;
          both++;
          if (s === 'missed') also++;
        });
        if (also >= 3 && also / Math.max(1, both) >= TOGETHER) together.push(meds[oid].name);
      });
      out.push({ name: r.name, skipped: r.skipped.length, taken: r.taken.length, findings: found, together: together });
    });
    out.sort(function (a, b) { return (b.skipped + b.taken) - (a.skipped + a.taken) || (a.name < b.name ? -1 : 1); });
    return out;
  }

  // ── Words ───────────────────────────────────────────────────────────────────
  function t(k, v) { try { return root.BB && root.BB.t ? root.BB.t('medLink.' + k, v) : k; } catch (_) { return k; } }
  function lang() {
    var l = 'en';
    try { if (root.BB && root.BB.i18n && root.BB.i18n.getLang) l = root.BB.i18n.getLang() || 'en'; } catch (_) {}
    return l === 'zh' ? 'zh-CN' : l;
  }
  function nf(n, digits) {
    try { return new Intl.NumberFormat(lang(), { maximumFractionDigits: digits }).format(n); } catch (_) { return String(Math.round(n * 10) / 10); }
  }
  function hm(h) {
    var mins = Math.round(h * 60 / 5) * 5;
    var H = Math.floor(mins / 60), Mi = mins % 60;
    return Mi ? t('hm', { h: nf(H, 0), m: nf(Mi, 0) }) : t('h', { h: nf(H, 0) });
  }
  function list(names) {
    try { return new Intl.ListFormat(lang(), { style: 'long', type: 'conjunction' }).format(names); } catch (_) { return names.join(', '); }
  }
  // A medicine's name is the person's own text: put it in after translating, so
  // nothing in it is read as a placeholder or a replacement pattern.
  function put(s, k, v) { return s.split('{' + k + '}').join(v); }

  function sentence(f) {
    if (f.id === 'sleep') return t(f.key, { a: hm(f.a), b: hm(f.b) });
    if (f.id === 'energy') return t(f.key, { a: nf(f.a, 1), b: nf(f.b, 1) });
    return t(f.key, { x: f.x, n: f.n, y: f.y, m: f.m });
  }

  /** Translated, plain-text cards (escape before putting them in HTML). */
  function insights(entries) {
    return analyse(entries).map(function (r) {
      var found = r.findings.length > 0;
      var text = found ? r.findings.map(sentence).join(' ') : t('none');
      var detail = [t('basis', { n: r.skipped, m: r.taken })];
      if (r.together.length) detail.push(put(t('together'), 'others', list(r.together)));
      detail.push(t('caution'));
      return { title: put(t('title'), 'med', r.name), text: text, detail: detail.join(' '), found: found, name: r.name };
    });
  }

  var api = {
    analyse: analyse, insights: insights,
    _pure: { fisher: fisher, permP: permP, byDay: byDay, MEASURES: MEASURES },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.BBMedLink = api;
})(typeof window !== 'undefined' ? window : globalThis);
