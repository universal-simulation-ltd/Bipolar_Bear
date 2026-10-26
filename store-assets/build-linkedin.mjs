// Build the LinkedIn page assets. One page covers both apps, so every asset
// carries both: Bipolar Bear (orange) and Bipolar Anonymous (yellow).
//
//   out/linkedin/logo.png         400×400    page logo
//   out/linkedin/cover.png        1128×191   page cover (rendered @3x)
//   out/linkedin/post-square.png  1080×1080  intro post, feed square
//   out/linkedin/post-wide.png    1200×627   link / landscape post
//
// The logo is the text-free bear head on a tile split down the bear's own
// seam: orange for the journal, yellow for the community. The cover keeps its
// bottom-left corner empty, where LinkedIn lays the logo over it.
//
// Inputs: out/og-src/*.png (see build-og-cards.mjs) and ../images, ../icons.
//
//     cd store-assets && node build-linkedin.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const REPO = path.resolve('..');
const OUT = 'out/linkedin';

const url = p => pathToFileURL(path.resolve(p)).href;
const shot = f => url(path.join('out/og-src', f));
const mood = f => url(path.join(REPO, 'images/moods', f));
const BEAR = mood('stable.png');
const ANON_ICON = url(path.join(REPO, 'icons/AppIcon_anonymous.png'));

const render = (src, out, w, h, dsf = 1) => spawnSync(CHROME,
  ['--headless', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
   '--allow-file-access-from-files', `--force-device-scale-factor=${dsf}`,
   '--virtual-time-budget=9000', `--window-size=${w},${h}`,
   `--screenshot=${path.resolve(out)}`, url(src)], { stdio: 'ignore' });

// Same gradients as the og cards / store heroes.
const ORANGE = `radial-gradient(120% 90% at 30% -20%, #ffc266 0%, rgba(255,194,102,0) 60%),
  linear-gradient(160deg, #ffaa33 0%, #ff8833 42%, #ff6b00 100%)`;
const YELLOW = `radial-gradient(120% 90% at 70% -20%, #ffe680 0%, rgba(255,230,128,0) 60%),
  linear-gradient(160deg, #ffd84d 0%, #f5c800 50%, #e0b400 100%)`;

const page = (w, h, css, body) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<link rel="stylesheet" href="${url('fonts.css')}">
<style>
  *{ box-sizing:border-box; margin:0; padding:0; }
  html,body{ width:${w}px; height:${h}px; overflow:hidden; }
  .card{ position:relative; width:${w}px; height:${h}px; overflow:hidden;
    font-family:'Nunito','Segoe UI',system-ui,sans-serif;
    -webkit-font-smoothing:antialiased; text-rendering:geometricPrecision; }
  .orange{ background:${ORANGE}; }
  .yellow{ background:${YELLOW}; }
  .face img, img.face{ display:block; filter:drop-shadow(0 10px 16px rgba(110,45,0,.32)); }

  /* iPhone frame, as on the og cards */
  .phone{ position:absolute; padding:9px; border-radius:38px; background:#0b0b0d;
    box-shadow: 0 1px 0 1px rgba(255,255,255,.09) inset,
      0 40px 70px -20px rgba(40,16,0,.5), 0 14px 28px -12px rgba(0,0,0,.45); }
  .phone .scr{ position:relative; width:100%; border-radius:30px; overflow:hidden; line-height:0; }
  .phone .scr img{ width:calc(100% + 10px); margin:-5px; display:block; }
  .phone .isl{ position:absolute; top:7px; left:50%; transform:translateX(-50%);
    width:47px; height:13px; border-radius:8px; background:#08080a; z-index:5; }

  /* anonymous community avatar — initials in a coloured disc */
  .cav{ position:absolute; border-radius:50%; display:flex; align-items:center;
    justify-content:center; color:#fff; font-weight:800;
    font-family:'Segoe UI',system-ui,sans-serif; border:3px solid rgba(255,255,255,.92);
    box-shadow:0 12px 20px -8px rgba(90,60,0,.45); }
  ${css}
</style></head>
<body><div class="card">${body}</div></body></html>`;

const phone = (img, w, style, island) => `
  <div class="phone" style="width:${w}px;${style}">
    <div class="scr"><img src="${img}" alt="">${island ? '<div class="isl"></div>' : ''}</div>
  </div>`;

// gradients match the avatars on the anon store screens (build-anon-hero.mjs)
const AVATARS = {
  QO: 'linear-gradient(135deg,#ffb340,#e07800)',
  SS: 'linear-gradient(135deg,#81c784,#2e7d32)',
  BB: 'linear-gradient(135deg,#64b5f6,#1565c0)',
  JR: 'linear-gradient(135deg,#f48fb1,#c2185b)',
  NW: 'linear-gradient(135deg,#ce93d8,#7b1fa2)',
};
const avatar = (txt, size, style) =>
  `<div class="cav" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .4)}px;background:${AVATARS[txt]};${style}">${txt}</div>`;
