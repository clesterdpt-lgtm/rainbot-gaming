# Milestone 57: Mr. Feast Pursuit Evasion, Pathing, and Footsteps

## Status

Implementation and automated acceptance complete; user playtest pending.

## Objective

Make Mr. Feast's chase readable, fair, and physically convincing. His footsteps must land on the grounded contacts of the shipped stalk/run animation, a player who breaks both personal sight and hostile camera tracking must stop broadcasting their live position, entering a hiding spot must end the chase after a short search window, and a clearly visible same-floor player must be approached along a straight collision-aware line before the authored route graph is used as fallback.

## Scope

- Animation-phase footstep events for Mr. Feast's stalk and run clips, reusing the licensed local wood, stone, and grass sample bank with distance/pan filtering through the existing mansion master mix.
- Pursuit memory that records only the last position personally seen or supplied by hostile camera tracking.
- A named unseen give-up window plus a shorter hidden-player give-up window; progress toward an old position no longer pauses either countdown.
- Direct same-floor steering while Mr. Feast genuinely has unoccluded personal sight, with the existing collision stall watchdog and door-aware shortcut graph retained as fallback.
- Focused diagnostics and deterministic QA for contact phases, tracking source, last-known position, unseen time, direct-steering frames, and short pursuit stepping.

## Out of scope

- New voice acting, music, hearing/noise investigation, smell/footprint tracking, combat, or an always-on free-roaming chase system.
- Teleporting, phasing through furniture/walls, increasing pursuit speed above the player's walk speed, or bypassing locked doors.
- New downloaded sound assets; the existing local, provenance-recorded surface step bank is sufficient for this pass.
- A full navigation-mesh replacement for the authored response graph.

## Dependencies

- **Depends on:** Milestone 39 grounded gait, Milestone 44 mansion SFX, Milestone 46 caught-in-the-act pursuit, Milestone 51 crouch stealth
- **Blocks:** none

## Acceptance criteria

- [x] Moving stalk/run animation emits alternating Mr. Feast footsteps only when the tuned grounded contact phases are crossed; idle, paused, muted, or non-moving animation does not emit them. — test: `scripts/test-mr-feast-pursuit-evasion.mjs::animation-synced footsteps`
- [x] Mr. Feast footsteps choose wood, stone, or grass from his own position/route, become quieter and darker with distance, use the existing master mute, and expose recent phase/foot/surface events in diagnostics. — test: `scripts/test-mr-feast-pursuit-evasion.mjs::spatial surface mix`
- [x] Pursuit records a last-known position only from personal line of sight or hostile camera recording; after both are broken, teleporting or moving elsewhere cannot retarget him to the live player. — test: `scripts/test-mr-feast-pursuit-evasion.mjs::last-known pursuit memory`
- [x] With no personal sight or hostile camera tracking, the unseen countdown drains even while Mr. Feast is still moving toward the last-known point, then transitions to the existing frustrated search/return flow. — test: `scripts/test-mr-feast-pursuit-evasion.mjs::bounded unseen loss`
- [x] Entering a hiding spot during pursuit cannot cause a catch or retarget, and ends active pursuit within the named hidden-player window without requiring a QA-only timer override. — test: `scripts/test-mr-feast-pursuit-evasion.mjs::hide escape`
- [x] A visible same-floor player in a clear lane produces sustained direct steering with low lateral deviation; losing that clear line or stalling returns control to the existing wall/door-checked path graph. — test: `scripts/test-mr-feast-pursuit-evasion.mjs::direct chase steering`
- [x] A visible, non-hidden player within close conversational distance in the basement is personally noticed through a clear line even when beside or behind Mr. Feast; walls, floor separation, and hiding still block this proximity awareness. — test: `scripts/test-mr-feast-pursuit-evasion.mjs::close basement awareness`
- [x] A hostile basement camera detection sends Mr. Feast from the main floor down the unlocked service stair without periodic pursuit repathing pulling him back toward the upper landing. — test: `scripts/test-mr-feast-pursuit-evasion.mjs::cross-floor basement chase`
- [x] From a valid distant main-floor patrol node, a stable hostile basement-camera target carries Mr. Feast into the basement without periodic replanning reversing him between duplicate directional nodes around the grand stair, Kitchen, or service-stair landings. — test: `scripts/test-mr-feast-pursuit-evasion.mjs::distant cross-floor basement chase`
- [x] Pursuit remains below walking speed, never teleports, preserves basement capture and main-floor warning outcomes, and does not regress camera, hiding, or housekeeping ownership. — tests: `scripts/test-mr-feast-caught-pursuit.mjs`, `scripts/test-mr-feast-camera-security.mjs`, `scripts/test-mr-feast-renovation.mjs`
- [ ] User playtest confirms footsteps feel planted and readable, hiding feels tense but dependable, and visible chases no longer take visibly roundabout routes. — verified by user playtest

