# Milestone 56: Basement Flashlight and Security Risk

## Status

In progress with implementation and focused automated acceptance complete. Pickup discoverability, beam balance, and tension await user playtest; three unrelated adjacent-suite blockers remain documented below.

## Objective

Make the flashlight easy to discover without granting it by default: three identical loose pickups are staged under the kitchen sink, inside a second-floor walk-in closet, and on the Archive shelf beside the skull. Collecting any one uses the ordinary E/touch interaction, removes every remaining world copy, and grants the single carried flashlight. F toggles it on desktop, and every visible use trades safety for orientation by exposing the player to the camera network, drawing Mr. Feast into a bounded investigation, and reducing crouched concealment.

## Scope

- Three authored loose flashlight pickups registered through the existing interaction system: under the kitchen sink, inside the east-front second-floor walk-in closet, and on the Archive shelf next to the skull curio.
- A simple recognizable household flashlight model with no ornate wall cradle; all three world copies disappear after any one is collected.
- One carried `basement-flashlight` item in the Bag, persisted with the existing Contestant 13 inventory while active light and alert state remain transient across load.
- A focused flashlight system with a camera-aligned, shadow-free spotlight, no visible carried model after pickup, restrained flicker, and named brightness, distance, cone, penumbra, and concealment tuning.
- Desktop F input plus a touch `Light` control, both hidden or inert until the item is collected and blocked by the existing modal, competition, hiding, seated, and game-over states.
- One recoverable camera-security event when a camera first sees the active beam, whether it was visible at the off-to-on activation or becomes visible later while still on. A per-camera observation latch prevents repeated alerts from one continuous sighting; the event records the source and player position, flashes that camera's warning treatment, and sends Mr. Feast through the existing responding, searching, returning, and patrol lifecycle without directly starting pursuit or permanent lockdown.
- An explicit while-on concealment cost that raises effective visibility and Mr. Feast's sight range and lowers the crouched stealth meter, without changing the authored standing baseline or treating the carried light as an ambient room fixture.
- Focused diagnostics and QA controls through `render_game_to_text()` and `window.MrFeastFresh`.

## Out of scope

- Batteries, charge pickups, beam upgrades, weapon use, stuns, damage, or combat.
- A new continuous hearing or free-roaming perception system for Mr. Feast.
- Automatic pursuit merely for pressing F. Ordinary hostile camera recording or direct basement sight can still escalate through the existing trespass rules.
- Dynamic flashlight shadows, volumetric fog, bloom/post-processing, or changes to the mansion's fixed shader-light topology.
- Moving the clue trail, basement door, Archive evidence, Workroom code, or patron-feed sabotage progression.

## Dependencies

- **Depends on:** Milestone 31 inventory/save flow, Milestone 35 input and mobile controls, Milestone 36 camera response, Milestone 46 basement trespass, Milestone 51 stealth meter
- **Blocks:** none

## Acceptance criteria

- [x] A fresh run has no owned or equipped flashlight and F/Light does nothing. Three simple loose flashlight props are present under the kitchen sink, inside the east-front second-floor walk-in closet, and on the Archive shelf beside the skull. Each exposes a forgiving `Take flashlight` E/touch interaction once its containing cabinet is open. — test: `scripts/test-mr-feast-flashlight.mjs::three-location pickup discovery`
- [x] Taking any one grants exactly one Bag item, removes all three world interactions/props, explains F/Light and the camera risk, and persists possession through an explicit save/load while restoring safely switched off. — test: `scripts/test-mr-feast-flashlight.mjs::any-location inventory and save`
- [x] F and the touch `Light` button toggle one authoritative active state only after collection. Input is non-repeating and yields to menus, dossier/readers, timed actions, hiding, seating, competitions, the welcome, and game over. — test: `scripts/test-mr-feast-flashlight.mjs::input gating`
- [x] The active camera-aligned beam uses the tuned `74` intensity, materially brightens a central Archive patch over the off state, falls away much faster at the edge, retains a dark periphery, stays below the overexposure ceiling, casts no shadow, shows no carried flashlight model, and changes light energy rather than shader-light counts. — test: `scripts/test-mr-feast-flashlight.mjs::restrained beam`
- [x] In the same dark motionless crouch, switching the light on clearly lowers the concealment meter and raises effective visibility and sight range; switching it off recovers the original baseline. Standing remains exactly visibility `1`. — test: `scripts/test-mr-feast-flashlight.mjs::stealth cost`
- [x] A camera that sees the active beam creates exactly one `flashlight-use` security event for that continuous observation, including when the player switched it on earlier behind an occluder and emerges without toggling again. The event records its camera and position, triggers a readable warning pulse, and moves Mr. Feast into the existing bounded response without starting pursuit, permanent lockdown, or frame-by-frame alert spam. — test: `scripts/test-mr-feast-flashlight.mjs::continuous camera and host alert`
- [x] Camera-free or occluded basement use does not invent a remote camera source, but the active visibility penalty still makes ordinary later camera/host detection easier. — test: `scripts/test-mr-feast-flashlight.mjs::fair alert boundary`
- [x] Diagnostics expose collection, world visibility, active state, beam tuning, shader-light topology, concealment cost, activation/alert counts, and last alert camera. Focused QA can stage, collect, toggle, and frame the pickup without bypassing the same authoritative paths. — test: `scripts/test-mr-feast-flashlight.mjs::diagnostics`
- [ ] Existing renovation, player-systems, camera-security, caught-pursuit, basement-key, and Contestant 13 suites remain green with zero unexpected browser errors. — tests: existing mansion suites
- [ ] User playtest confirms the pickup is easy to notice, the beam is useful without making the basement comfortable, and the camera/Mr. Feast/stealth consequence feels tense and fair.

