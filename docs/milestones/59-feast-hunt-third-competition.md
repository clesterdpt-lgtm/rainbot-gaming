# Milestone 59: Feast Hunt Third Competition

## Status

Implementation and automated acceptance complete; user playtest remains.

## Objective

Add the first playable version of the third sanctioned competition, `Feast Hunt`. After Storm Run and the patron-feed sabotage, the player must use the mansion's existing crouch, darkness, camera, hiding, and pursuit systems to recover three unmistakable gold competition props and physically return them to the foyer before Juniper, without being caught by Mr. Feast. The hunt begins with every interior fixture dead, turns the familiar house into a hostile stealth race, and begins the estate-statue horror escalation without bundling the later Winner's Dinner finale.

## Scope

- Gate the production call behind a fully resolved Storm Run and the existing patron-feed sabotage.
- Stage a foyer production call with Mr. Feast and Juniper, a five-active-minute check-in deadline, an immediately skippable rules explanation, and a spoken countdown.
- At release, force every interior fixture circuit off and keep its physical switches unresponsive until the competition ends, then restore the exact pre-hunt circuit states.
- Keep Juniper in competition ownership after the countdown: she must visibly run an authored multi-floor search route, collect her own three objects, return to the foyer, and eliminate the player if she arrives first.
- Hide one gold competition prop on each mansion level and register ordinary E/touch interactions for collecting each exactly once.
- Reveal an ordinary E/touch foyer return tray only after the player has all three props; the third pickup alone must not complete the game.
- Keep cameras, crouch visibility, hiding spots, and Mr. Feast's existing last-known-position pursuit authoritative during the live hunt.
- Make a full hostile-camera lock or Mr. Feast's clear personal sight begin pursuit; any physical catch during Feast Hunt eliminates the player on every floor.
- Turn the two foyer statues through authored, unobserved poses as the player collects props; the statues frighten and redirect but do not become a second lethal enemy in this slice.
- Add a compact desktop/mobile hunt HUD, deterministic diagnostics, save normalization, and focused QA controls.

## Out of scope

- Juniper's final story elimination, sacrifice, escort, or authored post-game cinematic.
- Winner's Dinner, escape/true endings, additional sabotage systems, procedural item locations, procedural navigation, hearing/noise AI, or lethal statues.
- New character models, voiced dialogue, downloaded audio, or a new navigation/physics architecture.

## Dependencies

- **Depends on:** Milestone 38 estate statues, Milestone 46 caught pursuit, Milestone 51 crouch stealth, Milestone 54 Storm Run, Milestone 57 pursuit evasion
- **Blocks:** Winner's Dinner and final ending milestones

## Acceptance criteria

