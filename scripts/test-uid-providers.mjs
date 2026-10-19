// Apple / Google / passkey sign-in (2026-10-19): the same Universal ID reaches
// the same Bipolar Bear account and the same journal key, and nothing makes a
// second account or touches a journal.
//
// Part 1 runs the REAL uidSignIn / uidLink / journalWrapKey from
// functions/index.js against a mocked Firebase Admin + Supabase.
// Part 2 runs the REAL js/shared/universal-id.js (web redirect, the native
// plugin, passkeys) against a mocked browser.
// Part 3 checks the journal's Standard key opens after a provider sign-in,
// with the real _wrapDataKey / _unwrapDataKey from js/journal.js.
//
// Run: node scripts/test-uid-providers.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
let passed = 0;
async function test(label, fn) {
  await fn();
  passed++;
  console.log('PASS', label);
}

// ── Part 1: the Cloud Functions ─────────────────────────────────────────────

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** A token whose claims the functions read (Supabase checks the signature, mocked here). */
const jwt = (claims) => `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;

class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

function loadFunctions() {
  const state = {
    fbUsers: new Map(),   // uid → { uid, email, emailVerified, providerData }
    links: new Map(),     // supabaseId → { firebaseUid, email, via }
    supabase: new Map(),  // access token → Supabase /auth/v1/user body
    created: [],
    tokens: [],
  };
  let nextUid = 1;
  const notFound = () => Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
  const auth = {
    getUser: async (uid) => { const u = state.fbUsers.get(uid); if (!u) throw notFound(); return u; },
    getUserByEmail: async (email) => {
      for (const u of state.fbUsers.values()) if ((u.email || '').toLowerCase() === email) return u;
      throw notFound();
    },
    createUser: async ({ email, emailVerified }) => {
      for (const u of state.fbUsers.values()) if (u.email === email) throw Object.assign(new Error('x'), { code: 'auth/email-already-exists' });
      const u = { uid: 'fb-new-' + nextUid++, email, emailVerified, providerData: [] };
      state.fbUsers.set(u.uid, u); state.created.push(u.uid); return u;
    },
    createCustomToken: async (uid) => { state.tokens.push(uid); return jwt({ uid }); },
    updateUser: async (uid, patch) => { Object.assign(state.fbUsers.get(uid), patch); },
  };
  const linkDoc = (id) => ({
    id,
    get: async () => ({ exists: state.links.has(id), data: () => state.links.get(id) }),
    set: async (v) => { state.links.set(id, { ...v }); },
    delete: async () => { state.links.delete(id); },
  });
  const db = {
    collection: (name) => {
      if (name !== 'uidLinks') return { doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }) };
      return {
        doc: (id) => linkDoc(id),
        where: (field, op, value) => {
          const q = {
            limit: () => q,
            get: async () => {
              const docs = [...state.links.entries()].filter(([, v]) => v[field] === value)
                .map(([id]) => ({ id, ref: linkDoc(id) }));
              return { empty: docs.length === 0, docs };
            },
          };
          return q;
        },
      };
    },
    batch: () => { const ops = []; return { delete: (ref) => ops.push(ref), commit: async () => { for (const r of ops) await r.delete(); } }; },
  };
  const firestore = () => db;
  firestore.FieldValue = { serverTimestamp: () => 'now', increment: (n) => n, arrayUnion: (...a) => a, delete: () => null };
  const admin = { initializeApp() {}, firestore, auth: () => auth, messaging: () => ({}) };
  const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
  const https = { onCall: (opts, fn) => fn, onRequest: () => stub, HttpsError };
  const mods = {
    'firebase-functions/v2/https': https,
    'firebase-functions/v2/firestore': { onDocumentCreated: () => stub, onDocumentWritten: () => stub },
    'firebase-functions/v2/scheduler': { onSchedule: () => stub },
    'firebase-functions/params': { defineSecret: (n) => ({ value: () => 'test-secret-' + n }) },
    'firebase-admin': admin,
    crypto: nodeCrypto,
    resend: { Resend: class {} },
    'google-auth-library': { GoogleAuth: class {} },
  };
  const req = (name) => (name in mods ? mods[name] : stub);
  const fetchMock = async (url, init) => {
    assert.match(url, /\/auth\/v1\/user$/);
    const token = String(init.headers.Authorization).replace(/^Bearer /, '');
    const user = state.supabase.get(token);
    return user ? { ok: true, status: 200, json: async () => user } : { ok: false, status: 401, json: async () => ({}) };
  };
  const exports = {};
  const module = { exports };
  const fn = new Function('require', 'exports', 'module', 'fetch', 'console', read('functions/index.js'));
  fn(req, exports, module, fetchMock, { log() {}, warn() {}, error() {}, info() {} });
  return { fns: module.exports, state };
}

/** A Supabase session as uidSignIn sees it: the /user body plus the JWT claims. */
function session(state, { id, email, aal = 'aal1', amr = 'otp', factors = [] }) {
  const token = jwt({ sub: id, aal, amr: [{ method: amr }] });
  state.supabase.set(token, { id, email, email_confirmed_at: '2026-01-01', is_anonymous: false, factors });
  return token;
}
const call = (fn, data, auth) => fn({ data, auth });
const tokenUid = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).uid;

await test('Google for a Universal ID already joined to Bear: same Firebase uid, nothing made', async () => {
  const { fns, state } = loadFunctions();
  state.fbUsers.set('fbA', { uid: 'fbA', email: 'a@x.com', emailVerified: true, providerData: [{ providerId: 'password' }] });
  state.links.set('sb-1', { firebaseUid: 'fbA', email: 'a@x.com', via: 'password' });
  // Supabase links a verified Google address to the existing Universal ID, so
  // the email-code session and the Google session are the same user (sb-1).
  const byCode = await call(fns.uidSignIn, { token: session(state, { id: 'sb-1', email: 'a@x.com' }) });
  const byGoogle = await call(fns.uidSignIn, { token: session(state, { id: 'sb-1', email: 'a@x.com', amr: 'oauth' }), create: false });
  assert.equal(tokenUid(byCode.customToken), 'fbA');
  assert.equal(tokenUid(byGoogle.customToken), 'fbA');
  assert.equal(byGoogle.created, false);
  assert.deepEqual(state.created, []);
  assert.equal(state.links.size, 1);
});

await test('two-step: Google alone (aal1) is refused, a passkey (aal2 via 0294) gets in', async () => {
  const { fns, state } = loadFunctions();
  state.fbUsers.set('fbA', { uid: 'fbA', email: 'a@x.com', emailVerified: true, providerData: [] });
  state.links.set('sb-1', { firebaseUid: 'fbA', email: 'a@x.com', via: 'created' });
  const factors = [{ id: 'f1', status: 'verified', factor_type: 'totp' }];
  await assert.rejects(
    call(fns.uidSignIn, { token: session(state, { id: 'sb-1', email: 'a@x.com', amr: 'oauth', factors }), create: false }),
    (e) => e.code === 'failed-precondition' && e.details && e.details.reason === 'two-step');
  const r = await call(fns.uidSignIn, { token: session(state, { id: 'sb-1', email: 'a@x.com', amr: 'passkey', aal: 'aal2', factors }), create: false });
  assert.equal(tokenUid(r.customToken), 'fbA');
});

await test('a provider address that matches a Bear password account asks for that password, makes nothing', async () => {
  const { fns, state } = loadFunctions();
  state.fbUsers.set('fbB', { uid: 'fbB', email: 'b@x.com', emailVerified: false, providerData: [{ providerId: 'password' }] });
  const token = session(state, { id: 'sb-2', email: 'b@x.com', amr: 'oauth' });
  const r = await call(fns.uidSignIn, { token, create: false });
  assert.deepEqual(r, { status: 'link', email: 'b@x.com' });
  assert.equal(state.links.size, 0);
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.tokens, [], 'no custom token on the email alone');
  // The Google session cannot join the account without its password …
  await assert.rejects(call(fns.uidLink, { token }, { uid: 'fbB', token: { firebase: { sign_in_provider: 'custom' }, auth_time: Math.floor(Date.now() / 1000) } }),
    (e) => e.code === 'permission-denied');
  assert.equal(state.links.size, 0);
  // … and with it, joins that same account: the old journal comes along.
  await call(fns.uidLink, { token }, { uid: 'fbB', token: { firebase: { sign_in_provider: 'password' }, auth_time: Math.floor(Date.now() / 1000) } });
  const after = await call(fns.uidSignIn, { token, create: false });
  assert.equal(tokenUid(after.customToken), 'fbB');
  assert.deepEqual(state.created, []);
});

await test("Apple's private relay address: 'new', relay flagged, nothing made until the person chooses", async () => {
  const { fns, state } = loadFunctions();
  state.fbUsers.set('fbA', { uid: 'fbA', email: 'a@x.com', emailVerified: true, providerData: [{ providerId: 'password' }] });
  state.links.set('sb-1', { firebaseUid: 'fbA', email: 'a@x.com', via: 'password' });
  const token = session(state, { id: 'sb-3', email: 'q7x2@privaterelay.appleid.com', amr: 'oauth' });
  const r = await call(fns.uidSignIn, { token, create: false });
  assert.deepEqual(r, { status: 'new', email: 'q7x2@privaterelay.appleid.com', relay: true });
  assert.deepEqual(state.created, []);
  assert.equal(state.links.size, 1, 'no link written');
  assert.deepEqual(state.tokens, []);
  // "Start a new account": made once, and the existing account is untouched.
  const made = await call(fns.uidSignIn, { token });
  assert.equal(made.created, true);
  assert.equal(state.created.length, 1);
  assert.equal(state.links.get('sb-1').firebaseUid, 'fbA');
  const again = await call(fns.uidSignIn, { token, create: false });
  assert.equal(tokenUid(again.customToken), state.created[0]);
  assert.equal(state.created.length, 1);
});

await test("a Gmail Bear has never seen: 'new' (not relay); the old client path still makes the account", async () => {
  const { fns, state } = loadFunctions();
  const token = session(state, { id: 'sb-4', email: 'other@gmail.com', amr: 'oauth' });
  const r = await call(fns.uidSignIn, { token, create: false });
  assert.equal(r.status, 'new');
  assert.equal(r.relay, false);
  assert.deepEqual(state.created, []);
  const codeToken = session(state, { id: 'sb-5', email: 'fresh@x.com' });
  const old = await call(fns.uidSignIn, { token: codeToken });
  assert.equal(old.created, true, 'callers that send no create flag are unchanged');
});

await test('an account another Universal ID holds is never adopted by email', async () => {
  const { fns, state } = loadFunctions();
  state.fbUsers.set('fbD', { uid: 'fbD', email: 'd@x.com', emailVerified: true, providerData: [] });
  state.links.set('sb-old', { firebaseUid: 'fbD', email: 'old@x.com', via: 'created' });
  await assert.rejects(call(fns.uidSignIn, { token: session(state, { id: 'sb-6', email: 'd@x.com', amr: 'oauth' }), create: false }),
    (e) => e.code === 'already-exists');
  assert.equal(state.links.get('sb-old').firebaseUid, 'fbD');
  assert.equal(state.links.has('sb-6'), false);
});

// ── Part 3 (needs Part 1's module): the journal key after a provider sign-in ──

await test('the journal key after Google opens what was saved after the emailed code', async () => {
  const { fns, state } = loadFunctions();
  state.fbUsers.set('fbA', { uid: 'fbA', email: 'a@x.com', emailVerified: true, providerData: [] });
  state.links.set('sb-1', { firebaseUid: 'fbA', email: 'a@x.com', via: 'created' });
  const src = read('js/journal.js');
  const pick = (name) => {
    const m = new RegExp(`async function ${name}\\s*\\(`).exec(src);
    let i = src.indexOf('{', m.index), depth = 0, j = i;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && !--depth) break; }
    return src.slice(m.index, j + 1);
  };
  const ctx = vm.createContext({ crypto: globalThis.crypto, btoa, atob, Uint8Array, String });
  vm.runInContext(`${pick('_wrapDataKey')}\n${pick('_unwrapDataKey')}\nthis.w = _wrapDataKey; this.u = _unwrapDataKey;`, ctx);
  const subtle = globalThis.crypto.subtle;
  const wrapKeyFor = async (uid) => {
    const { key } = await fns.journalWrapKey({ auth: { uid, token: { firebase: { sign_in_provider: 'custom' } } }, data: {} });
    return subtle.importKey('raw', Uint8Array.from(atob(key), (c) => c.charCodeAt(0)), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  };
  // Signed in by code: the journal's data key is wrapped with the account's key.
  const byCode = tokenUid((await call(fns.uidSignIn, { token: session(state, { id: 'sb-1', email: 'a@x.com' }) })).customToken);
  const dataKey = await subtle.importKey('raw', globalThis.crypto.getRandomValues(new Uint8Array(32)), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  const wrapped = await ctx.w(dataKey, await wrapKeyFor(byCode));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const entry = await subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, new TextEncoder().encode('{"mood":"stable"}'));
  // Signed in with Google: same uid, so the same wrap key unwraps the same data key.
  const byGoogle = tokenUid((await call(fns.uidSignIn, { token: session(state, { id: 'sb-1', email: 'a@x.com', amr: 'oauth' }), create: false })).customToken);
  assert.equal(byGoogle, byCode);
  const back = await ctx.u(wrapped.wrappedKey, wrapped.wrappedKeyIv, await wrapKeyFor(byGoogle));
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, back, entry);
  assert.equal(new TextDecoder().decode(plain), '{"mood":"stable"}');
  // A different account's key does NOT open it (so a wrong join could never pass silently).
  await assert.rejects(ctx.u(wrapped.wrappedKey, wrapped.wrappedKeyIv, await wrapKeyFor('fbOther')));
});

await test('no journal code path depends on how the person signed in', async () => {
  const src = read('js/journal.js');
  assert.doesNotMatch(src, /sign_in_provider|signInWithPasskey|startProvider|pendingReturn/);
});

// ── Part 2: js/shared/universal-id.js ───────────────────────────────────────

const UID_SRC = read('js/shared/universal-id.js');
const SB = 'https://rygfxgalojojppxmhddo.supabase.co';
const sha256b64url = (s) => nodeCrypto.createHash('sha256').update(s).digest('base64url');
const fakeSession = { access_token: jwt({ aal: 'aal1' }), refresh_token: 'r1', expires_in: 3600, user: { email: 'a@x.com' } };

function browser({ href = 'https://www.bipolarbear.app/index.html', native = null, routes = {}, session: stored = {}, credentials = null } = {}) {
  const calls = [];
  const local = new Map(), sess = new Map(Object.entries(stored));
  const store = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) });
  const url = new URL(href);
  const location = { href, origin: url.origin, pathname: url.pathname, assigned: null, assign(u) { this.assigned = u; } };
  const history = { state: null, replaced: null, replaceState(s, t, u) { this.replaced = u; } };
  const fetch = async (u, init = {}) => {
    const path = u.replace(SB + '/auth/v1/', '').replace(/^https:\/\/europe-west1-[^/]+\.cloudfunctions\.net\//, 'fn:');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, body, headers: init.headers });
    const route = routes[path.split('?')[0]] || routes[path];
    if (!route) return { ok: false, status: 404, text: async () => '{}', json: async () => ({}) };
    const out = await route(body, path);
    const status = out && out.__status || 200;
    const json = out && out.__status ? out.body : out;
    return { ok: status < 300, status, text: async () => JSON.stringify(json), json: async () => json };
  };
  const firebaseUser = { signedIn: null };
  const firebase = {
    apps: [1],
    auth: () => ({ currentUser: null, onAuthStateChanged() {}, signInWithCustomToken: async (t) => { firebaseUser.signedIn = t; } }),
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, setTimeout, Promise, JSON, URL, URLSearchParams, TextEncoder, Uint8Array,
    Array, String, Number, Date, Object, Math, RegExp, Error,
    btoa, atob, crypto: globalThis.crypto, fetch, location, history,
    localStorage: store(local), sessionStorage: store(sess),
    navigator: { credentials },
    firebase, BB_FIREBASE_CONFIG: { projectId: 'bipolarbear-app' },
    Capacitor: native ? {
      isNativePlatform: () => true, getPlatform: () => native.platform, isPluginAvailable: (n) => n === 'BBSignIn',
      Plugins: { BBSignIn: native },
    } : undefined,
    PublicKeyCredential: credentials ? function PublicKeyCredential() {} : undefined,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(UID_SRC, ctx);
  return { uid: ctx.BB.uid, calls, local, sess, location, history, firebaseUser, ctx };
}
const savedSession = (b) => JSON.parse(b.local.get('bbUidSession') || 'null');

await test('web: Google leaves for Supabase with an S256 PKCE challenge and comes back to this page', async () => {
  const b = browser({ href: 'https://www.bipolarbear.app/journal.html?mood=low' });
  const r = await b.uid.startProvider('google');
  assert.equal(r.redirected, true);
  const go = new URL(b.location.assigned);
  assert.equal(go.origin + go.pathname, SB + '/auth/v1/authorize');
  assert.equal(go.searchParams.get('provider'), 'google');
  assert.equal(go.searchParams.get('redirect_to'), 'https://www.bipolarbear.app/journal.html?uidReturn=1');
  assert.equal(go.searchParams.get('code_challenge_method'), 's256');
  const kept = JSON.parse(b.sess.get('bbUidPkce'));
  assert.equal(go.searchParams.get('code_challenge'), sha256b64url(kept.v));
  assert.ok(!b.location.assigned.includes(kept.v), 'the verifier never leaves the page');
  assert.equal(kept.provider, 'google');
});

await test('web return: the code is redeemed with this tab\'s verifier, the address bar is cleaned', async () => {
  const b = browser({
    href: 'https://www.bipolarbear.app/index.html?uidReturn=1&code=abc123',
    session: { bbUidPkce: JSON.stringify({ v: 'verifier-1', provider: 'apple', at: Date.now() }) },
    routes: { token: (body, path) => { assert.equal(path, 'token?grant_type=pkce'); assert.deepEqual(body, { auth_code: 'abc123', code_verifier: 'verifier-1' }); return fakeSession; } },
  });
  const r = await b.uid.pendingReturn();
  assert.deepEqual({ ok: r.ok, provider: r.provider }, { ok: true, provider: 'apple' });
  assert.equal(savedSession(b).refresh_token, 'r1');
  assert.equal(b.history.replaced, '/index.html');
  assert.equal(b.sess.has('bbUidPkce'), false);
});

await test('web return: a code this tab never asked for, or tokens in the fragment, are ignored', async () => {
  const stray = browser({ href: 'https://www.bipolarbear.app/index.html?uidReturn=1&code=evil' });
  const r1 = await stray.uid.pendingReturn();
  assert.equal(r1.ok, false);
  assert.equal(stray.calls.filter((c) => c.path.startsWith('token')).length, 0);
  assert.equal(savedSession(stray), null);
  const frag = browser({
    href: 'https://www.bipolarbear.app/index.html?uidReturn=1#access_token=evil&refresh_token=evil',
    session: { bbUidPkce: JSON.stringify({ v: 'v', provider: 'google', at: Date.now() }) },
  });
  assert.equal(await frag.uid.pendingReturn(), null);
  assert.equal(savedSession(frag), null);
  assert.equal(frag.history.replaced, '/index.html');
  const old = browser({
    href: 'https://www.bipolarbear.app/index.html?uidReturn=1&code=late',
    session: { bbUidPkce: JSON.stringify({ v: 'v', provider: 'google', at: Date.now() - 60 * 60 * 1000 }) },
  });
  assert.equal((await old.uid.pendingReturn()).ok, false);
  assert.equal(savedSession(old), null);
  const none = browser({ href: 'https://www.bipolarbear.app/index.html?code=123456' });
  assert.equal(await none.uid.pendingReturn(), null, 'other ?code= links are not ours');
});

await test('web return: the person said no at Google → cancelled, nothing saved', async () => {
  const b = browser({
    href: 'https://www.bipolarbear.app/index.html?uidReturn=1&error=access_denied&error_description=User+denied',
    session: { bbUidPkce: JSON.stringify({ v: 'v', provider: 'google', at: Date.now() }) },
  });
  const r = await b.uid.pendingReturn();
  assert.equal(r.reason, 'cancelled');
  assert.equal(savedSession(b), null);
});

await test('iPhone: Apple is the system sheet, its token goes to the id_token grant with the raw nonce', async () => {
  const b = browser({
    native: {
      platform: 'ios',
      support: async () => ({ platform: 'ios', callbackUrl: 'com.app.bipolarbear://auth-callback', appleNative: true, passkeys: true }),
      appleSignIn: async () => ({ identityToken: 'apple-jwt', nonce: 'raw-nonce' }),
      oauthStart: async () => { throw new Error('Apple must not use the browser on iPhone'); },
    },
    routes: { token: (body, path) => { assert.equal(path, 'token?grant_type=id_token'); assert.deepEqual(body, { provider: 'apple', id_token: 'apple-jwt', nonce: 'raw-nonce' }); return fakeSession; } },
  });
  const r = await b.uid.startProvider('apple');
  assert.equal(r.ok, true);
  assert.equal(savedSession(b).access_token, fakeSession.access_token);
  assert.equal(b.location.assigned, null);
});

await test('Android: Google in a Custom Tab; only a code for this app is accepted', async () => {
  const mk = (cb) => browser({
    native: {
      platform: 'android',
      support: async () => ({ platform: 'android', callbackUrl: 'com.bipolarbear.app://auth-callback', appleNative: false, passkeys: true }),
      oauthStart: async ({ url }) => {
        const u = new URL(url);
        assert.equal(u.searchParams.get('redirect_to'), 'com.bipolarbear.app://auth-callback');
        assert.equal(u.searchParams.get('code_challenge_method'), 's256');
        return { url: cb };
      },
    },
    routes: { token: (body) => { assert.equal(body.auth_code, 'good'); assert.ok(body.code_verifier.length >= 43); return fakeSession; } },
  });
  const ok = mk('com.bipolarbear.app://auth-callback?code=good');
  assert.equal((await ok.uid.startProvider('google')).ok, true);
  assert.equal(savedSession(ok).refresh_token, 'r1');
  for (const bad of ['com.bipolarbear.app://auth-callback#access_token=evil&refresh_token=evil',
    'com.evil.app://auth-callback?code=good', 'https://auth-callback?code=good']) {
    const b = mk(bad);
    const r = await b.uid.startProvider('google');
    assert.equal(r.ok, false, bad);
    assert.equal(savedSession(b), null, bad);
  }
  const cancelled = browser({ native: { platform: 'android', support: async () => ({ platform: 'android', callbackUrl: 'com.bipolarbear.app://auth-callback' }), oauthStart: async () => ({ cancelled: true }) } });
  assert.equal((await cancelled.uid.startProvider('apple')).reason, 'cancelled');
});

const pkOptions = () => ({ challenge_id: 'ch-1', options: { challenge: 'Y2hhbGxlbmdl', rpId: 'app.unisim.co.uk', timeout: 300000, userVerification: 'preferred' } });
const assertion = { id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA', userHandle: 'dQ' }, clientExtensionResults: {} };

await test('web passkey: off to the Hub page with a state only this tab knows', async () => {
  const b = browser({ credentials: { get: async () => { throw new Error('no ceremony on this site'); } } });
  const r = await b.uid.signInWithPasskey();
  assert.equal(r.redirected, true);
  const go = new URL(b.location.assigned);
  assert.equal(go.origin + go.pathname, 'https://app.unisim.co.uk/passkey-handoff');
  assert.equal(go.searchParams.get('return'), 'https://www.bipolarbear.app/index.html');
  const kept = JSON.parse(b.sess.get('bbUidPasskeyState'));
  assert.match(kept.s, /^[a-f0-9]{64}$/);
  assert.equal(go.searchParams.get('state'), kept.s);
});

await test('web passkey return: the code is redeemed only with our state, from the fragment', async () => {
  const S = 'b'.repeat(64);
  const good = browser({
    href: `https://www.bipolarbear.app/journal.html#bb_passkey=th-1&state=${S}`,
    session: { bbUidPasskeyState: JSON.stringify({ s: S, at: Date.now() }) },
    routes: { verify: (body) => { assert.deepEqual(body, { type: 'magiclink', token_hash: 'th-1' }); return fakeSession; } },
  });
  const r = await good.uid.pendingReturn();
  assert.deepEqual({ ok: r.ok, provider: r.provider }, { ok: true, provider: 'passkey' });
  assert.equal(savedSession(good).refresh_token, 'r1');
  assert.equal(good.history.replaced, '/journal.html', 'code gone from the address bar');
  assert.equal(good.sess.has('bbUidPasskeyState'), false);
  // Someone else's code (login CSRF): wrong state, or no state kept here.
  for (const session of [{ bbUidPasskeyState: JSON.stringify({ s: 'c'.repeat(64), at: Date.now() }) }, {}]) {
    const evil = browser({ href: `https://www.bipolarbear.app/index.html#bb_passkey=attacker&state=${S}`, session,
      routes: { verify: () => { throw new Error('must not redeem'); } } });
    const e = await evil.uid.pendingReturn();
    assert.equal(e.ok, false);
    assert.equal(savedSession(evil), null);
    assert.equal(evil.calls.filter((c) => c.path === 'verify').length, 0);
  }
  const back = browser({ href: `https://www.bipolarbear.app/index.html#bb_passkey_error=cancelled&state=${S}`,
    session: { bbUidPasskeyState: JSON.stringify({ s: S, at: Date.now() }) } });
  assert.equal((await back.uid.pendingReturn()).reason, 'cancelled');
});

