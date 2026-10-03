/**
 * Build the www-anonymous/ directory consumed by capacitor-anonymous.config.json.
 *
 * The repo root is the source of truth for both bundles. This script
 * copies the subset of files the standalone Bipolar Anonymous app needs,
 * renames the entry HTML + manifest to plain index.html / manifest.json
 * (so the Capacitor WebView can find them with no extra config), and
 * patches brand-config.js so BB.isAnonymousApp() returns true at runtime.
 *
 * Usage:
 *   node scripts/build-anonymous.js
 *
 * Then sync into the native project (separate from the BipolarBear one):
 *   rsync -av --delete ./www-anonymous/ ~/bipolaranonymous-native/www/
 *   cd ~/bipolaranonymous-native && npx cap sync
 *
 * The script is idempotent — it wipes www-anonymous/ on every run.
 *
 * @file scripts/build-anonymous.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT  = path.join(ROOT, 'www-anonymous');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function write(rel, contents) {
  const abs = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

function copy(rel, destRel) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source file: ${rel}`);
  }
  const dest = path.join(OUT, destRel || rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(rel, destRel) {
  const src  = path.join(ROOT, rel);
  const dest = path.join(OUT, destRel || rel);
  if (!fs.existsSync(src)) {
    throw new Error(`Missing source dir: ${rel}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const childRel     = path.join(rel,     entry.name);
    const childDestRel = path.join(destRel || rel, entry.name);
    if (entry.isDirectory()) copyDir(childRel, childDestRel);
    else                     copy(childRel, childDestRel);
  }
}

// ─── 1. Wipe ────────────────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ─── 2. Entry HTML ──────────────────────────────────────────────────
// Rename anonymous.html → index.html so Capacitor's WebView opens it on
// launch with no extra config. Patch the manifest reference at the same
// time so the in-page <link rel="manifest"> still resolves.
let html = read('anonymous.html');
const HTML_PATCHES = [
  ['href="manifest-anonymous.json"', 'href="manifest.json"'],
];
for (const [from, to] of HTML_PATCHES) {
  if (!html.includes(from)) {
    throw new Error(`anonymous.html no longer contains: ${from}`);
  }
  html = html.replace(from, to);
}
write('index.html', html);

// ─── 3. Manifest ────────────────────────────────────────────────────
// start_url moves from anonymous.html → index.html to match the rename.
const manifest = JSON.parse(read('manifest-anonymous.json'));
manifest.start_url = 'index.html';
write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

// ─── 4. CSS + fonts ─────────────────────────────────────────────────
copy('css/theme.css');
copy('css/anonymous.css');
copy('css/fonts.css');
copyDir('fonts');

// ─── 5. JS — page script + shared modules used by anonymous.html ────
// Note: js/shared/onboarding.js is intentionally excluded — it's only
// loaded by index.html and journal.html.
copy('js/anonymous.js');
const SHARED_MODULES = [
  'js/shared/platform.js',
  'js/shared/debug.js',
  'js/shared/brand-config.js',
  'js/shared/firebase-config.js',
  'js/shared/i18n.js',
  'js/shared/crisis.js',
  'js/shared/translate.js',
  'js/shared/medications.js',
  'js/shared/version-check.js',
  'js/shared/user-count.js',
  'js/shared/anon-push.js',
];
for (const f of SHARED_MODULES) copy(f);

// ─── 6. Brand-config patch ──────────────────────────────────────────
// Flip BB_BRAND.bundle to 'anonymous' so BB.isAnonymousApp() returns
// true in the native shell (where location.hostname is localhost and
// the existing domain check would miss).
const brandPath = path.join(OUT, 'js', 'shared', 'brand-config.js');
let brand = fs.readFileSync(brandPath, 'utf8');
const FROM = "bundle: 'main',";
const TO   = "bundle: 'anonymous',";
if (!brand.includes(FROM)) {
  throw new Error(
    `brand-config.js no longer contains "${FROM}" — update build-anonymous.js`
  );
}
brand = brand.replace(FROM, TO);
fs.writeFileSync(brandPath, brand);

// ─── 7. Icons ───────────────────────────────────────────────────────
// Whole directory: AppIcon.png is referenced by anonymous.html; the
// favicons subset is harmless to include and saves on surprise 404s
// from anything that probes /favicon.ico.
copyDir('icons');

// ─── 7a. Mood bears (small) ─────────────────────────────────────────
// The daily check-in on the greeting card uses Bipolar Bear's five mood
// bears; these are ~20 KB thumbnails of images/moods/*.png.
copyDir('images/moods/sm');

// ─── 7b. Wiki data ──────────────────────────────────────────────────
// JSON files fetched at runtime by the Wiki tab renderers in
// js/anonymous.js (renderWikiGroups / renderWikiWisdom).
copyDir('data');

// ─── 8. Done ────────────────────────────────────────────────────────
console.log(`Built ${OUT}`);
console.log('Next: rsync ./www-anonymous/ → ~/bipolaranonymous-native/www/');
console.log('      cd ~/bipolaranonymous-native && npx cap sync');
