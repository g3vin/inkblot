"""
generate.py — rebuild the Inkblot logo from its sources.

    pip install numpy scikit-image fonttools brotli
    python3 docs/brand/generator/generate.py

Writes src/ui/brandPaths.js (used by src/ui/Brand.jsx) and src/assets/brand/
{mark,wordmark,app-icon}.svg plus public/favicon.svg. The desktop and iOS icons are then
rasterised from app-icon.svg (see docs/design-handoff.md → Logo) and passed to
`npx tauri icon`.

The mark is the "ib monogram" chosen in the 2026 brand review: "ib" in Literata
ExtraBold (the app's editor face) with the i's dot replaced by an ink splash from
splash.py's model of a drop hitting paper. The wordmark is "inkblot" in Courier Prime
Bold with the same splash for its dot. All sizes below are per 1000 units of the em.
"""
import math
from pathlib import Path

import numpy as np
from fontTools.pens.basePen import BasePen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from skimage import measure
from skimage.draw import polygon as fill_polygon

from splash import splash

ROOT = Path(__file__).resolve().parents[3]
FONTS = ROOT / 'node_modules/@fontsource'
LITERATA = FONTS / 'literata/files/literata-latin-800-normal.woff'
COURIER = FONTS / 'courier-prime/files/courier-prime-latin-700-normal.woff'

# The splash (field units: y down, drop centred at 32,17).
SPLASH = dict(seed=5, impact_deg=88, travel_deg=-90, We=300, size=5.6, cx=32, cy=17,
              reach=0.6, satellites=0.4)
# The mark: dot width, gap above the x-height, and a nudge left so it clears the b's
# ascender at the monogram's tight i–b spacing.
MARK = dict(dot_width=360, dot_gap=40, dot_dx=-45, kern=-40)
ICON_SIZE = 41             # the mark's larger side, in the 64-unit tile
ICON_CENTRE = (32, 31.6)   # where its optical centre lands (a hair above the middle)
WORDMARK_DOT = dict(dot_width=330, dot_gap=55, dot_dx=0, kern=0)


# ── the splash as a metaball field over the whole tile ───────────────────────────────
RES = 0.06
XS = np.arange(-2, 66, RES)
YS = np.arange(-2, 66, RES)
GX, GY = np.meshgrid(XS, YS)
K = 1.75                              # support radius / visual radius (as splash.py)
T = (1 - 1 / K ** 2) ** 2             # threshold: a lone ball renders at its radius


def field(blobs):
    F = np.zeros_like(GX)
    for (x, y, a, b, ang) in blobs:
        r = max(a, b) * K
        i0, i1 = max(0, int((y - r + 2) / RES)), min(len(YS), int((y + r + 2) / RES) + 2)
        j0, j1 = max(0, int((x - r + 2) / RES)), min(len(XS), int((x + r + 2) / RES) + 2)
        if i0 >= i1 or j0 >= j1:
            continue
        sx, sy = GX[i0:i1, j0:j1], GY[i0:i1, j0:j1]
        c, s = math.cos(ang), math.sin(ang)
        u = (sx - x) * c + (sy - y) * s
        v = -(sx - x) * s + (sy - y) * c
        d2 = (u / (a * K)) ** 2 + (v / (b * K)) ** 2
        F[i0:i1, j0:j1] += np.where(d2 < 1, (1 - d2) ** 2, 0.0)
    F[:, :2] = 0; F[:, -2:] = 0; F[:2, :] = 0; F[-2:, :] = 0
    return F


def splash_contours(F):
    """Contours of the field as point lists (field units), resampled every 0.3 units."""
    out = []
    for c in measure.find_contours(F, T):
        pts = [(XS[0] + p[1] * RES, YS[0] + p[0] * RES) for p in c]
        keep = [pts[0]]
        for p in pts[1:]:
            if math.dist(p, keep[-1]) >= 0.3:
                keep.append(p)
        if len(keep) >= 6:
            out.append(keep)
    return out


def smooth_path(contours, xf, nd=2):
    """Closed Catmull-Rom curves through each contour, after mapping points with xf."""
    ds = []
    for pts in contours:
        pts = [xf(p) for p in pts]
        n = len(pts)
        d = f'M{pts[0][0]:.{nd}f} {pts[0][1]:.{nd}f}'
        for i in range(n):
            p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
            c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
            c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
            d += (f'C{c1[0]:.{nd}f} {c1[1]:.{nd}f} {c2[0]:.{nd}f} {c2[1]:.{nd}f} '
                  f'{p2[0]:.{nd}f} {p2[1]:.{nd}f}')
        ds.append(d + 'Z')
    return ''.join(ds)


