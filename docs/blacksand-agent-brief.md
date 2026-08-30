# BLACKSAND — subsystem agent brief

Read this before touching anything. It is the contract every agent works against.

## What the game is

A combined-arms multiplayer FPS in Three.js, aiming at **Battlefield 2** production
quality: a 1024m desert theatre, five Conquest objectives, infantry, transports and
helicopters. It ships as a static page on the Rainbot site.

- Page: `games/blacksand.html`
- Styles: `assets/css/blacksand.css`
- Engine: `assets/js/blacksand/*.js` (ESM, Three r180 via CDN import map)
- Boot: `assets/js/blacksand/boot.js` (classic script, installs the import map)

## The ctx contract

`main.js` builds one `ctx` object and constructs every subsystem into it, in order.
A module exports `createX(ctx)` (sync or async) and returns an object assigned onto
`ctx` under a fixed key. A module may implement any of:

| hook | when | notes |
| --- | --- | --- |
| `fixedUpdate(dt, ctx)` | simulation | fixed 1/120s steps, may run several times per frame |
| `update(dt, ctx)` | per frame | variable dt |
| `lateUpdate(dt, ctx)` | after the camera is final | anything reacting to the finished camera |
| `report()` | QA | plain JSON, surfaced by `window.__BS.report()` |
| `dispose()` | teardown | |

**Modules never import each other for runtime state — they read it off `ctx`.** That is
what lets each one be rewritten independently. Import only for pure constants
(`LAYER`/`SURFACE` from `physics.js`, `TEAM` from `world.js`, helpers from `core.js`).

Construction order (dependencies flow downward):

```
input → render → textures → materials → sky → terrain → physics → structures
      → foliage → world → vfx → audio → characters → player → weapons
      → viewmodel → vehicles → bots → net → hud
```

If you need something built later than you, reference it lazily inside a hook
(`ctx.bots?.…`), never at construction time.

## Never break these

- **Three is `ctx.THREE`.** Only `main.js` imports `three` directly.
- **New module file? Add its name to `MODULES` in `boot.js`,** or browsers will serve a
  stale cached copy and your fix will look like it did not work.
- **No backticks inside GLSL.** The shaders live in JS template literals; a backtick in
  a GLSL comment silently ends the string. This has already cost one debugging round.
- **Everything procedural seeds from `ctx.seed`.** No new asset downloads, no new
  external hosts. Textures and geometry are generated at load.
- **Budget:** stay inside the tier values in `settings.js` (`ctx.settings.q`). Do not
  branch on device guesses of your own.
- **Draw calls matter.** Merge or instance. Current: ~600 calls / 1.26M triangles at
  ultra, 8ms p90. Report both every round.

## The harnesses

```bash
# Fast gate: syntax, imports, shader compiles, runtime errors. ~30s.
node scripts/blacksand-boot-check.mjs

# Beauty shots + objective image metrics. Writes PNGs and report.json.
node scripts/blacksand-shots.mjs --out output/blacksand-shots/<your-name>-1

# Are we inside Battlefield 2's measured distribution on every metric?
node scripts/blacksand-metric-compare.mjs --ours output/blacksand-shots/<your-name>-1

# Real frame cost. Gates on p90 per tier.
node scripts/blacksand-perf-probe.mjs

# Movement correctness: speeds, jump, stances, vault, slide, terrain.
node scripts/blacksand-movement-probe.mjs
```

**Ignore `frameMs` and `fps` in the boot check's report.** They are computed in
the requestAnimationFrame callback, which headless Chromium throttles to about
1fps — the "8 fps / 148ms" it prints is measuring the throttle, not the renderer.
`blacksand-perf-probe.mjs` times the frame directly. The real numbers are ~6.5ms
median and 8ms p90 at ultra with 1.26M triangles, so there is headroom.

### `material.envMapIntensity` is INERT here — do not tune it

Measured on the running build (1262 standard materials, none with their own
`envMap`, `scene.environmentIntensity` 1.064):

