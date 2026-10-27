// node scripts/test-your-week.js — checks js/journal-week.js's rules and
// js/shared/i18n-week.js's strings. No DOM, no browser.
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const W = require('../js/journal-week.js');

const NOW = new Date(2026, 9, 25, 12);   // Sunday 25 Oct 2026, local time
function day(back, extra) {
  const d = new Date(NOW); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - back);
  return { date: d.toISOString(), timestamp: d.getTime(), mood: 'stable', sleep: 7.5, ...extra };
}
// back = 0 is today; 0-6 this week, 7-13 last week.
function weeks(thisWeek, lastWeek) {
  const out = [];
  (lastWeek || []).forEach((x, i) => { if (x) out.push(day(13 - i, x)); });
  thisWeek.forEach((x, i) => { if (x) out.push(day(6 - i, x)); });
  return out;
}
const S7 = Array(7).fill({});
const run = (entries) => W.summarise(entries, { now: NOW });
const keys = (s) => s.obs.map((o) => o.key);

// ── When there's no card ───────────────────────────────────────────────────
assert.strictEqual(run([]), null);
assert.strictEqual(run(weeks([{}, {}, {}, null, null, null, null])), null, 'needs 4 logged days, and a recent one');
assert.strictEqual(run(weeks([{}, {}, {}, {}, null, null, null])), null, 'latest entry 3 days ago: no card');
assert.strictEqual(run(weeks([{}, {}, {}, { autoFilled: true }, {}, null, null]).slice(0, 4).concat(day(0, { autoFilled: true }))), null,
  'auto-filled days are not logged days');
assert.ok(run(weeks([null, null, null, {}, {}, {}, {}])), '4 days ending today is enough');

// ── Headlines ──────────────────────────────────────────────────────────────
assert.strictEqual(run(weeks(S7)).headline, 'hStable');
assert.strictEqual(run(weeks(S7, Array(7).fill({ mood: 'low' }))).headline, 'hSteadier');
assert.strictEqual(run(weeks([{ mood: 'low' }, { mood: 'elevated' }, { mood: 'depressed' }, { mood: 'manic' }, {}, {}, {}])).headline, 'hUpsDowns');
assert.strictEqual(run(weeks([{ mood: 'low' }, { mood: 'low' }, { mood: 'depressed' }, { mood: 'low' }, {}, {}, {}])).headline, 'hLower');
assert.strictEqual(run(weeks([{ mood: 'elevated' }, { mood: 'elevated' }, { mood: 'manic' }, { mood: 'elevated' }, {}, {}, {}])).headline, 'hElevated');
assert.strictEqual(run(weeks([{ mood: 'low' }, { mood: 'elevated' }, {}, {}, {}, {}, { mood: 'low' }])).headline, 'hMixed');
assert.strictEqual(run(weeks(Array(7).fill({ mood: 7 }))).headline, 'hElevated', 'the 0-10 spectrum maps to categories');

// ── Short nights before elevated days, and the history line ────────────────
{
  const wk = [{ sleep: 5 }, { mood: 'elevated' }, {}, { sleep: 4.5 }, { mood: 'elevated' }, {}, {}];
  const s = run(weeks(wk));
  assert.deepStrictEqual(s.obs[0], { key: 'oShortUp', vars: { count: 2 } });
  assert.deepStrictEqual(s.idea, { key: 'iSleep', vars: {} });
  // Three earlier short-night → elevated pairs anywhere in the year before.
  const old = [];
  [40, 60, 80].forEach((b) => { old.push(day(b, { sleep: 5 })); old.push(day(b - 1, { mood: 'elevated' })); });
  assert.deepStrictEqual(run(weeks(wk).concat(old)).obs[0].more, { key: 'oShortBefore' });
  // One short night isn't a pattern.
  assert.ok(!keys(run(weeks([{ sleep: 5 }, { mood: 'elevated' }, {}, {}, {}, {}, {}]))).includes('oShortUp'));
  // A night before the week counts for the week's first day.
  const edge = run(weeks([{ mood: 'elevated' }, {}, { sleep: 5 }, { mood: 'elevated' }, {}, {}, {}]).concat(day(7, { sleep: 5 })));
  assert.strictEqual(edge.obs[0].vars.count, 2);
}
{
  const s = run(weeks([{ sleep: 5 }, { mood: 'low' }, { sleep: 5 }, { mood: 'depressed' }, {}, {}, {}]));
  assert.strictEqual(s.obs[0].key, 'oShortDown');
}

