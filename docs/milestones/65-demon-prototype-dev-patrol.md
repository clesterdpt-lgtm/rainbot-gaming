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
- Bespoke Blender locomotion: a leg-still ceremonial glide for the Banquet Saint and a clean-bind anatomical creep for the Pale Maw.
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
9. The HTML and runtime publish the same demon-prototype cache identity, and the browser test enables and disables the patrol through the visible Escape-menu Developer Mode button.
10. The Banquet Saint's idle, walk, and run use the forward-facing processed bind pose, keep both knees and elbows at least `178.5°` straight, hold every lower-body track still, and let both straight arms trail at least `0.04m` behind travel as one restrained pendulum. The Pale Maw model exactly preserves the accepted processed-source bind (`cb0aac538d2e2cf9665a6e6fc84652226c1d8a7e3364c99d92636a2f9fcdbb5c`) with no baked hips, shoulder, neck, head, arm, or lateral reshaping. Every skin joint outside the ten upper/lower limb and palm-orientation drivers remains within `0.02°` of that bind in every clip. Walk and run use twist-free two-bone contact targets on all four limbs, pair left hand with right foot and right hand with left foot at correlation `>= 0.95`, keep the front-elbow span at or below `1.65m` and each elbow no more than `0.55m` outside its shoulder, keep every knee/elbow in its authored bend plane above `40°` with no more than `60°` of range, keep skin-edge growth below `0.11m`, plant every weighted hand/foot surface within `0.055m` of the floor for at least `16%` of the sampled cycle, lift each recovering limb at least `0.04m`, sweep every hand and foot at least `0.45m`, and cover the root's full planted half-cycle.

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

- The default-bind regression failed red first because the prior runtime report still declared `extended-horizontal-crawler`. Blender preparation now applies only the original uniform scale, grounding, mesh cleanup, and browser-budget pass: it reproduces the accepted Pale Maw GLB byte-for-byte at SHA-256 `cb0aac538d2e2cf9665a6e6fc84652226c1d8a7e3364c99d92636a2f9fcdbb5c`. The elbow-tuck regression then failed red because the restored clips had no inward-pole control and reached a `2.217m` elbow span. Locomotion now keys the eight upper/lower limb drivers plus two wrist counter-rotations; every torso, shoulder, neck, head, foot, and toe joint stays on the default bind. The demon manifest/cache identity is `20260726-pale-maw-elbow-tuck-1`, and the focused browser path still uses the visible Developer Mode button.
- The accepted Pale Maw replacement uses Meshy generation `019f9dee-12b0-78aa-b20b-8e9c0bf1107b` and rig `019f9df0-6c58-7230-8917-00d7042b61cc` for `35` credits. Its rigging reference preserves the low four-point silhouette while placing continuous background gaps between every arm and leg. The unchanged Banquet Saint uses generation `019f9b5d-7d27-746a-8d7b-6dca01766c48`, rig `019f9b60-42cd-7ef0-b02d-747528bb4c39`, and idle `019f9b61-b823-7b39-acf5-2649e2958104` for `38` credits. The current selected pipelines total `73` credits; including the original Pale Maw and one rejected upright separation retry, cumulative prototype exploration is `146` credits.
- Blender 4.5.11 prepares the restored Pale Maw at `29,999` triangles, one 24-bone skinned mesh, one 768px packed texture, `2.180m`, exactly grounded at `0.000m`, and `2,468,728` bytes. Its original default bounds are `2.692m × 1.772m × 2.180m`; the visible head sits `0.200m` above the hips with no corrective neck or head bake. The unchanged Banquet Saint remains `30,000` triangles, `2.340m`, grounded at `-0.0003m`, and `3,180,516` bytes.
- All six runtime clip files are Blender-authored, animation-only, loop-closed, stationary 24-track bone-rotation clips. Browser binding reports 24/24 bound rotations and live pose change for idle, walk, and run. The Banquet Saint now begins from its forward-facing processed bind pose, keeps both knees and elbows at `180°`, and glides through root translation with every lower-body rotation still. Its two straight upper limbs move together through restrained `3°` idle, `7°` walk, and `8°` run pendulum arcs; the moving clips keep both hands at least `0.05m` behind the travel axis.
- Pale Maw idle settles all four weighted surfaces while walk and run solve both upper and lower limb rotations with no axial twist and at most `0.000009m` of IK target error. A symmetric `0.38` inward pole reduces maximum front-elbow span from `2.217m` to `1.565m` idle, `1.449m` walk, and `1.413m` run; maximum outward shoulder offset stays at or below `0.522m`. Per-frame analytic keys prevent interpolation from leaving that bend plane, while two wrist counter-rotations preserve palm contact. Walk gives every hand/foot a balanced `0.660m` sweep, `0.311–0.422m` recovery lift, at least `23%` planted samples, at most `0.033m` penetration, and `0.083m` maximum surface-edge growth. Run gives every limb a balanced `0.680m` sweep, `0.345–0.457m` lift, at least `28%` planted samples, at most `0.034m` penetration, and `0.076m` edge growth. The default asymmetric crouch stays above `47.7°` at every knee/elbow and below `59.4°` of joint range. Live eight-phase correlations prove left hand/right foot and right hand/left foot are the two support pairs while every sweep covers its planted-half-cycle root travel.
- Fresh normal-mode browser state reports `loadStatus: "idle"`, `fetchCount: 0`, `loaded: 0`, and `visible: 0`. Developer Mode lazily loads and shows exactly two actors; deterministic 18-second stepping makes both travel over one metre, complete a route leg, turn, change pose, and maintain at least `0.96` visual-forward alignment with actual travel. Runtime anatomy diagnostics independently sample facing, knee/elbow angles, front-elbow span/outward offset, arm trail, and hand/foot displacement at eight phases of every clip. Disabling Developer Mode hides both, stops their actions, and resets every route counter.
- Neither actor has a collider, interaction, detection, clue, pursuit, competition, or persistence path. Existing contestant conversations and the complete Contestant 13 progression/gates/persistence/mobile suite pass.
- `node --check assets/js/mr-feast-mansion.js`, `node scripts/test-mr-feast-demon-prototypes.mjs`, its `MR_FEAST_BROWSER_QA=1` browser path, `node scripts/test-mr-feast-renovation.mjs`, `node scripts/test-mr-feast-contestant-conversations.mjs`, `node scripts/test-mr-feast-contestant-13.mjs`, and `git diff --check` pass with a clean focused browser console.
- Renovation passes after the page/runtime cache identity alignment. Contestant Conversations and the complete Contestant 13 desktop/mobile progression, gates, persistence, accessibility, and touch suite pass. The adjacent Player Systems run reaches its unchanged phone layout audit and stops on the existing lower-control-footprint `24%` assertion; this demon-only slice changes no control or stage layout.
- Final Pale Maw tucked-elbow contact and recovery renders live in `output/iterate/demon-prototypes/blender-default-bind-elbow-tuck-final/`; clean in-mansion idle/walk/run captures live in `output/iterate/demon-prototypes/browser/`, the focused shipped front proof is `output/playwright/pale-maw-elbow-tuck/pale-maw-walk-front.png`, and the prior opposite diagonal side contacts remain in `output/playwright/pale-maw-default-bind-limbs/`.

## Exit criteria

The user can enable Developer Mode, observe the Pale Maw and Banquet Saint patrolling with readable silhouettes and active animation, frame either prototype for inspection, and disable Developer Mode to return to the unchanged normal game state.
