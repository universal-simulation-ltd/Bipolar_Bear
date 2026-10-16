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
const names = ['_userEncrypt','_userDecrypt','_wrapDataKey','_unwrapDataKey','_keyModeOf','_rawKeyB64','_preferAccountKey','_checkDeviceKey','_keyOpensAccountEntries','_reencryptUnderAccountKey','_decodeFirestoreEntry','_encryptExistingEntries'];
const code = names.map(extract).join('\n\n');
const subtle = crypto.subtle;
const newKey = async () => subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, true, ['encrypt','decrypt']);

async function scenario(label, setup) {
  const writes = [];
  const store = { settings: {}, entries: {} };
  const mkDoc = (id) => ({ id, data: () => store.entries[id], ref: { set: async (v) => { store.entries[id] = v; writes.push(['entry', id]); } } });
  const db = {
    collection: (c) => ({
      doc: (id) => ({ get: async () => ({ exists: !!store.settings, data: () => store.settings }), set: async (v) => { Object.assign(store.settings, v); writes.push(['settings', Object.keys(v)]); } }),
      where: () => { const q = { limit: () => q, get: async () => { const docs = Object.keys(store.entries).map(mkDoc); return { docs, size: docs.length }; } }; return q; },
    }),
    batch: () => { const ops = []; return { set: (ref, v) => ops.push([ref, v]), commit: async () => { for (const [r, v] of ops) await r.set(v); } }; },
    runTransaction: async (fn) => fn({ get: async () => ({ exists: true, data: () => store.settings }), set: (ref, v) => { Object.assign(store.settings, v); writes.push(['tx', Object.keys(v)]); } }),
  };
  const serverKey = await subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, false, ['encrypt','decrypt']);
  const ctx = { crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, JSON, Promise, setTimeout, console: { warn(){}, error(){}, log: console.log }, db,
    _serverWrapKey: async () => serverKey, _sessionKey: null };
  vm.createContext(ctx);
  vm.runInContext(`let _userCryptoKey = null, _userKeyMode = null, _staleUserKeys = [], _accountKeyChecked = false, _accountKeyVerified = false, _undecryptableCount = 0;
    async function _adoptUserKey(k) { _userCryptoKey = k; _sessionKey = k; }
    ${code}
    this.api = { set k(v) { _userCryptoKey = v; }, get k() { return _userCryptoKey; }, get stale() { return _staleUserKeys; }, get bad() { return _undecryptableCount; }, get verified() { return _accountKeyVerified; },
      _checkDeviceKey, _decodeFirestoreEntry, _userEncrypt, _wrapDataKey, _rawKeyB64 };`, ctx);
  const api = ctx.api;
  await setup({ api, store, serverKey, writes, mkDoc });
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
