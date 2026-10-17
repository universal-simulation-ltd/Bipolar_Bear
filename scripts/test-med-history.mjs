// Medication history (v343): the dated log of medication-list changes in
// js/shared/secure-store.js. Runs the real module against a mocked Firestore
// with real WebCrypto: add / dose / rename / stop each write one event, the
// baseline is written once, a backup round-trip keeps it, two devices merge
// by union, and it only ever reaches the account inside the encrypted blob.
// Run: node scripts/test-med-history.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../js/shared/secure-store.js', import.meta.url), 'utf8');
const b64 = buf => Buffer.from(buf).toString('base64');

async function makeEnv(store, rawKey) {
  const docs = store || {};
  const ls = new Map(), ss = new Map();
  if (rawKey) ss.set('bb_user_key', b64(rawKey));
  const writes = [];
  const mkRef = path => ({
    path,
    get: async () => ({ exists: !!docs[path], data: () => docs[path] }),
  });
  const db = {
    collection: c => ({ doc: id => mkRef(c + '/' + id) }),
    runTransaction: async fn => fn({
      get: async ref => ({ exists: !!docs[ref.path], data: () => docs[ref.path] }),
      set: (ref, v) => {
        writes.push([ref.path, v]);
        const cur = Object.assign({}, docs[ref.path] || {});
        Object.keys(v).forEach(k => { if (v[k] && v[k].__del) delete cur[k]; else cur[k] = v[k]; });
        docs[ref.path] = cur;
      },
    }),
  };
  const firebase = { apps: [1], firestore: Object.assign(() => db, { FieldValue: { delete: () => ({ __del: 1 }) } }),
    auth: () => ({ currentUser: { uid: 'u', isAnonymous: false }, onAuthStateChanged() {} }), app: () => ({}) };
  const store_ = m => ({ getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) });
  const win = { localStorage: store_(ls), sessionStorage: store_(ss), crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, JSON, Promise, Error, Object, Array, Date,
    setTimeout, console: { warn() {}, log: console.log }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    addEventListener() {}, dispatchEvent() {}, firebase };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(src, win);
  // Results cross back from the vm realm as plain data.
  const J = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
  const H = win.BB.medHistory, S = win.BB.secure;
  const BB = {
    medHistory: Object.fromEntries(Object.keys(H).map(k => [k, (...a) => J(H[k](...a))])),
    secure: { ...S, SETTINGS: J(S.SETTINGS), settings: async (...a) => J(await S.settings(...a)), resetPatch: () => J(S.resetPatch()) },
  };
  return { BB, ls, docs, writes, win };
}
const meds = l => JSON.stringify(l);
let pass = 0;
const ok = label => { pass++; console.log('PASS', label); };
const tick = () => new Promise(r => setTimeout(r, 2));

