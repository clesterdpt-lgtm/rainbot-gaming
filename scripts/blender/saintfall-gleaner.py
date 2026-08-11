#!/usr/bin/env python3
"""Build the Bloom's Gleaner: SAINTFALL's ranged caste.

    blender --background --factory-startup \
      --python scripts/blender/saintfall-gleaner.py -- \
      --output assets/models/saintfall/source/gleaner.raw.glb \
      --report output/saintfall/models/gleaner.json

WHAT IT HAS TO DO, BEFORE ANY OF THE MODELLING

The Gleaner replaces a machine. The level used to field a two-legged
Concord servitor as its shooter, and deleting it left a hole with a
hard requirement attached: the player must be able to tell, at two
hundred metres and in one glance, whether the thing on that ridge
shoots back. Species that differ only in decoration do not do that.

So the three castes are separated on the axes a player reads first,
in this order:

  HEIGHT      Thresher 1.2m · Gleaner 3.3m · Harrow 2.4m and squat.
  STANCE      six legs low · four legs stilted · six legs braced.
  OUTLINE     a wedge · an inverted V with a lamp in it · a slab.

This one is a harvestman: a small body slung under an enormous
inverted V of leg, with more empty sky inside its outline than
creature. That negative space is the whole design - it survives haze,
it survives being backlit, and it cannot be confused with anything
else in the game.

THE GUN IS THE SILHOUETTE

Its abdomen is carried up and over its own back on a petiole and
ends, pointing forward past its head, in a spinneret. It is a
scorpion's tail aimed the wrong way, and it is lit from inside.

That does three jobs at once: it says RANGED without a UI marker, it
puts the muzzle where the tracer is actually drawn from, and it gives
the `fire` clip something to cock and snap - a tell the player can
learn, which is the difference between being shot at and being
sniped.

Painted from CHITIN_ASH - cool and mid-dark - and NOT from the pale
ramp it was first built with. See the note on that ramp in the kit:
pale was chosen for legibility against sky, and measured against the
sand it is actually standing in front of for most of the map it came
out at a colour distance of 42, which is a beige animal on a beige
dune. The lantern carries the long-range read instead, which is what
it was for.
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
CHITIN = kit.CHITIN_ASH


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

BODY_Y = 2.22            # thorax centreline, slung under the knees

# Two pairs. The phase table in enemies.js gives 0L/1R and 0R/1L, so
# four legs walk as diagonal pairs - which is what a four-legged
# animal does and the only pattern that keeps it upright at every
# instant of the cycle.
LEG_RIG = (
    {"hip": (0.30, BODY_Y - 0.02, 0.40), "knee": (1.10, 3.30, 0.70),
     "foot": (1.76, 0.0, 1.20)},
    {"hip": (0.30, BODY_Y - 0.02, -0.36), "knee": (1.16, 3.36, -0.78),
     "foot": (1.86, 0.0, -1.42)},
)

# The gaster's sweep: back off the thorax, up over its own body, and
# forward until the spinneret is looking past the head.
GASTER = (
    (0.0, BODY_Y + 0.04, -0.56),
    (0.0, BODY_Y + 0.72, -1.16),
    (0.0, BODY_Y + 1.24, -0.30),
    (0.0, BODY_Y + 0.92, 0.48),
)
NOZZLE_ROOT = Vector((0.0, BODY_Y + 0.92, 0.48))
NOZZLE_TIP = Vector((0.0, BODY_Y + 0.68, 1.04))

NECK_BASE = Vector((0.0, BODY_Y + 0.06, 0.50))
HEAD_AT = Vector((0.0, BODY_Y - 0.22, 0.94))
HEAD_TIP = Vector((0.0, BODY_Y - 0.38, 1.26))

ANTENNA_BASE = (0.10, BODY_Y - 0.10, 0.94)
ANTENNA_TIP = (0.46, BODY_Y - 0.86, 1.86)


def leg_names(side: str, i: int) -> tuple[str, str, str]:
    return (f"coxa{i}_{side}", f"femur{i}_{side}", f"tibia{i}_{side}")


def mirror(p, sx: float) -> Vector:
    return Vector((p[0] * sx, p[1], p[2]))


def gaster_path():
    """One definition, used by BOTH the geometry and the bone table.

    These were two separate `kit.bezier` calls with different point
    counts, which is a bug that hides: the curve is identical, so the
    bones land on it, just not at the joints the plates were cut for -
    and the tail then bends in the middle of a plate instead of at a
    seam.
    """
    return kit.bezier(*GASTER, n=19)


def spike(a, b, r0=0.030, r1=0.004, sides=4, bow=None, seed=1):
    a, b = Vector(a), Vector(b)
    pts = kit.arc_path(a, b, bow, n=3) if bow else [a, a.lerp(b, 0.5), b]
    return kit.tube(pts, [r0, (r0 + r1) * 0.55, r1], sides=sides,
                    mode="transport", seed=seed, cap_end=False)


def chitin_t(params, base=0.30, span=0.52, power=1.0, along=0.0, glow=0.0,
             ramp=None):
    return kit.paint_t(
        params, ramp or CHITIN,
        lambda t, a, u: base + span * kit.topside(u, power) + along * t,
        glow=glow,
    )


def add(parts, name, bone, built, colors):
    parts.append(Part(name, bone, built[0], built[1], colors))


# ----------------------------------------------------------------------
# geometry
# ----------------------------------------------------------------------

def build_thorax(parts) -> None:
    """A small braced box of a body. Everything else hangs off it."""
    body = kit.bezier((0, BODY_Y + 0.02, 0.54), (0, BODY_Y + 0.08, 0.18),
                      (0, BODY_Y + 0.06, -0.20), (0, BODY_Y - 0.02, -0.60), n=5)
    # Bigger than the first cut by half. A body this small under legs
    # this long stopped being a harvestman and became a tripod: there
    # has to be enough animal in the middle of the outline to read as
    # the thing the legs belong to.
    br = [(0.27, 0.26), (0.37, 0.37), (0.42, 0.43), (0.42, 0.43),
          (0.36, 0.37), (0.24, 0.24)]
    v, f, p = kit.tube(body, br, sides=9, mode="up", phase=0.2,
                       profile=kit.flutes(9, 0.04))
    add(parts, "thorax", "thorax", (v, f), chitin_t(p, 0.22, 0.48, 1.3))

    # Notal shield. On this species it is doing structural work in the
    # design as well as the fiction: it is the only wide horizontal
    # surface on the whole animal, so it is the only thing that catches
    # the sun and tells you which way the body is facing.
    v, f, p = kit.shell(body, br, arc=(-0.26, 0.26), steps=6,
                        thick=0.035, lift=0.020,
                        profile=lambda t, u: 1.0 + 0.10 * (1.0 - t) ** 2)
    add(parts, "notum", "thorax", (v, f), chitin_t(p, 0.40, 0.54, 1.1))

    v, f, p = kit.shell(body, br, arc=(0.30, 0.70), steps=5,
                        thick=0.028, lift=0.004)
    add(parts, "sternum", "thorax", (v, f), chitin_t(p, 0.05, 0.18))

    # Coxal shoulders: a bulge where each leg sockets in. Four legs on
    # a small body all meeting at a point reads as a spider toy; the
    # bulges are what make it read as engineered by biology.
    for i, rig in enumerate(LEG_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            hip = mirror(rig["hip"], sx)
            v, f = kit.blob(0.125, sides=7, rings=2, squash=0.85, seed=7 + i)
            v = kit.transform(v, translate=tuple(hip))
            parts.append(Part(f"shoulder{i}_{side}", "thorax", v, f,
                              kit.paint(v, CHITIN, lambda q: 0.20)))

    # Lit spiracle row down each flank - the only glow on the body
    # proper, so the lantern above it keeps its monopoly.
    for i, tz in enumerate((0.24, -0.02, -0.28)):
        for sx in (1.0, -1.0):
            v, f = kit.dome(0.036, 0.020, rings=2, sides=5, cut=0.9)
            v = kit.transform(v, rotate=(0, 0, sx * -1.57),
                              translate=(sx * 0.29, BODY_Y - 0.03, tz))
            parts.append(Part(f"spiracle{i}_{'L' if sx > 0 else 'R'}", "thorax",
                              v, f, kit.flat(v, kit.BIO_DIM, kit.GLOW_FAINT)))


def build_gaster(parts) -> None:
    """Petiole, lantern, and the spinneret it fires from."""
    path = gaster_path()
    prof = [0.075, 0.100, 0.140, 0.190, 0.245, 0.295, 0.335, 0.365,
            0.382, 0.386, 0.376, 0.354, 0.322, 0.286, 0.248, 0.210,
            0.174, 0.140, 0.112, 0.090]
    radii = [(r, r * 0.94) for r in prof]

    # THE LANTERN, and the third attempt at it.
    #
    # First it was banded by four dorsal plates and read as a striped
    # awning. Then it was smoothed into one mass lit from below, and
    # from a player's eye height - looking slightly UP at a creature
    # three and a half metres tall - the lit underside is the one part
    # you cannot see. It read as a satellite dish.
    #
    # What it needed was to be obviously a TAIL: five swollen segments
    # with a hard pinch between each, a plate on the crown of every
    # one, and the light coming out of the pinches. Segmentation
    # survives being seen from any angle, because the steps are in the
    # OUTLINE and not in the shading - which is the same reason a
    # scorpion is legible in a silhouette and a balloon is not.
    def _lit(t, u):
        """How lit this facet is: everything but the armoured crown,
        strongest through the swollen middle of the tail."""
        return ((1.0 - kit.topside(u, 0.5))
                * math.sin(min(1.0, t * 1.10) * PI) ** 0.45)

    v, f, p = kit.tube(path, radii, sides=9, mode="up", phase=0.2,
                       profile=kit.annulate(5, 0.085))
    # Lit BRIGHT, not merely tinted. Painting the lit region at the
    # bottom of the bio ramp and then multiplying by a glow mask gave
    # a dark teal surface emitting a little dark teal - which on
    # screen is a green smudge, not a lantern. The colour has to be up
    # near the top of the ramp WHERE IT IS LIT and near black
    # everywhere else; the mask decides where, not how bright.
    add(parts, "gaster", "gaster", (v, f),
        kit.paint_t(p, kit.BIO_RAMP,
                    lambda t, a, u: 0.04 + 0.86 * _lit(t, u),
                    glow=lambda t, a, u: kit.GLOW_GLAND * _lit(t, u) ** 0.7))

    # A crown plate per segment, sitting on each bulge and stopping
    # short of the pinch behind it - so every joint on the tail is a
    # ring of light between two pieces of armour.
    spans = ((1, 4), (5, 8), (9, 11), (12, 14), (15, 17))
    for k, (i0, i1) in enumerate(spans):
        seg = path[i0:i1 + 1]
        rad = radii[i0:i1 + 1]
        bone = "gaster" if i1 <= 11 else "nozzle"
        v, f, p = kit.shell(seg, rad, arc=(-0.25, 0.25), steps=6,
                            thick=0.032, lift=0.034,
                            profile=lambda t, u: 1.0 + 0.16 * (1.0 - t) ** 2)
        add(parts, f"gastertergite{k}", bone, (v, f),
            chitin_t(p, 0.16, 0.60, 1.25))

    # Petiole sleeve: the narrow waist where it joins the thorax, kept
    # dark so the lantern above it is not connected to the body by a
    # bright line.
    v, f, p = kit.tube(path[0:3], [0.100, 0.112, 0.145], sides=7,
                       mode="up")
    add(parts, "petiole", "petiole", (v, f), chitin_t(p, 0.08, 0.26))

    # The charge chamber: a lit collar where the tail meets the
    # spinneret. It is the highest bright thing on the animal and the
    # one the player's eye finds first, which is exactly where the
    # muzzle wants to be.
    v, f = kit.blob(0.135, sides=8, rings=2, squash=0.68, seed=13)
    v = kit.transform(v, rotate=(0.9, 0, 0), translate=tuple(NOZZLE_ROOT))
    parts.append(Part("chamber", "nozzle", v, f,
                      kit.paint(v, kit.BIO_RAMP, lambda q: 0.62,
                                glow=kit.GLOW_GLAND)))

    # --- spinneret -----------------------------------------------------
    barrel = [NOZZLE_ROOT, NOZZLE_ROOT.lerp(NOZZLE_TIP, 0.5), NOZZLE_TIP]
    v, f, p = kit.tube(barrel, [0.115, 0.086, 0.064], sides=7,
                       mode="transport", cap_end=False)
    add(parts, "spinneret", "nozzle", (v, f), chitin_t(p, 0.10, 0.30))
    # The mouth. One small, very bright disc: this is the thing the
    # player has to find on a ridge line, and it is the only GLOW_EYE
    # on the animal.
    v, f = kit.dome(0.058, 0.038, rings=2, sides=7, cut=0.85)
    v = kit.aim(v, NOZZLE_TIP, NOZZLE_TIP + (NOZZLE_TIP - NOZZLE_ROOT))
    parts.append(Part("muzzle", "nozzle", v, f,
                      kit.flat(v, kit.BIO_PALE, kit.GLOW_EYE)))
    # Three guard prongs around it, so the muzzle has a shape and not
    # just a colour.
    for k in range(3):
        a = k / 3 * TAU + 0.4
        off = Vector((math.cos(a) * 0.078, math.sin(a) * 0.078, 0.0))
        root = NOZZLE_TIP + Vector((off.x, off.y, -0.07))
        v, f, p = spike(root, root + Vector((off.x * 0.5, off.y * 0.5, 0.20)),
                        r0=0.028, r1=0.004, sides=4, seed=k + 5)
        add(parts, f"prong{k}", "nozzle", (v, f), chitin_t(p, 0.46, 0.32))


def build_head(parts) -> None:
    """A small nodding head on a short neck. It is not the weapon."""
    neck = [NECK_BASE, NECK_BASE.lerp(HEAD_AT, 0.55), HEAD_AT]
    v, f, p = kit.tube(neck, [0.13, 0.11, 0.13], sides=7, mode="transport")
    add(parts, "neck", "neck", (v, f), chitin_t(p, 0.16, 0.34))

    path = [HEAD_AT, HEAD_AT.lerp(HEAD_TIP, 0.55), HEAD_TIP]
    v, f, p = kit.tube(path, [(0.15, 0.17), (0.13, 0.15), (0.06, 0.07)],
                       sides=7, mode="up", phase=0.2)
    add(parts, "head", "head", (v, f), chitin_t(p, 0.30, 0.50, 1.1))

    # Ocelli, in the arc a harvestman wears them: a row of small simple
    # eyes rather than one pair of big ones. Dim, because the muzzle is
    # what the player is meant to look at.
    for k in range(5):
        a = (k - 2) / 2.0
        at = HEAD_AT + Vector((a * 0.10, 0.07 - abs(a) * 0.02, 0.10))
        v, f = kit.dome(0.026, 0.020, rings=2, sides=6, cut=0.9)
        v = kit.transform(v, rotate=(-0.7, 0, 0), translate=tuple(at))
        parts.append(Part(f"ocellus{k}", "head", v, f,
                          kit.flat(v, kit.BIO_CYAN, kit.GLOW_SEAM * 1.5)))

    for side, sx in (("L", 1.0), ("R", -1.0)):
        # Stylets: short paired mouthparts. Small, but without them the
        # head ends in a blunt cap and reads as unfinished.
        base = Vector((sx * 0.06, HEAD_TIP.y + 0.02, HEAD_TIP.z - 0.04))
        v, f, p = spike(base, base + Vector((sx * 0.05, -0.10, 0.20)),
                        r0=0.028, r1=0.004, sides=4, seed=3)
        add(parts, f"stylet_{side}", "head", (v, f), chitin_t(p, 0.44, 0.30))

        # Antennae, carried FORWARD AND DOWN like a crane fly's - the
        # opposite of the Thresher's, which sweep back over its body.
        # Two species whose feelers point opposite ways cannot be
        # confused in outline even when everything else is hazed out.
        b = mirror(ANTENNA_BASE, sx)
        t = mirror(ANTENNA_TIP, sx)
        flag = kit.bezier(b, (sx * 0.24, BODY_Y - 0.30, 1.30),
                          (sx * 0.38, BODY_Y - 0.64, 1.66), t, n=7)
        v, f, p = kit.tube(flag, [0.030, 0.026, 0.023, 0.019, 0.016,
                                  0.012, 0.008, 0.004],
                           sides=4, mode="transport")
        add(parts, f"antenna_{side}", f"antenna_{side}", (v, f),
            chitin_t(p, 0.34, 0.30, along=0.34))


def build_legs(parts) -> None:
    """Four stilts. Most of the animal, by outline and by vertex count."""
    for i, rig in enumerate(LEG_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            coxa_b, femur_b, tibia_b = leg_names(side, i)
            foot_b = f"foot{i}_{side}"
            hip = mirror(rig["hip"], sx)
            knee = mirror(rig["knee"], sx)
            foot = mirror(rig["foot"], sx)
            mid = hip.lerp(knee, 0.16)

            v, f, p = kit.tube([hip, hip.lerp(mid, 0.5), mid],
                               [0.130, 0.122, 0.114], sides=6, mode="transport")
            add(parts, f"coxaGeo{i}_{side}", coxa_b, (v, f),
                chitin_t(p, 0.14, 0.32))
            v, f = kit.blob(0.080, sides=6, rings=2, seed=23 + i)
            v = kit.transform(v, translate=tuple(mid))
            parts.append(Part(f"trochanter{i}_{side}", femur_b, v, f,
                              kit.flat(v, kit.BIO_DIM, kit.GLOW_FAINT)))

            # Femur: long, bowed OUTWARD, and thickest near the hip.
            # Half again as thick as the first cut - at 8cm on a 1.4m
            # span these were wires, and a wire has no lit side and no
            # shadow side, so it carries no form at all.
            fem = kit.arc_path(mid, knee, (sx * 0.10, -0.06, 0.0), n=6)
            v, f, p = kit.tube(fem, [0.108, 0.112, 0.104, 0.093, 0.081,
                                     0.069, 0.058],
                               sides=6, mode="transport",
                               profile=kit.flutes(6, 0.05))
            add(parts, f"femurGeo{i}_{side}", femur_b, (v, f),
                chitin_t(p, 0.26, 0.46, along=0.12))

            v, f = kit.blob(0.080, sides=6, rings=2, seed=41 + i)
            v = kit.transform(v, translate=tuple(knee))
            parts.append(Part(f"kneeGeo{i}_{side}", tibia_b, v, f,
                              kit.paint(v, CHITIN, lambda q: 0.48)))
            # The knee spur. On a creature this tall the knees are the
            # highest points on it, so this is the detail that reads
            # against the sky when nothing else does.
            v, f, p = spike(knee, knee + Vector((sx * 0.08, 0.32, -0.18)),
                            r0=0.042, r1=0.005, sides=5, seed=59 + i)
            add(parts, f"kneespur{i}_{side}", tibia_b, (v, f),
                chitin_t(p, 0.66, 0.30))

            # Tibia: very long, bowed the OTHER way, and annulated so it
            # does not read as wire. The double bend is the harvestman
            # line and it is worth every one of these vertices.
            tib = kit.arc_path(knee, foot, (sx * -0.16, -0.12, 0.0), n=7)
            v, f, p = kit.tube(tib, [0.070, 0.064, 0.058, 0.052, 0.046,
                                     0.040, 0.034, 0.026],
                               sides=5, mode="transport",
                               profile=kit.annulate(6, 0.10))
            add(parts, f"tibiaGeo{i}_{side}", tibia_b, (v, f),
                chitin_t(p, 0.30, 0.44, along=-0.16))

            # Tarsal pad and two claws, at the contact point the IK
            # actually plants. Kept above it, never below.
            v, f = kit.dome(0.062, 0.034, rz=0.080, rings=2, sides=6, cut=0.9)
            v = kit.transform(v, translate=(foot.x, foot.y + 0.014, foot.z))
            parts.append(Part(f"tarsus{i}_{side}", foot_b, v, f,
                              kit.paint(v, CHITIN, lambda q: 0.18)))
            for k, dz in enumerate((0.17, -0.13)):
                claw = kit.arc_path((foot.x, foot.y + 0.040, foot.z),
                                    (foot.x - sx * 0.01, foot.y + 0.005,
                                     foot.z + dz * 1.3),
                                    (0, 0.034, 0), n=3)
                v, f, p = kit.tube(claw, [0.028, 0.021, 0.013, 0.004],
                                   sides=4, mode="transport", cap_end=False)
                add(parts, f"claw{i}{k}_{side}", foot_b, (v, f),
                    chitin_t(p, 0.58, 0.28))


def build_parts() -> list[Part]:
    parts: list[Part] = []
    build_thorax(parts)
    build_gaster(parts)
    build_head(parts)
    build_legs(parts)
    return parts


# ----------------------------------------------------------------------
# rig
# ----------------------------------------------------------------------

def build_bone_table() -> list[dict]:
    g = gaster_path()
    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0.30, 0)},
        {"name": "thorax", "head": (0, BODY_Y, 0.0), "tail": (0, BODY_Y, 0.40),
         "parent": "root"},
        {"name": "petiole", "head": tuple(g[0]), "tail": tuple(g[4]),
         "parent": "thorax"},
        # Hinged at the plate seams (see `spans` in build_gaster), so
        # the tail bends between segments the way a tail does.
        {"name": "gaster", "head": tuple(g[4]), "tail": tuple(g[12]),
         "parent": "petiole", "connect": True},
        {"name": "nozzle", "head": tuple(g[12]), "tail": tuple(NOZZLE_TIP),
         "parent": "gaster", "connect": True},
        {"name": "neck", "head": tuple(NECK_BASE), "tail": tuple(HEAD_AT),
         "parent": "thorax"},
        {"name": "head", "head": tuple(HEAD_AT), "tail": tuple(HEAD_TIP),
         "parent": "neck", "connect": True},
    ]
    for side, sx in (("L", 1.0), ("R", -1.0)):
        bones.append({"name": f"antenna_{side}",
                      "head": tuple(mirror(ANTENNA_BASE, sx)),
                      "tail": tuple(mirror(ANTENNA_TIP, sx)),
                      "parent": "head"})
    for i, rig in enumerate(LEG_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            coxa, femur, tibia = leg_names(side, i)
            hip = mirror(rig["hip"], sx)
            knee = mirror(rig["knee"], sx)
            foot = mirror(rig["foot"], sx)
            mid = hip.lerp(knee, 0.16)
            bones.append({"name": coxa, "head": tuple(hip), "tail": tuple(mid),
                          "parent": "thorax"})
            bones.append({"name": femur, "head": tuple(mid), "tail": tuple(knee),
                          "parent": coxa, "connect": True})
            bones.append({"name": tibia, "head": tuple(knee), "tail": tuple(foot),
                          "parent": femur, "connect": True})
            # The leaf bone the runtime measures the tibia's length
            # against - glTF keeps bone heads and throws tails away, so
            # without it the solver has to guess.
            bones.append({"name": f"foot{i}_{side}", "head": tuple(foot),
                          "tail": tuple(foot + Vector((0, 0, 0.14))),
                          "parent": tibia, "connect": True})
    return bones


# ----------------------------------------------------------------------
# animation
# ----------------------------------------------------------------------

BODY_BONES = ["thorax", "petiole", "gaster", "nozzle", "neck", "head",
              "antenna_L", "antenna_R"]


def build_actions(arm) -> list[str]:
    scene = bpy.context.scene
    names: list[str] = []

    def rest():
        return {b: (0.0, 0.0, 0.0) for b in BODY_BONES}

    def sym(pose, stem, x, y, z):
        pose[f"{stem}_L"] = (x, y, z)
        pose[f"{stem}_R"] = (x, -y, -z)

    # --- idle ----------------------------------------------------------
    # It sways. A creature standing on four stilts two metres above its
    # own feet cannot be still, and the sway is what stops it reading
    # as a tripod with a lamp on it.
    act = kit.new_action(arm, "idle")
    scene.frame_end = 120
    for frame, k in ((1, 0.0), (30, 1.0), (60, 0.1), (90, 0.85), (120, 0.0)):
        pose = rest()
        pose["thorax"] = (0.020 * k, 0.05 * math.sin(k * 2.2), 0.030 * math.sin(k * 3.1))
        pose["petiole"] = (-0.05 * k, 0.06 * math.sin(k * 1.7), 0.0)
        pose["gaster"] = (0.06 * k, 0.08 * math.sin(k * 2.6), 0.0)
        pose["nozzle"] = (-0.08 * k, 0.10 * math.sin(k * 3.4), 0.0)
        pose["neck"] = (0.08 * k, 0.12 * math.sin(k * 2.9), 0.0)
        pose["head"] = (-0.10 * k, 0.16 * math.sin(k * 4.1), 0.0)
        sym(pose, "antenna", 0.22 * math.sin(k * 4.6), 0.26 * math.cos(k * 3.3), 0.0)
        kit.key_pose(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("idle")

    # --- alert ---------------------------------------------------------
    # Rises on its legs, drops its head, and swings the gaster forward
    # over the top until the muzzle is looking down its own line of
    # sight. This is the pose the player will see first and most.
    act = kit.new_action(arm, "alert")
    for frame, k in ((1, 0.0), (16, 1.10), (26, 1.0), (48, 1.0)):
        pose = rest()
        pose["thorax"] = (-0.10 * k, 0.0, 0.0)
        pose["petiole"] = (-0.22 * k, 0.0, 0.0)
        pose["gaster"] = (-0.16 * k, 0.0, 0.0)
        pose["nozzle"] = (0.26 * k, 0.0, 0.0)
        pose["neck"] = (0.18 * k, 0.0, 0.0)
        pose["head"] = (0.14 * k, 0.0, 0.0)
        sym(pose, "antenna", -0.30 * k, 0.34 * k, 0.0)
        kit.key_pose(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("alert")

    # --- fire ----------------------------------------------------------
    # Cock, snap, recoil, settle. The cock is long and the snap is two
    # frames, so a player who has seen it once has time to break line
    # of sight the next time - the ranged equivalent of the Thresher's
    # windup, and the same argument: the tell belongs in the animation.
    act = kit.new_action(arm, "fire")
    beats = (
        (1, 0.0, 0.0, 0.0),
        (10, -0.34, -0.26, 0.30),    # cocked back over its own body
        (14, 0.30, 0.26, -0.34),     # snapped forward
        (19, 0.10, 0.06, -0.10),
        (30, 0.0, 0.0, 0.0),
    )
    for frame, pet, gas, noz in beats:
        pose = rest()
        pose["petiole"] = (pet, 0.0, 0.0)
        pose["gaster"] = (gas, 0.0, 0.0)
        pose["nozzle"] = (noz, 0.0, 0.0)
        pose["thorax"] = (-pet * 0.20, 0.0, 0.0)
        pose["neck"] = (0.16, 0.0, 0.0)
        pose["head"] = (0.10, 0.0, 0.0)
        sym(pose, "antenna", -0.24, 0.28, 0.0)
        kit.key_pose(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("fire")

    # --- flinch --------------------------------------------------------
    act = kit.new_action(arm, "flinch")
    for frame, k in ((1, 0.0), (4, 1.0), (11, 0.32), (20, 0.0)):
        pose = rest()
        pose["thorax"] = (0.16 * k, -0.14 * k, 0.14 * k)
        pose["petiole"] = (0.24 * k, 0.10 * k, 0.0)
        pose["gaster"] = (0.20 * k, -0.12 * k, 0.0)
        pose["nozzle"] = (0.26 * k, 0.0, 0.0)
        pose["neck"] = (0.22 * k, 0.16 * k, 0.0)
        pose["head"] = (0.24 * k, 0.0, 0.0)
        sym(pose, "antenna", 0.42 * k, -0.30 * k, 0.0)
        kit.key_pose(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("flinch")

    # --- death ---------------------------------------------------------
    # The one clip that owns the legs, because a corpse whose feet are
    # still being solved against the ground stands back up.
    #
    # A stilt-walker does not topple, it FOLDS - the legs give at the
    # knees and the body drops straight down between them. That is what
    # actually happens to a harvestman and it is far more legible at
    # distance than a fall.
    act = kit.new_action(arm, "death")
    leg_bones = [n for i in range(len(LEG_RIG)) for side in ("L", "R")
                 for n in leg_names(side, i)]
    for frame, k in ((1, 0.0), (8, 0.34), (22, 0.92), (36, 1.06), (56, 1.0)):
        pose = rest()
        pose["thorax"] = (0.30 * k, 0.20 * k, 0.44 * k)
        pose["petiole"] = (0.60 * k, 0.0, 0.20 * k)
        pose["gaster"] = (0.70 * k, 0.0, 0.0)
        pose["nozzle"] = (0.40 * k, 0.0, 0.0)
        pose["neck"] = (0.50 * k, -0.22 * k, 0.0)
        pose["head"] = (0.44 * k, 0.0, 0.0)
        sym(pose, "antenna", 0.80 * k, -0.40 * k, 0.0)
        for n in leg_bones:
            # Femurs splay OUT and tibiae fold under, which is the
            # collapse; curling everything inward the way the Thresher
            # does would make a four-legged animal look like a spider
            # in a bath.
            side = 1.0 if n.endswith("_L") else -1.0
            if n.startswith("tibia"):
                pose[n] = (0.0, 0.0, -side * 1.35 * k)
            elif n.startswith("femur"):
                pose[n] = (0.0, 0.0, side * 0.42 * k)
            else:
                pose[n] = (0.0, 0.0, side * 0.16 * k)
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
    material = kit.vertex_colour_material("gleaner-chitin")
    mesh_obj = kit.build_mesh_object("gleaner", parts, material)
    arm = kit.build_armature("gleaner-rig", build_bone_table())
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
