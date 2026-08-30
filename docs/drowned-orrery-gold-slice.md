# Drowned Orrery gold slice

The gold slice replaces the opening encounter's placeholder presentation with three original Blender-authored assets: the Tidemark Surveyor, the Bell Warden, and the Meridian Lock. The procedural game remains authoritative for collision, traversal, combat, and gate state; imported art is a presentation layer so the upgrade cannot silently change game rules.

## Visual thesis

- **Tidemark Surveyor:** compact six-head adventurer; split salt-canvas mantle, indigo oilskin body, raised instrument case, chest compass, and a long sounding rod. The case and rod create an asymmetric silhouette before texture or lighting is visible.
- **Bell Warden:** a taller pressure-bell guardian on stilted legs. Its oversized anchor gauntlet, open reed-cage arm, recessed amber eye, and cracked cuirass keep it distinct from the hero in silhouette.
- **Meridian Lock:** a broken mineral halo around three offset bronze meridian rings, supported by bearings, buttresses, drains, cables, counterweights, and submerged foundations. Missing upper sectors and the collapsed right pier give the landmark authored asymmetry without weakening its circular destination cue.

The palette is drowned teal, blue-black, salt ivory, aged bronze, restrained cyan navigation light, and a separate amber threat accent. Geometry carries primary and secondary form; generated textures provide weave, pitting, strata, tide staining, roughness breakup, and tangent-space normal detail.

## Source and outputs

The complete authoring pipeline is deterministic and contains no third-party art:

- `scripts/blender/build_drowned_gold_slice.py` creates the meshes, UVs, texture maps, materials, rigs, clips, staging scene, GLBs, manifest, and QA renders.
- `games/drowned-orrery/models/gold-slice/drowned-gold-slice.blend` is the editable staged Blender source.
- `hero.glb`, `sentinel.glb`, and `orrery_gate.glb` are independently cacheable runtime assets.
- `manifest.json` records clip semantics, normalized combat events, scale, coordinate assumptions, and build diagnostics.

Run the authoring pipeline with Blender 5.2 LTS:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' `
  --background --factory-startup `
  --python '.\scripts\blender\build_drowned_gold_slice.py'
```

The script emits its visual evidence under `output/qa/drowned-orrery/gold-slice/`, including 720p and 1080p compositions, grayscale and thumbnail checks, four-angle character turntables, gate views, and attack anticipation/contact/recovery poses.

## Runtime contract

The hero exports eleven named in-place clips:

- `hero_idle`, `hero_walk`, `hero_run`
- `hero_turn_l`, `hero_turn_r`, `hero_dodge`
- `hero_strike_light`, `hero_strike_heavy`
- `hero_gate_interact`
- `hero_hit`, `hero_defeat`

The Bell Warden exports nine named in-place clips:

- `sentinel_idle`, `sentinel_patrol`, `sentinel_turn`, `sentinel_alert`
- `sentinel_sweep`, `sentinel_slam`
- `sentinel_hit`, `sentinel_stagger`, `sentinel_collapse`

The Meridian Lock exports `gate_closed_idle`, `gate_unlock`, and `gate_open_idle`. Three.js fetches the packaged manifest, validates the complete clip contract, applies authored orientation metadata, and owns crossfades and gameplay timing. Locomotion clips loop normally. Attacks are synchronized against the game's normalized attack phase with a brief contact hold, so authored contact, damage, VFX, and audio cannot drift apart. The imported gate follows the authoritative procedural barrier/opening state through its three authored clips while analytic world collision remains authoritative.

## Current budgets

The generated slice stays deliberately compact for a browser runtime:

| Asset | Triangles | Mesh primitives | Materials | Animation clips |
|---|---:|---:|---:|---:|
| Tidemark Surveyor | 11,556 | 7 | 7 | 11 |
| Bell Warden | 13,396 | 5 | 5 | 9 |
| Meridian Lock | 38,936 | 7 | 5 | 3 |

The three GLBs total 15.00 MiB with embedded 512px authored PBR maps. Both character files contain one skin with seam-localized weights on deforming shells and rigid weights on hard equipment; the landmark uses object animation for its lock mechanism. Every export is explicitly triangulated and smart-unwrapped before glTF generation.

## Acceptance policy

An export is not accepted merely because it loads. The slice must pass these checks:

1. Hero, enemy, and gate remain distinct in grayscale and at 320×180.
2. The opening composition communicates destination, player, and threat without labels.
3. Five material families remain legible: cloth, leather, wet/mineral stone, aged metal, and emissive glass/light.
4. Anticipation, contact, and recovery produce distinct silhouettes.
5. GLB clip names, skins, primitive counts, and payload budgets match the manifest.
6. The Three.js runtime preserves combat, collision, camera, and gate mechanics if an asset fails to load.
7. Desktop and reduced-quality presets stay within the existing runtime draw-call and frame-time targets.

The opening is reviewed in the shipping Three.js camera after each Blender approval; Blender beauty renders are evidence, not the final approval target.
