#!/usr/bin/env node
/**
 * The onboarding tutorial end to end, and the home page's 🆘 Survival Kit /
 * 💬 Bipolar Anonymous buttons (James, 2026-10-23: both on by default, shown
 * from the first saved entry; a one-time migration turns them on for
 * existing users; a later "off" is kept, on this device and the next).
 *
 * Real pages (index.html, journal.html) at 390 px in headless Chromium.
 * Firebase is stubbed: auth is a guest unless a scenario signs in, and
 * Firestore keeps `userSettings/{uid}` in this script (SERVER below), so a
 * second browser context is "another device" on the same account.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-tutorial.mjs
 *   SHOTS=/some/dir … to save a screenshot at each tutorial step.
 *
 * 1. Walkthrough, step 0 → 12, as a person would: the web, an iPhone-like
 *    shell and an Android-like one (Android skips the step-5 logo hint). At
 *    each step: what is on screen, which hint shows, and that no hint points
 *    at something hidden.
 * 2. Reload mid-tutorial at each journal step: nothing gets stuck.
 * 3. The tutorial skip (hold the logo for 5 s) lands on step 12, both buttons.
 * 4. Home buttons: a fresh user sees both after the first entry; Customise
 *    turns either off and it stays off after a reload.
 * 5. Migration: an existing user with '0' stored here and false on the
 *    account gets both back once (local + account, with homeBtnsVersion 2);
 *    then turning one off survives a reload AND a fresh-device sign-in; an
 *    account already on version 2 is never overridden; an old device
 *    signing in to it takes the account's choice.
 * 6. Long-ago tutorial: an existing user sees no tutorial popup, only the
 *    New features note about the buttons.
 * 7. Every language has the reworded strings; the walkthrough's home page
 *    is also checked in Spanish.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;
const SHOTS = process.env.SHOTS || '';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/** The account side: `userSettings/{uid}` documents, shared by every context. */
const SERVER = {};

