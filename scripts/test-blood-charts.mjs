#!/usr/bin/env node
/**
 * Browser checks for blood results on the mood charts, the next test due
 * date, the person's own range, and the New features sheet (v358).
 *
 * A guest journal with a year of entries and lithium + TSH results is loaded
 * through the real pages (journal.html, index.html) with Firebase stubbed out.
 * Covers: the markers (only with the Settings tick; at the right dates), the
 * tooltip and its keyboard / screen-reader wiring, the line from 6M with its
 * right-hand scale and test picker, the range band (and none without a range),
 * the "had your test?" card (from the due date, gone after a result or a
 * dismissal, which is remembered), the one-time offer after the first result,
 * the New features sheet (once for an updating user, not for a fresh install,
 * not over the PIN lock or mid-entry, its switch is the Settings switch, Reset
 * brings it back, phone-only rows), and the PDF still building with markers.
 * Negative controls: the tick off draws nothing and the PDF asks for no
 * markers; no range → no band; a due date in the future → no card.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-blood-charts.mjs
 *   SHOTS=/some/dir … also saves screenshots (390 px, English + German, light + dark).
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

const browser = await chromium.launch();
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }

const DAY = 86400000;
const now0 = new Date(); now0.setHours(12, 0, 0, 0);
const key = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const ago = n => key(now0.getTime() - n * DAY);
const LITHIUM = [[150, 0.5], [110, 0.62], [70, 0.71], [40, 0.8], [10, 0.68]];
const LEVELS = LITHIUM.map(([d, v], i) => ({ id: 'b' + i, date: ago(d), test: 'Lithium', value: v, unit: 'mmol/L', updatedAt: 1 }))
  .concat([{ id: 't1', date: ago(60), test: 'TSH', value: 2.1, unit: 'mU/L', updatedAt: 1 }, { id: 't2', date: ago(20), test: 'TSH', value: 2.6, unit: 'mU/L', updatedAt: 1 }]);

/**
 * A fresh browser context seeded once (reloads keep its storage).
 * o: {days, skipYesterday, lang, theme, onboarded, chartsOn, levels, plans, range, view, extra:{k:v}, init}
 */
async function open(url, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true, colorScheme: o.theme === 'dark' ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) console.log('    pageerror:', e.message); });
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
    localStorage.setItem('bbTheme', cfg.theme || 'light');
    if (cfg.onboarded !== false) { localStorage.setItem('bbOnboardingStep', '12'); localStorage.setItem('bbHasEntries', '1'); }
    localStorage.setItem('bbJournalView', cfg.view || 'life');
    localStorage.setItem('bbJournalRange', String(cfg.range || 180));
    localStorage.setItem('bbGuestNoPin', '1');
    const moods = ['depressed', 'low', 'stable', 'stable', 'good', 'elevated'];
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const k = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    for (let i = cfg.days; i >= (cfg.skipYesterday ? 2 : 1); i--) {
      const t = now.getTime() - i * 86400000;
      localStorage.setItem('entry:' + t, JSON.stringify({ date: k(t), timestamp: t, mood: moods[i % 6], sleep: 5 + (i % 5), energy: 4, medication: 'taken' }));
    }
    if (cfg.levels) localStorage.setItem('medBloodLevels', JSON.stringify(cfg.levels));
    if (cfg.plans) localStorage.setItem('medBloodPlans', JSON.stringify(cfg.plans));
    if (cfg.chartsOn) localStorage.setItem('bbBloodOnCharts', '1');
    if (cfg.seen !== false) localStorage.setItem('bbWhatsNewSeen', '1.44');
    Object.keys(cfg.extra || {}).forEach(x => localStorage.setItem(x, cfg.extra[x]));
  }, { days: o.days == null ? 400 : o.days, ...o });
  await page.goto(BASE + url);
  await page.waitForFunction(() => window.BB && typeof BB.t === 'function');
  return { ctx, page };
}
async function openJournalCard(page) {
  await page.waitForFunction(() => typeof window.toggleJournal === 'function' && document.getElementById('journalToggleSection')?.style.display !== 'none', null, { timeout: 15000 });
  await page.evaluate(() => toggleJournal());
  await page.waitForSelector('#lifeChart .lc-svg', { state: 'attached', timeout: 15000 });
  await page.waitForTimeout(400);
}
async function chartState(page) {
  return page.evaluate(() => {
    const plot = document.querySelector('#lifeChart .lc-plot');
    const marks = [...document.querySelectorAll('#lifeChart .lc-blood')].map(b => ({ date: b.dataset.date, test: b.dataset.test, label: b.getAttribute('aria-label'), x: b.offsetLeft + b.offsetWidth / 2 }));
    return {
      first: plot && plot.dataset.first, px: plot && Number(plot.dataset.px), marks,
      line: !!document.querySelector('#lifeChart .lc-bline'), right: !!document.querySelector('#lifeChart .lc-yright'),
      band: !!document.querySelector('#lifeChart .lc-bband'),
      pick: [...document.querySelectorAll('#lcBloodPick option')].map(o => o.value),
      legend: document.querySelector('#lifeChart .lc-legend')?.textContent || '',
    };
  });
}
const shot = async (page, name, el) => {
  if (!SHOTS) return;
  await page.waitForTimeout(450); // let sheets finish sliding in
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = path.join(SHOTS, name + '.png');
  if (el) await page.locator(el).first().screenshot({ path: p }); else await page.screenshot({ path: p });
};

