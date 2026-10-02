#!/usr/bin/env python3
"""Convert a capture run's PNGs into the committed WebP set.

    python3 docs/screenshots/convert-webp.py <png-dir> [quality=72]

Mirrors <png-dir>/<area>/<name>.png to docs/screenshots/<area>/<name>.webp (Pillow required) and
prints the total size. JSON audit files are copied as-is.
"""
import os
import shutil
import sys

from PIL import Image

src = sys.argv[1]
quality = int(sys.argv[2]) if len(sys.argv) > 2 else 72
dst = os.path.dirname(os.path.abspath(__file__))
total = 0
for root, _, files in os.walk(src):
    for f in files:
        rel = os.path.relpath(os.path.join(root, f), src)
        out_dir = os.path.join(dst, os.path.dirname(rel))
        os.makedirs(out_dir, exist_ok=True)
        if f.endswith('.png'):
            out = os.path.join(out_dir, f[:-4] + '.webp')
            Image.open(os.path.join(root, f)).convert('RGB').save(out, 'WEBP', quality=quality, method=6)
        elif f.endswith('.json'):
            out = os.path.join(out_dir, f)
            shutil.copyfile(os.path.join(root, f), out)
        else:
            continue
        total += os.path.getsize(out)
print(f'{total / 1e6:.2f} MB')