// Firebase compat stub. Auth: window.__T.user or a guest. Firestore: a doc
// get/set/update on userSettings goes to SERVER through __fsGet / __fsSet;
// every query answers "no documents"; other docs read as missing.
const FIREBASE_STUB = `
(function(){
  var T = window.__T || {};
  var user = T.user ? { uid: T.user.uid, email: T.user.email, isAnonymous: false, emailVerified: true,
    providerData: [{ providerId: 'password' }], getIdToken: function(){ return Promise.resolve('t'); },
    reload: function(){ return Promise.resolve(); } } : null;
  function snapDoc(path, r){ return { id: path.split('/').pop(), exists: !!(r && r.exists), data: function(){ return r && r.exists ? r.data : undefined; }, ref: ref(path.split('/')) }; }
  var EMPTY = { docs: [], empty: true, size: 0, forEach: function(){}, docChanges: function(){ return []; } };
  function ref(seg){
    var isDoc = seg.length % 2 === 0, path = seg.join('/');
    var o = {
      collection: function(n){ return ref(seg.concat([n])); },
      doc: function(id){ return ref(seg.concat([id || ('auto' + Math.random().toString(36).slice(2))])); },
      where: function(){ return o; }, orderBy: function(){ return o; }, limit: function(){ return o; },
      startAfter: function(){ return o; }, endBefore: function(){ return o; }, limitToLast: function(){ return o; },
      get: function(){ return isDoc ? window.__fsGet(path).then(function(r){ return snapDoc(path, r); }) : Promise.resolve(EMPTY); },
      set: function(data, opts){ return isDoc ? window.__fsSet(path, JSON.stringify(data === undefined ? {} : data), !!(opts && opts.merge)) : Promise.resolve(); },
      update: function(data){ return window.__fsSet(path, JSON.stringify(data || {}), true); },
      delete: function(){ return Promise.resolve(); },
      add: function(){ return Promise.resolve(ref(seg.concat(['added']))); },
      onSnapshot: function(cb){ try { if (!isDoc) setTimeout(function(){ cb(EMPTY); }, 0); } catch (_) {} return function(){}; },
      id: seg[seg.length - 1], path: path,
    };
    return o;
  }
  var db = { collection: function(n){ return ref([n]); }, doc: function(p){ return ref(p.split('/')); },
    batch: function(){ return { set: function(){}, update: function(){}, delete: function(){}, commit: function(){ return Promise.resolve(); } }; },
    runTransaction: function(fn){ return Promise.resolve(); },
    enablePersistence: function(){ return Promise.resolve(); }, clearPersistence: function(){ return Promise.resolve(); },
    settings: function(){} };
  var authObj = { currentUser: null, setPersistence: function(){ return Promise.resolve(); },
    onAuthStateChanged: function(cb){ setTimeout(function(){ authObj.currentUser = user; cb(user); }, 50); return function(){}; },
    onIdTokenChanged: function(){ return function(){}; }, signOut: function(){ return Promise.resolve(); } };
  var auth = function(){ return authObj; };
  auth.Auth = { Persistence: { SESSION: 'session', LOCAL: 'local', NONE: 'none' } };
  auth.EmailAuthProvider = { credential: function(){ return {}; } };
  var fsx = function(){ return db; };
  fsx.FieldValue = { delete: function(){ return null; }, serverTimestamp: function(){ return Date.now(); }, increment: function(n){ return n; }, arrayUnion: function(){ return []; }, arrayRemove: function(){ return []; } };
  fsx.Timestamp = { now: function(){ return { toMillis: function(){ return Date.now(); }, toDate: function(){ return new Date(); } }; }, fromMillis: function(m){ return { toMillis: function(){ return m; }, toDate: function(){ return new Date(m); } }; }, fromDate: function(d){ return { toMillis: function(){ return +d; }, toDate: function(){ return d; } }; } };
  var apps = [];
  var fns = function(){ return { httpsCallable: function(){ return function(){ return new Promise(function(){}); }; } }; };
  window.firebase = { apps: apps, initializeApp: function(){ apps.push({}); return {}; }, app: function(){ return { functions: fns }; },
    auth: auth, firestore: fsx, functions: fns, messaging: function(){ return { getToken: function(){ return Promise.reject(); }, onMessage: function(){} }; } };
})();`;

const browser = await chromium.launch();
let passed = 0;
const ok = name => { passed++; console.log('  ✓ ' + name); };
const errors = [];

/**
 * A browser context ("a device"). o: { platform: 'web'|'ios'|'android',
 * user: {uid,email} | null, local: {k:v} seeded once, lang }.
 */
async function device(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: o.platform && o.platform !== 'web' });
  await ctx.exposeFunction('__fsGet', p => {
    const parts = p.split('/');
    if (parts[0] !== 'userSettings') return { exists: false };
    return SERVER[parts[1]] ? { exists: true, data: JSON.parse(JSON.stringify(SERVER[parts[1]])) } : { exists: false };
  });
  await ctx.exposeFunction('__fsSet', (p, json, merge) => {
    const parts = p.split('/');
    if (parts[0] !== 'userSettings' || parts.length !== 2) return;
    const data = JSON.parse(json);
    SERVER[parts[1]] = merge ? Object.assign(SERVER[parts[1]] || {}, data) : data;
  });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (u.startsWith(BASE)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
    return route.abort();
  });
  await ctx.addInitScript(cfg => {
    window.__T = { user: cfg.user };
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      localStorage.setItem('bbLanguage', cfg.lang || 'en');
      localStorage.setItem('bbLangChosen', '1');
      localStorage.setItem('bbTheme', 'light');
      for (const [k, v] of Object.entries(cfg.local || {})) localStorage.setItem(k, v);
    }
    if (cfg.platform === 'ios' || cfg.platform === 'android') {
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => cfg.platform, Plugins: {},
        isPluginAvailable: () => false, registerPlugin: () => new Proxy({}, { get: () => () => Promise.reject(new Error('stub')) }) };
    }
  }, { user: o.user || null, local: o.local || {}, lang: o.lang, platform: o.platform || 'web' });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/firebase|Firestore|stub/i.test(e.message)) errors.push(e.message); if (process.env.DEBUG) console.log('    [pageerror]', e.message); });
  page.on('dialog', d => d.dismiss().catch(() => {}));
  return { ctx, page };
}

