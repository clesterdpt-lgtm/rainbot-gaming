# 100 — SAINTFALL: the Undercroft, the Apostate's second phase

The operation's last fight ended on one health bar in a room the player had
already crossed. It now ends twice, and the second time it is somewhere
nobody has been: when the Cathedral pool empties, the nave floor gives out
and the trooper falls eighty-eight metres into the hive the Bloom has been
growing under the reliquary crypt, with the boss falling beside them.

> The whole feature rests on one function. A height field has no underside,
> so there is no `y` below `terrain.heightAt` at any `x/z`, ever — which is
> why the Garner's pit had to be **carved into** the height field rather
> than modelled, and why a cavern (a floor *and* a ceiling over the same
> point) cannot be. The undercroft does not try to be terrain: it publishes
> an override that `collide.groundHeight` — the single choke point every
> consumer already goes through — asks first.

---

## What shipped

**`assets/js/saintfall/undercroft.js`** (new). The chamber, the collapse,
the clutch and the lashers. `UNDERCROFT_CONFIG` holds every number; the
shell is one profile function of radius and the visible mesh is generated
*from* that function, because runtime meshes are not in the collision
raster and a picture drawn separately from the collision drifts from it.

**Siting.** Directly beneath `APOSTATE_CONFIG.arenaX/arenaZ`, and that is
load-bearing rather than tidy: `apostate.js` leashes home to that point and
`breaches.js` protects a radius around it. Put the room anywhere else and
both start measuring to a place the fight is not.

| | |
|---|---|
| pan | flat fighting floor, r ≤ 42 m |
| gallery | two walkable terraces to +3.2 m, r ≤ 54 m |
| comb wall | 2.5 rise/run — past `player.js`'s 1.7 walk gate — to +30 m |
| seal | keeps climbing past the vault so no sky leaks over the rim |
| vault | **48 m** at the crown, **20 m** at the hem |
| containment | hard radial clamp at 52 m (49 m for the boss) |

**The ceiling is tall on purpose.** The pack caps the player at ground +10 m
(`jetpack.maxAltitude`), the Apostate's jet tops out at 8.2 m, and a reared
lasher is about 16 m of limb. The lowest part of the roof clears the
highest thing the fight can produce by four metres; the middle of the room
clears it by thirty. `status()` reports `headroom`/`hemHeadroom` so the
harness asserts the promise instead of trusting it.

