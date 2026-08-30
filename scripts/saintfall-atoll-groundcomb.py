#!/usr/bin/env python3
"""SAINTFALL - the GROUND COMB metric.

The instrument round 2 built for the water's corduroy, pointed at the ground.
Round 2's finding was that a slope field whose whole spectrum lies on ONE AXIS
reads as ruled at any jitter and any amplitude, and that the only fix is a
DIRECTIONAL SPREAD at the same slope budget.  It measured that by FFT of the
slope field on a square world grid and reported

    arc40  fraction of the annulus power inside the best 40-degree arc.
           An isotropic field scores 8/36 = 0.222.  A single ruled train
           scores 1.0.  The water went 0.629 -> 0.394.
    aniso  max angular bin / mean angular bin.  1.0 isotropic, >4 ruled.
           The water went 5.96 -> 2.21.

THE LADDER IS READ OUT OF atoll-art.js AT RUN TIME rather than copied here.  A
comb metric that measures last week's shader is worse than no metric, and the
whole value of the number is that it is the shipped field's number.

WHY THE SWEEP IS 36 PATCHES.  Three radii by twelve bearings: 420 m for the
lagoon flat and the Drowned Nave, 900 m for the ring beach, 1041 m for the reef
flat, which is where the bone-reef camera stands.  One patch on one bearing can
be lucky - the r7 field measured 0.98 on all thirty-six, and a spread has to
hold everywhere or it is a comb on the bearings it missed.  At 1041 m a 64 m
patch of a CONCENTRIC field is bent by 64/1041 = 3.5 degrees, which is to say a
concentric field that far out is a plane wave and the ring's curvature buys no
directional spread at all.  That is the whole of round 7's fault in one line.

  python3 scripts/saintfall-atoll-groundcomb.py
  python3 scripts/saintfall-atoll-groundcomb.py --legacy   # the r7 field
"""
import argparse
import math
import os
import re
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "assets", "js", "saintfall", "atoll-art.js")


# ---------------------------------------------------------------- shader read

def read_source():
    return open(ART, encoding="utf-8").read()


def read_wind(src):
    x = float(re.search(r"\n\s*x:\s*(-?[\d.]+),\s*\n\s*/\*\* Unit travel|"
                        r"x:\s*(-?[\d.]+),\s*\n\s*z:\s*(-?[\d.]+),", src).group(2))
    z = float(re.search(r"x:\s*(-?[\d.]+),\s*\n\s*z:\s*(-?[\d.]+),", src).group(2))
    return x, z


def read_trains(src):
    """The shipped ladder: lambda, deviation off the trade, weight."""
    out = []
    for m in re.finditer(r"lambda:\s*([\d.]+),\s*dev:\s*(-?\d+),\s*weight:\s*([\d.]+)", src):
        out.append((float(m.group(1)), float(m.group(2)), float(m.group(3))))
    return out


def read_scalar(src, name):
    return float(re.search(r"const\s+%s\s*=\s*([\d.]+)" % name, src).group(1))


def read_env(src):
    m = re.search(r"const\s+GREL_ENV\s*=\s*Object\.freeze\(\[([^\]]*)\]", src)
    return [float(v) for v in m.group(1).split(",")]


def read_near(src):
    """near start, near end, near boost from the sand spec, and the near damp."""
    i = src.index('add("sand"')
    blk = src[i:i + 900]
    b = [float(v) for v in re.search(r"\n\s*b:\s*\[([^\]]*)\]", blk).group(1).split(",")]
    c = [float(v) for v in re.search(r"\n\s*c:\s*\[([^\]]*)\]", blk).group(1).split(",")]
    return b[1], b[2], b[3], c[0]


# ------------------------------------------------------------- the GLSL field

def hash21(qx, qy):
    """sfHash21, bit for bit: fract(sin(dot(q, (127.1, 311.7))) * 43758.5453123).

    float32 in the shader and float64 here.  The sin-fract hash is chaotic, so
    the two do NOT produce the same numbers past a few digits - but the
    STATISTICS are identical, and this metric is a statistic.
    """
    return np.modf(np.sin(qx * 127.1 + qy * 311.7) * 43758.5453123)[0]


