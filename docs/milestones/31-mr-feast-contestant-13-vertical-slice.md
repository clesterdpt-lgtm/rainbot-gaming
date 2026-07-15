# Milestone 31: Contestant 13 Vertical Slice

## Status

in-progress — automated acceptance complete; awaiting user playtest

## Objective

Turn the finished mansion into a small playable investigation-and-sabotage loop. The player follows a previous contestant's trail from the Library to the formal garden, through the hedge maze, into an evidence cage in the Archive, and finally to the private-camera relay in the Workshop.

## Scope

- Add a readable Contestant 13 clue, a small shovel concealed among the roses, and a shovel-gated cache at the maze's deepest dead end.
- Recover an A-3 Archive key, contestant badge, and tape without allowing duplicate rewards.
- Lock only the evidence cage around the Archive recorder; preserve free access to the Archive itself.
- Play the recovered recording to identify the correct Workshop sabotage target.
- Sabotage the patron camera feed through a timed interaction that leaves a persistent visual and diagnostic state.
- Add an objective HUD, inventory feedback, discovery messages, and a readable journal for desktop and touch layouts.
- Expose stable QA views and diagnostic state for the full chain.

## Out of scope

- Mr. Feast detection, pursuit, capture, or combat. A visual-only whole-home patrol is now present as a foundation for those later systems.
- Saving quest progress between page reloads.
- Voice acting for Contestant 13's recording.
- The final escape, exposure, rescue, or banquet ending.
- Additional item chains elsewhere in the mansion.

## Dependencies

- **Depends on:** Milestone 30 — Painting Room Atelier
- **Blocks:** Future Mr. Feast detection/pursuit and full sabotage-loop milestones

## Acceptance criteria

- [x] The intended Library → garden → maze → Archive → Workshop trail can be completed through ordinary in-world interactions, while early dig/cage/relay attempts remain safely gated. — test: `scripts/test-mr-feast-contestant-13.mjs::real interaction progression and gates`
- [x] Inventory rewards and journal entries are idempotent, and collected world items cannot be picked up twice. — test: `scripts/test-mr-feast-contestant-13.mjs::idempotent inventory and journal`
- [x] The evidence cage, recorder, and camera relay visibly reflect their unlocked, played, and sabotaged states without changing mansion light-circuit counts. — test: `scripts/test-mr-feast-renovation.mjs::41 Contestant 13 physical state`
- [x] Diagnostics expose objective, inventory, journal, every Contestant 13 progression flag, completion state, and future-NPC threat escalation. — test: `scripts/test-mr-feast-renovation.mjs::41 Contestant 13 diagnostics`
- [x] The objective and inventory HUD remain readable on desktop and 390×844 touch layouts, and the touch interaction control can collect the shovel. — test: `scripts/test-mr-feast-contestant-13.mjs::mobile HUD and touch pickup`
- [x] The mansion boots without new browser errors and its existing renovation regression remains green. — test: `node scripts/test-mr-feast-renovation.mjs`
- [x] Discovery tuning keeps the reduced shovel inside a rose bed but reliably interactable, moves the cache 82 cells into the maze, makes the XIII mark subdued, and leaves only an unmarked hole after excavation. — tests: `scripts/test-mr-feast-renovation.mjs::42 Contestant 13 discovery tuning` and `scripts/test-mr-feast-contestant-13.mjs::world discovery state`
- [ ] The hidden shovel and subdued cache remain discoverable without feeling highlighted or unfair during an ordinary no-teleport playthrough. — verified by user playtest
- [ ] Story objects, clue readability, discovery pacing, and sabotage feedback feel clear and ominous. — verified by user playtest

## Exit condition

User reads Contestant 13's Library note, finds the short shovel hidden inside the roses, follows the maze beyond the old goal to its deepest dead end, excavates the faint mark into an unmarked hole, unlocks and plays the Archive recording, then disables the Workshop patron feed → the case file marks the slice complete and warns that the signal loss has escalated danger.

## Test plan

1. Run `node scripts/test-mr-feast-renovation.mjs` before implementation and confirm the new Requirement 41 checks fail for missing story behavior.
2. Run `node scripts/test-mr-feast-contestant-13.mjs` before implementation and confirm it fails because the new QA views/diagnostics do not exist.
3. Implement the smallest complete chain, then run `node --check assets/js/mr-feast-mansion.js` and both tests until green.
4. Perform a headed browser playthrough using only teleports plus the real `E`/touch interaction path; review desktop and mobile screenshots.
5. User playtests the exit condition for subjective clue clarity and tension.

## Notes

- Progress intentionally resets on reload for this first slice.
- The shovel may be discovered before the Library note. The objective and journal must adapt without corrupting later progression.
- The cache is at maze cell `(19, 3)`, 82 moves from the rear entrance and 30 moves beyond the former cache cell on the same reachable route.
- Disabling the patron feed raises a persistent threat hook for the current visual-only Mr. Feast patrol, but this milestone does not pretend detection or pursuit exists yet.
- Discovery-tuning captures: `output/playwright/mr-feast-contestant-13/shovel-hidden-in-roses-desktop.png`, `dig-site-subtle-desktop.png`, and `dig-site-empty-hole-desktop.png`.
- Additional desktop captures: `output/playwright/mr-feast-contestant-13/library-clue-desktop.png`, `recording-played-desktop.png`, and `relay-sabotaged-desktop.png`.
- Automated touch capture: `output/playwright/mr-feast-contestant-13/shovel-picked-up-mobile.png` at 390×844.
