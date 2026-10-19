#!/usr/bin/env node
/**
 * Browser check for the 1.44 native items' web halves, in Chromium, with the
 * native plugins SIMULATED (window.Capacitor) and Firebase stubbed:
 *
 *  1. Reminder mood buttons (js/shared/mood-queue.js + journal.js):
 *     a. a guest without a PIN: home sees a queued tap, opens the journal,
 *        which files it in the guest's storage and empties the queue;
 *     b. a guest with a PIN: the entry is stored ENCRYPTED (no mood in the
 *        clear) under the PIN key;
 *     c. a day already logged is not overwritten: the tap is dropped, with a note;
 *     d. a guest who hasn't chosen PIN / no PIN yet: nothing is written, the tap waits;
 *     e. the reminder is scheduled with the five mood buttons.
 *  2. Unlock with Face ID (js/shared/bio-unlock.js):
 *     a. off by default: no button, no scan on the lock screen;
 *     b. the app lock (signed-in native PIN) with it on: the scan is offered
 *        with biometrics only (no passcode), a cancel leaves the keypad, a
 *        pass unlocks;
 *     c. a guest PIN: Settings keeps the PIN key with its salt; the lock
 *        screen's scan puts it back in the session and the journal opens;
 *        after the PIN changes, the kept key is never used.
 *  3. Bipolar Anonymous Android back (js/anonymous.js): a sheet closes first,
 *     then the previous tab, then the app leaves (exitApp in the Anonymous
 *     bundle, home in Bear's).
 *
 * Real notifications, Face ID and the hardware back button need a phone or
 * a simulator; this checks our wiring to each plugin's contract.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-native-144.mjs
 *   (3. needs `node scripts/build-anonymous.js` first, for www-anonymous/.)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
function serve(dir) {
  const server = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
const main = await serve(ROOT);

// Firebase: signed out (a guest) unless __T.user; Firestore reads never answer.
const FIREBASE_STUB = `
(function(){
  var T = window.__T || {};
  var user = T.user ? { uid: T.user.uid, email: T.user.email, isAnonymous: false, emailVerified: true, providerData: [{ providerId: 'password' }], getIdToken: function(){ return Promise.resolve('t'); }, reload: function(){ return Promise.resolve(); } } : null;
  function chain(){
    var p = new Proxy(function(){}, { get: function(_t, k){
      if (k === 'then') return undefined;
      if (k === 'get') return function(){ return new Promise(function(){}); };
      if (['set','update','delete','add','enablePersistence','clearPersistence'].indexOf(k) >= 0) return function(){ return Promise.resolve(); };
      if (k === 'onSnapshot') return function(){ return function(){}; };
      return function(){ return p; };
    }, apply: function(){ return p; } });
    return p;
  }
  var authObj = { currentUser: null, setPersistence: function(){ return Promise.resolve(); },
    onAuthStateChanged: function(cb){ setTimeout(function(){ authObj.currentUser = user; cb(user); }, 50); return function(){}; },
    onIdTokenChanged: function(){ return function(){}; }, signOut: function(){ return Promise.resolve(); } };
  var auth = function(){ return authObj; };
  auth.Auth = { Persistence: { SESSION: 'session', LOCAL: 'local' } };
  auth.EmailAuthProvider = { credential: function(e, p){ return { email: e, password: p }; } };
  var fsx = function(){ return chain(); };
  fsx.FieldValue = { delete: function(){ return '__del'; }, serverTimestamp: function(){ return '__ts'; }, increment: function(n){ return n; }, arrayUnion: function(){ return []; }, arrayRemove: function(){ return []; } };
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
const ok = name => { passed++; console.log('  ✓ ' + name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * A page with the native shell faked. The fake plugins keep their state in
 * localStorage keys starting "__" so it survives navigations:
 *   __queue (the reminder queue), __ss (the Keychain), __calls (a log).
 */
