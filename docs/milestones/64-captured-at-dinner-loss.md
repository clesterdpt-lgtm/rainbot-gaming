# Milestone 64: Captured at Dinner Loss

## Status

In progress with implementation and automated acceptance complete; final desktop/phone tone and composition await user playtest.

## Objective

Replace the abrupt overlay used after a physical catch with a complete first-person loss tableau: the captured player wakes on the Dining Room table as the main course, six masked Patrons wait in formal dress, and Mr. Feast presides over the sacrifice with one final game-show-meets-banquet line before recoverable load/restart controls appear.

## Scope

- Route physical Mr. Feast catches into a short, non-interactive banquet presentation while leaving no-show and score-based eliminations immediate.
- Lock the camera to a low first-person view along the existing Dining Room table and frame Mr. Feast at its far end.
- Reuse one Meshy-generated, rigged, Blender-prepared formal Patron body at all six audience seats.
- Give every seated Patron a unique creepy mask silhouette, derived from a credit-conscious set of Meshy source masks and finished as six runtime variants in Blender.
- Preserve the existing Dining Room architecture and service while adding loss-only candles, ritual place-card dressing, and a restrained first-person serving-platter frame.
- Deliver Mr. Feast's authored closing line, then reveal the existing load/restart recovery controls.
- Expose asset provenance, camera/tableau state, patron placement, mask identity, dialogue, timing, and overlay state through `render_game_to_text()` and focused `MrFeastFresh` controls.

## Out of scope

- Gore, dismemberment, an eating animation, or depicting the Guest/demon directly.
- The Winner's Dinner choice, escape ending, true sabotage ending, or Juniper's finale.
- New cultist locomotion, combat AI, or free-roam Patron appearances.
- Replacing the existing Dining Room furniture or increasing the mansion's normal gameplay light budget.
- Banquet treatment for no-show, Feast Says score, Storm Run placement, or Juniper race losses that did not involve a physical catch.

## Dependencies

- **Depends on:** Milestone 46 — Caught in the Act; Milestone 59 — Feast Hunt Third Competition
- **Blocks:** future Winner's Dinner ending milestone

## Acceptance criteria

- [x] A physical `witnessed`, `recorded`, or `feast-hunt-eliminated` catch starts the banquet tableau before the game-over overlay, while non-catch eliminations retain their immediate overlay. — test: `scripts/test-mr-feast-banquet-loss.mjs::catch routing`
- [x] The first-person camera begins face-up toward the Dining Room ceiling from a fixed lying position, then accepts mouse and touch look so the player can inspect both Patron rows and Mr. Feast while movement/HUD controls remain suppressed. — test: `scripts/test-mr-feast-banquet-loss.mjs::lying free-look viewpoint`
- [x] The banquet remains explorable for at least 20 seconds before the recovery overlay appears, including time before and after Mr. Feast's complete closing line. — test: `scripts/test-mr-feast-banquet-loss.mjs::extended look window`
- [x] Six visible seated Patrons surround the table, reuse one rigged formal body source, face the player, and each reports a distinct mask id/runtime file. — test: `scripts/test-mr-feast-banquet-loss.mjs::patron tableau`
- [x] The checked-in banquet manifest records one Meshy body task, rigging provenance, three or fewer Meshy mask source tasks, six Blender-finished unique mask variants, bounds, forward axes, and runtime file budgets. — test: `scripts/test-mr-feast-banquet-loss.mjs::asset provenance`
- [x] The loss-only table dressing identifies `CONTESTANT 13 — MAIN COURSE` and uses the existing Dining Room/table without changing gameplay colliders or normal visibility. — test: `scripts/test-mr-feast-banquet-loss.mjs::ritual dressing`
- [x] Mr. Feast says, `Contestant Thirteen—you lost the million, but you still made the final cut. Our patrons call it sacrifice. The Guest calls it supper. I call it a feast.` before the recovery controls appear. — test: `scripts/test-mr-feast-banquet-loss.mjs::closing performance`
- [x] Load-last-save and Start-over remain reachable after the closing line, and clearing/loading a game removes the loss-only scene and restores ordinary camera/host presentation. — test: `scripts/test-mr-feast-banquet-loss.mjs::recoverable ending`
- [ ] Desktop and phone captures clearly read as first-person-on-the-table, keep Mr. Feast visible, and show at least four distinct mask silhouettes without clipping through the table, chairs, or one another. — verified by user playtest

## Exit condition

Mr. Feast physically catches the player → the game cuts to a readable first-person Dining Room sacrifice tableau with six uniquely masked formal Patrons, Mr. Feast delivers the complete final-cut/sacrifice/supper line, and only then do Load last save and Start over appear.

## Test plan

Create `scripts/test-mr-feast-banquet-loss.mjs` before implementation and confirm it fails because the named banquet-loss system is absent. Turn the focused source/asset/browser assertions green, capture desktop and phone table views, and inspect the images for mask uniqueness, seating, framing, clipping, and restrained horror tone. Then run runtime/test syntax, Caught in the Act, Feast Hunt, renovation, Contestant 13, and `git diff --check`.

## Verification

- The focused regression failed red first with `missing named banquet-loss tuning table`, then passed the complete desktop/phone source, asset, staging, dialogue, timing, recovery, and non-catch-bypass contract.
- Meshy generated one formal Patron body plus three mask sources; the body was rigged once, and Blender 4.5 prepared one shared browser body and six distinct optimized mask variants. The manifest records all task IDs, bounds, runtime files, and the `125`-credit generation total.
- Banquet GLBs stay deferred during ordinary exploration and load only after a physical catch. The focused test proves `assetStatus: "idle"` before capture, then waits for the real loss route to load and reveal the tableau.
- Runtime/test syntax, renovation invariants, focused banquet loss, caught pursuit, pursuit/evasion, full Feast Hunt, and full desktop/mobile Contestant 13 pass. Focused browser console capture is clean.
- Inspected visual proof is `output/playwright/mr-feast-banquet-loss/banquet-table-desktop.png`, `banquet-closing-line-desktop.png`, and `banquet-table-phone.png`.
- The face-up/free-look refinement failed red first with `focused banquet QA controls must include deterministic free look`. The green browser pass starts at a `1.32rad` ceiling pitch, preserves unlimited horizontal mouse look plus bounded touch pitch from `-0.18` to `1.42rad`, proves a real phone drag, captures both Patron rows, and delays recovery until `24s`. New proof is `banquet-ceiling-reveal-desktop.png`, `banquet-look-left-desktop.png`, and `banquet-look-right-desktop.png`.

## Notes

- The source body is generated once and rigged even though the runtime performance is seated; six clones share the same authored seated loop.
- Three Meshy mask source generations is the credit ceiling for this slice. Blender may mirror, reshape, add authored ornament, retint, and re-export those sources into six visibly distinct runtime masks.
- The sequence promotes only the captured-at-dinner half of the existing combined backlog item. Escape/exposure endings remain deferred.
