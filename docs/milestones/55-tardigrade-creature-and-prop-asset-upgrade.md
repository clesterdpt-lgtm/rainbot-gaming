# Milestone 55 — Tardigrade Creature and Prop Asset Upgrade

Status: reference-driven hero revision implemented and regression-covered; final model appeal and animation feel await user playtest.

## Goal

Replace Tardigrade: Micro Mayhem's most visible procedural creature and tutorial-prop silhouettes with a cohesive low-poly set generated in Meshy and finished in Blender. Keep the existing five-level movement, collisions, goals, store, saves, and progression authoritative while the new GLBs provide richer anatomy, materials, sockets, and readable animation.

Game definition: `docs/tardigrade-micro-mayhem-plan.md`.

## Art direction

- Preserve the game's bright microscope-to-space comedy: chunky faceted silhouettes, clean warm/cool color blocking, slightly translucent biological surfaces, expressive faces, and no realistic body horror.
- The hero follows the user-approved reference silhouette: uniform pale peach-pink skin, at least five deep overlapping rounded body folds, a prominent circular oral tube at the front, exactly four pairs of short planted lobopod legs, and fine readable ivory claws. It must not use painted stripes or bands, a shell/carapace, oversized side eyes, or the elongated grub/croissant silhouette of the retired hero.
- Rotifers, ciliates, and waterbearlings should read as related microscopic life without sharing the same silhouette. Algae, bacteria, droplets, and pollen should remain legible at tutorial scale and retain their current gameplay color language.
- Meshy supplies textured low-poly masters. Blender is authoritative for cleanup, orientation, scale, material limits, named sockets, non-humanoid rigging, animation, and browser-safe export.

## Asset roster

- Animated hero: `hero-tardigrade.glb` with `idle`, `scuttle`, `dash`, `curl`, and `airborne` clips.
- Animated recurring creatures: `creature-rotifer.glb`, `creature-ciliate.glb`, and `creature-waterbearling.glb`, each with `idle`, `locomotion`, and `startled` clips.
- Tutorial props: `prop-algae.glb`, `prop-bacteria.glb`, `prop-droplet.glb`, and `prop-pollen.glb` as static assets.

## Acceptance criteria

- Meshy creates eight distinct textured low-poly masters. The revised hero is regenerated through image-to-3D from an isolated reference derived from the supplied screenshot; the exact user-reference hash, isolated-input hash, image task ID, consumed credits, downloaded source filename/hash, and runtime destination are retained in `assets/models/tardigrade/manifest.json`. The other seven assets retain their text-to-3D preview/refine provenance; raw inputs and downloads remain ignored.
- Blender imports every master, removes scene baggage, fixes normals, constrains materials and embedded textures, reduces geometry where needed, applies transforms, normalizes forward direction and gameplay-relative bounds, centers each footprint, and exports an uncompressed Three.js r128-compatible GLB.
- Blender authors the hero and three recurring creatures as non-humanoid animated assets. The revised hero retains an exact four-pair leg rig, polishes the oral tube, folds, claws, grounding, and uniform peach material, and exposes `idle`, `scuttle`, `dash`, `curl`, and `airborne`; each recurring creature exposes `idle`, `locomotion`, and `startled`. World translation remains owned by the existing JavaScript state and route groups.
- The hero export retains named `Head`, `Face`, `Back`, and `Camera` attachment sockets. Existing store skins, head/face/back cosmetics, research camera unlock, and trail behavior remain functional with the authored model.
- Runtime budgets are enforced: hero at most 14,000 triangles and 4 MiB; each recurring creature at most 10,000 triangles and 3 MiB; each prop at most 5,000 triangles and 1.5 MiB; no model uses more than four textures; the eight-model runtime set stays at or below 16 MiB.
- Runtime loading uses the vendored Three.js r128 GLTFLoader and SkeletonUtils, caches one source per archetype, clones animated instances safely, derives scale/orientation/grounding from measured GLB bounds, and never requires Draco or meshopt decoding.
- Procedural player, creature, and prop geometry remains a per-instance fallback until its matching GLB is ready and becomes visible again if that asset fails. Disposal of one clone cannot invalidate shared geometry, materials, or later stage instances.
- The new visual layer does not change `PLAYER_RADIUS`, prop radii/mass/restitution, creature routes, bonk distance, scoring, goals, saves, store ownership, or five-level progression.
- `window.render_game_to_text()`, `window.advanceTime(ms)`, and focused `window.__MICRO_MAYHEM_DEBUG` controls expose asset settlement, source, bounds, triangle/material/texture cost, active/fallback instances, clip/action state, and deterministic asset framing.
- A focused red-first browser regression validates manifest/provenance and GLB structure, animation clips and progression, budgets, attachment sockets, recurring-instance cloning, gameplay-proxy preservation, deliberate network-failure fallback, desktop and phone rendering, and zero unexpected local asset, console, or page errors.
- Side/three-quarter Blender captures plus desktop and 390×844 browser captures prove the revised hero's oral tube, deep folds, uniform peach skin, four planted leg pairs, and fine claws remain readable both close-up and at play distance. The recurring creatures and four tutorial props remain grounded, correctly oriented, and visually coherent. Final model appeal and animation feel are verified by user playtest.

