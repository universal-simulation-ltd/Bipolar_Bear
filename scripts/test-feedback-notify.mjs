#!/usr/bin/env node
/**
 * Browser checks for Send feedback's "Keep me informed about my submission"
 * (v387, from a 2026-10-26 Android 1.43 idea that asked to be kept informed
 * with no email): the switch shows the email box and the form will not send
 * without an address. Negative controls: an Idea with the switch off still
 * hides the box and sends; Bug still shows it, optional.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-feedback-notify.mjs
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

/** A fresh context seeded once. o: {meds, extra:{k:v}, days} */
async function open(url, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', ...(o.touch ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) console.log('    pageerror:', e.message); });
  page.__dialog = 'accept';
  page.on('dialog', d => (page.__dialog === 'dismiss' ? d.dismiss() : d.accept()));
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
    localStorage.setItem('bbTheme', 'light');
    localStorage.setItem('bbOnboardingStep', '12'); localStorage.setItem('bbHasEntries', '1');
    localStorage.setItem('bbGuestNoPin', '1');
    localStorage.setItem('bbWhatsNewSeen', '1.46');
    localStorage.setItem('focusedModeEnabled', '0');
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const k = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    for (let i = cfg.days; i >= 1; i--) {
      const t = now.getTime() - i * 86400000;
      localStorage.setItem('entry:' + t, JSON.stringify({ date: k(t), timestamp: t, mood: 'stable', sleep: 7, energy: 4, medication: 'taken' }));
    }
    if (cfg.meds) localStorage.setItem('currentMedList', JSON.stringify(cfg.meds));
    Object.keys(cfg.extra || {}).forEach(x => localStorage.setItem(x, cfg.extra[x]));
  }, { days: 20, ...o });
  await page.goto(BASE + url);
  await page.waitForFunction(() => window.BB && typeof BB.t === 'function');
  return { ctx, page };
}
const DOCK = { extra: { bbFabsUnlocked: '1', bbFabFirstRunDone: '1', bbWaFabHidden: '1' } };
const emailShown = page => page.evaluate(() => getComputedStyle(document.getElementById('bbFbEmailRow')).display !== 'none');
const errText = page => page.evaluate(() => { const e = document.getElementById('bbFbError'); return e.style.display === 'none' ? '' : e.textContent; });
/** Firestore adds land in window.__fbSent instead of the network. */
async function stubSend(page) {
  await page.evaluate(() => {
    window.__fbSent = [];
    window.db = { collection: () => ({ add: async d => { window.__fbSent.push(d); return {}; }, doc: () => ({ get: () => new Promise(() => {}), set: async () => {}, update: async () => {}, onSnapshot: () => () => {} }) }) };
    window.auth = { currentUser: { uid: 'anon' } };
    window.currentUser = null;
  });
}
async function openForm(page, type, msg) {
  await page.waitForFunction(() => typeof window.openFabFeedback === 'function');
  await stubSend(page);
  await page.evaluate(() => window.openFabFeedback());
  await page.click('#bbFbType' + type);
  await page.fill('#bbFbMessage', msg);
}
const sent = page => page.evaluate(() => window.__fbSent);

console.log('Send feedback: Keep me informed');
{
  const { ctx, page } = await open('/index.html', DOCK);
  await openForm(page, 'Idea', 'The last few moods on the lock screen');
  assert.equal(await emailShown(page), false);
  ok('an Idea hides the email box while the switch is off');

  await page.click('text=Keep me informed about my submission');
  assert.equal(await page.isChecked('#bbFbNotify'), true);
  assert.equal(await emailShown(page), true);
  assert.equal(await page.getAttribute('#bbFbEmail', 'placeholder'), 'Your email, so we can reply');
  ok('turning the switch on (tapping its words) shows the email box, asking for a reply address');

  await page.evaluate(() => window.submitFabFeedback());
  assert.equal(await errText(page), 'Add your email so we can reply.');
  assert.equal((await sent(page)).length, 0);
  ok('with the switch on and no email, nothing is sent and it asks for one');

  await page.fill('#bbFbEmail', 'someone@example.com');
  await page.evaluate(() => window.submitFabFeedback());
  const s = await sent(page);
  assert.equal(s.length, 1);
  assert.equal(s[0].notify, true);
  assert.equal(s[0].email, 'someone@example.com');
  ok('with an email it sends, notify and email together');

  await page.evaluate(() => window.openFabFeedback());
  await page.click('#bbFbTypeIdea');
  await page.locator('#bbFbNotifyTrack').click();
  assert.equal(await page.isChecked('#bbFbNotify'), false);
  assert.equal(await emailShown(page), false);
  ok('turning it off again (tapping the switch itself) hides the box');

  await page.fill('#bbFbMessage', 'Just an idea');
  await page.evaluate(() => window.submitFabFeedback());
  const s2 = await sent(page);
  assert.equal(s2.length, 2);
  assert.equal(s2[1].notify, false);
  ok('an Idea with the switch off still sends without an email');

  await page.evaluate(() => window.openFabFeedback());
  await page.click('#bbFbTypeBug');
  assert.equal(await emailShown(page), true);
  assert.equal(await page.getAttribute('#bbFbEmail', 'placeholder'), 'Your email (optional)');
  ok('Bug still shows the email box, optional');

  await page.evaluate(() => { window.currentUser = { uid: 'u1', email: 'acct@example.com' }; window.openFabFeedback(); });
  await page.click('#bbFbTypeComment');
  await page.click('text=Keep me informed about my submission');
  await page.fill('#bbFbMessage', 'Signed in');
  await page.fill('#bbFbEmail', '');
  await page.evaluate(() => window.submitFabFeedback());
  const s3 = await sent(page);
  assert.equal(s3.length, 3);
  assert.equal(s3[2].email, 'acct@example.com');
  ok('signed in with an email, the switch needs nothing more: the account email goes');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
