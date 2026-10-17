// App Store creative assets (iOS 27, live in App Store Connect 2026-10-05):
// the product page header and the search results image, for Bipolar Bear and
// Bipolar Anonymous, in every App Store locale.
//
//   header  21:9  3840×1646  leads the product page; the store lays the icon,
//                            name and Get over it, so it carries no words and
//                            one design serves every language (Apple: "a
//                            single, clear idea"). Subject in the centre and
//                            the top two thirds, where every crop keeps it.
//   search  3:2   3840×2560  the first thing seen on the Search tab (Apple:
//                            "state the obvious", "showcase the firsthand
//                            experience"): the hero headline beside the app
//                            itself, in that language.
//
// Bipolar Bear's idea is the mood line: the five mood bears riding one wave of
// highs and lows, Stable at its centre. Anonymous's is "you're not alone": the
// blindfolded bear inside a ring of anonymous members.
//
// Output is laid out the way Docs_UNI_SIM/store-kit/asc-creative.mjs reads it:
//   creative/<app>/app-store.<locale>.json        ({"locale": …} — just enough)
//   creative/<app>/out/<locale>/header/header.png
//   creative/<app>/out/<locale>/search/search.png
// so uploading is the suite's command (dry run without --apply):
//   node ../../Docs_UNI_SIM/store-kit/asc-creative.mjs creative/bipolarbear --bundle com.app.bipolarbear --version <x.y>
//   node ../../Docs_UNI_SIM/store-kit/asc-creative.mjs creative/anonymous --bundle com.bipolaranonymous.app --version <x.y>
//
// Phones show real captures of today's app in that language, as the iPhone
// screenshots do: the whole iPhone screens (status bar drawn) that
// build-appstore-iphone.mjs composes from capture-appstore-iphone.mjs, in
// out/appstore/screen/<app>/<lang>/: Bear's home and the mood wheel,
// Anonymous's board and today's topic. Headlines are the heroes' own (head1).
//
//   cd store-assets && node build-creative.mjs [bipolarbear|anonymous] [lang …]
//
// Needs Playwright's Chromium (screenshots come back RGB: Apple refuses alpha):
// PLAYWRIGHT=/path/to/playwright/index.mjs, or a resolvable `playwright`, or
// the umbrella's backoffice/universal-platform copy.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ALL = ['en', 'es', 'fr', 'de', 'it', 'pt', 'pt-BR', 'nl', 'pl', 'sv', 'zh'];
const ASC = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it', pt: 'pt-PT', 'pt-BR': 'pt-BR',
  nl: 'nl-NL', pl: 'pl', sv: 'sv', zh: 'zh-Hans' };
const args = process.argv.slice(2);
const APPS = ['bipolarbear', 'anonymous'].filter(a => !args.some(x => /^[a-z]{4,}$/.test(x)) || args.includes(a));
const LANGS = args.filter(a => ALL.includes(a));
const langs = LANGS.length ? LANGS : ALL;

const file = p => pathToFileURL(path.resolve(p)).href;
const face = f => file(`../images/moods/${f}`);

async function playwright() {
  if (process.env.PLAYWRIGHT) return import(pathToFileURL(process.env.PLAYWRIGHT).href);
  try { return await import('playwright'); } catch {}
  return import(file('../../backoffice/universal-platform/node_modules/playwright/index.mjs'));
}
const { chromium } = await playwright();
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

// Shrinks every [data-fit] box until its text fits its width (long German /
// Dutch headlines), then waits for fonts and images.
const FIT = `<script>
  window.ready = (async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
    for (const el of document.querySelectorAll('[data-fit]')) {
      let fs = parseFloat(getComputedStyle(el).fontSize);
      const maxH = +el.dataset.fit || Infinity;
      while ((el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > maxH) && fs > 40) el.style.fontSize = (fs -= 4) + 'px';
    }
  })();
</script>`;

// Builds are written next to the templates so ../fonts.css resolves.
async function shoot(html, out, W, H) {
  const built = 'screens/_creative_build.html';
  writeFileSync(built, html);
  await page.setViewportSize({ width: W, height: H });
  await page.goto(file(built));
  await page.evaluate(() => window.ready);
  mkdirSync(path.dirname(out), { recursive: true });
  const buf = await page.screenshot({ path: out });
  rmSync(built);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), alpha = buf[25] === 6;
  const ok = w === W && h === H && !alpha;
  console.log(`${ok ? 'OK ' : 'BAD'} ${out} ${w}×${h}${alpha ? ' (alpha)' : ''}`);
  if (!ok) process.exitCode = 1;
}

