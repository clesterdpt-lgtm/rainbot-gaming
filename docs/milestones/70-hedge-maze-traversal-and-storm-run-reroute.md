# Milestone 70: Hedge Maze Traversal and Storm Run Reroute

## Status

in-progress

## Objective

Rebuild the hedge maze so the shortest north-entrance-to-rear-exit route crosses at least half of its walkable cells instead of bypassing three quarters of the layout. Move the buried basement key to a deliberate deep dead end and make Storm Run use the same redesigned, collision-valid maze route for the player and both contestants.

## Scope

- Replace the current shortcut-heavy hedge grid while preserving the two finished estate portals, clipped-hedge rendering, and fixed exterior-light budget.
- Measure total walkable cells and the shortest entrance-to-exit route, with a minimum required traversal ratio of `0.50`.
- Move the B-13 dig site to a true dead end reached only after more than half of the maze from either portal.
- Derive the Storm Run contestant maze leg from the authoritative maze route, relocate its final-corridor lightning reveal, and retune maze wayfinding fixtures for the new corridors.
- Preserve the twelve-checkpoint race, basement-key progression, fixed storm-light topology, and existing save/competition contracts.

## Out of scope

- Dynamic or rearranging maze generation.
- Additional keys, clue items, enemies, hazards, or checkpoint-count changes.
- Increasing the six-spot exterior light budget or adding new character assets.

## Dependencies

- **Depends on:** Milestone 34 — Basement Key Trail; Milestone 54 — Storm Run Second Competition
- **Blocks:** none

## Acceptance criteria

- [ ] The shortest north-entrance-to-rear-exit path visits at least `50%` of all walkable maze cells, with the ratio exposed in deterministic yard diagnostics. — tests: `scripts/test-mr-feast-hedge-maze-layout.mjs::entrance-to-exit traversal ratio` and `scripts/test-mr-feast-storm-run.mjs::ordered collision-clear yard course`
- [ ] The B-13 dig site is a one-neighbor dead end whose shortest path from either portal exceeds half the maze's walkable-cell count; excavation, inventory, and Storm Run triggering remain unchanged. — tests: `scripts/test-mr-feast-hedge-maze-layout.mjs::deep buried-key dead end` and `scripts/test-mr-feast-basement-key-trail.mjs::real interaction progression and gates`
- [ ] Storm Run's contestants traverse the authoritative entrance-to-exit cell route without wall-crossing or a hand-authored maze shortcut, while the player remains gated by the ordered maze and rear-lawn checkpoints. — tests: `scripts/test-mr-feast-hedge-maze-layout.mjs::shared Storm Run maze route` and `scripts/test-mr-feast-storm-run.mjs::contestant run contract`
- [ ] The relocated final-straight apparition remains life-size, facing the player, unobstructed, darkness-synchronized, and followed by the restored rear-exit practical. — test: `scripts/test-mr-feast-storm-run.mjs::mapped facing-gated desktop, interrupted-audio, and phone scares`
- [ ] The redesigned maze, key chamber, active Storm Run route, and final lightning corridor read clearly in real-browser desktop and phone captures with zero new console errors. — verified by user playtest; automated evidence: `scripts/test-mr-feast-storm-run.mjs` and `scripts/test-mr-feast-basement-key-trail.mjs`

## Exit condition

User enters the maze through either finished portal → must traverse at least half of the walkable layout to reach the other portal, can find the buried B-13 key only at the deep terminal chamber, and later sees Storm Run contestants follow that same route through the relocated final lightning corridor.

## Test plan

1. Add a focused source regression for maze graph coverage, key depth, and shared Storm Run route ownership; run it red against the current `25%` entrance-to-exit baseline.
2. Replace the maze grid, move the dig site, derive the race's maze leg from the grid, and relocate the final scare plus route lighting.
3. Run the focused layout test, Storm Run, basement-key trail, renovation, and Contestant 13 suites, plus runtime/test syntax and `git diff --check`.
4. Inspect `render_game_to_text()` and save desktop/phone visual proof under `output/iterate/` or `output/playwright/mr-feast-storm-run/`.

## Notes

- The pre-change grid contains `128` walkable cells; its shortest north-to-rear route uses `32`, exactly `25%`.
- The redesign deliberately keeps the maze static and authored. Graph metrics protect pacing without introducing dynamic-generation complexity.
- Existing unrelated Victory Feast exit-sealing edits in the shared runtime remain outside this milestone.
