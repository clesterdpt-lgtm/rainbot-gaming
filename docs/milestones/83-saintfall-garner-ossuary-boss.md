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
| `dormant` | A wide sand funnel in the pan with a plate of fused bone at the bottom of it. Hidden and untouchable until the player crosses 64m. |
| `breach` | 5.2s. The floor of the funnel domes, cracks, and drops away into the mouth underneath it. The camera is borrowed for it, once per encounter. |
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

- the pit has to **open** — per-vertex motion across a hundred and four
  hinged slabs, not a rotation of a skeleton;
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

## The pit is terrain, and that took three tries

**The mouth is below the desert and you climb down to it.** Getting
there meant three passes, each of which was wrong in an instructive way.

**First: build the pit out of scene geometry.** It looked like a hole
and was not one. `collide.groundHeight` is a max over terrain and
authored surfaces, so nothing created at runtime can lower the ground a
player walks on — they strolled straight across the middle of it.

**Second: keep the pan flat and stand the mouth five metres proud of
it.** That gives a silhouette from across the district, and it makes the
wrong creature: a mouth standing on the desert is a tower. This is a
sarlacc.

**Third, and shipped: carve the funnel into `heightAt` itself**, next to
the districts, as `GARNER_PIT`. Twelve metres deep, a thirteen-metre
floor, a thirty-six-metre rim and a low spoil lip, terraced down the
wall so the descent has something to measure itself against. The
collision grid, the walking plane and the visible ground all come out of
that one function, so the pit is simply real — the player walks down
into it with ground under their boots the whole way.

Two consequences worth writing down, because both are properties of a
height field rather than choices:

- **The throat cannot be a hole in the terrain.** There is no radius at
  which the ground is absent, so a mouth flush with the sand has sand
  across the bottom of it. The beak therefore stands five metres proud
  of the **funnel floor** — which still leaves the whole animal seven
  metres under the pan — and a black disc laid just above the sand
  inside the collar turns those five metres into something with no
  bottom. This is exactly the Return-of-the-Jedi arrangement, arrived at
  by arithmetic rather than by homage.
- **Runtime geometry is never in the collision grid.** So the ring of
  slabs the collapse levers up around the hole is deliberately mostly
  gaps — a solid lip would be a wall the player walks through — and the
  animal keeps them out of its own throat itself, by writing
  `player.state.x/z`. That distance is an arithmetic contract with
  `HITBOX.garner`'s `bodyRadius`: the player has to be able to reach the
  open gullet with a polearm from where they are stopped, or the gorge
  window is ranged-only and the limb fight buys nothing. The harness
  checks it.

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

- **Albedo is linear, under a desert noon.** The sun runs well above 1,
  so a value multiplies rather than caps: an oxblood `0.44` red came back
  at `0.87` sRGB after lighting and tone mapping — coral — and eighteen
  metres of limb rendered as a party streamer. Two successive halvings
  later they read as meat. The district's rule is that only bone and sand
  are allowed to be mid-value.
- **The collar needed a material, not a colour.** Painted pure black and
  photographed, it still came back the khaki of the dune behind it: at
  16m the atmosphere patch's sky-tinted rim is additive and independent
  of albedo. What the rim cannot flatten is faceting — flat shading gives
  every muscle segment its own normal and therefore its own rim strength,
  and the ring went from a smooth cone washed to one tone into
  alternating lit and shadowed staves.
- **Nine tusks, not fifty-four teeth.** Three rings of eighteen came out
  as a bed of nails — a fringed texture rather than something countable,
  and a silhouette the player can count is one they can tell "open" from
  "shut" at forty metres. Their length is capped by a hard constraint
  rather than chosen by eye: a gaping tusk swings up by about its own
  length, and the tip of the longest has to stay several metres under
  the pan.
- **The tooth fold was inverted for one build** and the animal spent it
  as a sea anemone: a closed Garner splayed its fangs at the sky and an
  open one folded them politely across its own throat.
- **A ring of palps around the collar's base** is a pure silhouette job
  and the cheapest one available — a truncated cone is a truncated cone
  however it is shaded, and from the pit floor the mouth was reading as a
  drum somebody had left there.

## Audit against the other bosses

Measured in one session by `scripts/saintfall-boss-audit.mjs`, each boss
with its fight actually live:

| boss | ms/frame | draw calls | triangles | max HP |
| --- | --- | --- | --- | --- |
| Distaff | 6.99 | 147 | 507k | 9000 |
| Winnower | 6.01 | 120 | 506k | 6200 |
| **Garner** | **7.61** | **181** | **570k** | **7400** |
| Coulter | 5.79 | 177 | 560k | 5200 |

It is the most expensive of the four and by the smallest margin that
still matters — six meshes rather than one skinned draw — and it is
inside the 9ms gate every boss harness asserts, on a scene that is
already the heaviest in the game before the animal is added.

On design surface it is at the top of the range: six independently
pooled limb targets plus a mouth that is a ranged target in every phase
and a melee target in one, five phases, four attacks, and eighteen
distinct audio cues. The Distaff has eight limb targets and four
attacks; the Winnower has two sacs, a gut and three; the Coulter has one
transient weak point and two.

## Verification

`node scripts/saintfall-garner-fight.mjs` — 31 checks, all passing.
Covers the reveal gate, the collapse, the lash's full sequence and its
dodge window, the melee reach gate in both directions, the per-limb
pools and the gorge they force, the mouth as a ranged and melee target,
the keep-out and the devour, the leash, a save/restore round trip,
death, and the frame budget.

`node scripts/saintfall-distaff-fight.mjs` — 41/41, confirming the
`limbSpan` rename did not disturb the encounter it was extracted from.
