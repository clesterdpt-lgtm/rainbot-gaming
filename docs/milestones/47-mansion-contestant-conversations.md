# Milestone 47 — Mansion Contestant Conversations

## Goal

Make the mansion feel like an active reality-show house by adding three fully rigged contestants who occupy different rooms, idle in place, and answer the player with distinct voices, perspectives, and non-repeating dialogue.

## Contestant direction

- **Contestant 03 — Mara Voss, “The Strategist” (Library):** a long-dark-haired crisis negotiator in oxblood tailoring and an ivory blouse. She treats the game as leverage, speaks precisely, and notices rules, incentives, and camera policy.
- **Contestant 07 — Kip Solano, “The Wild Card” (Ballroom):** a storm-teal stunt streamer who hides fear behind fast jokes. He comments on the production, the edit, and his increasingly bad escape plans.
- **Contestant 10 — Juniper Cross, “The Folklorist” (Reading Room):** a shaved-head, plum-and-black folklorist with a calm gothic presence. She notices patterns, echoes, portraits, and the house's impossible habits.

## Acceptance criteria

- Meshy authors three original, fictional, full-body humanoid contestants with no real-person likenesses, logos, weapons, or handheld props. Each textured model is auto-rigged before integration.
- Blender 4.5 prepares each rig as a grounded, centered, standard uncompressed GLB for Three.js r128, caps textures at 1024 px, and records triangle, bone, bounds, and byte budgets in checked-in reports. Raw Meshy downloads and editable Blender files remain ignored.
- Each contestant has a Meshy-authored idle motion reduced to a small animation-only GLB. Runtime animation keeps the contestant stationary, removes scale and translation tracks, and advances through a `THREE.AnimationMixer`.
- Mara occupies the Library, Kip the Ballroom, and Juniper the upper Reading Room. Placements remain outside required door approaches, Mr. Feast's authored route, and the player's core circulation paths.
- Aiming at a contestant exposes `Speak with <name>` through the existing E/touch interaction system. The invisible interaction target is bounded to the body and does not add the rendered mesh hierarchy to the global raycast list.
- Every contestant owns a unique persona label and at least eight unique lines. Back-to-back interactions with the same contestant do not repeat a line, and no line is shared between contestants.
- The shared speech bubble shows the active speaker's name, anchors above that contestant's head, remains legible at 1280×820 and 390×844, and preserves existing Mr. Feast dialogue behavior.
- `window.render_game_to_text()` exposes contestant load/rig/animation/placement/dialogue state. Focused `window.MrFeastFresh` QA controls can place the player near a contestant and converse deterministically without bypassing the real first interaction in regression coverage.
- A failed contestant asset never blocks mansion startup. Diagnostics report the individual failure while other contestants and the mansion remain usable.
- The fixed point-light budget, shader-light layout, camera policy, Mr. Feast patrol/housekeeping, story progression, and static GitHub Pages architecture remain unchanged.

## Verification

- `python3 -m py_compile scripts/blender/prepare-mansion-contestant.py` — passed.
- `node --check assets/js/mr-feast-mansion.js`, `node --check scripts/meshy-generate.mjs`, `node --check scripts/extract-mansion-contestant-animation.mjs`, and `node --check scripts/test-mr-feast-contestant-conversations.mjs` — passed.
- `node scripts/test-mr-feast-contestant-conversations.mjs` — passed all three Meshy/Blender asset budgets, 24-bone and 24-bound-track idle proof, real E interaction, distinct/non-repeating dialogue, named speaker bubble, patrol-segment clearance, Mr. Feast speech compatibility, 1280×820 desktop coverage, 390×844 touch coverage, and zero browser errors.
- `node scripts/test-mr-feast-tamper-distractions.mjs` — passed adjacent host-speech compatibility.
- The adjacent player, Contestant 13, renovation, tamper-speech, and caught-in-the-act suites passed in the full development checkout. In the isolated staged snapshot, the focused contestant suite still passes; the broader renovation and Contestant 13 baselines remain coupled to ignored face-retopology artifacts that are intentionally outside this commit.
- Captures are under `output/playwright/mr-feast-contestant-conversations/` for Mara, Kip, and Juniper on desktop plus Kip on mobile.
