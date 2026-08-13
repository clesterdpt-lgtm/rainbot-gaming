#!/usr/bin/env python3
"""Build the Distaff: SAINTFALL's Glass Scar guardian.

    blender --background --factory-startup \
      --python scripts/blender/saintfall-distaff.py -- \
      --output assets/models/saintfall/source/distaff.raw.glb \
      --report output/saintfall/models/distaff.json

NOT THE BLOOM

Every other boss on Vesper-IX is xenos: violet chitin, a cyan lamp,
one hive. The Distaff predates the Bloom and does not belong to it -
it is the thing the Glass Scar's crater made when an orbital strike
vitrified a kilometre of sand and something old enough to survive that
came up out of the glass afterward. So it is painted from the crater's
own palette, not the hive's: the same near-black teal the fulgurite
spires and the vitrified ground already carry (`GLASS_RAMP` in
art.js), with the same cold cyan-teal for every lit surface where the
rest of the bestiary would run violet-and-cyan bio-glow. A player who
has learned "chitin plus cyan lamp means Bloom" should look at this
thing and read, correctly, that it is not.

TALL, NOT LONG

The Matriarch owns LONG AND REARED - nine metres of animal laid on the
ground with the front third lifted. The Distaff cannot repeat that
shape and still be its own silhouette, so it owns the opposite axis:
a compact body carried HIGH on eight splayed legs, knees flared above
its own back, so the whole animal reads as a dome standing on stilts
rather than as a beast lying along the sand. The legs are the
silhouette here the way the fold is the Matriarch's - not decoration,
the entire point.

THE FIGHT IS UNDERNEATH IT

Nothing this tall can be reached by a two-and-three-quarter-metre
lance while it is standing, and it is not supposed to be: the belly
is over nine metres up. Eight legs are the ONLY thing in range, and
each one is its own target - the runtime tracks health per leg and
drops the whole animal into a crouch once enough of them are broken,
which is the one time its abdomen and prosoma come low enough to
reach at all. The fight is legs first, always; the body is a reward
for winning that fight, not a second way to fight it.

THE ABDOMEN IS UNSEGMENTED ON PURPOSE

The Matriarch's gaster is nine armoured plates because it carries
brood and the plates ARE the read. This animal carries nothing - the
opisthosoma is one smooth vitrified sac, cracked through with lit
veins rather than jointed into segments, because a spider's abdomen
does not segment and pretending otherwise would borrow the Matriarch's
identity along with her leg count.
"""

from __future__ import annotations

import argparse
import importlib.util
import math
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import bpy
from mathutils import Vector

_KIT = Path(__file__).resolve().parent / "saintfall-kit.py"
_spec = importlib.util.spec_from_file_location("saintfall_kit", _KIT)
kit = importlib.util.module_from_spec(_spec)
sys.modules["saintfall_kit"] = kit
_spec.loader.exec_module(kit)

Ring, Part = kit.Ring, kit.Part
TAU = kit.TAU
PI = math.pi

# --------------------------------------------------------------------
# THE CRATER'S OWN PALETTE, not the hive's.
#
# Lifted straight off `GLASS_RAMP`/`P.glass*` in art.js so the animal
# is provably cut from the same cloth as the ground it stands on
# rather than eyeballed to look similar. `GLASS_CHITIN` plays the role
# `CHITIN_DEEP` plays for the Matriarch - the base carapace ramp - and
# `GLASS_GLOW`/`GLASS_EDGE` replace `BIO_VIOLET`/`BIO_CYAN` as the one
# lit colour the whole animal is allowed.
# --------------------------------------------------------------------
GLASS_CHITIN = kit.Ramp([
    (0.00, "#050c0f"), (0.26, "#0e2229"), (0.55, "#17414a"),
    (0.80, "#2c6b72"), (1.00, "#5fb0ac"),
])
GLASS_GLOW = "#3f8f92"
GLASS_EDGE = "#79e2d4"
GLASS_PALE = "#bff5ec"
GLASS_DIM = "#164b48"


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--report", type=Path)
    p.add_argument("--save-blend", type=Path)
    return p.parse_args(argv)


# ----------------------------------------------------------------------
# proportions
#
# Authored 1:1 in metres, Y-up, +Z forward. Standing height is carried
# by the LEGS, not the body: the prosoma sits at 8.6-10.7m and the
# knees flare a metre and a half higher again, above its own back,
# which is what a real tarantula's stance does and an insect's does
# not - and it is the whole reason a trooper can walk underneath it.
# ----------------------------------------------------------------------

PEDICEL = Vector((0.0, 8.55, -1.55))       # where the abdomen hangs off
PROSOMA_CREST = Vector((0.0, 10.70, 0.60))  # top of the carapace hump
HEAD_BASE = Vector((0.0, 9.70, 1.65))
HEAD_TIP = Vector((0.0, 8.85, 2.75))
ABDOMEN_TIP = Vector((0.0, 12.05, -9.35))

