#!/usr/bin/env node
/**
 * Browser checks for the journal's Settings → Advanced index (James,
 * 2026-10-20: "the first page of advanced should be like an index? Mobile -
 * Journal - Focus - stats - account (remove the delete page and link it to
 * the account page on homepage or refactor and show that same screen here)").
 *
 * A guest journal is loaded through the real journal.html with Firebase
 * stubbed out. Covers: Advanced opens the index (Journal, Focus mode, Stats,
 * Account; Mobile only in the phone app); each row opens its page and each
 * page's Back returns to the index, whose Back returns to the first page; the
 * old chain buttons and the Danger Zone page are gone; Account opens the home
 * page's 👤 sheet over Settings — for a guest with Sign in and Delete all data
 * & reset, signed in with Sign out and Delete account — and closing it comes
 * back to the index; Delete closes Settings and starts the page's own
 * confirmDeleteAll.
 * Negative controls: on the web there is no Mobile row; a guest's sheet has
 * no Sign out, password or email; a signed-in one has no guest Sign in.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-settings-index.mjs
 *   SHOTS=/some/dir … also saves screenshots (390 px, light + dark).
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
let passed = 0;
function ok(name) { passed++; console.log('  ✓ ' + name); }

async function open(o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', colorScheme: o.theme === 'dark' ? 'dark' : 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) console.log('    pageerror:', e.message); });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (u.startsWith(BASE)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
    return route.abort();
  });
  await page.addInitScript(cfg => {
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    localStorage.setItem('bbLanguage', 'en');
    localStorage.setItem('bbTheme', cfg.theme || 'light');
    localStorage.setItem('bbOnboardingStep', '12'); localStorage.setItem('bbHasEntries', '1');
    ['SettingsHintDone', 'CustomiseFormHintDone', 'CustomiseAdditionalHintDone', 'CloseSettingsHintDone'].forEach(k => localStorage.setItem('bb' + k, '1'));
    localStorage.setItem('bbGuestNoPin', '1');
    localStorage.setItem('bbWhatsNewSeen', '1.45');
    const now = new Date(); now.setHours(12, 0, 0, 0);
    for (let i = 5; i >= 1; i--) {
      const t = now.getTime() - i * 86400000, d = new Date(t);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      localStorage.setItem('entry:' + t, JSON.stringify({ date: k, timestamp: t, mood: 'stable', sleep: 7, energy: 5 }));
    }
  }, o);
  await page.goto(BASE + '/journal.html');
  await page.waitForFunction(() => typeof window.showSettingsModal === 'function' && typeof window.showAccountModal === 'function');
  return { ctx, page };
}
const shown = page => page.evaluate(() => ['settingsMainPanel', 'settingsIndexPanel', 'settingsMobilePanel', 'settingsAdvancedPanel', 'settingsAdvancedJournalPanel', 'settingsAdvancedMorePanel']
  .filter(id => document.getElementById(id).style.display !== 'none'));
const rows = page => page.evaluate(() => [...document.querySelectorAll('#settingsIndexPanel .set-idx-row')].filter(b => b.style.display !== 'none').map(b => b.querySelector('.set-idx-t').textContent));
const vis = (page, id) => page.evaluate(i => { const n = document.getElementById(i); return !!n && n.style.display !== 'none' && !!n.getClientRects().length; }, id);
const shot = async (page, name, sel) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await (sel ? page.locator(sel).screenshot({ path: path.join(SHOTS, name + '.png') }) : page.screenshot({ path: path.join(SHOTS, name + '.png') })); };

console.log('Settings → Advanced is an index');
{
  const { ctx, page } = await open();
  await page.evaluate(() => showSettingsModal());
  await page.click('#advancedSettingsBtn');
  assert.deepEqual(await shown(page), ['settingsIndexPanel']);
  assert.deepEqual(await rows(page), ['📓 Journal', '🎯 Focus mode', '📊 Stats', '👤 Account']);
  assert.match(await page.textContent('#setIdxAccount .set-idx-d'), /Sign in to back up/);
  ok('Advanced opens the index: Journal, Focus mode, Stats, Account (no Mobile on the web — negative control); a guest\'s Account row says Sign in');
  await shot(page, 'index-light', '#settingsContent');

  for (const [row, panel] of [['#setIdxJournal', 'settingsAdvancedJournalPanel'], ['#setIdxFocus', 'settingsAdvancedPanel'], ['#setIdxStats', 'settingsAdvancedMorePanel']]) {
    await page.click(row);
    assert.deepEqual(await shown(page), [panel], row);
    const btns = await page.evaluate(p => [...document.getElementById(p).querySelectorAll('button')].filter(b => b.getClientRects().length).map(b => b.textContent.trim()), panel);
    assert.ok(!btns.some(t => /→/.test(t)), 'a chain button is still there: ' + btns);
    await page.click(`#${panel} button[data-i18n="common.back"]`);
    assert.deepEqual(await shown(page), ['settingsIndexPanel'], 'Back from ' + panel);
  }
  ok('Journal, Focus mode and Stats each open their page with no "→ next" button, and Back returns to the index');
  assert.equal(await page.evaluate(() => !!document.getElementById('settingsAdvancedMore2Panel')), false);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('#settingsContent button')].some(b => /Delete →|Danger/.test(b.textContent))), false);
  ok('the Danger Zone page and its "Delete →" button are gone');

  // Account, as a guest: the 👤 sheet over Settings.
  await page.click('#setIdxAccount');
  await page.waitForSelector('#bbAccountModal.active');
  assert.equal(await page.evaluate(() => document.getElementById('settingsModal').classList.contains('active')), true, 'Settings closed under the sheet');
  assert.equal(await vis(page, 'bbAccountGuestSignIn'), true);
  for (const id of ['bbAccountSignOut', 'bbAccountPassSection', 'bbAccountEmailSection']) assert.equal(await vis(page, id), false, id + ' shows for a guest');
  assert.match(await page.textContent('#bbAccountDeleteBtn'), /Delete All Data & Reset Settings/);
  assert.equal(await vis(page, 'bbAccountResetDesc'), true);
  assert.match(await page.textContent('#bbAccountEmail'), /Guest mode/);
  ok('Account opens the home page\'s 👤 sheet over Settings: a guest gets Sign in and Delete all data & reset, no Sign out / password / email');
  await shot(page, 'account-guest-light');
  await page.evaluate(() => closeAccountModal());
  assert.deepEqual(await shown(page), ['settingsIndexPanel']);
  ok('closing the sheet comes back to the index');

  // Delete: Settings closes and the page's own confirmDeleteAll starts.
  await page.evaluate(() => { window.__del = 0; window.confirmDeleteAll = () => { window.__del++; }; });
  await page.click('#setIdxAccount');
  await page.click('#bbAccountDeleteBtn');
  assert.equal(await page.evaluate(() => window.__del), 1);
  assert.equal(await page.evaluate(() => document.getElementById('settingsModal').classList.contains('active')), false);
  assert.equal(await page.evaluate(() => document.getElementById('bbAccountModal').classList.contains('active')), false);
  ok('Delete all data & reset closes the sheet and Settings, then runs the page\'s own confirmDeleteAll');

  // Back from the index → the first page.
  await page.evaluate(() => showSettingsModal());
  await page.click('#advancedSettingsBtn');
  await page.click('#settingsIndexPanel > button[data-i18n="common.back"]');
  assert.deepEqual(await shown(page), ['settingsMainPanel']);
  ok('the index\'s Back returns to the first Settings page');
  await page.evaluate(() => closeSettingsModal());

  // Signed in: the same sheet as on the home page.
  await page.evaluate(() => {
    const u = { uid: 'u1', email: 'someone@example.com', providerData: [{ providerId: 'password' }] };
    const a = firebase.auth();
    firebase.auth = () => Object.assign(a, { currentUser: u });
    window.currentUser = u;
  });
  await page.evaluate(() => showSettingsModal());
  await page.click('#advancedSettingsBtn');
  await page.click('#setIdxAccount');
  await page.waitForSelector('#bbAccountModal.active');
  assert.equal(await vis(page, 'bbAccountSignOut'), true);
  assert.equal(await vis(page, 'bbAccountGuestSignIn'), false);
  assert.match(await page.textContent('#bbAccountDeleteBtn'), /Delete account/);
  assert.equal(await vis(page, 'bbAccountResetDesc'), false);
  assert.match(await page.textContent('#bbAccountEmail'), /someone@example\.com/);
  ok('signed in, Account is the usual sheet: Sign out, Delete account, the email; no guest Sign in (negative control)');
  await ctx.close();
}
{
  // The phone app: a Mobile row, first.
  const { ctx, page } = await open({ theme: 'dark' });
  // Settings opened as on the web, then "the phone app" for the index (the
  // native branches of showSettingsModal need the real Capacitor).
  await page.evaluate(() => showSettingsModal());
  await page.evaluate(() => { window.isNative = () => true; });
  await page.click('#advancedSettingsBtn');
  assert.deepEqual(await rows(page), ['📱 Mobile', '📓 Journal', '🎯 Focus mode', '📊 Stats', '👤 Account']);
  await page.click('#setIdxMobile');
  assert.deepEqual(await shown(page), ['settingsMobilePanel']);
  await page.click('#settingsMobilePanel button[data-i18n="common.back"]');
  assert.deepEqual(await shown(page), ['settingsIndexPanel']);
  ok('in the phone app the index starts with 📱 Mobile, which opens the reminders page and comes back');
  await shot(page, 'index-native-dark', '#settingsContent');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
