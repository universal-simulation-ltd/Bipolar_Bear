// A guest with or without a PIN (pin143, 2026-10-17). Runs the real functions
// from js/journal.js with real WebCrypto against a fake localStorage:
// "Continue without a PIN" saves plain entries; Set a PIN later encrypts every
// one; Remove PIN decrypts every one; a failure part-way loses nothing and a
// second run finishes; an entry that won't open blocks Remove before anything
// is written; a locked PIN never writes plaintext; the sign-in migration takes
// plain guest entries. Run: node scripts/test-guest-pin.mjs
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
const names = ['_guestDeriveKey', '_guestEncrypt', '_guestDecrypt', '_guestExportKeyToSession', '_guestImportKeyFromSession',
  '_guestHasPin', '_guestChoseNoPin', '_guestStorageReady', '_guestStoreValue', '_guestEntryRaws', '_guestConvertError',
  '_guestEncryptAll', '_guestDecryptAll', '_guestRemovePin', '_guestFailText', 'migrateGuestEntriesIfNeeded', '_userEncrypt', '_userDecrypt'];
const code = names.map(extract).join('\n\n');

function makeEnv() {
  const ls = new Map(), ss = new Map();
  const failOn = { set: null }; // a key whose next setItem throws (a full disk, a killed app)
  const localStorage = {
    getItem: k => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => { if (failOn.set && failOn.set(k, v)) { failOn.set = null; throw new Error('QuotaExceededError'); } ls.set(k, String(v)); },
    removeItem: k => ls.delete(k), get length() { return ls.size; }, key: i => [...ls.keys()][i] ?? null,
  };
  const sessionStorage = { getItem: k => (ss.has(k) ? ss.get(k) : null), setItem: (k, v) => ss.set(k, String(v)), removeItem: k => ss.delete(k) };
  const BB = {
    storage: { get: k => localStorage.getItem('bb' + k), set: (k, v) => localStorage.setItem('bb' + k, v), remove: k => localStorage.removeItem('bb' + k) },
    t: (k, v) => k + (v ? JSON.stringify(v) : ''),
    pin: { clearFailures() {} },
    platform: { syncWidgetMoods() {} },
  };
  const fsStore = { entries: {} }; let nextId = 0;
  const db = {
    collection: c => ({
      where: () => ({ limit: () => ({ get: async () => ({ size: Object.keys(fsStore.entries).length }) }) }),
      doc: () => ({ id: 'd' + (nextId++) }),
    }),
    batch: () => { const ops = []; return { set: (r, v) => ops.push([r, v]), commit: async () => { for (const [r, v] of ops) fsStore.entries[r.id] = v; } }; },
  };
  const log = { alerts: [], confirms: [], loads: 0, rows: [] };
  const ctx = { crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, JSON, Promise, Error, Set, Object, Array, String, setTimeout, console: { warn() {}, error() {}, log: console.log },
    localStorage, sessionStorage, BB, db, document: { getElementById: () => null },
    alert: m => log.alerts.push(m), confirm: m => { log.confirms.push(m); return ctx.__confirm !== false; },
    loadEntries: async () => { log.loads++; }, _syncGuestPinRow: s => log.rows.push(s), __confirm: true };
  vm.createContext(ctx);
  vm.runInContext(`let _guestCryptoKey = null; var _guestConvertBusy = false; let _userCryptoKey = null;
    ${code}
    this.api = { get key() { return _guestCryptoKey; }, set key(v) { _guestCryptoKey = v; }, set userKey(v) { _userCryptoKey = v; },
      get busy() { return _guestConvertBusy; },
      _guestDeriveKey, _guestEncrypt, _guestDecrypt, _guestExportKeyToSession, _guestStorageReady, _guestStoreValue,
      _guestEncryptAll, _guestDecryptAll, _guestRemovePin, migrateGuestEntriesIfNeeded, _userDecrypt };`, ctx);
  return { api: ctx.api, ls, ss, failOn, fsStore, log, ctx, localStorage };
}
const entry = i => ({ timestamp: 1000 + i, date: new Date(2026, 9, 1 + (i % 28)).toISOString(), mood: ['stable', 'low', 'manic'][i % 3], notes: 'note ' + i, energy: i % 5 });
const raw = (env, i) => JSON.parse(env.ls.get('entry:' + (1000 + i)));
let pass = 0; const ok = l => { pass++; console.log('PASS', l); };

