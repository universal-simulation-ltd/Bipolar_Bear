#!/usr/bin/env node
// Google Play captures for BIPOLAR BEAR and BIPOLAR ANONYMOUS: the real app,
// today's committed code, on an Android phone and two Android tablets, in
// every Play language (James, 2026-10-17: "Do everything"). build.mjs frames
// them into the Play set.
//
//   node store-assets/play/capture.mjs                       both apps, every class and language
//   node store-assets/play/capture.mjs bear phone de pl zh   some of them
//   → store-assets/play/out/raw/<app>/<lang>/<class>/<shot>.png  (+ .txt: every word on screen)
//
// Classes (CSS px, the app's own breakpoints decide the layout):
//   phone     412 × 868 at 3×: a 20:9 Android phone less its status and gesture bars
//   tablet7   960 × 600 at 2×: a 7" tablet held landscape (≥768 px: the wide layout)
//   tablet10  800 × 1280 at 2×: a 10" tablet held portrait (the wide layout, 4-column kit)
//
// What it serves: `git archive HEAD` (less store-assets), and for anonymous
// the bundle scripts/build-anonymous.js makes from it, in a temp folder, on
// a made-up origin answered by Playwright's router: nothing reaches the
// network. Firebase is preview.mjs's in-memory stand-in (read from that file,
// not copied), the board's posts and replies are invented, and Bear runs as a
// guest with five weeks of invented entries, a survival kit and a safety plan,
// all in that language (screens-i18n/ipad_seed.json, ipad_anon_board.json and
// play/seed.json). The shell says it is Capacitor on Android, so the app
// draws its native layout and its Android wording (Health Connect, not Apple
// Health).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { bearEntries, boardDocs } from '../preview.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const assets = path.resolve(here, '..')
const repo = path.resolve(assets, '..')
const ORIGIN = 'http://localhost:8812'
const OUT = path.join(here, 'out/raw')

const IPAD_SEED = JSON.parse(readFileSync(path.join(assets, 'screens-i18n/ipad_seed.json'), 'utf8'))
const BOARD = JSON.parse(readFileSync(path.join(assets, 'screens-i18n/ipad_anon_board.json'), 'utf8'))
const SEED = JSON.parse(readFileSync(path.join(here, 'seed.json'), 'utf8'))

// Play language → [app language, browser locale, time zone]
export const LANGS = {
  en: ['en', 'en-GB', 'Europe/London'],
  es: ['es', 'es-ES', 'Europe/Madrid'],
  fr: ['fr', 'fr-FR', 'Europe/Paris'],
  de: ['de', 'de-DE', 'Europe/Berlin'],
  it: ['it', 'it-IT', 'Europe/Rome'],
  pt: ['pt', 'pt-PT', 'Europe/Lisbon'],
  'pt-BR': ['pt', 'pt-BR', 'America/Sao_Paulo'],
  nl: ['nl', 'nl-NL', 'Europe/Amsterdam'],
  pl: ['pl', 'pl-PL', 'Europe/Warsaw'],
  sv: ['sv', 'sv-SE', 'Europe/Stockholm'],
  zh: ['zh', 'zh-CN', 'Asia/Shanghai'],
}
export const CLASSES = {
  phone: { viewport: { width: 412, height: 868 }, deviceScaleFactor: 3 },
  tablet7: { viewport: { width: 960, height: 600 }, deviceScaleFactor: 2 },
  tablet10: { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2 },
}

// ── Firebase stand-in: preview.mjs's fakeFirebase, read from its source ─────
const previewSrc = readFileSync(path.join(assets, 'preview.mjs'), 'utf8')
const ffStart = previewSrc.indexOf('function fakeFirebase(seed) {')
const ffEnd = previewSrc.indexOf('\n// ── Invented content')
if (ffStart < 0 || ffEnd < 0) throw new Error('fakeFirebase not found in preview.mjs')
const FAKE_FIREBASE = previewSrc.slice(ffStart, ffEnd).trim()

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg',
}

