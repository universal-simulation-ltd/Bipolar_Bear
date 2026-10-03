// Build the Google Play promo videos for BIPOLAR BEAR and BIPOLAR ANONYMOUS
// (James, 2026-10-03/04), on the theme of the original Bipolar Bear video
// (youtube.com/watch?v=OVs31AEHlcc): a glowing line drawn across the brand
// ground, faces popping onto it one by one as it rises, a dip into the app,
// and back out to the whole line with the title.
//
//   bear       Bipolar Bear's orange. The mood bears themselves sit on the
//              line, low to elevated, and the manic bear bursts in at the
//              peak. The phones are the store set's own screens.
//   anonymous  Bipolar Anonymous's yellow. The faces are the community:
//              board-style initial avatars, each sharing a mood bear in a
//              speech bubble, and the blindfolded bear at the peak. The phones
//              are the board mock-ups (no real posts).
//
// The app's name is the only text (the original's tagline and Play badge are
// gone), so one video serves every listing language.
//
//   node build-video.mjs bear                  → out/promo-video.mp4            (1920×1080, 8 s, silent)
//   node build-video.mjs anonymous             → out/anonymous/promo-video.mp4
//   node build-video.mjs bear --stills 1,3,5   PNG frames to look at first
//
// Needs Playwright (PLAYWRIGHT=…/index.mjs, a resolvable `playwright`, or the
// umbrella's backoffice/universal-platform copy) and ffmpeg on PATH. Play
// takes a YouTube link: upload to the UNISIM UK channel as Unlisted, then
// `node Docs_UNI_SIM/store-kit/play.mjs video <package> <url>`.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const W = 1920, H = 1080, FPS = 30, SECONDS = 8;
const argv = process.argv.slice(2);
const stillsArg = argv.indexOf('--stills');
const stills = stillsArg >= 0 ? argv.splice(stillsArg, 2)[1].split(',').map(Number) : null;

const THEMES = {
  bear: {
    out: 'out',
    // shared.css .bg-orange
    bg: `radial-gradient(120% 80% at 50% -10%, #ffc266 0%, rgba(255,194,102,0) 55%),
      linear-gradient(160deg, #ffaa33 0%, #ff8833 42%, #ff6b00 100%)`,
    shadow: 'rgba(150,60,0,.45)',
    title: { icon: '/icons/favicons/android-chrome-512x512.png', name: 'Bipolar<br>Bear', colour: '#fff', textShadow: '0 6px 20px rgba(150,60,0,.35)' },
    faces: ['depressed', 'low', 'stable', 'good', 'elevated'].map((mood) => ({ mood })),
    peak: '/images/moods/manic.png',
    // The store set's own screens, captured without their frame.
    phones: [
      { file: 'screen2-sleep.html', select: '.device .screen', t0: 4.85, dx: -470, top: 170, rot: -7 },
      { file: 'screen5-survivalkit.html', select: '.device .screen', t0: 5.1, dx: 470, top: 150, rot: 6 },
      { file: 'screen3-patterns.html', select: '.device .screen', t0: 4.97, dx: 0, top: 90, rot: 0 },
    ],
  },
  anonymous: {
    out: 'out/anonymous',
    // shared.css .bg-yellow
    bg: `radial-gradient(120% 80% at 50% -10%, #ffe680 0%, rgba(255,230,128,0) 55%),
      linear-gradient(160deg, #ffd84d 0%, #f5c800 50%, #e0b400 100%)`,
    shadow: 'rgba(90,60,0,.45)',
    title: { icon: '/icons/Bipolar_Anonymous_Trans.png', name: 'Bipolar<br>Anonymous', colour: '#3d2c00', textShadow: 'none' },
    // The board's own avatar colours (build-anon-hero.mjs).
    faces: [
      ['QO', 'linear-gradient(135deg,#ffb340,#e07800)', 'depressed'],
      ['SS', 'linear-gradient(135deg,#81c784,#2e7d32)', 'low'],
      ['NW', 'linear-gradient(135deg,#ce93d8,#7b1fa2)', 'stable'],
      ['JR', 'linear-gradient(135deg,#f48fb1,#c2185b)', 'good'],
      ['BB', 'linear-gradient(135deg,#64b5f6,#1565c0)', 'elevated'],
    ].map(([ini, grad, mood]) => ({ ini, grad, mood })),
    peak: '/icons/Bipolar_Anonymous_Trans.png',
    phones: [
      { file: '_board-feed.html', t0: 4.85, dx: -330, top: 150, rot: -7 },
      { file: '_board-thread.html', t0: 5.0, dx: 300, top: 80, rot: 5 },
    ],
  },
};
const appName = argv[0];
const theme = THEMES[appName];
if (!theme) {
  console.error(`usage: node build-video.mjs ${Object.keys(THEMES).join('|')} [--stills 1,3,5]`);
  process.exit(2);
}

