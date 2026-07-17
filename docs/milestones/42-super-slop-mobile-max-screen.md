# Milestone 42: Super Slop Mobile Max Screen

## Status

Implementation and automated acceptance complete; final phone feel awaits user playtest.

## Objective

Make Super Slop Brothers comfortable to set up and play on a phone, with an explicit max-screen mode that keeps the complete combat control set visible, reachable, and clear of the important playfield while preserving the existing Canvas2D gameplay and desktop layout.

## Scope

- Move the touch control surface into the maximized play-surface subtree so native fullscreen and the CSS fallback retain it.
- Format the embedded phone page, setup overlay, HUD, max/menu buttons, and combat controls for portrait and landscape mobile viewports.
- Use compact edge control clusters in max-screen, including safe-area padding and readable 44 px-or-larger tap targets.
- Preserve all nine existing touch actions and verify that touch input still drives the authoritative fighter controls.

## Out of scope

- Fighter balance, move timing, hitboxes, stages, hazards, CPU behavior, networking, audio, or character assets.
- Desktop control remapping or a new setup/menu flow.
- Locking device orientation or replacing the Canvas2D renderer.

## Dependencies

- **Depends on:** Milestone 41 character animation and responsive QA hooks.
- **Blocks:** none.

## Acceptance criteria

- [x] At 390×844, the embedded page has no horizontal overflow, the setup UI remains readable, and the max-screen button is visible and at least 44×44 CSS pixels — test: `scripts/test-super-slop-mobile-maximize.mjs::embedded mobile layout`
- [x] Entering max-screen keeps the canvas, menu/max buttons, and all nine touch controls inside the same fullscreen subtree and within the visible safe-area bounds — test: `scripts/test-super-slop-mobile-maximize.mjs::max-screen controls`
- [x] Max-screen touch targets are at least 44×44 CSS pixels, do not overlap one another, and leave the center of the arena unobstructed — test: `scripts/test-super-slop-mobile-maximize.mjs::touch target geometry`
- [x] Holding a directional touch control moves the player and tapping an action control triggers the existing authoritative input path without console or page errors — test: `scripts/test-super-slop-mobile-maximize.mjs::touch gameplay input`
- [x] The player can exit max-screen from the visible max button and return to the formatted embedded page without losing the controls or changing match state — test: `scripts/test-super-slop-mobile-maximize.mjs::exit max-screen`
- [ ] Portrait embedded, portrait max-screen, and landscape max-screen visual captures have clear hierarchy and comfortable control placement — verified by user playtest.

## Exit condition

User opens Super Slop Brothers on a phone, taps Max, plays with every movement and combat control still visible, then exits Max and observes a clean embedded mobile page.

## Test plan

- Add the focused Playwright regression first and confirm it fails because the current touch controls live outside `.canvas-wrap` and disappear from the fullscreen subtree.
- Run `PATH=/opt/homebrew/bin:$PATH node scripts/test-super-slop-mobile-maximize.mjs` for the 390×844 portrait and 844×390 landscape checks.
- Run `PATH=/opt/homebrew/bin:$PATH node scripts/test-super-slop-character-animations.mjs` as the adjacent character/runtime regression.
- Run `PATH=/opt/homebrew/bin:$PATH node --check assets/js/super-slop-brothers.js` and `git diff --check`.

## Notes

- Max-screen remains user initiated; the normal page continues to open inside the shared Rainbot shell with nav, leaderboard, and comments available below the game.
- Touch UI is a visual/input overlay only. Canvas physics, match state, and animation authority remain unchanged.
- The touch dock stays below the canvas in the embedded fight view. On max entry it is temporarily reparented into `.canvas-wrap` before the native fullscreen request, then restored to `.game-stage` on exit; this covers both native fullscreen and the CSS fallback without changing shared site code.
- Touch controls appear only during a fight. The setup/results overlay receives a taller mobile surface, the four-item page HUD is one compact row, the keyboard-only hint is hidden on phone layouts, and setup/match controls meet mobile tap-target floors.
- Automated verification passed at 390×844 portrait and 844×390 landscape with real movement/attack input, native-fullscreen subtree coverage, a rejected-native-request fallback, no horizontal overflow, and zero console/page errors.
- Visual proof: `output/playwright/super-slop-mobile-maximize/after-portrait-embedded.png`, `after-portrait-max.png`, and `after-landscape-max.png`.
