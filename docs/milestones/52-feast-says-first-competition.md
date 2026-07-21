# Milestone 52: Feast Says First Competition

## Status

In progress — implementation and automated acceptance complete; user playtest pending

## Objective

Add the mansion's first sanctioned reality-show competition and use it to pace the investigation. After ten minutes of active exploration, or immediately after the player's first major Contestant 13 or Painting Room discovery, Mr. Feast calls everyone to the Ballroom. The discovery that caused the call remains earned, but further clue progression pauses until the player checks in with Mr. Feast at the Ballroom production set and completes Feast Says. Failing to report within five active minutes eliminates the player.

## Scope

- One authoritative `FEAST_SAYS` tuning table and an explicit event state machine.
- A ten-minute active-exploration trigger that starts only after the front-door welcome and pauses with the existing game pauses.
- A first-major-clue trigger covering the XIII book, concealed shovel, and first Painting Room scratch.
- A temporary investigation pause while the event is called or running, with clear in-world feedback instead of silently swallowing interactions.
- A Ballroom film-production set in place of the old report sign: one large broadcast camera, two studio lights, and a boom microphone frame Mr. Feast while he waits at the contestant check-in point. The event starts only when the player faces him and uses E or touch Interact; four contestant marks, staged cast positions, and the responsive minimal status strip remain part of the live competition.
- A five-active-minute called-state deadline shown by the minimal timer strip. Existing blocking UI pauses the deadline, incomplete Mr. Feast/contestant asset loading never consumes it, and a no-show produces the recoverable `ELIMINATED` state.
- A fixed sequence of six calls in this exact order: `Feast says step left.`, `Step right.`, `Feast says step back.`, `Crouch.`, `Feast says point to the contestant you distrust most.`, and `Feast says step toward the contestant you would sacrifice.` The plain right and crouch calls are fake-outs that score only when the contestant holds still.
- Existing movement input for the genuine physical calls, no input for the two fake-outs, look plus E or touch Interact for the distrust choice, and actual world-direction displacement toward a staged contestant for the sacrifice choice. Every named psychological choice scores as obedience rather than judging the target.
- A 7.5-second response window and 7.2-second result hold for every command. Mr. Feast speaks the rules, every command, and a clear correct/incorrect verdict. Each result then delivers an authored anxious or funny contestant line before he interrupts with a warning.
- Distinct authored psychological targets for Mara, Kip, and Juniper, including choices that target the player.
- Challenge-only response motion for Mara, Kip, and Juniper: isolated planted procedural crouch and sidestep poses that reset from a captured base every frame and cannot accumulate, plus readable backward gait, target-directed approach, and point gestures, with an eased return between commands and synchronous release cleanup.
- No idle next-game countdown strip during free exploration; the competition strip appears only once Feast Says is called or live. Written commands, hints, scores, and standings remain absent because Mr. Feast's speech is authoritative; existing movement, camera, and Interact touch targets remain available.
- Internal round scoring and authored contestant performance, a spoken briefing that says to obey only instructions beginning with `Feast says` and that the lowest score is eliminated, Kip's deterministic first NPC elimination when the player survives, and an `ELIMINATED` recovery modal when the player loses.
- A witnessed post-game aftermath: Kip pleads from a challenge-only upset pose, Mr. Feast answers ominously, Mara and Juniper walk authored routes back to their normal Library and Reading Room routines, and each survivor has one game-specific conversation before returning to the normal dialogue pool. Kip disappears and Mr. Feast resumes patrol only after the player is significantly out of sight upstairs, in the basement, outdoors, or far across the main floor.
- Save/load persistence for the exploration countdown, exact called-state deadline, completed state, and elimination result. A save made during briefing, command, or result normalizes to the Ballroom call with a fresh five-minute check-in window rather than resuming inside a command.
- Diagnostics and deterministic QA controls through `render_game_to_text()` and `window.MrFeastFresh`.

## Out of scope

- Competition two, competition three, their clue gates, or the final escape.
- Kip's death, luggage/confessional aftermath, supernatural rerun, or Elimination Dinner scene.
- New character models, voice acting, or lip synchronization.
- A global season scheduler or phase-wide countdown beyond this first event.

