#!/usr/bin/env node
/**
 * Bipolar Anonymous, James 2026-11-24: three post and navigation fixes.
 *   - the bottom bar has an outline (light and dark);
 *   - posts and replies stop at TEXT_MAX (2,000) with a live count near it;
 *   - line breaks show as typed: blank-line runs collapse to one, blank lines
 *     at the ends go, more than TEXT_MAX_LINES join the last line; still
 *     escaped (no HTML from a post).
 * Negative controls: a short post shows no count; the crisis bot's card keeps
 * its normal wrapping.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-anon-post-limits.mjs
 *
 * (Harness copied from test-anon-board-1103.mjs.)
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

console.log('Bottom bar outline');
const border = () => page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.fab-bar')); return [cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor]; });
let b = await border();
assert.ok(['1px','1.5px'].includes(b[0]), b[0]); assert.equal(b[1], 'solid'); assert.notEqual(b[2], 'rgba(0, 0, 0, 0)');
ok('light: ' + b.join(' '));
await page.evaluate(() => document.documentElement.classList.add('theme-dark'));
b = await border();
assert.ok(['1px','1.5px'].includes(b[0]), b[0]); assert.match(b[2], /rgba\(230, 189, 31/);
ok('dark: ' + b.join(' '));
await page.evaluate(() => document.documentElement.classList.remove('theme-dark'));

console.log('Character limit');
await page.evaluate(() => document.getElementById('fab-compose').click());
const cnt = () => page.evaluate(() => { const c = document.querySelector('#compose-ta + .ta-count'); return c && { hidden: c.hidden, text: c.textContent, max: c.classList.contains('at-max') }; });
assert.equal(await page.evaluate(() => document.getElementById('compose-ta').maxLength), 2000);
await page.fill('#compose-ta', 'Short post');
assert.equal((await cnt()).hidden, true);
ok('a short post shows no count (negative control)');
await page.fill('#compose-ta', 'a'.repeat(1800));
let c = await cnt();
assert.equal(c.hidden, false); assert.equal(c.text, '1,800 / 2,000'); assert.equal(c.max, false);
ok('near the limit: ' + c.text);
await page.focus('#compose-ta');
await page.keyboard.press('End');
await page.keyboard.type('b'.repeat(250));
assert.equal((await page.inputValue('#compose-ta')).length, 2000);
c = await cnt();
assert.equal(c.text, '2,000 / 2,000'); assert.equal(c.max, true);
ok('typing stops at 2,000 and the count turns red');
await page.evaluate(() => { document.getElementById('compose-cancel').click(); });
await page.evaluate(() => { document.getElementById('compose-ta').value = ''; _composeDrafts.clear(); });
assert.equal(await page.evaluate(() => document.getElementById('thread-ta').maxLength), 2000);
assert.ok(await page.evaluate(() => !!document.querySelector('#thread-ta + .ta-count')));
ok('the reply box has the same limit and count');

console.log('Line breaks');
const t = (s) => page.evaluate(x => tidyText(x), s);
assert.equal(await t('\n\n  \nHello\n\n\n\nthere\n\n'), 'Hello\n\nthere');
assert.equal(await t('a\r\nb'), 'a\nb');
const many = Array.from({ length: 40 }, (_, i) => 'L' + i).join('\n');
const tidied = await t(many);
assert.equal(tidied.split('\n').length, 30);
assert.ok(tidied.split('\n')[29].startsWith('L29 L30'));
ok('tidyText: blank runs → one, ends trimmed, 40 lines → 30');
await page.evaluate(() => {
  localPosts = [{ id: 'p2', tab: 'general', text: 'First line\n\n\n\nSecond <b>line</b>\nThird', name: 'Sam', likes: 0, commentCount: 0, timestamp: new Date() }];
  renderPosts(assembleGeneralPosts(localPosts));
});
const pt = await page.evaluate(() => { const el = [...document.querySelectorAll('.post-text')].find(e => e.textContent.includes('First line')); return { text: el.textContent, html: el.innerHTML, ws: getComputedStyle(el).whiteSpace, h: el.getBoundingClientRect().height }; });
assert.equal(pt.text, 'First line\n\nSecond <b>line</b>\nThird');
assert.ok(!pt.html.includes('<b>'));
assert.equal(pt.ws, 'pre-line');
assert.ok(pt.h > 60, 'four lines tall, got ' + pt.h);
ok('a post shows its lines (' + Math.round(pt.h) + 'px tall), escaped');
const ch = await page.evaluate(() => _commentTextHtml({ text: 'one\n\n\n\ntwo' }));
assert.equal(ch, 'one\n\ntwo');
ok('replies use the same tidy text');
await page.evaluate(() => document.getElementById('fab-compose').click());
await page.fill('#compose-ta', '\n\nHello\n\n\n\nthere\n');
await page.click('#compose-post');
await page.waitForFunction(() => localPosts.some(p => p.text === 'Hello\n\nthere'));
ok('a post is saved tidied');
const css = fs.readFileSync(path.join(ROOT, 'css/anonymous.css'), 'utf8');
assert.ok(/\.comment-text\.bot-crisis \{ white-space: normal; \}/.test(css));
ok('the crisis card keeps normal wrapping (negative control)');

assert.deepEqual(errors, []);
ok('no page errors');
console.log(`\n${passed} passed`);
await browser.close();
server.close();
