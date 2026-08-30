# 90 — SAINTFALL: craft on the Fallen Saint

The map's ONE dominant landmark (see `world.js`'s header: every district is
composed around it) read as basic. A quality pass on the head, and on the two
scattered fragments that are supposed to be the same bronze.

## What was actually wrong

Photographed first, with a new harness — `scripts/saintfall-saint-shots.mjs`,
which shoots the four distances the Saint is genuinely seen from (the drop at
~780 m, the road at 260 m, the camp at 95 m, arm's reach), a look-up from
under the chin, a full eight-bearing ring, and both fragments.

Three separate problems, all visible in those frames:

1. **No craft at any distance.** Standing under a hundred metres of bronze,
   the frame was a single smooth, featureless dome. `saint-bronze` carried
   6,996 triangles for the whole statue and not one edge on the skull.
2. **The face did not read as a face** from the road — a rounded mass with two
   dark marks on it. The nose ridge and chin existed but had nothing to cast a
   shadow against.
3. **The patina was a gradient, not weathering** — and it ran backwards.

## The patina, which is the interesting one

The head's paint was `0.28 + up * 0.26 + front * 0.30 + …`: upward faces
gold, downward faces green. That is an ambient-occlusion curve wearing a
patina's clothes, and for the top of a head it is the wrong way round. A
horizontal bronze surface is where water **sits**, so it corrodes hardest; a
near-vertical one sheds and keeps its metal. That single term was most of why
the skull read as one flat gold mass with a dark underside.

Rebuilt around what actually happens on a monumental bronze:

- `pooling` — upward faces go green, **inverting** the old term.
- `runoff` — narrow vertical streaks, cubed so each is a hard line with clean
  metal either side, anchored to the two real water traps on a face (under the
  laurel band, under the eye sockets).
- `shed` / `front` / `rubbed` — metal survives on steep exposed plate and in
  the hand-height band pilgrims can touch.

**The distribution has to be bimodal, and that took a retune.** A first pass
spread the terms evenly and landed most of the skull in `BRONZE_RAMP`'s
0.5–0.65 band — `#5f9483` to `#84876c`, sage through olive-grey — and a
hundred metres of that reads as chalky mint, not as metal that has gone green
in places. Real patina is nearly binary at any given spot. The terms are now
deliberately strong and narrow rather than moderate and broad, so the mid-band
is somewhere the surface passes *through* rather than sits.

### One rule for the whole statue, in local space

The head, the Reaching Hand and the Breastplate are three pieces of one
bronze, and they carried three separately hand-tuned formulas — two of which
ran `up` the bright way. Once the head was corrected, the fragments stopped
reading as the same metal as the head they broke off. They now share
`saintPatina()`.

The frame choice is a decision, not a convenience: **patina is painted in
local space, before the piece is tipped.** The statue stood for centuries and
corroded while it stood; *then* it fell. Painting a fallen fragment in world
space would put fresh verdigris on whatever face happens to point at the sky
today, which asserts the corrosion happened after the fall. The head already
did this (its paint ran before its transform); the hand and breastplate now do
too.

## Geometry added

- **Casting seams.** Nobody pours a colossus in one piece — it is cast in
  sections and bolted, and those flanges are the most visible thing on any real
  monumental bronze. Two horizontal courses and a vertical spine seam up the
  back (a mould line a sculptor would hide from the face). They are also the
  only detail that works at *every* distance: a seam is a hard line, so it
  survives haze at 900 m where surface colour does not, and up close it is a
  real step with a real shadow.
- **Rivet courses** along both seams, sized to read as a dotted line of
  highlights rather than as individual fasteners.
- **A brow shelf**, proud of the face plate and angled down. This is the single
  thing that makes a colossal face read at distance: what carries is the
  *shadow* a heavy brow throws into the socket, which is a value block and so
  survives haze. Egyptian and Art Deco colossi both lean on it.
- **Recessed eye sockets** behind the slits, so what the player sees is unlit
  cavity rather than a lit back face — the "darkness IS the expression" the
  original comment was after.
- **A mouth line**, cut as a shallow recess rather than modelled lips (the
  Saint is a helm-faced idol, not a portrait). It buys a third horizontal in the
  face's value structure, which stops the lower half reading as blank plate.

### The rivet-seating bug, worth keeping

The first rivet pass placed studs on the cranium's **ellipse** radius. A ring
here is a *polygon inscribed in* an ellipse: at nine sides a facet midpoint
sits at `cos(π/9)` = 0.94 of nominal radius, so a stud on the ellipse floats
~6% of the radius proud of the flat it is bolted to — nearly four metres of
daylight on a 43 m cheek, and it looked exactly like that: a ring of boxes
hovering around the skull. `polyRadiusFactor()` now puts surface-mounted
detail on the real facet. Any future greeble on a `ringSolid` needs it.

## Verified

- `saintfall-gameplay.mjs` **55/55**, `saintfall-collision-audit.mjs` **12/12**.
- `saint-bronze` 6,996 → **8,124 triangles** (+1,128 for every seam, rivet,
  brow, socket and mouth), **0 degenerate, 0 non-finite, 0 bad normals**.
- **Draw calls unchanged** — it all merges into the existing batched mesh.
- Collision +113 cells. In-fight frame 4.74 ms against a 14 ms budget.

## Harness note

`saintfall-saint-shots.mjs` frames the two fragments from `world.pois`, not
from vertex clustering. The clusterer it tried first chains across any bronze
debris lying between two landmarks, so at a 40 m cell it merged the Hand and
the Breastplate into the head's own blob and offered two stray shards as "the
fragments" — which is how one run photographed a 17-vertex splinter and
reported the Breastplate unchanged.

## Not done

- The Saint's **camp, scaffolding and rust/cloth props** were not touched; only
  the bronze.
- The **cathedral bell** shares `materials.bronze` but has its own paint and was
  left alone.
- No verification in **storm or night grade** — all framing was golden hour.
- The Breastplate's `front` term is a proxy (the normal's Y), not a true
  outward-face test. It happens to be right for a plate lying convex-up, which
  is how this one rests, but a differently-tipped plate would need a real one.