# Splayed WIDE and carried HIGH. The front and rear pairs angle out
# and along the body axis, the same way a real spider's do, so the
# eight feet describe a broad oval rather than a ring - a ring reads
# as a machine standing on a turntable, an oval reads as an animal
# that is actually braced.
LEG_RIG = (
    {"hip": (1.95, 8.75, 1.35), "knee": (7.40, 12.00, 3.70), "foot": (12.20, 0.0, 6.10)},
    {"hip": (2.15, 8.85, 0.35), "knee": (8.00, 12.40, 1.30), "foot": (13.00, 0.0, 2.10)},
    {"hip": (2.15, 8.85, -0.75), "knee": (8.00, 12.40, -1.30), "foot": (13.00, 0.0, -2.10)},
    {"hip": (1.95, 8.75, -1.75), "knee": (7.40, 12.00, -3.70), "foot": (12.20, 0.0, -6.10)},
)


def leg_names(side: str, i: int) -> tuple[str, str, str]:
    return (f"coxa{i}_{side}", f"femur{i}_{side}", f"tibia{i}_{side}")


def mirror(p, sx: float) -> Vector:
    return Vector((p[0] * sx, p[1], p[2]))


def spike(a, b, r0=0.05, r1=0.006, sides=5, bow=None, seed=1):
    a, b = Vector(a), Vector(b)
    pts = kit.arc_path(a, b, bow, n=3) if bow else [a, a.lerp(b, 0.5), b]
    return kit.tube(pts, [r0, (r0 + r1) * 0.55, r1], sides=sides,
                    mode="transport", seed=seed, cap_end=False)


def glass_t(params, base=0.26, span=0.58, power=1.0, along=0.0, glow=0.0):
    return kit.paint_t(
        params, GLASS_CHITIN,
        lambda t, a, u: base + span * kit.topside(u, power) + along * t,
        glow=glow,
    )


def add(parts, name, bone, built, colors):
    parts.append(Part(name, bone, built[0], built[1], colors))


def prosoma_path():
    return kit.bezier(PEDICEL, (0.0, 9.30, -0.90), (0.0, 10.50, 0.0),
                      PROSOMA_CREST, n=6)


def prosoma_radii():
    # Fullest where the eight legs actually load into it, tapering
    # toward the pedicel and toward the crest. Bulked from the first
    # pass: against legs this thick a lean body read as a head on
    # stilts rather than as the mass the legs are carrying.
    return [(1.50, 1.72), (1.86, 2.12), (2.14, 2.36), (2.05, 2.28),
            (1.70, 1.88), (1.26, 1.40), (0.92, 1.03)]


def gaster_path():
    """One smooth arc from the pedicel to the spinnerets. No segments -
    real opisthosomas do not have them, and pretending otherwise would
    borrow the Matriarch's own identity along with her plate count."""
    return kit.bezier(PEDICEL, (0.0, 10.60, -3.10), (0.0, 11.70, -6.60),
                      ABDOMEN_TIP, n=13)


def gaster_radius(t: float) -> float:
    # A full, bulbous sac - the single largest single mass on the
    # animal, and the one part of it with no armour at all.
    return 0.38 + 2.55 * math.sin(min(1.0, t * 1.04) ** 0.60 * PI) ** 0.55


# ----------------------------------------------------------------------
# geometry
# ----------------------------------------------------------------------

def build_prosoma(parts) -> None:
    path = prosoma_path()
    radii = prosoma_radii()

    v, f, p = kit.tube(path, radii, sides=11, mode="up", phase=0.12,
                       profile=kit.flutes(11, 0.03))
    add(parts, "prosoma", "prosoma", (v, f), glass_t(p, 0.12, 0.46, 1.3))

    # The carapace shield: a single lifted plate over the whole hump,
    # not a row of tergites - one continuous shell is what makes the
    # body read as CARRIED rather than jointed the way the legs are.
    v, f, p = kit.shell(path, radii, arc=(-0.33, 0.33), steps=9,
                        thick=0.07, lift=0.05,
                        profile=lambda t, u: 1.0 + 0.10 * (1.0 - t) ** 2)
    add(parts, "carapace", "prosoma", (v, f), glass_t(p, 0.22, 0.60, 1.2))

    # The lit seam the shield leaves down each flank - the largest
    # single piece of surface information on the animal at rest.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        a0 = 0.335 * sx
        v, f, p = kit.shell(path, radii, arc=(a0, a0 + 0.05 * sx), steps=3,
                            thick=0.018, lift=0.010)
        add(parts, f"prosomaseam_{side}", "prosoma", (v, f),
            kit.paint_t(p, kit.Ramp([(0.0, GLASS_DIM), (0.5, GLASS_GLOW), (1.0, GLASS_PALE)]),
                        lambda t, a, u: 0.20 + 0.55 * math.sin(t * PI),
                        glow=lambda t, a, u: kit.GLOW_SEAM * (0.4 + 0.6 * math.sin(t * PI))))

    # Tubercles scattered over the crest - small, irregular, faceted
    # bumps that break a big dome up into something that reads as a
    # carapace rather than a helmet.
    bumps = ((0.30, 0.62, 0.16), (-0.34, 0.58, -0.10), (0.18, 0.44, 0.56),
             (-0.20, 0.42, 0.50), (0.0, 0.70, -0.40), (0.44, 0.36, -0.30))
    for k, (bx, bt, bz) in enumerate(bumps):
        i = int(bt * (len(path) - 1))
        c = path[i]
        r = 0.15 + 0.05 * (k % 3)
        v, f = kit.blob(r, sides=6, rings=2, squash=0.7, seed=131 + k)
        cx = c.x + bx * (radii[i][0] * 1.02)
        v = kit.transform(v, translate=(cx, c.y + 0.04, c.z + bz * 0.5))
        add(parts, f"tubercle{k}", "prosoma", (v, f), glass_t(
            [(0.5, 0.5, 1.0) for _ in v], 0.30, 0.30))

    # Spiracles, faint, low on the flank.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        for k, t in enumerate((0.30, 0.55)):
            i = int(t * (len(path) - 1))
            c = path[i]
            v, f = kit.dome(0.075, 0.045, rings=2, sides=6, cut=0.85)
            v = kit.aim(v, (c.x + sx * 0.66, c.y - 0.08, c.z),
                        (c.x + sx * 1.10, c.y - 0.14, c.z))
            parts.append(Part(f"spiracle{k}_{side}", "prosoma", v, f,
                              kit.flat(v, GLASS_DIM, kit.GLOW_FAINT)))


