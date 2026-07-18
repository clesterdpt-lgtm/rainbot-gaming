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
- A catch that resolves as a warning silently resolves the exact tampered object as part of the catch itself, and neither a warning nor a give-up sweep can be preempted by that same object's own overdue housekeeping notice; an escaped (given-up) tamper still receives a normal, undisturbed housekeeping visit afterward.
- New speech pools cover witnessed starts, recorded starts, warnings, abandoned pursuits, and basement catches, all using the existing distance-readable bubble.
- Pursuit, infraction, and game-over state are exposed through `window.render_game_to_text()` and focused `window.MrFeastFresh` QA controls, with a deterministic pursuit runner for tests.

## Verification

- `node --check assets/js/mr-feast-mansion.js` — passed
- `node --check scripts/test-mr-feast-caught-pursuit.mjs` — passed
- `node scripts/test-mr-feast-caught-pursuit.mjs` — passed speed cap under walk speed, real E-key witnessed trigger, unwitnessed and straighten non-triggers, recorded trigger from live camera tracking, run-animation pursuit with zero teleports, main-floor warning catch with a clean uninterrupted state trace and the caught object silently resolved with no later re-dispatch, hidden-player give-up with an equally uninterrupted sweep followed by a normal separate later fix, basement catch game over with working load recovery, frozen simulation under the overlay, desktop/mobile layout, and zero console errors
- `node scripts/test-mr-feast-tamper-distractions.mjs` — passed adjacent tamper/housekeeping behavior
- `node scripts/test-mr-feast-camera-security.mjs` — passed unchanged alarm behavior
- `node scripts/test-mr-feast-contestant-13.mjs` — passed full story progression
- `node scripts/test-mr-feast-player-systems.mjs` — passed adjacent input/menu/save behavior
- `node scripts/test-mr-feast-renovation.mjs` — passed
- `node scripts/test-mr-feast-contestant-conversations.mjs`, `node scripts/test-mr-feast-basement-key-trail.mjs`, `node scripts/test-mr-feast-workroom-security-hub.mjs` — passed adjacent concurrent-milestone and story-trail behavior
- Browser proofs under `output/playwright/mr-feast-caught-pursuit/`

## Post-launch fix — housekeeping race overwriting the catch

User report: after being caught tampering, no chase or game over was perceptible, and a portrait/chair catch showed no warning — Mr. Feast simply walked over, fixed the object, and left, exactly like an ordinary Milestone 45 housekeeping visit.

Root cause: `canAcceptHousekeeping()` explicitly allowed a new housekeeping dispatch while Mr. Feast was in the `SEARCHING`/`RETURNING` states — which is also precisely the state he occupies for the few seconds immediately after a pursuit resolves (delivering the warning, or sweeping before giving up). The tampered object's own `4.2s` notice timer keeps counting the entire time pursuit is active, so it is almost always already overdue the instant the chase resolves. The result: a housekeeping errand for that same object hijacked him within about a second, cutting the warning bubble short and replacing it with an ordinary "noticed"/"fixed" line — the pursuit and warning still fired internally, but were invisible to the player.

Fix: a new `pursuit.cooldownActive` flag blocks `canAcceptHousekeeping()` for the duration of the post-pursuit `SEARCHING`/`RETURNING` sequence, clearing only once he fully rejoins `PATROL`. A caught object also now resolves silently as part of the catch itself (via a precise tamper-entry ID threaded through `beginPursuit`/`resolveCatch`, not a same-kind proximity guess), so there is no later, redundant fix visit for it at all. An escaped (given-up) tamper is intentionally left tampered and still receives a normal, separate housekeeping visit once he settles back into patrol — undisturbed mid-sweep, as verified by an exact expected state-trace assertion in the regression suite.

- `node --check assets/js/mr-feast-mansion.js` — passed
- `node scripts/test-mr-feast-caught-pursuit.mjs` — extended with and passed: an uninterrupted `["patrol","responding","searching","returning","patrol"]` trace for both the warning-catch and the give-up paths, the caught object resolving to `tampered:false` with zero later re-dispatch over 20 simulated seconds, and an escaped object correctly remaining tampered until a genuinely separate, undisturbed housekeeping errand fixes it
- `node scripts/test-mr-feast-tamper-distractions.mjs`, `node scripts/test-mr-feast-camera-security.mjs`, `node scripts/test-mr-feast-contestant-13.mjs`, `node scripts/test-mr-feast-player-systems.mjs`, `node scripts/test-mr-feast-renovation.mjs`, `node scripts/test-mr-feast-contestant-conversations.mjs`, `node scripts/test-mr-feast-basement-key-trail.mjs`, `node scripts/test-mr-feast-workroom-security-hub.mjs` — all re-passed against the fixed runtime

