#!/usr/bin/env node
// The App Store iPhone sets (6.9", 1290 × 2796, opaque PNG) for Bipolar Bear
// and Bipolar Anonymous, in English (en-GB) and every store language, from the
// real captures capture-appstore-iphone.mjs takes of today's app in that
// language. Every phone holds a capture (App Review 2.3.3), never a UI
// rebuilt in HTML.
//
// Step 1 composes each capture into the whole screen of an iPhone 17 Pro Max
// (1320 × 2868): the status bar (9:41, full signal and battery, the store
// kit's own glyphs) and the home indicator over the capture's own top and
// bottom colours, dark glyphs on a light ground and white on a dark one.
//   → out/appstore/screen/<app>/<lang>/<name>.png   (also used by build-creative.mjs)
// Step 2 frames them in the Bipolar Bear format (Docs_UNI_SIM/store-listings §2):
// the two-part hero, then feature screens with a headline, one phone, a line,
// chips and a footnote. Headlines and lines shrink until they fit, so long
// German and Polish never clip.
//   → out/appstore/iphone/<app>/<lang>/01-hero.png … 08-*.png
//
// Bipolar Bear      01-hero 02-hero (home + the mood wheel across the seam)
//                   03-patterns 04-health 05-survivalkit 06-safetyplan 07-pin 08-anonymous
// Bipolar Anonymous 01-hero 02-hero (the board + today's topic across the seam)
//                   03-moniker 04-ask 05-wiki 06-report 07-checkin 08-help
// Captions: screens-i18n/appstore_iphone_strings.json; heroes hero_strings.json
// and anon_hero_strings.json.
//
//   node store-assets/build-appstore-iphone.mjs [bear|anon] [lang ...]
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { playwright } from '../../Docs_UNI_SIM/store-kit/preview.mjs'
import { statusBar } from '../../Docs_UNI_SIM/store-kit/layouts.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const W = 1290, H = 2796
const SCREEN = [1320, 2868], SB = 186, HB = 102
const ALL = ['en', 'es', 'fr', 'de', 'it', 'pt', 'pt-BR', 'nl', 'pl', 'sv', 'zh']
const args = process.argv.slice(2)
const apps = args.filter((a) => a === 'bear' || a === 'anon')
const langs = args.filter((a) => !apps.includes(a))
const APPS = apps.length ? apps : ['bear', 'anon']
const LANGS = langs.length ? langs : ALL
const json = (f) => JSON.parse(readFileSync(path.join(here, 'screens-i18n', f), 'utf8'))
const STR = json('appstore_iphone_strings.json'), BEAR_HERO = json('hero_strings.json'), ANON_HERO = json('anon_hero_strings.json')
const url = (f) => pathToFileURL(f).href
const KIT_CSS = readFileSync(path.resolve(here, '../../Docs_UNI_SIM/store-kit/kit.css'), 'utf8')
// Just the status bar and home indicator rules from the kit's stylesheet.
const BAR_CSS = KIT_CSS.slice(KIT_CSS.indexOf('/* Status bar'), KIT_CSS.indexOf('/* Hardware cut-outs'))
const zh = (lang) => (lang === 'zh' ? ", 'PingFang SC', 'Hiragino Sans GB'" : '')

// ── Step 1: the whole iPhone screen ─────────────────────────────────────────
function composeHtml(dataUrl) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{ margin:0; padding:0; box-sizing:border-box; }
  html,body{ width:${SCREEN[0]}px; height:${SCREEN[1]}px; overflow:hidden; background:#fff; }
  .scr{ position:relative; width:${SCREEN[0]}px; height:${SCREEN[1]}px; container-type:inline-size; overflow:hidden; }
  .scr img{ position:absolute; left:0; top:${SB}px; width:${SCREEN[0]}px; height:${SCREEN[1] - SB - HB}px; display:block; }
  ${BAR_CSS}
  .sb{ --t:${SB}px; } .hb{ --b:${HB}px; }
</style></head><body><div class="scr">
  <img id="cap" src="${dataUrl}" alt="">
  ${statusBar('iphone')}
  <div class="hb"><i></i></div>
</div><script>
  window.ready = (async () => {
    const img = document.getElementById('cap'); await img.decode(); await document.fonts.ready
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    // The average colour of a band of the capture's rows.
    const avg = (y, h) => { const d = g.getImageData(0, y, c.width, h).data; let r = 0, gg = 0, b = 0, n = d.length / 4
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2] } return [r / n, gg / n, b / n] }
    const paint = (el, [r, gg, b]) => {
      el.style.background = 'rgb(' + [r, gg, b].map(Math.round).join(',') + ')'
      const ink = 0.299 * r + 0.587 * gg + 0.114 * b > 150 ? '#000' : '#fff'
      el.style.color = ink; el.style.setProperty('--hb-fg', ink)
    }
    paint(document.querySelector('.sb'), avg(3, 6))
    paint(document.querySelector('.hb'), avg(c.height - 9, 6))
  })()
