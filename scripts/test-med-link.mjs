#!/usr/bin/env node
/**
 * Browser check for 💊 each medicine on its own in Personalised feedback
 * (js/journal-medlink.js, DOCS.md §2.35): a guest journal through the real
 * journal.html (Firebase stubbed out), at 390 px.
 *
 * 40 days where Quetiapine was skipped about one day in three and the night
 * after was short and the day after often elevated; Lithium always taken; a
 * third medicine whose name is HTML, skipped on unrelated days. Checks: the
 * Quetiapine card with its counts and caution; no card for Lithium (never
 * skipped); the HTML name shows as text; nothing leaves the page while the
 * popup works it out; no sideways scroll; German.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-med-link.mjs
 *   SHOTS=<dir> also saves screenshots.
 *
 * The rules themselves are checked without a browser by scripts/test-med-link.js.
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
const FIREBASE_STUB = fs.readFileSync(path.join(ROOT, 'scripts/test-pdf-progress.mjs'), 'utf8').split('const FIREBASE_STUB = `')[1].split('`;')[0];
const ODD = '<b>Odd</b>';

const browser = await chromium.launch();
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

async function open(lang) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  const outside = [];
  page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) errors.push(e.message); });
  page.on('dialog', d => d.accept());
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (u.startsWith(BASE)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
    outside.push(u);
    return route.abort();
  });
  await page.addInitScript(cfg => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    localStorage.setItem('bbLanguage', cfg.lang);
    localStorage.setItem('bbTheme', 'light');
    localStorage.setItem('bbOnboardingStep', '12'); localStorage.setItem('bbHasEntries', '1');
    localStorage.setItem('bbWhatsNewSeen', '9.99'); localStorage.setItem('bbWelcomeShown', '1');
    localStorage.setItem('bbGuestNoPin', '1');
    localStorage.setItem('currentMedList', JSON.stringify([{ name: 'Quetiapine', dosage: '200 mg' }, { name: 'Lithium', dosage: '800 mg' }, { name: cfg.odd, dosage: '1' }]));
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const k = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const skipQ = b => b % 3 === 0;
    for (let b = 40; b >= 1; b--) {
      const t = now.getTime() - b * 86400000;
      const after = skipQ(b + 1);
      const doses = { Quetiapine: skipQ(b) ? 'missed' : 'taken', Lithium: 'taken' };
      doses[cfg.odd] = b % 4 === 1 ? 'missed' : 'taken';
      localStorage.setItem('entry:' + t, JSON.stringify({
        date: k(t), timestamp: t, energy: 5, medDoses: doses, medication: 'not-taken',
        mood: after ? (b % 2 ? 'elevated' : 'manic') : 'stable', sleep: after ? 5 : 7.5,
      }));
    }
  }, { lang, odd: ODD });
  await page.goto(BASE + '/journal.html');
  await page.waitForFunction(() => window.BB && window.BBMeds && window.BBMedLink && typeof window.showPersonalisedFeedback === 'function', null, { timeout: 20000 });
  // Wait for loadEntries() to have the guest entries.
  await page.waitForFunction(() => document.querySelector('.pf-link'), null, { timeout: 20000 }).catch(() => {});
  outside.length = 0;
  await page.evaluate(() => window.showPersonalisedFeedback(90));
  await page.waitForSelector('#feedbackModal.active');
  return { ctx, page, errors, outside };
}

console.log('💊 Each medicine in Personalised feedback');
{
  const { ctx, page, errors, outside } = await open('en');
  const text = await page.textContent('#feedbackBody');
  assert.match(text, /Quetiapine: days taken and not taken/);
  assert.match(text, /You slept about 5h the night after a day you didn’t take it, and about 7h 30m after a day you did\./);
  assert.match(text, /Your mood was elevated or manic on \d+ of \d+ days after a day you didn’t take it, and on 0 of \d+ days after a day you did\./);
  assert.match(text, /Based on 13 days you didn’t take it and 27 days you did\./);
  assert.match(text, /Talk to your prescriber before changing how you take any medicine\./);
  ok('Quetiapine card: the night after, the day after, counts, the caution');
  assert.ok(!/Lithium: days taken/.test(text), 'Lithium was never skipped: no card');
  ok('no card for a medicine that was always taken');
  assert.ok(text.includes(ODD + ': days taken and not taken'), 'the HTML name is shown as typed');
  assert.equal(await page.locator('#feedbackBody b').count(), 0, 'and not turned into markup');
  ok('a medicine name is escaped');
  assert.ok(!/\{\w+\}|medLink\./.test(text), 'no raw keys or placeholders');
  assert.deepEqual(outside, [], 'nothing requested outside the page');
  assert.deepEqual(errors, []);
  ok('no raw keys, no outside requests, no errors');
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(w[0] <= w[1], 'no sideways scroll at 390 px');
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.evaluate(() => { const el = [...document.querySelectorAll('#feedbackBody > div')].find(d => /Quetiapine:/.test(d.textContent)); if (el) el.scrollIntoView(); });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'med-link-en.png') });
  }
  ok('fits 390 px');
  await ctx.close();
}
{
  const { ctx, page } = await open('de');
  const text = await page.textContent('#feedbackBody');
  assert.match(text, /Quetiapine: Tage mit und ohne Einnahme/);
  assert.match(text, /Sprich mit der Person, die es dir verschreibt/);
  assert.ok(!/\{\w+\}|medLink\./.test(text));
  ok('German');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} checks passed`);