await test('native passkey: a wrong relying party is refused; a closed sheet is "cancelled"', async () => {
  const nat = (passkeyGet, options) => browser({
    native: { platform: 'ios', support: async () => ({ platform: 'ios', callbackUrl: 'com.app.bipolarbear://auth-callback', appleNative: true, passkeys: true }), passkeyGet },
    routes: { 'passkeys/authentication/options': () => options || pkOptions() },
  });
  const wrong = nat(async () => { throw new Error('must not be called'); }, { challenge_id: 'c', options: { challenge: 'AA', rpId: 'evil.example' } });
  assert.equal((await wrong.uid.signInWithPasskey()).ok, false);
  const closed = nat(async () => ({ cancelled: true }));
  assert.equal((await closed.uid.signInWithPasskey()).reason, 'cancelled');
  assert.equal(savedSession(closed), null);
});

await test('native passkey: the plugin gets the options with verification required', async () => {
  let sent = null;
  const b = browser({
    native: { platform: 'android', support: async () => ({ platform: 'android', callbackUrl: 'com.bipolarbear.app://auth-callback', passkeys: true }),
      passkeyGet: async ({ options }) => { sent = JSON.parse(options); return { credential: JSON.stringify(assertion) }; } },
    routes: { 'passkeys/authentication/options': () => pkOptions(), 'passkeys/authentication/verify': (body) => { assert.equal(body.challenge_id, 'ch-1'); assert.deepEqual(body.credential, assertion); return { ...fakeSession, access_token: jwt({ aal: 'aal2', amr: [{ method: 'passkey' }] }) }; } },
  });
  assert.equal((await b.uid.signInWithPasskey()).ok, true);
  // A native passkey session is aal2 (0294), so no authenticator code is asked for.
  assert.equal(await b.uid.twoStepFactor(), null);
  assert.equal(sent.rpId, 'app.unisim.co.uk');
  assert.equal(sent.userVerification, 'required');
  const none = browser({ native: { platform: 'android', support: async () => ({ platform: 'android', callbackUrl: 'com.bipolarbear.app://auth-callback', passkeys: true }), passkeyGet: async () => ({ noCredential: true }) },
    routes: { 'passkeys/authentication/options': () => pkOptions() } });
  assert.equal((await none.uid.signInWithPasskey()).reason, 'no-passkey');
});

