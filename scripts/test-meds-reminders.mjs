#!/usr/bin/env node
/**
 * One reminder per medicine (1.45, js/shared/meds-reminder.js and the
 * 🔔 Reminders card in 💊 My medicines). Covers:
 *   - the move from the single reminder (its time onto every medicine, or
 *     "all my medicines" with no list; its ✅ Taken day kept), and nothing
 *     moved when it was off;
 *   - the plan: every slot's first reminder for 7 days before any follow-up,
 *     at most 49, never past midnight, a ✅ Taken slot skipped today only;
 *   - the phone path against a fake LocalNotifications plugin: ids in
 *     3000–3048, the old 3000–3099 cancelled first, ✅ Taken + the daily
 *     reminder's mood buttons registered together, NO medicine name in any
 *     notification (or its extra) unless "Show the medicine names" is ticked,
 *     ✅ Taken from the notification covers its slot today; master off
 *     schedules nothing;
 *   - the card at 390 px (light; English and German): master switch unticked,
 *     add / remove times per medicine, the names tick unticked, the web note;
 *     a rename keeps a medicine's times and a removal drops them; no sideways
 *     scroll; the in-app "Have you taken …?" prompt and its ✅ Taken.
 *
 *   PLAYWRIGHT_MODULE=file:///…/node_modules/playwright/index.mjs node scripts/test-meds-reminders.mjs
 *   (SHOTS=<dir> also saves screenshots)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS || '';
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = pw.default || pw;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.webp': 'image/webp' };
// A bare page with only what the reminders need, for the phone path (a fake
// Capacitor would send the real pages down their native branches).
const BARE = `<!doctype html><html><head><meta charset="utf-8">
<script>window.__ln = { scheduled: [], cancelled: [], types: null, listeners: {} };
window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { LocalNotifications: {
  checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }),
  schedule: async (o) => { __ln.scheduled.push(...o.notifications); },
  cancel: async (o) => { __ln.cancelled.push(o.notifications.map(n => n.id)); __ln.scheduled = __ln.scheduled.filter(n => !o.notifications.some(c => c.id === n.id)); },
  registerActionTypes: async (o) => { __ln.types = o; },
  getDeliveredNotifications: async () => ({ notifications: [] }), removeDeliveredNotifications: async () => {},
  addListener: (ev, fn) => { __ln.listeners[ev] = fn; },
} } };</script>
<script src="js/shared/i18n.js"></script><script src="js/shared/i18n-medsrem.js"></script>
<script src="js/shared/mood-queue.js"></script><script src="js/shared/meds-reminder.js"></script>
</head><body></body></html>`;
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u === '/__bare.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(BARE); return; }
  const p = path.join(ROOT, u);
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
const MEDS = [{ name: 'Lithium', dosage: '400 mg' }, { name: 'Quetiapine', dosage: '50 mg' }];

/** o: {meds, extra:{k:v}, lang, grant} */
async function open(url, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', colorScheme: 'light' });
  if (o.grant) await ctx.grantPermissions(['notifications'], { origin: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/firebase|Firestore/i.test(e.message)) console.log('    pageerror:', e.message); });
  page.on('dialog', d => d.accept());
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.includes('firebasejs/') && u.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
    if (u.includes('firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (u.startsWith(BASE)) return /service-worker\.js|firebase-messaging-sw\.js/.test(u) ? route.abort() : route.continue();
    return route.abort();
  });
  await page.addInitScript(cfg => {
    // Headless Chromium answers "denied" whatever is granted: stand in for a
    // browser where the person allowed notifications.
    if (cfg.grant && window.Notification) {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
      Notification.requestPermission = async () => 'granted';
    }
    if (sessionStorage.getItem('__seeded')) return;
    sessionStorage.setItem('__seeded', '1');
    localStorage.clear();
    localStorage.setItem('bbLanguage', cfg.lang || 'en');
    localStorage.setItem('bbTheme', 'light');
    localStorage.setItem('bbOnboardingStep', '12'); localStorage.setItem('bbHasEntries', '1');
    localStorage.setItem('bbGuestNoPin', '1');
    localStorage.setItem('bbWhatsNewSeen', '1.45');
    localStorage.setItem('focusedModeEnabled', '0');
    if (cfg.meds) localStorage.setItem('currentMedList', JSON.stringify(cfg.meds));
    Object.keys(cfg.extra || {}).forEach(x => localStorage.setItem(x, cfg.extra[x]));
  }, o);
  await page.goto(BASE + url);
  await page.waitForFunction(() => window.BB && BB.medsReminder && typeof BB.t === 'function');
  return { ctx, page };
}
const LJ = async (page, k) => JSON.parse(await page.evaluate(x => localStorage.getItem(x), k) || 'null');
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForTimeout(450);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
};

