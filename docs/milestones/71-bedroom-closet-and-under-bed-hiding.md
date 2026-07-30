# Milestone 71: Bedroom Closet and Under-Bed Hiding

## Status

In progress with implementation and automated acceptance complete; closet timing, under-bed view height, exit placement, and hiding tension await user playtest.

## Objective

Let the player use every upper bedroom's real walk-in closet and bed as a hiding place. Closet hiding should close the wardrobe doors around the player and reopen them for exit. Under-bed hiding should present a believable low first-person slit beneath a visibly raised frame. Both use the mansion's existing authoritative hiding state, E/touch interaction, movement lock, flashlight shutdown, camera concealment, Mr. Feast/Saint concealment, breath-stealth rules, and explicit leave interaction.

## Scope

- Four walk-in closet hiding spots: West Front Suite, East Front Suite, Primary Suite, and East Rear Suite.
- Four under-bed hiding spots in the same suites.
- Named `BEDROOM_HIDING` tuning for stable ids, suite labels, approach/exit clearance, bed camera height, stage treatment, and breath muffling.
- Real open-closet entry followed by automatic door closure, persistent leave prompt, and automatic reopening before normal play resumes.
- Raised bed frames with visible legs/rails and a real low visual gap; the player capsule remains in a clear room pocket while a hiding-only camera anchor supplies the under-bed view.
- Focused diagnostics and deterministic QA controls through `render_game_to_text()` and `window.MrFeastFresh`.
- Desktop E and the existing touch Interact control; no new HUD button.

## Out of scope

- New hiding inventory, durability, quick-time events, door barricading, or combat.
- AI opening closets or pulling the player from under a bed without an existing authoritative detection source such as close audible breathing.
- New bedroom geometry, additional bedrooms, or changes to competition routes.
- A second hidden-state implementation or changes to camera/Mr. Feast/Saint policy.

## Dependencies

- **Depends on:** Milestone 1 coat-closet hiding authority, Milestone 62 curtain hiding, Milestone 67 breath stealth.
- **Blocks:** none.

## Acceptance criteria

- [x] Exactly eight new bedroom hiding spots exist: one closet and one bed in each of the West Front, East Front, Primary, and East Rear suites. Every spot has a stable id, suite ownership, category, reachable authored approach, clear exit, and focused diagnostics. — test: `scripts/test-mr-feast-bedroom-hiding.mjs::inventory and staging`
- [x] Opening a real bedroom walk-in and interacting with its interior exposes `Hide in … closet`; entering closes both doors around the player, retains the leave interaction even after the interior becomes visually sealed, and exiting reopens the closet before returning the player to a clear room pocket. — test: `scripts/test-mr-feast-bedroom-hiding.mjs::closet lifecycle`
- [x] All four beds use a raised leg-and-rail frame with a visible low gap. A reachable side interaction exposes `Hide under … bed`, enters a low camera position inside that gap, applies a responsive under-bed slit treatment, and exits beside the same bed without intersecting its collider or nearby nightstands/trunk. — test: `scripts/test-mr-feast-bedroom-hiding.mjs::under-bed lifecycle`
- [x] Both categories reuse `state.isHidden` and `state.activeHideSpot`, switch off the flashlight, lock keyboard/touch movement while preserving look, peg concealment to hidden, block camera/personal visual acquisition, and retain existing close-breath exposure rules through named hiding kinds/multipliers. — test: focused bedroom hiding plus existing camera/pursuit/breath suites
- [x] Real E enters/leaves all eight spots on desktop. The existing 44px-or-larger touch Interact control enters/leaves a representative closet and bed at 390×844 with the hidden status visible and no stage overflow. — test: `scripts/test-mr-feast-bedroom-hiding.mjs::desktop and mobile input`
- [x] `render_game_to_text()` and `window.MrFeastFresh` expose the complete bedroom hiding inventory, active id/category, enclosure state, camera height, authored positions, and deterministic stage/advance controls without bypassing the real interaction path. — test: `scripts/test-mr-feast-bedroom-hiding.mjs::diagnostics`
- [x] Runtime/test syntax, focused bedroom hiding, window curtains, retired breath-stealth compatibility, flashlight, Victory Feast, and full desktop/mobile Contestant 13 regressions pass with clean focused browser consoles. Renovation retains only its documented unrelated `28 stairwell continuity` baseline. — tests: existing mansion suites
- [ ] User playtest confirms the closet entry/door timing, under-bed camera height, exit placement, and hiding tension feel natural on desktop or phone. — verified by user playtest

## Exit condition

The player can naturally open any bedroom walk-in and hide inside it, or approach either side of the room's bed and hide underneath. The view, prompt, threat concealment, movement lock, flashlight state, breathing risk, and exit all remain consistent with the mansion's existing hiding language.

## Test plan

Run `node scripts/test-mr-feast-bedroom-hiding.mjs` red before implementation. The green browser flow must use real E and touch Interact, inspect `render_game_to_text()` before screenshots, exercise all eight authored spots, confirm closet door and under-bed camera transitions, attempt movement while hidden, verify flashlight shutdown, capture desktop and 390×844 proof, and report console errors. Then run runtime/test syntax, `git diff --check`, renovation, window curtains, breath stealth, flashlight, Victory Feast, and full Contestant 13.

## Verification

The source contract first failed red on `missing named BEDROOM_HIDING tuning table`. The completed focused Chromium run exercised real E entry/exit at all eight spots, touch entry/exit for a representative closet and bed at 390×844, closet closure/reopening, a `0.24m` under-bed camera, movement lock, flashlight shutdown, and clean consoles. Desktop and phone proof is under `output/playwright/mr-feast-bedroom-hiding/`. Runtime/test syntax, `git diff --check`, window curtains, retired breath-stealth compatibility, flashlight, Victory Feast, and the full desktop/mobile Contestant 13 suite pass. Renovation reports only its pre-existing `28 stairwell continuity` invariant.
