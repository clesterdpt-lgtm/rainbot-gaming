"""Shared geometry vocabulary for SAINTFALL's Blender-authored enemies.

This is a deliberate port of `assets/js/saintfall/structures.js` into
Python. Vesper-IX is built almost entirely from stacks of polygonal
rings stitched into solids, and the enemies have to be built from the
same primitives or they will read as imported models standing in a
procedural world.

Two rules carried over verbatim from the JS kit:

  1. RINGS. Almost everything is a stack of cross-sections. One
     well-tested builder beats twenty bespoke ones, and a silhouette
     can then be tuned by editing numbers rather than geometry code.

  2. ODD SIDE COUNTS. Six and eight read as machined; five, seven and
     nine read as grown or carved. Chitin uses odd counts with
     per-ring phase drift so no two rings line their edges up.

Colours are written as LINEAR floats into a POINT-domain FLOAT_COLOR
attribute, because that is what glTF COLOR_0 carries and what three
reads back. The palette tables here mirror `art.js` exactly; a colour
authored in sRGB and exported without conversion arrives roughly twice
as bright and considerably more chromatic than intended.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

import bpy
from mathutils import Matrix, Vector

TAU = math.pi * 2


# ----------------------------------------------------------------------
# colour
# ----------------------------------------------------------------------

def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(value: str) -> tuple[float, float, float]:
    v = value.lstrip("#")
    r = int(v[0:2], 16) / 255.0
    g = int(v[2:4], 16) / 255.0
    b = int(v[4:6], 16) / 255.0
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))


class Ramp:
    """Colour ramp interpolated in sRGB, converted to linear on read.

    Mirrors `makeRamp` in core.js. Interpolating in sRGB is
    deliberate: it is where the palette was designed and where the
    midpoints look right.
    """

    def __init__(self, stops: list[tuple[float, str]]):
        self.stops = sorted(
            ((t, tuple(int(c.lstrip("#")[i:i + 2], 16) / 255.0 for i in (0, 2, 4)))
             for t, c in stops),
            key=lambda s: s[0],
        )

    def at(self, t: float) -> tuple[float, float, float]:
        t = max(0.0, min(1.0, t))
        if t <= self.stops[0][0]:
            srgb = self.stops[0][1]
        elif t >= self.stops[-1][0]:
            srgb = self.stops[-1][1]
        else:
            srgb = self.stops[-1][1]
            for (t0, c0), (t1, c1) in zip(self.stops, self.stops[1:]):
                if t0 <= t <= t1:
                    k = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
                    srgb = tuple(a + (b - a) * k for a, b in zip(c0, c1))
                    break
        return tuple(srgb_to_linear(c) for c in srgb)


# Mirrors of the ramps in art.js. Kept in sync by hand; if the level's
# palette moves, these move with it or the enemies stop belonging to
# the world they stand in.
CHITIN_RAMP = Ramp([
    (0.00, "#1d1326"), (0.34, "#2a1c33"), (0.62, "#43304f"),
    (0.85, "#7a5a90"), (1.00, "#b18ec6"),
])

# --------------------------------------------------------------------
# CHITIN_CREATURE: the same hue family, lifted through the middle.
#
# Scenery and creatures have different jobs and therefore need
# different value ranges even inside one palette. The district's
# spires are context - they can sit dark and let the sky carry the
# frame. A creature is a READ TARGET: the player has to find it at
# eighty metres and then follow what it is doing at eight.
#
# Measured, not asserted. Painted from CHITIN_RAMP the Thresher came
# out at mean luma 47.5 against ground at 73.5 - it separated fine,
# because violet on orange sand separates by HUE, but its own range
# was 35-153 with almost everything bunched at the bottom. That is a
# silhouette with no internal modelling. The lift here is aimed at
# the middle and the top; the deepest undercuts stay where they were,
# because a creature with no black left in it stops reading as chitin.
# --------------------------------------------------------------------
CHITIN_CREATURE = Ramp([
    (0.00, "#241a30"), (0.26, "#3f2c55"), (0.52, "#6a4a86"),
    (0.76, "#a181bd"), (1.00, "#ded0ea"),
])

# --------------------------------------------------------------------
# One brood, three castes. All three species come out of the same hive
# and must read as relatives - so they share ONE hue family and differ
# by VALUE, which is the axis a player reads first and at the greatest
# range. A second hue per species would have made three unrelated
# monsters standing in the same desert.
#
#   PALE  - the Gleaner. It stands three metres up in open ground with
#           the sky behind it, so it is painted light: a dark creature
#           silhouetted on a cream sky is a hole, and a hole has no
#           anatomy. Bleached, sun-bitten, nearly bone at the ridges.
#
#   DEEP  - the Harrow. Almost black, because its whole job is to be a
#           mass. Its detail is carried by the seams, not the plates.
# --------------------------------------------------------------------
CHITIN_PALE = Ramp([
    (0.00, "#3a3040"), (0.24, "#6b5c74"), (0.50, "#9c8ca4"),
    (0.76, "#c9bdcb"), (1.00, "#f2ecf2"),
])

# --------------------------------------------------------------------
# ASH: the Gleaner, after the pale version was measured and rejected.
#
# The reasoning for painting it light was that it stands three metres
# up with the sky behind it, and a dark shape on a bright sky is a
# hole. That reasoning is sound and the ground it ignores is the
# problem: Vesper-IX is an orange desert under a warm sun, so from any
# camera at head height the creature is standing in front of SAND, not
# sky, for almost every metre of the map. Painted pale it measured a
# colour distance of 42 against that sand - below the harness's gate
# and, in the frame, a beige animal on a beige dune.
#
# Cool and DARK instead, and the second half of that was measured
# rather than chosen. A mid-value cool ramp still rendered warm under
# this sun - the harness put the creature at rgb [92,64,49] against
# sand at [124,75,47], a colour distance of 54 - because a warm key
# light warms everything it lands on, and value is the one axis it
# cannot drag toward the ground.
#
# Lifting the plates to catch more sun made it WORSE, from 57 to 54,
# which is the whole lesson: on warm ground, separation comes from
# being darker and bluer, not from being brighter.
#
# The original worry - that a dark shape on a bright sky is a hole
# with no anatomy in it - is answered by the lantern and the lit tail
# joints rather than by raising the chitin. That is also the better
# answer, because a lit organ inside a dark body is legible at a range
# where surface modelling has stopped existing.
# --------------------------------------------------------------------
CHITIN_ASH = Ramp([
    (0.00, "#100e1c"), (0.28, "#221f3a"), (0.55, "#3b3560"),
    (0.80, "#645b91"), (1.00, "#9b91c4"),
])

CHITIN_DEEP = Ramp([
    (0.00, "#0d0a12"), (0.28, "#1b1524"), (0.55, "#2f2340"),
    (0.80, "#54406e"), (1.00, "#8f74ab"),
])

BONE_RAMP = Ramp([
    (0.00, "#7f7a70"), (0.34, "#a8a394"), (0.62, "#cdc8b4"),
    (0.84, "#e8e4d2"), (1.00, "#faf7ea"),
])

IRON_RAMP = Ramp([
    (0.00, "#141719"), (0.26, "#292f36"), (0.55, "#454f59"),
    (0.80, "#6d5443"), (1.00, "#a87a4c"),
])

GOLD_RAMP = Ramp([
    (0.00, "#5c4a22"), (0.45, "#8a601f"), (0.78, "#d8a441"), (1.00, "#f6d585"),
])

BIO_VIOLET = "#b568f5"
BIO_CYAN = "#54efd2"
# The lantern end of the same signal: what a gland looks like when it
# is actually lit rather than merely coloured.
BIO_PALE = "#a9ffe8"
# Cooled bioluminescence, for membrane and seam that should read as lit
# without competing with an eye.
BIO_DIM = "#1f7d6c"

BIO_RAMP = Ramp([
    (0.00, "#0b3a34"), (0.35, "#1f7d6c"), (0.70, "#54efd2"), (1.00, "#d6fff4"),
])


# --------------------------------------------------------------------
# EMISSIVE MASK
#
# COLOR_0's fourth channel is not opacity here - it is how much of the
# vertex's own colour the runtime adds back as emission. Nothing in
# SAINTFALL is transparent, so the channel was free, and using it costs
# no second material and therefore no second draw call per instance:
# an enemy stays one skinned mesh whether or not its eyes are lit.
#
# `patchMaterial(..., { bio })` in art.js reads it. Default 0.
# --------------------------------------------------------------------
#
# The levels are a HIERARCHY, and it only reads as one if the steps
# are big. A first pass set seam glow at 0.55 against an eye at 1.0;
# on screen the seams and the eyes were the same brightness, the
# creature read as a lamp with legs, and the eyes - the thing the
# player is supposed to look at - lost the fight to eight inches of
# membrane. Everything below an eye is now deliberately far below it.
GLOW_EYE = 1.0           # compound eyes, ocelli, a firing nozzle
GLOW_GLAND = 0.80        # the Gleaner's lantern
GLOW_SEAM = 0.30         # intersegmental membrane, joint sleeves
GLOW_FAINT = 0.13        # spiracles and vents, present but not shouting


# ----------------------------------------------------------------------
# geometry
# ----------------------------------------------------------------------

@dataclass
class Ring:
    """One cross-section of a ring solid.

    `y` is along the part's own axis. `rx`/`rz` allow an ellipse;
    `phase` rotates the ring so consecutive rings do not line their
    edges up, which is what stops a stack of rings from looking like a
    stack of rings.
    """
    y: float
    r: float = 1.0
    rx: float | None = None
    rz: float | None = None
    sides: int = 7
    phase: float = 0.0
    cx: float = 0.0
    cz: float = 0.0
    jitter: float = 0.0
    seed: int = 1


@dataclass
class Part:
    """A named chunk of geometry bound rigidly to one bone.

    Rigid binding - every vertex weighted 1.0 to a single bone - is
    the correct choice here and not a shortcut. Chitin plates and iron
    castings are hard segments that rotate about their joints; smooth
    skinning across a joint would make an armoured leg bend like a
    hosepipe.
    """
    name: str
    bone: str
    verts: list[Vector] = field(default_factory=list)
    faces: list[tuple[int, ...]] = field(default_factory=list)
    # RGBA, where A is the emissive mask - see the GLOW_* table.
    colors: list[tuple[float, float, float, float]] = field(default_factory=list)


def ring_solid(rings: list[Ring], cap_top: bool = True, cap_bottom: bool = True):
    """Stitch consecutive rings into a closed solid.

    Ring side counts may differ between entries - the stitcher walks
    whichever is larger and duplicates indices - so a shape can lose
    detail as it tapers without opening a seam.
    """
    verts: list[Vector] = []
    faces: list[tuple[int, ...]] = []
    starts: list[int] = []
    counts: list[int] = []

    for idx, ring in enumerate(rings):
        sides = max(3, ring.sides)
        rx = ring.rx if ring.rx is not None else ring.r
        rz = ring.rz if ring.rz is not None else ring.r
        rng = random.Random(ring.seed or (idx * 7919 + 13))
        starts.append(len(verts))
        counts.append(sides)
        for s in range(sides):
            a = (s / sides) * TAU + ring.phase
            k = 1.0 + (rng.uniform(-ring.jitter, ring.jitter) if ring.jitter else 0.0)
            verts.append(Vector((
                ring.cx + math.cos(a) * rx * k,
                ring.y,
                ring.cz + math.sin(a) * rz * k,
            )))

    for r in range(len(rings) - 1):
        s0, s1 = starts[r], starts[r + 1]
        c0, c1 = counts[r], counts[r + 1]
        steps = max(c0, c1)
        for s in range(steps):
            a0 = s0 + (steps and int(s * c0 / steps) % c0)
            a1 = s0 + int((s + 1) * c0 / steps) % c0
            b0 = s1 + int(s * c1 / steps) % c1
            b1 = s1 + int((s + 1) * c1 / steps) % c1
            if a0 != a1 and b0 != b1:
                faces.append((a0, b0, b1, a1))
            elif a0 != a1:
                faces.append((a0, b0, a1))
            elif b0 != b1:
                faces.append((a0, b0, b1))

    if cap_bottom and counts[0] >= 3:
        c = len(verts)
        verts.append(Vector((rings[0].cx, rings[0].y, rings[0].cz)))
        for s in range(counts[0]):
            faces.append((c, starts[0] + ((s + 1) % counts[0]), starts[0] + s))
    if cap_top and counts[-1] >= 3:
        last = len(rings) - 1
        c = len(verts)
        verts.append(Vector((rings[last].cx, rings[last].y, rings[last].cz)))
        for s in range(counts[last]):
            faces.append((c, starts[last] + s, starts[last] + ((s + 1) % counts[last])))

    return verts, faces


def prism(h=1.0, r_bottom=0.5, r_top=0.5, sides=6, twist=0.0, segments=1,
          jitter=0.0, seed=1, bulge=0.0):
    rings = []
    for i in range(segments + 1):
        t = i / segments
        r = (r_bottom + (r_top - r_bottom) * t) * (1 + math.sin(t * math.pi) * bulge)
        rings.append(Ring(y=t * h, r=r, sides=sides, phase=twist * t,
                          jitter=jitter, seed=seed + i * 31))
    return ring_solid(rings)


def wedge(length, width, height, taper=0.25):
    """A tapered blade. Mandibles, claws, armour plates."""
    hw, hh = width * 0.5, height * 0.5
    tw, th = hw * taper, hh * taper
    verts = [
        Vector((-hw, 0.0, -hh)), Vector((hw, 0.0, -hh)),
        Vector((hw, 0.0, hh)), Vector((-hw, 0.0, hh)),
        Vector((-tw, length, -th)), Vector((tw, length, -th)),
        Vector((tw, length, th)), Vector((-tw, length, th)),
    ]
    faces = [
        (0, 1, 2, 3), (7, 6, 5, 4),
        (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0),
    ]
    return verts, faces


# ----------------------------------------------------------------------
# SWEEPS
#
# `ring_solid` builds anything whose cross-sections stack along a
# straight axis, which covered the first pass of the bestiary and is
# exactly why that pass came out looking like sticks glued to lumps.
# An arthropod is not axis-aligned anywhere: a femur bends, a mandible
# is a sickle, an antenna droops, a tergite wraps. All of those are one
# operation - sweep a cross-section along a CURVE - so it is worth
# having properly rather than approximating with more straight prisms.
# ----------------------------------------------------------------------

def bezier(p0, p1, p2, p3, n=8) -> list[Vector]:
    """Cubic Bezier as a polyline of n+1 points."""
    p0, p1, p2, p3 = (Vector(p) for p in (p0, p1, p2, p3))
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1.0 - t
        out.append(p0 * (u ** 3) + p1 * (3 * u * u * t)
                   + p2 * (3 * u * t * t) + p3 * (t ** 3))
    return out


def arc_path(a, b, bend, n=6) -> list[Vector]:
    """A gentle arc from a to b, bowed by `bend` (a world vector).

    The everyday case - a limb segment that is not quite straight -
    without having to invent two control points by hand.
    """
    a, b = Vector(a), Vector(b)
    mid = (a + b) * 0.5 + Vector(bend)
    return bezier(a, a.lerp(mid, 0.72), b.lerp(mid, 0.72), b, n)


def _frames(points, up=(0.0, 1.0, 0.0), mode="up"):
    """A normal/binormal frame per path point.

    Two modes, and choosing wrong is visible:

    `up`       - the reference axis is projected out of the tangent at
                 every point. Predictable and body-aligned, so a plate
                 swept along a back keeps its crest on top. Degenerates
                 where the tangent is parallel to `up`.

    `transport` - a rotation-minimising frame, carried forward from the
                 first point. Never degenerates, so it is what a leg
                 that swings from horizontal to vertical needs, at the
                 cost of the reference direction drifting.
    """
    n = len(points)
    tangents = []
    for i in range(n):
        if i == 0:
            t = points[1] - points[0]
        elif i == n - 1:
            t = points[-1] - points[-2]
        else:
            t = points[i + 1] - points[i - 1]
        if t.length < 1e-9:
            t = Vector((0.0, 1.0, 0.0))
        tangents.append(t.normalized())

    upv = Vector(up).normalized()
    frames = []
    if mode == "up":
        for t in tangents:
            nrm = upv - t * upv.dot(t)
            if nrm.length < 1e-6:
                alt = Vector((1.0, 0.0, 0.0))
                nrm = alt - t * alt.dot(t)
            nrm.normalize()
            frames.append((nrm, t.cross(nrm).normalized()))
        return tangents, frames

    nrm = upv - tangents[0] * upv.dot(tangents[0])
    if nrm.length < 1e-6:
        alt = Vector((1.0, 0.0, 0.0))
        nrm = alt - tangents[0] * alt.dot(tangents[0])
    nrm.normalize()
    frames.append((nrm.copy(), tangents[0].cross(nrm).normalized()))
    for i in range(1, n):
        t0, t1 = tangents[i - 1], tangents[i]
        axis = t0.cross(t1)
        if axis.length > 1e-8:
            angle = math.atan2(axis.length, max(-1.0, min(1.0, t0.dot(t1))))
            nrm = nrm @ Matrix.Rotation(-angle, 3, axis.normalized())
        nrm = (nrm - t1 * nrm.dot(t1))
        if nrm.length < 1e-8:
            nrm = Vector((1.0, 0.0, 0.0))
        nrm.normalize()
        frames.append((nrm.copy(), t1.cross(nrm).normalized()))
    return tangents, frames


def _radii_pairs(radii, n):
    """Accept a scalar, a list of scalars, or a list of (rx, rz)."""
    if isinstance(radii, (int, float)):
        return [(float(radii), float(radii))] * n
    out = []
    for i in range(n):
        r = radii[min(i, len(radii) - 1)]
        if isinstance(r, (int, float)):
            out.append((float(r), float(r)))
        else:
            out.append((float(r[0]), float(r[1])))
    return out


def tube(points, radii, sides=6, phase=0.0, up=(0.0, 1.0, 0.0),
         mode="transport", profile=None, cap_start=True, cap_end=True,
         jitter=0.0, seed=1):
    """Sweep a polygonal ring along a polyline.

    Returns (verts, faces, params), where params[i] is the (t, a) of
    that vertex - fraction along the sweep, fraction around the ring -
    so `paint_t` can shade the result by its own form.

    `profile(t, a) -> float` scales the radius per vertex, which is
    how a limb gets flutes, ridges and annulations without a second
    piece of geometry.
    """
    pts = [Vector(p) for p in points]
    n = len(pts)
    _tangents, frames = _frames(pts, up=up, mode=mode)
    rr = _radii_pairs(radii, n)
    rng = random.Random(seed)

    verts: list[Vector] = []
    params: list[tuple[float, float, float]] = []
    for i in range(n):
        t = i / max(1, n - 1)
        nrm, binrm = frames[i]
        rx, rz = rr[i]
        for s in range(sides):
            a = s / sides
            ang = a * TAU + phase
            k = profile(t, a) if profile else 1.0
            if jitter:
                k *= 1.0 + rng.uniform(-jitter, jitter)
            radial = nrm * math.cos(ang) + binrm * math.sin(ang)
            verts.append(pts[i] + nrm * (math.cos(ang) * rx * k)
                         + binrm * (math.sin(ang) * rz * k))
            params.append((t, a, radial.y))

    faces: list[tuple[int, ...]] = []
    for i in range(n - 1):
        a0, b0 = i * sides, (i + 1) * sides
        for s in range(sides):
            s1 = (s + 1) % sides
            faces.append((a0 + s, b0 + s, b0 + s1, a0 + s1))

    if cap_start:
        c = len(verts)
        verts.append(pts[0].copy())
        params.append((0.0, 0.5, 0.0))
        for s in range(sides):
            faces.append((c, (s + 1) % sides, s))
    if cap_end:
        c = len(verts)
        base = (n - 1) * sides
        verts.append(pts[-1].copy())
        params.append((1.0, 0.5, 0.0))
        for s in range(sides):
            faces.append((c, base + s, base + (s + 1) % sides))

    return verts, faces, params


def shell(points, radii, arc=(-0.34, 0.34), steps=5, thick=0.03,
          up=(0.0, 1.0, 0.0), mode="up", lift=0.0, profile=None):
    """Sweep an angular SECTOR along a path, with thickness.

    A closed plate that wraps a body: tergites, elytra, a pronotal
    collar, the Harrow's armour. The difference between this and a
    tube is the whole difference between "a segmented body" and "an
    armoured one" - a plate has an EDGE, and the shadow line under
    that edge is what the eye reads as armour.

    `arc` is in turns, measured from the frame's reference axis, so
    (-0.25, 0.25) is exactly the upper half.
    """
    pts = [Vector(p) for p in points]
    n = len(pts)
    _tangents, frames = _frames(pts, up=up, mode=mode)
    rr = _radii_pairs(radii, n)

    verts: list[Vector] = []
    params: list[tuple[float, float, float]] = []
    a0, a1 = arc
    for shellside, off in ((0, lift + thick), (1, lift)):
        # The inner surface is handed the OPPOSITE facing to the outer
        # one, because it genuinely faces the other way.
        #
        # It was handed the outer facing at first, on the grounds that
        # a plate lying flush on a body has an underside nobody can
        # see. True - until a plate MOVES. The Harrow's wing cases
        # hinge open in its alert pose, and with the outer facing on
        # both surfaces the newly-revealed undersides were painted as
        # if they were catching the sun: a black armoured animal
        # cracked open and flashed two pale pink panels.
        facing = 1.0 if shellside == 0 else -1.0
        for i in range(n):
            t = i / max(1, n - 1)
            nrm, binrm = frames[i]
            rx, rz = rr[i]
            for s in range(steps + 1):
                u = s / steps
                a = a0 + (a1 - a0) * u
                ang = a * TAU
                k = profile(t, u) if profile else 1.0
                radial = nrm * math.cos(ang) + binrm * math.sin(ang)
                verts.append(pts[i]
                             + nrm * (math.cos(ang) * (rx * k + off))
                             + binrm * (math.sin(ang) * (rz * k + off)))
                params.append((t, u, radial.y * facing))

    per = n * (steps + 1)
    faces: list[tuple[int, ...]] = []

    def idx(layer, i, s):
        return layer * per + i * (steps + 1) + s

    for i in range(n - 1):
        for s in range(steps):
            faces.append((idx(0, i, s), idx(0, i + 1, s),
                          idx(0, i + 1, s + 1), idx(0, i, s + 1)))
            faces.append((idx(1, i, s + 1), idx(1, i + 1, s + 1),
                          idx(1, i + 1, s), idx(1, i, s)))
    # long edges
    for i in range(n - 1):
        faces.append((idx(1, i, 0), idx(1, i + 1, 0),
                      idx(0, i + 1, 0), idx(0, i, 0)))
        faces.append((idx(0, i, steps), idx(0, i + 1, steps),
                      idx(1, i + 1, steps), idx(1, i, steps)))
    # end caps
    for s in range(steps):
        faces.append((idx(0, 0, s + 1), idx(0, 0, s), idx(1, 0, s), idx(1, 0, s + 1)))
        faces.append((idx(1, n - 1, s + 1), idx(1, n - 1, s),
                      idx(0, n - 1, s), idx(0, n - 1, s + 1)))

    return verts, faces, params


def dome(rx, ry, rz=None, rings=3, sides=9, phase=0.0, cut=1.0):
    """A faceted half-ellipsoid, open at the bottom and capped flat.

    Compound eyes, ocelli, spiracle covers, the caps of a gaster.
    `cut` < 1 keeps it a shallow lens rather than a hemisphere.
    """
    rz = rx if rz is None else rz
    stack = []
    for i in range(rings + 1):
        t = (i / rings) * cut
        ang = t * (math.pi * 0.5)
        # Floored, so a full hemisphere's apex ring is a small facet
        # rather than `sides` coincident vertices. Blender's validate()
        # would strip the degenerate quads anyway, but it strips them
        # AFTER the colour attribute has been sized against them.
        k = max(0.06, math.cos(ang))
        stack.append(Ring(y=math.sin(ang) * ry,
                          rx=k * rx, rz=k * rz, r=k * rx,
                          sides=sides, phase=phase + t * 0.35))
    return ring_solid(stack)


def blob(r, sides=7, rings=3, squash=1.0, seed=1, jitter=0.06):
    """A faceted ball. Joints, glands, ganglia, knuckles.

    Every articulated limb in this bestiary gets one at each pivot,
    because the thing that makes a leg read as JOINTED rather than as
    a bent stick is a bulge at the bend catching its own highlight.
    """
    stack = []
    for i in range(rings * 2 + 1):
        t = i / (rings * 2)
        ang = (t - 0.5) * math.pi
        stack.append(Ring(y=math.sin(ang) * r * squash,
                          r=math.cos(ang) * r,
                          sides=max(3, sides - (2 if t in (0.0, 1.0) else 0)),
                          phase=t * 1.9, jitter=jitter, seed=seed + i * 17))
    return ring_solid(stack)


def aim(verts, a, b, roll=0.0):
    """Place a +Y-authored primitive with its base at `a`, tip at `b`.

    Hoisted out of the first Thresher, where it lived as a closure and
    was therefore unavailable to every other part that needed it.
    """
    a, b = Vector(a), Vector(b)
    d = b - a
    if d.length < 1e-9:
        return [Vector(v) + a for v in verts]
    d.normalize()
    pitch = math.asin(max(-1.0, min(1.0, -d.z)))
    yaw = math.atan2(d.x, d.y)
    out = transform(verts, rotate=(0.0, roll, 0.0))
    out = transform(out, rotate=(pitch, 0.0, 0.0))
    out = transform(out, rotate=(0.0, 0.0, -yaw))
    return transform(out, translate=tuple(a))


def flutes(count: int, depth: float, phase: float = 0.0):
    """Radial ribbing, as a `profile` for tube/shell."""
    return lambda t, a: 1.0 + math.cos(a * TAU * count + phase) * depth


def annulate(count: int, depth: float, taper=None):
    """Segment pinches along a sweep, the ringed look of an abdomen."""
    def fn(t, a):
        k = 1.0 + math.sin(t * math.pi * 2.0 * count) * depth
        return k * (taper(t) if taper else 1.0)
    return fn


def combine(*profiles):
    def fn(t, a):
        k = 1.0
        for p in profiles:
            k *= p(t, a)
        return k
    return fn


def transform(verts, translate=(0, 0, 0), rotate=(0, 0, 0), scale=(1, 1, 1)):
    m = Matrix.LocRotScale(
        Vector(translate),
        Matrix.Rotation(rotate[0], 3, "X")
        @ Matrix.Rotation(rotate[1], 3, "Y")
        @ Matrix.Rotation(rotate[2], 3, "Z"),
        Vector(scale),
    )
    return [m @ v for v in verts]


def paint(verts, ramp: Ramp, fn, glow=0.0):
    """Per-vertex colour from a scalar function of the local position.

    The same technique the world uses: geometry with one flat colour
    per material reads as a prototype, so every builder in this
    project paints its vertices and the shape carries tonal variation
    before any light lands on it.

    Returns RGBA, where A is the EMISSIVE MASK rather than opacity -
    see the GLOW_* table above. `glow` may be a constant or a function
    of the vertex, which is what lets a seam fade out along its length
    instead of stopping dead.
    """
    gfn = glow if callable(glow) else (lambda _p: glow)
    out = []
    for v in verts:
        c = ramp.at(max(0.0, min(1.0, fn(v))))
        out.append((c[0], c[1], c[2], max(0.0, min(1.0, gfn(v)))))
    return out


def flat(verts, hex_colour: str, glow=0.0):
    c = hex_to_linear(hex_colour)
    gfn = glow if callable(glow) else (lambda _p: glow)
    return [(c[0], c[1], c[2], max(0.0, min(1.0, gfn(v)))) for v in verts]


def paint_t(params, ramp: Ramp, fn, glow=0.0):
    """Colour a swept part by its own sweep parameters instead of by
    position.

    `tube` and `shell` hand back (t, a, up) per vertex: distance along
    the sweep, angle around it, and how much that facet faces the sky.
    Painting a curved leg by world height alone puts the light band
    wherever the leg happens to be pointing; `up` puts it on the
    surface that would actually catch the sun, which is what models
    the form rather than merely tinting it.
    """
    gfn = glow if callable(glow) else (lambda _t, _a, _u: glow)
    out = []
    for (t, a, u) in params:
        c = ramp.at(max(0.0, min(1.0, fn(t, a, u))))
        out.append((c[0], c[1], c[2], max(0.0, min(1.0, gfn(t, a, u)))))
    return out


def topside(up: float, power: float = 1.0) -> float:
    """Remap a sweep's `up` term (-1..1) onto 0..1.

    The single most useful shading term on a swept limb: how much sky
    does this facet see, measured off the geometry rather than
    guessed from the part's position in the world.
    """
    return (0.5 + 0.5 * up) ** power


# ----------------------------------------------------------------------
# axis convention
# ----------------------------------------------------------------------

def to_zup(v: Vector) -> Vector:
    """Y-up (the JS kit's space, and glTF's) -> Z-up (Blender's).

    Everything in this file is authored Y-up so it stays a faithful
    port of structures.js and so a part and the world it will stand in
    are described by the same numbers. Blender is Z-up, and its glTF
    exporter converts Z-up back to Y-up on the way out - so this is
    applied ONCE at assembly and the round trip is the identity.

    Get this wrong in either direction and the enemy is exported lying
    on its side, which looks like a rig fault and is not one.
    """
    return Vector((v.x, -v.z, v.y))


# ----------------------------------------------------------------------
# blender assembly
# ----------------------------------------------------------------------

def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.actions, bpy.data.armatures, bpy.data.meshes,
                       bpy.data.materials, bpy.data.objects, bpy.data.cameras,
                       bpy.data.lights):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def build_mesh_object(name: str, parts: list[Part], material: bpy.types.Material):
    """Merge every part into one mesh, keeping a vertex group per bone.

    One mesh, one material, one draw call. The level merges per
    district per material for the same reason; an enemy that arrives
    as fourteen separate objects costs fourteen draw calls per
    instance and there will be dozens of instances.
    """
    verts: list[Vector] = []
    faces: list[tuple[int, ...]] = []
    colors: list[tuple[float, float, float]] = []
    groups: dict[str, list[int]] = {}

    for part in parts:
        base = len(verts)
        verts.extend(to_zup(v) for v in part.verts)
        colors.extend(part.colors)
        faces.extend(tuple(i + base for i in f) for f in part.faces)
        groups.setdefault(part.bone, []).extend(range(base, len(verts)))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.validate(verbose=False)
    mesh.update()

    # Flat shading throughout, to match the world. Everything in
    # SAINTFALL above the sand is faceted; a smooth-shaded enemy reads
    # as belonging to a different game.
    for poly in mesh.polygons:
        poly.use_smooth = False

    attr = mesh.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, c in enumerate(colors):
        # Fourth channel is the EMISSIVE MASK, not opacity. Painters
        # that predate the convention hand back a 3-tuple; those get 0
        # and stay unlit, which is the right default for chitin.
        glow = c[3] if len(c) > 3 else 0.0
        attr.data[i].color = (c[0], c[1], c[2], glow)

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)

    for bone, indices in groups.items():
        vg = obj.vertex_groups.new(name=bone)
        vg.add(indices, 1.0, "REPLACE")

    return obj


def vertex_colour_material(name: str) -> bpy.types.Material:
    """A material whose base colour is the vertex colour attribute.

    The runtime does not use this - three gets `vertexColors: true` and
    the level's own patched MeshStandardMaterial. It exists so the
    exporter records COLOR_0 and so Blender previews show the real
    thing rather than grey clay.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    attr = nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def build_armature(name: str, bones: list[dict]):
    """Create an armature from a flat bone table.

    Each entry: {name, head, tail, parent, connect}. Positions are in
    the same space as the mesh, so a part and the bone it binds to are
    authored against the same numbers.
    """
    arm_data = bpy.data.armatures.new(f"{name}-arm")
    arm = bpy.data.objects.new(name, arm_data)
    bpy.context.scene.collection.objects.link(arm)

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    created: dict[str, bpy.types.EditBone] = {}
    for spec in bones:
        eb = arm_data.edit_bones.new(spec["name"])
        # Bone positions are authored in the same Y-up space as the
        # parts they bind, and converted here by the same function.
        eb.head = to_zup(Vector(spec["head"]))
        eb.tail = to_zup(Vector(spec["tail"]))
        eb.roll = spec.get("roll", 0.0)
        created[spec["name"]] = eb
    for spec in bones:
        parent = spec.get("parent")
        if parent:
            created[spec["name"]].parent = created[parent]
            created[spec["name"]].use_connect = bool(spec.get("connect", False))
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def bind(mesh_obj, arm_obj) -> None:
    mesh_obj.parent = arm_obj
    mod = mesh_obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj
    mod.use_vertex_groups = True


# ----------------------------------------------------------------------
# animation
# ----------------------------------------------------------------------

def new_action(arm_obj, name: str):
    """Start a fresh action on the armature and make it current.

    Blender 4.4 introduced slotted actions, and assigning
    `animation_data.action` alone leaves the action unbound with no
    slot - keyframes then go nowhere and the exported clip is empty.
    The guard below is not defensive padding; without it this script
    silently produces animations with zero tracks on 4.4+.
    """
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    if arm_obj.animation_data is None:
        arm_obj.animation_data_create()
    arm_obj.animation_data.action = act
    slot_attr = getattr(arm_obj.animation_data, "action_slot", "__missing__")
    if slot_attr != "__missing__":
        if arm_obj.animation_data.action_slot is None:
            slot = act.slots.new(id_type="OBJECT", name=arm_obj.name) \
                if not act.slots else act.slots[0]
            arm_obj.animation_data.action_slot = slot
    return act


def key_pose(arm_obj, frame: int, pose: dict[str, tuple[float, float, float]],
             channels=("rotation_euler",)) -> None:
    """Key a set of bones at one frame from an euler table."""
    for bone_name, rot in pose.items():
        pb = arm_obj.pose.bones.get(bone_name)
        if pb is None:
            continue
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = Vector(rot)
        for channel in channels:
            pb.keyframe_insert(data_path=channel, frame=frame)


def set_interpolation(act, mode: str = "BEZIER") -> None:
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = mode
