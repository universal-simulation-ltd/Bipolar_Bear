// The journal key fix (2026-10-16): the account's key wins over a stale device key.
// Runs the real functions from js/journal.js against a mocked Firestore + journalWrapKey.
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
// Run: node scripts/test-journal-key.mjs
const src = fs.readFileSync(new URL('../js/journal.js', import.meta.url), 'utf8');
function extract(name) {
  const re = new RegExp(`(async\\s+)?function ${name}\\s*\\(`); const m = re.exec(src); if (!m) throw new Error('no ' + name);
  let i = src.indexOf('{', src.indexOf(')', m.index)); let depth = 0, j = i;
  // walk braces, skipping strings/template literals/comments roughly
  for (; j < src.length; j++) { const c = src[j];
    if (c === '/' && src[j+1] === '/') { j = src.indexOf('\n', j); continue; }
    if (c === "'" || c === '"' || c === '`') { const q = c; j++; while (src[j] !== q) { if (src[j] === '\\') j++; j++; } continue; }
    if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) break; } }
  return src.slice(m.index, j + 1);
}
const names = ['_userDeriveKey','_rewrapJournalPassword','_userEncrypt','_userDecrypt','_wrapDataKey','_unwrapDataKey','_keyModeOf','_rawKeyB64','_preferAccountKey','_checkDeviceKey','_keyOpensAccountEntries','_reencryptUnderAccountKey','_decodeFirestoreEntry','_encryptExistingEntries'];
const code = names.map(extract).join('\n\n');
const subtle = crypto.subtle;
const newKey = async () => subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, true, ['encrypt','decrypt']);

async function scenario(label, setup) {
  const writes = [], logged = [];
  const store = { settings: {}, entries: {} };
  const mkDoc = (id) => ({ id, data: () => store.entries[id], ref: { set: async (v) => { store.entries[id] = v; writes.push(['entry', id]); } } });
  const db = {
    collection: (c) => ({
      doc: (id) => ({ get: async () => { if (store.offline) throw Object.assign(new Error('unavailable'), { code: 'unavailable' }); return { exists: !!store.settings, data: () => ({ ...store.settings }) }; }, set: async (v) => { Object.assign(store.settings, v); writes.push(['settings', Object.keys(v)]); } }),
      where: () => { const q = { limit: () => q, get: async () => { const docs = Object.keys(store.entries).map(mkDoc); return { docs, size: docs.length }; } }; return q; },
    }),
    batch: () => { const ops = []; return { set: (ref, v) => ops.push([ref, v]), commit: async () => { for (const [r, v] of ops) await r.set(v); } }; },
    runTransaction: async (fn) => { if (store.beforeTx) store.beforeTx(); return fn({ get: async () => ({ exists: true, data: () => store.settings }), set: (ref, v) => { Object.assign(store.settings, v); writes.push(['tx', Object.keys(v)]); } }); },
  };
  const serverKey = await subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, false, ['encrypt','decrypt']);
  const ctx = { crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, JSON, Promise, setTimeout, console: { warn: (...a) => logged.push(a), error: (...a) => logged.push(a), log: console.log }, db,
    _serverWrapKey: async () => serverKey, _sessionKey: null };
  vm.createContext(ctx);
  vm.runInContext(`let _userCryptoKey = null, _userKeyMode = null, _staleUserKeys = [], _accountKeyChecked = false, _accountKeyVerified = false, _undecryptableCount = 0;
    async function _adoptUserKey(k) { _userCryptoKey = k; _sessionKey = k; }
    ${code}
    this.api = { set k(v) { _userCryptoKey = v; }, get k() { return _userCryptoKey; }, get stale() { return _staleUserKeys; }, get bad() { return _undecryptableCount; }, get verified() { return _accountKeyVerified; },
      _checkDeviceKey, _decodeFirestoreEntry, _userEncrypt, _wrapDataKey, _rawKeyB64, _userDeriveKey, _rewrapJournalPassword, _unwrapDataKey };`, ctx);
  const api = ctx.api;
  await setup({ api, store, serverKey, writes, mkDoc, logged });
  console.log('PASS', label);
}
const enc = (api, key, e) => api._userEncrypt(key, e).then(x => ({ userId: 'u', timestamp: e.timestamp, ...x }));

