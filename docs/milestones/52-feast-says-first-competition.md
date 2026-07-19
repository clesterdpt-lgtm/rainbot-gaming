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
- A fixed sequence of six calls in this exact order: `Feast says step left.`, `Step right.`, `Feast says step back.`, `Crouch.`, `Feast says point to the contestant you distrust most.`, and `Feast says step toward the contestant you would sacrifice.` The plain right and crouch calls are fake-outs that score only when the contestant holds still.
- Existing movement input for the genuine physical calls, no input for the two fake-outs, look plus E or touch Interact for the distrust choice, and actual world-direction displacement toward a staged contestant for the sacrifice choice. Every named psychological choice scores as obedience rather than judging the target.
- A 7.5-second response window and 6-second result hold for every command. Each result delivers an authored anxious or funny contestant line before Mr. Feast interrupts with a warning.
- Distinct authored psychological targets for Mara, Kip, and Juniper, including choices that target the player.
- Challenge-only response motion for Mara, Kip, and Juniper: isolated planted procedural crouch and sidestep poses that reset from a captured base every frame and cannot accumulate, plus readable backward gait, target-directed approach, and point gestures, with an eased return between commands and synchronous release cleanup.
- No idle next-game countdown strip during free exploration; the competition HUD appears only once Feast Says is called or live. Active command readability and touch targets remain unchanged.
- A round scoreboard, authored contestant performance, a briefing that says to obey only instructions beginning with `Feast says` and that the lowest score is eliminated, Kip's deterministic first NPC elimination when the player survives, and an `ELIMINATED` recovery modal when the player loses.
- A witnessed post-game aftermath: Kip pleads from a challenge-only upset pose, Mr. Feast answers ominously, Mara and Juniper walk authored routes back to their normal Library and Reading Room routines, and each survivor has one game-specific conversation before returning to the normal dialogue pool. Kip disappears and Mr. Feast resumes patrol only after the player is significantly out of sight upstairs, in the basement, outdoors, or far across the main floor.
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
- [x] The six calls run in the locked left/right/back/crouch/distrust/sacrifice order with 7.5-second response windows and 6-second result holds. The plain right and crouch calls omit `Feast says` and score a player only for holding still; the genuine calls accept their existing movement/look/Interact input and update the accessible scoreboard. — test: `scripts/test-mr-feast-feast-says.mjs::real command input, fake-outs, and scoring`
- [x] Player-facing briefing and HUD teach that only commands beginning with `Feast says` should be obeyed and that the lowest score is eliminated, without naming a contestant to beat. A surviving player eliminates only Kip and re-enables clue progression; the authored player-loss cutoff opens a recoverable `ELIMINATED` screen. — test: `scripts/test-mr-feast-feast-says.mjs::completion and elimination outcomes`
- [x] After a surviving result, Kip stays visible with a slumped upset pose for his plea and Mr. Feast's ominous reply while Mara and Juniper walk back to their saved routines. Each survivor's first post-game conversation uses an authored debrief line, then normal dialogue resumes. Kip and the staged host remain while the player is nearby, then Kip is removed and Mr. Feast resumes patrol after an upstairs, basement, outdoor, or sufficiently distant out-of-sight departure. — test: `scripts/test-mr-feast-feast-says.mjs::witnessed post-game aftermath`
- [x] Explicit save/load preserves dormant elapsed time, called/completed state, and Kip's elimination; a transient briefing/command/result save restores as `called`. — test: `scripts/test-mr-feast-feast-says.mjs::save restore contract`
- [x] `render_game_to_text()` and focused QA controls expose phase, trigger, elapsed time, ordered command, response/result time, scores, staged cast, psychological targets, clue lock, invalid transitions, and completion. — test: `scripts/test-mr-feast-feast-says.mjs::diagnostics and deterministic controls`
- [x] The call card, revised command text, timer, scoreboard, choice hints, and recovery screen fit both 1280x820 and 390x844 without obscuring the required touch movement/interact controls. — test: `scripts/test-mr-feast-feast-says.mjs::desktop and phone presentation`
- [x] On 390×844, the dormant countdown stays hidden; the called status strip stays ≤58 px; the active command card stays ≤126 px tall, retains ≥16 px command text and a ≥44 px crouch action, hides nonessential standings, and does not overlap Bag/Menu or lower controls. — test: `scripts/test-mr-feast-feast-says.mjs::compact active command card`
- [x] The dormant `NEXT LIVE EVENT` countdown remains off-screen on desktop and phone; the internal ten-minute clock still advances and still triggers the live call. — test: `scripts/test-mr-feast-feast-says.mjs::ten-minute call and pause contract`
- [x] The distrust command selects the contestant under the player's look with E or touch Interact, while the elimination command infers a target from actual player displacement in world space. A valid target scores as obedience, a non-choice fails, and neither choice judges whom the player selected. — test: `scripts/test-mr-feast-feast-says.mjs::psychological command choices`
- [x] Mara, Kip, and Juniper use distinct authored distrust and elimination targets, including the player; each result presents its authored anxious or funny contestant line before Mr. Feast's warning. — test: `scripts/test-mr-feast-feast-says.mjs::psychological targets and result dialogue`
- [x] Contestant crouch and sidestep responses use an isolated planted procedural pose layer captured from a stable base every frame, so repeated updates cannot accumulate skeletal drift. Backpedal, approach, and target-facing point responses stay readable, then every response eases back and clears on the next command or release. — test: `scripts/test-mr-feast-feast-says.mjs::contestant response motion`
- [x] At 844×390 and 568×320, every revised live command card stays ≤90 px tall, uses no more than 48% of the game stage, retains ≥16 px command text and a ≥44 px crouch target, and clears the visible movement and interaction controls. — test: `scripts/test-mr-feast-feast-says.mjs::compact landscape command cards`
- [x] A touch-only player can report to the Ballroom, hold still through both fake-outs, and complete all six calls in mobile landscape using visible movement, camera-look, and Interact controls; the final sacrifice choice requires real movement toward a contestant, and surviving eliminates Kip and reopens clue progression. — test: `scripts/test-mr-feast-feast-says.mjs::touch-only landscape completion`
- [ ] User playtest confirms that the six-command order and timing are readable, the two psychological choices are understandable without contestant-to-direction mappings, the result dialogue lands before each warning, the Ballroom staging feels like a produced reality show, and the clue pause feels motivated rather than arbitrary. — verified by user playtest

