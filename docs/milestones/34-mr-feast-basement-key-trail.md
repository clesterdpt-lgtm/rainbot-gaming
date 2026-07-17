# Milestone 34: Basement Key Trail

## Status

in-progress

## Objective

Resequence Contestant 13's opening trail so the first clue is a subtly unusual book hidden among the Library shelves. Its message separately points the player toward a garden shovel and a basement key buried in the hedge maze, making the locked basement the threshold to the existing Archive evidence and Workshop sabotage chain.

## Scope

- Replace the table-top rulebook/note with one slightly pulled, off-tone volume among otherwise ordinary Library books.
- Make the book's message point to the dead-rose garden for a shovel and the hedge maze for the basement key.
- Keep the shovel concealed in the garden and use it to excavate the key at the maze's deepest dead end.
- Lock the Kitchen service-stair door until the recovered key is used, with idempotent inventory, journal, door, and diagnostic state.
- Preserve the basement Archive recording and Workshop patron-feed sabotage as the rest of the current vertical slice.
- Preserve deterministic QA views and full desktop/mobile regression coverage.

## Out of scope

- The Workshop keypad and the clue chain for discovering its code.
- Additional basement puzzles, documents, sabotage targets, or final endings beyond the existing Archive recording and patron-feed relay.
- Mr. Feast detection, pursuit, capture, or special behavior around the new locked door.

## Dependencies

- **Depends on:** Milestone 31 — Contestant 13 Vertical Slice
- **Blocks:** Future basement puzzle network and Workshop keypad milestone

## Acceptance criteria

- [ ] The first story object is an upright book in a clean reserved gap between neighboring Library volumes, carrying one seeded ordinary catalog title and differentiated by a restrained color/height, slight pull offset, and a small scratched `XIII` on its spine. — tests: `scripts/test-mr-feast-renovation.mjs::47 basement key trail physical story` and `scripts/test-mr-feast-basement-key-trail.mjs::bookshelf clue framing`; subtlety verified by user playtest
- [x] Reading or rereading the volume opens the shared focus-managed parchment reader with the selected book's normal printed excerpt intact and the clue added separately as hurried blue handwritten marginalia at a stable seeded angle; both layers remain usable at desktop and phone layouts. — tests: `scripts/test-mr-feast-readable-books.mjs` and `scripts/test-mr-feast-basement-key-trail.mjs`
- [x] Reading the book adds one journal entry that clearly but ominously points to both the garden shovel and the hedge-maze basement key. — tests: `scripts/test-mr-feast-renovation.mjs::47 basement key trail copy` and `scripts/test-mr-feast-basement-key-trail.mjs::real interaction progression and gates`
- [x] The shovel remains independently discoverable in the garden, and the maze cache cannot be excavated without both the book clue and shovel. — test: `scripts/test-mr-feast-basement-key-trail.mjs::real interaction progression and gates`
- [x] Excavating the deepest maze dead end grants one basement key, and the Kitchen basement stair door remains locked until that key is used. — tests: `scripts/test-mr-feast-renovation.mjs::47 basement key trail state machine` and `scripts/test-mr-feast-basement-key-trail.mjs::real interaction progression and gates`
- [x] Trying the locked Kitchen basement door without the key gives only generic locked-door feedback and does not repeat or reveal the book, hedge-maze, or key solution. — test: `scripts/test-mr-feast-basement-key-trail.mjs::clue-free locked-door feedback`
- [x] Unlocking the basement is persistent and idempotent, appears in diagnostics/world state, and becomes a required gate before the Archive recording and Workshop sabotage can complete. — tests: `scripts/test-mr-feast-renovation.mjs::47 basement key trail diagnostics` and `scripts/test-mr-feast-basement-key-trail.mjs::real interaction progression and gates`
- [x] The mansion boots without new browser errors and the focused story regression is green; both full mansion suites are run and any unrelated pre-existing failures are reported. — tests: `node scripts/test-mr-feast-basement-key-trail.mjs`, `node scripts/test-mr-feast-renovation.mjs`, and `node scripts/test-mr-feast-contestant-13.mjs`

## Exit condition

User notices and reads the slightly unusual Library-shelf book, finds the shovel in the dead-rose garden, excavates the basement key at the hedge maze's deepest dead end, and uses it on the locked Kitchen basement door → the Archive recording and Workshop sabotage trail becomes accessible below.

## Test plan

1. Add Requirement 47 static checks and update the real-browser progression assertions; run both to confirm they fail against the table-top note and unlocked basement baseline.
2. Implement only the new book presentation, clue copy, basement-key progression state, and locked-door interaction.
3. Run syntax, static, and real-browser suites until green, including early-door, early-Archive, idempotency, desktop, and mobile checks.
4. Capture the shelved book before interaction and the locked/unlocked basement door states through the real browser.
5. User playtests whether the unusual book is subtle but fair to notice without QA teleports.

## Notes

- Progress continues to reset on reload.
- The maze cache remains at cell `(19, 3)`, preserving the approved deep-maze discovery pacing.
- The recovered key is the restricted-service key for the basement and its evidence cage in this slice; a later basement milestone can introduce separate keys and puzzle-specific locks.
- Mr. Feast skips the basement branch of his live visual patrol while the service-stair door is story-locked; deterministic whole-home QA temporarily releases and restores the door without advancing the quest.
- The middle Library bookcase reserves shelf `2`, slot `5` for the clue volume instead of drawing an instanced book underneath it. Its front face sits about `0.07m` ahead of the neighboring volumes, its real title is printed beneath the mark, and a zero-depth procedural decal forms the small `XIII` from broken, slightly wandering dark gouges with thin exposed-fiber edges.
- The locked basement door now reports only that it will not open. The Library book remains the authored source of the garden, maze, and key direction.
- Verified visual proof: `output/playwright/mr-feast-basement-key-trail/library-shelf-book-subtle-desktop.png` shows clear spacing on both sides, the restrained pull, and the correctly ordered spine mark; `output/iterate/xiii-scratch-closeup.png` confirms the mark reads as flat damaged leather rather than raised lettering.
- Milestone 33's unrelated face-retopology files remain preserved in the dirty worktree and are not part of this slice.