// 1. add / dose / rename / stop: one event each, with the right fields.
{
  const { BB, ls } = await makeEnv();
  const H = BB.medHistory;
  let list = [];
  let ev = H.record(list, [{ name: 'Lithium', dosage: '800mg' }]);
  assert.equal(ev.length, 1); assert.deepEqual({ ...ev[0], at: 'x' }, { at: 'x', type: 'add', name: 'Lithium', to: '800mg', source: 'user' });
  list = [{ name: 'Lithium', dosage: '800mg' }]; ls.set('currentMedList', meds(list));
  await tick();
  ev = H.record(list, [{ name: 'lithium ', dosage: '1000mg' }]);
  assert.equal(ev.length, 1); assert.equal(ev[0].type, 'dose'); assert.equal(ev[0].from, '800mg'); assert.equal(ev[0].to, '1000mg');
  list = [{ name: 'Lithium', dosage: '1000mg' }];
  await tick();
  ev = H.record(list, [{ name: 'Priadel', dosage: '1000mg' }], { rename: { from: 'Lithium', to: 'Priadel' } });
  assert.equal(ev.length, 1); assert.deepEqual({ ...ev[0], at: 'x' }, { at: 'x', type: 'rename', name: 'Priadel', from: 'Lithium', to: 'Priadel', source: 'user' });
  list = [{ name: 'Priadel', dosage: '1000mg' }];
  await tick();
  ev = H.record(list, list.slice(), { rename: { from: 'Priadel', to: 'priadel' } });
  assert.equal(ev.length, 0, 'an edit that changes nothing (or only case) writes nothing');
  ev = H.record(list, []);
  assert.equal(ev.length, 1); assert.equal(ev[0].type, 'stop'); assert.equal(ev[0].name, 'Priadel'); assert.equal(ev[0].from, '1000mg');
  // A rename that also changes the dose: both.
  await tick();
  ev = H.record([{ name: 'A', dosage: '1' }], [{ name: 'B', dosage: '2' }], { rename: { from: 'A', to: 'B' } });
  assert.deepEqual(ev.map(e => e.type), ['rename', 'dose']);
  // Import source.
  await tick();
  ev = H.record([{ name: 'B', dosage: '2' }], [{ name: 'B', dosage: '2' }, { name: 'Quetiapine', dosage: '' }], { source: 'import' });
  assert.equal(ev.length, 1); assert.equal(ev[0].source, 'import'); assert.ok(!('to' in ev[0]), 'no empty dosage stored');
  const h = H.get();
  assert.deepEqual(h.map(e => e.type), ['add', 'dose', 'rename', 'stop', 'rename', 'dose', 'add']);
  assert.ok(h.every(e => !Number.isNaN(Date.parse(e.at))), 'ISO dates');
  ok('add / dose / rename / stop each write one correct event; nothing for a no-op edit');
}

// 2. Baseline: written once, dated now, one per medicine; a first change starts with it.
{
  const { BB, ls } = await makeEnv();
  const H = BB.medHistory;
  assert.equal(H.ensureBaseline(), false, 'nothing to baseline without a list');
  ls.set('currentMedList', meds([{ name: 'Lithium', dosage: '800mg' }, { name: 'Lamotrigine', dosage: '' }]));
  assert.equal(H.ensureBaseline(), true);
  assert.equal(H.ensureBaseline(), false, 'only once');
  const h = H.get();
  assert.equal(h.length, 2); assert.ok(h.every(e => e.type === 'baseline'));
  assert.equal(h[0].to, '800mg'); assert.ok(!('to' in h[1]));
  assert.ok(Math.abs(Date.parse(h[0].at) - Date.now()) < 5000);
  const env2 = await makeEnv();
  const ev = env2.BB.medHistory.record([{ name: 'Lithium', dosage: '800mg' }], [{ name: 'Lithium', dosage: '800mg' }, { name: 'Sertraline', dosage: '50mg' }]);
  assert.deepEqual(ev.map(e => e.type), ['baseline', 'add'], 'no history yet: the old list is the baseline');
  ok('baseline written once per medicine; a first change without history records the old list first');
}

// 3. Backup round-trip: export carries it, import merges (no duplicates, nothing lost).
{
  const a = await makeEnv();
  a.BB.medHistory.record([], [{ name: 'Lithium', dosage: '800mg' }]);
  await tick();
  a.BB.medHistory.record([{ name: 'Lithium', dosage: '800mg' }], [{ name: 'Lithium', dosage: '900mg' }]);
  const backup = JSON.parse(JSON.stringify({ settings: { medHistory: a.ls.get('medHistory') } }));
  const b = await makeEnv();
  b.BB.medHistory.record([], [{ name: 'Sertraline', dosage: '50mg' }]);
  b.BB.medHistory.mergeIn(JSON.parse(backup.settings.medHistory));
  b.BB.medHistory.mergeIn(JSON.parse(backup.settings.medHistory));
  const h = b.BB.medHistory.get();
  assert.equal(h.length, 3); assert.deepEqual(h.map(e => e.name).sort(), ['Lithium', 'Lithium', 'Sertraline']);
  ok('backup round-trip keeps every event; restoring twice adds nothing');
}

