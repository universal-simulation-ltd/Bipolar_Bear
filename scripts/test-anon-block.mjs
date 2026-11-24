#!/usr/bin/env node
/**
 * Bipolar Anonymous 1.47 (App Review refused 1.46 on 2026-11-24):
 *
 *  1. 🚫 Block (was 🙈 Mute), guideline 1.2: blocking someone takes their
 *     posts out of the feed and their replies out of the open thread at once,
 *     lists them under About → Blocked people, AND files a report
 *     (bbAnonReports, type 'block') naming the post or comment it came from.
 *     A report that can't be written yet waits on the device and is sent
 *     later. Earlier mutes (localStorage Anon_muted) carry over as blocks.
 *     The server side: onAnonReportCreated emails the moderators a block
 *     (ids only, never the moniker or text); a normal report is unchanged.
 *  2. Guideline 2.3.10: inside the Bipolar Anonymous iPhone app (the built
 *     www-anonymous bundle with Capacitor platform 'ios') no "Google Play" or
 *     "Android" text renders, the Bear card shows only the App Store badge,
 *     and the privacy links carry ?app=ios, where privacy.html shows its
 *     iPhone wording. The web and Android keep both badges (controls).
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-anon-block.mjs
 *   (2. needs `node scripts/build-anonymous.js` first, for www-anonymous/.)
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 1b. Server: the moderators' email ────────────────────────────────────────
console.log('Server: onAnonReportCreated');
{
  const src = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
  const body = src.slice(src.indexOf('const REPORT_REASONS'), src.indexOf('// ── backfillUserCounts'));
  const sent = [];
  class Resend { constructor() { this.emails = { send: async m => { sent.push(m); return { error: null }; } }; } }
  const exportsObj = {};
  new Function('exports', 'onDocumentCreated', 'REGION', 'RESEND_API_KEY', 'Resend', 'FROM_ADDRESS', 'FEEDBACK_TO', body)(
    exportsObj, (_opts, fn) => fn, 'europe-west1', { value: () => 'k' }, Resend, 'from@x', 'bipolar@unisim.co.uk');
  const run = (doc, id) => exportsObj.onAnonReportCreated({ data: { data: () => doc }, params: { reportId: id } });
  await run({ type: 'block', reason: 'Blocked by a member', targetName: 'Bob', postName: 'Bob', postText: 'nasty words', postId: 'p1', commentId: 'c9', kind: 'comment' }, 'r1');
  const m = sent.pop();
  assert.equal(m.to, 'bipolar@unisim.co.uk');
  assert.match(m.subject, /🚫 Member blocked from a comment \(post p1\)/);
  assert.match(m.text, /Type: Block/);
  assert.match(m.text, /Reason: Blocked by a member/);
  assert.match(m.text, /Comment: c9/);
  assert.match(m.text, /anonymous\.html\?post=p1/);
  assert.doesNotMatch(m.text + m.subject, /Bob|nasty/);
  ok('a block emails bipolar@unisim.co.uk with the post + comment ids and a link, never the moniker or text');
  await run({ type: 'report', reason: 'Spam', postId: 'p2', postName: 'Eve', postText: 'buy' }, 'r2');
  const r = sent.pop();
  assert.match(r.subject, /🚨 Post reported: Spam \(post p2\)/);
  assert.match(r.text, /Type: Report/);
  ok('a normal report reads as before (control)');
}

// ── Browser ─────────────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webp': 'image/webp' };
function serve(dir) {
  const server = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
const FIREBASE_STUB = fs.readFileSync(path.join(ROOT, 'scripts/test-pdf-progress.mjs'), 'utf8').split('const FIREBASE_STUB = `')[1].split('`;')[0];
const browser = await chromium.launch();

async function open(base, file, { platform = null, local = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) errors.push(e.message); });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (u.startsWith(base)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
    return route.abort();
  });
  await page.addInitScript(({ platform, local }) => {
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      localStorage.setItem('bbLanguage', 'en');
      localStorage.setItem('bbAnon_monika', 'TestBear');
      for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
    }
    if (platform) {
      window.Capacitor = {
        isNativePlatform: () => true, getPlatform: () => platform,
        Plugins: { App: { addListener: () => Promise.resolve({ remove() {} }) } },
      };
    }
  }, { platform, local });
  await page.goto(base + '/' + file);
  await page.waitForFunction(() => window.BB && typeof BB.t === 'function' && typeof window.setupOverlayActions === 'function');
  await sleep(1500);   // let the signed-out auth listener settle
  return { ctx, page, errors };
}

// A board with Bob (two posts, one reply), Alice and Carol (a reply each).
async function seedBoard(page, { failWrites = false } = {}) {
  await page.evaluate(({ failWrites }) => {
    window.__adds = []; window.__updates = []; window.__fail = failWrites;
    window._ensureAuthSession = async () => {};
    const coll = (name) => ({
      add: async (doc) => { if (window.__fail) throw new Error('offline'); window.__adds.push([name, doc]); return { id: 'r' + window.__adds.length }; },
      doc: (id) => ({ update: async (d) => { window.__updates.push([name, id, d]); }, set: async () => {}, get: async () => ({ exists: false }),
        collection: () => coll(name + '/' + id + '/sub') }),
      where: () => coll(name), orderBy: () => coll(name), limit: () => coll(name), onSnapshot: () => () => {},
    });
    db = { collection: coll };
    if (!_boardSetupDone) { setupThread(); setupOverlayActions(); bindLongPress(document.getElementById('post-list'), '.post-card'); _boardSetupDone = true; }
    document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; s.classList.remove('active'); });
    const b = document.getElementById('screen-board'); b.style.display = 'flex'; b.classList.add('active');
    currentTab = 'general';
    const t = (m) => new Date(Date.now() - m * 60000);
    localPosts = [
      { id: 'p-bob-1', tab: 'general', name: 'Bob', text: 'Bob first post', timestamp: t(5), commentCount: 2 },
      { id: 'p-alice', tab: 'general', name: 'Alice', text: 'Alice says hi', timestamp: t(4) },
      { id: 'p-bob-2', tab: 'general', name: 'Bob', text: 'Bob second post', timestamp: t(3) },
    ];
    renderPosts(assembleGeneralPosts(localPosts));
  }, { failWrites });
}
const feedNames = (page) => page.evaluate(() => [...document.querySelectorAll('#post-list .post-card[data-pid]')].map(c => c.dataset.pid));

// ── 1a. Block from a post ───────────────────────────────────────────────────
console.log('Board: block from a post');
{
  const { ctx, page, errors } = await open((await serve(ROOT)).base, 'anonymous.html');
  await seedBoard(page);
  assert.deepEqual((await feedNames(page)).filter(id => id.startsWith('p-')).sort(), ['p-alice', 'p-bob-1', 'p-bob-2']);
  // The ⋯ sheet lists "Block this person" (red, like Report) on Bob's post.
  await page.evaluate(() => openActions(document.querySelector('.post-card[data-pid="p-bob-2"]')));
  const rows = await page.evaluate(() => [...document.querySelectorAll('#actions-list .action-row')].map(r => ({ t: r.textContent.trim(), danger: r.classList.contains('action-danger') })));
  const blockRow = rows.find(r => /Block this person/.test(r.t));
  assert.ok(blockRow && blockRow.danger && blockRow.t.startsWith('🚫'), JSON.stringify(rows));
  assert.ok(!rows.some(r => /Mute/i.test(r.t)), 'no Mute left');
  ok('⋯ on a post offers 🚫 Block this person (no Mute)');
  await page.click('#actions-list .action-row:has-text("Block this person")');
  assert.equal(await page.evaluate(() => !document.getElementById('ov-mute').classList.contains('hidden')), true);
  const sheet = await page.textContent('#ov-mute');
  assert.match(sheet, /Block this person\?/);
  assert.match(sheet, /Block \[Bob\]\? Their posts and comments disappear for you straight away, and our moderators are told/);
  assert.match(sheet, /Block 🚫/);
  ok('the sheet asks "Block [Bob]?" and says the moderators are told');
  await page.click('#mute-confirm');
  const after = await feedNames(page);
  assert.ok(!after.includes('p-bob-1') && !after.includes('p-bob-2') && after.includes('p-alice'), JSON.stringify(after));
  ok('both of Bob\'s posts leave the feed at once; Alice stays');
  assert.match(await page.textContent('#fab-hint'), /\[Bob\] blocked\. Our moderators have been told/);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('bbAnon_muted') || localStorage.getItem('Anon_muted') || '[]')), ['Bob']);
  await page.waitForFunction(() => window.__adds.length === 1);
  const [coll, doc] = await page.evaluate(() => window.__adds[0]);
  assert.equal(coll, 'bbAnonReports');
  assert.equal(doc.type, 'block');
  assert.equal(doc.reason, 'Blocked by a member');
  assert.equal(doc.targetName, 'Bob');
  assert.equal(doc.postId, 'p-bob-2');
  assert.equal(doc.postText, 'Bob second post');
  assert.equal(doc.reportedBy, 'TestBear');
  assert.equal(doc.commentId, undefined);
  assert.deepEqual(await page.evaluate(() => window.__updates), [['bbAnonPosts', 'p-bob-2', { reported: true }]]);
  ok('a block report goes to bbAnonReports (type block, Bob, post p-bob-2, its text) and the post is kept past the sweep');

  // About → Blocked people → Unblock brings Bob back.
  await page.evaluate(() => openAbout());
  assert.match(await page.textContent('#about-muted-wrap'), /Blocked people\s*🚫 \[Bob\]\s*Unblock/);
  ok('About lists 🚫 [Bob] under Blocked people');
  await page.click('[data-unmute="Bob"]');
  assert.ok((await feedNames(page)).includes('p-bob-1'));
  ok('Unblock brings his posts back');
  assert.deepEqual(errors, []);
  await ctx.close();
}

// ── 1a. Block from a reply in the open thread ───────────────────────────────
console.log('Board: block from a reply');
{
  const { ctx, page, errors } = await open((await serve(ROOT)).base, 'anonymous.html');
  await seedBoard(page);
  await page.evaluate(() => {
    // An open thread on Alice's post with replies from Carol and Bob.
    commentTargetId = 'p-alice';
    const t = (m) => new Date(Date.now() - m * 60000);
    _threadDocs = { post: localPosts[1], comments: [
      { id: 'c1', name: 'Carol', text: 'Carol is rude here', timestamp: t(2) },
      { id: 'c2', name: 'Bob', text: 'Bob replies', timestamp: t(1) },
    ] };
    document.getElementById('thread-comments-list').innerHTML = _threadDocs.comments.map(renderComment).join('');
    openOv('ov-thread');
  });
  await page.evaluate(() => document.querySelector('.comment-card[data-cid="c1"] [data-cmute]').click());
  assert.match(await page.textContent('#mute-body'), /Block \[Carol\]\?/);
  await page.click('#mute-confirm');
  const left = await page.evaluate(() => [...document.querySelectorAll('#thread-comments-list .comment-card')].map(c => c.dataset.cid));
  assert.deepEqual(left, ['c2']);
  assert.equal(await page.evaluate(() => _threadDocs.comments.map(c => c.id).join()), 'c2');
  assert.equal(await page.evaluate(() => !document.getElementById('ov-thread').classList.contains('hidden')), true);
  ok('Carol\'s reply leaves the open thread at once; the thread stays open');
  await page.waitForFunction(() => window.__adds.length === 1);
  const doc = await page.evaluate(() => window.__adds[0][1]);
  assert.equal(doc.type, 'block'); assert.equal(doc.targetName, 'Carol');
  assert.equal(doc.postId, 'p-alice'); assert.equal(doc.commentId, 'c1'); assert.equal(doc.kind, 'comment');
  assert.match(doc.postText, /Carol is rude here/);
  assert.deepEqual(await page.evaluate(() => window.__updates), []);
  ok('the report names the comment (c1) in its thread (p-alice); the post itself isn\'t flagged');
  // Blocking the thread's own author closes the thread.
  await page.evaluate(() => { _threadDocs.post = { ...localPosts[1] }; });
  await page.evaluate(() => openBlock('Alice', { postId: 'p-alice', commentId: '', text: 'Alice says hi' }));
  await page.click('#mute-confirm');
  assert.equal(await page.evaluate(() => document.getElementById('ov-thread').classList.contains('hidden')), true);
  ok('blocking the thread\'s author closes the thread');
  assert.deepEqual(errors, []);
  await ctx.close();
}

// ── 1a. Offline: the report waits and goes later; old mutes carry over ──────
console.log('Board: offline block, and mutes from before 1.47');
{
  const { ctx, page, errors } = await open((await serve(ROOT)).base, 'anonymous.html', { local: { bbAnon_muted: JSON.stringify(['Zed']) } });
  assert.deepEqual(await page.evaluate(() => [...blockedUsers]), ['Zed']);
  ok('a mute saved by an earlier version reads as a block');
  await seedBoard(page, { failWrites: true });
  await page.evaluate(() => openBlock('Bob', { postId: 'p-bob-1', commentId: '', text: 'Bob first post' }));
  await page.click('#mute-confirm');
  assert.ok(!(await feedNames(page)).includes('p-bob-1'));
  await page.waitForFunction(() => (BB.storage.get('Anon_blockReportsPending') || '').includes('p-bob-1'), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__adds.length), 0);
  ok('offline: Bob is still hidden at once, and the report waits on the device');
  await page.evaluate(() => { window.__fail = false; window.dispatchEvent(new Event('online')); });
  await page.waitForFunction(() => window.__adds.length === 1);
  assert.equal(await page.evaluate(() => window.__adds[0][1].targetName), 'Bob');
  await page.waitForFunction(() => !BB.storage.get('Anon_blockReportsPending'));
  ok('back online: the waiting report is sent and cleared');
  assert.deepEqual(errors, []);
  await ctx.close();
}

// ── 2. No Google Play / Android in the iPhone app ───────────────────────────
console.log('iPhone app: no Google Play or Android');
const visibleText = (page) => page.evaluate(() => {
  const c = document.body.cloneNode(true);
  c.querySelectorAll('script, style, noscript').forEach(n => n.remove());
  const attrs = [...c.querySelectorAll('[title],[aria-label],[alt],[placeholder]')]
    .map(n => [n.getAttribute('title'), n.getAttribute('aria-label'), n.getAttribute('alt'), n.getAttribute('placeholder')].join(' '));
  return c.textContent + ' ' + attrs.join(' ') + ' ' + document.title;
});
async function showEverything(page) {
  // Every screen's text: the announcements tab, About, the terms and the
  // privacy sheet are all in the DOM (hidden or not), so render the Bear
  // card and walk the whole document.
  await page.evaluate(() => {
    currentTab = 'announcements';
    renderPosts(announcementFeed());
    if (typeof openAbout === 'function') openAbout();
  });
}
const anonDir = path.join(ROOT, 'www-anonymous');
if (fs.existsSync(path.join(anonDir, 'index.html'))) {
  const anon = await serve(anonDir);
  for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'sv', 'zh']) {
    const { ctx, page, errors } = await open(anon.base, 'index.html', { platform: 'ios', local: { bbLanguage: lang } });
    assert.equal(await page.evaluate(() => BB.isAnonymousApp() && window.isIOS()), true);
    await showEverything(page);
    const txt = await visibleText(page);
    assert.doesNotMatch(txt, /Google Play|Play Store|play\.google|Android|安卓/i, lang);
    const badges = await page.evaluate(() => [...document.querySelectorAll('.ann-store-badge')].map(a => a.href));
    assert.deepEqual(badges, ['https://apps.apple.com/gb/app/bipolar-bear/id6766637453']);
    assert.ok(await page.evaluate(() => !!document.querySelector('.ann-card img.ann-image')));
    const priv = await page.evaluate(() => [...document.querySelectorAll('a[href*="privacy.html"]')].map(a => a.href));
    assert.ok(priv.length >= 3 && priv.every(h => h === 'https://www.bipolarbear.app/privacy.html?app=ios'), JSON.stringify(priv));
    assert.deepEqual(errors, []);
    ok(`${lang}: no Google Play / Android anywhere in the document; the Bear card has its picture and only the App Store badge; privacy links carry ?app=ios`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(anon.base, 'index.html', { platform: 'android' });
    await showEverything(page);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.ann-store-badge').length), 2);
    assert.match(await visibleText(page), /Google Play/);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('a[href*="privacy.html"]')].every(a => !a.href.includes('app=ios'))), true);
    ok('Android app keeps both badges and the plain privacy link (control)');
    await ctx.close();
  }
  anon.server.close();
} else {
  console.log('  (skipped the Anonymous bundle: run node scripts/build-anonymous.js first)');
}
{
  const { ctx, page } = await open((await serve(ROOT)).base, 'anonymous.html');
  await showEverything(page);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.ann-store-badge').length), 2);
  assert.match(await page.evaluate(() => document.querySelector('.ann-card:has(.ann-store-badges) .post-text').textContent), /iPhone and Android/);
  ok('the website keeps both badges and the iPhone-and-Android text (control)');
  await ctx.close();
}

console.log('privacy.html?app=ios');
{
  const srv = await serve(ROOT);
  for (const [lang, q, expectAndroid] of [['en', '?app=ios', false], ['fr', '?app=ios', false], ['en', '', true]]) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.route('**/*', r => r.request().url().startsWith(srv.base) ? r.continue() : r.abort());
    await page.addInitScript(l => localStorage.setItem('bbLanguage', l), lang);
    await page.goto(srv.base + '/privacy.html' + q);
    await page.waitForFunction(() => window.BB && BB.i18n);
    await sleep(300);
    const t = await page.evaluate(() => { const c = document.body.cloneNode(true); c.querySelectorAll('script').forEach(n => n.remove()); return c.textContent; });
    if (expectAndroid) {
      assert.match(t, /Android/); assert.match(t, /Google Play/);
    } else {
      assert.doesNotMatch(t, /Android|Google Play/, lang);
      assert.match(t, /App Store/);
    }
    ok(`${lang}${q || ' (no ?app)'}: ${expectAndroid ? 'Android + Google Play as before (control)' : 'no Android or Google Play, App Store kept'}`);
    await ctx.close();
  }
  srv.server.close();
}

await browser.close();
console.log(`\n${passed} passed`);
process.exit(0);
