#!/usr/bin/env python3
"""Build the Winnower: SAINTFALL's Censer Works flyer.

    blender --background --factory-startup \
      --python scripts/blender/saintfall-winnower.py -- \
      --output assets/models/saintfall/source/winnower.raw.glb \
      --report output/saintfall/models/winnower.json

THE FIRST THING IN THE GAME THAT FLIES

Every silhouette in the bestiary so far is read off the ground: small
and low, tall and thin, wide and low, long and reared, a chain under
the sand, a body on stilts. All six are answered by looking ahead.
This one is answered by looking UP, which is a different reflex and
the only axis left that changes how a player holds the camera.

So it owns BROAD AND FLAT, and it owns it from underneath - the angle
the player will almost always see it from. Twenty-six metres of
wingspan and barely three of depth, so it reads as a shape crossing
the sky rather than as a creature standing in the world. Nothing else
here can make that outline, and nothing else here is lit from below.

WHY IT IS IN THE CENSER WORKS, AND WHY IT COMES DOWN

The district already burns: three flare stacks, fifty-eight to
sixty-six metres, throwing real light and real heat into the sky. The
Winnower does not have wings that beat hard enough to carry it - it
rides those columns, and its gut is a furnace that has to be re-lit
from them. That is the whole encounter: an animal that cannot be
reached is an animal that has to land eventually, and this one lands
because the fire it flies on runs out.

Which makes the melee answer diegetic rather than granted. It comes
down on its own schedule whatever the player does - so a lance build
always gets its window - and it comes down SOONER if its heat sacs
are shot out, which is the ranged build spending its damage to buy
that window early.

THE CENSERS ARE THE TELL

It trails three burning thuribles on chains beneath it, and they are
both the identity and the mechanic: they are where the ash falls
from, they hang in the player's view at the exact angle the animal is
usually seen, and they swing forward on the bombardment so the attack
has a wind-up that is visible from directly below.

Painted char and ash - the district's own iron ramp pushed dark -
with ember red in the gut and the censers. Deliberately REDDER than
the Concord's gold: gold is the player's own colour and the Censer
doctrine's, and a boss wearing it would read as friendly ordnance.
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

# --------------------------------------------------------------------
# CHAR AND EMBER.
#
# The district's own iron ramp (world.js's Censer Works block) pushed
# down into soot, so the animal belongs to the refinery it lives in -
# and one hot colour for everything the furnace touches. Ember red
# rather than the Concord's warm gold: the player's own lance, the
# Censer doctrine and every friendly command already own gold, and a
# hostile wearing it reads as ordnance rather than as a threat.
# --------------------------------------------------------------------
CHAR = kit.Ramp([
    (0.00, "#0a0908"), (0.26, "#191614"), (0.55, "#302a25"),
    (0.80, "#544741"), (1.00, "#8a7263"),
])
EMBER = kit.Ramp([
    (0.00, "#2a0a04"), (0.34, "#7a1c05"), (0.68, "#e0521a"), (1.00, "#ffb066"),
])
EMBER_CORE = "#ff7a26"
EMBER_HOT = "#ffc48a"
EMBER_DIM = "#8f2b08"


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
# Authored 1:1 in metres, Y-up, +Z forward, and authored IN FLIGHT -
# wings out, censers hanging - because that is the pose it is in for
# most of the encounter and the one the silhouette is designed around.
# The landed pose is a clip, not the bind pose.
# ----------------------------------------------------------------------

BODY_NOSE = Vector((0.0, 0.30, 5.40))
BODY_HEAD = Vector((0.0, 0.34, 4.30))
BODY_MID = Vector((0.0, 0.00, 0.60))
# The THORAX ends here now. The first build ran one long fuselage from
# nose to z -5.2 and the animal read as an aircraft; an insect is a
# THREE-PART body - head, thorax, gaster - and the pinch between the
# last two is most of what says "insect" at any distance.
BODY_TAIL = Vector((0.0, 0.42, -2.05))

# The wasp waist and the gaster behind it: annulated, drooping, and
# carrying the furnace-light between its plates.
PETIOLE = Vector((0.0, 0.30, -1.90))
ABD_MID = Vector((0.0, -0.16, -4.30))
ABD_TIP = Vector((0.0, -1.72, -7.30))

# Three bones a side. The joint positions are what the fold is built
# on: the outer two thirds hinge up and back, so a landed Winnower is
# a tent rather than a plank lying on the ash.
WING_ROOT = Vector((0.95, 0.18, 0.90))
WING_ELBOW = Vector((4.60, 1.35, 0.35))
WING_WRIST = Vector((8.90, 1.85, -1.30))
WING_TIP = Vector((13.10, 1.40, -3.60))

# THE SECOND PAIR. One membrane a side is a bat or a manta; insects
# fly on two pairs, and the gap of sky between forewing and hindwing
# is the single strongest insect read the underneath view can carry.
# Shorter, broader, swept back, on one bone - the pair BEATS OUT OF
# PHASE with the forewing in every clip, which is the other half of
# the read.
HIND_ROOT = Vector((0.85, 0.02, -0.62))
HIND_MIDA = Vector((3.60, 0.55, -1.85))
HIND_MIDB = Vector((6.30, 0.80, -3.30))
HIND_TIP = Vector((8.60, 0.55, -5.10))

# Antennae, swept back along the body in flight.
ANT_ROOT = Vector((0.16, 0.55, 4.92))
ANT_TIP = Vector((1.95, 1.55, 2.35))

# The furnace gut, slung under the thorax. This is what the fight is
# actually about once it is on the ground.
HEART = Vector((0.0, -0.85, 0.35))

# THE HEAT SACS, and these coordinates are a CONTRACT with
# combat.js's `HITBOX.winnower.sacs.offsets`. They were a hit volume
# with no geometry behind them for one build - the ranged half of the
# encounter asked the player to shoot two invisible spheres - so the
# numbers live here, next to the thing that draws them, and the model
# report prints them for the harness to check against.
SAC_OFFSETS = (Vector((1.35, 0.25, 0.85)), Vector((-1.35, 0.25, 0.85)))
SAC_R = 0.95

# Where the three thuribles hang from, front to back.
CENSER_MOUNTS = (
    Vector((0.0, -0.55, 3.10)),
    Vector((-2.35, -0.62, -0.70)),
    Vector((2.35, -0.62, -0.70)),
)
CENSER_DROP = 4.60


def mirror(p, sx: float) -> Vector:
    return Vector((p[0] * sx, p[1], p[2]))


def spike(a, b, r0=0.05, r1=0.006, sides=5, bow=None, seed=1):
    a, b = Vector(a), Vector(b)
    pts = kit.arc_path(a, b, bow, n=3) if bow else [a, a.lerp(b, 0.5), b]
    return kit.tube(pts, [r0, (r0 + r1) * 0.55, r1], sides=sides,
                    mode="transport", seed=seed, cap_end=False)


def char_t(params, base=0.24, span=0.56, power=1.0, along=0.0, glow=0.0):
    return kit.paint_t(
        params, CHAR,
        lambda t, a, u: base + span * kit.topside(u, power) + along * t,
        glow=glow,
    )


def add(parts, name, bone, built, colors):
    parts.append(Part(name, bone, built[0], built[1], colors))


def body_path():
    return kit.bezier(BODY_TAIL, (0.0, 0.10, -2.20), (0.0, 0.05, 2.40),
                      BODY_NOSE, n=9)


def body_radii():
    # Deepest where the wings load into it and pinched hard at both
    # ends: the mass has to be visibly BETWEEN the wings, or a flyer
    # reads as two sails with a stick through them.
    # Stockier than the first build: the thorax is the flight motor of
    # an insect and it should look like one - deep, muscled, and short.
    return [(0.62, 0.52), (0.88, 0.70), (1.06, 0.84), (1.18, 0.92),
            (1.22, 0.94), (1.14, 0.88), (0.96, 0.76), (0.72, 0.58),
            (0.48, 0.40), (0.26, 0.22)]


# ----------------------------------------------------------------------
# geometry
# ----------------------------------------------------------------------

def build_body(parts) -> None:
    path = body_path()
    radii = body_radii()

    v, f, p = kit.tube(path, radii, sides=9, mode="up", phase=0.1,
                       profile=kit.flutes(9, 0.04))
    add(parts, "carapace", "thorax", (v, f), char_t(p, 0.12, 0.50, 1.3))

    # A dorsal shield the length of the body. On something seen mostly
    # from below this is the one surface that catches sky, so it is the
    # only part of the animal painted anywhere near light.
    v, f, p = kit.shell(path, radii, arc=(-0.26, 0.26), steps=7,
                        thick=0.06, lift=0.045,
                        profile=lambda t, u: 1.0 + 0.10 * math.sin(t * PI))
    add(parts, "dorsum", "thorax", (v, f), char_t(p, 0.26, 0.58, 1.15))

    # THE VENTRAL GLOW SEAMS. Two lines of lit vent running the length
    # of the belly - the read that says "there is a fire inside this"
    # from directly underneath, which is where the player is.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        a0 = 0.30 * sx
        v, f, p = kit.shell(path, radii, arc=(a0, a0 + 0.06 * sx), steps=3,
                            thick=0.020, lift=0.010)
        add(parts, f"ventseam_{side}", "thorax", (v, f),
            kit.paint_t(p, EMBER,
                        lambda t, a, u: 0.24 + 0.56 * math.sin(t * PI),
                        glow=lambda t, a, u: kit.GLOW_SEAM * (0.35 + 0.65 * math.sin(t * PI))))

    # Spiracles along the flank, faint - the same restraint the rest of
    # the bestiary uses: present, not shouting.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        for k, t in enumerate((0.34, 0.52, 0.70)):
            i = int(t * (len(path) - 1))
            c = path[i]
            v, f = kit.dome(0.075, 0.045, rings=2, sides=6, cut=0.85)
            v = kit.aim(v, (c.x + sx * 0.62, c.y - 0.10, c.z),
                        (c.x + sx * 1.05, c.y - 0.16, c.z))
            parts.append(Part(f"spiracle{k}_{side}", "thorax", v, f,
                              kit.flat(v, EMBER_DIM, kit.GLOW_FAINT)))


def build_abdomen(parts) -> None:
    """The gaster: the rear two thirds of an insect, hung off a waist.

    Annulated - kit.annulate is the same pinch the Matriarch's belly
    uses - and CURLING, because a straight abdomen is a tail and a
    curled one is a wasp. The furnace shows between the plates: lit
    intersegment rings sit recessed into every pinch, so from below
    the gaster reads as banded fire barely held in by chitin, which
    is this animal's whole thesis in one piece of anatomy.

    Two sweeps rather than one, split at ABD_MID: a Part rides ONE
    bone, and the curl needs two - fore-gaster on abdomen1, aft on
    abdomen2 - with the seam landed on an annulation pinch where the
    silhouette already breaks."""
    # The waist first. Thin, bare, and dark - the pinch only works if
    # there is visibly less of it than of what it joins.
    v, f, p = kit.tube([Vector((0.0, 0.36, -1.45)), Vector((0.0, 0.28, -2.40))],
                       [(0.40, 0.34), (0.34, 0.29)], sides=8, mode="transport",
                       cap_start=False, cap_end=False)
    add(parts, "petiole", "thorax", (v, f), char_t(p, 0.10, 0.26))

    fore = kit.bezier(PETIOLE, Vector((0.0, 0.28, -3.05)),
                      Vector((0.0, 0.10, -3.75)), ABD_MID, n=6)
    aft = kit.bezier(ABD_MID, Vector((0.0, -0.52, -5.35)),
                     Vector((0.0, -1.18, -6.45)), ABD_TIP, n=7)
    fore_r = [(0.52, 0.46), (0.86, 0.76), (1.10, 0.96), (1.22, 1.06),
              (1.26, 1.10), (1.24, 1.08)]
    aft_r = [(1.24, 1.08), (1.16, 1.00), (1.00, 0.86), (0.80, 0.68),
             (0.58, 0.48), (0.36, 0.30), (0.16, 0.13)]
    for name, bone, path, radii, ann in (
        ("gasterfore", "abdomen1", fore, fore_r, 2),
        ("gasteraft", "abdomen2", aft, aft_r, 3),
    ):
        v, f, p = kit.tube(path, radii, sides=9, mode="up", phase=0.08,
                           profile=kit.annulate(ann, 0.060))
        add(parts, name, bone, (v, f), char_t(p, 0.10, 0.44, 1.3))
        # Tergite shell over the top of each sweep - the plates.
        v, f, p = kit.shell(path, radii, arc=(-0.30, 0.30), steps=5,
                            thick=0.05, lift=0.040,
                            profile=lambda t, u: 1.0 + 0.06 * math.sin(t * PI))
        add(parts, f"{name}plates", bone, (v, f), char_t(p, 0.24, 0.52, 1.1))

    # THE FIRE BETWEEN THE PLATES. One lit ring per annulation pinch,
    # slightly inside the chitin so the glow reads as escaping rather
    # than worn. This is the gaster's ventseam.
    stations = ((fore, fore_r, "abdomen1", (0.30, 0.62, 0.92)),
                (aft, aft_r, "abdomen2", (0.22, 0.55, 0.86)))
    ring_i = 0
    for path, radii, bone, ts in stations:
        for t in ts:
            i = min(len(path) - 2, int(t * (len(path) - 1)))
            c = path[i]
            w = radii[i][0] * 0.94
            h = radii[i][1] * 0.94
            ring = [c + Vector((0.0, 0.0, -0.09)), c + Vector((0.0, 0.0, 0.09))]
            v, f, p = kit.tube(ring, [(w, h), (w, h)], sides=10, mode="up",
                               cap_start=False, cap_end=False)
            add(parts, f"gasterring{ring_i}", bone, (v, f),
                kit.paint_t(p, EMBER, lambda t2, a, u: 0.42 + 0.40 * (1.0 - u),
                            glow=lambda t2, a, u: kit.GLOW_SEAM * (0.9 + 0.8 * (1.0 - u))))
            ring_i += 1

    # The sting. Nothing in the fight uses it - it is silhouette
    # punctuation, the way the Distaff's spinneret is.
    v, f, p = spike(ABD_TIP, ABD_TIP + Vector((0.0, -0.62, -1.15)),
                    r0=0.15, r1=0.010, sides=5, bow=(0.0, -0.16, 0.0), seed=261)
    add(parts, "sting", "abdomen2", (v, f), char_t(p, 0.30, 0.36, along=0.3))
    v, f = kit.dome(0.075, 0.06, rings=1, sides=5, cut=0.9)
    tip = ABD_TIP + Vector((0.0, -0.55, -1.02))
    v = kit.transform(v, translate=tuple(tip))
    parts.append(Part("stingtip", "abdomen2", v, f,
                      kit.flat(v, EMBER_DIM, kit.GLOW_FAINT)))


def build_heart(parts) -> None:
    """The furnace gut. Slung under the thorax, caged in iron ribs, and
    the reason the animal can fly at all - so it is also the thing the
    whole encounter is spent trying to reach."""
    v, f = kit.blob(1.02, sides=9, rings=3, squash=0.78, seed=201)
    v = kit.transform(v, translate=tuple(HEART))
    parts.append(Part("heartcore", "heart", v, f,
                      kit.paint(v, EMBER,
                                lambda q: 0.55 + 0.42 * max(0.0, -(q.y - HEART.y)),
                                glow=kit.GLOW_EYE * 0.92)))

    # The cage. Six ribs over the glow, so the light is BROKEN rather
    # than a smooth ball - a bare emissive sphere reads as a lamp, and
    # the bars are what make it read as something contained.
    for k in range(6):
        a = (k / 6) * TAU + 0.2
        top = HEART + Vector((math.cos(a) * 0.30, 0.92, math.sin(a) * 0.30))
        bot = HEART + Vector((math.cos(a) * 0.72, -0.86, math.sin(a) * 0.62))
        v, f, p = kit.tube(kit.arc_path(top, bot,
                                        (math.cos(a) * 0.30, 0.0, math.sin(a) * 0.26), n=4),
                           [0.105, 0.125, 0.115, 0.095, 0.075],
                           sides=5, mode="transport")
        add(parts, f"heartrib{k}", "heart", (v, f), char_t(p, 0.30, 0.44))

    # A collar where it meets the body, so it is mounted rather than
    # floating inside the silhouette.
    v, f = kit.dome(0.72, 0.34, rings=2, sides=9, cut=0.8)
    v = kit.transform(v, translate=(HEART.x, HEART.y + 0.86, HEART.z))
    parts.append(Part("heartcollar", "thorax", v, f,
                      kit.paint(v, CHAR, lambda q: 0.22)))


def build_sacs(parts) -> None:
    """The two lift bladders at the wing roots.

    The one part of this animal a rifle build is asked to aim at, so
    it is built to be AIMED AT: a lit bladder proud of the shoulder,
    caged in three ribs so the glow is broken rather than a smooth
    lamp, and carried on its own bone so the runtime can collapse it
    when it bursts. Everything else on the animal is char; these are
    the only two things on its upper surface that are not."""
    for i, off in enumerate(SAC_OFFSETS):
        side = "L" if off.x > 0 else "R"
        sx = 1.0 if off.x > 0 else -1.0
        bone = f"sac_{side}"
        v, f = kit.blob(SAC_R * 0.92, sides=8, rings=3, squash=0.86, seed=301 + i)
        v = kit.transform(v, translate=tuple(off))
        parts.append(Part(f"sacskin_{side}", bone, v, f,
                          kit.paint(v, EMBER,
                                    lambda q, o=off: 0.42 + 0.46 * kit.topside(
                                        (q.y - o.y) / max(0.2, SAC_R), 1.0),
                                    glow=kit.GLOW_GLAND)))
        # Three ribs over it, so it reads as a bladder under a cage
        # rather than as a floating light.
        for k in range(3):
            a = (k / 3) * TAU + 0.4
            top = off + Vector((math.cos(a) * 0.22, SAC_R * 0.86, math.sin(a) * 0.22))
            bot = off + Vector((math.cos(a) * 0.70, -SAC_R * 0.62, math.sin(a) * 0.60))
            v, f, p = kit.tube(kit.arc_path(top, bot,
                                            (math.cos(a) * 0.24, 0, math.sin(a) * 0.20), n=4),
                               [0.085, 0.100, 0.092, 0.076, 0.058],
                               sides=5, mode="transport")
            add(parts, f"sacrib{k}_{side}", bone, (v, f), char_t(p, 0.28, 0.42))
        # A vent slit on the outboard face - where it lets go.
        v, f = kit.dome(0.26, 0.16, rings=2, sides=6, cut=0.85)
        c = off + Vector((sx * SAC_R * 0.80, 0.10, 0.0))
        v = kit.aim(v, tuple(c), tuple(c + Vector((sx * 0.4, 0.12, 0.0))))
        parts.append(Part(f"sacvent_{side}", bone, v, f,
                          kit.flat(v, EMBER_CORE, kit.GLOW_EYE * 0.9)))


def build_head(parts) -> None:
    """Narrow, forward, and low - a head that is mostly intake. It does
    not need a face: at flying range the read is the wingspan, and up
    close the read is the fire."""
    neck = kit.arc_path(BODY_HEAD, BODY_NOSE, (0.0, -0.10, 0.0), n=4)
    v, f, p = kit.tube(neck, [(0.44, 0.38), (0.38, 0.32), (0.30, 0.26),
                              (0.22, 0.19), (0.13, 0.11)],
                       sides=8, mode="transport", profile=kit.flutes(8, 0.05))
    add(parts, "head", "head", (v, f), char_t(p, 0.18, 0.52, 1.2))

    # THE INTAKE. A funnel mouth that reads as something that swallows
    # hot air, open at the front, lit inside. `flip` because the
    # interior of a tapered tube is back-facing and would otherwise
    # render as a hole straight through the head.
    mouth = [BODY_NOSE + Vector((0, 0, -0.34)), BODY_NOSE + Vector((0, 0.02, 0.46))]
    v, f, p = kit.tube(mouth, [(0.30, 0.26), (0.46, 0.40)], sides=9,
                       mode="transport", cap_start=False, cap_end=False)
    add(parts, "intake", "head", (v, kit.flip(f)),
        kit.paint_t(p, EMBER, lambda t, a, u: 0.30 + 0.50 * t,
                    glow=lambda t, a, u: kit.GLOW_GLAND * (0.3 + 0.7 * t)))

    # Four ocelli in a row over the intake. A row rather than a
    # cluster: it is the one piece of anatomy read head-on, and a line
    # of lights is what says "this end is the front" at any distance.
    for k in range(4):
        u = (k / 3.0) * 2.0 - 1.0
        c = Vector((u * 0.26, 0.52 - 0.06 * u * u, 4.34 + 0.10 * (1 - abs(u))))
        r = 0.088 - 0.020 * abs(u)
        v, f = kit.dome(r, r * 0.85, rings=2, sides=6, cut=0.92)
        v = kit.aim(v, tuple(c), tuple(c + Vector((u * 0.2, 0.30, 0.34))))
        # EMBER_CORE, not EMBER_HOT: #ffc48a measured nine degrees of
        # hue from art.js's own `goldLit` at the same saturation and
        # value, which is the Concord's colour on the one piece of
        # anatomy this animal is read head-on by.
        parts.append(Part(f"ocellus{k}", "head", v, f,
                          kit.flat(v, EMBER_CORE, kit.GLOW_EYE)))

    # COMPOUND EYES. Two big faceted hemispheres on the head's flanks -
    # flat-shaded, so every facet catches the light separately, which
    # is what "compound" looks like at this poly budget. Dim ember
    # rather than bright: eyes that outshine the furnace would make
    # the head the read, and the head is not the read.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        c = Vector((sx * 0.40, 0.36, 4.52))
        v, f = kit.blob(0.30, sides=9, rings=4, squash=0.88, seed=271, jitter=0.03)
        v = kit.transform(v, translate=tuple(c), scale=(1.0, 1.05, 1.25))
        parts.append(Part(f"eye_{side}", "head", v, f,
                          kit.paint(v, EMBER,
                                    lambda q, cc=c, s2=sx: 0.30 + 0.42 * max(
                                        0.0, s2 * (q.x - cc.x) / 0.3),
                                    glow=kit.GLOW_EYE * 0.55)))

    # ANTENNAE. Two long feelers swept back over the body - the last
    # unarguably-insect line in the silhouette, and the one that costs
    # least. Segmented by bead knuckles; on their own bones so the
    # clips can lag them behind every turn the head makes.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        bone = f"antenna_{side}"
        root = Vector((sx * ANT_ROOT.x, ANT_ROOT.y, ANT_ROOT.z))
        tip = Vector((sx * ANT_TIP.x, ANT_TIP.y, ANT_TIP.z))
        path = kit.arc_path(root, tip, (sx * 0.55, 0.85, 0.4), n=7)
        v, f, p = kit.tube(path, [0.055, 0.048, 0.042, 0.036, 0.028, 0.020, 0.010],
                           sides=5, mode="transport", cap_end=False)
        add(parts, f"antenna_{side}", bone, (v, f), char_t(p, 0.30, 0.36, along=0.2))
        for j, t in enumerate((0.25, 0.5, 0.75)):
            i = int(t * (len(path) - 1))
            v, f = kit.blob(0.065 - 0.012 * j, sides=5, rings=2, seed=281 + j)
            v = kit.transform(v, translate=tuple(path[i]))
            parts.append(Part(f"antbead{j}_{side}", bone, v, f,
                              kit.paint(v, CHAR, lambda q: 0.38)))

    # Mandible rakes, swept back along the jaw. Small - this animal
    # kills with what it drops, not with its mouth.
    for side, sx in (("L", 1.0), ("R", -1.0)):
        base = Vector((sx * 0.24, 0.16, 4.86))
        v, f, p = spike(base, base + Vector((sx * 0.30, -0.24, 0.62)),
                        r0=0.075, r1=0.008, sides=5,
                        bow=(sx * 0.06, -0.04, 0.0), seed=211)
        add(parts, f"rake_{side}", "head", (v, f), char_t(p, 0.36, 0.40, along=0.24))


def wing_path(sx: float):
    return kit.bezier(mirror(WING_ROOT, sx), mirror(WING_ELBOW, sx),
                      mirror(WING_WRIST, sx), mirror(WING_TIP, sx), n=11)


def build_wings(parts) -> None:
    """Twenty-six metres of it, and the entire silhouette.

    Built as a THIN swept sheet rather than a tube: the radii pairs
    are (chord, thickness), and the thickness is a tenth of the chord
    throughout, which is what makes it a membrane instead of a
    thirteen-metre sausage. The spars are separate geometry laid on
    top, because a wing is read by its ribs the way a leaf is."""
    for side, sx in (("L", 1.0), ("R", -1.0)):
        path = wing_path(sx)
        n = len(path)
        # Chord is widest inboard and tapers to the tip; thickness
        # collapses faster, so the outer wing is nearly a blade.
        radii = []
        for i in range(n):
            t = i / (n - 1)
            # Slimmer than the first build: the hindwing behind it
            # carries the area now, and the GAP between the two pairs
            # is the read being bought.
            chord = 2.38 * (1.0 - t) ** 0.55 + 0.30
            thick = 0.24 * (1.0 - t) ** 1.4 + 0.030
            # (THICKNESS, CHORD), and the order is the whole difference
            # between a wing and a sail. `kit.tube` in "up" mode runs
            # its FIRST radius along the reference axis - which for a
            # roughly horizontal sweep is vertical - and the second
            # along the binormal, which is fore-aft. Handing it
            # (chord, thickness) built a five-metre-tall fin with a
            # forty-centimetre chord: correct span, edge-on wing, and
            # a creature that reads as a yacht from underneath.
            radii.append((thick, chord))

        # A SCALLOPED TRAILING EDGE. The membrane is pinched back
        # between the spars, the way a bat's is between its fingers -
        # a smooth swept arc reads as a manufactured aerofoil, and
        # this is the cheapest possible correction that says "grown".
        # Only the trailing half is touched: sin(angle) is negative
        # behind the spar line, so the leading edge stays clean.
        def wing_profile(t, a):
            behind = max(0.0, -math.sin(a * TAU))
            scallop = 0.5 + 0.5 * math.cos(t * PI * 9.0)
            return 1.0 - 0.30 * behind * scallop

        v, f, p = kit.tube(path, radii, sides=10, mode="up", phase=0.25,
                           profile=wing_profile)
        add(parts, f"membrane_{side}", f"wing0_{side}", (v, f),
            char_t(p, 0.10, 0.40, 1.5, along=0.18))

        # THE SPARS. Five per wing, running the chord, thickening at
        # the leading edge - these are what survive being seen as a
        # silhouette against a bright sky, when the membrane between
        # them has gone to a flat shape.
        for k in range(5):
            t = 0.10 + k * 0.185
            i = min(n - 2, int(t * (n - 1)))
            c = path[i]
            chord = radii[i][1]
            lead = c + Vector((0.0, 0.06, chord * 0.92))
            trail = c + Vector((0.0, -0.02, -chord * 0.92))
            bone = f"wing{min(2, k // 2)}_{side}"
            # Lifted clear of the membrane's own surface. Built at the
            # membrane's cross-section they protruded by about two
            # centimetres on a thirteen-metre wing and the wing
            # rendered as a featureless slab from directly below -
            # which is the exact angle they exist for.
            v, f, p = kit.tube([lead + Vector((0.0, 0.16, 0.0)),
                                c + Vector((0.0, 0.20, 0.0)),
                                trail + Vector((0.0, 0.02, -0.34))],
                               [0.215, 0.185, 0.050], sides=5, mode="transport",
                               cap_end=False)
            add(parts, f"spar{k}_{side}", bone, (v, f),
                char_t(p, 0.34, 0.42, along=-0.16))

        # A hot leading edge. The wing is the thing that touches the
        # thermal, so it is the thing that glows - and a lit line along
        # the front of a dark wing is legible from directly below at
        # any altitude the animal actually flies at.
        leading = [c + Vector((0.0, 0.05, radii[i][1] * 0.88))
                   for i, c in enumerate(path)]
        v, f, p = kit.tube(leading, [0.075] * n, sides=5, mode="transport",
                           cap_start=False, cap_end=False)
        add(parts, f"leadingedge_{side}", f"wing0_{side}", (v, f),
            kit.paint_t(p, EMBER, lambda t, a, u: 0.34 + 0.44 * (1.0 - t),
                        glow=lambda t, a, u: kit.GLOW_SEAM * (0.85 - t * 0.55)))

        # Joint knuckles, so the fold has visible hinges.
        for name, pt, r in (("elbow", WING_ELBOW, 0.42), ("wrist", WING_WRIST, 0.32)):
            v, f = kit.blob(r, sides=7, rings=2, seed=221)
            v = kit.transform(v, translate=tuple(mirror(pt, sx)))
            bone = f"wing{1 if name == 'elbow' else 2}_{side}"
            parts.append(Part(f"{name}_{side}", bone, v, f,
                              kit.paint(v, CHAR, lambda q: 0.36)))

        # CROSS-VEINS. Thin struts bridging adjacent spars at two
        # chord stations - the lattice is the wing-read every insect
        # field guide is drawn from, and it costs eight tubes.
        for k in range(4):
            tA = 0.10 + k * 0.185
            tB = 0.10 + (k + 1) * 0.185
            iA = min(n - 2, int(tA * (n - 1)))
            iB = min(n - 2, int(tB * (n - 1)))
            for station, lift in ((0.42, 0.14), (-0.38, 0.10)):
                a = path[iA] + Vector((0.0, lift, radii[iA][1] * station))
                b = path[iB] + Vector((0.0, lift, radii[iB][1] * station))
                v, f, p = kit.tube([a, b], [0.055, 0.048], sides=4,
                                   mode="transport", cap_start=False, cap_end=False)
                bone = f"wing{min(2, k // 2)}_{side}"
                add(parts, f"vein{k}{'a' if station > 0 else 'b'}_{side}", bone,
                    (v, f), char_t(p, 0.30, 0.34))

        # Trailing fringe. Ragged rather than a clean edge - a smooth
        # trailing edge reads as a manufactured sail.
        for k in range(7):
            t = 0.14 + k * 0.125
            i = min(n - 2, int(t * (n - 1)))
            c = path[i]
            chord = radii[i][1]
            root = c + Vector((0.0, -0.02, -chord * 0.9))
            tip = root + Vector((sx * 0.14, -0.30, -1.05 - 0.22 * (k % 3)))
            bone = f"wing{min(2, k // 3)}_{side}"
            v, f, p = spike(root, tip, r0=0.115, r1=0.008, sides=4, seed=231 + k)
            add(parts, f"fringe{k}_{side}", bone, (v, f), char_t(p, 0.30, 0.34))


def build_hindwings(parts) -> None:
    """The second pair. See HIND_ROOT's comment for why they exist.

    Everything the forewing taught applies: (thickness, chord) order,
    scalloped trailing edge, proud spars, a lit leading edge - just
    smaller, broader for their length, and swept back so the pair
    reads as a wasp's stacked planes rather than one long slab."""
    for side, sx in (("L", 1.0), ("R", -1.0)):
        path = kit.bezier(mirror(HIND_ROOT, sx), mirror(HIND_MIDA, sx),
                          mirror(HIND_MIDB, sx), mirror(HIND_TIP, sx), n=8)
        n = len(path)
        radii = []
        for i in range(n):
            t = i / (n - 1)
            chord = 1.92 * (1.0 - t) ** 0.62 + 0.26
            thick = 0.15 * (1.0 - t) ** 1.3 + 0.024
            radii.append((thick, chord))

        def hind_profile(t, a):
            behind = max(0.0, -math.sin(a * TAU))
            scallop = 0.5 + 0.5 * math.cos(t * PI * 7.0)
            return 1.0 - 0.26 * behind * scallop

        bone = f"hindwing_{side}"
        v, f, p = kit.tube(path, radii, sides=9, mode="up", phase=0.25,
                           profile=hind_profile)
        add(parts, f"hindmembrane_{side}", bone, (v, f),
            char_t(p, 0.12, 0.38, 1.5, along=0.16))

        for k in range(4):
            t = 0.12 + k * 0.22
            i = min(n - 2, int(t * (n - 1)))
            c = path[i]
            chord = radii[i][1]
            v, f, p = kit.tube([c + Vector((0.0, 0.14, chord * 0.90)),
                                c + Vector((0.0, 0.17, 0.0)),
                                c + Vector((0.0, 0.02, -chord * 0.94))],
                               [0.16, 0.14, 0.040], sides=5, mode="transport",
                               cap_end=False)
            add(parts, f"hindspar{k}_{side}", bone, (v, f),
                char_t(p, 0.34, 0.40, along=-0.14))

        leading = [c + Vector((0.0, 0.05, radii[i][1] * 0.86))
                   for i, c in enumerate(path)]
        v, f, p = kit.tube(leading, [0.060] * n, sides=5, mode="transport",
                           cap_start=False, cap_end=False)
        add(parts, f"hindleading_{side}", bone, (v, f),
            kit.paint_t(p, EMBER, lambda t, a, u: 0.30 + 0.40 * (1.0 - t),
                        glow=lambda t, a, u: kit.GLOW_SEAM * (0.55 - t * 0.35)))

        for k in range(5):
            t = 0.18 + k * 0.17
            i = min(n - 2, int(t * (n - 1)))
            c = path[i]
            chord = radii[i][1]
            root = c + Vector((0.0, -0.02, -chord * 0.9))
            tip = root + Vector((sx * 0.10, -0.24, -0.75 - 0.18 * (k % 2)))
            v, f, p = spike(root, tip, r0=0.095, r1=0.008, sides=4, seed=291 + k)
            add(parts, f"hindfringe{k}_{side}", bone, (v, f), char_t(p, 0.30, 0.32))


