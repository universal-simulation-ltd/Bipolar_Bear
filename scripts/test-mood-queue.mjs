// Reminder mood buttons (1.44): the queue-filing logic in js/shared/mood-queue.js.
// Runs the real module in a vm with a fake native queue
// (Capacitor.Plugins.BipolarBearMoodQueue) and a journal adapter that
// encrypts with real WebCrypto (AES-GCM, as journal.js _userEncrypt does).
// Checks: one entry per day and the latest tap wins; a day that already has
// an entry is never overwritten (its taps are dropped); bad moods, bad days
// and future days are dropped; nothing is filed (and nothing leaves the
// queue) while an encrypted save isn't possible; a failed save or an offline
// "which days are logged" keeps the taps; a tap leaves the queue only after
// its entry is saved; what is stored is ciphertext only; spectrum mode maps
// the category like the widget link; taps without a `day` follow
// "log today"; the home page opens the journal once per tap per session.
// Run: TZ=Europe/London node scripts/test-mood-queue.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../js/shared/mood-queue.js', import.meta.url), 'utf8');

function makeEnv(queue, opts = {}) {
  const q = queue.map(t => ({ ...t }));
  const calls = [];
  const plugin = {
    pending: async () => { calls.push('pending'); return { taps: q.map(t => ({ ...t })) }; },
    remove: async ({ ids }) => {
      calls.push('remove:' + ids.join(','));
      if (opts.removeFails) throw new Error('native said no');
      for (const id of ids) { const i = q.findIndex(t => t.id === id); if (i >= 0) q.splice(i, 1); }
      return { left: q.length };
    },
  };
  const ss = new Map();
  let replaced = null;
  const overlay = { style: { display: opts.pinUp ? 'flex' : 'none' } };
  const win = {
    Capacitor: { isNativePlatform: () => opts.native !== false, Plugins: opts.noPlugin ? {} : { BipolarBearMoodQueue: plugin } },
    sessionStorage: { getItem: k => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)), removeItem: k => ss.delete(k) },
    document: { getElementById: id => (id === 'guestPinOverlay' ? overlay : null) },
    location: { replace: u => { replaced = u; } },
    Intl, Date, JSON, Promise, Error, Object, Array, Set, Number, String, Math, isFinite,
    setTimeout, console: { warn() {}, log: console.log },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(src, win);
  return { M: win.BB.moodQueue, q, calls, overlay, ss, replaced: () => replaced };
}

// A journal adapter: entries are encrypted with a real AES-GCM key before
// they are "written"; the store keeps only what Firestore would.
async function makeJournal({ ready = true, logged = [], failOn = null, offline = false, loggingToday = false, spectrum = false } = {}) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const store = [];
  const done = [];
  const adapter = {
    ready: async () => ready,
    loggedDays: async () => { if (offline) throw new Error('Failed to get documents from server'); return new Set(logged); },
    persist: async entry => {
      if (failOn && failOn(entry)) throw new Error('write failed');
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ ...entry, userId: 'u' })));
      store.push({ userId: 'u', timestamp: entry.timestamp, _enc: Buffer.from(ct).toString('base64'), _iv: Buffer.from(iv).toString('base64') });
    },
    loggingToday: () => loggingToday,
    spectrum: () => spectrum,
    done: r => done.push(JSON.parse(JSON.stringify(r))),
  };
  const open = async doc => JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(doc._iv, 'base64') }, key, Buffer.from(doc._enc, 'base64'))));
  return { adapter, store, done, open };
}

let pass = 0;
const ok = label => { pass++; console.log('PASS', label); };
const J = x => JSON.parse(JSON.stringify(x));
const at = s => new Date(s).getTime();
const NOW = new Date('2026-10-19T09:00:00');

// 1. plan(): one per day, latest wins, logged days dropped, bad ones dropped.
{
  const { M } = makeEnv([]);
  const p = J(M.plan([
    { id: 'a', mood: 'low', at: at('2026-10-18T07:00:00'), day: '2026-10-17' },
    { id: 'b', mood: 'stable', at: at('2026-10-18T07:05:00'), day: '2026-10-17' },   // later: wins
    { id: 'c', mood: 'manic', at: at('2026-10-19T07:00:00'), day: '2026-10-18' },    // already logged
    { id: 'd', mood: 'happy', at: at('2026-10-19T07:00:00'), day: '2026-10-18' },    // not a mood
    { id: 'e', mood: 'low', at: at('2026-10-19T07:00:00'), day: '2026-02-30' },      // not a date → falls back to at
    { id: 'f', mood: 'low', at: at('2026-10-19T07:00:00'), day: '2026-10-25' },      // future
    { mood: 'low', at: at('2026-10-19T07:00:00'), day: '2026-10-16' },               // no id: left alone
    { id: 'g', mood: 'DEPRESSED', at: at('2026-10-16T07:00:00'), day: '2026-10-15' },
  ], { logged: ['2026-10-18'], now: NOW }));
  assert.deepEqual(p.file.map(x => [x.day, x.mood, x.ids]), [
    ['2026-10-15', 'depressed', ['g']],
    ['2026-10-17', 'stable', ['a', 'b']],
  ]);
  assert.equal(p.drop.length, 3); // c + e share the 18th
  const byId = Object.fromEntries(p.drop.flatMap(d => d.ids.map(i => [i, d.reason])));
  assert.equal(byId.c, 'logged');
  assert.equal(byId.d, 'invalid');
  assert.equal(byId.f, 'invalid');
  // 'e' had a bad `day`, so its day comes from its time: 19 Oct 07:00 → the 18th (logged).
  assert.equal(byId.e, 'logged');
  ok('plan: one entry a day, latest tap wins, logged days never filed, bad / future taps dropped');
}

