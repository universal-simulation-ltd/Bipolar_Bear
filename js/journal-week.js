/**
 * 🗓️ Your week: a few plain sentences about the last 7 days, at the top of
 * the Personalised feedback popup (DOCS.md §2.32).
 *
 * Worked out on this device from the already-decrypted entries journal.js
 * hands to showPersonalisedFeedback(). No network call, nothing stored.
 *
 *   BBWeek.summarise(entries, {now}) → null | {
 *     headline: key, obs: [{key, vars, more?}], idea: {key, vars} | null,
 *     checkIn: bool, counts }
 *   BBWeek.cardHtml(entries)         → '' | the card's HTML, translated
 *
 * summarise() returns string keys and numbers only, so the rules can be tested
 * under Node without a DOM or a language (scripts/test-your-week.js).
 *
 * Rules every sentence follows (James, 2026-10-27):
 * - **"Better" means closer to stable, never higher.** An elevated stretch is
 *   not an improvement, so nothing ever says a mood went "up" as good news.
 *   Each day is scored by how far it is from stable (`off`, 0-2).
 * - **Nothing that tells anyone off.** Missed medication, a missed entry or
 *   fewer steps are never mentioned. Consistency is mentioned only when it's
 *   good news.
 * - **Nothing that could read as a nudge towards alcohol or drugs.** Smoking
 *   and drugs are never mentioned. Alcohol only ever gets one factual sentence
 *   ("the day after… was less settled"), never a "no difference" one, and
 *   never an idea line.
 * - **A pattern needs two or more days.** Comparisons with last week need four
 *   logged days in both. Auto-filled days (§2.13) are estimates and don't count.
 * - **Ideas only come from a pattern in this week's own data**: a short-sleep
 *   link, getting outside, exercise, or a steadier week with sleep nearer usual.
 *   With none of those there's no idea line.
 *
 * @file js/journal-week.js
 */