</script></body></html>`
}

// ── Step 2: the frames ──────────────────────────────────────────────────────
const GROUNDS = {
  orange: { bg: `radial-gradient(120% 80% at 50% -10%, #ffc266 0%, rgba(255,194,102,0) 55%), linear-gradient(160deg, #ffaa33 0%, #ff8833 42%, #ff6b00 100%)`,
    head: '#fff', hl: '#fff', shadow: '0 6px 28px rgba(140,55,0,.30)', label: '#fff', foot: '#fff', chip: '#fff', chipInk: '#2d2d2d', chipLine: 'transparent', drop: 'rgba(40,16,0,.55)', glow: 'rgba(255,255,255,.35)' },
  white: { bg: '#ffffff', head: '#1f2430', hl: '#ff7a00', shadow: 'none', label: '#1f2430', foot: '#8a6d00',
    chip: '#fff6ec', chipInk: '#7a3d00', chipLine: '#ffe0b2', drop: 'rgba(120,70,20,.40)', glow: 'rgba(255,170,60,.16)' },
  dark: { bg: `radial-gradient(90% 50% at 50% 78%, #3a2640 0%, rgba(58,38,64,0) 60%), linear-gradient(180deg, #15121d 0%, #1c1726 55%, #241a2c 100%)`,
    head: '#fff', hl: '#ffd84d', shadow: 'none', label: '#fff', foot: '#cdbfe0', chip: 'rgba(255,255,255,.10)', chipInk: '#fff', chipLine: 'rgba(255,255,255,.18)', drop: 'rgba(0,0,0,.7)', glow: 'rgba(255,149,0,.10)' },
  night: { bg: `radial-gradient(110% 70% at 50% -10%, #3a3220 0%, rgba(58,50,32,0) 60%), linear-gradient(170deg, #1d1b18 0%, #121110 100%)`,
    head: '#fff', hl: '#ffd84d', shadow: 'none', label: '#fff', foot: '#e9e2cf', chip: 'rgba(255,216,77,.12)', chipInk: '#ffe9a8', chipLine: 'rgba(255,216,77,.28)', drop: 'rgba(0,0,0,.7)', glow: 'rgba(255,216,77,.08)' },
  yellow: { bg: `radial-gradient(120% 80% at 50% -10%, #ffe680 0%, rgba(255,230,128,0) 55%), linear-gradient(160deg, #ffd84d 0%, #f5c800 50%, #e0b400 100%)`,
    head: '#3d2c00', hl: '#7a5a00', shadow: 'none', label: '#3d2c00', foot: '#5c4500', chip: '#fff', chipInk: '#3d2c00', chipLine: 'transparent', drop: 'rgba(60,40,0,.5)', glow: 'rgba(255,255,255,.35)' },
  cream: { bg: `radial-gradient(120% 80% at 50% -10%, #fff6d6 0%, rgba(255,246,214,0) 60%), linear-gradient(170deg, #fffaf0 0%, #fff1cc 100%)`,
    head: '#26201a', hl: '#f0a500', shadow: 'none', label: '#26201a', foot: '#6b5a33', chip: '#fff', chipInk: '#3d2c00', chipLine: '#f3e2a8', drop: 'rgba(80,60,0,.35)', glow: 'rgba(255,216,77,.20)' },
}

