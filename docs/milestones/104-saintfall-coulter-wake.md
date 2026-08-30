# Milestone 104 — The Coulter's wake: displaced sand, not sparks

Two complaints about the burrower's submerged phase, and it turns out
they had a common cause and a common instrument failure behind them.

**"The dust coming up looks like sparks."** It *was* sparks.
`sandSpray` emitted at tint `0.30` — the impact pool's **debris**
band, the ramp that runs `#ff7a3c → #ffd9a0`. With no explicit kind
the pool's `pickKind` drew embers, glints and shards from it, on an
additive pass, at up to `0.35 + vLife * 1.5` gain. Warm points at that
output clip, and the clip is square: the Coulter's wake photographed
from overhead was a cluster of hot white squares, and from a distance
a column of fire standing over the dune. The pool has had a proper
**sand** band (tint 13, dark, drag-limited, drawn as smoke) since the
blast rework, and eight other emitters use it. This one never did.

**"The sand moving isn't very convincing."** The ridge was one
`SphereGeometry` sunk so only its top sixth showed and slid along
under the head. Every objection to it is the same objection — it is
**rigid**:

- it translated along the current heading, so it had no relationship
  to the path actually taken and swung like a boat hull on a turn;
- it was scaled off `bodyScale` (four), which at this boss's size gave
  a **69m × 28m swell with about a metre of relief** — one in ten,
  which is not a ridge, it is a hillside. The A/B plates show it
  swallowing the dune underneath it: the "before" frame is smoother
  than the bare terrain because a lens that size covered the whole
  foreground;
- nothing about it ever settled. Ground that is pushed up has to come
  back down behind, and that collapse is the strongest cue available
  that something *moved through here*.

## Why nobody caught it

`saintfall-coulter-shots.mjs` has had three wake plates since m80.
They reached `burrow` by letting the animal hunt, and the animal hunts
under dunes: the plates were shot at **74m of depth**, twice the depth
the ridge is even allowed to draw at (`depth < 9.5 * size`). All three
were photographs of empty sand, for two milestones. `-fight` counted
the mesh (`sf-wake*` and `visible`) but never asserted on the count.

Both are fixed. The sheet now pins the depth, holds the timer above
zero so it cannot erupt mid-take, and places every camera **off the
head in the animal's own frame** — a fixed mark cannot hold a subject
crossing 13.5 m/s. `saintfall-coulter-wake.mjs` is the new dedicated
instrument: frame strips (motion is the subject; a still cannot show
a slump) plus a mesh-on/mesh-off pixel diff, because anything the eye
can find has to change pixels first.

## The furrow

`updateWake` now lays a ring of cross sections along the head's path —
one every 2m of **travel** (not of time, so a parked animal stops
extending its own wake) — and rebuilds every rib every frame, because
every rib is a different age this frame than last and that ageing is
the effect.

- **The section is a twin levee with a groove between them**, nine
  points across. Sand forced out of a bore heaps on both sides at the
  angle of repose; the trench between the heaps is what carries the
  read at distance because it is the only part of the shape that holds
  a shadow. Sized so the outer face lands near 40° — steeper than a
  dune holds on its own, which is the point.
- **Directly over the animal the groove is filled** (`dome =
  exp(-age * 1.9)`, morphing the centre point from trench to crest).
  The profile changing from swell to split furrow as it ages *is* the
  movement, rather than a decoration on it.
- **It slumps**: `0.42 + 0.58 * exp(-age * 0.85)`, fast at first and
  then hardly at all, which is also what makes the tail disappear on
  its own without a lifetime test anywhere.
- **The ends narrow, not just flatten.** Dropping the crest to nothing
  at full width leaves a flat sheet with a hard edge all round it —
  from above, a folded paper ribbon with a fan on the nose.
- **Ground contact is cached per node, nine samples, once.** Three
  samples and a lerp across an 11m rib buried the shoulders (measured
  0.94m under the sand); sampling per frame is ~290 height queries a
  frame for a shape whose XZ has not moved. `groundAcross` reads that
  cached profile at any offset, which is what makes narrowing legal.
- **The boil freezes.** A per-rib churn at `exp(-age * 1.5)`, phase
  advancing only for the first 0.8s. Sand that has stopped moving has
  lumps in it; lumps that keep breathing read as heat haze.

Measured: 3.9m of crest, no vertex more than 0.1m below the ground it
crosses, nearest vertex 1.6m from the head, ~42m of furrow.
`+0.01 ms/frame` of sim, draw unchanged.

