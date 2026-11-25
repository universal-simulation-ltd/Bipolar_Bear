// node scripts/test-med-link.js — checks js/journal-medlink.js (💊 each medicine
// on its own, in Personalised feedback) and js/shared/i18n-medlink.js. No DOM.
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const L = require('../js/journal-medlink.js');

const NOW = new Date(2026, 10, 25, 12);
function day(back, extra) {
  const d = new Date(NOW); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - back);
  return { date: d.toISOString(), timestamp: d.getTime(), mood: 'stable', sleep: 7.5, energy: 5, medication: 'taken', ...extra };
}
const doses = (q, l = 'taken', s = 'taken') => ({ medDoses: { Quetiapine: q, Lithium: l, Sertraline: s }, medication: q === 'missed' || l === 'missed' || s === 'missed' ? 'not-taken' : 'taken' });

// 30 days: quetiapine skipped every third day; the night after (next entry)
// is 5 h and that day elevated. Lithium and sertraline always taken.
function journal(opts = {}) {
  const out = [];
  for (let back = 30; back >= 0; back--) {
    const skipped = back % 3 === 0;
    const after = (back + 1) % 3 === 0;   // the day after a skipped day
    out.push(day(back, {
      ...doses(skipped ? 'missed' : 'taken', opts.lithiumToo && skipped ? 'missed' : 'taken'),
      ...(after ? { sleep: 5, mood: 'elevated' } : {}),
    }));
  }
  return out;
}

// ── The quetiapine pattern is found, with honest counts ────────────────────
{
  const r = L.analyse(journal());
  const q = r.find((m) => m.name === 'Quetiapine');
  assert.ok(q, 'quetiapine has enough data');
  assert.strictEqual(q.skipped, 11);
  assert.strictEqual(q.taken, 20);
  const sleep = q.findings.find((f) => f.id === 'sleep');
  assert.ok(sleep, 'less sleep the night after is found');
  assert.strictEqual(sleep.lag, 1);
  assert.strictEqual(sleep.a, 5);
  assert.strictEqual(sleep.b, 7.5);
  assert.strictEqual(sleep.n, 10, 'the last skipped day has no next day yet');
  const up = q.findings.find((f) => f.id === 'up');
  assert.ok(up && up.lag === 1 && up.x === 10 && up.n === 10 && up.y === 0, 'elevated the day after: 10 of 10 vs 0 of 20');
  assert.ok(!q.findings.some((f) => f.id === 'stable' && f.lag === 1), '"stable less often" is dropped beside "elevated more often"');
  assert.ok(q.findings.length <= 3);
  assert.deepStrictEqual(q.together, []);
  // Lithium / sertraline never skipped: not enough days to compare, no card.
  assert.ok(!r.find((m) => m.name === 'Lithium'));
}

// ── Same journal is read the same way every time (seeded permutation test) ─
assert.deepStrictEqual(L.analyse(journal()), L.analyse(journal()));

// ── Not enough days: no card ───────────────────────────────────────────────
{
  const few = journal().slice(-12);   // 4 skipped days
  assert.deepStrictEqual(L.analyse(few), []);
}

// ── No real difference: a card that says so, with no findings ───────────────
{
  const flat = [];
  for (let back = 30; back >= 0; back--) flat.push(day(back, doses(back % 3 === 0 ? 'missed' : 'taken')));
  const q = L.analyse(flat).find((m) => m.name === 'Quetiapine');
  assert.ok(q && q.findings.length === 0);
}

// ── Old single-answer days and auto-filled days don't count ────────────────
{
  const e = journal();
  const old = [];
  for (let back = 80; back >= 50; back--) old.push(day(back, { medication: back % 2 ? 'not-taken' : 'taken', sleep: 4 }));
  const q = L.analyse(e.concat(old)).find((m) => m.name === 'Quetiapine');
  assert.strictEqual(q.skipped + q.taken, 31, 'days without medDoses are left out');
  const auto = e.map((x) => ({ ...x, autoFilled: true }));
  assert.deepStrictEqual(L.analyse(auto), [], 'auto-filled days are estimates');
}

