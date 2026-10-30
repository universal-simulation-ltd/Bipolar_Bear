#!/usr/bin/env node
/**
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

// A fake Firestore that records writes; comment sends can be made to fail.
await page.evaluate(() => {
  window.__writes = [];
  window.__failSend = false;
  window._ensureAuthSession = async () => {};
  const docRef = (p) => ({
    path: p,
    get: async () => ({ exists: false, data: () => ({}) }),
    update: async (d) => { window.__writes.push(['update', p, Object.keys(d)]); },
    set: async () => { if (window.__failSend) throw new Error('offline'); window.__writes.push(['set', p]); },
    collection: (c) => col(p + '/' + c),
  });
  let n = 0;
  const col = (p) => ({
    doc: (id) => docRef(p + '/' + (id || 'auto' + (++n))),
    orderBy: () => ({ onSnapshot: (cb) => { cb({ docs: [] }); return () => {}; } }),
    where: () => ({ get: async () => ({ docs: [] }) }),
  });
  db = { collection: (c) => col(c) };
  setupThread();
  document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; s.classList.remove('active'); });
  const b = document.getElementById('screen-board'); b.style.display = 'flex'; b.classList.add('active');
  currentTab = 'general';
  localPosts = [
    { id: 'p1', tab: 'general', text: 'Rough day', name: 'Sam', likes: 0, supports: 2, commentCount: 0, timestamp: new Date() },
    { id: 'p2', tab: 'general', text: 'Good news', name: 'Alex', likes: 0, commentCount: 0, timestamp: new Date() },
    { id: 'mine', tab: 'general', text: 'My post', name: 'TestBear', likes: 0, commentCount: 0, timestamp: new Date() },
  ];
  renderPosts(assembleGeneralPosts(localPosts));
});
const open = (id) => page.evaluate(i => openThread(i), id);
const close = () => page.evaluate(() => closeThread());
const taH = () => page.evaluate(() => document.getElementById('thread-ta').getBoundingClientRect().height);

console.log('Comment box');
await open('p1');
const h0 = await taH();
await page.fill('#thread-ta', 'line\n'.repeat(6) + 'end');
const h1 = await taH();
assert.ok(h1 > h0 + 40, `${h0} → ${h1}`);
await page.fill('#thread-ta', 'line\n'.repeat(60));
const h2 = await taH();
assert.ok(h2 <= Math.round(844 * 0.35) + 1 && h2 > h1, `capped at ${h2}`);
assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('thread-ta')).overflowY), 'auto');
await page.fill('#thread-ta', 'short');
assert.ok(await taH() < h1, 'shrinks back');
ok(`grows as you type (${Math.round(h0)} → ${Math.round(h1)} px), stops at a third of the screen (${Math.round(h2)} px) and scrolls, shrinks back`);

console.log('Drafts');
await page.fill('#thread-ta', 'Sending you strength');
await close();
await open('p2');
assert.equal(await page.inputValue('#thread-ta'), '');
assert.equal(await page.evaluate(() => document.getElementById('thread-send').disabled), true);
ok('another thread starts empty (negative control)');
await page.fill('#thread-ta', 'Congrats!');
await close();
await open('p1');
assert.equal(await page.inputValue('#thread-ta'), 'Sending you strength');
assert.equal(await page.evaluate(() => document.getElementById('thread-send').disabled), false);
ok('reopening the thread brings back what was being written, ready to send');
await page.evaluate(() => { window.__failSend = true; });
await page.click('#thread-send');
await page.waitForTimeout(200);
await close(); await open('p1');
assert.equal(await page.inputValue('#thread-ta'), 'Sending you strength');
ok('a failed send keeps the draft (negative control)');
await page.evaluate(() => { window.__failSend = false; });
await page.click('#thread-send');
await page.waitForFunction(() => window.__writes.some(w => w[0] === 'set'));
await page.waitForFunction(() => document.getElementById('thread-ta').value === '');
await close(); await open('p2');
assert.equal(await page.inputValue('#thread-ta'), '');
await close(); await open('p1');
assert.equal(await page.inputValue('#thread-ta'), '');
await close();
ok('sending a comment clears every draft (the other thread\'s too)');

console.log('❤️‍🩹 Support');
await page.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)').forEach(o => o.classList.add('hidden')); window.__writes = []; });
const sup = (id) => page.locator(`.post-card[data-pid="${id}"] .support-btn`);
assert.equal(await sup('p1').locator('.support-n').textContent(), '2');
assert.equal(await sup('p2').locator('.support-n').textContent(), '0');
assert.equal(await sup('p1').locator('.support-ico').textContent(), '❤️‍🩹');
await sup('p1').click();
assert.equal(await sup('p1').locator('.support-n').textContent(), '3');
assert.equal(await sup('p1').getAttribute('aria-pressed'), 'true');
assert.match(await sup('p1').getAttribute('aria-label'), /Send support \(3\)/);
assert.deepEqual(await page.evaluate(() => window.__writes), [['update', 'bbAnonPosts/p1', ['supports']]]);
assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('bbAnon_supported') || BB.storage.get('Anon_supported'))), ['p1']);
ok('❤️‍🩹 shows the count, a tap adds one, writes supports and is remembered');
await sup('p1').click();
assert.equal(await sup('p1').locator('.support-n').textContent(), '2');
assert.equal(await page.evaluate(() => window.__writes.length), 2);
ok('a second tap takes it back');
await page.evaluate(() => { window.__writes = []; });
await sup('mine').click({ force: true });
assert.equal(await sup('mine').locator('.support-n').textContent(), '0');
assert.equal(await page.evaluate(() => window.__writes.length), 0);
assert.match(await page.evaluate(() => document.body.innerText), /can't send support to your own post/);
ok('not on your own post (negative control)');
const colour = await page.evaluate(() => getComputedStyle(document.querySelector('.support-ico')).filter);
assert.match(colour, /hue-rotate/);
await sup('p2').click();
await page.waitForTimeout(400);   // the button's 0.15 s transition
const on = await page.evaluate(() => getComputedStyle(document.querySelector('.post-card[data-pid="p2"] .support-btn')).borderColor);
assert.equal(on, 'rgb(255, 149, 0)');
await page.locator('.post-card[data-pid="p1"] .post-actions').screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'support-off.png') });
await page.locator('.post-card[data-pid="p2"] .post-actions').screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'support-on.png') });
ok('the heart is tinted orange and a given ❤️‍🩹 has the orange border');
assert.equal(await page.evaluate(() => _reacted({ likes: 0, supports: 1 })), true);
assert.equal(await page.evaluate(() => _reacted({ likes: 0, supports: 0 })), false);
ok('a ❤️‍🩹 counts as the reaction that lets you post again');

console.log('Announcements');
await page.evaluate(() => { currentTab = 'announcements'; localPosts = []; renderPosts(announcementFeed()); });
const ann = await page.evaluate(() => document.getElementById('post-list').innerText);
assert.doesNotMatch(ann, /12 Steps/);
assert.equal(await page.evaluate(() => typeof builtInAnnouncements), 'undefined');
ok('the 12 Steps announcement is gone');

assert.deepEqual(errors, []);
ok('no page errors');
await browser.close();
server.close();
console.log(`\n${passed} passed`);