console.log('The single reminder moves in');
{
  const { ctx, page } = await open('/__bare.html', { meds: MEDS, extra: { bbMedsReminder: '1', bbMedsReminderTime: '08:30', bbMedsTakenDay: today() } });
  assert.deepEqual(await LJ(page, 'bbMedsReminders'), { lithium: ['08:30'], quetiapine: ['08:30'] });
  assert.deepEqual(await LJ(page, 'bbMedsTaken'), { day: today(), slots: ['08:30'] });
  assert.equal(await page.evaluate(() => localStorage.getItem('bbMedsTakenDay')), null);
  const sl = await page.evaluate(() => BB.medsReminder.settings().slots);
  assert.deepEqual(sl, [{ time: '08:30', meds: ['Lithium', 'Quetiapine'], all: false }]);
  ok('on, with a list: its time goes on every medicine (one shared notification, as before), and today\'s ✅ Taken is kept');
  await ctx.close();
}
{
  const { ctx, page } = await open('/__bare.html', { extra: { bbMedsReminder: '1' } });
  assert.deepEqual(await LJ(page, 'bbMedsReminders'), { '*': ['21:00'] });
  ok('on, with no list on this device: "all my medicines" at its time (21:00 by default)');
  await ctx.close();
}
{
  const { ctx, page } = await open('/__bare.html', { meds: MEDS, extra: { bbMedsReminderTime: '07:00' } });
  assert.deepEqual(await LJ(page, 'bbMedsReminders'), {});
  assert.equal(await page.evaluate(() => BB.medsReminder.settings().enabled), false);
  // Turning it on later doesn't bring the old time back.
  await page.evaluate(() => BB.medsReminder.setEnabled(true));
  assert.deepEqual(await page.evaluate(() => BB.medsReminder.settings().slots), []);
  ok('negative control: off before, nothing moves in; switching on later gives no medicine a time');
  await ctx.close();
}

console.log('The plan');
{
  const { ctx, page } = await open('/__bare.html');
  const r = await page.evaluate(() => {
    const P = BB.medsReminder.plan;
    const now = new Date(2026, 9, 22, 10, 0, 0);
    const slots = [{ time: '08:00', meds: ['A'] }, { time: '13:00', meds: ['B'] }, { time: '23:30', meds: ['C'] }];
    const full = P({ slots, now });
    const key = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const taken = P({ slots, now, taken: { day: '2026-10-22', slots: ['13:00'] } });
    return {
      n: full.length,
      bases: full.filter(x => x.n === 0).length,
      pastMidnight: full.filter(x => key(x.at) !== x.day).length,
      past: full.filter(x => x.at <= now).length,
      // 08:00 today already fired: its follow-ups from 11:00 on still come
      todays08: full.filter(x => x.day === '2026-10-22' && x.slot === '08:00').map(x => x.at.getHours()),
      takenToday: taken.filter(x => x.day === '2026-10-22' && x.slot === '13:00').length,
      takenTomorrow: taken.filter(x => x.day === '2026-10-23' && x.slot === '13:00' && x.n === 0).length,
      lateFollow: full.filter(x => x.slot === '23:30' && x.n > 0).length,
      sorted: full.every((x, i) => !i || full[i - 1].at <= x.at),
      empty: P({ slots: [], now }).length,
    };
  });
  assert.equal(r.n, 49); assert.equal(r.bases, 20); // 3 a day × 7, less today's 08:00
  assert.equal(r.pastMidnight, 0); assert.equal(r.past, 0); assert.equal(r.lateFollow, 0); assert.ok(r.sorted);
  assert.deepEqual(r.todays08, [11, 12, 13, 14]);
  assert.equal(r.takenToday, 0); assert.equal(r.takenTomorrow, 1); assert.equal(r.empty, 0);
  ok('every slot\'s first reminder for 7 days comes first, follow-ups fill to 49, none past midnight or in the past; ✅ Taken skips that slot today only');
  await ctx.close();
}

