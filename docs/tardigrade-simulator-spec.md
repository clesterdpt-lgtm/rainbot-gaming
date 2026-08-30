# Tardigrade Simulator — build specification

**This document is the coordination contract. Every agent working on this game reads it
before touching code, and does not change any interface defined here without saying so
loudly in its final report.**

---

## 1. What we are building

An open-world, physics-driven comedy sandbox in Three.js, benchmarked directly against
**Goat Simulator (Coffee Stain, 2014)**. You are a tardigrade — a half-millimetre water
bear, functionally indestructible — loose in a suburban back garden that is, at your
scale, a vast landscape.

The comedy is Goat Sim's comedy: absurd physics, ragdolls, a grappling tongue, wild
combos, and a world that reacts to being wrecked. The *presentation* must be far better
than Goat Sim's. Goat Sim is a 2014 UE3 game with muddy textures, flat lighting and
low-resolution shadows. We are targeting a modern PBR look: physically correct materials,
image-based lighting, soft shadows, ambient occlusion, and a filmic grade.

**The acceptance bar:** a harsh critic, shown our screenshot and a Goat Simulator
screenshot side by side without being told which is which, must pick ours as the
better-looking image. Not "comparable". Better.

## 2. Scale system

The world is measured in **body lengths**. The hero tardigrade is **1.6 units** long.

| Real object | World units |
|---|---|
| Tardigrade (hero) | 1.6 long, ~0.7 tall |
| Grain of sand | 0.3–0.8 |
| Pollen grain | 0.05 |
| Moss leaf | 2–5 |
| Blade of grass | 60–140 tall |
| Fallen leaf | 90–160 across |
| Human shoe | 500 |
| Terracotta plant pot | 700 tall |

The playable map is roughly **900 × 900 units** — a patch of patio and flowerbed a human
would call "about a foot across". Keep this consistent; scale is the single most important
thing selling the micro-world fantasy.

Gravity is `ctx.GRAVITY = -19.6`. This is arcade gravity, not real physics. Do not
"correct" it.

## 3. Module contracts

Every module exports one async factory taking `ctx` and returning an API object. Optional
lifecycle hooks: `fixedUpdate(step, ctx)`, `update(dt, ctx)`, `lateUpdate(dt, ctx)`,
`resize(w, h)`, `report()`, `dispose()`.

Load order (a system may use anything created before it, never after):

```
materials → physics → world → props → tardigrade → player → vfx → audio → ui
```

### `materials.js` — `createMaterials(ctx)`
```
get(name)             -> THREE.Material   (cached + shared; never mutate the result)
make(name, overrides) -> THREE.Material   (a clone you may mutate)
texture(name)         -> THREE.Texture
list()                -> string[]
report()              -> { count, textures, ... }
```

**Authoritative material name registry.** Other systems already call these names. You may
*add* names, you may not rename or remove:

`soil`, `moss`, `gravel`, `leaf`, `bark`, `stone`, `concrete`, `ceramic`, `metal`,
`paintedWood`, `plastic`, `water`, `chitin`, `glass`

### `physics.js` — `createPhysics(ctx)`
```
world                                   -> RAPIER.World
addStatic({position, rotation, shape})  -> { body, collider }
addDynamic({position, shape, mass, restitution, friction, mesh}) -> handle
addTrimesh(geometry, matrix4)           -> { body, collider }
raycast(origin, dir, maxDistance)       -> { hit, point, normal, distance, collider }
setGravity(y)
fixedUpdate(step, ctx)
report()                                -> { bodies, colliders, stepMs }
```

### `world.js` — `createWorld(ctx)`
```
root              -> THREE.Group already added to ctx.scene
bounds            -> { radius, min:[x,z], max:[x,z] }
heightAt(x, z)    -> number (ground height in world units)
spawnPoint()      -> THREE.Vector3
getBeautyShots()  -> pose[] | null   (see §5)
report()
```

### `tardigrade.js` — `createTardigrade(ctx)`
```
root                     -> THREE.Group (positioned by player.js)
length                   -> number
setPose({ speed, grounded, airborne, curled, ragdoll, turnRate })
setFacing(yaw)
playOneShot(name)        -> 'bonk' | 'chomp' | 'land' | 'squeak'
update(dt, ctx)
report()
```