await scenario('stale device key + Standard account key: account key wins, entries open', async ({ api, store, serverKey, mkDoc }) => {
  const K0 = await newKey(), K1 = await newKey();
  const w = await api._wrapDataKey(K1, serverKey);
  Object.assign(store.settings, { stdWrappedKey: w.wrappedKey, stdWrappedKeyIv: w.wrappedKeyIv, encMigrated: true });
  for (let t = 1; t <= 3; t++) store.entries['e' + t] = await enc(api, K1, { userId: 'u', timestamp: t, mood: 'stable' });
  api.k = K0;
  await api._checkDeviceKey({ uid: 'u' }, store.settings);
  assert.equal(await api._rawKeyB64(api.k), await api._rawKeyB64(K1));
  assert.equal(api.stale.length, 1); assert.equal(api.verified, true);
  const out = await Promise.all(Object.keys(store.entries).map(id => api._decodeFirestoreEntry(mkDoc(id))));
  assert.equal(out.filter(Boolean).length, 3); assert.equal(api.bad, 0);
});

await scenario('entry under the old device key opens and is re-encrypted under the account key', async ({ api, store, serverKey, mkDoc, writes }) => {
  const K0 = await newKey(), K1 = await newKey();
  const w = await api._wrapDataKey(K1, serverKey);
  Object.assign(store.settings, { stdWrappedKey: w.wrappedKey, stdWrappedKeyIv: w.wrappedKeyIv });
  store.entries.old = await enc(api, K0, { userId: 'u', timestamp: 9, mood: 'low' });
  api.k = K0;
  await api._checkDeviceKey({ uid: 'u' }, store.settings);
  const e = await api._decodeFirestoreEntry(mkDoc('old'));
  assert.equal(e.mood, 'low');
  await new Promise(r => setTimeout(r, 50));
  assert.ok(writes.some(x => x[0] === 'entry' && x[1] === 'old'));
  // now opens with the account key alone
  const back = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(atob(store.entries.old._iv), c => c.charCodeAt(0)) }, K1, Uint8Array.from(atob(store.entries.old._enc), c => c.charCodeAt(0)));
  assert.equal(JSON.parse(new TextDecoder().decode(back)).mood, 'low');
});

await scenario('account with no key + device key: device key becomes the Standard key, plaintext encrypted', async ({ api, store, serverKey, writes }) => {
  const K0 = await newKey();
  store.entries.p1 = { userId: 'u', timestamp: 1, mood: 'stable' };
  store.entries.p2 = { userId: 'u', timestamp: 2, mood: 'low' };
  api.k = K0;
  await api._checkDeviceKey({ uid: 'u' }, store.settings);
  assert.ok(store.settings.stdWrappedKey);
  assert.ok(Object.values(store.entries).every(e => e._enc && !e.mood));
  assert.equal(await api._rawKeyB64(api.k), await api._rawKeyB64(K0));
});

await scenario('matching device key: no change, nothing set aside, no writes', async ({ api, store, serverKey, writes }) => {
  const K1 = await newKey();
  const w = await api._wrapDataKey(K1, serverKey);
  Object.assign(store.settings, { stdWrappedKey: w.wrappedKey, stdWrappedKeyIv: w.wrappedKeyIv });
  api.k = K1;
  await api._checkDeviceKey({ uid: 'u' }, store.settings);
  assert.equal(api.stale.length, 0); assert.equal(writes.length, 0);
});

await scenario('entry no key opens is counted, not silently dropped', async ({ api, store, serverKey, mkDoc }) => {
  const K1 = await newKey(), Kx = await newKey();
  const w = await api._wrapDataKey(K1, serverKey);
  Object.assign(store.settings, { stdWrappedKey: w.wrappedKey, stdWrappedKeyIv: w.wrappedKeyIv });
  store.entries.x = await enc(api, Kx, { userId: 'u', timestamp: 1, mood: 'stable' });
  api.k = K1;
  await api._checkDeviceKey({ uid: 'u' }, store.settings);
  assert.equal(await api._decodeFirestoreEntry(mkDoc('x')), null); assert.equal(api.bad, 1);
});

