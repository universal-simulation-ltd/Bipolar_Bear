#!/usr/bin/env node
/**
 * Personalised feedback scored by distance from stable (2026-11-26, DOCS.md
 * §2.36): medication / exercise / outside / steps / sleep cards say "closer to
 * stable", never "higher"; auto-filled days are left out; the new sleep quality
 * card. A guest journal through the real journal.html (Firebase stubbed), 390 px.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-steady.mjs
 *   SHOTS=<dir> also saves a screenshot.
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
const browser = await chromium.launch();
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

// 40 answered days: medication taken on even days, and those days were
// ELEVATED (with exercise and a poor night); the not-taken days were stable
// (with time outside and a good night). The old cards called the taken days
// "higher" (green) and exercise good news. Plus 10 auto-filled days (taken,
// stable) that must not count.
async function open(lang) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) errors.push(e.message); });
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
    localStorage.setItem('bbLanguage', cfg.lang);
    localStorage.setItem('bbTheme', 'light');
    localStorage.setItem('bbOnboardingStep', '12'); localStorage.setItem('bbHasEntries', '1');
    localStorage.setItem('bbWhatsNewSeen', '9.99'); localStorage.setItem('bbWelcomeShown', '1');
    localStorage.setItem('bbGuestNoPin', '1');
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const k = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    for (let b = 50; b >= 1; b--) {
      const t = now.getTime() - b * 86400000;
      if (b > 40) {
        localStorage.setItem('entry:' + t, JSON.stringify({ date: k(t), timestamp: t, energy: 5, autoFilled: true,
          medication: 'taken', mood: 'stable', exercise: 'yes', outside: 'no', sleepQuality: 'good' }));
        continue;
      }
      const taken = b % 2 === 0;
      localStorage.setItem('entry:' + t, JSON.stringify({ date: k(t), timestamp: t, energy: 5,
        medication: taken ? 'taken' : 'not-taken', mood: taken ? 'elevated' : 'stable',
        exercise: taken ? 'yes' : 'no', outside: taken ? 'no' : 'yes', sleepQuality: taken ? 'bad' : 'good' }));
    }
  }, { lang });
  await page.goto(BASE + '/journal.html');
  await page.waitForFunction(() => window.BB && typeof window.showPersonalisedFeedback === 'function', null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.pf-link'), null, { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => window.showPersonalisedFeedback(90));
  await page.waitForSelector('#feedbackModal.active');
  return { ctx, page, errors };
}

console.log('Personalised feedback by distance from stable');
{
  const { ctx, page, errors } = await open('en');
  const text = await page.textContent('#feedbackBody');
  assert.match(text, /On days medication was missed, your mood was 1\.0 pts closer to stable on average \(20 days taken, 20 not taken\) — worth mentioning to your doctor\./);
  ok('elevated days on medication read as further from stable, not "higher"');
  assert.ok(!/pts higher/.test(text), 'no "higher" wording left');
  assert.match(text, /Based on the last 90 days · 40 entries/);
  ok('auto-filled days left out (20 taken, not 30; 40 entries, not 50)');
  assert.ok(!/Exercise & Mood/.test(text), 'exercise days were further from stable: no card');
  ok('no exercise card when exercise days were less steady (negative control)');
  assert.match(text, /On days you got outside, your mood was 1\.0 pts closer to stable on average \(20 days outside, 20 in\)\./);
  ok('outside: closer to stable');
  assert.match(text, /Sleep Quality & Mood/);
  assert.match(text, /After a night you rated poor, your mood was 1\.0 pts further from stable on average than after a good night \(20 poor nights, 20 good\)\./);
  ok('sleep quality → same-day mood');
  assert.equal((text.match(/Closer to stable is the goal here/g) || []).length, 1);
  ok('the "closer to stable" note shows once');
  assert.ok(!/\{\w+\}|steady\.|t143\./.test(text), 'no raw keys or placeholders');
  assert.deepEqual(errors, []);
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(w[0] <= w[1]);
  ok('no raw keys, no errors, fits 390 px');
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'steady-en.png'), fullPage: false }); }
  await ctx.close();
}
for (const [lang, re] of [['de', /näher an stabil/], ['pl', /bliżej stabilnego/], ['zh', /接近稳定/]]) {
  const { ctx, page, errors } = await open(lang);
  const text = await page.textContent('#feedbackBody');
  assert.match(text, re);
  assert.ok(!/\{\w+\}|steady\./.test(text));
  assert.deepEqual(errors, []);
  ok(lang);
  await ctx.close();
}
// Every language has every key with the same placeholders.
const src = fs.readFileSync(path.join(ROOT, 'js/shared/i18n-steady.js'), 'utf8');
const S = {}; const BB = { i18n: { extend: (c, o) => { S[c] = o.steady; } } };
new Function('window', 'BB', src)({ BB }, BB);
const keys = Object.keys(S.en);
assert.equal(Object.keys(S).length, 10);
for (const [c, o] of Object.entries(S)) {
  assert.deepEqual(Object.keys(o).sort(), keys.slice().sort(), c);
  for (const key of keys) assert.deepEqual((o[key].match(/\{\w+\}/g) || []).sort(), (S.en[key].match(/\{\w+\}/g) || []).sort(), c + '.' + key);
}
ok('ten languages, same keys and placeholders');

await browser.close();
server.close();
console.log(`\n${passed} checks passed`);
