# 92 — SAINTFALL: the Garner's pit is not there until it is

The Ossuary's boss shipped with a fifty-metre sand funnel permanently
carved into the pan, a mouth standing five metres proud of the bottom of
it, and six tentacles you could see through. All three came out of the
same constraint and all three are now gone.

> "The whole read of the animal is that the ground opens and the mouth
> is already down there."
> — milestone 83, arguing for a hole that was always open

---

## The pit closes

`GARNER_PIT` was carved into `heightAt` because a height field is the
only surface the collision grid, the walking plane and the renderer all
agree about — see 83 for the two wrong versions that came first. That
was right and it stays. What was wrong is that it had no amplitude.

A funnel permanently sunk into the pan **announces the encounter from
the far side of the district**. The Ossuary's silhouette is a ninety-metre
skeleton on a flat white plain, and the boss was a hole in it that the
player could see from three hundred metres and walk into at their
leisure. The surprise was spent before they were near enough to be in
it.

The pit's displacement is now a pure function of radius times one
scalar, `garnerReveal`, which garner.js drives from the same `state.open`
that the lid and the mouth already ride. Sealed, the Ossuary is level
ground. Crossing the aggro radius takes it out from under you.

### Why this is cheap

`sampleChunk` costs 4225 height evaluations plus a normal (four more
each) and a colour (thirty-odd coarse lookups each) — about a fifth of
a second across the four chunks the pit straddles, for a surface that
has to move every frame for five seconds.

It never runs. Because the displacement is one scalar, **every affected
sample has exactly two states worth measuring**, and both are measured
once at load: the sealed end is read straight back out of the LOD0
buffer (every sample appears there at stride 1, so the mesh already
holds the pan's own height, normal and encoded colour at that exact
point), and the open end is evaluated with the reveal temporarily
pinned to 1. The frame's job is a lerp over 783 samples writing into
about a thousand vertices.

Measured: **4.01 ms/frame mid-collapse** against 3.33 settled and 4.76
on the wide dormant view. The patch does not appear in the budget.

Three things had to be got right and each of them was a bug first:

- **The skirt duplicates edge samples.** Every chunk carries an
  eleven-metre downward apron cloned from its edge row, and the pit is
  124m across on a 256m grid — it crosses two seams. Missing those
  duplicates leaves an apron hanging at pan height along both.
- **Bounding spheres were fitted to a flat pan.** A bore that drops
  twenty metres below it puts vertices outside them, and a chunk whose
  sphere no longer contains its own geometry is a chunk the frustum
  culls while the player is standing in the hole. Grown once, by
  `depth + throatDepth`, rather than recomputed per frame.
- **The field and the mesh are set together, always.** There is no bare
  setter for `garnerReveal`: `heightAt` feeds the foot IK and every
  module that samples the ground analytically, the sample plane feeds
  `groundHeightAt`, which is what the player walks on and what collision
  reads. Letting one move without the other is a player standing on a
  surface that is not drawn.

### And two passes go blind inside it

`coarseHeight` is baked before the pit exists, and two terms in
`colourAt` read it.

`occlusionAt` asks it how high the ground is on four rings out to 54m
and counts what is left of the sky. A vertex on the funnel floor is
therefore told that the ground **four metres away stands twelve above
it in every direction** — which is a vertical shaft, not a twenty-degree
sand cone. Every sample saturates, `o*o` returns 1, the 0.62 mix crushes
the value, and the pit photographed as a black slot cut in bright sand
with no terraces, no spoil and no floor to fight on. The `local` term
that picks a vertex's place in the sand ramp fails the same way and for
the same reason.

Both are faded out across the pit and replaced with radial functions,
which is all a circular hole's shading ever was — and which the reveal
can scale, so a sealed pan carries nothing waiting on it.

### What else was standing on the sealed pan

- **260 pieces of bone litter** across the Ossuary, placed once and
  never moved again. Eleven of them were inside the pit, and a skull
  left hanging in the air over an open mouth is worse than a gap.
  Resampled off the pit rather than pushed outward, which would build a
  ring of bone around the hole that nobody authored and that would give
  the encounter away from the other side of the district.
- **The spoil collar** — 300 chips of broken lid at the break line — now
  rides the ground down. Each remembers where it sits on the sealed pan
  and how far its own patch has to fall; `poseLid` slides it, which is
  three hundred vertical writes while the pit is moving and nothing at
  all either side of that.

---

## The mouth comes down to the sand

`mawStand` was 5.0 and the reasoning for it was airtight given what the
terrain could do: a height field has no hole in it at any radius, so a
throat level with the ground has ground across the bottom of it. However
much throat you want to see down, the mouth has to stand proud of the
surface it is set into by that much.

**The problem is that it is still a plinth.** Five metres of collar
standing clear of flat sand is a drum with a crown on it, whichever
surface the drum stands on — and every note in garner.js about "a mouth
standing on the desert is a tower" was arguing with a symptom of the
missing hole rather than with the hole.

The pit is being re-evaluated anyway, so the bore can simply be cut.
`mawStand` is **1.0** — a hand's width — the depth the player looks into
is terrain, and the sand runs up to the teeth.

