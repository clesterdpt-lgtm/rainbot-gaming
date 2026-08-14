# APOP DEMON MOGGERS 3D — engine contract

**Read this before touching any file in `assets/js/apop3d/`.** Several agents work
in this directory in parallel. The contract is what keeps them from colliding.

---

## 1. What we are building

A 3D platformer in the **Super Mario 64** mould — free-roaming courses, a full
acrobatic moveset, a cameraman-on-a-string camera, and collectibles that gate
progress — wearing the identity of the existing 2D game *Apop Demon Moggers*.

The identity is fixed and must be preserved:

| Element | Name |
| --- | --- |
| Player | **Moggadonna** — pop frontwoman, demon mogger |
| Final boss | **Lucifer Lipsync**, frontman of *Boyz II Hell* |
| Mini-boss | **The Algorithm Twins** (mirror-match opening act) |
| Mini-boss | **The Payola Phantom** (shielded industry specter) |
| Enemies | Auto-Tune Imp · Lip-Sync Lackey · Industry Plant · Pay-Pig Demon · Stan-Account Bat · Backup Dancer Demon · VIP Bouncer Demon · Paparazzi Drone |
| Courses | 1 The Mall Food Court · 2 The Awards-Show Red Carpet · 3 The Streaming Farm Basement · 4 Influencer Rooftop Afterparty · 5 Boyz II Hell — Final Livestream |
| Star analogue | **Platinum Record** (7 per course) |
| Coin analogue | **Clout** (yellow 1 · red 2 · blue-switch 5) |
| Cap analogue | **Record Deals** — Auto-Tune Beam / Stan Shield / Main Character Energy / Choreo Cancel / Label Advance / Diva Tax |
| Hub | **The Label Lobby** — a paintings-into-worlds hub |

Signature verb kept from 2D: the **Mog Beam** (ranged pop attack) and the
**Mog Aura** (screen-clearing special), plus **on-beat** timing bonuses driven
by the music at 124 BPM.

Parody framing is load-bearing and stays: fictional satire of pop culture and
"mogging" slang, no real person or group depicted.

---

## 2. Non-negotiable quality bar

Every frame is judged **blind, side by side, against real Super Mario 64
screenshots** by an adversarial critic. Assume the critic is looking for the
tell. The known tells, in the order they give us away:

1. **Flat, uniform surfaces.** SM64 textures are low-res but *high-variance* —
   grain, stains, tile breaks, painted trim. A clean untextured plane reads as
   a prototype instantly. Everything gets a texture.
2. **No contact shadow.** Every object that touches ground gets a grounded
   shadow. A floating character is the single loudest AAA failure.
3. **Silhouette mush.** SM64 shapes read at 240p because they are big, rounded,
   and separated by value. Test every model as a black silhouette.
4. **Dead camera.** SM64's camera leads, settles, and swings around walls. A
   rigid follow cam reads as an engine demo.
5. **Linear motion.** Everything accelerates and settles. Nothing lerps at a
   constant rate. Squash-and-stretch on every jump and land.
6. **Grey ambient.** SM64 bounce light is *coloured* — warm from lit ground,
   cool in shade. Never light with neutral grey.
7. **Empty air.** Dust, sparkle, drifting motes, heat shimmer. Air must not be
   a vacuum.

## 3. Module map — one owner per file

Do not edit a file you do not own. If you need something from another module,
add it to that module's exported interface and note it in your handoff.