const face = (file, size, style) =>
  `<img class="face" src="${mood(file)}" style="position:absolute;width:${size}px;${style}">`;

// ── Logo — 400×400 ────────────────────────────────────────────────────
//
// The bear's seam sits at x≈548 of its 1024 canvas, so the tile splits there
// too: the bear's orange half on the journal's orange, its brown half on the
// community's yellow.
const LOGO = 400, LOGO_BEAR = 318;
const seam = Math.round((LOGO - LOGO_BEAR) / 2 + LOGO_BEAR * 548 / 1024);
const logo = page(LOGO, LOGO, `
  .l{ position:absolute; top:0; bottom:0; left:0; width:${seam}px; }
  .r{ position:absolute; top:0; bottom:0; left:${seam}px; right:0; }
  .bear{ position:absolute; width:${LOGO_BEAR}px; left:${(LOGO - LOGO_BEAR) / 2}px; top:${(LOGO - LOGO_BEAR) / 2 + 6}px;
    filter:drop-shadow(0 12px 18px rgba(90,40,0,.35)); }
`, `
  <div class="l orange"></div><div class="r yellow"></div>
  <img class="bear" src="${BEAR}" alt="">
`);

// ── Cover — 1128×191 ──────────────────────────────────────────────────
//
// LinkedIn lays the logo over the bottom-left of the cover (and crops the
// sides on phones), so both lockups sit in from the edges and the bottom-left
// ~200×80 stays plain gradient.
const CW = 1128, CH = 191;
const cover = page(CW, CH, `
  .l{ position:absolute; inset:0; clip-path:polygon(0 0, 600px 0, 540px 100%, 0 100%); }
  .r{ position:absolute; inset:0; clip-path:polygon(600px 0, 100% 0, 100% 100%, 540px 100%); }
  .lock{ position:absolute; top:30px; display:flex; align-items:center; gap:16px; }
  .lock img{ width:92px; height:92px; display:block; }
  .name{ font-weight:900; font-size:34px; letter-spacing:-.015em; line-height:1; }
  .line{ font-weight:800; font-size:19px; line-height:1.25; margin-top:8px; }
  .bearside{ color:#fff; text-shadow:0 2px 10px rgba(140,55,0,.28); }
  .bearside .line{ color:rgba(255,255,255,.92); }
  .anonside{ color:#26201a; }
  .anonside .line{ color:#5c4a1e; }
  .anonside img{ border-radius:22px; }
`, `
  <div class="l orange"></div><div class="r yellow"></div>

  <div class="lock bearside" style="left:206px;">
    <img src="${BEAR}" alt="" style="filter:drop-shadow(0 8px 12px rgba(110,45,0,.34));">
    <div><div class="name">Bipolar Bear</div>
      <div class="line">Every high. Every low.<br>A private mood journal.</div></div>
  </div>
  ${face('depressed.png', 40, 'left:240px;top:136px;transform:rotate(-8deg);')}
  ${face('low.png',       42, 'left:300px;top:132px;transform:rotate(6deg);')}
  ${face('good.png',      44, 'left:362px;top:128px;transform:rotate(-5deg);')}
  ${face('elevated.png',  46, 'left:426px;top:124px;transform:rotate(7deg);')}
  ${face('manic.png',     48, 'left:492px;top:120px;transform:rotate(-6deg);')}

  <div class="lock anonside" style="left:644px;">
    <img src="${ANON_ICON}" alt="" style="box-shadow:0 8px 16px -4px rgba(90,60,0,.35);">
    <div><div class="name">Bipolar Anonymous</div>
      <div class="line">You're not alone.<br>An anonymous peer community.</div></div>
  </div>
  ${avatar('NW', 40, 'left:676px;top:136px;transform:rotate(7deg);')}
  ${avatar('JR', 42, 'left:736px;top:132px;transform:rotate(-6deg);')}
  ${avatar('BB', 44, 'left:798px;top:128px;transform:rotate(5deg);')}
  ${avatar('SS', 46, 'left:862px;top:124px;transform:rotate(-4deg);')}
  ${avatar('QO', 48, 'left:928px;top:120px;transform:rotate(6deg);')}
`);