SPLASH_FIELD = field(splash(**SPLASH))
SPLASH_CONTOURS = splash_contours(SPLASH_FIELD)
_ink = SPLASH_FIELD > T
_ys, _xs = np.nonzero(_ink)
SPLASH_BOX = (XS[_xs.min()], YS[_ys.min()], XS[_xs.max()], YS[_ys.max()])
# Centre the dot on the stem by its main blob, not its flung droplets.
_lab = measure.label(_ink)
_main = np.argmax(np.bincount(_lab.ravel())[1:]) + 1
SPLASH_CX = XS[np.nonzero(_lab == _main)[1]].mean()


# ── letters ──────────────────────────────────────────────────────────────────────────
class FlatPen(BasePen):
    """Flattens outlines to polygons (for measuring ink)."""
    def __init__(self, gs):
        super().__init__(gs)
        self.polys, self.cur = [], []
    def _moveTo(self, p):
        self.cur = [p]
    def _lineTo(self, p):
        p0 = self._getCurrentPoint()
        self.cur += [(p0[0] + (p[0] - p0[0]) * t, p0[1] + (p[1] - p0[1]) * t) for t in np.linspace(0, 1, 24)[1:]]
    def _curveToOne(self, a, b, c):
        p0 = self._getCurrentPoint()
        for t in np.linspace(0, 1, 16)[1:]:
            m = 1 - t
            self.cur.append((m**3*p0[0] + 3*m*m*t*a[0] + 3*m*t*t*b[0] + t**3*c[0],
                             m**3*p0[1] + 3*m*m*t*a[1] + 3*m*t*t*b[1] + t**3*c[1]))
    def _qCurveToOne(self, a, b):
        p0 = self._getCurrentPoint()
        for t in np.linspace(0, 1, 16)[1:]:
            m = 1 - t
            self.cur.append((m*m*p0[0] + 2*m*t*a[0] + t*t*b[0], m*m*p0[1] + 2*m*t*a[1] + t*t*b[1]))
    def _closePath(self):
        self.polys.append(self.cur); self.cur = []
    _endPath = _closePath


def glyph_contours(font, ch):
    gs, cmap = font.getGlyphSet(), font.getBestCmap()
    rec = DecomposingRecordingPen(gs)
    gs[cmap[ord(ch)]].draw(rec)
    cs, cur = [], []
    for op, args in rec.value:
        cur.append((op, args))
        if op in ('closePath', 'endPath'):
            cs.append(cur); cur = []
    return cs


def replay(contours, pen):
    for c in contours:
        for op, args in c:
            getattr(pen, op)(*args)


def word(font, text, dot):
    """`text` in font units (y up), every i's tittle swapped for the splash.
    Returns (letter contours placed by advance, splash point lists in font units)."""
    gs, cmap = font.getGlyphSet(), font.getBestCmap()
    em = font['head'].unitsPerEm / 1000
    xh = font['OS/2'].sxHeight
    letters, dots, adv = [], [], 0
    for ch in text:
        cs = glyph_contours(font, ch)
        if ch == 'i':
            cs = sorted(cs, key=lambda c: max(y for _, args in c for (_, y) in args))[:-1]
            flat = FlatPen(gs); replay(cs, flat)
            band = [x for poly in flat.polys for (x, y) in poly if 0.35 * xh < y < 0.65 * xh]
            stem_cx = adv + (min(band) + max(band)) / 2
            x0, _, x1, y1 = SPLASH_BOX
            s = dot['dot_width'] * em / (x1 - x0)
            tx = stem_cx + dot['dot_dx'] * em - SPLASH_CX * s
            ty = xh + dot['dot_gap'] * em + y1 * s
            dots += [[(tx + x * s, ty - y * s) for (x, y) in pts] for pts in SPLASH_CONTOURS]
        letters.append((adv, cs))
        adv += gs[cmap[ord(ch)]].width + dot['kern'] * em
    return letters, dots


def ink_polygons(font, letters, dots):
    polys = []
    for adv, cs in letters:
        flat = FlatPen(font.getGlyphSet())
        replay(cs, TransformPen(flat, (1, 0, 0, 1, adv, 0)))
        polys += flat.polys
    return polys + dots


def ink_stats(polys, step=2.0):
    """Bounding box and centre of weight of filled polygons (even-odd), in their units."""
    xs = np.concatenate([[p[0] for p in poly] for poly in polys])
    ys = np.concatenate([[p[1] for p in poly] for poly in polys])
    x0, y0 = xs.min() - step, ys.min() - step
    w, h = int((xs.max() - x0) / step) + 2, int((ys.max() - y0) / step) + 2
    mask = np.zeros((h, w), bool)
    for poly in polys:
        rr, cc = fill_polygon([(y - y0) / step for _, y in poly], [(x - x0) / step for x, _ in poly], (h, w))
        mask[rr, cc] ^= True
    r, c = np.nonzero(mask)
    box = (x0 + c.min() * step, y0 + r.min() * step, x0 + c.max() * step, y0 + r.max() * step)
    return box, (x0 + c.mean() * step, y0 + r.mean() * step)