// ── Keys set aside on the phone (2026-10-22): the Keychain slot is never written over ──
// A mock Keychain shared across "page loads"; the real _userExportKeyToSession,
// _setAsideDeviceKey and _loadStaleKeys run against it.
const nativeNames = ['_ssRace', '_readStaleKeysSlot', '_setAsideDeviceKey', '_loadStaleKeys', '_userExportKeyToSession', '_userImportKeyFromSession'];
const nativeCode = names.concat(nativeNames).map(extract).join('\n\n');
function keychain(opts = {}) {
  const m = new Map();
  return { m,
    getItem: (k) => opts.hang ? new Promise(() => {}) : Promise.resolve(m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (opts.failStale && k === 'bb_user_key_stale') return Promise.resolve(); m.set(k, v); return Promise.resolve(); },
    removeItem: (k) => { m.delete(k); return Promise.resolve(); } };
}
async function page(kc, store, serverKey) {
  const ss = new Map();
  const ctx = { crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, JSON, Promise, Set, Array, setTimeout, console: { warn(){}, error(){}, log: console.log },
    db: { collection: () => ({ where: () => ({ limit() { return this; }, get: async () => ({ docs: [], size: 0 }) }) }) },
    isNative: () => true, window: { BB: { secureStorage: kc } },
    sessionStorage: { getItem: k => ss.has(k) ? ss.get(k) : null, setItem: (k, v) => ss.set(k, String(v)), removeItem: k => ss.delete(k) },
    _serverWrapKey: async () => serverKey };
  vm.createContext(ctx);
  vm.runInContext(`let _userCryptoKey = null, _userKeyMode = null, _staleUserKeys = [], _accountKeyChecked = false, _accountKeyVerified = false, _undecryptableCount = 0;
    const _STALE_KEYS_SLOT = 'bb_user_key_stale'; let _staleKeysLoaded = false;
    async function _adoptUserKey(k) { _userCryptoKey = k; await _userExportKeyToSession(k); }
    ${nativeCode}
    this.api = { set k(v) { _userCryptoKey = v; }, get k() { return _userCryptoKey; }, get stale() { return _staleUserKeys; }, get bad() { return _undecryptableCount; },
      _checkDeviceKey, _decodeFirestoreEntry, _userEncrypt, _wrapDataKey, _rawKeyB64, _userExportKeyToSession, _userImportKeyFromSession, _loadStaleKeys };`, ctx);
  return ctx.api;
}
const b64 = async (k) => Buffer.from(await crypto.subtle.exportKey('raw', k)).toString('base64');
async function nativeScenario(label, fn) {
  const store = { entries: {} }; const writes = [];
  const mkDoc = (id) => ({ id, data: () => store.entries[id], ref: { set: async (v) => { store.entries[id] = v; writes.push(id); } } });
  const serverKey = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  await fn({ store, writes, mkDoc, serverKey });
  console.log('PASS', label);
}