## Post-launch fix 2 — basement trespass and chase pathing

User report after the first fix: pursuit fires for witnessed/recorded tampering, but being caught in person or on camera **in the basement** still produced no chase or game over, and pursuit pathing looked wrong — he followed fixed roundabout routes and never took the quickest way to the player.

Root causes, in order of impact:

1. **No basement trigger existed.** Every tamperable object (19 portraits, 16 chairs, the refrigerator) lives on the main or second floor, so no infraction could ever originate in the basement; the original request's intent — presence in the basement is itself the offense — was never implemented.
2. **3D-distance node targeting.** Pursuit picked the response-graph node nearest the player by raw 3D distance, so for a player in the basement, a main-floor node directly overhead (`Δy 3.8m`) beat a same-floor node one room away. He walked to the room above the player, the same-floor catch check could never pass, and each repath chose the same wrong node until the give-up timer expired.
3. **Loop-only pathing.** The response graph's edges were the authored patrol loop, so Dijkstra frequently sent him the long way around the house, and mid-path he never retargeted a moving player — he finished walking to where they used to be.

Fixes:

- A `trespass` watch runs in Mr. Feast's own update: while the player's feet are below the basement threshold and not hidden, being personally seen (existing sight cone + occlusion ray) or hostile-recorded (the `Being recorded` pill while not permitted) for a short `0.55s` dwell starts a pursuit of kind `trespass` with a dedicated line pool ("The basement is not on the tour."). All existing pursuit rules apply, so a basement catch is game over via the existing location rule and an escape upstairs downgrades to a warning.
- Pursuit (and errand) node targeting is same-floor-biased, eliminating the stuck-overhead failure.
- The pursuit graph lazily densifies with straight-line shortcut edges between same-floor nodes whose connecting segment crosses no wall/hedge occluder box and passes no hinged-door leaf within `1.0m`, so every door crossing still happens on an authored edge that opens its door. Pursuit, housekeeping errands, and post-pursuit/errand returns use shortcuts; the bounded camera-alarm investigation keeps its fully authored route.
- Mid-path retargeting: when the player has moved more than `1.2m` and their nearest node changed, the current leg is abandoned for a fresh path on the `0.9s` repath cadence.
- The give-up clock measures a lost trail rather than elapsed effort: personally seeing or hostile-recording the runner refreshes it, frames where he is actively closing the route hold it steady, and it drains only while he is stalled, blocked, or idling with no idea where the player went. A cross-floor flee therefore ends in a basement capture instead of expiring mid-stairwell, while hiding still wins.
- Because concurrent Milestone 48 gave Mr. Feast fixed-furniture character collision, a chase leg can now physically stall (a desk across the straight line, a pulled chair in a doorway). A `0.7s` stall watchdog suppresses the direct approach, temporarily blacklists the stalled graph edge for `20s`, and forces a genuine reroute — such as entering the Archive by its other end — instead of running in place.
- The floor bias classifies positions and nodes by nearest floor plane rather than raw height, so a wall-hung portrait at `y≈2.15` targets main-floor nodes instead of stair landings.
- The patrol-resume anchor is now the node nearest his actual position when the pursuit begins, so the post-warning return walk is short and honest.
- New QA: `resumeMrFeastForQA`, pursuit diagnostics exposing `targetNodeId`, `trespassDwell`, and `pathShortcuts`, and a game-over break in the housekeeping runner.

- `node scripts/test-mr-feast-caught-pursuit.mjs` — extended with and passed: an in-person basement trespass starting a no-tamper pursuit with the trespass line pool and ending in game over, a hostile basement-camera lock starting a recorded trespass pursuit, a mid-pursuit flee into the (dev-unlocked) basement crossing the service stair and ending in capture down there with zero teleports, a `< 45s` bound on the same-room warning catch, and `> 30` wall-checked shortcut edges in diagnostics
- Adjacent sweep at the same checkout: tamper-distractions, camera-security, contestant-13, contestant-conversations, and renovation all passed; player-systems (true-fullscreen Maximize) and basement-key-trail (printed/handwritten reader layers) were failing on concurrent sessions' in-flight Milestone 48/34 edits unrelated to pursuit
