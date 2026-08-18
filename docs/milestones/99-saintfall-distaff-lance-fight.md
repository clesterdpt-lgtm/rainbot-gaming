# 99 — SAINTFALL: the Distaff, fought with the lance

The Glass Scar's guardian shipped as a fight a Volley player could win from
outside its reach and a lance player could not fight at all. Playtest, in
the user's words: the legs' hitbox was "a very small section", the boss
"turns too quickly making it impossible to melee the legs", "the boss
attacks while it is down is too strong", and the web bolt was a slow when
it should have been a pin. This milestone reworks the fight around the
lance without taking it away from the rifle, and measures the result with a
bot that plays it.

> The bot that ran against the old build sprinted at a tarsus for sixty
> seconds and never got within six metres of it. Zero swings. That is the
> complaint, reproduced.

---

## What was actually wrong (measured before touching anything)

| complaint | what the code was doing |
|---|---|
| "hitbox is a very small section" | Ranged coverage was already the whole limb (three capsules + a foot sphere, all wider than the mesh). But `damageLeg` emitted `legHit`, which **nothing in the HUD consumed** — a leg hit drew no damage number, only body hits did. Melee's spark for a leg hit was drawn at the **body centre**, twelve metres from the blade. And `meleeReachY: 3.6` reached a third of one tibia. |
| "turns too quickly" | `faceTowards` was an uncapped exponential (`dampAngle`, rate 1.5): a big bearing error turned the animal at several rad/s, and every ~13° of yaw replants all eight feet (`stance: 2.35` at a 12 m radius). The leg a player lined up on walked away by design. |
| "attacks while down are too strong" | The bite was 58 of 150 HP every 1.75 s inside 6.8 m of the body **centre** with no facing test — against a 3 m body, that is every melee player, every bite, wherever they stand. |
| "web should stick you" | `applySlow(0.34, 3.0)`. A 0.34× slow on a trooper is a jog. |
| lunge | 9.5 m/s (the trooper sprints at 8.6), max range 34 m, and a HUD banner reading it out. |

## What shipped

**Legs** (`combat.js` `HITBOX.distaff`): three joint spheres per leg —
`joints: { r: 1.25, mult: 1.75 }` on the trochanter (femur origin), the
knee (tibia origin) and the tarsus (the `footRadius` sphere, scored as a
joint) — competing on ray-entry distance with the shaft capsules in
`legAndBodyHit`, and by nearest-point in `nearestLegPoint` for a swing. A
femur runs radially out from the body, so a ray fired inward along the
radial meets the knee first: that is the geometry being honest, not the
shaft being unhittable, and the harness shoots the shaft perpendicular to
the limb for the plain-hit check. `meleeReachY` 3.6 → 4.4. Melee spark and
event now at the contact point. **`hud.js` draws a damage number for
`legHit`** (✦-styled when `joint`) — this one line is most of "the hitbox
is small".

**Turning** (`distaff.js`): `faceYaw` caps angular velocity —
`turnRate 0.62` standing, `0.26` collapsed, `1.2` walking home — with a
`turnDeadband` of 0.045 rad, and does not turn at all while an attack is
wound up (`pending > 0`), during the leg-break stagger, or during the
lunge (which faces its own heading). Measured: exactly 0.62 rad/s against
a sprint orbit at 9 m, lagging the player by 1.49 rad after four seconds;
0 rad turned during a slam tell while the player ran a quarter circle.

**Lunge**: `lungeSpeed 9.5 → 17.5`, `lungeMaxRange 34 → 48`, min 16 → 13,
2.4 s, cadence 8. The heading is committed at the rear-up and bends toward
the player at `lungeSteer 1.4` rad/s (a 12 m turning radius): a late step
off the line is a dodge, standing at 30 m strafing is not. The "IT LUNGES"
banner is gone; the rear-up and the chord are the tell.

**Stagger**: `legBreakStagger 3.4` — every attack, the lunge and the stalk
stop, a wind-up in flight is cancelled (the harness confirms a told slam
never lands), a hauling line parts, the flinch plays (unless a leg-owned
clip has the bones). **It does not stack**: a lance breaks a leg every ~5 s
and gets its window every time; the Volley taking a knee a second would
otherwise hold the animal helpless for its whole standing phase — measured
as a boss that threw nothing at a ranged player at all.

