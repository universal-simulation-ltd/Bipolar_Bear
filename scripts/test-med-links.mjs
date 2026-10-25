#!/usr/bin/env node
/**
 * Browser check for medicine names in Bipolar Anonymous posts linking to the
 * wiki (js/shared/med-links.js, James 2026-10-25), at phone width (390 px).
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-med-links.mjs
 *   SHOTS=<dir> also saves screenshots.
 *
 * Covers: the matcher (generic, brand, local spelling, misspelling, case,
 * plural, Chinese, whole words only, first mention per page); post text can't
 * inject HTML; admin notices, announcements and crisis text get no links; a
 * tap opens that medicine's wiki card in the app with the "talk to your
 * doctor or pharmacist" note and a way back; links survive a translation swap
 * and "Show original"; the "Don't link medicine names" switch (unticked by
 * default) turns them off; the strings exist in all ten languages; and the
 * crisis check agrees with functions/crisis-bot.js.
 *
 * Drives the REAL anonymous.html with the Firebase SDKs faked at the network
 * edge; nothing touches a real account or the translation API.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const FIREBASE_STUB = `
(function(){
  function chain(){
    var p = new Proxy(function(){}, {
      get: function(_t, k){
        if (k === 'then') return undefined;
        if (k === 'get') return function(){ return new Promise(function(){}); };
        if (['set','update','delete','add','enablePersistence','clearPersistence'].indexOf(k) >= 0) return function(){ return Promise.resolve(); };
        if (k === 'onSnapshot') return function(){ return function(){}; };
        return function(){ return p; };
      },
      apply: function(){ return p; },
    });
    return p;
  }
  var authObj = {
    currentUser: null,
    setPersistence: function(){ return Promise.resolve(); },
    onAuthStateChanged: function(cb){ setTimeout(function(){ cb(null); }, 50); return function(){}; },
    onIdTokenChanged: function(){ return function(){}; },
    signInAnonymously: function(){ return new Promise(function(){}); },
    signOut: function(){ return Promise.resolve(); },
  };
  var auth = function(){ return authObj; };
  auth.Auth = { Persistence: { SESSION: 'session', LOCAL: 'local' } };
  var fs = function(){ return chain(); };
  fs.FieldValue = { delete: function(){}, serverTimestamp: function(){}, increment: function(n){ return n; }, arrayUnion: function(){ return []; }, arrayRemove: function(){ return []; } };
  fs.Timestamp = { now: function(){ return { toMillis: function(){ return Date.now(); } }; }, fromMillis: function(m){ return { toMillis: function(){ return m; } }; } };
  var apps = [];
  var fns = function(){ return { httpsCallable: function(){ return function(){ return new Promise(function(){}); }; } }; };
  window.firebase = { apps: apps, initializeApp: function(){ apps.push({}); return {}; }, app: function(){ return { functions: fns }; },
    auth: auth, firestore: fs, functions: fns, messaging: function(){ return chain(); } };
})();`;

const browser = await chromium.launch();
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }

async function openBoard(lang = 'en') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.dismiss());
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
    if (u.includes('firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    return route.abort();
  });
  await page.addInitScript(({ lang }) => {
    localStorage.setItem('bbLanguage', lang);
    localStorage.setItem('bbAnonTheme', 'light');
    localStorage.setItem('bbAnon_monika', 'TestBear');
    localStorage.setItem('bbAnon_verified', 'true');
    localStorage.setItem('bbAnon_agreedTerms', 'true');
  }, { lang });
  await page.goto(BASE + '/anonymous.html');
  await page.waitForFunction(() => typeof openWikiSection === 'function' && window.BB && BB.medLinks);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelectorAll('.screen.active').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-board').classList.add('active');
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
  });
  return { ctx, page, errors };
}

const POSTS = [
  { id: 'p1', name: 'Alice', tab: 'general', text: 'Started Priadel last week. My lithium level is fine, priadel again. Also SEROQUEL at night.' },
  { id: 'p2', name: 'Bob', tab: 'general', text: '<img src=x onerror="window.__pwned=1"> <b>bold</b> <a href="javascript:alert(1)">x</a> lamotragine & "quotes" <script>window.__pwned=2</script>' },
  { id: 'p3', name: 'Cara', tab: 'general', text: 'My Lithiumspiegel and xlithium and abilifyish are words, not medicines. The room was lit.' },
  { id: 'p4', name: 'Dee', tab: 'general', text: 'I want to overdose on my lithium tonight' },
  { id: 'p5', name: 'BipolarBear', tab: 'general', isAdmin: true, text: 'Moderator note: lithium posts welcome.' },
  { id: 'p6', name: 'Eve', tab: 'announcements', text: 'Announcement about quetiapine' },
  { id: 'p7', name: 'Finn', tab: 'general', text: 'SSRIs made me jittery; sertraline and Prozac too. 我在吃Seroquel和碳酸锂。锂电池 is a battery.' },
];

console.log('Medicine links — matcher');
{
  const { ctx, page, errors } = await openBoard('en');
  const r = await page.evaluate(() => {
    const f = t => BB.medLinks.find(t).map(h => h.page + ':' + h.text);
    return {
      brand: f('On Priadel and Seroquel, Depakote, Zyprexa, Abilify, Lamictal, Epilim, Camcolit'),
      generic: f('lithium quetiapine lamotrigine valproate olanzapine aripiprazole risperidone'),
      local: f('Quétiapine, Lithiumcarbonat, litio, Olanzapin, kwetiapina, Depakine, węglan litu'),
      typo: f('lamotragine and seroquil and olanzepine'),
      caseP: f('LITHIUM, Lithium, lItHiUm'),
      plural: f('antidepressants and SSRIs, two lithiums'),
      inside: f('Lithiumspiegel xlithium seroquelish abilify2 _lithium lit lite'),
      zh: f('我在吃Seroquel和碳酸锂。拉莫三嗪也是。锂电池不是药。'),
      zhBattery: f('锂电池'),
      first: f('lithium, Lithium, Priadel and lithium again'),
      pages: Object.keys(BB.medLinks.pages()).sort(),
    };
  });
  assert.deepEqual(r.brand, ['lithium:Priadel', 'quetiapine:Seroquel', 'valproate:Depakote', 'olanzapine:Zyprexa', 'aripiprazole:Abilify', 'lamotrigine:Lamictal']);
  ok('brand names → their page (Priadel, Seroquel, Depakote, Zyprexa, Abilify, Lamictal); Epilim/Camcolit are 2nd mentions of a page already linked');
  assert.deepEqual(r.generic.map(x => x.split(':')[0]), ['lithium', 'quetiapine', 'lamotrigine', 'valproate', 'olanzapine', 'aripiprazole', 'risperidone']);
  ok('generic names → all seven medicine pages');
  assert.deepEqual(r.local, ['quetiapine:Quétiapine', 'lithium:Lithiumcarbonat', 'olanzapine:Olanzapin', 'valproate:Depakine']);
  ok('local spellings and brands (Quétiapine, Lithiumcarbonat, Olanzapin, Depakine)');
  assert.deepEqual(r.typo, ['lamotrigine:lamotragine', 'quetiapine:seroquil', 'olanzapine:olanzepine']);
  ok('common misspellings (lamotragine, seroquil, olanzepine)');
  assert.deepEqual(r.caseP, ['lithium:LITHIUM']);
  ok('case-insensitive, and only the first mention links');
  assert.deepEqual(r.plural, ['antidepressant:antidepressants', 'lithium:lithiums']);
  ok('plurals (antidepressants, lithiums); SSRIs is the same page as antidepressants so not linked twice');
  assert.deepEqual(r.inside, []);
  ok('no match inside other words (Lithiumspiegel, xlithium, seroquelish, abilify2, _lithium) and "lit" is not lithium');
  assert.deepEqual(r.zh, ['quetiapine:Seroquel', 'lithium:碳酸锂', 'lamotrigine:拉莫三嗪']);
  assert.deepEqual(r.zhBattery, []);
  ok('Chinese: Seroquel inside Chinese text, 碳酸锂, 拉莫三嗪; 锂电池 (battery) is not lithium');
  assert.deepEqual(r.first, ['lithium:lithium']);
  ok('first mention per wiki page (lithium … Priadel … lithium → one link)');
  assert.deepEqual(r.pages, ['antidepressant', 'aripiprazole', 'lamotrigine', 'lithium', 'olanzapine', 'quetiapine', 'risperidone', 'valproate']);
  ok('only names with a wiki page are in play (8 pages)');
  assert.deepEqual(errors, []);
  await ctx.close();
}

console.log('Medicine links — on the board');
{
  const { ctx, page, errors } = await openBoard('en');
  await page.evaluate(posts => { renderPosts(posts); }, POSTS);
  const feed = await page.evaluate(() => {
    const card = id => document.querySelector(`#post-list [data-pid="${id}"]`);
    const links = id => { const c = card(id); return c ? [...c.querySelectorAll('a.med-link')].map(a => a.dataset.med + ':' + a.textContent) : null; };
    const p2 = card('p2').querySelector('.post-text');
    return {
      p1: links('p1'), p1Text: card('p1').querySelector('.post-text').textContent,
      p2: links('p2'), p2Tags: [...p2.querySelectorAll('*')].map(e => e.tagName), p2Text: p2.textContent,
      pwned: window.__pwned || null,
      p3: links('p3'), p4: links('p4'), p5: links('p5'), p6: links('p6'), p7: links('p7'),
      after: getComputedStyle(card('p1').querySelector('a.med-link'), '::after').content,
      deco: getComputedStyle(card('p1').querySelector('a.med-link')).textDecorationStyle,
      href: card('p1').querySelector('a.med-link').getAttribute('href'),
    };
  });
  assert.deepEqual(feed.p1, ['lithium:Priadel', 'quetiapine:SEROQUEL']);
  assert.equal(feed.p1Text, POSTS[0].text, 'the words on screen are exactly the post');
  ok('post: first mention of each page links (Priadel → lithium page; "lithium" and the 2nd "priadel" stay plain); text unchanged');
  assert.deepEqual(feed.p2, ['lamotrigine:lamotragine']);
  assert.deepEqual(feed.p2Tags, ['A'], 'the only element inside the post is our link');
  assert.equal(feed.p2Text, POSTS[1].text, 'markup in a post shows as text');
  assert.equal(feed.pwned, null);
  ok('no HTML injection: <img onerror>, <b>, <a href=javascript:>, <script> stay text; the only element is the med link');
  assert.deepEqual(feed.p3, []);
  ok('no false positives on the board (Lithiumspiegel, xlithium, abilifyish, "lit")');
  assert.deepEqual(feed.p4, []);
  ok('crisis post ("I want to overdose on my lithium") gets no link');
  assert.deepEqual(feed.p5, []);
  ok('moderator/admin post gets no link');
  assert.deepEqual(feed.p6, [], 'a post from the announcements tab never links');
  const ann = await page.evaluate(() => { setTab('announcements'); renderPosts([{ id: 'a1', tab: 'announcements', name: 'Eve', text: 'Announcement about quetiapine' }, { id: 'a2', isAnnouncement: true, text: 'Built-in about lithium' }]); return document.querySelectorAll('#post-list a.med-link').length; });
  assert.equal(ann, 0);
  ok('announcements (published and built-in) get no link');
  await page.evaluate(posts => { setTab('general'); renderPosts(posts); }, POSTS);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#post-list [data-pid="p7"] a.med-link')].map(a => a.dataset.med + ':' + a.textContent)),
    ['antidepressant:SSRIs', 'quetiapine:Seroquel', 'lithium:碳酸锂']);
  ok('mixed English/Chinese post: SSRIs, Seroquel, 碳酸锂 (sertraline/Prozac are the same antidepressant page, not linked twice)');
  assert.match(feed.after, /💊/);
  assert.equal(feed.deco, 'dotted');
  assert.equal(feed.href, '#wiki-lithium_mood_stabiliser');
  ok('subtle: dotted underline + small 💊 drawn by CSS (not in the text)');
  if (process.env.SHOTS) await page.locator('#post-list [data-pid="p1"]').screenshot({ path: path.join(process.env.SHOTS, 'medlink-post.png') });

  // Comments + thread header.
  const th = await page.evaluate(() => {
    const el = document.getElementById('thread-comments-list');
    el.innerHTML = [
      { id: 'c1', name: 'Gus', text: 'Abilify gave me restlessness' },
      { id: 'c2', name: 'BipolarBear', isAdmin: true, text: 'Admin: talk to your GP about Abilify' },
      { id: 'c3', name: 'Friendly neighbourhood Bipolar Bear', isBot: true, botKind: 'crisis', text: 'lithium' },
    ].map(renderComment).join('');
    _scanMemberText(el);
    const r = [...el.querySelectorAll('a.med-link')].map(a => a.dataset.med);
    _setThreadMedLinkSkip(true); BB.medLinks.scan(el);
    const skipped = el.querySelectorAll('a.med-link').length;
    _setThreadMedLinkSkip(false); BB.medLinks.scan(el);
    return { r, skipped, back: el.querySelectorAll('a.med-link').length };
  });
  assert.deepEqual(th.r, ['aripiprazole']);
  assert.equal(th.skipped, 0);
  assert.equal(th.back, 1);
  ok('replies link; admin replies and the crisis bear do not; a thread the crisis bear answered loses its links');

  // Tap → wiki card, note, back.
  await page.locator('#post-list [data-pid="p1"] a.med-link').first().click();
  const w = await page.evaluate(() => {
    const det = document.querySelector('#wiki-body .wiki-card[open]');
    return {
      tab: currentTab, section: document.getElementById('wiki-section').dataset.section,
      wikiShown: getComputedStyle(document.getElementById('wiki-section')).display !== 'none',
      openSlugs: [...document.querySelectorAll('#wiki-body .wiki-card[open]')].map(d => d.dataset.wikiSlug),
      title: det && det.querySelector('summary').textContent,
      note: det && det.querySelector('.wiki-from-post p').textContent,
      hash: location.hash,
      href: location.href,
    };
  });
  assert.equal(w.tab, 'wiki');
  assert.equal(w.section, 'meds');
  assert.ok(w.wikiShown);
  assert.deepEqual(w.openSlugs, ['lithium_mood_stabiliser']);
  assert.match(w.title, /Lithium/);
  assert.match(w.note, /talk to your doctor or pharmacist before you change or stop any medicine/);
  assert.equal(w.hash, '', 'stays on the page (no navigation, no hash)');
  ok('tap opens the Lithium wiki card in the app (Wiki tab → Meds), with the doctor/pharmacist note; no navigation');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'medlink-wiki.png') });
  await page.locator('.wiki-from-post-back').click();
  assert.equal(await page.evaluate(() => currentTab), 'general');
  ok('"← Back to the post" returns to the feed');

  // Each page opens its own card.
  for (const [pid, slug] of [['p1', 'quetiapine_seroquel_antipsychotic'], ['p2', 'lamotrigine_lamictal_mood_stabiliser'], ['p7', 'antidepressants_use_with_caution']]) {
    await page.evaluate(posts => { setTab('general'); renderPosts(posts); }, POSTS);
    const sel = pid === 'p1' ? 'a.med-link[data-med="quetiapine"]' : 'a.med-link';
    await page.locator(`#post-list [data-pid="${pid}"] ${sel}`).first().click();
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#wiki-body .wiki-card[open]')].map(d => d.dataset.wikiSlug)), [slug]);
  }
  ok('Seroquel → Quetiapine card, lamotragine → Lamotrigine card, SSRIs → Antidepressants card');

  // Translation swap and "Show original" keep the links.
  await page.evaluate(posts => { setTab('general'); renderPosts(posts); }, POSTS);
  await page.evaluate(() => {
    BB.translate.init({ callable: ({ texts }) => Promise.resolve({ data: { results: texts.map(t => ({ text: t.indexOf('Priadel') >= 0 ? 'J’ai commencé le Priadel. Mon taux de lithium va bien. Et la quétiapine le soir.' : t, src: 'fr', same: t.indexOf('Priadel') < 0 })) } }) });
  });
  await page.waitForFunction(() => /quétiapine/.test(document.querySelector('#post-list [data-pid="p1"] .post-text').textContent));
  const tr = await page.evaluate(() => [...document.querySelectorAll('#post-list [data-pid="p1"] .post-text a.med-link')].map(a => a.dataset.med + ':' + a.textContent));
  assert.deepEqual(tr, ['lithium:Priadel', 'quetiapine:quétiapine']);
  await page.locator('#post-list [data-pid="p1"] .tt-toggle').click();
  const orig = await page.evaluate(() => [...document.querySelectorAll('#post-list [data-pid="p1"] .post-text a.med-link')].map(a => a.dataset.med + ':' + a.textContent));
  assert.deepEqual(orig, ['lithium:Priadel', 'quetiapine:SEROQUEL']);
  const origAttr = await page.evaluate(() => document.querySelector('#post-list [data-pid="p1"] .post-text').getAttribute('data-tt-orig'));
  assert.equal(origAttr, POSTS[0].text, 'what goes to translation is the post as written (no 💊)');
  ok('translated text gets its own links; "Show original" puts the original links back; the 💊 never reaches translation');

  // The switch.
  await page.evaluate(() => openMedSettings());
  const sw = page.locator('#med-ov-links [data-notif="off"]');
  assert.equal(await sw.getAttribute('aria-checked'), 'false', 'unticked by default');
  assert.match(await sw.textContent(), /Don't link medicine names/);
  if (process.env.SHOTS) await page.locator('#ov-med .sheet').screenshot({ path: path.join(process.env.SHOTS, 'medlink-switch.png') });
  await sw.click();
  await page.locator('#med-ov-save').click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#post-list a.med-link').length), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('bbAnonMedLinksOff')), 'true');
  await page.evaluate(posts => renderPosts(posts), POSTS);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#post-list a.med-link').length), 0, 'stays off on re-render');
  await page.evaluate(() => openMedSettings());
  assert.equal(await sw.getAttribute('aria-checked'), 'true');
  await page.locator('#med-ov-cancel').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('bbAnonMedLinksOff')), 'true', 'Cancel keeps the saved choice');
  await page.evaluate(() => openMedSettings());
  await sw.click();
  await page.locator('#med-ov-save').click();
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => document.querySelectorAll('#post-list a.med-link').length > 0));
  ok('"Don\'t link medicine names" (unticked by default) turns the links off, survives a re-render, and back on');

  // From inside a thread: the thread closes, the wiki opens, Back reopens it.
  await page.evaluate(posts => { setTab('general'); renderPosts(posts); postsByTab.general = posts; localPosts = posts; openThread('p1'); }, POSTS);
  await page.locator('#thread-original-post a.med-link').first().click();
  assert.deepEqual(await page.evaluate(() => ({ thread: document.getElementById('ov-thread').classList.contains('hidden'), tab: currentTab })), { thread: true, tab: 'wiki' });
  await page.locator('.wiki-from-post-back').click();
  assert.deepEqual(await page.evaluate(() => ({ thread: document.getElementById('ov-thread').classList.contains('hidden'), id: commentTargetId })), { thread: false, id: 'p1' });
  await page.evaluate(() => closeThread());
  ok('from a thread: the thread closes for the wiki, and Back opens the same thread again');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false);
  ok('no sideways scroll at 390 px');
  assert.deepEqual(errors.filter(e => !/firebase|Firestore|permission/i.test(e)), []);
  await ctx.close();
}

console.log('Medicine links — languages + crisis parity');
{
  const { ctx, page } = await openBoard('en');
  const langs = await page.evaluate(() => BB.i18n.getLanguages().map(l => l.code));
  assert.equal(langs.length, 10);
  const missing = await page.evaluate(codes => {
    const out = [];
    const en = {};
    for (const k of ['title', 'note', 'back', 'offLabel', 'offSub']) en[k] = BB.i18n.tEn('medlink.' + k);
    for (const c of codes) {
      BB.i18n.setLanguage(c);
      for (const k of Object.keys(en)) {
        const v = BB.t('medlink.' + k, { name: 'X' });
        if (!v || v === 'medlink.' + k || (c !== 'en' && v === en[k].replace('{name}', 'X'))) out.push(c + '.' + k);
      }
    }
    BB.i18n.setLanguage('en');
    return out;
  }, langs);
  assert.deepEqual(missing, []);
  ok('all five strings in all ten languages');
  const { looksLikeCrisis } = require(path.join(ROOT, 'functions/crisis-bot.js'));
  const SAMPLES = ['I want to die', 'thinking of suicide', 'took an overdose of lithium', 'self-harm again', 'can\'t go on', 'quiero morir', 'ich will sterben', '我想死', 'chcę umrzeć', 'vill dö',
    'lithium is fine', 'Seroquel makes me sleepy', 'I died laughing', 'need help with my dose', 'end of the day'];
  const browserSays = await page.evaluate(s => s.map(t => BB.medLinks.looksLikeCrisis(t)), SAMPLES);
  assert.deepEqual(browserSays, SAMPLES.map(t => looksLikeCrisis(t)));
  ok('crisis check matches functions/crisis-bot.js on ' + SAMPLES.length + ' sentences');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} checks passed`);