// 4. Account: only inside secureEnc (encrypted), merged by union across devices.
{
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const docs = {};
  const d1 = await makeEnv(docs, raw);
  d1.BB.medHistory.record([], [{ name: 'Lithium', dosage: '800mg' }]);
  d1.ls.set('currentMedList', meds([{ name: 'Lithium', dosage: '800mg' }]));
  assert.equal(await d1.BB.secure.saveSettings('u', { currentMedList: [{ name: 'Lithium', dosage: '800mg' }] }), 'saved');
  const doc = docs['userSettings/u'];
  assert.ok(doc && doc.secureEnc && doc.secureEnc._enc, 'secureEnc written');
  assert.ok(!('medHistory' in doc) && !('currentMedList' in doc), 'no plaintext fields');
  assert.ok(!JSON.stringify(doc).includes('Lithium'), 'the name is nowhere in plaintext');
  // Device 2 (same account) adds its own event before it has synced.
  await tick();
  const d2 = await makeEnv(docs, raw);
  d2.BB.medHistory.record([{ name: 'Lithium', dosage: '800mg' }], [{ name: 'Lithium', dosage: '800mg' }, { name: 'Sertraline', dosage: '50mg' }]);
  assert.equal(await d2.BB.secure.saveSettings('u', { currentMedList: [{ name: 'Lithium', dosage: '800mg' }, { name: 'Sertraline', dosage: '50mg' }] }), 'saved');
  const K = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const enc = docs['userSettings/u'].secureEnc;
  const blob = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(enc._iv, 'base64') }, K, Buffer.from(enc._enc, 'base64'))));
  // Device 2 wrote baseline(Lithium) + add(Sertraline); device 1's add(Lithium) is kept.
  assert.deepEqual(blob.medHistory.map(e => e.type + ':' + e.name), ['add:Lithium', 'baseline:Lithium', 'add:Sertraline']);
  assert.equal(blob.currentMedList.length, 2);
  // Device 1 reads it back: its device copy becomes the union.
  const r = await d1.BB.secure.settings('u', docs['userSettings/u']);
  assert.equal(r.status, 'ok');
  assert.equal(JSON.parse(d1.ls.get('medHistory')).length, 3);
  // No key (Private, locked): stays on the device, marked pending, nothing in plaintext.
  const d3 = await makeEnv(docs, null);
  d3.win.firebase.app = () => ({});
  d3.BB.medHistory.record([], [{ name: 'X', dosage: '1' }]);
  assert.equal(await d3.BB.secure.saveSettings('u', { currentMedList: [{ name: 'X', dosage: '1' }] }), 'pending');
  assert.deepEqual(JSON.parse(d3.ls.get('bbSecurePending')).settings.sort(), ['currentMedList', 'medHistory']);
  assert.ok(!JSON.stringify(docs['userSettings/u']).includes('"X"'));
  ok('encrypted in secureEnc only; two devices merge by union; no key → pending, never plaintext');
}

// 5. A synced account with no history starts its baseline after the read, and saves it encrypted.
{
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const docs = {};
  const d = await makeEnv(docs, raw);
  d.ls.set('currentMedList', meds([{ name: 'Lithium', dosage: '800mg' }]));
  await d.BB.secure.saveSettings('u', { currentMedList: [{ name: 'Lithium', dosage: '800mg' }] });
  d.ls.delete('medHistory');
  const r = await d.BB.secure.settings('u', docs['userSettings/u']);
  assert.equal(r.status, 'ok');
  for (let i = 0; i < 20 && !(d.writes.length >= 2); i++) await tick();
  assert.equal(JSON.parse(d.ls.get('medHistory'))[0].type, 'baseline');
  const r2 = await d.BB.secure.settings('u', docs['userSettings/u']);
  assert.deepEqual(r2.view.medHistory.map(e => e.type), ['baseline'], 'the baseline reached the account, once');
  assert.ok(d.BB.secure.SETTINGS.includes('medHistory'), 'in the sensitive settings list');
  assert.ok(d.BB.secure.resetPatch().medHistory, 'reset deletes it');
  ok('account baseline after the first read, saved encrypted; in SETTINGS and resetPatch');
}
console.log(`\n${pass} scenarios passed`);
