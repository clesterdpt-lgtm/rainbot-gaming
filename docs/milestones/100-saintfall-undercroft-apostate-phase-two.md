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
