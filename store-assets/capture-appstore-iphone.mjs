#!/usr/bin/env node
// Capture the real apps on an iPhone for the App Store iPhone sets
// (build-appstore-iphone.mjs frames them), in English and every store language.
//
// The page is the iPhone 17 Pro Max's screen less its status bar and home
// indicator (440 × 860 pt at 3× → 1320 × 2580 px), as the UNI·SIM store kit
// captures: the builder draws the status bar (9:41, full signal and battery)
// and the home indicator over the capture's own top and bottom colours.
//
// It runs the committed app (git archive HEAD) through preview.mjs's open(),
// as capture-ipad-localized.mjs does: a guest with five weeks of invented
// entries, a survival kit and a safety plan in that language
// (screens-i18n/ipad_seed.json, appstore_seed.json), Firebase answered by an
// in-memory stand-in, every off-site request refused, nothing sent anywhere.
// A new user's defaults (focus mode's wheel, the home quick check-in with its
// stats), and Apple Health answering with an invented night (7 h 32 m) and
// day (8,432 steps), as the HealthKit plugin does on an iPhone that allowed it.
//
// Bipolar Bear  → out/appstore/raw/bear/<lang>/
//   home       home: the quick check-in, Last 7 days and its streaks
//   mood       focus mode's "How was yesterday?" on the wheel
//   sleep      the sleep step, synced from Apple Health
//   feedback   Personalised Feedback (the patterns in the journal)
//   kit        the survival kit: Struggling right now?, My safety plan, the sections
//   plan       My safety plan, filled in, as it opens
//   pin        the PIN lock a guest journal opens behind (with the plan's 🛟 button)
// Bipolar Anonymous → out/appstore/raw/anon/<lang>/
//   feed       the board: How are you today?, today's topic, members' posts
//   thread     today's topic's replies
//   checkin    after checking in: today's totals
//   ask        a question thread, dark theme
//   moniker    choosing a Moniker
//   wiki       a wiki article (Loved ones: what to say, sourced from Mind)
//   report     a post's report sheet
//   help       🛟 Help: the crisis lines for the time zone's country
// Beside each PNG a .txt of every piece of text on screen, to diff against en.
//
//   node store-assets/capture-appstore-iphone.mjs                 both apps, every language
//   node store-assets/capture-appstore-iphone.mjs anon de zh      one app, some languages
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { open, bearEntries, boardDocs } from './preview.mjs'
import { playwright } from '../../Docs_UNI_SIM/store-kit/preview.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const json = (f) => JSON.parse(readFileSync(path.join(here, 'screens-i18n', f), 'utf8'))
const SEED = json('ipad_seed.json'), PLAN = json('appstore_seed.json'), BOARD = json('ipad_anon_board.json')
const ORIGIN = 'http://localhost:8765'
const IPHONE = { viewport: { width: 440, height: 860 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'light' }

// store language → [app language, browser locale, time zone]
const LANGS = {
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
const args = process.argv.slice(2)
const appArgs = args.filter((a) => a === 'bear' || a === 'anon')
const APPS = appArgs.length ? appArgs : ['bear', 'anon']
const langArgs = args.filter((a) => !appArgs.includes(a))
const want = langArgs.length ? langArgs : Object.keys(LANGS)

// Apple Health on an iPhone that allowed it: last night 7 h 32 m asleep, and
// 8,432 steps yesterday. Only the plugin's answers are invented; the app's
// own code asks and shows them.
function fakeHealth() {
  const H = {
    isHealthAvailable: async () => ({ available: true }),
    checkHealthPermissions: async () => ({ permissions: { READ_STEPS: true, READ_SLEEP: true } }),
    requestHealthPermissions: async () => ({ permissions: { READ_STEPS: true, READ_SLEEP: true } }),
    queryAggregated: async (o) => ({ aggregatedData: [{ value: o.dataType === 'steps' ? 8432 : 27120, startDate: o.startDate, endDate: o.endDate }] }),
    queryLatestSample: async (o) => { const s = new Date(o.startDate).getTime(); return { value: 452, timestamp: s + 11.2 * 3600e3, endTimestamp: s + 18.7 * 3600e3 } },
    openAppleHealthSettings: async () => {},
  }
  if (!window.Capacitor) return
  window.Capacitor.Plugins.HealthPlugin = H
  const was = window.Capacitor.isPluginAvailable
  window.Capacitor.isPluginAvailable = (n) => n === 'HealthPlugin' || was(n)
}

// The survival kit, journal notes and safety plan in that language (English:
// preview.mjs's own kit), and a new user's starting settings.
function storage(lang, tz) {
  const s = SEED[lang], plan = PLAN[lang]
  const extra = {
    bbSurvivalCelebDone: '1',
    // A new user's home (2026-10-12): the quick check-in card, stats shown.
    bbHomeDefaults20261012: '1', bbDefaults20261013: '1', bbWaFabHidden: '0', bbCurrentStreak: '34', bbStableStreak: '5',
    bbHealthSyncEnabled: '1',
    bbSafetyPlan: { v: 1, updatedAt: Date.now() - 6 * 86400000, ...plan },
    bbSafetyPlanOnLock: '1', bbSafetyPlanMeds: '1', bbSafetyPlanPhoneLock: '1',
  }
  const entries = bearEntries(s ? s.notes : undefined)
  for (const e of Object.values(entries)) e.recordedTz = tz
  Object.assign(extra, entries)
  if (!s) return extra
  return Object.assign(extra, {
    copingStrategies: { low: s.low, depressed: s.depressed, manic: s.manic },
    dailyGoals: s.goals,
    survivalGratitude: s.gratitude,
    rememberThis: s.remember,
    moodDefinitions: { low: s.lowDef },
    currentMedList: s.meds.map(([name, dosage]) => ({ name, dosage })),
  })
}

// Toasts, confetti, first-run coaches and the web build's version tag are not
// the app at rest.
async function tidy(page) {
  await page.evaluate(() => {
    ;['pwa-install-banner', 'bbWelcomeModal', 'skWelcomeModal', 'journalTutorialProgress', 'journalStartHint',
      'survivalKitHint', 'signinHint', 'logoHint', 'bbHintOverlay', 'bbHomeVersion'].forEach((id) => document.getElementById(id)?.remove())
    document.querySelectorAll('body > div, body > canvas').forEach((el) => {
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed' && Number(cs.zIndex) >= 9990 && !el.querySelector('button')) el.remove()
    })
  })
  await page.waitForTimeout(300)
}

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

// 9:41 in the morning where the capture is set, as the status bar says.
// (preview.mjs sets 9:41 on this machine's clock, which is the afternoon in
// Shanghai and before dawn in São Paulo.)
function nineFortyOne(tz) {
  const now = new Date()
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]))
  const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute)
  const offset = local - Math.floor(now.getTime() / 60000) * 60000
  // On this machine's date, which the invented entries count back from.
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 9, 41) - offset)
}