// Settings → Advanced (an index since v365) → 📊 Stats. Walk it as a person
// would.
const openStatsSettings = (page) => page.evaluate(() => { openAdvancedSettings(); _openSettingsPage('stats'); });

console.log('Blood results on the charts');
{
  // Negative control: the tick is off by default → nothing on the chart.
  const { ctx, page } = await open('/journal.html', { levels: LEVELS, seen: true });
  await openJournalCard(page);
  let st = await chartState(page);
  assert.equal(st.marks.length, 0, 'markers drawn with the tick off');
  assert.ok(!st.line && !st.right && !st.band, 'line / scale / band drawn with the tick off');
  assert.equal(await page.evaluate(() => BBMeds.chartData()), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('bbBloodOnCharts')), null);
  ok('negative control: unticked by default, so no 🩸, no line, no band (0 markers)');

  // Tick it in ⚙️ Settings → Stats (moved off the main page in v360, with
  // Incognito Mode: the settings that change stats or exports live there).
  await page.evaluate(() => showSettingsModal());
  assert.equal(await page.isVisible('#bloodChartsRow'), false, 'blood row still on the main Settings page');
  await openStatsSettings(page);
  await page.waitForSelector('#bloodChartsRow', { state: 'visible' });
  assert.equal(await page.evaluate(() => ['bloodChartsRow', 'incognitoModeToggle', 'statsStartDateInput']
    .every(id => document.getElementById('settingsAdvancedMorePanel').contains(document.getElementById(id)))), true,
    'blood, Incognito and the stats start date are not all on the Stats page');
  assert.equal(await page.evaluate(() => document.getElementById('settingsAdvancedJournalPanel').contains(document.getElementById('incognitoModeToggle'))), false);
  ok('Settings: the blood switch and Incognito Mode are on the Stats page (not the main page or Journal Options)');
  assert.equal(await page.isChecked('#bloodChartsToggle'), false);
  await page.click('#bloodChartsRow .bb-switch');
  assert.equal(await page.evaluate(() => localStorage.getItem('bbBloodOnCharts')), '1');
  await page.evaluate(() => closeSettingsModal());
  await page.waitForTimeout(300);
  st = await chartState(page);
  // 6M range, a year of entries: the chart spans every day from the first
  // entry, so all seven results are on it.
  assert.equal(st.marks.length, 7, 'markers: ' + st.marks.length);
  const firstMs = new Date(st.first + 'T12:00:00').getTime();
  for (const m of st.marks) {
    const idx = Math.round((new Date(m.date + 'T12:00:00').getTime() - firstMs) / DAY);
    assert.ok(m.x >= idx * st.px - 0.5 && m.x <= (idx + 1) * st.px + 0.5, `marker ${m.date} at x=${m.x}, day ${idx} spans ${idx * st.px}–${(idx + 1) * st.px}`);
  }
  assert.deepEqual(st.marks.map(m => m.date), LEVELS.map(l => l.date).sort());
  ok('ticking "Show blood results on my charts" in Settings draws a 🩸 on each result\'s day (7 of 7, each inside its day\'s column)');

  // Tooltip: click, and keyboard focus.
  const last = await page.$('#lifeChart .lc-blood[data-date="' + ago(10) + '"]');
  const label = await last.getAttribute('aria-label');
  assert.match(label, /^Lithium 0\.68 mmol\/L · /);
  await last.click();
  const tip = await page.evaluate(() => { const t = document.getElementById('lcBloodTip'); return { hidden: t.hidden, text: t.textContent, detail: document.querySelector('#lifeChart .lc-detail').textContent }; });
  assert.equal(tip.hidden, false); assert.equal(tip.text, label); assert.equal(tip.detail, label);
  await shot(page, 'blood-tooltip-en-light', '#lifeChart');
  await page.evaluate(() => document.getElementById('lcBloodTip').hidden = true);
  await page.focus('#lifeChart .lc-blood[data-date="' + ago(150) + '"]');
  const tip2 = await page.evaluate(() => ({ hidden: document.getElementById('lcBloodTip').hidden, text: document.getElementById('lcBloodTip').textContent, desc: document.activeElement.getAttribute('aria-describedby'), tag: document.activeElement.tagName }));
  assert.equal(tip2.hidden, false); assert.match(tip2.text, /^Lithium 0\.5 mmol\/L · /); assert.equal(tip2.desc, 'lcBloodTip'); assert.equal(tip2.tag, 'BUTTON');
  ok('tapping a 🩸 shows "' + label + '" (also in the live line); keyboard focus shows it, aria-label + aria-describedby');

  // The line: 6M has it, lithium first, a picker for TSH; 1M has markers only.
  assert.ok(st.line && st.right, 'line + right-hand scale at 6M');
  assert.deepEqual(st.pick, ['Lithium', 'TSH']);
  assert.match(st.legend, /Lithium \(mmol\/L\), right-hand scale/);
  assert.ok(!st.band, 'no band without a range (negative)');
  await page.selectOption('#lcBloodPick', 'TSH');
  await page.waitForTimeout(200);
  st = await chartState(page);
  assert.match(st.legend, /TSH \(mU\/L\)/); assert.equal(await page.evaluate(() => localStorage.getItem('bbBloodChartTest')), 'TSH');
  await page.selectOption('#lcBloodPick', 'Lithium');
  ok('from 6M: one test joined by a line on its own right-hand scale, lithium first, picker switches to TSH');

  // A range typed in on the Blood levels tab → shaded on both charts.
  await page.evaluate(() => BBMeds.open('blood'));
  await page.waitForSelector('#medsHubModal.active');
  const det = '#medsHubModal details[data-plan="t:lithium"]';
  await page.click(det + ' summary');
  await page.fill(det + ' input[name="low"]', '0,6');
  await page.fill(det + ' input[name="high"]', '0.4');
  await page.click(det + ' button[type="submit"]');
  assert.match(await page.textContent(det + ' .mf-err'), /lower number first/);
  await page.fill(det + ' input[name="high"]', '0.8');
  await page.click(det + ' button[type="submit"]');
  await page.waitForSelector('#medsHubModal .mc-band');
  const plan = await page.evaluate(() => BB.medLog.list('bloodPlans')[0]);
  assert.equal(plan.low, 0.6); assert.equal(plan.high, 0.8); assert.equal(plan.id, 't:lithium');
  assert.match(await page.textContent('#medsHubModal .meds-body'), /Your range: 0\.6–0\.8 mmol\/L/);
  await page.evaluate(() => BBMeds.close());
  await page.waitForTimeout(200);
  st = await chartState(page);
  assert.ok(st.band, 'band on the life chart');
  assert.match(st.legend, /Your range/);
  ok('the person\'s own range (0.6–0.8, a decimal comma read) is shaded on the Blood levels chart and behind the line; a bad range is refused');

  // 1M: markers only.
  await page.evaluate(() => { localStorage.setItem('bbJournalRange', '30'); });
  await page.reload();
  await openJournalCard(page);
  st = await chartState(page);
  assert.ok(st.marks.length >= 1 && !st.line && !st.right, '1M: ' + JSON.stringify({ m: st.marks.length, line: st.line }));
  ok('at 1M: markers only, no line (' + st.marks.length + ' markers in view)');
  await ctx.close();
}

