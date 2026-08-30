# 94 — SAINTFALL: the Matriarch gets arms, and a fight

The Gilded Reach's mantis had two problems, and they turned out to be the
same problem seen from opposite ends: nobody had ever looked at it
closely, and nobody had ever fought it for long.

- **The forelimbs came out of the wrong place, and there were only
  three of them.** The raptorial coxa left the *top* of the mesosoma
  travelling up and outboard, so the arm's highest point was its elbow
  and its widest was its wrist, 2.05 m off a centreline the body is 0.9 m
  thick at. From the front the pair read as two horizontal paddles at
  head height — a stubby wing each side. And the limb ended at the
  tibia, tapering to a point, with no tarsus at all.
- **The fight was `stepEnemy`.** It was the last district boss still on
  the generic walker brain: close to reach, bite on a 2.35 s cadence, and
  lay every fourteen seconds. Against a 3600-health pool that is a fight
  with exactly one decision in it, taken once — walk round the back, then
  hold the trigger — because nothing the animal did could take the
  position back.

Both are fixed. The parts of the encounter that were already right — the
gaster weak point on the far side of nine metres of hostile animal, the
brood clock that says *stop shooting the armour* — are kept and built on.

## The arms

`scripts/blender/saintfall-matriarch.py`. A mantis forelimb is **four**
segments, and both the count and the order matter:

- **Coxa** — drops from the *front* of the prothorax, close to vertical,
  so the joint it carries hangs in front of the chest. Unusually long
  for an insect, and it is why a mantis holds its trap out ahead of
  itself rather than at its ribs.
- **Femur** — reaches *forward*, barely descending, past the face. The
  thick one, carrying the big spine row on its **underside**.
- **Tibia** — hinges at the far end and folds back and **down beneath**
  the femur. Shorter and slimmer, its own finer spines pointing up into
  the crook, ending in a hooked terminal claw.
- **Tarsus** — the foot: a thin five-jointed thread hanging off the
  tibia's apex, carrying nothing while the animal hunts. It is the
  single most recognisable thing about the limb, and the detail that
  stops the fold reading as a machined blade.

| | before | after |
|---|---|---|
| segments | 3 (tibia tapering to a point) | **4**, + a terminal claw and a pretarsal hook |
| coxa root | `(0.72, 3.95, 0.72)` — top of the mesosoma | `(0.40, 4.02, 0.92)` — front of the pronotum |
| coxa travel | **up** 0.40 m, out 0.80 m | **down** 1.20 m, forward 0.36 m |
| tibia folds | *up over* the femur, claw beside the face | **down beneath** it, claw under the crook |
| hinge angle at rest | 19° (effectively shut) | **47°** |
| widest point of the arm | 2.05 m outboard | **0.71 m** — inside the shoulders |
| femoral spines | pointing down, at nothing | pointing **down into the crook**, at the tibia's row |
| tibial serrations | pointing down | pointing **up and back**, at the femur's row |

Three things had to be fixed in sequence, and each was only visible once
the one before it was:

1. The coxa leaving the top of the thorax — the paddles.
2. Corrected to hang in front of the chest, but with the tibia folding
   **up over** the femur and the claw tucked beside the face. That is a
   fold, and it is the wrong one: a mantis closes its tibia *downward*
   onto the femur's spined underside, which is why the trap hangs below
   the arm and the animal looks like it is carrying something.
3. Still only three segments. A limb that ends in its own tip is a tool;
   the thread hanging past the claw is what makes it a leg.

The old comment block in that file described a "triangle of negative
space" the numbers did not contain: at 19° against limb radii of 0.3 the
"hole" was about fifteen centimetres of air inside a metre of chitin. It
is now a real hole at chest height, between a femur above and a tibia
below.

The tarsus is annulated (`kit.annulate(5, 0.24)`) so the five tarsomeres
read at distance as a chain instead of a wire, and it is keyed to move
further at rest than anything else on the animal — a dangling thread
holding perfectly still is the thing that says *rigged prop*. It trails
on the strike, curls up out of the way for the threat display, and is
the reason `measure_fold` now also reports `footClearance`: at the brood
pose's first tuck value it measured **0.37 m** off the sand, and a foot
that close intersects the first dune the animal lays on.

Every clip was re-keyed for the new rest pose. The scythe bones carry
`align_z` now (`SCY_FEMUR_SWING` / `SCY_TIBIA_SWING` / `SCY_TARSUS_SWING`),
so local +X is the hinge on every segment — positive lifts the femur,
unfolds the tibia and curls the foot — instead of four measured guesses
about whatever roll Blender happened to compute.

