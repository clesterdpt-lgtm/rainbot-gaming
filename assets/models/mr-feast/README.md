# Mr. Feast character asset

## Current status

- The approved visual direction is locked in `concepts/mr-feast-character-reference-v1.png`; the generation brief is stored beside it.
- A new Meshy 6 image-to-3D task generated the local textured source on 2026-07-15.
- Meshy auto-rigging produced a 24-bone humanoid plus basic walk and run motions. Custom idle and alert motions were also generated.
- Blender produced a browser build at exactly 65,000 triangles, one 1024px embedded texture, 1.92m source height, and 4.55MB on disk. The mansion fits it to 2.01m so the 1.84m player camera meets his eye line.
- The four tuned animation-only GLBs total 183,876 bytes. Each contains 24 rotation channels and one recentered Hips translation, with no scale or limb-translation tracks.
- The active release uses the intact 65,000-triangle, single-skinned-mesh model. The July 2026 parametric face-appliance experiment was visually rejected after its projected surface folded across unrelated source fragments, its separate eyes protruded beyond the sockets, and its overlapping face/lip surfaces produced visible breaks.
- The experimental 86,546-triangle retopology GLB, reports, and repeatable Blender scripts remain preserved for diagnosis only. They are not selected by the runtime manifest and must not be promoted without a rebuilt neutral face plus visual approval.
- The character now follows a visual-only 624.95m whole-mansion patrol through 227 waypoints, 30 major room/stair zones, and all three interior levels. He uses the grand and service stairs and automatically opens and safely clears the 21 doors required by the route. Collision, perception, pursuit, and attack behavior remain intentionally absent.

## Design lock

Mr. Feast is a tall, lean, fictional adult host whose threat comes from polish and restraint rather than monster anatomy.

- Height: 1.92-meter source asset, fitted to 2.01 meters in the mansion.
- Silhouette: narrow shoulders and waist, long limbs, fitted split tailcoat, no cape or bulky armor.
- Face: swept-back wavy black hair, close dark beard, high cheekbones, deep-set watchful eyes, and a controlled smile that is slightly too wide.
- Wardrobe: midnight-black velvet tailcoat, deep oxblood brocade waistcoat, charcoal cravat, high ivory collar, slim black trousers, pointed black boots, and one tarnished-gold medallion.
- Palette: midnight black, charcoal, dried oxblood, aged ivory, and very small tarnished-gold accents.
- Avoid: real-person likeness, logos, weapons, food props, gore, hats, capes, glowing eyes, horns, or overt supernatural effects.

The source face is texture-painted polygon soup and remains part of the active release. A deterministic connected-appliance experiment proved that component counts and non-empty morphs are not enough to establish facial quality: its first-hit projection sampled hair, neck, and back-head fragments, while separate overlapping eye/lip pieces created protrusion and seams. A future facial rebuild must validate surface continuity, eye fit, boundary joins, transferred skin weights, and approved neutral/three-quarter renders before activation.

The facial identity, smile, tailoring, and palette are derived from the fictional mansion paintings `The Patron of Empty Plates`, `The Feast of Merit`, and `The Infinite Giveaway`.

## Browser budget

- Source/master: 100,053 triangles with the original 2K texture, retained for Blender work.
- Active game model: 65,000 triangles, about 4.55MB, one 1024px embedded texture, one skinned mesh, and 24 bones.
- Preserved experimental retopology: 86,546 triangles, about 6.46MB, one 1024px projected face atlas, 24 bones, four morph meshes, and 18 semantic bindings; not release-authoritative.
- Source bounds: 0.9241m wide, 1.9200m high, and 0.4620m deep with feet at Y=0. Mansion fit: approximately 0.9674m × 2.0100m × 0.4837m.
- Runtime motion: restrained idle, grounded in-place stalk, cleaned alert/search, and cleaned in-place run. Play the stalk at `0.37` for the authored 0.62m/s patrol and scale that rate with actual travel speed.
- Add a grab/attack clip only when that gameplay is authored; do not infer an attack from the alert motion.

## Asset map

The raw API outputs and task metadata are preserved for recovery:

```text
assets/models/mr-feast/source/mr-feast-meshy-master.glb
assets/models/mr-feast/mr-feast-rigged.glb
assets/models/mr-feast/mr-feast-{idle,walk,alert,run}.glb
```

The runtime should load these files:

```text
assets/models/mr-feast/processed/mr-feast-game-retopo-face-v1.glb
assets/models/mr-feast/animations/mr-feast-idle-tuned.glb
assets/models/mr-feast/animations/mr-feast-stalk-tuned.glb
assets/models/mr-feast/animations/mr-feast-alert-clean.glb
assets/models/mr-feast/animations/mr-feast-run-clean.glb
```

`mr-feast-asset-manifest.json` is the canonical path and playback-rate map for future integration.

## Rebuild

The Meshy API helper reads `MESHY_API_KEY` from the environment or the git-ignored `.env` file. It never writes the key to task metadata. Run `node scripts/meshy-generate.mjs --help` for all generation and recovery modes.

Normalize and optimize the rigged base with Blender:

```bash
blender --background \
  --python scripts/blender/prepare-mr-feast-model.py -- \
  --input assets/models/mr-feast/mr-feast-rigged.glb \
  --output-dir assets/models/mr-feast/processed \
  --slug mr-feast \
  --target-height 1.92 \
  --target-triangles 65000 \
  --texture-size 1024 \
  --save-blend \
  --force
```

This writes the full-detail normalized master, the optimized rigged game model, a machine-readable report, and the working Blender file.

Add the sparse facial shape keys only after that optimization pass:

```bash
blender --background \
  --python scripts/blender/add-mr-feast-facial-shapes.py -- \
  --input-blend assets/models/mr-feast/processed/mr-feast-working.blend \
  --output assets/models/mr-feast/processed/mr-feast-game-faced.glb \
  --report assets/models/mr-feast/processed/mr-feast-facial-report.json \
  --preview-dir output/blender/mr-feast-face \
  --force
```

The sparse facial pass and parametric retopology are retained as intermediate diagnostic assets. To reproduce the rejected experiment from the same optimized working file:

```bash
blender --background \
  --python scripts/blender/retopologize-mr-feast-face.py -- \
  --input-blend assets/models/mr-feast/processed/mr-feast-working.blend \
  --output assets/models/mr-feast/processed/mr-feast-game-retopo-face-v1.glb \
  --report assets/models/mr-feast/processed/mr-feast-retopology-report.json \
  --preview-dir output/blender/mr-feast-retopo-v1 \
  --force
```

The experimental exporter keeps all skinned facial pieces at the scene root, matching the body. Parenting them under the already normalized armature double-scales them in Three.js. That transform rule remains valid, but it does not make the generated surface visually acceptable; the output stays offline until its projection, joins, eye fit, weights, normals, and browser renders pass a new quality gate.

Extract the motion data from Meshy's duplicate full-model animation downloads:

```bash
npm install --no-save --package-lock=false \
  @gltf-transform/core@4.4.1 \
  @gltf-transform/extensions@4.4.1 \
  @gltf-transform/functions@4.4.1 \
  playwright@1.61.1

node scripts/extract-mr-feast-animations.mjs --force
node scripts/tune-mr-feast-animations.mjs --force
```

The extraction step keeps standard, uncompressed animation data for compatibility with the vendored Three.js r128 loader. The tuning pass removes animation scale, removes non-Hips translation, recenters root motion, and restrains the idle/stalk rotations. Both deliberately avoid Draco, Meshopt, quantization, and resampling.

## Runtime loading

Load the processed base once with `GLTFLoader`. Create the `AnimationMixer` on that base scene, load each animation GLB, discard its temporary scene, and use only `gltf.animations[0]`. Move an outer character wrapper for navigation because all locomotion clips are in-place. Use `SkeletonUtils.clone` if more than one independently animated copy is needed.

## Integration gate

Before adding Mr. Feast to `assets/js/mr-feast-mansion.js`:

1. Load paths and animation rates from `mr-feast-asset-manifest.json`.
2. Fit the 1.92m source to the manifest's 2.01m mansion height and plant the wrapper on the current floor height.
3. Confirm the forward direction in the mansion; the QA front view sees his face at yaw `0` from positive Z.
4. Cross-fade idle, stalk, alert, and run rather than snapping between clips.
5. Take real browser screenshots in the mansion under normal and lights-off conditions.
6. Profile draw calls and frame time before enabling the roaming NPC in the vertical slice.

Meshy task metadata is retained locally for provenance and recovery. Do not delete it or make assumptions about licensing from the older free-plan attempt; distribution must follow the terms attached to the upgraded Meshy account and generated task.