| File | Owns | Depends on |
| --- | --- | --- |
| `boot.js` | CDN pick, import map, entry handoff | — |
| `core.js` | pure math, RNG, noise, easing, Pool/Bus/Timer | — |
| `settings.js` | quality tiers, user options, persistence | core |
| `input.js` | keyboard, gamepad, touch → normalised intent | core |
| `textures.js` | procedural texture synthesis → canvas/DataTexture | core, three |
| `materials.js` | material library, shader patches, toon/PBR hybrid | textures |
| `render.js` | renderer, render targets, post chain, dynamic res | materials |
| `sky.js` | skydome, clouds, fog, time-of-day per course | materials |
| `camera.js` | the Lakitu-class camera rig, modes, collision | core, collision |
| `collision.js` | static BVH, triangle queries, ray/capsule casts | core |
| `physics.js` | integrator, slope response, moving platforms, water | collision |
| `character.js` | skeleton + skinned mesh construction for all bipeds | materials |
| `anim.js` | pose graph, blending, procedural layers, IK | character |
| `moveset.js` | the SM64-class action table (pure state machine) | core |
| `player.js` | Moggadonna: binds moveset → physics → anim | moveset, physics, anim |
| `enemies.js` | the eight demon archetypes, AI, spawners | physics, anim |
| `bosses.js` | Algorithm Twins, Payola Phantom, Lucifer Lipsync | enemies |
| `collect.js` | Platinum Records, Clout, Record Deals, switches | physics |
| `levels.js` | course registry + shared level-building primitives | world |
| `world.js` | scene assembly, streaming, per-course props | levels |
| `vfx.js` | particles, decals, trails, impact library | render |
| `audio.js` | music bed at 124 BPM, beat clock, SFX bus | core |
| `hud.js` | HUD, menus, overlays, pause, results | core |
| `save.js` | progress, records, tour pass, localStorage | core |
| `qa.js` | debug hooks the screenshot harness drives | all |
| `main.js` | the loop, ctx construction, module wiring | all |

## 4. The `ctx` object

Every module exports `create(ctx)` (or `init(ctx)`) and receives the same
object. Never reach for a global; never import `main.js`.

```js
ctx = {
  THREE,                 // the three namespace
  build,                 // build string from boot
  canvas, renderer,      // WebGLRenderer
  scene, camera,         // THREE.Scene, THREE.PerspectiveCamera
  clock: {
    t,        // seconds since start (paused time excluded)
    dt,       // clamped frame delta, seconds (never > 1/15)
    raw,      // unclamped delta
    frame,    // integer frame counter — the harness polls this
    beat,     // 0..1 phase within the current musical beat
    beatIndex,// integer beats elapsed
    onBeat,   // true for the frames inside the on-beat window
  },
  settings, input, textures, materials, sky, cameraRig, collision,
  physics, world, player, enemies, bosses, collect, vfx, audio, hud, save,
  bus,                   // core.Bus — cross-system events
  rng,                   // seeded, deterministic per course
  state: {
    mode,      // "boot" | "title" | "hub" | "course" | "paused" | "results"
    course,    // 0 = hub, 1..5
    records,   // collected Platinum Records this save
    clout, hp, maxHp, mog,
  },
  qa,
}
```

### Lifecycle

```
create(ctx)          once, at load. Build objects, register listeners.
enter(ctx, payload)  when the course/mode this module cares about starts.
update(ctx)          every frame, before render. Read ctx.clock.
lateUpdate(ctx)      after physics resolve — camera and IK live here.
exit(ctx)            teardown when leaving a course. Dispose GPU resources.
```

Update order in `main.js` is fixed:

```
input → audio.beat → moveset → physics → player → enemies → bosses
      → collect → world → vfx → cameraRig.lateUpdate → anim.lateUpdate
      → hud → render
```

Anything that needs the *final* transform of a body (camera, IK, attachments)
runs in `lateUpdate`. Anything that moves a body runs in `update`.

## 5. Units and conventions

- **Metres, seconds, radians.** Y is up. −Z is forward for a mesh at identity.
- Moggadonna is **1.7 m** tall, eye at 1.55 m, capsule radius **0.32 m**.
- Gravity **−22 m/s²** (heavier than real; it is what makes platforming crisp).
- Walk 3.2 m/s · run 7.4 m/s · long-jump launch 13 m/s horizontal.
- One "tile" of level grid = **2 m**. Courses are built on that grid.
- Colour authoring in sRGB hex. `renderer.outputColorSpace = SRGBColorSpace`
  and **all** colour textures get `SRGBColorSpace`; data textures (normal,
  roughness, AO) stay `NoColorSpace`. Double-encoding is a known trap here.
- No `THREE.Color` construction inside the frame loop. Cache them.

## 6. Performance budget

Target **60 fps at 1600×900** on an M-series laptop, degrading by dynamic
resolution rather than by popping detail.