async function snapshot() {
  const tmp = await mkdtemp(path.join(tmpdir(), 'bb-play-'))
  execSync(`git -C "${repo}" archive HEAD -- . ":(exclude)store-assets" | tar -x -C "${tmp}"`)
  execSync('node scripts/build-anonymous.js', { cwd: tmp, stdio: 'ignore' })
  return tmp
}

// ── Invented content ───────────────────────────────────────────────────────
// Five weeks of entries (preview.mjs), with a drink the evening before each
// low day and a short night before it, so Personalised Feedback has real
// patterns to find.
function entries(lang, tz) {
  const s = IPAD_SEED[lang]
  const all = bearEntries(s ? s.notes : undefined)
  const list = Object.values(all).sort((a, b) => b.timestamp - a.timestamp)
  list.forEach((e, i) => {
    const before = list[i - 1] // the next day
    e.recordedTz = tz
    e.alcohol = before && before.mood === 'low' ? 'yes' : 'no'
    if (e.mood === 'low') e.sleep = 5.5
    if (e.mood === 'elevated') e.sleep = 7
  })
  return all
}

function guestPin(pin = '2580') {
  const salt = randomBytes(16)
  const key = pbkdf2Sync(pin, salt, 100000, 32, 'sha256')
  return {
    local: { bbGuestPinSalt: salt.toString('base64'), bbPinEnabled: '1', bbPinCode: pin, bbPinLinkedUID: 'guest' },
    session: { bb_guest_key: key.toString('base64'), bbPinUnlocked: '1' },
  }
}

const EN_KIT = {
  currentMedList: [{ name: 'Lithium', dosage: '800mg' }, { name: 'Quetiapine', dosage: '200mg' }],
  dailyGoals: ['Walk for 20 minutes', 'Message one friend today', 'Lights out by 11pm'],
  survivalGratitude: ['My morning coffee', 'A check-in text from mum', 'Getting through a hard week'],
  rememberThis: "This feeling is temporary. I've got through every low before, and I will again.",
  copingStrategies: {
    low: ['Get outside for a 10-minute walk', 'Call my sister, even just to say hi', 'Play a game to break the spiral'],
    depressed: ['Open the curtains and let the light in', 'Drink a full glass of water', 'Text someone I trust'],
    manic: ['Step away from any big decisions', 'No new purchases today', 'Call my care team'],
  },
  moodDefinitions: { low: 'Quiet, low energy: everything feels heavier than usual.' },
}
function kit(lang) {
  const s = IPAD_SEED[lang]
  if (!s) return EN_KIT
  return {
    copingStrategies: { low: s.low, depressed: s.depressed, manic: s.manic },
    dailyGoals: s.goals, survivalGratitude: s.gratitude, rememberThis: s.remember,
    moodDefinitions: { low: s.lowDef },
    currentMedList: s.meds.map(([name, dosage]) => ({ name, dosage })),
  }
}

function bearStorage(lang, appLang, tz) {
  const plan = { v: 1, updatedAt: Date.now() - 3 * 86400000, ...SEED.plan[lang] }
  return {
    bbLanguage: appLang, bbTheme: 'light',
    bbWelcomeShown: '1', bbFabFirstRunDone: '1', bbWaFabHidden: '1', bbSurvivalKitVisited: '1',
    bbMoodDefHintDone: '1', bbMedHintDone: '1', bbPersonalHintDone: '1', bbTutorialToastShown: '1', bbHasEntries: '1',
    bbOnboardingStep: '12', bbSettingsFabHintShown: '1', achievementToastsEnabled: 'false', bbSurvivalCelebDone: '1',
    bbDefaults20261012: '1', wheelModeEnabled: '1', disabledSteps: ['notes'],
    ...kit(lang), bbSafetyPlan: plan, ...entries(lang, tz),
  }
}

