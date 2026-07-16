# Milestone 38 — Estate Statue Trio

Status: in progress; implementation and automated acceptance complete, user visual approval pending.

## Goal

Replace the formal-garden fountain's primitive figure with an authored 3D centerpiece and add two complementary statues to the Grand Foyer. The trio should read as expensive neoclassical commissions at first glance and become strange, creepy, and physically impossible on closer inspection.

## Art direction

- **The Weeping Crown** — a pale, faceless garden courtier whose elongated arms lift an empty crown around the fountain lantern.
- **The Listening Host** — a dark-marble aristocratic host with an elongated neck and fingers gathered around one ear.
- **The Veiled Waltz** — an ivory veiled dancer caught in a curtsy, with her blank head turned slightly too far behind her.
- Shared language: elegant vertical silhouettes, aged marble, charcoal veining, restrained antique-gold repair seams, compact integrated plinths, and no gore.

## Acceptance criteria

- Meshy generates three distinct PBR GLB masters from single-object prompts, with task metadata retained for provenance.
- Blender imports each master, removes non-mesh baggage, fixes normals, limits material/texture cost, reduces geometry where needed, applies transforms, centers the footprint, plants the model at local `y = 0`, and exports a browser-safe runtime GLB.
- Each runtime GLB is under 10 MB, contains visible mesh geometry and at least one material, and stays within the authored triangle budget.
- The fountain keeps its basin, water, jets, lantern, lighting, and collider while the old sphere-and-rounded-box figure is removed and replaced by The Weeping Crown.
- The Grand Foyer gains The Listening Host and The Veiled Waltz in balanced wall-side niches without narrowing the central rug, front-door path, side-door approaches, or Mr. Feast patrol route.
- Runtime fitting derives scale and floor alignment from actual GLB bounds rather than assuming Meshy orientation or units.
- Static statue meshes cast/receive appropriate shadows, foyer meshes participate in interior culling, and all three placements have simple fixed collision volumes.
- Diagnostics report source, load state, dimensions, triangle/material/texture counts, placement, and collider state for all three statues.
- Focused desktop browser captures prove the fountain and both foyer statues are loaded, correctly oriented, grounded, readable in their authored lighting, and free of console errors.
- Mansion syntax, renovation, camera, player, and Contestant 13 regressions remain green.

## Out of scope

- Statue animation, interaction, moving eyes, jump scares, puzzle clues, damage states, or a new light circuit.
- Changes to the fountain basin/path network or the foyer's central rug and chandelier.

## Implementation notes

- Meshy generated three distinct preview/refine PBR masters for 90 credits total. The tracked provenance manifest retains all six task IDs, prompts, runtime filenames, and the Blender report links.
- Blender 4.5 LTS removed animation/rig baggage, centered and grounded each model, constrained embedded textures to 1024 px, reduced mesh cost, and exported uncompressed GLB 2.0 files for the existing Three.js r128 loader.
- Runtime outputs total 45,985 triangles: The Listening Host is 14,206, The Veiled Waltz is 14,317, and The Weeping Crown is 17,462. Every individual file remains below 5.1 MB.
- The foyer pair replaces the old procedural busts at `x = ±3.85, z = 5.0`, outside the central rug and beside the existing sconces. The black-marble host receives a restrained material-only readability lift without adding another scene light. The Weeping Crown replaces only the fountain's primitive figure; the basin, water, jets, upper bowl, practical glow, and collider remain intact.
- `getEstateStatueDiagnostics()` exposes load status, geometry/material/texture cost, fitted dimensions, grounding, placement, legacy-object cleanup, and collider state. Focused QA views frame both installations deterministically.

## Verification

- `python3 -m py_compile scripts/blender/prepare-estate-statue.py`
- `node --check scripts/meshy-generate.mjs`
- `node --check assets/js/mr-feast-mansion.js`
- `node scripts/test-mr-feast-estate-statues.mjs`
- `node scripts/test-mr-feast-renovation.mjs`
- `node scripts/test-mr-feast-camera-security.mjs`
- `node scripts/test-mr-feast-player-systems.mjs`
- `node scripts/test-mr-feast-contestant-13.mjs`
- Desktop captures: `output/playwright/mr-feast-estate-statues/foyer-statues-desktop.png` and `garden-fountain-statue-desktop.png`