async function setPin(env, pin = '1234') {
  const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  env.localStorage.setItem('bbGuestPinSalt', salt); env.localStorage.removeItem('bbGuestNoPin');
  env.localStorage.setItem('bbPinEnabled', '1'); env.localStorage.setItem('bbPinCode', 'pbkdf2$x');
  env.api.key = await env.api._guestDeriveKey(pin, salt);
  await env.api._guestExportKeyToSession(env.api.key);
  return env.api.key;
}

// 1. "Continue without a PIN": the save gate opens, and entries are plain JSON.
{
  const env = makeEnv();
  assert.equal(env.api._guestStorageReady(), false, 'a new guest is asked first');
  env.localStorage.setItem('bbGuestNoPin', '1');
  assert.equal(env.api._guestStorageReady(), true, 'no repeat prompt after choosing no PIN');
  for (let i = 0; i < 5; i++) env.localStorage.setItem('entry:' + (1000 + i), await env.api._guestStoreValue(entry(i)));
  for (let i = 0; i < 5; i++) assert.deepEqual(raw(env, i), entry(i), 'plain entry ' + i);
  // The old optional PIN (bbPinEnabled, no salt) still means no encryption key: asked again.
  const env2 = makeEnv(); env2.localStorage.setItem('bbPinEnabled', '1');
  assert.equal(env2.api._guestStorageReady(), false);
  ok('no PIN: plain entries, remembered choice, stale bbPinEnabled still asks');
}

// 2. Set a PIN later: every plain entry is encrypted and opens with the key; a
//    re-run changes nothing; new saves are encrypted.
{
  const env = makeEnv(); env.localStorage.setItem('bbGuestNoPin', '1');
  for (let i = 0; i < 30; i++) env.localStorage.setItem('entry:' + (1000 + i), JSON.stringify(entry(i)));
  env.localStorage.setItem('entry:bad', '{not json'); // unreadable: left alone
  const K = await setPin(env);
  assert.equal(env.localStorage.getItem('bbGuestNoPin'), null);
  const r = await env.api._guestEncryptAll(K);
  assert.deepEqual({ ...r }, { done: 30, total: 30 });
  for (let i = 0; i < 30; i++) { const v = raw(env, i); assert.ok(v._enc && v._iv && !v.mood, 'encrypted ' + i); assert.deepEqual(await env.api._guestDecrypt(K, v), entry(i)); }
  assert.equal(env.ls.get('entry:bad'), '{not json');
  const again = await env.api._guestEncryptAll(K); assert.equal(again.total, 0, 'idempotent');
  // "Reload + unlock": the key derived again from the PIN opens them.
  const K2 = await env.api._guestDeriveKey('1234', env.localStorage.getItem('bbGuestPinSalt'));
  assert.deepEqual(await env.api._guestDecrypt(K2, raw(env, 7)), entry(7));
  env.localStorage.setItem('entry:2000', await env.api._guestStoreValue({ timestamp: 2000, mood: 'low' }));
  assert.ok(JSON.parse(env.ls.get('entry:2000'))._enc, 'a new save is encrypted');
  ok('Set a PIN: 30 entries encrypted, verified, idempotent, reopen after reload');
}

// 3. A failure mid-way (the 13th write throws): nothing is lost, the 12 before
//    are encrypted, the rest still plain; running again finishes.
{
  const env = makeEnv(); for (let i = 0; i < 25; i++) env.localStorage.setItem('entry:' + (1000 + i), JSON.stringify(entry(i)));
  const K = await setPin(env);
  let n = 0; env.failOn.set = k => k.startsWith('entry:') && ++n === 13;
  await assert.rejects(env.api._guestEncryptAll(K), e => e.done === 12 && e.total === 25);
  let enc = 0, plain = 0;
  for (let i = 0; i < 25; i++) { const v = raw(env, i); if (v._enc) { enc++; assert.deepEqual(await env.api._guestDecrypt(K, v), entry(i)); } else { plain++; assert.deepEqual(v, entry(i)); } }
  assert.equal(enc, 12); assert.equal(plain, 13);
  const r = await env.api._guestEncryptAll(K); assert.equal(r.total, 13);
  for (let i = 0; i < 25; i++) assert.deepEqual(await env.api._guestDecrypt(K, raw(env, i)), entry(i));
  ok('Set a PIN fails at entry 13: 12 encrypted + 13 plain, none lost; the re-run finishes');
}

