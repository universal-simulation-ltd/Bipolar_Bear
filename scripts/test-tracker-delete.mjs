// Delete a tracker and its data (v340), signed-in path.
// Runs the real functions from js/journal.js against a mocked Firestore with
// real WebCrypto: batches of ≤400, partial failure + retry, idempotence,
// entries that won't open, settings sync. Run: node scripts/test-tracker-delete.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../js/journal.js', import.meta.url), 'utf8');
function extract(name) {
  const re = new RegExp(`(async\\s+)?function ${name}\\s*\\(`); const m = re.exec(src); if (!m) throw new Error('no ' + name);
  let i = src.indexOf('{', src.indexOf(')', m.index)); let depth = 0, j = i;
  for (; j < src.length; j++) { const c = src[j];
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); continue; }
    if (c === "'" || c === '"' || c === '`') { const q = c; j++; while (src[j] !== q) { if (src[j] === '\\') j++; j++; } continue; }
    if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break; } }
  return src.slice(m.index, j + 1);
}
function extractConst(name) {
  const at = src.indexOf(`const ${name} = [`); if (at < 0) throw new Error('no const ' + name);
  return src.slice(at, src.indexOf('];', at) + 2);
}
const names = ['_userEncrypt', '_userDecrypt', '_trkVal', '_trkEntryHas', '_trkStripEntry', '_trkTombstones', '_trkPurgeFirestore', '_trkForget', '_trkSyncForget', 'getCustomFields'];
const code = [extractConst('_TRK_BUILTINS'), extractConst('DEFAULT_CUSTOM_FIELDS'), ...names.map(extract)].join('\n\n');
const subtle = crypto.subtle;
const newKey = () => subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

