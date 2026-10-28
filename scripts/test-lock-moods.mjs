#!/usr/bin/env node
/**
 * Browser checks for the last few moods on the phone's lock screen (v388,
 * James 2026-10-28, from a 2026-10-26 Android 1.43 idea): My safety plan →
 * "📱 Show on my phone's lock screen" → "🐻 Include my last few moods"
 * (unticked) adds the 3 latest days of bb_recentMoods to safetyLock.moods,
 * which the iOS widget and the Android card show. Negative controls: nothing
 * while unticked, with the phone lock off, with an app PIN, a guest PIN or
 * Incognito Mode on; the tick only shows under the phone-lock tick.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-lock-moods.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Signed-out Firebase: auth resolves to null, Firestore reads never resolve.
const FIREBASE_STUB = fs.readFileSync(path.join(ROOT, 'scripts/test-pdf-progress.mjs'), 'utf8').split('const FIREBASE_STUB = `')[1].split('`;')[0];

const browser = await chromium.launch();
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }

const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
// Five logged days in the last week: the lock screen takes the latest three.
const MOODS = { [dayKey(daysAgo(0))]: 'stable', [dayKey(daysAgo(1))]: 'low', [dayKey(daysAgo(3))]: 'elevated', [dayKey(daysAgo(4))]: 'depressed', [dayKey(daysAgo(6))]: 'manic' };
const ON = { bbSafetyPlanPhoneLock: '1', bbSafetyPlanLockMoods: '1', bb_recentMoods: JSON.stringify(MOODS) };

/** survival-kit.html as the Android app, with setSharedData recorded in window.__shared. */
async function open(local = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (process.env.DEBUG) console.log('    pageerror:', e.message); });
  page.on('dialog', d => d.accept());
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: u.includes('firebase-app-compat') ? FIREBASE_STUB : '' });
    if (u.startsWith(BASE)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
    return route.abort();
  });
  await page.addInitScript(local => {
    if (!sessionStorage.getItem('__seeded')) {
      sessionStorage.setItem('__seeded', '1');
      localStorage.clear();
      localStorage.setItem('bbLanguage', 'en');
      localStorage.setItem('bbTheme', 'light');
      localStorage.setItem('bbOnboardingStep', '12'); localStorage.setItem('bbHasEntries', '1');
      localStorage.setItem('bbGuestNoPin', '1');
      localStorage.setItem('bbWhatsNewSeen', '1.46');
      for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
    }
    window.__shared = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        BipolarBearWidget: { setSharedData: d => { window.__shared.push(d); return Promise.resolve(); } },
        LocalNotifications: { requestPermissions: () => Promise.resolve({ display: 'granted' }), checkPermissions: () => Promise.resolve({ display: 'granted' }), addListener: () => Promise.resolve({ remove() {} }) },
        App: { addListener: () => Promise.resolve({ remove() {} }) },
      },
    };
  }, local);
  await page.goto(BASE + '/survival-kit.html');
  await page.waitForFunction(() => window.BB && BB.safetyPlan && typeof BB.t === 'function');
  return { ctx, page };
}
const payload = page => page.evaluate(() => BB.safetyPlan.lockPayload());
const lastSent = page => page.evaluate(() => { const s = window.__shared.filter(x => x.safetyLock); return s.length ? JSON.parse(s[s.length - 1].safetyLock) : null; });