// 4. Remove PIN: asks (confirm), decrypts all, then forgets the PIN and
//    remembers "no PIN"; a failure part-way keeps the PIN and loses nothing.
{
  const env = makeEnv(); const K = await setPin(env);
  for (let i = 0; i < 20; i++) env.localStorage.setItem('entry:' + (1000 + i), JSON.stringify(await env.api._guestEncrypt(K, entry(i))));
  // Cancel at the warning: nothing changes.
  env.ctx.__confirm = false; await env.api._guestRemovePin(K);
  assert.ok(raw(env, 0)._enc); assert.ok(env.localStorage.getItem('bbGuestPinSalt'));
  env.ctx.__confirm = true;
  // Fails at the 8th write.
  let n = 0; env.failOn.set = k => k.startsWith('entry:') && ++n === 8;
  await env.api._guestRemovePin(K);
  assert.ok(env.localStorage.getItem('bbGuestPinSalt'), 'PIN kept after a failure');
  assert.equal(env.log.alerts.length, 1); assert.match(env.log.alerts[0], /failPartial\{"done":7,"total":20\}/);
  for (let i = 0; i < 20; i++) { const v = raw(env, i); assert.deepEqual(v._enc ? await env.api._guestDecrypt(K, v) : v, entry(i)); }
  // Again: finishes, the PIN goes, "no PIN" is remembered, and the next save is plain.
  await env.api._guestRemovePin(K);
  for (let i = 0; i < 20; i++) assert.deepEqual(raw(env, i), entry(i));
  for (const k of ['bbGuestPinSalt', 'bbPinCode', 'bbPinEnabled']) assert.equal(env.localStorage.getItem(k), null, k);
  assert.equal(env.localStorage.getItem('bbGuestNoPin'), '1');
  assert.equal(env.ss.get('bb_guest_key'), undefined);
  assert.equal(env.api.key, null); assert.equal(env.api.busy, false);
  env.localStorage.setItem('entry:3000', await env.api._guestStoreValue({ timestamp: 3000, mood: 'stable' }));
  assert.equal(JSON.parse(env.ls.get('entry:3000')).mood, 'stable');
  ok('Remove PIN: cancel changes nothing; a failure at 8 keeps the PIN, loses nothing; the re-run decrypts all 20');
}

// 5. Remove PIN with an entry the PIN can't open: nothing is written, the PIN stays.
{
  const env = makeEnv(); const K = await setPin(env);
  for (let i = 0; i < 5; i++) env.localStorage.setItem('entry:' + (1000 + i), JSON.stringify(await env.api._guestEncrypt(K, entry(i))));
  const other = await env.api._guestDeriveKey('9999', btoa('0123456789abcdef'));
  env.localStorage.setItem('entry:9', JSON.stringify(await env.api._guestEncrypt(other, entry(9))));
  const before = JSON.stringify([...env.ls]);
  await env.api._guestRemovePin(K);
  assert.equal(JSON.stringify([...env.ls]), before, 'nothing written');
  assert.match(env.log.alerts[0], /removeLocked\{"n":1\}/);
  ok('Remove PIN refuses, untouched, when an entry does not open with this PIN');
}

// 6. A PIN that is set but locked (no key in memory or session) never writes plaintext.
{
  const env = makeEnv(); await setPin(env); env.api.key = null; env.ss.clear();
  await assert.rejects(env.api._guestStoreValue(entry(1)), /not unlocked/);
  ok('a locked PIN refuses to save rather than write plaintext');
}

// 7. Sign-in migration takes a plain (no-PIN) guest's entries, encrypted under
//    the account key, then clears the guest's entries and the no-PIN choice.
{
  const env = makeEnv(); env.localStorage.setItem('bbGuestNoPin', '1');
  for (let i = 0; i < 6; i++) env.localStorage.setItem('entry:' + (1000 + i), JSON.stringify(entry(i)));
  const UK = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  env.api.userKey = UK;
  await env.api.migrateGuestEntriesIfNeeded({ uid: 'u1' });
  const docs = Object.values(env.fsStore.entries);
  assert.equal(docs.length, 6);
  for (const d of docs) { assert.ok(d._enc && d.userId === 'u1' && typeof d.timestamp === 'number'); const e = await env.api._userDecrypt(UK, d); assert.equal(e.userId, 'u1'); assert.ok(e.mood); }
  assert.equal([...env.ls.keys()].filter(k => k.startsWith('entry:')).length, 0);
  assert.equal(env.localStorage.getItem('bbGuestNoPin'), null);
  ok('sign-in migration uploads plain guest entries encrypted and clears bbGuestNoPin');
}

console.log(`\n${pass} passed`);