console.log('Phone: local notifications');
{
  const { ctx, page } = await open('/__bare.html', { meds: MEDS });
  await page.evaluate(async () => {
    await BB.medsReminder.setEnabled(true);
    await BB.medsReminder.addTime('Lithium', '08:00');
    await BB.medsReminder.addTime('Quetiapine', '08:00');
    await BB.medsReminder.addTime('Quetiapine', '21:00');
  });
  const ln = await page.evaluate(() => __ln);
  assert.ok(ln.scheduled.length > 0 && ln.scheduled.length <= 49, 'count ' + ln.scheduled.length);
  assert.ok(ln.scheduled.every(n => n.id >= 3000 && n.id < 3049));
  assert.equal(new Set(ln.scheduled.map(n => n.id)).size, ln.scheduled.length);
  assert.ok(ln.cancelled.some(ids => ids.length === 100 && ids[0] === 3000 && ids[99] === 3099), 'the old range is not cancelled');
  assert.deepEqual(ln.types.types.map(t => t.id).sort(), ['BB_MEDS', 'bb.mood']);
  const text = JSON.stringify(ln.scheduled);
  assert.ok(!/Lithium|Quetiapine/i.test(text), 'a medicine name is in a notification: ' + text.slice(0, 200));
  assert.ok(ln.scheduled.some(n => n.title === '💊 Time for your medication'));
  assert.ok(ln.scheduled.every(n => n.extra.bbMeds === 1 && /^\d\d:\d\d$/.test(n.extra.slot) && n.actionTypeId === 'BB_MEDS'));
  assert.deepEqual([...new Set(ln.scheduled.map(n => n.extra.slot))].sort(), ['08:00', '21:00']);
  ok('per-medicine times become one notification per time, ids 3000–3048, the old range cancelled, ✅ Taken and the mood buttons registered together; no medicine named');

  await page.evaluate(() => BB.medsReminder.setShowNames(true));
  const named = await page.evaluate(() => __ln.scheduled);
  assert.ok(named.some(n => n.title === '💊 Time for Lithium, Quetiapine' && n.extra.slot === '08:00'));
  assert.ok(named.some(n => n.title === '💊 Time for Quetiapine' && n.extra.slot === '21:00'));
  assert.ok(named.some(n => n.title === '💊 Have you taken Quetiapine?'));
  assert.ok(!JSON.stringify(named.map(n => n.extra)).match(/Lithium|Quetiapine/), 'names in the extra');
  ok('ticked "Show the medicine names": the title names that time\'s medicines (never the extra data)');

  // ✅ Taken on the 21:00 notification.
  await page.evaluate(async () => {
    __ln.listeners.localNotificationActionPerformed({ actionId: 'taken', notification: { id: 3001, extra: { bbMeds: 1, slot: '21:00', day: 'x' } } });
    await new Promise(r => setTimeout(r, 200));
  });
  const tk = await LJ(page, 'bbMedsTaken');
  assert.deepEqual(tk, { day: today(), slots: ['21:00'] });
  const after = await page.evaluate(() => __ln.scheduled);
  const t0 = today();
  const key = s => s.slice(0, 10);
  assert.ok(!after.some(n => n.extra.slot === '21:00' && n.extra.day === t0), '21:00 still planned today');
  assert.ok(after.some(n => n.extra.slot === '21:00' && n.extra.day !== t0));
  assert.match(await page.textContent('.bbm-toast'), /no more medication reminders today/);
  ok('✅ Taken on a notification covers its time today (later days stay planned)');

  await page.evaluate(() => BB.medsReminder.setEnabled(false));
  assert.equal(await page.evaluate(() => __ln.scheduled.length), 0);
  assert.deepEqual((await LJ(page, 'bbMedsReminders')).quetiapine, ['08:00', '21:00']);
  ok('negative control: the master switch off cancels them all and keeps the times');

  await page.evaluate(() => BB.medsReminder.clear());
  for (const k of ['bbMedsReminder', 'bbMedsReminders', 'bbMedsRemindNames', 'bbMedsTaken']) assert.equal(await page.evaluate(x => localStorage.getItem(x), k), null, k);
  ok('sign-out / reset (clear) forgets every reminder');
  await ctx.close();
}

