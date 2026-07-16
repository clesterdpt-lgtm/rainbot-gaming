# Milestone 40: Upper Window Gallery

## Status

in-progress

## Objective

Finish the narrow second-floor crosswalk directly inside the Grand Foyer's large front window so it reads as an intentional gallery rather than an exposed slab. The deck becomes wide enough for believable circulation, gains a continuous mansion-matched guard on the open foyer edge, and carries Mr. Feast through the center of the usable path.

## Scope

- Deepen the existing marble front crosswalk while preserving its connection to both balcony wings and the large window.
- Join a dark-wood, iron-baluster, and brass-detailed railing to the existing east and west balcony guards, including matching collision.
- Recenter the three front-gallery Mr. Feast patrol points on the widened path.
- Add deterministic layout diagnostics, a physical edge-guard check, a full balcony-loop traversal check, and focused visual proof.

## Out of scope

- Changes to the large front window, Grand Foyer chandelier, grand staircase, adjacent suites, or camera placement.
- Changes to Mr. Feast's gait, route order, perception, or collision model.

## Dependencies

- **Depends on:** Milestone 39 — Mr. Feast Grounded Gait
- **Blocks:** none

## Acceptance criteria

- [x] The front-window gallery deck is at least `1.6 m` deep and provides at least `1.4 m` of usable space between the inside wall and its guard. — tests: `scripts/test-mr-feast-renovation.mjs::54 upper window gallery dimensions` and `scripts/test-mr-feast-upper-window-gallery.mjs::layout diagnostics`
- [x] A continuous railing with top rail, repeated balusters, corner newels, and a matching Rapier guard spans the full open foyer edge and prevents the player from stepping off. — tests: `scripts/test-mr-feast-renovation.mjs::54 upper window gallery guard` and `scripts/test-mr-feast-upper-window-gallery.mjs::physical edge guard`
- [x] Mr. Feast's east, center, and west front-gallery patrol points share the widened deck centerline, while the existing player balcony loop remains grounded with zero fall recoveries. — tests: `scripts/test-mr-feast-renovation.mjs::54 upper window gallery patrol` and `scripts/test-mr-feast-upper-window-gallery.mjs::balcony loop traversal`
- [ ] The gallery, guard returns, large window, and foyer sightline read as one finished architectural composition. — verified by user playtest; visual proof: `output/iterate/2026-07-16-upper-window-gallery-after.png` and `output/iterate/2026-07-16-upper-window-gallery-foyer-after.png`
- [x] The mansion runtime remains syntax-clean, both mansion suites retain their prior results, and the focused browser check reports no console errors. — tests: `node scripts/test-mr-feast-renovation.mjs`, `node scripts/test-mr-feast-contestant-13.mjs`, and `node scripts/test-mr-feast-upper-window-gallery.mjs`

## Exit condition

User walks the second-floor path in front of the large window and watches Mr. Feast cross it → the route feels comfortably wide, the open edge is fully guarded, and the gallery looks intentionally finished from both floors.

## Test plan

1. Capture the current exposed crosswalk from the existing `overlookDown` QA view.
2. Add static dimension/railing/patrol assertions plus a browser check that walks into the currently unguarded edge; confirm both fail for the intended reasons.
3. Implement one named upper-window-gallery layout shared by the slab, guard, patrol points, QA views, and diagnostics.
4. Re-run the focused edge/loop test, inspect `render_game_to_text()`, and capture the finished gallery from upper- and main-floor sightlines.
5. Run syntax, renovation, Contestant 13, and diff checks; report any unrelated dirty-worktree failures separately.

## Notes

- The previous crosswalk was only `0.9 m` deep and ended flush with the large window wall. Its foyer-side edge at `z=11.1` had no railing.
- The existing side balcony guards already establish the material language; this refinement extends that same construction around the window gallery rather than adding a new style.
- The finished marble deck is `1.7 m` deep with `1.5 m` of named usable clearance. Its new `0.98 m` guard spans `6.84 m`, returns cleanly into the shortened side guards, and has a matching fixed Rapier collider.
- The focused browser probe now walks into the new guard without leaving the second floor, and the full `upperBalconyLoop` completes with zero fall recoveries and unchanged light circuits.