console.log('Next test due');
{
  const { ctx, page } = await open('/journal.html', { levels: LEVELS, seen: true, plans: [{ id: 't:lithium', test: 'Lithium', due: ago(-1), updatedAt: 1 }] });
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => document.getElementById('bloodDueSlot').textContent), '', 'card before the due date');
  ok('negative control: due tomorrow → no card yet');
  await page.evaluate(d => BBMeds.putPlan('Lithium', { due: d }).then(() => BBMeds.renderDueCard()), ago(0));
  assert.match(await page.textContent('#bloodDueSlot'), /Had your lithium test\?/);
  ok('on the due date the card shows: "Had your lithium test?"');
  await shot(page, 'blood-due-card-en-light');
  // Its button opens the Blood levels tab with the form ready.
  await page.click('#bloodDueSlot .bd-btn');
  await page.waitForSelector('#medsHubModal.active');
  const form = await page.evaluate(() => ({ tab: document.querySelector('#medsHubModal .meds-body').dataset.tab, test: document.querySelector('#medsBlAdd input[name=test]').value, focus: document.activeElement && document.activeElement.name }));
  assert.deepEqual(form, { tab: 'blood', test: 'Lithium', focus: 'value' });
  ok('"Add the result" opens Blood levels with Lithium filled in and the value box focused');
  // A result dated on the due day (with the next due date) → card gone.
  await page.fill('#medsBlAdd input[name=value]', '0.7');
  await page.fill('#medsBlAdd input[name=nextDue]', ago(-90));
  await page.click('#medsBlAdd button[type=submit]');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.getElementById('bloodDueSlot').textContent), '');
  const p1 = await page.evaluate(() => BB.medLog.list('bloodPlans').find(p => p.id === 't:lithium'));
  assert.equal(p1.due, ago(-90));
  ok('adding a result dated on/after the due date removes the card; "Next test due" in the form saves the next date');
  await shot(page, 'blood-tab-after-save-en-light');
  await page.evaluate(() => BBMeds.close());
  // Overdue again, then dismissed: gone, and stays gone after a reload.
  const rid = await page.evaluate(() => BB.medLog.list('bloodLevels').find(x => x.value === 0.7).id);
  await page.evaluate(id => BB.medLog.remove('bloodLevels', id), rid);
  await page.evaluate(d => BBMeds.putPlan('Lithium', { due: d }).then(() => BBMeds.renderDueCard()), ago(1));
  assert.match(await page.textContent('#bloodDueSlot'), /Had your lithium test\?/);
  await page.click('#bloodDueSlot .bd-x');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => document.getElementById('bloodDueSlot').textContent), '');
  const p2 = await page.evaluate(() => BB.medLog.list('bloodPlans').find(p => p.id === 't:lithium'));
  assert.equal(p2.dismissed, p2.due);
  await page.reload();
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => document.getElementById('bloodDueSlot').textContent), '');
  ok('dismissing hides it and is remembered for that due date (after a reload too)');
  await ctx.close();
}
{
  // While the day's entry steps are up the page shows only them: the card's
  // slot is not visible (not in the entry steps).
  const { ctx, page } = await open('/journal.html', { levels: LEVELS, skipYesterday: true, seen: true, plans: [{ id: 't:lithium', test: 'Lithium', due: ago(3), updatedAt: 1 }] });
  await page.waitForSelector('#focusedModeCard', { state: 'visible', timeout: 15000 });
  const vis = await page.evaluate(() => { const el = document.getElementById('bloodDueSlot'); return !!el.textContent && el.getBoundingClientRect().height > 0 && el.offsetParent !== null; });
  assert.equal(vis, false);
  ok('not shown inside the daily entry steps');
  await ctx.close();
}

