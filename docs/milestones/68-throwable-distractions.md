# Milestone 68: Throwable Distractions

## Status

in-progress

## Objective

Let the player improvise short-lived stealth distractions from ordinary mansion clutter. Pressing E/touch Interact immediately lifts a small authored prop, holding the control keeps it visibly carried, and releasing the control drops it. Q/the contextual mobile tool button throws it instead, with separate physical release audio for drops and throws. F remains exclusively assigned to the flashlight. The prop always remains world state: it never enters the Bag, clue inventory, or save payload.

## Scope

- Make at least sixty-five recognizable small props portable across at least sixteen authored room labels on the main floor, second floor, and basement.
- Put one themed portable object inside every openable `Cabinet`; closed doors hide and unregister the object, while opening the real storage interaction reveals a reachable shelf item.
- Reuse existing mansion dressing directly wherever it is already suitable, and adopt every visible child of a composite prop into one moving assembly so pickup cannot strand pieces such as vase flowers.
- Pick up one prop immediately on E/touch Interact press, keep it carried only while that control remains held, and drop it through the physical prop path on release.
- Show the carried prop in first person and use Q for throwing without changing F's flashlight ownership or allowing the later E/touch release to create a duplicate drop.
- Add distinct one-shot procedural handling cues for an ordinary drop and a forceful throw, while retaining the existing material-specific first-impact cue.
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

- [x] At least sixty-five props are distributed across all three mansion levels and at least sixteen authored room labels, and every one exposes a reachable `Hold E · carry …` / touch interaction. — test: `scripts/test-mr-feast-throwable-distractions.mjs::distribution and real hold`
- [x] All 24 openable cabinets contain one themed portable object. Every item stays hidden and non-interactive while its cabinet is closed, appears at its authored shelf position when opened, and can be lifted through real desktop or touch input. The under-sink cleaning bottle coexists with the separately usable basement flashlight. — test: `scripts/test-mr-feast-throwable-distractions.mjs::cabinet coverage and storage gating`
- [x] At least thirty-two props adopt existing mansion meshes rather than placing a duplicate. Every declared visual part belongs to the portable root, and each foyer flower vase carries and resets its vessel, three stems, and three blooms as one seven-part assembly with no stranded source meshes. — test: `scripts/test-mr-feast-throwable-distractions.mjs::authored adoption and composite vase`
- [x] E/touch Interact press immediately carries exactly one visible prop and removes its world prompt; the prop remains carried for as long as that same control stays down. Releasing the control drops it through Rapier and emits exactly one drop-release cue. — test: `scripts/test-mr-feast-throwable-distractions.mjs::instant press, held carry, and release drop`
- [x] A carried prop is absent from the Bag, clue inventory, and save payload; the runtime exposes it only through focused throwable diagnostics and the contextual hand/tool presentation. — test: `scripts/test-mr-feast-throwable-distractions.mjs::no inventory ownership`
- [x] Q throws a carried prop with exactly one throw-release cue while F always retains its flashlight behavior, including while the player is carrying. Releasing E after Q does not create a second drop. On touch, the existing Light tool becomes Throw only while carrying. — test: `scripts/test-mr-feast-throwable-distractions.mjs::desktop and mobile tool ownership`
- [x] The thrown prop follows a Rapier-owned arc, collides with the mansion, emits exactly one spatial first-impact cue, visibly bounces/settles, and becomes pickable again. — test: `scripts/test-mr-feast-throwable-distractions.mjs::physics impact and reuse`
- [x] A nearby Mr. Feast who is free to respond physically investigates the impact, returns the displaced prop to its authored spot, and resumes patrol without teleporting. An unheard settled prop remains reusable until its delayed cleanup errand begins; then Mr. Feast physically collects and resets it. Pursuit, camera response, other active work, range, and floor boundaries retain priority. — test: `scripts/test-mr-feast-throwable-distractions.mjs::bounded response and delayed cleanup`
- [x] In the Victory Feast escape, an impact can redirect the Saint only while the player is hidden; an exposed player remains the live target. Cameras never hear or alarm on thrown sound. — test: `scripts/test-mr-feast-throwable-distractions.mjs::Saint and camera boundaries`
- [x] Live competitions block pickup/throw use and return carried or moving props to their authored positions. Load/reset clears all carry, projectile, pending sound, and threat-investigation state. — test: `scripts/test-mr-feast-throwable-distractions.mjs::competition and reset lifecycle`
- [x] Desktop and 390×844 touch layouts preserve usable movement, Interact, breath, and Bag controls with no new inventory panel. — test: `scripts/test-mr-feast-throwable-distractions.mjs::responsive controls`
- [ ] User playtest confirms immediate pickup, held-carry reliability, drop/throw release loudness, throw force, impact loudness, and the threat diversion window feel useful without becoming an automatic escape button. — verified by user playtest

