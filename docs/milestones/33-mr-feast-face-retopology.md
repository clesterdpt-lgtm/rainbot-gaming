# Milestone 33: Mr. Feast face retopology

## Status

paused — the July 2026 parametric face-appliance result was rejected and removed from the active runtime

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

- [x] The visually rejected appliance is absent from the active manifest and live scene while this milestone is paused; the intact 65,000-triangle, one-mesh, 24-bone model remains authoritative and cache-busted — test: `scripts/test-mr-feast-renovation.mjs::Mr Feast face release gate` and `scripts/test-mr-feast-contestant-13.mjs::stable release face`
- [x] A repeatable Blender experiment outputs one connected retopologized facial surface, separate left/right eyes, eyelid-capable eye openings, an oral cavity, and teeth while retaining the existing character body — offline diagnostic test: `scripts/test-mr-feast-renovation.mjs::experimental Mr Feast retopology structure`
- [x] The preserved experimental GLB retains the 24-bone body rig, stays below 90,000 triangles and 15MiB, and exposes ten non-empty POSITION-only targets — offline diagnostic test: `scripts/test-mr-feast-renovation.mjs::experimental Mr Feast facial asset`
- [ ] A replacement retopology proves bounded adjacent depth changes, seam-free joined boundaries, transferred boundary skin weights, recessed eyes, measured blink/mouth gaps, and approved neutral/three-quarter browser renders before activation
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
- Rejection evidence from the shipped experiment: the face spans about `193.9mm` in depth, adjacent grid edges jump as much as `120.8mm`, 926 edges exceed `10mm`, and the corneal surface sits several millimetres beyond the aperture plane. The separate lip rim repeats the same unsafe projection and intersects the retained head. These failures exist in the neutral Blender preview, before runtime lighting or animation.
- The release fix restores `processed/mr-feast-game-rigged.glb`, removes the unsupported face QA prompt, and changes both the page/runtime key and NPC asset key to `20260721-stable-face-1` so cached clients cannot retain the rejected model selection.