**Bite** (collapsed): thrown from the **head bone**, `biteReach 5.4` from
it, only inside `biteArc ±1.15` rad of the way it faces, re-tested at
contact with slack so stepping round the head is a dodge; 40 dmg every
2.6 s (was 58 / 1.75). Standing at the abdomen end for six seconds: zero
bites, and a swing from there deals 183 (78 × 2.35). The grounded animal
still pivots at 0.26 rad/s, so the rear stays quiet for about ten seconds
before a player has to move — where you stand while it is down is the
mechanic.

**Slam**: `slamRadius 9.5 → 12.5`, same falloff (46 under the body, ~19 at
a tarsus). At 9.5 the one close attack could not reach the feet, and once
the feet were reachable the standing fight measured as free.

**Web pin** → **root**. New generic `player.applyRoot(seconds)` /
`clearRoot()` / `state.rootFor` (self-decaying like the slow): ground
speed forced to zero (a hard stop, not a damped skid), jump refused,
`boost.blocked()` and jetpack ignition refuse while pinned and grounded,
aim/fire/swing/Aegis untouched. Bolt: `webRootSeconds 2.4`, then
`webSlowFactor 0.45` for a further 1.6 s; a 1.7 m silk patch is laid under
the trooper. HUD: `.sf-hud__silk` edge vignette, `held` / `hauled`.

**Web reel** — the second web. `beginWebReel` uses the pin's clip and
spinneret, flags the bolt `reel`, and on a direct hit `hookPlayer` roots
the trooper and `stepReel` hauls them at `reelPull 16` m/s to
`reelStop 8.5` — through `player.drag(dx, dz)`, a new generic external
displacement that goes through the same masonry `slide` and slope gate as
a step, returning the distance actually moved so a line stopped by a wall
lets go early. One unit-cylinder line mesh is re-posed spinneret → chest
every frame of the haul. On arrival `slamTimer` is set to 0.12 so the slam
follows: reel → 0.9 s tell → slam is the combo, and the tell is the
player's answer. Thrown at 14–46 m on a 12.5 s cadence; beyond
`reelPreferRange 28` a ready line goes before a ready lunge, so a player at
the crater's edge meets both answers.

## What it measures

`scripts/saintfall-distaff-fight.mjs` — 41 → **58 checks**, all passing:
joint multiplier on knee/hip/tarsus for a shot and a tarsus swing vs a
shin, leg-hit numbers, kited lunge (17.5 m/s measured, no banner), reel
(hauled 25.4 m to exactly 8.5 m, rooted and drawn for all 97 haul frames,
slam 0.13 s after arrival), pin (root 2.4 s, 0 m moved, jump/boost/
ignition refused, 2.8 m walked in the second after at 0.45×), turn cap and
committed facing, stagger, collapsed bite arc.

`scripts/saintfall-distaff-melee-probe.mjs` — **new**: a bot that fights it.
`--reaction` is how long it takes to answer a tell it has seen; `--solo`
clears the Scar's Thresher garrison; `--ranged` plays the Volley instead;
`--root` runs the same bot against another checkout.

| run | outcome | dealt / lost | first collapse |
|---|---|---|---|
| **before**, lance, 150 s | boss untouched. **0 swings** — never within 6 m of a tarsus | 0 / 75 (Gleaner fire) | never |
| after, lance, reaction 0.35, solo | boss killed 142 s (another seed: 85 s) | 11528 / 115 (5 slams of 19 thrown, 1 web) | 58 s |
| after, lance, reaction 0.6, solo | boss killed 92 s | 11575 / 71 | 41 s |
| after, lance, reaction 0.35, with garrison | boss killed 144 s | 11380 / 283 (116 boss, 156 garrison) | 33 s |
| after, **Volley**, either reaction, solo | boss killed 61 s | 11720 / **0** — the boss threw one telegraph | 6.4 s |

Neighbours: `saintfall-garner-fight` 37/37 (shares the `legs: true` hit
path; no joints on a tentacle), `saintfall-save-integrity` 62/62,
`saintfall-melee-duel-probe` all gates.

## What this does not fix, on purpose

The Volley kills it in a minute from outside everything the animal can
throw, and it did before this milestone too (no joint bonus, no stagger,
same chained-collapse rule: after four legs, every further leg is another
eleven-second window; four knees fall in ~6 s at 216 dps). The lance is
now slower than the rifle and takes real hits doing it, which is the
correct relation — but the whole encounter is short for a district
guardian. The levers are the collapse economy (a second collapse at six
legs rather than five, or shorter re-collapses) and leg health for the
ranged path; both change the boss's shape beyond the ask, so they are
noted here rather than moved.