// The board in that language: preview.mjs's invented members, their words
// from ipad_anon_board.json, two more replies on the question thread. The
// daily topic is posted in English (as the app does) and auto-translated.
function anonDocs(lang) {
  const P = 'bbAnonPosts/', tr = BOARD[lang], all = boardDocs(), docs = {}
  for (const [k, v] of Object.entries(all)) docs[k] = { ...v }
  const topic = Object.keys(all).find((k) => k.startsWith(P + 'topic-') && !k.includes('/comments/'))
  const reply = (from, ago) => ({ ...all[`${topic}/comments/${from}`], timestamp: { __ago: ago } })
  docs[P + 'p2/comments/c2'] = reply('c1', 74)
  docs[P + 'p2/comments/c3'] = reply('c2', 62)
  docs[P + 'p2'].commentCount = 3
  for (const [k, text] of Object.entries(tr)) {
    if (k === 'topic') continue
    docs[k.startsWith('topic/') ? topic + k.slice(5) : P + k].text = text
  }
  const translations = lang === 'en' ? null : { [all[topic].text]: tr.topic }
  return { docs, translations, topic: topic.slice(P.length) }
}
const MOOD_COUNTS = { manic: 2, elevated: 9, stable: 37, low: 14, depressed: 5 }
function boardSeed(lang) {
  const { docs, translations, topic } = anonDocs(lang)
  const callables = {
    anonMoodCheckin: {
      idle: { checkedIn: false, counts: MOOD_COUNTS },
      withArg: { checkedIn: true, via: 'board', counts: { ...MOOD_COUNTS, stable: MOOD_COUNTS.stable + 1 } },
    },
  }
  if (translations) callables.translateAnonTexts = { translate: translations }
  return { seed: { docs, callables }, topic }
}
const ANON_STORAGE = { bbAnonTheme: 'light', bbTheme: 'light', bbAnon_verified: 'true', bbAnon_monika: 'BlueHeron', bbAnon_agreedTerms: 'true' }

// ── A seeded page ──────────────────────────────────────────────────────────
async function openApp(browser, tmp, { app, cls, lang, sdkSeed, storage, session = {} }) {
  const [, locale, timezoneId] = LANGS[lang]
  const root = app === 'anon' ? path.join(tmp, 'www-anonymous') : tmp
  const ctx = await browser.newContext({ ...CLASSES[cls], isMobile: true, hasTouch: true, colorScheme: 'light', locale, timezoneId, serviceWorkers: 'block' })
  const sdk = `(${FAKE_FIREBASE})(${JSON.stringify(sdkSeed)});`
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== ORIGIN) return route.abort()
    let p = decodeURIComponent(url.pathname)
    if (p.includes('/firebasejs/')) return route.fulfill({ contentType: 'text/javascript', body: p.endsWith('firebase-app-compat.js') ? sdk : '' })
    if (p.endsWith('/')) p += 'index.html'
    if (p === '/__seed') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' })
    if (p === '/service-worker.js' || p === '/firebase-messaging-sw.js') return route.fulfill({ status: 404, body: '' })
    try {
      const file = path.join(root, p)
      await route.fulfill({ body: await readFile(file), contentType: TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' })
    } catch {
      await route.fulfill({ status: 404, body: '' })
    }
  })
  // The Android app is this same code in Capacitor's WebView: say so.
  await ctx.addInitScript(() => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false,
      Plugins: {}, convertFileSrc: (s) => s, platform: 'android' }
    addEventListener('beforeinstallprompt', (e) => { e.stopImmediatePropagation(); e.preventDefault() }, true)
  })
  const d = new Date(); d.setHours(9, 41, 0, 0)
  await ctx.clock.install({ time: d })
  const page = await ctx.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (e) => { if (!/terminated/.test(e.message)) console.warn(`  [page error ${lang}/${cls}]`, e.message.slice(0, 160)) })
  await page.goto(`${ORIGIN}/__seed`)
  await page.evaluate(([s, ss]) => {
    localStorage.clear(); sessionStorage.clear()
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
    for (const [k, v] of Object.entries(ss)) sessionStorage.setItem(k, v)
  }, [storage, session])
  return { ctx, page }
}

// Every piece of text on screen, one per line, beside each PNG: diff a
// language's .txt against en's to catch English left on a translated screen.
function onScreenText() {
  const out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n; (n = w.nextNode());) {
    const t = n.textContent.replace(/\s+/g, ' ').trim()
    const el = n.parentElement
    if (!t || !el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    const r = document.createRange(); r.selectNodeContents(n)
    const b = r.getBoundingClientRect()
    if (!b.width || !b.height || b.bottom <= 0 || b.top >= innerHeight || b.right <= 0 || b.left >= innerWidth) continue
    out.push(t)
  }
  for (const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
    const b = el.getBoundingClientRect()
    if (b.width && b.height && b.bottom > 0 && b.top < innerHeight && !el.value) out.push('[placeholder] ' + el.placeholder)
  }
  return out
}

