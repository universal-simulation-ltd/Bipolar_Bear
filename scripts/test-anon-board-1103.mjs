#!/usr/bin/env node
/**
 * Bipolar Anonymous, James 2026-11-03:
 *   - a post being written comes back after the sheet is closed (until it's
 *     posted or the app closes), one per tab and mode;
 *   - a hint shown while a sheet is open (the "wait for a reply" after a second
 *     comment) shows on the sheet, not behind it;
 *   - 💛 and ❤️‍🩹 on replies, not on your own;
 *   - the greeting + check-in swipes away (or ✕) until tomorrow;
 *   - tap another bear on the scale to change today's check-in;
 *   - the App Store / Play review card, asked at a good moment, rarely.
 * Negative controls throughout.
 *
 * (Harness copied from test-anon-comments-support.mjs, whose header was:)
 * Bipolar Anonymous, James 2026-10-30:
 *   - the comment box grows as you type (to about a third of the screen);
 *   - a comment being written comes back when the thread is reopened, and
 *     every draft goes once a comment is sent anywhere;
 *   - ❤️‍🩹 Support beside 💛: counts, toggles, writes `supports` ±1, not on
 *     your own post, and lifts the "wait for a reaction" gate;
 *   - the built-in 12 Steps announcement is gone.
 * Negative controls: another thread starts empty; a failed send keeps the
 * draft; your own post's ❤️‍🩹 writes nothing.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-anon-comments-support.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;

let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }

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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) errors.push(e.message); });
await page.route('**/*', route => {
  const u = route.request().url();
  if (u.includes('firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
  if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
  if (u.startsWith(BASE)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
  return route.abort();
});
await page.addInitScript(() => {
  if (sessionStorage.getItem('__seeded')) return;
  sessionStorage.setItem('__seeded', '1');
  localStorage.clear();
  localStorage.setItem('bbLanguage', 'en');
  localStorage.setItem('bbAnon_monika', 'TestBear');
});
await page.goto(BASE + '/anonymous.html');
await page.waitForFunction(() => window.BB && typeof BB.t === 'function' && typeof window.openThread === 'function');
await page.waitForTimeout(1500);   // let the signed-out auth listener settle

// A fake Firestore that records writes; sends can be made to fail.
await page.evaluate(() => {
  window.__writes = [];
  window.__fail = false;
  window.__comments = [];
  window._ensureAuthSession = async () => {};
  const docRef = (p) => ({
    path: p, id: p.split('/').pop(),
    get: async () => ({ exists: false, data: () => ({}) }),
    update: async (d) => { if (window.__fail) throw new Error('denied'); window.__writes.push(['update', p, Object.keys(d)]); },
    set: async () => { if (window.__fail) throw new Error('offline'); window.__writes.push(['set', p]); },
    collection: (c) => col(p + '/' + c),
  });
  let n = 0;
  const col = (p) => ({
    doc: (id) => docRef(p + '/' + (id || 'auto' + (++n))),
    add: async () => { if (window.__fail) throw new Error('offline'); window.__writes.push(['add', p]); return docRef(p + '/a' + (++n)); },
    orderBy: () => ({ onSnapshot: (cb) => { cb({ docs: window.__comments.map(c => ({ id: c.id, data: () => c })) }); return () => {}; } }),
    where: () => ({ get: async () => ({ docs: [] }) }),
  });
  db = { collection: (c) => col(c) };
  setupThread();
  setupCompose();
  setupFAB();
  _boardOffline = false;
  document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; s.classList.remove('active'); });
  const b = document.getElementById('screen-board'); b.style.display = 'flex'; b.classList.add('active');
  currentTab = 'general';
  profile.hasPosted = true;
  localPosts = [
    { id: 'p1', tab: 'general', text: 'Rough day', name: 'Sam', likes: 1, commentCount: 2, timestamp: new Date() },
  ];
  renderPosts(assembleGeneralPosts(localPosts));
});
const hidden = (id) => page.evaluate(i => document.getElementById(i).classList.contains('hidden'), id);
const closeAll = () => page.evaluate(() => document.querySelectorAll('.overlay:not(.hidden)').forEach(o => o.classList.add('hidden')));