function makeEnv() {
  const store = { entries: {}, settings: {} };
  const log = { commits: [], updates: [], sets: 0, failCommits: new Set(), commitNo: 0 };
  const mkDoc = id => ({ id, data: () => store.entries[id], ref: { id } });
  const db = {
    collection: c => c === 'entries'
      ? { where: () => ({ get: async () => { const docs = Object.keys(store.entries).map(mkDoc); return { docs, size: docs.length }; } }) }
      : { doc: () => ({ update: async (...a) => { log.updates.push(a); }, set: async () => { log.sets++; } }) },
    batch: () => {
      const ops = [];
      return {
        set: (ref, v) => { ops.push([ref, v]); },
        commit: async () => {
          const n = ++log.commitNo;
          if (log.failCommits.has(n)) { log.failCommits.delete(n); throw new Error('unavailable'); }
          if (ops.length > 400) throw new Error('batch too big: ' + ops.length);
          for (const [r, v] of ops) store.entries[r.id] = v;
          log.commits.push(ops.length);
        },
      };
    },
  };
  const ls = new Map();
  const localStorage = { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
  class FieldPath { constructor(...p) { this.p = p; } }
  const firebase = { firestore: { FieldValue: { delete: () => ({ __del: 1 }), arrayUnion: (...x) => ({ __union: x }) }, FieldPath } };
  const ctx = { crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, JSON, Promise, Error, Set, Object, Array, setTimeout, console: { warn() {}, error() {}, log: console.log },
    db, localStorage, firebase, currentUser: { uid: 'u' }, syncCalls: 0 };
  vm.createContext(ctx);
  vm.runInContext(`let _userCryptoKey = null, _staleUserKeys = [], _editFieldOverrides = null;
    function syncTrackingPrefsToFirestore() { syncCalls++; }
    ${code}
    this.api = { set k(v) { _userCryptoKey = v; }, set stale(v) { _staleUserKeys = v; }, _userEncrypt, _userDecrypt, _trkPurgeFirestore, _trkForget, _trkSyncForget, getCustomFields, _trkTombstones };`, ctx);
  return { api: ctx.api, store, log, ctx, ls };
}
const T_C5K = { tid: 'c:c5k', cid: 'c5k', pref: 'trackCustom_c5k', kind: 'custom' };
const T_ALC = { tid: 'b:alcohol', id: 'alcohol', pref: 'trackAlcohol', keys: ['alcohol'], kind: 'builtin' };
const T_EMO = { tid: 'b:emotions', id: 'emotions', pref: 'trackAnxiety', legacy: 'trackEmotions', keys: ['anxiety', 'stress', 'irritability'], kind: 'builtin' };
const open = async (api, K, v) => (v._enc ? api._userDecrypt(K, v) : v);

async function seed(env, K, n, opts = {}) {
  const { api, store } = env;
  for (let i = 0; i < n; i++) {
    const e = { userId: 'u', timestamp: 1000 + i, mood: ['stable', 'low', 'manic'][i % 3], alcohol: i % 2 ? 'yes' : 'no', anxiety: i % 4 ? 'low' : null, stress: 'high',
      customFields: i % 10 === 9 ? { other: 'yes' } : { c5k: i % 3 ? 'yes' : 'no', other: 'no' }, notes: 'n' + i };
    store.entries['e' + i] = { userId: 'u', timestamp: e.timestamp, ...(await api._userEncrypt(K, e)) };
  }
  if (opts.extras) await opts.extras(store);
}
const hasC5k = async (env, K) => { let n = 0; for (const v of Object.values(env.store.entries)) { try { const e = await open(env.api, K, v); if (e.customFields && 'c5k' in e.customFields) n++; } catch (_) {} } return n; };
let pass = 0;
const ok = label => { pass++; console.log('PASS', label); };

// 1. 950 entries, 855 with c5k: three batches (400, 400, 55), every entry still opens,
//    nothing else changed; a plaintext legacy entry is re-saved encrypted; one entry under
//    an old device key opens with it and is re-saved under the account key; one entry
//    nothing opens is skipped and left as it was.
{
  const env = makeEnv(); const K = await newKey(), Kold = await newKey(), Kx = await newKey();
  await seed(env, K, 950, { extras: async st => {
    st.entries.plain = { userId: 'u', timestamp: 5, mood: 'low', customFields: { c5k: 'yes' } };
    st.entries.old = { userId: 'u', timestamp: 6, ...(await env.api._userEncrypt(Kold, { userId: 'u', timestamp: 6, mood: 'stable', customFields: { c5k: 'no' } })) };
    st.entries.alien = { userId: 'u', timestamp: 7, ...(await env.api._userEncrypt(Kx, { userId: 'u', mood: 'stable', customFields: { c5k: 'yes' } })) };
  } });
  const alienBefore = JSON.stringify(env.store.entries.alien);
  env.api.k = K; env.api.stale = [Kold];
  const prog = [];
  const res = await env.api._trkPurgeFirestore('u', T_C5K, (d, t) => prog.push(`${d}/${t}`));
  assert.equal(res.changed, 857); assert.equal(res.skipped, 1);
  assert.deepEqual(env.log.commits, [400, 400, 57]);
  assert.deepEqual(prog, ['0/857', '400/857', '800/857', '857/857']);
  assert.equal(JSON.stringify(env.store.entries.alien), alienBefore, 'unopenable entry untouched');
  let opened = 0, other = 0;
  for (const [id, v] of Object.entries(env.store.entries)) {
    if (id === 'alien') continue;
    assert.ok(v._enc && v._iv, id + ' encrypted'); assert.equal(v.userId, 'u'); assert.equal(typeof v.timestamp, 'number');
    const e = await env.api._userDecrypt(K, v); opened++;
    assert.ok(!('c5k' in (e.customFields || {})), id + ' has no c5k');
    if (e.customFields && 'other' in e.customFields) other++;
    assert.ok(e.mood);
  }
  assert.equal(opened, 952); assert.equal(other, 950, 'other custom field kept');
  assert.equal(env.store.entries.e0.timestamp, 1000);
  ok('950+ entries: batches of ≤400 with progress, all re-encrypted under the account key, unopenable entry skipped');
}

// 2. Partial failure on the 2nd batch, then retry finishes the rest; a third run is a no-op.
{
  const env = makeEnv(); const K = await newKey();
  await seed(env, K, 950);
  env.api.k = K;
  env.log.failCommits.add(2);
  let err = null;
  try { await env.api._trkPurgeFirestore('u', T_C5K); } catch (e) { err = e; }
  assert.ok(err, 'throws'); assert.equal(err.done, 400); assert.equal(err.total, 855);
  assert.equal(await hasC5k(env, K), 455, 'the first batch landed, the rest is untouched');
  const res = await env.api._trkPurgeFirestore('u', T_C5K);
  assert.equal(res.changed, 455); assert.equal(await hasC5k(env, K), 0);
  const commitsBefore = env.log.commits.length;
  const res3 = await env.api._trkPurgeFirestore('u', T_C5K);
  assert.equal(res3.changed, 0); assert.equal(env.log.commits.length, commitsBefore, 'nothing to write, no batch');
  ok('partial failure says how far it got (400 of 855); retry finishes the 455 left; running again writes nothing');
}

// 3. Built-ins: Alcohol (one key) and Emotions (three keys).
{
  const env = makeEnv(); const K = await newKey();
  await seed(env, K, 30);
  env.api.k = K;
  const r1 = await env.api._trkPurgeFirestore('u', T_ALC);
  assert.equal(r1.changed, 30);
  const r2 = await env.api._trkPurgeFirestore('u', T_EMO);
  assert.equal(r2.changed, 30, 'stress is on every entry');
  for (const v of Object.values(env.store.entries)) {
    const e = await env.api._userDecrypt(K, v);
    assert.ok(!('alcohol' in e) && !('anxiety' in e) && !('stress' in e) && !('irritability' in e));
    assert.ok(e.customFields && e.notes && e.mood, 'the rest is kept');
  }
  ok('built-in trackers: alcohol and the three emotion answers removed, the rest kept');
}

// 4. No journal key: nothing is written in plaintext.
{
  const env = makeEnv(); const K = await newKey();
  env.store.entries.p = { userId: 'u', timestamp: 1, mood: 'low', customFields: { c5k: 'yes' } };
  env.api.k = null;
  let err = null;
  try { await env.api._trkPurgeFirestore('u', T_C5K); } catch (e) { err = e; }
  assert.ok(err && /key/.test(err.message)); assert.deepEqual(env.store.entries.p.customFields, { c5k: 'yes' });
  ok('without the journal key it stops before writing anything');
}

// 5. The definition and settings sync: gone locally, deleted on the account, remembered as
//    deleted, and a stale synced copy can't bring it back.
{
  const env = makeEnv();
  const { ls, api, log, ctx } = env;
  ls.set('customTrackingFields', JSON.stringify([{ id: 'c5k', label: '5K', emoji: '🏃' }, { id: 'cbed', label: 'Bed', emoji: '🛏️' }]));
  ls.set('trackCustom_c5k', 'true'); ls.set('_labelOverride_trackCustom_c5k', '🏃 Run'); ls.set('bbPdfOmitTrackers', JSON.stringify(['custom:c5k', 'alcohol']));
  api._trkForget(T_C5K);
  await api._trkSyncForget(T_C5K);
  assert.deepEqual(JSON.parse(ls.get('customTrackingFields')).map(f => f.id), ['cbed']);
  assert.equal(ls.has('trackCustom_c5k'), false); assert.equal(ls.has('_labelOverride_trackCustom_c5k'), false);
  assert.deepEqual([...api._trkTombstones()], ['c5k']);
  assert.deepEqual(JSON.parse(ls.get('bbPdfOmitTrackers')), ['alcohol']);
  assert.equal(ctx.syncCalls, 1, 'tracking prefs re-synced');
  const u = log.updates[0];
  assert.deepEqual(u[0].p, ['trackingFields', 'trackCustom_c5k']); assert.deepEqual(u[1], { __del: 1 });
  assert.deepEqual(u[2].p, ['labelOverrides', 'trackCustom_c5k']); assert.deepEqual(u[3], { __del: 1 });
  assert.equal(u[4], 'deletedTrackers'); assert.deepEqual(u[5], { __union: ['c5k'] });
  // Another device's stale settings write c5k back into customTrackingFields:
  ls.set('customTrackingFields', JSON.stringify([{ id: 'c5k', label: '5K' }, { id: 'cbed', label: 'Bed' }]));
  assert.deepEqual([...api.getCustomFields().map(f => f.id)], ['addedSugar', 'cbed']);
  // Built-in: switch off, rename forgotten, no tombstone.
  ls.set('trackAlcohol', 'true'); ls.set('_labelOverride_trackAlcohol', '🍷 Wine');
  api._trkForget(T_ALC);
  assert.equal(ls.get('trackAlcohol'), 'false'); assert.equal(ls.has('_labelOverride_trackAlcohol'), false);
  assert.deepEqual(JSON.parse(ls.get('bbPdfOmitTrackers')), []);
  assert.deepEqual([...api._trkTombstones()], ['c5k']);
  ok('definition, switch, renamed label and PDF tick removed; account fields deleted + deletedTrackers; stale copies filtered');
}
console.log(`\n${pass} scenarios passed`);
