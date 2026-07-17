# Milestone 36: Camera Surveillance and Alarm Investigation

## Status

in-progress — automated acceptance complete; user tension/readability playtest pending

## Objective

Turn the mansion's implied show-camera network into a fair stealth system. Working surveillance cameras scan most major interior spaces and outdoor chokepoints, distinguish permitted filming from restricted behavior, and raise an alarm that diverts Mr. Feast to the nearest authored response point for the player's last-seen position and a limited search. This milestone consumes Milestone 35's crouch/hiding contracts without expanding into full chase, capture, or failure behavior.

## Scope

- Add a data-driven network of visibly powered surveillance cameras across major rooms, halls, basement approaches, and exterior chokepoints while preserving bathrooms, closets/hiding spaces, the Workroom interior, and the deepest maze routes as intentional blind spots.
- Animate unsynchronized left/right camera sweeps with readable endpoint pauses and status LEDs, without adding render-to-texture feeds, real-time spotlights, shadows, or per-camera physics bodies.
- Detect the player through range, field-of-view, exposure time, and line-of-sight checks that respect walls, closed doors, hedges, and substantial cover.
- Use the existing crouch visibility multiplier to slow exposure and make an active hiding spot fully camera-safe.
- Drive camera policy through one explicit `show` → `restricted` → `lockdown` state: normal filming is allowed in show spaces, observed sabotage always alarms, basement sightings become trespass after the basement is unlocked, and any alarm or patron-feed sabotage starts global lockdown.
- Keep the visible brass-tagged public surveillance network active after the separate private patron feed is severed.
- Give the player fair acquisition feedback through camera LEDs, a transient text-first HUD notice, and restrained audio cues without persistently advertising camera policy or suspicion values.
- Divert Mr. Feast through explicit `patrol` → `responding` → `searching` → `returning` states to the nearest safe route point for the camera's last-seen position, then return him to his route if the player hides or escapes.
- Expose deterministic camera, policy, alarm, and Mr. Feast response diagnostics and QA controls.

## Out of scope

- Direct visual/hearing perception by Mr. Feast outside camera alarms.
- Continuous pursuit of the live player, capture, damage, a banquet failure scene, checkpoints, or restart/recovery flow.
- Additional sabotage targets, the Workshop keypad, or the final escape/exposure ending.
- Real security-monitor video feeds, render targets, or extra shadow-casting lights.

## Dependencies

- **Depends on:** Milestone 35 — Player Mobility, Inventory, and Test Menu
- **Blocks:** Full Mr. Feast perception, chase, capture, and recovery milestone

## State graph

### Camera policy

| From | Event | To | Result |
|---|---|---|---|
| `show` | Basement unlocked | `restricted` | Ordinary filming remains permitted outside restricted basement zones. |
| `show` / `restricted` | Tagged sabotage observed | `lockdown` | Alarm immediately records the observing camera and last-seen position. |
| `restricted` | Patron feed sabotaged | `lockdown` | Every remaining public camera treats player presence as hostile. |
| Any | Alarm raised | `lockdown` | Security never silently de-escalates during the current run. |

### Mr. Feast response

| From | Event | To | Result |
|---|---|---|---|
| `patrol` / `returning` | Camera alarm | `responding` | Follow authored route points toward the alarm zone without teleporting. |
| `responding` | Response point reached | `searching` | Inspect the last-seen area for a bounded interval. |
| `searching` | New camera alarm | `responding` | Redirect to the newest reliable sighting. |
| `searching` | Search expires | `returning` | Rejoin the nearest safe patrol waypoint. |
| `returning` | Patrol route rejoined | `patrol` | Resume the existing whole-home loop. |

## Acceptance criteria

