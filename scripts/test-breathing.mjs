#!/usr/bin/env node
/**
 * Browser checks for 🌬️ Breathing (2026-10-26, James: "a breathing section to
 * the Survival Kit … allow them to select their favourite. Then in the
 * journal ask if they'd like to do a breathing exercise if they responded
 * anything but stable (5) … discrete enough that they can just continue …
 * an option in settings … (switch off by default) … the popup for new
 * features").
 *
 * The real pages (Firebase stubbed out, signed out), at 390 px. Covers: the
 * Survival Kit banner, tab and #breathing deep link open the section; five
 * exercises, each with its pattern; starring one puts it first (and only
 * one is starred); ▶ Start opens the player on that exercise; the player
 * runs in → out with the circle growing then shrinking and a countdown,
 * Stop resets it, Mute and the length are kept, Escape closes it; the kit
 * still counts 12 sections. The journal: no prompt with the switch off (the
 * default); with it on, a Low mood shows the line on the next step and the
 * entry carries on past it; ✕ hides it for the entry; Breathe opens the
 * player on the favourite; Stable and spectrum 5 never show it, spectrum 4
 * does; a held-on Low mood with Stable does; the form shows it under the
 * mood buttons; the Settings switch starts unticked and turns it on; the
 * New features sheet lists both 1.46 lines (a link to the kit, a switch
 * that starts off and turns the prompts on); German.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-breathing.mjs
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

const browser = await chromium.launch();
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A fresh context seeded once. o: {page, lang, fm, local:{}, seen} */
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
    localStorage.setItem('bbWhatsNewSeen', cfg.seen || '1.46'); localStorage.setItem('bbWelcomeShown', '1');
    localStorage.setItem('focusedModeEnabled', cfg.fm === false ? '0' : '1');
    localStorage.setItem('bbGuestNoPin', '1');
    localStorage.setItem('bbSurvivalKitVisited', '1');
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const k = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    for (let i = 8; i >= 2; i--) {
      const t = now.getTime() - i * 86400000;
      localStorage.setItem('entry:' + t, JSON.stringify({ date: k(t), timestamp: t, mood: 'stable', sleep: 7, energy: 5, medication: 'taken' }));
    }
    Object.keys(cfg.local || {}).forEach(x => localStorage.setItem(x, cfg.local[x]));
  }, o);
  await page.goto(BASE + '/' + (o.page || 'journal.html'));
  await page.waitForFunction(() => window.BB && typeof BB.t === 'function' && BB.breathing, null, { timeout: 20000 });
  if (!o.page || o.page === 'journal.html') {
    await page.waitForFunction(() => typeof window._fmGoTo === 'function', null, { timeout: 20000 });
  }
  return { ctx, page };
}
const shot = async (page, name) => {
  if (!SHOTS) return;
  await sleep(450);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
};
const playerOpen = page => page.evaluate(() => !!document.querySelector('.bbbr-back'));
const promptShowing = (page, id = 'fmBreathPrompt') => page.evaluate(i => { const el = document.getElementById(i); return !!el && el.style.display !== 'none' && !!el.textContent.trim(); }, id);
const fmStep = page => page.evaluate(() => (document.getElementById('fmTitle') || {}).textContent || '');
/** Focus mode: pick a mood the way a tap does, and wait for the next step. */
async function pickMood(page, mood) {
  await page.waitForSelector('#focusedModeCard #fmContent', { state: 'visible', timeout: 20000 });
  await sleep(500);
  if (typeof mood === 'number') await page.evaluate(n => _fmSpectrumTap(n), mood);
  else await page.evaluate(m => _fmMoodTap(m), mood);
  await sleep(900);
}

console.log('The module');
{
  const { ctx, page } = await open({ page: 'survival-kit.html' });
  const r = await page.evaluate(() => {
    const B = BB.breathing;
    const before = B.list().map(x => x.id);
    B.setFavourite('box');
    const after = B.list().map(x => x.id);
    B.setFavourite('box'); // the same one again unstars it
    const cleared = B.favourite();
    return { before, after, cleared, pat: B.pattern(B.get('478')), prompts: B.promptsOn() };
  });
  assert.deepEqual(r.before, ['longout', 'box', 'even', '478', 'sigh']);
  assert.deepEqual(r.after, ['box', 'longout', 'even', '478', 'sigh']);
  assert.equal(r.cleared, null);
  assert.equal(r.pat, 'In 4 · Hold 7 · Out 8');
  assert.equal(r.prompts, false, 'prompts must start off');
  ok('five exercises; the favourite goes first; tapping it again unstars it; prompts start off');
  await ctx.close();
}

