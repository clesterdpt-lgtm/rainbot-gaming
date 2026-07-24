# Milestone 62: Window Curtain Hiding

## Status

Implementation and automated acceptance complete; user playtest remains.

## Objective

Dress every exterior mansion window with correctly oriented curtains and make each set a real hiding place. Entering closes the fabric around the player while preserving one deliberately offset viewing crack; leaving reopens it. The feature reuses the authoritative hiding, camera, and pursuit contract instead of creating a weaker decorative-only stealth state.

## Scope

- Install curtain sets at all 67 exterior window openings: 23 on the main level, 25 on the second floor, and 19 in the basement.
- Face every damask side into its room, keep the lining toward the glass, and move the curtain plane from the visibly detached `0.58m` wall inset to a close architectural mounting no more than `0.36m` from the wall center.
- Give every set textured oxblood damask fabric, modeled vertical folds, a lined double-sided surface, and brass rods, rings, finials, and tiebacks.
- Expose ordinary E/touch `Hide behind … curtains` and `Leave … curtains` interactions.
- Animate the panels from a tied-open composition to a mostly closed hiding composition.
- Alternate a small left/right viewing crack across the authored installations and keep the partial view readable on desktop and phone.
- Reuse `state.isHidden`, `state.activeHideSpot`, movement locking, flashlight shutdown, camera occlusion, and bounded pursuit loss.
- Expose curtain placement, material, animation, crack, overlap-clearance, active-hide, and responsive-view diagnostics plus focused QA controls.

## Out of scope

- Opening exterior windows, climbing through them, cutting curtains, carrying fabric, or adding new inventory/UI controls.
- A second hiding-state implementation, new camera rules, or new Mr. Feast pathfinding.
- Runtime-downloaded assets, new shader lights, or shadow-casting curtain fabric.

## Dependencies

- **Depends on:** Milestone 36 — Camera Surveillance and Alarm Investigation; Milestone 46 — Caught in the Act
- **Blocks:** none

## Acceptance criteria

- [x] Exactly 67 named curtain installations cover all 23 main-level, 25 second-floor, and 19 basement exterior windows, with no uncovered window IDs. — test: `scripts/test-mr-feast-window-curtains.mjs::complete exterior-window coverage`
- [x] Every installation's damask/front normal faces the room with an inward dot of at least `0.99`, its lining faces the glass, and its root is no farther than `0.36m` from the wall center. — test: `scripts/test-mr-feast-window-curtains.mjs::orientation and close wall mounting`
- [x] Every installation uses one shared procedural woven-damask texture, modeled folds, double-sided lined fabric, and brass rod/ring/finial/tieback dressing without adding a shader light or casting curtain shadows. — test: `scripts/test-mr-feast-window-curtains.mjs::material and geometry contract`
- [x] Every curtain and its resolved inward exit pocket report zero non-structural mesh overlaps, and every exterior window exposes a reachable interaction prompt without displacing the fabric away from its opening. — test: `scripts/test-mr-feast-window-curtains.mjs::clearance and reachable prompts`
- [x] Real E and touch Interact close a curtain, enter the existing authoritative hidden state, lock movement, switch off the flashlight, and leave the camera/pursuit concealment contract unchanged. — test: `scripts/test-mr-feast-window-curtains.mjs::desktop and touch hiding`
- [x] Closed panels leave a `0.12–0.18m` crack offset visibly left or right; both sides are represented, the stage treatment matches the authored side, and looking remains available through the partial view. — test: `scripts/test-mr-feast-window-curtains.mjs::left and right partial views`
- [x] Leaving through E/touch restores the open tied-back composition, returns the player to a clear inward exit position, removes curtain-specific stage treatment, and keeps the curtain immediately reusable. — test: `scripts/test-mr-feast-window-curtains.mjs::exit and reuse`
- [x] `render_game_to_text()` and focused `window.MrFeastFresh` controls expose every placement, visual/material cost, panel openness, crack side/width, clearance audit, active spot, and desktop/mobile viewing treatment. — test: `scripts/test-mr-feast-window-curtains.mjs::diagnostics`
- [ ] User playtest confirms all curtains face into their rooms, sit close to their walls, the fabric reads as expensive mansion drapery, the hiding view feels tense but usable, and none of the 67 installations clips nearby furniture or circulation. — verified by user playtest

## Exit condition

User can visit every exterior window and find room-facing curtains mounted close to its wall, then approach any set, press E or touch Interact, see the textured panels close around them with a narrow crack clearly offset to one side, remain able to look while movement/cameras/Mr. Feast respect the existing hidden state, and exit back into a clear room pocket with the curtains tied open again.

## Test plan

The original focused regression failed red on the missing named `WINDOW_CURTAINS` tuning table before the first ten installations landed. This refinement expanded that suite red-first to require all 67 exterior window IDs, positive room-facing normals, close wall mounting, and zero visual/egress overlaps before implementation changes. The completed browser sequence stages every installation from its real inward approach, exercises left/right desktop and touch hiding, and captures the corrected east wall, crowded Kitchen, wide upper gallery, elevated basement, and open/hidden desktop/mobile states with zero console errors. Final verification includes runtime/test syntax, renovation, room dressing, House Distractions, Workroom security, camera security, caught pursuit, flashlight, Feast Hunt, full Contestant 13, and `git diff --check`.

## Notes

- This promotes the additional route/hiding leverage portion of the 2026-07-24 mansion-interaction backlog without claiming the broader room-interaction item is complete.
- The user's follow-up replaces the original ten-window/exclusion rule: every opening now receives curtains, while placement overrides and clearance resolution preserve crowded rooms.
- The original coat closet remains a separate `HidingSpot` using the same authoritative state.
- Browser proof lives under `output/playwright/mr-feast-window-curtains/`, including `east-wall-curtain-room-facing-desktop.png`, `kitchen-curtain-close-mounted-desktop.png`, `upper-gallery-curtain-covered-desktop.png`, and `basement-curtain-covered-desktop.png`.
