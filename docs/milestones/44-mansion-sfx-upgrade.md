# Milestone 44 — Mansion SFX Upgrade

## Goal

Give Mr. Feast's Mansion a grounded, atmospheric soundscape that reinforces movement and interactions without becoming repetitive or overpowering the investigation.

**Status:** Implementation and automated acceptance complete; final loudness and pacing await user playtest on speakers or headphones.

## Acceptance criteria

- The existing real rain ambience is mixed as a wider, layered storm bed and still follows the mansion-shell exposure model.
- Lightning uses a recorded thunder sample synchronized to the authored visual flash delay, with a procedural fallback if the asset cannot load.
- Grounded player movement produces distance-driven footsteps for wood, stone, and grass; standing still, pushing into walls, teleporting, pausing, and hiding do not emit steps.
- Walking, crouching, and sprinting have distinct cadence and loudness while reusing a small randomized, pitch-varied sample set.
- Doors and cabinets use physical wood movement samples, while light switches use recorded mechanical clicks.
- Opening and closing books, collecting or using keys, entering or leaving the coat hiding place, and keypad feedback have restrained, event-specific cues.
- The existing game-audio button and `M` shortcut mute the storm and every new effect together.
- Downloaded sounds have local provenance and license records; browser playback never depends on third-party hosts.
- Audio diagnostics expose context state, asset readiness, recent cue counts, footstep surface/cadence, rain layering, and thunder mode for deterministic QA.
- The focused audio regression, both mansion regression suites, syntax check, and `git diff --check` pass with zero browser errors.

## Verification

- `node --check assets/js/mr-feast-mansion.js` — passed
- `node scripts/test-mr-feast-audio-upgrade.mjs` — passed real trusted-click audio unlock, all 38 declared local/shared assets decoded, layered recorded rain plus one-layer recorded fallback when optional detail is missing, four recorded thunder variants, wood/stone/grass steps, slower crouch and faster sprint cadence, no stationary/teleport/pause/hide false steps, doors, lights, books, full-mix mute, and zero browser errors
- `node scripts/test-mr-feast-renovation.mjs` — passed all current mansion invariants, including recorded-rain fallback/exposure and adjacent water/fireplace audio
- `node scripts/test-mr-feast-contestant-13.mjs` — passed progression, gates, persistence, accessibility, mobile touch, and the audio-integrated runtime with zero browser errors
- `node scripts/test-mr-feast-player-systems.mjs` — passed movement, crouch/sprint state, menus, persistence, and Dev Mode
- `git diff --check` — passed