async function open(base, file, { local = {}, session = {}, T = {}, platform = 'ios', bio = 'pass', native = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss());
  page.on('pageerror', e => { if (process.env.DEBUG) console.log('    [pageerror]', e.message); });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: u.includes('firebase-app-compat') ? FIREBASE_STUB : '' });
    if (u.startsWith(base)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
    return route.abort();
  });
  await page.addInitScript(({ local, session, T, platform, bio, native }) => {
    window.__T = T;
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      localStorage.setItem('bbLanguage', 'en');
      for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, v);
    }
    const J = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
    const S = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    const log = c => S('__calls', J('__calls', []).concat([c]));
    window.__listeners = {};
    if (!native) return;
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => platform,
      Plugins: {
        SecureStorage: {
          internalGetItem: ({ prefixedKey }) => Promise.resolve({ data: J('__ss', {})[prefixedKey] ?? null }),
          internalSetItem: ({ prefixedKey, data }) => { const s = J('__ss', {}); s[prefixedKey] = data; S('__ss', s); log('ss-set:' + prefixedKey); return Promise.resolve(); },
          internalRemoveItem: ({ prefixedKey }) => { const s = J('__ss', {}); delete s[prefixedKey]; S('__ss', s); log('ss-remove:' + prefixedKey); return Promise.resolve(); },
        },
        BiometricAuthNative: {
          checkBiometry: () => Promise.resolve({ isAvailable: true, biometryType: platform === 'ios' ? 2 : 3, deviceIsSecure: true }),
          internalAuthenticate: o => { log('bio:' + JSON.stringify({ allowDeviceCredential: o.allowDeviceCredential })); return (localStorage.getItem('__bio') || bio) === 'pass' ? Promise.resolve() : Promise.reject({ code: 'userCancel' }); },
        },
        BipolarBearMoodQueue: {
          pending: () => Promise.resolve({ taps: J('__queue', []) }),
          remove: ({ ids }) => { S('__queue', J('__queue', []).filter(t => !ids.includes(t.id))); log('queue-remove:' + ids.join(',')); return Promise.resolve({ left: J('__queue', []).length }); },
        },
        LocalNotifications: {
          checkPermissions: () => Promise.resolve({ display: 'granted' }),
          requestPermissions: () => Promise.resolve({ display: 'granted' }),
          addListener: () => Promise.resolve({ remove() {} }),
          registerActionTypes: o => { S('__actionTypes', o); return Promise.resolve(); },
          getPending: () => Promise.resolve({ notifications: [] }),
          cancel: () => Promise.resolve(),
          schedule: o => { S('__scheduled', J('__scheduled', []).concat(o.notifications)); return Promise.resolve({ notifications: [] }); },
        },
        App: {
          addListener: (name, cb) => { (window.__listeners[name] = window.__listeners[name] || []).push(cb); return Promise.resolve({ remove() {} }); },
          exitApp: () => { log('exitApp'); return Promise.resolve(); },
        },
      },
    };
  }, { local, session, T, platform, bio, native });
  await page.goto(base + '/' + file);
  return { ctx, page };
}
const L = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
const LJ = async (page, k) => JSON.parse((await L(page, k)) || 'null');
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
const tap = (id, mood, n) => ({ id, mood, at: daysAgo(n - 1).getTime(), day: dayKey(daysAgo(n)) });
const entryKeys = page => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('entry:')));
// The guest journal's "already set up" flags, so no tutorial gets in the way.
const ONBOARDED = { bbOnboardingStep: '10', bbHasEntries: '1', bbSettingsHintDone: '1', bbCustomiseFormHintDone: '1', bbCloseSettingsHintDone: '1', bbCustomiseAdditionalHintDone: '1', bbWelcomeDone: '1', bbWelcomeSeen: '1' };
const OLD = { date: daysAgo(10).toISOString(), mood: 'stable', timestamp: daysAgo(10).getTime(), notes: '' };