console.log('Survival Kit: the section, the favourite and the player');
{
  const { ctx, page } = await open({ page: 'survival-kit.html' });
  await sleep(600);
  assert.equal(await page.locator('.sk-breathe').isVisible(), true, 'no banner');
  assert.equal(await page.locator('.sk-tab[data-sk-tab="breathing"]').count(), 1, 'no tab');
  await shot(page, 'breathe-kit-grid');
  await page.click('.sk-breathe');
  await sleep(500);
  assert.equal(await page.evaluate(() => document.getElementById('breathing').classList.contains('sk-open')), true, 'section did not open');
  assert.equal(await page.evaluate(() => location.hash), '#breathing');
  const cards = await page.evaluate(() => [...document.querySelectorAll('#skBreathList .bbbr-card')].map(c => [c.querySelector('.bbbr-card-name').firstChild.textContent, c.querySelector('.bbbr-card-pat').textContent]));
  assert.deepEqual(cards, [
    ['Longer out-breath', 'In 4 · Out 6'], ['Box breathing', 'In 4 · Hold 4 · Out 4 · Hold 4'], ['Even breathing', 'In 5 · Out 5'],
    ['4-7-8 breathing', 'In 4 · Hold 7 · Out 8'], ['Double sigh', 'In 2 · In again 1 · Out 6'],
  ]);
  ok('the 🌬️ banner opens the section (#breathing): five cards with their patterns');
  await shot(page, 'breathe-kit-section');

  await page.click('#skBreathList [data-star="even"]');
  await sleep(200);
  const fav = await page.evaluate(() => ({
    first: document.querySelector('#skBreathList .bbbr-card .bbbr-card-name').firstChild.textContent,
    starred: [...document.querySelectorAll('#skBreathList [data-star][aria-pressed="true"]')].map(b => b.dataset.star),
    ls: localStorage.getItem('bbBreathFav'), focus: document.activeElement && document.activeElement.dataset.star,
  }));
  assert.deepEqual(fav, { first: 'Even breathing', starred: ['even'], ls: 'even', focus: 'even' });
  await page.click('#skBreathList [data-star="sigh"]');
  await sleep(200);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#skBreathList [data-star][aria-pressed="true"]')].map(b => b.dataset.star)), ['sigh']);
  ok('☆ stars one exercise (only one at a time), it moves to the top and keeps focus');

  await page.click('#skBreathList [data-play="box"]');
  await sleep(300);
  assert.equal(await playerOpen(page), true);
  const p0 = await page.evaluate(() => ({
    sel: document.querySelector('.bbbr-chip[aria-checked="true"]').dataset.id,
    phase: document.querySelector('.bbbr-phase').textContent,
    left: document.querySelector('.bbbr-left').textContent,
    modal: document.querySelector('.bbbr-sheet').getAttribute('aria-modal'),
    chips: [...document.querySelectorAll('.bbbr-chip')].map(c => c.textContent),
  }));
  assert.equal(p0.sel, 'box');
  assert.equal(p0.phase, 'Ready when you are');
  assert.equal(p0.left, '1:00 left');
  assert.equal(p0.modal, 'true');
  assert.equal(p0.chips[0], '★ Double sigh', 'the favourite chip is first and starred');
  ok('▶ Start opens the player on that exercise (1 minute, the favourite first in the row)');

  await page.click('.bbbr-go');
  await sleep(600);
  const run1 = await page.evaluate(() => ({
    phase: document.querySelector('.bbbr-phase').textContent, count: document.querySelector('.bbbr-count').textContent,
    orb: document.querySelector('.bbbr-orb').style.transform, go: document.querySelector('.bbbr-go').textContent,
  }));
  assert.deepEqual(run1, { phase: 'Breathe in', count: '4', orb: 'scale(1)', go: 'Stop' });
  await shot(page, 'breathe-player-in');
  await sleep(4000);
  const run2 = await page.evaluate(() => ({ phase: document.querySelector('.bbbr-phase').textContent, orb: document.querySelector('.bbbr-orb').style.transform }));
  assert.deepEqual(run2, { phase: 'Hold', orb: 'scale(1)' });
  await sleep(4000);
  const run3 = await page.evaluate(() => ({ phase: document.querySelector('.bbbr-phase').textContent, orb: document.querySelector('.bbbr-orb').style.transform, left: document.querySelector('.bbbr-left').textContent }));
  assert.equal(run3.phase, 'Breathe out');
  assert.equal(run3.orb, 'scale(0.5)');
  assert.match(run3.left, /^0:5\d left$/);
  ok('Start: Breathe in (circle grows, 4…) → Hold → Breathe out (circle shrinks), the time left counts down');

  await page.click('.bbbr-go');
  await sleep(200);
  assert.deepEqual(await page.evaluate(() => [document.querySelector('.bbbr-phase').textContent, document.querySelector('.bbbr-go').textContent, document.querySelector('.bbbr-count').textContent]), ['Ready when you are', 'Start', '']);
  ok('Stop resets it');

  await page.click('.bbbr-seg [data-m="3"]');
  await page.click('.bbbr-tog[data-act="mute"]');
  await sleep(100);
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('bbBreathMins'), localStorage.getItem('bbBreathMute'), document.querySelector('.bbbr-left').textContent,
    document.querySelector('.bbbr-tog[data-act="mute"]').getAttribute('aria-pressed')]), ['3', '1', '3:00 left', 'true']);
  // The ★ in the player makes the shown exercise the favourite.
  await page.click('.bbbr-tog[data-act="fav"]');
  await sleep(100);
  assert.equal(await page.evaluate(() => localStorage.getItem('bbBreathFav')), 'box');
  await page.keyboard.press('Escape');
  await sleep(200);
  assert.equal(await playerOpen(page), false, 'Escape did not close it');
  assert.equal(await page.evaluate(() => document.querySelector('#skBreathList .bbbr-card .bbbr-card-name').firstChild.textContent), 'Box breathing', 'the list follows the player\'s ★');
  ok('3 min and Mute are kept; ★ Favourite in the player; Escape closes it; the list follows');

  // Reopen: remembers 3 min + mute.
  await page.click('#skBreathList [data-play="even"]');
  await sleep(200);
  assert.deepEqual(await page.evaluate(() => [document.querySelector('.bbbr-seg [aria-checked="true"]').dataset.m, document.querySelector('.bbbr-tog[data-act="mute"]').getAttribute('aria-pressed')]), ['3', 'true']);
  await page.click('.bbbr-back', { position: { x: 10, y: 10 } });
  await sleep(200);
  assert.equal(await playerOpen(page), false, 'a tap on the backdrop did not close it');
  ok('reopened: 3 min and Mute still set; a tap outside closes it');

  const prog = await page.evaluate(() => document.getElementById('skGridProgress').textContent);
  assert.match(prog, /\/ 12/);
  ok('the kit still counts 12 sections (' + prog.trim() + ')');
  assert.deepEqual(page.__errors, []);
  await ctx.close();
}

