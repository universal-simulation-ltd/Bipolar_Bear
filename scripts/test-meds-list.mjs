#!/usr/bin/env node
/**
 * Browser checks for the medicine list in the 💊 My medicines sheet and the
 * dock's 💊 Medication button (v362, James 2026-10-20: the sheet replaces the
 * old "My Medications" window; you change the medicines and doses in it).
 *
 * A guest journal is loaded through the real pages (journal.html,
 * index.html) with Firebase stubbed out. Covers: 💊 My Meds opens the sheet
 * on Doses with "Your medicines" first (the old window is gone); add, change
 * the dose, rename and remove, each written to currentMedList and to the
 * dated medHistory (add / dose / rename / stop) and shown on the My Meds
 * button; the form refuses a missing name, a missing dose and a duplicate;
 * removing asks first. The dock: the picker offers 💊 Medication; on the home
 * page it opens the journal, which opens the sheet (not while a PIN lock is
 * up) and drops ?openMeds=1; on the journal it opens the sheet in place; the
 * sheet's "Hide this button" takes it off the dock.
 * Negative controls: a refused form and a cancelled remove change nothing;
 * the sheet stays shut while the PIN lock is showing.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-meds-list.mjs
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
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
const LJ = async (page, k) => JSON.parse(await L(page, k) || 'null');
const hubOpen = page => page.evaluate(() => !!document.querySelector('#medsHubModal.active'));
const listNames = page => page.evaluate(() => [...document.querySelectorAll('#medsHubModal .meds-cur')].map(r => r.querySelector('strong').textContent + '|' + (r.querySelector('.mr-sub')?.textContent || '')));
const events = async page => ((await LJ(page, 'medHistory')) || []).filter(e => e.type !== 'baseline').map(e => e.type + ':' + e.name + (e.from ? ':' + e.from : '') + (e.to ? '>' + e.to : ''));
async function fill(page, scope, name, dose) {
  await page.fill(scope + ' input[name="name"]', name);
  await page.fill(scope + ' input[name="dose"]', dose);
  await page.click(scope + ' button[type="submit"]');
  await page.waitForTimeout(150);
}

console.log('Your medicines, in the 💊 My medicines sheet');
{
  const { ctx, page } = await open('/journal.html');
  await page.waitForFunction(() => typeof window.showMedicationList === 'function' && window.BBMeds);
  assert.equal(await page.evaluate(() => !!document.getElementById('medicationModal')), false, 'the old My Medications window is still in the page');
  await page.evaluate(() => document.getElementById('medLabelBtn').click());
  await page.waitForSelector('#medsHubModal.active');
  assert.equal(await page.evaluate(() => document.querySelector('#medsHubModal .meds-body').dataset.tab), 'doses');
  assert.equal(await page.evaluate(() => document.querySelector('#medsHubModal .meds-body > .meds-card').classList.contains('meds-list')), true, '"Your medicines" is not the first card');
  assert.match(await page.textContent('#medsHubModal .meds-list'), /Your medicines[\s\S]*No medicines on your list yet/);
  assert.equal(await page.evaluate(() => document.querySelector('#medsHubModal .meds-add').open), true, 'the add form is not open on an empty list');
  ok('💊 My Meds opens the sheet on Doses, "Your medicines" first; the old window is gone; an empty list opens the add form');

  // Negative controls: a refused form saves nothing.
  await fill(page, '#medsHubModal .meds-add form', '', '800 mg');
  assert.match(await page.textContent('#medsHubModal .meds-add .mf-err'), /name/);
  await fill(page, '#medsHubModal .meds-add form', 'Lithium', '');
  assert.match(await page.textContent('#medsHubModal .meds-add .mf-err'), /dose/);
  assert.equal(await L(page, 'currentMedList'), null);
  ok('a missing name or dose is refused and nothing is saved');

  await fill(page, '#medsHubModal .meds-add form', 'Lithium', '800 mg');
  assert.deepEqual(await listNames(page), ['Lithium|800 mg']);
  assert.deepEqual(await LJ(page, 'currentMedList'), [{ name: 'Lithium', dosage: '800 mg' }]);
  await page.evaluate(() => document.querySelector('#medsHubModal .meds-add').open = true);
  await fill(page, '#medsHubModal .meds-add form', 'Quetiapine', '50 mg');
  assert.deepEqual(await listNames(page), ['Lithium|800 mg', 'Quetiapine|50 mg']);
  assert.match(await page.textContent('#medLabelBtn'), /2x/);
  assert.deepEqual(await events(page), ['add:Lithium>800 mg', 'add:Quetiapine>50 mg']);
  ok('adding two medicines saves the list, dates an "add" for each and updates the My Meds button (2x)');

  await page.evaluate(() => document.querySelector('#medsHubModal .meds-add').open = true);
  await fill(page, '#medsHubModal .meds-add form', 'lithium', '400 mg');
  assert.match(await page.textContent('#medsHubModal .meds-add .mf-err'), /already on your list/);
  assert.equal((await LJ(page, 'currentMedList')).length, 2);
  ok('the same medicine twice is refused (case aside)');

  // Change the dose.
  await page.click('#medsHubModal .meds-cur:nth-of-type(1) .meds-edit');
  await page.waitForSelector('#medsHubModal .meds-cur-edit');
  assert.equal(await page.inputValue('#medsHubModal .meds-cur-edit input[name="dose"]'), '800 mg');
  await page.fill('#medsHubModal .meds-cur-edit input[name="dose"]', '1000 mg');
  await page.click('#medsHubModal .meds-cur-edit button[type="submit"]');
  await page.waitForTimeout(150);
  assert.deepEqual(await listNames(page), ['Lithium|1000 mg', 'Quetiapine|50 mg']);
  assert.ok((await events(page)).includes('dose:Lithium:800 mg>1000 mg'), JSON.stringify(await events(page)));
  ok('changing Lithium from 800 mg to 1000 mg saves it and dates a "dose" change for Before / after');

  // Cancel an edit: nothing changes.
  await page.click('#medsHubModal .meds-cur:nth-of-type(2) .meds-edit');
  await page.fill('#medsHubModal .meds-cur-edit input[name="dose"]', '999 mg');
  await page.click('#medsHubModal .meds-cur-edit button[type="button"]');
  assert.deepEqual(await listNames(page), ['Lithium|1000 mg', 'Quetiapine|50 mg']);
  // Rename.
  await page.click('#medsHubModal .meds-row.meds-cur >> nth=1 >> .meds-edit');
  await page.fill('#medsHubModal .meds-cur-edit input[name="name"]', 'Seroquel');
  await page.click('#medsHubModal .meds-cur-edit button[type="submit"]');
  await page.waitForTimeout(150);
  assert.deepEqual(await listNames(page), ['Lithium|1000 mg', 'Seroquel|50 mg']);
  assert.ok((await events(page)).some(e => e.startsWith('rename:Seroquel:Quetiapine')), JSON.stringify(await events(page)));
  ok('Cancel leaves a row as it was; renaming Quetiapine to Seroquel is a "rename", not a stop and a start');

  // Remove: cancelled, then confirmed.
  page.__dialog = 'dismiss';
  await page.click('#medsHubModal .meds-row.meds-cur >> nth=1 >> .meds-rm');
  await page.waitForTimeout(150);
  assert.equal((await LJ(page, 'currentMedList')).length, 2, 'a cancelled remove removed it');
  page.__dialog = 'accept';
  await page.click('#medsHubModal .meds-row.meds-cur >> nth=1 >> .meds-rm');
  await page.waitForTimeout(150);
  assert.deepEqual(await listNames(page), ['Lithium|1000 mg']);
  assert.deepEqual(await LJ(page, 'currentMedList'), [{ name: 'Lithium', dosage: '1000 mg' }]);
  assert.ok((await events(page)).some(e => e.startsWith('stop:Seroquel')));
  assert.match(await page.textContent('#medLabelBtn'), /1x/);
  ok('removing asks first: Cancel keeps it, OK takes it off and dates a "stop"');

  // The list is still there after a reload, and the other tabs still work.
  await page.reload();
  await page.waitForFunction(() => typeof window.showMedicationList === 'function' && window.BBMeds);
  await page.evaluate(() => showMedicationList());
  await page.waitForSelector('#medsHubModal.active');
  assert.deepEqual(await listNames(page), ['Lithium|1000 mg']);
  // A redraw (tab, refresh) fills the same sheet: a new one replayed the
  // phone drawer's slide-up, so it came in twice on open and on every tap.
  await page.evaluate(() => { window._sheet = document.querySelector('#medsHubModal .meds-sheet'); });
  await page.evaluate(() => BBMeds._tab('side'));
  await page.evaluate(() => BBMeds.refresh());
  assert.equal(await page.evaluate(() => window._sheet === document.querySelector('#medsHubModal .meds-sheet')), true, 'a redraw replaced the sheet');
  assert.match(await page.textContent('#medsHubModal select[name="med"]'), /Lithium/);
  ok('after a reload the list is the same, Side effects offers the medicines on it, and a redraw keeps the same sheet');
  await ctx.close();
}

console.log('The dock\'s 💊 Medication');
{
  // The picker offers it.
  // A dock past the tutorial (unlocked) with 🆘 hidden, so a slot is free.
  const { ctx, page } = await open('/index.html', { meds: [{ name: 'Lithium', dosage: '800 mg' }], extra: { bbFabsUnlocked: '1', bbFabFirstRunDone: '1', bbWaFabHidden: '1' } });
  await page.waitForFunction(() => typeof window._openFabPicker === 'function');
  // Wait for fab.js to lay the dock out: read straight away, no + shows yet.
  const free = await (await page.waitForFunction(() => [1, 2, 3, 4].find(s => { const p = document.getElementById('fabPh' + s); return p && getComputedStyle(p).display !== 'none'; }), null, { timeout: 15000 }).catch(() => null))?.jsonValue();
  assert.ok(free, 'no empty dock slot');
  await page.evaluate(s => document.getElementById('fabPh' + s).click(), free);
  const opts = await page.evaluate(() => [...document.querySelectorAll('#bbFabPickerOptions button')].map(b => b.textContent));
  assert.ok(opts.some(x => /💊\s*Medication/.test(x)), JSON.stringify(opts));
  await page.evaluate(() => [...document.querySelectorAll('#bbFabPickerOptions button')].find(b => /Medication/.test(b.textContent)).click());
  const slots = await page.evaluate(() => [1, 2, 3, 4].map(s => localStorage.getItem('bbFabSlot_' + s)));
  assert.equal(slots[free - 1], 'meds');
  assert.equal(await page.isVisible('#medsExtraFab'), true);
  ok('"Add to dock" offers 💊 Medication, and picking it puts 💊 on the dock');

  // From the home page it opens the journal, and the journal opens the sheet.
  await page.click('#medsExtraFab');
  await page.waitForURL(/journal\.html/);
  await page.waitForSelector('#medsHubModal.active', { timeout: 15000 });
  assert.doesNotMatch(page.url(), /openMeds/);
  assert.deepEqual(await listNames(page), ['Lithium|800 mg']);
  ok('on the home page 💊 opens the journal with the sheet up, and ?openMeds=1 is dropped');

  // On the journal it opens in place; the sheet's Hide this button takes it off the dock.
  await page.evaluate(() => BBMeds.close());
  await page.click('#medsExtraFab');
  await page.waitForSelector('#medsHubModal.active');
  assert.match(page.url(), /journal\.html$/);
  await page.click('#medsHubModal .meds-dock-hide');
  assert.equal(await page.evaluate(() => [1, 2, 3, 4].some(s => localStorage.getItem('bbFabSlot_' + s) === 'meds')), false);
  assert.equal(await page.isVisible('#medsExtraFab'), false);
  assert.equal(await page.isVisible('#medsHubModal .meds-dock-hide'), false);
  ok('on the journal 💊 opens the sheet in place; its "Hide this button" takes 💊 off the dock');
  await ctx.close();
}
console.log('The dock\'s 🧰 Survival Kit and 💬 Bipolar Anonymous');
{
  const { ctx, page } = await open('/index.html', { extra: { bbFabsUnlocked: '1', bbFabFirstRunDone: '1', bbWaFabHidden: '1' } });
  await page.waitForFunction(() => typeof window._openFabPicker === 'function');
  // Wait for fab.js to lay the dock out: read straight away, no + shows yet.
  const free = await (await page.waitForFunction(() => [1, 2, 3, 4].find(s => { const p = document.getElementById('fabPh' + s); return p && getComputedStyle(p).display !== 'none'; }), null, { timeout: 15000 }).catch(() => null))?.jsonValue();
  assert.ok(free, 'no empty dock slot');
  const pick = async (re) => {
    await page.evaluate(s => document.getElementById('fabPh' + s).click(), free);
    const opts = await page.evaluate(() => [...document.querySelectorAll('#bbFabPickerOptions button')].map(b => b.textContent));
    assert.ok(opts.some(x => re.test(x)), JSON.stringify(opts));
    await page.evaluate(src => { const r = new RegExp(src); [...document.querySelectorAll('#bbFabPickerOptions button')].find(b => r.test(b.textContent)).click(); }, re.source);
  };
  // Signed out, 💬 opens the sign-in dialog and stays on the page (negative control).
  await pick(/💬\s*Bipolar Anonymous/);
  assert.equal(await page.evaluate(s => localStorage.getItem('bbFabSlot_' + s), free), 'anon');
  assert.equal(await page.isVisible('#anonExtraFab'), true);
  await page.evaluate(() => { window._authAsked = 0; window.showAuthModal = () => { window._authAsked++; }; });
  await page.click('#anonExtraFab');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window._authAsked), 1);
  assert.match(page.url(), /index\.html$/);
  ok('"Add to dock" offers 💬 Bipolar Anonymous; signed out it asks you to sign in and stays put');
  // 🧰 replaces it in the same slot (it's offered again: 💬 is no longer free) and opens the Survival Kit.
  await page.evaluate(s => localStorage.removeItem('bbFabSlot_' + s), free);
  await page.evaluate(() => window._applyFabDock && window._applyFabDock());
  await pick(/🧰\s*Survival Kit/);
  assert.equal(await page.evaluate(s => localStorage.getItem('bbFabSlot_' + s), free), 'survival');
  await page.click('#survivalExtraFab');
  await page.waitForURL(/survival-kit\.html/);
  await page.waitForSelector('#survivalExtraFab', { state: 'visible', timeout: 15000 });
  ok('"Add to dock" offers 🧰 Survival Kit, and it opens the Survival Kit (where it stays on the dock)');
  await ctx.close();
}
{
  // Negative control: not over the PIN lock.
  const { ctx, page } = await open('/journal.html?openMeds=1', { meds: [{ name: 'Lithium', dosage: '800 mg' }] });
  await page.evaluate(() => { const p = document.getElementById('pinOverlay'); p.style.display = 'flex'; p.style.visibility = 'visible'; p.style.opacity = '1'; });
  await page.waitForTimeout(2500);
  assert.equal(await hubOpen(page), false, 'the sheet opened over the PIN lock');
  await page.evaluate(() => { document.getElementById('pinOverlay').style.display = 'none'; });
  await page.waitForSelector('#medsHubModal.active', { timeout: 5000 });
  ok('negative control: ?openMeds=1 waits while the PIN lock is up, then opens the sheet');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