## Dependencies

- **Depends on:** Milestone 35 player movement/crouch, Milestone 47 contestant cast, Milestone 48 contestant routines, Milestone 50 opening welcome
- **Blocks:** later competition and investigation-phase milestones

## State graph

| From | Event | To |
|---|---|---|
| `dormant` | ten active minutes or first major clue | `called` |
| `called` | player interacts with Mr. Feast at the Ballroom production set | `briefing` |
| `called` | five active check-in minutes expire | `failed` |
| `briefing` | briefing hold expires | `command` |
| `command` | response window expires | `result` |
| `result` | more commands remain | `command` |
| `result` | player finishes above the authored lowest-score cutoff after command six | `completed` |
| `result` | player finishes at or below the authored lowest-score cutoff after command six | `failed` |
| `failed` | load or restart | restored save or fresh `dormant` |

Invalid transition requests are reported in diagnostics and warned in QA.

## Acceptance criteria

- [x] A fresh run remains dormant before ten active exploration minutes; the opening welcome and existing pause surfaces do not consume the timer, and reaching ten minutes calls Feast Says exactly once. — test: `scripts/test-mr-feast-feast-says.mjs::ten-minute call and pause contract`
- [x] Reading the XIII book, taking the shovel first, or revealing a first Painting Room scratch calls the event immediately after preserving that discovery; subsequent undiscovered story interactions are paused until completion. — test: `scripts/test-mr-feast-feast-says.mjs::first-clue call and investigation pause`
- [x] The called-state Ballroom scene contains no report sign and instead stages a large broadcast camera, two studio lights, a boom microphone, and a waiting Mr. Feast. Facing Mr. Feast and using E or touch Interact is the only way to begin; doing so stages all three loaded contestants, the player, and four visible contestant marks without permanent teleports or seating reservations. — test: `scripts/test-mr-feast-feast-says.mjs::Ballroom production call and staging`
- [x] The called-state timer begins at five minutes, consumes only active playable time after the host and contestants are available, pauses with blocking UI, and produces a recoverable no-show `ELIMINATED` state at zero. — test: `scripts/test-mr-feast-feast-says.mjs::five-minute production call deadline`
- [x] The six calls run in the locked left/right/back/crouch/distrust/sacrifice order with 7.5-second response windows and 7.2-second result holds. The plain right and crouch calls omit `Feast says` and score a player only for holding still; the genuine calls accept their existing movement/look/Interact input. — test: `scripts/test-mr-feast-feast-says.mjs::real command input, fake-outs, and scoring`
- [x] Mr. Feast's speech teaches that only commands beginning with `Feast says` should be obeyed and that the lowest score is eliminated, without naming a contestant to beat. His speech then carries every live instruction and verdict; the minimal status strip exposes only event, round, and time, with no duplicate command, hint, score, or standings text. A surviving player eliminates only Kip and re-enables clue progression; the authored player-loss cutoff opens a recoverable `ELIMINATED` screen. — test: `scripts/test-mr-feast-feast-says.mjs::speech-led briefing, commands, and outcomes`
- [x] After a surviving result, Kip stays visible with a slumped upset pose for his plea and Mr. Feast's ominous reply while Mara and Juniper walk back to their saved routines. Each survivor's first post-game conversation uses an authored debrief line, then normal dialogue resumes. Kip and the staged host remain while the player is nearby, then Kip is removed and Mr. Feast resumes patrol after an upstairs, basement, outdoor, or sufficiently distant out-of-sight departure. — test: `scripts/test-mr-feast-feast-says.mjs::witnessed post-game aftermath`
- [x] Explicit save/load preserves dormant elapsed time, the exact remaining called-state deadline, completed state, and Kip's elimination; a transient briefing/command/result save restores as `called` with a fresh five minutes and restages the waiting host and production set. — test: `scripts/test-mr-feast-feast-says.mjs::save restore contract`
- [x] `render_game_to_text()` and focused QA controls expose phase, trigger, exploration elapsed time, called-state deadline, waiting host, production-set inventory, ordered command, response/result time, scores, staged cast, psychological targets, clue lock, invalid transitions, and completion. — test: `scripts/test-mr-feast-feast-says.mjs::diagnostics and deterministic controls`
- [x] Mr. Feast's briefing, command, verdict, banter, warning, and aftermath bubbles plus the minimal timer strip fit both 1280x820 and 390x844 without obscuring the required touch movement/interact controls. — test: `scripts/test-mr-feast-feast-says.mjs::desktop and phone presentation`
- [x] On 390×844, the dormant countdown stays hidden and every live status strip stays ≤58 px, clears Bag/Menu and the lower controls, and leaves the complete spoken instruction visible. Written command, hint, score, and standings elements remain hidden. — test: `scripts/test-mr-feast-feast-says.mjs::compact speech-led status strip`
- [x] The dormant `NEXT LIVE EVENT` countdown remains off-screen on desktop and phone; the internal ten-minute clock still advances and still triggers the live call. — test: `scripts/test-mr-feast-feast-says.mjs::ten-minute call and pause contract`
- [x] The distrust command selects the contestant under the player's look with E or touch Interact, while the elimination command infers a target from actual player displacement in world space. A valid target scores as obedience, a non-choice fails, and neither choice judges whom the player selected. — test: `scripts/test-mr-feast-feast-says.mjs::psychological command choices`
- [x] Mara, Kip, and Juniper use distinct authored distrust and elimination targets, including the player; each result presents its authored anxious or funny contestant line before Mr. Feast's warning. — test: `scripts/test-mr-feast-feast-says.mjs::psychological targets and result dialogue`
- [x] Contestant crouch and sidestep responses use an isolated planted procedural pose layer captured from a stable base every frame, so repeated updates cannot accumulate skeletal drift. Backpedal, approach, and target-facing point responses stay readable, then every response eases back and clears on the next command or release. — test: `scripts/test-mr-feast-feast-says.mjs::contestant response motion`
- [x] At 844×390 and 568×320, every live status strip stays ≤58 px and clears the visible movement, interaction, Bag/Menu, location, and speech surfaces while Mr. Feast's complete command remains readable. — test: `scripts/test-mr-feast-feast-says.mjs::compact landscape speech layout`
- [x] A touch-only player can report to the Ballroom, hold still through both fake-outs, and complete all six calls in mobile landscape using visible movement, camera-look, and Interact controls; the final sacrifice choice requires real movement toward a contestant, and surviving eliminates Kip and reopens clue progression. — test: `scripts/test-mr-feast-feast-says.mjs::touch-only landscape completion`
- [ ] User playtest confirms that the six-command order and timing are readable, the two psychological choices are understandable without contestant-to-direction mappings, the result dialogue lands before each warning, the Ballroom staging feels like a produced reality show, and the clue pause feels motivated rather than arbitrary. — verified by user playtest