- Draw calls ≤ 300 per frame. Batch/instance aggressively.
- Triangles ≤ 900k. Shadow-casting subset ≤ 250k.
- One directional shadow (2048², cascade-free, tightly fit to the play area),
  redrawn every second frame. Everything else uses baked or blob shadows.
- **Never** add a light mid-frame — a new light recompiles every material in
  the scene. Allocate the full light set at course load, and toggle intensity.
- **Never** resize a canvas mid-frame without redrawing — it clears to black.

## 7. QA hooks — the harness depends on these

`qa.js` must keep exposing `window.__APOP3D`:

```js
window.__APOP3D = {
  ready,                       // bool — first real frame has been drawn
  frame,                       // integer frame counter (harness polls this)
  loadCourse(n, spawn),        // jump straight to a course
  teleport(x, y, z),           // place the player
  setCamera(preset),           // named camera framing for shot goldens
  setAction(name),             // force a moveset action (for anim goldens)
  hideHud(on),                 // clear the HUD for blind comparison shots
  pin(on),                     // pin resolution/shadows for stable goldens
  stats(),                     // { fps, draws, tris, ms }
  advance(seconds),            // step the sim deterministically
};
```

Screenshots are captured by `scripts/apop3d-shots.mjs`, which **polls
`__APOP3D.frame`** rather than waiting a fixed time — headless Chromium
throttles rAF to about 1 fps and a fixed wait yields a black frame.

## 8. Course capture presets

`setCamera(preset)` must support these named framings; the blind-compare pool
is built from them, and they are chosen to match how SM64 screenshots are
actually framed (mid-distance, character at ~1/6 frame height, horizon high).

`arrival` · `vista` · `platforming` · `enemy-encounter` · `collect` ·
`boss` · `interior` · `water` · `high-ground`

---

## 9. Cross-module API — frozen signatures

These are the seams between agents. **Implement them exactly.** If you need
something more, add a new method; do not change an existing signature. Call
across a seam defensively (`ctx.collision?.raycast?.(...)`) so a module that
is still a stub degrades instead of throwing.

### collision.js
```js
{
  addStatic(mesh, opts)        // opts: { material:"stone"|"metal"|"grass"|"water"|"ice"|"slope", oneWay:bool }
  removeStatic(mesh)
  build()                      // (re)build the BVH; call after a course loads
  raycast(origin, dir, maxDist, out) // -> null | { point, normal, dist, material, mesh }
  sphereCast(origin, dir, radius, maxDist, out)  // same result shape
  capsuleQuery(base, top, radius, out) // -> array of { point, normal, depth, material }
  groundAt(x, z, fromY, maxDrop)       // -> null | { y, normal, material, mesh }
  wallProbe(pos, dir, radius, height)  // -> null | { normal, dist }
}
```
Result objects are pooled and reused. Copy anything you keep past the frame.

### physics.js
```js
{
  createBody(opts)   // { radius, height, mass, gravityScale, maxSlope } -> body
  destroyBody(body)
  step(body, dt)     // integrate + resolve; writes body.position/velocity/grounded
  moveAndSlide(body, delta) // -> { moved, hitWall, hitCeiling, hitGround, groundNormal }
}
// body fields the rest of the game reads:
// position(Vector3) velocity(Vector3) grounded(bool) groundNormal(Vector3)
// groundMaterial(string) slopeAngle(rad) platform(obj|null) inWater(bool) waterDepth(m)
```
Bodies riding a moving platform must inherit its delta *before* their own
integration, or the player slides off every lift in the game.

### materials.js
```js
{
  get(name, overrides)   // cached; returns a THREE.Material
  register(name, factory)
  toon(baseHex, opts)    // the shared cel/PBR hybrid used by all characters
  surface(name)          // level surface materials: "foodcourt.tile", "carpet.red", ...
  onBeat(strength)       // pulse any material that opted into beat reaction
  dispose()
}
```

### character.js
```js
{
  build(spec)   // -> { root:Object3D, skeleton, mesh, bones:{...}, height }
  specs         // { moggadonna, imp, lackey, plant, pig, bat, dancer, bouncer, drone, ... }
}
```
Bone names are fixed so anim.js can drive any biped:
`root hips spine chest neck head shoulderL armL forearmL handL shoulderR armR
forearmR handR thighL shinL footL thighR shinR footR`