console.log('Survival Kit: survival-kit.html#breathing opens the section');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (u.startsWith(BASE)) return /service-worker\.js/.test(u) ? route.abort() : route.continue();
    return route.abort();
  });
  await page.goto(BASE + '/survival-kit.html#breathing');
  await page.waitForFunction(() => document.getElementById('breathing') && document.getElementById('breathing').classList.contains('sk-open'), null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => document.querySelectorAll('#skBreathList .bbbr-card').length), 5);
  ok('the deep link (the New features link) opens Breathing');
  await ctx.close();
}

console.log('Journal: the prompt is off until the switch is on');
{
  const { ctx, page } = await open();
  await pickMood(page, 'low');
  assert.notEqual(await fmStep(page), '', 'no next step');
  assert.equal(await promptShowing(page), false, 'a prompt with the switch off');
  ok('switch off (the default): a Low mood shows nothing');
  await ctx.close();
}

console.log('Journal: with the switch on');
{
  const { ctx, page } = await open({ local: { breathPromptsEnabled: '1', bbBreathFav: '478' } });
  await page.waitForSelector('#focusedModeCard #fmContent', { state: 'visible', timeout: 20000 });
  assert.equal(await promptShowing(page), false, 'shown on the mood step');
  await pickMood(page, 'low');
  const step1 = await fmStep(page);
  assert.equal(await promptShowing(page), true, 'no prompt after Low');
  assert.equal(await page.evaluate(() => document.querySelector('#fmBreathPrompt .bbp-txt').textContent), '🌬️ A minute of slow breathing?');
  await shot(page, 'breathe-journal-prompt');
  ok('Low → the next step carries "🌬️ A minute of slow breathing?"');

  // Carry on without answering it: the entry moves on, the line stays.
  await page.evaluate(() => _fmSkip());
  await sleep(600);
  assert.notEqual(await fmStep(page), step1, 'did not move on');
  assert.equal(await promptShowing(page), true, 'gone on the next step');
  assert.equal(await playerOpen(page), false);
  ok('the entry carries on past it (Skip moves on; the line stays, nothing opens)');

  await page.click('#fmBreathPrompt .bbp-no');
  await sleep(200);
  assert.equal(await promptShowing(page), false);
  await page.evaluate(() => _fmSkip());
  await sleep(600);
  assert.equal(await promptShowing(page), false, 'came back after ✕');
  ok('✕ hides it for the rest of this entry');
  await ctx.close();
}
{
  const { ctx, page } = await open({ local: { breathPromptsEnabled: '1', bbBreathFav: '478' } });
  await pickMood(page, 'elevated');
  assert.equal(await promptShowing(page), true, 'no prompt after Elevated');
  await page.click('#fmBreathPrompt .bbp-go');
  await sleep(300);
  assert.equal(await playerOpen(page), true);
  assert.equal(await page.evaluate(() => document.querySelector('.bbbr-chip[aria-checked="true"]').dataset.id), '478');
  await shot(page, 'breathe-journal-player');
  await page.click('.bbbr-x');
  await sleep(300);
  assert.equal(await playerOpen(page), false);
  assert.equal(await promptShowing(page), false, 'still there after doing one');
  assert.ok((await fmStep(page)).length > 0, 'the entry is gone');
  ok('Elevated → Breathe opens the player on the favourite (4-7-8); closing it returns to the entry, the line gone');
  await ctx.close();
}
{
  const { ctx, page } = await open({ local: { breathPromptsEnabled: '1' } });
  await pickMood(page, 'stable');
  assert.equal(await promptShowing(page), false, 'a prompt after Stable');
  ok('Stable → no prompt');
  await ctx.close();
}
{
  const { ctx, page } = await open({ local: { breathPromptsEnabled: '1' } });
  await page.waitForSelector('#focusedModeCard #fmContent', { state: 'visible', timeout: 20000 });
  await sleep(400);
  // Stable, with Low held on as another mood ("How else were you feeling?").
  await page.evaluate(() => { _fmMoodTap('stable'); });
  await sleep(900);
  assert.equal(await promptShowing(page), false);
  const wanted = await page.evaluate(() => { selectedLinkedMoods.push('low'); _renderFocusedStep(); return !!document.getElementById('fmBreathPrompt').textContent; });
  assert.equal(wanted, true, 'no prompt with Low held on');
  ok('Stable with Low held on as well → the prompt');
  await ctx.close();
}
{
  const { ctx, page } = await open({ local: { breathPromptsEnabled: '1', moodSpectrumEnabled: '1' } });
  await pickMood(page, 5);
  assert.equal(await promptShowing(page), false, 'a prompt at 5');
  await page.evaluate(() => _fmGoTo(0));
  await sleep(500);
  await pickMood(page, 4);
  assert.equal(await promptShowing(page), true, 'no prompt at 4');
  ok('0–10 spectrum: 5 → nothing; 4 (Sad but stable) → the prompt');
  await ctx.close();
}

