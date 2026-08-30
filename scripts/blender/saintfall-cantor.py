#!/usr/bin/env python3
"""Build the Cantor: SAINTFALL's Concord servitor-engine.

Run through Blender, not the system Python:

    blender --background --factory-startup \
      --python scripts/blender/saintfall-cantor.py -- \
      --output assets/models/saintfall/cantor.glb \
      --report output/saintfall/models/cantor.json

Design notes that matter more than the code:

  - THE FACTION READS BY COLOUR. The Bloom's Thresher is violet
    chitin; the Cantor is IRON_RAMP and GOLD_RAMP - the same two
    ramps as the trooper's armour and the autogun. That is the point.
    The machines holding the Censer Works and the Cathedral are the
    Concord's own servitors, still wearing the Concord's own livery,
    and the player works that out from the palette without being told.

  - 2.62m tall against a 1.85m trooper. The Thresher is 0.63x and
    scuttles; this is 1.4x and looms. Two enemies that differ in
    silhouette, height and hue cannot be confused at any range, which
    is the actual job of a second faction.

  - Reverse-jointed legs, knee behind the hip. That is a `kneePole`
    of fwd -1.0 in the runtime spec, and it is the single number that
    decides whether the rig reads as a machine or as a man in a suit.

  - No face. A censer hangs where the head should be, trailing smoke,
    which is both the district's name and the reason the thing is
    still walking: it is a censer-bearer that never stopped its round.

  - THE LEG BONES CARRY NO KEYFRAMES in any clip except `death`.
    Locomotion is solved procedurally in the browser against
    `terrain.heightAt` - same contract as the Thresher, same reason:
    baked walk cycles foot-slide on crater walls, and this level is
    mostly crater walls.
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
IRON, GOLD = kit.IRON_RAMP, kit.GOLD_RAMP


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
# Every number below is a standing measurement in metres, so the rig
# and the parts are authored against the same figures and the whole
# machine can be checked against the 1.85m trooper by reading them.
# ----------------------------------------------------------------------

HIP_Y = 1.42             # pelvis centreline
CHEST_Y = 1.94           # widest point of the torso
SHOULDER_Y = 2.02
COLLAR_Y = 2.22          # top of the torso drum
CENSER_Y = 2.34          # where the censer hangs from
CENSER_Z = 0.52          # ...and how far in FRONT of the chest
TOP_Y = 2.62             # overall height, incl. the stack tips

HIP_X = 0.26
KNEE = (0.28, 0.86, -0.34)      # BEHIND the hip: the reverse joint
FOOT = (0.28, 0.05, 0.10)       # ground contact, forward of the knee

SHOULDER_X = 0.46
ARM_Y = 1.86


def leg_names(side: str) -> tuple[str, str, str]:
    """The runtime matches /^(coxa|femur|tibia)(\\d+)_(L|R)$/.

    Index 0 and one pair only. The same solver drives this and the
    Thresher's six legs; a biped is just `legs: 1` to it.

    The separator is an UNDERSCORE and not a dot. three.js sanitises
    dots out of node names when it loads a glTF, because a dot is the
    property separator in its own animation binding paths - so a bone
    exported as `femur0.L` arrives as `femur0L`, the runtime's lookup
    finds nothing, and the IK silently does nothing at all.
    """
    return f"coxa0_{side}", f"femur0_{side}", f"tibia0_{side}"


# ----------------------------------------------------------------------
# geometry
# ----------------------------------------------------------------------

def _box(w, h, d):
    """An axis-aligned box centred on its own origin."""
    hw, hh, hd = w * 0.5, h * 0.5, d * 0.5
    verts = [
        Vector((-hw, -hh, -hd)), Vector((hw, -hh, -hd)),
        Vector((hw, -hh, hd)), Vector((-hw, -hh, hd)),
        Vector((-hw, hh, -hd)), Vector((hw, hh, -hd)),
        Vector((hw, hh, hd)), Vector((-hw, hh, hd)),
    ]
    faces = [
        (3, 2, 1, 0), (4, 5, 6, 7),
        (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
    ]
    return verts, faces


def add(parts, name, bone, verts, faces, colors):
    parts.append(Part(name=name, bone=bone, verts=verts, faces=faces,
                      colors=colors))


def build_parts() -> list[Part]:
    parts: list[Part] = []

    # ---- pelvis -------------------------------------------------
    # An eight-sided casting. Even side counts read as MACHINED;
    # the Bloom's parts all use odd counts so they read as grown.
    v, f = kit.ring_solid([
        Ring(y=HIP_Y - 0.30, r=0.20, sides=8, phase=0.39),
        Ring(y=HIP_Y - 0.16, r=0.33, sides=8),
        Ring(y=HIP_Y + 0.10, r=0.36, rz=0.30, sides=8),
        Ring(y=HIP_Y + 0.22, r=0.30, rz=0.26, sides=8, phase=0.39),
    ])
    add(parts, "pelvis", "pelvis", v, f,
        kit.paint(v, IRON, lambda p: 0.42 + (p.y - HIP_Y + 0.3) * 0.4
                  + max(0.0, p.z) * 0.3))

    # ---- torso --------------------------------------------------
    v, f = kit.ring_solid([
        Ring(y=HIP_Y + 0.16, r=0.30, rz=0.26, sides=8, phase=0.39),
        Ring(y=HIP_Y + 0.34, r=0.38, rz=0.30, sides=8),
        Ring(y=CHEST_Y, r=0.46, rz=0.34, sides=8),
        Ring(y=SHOULDER_Y + 0.06, r=0.44, rz=0.33, sides=8),
        Ring(y=COLLAR_Y, r=0.30, rz=0.25, sides=8, phase=0.39),
    ])
    add(parts, "torso", "torso", v, f,
        kit.paint(v, IRON, lambda p: 0.46 + (p.y - HIP_Y) * 0.26
                  + max(0.0, p.z) * 0.42))

    # ---- the rose vent ------------------------------------------
    # A cathedral rose window rendered as a machine intake, which is
    # the whole faction in one part: Concord iconography stamped into
    # Concord hardware.
    v, f = kit.ring_solid([
        Ring(y=CHEST_Y - 0.01, r=0.20, sides=12, cz=0.30),
        Ring(y=CHEST_Y, r=0.22, sides=12, cz=0.35),
        Ring(y=CHEST_Y + 0.01, r=0.17, sides=12, cz=0.37),
    ])
    add(parts, "rose", "torso", v, f, kit.paint(v, GOLD, lambda p: 0.42 + p.z * 0.9))
    for i in range(6):
        a = i / 6 * math.pi
        sv, sf = _box(0.035, 0.40, 0.035)
        sv = kit.transform(sv, translate=(0, CHEST_Y, 0.355), rotate=(0, 0, a))
        add(parts, f"spoke{i}", "torso", sv, sf, kit.flat(sv, "#2a1f16"))
    # The lamp behind the grille. The only warm emissive note on the
    # machine, and it sits exactly where a heart would.
    v, f = kit.ring_solid([
        Ring(y=CHEST_Y - 0.12, r=0.13, sides=8, cz=0.29),
        Ring(y=CHEST_Y + 0.12, r=0.13, sides=8, cz=0.29),
    ])
    add(parts, "rose-lamp", "torso", v, f, kit.flat(v, "#d86a2c"))

    # ---- shoulders ----------------------------------------------
    for side, sx in (("L", 1.0), ("R", -1.0)):
        v, f = kit.ring_solid([
            Ring(y=SHOULDER_Y + 0.22, r=0.20, rz=0.26, sides=7,
                 cx=sx * (SHOULDER_X - 0.10)),
            Ring(y=SHOULDER_Y + 0.04, r=0.34, rz=0.38, sides=7,
                 cx=sx * (SHOULDER_X + 0.04)),
            Ring(y=SHOULDER_Y - 0.28, r=0.27, rz=0.32, sides=7,
                 cx=sx * (SHOULDER_X + 0.09)),
        ])
        add(parts, f"pauldron_{side}", f"shoulder_{side}", v, f,
            kit.paint(v, IRON, lambda p: 0.50 + (p.y - SHOULDER_Y + 0.3) * 0.55
                      + max(0.0, p.z) * 0.4))
        # Gold rim: one band, at the edge, where a rim light would sit.
        v, f = kit.ring_solid([
            Ring(y=SHOULDER_Y - 0.26, r=0.29, rz=0.34, sides=7,
                 cx=sx * (SHOULDER_X + 0.08)),
            Ring(y=SHOULDER_Y - 0.34, r=0.24, rz=0.29, sides=7,
                 cx=sx * (SHOULDER_X + 0.11)),
        ])
        add(parts, f"pauldron-rim_{side}", f"shoulder_{side}", v, f,
            kit.paint(v, GOLD, lambda p: 0.5 + max(0.0, p.z) * 0.8))

    # ---- gold livery --------------------------------------------
    # A band at the waist and a collar at the throat. Three gold
    # reads spaced down the body (collar, rose, waist) carry the eye
    # through the figure; one gold read is just a bright bit.
    v, f = kit.ring_solid([
        Ring(y=HIP_Y + 0.30, r=0.385, rz=0.305, sides=8),
        Ring(y=HIP_Y + 0.40, r=0.40, rz=0.315, sides=8),
        Ring(y=HIP_Y + 0.48, r=0.375, rz=0.30, sides=8),
    ])
    add(parts, "waistband", "torso", v, f,
        kit.paint(v, GOLD, lambda p: 0.34 + max(0.0, p.z) * 0.7))
    v, f = kit.ring_solid([
        Ring(y=COLLAR_Y - 0.11, r=0.335, rz=0.28, sides=8),
        Ring(y=COLLAR_Y - 0.02, r=0.315, rz=0.265, sides=8),
    ])
    add(parts, "collar", "torso", v, f,
        kit.paint(v, GOLD, lambda p: 0.30 + max(0.0, p.z) * 0.8))

    # ---- upper arms ---------------------------------------------
    for side, sx in (("L", 1.0), ("R", -1.0)):
        v, f = kit.ring_solid([
            Ring(y=ARM_Y + 0.10, r=0.13, sides=6, cx=sx * (SHOULDER_X + 0.06)),
            Ring(y=ARM_Y - 0.24, r=0.11, sides=6, cx=sx * (SHOULDER_X + 0.10)),
            Ring(y=ARM_Y - 0.42, r=0.12, sides=6, cx=sx * (SHOULDER_X + 0.12),
                 cz=0.06),
        ])
        add(parts, f"arm_{side}", f"arm_{side}", v, f,
            kit.paint(v, IRON, lambda p: 0.44 + max(0.0, p.z) * 0.4))

    # ---- LEFT: the autocannon -----------------------------------
    # Asymmetry is the cheapest silhouette read there is. One arm is
    # a gun and the other is a claw, so which way it is facing and
    # what it is about to do are legible at fifty metres.
    gx = SHOULDER_X + 0.12
    v, f = kit.ring_solid([
        Ring(y=ARM_Y - 0.46, r=0.16, sides=6, cx=gx, cz=0.02),
        Ring(y=ARM_Y - 0.60, r=0.18, sides=6, cx=gx, cz=0.10),
        Ring(y=ARM_Y - 0.64, r=0.14, sides=6, cx=gx, cz=0.52),
        Ring(y=ARM_Y - 0.65, r=0.10, sides=6, cx=gx, cz=0.86),
        Ring(y=ARM_Y - 0.65, r=0.12, sides=6, cx=gx, cz=0.94),
    ])
    add(parts, "cannon", "arm_L", v, f,
        kit.paint(v, IRON, lambda p: 0.36 + max(0.0, p.z) * 0.20))
    # Ammo drum, offset outboard so it breaks the barrel's line.
    v, f = kit.ring_solid([
        Ring(y=ARM_Y - 0.44, r=0.15, sides=9, cx=gx + 0.12, cz=0.20),
        Ring(y=ARM_Y - 0.56, r=0.19, sides=9, cx=gx + 0.16, cz=0.20),
        Ring(y=ARM_Y - 0.72, r=0.15, sides=9, cx=gx + 0.12, cz=0.20),
    ])
    add(parts, "drum", "arm_L", v, f,
        kit.paint(v, IRON, lambda p: 0.50 + max(0.0, p.z) * 0.34))

    # ---- RIGHT: the claw ----------------------------------------
    cx = -(SHOULDER_X + 0.12)
    v, f = kit.ring_solid([
        Ring(y=ARM_Y - 0.46, r=0.15, sides=6, cx=cx, cz=0.04),
        Ring(y=ARM_Y - 0.62, r=0.17, sides=6, cx=cx, cz=0.10),
        Ring(y=ARM_Y - 0.70, r=0.13, sides=6, cx=cx, cz=0.16),
    ])
    add(parts, "fist", "arm_R", v, f,
        kit.paint(v, IRON, lambda p: 0.46 + max(0.0, p.z) * 0.34))
    for i, ang in enumerate((-0.55, 0.0, 0.55)):
        fv, ff = kit.wedge(0.34, 0.10, 0.09, taper=0.3)
        fv = kit.transform(fv, rotate=(math.pi * 0.62, 0, ang),
                           translate=(cx + math.sin(ang) * 0.10,
                                      ARM_Y - 0.74, 0.20))
        add(parts, f"claw{i}", "arm_R", fv, ff,
            kit.paint(fv, IRON, lambda p: 0.58 + max(0.0, p.z) * 0.4))

    # ---- neck, gibbet and censer --------------------------------
    v, f = kit.ring_solid([
        Ring(y=COLLAR_Y - 0.02, r=0.17, sides=8),
        Ring(y=CENSER_Y + 0.04, r=0.12, sides=8),
    ])
    add(parts, "neck", "neck", v, f, kit.paint(v, IRON, lambda p: 0.44))
    # The gibbet: a hooked arm carrying the censer OUT IN FRONT of
    # the chest. The first version hung it at cz 0.10, which is inside
    # the torso drum - the part rendered every frame and was never
    # once visible, which no triangle count or clip check catches.
    v, f = kit.ring_solid([
        Ring(y=CENSER_Y + 0.02, r=0.055, sides=5, cz=0.02),
        Ring(y=CENSER_Y + 0.16, r=0.050, sides=5, cz=0.16),
        Ring(y=CENSER_Y + 0.20, r=0.045, sides=5, cz=CENSER_Z),
    ])
    add(parts, "gibbet", "neck", v, f, kit.paint(v, IRON, lambda p: 0.52))
    # Chain, two links' worth of suggestion.
    cv, cf = _box(0.035, 0.30, 0.035)
    cv = kit.transform(cv, translate=(0, CENSER_Y + 0.06, CENSER_Z))
    add(parts, "chain", "censer", cv, cf, kit.paint(cv, GOLD, lambda p: 0.35))
    # The censer hangs BELOW its bone, so the bone's rotation swings
    # it like the real thing rather than spinning it in place.
    v, f = kit.ring_solid([
        Ring(y=CENSER_Y - 0.10, r=0.08, sides=9, cz=CENSER_Z),
        Ring(y=CENSER_Y - 0.22, r=0.20, sides=9, cz=CENSER_Z),
        Ring(y=CENSER_Y - 0.36, r=0.24, sides=9, cz=CENSER_Z),
        Ring(y=CENSER_Y - 0.50, r=0.14, sides=9, cz=CENSER_Z),
    ])
    add(parts, "censer", "censer", v, f,
        kit.paint(v, GOLD, lambda p: 0.46 + (CENSER_Y - p.y) * 0.8))
    # Coals, seen through the pierced belly of the censer.
    v, f = kit.ring_solid([
        Ring(y=CENSER_Y - 0.30, r=0.17, sides=9, cz=CENSER_Z),
        Ring(y=CENSER_Y - 0.40, r=0.10, sides=9, cz=CENSER_Z),
    ])
    add(parts, "coals", "censer", v, f, kit.flat(v, "#f08a3e"))

    # ---- exhaust stacks -----------------------------------------
    for i, ox in enumerate((-0.20, 0.0, 0.20)):
        h = 0.34 + (0.10 if i == 1 else 0.0)
        v, f = kit.ring_solid([
            Ring(y=COLLAR_Y - 0.10, r=0.075, sides=6, cx=ox, cz=-0.26),
            Ring(y=COLLAR_Y + h, r=0.062, sides=6, cx=ox * 1.15, cz=-0.32),
            Ring(y=COLLAR_Y + h + 0.06, r=0.085, sides=6, cx=ox * 1.18,
                 cz=-0.33),
        ])
        add(parts, f"stack{i}", "torso", v, f,
            kit.paint(v, IRON, lambda p: 0.56 + (p.y - COLLAR_Y) * 0.4))

    # ---- legs ---------------------------------------------------
    for side, sx in (("L", 1.0), ("R", -1.0)):
        coxa, femur, tibia = leg_names(side)
        hip = Vector((sx * HIP_X, HIP_Y - 0.06, 0.0))
        knee = Vector((sx * KNEE[0], KNEE[1], KNEE[2]))
        foot = Vector((sx * FOOT[0], FOOT[1], FOOT[2]))

        # Hip casting.
        v, f = kit.ring_solid([
            Ring(y=HIP_Y + 0.06, r=0.20, sides=7, cx=sx * HIP_X),
            Ring(y=HIP_Y - 0.16, r=0.24, sides=7, cx=sx * HIP_X),
        ])
        add(parts, f"hip_{side}", coxa, v, f,
            kit.paint(v, IRON, lambda p: 0.48 + max(0.0, p.z) * 0.34))

        # Thigh: hip -> knee, built along the segment so the taper
        # follows the bone rather than the world axis.
        v, f = _segment(hip, knee, 0.215, 0.150, sides=7)
        add(parts, f"thigh_{side}", femur, v, f,
            kit.paint(v, IRON, lambda p: 0.44 + max(0.0, p.z) * 0.4
                      + (p.y - KNEE[1]) * 0.24))
        # Shin: knee -> foot.
        v, f = _segment(knee, foot, 0.170, 0.105, sides=7)
        add(parts, f"shin_{side}", tibia, v, f,
            kit.paint(v, IRON, lambda p: 0.50 + max(0.0, p.z) * 0.4))
        # Knee cop, on the outside of the joint - the reverse bend is
        # the machine's whole read and it deserves a highlight.
        v, f = kit.ring_solid([
            Ring(y=KNEE[1] + 0.13, r=0.14, rz=0.17, sides=6,
                 cx=sx * KNEE[0], cz=KNEE[2] - 0.07),
            Ring(y=KNEE[1] - 0.06, r=0.18, rz=0.21, sides=6,
                 cx=sx * KNEE[0], cz=KNEE[2] - 0.11),
            Ring(y=KNEE[1] - 0.20, r=0.12, rz=0.14, sides=6,
                 cx=sx * KNEE[0], cz=KNEE[2] - 0.07),
        ])
        add(parts, f"cop_{side}", femur, v, f,
            kit.paint(v, GOLD, lambda p: 0.18 - max(0.0, p.z) * 0.15))

        # Foot: a splayed plate. Wide, because a two-legged machine
        # that stands on points reads as unstable and this one is
        # meant to read as immovable.
        v, f = kit.ring_solid([
            Ring(y=0.16, r=0.13, rz=0.17, sides=7,
                 cx=sx * FOOT[0], cz=FOOT[2]),
            Ring(y=0.05, r=0.19, rz=0.28, sides=7,
                 cx=sx * FOOT[0], cz=FOOT[2] + 0.04),
            Ring(y=0.00, r=0.17, rz=0.26, sides=7,
                 cx=sx * FOOT[0], cz=FOOT[2] + 0.04),
        ])
        add(parts, f"foot_{side}", f"foot0_{side}", v, f,
            kit.paint(v, IRON, lambda p: 0.52 - p.y * 0.7))

    return parts


def _segment(a: Vector, b: Vector, r0: float, r1: float, sides: int = 7):
    """A tapered solid running from a to b, in world-ish local space.

    Built by making the ring solid along +Y and then rotating it onto
    the segment. Authoring limb parts against their own bone's
    direction is what keeps a reverse-jointed leg from looking like a
    straight leg with a dent in it.
    """
    d = b - a
    length = d.length
    v, f = kit.ring_solid([
        Ring(y=0.0, r=r0, sides=sides),
        Ring(y=length * 0.5, r=(r0 + r1) * 0.5, sides=sides, phase=0.2),
        Ring(y=length, r=r1, sides=sides),
    ])
    # Rotate +Y onto the segment direction, then move to a.
    up = Vector((0.0, 1.0, 0.0))
    axis = up.cross(d.normalized())
    if axis.length < 1e-6:
        rot = None
    else:
        angle = math.acos(max(-1.0, min(1.0, up.dot(d.normalized()))))
        rot = (axis.normalized(), angle)
    out = []
    for vert in v:
        p = vert.copy()
        if rot is not None:
            p.rotate(kit.Matrix.Rotation(rot[1], 3, rot[0]))
        out.append(p + a)
    return out, f


# ----------------------------------------------------------------------
# rig
# ----------------------------------------------------------------------

def build_bone_table() -> list[dict]:
    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0.30, 0)},
        {"name": "pelvis", "head": (0, HIP_Y - 0.10, 0),
         "tail": (0, HIP_Y + 0.20, 0), "parent": "root"},
        {"name": "torso", "head": (0, HIP_Y + 0.20, 0),
         "tail": (0, COLLAR_Y, 0), "parent": "pelvis", "connect": True},
        {"name": "neck", "head": (0, COLLAR_Y, 0),
         "tail": (0, CENSER_Y, 0.04), "parent": "torso", "connect": True},
        # The censer bone points DOWN from its pivot, so keying it
        # swings the brazier on its chain instead of spinning it.
        {"name": "censer", "head": (0, CENSER_Y + 0.20, CENSER_Z),
         "tail": (0, CENSER_Y - 0.50, CENSER_Z), "parent": "neck"},
    ]
    for side, sx in (("L", 1.0), ("R", -1.0)):
        bones.append({"name": f"shoulder_{side}",
                      "head": (sx * (SHOULDER_X - 0.10), SHOULDER_Y, 0),
                      "tail": (sx * SHOULDER_X, ARM_Y + 0.10, 0),
                      "parent": "torso"})
        bones.append({"name": f"arm_{side}",
                      "head": (sx * (SHOULDER_X + 0.06), ARM_Y + 0.10, 0),
                      "tail": (sx * (SHOULDER_X + 0.12), ARM_Y - 0.70, 0.10),
                      "parent": f"shoulder_{side}", "connect": True})

    for side, sx in (("L", 1.0), ("R", -1.0)):
        coxa, femur, tibia = leg_names(side)
        hip = Vector((sx * HIP_X, HIP_Y - 0.06, 0.0))
        knee = Vector((sx * KNEE[0], KNEE[1], KNEE[2]))
        foot = Vector((sx * FOOT[0], FOOT[1], FOOT[2]))
        mid = hip.lerp(knee, 0.14)
        bones.append({"name": coxa, "head": tuple(hip), "tail": tuple(mid),
                      "parent": "pelvis"})
        bones.append({"name": femur, "head": tuple(mid), "tail": tuple(knee),
                      "parent": coxa, "connect": True})
        bones.append({"name": tibia, "head": tuple(knee), "tail": tuple(foot),
                      "parent": femur, "connect": True})
        # An explicit foot bone, deforming the foot plate only.
        #
        # glTF carries bone HEADS as node translations and throws the
        # tails away, so a leaf bone's length is simply not in the
        # file. Without this the runtime has to guess the tibia's
        # length, and a guess wrong by 15% makes the IK over- or
        # under-extend on every single step.
        bones.append({"name": f"foot0_{side}", "head": tuple(foot),
                      "tail": tuple(foot + Vector((0, 0, 0.22))),
                      "parent": tibia, "connect": True})
    return bones


# ----------------------------------------------------------------------
# animation
#
# Body bones only. The legs belong to the runtime solver, and a clip
# that keys them fights it - see the gate in saintfall-optimize-model.
# ----------------------------------------------------------------------

BODY_BONES = ["pelvis", "torso", "neck", "censer",
              "shoulder_L", "shoulder_R", "arm_L", "arm_R"]

LEG_BONES = [n for side in ("L", "R")
             for n in (*leg_names(side), f"foot0_{side}")]


def _rest(bones=None) -> dict[str, tuple[float, float, float]]:
    return {b: (0.0, 0.0, 0.0) for b in (bones or BODY_BONES)}


def build_actions(arm) -> list[str]:
    made = []

    # -- idle: a slow, heavy sway and the censer swinging on its
    #    chain a beat behind the body. The lag is the whole trick;
    #    a censer that swings in phase with the torso reads as
    #    welded to it.
    act = kit.new_action(arm, "idle")
    for frame, (lean, swing) in enumerate([
        (0.000, 0.00), (0.030, -0.10), (0.045, -0.16),
        (0.020, -0.06), (-0.010, 0.10), (-0.028, 0.17),
        (-0.014, 0.08), (0.000, 0.00),
    ]):
        p = _rest()
        p["torso"] = (lean, lean * 0.7, 0.0)
        p["pelvis"] = (-lean * 0.4, 0.0, 0.0)
        p["censer"] = (swing, 0.0, swing * 0.5)
        p["arm_L"] = (-lean * 0.8, 0.0, 0.0)
        p["arm_R"] = (-lean * 0.6, 0.0, -0.05)
        kit.key_pose(arm, frame * 14, p)
    kit.set_interpolation(act, "BEZIER")
    made.append("idle")

    # -- alert: draws itself up, cannon comes round toward the
    #    target, censer swings out hard.
    act = kit.new_action(arm, "alert")
    for frame, k in ((0, 0.0), (10, 1.0), (26, 0.86), (40, 1.0)):
        p = _rest()
        p["torso"] = (-0.16 * k, 0.0, 0.0)
        p["pelvis"] = (0.06 * k, 0.0, 0.0)
        p["neck"] = (-0.10 * k, 0.0, 0.0)
        p["censer"] = (0.34 * k, 0.0, 0.10 * k)
        p["shoulder_L"] = (-0.55 * k, 0.0, 0.30 * k)
        p["arm_L"] = (-0.30 * k, 0.0, 0.0)
        p["shoulder_R"] = (-0.20 * k, 0.0, -0.18 * k)
        kit.key_pose(arm, frame, p)
    kit.set_interpolation(act, "BEZIER")
    made.append("alert")

    # -- fire: three bursts. The recoil goes through the SHOULDER and
    #    the torso, not just the arm, because a cannon bolted to a
    #    two-tonne machine moves the machine.
    act = kit.new_action(arm, "fire")
    frame = 0
    p = _rest()
    p["shoulder_L"] = (-0.62, 0.0, 0.34)
    p["torso"] = (-0.14, -0.10, 0.0)
    p["censer"] = (0.30, 0.0, 0.0)
    kit.key_pose(arm, 0, p)
    for burst in range(3):
        for offset, kick in ((4, 1.0), (9, 0.15)):
            q = dict(p)
            q["shoulder_L"] = (-0.62 + 0.16 * kick, 0.0, 0.34)
            q["arm_L"] = (0.13 * kick, 0.0, 0.0)
            q["torso"] = (-0.14 + 0.07 * kick, -0.10 + 0.04 * kick, 0.0)
            q["censer"] = (0.30 - 0.16 * kick, 0.0, 0.08 * kick)
            kit.key_pose(arm, frame + offset, q)
        frame += 14
    kit.key_pose(arm, frame + 8, p)
    kit.set_interpolation(act, "BEZIER")
    made.append("fire")

    # -- flinch: a short, hard jolt. Deliberately ugly, because a
    #    graceful flinch reads as an idle variation.
    act = kit.new_action(arm, "flinch")
    for frame, k in ((0, 0.0), (3, 1.0), (9, -0.35), (18, 0.0)):
        p = _rest()
        p["torso"] = (0.30 * k, 0.14 * k, 0.10 * k)
        p["pelvis"] = (-0.12 * k, 0.0, 0.0)
        p["neck"] = (0.22 * k, 0.0, 0.0)
        p["censer"] = (-0.55 * k, 0.0, 0.24 * k)
        p["shoulder_L"] = (0.28 * k, 0.0, -0.16 * k)
        p["shoulder_R"] = (0.24 * k, 0.0, 0.20 * k)
        kit.key_pose(arm, frame, p)
    kit.set_interpolation(act, "BEZIER")
    made.append("flinch")

    # -- death: the ONLY clip that keys the legs.
    #    It has to: the runtime stops solving legs the moment the
    #    state is `death`, so whatever this clip leaves them doing is
    #    what the wreck looks like. It buckles at the knees, pitches
    #    forward, and the censer keeps swinging after the body stops.
    act = kit.new_action(arm, "death")
    for frame, k in ((0, 0.0), (7, 0.22), (16, 0.6), (30, 1.0), (46, 1.0)):
        p = _rest(BODY_BONES + LEG_BONES)
        p["torso"] = (0.62 * k, 0.20 * k, 0.26 * k)
        p["pelvis"] = (0.30 * k, 0.0, -0.12 * k)
        p["neck"] = (0.40 * k, 0.0, 0.0)
        # The censer overshoots at 30 and settles at 46 - the last
        # thing that moves on a dead machine.
        p["censer"] = (-0.9 * k if frame < 40 else -0.35, 0.0, 0.5 * k)
        p["shoulder_L"] = (0.5 * k, 0.0, -0.5 * k)
        p["shoulder_R"] = (0.42 * k, 0.0, 0.44 * k)
        p["arm_L"] = (0.5 * k, 0.0, 0.0)
        p["arm_R"] = (0.6 * k, 0.0, 0.0)
        for side in ("L", "R"):
            coxa, femur, tibia = leg_names(side)
            p[femur] = (0.85 * k, 0.0, 0.0)
            p[tibia] = (-1.30 * k, 0.0, 0.0)
            p[f"foot0_{side}"] = (0.5 * k, 0.0, 0.0)
        kit.key_pose(arm, frame, p)
    kit.set_interpolation(act, "BEZIER")
    made.append("death")

    return made


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
        # Vertex colours are the whole point: SAINTFALL has no
        # textures anywhere, so COLOR_0 carries all the surface
        # information and there is not one image in the file.
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


def main() -> None:
    args = parse_args()
    kit.reset_scene()

    parts = build_parts()
    material = kit.vertex_colour_material("cantor-iron")
    mesh_obj = kit.build_mesh_object("cantor", parts, material)
    arm = kit.build_armature("cantor-rig", build_bone_table())
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
        "heightM": TOP_Y,
        "textures": 0,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