### The fold is measured, not eyeballed

Three revisions of this limb were argued from renders, and renders are
the wrong instrument: a fold 19° open and a fold shut look identical from
any angle where the arm is not side-on, and *"the arms come out the wrong
way"* is a fact about a coxa vector that no screenshot states. The
Blender script now exports a `fold` block with the model — claw and foot
position, hinge angle, forward reach, outboard width and ground clearance,
per clip — and `saintfall-matriarch-review.mjs` prints it beside the
pictures.

It earned its keep immediately. The first re-keyed strike measured

```
strike  fold 121.7°  claw (-0.71, -0.52, 5.11)
```

— **y = −0.52**, the animal driving its own forelimb through the sand on
every swing, from a single over-signed coefficient. The wind-up and the
strike are now keyed separately (`cock` / `drive`) because they are not
opposites: cocking is a small tight fold, striking is a long extension,
and what actually extends is the **tibia** (`blade +2.10` against
`brachium +0.22`) because the femur is already within 20° of its furthest
forward reach at rest.

| clip | hinge | claw | foot clearance |
|---|---|---|---|
| idle | 47.3° | `(0.63, 1.84, 2.43)` | 1.05 m |
| alert | 94.9° | `(1.62, 3.10, 3.44)` | 3.10 m (curled up) |
| strike wind-up | 34.9° | `(0.78, 2.74, 2.50)` | 2.15 m |
| strike | 169.3° | `(-0.42, 1.67, 4.39)` | 1.65 m (trailing) |
| brood | 41.0° | `(0.54, 1.13, 2.23)` | 1.09 m |
| death | 15.8° | `(0.54, 1.38, 2.09)` | 0.80 m |

The review harness also had its **view names off by ninety degrees** —
the camera directions were world vectors read against a boss spawned at
`yaw = π/2`, so the picture called "front" was the animal's left flank
and the one called "side" was its face. The one view that would have
shown the fold was the one nobody thought they were looking at. Camera
directions are now taken in the animal's own frame (the yaw stays, so the
sun does not move and the pass stays comparable), and there is a close
low `fold` view because at 21 m the entire forelimb is ninety pixels.

## The fight

New module `assets/js/saintfall/matriarch.js`, ~640 lines.

- **STALK** — it holds a band (6.2–11.5 m), not a point: outside it
  closes, inside it gives ground, in it circles. Facing you throughout,
  because facing you is what keeps the gaster away from you.
- **COMBO** — two scythes on separate beats (three once roused), each its
  own tell, each dodgeable on its own. Same contract as the melee-viability
  pass: the strike clip is restarted and time-scaled so its contact frame
  lands on the wind-up, and the hit is resolved against where the player
  *is* then, re-checking reach, a ±40° arc and LOS.
- **LANCE** — the answer to being plinked from twenty metres. Almost a
  full second of a reared, cocked animal, then 10.8 m in 0.40 s, arriving
  swinging.
- **CULL** — **the flank, answered.** Loiter in the rear arc inside
  10.5 m for 1.6 s and it whips round the long way at 5.6 rad/s, dragging
  the gaster through everything at ground level. It does not stop you
  getting behind it; it puts a clock on staying there. A position move,
  not a damage one — the damage is a third of a scythe.
- **BROOD** — unchanged in what it spawns (`combat.brood`, so the cap,
  the spacing and *behind the boss, not in front of it* stay asserted in
  one place) and inverted in what it means. While it lays it is planted
  and the gaster is held still and low, and worth **half again**. The
  boss's own cadence now tells the player when to take the risk.
- **ROUSE** at 45%: one beat, once. Faster, a third scythe, a brood clock
  two-thirds as long.

### Three capabilities, not three species tests

- `inst.selfDriven` set **per instance** rather than on the species spec,
  so the module claims an animal on the frame it first sees it. On the
  spec it would also claim any Matriarch spawned before the module
  existed, and a claimed creature nobody is driving stands still forever.
- `inst.weakBonus` — an encounter's temporary say over its own weak
  point, applied in `combat.js`'s one weak-multiplier site. Absent or 1
  on everything else.
- `inst.actionLocked` — an encounter saying *this animal is mid-move and
  the clip is the telegraph*. Without it a boss winding up a one-second
  tell had that tell replaced by a flinch the moment anyone shot it, so
  the more the player fired at the wind-up the less there was to read.
  It suppresses the **animation** only; damage, stagger and events are
  untouched, and a stagger still cancels the move through the module's
  own interrupt window.