const BASE_CSS = (lang) => `
  *{ box-sizing:border-box; margin:0; padding:0; }
  html,body{ width:${W}px; height:${H}px; overflow:hidden; }
  .canvas{ position:relative; width:${W}px; height:${H}px; overflow:hidden;
    font-family:'Nunito'${zh(lang)},'Segoe UI',system-ui,sans-serif; -webkit-font-smoothing:antialiased; text-rendering:geometricPrecision; }
  .phone{ position:absolute; padding:18px; border-radius:74px; background:#0b0b0d; }
  .phone .scr{ position:relative; width:100%; border-radius:58px; overflow:hidden; line-height:0; background:#fff; }
  .phone .scr img{ width:100%; display:block; }
`
// The Dynamic Island sits in the screen's own top bar (kit.css: 2.5cqw down,
// 28.64cqw × 8.41cqw), so it is drawn inside .scr, in screen units.
const phone = (img, w, style) => `<div class="phone" style="width:${w}px;${style}">
  <div class="scr" style="container-type:inline-size"><img src="${img}" alt="">
    <div style="position:absolute;left:50%;transform:translateX(-50%);top:2.5cqw;width:28.64cqw;height:8.41cqw;border-radius:999px;background:#08080a;z-index:5"></div></div></div>`

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
  // A chip row that runs past three lines shrinks its chips.
  for (const row of document.querySelectorAll('.chips')) {
    let f = 1
    while (row.getBoundingClientRect().height > Number(row.dataset.max || 9999) && f > 0.7) {
      f -= 0.04
      row.style.setProperty('--cf', f)
    }
  }
}

