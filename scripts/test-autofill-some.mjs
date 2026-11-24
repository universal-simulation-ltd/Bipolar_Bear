#!/usr/bin/env node
/**
 * Browser checks for 🤏 Some in auto-fill's "Fill in the rest" (2026-11-24,
 * James: "autofill past days add a way to say some medications were skipped
 * instead of just unsure for all").
 *
 * The real journal (Firebase stubbed out, signed out, a guest without a PIN,
 * plain entries), at 390 px. Covers: with two medicines the medication row
 * reads Not taken · Unsure · 🤏 Some · Taken and Some shows a chip per
 * medicine; marking one skipped saves every filled day as Some with that
 * medicine missed and the other taken; all skipped → Not taken; nothing
 * marked → Some with no details; a day whose list lacks the skipped medicine
 * → Taken; with one medicine Some is not offered.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-autofill-some.mjs
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
const FIREBASE_STUB = fs.readFileSync(path.join(ROOT, 'scripts/test-pdf-progress.mjs'), 'utf8').split('const FIREBASE_STUB = `')[1].split('`;')[0];

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(meds) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) page.__errors.push(e.message); });
  page.on('dialog', d => d.accept());
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
    localStorage.setItem('bbWhatsNewSeen', '9.99'); localStorage.setItem('bbWelcomeShown', '1');
    localStorage.setItem('focusedModeEnabled', '0');
    localStorage.setItem('bbGuestNoPin', '1');
    localStorage.setItem('currentMedList', JSON.stringify(cfg.meds));
    const now = new Date(); now.setHours(12, 0, 0, 0);
    [6, 5].forEach(i => {
      const d = new Date(now); d.setDate(d.getDate() - i);
      localStorage.setItem('entry:' + d.getTime(), JSON.stringify({ date: d.toISOString(), mood: 'stable', energy: 5, sleep: 7, medication: 'taken', timestamp: d.getTime(), notes: '' }));
    });
  }, { meds });
  await page.goto(`${BASE}/journal.html`);
  await page.waitForFunction(() => typeof window.showAutoFillModal === 'function' && typeof window.showMissingDates === 'function');
  await sleep(800);
  return page;
}

/** Opens auto-complete → Fill in the rest with mood Stable; returns the sheet's text. */
async function toAsk(page) {
  return page.evaluate(async () => {
    try { await showMissingDates(); } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
    await showAutoFillModal();
    showAutoFillAsk();
    _afAskPick('mood', 'stable');
    return document.getElementById('afAskBody-bulk').innerText;
  });
}

const filled = page => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('entry:'))
  .map(k => JSON.parse(localStorage.getItem(k))).filter(e => e.autoFilled));

const TWO = [{ name: 'Lithium', dosage: '400 mg' }, { name: 'Quetiapine', dosage: '50 mg' }];

// 1. Some, one skipped → every day saved as Some.
{
  const page = await open(TWO);
  const txt = await toAsk(page);
  assert.match(txt, /Not taken[\s\S]*Unsure[\s\S]*Some[\s\S]*Taken/);
  ok('two medicines: Not taken · Unsure · 🤏 Some · Taken');
  await page.evaluate(() => _afAskPick('med', 'some'));
  assert.equal(await page.locator('#afAskBody-bulk .med-dose-chip').count(), 2);
  ok('Some shows a chip per medicine');
  await page.locator('#afAskBody-bulk .med-dose-chip').nth(1).click();
  assert.equal(await page.locator('#afAskBody-bulk .med-dose-chip.missed').count(), 1);
  ok('a tap marks a medicine skipped');
  await page.evaluate(() => runAutoFill());
  await page.waitForFunction(() => document.getElementById('autoFillDoneActions')?.style.display === '');
  const days = await filled(page);
  assert.ok(days.length >= 2, 'days filled: ' + days.length);
  days.forEach(e => {
    assert.equal(e.medSome, true);
    assert.equal(e.medication, 'not-taken');
    assert.deepEqual(e.medDoses, { Lithium: 'taken', Quetiapine: 'missed' });
  });
  ok(`each of ${days.length} days saved as Some: Lithium taken, Quetiapine missed`);
  assert.deepEqual(page.__errors, []);
  await page.context().close();
}

// 2. The per-day rules.
{
  const page = await open(TWO);
  await toAsk(page);
  const r = await page.evaluate(() => {
    _afAskPick('med', 'some');
    const none = _afMedFields(['Lithium', 'Quetiapine']);
    _afAskMedToggle(0); _afAskMedToggle(1);
    const all = _afMedFields(['Lithium', 'Quetiapine']);
    _afAskMedToggle(0);
    const notOnList = _afMedFields(['Lithium']);
    return { none, all, notOnList };
  });
  assert.equal(r.none.medSome, true); assert.equal(r.none.medDoses, null);
  ok('nothing marked → Some with no details');
  assert.equal(r.all.medSome, null); assert.equal(r.all.medication, 'not-taken');
  ok('all skipped → Not taken');
  assert.equal(r.notOnList.medication, 'taken'); assert.equal(r.notOnList.medSome, null);
  ok("skipped medicine not on that day's list → Taken");
  await page.context().close();
}

// 3. One medicine: no Some.
{
  const page = await open([{ name: 'Lithium', dosage: '400 mg' }]);
  const txt = await toAsk(page);
  assert.doesNotMatch(txt, /Some/);
  ok('one medicine: Some is not offered');
  await page.context().close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
