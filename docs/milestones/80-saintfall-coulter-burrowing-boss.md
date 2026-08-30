# 80 — SAINTFALL: the Coulter, a burrowing boss

**Date:** 2026-08-12
**Slug:** `saintfall` · `assets/js/saintfall/coulter.js` · `scripts/blender/saintfall-coulter.py`
**Status:** shipped and checked — 34 assertions in `saintfall-coulter-fight.mjs`, twelve review frames

---

## What this is

A fifth caste for the Bloom, and the first enemy in SAINTFALL that is not
a walking arthropod: **a twenty-five metre sand worm that hunts under the
dunes, erupts, and spits venom.**

It is the last wave of the breach cycle, after the Matriarch.

---

## Why a worm, and why now

The bestiary was four silhouettes deep and every one of them was read by
its **leg rhythm** — small and fast, tall and thin, wide and low, long and
reared. That axis is spent. A fifth walker would have been a fourth-place
finish in a competition the player had already learned the rules of.

So the Coulter owns the one thing none of the others can: **it owns being
absent.** For two thirds of its cycle there is nothing above the sand at
all, and what the player reads is a moving ridge of displaced ground with
a plume of dust coming off it. Every other enemy on Vesper-IX is solved by
aiming. This one is solved by *moving*.

The name follows the brood's convention — Thresher, Gleaner, Harrow are
farm implements, and a coulter is the blade that runs ahead of a plough to
cut the sod open. The seven hardened radial blades around its collar are
that blade: the widest part of its silhouette, and the only pale part on an
animal that is otherwise nearly black, scoured back to bone by the sand
they cut.

---

## The cycle

| phase | seconds | what it is |
| --- | --- | --- |
| **BURROW** | 4.2–8.0 | Untouchable. A ridge crossing the basin toward the player, a dust plume, and a rumble under 90 Hz. |
| **RISE** | 1.95 | Erupts where the ridge was, damaging anything standing on it, and arcs 13 metres of body out of the ground. |
| **CREST** | 9.5 | The fight. Anchored, reared ~11 m, hittable. Bites what is close, spits venom at what is not. |
| **DIVE** | — | Back down through its own hole. The venom it left stays where it landed. |

The submerged window is the only thing the boss escalates on: a wounded
Coulter gives the player **less time to reposition**, not more health to
chew through.

### The one decision the fight is built on

The maw is the weak point (**×4.5**) and it is only live while the mouth is
open — and the mouth is only open while the animal is biting or spitting.

> The only time it can hurt you at range is the only time you can hurt it
> properly.

Green is the game's only hazard colour. It appears in exactly two places —
inside the gullet and in what comes out of it — so the tell for an incoming
spew is the same tell as the weak point, and both of them are "the mouth is
open".

---

## What had to be built for it

### A second procedural solver (`enemies.js`)

The walkers keep a body the clips pose and legs the IK owns. This is the
reverse: **the clips own its mouth and nothing else, and its whole body is
laid along a trail of the points its head has already travelled through.**
That is the only model that makes a burrower work — when the head dives,
the body follows it down through the same hole, because the hole is
literally where the head was.

- `spine` on a bestiary entry gathers a `spine00…spineNN` chain.
- Joint arc lengths are **measured off the bind pose**, like the leg
  segment lengths, so the runtime never restates the model's proportions.
- `solveSpine` is three lines: aim each vertebra at its own trail point.
  The rig was authored for it — every spine bone's rest axis already runs
  down the body, so the rotation each one receives is the actual bend.
- The root carries the head's full orientation, **pitch included**, which is
  the one place this differs from every walker in the file.

### A hit volume that is a chain, not a capsule (`combat.js`)

`HITBOX.coulter.segments` sends every damage path to the live spine: one
capsule per vertebra with radii from the model's own taper, plus a live maw
sphere. `nearestBodyPoint` makes the melee arc, stratagems and shockwaves
measure to the nearest coil rather than to the animal's origin — which for a
25 m body is its mouth.

`untouchable()` is asked by **every** damage path, not only the ray test:
a boss that can be killed by dropping ordnance on the sand above it has no
invulnerable phase however carefully the raycast was written.

### The venom (`coulter.js`, `vfx.js`)

- The game's **only travelling projectile** — everything else is hitscan with
  a decorative bolt. Venom has to fly so it can be walked out from under.
- Globules are blocked by masonry, and leave pools whose rims are written
  onto the sand they land on, per vertex.
- Pools use **normal blending, not additive**. A liquid on lit sand is
  darker than the sand; adding green to bright orange mostly cancels, and
  the first pass read as a pale wash you had to be told about.
- Toxin is one scalar, ticked in half seconds. Per frame it fires the hurt
  bus sixty times a second and makes the damage frame-rate dependent.

### Everything else

`breaches.js` grew a `bossKey` per wave and a `BOSS_KEYS` set, replacing
four hard-coded `=== "matriarch"` tests. Audio gained a sub-90 Hz rumble,
an eruption shriek and a venom hiss. The HUD gained a chevron glyph for a
submerged contact — the one instrument that can see it under the sand — and
a held green vignette for the toxin level.

