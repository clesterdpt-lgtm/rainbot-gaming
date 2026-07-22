# Milestone 55 — Tardigrade Creature and Prop Asset Upgrade

Status: implementation and automated acceptance complete; final model appeal and animation feel await user playtest.

## Goal

Replace Tardigrade: Micro Mayhem's most visible procedural creature and tutorial-prop silhouettes with a cohesive low-poly set generated in Meshy and finished in Blender. Keep the existing five-level movement, collisions, goals, store, saves, and progression authoritative while the new GLBs provide richer anatomy, materials, sockets, and readable animation.

Game definition: `docs/tardigrade-micro-mayhem-plan.md`.

## Art direction

- Preserve the game's bright microscope-to-space comedy: chunky faceted silhouettes, clean warm/cool color blocking, slightly translucent biological surfaces, expressive faces, and no realistic body horror.
- The hero remains an unmistakable eight-legged tardigrade with a segmented body, short claws, dark eyes, and a readable oral tube. It should feel charming, resilient, and a little mischievous rather than plush or humanoid.
- Rotifers, ciliates, and waterbearlings should read as related microscopic life without sharing the same silhouette. Algae, bacteria, droplets, and pollen should remain legible at tutorial scale and retain their current gameplay color language.
- Meshy supplies textured low-poly masters. Blender is authoritative for cleanup, orientation, scale, material limits, named sockets, non-humanoid rigging, animation, and browser-safe export.

## Asset roster

- Animated hero: `hero-tardigrade.glb` with `idle`, `scuttle`, `dash`, `curl`, and `airborne` clips.
- Animated recurring creatures: `creature-rotifer.glb`, `creature-ciliate.glb`, and `creature-waterbearling.glb`, each with `idle`, `locomotion`, and `startled` clips.
- Tutorial props: `prop-algae.glb`, `prop-bacteria.glb`, `prop-droplet.glb`, and `prop-pollen.glb` as static assets.

## Acceptance criteria

- Meshy creates eight distinct textured low-poly masters from single-object prompts. Preview/refine task IDs, prompts, consumed credits, downloaded source filenames, hashes, and runtime destinations are retained in `assets/models/tardigrade/manifest.json`; raw downloads remain ignored.
- Blender imports every master, removes scene baggage, fixes normals, constrains materials and embedded textures, reduces geometry where needed, applies transforms, normalizes forward direction and gameplay-relative bounds, centers each footprint, and exports an uncompressed Three.js r128-compatible GLB.
- Blender authors the hero and three recurring creatures as non-humanoid animated assets. The hero exposes `idle`, `scuttle`, `dash`, `curl`, and `airborne`; each recurring creature exposes `idle`, `locomotion`, and `startled`. World translation remains owned by the existing JavaScript state and route groups.
- The hero export retains named `Head`, `Face`, `Back`, and `Camera` attachment sockets. Existing store skins, head/face/back cosmetics, research camera unlock, and trail behavior remain functional with the authored model.
- Runtime budgets are enforced: hero at most 14,000 triangles and 4 MiB; each recurring creature at most 10,000 triangles and 3 MiB; each prop at most 5,000 triangles and 1.5 MiB; no model uses more than four textures; the eight-model runtime set stays at or below 16 MiB.
- Runtime loading uses the vendored Three.js r128 GLTFLoader and SkeletonUtils, caches one source per archetype, clones animated instances safely, derives scale/orientation/grounding from measured GLB bounds, and never requires Draco or meshopt decoding.
- Procedural player, creature, and prop geometry remains a per-instance fallback until its matching GLB is ready and becomes visible again if that asset fails. Disposal of one clone cannot invalidate shared geometry, materials, or later stage instances.
- The new visual layer does not change `PLAYER_RADIUS`, prop radii/mass/restitution, creature routes, bonk distance, scoring, goals, saves, store ownership, or five-level progression.
- `window.render_game_to_text()`, `window.advanceTime(ms)`, and focused `window.__MICRO_MAYHEM_DEBUG` controls expose asset settlement, source, bounds, triangle/material/texture cost, active/fallback instances, clip/action state, and deterministic asset framing.
- A focused red-first browser regression validates manifest/provenance and GLB structure, animation clips and progression, budgets, attachment sockets, recurring-instance cloning, gameplay-proxy preservation, deliberate network-failure fallback, desktop and phone rendering, and zero unexpected local asset, console, or page errors.
- Desktop and 390×844 captures prove the hero, recurring creatures, and four tutorial props are grounded, correctly oriented, recognizable at play distance, and visually coherent. Final model appeal and animation feel are verified by user playtest.