// ── Compared with last week ────────────────────────────────────────────────
{
  const s = run(weeks(S7, [{ mood: 'low' }, { mood: 'low' }, { mood: 'low' }, { mood: 'low' }, {}, {}, {}]));
  assert.deepStrictEqual(s.obs.find((o) => o.key === 'oStableMore').vars, { count: 7, prev: 3 });
  const f = run(weeks([{ mood: 'low' }, { mood: 'low' }, { mood: 'low' }, { mood: 'low' }, {}, {}, {}], S7));
  assert.deepStrictEqual(f.obs.find((o) => o.key === 'oStableFewer').vars, { count: 3, prev: 7 });
  assert.ok(!keys(run(weeks(S7, [{}, {}, {}, null, null, null, null]))).includes('oStableMore'), 'needs 4 logged days last week');
  const sl = run(weeks(Array(7).fill({ sleep: 6.5 }), Array(7).fill({ sleep: 8 })));
  const o = sl.obs.find((x) => x.key === 'oSleepLess');
  assert.ok(o && o.vars.h === 6.5 && o.vars.d === 1.5);
  assert.ok(!keys(run(weeks(Array(7).fill({ sleep: 7.5 }), Array(7).fill({ sleep: 8 })))).some((k) => k.startsWith('oSleep')),
    'half an hour is not a change');
}

// ── Steadier is closer to stable, never "higher" ───────────────────────────
{
  // Outside days were elevated, staying-in days stable: outside days were NOT steadier.
  const wk = [{ outside: 'yes', mood: 'elevated' }, { outside: 'yes', mood: 'manic' }, { outside: 'no' }, { outside: 'no' }, {}, {}, {}];
  assert.ok(!keys(run(weeks(wk))).includes('oOutside'));
  const good = [{ outside: 'yes' }, { outside: 'yes' }, { outside: 'no', mood: 'low' }, { outside: 'no', mood: 'depressed' }, {}, {}, {}];
  const s = run(weeks(good));
  assert.ok(keys(s).includes('oOutside'));
  assert.strictEqual(s.idea.key, 'iOutside');
  // Outside days less steady → nothing at all (no discouraging line either).
  const worse = [{ outside: 'yes', mood: 'low' }, { outside: 'yes', mood: 'depressed' }, { outside: 'no' }, { outside: 'no' }, {}, {}, {}];
  assert.ok(!keys(run(weeks(worse))).some((k) => k.startsWith('oOutside')));
  const ex = run(weeks([{ exercise: 'yes' }, { exercise: 'yes' }, { exercise: 'no', mood: 'manic' }, { exercise: 'no', mood: 'elevated' }, {}, {}, {}]));
  assert.ok(keys(ex).includes('oExercise'));
}

// ── Alcohol and other substances ───────────────────────────────────────────
{
  // Drinking days followed by unsettled days: one factual line, no idea from it.
  const wk = [{ alcohol: 'yes' }, { alcohol: 'no', mood: 'low' }, { alcohol: 'yes' }, { alcohol: 'no', mood: 'elevated' }, { alcohol: 'no' }, { alcohol: 'no' }, {}];
  const s = run(weeks(wk));
  assert.ok(keys(s).includes('oAlcohol'));
  assert.ok(!s.idea || !/alcohol/i.test(s.idea.key));
  // Days after drinking were steadier: say nothing. Never a positive line.
  const steadier = [{ alcohol: 'yes' }, { alcohol: 'no' }, { alcohol: 'yes' }, { alcohol: 'no' }, { alcohol: 'no', mood: 'low' }, { alcohol: 'no', mood: 'depressed' }, {}];
  assert.ok(!keys(run(weeks(steadier))).some((k) => /alcohol/i.test(k)));
  // Smoking and drugs are never read.
  const sm = run(weeks(Array(7).fill(0).map((_, i) => ({ smoking: i % 2 ? 'yes' : 'no', drugs: 'yes', mood: i % 2 ? 'stable' : 'low' }))));
  assert.ok(!keys(sm).some((k) => /smok|drug/i.test(k)));
}
// No key, anywhere in the module, could come out as praise for a substance.
{
  const en = loadStrings().en;
  ['oAlcohol'].forEach((k) => {
    const v = JSON.stringify(en[k]);
    assert.ok(/less settled/.test(v) && !/(better|steadier|help|improv|lift)/i.test(v), k);
  });
  Object.keys(en).filter((k) => k.startsWith('i')).forEach((k) => {
    assert.ok(!/(drink|alcohol|smok|drug)/i.test(JSON.stringify(en[k])), `idea ${k} mentions a substance`);
  });
}