Three constraints fix the bore and each of them bites:

| number | bounded by |
| --- | --- |
| `throatDepth: 5.0` | below, by the black shelf inside the mouth: the sand must stay clear of it at every radius the chewed collar reaches, or a plate laid to hide the ground has ground on top of it |
| `throatOuter: 10.4` | above, by `keepOutScale` — the animal holds the player 9.59m from its axis, so the bore must be back at floor grade by then or the fight is conducted on a slope |
| the span, 6.2m | below, by **player.js's slope gate** |

The last one is the one that is easy to miss. player.js walks anything
under a sustained 1.7 rise over run and nothing above it, and a
smoothstep of depth D across a span S peaks at 1.5D/S — so the first
pass, 8m across 5.3m, had a 2.26 wall. The mouth holds the player out of
the bore during the fight so nothing noticed; the moment the animal is
**dead** it stops holding them, and a hole with unclimbable sides that
the player may now walk into is a softlock in the shape of a boss arena.
5m across 6.2m peaks at 1.21, and the steepest pair of samples the mesh
actually draws comes out at 1.12.

### And a bore of sand is not a throat

Geometry alone cannot make it read as a hole: five metres of sand cone
under a desert noon comes back as a nicely shaded funnel, which is the
exact failure the black shelf and the unlit bore were built to hide one
plane at a time. A near-black vertex colour over the same annulus does
it for the whole depth, and it is free — those vertices are being
written anyway.

Held inside the bore's own span, though. The first pass reached 2.6m
past `throatOuter` and put a sixteen-metre black disc on the funnel
**floor**, which is the ring of ground the entire fight is conducted
from: the mouth read as something floating in a void rather than as a
rim set in sand, which is the opposite of the change it is part of.

### Twenty-six smaller teeth, in the sand

Twenty-one tusks on a collar is a crown, and a crown has an edge:
however low the collar sits, the animal stops exactly where its own
geometry stops and the sand begins again. That edge is what still read
as "a mouth on a base" after the base came down, because a ring of
enamel with nothing outside it is a rim somebody set into the ground
rather than something the ground is full of.

The outer ring breaks it — smaller and sparser the further out they go,
all raked at the throat, a quarter of them worn to stumps. Nine
vertices each, the same topology and the same 45-degree mid ring as the
tusks, because that spiral crease is what makes a spike read as a tooth
rather than as a thorn and it is why these can be a third the size and
still be countable.

**They are ground, not mouth.** Pinned to the world at the funnel's
finished floor rather than riding the maw, for two reasons that both
matter: they must not iris — a small tooth set in sand has nothing to
fold on — and being at the *finished* floor while the pan is still shut
means they are buried until the collapse reaches them. So the ring is
not revealed by the mouth coming up; it surfaces as the sand goes down,
which is the beat the collapse wanted and costs nothing to get.

The outer **fringe** moved with the mouth. Its palps were rooted two to
four metres down the collar's flank and hung onto the sand below, which
worked when there were five metres of collar above it. There is now one,
so every root was under the funnel floor and the whole ring was
invisible. Re-rooted just beneath the lip and splayed **out** rather than
down, lying across the sand between the mouth and the tooth ring — same
job, done from the only side of the join that is still above ground.

---

## The tentacles had a hole in them

Six limbs are one smooth-shaded tube, and its ring frame was built from
scratch at every node: cross the tangent against world up, or against
world x if the tangent came within 23 degrees of vertical.

Both halves of that are locally correct. **The switch between them is a
discontinuity**, and it sits in the middle of every rearing limb — a
tentacle standing out of the sand and hooking over its target passes
|tangent.y| = 0.92 somewhere along itself. The ring on one side of that
node is rotated half a turn against the ring on the other, the eight
quads spanning them are twisted through 180 degrees, and every face past
the seam is wound backwards and therefore **not drawn** on a FrontSide
material.

So a rearing tentacle showed a hard crease at the bend and then simply
stopped having a surface. The player saw the far wall of the pit through
it. It looked like an alpha problem and it was a basis problem — the same
one `rockTube` in structures.js was given parallel transport to fix.

The cure is to stop choosing. One frame is seeded at the root and
rotated node to node by the minimum rotation carrying the old tangent
onto the new one: project the carried reference back onto the plane
perpendicular to the new tangent and renormalise. Consecutive rings then
differ by the smallest angle the curve itself demands, there is no angle
at which anything switches, and the tube cannot invert.

**The harness measures it on the buffer, not on a photograph.** A ring's
own vertices average to its centre, so the radial direction of vertex 0
is recoverable, and consecutive radials may only differ by however far
the curve turns. Reverted to the old seed choice the check reads exactly
**180 degrees**, mid-lash, at ring 10; transported it reads 80, at the
very last link of a limb that has hold of the player and is being asked
to point its grasping pad at them — a real elbow in the pose, 34cm
across. An angle rather than a length, because a rung-length test is
ambiguous at the 34cm tip and this is not.

---

## Pacing

