# 84 — SAINTFALL: the Abbess, the Bloom's queen

The Bloom's guardian was the Matriarch: a big Thresher that laid while
you fought it. It is now the thing that lays Matriarchs.

**THE ABBESS** — a church office, female, head of a house. It sits with
the Precentor and the Cantor in SAINTFALL's other naming seam (offices
rather than tools), and a termite colony is the only kind of house whose
head is also its entire reproductive apparatus.

She is seated in **the Throat** — the clearing at the Bloom's centre
that `world.js` already keeps free of spires, ringed by sixteen of them
leaning inward over it. It has been a royal chamber since the level was
built; nobody had put anything in it.

---

## What she is

A physogastric termite queen. Head and thorax the size of a Harrow and
armoured like one; behind them twenty metres of pale swollen egg sac
that cannot move and cannot be moved. She has not walked in years.

The design inverts the Matriarch deliberately. That was a walker with a
brooding habit. This is a **building with a mouth on the front**, and the
brood is not a habit — it is the entire animal.

## The fight

| phase | what it is |
| --- | --- |
| `dormant` | Folded down and dark in the Throat. Hidden and untouchable until the player crosses 58m. |
| `rouse` | 4.6s. The sac lights from inside, the abdomen lifts off the chamber floor, the head comes round. Camera borrowed once. |
| `seated` | The fight. Three clocks: the clutch, trophallaxis, the slam. |
| `royal` | Once, under a third health. A single royal cell, and a **Matriarch** comes out of it. |
| `retire` | The leash. She folds back down at full health and the chamber clears. |

### The clutch

She lays eggs in an arc behind her, past the far end of the abdomen — so
a clutch lands where the player has to walk around twenty metres of
animal to reach it. Each swells on a visible clock and splits into a
Thresher.

**An egg is a target.** Its own pool, killable by a shot, a swing, an
explosion or a shockwave. "She spawns a lot" is a problem with an answer
rather than a tax.

### Trophallaxis — why the answer matters

Her brood comes **back to her**, and every one that reaches her head
feeds her: 145 health each. Ignoring the swarm does not merely crowd the
player, it undoes the fight — a full cap of eighteen walking home
unopposed is about a third of her pool returned.

This is the mechanic the whole encounter is built on. Her health bar is
not the fight; **holding the room** is the fight.

### The slam, and the one real decision

She heaves twenty metres of abdomen off the floor over 1.45s and drops
it in 0.22s. Damage, a hard slow, and her own brood goes down with it —
which is most of why a good player learns to bait it into the swarm.

And the raised abdomen exposes its **underside**, the one part of her
that is sac rather than plate: five times a body hit, only from below,
and only while it is up. **The window in which she is about to hurt you
most is the window in which she can be hurt most, and both of them are
in the same two metres of ground.**

---

## What is new in the engine

### `queenHit` — a live sac

`HITBOX.abbess` declares `sac: true` and every damage path resolves
against `inst.sacSpine` / `inst.sacRadius`, which the encounter
republishes every frame. It has to be live: the sac breathes, swells
when she lays, and heaves nine metres into the air when she slams — a
fixed volume would be wrong in all three states and most wrong in the
one that matters.

The ventral weak point is **not a separate primitive**. It is the same
capsules, scored differently: while the abdomen is up, a ray that
arrives below the segment it hits has found the underside. There is no
invisible bonus volume to fish for, only the actual belly, actually
exposed.

### Eggs, which are not enemies

They have no rig, no brain and no place in `enemies.live`, so
`raycastEnemies` cannot see them. The encounter publishes
`ctx.abbess.hitEggs(x, y, z, r, damage)` and every ground-reaching path
in `combat.js` calls it — the shot marches its accepted length, melee
sweeps one sphere in front of the trooper, and explosions and shockwaves
pass their own radius straight through.

### A per-instance `selfDriven`

The first trophallaxis pass simply dropped a child's aggro and set its
`home` to her, on the reasoning that `stepEnemy` already walks unalerted
creatures back to their post. It does — but the sensing block ahead of
that re-detects a player standing in the same room on the very next
frame, so the child turned round, saw the trooper, and went back to
work. **Nothing ever reached her.**

`inst.selfDriven` (alongside the existing per-species `spec.selfDriven`)
lets an encounter take temporary ownership of an ordinary creature. It
is also the better read: a nurse carrying food does not stop to fight,
and a column of Threshers filing home past the player is a far clearer
statement of what is about to happen than any amount of milling about.

---

## Two lessons this codebase keeps re-learning

**A phase timer left to run one frame negative rejects the whole save
file.** `rouse` overshot by 0.02s, wrote `timer: -0.02`, and the schema
validator refused it — with no indication that a boss's spare two
hundredths of a second was the reason. The Coulter's own code says this
in a comment; it got proven again. Floored at the source now, and at the
snapshot boundary.

**A strong sky rim on a large smooth surface eats the form.** The
Garner's collar taught this in the Ossuary and the sac taught it again
here: at rim 1.35 twenty metres of abdomen came back as one flat ivory
mass, and halving the paint changed nothing because the paint was not
what was being seen. At 0.28 the diffuse lighting gets the body back.

Other art notes:

- **Tergites are a different material, not a darker shade.** Painting
  the plates as dimmer sac gave twenty metres of faint ring lines; they
  read only once they were put on the chitin ramp.
- **A queen's fore-body is proportionally tiny, and modelling it to that
  proportion made it disappear.** Half again as big, with lit eyes and
  pale mandibles against dark plate, so the head is the second place the
  eye goes and the first place it returns to.
- **She is pale on purpose**, unlike the Garner. That animal lived at the
  bottom of a sunlit sand funnel where mid-value belongs to the ground;
  this one sits in a dark violet chitin chamber under spore light, and a
  swollen ivory sac is meant to be the brightest object in the district.

---

## Audit against the other bosses

Measured in one session by `scripts/saintfall-boss-audit.mjs`, each with
its fight live:

| boss | ms/frame | draw calls | triangles | max HP |
| --- | --- | --- | --- | --- |
| Distaff | 3.88 | 147 | 507k | 9000 |
| Winnower | 3.52 | 120 | 506k | 6200 |
| Garner | 4.43 | 181 | 570k | 7400 |
| **Abbess** | **5.03** | **212** | **718k** | **12000** |
| Coulter | 4.70 | 172 | 558k | 5200 |

The most expensive of the five, and it should be: hers is the only fight
that puts a live population on the floor, and the measurement above has
two clutches down, a brood in the room and the abdomen in the air. Still
comfortably inside the 9ms gate every boss harness asserts.

On design surface she is at the top of the range: an armoured thorax, a
thirteen-segment live sac, a conditional weak point, a destructible egg
field, a self-feeding brood, five phases, three attacks, a once-per-
encounter escalation that spawns the district's previous boss, and
seventeen distinct audio cues.

---

## Verification

- `node scripts/saintfall-abbess-fight.mjs` — 31 checks, all passing.
- `node scripts/saintfall-abbess-shots.mjs` — six framed stills.
- `node scripts/saintfall-boss-audit.mjs` — the table above.

Regression sweep after the change: garner-fight 31/31, distaff-fight
41/41, district-hunt-probe 32/32, collision-audit 12/12. The hunt probe
needed repointing twice — its shared-boundary example has now lost both
the Ossuary and the Bloom to bespoke controllers, and it measures the
Choir.