### Nothing new is saved, deliberately

The lifecycle stays with `districtBosses` — still a `domain: "district"`
site, still in that snapshot, still reset by that arena ring — so
`districtBosses.status()` still returns exactly two entries and every
existing save file still validates. Everything this module owns is a
sub-second action timer; a load drops the action and re-enters the stalk,
which is also the only honest thing to show a player who was not there
for the tell. Save-integrity: **62/62**.

## What the harness found

`saintfall-matriarch-fight.mjs` gained a **MOVESET** section (eight checks
driving one move at a time through `matriarch.force`) and **A LIVE
ENCOUNTER** — no reach-ins at all: wake the Reach's own animal the way
walking into the Reach wakes it, stand a player in the arena, circle them
for thirty-five seconds and read back what the boss chose.

That block found the only real balance defect in the pass, and then a bug
in itself:

- First run: **9 tells, 0 landed, zero damage in 35 s.** The probe was
  advancing a fixed 0.055 rad per 50 ms step, which at nine metres is
  **9.9 m/s** — faster than `SPRINT` (8.6) and held in a perfect circle
  while shooting, which nobody can do. It dodged everything and reported
  the encounter as harmless.
- Fixed to a constant 6 m/s tangential (a trooper strafing, not a trooper
  outrunning): **3 of 8 tells connect, floor 81/150.** Real pressure, not
  lethal — and the superhuman run still takes nothing, which is the proof
  that the moves are answerable rather than merely survivable.
- The one deliberate buff that came out of it: `lanceTrack: 1.5 rad/s`
  during the cock, against the bestiary's shared `committedTurnRate` of
  0.6. `committedTurnRate` exists so a **sidestep** beats a swing. A lance
  is not a swing — it is the move that exists *because* standing off and
  strafing was free — so letting the same strafe defeat it for nothing
  puts the hole straight back. At 1.5 it follows a player holding station
  and cannot follow one who commits to a direction or breaks line.

The review harness needed the same lesson twice. Its **view names were
ninety degrees out**, and then — the first run after the boss got a
moveset — every picture came out framed on an empty dune, because
`matriarch.js` adopts every live Matriarch and a *hidden* player still
has a position, so the subject spent the settle walking off to stalk it.
It now holds the portrait subject with `encounterLocked` and frames on
the animal rather than on the spawn point.

Also fixed in the harness: `matriarch.status()` preferred the district
animal by key, so with a probe copy on the map it described the *sleeping*
Matriarch a kilometre away while the live one was mid-combo. It now
prefers the one that is actually fighting, and both `status` and `force`
take an explicit instance.

## Verification

| harness | result |
|---|---|
| `saintfall-matriarch-fight` | **34/34** (was 19/19) |
| the four-segment rebuild | re-ran all of the above unchanged |
| `saintfall-matriarch-review` | 6 clips × 3–6 views + the fold block |
| `saintfall-save-integrity` | 62/62 |
| `saintfall-abbess-fight` | 39/39 (she still lays one, now with the moveset) |
| `saintfall-melee-duel-probe` | all green — milestone 93 intact |
| `saintfall-boss-audit` | Matriarch added: 3.67 ms/frame, 108 draws, 510 846 tris |
| `saintfall-district-hunt-probe` | 31/33 — both failures are the Coulter's arena reset and reproduce identically on a clean HEAD |

Model: 5.05 m × 6.93 m × 11.13 m (was 10.93 m long — the fold reaches
further forward), 5962 verts, 10 659 tris, 48 bones (`tarsus_L/R` are
new; both clear the runtime's `^(coxa|femur|tibia)\d+_(L|R)$` and the
optimiser's `^(coxa|femur|tibia|foot)`, so their keys survive the strip).
Unchanged budget: 3.67 ms/frame, the cheapest of the seven.

Build pin `20260817-matriarch-moveset-1`.

## Not done

- **Health.** 3600 is the lowest pool of the seven bosses and it was
  chosen when the fight was "walk behind it and hold the trigger". The
  encounter is now longer per unit health because the player has to
  reposition, so it may be right where it is — but it is the first number
  to revisit after a playtest.
- The **cull** is the one move with no distinct clip; it plays `strike`
  while the module spins the body. A dedicated whip clip with the gaster
  trailing would read better than a fast yaw.
- The **rouse** currently changes speeds and cadences. A visible change —
  the gaster held permanently arched, the alert silhouette — would make
  the phase legible without the announcement.
