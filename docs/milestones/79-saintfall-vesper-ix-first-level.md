# 79 — SAINTFALL: Vesper-IX, the first level

**Date:** 2026-08-05
**Slug:** `saintfall` · `games/saintfall.html` · `assets/js/saintfall/*.js`
**Status:** first level playable and reviewed; gameplay deliberately out of scope

---

## What this is

A drop-in squad-shooter's opening theatre, built as a **level first**. Two
kilometres square of desert basin on Vesper-IX, composed for one long
approach from a southern ridge to a gothic cathedral on the northern rise,
with nine destinations either side of that spine.

Three references, welded:

- **Journey** for the surface language — silk dunes against hard faceted
  rock, a tightly rationed warm palette, and directional aerial perspective.
- **Helldivers 2** for the premise and the scale of the drop.
- **Grim gothic** for the material vocabulary — verdigris bronze, gold leaf,
  bone, oxblood banners, black basalt, and a reliquary the size of a hill.

Everything is generated procedurally from `ctx.seed` at load. No new binary
assets were added except one catalogue poster, which is a screenshot of the
game.

---

## The floor plan

```
                            N (−z)
  The Bloom            Vault-Cathedral            The Ossuary
  (−655, −655)           (−95, −725)               (645, −640)
   chitin, spores        nave · rose · spire        90m ribcage

  The Choir Spires      THE FALLEN SAINT           The Glass Scar
   (−820, −95)              (0, −20)                 (790, 95)
   54 stone needles     108m bronze head          400m vitrified crater

  The Gilded Reach      The Pilgrim's Road         The Censer Works
   (−600, 545)          south gate → steps           (655, 700)
   empty dune sea       ← THE FOSSE crosses →      13 towers, 3 flares

                        The Threshold
                          (0, 830)
                        drop pod · ridge
                            S (+z)
```

Composition rules the layout is built on:

1. **One dominant landmark.** The Saint's head sits in the centre of the
   basin and is visible from every district. Wherever the player is lost, it
   tells them where the middle is.
2. **One spine.** The Pilgrim's Road runs south to north through the whole
   map. It gives a large map a reading order.
3. **One horizon anchor.** The broken orbital halo arcs overhead from
   everywhere, so no frame is ever without a diagonal.
4. **No two neighbours share a silhouette family.** Vertical needles sit next
   to a flat bone pan; an organic hive next to hard gothic masonry; an
   industrial lattice next to an empty dune sea. That contrast is what makes
   a large map feel varied rather than merely large.
5. **One place where nothing happens.** The Gilded Reach is deliberately the
   emptiest district. Without it the busy places stop reading as busy.

---

## Architecture

| Module | Job |
| --- | --- |
| `boot.js` | CDN probe, import map, per-module `?v=` pinning |
| `core.js` | RNG, noise, ramps, colour space, splines, bus |
| `art.js` | Palette, time-of-day presets, grades, atmosphere model, material archetypes, shader injection, sky IBL |
| `sky.js` | Gradient dome, sun, the shattered halo, cloud shelves, shadow camera |
| `terrain.js` | 2048m height field, district shaping, 8×8 chunks × 4 LODs, vertex painting |
| `structures.js` | The geometry kit — everything built on Vesper-IX comes out of here |
| `world.js` | The level: eleven districts, the rim, the scatter, beauty shots |
| `vfx.js` | Streamers, dust, banners, fire, smoke, light shafts, spores |
| `render.js` | Linear HDR target → hand-rolled bloom → tone map + grade + sRGB |
| `player.js` | Third-person controller and camera |
| `hud.js`, `qa.js`, `main.js` | Chrome, `window.__SF` harness surface, wiring |

Budget at 1080p/ultra: **~564k triangles, 110 draw calls, ~1.2ms CPU frame.**
Load is ~2.7s in a GPU-backed Chromium.

---

## Harnesses

| Script | What it does |
| --- | --- |
| `saintfall-shots.mjs` | 21 authored poses + optional eye-level pass at every POI + orbit mode. Image metrics, camera-clearance test, raycast probe naming what is in shot. |
| `saintfall-isolate.mjs` | Differential A/B — captures one pose with a single subsystem disabled and reports pixels changed. |
| `saintfall-bounds.mjs` | Audits every merged mesh's bounding sphere and counts vertices near the world origin. |

All three read the WebGL drawing buffer via `__SF.captureDataURL()`, never
`page.screenshot()`, and step the world with `__SF.advanceTime()` rather than
waiting on requestAnimationFrame.

---

## What the review loop actually caught

Eighteen capture rounds. The defects worth recording, because most of them
presented as something other than what they were:

**Additive geometry must fade to BLACK with distance, not to the sky.** Light
shafts a kilometre away were fully hazed — and since haze on an additive
surface *adds* the sky colour, they rendered as bright pale wedges stamped
across the mountains. This was the single most visible artefact in the level
and it was invisible in the code.

**A 62%-metal bronze head rendered orange.** At that metalness the albedo
becomes the specular F0 and the diffuse term nearly vanishes, so the Saint
stopped showing its own colour and started showing a blurred reflection of a
warm ground-bounce hemisphere. Weathered bronze is a patina — a dielectric
crust — and belongs near 0.2.

**The fill was one hue, so the whole map was one hue.** Fill comes from a
cosine convolution of the sky gradient, and the zenith sat at a tenth of the
horizon band's brightness — so every shadow on Vesper-IX was lit by orange.
Brightening the *blue* end, not changing the shadow tint, is what put cool
shadows under a warm sun.

**Interpolating verdigris → bronze passes through lime.** On a 108m head that
band was most of the lit side. Real bronze has no lime state: the patina
either survives or it has been scoured off. The fix was a narrow, grey-pushed
transition.

**The ribs crossed into a fence.** The rib sweep stopped at 0.62π, so every
rib leaned outward and never returned; mirrored, the pairs splayed and read as
chain-link. Sweeping past 90° — letting `sin(a)` come back down — is the
entire difference between fencing and a ribcage.

**Ground material and district naming need different radii.** Sharing one
radius put the Glass Scar's vitrified teal on 336m of open dune in every
direction, and teal over warm sand mixes to a green lawn visible from the far
side of the map.

**Occlusion at 190m is not occlusion.** A long AO sample ring painted a
hundred-metre soft blob across the dune field that read as an enormous
unexplained shadow. Contact darkening lives in the single-digit-to-tens range.

**A vantage point that works by luck is not a vantage point.** The drop ridge
was built on the full dune train, so a 22m crest landed wherever the noise put
it — half the time directly between the drop pod and the entire rest of the
level. The Threshold is now built on the smooth landform with only the fine
ripple on top.

**And one that was my own instrumentation.** The first isolation run reported
that the sun changed 1.4% of the frame — that the directional light was doing
nothing. It was: `sky.update()` copies `atmos.sunIntensity` onto the light
every frame, so writing the light directly was undone before the next render.
The same run had a 2% noise floor because time advanced between variants,
which was larger than four of the effects being measured. Pinning the clock
and setting the atmosphere instead moved the sun's real contribution to 24.6%
of pixels at a mean delta of 39.

---

## Known gaps

- **No collision against structures.** The player walks through masonry. The
  review harness now searches for camera clearance to work around it; a real
  build needs colliders.
- **The Cathedral plaza is in the building's own shadow at golden hour.** A
  190m spire with the sun at 13.5° throws its shadow across the whole plaza,
  which is physically right and atmospheric, but it leaves the two POIs there
  with no readable auto-composed eye-level frame. Three attempts at lighting
  it were measured and rejected: processional braziers 54m away contribute
  about a ten-thousandth of their intensity at 1/d², and a brazier placed at
  the bell itself moved the frame by 0.02 luma because the auto-placement had
  stood the camera beside a statue instead. The braziers were kept — they are
  correct for the space regardless — but the frame is a known gap. Both POIs
  read fine at `noon` and `dusk`.

## Final gate

21 poses at 1920×1080/ultra: **0 image warnings, 0 page errors, 0 console
errors.** Luma 48.8–136.3, tonal sd 24.3–68.8, edge density 4.4–24.6%, hue
spanning the full circle, minimum camera clearance 1.70m. Boot 2.5s.
- **No gameplay.** No enemies, weapons, stratagems or objectives. Scope was
  the level.
- **Times of day beyond golden hour are implemented but untuned.** `noon`,
  `dusk`, `night` and `storm` all run; only `goldenhour` has been through the
  review loop.

---

# Addendum: the machine faction, and the road

## The Cantor — Concord servitor-engine

The second faction, and the other half of the "one per district group" split.
Built headless in Blender (`scripts/blender/saintfall-cantor.py`), exported to
glTF, post-processed by the same optimizer as the Thresher.

**1468 triangles · 17 joints · 5 clips · 0 textures · 191KB.**

| | Thresher | Cantor |
|---|---|---|
| height | 1.16m (0.63× trooper) | 2.88m (1.56× trooper) |
| faction | The Bloom | Concord |
| ramp | CHITIN (violet) | IRON + GOLD |
| legs | 6, insect knee | 2, reverse joint |
| `kneePole` | up 1.6, out 1.0, fwd 0 | up 0.30, out 0.14, fwd −1.0 |

The two are deliberately unconfusable: they differ in height, silhouette *and*
hue. The Cantor wears the player's own livery — iron and gold, the same two
ramps as the trooper's armour and the autogun — because the machines holding
the Censer Works and the Cathedral are the Concord's own servitors still
walking their round.

### The knee pole is per-species now

The IK solver's pole vector was hard-coded to up-and-outward, which is exactly
right for an insect and puts a two-legged machine into a wide-kneed plié. It
is now `spec.kneePole`. The bend is the entire silhouette of a leg, so this
one vector decides whether a rig reads as a beast or as a machine.

### Three failures worth recording

- **The censer rendered every frame and was never once visible.** It hung at
  `cz 0.10`, which is inside the torso drum. No triangle count, clip check or
  bounds test catches a part that exists but is occluded by its own body. It
  now hangs from a gibbet at `cz 0.52`, out in front of the chest where a
  thurible belongs.
- **The review harness framed the subject's shins.** Camera constants tuned
  against a 1.16m Thresher — aim at +0.45m, orbit at 3.6m — applied unchanged
  to a 2.88m Cantor put every shot, *including the figure-ground measurement*,
  on a pair of knees. Framing is now computed from the measured height. A
  harness whose framing only works for the subject it was written against will
  pass the next subject while showing you the wrong thing.
- **"fire" and "flinch" were flagged as visually identical.** They were not;
  the crop was on the legs, which do not move in either clip. The warning
  disappeared when the framing was fixed. Both prior instances of this warning
  were real bugs, which is exactly why the third needed checking rather than
  assuming.

## Garrisons

`enemies.garrison()` places 35 units: Threshers in The Bloom and the Choir
Spires, Cantors in the Censer Works, the Vault-Cathedral and the Fallen Saint.

Until this existed the models loaded, cost their memory and **never appeared
in the level** — every enemy image in the review came from a harness that
spawned its own subject, so nothing had ever looked at the level for enemies.

Garrisoning cost 0.97ms → 1.87ms and 111 → 146 draw calls, for units a
contribution mask measured at 0.02–0.15% of the frame. Two fixes:

- **Frustum culling re-enabled** against a bind-pose bounding sphere inflated
  2.4×. It had been disabled on the sound reasoning that skinned bounds go
  stale when posed — at a cost of one unconditional draw call per enemy from
  anywhere on the map.
- **Distance-tiered updates**: IK beyond 85m and animation beyond 190m are
  skipped, except for units playing `death`, which always finish.

Net: **1.38ms, 139 calls** with 35 enemies live.

## The Pilgrim's Road, rebuilt

Reported as "flagstone shadows read as planks". The shadows were a symptom;
the road had three faults underneath, and only pixel measurement found them.

1. **Half the near-field paving was contributing nothing.** Stones were placed
   a fixed height above `heightAt(x,z)`, but that is not the surface the
   renderer draws — the terrain mesh samples it at vertices and interpolates,
   and the drawn ground runs up to **0.12m above** the analytic height. Against
   0.13m of proudness that is a coin toss. A contribution mask showed the gaps
   between joints were **bare sand at ΔRGB exactly 0**, which is why they read
   as sand-coloured paving. Three rounds of "the flagstones are the wrong
   colour" preceded this.
2. **Boxes cannot follow a gradient.** One flat box per 4m segment on a sloping
   road is a staircase, and every riser threw its own shadow.
3. **`paintByHeight` defaults its range to the geometry's own bounding box** —
   on a 25cm flagstone that maps the whole ramp across the slab's *thickness*,
   pinning every top face to the ramp's lightest colour whatever the ramp says.
   Height is the wrong axis for a flat stone; paving varies between stones, not
   within one.

The road is now a continuous quad causeway whose stones share corners with
their neighbours and with a bed beneath, so proudness is exact everywhere and
nothing can step against anything. Paving sits **25 luma below the sand**, and
drifting sand tints the stones it is reclaiming.

`scripts/saintfall-contrib.mjs` was written during this and kept: it renders a
pose with and without a named mesh group and reports which pixels that group
actually paints. Looking at a frame cannot distinguish *dark* from *absent*.

## Gate

| | |
|---|---|
| Level | 21 poses @1080p ultra — **0 warnings, 0 page errors, 0 console errors**, boot 2.7s, 1.38ms, 139 calls, 586k tris |
| Thresher | 1.164m, 0.629× trooper, colour distance 83.4, range 35–217 |
| Cantor | 2.881m, 1.557× trooper, colour distance 88.7, range 35–197 |
| Trooper | colour distance 115.4, range 35–206 |
| Autogun | 988 tris, both hands on grips, 13.1% / 23.9% elbow slack |
| GLSL lint | clean · mesh bounds 0 suspicious |

## Still open

- **Threshers are camouflaged in their own district.** In the `bloom` pose the
  enemy group separates from the background by **5 luma** — violet chitin on a
  violet hive. Defensible as art direction, poor for readability. Unresolved.
- No collision against structures; no gameplay, objectives or stratagems.
- Times of day other than `goldenhour` remain untuned.

---

# Addendum 2: collision and gameplay

SAINTFALL stops being a level and becomes a mission. New modules:
`collide.js`, `combat.js`, `mission.js`; new harness
`scripts/saintfall-gameplay.mjs`.

## Collision — a solidity grid, not hand-placed volumes

The world builder places thousands of pieces through a dozen builders and
merges them per district per material, so by the time meshes exist there is no
per-object list left to hang colliders on. Authoring a proxy at every call site
would mean touching every builder and would then **drift** — a wall moved for a
composition reason keeps its old collider, and the bug reads as "the player
walks through masonry *here* but not *there*".

Instead the shipped triangles are rasterised into a chunked-sparse grid: 1m
cells in 32×32 pages, allocated only where something exists. **2322 pages,
414,046 solid cells, from 35 meshes**, +0.4s on boot.

Two rules make it behave:

- A triangle only blocks if it *starts* below head height (2.35m) over its own
  ground. Without it the Cathedral's vaulting 40m up walls off the floor
  beneath and the nave is unenterable.
- Anything under 0.42m proud is a surface, not a wall — otherwise the causeway
  becomes a kerb you cannot step over.

Movement resolves by axis-separated slide, which gives wall-sliding without a
contact manifold.

## Gameplay

- **Hitscan** from the *muzzle*, capsule hit volumes, 2.6× headshots
- **Ammo and reload**: 45-round magazine, 225 reserve, 2.35s reload
- **Enemy AI**: idle → suspicious → approach → attack, sight lines tested
  against the same collision grid, alerts propagating 42m through a garrison
- **Player health**, damage flash, death and reinforcement budget (5)
- **Mission**: silence three vox-relays (7.5s channel each, interrupted by
  leaving), then reach the pad; calling the shuttle wakes every unit on the map
  and re-homes them onto the extraction point
- **Stratagems**: real directional codes on `Q`+arrows — Orbital Lance,
  Eagle Cluster, Resupply — thrown along the look direction, with delay,
  cooldown and a beacon that lands whether or not you stayed
- **HUD**: health, ammo, objective tracker with channel bar, stratagem readiness,
  live code entry, damage vignette

## What "it boots clean" was hiding

`saintfall-gameplay.mjs` drives the real systems and asserts on what they
return. Its first run passed the level harness completely and found **four
genuine bugs**:

- **Shots blocked at 0.35m with the target in clear line of sight at 19.5m.**
  `rayBlock` began sampling immediately, so firing while pressed against
  masonry — or standing on any ledge the grid marks solid — blanked the shot.
  From inside the game the gun simply stops working. The ray now has to *exit*
  solid before anything counts as a wall.
- **Hit volumes multiplied by the instance scale twice.** The boxes were
  already in world metres, so the Thresher's shrank to 0.71m against a creature
  standing 1.16m; the top third could not be shot.
- **A garrison unit spawned inside a wall.** Permanently blocked by its own
  collision, so it could never close — which reads as an enemy that has seen
  you and is ignoring you. `collide.findOpen` now nudges spawns clear.
- **`inst.home` initialised behind a single flag.** Anything that woke a unit
  before its first update — a bullet, or the extraction alarm — set
  `suspicion`, skipped the initialiser, and threw when the unit tried to walk
  home. Each field is now guarded separately.

And two of the *tests themselves* were wrong, which is worth recording because
both would have passed while proving nothing:

- The wall test walked at the Cathedral from 165m out, covered its 15m in open
  desert, and reported "collision does not stop the player". It now *locates*
  masonry before claiming anything about masonry.
- The engagement test fired 40 shots and reported 5 hits. The creature dies on
  the 5th; the other 35 passed through a corpse. It now stops at the kill and
  reports accuracy — 100%.

A third measurement drifted rather than failed: the Thresher's scale check went
from 1.164m to 1.537m the moment AI landed, because the subject now rears into
`alert` at the trooper the harness puts beside it for scale. The check pins the
pose; the hitboxes are sized off the **posed** extent, since a box cut to the
rest pose stops covering the animal exactly when it is doing the thing that
makes you shoot at it.

## Thresher legibility — resolved

Previously flagged: Threshers separated from their own hive by 5 luma. Fixed by
giving the *creature* a signal colour the *environment* does not have — cyan
dorsal vents and violet joint membranes — rather than by breaking the faction
palette. Chitin is unchanged. **Colour distance 56.3** where luma still reads 4,
which is the whole point: luma was never the right metric for a hue signal.

At establishing-shot range the creatures are ~15px and no colour change helps.
That is a distance problem, not a colour problem.

## Gate

| | |
|---|---|
| Gameplay | **27/27 checks pass** — collision, hitscan, damage, AI, stratagems, all three relays, extraction, stability |
| Level | 21 poses @1080p ultra — **0 warnings, 0 page errors, 0 console errors**, 1.68ms, 146 calls |
| In-fight | 4.33ms inside a live garrison, 30 units engaged |
| Thresher | 1.475m, 0.798× trooper, colour distance 81.5 |
| Cantor | 2.88m, 1.557× trooper, colour distance 84.3 |
| Trooper | colour distance 118.7 · autogun 988 tris, both hands on grips |
| GLSL lint | clean · mesh bounds 0 suspicious |

