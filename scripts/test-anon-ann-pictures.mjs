#!/usr/bin/env node
/**
 * Pictures on announcements (James, 2026-10-29): the admin may attach one
 * picture to an announcement; it is shrunk to a JPEG on the device, sent with
 * the adminAnonPost callable, shown under the message (tap = full screen) and
 * dropped when the announcement is deleted. Negative controls: no picture
 * button on General, none for a member suggesting an announcement, and a
 * General post carrying `image` shows none. Also checks the server's
 * annImage() validation in functions/index.js.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-anon-ann-pictures.mjs
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

console.log('Server: annImage()');
{
  const src = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
  const fn = src.slice(src.indexOf('function annImage(d) {'), src.indexOf('exports.adminAnonPost'));
  class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  const annImage = new Function('HttpsError', 'ANN_IMAGE_BYTES', 'ANN_IMAGE_EDGE', fn + '; return annImage;')(HttpsError, 900 * 1024, 4096);
  const jpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(1000)]).toString('base64');
  assert.equal(annImage({}), null);
  const r = annImage({ image: { data: jpeg, w: 1600, h: 1200 }, imageAlt: '  A bear  ' });
  assert.deepEqual(r.meta, { w: 1600, h: 1200 });
  assert.equal(r.alt, 'A bear');
  ok('a JPEG with a sane size is taken, alt trimmed');
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0]).toString('base64');
  assert.throws(() => annImage({ image: { data: png, w: 10, h: 10 } }), /can't be used/);
  assert.throws(() => annImage({ image: { data: jpeg, w: 0, h: 10 } }), /can't be used/);
  assert.throws(() => annImage({ image: { data: jpeg, w: 5000, h: 10 } }), /can't be used/);
  const big = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(901 * 1024)]).toString('base64');
  assert.throws(() => annImage({ image: { data: big, w: 10, h: 10 } }), /can't be used/);
  ok('refused: not a JPEG, a zero or huge edge, over 900 KB (negative controls)');
}

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
await page.waitForFunction(() => window.BB && typeof BB.t === 'function' && typeof window.resetComposePhoto === 'function');
await page.waitForTimeout(1500);   // let the signed-out auth listener settle

// A fake Firestore: the picture doc answers with real JPEG bytes; writes resolve.
await page.evaluate(() => {
  window.__calls = [];
  window.__gets = [];
  window._callFn = async (name, data) => { window.__calls.push([name, data]); return { id: 'srv-1' }; };
  window._adminSession = async () => {};
  window._ensureAuthSession = async () => {};
  const c = document.createElement('canvas'); c.width = 30; c.height = 20;
  { const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 30, 20); gr.addColorStop(0, '#f6c445'); gr.addColorStop(1, '#4b8bd6'); g.fillStyle = gr; g.fillRect(0, 0, 30, 20); }
  const bytes = Uint8Array.from(atob(c.toDataURL('image/jpeg').split(',')[1]), ch => ch.charCodeAt(0));
  db = { collection: (name) => ({ doc: (id) => ({
    get: async () => { window.__gets.push(name + '/' + id); return { exists: true, data: () => ({ data: { toUint8Array: () => bytes } }) }; },
    update: async () => {}, set: async () => {},
  }) }) };
  BB.storage.set('Anon_isAdmin', 'true');
  BB.storage.set('Anon_hasPosted', 'true');
  setupCompose();   // initBoard() runs it after sign-in, which never happens here
  document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; s.classList.remove('active'); });
  const b = document.getElementById('screen-board'); b.style.display = 'flex'; b.classList.add('active');
});
const openCompose = (tab) => page.evaluate(t => {
  currentTab = t; setComposeMode(); resetComposePoll(); resetComposePhoto();
  document.getElementById('compose-ta').value = ''; openOv('ov-compose');
}, tab);
const visible = (sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && !e.closest('.hidden'); }, sel);

console.log('Board: composing');
await openCompose('general');
assert.equal(await visible('#compose-photo-toggle'), false);
ok('no picture button on General (negative control)');
await page.evaluate(() => BB.storage.remove('Anon_isAdmin'));
await openCompose('announcements');
assert.equal(await page.evaluate(() => composeMode()), 'suggest');
assert.equal(await visible('#compose-photo-toggle'), false);
ok('no picture button for a member suggesting an announcement (negative control)');
await page.evaluate(() => BB.storage.set('Anon_isAdmin', 'true'));
await openCompose('announcements');
assert.equal(await visible('#compose-photo-toggle'), true);
assert.match(await page.textContent('#compose-photo-toggle'), /Add a picture/);
ok('the admin gets "🖼️ Add a picture" on Announcements');

// A 4000×3000 noisy PNG: far over the size cap until shrunk.
const pngB64 = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 4000; c.height = 3000;
  const g = c.getContext('2d'); const d = g.createImageData(4000, 3000);
  for (let i = 0; i < d.data.length; i++) d.data[i] = (Math.random() * 256) | 0;
  g.putImageData(d, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
});
await page.setInputFiles('#compose-photo-file', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.from(pngB64, 'base64') });
await page.waitForFunction(() => !!_composePhoto, null, { timeout: 30000 });
const shrunk = await page.evaluate(() => ({ w: _composePhoto.w, h: _composePhoto.h, head: _composePhoto.data.slice(0, 4), bytes: atob(_composePhoto.data).length }));
assert.ok(shrunk.w <= 1600 && shrunk.h <= 1200, JSON.stringify(shrunk));
assert.equal(Math.round(shrunk.w / shrunk.h * 100), 133);
assert.equal(shrunk.head, '/9j/');
assert.ok(shrunk.bytes <= 850 * 1024, String(shrunk.bytes));
assert.equal(await visible('#compose-photo'), true);
assert.match(await page.textContent('#compose-photo-toggle'), /Remove the picture/);
ok(`a 4000×3000 PNG became a ${shrunk.w}×${shrunk.h} JPEG of ${Math.round(shrunk.bytes / 1024)} KB, previewed`);

await page.click('#compose-photo-toggle');
assert.equal(await page.evaluate(() => _composePhoto), null);
assert.equal(await visible('#compose-photo'), false);
ok('"Remove the picture" takes it off again');

await page.setInputFiles('#compose-photo-file', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.from(pngB64, 'base64') });
await page.waitForFunction(() => !!_composePhoto, null, { timeout: 30000 });
await page.fill('#compose-photo-alt', 'The bear at the meet-up');
await page.fill('#compose-ta', 'Meet-up photos are in!');
await page.click('#compose-post');
await page.waitForFunction(() => window.__calls.some(c => c[0] === 'adminAnonPost'));
const call = await page.evaluate(() => { const d = window.__calls.find(c => c[0] === 'adminAnonPost')[1]; return { ...d, image: d.image && { w: d.image.w, h: d.image.h, jpeg: d.image.data.slice(0, 4) } }; });
assert.equal(call.kind, 'post');
assert.equal(call.tab, 'announcements');
assert.equal(call.text, 'Meet-up photos are in!');
assert.equal(call.imageAlt, 'The bear at the meet-up');
assert.deepEqual(call.image, { w: shrunk.w, h: shrunk.h, jpeg: '/9j/' });
ok('Post sends the text, the JPEG and its description to adminAnonPost');
const card = await page.evaluate(() => { const i = document.querySelector('#post-list .post-img img'); return i && { src: i.getAttribute('src'), alt: i.alt }; });
assert.ok(card && card.src.startsWith('blob:'), JSON.stringify(card));
assert.equal(card.alt, 'The bear at the meet-up');
assert.equal(await page.evaluate(() => _postImgUrls.get('srv-1')) , card.src);
ok('the new announcement shows its picture at once (and keeps it once the real post arrives)');

console.log('Board: reading');
await page.evaluate(() => {
  // After a post the board may offer notifications: not what's under test.
  document.querySelectorAll('.overlay:not(.hidden)').forEach(o => o.classList.add('hidden'));
  localPosts = [
    { id: 'ann-2', tab: 'announcements', text: 'Picnic!', image: { w: 3, h: 2 }, imageAlt: 'A picnic', isAdmin: true, timestamp: new Date() },
    { id: 'gen-3', tab: 'general', text: 'Hello', image: { w: 3, h: 2 }, name: 'Bob', timestamp: new Date() },
  ];
  renderPosts(localPosts);
});
await page.waitForFunction(() => { const i = document.querySelector('.post-img[data-img="ann-2"] img'); return i && i.getAttribute('src'); });
assert.deepEqual(await page.evaluate(() => window.__gets), ['bbAnonPostImages/ann-2']);
assert.equal(await page.evaluate(() => !!document.querySelector('.post-img[data-img="gen-3"]')), false);
ok('an announcement fetches its picture once by post id; a General post with `image` shows none (negative control)');
assert.equal(await page.evaluate(() => document.querySelector('.post-img[data-img="ann-2"]').style.aspectRatio.replace(/\s/g, '')), '3/2');
ok('the card keeps the picture\'s shape before it loads');

await page.evaluate(() => renderPosts(localPosts));
await page.waitForTimeout(200);
assert.equal(await page.evaluate(() => window.__gets.length), 1);
ok('a re-render reuses it (no second fetch)');

if (process.env.SHOT) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => document.documentElement.classList.toggle('theme-dark', t === 'dark'), theme);
    await page.waitForTimeout(150);
    await page.screenshot({ path: process.env.SHOT + '-' + theme + '.png' });
  }
  await page.evaluate(() => document.documentElement.classList.remove('theme-dark'));
}
await page.click('.post-img[data-img="ann-2"]');
assert.equal(await visible('#ov-photo'), true);
assert.equal(await page.evaluate(() => document.getElementById('photo-ov-img').alt), 'A picnic');
ok('tapping it opens it full screen');
await page.click('#photo-ov-img');
assert.equal(await visible('#ov-photo'), false);
ok('any tap closes it');

await page.evaluate(() => { window.__calls = []; return adminDeletePost('ann-2'); });
await page.waitForFunction(() => window.__calls.some(c => c[1] && c[1].kind === 'dropImage'));
assert.deepEqual(await page.evaluate(() => window.__calls[0][1]), { kind: 'dropImage', postId: 'ann-2' });
ok('deleting the announcement drops its picture');

assert.deepEqual(errors, []);
ok('no page errors');

await browser.close();
server.close();
console.log(`\n${passed} passed`);
