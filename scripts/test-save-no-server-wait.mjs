#!/usr/bin/env node
/**
 * Checks for _awaitEntryWrite in js/journal.js (v392, from a 2026-10-29 iOS
 * 1.41 support report: "Appears to be frozen and not saving"). A signed-in
 * save used to wait for the server to confirm the Firestore write, which on a
 * weak signal never came. Now it waits at most 4 s while the offline cache is
 * on, then carries on as saved with a note. The function is taken out of
 * journal.js as written and run with stubs.
 *
 * Negative control: with the offline cache off it must still wait for the
 * server (the queue is in memory only there).
 *
 *   node scripts/test-save-no-server-wait.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'js/journal.js'), 'utf8');
const start = src.indexOf('    async function _awaitEntryWrite(');
assert.ok(start > 0, '_awaitEntryWrite is in journal.js');
const fnSrc = src.slice(start, src.indexOf('\n    }\n', start) + 6);

let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }

function load(persistent) {
  const seen = { toasts: [], alerts: [] };
  const BB = { t: k => k, moodQueue: { toast: m => seen.toasts.push(m) } };
  const make = new Function('_fsPersistent', 'BB', 'window', 'alert', 'console',
    fnSrc + '\nreturn _awaitEntryWrite;');
  const fn = make(persistent, BB, { BB }, m => seen.alerts.push(m), { error() {} });
  return { fn, seen };
}
const later = (ms, v, fail) => new Promise((res, rej) => setTimeout(() => (fail ? rej(v) : res(v)), ms));
const since = t => Date.now() - t;

// 1. Confirmed quickly: no note, no wait.
{
  const { fn, seen } = load(true);
  const t = Date.now();
  await fn(later(50, 'ok'));
  assert.ok(since(t) < 1000);
  assert.equal(seen.toasts.length, 0);
  ok('a write the server confirms quickly saves with no note');
}

// 2. Server never answers: carries on after ~4 s with the note.
{
  const { fn, seen } = load(true);
  const t = Date.now();
  await fn(new Promise(() => {}));
  const ms = since(t);
  assert.ok(ms >= 3900 && ms < 5000, `waited ${ms} ms`);
  assert.deepEqual(seen.toasts, ['journal.toast.savedOnPhone']);
  assert.equal(seen.alerts.length, 0);
  ok(`a write the server never confirms carries on after ${ms} ms with "Saved on this device"`);
}

// 3. Rejected quickly: thrown to saveEntry's catch, not alerted here.
{
  const { fn, seen } = load(true);
  await assert.rejects(fn(later(50, Object.assign(new Error('no'), { code: 'permission-denied' }), true)));
  await later(20);
  assert.equal(seen.alerts.length, 0);
  ok('a quick rejection goes to saveEntry\'s own error handling');
}

// 4. Rejected after it was treated as saved: still reported.
{
  const { fn, seen } = load(true);
  await fn(later(4300, Object.assign(new Error('no'), { code: 'permission-denied' }), true));
  await later(500);
  assert.deepEqual(seen.alerts, ['journal.dlg.savePermDenied']);
  ok('a rejection that comes after the note is still reported');
}

// 5. Negative control: no offline cache, so it waits for the server.
{
  const { fn, seen } = load(undefined);
  const t = Date.now();
  await fn(later(4600, 'ok'));
  assert.ok(since(t) >= 4500);
  assert.equal(seen.toasts.length, 0);
  ok('without the offline cache it still waits for the server');
}

// 6. Every signed-in entry write in saveEntry goes through it.
{
  const s = src.indexOf('    async function saveEntry(');
  const body = src.slice(s, src.indexOf('\n    }\n', s));
  const writes = body.match(/await [^\n;]*collection\('entries'\)[^\n]*/g) || [];
  assert.equal(writes.length, 4);
  writes.forEach(w => assert.match(w, /_awaitEntryWrite\(/));
  ok('all 4 entry writes in saveEntry use _awaitEntryWrite');
}

console.log(`\n${passed} passed`);
