#!/usr/bin/env node
/**
 * Date checks for the awareness-day card (js/shared/awareness.js, v396): the
 * countdown starts 5 days before, the day itself is "today", it is gone the
 * day after, Time to Talk Day (first Thursday of February) shows only in the
 * UK, a hidden day stays hidden for that year only, and the holidays
 * (Halloween, Christmas, New Year) hand over to each other across December.
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
check('hidden this year, back next year', () => {
  assert.equal(A.current(d('2027-03-28'), { ...world, hidden: ['wbd:2027'] }), null);
  assert.equal(A.current(d('2028-03-28'), { ...world, hidden: ['wbd:2027'] }).id, 'wbd');
});
check('Halloween: 3 days before', () => { const e = A.current(d('2027-10-28'), world); assert.equal(e.id, 'hal'); assert.equal(e.daysLeft, 3); });
check('Christmas Eve: Christmas tomorrow', () => { const e = A.current(d('2027-12-24'), world); assert.equal(e.id, 'xmas'); assert.equal(e.daysLeft, 1); });
check('4 December: nothing yet', () => assert.equal(A.current(d('2026-12-04'), world), null));
check('5 December: Christmas in 20 days, already in its colours', () => { const e = A.current(d('2026-12-05'), world); assert.equal(e.id, 'xmas'); assert.equal(e.daysLeft, 20); assert.ok(A.themed(e)); });
check('Halloween countdown: no colours until the day', () => { assert.ok(!A.themed(A.current(d('2027-10-28'), world))); assert.ok(A.themed(A.current(d('2027-10-31'), world))); });
check('only Christmas asks "Feeling lonely?"', () => assert.deepEqual(A.DAYS.filter(x => x.lonely).map(x => x.id), ['xmas']));
check('Boxing Day: New Year in 6 days', () => { const e = A.current(d('2027-12-26'), world); assert.equal(e.id, 'ny'); assert.equal(e.daysLeft, 6); assert.ok(!A.themed(e)); });
check('27 December: New Year in 5 days', () => { const e = A.current(d('2027-12-27'), world); assert.equal(e.id, 'ny'); assert.equal(e.daysLeft, 5); assert.equal(e.year, 2028); });
check("New Year's Eve: tomorrow", () => { const e = A.current(d('2027-12-31'), world); assert.equal(e.id, 'ny'); assert.equal(e.daysLeft, 1); });
check("New Year's Day: today", () => { const e = A.current(d('2028-01-01'), world); assert.equal(e.id, 'ny'); assert.equal(e.daysLeft, 0); });
console.log(`\n${n} checks passed`);
