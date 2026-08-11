#!/usr/bin/env python3
"""Build the Bloom's Harrow: SAINTFALL's armoured breaker.

    blender --background --factory-startup \
      --python scripts/blender/saintfall-harrow.py -- \
      --output assets/models/saintfall/source/harrow.raw.glb \
      --report output/saintfall/models/harrow.json

WHY IT IS SHORT

The obvious way to build a heavy is to make it tall, and it is wrong.
Height reads as REACH; a thing that towers is a thing that can get at
you. Weight reads as WIDTH and as being LOW - a mass with its belly
near the ground and its shoulders wider than its stride. So the
Harrow is a metre shorter than the Gleaner and twice as convincing,
and the Gleaner keeps sole ownership of "tall" in the bestiary.

It is a rhinoceros beetle: a hinged cephalic horn over a fixed
clypeal one, and the gap between them is the tell. That gap is the
only large piece of NEGATIVE space on an otherwise solid animal, so
it is what survives at range - the same trick as the Gleaner's legs,
applied to a shape that has no legs to spare.

THE ELYTRA ARE A GAMEPLAY SURFACE, NOT DECORATION

Its wing cases are closed at rest and FLARE OPEN when it wakes,
exposing lit membrane underneath. That single hinge does four jobs:

  - it is the alert tell, readable from behind and at any range;
  - it makes the animal visibly bigger the moment it becomes
    dangerous, which is what a threat display is for;
  - it puts a bright target on a creature that is otherwise almost
    black, so there is something to aim AT;
  - and it means the armour reads as armour, because the player has
    seen it move.

Painted from CHITIN_DEEP. Almost all of its surface detail is carried
by seams rather than by plates - a black animal has no midtones to
model with, so the light has to come from inside it.
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
# ----------------------------------------------------------------------

BODY_Y = 1.34            # carapace centreline
TAIL_Z = -2.05

# Braced wide, and the middle pair widest of all. A hexapod whose feet
# track under its own shoulders reads as delicate; one whose feet are
# outside its own width reads as planted, and planted is the whole
# character of this caste.
LEG_RIG = (
    {"hip": (0.52, BODY_Y - 0.22, 0.52), "knee": (1.30, 2.02, 0.60),
     "foot": (1.72, 0.0, 0.86)},
    {"hip": (0.56, BODY_Y - 0.24, -0.06), "knee": (1.46, 2.10, -0.10),
     "foot": (1.92, 0.0, -0.20)},
    {"hip": (0.52, BODY_Y - 0.24, -0.62), "knee": (1.36, 2.00, -0.80),
     "foot": (1.80, 0.0, -1.24)},
)

HEAD_BASE = Vector((0.0, BODY_Y - 0.10, 0.66))
HEAD_TIP = Vector((0.0, BODY_Y - 0.28, 1.30))
HORN_BASE = Vector((0.0, BODY_Y + 0.22, 0.92))
HORN_TIP = Vector((0.0, BODY_Y + 1.06, 1.62))
LOWER_HORN_BASE = Vector((0.0, BODY_Y - 0.36, 1.06))
LOWER_HORN_TIP = Vector((0.0, BODY_Y + 0.04, 1.86))


def leg_names(side: str, i: int) -> tuple[str, str, str]:
    return (f"coxa{i}_{side}", f"femur{i}_{side}", f"tibia{i}_{side}")


def mirror(p, sx: float) -> Vector:
    return Vector((p[0] * sx, p[1], p[2]))


def spike(a, b, r0=0.040, r1=0.005, sides=5, bow=None, seed=1):
    a, b = Vector(a), Vector(b)
    pts = kit.arc_path(a, b, bow, n=3) if bow else [a, a.lerp(b, 0.5), b]
    return kit.tube(pts, [r0, (r0 + r1) * 0.55, r1], sides=sides,
                    mode="transport", seed=seed, cap_end=False)


def chitin_t(params, base=0.30, span=0.56, power=1.0, along=0.0, glow=0.0,
             ramp=None):
    return kit.paint_t(
        params, ramp or CHITIN,
        lambda t, a, u: base + span * kit.topside(u, power) + along * t,
        glow=glow,
    )


def add(parts, name, bone, built, colors):
    parts.append(Part(name, bone, built[0], built[1], colors))


def abdomen_path():
    return kit.bezier((0, BODY_Y + 0.10, -0.42), (0, BODY_Y + 0.18, -0.92),
                      (0, BODY_Y + 0.04, -1.52), (0, BODY_Y - 0.26, TAIL_Z),
                      n=15)


def abd_radius(t: float) -> float:
    return 0.20 + 0.56 * math.sin(min(1.0, t * 1.04) ** 0.72 * PI) ** 0.55


# ----------------------------------------------------------------------
# geometry
# ----------------------------------------------------------------------

def build_thorax(parts) -> None:
    body = kit.bezier((0, BODY_Y + 0.06, 0.68), (0, BODY_Y + 0.14, 0.30),
                      (0, BODY_Y + 0.12, -0.06), (0, BODY_Y + 0.06, -0.44), n=5)
    br = [(0.36, 0.42), (0.50, 0.62), (0.56, 0.72), (0.56, 0.72),
          (0.52, 0.68), (0.44, 0.58)]
    v, f, p = kit.tube(body, br, sides=9, mode="up", phase=0.18,
                       profile=kit.flutes(9, 0.03))
    add(parts, "thorax", "thorax", (v, f), chitin_t(p, 0.16, 0.50, 1.4))

    # Pronotal shield. On a black animal the plate cannot be read by
    # its own value, so it is read by its EDGE - which is why it is
    # lifted well proud and given a hard flare at the front.
    v, f, p = kit.shell(body, br, arc=(-0.31, 0.31), steps=7,
                        thick=0.06, lift=0.05,
                        profile=lambda t, u: 1.0 + 0.10 * (1.0 - t) ** 2)
    add(parts, "pronotum", "thorax", (v, f), chitin_t(p, 0.26, 0.62, 1.2))

    # ...and the lit gap the shield leaves along each flank. This is
    # most of the surface information on the front half of the animal.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        a0 = 0.315 * sx
        v, f, p = kit.shell(body, br, arc=(a0, a0 + 0.05 * sx), steps=3,
                            thick=0.016, lift=0.006)
        add(parts, f"pronseam_{side}", "thorax", (v, f),
            kit.paint_t(p, kit.BIO_RAMP,
                        lambda t, a, u: 0.16 + 0.46 * math.sin(t * PI),
                        glow=lambda t, a, u: kit.GLOW_SEAM * (0.4 + 0.6 * math.sin(t * PI))))

    # Shoulder bosses and the two big pronotal spines that give the
    # front of the animal its width.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        v, f, p = spike((sx * 0.60, BODY_Y + 0.18, 0.34),
                        (sx * 1.16, BODY_Y + 0.44, -0.20),
                        r0=0.11, r1=0.010, sides=6,
                        bow=(0, 0.08, 0.02), seed=11)
        add(parts, f"pronspine_{side}", "thorax", (v, f),
            chitin_t(p, 0.30, 0.48, along=0.26))

    v, f, p = kit.shell(body, br, arc=(0.33, 0.67), steps=5,
                        thick=0.05, lift=0.006)
    add(parts, "sternum", "thorax", (v, f), chitin_t(p, 0.04, 0.16))


def build_abdomen(parts) -> None:
    """The mass under the wing cases, and the wing cases themselves."""
    path = abdomen_path()
    n = len(path)
    base = [abd_radius(i / (n - 1)) for i in range(n)]
    radii = [(r * 0.92, r) for r in base]        # wider than tall

    v, f, p = kit.tube(path, radii, sides=9, mode="up", phase=0.2)
    add(parts, "abdomen", "abdomen", (v, f), chitin_t(p, 0.12, 0.40, 1.4))

    # The membrane under the wing cases. COVERED at rest and revealed
    # when they flare, which is the entire point: the alert pose has to
    # hand the player a target that the idle pose did not.
    #
    # Dark, with the light in RIDGES rather than spread across it. The
    # first cut lit the whole surface evenly and the animal opened into
    # a solid teal shell - which is bright, and reads as painted
    # plastic, and gives the eye nothing to aim at because all of it is
    # equally the target. Banding it means the exposed back has form,
    # and the brightest band sits on the spine where the shot should go.
    mrad = [(r[0] * 1.02, r[1] * 1.02) for r in radii]
    v, f, p = kit.shell(path, mrad, arc=(-0.30, 0.30), steps=7,
                        thick=0.02, lift=0.0)
    add(parts, "underwing", "abdomen", (v, f),
        kit.paint_t(p, kit.BIO_RAMP,
                    lambda t, a, u: 0.03 + 0.14 * kit.topside(u),
                    glow=lambda t, a, u: kit.GLOW_FAINT))

    # ...and the veins, as separate strips rather than as a gradient
    # painted across the membrane. Discrete geometry gives a HARD line;
    # a gradient over seven arc samples gives a smear, and a smear is
    # what made the first cut read as one solid teal shell.
    for k, aa in enumerate((-0.225, -0.135, -0.045, 0.045, 0.135, 0.225)):
        v, f, p = kit.shell(path, mrad, arc=(aa, aa + 0.022), steps=2,
                            thick=0.016, lift=0.012)
        add(parts, f"vein{k}", "abdomen", (v, f),
            kit.paint_t(p, kit.BIO_RAMP,
                        lambda t, a, u: 0.22 + 0.56 * math.sin(min(1.0, t * 1.1) * PI) ** 0.5,
                        glow=lambda t, a, u: kit.GLOW_SEAM * 1.5
                        * math.sin(min(1.0, t * 1.1) * PI) ** 0.6))

    # Segment ribs on the exposed rear third, where no elytron reaches.
    for k, (i0, i1) in enumerate(((11, 13), (13, 15))):
        seg = path[i0:i1 + 1]
        rad = radii[i0:i1 + 1]
        v, f, p = kit.shell(seg, rad, arc=(-0.34, 0.34), steps=6,
                            thick=0.036, lift=0.030,
                            profile=lambda t, u: 1.0 + 0.14 * (1.0 - t) ** 2)
        add(parts, f"tergite{k}", "abdomen", (v, f), chitin_t(p, 0.20, 0.54, 1.2))

    # --- elytra --------------------------------------------------------
    # Two heavy half-domes, hinged along the spine. Swept a little
    # WIDER than the body they cover so they overhang it and throw a
    # shadow down each flank - a plate flush with what it covers is a
    # paint job.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        e0, e1 = 0, 13
        seg = path[e0:e1 + 1]
        rad = [(r[0] * 1.06 + 0.03, r[1] * 1.06 + 0.03) for r in radii[e0:e1 + 1]]
        # Started off the spine, not at it. The gap between the two
        # cases is a lit suture running the length of the animal - the
        # one bright line on a black mass, and the thing that tells you
        # from behind that the armour is two pieces and can open.
        arc = (0.028 * sx, 0.31 * sx)
        v, f, p = kit.shell(seg, rad, arc=arc, steps=7, thick=0.055,
                            lift=0.02,
                            profile=lambda t, u: 1.0 + 0.06 * (1.0 - t) ** 2)
        add(parts, f"elytron_{side}", f"elytron_{side}", (v, f),
            chitin_t(p, 0.14, 0.58, 1.5, along=0.10))

        # Longitudinal striae, the ridges every beetle's wing case has.
        # They cost little and they are the only thing that gives a big
        # black curved surface any direction at all.
        for k, uu in enumerate((0.30, 0.58, 0.84)):
            a = arc[0] + (arc[1] - arc[0]) * uu
            v, f, p = kit.shell(seg, rad, arc=(a, a + 0.012 * sx), steps=1,
                                thick=0.012, lift=0.075)
            add(parts, f"stria{k}_{side}", f"elytron_{side}", (v, f),
                chitin_t(p, 0.34, 0.30))


def build_head(parts) -> None:
    """Head capsule, the hinged horn, the lower horn, and crushers."""
    path = [HEAD_BASE, HEAD_BASE.lerp(HEAD_TIP, 0.5), HEAD_TIP]
    v, f, p = kit.tube(path, [(0.30, 0.36), (0.28, 0.34), (0.18, 0.24)],
                       sides=7, mode="up", phase=0.2)
    add(parts, "head", "head", (v, f), chitin_t(p, 0.18, 0.46, 1.2))

    # --- cephalic horn -------------------------------------------------
    # The single loudest thing in the outline. Thick at the root,
    # tapering hard, and FORKED at the tip, because a fork reads at a
    # distance where a point has already vanished.
    horn = kit.bezier(HORN_BASE, (0.0, BODY_Y + 0.76, 1.00),
                      (0.0, BODY_Y + 1.04, 1.28), HORN_TIP, n=7)
    v, f, p = kit.tube(horn, [(0.19, 0.14), (0.175, 0.13), (0.155, 0.115),
                              (0.132, 0.098), (0.108, 0.080), (0.084, 0.062),
                              (0.058, 0.044), (0.034, 0.026)],
                       sides=6, mode="up")
    add(parts, "horn", "horn", (v, f), chitin_t(p, 0.22, 0.46, along=0.34))
    for side, sx in (("L", 1.0), ("R", -1.0)):
        v, f, p = spike(horn[6], horn[6] + Vector((sx * 0.20, 0.24, 0.14)),
                        r0=0.048, r1=0.006, sides=5,
                        bow=(0, 0.03, 0.02), seed=17)
        add(parts, f"hornfork_{side}", "horn", (v, f),
            chitin_t(p, 0.56, 0.36, along=0.24))
    # A lit collar at the horn's root: it says the horn is grown, not
    # bolted on, and it puts a highlight exactly where the eye lands.
    v, f = kit.blob(0.20, sides=8, rings=2, squash=0.55, seed=5)
    v = kit.transform(v, rotate=(0.5, 0, 0), translate=tuple(HORN_BASE))
    parts.append(Part("hornroot", "head", v, f,
                      kit.paint(v, kit.BIO_RAMP, lambda q: 0.14,
                                glow=kit.GLOW_SEAM)))

    # --- lower horn ----------------------------------------------------
    lower = kit.bezier(LOWER_HORN_BASE, (0.0, BODY_Y - 0.30, 1.36),
                       (0.0, BODY_Y - 0.14, 1.66), LOWER_HORN_TIP, n=5)
    v, f, p = kit.tube(lower, [(0.15, 0.20), (0.135, 0.18), (0.115, 0.152),
                               (0.092, 0.120), (0.066, 0.086), (0.036, 0.048)],
                       sides=6, mode="up")
    add(parts, "lowerhorn", "head", (v, f), chitin_t(p, 0.24, 0.44, along=0.30))

    # --- eyes ----------------------------------------------------------
    # Set low and wide on the head, and small. This caste hunts by
    # walking into things; the eyes are not the story, the horn is.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        at = (sx * 0.30, BODY_Y - 0.10, 0.86)
        v, f = kit.dome(0.105, 0.075, rz=0.135, rings=3, sides=8, cut=0.95)
        v = kit.transform(v, rotate=(-0.2, 0.0, sx * -1.15), translate=at)
        parts.append(Part(f"eye_{side}", "head", v, f,
                          kit.paint(v, kit.BIO_RAMP,
                                    lambda q: 0.46 + 1.6 * max(0.0, q.y - BODY_Y + 0.06),
                                    glow=kit.GLOW_EYE)))
        v, f = kit.dome(0.128, 0.048, rz=0.162, rings=2, sides=8, cut=0.6)
        v = kit.transform(v, rotate=(-0.2, 0.0, sx * -1.15), translate=at)
        parts.append(Part(f"eyerim_{side}", "head", v, f,
                          kit.paint(v, CHITIN, lambda q: 0.08)))

        # --- crushers --------------------------------------------------
        # Short, blunt and heavy. The Thresher's mandibles are sickles
        # that close; these are hammers that meet.
        m0 = Vector((sx * 0.20, BODY_Y - 0.36, 1.14))
        mand = kit.bezier(m0, (sx * 0.26, BODY_Y - 0.44, 1.34),
                          (sx * 0.20, BODY_Y - 0.46, 1.52),
                          (sx * 0.07, BODY_Y - 0.42, 1.60), n=5)
        v, f, p = kit.tube(mand, [(0.115, 0.095), (0.110, 0.090), (0.098, 0.080),
                                  (0.082, 0.066), (0.062, 0.050), (0.034, 0.028)],
                           sides=5, mode="transport")
        add(parts, f"mandible_{side}", f"mandible_{side}", (v, f),
            chitin_t(p, 0.30, 0.36, along=0.30))
        for k, tt in enumerate((0.35, 0.62)):
            j = int(tt * (len(mand) - 1))
            root = mand[j]
            v, f, p = spike(root, root + Vector((sx * -0.10, 0.05, 0.03)),
                            r0=0.034, r1=0.005, sides=4, seed=k + 21)
            add(parts, f"crusher{k}_{side}", f"mandible_{side}", (v, f),
                chitin_t(p, 0.62, 0.28))


def build_legs(parts) -> None:
    """Six braced legs. Thick enough to look like they carry the mass."""
    for i, rig in enumerate(LEG_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            coxa_b, femur_b, tibia_b = leg_names(side, i)
            foot_b = f"foot{i}_{side}"
            hip = mirror(rig["hip"], sx)
            knee = mirror(rig["knee"], sx)
            foot = mirror(rig["foot"], sx)
            mid = hip.lerp(knee, 0.20)

            v, f, p = kit.tube([hip, hip.lerp(mid, 0.5), mid],
                               [0.22, 0.21, 0.195], sides=7, mode="transport")
            add(parts, f"coxaGeo{i}_{side}", coxa_b, (v, f),
                chitin_t(p, 0.10, 0.30))
            v, f = kit.blob(0.125, sides=7, rings=2, seed=23 + i)
            v = kit.transform(v, translate=tuple(mid))
            parts.append(Part(f"trochanter{i}_{side}", femur_b, v, f,
                              kit.flat(v, kit.BIO_DIM, kit.GLOW_FAINT)))

            fem = kit.arc_path(mid, knee, (sx * 0.10, -0.06, 0.0), n=5)
            v, f, p = kit.tube(fem, [0.190, 0.205, 0.190, 0.166, 0.140, 0.116],
                               sides=7, mode="transport",
                               profile=kit.flutes(7, 0.06))
            add(parts, f"femurGeo{i}_{side}", femur_b, (v, f),
                chitin_t(p, 0.16, 0.46, along=0.14))
            # One heavy spine per femur, swept back. Six of them along
            # the top of the animal are what break the outline up when
            # it is a black mass moving across sand.
            v, f, p = spike(fem[3], fem[3] + Vector((sx * 0.12, 0.30, -0.20)),
                            r0=0.055, r1=0.006, sides=5, seed=37 + i)
            add(parts, f"femspine{i}_{side}", femur_b, (v, f),
                chitin_t(p, 0.44, 0.34))

            v, f = kit.blob(0.132, sides=7, rings=2, seed=41 + i)
            v = kit.transform(v, translate=tuple(knee))
            parts.append(Part(f"kneeGeo{i}_{side}", tibia_b, v, f,
                              kit.paint(v, CHITIN, lambda q: 0.40)))

            tib = kit.arc_path(knee, foot, (sx * 0.08, -0.04, 0.0), n=5)
            v, f, p = kit.tube(tib, [0.125, 0.113, 0.098, 0.083, 0.068, 0.054],
                               sides=6, mode="transport")
            add(parts, f"tibiaGeo{i}_{side}", tibia_b, (v, f),
                chitin_t(p, 0.18, 0.42, along=-0.10))
            for k, tt in enumerate((0.36, 0.62, 0.84)):
                j = int(tt * (len(tib) - 1))
                r0 = tib[j]
                v, f, p = spike(r0, r0 + Vector((sx * 0.12, 0.04, -0.16)),
                                r0=0.034, r1=0.004, sides=4, seed=k + 31 + i)
                add(parts, f"tibspur{i}{k}_{side}", tibia_b, (v, f),
                    chitin_t(p, 0.42, 0.30))

            # Splayed tarsal pad. Wider than the other two castes get,
            # because a heavy that stands on points reads as unstable.
            v, f = kit.dome(0.115, 0.055, rz=0.145, rings=2, sides=7, cut=0.9)
            v = kit.transform(v, translate=(foot.x, foot.y + 0.020, foot.z))
            parts.append(Part(f"tarsus{i}_{side}", foot_b, v, f,
                              kit.paint(v, CHITIN, lambda q: 0.14)))
            for k, (dx, dz) in enumerate(((0.05, 0.18), (-0.05, -0.15),
                                          (0.16, -0.02))):
                claw = kit.arc_path((foot.x, foot.y + 0.055, foot.z),
                                    (foot.x + sx * dx, foot.y + 0.006,
                                     foot.z + dz * 1.25),
                                    (0, 0.040, 0), n=3)
                v, f, p = kit.tube(claw, [0.040, 0.030, 0.018, 0.006],
                                   sides=4, mode="transport", cap_end=False)
                add(parts, f"claw{i}{k}_{side}", foot_b, (v, f),
                    chitin_t(p, 0.44, 0.28))


def build_parts() -> list[Part]:
    parts: list[Part] = []
    build_thorax(parts)
    build_abdomen(parts)
    build_head(parts)
    build_legs(parts)
    return parts


# ----------------------------------------------------------------------
# rig
# ----------------------------------------------------------------------

def build_bone_table() -> list[dict]:
    a = abdomen_path()
    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0.40, 0)},
        {"name": "thorax", "head": (0, BODY_Y, 0.0), "tail": (0, BODY_Y, 0.50),
         "parent": "root"},
        {"name": "abdomen", "head": tuple(a[0]), "tail": tuple(a[-1]),
         "parent": "thorax"},
        {"name": "head", "head": tuple(HEAD_BASE), "tail": tuple(HEAD_TIP),
         "parent": "thorax"},
        {"name": "horn", "head": tuple(HORN_BASE), "tail": tuple(HORN_TIP),
         "parent": "head"},
    ]
    for side, sx in (("L", 1.0), ("R", -1.0)):
        bones.append({"name": f"mandible_{side}",
                      "head": (sx * 0.20, BODY_Y - 0.36, 1.14),
                      "tail": (sx * 0.07, BODY_Y - 0.42, 1.60),
                      "parent": "head"})
        # The wing-case hinge.
        #
        # The bone runs ALONG THE SPINE, not out to the side, because
        # an elytron opens by rolling about the body's own long axis.
        # Point the bone outward instead and the clip has to rotate
        # about a local axis that is not the hinge, which lifts the
        # plate off the body and flies it away rather than opening it.
        # The small lateral offset only keeps left and right from being
        # coincident bones.
        bones.append({"name": f"elytron_{side}",
                      "head": (sx * 0.04, BODY_Y + 0.30, -0.42),
                      "tail": (sx * 0.04, BODY_Y + 0.10, TAIL_Z + 0.30),
                      "parent": "abdomen"})
    for i, rig in enumerate(LEG_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            coxa, femur, tibia = leg_names(side, i)
            hip = mirror(rig["hip"], sx)
            knee = mirror(rig["knee"], sx)
            foot = mirror(rig["foot"], sx)
            mid = hip.lerp(knee, 0.20)
            bones.append({"name": coxa, "head": tuple(hip), "tail": tuple(mid),
                          "parent": "thorax"})
            bones.append({"name": femur, "head": tuple(mid), "tail": tuple(knee),
                          "parent": coxa, "connect": True})
            bones.append({"name": tibia, "head": tuple(knee), "tail": tuple(foot),
                          "parent": femur, "connect": True})
            # The leaf bone the runtime measures the tibia against;
            # glTF keeps bone heads and throws tails away.
            bones.append({"name": f"foot{i}_{side}", "head": tuple(foot),
                          "tail": tuple(foot + Vector((0, 0, 0.18))),
                          "parent": tibia, "connect": True})
    return bones


# ----------------------------------------------------------------------
# animation
# ----------------------------------------------------------------------

BODY_BONES = ["thorax", "abdomen", "head", "horn", "mandible_L", "mandible_R",
              "elytron_L", "elytron_R"]


def build_actions(arm) -> list[str]:
    scene = bpy.context.scene
    names: list[str] = []

    def rest():
        return {b: (0.0, 0.0, 0.0) for b in BODY_BONES}

    def sym(pose, stem, x, y, z):
        pose[f"{stem}_L"] = (x, y, z)
        pose[f"{stem}_R"] = (x, -y, -z)

    # --- idle ----------------------------------------------------------
    # Barely moves. Stillness is a characterisation: the Gleaner sways
    # because it cannot help it, the Thresher fidgets, and this thing
    # breathes. The elytra stay SHUT.
    act = kit.new_action(arm, "idle")
    scene.frame_end = 120
    for frame, k in ((1, 0.0), (34, 1.0), (70, 0.25), (120, 0.0)):
        pose = rest()
        pose["thorax"] = (0.012 * k, 0.0, 0.008 * math.sin(k * 3.0))
        pose["abdomen"] = (0.035 * k, 0.015 * math.sin(k * 2.0), 0.0)
        pose["head"] = (-0.05 * k, 0.06 * math.sin(k * 2.6), 0.0)
        pose["horn"] = (-0.02 * k, 0.0, 0.0)
        sym(pose, "mandible", 0.0, 0.0, -0.10 * k)
        sym(pose, "elytron", 0.0, 0.03 * k, 0.0)
        kit.key_pose(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("idle")

    # --- alert ----------------------------------------------------------
    # THE WING CASES CRACK OPEN. Everything else is secondary: it lifts
    # its front, drops its horn to level, and gets visibly wider - and
    # the lit membrane the elytra were covering becomes a target the
    # player did not have a second ago.
    act = kit.new_action(arm, "alert")
    for frame, k in ((1, 0.0), (12, 1.18), (20, 1.0), (46, 1.0)):
        pose = rest()
        pose["thorax"] = (-0.22 * k, 0.0, 0.0)
        pose["abdomen"] = (0.20 * k, 0.0, 0.0)
        pose["head"] = (0.16 * k, 0.0, 0.0)
        pose["horn"] = (0.10 * k, 0.0, 0.0)
        sym(pose, "mandible", 0.0, 0.0, -0.46 * k)
        sym(pose, "elytron", 0.0, 0.86 * k, 0.0)
        kit.key_pose(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("alert")

    # --- strike ---------------------------------------------------------
    # A shovelling GORE, not a bite: the head drops, the horn swings up
    # through the arc, and the whole body follows it. Long windup, one
    # frame of contact.
    act = kit.new_action(arm, "strike")
    beats = (
        (1, -0.12, 0.0, 0.0, 0.30),
        (14, 0.40, 0.44, -0.30, 0.62),    # head buried, horn cocked low
        (19, -0.52, -0.66, 0.34, 0.12),   # gore
        (27, -0.16, -0.18, 0.10, 0.20),
        (40, 0.0, 0.0, 0.0, 0.30),
    )
    for frame, hd, hn, thx, jaw in beats:
        pose = rest()
        pose["head"] = (hd, 0.0, 0.0)
        pose["horn"] = (hn, 0.0, 0.0)
        pose["thorax"] = (thx, 0.0, 0.0)
        pose["abdomen"] = (-thx * 0.6, 0.0, 0.0)
        sym(pose, "mandible", 0.0, 0.0, -jaw)
        sym(pose, "elytron", 0.0, 0.70, 0.0)
        kit.key_pose(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("strike")

    # --- flinch ---------------------------------------------------------
    # Small. A two-tonne animal that recoils like a Thresher stops
    # reading as two tonnes, so this one mostly rattles its own plates.
    act = kit.new_action(arm, "flinch")
    for frame, k in ((1, 0.0), (4, 1.0), (11, 0.4), (22, 0.0)):
        pose = rest()
        pose["thorax"] = (0.09 * k, -0.06 * k, 0.05 * k)
        pose["head"] = (0.14 * k, 0.09 * k, 0.0)
        pose["horn"] = (0.10 * k, 0.0, 0.0)
        pose["abdomen"] = (-0.08 * k, 0.0, 0.0)
        sym(pose, "elytron", 0.0, 0.62 + 0.24 * k, 0.0)
        kit.key_pose(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("flinch")

    # --- death ----------------------------------------------------------
    # It goes down on its face. The legs give at the front first, the
    # horn ploughs in, and the wing cases fall shut at the end - which
    # is the beat that tells the player it is over.
    act = kit.new_action(arm, "death")
    leg_bones = [n for i in range(len(LEG_RIG)) for side in ("L", "R")
                 for n in leg_names(side, i)]
    for frame, k, ely in ((1, 0.0, 0.70), (10, 0.40, 0.95), (26, 0.92, 0.60),
                          (42, 1.05, 0.20), (64, 1.0, 0.05)):
        pose = rest()
        pose["thorax"] = (0.46 * k, 0.14 * k, 0.30 * k)
        pose["abdomen"] = (-0.34 * k, 0.0, -0.16 * k)
        pose["head"] = (0.52 * k, -0.18 * k, 0.0)
        pose["horn"] = (0.30 * k, 0.0, 0.0)
        sym(pose, "mandible", 0.0, 0.0, -0.30 * k)
        sym(pose, "elytron", 0.0, ely, 0.0)
        for n in leg_bones:
            side = 1.0 if n.endswith("_L") else -1.0
            if n.startswith("tibia"):
                pose[n] = (0.0, 0.0, -side * 1.10 * k)
            elif n.startswith("femur"):
                pose[n] = (0.0, 0.0, side * 0.50 * k)
            else:
                pose[n] = (0.0, 0.0, side * 0.22 * k)
        kit.key_pose(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("death")

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
    material = kit.vertex_colour_material("harrow-chitin")
    mesh_obj = kit.build_mesh_object("harrow", parts, material)
    arm = kit.build_armature("harrow-rig", build_bone_table())
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
