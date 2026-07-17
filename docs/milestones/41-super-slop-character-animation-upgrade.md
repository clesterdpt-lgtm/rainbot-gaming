# Milestone 41 — Super Slop Character Animation Upgrade

Status: implementation and automated acceptance complete; final roster feel awaits user playtest.

## Goal

Replace Super Slop Brothers' single static full-body image per fighter with a cohesive animated roster sourced from Meshy character models and prepared in Blender. Keep the existing Canvas2D fighter runtime and gameplay timings authoritative while making locomotion, defense, normal attacks, and all 24 directional specials visibly readable.

## Art direction

- Preserve the six established silhouettes, colors, costumes, and satirical personalities from the current body and portrait atlases.
- Use a polished 3D-to-2D fighting-game presentation: orthographic three-quarter renders, transparent backgrounds, strong rim light, readable hands and feet, and exaggerated key poses that remain clear around 90–110 rendered pixels tall.
- Rainbot stays a neon cloud-screen mascot; Gigachad a monumental stone bruiser; Mr. Feast a red-and-gold burger magnate; Skibidi a purple-and-cyan plumbing trickster; Sigma a blue streetwear wolf; and AI Slop Bot a green-magenta glitch machine.
- Animation should favor anticipation, impact, and recovery silhouettes over physically subtle motion.

## Acceptance criteria

- Meshy creates six textured character masters from the existing full-body art direction and auto-rigs every biped; task IDs, prompts or source references, consumed credits, and downloaded files are retained in one provenance manifest.
- Blender imports every rigged master and selected Meshy motion clips, removes irrelevant scene baggage, normalizes scale and orientation, constrains texture/material cost, and preserves a reusable processed rig for each fighter.
- Blender renders browser-ready transparent sprite sheets from a consistent orthographic camera and lighting rig; editable `.blend` files and raw generation outputs remain ignored.
- Every fighter supplies the shared clips `idle`, `run`, `jump`, `fall`, `hit`, `shield`, `dodge`, `grab`, and `attack`, plus `special-neutral`, `special-side`, `special-up`, and `special-down`.
- Each of the 24 directional specials starts a visible fighter animation, including instant projectile, burst, fall-object, trap, summon, and teleport abilities that previously created no lasting character action state.
- Animation choice is derived from existing authoritative fighter state and a visual-only action timer; hitboxes, damage, cooldowns, movement, networking, and match rules are not changed by the art layer.
- The renderer advances deterministic atlas frames, mirrors left-facing fighters without changing collision geometry, supports looping locomotion clips and one-shot action clips, and falls back to the current static body atlas if an animated sheet is unavailable.
- Runtime diagnostics expose asset readiness, current clip, current frame, clip progress, and the explicit special mapping for all six fighters. Focused QA controls can trigger every ability without relying on CPU randomness.
- Each sprite sheet is under 3 MiB, the combined animated roster is under 14 MiB, and each preserved processed rig is under 15 MiB.
- A focused browser regression triggers and advances every directional special for every fighter, proves that its expected clip and frame progression are active, records visual proof, checks desktop and mobile rendering, and reports zero local asset, console, or page errors.

## Out of scope

- Changes to damage, hitboxes, move frame data, cooldowns, CPU behavior, multiplayer authority, stages, hazards, sound design, fighter selection, or roster balance.
- Replacing the Canvas2D runtime with live Three.js characters.
- Facial lip sync, cinematics, new fighters, new abilities, or a menu redesign.

## Implementation notes

- Meshy produced six textured masters, six 24-bone humanoid rigs, and 36 selected motion tasks. Generation, rigging, and animation consumed 318 credits total; task IDs, action IDs, requests, files, hashes, and per-step credit use are retained in the generated manifest.
- Blender 4.5 normalizes every rig to 1.8 m, removes scene baggage, constrains textures to 1024 px, strips root X/Y/Z translation because Canvas owns world displacement, preserves the authored joint motion, and renders 13 rows × 8 frames from one fixed orthographic three-quarter camera.
- The finalized WebP atlases total 2,206,564 bytes. Individual sheets are 299–459 KB, processed rigs are 7.39–8.77 MiB, and the enforced transparent margin is 7–34 px with zero clipped poses.
- Production loading is match-scoped: only active fighters are decoded, while the previous body atlas remains visible until a requested sheet finishes. A two-fighter mobile match stays below the 32 MiB decoded-atlas QA budget.
- Instant effects begin on a visual release pose; attack-backed specials follow the authoritative attack timer. Gameplay damage, collision, cooldown, movement, networking, and match rules remain unchanged.
- Focused QA delegates through the real special dispatcher for all 24 fighter/direction combinations, verifies the expected projectile, melee, recovery, counter, reflect, teleport, fall-object, trap, or summon artifact, then proves clip/frame progression under a deterministic manual clock.

## Verification

- `node --check assets/js/super-slop-brothers.js`
- `python3 -m py_compile scripts/blender/prepare-super-slop-fighter.py`
- `python3 -m py_compile scripts/build-super-slop-animation-atlas.py`
- `node scripts/test-super-slop-character-animations.mjs`
- `git diff --check`

Automated result: all commands passed. The browser suite also validated every decoded pose for nonempty alpha, at least two distinct frames per clip, exact 8×13 slicing, six-pixel safety margins, lazy loading, forced legacy fallback, hitlag freeze, read-only diagnostics, a four-fighter render smoke, desktop/mobile layout, visible touch controls, and zero unexpected page errors.

Visual proof: `output/iterate/super-slop-character-upgrade/all-24-specials-contact-sheet.jpg` plus the 24 source captures and mobile/fallback captures under `output/playwright/super-slop-character-animations/`.
