// World Bipolar Day In-App Event images, in every store language (2026-11-25).
//
// The English card + details images (wbd-2027/*.png, 2026-11-02) were composed by
// hand from real screens and the composer was never kept. This rebuilds the same
// layout for each language so no translated event sits on an English screenshot
// (store-listings house rule):
//   1. capture the REAL app in that language, on 30 March 2027 (?awareDate=), so
//      the World Bipolar Day "today" card shows: Bipolar Bear's home and the
//      Bipolar Anonymous board, via _ipadseed.html (demo data, no login);
//   2. compose them in an HTML template (sunflowers, the app's logo, the screen in
//      a tilted phone) and shoot it at the exact sizes Apple wants:
//      EVENT_CARD 1920×1080, EVENT_DETAILS_PAGE 1080×1920.
//
// Prereqs: `python3 -m http.server 8765` from the repo root; Chrome.
// Usage:   node store-assets/app-events/build-wbd-images.mjs            (all)
//          LOCALES=de-DE,zh-Hans node store-assets/app-events/build-wbd-images.mjs
// Output:  store-assets/app-events/wbd-2027/<locale>/{bear,anon}-{card,details}.png
//          (+ the raw screens in store-assets/out/wbd-screens/, not committed)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '../..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT || 9338);
const BASE = process.env.BASE || 'http://localhost:8765';
const DATE = '2027-03-30';
// Store locale → the app's UI language (the app has one European Portuguese).
const LOCALE_LANG = { 'en-GB': 'en', 'fr-FR': 'fr', 'es-ES': 'es', 'de-DE': 'de', it: 'it', 'pt-PT': 'pt', 'pt-BR': 'pt',
  'nl-NL': 'nl', pl: 'pl', sv: 'sv', 'zh-Hans': 'zh' };
const LOCALES = (process.env.LOCALES || Object.keys(LOCALE_LANG).filter(l => l !== 'en-GB').join(',')).split(',');
const SW = 390, SH = 844, DSF = 3;   // the captured phone screen (CSS px)

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function wsUrl() {
  for (let i = 0; i < 50; i++) {
    try { const j = await (await fetch(`http://localhost:${PORT}/json/version`)).json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch (_) {}
    await sleep(200);
  }
  throw new Error('Chrome CDP never came up');
}
function client(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } });
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); });
}
async function tab(send, w, h, dsf, mobile) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile }, sessionId);
  const ev = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId).then(r => r.result && r.result.value).catch(() => null);
  const shot = async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64');
  return { sessionId, targetId, ev, shot, close: () => send('Target.closeTarget', { targetId }) };
}

