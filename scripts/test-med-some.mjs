#!/usr/bin/env node
/**
 * Browser checks for 🤏 Some on the medication question (2026-10-25, James:
 * "a way to log if you only took some of your medication without
 * interrupting normal journaling").
 *
 * A guest journal through the real journal.html (Firebase stubbed out), at
 * 390 px. Covers: Taken and No are still one tap in focus mode (no sheet,
 * the step moves on); 🤏 Some sits between Unsure and Taken; it opens "Which
 * did you take?" with each medicine's usual dose filled in; a lower dose is
 * saved to the day's entry (medSome, medDoses, medAmounts; `medication`
 * stays 'taken' for older builds); reload keeps it; the old Yes/No entries
 * still load; the life chart gets a 💊 marker "Quetiapine 100 mg (usual 200
 * mg)" and the Doses tab a "Different doses" row; closing the sheet without
 * Done still records Some (no detail, `medication` 'not-taken'); a dose
 * that isn't a number is refused; with no medicines the sheet offers My
 * medicines and the answer stays Some; the classic form has the four
 * answers and a "Which ones?" line; a guest with a PIN stores it encrypted
 * (nothing in the clear) and it decrypts with the detail; German.
 * Negative controls: Taken / No never open the sheet; old entries have no
 * medSome; the chart has no 💊 before a Some day.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-med-some.mjs
 *   SHOTS=<dir> also saves screenshots.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';

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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MEDS = [{ name: 'Quetiapine', dosage: '200 mg' }, { name: 'Lithium', dosage: '800 mg' }];
const DAY = 86400000;
const noon = new Date(); noon.setHours(12, 0, 0, 0);
const keyOf = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const YESTERDAY = keyOf(noon.getTime() - DAY);

/**
 * A fresh context seeded once (reloads keep its storage).
 * o: {days, meds, lang, fm (focus mode, default on), local:{}, session:{}, touch}
 */
