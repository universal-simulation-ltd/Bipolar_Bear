#!/usr/bin/env node
// The Google Play graphics for BIPOLAR BEAR and BIPOLAR ANONYMOUS, every Play
// language: phone screenshots, 7" and 10" tablet screenshots and the feature
// graphic. Each screenshot frames a real capture of the app in that language
// (capture.mjs → out/raw/) on an Android phone or tablet, in the Bipolar Bear
// store format (store-listings README §2): a two-part hero (01 + 02, one phone
// running across the join), then feature screens with a heavy headline, one
// device, a caption and chips. Every word is in strings.json.
//
//   node store-assets/play/build.mjs                    both apps, every class and language
//   node store-assets/play/build.mjs anon phone fg de   some of them (fg = the feature graphic)
//   → store-assets/play/out/<app>/<lang>/{phone,tablet7,tablet10}/NN-<shot>.png, feature-graphic.png
//
// Sizes: phone and 10" 1440 × 2560 (9:16, the house size: Play promotes only
// 9:16 at 1080 px or more), 7" 2560 × 1440 (16:9, held landscape, the only way
// a 7" tablet gets the app's wide layout), feature graphic 1024 × 500.
// Opaque PNG throughout (Play refuses alpha).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const assets = path.resolve(here, '..')
const repo = path.resolve(assets, '..')
const R = (p) => pathToFileURL(path.join(repo, p)).href
const RAW = path.join(here, 'out/raw')
// The UNI·SIM mark, from the suite's store kit beside this repo.
const BRAND = path.resolve(repo, '../Docs_UNI_SIM/store-kit/brand')
const STR = JSON.parse(readFileSync(path.join(here, 'strings.json'), 'utf8'))
const BOARD = JSON.parse(readFileSync(path.join(assets, 'screens-i18n/ipad_anon_board.json'), 'utf8'))
const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'pt-BR', 'nl', 'pl', 'sv', 'zh']

// Canvas, and the capture each class frames: its CSS size and the Android
// status bar and gesture bar the frame draws above and below it (dp).
const CANVAS = { phone: [1440, 2560], tablet10: [1440, 2560], tablet7: [2560, 1440] }
const CAP = {
  phone: { w: 412, h: 868, sb: 28, nb: 20 },
  tablet7: { w: 960, h: 600, sb: 24, nb: 20 },
  tablet10: { w: 800, h: 1280, sb: 24, nb: 20 },
}

// Which capture each screen shows, in upload order.
const SETS = {
  bear: {
    phone: [['01-hero', 'hero-open', ['home', 'mood']], ['02-hero', 'hero-close', ['mood']], ['03-patterns', 'feature', ['feedback']],
      ['04-sleep', 'feature', ['sleep']], ['05-survivalkit', 'feature', ['kit']], ['06-safetyplan', 'feature', ['plan']],
      ['07-anonymous', 'feature', ['board']], ['08-privacy', 'privacy', ['pin']]],
    tablet: [['01-journal', 'feature', ['mood']], ['02-patterns', 'feature', ['feedback']], ['03-survivalkit', 'feature', ['kit']],
      ['04-coping', 'feature', ['coping']], ['05-safetyplan', 'feature', ['plan']], ['06-anonymous', 'feature', ['board']]],
  },
  anon: {
    phone: [['01-hero', 'hero-open', ['feed', 'checkin']], ['02-hero', 'hero-close', ['checkin']], ['03-moniker', 'feature', ['monika']],
      ['04-ask', 'feature', ['thread-dark']], ['05-wiki', 'feature', ['wiki']], ['06-report', 'feature', ['report']],
      ['07-topic', 'feature', ['thread']], ['08-dark', 'feature', ['feed-dark']]],
    tablet: [['01-board', 'feature', ['feed']], ['02-checkin', 'feature', ['checkin']], ['03-ask', 'feature', ['thread-dark']],
      ['04-wiki', 'feature', ['wiki']], ['05-moniker', 'feature', ['monika']], ['06-report', 'feature', ['report']]],
  },
}

