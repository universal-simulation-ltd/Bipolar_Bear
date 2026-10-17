#!/usr/bin/env node
// Put build.mjs's Google Play graphics on the live store listings: for every
// Play language, the phone screenshots, the 7" and 10" tablet screenshots and
// the feature graphic, replacing what is there. One edit per app, committed
// at the end (so a failure part-way leaves Play untouched), then read back:
// every image list is compared with the local files by sha256.
//
//   node store-assets/play/upload.mjs bear            dry run: checks every file, opens and discards an edit
//   node store-assets/play/upload.mjs bear --apply    uploads and commits
//   node store-assets/play/upload.mjs anon --apply [--review console]
//   node store-assets/play/upload.mjs bear --verify   read back only
//
// The key is the Play service account Docs_UNI_SIM/store-kit/play.mjs uses:
// PLAY_SA_KEY, else the service-account JSON in ~/Bipolar_Keystores.
// play.mjs's `listing` replaces text and images one language per edit and
// knows no tablet slots, hence this. Text, icon and video are left alone.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createSign, createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const APPS = { bear: 'com.bipolarbear.app', anon: 'com.bipolaranonymous.app' }
// build.mjs language folder → Play listing language
const LANGS = { en: 'en-GB', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', 'pt-BR': 'pt-BR',
  nl: 'nl-NL', pl: 'pl-PL', sv: 'sv-SE', zh: 'zh-CN' }
// image type → [folder, width, height, min count, max count]
const SLOTS = {
  phoneScreenshots: ['phone', 1440, 2560, 2, 8],
  sevenInchScreenshots: ['tablet7', 2560, 1440, 1, 8],
  tenInchScreenshots: ['tablet10', 1440, 2560, 1, 8],
  featureGraphic: ['feature-graphic.png', 1024, 500, 1, 1],
}

const args = process.argv.slice(2)
const app = args.find((a) => a in APPS)
const APPLY = args.includes('--apply'), VERIFY = args.includes('--verify')
const unsent = args.includes('--review') && args[args.indexOf('--review') + 1] === 'console'
if (!app) { console.error('usage: upload.mjs bear|anon [--apply | --verify] [--review console]'); process.exit(2) }
const PKG = APPS[app]

