# Milestone 62: Window Curtain Hiding

## Status

Implementation and automated acceptance complete; user playtest remains.

## Objective

Add richly dressed curtains to a curated set of full-height mansion windows and make each set a real hiding place. Entering closes the fabric around the player while preserving one deliberately offset viewing crack; leaving reopens it. The feature reuses the authoritative hiding, camera, and pursuit contract instead of creating a weaker decorative-only stealth state.

## Scope

- Install ten curtain sets at windows with verified prop and egress clearance: two in the Library, two in the Music Room, two in the Dining Room, two in the Ballroom, and two in the upper rear lounge.
- Give every set textured oxblood damask fabric, modeled vertical folds, a lined double-sided surface, and brass rods, rings, finials, and tiebacks.
- Expose ordinary E/touch `Hide behind … curtains` and `Leave … curtains` interactions.
- Animate the panels from a tied-open composition to a mostly closed hiding composition.
- Alternate a small left/right viewing crack across the authored installations and keep the partial view readable on desktop and phone.
- Reuse `state.isHidden`, `state.activeHideSpot`, movement locking, flashlight shutdown, camera occlusion, and bounded pursuit loss.
- Expose curtain placement, material, animation, crack, overlap-clearance, active-hide, and responsive-view diagnostics plus focused QA controls.

## Out of scope

- Curtains on kitchen backsplash windows, basement windows, windows behind bed headboards/bookcases/fireplaces, or the guarded upper foyer gallery.
- Opening exterior windows, climbing through them, cutting curtains, carrying fabric, or adding new inventory/UI controls.
- A second hiding-state implementation, new camera rules, or new Mr. Feast pathfinding.
- Runtime-downloaded assets, new shader lights, or shadow-casting curtain fabric.

## Dependencies

- **Depends on:** Milestone 36 — Camera Surveillance and Alarm Investigation; Milestone 46 — Caught in the Act
- **Blocks:** none

## Acceptance criteria

- [x] Exactly ten named full-height curtain installations cover the Library, Music Room, Dining Room, Ballroom, and upper rear lounge while kitchen, basement, bed-headboard, fireplace, bookcase, and upper-gallery windows remain excluded. — test: `scripts/test-mr-feast-window-curtains.mjs::authored placement and exclusions`
- [x] Every installation uses one shared procedural woven-damask texture, modeled folds, double-sided lined fabric, and brass rod/ring/finial/tieback dressing without adding a shader light or casting curtain shadows. — test: `scripts/test-mr-feast-window-curtains.mjs::material and geometry contract`
- [x] Every curtain and its inward exit pocket report zero non-structural mesh overlaps, and every authored approach exposes a reachable interaction prompt. — test: `scripts/test-mr-feast-window-curtains.mjs::clearance and reachable prompts`
- [x] Real E and touch Interact close a curtain, enter the existing authoritative hidden state, lock movement, switch off the flashlight, and leave the camera/pursuit concealment contract unchanged. — test: `scripts/test-mr-feast-window-curtains.mjs::desktop and touch hiding`
- [x] Closed panels leave a `0.12–0.18m` crack offset visibly left or right; both sides are represented, the stage treatment matches the authored side, and looking remains available through the partial view. — test: `scripts/test-mr-feast-window-curtains.mjs::left and right partial views`
- [x] Leaving through E/touch restores the open tied-back composition, returns the player to a clear inward exit position, removes curtain-specific stage treatment, and keeps the curtain immediately reusable. — test: `scripts/test-mr-feast-window-curtains.mjs::exit and reuse`
- [x] `render_game_to_text()` and focused `window.MrFeastFresh` controls expose every placement, visual/material cost, panel openness, crack side/width, clearance audit, active spot, and desktop/mobile viewing treatment. — test: `scripts/test-mr-feast-window-curtains.mjs::diagnostics`
- [ ] User playtest confirms the fabric reads as expensive mansion drapery, the hiding view feels tense but usable, and none of the ten installations clips nearby furniture or circulation. — verified by user playtest

## Exit condition

User approaches any authored curtain set, presses E or touch Interact, sees the textured panels close around them with a narrow crack clearly offset to one side, remains able to look while movement/cameras/Mr. Feast respect the existing hidden state, then exits back into a clear room pocket and sees the curtains tie open again.

## Test plan

Created `scripts/test-mr-feast-window-curtains.mjs` before implementation and confirmed it failed on the missing named `WINDOW_CURTAINS` tuning table. The completed focused browser sequence checks all ten authored positions and exclusions, validates material/geometry cost plus overlap audits, enters left- and right-crack curtains through real E, proves movement lock and flashlight shutdown, exits/reuses them, repeats the interaction with the existing phone touch control, and captures desktop/mobile open and hidden views with zero console errors. Runtime/test syntax, renovation, camera security, caught pursuit, Feast Hunt, full Contestant 13, and `git diff --check` pass.

## Notes

- This promotes the additional route/hiding leverage portion of the 2026-07-24 mansion-interaction backlog without claiming the broader room-interaction item is complete.
- Curtain locations are explicit authored installations, not an automatic “decorate every window” rule; exclusions are part of the collision/readability contract.
- The original coat closet remains a separate `HidingSpot` using the same authoritative state.
- Browser proof lives under `output/playwright/mr-feast-window-curtains/`; final iterate captures are `output/iterate/2026-07-24-window-curtain-library-open-final.png` and `output/iterate/2026-07-24-window-curtain-hidden-left-final.png`.
