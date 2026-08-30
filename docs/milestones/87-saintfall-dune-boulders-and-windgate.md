# 87 — SAINTFALL dune boulder audit and the Windgate

A visual audit of the sand-dune scatter boulders (user report: they repeat too
much and can be seen through from underneath), plus a new landmark: a natural
rock archway.

## The boulders

### Diagnosis, not assumption

The scatter loop in `world.js` (3,400 samples across the map) called
`kit.crag()` with `layers: 3` and no `spike`/`cliff`/`benches` variation at
all, always the plain wind-cut profile, placed with a single-point-height
`place()` rather than a footprint-aware rest. Confirmed visually with a new
harness rather than assumed: `scripts/saintfall-boulder-audit.mjs` finds real
boulder instances by reading the merged `scatter-rock` mesh's own vertex
buffer (a raycast grid was tried first and was far too slow against a
many-thousand-triangle mesh), clusters them, and photographs each from a
hero angle, a walking-eye profile, a wide establishing shot, and four
low-angle "underneath" shots per boulder.

At three rings, most boulders collapsed toward a near-symmetric dome or
pyramid. Photographed at golden hour from below, one measured pure black at
`rgb(47,7,11)` — the tell wasn't a hole, it was that with so few facets, the
*entire* shadow side landed on almost one flat value, indistinguishable at a
glance from empty space. The frame's hemisphere sky-fill is genuinely zero at
golden hour by design (`dynamicFill = max(1 - goldenFactor, storm)`; see
`saintfall-boss-aaa` in memory) — deep shadow there is intentional. A
double-sided-material test on the same frame ruled out a winding bug: nothing
changed. The floating-gap hypothesis didn't hold up either — direct
measurement of ground clearance at the picked instances came back positive
(embedded), not negative.

### The fix

- **Shape variety** — `layers: rng.int(3, 6)`, and about a third of instances
  now pick up the `cliff`/`spike`/`benches` mixing the rim massifs already
  use, rather than only the plain profile.
- **Tilt** — `tiltX`/`tiltZ` existed in the code already and were computed
  then discarded (`void tiltX; void tiltZ;`). Wired in for a genuine 3-axis
  tumble, which real settled debris has and a perfectly upright boulder does
  not.
- **Embedding** — switched from `place()` (one height sample at the centre)
  to `restOnTerrain()` (already defined in this file, unused by this loop),
  which samples the object's own lower envelope against real terrain at
  several points and rests it with a small `maxGap`. Required by the tilt
  change: a tilted object's "bottom" is no longer a horizontal plane, so a
  single-point placement cannot get it right on a slope.
- **`ROCK_RAMP`'s shade stop** — `#3f2b2b`, a plain darker version of the lit
  hue, the exact mistake `SAND_RAMP`'s own header already names and was
  fixed for once. Replaced with a lifted, violet-shifted `#544a5e` on the
  same principle. Measured to have limited effect on the *darkest* pixels
  specifically (light there is near zero, so albedo barely matters), but it
  measurably helps the mid-shadow range the shape-variety fix newly exposes.

After: the same boulder that was a flat dark pyramid now shows a tilted,
asymmetric wedge with real facet breaks in its own shadow, sitting flush on
the sand with no gap. Verified visually across 8 boulders × 6+ framings each,
before and after.

## The Windgate

A new landmark: a natural wind-carved stone arch, in open desert, clear of
every named district by a 100 m margin (the file's own header is explicit
that there is deliberately ONE dominant landmark — the Saint's head — so this
does not compete for it: a third of the height, no minimap announcement, no
narrative attached).

### `rockTube` — a new primitive

Added to `structures.js`: a tube swept along an arbitrary 3D path with the
irregular faceted cross-section `crag()` uses, rather than a pipe's perfect
polygon. Two things had to be got right, and both failed on the first attempt
in informative ways:

- **The frame must be parallel-transported, not rebuilt per ring from a
  switched reference vector.** `tube()`'s own approach — a hard switch
  between `world-up` and `world-X` depending on whether the tangent is
  within ~20° of vertical — is fine for a shape that stays mostly one or the
  other. An arch's legs start near-vertical and cross that switch within the
  first few rings on both ends, so the frame was rebuilt from a different
  axis mid-sweep and the cross-section visibly tore at the seam. Fixed by
  seeding the frame once and rotating it forward by the smallest rotation
  between consecutive tangents for every ring after that.