// ── The line: a world wider than the screen, panned across like the original ──
const WW = 2900;
const lineY = (x) => 905 - 520 * (x / WW) + 62 * Math.sin((x / WW) * Math.PI * 2 * 2.1 + 0.4);
const pts = [];
for (let x = -60; x <= WW + 60; x += 20) pts.push([x, lineY(x)]);
const d = 'M' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
const area = `${d} L${WW + 60},${H + 400} L-60,${H + 400} Z`;

const PX = [1080, 1400, 1720, 2040, 2360];
const PEAK = 2700;
const faces = theme.faces.map((f, i) => ({ ...f, x: PX[i], y: lineY(PX[i]) }));

// A face on the line: a mood bear on its own, or a community member (an
// initial avatar) holding one up in a speech bubble.
const face = (f) => f.ini
  ? `<div class="face" style="left:${f.x}px;top:${f.y}px">
      <div class="bubble"><img src="/images/moods/${f.mood}.png" alt=""></div>
      <div class="disc" style="background:${f.grad}">${f.ini}</div>
    </div>`
  : `<div class="face" style="left:${f.x}px;top:${f.y}px"><img class="bear" src="/images/moods/${f.mood}.png" alt=""></div>`;

const phone = (i) => `<div class="phone" id="phone${i}"><div class="scr"><img src="/video-src/${appName}-${i}.png" alt=""></div><div class="isl"></div></div>`;

