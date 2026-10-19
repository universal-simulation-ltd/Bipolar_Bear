// Per-medicine tracking and the before / after comparison (1.44).
//
// Part 1 runs the pure helpers in js/journal-meds.js: old days' single
// `medication` answer read as before (migrate on read), the per-medicine
// record for an answer, the medicine list on a past day, adherence and the
// missed-dose log, blood results, and the comparison's rules (≥21 logged
// days each side, equal windows ≤90 days, auto-filled days left out, other
// changes flagged, "keep logging: N more days").
//
// Part 2 runs js/shared/secure-store.js (BB.medLog) against a mocked
// Firestore with real WebCrypto: side effects, blood levels and past changes
// only ever reach the account inside the encrypted blob, round-trip through a
// backup, merge across two devices (a delete isn't undone by the other
// device's copy), and wait on the device without a key.
//
// Run: node scripts/test-med-tracking.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../js/journal-meds.js');

let pass = 0;
const ok = label => { pass++; console.log('PASS', label); };
const day = (k, extra) => ({ date: M.fromKey(k).toISOString(), timestamp: M.fromKey(k).getTime(), ...extra });
const today = new Date(2026, 9, 19, 12);
const T = M.dayKey(today);

// ── Part 1: pure helpers ─────────────────────────────────────────────────────
{
  // Old days keep their single answer; nothing invented per medicine.
  assert.deepEqual(M.dosesOf({ medication: 'taken' }), { status: 'taken', perMed: null });
  assert.deepEqual(M.dosesOf({ medication: 'not-taken' }), { status: 'not-taken', perMed: null });
  assert.deepEqual(M.dosesOf({ medication: 'unsure' }), { status: 'unsure', perMed: null });
  assert.deepEqual(M.dosesOf({}), { status: null, perMed: null });
  // New days: per medicine, with the day's answer alongside.
  const e = { medication: 'not-taken', medDoses: { Lithium: 'missed', Quetiapine: 'taken' } };
  assert.deepEqual(M.dosesOf(e), { status: 'not-taken', perMed: { Lithium: 'missed', Quetiapine: 'taken' } });
  // Junk in medDoses is ignored; a per-medicine record alone gives the answer.
  assert.deepEqual(M.dosesOf({ medDoses: { A: 'taken', B: 'maybe', '': 'missed' } }), { status: 'taken', perMed: { A: 'taken' } });
  assert.deepEqual(M.dosesOf({ medDoses: ['x'] }), { status: null, perMed: null });
  assert.equal(M.dosesOf({ medDoses: { A: 'taken', B: 'missed' } }).status, 'not-taken');
  ok('old days read as one answer for every medicine; new days per medicine (migrate on read)');
}
{
  const names = ['Lithium', 'Quetiapine'];
  assert.deepEqual(M.dosesForAnswer('taken', names), { Lithium: 'taken', Quetiapine: 'taken' });
  assert.deepEqual(M.dosesForAnswer('not-taken', names), { Lithium: 'missed', Quetiapine: 'missed' }, 'not taken: all missed until picked');
  assert.deepEqual(M.dosesForAnswer('not-taken', names, { quetiapine: 'taken', Lithium: 'missed' }), { Lithium: 'missed', Quetiapine: 'taken' }, 'keeps the picks (case aside)');
  assert.deepEqual(M.dosesForAnswer('not-taken', names, { Lithium: 'taken', Quetiapine: 'taken' }), { Lithium: 'missed', Quetiapine: 'missed' }, 'not taken can\'t be all taken');
  assert.equal(M.dosesForAnswer('unsure', names), null);
  assert.equal(M.dosesForAnswer(null, names), null);
  assert.equal(M.dosesForAnswer('taken', []), null, 'no medicines, no per-medicine record');
  assert.deepEqual(M.dosesForAnswer('not-taken', ['Lithium']), { Lithium: 'missed' });
  assert.equal(M.aggregate({ Lithium: 'taken', Q: 'taken' }), 'taken');
  assert.equal(M.aggregate({ Lithium: 'taken', Q: 'missed' }), 'not-taken');
  ok('the record for each answer: taken → all, not taken → the picked ones missed, unsure → none');
}
{
  // Current list: Lithium 1000mg + Sertraline. History: baseline (Oct 1) Lithium 800,
  // dose 800 → 1000 (Oct 10), add Sertraline (Oct 12), stop Olanzapine (Oct 5);
  // typed-in: started Lithium on 1 March.
  const hist = [
    { at: new Date(2026, 9, 1, 9).toISOString(), type: 'baseline', name: 'Lithium', to: '800mg' },
    { at: new Date(2026, 9, 1, 9).toISOString(), type: 'baseline', name: 'Olanzapine', to: '5mg' },
    { at: new Date(2026, 9, 5, 9).toISOString(), type: 'stop', name: 'Olanzapine', from: '5mg' },
    { at: new Date(2026, 9, 10, 9).toISOString(), type: 'dose', name: 'Lithium', from: '800mg', to: '1000mg' },
    { at: new Date(2026, 9, 12, 9).toISOString(), type: 'add', name: 'Sertraline', to: '50mg', source: 'user' },
    { at: new Date(2026, 9, 13, 9).toISOString(), type: 'add', name: 'Imported', source: 'import' },
  ];
  const past = [{ id: 'p1', date: '2026-03-01', type: 'add', name: 'Lithium', to: '400mg' }, { id: 'p2', date: '2026-02-01', type: 'add', name: 'Gone', deleted: true }];
  const evs = M.allEvents(hist, past);
  const cur = [{ name: 'Lithium', dosage: '1000mg' }, { name: 'Sertraline', dosage: '50mg' }, { name: 'Imported', dosage: '' }];
  const at = k => M.listOnDay(evs, cur, k).map(m => m.name + (m.dosage ? ' ' + m.dosage : '')).sort();
  assert.deepEqual(at('2026-10-19'), ['Imported', 'Lithium 1000mg', 'Sertraline 50mg']);
  assert.deepEqual(at('2026-10-11'), ['Lithium 1000mg'], 'before Sertraline and the import');
  assert.deepEqual(at('2026-10-09'), ['Lithium 800mg']);
  assert.deepEqual(at('2026-10-04'), ['Lithium 800mg', 'Olanzapine 5mg'], 'a stopped medicine is back before its stop');
  assert.deepEqual(at('2026-02-20'), ['Olanzapine 5mg'], 'before the typed-in start, no Lithium');
  const ch = M.changeEvents(evs);
  assert.deepEqual(ch.map(e => e.type + ':' + e.name), ['add:Sertraline', 'dose:Lithium', 'stop:Olanzapine', 'add:Lithium'], 'newest first; no baselines, imports or deleted past changes');
  assert.ok(ch[3].manual && ch[3].day === '2026-03-01');
  ok('the list on a past day replays the history backwards; comparable changes exclude baselines and imports');
}
{
  const entries = [
    day('2026-10-01', { mood: 'stable', medication: 'taken' }),                       // old build: one answer
    day('2026-10-02', { mood: 'low', medication: 'not-taken' }),                      // old build: missed
    day('2026-10-03', { mood: 'stable', medication: 'taken', medDoses: { Lithium: 'taken', Q: 'taken' } }),
    day('2026-10-04', { mood: 'stable', medication: 'not-taken', medDoses: { Lithium: 'missed', Q: 'taken' } }),
    day('2026-10-05', { mood: 'stable', medication: 'not-taken', medDoses: { lithium: 'missed', Q: 'missed' } }),
    day('2026-10-06', { mood: 'stable', medication: 'unsure' }),
  ];
  const a = M.adherence(entries, '2026-10-01', '2026-10-31');
  assert.equal(a.answered, 5); assert.equal(a.taken, 2); assert.equal(a.pct, 40);
  assert.equal(a.perDays, 3);
  const li = a.meds.find(m => M.norm(m.name) === 'lithium');
  assert.deepEqual({ taken: li.taken, missed: li.missed, days: li.days }, { taken: 1, missed: 2, days: 3 }, 'one medicine whatever the case');
  const ml = M.missedLog(entries);
  assert.deepEqual(ml.map(x => [x.day, x.names]), [['2026-10-05', ['lithium', 'Q']], ['2026-10-04', ['Lithium']], ['2026-10-02', null]], 'newest first; an old missed day is "all medicines"');
  assert.deepEqual(M.missedLog(entries, '2026-10-04').length, 2);
  const s = M.bloodSeries([
    { id: 'a', date: '2026-09-01', test: 'Lithium', value: 0.62, unit: 'mmol/L' },
    { id: 'b', date: '2026-08-01', test: 'lithium ', value: 0.4, unit: 'mmol/L' },
    { id: 'c', date: '2026-09-02', test: 'TSH', value: 2.1, unit: 'mU/L' },
    { id: 'd', date: '2026-09-03', test: 'TSH', deleted: true },
  ]);
  assert.equal(s.length, 2); assert.deepEqual(s[0].points.map(p => p.value), [0.4, 0.62]); assert.equal(s[1].points.length, 1);
  ok('adherence per medicine from per-medicine days, overall from every answered day; missed-dose log; blood results by test');
}
{
  // Comparison rules.
  const C = '2026-08-01';
  const change = { key: 'h:x', day: C, type: 'add', name: 'Lithium' };
  const make = (beforeN, afterN, f) => {
    const out = [];
    for (let i = 1; i <= beforeN; i++) out.push(day(M.addDays(C, -i), f ? f(-i) : { mood: 'low', sleep: 6, energy: 3, medication: 'taken' }));
    for (let i = 1; i <= afterN; i++) out.push(day(M.addDays(C, i), f ? f(i) : { mood: 'stable', sleep: 8, energy: 6, medication: 'taken' }));
    return out;
  };
  // today = C + 30: 30 days after, 60 before → window 30, both full.
  const t30 = M.fromKey(M.addDays(C, 30));
  let r = M.compare(make(60, 30), change, { today: t30 });
  assert.equal(r.ok, true); assert.equal(r.window, 30);
  assert.equal(r.before.days, 30); assert.equal(r.after.days, 30, 'equal windows');
  assert.equal(r.before.from, M.addDays(C, -30)); assert.equal(r.after.to, M.addDays(C, 30));
  assert.equal(r.before.stability, 0); assert.equal(r.after.stability, 100);
  assert.equal(r.before.avgSleep, 6); assert.equal(r.after.avgEnergy, 6); assert.equal(r.after.medsTaken, 100);
  assert.equal(r.before.mix.low, 100);
  // Exactly 21 each side passes; 20 doesn't, and says one more day.
  r = M.compare(make(40, 21), change, { today: M.fromKey(M.addDays(C, 21)) });
  assert.equal(r.ok, true); assert.equal(r.window, 21);
  r = M.compare(make(40, 20), change, { today: M.fromKey(M.addDays(C, 20)) });
  assert.equal(r.ok, false); assert.equal(r.reason, 'after'); assert.equal(r.need, 1);
  r = M.compare(make(40, 5), change, { today: M.fromKey(M.addDays(C, 5)) });
  assert.equal(r.need, 16, 'keep logging: 16 more days');
  // Too little before the change: logging can't help.
  r = M.compare(make(10, 40), change, { today: M.fromKey(M.addDays(C, 40)) });
  assert.equal(r.ok, false); assert.equal(r.reason, 'before'); assert.equal(r.need, 0); assert.equal(r.beforeDays, 10);
  // The window is capped at 90 days.
  r = M.compare(make(200, 150), change, { today: M.fromKey(M.addDays(C, 150)) });
  assert.equal(r.window, 90); assert.equal(r.before.days, 90); assert.equal(r.after.days, 90);
  // Auto-filled days don't count.
  r = M.compare(make(40, 25, i => ({ mood: 'stable', medication: 'taken', autoFilled: i > 0 && i <= 10 })), change, { today: M.fromKey(M.addDays(C, 25)) });
  assert.equal(r.ok, false); assert.equal(r.afterDays, 15); assert.equal(r.need, 6);
  // Gaps after a change that is long past: no amount of new logging fills them.
  const gappy = make(120, 120).filter((e, i) => !(i >= 120 && i % 2 === 0));
  r = M.compare(gappy, change, { today: M.fromKey(M.addDays(C, 200)) });
  assert.equal(r.ok, true, 'half the days logged in a 90-day window is still ≥21');
  const sparse = make(120, 120).filter((e, i) => !(i >= 120 && i % 5 !== 0));
  r = M.compare(sparse, change, { today: M.fromKey(M.addDays(C, 200)) });
  assert.equal(r.ok, false); assert.equal(r.reason, 'afterGap'); assert.equal(r.afterDays, 18);
  ok('≥21 logged days each side, equal windows ≤90, auto-filled days out, "N more days" worked out');
}
{
  // Switches, custom trackers and other changes in the windows.
  const C = '2026-08-01';
  const moods = ['manic', 'stable', 'low', 'low', 'elevated', 'stable', 'depressed'];
  const entries = [];
  for (let i = 1; i <= 28; i++) entries.push(day(M.addDays(C, -i), { mood: moods[i % 7], customFields: { addedSugar: i % 2 ? 'yes' : 'no' } }));
  for (let i = 1; i <= 28; i++) entries.push(day(M.addDays(C, i), { mood: 'stable', customFields: { addedSugar: 'no' } }));
  const ev = M.allEvents([
    { at: M.fromKey(C).toISOString(), type: 'add', name: 'Lithium' },
    { at: M.fromKey(M.addDays(C, 10)).toISOString(), type: 'dose', name: 'Quetiapine', from: '50', to: '100' },
    { at: M.fromKey(M.addDays(C, 90)).toISOString(), type: 'stop', name: 'Far away' },
    { at: M.fromKey(M.addDays(C, 3)).toISOString(), type: 'baseline', name: 'Lithium' },
  ], []);
  const change = ev.find(e => e.type === 'add');
  const r = M.compare(entries, change, { today: M.fromKey(M.addDays(C, 28)), events: ev });
  assert.equal(r.ok, true);
  assert.deepEqual(r.others.map(e => e.name), ['Quetiapine'], 'another change inside the windows is flagged; outside / baselines are not');
  assert.ok(r.before.switches >= 4, 'high ↔ low switches counted');
  assert.equal(r.after.switches, 0);
  assert.equal(r.before.switchesPerMonth, Math.round(r.before.switches / 28 * 30 * 10) / 10);
  assert.equal(r.before.custom.addedSugar.pct, 50); assert.equal(r.after.custom.addedSugar.pct, 0);
  ok('switch rate, custom trackers and other medicine changes in either window');
}