console.log('A post being written');
await closeAll();
await page.evaluate(() => document.getElementById('fab-compose').click());
assert.equal(await hidden('ov-compose'), false);
assert.equal(await page.inputValue('#compose-ta'), '');
await page.fill('#compose-ta', 'Has anyone tried a light box?');
await page.click('#compose-cancel');
assert.equal(await hidden('ov-compose'), true);
await page.evaluate(() => document.getElementById('fab-compose').click());
assert.equal(await page.inputValue('#compose-ta'), 'Has anyone tried a light box?');
assert.equal(await page.evaluate(() => document.getElementById('compose-post').disabled), false);
ok('closing the sheet keeps it: ✏️ brings it back, ready to post');
await closeAll();
await page.evaluate(() => { currentTab = 'announcements'; document.getElementById('fab-compose').click(); });
assert.equal(await page.inputValue('#compose-ta'), '');
await closeAll();
await page.evaluate(() => { currentTab = 'general'; });
ok('a suggested announcement starts empty, not with the General post (negative control)');
await page.evaluate(() => { window.__fail = true; document.getElementById('fab-compose').click(); });
await page.click('#compose-post');
await page.waitForFunction(() => !document.getElementById('ov-compose').classList.contains('hidden') && document.getElementById('compose-ta').value);
await closeAll();
await page.evaluate(() => document.getElementById('fab-compose').click());
assert.equal(await page.inputValue('#compose-ta'), 'Has anyone tried a light box?');
ok('a post that fails to send is still there (negative control)');
await page.evaluate(() => { window.__fail = false; });
await page.click('#compose-post');
await page.waitForFunction(() => window.__writes.some(w => w[0] === 'set' && w[1].startsWith('bbAnonPosts/')));
await page.evaluate(() => { localPosts = localPosts.filter(p => p.id === 'p1'); document.getElementById('fab-compose').click(); });
assert.equal(await page.inputValue('#compose-ta'), '');
await closeAll();
ok('once posted, ✏️ opens empty');

console.log('A hint while a sheet is open');
await page.evaluate(() => { window.__comments = [{ id: 'c1', name: 'TestBear', text: 'me again', timestamp: null }]; openThread('p1'); });
await page.waitForTimeout(300);
await page.fill('#thread-ta', 'and another thing');
await page.evaluate(() => document.getElementById('fab-hint').classList.remove('show'));
await page.click('#thread-send');
const hint = await page.evaluate(() => {
  const h = document.getElementById('sheet-hint');
  const sheet = document.querySelector('#ov-thread .sheet');
  const r = h.getBoundingClientRect(), s = sheet.getBoundingClientRect();
  return { parent: h.parentNode.id, text: h.textContent, show: h.classList.contains('show'), top: r.top, bottom: r.bottom, sheetTop: s.top,
    z: getComputedStyle(h).zIndex, fabShown: document.getElementById('fab-hint').classList.contains('show') };
});
assert.equal(hint.parent, 'ov-thread');
assert.match(hint.text, /wait|reply/i);
assert.equal(hint.show, true);
assert.ok(hint.top >= 0 && hint.bottom <= hint.sheetTop + 1, JSON.stringify(hint));
assert.equal(hint.fabShown, false);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'sheet-hint.png') });
ok(`"${hint.text}" shows above the thread sheet, not on the bar under it`);
await closeAll();
await page.evaluate(() => showHint('hello'));
assert.equal(await page.evaluate(() => document.getElementById('fab-hint').classList.contains('show')), true);
ok('with no sheet open it is the bar\'s hint, as before (negative control)');

