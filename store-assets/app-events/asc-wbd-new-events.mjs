// World Bipolar Day 2027: NEW In-App Events in all 11 store languages (James,
// 2026-11-26: "New events, all languages"). The two approved en-GB-only events
// (Bear 6829691851, Anonymous 6829691972) refuse new localizations, so these
// replace them in the nomination once Apple approves them. The old events are
// never edited or deleted here.
//
//   node store-assets/app-events/asc-wbd-new-events.mjs create   new events + en-GB text and images
//   WBD_EVENTS=wbd-new-ids.json node store-assets/app-events/asc-wbd-locales.mjs   the other 10 locales
//   node store-assets/app-events/asc-wbd-new-events.mjs submit   send both for App Review
//   node store-assets/app-events/asc-wbd-new-events.mjs status
//
// Each new event copies its old one's settings read from the API (badge,
// deep link, territories and dates, purpose, priority) under the reference
// name "World Bipolar Day 2027 (all languages)". The ids are kept in
// wbd-new-ids.json, so `create` never makes a second pair.
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { api } from '/Users/jamesmarkey/Github/UNISIM/Docs_UNI_SIM/store-kit/asc.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const IDS = path.join(HERE, 'wbd-new-ids.json');
const OLD = { bear: '6829691851', anon: '6829691972' };
const APP = { bear: '6766637453', anon: '6768005853' };
const REF = 'World Bipolar Day 2027 (all languages)';
const rel = (type, id) => ({ data: { type, id } });
const cmd = process.argv[2];

async function upload(locId, file, type) {
  const buf = readFileSync(file);
  const md5 = createHash('md5').update(buf).digest('hex');
  const r = await api('POST', '/v1/appEventScreenshots', { data: { type: 'appEventScreenshots',
    attributes: { fileName: path.basename(file), fileSize: statSync(file).size, appEventAssetType: type },
    relationships: { appEventLocalization: rel('appEventLocalizations', locId) } } });
  for (const op of r.data.attributes.uploadOperations) {
    const headers = Object.fromEntries((op.requestHeaders || []).map(h => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) });
    if (!res.ok) throw new Error(`upload part ${res.status}`);
  }
  await api('PATCH', `/v1/appEventScreenshots/${r.data.id}`, { data: { type: 'appEventScreenshots', id: r.data.id,
    attributes: { uploaded: true } } });
}

if (cmd === 'create') {
  const ids = existsSync(IDS) ? JSON.parse(readFileSync(IDS, 'utf8')) : {};
  for (const app of ['bear', 'anon']) {
    if (!ids[app]) {
      const old = (await api('GET', `/v1/appEvents/${OLD[app]}`)).data.attributes;
      const ev = await api('POST', '/v1/appEvents', { data: { type: 'appEvents', attributes: {
        referenceName: REF, badge: old.badge, deepLink: old.deepLink, primaryLocale: old.primaryLocale,
        priority: old.priority, purpose: old.purpose, purchaseRequirement: old.purchaseRequirement,
        territorySchedules: old.territorySchedules },
        relationships: { app: rel('apps', APP[app]) } } });
      ids[app] = ev.data.id;
      writeFileSync(IDS, JSON.stringify(ids, null, 2) + '\n');
      console.log(`${app}: new event ${ev.data.id} (${ev.data.attributes.eventState})`);
    }
    // en-GB: the old event's own text and the same two images.
    const oldEn = (await api('GET', `/v1/appEvents/${OLD[app]}/localizations?limit=50`)).data.find(l => l.attributes.locale === 'en-GB').attributes;
    const have = (await api('GET', `/v1/appEvents/${ids[app]}/localizations?limit=50`)).data;
    let en = have.find(l => l.attributes.locale === 'en-GB');
    const attrs = { name: oldEn.name, shortDescription: oldEn.shortDescription, longDescription: oldEn.longDescription };
    if (en) await api('PATCH', `/v1/appEventLocalizations/${en.id}`, { data: { type: 'appEventLocalizations', id: en.id, attributes: attrs } });
    else en = (await api('POST', '/v1/appEventLocalizations', { data: { type: 'appEventLocalizations',
      attributes: { locale: 'en-GB', ...attrs }, relationships: { appEvent: rel('appEvents', ids[app]) } } })).data;
    const shots = (await api('GET', `/v1/appEventLocalizations/${en.id}/appEventScreenshots?limit=10`)).data;
    for (const [type, kind] of [['EVENT_CARD', 'card'], ['EVENT_DETAILS_PAGE', 'details']]) {
      if (shots.some(x => x.attributes.appEventAssetType === type && x.attributes.assetDeliveryState?.state === 'COMPLETE')) continue;
      for (const x of shots.filter(x => x.attributes.appEventAssetType === type)) await api('DELETE', `/v1/appEventScreenshots/${x.id}`);
      await upload(en.id, path.join(HERE, 'wbd-2027', `${app}-${kind}.png`), type);
    }
    console.log(`${app} en-GB ✓`);
  }
} else if (cmd === 'status' || cmd === 'submit') {
  const ids = JSON.parse(readFileSync(IDS, 'utf8'));
  for (const app of ['bear', 'anon']) {
    const ev = (await api('GET', `/v1/appEvents/${ids[app]}`)).data.attributes;
    const locs = (await api('GET', `/v1/appEvents/${ids[app]}/localizations?include=appEventScreenshots&limit=50`));
    const done = (locs.included || []).filter(x => x.attributes.assetDeliveryState?.state === 'COMPLETE').length;
    console.log(`${app} ${ids[app]} ${ev.eventState}: ${locs.data.length} locales, ${done} images complete`);
    if (cmd !== 'submit') continue;
    if (ev.eventState !== 'DRAFT') { console.log('  not a draft, left alone'); continue; }
    if (locs.data.length !== 11 || done !== 22) throw new Error(`${app}: needs 11 locales and 22 images first`);
    // A fresh submission of its own: never ride along with anything else that is open.
    const open = (await api('GET', `/v1/reviewSubmissions?filter[app]=${APP[app]}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW,UNRESOLVED_ISSUES&limit=5`)).data;
    for (const o of open) {
      const items = (await api('GET', `/v1/reviewSubmissions/${o.id}/items?limit=20`)).data;
      if (items.length) throw new Error(`${app}: an open review submission ${o.id} already holds ${items.length} item(s); stopping`);
    }
    const sub = open[0] || (await api('POST', '/v1/reviewSubmissions', { data: { type: 'reviewSubmissions',
      attributes: { platform: 'IOS' }, relationships: { app: rel('apps', APP[app]) } } })).data;
    await api('POST', '/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems',
      relationships: { reviewSubmission: rel('reviewSubmissions', sub.id), appEvent: rel('appEvents', ids[app]) } } });
    await api('PATCH', `/v1/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } });
    const after = (await api('GET', `/v1/appEvents/${ids[app]}`)).data.attributes.eventState;
    console.log(`  submitted (${sub.id}) — now ${after}`);
  }
} else {
  console.error('usage: asc-wbd-new-events.mjs create | submit | status');
  process.exit(1);
}