---

## Bugs the harnesses earned

**The trail measured intent instead of movement.** Arc length was
accumulated from `speed * dt`, but the crest phase also lifts the head out
of the sand; a hundredth of a metre of arc was recorded for most of a metre
of real motion. The body was then sampled at arc lengths that no longer
matched the path and consecutive vertebrae ended up **nine metres apart**.
Now measured from the previous head position, after everything that can
move it.

**Dragging the front trail sample stopped the trail growing.** The fix for
the above was to reset the dragged sample's distance to zero — which meant
the threshold that lays a new sample was never crossed, and the body
concertinaed into the front ten metres of a twenty-five metre path. The
sampler now anchors on the live head and samples are laid, never moved.

**The save validator hard-coded the boss species.** `bossShape` checked
`enemyById.get(breach.bossId)?.key === "matriarch"`, so every save written
during the Coulter fight was rejected as "missing or incompatible" with a
structurally perfect payload. Now derived from the wave table.

**The bestiary measurement tool reported nonsense.** It assumes a creature
that stands, so it read a 25 m body lying down as a 23.6 m capsule radius
and printed that as a suggested `HITBOX`. It now recognises a body chain
and declines to suggest a capsule, because the next person to run it would
have copied that number into combat.

---

## What the review frames changed

The model was authored, photographed, and then substantially rebuilt. Every
one of these was invisible in the code and obvious in a frame:

| the frame showed | the fix |
| --- | --- |
| A smooth pale dome where the mouth should be — the maw rim was *narrower* than the body, so the animal had no head from any angle in front. | Rim flared from 0.97 m to 1.30 m, wider than the swell behind it. Petals lengthened to 1.6 m. |
| The seven coulter blades — the feature it is named for — did not exist on screen at a 0.42 m radial extent. | A full metre proud of the hull. The collar now measures 4.3 m across against a 2.7 m body. |
| A near-white dorsal panel the size of a car on an animal whose identity is being nearly black. | The scour is a narrow crest stripe topping out mid-bone, not a full-width sheet. |
| A smooth cigar with a paint job: thirteen segments that could not be counted are one segment. | Aft flare 1.05 → 1.13, so every ring throws a shadow onto the one behind it, plus paired dorsal spines the whole length. |
| An open mouth that turned inside out — the petals swung 20° past perpendicular. | Iris ceiling 0.92 → 0.62 rad. |
| A black post standing in a dune with the whole animal buried under it. | A three-stage pitch curve: break out steeply, flatten through the middle to make the arch, level at the top. 3/13 vertebrae above ground became 7/13, head clearance 7.2 m → 10.8 m. |
| A wake that read as a boat hull parked on a dune, invisible at 60 m. | A much larger ellipsoid sunk so only its top sixth shows, in sand's own colour — and the read carried by a dust plume instead, because point sprites have a floor on how small they draw. |

---

## Cost

- **12,748 triangles**, 31 bones, one draw call, one material — against the
  Matriarch's 10,423 and 46.
- **3.2 ms/frame** with the boss crested at 20 m and six venom pools live,
  measured over 150 fixed frames.
- No new binary assets beyond the `.glb`, and no textures.

---

## The three field commands, rebuilt (same milestone, later the same day)

All three stratagems resolved to `vfx.blast()` — a hundred motes and a bang —
so an orbital lance, a cluster salvo and a supply drop were **the same event
with different cooldowns**. A command costs a directional code entered under
fire and up to 95 seconds of cooldown; it has to be worth the four seconds of
standing still.

### A pooled ordnance rig (`vfx.js`)

Four primitives — beam, ring, dome, ground mark — with greyscale gradients
baked into their vertices and the colour set per use, so the whole rig is four
geometries and every command draws from it. Plus a small scheduler (`later`),
because the difference between these effects and the old one is almost entirely
**timing**:

- **Orbital Lance** — the beam arrives, the ground answers a beat later, the
  pressure wave outruns its own debris, and the dust it lifted is still
  climbing when the beam has gone. Leaves a fading scar and a dust column that
  marks the map for ten seconds.
- **Cluster Salvo** — the canister airbursts at 17m and eleven bomblets walk
  outward across the radius over about a second, each with its own flash, ring
  and dust. The name promised submunitions; now it delivers them.
- **Gilding Rite** — no debris and no scorch, because it has to read as HELP at
  a glance: a gold column, a ring that closes *inward* while everything else in
  the game expands, and a pulse every 2.4s for as long as the blessing lasts.

The damage is untouched and still resolves in one authoritative call. Only the
picture moved, and it now leads the damage by a per-command `IMPACT_LEAD`.

### The Reinforcement Drop became the Gilding Rite

The lance has not had a magazine since it became a heat weapon, so a third of
what that command did was already a no-op, and "+1 reinforcement" is a
consolation for dying rather than a reason to press anything. It now:

- restores vitality **and** reliquary charge and purges the barrel, and
- **gilds the lance for 20 seconds: ×1.4 damage out, ×0.5 heat in.**