// ── 1. Reminder mood buttons ───────────────────────────────────────────────
console.log('Reminder mood buttons');
{
  // a. guest without a PIN: home → journal → filed.
  const q = [tap('t1', 'low', 3)];
  const { ctx, page } = await open(main.base, 'index.html', {
    local: { ...ONBOARDED, bbGuestNoPin: '1', ['entry:' + OLD.timestamp]: JSON.stringify(OLD), __queue: JSON.stringify(q) },
  });
  await page.waitForURL(/journal\.html/, { timeout: 8000 });
  ok('home opens the journal while a reminder tap waits');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('__queue') || '[]').length === 0, null, { timeout: 10000 });
  const keys = await entryKeys(page);
  const newKey = 'entry:' + daysAgo(3).getTime();
  assert.ok(keys.includes(newKey), 'entry written for the tap\'s day: ' + keys.join());
  const e = JSON.parse(await L(page, newKey));
  assert.equal(e.mood, 'low');
  assert.equal(e.loggedVia, 'reminder');
  assert.ok(!e.autoFilled);
  ok('a guest without a PIN: the tap becomes an entry in their storage, and leaves the queue');
  await page.waitForSelector('.bb-mq-toast', { timeout: 4000 });
  assert.match(await page.textContent('.bb-mq-toast'), /Saved from your reminder: Low/);
  ok('a note says what was saved');
  // e. the reminder carries the buttons.
  await page.evaluate(() => { localStorage.setItem('reminderEnabled', 'true'); });
  await page.reload();
  // Capacitor's bridge fires deviceready on a phone; journal.js schedules then.
  await page.waitForFunction(() => typeof scheduleReminder === 'function' || document.readyState === 'complete');
  await sleep(500);
  await page.evaluate(() => document.dispatchEvent(new Event('deviceready')));
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('__scheduled') || '[]')).some(n => n.id === 1), null, { timeout: 8000 });
  const daily = (await LJ(page, '__scheduled')).find(n => n.id === 1);
  const types = await LJ(page, '__actionTypes');
  assert.equal(daily.actionTypeId, 'bb.mood');
  assert.deepEqual(types.types[0].actions.map(a => a.id), ['bg.mood.manic', 'bg.mood.elevated', 'bg.mood.stable', 'bg.mood.low', 'bg.mood.depressed']);
  assert.equal(types.types[0].actions[3].title, '😔 Low');
  ok('the daily reminder is scheduled with the five mood buttons (bb.mood / bg.mood.*)');
  await ctx.close();
}
{
  // b. guest with a PIN: encrypted under the PIN key.
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const keyB64 = Buffer.from(raw).toString('base64');
  const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const q = [tap('p1', 'manic', 2)];
  const { ctx, page } = await open(main.base, 'journal.html', {
    local: { ...ONBOARDED, bbGuestPinSalt: salt, bbPinEnabled: '1', bbPinCode: 'pbkdf2$1$x$y', __queue: JSON.stringify(q) },
    session: { bb_guest_key: keyB64, bbPinUnlocked: '1' },
  });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('__queue') || '[]').length === 0, null, { timeout: 10000 });
  const k = 'entry:' + daysAgo(2).getTime();
  const stored = await L(page, k);
  assert.ok(stored, 'stored');
  assert.ok(!stored.includes('manic') && !stored.includes('reminder'), 'no mood in the clear');
  const blob = JSON.parse(stored);
  assert.ok(blob._enc && blob._iv);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const b = s => Uint8Array.from(Buffer.from(s, 'base64'));
  const plain = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(blob._iv) }, key, b(blob._enc))));
  assert.equal(plain.mood, 'manic');
  ok('a guest with a PIN: the entry is stored encrypted under the PIN key');
  await ctx.close();
}
{
  // c. a day already logged is never overwritten.
  const day = daysAgo(1);
  const mine = { date: day.toISOString(), mood: 'stable', timestamp: day.getTime(), notes: 'my own words' };
  const q = [tap('d1', 'depressed', 1)];
  const { ctx, page } = await open(main.base, 'journal.html', {
    local: { ...ONBOARDED, bbGuestNoPin: '1', ['entry:' + mine.timestamp]: JSON.stringify(mine), __queue: JSON.stringify(q) },
  });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('__queue') || '[]').length === 0, null, { timeout: 10000 });
  assert.deepEqual(JSON.parse(await L(page, 'entry:' + mine.timestamp)), mine);
  assert.equal((await entryKeys(page)).length, 1);
  await page.waitForSelector('.bb-mq-toast', { timeout: 4000 });
  assert.match(await page.textContent('.bb-mq-toast'), /already in your journal/);
  ok('a day already logged keeps its entry; the tap is dropped with a note');
  await ctx.close();
}
{
  // d. a guest who hasn't chosen PIN / no PIN: nothing written, the tap waits.
  const q = [tap('w1', 'stable', 2)];
  const { ctx, page } = await open(main.base, 'journal.html', { local: { ...ONBOARDED, ['entry:' + OLD.timestamp]: JSON.stringify(OLD), __queue: JSON.stringify(q) } });
  await sleep(3500);
  assert.equal((await LJ(page, '__queue')).length, 1);
  assert.equal((await entryKeys(page)).length, 1);
  ok('a guest whose storage isn\'t set up yet: nothing is written, the tap waits');
  await ctx.close();
}
{
  // On the web (no native shell) nothing changes.
  const { ctx, page } = await open(main.base, 'journal.html', { native: false, local: { ...ONBOARDED, bbGuestNoPin: '1', ['entry:' + OLD.timestamp]: JSON.stringify(OLD) } });
  await sleep(1500);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('bioUnlockRow')).display), 'none');
  ok('web: no queue work and no biometric row');
  await ctx.close();
}