// ── Files: present, the right size, opaque ────────────────────────────────
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
function png(f) {
  const b = readFileSync(f)
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${f} is not a PNG`)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colourType: b[25], bytes: b.length }
}
const plan = {}
for (const [dir, lang] of Object.entries(LANGS)) {
  plan[lang] = {}
  for (const [type, [where, W, H, min, max]] of Object.entries(SLOTS)) {
    const base = path.join(here, 'out', app, dir)
    const files = where.endsWith('.png') ? [path.join(base, where)]
      : existsSync(path.join(base, where)) ? readdirSync(path.join(base, where)).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(base, where, f)) : []
    if (files.length < min || files.length > max) throw new Error(`${app} ${lang} ${type}: ${files.length} files, Play takes ${min}–${max}`)
    for (const f of files) {
      const p = png(f)
      if (p.w !== W || p.h !== H) throw new Error(`${f} is ${p.w}×${p.h}, not ${W}×${H}`)
      if (p.colourType !== 2) throw new Error(`${f} has colour type ${p.colourType}: not an opaque 24-bit PNG`)
      if (p.bytes > 8e6) throw new Error(`${f} is ${(p.bytes / 1e6).toFixed(1)} MB; Play takes 8 MB`)
    }
    plan[lang][type] = files
  }
}

// ── API (as play.mjs) ─────────────────────────────────────────────────────
const KEYS = `${homedir()}/Bipolar_Keystores`
const KEY_PATH = process.env.PLAY_SA_KEY || (existsSync(KEYS) && readdirSync(KEYS).filter((f) => f.endsWith('.json')).map((f) => `${KEYS}/${f}`)[0])
if (!KEY_PATH) throw new Error('no Play service-account key: set PLAY_SA_KEY')
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/'
let accessToken
async function token() {
  if (accessToken) return accessToken
  const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'))
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key).toString('base64url')
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) })
  const j = await r.json()
  if (!j.access_token) throw new Error(`token: ${r.status} ${JSON.stringify(j)}`)
  return (accessToken = j.access_token)
}
async function api(method, p, { file } = {}) {
  const headers = { authorization: `Bearer ${await token()}` }
  let body
  if (file) { headers['content-type'] = 'image/png'; body = readFileSync(file) }
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(file ? `${UPLOAD}${p}?uploadType=media` : API + p, { method, headers, body })
    const text = await r.text()
    if (r.ok) return text ? JSON.parse(text) : {}
    // Play answers a burst of uploads with the odd 5xx / 429: wait and retry.
    if ((r.status >= 500 || r.status === 429) && attempt < 5) { await new Promise((s) => setTimeout(s, 2000 * attempt)); continue }
    throw new Error(`${method} ${p} → ${r.status}\n${text}`)
  }
}

async function readBack(e) {
  let bad = 0
  for (const [lang, slots] of Object.entries(plan)) {
    const line = []
    for (const [type, files] of Object.entries(slots)) {
      const { images = [] } = await api('GET', `${e}/listings/${lang}/${type}`)
      const want = files.map(sha), got = images.map((i) => i.sha256)
      const ok = want.length === got.length && want.every((s, i) => s === got[i])
      if (!ok) bad++
      line.push(`${type.replace('Screenshots', '')} ${got.length}${ok ? '' : ` ✗ (want ${want.length}, sha ${ok ? 'ok' : 'differs'})`}`)
    }
    console.log(`  ${lang.padEnd(6)} ${line.join(' · ')}`)
  }
  return bad
}

// ── Run ───────────────────────────────────────────────────────────────────
const n = Object.values(plan).reduce((a, s) => a + Object.values(s).reduce((b, f) => b + f.length, 0), 0)
console.log(`${PKG}: ${n} images in ${Object.keys(plan).length} languages, all checked (size, opaque, ≤ 8 MB)`)
const { id } = await api('POST', `${PKG}/edits`)
const e = `${PKG}/edits/${id}`
let committed = false
try {
  const { listings = [] } = await api('GET', `${e}/listings`)
  const have = new Set(listings.map((l) => l.language))
  const missing = Object.keys(plan).filter((l) => !have.has(l))
  if (missing.length) throw new Error(`no Play listing for ${missing.join(', ')}: add its text first (play.mjs text)`)
  if (VERIFY) {
    const bad = await readBack(e)
    console.log(bad ? `✗ ${bad} image lists differ from the local files` : '✓ every image list matches the local files')
  } else if (!APPLY) {
    for (const [lang, slots] of Object.entries(plan)) {
      const now = []
      for (const type of Object.keys(slots)) now.push(`${type.replace('Screenshots', '')} ${(await api('GET', `${e}/listings/${lang}/${type}`)).images?.length ?? 0}→${slots[type].length}`)
      console.log(`  ${lang.padEnd(6)} ${now.join(' · ')}`)
    }
    console.log('Dry run: edit discarded. Add --apply to upload and commit.')
  } else {
    for (const [lang, slots] of Object.entries(plan)) {
      for (const [type, files] of Object.entries(slots)) {
        // Replace, never append: a re-run must not stack a second set.
        await api('DELETE', `${e}/listings/${lang}/${type}`)
        for (const f of files) await api('POST', `${e}/listings/${lang}/${type}`, { file: f })
      }
      console.log(`  ${lang}: ${Object.entries(slots).map(([t, f]) => `${t.replace('Screenshots', '')} ${f.length}`).join(' · ')}`)
    }
    console.log('read back inside the edit:')
    const bad = await readBack(e)
    if (bad) throw new Error(`${bad} image lists differ after upload; not committing`)
    if (!unsent) await api('POST', `${e}:validate`)
    await api('POST', `${e}:commit${unsent ? '?changesNotSentForReview=true' : ''}`)
    committed = true
    console.log(`✅ committed${unsent ? ' (not sent for review: press "Send for review" in the Console)' : ', sent for review'}`)
  }
} finally {
  if (!committed) await api('DELETE', e).catch(() => {})
}
if (committed) {
  // A fresh edit sees what Play now holds.
  const { id: v } = await api('POST', `${PKG}/edits`)
  console.log('read back from the live listing:')
  const bad = await readBack(`${PKG}/edits/${v}`)
  await api('DELETE', `${PKG}/edits/${v}`).catch(() => {})
  console.log(bad ? `✗ ${bad} image lists differ` : '✓ every image list matches the local files')
  if (bad) process.exit(1)
}
