# Tech stack

## Engine / runtime

- **Engine:** Three.js r128, vendored and loaded directly in the page
- **Language(s):** Vanilla JavaScript, HTML, and CSS; Blender Python for character processing
- **Target platforms:** Modern desktop and mobile browsers; static deployment through GitHub Pages

Super Slop Brothers keeps its existing Canvas2D simulation and renderer. Meshy and Blender are offline asset tools only: Meshy supplies textured humanoid rigs and motions, Blender turns them into fixed transparent sprite atlases, and the browser never calls either service or loads the preserved GLBs.

Tardigrade: Micro Mayhem keeps its existing static Three.js runtime and JavaScript-authored gameplay proxies. Meshy supplies low-poly source geometry; Blender cleans, rigs, animates, bounds-fits, and exports uncompressed GLBs for the vendored r128 loader. Animation mixers and authored meshes are visual-only: player collision, prop physics, creature routes, scoring, and level state remain authoritative in the existing runtime, with procedural geometry retained as the load-failure fallback.

## Libraries / frameworks

| Library | Version | Purpose |
|---------|---------|---------|
| Three.js | r128 | WebGL scene, materials, skeletal animation, morph targets, and GLB loading |
| GLTFLoader / SkeletonUtils | r128 | Runtime character and animation loading plus safe rig cloning |
| Rapier | 0.19.3 | Player capsule, collision, and mansion traversal physics |
| Playwright | local Node dependency | Real-browser progression, animation, responsive, and visual QA |
| Blender | 4.x local installation | Mesh cleanup, shape keys, rig work, optimization, and GLB export |
| Pillow | bundled Python dependency | Deterministic RGBA frame packing and WebP budget/margin validation |

## Tooling

- **Package manager:** npm is used only for local tooling; the published site has no package build step.
- **Build:** n/a — GitHub Pages serves the repository root as a static site.
- **Local server:** `python3 -m http.server 8000`
- **Testing:** `node scripts/test-mr-feast-renovation.mjs`, `node scripts/test-mr-feast-contestant-13.mjs`, focused `node scripts/test-mr-feast-basement-key-trail.mjs`, and focused `node scripts/test-mr-feast-player-systems.mjs`
- **Tardigrade asset testing:** `node scripts/test-tardigrade-meshy-blender-assets.mjs`
- **Linting / formatting:** `node --check <script>` and `git diff --check`; no formatter is enforced.
- **Asset / binary storage:** Git; runtime GLBs are kept below GitHub's per-file limit. Raw Meshy downloads and editable Blender working files remain ignored.

## Project layout

```text
games/mr-feast-mansion.html              Static game shell and HUD
assets/js/mr-feast-mansion.js            Mansion world, state, interactions, NPC, diagnostics
assets/models/mr-feast/                  Character manifest, runtime GLBs, reports, reference art
assets/models/mr-feast/banquet/          Deferred loss-tableau GLBs and truthful Meshy/Blender provenance
scripts/blender/                          Repeatable Blender processing scripts
scripts/blender/prepare-banquet-victim.py One-rig torso-only/limb separation, cropped body silhouette, bounds fit, r128 export
scripts/test-mr-feast-renovation.mjs      Source and asset invariant regression
scripts/test-mr-feast-banquet-loss.mjs    Deferred asset, first-person staging, dialogue, recovery, phone regression
scripts/test-mr-feast-contestant-13.mjs   Real Chromium gameplay and visual regression
scripts/test-mr-feast-basement-key-trail.mjs Focused book/key/basement progression and mobile regression
scripts/test-mr-feast-player-systems.mjs     Focused sprint/crouch/inventory/save/dev-menu regression
assets/js/super-slop-brothers.js             Canvas2D fighter simulation and lazy animated-atlas renderer
assets/models/super-slop-brothers/           Meshy/Blender manifest, references, processed rigs, and reports
assets/img/super-slop-brothers/animated/     Browser WebP fighter atlases
scripts/blender/prepare-super-slop-fighter.py Repeatable rig cleanup and 13x8 transparent render pipeline
scripts/build-super-slop-animation-atlas.py   Atlas packer, clipping gate, and WebP budget check
scripts/test-super-slop-character-animations.mjs Real-special, decoded-pose, fallback, and responsive regression
assets/js/tardigrade-micro-mayhem.js          Five-stage Three.js sandbox, gameplay proxies, model loading, and QA controls
assets/models/tardigrade/                     Meshy provenance manifest, Blender-prepared runtime GLBs, and reports
scripts/blender/prepare-tardigrade-assets.py  Repeatable non-humanoid cleanup, rigging, clip, and export pipeline
scripts/test-tardigrade-meshy-blender-assets.mjs GLB budgets, runtime fallback, animation, desktop, and mobile regression
docs/milestones/                          Scoped feature acceptance criteria
```