```
material.envMapIntensity  0  ->  frame luma 112.43
material.envMapIntensity  1  ->  frame luma 112.56
material.envMapIntensity  4  ->  frame luma 112.57
material.envMapIntensity 12  ->  frame luma 112.57     <- a 12x sweep moves 0.14
material.envMap = scene.environment, then intensity 0  ->  108.16
material.envMap = scene.environment, then intensity 4  ->  144.59     <- +36
scene.environmentIntensity 0.3 / 1.0 / 3.0            ->  104.4 / 116.6 / 127.2
```

On Three r180, when a material has no `envMap` of its own and inherits
`scene.environment`, **only `scene.environmentIntensity` scales the IBL.** The
per-material knob does nothing until `material.envMap = scene.environment` is also
assigned.

Three separate agents independently "fixed" black-looking geometry by raising
`envMapIntensity` to 2.6–4.2, and every one of those constants was dead. If you
need per-material control you must assign the envMap reference as well — and then
you own re-assigning it whenever sky.js regenerates the probe. Prefer changing
roughness/metalness, or the one scene-level knob.

**The metric suite is a floor, not a ceiling.** All seven metrics were inside the
Battlefield 2 distribution when a blind art-director agent still picked BF2 in 11
of 11 pairs. Statistics catch exposure, contrast, colour and detail density; they
are blind to missing shadows, missing AO, floating characters and repeating tiles.
Read `docs/blacksand-critic-round-2.md` and look at your own images.

Use **your own `--out` directory** so parallel agents do not fight over artifacts.

`window.__BS` is the automation surface (`qa.js`): `renderOnce`, `advanceTime`,
`setPose`, `lookAt`, `orbitPlayer`, `cameraClearance`, `setTimeOfDay`, `setWeather`,
`grade`, `hideHud`, `maximize`, `captureDataURL`, `report`.

### Two traps already paid for

1. **Never trust a fixed wait for "a frame happened".** Headless Chromium throttles
   `requestAnimationFrame` to about 1fps. Force frames with `__BS.renderOnce()` and poll
   `report().frame`.
2. **Never use `page.screenshot()` for the render.** It goes through the compositor,
   which is equally throttled — you get byte-identical captures of a stale surface.
   Use `__BS.captureDataURL()`, which reads the WebGL drawing buffer.

There is deliberately no image heuristic for "the camera is inside geometry". That
fault is geometric, not statistical. Use `__BS.cameraClearance()`.

## The bar

A separate art-director agent scores our frames **blind, side by side against real
Battlefield 2 screenshots**, and it is instructed to be hostile. "It renders" is not
the goal. The goal is that a hostile reviewer, not told which is which, picks ours.

### Round 2 result: we lost 0–11

A blind art-director agent picked Battlefield 2 in every one of 11 pairs. Its
prioritised defect list is `docs/blacksand-critic-round-2.md` — read it, and fix
what is yours. Its top finding, worth treating as a rule: *until every static and
skinned mesh is in the shadow caster pass, no other visual fix matters.*

Two of its calls have since been **disproved by measurement**, which is the right
way to answer a reviewer:

- "Structures cast no shadows" — they do; an A/B on `sun.castShadow` moves 10–13/255
  of the frame. The real fault was pose geometry: the street axis ran along the sun's
  arc, so every shadow fell behind its building, out of frame at every hour of the day.
- "Vehicles are pure black / cast nothing" — 64 of 78 vehicle meshes cast (the 14 that
  do not are glass, correctly). The pale ring read as an inverted contact patch was
  the tyre-track decal stamping a *bullet-hole* sprite at 0.62m.

If you think a finding is wrong, prove it with a measurement and say so. Do not
quietly ignore it.

## House style

Match the surrounding code. Comments explain **why**, especially where a decision
looks arbitrary or a cheaper approach was tried and failed — those comments are the
most valuable thing in the file. Do not narrate what the code already says.