await test('what the sheet offers: App Review 4.8 on iPhone, passkeys only where they can work', async () => {
  const settings = (apple) => () => ({ external: { apple, google: true }, passkeys_enabled: true });
  const iosNoApple = browser({ native: { platform: 'ios', support: async () => ({ platform: 'ios', callbackUrl: 'com.app.bipolarbear://auth-callback', appleNative: true, passkeys: true }) }, routes: { settings: settings(false) } });
  assert.deepEqual({ ...(await iosNoApple.uid.signInOptions()) }, { apple: false, google: false, passkey: true });
  const ios = browser({ native: { platform: 'ios', support: async () => ({ platform: 'ios', callbackUrl: 'com.app.bipolarbear://auth-callback', appleNative: true, passkeys: true }) }, routes: { settings: settings(true) } });
  assert.deepEqual({ ...(await ios.uid.signInOptions()) }, { apple: true, google: true, passkey: true });
  const oldBuild = browser({ native: { platform: 'ios' }, routes: { settings: settings(true) } });
  assert.deepEqual({ ...(await oldBuild.uid.signInOptions()) }, { apple: false, google: false, passkey: false });
  const web = browser({ credentials: { get() {} }, routes: { settings: settings(true) } });
  assert.deepEqual({ ...(await web.uid.signInOptions()) }, { apple: true, google: true, passkey: true });
  const preview = browser({ href: 'https://abc.bipolarbear.pages.dev/index.html', credentials: { get() {} }, routes: { settings: settings(true) } });
  assert.equal((await preview.uid.signInOptions()).passkey, false);
  const offline = browser({ routes: {} });
  assert.deepEqual({ ...(await offline.uid.signInOptions()) }, { apple: false, google: false, passkey: false });
});

await test('finishSignIn: create:false is sent after a provider, "new" comes back; the code path sends none', async () => {
  const seen = [];
  const b = browser({ routes: { 'fn:uidSignIn': (body) => { seen.push(body.data); return { result: body.data.create === false ? { status: 'new', email: 'q@privaterelay.appleid.com', relay: true } : { status: 'ok', customToken: jwt({ uid: 'fbX' }), created: true } }; } } });
  b.local.set('bbUidSession', JSON.stringify({ access_token: 'tok-xxxxxxxxxxxxxxxxxxxx', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
  const r = await b.uid.finishSignIn({ create: false });
  assert.deepEqual({ ...r }, { status: 'new', email: 'q@privaterelay.appleid.com', relay: true });
  assert.equal(b.firebaseUser.signedIn, null, 'nothing signed in to Firebase');
  assert.equal(b.uid.hasSession(), true, 'the session waits for the person to choose');
  const made = await b.uid.finishSignIn();
  assert.equal(made.status, 'signed-in');
  assert.deepEqual(seen.map((d) => d.create), [false, undefined]);
});

console.log(`\n${passed} passed`);
