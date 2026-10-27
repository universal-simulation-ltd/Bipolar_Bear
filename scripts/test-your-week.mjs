#!/usr/bin/env node
/**
 * Browser check for 🗓️ Your week (js/journal-week.js): the card renders with
 * the real js/shared/i18n.js + i18n-week.js (plural forms, other languages),
 * escapes nothing it shouldn't, fits a 390 px phone, and has its dark-mode
 * styles.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-your-week.mjs
 *   SHOTS=<dir> also saves screenshots.
 *
 * The rules themselves are checked without a browser by scripts/test-your-week.js.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;

// A short-sleep week that also had a low stretch: three sentences, an idea,
// the history line and the check-in lines all show.
const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/journal.css"><link rel="stylesheet" href="/css/dark.css">
<script src="/js/shared/i18n.js"></script><script src="/js/shared/i18n-week.js"></script></head>
<body style="background:var(--page-bg,#fff)"><div class="confirm-content" style="max-width:500px;margin:0 auto;padding:16px"><div id="feedbackBody"></div></div>
<script src="/js/journal-insights.js"></script><script src="/js/journal-week.js"></script>
<script>
  function day(back, x) { var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - back);
    return Object.assign({ date: d.toISOString(), timestamp: d.getTime(), mood: 'stable', sleep: 7.5 }, x); }
  var e = [];
  for (var i = 13; i >= 7; i--) e.push(day(i, { sleep: 8.5 }));
  [40, 60, 80].forEach(function (b) { e.push(day(b, { sleep: 5 })); e.push(day(b - 1, { mood: 'elevated' })); });
  e.push(day(6, { sleep: 5 }), day(5, { mood: 'manic' }), day(4, { sleep: 4.5 }), day(3, { mood: 'manic' }),
         day(2, { mood: 'depressed' }), day(1, { mood: 'low' }), day(0, { alcohol: 'yes', mood: 'stable' }));
  window.render = function () { document.getElementById('feedbackBody').innerHTML = BBWeek.cardHtml(e); };
  render();
</script></body></html>`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x').pathname;
  if (u === '/__harness.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(HARNESS); return; }
  const p = path.join(ROOT, decodeURIComponent(u));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const SHOTS = process.env.SHOTS;

const browser = await chromium.launch();
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

async function open(lang, dark) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.addInitScript((l) => localStorage.setItem('bbLanguage', l), lang);
  await page.goto(BASE + '/__harness.html');
  await page.waitForSelector('.yw-card');
  // What the pages' theme one-liner does before first paint.
  if (dark) await page.evaluate(() => document.documentElement.classList.add('theme-dark'));
  assert.deepEqual(errors, []);
  return { ctx, page };
}

console.log('🗓️ Your week');
{
  const { ctx, page } = await open('en', false);
  const text = await page.textContent('.yw-card');
  assert.match(text, /🗓️ Your week/);
  assert.match(text, /A week with some ups and downs/);
  assert.match(text, /2 short nights this week were each followed by an elevated day\./);
  assert.match(text, /Your journal shows this has happened before too\./);
  assert.match(text, /💡 Short nights came before/);
  assert.match(text, /talk to your care team/);
  assert.match(text, /Worked out on this device only\./);
  assert.ok(!/\{\w+\}|week\.[a-z][A-Za-z]+|journal\.earlyWarn/.test(text), 'no raw keys or placeholders');
  assert.equal(await page.locator('.yw-obs li').count(), 3);
  ok('English: headline, three sentences, history line, idea, check-in, device note');

  const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(w[0] <= w[1], 'no sideways scroll at 390 px');
  assert.equal(await page.locator('.yw-strat').getAttribute('href'), 'survival-kit.html#coping-strategies');
  if (SHOTS) await page.locator('.yw-card').screenshot({ path: path.join(SHOTS, 'your-week-en.png') });
  ok('fits 390 px; strategies link points at the Survival Kit');
  await ctx.close();
}
{
  const { ctx, page } = await open('en', true);
  const bg = await page.locator('.yw-card').evaluate((n) => getComputedStyle(n).backgroundColor);
  assert.notEqual(bg, 'rgb(255, 248, 239)', 'dark mode replaces the cream card');
  if (SHOTS) await page.locator('.yw-card').screenshot({ path: path.join(SHOTS, 'your-week-dark.png') });
  ok('dark mode has its own card colours');
  await ctx.close();
}
for (const [lang, re] of [['pl', /2 stabilne|razy po krótkiej nocy/], ['de', /Deine Woche/], ['zh', /你的这一周/], ['fr', /Ta semaine/]]) {
  const { ctx, page } = await open(lang, false);
  const text = await page.textContent('.yw-card');
  assert.match(text, re);
  assert.ok(!/\{\w+\}|week\.[a-z][A-Za-z]+|journal\.earlyWarn/.test(text), `${lang}: no raw keys or placeholders`);
  if (SHOTS && lang === 'pl') await page.locator('.yw-card').screenshot({ path: path.join(SHOTS, 'your-week-pl.png') });
  ok(`${lang}: translated, no raw keys`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} checks passed`);