### anim.js
```js
{
  attach(rig)                 // -> controller
  // controller:
  //   play(clipName, { fade, loop, speed, weight })
  //   setLocomotion(speedNorm, turnRate)   // blends idle/walk/run
  //   additive(name, weight)               // lean, breathe, recoil
  //   lookAt(worldPos, weight)             // head/neck IK
  //   footIK(on)
  //   squash(amount, duration)             // the landing/jump pop
  clips   // list of available clip names
}
```
Clip names the player expects to exist:
`idle idleFidget walk run skid jump doubleJump tripleJump longJump backflip
sideFlip wallSlide wallKick groundPoundStart groundPoundFall groundPoundLand
dive slide getUp crouch crawl land hardLand fall beam beamCharge aura hurt
dizzy victory carry swim tread climbLedge`

### input.js
```js
{
  move: {x, y},        // -1..1, camera-relative, deadzoned and radial-clamped
  moveMag,             // 0..1
  look: {x, y},        // mouse/right-stick delta this frame, radians
  cameraNudge,         // -1 | 0 | 1 discrete swing
  pressed(name), held(name), released(name)
  // names: jump crouch pound beam aura pause camReset camIn camOut
  bufferedJump()       // true if jump was pressed within the last 120ms
  consumeJump()
}
```
Jump must be **buffered** (120 ms) and **coyote-timed** (100 ms after leaving
ground). Without both, the triple jump is unlandable and the game feels broken.

### audio.js
```js
{
  beatPhase()          // 0..1 — takes over ctx.clock.beat when present
  onBeat(fn)           // callback each beat, gets { index, strength }
  play(name, opts)     // { pos:Vector3, gain, rate, delay }
  music(courseId, { fade })
  duck(amount, seconds)
  setMuted(on)
}
```

### vfx.js
```js
{
  burst(name, position, opts)   // "dust" "landRing" "sparkle" "poundShock"
                                // "beamHit" "coinPop" "recordGet" "auraWave"
  trail(object, name, on)
  decal(name, position, normal, size)
  shake(amount, seconds)
  flash(colorHex, amount, seconds)
}
```

### hud.js
```js
{
  setHealth(v, max) setClout(n) setRecords(n, total) setMog(v)
  toast(text, opts) prompt(text) clearPrompt()
  openMenu(name, data) closeMenu()
  setBeatPulse(strength)
  setVisible(on)     // qa.hideHud drives this
}
```

### collect.js
```js
{
  spawnRecord(id, position, opts)  // opts: { hidden, requires, onCollect }
  spawnClout(position, kind)       // "yellow" | "red" | "blue"
  spawnDeal(position, dealId)
  spawnSwitch(position, kind, onHit)
  collectedRecords(courseId)       // -> Set of ids
}
```

### world.js / levels.js
```js
// levels.js
{
  courses   // [{ id, name, theme, build(ctx, out), records:[...], music }]
  hub       // the Label Lobby definition
  primitives // shared builders: platform, slope, ramp, pillar, arch, rail,
             // movingPlatform, seesaw, rotator, elevator, pipe, water, tree
}
// world.js
{
  load(courseId, spawnIndex)  // async; disposes the previous course first
  unload()
  current                     // { id, def, group, spawns, bounds }
  register(obj, kind)         // "static"|"dynamic"|"decor" — drives batching
}
```

## 10. Working rules for parallel agents

- **Own only your files.** Read anything; write only what you are assigned.
- **Never edit `main.js`, `boot.js`, `core.js` or `CONTRACT.md`.** If the spine
  needs a change, say so in your handoff and the orchestrator makes it.
- **Every file must stay importable.** A syntax error in your module takes the
  whole game down for every other agent. Verify with
  `node --check assets/js/apop3d/<file>.js` before you finish.
- **Verify visually.** Run the shot harness (`node scripts/apop3d-shots.mjs
  --preset <name>`) and look at your own output before claiming done.
- **Match the house style.** Read `assets/js/saintfall/*.js` or
  `assets/js/blacksand/*.js` first. Block comments explain *why*, not *what*.
  No emoji in code. No decorative section banners beyond the file header.
- **Determinism.** Seed everything from `ctx.rng` or a fixed literal seed.
  Two runs of the same build must produce identical frames.
