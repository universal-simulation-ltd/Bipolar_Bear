#!/usr/bin/env node
// Replace the iPhone 6.9" (APP_IPHONE_67) and iPad 13" (APP_IPAD_PRO_3GEN_129)
// screenshot sets of one App Store version, in every locale, with the renders
// of build-appstore-iphone.mjs and build-ipad-localized.mjs, in filename
// order, then read the counts back. Nothing is submitted.
//
//   node store-assets/asc-appstore-sets.mjs bear  [--apply] [--only de-DE,pl]
//   node store-assets/asc-appstore-sets.mjs anon  [--apply]
//
// Dry run without --apply: prints each set's count now and what would go up.
// A set whose images already match (same MD5s, same order) is left alone;
// the same images in another order are reordered without uploading.
// Uses the UNI·SIM store kit's App Store Connect client (Docs_UNI_SIM/store-kit/asc.mjs).
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { api, fetchRetry } from '../../Docs_UNI_SIM/store-kit/asc.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const APP = argv[0]
const APPLY = argv.includes('--apply')
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null
const APPS = {
  bear: { id: '6766637453', version: '1.43', iphone: 'out/appstore/iphone/bear', ipad: 'out/localized-ipad' },
  anon: { id: '6768005853', version: '1.41', iphone: 'out/appstore/iphone/anon', ipad: 'out/localized-ipad-anon' },
}
if (!APPS[APP]) { console.error('usage: asc-appstore-sets.mjs bear|anon [--apply] [--only <locales>]'); process.exit(1) }
const LOCALES = { 'en-GB': 'en', 'es-ES': 'es', 'fr-FR': 'fr', 'de-DE': 'de', it: 'it', 'pt-PT': 'pt', 'pt-BR': 'pt-BR',
  'nl-NL': 'nl', pl: 'pl', sv: 'sv', 'zh-Hans': 'zh' }
const TYPES = [['APP_IPHONE_67', 'iphone', 1290, 2796], ['APP_IPAD_PRO_3GEN_129', 'ipad', 2048, 2732]]
const md5 = (b) => createHash('md5').update(b).digest('hex')
const rel = (type, id) => ({ data: { type, id } })

// PNG: size from the IHDR, colour type 2 (RGB, no alpha).
function check(file, w, h) {
  const b = readFileSync(file)
  const ok = b.readUInt32BE(16) === w && b.readUInt32BE(20) === h && b[25] === 2
  if (!ok) throw new Error(`${file}: ${b.readUInt32BE(16)}×${b.readUInt32BE(20)} colour type ${b[25]}, wants ${w}×${h} RGB`)
  return b
}

const cfg = APPS[APP]
const ver = (await api('GET', `/v1/apps/${cfg.id}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${cfg.version}`)).data[0]
const state = ver.attributes.appVersionState || ver.attributes.appStoreState
console.log(`${APP} ${cfg.version} (${state}) — ${APPLY ? 'APPLYING' : 'DRY RUN'}`)
if (state !== 'PREPARE_FOR_SUBMISSION') throw new Error(`version is ${state}: not touching it`)
const locs = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations?limit=50`)).data

const summary = []
for (const [locale, lang] of Object.entries(LOCALES)) {
  if (ONLY && !ONLY.includes(locale)) continue
  const loc = locs.find((l) => l.attributes.locale === locale)
  if (!loc) { console.log(`${locale}: no localisation on ${cfg.version} — skipped`); summary.push([locale, 'missing']); continue }
  const sets = (await api('GET', `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`)).data
  const row = [locale]
  for (const [type, kind, w, h] of TYPES) {
    const dir = path.join(here, kind === 'iphone' ? cfg.iphone : cfg.ipad, lang)
    if (!existsSync(dir)) throw new Error(`no renders in ${dir}`)
    const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort()
    const bufs = files.map((f) => check(path.join(dir, f), w, h))
    const sums = bufs.map(md5)
    let set = sets.find((s) => s.attributes.screenshotDisplayType === type)
    const current = set ? (await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`)).data : []
    const bySum = new Map(current.map((s) => [s.attributes.sourceFileChecksum, s]))
    const same = current.length === sums.length && sums.every((s) => bySum.has(s))
    let what
    if (same && current.every((s, i) => s.attributes.sourceFileChecksum === sums[i])) what = 'up to date'
    else if (same) what = 'reorder'
    else what = `replace ${current.length} with ${files.length}`
    console.log(`${locale} ${type}: ${what}`)
    if (APPLY && what === 'reorder') {
      await api('PATCH', `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, { data: sums.map((s) => ({ type: 'appScreenshots', id: bySum.get(s).id })) })
    } else if (APPLY && what.startsWith('replace')) {
      if (!set) set = (await api('POST', '/v1/appScreenshotSets', { data: { type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: type }, relationships: { appStoreVersionLocalization: rel('appStoreVersionLocalizations', loc.id) } } })).data
      for (const s of current) await api('DELETE', `/v1/appScreenshots/${s.id}`)
      const ids = []
      for (let i = 0; i < files.length; i++) {
        const buf = bufs[i]
        const shot = (await api('POST', '/v1/appScreenshots', { data: { type: 'appScreenshots',
          attributes: { fileName: files[i], fileSize: buf.length }, relationships: { appScreenshotSet: rel('appScreenshotSets', set.id) } } })).data
        for (const op of shot.attributes.uploadOperations) {
          const headers = Object.fromEntries((op.requestHeaders || []).map((x) => [x.name, x.value]))
          const r = await fetchRetry(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) }, { tries: 3, ms: 120000 })
          if (!r.ok) throw new Error(`upload ${files[i]} → ${r.status}`)
        }
        await api('PATCH', `/v1/appScreenshots/${shot.id}`, { data: { type: 'appScreenshots', id: shot.id, attributes: { uploaded: true, sourceFileChecksum: sums[i] } } })
        ids.push(shot.id); process.stdout.write('.')
      }
      for (let t = 0; t < 80; t++) {
        const st = await Promise.all(ids.map(async (id) => (await api('GET', `/v1/appScreenshots/${id}`)).data.attributes.assetDeliveryState?.state))
        if (st.includes('FAILED')) throw new Error(`${locale} ${type}: processing FAILED`)
        if (st.every((s) => s === 'COMPLETE')) break
        await new Promise((r) => setTimeout(r, 3000))
      }
      await api('PATCH', `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, { data: ids.map((id) => ({ type: 'appScreenshots', id })) })
      console.log(' uploaded')
    }
    // Read back.
    const after = set ? (await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`)).data : []
    const matches = after.length === sums.length && after.every((s, i) => s.attributes.sourceFileChecksum === sums[i])
    row.push(`${kind} ${after.length}${matches ? ' ✓' : ' (differs from local)'}`)
  }
  summary.push(row)
}
console.log('\n' + summary.map((r) => r.join('  ')).join('\n'))