const SPARKS = [[300, 140, 34], [1820, 980, 40], [1500, 120, 26], [140, 900, 30], [960, 60, 22]];
const STAR = '<svg viewBox="0 0 20 20"><path d="M10 0 C11 7 13 9 20 10 C13 11 11 13 10 20 C9 13 7 11 0 10 C7 9 9 7 10 0Z" fill="#fff"/></svg>';
const name = theme.title.name.replace('<br>', ' ');

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name} promo</title>
<link rel="stylesheet" href="/store-assets/fonts.css">
<style>
  *{ box-sizing:border-box; margin:0; padding:0; }
  html,body{ width:${W}px; height:${H}px; overflow:hidden; }
  body{ font-family:'Nunito','Segoe UI',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  #bg{ position:absolute; inset:0; background:${theme.bg}; }
  .ring{ position:absolute; left:0; top:0; border-radius:50%; border:3px solid #fff; }
  .dot{ position:absolute; left:0; top:0; border-radius:50%; background:#fff; }
  .spark{ position:absolute; opacity:.55; }
  #world{ position:absolute; left:0; top:0; width:${WW}px; height:${H}px; transform-origin:0 0; }
  #world svg{ position:absolute; left:0; top:0; overflow:visible; }
  .face{ position:absolute; width:0; height:0; }
  .bear{ position:absolute; left:-78px; top:-92px; width:156px; height:156px; filter:drop-shadow(0 14px 18px ${theme.shadow}); }
  .disc{ position:absolute; left:-56px; top:-56px; width:112px; height:112px; border-radius:50%;
    display:flex; align-items:center; justify-content:center; color:#fff; font-weight:900; font-size:44px;
    border:7px solid rgba(255,255,255,.95); box-shadow:0 18px 30px -12px ${theme.shadow}; }
  .bubble{ position:absolute; left:-30px; top:-232px; width:132px; height:128px; border-radius:34px; background:#fff;
    display:flex; align-items:center; justify-content:center; transform-origin:30px 150px;
    box-shadow:0 18px 30px -14px ${theme.shadow}; }
  .bubble::after{ content:''; position:absolute; left:22px; bottom:-18px; border:12px solid transparent;
    border-top:16px solid #fff; border-bottom:0; }
  .bubble img{ width:104px; height:104px; }
  #peak{ position:absolute; width:230px; height:230px; left:${PEAK - 115}px; top:${lineY(PEAK) - 175}px; filter:drop-shadow(0 16px 22px ${theme.shadow}); }
  #title{ position:absolute; left:96px; top:110px; display:flex; flex-direction:column; align-items:flex-start; gap:22px; }
  #title img{ width:210px; height:210px; filter:drop-shadow(0 18px 24px ${theme.shadow}); }
  #title .name{ font-weight:900; font-size:108px; line-height:.98; letter-spacing:-.02em; color:${theme.title.colour}; text-shadow:${theme.title.textShadow}; }
  .phone{ position:absolute; left:0; top:0; width:390px; padding:15px; border-radius:62px; background:#0b0b0d;
    box-shadow:0 2px 0 2px rgba(255,255,255,.08) inset, 0 60px 110px -30px rgba(80,55,0,.6), 0 24px 50px -20px rgba(0,0,0,.45); }
  .phone .scr{ position:relative; overflow:hidden; border-radius:48px; background:#fff; }
  .phone .scr img{ display:block; width:100%; }
  .phone .isl{ position:absolute; top:28px; left:50%; transform:translateX(-50%); width:100px; height:28px; border-radius:16px; background:#08080a; }
</style></head><body>
<div id="bg"></div>
<div id="rings">${'<div class="ring"></div>'.repeat(7)}</div>
<div id="dots">${'<div class="dot"></div>'.repeat(16)}</div>
${SPARKS.map(([x, y, s]) => `<div class="spark" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px">${STAR}</div>`).join('')}
<div id="world">
  <svg width="${WW}" height="${H}" viewBox="0 0 ${WW} ${H}">
    <defs>
      <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".34"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <filter id="glow" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
      <!-- The fill follows the line in with a soft leading edge, not a hard one. -->
      <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff"/><stop offset=".8" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <mask id="reveal" maskUnits="userSpaceOnUse" x="-100" y="-200" width="${WW + 300}" height="${H + 600}"><rect id="revealRect" x="-60" y="-200" width="0" height="${H + 600}" fill="url(#fade)"/></mask>
    </defs>
    <path d="${area}" fill="url(#fill)" mask="url(#reveal)"/>
    <path id="glowLine" d="${d}" fill="none" stroke="#fff" stroke-width="22" stroke-opacity=".55" filter="url(#glow)" stroke-linecap="round"/>
    <path id="line" d="${d}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
  </svg>
  <div id="bursts">${'<div class="ring"></div>'.repeat(faces.length + 1)}</div>
  ${faces.map(face).join('')}
  <img id="peak" src="${theme.peak}" alt="">
</div>
<div id="title"><img src="${theme.title.icon}" alt=""><div class="name">${theme.title.name}</div></div>
${theme.phones.map((_, i) => phone(i)).join('\n')}
<script>
(() => {
  const W = ${W}, H = ${H}, WW = ${WW}
  const FACES = ${JSON.stringify(faces.map(({ x, y }) => ({ x, y })))}, PEAK = { x: ${PEAK}, y: ${lineY(PEAK)} }
  const PHONES = ${JSON.stringify(theme.phones.map(({ t0, dx, top, rot }) => ({ t0, dx, top, rot })))}
  const clamp = (x) => Math.min(1, Math.max(0, x))
  const seg = (t, a, b) => clamp((t - a) / (b - a))
  const outCubic = (x) => 1 - Math.pow(1 - x, 3)
  const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
  const outBack = (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2)
  const inBack = (x) => 2.70158 * x * x * x - 1.70158 * x * x
  const lerp = (a, b, p) => a + (b - a) * p
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const dots = [...document.querySelectorAll('#dots .dot')].map((el) => ({ el, x: rnd() * W, y: rnd() * H, s: 8 + rnd() * 20, a: 0.2 + rnd() * 0.25, v: 14 + rnd() * 26 }))
  const rings = [...document.querySelectorAll('#rings .ring')]
  const bursts = [...document.querySelectorAll('#bursts .ring')]
  const faces = [...document.querySelectorAll('.face')]
  const sparks = [...document.querySelectorAll('.spark')]
  const $ = (id) => document.getElementById(id)
  const line = $('line'), glow = $('glowLine'), L = line.getTotalLength()
  line.style.strokeDasharray = glow.style.strokeDasharray = L
  const ring = (el, cx, cy, r, a, w = 3) => {
    el.style.width = el.style.height = 2 * r + 'px'
    el.style.transform = 'translate(' + (cx - r) + 'px,' + (cy - r) + 'px)'
    el.style.opacity = a; el.style.borderWidth = w + 'px'
  }

  window.render = (t) => {
    // Ripples from the upper right, as in the original.
    const MAX = 1400
    rings.forEach((el, k) => {
      const r = (t * 110 + k * (MAX / rings.length)) % MAX
      ring(el, 1300, 380, r, 0.3 * (1 - r / MAX) * Math.min(1, r / 100))
    })
    for (const d of dots) {
      const y = ((d.y - t * d.v) % H + H) % H
      d.el.style.width = d.el.style.height = d.s + 'px'
      d.el.style.transform = 'translate(' + d.x + 'px,' + y + 'px)'
      d.el.style.opacity = d.a
    }
    sparks.forEach((el, i) => { const s = 0.75 + 0.25 * Math.sin(t * 2.6 + i * 1.7); el.style.transform = 'scale(' + s + ') rotate(' + (t * 20 + i * 30) + 'deg)' })

    // The camera: open on the start of the line, pan along it as the faces
    // arrive, then pull back to show the whole line.
    const pan = inOutCubic(seg(t, 1.7, 4.7)), back = inOutCubic(seg(t, 6.25, 7.0))
    const tx = lerp(lerp(0, -(WW - W + 60), pan), 330, back), ty = lerp(0, 300, back), s = lerp(1, 0.55, back)
    $('world').style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')'

    // The line draws itself in.
    const draw = inOutCubic(seg(t, 0.15, 1.9))
    const visible = Math.max(draw * 1950, pan > 0 ? 1950 + pan * (WW - 1950 + 100) : 0)
    line.style.strokeDashoffset = glow.style.strokeDashoffset = Math.max(0, L - L * Math.min(1, visible / (WW + 120)))
    $('revealRect').setAttribute('width', visible + 260)

    // The title rides with the start of the line, and comes back at the end.
    const title = $('title')
    title.style.transformOrigin = '0 0'
    if (back > 0) {
      title.style.transform = 'translate(0,' + lerp(40, 70, back) + 'px) scale(' + 0.82 * outBack(seg(t, 6.45, 7.0)) + ')'
      title.style.opacity = 1
    } else {
      const out = inOutCubic(seg(t, 1.7, 2.6))
      title.style.transform = 'translate(' + -out * 900 + 'px,0) scale(' + outBack(seg(t, 0.25, 0.85)) + ')'
      title.style.opacity = 1 - out
    }

    // The faces pop onto the line, one by one as it rises.
    faces.forEach((el, i) => {
      const at = 2.05 + i * 0.4
      const p = seg(t, at, at + 0.5), b = outBack(p, 2.2)
      el.style.visibility = p > 0 ? 'visible' : 'hidden'
      if (el.children.length === 1) {
        el.children[0].style.transform = 'scale(' + b + ') translateY(' + Math.sin(t * 2.4 + i) * 4 + 'px)'
      } else {
        const [bub, disc] = el.children
        disc.style.transform = 'scale(' + b + ')'
        bub.style.transform = 'scale(' + outBack(seg(t, at + 0.18, at + 0.62), 2) + ') translateY(' + Math.sin(t * 2.4 + i) * 4 + 'px)'
      }
      const bp = seg(t, at + 0.1, at + 1.2)
      ring(bursts[i], FACES[i].x, FACES[i].y, 50 + 300 * outCubic(bp), bp > 0 && bp < 1 ? 0.6 * (1 - bp) : 0, 4)
    })
    // …and the peak arrives with a burst.
    const pk = seg(t, 4.15, 4.75)
    const peak = $('peak')
    peak.style.transform = 'scale(' + outBack(pk, 2.4) + ') rotate(' + (Math.sin(t * 3) * 4) + 'deg)'
    peak.style.visibility = pk > 0 ? 'visible' : 'hidden'
    const bp = seg(t, 4.25, 5.5)
    ring(bursts[FACES.length], PEAK.x, PEAK.y - 60, 80 + 520 * outCubic(bp), bp > 0 && bp < 1 ? 0.7 * (1 - bp) : 0, 5)

    // A dip into the app: phones spring up over the line, then drop away.
    PHONES.forEach(({ t0, dx, top, rot }, i) => {
      const el = $('phone' + i)
      const p = outBack(seg(t, t0, t0 + 0.6)), o = inBack(seg(t, 6.0 + i * 0.06, 6.45 + i * 0.06))
      el.style.transform = 'translate(' + (W / 2 - 195 + dx) + 'px,' + (top + 1100 * (1 - p) + 1150 * o) + 'px) rotate(' + (rot + (1 - p) * (rot || 4) * 2) + 'deg)'
      el.style.visibility = t > t0 && o < 1 ? 'visible' : 'hidden'
    })
    $('world').style.filter = 'blur(' + (6 * seg(t, 4.9, 5.3) * (1 - seg(t, 6.0, 6.4))) + 'px)'
  }
  window.render(0)
})()
</script>
<script>(async () => {
  await document.fonts.ready
  await Promise.all([...document.images].map((i) => (i.complete && i.naturalWidth) ? null : new Promise((r) => { i.onload = i.onerror = r })))
  window.__ready = true
})()</script>
</body></html>`;

// ── Render ─────────────────────────────────────────────────────────────────
async function playwright() {
  if (process.env.PLAYWRIGHT) return import(pathToFileURL(process.env.PLAYWRIGHT).href);
  try {
    return await import('playwright');
  } catch {
    const umbrella = path.resolve(repo, '../backoffice/universal-platform/node_modules/playwright/index.mjs');
    if (existsSync(umbrella)) return import(pathToFileURL(umbrella).href);
    throw new Error("Playwright not found: set PLAYWRIGHT to a copy's index.mjs");
  }
}

// The phone screens are remade every run, into a temp folder.
const src = path.join(tmpdir(), 'bipolar-bear-video-src');
await mkdir(src, { recursive: true });

// One origin over the repo: the store screens' REPO/ placeholder becomes the
// root, as build-all.mjs points it at the repo.
const TYPES = { '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.html': 'text/html' };
const ORIGIN = 'https://bb.test';
async function serve(ctx) {
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    const p = decodeURIComponent(url.pathname);
    if (p === '/video.html') return route.fulfill({ body: page, contentType: 'text/html' });
    const file = p.startsWith('/video-src/') ? path.join(src, p.slice(11)) : path.join(repo, p);
    try {
      let body = await readFile(file);
      if (p.endsWith('.html')) body = body.toString().replaceAll('REPO/', '/');
      await route.fulfill({ body, contentType: TYPES[path.extname(p)] ?? 'application/octet-stream' });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
}

const { chromium } = await playwright();
const browser = await chromium.launch();

const shotCtx = await browser.newContext({ viewport: { width: 1290, height: 2796 }, deviceScaleFactor: 0.5 });
await serve(shotCtx);
for (const [i, { file, select }] of theme.phones.entries()) {
  const p = await shotCtx.newPage();
  await p.goto(`${ORIGIN}/store-assets/screens/${file}`);
  await p.evaluate(() => document.fonts.ready);
  const out = path.join(src, `${appName}-${i}.png`);
  if (select) {
    // The video draws its own frame: square the screen's corners, drop its island.
    await p.addStyleTag({ content: `${select}{ border-radius:0 !important; } ${select} .island{ display:none !important; }` });
    await writeFile(out, await p.locator(select).first().screenshot());
  } else {
    await writeFile(out, await p.screenshot());
  }
  await p.close();
}
await shotCtx.close();

const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await serve(ctx);
const tab = await ctx.newPage();
const errors = [];
tab.on('pageerror', (e) => errors.push(String(e)));
await tab.goto(`${ORIGIN}/video.html`);
await tab.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);

const outDir = path.join(here, theme.out);
await mkdir(outDir, { recursive: true });
if (stills) {
  for (const t of stills) {
    await tab.evaluate((t) => window.render(t), t);
    const out = path.join(outDir, `promo-still-${t}.png`);
    await writeFile(out, await tab.screenshot());
    console.log(path.relative(process.cwd(), out));
  }
} else {
  const out = path.join(outDir, 'promo-video.mp4');
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (code) => (code ? rej(new Error(`ffmpeg exited ${code}`)) : res())));
  for (let f = 0; f < FPS * SECONDS; f++) {
    await tab.evaluate((t) => window.render(t), f / FPS);
    if (!ff.stdin.write(await tab.screenshot())) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  console.log(`${path.relative(process.cwd(), out)}  ${W}×${H}, ${SECONDS}s at ${FPS} fps`);
}
await browser.close();