// 2. A tap without `day` follows "log today" (yesterday by default).
{
  const { M } = makeEnv([]);
  assert.equal(M.tapDay({ at: at('2026-10-19T07:00:00') }, false), '2026-10-18');
  assert.equal(M.tapDay({ at: at('2026-10-19T07:00:00') }, true), '2026-10-19');
  assert.equal(M.tapDay({ at: at('2026-10-01T00:30:00') }, false), '2026-09-30');
  assert.equal(M.tapDay({ day: '2026-10-10', at: 0 }, true), '2026-10-10');
  assert.equal(M.tapDay({}, false), null);
  ok('tapDay: native day first, else yesterday / today from the tap time');
}

// 3. file(): saved encrypted, then removed; the toast data says what happened.
{
  const env = makeEnv([
    { id: 't1', mood: 'low', at: at('2026-10-18T07:00:00'), day: '2026-10-17' },
    { id: 't2', mood: 'elevated', at: at('2026-10-19T07:00:00'), day: '2026-10-18' },
  ]);
  const j = await makeJournal({ logged: ['2026-10-18'] });
  const r = J(await env.M.file(j.adapter));
  assert.deepEqual(r, { filed: 1, dropped: 1, held: 0 });
  assert.equal(env.q.length, 0, 'both taps left the queue');
  assert.equal(j.store.length, 1);
  assert.deepEqual(Object.keys(j.store[0]).sort(), ['_enc', '_iv', 'timestamp', 'userId']);
  assert.ok(!JSON.stringify(j.store).includes('low'), 'no mood in plaintext');
  const e = await j.open(j.store[0]);
  assert.equal(e.mood, 'low');
  assert.equal(e.loggedVia, 'reminder');
  assert.equal(e.autoFilled, undefined, 'a tap is the user\'s own report, not an estimate');
  assert.equal(new Date(e.date).toDateString(), new Date('2026-10-17T12:00:00').toDateString());
  assert.equal(e.timestamp, new Date('2026-10-17T12:00:00').getTime());
  assert.equal(e.recordedAt, new Date('2026-10-18T07:00:00').toISOString());
  assert.equal(j.done.length, 1);
  assert.deepEqual(j.done[0].filed.map(f => f.day), ['2026-10-17']);
  assert.deepEqual(j.done[0].dropped.map(f => [f.day, f.mood]), [['2026-10-18', 'elevated']]);
  // remove() came after the save, never before it.
  const iRemove = env.calls.indexOf('remove:t1');
  assert.ok(iRemove > 0);
  ok('file: encrypted entry saved, then the tap removed; a logged day\'s tap dropped, not written');
}

// 4. Not ready (no key / Private journal locked / guest storage not ready): nothing moves.
{
  const env = makeEnv([{ id: 't1', mood: 'low', at: at('2026-10-18T07:00:00'), day: '2026-10-17' }]);
  const j = await makeJournal({ ready: false });
  const r = J(await env.M.file(j.adapter));
  assert.deepEqual(r, { filed: 0, dropped: 0, held: 1 });
  assert.equal(env.q.length, 1);
  assert.equal(j.store.length, 0);
  assert.ok(!env.calls.some(c => c.startsWith('remove')));
  ok('file: without an encrypted save available, nothing is written and the tap stays queued');
}

// 5. Offline ("which days are logged" unknown): hold everything.
{
  const env = makeEnv([{ id: 't1', mood: 'low', at: at('2026-10-18T07:00:00'), day: '2026-10-17' }]);
  const j = await makeJournal({ offline: true });
  const r = J(await env.M.file(j.adapter));
  assert.equal(r.filed, 0);
  assert.equal(env.q.length, 1);
  assert.equal(j.store.length, 0);
  ok('file: when the logged days can\'t be read from the server, the taps wait');
}

