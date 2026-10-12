// Push localised listings, phone screenshots and an app-bundle release to Google Play
// through the Google Play Developer API, as a service account. No dependencies (Node 18+).
//
// DRY RUN by default: opens an edit, prints what would change, then discards the edit.
// --apply commits the edit (Play then sends the changes for review).
//
//   PLAY_KEY=~/Bipolar_Keystores/<service-account>.json \
//   node play-upload.mjs --package com.bipolarbear.app --app bipolarbear \
//     [--listings] [--shots out/localized-frames-android] \
//     [--bundle /path/to/app-release.aab [--track production]]
//     [--promote <versionCode> [--track production]] [--apply]
//
// --listings  title + short description from screens-i18n/play_listings.json, full
//             description = the App Store copy in screens-i18n/listing_<app>.json, for
//             es-ES fr-FR de-DE it-IT pt-PT nl-NL pl-PL sv-SE zh-CN (en-GB is never touched)
// --shots     replaces each language's phone screenshots with <dir>/<lang>/*.png in
//             filename order; skipped when the sha256s already match. Unlike the
//             listings, this includes en-GB (from <dir>/en) when that folder exists
// --bundle    uploads the .aab and releases it on --track (default production) to 100%,
//             with the release notes from play_listings.json ("en" → en-GB)
// --promote   no upload: releases an already-uploaded versionCode (e.g. one tested on the
//             internal track) on --track at 100%, with the same release notes
// Everything happens in ONE edit, so a failure part-way leaves Play untouched.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash, sign } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i > -1 ? argv[i + 1] : undefined; };
const APPLY = argv.includes('--apply'), LISTINGS = argv.includes('--listings');
const PKG = arg('--package'), APP = arg('--app'), SHOTS = arg('--shots');
const BUNDLE = arg('--bundle'), PROMOTE = arg('--promote'), TRACK = arg('--track') || 'production';
const KEYFILE = process.env.PLAY_KEY?.replace(/^~/, os.homedir());
if (!PKG || !APP || !KEYFILE) {
  console.error('Needs --package --app (+ --listings / --shots / --bundle, --apply) and PLAY_KEY. See the header of this file.');
  process.exit(1);
}
const SA = JSON.parse(readFileSync(KEYFILE, 'utf8'));
const CFG = JSON.parse(readFileSync('screens-i18n/play_listings.json', 'utf8'))[APP];
const STORE = JSON.parse(readFileSync(`screens-i18n/listing_${APP}.json`, 'utf8'));

// listing key -> Play language code
const LANGS = { es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', 'pt-BR': 'pt-BR',
  nl: 'nl-NL', pl: 'pl-PL', sv: 'sv-SE', zh: 'zh-CN' };
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };
const NOTE_LIMIT = 500;

const listingFor = l => ({ language: LANGS[l], title: CFG.listing[l].title,
  shortDescription: CFG.listing[l].shortDescription, fullDescription: STORE[l].description });
const notes = Object.entries(CFG.releaseNotes)
  .map(([l, text]) => ({ language: l === 'en' ? 'en-GB' : LANGS[l], text }));

// ── validation (before touching anything) ────────────────────────────────
const problems = [];
for (const l of Object.keys(LANGS)) {
  const x = listingFor(l);
  for (const [f, max] of Object.entries(LIMITS))
    if (!x[f] || [...x[f]].length > max) problems.push(`${l}.${f} ${x[f] ? [...x[f]].length + ' chars > ' + max : 'missing'}`);
}
for (const n of notes) if ([...n.text].length > NOTE_LIMIT) problems.push(`release note ${n.language} > ${NOTE_LIMIT} chars`);
if (problems.length) { console.error('Over Play limits:\n  ' + problems.join('\n  ')); process.exit(1); }