**The collapse** is four beats and one rule — the player never loses the
boss. FRACTURE (low and close, looking up past the kneeling mirror) →
FALL (from below: the trooper, the boss, and the hole shrinking behind
them) → SETTLE (impact, then the room's only wide shot) → LIVE.

During the fall the ground itself is held two and a half metres under the
falling pair and released onto the real floor when it arrives. Nothing has
to be told a cutscene is happening; there is simply nothing to stand on,
and the player controller's own gravity, grounding and foot plants do the
rest. The acceleration is derived from the drop so the beat lasts about
`fallSeconds` whatever the nave floor happens to sit at — a fixed gravity
would make the cutscene's length a property of the terrain generator.

**Phase two's mechanics.**

- **The clutch.** The Bloom's queen lays in an arc in front of herself and
  you choose whether to walk in. The hive lays *around you*: same object,
  opposite job. Eggs are not enemies — no rig, no brain, no place in
  `enemies.live` — so the module publishes a sphere test and every damage
  path that reaches the ground calls it (`ctx.undercroft.hitProps`, on the
  same four call sites in `combat.js` as the Abbess's clutch).
- **The lashers.** Eight tentacles on two rings. The inner ring at r=25 is
  the reason the mechanic exists rather than decorates: rooted only at the
  rim, the limbs covered the outer third of a 42 m pan while the Apostate
  holds the player in the middle of it. They erupt, track, telegraph for
  440 ms, and sweep.
- **And you cut them.** A hazard you can only dodge is weather. These share
  a nerve with the thing feeding them: one cut staggers the boss for 1.15 s
  and **every third unmoors it for 4.5 s**, which is the fight's only real
  damage window. The loop is: the tentacles push you off the boss, and
  going through the tentacles is how you get back on it.

**The pool.** `healthScale: 1.15` — a multiplier on whatever the difficulty
tier already decided the boss was worth, never an absolute. `difficulty.js`
scales `maxHealth` at spawn, and an absolute here would hand every tier the
same second phase and quietly undo Martyr. The bar drains to nothing, the
floor goes, and it refills across the reveal under a new name
(`THE APOSTATE ENTHRONED`) and a new HUD key, so a full refill reads as a
second bar rather than as one enormous heal.

---

## The traps, in the order they bit

**A capped prism is not a cell.** The comb started as a hexagonal prism
sunk two metres into the wall with the lamp at the bottom. Two hundred and
eighty cells later the wall photographed as a field of dark chevrons and
not one photon of the room's own light reached the frame: a recess that
deep is only ever seen end-on from one spot on the floor. Then the flush
plate was placed at −0.34 along the inward normal — *behind* the shell it
was decorating, occluded by the wall's own triangles. Proud by ten
centimetres, with the rim spanning further, and the room finally has a
light source.

**A backwards-wound tube reads as transparency, not as an error.** The
lasher rings are laid in a right-handed frame as `nrm·cos + bin·sin` and
advanced along `tan`, so the obvious index order `(a0, b0, b1)` has a face
normal of `tan × ring-tangent` — which at angle zero is *minus* `nrm`,
into the tube. Culled, that draws the far wall and hides the near one, and
a fifteen-metre tentacle renders as a **flat glowing ribbon**: what you are
looking at is the glow core through a shell that is not being drawn. The
Garner's limbs and this project's floor decals have the same note.
`orientGeometry` now measures the majority face direction against a desired
one and reverses the buffer, so the class of bug stops existing for every
sheet in the file.

**A double-sided additive shell arrives at twice its authored value.** The
daylight cone at a 0.30 peak photographed as a cream curtain hanging in the
room; every pixel outside the silhouette is the far wall plus the near one.
0.13.

**`chitin` is a five-percent linear violet.** A floor painted at the Bloom's
own pigment measured black four metres outside the light pool, and the
first ramp additionally ran its wet-stain term to full at the centre —
painting a black bowl exactly under the duel and putting the pale crust out
at the wall where nothing happens. The pan has its own ramp now, every stop
somewhere a dim room can put a value.

**A validator that is stricter than the restore it guards.** The clutch
cadence parked at `999` to mean "never again" once the boss died. That
number went straight into the save file, where the new validator's own
upper bound rejected it — every file written after the kill was refused on
load. A run-once latch says the same thing and is not durable state at all.

**A lethal hit cannot be intercepted at zero health.** `combat.js`'s
`applyDamage` treats health reaching zero as a death outright: `enemies.kill`,
a kill count, a `kill` event and a progression award, none of which can be
taken back. The only place that sees a hit *before* the pool is written is
`modifyIncomingDamage`, which this encounter already owns — so the killing
blow is floored at one point of health there and the collapse is armed
instead.

**The override is a column.** `groundOverrideAt` takes `x` and `z` and has
no idea what altitude the asker is at, so while it is live the nave above
has the chamber's floor too. `swallow()` takes the collapse disc with it
(which is the fiction anyway), and `breaches.js` treats the map as a boss
arena for the duration so no wave can spawn into a hole. Dying underground
also had to stop respawning the trooper at the drop point two kilometres
away and eighty-eight metres up — `combat.js`'s `respawn` asks the room for
a point first.

---

## Touched

`undercroft.js` (new) · `apostate.js` (stage, `descent` phase,
`beginDescent`/`driveDescent`/`enterHive`, the damage floor) ·
`collide.js` (the override, 3 lines) · `combat.js` (`hitProps` on four
damage paths, the respawn point) · `sky.js` (`setUnderground`) ·
`breaches.js` (1 line) · `save.js` (snapshot, validator, restore ordering)
· `hud.js` (second bar, banners) · `main.js`, `qa.js`, `boot.js`.

## Measured

`node scripts/saintfall-undercroft.mjs` — **38/38**. The collapse fires
from a real damage call and is not counted as a kill; the override drops
the floor 88 m inside the room and returns `null` outside it; the wall
holds a trooper shoved straight at it; the clutch is shootable and hatches;
a lasher rears, never reaches the roof, can be cut, staggers the boss and
unmoors it on the third; an undodged lash costs health; dying underground
respawns underground; a field save reloads into the hive; and the second
pool still ends the operation exactly once. The room's own simulation costs
**0.042 ms/frame** with eight limbs solving.

`node scripts/saintfall-apostate-fight.mjs` — **67/69**. Its death sequence
now spends both pools. The two remaining failures are pre-existing and
unrelated: the lance-palette audit filters `userData.apostatePalette` for
families starting with `chitin`, and `repaintVertexRamp` has only ever
tagged `bio-cyan`, `tarnished-leaf`, `fleshy-cloth` and `blackened-iron`,
so `lanceTaggedMeshes` is structurally 0. Confirmed against a clean tree.

`node scripts/saintfall-save-integrity.mjs` — 62/62.

---

# Addendum — the release audit

Run against the programme's own gates rather than by eye:
`saintfall-boss-gallery.mjs` (six framings, comparable with every other
boss), `saintfall-metric-compare.mjs` (thirteen axes against the measured
Halo distribution), and two new instruments written for this pass —
`saintfall-undercroft-light.mjs` (is the boss readable anywhere in the
room?) and `saintfall-undercroft-probe.mjs` (does the fight play?).

## The instruments came first, and two of them were wrong

**The gallery could not photograph the room at all.** All six framings
failed with "0% of the subject in line of sight". `_groundClear` marched
the sightline against `terrain.heightAt`, which encodes the assumption the
Undercroft exists to break: that there is nothing below the height field.
Every vertex of a boss fought 88 m down is "buried" and every sightline is
"through a hill". It now reads `collide.groundHeight` — the walking plane
the engine itself resolves, override included — which is more correct for
every boss, not just this one. The 120 m silhouette framing is also
impossible in a 92 m room; bosses may now override one framing number, and
this one pins that shot at 58 m, the longest sightline the chamber offers.

**The light probe measured the floor.** Version one cropped a centred box
and reported a flat, comfortable room at 1.23:1. At six metres a two-metre
figure is a tenth of the frame's width, so the crop was almost entirely
pan — it would have passed a frame with a black cutout in the middle of it.
Masking the subject by a visibility diff (render, hide, render, diff) gave
the real answer. The first attempt at that diff also failed silently:
`renderStill` is `step(0, true)`, and stepping runs the encounter, whose
`ensureSpawned` writes `root.visible` straight back to true. Zero changed
pixels at all 25 stations, which reads as "nothing to measure" rather than
as a broken instrument. It draws without stepping now.

**And one measurement produced a bad change before it was caught.** The
play probe attributed damage by `detail.source`, and `fireLance` reports
`source: "enemy-fire"` — the same string a Gleaner's spinneret uses. So the
probe said the brood was doing 57-96% of the damage and the boss 2-15%, a
conclusion that survived four runs because it was consistent. It was one
string collision. The lance was given a lead on the strength of it, the
rifle profile collapsed from 69% to 5%, and the revert is in the history.
`playerHurt` now carries `enemyKey` alongside `source`, and with correct
attribution the mix is healthy: **the boss is 57-79% of what hurts a
rifle and 40-60% of what hurts a lance**, the brood is second, the limbs
are space denial.

## Visual: four failing axes to two

| axis | before | after | Halo band | phase one (shipped) |
| --- | --- | --- | --- | --- |
| meanLuma | 48.5 | **60.2** | 31.4 – 91.6 | 103 HIGH |
| rmsContrast | **23.6 LOW** | 31.7 | 25.4 – 54.5 | 60.4 HIGH |
| localContrast | **9.64 LOW** | 12.8 | 10.0 – 20.7 | 14.2 |
| midBandPct | 19.2 | 42.9 | 4.79 – 43.2 | 45.2 HIGH |
| highlightP99 | 130 (floor) | 152 | 130 – 234 | 210 |
| edgeDensity | **5.16 LOW** | 6.80 LOW | 8.63 – 20.1 | 6.25 LOW |
| microDetail | **3.32 LOW** | 4.45 LOW | 6.07 – 13.9 | 4.19 LOW |
| hueFamilies | 2 | 3 | 2 – 5 | 2 |

The two that remain are the programme's known untextured-model tell, which
phase one fails as well and the brief names as the baseline. Everything
else now measures at or better than the shipped Cathedral fight, and the
whole room costs **+1 draw call** (119 against 118) and +13k triangles.

**The boss was a black cutout.** Measured with the subject masked out of
its own frame, the Apostate's pixels averaged **27/255 with 69% of them
under 24** — against 63/255 for the same model, same pose, same lens in the
nave. It read only inside the daylight pool. Four things fixed it, in this
order, each measured:

1. *The hemisphere's ground colour was a hole.* At `0x140c18` the fill said
   the pan absorbs everything, while the pan was simultaneously lit to
   measure 90/255. A hemisphere lights by `normal.y`, so the floor took the
   full violet and the figure — whose surfaces are vertical — got the
   equator, which is the mean of the violet and that hole. 27 → 38.
2. *Point lights are candela.* The renderer runs physically-correct
   lighting; the lamps were sized in legacy intuition and 22 cd lights a
   four-metre bubble. Raising them alone did not reach the far ring: 340 cd
   at 34 m is 0.29.
3. *The room needed keys with no falloff.* Two opposed directionals,
   neither casting, warm down the breach bearing and violet opposed. 38 →
   **63**, matching the nave control, and they buy the lit-side/shadow-side
   separation the contrast metrics were failing for.
4. *Ambient flattens, keys shape.* Carrying the lift on the hemisphere put
   80.6% of pixels in the mid band. The split between the two is held by
   one `EXPOSURE` constant so the level can be changed without disturbing
   the balance.

**The room had no surface.** `patchMaterial` gives fog, rim and grade and
nothing else, and on a 120 m floor filling most of every frame that is the
whole frame. The shell now goes through `applySurface` — the shared kit the
brief mandates — per family and per wavelength. That took rmsContrast to
41.4 (Halo's mean is 41.3) and localContrast to 15.7 (Halo 15.3) in one
change. It also over-applied: at `mottle: 0.28` the pan came back covered
in even, evenly-spaced two-metre spots — a leopard print. The metrics liked
it. That is exactly why the blind critic exists next to the numbers.

**The boss and its floor were the same colour.** The pan topped out at a
warm grey-tan, the room is keyed by warm daylight, and the Apostate wears
ivory and gold leaf — so the figure had nothing to separate against, which
is the brief's seventh axis stated almost word for word. Cooling the ramp
to plum and slate fixed the hue collision and took `midBandPct` from 63.7
to 42.9, inside the band, in the same edit.

## Mechanical: three real defects

**The lasher strike homed.** `strike` drove the tip at `playerLocal()`
every frame of its descent, so the wind-up was not a telegraph, it was an
announcement. A bot that never stops moving was hit by **84%** of swings.
Committing at the end of the wind-up was not enough — 0.26 s of travel is
1.5 m of player movement against a 2.4 m capsule — so the impact point is
captured at the *start* of the tell, the tell is longer (0.44 → 0.62 s),
and the hit test is the last four nodes at a 1.5 m pad rather than seven at
1.75. Connect rate on a moving bot: **84% → 9-27%**.

**The stagger did not pay.** Cutting three limbs bought 4.5 s of a boss
that could not act, and only **6.8-15.5%** of the boss's health came off
inside those windows — the player is busy during them, and a stunned boss
is still a full-health boss. Damage while unmoored is now doubled and the
window is 5.5 s: **13-32%**, and the loop is worth running.

**The limb was priced as a health pool, not a gate.** At 320 the cut cost
about a magazine and a half into a thin moving tube, and the probe showed
what that bought: a rifle that engaged the limbs removed 27-33% of the boss
in the time a rifle that ignored them and kited removed 60-78%, taking six
times less damage. When the intended loop is dominated by refusing to play
it, the price is wrong. 210.

## Open, and deliberately not fixed here

- **The rifle is slow.** Across three tiers it removes 15-69% of the second
  pool in 200 s where the lance kills in 150-190. The probe's rifle profile
  re-aims at 5 Hz, never blocks, never boosts, never uses the pack or a
  stratagem, and splits its fire between limbs and boss — so this is a
  skill floor, not a prediction, and the run-to-run spread on the same
  build is wide (44% and 15% on consecutive martyr runs). Tuning further
  against this bot would be fitting to its weaknesses. **Next step: a rifle
  profile worth trusting, or a human pass.**
- **The clutch was cut on bad evidence** (cap 9 → 5, cadence 13.5 → 17,
  ranged caste 0.24 → 0.10, and the boss's Call halved in the hive). The
  justification was the mis-attributed damage split. Re-measured after the
  instrument was fixed, the current density gives a boss-first mix and I
  kept it — but reverting is four numbers if the denser clutch is wanted.
- **edgeDensity and microDetail** remain below the Halo band, as they are
  for every boss in the game. That is the untextured-model tell the brief
  names as the programme's baseline, not a phase-two regression.