/** Everything the walkthrough looks at, in one read. */
function state(page) {
  return page.evaluate(() => {
    const vis = el => {
      if (!el) return false;
      for (let n = el; n && n !== document; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      }
      return el.getClientRects().length > 0;
    };
    const $ = id => document.getElementById(id);
    const txt = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      page: location.pathname.replace(/^\//, ''),
      step: parseInt(localStorage.getItem('bbOnboardingStep') || '0', 10),
      survival: vis($('survivalContainer')), anon: vis($('anonymousContainer')), journal: vis($('journalContainer')) || vis($('qcCard')) || vis(document.querySelector('.qc-card')),
      welcome: vis($('bbWelcomeModal')), welcomeText: txt($('bbWelcomeModal')),
      startHint: vis($('journalStartHint')), logoHint: vis($('logoHint')), survivalHint: vis($('survivalKitHint')),
      signinHint: vis($('signinHint')), signinHintText: txt($('signinHintLabel')),
      overlay: vis($('bbHintOverlay')),
      complete: vis($('tutorialCompleteModal')), completeText: txt($('tutorialCompleteModal')),
      supportHint: vis($('bbSupportHint')), supportHintText: txt($('bbSupportHint')),
      whatsNew: vis(document.querySelector('.bbwn-back')), whatsNewText: txt(document.querySelector('.bbwn-back')),
      progress: vis($('journalTutorialProgress')) ? txt($('journalTutorialProgress')) : null,
      footer: vis($('homeFooter')),
      // journal page
      hint2: vis($('journalHint2')), hintClose: vis($('journalHintClose')), hint3: vis($('journalHint3')),
      homeLink: vis($('homeLink')), skNav: vis($('survivalNavBtn')),
      fm: vis($('focusedModeCard')),
      dock: [...document.querySelectorAll('#bbFabDock button, .bb-fab-dock button, [id^="bbFab"]')].filter(vis).map(b => b.id || b.className).slice(0, 12),
      flags: { S: localStorage.getItem('bbSurvivalBtnEnabled'), A: localStorage.getItem('bbAnonBtnEnabled'), V: localStorage.getItem('bbHomeBtnsV'), R: localStorage.getItem('bbHomeBtnsRestored'), fabs: localStorage.getItem('bbFabsUnlocked'), has: localStorage.getItem('bbHasEntries') },
    };
  });
}
const shot = async (page, name) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
};
const settle = (page, ms = 900) => page.waitForTimeout(ms);
async function waitHome(page) {
  await page.waitForFunction(() => typeof window._applyOnboardingGating === 'function' && document.readyState === 'complete', null, { timeout: 20000 });
  await settle(page);
}
async function waitJournal(page) {
  await page.waitForFunction(() => typeof window.toggleJournal === 'function' && document.readyState === 'complete', null, { timeout: 20000 });
  await settle(page, 1500);
}

/** Focus mode, as a person: confirm the mood, skip the rest, Save. */
async function saveFirstEntry(page) {
  await page.waitForSelector('#focusedModeCard .fm-wheel-btn.center', { state: 'visible', timeout: 20000 });
  await page.click('#focusedModeCard .fm-wheel-btn.center');
  for (let i = 0; i < 10; i++) {
    await settle(page, 600);
    if (await page.locator('#focusedModeCard .fm-done-save').isVisible()) break;
    await page.click('#fmSkipBtn', { timeout: 3000 });
  }
  await page.click('#focusedModeCard .fm-done-save');
  await settle(page, 1500);
  // A guest's first save asks about a PIN.
  if (await page.locator('#guestPinChoiceNone').isVisible()) await page.click('#guestPinChoiceNone');
  await page.waitForFunction(() => localStorage.getItem('bbOnboardingStep') === '1', null, { timeout: 15000 });
  await settle(page, 1500);
}

