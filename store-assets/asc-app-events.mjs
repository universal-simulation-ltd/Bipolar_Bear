// World Bipolar Day In-App Event drafts (2026-11-02): node store-assets/asc-app-events.mjs 0|1
// (0 = Bipolar Bear, 1 = Bipolar Anonymous). Each run POSTs a NEW event: made once
// already (Bear 6829691851, Anonymous 6829691972), so edit those with PATCH instead.
// Limits: name 30, short 50, long 120. Territories are plain ids in territorySchedules.
import { api } from '/Users/jamesmarkey/Github/UNISIM/Docs_UNI_SIM/store-kit/asc.mjs'
const terr = (await api('GET', '/v1/territories?limit=200')).data.map(t => t.id)
const EV = [
  { app: '6766637453', ref: 'World Bipolar Day 2027', name: 'World Bipolar Day',
    short: 'A countdown to 30 March, and a sunflower theme',
    long: "From 25 March, Bipolar Bear counts down to World Bipolar Day, Van Gogh's birthday. On the day, it turns sunflower gold." },
  { app: '6768005853', ref: 'World Bipolar Day 2027', name: 'World Bipolar Day',
    short: 'Counting down to 30 March together',
    long: "From 25 March, the board counts down to World Bipolar Day, Van Gogh's birthday, a day to end the stigma." },
]
const only = process.argv[2]
if (!/^[01]$/.test(only ?? '')) { console.error('usage: node store-assets/asc-app-events.mjs 0|1'); process.exit(1) }
const e = EV[+only]
for (const [k, max] of [['name', 30], ['short', 50], ['long', 120]]) if (e[k].length > max) throw new Error(`${k} ${e[k].length} > ${max}`)
const ev = await api('POST', '/v1/appEvents', { data: { type: 'appEvents', attributes: {
  referenceName: e.ref, badge: 'SPECIAL_EVENT', primaryLocale: 'en-GB', priority: 'NORMAL', purpose: 'APPROPRIATE_FOR_ALL_USERS',
  purchaseRequirement: 'NO_COST_ASSOCIATED',
  territorySchedules: [{ territories: terr, publishStart: '2027-03-11T00:00:00Z', eventStart: '2027-03-25T00:00:00Z', eventEnd: '2027-03-31T00:00:00Z' }] },
  relationships: { app: { data: { type: 'apps', id: e.app } } } } })
console.log('event', ev.data.id, ev.data.attributes.eventState)
const loc = await api('POST', '/v1/appEventLocalizations', { data: { type: 'appEventLocalizations',
  attributes: { locale: 'en-GB', name: e.name, shortDescription: e.short, longDescription: e.long },
  relationships: { appEvent: { data: { type: 'appEvents', id: ev.data.id } } } } })
console.log('localization', loc.data.id)
