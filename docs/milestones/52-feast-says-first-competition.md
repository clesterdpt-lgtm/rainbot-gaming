# Milestone 52: Feast Says First Competition

## Status

In progress — implementation and automated acceptance complete; user playtest pending

## Objective

Add the mansion's first sanctioned reality-show competition and use it to pace the investigation. After ten minutes of active exploration, or immediately after the player's first major Contestant 13 or Painting Room discovery, Mr. Feast calls everyone to the Ballroom. The discovery that caused the call remains earned, but further clue progression pauses until the player completes Feast Says.

## Scope

- One authoritative `FEAST_SAYS` tuning table and an explicit event state machine.
- A ten-minute active-exploration trigger that starts only after the front-door welcome and pauses with the existing game pauses.
- A first-major-clue trigger covering the XIII book, concealed shovel, and first Painting Room scratch.
- A temporary investigation pause while the event is called or running, with clear in-world feedback instead of silently swallowing interactions.
- A visible Ballroom reporting station, four contestant marks, staged Mr. Feast and contestant positions, and a responsive event HUD with separate compact idle/call and active-command phone layouts.
- A fixed sequence of six genuine commands in this exact order: `Feast says step left.`, `Feast says step right.`, `Feast says step back.`, `Feast says crouch.`, `Feast says point to the contestant you distrust most.`, and `Feast says step toward the contestant you would eliminate.`
- Existing movement/crouch input for the first four commands, look plus E or touch Interact for the distrust choice, and actual world-direction displacement toward a staged contestant for the elimination choice. Every named psychological choice scores as obedience rather than judging the target.
- A 7.5-second response window and 6-second result hold for every command. Each result delivers an authored anxious or funny contestant line before Mr. Feast interrupts with a warning.
- Distinct authored psychological targets for Mara, Kip, and Juniper, including choices that target the player.
- Challenge-only response motion for Mara, Kip, and Juniper: isolated planted procedural crouch and sidestep poses that reset from a captured base every frame and cannot accumulate, plus readable backward gait, target-directed approach, and point gestures, with an eased return between commands and synchronous release cleanup.
- No idle next-game countdown strip during free exploration; the competition HUD appears only once Feast Says is called or live. Active command readability and touch targets remain unchanged.
- A round scoreboard, authored contestant performance, generic player-facing `lowest score is eliminated` wording, Kip's deterministic first NPC elimination when the player survives, and an `ELIMINATED` recovery modal when the player loses.
- Save/load persistence for the countdown, called/completed state, and elimination result. Mid-competition saves resume from the Ballroom call rather than inside a command.
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
| `called` | player reports at the Ballroom station | `briefing` |
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
- [x] The called-state HUD and Ballroom station clearly direct the player; reporting stages Mr. Feast, all three loaded contestants, the player, and four visible contestant marks without permanent teleports or seating reservations. — test: `scripts/test-mr-feast-feast-says.mjs::Ballroom staging`
- [x] The six genuine commands run in the locked left/right/back/crouch/distrust/eliminate order with 7.5-second response windows and 6-second result holds; the first four accept existing movement/crouch input and update the accessible scoreboard. — test: `scripts/test-mr-feast-feast-says.mjs::real command input and scoring`
- [x] Player-facing briefing, HUD, and loss copy state only that the lowest score is eliminated, without naming a contestant to beat. A surviving player eliminates only Kip, releases the host and surviving contestants, and re-enables clue progression; the authored player-loss cutoff opens a recoverable `ELIMINATED` screen. — test: `scripts/test-mr-feast-feast-says.mjs::completion and elimination outcomes`
- [x] Explicit save/load preserves dormant elapsed time, called/completed state, and Kip's elimination; a transient briefing/command/result save restores as `called`. — test: `scripts/test-mr-feast-feast-says.mjs::save restore contract`
- [x] `render_game_to_text()` and focused QA controls expose phase, trigger, elapsed time, ordered command, response/result time, scores, staged cast, psychological targets, clue lock, invalid transitions, and completion. — test: `scripts/test-mr-feast-feast-says.mjs::diagnostics and deterministic controls`
- [x] The call card, revised command text, timer, scoreboard, choice hints, and recovery screen fit both 1280x820 and 390x844 without obscuring the required touch movement/interact controls. — test: `scripts/test-mr-feast-feast-says.mjs::desktop and phone presentation`
- [x] On 390×844, the dormant countdown stays hidden; the called status strip stays ≤58 px; the active command card stays ≤126 px tall, retains ≥16 px command text and a ≥44 px crouch action, hides nonessential standings, and does not overlap Bag/Menu or lower controls. — test: `scripts/test-mr-feast-feast-says.mjs::compact active command card`
- [x] The dormant `NEXT LIVE EVENT` countdown remains off-screen on desktop and phone; the internal ten-minute clock still advances and still triggers the live call. — test: `scripts/test-mr-feast-feast-says.mjs::ten-minute call and pause contract`
- [x] The distrust command selects the contestant under the player's look with E or touch Interact, while the elimination command infers a target from actual player displacement in world space. A valid target scores as obedience, a non-choice fails, and neither choice judges whom the player selected. — test: `scripts/test-mr-feast-feast-says.mjs::psychological command choices`
- [x] Mara, Kip, and Juniper use distinct authored distrust and elimination targets, including the player; each result presents its authored anxious or funny contestant line before Mr. Feast's warning. — test: `scripts/test-mr-feast-feast-says.mjs::psychological targets and result dialogue`
- [x] Contestant crouch and sidestep responses use an isolated planted procedural pose layer captured from a stable base every frame, so repeated updates cannot accumulate skeletal drift. Backpedal, approach, and target-facing point responses stay readable, then every response eases back and clears on the next command or release. — test: `scripts/test-mr-feast-feast-says.mjs::contestant response motion`
- [x] At 844×390 and 568×320, every revised live command card stays ≤90 px tall, uses no more than 48% of the game stage, retains ≥16 px command text and a ≥44 px crouch target, and clears the visible movement and interaction controls. — test: `scripts/test-mr-feast-feast-says.mjs::compact landscape command cards`
- [x] A touch-only player can report to the Ballroom and complete all six genuine commands in mobile landscape using the visible movement, crouch, camera-look, and Interact controls; the final choice requires real movement toward a contestant, and surviving eliminates Kip and reopens clue progression. — test: `scripts/test-mr-feast-feast-says.mjs::touch-only landscape completion`
- [ ] User playtest confirms that the six-command order and timing are readable, the two psychological choices are understandable without contestant-to-direction mappings, the result dialogue lands before each warning, the Ballroom staging feels like a produced reality show, and the clue pause feels motivated rather than arbitrary. — verified by user playtest