// ── 1. the real screens ─────────────────────────────────────────────────────
async function captureScreens(send, lang) {
  const out = path.join(REPO, 'store-assets/out/wbd-screens', lang);
  mkdirSync(out, { recursive: true });
  const shots = {};
  for (const [app, page, readyJs] of [
    ['bear', 'index.html', `!!document.querySelector('.bbaw-today') && document.body.innerText.length > 200`],
    ['anon', 'anonymous.html', `!!document.querySelector('.bbaw-today') && document.body.innerText.length > 200`],
  ]) {
    const t = await tab(send, SW, SH, DSF, true);
    // Light theme, a morning clock on the day itself (the greeting follows the
    // time), onboarding finished, and the board's cached member state so it opens
    // on the board rather than the sign-up screen.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, t.sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      try {
        const set = (k, v) => localStorage.setItem(k, v);
        set('bbTheme', 'light'); set('bbAnonTheme', 'light');
        set('bbOnboardingStep', '12'); set('bbHasEntries', '1');
        set('bbAnon_monika', 'SunnyBear'); set('bbAnon_verified', 'true'); set('bbAnon_agreedTerms', 'true');
        set('bbWhatsNewSeen', '99.0'); set('bbAnonWhatsNewSeen', '99.0');
      } catch (e) {}
      const RealDate = Date, shift = new RealDate('${DATE}T09:30:00').getTime() - RealDate.now();
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + shift); }
        static now() { return RealDate.now() + shift; }
      }
      window.Date = FakeDate;
    })();` }, t.sessionId);
    const to = encodeURIComponent(`${page}?awareDate=${DATE}`);
    await send('Page.navigate', { url: `${BASE}/store-assets/_ipadseed.html?lang=${lang}&to=${to}` }, t.sessionId);
    let ok = false;
    for (let i = 0; i < 80; i++) { await sleep(300); if (await t.ev(`(()=>{try{return ${readyJs}}catch(e){return false}})()`)) { ok = true; break; } }
    // Web-only chrome, first-run overlays, hints, confetti / sunflower bursts.
    await t.ev(`['pwa-install-banner','bbWelcomeModal','skWelcomeModal','signinHint','logoHint','bbHintOverlay','bbHomeVersion']
      .forEach(id=>{const e=document.getElementById(id);if(e)e.remove();});
      document.querySelectorAll('[id*="install-banner"]').forEach(e=>e.remove()); true`);
    await sleep(4500);   // the logo bounce + the day's sunflower burst settle
    // The board: never a real member's post in an advert (and they are in their
    // own language). Keep only the day's card and the daily greeting/check-in;
    // drop our seeded moniker chip.
    await t.ev(`document.querySelectorAll('.post-card, .topic-card').forEach(e=>e.remove());
      ['board-user-pill'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.visibility='hidden';}); true`);
    await t.ev(`document.querySelectorAll('body > div, body > span').forEach(el=>{ const cs=getComputedStyle(el);
      if (cs.position==='fixed' && (+cs.zIndex||0) >= 9000 && !el.contains(document.getElementById('app-shell'))) el.remove(); }); true`);
    await sleep(300);
    const png = await t.shot();
    writeFileSync(path.join(out, `${app}.png`), png);
    shots[app] = png;
    console.log(`  ${lang}/${app} screen  ready=${ok}`);
    await t.close();
  }
  return shots;
}

// ── 2. the composition ──────────────────────────────────────────────────────
const dataUri = (buf, mime = 'image/png') => `data:${mime};base64,${buf.toString('base64')}`;
const BEAR_LOGO = dataUri(readFileSync(path.join(REPO, 'images/logos/good_logo.png')));
const ANON_ICON = dataUri(readFileSync(path.join(REPO, 'icons/AppIcon_anonymous_1024_store.png')));

function html(kind, app, screen) {
  const card = kind === 'card';
  const W = card ? 1920 : 1080, H = card ? 1080 : 1920;
  // Sunflowers: [left, top, size] as in the English images.
  const flowers = card
    ? [[85, 35, 180], [335, 245, 115], [860, 55, 95], [1510, -15, 110], [1720, 815, 150]]
    : [[50, 55, 160], [840, 115, 150], [-20, 755, 115], [905, 895, 115]];
  const logo = app === 'bear'
    ? `<img src="${BEAR_LOGO}" style="width:${card ? 270 : 230}px;display:block;filter:drop-shadow(0 18px 30px rgba(120,70,0,.18))">`
    : `<img src="${ANON_ICON}" style="width:${card ? 360 : 300}px;border-radius:${card ? 80 : 66}px;display:block;box-shadow:0 22px 50px rgba(120,70,0,.22)">`;
  const logoPos = card
    ? (app === 'bear' ? 'left:565px;top:125px' : 'left:520px;top:120px')
    : (app === 'bear' ? 'left:425px;top:95px' : 'left:390px;top:90px');
  // The phone: the captured screen's top part in a dark rounded frame, tilted.
  const phone = card
    ? { left: 1040, top: 70, w: 500, h: 940, rot: 4 }
    : { left: 245, top: 450, w: 590, h: 1140, rot: -3 };
  const inner = { w: phone.w - 28, h: phone.h - 28 };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden}
  body{background:linear-gradient(${card ? '165deg' : '180deg'},#ffe27a 0%,#fdcf3f 45%,#f6a90d 100%);position:relative;font-family:-apple-system,system-ui}
  .f{position:absolute;line-height:1;filter:drop-shadow(0 10px 14px rgba(110,70,0,.22))}
  .phone{position:absolute;left:${phone.left}px;top:${phone.top}px;width:${phone.w}px;height:${phone.h}px;transform:rotate(${phone.rot}deg);
    background:#2a1c10;border-radius:${card ? 70 : 80}px;box-shadow:0 40px 80px rgba(110,60,0,.32);padding:14px;box-sizing:border-box}
  .screen{width:${inner.w}px;height:${inner.h}px;border-radius:${card ? 58 : 68}px;overflow:hidden;background:#fff8ee}
  .screen img{width:100%;display:block}
  </style></head><body>
  ${flowers.map(([l, t, s]) => `<div class="f" style="left:${l}px;top:${t}px;font-size:${s}px">🌻</div>`).join('')}
  <div style="position:absolute;${logoPos}">${logo}</div>
  <div class="phone"><div class="screen"><img src="${dataUri(screen)}"></div></div>
  </body></html>`;
}

async function compose(send, locale, shots) {
  const out = path.join(HERE, 'wbd-2027', locale);
  mkdirSync(out, { recursive: true });
  for (const app of ['bear', 'anon']) for (const kind of ['card', 'details']) {
    const [w, h] = kind === 'card' ? [1920, 1080] : [1080, 1920];
    const t = await tab(send, w, h, 1, false);
    const file = path.join(REPO, 'store-assets/out/wbd-screens', `_compose.html`);
    writeFileSync(file, html(kind, app, shots[app]));
    await send('Page.navigate', { url: `${BASE}/store-assets/out/wbd-screens/_compose.html?${Date.now()}` }, t.sessionId);
    for (let i = 0; i < 40; i++) { await sleep(150); if (await t.ev(`document.readyState==='complete' && [...document.images].every(i=>i.complete)`)) break; }
    await sleep(300);
    writeFileSync(path.join(out, `${app}-${kind}.png`), await t.shot());
    await t.close();
  }
  console.log(`  ${locale}: 4 images`);
}

async function main() {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox', '--no-first-run',
    '--disable-extensions', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
  try {
    const ws = new WebSocket(await wsUrl());
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const send = client(ws);
    const cache = {};
    for (const locale of LOCALES) {
      const lang = LOCALE_LANG[locale];
      if (!lang) throw new Error('unknown locale ' + locale);
      console.log(locale);
      cache[lang] = cache[lang] || await captureScreens(send, lang);
      await compose(send, locale, cache[lang]);
    }
    ws.close();
  } finally { chrome.kill(); }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