// ── 2. Unlock with Face ID ─────────────────────────────────────────────────
console.log('Unlock with Face ID / fingerprint');
{
  // a. off by default.
  const { ctx, page } = await open(main.base, 'index.html', {
    local: { ...ONBOARDED, bbNativePinEnabled: '1', __ss: JSON.stringify({ 'capacitor-storage_bb_native_pin': '2468' }) },
  });
  await page.waitForFunction(() => document.getElementById('guestPinOverlay').style.display === 'flex', null, { timeout: 5000 });
  await sleep(800);
  assert.equal(await page.evaluate(() => document.getElementById('idxBioBtn').hidden), true);
  assert.ok(!((await LJ(page, '__calls')) || []).some(c => c.startsWith('bio:')));
  ok('off by default: no button and no scan on the lock screen');
  await ctx.close();
}
{
  // b. the app lock, with it on: cancel keeps the keypad, a pass unlocks.
  const { ctx, page } = await open(main.base, 'index.html', {
    bio: 'cancel',
    local: { ...ONBOARDED, bbNativePinEnabled: '1', bbBioUnlock: '1', __ss: JSON.stringify({ 'capacitor-storage_bb_native_pin': '2468' }) },
  });
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('__calls') || '[]')).some(c => c.startsWith('bio:')), null, { timeout: 5000 });
  const calls = await LJ(page, '__calls');
  assert.ok(calls.includes('bio:{"allowDeviceCredential":false}'), 'biometrics only: ' + calls.join());
  await sleep(300);
  assert.equal(await page.evaluate(() => document.getElementById('guestPinOverlay').style.display), 'flex');
  assert.equal(await page.evaluate(() => document.getElementById('idxBioBtn').hidden), false);
  assert.equal(await page.getAttribute('#idxBioBtn', 'aria-label'), 'Unlock with Face ID');
  ok('the scan is offered (biometrics only); cancelling it leaves the PIN keypad');
  await page.evaluate(() => localStorage.setItem('__bio', 'pass'));
  await page.click('#idxBioBtn');
  await page.waitForFunction(() => document.getElementById('guestPinOverlay').style.display === 'none', null, { timeout: 4000 });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('bbPinUnlocked')), '1');
  ok('a good scan unlocks the app lock');
  await ctx.close();
}
{
  // c. guest PIN: Settings keeps the key; the lock screen uses it; a changed PIN never does.
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const keyB64 = Buffer.from(raw).toString('base64');
  const salt = 'c2FsdHNhbHRzYWx0c2FsdA==';
  const { ctx, page } = await open(main.base, 'journal.html', {
    platform: 'android',
    local: { ...ONBOARDED, bbGuestPinSalt: salt, bbPinEnabled: '1', bbPinCode: 'pbkdf2$1$x$y' },
    session: { bb_guest_key: keyB64, bbPinUnlocked: '1' },
  });
  await page.waitForFunction(() => typeof showSettingsModal === 'function', null, { timeout: 8000 });
  await sleep(1200);
  await page.evaluate(() => showSettingsModal());
  await page.waitForFunction(() => document.getElementById('bioUnlockRow').style.display === '', null, { timeout: 4000 });
  assert.equal(await page.textContent('#bioUnlockLabel'), 'Unlock with your fingerprint');
  assert.equal(await page.isChecked('#bioUnlockToggle'), false, 'unticked by default');
  ok('Settings shows "Unlock with your fingerprint", unticked, for a guest PIN on Android');
  await page.click('#bioUnlockToggle + .bb-slider');
  await page.waitForFunction(() => localStorage.getItem('bbBioUnlock') === '1', null, { timeout: 4000 });
  const ss = await LJ(page, '__ss');
  assert.deepEqual(JSON.parse(ss['capacitor-storage_bb_guest_bio_key']), { salt, key: keyB64 });
  ok('turning it on scans once, then keeps the PIN key with its salt in the Keystore');
  // The lock screen: a pass puts the key back in the session.
  await page.evaluate(() => { sessionStorage.removeItem('bb_guest_key'); sessionStorage.removeItem('bbPinUnlocked'); });
  await page.goto(main.base + '/index.html');
  await page.waitForFunction(() => sessionStorage.getItem('bbPinUnlocked') === '1', null, { timeout: 6000 });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('bb_guest_key')), keyB64);
  ok('the lock screen\'s scan unlocks a guest PIN with the kept key');
  // PIN changed (new salt): the kept key is never used, and is deleted.
  await page.evaluate(() => { sessionStorage.removeItem('bb_guest_key'); sessionStorage.removeItem('bbPinUnlocked'); localStorage.setItem('bbGuestPinSalt', 'bmV3c2FsdG5ld3NhbHQ='); });
  await page.reload();
  await page.waitForFunction(() => /PIN has changed/.test(document.getElementById('idxPinError').textContent), null, { timeout: 6000 });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('bb_guest_key')), null);
  assert.equal(await page.evaluate(() => document.getElementById('guestPinOverlay').style.display), 'flex');
  assert.equal(await L(page, 'bbBioUnlock'), null);
  assert.equal((await LJ(page, '__ss'))['capacitor-storage_bb_guest_bio_key'], undefined);
  ok('after the PIN changes the kept key is not used: the PIN is asked for, the key deleted, the switch off');
  await ctx.close();
}