const isVisible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const T = (page, key) => page.evaluate(k => BB.t(k), key);
const DAY = 86400000;
/** A guest who has kept a journal here: entries on the device, no PIN. */
function guestJournal(extra = {}) {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  const d = new Date(t.getTime() - DAY);
  const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { bbGuestNoPin: '1', ['entry:' + d.getTime()]: JSON.stringify({ date: k, timestamp: d.getTime(), mood: 'stable', sleep: 7, energy: 5, medication: 'taken' }), ...extra };
}
const ALL_SEEN = { bbWhatsNewSeen: '9.99', bbWelcomeShown: '1' };

// ── 1. The walkthrough ────────────────────────────────────────────────────────
async function walkthrough(platform, lang = 'en') {
  const tag = `${platform}${lang === 'en' ? '' : ' (' + lang + ')'}`;
  console.log(`Tutorial walkthrough: ${tag}`);
  const { ctx, page } = await device({ platform, lang });
  const S = async (n) => { const st = await state(page); await shot(page, `${platform}-${lang}-${n}`); return st; };
  await page.goto(BASE + '/index.html');
  await waitHome(page);
  let st = await S('0-home');
  assert.equal(st.step, 0);
  assert.ok(st.welcome, 'welcome popup');
  assert.ok(st.welcomeText.includes(await T(page, 'home.welcomeTitle')), 'welcome in the right language');
  assert.ok(st.startHint && st.journal, '"get started" hint over the Mood Journal button');
  assert.ok(!st.survival && !st.anon, 'no Survival Kit / Anonymous before the first entry');
  assert.ok(!st.logoHint && !st.signinHint && !st.complete);
  ok(`${tag} step 0: welcome, "get started" on the Mood Journal; only the journal on the home page`);

  await page.click('#bbWelcomeModal');
  await page.click('#journalBtn');
  await page.waitForURL(/journal/);
  await waitJournal(page);
  st = await S('0-journal');
  assert.ok(st.fm && !st.homeLink && !st.skNav, 'focus mode opens; no way off the page yet');
  await saveFirstEntry(page);
  st = await S('1');
  assert.equal(st.step, 1);
  assert.ok(st.hint2 && st.overlay && await isVisible(page, '#journalToggleBtn'), 'step 1 points at Open Journal');
  assert.ok(!st.homeLink && !st.skNav);
  ok(`${tag} step 1 (first entry saved): "open your past entries" points at Open Journal`);

  await page.click('#journalToggleBtn'); await settle(page, 1200);
  st = await S('2');
  assert.equal(st.step, 2);
  assert.ok(st.hintClose && await isVisible(page, '#journalToggleBtn'), 'step 2 points at Close Journal');
  ok(`${tag} step 2: "close" points at Close Journal`);

  await page.click('#journalToggleBtn'); await settle(page, 1200);
  st = await S('3');
  assert.equal(st.step, 3);
  assert.ok(st.hint3 && st.homeLink, 'step 3 points at ← Home, which shows');
  assert.ok(st.skNav, 'the journal\'s 🧰 shows with ← Home');
  ok(`${tag} step 3: "go back" points at ← Home; 🧰 Survival Kit shows beside it`);

  await page.click('#homeLink');
  await page.waitForURL(/index/);
  await waitHome(page);
  await settle(page, 1500);
  st = await S('12-home');
  assert.equal(st.step, 12, 'back home with an entry = tutorial complete');
  assert.ok(st.survival && st.anon, 'both buttons on the home page after the first entry');
  assert.ok(!st.logoHint && !st.survivalHint && !st.startHint, 'no stale hints');
  assert.ok(st.signinHint && st.overlay, 'the finale: the account hint');
  assert.equal(st.signinHintText, await T(page, 'home.accountHint'));
  assert.ok(await isVisible(page, '#bbAuthFab'), 'the account hint points at a visible profile button');
  assert.deepEqual([st.flags.S, st.flags.A, st.flags.V], ['1', '1', '2']);
  ok(`${tag} back home → step 12: 🆘 + 💬 showing; the finale points at the (visible) profile button`);

  await page.click('#bbAuthFab');
  await page.waitForSelector('#idxProfileModal.active', { timeout: 5000 });
  await settle(page, 600);
  await shot(page, `${platform}-${lang}-12-profile`);
  const toggles = await page.evaluate(() => [...document.querySelectorAll('#idxHomeBtnToggles button')].map(b => b.getAttribute('aria-pressed')));
  assert.deepEqual(toggles, ['true', 'true', 'true'], 'Journal, Survival, Anonymous all on in Customise');
  assert.equal(await page.$('.bb-new-pill'), null, 'no NEW pill');
  assert.equal(await page.textContent('[data-i18n="home.homeButtonsHint"]'), await T(page, 'home.homeButtonsHint'));
  ok(`${tag} Profile: all three home buttons on, no NEW pill, "show or hide" wording`);

  await page.evaluate(() => window.closeProfileModal());
  await page.waitForSelector('#tutorialCompleteModal', { timeout: 8000 });
  st = await S('12-complete');
  assert.ok(st.completeText.includes(await T(page, 'home.tutorialCompleteTitle')));
  await page.click('#tutorialCompleteModal');
  await settle(page, 800);
  st = await S('12-support');
  assert.ok(st.supportHint && await isVisible(page, '.feedback-fab'), 'support hint over a visible 📣');
  ok(`${tag} "Tutorial Complete!" then the support hint over 📣`);

  await page.reload();
  await waitHome(page);
  await settle(page, 3500);
  st = await S('12-reload');
  assert.ok(st.survival && st.anon && st.step === 12);
  assert.ok(!st.welcome && !st.complete && !st.signinHint && !st.supportHint && !st.logoHint && !st.whatsNew, 'no popups after the tutorial');
  ok(`${tag} reload: both buttons, no tutorial popups`);
  await ctx.close();
}
await walkthrough('web');
await walkthrough('ios');
await walkthrough('android');
await walkthrough('web', 'es');