console.log('My medicines → 🔔 Reminders (390 px, light)');
{
  // Negative control: notifications blocked in the browser → stays off, says why.
  const { ctx, page } = await open('/journal.html', { meds: MEDS });
  await page.waitForFunction(() => window.BBMeds);
  await page.evaluate(() => BBMeds.open('doses', { reminders: true }));
  await page.click('#medsRemCard .mrem-row .bb-switch');
  await page.waitForFunction(() => document.querySelector('#medsRemCard .mrem-msg')?.textContent);
  assert.match(await page.textContent('#medsRemCard .mrem-msg'), /Notifications are blocked for this site/);
  assert.equal(await page.isChecked('#medsRemOn'), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('bbMedsReminder')), null);
  ok('negative control: notifications blocked in the browser: the switch stays off and says how to allow them');
  await ctx.close();
}
for (const lang of ['en', 'de']) {
  const { ctx, page } = await open('/journal.html', { meds: MEDS, grant: true, lang });
  await page.waitForFunction(() => window.BBMeds && typeof window.showMedicationList === 'function');
  await page.evaluate(() => BBMeds.open('doses', { reminders: true }));
  await page.waitForSelector('#medsRemCard');
  const de = lang === 'de';
  assert.match(await page.textContent('#medsRemCard h4'), de ? /Erinnerungen/ : /Reminders/);
  assert.equal(await page.isChecked('#medsRemOn'), false);
  assert.equal(await page.$('#medsRemCard .mrem-med'), null, 'medicines shown while off');
  assert.match(await page.textContent('#medsRemCard'), de ? /nur, solange Bipolar Bear/ : /only come while Bipolar Bear is open/);
  // The card is scrolled into view inside the sheet, and the modal itself not scrolled.
  const pos = await page.evaluate(() => ({ modal: document.getElementById('medsHubModal').scrollTop, top: document.getElementById('medsRemCard').getBoundingClientRect().top }));
  assert.equal(pos.modal, 0); assert.ok(pos.top > 0 && pos.top < 844 - 150, 'card not brought into view: ' + pos.top);
  await page.click('#medsRemCard .mrem-row .bb-switch');
  await page.waitForSelector('#medsRemCard .mrem-med');
  assert.equal(await page.evaluate(() => localStorage.getItem('bbMedsReminder')), '1');
  assert.equal(await page.$$eval('#medsRemCard .mrem-med', l => l.length), 2);
  assert.equal(await page.$$eval('#medsRemCard .mrem-off', l => l.length), 2, 'a medicine has a time by default');
  assert.equal(await page.isChecked('#medsRemNames'), false);
  ok(lang + ': the master switch starts unticked; on, each medicine shows "' + (de ? 'Keine Erinnerung' : 'No reminder') + '" and the names tick is unticked');

  // Add 08:00 and 20:00 to Lithium, 08:00 to Quetiapine; remove Lithium's 08:00.
  const addAt = async (i, v) => {
    const med = page.locator('#medsRemCard .mrem-med').nth(i);
    await med.locator('input[type=time]').fill(v);
    await med.locator('.mrem-add button').click();
    await page.waitForTimeout(150);
  };
  await addAt(0, '08:00'); await addAt(0, '20:00'); await addAt(1, '08:00');
  assert.deepEqual(await LJ(page, 'bbMedsReminders'), { lithium: ['08:00', '20:00'], quetiapine: ['08:00'] });
  const chips = await page.$$eval('#medsRemCard .mrem-chip', l => l.map(c => c.firstChild.textContent));
  assert.deepEqual(chips, ['08:00', '20:00', '08:00']);
  await shot(page, 'meds-reminders-' + lang + '-light');
  await page.click('#medsRemCard .mrem-chip button');
  await page.waitForTimeout(150);
  assert.deepEqual(await LJ(page, 'bbMedsReminders'), { lithium: ['20:00'], quetiapine: ['08:00'] });
  ok(lang + ': times are added and removed per medicine (chips with ×)');

  const wide = await page.evaluate(() => {
    const b = document.querySelector('#medsHubModal .meds-body');
    const card = document.getElementById('medsRemCard').getBoundingClientRect();
    return { body: b.scrollWidth - b.clientWidth, docW: document.documentElement.scrollWidth, right: card.right };
  });
  assert.ok(wide.body <= 1 && wide.docW <= 390 && wide.right <= 390, 'sideways overflow ' + JSON.stringify(wide));
  ok(lang + ': nothing runs off the side at 390 px');

  if (!de) {
    await page.click('#medsRemNames');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => localStorage.getItem('bbMedsRemindNames')), '1');
    // Rename Lithium → Lithium carbonate: its times follow; remove Quetiapine: its times go.
    await page.click('#medsHubModal .meds-cur:nth-of-type(1) .meds-edit');
    await page.fill('#medsHubModal .meds-cur-edit input[name="name"]', 'Lithium carbonate');
    await page.click('#medsHubModal .meds-cur-edit button[type="submit"]');
    await page.waitForTimeout(200);
    assert.deepEqual(await LJ(page, 'bbMedsReminders'), { 'lithium carbonate': ['20:00'], quetiapine: ['08:00'] });
    await page.evaluate(() => { const b = [...document.querySelectorAll('#medsHubModal .meds-cur')].find(r => /Quetiapine/.test(r.textContent)).querySelector('.meds-rm'); b.click(); });
    await page.waitForTimeout(200);
    assert.deepEqual(await LJ(page, 'bbMedsReminders'), { 'lithium carbonate': ['20:00'] });
    ok('a renamed medicine keeps its times; a removed one loses them');

    // The in-app prompt (what a web timer shows with the tab in front).
    await page.evaluate(() => { BBMeds.close(); BB.medsReminder.askTaken('20:00'); });
    await page.waitForSelector('.bbm-back');
    assert.match(await page.textContent('.bbm-back'), /Have you taken Lithium carbonate\?/);
    await page.click('.bbm-yes');
    await page.waitForTimeout(150);
    assert.deepEqual((await LJ(page, 'bbMedsTaken')).slots, ['20:00']);
    assert.equal(await page.evaluate(() => BB.medsReminder.takenToday('20:00')), true);
    ok('the in-app prompt names the medicine (names ticked) and ✅ Taken covers that time today');
    // Web: planned as timers while the page is open.
    assert.ok(await page.evaluate(() => BB.medsReminder.schedule()) >= 1);
    await page.evaluate(() => BB.medsReminder.setShowNames(false));
    await page.evaluate(() => { localStorage.removeItem('bbMedsTaken'); BB.medsReminder.askTaken('20:00'); });
    assert.match(await page.textContent('.bbm-back'), /Have you taken your medication\?/);
    ok('web: reminders are planned while the tab is open; unticked, the prompt names nothing');
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${passed} passed`);
