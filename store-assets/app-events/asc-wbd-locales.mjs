// World Bipolar Day In-App Events in every store language (2026-11-25).
// ⚠️ NOT RUN SUCCESSFULLY: both events were already APPROVED, and Apple refuses
// a new localization on an approved event (409 STATE_ERROR.ADD_LOCALIZATION_NOT_ALLOWED).
// Use it on a DRAFT event (e.g. new events made to replace these, or next year's)
// by pointing EVENTS at the new ids.
//   node store-assets/app-events/asc-wbd-locales.mjs            add the text + images
//   node store-assets/app-events/asc-wbd-locales.mjs --dry      lengths only
// Adds an appEventLocalization per locale (never touches en-GB) to the Bear and
// Anonymous events, then uploads that locale's EVENT_CARD + EVENT_DETAILS_PAGE
// from wbd-2027/<locale>/ (made by build-wbd-images.mjs). Idempotent: a locale
// that already exists is updated, an asset type already COMPLETE is skipped.
// Names follow the app's own wbdName (js/shared/i18n-awareness.js), shortened
// where Apple's 30-character limit needs it. Machine translations (no
// native-speaker pass); pt-BR in Brazilian Portuguese.
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { api } from '/Users/jamesmarkey/Github/UNISIM/Docs_UNI_SIM/store-kit/asc.mjs';

const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'wbd-2027');
// WBD_EVENTS=wbd-new-ids.json uses the new all-language events made by
// asc-wbd-new-events.mjs (2026-11-26); without it, the old approved ones.
const EVENTS = process.env.WBD_EVENTS
  ? JSON.parse(readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), process.env.WBD_EVENTS), 'utf8'))
  : { bear: '6829691851', anon: '6829691972' };

// [name ≤30, short ≤50, long ≤120] per app per locale.
const T = {
  'fr-FR': {
    bear: ['Journée mondiale bipolaire', 'Compte à rebours vers le 30 mars, en tournesol',
      "Dès le 25 mars, Bipolar Bear compte les jours jusqu'au 30, anniversaire de Van Gogh. Le jour J, il se pare d'or."],
    anon: ['Journée mondiale bipolaire', 'Ensemble jusqu’au 30 mars',
      "Dès le 25 mars, le forum compte les jours jusqu'au 30, anniversaire de Van Gogh : un jour pour en finir avec le stigma."],
  },
  'es-ES': {
    bear: ['Día Mundial de la Bipolaridad', 'Cuenta atrás al 30 de marzo, con girasoles',
      'Desde el 25 de marzo, Bipolar Bear cuenta los días hasta el 30, cumpleaños de Van Gogh. Ese día se viste de girasol.'],
    anon: ['Día Mundial de la Bipolaridad', 'Juntos hacia el 30 de marzo',
      'Desde el 25 de marzo, el tablón cuenta los días hasta el 30, cumpleaños de Van Gogh: un día para acabar con el estigma.'],
  },
  'de-DE': {
    bear: ['Welt-Bipolar-Tag', 'Countdown zum 30. März, im Sonnenblumen-Look',
      'Ab 25. März zählt Bipolar Bear die Tage bis zum Welt-Bipolar-Tag, Van Goghs Geburtstag. Am Tag selbst wird es golden.'],
    anon: ['Welt-Bipolar-Tag', 'Gemeinsam bis zum 30. März',
      'Ab dem 25. März zählt das Board die Tage bis zum Welt-Bipolar-Tag, Van Goghs Geburtstag: ein Tag gegen das Stigma.'],
  },
  it: {
    bear: ['Giornata mondiale bipolare', 'Conto alla rovescia al 30 marzo, coi girasoli',
      'Dal 25 marzo Bipolar Bear conta i giorni fino al 30, compleanno di Van Gogh. Quel giorno si veste di girasole.'],
    anon: ['Giornata mondiale bipolare', 'Insieme verso il 30 marzo',
      'Dal 25 marzo la bacheca conta i giorni fino al 30, compleanno di Van Gogh: un giorno per mettere fine allo stigma.'],
  },
  'pt-PT': {
    bear: ['Dia Mundial da Doença Bipolar', 'Contagem até 30 de março, com girassóis',
      'A partir de 25 de março, o Bipolar Bear conta os dias até 30, aniversário de Van Gogh. Nesse dia veste-se de girassol.'],
    anon: ['Dia Mundial da Doença Bipolar', 'Juntos até 30 de março',
      'A partir de 25 de março, o fórum conta os dias até 30, aniversário de Van Gogh: um dia para acabar com o estigma.'],
  },
  'pt-BR': {
    bear: ['Dia Mundial da Bipolaridade', 'Contagem até 30 de março, com girassóis',
      'A partir de 25 de março, o Bipolar Bear conta os dias até o dia 30, aniversário de Van Gogh. No dia, ele vira girassol.'],
    anon: ['Dia Mundial da Bipolaridade', 'Juntos até 30 de março',
      'A partir de 25 de março, o fórum conta os dias até o dia 30, aniversário de Van Gogh: um dia para acabar com o estigma.'],
  },
  'nl-NL': {
    bear: ['Wereld Bipolar Dag', 'Aftellen naar 30 maart, in zonnebloemstijl',
      'Vanaf 25 maart telt Bipolar Bear af naar Wereld Bipolar Dag, de verjaardag van Van Gogh. Op de dag zelf kleurt het goud.'],
    anon: ['Wereld Bipolar Dag', 'Samen aftellen naar 30 maart',
      'Vanaf 25 maart telt het forum af naar Wereld Bipolar Dag, de verjaardag van Van Gogh: een dag tegen het stigma.'],
  },
  pl: {
    bear: ['Światowy Dzień ChAD', 'Odliczanie do 30 marca, w słonecznikach',
      'Od 25 marca Bipolar Bear odlicza dni do 30 marca, urodzin Van Gogha. Tego dnia aplikacja staje się słonecznikowo złota.'],
    anon: ['Światowy Dzień ChAD', 'Razem do 30 marca',
      'Od 25 marca forum odlicza dni do 30 marca, urodzin Van Gogha: dnia, by skończyć ze stygmatyzacją.'],
  },
  sv: {
    bear: ['Världsbipolärdagen', 'Nedräkning till 30 mars, med solrostema',
      'Från 25 mars räknar Bipolar Bear ner till Världsbipolärdagen, Van Goghs födelsedag. På dagen blir appen solrosgul.'],
    anon: ['Världsbipolärdagen', 'Tillsammans mot 30 mars',
      'Från 25 mars räknar forumet ner till Världsbipolärdagen, Van Goghs födelsedag: en dag för att få slut på stigmat.'],
  },
  'zh-Hans': {
    bear: ['世界双相情感障碍日', '倒数到 3 月 30 日，还有向日葵主题',
      '从 3 月 25 日起，Bipolar Bear 倒数到世界双相情感障碍日，也就是梵高的生日。当天，应用会变成向日葵的金色。'],
    anon: ['世界双相情感障碍日', '一起倒数到 3 月 30 日',
      '从 3 月 25 日起，社区倒数到世界双相情感障碍日，也就是梵高的生日：一个消除污名的日子。'],
  },
};