// ── Consistency is good news only; missed medication is never mentioned ─────
{
  const s = run(weeks(Array(7).fill({ medication: 'taken' })));
  assert.ok(keys(s).includes('oEveryDay') && keys(s).includes('oMeds'));
  const m = run(weeks([{ medication: 'not-taken' }, { medication: 'taken' }, { medication: 'taken' }, { medication: 'taken' }, { medication: 'taken' }, {}, {}]));
  assert.ok(!keys(m).includes('oMeds'));
  assert.ok(Object.keys(loadStrings().en).every((k) => !/miss|skip|forgot/i.test(JSON.stringify(loadStrings().en[k]))));
}

// ── At most 3 sentences, highest first; check-in thresholds ────────────────
{
  const busy = weeks([
    { sleep: 5, outside: 'yes', medication: 'taken' }, { mood: 'elevated', outside: 'no', medication: 'taken' },
    { sleep: 5, outside: 'yes', medication: 'taken' }, { mood: 'elevated', outside: 'no', medication: 'taken' },
    { outside: 'yes', medication: 'taken' }, { medication: 'taken' }, { medication: 'taken' },
  ], Array(7).fill({ sleep: 9 }));
  const s = run(busy);
  assert.strictEqual(s.obs.length, 3);
  assert.strictEqual(s.obs[0].key, 'oShortUp');
}
assert.strictEqual(run(weeks([{ mood: 'depressed' }, { mood: 'depressed' }, { mood: 'depressed' }, {}, {}, {}, {}])).checkIn, true);
assert.strictEqual(run(weeks([{ mood: 'depressed' }, { mood: 'depressed' }, {}, {}, {}, {}, {}])).checkIn, false);
assert.strictEqual(run(weeks([{ mood: 'manic' }, { mood: 'manic' }, {}, {}, {}, {}, {}])).checkIn, true);
assert.strictEqual(run(weeks([{ mood: 'manic', autoFilled: true }, { mood: 'manic' }, {}, {}, {}, {}, {}])).checkIn, false);

// ── Every summarise() key has a string in all ten languages ────────────────
function loadStrings() {
  if (loadStrings.cache) return loadStrings.cache;
  const out = {};
  const ctx = { window: { BB: { i18n: { extend: (code, o) => { out[code] = o.week; } } } } };
  ctx.BB = ctx.window.BB;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/shared/i18n-week.js'), 'utf8'), ctx);
  return (loadStrings.cache = out);
}
{
  const S = loadStrings();
  assert.deepStrictEqual(Object.keys(S).sort(), ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'zh']);
  const src = fs.readFileSync(path.join(__dirname, '../js/journal-week.js'), 'utf8');
  const used = new Set([...src.matchAll(/'((?:h|o|i)[A-Z][A-Za-z]+)'/g)].map((m) => m[1]));
  ['title', 'onDevice', 'h', 'hm'].forEach((k) => used.add(k));
  const ph = (v) => [...new Set((JSON.stringify(v).match(/\{\w+\}/g) || []))].sort().join();
  for (const k of used) {
    assert.ok(S.en[k] !== undefined, `en.${k} missing`);
    for (const code of Object.keys(S)) {
      const v = S[code][k];
      assert.ok(v !== undefined, `${code}.${k} missing`);
      assert.strictEqual(ph(v), ph(S.en[k]), `${code}.${k} placeholders differ`);
      if (typeof v === 'object') assert.ok(v.other, `${code}.${k} needs an other form`);
    }
  }
  assert.deepStrictEqual(Object.keys(S.en).filter((k) => !used.has(k)), [], 'unused English strings');
}

console.log('your-week: all checks passed');
