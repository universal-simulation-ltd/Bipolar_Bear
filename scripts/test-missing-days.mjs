#!/usr/bin/env node
/**
 * Browser checks for "Several days missing" (2026-11-03) and its quick
 * check-in route (2026-11-11, James: "when missing previous entries and
 * clicking the mood journal / quick check in then offer the user choice to
 * bulk enter missing days or one by one").
 *
 * The real journal (Firebase stubbed out, signed out, a guest without a PIN,
 * plain entries), at 390 px, classic form (and once in focus mode). Covers: opening the journal with
 * yesterday and two more days missing asks at once (3 entries missing); a
 * ?mood= quick check-in does NOT ask on the way in, puts the mood on
 * yesterday, and asks once that entry is saved ("Saved. 2 earlier days are
 * missing"), with Auto-fill all / Fill them in myself / Not now; Fill them in
 * myself opens the next missing day and chains to the one after; Auto-fill
 * opens the auto-complete with those two days and Cancel comes back to the
 * same question; Not now holds it for the day; a quick check-in with only
 * yesterday missing never asks; "1 earlier day" wording; focus mode; German.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-missing-days.mjs
 *   SHOTS=<dir> also saves screenshots.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;
const SHOTS = process.env.SHOTS || '';

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

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * A fresh context. o: {mood, logged: [days ago…], lang, local:{}}
 * Default: logged 8…4 days ago, so 3, 2 and 1 (yesterday) are missing.
 */
async function open(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) { page.__errors.push(e.message); console.log('    pageerror:', e.message); } });
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
    localStorage.setItem('bbLanguage', cfg.lang || 'en');
    localStorage.setItem('bbTheme', 'light');
    localStorage.setItem('bbOnboardingStep', '12'); localStorage.setItem('bbHasEntries', '1');
    localStorage.setItem('bbWhatsNewSeen', '9.99'); localStorage.setItem('bbWelcomeShown', '1');
    localStorage.setItem('focusedModeEnabled', cfg.fm ? '1' : '0');
    localStorage.setItem('bbGuestNoPin', '1');
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const k = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    (cfg.logged || [8, 7, 6, 5, 4]).forEach(i => {
      const t = now.getTime() - i * 86400000;
      localStorage.setItem('entry:' + t, JSON.stringify({ date: k(t), timestamp: t, mood: 'stable', sleep: 7, energy: 5, medication: 'taken' }));
    });
    Object.keys(cfg.local || {}).forEach(x => localStorage.setItem(x, cfg.local[x]));
  }, o);
  await page.goto(BASE + '/journal.html' + (o.mood ? '?mood=' + o.mood : ''));
  await page.waitForFunction(() => window.BB && typeof BB.t === 'function' && typeof window._mmDismiss === 'function', null, { timeout: 20000 });
  return { ctx, page };
}
const shot = async (page, name) => {
  if (!SHOTS) return;
  await sleep(400);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
};
const dayKey = ago => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ago); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const ask = page => page.evaluate(() => {
  const m = document.getElementById('multiMissingModal');
  return {
    open: !!m && m.classList.contains('active'),
    title: document.getElementById('multiMissingTitle')?.textContent || '',
    body: document.getElementById('multiMissingBody')?.textContent || '',
    buttons: [...document.querySelectorAll('#multiMissingActions button')].map(b => b.firstChild.textContent),
  };
});
const waitAsk = (page, t = 6000) => page.waitForFunction(() => document.getElementById('multiMissingModal')?.classList.contains('active'), null, { timeout: t });
const click = (page, label) => page.evaluate(l => [...document.querySelectorAll('#multiMissingActions button')].find(b => b.firstChild.textContent === l).click(), label);
const formDate = page => page.evaluate(() => document.getElementById('entryDate')?.value);
const pickedMood = page => page.evaluate(() => document.querySelector('#entryFormCard .mood-btn.selected, #entryFormCard .mood-btn.active')?.dataset.mood || null);
// Saved entries carry an ISO date (noon local): compare by local day.
const logged = page => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('entry:')).map(k => {
  const e = JSON.parse(localStorage.getItem(k)); const d = new Date(e.date.length === 10 ? e.date + 'T12:00:00' : e.date);
  return { ...e, date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') };
}));
async function save(page, mood) {
  if (mood) await page.evaluate(m => document.querySelector(`#entryFormCard .mood-btn[data-mood="${m}"]`).click(), mood);
  await sleep(200);
  await page.evaluate(() => saveAndOpenJournal());
  await sleep(500);
}

console.log('Opening the journal (no quick check-in)');
{
  const { ctx, page } = await open();
  await waitAsk(page);
  const a = await ask(page);
  assert.equal(a.title, '3 entries missing');
  assert.deepEqual(a.buttons, ['✨ Auto-fill all', '✍️ Fill them in myself', 'Not now']);
  ok('yesterday and two more missing: asks straight away (3 entries missing)');
  await shot(page, '1-open');
  await ctx.close();
}

