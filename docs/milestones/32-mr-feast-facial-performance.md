# Milestone 32: Mr. Feast facial performance

## Status

awaiting-user-playtest

## Objective

Give Mr. Feast a restrained but readable silent facial performance so his polished host persona can fracture into something threatening without adding dialogue, combat, or detection. The existing skinned body, proportions, locomotion, and whole-home patrol must remain stable.

## Scope

- Add named Blender shape keys for independent restrained blink/squints, brows, controlled and widened smiles, asymmetric sneers, subtle lip parting, and jaw tension.
- Export a validated game-ready GLB retaining the 24-bone rig, one skinned mesh, 65,000-triangle budget, and existing material/texture setup.
- Add a lightweight Three.js facial controller with smooth preset blending, asymmetric blinking, subtle head attention, threat escalation, diagnostics, and deterministic QA controls.
- Add a QA-only look-at interaction that cycles the five presets in a fixed inspection order without making Mr. Feast interactable in the production game.
- Capture and review neutral/friendly, watching, threatened, and close-range expressions in the actual mansion lighting.

## Out of scope

- Speech visemes, recorded dialogue, or automated lip synchronization.
- Rebuilding separate eyeballs unless the initial shape-key result proves inadequate.
- Player detection, pursuit, capture, combat, or changes to the patrol route.

## Dependencies

- **Depends on:** milestone 31 and ADR 0001
- **Blocks:** future Mr. Feast detection/pursuit and dialogue milestones

## Acceptance criteria

- [x] Runtime GLB exposes the approved facial morph-target names while retaining one skinned mesh, 24 bones, stable bounds, and no validation errors — test: `scripts/test-mr-feast-renovation.mjs::Mr Feast facial asset`
- [x] Browser diagnostics expose facial preset, target/current weights, blink phase, attention state, and morph-target count — test: `scripts/test-mr-feast-renovation.mjs::Mr Feast facial diagnostics`
- [x] Deterministic QA can blend every preset and independent blink without changing hip scale, limb length, model height, or body animation — test: `scripts/test-mr-feast-contestant-13.mjs::facial controller`
- [x] Sabotaging the patron feed transitions the autonomous face from controlled host behavior to the threatened preset without altering quest progression — test: `scripts/test-mr-feast-contestant-13.mjs::facial threat escalation`
- [x] Looking at Mr. Feast in QA mode exposes an interaction that cycles neutral → friendly → watching → close → threatened and wraps cleanly, while normal game mode registers no character interaction — tests: `scripts/test-mr-feast-renovation.mjs::Mr Feast QA-only interaction`; `scripts/test-mr-feast-contestant-13.mjs::facial interaction`
- [x] Brow, smile, sneer, mouth, and jaw targets use readable but bounded displacement ranges instead of imperceptible 1–3mm movement — test: `scripts/test-mr-feast-renovation.mjs::Mr Feast readable facial displacement`
- [x] Runtime material tuning suppresses the Meshy export's full-strength self-illumination so mansion lights reveal brow, cheek, and mouth contours — test: `scripts/test-mr-feast-renovation.mjs::Mr Feast facial material readability`
- [ ] Neutral/friendly, watching, threatened, and close-range expressions read as sleek, creepy, and physically plausible in mansion screenshots — verified by user playtest

## Exit condition

User approaches Mr. Feast before and after sabotaging the patron feed → observes restrained asymmetric blink/squints and a smooth shift from controlled friendliness to an ominously widened smile without body distortion.

## Test plan

1. Add asset/source and Chromium assertions first; confirm they fail because the current GLB has zero morph targets and no facial QA API.
2. Generate the facial GLB through the checked-in Blender script and validate its glTF structure, bounds, rig, triangle count, and named targets.
3. Run the renovation regression and full Contestant 13 Chromium suite.
4. Use the look-at interaction plus deterministic QA presets for mansion screenshots and inspect the face at original resolution.
5. User playtests autonomous blinking and threat escalation for subjective restraint and creepiness.

## Notes

- Shape keys are authored on the final topology so morph deltas and the skin can coexist reliably in Three.js r128.
- Mesh audit found a texture-painted polygon soup with no eyelid loops, oral cavity, separate eyes, or facial bones. The safe first pass is intentionally limited to 1–3mm source-vertex motion; aggressive full blinks and jaw opening visibly tear the face.
- The facialized GLB remains 65,000 triangles and about 4.4MB by exporting sparse POSITION deltas without morph normals.
- Full lip synchronization and separate eye bones are preserved in `docs/backlog.md` rather than silently expanding this milestone.
- The first user playtest failed on readability: the interaction and weights changed correctly, but even full-strength combinations looked effectively identical in the mansion. The corrective pass must strengthen silhouette-changing mouth corners, brows, sneers, and jaw movement without attempting full eyelid closure or speech.
