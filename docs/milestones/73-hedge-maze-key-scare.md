# Milestone 73 — Hedge Maze Haunt and Key Release

## Status

In progress with implementation and automated acceptance complete; natural scare frequency, darkness, audio balance, and entrance readability await user playtest.

## Objective

Make the B-13 maze search feel sustained and inescapable until the buried key is recovered, without revealing the Feast Father, changing the authoritative maze route, disabling the flashlight, or trapping an unprepared explorer.

## Scope

- Begin the pre-key haunt only when the player has read the XIII clue and carries the garden shovel. Early maze exploration remains open so the player cannot be stranded before the key is obtainable.
- After the quest-ready player reaches three cells of path depth, raise living-hedge seals across both west-side portals. The two Rapier colliders are created once at boot and only enabled/disabled; the `78/117` maze grid and every static hedge collider remain unchanged.
- Persist `mazeLockInTriggered` through save/load. A save restored inside the quest-ready pre-key maze raises both seals again, while leaving the maze, an active Storm Run, key ownership, reset, or Dev Mode keeps the portals open.
- Hold every existing maze fixture at `6.5%` of its prior event scale, with one brief localized flicker every `3.15s`. Add no shader light and never switch off or suppress the carried flashlight.
- Start the first player-local hedge disturbance within `2.4s`, then repeat `4.6s` rustle/branch/inhale/withdraw pulses after deterministic `5.4–6.8s` gaps until the key is recovered. Each pulse repositions the existing non-colliding bulges and instanced leaves against nearby hedge faces.
- Award the basement key, badge, tape, inventory entries, and journal state before release. Key recovery immediately disables both entrance colliders, lowers the seals, restores the pre-haunt maze-light scales, and begins the extended one-shot `11.6s` chamber release sequence.
- Preserve the existing Storm Run guard, directional procedural audio, rain hush, exact transient cleanup, and one-shot `mazeKeyScareSeen` completion state.

## Out of scope

- A visible creature, new enemy AI, pursuit, damage, slowdown, maze rearrangement, or a Feast Father reveal.
- Changes to the authoritative hedge grid, B-13 chamber, Storm Run route/checkpoints, final-corridor apparition, or fixed exterior-light budget.
- New HUD, objective text, clue item, or player input.

## Acceptance

- [x] Early exploration leaves both portals open, while a clue-ready player crossing three cells seals both entrances with two visible and enabled boot-time kinematic barriers. — test: `scripts/test-mr-feast-hedge-maze-haunt.mjs::quest-gated lock-in`
- [x] The sealed maze remains mostly dark, produces at least three local scare pulses in twenty-eight seconds, flickers repeatedly, and leaves a collected switched-on flashlight untouched. — test: `scripts/test-mr-feast-hedge-maze-haunt.mjs::recurring pre-key haunt`
- [x] Save/load inside the pre-key maze restores `mazeLockInTriggered` and both seals without changing collider topology. — test: `scripts/test-mr-feast-hedge-maze-haunt.mjs::lock-in save round trip`
- [x] Real key ownership immediately opens both portals, restores sustained maze darkness, and starts an `11.6s` release with visible hedge movement, leaves, rain/light hush, inhale, retreat, and exact cleanup. — tests: `scripts/test-mr-feast-hedge-maze-haunt.mjs::key release`; `scripts/test-mr-feast-hedge-maze-key-scare.mjs`
- [x] The `78/117` layout, key depths `63/62`, real basement-key trail, flashlight behavior, full Storm Run event state machine, and final-corridor apparition remain green. — tests: `scripts/test-mr-feast-hedge-maze-layout.mjs`, `scripts/test-mr-feast-basement-key-trail.mjs`, `scripts/test-mr-feast-flashlight.mjs`, `scripts/test-mr-feast-storm-run.mjs`, `scripts/test-mr-feast-storm-run-maze-exit.mjs`
- [ ] User playtest confirms the lock happens after a fair amount of inward travel, the repeated pulses remain tense rather than noisy, the flashlight gives enough navigation confidence, and each reopened exit reads immediately after the key. — verified by user playtest

## Verification

The new focused test first failed red on `missing named HEDGE_MAZE_HAUNT tuning table`. The green Chromium run verified the safety gate, three-cell lock depth, both visual/physical entrance seals, fixed collider count, sustained darkness and flicker, three pre-key scare pulses in twenty-eight seconds, flashlight continuity, explicit save/load restoration, immediate key release, the longer chamber sequence, cleanup, and a clean browser console. Desktop evidence is under `output/playwright/mr-feast-hedge-maze-haunt/`.

Adjacent verification passed:

- `node --check assets/js/mr-feast-mansion.js`
- `node scripts/test-mr-feast-hedge-maze-key-scare.mjs`
- `node scripts/test-mr-feast-hedge-maze-layout.mjs`
- `node scripts/test-mr-feast-basement-key-trail.mjs`
- `node scripts/test-mr-feast-flashlight.mjs`
- `node scripts/test-mr-feast-storm-run.mjs`
- `node scripts/test-mr-feast-storm-run-maze-exit.mjs`

`scripts/test-mr-feast-storm-run-intro.mjs` still fails its pre-existing source-only assertion for the obsolete `20260721-storm-run-restored-wait-1-final-straight-1` cache label; it does not execute gameplay and was already stale relative to the prior hedge-maze-key-scare cache release.