## Exit condition

User explores for ten minutes or finds one major clue -> Mr. Feast calls Feast Says, additional clue progress waits, and a five-minute active deadline begins -> the player finds the Ballroom film set, sees the broadcast camera, two studio lights, boom microphone, and waiting host, then faces and interacts with Mr. Feast before time expires -> the player obeys only calls beginning with `Feast says`, including holding still through the right-step and crouch fake-outs, followed by look-and-Interact distrust and a real-movement sacrifice choice -> the lowest-score result eliminates Kip when the player survives -> Kip pleads, Mr. Feast answers, survivors return to their routines, and leaving the witnessed scene removes Kip offscreen and returns Mr. Feast to patrol while investigation remains open. A no-show ends at the same recoverable `ELIMINATED` screen.

## Test plan

Create `scripts/test-mr-feast-feast-says.mjs` before implementation and run it red against the missing system. Add source-contract assertions for the tuning table, state machine, production-set inventory, host-centered interaction, five-active-minute deadline, no-show outcome, pause/loading fairness, save payload, diagnostics, and QA controls. Turn the focused suite green, then run syntax, renovation, opening-welcome, player-systems, contestant-conversations, seating/routines, workroom-code, basement-key, and full Contestant 13 regressions. Complete the live-iterate loop with text-state probes, real keyboard/touch input, console review, and desktop/mobile Ballroom screenshots.

## Notes