## Exit condition

The user can find a recognizable loose flashlight under the kitchen sink, in the east-front upstairs walk-in closet, or on the Archive shelf beside the skull. Taking any one removes the other two and grants one switched-off Bag item; F (or Light on touch) then reveals a constrained path while preserving the existing stealth and security risk.

## Test plan

Write and run `scripts/test-mr-feast-flashlight.mjs` and the new renovation contract pins red before implementation. Then run them green, followed by runtime syntax, both required mansion suites (`test-mr-feast-renovation.mjs` and `test-mr-feast-contestant-13.mjs`), the adjacent player/stealth/camera/pursuit/basement-key suites, `git diff --check`, and real desktop plus 390x844 browser visual QA with `render_game_to_text()` and console inspection.

## Verification

- Red-first: `node scripts/test-mr-feast-flashlight.mjs` failed on the missing named `FLASHLIGHT` table, while renovation section 56 failed all eight new pickup/input/beam/stealth/security/persistence/diagnostic pins before implementation. The review follow-up then failed two additional pins for the pre-collection touch control and inactive raycast cost before those fixes landed.
- Light-only/brighter follow-up red-first: the focused suite failed on the old `68` intensity and renovation failed its new light-only presentation invariant while the carried body/head/lens geometry still existed. Both pass after removing that geometry and tuning the named beam intensity to `74`.
- Final syntax and static gates pass: `node --check assets/js/mr-feast-mansion.js`, all changed test-script syntax checks, `node scripts/test-mr-feast-renovation.mjs`, and `git diff --check`.
- `node scripts/test-mr-feast-flashlight.mjs` passes the real landing pickup, fresh-run F/touch gating, one-item Bag integration, F/menu/repeat behavior, fixed `{ spot: 6, point: 11 }` topology, save/load-safe ownership, and 390×844 touch layout with zero browser errors. Its corrected occlusion case explicitly waits out the activation cooldown before proving no invented camera source.
- Focused visual/stealth measurements after the light-only/brighter follow-up: the Archive center cone gains `7.1` luminance while the sampled edge remains effectively `0.0`; a dark motionless crouch falls from `96.0` concealment off to `71.5` on while standing remains visibility `1`. Proof is in `output/playwright/mr-feast-flashlight/flashlight-{pickup,beam-off,beam-on}-desktop.png` and `flashlight-touch-mobile.png`.
- The full `test-mr-feast-contestant-13.mjs`, `test-mr-feast-stealth-meter.mjs`, and `test-mr-feast-camera-security.mjs` browser suites pass after replacing Playwright's unstable animated-element screenshot action with the repository's existing bounding-box plus clipped-page capture pattern. The camera proof retains a clearly visible green fixture core with a 20-pixel floor.
- 2026-07-23 three-location follow-up: the revised focused source contract failed red on the old upstairs-bathroom location before implementation. It now exercises real E pickup on fresh runs under the opened kitchen sink cabinet, inside the opened east-front upstairs walk-in closet, and beside the basement Archive route. Every path grants exactly one switched-off Bag item and removes/unregisters all three world copies. The loose four-part household model replaces the ornate wall cradle. Runtime/test syntax, renovation, the complete focused flashlight browser suite, full desktop/mobile Contestant 13, cache identity `20260723-three-flashlights-1`, and `git diff --check` pass with zero unexpected browser errors. Visual proof is `flashlight-pickup-{kitchen-under-sink,upper-east-front-closet}-desktop.png` plus the refreshed basement `flashlight-pickup-desktop.png` under `output/playwright/mr-feast-flashlight/`.
- 2026-07-24 continuous-observation fix: the focused browser regression failed red after the light was switched on behind a QA occluder, then the occluder cleared while the Archive camera reported `playerInCone: true` and `hasLineOfSight: true`; the flashlight alert count incorrectly remained zero and Mr. Feast stayed on patrol. The camera evaluation loop now hands its authoritative visible camera to `FlashlightSystem`, which raises one latched `flashlight-use` event even when the beam was activated earlier. The same-camera latch preserves the no-spam contract while a sighting remains continuous. Runtime/test syntax, renovation, the complete desktop/mobile flashlight suite, camera security, stealth meter, and `git diff --check` pass with clean focused console capture. Full Contestant 13 remains blocked before the flashlight path by its existing duplicate Library clue-book interactions: two fresh runs opened the reader without setting `bookRead`. Focused browser proof is `output/playwright/mr-feast-flashlight/flashlight-continuous-camera-alert-desktop.png`.
- Three adjacent suites remain open outside the flashlight path: Player Systems advances past its repaired screenshots and then hangs on its documented headless Max/fullscreen click; Caught/Pursuit completes the chase response lifecycle but its later unrelated housekeeping pass reports `fixesCompleted: 0`; Basement Key Trail clears the repaired screenshots, locked-door prompt, and Feast Says boundary, then misses the existing six-second `digSiteExcavated` transition. No browser/server process leaked from any run.

## Notes

The flashlight alert is intentionally recoverable. It reuses the camera investigation state machine but does not call the permanent `raiseAlarm()` lockdown path or `beginPursuit()` directly. Existing camera recording and witnessed basement-trespass systems remain authoritative for escalation.