async function open(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: !!o.touch, isMobile: !!o.touch, acceptDownloads: true });
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
    localStorage.setItem('bbWhatsNewSeen', '1.45'); localStorage.setItem('bbWelcomeShown', '1');
    localStorage.setItem('bbJournalView', 'life');
    localStorage.setItem('bbJournalRange', '30');
    localStorage.setItem('focusedModeEnabled', cfg.fm === false ? '0' : '1');
    if (!(cfg.local && cfg.local.bbGuestPinSalt)) localStorage.setItem('bbGuestNoPin', '1');
    const moods = ['low', 'stable', 'stable', 'elevated'];
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const k = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    // Old entries: the single Yes / No answer only (yesterday left open).
    for (let i = cfg.days; i >= 2; i--) {
      const t = now.getTime() - i * 86400000;
      localStorage.setItem('entry:' + t, JSON.stringify({ date: k(t), timestamp: t, mood: moods[i % 4], sleep: 6 + (i % 3), energy: 5, medication: i % 7 ? 'taken' : 'not-taken' }));
    }
    if (cfg.meds) localStorage.setItem('currentMedList', JSON.stringify(cfg.meds));
    Object.keys(cfg.local || {}).forEach(x => localStorage.setItem(x, cfg.local[x]));
    Object.keys(cfg.session || {}).forEach(x => sessionStorage.setItem(x, cfg.session[x]));
  }, { days: o.days == null ? 20 : o.days, ...o });
  await page.goto(BASE + '/journal.html');
  await page.waitForFunction(() => window.BB && typeof BB.t === 'function' && window.BBMeds && typeof window._fmGoTo === 'function', null, { timeout: 20000 });
  return { ctx, page };
}
const shot = async (page, name) => {
  if (!SHOTS) return;
  await sleep(450);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
};
const sheetOpen = page => page.evaluate(() => !!document.querySelector('#medsSomeModal.active'));
/** The entry stored for a day (a guest without a PIN keeps plain JSON). */
const entryFor = (page, day) => page.evaluate(d => {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('entry:')) continue;
    try { const e = JSON.parse(localStorage.getItem(k)); const dt = new Date(e.date); const kk = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); if (kk === d) return e; } catch (_) {}
  }
  return null;
}, day);
/** Focus mode: confirm the mood, skip to the medication step. */
async function toMedStep(page) {
  // The mood: the wheel's centre on a phone, the bear cards on a computer.
  await page.waitForSelector('#focusedModeCard #fmContent', { state: 'visible', timeout: 20000 });
  await sleep(600);
  if (await page.locator('#focusedModeCard .fm-wheel-btn.center').count()) await page.click('#focusedModeCard .fm-wheel-btn.center');
  else await page.click('#fmContent .mood-btn.mood-stable');
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    if (await medStepShowing(page)) return;
    await page.evaluate(() => _fmSkip());
  }
  throw new Error('no medication step');
}
// The medication step's answers: a wheel on phones, a list of buttons on a computer.
const ANS = v => `#fmContent [onclick*="_fmMedAnswer('${v}')"]:not(.fm-wheel-runway)`;
const medStepShowing = page => page.evaluate(sel => !!document.querySelector(sel), ANS('some'));
const tapWheel = (page, v) => page.locator(ANS(v)).click();
const answerOrder = page => page.evaluate(() => [...document.querySelectorAll('#fmContent [onclick*="_fmMedAnswer("]:not(.fm-wheel-runway)')].map(b => /_fmMedAnswer\('([^']+)'/.exec(b.getAttribute('onclick'))[1]));
async function saveFm(page) {
  for (let i = 0; i < 14; i++) {
    if (await page.locator('#focusedModeCard .fm-done-save').isVisible()) break;
    await page.evaluate(() => _fmSkip());
    await sleep(450);
  }
  await page.click('#focusedModeCard .fm-done-save');
  await sleep(1500);
}
async function openChart(page) {
  await page.waitForFunction(() => typeof window.toggleJournal === 'function' && document.getElementById('journalToggleSection')?.style.display !== 'none', null, { timeout: 15000 });
  await page.evaluate(() => toggleJournal());
  await page.waitForSelector('#lifeChart .lc-svg', { state: 'attached', timeout: 15000 });
  await sleep(400);
}

console.log('The pure helpers');
{
  const M = (await import(path.join(ROOT, 'js/journal-meds.js'))).default;
  assert.deepEqual(M.parseDose('200 mg'), { amount: 200, unit: 'mg' });
  assert.deepEqual(M.parseDose('1,5 tablets'), { amount: 1.5, unit: 'tablets' });
  assert.deepEqual(M.parseDose('as needed'), { amount: null, unit: 'as needed' });
  assert.equal(M.readAmount('0,5'), 0.5); assert.equal(M.readAmount(''), null); assert.ok(Number.isNaN(M.readAmount('abc')));
  const e = { medSome: true, medication: 'taken', medDoses: { Quetiapine: 'taken', Lithium: 'taken' }, medAmounts: { Quetiapine: { amount: 100, unit: 'mg', usual: '200 mg' }, Lithium: { amount: 800, unit: 'mg', usual: '800 mg' } } };
  const s = M.someOf(e);
  assert.deepEqual(s.meds.map(m => m.name + ':' + m.changed), ['Quetiapine:true', 'Lithium:false']);
  assert.equal(M.someOf({ medication: 'taken', medDoses: { Lithium: 'taken' } }), null, 'an old entry is not Some');
  assert.equal(M.someOf({ medSome: true, medication: 'not-taken' }).detail, false);
  assert.equal(M.dosesOf(e).status, 'taken');
  ok('parseDose / readAmount / someOf: a lower dose is a change, the usual one is not; old entries and Some without detail');
}

console.log('Focus mode: Taken and No stay one tap; 🤏 Some asks which and the dose');
{
  const { ctx, page } = await open({ meds: MEDS });
  await toMedStep(page);
  assert.deepEqual(await answerOrder(page), ['not-taken', 'unsure', 'some', 'taken']);
  await shot(page, 'medsome-fm-step-en');
  ok('the medication wheel: No · Unsure · 🤏 Some · Taken');

  await tapWheel(page, 'taken');
  await sleep(500);
  assert.equal(await sheetOpen(page), false, 'Taken opened a sheet');
  assert.equal(await medStepShowing(page), false, 'Taken did not move on');
  ok('Taken: one tap, no sheet, the next step shows');

  // Back to the step (the summary chip), then 🤏 Some.
  await page.evaluate(sel => { for (let i = 0; i < 12; i++) { try { _fmGoTo(i); } catch (_) {} if (document.querySelector(sel)) break; } }, ANS('some'));
  await sleep(400);
  assert.equal(await medStepShowing(page), true);
  await tapWheel(page, 'some');
  await page.waitForSelector('#medsSomeModal.active');
  const rows = await page.evaluate(() => [...document.querySelectorAll('#medsSomeModal .msome-row')].map(r => ({
    name: r.querySelector('strong').textContent, usual: r.querySelector('.msome-usual')?.textContent, val: r.querySelector('input').value,
    unit: r.querySelector('.msome-unit')?.textContent, mode: r.querySelector('input').getAttribute('inputmode'),
    took: r.querySelector('.msome-seg [data-v="taken"]').getAttribute('aria-pressed'),
  })));
  assert.deepEqual(rows.map(r => [r.name, r.usual, r.val, r.unit, r.mode, r.took]), [
    ['💊 Quetiapine', 'Usual: 200 mg', '200', 'mg', 'decimal', 'true'],
    ['💊 Lithium', 'Usual: 800 mg', '800', 'mg', 'decimal', 'true'],
  ]);
  assert.equal(await page.textContent('#medsSomeTitle'), 'Which did you take?');
  ok('🤏 Some opens "Which did you take?": each medicine, Took it, the usual dose filled in, number keyboard');

  // A dose that isn't a number is refused.
  await page.fill('#medsSomeModal .msome-row[data-i="0"] input', 'lots');
  await page.click('#medsSomeModal .msome-done');
  assert.equal(await sheetOpen(page), true);
  assert.match(await page.textContent('#medsSomeModal .msome-err'), /number/);
  ok('negative control: a dose that is not a number is refused and the sheet stays');

  await page.fill('#medsSomeModal .msome-row[data-i="0"] input', '100');
  await shot(page, 'medsome-sheet-en');
  await page.click('#medsSomeModal .msome-done');
  await sleep(500);
  assert.equal(await sheetOpen(page), false);
  assert.equal(await medStepShowing(page), false, 'Done did not move on');
  ok('Done closes the sheet and moves on');

  await saveFm(page);
  const e = await entryFor(page, YESTERDAY);
  assert.ok(e, 'no entry for yesterday');
  assert.equal(e.medSome, true);
  assert.equal(e.medication, 'taken', 'older builds should read "taken" (every medicine was taken)');
  assert.deepEqual(e.medDoses, { Quetiapine: 'taken', Lithium: 'taken' });
  assert.deepEqual(e.medAmounts, { Quetiapine: { amount: 100, unit: 'mg', usual: '200 mg' }, Lithium: { amount: 800, unit: 'mg', usual: '800 mg' } });
  ok('saved to the day: medSome, medDoses, medAmounts (Quetiapine 100 mg, usual 200 mg); medication stays "taken"');

  await page.reload();
  await page.waitForFunction(() => window.BBMeds && typeof window.toggleJournal === 'function');
  await sleep(1500);
  const e2 = await entryFor(page, YESTERDAY);
  assert.deepEqual(e2.medAmounts.Quetiapine, { amount: 100, unit: 'mg', usual: '200 mg' });
  const old = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('entry:')).map(k => JSON.parse(localStorage.getItem(k))).filter(x => !x.medSome).length);
  assert.equal(old, 19, 'the old entries are all still there');
  await openChart(page);
  const marks = await page.evaluate(() => [...document.querySelectorAll('#lifeChart .lc-dose')].map(b => ({ date: b.dataset.date, label: b.getAttribute('aria-label') })));
  assert.equal(marks.length, 1);
  assert.equal(marks[0].date, YESTERDAY);
  assert.match(marks[0].label, /^Quetiapine 100 mg \(usual 200 mg\) · /);
  await page.locator('#lifeChart .lc-dose').click();
  assert.match(await page.textContent('#lcBloodTip'), /Quetiapine 100 mg \(usual 200 mg\)/);
  assert.match(await page.textContent('#lifeChart .lc-legend'), /Took some[\s\S]*Different dose/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#lifeChart .lc-some').length), 1, 'the strip marks the Some day');
  await page.evaluate(() => document.getElementById('lifeChart').scrollIntoView());
  await shot(page, 'medsome-chart-en');
  ok('reload keeps it; the 19 old Yes/No entries still load; the life chart has one 💊 on the day, "Quetiapine 100 mg (usual 200 mg)" on tap');

  // Every list says what was taken.
  const chips = await page.evaluate(() => document.getElementById('entries')?.textContent || '');
  assert.match(chips, /💊 Some/);
  assert.match(chips, /Quetiapine 100 mg \(usual 200 mg\)/);
  await page.evaluate(() => BBMeds.open('doses'));
  await page.waitForSelector('#medsSomeCard');
  assert.match(await page.textContent('#medsSomeCard'), /Different doses[\s\S]*Quetiapine 100 mg \(usual 200 mg\)/);
  const tk = await page.evaluate(() => [...document.querySelectorAll('#medsHubModal .meds-row')].map(r => r.textContent).filter(t => /Quetiapine/.test(t) && /taken/i.test(t)));
  assert.ok(tk.length >= 1, 'the Doses tab counts Quetiapine as taken');
  await shot(page, 'medsome-doses-en');
  await page.evaluate(() => BBMeds.close());
  ok('the entry list says "💊 Some · Quetiapine 100 mg (usual 200 mg)"; the Doses tab lists it under Different doses and counts it taken');
  assert.deepEqual(page.__errors, []);
  await ctx.close();
}