const DRY = process.argv.includes('--dry');
const over = [];
for (const [loc, apps] of Object.entries(T)) for (const [app, [n, s, l]] of Object.entries(apps)) {
  for (const [what, v, max] of [['name', n, 30], ['short', s, 50], ['long', l, 120]])
    if ([...v].length > max) over.push(`${loc} ${app} ${what} ${[...v].length} > ${max}: ${v}`);
}
if (over.length) { console.error(over.join('\n')); process.exit(1); }
console.log('lengths ok');
if (DRY) process.exit(0);

async function upload(locId, file, type) {
  const buf = readFileSync(file);
  const md5 = createHash('md5').update(buf).digest('hex');
  const r = await api('POST', '/v1/appEventScreenshots', { data: { type: 'appEventScreenshots',
    attributes: { fileName: path.basename(file), fileSize: statSync(file).size, appEventAssetType: type },
    relationships: { appEventLocalization: { data: { type: 'appEventLocalizations', id: locId } } } } });
  for (const op of r.data.attributes.uploadOperations) {
    const headers = Object.fromEntries((op.requestHeaders || []).map(h => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) });
    if (!res.ok) throw new Error(`upload part ${res.status}`);
  }
  await api('PATCH', `/v1/appEventScreenshots/${r.data.id}`, { data: { type: 'appEventScreenshots', id: r.data.id,
    attributes: { uploaded: true, sourceFileChecksum: md5 } } });
  return r.data.id;
}

for (const [app, ev] of Object.entries(EVENTS)) {
  const existing = (await api('GET', `/v1/appEvents/${ev}/localizations?limit=50`)).data;
  for (const [loc, apps] of Object.entries(T)) {
    const [name, shortDescription, longDescription] = apps[app];
    let l = existing.find(x => x.attributes.locale === loc);
    if (l) await api('PATCH', `/v1/appEventLocalizations/${l.id}`, { data: { type: 'appEventLocalizations', id: l.id, attributes: { name, shortDescription, longDescription } } });
    else l = (await api('POST', '/v1/appEventLocalizations', { data: { type: 'appEventLocalizations',
      attributes: { locale: loc, name, shortDescription, longDescription },
      relationships: { appEvent: { data: { type: 'appEvents', id: ev } } } } })).data;
    const have = (await api('GET', `/v1/appEventLocalizations/${l.id}/appEventScreenshots?limit=10`)).data;
    for (const [type, kind] of [['EVENT_CARD', 'card'], ['EVENT_DETAILS_PAGE', 'details']]) {
      const done = have.find(x => x.attributes.appEventAssetType === type && x.attributes.assetDeliveryState?.state === 'COMPLETE');
      if (done) continue;
      for (const x of have.filter(x => x.attributes.appEventAssetType === type)) await api('DELETE', `/v1/appEventScreenshots/${x.id}`);
      await upload(l.id, path.join(DIR, loc, `${app}-${kind}.png`), type);
    }
    console.log(`${app} ${loc} ✓`);
  }
}