// ── 2. Reload mid-tutorial ────────────────────────────────────────────────────
console.log('Mid-tutorial reloads');
for (const step of [1, 2, 3]) {
  const { ctx, page } = await device({ local: guestJournal({ bbOnboardingStep: String(step), bbHasEntries: '1', bbFabsUnlocked: '1', ...ALL_SEEN }) });
  // The app reopened on the home page part-way through.
  await page.goto(BASE + '/index.html');
  await waitHome(page);
  let st = await state(page);
  assert.equal(st.step, step);
  assert.ok(st.survival && st.anon && st.journal, `home at step ${step}: journal + both buttons`);
  assert.ok(!st.startHint && !st.logoHint && !st.signinHint && !st.complete, `home at step ${step}: no hint`);
  await page.click('#journalBtn');
  await page.waitForURL(/journal/);
  await waitJournal(page);
  // Focus mode reopens on an empty day; leave it as a person would.
  if (await isVisible(page, '#fmBackBtn')) { await page.click('#fmBackBtn'); await settle(page, 1000); }
  st = await state(page);
  const want = { 1: 'hint2', 2: 'hintClose', 3: 'hint3' }[step];
  assert.ok(st[want], `journal at step ${step} shows ${want}`);
  if (step < 3) {
    // Step 2's "close" needs the list open: a reload left it closed, so the
    // button says Open — one tap opens, the next closes and moves on.
    await page.click('#journalToggleBtn'); await settle(page, 900);
    if (step === 2) { await page.click('#journalToggleBtn'); await settle(page, 900); }
    st = await state(page);
    assert.equal(st.step, step + 1, `step ${step} advances`);
  } else {
    await page.click('#homeLink');
    await page.waitForURL(/index/);
    await waitHome(page);
    st = await state(page);
    assert.equal(st.step, 12);
  }
  ok(`reload at step ${step}: home shows both buttons, the journal shows its hint, and it moves on`);
  await ctx.close();
}
// Steps 4–11 with no entries on this device (signed out, entries in the
// account): the logo hint path. Web/iPhone shows "psst… click me!", Android
// skips it.
for (const platform of ['web', 'android']) {
  const { ctx, page } = await device({ platform, local: { bbOnboardingStep: '4', bbFabsUnlocked: '1', bbGuestNoPin: '1', ...ALL_SEEN } });
  await page.goto(BASE + '/index.html');
  await waitHome(page);
  let st = await state(page);
  assert.ok(st.survival && st.anon, `${platform}: both buttons at step ${st.step}`);
  if (platform === 'web') {
    assert.equal(st.step, 5);
    assert.ok(st.logoHint, 'logo hint at step 5');
    for (let i = 0; i < 5; i++) { await page.click('.logo-img', { force: true }); await page.waitForTimeout(120); }
    await settle(page, 1200);
    st = await state(page);
    assert.equal(st.step, 6);
    assert.ok(!st.logoHint && st.survival && st.anon, 'step 6: logo hint gone, buttons unchanged');
  } else {
    assert.equal(st.step, 6, 'Android skips the logo hint');
    assert.ok(!st.logoHint);
  }
  // Not stuck: the Survival Kit button finishes the tutorial.
  await page.click('#survivalBtn');
  await page.waitForURL(/survival-kit/);
  assert.equal(await page.evaluate(() => localStorage.getItem('bbOnboardingStep')), '12');
  ok(`${platform}: steps 4–6 without local entries (logo hint ${platform === 'web' ? 'shown, 5 taps → 6' : 'skipped'}); 🆘 finishes the tutorial`);
  await ctx.close();
}

