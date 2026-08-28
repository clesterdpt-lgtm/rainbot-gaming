# 106 — Vesper-IX frame cost: cull what was never cullable

**Builds:** `20260827-vesper-perf-1` (culling/draw-order round), `20260827-vesper-perf-2` (choir-wheel far LOD) · **Scope:** Vesper-IX (first level) only — the summit and atoll modules are untouched.
**Constraint:** zero picture change in round 1 (culling granularity and draw order only); the round-2 LOD is the one deliberate exception, approved separately, and its visual delta is measured at its own worst case below.

## Why the frame had gotten heavier

The combat-density build (`2f5972be`) expanded garrisons and patrols map-wide. Re-measuring showed the old decomposition stale, and one instrument broken:

- `saintfall-perf-decompose.mjs`'s `no-shadow-up` toggle (`shadowMap.autoUpdate = false`) is a **no-op** since the interleave work: `render()` raises `shadowMap.needsUpdate` itself every frame when `shadowEvery <= 1`, which is exactly what `?qa=1` pins. Shadow cost was invisible to it. The real freeze is `setShadowEvery(1e9)`; `saintfall-perf-census.mjs` (new) measures that way and also charges every in-frustum triangle to a named mesh.

## What the census found (spawn, DPR 2, high tier, qa)

| item | cost/facts |
|---|---|
| MSAA 4× | ~12–15 ms |
| shadow redraw | ~8.4 ms per redraw, 611,912 casting tris in the sun box |
| sky dome | ~4.5 ms — `depthTest:false`, `renderOrder -1000`: shaded **every pixel of the frame** (three moons, stars, two suns), then the world overdrew most of it |
| AO + contact | ~2.5–5 ms |
| map-spanning merges | `scatter-rock` 96k, `road-surface-stone` 73k, `fosse-cloth` 69k, `rim` 35k, `road-stone` 19k, `fosse-iron` 14k tris — **in every camera frustum from everywhere**, and (scatter/road/fosse) inside every 250 m shadow-box test, because one merged mesh's bounding sphere spanned the basin |

## What shipped

1. **Batcher `chunk` option** (world.js): opt-in 256 m cell binning, cell key appended to the merge key and the *end* of the mesh name (collide.js matches the `road-surface-` prefix; the collision audit now sums the `road-stone*` family). Applied to the road (flagstones, kerbs, beds, saints, milestones), the fosse (bunkers, skulls, and the merged cloth/rust/iron runs — those are painted **before** a new `splitByCell()` because `paintByHeight` normalises to the merged bounding box, so painting per piece would move colours), and both map-wide scatters (yardang talus, the 3,400-boulder field — each piece already painted individually).
2. **Rim sectored** (world.js): the mountain ring is 16 frustum-culled sector meshes under a `Group` named `rim` (the isolate harness toggles `.visible` on that name). It surrounds every camera; a 60° fov sees 3–4 sectors.
3. **Sky dome drawn last, depth-tested** (sky.js): the dome vertex shader pins depth to exactly 1.0 and the material's default depthFunc is LEqual, so with `depthTest:true` at `renderOrder 1000` (out of the sky group — its renderOrder is a groupOrder that would defeat this) it fills exactly the pixels no geometry wrote. Identical output; only real sky pixels pay for the shader.

## Measured after

- Shadow-frustum casting tris **612k → 442k (−28 %)**; shadow redraw **8.4 → 5.6 ms** (players pay every 2nd frame).
- Dome cost **4.5 → 0.7 ms** (its cost is now proportional to visible sky).
- In-view tris: combat framing **670k → 406k**, vista 916k → 821k.
- DPR 2 qa baseline (shadow every frame) **~50 → ~47.7 ms**; the player path additionally keeps the dome win at every frame and the shadow win at half rate, and the dynamic-resolution controller converts the headroom into resolution.
- Draw calls 209 → 314 (chunking); CPU submit +0.3–0.6 ms at DPR 1 — invisible behind the GPU-bound frame.

## Proof it is the same picture