// 6. A failed save keeps that tap (and the ones after it); earlier saves stay done.
{
  const env = makeEnv([
    { id: 'a', mood: 'low', at: at('2026-10-15T07:00:00'), day: '2026-10-14' },
    { id: 'b', mood: 'stable', at: at('2026-10-16T07:00:00'), day: '2026-10-15' },
    { id: 'c', mood: 'manic', at: at('2026-10-17T07:00:00'), day: '2026-10-16' },
  ]);
  const j = await makeJournal({ failOn: e => e.mood === 'stable' });
  const r = J(await env.M.file(j.adapter));
  assert.equal(r.filed, 1);
  assert.deepEqual(env.q.map(t => t.id), ['b', 'c']);
  assert.equal(j.store.length, 1);
  // Next open: the save works now, and 'a''s day is logged so nothing doubles.
  const j2 = await makeJournal({ logged: ['2026-10-14'] });
  const r2 = J(await env.M.file(j2.adapter));
  assert.deepEqual(r2, { filed: 2, dropped: 0, held: 0 });
  assert.equal(env.q.length, 0);
  ok('file: a failed save keeps its tap for next time; nothing is saved twice');
}

// 7. If the native side can't remove a filed tap, the next run sees the day logged and drops it.
{
  const env = makeEnv([{ id: 'a', mood: 'low', at: at('2026-10-18T07:00:00'), day: '2026-10-17' }], { removeFails: true });
  const j = await makeJournal();
  await env.M.file(j.adapter);
  assert.equal(j.store.length, 1);
  assert.equal(env.q.length, 1, 'still queued');
  const j2 = await makeJournal({ logged: ['2026-10-17'] });
  const r = J(await env.M.file(j2.adapter));
  assert.equal(r.filed, 0);
  assert.equal(j2.store.length, 0, 'never written twice');
  ok('file: a tap the queue failed to drop is not filed again');
}

// 8. Spectrum mode stores the spectrum value, like the widget's ?mood= link.
{
  const env = makeEnv([{ id: 'a', mood: 'elevated', at: at('2026-10-18T07:00:00'), day: '2026-10-17' }]);
  const j = await makeJournal({ spectrum: true });
  await env.M.file(j.adapter);
  assert.equal((await j.open(j.store[0])).mood, 7);
  ok('file: full-spectrum mood maps the category (elevated → 7)');
}

// 9. Web / an old native build / no plugin: nothing happens.
{
  for (const o of [{ native: false }, { noPlugin: true }]) {
    const env = makeEnv([{ id: 'a', mood: 'low', at: 1, day: '2026-10-17' }], o);
    const j = await makeJournal();
    const r = J(await env.M.file(j.adapter));
    assert.deepEqual(r, { filed: 0, dropped: 0, held: 0 });
    assert.equal(j.store.length, 0);
  }
  ok('file: no native queue, no work');
}

// 10. Two runs at once (load + resume): the second waits, nothing doubles.
{
  const env = makeEnv([{ id: 'a', mood: 'low', at: at('2026-10-18T07:00:00'), day: '2026-10-17' }]);
  const j = await makeJournal();
  const [r1, r2] = await Promise.all([env.M.file(j.adapter), env.M.file(j.adapter)]);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(j.store.length, 1);
  assert.ok(J(r2).busy);
  ok('file: overlapping runs don\'t save a tap twice');
}

// 11. The home page opens the journal once per tap per session, and never over the PIN screen.
{
  const env = makeEnv([{ id: 'a', mood: 'low', at: 1, day: '2026-10-17' }], { pinUp: true });
  assert.equal(await env.M.openJournalIfPending(), false, 'PIN screen up');
  env.overlay.style.display = 'none';
  assert.equal(await env.M.openJournalIfPending(), true);
  assert.equal(env.replaced(), 'journal.html');
  assert.equal(await env.M.openJournalIfPending(), false, 'not again for the same tap');
  env.q.push({ id: 'b', mood: 'stable', at: 2, day: '2026-10-18' });
  assert.equal(await env.M.openJournalIfPending(), true, 'a new tap opens it again');
  const empty = makeEnv([]);
  assert.equal(await empty.M.openJournalIfPending(), false);
  ok('openJournalIfPending: once per tap, not over the PIN screen, not when empty');
}

// 12. The reminder's buttons: five, in mood order, with the ids the native side matches.
{
  const { M } = makeEnv([]);
  const t = J(M.actionTypes());
  assert.equal(t.types[0].id, 'bb.mood');
  assert.deepEqual(t.types[0].actions.map(a => a.id), ['bg.mood.manic', 'bg.mood.elevated', 'bg.mood.stable', 'bg.mood.low', 'bg.mood.depressed']);
  assert.ok(t.types[0].actions.every(a => a.requiresAuthentication && a.title));
  ok('actionTypes: bb.mood with bg.mood.<mood> buttons');
}

console.log(`\n${pass} passed`);