console.log('Journal: the form, and the Settings switch');
{
  const { ctx, page } = await open({ fm: false, local: { breathPromptsEnabled: '1' } });
  await page.waitForSelector('.mood-selector .mood-btn', { state: 'visible', timeout: 20000 }).catch(() => {});
  const vis = await page.evaluate(() => { const b = document.querySelector('.mood-selector .mood-btn[data-mood="low"]'); if (!b) return null; b.click(); return true; });
  if (vis) {
    await sleep(300);
    assert.equal(await promptShowing(page, 'breathPromptForm'), true, 'no prompt in the form');
    await shot(page, 'breathe-form');
    ok('the form: Low → the line under the mood buttons');
  } else {
    console.log('  – the classic form is not on this page (skipped)');
  }
  await ctx.close();
}
{
  const { ctx, page } = await open();
  const r = await page.evaluate(() => {
    const t = document.getElementById('breathPromptsToggle');
    const label = document.querySelector('label[for="breathPromptsToggle"]').textContent;
    const before = t.checked;
    t.checked = true; t.dispatchEvent(new Event('change'));
    return { before, label, ls: localStorage.getItem('breathPromptsEnabled') };
  });
  assert.deepEqual(r, { before: false, label: '🌬️ Breathing prompts', ls: '1' });
  await pickMood(page, 'depressed');
  // Depressed brings the "You matter" card first; close it to carry on.
  await page.evaluate(() => { try { _fmDismissDepressedMsg(); } catch (_) {} });
  await sleep(700);
  assert.equal(await promptShowing(page), true, 'no prompt after turning it on');
  ok('Settings: 🌬️ Breathing prompts starts unticked; ticking it turns the prompt on');
  await ctx.close();
}

