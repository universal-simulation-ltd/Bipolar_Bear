#!/usr/bin/env node
// Capture the real Bipolar Bear app on a 13" iPad (1024×1366 @2 → 2048×2732)
// in every store language, for the localised iPad App Store set
// (build-ipad-localized.mjs frames them).
//
// The first en-GB iPad set (out/ipad/, build-ipad.mjs + build-ipad-hero.mjs,
// July 2026) framed six captures of the app; this takes the same six screens
// of today's app (the committed HEAD) in English and each store language:
//
//   01-home              home
//   02-journal-mood      focus mode's "How was yesterday?" on the wheel (a new user's default)
//   03-survival-kit      the survival kit's sections
//   04-survival-tools    its coping strategies for a low day, then the crisis box
//   05-pin               the PIN lock a guest journal opens behind
//   06-details           "Personal details" (Profile → personal info), which
//                        exported PDFs for the doctor carry, over home
//
// The en-GB set's 05 and 06 showed the entry list and the Export PDF dialog.
// Those are still hard-coded English in the app (dates, "Yes", "Normal", the
// whole dialog), and so are the journal's "Favourite Entries" tile and the
// calendar's month, day letters and legend, which sit on every screen of the
// journal's stats, life chart included. In another language they would put
// English on a translated screen, so 05 is the PIN lock (the iPhone set's
// "Full privacy." screen) and 06 the personal-details form, both translated.
//
// It runs the committed app through preview.mjs's open(): a guest with five
// weeks of invented entries and a survival kit, Firebase answered by an
// in-memory stand-in, nothing sent anywhere. Everything the "user" typed (the
// strategies, goals, meds, notes) comes in that language from
// screens-i18n/ipad_seed.json, and the browser's time zone is the locale's,
// so the crisis lines are that country's. pt-BR is the app's Portuguese UI
// with Brazilian notes and Brazil's crisis lines.
//
// Bipolar Anonymous (`anon`): the real board on an iPad, its invented members
// writing in that language (screens-i18n/ipad_anon_board.json): the feed,
// today's topic's thread, a question thread in the dark theme, a post's report
// sheet, a wiki article and choosing a moniker. English too, since its en-GB iPad set is built from
// these (App Review wants a real iPad capture in every iPad slot).
//
//   node store-assets/capture-ipad-localized.mjs                 both apps, en + every store language
//   node store-assets/capture-ipad-localized.mjs anon de zh      one app, some languages
//   → store-assets/out/localized-ipad-raw/<lang>/*.png        (bear)
//   → store-assets/out/localized-ipad-anon-raw/<lang>/*.png   (anon)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { open, bearEntries, boardDocs } from './preview.mjs'
import { playwright } from '../../Docs_UNI_SIM/store-kit/preview.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const SEED = JSON.parse(readFileSync(path.join(here, 'screens-i18n/ipad_seed.json'), 'utf8'))
const ORIGIN = 'http://localhost:8765'
const IPAD = { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' }

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
// en too: both apps' en-GB iPad sets are built from these (2026-10-16).
const want = () => langArgs.length ? langArgs : Object.keys(LANGS)
const BOARD = JSON.parse(readFileSync(path.join(here, 'screens-i18n/ipad_anon_board.json'), 'utf8'))

// The survival kit and journal notes in that language (English: preview.mjs's own).
function storage(lang, tz) {
  const s = SEED[lang]
  // A new user's home (2026-10-12/13): the quick check-in card with its stats,
  // and the 🆘 crisis button in the dock.
  const extra = { bbSurvivalCelebDone: '1', bbHomeDefaults20261012: '1', bbDefaults20261013: '1', bbWaFabHidden: '0',
    bbCurrentStreak: '34', bbStableStreak: '5' }
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

// Toasts, confetti and first-run coaches are not the app at rest.
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

// Every piece of text on screen (in the viewport, not hidden, not under a modal's
// scrim is still counted), one per line, beside each PNG: diff a language's
// .txt against en's to catch English the app left untranslated.
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

async function capture(browser, lang) {
  const [appLang, locale, tz] = LANGS[lang]
  const out = path.join(here, 'out/localized-ipad-raw', lang)
  mkdirSync(out, { recursive: true })
  const { ctx, page, cleanup } = await open('bear', { browser, device: IPAD, lang: appLang, locale, timezoneId: tz, storage: storage(lang, tz) })
  await ctx.clock.setSystemTime(nineFortyOne(tz))
  const shot = async (name) => {
    await tidy(page)
    await page.screenshot({ path: path.join(out, `${name}.png`) })
    writeFileSync(path.join(out, `${name}.txt`), (await page.evaluate(onScreenText)).join('\n') + '\n')
    console.log(`${lang}/${name}.png`)
  }
  const top = (y = 0) => page.evaluate((y) => window.scrollTo(0, y), y)
  try {
    await page.goto(`${ORIGIN}/index.html`)
    await page.waitForTimeout(4500)
    await shot('01-home')

    // Profile → personal info, over home.
    await page.evaluate(() => window._fabOpenPersonalInfo()); await page.waitForTimeout(1300)
    await shot('06-details')

    await page.goto(`${ORIGIN}/journal.html`)
    await page.locator('#fmBackBtn').waitFor({ state: 'visible' })
    await page.waitForTimeout(1800)
    await shot('02-journal-mood')

    await page.goto(`${ORIGIN}/survival-kit.html`)
    await page.waitForTimeout(2500)
    await top(0); await page.waitForTimeout(600)
    await shot('03-survival-kit')
    await page.locator('a.sk-tab[data-sk-tab="coping-strategies"]').click(); await page.waitForTimeout(900)
    await page.locator('#coping-strategies .mood-icon-btn.low').first().click(); await page.waitForTimeout(1400)
    const skY = await page.evaluate(() => document.getElementById('coping-strategies').getBoundingClientRect().top + scrollY)
    await top(skY - 200); await page.waitForTimeout(700)
    await shot('04-survival-tools')

    // Locked again: the journal opens behind its PIN.
    await page.evaluate(() => { sessionStorage.removeItem('bbPinUnlocked'); sessionStorage.removeItem('bb_guest_key') })
    await page.goto(`${ORIGIN}/journal.html`)
    await page.waitForTimeout(3000)
    await shot('05-pin')
  } finally {
    await ctx.close(); await cleanup()
  }
}

// ── Bipolar Anonymous ───────────────────────────────────────────────────────
// preview.mjs's board (its invented members), each post and reply written in
// the board's language, and two more replies on the question thread. Today's
// topic stays English, as the app posts it (its topics are English only), and
// the board's auto-translation shows it in the reader's language, as it does
// for a member reading in another language.
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
  const out = path.join(here, 'out/localized-ipad-anon-raw', lang)
  mkdirSync(out, { recursive: true })
  const { docs, translations, topic } = anonDocs(lang)
  const { ctx, page, cleanup } = await open('anonymous', { browser, device: IPAD, lang: appLang, locale, timezoneId: tz, docs, translations })
  await ctx.clock.setSystemTime(nineFortyOne(tz))
  const shot = async (name) => {
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(out, `${name}.png`) })
    writeFileSync(path.join(out, `${name}.txt`), (await page.evaluate(onScreenText)).join('\n') + '\n')
    console.log(`anon ${lang}/${name}.png`)
  }
  const board = async () => {
    await page.goto(`${ORIGIN}/index.html`)
    await page.locator('#post-list .mood-btn[data-mood=stable]').waitFor()
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
    // Report a post: the ⋯ menu's Report, as a tap on it does.
    await page.evaluate(() => document.querySelector('#post-list [data-report="p3"]').click())
    await page.waitForTimeout(900)
    await shot('report')
    await board()
    // The wiki, an article open.
    await page.locator('.board-tab').nth(2).click(); await page.waitForTimeout(1200)
    // Loved ones → "What to say (and what not to say)", sourced from Mind
    // rather than the NHS, so it reads true in every country's store.
    await page.evaluate(() => document.querySelector('.wiki-pill[data-wiki="lovedOnes"]').click()); await page.waitForTimeout(800)
    await page.locator('.wiki-card summary').locator('visible=true').nth(1).click(); await page.waitForTimeout(1200)
    // The articles just under the tabs: above them sits the wiki's "based on
    // UK-issued guidance (NHS, …)" note, which would put the NHS in every store.
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('.wiki-card')].filter((c) => c.offsetParent)[0]
      let el = card.parentElement
      while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement
      el = el || document.scrollingElement
      const tabs = Math.max(...[...document.querySelectorAll('.board-tab')].map((t) => t.getBoundingClientRect().bottom))
      el.scrollTop += card.getBoundingClientRect().top - tabs - 14
    })
    await page.waitForTimeout(900)
    await shot('wiki')
    // Choosing a moniker, as after the email code.
    await page.evaluate(() => { showScreen('monika'); setupMonika() }); await page.waitForTimeout(600)
    await page.locator('#monika-input').pressSequentially('BlueHeron', { delay: 40 }); await page.waitForTimeout(900)
    await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.waitForTimeout(300)
    await shot('monika')
    // The same question thread in the dark theme.
    await page.evaluate(() => localStorage.setItem('bbAnonTheme', 'dark'))
    await board()
    await thread('p2')
    await shot('thread-dark')
  } finally {
    await ctx.close(); await cleanup()
  }
}

const { chromium } = await playwright()
const browser = await chromium.launch()
try {
  for (const app of APPS) {
    for (const lang of want()) {
      if (!LANGS[lang]) throw new Error(`unknown language ${lang}`)
      await (app === 'bear' ? capture : captureAnon)(browser, lang)
    }
  }
} finally {
  await browser.close()
}