def build_abdomen(parts) -> None:
    path = gaster_path()
    n = len(path)
    base = [gaster_radius(i / (n - 1)) for i in range(n)]
    radii = [(r * 1.05, r * 0.94) for r in base]

    v, f, p = kit.tube(path, radii, sides=12, mode="up", phase=0.18,
                       profile=kit.flutes(12, 0.02))
    add(parts, "gaster", "abdomen1", (v, f), glass_t(p, 0.10, 0.34, 1.2))

    # A pale cardiac mark down the dorsal midline - the one piece of
    # patterning a smooth abdomen is allowed, and it is what stops a
    # big plain sac from reading as a balloon.
    mark = path[1:n - 1]
    markr = [(r[0] * 0.30, r[1] * 0.30) for r in radii[1:n - 1]]
    v, f, p = kit.shell(mark, markr, arc=(-0.5, 0.5), steps=6,
                        thick=0.012, lift=0.006, up=(0.0, 1.0, 0.0), mode="up")
    add(parts, "cardiacmark", "abdomen1", (v, f),
        kit.paint_t(p, GLASS_CHITIN, lambda t, a, u: 0.55 + 0.35 * math.sin(t * PI)))

    # THE CRACKS. Thin lit veins swept across the sac at odd angles and
    # odd lengths - a fracture pattern, not a grid - which is the read
    # that says "this thing came out of the glass" rather than "this
    # thing is a normal insect abdomen painted a different colour".
    rng_pts = ((0.18, 0.62, 0.42, -0.20), (0.34, 0.30, -0.30, 0.18),
               (-0.22, 0.70, 0.30, -0.34), (-0.38, 0.42, -0.40, 0.22),
               (0.10, 0.86, 0.10, -0.12), (-0.12, 0.20, -0.18, 0.30),
               (0.44, 0.54, -0.22, -0.10), (-0.46, 0.60, 0.24, 0.14),
               (0.02, 0.94, 0.02, -0.06), (0.26, 0.10, 0.34, 0.20))
    for k, (ux, ut, dz, dy) in enumerate(rng_pts):
        i = int(ut * (n - 1))
        c = path[i]
        r = base[i]
        a = c + Vector((ux * r, r * 0.55, 0.0))
        b = a + Vector((-ux * r * 0.5, dy * r * 1.6, dz * r * 2.4))
        v, f, p = kit.tube([a, a.lerp(b, 0.5) + Vector((0, r * 0.12, 0)), b],
                           [0.05, 0.032, 0.010], sides=5, mode="transport",
                           cap_start=False, cap_end=False)
        bone = "abdomen1" if ut < 0.55 else "abdomen2"
        add(parts, f"crack{k}", bone, (v, f),
            kit.paint_t(p, kit.Ramp([(0.0, GLASS_DIM), (0.6, GLASS_GLOW), (1.0, GLASS_PALE)]),
                        lambda t, a2, u: 0.30 + 0.55 * (1.0 - t),
                        glow=lambda t, a2, u: kit.GLOW_SEAM * (1.0 - t * 0.6)))

    # Fine dorsal tubercles, the abdomen's echo of the prosoma's.
    for k, t in enumerate((0.12, 0.28, 0.46, 0.64, 0.80)):
        i = int(t * (n - 1))
        c = path[i]
        r = base[i]
        v, f = kit.blob(0.10 + 0.03 * math.sin(k * 2.1), sides=6, rings=2,
                        squash=0.65, seed=151 + k)
        v = kit.transform(v, translate=(c.x + (0.15 if k % 2 else -0.15) * r,
                                        c.y + r * 0.92, c.z))
        bone = "abdomen1" if t < 0.55 else "abdomen2"
        add(parts, f"gastubercle{k}", bone, (v, f), glass_t(
            [(0.5, 0.5, 1.0) for _ in v], 0.24, 0.30))

    # THE SPINNERETS. Where the web actually leaves the animal, and
    # the runtime reads this bone's live world position as the origin
    # of every web attack - it has to sit at the true rear of the
    # animal, not be eyeballed separately from the geometry.
    tip = path[-1]
    for k, (ox, oz) in enumerate(((0.0, 0.05), (0.09, -0.06), (-0.09, -0.06))):
        base_pt = tip + Vector((ox * 0.5, -0.10, oz * 0.5))
        v, f, p = kit.tube([base_pt, base_pt + Vector((ox, -0.18, oz - 0.20))],
                           [0.085, 0.030], sides=6, mode="transport", cap_end=True)
        add(parts, f"spinneret{k}", "spinneret", (v, f),
            kit.paint_t(p, kit.Ramp([(0.0, GLASS_DIM), (1.0, GLASS_PALE)]),
                        lambda t, a, u: 0.3 + 0.6 * t,
                        glow=lambda t, a, u: kit.GLOW_GLAND * t))