### `player.js` — `createPlayer(ctx)`
```
position   -> THREE.Vector3  (other systems read this; do not reassign the object)
velocity   -> THREE.Vector3
teleport(x, y, z)
fixedUpdate(step, ctx) / update(dt, ctx)
report()
```
**Hard rule:** when `ctx.qa.cameraLocked === true`, `player.js` must not write to
`ctx.camera`. The screenshot harness owns the camera then.

### `props.js`, `vfx.js`, `audio.js`, `ui.js`
Free-form, same lifecycle shape. `ui.js` owns `#ts-hud`, `#ts-touch`, `#ts-overlay`.

## 4. Shared services on `ctx`

```
ctx.THREE, ctx.RAPIER, ctx.renderer, ctx.scene, ctx.camera, ctx.engine
ctx.settings.quality.*     -> read this instead of hard-coding counts/resolutions
ctx.input                  -> .move {x,y}, .look {x,y}, .down(a), .pressed(a)
ctx.events                 -> on/emit bus
ctx.rng                    -> seeded PRNG. NEVER call Math.random().
ctx.time                   -> { dt, scaledDt, elapsed, frame, fps }
ctx.state                  -> { phase, score, combo, comboBest }
ctx.track(resource)        -> register anything with .dispose()
ctx.GRAVITY, ctx.FIXED_STEP
```

### Event registry
Emit and listen; do not call across systems directly for these.

| Event | Payload | Emitted by |
|---|---|---|
| `ready` | ctx | main |
| `resize` | {width,height} | main |
| `player:land` | {position, impactSpeed, surface} | player |
| `player:jump` | {position} | player |
| `player:grapple` | {from, to, target} | player |
| `player:ragdoll` | {enabled} | player |
| `impact` | {position, normal, speed, material} | player/props |
| `prop:destroyed` | {position, kind} | props |
| `score` | {amount, reason, position} | any |
| `combo` | {count, multiplier} | player |

## 5. Beauty shots (how visual review works)

`world.getBeautyShots()` returns the canonical camera poses used for every screenshot
review. Each pose:

```js
{ id: 'kebab-id', name: 'Human name',
  position: [x, y, z], target: [x, y, z], fov: 55,
  followHero: false }   // if true, position/target are relative to the hero
```

Provide at least 8 covering: a wide establishing shot, a hero close-up, a ground-level
shot, a backlit/rim-light shot, a shot showing the water surface, a shot inside dense
foliage, a shot of the biggest landmark, and a shot showing physics props at rest.

**Capture command:**

```bash
node scripts/tardigrade-shots.mjs --out output/tardigrade-shots/<name> --poses all
```

Then `Read` the PNGs. Screenshots are the only acceptable proof that something looks good.
`report.json` in the same directory carries diagnostics, console errors and page errors.

## 6. Quality rules

1. **No `Math.random()`.** Use `ctx.rng` or `makeRng(seed)` so screenshots are stable
   frame-for-frame and reviews are comparable.
2. **Respect `ctx.settings.quality`.** Scatter counts, texture sizes, particle counts and
   shadow settings all scale off it. Ultra is the review target; low must still run.
3. **Instance everything repeated.** Thousands of grass blades, gravel and pollen must be
   `InstancedMesh` (or points), never individual `Mesh` objects. Budget: under 900 draw
   calls at Ultra.
4. **Every material must be physically plausible.** Correct roughness/metalness, real
   normal maps, and AO where it earns its cost. No flat untextured `MeshStandardMaterial`
   with a solid colour in the shipped world.
5. **Register disposables** via `ctx.track()`.
6. **No console errors and no page errors, ever.** `report.json` records them and a run
   with page errors is a failed run.
7. Performance target: 60fps at 1600×900 Ultra on an M-series Mac. `report.json` gives you
   `frameMsP90`; keep it under 16.7.

## 7. Anti-goals

- No build step, no bundler, no TypeScript. Plain ES modules served statically.
- No downloaded art assets. Everything is generated procedurally in code. This is a hard
  constraint and it is also the interesting part of the problem — procedural PBR done well
  beats a bad texture download.
- No gore, no realistic body horror. This is bright, sunlit, funny.
- Do not edit another system's file. If you need something from another module, use the
  documented API or `ctx.events`, and note the need in your report.
