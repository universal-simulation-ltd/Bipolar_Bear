#!/usr/bin/env node
/**
 * Unit tests for the pure parts of js/shared/safety-plan.js: the low-days
 * threshold, its show-at-most-every-4-days rule, and plan normalisation.
 *
 *   node scripts/test-safety-plan.js
 */
'use strict';
const assert = require('assert');
const { safetyPlan: P, lowMoodSupport: L } = require('../js/shared/safety-plan.js');

let n = 0;
function t(name, fn) { fn(); n++; console.log('  ✓ ' + name); }

const today = '2026-10-04';
const days = (pairs) => Object.fromEntries(pairs);

console.log('detectLowRun');
t('3 of the last 5 depressed, latest depressed → due', () => {
  const r = L.detectLowRun(days([['2026-10-04', 'depressed'], ['2026-10-03', 'stable'], ['2026-10-02', 'depressed'], ['2026-09-30', 'low'], ['2026-09-29', 'depressed']]), today);
  assert.strictEqual(r.due, true); assert.strictEqual(r.depressed, 3); assert.strictEqual(r.of, 5);
});
t('latest is low → still due', () => {
  assert.strictEqual(L.detectLowRun(days([['2026-10-04', 'low'], ['2026-10-03', 'depressed'], ['2026-10-02', 'depressed'], ['2026-10-01', 'depressed']]), today).due, true);
});
t('latest back to stable → not due', () => {
  assert.strictEqual(L.detectLowRun(days([['2026-10-04', 'stable'], ['2026-10-03', 'depressed'], ['2026-10-02', 'depressed'], ['2026-10-01', 'depressed']]), today).due, false);
});
t('only 2 depressed of 5 → not due', () => {
  assert.strictEqual(L.detectLowRun(days([['2026-10-04', 'depressed'], ['2026-10-03', 'low'], ['2026-10-02', 'low'], ['2026-10-01', 'depressed'], ['2026-09-30', 'low']]), today).due, false);
});
t('a run of low (not depressed) days alone → not due', () => {
  assert.strictEqual(L.detectLowRun(days([['2026-10-04', 'low'], ['2026-10-03', 'low'], ['2026-10-02', 'low'], ['2026-10-01', 'low'], ['2026-09-30', 'low']]), today).due, false);
});
t('fewer than 3 logged days → not due', () => {
  assert.strictEqual(L.detectLowRun(days([['2026-10-04', 'depressed'], ['2026-10-03', 'depressed']]), today).due, false);
});
t('old depressed days (10+ days ago) are ignored', () => {
  assert.strictEqual(L.detectLowRun(days([['2026-10-04', 'low'], ['2026-09-23', 'depressed'], ['2026-09-22', 'depressed'], ['2026-09-21', 'depressed']]), today).due, false);
});
t('only the 5 most recent logged days count', () => {
  // 5 recent: D S S S D (2 depressed) — older depressed days outside the 5 don't add.
  const r = L.detectLowRun(days([['2026-10-04', 'depressed'], ['2026-10-03', 'stable'], ['2026-10-02', 'stable'], ['2026-10-01', 'stable'], ['2026-09-30', 'depressed'], ['2026-09-29', 'depressed'], ['2026-09-28', 'depressed']]), today);
  assert.strictEqual(r.due, false); assert.strictEqual(r.depressed, 2);
});
t('future-dated days are ignored', () => {
  assert.strictEqual(L.detectLowRun(days([['2026-10-06', 'depressed'], ['2026-10-05', 'depressed'], ['2026-10-04', 'stable'], ['2026-10-03', 'depressed']]), today).due, false);
});

console.log('byDayFromEntries');
t('skips auto-filled estimates, keeps the latest entry per day, maps the 0–10 spectrum', () => {
  const at = (d, h) => new Date(d + 'T' + String(h).padStart(2, '0') + ':00:00').getTime();
  const m = L.byDayFromEntries([
    { date: '2026-10-04T12:00:00', mood: 1, timestamp: at('2026-10-04', 9) },
    { date: '2026-10-04T12:00:00', mood: 'stable', timestamp: at('2026-10-04', 8) },
    { date: '2026-10-03T12:00:00', mood: 'depressed', autoFilled: true, timestamp: 1 },
    { date: '2026-10-02T12:00:00', mood: 'good', timestamp: 2 },
    { date: '2026-10-01T12:00:00', mood: 3, timestamp: 3 },
  ]);
  assert.deepStrictEqual(m, { '2026-10-04': 'depressed', '2026-10-02': 'stable', '2026-10-01': 'low' });
});

console.log('shouldShow (at most once every 4 days)');
const S = (o) => Object.assign({ off: false, due: today, shown: null, dismissed: null }, o);
t('due today, never shown → show', () => assert.strictEqual(L.shouldShow(S({}), today), true));
t('turned off → never', () => assert.strictEqual(L.shouldShow(S({ off: true }), today), false));
t('not due → no', () => assert.strictEqual(L.shouldShow(S({ due: null }), today), false));
t('due is 2 days stale → no', () => assert.strictEqual(L.shouldShow(S({ due: '2026-10-02' }), today), false));
t('due yesterday (home before the journal re-checks) → yes', () => assert.strictEqual(L.shouldShow(S({ due: '2026-10-03' }), today), true));
t('shown earlier today, not dismissed → keep showing', () => assert.strictEqual(L.shouldShow(S({ shown: today }), today), true));
t('shown and dismissed today → no', () => assert.strictEqual(L.shouldShow(S({ shown: today, dismissed: today }), today), false));
t('shown 3 days ago → no', () => assert.strictEqual(L.shouldShow(S({ shown: '2026-10-01' }), today), false));
t('shown 4 days ago → yes again', () => assert.strictEqual(L.shouldShow(S({ shown: '2026-09-30' }), today), true));

console.log('plan normalise');
t('drops empty items, trims, keeps one widget contact with a real number', () => {
  const p = P.normalise({
    updatedAt: 5,
    warningSigns: ['  not sleeping ', '', null],
    helpPeople: [{ name: 'Sam', phone: '07700 900123', onWidget: true }, { name: 'Jo', phone: '+44 7700 900456', onWidget: true }, { name: '', phone: '' }],
    professionals: [{ name: 'GP', phone: 'n/a', onWidget: true }],
    junk: ['x'],
  });
  assert.deepStrictEqual(p.warningSigns, ['not sleeping']);
  assert.strictEqual(p.helpPeople.length, 2);
  assert.strictEqual(p.helpPeople[0].onWidget, true);
  assert.strictEqual(p.helpPeople[1].onWidget, undefined);
  assert.strictEqual(p.professionals[0].onWidget, undefined);
  assert.strictEqual(p.junk, undefined);
  assert.strictEqual(P.hasContent(p), true);
  assert.strictEqual(P.hasContent(P.blankPlan()), false);
  assert.deepStrictEqual(P.contacts(p).map(c => c.name), ['Sam', 'Jo']);
});
t('caps each item at 300 characters and each section at 20 items', () => {
  const p = P.normalise({ reasons: Array.from({ length: 30 }, () => 'x'.repeat(400)) });
  assert.strictEqual(p.reasons.length, 20);
  assert.strictEqual(p.reasons[0].length, 300);
});
t('sections follow the Stanley-Brown order', () => {
  assert.deepStrictEqual(P.SECTIONS.map(s => s.id), ['warningSigns', 'coping', 'distraction', 'helpPeople', 'professionals', 'safeEnv', 'reasons']);
});

console.log('\n' + n + ' passed');