def build_head(parts) -> None:
    """The rostrum, fangs and eight eyes. Carried LOW under the
    prosoma's crest, the way a real spider's are - the head is not a
    separate held-up mass the way the Matriarch's crowned one is."""
    neck = kit.arc_path(PROSOMA_CREST, HEAD_BASE, (0.0, -0.10, 0.05), n=3)
    v, f, p = kit.tube(neck, [(0.72, 0.80), (0.60, 0.66), (0.50, 0.55), (0.42, 0.46)],
                       sides=9, mode="transport")
    add(parts, "rostrum", "head", (v, f), glass_t(p, 0.14, 0.42))

    skull = kit.arc_path(HEAD_BASE, HEAD_TIP, (0.0, -0.06, 0.0), n=4)
    v, f, p = kit.tube(skull, [(0.42, 0.46), (0.38, 0.40), (0.30, 0.31), (0.20, 0.20), (0.10, 0.09)],
                       sides=8, mode="transport", profile=kit.flutes(8, 0.03))
    add(parts, "faceplate", "head", (v, f), glass_t(p, 0.18, 0.50, 1.2))

    # EIGHT EYES, not seven and not two-plus-five. Two big anterior
    # eyes low and forward, two medians above them, and two lateral
    # triads swept back along the cheek - the arrangement is the
    # single detail that says ARACHNID rather than INSECT at a glance,
    # which the Matriarch's crowned ocelli deliberately are not.
    eye_specs = (
        ("mainL", 1.0, 0.235, (0.34, 8.98, 2.35), (0.60, 8.86, 3.05)),
        ("mainR", -1.0, 0.235, (0.34, 8.98, 2.35), (0.60, 8.86, 3.05)),
        ("medL", 1.0, 0.115, (0.24, 9.36, 2.30), (0.42, 9.30, 2.86)),
        ("medR", -1.0, 0.115, (0.24, 9.36, 2.30), (0.42, 9.30, 2.86)),
    )
    for name, sx, r, c, aimc in eye_specs:
        cc = Vector((c[0] * sx, c[1], c[2]))
        ac = Vector((aimc[0] * sx, aimc[1], aimc[2]))
        v, f = kit.dome(r, r * 0.92, rings=3, sides=8, cut=0.95)
        v = kit.aim(v, tuple(cc), tuple(ac))
        parts.append(Part(f"eye_{name}", "head", v, f, kit.flat(v, GLASS_EDGE, kit.GLOW_EYE)))
    for side, sx in (("L", 1.0), ("R", -1.0)):
        for k, (lx, ly, lz) in enumerate(((0.46, 9.10, 1.94), (0.52, 8.94, 1.78), (0.50, 8.80, 1.98))):
            c = Vector((lx * sx, ly, lz))
            v, f = kit.dome(0.075, 0.068, rings=2, sides=6, cut=0.9)
            v = kit.aim(v, tuple(c), tuple(c + Vector((0.3 * sx, -0.05, 0.2))))
            parts.append(Part(f"eye_lat{k}_{side}", "head", v, f,
                              kit.flat(v, GLASS_GLOW, kit.GLOW_EYE * 0.85)))

    # THE FANGS. Hinged so a strike can spread them, hanging DOWN and
    # forward under the head rather than crossing laterally the way
    # the Matriarch's mandibles do - that difference alone keeps the
    # two bosses from reading as the same animal in different paint.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        # BRIGHTENED AND GLOWING, against the first pass's plain
        # chitin. A weapon hanging in a mouth cavity this dark needs
        # its own light or it never separates from the shadow it hangs
        # in - the review render lost the fangs entirely by frame two.
        base_pt = Vector((sx * 0.30, 8.62, 2.40))
        v, f, p = spike(base_pt, base_pt + Vector((sx * 0.10, -0.62, 0.46)),
                        r0=0.150, r1=0.016, sides=6, bow=(sx * 0.06, -0.05, 0.04), seed=61)
        add(parts, f"fang_{side}", f"fang_{side}", (v, f),
            kit.paint_t(p, kit.Ramp([(0.0, GLASS_DIM), (0.5, GLASS_GLOW), (1.0, GLASS_PALE)]),
                        lambda t, a, u: 0.32 + 0.5 * kit.topside(u, 1.0) + 0.20 * t,
                        glow=lambda t, a, u: kit.GLOW_SEAM * (0.4 + 0.6 * t)))
        tip = base_pt + Vector((sx * 0.10, -0.62, 0.46))
        v, f, p = spike(tip, tip + Vector((sx * -0.02, -0.16, 0.10)),
                        r0=0.032, r1=0.004, sides=4, seed=67)
        add(parts, f"fangtip_{side}", f"fang_{side}", (v, f),
            kit.paint_t(p, kit.Ramp([(0.0, GLASS_GLOW), (1.0, GLASS_PALE)]),
                        lambda t, a, u: 0.5 + 0.45 * t,
                        glow=lambda t, a, u: kit.GLOW_GLAND * (0.5 + 0.5 * t)))

        # Pedipalps: short, sensory, and the one limb on this animal
        # that never touches the ground - they read as fast fidgeting
        # detail beside the heavy fangs.
        pb = Vector((sx * 0.44, 8.80, 2.10))
        v, f, p = spike(pb, pb + Vector((sx * 0.34, -0.10, 0.52)),
                        r0=0.058, r1=0.010, sides=5, bow=(0, 0.06, 0), seed=71)
        add(parts, f"palp_{side}", f"palp_{side}", (v, f), glass_t(p, 0.22, 0.36))
        tip2 = pb + Vector((sx * 0.34, -0.10, 0.52))
        v, f, p = spike(tip2, tip2 + Vector((sx * 0.10, -0.02, 0.20)),
                        r0=0.024, r1=0.005, sides=4, seed=73)
        add(parts, f"palptip_{side}", f"palp_{side}", (v, f),
            kit.flat(v, GLASS_GLOW, kit.GLOW_FAINT))