console.log('Focus mode: No is unchanged; closing without Done still records Some');
{
  const { ctx, page } = await open({ meds: [MEDS[0]] });
  await toMedStep(page);
  await tapWheel(page, 'not-taken');
  await sleep(500);
  assert.equal(await sheetOpen(page), false);
  assert.equal(await medStepShowing(page), false, 'No (one medicine) did not move on');
  ok('No: one tap, no sheet (one medicine)');
  await page.evaluate(sel => { for (let i = 0; i < 12; i++) { try { _fmGoTo(i); } catch (_) {} if (document.querySelector(sel)) break; } }, ANS('some'));
  await sleep(400);
  await tapWheel(page, 'some');
  await page.waitForSelector('#medsSomeModal.active');
  await page.click('#medsSomeModal .meds-x');
  await sleep(500);
  assert.equal(await sheetOpen(page), false);
  assert.equal(await medStepShowing(page), false, 'closing did not move on');
  await saveFm(page);
  const e = await entryFor(page, YESTERDAY);
  assert.equal(e.medSome, true);
  assert.equal(e.medication, 'not-taken');
  assert.equal(e.medDoses, null);
  assert.ok(!e.medAmounts);
  ok('✕ without Done: the day is Some with no detail (medication "not-taken" for older builds)');
  await openChart(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#lifeChart .lc-dose').length), 0, 'no detail, no 💊');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#lifeChart .lc-some').length), 1);
  ok('negative control: Some without a dose marks the strip but adds no 💊');
  await ctx.close();
}

console.log('No medicines on the list');
{
  const { ctx, page } = await open({ fm: false });
  await page.waitForSelector('#medicationSection .medication-btn[data-medication="some"]', { state: 'attached' });
  await page.evaluate(() => document.querySelector('.mood-btn[data-mood="stable"]').click());
  await sleep(300);
  await page.click('#medicationSection .medication-btn[data-medication="some"]');
  await page.waitForSelector('#medsSomeModal.active .msome-add');
  assert.match(await page.textContent('#medsSomeModal'), /aren't on your list yet/);
  await page.click('#medsSomeModal .msome-add');
  await page.waitForSelector('#medsHubModal.active');
  assert.equal(await sheetOpen(page), false);
  assert.equal(await page.evaluate(() => document.querySelector('.medication-btn[data-medication="some"]').classList.contains('selected')), true);
  ok('the sheet offers 💊 My medicines; it opens and the answer stays Some');
  await ctx.close();
}

console.log('The classic form');
{
  const { ctx, page } = await open({ fm: false, meds: MEDS });
  await page.waitForSelector('#medicationSection .medication-btn[data-medication="some"]', { state: 'attached' });
  await page.evaluate(() => document.querySelector('.mood-btn[data-mood="stable"]').click());
  await sleep(300);
  const btns = await page.evaluate(() => [...document.querySelectorAll('#medicationSection .medication-btn')].map(b => { const r = b.getBoundingClientRect(); return { v: b.dataset.medication, top: Math.round(r.top), right: r.right }; }));
  assert.deepEqual(btns.map(b => b.v), ['not-taken', 'unsure', 'some', 'taken']);
  assert.equal(new Set(btns.map(b => b.top)).size, 1, 'the four answers are not on one row');
  assert.ok(btns.every(b => b.right <= 390), 'a button runs off the screen');
  await page.click('#medicationSection .medication-btn[data-medication="taken"]');
  assert.equal(await sheetOpen(page), false, 'Taken opened a sheet');
  ok('four answers on one row at 390 px; Taken is one tap');
  await page.click('#medicationSection .medication-btn[data-medication="some"]');
  await page.waitForSelector('#medsSomeModal.active');
  await page.click('#medsSomeModal .msome-row[data-i="1"] .msome-seg [data-v="missed"]');
  assert.equal(await page.evaluate(() => document.querySelector('#medsSomeModal .msome-row[data-i="1"] input').disabled), true);
  await page.click('#medsSomeModal .msome-done');
  await sleep(300);
  assert.match(await page.textContent('#medDosesRow'), /Lithium skipped[\s\S]*Which ones\?/);
  await page.evaluate(() => document.getElementById('medicationSection').scrollIntoView({ block: 'center' }));
  await shot(page, 'medsome-classic-en');
  await page.evaluate(() => document.getElementById('submitBtn').click());
  await page.click('#saveConfirmModal .confirm-btn-yes');
  await sleep(1500);
  const e = await entryFor(page, keyOf(Date.now())) || await entryFor(page, YESTERDAY);
  assert.equal(e.medSome, true);
  assert.equal(e.medication, 'not-taken');
  assert.deepEqual(e.medDoses, { Quetiapine: 'taken', Lithium: 'missed' });
  assert.deepEqual(Object.keys(e.medAmounts), ['Quetiapine']);
  ok('Some with Lithium skipped: "Lithium skipped · Which ones?" under the buttons; saved with medication "not-taken"');
  await ctx.close();
}

console.log('A guest with a PIN: stored encrypted');
{
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const keyB64 = Buffer.from(raw).toString('base64');
  const salt = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const { ctx, page } = await open({ fm: false, meds: MEDS, days: 0, local: { bbGuestPinSalt: salt, bbPinEnabled: '1', bbPinCode: 'pbkdf2$1$x$y' }, session: { bb_guest_key: keyB64, bbPinUnlocked: '1' } });
  await page.waitForSelector('#medicationSection .medication-btn[data-medication="some"]', { state: 'attached' });
  await page.evaluate(() => document.querySelector('.mood-btn[data-mood="stable"]').click());
  await sleep(300);
  await page.click('#medicationSection .medication-btn[data-medication="some"]');
  await page.waitForSelector('#medsSomeModal.active');
  await page.fill('#medsSomeModal .msome-row[data-i="0"] input', '100');
  await page.click('#medsSomeModal .msome-done');
  await page.evaluate(() => document.getElementById('submitBtn').click());
  await page.click('#saveConfirmModal .confirm-btn-yes');
  await sleep(1800);
  const stored = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('entry:')).map(k => localStorage.getItem(k)));
  assert.equal(stored.length, 1, 'one entry');
  assert.ok(!/Quetiapine|medSome|medAmounts|usual/.test(stored[0]), 'Some detail in the clear: ' + stored[0].slice(0, 80));
  const blob = JSON.parse(stored[0]);
  assert.ok(blob._enc && blob._iv);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const b = s => Uint8Array.from(Buffer.from(s, 'base64'));
  const plain = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(blob._iv) }, key, b(blob._enc))));
  assert.equal(plain.medSome, true);
  assert.deepEqual(plain.medAmounts.Quetiapine, { amount: 100, unit: 'mg', usual: '200 mg' });
  ok('the entry is stored encrypted under the PIN key; nothing about the doses in the clear; it decrypts with the detail');
  await ctx.close();
}