- [x] Feast Hunt remains dormant until Storm Run is completed, its witnessed aftermath is resolved, and the patron feed is sabotaged; satisfying both gates calls the foyer set exactly once and pauses further clue progression. — test: `scripts/test-mr-feast-feast-hunt.mjs::third-game gate and production call`
- [x] The called state gives the player five active minutes to check in with Mr. Feast, pauses for blocking UI or unresolved host/cast loading, survives save/load with its remaining time, and produces a recoverable `ELIMINATED` no-show state at zero. — test: `scripts/test-mr-feast-feast-hunt.mjs::called deadline and save normalization`
- [x] Starting Feast Hunt holds the player in the foyer with Mr. Feast and Juniper, explains the three-object/no-catch rule, and lets E/touch Interact skip immediately to the complete spoken `3–2–1` countdown without skipping the release. — test: `scripts/test-mr-feast-feast-hunt.mjs::foyer briefing and immediate skip`
- [x] `Hunt` forces every interior fixture circuit off before control returns, blocks ordinary switches from relighting the mansion, and restores the exact pre-hunt circuit states on completion, catch, rival loss, or normalized load. — test: `scripts/test-mr-feast-feast-hunt.mjs::full-house blackout lifecycle`
- [x] Juniper remains under Feast Hunt ownership after the countdown, visibly leaves her foyer mark, searches the Dining Room, Reading Room, and Archive on an authored multi-floor route, tracks independent `0/3` to `3/3` progress, and produces a recoverable rival-win elimination if she returns first. — test: `scripts/test-mr-feast-feast-hunt.mjs::Juniper active rival route`
- [x] The Golden Bell, Golden Goblet, and Golden Carving Knife appear in authored hiding places on the main, second, and basement levels only during the hunt; real E/touch interaction collects each once, provides restrained feedback, and advances a compact `0/3` to `3/3` HUD without entering the investigation inventory. — test: `scripts/test-mr-feast-feast-hunt.mjs::real item collection and idempotence`
- [x] During the hunt, normal camera acquisition and the crouch visibility multiplier remain active; a full hostile-camera lock or Mr. Feast's clear personal sight starts his existing bounded, last-known-position pursuit, while cover and hiding still break tracking. — test: `scripts/test-mr-feast-feast-hunt.mjs::camera and personal-sight pursuit`
- [x] Any Mr. Feast catch during the live hunt produces a recoverable Feast Hunt `ELIMINATED` state on the main, second, or basement level; catches outside Feast Hunt retain their existing warning/basement behavior. — tests: `scripts/test-mr-feast-feast-hunt.mjs::hunt catch contract`, `scripts/test-mr-feast-caught-pursuit.mjs`
- [x] Each accepted pickup advances the two foyer statues to an authored orientation only while the player is outside the foyer; their physical placement/colliders stay fixed, their state is diagnostic, and they never damage or pursue the player. — test: `scripts/test-mr-feast-feast-hunt.mjs::unobserved statue escalation`
- [x] Collecting all three props leaves Feast Hunt live, changes the HUD objective to `Return to the foyer`, and reveals a real E/touch return tray. Only interacting with that tray completes Game 3, clears the immediate chase, restores the lights, holds camera and personal reacquisition through the visible `SAFE` completion card, removes every hunt interaction, and leaves the later Juniper/finale resolution explicitly pending rather than inventing a sacrifice scene; ordinary mansion security resumes after that grace. — test: `scripts/test-mr-feast-feast-hunt.mjs::three-item foyer return`
- [x] Called and completed progress persist; a save made during the briefing or live hunt safely restores to the called foyer set with already collected props preserved and no transient pursuit, speech, or staging state. — test: `scripts/test-mr-feast-feast-hunt.mjs::save restore contract`
- [x] `render_game_to_text()` and `window.MrFeastFresh` expose the gate, phase, report deadline, briefing/countdown, prop placements and collection state, camera/pursuit ownership, statue stage, outcome, and responsive HUD state; the existing touch flashlight remains on-screen and usable in phone landscape during the live hunt. — test: `scripts/test-mr-feast-feast-hunt.mjs::diagnostics and mobile HUD`
- [ ] User playtest confirms that the three props are discoverable without glowing objective arrows, camera coverage feels readable rather than arbitrary, hiding is useful without being automatic, and the statue turns are noticeable but not predictable. — verified by user playtest

## Exit condition

After winning Storm Run and sabotaging the patron feed, the player checks in at the foyer set, skips or hears Mr. Feast's rules, waits through the spoken countdown, and enters a mansion whose interior lights have all failed. Juniper runs her own visible multi-floor search while the player uses crouching, cover, hiding, and an optional recovered flashlight to collect the Golden Bell, Golden Goblet, and Golden Carving Knife. Cameras visibly acquire and report the player, Mr. Feast searches the last reliable location instead of reading hidden movement, a catch eliminates on any floor, and each successful pickup leaves the foyer statues facing somewhere newly impossible. The third pickup reveals the foyer return tray; physically bringing the objects back and interacting there before Juniper completes Game 3 without playing a sacrifice or finale scene.

## Test plan

Created `scripts/test-mr-feast-feast-hunt.mjs` and renovation source pins before implementation and confirmed the focused test failed first on the missing third-game phase contract. A review follow-up added red-first completion-safety and phone-landscape flashlight checks, which reproduced immediate post-win camera/personal reacquisition before turning green. The blackout/foyer-return/active-rival refinement failed red first on the missing rival-win outcome and then covered all-off circuit diagnostics, Juniper's physical departure and completed route, third-pickup non-completion, real foyer interaction, and light restoration. Final verification covers runtime/test syntax, renovation, focused camera/pursuit/statue/Storm Run suites, full desktop/mobile Contestant 13, `git diff --check`, and real-browser desktop/mobile hunt routes with `render_game_to_text()`, console capture, and screenshots.