console.log('Last few moods on the phone\'s lock screen');
{
  const { ctx, page } = await open(ON);
  const p = await payload(page);
  const parts = p.moods.split(' · ');
  assert.equal(parts.length, 3, p.moods);
  const want = [[0, 'Stable'], [1, 'Low'], [3, 'Elevated']];
  const days = await page.evaluate(ns => ns.map(n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }); }), want.map(w => w[0]));
  parts.forEach((x, i) => assert.equal(x, days[i] + ' ' + want[i][1]));
  assert.match(parts[0], /^[A-Z][a-z]{2} \d{1,2} Stable$/);
  ok('ticked: the 3 latest logged days, newest first, as day + date + mood ("' + p.moods + '")');
  await page.waitForFunction(() => window.__shared.some(x => x.safetyLock && JSON.parse(x.safetyLock).moods));
  assert.equal((await lastSent(page)).moods, p.moods);
  ok('it reaches the native side in safetyLock, on load');
  assert.ok(!JSON.stringify(await lastSent(page)).includes('Depressed') && !JSON.stringify(await lastSent(page)).includes('Manic'));
  ok('older days are left out');

  await page.evaluate(() => { localStorage.setItem('bbLanguage', 'fr'); BB.i18n.setLanguage('fr'); });
  const fr = await payload(page);
  const frLow = await page.evaluate(() => BB.t('mood.low'));
  assert.notEqual(frLow, 'Low');
  assert.ok(fr.moods.split(' · ')[1].endsWith(' ' + frLow), fr.moods);
  ok('in French the mood words and days are French ("' + fr.moods + '")');
  await ctx.close();
}
for (const [name, extra] of [
  ['unticked', { bbSafetyPlanLockMoods: '' }],
  ['the app lock (PIN) is on', { bbNativePinEnabled: '1' }],
  ['a guest PIN is set', { bbGuestPinSalt: 'abc' }],
  ['Incognito Mode is on', { incognitoMode: 'true' }],
]) {
  const local = { ...ON, ...extra };
  if (extra.bbSafetyPlanLockMoods === '') delete local.bbSafetyPlanLockMoods;
  const { ctx, page } = await open(local);
  const p = await payload(page);
  assert.equal(p.on, true);
  assert.equal(p.moods, '');
  await page.waitForFunction(() => window.__shared.some(x => x.safetyLock));
  assert.equal((await lastSent(page)).moods, '');
  ok('no moods when ' + name + ' (the card stays on)');
  await ctx.close();
}
{
  const { ctx, page } = await open({ bbSafetyPlanLockMoods: '1', bb_recentMoods: JSON.stringify(MOODS) });
  const p = await payload(page);
  assert.equal(p.on, false);
  assert.equal(p.moods, undefined);
  ok('with the phone lock screen off, nothing at all (the tick alone does nothing)');

  await page.evaluate(() => BB.safetyPlan.open({ edit: true }));
  await page.waitForSelector('#bbspPhoneLock');
  const shown = () => page.evaluate(() => { const r = document.getElementById('bbspLockMoods').closest('.bbsp-opt'); return r.style.display !== 'none'; });
  assert.equal(await shown(), false);
  ok('the moods tick is hidden while "Show on my phone\'s lock screen" is off');
  await page.click('#bbspPhoneLock');
  assert.equal(await shown(), true);
  assert.equal(await page.isChecked('#bbspLockMoods'), true);
  assert.match(await page.textContent('label[for=bbspLockMoods]'), /Include my last few moods/);
  assert.match(await page.textContent('#bbspLockMoodsDesc'), /PIN or Incognito Mode/);
  ok('turning the phone lock screen on shows it, with its warning');
  await page.click('#bbspLockMoods');
  assert.equal(await page.evaluate(() => localStorage.getItem('bbSafetyPlanLockMoods')), null);
  assert.equal((await lastSent(page)).moods, '');
  await page.click('#bbspLockMoods');
  assert.equal(await page.evaluate(() => localStorage.getItem('bbSafetyPlanLockMoods')), '1');
  assert.equal((await lastSent(page)).moods.split(' · ').length, 3);
  ok('unticking it sends no moods at once; ticking it sends them');
  await ctx.close();
}
{
  const { ctx, page } = await open({ bbSafetyPlanPhoneLock: '1' });
  await page.evaluate(() => BB.safetyPlan.open({ edit: true }));
  await page.waitForSelector('#bbspLockMoods');
  assert.equal(await page.isChecked('#bbspLockMoods'), false);
  ok('the tick starts unticked');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
