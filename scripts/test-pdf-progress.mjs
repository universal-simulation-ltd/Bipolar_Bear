#!/usr/bin/env node
/**
 * Browser check for the PDF progress overlay (journal.js _pdfStep, James
 * 2026-10-20: "it took a long time … can we show a loading progress as it's
 * making the pdf"). A guest journal of two years of entries is made into a PDF
 * through the real Generate path; the test checks the overlay shows with a
 * step and a moving bar while the report is made, that it goes away at the
 * end, and that a PDF really is produced. It also prints the per-step times
 * the journal logs ("[BB pdf] …"), to see what is slow.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-pdf-progress.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;
const DAYS = Number(process.env.PDF_DAYS || 730);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
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

const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, serviceWorkers: 'block', acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', () => {});
const dialogs = [];
page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
const times = [];
page.on('console', m => { const t = m.text(); if (t.startsWith('[BB pdf]')) times.push(t); });
await page.route('**/*', route => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
  if (u.includes('firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
  if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
  return route.abort();
});
await page.addInitScript(({ days }) => {
  if (sessionStorage.getItem('__seeded')) return;
  sessionStorage.setItem('__seeded', '1');
  localStorage.clear();
  localStorage.setItem('bbLanguage', 'en');
  localStorage.setItem('bbTheme', 'light');
  const moods = ['depressed', 'low', 'stable', 'stable', 'good', 'elevated'];
  const day = 86400000;
  const now = new Date(); now.setHours(12, 0, 0, 0);
  for (let i = days; i >= 1; i--) {
    const t = now.getTime() - i * day;
    const d = new Date(t);
    const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const e = { date, timestamp: t, mood: moods[i % moods.length], sleep: 5 + (i % 5), energy: 3 + (i % 5), medication: i % 9 ? 'taken' : 'not-taken', notes: 'A day ' + i + ' of the test journal, with a few words to wrap.' };
    localStorage.setItem('entry:' + t, JSON.stringify(e));
  }
}, { days: DAYS });
await page.goto(BASE + '/journal.html');
await page.waitForFunction(() => typeof window.exportPDF === 'function' && typeof window.BB?.t === 'function');

console.log(`PDF progress overlay (${DAYS} days of entries)`);
await page.evaluate(() => window.exportPDF());
await page.waitForSelector('#pdfExportModal.active');
ok('the export sheet opens');

// Watch the overlay from inside the page while the report is made.
await page.evaluate(() => {
  window.__seen = { shown: false, steps: new Set(), widths: new Set(), hiddenAfter: false };
  const m = document.getElementById('pdfProgressModal');
  const tick = () => {
    if (m.classList.contains('active')) {
      window.__seen.shown = true;
      window.__seen.steps.add(document.getElementById('pdfProgressStep').textContent);
      window.__seen.widths.add(document.getElementById('pdfProgressFill').style.width);
    } else if (window.__seen.shown) window.__seen.hiddenAfter = true;
    requestAnimationFrame(tick);
  };
  tick();
});
const download = page.waitForEvent('download', { timeout: 120000 });
const t0 = Date.now();
await page.click('#pdfExportModal .confirm-btn-yes');
const file = await download;
const ms = Date.now() - t0;
await page.waitForTimeout(300);
const seen = await page.evaluate(() => ({ shown: window.__seen.shown, steps: [...window.__seen.steps], widths: [...window.__seen.widths], hiddenAfter: window.__seen.hiddenAfter, active: document.getElementById('pdfProgressModal').classList.contains('active') }));

assert.ok(seen.shown, 'the overlay never showed');
ok('the progress overlay shows while the PDF is made');
assert.ok(seen.steps.length >= 5, 'too few steps seen: ' + JSON.stringify(seen.steps));
assert.ok(seen.steps.includes('Writing your summary…') && seen.steps.includes('Saving your PDF…'), JSON.stringify(seen.steps));
ok('it names the step (' + seen.steps.length + ' seen, e.g. "' + seen.steps[2] + '")');
assert.ok(seen.widths.length >= 4 && seen.widths.includes('100%'), 'bar: ' + JSON.stringify(seen.widths));
ok('the bar moves to 100% (' + seen.widths.length + ' positions)');
assert.ok(!seen.active && seen.hiddenAfter, 'overlay still up');
ok('the overlay goes away when the PDF is ready');
const p = await file.path();
const head = fs.readFileSync(p).subarray(0, 5).toString();
assert.equal(head, '%PDF-');
ok('a PDF is produced (' + Math.round(fs.statSync(p).size / 1024) + ' KB in ' + (ms / 1000).toFixed(1) + ' s)');
const role = await page.getAttribute('#pdfProgressBar', 'role');
assert.equal(role, 'progressbar');
ok('the bar is a progressbar for screen readers');

console.log('\n  step times:\n    ' + times.join('\n    '));
await browser.close();
server.close();
console.log(`\n${passed} passed`);
