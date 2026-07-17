# Milestone 46 — Caught in the Act

## Goal

Give infractions real consequences: when Mr. Feast personally sees the player tampering, or the player tampers while the camera HUD reads `Being recorded`, he breaks into a run toward the player. His pursuit is always escapable at walking pace. Catching the player on the main or second floor earns a spoken warning; catching them anywhere in the basement is game over.

## Acceptance criteria

- Tilting a portrait or pulling a chair (deliberate mischief; ordinary fridge opening is exempt) reports an infraction. It triggers a pursuit only when witnessed: either Mr. Feast has the player within his sight range, forward cone, and an unoccluded line of sight, or the camera system is actively recording the player exactly as the existing `Being recorded` HUD pill defines it.
- Pursuit speed is hard-capped below the player's walk speed (`1.95` vs `2.2` m/s) so walking away always works while crouching does not; he uses the run animation while pursuing and never teleports.
- Pursuit follows the authored response graph with periodic re-pathing toward the player, a short direct approach inside the same room, a bounded give-up timer that ends with a frustrated line and the normal search-and-return flow, and no catches while the player is inside a hiding spot.
- Catching the player (within reach, same floor, not hidden) on the main or second floor delivers a bubble warning from a dedicated pool while he faces the player, then he returns to patrol; warnings and catches are counted in diagnostics.
- Catching the player anywhere in the basement triggers game over: a modal `CAUGHT` overlay with a themed line, working `Load last save` and `Start over` controls, frozen simulation and input underneath, and pointer lock released.
- Loading a save from the game-over screen clears the fail state, restores the player, and recovers Mr. Feast to normal patrol without teleporting mid-scene state into view.
- Pursuit outranks housekeeping errands and camera-alarm investigations; new camera alarms cannot stomp an active pursuit, and the interrupted tamper re-queues for later fixing.
- New speech pools cover witnessed starts, recorded starts, warnings, abandoned pursuits, and basement catches, all using the existing distance-readable bubble.
- Pursuit, infraction, and game-over state are exposed through `window.render_game_to_text()` and focused `window.MrFeastFresh` QA controls, with a deterministic pursuit runner for tests.

## Verification

- `node --check assets/js/mr-feast-mansion.js` — passed
- `node --check scripts/test-mr-feast-caught-pursuit.mjs` — passed
- `node scripts/test-mr-feast-caught-pursuit.mjs` — passed speed cap under walk speed, real E-key witnessed trigger, unwitnessed and straighten non-triggers, recorded trigger from live camera tracking, run-animation pursuit with zero teleports, main-floor warning catch, hidden-player and give-up escapes, basement catch game over with working load recovery, frozen simulation under the overlay, desktop/mobile layout, and zero console errors
- `node scripts/test-mr-feast-tamper-distractions.mjs` — passed adjacent tamper/housekeeping behavior
- `node scripts/test-mr-feast-camera-security.mjs` — passed unchanged alarm behavior
- `node scripts/test-mr-feast-contestant-13.mjs` — passed full story progression
- `node scripts/test-mr-feast-player-systems.mjs` — passed adjacent input/menu/save behavior
- `node scripts/test-mr-feast-renovation.mjs` — passed
- Browser proofs under `output/playwright/mr-feast-caught-pursuit/`