- **Per-ring jitter tuned for `crag()`'s 4–7 rings is chaos over 60.** The
  first draft reused `crag()`'s phase-drift and per-ring side-count jitter
  directly; over a long sweep, both compound into a random walk of several
  full turns, and adjacent rings routinely disagree on vertex count. Fixed:
  side count constant per call, phase drift down two orders of magnitude,
  both exposed as options rather than hard-coded so a short caller can still
  ask for the old amount.

### The path

A single cubic Bezier only ever produced one continuous bend — a hoop, not a
leg standing into a span, however the two control points were placed.
Rebuilt as a Catmull-Rom spline through eight explicit waypoints, which is
the actual difference between "a slice of a circle" and "leg, knuckle, span,
knuckle, leg": each segment can be as straight or as sharp as its neighbours
say, which two control points cannot express regardless of where they sit.

Regular per-ring phase drift near zero (fixed to stop the tearing) also
printed dead-straight, evenly-spaced ribs the whole length — corrugated pipe,
not eroded stone. A *low-frequency* drift (0.045 rad, not `crag()`'s 0.30)
rotates which ridge is most prominent along the path without reintroducing
the chaos.

### The collision bug this exposed

`collide.js`'s rasterizer drops any triangle with an XZ footprint under 0.5 m
as clutter — documented, and there's already a named escape hatch,
`mesh.userData.collisionSolid = true`, for "dense curved hulls built from
sub-cell triangles even though the assembled surface is several metres
across." A 60-ring, 9-sided tube is exactly that shape, and every one of its
triangles individually failed the filter. Wired `collisionSolid` through
`makeBatcher`'s `opts` so any future hero prop gets the same opt-in for free.

**Verifying this took three wrong methodologies before a fourth one worked**,
worth recording because each failure looked exactly like "the fix didn't
work" and wasn't:

1. Querying `solidTop` at the path's geometric centreline. The tube is a
   *hollow shell* — there is no material at its own axis at any height. A
   null reading there is correct, not a bug.
2. Querying `solidTop` at a fixed radial offset in the world-horizontal
   plane. Near a leg's base the true cross-section is tilted in 3D (the path
   is still rising, not yet vertical), so a flat horizontal offset doesn't
   land on the wall either.
3. Simulating player movement via the QA `walkInto` harness. Produced
   internally inconsistent readings (`start === end` despite a nonzero
   `movedM`) that pointed at a harness/coordinate quirk rather than the
   collider.
4. `ctx.collide.stats().perMesh` — the collision system already tracks
   per-mesh cell counts for exactly this kind of question ("something is
   walling off open desert" / "something is see-through", both need
   provenance). It showed 299 real cells immediately. A direct clearance
   grid dumped over the mesh's own bounding box then traced the arch's true
   two-leg footprint in ASCII, settling it.

The lesson worth keeping: **for any procedural shape, prefer the engine's own
per-mesh instrumentation over a hand-derived geometric probe.** A hand-picked
test point carries its own assumptions about the shape (flat cross-section,
known axis alignment) that the generator does not owe it.

## Verified

- `saintfall-gameplay.mjs` 55/55, `saintfall-collision-audit.mjs` 12/12.
- Collision build cost: +299 cells for the Windgate, well inside the
  suite's own load-budget gate (166,135 cells total, 440 ms build).
- In-fight frame time unaffected (9.13 ms median, 14 ms budget).
- The Windgate is walkable underneath (confirmed via the collision grid
  dump showing open space through the opening) and its legs are solid
  (confirmed via the same dump tracing the tube's true footprint).

## Not done

- The boulder fix is a shape/embedding/palette change, not a re-tuning of
  the shared frame contrast work from milestone 86 — a boulder in *storm* or
  *night* grade was not re-verified.
- The Windgate has one fixed orientation and one fixed site search; it is
  not re-rolled per playthrough seed the way district content is.
- No blind critic round was run against the Windgate specifically. The
  boss-AAA programme's Halo reference pool is boss-scaled and not a great
  fit for judging a landscape feature; if a future pass wants one, it needs
  its own reference pool (real desert arch photography, or an Xbox-era
  environment set).
