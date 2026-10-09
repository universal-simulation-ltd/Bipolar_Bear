#!/usr/bin/env node
/**
 * Browser check for "Forgot PIN?" re-authentication (js/shared/pin-reauth.js,
 * James 2026-10-09). Drives the REAL journal.html / index.html in Chromium
 * with Firebase, Supabase and the Cloud Functions faked at the network edge,
 * so nothing touches a real account.
 *
 *   node scripts/test-pin-reauth.mjs
 *
 * Needs Playwright with Chromium. It is not a dependency of this repo (there
 * is no package.json at the root); point PLAYWRIGHT_MODULE at any install,
 * e.g. PLAYWRIGHT_MODULE=file:///D:/Github/.../node_modules/playwright/index.mjs
 *
 * What it proves (web path, plus the native path with the plugin SIMULATED):
 *  1. Account PIN, password account: Forgot PIN shows the re-auth sheet (no
 *     plain confirm()); Cancel and a wrong password leave the PIN on and the
 *     wrong-PIN lockout running; the right password turns the PIN off and
 *     keeps the data.
 *  2. Account PIN, Universal ID account: a fresh emailed code is required; a
 *     custom token for ANOTHER uid is refused; the right one turns it off; and
 *     Firebase is never signed in to anything (no signInWithCustomToken).
 *  3. Guest PIN: still the old two-confirm wipe (dismissing it deletes nothing).
 *  4. Native app PIN on index.html with a fake BiometricAuthNative plugin:
 *     a failed device check keeps the PIN; a passed one clears it (and the
 *     Keychain copy). This checks OUR wiring to the plugin's contract only —
 *     real Face ID / Touch ID / passcode needs a phone.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;

// ── Static server for the repo ─────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ── Fake Firebase compat (served in place of the gstatic SDKs) ─────────────
// Reads window.__T (set per test with addInitScript). userSettings reads never
// resolve, so the journal's PIN overlay stays up the way it does while a slow
// connection is still loading the account.
const FIREBASE_STUB = `
(function(){
  var T = window.__T || {};
  window.__calls = window.__calls || [];
  function rec(n){ window.__calls.push(n); }
  var user = T.user ? {
    uid: T.user.uid, email: T.user.email, isAnonymous: false, emailVerified: true,
    providerData: T.user.password ? [{ providerId: 'password' }] : [],
    getIdToken: function(){ return Promise.resolve('fake-id-token'); },
    reload: function(){ return Promise.resolve(); },
    reauthenticateWithCredential: function(c){
      rec('reauth:' + c.password);
      if (c.password === T.user.password) return Promise.resolve({ user: user });
      var e = new Error('wrong'); e.code = 'auth/wrong-password'; return Promise.reject(e);
    },
  } : null;
  function chain(){
    var p = new Proxy(function(){}, {
      get: function(_t, k){
        if (k === 'then') return undefined;
        if (k === 'get') return function(){ return new Promise(function(){}); };
        if (['set','update','delete','add','enablePersistence','clearPersistence'].indexOf(k) >= 0) return function(){ return Promise.resolve(); };
        if (k === 'onSnapshot') return function(){ return function(){}; };
        return function(){ return p; };
      },
      apply: function(){ return p; },
    });
    return p;
  }
  var authObj = {
    currentUser: null,
    setPersistence: function(){ return Promise.resolve(); },
    onAuthStateChanged: function(cb){ setTimeout(function(){ authObj.currentUser = user; cb(user); }, 50); return function(){}; },
    onIdTokenChanged: function(cb){ return function(){}; },
    signInWithCustomToken: function(){ rec('signInWithCustomToken'); return Promise.reject(new Error('not in tests')); },
    signInWithEmailAndPassword: function(){ rec('signInWithEmailAndPassword'); return Promise.reject(new Error('not in tests')); },
    signOut: function(){ rec('signOut'); return Promise.resolve(); },
    sendPasswordResetEmail: function(){ return Promise.resolve(); },
  };
  var auth = function(){ return authObj; };
  auth.Auth = { Persistence: { SESSION: 'session', LOCAL: 'local' } };
  auth.EmailAuthProvider = { credential: function(email, password){ return { email: email, password: password }; } };
  var fs = function(){ return chain(); };
  fs.FieldValue = { delete: function(){ return '__del'; }, serverTimestamp: function(){ return '__ts'; }, increment: function(n){ return n; }, arrayUnion: function(){ return []; }, arrayRemove: function(){ return []; } };
  fs.Timestamp = { now: function(){ return { toMillis: function(){ return Date.now(); } }; }, fromMillis: function(m){ return { toMillis: function(){ return m; } }; } };
  var apps = [];
  window.firebase = {
    apps: apps,
    initializeApp: function(){ apps.push({}); return {}; },
    app: function(){ return { functions: function(){ return { httpsCallable: function(){ return function(){ return new Promise(function(){}); }; } }; } }; },
    auth: auth,
    firestore: fs,
    functions: function(){ return { httpsCallable: function(){ return function(){ return new Promise(function(){}); }; } }; },
    messaging: function(){ return chain(); },
  };
})();`;

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); }
function jwt(payload) { return b64url({ alg: 'none' }) + '.' + b64url(payload) + '.sig'; }

const browser = await chromium.launch();
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }

async function openPage(file, T, { native = null, local = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  page.on('pageerror', () => {}); // the fake Firestore makes the page grumble; not under test
  await page.route('**/*', async route => {
    const u = route.request().url();
    if (process.env.DEBUG && /supabase|cloudfunctions/.test(u)) console.log('    [route] ' + route.request().method() + ' ' + u);
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (!u.startsWith(BASE) && route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const fulfill = o => route.fulfill({ ...o, headers: { ...CORS, ...(o.headers || {}) } });
    if (u.startsWith(BASE)) {
      if (/service-worker\.js|firebase-messaging-sw\.js/.test(u)) return route.abort();
      return route.continue();
    }
    if (u.includes('gstatic.com/firebasejs/') && u.includes('firebase-app-compat')) {
      return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    }
    if (u.includes('gstatic.com/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (u.includes('supabase.co/auth/v1/')) {
      const p = new URL(u).pathname.replace('/auth/v1/', '');
      await page.evaluate(n => window.__calls.push('supabase:' + n), p).catch(() => {});
      if (p === 'otp') return fulfill({ contentType: 'application/json', body: '{}' });
      if (p === 'verify') {
        const body = JSON.parse(route.request().postData() || '{}');
        if (body.token !== '123456') return fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'otp_expired', msg: 'Token has expired or is invalid' }) });
        const now = Math.floor(Date.now() / 1000);
        return fulfill({ contentType: 'application/json', body: JSON.stringify({ access_token: jwt({ aal: 'aal1', exp: now + 3600 }), refresh_token: 'r', expires_in: 3600, expires_at: now + 3600, user: { id: 'sb-1' } }) });
      }
      if (p === 'user') return fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'sb-1', factors: [] }) });
      return fulfill({ contentType: 'application/json', body: '{}' });
    }
    if (u.includes('cloudfunctions.net/uidSignIn')) {
      await page.evaluate(() => window.__calls.push('uidSignIn')).catch(() => {});
      return fulfill({ contentType: 'application/json', body: JSON.stringify({ result: { status: 'ok', customToken: jwt({ uid: T.tokenUid }), created: false } }) });
    }
    if (process.env.DEBUG) console.log('    (aborted ' + route.request().method() + ' ' + u + ')');
    return route.abort();
  });
  await page.addInitScript(({ T, native, local }) => {
    window.__T = T;
    window.__calls = [];
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      localStorage.setItem('bbLanguage', 'en');
      for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
    }
    if (native) {
      const store = { bb_native_pin: native.pin };
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: {
          SecureStorage: {
            getItem: k => Promise.resolve(store[k] ?? null),
            setItem: (k, v) => { store[k] = v; return Promise.resolve(); },
            removeItem: k => { window.__calls.push('keychain-remove:' + k); delete store[k]; return Promise.resolve(); },
          },
          BiometricAuthNative: {
            checkBiometry: () => Promise.resolve({ isAvailable: true, deviceIsSecure: true }),
            internalAuthenticate: o => {
              window.__calls.push('bio:' + JSON.stringify(o));
              return window.__bioPass ? Promise.resolve() : Promise.reject({ code: 'userCancel' });
            },
          },
        },
      };
    }
  }, { T, native, local });
  await page.goto(BASE + '/' + file);
  return { ctx, page, dialogs };
}