def letters_path(font, letters, matrix, nd=2):
    trim = (lambda s: s.rstrip('0').rstrip('.')) if nd else (lambda s: s)
    pen = SVGPathPen(font.getGlyphSet(), ntos=lambda v: trim(f'{v:.{nd}f}'))
    a, b, c, d, e, f = matrix
    for adv, cs in letters:
        replay(cs, TransformPen(pen, (a, b, c, d, e + a * adv, f)))
    return pen.getCommands()


# ── the mark, in the 64-unit tile ────────────────────────────────────────────────────
literata = TTFont(str(LITERATA))
m_letters, m_dots = word(literata, 'ib', MARK)
(bx0, by0, bx1, by1), (cx, cy) = ink_stats(ink_polygons(literata, m_letters, m_dots))
scale = ICON_SIZE / max(bx1 - bx0, by1 - by0)
# Optical centre: halfway between the ink's box centre and its centre of weight.
ox = ((bx0 + bx1) / 2 + cx) / 2
oy = ((by0 + by1) / 2 + cy) / 2
to_tile = (scale, 0, 0, -scale, ICON_CENTRE[0] - ox * scale, ICON_CENTRE[1] + oy * scale)
tile_pt = lambda p: (to_tile[0] * p[0] + to_tile[4], to_tile[3] * p[1] + to_tile[5])
MARK_PATHS = [letters_path(literata, m_letters, to_tile), smooth_path(m_dots, tile_pt)]
# Square viewBox around the ink, for the mark on its own.
tx0, ty1 = tile_pt((bx0, by0)); tx1, ty0 = tile_pt((bx1, by1))
side = max(tx1 - tx0, ty1 - ty0) + 2
MARK_VIEWBOX = f'{(tx0 + tx1 - side) / 2:.2f} {(ty0 + ty1 - side) / 2:.2f} {side:.2f} {side:.2f}'

# ── the wordmark, in Courier Prime's units (y down) ──────────────────────────────────
courier = TTFont(str(COURIER))
w_letters, w_dots = word(courier, 'inkblot', WORDMARK_DOT)
(wx0, wy0, wx1, wy1), _ = ink_stats(ink_polygons(courier, w_letters, w_dots), step=4)
pad = 40 * courier['head'].unitsPerEm / 1000
flip = (1, 0, 0, -1, -(wx0 - pad), wy1 + pad)
WORDMARK = dict(
    viewBox=f'0 0 {wx1 - wx0 + 2 * pad:.0f} {wy1 - wy0 + 2 * pad:.0f}',
    paths=[letters_path(courier, w_letters, flip, nd=0),
           smooth_path(w_dots, lambda p: (p[0] + flip[4], -p[1] + flip[5]), nd=0)],
)

# ── write ────────────────────────────────────────────────────────────────────────────
import json  # noqa: E402

js = f"""/**
 * brandPaths.js — the Inkblot mark and wordmark as path data. Generated by
 * docs/brand/generator/generate.py (do not edit by hand): the letters are Literata
 * ExtraBold ("ib") and Courier Prime Bold ("inkblot") outlines, and each i's dot is an
 * ink splash from a model of a drop hitting paper.
 */

/** The mark: "ib" with an ink splash for the i's dot, placed in the 64×64 app-icon tile
 *  (optically centred). Paths: [letters, splash]. */
export const MARK_PATHS = {json.dumps(MARK_PATHS, indent=2)}

/** A square viewBox around the mark's ink, for the mark on its own. */
export const MARK_VIEWBOX = '{MARK_VIEWBOX}'

/** The wordmark: "inkblot" in Courier Prime Bold with the same splash for the i's dot.
 *  Paths: [letters, splash], y down. */
export const WORDMARK = {json.dumps(WORDMARK, indent=2)}
"""
(ROOT / 'src/ui/brandPaths.js').write_text(js)

paths = ''.join(f'<path d="{d}"/>' for d in MARK_PATHS)
brand = ROOT / 'src/assets/brand'
brand.mkdir(parents=True, exist_ok=True)
(brand / 'mark.svg').write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{MARK_VIEWBOX}" fill="#000" role="img" aria-label="Inkblot">{paths}</svg>\n')
icon = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Inkblot">'
        f'<rect width="64" height="64" rx="14" fill="#fff"/><g fill="#000">{paths}</g></svg>\n')
(brand / 'app-icon.svg').write_text(icon)
(ROOT / 'public/favicon.svg').write_text(icon)
(brand / 'wordmark.svg').write_text(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{WORDMARK["viewBox"]}" fill="#000" role="img" aria-label="inkblot">'
    + ''.join(f'<path d="{d}"/>' for d in WORDMARK['paths']) + '</svg>\n')
print('wrote brandPaths.js, mark.svg, wordmark.svg, app-icon.svg, favicon.svg')