console.log('💛 and ❤️‍🩹 on replies');
await page.evaluate(() => {
  window.__writes = [];
  window.__comments = [
    { id: 'c1', name: 'Sam', text: 'Thinking of you', likes: 2, supports: 0, timestamp: null },
    { id: 'c2', name: 'TestBear', text: 'Thanks', timestamp: null },
    { id: 'c3', name: 'Bear', isBot: true, botKind: 'crisis', text: '', timestamp: null },
  ];
  openThread('p1');
});
await page.waitForTimeout(300);
const r = (cid, sel) => page.locator(`#thread-comments-list .comment-card[data-cid="${cid}"] ${sel}`);
assert.equal(await r('c1', '.like-btn span').textContent(), '2');
assert.equal(await r('c1', '.support-btn .support-n').textContent(), '0');
assert.equal(await r('c3', '.c-react').count(), 0);
ok('each reply shows 💛 and ❤️‍🩹 with counts (none on the crisis bear)');
await r('c1', '.like-btn').click();
await r('c1', '.support-btn').click();
await page.waitForTimeout(100);
assert.equal(await r('c1', '.like-btn span').textContent(), '3');
assert.equal(await r('c1', '.support-btn .support-n').textContent(), '1');
assert.deepEqual(await page.evaluate(() => window.__writes), [
  ['update', 'bbAnonPosts/p1/comments/c1', ['likes']],
  ['update', 'bbAnonPosts/p1/comments/c1', ['supports']],
]);
assert.deepEqual(await page.evaluate(() => JSON.parse(BB.storage.get('Anon_likedComments'))), ['p1/c1']);
ok('a tap adds one, writes likes / supports on the reply, and is remembered');
await r('c1', '.like-btn').click();
await page.waitForTimeout(100);
assert.equal(await r('c1', '.like-btn span').textContent(), '2');
ok('a second tap takes it back');
await page.evaluate(() => { window.__writes = []; });
await r('c2', '.like-btn').click({ force: true });
await r('c2', '.support-btn').click({ force: true });
assert.equal(await page.evaluate(() => window.__writes.length), 0);
ok('not on your own reply (negative control)');
await page.evaluate(() => { window.__fail = true; });
await r('c1', '.support-btn').click();
await page.waitForTimeout(150);
assert.equal(await r('c1', '.support-btn .support-n').textContent(), '1');
assert.equal(await r('c1', '.support-btn').getAttribute('aria-pressed'), 'true');
await page.evaluate(() => { window.__fail = false; });
ok('a refused write puts it back (negative control)');
await page.locator('#thread-comments-list .comment-card[data-cid="c1"]').screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'reply-hearts.png') });
await closeAll();

console.log('The greeting and check-in');
await page.evaluate(() => {
  Object.assign(_moodState, { ready: true, failed: false, counts: { manic: 1, elevated: 2, stable: 5, low: 3, depressed: 1 }, bear: null, checkedIn: true, via: 'board', showAll: false });
  BB.storage.set('Anon_mood', JSON.stringify({ day: _ukDay(), mood: 'low' }));
  BB.storage.remove('Anon_greetingHidden');
  setupInteractions();
  renderPosts(assembleGeneralPosts(localPosts));
});
const greet = () => page.locator('#post-list .sys-card[data-sys="daily"]').count();
assert.equal(await greet(), 1);
// Change: open the scale, tap Stable.
await page.evaluate(() => { window.__calls = []; window._callFn = async (n, d) => { window.__calls.push([n, d]); return window.__moveOk ? { day: _ukDay(), counts: { manic: 1, elevated: 2, stable: 6, low: 2, depressed: 1 }, checkedIn: true, via: 'board', moved: true } : { checkedIn: true, counts: { manic: 1, elevated: 2, stable: 5, low: 3, depressed: 1 } }; }; });
await page.click('#post-list [data-mood-open]');
assert.equal(await page.locator('#post-list .ml-pick').count(), 5);
assert.equal(await page.locator('#post-list .ml-pick.mine').getAttribute('data-mood-change'), 'low');
assert.match(await page.locator('#post-list .mood-block').innerText(), /Tap another to change/);
await page.locator('#post-list .mood-block').screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'mood-scale.png') });
ok('tapping your bear opens the scale, your bear ringed, with "tap another to change"');
await page.evaluate(() => { window.__moveOk = false; });
await page.click('#post-list [data-mood-change="stable"]');
await page.waitForTimeout(100);
assert.deepEqual(await page.evaluate(() => window.__calls[0]), ['anonMoodCheckin', { mood: 'stable', from: 'low' }]);
assert.equal(await page.evaluate(() => _myMood()), 'low');
assert.equal(await page.locator('#post-list .ml-pick.mine').getAttribute('data-mood-change'), 'low');
ok('a server that doesn\'t move it leaves you on Low (negative control)');
await page.evaluate(() => { window.__moveOk = true; window.__calls = []; });
await page.click('#post-list [data-mood-change="stable"]');
await page.waitForTimeout(100);
assert.deepEqual(await page.evaluate(() => window.__calls[0]), ['anonMoodCheckin', { mood: 'stable', from: 'low' }]);
assert.equal(await page.evaluate(() => _myMood()), 'stable');
assert.equal(await page.locator('#post-list .ml-pick.mine').getAttribute('data-mood-change'), 'stable');
assert.equal(await page.locator('#post-list .ml-pick[data-mood-change="stable"] b').textContent(), '6');
assert.equal(await page.locator('#post-list .ml-pick[data-mood-change="low"] b').textContent(), '2');
assert.match(await page.locator('#post-list .mood-same').innerText(), /Stable/);
ok('tapping Stable changes today\'s check-in: Low −1, Stable +1, "you" line follows');
await page.evaluate(() => { window.__calls = []; });
await page.click('#post-list [data-mood-change="stable"]');
assert.equal(await page.evaluate(() => window.__calls.length), 0);
ok('tapping your own bear again does nothing (negative control)');