## Exit condition

User triggers a visible chase, hears Mr. Feast's steps land with his running feet as he closes directly through a clear lane, breaks sight and camera coverage, enters a hiding place, and observes him go to the last-seen area and abandon the pursuit instead of following the hidden player's live position.

## Test plan

Add `scripts/test-mr-feast-pursuit-evasion.mjs` and new Milestone 57 renovation pins before implementation, confirm both fail on the missing footstep/tracking/direct-steering contracts, then turn them green. Run syntax, the focused pursuit/audio/gait suites, camera security, both required mansion suites, `git diff --check`, and a real-browser `render_game_to_text()` plus screenshot/audio-diagnostic playthrough.

## Notes

Initial reproduction on the current runtime: pursuit began at `main-music-northeast`, the player entered the coat-closet hiding spot, and after only `1.2s` Mr. Feast had retargeted to `main-library-west`—the hidden player's live location—while retaining `25.7s` of a `26s` give-up timer because route progress paused loss. The shipped animation was sampled at 120 phases: stalk contacts resolve near right `0.025` / left `0.542`, and run contacts near left `0.333` / right `0.817`.

Final hardware-Chrome proof emits four alternating wood stalk steps and five run steps at those exact contact phases, holds a clear Ballroom pursuit to 102 direct-steering frames with zero teleports and no meaningful lateral drift, preserves the Music Room last-known point after an unseen move to the coat closet, and ends a real hidden pursuit as `lost` inside the `3.4s` hidden window. Syntax, renovation, caught-pursuit, camera-security, grounded-gait, audio-upgrade, and full Contestant 13 suites all pass; screenshots are under `output/playwright/mr-feast-pursuit-evasion/`.

The follow-up basement repro placed the player `1.9m` directly behind Mr. Feast with no camera or occluder: the pre-fix pursuit remained inactive with zero trespass dwell. The fixed deterministic run starts a trespass pursuit through the named `2.35m` proximity rule and reports `trackingSource: "proximity"`; matching hidden, wall-separated, and other-floor probes remain inactive. The focused, caught-pursuit, camera-security, stealth-meter, audio-upgrade, renovation, and full desktop/mobile Contestant 13 suites pass. Visual proof is `output/playwright/mr-feast-pursuit-evasion/close-basement-awareness.png`.

The cross-floor follow-up reproduced a hostile boiler-camera trespass from Mr. Feast's Kitchen route with the physical basement door unlocked. Pursuit began correctly with a 15-node service-stair route, but the `0.9s` refresh repeatedly selected the upper landing as the nearest floor-biased start node; after 20 simulated seconds he still oscillated around the stair top. Pursuit now retains its authored vertical leg while he is entering or traversing stairs/ramps, then resumes ordinary last-known replanning from the destination floor. The red-first browser regression proves the same camera event carries him below `y=-3.7` within 10 seconds without changing the sight, camera, hiding, or unseen-loss rules. Visual proof is `output/playwright/mr-feast-pursuit-evasion/basement-cross-floor-chase.png`.

The player follow-up exposed that the first fix and its Kitchen-start proof were too narrow. From a valid Library patrol node, the pre-fix host traveled `40.8m` in 30 seconds but repeatedly reversed between the paired grand-stair nodes and never left the main floor; equivalent Music Room and Dining Room probes stalled or oscillated before the service stair. Periodic refresh now retains the complete existing route whenever the reliable clue still maps to its current target node, while target-node changes and the stall watchdog retain explicit replanning authority. The red-first Library regression reaches basement height at 27 seconds and continues into the Pantry by 30; independent Music Room, Dining Room, and Kitchen probes reach it at 24, 20, and 9 seconds and continue moving below grade.