// ── Look ───────────────────────────────────────────────────────────────────
const THEME = {
  bear: { icon: R('icons/favicons/android-chrome-512x512.png'), accent: '#ff7a00', ink: '#2a1a0b' },
  anon: { icon: R('icons/AppIcon_anonymous_1024_store.png'), accent: '#e2a400', ink: '#2b2100' },
}
const GROUND = {
  orange: 'radial-gradient(120% 80% at 50% -10%, #ffc266 0%, rgba(255,194,102,0) 55%), linear-gradient(160deg, #ffaa33 0%, #ff8833 42%, #ff6b00 100%)',
  yellow: 'radial-gradient(120% 80% at 50% -10%, #ffe680 0%, rgba(255,230,128,0) 55%), linear-gradient(160deg, #ffd84d 0%, #f5c800 50%, #e0b400 100%)',
  cream: 'radial-gradient(90% 60% at 50% 30%, #ffffff 0%, rgba(255,255,255,0) 70%), linear-gradient(180deg, #fffdf8 0%, #fff6e3 100%)',
  white: 'radial-gradient(90% 60% at 50% 30%, #ffffff 0%, rgba(255,255,255,0) 70%), linear-gradient(180deg, #ffffff 0%, #fff4e8 100%)',
  dark: 'radial-gradient(90% 50% at 50% 78%, #3a2640 0%, rgba(58,38,64,0) 60%), linear-gradient(180deg, #15121d 0%, #1c1726 55%, #241a2c 100%)',
}
// Text on each ground: [headline, caption/footnote, chip bg, chip ink, chip shadow]
const INK = {
  orange: ['#ffffff', '#fff8ef', '#ffffff', '#2d2d2d', 'rgba(120,50,0,.5)'],
  yellow: ['#3d2c00', '#5c4500', '#ffffff', '#2d2d2d', 'rgba(120,90,0,.45)'],
  cream: ['#2b2100', '#6b5a2a', '#ffffff', '#2d2d2d', 'rgba(120,90,0,.28)'],
  white: ['#2a1a0b', '#7a5a3a', '#ffffff', '#2d2d2d', 'rgba(120,50,0,.25)'],
  dark: ['#ffffff', '#cdbfe0', '#2b2436', '#f3eefc', 'rgba(0,0,0,.5)'],
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** "\n" breaks a line; *word* is the accent colour. */
const rich = (s) => esc(s).replace(/\*(.+?)\*/g, '<span class="acc">$1</span>').replace(/\n/g, '<br>')

const SIGNAL = '<svg viewBox="0 0 18 18"><path d="M17 1v16H1z"/></svg>'
const WIFI = '<svg viewBox="0 0 20 16"><path d="M10 15.5 0.4 4.6C3 2.4 6.3 1 10 1s7 1.4 9.6 3.6z"/></svg>'
const BATT = '<svg viewBox="0 0 11 18"><rect x="3" y="0" width="5" height="2" rx=".6"/><rect x="0" y="1.6" width="11" height="16.4" rx="1.8"/></svg>'

/** An Android device around a capture. w is the device's outer width (px). */
function device(app, lang, cls, shot, { w, left, top, rot = 0, z = 1, center = false, cssClass = '' }) {
  const c = CAP[cls], tablet = cls !== 'phone'
  const bez = tablet ? Math.round(w * 0.032) : Math.round(w * 0.024)
  const sw = w - 2 * bez, k = sw / c.w
  const sh = (c.h + c.sb + c.nb) * k
  const src = pathToFileURL(path.join(RAW, app, lang, cls, `${shot}.png`)).href
  const tf = `${center ? 'translateX(-50%) ' : ''}rotate(${rot}deg)`
  return `<div class="dev ${tablet ? 'tab' : 'pho'} ${cssClass}" style="width:${w}px;height:${sh + 2 * bez}px;padding:${bez}px;left:${center ? '50%' : left + 'px'};top:${top}px;transform:${tf};z-index:${z};border-radius:${tablet ? w * 0.045 : w * 0.095}px">
    ${tablet ? `<i class="cam" style="width:${bez * 0.32}px;height:${bez * 0.32}px;top:${bez * 0.34}px"></i>` : ''}
    <div class="scr" style="border-radius:${tablet ? w * 0.022 : w * 0.075}px;height:${sh}px">
      <div class="sb" style="height:${c.sb * k}px;font-size:${12.5 * k}px;padding:0 ${16 * k}px"><b>9:41</b>${tablet ? '' : `<i class="punch" style="width:${11 * k}px;height:${11 * k}px"></i>`}<span class="ic" style="gap:${5 * k}px;height:${12 * k}px">${WIFI}${SIGNAL}${BATT}</span></div>
      <img class="cap" src="${src}" style="height:${c.h * k}px" alt="">
      <div class="nb" style="height:${c.nb * k}px"><i style="width:${(tablet ? 120 : 108) * k}px;height:${4 * k}px"></i></div>
    </div>
  </div>`
}

function chips(list, hot, size, align = 'center') {
  if (!list || !list.length) return ''
  return `<div class="chips" style="--cs:${size}px;justify-content:${align}">${list.map((t, i) => `<span class="chip${i === hot ? ' hot' : ''}">${esc(t)}</span>`).join('')}</div>`
}

const css = (app, ground) => {
  const [head, sub, chipBg, chipInk, chipSh] = INK[ground]
  return `
  @import url('${pathToFileURL(path.join(assets, 'fonts.css')).href}');
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100%;height:100%;background:#fff}
  body{font-family:'Nunito','PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .canvas{position:relative;width:100vw;height:100vh;overflow:hidden;background:${GROUND[ground]};color:${head}}
  .head,.sub,.foot{text-wrap:balance}
  .head{position:absolute;font-weight:900;line-height:1.05;letter-spacing:-.015em;text-align:center;color:${head}}
  .head .acc{color:${ground === 'orange' ? '#3a1600' : ground === 'yellow' ? '#ffffff' : THEME[app].accent}${ground === 'yellow' ? ';text-shadow:0 4px 22px rgba(120,80,0,.45)' : ''}}
  .sub{position:absolute;font-weight:800;line-height:1.3;color:${sub};text-align:center}
  .foot{position:absolute;font-weight:800;line-height:1.3;color:${sub};opacity:.92;text-align:center}
  .chips{display:flex;flex-wrap:wrap;justify-content:center;gap:calc(var(--cs)*.5)}
  .chip{display:inline-flex;align-items:center;background:${chipBg};color:${chipInk};border-radius:999px;
    padding:calc(var(--cs)*.5) calc(var(--cs)*.85);font-weight:800;font-size:var(--cs);line-height:1.15;white-space:nowrap;
    box-shadow:0 calc(var(--cs)*.4) calc(var(--cs)*.9) calc(var(--cs)*-.35) ${chipSh}}
  .chip.hot{background:${app === 'bear' ? '#fff0e0' : '#fff6cc'};color:${app === 'bear' ? '#c24e00' : '#7a5600'}}
  .dev{position:absolute;background:#101012;box-shadow:0 2px 0 2px rgba(255,255,255,.07) inset,0 60px 120px -30px rgba(40,16,0,.5),0 24px 50px -20px rgba(0,0,0,.45);transform-origin:center center}
  .dev .cam{position:absolute;left:50%;transform:translateX(-50%);border-radius:50%;background:#2a2a30}
  .scr{position:relative;overflow:hidden;background:#000;display:flex;flex-direction:column}
  .sb{position:relative;display:flex;align-items:center;justify-content:space-between;font-family:Roboto,'Segoe UI',system-ui,sans-serif;flex:0 0 auto;background:var(--sbg,#fff);color:var(--sfg,#111)}
  .sb b{font-weight:600}
  .sb .ic{display:flex;align-items:center}
  .sb svg{height:100%;fill:currentColor}
  .punch{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:50%;background:#050506}
  .cap{display:block;width:100%;flex:0 0 auto;object-fit:cover}
  .nb{flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:var(--nbg,#fff)}
  .nb i{display:block;border-radius:99px;background:var(--nfg,#111);opacity:.75}
  .mark{position:absolute;opacity:.95}
  .lock{position:absolute;display:flex;align-items:center}
  .lock img{border-radius:22%;box-shadow:0 14px 30px -12px rgba(120,60,0,.45)}
  .lock .nm{font-weight:900;letter-spacing:-.01em;color:${head}}
  .floor{position:absolute;border-radius:50%;background:radial-gradient(closest-side,rgba(110,60,0,.28),rgba(110,60,0,0))}
  .bearf{position:absolute;filter:drop-shadow(0 18px 22px rgba(140,55,0,.34))}
  .glow{position:absolute;border-radius:50%;background:radial-gradient(closest-side,rgba(255,255,255,.55),rgba(255,255,255,0))}
  `
}

const READY = `<script>
  // The status and gesture bars take the colour of the app's own top and
  // bottom rows, and dark or light glyphs to suit, as Android draws them.
  function avg(img, y0, y1) {
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = y1 - y0
    const g = c.getContext('2d'); g.drawImage(img, 0, -y0)
    const d = g.getImageData(0, 0, c.width, c.height).data; let r = 0, gg = 0, b = 0, n = 0
    for (let i = 0; i < d.length; i += 16) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++ }
    return [r / n, gg / n, b / n]
  }
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
  const rgb = (c) => 'rgb(' + c.map(Math.round).join(',') + ')'
  window.__ready = (async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r })))
    for (const img of document.querySelectorAll('img.cap')) {
      const h = img.naturalHeight, t = avg(img, 0, 3), b = avg(img, h - 3, h), s = img.closest('.scr')
      s.style.setProperty('--sbg', rgb(t)); s.style.setProperty('--sfg', lum(t) > 150 ? '#1b1b1f' : '#ffffff')
      s.style.setProperty('--nbg', rgb(b)); s.style.setProperty('--nfg', lum(b) > 150 ? '#1b1b1f' : '#ffffff')
    }
    // Shrink any text that would overflow its box, rather than clip it.
    for (const el of document.querySelectorAll('[data-fit]')) {
      const maxH = +el.dataset.fit
      let fs = parseFloat(getComputedStyle(el).fontSize)
      while ((el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > maxH) && fs > 20) { fs *= 0.96; el.style.fontSize = fs + 'px' }
    }
    return true
  })()
</script>`

// ── Layouts (phone canvas 1440 × 2560 unless noted) ───────────────────────
function page(app, ground, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(app, ground)}</style></head><body><div class="canvas">${inner}</div>
${READY}</body></html>`
}

const mark = (ground, size, left, bottom) =>
  `<img class="mark" src="${pathToFileURL(path.join(BRAND, `unisim-icon-${ground === 'orange' || ground === 'dark' ? 'white' : 'orange'}.png`)).href}" style="width:${size}px;left:${left}px;bottom:${bottom}px" alt="UNI·SIM">`

function lockup(app, t, { left, top, size }) {
  return `<div class="lock" style="left:${left}px;top:${top}px;gap:${size * 0.35}px"><img src="${THEME[app].icon}" style="width:${size * 1.6}px;height:${size * 1.6}px"><span class="nm" style="font-size:${size}px">${esc(t.name)}</span></div>`
}

// The back phone of the hero: one element in both files, 01 at x and 02 at x − 1440.
const BACK = { w: 640, left: 1110, top: 760, rot: 7 }

function heroOpen(app, lang, s, t, ground) {
  const [front, back] = s.raw
  return page(app, ground, `
    ${lockup(app, t.lockup, { left: 110, top: 150, size: 58 })}
    <div class="head" data-fit="420" style="left:110px;right:330px;top:330px;text-align:left;font-size:${s.t.size || 132}px">${rich(s.t.head)}</div>
    <div class="floor" style="left:120px;top:2280px;width:780px;height:150px"></div>
    ${device(app, lang, 'phone', front, { w: 620, left: 150, top: 820, rot: -7, z: 2 })}
    ${device(app, lang, 'phone', back, { ...BACK, z: 1 })}
    <div class="foot" data-fit="140" style="left:100px;right:100px;bottom:96px;font-size:40px">${rich(s.t.foot)}</div>`)
}

function heroClose(app, lang, s, t, ground) {
  const bears = app === 'bear' ? ['manic', 'elevated', 'good', 'stable', 'low', 'depressed'].map((m, i) =>
    `<img class="bearf" src="${R(`images/moods/${m}.png`)}" style="width:${230 - i * 6}px;left:${930 - (i % 2) * 150}px;top:${700 + i * 250}px;transform:rotate(${i % 2 ? 8 : -6}deg)">`).join('')
    // Anonymous: the board's check-in as the capture shows it, today's
    // (invented) totals per mood, no words to translate.
    : [['manic', 2], ['elevated', 9], ['stable', 38], ['low', 14], ['depressed', 5]].map(([m, n], i) =>
      `<div style="position:absolute;right:${i % 2 ? 170 : 90}px;top:${1120 + i * 240}px;display:flex;align-items:center;gap:26px;background:#fff;border-radius:999px;padding:16px 50px 16px 18px;box-shadow:0 20px 40px -18px rgba(120,90,0,.55)${m === 'stable' ? ';outline:8px solid rgba(255,255,255,.55)' : ''}"><img src="${R(`images/moods/${m}.png`)}" style="width:150px;height:150px"><b style="font-size:76px;font-weight:900;color:#3d2c00">${n}</b></div>`).join('')
  return page(app, ground, `
    <div class="glow" style="left:500px;top:900px;width:1400px;height:1400px"></div>
    <div class="head" data-fit="420" style="left:420px;right:90px;top:200px;text-align:right;font-size:${s.t.size || 118}px">${rich(s.t.head)}</div>
    ${device(app, lang, 'phone', s.raw[0], { ...BACK, left: BACK.left - 1440 })}
    ${bears}
    ${s.t.cap ? `<div class="sub" data-fit="300" style="left:${app === 'bear' ? 760 : 700}px;right:90px;top:${app === 'bear' ? 2180 : 760}px;text-align:right;font-size:50px">${rich(s.t.cap)}</div>` : ''}
    ${s.t.chips ? `<div style="position:absolute;left:700px;right:80px;top:1250px">${chips(s.t.chips, s.t.hot, 42, 'flex-end')}</div>` : ''}
    <div class="foot" data-fit="140" style="left:480px;right:170px;bottom:84px;text-align:right;font-size:40px">${rich(s.t.foot)}</div>
    ${mark(ground, 64, 60, 60).replace('left:60px', 'right:60px;left:auto')}`)
}

function feature(app, lang, cls, s, ground) {
  const t = s.t
  if (cls === 'tablet7') {
    // Landscape: words on the left, the tablet on the right.
    return page(app, ground, `
      <div style="position:absolute;left:130px;width:860px;top:90px;bottom:150px;display:flex;flex-direction:column;justify-content:center;gap:56px">
        <div class="head" data-fit="620" style="position:static;text-align:left;font-size:${t.size7 || 112}px">${rich(t.head)}</div>
        ${t.cap ? `<div class="sub" data-fit="200" style="position:static;text-align:left;font-size:48px">${rich(t.cap)}</div>` : ''}
        ${chips(t.chips, t.hot, 40, 'flex-start')}
      </div>
      ${device(app, lang, 'tablet7', s.raw[0], { w: 1420, left: 1060, top: 200 })}
      ${mark(ground, 64, 130, 70)}`)
  }
  if (cls === 'tablet10') {
    return page(app, ground, `
      <div class="head" data-fit="300" style="left:90px;right:90px;top:120px;font-size:${t.size || 110}px">${rich(t.head)}</div>
      ${t.cap ? `<div class="sub" data-fit="120" style="left:110px;right:110px;top:420px;font-size:44px">${rich(t.cap)}</div>` : ''}
      ${device(app, lang, 'tablet10', s.raw[0], { w: 1180, top: 560, center: true })}
      ${mark(ground, 60, 60, 46)}`)
  }
  return page(app, ground, `
    <div class="head" data-fit="330" style="left:80px;right:80px;top:110px;font-size:${t.size || 112}px">${rich(t.head)}</div>
    ${device(app, lang, 'phone', s.raw[0], { w: 690, top: 455, center: true })}
    ${t.cap ? `<div class="sub" data-fit="120" style="left:90px;right:90px;top:1995px;font-size:50px">${rich(t.cap)}</div>` : ''}
    <div style="position:absolute;left:60px;right:60px;top:${t.cap ? 2090 : 2020}px">${chips(t.chips, t.hot, 44)}</div>
    ${t.foot ? `<div class="foot" data-fit="110" style="left:180px;right:180px;bottom:70px;font-size:36px">${rich(t.foot)}</div>` : ''}
    ${mark(ground, 60, 60, 66)}`)
}

function privacy(app, lang, s, ground) {
  const t = s.t
  return page(app, ground, `
    <div class="head" data-fit="300" style="left:80px;right:80px;top:150px;font-size:${t.size || 120}px">${rich(t.head)}</div>
    ${device(app, lang, 'phone', s.raw[0], { w: 600, top: 440, center: true })}
    <div style="position:absolute;left:50%;top:1880px;transform:translateX(-50%);width:170px;height:170px;border-radius:50%;background:radial-gradient(circle at 50% 40%,#ffb54a,#ff7a00);box-shadow:0 0 0 14px rgba(255,140,0,.18),0 30px 60px -10px rgba(255,120,0,.6);display:flex;align-items:center;justify-content:center;font-size:84px">🔒</div>
    <div class="head" data-fit="260" style="left:120px;right:120px;top:2110px;font-size:84px">${rich(t.cap)}</div>
    <div class="foot" data-fit="110" style="left:160px;right:160px;bottom:80px;font-size:40px">${rich(t.foot)}</div>
    ${mark(ground, 60, 60, 66)}`)
}

// ── Feature graphic (1024 × 500) ───────────────────────────────────────────
function featureGraphic(app, lang, t) {
  const fg = t.fg
  if (app === 'bear') {
    const bears = ['depressed', 'low', 'stable', 'good', 'elevated', 'manic']
    const pos = [[464, 314], [554, 232], [644, 274], [734, 180], [824, 222], [914, 122]]
    return `<!doctype html><html><head><meta charset="utf-8"><style>${css(app, 'orange')}
      .fg{position:relative;width:1024px;height:500px;overflow:hidden;background:${GROUND.orange}}
      .fbear{position:absolute;width:92px;height:92px;filter:drop-shadow(0 0 16px rgba(255,150,45,.5)) drop-shadow(0 8px 12px rgba(140,55,0,.5))}
      .lk{position:absolute;left:60px;top:0;height:500px;width:420px;display:flex;flex-direction:column;justify-content:center;gap:16px;z-index:5}
      .lk img{width:112px;height:112px;filter:drop-shadow(0 10px 20px rgba(140,55,0,.45))}
      .lk .n{font-weight:900;font-size:58px;line-height:1;color:#fff;letter-spacing:-.02em;text-shadow:0 3px 14px rgba(140,55,0,.35)}
      .lk .t{font-weight:800;font-size:27px;line-height:1.28;color:#fff}
    </style></head><body><div class="fg">
      <svg width="1024" height="500" viewBox="0 0 1024 500" style="position:absolute;inset:0">
        <defs><radialGradient id="g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".55" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
        <ellipse cx="720" cy="250" rx="430" ry="330" fill="url(#g)"/>
        <g fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"><circle cx="720" cy="250" r="250"/><circle cx="720" cy="250" r="370"/></g>
        <path d="M-40,486 C76,486 120,462 235,462 C350,462 394,360 510,360 C548,360 562,278 600,278 C638,278 652,320 690,320 C728,320 742,226 780,226 C818,226 832,268 870,268 C908,268 922,168 960,168 C1008,168 1027,116 1075,116" fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="8" stroke-linecap="round" style="filter:drop-shadow(0 0 14px rgba(255,255,255,.6))"/>
      </svg>
      ${bears.map((b, i) => `<img class="fbear" src="${R(`images/moods/${b}.png`)}" style="left:${pos[i][0]}px;top:${pos[i][1]}px">`).join('')}
      <div class="lk"><img src="${THEME.bear.icon}"><div class="n">Bipolar<br>Bear</div><div class="t" data-fit="110">${rich(fg.tag)}</div></div>
    </div>${READY}</body></html>`
  }
  // Bipolar Anonymous: the yellow board, its bear, and three members saying
  // something small and kind, under "You're not alone."
  // The words are the board's own invented replies to today's topic, in that
  // language (screens-i18n/ipad_anon_board.json), first sentence of each.
  const said = (k) => BOARD[lang][`topic/comments/${k}`].split(/(?<=[.!?。！？])\s*/)[0]
  const bubbles = [['WillowBay', 'WB', '#f48fb1', '#c2185b', said('c1')], ['CopperFinch', 'CF', '#4dd0e1', '#00838f', said('c2')],
    ['LanternLight', 'LL', '#64b5f6', '#1565c0', said('c3')]].map(([who, init, c1, c2, text], i) => `
    <div class="bub" style="left:${[536, 574, 524][i]}px;top:${[64, 198, 332][i]}px">
      <span class="av" style="background:linear-gradient(135deg,${c1},${c2})">${esc(init)}</span>
      <span class="bt"><b>${esc(who)}</b>${esc(text)}</span>
    </div>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css('anon', 'yellow')}
    .fg{position:relative;width:1024px;height:500px;overflow:hidden;background:${GROUND.cream}}
    .ring{position:absolute;border-radius:50%;border:2px dashed rgba(200,150,0,.25)}
    .lk{position:absolute;left:56px;top:0;height:500px;width:470px;display:flex;flex-direction:column;justify-content:center;gap:12px;z-index:5}
    .lk img{width:104px;height:104px;border-radius:24px;box-shadow:0 12px 26px -10px rgba(120,90,0,.5)}
    .lk .n{font-weight:800;font-size:30px;color:#6b5a2a;letter-spacing:.01em}
    .lk .h{font-weight:900;font-size:64px;line-height:1.02;color:#2b2100;letter-spacing:-.02em}
    .lk .h .acc{color:#e2a400}
    .bub{position:absolute;display:flex;gap:12px;align-items:flex-start;background:#fff;border-radius:22px;padding:14px 18px 14px 14px;width:420px;box-shadow:0 14px 30px -14px rgba(120,90,0,.45)}
    .av{flex:0 0 auto;width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:19px}
    .bt{font-weight:600;font-size:19px;line-height:1.3;color:#3a3220}
    .bt b{display:block;font-weight:800;font-size:16px;color:#7a5600;margin-bottom:2px}
  </style></head><body><div class="fg">
    <div class="ring" style="left:470px;top:-160px;width:820px;height:820px"></div>
    <div class="ring" style="left:600px;top:-30px;width:560px;height:560px"></div>
    ${bubbles}
    <div class="lk"><img src="${THEME.anon.icon}"><div class="n">Bipolar Anonymous</div><div class="h" data-fit="230">${rich(fg.head)}</div></div>
  </div>${READY}</body></html>`
}

// ── Render ─────────────────────────────────────────────────────────────────
async function playwright() {
  if (process.env.PLAYWRIGHT) return import(pathToFileURL(process.env.PLAYWRIGHT).href)
  return import('playwright')
}

const args = process.argv.slice(2)
const apps = args.filter((a) => a === 'bear' || a === 'anon')
const classes = args.filter((a) => ['phone', 'tablet7', 'tablet10', 'fg'].includes(a))
const langs = args.filter((a) => LANGS.includes(a))
const { chromium } = await playwright()
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--allow-file-access-from-files'] })
const tmp = path.join(here, 'out/_build')
mkdirSync(tmp, { recursive: true })
const ctxs = {}
const ctxFor = async (W, H) => (ctxs[`${W}x${H}`] ??= await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 }))

async function render(html, out, W, H) {
  const file = path.join(tmp, path.basename(out).replace('.png', `-${process.pid}.html`))
  writeFileSync(file, html)
  const pg = await (await ctxFor(W, H)).newPage()
  await pg.goto(pathToFileURL(file).href)
  await pg.evaluate(() => window.__ready)
  await pg.waitForTimeout(150)
  mkdirSync(path.dirname(out), { recursive: true })
  // JPEG never carries alpha; Play takes a 24-bit PNG, so write PNG from an
  // opaque page and check it.
  await pg.screenshot({ path: out, type: 'png', omitBackground: false })
  await pg.close()
  rmSync(file)
}

let n = 0
try {
  for (const app of apps.length ? apps : ['bear', 'anon']) {
    for (const lang of langs.length ? langs : LANGS) {
      const t = STR[app][lang]
      if (!t) throw new Error(`strings.json has no ${app}.${lang}`)
      const out = path.join(here, 'out', app, lang)
      for (const cls of classes.length ? classes : ['phone', 'tablet7', 'tablet10', 'fg']) {
        if (cls === 'fg') {
          await render(featureGraphic(app, lang, t), path.join(out, 'feature-graphic.png'), 1024, 500); n++
          continue
        }
        const set = SETS[app][cls === 'phone' ? 'phone' : 'tablet']
        for (const [id, layout, raw] of set) {
          const key = cls === 'phone' ? id : `t${id}`
          const st = t.shots[key]
          if (!st) throw new Error(`strings.json has no ${app}.${lang}.shots.${key}`)
          for (const r of raw) if (!existsSync(path.join(RAW, app, lang, cls, `${r}.png`))) throw new Error(`no capture ${app}/${lang}/${cls}/${r}.png: run capture.mjs`)
          const s = { raw, t: st }
          const ground = st.ground
          const html = layout === 'hero-open' ? heroOpen(app, lang, s, t, ground)
            : layout === 'hero-close' ? heroClose(app, lang, s, t, ground)
            : layout === 'privacy' ? privacy(app, lang, s, ground)
            : feature(app, lang, cls, s, ground)
          const [W, H] = CANVAS[cls]
          await render(html, path.join(out, cls, `${id}.png`), W, H); n++
        }
        console.log(`${app} ${lang} ${cls}`)
      }
    }
  }
} finally {
  await browser.close()
}
console.log(`rendered ${n} images`)