await nativeScenario('the support case: the phone key that encrypted the entries survives the account key, and they open on the next launch', async ({ store, writes, mkDoc, serverKey }) => {
  const kc = keychain(); const K0 = await newKey(), K1 = await newKey();
  kc.m.set('bb_user_key', await b64(K0));
  const p1 = await page(kc, store, serverKey);
  const w = await p1._wrapDataKey(K1, serverKey);
  const settings = { stdWrappedKey: w.wrappedKey, stdWrappedKeyIv: w.wrappedKeyIv };
  for (let t = 1; t <= 3; t++) store.entries['e' + t] = await enc(p1, K0, { userId: 'u', timestamp: t, mood: 'low' });
  p1.k = await p1._userImportKeyFromSession();
  await p1._checkDeviceKey({ uid: 'u' }, settings);
  assert.equal(kc.m.get('bb_user_key'), await b64(K1), 'the slot now holds the account key');
  assert.deepEqual(JSON.parse(kc.m.get('bb_user_key_stale')), [await b64(K0)], 'the old key is kept');
  // Next launch: nothing in memory, only the Keychain.
  const p2 = await page(kc, store, serverKey);
  p2.k = await p2._userImportKeyFromSession();
  await p2._checkDeviceKey({ uid: 'u' }, settings);
  await p2._loadStaleKeys();
  const out = await Promise.all(Object.keys(store.entries).map(id => p2._decodeFirestoreEntry(mkDoc(id))));
  assert.equal(out.filter(Boolean).length, 3); assert.equal(p2.bad, 0);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(writes.length, 3, 're-encrypted under the account key');
  const p3 = await page(keychain(), store, serverKey); p3.k = K1;
  const again = await Promise.all(Object.keys(store.entries).map(id => p3._decodeFirestoreEntry(mkDoc(id))));
  assert.equal(again.filter(Boolean).length, 3, 'the account key alone opens them now (web, other phones)');
});

await nativeScenario('same key: nothing set aside', async ({ store, serverKey }) => {
  const kc = keychain(); const K1 = await newKey();
  kc.m.set('bb_user_key', await b64(K1));
  const p = await page(kc, store, serverKey);
  await p._userExportKeyToSession(K1);
  assert.equal(kc.m.has('bb_user_key_stale'), false);
});

await nativeScenario('the stale slot does not save: the old key is NOT written over', async ({ store, serverKey }) => {
  const kc = keychain({ failStale: true }); const K0 = await newKey(), K1 = await newKey();
  kc.m.set('bb_user_key', await b64(K0));
  const p = await page(kc, store, serverKey);
  await p._userExportKeyToSession(K1);
  assert.equal(kc.m.get('bb_user_key'), await b64(K0));
});

await nativeScenario('a Keychain that does not answer is left alone (no blind overwrite)', async ({ store, serverKey }) => {
  const kc = keychain({ hang: true }); const K0 = await newKey(), K1 = await newKey();
  kc.m.set('bb_user_key', await b64(K0));
  const p = await page(kc, store, serverKey);
  await p._userExportKeyToSession(K1);
  assert.equal(kc.m.get('bb_user_key'), await b64(K0));
});

await nativeScenario('several old keys: each is kept once, newest eight', async ({ store, serverKey }) => {
  const kc = keychain(); const keys = []; for (let i = 0; i < 10; i++) keys.push(await newKey());
  const p = await page(kc, store, serverKey);
  for (const k of keys) await p._userExportKeyToSession(k);
  await p._userExportKeyToSession(keys[9]);
  const list = JSON.parse(kc.m.get('bb_user_key_stale'));
  assert.equal(list.length, 8); assert.equal(new Set(list).size, 8);
  assert.equal(list.at(-1), await b64(keys[8]));
});

// ── Change journal password (1.45): a re-wrap of the same key ──
const pwWrap = async (api, key, password) => {
  const wrapSalt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  return { wrapSalt, ...(await api._wrapDataKey(key, await api._userDeriveKey(password, wrapSalt))) };
};
const opens = async (api, d, password) => {
  try { return await api._rawKeyB64(await api._unwrapDataKey(d.wrappedKey, d.wrappedKeyIv, await api._userDeriveKey(password, d.wrapSalt))); } catch (_) { return null; }
};

await scenario('change journal password: same key under the new password, old one no longer opens it, entries untouched', async ({ api, store, writes, logged }) => {
  const K1 = await newKey();
  Object.assign(store.settings, await pwWrap(api, K1, 'old-password'));
  for (let t = 1; t <= 3; t++) store.entries['e' + t] = await enc(api, K1, { userId: 'u', timestamp: t, mood: 'stable' });
  const before = JSON.stringify(store.entries);
  assert.equal(await api._rewrapJournalPassword('u', 'old-password', 'new-password-1'), 'ok');
  assert.equal(await opens(api, store.settings, 'new-password-1'), await api._rawKeyB64(K1));
  assert.equal(await opens(api, store.settings, 'old-password'), null);
  assert.equal(store.settings.journalPw, true);
  assert.equal(JSON.stringify(store.entries), before, 'entries re-encrypted');
  assert.ok(!writes.some(w => w[0] === 'entry'));
  assert.equal(await api._rawKeyB64(api.k), await api._rawKeyB64(K1));
  const all = JSON.stringify(store) + JSON.stringify(writes) + JSON.stringify(logged);
  assert.ok(!all.includes('old-password') && !all.includes('new-password-1'), 'a password was stored or logged');
});

