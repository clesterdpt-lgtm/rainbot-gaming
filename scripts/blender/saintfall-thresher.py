#!/usr/bin/env python3
"""Build the Bloom's Thresher: SAINTFALL's swarm melee caste.

Run through Blender, not the system Python:

    blender --background --factory-startup \
      --python scripts/blender/saintfall-thresher.py -- \
      --output assets/models/saintfall/thresher.raw.glb \
      --report output/saintfall/models/thresher.json

Design notes that matter more than the code:

  - It is roughly a metre at the thorax against a 1.85m trooper, so it
    reads as something that SCUTTLES. A xeno at eye height is a person
    in a suit; one at knee height is vermin, and vermin at forty is a
    horde.

  - Six legs with a high knee, the classic insect silhouette: femur
    out and UP, tibia out and DOWN. The negative space under the body
    is most of what you actually read at distance.

  - THE LEG BONES ARE DEFORM-ONLY AND CARRY NO KEYFRAMES in any clip
    except `death`. Locomotion is solved procedurally in the browser
    against `terrain.heightAt`, because this level is 45-degree crater
    walls, dune slip faces and trench floors, and a baked walk cycle
    foot-slides on every one of them. The clips here are the things
    procedural IK cannot do: rearing, striking, flinching, dying.

WHAT THE SECOND PASS CHANGED, AND WHY

The first Thresher was a stack of straight prisms: two lumps for a
body, six uniform sticks for legs, two flat planks for arms. Reviewed
in frame beside the trooper it read as a prototype, and the reason is
worth writing down because it is not "not enough polygons".

An arthropod has almost no straight lines and almost no uniform
sections. Every limb tapers, bows, and carries a BULGE AT THE JOINT;
every body segment is a plate with an EDGE, and the shadow under that
edge is the thing the eye reads as armour. Straight prisms cannot
express either, so more of them would only have produced a denser
prototype.

So this pass is built out of swept curves and plates rather than
prisms - see `tube` and `shell` in the kit - and it adds the four
features that make a silhouette read as ALIVE at any distance:

  1. Antennae. Long, jointed, and swept back over the body. They cost
     almost nothing and they are the single loudest "this is an
     insect" signal in the whole outline.
  2. Compound eyes. Domes, not a painted band, with a chitin rim that
     catches its own highlight.
  3. Overlapping tergites down the abdomen, with LIT MEMBRANE showing
     in the gaps - so the body has an internal light source and stops
     being one solid mass.
  4. Feet. The first pass ended each leg in a point, which is why it
     read as furniture; a tarsal pad with two opposed claws puts the
     creature ON the ground instead of balanced above it.

The glow is carried in COLOR_0's alpha as an emissive mask (see the
GLOW_* table in the kit), so all of it costs zero extra draw calls.
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

# The kit lives beside this file; Blender does not put the script's
# directory on sys.path when run with --python.
_KIT = Path(__file__).resolve().parent / "saintfall-kit.py"
_spec = importlib.util.spec_from_file_location("saintfall_kit", _KIT)
kit = importlib.util.module_from_spec(_spec)
# Registered BEFORE execution: @dataclass resolves its own class via
# `sys.modules[cls.__module__]`, so a module loaded from a spec but
# never registered makes every dataclass in it raise on definition.
sys.modules["saintfall_kit"] = kit
_spec.loader.exec_module(kit)

Ring, Part = kit.Ring, kit.Part
TAU = kit.TAU
PI = math.pi
CHITIN = kit.CHITIN_CREATURE


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
# Authored Y-up with +Z forward, in metres, at 1:1 with the world the
# creature will stand in. `BESTIARY.scale` in enemies.js is the only
# place the final size is decided, so these numbers are the SHAPE and
# nothing else - which is what lets proportion be tuned in engine
# against the trooper rather than in the abstract here.
# ----------------------------------------------------------------------

BODY_Y = 1.02            # thorax centreline in the bind pose
HEAD_Z = 1.16            # front of the head capsule
TAIL_Z = -1.58           # tip of the abdomen

# All six legs hang off the THORAX, which is where an insect's legs
# are. The first pass put the rear pair under the abdomen; that is a
# spider's arrangement, and it is why the rear legs used to intersect
# the body every time the abdomen swung.
LEG_Z = (0.30, -0.04, -0.36)

# Per pair: hip, knee and foot. Splayed fore-and-aft rather than
# radially, and the hind pair longest - both true of real hexapods and
# both worth more to the silhouette than any amount of surface detail.
#
# The FRONT pair is pulled back and out deliberately. Planted forward
# it stood a shin directly across the head in three of six review
# angles, and a creature whose face is behind a leg has, for the
# player, no face at all.
LEG_RIG = (
    {"hip": (0.28, BODY_Y - 0.10, 0.30), "knee": (0.86, 1.56, 0.30), "foot": (1.14, 0.0, 0.30)},
    {"hip": (0.30, BODY_Y - 0.12, -0.04), "knee": (0.92, 1.70, -0.06), "foot": (1.24, 0.0, -0.16)},
    {"hip": (0.28, BODY_Y - 0.12, -0.36), "knee": (0.90, 1.63, -0.52), "foot": (1.16, 0.0, -0.96)},
)

# Raptorial forelimb, carried high and out. A mantis at rest jackknifes
# its tibia back against its femur, but folded tight against the body
# the whole limb disappears into the thorax at any distance - and this
# animal's two blades are half of what makes it recognisable.
#
# Carried out and forward instead, the arm opens a big triangle of
# empty sky between itself and the body. That negative space is what
# actually survives to eighty metres; the spines on it do not.
SHOULDER = (0.28, BODY_Y + 0.06, 0.42)
ELBOW = (0.66, 1.60, 0.72)
SCYTHE_TIP = (0.78, 0.82, 1.32)

ANTENNA_BASE = (0.13, BODY_Y + 0.26, 0.94)
ANTENNA_TIP = (0.62, 1.88, -0.30)
MANDIBLE_BASE = (0.15, BODY_Y - 0.08, 1.02)
MANDIBLE_TIP = (0.05, BODY_Y - 0.16, 1.50)


def leg_names(side: str, i: int) -> tuple[str, str, str]:
    return (f"coxa{i}_{side}", f"femur{i}_{side}", f"tibia{i}_{side}")


def mirror(p, sx: float) -> Vector:
    return Vector((p[0] * sx, p[1], p[2]))


# ----------------------------------------------------------------------
# small shared builders
# ----------------------------------------------------------------------

def spike(a, b, r0=0.032, r1=0.004, sides=4, bow=None, seed=1):
    """A tapered thorn from a to b. Spurs, cerci, dorsal spines."""
    a, b = Vector(a), Vector(b)
    pts = kit.arc_path(a, b, bow, n=3) if bow else [a, a.lerp(b, 0.5), b]
    return kit.tube(pts, [r0, (r0 + r1) * 0.55, r1], sides=sides,
                    mode="transport", seed=seed, cap_end=False)


def chitin_t(params, base=0.30, span=0.54, power=1.0, along=0.0, glow=0.0,
             ramp=None):
    """The house shading term for a swept part.

    Value climbs with how much the facet faces the sky and, optionally,
    with distance along the sweep. Both are measured off the geometry,
    so a limb keeps its modelling whichever way the solver has swung
    it - which is the entire reason `paint_t` exists.
    """
    return kit.paint_t(
        params, ramp or CHITIN,
        lambda t, a, u: base + span * kit.topside(u, power) + along * t,
        glow=glow,
    )


def add(parts, name, bone, built, colors):
    """`built` is whatever tube/shell/ring_solid handed back."""
    v, f = built[0], built[1]
    parts.append(Part(name, bone, v, f, colors))


# ----------------------------------------------------------------------
# geometry
# ----------------------------------------------------------------------

def build_head(parts) -> None:
    """Head capsule, face plate, compound eyes, antennae, mouthparts."""
    # --- capsule -------------------------------------------------------
    # Swept slightly downward: a predator's head is carried nose-down,
    # and the tilt is what stops the face reading as a blank end-cap.
    path = kit.bezier((0, BODY_Y + 0.12, 0.58), (0, BODY_Y + 0.14, 0.80),
                      (0, BODY_Y + 0.05, 1.00), (0, BODY_Y - 0.07, HEAD_Z), n=5)
    v, f, p = kit.tube(path, [(0.22, 0.25), (0.25, 0.29), (0.24, 0.28),
                              (0.20, 0.23), (0.15, 0.17), (0.08, 0.10)],
                       sides=7, mode="up", phase=0.22)
    add(parts, "head", "head", (v, f), chitin_t(p, 0.34, 0.50, 1.1))

    # Frons: the plate between the eyes, lifted to catch the sun. The
    # brightest large facet on the animal, and therefore the thing the
    # player's eye lands on first when it turns to face them.
    v, f, p = kit.shell(path[1:], [(0.25, 0.29), (0.24, 0.28), (0.20, 0.23),
                                   (0.15, 0.17), (0.08, 0.10)],
                        arc=(-0.21, 0.21), steps=4, thick=0.024, lift=0.010)
    add(parts, "frons", "head", (v, f), chitin_t(p, 0.52, 0.36, 0.8))

    for side, sx in (("L", 1.0), ("R", -1.0)):
        # --- compound eye ----------------------------------------------
        # A dome, not a painted band. The first pass used a flat wedge
        # and the head read as blind, which is the difference between
        # a creature looking at you and a shape pointing at you.
        eye_at = (sx * 0.21, BODY_Y + 0.21, 0.82)
        v, f = kit.dome(0.145, 0.115, rz=0.195, rings=3, sides=9, cut=0.96)
        v = kit.transform(v, rotate=(-0.34, 0.0, sx * -1.02), translate=eye_at)
        # Painted from the bio ramp rather than flat, so the dome has
        # its own falloff: a flat-filled eye is a decal, and a decal is
        # the one thing that reliably breaks a face.
        parts.append(Part(f"eye_{side}", "head", v, f,
                          kit.paint(v, kit.BIO_RAMP,
                                    lambda q: 0.44 + 1.9 * max(0.0, q.y - BODY_Y - 0.16),
                                    glow=kit.GLOW_EYE)))
        # ...and its rim, which is what makes the dome read as SET INTO
        # the head rather than stuck onto it.
        v, f = kit.dome(0.172, 0.066, rz=0.222, rings=2, sides=9, cut=0.60)
        v = kit.transform(v, rotate=(-0.34, 0.0, sx * -1.02), translate=eye_at)
        parts.append(Part(f"eyerim_{side}", "head", v, f,
                          kit.paint(v, CHITIN, lambda q: 0.12)))

        # --- antenna ---------------------------------------------------
        # Scape, pedicel, flagellum. Long and swept back over the body:
        # the loudest insect signal available in a silhouette, and it
        # costs sixty vertices.
        base = mirror(ANTENNA_BASE, sx)
        tip = mirror(ANTENNA_TIP, sx)
        elbow = Vector((sx * 0.24, BODY_Y + 0.46, 0.98))
        v, f, p = kit.tube([base, base.lerp(elbow, 0.55), elbow],
                           [0.038, 0.032, 0.027], sides=5, mode="transport")
        add(parts, f"scape_{side}", f"antenna_{side}", (v, f),
            chitin_t(p, 0.30, 0.44))
        v, f = kit.blob(0.037, sides=6, rings=2, seed=3 + int(sx))
        v = kit.transform(v, translate=tuple(elbow))
        parts.append(Part(f"pedicel_{side}", f"antenna_{side}", v, f,
                          kit.flat(v, kit.BIO_DIM, kit.GLOW_SEAM)))
        flag = kit.bezier(elbow, (sx * 0.46, 1.96, 0.76),
                          (sx * 0.68, 2.00, 0.18), tip, n=7)
        v, f, p = kit.tube(flag, [0.026, 0.023, 0.020, 0.017, 0.014,
                                  0.011, 0.008, 0.005],
                           sides=4, mode="transport")
        # Pale toward the tip: an antenna that fades out is an antenna
        # you can still see against the Bloom's own dark spires.
        add(parts, f"flagellum_{side}", f"antenna_{side}", (v, f),
            chitin_t(p, 0.30, 0.28, along=0.46))

        # --- mandible --------------------------------------------------
        # A sickle that closes inward, with three teeth on the inner
        # edge. Straight wedges made the first pass read as a pair of
        # tusks; the curve is what makes it read as a jaw that shuts.
        m0 = mirror(MANDIBLE_BASE, sx)
        mand = kit.bezier(m0, (sx * 0.24, BODY_Y - 0.16, 1.22),
                          (sx * 0.19, BODY_Y - 0.19, 1.42),
                          mirror(MANDIBLE_TIP, sx), n=6)
        v, f, p = kit.tube(mand, [0.068, 0.064, 0.055, 0.045, 0.034, 0.022, 0.008],
                           sides=5, mode="transport")
        add(parts, f"mandible_{side}", f"mandible_{side}", (v, f),
            chitin_t(p, 0.38, 0.26, along=0.26))
        for k, tt in enumerate((0.30, 0.50, 0.70)):
            j = int(tt * (len(mand) - 1))
            root = mand[j]
            inner = Vector((root.x - sx * 0.06, root.y - 0.03, root.z + 0.03))
            v, f, p = spike(root, inner, r0=0.021, r1=0.003, sides=4, seed=k)
            add(parts, f"tooth{k}_{side}", f"mandible_{side}", (v, f),
                chitin_t(p, 0.72, 0.24))

        # --- maxillary palp --------------------------------------------
        # Two little segmented feelers under the mouth. Pure close-range
        # detail; nobody will name it and everybody would miss it.
        pb = Vector((sx * 0.10, BODY_Y - 0.16, 1.02))
        pm = Vector((sx * 0.16, BODY_Y - 0.28, 1.16))
        pe = Vector((sx * 0.12, BODY_Y - 0.38, 1.30))
        v, f, p = kit.tube([pb, pm, pe], [0.022, 0.018, 0.010],
                           sides=4, mode="transport")
        add(parts, f"palp_{side}", "head", (v, f), chitin_t(p, 0.26, 0.30))

    # --- ocelli --------------------------------------------------------
    # Three simple eyes in a triangle on the forehead. Real, small, and
    # the thing that sells the face at two metres.
    for k, (ox, oy, oz, orad) in enumerate(((0.0, 0.32, 0.90, 0.032),
                                            (0.075, 0.37, 0.79, 0.026),
                                            (-0.075, 0.37, 0.79, 0.026))):
        v, f = kit.dome(orad, orad * 0.8, rings=2, sides=6, cut=0.9)
        v = kit.transform(v, rotate=(-0.5, 0, 0),
                          translate=(ox, BODY_Y + oy, oz))
        parts.append(Part(f"ocellus{k}", "head", v, f,
                          kit.flat(v, kit.BIO_PALE, kit.GLOW_EYE)))


def build_thorax(parts) -> None:
    """Pronotal collar, thorax barrel, sternum, and the dorsal crest."""
    # --- pronotum ------------------------------------------------------
    # The armoured collar over the neck, flaring backward. An insect's
    # pronotum is the reason its front half reads as ARMOURED rather
    # than merely thick, and the overhang at its rear edge is the one
    # hard shadow line on the whole upper body.
    path = kit.bezier((0, BODY_Y + 0.11, 0.62), (0, BODY_Y + 0.15, 0.48),
                      (0, BODY_Y + 0.16, 0.30), (0, BODY_Y + 0.10, 0.14), n=5)
    radii = [(0.20, 0.22), (0.27, 0.31), (0.33, 0.39), (0.37, 0.45),
             (0.38, 0.48), (0.35, 0.46)]
    v, f, p = kit.shell(path, radii, arc=(-0.30, 0.30), steps=6,
                        thick=0.045, lift=0.0)
    add(parts, "pronotum", "pronotum", (v, f), chitin_t(p, 0.36, 0.52, 1.2))

    # Lateral pronotal spines: the collar's corners drawn out into
    # points, so the front of the animal is WIDE in outline.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        v, f, p = spike((sx * 0.34, BODY_Y + 0.14, 0.26),
                        (sx * 0.68, BODY_Y + 0.24, -0.06),
                        r0=0.055, r1=0.006, sides=5,
                        bow=(0, 0.05, 0.02), seed=11)
        add(parts, f"pronspine_{side}", "pronotum", (v, f),
            chitin_t(p, 0.40, 0.32, along=0.16))

    # --- thorax barrel -------------------------------------------------
    body = kit.bezier((0, BODY_Y + 0.02, 0.46), (0, BODY_Y + 0.04, 0.18),
                      (0, BODY_Y + 0.02, -0.14), (0, BODY_Y - 0.02, -0.44), n=5)
    br = [(0.30, 0.30), (0.37, 0.38), (0.40, 0.42), (0.40, 0.42),
          (0.37, 0.38), (0.30, 0.29)]
    v, f, p = kit.tube(body, br, sides=9, mode="up", phase=0.18,
                       profile=kit.flutes(9, 0.035))
    add(parts, "thorax", "thorax", (v, f), chitin_t(p, 0.24, 0.46, 1.3))

    # Mesonotal shield over the top of it, with the leg sockets left
    # exposed below - which is what puts a visible boundary between
    # "body" and "legs" instead of one continuous mass.
    v, f, p = kit.shell(body, br, arc=(-0.24, 0.24), steps=6,
                        thick=0.04, lift=0.012)
    add(parts, "mesonotum", "thorax", (v, f), chitin_t(p, 0.40, 0.50, 1.1))

    # Lit membrane where the shield lifts off the barrel. The Bloom's
    # animals are hot inside; this is where you see it. A HAIRLINE, not
    # a band - the first cut of this ran the full flank at seam
    # brightness and put a lit slab down each side of the thorax that
    # read as a vehicle light, not as a living joint.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        a0 = 0.248 * sx
        v, f, p = kit.shell(body, br, arc=(a0, a0 + 0.022 * sx), steps=2,
                            thick=0.010, lift=0.002)
        add(parts, f"thoraxseam_{side}", "thorax", (v, f),
            kit.paint_t(p, kit.BIO_RAMP, lambda t, a, u: 0.24 + 0.34 * t,
                        glow=lambda t, a, u: kit.GLOW_SEAM * 0.8))

    # --- sternum -------------------------------------------------------
    # The underside stays near black. A creature with no black left in
    # it stops reading as chitin, and the belly is where the black goes.
    v, f, p = kit.shell(body, br, arc=(0.30, 0.70), steps=5,
                        thick=0.03, lift=0.004)
    add(parts, "sternum", "thorax", (v, f), chitin_t(p, 0.06, 0.20))

    # --- dorsal crest --------------------------------------------------
    # A direct quote of the district's chitin spires at 1/20 scale,
    # swept back rather than upright so it rakes with the body.
    for k, (sz, sh, bone) in enumerate((
            (0.30, 0.20, "thorax"), (0.06, 0.28, "thorax"),
            (-0.20, 0.30, "thorax"), (-0.46, 0.30, "abdomen"),
            (-0.74, 0.26, "abdomen"), (-1.00, 0.19, "abdomen"))):
        base = Vector((0.0, BODY_Y + (0.42 if bone == "thorax" else 0.36), sz))
        tip = base + Vector((0.0, sh, -sh * 0.85))
        v, f, p = spike(base, tip, r0=0.075, r1=0.006, sides=5,
                        bow=(0, 0.03, -0.02), seed=53 + k)
        add(parts, f"crest{k}", bone, (v, f), chitin_t(p, 0.44, 0.34, along=0.34))


def abdomen_path():
    # 24 points, because the tergites are cut out of this list by index
    # and the SEAMS BETWEEN THEM are one index wide. At sixteen points
    # a seam was 8cm of a 1.2m abdomen and read as a stripe; at
    # twenty-four it is 5cm and reads as a joint.
    return kit.bezier((0, BODY_Y + 0.02, -0.36), (0, BODY_Y + 0.06, -0.72),
                      (0, BODY_Y - 0.04, -1.16), (0, BODY_Y - 0.20, TAIL_Z),
                      n=23)


def abd_radius(t: float) -> float:
    """Swollen at the shoulder, tapering to a point."""
    swell = math.sin(min(1.0, t * 1.06) ** 0.78 * PI) ** 0.62
    return 0.055 + 0.40 * swell


# Five plates with a ONE-INDEX GAP between each. The gaps are the
# whole design: an armoured abdomen is armour plus the lit joint that
# the armour cannot cover, and a continuous shell has neither.
TERGITES = ((0, 4), (5, 9), (10, 14), (15, 18), (19, 22))


def build_abdomen(parts) -> None:
    """Segmented gaster: barrel, five tergites, lit joints, spiracles."""
    path = abdomen_path()
    n = len(path)
    # Taller than wide, like a hunting wasp's gaster - and on a
    # creature this low the vertical axis is the one a standing player
    # actually reads.
    base = [abd_radius(i / (n - 1)) for i in range(n)]
    radii = [(r, r * 0.84) for r in base]

    v, f, p = kit.tube(path, radii, sides=9, mode="up", phase=0.2)
    add(parts, "gaster", "abdomen", (v, f), chitin_t(p, 0.16, 0.42, 1.3))

    # --- tergites ------------------------------------------------------
    for k, (i0, i1) in enumerate(TERGITES):
        seg = path[i0:i1 + 1]
        rad = radii[i0:i1 + 1]
        # Split at the hinge so the rear half can curl on death rather
        # than swinging as one rigid pod.
        bone = "abdomen" if i1 <= 12 else "abdomen2"
        # Each plate flares at its LEADING edge, so it overhangs the
        # joint in front of it and throws a hard shadow into it. That
        # shadow is what the eye reads as armour; without it a plate is
        # just a slightly different colour.
        v, f, p = kit.shell(seg, rad, arc=(-0.31, 0.31), steps=6,
                            thick=0.032, lift=0.030,
                            profile=lambda t, u: 1.0 + 0.17 * (1.0 - t) ** 2)
        add(parts, f"tergite{k}", bone, (v, f),
            chitin_t(p, 0.26 - k * 0.02, 0.62, 1.25))

        # The joint the plates leave uncovered.
        #
        # This is DARK MEMBRANE with light behind it, not a light. The
        # first cut painted it near the top of the bio ramp at full
        # seam glow and put three fat cyan bands straight across the
        # animal's back - it read as hazard striping on a vehicle, and
        # at forty metres the bands were the only thing left of it.
        #
        # So: recessed under the plate rather than proud of it, kept
        # inside the plate's own arc, and painted at the BOTTOM of the
        # bio ramp with only the crown of the joint lit at all.
        if i1 + 2 < n:
            jseg = path[i1:i1 + 3]
            jrad = [(r[0] * 0.965, r[1] * 0.965) for r in radii[i1:i1 + 3]]
            v, f, p = kit.shell(jseg, jrad, arc=(-0.26, 0.26), steps=5,
                                thick=0.012, lift=0.0)
            add(parts, f"joint{k}", bone, (v, f),
                kit.paint_t(p, kit.BIO_RAMP,
                            lambda t, a, u: 0.05 + 0.42 * kit.topside(u, 2.2),
                            glow=lambda t, a, u: kit.GLOW_SEAM * kit.topside(u, 3.0)))

        # Spiracles: the breathing pores down the flanks. Tiny, dark,
        # faintly lit, and the sort of thing that only ever registers
        # as "this was modelled by someone who cared".
        j = (i0 + i1) // 2
        for sx in (1.0, -1.0):
            at = path[j] + Vector((sx * radii[j][1] * 0.94, -0.05, 0))
            sv, sf = kit.dome(0.028, 0.016, rings=2, sides=5, cut=0.9)
            sv = kit.transform(sv, rotate=(0, 0, sx * -1.57), translate=tuple(at))
            parts.append(Part(f"spiracle{k}_{'L' if sx > 0 else 'R'}", bone,
                              sv, sf, kit.flat(sv, kit.BIO_DIM, kit.GLOW_FAINT)))

    # --- cerci ---------------------------------------------------------
    # Two short sensory spines off the tail. They finish the outline;
    # an abdomen that just stops reads as a truncated model.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        root = path[-3] + Vector((sx * 0.05, 0.02, 0))
        v, f, p = spike(root, root + Vector((sx * 0.16, 0.10, -0.30)),
                        r0=0.030, r1=0.004, sides=4,
                        bow=(0, 0.03, 0), seed=71)
        add(parts, f"cercus_{side}", "abdomen2", (v, f),
            chitin_t(p, 0.34, 0.36, along=0.30))


def build_scythes(parts) -> None:
    """The raptorial forelimbs the `strike` clip drives."""
    for side, sx in (("L", 1.0), ("R", -1.0)):
        shoulder = mirror(SHOULDER, sx)
        elbow = mirror(ELBOW, sx)
        tip = mirror(SCYTHE_TIP, sx)

        # Coxa knuckle at the shoulder: without a bulge here the arm
        # reads as glued to the thorax rather than socketed into it.
        v, f = kit.blob(0.10, sides=7, rings=2, seed=5)
        v = kit.transform(v, translate=tuple(shoulder))
        parts.append(Part(f"scythecoxa_{side}", f"scythe_{side}", v, f,
                          kit.paint(v, CHITIN, lambda q: 0.22 + 0.30 * (q.y - BODY_Y))))

        # Femur: heavy, bowed, and carrying a row of grabbing spines on
        # its inner edge. This is the half that says "this animal holds
        # things still while it eats them".
        fem = kit.arc_path(shoulder, elbow, (sx * 0.06, 0.05, 0.04), n=5)
        v, f, p = kit.tube(fem, [(0.12, 0.10), (0.125, 0.105), (0.115, 0.095),
                                 (0.100, 0.082), (0.084, 0.068), (0.068, 0.056)],
                           sides=6, mode="transport")
        add(parts, f"scythefemur_{side}", f"scythe_{side}", (v, f),
            chitin_t(p, 0.28, 0.46))
        # Grabbing spines, on the INSIDE edge - the face that closes on
        # prey. Pointing them straight down instead made the arm read
        # as a second leg with decoration.
        for k, tt in enumerate((0.25, 0.45, 0.65, 0.85)):
            j = int(tt * (len(fem) - 1))
            root = fem[j]
            v, f, p = spike(root, root + Vector((sx * -0.07, -0.11, 0.06)),
                            r0=0.024, r1=0.003, sides=4, seed=k + 3)
            add(parts, f"scythespine{k}_{side}", f"scythe_{side}", (v, f),
                chitin_t(p, 0.66, 0.26))

        v, f = kit.blob(0.078, sides=6, rings=2, seed=9)
        v = kit.transform(v, translate=tuple(elbow))
        parts.append(Part(f"scytheelbow_{side}", f"claw_{side}", v, f,
                          kit.paint(v, CHITIN, lambda q: 0.30)))

        # Tibia: a flattened BLADE, not a rod. The section is deep in
        # the swing plane and thin across it, so the limb reads as an
        # edge from the side and as a line head-on - exactly how a real
        # blade behaves, and how a player learns which way to dodge.
        #
        # It also runs pale toward the tip. A dark blade against the
        # Bloom's dark spires is a limb you cannot see coming.
        # Bowed hard through the middle. A blade that curves is a
        # SICKLE; one that only tapers is a plank, and the first cut of
        # this - straight, and 23cm across - hung off the shoulder like
        # a paddle.
        blade = kit.bezier(elbow, (sx * 0.90, 1.36, 1.04),
                           (sx * 0.95, 1.06, 1.30), tip, n=6)
        v, f, p = kit.tube(blade, [(0.082, 0.030), (0.086, 0.028), (0.078, 0.025),
                                   (0.066, 0.021), (0.050, 0.016), (0.032, 0.010),
                                   (0.010, 0.004)],
                           sides=5, mode="transport", phase=0.25)
        # Pale only at the LAST QUARTER. Running the highlight the
        # whole length turned the limb into a white flag; a cutting
        # edge is bright where it is thin and nowhere else.
        add(parts, f"scytheblade_{side}", f"claw_{side}", (v, f),
            kit.paint_t(p, CHITIN,
                        lambda t, a, u: 0.26 + 0.24 * kit.topside(u)
                        + 0.34 * max(0.0, (t - 0.62) / 0.38) ** 1.4))
        for k, tt in enumerate((0.18, 0.34, 0.50, 0.66, 0.80)):
            j = int(tt * (len(blade) - 1))
            root = blade[j]
            v, f, p = spike(root, root + Vector((sx * 0.02, -0.13, 0.05)),
                            r0=0.021, r1=0.002, sides=4, seed=k + 17)
            add(parts, f"bladetooth{k}_{side}", f"claw_{side}", (v, f),
                chitin_t(p, 0.70, 0.18))


def build_legs(parts) -> None:
    """Six walking legs: coxa, trochanter, femur, tibia, tarsus, claws."""
    for i, rig in enumerate(LEG_RIG):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            coxa_b, femur_b, tibia_b = leg_names(side, i)
            foot_b = f"foot{i}_{side}"
            hip = mirror(rig["hip"], sx)
            knee = mirror(rig["knee"], sx)
            foot = mirror(rig["foot"], sx)
            mid = hip.lerp(knee, 0.18)

            # --- coxa ---------------------------------------------------
            v, f, p = kit.tube([hip, hip.lerp(mid, 0.5), mid],
                               [0.13, 0.125, 0.115], sides=6, mode="transport")
            add(parts, f"coxaGeo{i}_{side}", coxa_b, (v, f),
                chitin_t(p, 0.16, 0.34))
            # Trochanter: the little joint bulb every arthropod has
            # between coxa and femur, and the reason the leg reads as
            # ARTICULATED rather than as a bent stick.
            v, f = kit.blob(0.072, sides=6, rings=2, seed=23 + i)
            v = kit.transform(v, translate=tuple(mid))
            parts.append(Part(f"trochanter{i}_{side}", femur_b, v, f,
                              kit.flat(v, kit.BIO_DIM, kit.GLOW_FAINT)))

            # --- femur --------------------------------------------------
            # Bowed outward and thickest a third of the way along, which
            # is where the muscle is. A uniform cylinder is the single
            # most prototype-looking thing a limb can be.
            fem = kit.arc_path(mid, knee, (sx * 0.06, -0.04, 0.0), n=5)
            v, f, p = kit.tube(fem, [0.112, 0.120, 0.112, 0.100, 0.086, 0.072],
                               sides=6, mode="transport",
                               profile=kit.flutes(6, 0.05))
            add(parts, f"femurGeo{i}_{side}", femur_b, (v, f),
                chitin_t(p, 0.30, 0.46, along=0.16))

            # --- knee ---------------------------------------------------
            v, f = kit.blob(0.078, sides=6, rings=2, seed=41 + i)
            v = kit.transform(v, translate=tuple(knee))
            parts.append(Part(f"kneeGeo{i}_{side}", tibia_b, v, f,
                              kit.paint(v, CHITIN, lambda q: 0.46)))
            # A short spur off the back of the knee. Six of these along
            # the top of the animal are most of what the eye picks up
            # when it is moving.
            v, f, p = spike(knee, knee + Vector((sx * 0.04, 0.16, -0.10)),
                            r0=0.030, r1=0.004, sides=4, seed=59 + i)
            add(parts, f"kneespur{i}_{side}", tibia_b, (v, f),
                chitin_t(p, 0.62, 0.30))

            # --- tibia --------------------------------------------------
            tib = kit.arc_path(knee, foot, (sx * 0.05, -0.02, 0.0), n=5)
            v, f, p = kit.tube(tib, [0.078, 0.070, 0.060, 0.050, 0.040, 0.030],
                               sides=5, mode="transport")
            # Darkening toward the ground rather than lightening: the
            # shin is the part that lives in the body's own shadow, and
            # a leg that fades out at the foot sits ON the sand instead
            # of being stamped over it.
            add(parts, f"tibiaGeo{i}_{side}", tibia_b, (v, f),
                chitin_t(p, 0.30, 0.42, along=-0.14))
            for k, tt in enumerate((0.34, 0.58, 0.80)):
                j = int(tt * (len(tib) - 1))
                root = tib[j]
                v, f, p = spike(root, root + Vector((sx * 0.06, 0.03, -0.10)),
                                r0=0.020, r1=0.002, sides=4, seed=k + 31 + i)
                add(parts, f"tibspur{i}{k}_{side}", tibia_b, (v, f),
                    chitin_t(p, 0.58, 0.28))

            # --- tarsus -------------------------------------------------
            # The IK plants the TIBIA'S TIP on the ground, so everything
            # here has to live at or above that point or it will be
            # buried. A flat pad with two opposed claws does the job:
            # small enough that terrain never swallows it, and it is
            # what puts the creature ON the ground rather than balanced
            # above it on six spikes.
            v, f = kit.dome(0.055, 0.032, rz=0.070, rings=2, sides=6, cut=0.9)
            v = kit.transform(v, translate=(foot.x, foot.y + 0.012, foot.z))
            parts.append(Part(f"tarsus{i}_{side}", foot_b, v, f,
                              kit.paint(v, CHITIN, lambda q: 0.20)))
            for k, dz in enumerate((0.11, -0.09)):
                claw = kit.arc_path((foot.x, foot.y + 0.035, foot.z),
                                    (foot.x - sx * 0.01, foot.y + 0.004,
                                     foot.z + dz * 1.25),
                                    (0, 0.028, 0), n=3)
                v, f, p = kit.tube(claw, [0.024, 0.018, 0.011, 0.004],
                                   sides=4, mode="transport", cap_end=False)
                add(parts, f"claw{i}{k}_{side}", foot_b, (v, f),
                    chitin_t(p, 0.60, 0.28))


def build_parts() -> list[Part]:
    parts: list[Part] = []
    build_thorax(parts)
    build_abdomen(parts)
    build_head(parts)
    build_scythes(parts)
    build_legs(parts)
    return parts


# ----------------------------------------------------------------------
# rig
# ----------------------------------------------------------------------

def build_bone_table() -> list[dict]:
    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0.30, 0)},
        {"name": "thorax", "head": (0, BODY_Y, 0.0), "tail": (0, BODY_Y, 0.42),
         "parent": "root"},
        {"name": "pronotum", "head": (0, BODY_Y + 0.10, 0.22),
         "tail": (0, BODY_Y + 0.16, 0.62), "parent": "thorax"},
        {"name": "head", "head": (0, BODY_Y + 0.12, 0.58),
         "tail": (0, BODY_Y - 0.07, HEAD_Z), "parent": "pronotum"},
        # Two abdominal segments, so the gaster can curl rather than
        # swing as one rigid pod. Death is the clip that needs it.
        {"name": "abdomen", "head": (0, BODY_Y, -0.36),
         "tail": (0, BODY_Y, -0.96), "parent": "thorax"},
        {"name": "abdomen2", "head": (0, BODY_Y, -0.96),
         "tail": (0, BODY_Y - 0.16, TAIL_Z), "parent": "abdomen",
         "connect": True},
    ]
    for side, sx in (("L", 1.0), ("R", -1.0)):
        bones.append({"name": f"mandible_{side}",
                      "head": tuple(mirror(MANDIBLE_BASE, sx)),
                      "tail": tuple(mirror(MANDIBLE_TIP, sx)),
                      "parent": "head"})
        bones.append({"name": f"antenna_{side}",
                      "head": tuple(mirror(ANTENNA_BASE, sx)),
                      "tail": tuple(mirror(ANTENNA_TIP, sx)),
                      "parent": "head"})
        bones.append({"name": f"scythe_{side}",
                      "head": tuple(mirror(SHOULDER, sx)),
                      "tail": tuple(mirror(ELBOW, sx)),
                      "parent": "thorax"})
        bones.append({"name": f"claw_{side}",
                      "head": tuple(mirror(ELBOW, sx)),
                      "tail": tuple(mirror(SCYTHE_TIP, sx)),
                      "parent": f"scythe_{side}", "connect": True})
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
            # An explicit foot bone, deforming only the tarsal pad.
            #
            # glTF carries bone HEADS as node translations and throws
            # the tails away, so a leaf bone's length is simply not in
            # the file. Without this the runtime has to guess the
            # tibia's length, and a guess that is wrong by 15% makes
            # the IK over- or under-extend on every step. A leaf bone
            # at the tail turns that guess into a measurement.
            bones.append({"name": f"foot{i}_{side}", "head": tuple(foot),
                          "tail": tuple(foot + Vector((0, 0, 0.14))),
                          "parent": tibia, "connect": True})
    return bones


# ----------------------------------------------------------------------
# animation
# ----------------------------------------------------------------------

BODY_BONES = ["thorax", "pronotum", "abdomen", "abdomen2", "head",
              "mandible_L", "mandible_R", "antenna_L", "antenna_R",
              "scythe_L", "scythe_R", "claw_L", "claw_R"]


def build_actions(arm) -> list[str]:
    """Author the clips procedural IK cannot do.

    Every clip here keys BODY bones only. The leg chains are left
    untouched so the browser's IK solver owns them outright - a clip
    that also keyed a tibia would fight the solver every frame, and
    whichever ran last would win, which is the sort of bug that looks
    like jitter and is actually two systems disagreeing.
    """
    scene = bpy.context.scene
    names: list[str] = []

    def rest():
        return {b: (0.0, 0.0, 0.0) for b in BODY_BONES}

    def sym(pose, stem, x, y, z):
        """Key a mirrored pair from one set of numbers.

        Y and Z flip on the right side. Getting this wrong is how a
        creature ends up scratching one antenna while the other salutes.
        """
        pose[f"{stem}_L"] = (x, y, z)
        pose[f"{stem}_R"] = (x, -y, -z)

    # --- idle ----------------------------------------------------------
    # A slow breath through the abdomen, and antennae that never stop
    # moving. The antennae are the whole clip: a creature whose feelers
    # are always sweeping is alive even when it is standing still.
    act = kit.new_action(arm, "idle")
    scene.frame_end = 110
    for frame, k in ((1, 0.0), (28, 1.0), (56, 0.3), (84, 0.85), (110, 0.0)):
        pose = rest()
        pose["abdomen"] = (0.055 * k, 0.02 * math.sin(k * 3.0), 0.0)
        pose["abdomen2"] = (0.045 * k, 0.03 * math.sin(k * 2.1), 0.0)
        pose["thorax"] = (0.016 * k, 0.0, 0.012 * math.sin(k * 5.0))
        pose["pronotum"] = (-0.02 * k, 0.03 * math.sin(k * 2.4), 0.0)
        pose["head"] = (-0.05 * k, 0.11 * math.sin(k * 4.2), 0.0)
        sym(pose, "mandible", 0.0, 0.0, -0.20 * k)
        sym(pose, "antenna", 0.34 * math.sin(k * 5.1), 0.30 * math.cos(k * 3.7), 0.0)
        sym(pose, "scythe", -0.06 * k, 0.0, -0.05 * k)
        sym(pose, "claw", 0.10 * k, 0.0, 0.0)
        key_all(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("idle")

    # --- alert ---------------------------------------------------------
    # Rears, throws the scythes open and the antennae forward. Read as
    # THREAT DISPLAY: everything gets wider and higher at once.
    act = kit.new_action(arm, "alert")
    for frame, k in ((1, 0.0), (13, 1.14), (21, 1.0), (44, 1.0)):
        pose = rest()
        pose["thorax"] = (-0.30 * k, 0.0, 0.0)
        pose["pronotum"] = (-0.18 * k, 0.0, 0.0)
        pose["abdomen"] = (0.26 * k, 0.0, 0.0)
        pose["abdomen2"] = (0.20 * k, 0.0, 0.0)
        pose["head"] = (-0.22 * k, 0.0, 0.0)
        sym(pose, "antenna", -0.55 * k, 0.42 * k, 0.0)
        sym(pose, "scythe", -0.62 * k, 0.0, -0.46 * k)
        sym(pose, "claw", -0.70 * k, 0.0, -0.24 * k)
        sym(pose, "mandible", 0.0, 0.0, -0.60 * k)
        key_all(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("alert")

    # --- strike --------------------------------------------------------
    # Windup, snap, recover. The windup is LONGER than the strike; a
    # tell the player can read is the whole difference between a fair
    # melee enemy and a cheap one, and it has to be in the ANIMATION,
    # not in a UI cue.
    #
    # The scythe unfolds in two stages the way a mantis's does - femur
    # forward first, tibia snapping open behind it - which is what
    # makes the reach look earned rather than teleported.
    act = kit.new_action(arm, "strike")
    beats = (
        (1, -0.10, (-0.62, -0.26), (0.30, 0.0), 0.20),
        (13, -0.46, (-1.20, -0.60), (0.95, -0.20), 0.70),   # coiled
        (18, 0.38, (0.92, 0.20), (-0.85, 0.10), 0.15),      # snap
        (26, 0.12, (0.26, -0.06), (-0.10, 0.04), 0.15),
        (38, 0.0, (0.0, 0.0), (0.0, 0.0), 0.20),
    )
    for frame, thx, (sx_, sz_), (cx_, cz_), jaw in beats:
        pose = rest()
        pose["thorax"] = (thx, 0.0, 0.0)
        pose["pronotum"] = (thx * 0.5, 0.0, 0.0)
        pose["head"] = (thx * 0.7, 0.0, 0.0)
        pose["abdomen"] = (-thx * 0.55, 0.0, 0.0)
        sym(pose, "scythe", sx_, 0.0, sz_)
        sym(pose, "claw", cx_, 0.0, cz_)
        sym(pose, "mandible", 0.0, 0.0, -jaw)
        sym(pose, "antenna", -0.30 - thx, 0.30, 0.0)
        key_all(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("strike")

    # --- flinch --------------------------------------------------------
    act = kit.new_action(arm, "flinch")
    for frame, k in ((1, 0.0), (4, 1.0), (10, 0.35), (20, 0.0)):
        pose = rest()
        pose["thorax"] = (0.20 * k, -0.13 * k, 0.10 * k)
        pose["pronotum"] = (0.14 * k, -0.08 * k, 0.0)
        pose["head"] = (0.26 * k, 0.17 * k, 0.0)
        pose["abdomen"] = (-0.15 * k, 0.0, 0.0)
        pose["abdomen2"] = (-0.20 * k, 0.0, 0.0)
        sym(pose, "antenna", 0.55 * k, -0.30 * k, 0.0)
        sym(pose, "scythe", 0.30 * k, 0.0, 0.22 * k)
        sym(pose, "claw", 0.34 * k, 0.0, 0.0)
        key_all(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("flinch")

    # --- death ---------------------------------------------------------
    # The one clip that DOES own the legs. It has to: a corpse whose
    # legs are still being solved against the terrain stands up again.
    act = kit.new_action(arm, "death")
    leg_bones = [n for i in range(len(LEG_Z)) for side in ("L", "R")
                 for n in leg_names(side, i)]
    for frame, k in ((1, 0.0), (7, 0.30), (20, 0.88), (34, 1.04), (52, 1.0)):
        pose = rest()
        pose["thorax"] = (0.34 * k, 0.24 * k, 0.62 * k)
        pose["pronotum"] = (0.12 * k, 0.0, 0.10 * k)
        pose["abdomen"] = (-0.30 * k, 0.0, -0.22 * k)
        pose["abdomen2"] = (-0.46 * k, 0.0, -0.14 * k)
        pose["head"] = (0.42 * k, -0.32 * k, 0.0)
        sym(pose, "mandible", 0.0, 0.0, -0.34 * k)
        # Antennae go limp first. It is the first thing that stops
        # moving on a dying insect and the first thing you notice.
        sym(pose, "antenna", 0.9 * k, -0.5 * k, 0.0)
        sym(pose, "scythe", 0.50 * k, 0.0, 0.34 * k)
        sym(pose, "claw", 0.80 * k, 0.0, 0.0)
        # Legs curl inward and under, which is what dead arthropods do
        # and what nothing else in the game does.
        for n in leg_bones:
            curl = 1.20 if n.startswith("tibia") else (0.58 if n.startswith("femur") else 0.26)
            side = 1.0 if n.endswith("_L") else -1.0
            pose[n] = (0.0, 0.0, -side * curl * k)
        key_all(arm, frame, pose)
    kit.set_interpolation(act)
    names.append("death")

    return names


def key_all(arm, frame: int, pose: dict) -> None:
    kit.key_pose(arm, frame, pose)


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
        # Vertex colours are the whole point: SAINTFALL has no textures
        # anywhere, so COLOR_0 carries all the surface information and
        # there is not one image in the file. Its ALPHA carries the
        # emissive mask, which is why the channel must survive export.
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
    material = kit.vertex_colour_material("thresher-chitin")
    mesh_obj = kit.build_mesh_object("thresher", parts, material)
    arm = kit.build_armature("thresher-rig", build_bone_table())
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