console.log('The PDF report');
{
  const t = noon.getTime() - DAY;
  const some = { date: YESTERDAY, timestamp: t, mood: 'low', sleep: 9, energy: 4, medication: 'taken', medSome: true,
    medDoses: { Quetiapine: 'taken', Lithium: 'taken' }, medAmounts: { Quetiapine: { amount: 100, unit: 'mg', usual: '200 mg' }, Lithium: { amount: 800, unit: 'mg', usual: '800 mg' } } };
  const { ctx, page } = await open({ fm: false, meds: MEDS, days: 40, local: { ['entry:' + t]: JSON.stringify(some) } });
  await page.waitForFunction(() => typeof window.exportPDF === 'function' && window.BBMeds);
  // The report's text is glyph-encoded in the file: record what jsPDF is asked to write.
  await page.evaluate(() => {
    window.__pdfText = [];
    const hook = v => {
      if (!v || !v.jsPDF || v.jsPDF.__hooked) return v;
      const J = v.jsPDF;
      const W = function () {
        const d = new J(...arguments), t = d.text;
        d.text = function (x) { try { window.__pdfText.push([].concat(x).join(' ')); } catch (_) {} return t.apply(d, arguments); };
        return d;
      };
      Object.setPrototypeOf(W, J); W.API = J.API; W.__hooked = true;
      v.jsPDF = W;
      return v;
    };
    let j = hook(window.jspdf);
    // The UMD build sets window.jspdf = {} first and fills it in after: hook on read.
    Object.defineProperty(window, 'jspdf', { configurable: true, get: () => hook(j), set: v => { j = v; } });
  });
  await page.evaluate(() => window.exportPDF());
  await page.waitForSelector('#pdfExportModal.active');
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#pdfExportModal .confirm-btn-yes');
  const file = await download;
  const buf = fs.readFileSync(await file.path());
  if (SHOTS) fs.copyFileSync(await file.path(), path.join(SHOTS, 'report-with-some.pdf'));
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const txt = (await page.evaluate(() => window.__pdfText)).join('\n');
  assert.ok(txt.length > 100, 'no text recorded');
  assert.match(txt, /Different doses \(last 30 days\)/);
  assert.match(txt, /Quetiapine 100 mg \(usual 200 mg\)/);
  assert.match(txt, /Some \(Quetiapine 100 mg \(usual 200 mg\)\)/, 'the day\'s entry in the report');
  assert.deepEqual(page.__errors, []);
  ok('the PDF builds with a Some day: "Different doses (last 30 days)" and "Quetiapine 100 mg (usual 200 mg)" in it');
  await ctx.close();
}