- The player-facing rule says to obey only commands beginning with `Feast says` and that the lowest score is eliminated; it never names a contestant to beat. Authored scoring preserves Kip as the first NPC elimination when the player survives, while a tie at the player-loss cutoff remains an elimination.
- The five-minute check-in deadline measures active opportunity rather than wall time: menu/keypad/game-over surfaces pause it, and it does not begin charging until the required host/cast interaction is available. Called saves preserve the exact deadline; transient competition saves deliberately grant a fresh five minutes on their safe return to `called`.
- The aftermath is witnessed but not a death reveal. Kip's disappearance is deliberately offscreen after a significant location/sightline break, preserving the later horror escalation while letting Mr. Feast resume the existing patrol and the survivors resume their ambient routines.
- Only the first discovery is allowed through before the call. Already-earned clues remain readable; only new progression is paused.
- Later competition milestones will add later investigation ceilings. This slice solves the immediate problem of clearing the full chain before competition one without inventing unapproved games two and three.
- The 2026-07-20 speech-led refinement removes written commands, choice hints, scores, and standings from the competition interface. Across desktop, portrait phone, and short landscape, the remaining Feast Says / round / timer strip stays under 58 px while Mr. Feast's existing speech surface carries the rules, each call, the verdict, and his warning.
- The authored distrust targets are Mara -> Kip, Kip -> Mara, and Juniper -> player. The authored elimination targets are Mara -> Kip, Kip -> player, and Juniper -> Mara. The show scores the act of choosing, not the target, so both subjective instructions remain fair and deterministic.
- The distrust prompt uses camera look plus E or touch Interact. The elimination prompt deliberately uses actual world-direction movement so it reads as stepping toward a person rather than selecting a disguised menu option.

## Verification

- `node --check assets/js/mr-feast-mansion.js`, `node --check scripts/test-mr-feast-feast-says.mjs`, `node scripts/test-mr-feast-feast-says.mjs`, and `git diff --check` passed on the final tree. The focused browser suite covers the exact six-call order, right-step and crouch fake-outs with correct stillness on desktop/touch, the sacrifice prompt, look-plus-Interact pointing, actual displacement-based approach, distinct NPC targets including the player, proportional planted poses, result banter/warning timing, Kip's visible upset pose and two-line aftermath, both survivor walk-backs and one-use debriefs, offscreen cleanup, save/loss/partial-cast recovery, compact portrait/landscape layouts, and zero unexpected console errors.
- `node scripts/test-mr-feast-renovation.mjs` and `node scripts/test-mr-feast-storm-run.mjs` passed after the aftermath/fake-out refinement, preserving the mansion source invariants and the post-Feast Game 2 eligibility, trigger, staging, race, and release handoff.
- Current adjacent passes: `test-mr-feast-renovation.mjs`, `test-mr-feast-storm-run.mjs`, `test-mr-feast-contestant-conversations.mjs`, `test-mr-feast-seating-and-routes.mjs`, `test-mr-feast-workroom-code-clue.mjs`, `test-mr-feast-basement-key-trail.mjs`, and the full desktop/mobile `test-mr-feast-contestant-13.mjs`. The story helpers now let each competition's short elimination card finish before asserting that the investigation HUD has handed back.
- The player-systems adjacent attempt still stopped at its existing fullscreen/maximize wait. A separate opening-welcome attempt timed out waiting for the optional host model's loaded flag; the focused Feast Says suite repeatedly staged the host and cast successfully, and neither timeout exposed a Feast Says assertion or browser error.
- Refreshed visual proof: `output/playwright/mr-feast-feast-says/{six-command-round-desktop,contestant-sidestep-left-desktop,contestant-sidestep-right-desktop,contestant-crouch-desktop,contestant-backpedal-desktop,contestant-point-desktop,contestant-approach-desktop,result-banter-point-desktop,result-warning-point-desktop,kip-elimination-aftermath,opening-command-landscape,opening-command-compact-landscape,six-command-complete-landscape,player-eliminated-desktop}.png`. The command captures show the thin event/round/time strip and Mr. Feast's unobstructed speech, while the result sequence proves his verbal verdict hands off cleanly to contestant banter and his warning.
