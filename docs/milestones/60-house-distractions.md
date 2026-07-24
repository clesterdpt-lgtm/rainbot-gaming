# Milestone 60: House Distractions

## Status

in-progress

## Objective

Give the Music Room, basement Laundry, and Dining Room repeatable tactical value during free-roam investigation by turning one recognizable device in each room into a loud physical distraction. The feature reuses Mr. Feast's established housekeeping route, security consequences, and speech rather than adding a parallel enemy system or new interface.

## Scope

- Make the Music Room grand piano visibly play itself until silenced.
- Add a vintage wringer laundry machine that visibly clatters until silenced.
- Add a wall-mounted Dining Room service bell that repeatedly rings until silenced.
- Route every unseen disturbance to Mr. Feast as a short-delay housekeeping task that he physically reaches and resolves.
- Give each device distinct spatial audio, in-world prompts, diagnostic state, and deterministic QA controls.
- Preserve witnessed/recorded tamper pursuit, save/load cleanup, and competition ownership.

## Out of scope

- Portable distraction items, additional hiding places, room-specific evidence chains, or other mansion devices.
- New HUD layers, objective arrows, Bag controls, touch buttons, or Escape-menu changes.
- Any use of these distractions during Feast Says, Storm Run, or Feast Hunt.
- New downloaded audio or runtime dependencies.

## Dependencies

- **Depends on:** Milestone 45 — Tamper Distractions and Host Speech
- **Blocks:** none

## Acceptance criteria

- [x] The Music Room grand piano, basement Laundry wringer machine, and Dining Room service bell expose distinct real E/touch prompts from reachable authored approaches and enter an active distraction state exactly once per activation. — test: `scripts/test-mr-feast-house-distractions.mjs::real device interactions`
- [x] Every active device has a readable mechanical animation, emits its own repeating spatial procedural cue, and exposes active, pulse, animation, room, position, and prompt state through `render_game_to_text()`. — test: `scripts/test-mr-feast-house-distractions.mjs::animation audio and diagnostics`
- [x] An unseen activation dispatches after a short named delay; Mr. Feast walks to the correct room without teleporting, speaks device-specific notice/fix lines, silences the device, and resumes patrol. — test: `scripts/test-mr-feast-house-distractions.mjs::three complete response routes`
- [x] Stopping a device before Mr. Feast arrives cancels its pending or active errand, and the normal retamper cooldown prevents immediate prompt-spam. — test: `scripts/test-mr-feast-house-distractions.mjs::manual cancellation and cooldown`
- [x] Activating a device while personally witnessed or camera-recorded uses the existing infraction/pursuit path; the disturbance is silently resolved if the player is caught. — tests: `scripts/test-mr-feast-house-distractions.mjs::security consequence contract`, `scripts/test-mr-feast-caught-pursuit.mjs`
- [x] All three interactions are unavailable during a sanctioned competition, and load/restart clears every active device, queued notice, and transient audio/animation state. — test: `scripts/test-mr-feast-house-distractions.mjs::competition and reset lifecycle`
- [x] No new game HUD, objective-arrow, Bag-control, touch-control, or Escape-menu element is added; the existing touch Interact path activates a device on a 390×844 viewport. — test: `scripts/test-mr-feast-house-distractions.mjs::mobile interaction and UI ownership`
- [ ] User playtest confirms each source is easy to recognize, loud enough to understand, and useful for redirecting Mr. Feast without feeling like an automatic escape button. — verified by user playtest

## Exit condition

User starts the piano, laundry machine, or service bell during investigation → sees and hears that device continue operating, watches Mr. Feast travel to silence it, and can use the redirected patrol window without any new UI.

## Test plan

Create `scripts/test-mr-feast-house-distractions.mjs` before implementation and confirm it fails on the missing tuning, diagnostics, and device registrations. The focused browser sequence then uses real E/touch input at all three authored approaches, deterministic notice stepping, and the complete no-teleport Mr. Feast housekeeping route. It also covers manual cancellation, competition/load reset, security ownership, mobile interaction, screenshots, and console capture. Final regression runs include runtime/test syntax, renovation, tamper distractions, caught pursuit, Feast Hunt, full Contestant 13, and `git diff --check`.

Red confirmed on the missing `MANSION_DISTRACTIONS` contract before implementation. Green focused proof covers all three devices, their distinct cues and motion, three full responding/searching/returning routes with zero teleports, competition/reset ownership, and existing touch Interact at 390×844 with zero browser errors. Captures live under `output/playwright/mr-feast-house-distractions/`.

## Notes

- The three devices are one coherent system explicitly selected from the 2026-07-24 mansion interaction brainstorm.
- The existing centralized mansion state, `TamperSystem`, response graph, speech bubble, and procedural Web Audio remain authoritative.