The limbs came too fast to read. A full lash runs erupt, rear, strike,
lie there and drag home — about nine seconds — so the concurrent count
is that over the cadence.

| | was | now | why |
| --- | --- | --- | --- |
| `armCadence` | 3.1 | **3.9** | at 3.1 the pan carried three overlapping telegraphs at full health before a single limb had been cut, and three simultaneous reads is not a harder version of one read, it is a different and worse mechanic: the player stops dodging limbs and starts running from the general direction of the pit |
| `armVolley` | [1, 3] | **[1, 2]** | a wave of three on top of the two already up is five, and the fifth limb is not a target the player can see |
| `eruptSeconds` | 0.62 | **0.72** | erupt plus rear was 1.67s from broken sand to contact and only the back half of it was aimed |
| `rearSeconds` | 1.05 | **1.35** | which reads as a limb that appeared and hit rather than one that appeared, chose, and hit. Now 2.07s to contact, and the locked half of the rear — the actual dodge window — goes from 0.47s to 0.61s |

### The coin toss the longer telegraph exposed

`resolveLash` took the **flat-closest** of the last four nodes and then
asked that one node to also be within reach vertically. So a limb whose
pad closed on the player's chest was scored on whichever bend of itself
happened to pass a few centimetres nearer in plan — and if that bend was
buried in the funnel wall six metres below their boots, the strike was
recorded as a miss.

Which bend wins is a function of where the limb surfaced and how far
under the player that patch of ground is, so on the Ossuary's own slope
the same lash against the same **stationary** player resolved either way
at about even odds. milestone 83 records the note "an attack that only
lands on people who move is not a telegraph, it is a coin toss with the
wrong face up" — this was the other face of the same coin. Each node is
now tested on both axes, which is the question that was always being
asked.

### And the harness was measuring the old durations

Two hard-coded waits, calibrated against a 0.62s eruption and a 1.05s
rear. Lengthening the telegraph moved the aim lock past the first wait,
so the harness stepped aside while the limb was still tracking and then
reported that dodging does not work. Both are derived from
`garner.config` now — the lock is at `rearSeconds * 0.45` remaining, so
0.62 through it is past it at any duration.

---

## Two bugs found on the way

- **`keepOut`'s own axis was a hole in it.** The bearing to push the
  player out along is `(ps - pit) / d`, so a degenerate `d` was guarded
  by returning — which means a player who arrived exactly over the middle
  of the mouth was the one player it did not hold out of it. Any bearing
  will do when there is no bearing.
- **`resetToPit` could not reset after a kill.** `enemies` retires a
  corpse once its death animation has run, so the reference the module
  holds is to something no longer in `enemies.live`, and `healToFull`
  wrote full health onto an object nothing reads. Everything downstream
  came back half-alive: the pit reopened because `stepInstance` still saw
  `inst.state === "death"` and drove `open` to 1 for a corpse, and a
  harness that killed the boss could never get a live one back.

`keepOut` is also now called in **every** phase the mouth is up rather
than only the two it fights in — a dead Garner's throat is still a hole
in the ground. Which in turn required the death transition to stop the
inhale: a draw in progress when the last shot lands was harmless while
nothing read it, and `keepOut`'s one way *in* is `inhaleFor`. Left set, a
Garner killed mid-inhale spent the rest of the level swallowing anyone
who came near the corpse.

---

## Verification

`node scripts/saintfall-garner-fight.mjs` — **37/37**, up from 31. Six
new checks:

- the sealed pan is level ground where the pit will be;
- the collapse carves the funnel and the throat into the terrain, and
  leaves the pan outside it untouched to the centimetre;
- a player standing on the pan rides it down and lands on it, with the
  drawn surface and the capsule's floor the same plane;
- the living mouth will not let the player into its own throat, and a
  dead one's throat can still be walked out of;
- no ring of a limb's tube is turned against the one before it.

`node scripts/saintfall-collision-audit.mjs` — 12/12.
`node scripts/saintfall-save-integrity.mjs` — 62/62.
`node scripts/saintfall-gameplay.mjs` — 55/55.
`node scripts/saintfall-progression.mjs` — 64/66, both failures
pre-existing and unrelated (a Mercy Circuit relay in the Censer Works
and a `MultiplyBlending` warning from a VFX material).

`node scripts/saintfall-boss-audit.mjs`, every boss with its fight live:

| boss | ms/frame | draw calls | triangles |
| --- | --- | --- | --- |
| Distaff | 3.85 | 154 | 540k |
| Winnower | 3.54 | 121 | 545k |
| **Garner** | **4.04** | **186** | **633k** |
| Abbess | 5.20 | 222 | 763k |
| Stylite | 4.04 | 176 | 561k |
| Coulter | 4.34 | 177 | 600k |

`node scripts/saintfall-garner-shots.mjs` — the sheet gains `00-dormant`
(the Ossuary from a hundred metres out: level pan, ribcage behind it,
nothing where the pit will be) and `00b-collapse` (the same ground two
and a half seconds in). `08-sealed` reframes to unbroken sand, which is
the cheapest possible check that the leash puts the ground back.