console.log('Quick check-in with three days missing');
{
  const { ctx, page } = await open({ mood: 'low' });
  await sleep(2500);
  assert.equal((await ask(page)).open, false, 'asked on the way in');
  assert.equal(await formDate(page), dayKey(1));
  ok('no question on the way in; the form is on yesterday');
  await save(page);
  const saved = (await logged(page)).find(e => e.date === dayKey(1));
  assert.ok(saved, 'yesterday not saved');
  assert.equal(saved.mood, 'low', 'the quick check-in mood was not used');
  ok('the tapped mood (Low) is saved on yesterday');
  await waitAsk(page);
  const a = await ask(page);
  assert.equal(a.title, 'Saved. 2 earlier days are missing');
  assert.match(a.body, /^The latest is .+\. Fill them all in at once, or one day at a time\?$/);
  assert.deepEqual(a.buttons, ['✨ Auto-fill all', '✍️ Fill them in myself', 'Not now']);
  ok('after the save: "Saved. 2 earlier days are missing" with all three answers');
  await shot(page, '2-after-checkin');

  // Auto-fill and Cancel come back to the same question.
  await click(page, '✨ Auto-fill all');
  await page.waitForFunction(() => document.getElementById('autoFillModal')?.classList.contains('active'), null, { timeout: 5000 });
  const days = await page.evaluate(() => _missingDatesCache.map(d => d.getDate()));
  assert.deepEqual(days, [new Date(dayKey(3) + 'T00:00').getDate(), new Date(dayKey(2) + 'T00:00').getDate()]);
  ok('Auto-fill all opens the auto-complete on the two missing days');
  await page.evaluate(() => closeAutoFillModal());
  await sleep(200);
  assert.equal((await ask(page)).title, 'Saved. 2 earlier days are missing');
  ok('Cancel comes back to the same question');

  // One by one.
  await click(page, '✍️ Fill them in myself');
  await sleep(800);
  assert.equal(await formDate(page), dayKey(2));
  ok('Fill them in myself opens the next missing day');
  await save(page, 'stable');
  await waitAsk(page);
  assert.equal((await ask(page)).title, 'Saved. 1 more to go');
  await click(page, `✍️ Continue with ${await page.evaluate(k => _mmLong(k), dayKey(3))}`);
  await sleep(800);
  assert.equal(await formDate(page), dayKey(3));
  await save(page, 'elevated');
  await sleep(1500);
  assert.equal((await ask(page)).open, false, 'asked again with nothing left');
  const all = (await logged(page)).map(e => e.date);
  [1, 2, 3].forEach(i => assert.ok(all.includes(dayKey(i)), 'missing ' + dayKey(i)));
  ok('…and chains to the one after; all three days are logged, then it stops');
  assert.deepEqual(page.__errors, []);
  await ctx.close();
}

console.log('Not now');
{
  const { ctx, page } = await open({ mood: 'stable' });
  await sleep(2000);
  await save(page);
  await waitAsk(page);
  await click(page, 'Not now');
  await sleep(200);
  assert.equal((await ask(page)).open, false);
  assert.equal(await page.evaluate(() => localStorage.getItem('bbMultiMissingDay')), dayKey(0));
  ok('Not now closes it and holds it for the rest of the day');
  await ctx.close();
}

console.log('Quick check-in, only yesterday missing');
{
  const { ctx, page } = await open({ mood: 'low', logged: [5, 4, 3, 2] });
  await sleep(2000);
  await save(page);
  await sleep(2000);
  assert.equal((await ask(page)).open, false);
  ok('nothing else missing: no question after the save');
  await ctx.close();
}

console.log('Quick check-in, one earlier day missing');
{
  const { ctx, page } = await open({ mood: 'low', logged: [5, 4, 3] });
  await sleep(2000);
  await save(page);
  await waitAsk(page);
  const a = await ask(page);
  assert.equal(a.title, 'Saved. 1 earlier day is missing');
  assert.match(a.body, /isn't logged yet\. Fill it in now\?$/);
  ok('"Saved. 1 earlier day is missing"');
  await ctx.close();
}

console.log('Focus mode quick check-in');
{
  const { ctx, page } = await open({ mood: 'depressed', fm: true });
  await page.waitForSelector('#focusedModeCard #fmContent', { state: 'visible', timeout: 20000 });
  await sleep(2500);
  // Depressed opens its support sheet first, as a tap would: close it.
  await page.evaluate(() => document.querySelectorAll('.confirm-modal.active').forEach(m => { if (m.id !== 'multiMissingModal') m.classList.remove('active'); }));
  assert.equal((await ask(page)).open, false, 'asked on the way in');
  await page.evaluate(() => saveAndOpenJournal());
  await waitAsk(page);
  assert.equal((await ask(page)).title, 'Saved. 2 earlier days are missing');
  assert.equal((await logged(page)).find(e => e.date === dayKey(1))?.mood, 'depressed');
  ok('focus mode: the mood is saved on yesterday, then the question');
  assert.deepEqual(page.__errors, []);
  await ctx.close();
}

console.log('German');
{
  const { ctx, page } = await open({ mood: 'low', lang: 'de' });
  await sleep(2000);
  await save(page);
  await waitAsk(page);
  assert.equal((await ask(page)).title, 'Gespeichert. 2 frühere Tage fehlen');
  ok('German: "Gespeichert. 2 frühere Tage fehlen"');
  await shot(page, '3-de');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