def build_censers(parts) -> None:
    """Three burning thuribles on chains.

    The identity, and the attack. They hang in the player's view at
    exactly the angle this animal is usually seen from, they are where
    the ash comes from, and the bombardment swings them forward - so
    the wind-up is visible from directly underneath, which is the only
    place a wind-up on a flyer is any use."""
    for k, mount in enumerate(CENSER_MOUNTS):
        # THREE BONES PER CHAIN. One was a four-and-a-half metre rigid
        # bar that could only swing from its mount - which is both
        # wrong for a chain and, worse, unable to DRAW UP: landed, a
        # rigid chain put every thurible four metres underground and
        # the animal's whole identity vanished for the entire melee
        # window. Three segments can coil against the belly.
        seg_bones = [f"censer{k}", f"censer{k}b", f"censer{k}c"]
        links = 9
        for i in range(links):
            t0 = i / links
            t1 = (i + 1) / links
            a = mount + Vector((0, -CENSER_DROP * t0, 0))
            b = mount + Vector((0, -CENSER_DROP * t1, 0))
            v, f, p = kit.tube([a, b], [0.105, 0.105], sides=4,
                               mode="transport", phase=0.4 * i)
            add(parts, f"chain{k}_{i}", seg_bones[min(2, i * 3 // links)],
                (v, f), char_t(p, 0.26, 0.30))
        bone = seg_bones[2]

        # The thurible itself: a pierced bowl with fire in it.
        base = mount + Vector((0, -CENSER_DROP, 0))
        v, f = kit.blob(1.05, sides=8, rings=3, squash=0.92, seed=241 + k)
        v = kit.transform(v, translate=tuple(base))
        parts.append(Part(f"bowl{k}", bone, v, f, kit.paint(v, CHAR, lambda q: 0.24)))

        # The coals, sitting proud of the bowl's mouth.
        v, f = kit.dome(0.78, 0.58, rings=2, sides=8, cut=0.85)
        v = kit.transform(v, translate=(base.x, base.y + 0.68, base.z))
        parts.append(Part(f"coals{k}", bone, v, f,
                          kit.flat(v, EMBER_CORE, kit.GLOW_EYE * 0.85)))

        # Pierce holes, as a ring of lit studs around the bowl - the
        # cheapest way to say "this is perforated and there is fire
        # behind it" without cutting real holes in the mesh.
        for j in range(7):
            a = (j / 7) * TAU
            c = base + Vector((math.cos(a) * 0.95, 0.04, math.sin(a) * 0.95))
            v, f = kit.dome(0.165, 0.11, rings=1, sides=5, cut=0.9)
            v = kit.aim(v, tuple(c), tuple(c + Vector((math.cos(a) * 0.6, 0.2, math.sin(a) * 0.6))))
            parts.append(Part(f"pierce{k}_{j}", bone, v, f,
                              kit.flat(v, EMBER_CORE, kit.GLOW_GLAND)))


def build_perches(parts) -> None:
    """Four short landing limbs, folded up in flight.

    Deliberately NOT named coxa/femur/tibia/foot: those prefixes are
    claimed by the runtime's leg IK, which solves feet against the
    terrain every frame. A flyer's limbs are owned by its clips from
    end to end - there is nothing to solve while it is in the air, and
    the landed pose is authored rather than derived."""
    # THREE PAIRS. Four limbs is a mammal count; an insect stands on
    # six, and the landed silhouette is where the count is read.
    for i, (fz, sx_out) in enumerate(((2.55, 0.90), (0.65, 1.08), (-1.30, 1.02))):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            # TWO BONES, because the stoke is the one phase the player
            # stands underneath this animal and a landing limb that
            # cannot bend its knee is four rigid sticks holding a boss
            # up at exactly the moment it is being looked at closest.
            bone = f"perch{i}_{side}"
            lower_bone = f"perch{i}b_{side}"
            hip = Vector((sx * 0.62 * sx_out, -0.42, fz))
            knee = Vector((sx * 1.42 * sx_out, -1.10, fz + 0.30))
            foot = Vector((sx * 1.15 * sx_out, -2.05, fz + 0.72))
            v, f, p = kit.tube(kit.arc_path(hip, knee, (sx * 0.10, 0.06, 0), n=4),
                               [0.190, 0.170, 0.145, 0.120, 0.100],
                               sides=6, mode="transport")
            add(parts, f"perchupper{i}_{side}", bone, (v, f), char_t(p, 0.20, 0.38))
            v, f = kit.blob(0.135, sides=6, rings=2, seed=311 + i)
            v = kit.transform(v, translate=tuple(knee))
            parts.append(Part(f"perchknee{i}_{side}", lower_bone, v, f,
                              kit.paint(v, CHAR, lambda q: 0.34)))
            v, f, p = kit.tube(kit.arc_path(knee, foot, (sx * 0.08, -0.05, 0), n=4),
                               [0.100, 0.088, 0.074, 0.058, 0.042],
                               sides=5, mode="transport")
            add(parts, f"perchlower{i}_{side}", lower_bone, (v, f), char_t(p, 0.22, 0.34))
            # Three hooked talons - it perches on pipework and stack
            # rims, so it grips rather than stands.
            for j, (dx, dz) in enumerate(((0.10, 0.26), (-0.10, 0.22), (0.02, -0.24))):
                tip = foot + Vector((sx * dx, -0.24, dz))
                v, f, p = spike(foot, tip, r0=0.052, r1=0.006, sides=4, seed=251 + j)
                add(parts, f"talon{i}{j}_{side}", lower_bone, (v, f), char_t(p, 0.40, 0.30))


def build_parts() -> list[Part]:
    parts: list[Part] = []
    build_body(parts)
    build_abdomen(parts)
    build_heart(parts)
    build_sacs(parts)
    build_head(parts)
    build_wings(parts)
    build_hindwings(parts)
    build_censers(parts)
    build_perches(parts)
    return parts


# ----------------------------------------------------------------------
# armature
# ----------------------------------------------------------------------

def build_bone_table() -> list[dict]:
    bones = [
        {"name": "root", "head": (0, 0, 0), "tail": (0, 0.60, 0)},
        {"name": "thorax", "head": tuple(BODY_TAIL), "tail": tuple(BODY_HEAD),
         "parent": "root"},
        {"name": "head", "head": tuple(BODY_HEAD), "tail": tuple(BODY_NOSE),
         "parent": "thorax", "connect": True},
        {"name": "heart", "head": (HEART.x, HEART.y + 0.86, HEART.z),
         "tail": (HEART.x, HEART.y - 0.9, HEART.z), "parent": "thorax"},
    ]
    for side, sx in (("L", 1.0), ("R", -1.0)):
        bones.append({"name": f"wing0_{side}", "head": tuple(mirror(WING_ROOT, sx)),
                      "tail": tuple(mirror(WING_ELBOW, sx)), "parent": "thorax"})
        bones.append({"name": f"wing1_{side}", "head": tuple(mirror(WING_ELBOW, sx)),
                      "tail": tuple(mirror(WING_WRIST, sx)),
                      "parent": f"wing0_{side}", "connect": True})
        bones.append({"name": f"wing2_{side}", "head": tuple(mirror(WING_WRIST, sx)),
                      "tail": tuple(mirror(WING_TIP, sx)),
                      "parent": f"wing1_{side}", "connect": True})
    # The gaster's two segments, chained off the thorax at the waist.
    bones.append({"name": "abdomen1", "head": tuple(PETIOLE),
                  "tail": tuple(ABD_MID), "parent": "thorax"})
    bones.append({"name": "abdomen2", "head": tuple(ABD_MID),
                  "tail": tuple(ABD_TIP), "parent": "abdomen1", "connect": True})
    for side, sx in (("L", 1.0), ("R", -1.0)):
        bones.append({"name": f"hindwing_{side}",
                      "head": tuple(mirror(HIND_ROOT, sx)),
                      "tail": tuple(mirror(HIND_TIP, sx)), "parent": "thorax"})
        bones.append({"name": f"antenna_{side}",
                      "head": (sx * ANT_ROOT.x, ANT_ROOT.y, ANT_ROOT.z),
                      "tail": (sx * ANT_TIP.x, ANT_TIP.y, ANT_TIP.z),
                      "parent": "head"})
    for i, off in enumerate(SAC_OFFSETS):
        side = "L" if off.x > 0 else "R"
        bones.append({"name": f"sac_{side}", "head": tuple(off),
                      "tail": tuple(off + Vector((0, SAC_R, 0))),
                      "parent": "thorax"})
    for k, mount in enumerate(CENSER_MOUNTS):
        # Three segments down the chain, each parented to the last, so
        # the runtime's landed poses can coil it against the belly.
        seg = CENSER_DROP / 3.0
        for j, name in enumerate((f"censer{k}", f"censer{k}b", f"censer{k}c")):
            bones.append({
                "name": name,
                "head": tuple(mount + Vector((0, -seg * j, 0))),
                "tail": tuple(mount + Vector((0, -seg * (j + 1), 0))),
                "parent": "thorax" if j == 0 else f"censer{k}{'b' if j == 2 else ''}",
                "connect": j > 0,
            })
    for i, (fz, sx_out) in enumerate(((2.55, 0.90), (0.65, 1.08), (-1.30, 1.02))):
        for side, sx in (("L", 1.0), ("R", -1.0)):
            bones.append({"name": f"perch{i}_{side}",
                          "head": (sx * 0.62 * sx_out, -0.42, fz),
                          "tail": (sx * 1.42 * sx_out, -1.10, fz + 0.30),
                          "parent": "thorax"})
            bones.append({"name": f"perch{i}b_{side}",
                          "head": (sx * 1.42 * sx_out, -1.10, fz + 0.30),
                          "tail": (sx * 1.15 * sx_out, -2.05, fz + 0.72),
                          "parent": f"perch{i}_{side}", "connect": True})
    return bones


# ----------------------------------------------------------------------
# animation
# ----------------------------------------------------------------------

BODY_BONES = (["thorax", "head", "heart", "sac_L", "sac_R",
               "abdomen1", "abdomen2",
               "hindwing_L", "hindwing_R", "antenna_L", "antenna_R",
               "wing0_L", "wing0_R", "wing1_L", "wing1_R", "wing2_L", "wing2_R"]
              + [f"censer{k}{suffix}" for k in range(3) for suffix in ("", "b", "c")]
              + [f"perch{i}{suffix}_{side}" for i in (0, 1, 2)
                 for suffix in ("", "b") for side in ("L", "R")])


def build_actions(arm) -> list[str]:
    scene = bpy.context.scene
    names: list[str] = []

    def rest():
        return {b: (0.0, 0.0, 0.0) for b in BODY_BONES}

    def sym(pose, stem, x, y, z):
        """Mirror a pose onto both sides. Y and Z negate across the
        mirror and X does not - the bones are built by reflecting
        positions through x=0, so a rotation about the shared long
        axis keeps its sign while the off-axis components swap."""
        pose[f"{stem}_L"] = (x, y, z)
        pose[f"{stem}_R"] = (x, -y, -z)

    def swing(pose, k, x, trail=0.35, y=0.0, z=0.0):
        """Pose one censer chain. `trail` is how much of the upper
        segment's rotation the lower two inherit ON TOP of their own -
        a chain bends progressively along its length, and keying all
        three identically is what made it read as a bar."""
        pose[f"censer{k}"] = (x, y, z)
        pose[f"censer{k}b"] = (x * trail, y * 0.6, z * 0.6)
        pose[f"censer{k}c"] = (x * trail * trail, y * 0.35, z * 0.35)

    def tuck(pose, t):
        """Landing gear. Folded flat against the belly at t=0, reaching
        at t=1 - shared by every airborne clip so the limbs are never
        left hanging in a glide. The lower segment counter-rotates, so
        a reaching limb straightens instead of jack-knifing. Three
        pairs now; the middle pair reaches a beat less than the outer
        two, which stops six legs reading as one comb."""
        sym(pose, "perch0", -1.15 * (1 - t), 0.0, 0.0)
        sym(pose, "perch1", -1.08 * (1 - t), 0.0, 0.0)
        sym(pose, "perch2", -1.02 * (1 - t), 0.0, 0.0)
        sym(pose, "perch0b", -0.95 * (1 - t) + 0.34 * t, 0.0, 0.0)
        sym(pose, "perch1b", -0.90 * (1 - t) + 0.26 * t, 0.0, 0.0)
        sym(pose, "perch2b", -0.86 * (1 - t) + 0.30 * t, 0.0, 0.0)

    def insect(pose, wing=0.0, lag=1.3, abd=0.0, abd2=None, ant=0.0, sway=0.0):
        """The insect half of every pose, in one call per clip.

        `wing` mirrors the forewing's beat onto the hindwings scaled a
        touch LARGER and offset a touch DOWN - two planes moving out
        of phase is the strongest airborne insect read there is.
        `abd` curls the gaster under (its resting droop is authored
        into the bones, so zero is already alive); `ant` sweeps the
        antennae, negative forward; `sway` is a lateral gaster swing
        for asymmetric actions."""
        sym(pose, "hindwing", wing * lag - 0.05, 0.0, 0.09)
        pose["abdomen1"] = (abd * 0.55, sway, 0.0)
        pose["abdomen2"] = ((abd if abd2 is None else abd2), sway * 0.6, 0.0)
        sym(pose, "antenna", ant, 0.0, 0.10 * ant)

    def bake(name, frames, length):
        act = kit.new_action(arm, name)
        scene.frame_start = 0
        scene.frame_end = length
        for frame, pose in frames:
            kit.key_pose(arm, frame, pose)
        kit.set_interpolation(act)
        names.append(name)
        return act

    # ---- idle: the soar. A slow, shallow beat, because this thing is
    # carried by the thermal rather than by its own wings - a hard flap
    # cycle would say "it is holding itself up", which is the opposite
    # of the fiction the whole encounter rests on.
    frames = []
    for frame, t in ((0, 0.0), (40, 1.0), (80, 0.0)):
        pose = rest()
        pose["thorax"] = (0.030 * t, 0.0, 0.0)
        pose["head"] = (-0.040 * t, 0.0, 0.0)
        sym(pose, "wing0", -0.14 * t, 0.0, 0.0)
        sym(pose, "wing1", -0.10 * t, 0.0, 0.0)
        sym(pose, "wing2", -0.16 * t, 0.0, 0.0)
        # The censers lag the body - they are on chains, so they swing
        # a beat behind whatever the animal does.
        for k in range(3):
            swing(pose, k, 0.16 * math.sin(t * PI - 0.6))
        # The hindwings beat AGAINST the forewings (note the sign) and
        # the gaster breathes a half-cycle behind both - three planes
        # of motion where the first build had one.
        insect(pose, wing=0.18 * t - 0.09, abd=0.10 * math.sin(t * PI),
               ant=0.06 * t)
        tuck(pose, 0.0)
        frames.append((frame, pose))
    bake("idle", frames, 80)

    # ---- alert: wings snap to full span and the heart flares open.
    frames = []
    for frame, t in ((0, 0.0), (12, 1.15), (24, 1.0), (48, 1.0)):
        pose = rest()
        pose["thorax"] = (-0.10 * t, 0.0, 0.0)
        pose["head"] = (-0.16 * t, 0.0, 0.0)
        pose["heart"] = (0.0, 0.0, 0.0)
        sym(pose, "wing0", 0.12 * t, 0.0, -0.10 * t)
        sym(pose, "wing1", 0.08 * t, 0.0, 0.0)
        sym(pose, "wing2", 0.14 * t, 0.0, 0.0)
        for k in range(3):
            swing(pose, k, -0.24 * t)
        insect(pose, wing=0.22 * t, abd=-0.16 * t, ant=-0.34 * t)
        tuck(pose, 0.0)
        frames.append((frame, pose))
    bake("alert", frames, 48)

    # ---- bombard: the censers swing FORWARD and up, then whip down.
    # The runtime drops ash on the whip, frame 22 of 52 - a contract
    # with the model, like the Coulter's spew.
    frames = []
    for frame, t in ((0, 0.0), (12, -0.55), (22, 1.0), (32, 0.65), (52, 0.0)):
        pose = rest()
        pose["thorax"] = (0.16 * max(0.0, t), 0.0, 0.0)
        pose["head"] = (0.20 * max(0.0, t), 0.0, 0.0)
        sym(pose, "wing0", 0.10 * abs(t), 0.0, 0.0)
        sym(pose, "wing1", 0.14 * abs(t), 0.0, 0.0)
        for k in range(3):
            # Front censer leads, the rear pair follow - a ripple, not
            # a single lurch, so three chains do not move as one plank.
            # The lower segments trail the upper one, which is what
            # makes four metres of chain read as chain.
            lag = 1.0 - k * 0.18
            swing(pose, k, -0.95 * t * lag, trail=0.55,
                  z=0.10 * t * (1 if k == 1 else -1))
        insect(pose, wing=0.12 * abs(t), abd=0.22 * t, ant=-0.10 * max(0.0, t))
        tuck(pose, 0.0)
        frames.append((frame, pose))
    bake("bombard", frames, 52)

    # ---- strain: what a Winnower losing its lift looks like. Wings
    # beat hard and out of time, the heart guttering. Played by the
    # runtime once the heat sacs are shot out and it is fighting to
    # stay up - the tell that a forced landing is coming.
    frames = []
    for frame, t in ((0, 0.0), (7, 1.0), (14, -0.4), (21, 0.9), (30, 0.0)):
        pose = rest()
        pose["thorax"] = (0.10 * t, 0.06 * t, 0.05 * t)
        pose["head"] = (0.12 * t, -0.08 * t, 0.0)
        # Deliberately ASYMMETRIC - both wings beating together reads
        # as effort, one wing lagging reads as failure.
        pose["wing0_L"] = (-0.46 * t, 0.0, 0.0)
        pose["wing0_R"] = (-0.30 * t, 0.0, 0.0)
        pose["wing1_L"] = (-0.34 * t, 0.0, 0.0)
        pose["wing1_R"] = (-0.20 * t, 0.0, 0.0)
        pose["wing2_L"] = (-0.40 * t, 0.0, 0.0)
        pose["wing2_R"] = (-0.24 * t, 0.0, 0.0)
        for k in range(3):
            swing(pose, k, 0.34 * t, trail=0.7, y=0.12 * t * (1 if k % 2 else -1))
        insect(pose, wing=0, abd=0.30 * t, ant=0.28 * t, sway=0.10 * t)
        pose["hindwing_L"] = (-0.52 * t - 0.05, 0.0, 0.09)
        pose["hindwing_R"] = (-0.22 * t - 0.05, 0.0, -0.09)
        tuck(pose, 0.12)
        frames.append((frame, pose))
    bake("strain", frames, 30)

    # ---- land: wings cup hard to brake, gear reaches, body pitches up.
    frames = []
    for frame, t in ((0, 0.0), (14, 0.55), (26, 1.0), (34, 1.0)):
        pose = rest()
        pose["thorax"] = (-0.34 * t, 0.0, 0.0)
        pose["head"] = (0.24 * t, 0.0, 0.0)
        # Cupped: outer wing rotates hard forward against the airflow.
        sym(pose, "wing0", 0.30 * t, 0.0, 0.0)
        sym(pose, "wing1", 0.52 * t, 0.0, 0.0)
        sym(pose, "wing2", 0.86 * t, 0.0, 0.0)
        # DRAWN UP for the landing. Four and a half metres of chain
        # hanging straight down is four metres of chain underground the
        # moment the animal is on its feet.
        for k in range(3):
            swing(pose, k, 1.55 * t, trail=1.0)
        insect(pose, wing=0.60 * t, abd=0.34 * t, ant=-0.16 * t)
        tuck(pose, t)
        frames.append((frame, pose))
    bake("land", frames, 34)

    # ---- stoke: THE MELEE WINDOW. Grounded at a flare stack, wings
    # folded up into a tent over its own back, gut open to the fire and
    # visibly drinking it. Everything about this pose is an invitation:
    # the heart is at chest height and there is nothing over it.
    frames = []
    for frame, t in ((0, 0.0), (18, 1.0), (54, 1.0), (90, 0.92), (126, 1.0)):
        pose = rest()
        pose["thorax"] = (0.12 * t, 0.0, 0.0)
        pose["head"] = (-0.30 * t, 0.0, 0.0)
        # The fold: hinged up and back over the body, tips high.
        sym(pose, "wing0", 0.62 * t, 0.0, -0.30 * t)
        sym(pose, "wing1", -1.15 * t, 0.0, 0.0)
        sym(pose, "wing2", -1.35 * t, 0.0, 0.0)
        # The gut swells as it fills - a bone scale, which the exporter
        # already writes into the TRS, so a filling furnace costs
        # nothing extra.
        # Coiled against the belly for the whole stoke: each segment
        # folds further than the one above it, so the chain gathers
        # rather than swinging out as a bar. This is what keeps the
        # thuribles - the animal's identity - on screen during the one
        # phase the player is standing next to them.
        for k in range(3):
            swing(pose, k, 1.62 * t, trail=1.05)
        # The bellows: the gaster pumps while the furnace drinks, one
        # slow cycle per keyed station, out of phase with the heart's
        # own scale pulse below.
        bellow = math.sin((frame / 126.0) * TAU * 2.0)
        insect(pose, wing=-0.20 * t, lag=1.0, abd=0.30 * t + 0.16 * bellow * t,
               ant=0.18 * t)
        sym(pose, "hindwing", -0.85 * t, 0.0, 0.14 * t)
        tuck(pose, 1.0)
        frames.append((frame, pose))
    act = bake("stoke", frames, 126)
    # The heart itself pulses on its own slower clock while stoking.
    for frame, s in ((0, 1.0), (30, 1.16), (66, 1.04), (96, 1.20), (126, 1.10)):
        kit.key_scale(arm, frame, {"heart": s})
    kit.set_interpolation(act)

    # ---- launch: a hard downbeat that throws it back into the air.
    frames = []
    for frame, t in ((0, 1.0), (8, 1.0), (16, -0.85), (26, 0.2), (38, 0.0)):
        pose = rest()
        pose["thorax"] = (0.12 * max(0.0, t), 0.0, 0.0)
        pose["head"] = (-0.20 * max(0.0, t), 0.0, 0.0)
        # From the folded tent, straight into a full downstroke.
        sym(pose, "wing0", 0.62 * t, 0.0, -0.30 * max(0.0, t))
        sym(pose, "wing1", -1.15 * t if t > 0 else 0.55 * -t, 0.0, 0.0)
        sym(pose, "wing2", -1.35 * t if t > 0 else 0.75 * -t, 0.0, 0.0)
        for k in range(3):
            swing(pose, k, 1.62 * max(0.0, t) + 0.30 * max(0.0, -t), trail=1.05)
        insect(pose, wing=(-0.85 * t) if t > 0 else (0.55 * -t), lag=1.0,
               abd=0.30 * max(0.0, t) - 0.24 * max(0.0, -t),
               ant=0.18 * max(0.0, t) - 0.20 * max(0.0, -t))
        tuck(pose, max(0.0, t))
        frames.append((frame, pose))
    bake("launch", frames, 38)

    # ---- sweep: THE GROUNDED ATTACK, and it needed to be its own
    # clip. It was played on `flinch` - a forty-eight damage, seven
    # metre swing animated by the creature RECOILING from the player,
    # which is placeholder-grade on a boss and reads as the animal
    # being hurt by its own attack. One wing lashes forward and across
    # the sand while the body pivots into it; the other braces. The
    # contact frame is 14 of 40.
    frames = []
    for frame, t in ((0, 0.0), (8, -0.42), (14, 1.0), (22, 0.62), (40, 0.0)):
        pose = rest()
        pose["thorax"] = (0.10 * t, -0.26 * t, 0.14 * t)
        pose["head"] = (0.16 * t, -0.30 * t, 0.0)
        # The lashing wing sweeps DOWN and FORWARD; the bracing one
        # lifts and holds. Asymmetry is what makes it read as a strike
        # rather than as a flap.
        pose["wing0_L"] = (0.52 * t, 0.0, -0.44 * t)
        pose["wing1_L"] = (0.86 * t, 0.0, 0.0)
        pose["wing2_L"] = (1.05 * t, 0.0, 0.0)
        pose["wing0_R"] = (-0.30 * max(0.0, t), 0.0, 0.16 * max(0.0, t))
        pose["wing1_R"] = (-0.85 - 0.20 * max(0.0, t), 0.0, 0.0)
        pose["wing2_R"] = (-1.05 - 0.14 * max(0.0, t), 0.0, 0.0)
        # Stays coiled - it is still stoked, and a chain that unspools
        # mid-swing would put the thuribles back underground.
        for k in range(3):
            swing(pose, k, 1.62 - 0.22 * t, trail=1.05)
        insect(pose, wing=-0.70, lag=1.0, abd=0.30, ant=0.12,
               sway=-0.14 * t)
        pose["hindwing_L"] = (0.44 * t - 0.70, 0.0, -0.20 * t)
        tuck(pose, 1.0)
        frames.append((frame, pose))
    bake("sweep", frames, 40)

    # ---- sprawl: THE KNOCKOUT. Played for the crash-stun grace after
    # a stall - "strain" was reused here for one build, and strain is
    # an AIRBORNE clip: its chains hang straight down, which on the
    # ground put every thurible two metres under the sand for the
    # whole window. A crashed censer LIES on the ground - the chains
    # are thrown forward and the bowls rest in front of the animal -
    # and everything else about the pose says the lights went out:
    # wings dropped flat and asymmetric, gaster flat, antennae in the
    # dust, limbs half-folded under it where it fell.
    frames = []
    for frame, t in ((0, 0.0), (6, 1.0), (60, 1.0), (96, 0.94), (120, 1.0)):
        pose = rest()
        pose["thorax"] = (0.20 * t, 0.05 * t, 0.10 * t)
        pose["head"] = (0.34 * t, 0.12 * t, 0.0)
        pose["wing0_L"] = (0.55 * t, 0.0, -0.34 * t)
        pose["wing0_R"] = (0.40 * t, 0.0, 0.30 * t)
        pose["wing1_L"] = (0.30 * t, 0.0, 0.0)
        pose["wing1_R"] = (0.52 * t, 0.0, 0.0)
        pose["wing2_L"] = (0.38 * t, 0.0, 0.0)
        pose["wing2_R"] = (0.60 * t, 0.0, 0.0)
        for k in range(3):
            # Thrown FORWARD, hard - past horizontal, so the bowls sit
            # on the sand ahead of the animal rather than under it.
            swing(pose, k, 1.85 * t, trail=0.92, z=0.16 * t * (1 if k % 2 else -1))
        insect(pose, wing=0.45 * t, lag=0.85, abd=0.30 * t, abd2=0.10 * t,
               ant=0.55 * t, sway=0.10 * t)
        pose["hindwing_R"] = (0.30 * t - 0.05, 0.0, -0.09)
        tuck(pose, 0.55 * t)
        frames.append((frame, pose))
    bake("sprawl", frames, 120)

    # ---- flinch -------------------------------------------------------
    frames = []
    for frame, t in ((0, 0.0), (4, 1.0), (12, 0.35), (20, 0.0)):
        pose = rest()
        pose["thorax"] = (-0.10 * t, 0.08 * t, 0.06 * t)
        pose["head"] = (-0.20 * t, 0.10 * t, 0.0)
        pose["wing0_L"] = (-0.16 * t, 0.0, 0.0)
        pose["wing0_R"] = (-0.09 * t, 0.0, 0.0)
        for k in range(3):
            swing(pose, k, 0.20 * t)
        insect(pose, wing=-0.10 * t, abd=-0.14 * t, ant=0.20 * t)
        tuck(pose, 0.0)
        frames.append((frame, pose))
    bake("flinch", frames, 20)

    # ---- death: the wings STOP. It does not fold - it goes slack and
    # the whole span collapses backward, which is what a thing that was
    # being carried looks like when the thing carrying it lets go.
    frames = []
    for frame, t in ((0, 0.0), (10, 0.34), (28, 0.78), (52, 1.0), (76, 1.0)):
        pose = rest()
        pose["thorax"] = (0.46 * t, 0.16 * t, 0.14 * t)
        pose["head"] = (0.62 * t, 0.20 * t, 0.0)
        pose["wing0_L"] = (0.70 * t, 0.0, -0.30 * t)
        pose["wing0_R"] = (0.52 * t, 0.0, 0.22 * t)
        pose["wing1_L"] = (0.86 * t, 0.0, 0.0)
        pose["wing1_R"] = (0.64 * t, 0.0, 0.0)
        pose["wing2_L"] = (1.05 * t, 0.0, 0.0)
        pose["wing2_R"] = (0.80 * t, 0.0, 0.0)
        for k in range(3):
            swing(pose, k, 0.55 * t, trail=0.8, y=0.20 * t * (1 if k % 2 else -1))
        insect(pose, wing=0.55 * t, lag=0.8, abd=0.65 * t, abd2=1.35 * t,
               ant=0.65 * t, sway=0.12 * t)
        pose["hindwing_R"] = (0.38 * t - 0.05, 0.0, -0.09)
        tuck(pose, 0.30 * t)
        frames.append((frame, pose))
    act = bake("death", frames, 76)
    # The furnace goes out.
    for frame, s in ((0, 1.0), (22, 0.86), (52, 0.46), (76, 0.34)):
        kit.key_scale(arm, frame, {"heart": s})
    kit.set_interpolation(act)

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
    material = kit.vertex_colour_material("winnower-char")
    mesh_obj = kit.build_mesh_object("winnower", parts, material)
    arm = kit.build_armature("winnower-rig", build_bone_table())
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
