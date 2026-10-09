#!/usr/bin/env node
/**
 * Browser check for the journal's Calendar / Life chart switch default
 * (js/journal-insights.js, James 2026-10-09): one tap switches, a double tap
 * (two taps on the same button within 350 ms) makes that view the default and
 * draws it orange, and a default saved by the old "tap the one showing"
 * gesture (localStorage bbJournalView) is kept.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-view-default.mjs
 *
 * Loads the real js/shared/i18n.js, js/journal-insights.js and css/journal.css
 * into a minimal page (the switch only needs #statsAndCalendarBlock,
 * #lifeChart and #calViewSwitch), served from the repo.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;

const HARNESS = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/journal.css">
<script src="/js/shared/i18n.js"></script></head><body>
<!-- Same order as journal.html: the switch sits above the views, so it does not move when they swap. -->
<div id="statsAndCalendarBlock"><div id="stats">stats</div>
<div id="calViewSwitch" class="seg-switch"></div><div id="chart">chart</div><div id="monthCalendar" style="height:300px">calendar</div>
<div id="lifeChart"></div></div>
<script src="/js/journal-insights.js"></script>
<script>
  var now = Date.now(), entries = [];
  for (var i = 0; i < 10; i++) entries.push({ timestamp: now - i * 864e5, mood: ['stable','low','elevated'][i % 3] });
  window.BBInsights.render(entries);
</script></body></html>`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x').pathname;
  if (u === '/__harness.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(HARNESS); return; }
  const p = path.join(ROOT, decodeURIComponent(u));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }

async function open(saved) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(saved => {
    localStorage.setItem('bbLanguage', 'en');
    if (saved) localStorage.setItem('bbJournalView', saved); else localStorage.removeItem('bbJournalView');
  }, saved);
  await page.goto(BASE + '/__harness.html');
  await page.waitForSelector('#calViewSwitch .cv-opt');
  return { ctx, page };
}
const btn = (page, v) => page.locator(`#calViewSwitch .cv-opt[data-view="${v}"]`);
const isDefault = async (page, v) => (await btn(page, v).getAttribute('data-default-view')) === 'true';
const showing = page => page.evaluate(() => document.getElementById('statsAndCalendarBlock').classList.contains('cv-life') ? 'life' : 'calendar');
const stored = page => page.evaluate(() => localStorage.getItem('bbJournalView'));

console.log('Calendar / Life chart switch');
{
  const { ctx, page } = await open(null);
  assert.equal(await showing(page), 'calendar');
  assert.ok(!(await isDefault(page, 'calendar')) && !(await isDefault(page, 'life')), 'no orange mark until a default is chosen');
  ok('fresh device: calendar, no default mark');

  await btn(page, 'life').click();
  assert.equal(await showing(page), 'life');
  assert.equal(await stored(page), null);
  await page.waitForTimeout(450);
  await btn(page, 'life').click(); // a slow second tap: NOT a double tap any more
  assert.equal(await stored(page), null, 'tapping the view already showing no longer sets the default');
  ok('one tap switches; a slow second tap on the showing view does not set a default (old gesture gone)');

  await btn(page, 'calendar').dblclick();
  assert.equal(await showing(page), 'calendar');
  assert.equal(await stored(page), 'calendar');
  assert.ok(await isDefault(page, 'calendar'));
  assert.match(await page.textContent('#calViewSwitch .cv-note'), /Now your default view/);
  const bg = await btn(page, 'calendar').evaluate(b => getComputedStyle(b).backgroundImage);
  assert.match(bg, /linear-gradient/, 'showing + default = filled orange');
  ok('double-click Calendar: it becomes the default, filled orange, announced');

  await btn(page, 'life').dblclick();
  assert.equal(await stored(page), 'life');
  assert.ok(await isDefault(page, 'life') && !(await isDefault(page, 'calendar')));
  await btn(page, 'calendar').click();
  const ring = await btn(page, 'life').evaluate(b => getComputedStyle(b).boxShadow);
  assert.match(ring, /rgba\(255, 140, 1/, 'default not showing = orange outline');
  if (process.env.SHOTS) await page.locator('#calViewSwitch').screenshot({ path: path.join(process.env.SHOTS, 'switch-outlined.png') });
  await btn(page, 'life').click();
  if (process.env.SHOTS) await page.locator('#calViewSwitch').screenshot({ path: path.join(process.env.SHOTS, 'switch-filled.png') });
  ok('double-tap on the other view moves the default; when not showing it is outlined orange');
  await ctx.close();
}
{
  const { ctx, page } = await open('life');
  assert.equal(await showing(page), 'life');
  assert.ok(await isDefault(page, 'life'));
  ok('a default saved before (bbJournalView = life) is kept: opens on the life chart, marked');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} checks passed`);