// ── 3. Bipolar Anonymous: Android back ─────────────────────────────────────
console.log('Bipolar Anonymous: Android back');
async function backFlow(base, file, expectLeave) {
  const { ctx, page } = await open(base, file, { platform: 'android', local: { bbAnonAgreed: '1' } });
  await page.waitForFunction(() => window.__listeners.backButton && window.__listeners.backButton.length, null, { timeout: 6000 });
  const back = () => page.evaluate(() => window.__listeners.backButton.forEach(f => f({ canGoBack: false })));
  await sleep(3000); // let boot() pick its screen first (the 2.5 s fallback), then show the board
  await page.evaluate(() => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-board').classList.add('active');
    try { setTab('general'); setTab('wiki'); setTab('announcements'); } catch (e) { window.__err = String(e && e.stack || e); }
    openOv('ov-help');
  });
  await sleep(200);
  await back();
  await sleep(150);
  assert.equal(await page.evaluate(() => document.getElementById('ov-help').classList.contains('hidden')), true);
  assert.equal(await page.evaluate(() => currentTab), 'announcements');
  await back();
  assert.equal(await page.evaluate(() => currentTab), 'wiki');
  await back();
  assert.equal(await page.evaluate(() => currentTab), 'general');
  await back();
  await sleep(300);
  if (expectLeave === 'exit') assert.ok((await LJ(page, '__calls') || []).includes('exitApp'));
  else assert.match(page.url(), /index\.html/);
  await ctx.close();
}
await backFlow(main.base, 'anonymous.html', 'home');
ok('Bear app: a sheet closes first, then the previous tabs, then back to Bipolar Bear\'s home');
const anonDir = path.join(ROOT, 'www-anonymous');
if (fs.existsSync(path.join(anonDir, 'index.html'))) {
  const anon = await serve(anonDir);
  await backFlow(anon.base, 'index.html', 'exit');
  ok('Bipolar Anonymous app: the same, then the app closes (exitApp)');
  anon.server.close();
} else {
  console.log('  (skipped the Anonymous bundle: run node scripts/build-anonymous.js first)');
}

await browser.close();
main.server.close();
console.log(`\n${passed} passed`);