const SHELL = (W, H, css, inner, lang = 'en') => `<!doctype html><html lang="${lang}"><head>
<meta charset="utf-8"><link rel="stylesheet" href="../fonts.css">
<style>
  *{ box-sizing:border-box; margin:0; padding:0; }
  html,body{ width:${W}px; height:${H}px; overflow:hidden; background:#fff; }
  .canvas{ position:relative; width:${W}px; height:${H}px; overflow:hidden;
    font-family:'Nunito','PingFang SC','Segoe UI',system-ui,sans-serif;
    -webkit-font-smoothing:antialiased; text-rendering:geometricPrecision; }
  .abs{ position:absolute; }
  .bg-white{ background:#ffffff; }
  .bg-orange{ background:
    radial-gradient(120% 80% at 50% -10%, #ffc266 0%, rgba(255,194,102,0) 55%),
    linear-gradient(160deg, #ffaa33 0%, #ff8833 42%, #ff6b00 100%); }
  .bg-yellow{ background:
    radial-gradient(120% 80% at 50% -10%, #ffe680 0%, rgba(255,230,128,0) 55%),
    linear-gradient(160deg, #ffd84d 0%, #f5c800 50%, #e0b400 100%); }
  .head{ position:absolute; font-weight:900; letter-spacing:-.015em; line-height:1.04; color:#26201a; white-space:nowrap; }
  .head .hl{ color:#e0a800; }
  .face img{ width:100%; display:block; filter:drop-shadow(0 30px 34px rgba(110,50,0,.32)); }
  /* iPhone frame, as the heroes draw it (shared.css .device), scaled by --s */
  .phone{ position:absolute; padding:calc(18px*var(--s)); border-radius:calc(74px*var(--s)); background:#0b0b0d;
    box-shadow: 0 2px 0 2px rgba(255,255,255,.08) inset,
      0 80px 160px -40px rgba(60,30,0,.55), 0 30px 60px -24px rgba(0,0,0,.45); }
  .phone .scr{ position:relative; width:100%; border-radius:calc(58px*var(--s)); overflow:hidden; background:#FFFBF5; line-height:0; }
  .phone .scr img{ width:100%; display:block; }
  .phone .isl{ position:absolute; top:calc(20px*var(--s)); left:50%; transform:translateX(-50%);
    width:calc(118px*var(--s)); height:calc(34px*var(--s)); border-radius:calc(20px*var(--s)); background:#08080a; }
  .av{ position:absolute; border-radius:50%; display:flex; align-items:center; justify-content:center;
    color:#fff; font-weight:800; font-family:'Segoe UI',system-ui,sans-serif;
    box-shadow:0 26px 40px -14px rgba(90,60,0,.45); }
  ${css}
</style></head><body><div class="canvas">${inner}</div>${FIT}</body></html>`;

// The Dynamic Island sits in the screen's own status bar (the store kit's
// 2.5% down, 28.64% × 8.41% of the screen's width).
const phone = (img, w, style) => `<div class="phone" style="--s:${w / 1290};width:${w}px;${style}">
  <div class="scr" style="container-type:inline-size"><img src="${img}" alt="">
  <div style="position:absolute;left:50%;transform:translateX(-50%);top:2.5cqw;width:28.64cqw;height:8.41cqw;border-radius:999px;background:#08080a"></div></div></div>`;
const screen = (app, lang, name) => {
  const f = `out/appstore/screen/${app}/${lang}/${name}.png`;
  if (!existsSync(f)) throw new Error(`no ${f}: run capture-appstore-iphone.mjs + build-appstore-iphone.mjs ${app} ${lang}`);
  return file(f);
};
const av = (t, grad, d, x, y, rot = 0, extra = '') => `<div class="av" style="left:${x - d / 2}px;top:${y - d / 2}px;width:${d}px;height:${d}px;
  background:${grad};font-size:${Math.round(d * 0.4)}px;border:${Math.round(d * 0.04)}px solid rgba(255,255,255,.92);transform:rotate(${rot}deg);${extra}">${t}</div>`;

// ── Bipolar Bear ────────────────────────────────────────────────────────────

/**
 * The mood line: highs and lows either side of Stable, which sits at the
 * centre, biggest, where the line runs level. Balanced rather than a slope, so
 * it never reads as a fall (manic → depressed) or a climb to mania.
 */
