#!/usr/bin/env node
/**
 * Browser check for the Bipolar Anonymous Wiki tab in other languages
 * (js/anonymous.js _wikiMtBar, James 2026-10-10). The articles are
 * machine-translated once and committed (js/shared/i18n.js anon.wiki.a.*); this
 * proves that a reader on fr / de sees the translation with a notice at the top
 * of each translated article ("Machine-translated from the original English —
 * the original wording is the authority") and a "Show original (English)"
 * toggle that swaps title + body to the English and back; that links, phone
 * numbers and organisation names survive translation; and that English
 * readers see no notice.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-wiki-translation.mjs
 *   SHOTS=<dir> also saves light + dark screenshots.
 *
 * Drives the REAL anonymous.html with the Firebase SDKs faked at the network
 * edge; nothing touches a real account or the translation API.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  window.__xlateCalls = 0;
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
  var fns = function(){ return { httpsCallable: function(name){ return function(){ if (name === 'translateAnonTexts') window.__xlateCalls++; return new Promise(function(){}); }; } }; };
  window.firebase = { apps: apps, initializeApp: function(){ apps.push({}); return {}; }, app: function(){ return { functions: fns }; },
    auth: auth, firestore: fs, functions: fns, messaging: function(){ return chain(); } };
})();`;

const browser = await chromium.launch();
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }

async function openWiki(lang, theme, section) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  page.on('dialog', d => d.dismiss());
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(BASE)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
    if (u.includes('gstatic.com/firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    if (u.includes('gstatic.com/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    return route.abort();
  });
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem('bbLanguage', lang);
    localStorage.setItem('bbAnonTheme', theme);
    localStorage.setItem('bbAnon_monika', 'TestBear');
    localStorage.setItem('bbAnon_verified', 'true');
    localStorage.setItem('bbAnon_agreedTerms', 'true');
  }, { lang, theme });
  await page.goto(BASE + '/anonymous.html');
  await page.waitForFunction(() => typeof window.openWikiSection === 'function' || typeof openWikiSection === 'function');
  await page.waitForTimeout(400);
  // Show the board whatever the (faked, signed-out) boot decided, then the wiki.
  await page.evaluate(section => {
    document.querySelectorAll('.screen.active').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.ov.open, .ov.show').forEach(o => o.classList.remove('open', 'show'));
    document.getElementById('screen-board').classList.add('active');
    openWikiSection(section);
  }, section);
  await page.waitForSelector('#wiki-body .wiki-card');
  return { ctx, page };
}

const NOTICE = {
  fr: /Traduit automatiquement de l'original en anglais — c'est le texte original qui fait foi\./,
  de: /Maschinell aus dem englischen Original übersetzt – maßgeblich ist der Originalwortlaut\./,
};
const SHOW_ORIG = { fr: "Voir l'original (anglais)", de: 'Original anzeigen (Englisch)' };
const SHOW_TR = { fr: 'Voir la traduction', de: 'Übersetzung anzeigen' };

for (const lang of ['fr', 'de']) {
  console.log(`Wiki — ${lang}`);
  for (const theme of ['light', 'dark']) {
    const { ctx, page } = await openWiki(lang, theme, 'lovedOnes');
    const card = page.locator('#wiki-body .wiki-card').filter({ has: page.locator('summary span[data-wiki-en="When to Call for Help"]') });
    await card.locator('summary').click();
    const bar = card.locator('.wiki-mt');
    assert.equal(await bar.count(), 1, 'translated article has the notice');
    assert.match(await bar.textContent(), NOTICE[lang]);
    const body = card.locator('.wiki-card-body > p').first();
    const trBody = await body.textContent();
    const trTitle = await card.locator('summary > span').first().textContent();
    assert.doesNotMatch(trBody, /Call the CMHT or crisis team/, 'reads translated');
    for (const keep of ['999', '116 123', 'Samaritans', 'Bipolar UK', 'CMHT']) assert.ok(trBody.includes(keep), `kept "${keep}" as written`);
    const href = await card.locator('a.wiki-link-btn').getAttribute('href');
    assert.equal(href, 'https://www.nhs.uk/mental-health/advice-for-life-situations-and-events/help-for-suicidal-thoughts/', 'link untouched');
    if (theme === 'light') ok('translated article: notice at the top; 999, 116 123, Samaritans, Bipolar UK, CMHT and the NHS link kept as written');
    if (process.env.SHOTS) await card.screenshot({ path: path.join(process.env.SHOTS, `wiki-${lang}-${theme}-translated.png`) });

    const toggle = card.locator('.wiki-mt-toggle');
    assert.equal((await toggle.textContent()).trim(), SHOW_ORIG[lang]);
    await toggle.click();
    assert.match(await body.textContent(), /^Call the CMHT or crisis team/, 'shows the English body');
    assert.equal((await card.locator('summary > span').first().textContent()).trim(), 'When to Call for Help', 'shows the English title');
    assert.equal(await body.getAttribute('lang'), 'en');
    assert.equal((await toggle.textContent()).trim(), SHOW_TR[lang]);
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.ok(await card.evaluate(d => d.open), 'the card stays open');
    if (process.env.SHOTS) await card.screenshot({ path: path.join(process.env.SHOTS, `wiki-${lang}-${theme}-original.png`) });
    await toggle.click();
    assert.equal(await body.textContent(), trBody);
    assert.equal(await card.locator('summary > span').first().textContent(), trTitle);
    if (theme === 'light') ok('"Show original (English)" swaps title + body to English (lang="en") and back');

    // Every translated article in the section carries exactly one notice.
    const counts = await page.evaluate(() => [...document.querySelectorAll('#wiki-body .wiki-card')].map(c => c.querySelectorAll('.wiki-mt').length));
    assert.ok(counts.length >= 8 && counts.every(n => n === 1), 'one notice per article: ' + counts.join(','));
    assert.equal(await page.evaluate(() => window.__xlateCalls), 0, 'no runtime translation call for the curated wiki');
    if (theme === 'light') ok('one notice per article in the section; no runtime translation call (committed translations)');

    if (theme === 'dark') {
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.ok(await page.evaluate(() => document.documentElement.classList.contains('theme-dark')), 'dark theme applied');
      const barBg = await bar.evaluate(b => getComputedStyle(b).backgroundColor);
      assert.notEqual(barBg, 'rgb(255, 253, 231)', 'notice follows the dark palette');
      ok(`dark mode: notice drawn on the dark palette (body ${bg}, notice ${barBg})`);
    }
    await ctx.close();
  }
  {
    // 12 Steps: the statement is the Survival Kit's hand-translated string; the
    // toggle shows its English too. Toggle state survives a section change.
    const { ctx, page } = await openWiki(lang, 'light', 'twelveSteps');
    const card = page.locator('#wiki-body .wiki-card').first();
    await card.locator('summary').click();
    await card.locator('.wiki-mt-toggle').click();
    assert.match(await card.locator('.wiki-step-text').textContent(), /^I admitted I was powerless over my condition/);
    assert.match(await card.locator('.wiki-notes').textContent(), /^This isn't giving up/);
    await page.evaluate(() => { setWikiSection('meds'); setWikiSection('twelveSteps'); });
    const again = page.locator('#wiki-body .wiki-card').first();
    assert.match(await again.locator('.wiki-step-text').textContent(), /^I admitted/, 'choice kept across a re-render');
    ok('12 Steps: statement + practice note toggle to English; the choice survives a re-render');
    await ctx.close();
  }
}
{
  console.log('Wiki — en');
  const { ctx, page } = await openWiki('en', 'light', 'conditions');
  assert.equal(await page.locator('#wiki-body .wiki-mt').count(), 0);
  assert.equal(await page.locator('#wiki-body [data-wiki-en]').count(), 0);
  ok('English readers see no notice and no toggle');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} checks passed`);