## Conventions

- **Code naming:** camelCase JavaScript, PascalCase classes, uppercase constant tables, kebab-case asset filenames.
- **State:** the mansion's single runtime owns one centralized `state` object and focused system classes; avoid repo-wide architectural refactors during feature work.
- **Small gameplay state machines:** use named state constants plus explicit transition tables/events inside the focused owning system; avoid parallel booleans that create implicit modes.
- **Persistence:** mansion saves use the existing `window.RBGameSaves` adapter with a versioned payload; transient actions and Dev Mode are never persisted.
- **Configuration:** gameplay and visual tuning values live in named constant objects near the top of the mansion runtime rather than unexplained inline numbers.
- **Assets:** runtime character assets use `mr-feast-<purpose>.glb`; raw generation files and DCC working files remain local/ignored.
- **Banquet victim assets:** one selected rigged Meshy underwear body supplies both static runtime GLBs; Blender may separate the source into a compact torso-only body with no shoulder/leg attachments and a wrapped four-limb pile, but must preserve visible source-derived anatomy, center X/Z origins on their staging marks, ground Y at zero, export standard uncompressed glTF 2.0 for Three.js r128, and record rejected paid attempts rather than excluding them from credit totals.
- **Super Slop character assets:** raw Meshy GLBs/actions remain ignored; reusable processed rigs and 8-column × 13-row WebP atlases are generated from checked-in scripts and provenance reports. Root translation is stripped on all axes because Canvas physics remains authoritative.
- **Tardigrade assets:** raw Meshy masters and editable Blender files remain ignored below `assets/models/tardigrade/source/`; checked-in runtime GLBs are uncompressed for Three.js r128, use kebab-case names from the manifest, preserve visual-only animation without world-root translation, and retain procedural per-instance fallbacks. Animated clones use SkeletonUtils; clone disposal must never dispose shared cached geometry or materials.
- **Tardigrade QA hooks:** `window.render_game_to_text()`, `window.advanceTime(ms)`, and `window.__MICRO_MAYHEM_DEBUG` expose deterministic state plus asset settlement, bounds, cost, action, and fallback diagnostics.
- **Facial animation:** Blender shape keys export as sparse POSITION morph targets on the existing skinned mesh, with morph normals disabled to control download size. Three.js blends their weights after skeletal animation without altering gameplay state. The current source supports micro-expressions only; full blink and speech topology are deferred.
- **QA hooks:** `window.render_game_to_text()`, `window.advanceTime(ms)`, and focused `window.MrFeastFresh` controls expose deterministic state for browser tests.
- **Super Slop QA hooks:** `window.__SLOP` exposes a manual clock, real-special showcase dispatcher, active-roster asset diagnostics, and explicit preload control. Production lazily decodes only the match roster and falls back to the legacy body atlas on load failure.
- **Verification:** every feature adds a failing regression first, then uses the real browser plus screenshots for visual acceptance.

## Out-of-scope dependencies

- No Unity, Unreal, or Godot migration; the browser/Three.js stack remains authoritative.
- No Vite/bundler migration solely for this game.
- No paid facial-animation service is required for the initial silent expression set.
- No runtime Meshy API calls; Meshy remains an offline source-asset tool only.
