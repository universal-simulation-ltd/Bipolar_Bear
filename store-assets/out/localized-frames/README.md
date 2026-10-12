# Localised branded store screenshots (finished set)

The full App Store / Play Store screenshot set — the two signature heroes plus
six feature screens — rendered in all 10 UI languages at the exact 6.9" iPhone
size (**1290×2796**).

```
out/localized-frames/<lang>/
  01-hero.png        White opener — "Every high. / Every low." (slanted phones)
  02-hero.png        Orange — "Track every mood in seconds" (mood faces)
                     ↑ 01 + 02 are ONE scene: the mood phone bridges the seam
  03-patterns.png    Spot your patterns (personalised insights)
  04-sleep.png       Sync sleep
  05-survivalkit.png Survival Kit
  06-pin.png         Full privacy (PIN + E2E encryption)
  07-anonymous.png   Share your thoughts (Anonymous peer board)
  08-steps.png       Sync steps
```
The filename number IS the store order (the upload scripts sort by name), and
`screens-i18n/screens_<lang>.json` is keyed by the same names.

`<lang>` ∈ en, es, fr, de, it, pt, nl, pl, sv, zh.

**Render on macOS.** The screens use emoji (👟 😴 🍺 …); macOS Chrome draws them
with Apple Color Emoji, as on an iPhone. Linux Chromium substitutes Noto /
monochrome glyphs — the first localised set went out like that and was re-rendered.

## How it's built (the reusable UniSim kit)

Two design layers, both regenerable from source:

1. **Heroes** (`build-hero-localized.mjs`) — the slanted-phone + crossover
   composition. Text comes from `screens-i18n/hero_strings.json`; the phones are
   the localised captures in `out/localized/<lang>/` (from `capture-localized.mjs`).
2. **Feature screens** (`build-localized.mjs`) — renders the hand-built
   `screens/*.html` mockups, substituting each English text node with its
   translation from `screens-i18n/screens_<lang>.json` (whole-node match, so
   attributes and partial words are never touched), then screenshots headless.

```bash
python3 -m http.server 8765          # from repo root (feature screens need it)
cd store-assets
node build-hero-localized.mjs        # → out/localized-frames/<lang>/01-,02-hero
node build-localized.mjs             # → out/localized-frames/<lang>/03-..08-
# one language:  node build-localized.mjs de
```

Chrome/Chromium is auto-detected (macOS / Windows / Linux). Translation data
lives in `screens-i18n/` — edit a string there and re-run to regenerate.

## Android (Play Store) set → `out/localized-frames-android/<lang>/`

Same 8 filenames, **1080×1920 (9:16), RGB**. Built by the same two scripts with
`--android`, then a Pillow post-step:

```bash
cd store-assets
node build-localized.mjs --android
node build-hero-localized.mjs --android
python3 build-post-localized-android.py
```

- `--android` renders at 2× (2160×3840) into `out/localized-frames-android2x/`
  (gitignored scratch). Feature screens get the `.android` canvas class
  (enlarged decks / chips / footnote), exactly like `build-all.mjs`.
- `build-post-localized-android.py` downsizes ÷2 (LANCZOS), flattens to RGB and
  deletes the scratch dir, same as `build-post.py`. Needs Pillow
  (`pip install Pillow`; macOS's system `/usr/bin/python3` already has it).
- One language: `node build-localized.mjs --android de` (+ the hero script with
  the same args), then the post step.
- No local server needed — everything loads over `file://`.
- Both scripts default to all 10 languages (en included) with or without the flag.

**Hero layout at 9:16.** The English `out/android/01-,02-hero.png` are the iPhone
heroes padded to 1398×2796 (1:2). This set lays the heroes out natively at 9:16
instead, so all 8 shots share one size: the stage keeps the iPhone height (2796)
and widens to 1572.75; the seam-spanning mood phone stays anchored to the seam
(same 250px slice on hero 1); everything else shifts right by
`DX = (W − 1290) / 2 ≈ 141` to re-centre; the headlines take the full width
(so de "Jede Stimmung erfassen" keeps its two lines); hero 2's mood faces fan
out wider (manic +1.5·DX). All of it lives in `build-hero-localized.mjs`
(`DX`, `FACE_SPREAD`, `faceLeft`) — iPhone output is unchanged (DX = 0).

## Reusing for another UniSim app

The layout (`build-hero-localized.mjs` SHELL + the feature scaffold in
`screens/shared.css`) is app-neutral. For a new app: swap the brand gradient +
wordmark, point the capture tool at that app, supply its `screens_*.json` +
`hero_strings.json`, and run the same two build steps.

## To do / notes

- **Android**: done — see the section above.
- **iPad + the Bipolar Anonymous app**: separate sets, same method.
- Translations are machine-generated; a native-speaker skim of the headlines is
  worth it before store submission (spot-checked de/fr/zh here — no overflow).