// ── 3. The skip ───────────────────────────────────────────────────────────────
console.log('Tutorial skip');
{
  const { ctx, page } = await device({});
  await page.goto(BASE + '/index.html');
  await waitHome(page);
  await page.click('#bbWelcomeModal');
  const box = await page.locator('.logo-img').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(5300);
  await page.mouse.up();
  await settle(page, 1000);
  const st = await state(page);
  assert.equal(st.step, 12);
  assert.ok(st.survival && st.anon && !st.complete && !st.signinHint && !st.startHint, 'skip: step 12, both buttons, no finale');
  ok('holding the logo for 5 s skips to step 12 with both buttons and no finale');
  await ctx.close();
}

// ── 4. Home buttons: Customise turns one off, and it stays off ────────────────
console.log('Home buttons (guest)');
{
  const { ctx, page } = await device({ local: guestJournal({ bbOnboardingStep: '12', bbHasEntries: '1', bbFabsUnlocked: '1', bbTutorialToastShown: '1', ...ALL_SEEN }) });
  await page.goto(BASE + '/index.html');
  await waitHome(page);
  let st = await state(page);
  assert.ok(st.survival && st.anon);
  await page.evaluate(() => window.showProfileModal());
  await page.click('#idxHomeBtnToggles button:nth-child(3)');
  st = await state(page);
  assert.ok(st.survival && !st.anon && st.flags.A === '0');
  await page.reload(); await waitHome(page);
  st = await state(page);
  assert.ok(st.survival && !st.anon, 'still off after a reload');
  ok('a guest turns Bipolar Anonymous off in Customise; it stays off after a reload');
  await ctx.close();
}