console.log('Offer once after the first result');
{
  const { ctx, page } = await open('/journal.html', { seen: true });
  await page.evaluate(() => BBMeds.open('blood'));
  await page.fill('#medsBlAdd input[name=value]', '0.6');
  await page.click('#medsBlAdd button[type=submit]');
  await page.waitForSelector('.bl-offer');
  assert.match(await page.textContent('.bl-offer'), /Show this on your mood charts\?/);
  await shot(page, 'blood-offer-en-light');
  await page.click('.bl-offer .meds-btn.primary');
  assert.equal(await page.evaluate(() => localStorage.getItem('bbBloodOnCharts')), '1');
  await page.evaluate(() => BB.bloodCharts.set(false));
  await page.fill('#medsBlAdd input[name=value]', '0.7');
  await page.click('#medsBlAdd button[type=submit]');
  await page.waitForTimeout(300);
  assert.equal(await page.$('.bl-offer'), null, 'offered again');
  ok('the first saved result asks "Show this on your mood charts?" (Yes ticks it); never again');
  await ctx.close();
}

console.log('New features sheet');
{
  // An updating user (onboarding done), journal idle → shown once.
  const { ctx, page } = await open('/journal.html', { seen: false, levels: LEVELS });
  await page.waitForSelector('.bbwn-back', { timeout: 15000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll('.bbwn-item')].map(li => ({ id: li.dataset.id, sw: !!li.querySelector('input'), on: !!li.querySelector('input:checked') })));
  assert.deepEqual(rows, [{ id: 'bloodCharts', sw: true, on: false }], 'web: only the blood switch, unticked: ' + JSON.stringify(rows));
  assert.match(await page.textContent('.bbwn-sheet'), /New features[\s\S]*New in 1\.44[\s\S]*You can change these any time in Settings/);
  assert.equal(await page.evaluate(() => localStorage.getItem('bbWhatsNewSeen')), '1.44');
  ok('an updating user sees "New features · New in 1.44" once the journal is idle; web shows only the blood switch, unticked');
  await shot(page, 'whatsnew-en-light');
  // Its switch is the Settings setting.
  await page.click('.bbwn-sw');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => localStorage.getItem('bbBloodOnCharts')), '1');
  await page.click('.bbwn-done');
  await page.evaluate(() => showSettingsModal());
  await openStatsSettings(page);
  assert.equal(await page.isChecked('#bloodChartsToggle'), true);
  await page.click('#bloodChartsRow .bb-switch');
  assert.equal(await page.evaluate(() => BB.bloodCharts.isOn()), false);
  await page.evaluate(() => closeSettingsModal());
  ok('its switch and the Settings switch are one setting (bbBloodOnCharts) both ways');
  await page.reload();
  await page.waitForTimeout(5000);
  assert.equal(await page.$('.bbwn-back'), null, 'shown twice');
  ok('not shown again after a reload');
  // Reset settings brings it back.
  await page.evaluate(() => confirmResetSettings());
  assert.equal(await page.evaluate(() => localStorage.getItem('bbWhatsNewSeen')), null);
  await page.reload();
  await page.waitForSelector('.bbwn-back', { timeout: 15000 });
  ok('Reset settings brings it back');
  await ctx.close();
}
{
  // A fresh install (onboarding not done): marked seen, never shown.
  const { ctx, page } = await open('/journal.html', { seen: false, onboarded: false, days: 0 });
  await page.waitForFunction(() => localStorage.getItem('bbWhatsNewSeen') === '1.44', null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  assert.equal(await page.$('.bbwn-back'), null);
  ok('a fresh install marks it seen without showing it');
  await ctx.close();
}
{
  // Mid-entry (yesterday's steps on screen): waits.
  const { ctx, page } = await open('/journal.html', { seen: false, skipYesterday: true });
  await page.waitForSelector('#focusedModeCard', { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(6000);
  assert.equal(await page.$('.bbwn-back'), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('bbWhatsNewSeen')), null);
  ok('not while the day\'s entry steps are up (still unseen after 6 s)');
  await ctx.close();
}
{
  // Over the home PIN lock: waits until it is unlocked.
  const { ctx, page } = await open('/index.html', { seen: false, extra: { bbGuestPinSalt: 'c2FsdA==' } });
  await page.waitForFunction(() => document.getElementById('guestPinOverlay')?.style.display === 'flex', null, { timeout: 15000 });
  await page.waitForTimeout(6000);
  assert.equal(await page.$('.bbwn-back'), null, 'over the PIN lock');
  assert.equal(await page.evaluate(() => localStorage.getItem('bbWhatsNewSeen')), null);
  await page.evaluate(() => { document.getElementById('guestPinOverlay').style.display = 'none'; });
  await page.waitForSelector('.bbwn-back', { timeout: 15000 });
  ok('home: never over the PIN lock; it comes once the lock is gone and the screen is idle');
  await ctx.close();
}
{
  // Phone-only rows, through the real registry (bioMode / bioType stand in
  // for a PIN-locked iPhone with Face ID).
  const { ctx, page } = await open('/journal.html', { seen: true, lang: 'en' });
  const r = await page.evaluate(() => {
    const ids = ctx => BB.whatsNew.create({ releases: BB.whatsNew.bearReleases(ctx), seenKey: '__t' }).items().map(i => i.id + (i.setting ? ':switch' : ':note'));
    return {
      phone: ids({ bioMode: () => 'native', bioType: 'face', isNative: () => true }),
      phoneNoPin: ids({ bioMode: () => null, bioType: 'face', isNative: () => true }),
      phoneNoBio: ids({ bioMode: () => 'guest', bioType: null, isNative: () => true }),
      web: ids({ bioMode: () => null, bioType: null, isNative: () => false }),
    };
  });
  assert.deepEqual(r.phone, ['bloodCharts:switch', 'bioUnlock:switch', 'moodButtons:note']);
  assert.deepEqual(r.phoneNoPin, ['bloodCharts:switch', 'moodButtons:note']);
  assert.deepEqual(r.phoneNoBio, ['bloodCharts:switch', 'moodButtons:note']);
  assert.deepEqual(r.web, ['bloodCharts:switch']);
  // The Face ID row: its label, and a failed scan leaves it off with a message.
  await page.evaluate(() => {
    BB.bioUnlock.turnOn = () => Promise.resolve('failed');
    BB.whatsNew.create({ releases: BB.whatsNew.bearReleases({ bioMode: () => 'native', bioType: 'face', isNative: () => true }), seenKey: '__t2' }).show();
  });
  assert.match(await page.textContent('.bbwn-item[data-id="bioUnlock"]'), /Unlock with Face ID/);
  assert.match(await page.textContent('.bbwn-item[data-id="moodButtons"]'), /Tap a mood on the daily reminder/);
  assert.equal(await page.$('.bbwn-item[data-id="moodButtons"] input'), null);
  await shot(page, 'whatsnew-phone-en-light');
  await page.click('.bbwn-item[data-id="bioUnlock"] .bbwn-sw');
  await page.waitForTimeout(100);
  assert.equal(await page.isChecked('.bbwn-item[data-id="bioUnlock"] input'), false);
  assert.match(await page.textContent('.bbwn-item[data-id="bioUnlock"] .bbwn-msg'), /didn’t recognise you/);
  ok('phone rows: Face ID only with a PIN lock + biometrics, the mood buttons as a note with no switch, web shows neither; a failed scan stays off');
  await ctx.close();
}

console.log('PDF');
for (const on of [false, true]) {
  const { ctx, page } = await open('/journal.html', { levels: LEVELS, seen: true, chartsOn: on });
  await page.waitForFunction(() => typeof window.exportPDF === 'function' && window.BBMeds);
  await page.evaluate(() => {
    window.__marks = null;
    const orig = BBMeds.markersIn;
    BBMeds.markersIn = function () { const r = orig.apply(this, arguments); window.__marks = r.length; return r; };
  });
  await page.evaluate(() => window.exportPDF());
  await page.waitForSelector('#pdfExportModal.active');
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#pdfExportModal .confirm-btn-yes');
  const file = await download;
  const head = fs.readFileSync(await file.path()).subarray(0, 5).toString();
  if (SHOTS && on) fs.copyFileSync(await file.path(), path.join(SHOTS, 'report-with-blood.pdf'));
  assert.equal(head, '%PDF-');
  const marks = await page.evaluate(() => window.__marks);
  if (on) assert.equal(marks, 7, 'PDF markers: ' + marks); else assert.equal(marks, null, 'PDF asked for markers with the tick off');
  ok(on ? 'the PDF still builds with the tick on, and its 12-month mood chart gets the 7 results' : 'negative control: tick off, the PDF builds and asks for no markers');
  await ctx.close();
}

if (SHOTS) {
  console.log('Screenshots (390 px)');
  for (const lang of ['en', 'de']) {
    for (const theme of ['light', 'dark']) {
      const tag = lang + '-' + theme;
      const { ctx, page } = await open('/journal.html', { lang, theme, levels: LEVELS, seen: false, plans: [{ id: 't:lithium', test: 'Lithium', due: ago(2), low: 0.6, high: 0.8, updatedAt: 1 }] });
      await page.waitForSelector('.bbwn-back', { timeout: 15000 });
      await shot(page, 'whatsnew-' + tag);
      await page.click('.bbwn-sw'); // turn it on here, as a person would
      await page.click('.bbwn-done');
      await shot(page, 'due-card-' + tag);
      await openJournalCard(page);
      await page.click('#lifeChart .lc-blood[data-date="' + ago(40) + '"]');
      await (await page.$('#lifeChart')).scrollIntoViewIfNeeded();
      await shot(page, 'life-chart-' + tag, '#lifeChart');
      await page.evaluate(() => BBMeds.open('blood'));
      await page.click('#medsHubModal details[data-plan="t:lithium"] summary');
      await shot(page, 'blood-tab-' + tag);
      await page.evaluate(() => { BBMeds.close(); showSettingsModal(); });
      await openStatsSettings(page);
      await (await page.$('#bloodChartsRow')).scrollIntoViewIfNeeded();
      await shot(page, 'settings-' + tag, '#settingsContent');
      await ctx.close();
      console.log('  saved ' + tag);
    }
  }
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
