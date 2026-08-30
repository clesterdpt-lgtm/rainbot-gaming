#!/usr/bin/env python3
"""Build the Coulter: SAINTFALL's burrowing boss.

    blender --background --factory-startup \
      --python scripts/blender/saintfall-coulter.py -- \
      --output assets/models/saintfall/source/coulter.raw.glb \
      --report output/saintfall/models/coulter.json

WHY A WORM, AND WHY THIS ONE

The bestiary is four silhouettes deep and every one of them is a
walking arthropod read by its LEG RHYTHM: small and fast, tall and
thin, wide and low, long and reared. That axis is spent. A fifth
walker would be a fourth-place finish in a competition the player has
already learned the rules of.

So the Coulter owns the one thing none of them can: it owns being
ABSENT. It is under the sand for most of the fight, and what the
player reads is not a body at all but a moving ridge of displaced
ground with nothing on top of it. That is a new problem rather than a
new statblock - every other enemy in the game is solved by aiming, and
this one has to be solved by MOVING, because for eight seconds at a
time there is nothing to aim at.

THE NAME IS THE ANATOMY

Thresher, Gleaner, Harrow: the brood is named for farm implements, and
a coulter is the blade that runs ahead of a plough to cut the sod open
before the share lifts it. This animal is that blade. The hardened
radial fins around its collar are the only part of it built for the
job it spends its life doing, they are the widest part of its
silhouette, and they are the pale one - scoured back to bone by the
sand they cut, on an animal that is otherwise nearly black.

A HOLE, NOT A FACE

Every other caste has eyes, and the eyes are where the player looks.
A burrower has no use for them, and taking them away leaves the front
of the animal free for the thing that actually matters: an iris of
five hinged petals around a lit throat. Shut, it is a blunt dark cone
with a seam. Open, it is the brightest object in the frame and it is
GREEN, which is the game's only hazard colour and appears nowhere else
- so the tell that poison is coming is the same tell as the weak
point, and both of them are "the mouth is open".

That is the encounter in one sentence: the only time it can hurt you
at range is the only time you can hurt it properly.

Painted from CHITIN_DEEP, like the Harrow and the Matriarch, because
it came out of the same hive. Its lamp is cyan like theirs - the
family resemblance - and the venom is the one thing about it that is
its own.
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
SCOUR = kit.BONE_RAMP


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
# Authored 1:1 in metres, Y-up, +Z forward, and - unlike every other
# creature in this bestiary - with its ORIGIN AT THE MOUTH rather than
# between its feet.
#
# That is a runtime contract, not a preference. A walker is placed by
# where it stands, so its origin belongs on the ground. This animal is
# placed by where its head IS: the runtime keeps a trail of the points
# the head has travelled through and lays the body back along it, so
# the origin has to be the leading point of that trail or the whole
# body is offset from the hole it came out of.
#
# The body is therefore authored dead straight along -Z, centred on
# y=0, and every bend it ever has is put there by the solver.
# ----------------------------------------------------------------------

SEGMENTS = 13
SEG_LEN = 1.72
NECK_Z = -1.25                 # back of the head, front of segment 0
JOINT_Z = [NECK_Z - i * SEG_LEN for i in range(SEGMENTS + 1)]

# Thickest a third of the way back, which is where a burrowing animal
# carries its mass: the front has to fit through the hole the collar
# cuts, and everything behind the swell is being dragged rather than
# doing any work.
BODY_R = [1.06, 1.26, 1.35, 1.34, 1.28, 1.20, 1.10,
          0.99, 0.87, 0.74, 0.60, 0.44, 0.27, 0.09]

# THE MOUTH IS THE WIDEST THING AT THE FRONT, and it took a review
# frame to learn why that matters. Authored at 0.97m the rim was
# narrower than the body behind it, so the animal had no head at all:
# from any angle in front it presented a smooth pale dome and the maw -
# the weak point, the venom source, and the only feature it has - was
# invisible. A burrowing mouth flares. This one now flares wider than
# the swell behind it, so the front of the animal reads as an APERTURE
# from the first frame the player sees it.
MAW_RIM_Z = -0.30              # where the petals hinge
MAW_RIM_R = 1.30
PETALS = 5                     # odd, per the kit's rule
PALPS = 5
GLAND_ROWS = (0, 1, 2)         # which segments carry venom sacs
SIDES = 11                     # body cross-section, odd


def seg_bone(i: int) -> str:
    return f"spine{i:02d}"


def ring_pt(angle: float, radius: float, z: float) -> Vector:
    """A point on the body's cross-section at `z`.

    +Z is forward, so a cross-section lies in the XY plane and "up"
    on the animal is +Y at angle pi/2.
    """
    return Vector((math.cos(angle) * radius, math.sin(angle) * radius, z))


def body_radius_at(z: float) -> float:
    """Interpolated body radius at an arbitrary z. Used by everything
    that has to sit ON the surface rather than at a joint."""
    if z >= JOINT_Z[0]:
        return BODY_R[0]
    for i in range(SEGMENTS):
        if JOINT_Z[i + 1] <= z <= JOINT_Z[i]:
            t = (JOINT_Z[i] - z) / SEG_LEN
            return BODY_R[i] + (BODY_R[i + 1] - BODY_R[i]) * t
    return BODY_R[-1]


def spike(a, b, r0=0.055, r1=0.006, sides=5, bow=None, seed=1):
    a, b = Vector(a), Vector(b)
    pts = kit.arc_path(a, b, bow, n=3) if bow else [a, a.lerp(b, 0.5), b]
    return kit.tube(pts, [r0, (r0 + r1) * 0.55, r1], sides=sides,
                    mode="transport", seed=seed, cap_end=False)


def chitin_t(params, base=0.24, span=0.54, power=1.0, along=0.0, glow=0.0,
             ramp=None):
    return kit.paint_t(
        params, ramp or CHITIN,
        lambda t, a, u: base + span * kit.topside(u, power) + along * t,
        glow=glow,
    )


def add(parts, name, bone, built, colors):
    parts.append(Part(name, bone, built[0], built[1], colors))


# ----------------------------------------------------------------------
# the body
# ----------------------------------------------------------------------

def build_segments(parts) -> None:
    """Thirteen rigid rings, telescoped into each other.

    Every part in this bestiary is bound to ONE bone at weight 1.0 -
    chitin does not stretch - and for a segmented animal that is not a
    compromise, it is the anatomy. What it does mean is that a joint
    can open a visible gap the moment the body bends, and this body
    bends constantly and hard.

    So each segment's front lip is authored FORWARD of its own joint
    and slightly under-size, sliding inside the flared aft lip of the
    segment ahead of it. The overlap is what closes the gap, and it is
    also exactly how a lobster's tail works: the plates were always
    going to have to slide over one another, and telescoping them makes
    the anatomy pay for the rig.
    """
    for i in range(SEGMENTS):
        bone = seg_bone(i)
        z0, z1 = JOINT_Z[i], JOINT_Z[i + 1]
        r0, r1 = BODY_R[i], BODY_R[i + 1]
        t = i / (SEGMENTS - 1)
        phase = 0.11 * i          # no two rings line their edges up

        # front lip (tucked), body, aft flare
        path = [Vector((0, 0, z0 + 0.34)), Vector((0, 0, z0)),
                Vector((0, 0, (z0 + z1) * 0.5)), Vector((0, 0, z1 + 0.06))]
        mid = (r0 + r1) * 0.5
        # THE AFT FLARE IS THE SEGMENT COUNT.
        # At 1.05 the overlap closed the joint gaps and did nothing else:
        # the first review frame came back as a smooth cigar with a paint
        # job, and thirteen segments that cannot be counted are one
        # segment. At 1.13 each ring ends in a lip that throws its own
        # shadow onto the ring behind it, which is what a segmented body
        # is READ by - the shadow, not the seam.
        radii = [
            (r0 * 0.84, r0 * 0.86),
            (r0 * 0.98, r0 * 1.00),
            (mid * 1.01, mid * 1.04),
            (r1 * 1.13, r1 * 1.16),
        ]
        v, f, p = kit.tube(path, radii, sides=SIDES, mode="up", phase=phase,
                           cap_start=False, cap_end=(i == SEGMENTS - 1),
                           profile=kit.flutes(SIDES, 0.028))
        add(parts, f"segment{i}", bone, (v, f),
            chitin_t(p, 0.10, 0.46, 1.35))

        # THE TERGITE. A lifted dorsal plate per segment, read by the
        # shadow under its edge rather than by its own value - the
        # animal is nearly black and has no other way to show a
        # segment count at distance.
        #
        # Scoured pale on the front third, where the body is dragged
        # through the sand the collar has just cut. That gradient is
        # also the cheapest possible way to say which end is the head.
        wear = max(0.0, 1.0 - t * 3.4)
        v, f, p = kit.shell(path, [r for r, _ in radii], arc=(-0.25, 0.25),
                            steps=7, thick=0.085, lift=0.075,
                            profile=lambda tt, u: 1.0 + 0.11 * (1.0 - tt))
        add(parts, f"tergite{i}", bone, (v, f),
            chitin_t(p, 0.12, 0.50, 1.2))
        # The scoured crest along the top of the plate. On the front of
        # the animal it is nearly bone; by the middle of the body there
        # is no wear left to show, and the same stripe reads as an
        # ordinary chitin ridge.
        v, f, p = kit.shell(path, [r for r, _ in radii], arc=(-0.075, 0.075),
                            steps=3, thick=0.030, lift=0.098)
        add(parts, f"crest{i}", bone, (v, f),
            kit.paint_t(p, SCOUR if wear > 0.35 else CHITIN,
                        lambda tt, a, u, w=wear: (0.06 + 0.30 * w)
                        + 0.34 * kit.topside(u, 1.3)))

        # The soft ring in front of each plate. A LINE across the body
        # rather than a patch on it, which is what makes it survive to
        # a range where the plates have stopped resolving.
        band = [Vector((0, 0, z0 + 0.30)), Vector((0, 0, z0 + 0.12))]
        bandr = [(r0 * 0.83, r0 * 0.85), (r0 * 0.90, r0 * 0.92)]
        heat = math.sin(min(1.0, (1.0 - t) * 1.1) * PI * 0.5) ** 0.8
        v, f, p = kit.tube(band, bandr, sides=SIDES, mode="up", phase=phase,
                           cap_start=False, cap_end=False)
        add(parts, f"membrane{i}", bone, (v, f),
            kit.paint_t(p, kit.BIO_RAMP,
                        lambda tt, a, u, h=heat: 0.22 + 0.42 * h,
                        glow=lambda tt, a, u, h=heat: kit.GLOW_SEAM * (0.35 + 0.65 * h)))

        # Ventral creep sole: transverse ridges on the underside, which
        # is how the animal actually moves when it is not swimming
        # through sand. Unlit, because the belly of a burrower never
        # sees the sky.
        v, f, p = kit.shell(path, [r for r, _ in radii], arc=(0.30, 0.70),
                            steps=5, thick=0.038, lift=0.006,
                            profile=kit.annulate(4, 0.05))
        add(parts, f"sole{i}", bone, (v, f), chitin_t(p, 0.02, 0.13))

        # SETAE. Backward-raked bristles, three a side, on the front
        # two thirds only. These are what a worm grips its own tunnel
        # with, and on the silhouette they are the difference between
        # an animal and a length of pipe.
        if i >= 1 and i <= 10:
            for k, u in enumerate((0.22, 0.48, 0.74)):
                z = z0 + (z1 - z0) * u
                r = body_radius_at(z)
                for side, sx in (("L", 1.0), ("R", -1.0)):
                    base = Vector((sx * r * 0.72, -r * 0.26, z))
                    # Nearly twice as thick as the first pass, which
                    # rendered as black wire whiskers - a bristle a
                    # centimetre across on a two-metre animal is a hair,
                    # and hairs do not survive being a silhouette.
                    tip = base + Vector((sx * r * 0.78, -r * 0.10, -0.96))
                    v, f, p = spike(base, tip, r0=0.135 * (1.25 - t), r1=0.010,
                                    sides=5, bow=(0, -0.07, 0.0),
                                    seed=311 + i * 7 + k)
                    add(parts, f"seta{i}{k}_{side}", bone, (v, f),
                        chitin_t(p, 0.30, 0.36, along=0.30, ramp=CHITIN))

        # PAIRED DORSAL SPINES, the whole length of the animal. These are
        # what the eye counts the segments by once the body is a
        # silhouette against sand or sky, which is most of the time it is
        # on screen - the same job the Matriarch's gaster spines do, and
        # the first pass put them only on the back half, where the animal
        # is thinnest and least often visible.
        z = (z0 + z1) * 0.42
        r = body_radius_at(z)
        for side, sx in (("L", 1.0), ("R", -1.0)):
            v, f, p = spike(Vector((sx * r * 0.34, r * 0.80, z)),
                            Vector((sx * (r * 0.62 + 0.16), r * 1.05 + 0.54,
                                    z - 0.58)),
                            r0=0.105 * (1.25 - t), r1=0.008, sides=5,
                            bow=(0, 0.08, 0), seed=401 + i * 3)
            add(parts, f"dorsal{i}_{side}", bone, (v, f),
                chitin_t(p, 0.38, 0.36, along=0.26))


def build_collar(parts) -> None:
    """The coulter itself: the blades that cut the sand open.

    Bound to the first segment rather than to the head, because the
    head is a hinge and these are not. The animal steers with its
    mouth and PLOUGHS with the metre behind it.
    """
    z_front, z_back = NECK_Z + 0.10, JOINT_Z[1] + 0.30
    base_r = 1.14

    # SEVEN RADIAL BLADES, and they have to be BIG.
    #
    # Authored at a 0.42m radial extent they stood a third of a metre
    # proud of a 1.2m body and did not exist in any review frame: the
    # feature the animal is named for, invisible. A coulter is a blade
    # that cuts a furrow wider than the thing following it, so these now
    # reach a full metre past the hull - the collar measures 4.3m across
    # against a 2.7m body - and they are swept forward so their tips are
    # the leading edge of the whole animal.
    #
    # Odd count, per the kit's rule, and phase-offset so no blade lines
    # up with the tergite crest behind it.
    for k in range(7):
        a = (k / 7) * TAU + 0.19
        pts = [
            ring_pt(a, base_r * 0.88, z_back - 0.50),
            ring_pt(a, base_r * 0.98, (z_front + z_back) * 0.5),
            ring_pt(a, base_r * 1.00, z_front + 0.10),
            ring_pt(a, base_r * 0.92, z_front + 0.92),
        ]
        # rx runs radially (the fin's height), rz tangentially (its
        # thickness). A fin that is thick tangentially is a lump.
        radii = [(0.22, 0.075), (0.92, 0.105), (1.02, 0.085), (0.44, 0.045)]
        v, f, p = kit.tube(pts, radii, sides=6, mode="up",
                           up=tuple(ring_pt(a, 1.0, 0.0)), cap_end=False)
        # Painted along its length rather than by facing: the tip is
        # polished and the root is filthy, and that is true whichever
        # way the fin happens to be pointing.
        add(parts, f"coulterfin{k}", seg_bone(0), (v, f),
            kit.paint_t(p, SCOUR,
                        lambda t, aa, u: 0.04 + 0.62 * t ** 1.4))
        # A hard leading edge on each blade, which is the line the eye
        # actually follows when the animal comes out of the sand.
        v, f, p = kit.shell(pts, [0.22, 0.92, 1.02, 0.44],
                            arc=(-0.045, 0.045), steps=2, thick=0.028,
                            lift=0.010, up=tuple(ring_pt(a, 1.0, 0.0)),
                            mode="up")
        add(parts, f"coulteredge{k}", seg_bone(0), (v, f),
            kit.paint_t(p, SCOUR, lambda t, aa, u: 0.22 + 0.56 * t))

    # Collar shield over the top of the first segment, and a heavy
    # shadow line under its edge.
    path = [Vector((0, 0, z_front + 0.30)), Vector((0, 0, z_front)),
            Vector((0, 0, z_back))]
    radii = [base_r * 0.94, base_r * 1.00, base_r * 1.02]
    v, f, p = kit.shell(path, radii, arc=(-0.31, 0.31), steps=9,
                        thick=0.085, lift=0.060)
    add(parts, "collar", seg_bone(0), (v, f), chitin_t(p, 0.16, 0.58, 1.15))

    # Spiracles: it has to breathe, and a burrower breathes out of the
    # top of its collar because that is the only part of it reliably
    # above the sand.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        for k, u in enumerate((0.30, 0.62)):
            z = z_front + (z_back - z_front) * u
            c = ring_pt(0.5 * PI - sx * 0.62, base_r * 0.99, z)
            v, f = kit.dome(0.10, 0.055, rings=2, sides=6, cut=0.85)
            v = kit.aim(v, tuple(c), tuple(c * 1.28))
            parts.append(Part(f"spiracle{k}_{side}", seg_bone(0), v, f,
                              kit.flat(v, kit.BIO_DIM, kit.GLOW_FAINT)))


def build_head(parts) -> None:
    """A blunt cone with a hole in it, and the hole is lit.

    The prostomium carries no eyes and no jaw hinge that shows from
    outside: at rest this end of the animal is deliberately the least
    interesting thing on it, so that opening the maw is a change of
    state rather than a change of pose.
    """
    # Prostomium: neck FLARING out to the maw rim, like a trumpet bell.
    # The flare is what makes the mouth an aperture rather than the blunt
    # end of a pipe.
    path = [Vector((0, 0, NECK_Z + 0.16)), Vector((0, 0, NECK_Z + 0.62)),
            Vector((0, 0, MAW_RIM_Z - 0.42)), Vector((0, 0, MAW_RIM_Z))]
    radii = [(1.00, 1.02), (1.06, 1.08), (1.16, 1.18), (MAW_RIM_R, MAW_RIM_R * 1.02)]
    v, f, p = kit.tube(path, radii, sides=SIDES, mode="up", phase=0.05,
                       cap_start=False, cap_end=False,
                       profile=kit.flutes(SIDES, 0.036))
    add(parts, "prostomium", "head", (v, f), chitin_t(p, 0.10, 0.46, 1.3))

    # A scoured crest over the brow - a STRIPE, not a sheet.
    #
    # This was a full-width plate painted from the bone ramp at up to
    # 0.98, and in the first review frames it was the brightest object on
    # screen: a near-white panel the size of a car on an animal whose
    # whole identity is being nearly black. Sand polishes a ridge, not a
    # whole surface, so it is narrow now and it tops out mid-bone.
    v, f, p = kit.shell(path, [r for r, _ in radii], arc=(-0.10, 0.10),
                        steps=4, thick=0.05, lift=0.045)
    add(parts, "crown", "head", (v, f),
        kit.paint_t(p, SCOUR, lambda t, a, u: 0.08 + 0.44 * kit.topside(u, 1.4)))

    # THE GULLET. A funnel receding into the head, wound INSIDE OUT -
    # see kit.flip. Lit from dim at the rim to full at the throat, so
    # an open mouth reads as depth rather than as a green disc.
    gpath = [Vector((0, 0, MAW_RIM_Z - 0.04)), Vector((0, 0, NECK_Z + 0.42)),
             Vector((0, 0, NECK_Z + 0.10)), Vector((0, 0, NECK_Z - 0.20))]
    gradii = [MAW_RIM_R * 0.94, 0.76, 0.46, 0.20]
    v, f, p = kit.tube(gpath, gradii, sides=SIDES, mode="up", phase=0.05,
                       cap_start=False, cap_end=True)
    add(parts, "gullet", "head", (v, kit.flip(f)),
        kit.paint_t(p, kit.VENOM_RAMP,
                    lambda t, a, u: 0.16 + 0.74 * t,
                    glow=lambda t, a, u: kit.GLOW_SEAM + (kit.GLOW_EYE - kit.GLOW_SEAM) * t ** 1.4))

    # The sphincter at the bottom of it, which is the actual lamp. A
    # funnel alone goes dark exactly where it is deepest, because the
    # facets there face away from the opening.
    v, f = kit.dome(0.26, 0.20, rings=3, sides=9, cut=0.95)
    v = kit.aim(v, (0, 0, NECK_Z - 0.10), (0, 0, MAW_RIM_Z))
    parts.append(Part("sphincter", "head", v, f,
                      kit.flat(v, kit.VENOM_CORE, kit.GLOW_EYE * 0.85)))

    # Three rings of inward-raked teeth down the funnel. Pale, because
    # enamel is the one part of an animal sand polishes rather than
    # dulls, and because five dark petals need something bright between
    # them or the open mouth is a hole with a lamp behind it.
    for row, (z, r, count, length) in enumerate((
        (MAW_RIM_Z - 0.06, MAW_RIM_R * 0.92, 13, 0.40),
        (NECK_Z + 0.56, 0.72, 13, 0.38),
        (NECK_Z + 0.14, 0.44, 9, 0.24),
    )):
        for k in range(count):
            a = (k / count) * TAU + row * 0.24
            base = ring_pt(a, r, z)
            tip = ring_pt(a, max(0.06, r - length * 0.86), z + length * 0.72)
            v, f, p = spike(base, tip, r0=0.082 - row * 0.014, r1=0.005,
                            sides=4, seed=601 + row * 31 + k)
            add(parts, f"tooth{row}_{k}", "head", (v, f),
                kit.paint_t(p, SCOUR, lambda t, aa, u: 0.34 + 0.52 * t))


def build_maw(parts) -> None:
    """Five hinged petals, authored SHUT.

    Shut is the pose the animal is in for most of the time it is on
    screen, so it is the one the silhouette is designed around - the
    same argument as the Matriarch's folded scythes. The petals meet
    forward of the rim in a blunt cone with five seams running down it,
    and the seams are the only thing on the front of a closed Coulter
    that says it is a mouth.
    """
    for k in range(PETALS):
        a = (k / PETALS) * TAU + PI * 0.5      # one petal dead on top
        bone = f"jaw{k}"
        base = ring_pt(a, MAW_RIM_R * 0.99, MAW_RIM_Z)
        tip = ring_pt(a, 0.15, MAW_RIM_Z + 1.62)
        radial = ring_pt(a, 1.0, 0.0)

        # A curved plate, not a tube: thin radially, wide tangentially,
        # so it presents an EDGE to its neighbours and closes into a
        # cone instead of into a bundle of fingers.
        #
        # Long, because closed these five petals ARE the front of the
        # animal - a 1.6m beak on a 2.6m mouth - and because the length
        # is what makes the opening read as a change of shape rather
        # than as a change of colour.
        pts = kit.arc_path(base, tip, tuple(radial * 0.20), n=5)
        radii = [(0.200, 0.86), (0.190, 0.88), (0.170, 0.78),
                 (0.140, 0.62), (0.100, 0.42), (0.048, 0.18)]
        v, f, p = kit.tube(pts, radii, sides=7, mode="up", up=tuple(radial),
                           cap_end=False)
        add(parts, f"petal{k}", bone, (v, f),
            chitin_t(p, 0.12, 0.52, 1.25, along=0.10))

        # A pale wear stripe along the ridge of each petal. The petals
        # are shut when the animal is swimming through sand, so they
        # are the leading surface and they show it - but as a RIDGE,
        # for the same reason the crown is one.
        v, f, p = kit.shell(pts, [0.200, 0.190, 0.170, 0.140, 0.100, 0.048],
                            arc=(-0.055, 0.055), steps=3, thick=0.026,
                            lift=0.012, up=tuple(radial), mode="up")
        add(parts, f"petalwear{k}", bone, (v, f),
            kit.paint_t(p, SCOUR, lambda t, aa, u: 0.14 + 0.44 * (1.0 - t)))

        # Fangs along the inner edge, raked back down the throat so
        # nothing that goes in comes out. Pale, and big enough to count
        # from outside the mouth.
        for j, u in enumerate((0.18, 0.38, 0.58, 0.78, 0.92)):
            c = pts[min(len(pts) - 1, int(u * (len(pts) - 1)))]
            inward = Vector((-c.x, -c.y, 0.0))
            if inward.length > 1e-6:
                inward.normalize()
            v, f, p = spike(c, c + inward * (0.44 - j * 0.055)
                            + Vector((0, 0, -0.34 + j * 0.04)),
                            r0=0.086 - j * 0.012, r1=0.006, sides=4,
                            seed=701 + k * 11 + j)
            add(parts, f"fang{k}{j}", bone, (v, f),
                kit.paint_t(p, SCOUR, lambda t, aa, u2: 0.26 + 0.44 * t))

        # The hinge membrane at the petal's root: lit, and the reason a
        # closed maw still reads as a mouth at fifty metres.
        v, f, p = kit.shell([base - radial * 0.02, base + Vector((0, 0, 0.16))],
                            [0.19, 0.17], arc=(-0.22, 0.22), steps=4,
                            thick=0.018, lift=0.004, up=tuple(radial), mode="up")
        add(parts, f"hinge{k}", bone, (v, f),
            kit.paint_t(p, kit.BIO_RAMP, lambda t, aa, u: 0.34,
                        glow=lambda t, aa, u: kit.GLOW_SEAM))

    # PALPS. The sensory crown, between the petals, and the only soft
    # line on the animal. A burrower with no eyes has to be shown
    # tasting the ground for the player to believe it can find them -
    # so these are what flick when it wakes up.
    for k in range(PALPS):
        a = (k / PALPS) * TAU + PI * 0.5 + TAU / (PALPS * 2)
        bone = f"palp{k}"
        radial = ring_pt(a, 1.0, 0.0)
        base = ring_pt(a, MAW_RIM_R * 0.86, MAW_RIM_Z - 0.10)
        path = kit.bezier(base,
                          base + radial * 0.30 + Vector((0, 0, 0.52)),
                          base + radial * 0.72 + Vector((0, 0, 0.86)),
                          base + radial * 1.05 + Vector((0, 0, 0.72)), n=7)
        v, f, p = kit.tube(path, [0.070, 0.062, 0.054, 0.046, 0.038, 0.030,
                                  0.022, 0.011],
                           sides=5, mode="transport", cap_end=False,
                           profile=kit.annulate(8, 0.15))
        add(parts, f"palp{k}", bone, (v, f),
            chitin_t(p, 0.28, 0.40, along=0.30,
                     glow=lambda t, aa, u: kit.GLOW_FAINT * max(0.0, t - 0.45) * 1.8))


def build_glands(parts) -> None:
    """Three pairs of venom sacs, on their own bones so they can fill.

    They are on the NECK, forward of the swell and clear of the
    tergites, for one reason: the player has to be able to see them
    swell from the front, because that swell is the wind-up on the only
    ranged attack in the fight. A gland on the flank of segment six
    would be perfectly reasonable anatomy and completely useless
    telegraphy.
    """
    for row, i in enumerate(GLAND_ROWS):
        z = JOINT_Z[i] + (JOINT_Z[i + 1] - JOINT_Z[i]) * 0.52
        r = body_radius_at(z)
        for side, sx in (("L", 1.0), ("R", -1.0)):
            bone = f"gland{row}_{side}"
            c = Vector((sx * r * 0.86, r * 0.30, z))
            size = 0.40 - row * 0.045
            v, f = kit.blob(size, sides=7, rings=3, squash=0.84,
                            seed=811 + row * 13, jitter=0.05)
            v = kit.transform(v, translate=tuple(c))
            parts.append(Part(f"gland{row}_{side}", bone, v, f,
                              kit.paint(v, kit.VENOM_RAMP,
                                        lambda q, cc=c, s=size:
                                        0.32 + 0.58 * ((q.y - cc.y) / (s * 2.0) + 0.5),
                                        glow=kit.GLOW_GLAND)))

            # A hard chitin cap over the outboard face of each sac, so
            # a bright green lobe cannot be shot off at any angle: the
            # armour is what makes the mouth the weak point.
            v, f = kit.dome(size * 0.92, size * 0.52, rings=2, sides=7, cut=0.88)
            v = kit.aim(v, tuple(c), tuple(c + Vector((sx * 0.6, 0.24, 0.0))))
            parts.append(Part(f"glandcap{row}_{side}", bone, v, f,
                              kit.paint(v, CHITIN, lambda q: 0.30)))

            # The duct running forward to the throat. It is what makes
            # the sac and the mouth one system on sight.
            duct = kit.arc_path(c + Vector((sx * 0.02, 0.06, size * 0.7)),
                                ring_pt(0.5 * PI - sx * 0.55, MAW_RIM_R * 0.9,
                                        MAW_RIM_Z - 0.22),
                                (sx * 0.10, 0.10, 0.0), n=4)
            v, f, p = kit.tube(duct, [0.075, 0.062, 0.052, 0.044, 0.034],
                               sides=5, mode="transport", cap_end=False)
            add(parts, f"duct{row}_{side}", bone, (v, f),
                kit.paint_t(p, kit.VENOM_RAMP, lambda t, aa, u: 0.22 + 0.34 * (1.0 - t),
                            glow=lambda t, aa, u: kit.GLOW_SEAM * 0.8))


def build_tail(parts) -> None:
    """The anchor. Four spades that plant, and the answer to a question
    the fight would otherwise raise every time it rears.

    A twenty-three metre worm standing eight metres out of the sand is
    holding itself up with something. This is that something, and it
    stays buried - so it is authored for the one frame it is seen in,
    which is the dive."""
    bone = seg_bone(SEGMENTS - 1)
    tip = Vector((0, 0, JOINT_Z[SEGMENTS] - 0.10))
    for k in range(4):
        a = (k / 4) * TAU + 0.4
        radial = ring_pt(a, 1.0, 0.0)
        base = tip + radial * 0.10 + Vector((0, 0, 0.55))
        end = base + radial * 0.52 + Vector((0, 0, -0.86))
        pts = kit.arc_path(base, end, tuple(radial * 0.10), n=4)
        v, f, p = kit.tube(pts, [(0.075, 0.16), (0.090, 0.20),
                                 (0.075, 0.17), (0.045, 0.10), (0.016, 0.04)],
                           sides=5, mode="up", up=tuple(radial), cap_end=False)
        add(parts, f"spade{k}", bone, (v, f),
            kit.paint_t(p, SCOUR, lambda t, aa, u: 0.10 + 0.58 * t))


def build_parts() -> list[Part]:
    parts: list[Part] = []
    build_segments(parts)
    build_collar(parts)
    build_head(parts)
    build_maw(parts)
    build_glands(parts)
    build_tail(parts)
    return parts


# ----------------------------------------------------------------------
# armature
#
# The chain runs FRONT TO BACK and every bone points backward, which
# matches how the runtime drives it: bone i is aimed at trail point
# i+1, so a bone whose rest axis already points down the body only ever
# receives the small rotation the actual bend needs. Authored the other
# way round, every bone would carry a 180-degree correction and the
# first frame of any solve would be a knot.
#
# `head` is the exception and points FORWARD, because the mouth leads.
# ----------------------------------------------------------------------

def build_bone_table() -> list[dict]:
    bones = [{"name": "root", "head": (0, 0, 0), "tail": (0, 0.50, 0)}]
    for i in range(SEGMENTS):
        bones.append({
            "name": seg_bone(i),
            "head": (0, 0, JOINT_Z[i]),
            "tail": (0, 0, JOINT_Z[i + 1]),
            "parent": seg_bone(i - 1) if i else "root",
            "connect": i > 0,
        })
    bones.append({"name": "head", "head": (0, 0, NECK_Z), "tail": (0, 0, MAW_RIM_Z + 0.30),
                  "parent": seg_bone(0)})

    for k in range(PETALS):
        a = (k / PETALS) * TAU + PI * 0.5
        base = ring_pt(a, MAW_RIM_R * 0.99, MAW_RIM_Z)
        tip = ring_pt(a, 0.15, MAW_RIM_Z + 1.62)
        bones.append({"name": f"jaw{k}", "head": tuple(base), "tail": tuple(tip),
                      "parent": "head",
                      # Local +Z points radially outward, so ONE euler
                      # value opens all five petals by the same amount.
                      "align_z": tuple(ring_pt(a, 1.0, 0.0))})
    for k in range(PALPS):
        a = (k / PALPS) * TAU + PI * 0.5 + TAU / (PALPS * 2)
        base = ring_pt(a, MAW_RIM_R * 0.86, MAW_RIM_Z - 0.10)
        bones.append({"name": f"palp{k}",
                      "head": tuple(base),
                      "tail": tuple(base + ring_pt(a, 1.05, 0.0)
                                    + Vector((0, 0, 0.72))),
                      "parent": "head",
                      "align_z": tuple(ring_pt(a, 1.0, 0.0))})
    for row, i in enumerate(GLAND_ROWS):
        z = JOINT_Z[i] + (JOINT_Z[i + 1] - JOINT_Z[i]) * 0.52
        r = body_radius_at(z)
        for side, sx in (("L", 1.0), ("R", -1.0)):
            c = Vector((sx * r * 0.86, r * 0.30, z))
            bones.append({"name": f"gland{row}_{side}", "head": tuple(c),
                          "tail": tuple(c + Vector((sx * 0.34, 0.16, 0.0))),
                          "parent": seg_bone(i)})
    return bones


# ----------------------------------------------------------------------
# animation
#
# NOTHING HERE TOUCHES THE SPINE. The optimiser strips `^spine` from
# every clip, because the body is laid along a trail the runtime keeps
# and a baked S-bend would fight it - including in `death`, which for
# every other creature in this bestiary is the one clip that owns its
# own locomotion bones. A dead Coulter goes limp along the trail it
# died on instead, which is the only way a body that was arched eight
# metres out of the sand can fall down rather than snap straight.
# ----------------------------------------------------------------------

JAWS = [f"jaw{k}" for k in range(PETALS)]
PALP_BONES = [f"palp{k}" for k in range(PALPS)]
GLANDS = [f"gland{r}_{s}" for r in range(len(GLAND_ROWS)) for s in ("L", "R")]
BODY_BONES = ["head"] + JAWS + PALP_BONES + GLANDS


def build_actions(arm) -> list[str]:
    scene = bpy.context.scene
    names: list[str] = []

    def rest():
        return {b: (0.0, 0.0, 0.0) for b in BODY_BONES}

    def iris(pose, amount, twist=0.0):
        """Open the maw by `amount` radians, with a little curl.

        Positive local X swings each petal's own axis toward its local
        +Z, which `align_z` has pointed radially outward - so one
        number irises all five. The twist is what stops the opening
        from reading as a mechanical shutter: the petals peel.

        THE CEILING IS ABOUT 0.62 RADIANS. The petals are already
        angled 33 degrees inward at rest, so an opening of 0.92 - which
        looked reasonable as a number - swung them 20 degrees PAST
        perpendicular: the mouth turned inside out and the review frame
        came back as an exploded artichoke with the throat behind it
        rather than as a funnel with the throat down it. At 0.62 the
        petals finish 22 degrees outward, which is a mouth.
        """
        for k, name in enumerate(JAWS):
            pose[name] = (amount, twist * (1 if k % 2 else -1), 0.0)

    def flare(pose, amount, sway=0.0):
        for k, name in enumerate(PALP_BONES):
            pose[name] = (amount, sway * math.sin(k * 1.9), 0.0)

    def bake(name, frames, length, scales=()):
        act = kit.new_action(arm, name)
        scene.frame_start = 0
        scene.frame_end = length
        for frame, pose in frames:
            kit.key_pose(arm, frame, pose)
        for frame, table in scales:
            kit.key_scale(arm, frame, table)
        kit.set_interpolation(act)
        names.append(name)
        return act

    def gland_scale(k):
        return {name: k for name in GLANDS}

    # ---- idle ---------------------------------------------------------
    # A slow fill and a drift in the palps. The maw stays shut: shut IS
    # the idle silhouette, and a boss that chews on nothing is a boss
    # nobody is afraid of.
    frames = []
    scales = []
    for frame, t in ((0, 0.0), (52, 1.0), (104, 0.0)):
        pose = rest()
        pose["head"] = (0.014 * t, 0.030 * math.sin(t * PI * 2), 0.0)
        iris(pose, 0.020 * t)
        flare(pose, -0.10 + 0.16 * t, 0.06 * t)
        frames.append((frame, pose))
        scales.append((frame, gland_scale(0.94 + 0.10 * t)))
    bake("idle", frames, 104, scales)

    # ---- alert --------------------------------------------------------
    # It has tasted the ground and found something. The palps snap
    # erect, the maw cracks - just enough for the gullet to show, which
    # is the whole point, because green is the game's hazard colour and
    # this is the frame it first appears in - and the sacs start
    # filling.
    frames = []
    scales = []
    for frame, t in ((0, 0.0), (14, 1.15), (26, 1.0), (52, 1.0)):
        pose = rest()
        pose["head"] = (-0.10 * t, 0.0, 0.0)
        iris(pose, 0.30 * t, 0.06 * t)
        flare(pose, 0.62 * t, 0.10 * t)
        frames.append((frame, pose))
        scales.append((frame, gland_scale(1.0 + 0.22 * t)))
    bake("alert", frames, 52, scales)

    # ---- spew ---------------------------------------------------------
    # THE TIMING IS A CONTRACT. The runtime launches the venom on the
    # frame the sacs finish emptying, which is frame 18 of 54 - 0.30s
    # at 60fps. Move it here and the projectile leaves a closed mouth.
    #
    # Rear back, then throw the whole head forward: the recoil is what
    # sells the volume, and it is also the player's cue to move, since
    # it happens before anything leaves the animal.
    frames = []
    scales = []
    for frame, t, fill in ((0, 0.0, 1.0), (10, -0.55, 1.42), (18, 1.0, 0.62),
                           (30, 0.72, 0.70), (54, 0.0, 1.0)):
        pose = rest()
        pose["head"] = (-0.34 * t, 0.0, 0.0)
        iris(pose, 0.62 * max(0.0, t) + 0.14 * max(0.0, -t), 0.14 * t)
        flare(pose, 0.30 + 0.52 * max(0.0, -t), -0.14 * max(0.0, t))
        frames.append((frame, pose))
        scales.append((frame, gland_scale(fill)))
    bake("spew", frames, 54, scales)

    # ---- strike -------------------------------------------------------
    # The bite. Opens faster than the spew and shuts past centre, so
    # the petals cross - a mouth that closes exactly flush reads as a
    # door.
    frames = []
    scales = []
    for frame, t in ((0, 0.0), (7, 1.0), (13, 1.05), (19, -0.30), (32, 0.0)):
        pose = rest()
        pose["head"] = (0.16 * max(0.0, t), 0.0, 0.0)
        iris(pose, 0.68 * max(0.0, t) + 0.30 * min(0.0, t), 0.10 * t)
        flare(pose, 0.20 - 0.42 * max(0.0, t), 0.0)
        frames.append((frame, pose))
        scales.append((frame, gland_scale(1.06)))
    bake("strike", frames, 32, scales)

    # ---- flinch -------------------------------------------------------
    frames = []
    for frame, t in ((0, 0.0), (4, 1.0), (12, 0.35), (22, 0.0)):
        pose = rest()
        pose["head"] = (0.20 * t, 0.10 * t, 0.0)
        iris(pose, 0.16 * t, -0.20 * t)
        flare(pose, -0.26 * t, 0.18 * t)
        frames.append((frame, pose))
    bake("flinch", frames, 22)

    # ---- death --------------------------------------------------------
    # The maw hangs open and the palps go dead. The BODY is not keyed
    # here - see the note above the clip table - so this reads as an
    # animal going limp wherever the trail left it.
    frames = []
    scales = []
    for frame, t in ((0, 0.0), (10, 0.45), (34, 0.90), (62, 1.0), (86, 1.0)):
        pose = rest()
        pose["head"] = (0.42 * t, 0.16 * t, 0.0)
        iris(pose, 0.52 * t, 0.26 * t)
        flare(pose, -0.62 * t, 0.24 * t)
        frames.append((frame, pose))
        scales.append((frame, gland_scale(1.0 - 0.34 * t)))
    bake("death", frames, 86, scales)

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
        # The runtime lays the body along a trail sampled at this
        # spacing. If the two disagree the body either concertinas into
        # itself or pulls apart at every joint, so it is reported.
        "segmentLengthM": SEG_LEN,
        "segments": SEGMENTS,
    }


def main() -> None:
    args = parse_args()
    kit.reset_scene()

    parts = build_parts()
    material = kit.vertex_colour_material("coulter-chitin")
    mesh_obj = kit.build_mesh_object("coulter", parts, material)
    arm = kit.build_armature("coulter-rig", build_bone_table())
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
        "legBonesAnimated": [],
        "textures": 0,
        **measure(parts),
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