const shown = (page, sel) => page.locator(sel).locator('visible=true').first()

async function captureBear(browser, lang) {
  const [appLang, locale, tz] = LANGS[lang]
  const out = path.join(here, 'out/appstore/raw/bear', lang)
  mkdirSync(out, { recursive: true })
  const { ctx, page, cleanup } = await open('bear', { browser, device: IPHONE, lang: appLang, locale, timezoneId: tz, storage: storage(lang, tz) })
  await ctx.clock.setSystemTime(nineFortyOne(tz))
  await ctx.addInitScript(fakeHealth)
  const shot = async (name) => {
    await tidy(page)
    await page.screenshot({ path: path.join(out, `${name}.png`) })
    writeFileSync(path.join(out, `${name}.txt`), (await page.evaluate(onScreenText)).join('\n') + '\n')
    console.log(`bear ${lang}/${name}.png`)
  }
  const centre = () => shown(page, '#fmWheel .fm-wheel-btn.center')
  try {
    await page.goto(`${ORIGIN}/index.html`)
    await page.waitForTimeout(4500)
    await shot('home')

    await page.goto(`${ORIGIN}/journal.html`)
    await centre().waitFor()
    await page.waitForTimeout(1800)
    await shot('mood')
    await centre().click()
    await page.getByText(/7\s*h\s*32|7[.,]5/).first().waitFor({ timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(1800)
    await shot('sleep')

    // Personalised Feedback, over the journal.
    await page.locator('#fmBackBtn').click(); await page.waitForTimeout(1500)
    await page.evaluate(() => window.showPersonalisedFeedback()); await page.waitForTimeout(2200)
    await shot('feedback')

    // The survival kit, from its tab strip down (the header's "people
    // helped" counter is a live figure, so it stays out of a screenshot).
    await page.goto(`${ORIGIN}/survival-kit.html`)
    await page.waitForTimeout(2500)
    const stripY = await page.evaluate(() => {
      const t = document.querySelector('a.sk-tab'); return t ? t.getBoundingClientRect().top + scrollY - 6 : 0
    })
    await page.evaluate((y) => window.scrollTo(0, y), stripY); await page.waitForTimeout(1500)
    await shot('kit')
    await shown(page, '.sk-sos.sk-plan').click(); await page.waitForTimeout(1800)
    await shot('plan')

    // Locked again: the journal opens behind its PIN.
    await page.evaluate(() => { sessionStorage.removeItem('bbPinUnlocked'); sessionStorage.removeItem('bb_guest_key') })
    await page.goto(`${ORIGIN}/journal.html`)
    await page.waitForTimeout(3000)
    await shot('pin')
  } finally {
    await ctx.close(); await cleanup()
  }
}

// ── Bipolar Anonymous ───────────────────────────────────────────────────────
// capture-ipad-localized.mjs's board: preview.mjs's invented members, every
// post and reply written in the board's language, two more replies on the
// question thread; today's topic in English with the board's auto-translation.
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

async function captureAnon(browser, lang) {
  const [appLang, locale, tz] = LANGS[lang]
  const out = path.join(here, 'out/appstore/raw/anon', lang)
  mkdirSync(out, { recursive: true })
  const { docs, translations, topic } = anonDocs(lang)
  const { ctx, page, cleanup } = await open('anonymous', { browser, device: IPHONE, lang: appLang, locale, timezoneId: tz, docs, translations })
  await ctx.clock.setSystemTime(nineFortyOne(tz))
  const shot = async (name) => {
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(out, `${name}.png`) })
    writeFileSync(path.join(out, `${name}.txt`), (await page.evaluate(onScreenText)).join('\n') + '\n')
    console.log(`anon ${lang}/${name}.png`)
  }
  const board = async () => {
    await page.goto(`${ORIGIN}/index.html`)
    await page.locator('#post-list .topic-card').waitFor()
    await page.waitForTimeout(1500)
  }
  const thread = async (id) => {
    await page.locator(`#post-list [data-comment="${id}"]`).first().click()
    await page.locator('#thread-close').waitFor({ state: 'visible' })
    await page.waitForTimeout(1500)
  }
  try {
    await board()
    await shot('feed')
    await thread(topic)
    await shot('thread')
    await page.locator('#thread-close').click(); await page.waitForTimeout(600)
    await page.evaluate(() => document.querySelector('#post-list [data-report="p3"]').click())
    await page.waitForTimeout(900)
    await shot('report')
    await board()
    await page.locator('#board-help-btn').click(); await page.waitForTimeout(1200)
    await shot('help')
    await board()
    await page.locator('#post-list .mood-btn[data-mood=stable]').click(); await page.waitForTimeout(2600)
    await shot('checkin')
    await board()
    await page.locator('.board-tab').nth(2).click(); await page.waitForTimeout(1200)
    // Loved ones → "What to say (and what not to say)": sourced from Mind,
    // not the NHS, so it reads true in every country's store.
    await page.evaluate(() => document.querySelector('.wiki-pill[data-wiki="lovedOnes"]').click())
    await page.waitForTimeout(800)
    await page.locator('.wiki-card summary').locator('visible=true').nth(1).click(); await page.waitForTimeout(1200)
    await page.evaluate(() => {
      // The article just under the tabs (above it sits the wiki's "based on
      // UK-issued guidance (NHS, …)" note, which would put the NHS in every store).
      const card = [...document.querySelectorAll('.wiki-card')].filter((c) => c.offsetParent)[0]
      let el = card.parentElement
      while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement
      el = el || document.scrollingElement
      const tabs = Math.max(...[...document.querySelectorAll('.board-tab')].map((t) => t.getBoundingClientRect().bottom))
      el.scrollTop += card.getBoundingClientRect().top - tabs - 14
    })
    await page.waitForTimeout(900)
    await shot('wiki')
    await page.evaluate(() => { showScreen('monika'); setupMonika() }); await page.waitForTimeout(600)
    await page.locator('#monika-input').pressSequentially('BlueHeron', { delay: 40 }); await page.waitForTimeout(900)
    await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.waitForTimeout(300)
    await shot('moniker')
    await page.evaluate(() => localStorage.setItem('bbAnonTheme', 'dark'))
    await board()
    await thread('p2')
    await shot('ask')
  } finally {
    await ctx.close(); await cleanup()
  }
}

const { chromium } = await playwright()
const browser = await chromium.launch()
try {
  for (const app of APPS) {
    for (const lang of want) {
      if (!LANGS[lang]) throw new Error(`unknown language ${lang}`)
      await (app === 'bear' ? captureBear : captureAnon)(browser, lang)
    }
  }
} finally {
  await browser.close()
}
