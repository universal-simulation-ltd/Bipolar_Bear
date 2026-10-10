#!/usr/bin/env node
/**
 * Browser check for the journal's 1M / 3M / 6M / 1Y / All range tabs
 * (js/journal.js tapJournalRange, James 2026-10-10): one tap switches, a
 * double tap (two taps on the same button within 350 ms) makes that range the
 * default and draws it orange, the old "tap the range already showing" gesture
 * and its ★ are gone, the life chart's zoom never sets a default, and a
 * default saved before (localStorage bbJournalRange) is kept.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-range-default.mjs
 *
 * Drives the REAL journal.html with the Firebase SDKs faked at the network
 * edge (signed out — the tabs work the same for a guest), so it exercises the
 * real journal.js + css/journal.css. The tabs live inside the Your Journey
 * card, which needs entries to open, so the test lifts #journeyRanges to the
 * top of the page and renders it the way the card does.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Signed-out Firebase: auth resolves to null, Firestore reads never resolve.
const FIREBASE_STUB = `
(function(){
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
    onAuthStateChanged: function(cb){ setTimeout(function(){ cb(null); }, 50); return function(){}; },
    onIdTokenChanged: function(){ return function(){}; },
    signOut: function(){ return Promise.resolve(); },
  };
  var auth = function(){ return authObj; };
  auth.Auth = { Persistence: { SESSION: 'session', LOCAL: 'local' } };
  auth.EmailAuthProvider = { credential: function(){ return {}; } };
  var fs = function(){ return chain(); };
  fs.FieldValue = { delete: function(){}, serverTimestamp: function(){}, increment: function(n){ return n; }, arrayUnion: function(){ return []; }, arrayRemove: function(){ return []; } };
  fs.Timestamp = { now: function(){ return { toMillis: function(){ return Date.now(); } }; }, fromMillis: function(m){ return { toMillis: function(){ return m; } }; } };
  var apps = [];
  var fns = function(){ return { httpsCallable: function(){ return function(){ return new Promise(function(){}); }; } }; };
  window.firebase = { apps: apps, initializeApp: function(){ apps.push({}); return {}; }, app: function(){ return { functions: fns }; },
    auth: auth, firestore: fs, functions: fns, messaging: function(){ return chain(); } };
})();`;

const browser = await chromium.launch();
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }

async function open(saved, { dark = false, coarse = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: 'block', hasTouch: coarse, isMobile: coarse });
  const page = await ctx.newPage();
  page.on('pageerror', () => {}); // the fake Firestore makes the page grumble; not under test
  page.on('dialog', d => d.dismiss());
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
    if (u.includes('gstatic.com/firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    if (u.includes('gstatic.com/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    return route.abort();
  });
  await page.addInitScript(({ saved, dark }) => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    localStorage.setItem('bbLanguage', 'en');
    localStorage.setItem('bbTheme', dark ? 'dark' : 'light');
    if (saved != null) localStorage.setItem('bbJournalRange', saved);
  }, { saved, dark });
  await page.goto(BASE + '/journal.html');
  await page.waitForFunction(() => typeof window.tapJournalRange === 'function' || typeof window.setJournalRange === 'function');
  await page.evaluate(() => {
    const host = document.getElementById('journeyRanges');
    // displayStats() hides the tabs while there are fewer than two entries,
    // so pin them visible: this test is about the tabs, not the stats.
    const st = document.createElement('style');
    st.textContent = '#journeyRanges{display:block!important;position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:12px 0;background:#fff}html.theme-dark #journeyRanges{background:#1c1c1e}';
    document.head.appendChild(st);
    document.body.appendChild(host);
    _renderJourneyRanges();
  });
  await page.waitForSelector('#journeyRanges .cv-opt');
  return { ctx, page };
}
const btn = (page, i) => page.locator('#journeyRanges .cv-opt').nth(i); // 0=1M 1=3M 2=6M 3=1Y 4=All
const isDefault = async (page, i) => (await btn(page, i).getAttribute('data-default-view')) === 'true';
const showing = page => page.evaluate(() => String(statsTimeframe));
const stored = page => page.evaluate(() => localStorage.getItem('bbJournalRange'));
const note = page => page.textContent('#journeyRanges .cv-note');

console.log('Journey range tabs (1M…All)');
{
  const { ctx, page } = await open(null);
  assert.equal(await showing(page), '30');
  for (let i = 0; i < 5; i++) assert.ok(!(await isDefault(page, i)), 'no default mark until one is chosen');
  assert.equal(await page.locator('#journeyRanges .cv-star').count(), 0, 'no ★');
  ok('fresh device: 1M, no default mark, no ★');

  await btn(page, 1).click();
  assert.equal(await showing(page), '90');
  assert.equal(await stored(page), null);
  assert.match(await note(page), /Double-click to make this your default/);
  await page.waitForTimeout(450);
  await btn(page, 1).click(); // a slow second tap on the range showing: the OLD gesture
  assert.equal(await stored(page), null, 'tapping the range already showing no longer sets the default');
  ok('one tap switches; a slow second tap on the showing range does not set a default (old gesture gone)');

  await btn(page, 2).dblclick();
  assert.equal(await showing(page), '180');
  assert.equal(await stored(page), '180');
  assert.ok(await isDefault(page, 2));
  assert.match(await note(page), /Now your default view/);
  const bg = await btn(page, 2).evaluate(b => getComputedStyle(b).backgroundImage);
  assert.match(bg, /linear-gradient/, 'showing + default = filled orange');
  assert.equal(await btn(page, 2).evaluate(b => getComputedStyle(b).touchAction), 'manipulation', 'double-tap zoom off');
  ok('double-click 6M: it becomes the default, filled orange, announced, touch-action manipulation');

  await btn(page, 1).click();
  await btn(page, 4).click(); // two quick taps on DIFFERENT buttons are not a double tap
  assert.equal(await stored(page), '180');
  await page.waitForTimeout(400);
  await btn(page, 0).click();
  const ring = await btn(page, 2).evaluate(b => getComputedStyle(b).boxShadow);
  assert.match(ring, /rgba\(255, 140, 1/, 'default not showing = orange outline');
  if (process.env.SHOTS) await page.locator('#journeyRanges').screenshot({ path: path.join(process.env.SHOTS, 'range-outlined-light.png') });
  ok('quick taps on two different ranges set nothing; the default not showing is outlined orange');

  await btn(page, 4).dblclick();
  assert.equal(await stored(page), 'all');
  assert.ok(await isDefault(page, 4) && !(await isDefault(page, 2)));
  ok('double-click All moves the default');

  await page.waitForTimeout(400);
  await page.evaluate(() => { stepJournalRange(-1); stepJournalRange(+1); });
  assert.equal(await stored(page), 'all', 'zoom steps never set a default');
  await page.evaluate(() => { stepJournalRange(-1); });
  await page.evaluate(() => { stepJournalRange(-1); });
  assert.equal(await stored(page), 'all');
  ok('the life chart zoom (stepJournalRange) switches ranges but never sets a default');
  await ctx.close();
}
{
  const { ctx, page } = await open('365');
  assert.equal(await showing(page), '365');
  assert.ok(await isDefault(page, 3));
  ok('a default saved before (bbJournalRange = 365) is kept: opens on 1Y, marked');
  await ctx.close();
}
{
  const { ctx, page } = await open('90', { dark: true, coarse: true });
  await btn(page, 0).tap();
  assert.match(await note(page), /Double-tap to make this your default/, 'touch devices say double-tap');
  const ring = await btn(page, 1).evaluate(b => getComputedStyle(b).boxShadow);
  assert.match(ring, /rgba\(255, 149, 0/, 'dark: default outlined in the dark-mode orange');
  if (process.env.SHOTS) await page.locator('#journeyRanges').screenshot({ path: path.join(process.env.SHOTS, 'range-outlined-dark.png') });
  await btn(page, 1).tap();
  await page.waitForTimeout(80);
  await btn(page, 1).tap();
  assert.equal(await stored(page), '90');
  const bg = await btn(page, 1).evaluate(b => getComputedStyle(b).backgroundImage);
  assert.match(bg, /linear-gradient/);
  if (process.env.SHOTS) await page.locator('#journeyRanges').screenshot({ path: path.join(process.env.SHOTS, 'range-filled-dark.png') });
  ok('touch + dark: hint says double-tap, a real double tap sets it, orange in dark mode');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} checks passed`);