// ── API plumbing ──────────────────────────────────────────────────────────
const b64u = b => Buffer.from(b).toString('base64url');
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: SA.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const jwt = `${h}.${p}.${b64u(sign('RSA-SHA256', Buffer.from(`${h}.${p}`), SA.private_key))}`;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`token → ${r.status} ${j.error_description || j.error}`);
  return j.access_token;
}
const TOK = await accessToken();
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PKG}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PKG}`;
async function call(method, url, { json, body, type } = {}) {
  const headers = { Authorization: `Bearer ${TOK}` };
  if (json) headers['Content-Type'] = 'application/json';
  if (type) headers['Content-Type'] = type;
  const r = await fetch(url, { method, headers, body: json ? JSON.stringify(json) : body });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`${method} ${url.split('/applications/')[1]} → ${r.status} ${j.error?.message || ''}`);
    e.status = r.status; throw e;
  }
  return j;
}
const orNull = p => p.catch(e => { if (e.status === 404) return null; throw e; });
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const short = v => JSON.stringify(v.length > 40 ? v.slice(0, 37) + '…' : v);

// ── one edit for everything ──────────────────────────────────────────────
const edit = await call('POST', `${API}/edits`);
const E = `${API}/edits/${edit.id}`, EU = `${UPLOAD}/edits/${edit.id}`;
console.log(`${PKG} — ${APPLY ? 'APPLYING' : 'DRY RUN'}\n`);
try {
  if (LISTINGS) for (const l of Object.keys(LANGS)) {
    const want = listingFor(l);
    const cur = await orNull(call('GET', `${E}/listings/${want.language}`));
    const diff = ['title', 'shortDescription', 'fullDescription'].filter(f => cur?.[f] !== want[f]);
    console.log(`${want.language}: listing ${!cur ? 'create' : diff.length ? 'update ' + diff.join(', ') : 'up to date'}` +
      (diff.length ? `  title=${short(want.title)} short=${short(want.shortDescription)}` : ''));
    if (diff.length && APPLY) await call('PUT', `${E}/listings/${want.language}`, { json: want });
  }

  if (SHOTS) for (const l of ['en', ...Object.keys(LANGS)]) {
    const lang = l === 'en' ? 'en-GB' : LANGS[l], dir = path.join(SHOTS, l);
    if (!existsSync(dir)) { console.log(`${lang}: no ${dir} — skipped`); continue; }
    const files = readdirSync(dir).filter(f => f.endsWith('.png')).sort().map(f => path.join(dir, f));
    const sums = files.map(f => sha256(readFileSync(f)));
    const cur = (await orNull(call('GET', `${E}/listings/${lang}/phoneScreenshots`)))?.images || [];
    if (cur.length === sums.length && cur.every((im, i) => im.sha256 === sums[i])) {
      console.log(`${lang}: ${files.length} screenshots already uploaded`); continue;
    }
    const reorder = cur.length === sums.length && [...sums].sort().join() === cur.map(im => im.sha256).sort().join();
    console.log(`${lang}: screenshots — ${reorder ? 'same images, new order:' : cur.length ? `replace ${cur.length} with` : 'upload'} ${files.length}`);
    if (!APPLY) continue;
    if (cur.length) await call('DELETE', `${E}/listings/${lang}/phoneScreenshots`);
    for (const f of files) await call('POST', `${EU}/listings/${lang}/phoneScreenshots?uploadType=media`,
      { body: readFileSync(f), type: 'image/png' });
  }

  if (PROMOTE) {
    const cur = await call('GET', `${E}/tracks/${TRACK}`);
    console.log(`promote: versionCode ${PROMOTE} → ${TRACK} at 100% as "${CFG.releaseName}", ` +
      `notes in ${notes.map(n => n.language).join(' ')}`);
    console.log(`  ${TRACK} now: ` + ((cur.releases || []).map(r => `${r.name} [${r.versionCodes}] ${r.status}`).join('; ') || 'empty'));
    if (APPLY) await call('PUT', `${E}/tracks/${TRACK}`, { json: { track: TRACK, releases: [{ name: CFG.releaseName,
      versionCodes: [String(PROMOTE)], status: 'completed', releaseNotes: notes }] } });
  }

  if (BUNDLE) {
    const aab = readFileSync(BUNDLE);
    const cur = await call('GET', `${E}/tracks/${TRACK}`);
    console.log(`bundle: ${(aab.length / 1e6).toFixed(1)} MB → ${TRACK} at 100% as "${CFG.releaseName}", ` +
      `notes in ${notes.map(n => n.language).join(' ')}`);
    console.log(`  ${TRACK} now: ` + ((cur.releases || []).map(r => `${r.name} [${r.versionCodes}] ${r.status}`).join('; ') || 'empty'));
    if (APPLY) {
      const up = await call('POST', `${EU}/bundles?uploadType=media`, { body: aab, type: 'application/octet-stream' });
      console.log(`  uploaded versionCode ${up.versionCode}`);
      await call('PUT', `${E}/tracks/${TRACK}`, { json: { track: TRACK, releases: [{ name: CFG.releaseName,
        versionCodes: [String(up.versionCode)], status: 'completed', releaseNotes: notes }] } });
    }
  }

  if (APPLY) { await call('POST', `${E}:commit`); console.log('\nCommitted — Play sends the changes for review.'); }
  else { await call('DELETE', E); console.log('\nDry run only — edit discarded. Re-run with --apply to write these changes.'); }
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  await call('DELETE', E).catch(() => {});
  console.error('Edit discarded — nothing changed on Play.');
  process.exit(1);
}