// ── 5. Migration ──────────────────────────────────────────────────────────────
console.log('Migration (existing users)');
async function signedIn(uid, local, platform = 'web') {
  const d = await device({ platform, user: { uid, email: uid + '@example.test' }, local });
  await d.page.goto(BASE + '/index.html');
  await waitHome(d.page);
  await d.page.waitForFunction(() => window.currentUser, null, { timeout: 10000 });
  await settle(d.page, 3500); // the read-back waits up to 2.5 s for the settings key
  return d;
}
const OLD = { bbOnboardingStep: '12', bbHasEntries: '1', bbFabsUnlocked: '1', bbTutorialToastShown: '1', bbWhatsNewSeen: '1.45', bbWelcomeShown: '1' };
{
  SERVER.u1 = { onboardingStep: 12, tutorialToastShown: true, homeSurvivalEnabled: false, homeAnonEnabled: false };
  const { ctx, page } = await signedIn('u1', { ...OLD, bbSurvivalBtnEnabled: '0', bbAnonBtnEnabled: '0' });
  let st = await state(page);
  assert.ok(st.survival && st.anon, 'both back on');
  assert.deepEqual([st.flags.S, st.flags.A, st.flags.V, st.flags.R], ['1', '1', '2', '1']);
  assert.equal(SERVER.u1.homeBtnsVersion, 2);
  assert.ok(SERVER.u1.homeSurvivalEnabled === true && SERVER.u1.homeAnonEnabled === true, 'account turned on too');
  ok("'0' here and false on the account → both on, here and on the account (homeBtnsVersion 2)");

  await page.evaluate(() => window.showProfileModal());
  await page.click('#idxHomeBtnToggles button:nth-child(3)');
  await settle(page, 500);
  assert.equal(SERVER.u1.homeAnonEnabled, false);
  assert.equal(SERVER.u1.homeBtnsVersion, 2);
  await page.reload(); await waitHome(page);
  await page.waitForFunction(() => window.currentUser, null, { timeout: 10000 });
  await settle(page, 3500);
  st = await state(page);
  assert.ok(st.survival && !st.anon, 'the choice survives a reload (and the migration does not run again)');
  ok('then turning Anonymous off survives a reload');
  await ctx.close();

  const fresh = await signedIn('u1', { bbWhatsNewSeen: '9.99', bbWelcomeShown: '1' });
  st = await state(fresh.page);
  assert.ok(st.survival && !st.anon, 'a fresh device takes the account\'s choice');
  assert.equal(st.flags.A, '0');
  assert.ok(!st.complete && !st.signinHint, 'no tutorial popups on the new device');
  ok('…and a fresh-device sign-in (Anonymous stays off, no tutorial popups)');
  await fresh.ctx.close();

  // An old device that never ran the migration ('1' for both, no version).
  const old = await signedIn('u1', { ...OLD, bbSurvivalBtnEnabled: '1', bbAnonBtnEnabled: '1' });
  st = await state(old.page);
  assert.ok(st.survival && !st.anon, 'an un-migrated device takes the account\'s post-migration choice');
  assert.equal(SERVER.u1.homeAnonEnabled, false, 'and never writes the old state back');
  ok('an old, un-migrated device signing in takes the account\'s choice, not its own');
  await old.ctx.close();
}
{
  // This device migrated and the guest turned Anonymous off; then signs in to
  // an account the migration never reached: the device's choice goes up.
  SERVER.u2 = { onboardingStep: 12, homeSurvivalEnabled: false, homeAnonEnabled: false };
  const { ctx, page } = await signedIn('u2', { ...OLD, bbHomeBtnsV: '2', bbSurvivalBtnEnabled: '1', bbAnonBtnEnabled: '0' });
  const st = await state(page);
  assert.ok(st.survival && !st.anon);
  assert.deepEqual([SERVER.u2.homeSurvivalEnabled, SERVER.u2.homeAnonEnabled, SERVER.u2.homeBtnsVersion], [true, false, 2]);
  ok("a choice made on this device after the migration is the one the account gets");
  await ctx.close();
}
{
  // Never on the account at all (old default: fields missing) → on.
  SERVER.u3 = { onboardingStep: 12 };
  const { ctx, page } = await signedIn('u3', { ...OLD }, 'android');
  const st = await state(page);
  assert.ok(st.survival && st.anon);
  assert.deepEqual([SERVER.u3.homeSurvivalEnabled, SERVER.u3.homeAnonEnabled, SERVER.u3.homeBtnsVersion], [true, true, 2]);
  ok('an account with no stored choice gets both on (Android)');
  await ctx.close();
}