## Addendum — the body you could see through (same day, later)

Playing the new fight from the ground, the user photographed the collapsed
Distaff with its near carapace missing and the legs behind it showing.
Diagnosis, in the order the evidence arrived:

1. A pixel diff of the same frame rendered with the dressing's real
   `FrontSide` materials, then all `DoubleSide`, then all `BackSide`:
   **DoubleSide equalled BackSide** (0–2.7 % of pixels differ) while
   FrontSide differed from both by 11–33 %. The surface the GPU was
   showing was the far wall's *interior*. Standing at 22 m the same
   signature held (1.68 / 1.69 / 0.01 %) — the model had always drawn
   this way, and reads as solid only because flat shading takes its
   normals from screen derivatives and a closed silhouette is the same
   from either wall.
2. Transform determinants all +1 — no mirroring; the `.glb` is
   byte-identical to the day the boss was created.
3. Winding vs authored vertex normals: agree on 8391 / 8392 facets — so
   the *normals point inward too*, and the dressing's facet classifier
   (which flips the winding normal to agree with the authored one) was
   putting chalk on the underside and the warm belly on the inside of the
   top plates. The "red carapace" every gallery frame showed was the
   belly paint seen from inside.
4. **Signed volume** (Σ dot(a, b×c)/6, +1 for a `BoxGeometry`) of the
   bind-pose mesh: Distaff **−289 m³**. And the rest of the rigged
   bestiary: Winnower −63, Matriarch −47, Coulter −21.5, Harrow −4.3,
   Thresher / Gleaner / Precentor −1.15, Cantor −0.09 with a *positive*
   body (+0.08 — a mixed model). The Blender kit winds inside out; the
   Distaff is where it finally had something behind the body to see.
5. Reversing the winding live turned the hollow red bowl into the
   chalk-and-glass shell the dressing was written for. Screenshots in
   `output/saintfall/distaff-seethrough/` (`sig-dressed.png` vs
   `sig-dressed-reversed.png`; `after/`).

**Fix (Distaff only, at the dressing, on its own geometry copy):** detect
by signed volume; negate the authored normals *before* PASS A so
`facetN` — and therefore up/belly/glass classification and the occlusion
bake — key on the outward plate; reverse the winding when the material-
sorting index is written (`w1/w2`). `status().windingCorrected` reports
it. The gallery `02-full` frame goes from a red-brown carapace to the
pale animal the art direction asked for. The paint values were tuned on
the wrong wall, so a re-read of the dressing against the art doc is due —
but the classification is right for the first time and it photographs
well as is.

**Not fixed, on purpose:** the other eight rigged species. Correcting
them flips which side the sun appears to light from on every creature
(the interior view lights from the mirrored direction), and the emissive/
rim tuning on the Winnower and Matriarch was done against those renders.
It is a one-place fix (`enemies.js` at species load, signed-volume
detected — the Cantor's positive body means it must be per-species, not
blind) and it should be made and reviewed as its own pass with the
gallery on both sides. `scripts/saintfall-winding-audit.mjs` prints the
table.

Gates: `saintfall-distaff-fight.mjs` **59/59** — the new check renders the
body Front / Double / Back and requires the near wall to be what is
drawn (0.87 % front-vs-double, 19.45 % double-vs-back).

## Traps this pass hit

- **`_teleportRaw` steps a whole frame.** An orbit test that teleported the
  player every iteration gave the animal two frames per lap-step and
  measured its turn rate at exactly twice the cap. Move the player by
  writing `state.x/z` when the frame count is the measurement.
- **The buried lance at the crater's centre has flight collision.** The
  lair is 14 m west of it; anything thrown at a player parked to the
  EAST splashes on the lance's spans at ~12 m. The bolts were fine; the
  test positions were not.
- **A radial ray at a femur midpoint hits the knee.** See above. Perpendicular
  to the limb for a shaft check.
- **The damage-number layer holds 32 nodes.** A count-based "was a number
  drawn" check goes false the moment the sweep before it fills the layer;
  key on `lastElementChild` identity.
- **Collapsed melee from the rear must be swung first, then held**: the
  grounded animal pivots and after six seconds a folded leg has come round
  between the player and the body (a leg hit, not a whiff, but not 183).
- **The garrison eats a bot that only looks at the boss** — `hurtBy` in the
  probe report says who actually did the damage; `--solo` isolates the boss.
