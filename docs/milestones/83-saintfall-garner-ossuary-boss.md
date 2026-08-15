# 83 — SAINTFALL: the Garner, the Ossuary's pit

The Ossuary's district boss was a placeholder: a Harrow scaled to 1.35
with 2600 health, standing on a bone-white pan under a ninety-metre
skeleton. It is now the animal that skeleton belongs to.

> "The Ossuary is not a graveyard. It is one animal."
> — the drop briefing, since the first build

**THE GARNER** — a granary; the thing wheat is *gathered into*. It sits
in the same liturgical-agricultural naming as the Winnower, the Coulter,
the Distaff and the Harrow, and it is the only one of them that is a
place rather than a tool.

---

## The encounter

| phase | what it is |
| --- | --- |
| `dormant` | A bone-white pan with a ring of settled dust on it. Hidden and untouchable until the player crosses 64m. |
| `breach` | 5.2s. The ground domes, cracks in a ring fifty-two metres across, and falls in. The maw rises out of the hole. The camera is borrowed for it, once per encounter. |
| `feeding` | The fight. Three clocks: the lash, the inhale, the volley. |
| `gorge` | 11s. Cut three limbs and it recoils — the mouth gapes, the gullet comes up, and it does nothing but be a target. The limbs regrow on the way out. |
| `sealing` | The leash. The pan closes over it at full health. |

### The lash — the encounter

Tentacles erupt from the sand **near the player**, not from the pit: the
animal is bigger than its own mouth, and its reach is the whole district.
A limb comes up, rears back, and strikes.

**A hit seizes.** Heavy damage, a hard drag toward the throat, and a
second and a half of reduced control.

**A miss is the design.** The limb crashes across the sand and lies
there, and then drags itself home at walking pace — the anchor migrates
toward the pit and the limb follows it across the ground. While it is
down it is the only part of the creature a polearm can reach. Punishing
the player for the dodge they just made would have been the easy version
of this fight; rewarding it is the fight.

The aim **locks halfway through the rear**, which is the whole dodge
window — the limb visibly follows the player, visibly stops following
them, and then arrives.

### The inhale

The mouth draws for four seconds and everything loose on the pan goes
with it, including the player. Reaching the throat is not instant death:
it is most of a life, a throw back to the rim, and a five-second lockout
so one bad approach cannot be swallowed twice.

### The volley

A fan of bone shards on a ballistic arc — the same read the Coulter's
venom already taught. It is why the player cannot answer the other two
from forty metres.

---

## What is new in the engine

### A procedural species

`BESTIARY.garner` declares `procedural: true` and has no `.glb`. The
species loads as an empty root with no clips; `garner.js` builds and
poses every vertex. Both halves of this creature are things a baked rig
cannot do:

- the pit has to **open** — per-vertex motion across seventy-eight
  hinged plates, not a rotation of a skeleton;
- a tentacle has to **miss** — and where it lands is a function of where
  the player dodged to and what the terrain does there.

Everything downstream is unchanged: it gets an id, a health pool, a save
entry, a cull range and a place in `enemies.live`, and `spawn` did not
grow a second path.

### A limb is four nodes

`combat.js`'s `distaffLegSpan` is now `limbSpan`, and reads either a
skeleton quartet (the Distaff's `coxa`/`femur`/`tibia`/`foot`) or a
`chain` of four plain `Object3D`s. The Garner's six tentacles satisfy the
existing per-limb hit table — own pool, three capsules and a tip, melee
reach gate, break bonus — from a rig with no skeleton at all.

`spec.selfPosedLegs` keeps the walking IK solver off them. Handed to it,
six eighteen-metre limbs would be replanted onto the terrain as feet.

### FABRIK, and the bug that demanded it

The first solver laid the nodes evenly between anchor and target and then
enforced link length from the root outward. That is correct exactly when
the target happens to be `armLength` away, and it never is: a limb
reaching for a player six metres from where it surfaced has twelve metres
of slack, so the evenly-spaced nodes end up 0.4m apart, the forward pass
stretches each gap to 1.29m, and every node after the second is placed
*behind* the one before it. **The limbs rendered as six wet knots at
their own roots.** Two passes — tip-pinned backward, root-pinned forward
— distribute the slack instead of accumulating it. The harness asserts a
minimum span across the four hit nodes so it cannot come back.

---

## Two things the terrain would not let us have

**`groundHeight` is a max over terrain and authored surfaces, so nothing
in this engine can lower the ground a player walks on.** A pit is
therefore a hole in the picture and not in the collision grid, and a
player strolling across open air over one is a worse artefact than any
amount of missing depth. Two consequences, both deliberate:

1. **The depth is all inside the mouth.** The broken pan slumps 3.4m —
   walkable — and the collar plunges into a shaft the player can see down
   but never stand over. A ring of slabs is levered *up* at the break
   line, because a slump is a shape you can only read from above and the
   player is 1.7m off the sand. Only some of them, and only on the outer
   band: a solid raised lip would be a wall they walk through.
2. **The animal holds them off itself.** Inside the collar they are
   devoured and thrown; short of that they are held at the pit's inner
   lip. That distance is an arithmetic contract with `HITBOX.garner`'s
   `bodyRadius` — the player has to be able to reach the open gullet with
   a polearm from where they are stopped, or the gorge window is
   ranged-only and the whole limb fight buys nothing.

---

## Placement

Dead centre of the district was the first choice and it was wrong on
screen: the ribs are up to 78m tall and 50m across, spaced seventeen
metres apart, so a fifty-metre pit at the middle of the cage sits among
the rib *bases*. The fight happened in a forest of bone columns that
blocked every shot and swallowed the silhouette.

The pit is 108m out from the spine, square to it, where the pan runs flat
and unbroken — and the ribcage becomes what it is much better at being,
which is the backdrop behind the mouth rather than the set it is buried
in.

---

## Art notes

- **The collar is flesh, not bone.** A bone collar under bone teeth on a
  bone-white pan is a single pale mass with no silhouette; the first
  build's mouth read as an architectural drum with a crown on it.
- **Nine tusks, not fifty-four teeth.** Three rings of eighteen came out
  as a bed of nails — a fringed texture rather than something countable,
  and a silhouette the player can count is one they can tell "open" from
  "shut" at forty metres.
- **`bio` at 0.85, and it was 2.4.** The emissive mask multiplies the
  surface's own colour, so a strong one on a limb whose alpha carries
  sucker rings up its whole underside does not add glowing detail — it
  adds two and a half times the diffuse back on top of itself. Eighteen
  metres of oxblood muscle came out as a pale pink streamer in daylight.
- **The tooth fold was inverted for one build** and the animal spent it
  as a sea anemone: a closed Garner splayed its fangs at the sky and an
  open one folded them politely across its own throat.

Four materials, five draw calls, and the whole encounter measures
**4.1ms/frame with all six limbs live and a volley in the air**.

---

## Verification

`node scripts/saintfall-garner-fight.mjs` — 31 checks, all passing.
Covers the reveal gate, the collapse, the lash's full sequence and its
dodge window, the melee reach gate in both directions, the per-limb
pools and the gorge they force, the mouth as a ranged and melee target,
the keep-out and the devour, the leash, a save/restore round trip,
death, and the frame budget.

`node scripts/saintfall-distaff-fight.mjs` — 41/41, confirming the
`limbSpan` rename did not disturb the encounter it was extracted from.
