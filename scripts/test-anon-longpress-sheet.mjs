#!/usr/bin/env node
/**
 * Press and hold a post, then pick from the sheet (James's video, 2026-10-30):
 * on an iPhone "Delete post (admin)" closed the sheet and did nothing. The
 * long press armed a "swallow the next click" flag for the click that follows
 * a long press — but an iPhone sends none, so the flag stayed set and ate the
 * sheet's own click on the post's hidden Delete button. Real touch events
 * (CDP), not page.tap(), because the bug lives in what a lifted finger leaves
 * behind.
 *
 * Checks: a long press then Delete / Report opens its confirm sheet for that
 * post (both fail on the old code); a real tap straight after the press is
 * still swallowed (negative control: no like); a later tap likes as normal.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-anon-longpress-sheet.mjs
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true, isMobile: true });
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
  localStorage.setItem('bbAnon_monika', 'JJ');
});
await page.goto(BASE + '/anonymous.html');
await page.waitForFunction(() => window.BB && typeof BB.t === 'function' && typeof window.bindLongPress === 'function');
await page.waitForTimeout(1500);   // let the signed-out auth listener settle

// The board as James had it: admin, on Announcements, with his pinned post
// (the stored fields of bbAnonPosts/tRcv6ZEpp0lLna7QBXbw) and a member's post.
await page.evaluate(() => {
  window.__updates = [];
  window._adminSession = async () => {};
  window._ensureAuthSession = async () => {};
  db = { collection: (name) => ({ doc: (id) => ({
    get: async () => ({ exists: false, data: () => ({}) }),
    update: async (d) => { window.__updates.push([name, id, Object.keys(d)]); }, set: async () => {},
  }), where: () => ({ get: async () => ({ docs: [] }) }) }) };
  BB.storage.set('Anon_isAdmin', 'true');
  profile.monika = 'JJ'; profile.isAdmin = true;
  document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; s.classList.remove('active'); });
  const b = document.getElementById('screen-board'); b.style.display = 'flex'; b.classList.add('active');
  // initBoard()'s one-time wiring (it runs after a sign-in, which never happens here).
  setupThread(); setupOverlayActions(); setupInteractions();
  bindLongPress(document.getElementById('post-list'), '.post-card');
  const T = iso => { const d = new Date(iso); return { toMillis: () => d.getTime(), toDate: () => d, seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 }; };
  currentTab = 'announcements';
  localPosts = [
    { id: 'tRcv', isSystem: false, grad1: '#ce93d8', initials: 'JJ', med: 'Lamotrigine, Quetiapine, Lithium', grad2: '#7b1fa2',
      text: 'V1 now available on app stores', isAdmin: true, pinned: true, lastActivity: T('2026-08-13T08:48:00.725Z'),
      timestamp: T('2026-07-15T22:19:20.630Z'), name: 'JJ', tab: 'announcements', stable: 17, commentCount: 3,
      joinedAt: '2026-02-14T23:05:40.000Z', likes: 10, streak: 2 },
    { id: 'm1', text: 'A member post to like', name: 'toby45', initials: 'TO', tab: 'announcements', likes: 0,
      commentCount: 0, timestamp: T('2026-10-29T10:00:00Z') },
  ];
  renderPosts(announcementFeed());
});

const cdp = await ctx.newCDPSession(page);
const touchAt = async (x, y, holdMs) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const centre = async (loc) => { const b = await loc.boundingBox(); return [b.x + Math.min(40, b.width / 2), b.y + b.height / 2]; };
const isOpen = id => page.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
// The hold itself is dispatched in the page: an iPhone sends no click when the
// finger lifts after a long press (the sheet is under it by then), while
// Chromium's touch emulation clicks whatever sheet row it lifts over.
const longPress = async (pid) => {
  await page.evaluate(async (pid) => {
    const el = document.querySelector(`.post-card[data-pid="${pid}"] .post-text`);
    const r = el.getBoundingClientRect();
    const t = new Touch({ identifier: 1, target: el, clientX: r.left + 20, clientY: r.top + r.height / 2 });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
    await new Promise(res => setTimeout(res, 700));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] }));
  }, pid);
  await page.waitForTimeout(250);
  assert.ok(await isOpen('ov-actions'), 'the long press opened the sheet');
};
// The finger goes down on the row and lifts: no page.tap(), so no help.
const pickRow = async (label) => touchAt(...await centre(page.locator('#actions-list .action-row', { hasText: label }).first()), 60);

console.log('Long press, then the sheet');
await longPress('tRcv');
await pickRow(/Delete post/);
await page.waitForTimeout(300);
assert.ok(!(await isOpen('ov-actions')), 'the sheet closed');
assert.ok(await isOpen('ov-admin-delete'), 'Delete post (admin) opened its confirm sheet');
assert.equal(await page.evaluate(() => adminDeleteId), 'tRcv');
ok('hold the pinned announcement → Delete post (admin) asks to confirm, for that post');

await page.locator('#adel-confirm').click();
await page.waitForTimeout(400);
assert.deepEqual(await page.evaluate(() => window.__updates.filter(u => u[1] === 'tRcv').map(u => u[2])[0]),
  ['deleted', 'deletedByAdmin', 'deletedAt']);
ok('confirming deletes it (deleted / deletedByAdmin / deletedAt)');

await page.evaluate(() => { localPosts[0].deleted = false; renderPosts(announcementFeed()); });
await longPress('m1');
await pickRow(/Report post/);
await page.waitForTimeout(300);
assert.ok(await isOpen('ov-report'), 'Report post opened the report sheet');
await page.evaluate(() => closeOv('ov-report'));
ok('the same for a second action (Report) on another post');

console.log('Negative control: the click a long press leaves behind');
await longPress('m1');
await page.evaluate(() => closeOv('ov-actions'));
const likeBtn = page.locator('.post-card[data-pid="m1"] .like-btn');
await page.mouse.click(...await centre(likeBtn));   // a real click within 600 ms of the lift
await page.waitForTimeout(150);
assert.equal(await page.evaluate(() => likedPosts.has('m1')), false, 'the click straight after a long press was swallowed');
ok('a real click straight after the press is still swallowed (no like)');
await page.waitForTimeout(700);
await page.mouse.click(...await centre(likeBtn));
await page.waitForTimeout(150);
assert.equal(await page.evaluate(() => likedPosts.has('m1')), true, 'a later click likes the post');
ok('a later click works as normal (likes)');

assert.deepEqual(errors, []);
ok('no page errors');
console.log(`\n${passed} passed`);
await browser.close(); server.close();