It is the only command worth calling when nothing has gone wrong yet. The boon
is one timer and two multipliers owned by mission.js; combat reads `damage` on
the authoritative damage path and weapons reads `heat` on the shot, and neither
learns what a rite is. The HUD gets a countdown that pulses in its last three
seconds. The key stays `resupply` — it is what the doctrine fusions, the wheel,
the save schema and four harnesses call this slot.

### Bugs the frames earned

- **A torus scaled uniformly grows its own cross-section.** The lance's
  shockwave became a twelve-metre translucent wall standing on the sand. The
  band now keeps a near-constant height while only the circle travels.
- **The dust dome read as a glass dome** at half opacity, and was tinted with
  the weapon's colour. Dust is sand, and is read from what it dims.
- **On a normally-blended material a vertex colour of zero is black, not
  transparent.** The scorch's "fade out at the rim" was painting the rim the
  darkest part of it — a drawn ring. Moved to vertex alpha (a four-component
  colour attribute), which is what three.js reads for `USE_COLOR_ALPHA`.
- **A scheduled sound outlived its own voice.** `voice()` disconnects on a
  wall-clock timer measured from now, so the salvo's seven delayed reports were
  torn down before they started — silence, with no error attached.

`scripts/saintfall-command-shots.mjs`: 19 assertions and six frames, including
that the lance's beam precedes its ring, that the salvo produces eleven
distinct detonations over 1.3 seconds, and that a gilded shot deals 364 where
an unblessed one deals 260 — and 260 again the moment it lapses.

---

## Dying, fixed (same milestone, later again)

Two reported bugs, both about where a body ends up.

### Corpses hung in the air

A death clip in this bestiary only rotates bones — nothing animates root
motion — so the body's origin stays exactly where the creature was standing
while the pose underneath it collapses. Fine for a Thresher, whose legs fold
under a body already at ankle height. Not fine for a **Gleaner**, which dies on
four three-metre stilts: the stilts fold and the corpse is left **hanging a
metre in the air**, measured.

The correction is measured, not tuned. At load, each species' death clip is
posed to its last frame on a throwaway clone and the *skinned* mesh is asked
where it actually ends up; the runtime then eases the root by that offset over
the clip's own length, so the correction arrives exactly when the pose that
needs it does. Re-author a death animation and the fix follows it.

Two details that matter: the **4th percentile** rather than the true minimum
(one claw left pointing down would otherwise balance the whole body on it), and
the corpse now keeps following the ground — that branch used to be skipped
entirely for the dead unless a knockback was still pushing them.

| | settle | dead body, lowest 5% |
| --- | --- | --- |
| Thresher | +0.12m | −0.04m |
| Gleaner | **−1.46m** | +0.05m |
| Harrow | −0.09m | −0.06m |
| Matriarch | −0.08m | +0.02m |

### The player didn't have one

Death was a full stop: the trooper stood upright and rigid, lance at the ready,
for the whole 3.4-second respawn timer while the HUD said they were dead. It is
the one animation every player is guaranteed to see.

**The Fall** is authored on the same timeline as the swings, because it needs
what they need — the weapon comes out of line, the stance gives, the body goes
down — plus one channel none of them had: `lean` tips the figure root, and the
root sits at the soles, so the trooper topples about their own feet like a
felled tree instead of sinking through the floor. A short recoil backward, the
knees, then over onto a shoulder. The camera's boom lengthens and its anchor
comes down with the body, so a player watches their own death rather than a
patch of empty sand. Held rather than expiring — `spawn()` is what stands them
back up.

One bug the frames caught: `drop` and the topple double-counted, and the first
version buried the trooper under the road with only the lance still showing.
The pivot at the soles already takes the head from 1.65m to about a third of a
metre; `drop` only beds it in.

`scripts/saintfall-death-shots.mjs`: 13 assertions and seven frames. The
`figureAsserts` key-length gate caught the new channel on the day it was added,
exactly as its own comment said it would.

---

## Files

```
scripts/blender/saintfall-coulter.py     the model, 25.4m, 6 clips
scripts/blender/saintfall-kit.py         + VENOM ramp, align_roll, key_scale, flip
assets/models/saintfall/coulter.glb      1.4MB
assets/js/saintfall/coulter.js           the encounter: cycle, venom, wake, toxin
assets/js/saintfall/enemies.js           body chain: measure, seed, sample, solve
assets/js/saintfall/combat.js            segment capsules, live maw, untouchable
assets/js/saintfall/breaches.js          wave six, generalised boss key
assets/js/saintfall/{vfx,audio,hud,save,qa,main,boot}.js
assets/css/saintfall.css                 the toxin vignette
scripts/saintfall-coulter-fight.mjs      34 assertions
scripts/saintfall-coulter-shots.mjs      12 review frames
assets/js/saintfall/mission.js           the Gilding Rite, the boon, IMPACT_LEAD
assets/js/saintfall/vfx.js               the ordnance rig and the three commands
scripts/saintfall-command-shots.mjs      19 assertions, 6 review frames
assets/js/saintfall/player.js            the Fall: `lean` channel, death clip
scripts/saintfall-death-shots.mjs        13 assertions, 7 review frames
```
