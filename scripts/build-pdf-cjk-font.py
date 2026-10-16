#!/usr/bin/env python3
"""Rebuild vendor/fonts/NotoSansSC-Regular.ttf, the font the journal and
survival-kit PDFs embed for Chinese (BB.loadPdfFont in js/shared/brand-config.js).

    /usr/bin/python3 -m pip install --user fonttools
    curl -L -o /tmp/NotoSansSC.ttf "https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
    /usr/bin/python3 scripts/build-pdf-cjk-font.py /tmp/NotoSansSC.ttf js/shared/i18n.js vendor/fonts/NotoSansSC-Regular.ttf

Noto Sans SC is under the SIL Open Font License 1.1 (vendor/fonts/OFL-NotoSansSC.txt).
The variable font is pinned to weight 400 and subset to GB2312 (6,763 hanzi and
its symbols), every character in the app's own strings, Latin incl. Extended A/B,
punctuation and the CJK / full-width forms. No hinting, no OpenType layout:
jsPDF uses none of it. ~2.3 MB, against ~17.8 MB for the full font.

The Latin PDF font (NotoSans-Regular/Bold/Italic.ttf) is the Noto Sans subset
the Assess products use (UNI_SIM_Assess, scripts/build-pdf-fonts.py).
"""
import sys, re, os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
src, i18n, out = sys.argv[1], sys.argv[2], sys.argv[3]
chars = set()
# GB2312: level 1 rows 0xB0-0xD7, level 2 rows 0xD8-0xF7; symbols rows 0xA1-0xA9
rows = list(range(0xA1, 0xAA)) + list(range(0xB0, 0xF8))
for r in rows:
    for c in range(0xA1, 0xFF):
        try: chars.add(bytes([r, c]).decode('gb2312'))
        except Exception: pass
# every character in the app's own strings (all languages), so labels always render
txt = open(i18n, encoding='utf-8').read()
chars.update(ch for ch in txt if ord(ch) > 0x7E)
f = TTFont(src)
f = instancer.instantiateVariableFont(f, {'wght': 400})
tmp = out + '.full.ttf'
f.save(tmp)
uni = ['U+0020-007E', 'U+00A0-024F', 'U+2000-206F', 'U+20A0-20C0', 'U+3000-303F', 'U+FF00-FFEF']
cps = sorted(set(ord(c) for c in chars))
with open(out + '.txt', 'w') as fh: fh.write(','.join('U+%04X' % c for c in cps))
subset.main([tmp, '--unicodes=' + ','.join(uni), '--unicodes-file=' + out + '.txt', '--no-hinting',
             '--layout-features=', '--name-IDs=*', '--name-languages=*', '--drop-tables+=BASE,VORG,vhea,vmtx,GDEF,GPOS,GSUB,STAT,DSIG',
             '--output-file=' + out])
os.remove(tmp); os.remove(out + '.txt')
print(out, os.path.getsize(out), 'chars', len(cps))
