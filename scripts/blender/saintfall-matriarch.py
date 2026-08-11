#!/usr/bin/env python3
"""Build the Bloom's Matriarch: SAINTFALL's brood boss.

    blender --background --factory-startup \
      --python scripts/blender/saintfall-matriarch.py -- \
      --output assets/models/saintfall/source/matriarch.raw.glb \
      --report output/saintfall/models/matriarch.json

WHAT IS LEFT TO OWN

The bestiary already spends the three obvious silhouettes. The
Thresher is SMALL AND FAST, the Gleaner is TALL AND THIN, the Harrow
is WIDE AND LOW - and each of those was chosen so that no two castes
compete for the same read at range. A boss that is simply a bigger
Harrow is not a fourth silhouette, it is the third one again with more
health, and the player learns nothing new when it walks over a ridge.

So the Matriarch owns LONG, and it owns REARED. Nine metres of animal
laid along the ground with the front third lifted off it: the head
sits above the Gleaner's while the mass stays behind and low, which is
a shape none of the other three can make. Two things enforce it:

  EIGHT LEGS. Four pairs, where the rest of the brood has three or
  two. The count is not detail - a walking creature is read by its
  leg rhythm long before its body resolves, and eight legs moving in
  two tetrapod sets is a different animal at four hundred metres.

  THE FOLDED SCYTHES. Its raptorial forelimbs fold shut against
  themselves at rest, and the triangle of empty air trapped inside
  that fold is the only large piece of NEGATIVE space on the front of
  the animal. This is the Harrow's horn-gap trick moved to a limb:
  holes survive distance, surface detail does not.

THE ABDOMEN IS THE FIGHT

Everything else in this bestiary is killed by shooting it. The
Matriarch carries its brood in a segmented gaster that drags behind
it, and the intersegmental membrane between those segments is lit,
soft, and the only part of the animal that is not armoured. It is
also carried LOW and BEHIND - so the weak point is on the far side of
nine metres of hostile animal, and getting to it is the encounter.

The alert pose is built around exposing it. When the Matriarch wakes,
the gaster arches UP and forward over its own back, which does three
jobs at once: it makes the animal visibly bigger, it swings the egg
sacs into the light where they can be seen and shot, and it is
readable as a threat display from behind, which is where the player
will usually be standing when it happens.

Painted from CHITIN_DEEP, like the Harrow, because this is the thing
the Harrow came out of. It carries far more light than any other
caste - the hive-glow is its own - and that is the family resemblance
running the other way: the castes are dark animals with a lamp in
them, and this is where the lamp is brightest.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
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
CHITIN = kit.CHITIN_DEEP


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
# Authored 1:1 in metres, Y-up, +Z forward. The reared front and the
# trailing gaster are described by two separate paths that meet at the
# pedicel - a single spine through the whole animal would have to bend
# 90 degrees at the waist and the sweep frames go singular when it does.
# ----------------------------------------------------------------------

PEDICEL = Vector((0.0, 2.42, -1.05))     # where the gaster hangs off
CROWN = Vector((0.0, 4.28, 1.02))        # top of the reared prothorax
HEAD_BASE = Vector((0.0, 4.16, 1.16))
HEAD_TIP = Vector((0.0, 3.86, 2.00))
GASTER_TIP = Vector((0.0, 0.98, -6.30))

# Splayed WIDE, and progressively wider toward the middle pairs. A
# nine-metre body on legs tucked under itself reads as a caterpillar;
# feet planted outside its own width read as a thing that braces
# before it swings, which is what the scythes need to be believable.
#
# ALL FOUR PAIRS SIT BEHIND THE HEAD. The first pass put the front
# feet at z +1.72 - ahead of the head base - and the front knees at
# the same height the scythes were reaching through. The result was a
# thicket: ten limbs occupying one volume, in which neither the leg
# count nor the raptorial fold could be read at all. The front of
# this animal belongs to the scythes, and the legs start behind them.
LEG_RIG = (
    {"hip": (0.80, 2.86, -0.10), "knee": (2.30, 4.30, 0.20), "foot": (3.05, 0.0, 0.55)},
    {"hip": (0.84, 2.66, -0.62), "knee": (2.42, 4.14, -0.60), "foot": (3.20, 0.0, -0.85)},
    {"hip": (0.82, 2.46, -1.14), "knee": (2.40, 3.94, -1.35), "foot": (3.15, 0.0, -2.25)},
    {"hip": (0.76, 2.26, -1.66), "knee": (2.18, 3.60, -2.05), "foot": (2.85, 0.0, -3.50)},
)

# The raptorial fold. `brachium` drives down and forward, `blade`
# folds back up along it - the triangle between them is the read.
#
# CARRIED WELL CLEAR OF THE BODY, and that is the whole of the first
# revision. Authored tight to the thorax the fold was geometrically
# correct and completely invisible: the mesosoma is 0.9m in radius
# there and the pronotum lifts proud of that again, so an elbow at
# x=1.02 was inside the animal. The feature the silhouette is built
# on has to be outside the silhouette.
#
# Carried HIGH as well as wide, for the same reason the legs moved
# back: the fold has to occupy air nothing else is in. Shoulder at
# the top of the mesosoma, reaching forward past the head.
SCY_SHOULDER = Vector((0.72, 3.95, 0.72))
SCY_ELBOW = Vector((1.52, 4.35, 1.60))
SCY_WRIST = Vector((2.05, 2.85, 3.10))
SCY_TIP = Vector((1.35, 4.15, 1.95))


def leg_names(side: str, i: int) -> tuple[str, str, str]:
    return (f"coxa{i}_{side}", f"femur{i}_{side}", f"tibia{i}_{side}")


def mirror(p, sx: float) -> Vector:
    return Vector((p[0] * sx, p[1], p[2]))


def spike(a, b, r0=0.055, r1=0.006, sides=5, bow=None, seed=1):
    a, b = Vector(a), Vector(b)
    pts = kit.arc_path(a, b, bow, n=3) if bow else [a, a.lerp(b, 0.5), b]
    return kit.tube(pts, [r0, (r0 + r1) * 0.55, r1], sides=sides,
                    mode="transport", seed=seed, cap_end=False)


def chitin_t(params, base=0.28, span=0.56, power=1.0, along=0.0, glow=0.0,
             ramp=None):
    return kit.paint_t(
        params, ramp or CHITIN,
        lambda t, a, u: base + span * kit.topside(u, power) + along * t,
        glow=glow,
    )


def add(parts, name, bone, built, colors):
    parts.append(Part(name, bone, built[0], built[1], colors))


def mesosoma_path():
    """The reared front, pedicel up to the crown."""
    return kit.bezier(PEDICEL, (0.0, 2.92, -0.52), (0.0, 3.72, 0.22),
                      CROWN, n=7)


def mesosoma_radii():
    # Deepest at the shoulder where the legs and scythes all load into
    # it, tapering to the neck.
    return [(0.62, 0.70), (0.74, 0.84), (0.80, 0.92), (0.78, 0.90),
            (0.70, 0.80), (0.58, 0.66), (0.46, 0.52), (0.36, 0.40)]


def gaster_path():
    """Nine segments of brood, trailing back and settling to the sand."""
    return kit.bezier(PEDICEL, (0.0, 2.30, -2.30), (0.0, 1.74, -4.20),
                      GASTER_TIP, n=15)


def gaster_radius(t: float) -> float:
    # Full through the middle third and pinched at both ends: a waist
    # at the pedicel is what makes the mass behind it read as separate
    # from the thorax rather than as one continuous slug.
    return 0.30 + 0.92 * math.sin(min(1.0, t * 1.06) ** 0.62 * PI) ** 0.58


# ----------------------------------------------------------------------
# geometry
# ----------------------------------------------------------------------

def build_mesosoma(parts) -> None:
    path = mesosoma_path()
    radii = mesosoma_radii()

    v, f, p = kit.tube(path, radii, sides=10, mode="up", phase=0.15,
                       profile=kit.flutes(10, 0.035))
    add(parts, "mesosoma", "thorax", (v, f), chitin_t(p, 0.14, 0.48, 1.4))
    # Pronotal shield, lifted well proud. On a near-black animal the
    # plate is read by its edge shadow, not by its own value.
    v, f, p = kit.shell(path, radii, arc=(-0.29, 0.29), steps=8,
                        thick=0.075, lift=0.055,
                        profile=lambda t, u: 1.0 + 0.13 * (1.0 - t) ** 2)
    add(parts, "pronotum", "thorax", (v, f), chitin_t(p, 0.24, 0.62, 1.2))

    # The lit gap the shield leaves down each flank, and the single
    # largest piece of surface information on the front of the animal.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        a0 = 0.295 * sx
        v, f, p = kit.shell(path, radii, arc=(a0, a0 + 0.055 * sx), steps=3,
                            thick=0.020, lift=0.008)
        add(parts, f"pronseam_{side}", "thorax", (v, f),
            kit.paint_t(p, kit.BIO_RAMP,
                        lambda t, a, u: 0.20 + 0.52 * math.sin(t * PI),
                        glow=lambda t, a, u: kit.GLOW_SEAM * (0.35 + 0.65 * math.sin(t * PI))))

    # Shoulder horns. Swept back and outboard, they give the reared
    # front the width it needs so the animal does not read as a neck.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        v, f, p = spike((sx * 0.72, 3.32, 0.34), (sx * 1.66, 4.02, -0.62),
                        r0=0.15, r1=0.012, sides=6,
                        bow=(0, 0.14, 0.04), seed=11)
        add(parts, f"pronhorn_{side}", "thorax", (v, f),
            chitin_t(p, 0.30, 0.50, along=0.28))
        v, f, p = spike((sx * 0.60, 3.00, -0.30), (sx * 1.18, 3.30, -1.02),
                        r0=0.10, r1=0.008, sides=5,
                        bow=(0, 0.08, 0.0), seed=17)
        add(parts, f"pronspur_{side}", "thorax", (v, f),
            chitin_t(p, 0.34, 0.44, along=0.24))

    # Sternum, dark and unlit: the underside of a reared animal is the
    # one surface that never sees the sun.
    v, f, p = kit.shell(path, radii, arc=(0.31, 0.69), steps=5,
                        thick=0.055, lift=0.008)
    add(parts, "sternum", "thorax", (v, f), chitin_t(p, 0.03, 0.14))

    # Spiracles down the flank, faint. Present, not shouting.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        for k, t in enumerate((0.26, 0.46, 0.66)):
            i = int(t * (len(path) - 1))
            c = path[i]
            v, f = kit.dome(0.085, 0.05, rings=2, sides=6, cut=0.85)
            v = kit.aim(v, (c.x + sx * 0.62, c.y - 0.10, c.z),
                        (c.x + sx * 1.10, c.y - 0.16, c.z))
            parts.append(Part(f"spiracle{k}_{side}", "thorax", v, f,
                              kit.flat(v, kit.BIO_DIM, kit.GLOW_FAINT)))


def build_gaster(parts) -> None:
    """The brood sac. Armoured on top, lit and soft underneath."""
    path = gaster_path()
    n = len(path)
    base = [gaster_radius(i / (n - 1)) for i in range(n)]
    # Wider than tall, so it reads as a laid-down mass rather than a
    # tube, and so the tergite plates have somewhere to sit.
    radii = [(r * 1.06, r * 0.88) for r in base]

    v, f, p = kit.tube(path, radii, sides=10, mode="up", phase=0.22)
    add(parts, "gaster", "abdomen1", (v, f), chitin_t(p, 0.10, 0.38, 1.4))
    # NINE TERGITES, each a separate plate with its own edge, and the
    # lit membrane showing between them. One smooth sac painted with a
    # stripe pattern would have read as a painted sac; the segments
    # have to be geometry or the light does not turn a corner at the
    # seam and the whole weak point stops looking soft.
    seg = 9
    for k in range(seg):
        t0 = k / seg
        t1 = (k + 1) / seg
        i0 = int(t0 * (n - 1))
        i1 = max(i0 + 2, int(t1 * (n - 1)))
        sub = path[i0:i1 + 1]
        subr = radii[i0:i1 + 1]
        if len(sub) < 2:
            continue
        bone = f"abdomen{min(3, 1 + k // 3)}"
        v, f, p = kit.shell(sub, subr, arc=(-0.30, 0.30), steps=7,
                            thick=0.06, lift=0.045 + 0.02 * (1.0 - t0),
                            profile=lambda t, u: 1.0 + 0.07 * (1.0 - t))
        add(parts, f"tergite{k}", bone, (v, f),
            chitin_t(p, 0.20 - 0.10 * t0, 0.58, 1.25))

        # THE EGG SACS. The underside of each segment, lit, and the
        # part of the animal the whole encounter is about. Brightest
        # in the middle of the gaster where the mass is - a uniform
        # glow along the whole length would give the player no
        # particular place to shoot.
        heat = math.sin(min(1.0, t0 * 1.15) * PI) ** 0.7
        v, f, p = kit.shell(sub, subr, arc=(0.30, 0.70), steps=6,
                            thick=0.030, lift=0.004)
        add(parts, f"eggsac{k}", bone, (v, f),
            kit.paint_t(p, kit.BIO_RAMP,
                        lambda t, a, u, h=heat: 0.30 + 0.58 * h,
                        glow=lambda t, a, u, h=heat: kit.GLOW_GLAND * (0.30 + 0.70 * h)))

        # The membrane ring between this tergite and the next: a thin
        # bright band that survives to any range because it is a
        # LINE across the body rather than a patch on it.
        if k < seg - 1 and i1 + 1 < n:
            band = path[i1 - 1:i1 + 2]
            bandr = [(r[0] * 0.97, r[1] * 0.97) for r in radii[i1 - 1:i1 + 2]]
            if len(band) >= 2:
                v, f, p = kit.tube(band, bandr, sides=10, mode="up", phase=0.22,
                                   cap_start=False, cap_end=False)
                add(parts, f"membrane{k}", bone, (v, f),
                    kit.paint_t(p, kit.BIO_RAMP,
                                lambda t, a, u, h=heat: 0.26 + 0.50 * h,
                                glow=lambda t, a, u, h=heat: kit.GLOW_SEAM * (0.5 + 0.5 * h)))

    # Paired dorsal spines down the gaster. They break the outline of
    # what is otherwise a long smooth mass, and they are what the eye
    # counts the segments by when the animal is a silhouette.
    for k in range(1, seg - 1):
        t = k / seg
        i = int(t * (n - 1))
        c = path[i]
        r = base[i]
        bone = f"abdomen{min(3, 1 + k // 3)}"
        for side, sx in (("L", 1.0), ("R", -1.0)):
            v, f, p = spike((c.x + sx * r * 0.55, c.y + r * 0.62, c.z),
                            (c.x + sx * r * 0.95, c.y + r * 1.55, c.z - 0.30),
                            r0=0.085 * (1.4 - t), r1=0.006, sides=5,
                            bow=(0, 0.05, 0), seed=53 + k)
            add(parts, f"gasterspine{k}_{side}", bone, (v, f),
                chitin_t(p, 0.40, 0.36, along=0.24))

    # Ovipositor. The tip of the animal, and the thing that makes it
    # legible as an EGG-LAYER rather than as a large beetle.
    tip = path[-1]
    ovi = kit.arc_path(tip, tip + Vector((0.0, -0.30, -1.24)),
                       (0.0, -0.16, 0.0), n=5)
    v, f, p = kit.tube(ovi, [0.24, 0.20, 0.155, 0.11, 0.065, 0.022],
                       sides=7, mode="transport", cap_end=False)
    add(parts, "ovipositor", "abdomen3", (v, f),
        chitin_t(p, 0.24, 0.42, along=0.30))
    for side, sx in (("L", 1.0), ("R", -1.0)):
        v, f, p = spike(tip + Vector((sx * 0.16, -0.06, -0.30)),
                        tip + Vector((sx * 0.52, 0.14, -1.10)),
                        r0=0.070, r1=0.006, sides=5, seed=61)
        add(parts, f"cercus_{side}", "abdomen3", (v, f),
            chitin_t(p, 0.38, 0.34, along=0.26))


def build_head(parts) -> None:
    """A crowned head. The eye cluster is the tell that it is a queen."""
    neck = kit.arc_path(CROWN, HEAD_BASE, (0.0, 0.04, 0.02), n=3)
    v, f, p = kit.tube(neck, [(0.34, 0.38), (0.36, 0.42), (0.38, 0.44),
                              (0.40, 0.46)],
                       sides=8, mode="transport")
    add(parts, "neck", "head", (v, f), chitin_t(p, 0.16, 0.44))

    skull = kit.arc_path(HEAD_BASE, HEAD_TIP, (0.0, 0.10, 0.0), n=5)
    v, f, p = kit.tube(skull, [(0.42, 0.48), (0.46, 0.52), (0.44, 0.50),
                               (0.38, 0.42), (0.28, 0.30), (0.16, 0.17)],
                       sides=8, mode="transport",
                       profile=kit.flutes(8, 0.04))
    add(parts, "skull", "head", (v, f), chitin_t(p, 0.20, 0.56, 1.3))

    # Frontal shield over the brow.
    v, f, p = kit.shell(skull, [(0.42, 0.48), (0.46, 0.52), (0.44, 0.50),
                                (0.38, 0.42), (0.28, 0.30), (0.16, 0.17)],
                        arc=(-0.24, 0.24), steps=6, thick=0.05, lift=0.045)
    add(parts, "frontal", "head", (v, f), chitin_t(p, 0.30, 0.60, 1.15))

    # THE CROWN. Five ocelli in an arc over the brow, plus the two big
    # compound eyes. Everything else in the brood has two eyes; the
    # count is the rank, and the arc is what the player sees first
    # when it turns to face them in the dark.
    for k in range(5):
        u = (k / 4.0) * 2.0 - 1.0
        r = 0.115 - 0.030 * abs(u)
        c = Vector((u * 0.30, 4.42 - 0.10 * u * u, 1.32 + 0.10 * (1.0 - abs(u))))
        v, f = kit.dome(r, r * 0.85, rings=2, sides=7, cut=0.9)
        v = kit.aim(v, tuple(c), tuple(c + Vector((u * 0.16, 0.42, 0.22))))
        parts.append(Part(f"ocellus{k}", "head", v, f,
                          kit.flat(v, kit.BIO_PALE, kit.GLOW_EYE)))

    for side, sx in (("L", 1.0), ("R", -1.0)):
        c = Vector((sx * 0.40, 4.10, 1.52))
        v, f = kit.dome(0.23, 0.20, rz=0.28, rings=3, sides=8, cut=0.95)
        v = kit.aim(v, tuple(c), tuple(c + Vector((sx * 0.5, 0.16, 0.30))))
        parts.append(Part(f"eye_{side}", "head", v, f,
                          kit.flat(v, kit.BIO_VIOLET, kit.GLOW_EYE)))

        # Mandibles. Heavy, crossed, and hinged so the strike can open
        # them - a boss that never opens its mouth is a statue.
        base = Vector((sx * 0.24, 3.82, 1.86))
        v, f, p = spike(base, base + Vector((-sx * 0.20, -0.16, 0.86)),
                        r0=0.13, r1=0.014, sides=6,
                        bow=(sx * 0.10, -0.06, 0.0), seed=71)
        add(parts, f"mandible_{side}", f"mandible_{side}", (v, f),
            chitin_t(p, 0.34, 0.46, along=0.24))
        v, f, p = spike(base + Vector((sx * 0.04, -0.02, 0.30)),
                        base + Vector((sx * 0.30, 0.18, 0.62)),
                        r0=0.055, r1=0.006, sides=4, seed=73)
        add(parts, f"mandtooth_{side}", f"mandible_{side}", (v, f),
            chitin_t(p, 0.44, 0.32))

        # Palps, small and lit at the tip.
        pb = Vector((sx * 0.34, 3.76, 1.62))
        v, f, p = spike(pb, pb + Vector((sx * 0.26, -0.30, 0.44)),
                        r0=0.048, r1=0.010, sides=4, seed=79)
        add(parts, f"palp_{side}", "head", (v, f),
            chitin_t(p, 0.22, 0.34, glow=lambda t, a, u: kit.GLOW_FAINT * t))

    # Antennae. Long, back-swept, and the one soft line on the animal.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        ab = Vector((sx * 0.22, 4.42, 1.30))
        path = kit.bezier(ab, ab + Vector((sx * 0.70, 0.62, 0.30)),
                          ab + Vector((sx * 1.30, 0.74, -0.60)),
                          ab + Vector((sx * 1.52, 0.30, -1.60)), n=7)
        v, f, p = kit.tube(path, [0.055, 0.048, 0.041, 0.034, 0.027,
                                  0.021, 0.015, 0.008],
                           sides=5, mode="transport", cap_end=False,
                           profile=kit.annulate(9, 0.16))
        add(parts, f"antenna_{side}", "head", (v, f),
            chitin_t(p, 0.30, 0.40, along=0.30,
                     glow=lambda t, a, u: kit.GLOW_FAINT * max(0.0, t - 0.5) * 2))


def build_scythes(parts) -> None:
    """The raptorial forelimbs, folded shut.

    Authored IN THE FOLD rather than extended, because that is the
    pose the animal is in for most of the time it is on screen and it
    is the one the silhouette is designed around. The strike opens it.
    """
    for side, sx in (("L", 1.0), ("R", -1.0)):
        sh = mirror(SCY_SHOULDER, sx)
        el = mirror(SCY_ELBOW, sx)
        wr = mirror(SCY_WRIST, sx)
        tp = mirror(SCY_TIP, sx)

        # Coxa block, seated into the pronotum.
        v, f, p = kit.tube([sh, sh.lerp(el, 0.55), el],
                           [0.46, 0.43, 0.38], sides=7, mode="transport")
        add(parts, f"scapulaGeo_{side}", f"scapula_{side}", (v, f),
            chitin_t(p, 0.14, 0.40))
        v, f = kit.blob(0.32, sides=7, rings=2, seed=83)
        v = kit.transform(v, translate=tuple(el))
        parts.append(Part(f"scyshoulder_{side}", f"brachium_{side}", v, f,
                          kit.flat(v, kit.BIO_DIM, kit.GLOW_FAINT)))

        # Brachium: heavy, and carrying the spine row a mantis catches
        # with. The spines are also what stops the fold from reading
        # as two smooth sticks laid together.
        br = kit.arc_path(el, wr, (sx * 0.14, -0.10, 0.10), n=5)
        v, f, p = kit.tube(br, [0.360, 0.390, 0.360, 0.310, 0.255, 0.205],
                           sides=7, mode="transport",
                           profile=kit.flutes(7, 0.055))
        add(parts, f"brachiumGeo_{side}", f"brachium_{side}", (v, f),
            chitin_t(p, 0.18, 0.48, along=0.16))
        for k, tt in enumerate((0.26, 0.44, 0.62, 0.80)):
            j = int(tt * (len(br) - 1))
            c = br[j]
            v, f, p = spike(c, c + Vector((sx * 0.08, -0.60 + 0.10 * k, 0.16)),
                            r0=0.086, r1=0.008, sides=4, seed=89 + k)
            add(parts, f"brspine{k}_{side}", f"brachium_{side}", (v, f),
                chitin_t(p, 0.46, 0.30))

        v, f = kit.blob(0.290, sides=7, rings=2, seed=97)
        v = kit.transform(v, translate=tuple(wr))
        parts.append(Part(f"scyelbow_{side}", f"blade_{side}", v, f,
                          kit.paint(v, CHITIN, lambda q: 0.42)))

        # THE BLADE. A flattened sickle, not a tube: the whole point of
        # a raptorial limb is that it presents an edge, and an edge is
        # the one thing a round limb cannot have.
        bl = kit.arc_path(wr, tp, (sx * 0.10, 0.18, 0.24), n=6)
        v, f, p = kit.tube(bl, [(0.290, 0.130), (0.330, 0.122), (0.320, 0.108),
                                (0.280, 0.090), (0.222, 0.072), (0.155, 0.052),
                                (0.075, 0.026)],
                           sides=6, mode="transport", cap_end=False)
        add(parts, f"bladeGeo_{side}", f"blade_{side}", (v, f),
            chitin_t(p, 0.26, 0.56, 1.2, along=0.22))
        # A lit fuller down the blade. It is the only bright thing on
        # the front of the animal at rest, and it draws the eye to the
        # fold - which is the shape the silhouette is built on.
        v, f, p = kit.shell(bl, [0.290, 0.330, 0.320, 0.280, 0.222, 0.155, 0.075],
                            arc=(-0.055, 0.055), steps=2, thick=0.020, lift=0.006)
        add(parts, f"bladefuller_{side}", f"blade_{side}", (v, f),
            kit.paint_t(p, kit.BIO_RAMP,
                        lambda t, a, u: 0.30 + 0.44 * (1.0 - t),
                        glow=lambda t, a, u: kit.GLOW_SEAM * (1.0 - t * 0.7)))
        # Serrations along the inner edge.
        for k, tt in enumerate((0.20, 0.36, 0.52, 0.68, 0.84)):
            j = int(tt * (len(bl) - 1))
            c = bl[j]
            v, f, p = spike(c, c + Vector((-sx * 0.05, -0.40 + 0.05 * k, -0.10)),
                            r0=0.066, r1=0.006, sides=4, seed=101 + k)
            add(parts, f"blserr{k}_{side}", f"blade_{side}", (v, f),
                chitin_t(p, 0.48, 0.28))


def build_legs(parts) -> None:
    """Eight legs. Long, high-kneed, and thin enough to read as legs."""
    for i, rig in enumerate(LEG_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            coxa_b, femur_b, tibia_b = leg_names(side, i)
            foot_b = f"foot{i}_{side}"
            hip = mirror(rig["hip"], sx)
            knee = mirror(rig["knee"], sx)
            foot = mirror(rig["foot"], sx)
            mid = hip.lerp(knee, 0.18)

            v, f, p = kit.tube([hip, hip.lerp(mid, 0.5), mid],
                               [0.44, 0.41, 0.37], sides=7, mode="transport")
            add(parts, f"coxaGeo{i}_{side}", coxa_b, (v, f),
                chitin_t(p, 0.10, 0.30))
            v, f = kit.blob(0.255, sides=7, rings=2, seed=23 + i)
            v = kit.transform(v, translate=tuple(mid))
            parts.append(Part(f"trochanter{i}_{side}", femur_b, v, f,
                              kit.flat(v, kit.BIO_DIM, kit.GLOW_FAINT)))

            fem = kit.arc_path(mid, knee, (sx * 0.12, -0.08, 0.0), n=5)
            v, f, p = kit.tube(fem, [0.350, 0.375, 0.340, 0.290, 0.240, 0.195],
                               sides=7, mode="transport",
                               profile=kit.flutes(7, 0.06))
            add(parts, f"femurGeo{i}_{side}", femur_b, (v, f),
                chitin_t(p, 0.16, 0.46, along=0.14))
            # One swept spine per femur. Eight of them along the top of
            # the animal are what break up the outline of a long dark
            # body crossing sand.
            v, f, p = spike(fem[3], fem[3] + Vector((sx * 0.20, 0.52, -0.36)),
                            r0=0.100, r1=0.008, sides=5, seed=37 + i)
            add(parts, f"femspine{i}_{side}", femur_b, (v, f),
                chitin_t(p, 0.44, 0.34))

            v, f = kit.blob(0.290, sides=7, rings=2, seed=41 + i)
            v = kit.transform(v, translate=tuple(knee))
            parts.append(Part(f"kneeGeo{i}_{side}", tibia_b, v, f,
                              kit.paint(v, CHITIN, lambda q: 0.40)))

            tib = kit.arc_path(knee, foot, (sx * 0.10, -0.06, 0.0), n=5)
            v, f, p = kit.tube(tib, [0.265, 0.240, 0.205, 0.170, 0.135, 0.100],
                               sides=6, mode="transport")
            add(parts, f"tibiaGeo{i}_{side}", tibia_b, (v, f),
                chitin_t(p, 0.18, 0.42, along=-0.10))
            for k, tt in enumerate((0.34, 0.58, 0.80)):
                j = int(tt * (len(tib) - 1))
                c = tib[j]
                v, f, p = spike(c, c + Vector((sx * 0.18, 0.05, -0.24)),
                                r0=0.058, r1=0.006, sides=4, seed=k + 31 + i)
                add(parts, f"tibspur{i}{k}_{side}", tibia_b, (v, f),
                    chitin_t(p, 0.42, 0.30))

            # Narrow tarsus. This one walks on POINTS, unlike the
            # Harrow's pads - a ten-metre animal picking its way on
            # eight feet is a different kind of unsettling from a
            # heavy that plants itself.
            v, f = kit.dome(0.170, 0.095, rz=0.220, rings=2, sides=6, cut=0.9)
            v = kit.transform(v, translate=(foot.x, foot.y + 0.036, foot.z))
            parts.append(Part(f"tarsus{i}_{side}", foot_b, v, f,
                              kit.paint(v, CHITIN, lambda q: 0.14)))
            for k, (dx, dz) in enumerate(((0.08, 0.30), (-0.08, -0.26),
                                          (0.26, -0.04))):
                claw = kit.arc_path((foot.x, foot.y + 0.096, foot.z),
                                    (foot.x + sx * dx, foot.y + 0.010,
                                     foot.z + dz * 1.25),
                                    (0, 0.068, 0), n=3)
                v, f, p = kit.tube(claw, [0.068, 0.052, 0.030, 0.010],
                                   sides=4, mode="transport", cap_end=False)
                add(parts, f"claw{i}{k}_{side}", foot_b, (v, f),
                    chitin_t(p, 0.44, 0.28))


def build_parts() -> list[Part]:
    parts: list[Part] = []
    build_mesosoma(parts)
    build_gaster(parts)
    build_head(parts)
    build_scythes(parts)
    build_legs(parts)
    return parts


# ----------------------------------------------------------------------
# armature
# ----------------------------------------------------------------------

def build_bone_table() -> list[dict]:
    g = gaster_path()
    # Three gaster bones, so the arch in the alert pose is a CURVE
    # rather than a hinge. One bone would swing the whole sac like a
    # plank; three let the base lift while the tip trails.
    a1 = g[0]
    a2 = g[len(g) // 3]
    a3 = g[2 * len(g) // 3]
    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0.50, 0)},
        {"name": "thorax", "head": tuple(PEDICEL), "tail": tuple(CROWN),
         "parent": "root"},
        {"name": "abdomen1", "head": tuple(a1), "tail": tuple(a2),
         "parent": "thorax"},
        {"name": "abdomen2", "head": tuple(a2), "tail": tuple(a3),
         "parent": "abdomen1", "connect": True},
        {"name": "abdomen3", "head": tuple(a3), "tail": tuple(GASTER_TIP),
         "parent": "abdomen2", "connect": True},
        {"name": "head", "head": tuple(HEAD_BASE), "tail": tuple(HEAD_TIP),
         "parent": "thorax"},
    ]
    for side, sx in (("L", 1.0), ("R", -1.0)):
        bones.append({"name": f"mandible_{side}",
                      "head": (sx * 0.24, 3.82, 1.86),
                      "tail": (sx * 0.06, 3.66, 2.70),
                      "parent": "head"})
        # NOT named coxa/femur/tibia. Those prefixes are claimed by the
        # runtime's leg solver, and `saintfall-optimize-model.mjs`
        # strips their animation channels from every clip except
        # `death` - so a scythe called `femur_L` would have had its
        # keyframes deleted on the way out and the strike would play
        # with the blade held perfectly still.
        bones.append({"name": f"scapula_{side}",
                      "head": tuple(mirror(SCY_SHOULDER, sx)),
                      "tail": tuple(mirror(SCY_ELBOW, sx)),
                      "parent": "thorax"})
        bones.append({"name": f"brachium_{side}",
                      "head": tuple(mirror(SCY_ELBOW, sx)),
                      "tail": tuple(mirror(SCY_WRIST, sx)),
                      "parent": f"scapula_{side}", "connect": True})
        bones.append({"name": f"blade_{side}",
                      "head": tuple(mirror(SCY_WRIST, sx)),
                      "tail": tuple(mirror(SCY_TIP, sx)),
                      "parent": f"brachium_{side}", "connect": True})
    for i, rig in enumerate(LEG_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            coxa, femur, tibia = leg_names(side, i)
            hip = mirror(rig["hip"], sx)
            knee = mirror(rig["knee"], sx)
            foot = mirror(rig["foot"], sx)
            mid = hip.lerp(knee, 0.18)
            bones.append({"name": coxa, "head": tuple(hip), "tail": tuple(mid),
                          "parent": "thorax"})
            bones.append({"name": femur, "head": tuple(mid), "tail": tuple(knee),
                          "parent": coxa, "connect": True})
            bones.append({"name": tibia, "head": tuple(knee), "tail": tuple(foot),
                          "parent": femur, "connect": True})
            bones.append({"name": f"foot{i}_{side}", "head": tuple(foot),
                          "tail": tuple(foot + Vector((0, 0, 0.20))),
                          "parent": tibia, "connect": True})
    return bones


# ----------------------------------------------------------------------
# animation
# ----------------------------------------------------------------------

BODY_BONES = ["thorax", "abdomen1", "abdomen2", "abdomen3", "head",
              "mandible_L", "mandible_R",
              "scapula_L", "scapula_R", "brachium_L", "brachium_R",
              "blade_L", "blade_R"]


def build_actions(arm) -> list[str]:
    scene = bpy.context.scene
    names: list[str] = []

    def rest():
        return {b: (0.0, 0.0, 0.0) for b in BODY_BONES}

    def sym(pose, stem, x, y, z):
        """Mirror a pose onto both sides.

        Y and Z negate across the mirror and X does not - the bones
        are built by reflecting positions through x=0, so a rotation
        about the shared long axis keeps its sign while the two
        off-axis components swap handedness.
        """
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

    # ---- idle ---------------------------------------------------------
    # A slow breath through the gaster and a drift in the antennae.
    # The scythes stay shut: the fold IS the idle silhouette.
    frames = []
    for k, (frame, t) in enumerate(((0, 0.0), (48, 1.0), (96, 0.0))):
        pose = rest()
        pose["thorax"] = (-0.020 * t, 0.0, 0.0)
        pose["abdomen1"] = (0.030 * t, 0.0, 0.0)
        pose["abdomen2"] = (0.026 * t, 0.012 * math.sin(t * PI), 0.0)
        pose["abdomen3"] = (0.020 * t, -0.018 * math.sin(t * PI), 0.0)
        pose["head"] = (0.026 * t, 0.030 * math.sin(t * PI * 2), 0.0)
        sym(pose, "scapula", 0.0, 0.014 * t, 0.0)
        sym(pose, "brachium", -0.022 * t, 0.0, 0.0)
        sym(pose, "blade", 0.030 * t, 0.0, 0.0)
        sym(pose, "mandible", 0.0, 0.030 * t, 0.0)
        frames.append((frame, pose))
    bake("idle", frames, 96)

    # ---- alert --------------------------------------------------------
    # The threat display, and the mechanic. The gaster ARCHES UP and
    # forward over the back, which lifts the lit egg sacs into view
    # from behind - the direction the player is most likely to be
    # standing in when this fires - and the scythes open wide.
    frames = []
    for frame, t in ((0, 0.0), (16, 1.12), (30, 1.0), (56, 1.0)):
        pose = rest()
        pose["thorax"] = (-0.14 * t, 0.0, 0.0)
        # Three bones in a chain COMPOUND. The first pass keyed
        # -0.42/-0.34/-0.24, reasoning about each segment on its own,
        # and the tip therefore ended up a full radian off rest: the
        # gaster curled under the thorax and ten metres of animal
        # rendered as a four-metre ball. Length is this creature's
        # entire identity and the alert pose was deleting it. These
        # lift the sacs into view and stop.
        pose["abdomen1"] = (-0.20 * t, 0.0, 0.0)
        pose["abdomen2"] = (-0.15 * t, 0.0, 0.0)
        pose["abdomen3"] = (-0.10 * t, 0.0, 0.0)
        pose["head"] = (-0.16 * t, 0.0, 0.0)
        sym(pose, "scapula", 0.0, 0.42 * t, 0.0)
        sym(pose, "brachium", -0.62 * t, 0.24 * t, 0.0)
        sym(pose, "blade", -0.95 * t, 0.0, 0.0)
        sym(pose, "mandible", 0.0, 0.44 * t, 0.0)
        frames.append((frame, pose))
    bake("alert", frames, 56)

    # ---- strike -------------------------------------------------------
    # One scythe drives out and across while the other braces. An
    # animal that swings both arms symmetrically reads as a machine;
    # the asymmetry is what makes it look like it MEANT it.
    frames = []
    for frame, t, lead in ((0, 0.0, 0.0), (10, -0.45, 1.0),
                           (18, 1.0, 1.0), (26, 0.55, 0.7), (44, 0.0, 0.0)):
        pose = rest()
        pose["thorax"] = (0.16 * t, -0.12 * t * lead, 0.0)
        pose["abdomen1"] = (-0.22 * max(0.0, t), 0.10 * t * lead, 0.0)
        pose["abdomen2"] = (-0.14 * max(0.0, t), 0.08 * t * lead, 0.0)
        pose["abdomen3"] = (-0.08 * max(0.0, t), 0.06 * t * lead, 0.0)
        pose["head"] = (0.20 * t, -0.16 * t * lead, 0.0)
        # Lead arm: unfolds and drives forward. Trailing arm braces
        # in the opposite direction and stays mostly shut.
        pose["scapula_L"] = (0.0, 0.52 * t, 0.0)
        pose["brachium_L"] = (-1.05 * t, 0.30 * t, 0.20 * t)
        pose["blade_L"] = (-1.35 * t, 0.0, 0.0)
        pose["scapula_R"] = (0.0, -0.18 * t, 0.0)
        pose["brachium_R"] = (-0.30 * t, -0.10 * t, 0.0)
        pose["blade_R"] = (-0.34 * t, 0.0, 0.0)
        sym(pose, "mandible", 0.0, 0.62 * max(0.0, t), 0.0)
        frames.append((frame, pose))
    bake("strike", frames, 44)

    # ---- brood --------------------------------------------------------
    # It plants, the gaster curls DOWN and under, and the ovipositor
    # reaches the sand. The runtime spawns off this clip, so the
    # timing is a contract: the low point is frame 22 of 60.
    frames = []
    for frame, t in ((0, 0.0), (14, 0.55), (22, 1.0), (34, 1.0),
                     (46, 0.4), (60, 0.0)):
        pose = rest()
        pose["thorax"] = (0.26 * t, 0.0, 0.0)
        pose["abdomen1"] = (0.62 * t, 0.0, 0.0)
        pose["abdomen2"] = (0.54 * t, 0.0, 0.0)
        pose["abdomen3"] = (0.46 * t, 0.0, 0.0)
        pose["head"] = (0.20 * t, 0.0, 0.0)
        sym(pose, "scapula", 0.0, -0.10 * t, 0.0)
        sym(pose, "brachium", 0.14 * t, 0.0, 0.0)
        sym(pose, "blade", 0.10 * t, 0.0, 0.0)
        sym(pose, "mandible", 0.0, 0.20 * t, 0.0)
        frames.append((frame, pose))
    bake("brood", frames, 60)

    # ---- flinch -------------------------------------------------------
    frames = []
    for frame, t in ((0, 0.0), (5, 1.0), (14, 0.35), (24, 0.0)):
        pose = rest()
        pose["thorax"] = (-0.10 * t, 0.06 * t, 0.0)
        pose["abdomen1"] = (0.14 * t, -0.08 * t, 0.0)
        pose["abdomen2"] = (0.12 * t, -0.10 * t, 0.0)
        pose["abdomen3"] = (0.10 * t, -0.12 * t, 0.0)
        pose["head"] = (-0.22 * t, 0.10 * t, 0.0)
        sym(pose, "scapula", 0.0, -0.14 * t, 0.0)
        sym(pose, "brachium", 0.20 * t, 0.0, 0.0)
        sym(pose, "blade", 0.24 * t, 0.0, 0.0)
        frames.append((frame, pose))
    bake("flinch", frames, 24)

    # ---- death --------------------------------------------------------
    # The ONE clip that owns its leg channels - the optimiser strips
    # them everywhere else, because the runtime IK owns the legs while
    # the animal is alive. A dead one is not walking, so the legs
    # fold under it here and nothing fights the solver.
    frames = []
    for frame, t in ((0, 0.0), (12, 0.30), (30, 0.78), (54, 1.0), (78, 1.0)):
        pose = rest()
        pose["thorax"] = (0.52 * t, 0.14 * t, 0.10 * t)
        pose["abdomen1"] = (0.30 * t, -0.20 * t, 0.0)
        pose["abdomen2"] = (0.26 * t, -0.26 * t, 0.0)
        pose["abdomen3"] = (0.22 * t, -0.30 * t, 0.0)
        pose["head"] = (0.62 * t, 0.20 * t, 0.0)
        sym(pose, "scapula", 0.0, -0.34 * t, 0.0)
        sym(pose, "brachium", 0.62 * t, 0.0, 0.0)
        sym(pose, "blade", 0.70 * t, 0.0, 0.0)
        sym(pose, "mandible", 0.0, 0.30 * t, 0.0)
        # Legs buckle: femurs collapse outward, tibiae fold under.
        for i in range(len(LEG_RIG)):
            for side, sgn in (("L", 1.0), ("R", -1.0)):
                coxa, femur, tibia = leg_names(side, i)
                pose[coxa] = (0.0, 0.0, sgn * 0.30 * t)
                pose[femur] = (0.72 * t + 0.10 * i * t, 0.0, 0.0)
                pose[tibia] = (-1.15 * t, 0.0, 0.0)
        frames.append((frame, pose))
    bake("death", frames, 78)

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
    material = kit.vertex_colour_material("matriarch-chitin")
    mesh_obj = kit.build_mesh_object("matriarch", parts, material)
    arm = kit.build_armature("matriarch-rig", build_bone_table())
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