- [x] Working cameras cover most eligible mansion zones and outdoor chokepoints, visibly scan left/right with unsynchronized timing, preserve intentional blind spots, and add no shader lights or shadow casters. — tests: `scripts/test-mr-feast-renovation.mjs::camera surveillance source invariants` and `scripts/test-mr-feast-camera-security.mjs::camera placement and scanning`
- [x] The Workroom interior is camera-free; cutting the separate patron feed still enters lockdown without generating an immediate public-camera sighting, while the Archive and cross-corridor cameras retain restricted-basement coverage. — tests: `scripts/test-mr-feast-renovation.mjs::camera-free Workroom` and `scripts/test-mr-feast-camera-security.mjs::camera placement and scanning`
- [x] Every indoor unit is mounted at the center of a wall rather than in a corner, one-way sweeps take at least ten seconds, and the local LED stays green while scanning, gives three red warning pulses over 2.4 seconds during any visible acquisition, then turns solid red and follows lateral room movement. Permitted filming tracks without suspicion; hostile tracking leaves a further two seconds before the alarm threshold. — test: `scripts/test-mr-feast-camera-security.mjs::wall-center slow sweep and warning tracking`
- [x] Indoor brackets meet their floor's ceiling underside, the Reading Room camera faces into the room, the redundant unit behind the grand-stair mid-landing is removed, and the pool camera is grounded on a dedicated support post. — test: `scripts/test-mr-feast-camera-security.mjs::camera placement and scanning`; visual proof: `output/iterate/2026-07-16-camera-reading-facing.png`, `output/iterate/2026-07-16-camera-stair-landing-removed.png`, and `output/iterate/2026-07-16-camera-pool-post-close.png`
- [x] A player can cross a camera lane while its head faces away, while sustained unobstructed exposure in its cone uses a fair grace period and detects the player. — test: `scripts/test-mr-feast-camera-security.mjs::facing-away traversal and facing-toward exposure`
- [x] Camera policy permits ordinary show-space filming while still providing visible acquisition/tracking feedback without suspicion, immediately alarms on tagged sabotage performed in view, treats the unlocked basement as restricted, and enters global lockdown after any alarm or patron-feed sabotage. Blind sabotage starts lockdown without summoning Mr. Feast until a later sighting. — test: `scripts/test-mr-feast-camera-security.mjs::show restricted and lockdown policy`
- [x] Walls, closed doors, hedges, and authored cover interrupt camera line of sight; reopening or clearing the blocker restores detection without allowing cameras to see through adjacent rooms. — test: `scripts/test-mr-feast-camera-security.mjs::line-of-sight occlusion`
- [x] Crouching consumes the existing `0.5` visibility multiplier to slow exposure, and an active hiding spot prevents camera detection entirely. — test: `scripts/test-mr-feast-camera-security.mjs::crouch and hiding stealth contract`
- [x] An alarm records the triggering camera, room, and last-seen position; latches one continuous sighting rather than spamming alarms; gives clear local/HUD feedback; and drives Mr. Feast through responding, searching, returning, and patrol without teleporting. — test: `scripts/test-mr-feast-camera-security.mjs::alarm investigation lifecycle`
- [x] Camera policy, sweep phase, exposure, occlusion, alarm history, and Mr. Feast response are available through `render_game_to_text()` and deterministic `window.MrFeastFresh` controls. — tests: `scripts/test-mr-feast-renovation.mjs::camera surveillance diagnostics` and `scripts/test-mr-feast-camera-security.mjs::deterministic camera QA controls`
- [x] Camera acquisition shows only a subtle `Spotted` notice during the three-pulse warning, changes to `Being recorded` once tracking locks, and disappears as soon as observation ends; no policy label, percentage, or suspicion track remains. The notice stays compact on desktop and the 390×844 touch layout with no new console errors. — test: `scripts/test-mr-feast-camera-security.mjs::transient camera status presentation`
- [x] The existing renovation, Contestant 13, basement-key, and player-system suites retain their prior results. — tests: `node scripts/test-mr-feast-renovation.mjs`, `node scripts/test-mr-feast-contestant-13.mjs`, `node scripts/test-mr-feast-basement-key-trail.mjs`, and `node scripts/test-mr-feast-player-systems.mjs`
- [ ] User confirms sweep timing, blind windows, warning feedback, and the bounded search feel tense but fair.

## Exit condition

User watches a camera sweep away, crosses its lane safely, crouches to reduce suspicion on a second pass, sabotages the Workshop relay from a blind window, then is spotted during lockdown → an alarm identifies the sighting and Mr. Feast comes to search that last-seen area before returning to patrol when the player hides or escapes.

## Test plan

1. Add static surveillance invariants plus a focused real-browser camera suite and confirm both fail against the visual-only patrol baseline.
2. Implement named camera tuning, placement data, policy/response transition tables, shared camera presentation, detection/occlusion, HUD feedback, and deterministic QA controls.
3. Drive allowed, restricted, sabotage, lockdown, crouch, hiding, occluded, alarm, search, and return states through real browser input and `render_game_to_text()`.
4. Capture desktop and mobile proof of camera presentation plus suspicion/alarm feedback, inspect the console, and verify no new shader-light or shadow topology.
5. Run syntax, focused camera, and all four existing mansion suites; report unrelated dirty-worktree failures separately.
6. User playtests whether sweep timing, warning feedback, blind windows, and Mr. Feast's search feel tense but fair.

## Notes

- The existing Archive recording distinguishes the brass-tagged public show cameras from the private patron feed. Severing the private feed therefore escalates the still-functioning public surveillance network instead of disabling these camera bodies.
- Alarm/search state is transient and is not added to explicit saves; a restored `relaySabotaged` story state still derives `lockdown` policy.
- The implementation must use the mansion's single-runtime architecture and shared low-poly meshes/materials. Camera detection is a focused system class inside that runtime, not a repo-wide modularization.
- Automated proof covers 32 cameras: 24 ceiling-height, wall-centered indoor units and eight outdoor chokepoints. The Workroom's two former units are removed while its monitor wall continues to page through the remaining public network. Real-browser QA includes the corrected Reading Room facing, removed grand-stair mid-landing unit, supported pool fixture, a 10.5–14.5 second one-way sweep, rendered green/red fixture-pixel checks, three-pulse permitted and hostile acquisition, solid-red follow behavior, a two-second hostile tracking grace, an actual keyboard-driven blind-side crossing, natural foyer LOS, a naturally blocked basement partition, continuous-alarm latching, full Mr. Feast response/return, unchanged light topology, and desktop/mobile captures under `output/playwright/mr-feast-camera-security/` plus the placement captures under `output/iterate/`.
- The July 16 feedback refinement removes the persistent mode/percentage/track card. `camera-status-desktop.png` and `camera-status-mobile.png` show the replacement status pill without changing the underlying exposure or alarm state machines.