(function (root) {
  'use strict';

  var DAY_MS = 86400000;
  var MIN_LOGGED = 4;      // logged days this week before there is a card at all
  var MAX_OBS = 3;
  var STEADIER = 0.5;      // average distance-from-stable gap that counts as a difference

  var P = (root.BBInsights && root.BBInsights._pure) ||
    (typeof require === 'function' ? require('./journal-insights.js')._pure : null);

  function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayStart(t) { var x = new Date(t); x.setHours(0, 0, 0, 0); return x.getTime(); }
  function isUp(c) { return c === 'elevated' || c === 'manic'; }
  function isDown(c) { return c === 'low' || c === 'depressed'; }
  function mean(a) { return a.length ? a.reduce(function (s, v) { return s + v; }, 0) / a.length : null; }
  function num(v) { return v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null; }

  /**
   * One record per calendar day (the latest entry wins, as in the life chart),
   * keyed 'YYYY-MM-DD' in local time.
   */
  function byDay(entries) {
    var map = {};
    (entries || []).forEach(function (e) {
      if (!e) return;
      var d = e.date ? new Date(e.date) : (e.timestamp ? new Date(e.timestamp) : null);
      if (!d || isNaN(d.getTime())) return;
      var k = dayKey(d);
      var ts = e.recordedAt ? Date.parse(e.recordedAt) || e.timestamp || 0 : (e.timestamp || 0);
      if (map[k] && map[k]._ts > ts) return;
      var cat = P.moodCat(e.mood), score = P.moodScore(e.mood);
      map[k] = {
        _ts: ts, cat: cat, off: score == null ? null : Math.abs(score - 3),
        sleep: num(e.sleep), auto: !!e.autoFilled,
        outside: e.outside || null, exercise: e.exercise || null,
        alcohol: e.alcohol || null, stress: e.stress || null,
        med: e.medication || null,
      };
    });
    return map;
  }

  /** `n` consecutive days ending at `endT` → [{t, key, ...record | null fields}] */
  function span(map, endT, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var t = new Date(endT); t.setDate(t.getDate() - i);
      var k = dayKey(t), r = map[k];
      out.push(r && !r.auto && r.cat ? r : null);
    }
    return out;
  }
  function logged(days) { return days.filter(Boolean); }

  /** Median sleep of the 30 days before `startT` (≥7 nights), as the early warnings use. */
  function sleepBase(map, startT) {
    var vals = span(map, startT - DAY_MS, 30).filter(function (d) { return d && d.sleep != null; })
      .map(function (d) { return d.sleep; });
    return vals.length >= 7 ? P.median(vals) : null;
  }

  /** Short night followed by an up / down next day, counted over `days` (with day+1 available). */
  function shortSleepFollow(days, base) {
    var up = 0, down = 0, short = 0;
    for (var i = 0; i < days.length - 1; i++) {
      var d = days[i], next = days[i + 1];
      if (!d || !P.isShortNight(d.sleep, base)) continue;
      short++;
      if (!next) continue;
      if (isUp(next.cat)) up++; else if (isDown(next.cat)) down++;
    }
    return { short: short, up: up, down: down };
  }

  /** Days where `pred` holds vs. the rest: average distance from stable. */
  function steadierOn(days, pred, notPred) {
    var yes = days.filter(function (d) { return d && pred(d); });
    var no = days.filter(function (d) { return d && notPred(d); });
    if (yes.length < 2 || no.length < 2) return null;
    return { n: yes.length, gap: mean(no.map(function (d) { return d.off; })) - mean(yes.map(function (d) { return d.off; })) };
  }

  function headlineFor(week, prev) {
    var L = logged(week), n = L.length;
    var stable = L.filter(function (d) { return d.cat === 'stable'; }).length;
    var up = L.filter(function (d) { return isUp(d.cat); }).length;
    var down = L.filter(function (d) { return isDown(d.cat); }).length;
    var P2 = logged(prev);
    if (P2.length >= MIN_LOGGED) {
      var stablePrev = P2.filter(function (d) { return d.cat === 'stable'; }).length;
      if (stable - stablePrev >= 2 && stable / n >= 0.5) return 'hSteadier';
    }
    if (stable / n >= 0.7) return 'hStable';
    if (up >= 2 && down >= 2) return 'hUpsDowns';
    if (down / n >= 0.5) return 'hLower';
    if (up / n >= 0.5) return 'hElevated';
    return 'hMixed';
  }

  /**
   * @param {Array<object>} entries decrypted journal entries
   * @param {{now?: Date|number}} [opts]
   */
  function summarise(entries, opts) {
    if (!P) return null;
    opts = opts || {};
    var map = byDay(entries);
    var today = dayStart(opts.now || Date.now());

    // This week ends on the latest logged day, if it's today, yesterday or the
    // day before (the same anchor as the early warnings); otherwise no card.
    var anchor = null;
    for (var a = 0; a < 3 && anchor == null; a++) {
      var t = new Date(today); t.setDate(t.getDate() - a);
      var r = map[dayKey(t)];
      if (r && !r.auto && r.cat) anchor = t.getTime();
    }
    if (anchor == null) return null;

    var week = span(map, anchor, 7);
    var L = logged(week);
    if (L.length < MIN_LOGGED) return null;
    var weekStart = new Date(anchor); weekStart.setDate(weekStart.getDate() - 6);
    var prevEnd = new Date(weekStart); prevEnd.setDate(prevEnd.getDate() - 1);
    var prev = span(map, prevEnd.getTime(), 7);
    var PL = logged(prev);
    // The night before the week counts towards "the next day" for its first day.
    var weekPlus = span(map, anchor, 8);
    var base = sleepBase(map, weekStart.getTime());

    var counts = {
      logged: L.length,
      stable: L.filter(function (d) { return d.cat === 'stable'; }).length,
      depressed: L.filter(function (d) { return d.cat === 'depressed'; }).length,
      manic: L.filter(function (d) { return d.cat === 'manic'; }).length,
    };
    var cands = [];
    var ideas = [];

    // ── Short nights before an elevated or low day ─────────────────────────
    var ss = shortSleepFollow(weekPlus, base);
    var ssDir = ss.up >= 2 && ss.up >= ss.down ? 'up' : ss.down >= 2 ? 'down' : null;
    if (ssDir) {
      var o = { key: ssDir === 'up' ? 'oShortUp' : 'oShortDown', vars: { count: ssDir === 'up' ? ss.up : ss.down }, p: 6 };
      // The same pairing earlier in the journal (up to a year back) makes it
      // "a pattern of yours", not just this week.
      var hist = span(map, weekStart.getTime() - DAY_MS, 365);
      var h = shortSleepFollow(hist, base);
      if ((ssDir === 'up' ? h.up : h.down) >= 3) o.more = { key: 'oShortBefore' };
      cands.push(o);
      ideas.push({ key: 'iSleep', p: 4 });
    }

    // ── Stable days compared with last week ────────────────────────────────
    if (PL.length >= MIN_LOGGED) {
      var sPrev = PL.filter(function (d) { return d.cat === 'stable'; }).length;
      if (Math.abs(counts.stable - sPrev) >= 2) {
        cands.push({ key: counts.stable > sPrev ? 'oStableMore' : 'oStableFewer', vars: { count: counts.stable, prev: sPrev }, p: 5 });
      }
    }

    // ── Sleep compared with last week (neutral: more isn't always better) ──
    var sw = L.filter(function (d) { return d.sleep != null; }).map(function (d) { return d.sleep; });
    var sp = PL.filter(function (d) { return d.sleep != null; }).map(function (d) { return d.sleep; });
    if (sw.length >= MIN_LOGGED && sp.length >= MIN_LOGGED) {
      var aw = mean(sw), ap = mean(sp), diff = aw - ap;
      if (Math.abs(diff) >= 0.75) {
        cands.push({ key: diff > 0 ? 'oSleepMore' : 'oSleepLess', vars: { h: aw, d: Math.abs(diff) }, p: 4 });
      }
      // Sleep nearer the usual and a steadier week: worth keeping.
      if (base != null && Math.abs(aw - base) < Math.abs(ap - base) - 0.5 &&
          mean(L.map(function (d) { return d.off; })) < mean(PL.map(function (d) { return d.off; })) - 0.25) {
        ideas.push({ key: 'iRoutine', p: 1 });
      }
    }

    // ── Getting outside / exercise: mentioned only when those days were steadier ──
    var out = steadierOn(L, function (d) { return d.outside === 'yes'; }, function (d) { return d.outside === 'no'; });
    if (out && out.gap >= STEADIER) {
      cands.push({ key: 'oOutside', vars: { count: out.n }, p: 4 });
      ideas.push({ key: 'iOutside', p: 3 });
    }
    var ex = steadierOn(L, function (d) { return d.exercise === 'yes'; }, function (d) { return d.exercise === 'no'; });
    if (ex && ex.gap >= STEADIER) {
      cands.push({ key: 'oExercise', vars: { count: ex.n }, p: 4 });
      ideas.push({ key: 'iExercise', p: 2 });
    }

    // ── Stress: factual, only when high-stress days were less settled ──────
    var st = steadierOn(L, function (d) { return d.stress && d.stress !== 'high'; }, function (d) { return d.stress === 'high'; });
    if (st && st.gap >= STEADIER) {
      var hi = L.filter(function (d) { return d.stress === 'high'; }).length;
      cands.push({ key: 'oStress', vars: { count: hi }, p: 3 });
    }

    // ── Alcohol: one factual sentence, only one way round, never an idea ───
    var after = [], other = [];
    for (var i = 0; i < weekPlus.length - 1; i++) {
      var d0 = weekPlus[i], d1 = weekPlus[i + 1];
      if (!d0 || !d1 || !d0.alcohol) continue;
      (d0.alcohol === 'yes' ? after : other).push(d1.off);
    }
    if (after.length >= 2 && other.length >= 2 && mean(after) - mean(other) >= STEADIER) {
      cands.push({ key: 'oAlcohol', vars: { count: after.length }, p: 3 });
    }

    // ── Consistency: good news only ─────────────────────────────────────────
    if (L.length === 7) cands.push({ key: 'oEveryDay', vars: {}, p: 1 });
    var medAnswered = L.filter(function (d) { return d.med; });
    if (medAnswered.length >= MIN_LOGGED && medAnswered.every(function (d) { return d.med === 'taken'; })) {
      cands.push({ key: 'oMeds', vars: {}, p: 1 });
    }

    cands.sort(function (x, y) { return y.p - x.p; });
    ideas.sort(function (x, y) { return y.p - x.p; });
    var obs = cands.slice(0, MAX_OBS).map(function (c) {
      var o2 = { key: c.key, vars: c.vars || {} };
      if (c.more) o2.more = c.more;
      return o2;
    });
    // An idea must come from a sentence that is actually on the card.
    var shown = {};
    obs.forEach(function (o3) { shown[o3.key] = true; });
    var IDEA_FROM = { iSleep: ['oShortUp', 'oShortDown'], iOutside: ['oOutside'], iExercise: ['oExercise'], iRoutine: ['oSleepMore', 'oSleepLess', 'oStableMore'] };
    var idea = null;
    for (var j = 0; j < ideas.length && !idea; j++) {
      if (IDEA_FROM[ideas[j].key].some(function (k) { return shown[k]; })) idea = { key: ideas[j].key, vars: {} };
    }

    return {
      headline: headlineFor(week, prev),
      obs: obs,
      idea: idea,
      // The early-warning card's bar for a low run is 5 days in a row; here a
      // week with 3 depressed or 2 manic days is enough to add the support lines.
      checkIn: counts.depressed >= 3 || counts.manic >= 2,
      counts: counts,
    };
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function t(k, v) { try { return root.BB && root.BB.t ? root.BB.t(k, v) : k; } catch (_) { return k; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function lang() {
    var l = 'en';
    try { if (root.BB && root.BB.i18n && root.BB.i18n.getLang) l = root.BB.i18n.getLang() || 'en'; } catch (_) {}
    return l === 'zh' ? 'zh-CN' : l;
  }
  /** Hours as "6h 10m" / "1h 15m" in the app language's digits. */
  function hm(h) {
    var mins = Math.round(h * 60 / 5) * 5;
    var H = Math.floor(mins / 60), M = mins % 60;
    var nf; try { nf = new Intl.NumberFormat(lang()); } catch (_) { nf = { format: String }; }
    return M ? t('week.hm', { h: nf.format(H), m: nf.format(M) }) : t('week.h', { h: nf.format(H) });
  }
  function sentence(o) {
    var v = {};
    Object.keys(o.vars || {}).forEach(function (k) { v[k] = o.vars[k]; });
    if (v.h != null) v.h = hm(v.h);
    if (v.d != null) v.d = hm(v.d);
    return t('week.' + o.key, v);
  }

  function cardHtml(entries, opts) {
    var s = summarise(entries, opts);
    if (!s) return '';
    var obs = s.obs.map(function (o) {
      var more = o.more ? ' <span class="yw-more">' + esc(t('week.' + o.more.key)) + '</span>' : '';
      return '<li>' + esc(sentence(o)) + more + '</li>';
    }).join('');
    var idea = s.idea ? '<div class="yw-idea"><span aria-hidden="true">💡 </span>' + esc(t('week.' + s.idea.key)) + '</div>' : '';
    var care = s.checkIn
      ? '<div class="yw-care">' + esc(t('journal.earlyWarn.careTeam')) +
        ' <a href="survival-kit.html#coping-strategies" class="yw-strat" onclick="event.preventDefault();location.replace(this.getAttribute(\'href\'))">' + esc(t('journal.earlyWarn.strategies')) + '</a></div>'
      : '';
    return '<section class="yw-card" aria-labelledby="ywTitle">' +
      '<div class="yw-kicker" id="ywTitle">' + esc(t('week.title')) + '</div>' +
      '<div class="yw-head">' + esc(t('week.' + s.headline)) + '</div>' +
      (obs ? '<ul class="yw-obs">' + obs + '</ul>' : '') +
      idea + care +
      '<div class="yw-device">' + esc(t('week.onDevice')) + '</div>' +
    '</section>';
  }

  var api = { summarise: summarise, cardHtml: cardHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.BBWeek = api;
})(typeof window !== 'undefined' ? window : globalThis);