def noise21(qx, qy):
    ix, iy = np.floor(qx), np.floor(qy)
    fx, fy = qx - ix, qy - iy
    ux = fx * fx * (3.0 - 2.0 * fx)
    uy = fy * fy * (3.0 - 2.0 * fy)
    a = hash21(ix, iy)
    b = hash21(ix + 1.0, iy)
    c = hash21(ix, iy + 1.0)
    d = hash21(ix + 1.0, iy + 1.0)
    ab = a + (b - a) * ux
    return ab + ((c + (d - c) * ux) - ab) * uy


SF_ROT_A = (0.8534, -0.5213, 0.5213, 0.8534)


def rot_noise(rot, px, py, s, off=0.0):
    a, b, c, d = rot
    return noise21((a * px + b * py) * s + off, (c * px + d * py) * s + off)


def near_gate(dist, spec):
    """smoothstep(nearStart, nearEnd, dist), inverted. The shader's nearK."""
    d0, d1 = spec[0], spec[1]
    t = np.clip((dist - d0) / (d1 - d0), 0.0, 1.0)
    return 1.0 - t * t * (3.0 - 2.0 * t)


def field_spread(px, py, trains, wind, env, jitter, nearspec, dist):
    """The shipped six-train field, transcribed from the generated GLSL.

    The shader accumulates a VECTOR slope; this returns the scalar sum of the
    along-heading terms, which is the same quantity the water's probe FFT'd and
    the same one --legacy returns.  It is the CONSERVATIVE reading: collapsing
    six headings onto one scalar can only understate how isotropic the field is.
    """
    nk = near_gate(dist, nearspec)
    boost, damp = nearspec[2], nearspec[3]
    mlo = rot_noise(SF_ROT_A, px, py, 0.038) - 0.5
    wnorm = math.sqrt(sum(w * w for _, _, w in trains))
    out = np.zeros_like(px)
    for i, (lam, dev, w) in enumerate(trains):
        a = math.radians(dev)
        hx = wind[0] * math.cos(a) - wind[1] * math.sin(a)
        hy = wind[0] * math.sin(a) + wind[1] * math.cos(a)
        along = px * hx + py * hy
        side = py * hx - px * hy
        cm = 2.2 * lam
        nn = noise21(side / cm + 23.7 + i * 7.0, along / (4.0 * cm) + 23.7 + i * 7.0)
        e = env[0] + env[1] * nn
        ph = along * (2.0 * math.pi / lam) + mlo * (6.0 if lam < 2.0 else 2.6) \
            + i * 11.7 + (nn - 0.5) * jitter
        t = np.cos(ph)
        if lam < 1.0:
            t = t + 0.42 * np.cos(ph * 2.0)
        gate = 1.0 + boost * nk if lam <= 1.5 else (1.0 - damp * nk if lam >= 8.0 else 1.0)
        out = out + t * (GREL_BUDGET_CACHE * w / wnorm) * e * gate
    return out


def field_legacy(px, py, dist):
    """Round 7's three concentric trains, so the BEFORE number is reproducible.

    k and slope are the r7 shipped values (a: 10.134, 0.070, 1.745, 0.030 and
    b: 0.3307, 0.018), and every phase is a function of RADIUS alone, which is
    the defect: every wave vector on the level points along the radial.
    """
    nk = near_gate(dist, (4.0, 30.0, 1.15, 0.62))
    rr = np.sqrt(px * px + py * py) + 1e-4
    mlo = rot_noise(SF_ROT_A, px, py, 0.038) - 0.5
    mhi = rot_noise((0.3714, -0.9285, 0.9285, 0.3714), px, py, 0.232, 19.3) - 0.5
    e1 = 0.36 + 0.64 * np.clip(rot_noise((0.9755, -0.2198, 0.2198, 0.9755),
                                         px, py, 0.34, 7.1) * 1.55, 0.0, 1.0)
    e2 = 0.25 + 0.75 * np.clip((mhi + 0.5) * 1.5, 0.0, 1.0)
    e3 = 0.30 + 0.70 * np.clip((mlo + 0.5) * 1.5, 0.0, 1.0)
    ph1 = rr * 10.134 + mlo * 7.4 + mhi * 5.6
    ph2 = rr * 1.745 + mlo * 4.4 + mhi * 1.1
    ph3 = rr * 0.3307 + mlo * 2.6
    s = (np.cos(ph1) + 0.42 * np.cos(ph1 * 2.0)) * 0.070 * e1 * (1.0 + 1.15 * nk)
    s = s + np.cos(ph2) * 0.030 * e2
    s = s + np.cos(ph3) * 0.018 * e3 * (1.0 - 0.62 * nk)
    return s


