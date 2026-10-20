#!/usr/bin/env node
/**
 * Browser checks for the 12 month boxes under Your Journey's calendar
 * (James, 2026-10-20): tapping a month sets the stats' window — that month
 * and as many months before it as the range (1M = the month, 3M = it and the
 * 2 before) — and opens the month in the calendar.
 *
 * A guest journal is loaded through the real journal.html with Firebase
 * stubbed out. Covers: 12 boxes, oldest first, ending with this month; a gap
 * shows "logged/days", a full month ✓; tapping a month at 1M gives exactly
 * that month's entries in the stats (and its name in the stat labels); 3M
 * keeps the month and adds the 2 before; "Back to today" returns to the last
 * 30 days; a reload starts from today; months before the first entry are
 * greyed out and can't be picked.
 * Negative controls: before any tap no box is pressed and the stats are the
 * last 30 days; a greyed-out month changes nothing.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-journey-months.mjs
 *   SHOTS=/some/dir … also saves screenshots (390 px, light + dark).
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
function ok(name) { passed++; console.log('  ✓ ' + name); }

const today = new Date(); today.setHours(12, 0, 0, 0);
const monthOf = back => new Date(today.getFullYear(), today.getMonth() - back, 1);
const key = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
// The 15th of two months ago is left out, so that month is not complete.
const GAP = key(new Date(monthOf(2).getFullYear(), monthOf(2).getMonth(), 15));

async function open(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', colorScheme: o.theme === 'dark' ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) console.log('    pageerror:', e.message); });
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
    localStorage.setItem('bbTheme', cfg.theme || 'light');
    localStorage.setItem('bbOnboardingStep', '12'); localStorage.setItem('bbHasEntries', '1');
    localStorage.setItem('bbJournalView', 'calendar');
    localStorage.setItem('bbJournalRange', '30');
    localStorage.setItem('bbGuestNoPin', '1');
    localStorage.setItem('bbWhatsNewSeen', '1.44');
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const k = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    for (let i = cfg.days; i >= 1; i--) {
      const t = now.getTime() - i * 86400000;
      if (k(t) === cfg.gap) continue;
      localStorage.setItem('entry:' + t, JSON.stringify({ date: k(t), timestamp: t, mood: 'stable', sleep: 7, energy: 5, medication: 'taken' }));
    }
  }, { days: 400, gap: GAP, ...o });
  await page.goto(BASE + '/journal.html');
  await page.waitForFunction(() => typeof window.toggleJournal === 'function' && document.getElementById('journalToggleSection')?.style.display !== 'none', null, { timeout: 15000 });
  await page.evaluate(() => toggleJournal());
  await page.waitForSelector('#monthCalendar .jm-box', { timeout: 15000 });
  return { ctx, page };
}
const boxes = page => page.evaluate(() => [...document.querySelectorAll('#monthCalendar .jm-box')].map(b => ({
  name: b.querySelector('.jm-name').textContent, sub: b.querySelector('.jm-sub').textContent, on: b.getAttribute('aria-pressed') === 'true', off: b.disabled,
})));
/** The days the stats are made from (the mood stat's list), as date keys. */
async function statDays(page) {
  const days = await page.evaluate(() => {
    showStatDetail('mood');
    const n = document.querySelectorAll('#statDetailBody > div').length;
    document.getElementById('statDetailModal').classList.remove('active');
    return n;
  });
  return days;
}
const statLabels = page => page.evaluate(() => document.getElementById('stats').textContent);
const calTitle = page => page.evaluate(() => document.querySelector('#monthCalendar button[onclick="openCalMonthPicker()"]').textContent.trim());
const daysIn = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const longName = d => d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const shortName = d => d.toLocaleDateString('en-GB', { month: 'short' });
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.locator('#monthCalendar').screenshot({ path: path.join(SHOTS, name + '.png') }); };