`saintfall-perf-ab-shots.mjs` (new): six deterministic stills (spawn/vista/road/fosse/scatter/night, three times of day), captured before and after. Fosse and scatter shots **byte-identical**; the rest differ on ≤ 0.03 % of pixels at ≤ 4/255 — and an after-vs-after control run of *identical code* shows the same magnitude and the same location (a flickering element by the cathedral silhouette; one run even showed a max-delta-190 ember sparkle between identical builds). The changes are inside run-to-run noise. `saintfall-perf-verify.mjs` all green (qa pinning, interleave byte-parity, controller mechanics, player-path defaults). `saintfall-collision-audit.mjs` 12/12 (road furniture still contributes 896 collider cells).

## Round 2 (`vesper-perf-2`): choir-wheel far LOD

The wheel (`gilded-reach-choir-wheel.glb`) is placed 16+ times at 17,712 tris a copy — ten visible from spawn (~177k tris of decorative wheels at 800–1,600 m, a few dozen pixels each), six more feeding 106k tris to the Reach's shadow box. Approved as the one deliberate pixels-may-change item.

**The far build** (`scripts/saintfall-build-far-lod.mjs`): 17,712 → 3,006 tris (17.0%), 124 KB, measured error 0.52% of extent. Two traps that cost the first attempts:
- gltf-transform's `simplify()` stalls at **61%** on this model however loose the error bound is — Meshy splits a vertex per UV-island seam (26,691 verts for 17,712 tris) and attribute-aware collapse treats every island edge as a border. The builder welds by **position bits** for connectivity (seam twins share exact bits) and calls `MeshoptSimplifier.simplify` directly, gltfpack-style.
- Even then plain flags stall at **93%**: the wheel is thousands of tiny disconnected components (rivets, beads) a topology-preserving collapse may not remove. `['Prune','Sparse']` is the working pair — Prune deletes sub-error components, and without Sparse the same call still returns the stalled result. Measured: target 17% reached at *half* the error cap.

**The runtime** (world.js): a `THREE.LOD` per placement, swap at `height × 20` (≈3° subtended, ~64 css px of a 720-line frame) with 6% hysteresis — the error bound projects to under one device pixel at that range for every wheel size, 12 m avenue pair to 44 m arena cross alike. The far clone is a render stand-in only: seating, collision, and the authored-mesh registry all still walk the full level (`Box3.setFromObject` walks invisible children, so the seating box is taken from the full level explicitly — measuring the pivot would have moved every seat a few cm). Far meshes are re-pointed at the full model's already-patched materials by name, so no second texture set uploads and no new shader program exists. three picks the level with the rendering camera and the shadow pass rasterises the same level, so swapped-out wheels leave the shadow bill too. Missing/failed far file ⇒ full detail everywhere, one console warn. The Saint's head and hand stay full-detail at every distance on purpose — they are the map's one landmark pair.

**Verification** (`scripts/saintfall-lod-wheel-probe.mjs` + the A/B rig):
- Spawn still: **byte-identical** — near wheels untouched.
- Worst case, framed dead-on at 1.15× the swap distance, far level vs LOD pinned full: **0.0246% of pixels, max delta 98** — and the 4× crops are not tellable apart (`output/saintfall/lod-wheel/`). Vista stills: diffs confined to the wheel sprites by the cathedral, 0.016%.
- Mechanics asserted: full level active inside the boundary, far level past it.

## Explicitly not done (would change pixels)

- MSAA/AO/tier changes, R11G11B10 scene target (6-bit mantissa risks re-banding the dark gradients the composite dither exists to fix), AO shader micro-optimisations (would shift golden LSBs).
- Far variants for the Saint's head/hand (the hero landmark pair, placed once each) and the drop pod (39.6k shadow tris, but it lives at spawn where the player stands).

New instruments: `saintfall-perf-census.mjs`, `saintfall-perf-ab-shots.mjs`, `saintfall-build-far-lod.mjs`, `saintfall-lod-wheel-probe.mjs`. `saintfall-perf-live.mjs` grew occlusion-throttle-proof launch flags (an occluded headed window reads 0.0 fps on macOS; that is the window, not the game). Note for future scripts: this repo has **no package.json on purpose** — installing a new dep with plain `npm install` PRUNES every package not named on the command line (it emptied node_modules of playwright/sharp mid-session; restored by reinstalling the union, playwright pinned to 1.61.0 to match the machine's cached chromium-1228). `meshoptimizer` is now part of the ambient set.
