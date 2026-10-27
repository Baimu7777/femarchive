"""Rebuild the full WOFF2 font once, using fonttools and brotli.

Run: python scripts/compress-font.py
No subsetting: every character, outline, metric and layout table is retained.
The generated file is committed, so production builds do not need Python.
"""
from pathlib import Path
from fontTools.ttLib import TTFont, woff2

root = Path(__file__).resolve().parent.parent
source = root / 'static/fonts/霞鹜文楷.ttf'
output = root / 'static/fonts/lxgw-wenkai.woff2'

# Avoid expensive outline rewriting: use WOFF2's lossless Brotli container.
compress = woff2.brotli.compress
woff2.brotli.compress = lambda data, **kwargs: compress(data, quality=5, **kwargs)
font = TTFont(source, recalcBBoxes=False, recalcTimestamp=False)
font.flavor = 'woff2'
font.flavorData = woff2.WOFF2FlavorData(transformedTables=set())
font.save(output)

original = TTFont(source, recalcBBoxes=False, recalcTimestamp=False)
result = TTFont(output, recalcBBoxes=False, recalcTimestamp=False)
assert set(original.reader.keys()) == set(result.reader.keys())
for tag in original.reader.keys():
    left, right = original.reader[tag], result.reader[tag]
    if tag == 'head':
        # The container recalculates checkSumAdjustment and compression flags.
        left = left[:8] + left[12:16] + left[18:]
        right = right[:8] + right[12:16] + right[18:]
    assert left == right, f'Font table changed: {tag}'
print(f'Font tables verified: {source.stat().st_size} -> {output.stat().st_size} bytes')