console.log('Your Journey: the 12 month boxes');
{
  const { ctx, page } = await open();
  let b = await boxes(page);
  assert.equal(b.length, 12);
  assert.deepEqual(b.map(x => x.name), Array.from({ length: 12 }, (_, i) => shortName(monthOf(11 - i))));
  assert.equal(b[9].sub, `${daysIn(monthOf(2)) - 1}/${daysIn(monthOf(2))}`, 'the month with a gap: ' + JSON.stringify(b[9]));
  assert.equal(b[8].sub, '✓');
  assert.ok(b.every(x => !x.on && !x.off));
  assert.match(await page.textContent('#monthCalendar .jm-head'), /Tap a month/);
  // Negative control: before a tap, the stats are the last 30 days (today not logged).
  assert.equal(await statDays(page), 29);
  ok('12 boxes, oldest first, ending with this month; the month with a gap says 29/30-style, a full one ✓; nothing picked yet and the stats are the last 30 days');
  await shot(page, 'months-light');

  // 1M: tap two months ago → exactly that month.
  await page.click('#monthCalendar .jm-box >> nth=9');
  b = await boxes(page);
  assert.deepEqual(b.map((x, i) => x.on ? i : -1).filter(i => i >= 0), [9]);
  assert.equal(await statDays(page), daysIn(monthOf(2)) - 1);
  assert.match(await statLabels(page), new RegExp(longName(monthOf(2))));
  assert.match(await page.textContent('#monthCalendar .jm-head'), new RegExp('Stats above: ' + longName(monthOf(2)) + '[\\s\\S]*Back to today'));
  assert.equal(await calTitle(page), longName(monthOf(2)));
  ok(`1M, tap ${shortName(monthOf(2))}: the stats are that month only (${daysIn(monthOf(2)) - 1} entries), named in the labels; the calendar opens on it`);
  await shot(page, 'months-1m-picked');

  // 3M: the same month and the 2 before.
  await page.evaluate(() => tapJournalRange(90));
  await page.waitForTimeout(150);
  b = await boxes(page);
  assert.deepEqual(b.map((x, i) => x.on ? i : -1).filter(i => i >= 0), [7, 8, 9]);
  assert.equal(await statDays(page), daysIn(monthOf(4)) + daysIn(monthOf(3)) + daysIn(monthOf(2)) - 1);
  assert.match(await page.textContent('#monthCalendar .jm-head'), new RegExp(shortName(monthOf(4)) + '.*–.*' + shortName(monthOf(2))));
  ok('3M keeps the picked month and adds the 2 before it (3 boxes outlined, 3 months of entries)');

  // Tapping another month at 3M moves the window.
  await page.click('#monthCalendar .jm-box >> nth=5');
  b = await boxes(page);
  assert.deepEqual(b.map((x, i) => x.on ? i : -1).filter(i => i >= 0), [3, 4, 5]);
  assert.equal(await statDays(page), daysIn(monthOf(8)) + daysIn(monthOf(7)) + daysIn(monthOf(6)));
  ok('at 3M, tapping another month moves the 3-month window to end with it');

  // Back to today.
  await page.click('#monthCalendar .jm-reset');
  b = await boxes(page);
  assert.ok(b.every(x => !x.on));
  // The last 90 days, today not logged; the gap day may fall inside them.
  const since90 = new Date(today); since90.setDate(since90.getDate() - 89);
  assert.equal(await statDays(page), 89 - (GAP >= key(since90) ? 1 : 0));
  assert.doesNotMatch(await statLabels(page), new RegExp(longName(monthOf(6))));
  ok('"Back to today" returns to the last 3 months counted back from today');

  // A reload starts from today again.
  await page.click('#monthCalendar .jm-box >> nth=10');
  await page.reload();
  await page.waitForFunction(() => typeof window.toggleJournal === 'function' && document.getElementById('journalToggleSection')?.style.display !== 'none', null, { timeout: 15000 });
  await page.evaluate(() => toggleJournal());
  await page.waitForSelector('#monthCalendar .jm-box');
  assert.ok((await boxes(page)).every(x => !x.on));
  ok('a picked month is not kept: a reload starts from today');

  // Energy reads against 5 = normal, never "x/10" (James, 2026-10-20).
  const en = await page.evaluate(() => [0, 3, 4, 5, 6.6, 7.4, 10, '5.0'].map(v => _energyStr(v)));
  assert.deepEqual(en, ['0 (Not enough)', '3 (Less than usual)', '4 (Normal)', '5 (Normal)', '6.6 (More than usual)', '7.4 (More than usual)', '10 (Too much)', '5 (Normal)']);
  await page.evaluate(() => showStatDetail('energy'));
  const eb = await page.textContent('#statDetailBody');
  assert.ok(/\(Normal\)/.test(eb) && !/\/10/.test(eb), eb.slice(0, 120));
  ok('energy reads "5 (Normal)", "7.4 (More than usual)"… against 5 = normal, and the energy list has no "/10"');
  await ctx.close();
}
{
  // A journal begun about 100 days ago: the older months are greyed out.
  const { ctx, page } = await open({ days: 100 });
  const b = await boxes(page);
  const first = new Date(today.getTime() - 100 * 86400000);
  const offCount = b.filter(x => x.off).length;
  const expectOff = 12 - ((today.getFullYear() - first.getFullYear()) * 12 + today.getMonth() - first.getMonth() + 1);
  assert.equal(offCount, expectOff, JSON.stringify(b));
  assert.ok(b.slice(0, offCount).every(x => x.off && x.sub === '–'));
  const before = await statDays(page);
  await page.evaluate(() => document.querySelector('#monthCalendar .jm-box').click());
  assert.ok((await boxes(page)).every(x => !x.on));
  assert.equal(await statDays(page), before);
  ok(`months before the first entry (${offCount}) are greyed out with "–", and tapping one changes nothing (negative control)`);
  await ctx.close();
}
if (SHOTS) {
  const { ctx, page } = await open({ theme: 'dark' });
  await page.evaluate(() => tapJournalRange(90));
  await page.click('#monthCalendar .jm-box >> nth=9');
  await shot(page, 'months-3m-dark');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
