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
const names = ['_userEncrypt', '_userDecrypt', '_trkVal', '_trkEntryHas', '_trkStripEntry', '_trkTombstones', '_trkLimit', '_trkReadFirestore', '_trkWriteFirestore', '_trkPurgeFirestore', '_trkForget', '_trkSyncForget', 'getCustomFields'];
const code = [extractConst('_TRK_BUILTINS'), extractConst('DEFAULT_CUSTOM_FIELDS'), ...names.map(extract)].join('\n\n');
const subtle = crypto.subtle;
const newKey = () => subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

function makeEnv(extra = { code: '', api: '', ctx: {} }) {
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
  const localStorage = { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k), get length() { return ls.size; }, key: i => [...ls.keys()][i] ?? null };
  class FieldPath { constructor(...p) { this.p = p; } }
  const firebase = { firestore: { FieldValue: { delete: () => ({ __del: 1 }), arrayUnion: (...x) => ({ __union: x }) }, FieldPath } };
  const ctx = { crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, JSON, Promise, Error, Set, Object, Array, setTimeout, console: { warn() {}, error() {}, log: console.log },
    db, localStorage, firebase, currentUser: { uid: 'u' }, syncCalls: 0, ...extra.ctx };
  vm.createContext(ctx);
  vm.runInContext(`let _userCryptoKey = null, _staleUserKeys = [], _editFieldOverrides = null;
    function syncTrackingPrefsToFirestore() { syncCalls++; }
    ${code}
    ${extra.code}
    ${extra.api}
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

// ── v344: the background clean-up of nameless leftovers (_trkAutoClean) ──
function extractVar(name) {
  const m = new RegExp(`var ${name} = [^;]+;`).exec(src); if (!m) throw new Error('no var ' + name); return m[0];
}
const cleanNames = ['_userEncrypt', '_userDecrypt', '_guestEncrypt', '_guestDecrypt', '_trkVal', '_trkEntryHas', '_trkStripEntry', '_trkTombstones',
  '_trkLimit', '_trkReadFirestore', '_trkWriteFirestore', '_trkReadGuest', '_trkWriteGuest', '_trkClearSelection', 'getCustomFields',
  '_trkNoteSettingsRead', '_trkDefinedIds', '_trkKeptName', '_trkNoteLabels', '_trkStepLabels', '_trkSortLeftovers', '_trkRestoreNamed',
  '_trkMaybeAutoClean', '_trkAutoClean'];
const cleanCode = [...['_TRK_RECENT_MS', '_trkAcctRead', '_trkGuestReady', '_trkCleanRun', '_trkCleanDone'].map(extractVar),
  ...cleanNames.filter(n => !names.includes(n)).map(extract)].join('\n\n');
const DAY = 864e5, NOW = Date.now();
const J = x => JSON.parse(JSON.stringify(x)); // values from the vm realm
function makeCleanEnv({ guest = false } = {}) {
  const ss = new Map();
  const logs = [];
  const ctx = {
    sessionStorage: { getItem: k => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)), removeItem: k => ss.delete(k) },
    BB: { log: (...a) => logs.push(a.join(' ')), storage: { get: () => null, set() {} },
      i18n: { tAll: k => ({ 'journal.label.sleep': ['Sleep', 'Schlaf'], 'journal.label.alcohol': ['Alcohol', 'Alkohol'], 't143.j.addedSugar': ['Added Sugar', 'Zucker'] }[k] || []) } },
    document: { getElementById: () => null }, window: {}, Map, Date, Number, String, RegExp,
    applyTrackingPrefs() {}, renderCustomTrackingRows() {}, renderFieldPickerList() {},
  };
  const code = `var _guestCryptoKey = null, _allEntries = [], selectedCustom = {}, editingEntry = null;
    const _STEP_NOTE_LABELS = { sleep: 'Sleep', alcohol: 'Alcohol', budget: 'Budget' };
    async function _guestImportKeyFromSession() { return null; }
    ${cleanCode}`;
  const api = `this.cl = { set k(v) { _userCryptoKey = v; }, set gk(v) { _guestCryptoKey = v; }, set guestReady(v) { _trkGuestReady = v; }, set all(v) { _allEntries = v; },
      get all() { return _allEntries; }, get run() { return _trkCleanRun; }, get acct() { return _trkAcctRead; },
      _trkNoteSettingsRead, _trkMaybeAutoClean, _trkAutoClean, _trkSortLeftovers, _userEncrypt, _userDecrypt, _guestEncrypt, _guestDecrypt };`;
  const env = makeEnv({ code, api, ctx });
  let reads = 0;
  const realCollection = env.ctx.db.collection;
  env.ctx.db.collection = c => {
    const col = realCollection(c);
    if (c !== 'entries') return col;
    return { where: (...a) => { const q = col.where(...a); return { get: async (...b) => { reads++; return q.get(...b); } }; } };
  };
  if (guest) env.ctx.currentUser = null;
  return Object.assign(env, { cl: env.ctx.cl, ss, logs, reads: () => reads });
}
const fresh = data => ({ exists: true, data: () => JSON.parse(JSON.stringify(data)), metadata: { fromCache: false } });
const old = i => NOW - (60 + i) * DAY;
// An account journal: c5k defined here; cGone / cLost removed by an older build (no name anywhere);
// cAcct defined only in the ACCOUNT's settings (this device hasn't loaded it); cNamed's name only in
// the account's labelOverrides; cWalk's name only in an Elaborate Responses note; cNew a nameless one
// answered yesterday; cDead deleted with its data earlier (tombstone) but written back by an old build.
async function seedAccount(env, K) {
  const E = {
    a: { timestamp: old(1), mood: 'low', customFields: { c5k: 'yes', cGone: 'no', cLost: 'yes', addedSugar: 'yes' } },
    b: { timestamp: old(2), mood: 'stable', customFields: { cGone: 'yes', cAcct: 'yes' } },
    c: { timestamp: old(3), mood: 'stable', customFields: { cNamed: 'yes', cGone: 'yes' } },
    d: { timestamp: old(4), mood: 'low', intention: 'Calm\n___\nSleep: badly\n🚶 Walk: 20 minutes', customFields: { cWalk: 'yes' } },
    e: { timestamp: old(5), mood: 'low', customFields: { cWalk: 'no', cGone: 'yes' } },
    f: { timestamp: NOW - DAY, mood: 'low', customFields: { cNew: 'yes' } },
    g: { timestamp: old(6), mood: 'manic', customFields: { cDead: 'yes', c5k: 'no' }, notes: 'keep me' },
    h: { timestamp: old(7), mood: 'low', customFields: { c5k: 'yes' } },
  };
  for (const [id, e] of Object.entries(E)) env.store.entries[id] = { userId: 'u', timestamp: e.timestamp, ...(await env.api._userEncrypt(K, { userId: 'u', ...e })) };
  env.ls.set('customTrackingFields', JSON.stringify([{ id: 'c5k', label: '5K', emoji: '🏃' }]));
  env.ls.set('deletedCustomTrackers', JSON.stringify(['cDead']));
  env.ls.set('trackCustom_cGone', 'true'); // the account's set-merge kept the old switch
  return { customTrackingFields: [{ id: 'c5k', label: '5K', emoji: '🏃' }, { id: 'cAcct', label: 'Meds on time', emoji: '💊' }],
    labelOverrides: { trackAlcohol: '🍷 Wine', trackCustom_cNamed: '🧊 Cold showers' }, trackingFields: { trackCustom_cGone: true } };
}
const openAll = async (env, K) => { const o = {}; for (const [id, v] of Object.entries(env.store.entries)) o[id] = await env.api._userDecrypt(K, v); return o; };
const idsIn = (o, id) => Object.keys(o).filter(k => o[k].customFields && id in o[k].customFields).sort();

// 6. Signed in, fresh settings read: orphans removed from every entry; a definition only on the
//    account, a name on the account and a name in a note are all kept (named ones restored, off);
//    an orphan answered yesterday waits; a tombstoned id is removed; everything stays encrypted.
{
  const env = makeCleanEnv(); const K = await newKey();
  const acct = await seedAccount(env, K);
  env.cl.k = K;
  env.cl.all = Object.values(await openAll(env, K)).map(e => JSON.parse(JSON.stringify(e)));
  env.cl._trkNoteSettingsRead('u', fresh(acct));
  env.cl._trkMaybeAutoClean();
  await env.cl.run;
  const o = await openAll(env, K);
  assert.deepEqual(idsIn(o, 'cGone'), [], 'cGone removed from every entry');
  assert.deepEqual(idsIn(o, 'cLost'), []);
  assert.deepEqual(idsIn(o, 'cDead'), [], 'tombstoned leftovers removed');
  assert.deepEqual(idsIn(o, 'cAcct'), ['b'], 'defined only in the account settings: kept');
  assert.deepEqual(idsIn(o, 'cNamed'), ['c'], 'named on the account: kept');
  assert.deepEqual(idsIn(o, 'cWalk'), ['d', 'e'], 'named in a note: kept');
  assert.deepEqual(idsIn(o, 'cNew'), ['f'], 'answered yesterday: left for now');
  assert.deepEqual(idsIn(o, 'c5k'), ['a', 'g', 'h']); assert.deepEqual(idsIn(o, 'addedSugar'), ['a']);
  assert.equal(o.g.notes, 'keep me'); assert.equal(o.d.intention, 'Calm\n___\nSleep: badly\n🚶 Walk: 20 minutes');
  for (const v of Object.values(env.store.entries)) assert.ok(v._enc && v._iv && v.userId === 'u', 'still encrypted');
  assert.deepEqual(env.log.commits, [5], 'one batch: a, b, c, e, g');
  const defs = JSON.parse(env.ls.get('customTrackingFields'));
  assert.deepEqual(defs.map(f => [f.id, f.emoji, f.label]), [['c5k', '🏃', '5K'], ['cNamed', '🧊', 'Cold showers'], ['cWalk', '🚶', 'Walk']], 'named ones restored');
  assert.equal(env.ls.get('trackCustom_cNamed'), 'false'); assert.equal(env.ls.get('trackCustom_cWalk'), 'false', 'restored switched off');
  assert.equal(env.ls.has('trackCustom_cGone'), false, 'leftover switch gone');
  assert.ok(env.ctx.syncCalls >= 1, 'restored definitions synced');
  const u = env.log.updates.at(-1); assert.deepEqual(u[0].p, ['trackingFields', 'trackCustom_cGone']);
  assert.ok(!env.cl.all.some(e => e.customFields && ('cGone' in e.customFields || 'cLost' in e.customFields)), 'loaded entries cleaned too');
  assert.ok(env.logs.some(l => /tracker clean-up: 5 entries cleaned of 3 nameless trackers; 2 restored by name labelOverride,notes ; 1 answered lately/.test(l)), env.logs.join('\n'));
  // Idempotent: a second run (next session) finds nothing and writes nothing.
  const commits = env.log.commits.length;
  const r2 = await env.cl._trkAutoClean(acct);
  assert.equal(r2.changed, 0); assert.deepEqual(J(r2.purged), []); assert.equal(env.log.commits.length, commits);
  assert.equal(JSON.parse(env.ls.get('customTrackingFields')).length, 3, 'nothing restored twice');
  // At most once per session.
  const reads = env.reads();
  env.cl._trkMaybeAutoClean(); assert.equal(env.cl.run, null); assert.equal(env.reads(), reads);
  ok('signed in: nameless orphans removed from every entry (re-encrypted); account-only definition, account name and note name kept; recent one waits; idempotent; once per session');
}

// 7. The settings read failed, timed out or came from the cache: nothing runs. No journal key: nothing runs.
for (const [label, doc] of [['failed / timed out', null], ['from cache', { exists: true, data: () => ({}), metadata: { fromCache: true } }]]) {
  const env = makeCleanEnv(); const K = await newKey();
  await seedAccount(env, K);
  env.cl.k = K;
  const before = JSON.stringify(env.store.entries);
  env.cl._trkNoteSettingsRead('u', doc);
  assert.equal(env.cl.acct, null);
  env.cl._trkMaybeAutoClean();
  assert.equal(env.cl.run, null, 'not started'); assert.equal(env.reads(), 0, 'no entry read');
  assert.equal(JSON.stringify(env.store.entries), before);
  ok('settings read ' + label + ': no clean-up');
}
{
  const env = makeCleanEnv(); const K = await newKey();
  const acct = await seedAccount(env, K);
  env.cl._trkNoteSettingsRead('u', fresh(acct)); env.cl.k = null;
  env.cl._trkMaybeAutoClean();
  assert.equal(env.cl.run, null); assert.equal(env.reads(), 0);
  env.cl._trkNoteSettingsRead('someone-else', fresh(acct)); env.cl.k = K;
  env.cl._trkMaybeAutoClean();
  assert.equal(env.cl.run, null, 'a read for another account does not count');
  ok('no journal key yet, or the read was for another account: no clean-up (and no prompt)');
}

// 8. A name recovered from the account settings keeps the tracker; no name anywhere purges it;
//    two notes that disagree on a name don't count as a name.
{
  const env = makeCleanEnv();
  env.ls.set('customTrackingFields', '[]');
  const E = [
    { timestamp: old(1), customFields: { cA: 'yes' } },
    { timestamp: old(2), customFields: { cB: 'yes' }, intention: '___\nRun: 5k' },
    { timestamp: old(3), customFields: { cB: 'no' }, intention: '___\nSwim: 1k' },
    { timestamp: old(4), customFields: { cC: 'yes' }, intention: '___\nSchlaf: schlecht\nAlkohol: 2' },
    { timestamp: old(5), customFields: { cD: 'yes' } },
  ];
  const s1 = env.cl._trkSortLeftovers(E, { labelOverrides: { trackCustom_cA: 'Journalling' } }, NOW);
  assert.deepEqual(J(s1.named), [{ id: 'cA', name: 'Journalling', source: 'labelOverride' }]);
  assert.deepEqual(J(s1.purge).sort(), ['cB', 'cC', 'cD'], 'disagreeing notes and step labels in another language are not names');
  const s2 = env.cl._trkSortLeftovers(E, null, NOW);
  assert.ok(s2.purge.includes('cA'), 'the same id with no name anywhere is purged');
  env.ls.set('_labelOverride_trackCustom_cD', '🎸 Guitar');
  assert.deepEqual(J(env.cl._trkSortLeftovers(E, null, NOW).named), [{ id: 'cD', name: '🎸 Guitar', source: 'labelOverride' }], "this device's name counts too");
  ok('name from the account settings or this device keeps it; no name anywhere purges it; ambiguous / step-label notes are not names');
}

// 9. Guests: runs once auth says there's no account; entries under a PIN stay encrypted; plaintext stays plaintext.
for (const pin of [true, false]) {
  const env = makeCleanEnv({ guest: true });
  const GK = pin ? await newKey() : null;
  env.ls.set('customTrackingFields', JSON.stringify([{ id: 'c5k', label: '5K' }]));
  for (let i = 0; i < 30; i++) {
    const e = { timestamp: old(i), mood: 'low', customFields: { c5k: 'yes', ...(i % 2 ? { cGone: 'yes' } : {}) } };
    env.ls.set('entry:' + e.timestamp, JSON.stringify(GK ? await env.cl._guestEncrypt(GK, e) : e));
  }
  env.ls.set('entry:recent', JSON.stringify(GK ? await env.cl._guestEncrypt(GK, { timestamp: NOW, customFields: { cNew: 'yes' } }) : { timestamp: NOW, customFields: { cNew: 'yes' } }));
  env.cl.gk = GK;
  env.cl._trkMaybeAutoClean(); assert.equal(env.cl.run, null, 'not before auth answers');
  env.cl.guestReady = true;
  env.cl._trkMaybeAutoClean(); await env.cl.run;
  let gone = 0, kept = 0, enc = 0, n = 0, recent = 0;
  for (const [k, v] of env.ls) {
    if (!k.startsWith('entry:')) continue;
    n++;
    const parsed = JSON.parse(v);
    if (parsed._enc) enc++;
    const e = parsed._enc ? await env.cl._guestDecrypt(GK, parsed) : parsed;
    if ('cGone' in e.customFields) gone++;
    if (e.customFields.c5k) kept++;
    if (e.customFields.cNew) recent++;
  }
  assert.equal(n, 31); assert.equal(gone, 0); assert.equal(kept, 30); assert.equal(recent, 1);
  assert.equal(enc, pin ? 31 : 0, pin ? 'all still under the PIN key' : 'plaintext guest entries stay as they were');
  assert.equal(env.ss.get('bbTrkCleaned'), 'guest');
  ok('guest ' + (pin ? 'with a PIN: cleaned, every entry still encrypted' : 'without a PIN: cleaned, plaintext as before'));
}
console.log(`\n${pass} scenarios passed`);