## Still open

- **No audio.** The single largest thing missing from the feel.
- Enemies do not path around large obstacles — they slide along them. Fine on
  open ground, weaker inside the Cathedral.
- No difficulty scaling, no mission variants, no reinforcement call-in
  animation; the extraction shuttle is a light column rather than a craft.
- Times of day other than `goldenhour` remain untuned.

---

# Addendum 3: audio, inverted controls, invisible walls

Reported by the player: *"everything is inverted"* and *"there is invisible
walls on the map that won't let you pass"*. Both were real, both were mine, and
both were found by measurement rather than by reading the code.

## The controls were inverted on three of four axes

`controlCheck` drives each key and reports displacement in **camera space**,
plus what the camera actually ends up looking at. Reasoning about the signs
across three conventions — input axes, world yaw, and the camera's own basis —
is how they got inverted in the first place.

| | before | after |
|---|---|---|
| W | forward **−2.32** | forward **+2.59** |
| S | forward **+2.59** | forward **−2.32** |
| A / D | correct | correct |
| drag right | yaw **−0.53** | yaw **+0.53** |
| drag down | pitch **−0.48** (looked up) | pitch **+0.48** |

The movement bug: `move.y` is a *screen* axis (W is −1, the way a stick reports
forward) but `Math.atan2(mx, mz)` wants a *world* forward, so W resolved to
`atan2(0, −1) = π` — exactly backwards. Strafe was unaffected, which is why it
survived review: A and D behaved perfectly while W and S were swapped.

All six directions are now permanent checks in the gameplay suite.

## The invisible walls were a bounding-box triangle fill

The collision grid marked every cell in each triangle's **AABB**. A mountain
face or a long thin sliver therefore walled off hundreds of square metres of
open desert. No screenshot of the game could ever show this — the entire defect
is that there is nothing there to see — so `collisionMap` dumps the grid
top-down as an image, where it appeared immediately as giant axis-aligned
blocks and diagonal streaks across empty dune.

Replaced with real rasterisation: a scanline fill for interiors plus an edge
walk, because either alone is wrong — a scanline fill lets a wall thinner than
a cell pass between two cell centres and vanish, and an edge walk leaves
interiors hollow. Height is the triangle's own plane evaluated per cell rather
than its maximum, so a steep face no longer stamps its ridge height across its
whole footprint.

Measured A/B on the playable interior (radius 700m):

| | blocked ground |
|---|---|
| AABB fill | **4.27%** |
| triangle raster | **1.67%** |
| + step height 0.62 → 0.82m | **1.45%** |

The step-height raise handles the rest of what "won't let you pass" feels like:
knee-high rubble that stops a soldier dead is indistinguishable, from inside
the game, from an invisible wall — the player cannot see what stopped them
because it is below the bottom of the screen.

## Audio — synthesised, no assets

`audio.js`. Not one audio file, for the same reason there is not one texture:
the game is procedural, loads from a static host with no build step, and a
firefight needs dozens of overlapping one-shots that would otherwise be
megabytes before the first shot is fired.

Gunfire (three layers: filtered noise crack, pitch-swept body, distance tail),
impacts split flesh/stone, deaths scaled to the unit, stratagem descent whistle
and detonation, footsteps driven by the **stride the gait solver already
accumulates** so they land on the foot plant, damage, UI blips and chords, and
a continuous filtered-noise wind bed with an LFO on its cutoff.

Design points that matter:

- Sounds are placed by distance and bearing **relative to where the player is
  facing**, so turning your head moves the battle across the stereo field.
  Falloff is floored rather than true inverse-square: hearing *where* the fight
  is is most of the information audio carries in an open level.
- A hard 28-voice cap. Past it, new sounds are dropped — inaudible next to the
  twenty already playing, where the real failure mode is crackle and dropped
  frames.
- A limiter on the master, because sustained fire puts three or four
  overlapping shots into the bus at once.
- Audio subscribes to the buses combat and mission already emit, so it can be
  deleted without touching either.

### Testing sound in a headless browser

`audioCheck` renders every one-shot through an **OfflineAudioContext** and
measures peak amplitude. This catches the class of bug where a voice is built,
connected to nothing, and garbage-collected in silence — indistinguishable from
working audio by every other means, including "no console errors".

It immediately caught two:

- **The panner was wired in parallel, not in series.** `voice()` connected to
  the bus and `place()` added a panner alongside it, so half of every sound
  bypassed panning and nothing ever panned fully to one side.
- **The gunshot was the quietest thing in the game** — peak 0.084 against an
  impact at 0.258. A gunshot quieter than the bullet landing. The layer gains
  look large because each is measured *after* its filter, and a bandpass at
  Q 0.8 throws away most of a noise source's energy.

Final mix, by peak: explosion 0.86 · death 0.40 · inbound 0.31 · shot 0.25 ·
impact 0.10 · hurt 0.08 · wall 0.04 · blip 0.025 · step 0.023. The suite now
asserts the *ordering*, not just that sound exists.

`M` mutes.

## Gate

| | |
|---|---|
| Gameplay | **37/37 checks pass** — collision, controls, audio, hitscan, damage, AI, stratagems, mission, stability |
| Interior blocked | **1.45%** of ground within 700m |
| Level | 21 poses @1080p ultra — 0 warnings, 0 page errors, 0 console errors, 1.70ms, 146 calls |
| In-fight | 4.66ms with 30 units engaged |
| GLSL lint | clean |

---

# Addendum 4: multi-angle structure audit

`scripts/saintfall-structure-audit.mjs`. Walks every point of interest,
photographs it from eight bearings, and looks for the defects a beauty shot is
worst at finding — on the premise that the 21 review poses are *composed*, and
a composed pose is chosen to avoid the angle where something is wrong.

## What it found in the world

| | before | after |
|---|---|---|
| zero-area triangles | **18,926** (21% of every scatter mesh) | **0** |
| zero-length / NaN normals | **2,253** | **0** |
| total triangles | 489,128 | **470,202** |

- **`ringSolid` emitted a triangle for every index triple, and distinct indices
  do not imply distinct positions.** Anywhere a primitive closes to a point — a
  cone tip, a spire apex, a ring of radius 0 — all that ring's vertices coincide
  and every triangle touching them has zero area. They cost vertex processing
  for nothing, and a vertex whose faces are *all* degenerate gets a zero-length
  normal from `computeVertexNormals`, which normalises to **NaN** and travels
  into lighting and the bloom chain.
- Fixed at the primitive, then again at the choke point: `cleanGeometry` runs
  once per merged mesh in the batcher, so the next builder cannot forget it.

- **The Vault-Cathedral's nave roof was inside out**, along with one of its two
  aisle lean-tos. `extrudeZ`'s side normals are decided entirely by the
  profile's winding: counter-clockwise points outward, clockwise points *into*
  the solid. The roof profile came out clockwise (signed area −226.6), so the
  largest roof on the map took no sunlight at all and read as a flat dark slab.
  The aisle had the same fault **on one side only**, because mirroring a
  profile by negating x reverses its winding — so the two halves of a
  symmetrical building disagreed.

  `extrudeZ` now measures its own signed area and flips if needed. Fixing it at
  the call sites would have left the trap loaded for the next caller.

## What it found in itself

Four of the audit's own checks were wrong first, and each would have passed
while proving nothing:

- **`footGap`** sampled every mesh within 60m and reported the lowest vertex, so
  it read −96m everywhere: it was measuring buried foundations, and could never
  have detected floating.
- **The signed-volume winding proxy** was computed about the world origin. For a
  pillar 800m out the per-triangle terms are enormous and cancel, so the ratio
  measured *distance from the origin*. It flagged 26 of 36 meshes — the same as
  flagging none. A per-solid version via connected components is also unsound
  here: SAINTFALL's whole vocabulary is **interpenetrating** primitives, and a
  signed volume assumes a single closed non-self-intersecting shell. The
  back-face render is the only sound test, because it asks what the player can
  actually see.
- **A hand-written framing radius per POI** put the camera 13m inside the
  Saint's 108m bronze head while auditing the Pilgrim's Road, filling the frame
  with its interior and scoring 32% back faces. `safeOrbit` now marches outward
  for a position that is outside masonry *and* has line of sight — and where no
  such position exists on a bearing, the bearing is reported as occluded rather
  than photographed from inside something.
- **Line of sight was queried from the collision grid**, which deliberately
  ignores geometry starting above head height — that is what stops the
  Cathedral's vaulting from walling off its own floor. So it reported clear
  sight straight through the upper two thirds of the Saint. It raycasts now.

And one process defect: the harness left **stale images** under the same names
whenever the worst bearing moved, so a frame from a previous run was read as
evidence about the current build — I "confirmed" the roof was still broken from
a picture taken before the fix. It wipes its output directory now.

## Result

All twenty structures now sit at **0.7–5.4% back faces** with no outliers,
against 31% and 100% before the framing was fixed. Flicker (pixels that swap on
a 1mm camera move, i.e. z-fighting) is **under 1.6% everywhere**, mostly under
0.5%.

Level regression after the geometry changes: 21 poses, **0 warnings, 0 page
errors, 0 console errors**, 1.81ms, 146 calls. Gameplay **37/37**. Vertex
colours verified intact after `cleanGeometry` rewrote every attribute buffer.

## Residual, not fixed

- **0.7–5.4% back faces remain** — thin slivers along the rim ridges and the
  undersides of scattered crags seen at grazing angles. Low severity: they are
  1–2m rocks on a 2km map, and the rim is the boundary.
- `saint-camp` is the worst at 5.39%; the Saint's own bearings are 4/8 occluded
  by its head, which is correct behaviour but means it is audited from fewer
  angles than the rest.

---

# Addendum 5: strafe, mouse yaw, and overhangs

All three reported by the player after Addendum 3 claimed the controls were
fixed. All three were real, and the first two were fixed *by* that addendum
being wrong.

## The strafe test was measuring against the wrong axis

Addendum 3 asserted W/S were inverted and A/D were fine, on a check that
defined screen-right as **+X**. That is wrong: screen-right is
`cross(forward, up)`, and with the camera looking along **+Z** that is **−X**.
So `D` was walking the trooper screen-*left*, and the test agreed with it.

Worse, the same bad convention led me to "fix" a control that was working:
mouse yaw. Turning right swings the view toward screen-right, which *decreases*
yaw — so the original `camYaw -= lx` was correct and Addendum 3 broke it.

`controlCheck` now takes its basis from the **live camera** — `getWorldDirection`
for forward, `cross(forward, up)` for right — so there is no convention left to
get wrong. It also settles the camera for 150 frames first: the orbit camera
chases its target, and reading the basis mid-swing reported W and D *both*
moving screen-right, an impossible pair that was the giveaway.

| | reported before | now |
|---|---|---|
| W | forward 2.59, right 0 | ✓ |
| S | forward −2.32 | ✓ |
| A | right −2.51 (screen left) | ✓ |
| D | right +2.51 (screen right) | ✓ |
| drag right | view swings **+0.491** toward screen-right | ✓ |
| drag down | view tilts **−0.398** in Y | ✓ |

## Invisible walls: the grid could not tell a wall from an overhang

`invisibleWallScan` samples the map, keeps the blocked points, and asks what
geometry is actually near each one. It found **50 of 551 blocked samples with
nothing visible standing at them**, clustered under the Glass Scar.

The cause: each cell stored only a **top** height. A wall and an overhang both
report "something solid 12m up" — but one you walk into and the other you walk
under. So the ground beneath every leaning shard, arch, catwalk and flying
buttress was impassable.

Cells now store the vertical **span** of geometry over them, and an obstruction
only blocks if it overlaps the body: top above step height **and** bottom below
head height. The distinction that makes this work is that a triangle seen
edge-on from above is a vertical face and occupies every height between its own
bottom and top — that is what makes a wall a wall — while a sloping triangle is
a single surface at the interpolated height, which is what lets you walk
beneath it. Shots use the same span, so a round passes under an overhang too.

Also: **sub-cell geometry no longer blocks.** At 1m resolution plus the
player's rim probes, any triangle touching a cell became an obstacle ~2m
across — a ten-fold invisible pillar around a 0.2m banner pole.

| | blocked ground (interior, r=700m) |
|---|---|
| bounding-box fill (Addendum 3) | 4.27% |
| triangle raster | 1.67% |
| + step height 0.82m | 1.45% |
| + sub-cell rule | 1.43% |
| + span instead of top | **1.18%** |

Walls still stop the player (1.14m travelled of 15.6m free), and open ground
still does not (15.4m of 15.6m).

## Press K

Collision debug overlay: blocking cells near the player render as translucent
red boxes. An invisible wall is by definition something the player cannot see,
so the only way to report one precisely is to make it visible — this turns "I
got stuck somewhere around here" into a screenshot with the collider in it.

## A self-inflicted one worth recording

A slice-based edit to `controlCheck` used the next hook as its end marker and
deleted **nine QA hooks** between them — `blockSurvey`, `collisionMap`,
`auditMeshes`, `setFacingDebug`, `orbit`, `safeOrbit`, `localExtent`,
`audioCheck`, `audioState`. It went unnoticed because the structure audit had
already run and the gameplay suite had not. Restored; the suite now exercises
all of them, so the same deletion would fail loudly.

## Gate

**38/38 gameplay checks.** Level: 21 poses, 0 warnings, 0 page errors, 0
console errors, 1.99ms, 146 calls. Interior blocked 1.18%.

## Still open

48 blocked samples still have little visible at them, almost all in the Glass
Scar where large shards are half-buried and a single triangle covers cells far
from any of its vertices. Blocking there is defensible — the shard really does
pass through the ground — but it is the remaining candidate if you hit
something in that district.

---

# Addendum 6: the corridor

Reported: *"A/D and mouse look left/right are still inverted"*, and *"it is a
solid block on both sides of the pathway so you can only traverse the strip
going down the middle of the map to the cathedral"* — with the collider overlay
showing nothing at the blocked spot.

## The strafe test was measuring against the wrong axis

Addendum 3 declared A/D correct on a check that defined screen-right as **+X**.
It is `cross(forward, up)`, which with the camera looking along **+Z** is
**−X** — so `D` walked the trooper screen-*left* and the test agreed. The same
bad convention made me "fix" mouse yaw, which had been correct: turning right
swings the view toward screen-right, which *decreases* yaw.

`controlCheck` now takes forward from `getWorldDirection` and right from
`cross(forward, up)` — no convention left to assert. It also settles the camera
150 frames first; the orbit camera chases its target, and reading its basis
mid-swing had W and D *both* reporting screen-right, an impossible pair that
was the giveaway.

## "The overlay shows nothing" was the diagnosis

Those two facts together — blocked, and no collider drawn — rule out the
collision grid entirely and point at the only other gate: the **slope limit**.
That is what made this findable.

`mobilityScan` walks eight directions from points along the road;
`traverseScan` walks perpendicular for 40s. The first pass reported 1.3%
blocked — because it walked 0.9s ≈ 4m, and the flanks are 30m out. Lengthened,
it showed **8 of 24 perpendicular traverses stopping within 16–54m** of a 176m
run. The corridor was real.

Three causes, in order of size:

- **The slope test measured the local facet, not the sustained slope.** A 0.55m
  probe cannot tell a wall from a crest. Only **2.51%** of the map is steeper
  than the limit — but steep ground does not need to be common to stop you, it
  needs to be *connected*, and a slip-face ridge one metre wide runs for
  hundreds of metres. Judged over 1.6m instead, with a separate cap on a single
  step up so it does not become a licence to walk through a vertical face.
- **It was all-or-nothing.** Walking at any angle into a bank stopped the
  trooper dead rather than sliding along it. Now axis-separated, the same
  fallback the masonry collision uses.
- **The limit itself was tuned for a level, not a mission.** 1.35 existed so the
  player could not scale the Glass Scar's crater walls and reach composed shots
  from the wrong side. Raised to 1.7 (60°); a sweep showed no further gain at
  2.1, so whatever still blocks past that is not slope.

And two genuinely invisible colliders, found by `invisibleWallScan`:

- **Buried geometry was marking cells solid.** The Saint's 108m head is sunk ten
  metres into the dune, and its lower half was blocking ground the player sees
  as bare sand — a scan found blocks whose nearest geometry sat **8.31m below**
  the terrain.
