# Milestone 62: Window Curtain Hiding

## Status

Implementation and automated acceptance complete; user playtest remains.

## Objective

Dress the mansion's main and upper exterior windows with correctly oriented curtains while keeping the basement openings bare. The five Kitchen sets remain decorative dressing only; the other sets are real hiding places. Entering an interactive set closes the fabric around the player while preserving one deliberately offset viewing crack; leaving reopens it. The feature reuses the authoritative hiding, camera, and pursuit contract instead of creating a weaker parallel stealth state.

## Scope

- Preserve the complete 67-window inventory while installing curtain sets only at the 48 main/upper openings: 23 on the main level and 25 on the second floor; all 19 basement openings remain completely bare.
- Keep all five Kitchen sets as non-interactive decor with no interaction hitbox, `HidingSpot`, prompt, or hidden-state transition. The remaining 43 sets keep real hiding interactions.
- Face every damask side into its room, keep the lining toward the glass, and move the curtain plane from the visibly detached `0.58m` wall inset to a close architectural mounting no more than `0.36m` from the wall center.
- Give every set textured oxblood damask fabric, modeled vertical folds, a lined double-sided surface, and brass rods, rings, finials, and tiebacks.
- Expose ordinary E/touch `Hide behind … curtains` and `Leave … curtains` interactions only on the 43 eligible sets.
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

- [x] The inventory still reports exactly 67 exterior windows, but only the 23 main-level and 25 second-floor openings instantiate curtains; all 19 basement IDs are intentionally bare with no curtain root, panel, rod, valance, or hiding system. — test: `scripts/test-mr-feast-window-curtains.mjs::window and curtain inventories`
- [x] Exactly five Kitchen installations remain visible but report `interactive: false`, expose no curtain prompt or hitbox, and cannot enter the hidden state through real E input; the other 43 installations remain interactive. — test: `scripts/test-mr-feast-window-curtains.mjs::Kitchen decorative-only contract`
- [x] Every installation's damask/front normal faces the room with an inward dot of at least `0.99`, its lining faces the glass, and its root is no farther than `0.36m` from the wall center. — test: `scripts/test-mr-feast-window-curtains.mjs::orientation and close wall mounting`
- [x] Every installation uses one shared procedural woven-damask texture, modeled folds, double-sided lined fabric, and brass rod/ring/finial/tieback dressing without adding a shader light or casting curtain shadows. — test: `scripts/test-mr-feast-window-curtains.mjs::material and geometry contract`
- [x] Every curtain reports zero non-structural visual overlaps; all 43 interactive sets also report clear inward exit pockets and reachable prompts without displacing the fabric away from its opening. — test: `scripts/test-mr-feast-window-curtains.mjs::clearance and reachable prompts`
- [x] Real E and touch Interact close a curtain, enter the existing authoritative hidden state, lock movement, switch off the flashlight, and leave the camera/pursuit concealment contract unchanged. — test: `scripts/test-mr-feast-window-curtains.mjs::desktop and touch hiding`
- [x] Closed panels leave a `0.12–0.18m` crack offset visibly left or right; both sides are represented, the stage treatment matches the authored side, and looking remains available through the partial view. — test: `scripts/test-mr-feast-window-curtains.mjs::left and right partial views`
- [x] Leaving through E/touch restores the open tied-back composition, returns the player to a clear inward exit position, removes curtain-specific stage treatment, and keeps the curtain immediately reusable. — test: `scripts/test-mr-feast-window-curtains.mjs::exit and reuse`
- [x] `render_game_to_text()` and focused `window.MrFeastFresh` controls expose every placement, visual/material cost, panel openness, crack side/width, clearance audit, active spot, and desktop/mobile viewing treatment. — test: `scripts/test-mr-feast-window-curtains.mjs::diagnostics`
- [ ] User playtest confirms all 48 curtains face into their rooms, sit close to their walls, the Kitchen dressing reads as decorative only, basement windows are cleanly bare, the fabric reads as expensive mansion drapery, the hiding view feels tense but usable, and no installation clips nearby furniture or circulation. — verified by user playtest

## Exit condition

User finds room-facing curtains mounted close to every main/upper exterior opening and clean bare frames at every basement opening. Kitchen curtains read as visual dressing without a hide prompt. At any of the other 43 sets, the user can press E or touch Interact, see the textured panels close around them with a narrow crack clearly offset to one side, remain able to look while movement/cameras/Mr. Feast respect the existing hidden state, and exit back into a clear room pocket with the curtains tied open again.

## Test plan

The original focused regression failed red on the missing named `WINDOW_CURTAINS` tuning table before the first ten installations landed. The all-window follow-up expanded it to 67 installations. This eligibility refinement then failed red against that behavior until the suite could distinguish the 67-window inventory from 48 visual installations, require 43 interactive hiding spots plus five decorative Kitchen sets, and require 19 intentionally bare basement IDs. The completed browser sequence stages every eligible installation from its real inward approach, proves real E cannot hide at every Kitchen set, exercises left/right desktop and touch hiding, and captures the corrected east wall, crowded Kitchen, wide upper gallery, bare basement, and open/hidden desktop/mobile states with zero console errors.

## Notes

- This promotes the additional route/hiding leverage portion of the 2026-07-24 mansion-interaction backlog without claiming the broader room-interaction item is complete.
- The latest user refinement supersedes the interim all-window rule: main and upper openings stay dressed, Kitchen fabric is decorative-only, and basement curtains are removed altogether.
- The original coat closet remains a separate `HidingSpot` using the same authoritative state.
- Browser proof lives under `output/playwright/mr-feast-window-curtains/`, including `east-wall-curtain-room-facing-desktop.png`, `kitchen-curtain-decorative-only-desktop.png`, `upper-gallery-curtain-covered-desktop.png`, and `basement-window-bare-desktop.png`.