function bearHeader() {
  const W = 3840, H = 1646, mid = 690;
  // [face, x as a fraction of W, height above mid (+) or below (−), size]
  const bears = [['manic.png', 0.16, 340, 360], ['low.png', 0.335, -200, 310], ['stable.png', 0.5, 0, 470],
    ['elevated.png', 0.665, 200, 310], ['depressed.png', 0.84, -340, 340]];
  const knots = [[-0.04, 120], ...bears.map(([, f, dy]) => [f, dy]), [1.04, -120]].map(([f, dy]) => [f * W, mid - dy]);
  // Catmull-Rom through the knots, as cubic Béziers
  let d = `M${knots[0].join(',')}`;
  for (let i = 0; i < knots.length - 1; i++) {
    const [p0, p1, p2, p3] = [knots[Math.max(i - 1, 0)], knots[i], knots[i + 1], knots[Math.min(i + 2, knots.length - 1)]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1.join(',')} ${c2.join(',')} ${p2.join(',')}`;
  }
  const echo = (dy, op, sw) => `<path d="${d}" transform="translate(0 ${dy})" fill="none" stroke="#fff" stroke-opacity="${op}" stroke-width="${sw}" stroke-linecap="round"/>`;
  return SHELL(W, H, '', `<div class="abs bg-orange" style="inset:0"></div>
    <div class="abs" style="left:${W / 2 - 700}px;top:${mid - 700}px;width:1400px;height:1400px;border-radius:50%;
      background:radial-gradient(closest-side, rgba(255,236,200,.6), rgba(255,236,200,0) 70%)"></div>
    <svg class="abs" style="left:0;top:0" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      ${echo(-110, 0.10, 10)}${echo(110, 0.10, 10)}${echo(0, 0.85, 22)}
    </svg>
    ${bears.map(([img, f, dy, s]) => `<div class="abs face" style="left:${f * W - s / 2}px;top:${mid - dy - s / 2}px;width:${s}px"><img src="${face(img)}" alt=""></div>`).join('')}`);
}

const BEAR_HEAD = JSON.parse(readFileSync('screens-i18n/hero_strings.json', 'utf8'));
const BEAR_HEAD_EN = 'Every high.<br>Every low.';

/** The headline on white; the mood picker and home screen on the orange. */
function bearSearch(lang) {
  const W = 3840, H = 2560, split = 1720;
  const head = BEAR_HEAD[lang]?.head1 ?? BEAR_HEAD_EN;
  const faces = [['manic.png', 3600, 420, 280, -8], ['elevated.png', 3660, 860, 230, 6],
    ['low.png', 3640, 1800, 220, 5], ['depressed.png', 3560, 2220, 240, -7]];
  return SHELL(W, H, '', `<div class="abs bg-white" style="inset:0"></div>
    <div class="abs bg-orange" style="left:${split}px;top:0;right:0;bottom:0"></div>
    <div class="abs" style="left:-300px;top:1300px;width:2000px;height:2000px;border-radius:50%;
      background:radial-gradient(closest-side,#fff0db,rgba(255,240,219,0) 72%)"></div>
    <div class="head" data-fit="900" style="left:170px;top:820px;width:1240px;font-size:250px">${head}</div>
    ${faces.map(([img, x, yy, d, r]) => `<div class="abs face" style="left:${x - d / 2}px;top:${yy - d / 2}px;width:${d}px;transform:rotate(${r}deg)"><img src="${face(img)}" alt=""></div>`).join('')}
    ${phone(screen('bear', lang, 'home'), 860, `left:${split - 210}px;top:520px;transform:rotate(-7deg);z-index:1`)}
    ${phone(screen('bear', lang, 'mood'), 960, `left:${split + 600}px;top:260px;transform:rotate(6deg);z-index:2`)}`, lang);
}

// ── Bipolar Anonymous ───────────────────────────────────────────────────────

const AV = [
  ['QO', 'linear-gradient(135deg,#ffb340,#e07800)'], ['SS', 'linear-gradient(135deg,#81c784,#2e7d32)'],
  ['BB', 'linear-gradient(135deg,#64b5f6,#1565c0)'], ['JR', 'linear-gradient(135deg,#f48fb1,#c2185b)'],
  ['NW', 'linear-gradient(135deg,#ce93d8,#7b1fa2)'], ['MK', 'linear-gradient(135deg,#4dd0e1,#00838f)'],
  ['LT', 'linear-gradient(135deg,#ff8a65,#d84315)'], ['AH', 'linear-gradient(135deg,#9575cd,#4527a0)'],
  ['RP', 'linear-gradient(135deg,#aed581,#558b2f)'], ['EV', 'linear-gradient(135deg,#f06292,#ad1457)'], ['DM', 'linear-gradient(135deg,#7986cb,#283593)'],
  ['KC', 'linear-gradient(135deg,#ffd54f,#ef8f00)'], ['TF', 'linear-gradient(135deg,#4db6ac,#00695c)'],
  ['OS', 'linear-gradient(135deg,#e57373,#b71c1c)'], ['HL', 'linear-gradient(135deg,#90a4ae,#37474f)'],
  ['YB', 'linear-gradient(135deg,#ba68c8,#6a1b9a)'],
];

/** You're not alone: the blindfolded bear inside a ring of members. */
function anonHeader() {
  const W = 3840, H = 1646, cx = W / 2, cy = 720, logo = 860;
  // two loose orbits; the far one smaller and softer for depth
  const ring = (n, rx, ry, d, start, op, offset) => Array.from({ length: n }, (_, i) => {
    const a = start + (2 * Math.PI * i) / n;
    const [t, g] = AV[(i + offset) % AV.length];
    return av(t, g, d * (0.9 + 0.2 * ((i * 7) % 3) / 2), cx + rx * Math.cos(a), cy + ry * Math.sin(a), ((i * 13) % 15) - 7, `opacity:${op}`);
  }).join('');
  return SHELL(W, H, '', `<div class="abs bg-yellow" style="inset:0"></div>
    <svg class="abs" style="left:0;top:0" width="${W}" height="${H}">
      <ellipse cx="${cx}" cy="${cy}" rx="1000" ry="470" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="10" stroke-dasharray="2 34" stroke-linecap="round"/>
      <ellipse cx="${cx}" cy="${cy}" rx="1560" ry="560" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="8" stroke-dasharray="2 34" stroke-linecap="round"/>
    </svg>
    <div class="abs" style="left:${cx - 760}px;top:${cy - 760}px;width:1520px;height:1520px;border-radius:50%;
      background:radial-gradient(closest-side, rgba(255,250,225,.75), rgba(255,250,225,0) 70%)"></div>
    ${ring(10, 1560, 560, 190, 0.3, 0.75, 6)}
    ${ring(6, 1000, 470, 250, -Math.PI / 2 + 0.5, 1, 0)}
    <img class="abs" src="${file('../icons/Bipolar_Anonymous_Trans.png')}" alt=""
      style="left:${cx - logo / 2}px;top:${cy - logo / 2}px;width:${logo}px;filter:drop-shadow(0 40px 50px rgba(90,60,0,.35))">`);
}

const ANON_HEAD = JSON.parse(readFileSync('screens-i18n/anon_hero_strings.json', 'utf8'));
/** The headline on white; the board and a reply thread on the yellow. */
function anonSearch(lang, shot) {
  const W = 3840, H = 2560, split = 1720;
  const avs = [[0, 3620, 480, 270, -8], [1, 3680, 960, 230, 6], [3, 3660, 1840, 220, 5], [4, 3580, 2250, 240, -7]];
  return SHELL(W, H, '', `<div class="abs bg-white" style="inset:0"></div>
    <div class="abs bg-yellow" style="left:${split}px;top:0;right:0;bottom:0"></div>
    <div class="abs" style="left:-300px;top:1300px;width:2000px;height:2000px;border-radius:50%;
      background:radial-gradient(closest-side,#fff6d6,rgba(255,246,214,0) 72%)"></div>
    <div class="head" data-fit="900" style="left:170px;top:820px;width:1240px;font-size:250px">${ANON_HEAD[lang].head1}</div>
    ${avs.map(([i, x, y, d, r]) => av(AV[i][0], AV[i][1], d, x, y, r)).join('')}
    ${phone(shot('feed'), 860, `left:${split - 210}px;top:520px;transform:rotate(-7deg);z-index:1`)}
    ${phone(shot('thread'), 960, `left:${split + 600}px;top:260px;transform:rotate(6deg);z-index:2`)}`, lang);
}

// ── Build ───────────────────────────────────────────────────────────────────
for (const app of APPS) {
  const root = `creative/${app}`;
  const headerOnce = `${root}/_header.png`;
  await shoot(app === 'bipolarbear' ? bearHeader() : anonHeader(), headerOnce, 3840, 1646);
  for (const lang of langs) {
    const loc = ASC[lang];
    writeFileSync(`${root}/app-store.${loc}.json`, JSON.stringify({ locale: loc }) + '\n');
    mkdirSync(`${root}/out/${loc}/header`, { recursive: true });
    copyFileSync(headerOnce, `${root}/out/${loc}/header/header.png`);
    if (app === 'bipolarbear') {
      await shoot(bearSearch(lang), `${root}/out/${loc}/search/search.png`, 3840, 2560);
    } else {
      await shoot(anonSearch(lang, n => screen('anon', lang, n)), `${root}/out/${loc}/search/search.png`, 3840, 2560);
    }
  }
  rmSync(headerOnce);
}
await browser.close();