// Toasts, confetti, coach marks and the web build's version tag are not the app at rest.
async function tidy(page) {
  await page.evaluate(() => {
    ;['pwa-install-banner', 'bbWelcomeModal', 'skWelcomeModal', 'journalTutorialProgress', 'journalStartHint',
      'survivalKitHint', 'signinHint', 'logoHint', 'bbHintOverlay', 'bbHomeVersion', 'bbSupportHint'].forEach((id) => document.getElementById(id)?.remove())
    document.querySelectorAll('[id*="install-banner"]').forEach((e) => e.remove())
    document.querySelectorAll('body > div, body > canvas').forEach((el) => {
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' && Number(cs.zIndex) >= 9990 && !el.querySelector('button') && !el.matches('.bbsp-sheet')) el.remove()
    })
  })
  await page.waitForTimeout(300)
}

function shooter(page, dir, label) {
  mkdirSync(dir, { recursive: true })
  return async (name, { keep = false } = {}) => {
    if (!keep) await tidy(page)
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(dir, `${name}.png`) })
    writeFileSync(path.join(dir, `${name}.txt`), (await page.evaluate(onScreenText)).join('\n') + '\n')
    console.log(`${label}/${name}`)
  }
}

const visible = (page, sel) => page.locator(sel).locator('visible=true').first()

// ── Bipolar Bear ───────────────────────────────────────────────────────────
async function bear(browser, tmp, cls, lang) {
  const [appLang, , tz] = LANGS[lang]
  const pin = guestPin()
  const { seed: sdkSeed } = boardSeed(lang)
  const { ctx, page } = await openApp(browser, tmp, {
    app: 'bear', cls, lang, sdkSeed,
    storage: { ...bearStorage(lang, appLang, tz), ...pin.local, ...ANON_STORAGE, bbLanguage: appLang },
    session: pin.session,
  })
  const shot = shooter(page, path.join(OUT, 'bear', lang, cls), `bear ${lang} ${cls}`)
  const top = () => page.evaluate(() => scrollTo(0, 0))
  const centre = () => visible(page, '#fmWheel .fm-wheel-btn.center')
  try {
    await page.goto(`${ORIGIN}/index.html`)
    await page.waitForTimeout(4500)
    await shot('home')

    await page.goto(`${ORIGIN}/journal.html`)
    await centre().waitFor()
    await page.waitForTimeout(1800)
    await shot('mood')
    await centre().click(); await page.waitForTimeout(1400)
    await shot('sleep')
    await centre().click(); await page.waitForTimeout(1400)
    await shot('energy')

    await page.evaluate(() => showPersonalisedFeedback()); await page.waitForTimeout(1600)
    await shot('feedback')

    await page.goto(`${ORIGIN}/survival-kit.html`)
    await page.waitForTimeout(3000)
    await top(); await page.waitForTimeout(600)
    // Landscape 7": the header alone fills the screen, so start at the tab strip.
    if (cls === 'tablet7') await page.evaluate(() => scrollTo(0, document.querySelector('.sk-tab').parentElement.getBoundingClientRect().top + scrollY - 8))
    await page.waitForTimeout(400)
    await shot('kit')
    await page.locator('a.sk-tab[data-sk-tab="coping-strategies"]').first().click(); await page.waitForTimeout(900)
    await visible(page, '#coping-strategies .mood-icon-btn.low').click(); await page.waitForTimeout(1400)
    // Its section just under the sticky tab strip, the orange header scrolled away.
    await page.evaluate(() => {
      const el = document.getElementById('coping-strategies'), bar = document.querySelector('.sk-tab').parentElement
      scrollTo(0, el.getBoundingClientRect().top + scrollY)
      scrollBy(0, -(Math.max(0, bar.getBoundingClientRect().bottom) + 12))
    })
    await page.waitForTimeout(700)
    await shot('coping')
    await top(); await page.waitForTimeout(400)
    await page.evaluate(() => BB.safetyPlan.open()); await page.waitForTimeout(1300)
    await shot('plan', { keep: true })

    // The board, inside Bipolar Bear.
    await page.goto(`${ORIGIN}/anonymous.html`)
    await page.locator('#post-list .mood-btn[data-mood=stable]').waitFor()
    await page.waitForTimeout(1800)
    await shot('board')

    // Locked again: the journal opens behind its PIN.
    await page.evaluate(() => { sessionStorage.removeItem('bbPinUnlocked'); sessionStorage.removeItem('bb_guest_key') })
    await page.goto(`${ORIGIN}/journal.html`)
    await page.waitForTimeout(3000)
    await shot('pin')
  } finally {
    await ctx.close()
  }
}