## Exit condition

The player finds a small object, presses and holds E/touch Interact to lift and keep carrying it without adding anything to the Bag, then either releases the control to drop it with physical feedback or presses Q/the contextual Throw control to hear a forceful release and use the later impact to pull a nearby searching threat away long enough to change routes. Mr. Feast eventually returns the displaced object home, preventing permanent clutter.

## Test plan

Create `scripts/test-mr-feast-throwable-distractions.mjs` before implementation and confirm it fails on the missing tuning table and focused system. The green browser flow must use real E keydown/keyup timing, real Q throws, real F flashlight toggles while carrying, and the shipped touch controls; inspect `render_game_to_text()` before screenshots; advance projectile/threat time deterministically; and cover immediate pickup, held carry, release drop, separate drop/throw cues, no duplicate E-release after Q, physics, reuse, inventory exclusion, AI priority, camera silence, immediate object return, delayed no-teleport cleanup, competition ownership, and load cleanup. Final regression includes runtime/test syntax, `git diff --check`, house distractions, player systems, breath stealth, flashlight/pursuit, Victory Feast, renovation, and Contestant 13.

## Notes

- This is a new system rather than an extension of the three fixed house devices, but it deliberately reuses their bounded Mr. Feast response route.
- The first impact is the only AI/audio event from a throw. Later bounces remain physical and visual so one object cannot spam investigations.
- Red-first confirmation failed on the absent `THROWABLE_DISTRACTIONS` tuning table and focused system before implementation. User feedback first separated throw from F, then moved it from G to the easier Q binding; F remains exclusively flashlight.
- The focused browser suite uses real E cancellation/completion, real F and Q input, the shipped touch controls, a real save/load payload, dynamic Rapier collision, complete no-teleport Mr. Feast response/cleanup routes, and a separately loaded Victory Feast Saint. The exposed finale throw is rejected; the coat-closet throw changes the Saint's target and produces measured travel toward the impact.
- The delayed cleanup regression caught the old eight-second projectile fallback teleporting slow-settling clutter home before Mr. Feast could collect it. That fallback now forces a physical settled state; only an object that falls out of the world is immediately restored.
- Visual inspection caught and fixed a false-positive carry state: the item was attached to a camera that was not itself in the rendered scene graph. The current proof shows the brass paperweight clearly in the lower-right first-person view. Desktop carry/impact/finale and phone impact captures live under `output/playwright/mr-feast-throwable-distractions/`.
- The small-prop expansion first failed red on the new forty-prop requirement. A stricter authored-adoption pass then caught bad world anchors for the foyer trays, Painting Room cart, kitchen towels, and main bathroom vanity dressing; those mappings now use the builders' exact positions. The focused browser suite proves 41 reachable props across 17 room labels, 32 complete existing-mesh assemblies, and zero stranded source parts. `desktop-carried-flower-vase.png` is the dedicated composite carry proof.
- The cabinet expansion failed red on the absent stock-kind profiles, then the all-cabinet reachability sweep exposed cabinet-door ray interception in five placements and the existing flashlight winning the under-sink prompt. Storage-local shelf positions now clear the open doors; the cleaning bottle occupies the upper left shelf while the flashlight retains its own lower position. The focused browser suite proves 24/24 cabinets reveal a real throwable after opening, with desktop and touch pickup coverage. `desktop-open-cabinet-item.png` and `desktop-carried-cabinet-item.png` are the dedicated cabinet proofs.
- Runtime and focused-test syntax, `git diff --check`, house distractions, breath stealth, flashlight, camera security, caught pursuit, Victory Feast, window curtains, player systems, and full desktop/mobile Contestant 13 pass. Renovation retains only its unrelated current-origin `28 stairwell continuity` light-handoff failure.
- 2026-07-29 control/audio refinement: the revised contract failed red on the old `Hold E · pick up` prompt and absent physical drop/release-audio paths. The green real-browser flow now proves instant E/touch pickup, retained carry while held, one Rapier drop and one `throwableDrop` cue on release, one `throwableThrow` whoosh on Q/contextual Throw, no duplicate drop from the later E/touch release, unchanged F flashlight ownership, and the existing material-specific first-impact cue. The Web Audio context is explicitly enabled in desktop and phone QA; all 65 props, Mr. Feast cleanup, finale Saint boundaries, and both browser consoles pass.
