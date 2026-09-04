# 116 — Saintfall perf: zero-contribution light guard, far-rig matrix freeze, HUD write dedupe

Build `20260903-perf-light-guard-1`. Picture-neutral. Follows m106 (Vesper
frame-cost pass, 2026-08-28).

## Why

After ~45 gameplay commits since the 08-28 perf pass the campaign felt slower
again. Measured on the dev Mac (M-series, DPR 2, 1440×810 css, HIGH):

| build | live rAF (spawn causeway, walking + firing) | dynres scale settled | main thread busy |
| --- | --- | --- | --- |
| 802dee1f (08-28 baseline, old HIGH tier) | 35.7 fps | 0.62 (floor) | 326 ms/s |
| 858ed52a (HEAD before this pass) | 48.7 fps | 0.62 (floor) | 482 ms/s |
| this pass | 53.5 fps (still climbing) | 0.85 | 320 ms/s |

HEAD was faster than the 08-28 baseline only because commit fb27debd had
quietly cut the HIGH tier (deviceCap 2→1.5, MSAA 4→2, shadow 4096→3072).
Per-frame CPU had grown ~10% (HUD DOM writes, enemy pathing) and the frame
was still GPU-bound at the resolution floor.

## What the GPU was actually paying for

`sf-gpu-ladder` (qa, DPR 2, HIGH, spawn, 60 frames, sync-drained):

| row | before | after |
| --- | --- | --- |
| baseline, native scale | 33.3 ms | 21.5 ms |
| all 21 point lights hidden | 20.1 ms | 18.5 ms |
| only the 10 zero-intensity point lights hidden | 26.4 ms | 19.7 ms |
| renderScale 0.62 (what players were seeing) | 22.0 ms | 14.0 ms |

**The resident lights were the largest single cost in the frame.** three's
forward loop runs the full GGX+Lambert `RE_Direct` for every light on every
lit fragment and only afterwards multiplies by an irradiance that is exactly
zero for a point light past its cutoff or parked at intensity 0. This level
keeps 21 point + 3 directional lights resident on purpose (the
constant-visible-light invariant from the cutscene-freeze work), and at any
pixel almost all of them contribute nothing.

## Changes

1. **`render.js` `installLightGuard(THREE)`** — patches
   `ShaderChunk.lights_fragment_begin` once, before the first compile, so
   each of the three `RE_Direct` calls (dir/point/spot) is guarded by
   `if ( directLight.color != vec3( 0.0 ) )`. Skipping an addition of exactly
   0.0 is the same picture; the light COUNT the program is keyed on is
   untouched, so no program ever recompiles because of this. Idempotent,
   warns and no-ops if three's chunk text moves. Applies to the summit and
   atoll packs too (they share `createRenderer`); both smoke-load clean.
2. **`enemies.js` far-rig matrix freeze** — `scene.updateMatrixWorld()`
   recurses into every child regardless of visibility and recomposes every
   `matrixAutoUpdate` node each frame; `matrixWorldAutoUpdate=false` only
   skips the multiply and still recurses. 514 of 523 enemy roots (19,073
   nodes) were hidden-far on the causeway and cost ~3.5 ms/frame computing
   matrices nothing read. A creature beyond its pose range, not dying, with
   no body chain, gets a root-only `updateMatrixWorld` (own property);
   thaw deletes it and forces one full pass. The combat readers that reach
   into far bones (`limbSpan`, sacs, heart) already call
   `bone.updateWorldMatrix(true,false)`, which is a different method and
   still correct. `enemies.stats().matrixFrozen` reports the count.
3. **`hud.js`** — `setText`/`setAttr` dedupe on every per-frame
   `textContent`/`setAttribute` (a same-string textContent still replaces
   the text node and dirties layout); HUD `clientWidth/Height` read at the
   top of `update()` before any write (was a forced synchronous layout
   every frame); minimap bounds from a ResizeObserver instead of a 20 Hz
   `getBoundingClientRect` after the frame's writes.

## Proof

- `saintfall-perf-ab-shots` base (unpatched HEAD) vs after: worst
  0.0216% of pixels, max channel delta 3 (scatter-dusk ember sparkle 184,
  as always). Same-code control pair: worst 0.0232%, delta 4 / 159. Within
  run-to-run flicker.
- `saintfall-perf-verify`: all checks passed.
- `sf-freeze-check` (scratch): 511/522 frozen at spawn; none shown/body;
  frozen root matrixWorld tracks position; combat bone reader delta 0 vs a
  full pass; thaw on approach restores prototype and pose is fresh;
  re-freezes when far.
- Live profile: `updateMatrixWorld`+`multiplyMatrices` 178 → 33 ms/s,
  `render()` inclusive 233 → 86 ms/s, `hud.update` self 28 → 16.5 ms/s.

## Left on the table

- `combat.approach → collide.findPath` ~1 ms/frame (budgeted; behaviour
  change to trim, not done here).
- Restoring the pre-08-29 HIGH tier (4× MSAA, cap 2, 4096 shadows) would
  cost ~+9 ms at DPR 2 on this machine and put the frame back on the
  dynres floor; left as a product call. ULTRA still carries it.