// Swipe it away.
const box = await page.locator('#post-list .sys-card[data-sys="daily"]').boundingBox();
await page.mouse.move(box.x + 40, box.y + 20);
await page.mouse.down();
await page.mouse.move(box.x + 70, box.y + 22, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(400);
assert.equal(await greet(), 1);
ok('a short drag springs back (negative control)');
await page.mouse.move(box.x + 30, box.y + 20);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.8, box.y + 25, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);
assert.equal(await greet(), 0);
await page.evaluate(() => renderPosts(assembleGeneralPosts(localPosts)));
assert.equal(await greet(), 0);
ok('a swipe puts the greeting away, and it stays away when the board redraws (the next app open)');
await page.evaluate(() => { BB.storage.set('Anon_greetingHidden', '2020-01-01'); renderPosts(assembleGeneralPosts(localPosts)); });
assert.equal(await greet(), 1);
ok('it comes back the next day');
await page.click('#post-list [data-sys-hide]');
assert.equal(await greet(), 0);
ok('✕ puts it away too');

console.log('The review card');
await page.evaluate(() => {
  window.__asked = 0;
  window.Capacitor = { Plugins: { InAppReview: { requestReview: async () => { window.__asked++; } } } };
  ['ReviewAskCount', 'ReviewLastAsked'].forEach(k => BB.storage.remove(k));
  BB.storage.set('Anon_useDays', '1');
  _maybeAskForReview('Feeling good today');
});
await page.waitForTimeout(2800);
assert.equal(await page.evaluate(() => window.__asked), 0);
ok('not on someone\'s first days (negative control)');
await page.evaluate(() => { BB.storage.set('Anon_useDays', '3'); _maybeAskForReview("I want to end it all"); });
await page.waitForTimeout(2800);
assert.equal(await page.evaluate(() => window.__asked), 0);
ok('not after a post that reads like a crisis (negative control)');
await page.evaluate(() => { openOv('ov-e2ee'); _maybeAskForReview('Feeling good today'); });
await page.waitForTimeout(2800);
assert.equal(await page.evaluate(() => window.__asked), 0);
await closeAll();
ok('not over an open sheet (negative control)');
await page.evaluate(() => _maybeAskForReview('Feeling good today'));
await page.waitForTimeout(2800);
assert.equal(await page.evaluate(() => window.__asked), 1);
ok('asked after a good post on day 3+');
await page.evaluate(() => _maybeAskForReview('Feeling good today'));
await page.waitForTimeout(2800);
assert.equal(await page.evaluate(() => window.__asked), 1);
ok('not again for 120 days (negative control)');
assert.equal(await page.evaluate(() => BB.storage.get('ReviewAskCount')), '1');
ok('counted with the journal\'s ask (ReviewAskCount), so inside Bipolar Bear the two never add up');
await page.evaluate(() => { window.Capacitor = undefined; _maybeAskForReview('hi'); });
ok('no plugin (the website) does nothing');

assert.deepEqual(errors, []);
ok('no page errors');
await browser.close();
server.close();
console.log(`\n${passed} passed`);