## Exit condition

User explores for ten minutes or finds one major clue -> Mr. Feast calls Feast Says, additional clue progress waits, the player reports to the Ballroom and obeys only calls beginning with `Feast says`, including holding still through the right-step and crouch fake-outs, followed by look-and-Interact distrust and a real-movement sacrifice choice -> the lowest-score result eliminates Kip when the player survives -> Kip pleads, Mr. Feast answers, survivors return to their routines, and leaving the witnessed scene removes Kip offscreen and returns Mr. Feast to patrol while investigation remains open.

## Test plan

Create `scripts/test-mr-feast-feast-says.mjs` before implementation and run it red against the missing system. Add source-contract assertions for the tuning table, state machine, DOM, clue gate, save payload, diagnostics, and QA controls. Turn the focused suite green, then run syntax, renovation, opening-welcome, player-systems, contestant-conversations, seating/routines, workroom-code, basement-key, and full Contestant 13 regressions. Complete the live-iterate loop with text-state probes, real keyboard/touch input, console review, and desktop/mobile Ballroom screenshots.

## Notes

- The player-facing rule says to obey only commands beginning with `Feast says` and that the lowest score is eliminated; it never names a contestant to beat. Authored scoring preserves Kip as the first NPC elimination when the player survives, while a tie at the player-loss cutoff remains an elimination.
- The aftermath is witnessed but not a death reveal. Kip's disappearance is deliberately offscreen after a significant location/sightline break, preserving the later horror escalation while letting Mr. Feast resume the existing patrol and the survivors resume their ambient routines.
- Only the first discovery is allowed through before the call. Already-earned clues remain readable; only new progression is paused.
- Later competition milestones will add later investigation ceilings. This slice solves the immediate problem of clearing the full chain before competition one without inventing unapproved games two and three.
- The 2026-07-19 countdown-HUD refinement replaces the full dormant card with a compact inline strip across desktop, portrait phone, and short landscape. During live short-landscape commands, a two-column row places the 44 px Crouch action beside the command/timer, removes the redundant header and standings, and yields the location, Bag/Menu, Energy, Stealth, security, speech, and global Scores overlays. The card measures about 63 px at 568×320 and never blocks the lowered movement/interact controls.
- The authored distrust targets are Mara -> Kip, Kip -> Mara, and Juniper -> player. The authored elimination targets are Mara -> Kip, Kip -> player, and Juniper -> Mara. The show scores the act of choosing, not the target, so both subjective instructions remain fair and deterministic.
- The distrust prompt uses camera look plus E or touch Interact. The elimination prompt deliberately uses actual world-direction movement so it reads as stepping toward a person rather than selecting a disguised menu option.

## Verification

- `node --check assets/js/mr-feast-mansion.js`, `node --check scripts/test-mr-feast-feast-says.mjs`, `node scripts/test-mr-feast-feast-says.mjs`, and `git diff --check` passed on the final tree. The focused browser suite covers the exact six-call order, right-step and crouch fake-outs with correct stillness on desktop/touch, the sacrifice prompt, look-plus-Interact pointing, actual displacement-based approach, distinct NPC targets including the player, proportional planted poses, result banter/warning timing, Kip's visible upset pose and two-line aftermath, both survivor walk-backs and one-use debriefs, offscreen cleanup, save/loss/partial-cast recovery, compact portrait/landscape layouts, and zero unexpected console errors.
- `node scripts/test-mr-feast-renovation.mjs` and `node scripts/test-mr-feast-storm-run.mjs` passed after the aftermath/fake-out refinement, preserving the mansion source invariants and the post-Feast Game 2 eligibility, trigger, staging, race, and release handoff.
- Current adjacent passes: `test-mr-feast-renovation.mjs`, `test-mr-feast-storm-run.mjs`, `test-mr-feast-contestant-conversations.mjs`, `test-mr-feast-seating-and-routes.mjs`, `test-mr-feast-workroom-code-clue.mjs`, `test-mr-feast-basement-key-trail.mjs`, and the full desktop/mobile `test-mr-feast-contestant-13.mjs`. The story helpers now let each competition's short elimination card finish before asserting that the investigation HUD has handed back.
- The player-systems adjacent attempt still stopped at its existing fullscreen/maximize wait. A separate opening-welcome attempt timed out waiting for the optional host model's loaded flag; the focused Feast Says suite repeatedly staged the host and cast successfully, and neither timeout exposed a Feast Says assertion or browser error.
- Refreshed visual proof: `output/playwright/mr-feast-feast-says/{six-command-round-desktop,contestant-sidestep-left-desktop,contestant-sidestep-right-desktop,contestant-crouch-desktop,contestant-backpedal-desktop,contestant-point-desktop,contestant-approach-desktop,result-banter-point-desktop,result-warning-point-desktop,kip-elimination-aftermath,opening-command-landscape,opening-command-compact-landscape,six-command-complete-landscape,player-eliminated-desktop}.png`. The fake-out captures show the plain call plus `Remember the rule`, result bubbles clear the judgment card, and the aftermath capture shows Kip's slumped body beneath his plea without the duplicate discovery card obscuring him.
