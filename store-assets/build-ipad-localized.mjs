#!/usr/bin/env node
// Localised 13" iPad App Store sets (2048×2732, opaque PNG) for both apps, en
// (the en-GB set) included, in the en-GB iPad sets' layouts. Every iPad holds a
// real capture of the app in that language (capture-ipad-localized.mjs): App
// Review wants the iPad app in iPad slots, never a phone or a mock-up.
//
//   bear  → out/localized-ipad/<lang>/       01-hero 02-hero (build-ipad-hero.mjs's
//           stitched pair) + 02-journal 03-survivalkit 04-tools 05-pin 06-details
//           (build-ipad.mjs's framed screens), from out/localized-ipad-raw/.
//           Captions: screens-i18n/ipad_strings.json; heroes: hero_strings.json.
//   anon  → out/localized-ipad-anon/<lang>/  01-hero 02-hero (build-anon-ipad-hero.mjs's
//           pair: the feed, and today's topic's thread across the seam) +
//           02-monika 03-ask 04-wiki 05-report, from out/localized-ipad-anon-raw/.
//           Captions: screens-i18n/ipad_anon_strings.json; heroes: anon_hero_strings.json.
//
// Headlines and lines below are balanced, and shrink until they fit their
// lines (German and Polish run long), so nothing is clipped. Then every PNG is
// flattened to RGB (the App Store refuses alpha) with Pillow.
//
//   node store-assets/build-ipad-localized.mjs [bear|anon] [lang ...]   (default: both, en + all ten)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { playwright } from '../../Docs_UNI_SIM/store-kit/preview.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const W = 2048, H = 2732
const ALL = ['en', 'es', 'fr', 'de', 'it', 'pt', 'pt-BR', 'nl', 'pl', 'sv', 'zh']
const args = process.argv.slice(2)
const apps = args.filter((a) => a === 'bear' || a === 'anon')
const langs = args.filter((a) => !apps.includes(a))
const APPS = apps.length ? apps : ['bear', 'anon']
const LANGS = langs.length ? langs : ALL
const json = (f) => JSON.parse(readFileSync(path.join(here, 'screens-i18n', f), 'utf8'))
const url = (f) => pathToFileURL(f).href
// One line where the iPhone layout broke it; no space between Chinese characters.
const noBr = (s) => s.replace(/(.)\s*<br>\s*/gu, (_, c) => c + (/[\u3000-\u9fff\uff00-\uffef]/u.test(c) ? '' : ' '))

// Shrink [data-fit] text until no word overflows its box and it takes at most
// data-lines lines. Runs in the page.
function fitText() {
  for (const el of document.querySelectorAll('[data-fit]')) {
    const max = Number(el.dataset.lines || 2)
    let size = parseFloat(getComputedStyle(el).fontSize)
    const lines = () => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))
    for (let i = 0; i < 40 && (el.scrollWidth > el.clientWidth + 1 || lines() > max); i++) {
      size *= 0.97
      el.style.fontSize = size + 'px'
    }
  }
}

