// node scripts/test-weekly-insight.js — checks functions/weekly-insight.js's
// input whitelist, week counts and reply parsing. No API call, no emulator.
'use strict';
const assert = require('assert');
const { sanitiseDays, weekCounts, buildPrompt, parseInsight, MAX_DAYS } = require('../functions/weekly-insight')._lib;

function day(n, extra) {
  const d = new Date(Date.UTC(2026, 9, 1 + n));
  return { date: d.toISOString().slice(0, 10), mood: 'stable', ...extra };
}

// ── sanitiseDays: only whitelisted fields, valid values, one per date ──────
{
  const [d] = sanitiseDays([day(0, {
    notes: 'private thoughts', medNames: ['quetiapine'], customFields: { x: 'yes' },
    personalName: 'A', energy: 7, sleep: 6.5, steps: 4200, medication: 'some',
    anxiety: 'loud', alcohol: 'yes', linkedMoods: ['low'],
  })]);
  assert.deepStrictEqual(Object.keys(d).sort(),
    ['alcohol', 'date', 'energy', 'linkedMoods', 'medication', 'mood', 'sleep', 'steps']);
  assert.ok(!JSON.stringify(d).includes('private'), 'notes must never pass');
  assert.ok(!JSON.stringify(d).includes('quetiapine'), 'medicine names must never pass');
}
assert.deepStrictEqual(sanitiseDays([{ date: '2026-10-01', mood: 'happy' }]), [], 'unknown mood drops the day');
assert.deepStrictEqual(sanitiseDays([{ date: '1 Oct', mood: 'low' }]), [], 'bad date drops the day');
assert.deepStrictEqual(sanitiseDays('nope'), []);
{
  const out = sanitiseDays([day(1, { mood: 'low' }), day(1, { mood: 'manic' }), day(0)]);
  assert.strictEqual(out.length, 2, 'one per date');
  assert.strictEqual(out[0].date < out[1].date, true, 'oldest first');
  assert.strictEqual(out[1].mood, 'manic', 'the later copy of a date wins');
}
{
  const many = Array.from({ length: 30 }, (_, i) => day(i));
  const out = sanitiseDays(many);
  assert.strictEqual(out.length, MAX_DAYS);
  assert.strictEqual(out[out.length - 1].date, many[29].date, 'keeps the newest days');
}

// ── weekCounts: this week = 7 days up to the newest date; auto-fill ignored ──
{
  const days = sanitiseDays([
    day(0, { mood: 'depressed' }),                       // last week: not counted
    day(7, { mood: 'depressed' }), day(8, { mood: 'depressed' }),
    day(9, { mood: 'depressed', autoFilled: true }),     // estimate: not counted
    day(13),
  ]);
  const c = weekCounts(days);
  assert.strictEqual(c.logged, 3);
  assert.strictEqual(c.depressed, 2);
  assert.strictEqual(c.checkIn, false);
  assert.strictEqual(weekCounts(sanitiseDays([day(5, { mood: 'depressed' }), ...days])).checkIn, false,
    'a low day 8 days back is last week');
  assert.strictEqual(weekCounts(sanitiseDays([...days, day(12, { mood: 'depressed' })])).checkIn, true);
  assert.strictEqual(weekCounts(sanitiseDays([day(1, { mood: 'manic' }), day(2, { mood: 'manic' })])).checkIn, true);
  assert.deepStrictEqual(weekCounts([]), { logged: 0, depressed: 0, manic: 0, checkIn: false });
}

// ── buildPrompt: language named, data fenced ────────────────────────────────
{
  const days = sanitiseDays([day(0)]);
  const p = buildPrompt(days, weekCounts(days), 'fr');
  assert.ok(p.startsWith('Write in French.'));
  assert.ok(p.includes('<entries>\n{"date":"2026-10-01","mood":"stable"}\n</entries>'));
  assert.ok(buildPrompt(days, weekCounts(days), 'xx').startsWith('Write in English.'));
}

// ── parseInsight ────────────────────────────────────────────────────────────
{
  const ok = parseInsight(JSON.stringify({
    headline: 'A steadier week.', observations: ['One.', '', 'Two.', 'Three.', 'Four.'], suggestion: 'Rest.',
  }));
  assert.deepStrictEqual(ok, { headline: 'A steadier week.', observations: ['One.', 'Two.', 'Three.'], suggestion: 'Rest.' });
  assert.strictEqual(parseInsight('not json'), null);
  assert.strictEqual(parseInsight('{"headline":"x","observations":[]}'), null);
  const long = parseInsight(JSON.stringify({ headline: 'word '.repeat(60), observations: ['x'], suggestion: '' }));
  assert.ok(long.headline.length <= 121 && long.headline.endsWith('…'));
}

console.log('weekly-insight: all checks passed');