// ── 6. Long-ago tutorial: no tutorial popups, just the New features note ──────
console.log('Existing user, tutorial done long ago');
for (const lang of ['en', 'es']) {
  // A guest from before onboarding steps existed: entries, no step stored.
  const { ctx, page } = await device({ lang, local: guestJournal({ bbHasEntries: '1', bbSurvivalBtnEnabled: '0' }) });
  await page.goto(BASE + '/index.html');
  await waitHome(page);
  await page.waitForSelector('.bbwn-back', { timeout: 15000 });
  const st = await state(page);
  await shot(page, `existing-${lang}-whatsnew`);
  assert.equal(st.step, 12);
  assert.ok(st.survival && st.anon);
  assert.ok(!st.welcome && !st.complete && !st.signinHint && !st.logoHint && !st.startHint, 'no tutorial popup');
  assert.ok(st.whatsNewText.includes(await T(page, 'whatsnew.b145HomeTitle')), 'the note is on the New features sheet');
  assert.ok(st.whatsNewText.includes(await T(page, 'whatsnew.b145HomeBody')));
  if (lang !== 'en') assert.ok(!st.whatsNewText.includes('are back'), 'in Spanish');
  ok(`${lang}: no tutorial popups; New features says Survival Kit and Bipolar Anonymous are back`);
  await ctx.close();
}
{
  // Had both on already: nothing to say.
  const { ctx, page } = await device({ local: guestJournal({ bbOnboardingStep: '12', bbHasEntries: '1', bbFabsUnlocked: '1', bbTutorialToastShown: '1', bbSurvivalBtnEnabled: '1', bbAnonBtnEnabled: '1' }) });
  await page.goto(BASE + '/index.html');
  await waitHome(page);
  const items = await page.evaluate(() => (BB.whatsNew.current ? BB.whatsNew.current.items() : []).map(i => i.id));
  assert.ok(!items.includes('homeButtons'));
  ok('someone who had both on already gets no note');
  await ctx.close();
}

// ── 7. Strings in every language ──────────────────────────────────────────────
console.log('Strings');
{
  const { ctx, page } = await device({});
  await page.goto(BASE + '/index.html');
  await waitHome(page);
  const res = await page.evaluate(() => BB.i18n.getLanguages().map(l => {
    BB.i18n.setLanguage(l.code);
    return { code: l.code, keys: ['home.homeButtonsHint', 'whatsnew.b145HomeTitle', 'whatsnew.b145HomeBody', 'home.accountHint'].map(k => BB.t(k)) };
  }));
  const en = res.find(r => r.code === 'en');
  assert.ok(res.length >= 10);
  for (const r of res) {
    r.keys.forEach((v, i) => {
      assert.ok(v && !/^(home|whatsnew)\./.test(v), `${r.code} has key ${i}`);
      if (r.code !== 'en' && i < 3) assert.notEqual(v, en.keys[i], `${r.code} key ${i} is translated`);
    });
  }
  ok(`all ${res.length} languages have the reworded Customise line and the New features note`);
  await ctx.close();
}

assert.deepEqual(errors, [], 'no page errors');
ok('no page errors');
console.log(`\n${passed} passed`);
await browser.close();
server.close();