// ── Bipolar Anonymous ──────────────────────────────────────────────────────
async function anon(browser, tmp, cls, lang) {
  const [appLang] = LANGS[lang]
  const { seed: sdkSeed, topic } = boardSeed(lang)
  const { ctx, page } = await openApp(browser, tmp, { app: 'anon', cls, lang, sdkSeed, storage: { ...ANON_STORAGE, bbLanguage: appLang } })
  const shot = shooter(page, path.join(OUT, 'anon', lang, cls), `anon ${lang} ${cls}`)
  const board = async () => {
    await page.goto(`${ORIGIN}/index.html`)
    await page.locator('#post-list .topic-card').waitFor()
    await page.waitForTimeout(1600)
  }
  const thread = async (id) => {
    await page.locator(`#post-list [data-comment="${id}"]`).first().click()
    await page.locator('#thread-close').waitFor({ state: 'visible' })
    await page.waitForTimeout(1500)
  }
  try {
    await board()
    await shot('feed')
    // How are you today? Stable: the board answers with today's totals.
    await page.locator('#post-list .mood-btn[data-mood=stable]').click(); await page.waitForTimeout(2200)
    await shot('checkin', { keep: true })
    await thread(topic)
    await shot('thread')
    await page.locator('#thread-close').click(); await page.waitForTimeout(600)
    await page.evaluate(() => document.querySelector('#post-list [data-report="p3"]').click())
    await page.waitForTimeout(900)
    await shot('report', { keep: true })
    await board()
    await page.locator('.board-tab').nth(2).click(); await page.waitForTimeout(1200)
    await shot('wikilist')
    await visible(page, '.wiki-card summary').click(); await page.waitForTimeout(1200)
    await shot('wiki')
    await page.evaluate(() => { showScreen('monika'); setupMonika() }); await page.waitForTimeout(600)
    await page.locator('#monika-input').pressSequentially('BlueHeron', { delay: 30 }); await page.waitForTimeout(900)
    await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.waitForTimeout(300)
    await shot('monika', { keep: true })
    await page.evaluate(() => localStorage.setItem('bbAnonTheme', 'dark'))
    await board()
    await shot('feed-dark')
    await thread('p2')
    await shot('thread-dark')
  } finally {
    await ctx.close()
  }
}

// ── Run ────────────────────────────────────────────────────────────────────
async function playwright() {
  if (process.env.PLAYWRIGHT) return import(pathToFileURL(process.env.PLAYWRIGHT).href)
  return import('playwright')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const apps = args.filter((a) => a === 'bear' || a === 'anon')
  const classes = args.filter((a) => a in CLASSES)
  const langs = args.filter((a) => a in LANGS)
  const bad = args.filter((a) => !apps.includes(a) && !classes.includes(a) && !langs.includes(a))
  if (bad.length) { console.error(`unknown: ${bad.join(' ')}`); process.exit(2) }
  const { chromium } = await playwright()
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
  const tmp = await snapshot()
  try {
    for (const app of apps.length ? apps : ['bear', 'anon']) {
      for (const lang of langs.length ? langs : Object.keys(LANGS)) {
        for (const cls of classes.length ? classes : Object.keys(CLASSES)) {
          await (app === 'bear' ? bear : anon)(browser, tmp, cls, lang)
        }
      }
    }
  } finally {
    await browser.close()
    await rm(tmp, { recursive: true, force: true })
  }
}
