#!/usr/bin/env node
/**
 * Bipolar Anonymous, James 2026-11-26: admins can add a song to a post.
 *   - the 🎵 button shows only to the admin posting as Bipolar Bear Admin;
 *   - only Spotify / Apple Music / YouTube / SoundCloud links are taken
 *     (anything else: a hint, nothing sent); a poll and a song can't share a post;
 *   - the link goes to adminAnonPost as `audio`, tidied;
 *   - the card shows "▶ Play on …" + "Open in …"; tapping Play swaps in the
 *     service's player and does NOT open the thread;
 *   - a member's post carrying `audio` shows nothing (negative control).
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-anon-songs.mjs
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
  window.__calls = [];
  _callFn = async (name, data) => { window.__calls.push([name, data]); return { id: 'srv' + window.__calls.length }; };
  window.__opened = [];
  openThread = (id) => { window.__opened.push(id); };
});
// No third-party requests in the test: the player frame's src is checked, not loaded.
await page.route(/open\.spotify\.com|youtube|soundcloud|apple\.com/, r => r.fulfill({ contentType: 'text/html', body: '<p>player</p>' }));

const vis = (id) => page.evaluate(i => getComputedStyle(document.getElementById(i)).display !== 'none', id);
const closeAll = () => page.evaluate(() => document.querySelectorAll('.overlay:not(.hidden)').forEach(o => o.classList.add('hidden')));

console.log('Who sees 🎵');
await page.evaluate(() => { BB.storage.set('Anon_isAdmin', 'false'); document.getElementById('fab-compose').click(); });
assert.equal(await vis('compose-song-toggle'), false);
ok('a member has no song button (negative control)');
await closeAll();
await page.evaluate(() => { BB.storage.set('Anon_isAdmin', 'true'); BB.storage.set('Anon_postAsMember', 'true'); document.getElementById('fab-compose').click(); });
assert.equal(await vis('compose-song-toggle'), false);
ok('the admin posting as a member has none either');
await closeAll();
await page.evaluate(() => { BB.storage.set('Anon_postAsMember', 'false'); document.getElementById('fab-compose').click(); });
assert.equal(await vis('compose-song-toggle'), true);
ok('the admin posting as Bipolar Bear Admin has it');

console.log('Links');
await page.click('#compose-song-toggle');
assert.equal(await vis('compose-song'), true);
await page.fill('#compose-ta', 'Song of the week');
await page.fill('#compose-song-url', 'https://example.com/song.mp3');
await page.click('#compose-post');
assert.equal(await page.evaluate(() => window.__calls.length), 0);
assert.equal(await page.evaluate(() => document.getElementById('ov-compose').classList.contains('hidden')), false);
ok('a link that isn\'t a streaming service is refused, nothing sent, the sheet stays');
await page.fill('#compose-song-url', 'https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=xyz');
await page.click('#compose-post');
await page.waitForFunction(() => window.__calls.length === 1);
const call = await page.evaluate(() => window.__calls[0]);
assert.equal(call[0], 'adminAnonPost');
assert.equal(call[1].audio, 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
assert.equal(call[1].text, 'Song of the week');
ok('a Spotify link goes to adminAnonPost, tidied');
const parse = (u) => page.evaluate(x => { const s = songLink(x); return s && [s.service, s.embed]; }, u);
assert.deepEqual(await parse('https://youtu.be/dQw4w9WgXcQ'), ['YouTube', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0']);
assert.equal((await parse('https://music.apple.com/gb/album/x/1440857781?i=1440857795'))[1], 'https://embed.music.apple.com/gb/album/x/1440857781?i=1440857795');
assert.equal((await parse('https://soundcloud.com/a/b'))[0], 'SoundCloud');
assert.equal(await parse('javascript:alert(1)'), null);
assert.equal(await parse('https://open.spotify.com/track/"><img src=x>'), null);
ok('YouTube, Apple Music, SoundCloud parsed; script and broken links refused');

console.log('A poll and a song');
await closeAll();
await page.evaluate(() => { document.getElementById('fab-compose').click(); });
await page.fill('#compose-ta', 'Pick one');
await page.click('#compose-song-toggle');
await page.fill('#compose-song-url', 'https://youtu.be/dQw4w9WgXcQ');
await page.click('#compose-poll-toggle');
const opts = await page.$$('.poll-opt-input');
await opts[0].fill('A'); await opts[1].fill('B');
await page.click('#compose-post');
assert.equal(await page.evaluate(() => window.__calls.length), 1);
ok('refused together, nothing sent');
await closeAll();

console.log('On the board');
await page.evaluate(() => {
  localPosts = [
    { id: 'a1', tab: 'general', text: 'Song of the week', isAdmin: true, name: 'x', likes: 0, commentCount: 0, timestamp: new Date(), audio: { url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' } },
    { id: 'm1', tab: 'general', text: 'Member post', name: 'Sam', likes: 0, commentCount: 0, timestamp: new Date(), audio: { url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC' } },
  ];
  renderPosts(assembleGeneralPosts(localPosts));
});
const n = await page.evaluate(() => document.querySelectorAll('.post-audio').length);
assert.equal(n, 1);
ok('only the admin post has a player; a member post with `audio` shows none (negative control)');
assert.equal(await page.textContent('.post-audio-play'), '▶ Play on Spotify');
assert.equal(await page.getAttribute('.post-audio-open', 'href'), 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
assert.equal(await page.evaluate(() => document.querySelectorAll('iframe').length), 0);
ok('nothing from Spotify loads before Play');
await page.click('.post-audio-play');
const fr = await page.evaluate(() => { const f = document.querySelector('.post-audio-frame'); return f && [f.src, f.height]; });
assert.deepEqual(fr, ['https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC', '152']);
assert.deepEqual(await page.evaluate(() => window.__opened), []);
ok('Play swaps in Spotify\'s player and does not open the thread');

assert.deepEqual(errors, []);
ok('no page errors');
console.log(`\n${passed} passed`);
await browser.close();
server.close();