## Out of scope

- Changes to physics, collision shapes, movement speed, camera behavior, scoring, objectives, store economy, saves, level order, or progression.
- Replacing terrain, zone dressing, traversal toys, HUD art, or the stage-specific duck, gut worm, crouton, ember skimmer, lava surfer, lab drone, roomba, germfluencer, and spore-ray joke creatures in this first pass.
- Runtime Meshy calls, humanoid auto-rigging, Draco/meshopt decoder additions, a bundler migration, or a new engine.

## Implementation notes

- Meshy generated the final eight-asset roster plus three retired hero explorations. The accepted assets consumed 240 generation credits; the rejected beetle-like first hero, striped/grub-like second hero, and five-row third hero consumed 90 more. Hero v4 came from Meshy image-to-3D only after its isolated input visibly showed exactly four near-side legs; both image hashes, the image task ID, credits, source/runtime hashes, and destinations are recorded in `assets/models/tardigrade/manifest.json`.
- Blender 4.5 LTS cleaned and normalized every source, embedded at most three 512×512 PNG textures per asset, constrained the complete roster to 8.348 MiB, and exported browser-safe uncompressed GLBs. Hero v4 is a 13,881-triangle, 1.60 MiB skinned GLB with four measured planted rows, `SkinPrimary`, and a non-tintable `MouthDark` inset placed far enough forward to avoid WebGL depth fighting. The four animated assets use non-humanoid rigs with zero world-root translation; periodic clip endpoint values and tangents match exactly.
- The corrected signed-orientation pass maps the accepted sources' `-Y` front to authored glTF `-Z`. Re-import checks place the hero's `Head` and `Face` sockets at the facial end, and Blender evaluated 301,623 deformed vertices across every clip without a non-finite result.
- The runtime loads the manifest once, caches one source per archetype, clones animated skeletons safely, fits authored visuals to the existing procedural bounds, and preserves every original gameplay root and collider. A failed ciliate download restores the visible procedural ciliate without interrupting play.
- The hero maps movement to `idle`, `scuttle`, `dash`, `curl`, and `airborne`; its revised curl tucks the legs and uses a shallow body arc instead of the old upright U-pose. Recurring creatures map to independent `idle`, `locomotion`, and `startled` mixers. Pause/title states freeze authored animation, legal air dashes retain their dash clip, non-classic store skins tint only `SkinPrimary`, and head/face/back cosmetics mount to the Blender-authored sockets.
- The accepted reference-v4 Blender side/three-quarter captures are under `output/iterate/tardigrade-hero-reference-v4/`; the rejected v3 experiments remain under the adjacent reference-v3 folder for audit history. The standard desktop, 390×844 phone, focused hero, and forced-ciliate-fallback captures are under `output/playwright/tardigrade-meshy-blender-assets/`; the earlier complete roster/action/store probes remain under `output/iterate/tardigrade-meshy-blender-assets/`.

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