// ── Posts — two halves, a phone each ──────────────────────────────────
const post = ({ w, h, headTop, headSize, panelTop, phoneW, phoneTop, copyTop, copySize, nameSize }) => page(w, h, `
  .top{ position:absolute; inset:0 0 auto 0; height:${panelTop}px; background:#fff; }
  .head{ position:absolute; left:0; right:0; top:${headTop}px; text-align:center;
    font-weight:900; font-size:${headSize}px; letter-spacing:-.025em; line-height:1.02; color:#26201a; }
  .head img{ width:${Math.round(headSize * 1.15)}px; vertical-align:-${Math.round(headSize * .2)}px; margin-right:${Math.round(headSize * .2)}px;
    filter:drop-shadow(0 6px 10px rgba(110,45,0,.3)); }
  .half{ position:absolute; top:${panelTop}px; bottom:0; width:${w / 2}px; overflow:hidden; }
  .copy{ position:absolute; left:0; right:0; top:${copyTop}px; text-align:center; padding:0 28px; }
  .copy .name{ font-weight:900; font-size:${nameSize}px; letter-spacing:-.015em; }
  .copy .tag{ font-weight:800; font-size:${copySize}px; line-height:1.3; margin-top:6px; }
  .bearside .copy{ color:#fff; text-shadow:0 2px 10px rgba(140,55,0,.28); }
  .anonside .copy{ color:#26201a; }
  .anonside .tag{ color:#5c4a1e; }
`, `
  <div class="top"></div>
  <div class="head"><img src="${BEAR}" alt="">Living with bipolar?</div>

  <div class="half orange bearside" style="left:0;">
    <div class="copy"><div class="name">Bipolar Bear</div>
      <div class="tag">A free, private mood journal.<br>Entries encrypted on your phone.</div></div>
    ${phone(shot('screen-mood.png'), phoneW, `left:${(w / 2 - phoneW) / 2}px;top:${phoneTop}px;transform:rotate(-4deg);`)}
  </div>
  <div class="half yellow anonside" style="left:${w / 2}px;">
    <div class="copy"><div class="name">Bipolar Anonymous</div>
      <div class="tag">A peer community for adults.<br>No names, no judgement.</div></div>
    ${phone(shot('screen-anon-feed.png'), phoneW, `left:${(w / 2 - phoneW) / 2}px;top:${phoneTop}px;transform:rotate(4deg);`)}
  </div>
`);

const square = post({ w: 1080, h: 1080, headTop: 50, headSize: 66, panelTop: 160,
  copyTop: 40, nameSize: 46, copySize: 25, phoneW: 330, phoneTop: 200 });
const wide = post({ w: 1200, h: 627, headTop: 30, headSize: 46, panelTop: 112,
  copyTop: 26, nameSize: 36, copySize: 20, phoneW: 230, phoneTop: 142 });

mkdirSync(OUT, { recursive: true });
for (const [name, html, w, h, dsf] of [
  ['logo', logo, LOGO, LOGO, 1],
  ['cover', cover, CW, CH, 3],
  ['post-square', square, 1080, 1080, 1],
  ['post-wide', wide, 1200, 627, 1],
]) {
  const built = `screens/_linkedin-${name}.built.html`;
  writeFileSync(built, html);
  render(built, path.join(OUT, `${name}.png`), w, h, dsf);
  rmSync(built, { force: true });
  console.log(`${OUT}/${name}.png  ${w * dsf}x${h * dsf}`);
}