- **Cells stored only a top height, so an overhang blocked the ground beneath
  it** (Addendum 5's fix, extended here).

| | traverses badly blocked | median traverse |
|---|---|---|
| before | 8/24 | 188m |
| sustained slope | 6/24 | 207m |
| + limit 1.7 | **4/24** | **207m** |

Interior blocked ground: 4.27% (original) → **1.08%**.

What still stops you is the **Cathedral mount's flanks at gradient 1.97 (63°)**
and the wrecked lander at the Threshold — both real, visible landforms, and
both diagnosed by name rather than guessed at.

## The collision build got 10× faster by not building what nobody can reach

Adding the buried-geometry test took the build from ~500ms to **4823ms**, since
it evaluates several octaves of fbm per marked cell. Memoising per cell, then
approximating the ground by a plane, then testing only ground-straddling
triangles each helped a little and cost accuracy.

The actual answer was that **the player clamps to ±1010 and the rim mountains
stand beyond that** — 287k of the grid's 386k cells were ground nobody can ever
stand on, and the largest mesh on the map was the bulk of the cost. Skipping
geometry outside the playable area: **4823ms → 475ms**, with the accurate
per-cell test kept.

## Gate

**41/41 gameplay checks**, now including controls measured in camera space,
invisible-wall density, traversability, and a build-time budget. Level: 21
poses, 0 warnings, 0 page errors, 0 console errors, **boot 3.6s** (unchanged),
1.98ms, 146 calls.

---

# Addendum 7: the knight

The player is rebuilt from a Concord trooper into a holy battle-knight, with a
melee weapon alongside the ranged one and an animation set to drive both.

## Livery

Ivory plate, verdigris panels, gold trim, and one warm light in the chest —
deliberately the Concord's own materials. The Cantor wears iron and gold, the
Cathedral is bronze and verdigris, and the Saint is a bronze head gone green:
the player is made of the same stuff as the world's holy architecture, at man
height.

Ramp **floors are high**. The body-wide gradient exists so the figure is not
striped, but with a dark floor it does the job of lighting as well, and the
first pass produced a knight whose legs were black below the waist. Ivory reads
as ivory in shadow; the sun decides the rest. Gold, cloth and the lantern also
carry a `bias` that lifts them off that gradient, because gold at hip height
otherwise renders as brown.

## What carries the read

- **A blank helm**: no face, one lit slit, a tall crest. Anything resembling
  eyes makes it a person in a mask; a flat plate with a single lit slit makes
  it an *order*, and it is why the figure can carry a halo without looking like
  a costume.
- **The heart-lantern**: a warm emissive disc in a gold sunburst. At range it is
  the only part of the figure that reads at all once detail is gone.
- **The halo**: an open crescent rising behind the left shoulder. Canted, not
  upright — built in the YZ plane it is an arc from the side and a stack of
  blocks from the front, which is the angle the player sees most.
- **Faulds, tassets, pauldrons.** The original figure was a trooper in a coat:
  thin limbs meant to be hidden, one soft dark cone for a skirt. No amount of
  repainting makes a stick read as a greave. The legs are now cuisse, poleyn,
  greave and sabaton; the waist is four overlapping lames with two hanging
  thigh plates; the pauldrons sit above and outboard of the joint in four lames
  rather than three.

## Two weapons

| | |
|---|---|
| **Censer Pattern Autogun** | 988 tris — fire, ADS, reload |
| **Reliquary Glaive** | 756 tris — 2.06m haft, faceted crescent, censer on a chain |

`X` swaps, mid-animation, at the point the old weapon is stowed.

## Animation

A pose timeline applied to the **weapon mount**, not to the arms. The arms are
already solved onto the weapon's grips every frame, so moving the weapon drags
the hands, elbows and shoulders with it — and keyframing six joints per swing
both costs more and drifts out of agreement with the grips the moment either is
edited.

Three-hit combo with input buffering, so pressing during recovery chains
instead of dropping. Every attack is wind-up → strike → recover with
deliberately lopsided timing: a swing whose three phases take equal time reads
as a slide.

| | peak tip speed | arc | accel |
|---|---|---|---|
| sweep | **43.5 m/s** | 3.45m | ×6.6 |
| diagonal | 30.4 m/s | 2.05m | ×6.6 |
| slam | 21.4 m/s | 2.42m | ×5.1 |

The acceleration ratio is the one that matters and it is what the harness
gates on.

## `scripts/saintfall-character.mjs`

Turntable plus an animation strip and numbers per action. Character work needs
a turntable, not the level's composed poses: a figure that reads from the one
angle a beauty shot uses can be broken from the other seven.

**Five of its own bugs came first**, each of which reported a broken figure
when the figure was fine:

- **The free camera returns early**, so the harness froze the animation it was
  measuring — all five actions reported moving the weapon 0.00m. Third time
  this class has bitten (weapon harness, bestiary framing, this).
- **The figure's position was also gated behind that return**, so the turntable
  rendered eight frames of empty sand and called it 0% coverage.
- **The turntable camera took its height from the ground under the SUBJECT**,
  not under itself, and sat inside a dune.
- **The silhouette plate was captured once and reused for every bearing**, so
  it diffed two different backgrounds and reported ~100% coverage.
- **The melee probe ran with the autogun equipped**, whose tip anchor is at its
  own origin — a two-metre glaive arc measured 7 m/s, which was the mount.

The weapon harness then caught a real one: the glaive's rear hand needed
**0.858m of reach against 0.629m of arm** and floated 23cm off the shaft. An
unreachable IK target does not fail loudly — it clamps and leaves the limb
straight — so it only ever shows up as a number.

`studio(on)` hides the world for turntables: a character turntable in a
populated level keeps finding scenery to stand behind, and every one of those
is a frame spent debugging the location instead of the figure.

## Gate

**41/41 gameplay · 0 character findings · 21 poses with 0 warnings, 0 page
errors, 0 console errors · boot 3.5s · 1.76ms · 146 calls.** Figure 3716 tris;
both weapons have both hands on their grips (10–22% elbow slack).

## Honest status

The silhouette, palette, features and animation are in and measured. The sculpt
is **not yet at concept-art parity**: the pauldrons are lumpy rather than crisp
stacked lames, dark voids show between leg plates where the bodyglove reads as
holes rather than shadow, and the helm's faceplate does not catch light as
cleanly as the reference. Those are shape and panel-break problems, not palette
or rig problems, and they are the next block of work.

## Addendum 7 — the knight commits to Vesper Reliquary (rounds 9–10)

Review round nine scored 3/10 and named the reason the figure kept plateauing:
it wore **half of each concept** — Vesper's bone plate, slit helm, lantern and
glaive, with the Holy Knight's halo — and so read as neither. Confirmed with the
user, the target is **Vesper Reliquary v2**. The halo is gone and the crescent
crest is in.

### Defects fixed, each with its root cause

| Defect | Root cause | Evidence |
|---|---|---|
| No arms in the silhouette | Shoulder at x 0.245 against a ribcage half-width of 0.242 and an arm radius of 0.125 — 49% of the limb inside the chest; elbow pole dominated by −Z put the elbow behind the torso | `armsegments` gate now 22,211px from all 8 bearings |
| Every shadow face magenta-violet | `GRADES.warm.lift` = [0.022, 0.014, 0.040] — blue lifted 2.9× green, so the game's **black floor** was violet | cold shadow pixels 24.2% → **0.0%** |
| 40mm hole at both ankles | Sabaton's first ring at `-SHIN + 0.040`, 20mm **below** the greave's last at `-SHIN + 0.060`, under a comment stating it starts above | closed |
| Gold read as ivory | IVORY topped at hue 42, GOLD at hue 39 — three degrees apart, separable only by saturation, which the key light erased. Bias had been tried twice; the collision was in **hue** | bone re-ramped near-neutral, gold to saturated brass |
| Tabard was a plank | One flat quad in a ramp within a few dE of the plate | centre fold + drape + darker ramp; separation 26.8 → 29.5 dE |
| All six clips were a statue with a moving stick | **No chest or pelvis pivot existed.** Ribcage, helm, crest and both shoulders were parented straight to the root, so a pose timeline could only drive `weaponMount` | body travel 0m → 0.377/0.149/0.841m on the three swings |

The violet-shadow fix is worth recording as a method failure: it was attributed
to the fresnel rim, then the sky IBL, then the split-tone shadow tint. Zeroing
the rim made shadows **colder**; the tint changed nothing. Lift is what every
pixel converges to as it darkens, so it dominates exactly where the signal is
weakest — for a defect in dark pixels, check lift first.

### Two of the instruments were the bug

- The **"arms visible" gate hid `armPivots`**, which takes the gauntlets with
  it. Visible hands scored 17,650px and kept the gate green for nine rounds
  while both upper arms were buried. It now gates limb *segments* — meshes
  directly on the pivot.
- **`reload` and `swap` were never broken.** `animProbe` equips the autogun for
  non-melee clips and the rifle's `tip` anchor sat at its own origin: a
  zero-length lever. The same reload moves 0.487m with the glaive. A correct
  animation had already been damped by a third to satisfy it.
- The strip sampler advanced **0.133s per frame, not the 0.085s it asked for**,
  because `grab()` called `renderOnce` three times and `renderOnce` steps the
  world. Short clips over-ran into their rest pose; `present` (900s) was
  sampled across 0.09% of itself.

### New image-space gates

Nine rounds of geometry asserts scored flat because the defects were never
geometric. `scripts/saintfall-picture-gates.mjs` renders, changes one thing,
renders again, and reads the difference: per-part pixel contribution across 8
bearings, figure/ground separation in dE against the exact background the
figure covers, shadow-side hue, and chroma measured **against the world's own
p99** rather than an absolute ceiling — the first cut failed the figure at C62
while the desert behind it ran past the same line and peaked at C76.

The figure-height assert is split: the **body budget stays pinned at 1.85m**
(that is what catches proportion drift) and the silhouette allowance moved from
2.02m to 2.30m, once, because the design target changed to a crested helm.

## Addendum 8 — rounds 11–12, and what the score trajectory says

Review scores across eleven rounds: **3, 2, 4, 3, 4, 4, 4, 3, 3, 4, 3.** Flat.
That is the most important fact in this document, and it is not explained by any
individual defect — several rounds fixed exactly what the previous review asked
for and scored the same or lower.

### Round 12 changes

| Change | Why | Measured |
|---|---|---|
| Verdigris moved from whole parts to a **patina term** in `paintByHeight` | Round 11 assigned the six largest shells to VERDIGRIS. The reference measures 2–8% olive on a body column; the render measured 24–41% — a bone knight rendered green | olive share 2.1%, inside the reference band |
| `normalWeight` 0.62 → 0.45, IVORY floor `#242322` → `#3a3834`, cavity trigger `n.y < -0.25` → `-0.05`, cavity 0.35 → 0.22 | Round 11's darks landed on large outward-facing plates, not junctions: the pauldron ran 37% below L30 against the reference's 9.6% | p05 luminance 10.8, darks now in undercuts |
| Blade + haft re-ramped **cool neutral** | Round 11 made both verdigris, so haft, blade and ribcage all measured the same hue and the weapon lost all separation from the body | weapon separates on hue, not just value |
| `heroCamera` marches the terrain along the camera→**feet** ray | The previous fix raised the camera to clear its own ground, which does not clear the sight line. Two rounds of "fixed" while the flagship plate still had no legs | — |

### Three lessons about the instruments

1. **A null result measured under a broken variable is not a null result.** The
   split-tone shadow tint measured as changing nothing, and a comment recorded
   that. It was only true while the broken LIFT dominated; once lift was fixed
   the tint became the main source. The comment would have sent the next round
   looking elsewhere.

2. **A one-sided gate encodes only half a target.** The olive gate started as
   `< 12%` and passed at 0.8% — effectively no patina at all, which is as wrong
   as too much. The reference gives a *band* (2–8%), so the gate is a band.

3. **Check what the test actually measures before trusting it.** The first olive
   test used `G/R > 0.85`, which flags neutral grey as olive — and the bone ramp
   is deliberately near-neutral so it separates from gold. That test demanded
   the armour be *warm* to pass a gate about it being *green*. Green dominance
   (`g > r*0.99 && g > b*1.06`) is the right measure and moved the reading from
   12.3% to 0.8% with no change to the render.

### Why the trajectory is flat

Each round the review names real defects, they get fixed and measured, and the
score does not move — because the fixes are **local and the score is holistic**.
Rounds 9–12 cleared: buried arms, violet shadows, an ankle gap, a hue collision
between gold and ivory, a rigid body with no chest pivot, a caterpillar blade, a
halo belonging to the other concept, and a figure with no dark end. All real.
None of them is the reason the figure does not read as Vesper Reliquary.

The gates now cover 12 image-space properties and 17 geometric ones, and they
are all green. That means the remaining gap is in things none of them measure:
pauldrons that are lathed domes where the reference has flat angular plates, a
lower body that tapers 3:1 where the reference is a column, a chest reliquary
that is a sunburst badge where the reference is a recessed gothic window, and
swings driven from the shoulders where the reference lunges from the feet.
Those are **modelling and animation-authoring** problems, not shading or
tuning problems, and no amount of further parameter work will reach them.

## Addendum 9 — round 13/14: pointing the loop at the actual art

Round 12's review diagnosed why thirteen rounds scored flat: **every threshold in
the gate suite was asserted in a comment, never computed from the plates**, and
three were calibrated so the concept art itself would fail them.

`scripts/saintfall-measure-reference.mjs` now measures the plates by sampling
boxes **inside named components** — no segmentation. (Segmentation was tried
first and failed; the write-up wrongly blamed bone-vs-sand ambiguity when the
real cause was rejecting pixels within 15 dE of any of ~2400 background samples.)

Measured, pooled across all components and all three v2 plates:
**L 32.3 · chroma 16.4 (p95 55.7) · a\* +7.6 · green-side share 3.31%.**
Every component is on the WARM side of neutral. Verdigris reads as patina there
because it is *less warm and less chromatic than the gold beside it* — a relative
cue — not because it is green.

Re-cut against those numbers: whole-component verdigris reverted to bone with the
patina mottle carrying it (3.2% measured vs 3.31% reference); VERDIGRIS ramp from
a\* −25/chroma 28 to a muted grey-green; shoulder pivot 0.320 → 0.212 (the render
measured 0.556 of body height against the plates' 0.374); grade saturation
1.12 → 0.88 (figure chroma p50 34.5 → 27.8); tabard widened into the bell the
cathedral plate has; gold toned from `#efc85e` to `#d8b04e`.

Gates re-derived so **the reference passes them**: taper band 1.0–1.7 (reference
1.24, render 1.23→1.11); verdigris band 1.5–7% (reference 3.31%); a new chroma
gate against the plates; and a first **absolute** width assert — every silhouette
gate had been a ratio, which is how a 1.04m shoulder span survived thirteen
rounds with `widthM` sitting unread in report.json.

**Open, honestly:** the "waist not pinched" gate still fails (0.71 against a 0.72
floor). My figure's widest lower point sits at the hem where the reference's is
at the hip, so the two are being compared at depths that do not correspond
anatomically. Widening the bell a fourth time to close a 0.01 gap would be
exactly the deformation-to-satisfy-a-number this addendum exists to record.

## Addendum 10 — round 16: the gate that was pushing the model away

Review 15 proved the mechanism behind sixteen flat rounds. `waist not pinched`
demanded waist ≥ 72% of shoulder; the traced plate measures **47%**. *The concept
art failed the gate by 1.8×*, and the model sat two points above its floor —
which is why the source comment reads "the skirt was widened three times chasing
a waist gate". The taper gate's ceiling of 1.7 likewise excluded a reference that
measures 1.8–2.3.

Rounds 13→15 each corrected the previous round's **estimator** and left the
**constants that estimator fed**.

### The rule, now enforced in code

`saintfall-picture-gates.mjs` interpolates the traced plate profile and runs it
through every silhouette predicate *before reporting anything*. A gate the art
fails is reported as **the gate being wrong**. It prints:

```
=== REFERENCE SELF-CHECK (the plate must pass its own gates) ===
  ok   waist matches the plate — plate waist/shoulder 0.52
  ok   silhouette taper matches — plate taper 1.81
  ok   mid-body width matches the plate — plate waist 16% of body height
```

### The silhouette mask is not trustworthy, and is now switched OFF

Five defects were found and fixed in this one measurement — cast shadow in the
mask, the **weapon** in the mask (`equipWeapon` re-parents onto the figure's
mount, so hiding `weapons.group` does nothing), arms counted against a
torso-core trace, the figure moving between the two captures, thresholds the art
itself failed — and it is *still* wrong. The render chain accumulates temporally,
so any two consecutive captures differ across the whole frame. The mask comes
back with empty rows at 40/62/88% of body height and rows spanning 75% and 135%
at 50/72%.

The tell was there for four edits: **the mid-body width read exactly 23% and did
not move** across changes to the tassets, arms, skirt and ribcage. A number
immune to every edit aimed at it is not measuring what its name says.

Those three gates are now `SILHOUETTE_TRUSTED = false` with the diagnosis in
place, rather than reporting green. What they need is a mask that is not a
difference at all — render the figure alone to a transparent target and read the
alpha.

### Art landed this round

Skirt rebuilt as one closed 360° cone belt-to-ground (it was two flat boards,
invisible edge-on, and no gate caught it because the profile is a median across
eight bearings); hem sawtooth ±26% → ±4%; ivory biased cool so the product with
the warm key lands near the plate's C 17 (figure chroma 27.3 → 23.8, in band);
ribcage rx 0.242 → 0.170; greaves **flared** knee→ankle instead of tapering;
crest reduced from two rails 52mm apart — a mirrored pair at any viewing
distance — to one broad ribbon; chest lantern re-ramped to a near-white core and
positioned in front of the socket face (pushing it to z 0.250 for "occlusion
depth" put it *inside* the socket and the lantern went out).

**State:** 18/18 asserts, 13/13 gates, 41/41 gameplay, build `20260806-13`.

## Addendum 11 — the score moves: 4 → 5, and the root cause that held it

After eleven consecutive reviews at 3–4, the twenty-sixth scored **5/10**. The
review that moved it did something none of the previous ones did: it measured
rendered geometry against authored values, rather than judging pictures.

### `extrudeZ` wound both end caps inside-out

`structures.js` force-normalises the profile counter-clockwise, so

```js
idx.push(0, i, i + 1);          // cap at z = -hz
idx.push(n, n + i + 1, n + i);  // cap at z = +hz
```

came out with the **same** handedness — and both the wrong one. Side walls were
always correct; only the caps faced away.

**Every extruded plate rendered one full `depth` further back than authored, and
its front face never rasterised.** A ray cast through the chest returned five
parts in a row, each reporting its *rear* cap. So every z-ordering decision in
`player.js` — every occlusion fix, every layer argument in a comment — was
reasoning about a surface the renderer does not draw. It also explains a fix that
worked for the wrong reason: moving the gold bib z 0.235 → 0.283 helped because it
pushed the *rear* cap past the keel.

It hid for twenty-five rounds because a back-facing cap is invisible while the
side walls still silhouette correctly: the part reads as present, roughly the
right colour, in roughly the right place, and passes every presence, colour and
connectedness gate in the suite.

### The shape gate was photographing the figure's back

`poseFigure(bearing, opts)` spawns with `opts.yaw ?? Math.PI`, and the silhouette
script never passed one — so the figure's forward vector was (−0.257, 0, −0.966)
against a camera at +Z. The one gate that measures shape had been comparing a
backplate to a front-view trace. Its "mean 55%" reads **22%** from the front.

### Verified wins in that review

bib 106,688px in close-up (was argued to be zero, actually ~94k — the premise was
wrong but the fix still gained 13%); sash 5.1 → **25.2 dE** from the sand; trim
clipping gone (5.1% above L72); front wedge **42.8°** measured on the built mesh;
bone plate **2.2 dE** from the reference armour value; shoulder span within
**3.5%** of the plate and arms-down within **1%**.

### Fixed since

Cap winding corrected. Silhouette camera turned around. Gold accent restored
(biases and ramp had *both* been cut when either sufficed — 7.3 dE from ivory,
42% of trim below C25). Pauldron rim mirrored like its plate. The `present` carry
rotated to roll 0.25 / yaw 0.55 so the haft hangs vertically at the figure's left
— it had been covering **75.9%** of the chest band, leaving the heart-lantern at
630px. Verdigris floor raised off near-black, removing a 6,920px hard-edged black
octagon at the armpit.

**State:** 19/19 asserts, 15/15 picture gates, 41/41 gameplay, build `20260806-60`.

## The run only looked right in a straight line

Reported from play: *"the legs move too lateral while you turn and can get
crossed over with change of direction."*

`footSlipCheck` passed the whole time, and it was measuring the right thing —
it just only ever walked forward. Turning is where this gait breaks, and
nothing turned.

### What was wrong

The landing point for a swinging foot was frozen at toe-off:

```js
const swingTravel = gait.strideLen * (1 - gait.stance);
footRest(leg, swingTravel + gait.landing, leg.target);   // in TODAY's yaw
```

That freeze was itself a fix, for a real bug — recomputing the target from the
moving body each frame made the foot chase a point retreating at walking pace,
so the leg kicked forward forever and never passed behind the hips. But what it
froze was a **straight-line extrapolation of a heading the body abandons the
moment the player turns**. A stride is up to 2.05m and the trooper turns at
better than 6 rad/s, so on a hard input the body rotates most of a right angle
inside a single swing. The foot lands a metre wide of the path actually taken,
then spends its whole stance being dragged further out — and once the body has
rotated past its bearing, that foot is on the far side of the midline and the
ankles scissor.

Nothing anywhere constrained a foot to its own side of the body.

### Measured

`scripts/saintfall-turn-gait-probe.mjs`, feet expressed in the **body frame**
rather than in world space, which is the one rotation that turns both
complaints into numbers. `maxLat` is how far a foot gets from the centreline
(the hips are ±0.115m); `minSep` is the signed left-to-right gap, and negative
means literally crossed.

| manoeuvre | maxLat | → | minSep | → | crossed frames | → |
|---|---|---|---|---|---|---|
| straight run | 0.115 | 0.115 | 0.23 | 0.23 | 0% | 0% |
| 45° arc | 0.600 | **0.200** | −0.046 | **0.169** | 2.8% | **0%** |
| hard 90° | 0.871 | **0.245** | −0.858 | **0.109** | 10.3% | **0%** |
| 180° reversal | 1.020 | **0.327** | −0.801 | **0.176** | 5.9% | **0%** |
| serpentine | 1.059 | **0.213** | −1.369 | **0.135** | 36.4% | **0%** |

A foot a **metre** out from the hips, and on alternating turns the legs crossed
for better than a third of all frames.

### The repair

Four parts, in `player.js`:

**`state.yawRate`** — the turn rate that actually happened, not the one asked
for. The damped heading makes those differ by 3× at the start of a hard turn,
and every part below reads it.

**Predict the pelvis at touchdown, and re-aim every frame.** Both obvious
schemes are wrong: chasing the current body makes the target run away, freezing
it makes the target go stale. Predicting where the body *will be* when the foot
lands does neither, because the horizon shrinks as the swing runs — a whole
swing ahead at lift-off, nowhere at touchdown. It is a constant-curvature arc
(`predictBodyAt`), which is what a damped heading actually traces, and on a
straight line it reduces exactly to the frozen point it replaces.

**A centreline guard (`uncross`).** Applied to the landing point, to the swept
path — both endpoints can be legal in their own frame and the straight line
between them still cuts the corner — and to planted feet. It *rotates* the foot
about the pelvis rather than sliding it inward, preserving reach and reading as
a sabaton pivoting on its ball, which is what a person turning in armour does.

**Shorter, quicker steps through a turn.** Not a workaround for the prediction:
you cannot take a full running stride round a tight corner, you take three
chopped ones. It caps the prediction horizon and fixes the look at once.

### Keeping the old invariant exactly

The planted guard is deliberately set **inboard** of the placement line
(`STANCE_GUARD` 0.085 vs `HIP_HALF` 0.115). Sitting them on top of each other
had a correctly planted foot creeping outward a tenth of a millimetre per frame
forever, on a straight line, because the trig that recovers a lateral offset
does not return the placement value to the last bit. With the deadband,
straight-line planted slip is **bit-exact zero** at every heading tested.

`footSlipCheck` also now discounts frames where the collider is shoving the
body sideways: a body pinned against masonry is not travelling over its foot,
and scoring those frames as slip reported *a wall* as a broken gait.

**State:** turn probe 5/5, gait proof exit 0 (ankle miss 0.0041m, stride span
1.127m unchanged), character harness 0 findings, active-play 0 errors, p50
3.5ms. Build `20260807-1`.

## Halo removed

Requested from play: remove the curved object on the back. That is the
crescent halo — the arc rising off the upper back and sweeping over the crown.

It lived in **two** places, which is the only interesting part.

**In the mesh.** Meshy's remesh welded the arc into the single skinned body and
weighted it to Spine, so nothing at runtime could unparent, hide or unlink it —
it had to come out as geometry. `strip_halo` in
`scripts/blender/saintfall-vesper-polish.py` does it, removing 1,725 vertices.

Selecting by bounding region alone would have been wrong. `world.y > 0.135 and
world.z > 1.24` — the test `deform_body_depth` already uses to avoid inflating
the halo — also covers 2,450 vertices of upper-back armour, and deleting that
opens the back of the cuirass. Selecting by **connected island** cannot punch a
hole in a surface that is still wanted: an island is either wholly removed or
wholly kept. The rule is *island lying entirely behind y 0.135 whose top reaches
above z 1.60* — the remesh leaves nothing in the y band 0.10–0.16 at head
height, so that plane separates halo from helm cleanly, and 1.60 sits above the
gorget (1.56) and below the helm crown (1.82).

The rear rail, two struts and three cross-pins that existed only to carry the
arc went with it. The yoke keystone, frame and recess stay — they are a flat
back plate, not a curve, and they are what the arc bolted through.

**In `player.js`.** A second, procedural copy: an ivory ribbon on `crestPivot`,
sitting just outboard of the welded arc and almost entirely occluded by it.
Hiding that group in a review render changed a few hundred pixels, which is why
it read as insignificant — it was not insignificant, it was *behind* something.
With the welded arc gone it would have been the only curved thing left on the
back. `crestPivot` itself is kept, empty: it is a documented review target,
the animation sways it every frame, and the helm fin mounts to it.

### A cache bug this surfaced

The model URL was built with `new URL(relative, import.meta.url)`, and that does
**not** inherit the base's query string — so while boot.js versioned every
module, the `.glb` resolved to a bare path. Every module could reload while the
browser served a cached mesh: the exact failure that makes a model edit look
like it did nothing. The build tag is now applied to the model URL too.

### Pre-existing, not caused here

`saintfall-picture-gates` reports 9/15, with the six part-contribution gates
("arms visible", "crest visible", …) failing as *1/8 angles show it*. That is
**unchanged with the halo present** — verified by restoring the previous mesh
and script and re-running. The `hideParts` difference mechanism in that harness
is measuring nothing at seven of eight bearings. Not diagnosed here.

**State:** character harness 0 findings, active-play 0 errors across all three
device profiles (p50 3.4ms, 407,308 tris), turn probe still 5/5. Model
21,732 tris / 2.80MB. Build `20260807-2`.

## Back plate, aim, and the palette

Three requests from play, in one pass.

### The back plate

The yoke keystone, frame and recess survived the halo removal on the argument
that deleting them would leave a bare patch where the eye is drawn by the
missing silhouette. In the game it read the other way round: with no arc rising
from it, a diamond boss on an otherwise clean backplate is a lump with no job,
and the eye goes to it precisely *because* nothing explains it. All three are
gone. The back is plain.

### The torso no longer owns the reticle

`carryAimYaw` was the raw `angleDelta(yaw, aimViewYaw)` — the chest tracking the
camera 1:1, unlimited. It was there for a real reason: without it the rear hand
absorbed the whole aim turn and the elbow either collapsed or pulled straight.
But unlimited follow means looking behind you spins the breastplate a half-turn
on stationary hips.

Two changes, plus a third that keeps the original problem from returning:

**Commitment gates it.** `state.aimCommit` (0..1) rises on left mouse or ADS and
decays after a 0.55s hold — the hold is what makes semi-auto usable, since
commitment keyed to the button itself would strobe the shoulders between clicks.
Free look now moves the camera and nothing else.

**The legs cover only what the spine cannot.** The naive reading of "turn the
body to the firing direction" drives `state.yaw` straight at the reticle, and
because travel follows facing in this game that quietly hijacks the stick — hold
fire on a target 20° off your path and you slew onto it. So the legs are asked
for only the excess beyond `MAX_CHEST_TWIST` (54°). Shooting at something roughly
ahead turns the torso alone and leaves the path exactly as the player set it;
shooting at something behind you turns the whole trooper, which is the case the
report was about.

**The weapon follows the same commitment.** The lance is solved onto the camera
ray and the arms are IK'd onto its grips, so removing the chest follow *without*
this would have reintroduced the exact failure the follow was added to prevent —
weapon swung behind the trooper, shoulders still forward, arms dragged straight.
Below full commitment it eases to a low-ready carry down the body's own facing.
Ballistics are untouched: shots leave along the camera ray either way, and by the
time a shot exists commitment is 1 and the shaft is on the ray.

Measured by `scripts/saintfall-aim-commit-probe.mjs`:

| | free look | firing |
|---|---|---|
| body turned, cam 70° | **0.0°** | 15.6° (leaves 54.4° twist) |
| body turned, cam 150° | **0.0°** | 95.6° (leaves 54.4° twist) |
| chest twist, any bearing | **0.0°** | never over 54.4° |

Running and firing at once: minimum lateral foot separation 0.139m (no crossing),
peak twist 12.3°, zero non-finite foot reads.

### White and gold

The Meshy atlas is ivory plate, sage verdigris, amber trim and near-black
recesses. A flat luminance duotone is the obvious remap and the wrong one — it
pushes *everything* gold, including the plate, and the figure loses the
plate/trim distinction that carries its whole read. What separates those families
in the source is not luminance, it is **saturation**.

So the remap splits on saturation and leaves luminance alone on both sides:
neutral pixels become warm greys, saturated pixels land on a three-stop gold ramp
at the luminance they already had. Every panel line, chip and dirt pass survives,
because none of it touches local contrast. The four authored materials moved to
the same two families.

The threshold is the whole read. At 0.10–0.26 it caught the ivory itself — Meshy's
plate carries a warm dirt pass — and the trooper came out gold helm to sabaton
with white only in the greaves. At 0.26–0.46 it clears the dirtied plate and
admits only the verdigris and the amber. Green went 15.2% → 0.3% of the atlas.

### Two gates that had to change

**`fireWeapon` was not firing.** It called `weapons.fire()` directly and never
touched `input.state.firing`, so the profile that exists to run real gameplay was
the one harness never exercising the body turn, the chest twist or the committed
weapon solve. It now holds the button.

**"verdigris has not vanished" is inverted.** That gate was right to exist — the
patina had twice been desaturated to nothing by other gates chasing chroma. But
the brief removed the verdigris on purpose, so the floor fails for exactly the
reason the work succeeded. Lowering its threshold would have left a green-floor
gate quietly guarding a palette with no green in it. Same measurement, same call
site, opposite direction: green must now stay absent.

**State:** picture gates 9/15 — the same six part-contribution gates that were
already failing before any of this work (verified by restoring the previous mesh
and script), every colour gate passing. character 0 findings · active-play 0
errors, p50 3.6ms · weapon-gait-proof exit 0 · turn-gait 5/5 · aim-commit probe
all claims hold. Model 21,552 tris / 2.76MB. Build `20260808-1`.

## Back remnant, the grey, and the hands

### The halo strip had missed most of itself

The first strip rule was *behind y 0.135 **and** topping out above z 1.60*, and
the height half was wrong. The arc is not one island — Meshy's remesh shattered
it into ~240 — and most fragments top out between z 1.45 and 1.60. They failed
the z test, survived, and left a curved blade standing off the left shoulder:
the artefact the strip existed to remove, reported again from play.

Depth alone separates them. The back plate reaches y 0.134 at its furthest;
every fragment of the arc starts at y 0.160. A plane at y 0.150 splits them with
16mm of clearance either side and needs no help from height. 1,725 → **2,376**
vertices removed. The yoke keystone went too — with no arc rising from it, a
diamond boss on a clean backplate is a lump with no job.

### "Less grey" was three separate mistakes, and two fixes made it worse

**The tint was proportional to brightness.** The white family was
`luminance × [1.0, 0.984, 0.945]`, so the warmth scaled with the light and
vanished exactly where it was needed — every recess and the whole shadow side
stayed dead neutral. Warmth has to be strongest in the darks.

Replacing it with a three-stop ivory ramp fixed the hue and broke the value: a
curve through a mid at `0xd6ccb4` sits far above a linear response, so
everything below the midpoint came out roughly twice as bright. The plate's 5th
percentile luminance went **11 → 17**, and an armour whose junctions have lifted
out of shadow has stopped being armour. Chasing it by darkening the ramp floors
(17 → 15.4) and then the recess material (no change) missed the point twice.

The fix is to let the pass do only its own job: **hue from the ramp, value from
the source.** Each ramp sample is renormalised back onto the source luminance,
so every chip and panel line keeps exactly the value Meshy painted it. p05
returned to **11.2**, the pre-existing number.

The readability fill was the third: `0x101a32`, a blue, chosen when the armour
was ivory and verdigris. On a white-and-gold figure a cold fill lands in the
darks and turns every shadowed panel grey. Re-hued warm — and matched in
*luminance*, because the first warm value was 26% brighter and that 26% landed
straight on the darkest 5%.

### The right arm was a hand parked where an arm cannot go

Not a bad pole vector. The rear grip sat at 0.255 of the haft, which with the
side carry put it **0.37m behind the shoulder** — so the trigger arm reached
backwards past the ribs and the elbow finished above the wrist with the forearm
swung out sideways. 0.19 → 0.145 of the haft puts that hand beside the hip, and
the elbow drops under the wrist on its own. Both arms now sit at ~88% reach with
~123° elbows, against 96%/148° mid-way through the tuning.

### The hands could not have gripped anything

The rig has **no finger bones** — only `LeftHand` and `RightHand` — so the
fingers are frozen straight and 0.21m long. The old solve aimed the bone's local
+Y at the grip, which points the *fingers* at the haft and, since they are
longer than the 0.116m inset, pushes them 9cm through and past it. That is the
open hand hanging off the pole in every review shot.

Rebuilt around the palm: fingers laid **along** the shaft, where the same rigid
digits sit inside the haft's own line instead of projecting a hand's width out
of the silhouette; palm seated on the haft using measurements taken off the skin
weights (0.117m to the posed centroid, 0.055m off the face) rather than assumed.

That removed a 0.116m shoulder-ward inset every pose had been spending as reach
margin. The carry absorbed it; melee3's contact frame did not — both arms hit 0%
slack and the gauntlets finished 11cm off the grips at the moment of impact.
Two attempts made it worse: clamping the wrist into the reachable annulus traded
a locked arm for a *more* detached hand (10.7 → 11.5cm), and retuning the
choreography moved the wrong axis. The actual cause was the existing two-hand
reach constraint, which still credited the inset it no longer got. Removing the
credit fixed it with the authored swing untouched: **0.107 → 0.065m**.

### Gates retargeted, not relaxed

Seven `armPoseCheck` windows were centimetre-wide bands drawn around the old
pose. They now state the anatomy they protect — elbows bent but neither locked
nor folded, the trigger elbow tucked and under the shoulder, both hands on the
haft with real slack. `triggerWristBehindElbow` is replaced by
`triggerWristBelowElbow`: the old one asked for the backwards rake that *was*
the defect; wrist-above-elbow is the chicken wing worth gating.

The palm-contact ceiling moved 0.025 → 0.075m and became one constant. A hand
holding a pole has its centroid about half a gauntlet off the pole's axis; 0.025
asks for the centroid to sit on the grip point, achievable only with the haft
passing through the middle of the hand — which is exactly the pose it had been
passing. There were two copies of that literal and only one was found first time.

`armReachCheck`'s wrist goal was rederived from the live figure: it still
described the old placement rule and was reporting a 9cm miss on a wrist that
was exactly where it belonged.

**State:** picture gates 9/15 — the same six part-contribution gates failing
since before any of this work, every colour and value gate passing (p05 11.2,
green 0.5%). weapon-gait-proof, character, active-play, turn-gait, aim-commit
and vesper-review all exit 0. Model 21,064 tris / 2.72MB. Build `20260808-2`.

## Crown fragments, a melee key, and slinging the lance

### The thing above the head

Six islands, 74 vertices, sitting at y 0.143–0.159 — a hair *inboard* of the
y 0.150 depth plane, so the halo strip spared every one of them. They are 20cm
clear of the helm, which ends at z 1.801, and with the arc that used to join
them gone they simply hung in the air over the head.

Height alone is decisive now: the helm **is** the top of the figure, so any
island lying wholly above z 1.86 goes. 2,376 → **2,450** vertices stripped.

### Melee is an action, not a mode

`KeyX` was "swap", which toggled the lance between its ranged and melee rites
and left you in whichever one you last chose — so a melee needed two presses and
a mental note about which mode you were in, and forgetting cost you the fight.

Now one key, one swing: `meleeStrike` borrows the melee rite, plays the combo,
and hands it back when the action clears. The rite is returned on the *action*
ending rather than on `meleeSwing`'s result, because that returns false for a
buffered combo chain as well as for a refusal — returning it there dropped the
player out of melee mid-combo. The trigger now only ever fires; mapping melee
onto it as well meant holding fire through a swing chained a combo nobody asked
for.

**V, not the requested Q** — Q is the stratagem pad and holds the arrow-key code
entry. Say the word and I'll move stratagems and give melee the Q.

### Sheathing

`stowWant` is what the game asks for; `stow` is where the animation has got to.
Keeping them apart is what makes it an animation rather than a teleport, and it
lets the draw be quicker than the sheathe — 0.42s out, 0.85s away. A weapon that
comes out as slowly as it goes away feels like a menu.

Both poses are transforms in the chest mount's own space, so nothing is
reparented and every anchor — grips, muzzle, tip, butt — keeps working
throughout. Idle 6s with nothing within 42m and it goes on the back; firing,
aiming, reloading, a melee, taking a hit or anything appearing inside that
radius brings it straight back. Fire and melee are *refused* while it is in
transit, because a shot that leaves a lance slung on the trooper's back is worse
than a 0.4s draw.

Three things this took a wrong turn on first:

**The rotation.** Mount space is quarter-turned and the shaft lies along the
weapon's local +X, so stowing it is the rotation that carries +X onto a back
diagonal — which under Euler XYZ needs `z = π/2`. The first attempt used
`z = 1.02` as a "roll", which is not what Z does here, and left a 2.3m lance
lying horizontally through the ribcage and 1.5m out in front.

**The ordering.** With the rotation right, the pose *still* came out fore/aft:
the aim solve runs after the carry transform and rotates the shaft onto the
camera ray about the front grip, so it was picking the lance straight back up
again. Zeroing the aim commit while stowed was not enough — zero commit still
solves the shaft onto the low-ready direction. The stowed pose is not a kind of
aiming, so the blend had to move outside that solve entirely.

**Letting go too early.** Releasing the hands from stow 0.18 had them back at
the hips by the time the lance was a third of the way over, so it spent most of
the animation flying to the trooper's back on its own. From 0.34 the arms
visibly lift it over the shoulder and let go near the top of the arc.

The bulge term is what keeps it off the body: a straight interpolation between
"held at the hip" and "slung across the back" passes the haft through the
ribcage, because that is the short way round. `sin(πt)` peaks mid-travel and
vanishes at both ends.

### Harnesses had to be told which pose they were grading

`weapon-gait-proof` stands the trooper still for minutes measuring the carry
pose — the exact condition that sheathes the lance. Left alone, every
hand-on-grip metric became the distance to a weapon slung on the back:
**0.862m** against a 0.075m gate. That is not a bug in the sheathe, it is a
harness measuring the wrong pose, so the harness gets `autoStow(false)` to say
which pose it wants rather than the feature getting a special case. Applied to
`weapon-gait-proof`, `vesper-review` and `picture-gates`.

The new `saintfall-stow-melee-probe` covers what no still frame can: that the
sheathe *travels* rather than teleporting, that the hands release across the
middle of it, that the draw is quicker than the sheathe, that a threat keeps it
drawn, and that the melee key does not leave the player stuck in the melee rite.
Its first run reported the melee key doing nothing — because the threat case ran
first and its thresher had spent twelve seconds killing the player, after which
`meleeStrike`'s dead check refused every press. The threat case now runs last.

**State:** stow-melee probe, weapon-gait-proof, character, active-play,
turn-gait, aim-commit and vesper-review all exit 0. Picture gates 9/15 — the
same six part-contribution gates failing since before this work. Model 20,993
tris / 2.71MB. Build `20260808-3`.

**Unresolved:** active-play's p50 has moved from ~3.5ms earlier in this session
to ~8ms, consistently and across all three device profiles. The gate (p95 <
16.67ms) still passes with margin. Disabling the new stow tick changes nothing,
draw calls and triangle counts are unchanged, and it did not move at any single
edit — so it is unattributed, and may be host load after a long run of GPU
sessions. Worth a clean-machine re-measure before trusting the number either way.

## The slung lance was floating, and the arms were bolted on

### Floating

Measured, not eyeballed: butt at fore −0.148, tip at fore −0.687. The shaft was
not standing off the back, it was *hinged* away from it — 0.54m of lean over its
own length.

The cause is that at `z = π/2` exactly the shaft has no fore/aft component **in
mount space**, and the mount hangs off the chest, which is raked forward. The
lance was faithfully inheriting that rake. Backing z off the quarter turn by
0.228rad re-introduces just enough mount-space forward lean to cancel the
chest's, and the shaft now lies parallel to the back: butt −0.247, tip −0.257,
a consistent 0.25m stand-off along its whole length instead of a hinge.

### Bolted on

The empty-handed pose was one fixed point per arm, so a trooper with the lance
on his back ran the whole way to the next objective with both arms welded to his
hips. Arms swinging is most of what makes a walk read as a walk — from the front
it is the *only* part of the body that shows the cadence.

`restArmTarget` drives them off `state.gait`, the same distance-integrated cycle
the legs use, so the swing cannot drift out of step with the feet at any speed
or on any slope. `legs[0]` is the trooper's anatomical right leg (the controller
indexes limbs by spatial side) while `armPivots[0]` is the left arm, so index
against index is already the correct cross-body pairing and needs no phase
offset. Amplitude starts at zero, so standing still is a hang rather than a
swing; the elbow pole follows the stroke so the arm keeps a soft bend instead of
locking; the hand lifts slightly on the forward stroke, without which the arm
reads as a pendulum bolted to a shoulder.

The same function serves the no-weapon branch, the fully-slung case and the
mid-sheathe blend, so a hand let go of the grips arrives at a *moving* rest pose
rather than a parked one.

Measured over a stride: **0.495m** of hand travel on both arms, **100%** of
frames in antiphase, hands riding at **0.925m** — hip height, not up at a grip.

### Two harness notes

`poseFigure` cannot be used to photograph a run: it respawns the player, which
resets the position and the very gait cycle being sampled, and produced four
identical "phases". Nor can a hand-placed free camera be trusted here — three of
four attempts put it inside a dune. The chase rig already solves terrain
clearance, which is exactly the problem, so the run sheet is shot through it.

**State:** stow-melee probe, weapon-gait-proof, character, active-play,
turn-gait, aim-commit and vesper-review all exit 0. Picture gates 9/15 — the
same six part-contribution gates failing since before this work. Build
`20260808-4`.

## Bolting the pack, the lance and the trooper into one mass

Three objects floating near each other. Measured, in body space: the pack's
front face at fore −0.182 against a back surface that runs −0.10 to −0.159, and
the slung lance 110mm clear of the nearest thing on the pack.

### The gap could not be closed by moving the pack

The engine's front face is a single plane; the back is not. The spine stands
35mm off that plane at mid-back and falls away to 110mm at the shoulder blades
and the small of the back. Any single pack position either floats at the ends or
cuts through the middle — which is why the gap existed.

`dorsalSaddleGeometry` is the piece that resolves it: eleven rings, each a
height measured off the posed skin with its front face 10mm short of it,
**lofted** between rings. Stacking chamfered slabs was tried first and cannot
work — to leave no seam the slabs must overlap in height, and an overlapping
slab carries its own depth into its neighbour's band, so the deep one at the
small of the back reached 38mm through the cuirass. Interpolating between rings
gives exactly the measured profile at every height and never overhangs.
Clearance is now 8–10mm at every band, and it holds through the travel lean, the
landing compression and the crouch because pack and back both ride the chest
bone.

### The lance position is a search, not a calculation

The wing it has to clear moves in a different direction in each state: folded it
reaches outboard to x −0.359, deployed it sweeps rearward and inboard. Pulling
the lance in laterally tightens the folded case; pushing it back tightens the
deployed one. Three hand-picked values landed 110mm, 7mm and 2mm — each fixing
one state at the other's expense.

Two measurement mistakes cost most of that:

**Bounding boxes are useless here.** Comparing the wing's box to the lance's said
18mm when the true closest approach was 110mm — the box extremes sit on vertices
nowhere near the lance, so it was comparing two unrelated points. Only
segment-to-vertex distance over every mesh answers this.

**`setJetpackState` does not deploy the wings.** It writes fields the module
recomputes from its own state machine every frame, so it reported `pose: 0` and
two rounds of "folded vs wings out" renders were the folded pose photographed
twice. Deploying means actually flying — and pressing the KEYS, because `poll()`
rebuilds `state.jump`/`sprint` from the key set every frame and assigning the
state directly is overwritten before the controller sees it.

With `setStowPose` added to sweep a grid instead of guessing, x −0.492 / z 0.270
is the tightest position with clearance in both states: **23mm folded, 23mm
deployed**, against 110mm before.

**State:** stow-melee probe, weapon-gait-proof, character, active-play,
turn-gait, aim-commit and vesper-review all exit 0. Picture gates 10/15. Build
`20260809-3`.

## The hands were twisted, and the gap needed a shell

### Both palms face local −Z

`HAND_PALM_SIGN = [1, -1]` was a guess — that mirroring the meshes in X must flip
the palm too. It does not. Measured off the skin weights: on **both** hands the
thumb cluster sits toward local −Z and the fingertips curl the same way, so the
palm is −Z and the back of the hand +Z on each. The consequence of the guess was
the trigger hand gripping the haft with the *back* of its hand, which reads as a
wrist snapped through 180° and was reported from play as exactly that. There is
one convention, not two.

### A free wrist has to be authored

`solveRestArm` copied the hand's **bind** quaternion — its rotation relative to
the FOREARM. The forearm has just been rotated by the IK, by however much it
took to reach the hand target, so the hand inherited the solver's roll and hung
off the thigh twisted. Nothing about a hanging arm depends on how the elbow got
there: the fingers follow the forearm down and the back of the hand faces
outboard. Built in world space now, and the same helper feeds the mid-sheathe
blend, which had the identical bug.

### The gap took four shapes to close

1. **Stacked slabs.** To leave no seam they must overlap in height, and an
   overlapping slab carries its own depth into its neighbour's band — the deep
   one reached 38mm through the cuirass.
2. **A 1-D loft**, contoured in height only. Closed the gap seen from directly
   behind and did nothing in profile, because from the side you see straight
   past a narrow plate's edges — and profile is the view it was reported from.
3. **The same loft, widened.** 72 of its 492 vertices ended up inside the
   armour, as deep as 123mm: the back bulges at the blades and the depth had
   been measured down the spine.
4. **A shell contoured on both axes**, from a raycast depth grid — seven columns
   by twenty-one rows, per-cell minimum across standing, walking, sprinting and
   crouching, 12mm clearance subtracted. Then **eroded** with a 3×3 minimum
   filter: the per-pose minimum leaves cliffs where one pose had an arm close in
   (the centre column drops 14cm over 8cm of height), and a surface lofted
   through those reads as a stack of fins out of the shoulder. Erosion smooths
   them without ever making the shell deeper than something measured.

Two measurement lessons worth keeping. **Vertex sampling kept picking up the
arms** — a |x| ≤ 0.20 band reported the "back" 12cm behind where it is, because
a forearm was in it; raycasting is immune. And **an inside/outside test by
hit-or-normal is unreliable here**: a rearward ray also meets the cloth hanging
off the trooper's back, and that cloth is a thin sheet whose outward normal
points the same way as the ray, so both the naive test and the face-normal
refinement reported ~100 pierced vertices for a shell that touches nothing. The
construction guarantee — front face = measured min-across-poses minus 12mm — is
the load-bearing argument, and the verification is visual.

**State:** stow-melee probe, weapon-gait-proof, character, active-play,
turn-gait, aim-commit and vesper-review all exit 0. Picture gates 10/15. Build
`20260809-4`.

## The saddle was the wrong answer

Reported: the object on the back had just been *lengthened*, and the wings still
were not closer. Correct on both counts — the saddle was a plate filling the
space where the wings were not, rather than the wings being where they should
be. Removed, and the wing hinges moved forward instead (pack-local z −0.075 →
−0.042). Closest wing-to-body approach: 21mm → 3mm standing, 17mm walking, 16mm
crouching.

Worth recording: the hinge z barely moves the *standing* minimum (3mm at both
−0.018 and −0.042), because the binding contact there is a root fairing that
does not travel with the hinge. Only the fan moves, which is the part that was
visibly floating.

## The hold, as specified

Right hand over the haft with the palm turned down and inboard; left hand
underneath with the palm up. Previously both hands approached from the same
side, which is what made the grip read as two blocks laid on a pole.

`handZ` is now the PALM direction and points AT the haft from wherever each hand
sits, so the two mirror each other instead of stacking. At rest the same axis
points inboard, toward the leg.

Changing the hold moved the geometry underneath it, and three things had to
follow:

**The support arm locked straight.** Seating that hand *under* the haft drops
its wrist 55mm, and it already crossed the chest at 92% of its reach — the extra
put it at 100% and the elbow at 178°. Shortening the span barely helped
(178.1 → 178.0): the demand was never the span, it was that the grip sat at hip
height, 0.39m below its own shoulder. Raising the carry 115mm and bringing it
20mm inboard restored it to 128° at 90%.

**The trigger elbow.** Gripping over the top rolls the forearm, and the old
down-and-back pole swung the elbow 0.16m clear of the shoulder. The inboard
term needed to fix that is sharply non-linear — at +1.0 the elbow crossed the
sternum entirely, 0.18m the *far* side of the shoulder, which is the opposite
fault and the one that pole was originally written to prevent. Bracketed rather
than solved: −0.16 lands it 0.066m under the shoulder.

**Five gate windows.** `triggerElbowBehindShoulder` (≥0.17) described a rear
hand reaching back along the body; over the top the elbow hangs *under* the
shoulder, so it becomes "has not swung in front". `triggerWristBelowElbow` —
itself the fix for a chicken wing on the previous hold — becomes
`triggerForearmNotRaised`, because an over-the-top grip makes the forearm level
by construction. The elbow-bend and reach-slack bands widen for a hand that
folds tighter, and the aim sweep's 80% reach floor comes down to 58% for the
same reason. The support-grip baseline is re-pinned with the carry.

**State:** weapon-gait-proof, vesper-review, stow-melee probe, character,
active-play, turn-gait and aim-commit all exit 0. Picture gates 9/15 — the six
part-contribution gates that have failed since before this work. Build
`20260809-5`.

## The pack was never near the trooper, and I had measured it wrong

Reported again: still too much space, arms still wrong. Both true, and the pack
half was my own bad measurement.

A **per-node sweep at full resolution** — every vertex of every pack mesh
against every second skin vertex — put the CLOSEST part of the pack **122mm**
off the back and the farthest at 212mm. The earlier probe that reported 3mm
sampled 60 points per mesh and every 7th skin vertex; it simply never sampled
the two points that mattered, and reported a contact that did not exist. Two
rounds of work were spent respecting it: the wing hinges were nudged in
millimetres, and a whole contoured shell was built to bridge a gap the pack
could just have been moved across.

With the real number, the pack moved 0.10m forward in one edit. Clearance now
runs 18–40mm at the nearest feather across standing, walking and sprinting, and
8mm crouched — crouch being the binding pose, since the spine folds and the back
comes to meet the pack.

**The lesson is about sampling, not about the pack.** A minimum-distance probe
that strides its inputs is not a conservative estimate — it is an arbitrary one,
and it errs in the direction that hides collisions.

## The support arm sets the carry, not the other way round

Every attempt to place the lance by eye ran into the same wall: the support hand
crosses the chest to the far side, its arm is 0.629m, and the grip kept landing
0.56m from that shoulder. Raising the carry fixed it and made the hold look
clutched to the chest; pushing it forward opened the pose and locked the arm
again at 96%.

Solving it as geometry instead — what grip position sits ~0.50m from a shoulder
at (0.173, 1.417, 0.077) — gives the carry directly: 50mm forward, 33mm up,
47mm inboard of where it was. Support arm 117° at 86%, trigger 75° at 61%.

**The trigger elbow does not move continuously.** With the hand over the haft
its circle has two reachable arcs and it snaps between them: every pole x at or
above +0.10 puts the elbow across the sternum at x +0.05, every one at or below
−0.25 puts it outboard and behind at −0.40. Nothing lands it under the shoulder,
because the circle does not pass there. Outboard-and-behind is the correct
half — it is where an elbow goes when the hand is over a haft held at the hip —
so the pole picks that arc deliberately rather than fighting for a pose the
linkage cannot reach.

> **Superseded — this was the symptom, and the reading of it was wrong.** The
> elbow circle is perfectly continuous. What was bistable was a pole lying
> almost along the arm; see the next section.

Four more windows retargeted with the carry: the cross-chest distance (shorter
by design), the support-grip baseline (re-pinned), the trigger elbow's lateral
band, and `triggerElbowCloseToRibs` → `triggerElbowNotFlared`, which no longer
demands 0.08m from a linkage whose nearest reachable point is 0.25m.

**State:** weapon-gait-proof, vesper-review, stow-melee probe, character,
active-play, turn-gait and aim-commit all exit 0. Picture gates 9/15. Build
`20260809-6`.

## The elbow was not bistable — its pole was 8.9° off the arm

Reported: the arms read correctly with the reticle forward and the elbows turn
inside-out at other bearings, with a screenshot of an inverted right elbow.

A pole vector only chooses the elbow's swivel to the extent that it is SQUARE to
the shoulder-wrist line. Whatever component runs *along* that line cancels in
`cross(dir, pole)` and decides nothing. Instrumenting the solve with
`perp = 1 − |pole · armAxis|` gave the whole story in one number:

| arm | authored pole | perp |
|---|---|---|
| support | (0.164, −0.383, 0.911) | 0.60–0.69 |
| trigger | (−0.213, −0.810, −0.528) | **0.012** |

The trigger pole sat 8.9° off the arm. **98.8% of it was cancelling**, and the
elbow was being placed by the 1.2% that survived — which is to say by rounding
noise. It span freely and flipped whenever the residual changed sign. The
support pole pointed forward, stayed square to a hanging arm, and never
misbehaved; that split across the two arms was the tell, and it was visible in
the authored constants the whole time.

The fix is not a better solver. Because a pole solver puts the elbow in the
half-plane of (armAxis, pole), **the elbow's own perpendicular offset IS the
pole that would have produced it** — so the pose that already looked right at
the forward reticle could be measured and read back as a pole
(`saintfall-elbow-pole-calibrate.mjs`). Same pose, stated in terms the solver
can act on:

    support   (0.18, −0.42, 1.0)     ->  (0.438, −0.146, 0.887)
    trigger   (−0.25, −0.95, −0.62)  ->  (−0.929, −0.223, 0.294)

Both are close to horizontal, because that is what "square to a hanging arm"
means. Worst neighbour jump over 432 bearings went **552mm → 86mm** (limit 110),
and `perp` **0.012 → 0.765** (floor 0.45).

**A guard inside the solver made it worse.** The first attempt faded to a
perpendicular taken from the joint's own frame when the pole degenerated — but
that frame is last frame's solve, so the elbow drove itself, and the sweep went
from 158 failures to 158 failures. It is gone. `solveTwoJoint` now projects the
pole and bails rather than inventing an axis: callers must supply a pole that is
not parallel to the limb, and the sweep reports `perp` so that stays true.

### Three of the four "failures" the sweep found were the sweep

Worth recording, because each looked exactly like the bug:

- **World-space measurement.** Committing to a bearing turns the whole trooper,
  so a world-space elbow legitimately travels metres across a yaw sweep. 146
  "jumps" were the body rotating. Measure in the body frame.
- **Sampling a body still in motion.** The trooper turns at a capped rate, and a
  fixed 40-frame settle photographed it mid-turn, lagging the sweep by a bearing
  or two. Settle to convergence.
- **Comparing across the chest-twist hysteresis.** The chest absorbs up to
  `MAX_CHEST_TWIST` before the legs come round, so where the body stands depends
  on which way the aim arrived. Yaw −180 and +170 are neighbours in bearing and
  not in history; comparing them measured 400mm of working hysteresis. The two
  ends of a row are no longer compared.

## Putting the shot back on screen

Reported: the gun feels weak, impacts on the target are small, and the shots are
invisible in the air.

The last is a fact about the design rather than a bug in it — fire is hitscan,
resolved to a ray and a damage number in the frame the trigger is pulled, so
there was never anything in flight to see. Four additions, at both ends of the
shot:

- **Bolt** (`vfx.tracer`) — a quad stretched along the flight line and turned to
  face the camera, launched with the distance the ray actually reached so it
  stops at what the shot stopped at. Its width is floored as it turns end-on,
  because firing away from a chase camera is the view the player is in almost
  all the time and an honest `|cross|` collapse would hide the bolt in exactly
  that case.
- **Muzzle** — the reliquary lamp was lit at a constant 0.62 over a 2.1m radius
  and did nothing when the weapon fired. It now spikes to 6.6 over 9m and decays
  linearly over 60ms. This is the part that lights the trooper and the ground
  rather than adding a bright sprite in front of them.
- **Impact** — 9 particles became 26 with a flash card over them. At the far end
  of a 300m shot the flash is what survives the distance.
- **Camera** — a shove, `player.punch()`, confined to eye position, roll about
  the view axis, and field of view. **Not yaw or pitch:** shots leave along the
  camera ray and `aimViewYaw`/`aimViewPitch` feed the shoulder follow, so a
  shake that turned the camera would walk the player's own aim off target. The
  gate measures 0.0000° of drift across a 41-shot burst.

The chase spring also had to be given its own anchor. `lookAt` aims from
wherever the camera stands at a point fixed over the trooper's head, so lerping
the camera from its own shaken position turned the shake into 0.27°/burst of aim
drift on the very next frame.

`fireWeapon` in the QA surface called `weapons.fire()`, which spends a round and
kicks the weapon and produces no bolt, no flash and no shove — every probe that
"fired" was photographing a gun that had not gone off. It now goes through the
game's own `shoot()`.

**State:** elbow sweep (432 bearings), fire-feel, weapon-gait-proof, stow-melee,
vesper-review and active-play all exit 0. Reticle shaft error still 0.000°.
Build `20260809-7`.

## The inversion the bearing sweep could not see

Reported again, with a screenshot: elbow still inverting. The bearing sweep was
passing on 432 samples, so it was measuring the wrong thing — and the screenshot
said which. The lance in it is angled down and out to the trooper's right, which
is not any settled carry position. It is the lance **part way to his back**.

Two regimes were never swept, and both were wrong:

**Low ready.** `carryAimYaw` carries `aimCommit`; `carryAimPitch` did not. So
when the trooper is not committed — lance eased back to the body's own facing,
ignoring the reticle — the elbow pole kept swinging with the camera anyway. The
pole leans toward the arm it is meant to be square to: trigger conditioning
0.369 at low ready against 0.765 committed. `rotateCarryVector` now gates the
pitch by the same commitment the weapon uses. The chest keeps the ungated lean;
that is deliberate and is not what the arms solve against.

**The sheathe.** The elbow pole is blended from the carry pole to the rest pole
as the hands let go. The carry pole is near horizontal, the rest pole points
down and back — so **half way between them the pole aims down the hanging arm**.
The blend manufactured the exact degeneracy the calibrated poles were chosen to
avoid, with both ends of the blend perfectly sound, which is precisely why
sweeping settled bearings found nothing. Trigger conditioning hit **0.149**, in
172 of 306 samples.

The fix is structural rather than another set of numbers. Both poles are
**flattened into the plane the elbow actually turns in**, and the blend is a
**rotation about the arm** instead of a straight line at it. That plane is
closed under rotation about its own normal, so every intermediate pole is
perpendicular by construction — there is no middle left to get wrong.

Flattening changes **no settled pose at all**: only the perpendicular part of a
pole ever decided anything, so restating it in that plane is a no-op for the
solver. `weapon-gait-proof` returns byte-identical numbers before and after,
which is the check that says so.

**The gate had to change with it.** `perp` used to describe what the solver
received; now the solver always receives a perpendicular pole, so a floor on it
would only prove that `flattenPole` works. Both sweeps now gate the **surviving
pole length**, `sqrt(1 − (pole·armAxis)²)` — how much of the authored pole is
left after being made square:

| | surviving length |
|---|---|
| the trigger pole that inverted at every off-forward aim | 0.154 |
| the blended pole half way through the sheathe | 0.525 |
| worst case now | **0.777** |

Floor set at 0.55, between the failures and the fix rather than just under the
current numbers.

`saintfall-elbow-sweep.mjs` now sweeps both carry regimes (864 samples, worst
jump 85mm against a 110mm limit). `saintfall-elbow-stow-sweep.mjs` is new and
walks the sheathe in 2% steps at three bearings in both regimes.

## The bolt is a slug, not a streak

Asked for: more of an energy-based projectile.

A tracer is a hot smear left by something already gone. A censer-lance throws a
discrete slug of light you can watch travel and lead a target with, so: **150m/s**
instead of 260 (a quarter second across a 40m firefight), a teardrop profile
with a rounded head tapering into its wake, a tight white-hot core inside a wide
saturated halo — the gradient running *across* the bolt rather than along it,
which is what separates a glowing object from a warm smear — and a little
flicker along its length so it does not read as extruded geometry.

**Length is legibility.** Cutting the wake to 4.2m for a cleaner slug shape made
it a few pixels forty metres out, which is the invisible-in-flight complaint
again with better geometry. Back to 7.5m at 0.235m wide. Firing away from a
chase camera is the worst case for seeing a projectile — foreshortened, and the
trooper occludes the first few metres — so the contact sheet shoots a *ladder*
at 5m, 10m and 20m rather than guessing one moment.

**State:** both elbow sweeps, fire-feel, weapon-gait-proof (identical numbers),
stow-melee and active-play all exit 0. Build `20260809-8`.

## The elbow was never bending backwards — it was in the wrong place

Reported a third time, as permanently inverted. It was not a regression from the
blend fix, and it was not a hinge going the wrong way. Measuring the joints in
the trooper's own frame (`saintfall-arm-anatomy.mjs`, new) said it plainly:

    trigger shoulder  r 0.17  u 1.48
    trigger elbow     r 0.45  u 1.32

**29cm further out than the shoulder and only 16cm below it** — flared at
shoulder height with the hand tucked back at chest level. A chicken wing. Not a
bend the wrong way; an elbow somewhere an elbow does not go.

It survived three rounds of review because **every gate here measured whether
the arms moved smoothly** — continuity across 864 bearings, pole conditioning,
no jumps through the sheathe — and not one of them asked where the elbow
actually was. Worse, `triggerElbowNotFlared` had been *loosened* to 0.28 earlier
in this same milestone, on the since-disproved claim that the elbow circle
"snaps between crossing the sternum and sitting outboard-and-behind" and could
not reach anything under the shoulder. The gate had been told to accept the
defect.

Sweeping the pole right round the circle shows it is perfectly continuous, in
even steps, with the elbow angle and the reach unchanged the whole way:

| pole | drop | outboard | vs shoulder |
|---|---|---|---|
| fully outboard | 12cm | 30cm | 6cm behind |
| *previous* | 16cm | 29cm | 2cm behind |
| **chosen** | **25cm** | **21cm** | 4cm in front |
| fully down | 32cm | 0cm | 9cm in front |

**There is a real constraint, just not the one that was claimed.** The elbow
rides a circle about the shoulder-wrist axis, so drop and fore-aft are not
independent — past about 25cm of drop the elbow leads the shoulder, which is its
own defect and is what `triggerElbowNotInFront` exists to catch. Where that
circle sits is set by the rear grip, 18cm behind the shoulder at chest height.
**Getting the elbow lower than 25cm means moving the grip, not the pole.**

Gates re-tightened rather than re-loosened: `triggerElbowNotFlared` 0.28 → 0.235,
`triggerElbowLower` floor 0.15 → 0.22. `weapon-gait-proof` also names its failing
checks now instead of printing "FAIL" and sending the reader into qa.js.

`saintfall-lowready-arms.mjs` (new) is the turntable that was supposed to be
impossible: the MAX_CHEST_TWIST lock only exists while committed, so at low ready
the chase camera orbits the trooper freely. Its close pass crops around the
joints **projected through the camera that took the frame** — two earlier passes
cropped to a hand-guessed rectangle and photographed the pauldron while the elbow
sat outside the crop, which is how a change that moved the elbow 15cm produced
two identical-looking contact sheets.

## Energy, not ordnance

**In flight.** The bolt is one quad, and against open sky a clean object is also
a small one with nothing around it to say how fast or how far it went. It now
sheds embers, counted off the distance it travels — and each is given a birth in
the FUTURE so it lights as the slug reaches it. Dumped at the muzzle in a single
frame they would look identical in any screenshot and completely wrong in
motion, so the gate reads the pool rather than photographing it: 14 embers
scheduled ahead of a 300m shot, the furthest 2.0s out.

**The report.** What made the old shot kinetic was its structure, not its
brightness: a broadband noise crack through a bandpass over a sawtooth thump —
the primer and the action, something mechanical happening to a solid object. No
level makes that electric. It is now tonal and moving: a sawtooth swept
1180→120Hz through a resonant lowpass tracking it (the tracking is the whole
"pew"), a bright triangle arc above, a narrow noise sizzle for texture rather
than weight, and a sine sub for the shove. The distant tail rings in a narrow
resonant band instead of thudding through a lowpass.

**State:** both elbow sweeps, fire-feel, weapon-gait-proof, stow-melee and
active-play all exit 0. p50 3.4ms. Build `20260809-9`.

## The drop lands on the road

Reported: the player spawns on the hill rather than on the path.

Both spawn points were written as plain coordinates, and both had drifted off
the Pilgrim's Road:

| | written | road actually runs through | off by |
|---|---|---|---|
| drop (`main.js`) | x −12, z 874 | x +15.7 | 28m |
| respawn (`mission.js`) | x 0, z 815 | x +12.2 | 12m |

28m off a causeway whose bed is cut flat only within 9m of the centreline puts
the trooper up the graded shoulder, 16m higher than the road, looking down at
it — and facing into the rise, with 13.65m of clear ground in front. That last
number is why the weapon probes kept finding shots dying at 0.35m from the
spawn: they were fired into a hillside.

Both now come from `roadPointAtZ()`, which interpolates ROAD_PATH and returns
the road's own heading there, so the spawns are on the road by construction and
follow it if the road is ever moved. The drop faces up the causeway toward the
cathedral rather than at a dune.

    off the centreline   28m  ->  0m
    ground fall across    -   ->  0m over a 6m span
    clear ahead        13.65m -> 320m

`saintfall-spawn-check.mjs` (new) asserts all three against the road rather than
against a coordinate copied out of the same file it is testing.

**State:** spawn-check, fire-feel, both elbow sweeps, weapon-gait-proof,
stow-melee and active-play all exit 0. Build `20260809-10`.

## Why three shipped elbow fixes never reached the browser

The import map keyed its versioned entries on the RESOLVED URL, which import
map resolution - a single pass - never consults: `saintfall/terrain.js` matched
the `"saintfall/"` prefix rule, resolved unversioned, and stopped. Only main.js
carried a `?v=`. Every other module was cached under Chrome's heuristic
freshness (python's http.server sends Last-Modified and no Cache-Control), so a
fresh mission.js could boot against a weeks-old terrain.js - which is exactly
what "SyntaxError: no export named roadPointAtZ" was. The map now keys on the
specifiers the modules actually write, and an exact key beats the prefix rule.

## The elbow, fixed at the source

Reported a fourth time - "permanently inverted" - after the cache fix
guaranteed the shipped pole was actually running. It was, and it was still
wrong, because the pole was never the disease. Measuring the rest pose:

    trigger shoulder (0.17, -0.03, 1.48)
    trigger wrist    (0.18, -0.22, 1.33)   <- the rear grip

The rear hand rode at RIB height, 19cm BEHIND its own shoulder, on a
shoulder-wrist chord 36cm long. On that chord the elbow's circle contains no
down-and-back point: sweeping the pole through both arcs put every reachable
elbow either flared at shoulder height or kinked FORWARD of the arm - the
"bending the wrong way" read. Hold your own hand behind your hip and watch the
same thing happen. Three rounds of pole selection were choices among wrong
answers.

The carry moved instead:

- `REST_PITCH` -0.19 → +0.26: the rest solve rotates the shaft about the FRONT
  grip, so canting the muzzle up drops the rear grip without moving the support
  hand at all.
- `gripRear` -0.180 → -0.155 of haft: the rear hand rides beside the hip, not
  behind the small of the back. Spacing 0.40m → 0.36m, inside the two-hand gate.
- `lowY` -0.212 → -0.242: the last few centimetres, shared by both hands.

Trigger wrist now (0.18, -0.15, 1.07) - hip height, 41cm below the shoulder -
and the measured elbow: 19cm down, 24cm out, **11cm behind the shoulder, bend
kinked 5cm backward**, the direction a right elbow folds. Both regimes.

The pole was then re-picked from a sweep of both arcs on the new geometry, and
of the near-identical candidates the most HORIZONTAL one was taken:
(-0.85, -0.35, -0.30). The arm now hangs close to vertical, so a down-dominant
pole pays for the same elbow in conditioning - 0.48 surviving at the worst
bearing against 0.68 for this one.

**The sweep finally gates anatomy, not just continuity.** Three green 864-sample
runs coexisted with an arm that read as inverted because every number measured
smoothness. The recorded `fore` component of the elbow's perpendicular offset IS
the kink direction, so now: at low ready it must never exceed +0.02 forward
(measured envelope -0.075..-0.004); committed it may go forward with a raised
aim - reach up and your own elbow comes forward under your hand - but never past
a sanity ceiling, and in neither regime may the elbow cross inboard of the arm.
`armPoseCheck` gained the same check (`triggerElbowKinksBack`), its drop/flare
windows demoted from definition to bounds, the support-grip baseline re-pinned
for the 30mm carry drop, and the aim-sweep reach floor moved 52 → 47 for the
forward-moved grip.

**State:** elbow sweep (864 bearings, anatomy gates armed), stow sweep,
weapon-gait-proof, stow-melee, fire-feel, active-play all exit 0. Build
`20260809-12`.

## The wrists come off the right angle

Reported: both hands bent 90 degrees at the wrist.

They were, by construction: the grip laid the fingers EXACTLY along the shaft -
the no-finger-bones workaround - whatever direction the forearm arrived from,
and with the rear hand at the hip both forearms arrive steeply. The angle
between "along the shaft" and "along the forearm" was simply never measured,
let alone bounded.

The solve now runs twice per hand (`WRIST_BEND_MAX`, player.js): pass 0 lays
the fingers along the shaft and solves the arm; only then does a forearm exist
to measure against, and if the wrist folds past the cap, pass 1 tilts the
finger axis toward the forearm by exactly the excess, re-derives the wrist
target from the tilted basis - so the palm stays seated ON the grip rather
than sliding off it - and re-solves. The fingers sit diagonally across the
haft, which is where a hand on a shaft actually sits.

Three costs surfaced and were paid deliberately:

- **The caps are per hand** [support 85deg, trigger 58.4deg]. One shared cap
  forced a 51-degree tilt onto the support cradle; re-seating the palm
  shortens the arm by 2*0.117*sin(tilt/2), and near full extension the elbow
  pays centimetres with tens of degrees - the crossing elbow folded 125 -> 94.
  The support hold is genuinely a more cocked posture; its cap only takes the
  right angle off the read.
- **The cap fades through the sheathe** (release/0.6) instead of switching
  off: a hard threshold snapped the elbow 150mm in one 2% phase step, and the
  stow sweep caught it before a player did.
- **Seven windows retargeted for one cause**: the tilted re-seat pulls both
  wrists a few cm up their forearms, so elbows fold slightly tighter and reach
  numbers drop. armPoseCheck gained `wristsNotSnapped` (per-hand ceilings
  97/65) and the sweep bounds were recalibrated - the survival floor to 0.45
  now that legitimate steep-aim poses overlap the old failure band, with the
  jump gate as the primary detector.

**State:** elbow sweep (864 bearings), stow sweep, weapon-gait-proof
(shaft error still 0.000deg), stow-melee, active-play all exit 0. Build
`20260809-13`.

## The hold, art-directed

Reported with direction: left hand straight off the forearm, palm up, thumb
forward; right hand palm-in against the OUTSIDE of the haft, thumb forward.

This ends the along-the-shaft finger axis entirely. The fingers now follow the
FOREARM continuation - the wrist-cap machinery re-targeted, with the caps
becoming small residuals (support 0.09 rad, trigger 0.17) and the loop given a
third pass to converge - and the palm direction is authored per hand: up for
the support cradle, figure-inboard for the trigger side-grip. The seat
construction keeps each palm ON its grip whatever the fingers do, so the hold
survived the change of model without the hands leaving the haft.

Measured: wrist bends 4.7/9.4 degrees at low ready (from 90/90); trigger palm
0.89 inboard onto the haft; both thumb sides of the gauntlets point forward
(+X on the right mesh, -X on the mirrored left - measured, after the first
seed pointed the trigger palm 0.76 OUTBOARD on the strength of an old comment
about which way figureRight points).

The straight wrist walks each wrist target a hand's length up its forearm -
the hand finally spans wrist-to-grip - which folds the elbows further and
thins the committed pole leverage at steep-down aims. Consequences paid:
support elbow window floor 100 -> 84; the sweep's inboard guard and survival
canary made regime-aware (lat may thin to -7mm on a steep committed reach but
may never cross 0; survival floors 0.45 low ready / 0.25 committed) - with
zero jump-gate failures across all 864 bearings and the 306-sample sheathe,
which remains the actual detector.

**State:** elbow sweep, stow sweep, weapon-gait-proof (shaft error 0.000deg),
stow-melee, active-play all exit 0. Build `20260809-14`.

## One brood, three castes — the bestiary rebuilt

The level fielded two hostiles: the Bloom's Thresher, and the Cantor, a
two-legged Concord walking machine holding the Censer Works and the
Cathedral. The machine half is gone. Everything hostile on Vesper-IX is now
one animal in three shapes.

Removing the Cantor was the brief, but it was also the right call on its own
terms. Two factions meant two visual languages in one frame, and the machine
half was drawn in iron and gold — the player's own palette. An enemy that
shares your colour scheme is an enemy you have to identify twice.

### What was actually wrong with the Thresher

Photographed beside the trooper it read as a prototype, and not for want of
polygons: 1,276 triangles were spent on two lumps for a body, six uniform
sticks for legs and two flat planks for arms. More of those would have
produced a denser prototype.

An arthropod has almost no straight lines and almost no uniform sections.
Every limb tapers, bows and carries a bulge at the joint; every body segment
is a plate with an EDGE, and the shadow under that edge is what the eye reads
as armour. Straight prisms cannot express either. So the kit grew the
primitives that can — `tube` and `shell`, a swept cross-section and a swept
sector with thickness, both with parallel-transport frames — and all three
castes are built out of curves and plates.

The four things that turned out to matter most, in order:

1. **Antennae.** Long, jointed, swept back over the body. Sixty vertices, and
   the loudest "this is an insect" signal available in an outline.
2. **Compound eyes as domes**, not a painted band. The first pass used a flat
   wedge and the head read as blind — the difference between a creature
   looking at you and a shape pointing at you.
3. **Overlapping tergites with lit membrane in the gaps**, so the body has an
   internal light source and stops being one solid mass.
4. **Feet.** The first pass ended each leg in a point, which is why it read as
   furniture. A tarsal pad with two opposed claws puts the animal ON the sand.

### Separated on the axes a player reads first

| | Thresher | Gleaner | Harrow |
|---|---|---|---|
| height | 1.19m | 3.55m | 2.63m |
| stance | six legs, low | four legs, stilted | six legs, braced |
| outline | a wedge | an inverted V with a lamp in it | a slab |
| role | swarm melee | ranged | armoured breaker |
| hp / damage | 60 / 14 | 150 / 11 × 3-round burst | 420 / 34 |
| triangles | 7,352 | 4,023 | 8,298 |

All three are painted from the same hue family on purpose, because they came
out of the same hive. Decoration cannot separate castes at two hundred metres
and neither can colour; height, stance and outline can.

The **Gleaner** carries its abdomen up and over its own back on a petiole and
ends, pointing forward past its head, in a spinneret. It is a scorpion's tail
aimed the wrong way, and it is lit from inside — which says RANGED with no UI
marker, puts the muzzle where the tracer is actually drawn from, and gives the
`fire` clip something to cock and snap.

The **Harrow**'s wing cases are shut at rest and FLARE OPEN when it wakes,
exposing lit membrane. One hinge doing four jobs: the alert tell, readable
from behind and at any range; a threat display that makes the animal visibly
bigger the moment it becomes dangerous; a bright target on a creature that is
otherwise almost black; and proof to the player that the armour is armour,
because they have seen it move.

### Bioluminescence for zero draw calls

Nothing in SAINTFALL is transparent, so vertex alpha was an unused channel on
every mesh in the game — and an unused channel is a free mask. The bestiary
paints it (1.0 on a compound eye, 0.30 on the membrane between two plates, 0
on chitin) and `patchMaterial(..., { bio })` adds the vertex's own colour back
as emission. The alternative was a second material for the glowing parts,
which is a second draw call *per instance*; a hundred and ninety enemies would
have paid a hundred and ninety extra draws for a few hundred pixels of eye.

### The garrison, and what it cost

35 units became 193, across every district on the map rather than only where
the objectives are. Each site is a recipe, not a count: Threshers alone are a
rush; Threshers plus Gleaners is the standard problem — something forces you
into cover while something else takes cover away from you; add a Harrow and
cover stops working. Density falls off toward the drop and peaks at the Bloom,
which is the only place on the map the mission never asks you to go.

That cost 2.1ms of a 5.6ms frame before any of it was paid for. Three tiers
fixed it, and only one of them was about this module's own work:

- **POSE_RANGE (300m)** takes the instances off three's automatic scene walk.
  A garrisoned level is ~7,600 nodes the renderer touches every frame whether
  or not one of them is on screen. The flag has to be cleared on the GROUP,
  not on each instance: a node checks its own `matrixWorldAutoUpdate` before
  writing its own world matrix, so an instance with it cleared can never be
  updated again, not even explicitly — which put the entire bestiary at the
  world origin in its bind pose, invisible where it was meant to be standing.
- **Per-species draw distance.** Frustum culling already removes what is off
  screen; this removes what is on screen and not worth a skinned draw. A
  Thresher at 235m is three pixels; a Gleaner at 235m is a recognisable
  silhouette on a ridge and pops out visibly, so it holds to 460m.
- **SHADOW_RANGE (74m).** Every caster is a second full draw of that mesh.

Frame in the Bloom, mid-garrison: **7.99ms → 3.96ms**, with 5.5× the enemies.

### Two measurement bugs the work surfaced

**`Box3.setFromObject` does not measure a SkinnedMesh.** It asks the mesh for a
bounding box — which three computes from the skinned vertices, already
carrying the bone chain's world scale — then applies the mesh's world matrix
on top. It reported 3.35m for a 1.19m Thresher, and the review harness sizes
its camera off that number: every frame in the bestiary review was shot from
three times too far away, and the subject was 1.3% of its own portrait.
`_scaleRaw` now walks the posed vertices.

**The stage is on a dune slope.** These creatures plant their feet
procedurally, so downhill legs reach half a metre further and the measured
height grows by most of that. `saintfall-bestiary-measure.mjs` finds flat
ground first, and separates body radius from leg splay — a capsule cut to a
hexapod's feet registers body hits on shots passing a clear metre wide.

### Hit volumes, refitted

Heads are now spheres placed in the creature's own frame, offset forward by
`headZ` and rotated by its yaw. The old test measured the head's distance from
the vertical axis, and these are long animals that carry their heads out in
front — a Gleaner's is 0.85m forward — so on every one of them the head sphere
sat in the middle of the thorax and a shot that visibly hit the face scored
body damage. Ranged units also fire from a `muzzle` anchor: the Gleaner's
bolts leave the spinneret carried over its back, not its chest.

### What the harnesses said

`saintfall-bestiary-shots.mjs` — all three clear the figure/ground gate:
colour distance 107 (Thresher), 68 (Gleaner), 147 (Harrow) against a gate of
60, internal value range 28–250 on all three. Getting the Gleaner there meant
reversing course: painted pale for legibility against sky it measured 42
against the sand it actually stands in front of, and LIFTING its plates to
catch more sun made it worse, 57 → 54. On warm ground, separation comes from
being darker and bluer.

`saintfall-bestiary-field.mjs` (new) shoots what the review stage cannot: real
garrisons, woken, at the ranges the fight happens at, in golden hour and at
night. Between 13 and 43 units in view per scene.

`saintfall-gameplay.mjs` — 41/41. Seven of those had been failing for a reason
none of them were testing: the combat checks kill the subject on purpose, each
death costs a reinforcement, and once the level was garrisoned properly the
subject burned all five in the combat section. `mission.state.phase` goes to
`"lost"`, the first line of `mission.update` is an early return, and from
there no relay can channel and no orbital beacon can even resolve.

**State:** bestiary-shots, bestiary-measure, bestiary-field, gameplay (41/41),
spawn-check all exit 0. Frame 3.96ms in a 191-unit garrison. Build
`20260809-15`.

## World and environment audit

Twenty-one authored poses, shot at ultra and looked at one by one. The
districts came out of it well — the Censer Works, the Vault-Cathedral, the
north vista and the Fallen Saint all hold a composed frame. What did not was
the thing between them, and two frames that had been in the review suite for
some time in a state nobody had checked.

### The sand was the whole problem

Half the poses were dominated by one smooth dune face. A 10x crop of the worst
(`fosse`) is a flat brown wash with faint horizontal steps in it and no other
information at all. Sand is 50-70% of every frame in this game, so no amount
of work on the things standing ON it can reach that.

It cannot be geometry: the finest terrain LOD is a 4m cell and aeolian ripples
are 30cm relief. So it is shading — three sine trains perturbing the NORMAL,
so the 13-degree sun rakes across them and produces real lit and shadowed
faces. Three things make it hold up rather than turn into corduroy:

- **It antialiases analytically.** `fwidth(phase)` is how many radians of
  ripple fall in one pixel; past about one, the train is sub-pixel and any
  amount of it is aliasing, so amplitude is divided by `(1 + w²)` and each
  train fades itself out at its own range. This project had already recorded
  the opposite failing — a screen-space bump cannot antialias itself, and
  guarding it with `fwidth` of the same aliased signal does not help. The
  difference is that a sine has a known phase, so its screen derivative is
  exact rather than sampled.
- **Three scales**: 0.75m for the ground at your feet, 4.2m for the middle
  distance, 22m for the big empty faces that were the actual complaint.
- **Amplitude falls off with slope**, because ripples form on gentle windward
  slopes and are wiped off slip faces at the angle of repose. Without it the
  pattern climbs vertical rock and instantly reads as a texture.

Two rounds of tuning after that, both caught by 10x crops rather than by
looking at the frame:

- The dune **glitter** came down 0.55 → 0.10. It is a specular lobe keyed on
  `reflect(-sun, normal)` inside 18cm world cells, tuned against a normal that
  varied slowly across a whole dune. Once ripples tilted that normal ten
  degrees every 75cm, whole cells flipped to full specular at once and the
  near field filled with hard white parallelograms.
- The three trains started **46 degrees apart**, which is not a dune, it is
  woven corduroy. Narrowing them to 15 degrees fixed the near field and left a
  subtler version at grazing angles — where 15 degrees of world heading
  becomes most of a right angle on screen, and the far ground went plaid. They
  are now strictly parallel, and the variety comes from the meander and the
  three scales. A real ripple field is strongly directional.

### Two frames that had been wrong for a while

**`saint-scale` was a photograph of the inside of a dune.** At its authored
position the ground rises 32.6 degrees above the camera's horizon ten metres
in front of it, against a target at 28.7 — a margin of MINUS 3.9 degrees. It
had been in the suite as a picture of the Saint the whole time. An authored
pose is a claim that you can see the thing from there, and terrain does not
honour claims, so `saintfall-pose-sightline.mjs` now walks the ground profile
and reports that margin as a number. The new position measures +12.5 degrees
and still stands 43m from the pilgrim camp.

**The nave had a white chevron across it.** Ten clerestory shafts raking in at
-0.60 horizontal against -0.80 vertical converge: left and right meet on the
centreline 33m along and 4.6m above the floor, and ten additive cone shells
crossing at one height render as a single hard-edged wedge spanning the frame.
Everyone who saw it read it as a rendering fault. It was ten light shafts all
arriving at the same point. Raked at -0.26 they descend nearly vertically and
land in two rows without meeting — which is also what clerestory light does,
because the windows are high on the wall and the sun is not in the nave.

Their gain had also been pushed to 4.2 on a base of 0.22, which is 0.92 —
straight back to the number the file itself records having rejected one
function earlier ("0.22, not 0.9 — at 0.9 these rendered as solid pale
wedges"). An additive cone shell is brightest at its silhouette, so these can
never be pushed hard without their outline turning into a drawn shape.

Additive glow now also carries a **near fade**, in `patchBasicMaterial` rather
than in the shaft builder, because every additive volume in the game has the
same failure the moment a player walks inside it.

### Density, in both directions

The **Glass Scar** was the one over-dressed place on the map: 190 shards up to
74m tall, tallest at the impact point, forming a hedge with no crater visible
behind it. A previous pass had doubled them because they were slivers, and
overshot. Now 118, slimmer, and tallest at MID-RADIUS — which opens the crater
floor to be seen into and the outer approach to be walked, and leaves a ring of
big glass between them. That is a composition rather than a fill.

The **Choir Spires** floor was a quilted lattice of little faceted cones, and
the fix was not the pattern — the file already domain-warps it — but the sample
rate. The finest terrain LOD is a 4m cell, so a ridge field at 17m wavelength
gets four samples per cone and four octaves off a 44m base reach 5.5m and are
pure aliasing. Nothing below ~30m wavelength goes in the height field now. The
fine detail there is the spires, which are real geometry and were always the
thing meant to read.

The basin BETWEEN the districts had detail at 0-3m (3,400 scatter crags, none
over 2.8m) and detail at 400m+ (the districts) and nothing in between. Fifteen
**yardangs** — wind-carved rock fins, 17-41m tall and 3.4-5.6x as long, sited
by rejection on open sand away from districts, road and each other. They carry
the same wind bearing as the ripples, so the desert reads as one weather
system rather than as a set of props. Fifteen across four square kilometres
cannot become clutter.

### Dither, and a linter that could not see its own bug

The final write is 8-bit and a shadowed dune or a clear sky can cross a code
boundary over a hundred pixels. Half a code value of triangular-PDF dither in
sRGB fixes that; the header comment claiming "there is no dither" was about
FILM GRAIN, and the distinction is that grain adds a signal while a dither
removes one.

Writing it reintroduced the project's oldest trap — a backtick inside a GLSL
comment, which terminates the JS template literal and kills the module with
`SyntaxError: Unexpected identifier 'fract'`. There is a linter for exactly
this and it reported clean, because it looked at lines containing `//` and at
continuation lines starting with `*`, and the backtick was on the same line as
the opening slash-star. It also could not see past the damage, since its
pattern needed the literal to be terminated properly. It is now a character
scanner that tracks comment state, and it has been checked by reintroducing
the bug.

Also of note: an ablation settled the one artefact I would otherwise have
guessed at. Faint horizontal lines on the far sand survived turning the dither
off entirely, which ruled it out in one run — they are the terrain's own
vertex-colour grid at an amplitude only visible under a contrast stretch.

**State:** 21/21 poses clean, no warnings, no page or console errors; frame
3.17ms at ultra with 132 draw calls; gameplay 41/41. Build `20260810-1`.

## The hands, and the shoulder that shrank

Two reports off a play session: both palms want a slight counter-clockwise
turn to sit on the shaft properly, and "occasionally the shoulder gets
distorted after weapon use and looks smaller than the other side".

### The palm roll is the one parameter nothing grades

The hold is built from a basis: `handY` is the finger axis, `handZ` the palm
normal seeded per hand, `handX` the cross of the two. That fixes the palm's
facing to within a ROLL ABOUT THE FINGER AXIS, and nothing in the suite can
see that roll — palm contact error, wrist target error, reach and slack are
all identical at any value of it, because the palm sits on the shaft either
way. That is exactly why it drifted: every gate was green while both gauntlets
gripped a few degrees edge-on.

So it is now an explicit constant, swept with `qa.setPalmRoll` in one live
session rather than by rebuild-and-squint, and shot from the player's own
bearing and from outboard. At 0 both gauntlets present their broad flat face
square to the camera with the haft passing behind them. By 0.24 rad (14°) the
palm side has turned onto the haft and the gauntlet's long axis lines up with
it. Past 0.40 the seat breaks outright and palm contact error jumps from
0.055m to 0.63m, so the usable window is narrow. `saintfall-palm-roll-sweep.mjs`.

### The shoulder was the arm's own roll, and my first diagnosis was wrong

The obvious suspect was the pauldron follow, which scaled and clamped the
arm's three Euler components — and Euler angles are not a continuous measure
of how far a joint has turned, so that code genuinely was wrong. It is now a
slerp from identity with a cap on the ANGLE. But it was not the reported bug:
the shipped figure is the imported Meshy rig, which returns
`pauldronPivots: []`, so none of it runs. The probe found that out by throwing
on `undefined`, which is the cheapest possible way to be corrected.

The real cause is one line that does not exist. `aimJoint` reads a joint's
current orientation and applies the minimal rotation that points its axis at
the target: that fixes the AIM and says nothing about the ROLL about that
axis. So the roll is not solved, it is inherited — from a value that is itself
the previous frame's inheritance. It is a free-running integrator with no
reference. The legs are reset to bind before their solve, two hundred lines
further up in the same file. **The arms never were, and were the only chain in
the rig running open-loop.**

Linear-blend skinning pinches a limb's cross-section where the bone is rolled,
so a wound-up upper arm collapses that deltoid and the shoulder reads smaller
than its opposite number — occasionally, after weapon use, one side only, and
it stays. Measured across a melee swing, upper-arm twist from bind:

| | peak | settles at |
|---|---|---|
| without the reset | 0.816 rad | 0.279 / **−0.816** |
| with the reset | 0.298 rad | 0.298 / 0.013 |

47 degrees of roll on one arm and none on the other, persisting after the
swing. The two arms differing at all is correct — the carry is asymmetric by
design, support hand front and palm-up, trigger hand rear and side-on — but 47
degrees is skinning damage. `saintfall-arm-twist-probe.mjs`, which also checks
the property actually being fixed: the arms now return to the same pose after
a swing to within 0.0005 rad.

Two measurement mistakes worth recording, both caught by ablation rather than
by argument. The first version of the twist metric decomposed a bone's LOCAL
quaternion about an axis built from WORLD positions — different frames, and
the number that comes out of mixing them is not a twist, it is nothing. It
reported 1.16 rad and kept reporting it after a fix that demonstrably worked.
And the first gate asserted left/right symmetry, which this rig must not have.

Checked against baseline afterwards: the support arm's elbow reads as leading
its wrist in `saintfall-arm-anatomy.mjs`, and it does so identically with both
changes reverted (−0.14, 0.15, 0.02 either way). Pre-existing, untouched here,
and left flagged rather than opened up.

**State:** weapon-gait-proof (shaft error 0.000deg, gauntlet surface-to-grip
0.065m, arm-pose checks pass), stow-melee, lowready-arms, arm-twist and
gameplay 41/41 all clean. Build `20260810-2`.

## A run that reads as a run, and sights that mean something

### The lean was all spine

The shoulder line already reached 13.2° at a sprint, which is roughly the right
number, and the trooper still read as bolt upright and rigid at speed. The
angle was not the problem — **where it came from** was. All of it was applied
to Spine, above a vertical pelvis and vertical legs, and bending only the spine
is a stoop. A person running does not stoop, they TIP, from the ankles, pelvis
leading and legs trailing behind the mass.

So the lean is now split. `bodyLean` tilts the figure ROOT, which sits at the
soles, so the whole trooper pivots about the ground; `travelLean` keeps what is
left for the spine. The two still sum to the shoulder-line angle every arm
pole, grip seat and hand basis in the file was tuned against — 5.7° walking,
and now 16° at a sprint rather than 13.2 — so none of that geometry had to
move. Measured on the live figure:

| | speed | whole body | shoulders |
|---|---|---|---|
| stand | 0 | 0.0° | 1.1° |
| walk | 4.4 m/s | 2.6° | 4.7° |
| sprint | 8.6 m/s | **11.5°** | 15.0° |

Tipping the root moves the hip sockets 19cm forward at 11°, and the legs
noticed immediately: ankle target miss went from 8mm to **147mm** — the IK
being asked to reach further than the leg is long. The fix is the same thing a
leaning runner does, which is to put the feet under the mass: both foot plants
shift forward by `sin(bodyLean) × leg length`. That restores the leg geometry
exactly, and the miss came back at 0.0000m, better than it started.

The head recovers half of the TOTAL lean rather than half of the spine's
share — it hangs off the chest which hangs off the root, so it already carries
both, and recovering only the spine's part would have the trooper sprinting
while watching his own boots.

**The gate was measuring against a tilted ruler.** `saintfall-weapon-gait-proof`
computes the lean as the chest's up-vector against the ROOT's forward — and the
root's forward stopped being horizontal the moment the body lean went in, so it
cancelled part of the very thing it was reporting: 3.5° on a figure leaning 16.
Flattening that axis is the fix. A lean is an angle from vertical, so the axis
it is measured along has to be horizontal.

### Sights

Right mouse was already wired to `state.ads` and the HUD already advertised
"RMB aim"; it drove weapon spread and a low-ready pose and nothing the player
could see. It now zooms and slows the walk.

`weapons.carry.ads` is set instantly to 0 or 1 by main.js, which is correct for
a spread value and wrong for anything a viewer watches move — a field of view
that snaps between two numbers reads as a glitch. So the player damps its own
`state.sighted` from it (up faster than down: raising sights is a decision,
lowering them is a release) and drives both the zoom and the speed from that.
Reading it from `carry.ads` rather than from the raw button matters, because
main.js already refuses ADS for a melee weapon and in flight, and duplicating
those conditions is how a camera ends up zoomed with the weapon down.

- **62° → 40°**, a 1.55x zoom: enough to read a Gleaner on a ridge at the 52m
  it starts shooting from, without turning the frame into a scope.
- **46% of movement speed.** Applied to the target speed rather than by gating
  sprint, so it removes the sprint option by arithmetic — 8.6 × 0.46 is below
  the 4.4 walk, and a player holding shift and the right button simply moves at
  aiming pace instead of getting a third speed the gait never expected.
  Measured: sprinting 8.60 m/s → 3.96 m/s sighted.

Recoil is added AFTER the zoom, not before: a punch is an absolute kick in
degrees, and scaling it would make a shot down the sights shove the view less
than the same shot from the hip. And the body straightens up while aiming with
no extra code — the lean is speed-driven, and 3.96 m/s is below a walk.

**State:** weapon-gait-proof (ankle miss 0.0000m, lean 4.6°/14.3° at its own
sample phase, arm-pose checks pass), stow-melee, arm-twist, spawn-check and
gameplay 41/41 all clean. Build `20260810-3`.

## Lit eyes, the melee key, and a lance that points at things

### Finding the sockets, and three wrong answers first

The mask's eyes are **painted into `vesper-atlas`** — two dark blobs about
10×14mm on a face that is two flat facets meeting at a centre crease. There is
no recess to light and no submesh to make emissive, so the glow has to arrive
as geometry sitting proud of each facet. All the difficulty was in finding out
where the facets are, and every shortcut produced a confident wrong answer:

- **The helm's Box3 maximum is the brow, not the face.** Trial quads placed at
  the global max Z were buried behind the surface at eye height.
- **A per-height scan of frontmost vertices** returned a single central ridge —
  the crease — not the two planes either side of it.
- **A ray fired along a FIGURE-space direction measured in another frame missed
  entirely.** The head yaws under `applyFigurePose`, so the ray left the face
  and hit the *side* of the helm, and returned a perfectly plausible hit: right
  height, sensible normal, 25mm too far outboard. Both eyes were built there
  and rendered as slivers, edge-on, at the silhouette. Flagging them magenta
  with `depthTest:false` is what showed it — the position was never the thing
  to check, the *frame* was.

What works is doing the whole measurement inside one frame: render the head,
cluster the darkest pixels on it, unproject each cluster back onto the skin,
and convert to **head-local** — the one frame that is invariant to head aim.
Two clusters fall out at head-local y≈14.9, x≈±3.4 (the rig carries a 0.01055
world scale, so a metre is ~94.8 of these units), and the vents and gorget
shadow land in separate clusters lower down.

Two details the render then argued with:

- **Squaring the lozenges to a Y-free normal buries their top corner.** Each
  cluster's average normal tips ~18° skyward because the blob laps onto the
  brow bevel above the socket; the facet itself is vertical. 1.5mm of standoff
  cropped both eyes into pentagons, 3mm clears it.
- **One flat emissive value cannot be both bright and yellow.** At an intensity
  that blooms, the whole area tone-maps to white. `CircleGeometry` is a
  triangle fan around one centre vertex, so a single colour attribute buys a
  radial gradient for nothing: centre 1.0, rim 0.38, with the rim landing just
  under the bloom threshold so the halo comes off the core only. Vertex colour
  reaches `diffuseColor` on its own but not emission, so a four-line
  `onBeforeCompile` carries it across — set *before* `patchMaterial`, which
  chains rather than replaces the hook it finds.

The eyes ride the same time-of-day curve as the heart lantern (2.4 day, 5.6
dusk, 6.6 night) so the two read as one lamp in one suit.

### Melee is Q now

The old comment in `player.js` said it plainly: melee was on V "rather than the
requested Q because Q is the stratagem pad". So the pad moved to V and melee
took Q. Melee is the panic button — it is what you hit with something already
on top of you — and it belongs under the finger nearest WASD; the stratagem pad
is the deliberate one you have time to reach for.

**No harness covered this.** `stow-melee-probe` and the gameplay suite both
call `pressMelee()`, an API hook that pushes the event directly, so every test
passed on a build where the keyboard did nothing. A direct `KeyboardEvent` test
covers all six behaviours (Q melees, V opens the pad, V+arrows enter a code, V
locks movement, Q no longer eats the arrows or the walk, R still reloads) — and
it failed twice before it was right, because **the game loop drains
`state.events` every frame**, so dispatching and reading in separate
`page.evaluate` calls races the loop. Dispatch and read in one tick. The second
failure was the test's own: it released the arrow key before polling movement,
so every case read `[0,0]` and the "V locks movement" assertion passed for the
wrong reason.

### The thrust, and 12cm of arm

`melee1` was a horizontal sweep — which is what `melee2` does two presses
later, and what every weapon in the genre already does. A lance that never
points at anything is a heavy stick.

A thrust cannot be built the way the sweeps are. They swing the tip through
metres on rotation alone, which is nearly free: the hands barely move. A point
driven forward needs translation, and translation hits the reach constraint at
about 12cm. Measured on the rig at full extension, the **lead arm sits pinned
at the 92% ceiling** the constraint enforces, so the stroke simply stops there.

Depth was pooled from four places and then a fifth:

| source | forward tip travel |
|---|---|
| mount slide (`x`) | 0.18m |
| chest uncoiling from pitched-back to pitched-in | 0.20m |
| hips squaring up | — |
| point dropping onto the line | (0.10m down) |
| **shaft run through the hands** | **+0.16m** |

The last one is the new channel. `slide` runs the haft back through both grips
— which is simply how a spear is thrust — and it is the only way to buy reach
without asking the arms for it. It took the extension from **0.201m to 0.365m**.
28cm of slide was tried and returned 2cm more point than 22cm: past that the
constraint has moved on to binding somewhere else. The grips are written
**absolutely off a recorded bind every frame**, including the frames where the
offset is zero — they are persistent nodes on a weapon built once and reused,
so a clip that only wrote them while playing would walk the hands off the end
of the haft inside a second. Checked: the palm-to-grip gap holds at 0.055m
through the whole clip and 27cm of haft remains behind the rear hand at peak.

`arc` drops to 0.85 rad against the sweeps' 2.3–2.6 — a thrust hits what it is
pointed at — and a new `lunge` multiplier pays that back as 1.34× reach, so it
opens on something still out of range rather than being a strictly worse
melee1. The hit window opens at 0.33, not at the start of the drive: `hitDone`
latches on the first frame inside it, and an early window resolves the strike
while the point is still travelling, claiming the lunge reach from a pose that
has not reached it.

**The arc gate was measuring the wrong axis.** `arcDiagonalM` is the diagonal
of the tip's bounding box, which a straight thrust cannot fill no matter how
hard it is driven — 0.59m for a stroke whose tip covers 1.36m at 14m/s. The
probe now also reports `reachM`, depth past the carry pose along the figure's
own forward axis, and the gate takes either. The two cannot be cleared by one
cheat: the thrust measures 0.365m of reach against the swings' 0.008–0.052m,
and an attack that neither sweeps nor extends still fails.

**State:** character harness 19/20 with the only failure `grip rear reachable
in "melee3"` — pre-existing, and confirmed by disabling the grip-slide write
entirely and watching it fail identically at 0.119m. Note that `git stash` is
useless for isolating this work: `assets/js/saintfall/` is untracked, so the
stash silently no-ops and the "baseline" run is not one. Gameplay 41/41,
weapon-gait-proof, stow-melee and the GLSL lint clean; picture gates 9/15, the
same six `hideParts` gates documented above. Build `20260810-4`.

### Eight lamps, not two

The mask carries more than a brow pair. Below the painted eyes it has a real
**recess** — measured at 30×32mm and about 9.5mm deep — and below that a long
run of empty cheek. Two lamps became eight: the brow pair, a larger pair set
down on the floor of the sunken sockets, and two more pairs descending each
cheek.

Finding the recess needed a different tool than finding the painted eyes. The
eyes are a texture feature, so they show up as dark pixels; the recess is
geometry, and it is not especially dark. **Depth-mapping** each facet finds it
directly: fire along the facet normal over a grid, record where the surface
comes back, and the recess is the block of cells sitting ~0.9 units behind
their own row's outboard shelf. The same map hands over the smooth cheek below
it, and confirms the lower lamps clear the facet edge — at the bottom row the
facet runs out at a ≈ −2.7 and an 11mm lozenge centred at −1.92 ends at −2.43.

The sunken pair is placed on the recess **floor**, not the shelf around it, so
the glow washes the recess walls and reads as a light down a well rather than a
tile stuck over a hole. They are 1.22× the others because a lamp at the bottom
of a well shows less of itself.

Both sides are measured rather than one side mirrored. The mask is not
symmetric — the brow pair sits at x −3.80 and +3.08, a 5.5mm offset about the
crease — and the recesses differ by a similar amount.

**Baked into one geometry.** Eight lozenges of six triangles each, static
relative to each other and to the head, sharing one material, on screen every
frame of a third-person game: that is eight draw calls to draw 48 triangles.
Composing each transform into a cloned geometry and merging gives one mesh and
one call, and the figure went from 65 draw calls to 64 — fewer than before the
eyes existed at all.

**State:** figure 64 draw calls (was 65 with the brow pair as two meshes),
gameplay 41/41 at 5.75ms in a garrison, picture gates 9/15 with the brightness
gate unmoved at +9.3, character harness 19/20 with the same pre-existing
`melee3` grip failure. Build `20260810-5`.

## The Matriarch: a boss for the brood

### What was left to own

The bestiary had already spent the three obvious silhouettes, and each
was chosen so no two castes compete for the same read at range: the Thresher
is SMALL AND FAST, the Gleaner TALL AND THIN, the Harrow WIDE AND LOW. A boss
that is a bigger Harrow is not a fourth silhouette — it is the third one again
with more health, and the player learns nothing when it comes over a ridge.

So the Matriarch owns **LONG**, and it owns **REARED**: 5.05m tall, 6.93m wide
and 10.9m long, laid along the ground with the front third lifted off it. Two
things enforce that and neither is decoration:

- **Eight legs.** Four pairs where the rest of the brood has three or two. A
  walking creature is read by its leg rhythm long before its body resolves.
- **Folded raptorial scythes.** The triangle of air trapped inside the fold is
  the only large piece of negative space on the front of the animal — the
  Harrow's horn-gap trick moved onto a limb, because holes survive distance
  and surface detail does not.

### Three rounds, and what each was actually about

**Wire legs.** The first build's femur was 0.19m on a 4.5m leg — 4% of its
length, where the Harrow's is 20% — and eight of them read as black threads
holding up a ten-metre animal. Roughly doubled throughout.

**The scythes were inside the animal.** Authored tight to the thorax they were
geometrically correct and completely invisible: the mesosoma is 0.9m in radius
there and the pronotum stands proud of that again, so an elbow at x=1.02 was
buried. The feature a silhouette is built on has to be outside the silhouette.

**The front was a thicket.** With the front feet at z +1.72 — ahead of the
head — and the front knees at the height the scythes reached through, ten limbs
occupied one volume and neither the leg count nor the fold could be read at
all. All four leg pairs moved behind the head and the scythes moved up and
forward; the front of this animal belongs to them.

**The alert pose was deleting the animal.** Three gaster bones keyed
-0.42/-0.34/-0.24, each reasoned about on its own, COMPOUND: the tip ended a
full radian off rest, the gaster curled under the thorax, and ten metres of
creature rendered as a four-metre ball. Length is this thing's whole identity.
Now -0.20/-0.15/-0.10, which lifts the egg sacs into view and stops.

### The fight, not the health bar

3600hp is a consequence, not a choice — the brooding cycle is 14 seconds, and
anything under ~3000 died before it laid twice, which makes the one mechanic
that distinguishes it optional.

**The weak point is a separate primitive, not a modifier.** A head sits inside
the body capsule, so `headHit` can be a flag on a hit that already landed. The
gaster sits 3.3m BEHIND the capsule and outside it — tested the same way, the
capsule rejects the ray before anything looks at the weak point and the one
place on the boss worth shooting is unhittable. It returns `t`, not a boolean,
so a 1.55m sphere shot edge-on resolves at its entry point rather than behind
whatever is actually in front of it. Measured: 450 damage from behind against
100 on the body and 260 on the head, and a front-on shot at gaster height still
resolves as a body hit, because the animal is in the way. That is the encounter.

**It broods on its own clock**, not on melee range. Gated on reach it would only
fire while the player was already being hit, which is the moment they can least
afford to look at anything else; fired at range it is a timer that says *stop
shooting the armour and go around*. Line of sight is still required, so
breaking contact stops it. The clutch lands behind the ovipositor — the weak
point and the children come out of the same place, so the ground the player
wants to stand on is the ground that keeps filling up.

### Two harnesses, and two measurements that lied

`saintfall-matriarch-review` exists because the bestiary shot harness frames one
creature off its own bounding box on whatever ground the review stage sits on.
For a 1.19m Thresher that is fine; for a ten-metre animal on a dune it puts half
the creature behind the hill. Its first run rendered five careful angles of empty
desert — `studio(true)` hides `enemies.group`, because it exists to photograph
the player alone.

`saintfall-matriarch-fight` checks the things pictures cannot: that the gaster
is hittable from behind and not through the body, that the cap holds, that the
clutch lands behind. Two of its measurements had to be thrown away first:

- **Brood positions measured at the end of the run** reported every clutch as
  spawning in front. The children are born awake and charge at 7.4m/s; a second
  later they are past the boss. They are captured on the frame they appear now.
- **A with/without-boss frame-time A/B** reported the Matriarch as **6ms
  cheaper than not having it**, reproducibly. That number is real: a ten-metre
  animal at point-blank is a huge occluder, three.js sorts opaque draws
  front-to-back, and removing it hands the whole basin behind it back to the
  fragment shader. It is not the creature's cost, so it is not reported —
  whole-map cost is `saintfall-gameplay`'s job.

### Placed last, deliberately

It stands on the crater floor at the Fallen Saint, which is extraction. The
Bloom is where a queen belongs and it is also the one district the mission never
sends anyone to — so a boss there is a boss most players never meet. It does not
gate the mission either: extraction completes on the shuttle timer, not a body
count, so it is what makes those ninety-three seconds cost something.

Its GARRISONS entry is **appended to the end of the array**, and that is not
tidiness. `grng` is one sequential stream shared by every entry, and this one
draws from it four times; inserted anywhere else those draws shift every number
handed to every entry below it and re-place four districts that have already
been reviewed and framed. The size roll is taken and discarded for the same
reason — a unique must cost the stream what an ordinary unit costs.

### It has to stand somewhere level

A creature sits at ONE ground sample taken at its origin while only its feet
are terrain-solved. That is invisible on a 1.19m Thresher and ruinous on a
body 10.9m long: the first position, picked by eye on the crater floor,
measured **5.01m of relief** across the footprint the animal actually covers,
and the render showed the gaster buried to the spine in a dune.

The replacement was searched for rather than guessed — and the first search
was still wrong. It tested whether a POINT was clear, but the garrison nudges
units out of masonry with `findOpen` at the unit's own collision radius, so a
spot clear for a point and not for a 2.3m disc got the boss moved 11m onto
ground with 4.75m of relief. Searching with the real radius, and rejecting any
candidate `findOpen` moves at all, lands it at **[-32, -50]: 0.21m of relief,
44m off the extraction pad** — close enough to be the reason those ninety-three
seconds are hard, far enough not to be standing on the objective.

**State:** 10,423 triangles · 46 bones · 8 IK chains · one draw call, 1.34ms/frame
with the boss and a full clutch at point-blank. Gameplay 41/41 at 5.21ms with 192
live — 191 as before plus the boss, the rest of the map untouched. Encounter
checks all pass. Character harness 19/20, the same pre-existing `melee3` grip
failure. Build `20260810-6`.

## Aim, heat and range

### The look-up limit was not the clamp

The report was "on a hill it is hard to aim at some enemies", and the obvious
suspect was the pitch clamp — `-0.72` up against `1.15` down, 41 degrees
against 66. Raising it would have done **nothing**, and measuring first is the
only reason that was found out.

Driven to the top of its travel on flat ground, a full-limit look-up produced
**9.2 degrees of actual aim**. The chase boom points opposite the view, so
looking up swings the camera down and back — at the limit that is 3.4m below
the trooper on a 5.2m boom, two metres underground. The clearance pass then
lifted it out, which put the camera *above* the trooper, and `lookAt` aimed
from up there back down at his head. The player was pushing the stick to the
stop and the shot went nowhere near where they pointed. On a dune the same
input gave 44 degrees, because the ground fell away behind and the lift never
triggered — which is exactly the "sometimes it works" the report describes.

The fix is to keep the camera out of the ground by **shortening the boom
instead of lifting it**. Pulling in along the boom preserves the direction and
only changes how close the shot is; lifting changes the direction, which is the
one thing aim cannot afford. Then the clamp is worth raising, and it goes to
1.05 (60 degrees).

The clearance margin had to come down with it — 0.9m to 0.45m. Under the
lifting camera that number was nearly free; against a boom that shortens it is
the entire budget, because the only height available is the 1.62m eye. At 0.9
the boom collapsed to a third of its length by 17 degrees of look-up, so every
ordinary upward glance snapped to first person. Measured, at 0.45:

| requested up | actual aim | boom remaining |
|---|---|---|
| 0–9° | 4–12° | 100% |
| 17° | 23° | 67% |
| 26° | 32° | 50% |
| 43° | 52° | 25% |
| 60° | 66° | 25% |

Pulling in cannot push the camera through a dune the way lifting could, so the
smaller margin is also safer than the number it replaces.

### Heat instead of ammunition

The reliquary does not run out; it runs hot. Ammunition on a two-kilometre map
with no shops is a resource whose only real effect is to send the player back
to a resupply beacon — and the beacon is a stratagem they have to spend anyway,
so the magazine mostly punished being far from one.

The numbers are picked off the rate of fire so they mean something in seconds
rather than in rounds. At 9 rounds a second, 0.0333 of heat per shot is **31
rounds and 3.5s of held trigger** before it locks, against the old magazine's
45 rounds and 5s: the limiter has to bite often enough to be a mechanic. It
then **unlocks 2.4s later, on its own, with no resupply** — which is the check
that would quietly turn this back into ammunition if it ever broke, so the
gameplay suite asserts it directly.

Two details that are not obvious:

- **The lockout latches.** Without it the weapon comes back for one shot the
  instant heat dips below full and immediately re-locks, which reads as a
  broken trigger rather than a cooked barrel. It clears at 0.25, on the way
  down.
- **The gauge fills before the shot is refused.** Heat is added and the lockout
  latched *after* the round leaves, so the readout and the weapon never
  disagree at the moment the player is watching the readout.

R is now a deliberate vent: 1.4s to dump the gauge, against 2.45s for cooking
it. Venting early is therefore always cheaper than overheating, which is the
decision the mechanic exists to create. It is allowed *while* overheated —
being unable to touch the weapon you have just cooked would leave the player
with a key that stops working exactly when they reach for it.

### 50% further, not 50% faster

Those are different requests and only one of them is what a traversal tool is
for. Raising `cruiseSpeed` covers more ground per second and still strands the
player in the same place, because the tank is what runs out. `burnRate` 16 →
10.7 makes the same 95 usable units last 8.9s instead of 5.93, and the gauge
still reads 0–100 so nothing in the HUD or the recharge maths has to change.

Measured on real flights rather than from the arithmetic, across six sites and
two headings each — and the measurement needed a second pass, because the first
"flat" test site flew into a dune at 106m and then sat there burning fuel for
four seconds. Matched site-for-site:

| site / heading | before | after |
|---|---|---|
| −8,300 · N | 182.9m | **275.7m** (1.51×) |
| 0,480 · N | 174.9m | **261.2m** (1.49×) |
| 120,−300 · E | 177.1m | 234.2m (1.32×) |
| −420,380 · E | 185.0m | 242.2m (1.31×) |
| the other eight | — | byte-identical |

The identical eight are the honest part of the table: those flights end at a
dune, not at empty tanks, so more fuel buys nothing. Unobstructed range is
1.49× and fuel-out goes 5.93s → 8.87s (1.496×). On this map the felt gain
varies with where you point.

**State:** gameplay 43/43 (two new heat checks) at 5.98ms with 192 live,
stow-melee, weapon-gait-proof and aim-commit all clean, character harness 19/20
with the same pre-existing `melee3` grip failure. The jetpack probe is 40/42;
`sheathed lance occupies the right-side rear cradle` misses by 7mm (−0.213
against a −0.22 gate) and is **not** from this work — it reproduces
bit-identically with the camera change reverted. Build `20260811-1`.
