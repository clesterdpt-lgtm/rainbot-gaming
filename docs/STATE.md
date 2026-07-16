# Project state

## Current milestone

**34 — Basement Key Trail** is in progress with automated acceptance complete and the subtle shelf-book discovery awaiting user playtest.

## Stable baseline

- Playable chain: subtly misfiled Library shelf book → rose-hidden hand shovel → B-13 basement key beneath faint XIII at the deepest hedge-maze dead end → locked Kitchen service stair → Archive evidence cage and recording → Workshop patron-feed sabotage.
- The middle Library case now omits one generated volume so the clue book occupies a clean shelf gap rather than overlapping it. The off-tone spine is pulled about `0.07m` ahead of its neighbors and carries a small scratched `XIII` above the interaction reticle.
- The shelf book separately points to the formal-garden shovel and hedge-maze key; the basement key and unlock are idempotent and exposed in diagnostics.
- The west-lawn garden paving remains one continuous `ShapeGeometry` network, with both approach lamps offset onto the grass beyond the walking line.
- Mr. Feast skips the basement patrol branch until the story door is unlocked; full-route QA temporarily releases and restores that lock without advancing story state.
- Whole-home patrol: 624.95m through 227 waypoints, all 30 major room/stair zones, and 21 route doors across the main, upper, and basement levels.
- Progress intentionally resets on reload. Mr. Feast still has no collider, perception, pursuit, attack, or failure state.

## Important constraint

The future Workshop keypad/code clue chain and broader basement puzzle/sabotage network are intentionally deferred beyond Milestone 34. The Workshop stays accessible for the existing patron-feed ending until that later milestone is designed.

## Verification

- `node --check assets/js/mr-feast-mansion.js` — passed
- `node --check scripts/test-mr-feast-basement-key-trail.mjs` — passed
- `node scripts/test-mr-feast-basement-key-trail.mjs` — passed after the shelf-spacing and `XIII` refinement: real E/touch interactions, reserved book slot diagnostics, dual clue copy, early gates, idempotent maze key, locked/unlocked door state, full-route lock restoration, Archive recording, Workshop sabotage, desktop/mobile layout, and zero console errors
- `node scripts/test-mr-feast-renovation.mjs` — all renovation and Milestone 34/Requirement 47 invariants passed on the isolated publish patch
- Previous garden browser proof completed both connection routes with zero fall recoveries and confirmed one `18.8m × 32.4m` walkway mesh
- Browser captures — `output/playwright/mr-feast-basement-key-trail/library-shelf-book-subtle-desktop.png` now visibly confirms the clean gap and correctly ordered `XIII`; `basement-door-locked-desktop.png`, `basement-door-unlocked-desktop.png`, and `library-shelf-book-mobile.png` cover the adjacent states

## Next action

User playtests whether the unusual Library volume is subtle but fair to notice without QA teleports and confirms the opening sequence. After acceptance, promote the deferred Workshop keypad/basement puzzle network into a separate milestone.

## Working conventions

- Keep the three unrelated `.rainbot-*-state.json` files untouched.
- Do not commit or push this milestone unless the user asks.