const DEV_W = 760, DEV_TOP = 500
const devH = (w) => 36 + (w - 36) * SCREEN[1] / SCREEN[0]
function feature(lang, img, s, ground, extra = '') {
  const g = GROUNDS[ground]
  const bottom = DEV_TOP + devH(DEV_W)
  const chips = s.chips ? `<div class="chips" data-max="300">${s.chips.map(([e, t]) => `<span class="chip"><span class="e">${e}</span>${t}</span>`).join('')}</div>` : ''
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><link rel="stylesheet" href="../fonts.css"><style>
  ${BASE_CSS(lang)}
  .canvas{ background:${g.bg}; }
  .glow{ position:absolute; left:50%; top:${DEV_TOP + 700}px; width:1500px; height:1500px; transform:translate(-50%,-50%);
    border-radius:50%; background:radial-gradient(closest-side, ${g.glow}, rgba(255,255,255,0)); }
  .head{ position:absolute; left:80px; right:80px; top:0; height:${DEV_TOP}px; display:flex; align-items:center; justify-content:center; }
  .head div{ width:100%; text-align:center; font-weight:900; font-size:104px; line-height:1.06; letter-spacing:-.015em;
    color:${g.head}; text-shadow:${g.shadow}; text-wrap:balance; }
  .head .hl{ color:${g.hl}; }
  .phone{ left:50%; top:${DEV_TOP}px; transform:translateX(-50%);
    box-shadow:0 2px 0 2px rgba(255,255,255,.08) inset, 0 60px 120px -30px ${g.drop}, 0 24px 50px -20px rgba(0,0,0,.45); }
  .deck{ position:absolute; left:70px; right:70px; top:${bottom + 70}px; text-align:center; }
  .label{ font-weight:800; font-size:40px; line-height:1.25; color:${g.label}; margin-bottom:34px; text-wrap:balance; }
  .chips{ --cf:1; display:flex; flex-wrap:wrap; justify-content:center; gap:calc(20px * var(--cf)); }
  .chip{ display:inline-flex; align-items:center; gap:12px; background:${g.chip}; color:${g.chipInk}; border:2px solid ${g.chipLine};
    border-radius:999px; padding:calc(18px * var(--cf)) calc(30px * var(--cf)); font-weight:800; font-size:calc(31px * var(--cf)); white-space:nowrap;
    box-shadow:0 16px 34px -16px rgba(80,40,0,.45); }
  .chip .e{ font-size:1.15em; line-height:1; }
  .foot{ position:absolute; left:90px; right:90px; bottom:92px; text-align:center; font-weight:800; font-size:32px; color:${g.foot}; opacity:.95; }
  .avrow{ display:flex; justify-content:center; align-items:center; }
  .avrow .ava{ width:118px; height:118px; border-radius:50%; margin-left:-24px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
    color:#fff; font-weight:800; font-size:40px; font-family:'Segoe UI',system-ui,sans-serif; border:7px solid #FFFBF5; box-shadow:0 12px 24px -8px rgba(120,90,0,.45); }
  .avrow .ava:first-child{ margin-left:0; }
  .avrow .more{ background:#1a1500; font-size:32px; width:auto; padding:0 30px; border-radius:999px; }
</style></head><body><div class="canvas">
  <div class="glow"></div>
  <div class="head"><div data-fit data-lines="2">${s.head}</div></div>
  ${phone(img, DEV_W, 'z-index:2')}
  <div class="deck"><div class="label" data-fit data-lines="2">${s.label}</div>${chips}${extra}</div>
  ${s.foot ? `<div class="foot" data-fit data-lines="1">${s.foot}</div>` : ''}
</div></body></html>`
}

// The board's own members (preview.mjs boardDocs) for the avatar row.
const MEMBERS = [['SH', '#ce93d8', '#7b1fa2'], ['SW', '#ffb340', '#e07800'], ['HA', '#81c784', '#2e7d32'],
  ['WB', '#f48fb1', '#c2185b'], ['CF', '#4dd0e1', '#00838f'], ['LL', '#64b5f6', '#1565c0']]
const avatarRow = (you) => `<div class="avrow">${MEMBERS.map(([t, a, b]) => `<div class="ava" style="background:linear-gradient(135deg,${a},${b})">${t}</div>`).join('')}<div class="ava more">${you}</div></div>`

// ── Heroes (build-hero-localized.mjs's and build-anon-hero.mjs's geometry) ──
const MOOD_W = 740, MOOD_TOP = 712, MOOD_ROT = 6, SEAM_SHOW = 250
const H1_LEFT = W - SEAM_SHOW, H2_LEFT = H1_LEFT - W
const heroShell = (lang, inner, bg, tone, theme) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><link rel="stylesheet" href="../fonts.css"><style>
  ${BASE_CSS(lang)}
  .bg-white{ background:#ffffff; }
  .disc{ position:absolute; border-radius:50%; }
  .floor{ position:absolute; border-radius:50%; }
  .head{ position:absolute; font-weight:900; letter-spacing:-.015em; line-height:1.04; text-wrap:balance; }
  .sub{ position:absolute; font-weight:800; letter-spacing:.005em; line-height:1.34; text-wrap:balance; }
  .on-light .head{ color:#26201a; }
  .on-light .sub{ color:#8a7d6b; }
  .phone{ box-shadow: 0 2px 0 2px rgba(255,255,255,.08) inset, 0 60px 120px -30px rgba(40,16,0,.55), 0 24px 50px -20px rgba(0,0,0,.45); }
  .face{ position:absolute; }
  .face img{ width:100%; display:block; filter:drop-shadow(0 22px 30px rgba(110,45,0,.34)); }
  .cav{ position:absolute; }
  .disc2{ width:100%; height:100%; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:800;
    font-family:'Segoe UI',system-ui,sans-serif; border:8px solid rgba(255,255,255,.9); box-shadow:0 22px 34px -12px rgba(90,60,0,.45); }
  ${theme}
</style></head><body><div class="canvas ${bg} ${tone}">${inner}</div></body></html>`
const BEAR_THEME = `
  .bg-orange{ background: radial-gradient(120% 80% at 50% -10%, #ffc266 0%, rgba(255,194,102,0) 55%), linear-gradient(160deg, #ffaa33 0%, #ff8833 42%, #ff6b00 100%); }
  .disc{ background:radial-gradient(closest-side, #fff0db 0%, rgba(255,240,219,0) 72%); }
  .on-light .floor{ background:radial-gradient(closest-side, rgba(120,70,20,.16), rgba(120,70,20,0)); }
  .on-orange .floor{ background:radial-gradient(closest-side, rgba(80,35,0,.30), rgba(80,35,0,0)); }
  .on-orange .head{ color:#fff; } .on-orange .sub{ color:#fff6ea; }`
const ANON_THEME = `
  .bg-yellow{ background: radial-gradient(120% 80% at 50% -10%, #ffe680 0%, rgba(255,230,128,0) 55%), linear-gradient(160deg, #ffd84d 0%, #f5c800 50%, #e0b400 100%); }
  .disc{ background:radial-gradient(closest-side, #fff6d6 0%, rgba(255,246,214,0) 72%); }
  .on-light .floor{ background:radial-gradient(closest-side, rgba(120,90,20,.16), rgba(120,90,20,0)); }
  .on-yellow .floor{ background:radial-gradient(closest-side, rgba(90,60,0,.28), rgba(90,60,0,0)); }
  .head .hl{ color:#e0a800; } .on-yellow .head{ color:#3d2c00; } .on-yellow .head .hl{ color:#7a5a00; } .on-yellow .sub{ color:#5c4500; }
  .phone .scr{ background:#FFFBF5; }`

const face = (f) => url(path.resolve(here, '../images/moods/' + f))
const FACES = [['manic.png', 957, 617, 246, -8], ['elevated.png', 824, 879, 232, 6], ['stable.png', 690, 1145, 220, -4],
  ['low.png', 555, 1415, 210, 5], ['depressed.png', 400, 1680, 200, -7]]

function heroPair(lang, s, front, seam, theme, light, second, extra2) {
  const h1 = heroShell(lang, `
    <div class="disc" style="left:-200px; top:740px; width:1960px; height:1960px;"></div>
    <div class="head" data-fit data-lines="2" style="top:300px; left:96px; right:96px; text-align:left; font-size:${light === 'anon' ? 130 : 122}px;">${s.head1}</div>
    <div class="floor" style="left:120px; top:2330px; width:760px; height:150px;"></div>
    <div class="floor" style="left:${H1_LEFT - 60}px; top:2120px; width:560px; height:150px;"></div>
    ${phone(seam, MOOD_W, `left:${H1_LEFT}px; top:${MOOD_TOP}px; transform:rotate(${MOOD_ROT}deg); z-index:1;`)}
    ${phone(front, 700, 'left:150px; top:900px; transform:rotate(-7deg); z-index:2;')}
    <div class="sub" data-fit data-lines="2" style="bottom:156px; left:120px; right:120px; text-align:center; font-size:39px;">${s.sub1}</div>
  `, 'bg-white', 'on-light', theme)
  const h2 = heroShell(lang, `
    <div class="head" data-fit data-lines="2" style="top:300px; left:80px; right:80px; text-align:center; font-size:${light === 'anon' ? 120 : 112}px;">${s.head2}</div>
    <div class="sub" data-fit data-lines="2" style="bottom:150px; left:130px; right:130px; text-align:center; font-size:40px;">${s.sub2}</div>
    <div class="floor" style="left:${H2_LEFT + 30}px; top:2230px; width:760px; height:150px;"></div>
    ${extra2}
    ${phone(seam, MOOD_W, `left:${H2_LEFT}px; top:${MOOD_TOP}px; transform:rotate(${MOOD_ROT}deg); z-index:2;`)}
  `, second, second === 'bg-orange' ? 'on-orange' : 'on-yellow', theme)
  return [h1, h2]
}
const bearFaces = FACES.map(([f, x, y, w, r]) => `<div class="face" style="left:${x}px; top:${y}px; width:${w}px; transform:rotate(${r}deg);"><img src="${face(f)}" alt=""></div>`).join('\n')
const av = (txt, a, b, size, pos) => `<div class="cav" style="${pos} width:${size}px; height:${size}px;"><div class="disc2" style="background:linear-gradient(135deg,${a},${b}); font-size:${Math.round(size * 0.42)}px;">${txt}</div></div>`
const anonAvatars = [[236, 'left:957px; top:617px;  transform:rotate(-8deg);'], [222, 'left:838px; top:900px;  transform:rotate(6deg);'],
  [210, 'left:712px; top:1178px; transform:rotate(-4deg);'], [200, 'left:586px; top:1452px; transform:rotate(5deg);'],
  [190, 'left:452px; top:1724px; transform:rotate(-7deg);']].map(([size, pos], i) => av(MEMBERS[i][0], MEMBERS[i][1], MEMBERS[i][2], size, pos)).join('\n')

// [output name, capture, ground]
const BEAR = [['03-patterns', 'feedback', 'orange'], ['04-health', 'sleep', 'white'], ['05-survivalkit', 'kit', 'orange'],
  ['06-safetyplan', 'plan', 'white'], ['07-pin', 'pin', 'dark'], ['08-anonymous', '../../anon/LANG/feed', 'yellow']]
const ANON = [['03-moniker', 'moniker', 'yellow'], ['04-ask', 'ask', 'night'], ['05-wiki', 'wiki', 'cream'],
  ['06-report', 'report', 'yellow'], ['07-checkin', 'checkin', 'cream'], ['08-help', 'help', 'yellow']]

// ── Run ─────────────────────────────────────────────────────────────────────
const { chromium } = await playwright()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const flat = []
async function shoot(html, out, { w = W, h = H, fit = true } = {}) {
  const built = path.join(here, 'screens', `_asi_${process.pid}.built.html`)
  writeFileSync(built, html)
  try {
    await page.setViewportSize({ width: w, height: h })
    await page.goto(url(built), { waitUntil: 'load' })
    await page.evaluate(() => window.ready)
    await page.evaluate(() => document.fonts.ready)
    if (fit) await page.evaluate(fitText)
    await page.waitForTimeout(120)
    mkdirSync(path.dirname(out), { recursive: true })
    await page.screenshot({ path: out })
  } finally { rmSync(built, { force: true }) }
  flat.push(out)
}
function flatten() {
  if (!flat.length) return
  execFileSync('/usr/bin/python3', ['-c', 'import sys\nfrom PIL import Image\nfor f in sys.argv[1:]:\n  im = Image.open(f)\n  if im.mode != "RGB": im.convert("RGB").save(f)', ...flat.splice(0)])
}
async function compose(app, lang) {
  const raw = path.join(here, 'out/appstore/raw', app, lang)
  const out = path.join(here, 'out/appstore/screen', app, lang)
  if (!existsSync(raw)) throw new Error(`no captures in ${raw}: run capture-appstore-iphone.mjs ${app} ${lang}`)
  const names = readdirSync(raw).filter((f) => f.endsWith('.png'))
  for (const f of names) {
    const data = 'data:image/png;base64,' + readFileSync(path.join(raw, f)).toString('base64')
    await shoot(composeHtml(data), path.join(out, f), { w: SCREEN[0], h: SCREEN[1], fit: false })
  }
  flatten()
  return (n) => url(path.join(out, n + '.png'))
}

try {
  for (const app of APPS) {
    for (const lang of LANGS) {
      const out = path.join(here, 'out/appstore/iphone', app, lang)
      rmSync(out, { recursive: true, force: true })
      const shot = await compose(app, lang)
      const cap = STR[app][lang]
      if (app === 'bear') {
        if (!existsSync(path.join(here, 'out/appstore/raw/anon', lang, 'feed.png'))) throw new Error(`bear 08 needs anon ${lang}'s feed: capture anon first`)
        const anonShot = await compose('anon', lang)
        const [h1, h2] = heroPair(lang, BEAR_HERO[lang], shot('home'), shot('mood'), BEAR_THEME, 'bear', 'bg-orange', bearFaces)
        await shoot(h1, path.join(out, '01-hero.png')); await shoot(h2, path.join(out, '02-hero.png'))
        for (const [name, img, ground] of BEAR) {
          const src = img.startsWith('../') ? anonShot('feed') : shot(img)
          const extra = name === '08-anonymous' ? avatarRow(cap[name].you) : ''
          await shoot(feature(lang, src, cap[name], ground, extra), path.join(out, `${name}.png`))
        }
      } else {
        const [h1, h2] = heroPair(lang, ANON_HERO[lang], shot('feed'), shot('thread'), ANON_THEME, 'anon', 'bg-yellow', anonAvatars)
        await shoot(h1, path.join(out, '01-hero.png')); await shoot(h2, path.join(out, '02-hero.png'))
        for (const [name, img, ground] of ANON) await shoot(feature(lang, shot(img), cap[name], ground), path.join(out, `${name}.png`))
      }
      flatten()
      console.log(`${app} ${lang}: 8`)
    }
  }
} finally {
  await browser.close()
}
