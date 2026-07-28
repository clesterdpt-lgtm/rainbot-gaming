# Milestone 68: Throwable Distractions

## Status

in-progress

## Objective

Let the player improvise short-lived stealth distractions from ordinary mansion clutter. Small authored props can be held with the existing E/touch interaction, carried visibly in one hand, and thrown with Q/the contextual mobile tool button. F remains exclusively assigned to the flashlight. The prop always remains world state: it never enters the Bag, clue inventory, or save payload.

## Scope

- Place a curated set of recognizable small props across the main floor, second floor, and basement.
- Require a short continuous E/touch hold to pick up one prop at a time; releasing early cancels cleanly.
- Show the carried prop in first person and use Q for throwing without changing F's flashlight ownership.
- Give every throw a Rapier-owned arc, collision, bounce, first-impact sound, and settled state that can be picked up again.
- Route a nearby idle/searching Mr. Feast to the first impact without interrupting a camera response or active pursuit.
- Have Mr. Feast return an investigated prop to its authored position; unattended settled clutter enters a delayed physical cleanup errand.
- During the Victory Feast escape, let a hidden player redirect the Saint toward an impact while an exposed player remains its target.
- Reset all transient carry, projectile, and sound-investigation state on load/restart and when a sanctioned competition takes ownership.

## Out of scope

- A throwable inventory, Bag entries, saved prop locations, stacking, breaking, damage, crafting, or ammunition counts.
- Throwing Contestant 13 evidence, competition items, the basement flashlight, furniture, or sabotage targets.
- Camera microphones or camera alarms caused by sound.
- New downloaded models, audio files, runtime dependencies, or a general-purpose physics refactor.

## Dependencies

- **Depends on:** Milestone 60 — House Distractions; Milestone 66 — Victory Feast Escape Prototype
- **Blocks:** later finale sabotage tuning

## Acceptance criteria

- [x] At least twelve authored props are distributed across all three mansion levels and expose a reachable `Hold E · pick up …` / touch interaction. — test: `scripts/test-mr-feast-throwable-distractions.mjs::distribution and real hold`
- [x] Releasing E/touch before the named pickup duration leaves the prop in place; completing the hold carries exactly one visibly in hand and removes its world prompt. — test: `scripts/test-mr-feast-throwable-distractions.mjs::cancel and carry`
- [x] A carried prop is absent from the Bag, clue inventory, and save payload; the runtime exposes it only through focused throwable diagnostics and the contextual hand/tool presentation. — test: `scripts/test-mr-feast-throwable-distractions.mjs::no inventory ownership`
- [x] Q throws a carried prop while F always retains its flashlight behavior, including while the player is carrying. On touch, the existing Light tool becomes Throw only while carrying. — test: `scripts/test-mr-feast-throwable-distractions.mjs::desktop and mobile tool ownership`
- [x] The thrown prop follows a Rapier-owned arc, collides with the mansion, emits exactly one spatial first-impact cue, visibly bounces/settles, and becomes pickable again. — test: `scripts/test-mr-feast-throwable-distractions.mjs::physics impact and reuse`
- [x] A nearby Mr. Feast who is free to respond physically investigates the impact, returns the displaced prop to its authored spot, and resumes patrol without teleporting. An unheard settled prop remains reusable until its delayed cleanup errand begins; then Mr. Feast physically collects and resets it. Pursuit, camera response, other active work, range, and floor boundaries retain priority. — test: `scripts/test-mr-feast-throwable-distractions.mjs::bounded response and delayed cleanup`
- [x] In the Victory Feast escape, an impact can redirect the Saint only while the player is hidden; an exposed player remains the live target. Cameras never hear or alarm on thrown sound. — test: `scripts/test-mr-feast-throwable-distractions.mjs::Saint and camera boundaries`
- [x] Live competitions block pickup/throw use and return carried or moving props to their authored positions. Load/reset clears all carry, projectile, pending sound, and threat-investigation state. — test: `scripts/test-mr-feast-throwable-distractions.mjs::competition and reset lifecycle`
- [x] Desktop and 390×844 touch layouts preserve usable movement, Interact, breath, and Bag controls with no new inventory panel. — test: `scripts/test-mr-feast-throwable-distractions.mjs::responsive controls`
- [ ] User playtest confirms the hold duration, throw force, impact loudness, and threat diversion window feel useful without becoming an automatic escape button. — verified by user playtest

## Exit condition

The player finds a small object, holds E/touch Interact to lift it, carries it visibly without adding anything to the Bag, presses Q/the contextual Throw control, and uses the impact to pull a nearby searching threat away long enough to change routes. Mr. Feast eventually returns the displaced object home, preventing permanent clutter.

## Test plan

Create `scripts/test-mr-feast-throwable-distractions.mjs` before implementation and confirm it fails on the missing tuning table and focused system. The green browser flow must use real E key holds, real Q throws, real F flashlight toggles while carrying, and the shipped touch controls; inspect `render_game_to_text()` before screenshots; advance projectile/threat time deterministically; and cover cancellation, physics, reuse, inventory exclusion, AI priority, camera silence, immediate object return, delayed no-teleport cleanup, competition ownership, and load cleanup. Final regression includes runtime/test syntax, `git diff --check`, house distractions, player systems, breath stealth, flashlight/pursuit, Victory Feast, renovation, and Contestant 13.

## Notes

- This is a new system rather than an extension of the three fixed house devices, but it deliberately reuses their bounded Mr. Feast response route.
- The first impact is the only AI/audio event from a throw. Later bounces remain physical and visual so one object cannot spam investigations.
- Red-first confirmation failed on the absent `THROWABLE_DISTRACTIONS` tuning table and focused system before implementation. User feedback first separated throw from F, then moved it from G to the easier Q binding; F remains exclusively flashlight.
- The focused browser suite uses real E cancellation/completion, real F and Q input, the shipped touch controls, a real save/load payload, dynamic Rapier collision, complete no-teleport Mr. Feast response/cleanup routes, and a separately loaded Victory Feast Saint. The exposed finale throw is rejected; the coat-closet throw changes the Saint's target and produces measured travel toward the impact.
- The delayed cleanup regression caught the old eight-second projectile fallback teleporting slow-settling clutter home before Mr. Feast could collect it. That fallback now forces a physical settled state; only an object that falls out of the world is immediately restored.
- Visual inspection caught and fixed a false-positive carry state: the item was attached to a camera that was not itself in the rendered scene graph. The current proof shows the brass paperweight clearly in the lower-right first-person view. Desktop carry/impact/finale and phone impact captures live under `output/playwright/mr-feast-throwable-distractions/`.
- Runtime and focused-test syntax, `git diff --check`, house distractions, breath stealth, flashlight, camera security, caught pursuit, Victory Feast, window curtains, player systems, and full desktop/mobile Contestant 13 pass. Renovation retains only its unrelated current-origin `28 stairwell continuity` light-handoff failure.