console.log('German, and the native-feel sheet');
{
  const { ctx, page } = await open({ meds: MEDS, lang: 'de', touch: true, local: { bbNativeFeel: '1', wheelModeEnabled: '1' } });
  await toMedStep(page);
  assert.match(await page.locator(ANS('some')).textContent(), /Teilweise/);
  assert.equal(await page.evaluate(() => !!document.getElementById('fmWheel')), true, 'no wheel with the wheel on');
  assert.deepEqual(await answerOrder(page), ['not-taken', 'unsure', 'some', 'taken'], 'the wheel: No · Unsure · Some · Taken');
  await shot(page, 'medsome-wheel-de');
  await tapWheel(page, 'some');
  await page.waitForSelector('#medsSomeModal.active');
  await sleep(700); // the sheet slides up
  assert.equal(await page.textContent('#medsSomeTitle'), 'Welche hast du genommen?');
  assert.match(await page.textContent('#medsSomeModal'), /Üblich: 200 mg[\s\S]*Genommen[\s\S]*Ausgelassen/);
  const r = await page.evaluate(() => { const c = document.querySelector('#medsSomeModal .confirm-content').getBoundingClientRect(); return { bottom: Math.round(c.bottom), h: innerHeight, nf: document.documentElement.classList.contains('nf') }; });
  assert.equal(r.nf, true);
  assert.ok(Math.abs(r.bottom - r.h) <= 2, `not a bottom sheet: ${r.bottom} vs ${r.h}`);
  await shot(page, 'medsome-sheet-de');
  // Swipe down closes (Some kept, no detail), like every sheet.
  const cdp = await ctx.newCDPSession(page);
  const head = await page.evaluate(() => { const c = document.querySelector('#medsSomeModal .meds-head').getBoundingClientRect(); return { x: c.x + 40, y: c.y + 10 }; });
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', head.x, head.y);
  for (let i = 1; i <= 12; i++) { await touch('touchMove', head.x, head.y + i * 25); await sleep(12); }
  await touch('touchEnd');
  await sleep(700);
  assert.equal(await sheetOpen(page), false, 'the swipe down did not close the sheet');
  assert.equal(await medStepShowing(page), false);
  ok('German: "Teilweise" on the wheel, "Welche hast du genommen?", Üblich: 200 mg; a bottom sheet on phones that a swipe down closes');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
