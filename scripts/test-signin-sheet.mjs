#!/usr/bin/env node
/**
 * Browser check for Apple / Google / passkey on the sign-in sheet (fab.js +
 * js/shared/universal-id.js, 2026-10-19). Drives the REAL index.html in
 * Chromium, served AT https://www.bipolarbear.app (Playwright answers that
 * origin from this checkout), with Supabase, the Cloud Functions and Firebase
 * faked at the network edge. Nothing touches a real account.
 *
 *   node scripts/test-signin-sheet.mjs
 *
 * Needs Playwright with Chromium (not a dependency of this repo): point
 * PLAYWRIGHT_MODULE at any install, as for test-pin-reauth.mjs.
 *
 * What it proves:
 *  1. The email step offers Apple, Google and a passkey when Supabase has them
 *     on; the code step does not; with them off, no buttons.
 *  2. Google round trip: the page leaves for /authorize with a PKCE challenge,
 *     comes back with ?uidReturn=1&code=…, redeems it with the tab's verifier,
 *     cleans the address bar, and asks uidSignIn with create:false.
 *  3. "new" → "Start a new account" makes it (create sent as before) and signs
 *     in; "I already have an account" drops the session and goes back to the
 *     email step with the note. Nothing signs in to Firebase until chosen.
 *  4. "link" → the existing account's password step (never joined on email).
 *  5. Passkey: off to app.unisim.co.uk/passkey-handoff with a state, back
 *     with a code in the fragment, redeemed, then the same uidSignIn path; a
 *     code with someone else's state is never redeemed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;
const ORIGIN = 'https://www.bipolarbear.app';
const SB = 'https://rygfxgalojojppxmhddo.supabase.co';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (p) => b64url({ alg: 'none' }) + '.' + b64url(p) + '.sig';
const now = () => Math.floor(Date.now() / 1000);
const tokens = (claims) => ({ access_token: jwt({ exp: now() + 3600, ...claims }), refresh_token: 'r', expires_in: 3600, expires_at: now() + 3600, user: { id: 'sb-9', email: 'p@x.com' } });

// Firebase compat, faked: a signed-out page whose custom-token sign-in is recorded.
const FIREBASE_STUB = `
(function(){
  window.__calls = window.__calls || [];
  function chain(){ var p = new Proxy(function(){}, { get: function(_t, k){
    if (k === 'then') return undefined;
    if (k === 'get') return function(){ return new Promise(function(){}); };
    if (['set','update','delete','add','enablePersistence','clearPersistence'].indexOf(k) >= 0) return function(){ return Promise.resolve(); };
    if (k === 'onSnapshot') return function(){ return function(){}; };
    return function(){ return p; }; }, apply: function(){ return p; } }); return p; }
  var listeners = [];
  var authObj = {
    currentUser: null,
    setPersistence: function(){ return Promise.resolve(); },
    onAuthStateChanged: function(cb){ listeners.push(cb); setTimeout(function(){ cb(authObj.currentUser); }, 30); return function(){}; },
    onIdTokenChanged: function(){ return function(){}; },
    signInWithCustomToken: function(t){ window.__calls.push('signInWithCustomToken:' + JSON.parse(atob(t.split('.')[1])).uid); return Promise.resolve({}); },
    signInWithEmailAndPassword: function(){ window.__calls.push('signInWithEmailAndPassword'); return Promise.reject(Object.assign(new Error('x'), { code: 'auth/wrong-password' })); },
    signOut: function(){ return Promise.resolve(); },
    sendPasswordResetEmail: function(){ return Promise.resolve(); },
  };
  var auth = function(){ return authObj; };
  auth.Auth = { Persistence: { SESSION: 'session', LOCAL: 'local' } };
  auth.EmailAuthProvider = { credential: function(e, p){ return { email: e, password: p }; } };
  var fsx = function(){ return chain(); };
  fsx.FieldValue = { delete: function(){}, serverTimestamp: function(){}, increment: function(n){ return n; }, arrayUnion: function(){ return []; }, arrayRemove: function(){ return []; } };
  fsx.Timestamp = { now: function(){ return { toMillis: function(){ return Date.now(); } }; }, fromMillis: function(m){ return { toMillis: function(){ return m; } }; } };
  var apps = [];
  window.firebase = { apps: apps, initializeApp: function(){ apps.push({}); return {}; },
    app: function(){ return { functions: function(){ return { httpsCallable: function(){ return function(){ return new Promise(function(){}); }; } }; } }; },
    auth: auth, firestore: fsx,
    functions: function(){ return { httpsCallable: function(){ return function(){ return new Promise(function(){}); }; } }; },
    messaging: function(){ return chain(); } };
})();`;

const browser = await chromium.launch();
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

/**
 * @param {object} S  scenario: { providers: bool, uidSignIn: (data) => result, passkey: bool }
 */