// ── Part 2: BB.medLog in secure-store.js ─────────────────────────────────────
const src = fs.readFileSync(new URL('../js/shared/secure-store.js', import.meta.url), 'utf8');
const b64 = buf => Buffer.from(buf).toString('base64');
async function makeEnv(store, rawKey, signedIn = true) {
  const docs = store || {};
  const ls = new Map(), ss = new Map();
  if (rawKey) ss.set('bb_user_key', b64(rawKey));
  const mkRef = path => ({ path, get: async () => ({ exists: !!docs[path], data: () => docs[path] }) });
  const db = {
    collection: c => ({ doc: id => mkRef(c + '/' + id) }),
    runTransaction: async fn => fn({
      get: async ref => ({ exists: !!docs[ref.path], data: () => docs[ref.path] }),
      set: (ref, v) => {
        const cur = Object.assign({}, docs[ref.path] || {});
        Object.keys(v).forEach(k => { if (v[k] && v[k].__del) delete cur[k]; else cur[k] = v[k]; });
        docs[ref.path] = cur;
      },
    }),
  };
  const firebase = { apps: [1], firestore: Object.assign(() => db, { FieldValue: { delete: () => ({ __del: 1 }) } }),
    auth: () => ({ currentUser: signedIn ? { uid: 'u', isAnonymous: false } : null, onAuthStateChanged() {} }), app: () => ({}) };
  const store_ = m => ({ getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) });
  const win = { localStorage: store_(ls), sessionStorage: store_(ss), crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, JSON, Promise, Error, Object, Array, Date, Number, String, isFinite,
    setTimeout, console: { warn() {}, log: console.log }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    addEventListener() {}, dispatchEvent() {}, firebase };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(src, win);
  const J = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  const L = win.BB.medLog, S = win.BB.secure;
  const log = Object.fromEntries(Object.keys(L).map(k => [k, typeof L[k] === 'function' ? async (...a) => J(await L[k](...a)) : J(L[k])]));
  return { log, S, ls, docs, win };
}
async function openBlob(docs, raw) {
  const K = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const enc = docs['userSettings/u'].secureEnc;
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(enc._iv, 'base64') }, K, Buffer.from(enc._enc, 'base64'))));
}
const tick = () => new Promise(r => setTimeout(r, 3));
{
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const docs = {};
  const d1 = await makeEnv(docs, raw);
  // Invalid records are refused.
  assert.equal(await d1.log.put('bloodLevels', { date: '2026-10-01', test: 'Lithium', value: '' }), null);
  assert.equal(await d1.log.put('bloodLevels', { date: 'yesterday', test: 'Lithium', value: 0.6 }), null);
  assert.equal(await d1.log.put('sideEffects', { date: '2026-10-01', text: '   ' }), null);
  assert.equal(await d1.log.put('pastChanges', { date: '2026-03-01', type: 'rename', name: 'X' }), null);
  const r1 = await d1.log.put('bloodLevels', { date: '2026-10-01', test: 'Lithium', value: '0,72', unit: 'mmol/L', note: '12 h after dose' });
  assert.equal(r1.status, 'saved'); assert.equal(r1.item.value, 0.72, 'a decimal comma is read');
  const r2 = await d1.log.put('sideEffects', { date: '2026-10-02', text: 'Shaky hands', med: 'Lithium' });
  await d1.log.put('pastChanges', { date: '2026-03-01', type: 'add', name: 'Lithium', to: '400mg' });
  const doc = docs['userSettings/u'];
  assert.ok(doc.secureEnc && doc.secureEnc._enc);
  for (const f of ['medSideEffects', 'medBloodLevels', 'medPastChanges']) assert.ok(!(f in doc), f + ' is not a plaintext field');
  const flat = JSON.stringify(doc);
  assert.ok(!flat.includes('Shaky') && !flat.includes('Lithium') && !flat.includes('0.72'), 'nothing readable in Firestore');
  let blob = await openBlob(docs, raw);
  assert.equal(blob.medBloodLevels[0].value, 0.72); assert.equal(blob.medSideEffects[0].text, 'Shaky hands'); assert.equal(blob.medPastChanges[0].date, '2026-03-01');
  // Device 2 adds a result; device 1 deletes the side effect. Neither undoes the other.
  const d2 = await makeEnv(docs, raw);
  await d2.S.settings('u', docs['userSettings/u']);
  assert.equal((await d2.log.list('sideEffects')).length, 1, 'the other device reads it back');
  await tick();
  await d1.log.remove('sideEffects', r2.item.id);
  await tick();
  await d2.log.put('bloodLevels', { date: '2026-10-08', test: 'Lithium', value: 0.8, unit: 'mmol/L' });
  blob = await openBlob(docs, raw);
  assert.equal(blob.medBloodLevels.filter(x => !x.deleted).length, 2, 'both results kept');
  const tomb = blob.medSideEffects.find(x => x.id === r2.item.id);
  assert.ok(tomb.deleted && !('text' in tomb), 'the delete stands, and the tombstone holds nothing');
  await d1.S.settings('u', docs['userSettings/u']);
  assert.equal((await d1.log.list('bloodLevels')).length, 2); assert.equal((await d1.log.list('sideEffects')).length, 0);
  // In SETTINGS and the reset patch.
  for (const f of ['medSideEffects', 'medBloodLevels', 'medPastChanges']) {
    assert.ok(d1.S.SETTINGS.includes(f)); assert.ok(d1.S.resetPatch()[f]);
  }
  ok('side effects, blood levels and past changes: encrypted only, merged by id across devices, deletes stick');
}
{
  // Backup round-trip: export the device copies, restore on a fresh device (twice).
  const a = await makeEnv(null, null, false);
  const r = await a.log.put('bloodLevels', { date: '2026-09-01', test: 'Lithium', value: 0.6, unit: 'mmol/L' });
  assert.equal(r.status, 'device', 'a guest keeps it on the device');
  await a.log.put('sideEffects', { date: '2026-09-02', text: 'Thirsty' });
  const backup = JSON.parse(JSON.stringify({ settings: { medBloodLevels: a.ls.get('medBloodLevels'), medSideEffects: a.ls.get('medSideEffects') } }));
  const b = await makeEnv(null, null, false);
  await b.log.put('bloodLevels', { date: '2026-10-01', test: 'Lithium', value: 0.7 });
  for (let i = 0; i < 2; i++) {
    await b.log.mergeIn('bloodLevels', JSON.parse(backup.settings.medBloodLevels));
    await b.log.mergeIn('sideEffects', JSON.parse(backup.settings.medSideEffects));
  }
  assert.deepEqual((await b.log.list('bloodLevels')).map(x => x.value), [0.6, 0.7], 'merged, oldest first, nothing doubled');
  assert.equal((await b.log.list('sideEffects')).length, 1);
  // Junk in a backup is dropped.
  await b.log.mergeIn('bloodLevels', [{ id: 'z', date: 'bad', value: 1 }, null, 'x']);
  assert.equal((await b.log.list('bloodLevels')).length, 2);
  ok('backup round-trip merges (restoring twice adds nothing); a guest keeps it on the device');
}
{
  // No key (Private journal, locked): kept on the device, pending, never plaintext.
  const docs = {};
  const d = await makeEnv(docs, null);
  const r = await d.log.put('sideEffects', { date: '2026-10-02', text: 'Tired' });
  assert.equal(r.status, 'pending');
  assert.deepEqual(JSON.parse(d.ls.get('bbSecurePending')).settings, ['medSideEffects']);
  assert.ok(!JSON.stringify(docs).includes('Tired'));
  // Once the key turns up, the pending save goes up encrypted.
  const raw = crypto.getRandomValues(new Uint8Array(32));
  d.ls.set('x', '1');
  const d2 = await makeEnv(docs, raw);
  d2.ls.set('medSideEffects', d.ls.get('medSideEffects')); d2.ls.set('bbSecurePending', d.ls.get('bbSecurePending'));
  await d2.S.settings('u', docs['userSettings/u'] || {});
  const blob = await openBlob(docs, raw);
  assert.equal(blob.medSideEffects[0].text, 'Tired');
  assert.ok(!d2.ls.get('bbSecurePending'));
  ok('without the key a save waits on the device, then goes up encrypted');
}
console.log(`\n${pass} scenarios passed`);