// ── Skipped together with another medicine: says it can't separate them ───
{
  const r = L.analyse(journal({ lithiumToo: true }));
  assert.deepStrictEqual(r.find((m) => m.name === 'Quetiapine').together, ['Lithium']);
  assert.deepStrictEqual(r.find((m) => m.name === 'Lithium').together, ['Quetiapine']);
}

// ── Renamed spelling groups by name, shows the latest ──────────────────────
{
  const e = journal().map((x, i) => i < 10 ? { ...x, medDoses: Object.fromEntries(Object.entries(x.medDoses).map(([k, v]) => [k === 'Quetiapine' ? 'quetiapine ' : k, v])) } : x);
  const q = L.analyse(e).find((m) => /quetiapine/i.test(m.name));
  assert.strictEqual(q.name, 'Quetiapine');
  assert.strictEqual(q.skipped + q.taken, 31);
}

// ── Fisher's exact test against known values ───────────────────────────────
{
  const f = L._pure.fisher;
  assert.ok(Math.abs(f(4, 6, 1, 12) - 0.0217) < 0.0005, 'fisher(4/6 vs 1/12) ≈ 0.0217 (hand-worked hypergeometric)');
  assert.ok(f(3, 6, 6, 12) > 0.99, 'same share → p = 1');
}

// ── The words: translated sentences, the caution, plain text only ──────────
function loadStrings() {
  const out = {};
  const ctx = { window: { BB: { i18n: { extend: (code, o) => { out[code] = o.medLink; } } } } };
  ctx.BB = ctx.window.BB;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/shared/i18n-medlink.js'), 'utf8'), ctx);
  return out;
}
const S = loadStrings();
{
  // A tiny BB.t over the English strings, as the app's does it.
  globalThis.BB = { t: (k, v) => {
    let s = k.split('.').reduce((o, p) => o && o[p], S);
    if (typeof s !== 'string') s = k;
    Object.keys(v || {}).forEach((n) => { s = s.split('{' + n + '}').join(String(v[n])); });
    return s;
  } };
  S.medLink = S.en; // BB.t('medLink.x') → S.medLink.x
  const cards = L.insights(journal({}).concat());
  const q = cards.find((c) => c.name === 'Quetiapine');
  assert.strictEqual(q.title, 'Quetiapine: days taken and not taken');
  assert.match(q.text, /You slept about 5h the night after a day you didn’t take it, and about 7h 30m after a day you did\./);
  assert.match(q.text, /elevated or manic on 10 of 10 days after a day you didn’t take it, and on 0 of 20/);
  assert.match(q.detail, /11 days you didn’t take it and 20 days you did/);
  assert.match(q.detail, /talk to your prescriber/i);
  assert.ok(!/\{\w+\}|medLink\./.test(q.title + q.text + q.detail), 'no raw keys or placeholders');
  // A name with placeholder-looking text stays as typed.
  const odd = journal().map((x) => ({ ...x, medDoses: { 'Q {med} $&': x.medDoses.Quetiapine, Lithium: 'taken' } }));
  assert.strictEqual(L.insights(odd)[0].title, 'Q {med} $&: days taken and not taken');
  // Nothing tells anyone off or claims a cause.
  const all = JSON.stringify(S.en);
  assert.ok(!/(should|must|forgot|failed|because|caused|better|worse)/i.test(all), 'no telling off, no cause, no better / worse');
  delete globalThis.BB;
}

// ── Every key in all ten languages, same placeholders, none unused ─────────
{
  assert.deepStrictEqual(Object.keys(S).filter((k) => k !== 'medLink').sort(), ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'zh']);
  const used = new Set(['title', 'basis', 'none', 'together', 'caution', 'h', 'hm']);
  L._pure.MEASURES.forEach((m) => m.lags.forEach((l) => used.add(m.id + l)));
  const ph = (v) => [...new Set((String(v).match(/\{\w+\}/g) || []))].sort().join();
  for (const k of used) {
    assert.ok(typeof S.en[k] === 'string', `en.${k} missing`);
    for (const code of ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'zh']) {
      assert.ok(typeof S[code][k] === 'string', `${code}.${k} missing`);
      assert.strictEqual(ph(S[code][k]), ph(S.en[k]), `${code}.${k} placeholders differ`);
    }
  }
  assert.deepStrictEqual(Object.keys(S.en).filter((k) => !used.has(k)), [], 'unused English strings');
}

console.log('med-link: all checks passed');