async function openSheet(S) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  const seen = { uidSignIn: [], tokenBodies: [], authorize: [] };
  await page.route('**/*', async (route) => {
    const req = route.request();
    const u = req.url();
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: u.includes('firebase-app-compat') ? FIREBASE_STUB : '' });
    if (u.startsWith(ORIGIN)) {
      const p = path.join(ROOT, decodeURIComponent(new URL(u).pathname));
      if (/service-worker\.js|firebase-messaging-sw\.js/.test(u)) return route.abort();
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(p)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (u.startsWith('https://app.unisim.co.uk/passkey-handoff')) {
      // Stands in for the Hub page (its ceremony needs a real key or phone).
      const q = new URL(u).searchParams;
      seen.handoff = Object.fromEntries(q);
      const state = S.handoffState ? S.handoffState : q.get('state');
      const back = JSON.stringify(q.get('return') + '#bb_passkey=TH-1&state=' + state);
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${back})</script>` });
    }
    if (u.startsWith(SB + '/auth/v1/')) {
      const p = new URL(u).pathname.replace('/auth/v1/', '');
      if (p === 'settings') return json(S.providers ? { external: { apple: true, google: true, email: true }, passkeys_enabled: true } : { external: { email: true } });
      if (p === 'authorize') {
        const q = new URL(u).searchParams;
        seen.authorize.push(Object.fromEntries(q));
        // Google said yes: Supabase sends the browser back with a PKCE code.
        // (A page that sends the browser on, not a 302: Playwright lets the
        // document a fulfilled redirect leads to bypass routing, so the LIVE
        // site would load instead of this checkout.)
        const back = JSON.stringify(q.get('redirect_to') + '&code=CODE-1');
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${back})</script>` });
      }
      if (p === 'verify') { seen.verify = JSON.parse(req.postData() || '{}'); return json(tokens({ aal: 'aal1', amr: [{ method: 'otp' }] })); }
      if (p === 'token') { seen.tokenBodies.push(JSON.parse(req.postData() || '{}')); return json(tokens({ aal: 'aal1' })); }
      if (p === 'user') return json({ id: 'sb-9', factors: [] });
      if (p === 'passkeys/authentication/options') return json({ challenge_id: 'ch-1', options: { challenge: 'Y2hhbGxlbmdlLWJ5dGVz', rpId: 'app.unisim.co.uk', timeout: 300000, userVerification: 'preferred' } });
      if (p === 'passkeys/authentication/verify') { seen.passkeyVerify = JSON.parse(req.postData() || '{}'); return json(tokens({ aal: 'aal2', amr: [{ method: 'passkey' }] })); }
      if (p.startsWith('logout')) return route.fulfill({ status: 204, headers: CORS });
      return json({});
    }
    if (u.includes('cloudfunctions.net/uidSignIn')) {
      const data = JSON.parse(req.postData() || '{}').data || {};
      seen.uidSignIn.push(data);
      return json({ result: S.uidSignIn(data) });
    }
    return route.abort();
  });
  await page.addInitScript(({ passkey }) => {
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      localStorage.setItem('bbLanguage', 'en');
      localStorage.setItem('bbOnboardingDone', '1');
    }
    window.__calls = window.__calls || [];
    if (passkey) {
      // Stands in for the browser's passkey sheet (the real one needs a key or a phone).
      const get = (o) => {
        window.__pk = { rpId: o.publicKey.rpId, uv: o.publicKey.userVerification };
        return Promise.resolve({ toJSON: () => ({ id: 'cred-1', rawId: 'cred-1', type: 'public-key', response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' }, clientExtensionResults: {} }) });
      };
      Object.defineProperty(navigator, 'credentials', { value: { get, create: get }, configurable: true });
    }
  }, { passkey: !!S.passkey });
  await page.goto(ORIGIN + '/index.html');
  await page.waitForFunction(() => typeof window.showAuthModal === 'function');
  return { ctx, page, seen };
}

const visible = (page, id) => page.evaluate((id) => { const n = document.getElementById(id); return !!(n && n.offsetParent); }, id);
const text = (page, id) => page.evaluate((id) => (document.getElementById(id) || {}).textContent || '', id);
const calls = (page) => page.evaluate(() => window.__calls);

console.log('index.html at ' + ORIGIN);

{
  const { ctx, page } = await openSheet({ providers: true, passkey: true, uidSignIn: () => ({}) });
  await page.evaluate(() => window.showAuthModal());
  await page.waitForFunction(() => document.getElementById('bbAuthProviders').style.display !== 'none');
  assert.ok(await visible(page, 'bbAuthApple'));
  assert.ok(await visible(page, 'bbAuthGoogle'));
  assert.ok(await visible(page, 'bbAuthPasskey'));
  assert.equal(await text(page, 'bbAuthAppleLabel'), 'Continue with Apple');
  const order = await page.evaluate(() => [...document.querySelectorAll('#bbAuthProviders button')].map((b) => b.id));
  assert.deepEqual(order, ['bbAuthApple', 'bbAuthGoogle', 'bbAuthPasskey'], 'Apple first');
  if (process.env.SHOTS) await page.locator('.bb-auth-box').screenshot({ path: path.join(process.env.SHOTS, 'sheet-light.png') });
  await page.evaluate(() => document.documentElement.classList.add('theme-dark'));
  if (process.env.SHOTS) await page.locator('.bb-auth-box').screenshot({ path: path.join(process.env.SHOTS, 'sheet-dark.png') });
  await page.evaluate(() => document.documentElement.classList.remove('theme-dark'));
  // The code step hides them.
  await page.fill('#bbAuthEmail', 'p@x.com');
  await page.route(SB + '/auth/v1/otp', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' }));
  await page.click('#bbAuthSubmit');
  await page.waitForFunction(() => document.getElementById('bbAuthCode').offsetParent);
  assert.equal(await visible(page, 'bbAuthProviders'), false);
  ok('email step offers Apple, Google and a passkey (Apple first); the code step does not');
  await ctx.close();
}

{
  const { ctx, page } = await openSheet({ providers: false, uidSignIn: () => ({}) });
  await page.evaluate(() => window.showAuthModal());
  await page.waitForTimeout(400);
  assert.equal(await visible(page, 'bbAuthProviders'), false);
  ok('with the providers off in Supabase, no buttons at all');
  await ctx.close();
}

{
  const { ctx, page, seen } = await openSheet({
    providers: true,
    uidSignIn: (d) => (d.create === false ? { status: 'new', email: 'q7@privaterelay.appleid.com', relay: true } : { status: 'ok', customToken: jwt({ uid: 'fb-new' }), created: true }),
  });
  await page.evaluate(() => window.showAuthModal());
  await page.waitForFunction(() => document.getElementById('bbAuthGoogle').offsetParent);
  await Promise.all([page.waitForURL(/uidReturn|index\.html$/), page.click('#bbAuthGoogle')]);
  await page.waitForFunction(() => { const t = document.getElementById('bbAuthTitle'); return t && /New to Bipolar Bear/.test(t.textContent); }, null, { timeout: 15000 });
  const a = seen.authorize[0];
  assert.equal(a.provider, 'google');
  assert.equal(a.redirect_to, ORIGIN + '/index.html?uidReturn=1');
  assert.equal(a.code_challenge_method, 's256');
  assert.equal(seen.tokenBodies[0].auth_code, 'CODE-1');
  assert.ok(seen.tokenBodies[0].code_verifier && !JSON.stringify(a).includes(seen.tokenBodies[0].code_verifier), 'verifier stays in the tab');
  assert.equal(new URL(page.url()).search, '', 'address bar cleaned');
  assert.deepEqual(seen.uidSignIn.map((d) => d.create), [false]);
  assert.match(await text(page, 'bbAuthStepText'), /Apple is hiding your email/);
  assert.equal((await calls(page)).filter((c) => c.startsWith('signInWithCustomToken')).length, 0, 'nothing signed in yet');
  ok('Google round trip: PKCE out, code back, address bar cleaned, uidSignIn asked with create:false → "new"');
  await page.click('#bbAuthSubmit');
  await page.waitForFunction(() => window.__calls.some((c) => c.startsWith('signInWithCustomToken')));
  assert.deepEqual(seen.uidSignIn.map((d) => d.create), [false, undefined]);
  assert.ok((await calls(page)).includes('signInWithCustomToken:fb-new'));
  ok('"Start a new account" makes it only then, and signs in');
  await ctx.close();
}

{
  const { ctx, page, seen } = await openSheet({ providers: true, uidSignIn: () => ({ status: 'new', email: 'other@gmail.com', relay: false }) });
  await page.evaluate(() => window.showAuthModal());
  await page.waitForFunction(() => document.getElementById('bbAuthGoogle').offsetParent);
  await Promise.all([page.waitForURL(/index\.html/), page.click('#bbAuthGoogle')]);
  await page.waitForFunction(() => /New to Bipolar Bear/.test(document.getElementById('bbAuthTitle').textContent), null, { timeout: 15000 });
  assert.match(await text(page, 'bbAuthStepText'), /other@gmail\.com/);
  assert.ok(await page.evaluate(() => !!localStorage.getItem('bbUidSession')));
  await page.click('#bbAuthAltA');
  assert.ok(await visible(page, 'bbAuthEmail'));
  assert.match(await text(page, 'bbAuthStepText'), /Sign in with the email your Bipolar Bear account uses/);
  assert.equal(await page.evaluate(() => localStorage.getItem('bbUidSession')), null, 'provider session dropped');
  assert.equal(seen.uidSignIn.length, 1);
  assert.equal((await calls(page)).filter((c) => c.startsWith('signInWithCustomToken')).length, 0);
  ok('"I already have an account": nothing made, session dropped, back to the email step with the note');
  await ctx.close();
}

{
  const { ctx, page } = await openSheet({ providers: true, uidSignIn: () => ({ status: 'link', email: 'b@x.com' }) });
  await page.evaluate(() => window.showAuthModal());
  await page.waitForFunction(() => document.getElementById('bbAuthApple').offsetParent);
  await Promise.all([page.waitForURL(/index\.html/), page.click('#bbAuthApple')]);
  await page.waitForFunction(() => document.getElementById('bbAuthPassword').offsetParent, null, { timeout: 15000 });
  assert.match(await text(page, 'bbAuthTitle'), /Connect your Bipolar Bear account/);
  assert.match(await text(page, 'bbAuthStepText'), /b@x\.com/);
  assert.equal((await calls(page)).filter((c) => c.startsWith('signInWithCustomToken')).length, 0);
  ok('an address with a Bear password account goes to "Connect": its password, never the email alone');
  await ctx.close();
}

{
  const { ctx, page, seen } = await openSheet({ providers: true, passkey: true, uidSignIn: () => ({ status: 'ok', customToken: jwt({ uid: 'fbA' }), created: false }) });
  await page.evaluate(() => window.showAuthModal());
  await page.waitForFunction(() => document.getElementById('bbAuthPasskey').offsetParent);
  await page.click('#bbAuthPasskey');
  await page.waitForFunction(() => window.__calls.some((c) => c.startsWith('signInWithCustomToken')), null, { timeout: 15000 });
  assert.equal(seen.handoff.return, ORIGIN + '/index.html');
  assert.match(seen.handoff.state, /^[a-f0-9]{64}$/);
  assert.deepEqual(seen.verify, { type: 'magiclink', token_hash: 'TH-1' });
  assert.deepEqual(seen.uidSignIn.map((d) => d.create), [false]);
  assert.ok((await calls(page)).includes('signInWithCustomToken:fbA'));
  assert.equal(new URL(page.url()).hash, '', 'code gone from the address bar');
  assert.equal(await page.evaluate(() => document.getElementById('bbAuthModal').classList.contains('active')), false, 'sheet closed');
  ok('passkey: Hub page with our state, code back in the fragment, redeemed, then the existing account (fbA)');
  await ctx.close();
}

{
  const { ctx, page, seen } = await openSheet({ providers: true, passkey: true, handoffState: 'f'.repeat(64), uidSignIn: () => ({ status: 'ok', customToken: jwt({ uid: 'attacker' }) }) });
  await page.evaluate(() => window.showAuthModal());
  await page.waitForFunction(() => document.getElementById('bbAuthPasskey').offsetParent);
  await page.click('#bbAuthPasskey');
  await page.waitForFunction(() => /didn't finish/.test(document.getElementById('bbAuthError').textContent), null, { timeout: 15000 });
  assert.equal(seen.verify, undefined, 'never redeemed');
  assert.deepEqual(seen.uidSignIn, []);
  assert.equal((await calls(page)).filter((c) => c.startsWith('signInWithCustomToken')).length, 0);
  ok("a code that comes back with someone else's state is never redeemed");
  await ctx.close();
}

await browser.close();
console.log(`\n${passed} checks passed`);