### It does not cast a shadow, and that is measured

A ridge at the angle of repose ought to throw a hard stripe down one
flank, so `castShadow = true` was tried. The shadow map is sized for a
two-kilometre level, so a 13m-wide object lands in a handful of
texels: what came back was a blocky forty-metre smear centred on the
furrow, shadowing the ridge with its own shadow and hiding the shape
it was meant to reveal. Flank contrast comes from lighting on real
normals plus baked vertex shade (groove `0.52`, levee toe `0.80`,
crest `1.12`), both of which are exact at any distance.

The material stays the collar's sand (`0xd7a973`). Painting turned
sand darker into the material was tried and is physically right —
sub-surface sand is not bleached — but a ribbon whose whole face is
darker has a hard tonal edge everywhere it meets the dune, and a
hard-edged darker patch lying on sand reads as an object on the
ground. Baked shade reaches zero at the feather ring, so the ribbon
has no edge to find; the material must not.

## Sand in the impact pool

`sandSpray` is now three layers, because sand leaving the ground is
three materials and any one of them alone is the wrong thing:

| layer | band | why |
| --- | --- | --- |
| curtain | 13 (dust), `IK_SMOKE` | the airborne fraction — big, soft, dark, slow, long-lived. Read from what it *dims*, so it wants area and time, not speed. The bulk. |
| skirt | 13 (dust), `IK_SMOKE` | the fraction that never gets airborne and rolls along the surface. Without it a plume looks fired from a nozzle a metre underground. |
| grains | **14 (new)** | the ballistic fraction. Few, small, fast, and the only layer that comes back down; the curtain alone is a smoke machine. |

Band 14 splits the existing sand band in the pool's vertex shader:
dust keeps its hard drag (2.6) and its thin-and-rise lift, a grain
gets light drag (0.85), gravity, and no lift — a falling grain that
also floats hangs at its apex forever.

**Grains have almost no headroom and it is not obvious.** Sand is
already the brightest thing in these frames, so an additive mote about
twice the dust's output lands near the top of the range, clips its red
channel and comes back a hard white dot — the exact spark this band
exists to stop being. That happened once during this pass, on the
`breach` grains, and is visible in `vfx-sheet` history. Held to about
a third above the dust, with **size** rather than gain giving them
presence: a grain reads against the *sky* at the top of the throw, not
against the ground.

Thrown **sideways**, too. Sand forced out of a bore leaves at the lip
of the furrow, perpendicular to travel and only a little forward; the
old spray went along the heading with `dy = 0.94`, which is a geyser.
The two lips alternate so they never freeze into a symmetrical arch.

Counts scale with `sqrt(power)` and sizes with `power`: a bigger plume
is a bigger plume, not a denser one. Scaling count linearly is what
put the burrower alone over the whole pool, which then recycled every
mote inside a fifth of a second and cancelled the settle the layers
are tuned around. `IMPACT_MAX` 640 → 960; a dead slot is one vertex
invocation that clips itself off screen.

## Two shared effects fixed on the way

- **`skidMark`** emitted at the debris tint as well, so every caller —
  the burrower's furrow, a boosted landing, a Stylite skidding on its
  face, the Garner's arms, the Apostate — shed a little rooster-tail
  of embers while being dragged through a dune. Now dust and grains.
  It also takes an optional `width`: the Coulter's furrow is ten
  metres across and was being drawn with a boot-width sliver, in 32m
  segments — and a decal is two triangles taking their corner heights
  off the mesh, so a patch much longer than the ground's own
  undulation cannot lie on it. Those were the hard dark wedges beside
  the furrow. Now short (3.4m) and wide.
- **`breach`** was 34 debris motes and a flash. What comes out of a
  dune when something the size of a barge leaves it is a wall of dust
  with a little grit in it; the grit was carrying the whole effect on
  the spark band, so an eruption read as an explosion. Sand wall, sand
  ring, grains, and a much smaller debris component — there *is*
  chitin and stone in a breach, it is just no longer all of it.

## Coverage

`saintfall-coulter-fight.mjs` grows a `THE FURROW` section that
measures rather than assumes: drawn, all-finite, ≥1.2m proud, nothing
below −0.6m, starts within 12m of the head, 25–110m long. "A mesh
exists and is visible" would have passed on the old ellipsoid and on
the empty-sand plates alike.