## Out of scope

- Changes to physics, collision shapes, movement speed, camera behavior, scoring, objectives, store economy, saves, level order, or progression.
- Replacing terrain, zone dressing, traversal toys, HUD art, or the stage-specific duck, gut worm, crouton, ember skimmer, lava surfer, lab drone, roomba, germfluencer, and spore-ray joke creatures in this first pass.
- Runtime Meshy calls, humanoid auto-rigging, Draco/meshopt decoder additions, a bundler migration, or a new engine.

## Implementation notes

- Meshy generated eight accepted textured masters plus one rejected first-pass hero. The final roster consumed 240 generation credits; the rejected beetle-like hero exploration consumed 30 more. Exact task IDs, prompts, credits, source/runtime hashes, and destinations are recorded in `assets/models/tardigrade/manifest.json`.
- Blender 4.5 LTS cleaned and normalized every source, embedded three 512×512 PNG textures per asset, constrained the complete roster to 7.967 MiB, and exported browser-safe uncompressed GLBs. The four animated assets use non-humanoid rigs with zero world-root translation; periodic clip endpoint values and tangents match exactly.
- The corrected signed-orientation pass maps the accepted sources' `-Y` front to authored glTF `-Z`. Re-import checks place the hero's `Head` and `Face` sockets at the facial end, and Blender evaluated 301,623 deformed vertices across every clip without a non-finite result.
- The runtime loads the manifest once, caches one source per archetype, clones animated skeletons safely, fits authored visuals to the existing procedural bounds, and preserves every original gameplay root and collider. A failed ciliate download restores the visible procedural ciliate without interrupting play.
- The hero maps movement to `idle`, `scuttle`, `dash`, `curl`, and `airborne`; recurring creatures map to independent `idle`, `locomotion`, and `startled` mixers. Pause/title states freeze authored animation, legal air dashes retain their dash clip, non-classic store skins tint `SkinPrimary`, and head/face/back cosmetics mount to the Blender-authored sockets.
- Deterministic close views for every accepted asset and the hero action/store probes are under `output/iterate/tardigrade-meshy-blender-assets/`. Full desktop, 390×844 phone, and forced-ciliate-fallback captures are under `output/playwright/tardigrade-meshy-blender-assets/`.

## Verification

- `python3 -m py_compile scripts/blender/prepare-tardigrade-assets.py` — passed.
- `node --check assets/js/tardigrade-micro-mayhem.js` — passed.
- `node --check scripts/test-tardigrade-meshy-blender-assets.mjs` — passed.
- `TARDIGRADE_STATIC_ONLY=1 node scripts/test-tardigrade-meshy-blender-assets.mjs` — passed provenance, hashes, budgets, embedded texture dimensions, socket hierarchy, and real pose-variation checks.
- `node scripts/test-tardigrade-meshy-blender-assets.mjs` — passed all eight authored assets, independent recurring clones, hero action dispatch, unchanged gameplay proxies, desktop/mobile layouts, shared-resource survival, and deliberate ciliate network-failure fallback with zero unexpected browser errors.
- Store/cosmetic browser probe — passed Mint skin tint plus `hat-party → Head`, `face-goggles → Face`, and `back-flag → Back` parentage with all four Blender sockets live.
- `git diff --check` — passed for the scoped implementation.

## Exit condition

The user plays the Petri Dish on desktop or phone, sees the authored hero plus rotifer, ciliate, waterbearling, algae, bacteria, droplet, and pollen assets in motion, and confirms that the new low-poly style and animations are a clear improvement without any change in handling or tutorial interactions.
