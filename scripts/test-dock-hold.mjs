#!/usr/bin/env node
/**
 * Browser checks for holding a dock button to hide it (v370, James
 * 2026-10-20): hold any dock shortcut (or right-click it) for "Hide … from
 * the dock?"; Hide takes it off (an extra frees its slot, a default gets its
 * hidden flag), Cancel keeps it. The first Add to dock shows a hint once.
 * Negative controls: a short tap still opens the button, not the question;
 * Cancel changes nothing; the hint never shows a second time.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-dock-hold.mjs
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
const L = (page, k) => page.evaluate(x => localStorage.getItem(x), k);
const DOCK = { extra: { bbFabsUnlocked: '1', bbFabFirstRunDone: '1', bbWaFabHidden: '1' } };
const freeSlot = async page => (await (await page.waitForFunction(() => [1, 2, 3, 4].find(s => { const p = document.getElementById('fabPh' + s); return p && getComputedStyle(p).display !== 'none'; }), null, { timeout: 15000 })).jsonValue());
async function hold(page, sel, ms = 700) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
  await page.waitForTimeout(150);
}
const askOpen = page => page.evaluate(() => !!document.querySelector('#bbDockHoldModal.open'));

console.log('Hold a dock button to hide it');
{
  const { ctx, page } = await open('/index.html', DOCK);
  await page.waitForFunction(() => typeof window._openFabPicker === 'function');
  const free = await freeSlot(page);
  // Add 🧰 Survival Kit: the first Add to dock shows the hint once.
  await page.evaluate(s => document.getElementById('fabPh' + s).click(), free);
  await page.evaluate(() => [...document.querySelectorAll('#bbFabPickerOptions button')].find(b => /Survival Kit/.test(b.textContent)).click());
  assert.match(await page.textContent('#bbDockHoldHint'), /hold/i);
  assert.equal(await L(page, 'bbDockHoldHintDone'), '1');
  ok('the first Add to dock shows "Tip: … hold a button on the dock to hide it"');

  // Hold → the question, and the release doesn't open the Survival Kit.
  await page.evaluate(() => document.getElementById('bbDockHoldHint')?.remove());
  await hold(page, '#survivalExtraFab');
  assert.equal(await askOpen(page), true);
  assert.match(await page.textContent('#bbDockHoldTitle'), /Hide Survival Kit from the dock\?/);
  assert.match(page.url(), /index\.html$/);
  // Cancel keeps it (negative control).
  await page.click('#bbDockHoldCancel');
  assert.equal(await askOpen(page), false);
  assert.equal(await L(page, 'bbFabSlot_' + free), 'survival');
  assert.equal(await page.isVisible('#survivalExtraFab'), true);
  ok('holding 🧰 asks "Hide Survival Kit from the dock?" without opening it; Cancel keeps it');

  // Hide takes it off and frees the slot.
  await hold(page, '#survivalExtraFab');
  await page.click('#bbDockHoldHide');
  assert.equal(await L(page, 'bbFabSlot_' + free), null);
  assert.equal(await page.isVisible('#survivalExtraFab'), false);
  assert.equal(await page.isVisible('#fabPh' + free), true);
  ok('Hide takes 🧰 off the dock and its slot shows + again');

  // A second Add to dock: no hint (negative control).
  await page.evaluate(s => document.getElementById('fabPh' + s).click(), free);
  await page.evaluate(() => [...document.querySelectorAll('#bbFabPickerOptions button')].find(b => /Statistics/.test(b.textContent)).click());
  assert.equal(await page.evaluate(() => !!document.getElementById('bbDockHoldHint')), false);
  ok('the hint never shows a second time');

  // A default (📣 Send Feedback): right-click asks too, Hide sets its hidden flag.
  await page.click('.feedback-fab', { button: 'right' });
  assert.equal(await askOpen(page), true);
  assert.match(await page.textContent('#bbDockHoldTitle'), /Send Feedback/);
  await page.click('#bbDockHoldHide');
  assert.equal(await L(page, 'bbFeedbackFabHidden'), '1');
  assert.equal(await page.isVisible('.feedback-fab'), false);
  ok('right-clicking a default (📣) asks the same; Hide sets bbFeedbackFabHidden and it leaves the dock');

  // A short tap still opens the button (negative control).
  await page.click('#statsExtraFab');
  await page.waitForTimeout(200);
  assert.equal(await askOpen(page), false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('bbStatsModal')).display !== 'none'), true);
  ok('a short tap opens the button as before, not the question');
  await ctx.close();
}

// On a phone: a real touch hold (CDP touch events), the main way in.
{
  const { ctx: c2, page } = await open('/index.html', { extra: { ...DOCK.extra, bbFabSlot_2: 'anon', bbDockHoldHintDone: '1' }, touch: true });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('anonExtraFab')).display !== 'none', null, { timeout: 15000 });
  const cdp = await c2.newCDPSession(page);
  const b = await page.locator('#anonExtraFab').boundingBox();
  const pt = [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  assert.equal(await askOpen(page), true);
  assert.match(await page.textContent('#bbDockHoldTitle'), /Hide Bipolar Anonymous from the dock\?/);
  assert.match(page.url(), /index\.html$/);
  await page.click('#bbDockHoldHide');
  assert.equal(await L(page, 'bbFabSlot_2'), null);
  ok('on a phone, a touch hold on 💬 asks to hide it (no sign-in, no board), and Hide frees its slot');
  await c2.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
