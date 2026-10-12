// Render localised store screenshots from the English screen templates.
//
// For each locale it loads screens/<template>.html, resolves REPO/ tokens to the
// repo root, substitutes each English text node with its translation from
// screens_<lang>.json (whole-node match, so it never touches attributes or
// partial words), injects the --fit canvas var, and screenshots at the target
// device size with headless Chrome.
//
// This is the reusable UniSim render step: point it at a different template set
// + translation map + brand and it produces any app's localised set.
//
// Usage:  node build-localized.mjs [--android] [lang ...]   (default: all LANGS)
//         TRDIR=/path node build-localized.mjs fr
//
// --android mirrors build-all.mjs: renders at 2× (2160×3840) with the .android
// canvas class (enlarged below-the-phone decks) into out/localized-frames-android2x/;
// build-post-localized-android.py then downsizes to 1080×1920 + flattens to RGB.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const c = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try { for (const d of readdirSync(pw)) if (d.startsWith('chromium-')) {
    const p = path.join(pw, d, 'chrome-linux', 'chrome'); if (existsSync(p)) c.unshift(p); } } catch (_) {}
  for (const x of c) { try { if (existsSync(x)) return x; } catch (_) {} }
  throw new Error('No Chrome/Chromium found — set CHROME');
}
const CHROME = findChrome();
const REPO = pathToFileURL(path.resolve('..')).href + '/';
const TRDIR = process.env.TRDIR || 'screens-i18n';
const ALL = ['en','es','fr','de','it','pt','pt-BR','nl','pl','sv','zh'];
const ARGS = process.argv.slice(2);
const ANDROID = ARGS.includes('--android');
const LANG_ARGS = ARGS.filter(a => !a.startsWith('--'));
const LANGS = LANG_ARGS.length ? LANG_ARGS : ALL;

// screen output name -> source template (feature screens only; heroes handled elsewhere)
const SCREENS = {
  '03-patterns':    'screens/screen3-patterns.html',
  '04-sleep':       'screens/screen2-sleep.html',
  '05-survivalkit': 'screens/screen5-survivalkit.html',
  '06-pin':         'screens/screen6-pin.html',
  '07-anonymous':   'screens/screen4-anonymous.html',
  '08-steps':       'screens/screen-steps.html',
};

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-node substitution: > <ws> token <ws> <  →  keeps the surrounding
// whitespace (captured) so a space separating the node from a child element
// (e.g. `avg <b>2.3</b>`) is preserved, not swallowed.
function substitute(html, map) {
  // longest first so a longer node wins before any substring node
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const en of keys) {
    const tr = map[en];
    if (tr == null || tr === en) continue;
    const body = esc(en).replace(/\\ /g, ' ').replace(/ /g, '\\s+');
    const pat = new RegExp('>(\\s*)' + body + '(\\s*)<', 'g');
    html = html.replace(pat, (_, a, b) => '>' + a + tr + b + '<');
  }
  return html;
}

function render(builtPath, outPath, W, H) {
  spawnSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
    '--force-device-scale-factor=1', '--virtual-time-budget=8000',
    `--window-size=${W},${H}`, `--screenshot=${path.resolve(outPath)}`,
    pathToFileURL(path.resolve(builtPath)).href], { stdio: 'ignore' });
}

// target: render W, H, extra canvas class, output root
const [W, H, CLS, OUT] = ANDROID
  ? [2160, 3840, 'android', 'out/localized-frames-android2x']
  : [1290, 2796, '', 'out/localized-frames'];
const fit = Math.min(W / 1290, H / 2796);
let n = 0;
for (const lang of LANGS) {
  const map = JSON.parse(readFileSync(path.join(TRDIR, `screens_${lang}.json`), 'utf8'));
  const outDir = `${OUT}/${lang}`;
  mkdirSync(outDir, { recursive: true });
  for (const [name, tpl] of Object.entries(SCREENS)) {
    let html = readFileSync(tpl, 'utf8').replaceAll('REPO/', REPO)
      .replace('</head>', `<style>.canvas{--fit:${fit}}</style></head>`);
    if (CLS) html = html.replace('class="canvas ', `class="canvas ${CLS} `);
    html = substitute(html, map[name] || {});
    const built = `screens/_loc_${CLS || 'iphone'}_${lang}_${name}.built.html`;
    writeFileSync(built, html);
    render(built, path.join(outDir, `${name}.png`), W, H);
    rmSync(built);
    n++;
    console.log(`${lang}/${name}.png`);
  }
}
console.log(`rendered ${n} frames across ${LANGS.length} locale(s)`);
