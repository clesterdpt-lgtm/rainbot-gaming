# Super Slop Brothers character assets

The six fighters use a reproducible Meshy-to-Blender-to-Canvas2D pipeline. Meshy creates and rigs the textured character masters and supplies the selected motions. Blender normalizes each rig, strips world-space root translation, and renders fixed transparent poses. Pillow packs those poses into the WebP atlases loaded by the existing game.

The live game remains a Canvas2D fighter. The processed GLBs are preserved for future animation work and QA; they are not loaded into the match renderer.

## Runtime contract

Every fighter uses one `192 x 192` cell atlas with eight columns and these thirteen rows:

| Row | Clip | Source |
| ---: | --- | --- |
| 0 | `idle` | Meshy idle |
| 1 | `run` | Meshy basic run |
| 2 | `jump` | launch half of `special-up` |
| 3 | `fall` | descent half of `special-up` |
| 4 | `hit` | Meshy hit reaction |
| 5 | `shield` | held brace from `special-down` |
| 6 | `dodge` | fast phase of `special-side` |
| 7 | `grab` | reach phase of `special-neutral` |
| 8 | `attack` | full `special-side` strike |
| 9 | `special-neutral` | direct Meshy motion |
| 10 | `special-side` | direct Meshy motion |
| 11 | `special-up` | direct Meshy motion |
| 12 | `special-down` | direct Meshy motion |

Each row contains exactly eight frames. `idle`, `run`, `fall`, and `shield` are authored to loop while their state remains active; attacks and specials are visual one-shots. The fixed runtime paths are:

```text
assets/img/super-slop-brothers/animated/rainbot.webp
assets/img/super-slop-brothers/animated/gigachad.webp
assets/img/super-slop-brothers/animated/mrfeast.webp
assets/img/super-slop-brothers/animated/skibidi.webp
assets/img/super-slop-brothers/animated/sigma.webp
assets/img/super-slop-brothers/animated/slopbot.webp
```

The tracked runtime sheet budget is 3 MiB per fighter and 14 MiB for the roster. Every rendered pose must retain at least six transparent pixels on all four cell edges, and each preserved processed rig must remain under 15 MiB. If a sheet cannot load, the game falls back to the prior static body atlas.

## Asset ownership

Tracked, release-relevant files:

```text
concepts/<fighter>-reference.png
processed/<fighter>-rigged.glb
processed/<fighter>-blender-report.json
processed/<fighter>-atlas-report.json
assets/img/super-slop-brothers/animated/<fighter>.webp
super-slop-character-manifest.json
```

Local-only rebuild material:

```text
source/                 # Meshy masters, rigged downloads, basic motions, task metadata
animations/             # Meshy custom motion downloads and task metadata
processed/*-working.blend*
output/blender/super-slop-brothers/<fighter>/
```

The raw Meshy folders and editable Blender files are intentionally ignored. Keep the downloaded sources locally because Meshy download URLs expire. The tracked manifest retains task IDs, action IDs, consumed credits, source references, report data, byte counts, and SHA-256 hashes so a release can be traced back to its exact inputs.

## Meshy generation and motion IDs

`scripts/meshy-generate.mjs` reads `MESHY_API_KEY` from the environment or the ignored repository `.env`; it never stores the key in metadata. A fighter starts from its tracked concept:

```bash
node scripts/meshy-generate.mjs \
  --mode image-to-3d \
  --image assets/models/super-slop-brothers/concepts/rainbot-reference.png \
  --output assets/models/super-slop-brothers/source \
  --slug rainbot \
  --ai-model meshy-6 \
  --polycount 25000 \
  --pose a-pose \
  --texture-prompt "<copy this fighter's texturePrompt from the manifest>"

node scripts/meshy-generate.mjs \
  --mode rig \
  --task-id <image-task-id> \
  --height 1.7 \
  --output assets/models/super-slop-brothers/source \
  --slug rainbot
```

Repeat those commands for every fighter ID and use the rig height in the table below. The generation and rig requests stored in each local metadata file and copied into the final manifest are authoritative for model, topology, polycount, pose, texture settings, and height.

Generate `idle`, `hit`, and the four specials from the completed rig task. Use the following action IDs:

| Fighter | Rig height (m) | Idle | Hit | Neutral | Side | Up | Down |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Rainbot | 1.70 | 89 | 7 | 125 | 96 | 86 | 138 |
| Gigachad | 2.05 | 89 | 7 | 96 | 510 | 94 | 93 |
| Mr. Feast | 1.75 | 89 | 7 | 393 | 280 | 86 | 389 |
| Skibidi | 1.70 | 89 | 7 | 125 | 516 | 397 | 398 |
| Sigma | 1.85 | 89 | 7 | 104 | 94 | 402 | 93 |
| AI Slop Bot | 1.75 | 89 | 7 | 125 | 100 | 384 | 129 |

For example:

```bash
node scripts/meshy-generate.mjs \
  --mode animate \
  --task-id <rainbot-rig-task-id> \
  --action-id 125 \
  --output assets/models/super-slop-brothers/animations \
  --slug rainbot-special-neutral
```

The output slug must be `<fighter>-<motion>`, where motion is `idle`, `hit`, `special-neutral`, `special-side`, `special-up`, or `special-down`. Rigging supplies `<fighter>-run.glb` in `source/`; Blender derives the other shared gameplay clips from these seven source motions without changing gameplay timing.

## Blender preparation

Run Blender 4.5 or newer in background mode. This example prepares Rainbot; repeat it with the matching fighter paths:

```bash
blender --background --factory-startup \
  --python scripts/blender/prepare-super-slop-fighter.py -- \
  --fighter rainbot \
  --base assets/models/super-slop-brothers/source/rainbot-rigged.glb \
  --run assets/models/super-slop-brothers/source/rainbot-run.glb \
  --idle assets/models/super-slop-brothers/animations/rainbot-idle.glb \
  --hit assets/models/super-slop-brothers/animations/rainbot-hit.glb \
  --special-neutral assets/models/super-slop-brothers/animations/rainbot-special-neutral.glb \
  --special-side assets/models/super-slop-brothers/animations/rainbot-special-side.glb \
  --special-up assets/models/super-slop-brothers/animations/rainbot-special-up.glb \
  --special-down assets/models/super-slop-brothers/animations/rainbot-special-down.glb \
  --output-dir assets/models/super-slop-brothers/processed \
  --frames-dir output/blender/super-slop-brothers/rainbot \
  --save-blend assets/models/super-slop-brothers/processed/rainbot-working.blend \
  --force
```

This writes the animation-free reusable rig, one machine-readable Blender report, and 104 transparent PNG frames. Root X/Y/Z translation is neutralized because Canvas2D owns fighter displacement; the authored joint poses remain visible. The report is the authority for source motion mapping, normalization, geometry/material cost, camera and light settings, and every sampled source frame.

Pack the rendered frames into the fixed runtime atlas:

```bash
python3 scripts/build-super-slop-animation-atlas.py \
  --fighter rainbot \
  --frames-dir output/blender/super-slop-brothers/rainbot \
  --source-report assets/models/super-slop-brothers/processed/rainbot-blender-report.json \
  --output assets/img/super-slop-brothers/animated/rainbot.webp \
  --runtime-path assets/img/super-slop-brothers/animated/rainbot.webp \
  --report assets/models/super-slop-brothers/processed/rainbot-atlas-report.json \
  --min-alpha-margin 6 \
  --force
```

The packer verifies every RGBA frame, requires the six-pixel alpha safety margin, preserves transparency, retries WebP quality only within its configured floor, enforces the 3 MiB limit, and carries the Blender clip/source map into the atlas report.

## Canonical manifest

Only after all six processed rigs, atlases, and paired reports exist, run:

```bash
node scripts/build-super-slop-character-manifest.mjs
```

The builder refuses a partial or inconsistent pipeline. It cross-checks generation-to-rig and rig-to-animation task relationships, exact special action IDs, Blender sources, thirteen eight-frame rows, the alpha safety margin, canonical output paths, report byte counts and hashes, per-file budgets, and the combined roster budget. It then atomically writes `super-slop-character-manifest.json`; it does not call Meshy, Blender, or Pillow itself.

## Verification

```bash
python3 -m py_compile scripts/blender/prepare-super-slop-fighter.py
python3 -m py_compile scripts/build-super-slop-animation-atlas.py
node --check scripts/build-super-slop-character-manifest.mjs
node --check assets/js/super-slop-brothers.js
node scripts/test-super-slop-character-animations.mjs
git diff --check
```

Visually inspect all 24 directional specials in the focused browser captures at desktop and mobile sizes. Treat the existing hitboxes, damage, cooldowns, movement, CPU behavior, networking, and match rules as authoritative; this pipeline supplies visual animation only.