# ------------------------------------------------------------------- the FFT

def comb_index(field):
    """arc40 / aniso / peak bearing of a square real field.

    The annulus keeps 4..0.40n cycles per patch, so the DC ramp and the
    sampling grid's own Nyquist corner are both outside it.
    """
    n = field.shape[0]
    f = field - field.mean()
    w = np.hanning(n)
    f = f * w[:, None] * w[None, :]
    F = np.fft.fftshift(np.fft.fft2(f))
    P = F.real ** 2 + F.imag ** 2
    fy = np.fft.fftshift(np.fft.fftfreq(n)) * n
    FY, FX = np.meshgrid(fy, fy, indexing="ij")
    R = np.sqrt(FY * FY + FX * FX)
    m = (R > 4) & (R < n * 0.40)
    ang = (np.degrees(np.arctan2(FY, FX)) + 180.0) % 180.0
    bins = np.array([P[m & (ang >= b * 5) & (ang < (b + 1) * 5)].sum()
                     for b in range(36)])
    tot = bins.sum()
    d = np.concatenate([bins, bins])
    arc = max(d[i:i + 8].sum() for i in range(36)) / tot
    return arc, bins.max() / bins.mean(), float(field.std())


def sweep(fn, radii, bearings, n, span):
    h = span * 0.5
    g = np.linspace(-h, h, n)
    rows = []
    for r in radii:
        for bd in bearings:
            b = math.radians(bd)
            cx, cy = r * math.sin(b), r * math.cos(b)
            PX, PY = np.meshgrid(cx + g, cy + g, indexing="ij")
            rows.append(comb_index(fn(PX, PY)))
    arc = np.array([x[0] for x in rows])
    ani = np.array([x[1] for x in rows])
    sd = np.array([x[2] for x in rows])
    return arc.mean(), arc.max(), ani.mean(), ani.max(), sd.mean()


GREL_BUDGET_CACHE = 0.0


def main():
    global GREL_BUDGET_CACHE
    ap = argparse.ArgumentParser()
    ap.add_argument("--legacy", action="store_true",
                    help="measure round 7's three concentric trains instead")
    ap.add_argument("--radii", default="420,900,1041")
    ap.add_argument("--bearings", type=int, default=12)
    ap.add_argument("--span", type=float, default=64.0, help="patch side, metres")
    ap.add_argument("--n", type=int, default=384)
    a = ap.parse_args()

    src = read_source()
    radii = [float(v) for v in a.radii.split(",")]
    bearings = list(range(0, 360, 360 // a.bearings))

    if a.legacy:
        label = "ROUND 7: three trains, one concentric heading"
        fn = lambda d: (lambda PX, PY: field_legacy(PX, PY, d))
    else:
        trains = read_trains(src)
        wind = read_wind(src)
        GREL_BUDGET_CACHE = read_scalar(src, "GREL_BUDGET")
        env = read_env(src)
        jitter = read_scalar(src, "GREL_JITTER")
        nearspec = read_near(src)
        label = "SHIPPED: %d trains on a spread about the trade" % len(trains)
        print("ladder   " + "  ".join("%.2fm/%+d/%.2f" % t for t in trains))
        print("wind     (%.4f, %.4f)   budget %.4f   env %s   jitter %.4f"
              % (wind[0], wind[1], GREL_BUDGET_CACHE, env, jitter))
        print("near     start %.1f m  end %.1f m  boost %.2f  damp %.2f" % nearspec)
        fn = lambda d: (lambda PX, PY: field_spread(PX, PY, trains, wind, env,
                                                    jitter, nearspec, d))

    print()
    print(label)
    print("%d patches: radii %s by %d bearings, %.0f m square, %d^2 samples"
          % (len(radii) * len(bearings), radii, len(bearings), a.span, a.n))
    print()
    print("%-10s %8s %8s %8s %8s %9s" % ("camera d", "arc40", "worst", "aniso",
                                         "worst", "slope sd"))
    for d in (6.0, 20.0, 40.0, 120.0):
        r = sweep(fn(d), radii, bearings, a.n, a.span)
        print("%-10.0f %8.3f %8.3f %8.2f %8.2f %9.4f" % ((d,) + r))
    print()
    print("isotropic reference      arc40 0.222   aniso 1.00")
    print("round 2 water, before    arc40 0.629   aniso 5.96")
    print("round 2 water, after     arc40 0.394   aniso 2.21")


if __name__ == "__main__":
    sys.exit(main())
