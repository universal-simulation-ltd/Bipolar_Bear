#!/usr/bin/env node
/**
 * Date checks for the awareness-day card (js/shared/awareness.js, v396): the
 * countdown starts 5 days before, the day itself is "today", it is gone the
 * day after, Time to Talk Day (first Thursday of February) shows only in the
 * UK, and a hidden day stays hidden for that year only.
 *
 *   node scripts/test-awareness.mjs
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const A = require('../js/shared/awareness.js');
const d = (s) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd, 12); };
const uk = { inRegion: (r) => r === 'GB' };
const world = { inRegion: () => false };
let n = 0;
const check = (name, fn) => { fn(); n++; console.log('ok', name); };

check('6 days before World Bipolar Day: nothing', () => assert.equal(A.current(d('2027-03-24'), world), null));
check('5 days before: countdown', () => { const e = A.current(d('2027-03-25'), world); assert.equal(e.id, 'wbd'); assert.equal(e.daysLeft, 5); });
check('the day before: 1', () => assert.equal(A.current(d('2027-03-29'), world).daysLeft, 1));
check('the day: 0', () => { const e = A.current(d('2027-03-30'), world); assert.equal(e.id, 'wbd'); assert.equal(e.daysLeft, 0); assert.equal(e.year, 2027); });
check('the day after: nothing', () => assert.equal(A.current(d('2027-03-31'), world), null));
check('World Mental Health Day, 10 Oct', () => { const e = A.current(d('2027-10-07'), world); assert.equal(e.id, 'wmhd'); assert.equal(e.daysLeft, 3); });
check('Time to Talk Day 2027 is Thu 4 Feb', () => assert.equal(A.dateOf(A.DAYS.find(x => x.id === 'ttt'), 2027).toDateString(), new Date(2027, 1, 4).toDateString()));
check('Time to Talk Day 2028 is Thu 3 Feb', () => assert.equal(A.dateOf(A.DAYS.find(x => x.id === 'ttt'), 2028).toDateString(), new Date(2028, 1, 3).toDateString()));
check('Time to Talk Day: UK only', () => { assert.equal(A.current(d('2027-02-02'), uk).id, 'ttt'); assert.equal(A.current(d('2027-02-02'), world), null); });
check('a countdown across New Year never misfires (31 Dec)', () => assert.equal(A.current(d('2026-12-31'), uk), null));
check('hidden this year, back next year', () => {
  assert.equal(A.current(d('2027-03-28'), { ...world, hidden: ['wbd:2027'] }), null);
  assert.equal(A.current(d('2028-03-28'), { ...world, hidden: ['wbd:2027'] }).id, 'wbd');
});
console.log(`\n${n} checks passed`);