const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
const lockUntil = String(Date.now() + 10 * 60 * 1000);
const accountPin = { bbPinEnabled: '1', bbPinCode: '1234', bbPinFails: '5', bbPinLockUntil: lockUntil, 'entry:1700000000000': '{"keep":"me"}' };

// ── 1. Password account ────────────────────────────────────────────────────
console.log('journal.html — account PIN, password account');
{
  const T = { user: { uid: 'U1', email: 'me@example.com', password: 'right-pass' } };
  const { ctx, page, dialogs } = await openPage('journal.html', T, { local: accountPin });
  await page.waitForSelector('#pinOverlay', { state: 'visible' });
  await page.waitForFunction(() => window.firebase && firebase.auth().currentUser);
  await page.click('#pinOverlay button:has-text("1")');
  assert.match(await page.textContent('#pinError'), /Too many tries/);
  ok('the keypad is locked out before we start');

  await page.click('#pinOverlay button:has-text("Forgot PIN?")');
  await page.waitForSelector('#bbPinReauth');
  assert.equal(dialogs.length, 0, 'no plain confirm() any more');
  assert.equal(await page.locator('#bbPinReauth [data-act="device"]').count(), 0, 'no device button on the web');
  assert.equal(await page.locator('#bbPinReauthPw').count(), 1);
  ok('Forgot PIN opens the re-auth sheet (password field, no confirm())');

  await page.click('#bbPinReauth [data-act="cancel"]');
  await page.waitForSelector('#bbPinReauth', { state: 'detached' });
  assert.equal(await ls(page, 'bbPinEnabled'), '1');
  assert.equal(await ls(page, 'bbPinLockUntil'), lockUntil);
  assert.ok(await page.isVisible('#pinOverlay'));
  ok('Cancel: PIN still on, lockout untouched');

  await page.click('#pinOverlay button:has-text("Forgot PIN?")');
  await page.fill('#bbPinReauthPw', 'wrong-pass');
  await page.click('#bbPinReauth form[data-form="password"] button');
  await page.waitForFunction(() => /isn't right/.test(document.querySelector('[data-err="password"]').textContent));
  assert.equal(await ls(page, 'bbPinEnabled'), '1');
  assert.equal(await ls(page, 'bbPinLockUntil'), lockUntil);
  ok('wrong password: refused, PIN still on, lockout untouched');

  await page.fill('#bbPinReauthPw', 'right-pass');
  await page.click('#bbPinReauth form[data-form="password"] button');
  await page.waitForSelector('#bbPinReauth', { state: 'detached' });
  await page.waitForSelector('#pinOverlay', { state: 'hidden' });
  assert.equal(await ls(page, 'bbPinEnabled'), null);
  assert.equal(await ls(page, 'bbPinCode'), null);
  assert.equal(await ls(page, 'bbPinFails'), null);
  assert.equal(await ls(page, 'entry:1700000000000'), '{"keep":"me"}');
  assert.equal(dialogs.length, 0);
  ok('right password: PIN off, overlay gone, data kept');
  await ctx.close();
}

// ── 2. Universal ID account ────────────────────────────────────────────────
console.log('journal.html — account PIN, Universal ID account');
for (const variant of ['other-account', 'same-account']) {
  const T = { user: { uid: 'U2', email: 'uid@example.com', password: null }, tokenUid: variant === 'same-account' ? 'U2' : 'SOMEONE-ELSE' };
  const { ctx, page } = await openPage('journal.html', T, { local: accountPin });
  await page.waitForSelector('#pinOverlay', { state: 'visible' });
  await page.waitForFunction(() => window.firebase && firebase.auth().currentUser);
  await page.click('#pinOverlay button:has-text("Forgot PIN?")');
  await page.waitForSelector('#bbPinReauth');
  assert.equal(await page.locator('#bbPinReauthPw').count(), 0, 'no password field for a Universal ID-only account');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'reauth-uid.png') });
  assert.match(await page.textContent('#bbPinReauth'), /uid@example\.com/);
  await page.click('#bbPinReauth [data-act="send"]');
  await page.waitForSelector('#bbPinReauthCode', { state: 'visible' });
  await page.fill('#bbPinReauthCode', '000000');
  await page.click('#bbPinReauth form[data-form="verify"] button');
  await page.waitForFunction(() => /isn't right|expired/.test(document.querySelector('[data-err="code"]').textContent));
  assert.equal(await ls(page, 'bbPinEnabled'), '1');
  await page.fill('#bbPinReauthCode', '123456');
  await page.click('#bbPinReauth form[data-form="verify"] button');
  if (variant === 'other-account') {
    await page.waitForFunction(() => /didn't work/.test(document.querySelector('[data-err="code"]').textContent));
    assert.equal(await ls(page, 'bbPinEnabled'), '1');
    assert.equal(await ls(page, 'bbPinLockUntil'), lockUntil);
    ok('a code that maps to ANOTHER account is refused; PIN and lockout kept');
  } else {
    await page.waitForSelector('#bbPinReauth', { state: 'detached' });
    assert.equal(await ls(page, 'bbPinEnabled'), null);
    assert.equal(await ls(page, 'entry:1700000000000'), '{"keep":"me"}');
    ok('wrong code refused, then the fresh code for this account turns the PIN off');
  }
  const calls = await page.evaluate(() => window.__calls);
  if (process.env.DEBUG) console.log(calls);
  assert.ok(calls.includes('supabase:otp'), 'a fresh code was emailed');
  assert.ok(calls.includes('uidSignIn'));
  assert.ok(!calls.includes('signInWithCustomToken'), 'nothing was signed in');
  ok('(' + variant + ') emailed a fresh code, never signed Firebase in');
  await ctx.close();
}

// ── 3. Guest PIN unchanged ─────────────────────────────────────────────────
console.log('index.html — guest PIN (unchanged)');
{
  // journal.html sends a locked guest to index.html, so the guest lock screen
  // (and its Forgot PIN) is index's #guestPinOverlay.
  const T = { user: null };
  const { ctx, page, dialogs } = await openPage('index.html', T, { local: { bbPinEnabled: '1', bbPinCode: '1234', bbGuestPinSalt: 'c2FsdHNhbHRzYWx0c2FsdA==', bbFabsUnlocked: '1', bbWelcomeShown: '1', bbOnboardingStep: '12', 'entry:1700000000000': 'x' } });
  await page.waitForSelector('#guestPinOverlay', { state: 'visible' });
  await page.click('#guestPinOverlay button:has-text("Forgot PIN?")');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#bbPinReauth').count(), 0, 'no re-auth sheet for the guest PIN');
  assert.ok(dialogs.length === 1 && /recovered|delete/i.test(dialogs[0]), 'the wipe confirm still asks: ' + dialogs[0]);
  assert.equal(await ls(page, 'entry:1700000000000'), 'x');
  assert.equal(await ls(page, 'bbGuestPinSalt'), 'c2FsdHNhbHRzYWx0c2FsdA==');
  ok('guest Forgot PIN still goes to the wipe confirm; dismissing it deletes nothing');
  await ctx.close();
}

// ── 4. Native app PIN (plugin simulated) ───────────────────────────────────
console.log('index.html — native app PIN, BiometricAuthNative simulated');
{
  const T = { user: { uid: 'U1', email: 'me@example.com', password: 'right-pass' } };
  const { ctx, page, dialogs } = await openPage('index.html', T, { native: { pin: '4321' }, local: { bbNativePinEnabled: '1', bbFabsUnlocked: '1', bbWelcomeShown: '1', bbOnboardingStep: '12', bbPinFails: '5', bbPinLockUntil: lockUntil } });
  await page.waitForSelector('#guestPinOverlay', { state: 'visible' });
  await page.waitForFunction(() => window.firebase && firebase.auth().currentUser);
  await page.click('#guestPinOverlay button:has-text("Forgot PIN?")');
  await page.waitForSelector('#bbPinReauth [data-act="device"]');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'reauth-native.png') });
  assert.equal(await page.locator('#bbPinReauthPw').count(), 1, 'account route offered too');
  assert.equal(dialogs.length, 0);
  await page.click('#bbPinReauth [data-act="device"]');
  await page.waitForFunction(() => /Couldn't confirm/.test(document.querySelector('[data-err="device"]').textContent));
  assert.equal(await ls(page, 'bbNativePinEnabled'), '1');
  assert.equal(await ls(page, 'bbPinLockUntil'), lockUntil);
  ok('device check failed/cancelled: PIN and lockout kept');
  const bioCall = (await page.evaluate(() => window.__calls)).find(c => c.startsWith('bio:'));
  assert.ok(bioCall && JSON.parse(bioCall.slice(4)).allowDeviceCredential === true, 'passcode fallback allowed');
  ok('asks the plugin with allowDeviceCredential (Face ID / Touch ID OR passcode)');
  await page.evaluate(() => { window.__bioPass = true; });
  await page.click('#bbPinReauth [data-act="device"]');
  await page.waitForSelector('#bbPinReauth', { state: 'detached' });
  await page.waitForSelector('#guestPinOverlay', { state: 'hidden' });
  assert.equal(await ls(page, 'bbNativePinEnabled'), null);
  assert.equal(await ls(page, 'bbPinFails'), null);
  assert.ok((await page.evaluate(() => window.__calls)).includes('keychain-remove:bb_native_pin'));
  ok('device check passed: app PIN off, Keychain copy removed');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} checks passed`);
