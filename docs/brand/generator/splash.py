"""
Ink-drop impact on paper, simplified from splash physics:

  * Parent stain: an ellipse. For impact angle a (90 = straight down), width/length =
    sin(a) (the bloodstain-analysis relation), long axis along the direction of travel.
  * Rim fingering: the spreading lamella's rim breaks up by Rayleigh-Plateau (sets the
    wavelength / finger count) amplified by Rayleigh-Taylor (rim deceleration). Finger
    count scales roughly as N ~ We^1/2 Re^1/4 / (4*sqrt(3)).
  * Directional bias: at oblique impact the lamella travels further downstream, so
    fingers (spines) are longer on the side the drop was travelling toward.
  * Pinch-off: long fingers neck (Rayleigh-Plateau) and shed satellite droplets past
    their tips; satellites land at a shallow angle, so their stains are elongated
    radially (the "exclamation mark").
  * Edge scallops between fingers come from the same rim corrugation.

Rendered as a smooth implicit surface (compact metaballs) so joins look liquid.
"""
import math, random
import numpy as np
from skimage import measure

RES = 0.035
X0, X1, Y0, Y1 = 2, 62, -4, 27.5   # the dot's box; the i's stem starts at y=29

def kernel(d2):  # compact Wyvill kernel: blends only between near neighbours
    return np.where(d2 < 1, (1 - d2) ** 2, 0.0)

K = 1.75                              # support radius / visual radius
T = (1 - 1 / K ** 2) ** 2             # threshold: a lone ball renders at its radius

def render(blobs):
    xs = np.arange(X0, X1, RES); ys = np.arange(Y0, Y1, RES)
    X, Y = np.meshgrid(xs, ys)
    F = np.zeros_like(X)
    for (x, y, a, b, ang) in blobs:   # ellipse: semi-axes a (along ang), b
        c, s = math.cos(ang), math.sin(ang)
        u = (X - x) * c + (Y - y) * s
        v = -(X - x) * s + (Y - y) * c
        F += kernel((u / (a * K)) ** 2 + (v / (b * K)) ** 2)
    F[:, :2] = 0; F[:, -2:] = 0; F[:2, :] = 0; F[-2:, :] = 0
    paths = []
    for c in measure.find_contours(F, T):
        pts = [(X0 + p[1] * RES, Y0 + p[0] * RES) for p in c]
        step = max(1, len(pts) // 140)
        pts = pts[::step]
        if len(pts) < 5:
            continue
        n = len(pts); d = f"M{pts[0][0]:.2f} {pts[0][1]:.2f}"
        for i in range(n):
            p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
            c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
            c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
            d += f" C{c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}"
        paths.append(d + " Z")
    return paths

def splash(seed, impact_deg=70, travel_deg=-40, We=420, Re=3000, size=6.0, cx=32, cy=14.5,
           reach=1.0, pinch=0.55, satellites=1.0):
    rnd = random.Random(seed)
    alpha = math.radians(impact_deg); theta = math.radians(travel_deg)
    blobs = []
    # parent stain
    b = size; a = size / math.sin(alpha)
    blobs.append((cx, cy, a, b, theta))
    # rim fingers
    N = max(5, round((We ** 0.5) * (Re ** 0.25) / (4 * math.sqrt(3)) / 3.2))
    phase = rnd.uniform(0, 2 * math.pi)
    for i in range(N):
        phi = phase + 2 * math.pi * i / N + rnd.gauss(0, 0.18)
        # where the finger leaves the ellipse
        r_edge = 1 / math.sqrt((math.cos(phi - theta) / a) ** 2 + (math.sin(phi - theta) / b) ** 2)
        downstream = max(0.0, math.cos(phi - theta))
        bias = 0.35 + 1.25 * downstream ** 1.5 * (1 - math.sin(alpha) * 0.6)
        length = size * reach * bias * rnd.uniform(0.55, 1.25)
        w0 = size * rnd.uniform(0.15, 0.22)
        steps = max(4, int(length / (w0 * 0.55)))
        curve = rnd.gauss(0, 0.05)
        for k in range(steps + 1):
            t = k / steps
            r = r_edge * 0.8 + length * t
            ang = phi + curve * t
            w = w0 * (1 - 0.55 * t)
            blobs.append((cx + math.cos(ang) * r, cy + math.sin(ang) * r, w, w, 0))
        # bulb at the tip (rim mass collects there before pinching)
        tip_r = w0 * rnd.uniform(0.6, 0.85)
        tr = r_edge * 0.8 + length + tip_r * 0.4
        blobs.append((cx + math.cos(phi + curve) * tr, cy + math.sin(phi + curve) * tr, tip_r, tip_r, 0))
        # pinch-off: long fingers shed satellites past the tip, stretched radially
        if length > size * pinch and rnd.random() < 0.85 * satellites:
            gap = tip_r * rnd.uniform(1.6, 2.6) + length * 0.25
            sr = tip_r * rnd.uniform(0.55, 0.9)
            sd = tr + gap
            stretch = 1 + 0.9 * downstream
            blobs.append((cx + math.cos(phi) * sd, cy + math.sin(phi) * sd, sr * stretch, sr, phi))
            if downstream > 0.5 and rnd.random() < 0.6:
                sd2 = sd + sr * stretch * 2.4 + rnd.uniform(0.3, 1.0)
                sr2 = sr * 0.55
                blobs.append((cx + math.cos(phi) * sd2, cy + math.sin(phi) * sd2, sr2 * 1.3, sr2, phi))
    # rim scallops: small lobes between fingers
    for i in range(N):
        phi = phase + 2 * math.pi * (i + 0.5) / N
        r_edge = 1 / math.sqrt((math.cos(phi - theta) / a) ** 2 + (math.sin(phi - theta) / b) ** 2)
        lr = size * rnd.uniform(0.12, 0.19)
        blobs.append((cx + math.cos(phi) * (r_edge - lr * 0.2), cy + math.sin(phi) * (r_edge - lr * 0.2), lr, lr, 0))
    return blobs
