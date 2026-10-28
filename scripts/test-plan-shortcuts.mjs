#!/usr/bin/env node
/**
 * Browser checks for the two ways to My safety plan from any page (v389,
 * James 2026-10-28, "can I access safety plan from my journal?"): a 🛟 row
 * in the 🆘 Crisis Support sheet, and 🛟 My safety plan as a dock button you
 * can add. Negative controls: from the PIN screen the row only shows when the
 * plan is set to show there; the dock button isn't there until it's added.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-plan-shortcuts.mjs
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
    localStorage.setItem('bbWhatsNewSeen', '1.46');
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
const DOCK = { extra: { bbFabsUnlocked: '1', bbFabFirstRunDone: '1', bbWaFabHidden: '' } };
const PLAN = JSON.stringify({ warningSigns: ['Not sleeping'], coping: [], distraction: [], helpPeople: [], professionals: [], safeEnv: [], reasons: ['My dog'], updatedAt: 1 });
const rowShown = page => page.evaluate(() => getComputedStyle(document.getElementById('chatModalPlan')).display !== 'none');
const planOpen = page => page.evaluate(() => !!document.querySelector('.bbsp-sheet'));
const planEditing = page => page.evaluate(() => !!document.querySelector('.bbsp-sheet .bbsp-add input'));
const sheetOpen = page => page.evaluate(() => document.getElementById('chatModal').classList.contains('open'));
async function openSos(page, fromLock) {
  await page.waitForFunction(() => typeof window.openChatModal === 'function' && window.BB && BB.safetyPlan);
  await page.evaluate(f => window.openChatModal(f), !!fromLock);
}

console.log('🆘 Crisis Support → 🛟 My safety plan');
for (const file of ['/journal.html', '/index.html']) {
  const { ctx, page } = await open(file, DOCK);
  await openSos(page);
  assert.equal(await rowShown(page), true);
  assert.equal(await page.textContent('#chatModalPlanName'), 'My safety plan');
  assert.equal(await page.textContent('#chatModalPlanSub'), "Write it now, while you're feeling OK");
  await page.click('#chatModalPlan');
  assert.equal(await sheetOpen(page), false);
  assert.equal(await planOpen(page), true);
  assert.equal(await planEditing(page), true);
  ok(file.slice(1) + ': with no plan yet, the row says to write it and opens it ready to write, the sheet closed');
  await ctx.close();
}
{
  const { ctx, page } = await open('/journal.html', { extra: { ...DOCK.extra, bbSafetyPlan: PLAN } });
  await openSos(page);
  assert.equal(await page.textContent('#chatModalPlanSub'), 'Warning signs, people to call, reasons to keep going');
  await page.click('#chatModalPlan');
  assert.equal(await planOpen(page), true);
  assert.equal(await planEditing(page), false);
  assert.match(await page.textContent('.bbsp-sheet'), /Not sleeping/);
  ok('with a plan, it opens the plan to read');
  await page.evaluate(() => BB.safetyPlan.close());

  await openSos(page, true);
  assert.equal(await rowShown(page), false);
  ok('from the PIN screen, no row unless the plan is set to show there');
  await page.evaluate(() => window.closeChatModal());
  await page.evaluate(() => localStorage.setItem('bbSafetyPlanOnLock', '1'));
  await openSos(page, true);
  assert.equal(await rowShown(page), true);
  await page.click('#chatModalPlan');
  assert.equal(await planEditing(page), false);
  assert.match(await page.textContent('.bbsp-sheet'), /Not sleeping/);
  ok('…and with it set, the row opens it to read only');
  await ctx.close();
}
{
  const { ctx, page } = await open('/journal.html', { extra: { ...DOCK.extra, bbLanguage: 'de' } });
  await page.evaluate(() => localStorage.setItem('bbLanguage', 'de'));
  await page.reload();
  await page.waitForFunction(() => window.BB && BB.i18n && BB.i18n.getLang() === 'de');
  await openSos(page);
  assert.equal(await page.textContent('#chatModalPlanName'), 'Mein Sicherheitsplan');
  ok('in German: "Mein Sicherheitsplan"');
  await ctx.close();
}
{
  const { ctx, page } = await open('/journal.html', { extra: { ...DOCK.extra, bbTheme: 'dark' } });
  await openSos(page);
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById('chatModalPlan')).backgroundColor);
  assert.equal(bg, 'rgb(37, 43, 69)');
  ok('in dark mode the row is dark too (its light text was unreadable on the light row)');
  await ctx.close();
}

console.log('🛟 My safety plan on the dock');
{
  const { ctx, page } = await open('/journal.html', DOCK);
  await page.waitForFunction(() => typeof window._openFabPicker === 'function');
  assert.equal(await page.evaluate(() => document.getElementById('safetyplanExtraFab').style.display), 'none');
  ok('not on the dock until it is added');
  const free = await (await page.waitForFunction(() => [1, 2, 3, 4].find(s => { const p = document.getElementById('fabPh' + s); return p && getComputedStyle(p).display !== 'none'; }), null, { timeout: 15000 })).jsonValue();
  await page.evaluate(s => document.getElementById('fabPh' + s).click(), free);
  const opt = await page.evaluate(() => { const b = [...document.querySelectorAll('#bbFabPickerOptions button')].find(x => /My safety plan/.test(x.textContent)); return b && b.textContent; });
  assert.match(opt, /🛟\s*My safety planWarning signs, people to call, reasons to keep going/);
  ok('the dock picker offers 🛟 My safety plan');
  await page.evaluate(() => [...document.querySelectorAll('#bbFabPickerOptions button')].find(x => /My safety plan/.test(x.textContent)).click());
  await page.evaluate(() => document.getElementById('bbDockHoldHint')?.remove());
  assert.equal(await L(page, 'bbFabSlot_' + free), 'safetyplan');
  assert.equal(await page.evaluate(() => document.getElementById('safetyplanExtraFab').style.display), 'flex');
  await page.click('#safetyplanExtraFab');
  assert.equal(await planOpen(page), true);
  assert.equal(await planEditing(page), true);
  ok('added, it sits on the dock and opens the plan over the journal');
  await page.evaluate(() => BB.safetyPlan.close());
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => document.getElementById('safetyplanExtraFab') && document.getElementById('safetyplanExtraFab').style.display === 'flex', null, { timeout: 15000 });
  await page.click('#safetyplanExtraFab');
  assert.equal(await planOpen(page), true);
  ok('it stays on the dock on the home page, and opens the plan there too');
  await page.evaluate(() => BB.safetyPlan.close());
  await page.evaluate(() => window._hideExtraFab('safetyplan'));
  assert.equal(await L(page, 'bbFabSlot_' + free), null);
  assert.equal(await page.evaluate(() => document.getElementById('safetyplanExtraFab').style.display), 'none');
  ok('hiding it takes it off and frees the slot');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
