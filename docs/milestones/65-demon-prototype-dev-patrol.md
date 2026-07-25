# Milestone 65 — Demon Prototype Dev Patrol

**Status:** Automated acceptance complete — user visual and patrol-feel approval pending
**Depends on:** Milestone 35 — Player Developer Mode; the existing Meshy/Blender character pipeline
**Blocks:** Choosing and canonizing a late-game demon design

## Objective

Turn the approved Pale Maw and Banquet Saint concepts into browser-ready, animated 3D prototypes that can be observed patrolling in developer mode without changing the normal Mr. Feast story experience.

## In scope

- Reference-led Meshy generation for the Pale Maw and Banquet Saint.
- One rigged, skinned runtime model for each prototype.
- Blender cleanup, grounding, scale normalization, material cleanup, and browser-budget validation.
- Stationary idle, walk, and run animation clips that bind to each runtime skeleton.
- Smooth patrol movement, facing turns, animation transitions, and short idle pauses.
- A developer-only patrol system, diagnostics, deterministic QA controls, and visual proof.

## Out of scope

- Canon story placement, reveal timing, combat, capture, damage, or player detection.
- Navigation-mesh or pursuit-AI integration.
- Creature collision, interaction prompts, inventory effects, clue effects, or save persistence.
- Replacing Mr. Feast or any contestant.
- Publishing the prototypes as finished production characters.

## Acceptance criteria

1. `assets/models/mr-feast/demon-prototypes/manifest.json` declares exactly the Pale Maw and Banquet Saint, including their approved reference image, Meshy generation and rig task provenance, Blender preparation report, runtime model, and animation clips.
2. Each runtime model is a valid glTF 2.0 skinned character, is grounded within `0.03 m`, has an authored target height between `1.9 m` and `2.5 m`, stays at or below `35,000` triangles and `4 MiB`, and uses textures no larger than `1024 px`.
3. Each prototype has separate stationary idle, walk, and run animation-only GLBs. Every clip has at least 20 bound bone-rotation tracks, loops without an obvious endpoint jump, changes the pose, and contains no mesh, skin, material, texture, scale, or translation channels.
4. With developer mode off, the system performs no prototype asset fetch, exposes zero visible prototypes, adds no colliders or interactions, and changes no story, clue, pursuit, contestant, or persistence state.
5. Enabling developer mode lazily loads both prototypes and places them on separate, authored open-space patrol routes. Each actor travels, smoothly turns toward its next leg, blends between locomotion and short idle pauses, remains grounded, and records at least one completed route leg in deterministic QA.
6. Disabling developer mode immediately hides both actors, stops their mixers, resets their patrol state, and leaves the existing developer-mode restore behavior intact.
7. `render_game_to_text()` and `window.MrFeastFresh` expose prototype load, visibility, route, grounding, clip-binding, active-action, travel, and turn diagnostics plus deterministic controls to await loading, advance the patrol, and frame either creature.
8. Desktop browser visual QA captures both prototypes from a readable full-body angle in the mansion, confirms recognizable correspondence with their approved concepts, and finds no persistent floor clipping, frozen bind pose, detached mesh, or extreme texture/material defect.

## Verification

- `node scripts/test-mr-feast-demon-prototypes.mjs`
- `node scripts/test-mr-feast-player-systems.mjs`
- `node scripts/test-mr-feast-contestant-conversations.mjs`
- `node scripts/test-mr-feast-renovation.mjs`
- `node scripts/test-mr-feast-contestant-13.mjs`
- `node --check assets/js/mr-feast-mansion.js`
- `git diff --check`
- Real-browser checks through `render_game_to_text()`, deterministic QA controls, console inspection, and full-body screenshots under `output/iterate/demon-prototypes/`

## Automated verification results

- The regression failed red first on the missing `DEMON_PROTOTYPES` tuning table, then passed static and real-browser acceptance after implementation.
- The Pale Maw uses Meshy generation `019f9b5d-7d11-7ab0-aa81-b2e86349304b`, rig `019f9b60-42ce-7ef1-8f49-b49c0b56efe3`, and idle `019f9b61-b827-7b3a-b4f0-eeff81415203`. The Banquet Saint uses generation `019f9b5d-7d27-746a-8d7b-6dca01766c48`, rig `019f9b60-42cd-7ef0-b02d-747528bb4c39`, and idle `019f9b61-b823-7b39-acf5-2649e2958104`. Each selected pipeline consumed `38` credits; the combined cost was `76`.
- Blender 4.5.11 prepared both models at exactly `30,000` triangles with one 24-bone skinned mesh and a single 768px packed texture. Pale Maw is `2.180m`, grounded at `-0.0003m`, and `2,412,152` bytes. Banquet Saint is `2.340m`, grounded at `-0.0003m`, and `3,180,516` bytes.
- All six runtime clip files are animation-only, loop-closed, stationary 24-track bone-rotation clips. Browser binding reports 24/24 bound rotations and live pose change for idle, walk, and run. The Banquet Saint's generic high-knee run was visually rejected because it collapsed the long robe; its optional fast clip now reuses the clean Meshy stride, while its authored patrol remains walk-only.
- Fresh normal-mode browser state reports `loadStatus: "idle"`, `fetchCount: 0`, `loaded: 0`, and `visible: 0`. Developer Mode lazily loads and shows exactly two actors; deterministic 18-second stepping makes both travel over one metre, complete a route leg, turn, and change pose. Disabling Developer Mode hides both, stops their actions, and resets every route counter.
- Neither actor has a collider, interaction, detection, clue, pursuit, competition, or persistence path. Existing contestant conversations and the complete Contestant 13 progression/gates/persistence/mobile suite pass.
- `node --check assets/js/mr-feast-mansion.js`, `node scripts/test-mr-feast-demon-prototypes.mjs`, its `MR_FEAST_BROWSER_QA=1` browser path, `node scripts/test-mr-feast-contestant-conversations.mjs`, `node scripts/test-mr-feast-contestant-13.mjs`, and `git diff --check` pass with a clean focused browser console.
- Adjacent baseline issues remain outside this milestone: renovation reports the already-selected rejected Mr. Feast face plus the existing page/runtime cache mismatch, and Player Systems reports the existing phone control footprint over its lower-24% target. This slice does not change those files or conditions.
- Blender neutral turntables live in `output/iterate/demon-prototypes/blender/`; clean in-mansion idle/walk/run captures for both creatures live in `output/iterate/demon-prototypes/browser/`.

## Exit criteria

The user can enable Developer Mode, observe the Pale Maw and Banquet Saint patrolling with readable silhouettes and active animation, frame either prototype for inspection, and disable Developer Mode to return to the unchanged normal game state.
