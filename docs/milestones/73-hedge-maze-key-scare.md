# Milestone 73 — Hedge Maze Key Scare

## Status

In progress with implementation and automated acceptance complete; natural timing, subtlety, audio balance, and chamber readability await user playtest.

## Objective

Give the buried B-13 key a memorable supernatural sting without turning the terminal chamber into a chase, changing the maze route, revealing the Feast Father, or risking the key/progression handoff.

## Scope

- Award the basement key, badge, tape, inventory entries, and journal entry before beginning the scare.
- Run one authored `7.4s` sequence: the rain bed drops, the two nearest existing maze lights dim in order, three chamber hedge faces breathe inward, loose leaves shake free, a close directional inhale lands, and the disturbance retreats north along the corridor.
- Build the movement from six temporary hedge overlays and thirty instanced leaves. They add no Rapier body, collider, interaction, movement lock, damage, slowdown, or chase state.
- Use only existing maze lights through temporary intensity scales and restore their prior values exactly; add no shader light.
- Use procedural filtered branch/rustle/inhale layers with spatial panning, plus the existing grass-step bank when available. Restore the normal rain mix at release, cancellation, reset, and load.
- Persist one `mazeKeyScareSeen` story flag. Save/load retains completion but never restores an in-progress visual/audio transient.
- Allow the normal Storm Run report call after key discovery, but reject the scare during an active briefing/race and cancel it if that gameplay begins while the presentation is still running.

## Out of scope

- A real creature, hedge deformation, new enemy AI, pursuit, path blocking, maze rearrangement, or a Feast Father reveal.
- Changes to the authoritative hedge grid, B-13 chamber, Storm Run route, checkpoints, final-corridor apparition, or fixed exterior-light budget.
- New HUD, objective text, clue item, or player input.

## Acceptance

- [x] The real excavation callback owns the basement key and related evidence before `HedgeMazeKeyScareSystem` can trigger, and the established competition-discovery call remains afterward. — test: `scripts/test-mr-feast-hedge-maze-key-scare.mjs::key-first source contract`; adjacent test: `scripts/test-mr-feast-basement-key-trail.mjs`
- [x] The chamber reaches visible surround, inhale, retreat, and release phases with six non-colliding hedge overlays, thirty falling leaves, localized light/rain hush, and directional audio events. — test: `scripts/test-mr-feast-hedge-maze-key-scare.mjs::timed browser presentation`
- [x] The static fixed-box count never changes, movement remains unlocked, and completion removes every temporary overlay while restoring both selected light scales and rain. — test: `scripts/test-mr-feast-hedge-maze-key-scare.mjs::topology and cleanup`
- [x] The event is one-shot, survives an explicit save/load as completed, does not restore transient effects, and rejects an active Storm Run. — test: `scripts/test-mr-feast-hedge-maze-key-scare.mjs::persistence and competition guard`
- [x] The `78/117` maze layout, real basement-key trail, and complete Storm Run event state machine remain green. — tests: `scripts/test-mr-feast-hedge-maze-layout.mjs`, `scripts/test-mr-feast-basement-key-trail.mjs`, `scripts/test-mr-feast-storm-run.mjs`
- [ ] User playtest confirms the event is noticeable without looking like a full creature reveal, the close inhale lands at the right distance, and the route out remains immediately understandable on desktop or phone. — verified by user playtest

## Verification

The focused test first failed red on `missing named HEDGE_MAZE_KEY_SCARE tuning table`. The green Chromium run verified key-first ownership, phase timing, visible overlays/leaves, light and rain changes, directional inhale/retreat cues, unchanged static collision, free movement, complete cleanup, one-shot behavior, explicit save/load persistence, the active-race guard, and a clean browser console. Desktop evidence is under `output/playwright/mr-feast-hedge-maze-key-scare/`.

Adjacent verification passed:

- `node --check assets/js/mr-feast-mansion.js`
- `node scripts/test-mr-feast-hedge-maze-layout.mjs`
- `node scripts/test-mr-feast-basement-key-trail.mjs`
- `node scripts/test-mr-feast-storm-run.mjs`