def build_legs(parts) -> None:
    """Eight legs, splayed and stilted. This is the entire silhouette
    of the animal - see the module doctrine above - so every joint on
    every leg is bristled: bare insect-smooth legs on something this
    size would read as machined rather than grown."""
    for i, rig in enumerate(LEG_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            coxa_b, femur_b, tibia_b = leg_names(side, i)
            foot_b = f"foot{i}_{side}"
            hip = mirror(rig["hip"], sx)
            knee = mirror(rig["knee"], sx)
            foot = mirror(rig["foot"], sx)
            mid = hip.lerp(knee, 0.16)

            v, f, p = kit.tube([hip, hip.lerp(mid, 0.5), mid],
                               [0.76, 0.70, 0.62], sides=8, mode="transport")
            add(parts, f"coxaGeo{i}_{side}", coxa_b, (v, f), glass_t(p, 0.10, 0.32))
            v, f = kit.blob(0.46, sides=7, rings=2, seed=23 + i)
            v = kit.transform(v, translate=tuple(mid))
            parts.append(Part(f"trochanter{i}_{side}", femur_b, v, f,
                              kit.flat(v, GLASS_DIM, kit.GLOW_FAINT)))

            # THICKENED, hard, from the first pass's 0.40-0.22m taper.
            # A thirteen-metre leg that thin measured as a wire in
            # review - the read was daddy-long-legs standing over a
            # boss-sized body, not a boss. A real tarantula's legs
            # carry visible muscle bulk at the coxa and taper only
            # gently; this is the same correction, scaled up.
            fem = kit.arc_path(mid, knee, (sx * 0.16, 0.10, 0.0), n=5)
            v, f, p = kit.tube(fem, [0.620, 0.660, 0.600, 0.520, 0.440, 0.370],
                               sides=9, mode="transport", profile=kit.flutes(9, 0.055))
            add(parts, f"femurGeo{i}_{side}", femur_b, (v, f), glass_t(p, 0.16, 0.44, along=0.14))
            # Bristles: many, coarse enough to catch a rim light even
            # in near-silhouette - see the Harrow's own spined legs,
            # which is the bar a smooth leg was losing to.
            for k, tt in enumerate((0.16, 0.32, 0.48, 0.64, 0.80)):
                j = int(tt * (len(fem) - 1))
                c = fem[j]
                v, f, p = spike(c, c + Vector((sx * 0.24, 0.50, -0.30)),
                                r0=0.075, r1=0.006, sides=4, seed=37 + i * 7 + k)
                add(parts, f"fembristle{i}{k}_{side}", femur_b, (v, f), glass_t(p, 0.42, 0.34))

            v, f = kit.blob(0.480, sides=7, rings=2, seed=41 + i)
            v = kit.transform(v, translate=tuple(knee))
            parts.append(Part(f"kneeGeo{i}_{side}", tibia_b, v, f,
                              kit.paint(v, GLASS_CHITIN, lambda q: 0.42)))

            tib = kit.arc_path(knee, foot, (sx * 0.12, -0.10, 0.0), n=5)
            v, f, p = kit.tube(tib, [0.430, 0.390, 0.335, 0.275, 0.215, 0.160],
                               sides=8, mode="transport")
            add(parts, f"tibiaGeo{i}_{side}", tibia_b, (v, f), glass_t(p, 0.18, 0.40, along=-0.10))
            for k, tt in enumerate((0.18, 0.34, 0.50, 0.66, 0.82, 0.94)):
                j = int(tt * (len(tib) - 1))
                c = tib[j]
                v, f, p = spike(c, c + Vector((sx * 0.28, 0.09, -0.36)),
                                r0=0.065, r1=0.005, sides=4, seed=k + 31 + i * 5)
                add(parts, f"tibbristle{i}{k}_{side}", tibia_b, (v, f), glass_t(p, 0.44, 0.32))

            # Narrow tarsus, walking on a point the way the Matriarch's
            # does - eight feet on eight points, not eight pads.
            v, f = kit.dome(0.240, 0.135, rz=0.290, rings=2, sides=6, cut=0.9)
            v = kit.transform(v, translate=(foot.x, foot.y + 0.04, foot.z))
            parts.append(Part(f"tarsus{i}_{side}", foot_b, v, f,
                              kit.paint(v, GLASS_CHITIN, lambda q: 0.14)))
            for k, (dx, dz) in enumerate(((0.09, 0.32), (-0.09, -0.28), (0.28, -0.05))):
                claw = kit.arc_path((foot.x, foot.y + 0.10, foot.z),
                                    (foot.x + sx * dx, foot.y + 0.01, foot.z + dz * 1.3),
                                    (0, 0.07, 0), n=3)
                v, f, p = kit.tube(claw, [0.070, 0.052, 0.028, 0.008],
                                   sides=4, mode="transport", cap_end=False)
                add(parts, f"claw{i}{k}_{side}", foot_b, (v, f), glass_t(p, 0.46, 0.28))


def build_parts() -> list[Part]:
    parts: list[Part] = []
    build_prosoma(parts)
    build_abdomen(parts)
    build_head(parts)
    build_legs(parts)
    return parts


# ----------------------------------------------------------------------
# armature
# ----------------------------------------------------------------------

def build_bone_table() -> list[dict]:
    g = gaster_path()
    a1 = g[0]
    a2 = g[len(g) // 2]
    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0.60, 0)},
        {"name": "prosoma", "head": (0, 0, 0), "tail": tuple(PROSOMA_CREST), "parent": "root"},
        {"name": "abdomen1", "head": tuple(a1), "tail": tuple(a2), "parent": "prosoma"},
        {"name": "abdomen2", "head": tuple(a2), "tail": tuple(ABDOMEN_TIP),
         "parent": "abdomen1", "connect": True},
        {"name": "spinneret", "head": tuple(ABDOMEN_TIP),
         "tail": tuple(ABDOMEN_TIP + Vector((0, -0.30, -0.35))),
         "parent": "abdomen2", "connect": True},
        {"name": "head", "head": tuple(HEAD_BASE), "tail": tuple(HEAD_TIP), "parent": "prosoma"},
    ]
    for side, sx in (("L", 1.0), ("R", -1.0)):
        bones.append({"name": f"fang_{side}",
                      "head": (sx * 0.30, 8.62, 2.40), "tail": (sx * 0.40, 8.00, 2.86),
                      "parent": "head"})
        bones.append({"name": f"palp_{side}",
                      "head": (sx * 0.44, 8.80, 2.10), "tail": (sx * 0.78, 8.70, 2.62),
                      "parent": "head"})
    for i, rig in enumerate(LEG_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            coxa, femur, tibia = leg_names(side, i)
            hip = mirror(rig["hip"], sx)
            knee = mirror(rig["knee"], sx)
            foot = mirror(rig["foot"], sx)
            mid = hip.lerp(knee, 0.16)
            bones.append({"name": coxa, "head": tuple(hip), "tail": tuple(mid), "parent": "prosoma"})
            bones.append({"name": femur, "head": tuple(mid), "tail": tuple(knee),
                          "parent": coxa, "connect": True})
            bones.append({"name": tibia, "head": tuple(knee), "tail": tuple(foot),
                          "parent": femur, "connect": True})
            bones.append({"name": f"foot{i}_{side}", "head": tuple(foot),
                          "tail": tuple(foot + Vector((0, 0, 0.22))),
                          "parent": tibia, "connect": True})
    return bones


# ----------------------------------------------------------------------
# animation
# ----------------------------------------------------------------------

BODY_BONES = ["prosoma", "abdomen1", "abdomen2", "spinneret", "head",
              "fang_L", "fang_R", "palp_L", "palp_R"]


def build_actions(arm) -> list[str]:
    scene = bpy.context.scene
    names: list[str] = []

    def rest():
        return {b: (0.0, 0.0, 0.0) for b in BODY_BONES}

    def sym(pose, stem, x, y, z):
        pose[f"{stem}_L"] = (x, y, z)
        pose[f"{stem}_R"] = (x, -y, -z)

    def bake(name, frames, length):
        act = kit.new_action(arm, name)
        scene.frame_start = 0
        scene.frame_end = length
        for frame, pose in frames:
            kit.key_pose(arm, frame, pose)
        kit.set_interpolation(act)
        names.append(name)
        return act

    # ---- idle: a slow settle, the abdomen breathing. ------------------
    frames = []
    for frame, t in ((0, 0.0), (56, 1.0), (112, 0.0)):
        pose = rest()
        pose["prosoma"] = (0.014 * t, 0.0, 0.0)
        pose["abdomen1"] = (-0.022 * t, 0.010 * math.sin(t * PI), 0.0)
        pose["abdomen2"] = (-0.016 * t, -0.014 * math.sin(t * PI), 0.0)
        pose["head"] = (0.020 * t, 0.024 * math.sin(t * PI * 2), 0.0)
        sym(pose, "palp", 0.0, 0.10 * math.sin(t * PI * 2), 0.0)
        frames.append((frame, pose))
    bake("idle", frames, 112)

    # ---- alert: rears up onto the rear legs, fangs spread. The reveal.
    frames = []
    for frame, t in ((0, 0.0), (14, 1.15), (26, 1.0), (54, 1.0)):
        pose = rest()
        pose["prosoma"] = (-0.30 * t, 0.0, 0.0)
        pose["abdomen1"] = (0.14 * t, 0.0, 0.0)
        pose["abdomen2"] = (0.10 * t, 0.0, 0.0)
        pose["head"] = (0.22 * t, 0.0, 0.0)
        sym(pose, "fang", 0.0, 0.52 * t, 0.0)
        sym(pose, "palp", -0.30 * t, 0.20 * t, 0.0)
        frames.append((frame, pose))
    bake("alert", frames, 54)

    # ---- slam: both fronts drive down together. A telegraphed AoE. ---
    frames = []
    for frame, t in ((0, 0.0), (12, -0.30), (22, 1.0), (30, 0.55), (48, 0.0)):
        pose = rest()
        pose["prosoma"] = (0.34 * max(0.0, t), 0.0, 0.0)
        pose["abdomen1"] = (-0.12 * max(0.0, t), 0.0, 0.0)
        pose["head"] = (0.28 * max(0.0, t), 0.0, 0.0)
        sym(pose, "fang", 0.0, 0.34 * max(0.0, t), 0.0)
        frames.append((frame, pose))
    bake("slam", frames, 48)

    # ---- webCast: the abdomen curls forward and UNDER, tip lifting -
    # the spinneret has to clear the legs to fire, and the contract
    # frame the runtime launches on is frame 20 of 46.
    frames = []
    for frame, t in ((0, 0.0), (10, 0.35), (20, 1.0), (30, 0.85), (46, 0.0)):
        pose = rest()
        pose["abdomen1"] = (0.36 * t, 0.0, 0.0)
        pose["abdomen2"] = (0.52 * t, 0.0, 0.0)
        pose["spinneret"] = (0.30 * t, 0.0, 0.0)
        pose["prosoma"] = (-0.06 * t, 0.0, 0.0)
        frames.append((frame, pose))
    bake("webCast", frames, 46)

    # ---- collapse: buckles down onto its own legs. THIS CLIP OWNS THE
    # LEGS - the runtime's procedural solver keeps a standing animal's
    # feet planted and stretches the knee to reach them, which means a
    # body-only pose change cannot bring thirteen metres of animal
    # down at all: the legs would simply re-solve to hold the prosoma
    # exactly where it already was. The only way to actually lower it
    # is the technique `death` already proves - bend the leg bones
    # themselves - at about two-thirds of death's fold, which is
    # enough to bring the prosoma down under five metres without
    # reading as the animal dying rather than crouching.
    frames = []
    for frame, t in ((0, 0.0), (9, 0.32), (22, 0.78), (34, 1.0)):
        pose = rest()
        pose["prosoma"] = (0.10 * t, 0.05 * t, 0.0)
        pose["abdomen1"] = (-0.10 * t, 0.0, 0.0)
        pose["abdomen2"] = (-0.06 * t, 0.0, 0.0)
        pose["head"] = (0.16 * t, 0.0, 0.0)
        sym(pose, "fang", 0.0, 0.20 * t, 0.0)
        for i in range(len(LEG_RIG)):
            for side, sgn in (("L", 1.0), ("R", -1.0)):
                coxa, femur, tibia = leg_names(side, i)
                pose[coxa] = (0.0, 0.0, sgn * 0.16 * t)
                pose[femur] = (0.46 * t + 0.05 * i * t, 0.0, 0.0)
                pose[tibia] = (-0.74 * t, 0.0, 0.0)
        frames.append((frame, pose))
    bake("collapse", frames, 34)

    # ---- bite: a short, fast lunge - used while collapsed, so the
    # body is deliberately near its rest height rather than reared.
    frames = []
    for frame, t in ((0, 0.0), (7, -0.30), (13, 1.0), (19, 0.60), (32, 0.0)):
        pose = rest()
        pose["prosoma"] = (0.20 * t, 0.0, 0.0)
        pose["head"] = (0.30 * t, 0.0, 0.0)
        sym(pose, "fang", 0.0, 0.62 * max(0.0, t), 0.0)
        frames.append((frame, pose))
    bake("bite", frames, 32)

    # ---- recover: standing back up out of collapse. ALSO owns its
    # legs, unfolding from exactly the pose `collapse` left them in
    # back to bind-pose rotations - ending at (0,0,0) on every leg
    # bone is the contract that makes the handoff back to the
    # procedural solver invisible once `recover` finishes and an
    # ordinary clip (idle/alert) takes over again.
    frames = []
    for frame, t in ((0, 1.0), (16, 0.85), (30, 0.30), (42, 0.0)):
        pose = rest()
        pose["prosoma"] = (0.10 * t, 0.05 * t, 0.0)
        pose["abdomen1"] = (-0.10 * t, 0.0, 0.0)
        pose["abdomen2"] = (-0.06 * t, 0.0, 0.0)
        pose["head"] = (0.16 * t, 0.0, 0.0)
        for i in range(len(LEG_RIG)):
            for side, sgn in (("L", 1.0), ("R", -1.0)):
                coxa, femur, tibia = leg_names(side, i)
                pose[coxa] = (0.0, 0.0, sgn * 0.16 * t)
                pose[femur] = (0.46 * t + 0.05 * i * t, 0.0, 0.0)
                pose[tibia] = (-0.74 * t, 0.0, 0.0)
        frames.append((frame, pose))
    bake("recover", frames, 42)

    # ---- flinch ---------------------------------------------------------
    frames = []
    for frame, t in ((0, 0.0), (4, 1.0), (12, 0.35), (20, 0.0)):
        pose = rest()
        pose["prosoma"] = (-0.08 * t, 0.05 * t, 0.0)
        pose["abdomen1"] = (0.10 * t, -0.06 * t, 0.0)
        pose["abdomen2"] = (0.08 * t, -0.08 * t, 0.0)
        pose["head"] = (-0.18 * t, 0.08 * t, 0.0)
        frames.append((frame, pose))
    bake("flinch", frames, 20)

    # ---- death: the ONE clip that owns the legs. Eight of them buckle
    # outward independently rather than folding in unison, because a
    # thing this size collapsing symmetrically reads as a prop falling
    # over rather than as a body giving out.
    frames = []
    for frame, t in ((0, 0.0), (10, 0.26), (26, 0.72), (48, 1.0), (70, 1.0)):
        pose = rest()
        pose["prosoma"] = (0.46 * t, 0.10 * t, 0.08 * t)
        pose["abdomen1"] = (0.26 * t, -0.16 * t, 0.0)
        pose["abdomen2"] = (0.22 * t, -0.22 * t, 0.0)
        pose["head"] = (0.54 * t, 0.16 * t, 0.0)
        sym(pose, "fang", 0.0, 0.24 * t, 0.0)
        for i in range(len(LEG_RIG)):
            for side, sgn in (("L", 1.0), ("R", -1.0)):
                coxa, femur, tibia = leg_names(side, i)
                wob = 1.0 + 0.14 * math.sin(i * 2.1 + (0 if side == "L" else 1.7))
                pose[coxa] = (0.0, 0.0, sgn * 0.26 * t * wob)
                pose[femur] = (0.66 * t * wob + 0.08 * i * t, 0.0, 0.0)
                pose[tibia] = (-1.05 * t * wob, 0.0, 0.0)
        frames.append((frame, pose))
    bake("death", frames, 70)

    return names


# ----------------------------------------------------------------------
# export
# ----------------------------------------------------------------------

def export(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_bake_animation=False,
        export_optimize_animation_size=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )


def measure(parts: list[Part]) -> dict:
    ys = [v.y for p in parts for v in p.verts]
    xs = [v.x for p in parts for v in p.verts]
    zs = [v.z for p in parts for v in p.verts]
    return {
        "heightM": round(max(ys) - min(ys), 3),
        "widthM": round(max(xs) - min(xs), 3),
        "lengthM": round(max(zs) - min(zs), 3),
    }


def main() -> None:
    args = parse_args()
    kit.reset_scene()

    parts = build_parts()
    material = kit.vertex_colour_material("distaff-glass")
    mesh_obj = kit.build_mesh_object("distaff", parts, material)
    arm = kit.build_armature("distaff-rig", build_bone_table())
    kit.bind(mesh_obj, arm)

    bpy.context.view_layer.objects.active = arm
    clips = build_actions(arm)

    if args.save_blend:
        args.save_blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(args.save_blend))

    export(args.output)

    tris = sum(len(p.faces) + sum(1 for f in p.faces if len(f) == 4) for p in parts)
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "output": str(args.output),
        "bytes": args.output.stat().st_size,
        "parts": len(parts),
        "vertices": sum(len(p.verts) for p in parts),
        "trianglesApprox": tris,
        "bones": len(build_bone_table()),
        "clips": clips,
        "legBonesAnimated": ["death"],
        "textures": 0,
        **measure(parts),
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
