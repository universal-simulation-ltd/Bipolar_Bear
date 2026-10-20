#!/usr/bin/env node
/**
 * Native feel (js/shared/native-feel.js) driven as an iPhone in headless
 * Chrome with real touches (CDP Input.dispatchTouchEvent), not synthetic
 * events: swipes, drags and taps go through the same touch handlers a phone
 * uses.
 *
 * Covers: swipe-left actions on journal entries; Delete waits behind
 * "Deleted · Undo" (Undo brings the row back with nothing deleted; after 5 s,
 * or on the next touch, the entry is deleted through the page's own confirm,
 * unseen); the page's confirm is a bottom sheet that snaps back after a short
 * drag and closes on a swipe down; tap a row → the day viewer; Settings'
 * "→" opens the next page as a drawer and a swipe down goes back one page,
 * then closes; survival kit sections open as drawers over the grid (swipe
 * down, ✕ and the edge swipe close them) and their rows swipe with undo;
 * a sheet with a text box rides the keyboard (a stubbed visualViewport) and
 * a textarea makes it full height; the edge swipe home; Bipolar Anonymous
 * posts' More / Report and its action sheet.
 * Negative controls: a short drag doesn't close a sheet; Undo deletes
 * nothing; with the keyboard closed nothing moves.
 *
 *   node scripts/test-native-feel.mjs [shotsDir]
 *   CHROME=/path/to/chrome overrides the browser.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv[2] || '';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

// Seeds a guest journal (localhost only), then goes to ?to=.
const SEED = `<!doctype html><meta charset="utf-8"><script>
function S(k, v){ localStorage.setItem(k, typeof v==='string'?v:JSON.stringify(v)); }
localStorage.clear();
['bbWelcomeShown','bbFabFirstRunDone','bbWaFabHidden','bbSurvivalKitVisited','bbMoodDefHintDone','bbMedHintDone','bbPersonalHintDone','bbTutorialToastShown','bbGuestNoPin'].forEach(function(k){S(k,'1');});
S('bbLanguage','en'); S('bbWhatsNewSeen','1.44'); S('bbNativeFeel','1'); S('bbOnboardingStep','12'); S('focusedModeEnabled','0');
S('dailyGoals', ['Walk for 20 minutes','Message one friend today']);
S('survivalGratitude', ['My morning coffee','A check-in text from mum']);
S('currentMedList', [{name:'Lithium',dosage:'800mg'}]);
var now = Date.now();
for (var i = 1; i <= 4; i++) {
  var d = new Date(now - i*86400000); d.setHours(20,0,0,0);
  S('entry:' + d.getTime(), { date: d.toISOString(), timestamp: d.getTime(), mood: [7,4,6,3][i-1], energy: 5, sleep: 7,
    notes: i === 1 ? 'A long note to check the viewer shows it all. '.repeat(8) : 'Day ' + i + ' note' });
}
location.replace('/' + (new URLSearchParams(location.search).get('to') || 'journal.html'));
</script>`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__seed.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(SEED); return; }
  const p = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}`;

const PORT = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'nfchrome-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://localhost:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(200); } }
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
const pageErrs = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').split('\n').slice(0, 2).join(' | '));
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
});
const cdp = (method, params = {}, sessionId) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); });

const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
const { sessionId: S } = await cdp('Target.attachToTarget', { targetId, flatten: true });
const c = (m, p) => cdp(m, p, S);
await c('Page.enable'); await c('Runtime.enable'); await c('Network.enable'); await c('Network.setBypassServiceWorker', { bypass: true });
// Only this server: Firebase and the rest of the web stay unreachable (guest mode).
await c('Network.setBlockedURLs', { urls: ['*gstatic.com*', '*googleapis.com*', '*firebaseio.com*', '*wikipedia.org*', '*wikimedia.org*', '*unisim.co.uk*', '*fonts.g*'] });
// Hide the web-only banners that sit above everything, and stub the visual
// viewport so the keyboard can be "opened" (window.__kb(px)).
await c('Page.addScriptToEvaluateOnNewDocument', { source: `
  (function () {
    var t = new EventTarget(), kb = 0;
    Object.defineProperty(t, 'height', { get: function () { return window.innerHeight - kb; } });
    Object.defineProperty(t, 'offsetTop', { get: function () { return 0; } });
    Object.defineProperty(t, 'width', { get: function () { return window.innerWidth; } });
    try { Object.defineProperty(window, 'visualViewport', { configurable: true, get: function () { return t; } }); } catch (_) {}
    window.__kb = function (px) { kb = px; t.dispatchEvent(new Event('resize')); };
  })();
  document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#pwa-install-banner, #bbHintOverlay { display: none !important }'; document.head.appendChild(st); });` });
await c('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await c('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await c('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
const ev = async (expr) => { const r = await c('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.value; };
const waitFor = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch {} await sleep(150); } return false; };
const shot = async (name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const { data } = await c('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(data, 'base64')); };
const touch = (type, x, y) => c('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
async function drag(x0, y0, x1, y1, steps = 12, ms = 12) {
  await touch('touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(ms); }
  await touch('touchEnd');
}
async function tap(x, y) { await touch('touchStart', x, y); await sleep(40); await touch('touchEnd'); }
const VIS = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.getClientRects().length && e.getBoundingClientRect().height > 0)`;
const rect = (sel) => ev(`(() => { const e = ${VIS(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
const modalOpen = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && getComputedStyle(e).display !== 'none'; })()`);
const entryCount = () => ev(`Object.keys(localStorage).filter(k => k.startsWith('entry:')).length`);
const snack = () => ev(`(() => { const s = document.querySelector('.nf-snack'); return s ? s.textContent : null; })()`);
async function tapSel(sel) { const r = await rect(sel); if (!r) return false; await tap(r.x + r.w / 2, r.y + r.h / 2); return true; }

try {
  // ── Journal ──
  await c('Page.navigate', { url: BASE + '/__seed.html?to=journal.html' });
  check('journal: entries render', await waitFor(`document.querySelectorAll('#entries .entry').length >= 1`));
  await sleep(1200);
  for (let k = 0; k < 3; k++) {
    if (await ev(`!!${VIS('#entries .entry')}`)) break;
    await ev(`(() => { const b = [...document.querySelectorAll('button, [onclick]')].find(b => /Open Journal/.test(b.textContent) && b.offsetParent); if (b) b.click(); })()`);
    await sleep(1200);
  }
  await ev(`(() => { const h = document.getElementById('bbHintOverlay'); if (h) h.remove(); document.body.classList.remove('bb-settings-fab-hint'); })()`);
  await sleep(800);
  check('html.nf is on', await ev(`document.documentElement.classList.contains('nf')`));
  const btnW = await ev(`(() => { const b = ${VIS('#entries .entry')}?.querySelector('.delete-btn'); return b ? b.getBoundingClientRect().width : -1; })()`);
  check('inline × hidden visually (still in DOM)', btnW >= 0 && btnW <= 1, `width ${btnW}`);
  await ev(`${VIS('#entries .entry')}.scrollIntoView({ block: 'center' })`); await sleep(400);
  let r = await rect('#entries .entry');
  await shot('01-journal-list');
  await drag(r.x + r.w - 30, r.y + r.h / 2, r.x + r.w - 150, r.y + r.h / 2);
  await sleep(450);
  const tx = await ev(`getComputedStyle(${VIS('#entries .entry')}).transform`);
  check('swipe left reveals actions', /matrix\(1, 0, 0, 1, -\d+/.test(tx), tx);
  await shot('02-journal-swiped');

  // Delete → "Deleted · Undo"; Undo brings it back and deletes nothing.
  const n0 = await entryCount();
  await tapSel('#entries .entry .nf-act.nf-del');
  await sleep(300);
  check('Delete hides the row behind "Deleted · Undo" (no confirm)', /Deleted\s*Undo/.test(await snack() || '') && !(await modalOpen('#confirmModal.active')) && await ev(`!!document.querySelector('#entries .entry.nf-gone')`), await snack());
  await shot('03-undo-bar');
  await tapSel('.nf-snack-undo');
  await sleep(300);
  check('Undo: the row is back, the bar gone, nothing deleted (negative control)', !(await snack()) && !(await ev(`!!document.querySelector('#entries .entry.nf-gone')`)) && await entryCount() === n0);
  // Delete again and let the 5 s run out → deleted through the page's confirm, unseen.
  r = await rect('#entries .entry');
  await drag(r.x + r.w - 30, r.y + r.h / 2, r.x + r.w - 150, r.y + r.h / 2); await sleep(400);
  await tapSel('#entries .entry .nf-act.nf-del');
  await sleep(5600);
  check('after 5 s the entry is deleted, the confirm never shows', await entryCount() === n0 - 1 && !(await modalOpen('#confirmModal.active')) && !(await snack()), `entries ${await entryCount()} of ${n0}`);
  await waitFor(`document.querySelectorAll('#entries .entry').length >= 1`, 5000);
  await sleep(600);
  // Full swipe → waits too; the next touch elsewhere carries it out and does nothing else.
  r = await rect('#entries .entry');
  const n1 = await entryCount();
  await drag(r.x + r.w - 20, r.y + r.h / 2, 30, r.y + r.h / 2, 16, 12);
  await sleep(500);
  check('full swipe also waits behind Undo', !!(await snack()) && await entryCount() === n1);
  await tap(195, 120);
  await sleep(1200);
  check('the next touch carries it out', await entryCount() === n1 - 1 && !(await snack()), `entries ${await entryCount()} of ${n1}`);
  await waitFor(`document.querySelectorAll('#entries .entry').length >= 1`, 5000);
  await sleep(600);

  // The page's own confirm (its × button) is still a bottom sheet.
  await ev(`${VIS('#entries .entry')}.querySelector('.delete-btn').click()`);
  check('the page\'s own Delete opens its confirm', await waitFor(`document.querySelector('#confirmModal.active')`, 3000));
  await sleep(450);
  const cr = await rect('#confirmModal .confirm-content');
  check('confirm is a bottom sheet', cr && Math.abs(cr.y + cr.h - 844) < 2 && cr.w >= 389, JSON.stringify(cr));
  await drag(cr.x + cr.w / 2, cr.y + 20, cr.x + cr.w / 2, cr.y + 80, 6, 15);
  const ys = [];
  for (const ms of [150, 250, 250, 250, 300]) { await sleep(ms); ys.push(Math.round((await rect('#confirmModal .confirm-content')).y)); }
  check('short drag snaps back and stays (negative control)', ys.slice(2).every(y => Math.abs(y - cr.y) <= 2) && ys.every(y => y <= cr.y + 62), 'y ' + ys.join(','));
  check('confirm still open after short drag', await modalOpen('#confirmModal.active'));
  await drag(cr.x + cr.w / 2, cr.y + 20, cr.x + cr.w / 2, cr.y + 300, 10, 15);
  await sleep(700);
  check('swipe down closes the confirm', !(await modalOpen('#confirmModal.active')));
  await sleep(300);
  r = await rect('#entries .entry');
  await tap(r.x + r.w / 2, r.y + 20);
  check('tap row opens the day viewer', await waitFor(`document.querySelector('#calDayModal.active')`, 3000));
  await sleep(450);
  const vr = await rect('#calDayModal .confirm-content');
  await drag(vr.x + vr.w / 2, vr.y + 16, vr.x + vr.w / 2, vr.y + 320, 10, 15);
  await sleep(700);
  check('swipe down closes the viewer', !(await modalOpen('#calDayModal.active')));

  // ── Settings: Advanced's index and its pages open as drawers; swipe down goes back a page ──
  await ev(`showSettingsModal()`);
  await sleep(600);
  await ev(`document.getElementById('settingsContent').scrollTop = 1e6`); await sleep(200);
  await tapSel('#advancedSettingsBtn');
  await sleep(120);
  let anim = await ev(`document.getElementById('settingsContent').getAnimations().map(a => a.animationName).join(',')`);
  await sleep(500);
  const pg = () => ev(`['settingsMainPanel','settingsIndexPanel','settingsAdvancedMorePanel'].find(id => document.getElementById(id).style.display !== 'none')`);
  check('Settings: Advanced slides its index up as a new drawer', await pg() === 'settingsIndexPanel' && /nf-up/.test(anim), anim);
  await tapSel('#setIdxStats');
  await sleep(120);
  anim = await ev(`document.getElementById('settingsContent').getAnimations().map(a => a.animationName).join(',')`);
  await sleep(500);
  check('a row (📊 Stats) slides its page up as a drawer', await pg() === 'settingsAdvancedMorePanel' && /nf-up/.test(anim), anim);
  await shot('04-settings-stats');
  let sr = await rect('#settingsModal .confirm-content');
  await drag(sr.x + sr.w / 2, sr.y + 16, sr.x + sr.w / 2, sr.y + 300, 10, 15);
  await sleep(700);
  check('swipe down goes back to the index, Settings stays open', await pg() === 'settingsIndexPanel' && await modalOpen('#settingsModal.active'));
  sr = await rect('#settingsModal .confirm-content');
  await drag(sr.x + sr.w / 2, sr.y + 16, sr.x + sr.w / 2, sr.y + 300, 10, 15);
  await sleep(700);
  check('again: back to the first page', await pg() === 'settingsMainPanel' && await modalOpen('#settingsModal.active'));
  sr = await rect('#settingsModal .confirm-content');
  await ev(`document.getElementById('settingsContent').scrollTop = 0`); await sleep(200);
  await drag(sr.x + sr.w / 2, sr.y + 16, sr.x + sr.w / 2, sr.y + 330, 10, 15);
  await sleep(800);
  check('on the first page a swipe down closes Settings', !(await modalOpen('#settingsModal.active')));

  // ── Writing rides the keyboard (💊 My medicines → Side effects' textarea) ──
  await ev(`(BBMeds.open('side'), 1)`); await sleep(600);
  const sheetY0 = (await rect('#medsHubModal .confirm-content')).y;
  await ev(`window.__kb(300)`); await sleep(200);
  check('negative control: the keyboard alone (nothing focused) moves nothing', Math.abs((await rect('#medsHubModal .confirm-content')).y - sheetY0) < 2);
  await ev(`document.querySelector('#medsHubModal textarea').focus()`); await sleep(500);
  const kr = await rect('#medsHubModal .confirm-content');
  check('a textarea: the sheet sits on the keyboard, full height above it', kr && Math.abs(kr.y + kr.h - (844 - 300)) < 3 && kr.h >= 844 - 300 - 12, JSON.stringify(kr));
  await shot('05-keyboard-composer');
  await ev(`window.__kb(0)`); await sleep(400);
  const kr2 = await rect('#medsHubModal .confirm-content');
  check('keyboard down: the sheet goes back to the bottom', kr2 && Math.abs(kr2.y + kr2.h - 844) < 3, JSON.stringify(kr2));
  await ev(`document.activeElement.blur(); BBMeds.close()`); await sleep(400);

  // ── Survival kit: sections open as drawers ──
  await c('Page.navigate', { url: BASE + '/__seed.html?to=survival-kit.html' });
  check('survival kit loads', await waitFor(`!!document.getElementById('skContainer') && typeof skOpenSection === 'function'`));
  await sleep(1200);
  await ev(`document.querySelector('.sk-tile[data-sk-open="gratitude"]').scrollIntoView({ block: 'center' })`); await sleep(300);
  await tapSel('.sk-tile[data-sk-open="gratitude"]');
  await sleep(600);
  const dr = await rect('#gratitude');
  check('a tile opens its section as a drawer over the grid', await ev(`document.getElementById('gratitude').classList.contains('nf-drawer-on') && getComputedStyle(document.getElementById('gratitude')).position === 'fixed' && !!document.getElementById('nfDrawerBack') && getComputedStyle(document.getElementById('skOverview')).display !== 'none'`) && dr && Math.abs(dr.y + dr.h - 844) < 2, JSON.stringify(dr));
  await shot('06-sk-drawer');
  // A row inside swipes, with undo.
  const gr = await rect('#gratitudeList > div');
  if (gr) {
    const g0 = await ev(`JSON.parse(localStorage.getItem('survivalGratitude')).length`);
    await drag(gr.x + gr.w - 20, gr.y + gr.h / 2, gr.x + gr.w - 140, gr.y + gr.h / 2); await sleep(450);
    await tapSel('#gratitudeList .nf-act.nf-del'); await sleep(300);
    check('a drawer row: Delete waits behind Undo', !!(await snack()) && await ev(`JSON.parse(localStorage.getItem('survivalGratitude')).length`) === g0);
    await tapSel('.nf-snack-undo'); await sleep(300);
    check('Undo keeps it', await ev(`JSON.parse(localStorage.getItem('survivalGratitude')).length`) === g0 && !(await ev(`!!document.querySelector('#gratitudeList .nf-gone')`)));
  } else check('gratitude rows visible in the drawer', false);
  // Swipe down closes it.
  await ev(`document.getElementById('gratitude').scrollTop = 0`);
  const d2 = await rect('#gratitude');
  await drag(d2.x + d2.w / 2, d2.y + 12, d2.x + d2.w / 2, d2.y + 320, 10, 15);
  await sleep(700);
  check('swipe down closes the drawer (back to the grid)', await ev(`!document.querySelector('.nf-drawer-on') && !document.getElementById('nfDrawerBack')?.isConnected`));
  // ✕ closes one too.
  await ev(`skOpenSection('goals')`); await sleep(500);
  await tapSel('#goals .nf-drawer-x'); await sleep(400);
  check('✕ closes a drawer', await ev(`!document.querySelector('.nf-drawer-on')`));
  // The edge swipe closes one; from the grid it goes home.
  await ev(`skOpenSection('mood-scale')`); await sleep(500);
  await drag(5, 400, 300, 400, 14, 14);
  await sleep(900);
  check('edge swipe closes a drawer', await ev(`!document.querySelector('.nf-drawer-on')`));
  await drag(5, 400, 320, 400, 14, 14);
  check('edge swipe from the grid goes home', await waitFor(`location.pathname.endsWith('index.html')`, 5000));
  await sleep(1200);

  // ── Bipolar Anonymous ──
  await c('Page.navigate', { url: BASE + '/anonymous.html' });
  check('anonymous loads with nf', await waitFor(`document.documentElement.classList.contains('nf') && typeof renderPost === 'function'`));
  await sleep(2500);
  await ev(`(() => { showScreen('board'); const l = document.getElementById('post-list'); l.innerHTML = renderPost({ id: 'p1', name: 'SomeoneElse', text: 'A post from someone else', timestamp: Date.now(), likes: 2 }); })()`);
  await sleep(400);
  const pr = await rect('#post-list .post-card');
  check('post rendered', !!pr, JSON.stringify(pr));
  if (pr) {
    const moreW = await ev(`document.querySelector('#post-list .more-btn').getBoundingClientRect().width`);
    check('⋯ hidden visually', moreW <= 1, 'w ' + moreW);
    await drag(pr.x + pr.w - 20, pr.y + pr.h / 2, pr.x + pr.w - 200, pr.y + pr.h / 2);
    await sleep(450);
    const labels = await ev(`[...document.querySelectorAll('#post-list .nf-act')].map(b => b.className.split(' ').pop() + ':' + b.textContent).join(', ')`);
    check('post swipe shows More + Report', /nf-more:/.test(labels) && /nf-warn:/.test(labels), labels);
    const mr = await rect('#post-list .nf-act.nf-more');
    await tap(mr.x + mr.w / 2, mr.y + mr.h / 2);
    check('More opens the action sheet', await waitFor(`!document.getElementById('ov-actions').classList.contains('hidden')`, 3000));
    await sleep(450);
    const ar = await rect('#ov-actions .sheet');
    await drag(ar.x + ar.w / 2, ar.y + 14, ar.x + ar.w / 2, ar.y + 260, 10, 15);
    await sleep(700);
    check('swipe down closes the action sheet', await ev(`document.getElementById('ov-actions').classList.contains('hidden')`));
  }
} catch (e) {
  results.push('ERROR ' + e.message);
}
console.log(results.join('\n'));
const errs = [...new Set(pageErrs)].filter(e => !/firebase|Firestore|Failed to fetch|NetworkError|net::/i.test(e));
if (errs.length) console.log('page errors:\n  ' + errs.slice(0, 12).join('\n  '));
const failed = results.filter(r => !r.startsWith('PASS')).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
ws.close(); chrome.kill(); server.close();
process.exit(failed ? 1 : 0);