await scenario('change journal password on a Standard account keeps its Standard wrap', async ({ api, store, serverKey }) => {
  const K1 = await newKey();
  const sw = await api._wrapDataKey(K1, serverKey);
  Object.assign(store.settings, { stdWrappedKey: sw.wrappedKey, stdWrappedKeyIv: sw.wrappedKeyIv }, await pwWrap(api, K1, 'old-password'));
  store.entries.e = await enc(api, K1, { userId: 'u', timestamp: 1, mood: 'low' });
  assert.equal(await api._rewrapJournalPassword('u', 'old-password', 'new-password-2'), 'ok');
  assert.equal(store.settings.stdWrappedKey, sw.wrappedKey);
  assert.equal(await opens(api, store.settings, 'new-password-2'), await api._rawKeyB64(K1));
});

await scenario('negative: a wrong current password changes nothing', async ({ api, store, writes, logged }) => {
  const K1 = await newKey();
  Object.assign(store.settings, await pwWrap(api, K1, 'old-password'));
  const before = JSON.stringify(store.settings);
  assert.equal(await api._rewrapJournalPassword('u', 'not-it', 'new-password-1'), 'wrong');
  assert.equal(JSON.stringify(store.settings), before); assert.equal(writes.length, 0);
  assert.ok(!JSON.stringify(logged).includes('not-it'));
});

await scenario('negative: the wrap changed on another device meanwhile: refused, the other device\'s wrap kept', async ({ api, store, writes }) => {
  const K1 = await newKey();
  Object.assign(store.settings, await pwWrap(api, K1, 'old-password'));
  const other = await pwWrap(api, K1, 'other-device-pw');
  store.beforeTx = () => Object.assign(store.settings, other);
  assert.equal(await api._rewrapJournalPassword('u', 'old-password', 'new-password-1'), 'changed');
  assert.equal(store.settings.wrappedKey, other.wrappedKey); assert.equal(writes.length, 0);
  assert.equal(await opens(api, store.settings, 'other-device-pw'), await api._rawKeyB64(K1));
});

await scenario('negative: offline throws and writes nothing', async ({ api, store, writes }) => {
  const K1 = await newKey();
  Object.assign(store.settings, await pwWrap(api, K1, 'old-password'));
  store.offline = true;
  await assert.rejects(api._rewrapJournalPassword('u', 'old-password', 'new-password-1'));
  assert.equal(writes.length, 0);
});

await scenario('negative: a wrap whose key does not open the entries is never re-wrapped', async ({ api, store, writes }) => {
  const K1 = await newKey(), Kx = await newKey();
  Object.assign(store.settings, await pwWrap(api, Kx, 'old-password'));
  store.entries.e = await enc(api, K1, { userId: 'u', timestamp: 1, mood: 'stable' });
  assert.equal(await api._rewrapJournalPassword('u', 'old-password', 'new-password-1'), 'mismatch');
  assert.equal(writes.length, 0);
});

await scenario('negative: no password wrap (Standard only, or the oldest encSalt accounts): nothing to change', async ({ api, store, serverKey, writes }) => {
  const K1 = await newKey();
  const sw = await api._wrapDataKey(K1, serverKey);
  Object.assign(store.settings, { stdWrappedKey: sw.wrappedKey, stdWrappedKeyIv: sw.wrappedKeyIv, encSalt: 'c2FsdA==' });
  assert.equal(await api._rewrapJournalPassword('u', 'x', 'new-password-1'), 'nowrap');
  assert.equal(writes.length, 0);
});
