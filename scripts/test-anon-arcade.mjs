#!/usr/bin/env node
/**
 * Browser checks for the Bipolar Anonymous logo easter egg (v371, James
 * 2026-10-20): five taps on the board's top-left logo open the 🕹️ Bear
 * Arcade (js/shared/bear-arcade.js, loaded on the fifth tap), with no
 * "Hide this button". Inside Bipolar Bear a single tap still goes home.
 * Negative controls: four taps open nothing; taps too slow don't add up;
 * the standalone app's single tap goes nowhere.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-anon-arcade.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Signed-out Firebase: auth resolves to null, Firestore reads never resolve.
const FIREBASE_STUB = fs.readFileSync(path.join(ROOT, 'scripts/test-pdf-progress.mjs'), 'utf8').split('const FIREBASE_STUB = `')[1].split('`;')[0];

const browser = await chromium.launch();
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }

/** A fresh context seeded once. o: {meds, extra:{k:v}, days} */
async function open(url, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', ...(o.touch ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) console.log('    pageerror:', e.message); });
  page.__dialog = 'accept';
  page.on('dialog', d => (page.__dialog === 'dismiss' ? d.dismiss() : d.accept()));
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (u.startsWith(BASE)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
    return route.abort();
  });
  await page.addInitScript(cfg => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    localStorage.setItem('bbLanguage', 'en');
    localStorage.setItem('bbTheme', 'light');
    localStorage.setItem('bbOnboardingStep', '12'); localStorage.setItem('bbHasEntries', '1');
    localStorage.setItem('bbGuestNoPin', '1');
    localStorage.setItem('bbWhatsNewSeen', '1.44');
    localStorage.setItem('focusedModeEnabled', '0');
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const k = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    for (let i = cfg.days; i >= 1; i--) {
      const t = now.getTime() - i * 86400000;
      localStorage.setItem('entry:' + t, JSON.stringify({ date: k(t), timestamp: t, mood: 'stable', sleep: 7, energy: 4, medication: 'taken' }));
    }
    if (cfg.meds) localStorage.setItem('currentMedList', JSON.stringify(cfg.meds));
    Object.keys(cfg.extra || {}).forEach(x => localStorage.setItem(x, cfg.extra[x]));
  }, { days: 20, ...o });
  await page.goto(BASE + url);
  await page.waitForFunction(() => window.BB && typeof BB.t === 'function');
  return { ctx, page };
}
const arcadeOpen = page => page.evaluate(() => { const a = document.querySelector('.bba'); return !!a && getComputedStyle(a).display !== 'none'; });
async function showBoard(page, bbUser) {
  await page.waitForFunction(() => typeof window._boardLogoTap === 'function');
  await page.evaluate(u => {
    window.__home = 0; window._goHome = () => { window.__home++; };
    try { _bbUser = u ? { uid: 'x' } : null; } catch (_) {}
    document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; s.classList.remove('active'); });
    const b = document.getElementById('screen-board'); b.style.display = 'flex'; b.classList.add('active');
  }, bbUser);
}
const taps = async (page, n, gap = 80) => { for (let i = 0; i < n; i++) { await page.click('#board-logo-btn'); await page.waitForTimeout(gap); } };

console.log('Bipolar Anonymous: five taps on the logo');
{
  const { ctx, page } = await open('/anonymous.html');
  await showBoard(page, false);
  await taps(page, 4);
  await page.waitForTimeout(600);
  assert.equal(await arcadeOpen(page), false);
  assert.equal(await page.evaluate(() => !!document.getElementById('bbArcadeScript')), false);
  ok('four taps open nothing (negative control)');
  await page.waitForTimeout(2600);
  await taps(page, 3, 900);
  await page.waitForTimeout(400);
  assert.equal(await arcadeOpen(page), false);
  ok('taps spread over more than 2.5 s don\'t add up (negative control)');
  await page.waitForTimeout(2600);
  await taps(page, 5);
  await page.waitForFunction(() => { const a = document.querySelector('.bba'); return a && getComputedStyle(a).display !== 'none'; }, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => { const h = [...document.querySelectorAll('.bba button')].find(b => /Hide this button/.test(b.textContent)); return !!h && getComputedStyle(h).display !== 'none'; }), false);
  assert.equal(await page.evaluate(() => window.__home), 0);
  ok('five quick taps open the Bear Arcade, with no "Hide this button" and no trip home');
  await page.evaluate(() => BB.arcade.close());
  await taps(page, 5);
  await page.waitForTimeout(300);
  assert.equal(await arcadeOpen(page), true);
  ok('it opens again the next time (the script is loaded once)');
  await ctx.close();
}
{
  const { ctx, page } = await open('/anonymous.html');
  await showBoard(page, true);
  // The page's auth listener sets _bbUser (null, signed out) once Firebase
  // answers: let it, then sign in as a Bipolar Bear user.
  await page.waitForTimeout(1500);
  await page.evaluate(() => { _bbUser = { uid: 'x' }; });
  assert.equal(await page.evaluate(() => _canGoBackToBB()), true);
  await taps(page, 1);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.__home), 1);
  await taps(page, 5);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.__home), 1);
  assert.equal(await arcadeOpen(page), true);
  ok('inside Bipolar Bear one tap still goes home, and five open the arcade instead');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
