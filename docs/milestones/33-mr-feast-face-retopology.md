# Milestone 33: Mr. Feast face retopology

## Status

in-progress

## Objective

Replace the disconnected Meshy facial surface with an animation-ready face-only topology that preserves Mr. Feast's approved likeness, body rig, clothing, proportions, and whole-home locomotion. The new head system must support true eyelid closure, separate eyes, a visible mouth interior, and the existing ten facial controls without migrating away from the static Three.js runtime.

## Scope

- Build one connected facial surface with stable loops around both eyes, brows, cheeks, lips, and jaw while preserving the original hair, ears, back of head, neck, body, and wardrobe.
- Add separate left/right eyeballs, controllable eyelids, a dark oral cavity, and restrained teeth geometry.
- Reproject the approved source appearance onto the new facial surface and transfer compatible Head/neck skinning.
- Re-author the existing ten semantic facial targets on the new topology, including full independent blinks and a mouth opening that reveals the oral cavity.
- Export a browser-ready GLB and adapt the current multi-mesh facial controller and diagnostics without changing locomotion or gameplay.

## Out of scope

- Full-body or wardrobe retopology.
- Dialogue audio, visemes, automated lip synchronization, tongue animation, or cinematic close-up quality.
- Replacing Mr. Feast's approved identity, hair, tailoring, height, patrol, or body animations.
- Detection, pursuit, capture, combat, or other gameplay behavior.

## Dependencies

- **Depends on:** milestone 32 and ADR 0001
- **Blocks:** dialogue visemes and higher-fidelity close-up performance

## Acceptance criteria

- [x] A repeatable Blender pass outputs one connected retopologized facial surface, separate left/right eyes, eyelid-capable eye openings, an oral cavity, and teeth while retaining the existing character body — test: `scripts/test-mr-feast-renovation.mjs::Mr Feast retopology structure`
- [x] The runtime GLB retains the 24-bone body rig, stable 2.01m fit, no animation-scale tracks, at most 90,000 triangles, and at most 15MiB — test: `scripts/test-mr-feast-renovation.mjs::Mr Feast retopology budget`
- [x] The retopology report proves a single facial component, ten named non-empty POSITION-only morph targets, independent blink closure gaps of at most 1mm, and an opened-lip gap of at least 8mm — test: `scripts/test-mr-feast-renovation.mjs::Mr Feast retopology deformation`
- [x] Three.js diagnostics bind every facial target across the replacement meshes, cycle all five presets, and complete independent/paired blinks without changing model height, hip scale, limb length, or body animation — test: `scripts/test-mr-feast-contestant-13.mjs::retopologized facial controller`
- [ ] Neutral likeness, closed eyelids, mouth interior, controlled host smile, watching expression, close sneer, and threatened grin read cleanly without visible face seams or holes in mansion lighting — verified by user playtest

## Exit condition

User approaches Mr. Feast in the QA mansion and cycles the facial test → observes preserved neutral likeness, genuine independent and paired eyelid closure, a clean mouth opening, and clearly distinct host/watching/close/threatened expressions without body distortion or visible topology tears.

## Test plan

1. Add structural, budget, deformation, and browser assertions against the current Milestone 32 asset and confirm they fail because it still contains one disconnected polygon-soup mesh with no separate eyes or mouth interior.
2. Generate the retopologized face through a checked-in Blender script and record topology, component, deformation, material, rig, and budget facts in a machine-readable report.
3. Render deterministic Blender neutral/blink/mouth/smile previews before replacing the runtime asset.
4. Integrate the approved checkpoint GLB, run the mansion regression and full Chromium suite, and capture the five QA interaction presets plus independent/paired blinks.
5. Have the user approve neutral likeness, blink closure, facial seams, and expression quality in the live mansion.

## Notes

- This is a face-only replacement. Preserving the proven body mesh, skeleton, and animation GLBs minimizes scope and protects the current patrol.
- Facial pieces remain scene-root skinned meshes using the existing Head/neck groups. They must not be parented beneath the rig's `0.01` armature transform, which would apply the asset normalization twice in Three.js.
- The original Meshy texture is the appearance source. Reprojection/baking must not introduce a paid runtime dependency.
- Three.js r128 renders the eight strongest POSITION morph influences per mesh. Presets must therefore use no more than six expression targets so paired blinking remains within the eight-target runtime limit; morph normals and tangents stay disabled.
