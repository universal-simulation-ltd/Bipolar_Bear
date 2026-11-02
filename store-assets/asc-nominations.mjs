import { readFileSync } from 'node:fs'
import { api } from '/Users/jamesmarkey/Github/UNISIM/Docs_UNI_SIM/store-kit/asc.mjs'
// Texts: store-assets/nominations/*.txt (copied into nominations.md too).
// ⚠️ Running it again makes DUPLICATE drafts: PATCH /v1/nominations/<id> to edit.
// node store-assets/asc-nominations.mjs [index]   (0 = World Bipolar Day, 1 = Bear, 2 = Anonymous)
const D = new URL('./nominations/', import.meta.url).pathname
const t = f => readFileSync(D + f, 'utf8').trim()
const BEAR = '6766637453', ANON = '6768005853'
const noms = [
  { name: 'World Bipolar Day: Bipolar Bear and Bipolar Anonymous', type: 'NEW_CONTENT', description: t('wbd.txt'),
    publishStartDate: '2027-03-23T00:00:00Z', publishEndDate: '2027-03-31T23:59:00Z', apps: [BEAR, ANON], url: 'https://www.bipolarbear.app/' },
  { name: 'Bipolar Bear: a private mood journal for bipolar', type: 'APP_ENHANCEMENTS', description: t('bear.txt'),
    publishStartDate: '2026-11-23T00:00:00Z', apps: [BEAR], url: 'https://www.bipolarbear.app/' },
  { name: 'Bipolar Anonymous: peer support without names', type: 'APP_ENHANCEMENTS', description: t('anon.txt'),
    publishStartDate: '2026-11-23T00:00:00Z', apps: [ANON], url: 'https://www.bipolaranonymous.app/' },
]
const only = process.argv[2]
if (!/^[0-2]$/.test(only ?? '')) { console.error('usage: node store-assets/asc-nominations.mjs 0|1|2 (creates ONE draft)'); process.exit(1) }
for (const [i, n] of noms.entries()) {
  if (String(i) !== only) continue
  const attributes = { name: n.name, type: n.type, description: n.description, submitted: false,
    publishStartDate: n.publishStartDate, ...(n.publishEndDate && { publishEndDate: n.publishEndDate }),
    deviceFamilies: ['IPHONE', 'IPAD'], notes: t('notes.txt'), supplementalMaterialsUris: [n.url], hasInAppEvents: false }
  const r = await api('POST', '/v1/nominations', { data: { type: 'nominations', attributes,
    relationships: { relatedApps: { data: n.apps.map(id => ({ type: 'apps', id })) } } } })
  console.log('created', r.data.id, r.data.attributes.state, n.name)
}