// ── Framed feature screen (build-ipad.mjs's layout) ─────────────────────────
// Grounds: Bear's orange; Anonymous's yellow, dark (the iPhone set's "Ask
// anything") and cream (its wiki). `.hl` is a highlighted headline line.
const GROUNDS = {
  orange: { bg: `radial-gradient(120% 70% at 50% -8%, #ffc266 0%, rgba(255,194,102,0) 55%),
      linear-gradient(160deg, #ffaa33 0%, #ff8833 44%, #ff6b00 100%)`, glow: 'rgba(255,255,255,.45)', ring: 'rgba(255,255,255,.10)',
    head: '#fff', shadow: '0 6px 28px rgba(140,55,0,.30)', hl: '#fff', sub: '#fff8ef', screen: '#f4a63f', drop: 'rgba(40,16,0,.55)' },
  yellow: { bg: `radial-gradient(120% 80% at 50% -10%, #ffe680 0%, rgba(255,230,128,0) 55%),
      linear-gradient(160deg, #ffd84d 0%, #f5c800 50%, #e0b400 100%)`, glow: 'rgba(255,255,255,.40)', ring: 'rgba(255,255,255,.14)',
    head: '#3d2c00', shadow: 'none', hl: '#7a5a00', sub: '#5c4500', screen: '#FFFBF5', drop: 'rgba(60,40,0,.5)' },
  dark: { bg: `radial-gradient(110% 70% at 50% -10%, #3a3220 0%, rgba(58,50,32,0) 60%), linear-gradient(170deg, #1d1b18 0%, #121110 100%)`,
    glow: 'rgba(255,216,77,.10)', ring: 'rgba(255,255,255,.05)',
    head: '#fff', shadow: 'none', hl: '#ffd84d', sub: '#e9e2cf', screen: '#121212', drop: 'rgba(0,0,0,.7)' },
  cream: { bg: `radial-gradient(120% 80% at 50% -10%, #fff6d6 0%, rgba(255,246,214,0) 60%), linear-gradient(170deg, #fffaf0 0%, #fff1cc 100%)`,
    glow: 'rgba(255,216,77,.22)', ring: 'rgba(224,180,0,.10)',
    head: '#26201a', shadow: 'none', hl: '#f0a500', sub: '#6b5a33', screen: '#FFFBF5', drop: 'rgba(80,60,0,.35)' },
}
const feature = (img, head, sub, ground = 'orange') => { const g = GROUNDS[ground]; return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="../fonts.css">
<style>
  *{ box-sizing:border-box; margin:0; padding:0; }
  html,body{ width:100%; height:100%; }
  body{ font-family:'Nunito','Segoe UI',system-ui,sans-serif; -webkit-font-smoothing:antialiased; text-rendering:geometricPrecision; }
  .canvas{ position:relative; width:${W}px; height:${H}px; overflow:hidden; background:${g.bg}; }
  .bg{ position:absolute; inset:0; }
  .glow{ position:absolute; left:50%; top:1280px; width:1700px; height:1700px; transform:translate(-50%,-50%);
    background:radial-gradient(circle, ${g.glow} 0%, rgba(255,255,255,0) 70%); }
  .ring{ position:absolute; left:50%; top:1280px; transform:translate(-50%,-50%); border:3px solid ${g.ring}; border-radius:50%; }
  .headline{ position:absolute; left:130px; right:130px; top:118px; text-align:center;
    font-weight:900; font-size:128px; line-height:1.04; letter-spacing:-.015em; color:${g.head};
    text-shadow:${g.shadow}; white-space:pre-line; text-wrap:balance; }
  .headline .hl{ color:${g.hl}; }
  .device{ position:absolute; left:50%; top:560px; transform:translateX(-50%);
    width:1352px; padding:34px; background:linear-gradient(160deg,#17171b,#0a0a0c); border-radius:66px;
    box-shadow: 0 2px 0 2px rgba(255,255,255,.06) inset, 0 70px 140px -34px ${g.drop}, 0 30px 60px -22px rgba(0,0,0,.45); }
  .device::before{ content:''; position:absolute; top:16px; left:50%; transform:translateX(-50%);
    width:13px; height:13px; border-radius:50%; background:#050506; box-shadow:0 0 0 4px rgba(255,255,255,.04); }
  .screen{ position:relative; width:100%; aspect-ratio:3/4; border-radius:34px; overflow:hidden; background:${g.screen}; }
  .screen img{ width:100%; height:100%; object-fit:cover; display:block; }
  .sub{ position:absolute; left:200px; right:200px; bottom:150px; text-align:center;
    font-weight:700; font-size:50px; line-height:1.34; color:${g.sub}; text-wrap:balance; }
</style></head>
<body><div class="canvas">
  <div class="bg"><div class="glow"></div>
    <div class="ring" style="width:1180px;height:1180px;"></div>
    <div class="ring" style="width:1640px;height:1640px;"></div>
    <div class="ring" style="width:2080px;height:2080px;"></div></div>
  <div class="headline" data-fit data-lines="2">${head}</div>
  <div class="device"><div class="screen"><img src="${img}" alt=""></div></div>
  <div class="sub" data-fit data-lines="2">${sub}</div>
</div></body></html>` }

// ── Shared hero shell (build-ipad-hero.mjs / build-anon-ipad-hero.mjs) ───────
const ipad = (img, w, extra) => `<div class="ipad" style="width:${w}px;${extra}"><div class="scr"><img src="${img}" alt=""></div></div>`
const IPAD_W = 1420, IPAD_TOP = 470, IPAD_ROT = 3, SEAM_SHOW = 500
const H1_LEFT = W - SEAM_SHOW, H2_LEFT = H1_LEFT - W
const heroShell = (inner, bg, tone, theme) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="../fonts.css">
<style>
  *{ box-sizing:border-box; margin:0; padding:0; }
  html,body{ width:100%; height:100%; }
  .canvas{ position:relative; width:${W}px; height:${H}px; overflow:hidden;
    font-family:'Nunito','Segoe UI',system-ui,sans-serif; -webkit-font-smoothing:antialiased; text-rendering:geometricPrecision; }
  .bg-white{ background:#ffffff; }
  .head{ position:absolute; font-weight:900; letter-spacing:-.015em; line-height:1.04; text-wrap:balance; }
  .sub{ position:absolute; font-weight:800; letter-spacing:.005em; line-height:1.34; text-wrap:balance; }
  .floor{ position:absolute; border-radius:50%; }
  .disc{ position:absolute; border-radius:50%; }
  .on-light .head{ color:#26201a; }
  .on-light .sub{ color:#8a7d6b; }
  .ipad{ position:absolute; padding:34px; border-radius:66px; background:linear-gradient(160deg,#17171b,#0a0a0c); }
  .ipad::before{ content:''; position:absolute; top:17px; left:50%; transform:translateX(-50%);
    width:14px; height:14px; border-radius:50%; background:#050506; box-shadow:0 0 0 4px rgba(255,255,255,.05); z-index:6; }
  .ipad .scr{ position:relative; width:100%; aspect-ratio:3/4; border-radius:34px; overflow:hidden; }
  .ipad .scr img{ width:100%; height:100%; object-fit:cover; display:block; }
  ${theme}
</style></head>
<body><div class="canvas ${bg} ${tone}">${inner}</div></body></html>`

const BEAR_THEME = `
  .bg-orange{ background: radial-gradient(120% 80% at 50% -10%, #ffc266 0%, rgba(255,194,102,0) 55%),
    linear-gradient(160deg, #ffaa33 0%, #ff8833 42%, #ff6b00 100%); }
  .disc{ background:radial-gradient(closest-side, #fff0db 0%, rgba(255,240,219,0) 72%); }
  .on-light .floor{ background:radial-gradient(closest-side, rgba(120,70,20,.14), rgba(120,70,20,0)); }
  .on-orange .floor{ background:radial-gradient(closest-side, rgba(80,35,0,.28), rgba(80,35,0,0)); }
  .on-orange .head{ color:#ffffff; text-shadow:0 6px 28px rgba(140,55,0,.28); }
  .on-orange .sub{ color:#fff6ea; }
  .ipad{ box-shadow: 0 2px 0 2px rgba(255,255,255,.06) inset, 0 80px 150px -36px rgba(40,16,0,.5), 0 34px 64px -24px rgba(0,0,0,.42); }
  .ipad .scr{ background:#f4a63f; }
  .face{ position:absolute; }
  .face img{ width:100%; display:block; filter:drop-shadow(0 28px 38px rgba(110,45,0,.32)); }`

const ANON_THEME = `
  .bg-yellow{ background: radial-gradient(120% 80% at 50% -10%, #ffe680 0%, rgba(255,230,128,0) 55%),
    linear-gradient(160deg, #ffd84d 0%, #f5c800 50%, #e0b400 100%); }
  .disc{ background:radial-gradient(closest-side, #fff6d6 0%, rgba(255,246,214,0) 72%); }
  .on-light .floor{ background:radial-gradient(closest-side, rgba(120,90,20,.14), rgba(120,90,20,0)); }
  .on-yellow .floor{ background:radial-gradient(closest-side, rgba(90,60,0,.26), rgba(90,60,0,0)); }
  .on-yellow .head{ color:#3d2c00; }
  .head .hl{ color:#e0a800; }
  .on-yellow .head .hl{ color:#7a5a00; }
  .on-yellow .sub{ color:#5c4500; }
  .ipad{ box-shadow: 0 2px 0 2px rgba(255,255,255,.06) inset, 0 80px 150px -36px rgba(60,40,0,.5), 0 34px 64px -24px rgba(0,0,0,.42); }
  .ipad .scr{ background:#FFFBF5; }
  .cav{ position:absolute; }
  .disc2{ width:100%; height:100%; border-radius:50%; display:flex; align-items:center; justify-content:center;
    color:#fff; font-weight:800; font-family:'Segoe UI',system-ui,sans-serif; border:10px solid rgba(255,255,255,.9);
    box-shadow:0 28px 40px -14px rgba(90,60,0,.45); }`

const face = (f) => url(path.resolve(here, '../images/moods/' + f))
const bearHero1 = (s, shot) => heroShell(`
  <div class="disc" style="left:-140px; top:500px; width:1760px; height:1760px;"></div>
  <div class="head" data-fit data-lines="2" style="top:180px; left:120px; right:760px; text-align:left; font-size:150px;">${s.head1}</div>
  <div class="floor" style="left:170px; top:2040px; width:1040px; height:210px;"></div>
  ${ipad(shot('02-journal-mood.png'), IPAD_W, `left:${H1_LEFT}px; top:${IPAD_TOP}px; transform:rotate(${IPAD_ROT}deg); z-index:1;`)}
  ${ipad(shot('01-home.png'), 1160, 'left:100px; top:580px; transform:rotate(-3deg); z-index:2;')}
  <div class="sub" data-fit data-lines="3" style="bottom:160px; left:120px; right:720px; text-align:left; font-size:54px;">${noBr(s.sub1)}</div>
`, 'bg-white', 'on-light', BEAR_THEME)

const bearHero2 = (s, shot) => heroShell(`
  <div class="head" data-fit data-lines="2" style="top:150px; left:80px; right:80px; text-align:center; font-size:138px;">${noBr(s.head2)}</div>
  <div class="floor" style="left:-260px; top:2270px; width:980px; height:200px;"></div>
  <div class="face" style="left:1652px; top:492px;  width:356px; transform:rotate(-7deg);"><img src="${face('manic.png')}" alt=""></div>
  <div class="face" style="left:1461px; top:821px;  width:338px; transform:rotate(6deg);"><img src="${face('elevated.png')}" alt=""></div>
  <div class="face" style="left:1260px; top:1160px; width:320px; transform:rotate(-4deg);"><img src="${face('stable.png')}" alt=""></div>
  <div class="face" style="left:1047px; top:1497px; width:305px; transform:rotate(5deg);"><img src="${face('low.png')}" alt=""></div>
  <div class="face" style="left:835px;  top:1835px; width:290px; transform:rotate(-7deg);"><img src="${face('depressed.png')}" alt=""></div>
  ${ipad(shot('02-journal-mood.png'), IPAD_W, `left:${H2_LEFT}px; top:${IPAD_TOP}px; transform:rotate(${IPAD_ROT}deg); z-index:2;`)}
  <div class="sub" data-fit data-lines="2" style="bottom:170px; left:140px; right:140px; text-align:center; font-size:54px;">${noBr(s.sub2)}</div>
`, 'bg-orange', 'on-orange', BEAR_THEME)

const av = (txt, grad, size, pos) => `<div class="cav" style="${pos} width:${size}px; height:${size}px;"><div class="disc2" style="background:${grad}; font-size:${Math.round(size * 0.42)}px;">${txt}</div></div>`
const anonHero1 = (s, shot) => heroShell(`
  <div class="disc" style="left:-140px; top:500px; width:1760px; height:1760px;"></div>
  <div class="head" data-fit data-lines="2" style="top:180px; left:120px; right:760px; text-align:left; font-size:150px;">${s.head1}</div>
  <div class="floor" style="left:170px; top:2040px; width:1040px; height:210px;"></div>
  ${ipad(shot('thread.png'), IPAD_W, `left:${H1_LEFT}px; top:${IPAD_TOP}px; transform:rotate(${IPAD_ROT}deg); z-index:1;`)}
  ${ipad(shot('feed.png'), 1160, 'left:100px; top:580px; transform:rotate(-3deg); z-index:2;')}
  <div class="sub" data-fit data-lines="3" style="bottom:160px; left:120px; right:720px; text-align:left; font-size:54px;">${noBr(s.sub1)}</div>
`, 'bg-white', 'on-light', ANON_THEME)

const anonHero2 = (s, shot) => heroShell(`
  <div class="head" data-fit data-lines="2" style="top:150px; left:80px; right:80px; text-align:center; font-size:138px;">${noBr(s.head2)}</div>
  <div class="floor" style="left:-260px; top:2270px; width:980px; height:200px;"></div>
  ${av('QO', 'linear-gradient(135deg,#ffb340,#e07800)', 346, 'left:1652px; top:492px;  transform:rotate(-7deg);')}
  ${av('SS', 'linear-gradient(135deg,#81c784,#2e7d32)', 328, 'left:1471px; top:821px;  transform:rotate(6deg);')}
  ${av('BB', 'linear-gradient(135deg,#64b5f6,#1565c0)', 310, 'left:1270px; top:1160px; transform:rotate(-4deg);')}
  ${av('JR', 'linear-gradient(135deg,#f48fb1,#c2185b)', 295, 'left:1057px; top:1497px; transform:rotate(5deg);')}
  ${av('NW', 'linear-gradient(135deg,#ce93d8,#7b1fa2)', 280, 'left:845px;  top:1835px; transform:rotate(-7deg);')}
  ${ipad(shot('thread.png'), IPAD_W, `left:${H2_LEFT}px; top:${IPAD_TOP}px; transform:rotate(${IPAD_ROT}deg); z-index:2;`)}
  <div class="sub" data-fit data-lines="2" style="bottom:170px; left:140px; right:140px; text-align:center; font-size:54px;">${noBr(s.sub2)}</div>
`, 'bg-yellow', 'on-yellow', ANON_THEME)

// [capture, ground] for each Anonymous feature screen.
const ANON_FEATURES = {
  '02-monika': ['monika.png', 'yellow'],
  '03-ask': ['thread-dark.png', 'dark'],
  '04-wiki': ['wiki.png', 'cream'],
  '05-report': ['report.png', 'yellow'],
}
const BEAR_FEATURES = {
  '02-journal': '02-journal-mood.png',
  '03-survivalkit': '03-survival-kit.png',
  '04-tools': '04-survival-tools.png',
  '05-pin': '05-pin.png',
  '06-details': '06-details.png',
}

const { chromium } = await playwright()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
// The HTML sits beside the templates (for ../fonts.css, shared.css and REPO/ paths), then goes.
async function shoot(html, out, { w = W, h = H } = {}) {
  const built = path.join(here, 'screens', `_ipadl_${process.pid}.built.html`)
  writeFileSync(built, html)
  try {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(url(built), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(fitText)
    await page.waitForTimeout(150)
    await page.screenshot({ path: out })
  } finally { rmSync(built, { force: true }) }
  flat.push(out)
}
// Opaque RGB, as the App Store wants: Pillow (macOS's /usr/bin/python3 has it).
const flat = []
function flatten() {
  if (!flat.length) return
  execFileSync('/usr/bin/python3', ['-c', 'import sys\nfrom PIL import Image\nfor f in sys.argv[1:]:\n  im = Image.open(f)\n  if im.mode != "RGB": im.convert("RGB").save(f)', ...flat.splice(0)])
}

try {
  for (const app of APPS) {
    for (const lang of LANGS) {
      if (app === 'bear') {
        const raw = path.join(here, 'out/localized-ipad-raw', lang)
        if (!existsSync(path.join(raw, '01-home.png'))) throw new Error(`no captures for ${lang}: run capture-ipad-localized.mjs ${lang}`)
        const out = path.join(here, 'out/localized-ipad', lang)
        mkdirSync(out, { recursive: true })
        const shot = (f) => url(path.join(raw, f))
        const hero = json('hero_strings.json')[lang]
        await shoot(bearHero1(hero, shot), path.join(out, '01-hero.png'))
        await shoot(bearHero2(hero, shot), path.join(out, '02-hero.png'))
        const cap = json('ipad_strings.json')[lang]
        for (const [name, img] of Object.entries(BEAR_FEATURES)) {
          const [head, sub] = cap[name]
          await shoot(feature(shot(img), head, sub), path.join(out, `${name}.png`))
        }
        flatten(); console.log(`bear ${lang}: 7`)
      } else {
        const raw = path.join(here, 'out/localized-ipad-anon-raw', lang)
        if (!existsSync(path.join(raw, 'feed.png'))) throw new Error(`no captures for ${lang}: run capture-ipad-localized.mjs anon ${lang}`)
        const out = path.join(here, 'out/localized-ipad-anon', lang)
        mkdirSync(out, { recursive: true })
        const shot = (f) => url(path.join(raw, f))
        const hero = json('anon_hero_strings.json')[lang]
        await shoot(anonHero1(hero, shot), path.join(out, '01-hero.png'))
        await shoot(anonHero2(hero, shot), path.join(out, '02-hero.png'))
        const cap = json('ipad_anon_strings.json')[lang]
        for (const [name, [img, ground]] of Object.entries(ANON_FEATURES)) {
          const [head, sub] = cap[name]
          await shoot(feature(shot(img), head, sub, ground), path.join(out, `${name}.png`))
        }
        flatten()
        console.log(`anon ${lang}: 6`)
      }
    }
  }
} finally {
  await browser.close()
}