## Exit condition

User explores for ten minutes or finds one major clue -> Mr. Feast calls Feast Says, additional clue progress waits, the player reports to the Ballroom and completes four simple physical commands followed by look-and-Interact distrust and real-movement elimination choices -> the lowest-score result eliminates Kip when the player survives and reopens the investigation.

## Test plan

Create `scripts/test-mr-feast-feast-says.mjs` before implementation and run it red against the missing system. Add source-contract assertions for the tuning table, state machine, DOM, clue gate, save payload, diagnostics, and QA controls. Turn the focused suite green, then run syntax, renovation, opening-welcome, player-systems, contestant-conversations, seating/routines, workroom-code, basement-key, and full Contestant 13 regressions. Complete the live-iterate loop with text-state probes, real keyboard/touch input, console review, and desktop/mobile Ballroom screenshots.

## Notes

- The player-facing rule is always `lowest score is eliminated`; it never names a contestant to beat. Authored scoring preserves Kip as the first NPC elimination when the player survives, while a tie at the player-loss cutoff remains an elimination.
- Only the first discovery is allowed through before the call. Already-earned clues remain readable; only new progression is paused.
- Later competition milestones will add later investigation ceilings. This slice solves the immediate problem of clearing the full chain before competition one without inventing unapproved games two and three.
- The 2026-07-19 countdown-HUD refinement replaces the full dormant card with a compact inline strip across desktop, portrait phone, and short landscape. During live short-landscape commands, a two-column row places the 44 px Crouch action beside the command/timer, removes the redundant header and standings, and yields the location, Bag/Menu, Energy, Stealth, security, speech, and global Scores overlays. The card measures about 63 px at 568×320 and never blocks the lowered movement/interact controls.
- The authored distrust targets are Mara -> Kip, Kip -> Mara, and Juniper -> player. The authored elimination targets are Mara -> Kip, Kip -> player, and Juniper -> Mara. The show scores the act of choosing, not the target, so both subjective instructions remain fair and deterministic.
- The distrust prompt uses camera look plus E or touch Interact. The elimination prompt deliberately uses actual world-direction movement so it reads as stepping toward a person rather than selecting a disguised menu option.

## Verification

- `node --check assets/js/mr-feast-mansion.js`, `node --check scripts/test-mr-feast-feast-says.mjs`, `node scripts/test-mr-feast-feast-says.mjs`, and `git diff --check` passed on the final tree. The focused browser suite covers the exact ordered deck, generic briefing/loss copy, desktop and touch look-plus-Interact pointing, actual displacement-based approach, distinct NPC targets including the player, proportional planted poses and complete return, result banter/warning timing, save/loss/partial-cast recovery, compact portrait/landscape layouts, and zero unexpected console errors.
- Current adjacent passes: `test-mr-feast-renovation.mjs`, `test-mr-feast-storm-run.mjs`, `test-mr-feast-contestant-conversations.mjs`, `test-mr-feast-seating-and-routes.mjs`, `test-mr-feast-workroom-code-clue.mjs`, `test-mr-feast-basement-key-trail.mjs`, and the full desktop/mobile `test-mr-feast-contestant-13.mjs`. The story helpers now let each competition's short elimination card finish before asserting that the investigation HUD has handed back.
- The player-systems adjacent attempt still stopped at its existing fullscreen/maximize wait. A separate opening-welcome attempt timed out waiting for the optional host model's loaded flag; the focused Feast Says suite repeatedly staged the host and cast successfully, and neither timeout exposed a Feast Says assertion or browser error.
- Refreshed visual proof: `output/playwright/mr-feast-feast-says/{six-command-round-desktop,contestant-sidestep-left-desktop,contestant-sidestep-right-desktop,contestant-crouch-desktop,contestant-backpedal-desktop,contestant-point-desktop,contestant-approach-desktop,result-banter-point-desktop,result-warning-point-desktop,opening-command-landscape,opening-command-compact-landscape,six-command-complete-landscape,player-eliminated-desktop}.png`. The result bubbles clear the judgment card, and the final pose captures show stable anatomy with no accumulated crouch/sidestep distortion.