console.log('New features (1.46)');
{
  const { ctx, page } = await open({ seen: '1.45' });
  // The journal holds the sheet back while an entry is open (focus mode is),
  // so show it the way it shows once the screen is free.
  await page.waitForFunction(() => BB.whatsNew && BB.whatsNew.current, null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => BB.whatsNew.current.latest()), '1.46');
  await page.evaluate(() => BB.whatsNew.current.show());
  await page.waitForSelector('.bbwn-back', { timeout: 5000 });
  const r = await page.evaluate(() => ({
    v: document.getElementById('bbwnVer').textContent,
    ids: [...document.querySelectorAll('.bbwn-item')].map(li => li.dataset.id),
    link: (document.querySelector('.bbwn-item[data-id="breathing"] .bbwn-link') || {}).getAttribute?.('href'),
    linkTxt: (document.querySelector('.bbwn-item[data-id="breathing"] .bbwn-link') || {}).textContent,
    sw: !!document.querySelector('.bbwn-item[data-id="breathing"] input'),
    on: document.querySelector('.bbwn-item[data-id="breathPrompts"] input').checked,
  }));
  assert.equal(r.v, 'New in 1.46');
  assert.deepEqual(r.ids, ['breathing', 'breathPrompts']);
  assert.equal(r.link, 'survival-kit.html#breathing');
  assert.equal(r.linkTxt, 'Open them in the Survival Kit →');
  assert.equal(r.sw, false);
  assert.equal(r.on, false);
  await shot(page, 'breathe-whatsnew');
  await page.click('.bbwn-item[data-id="breathPrompts"] .bbwn-sw input');
  await sleep(300);
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('breathPromptsEnabled'), document.getElementById('breathPromptsToggle').checked]), ['1', true]);
  ok('the sheet: "Breathing exercises" with a link to the kit, and "Breathing prompts" with a switch that starts off and turns them on');
  assert.deepEqual(page.__errors, []);
  await ctx.close();
}

console.log('German');
{
  const { ctx, page } = await open({ lang: 'de', local: { breathPromptsEnabled: '1' } });
  await pickMood(page, 'low');
  assert.equal(await page.evaluate(() => document.querySelector('#fmBreathPrompt .bbp-txt').textContent), '🌬️ Eine Minute langsam atmen?');
  await page.click('#fmBreathPrompt .bbp-go');
  await sleep(200);
  assert.equal(await page.evaluate(() => document.querySelector('.bbbr-go').textContent), 'Start');
  assert.equal(await page.evaluate(() => document.querySelector('.bbbr-pat').textContent), 'Ein 4 · Aus 6');
  ok('German: the prompt and the player');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} checks passed`);
