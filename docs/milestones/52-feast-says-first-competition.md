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
- Six authored, psychologically coercive commands mixing genuine `Feast says ...` instructions with decoys. The player responds through existing movement and crouch controls, including a trust prompt that maps left/forward/right to Mara/Kip/Juniper without judging the chosen target.
- Challenge-only skeletal response motion for Mara, Kip, and Juniper: bent-knee crouches, walk-driven left/right sidesteps, backward gait, and target-facing point gestures, with an eased return between commands and synchronous release cleanup.
- A compact dormant countdown strip at desktop, portrait-phone, and short-landscape sizes; active command readability and touch targets remain unchanged.
- A round scoreboard, authored contestant performance, player success/failure, Kip's first-place-last elimination on a player win, and an `ELIMINATED` recovery modal when the player loses.
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
| `result` | player beats Kip after command six | `completed` |
| `result` | player fails to beat Kip after command six | `failed` |
| `failed` | load or restart | restored save or fresh `dormant` |

Invalid transition requests are reported in diagnostics and warned in QA.

## Acceptance criteria

- [x] A fresh run remains dormant before ten active exploration minutes; the opening welcome and existing pause surfaces do not consume the timer, and reaching ten minutes calls Feast Says exactly once. — test: `scripts/test-mr-feast-feast-says.mjs::ten-minute call and pause contract`
- [x] Reading the XIII book, taking the shovel first, or revealing a first Painting Room scratch calls the event immediately after preserving that discovery; subsequent undiscovered story interactions are paused until completion. — test: `scripts/test-mr-feast-feast-says.mjs::first-clue call and investigation pause`
- [x] The called-state HUD and Ballroom station clearly direct the player; reporting stages Mr. Feast, all three loaded contestants, the player, and four visible contestant marks without permanent teleports or seating reservations. — test: `scripts/test-mr-feast-feast-says.mjs::Ballroom staging`
- [x] Six authored rounds accept existing movement/crouch input, distinguish genuine commands from decoys, reset fairly between rounds, visibly animate contestant responses, and update an accessible scoreboard. — test: `scripts/test-mr-feast-feast-says.mjs::real command input and scoring`
- [x] Beating Kip completes the event, eliminates only Kip, releases the host and surviving contestants, and re-enables clue progression; failing to beat Kip opens a recoverable `ELIMINATED` game-over screen. — test: `scripts/test-mr-feast-feast-says.mjs::completion and elimination outcomes`
- [x] Explicit save/load preserves dormant elapsed time, called/completed state, and Kip's elimination; a transient briefing/command/result save restores as `called`. — test: `scripts/test-mr-feast-feast-says.mjs::save restore contract`
- [x] `render_game_to_text()` and focused QA controls expose phase, trigger, elapsed time, command, response time, scores, staged cast, clue lock, invalid transitions, and completion. — test: `scripts/test-mr-feast-feast-says.mjs::diagnostics and deterministic controls`
- [x] The call card, command card, timer, scoreboard, and recovery screen fit both 1280x820 and 390x844 without obscuring the required touch movement/interact controls. — test: `scripts/test-mr-feast-feast-says.mjs::desktop and phone presentation`
- [x] On 390×844, the dormant/called HUD collapses to a ≤58 px status strip and yields entirely to a visible investigation card; the active command card stays ≤126 px tall, retains ≥16 px command text and a ≥44 px crouch action, hides nonessential standings, and does not overlap Bag/Menu or lower controls. — tests: `scripts/test-mr-feast-player-systems.mjs::compact idle countdown` and `scripts/test-mr-feast-feast-says.mjs::compact active command card`
- [x] The dormant `NEXT LIVE EVENT` countdown is a ≤360×48 px strip on desktop and a ≤320×48 px strip at 844×390, with the timer rendered inline instead of inheriting the active challenge card. — test: `scripts/test-mr-feast-feast-says.mjs::compact dormant countdown`
- [x] The six-command deck includes the exact genuine instruction `Feast says point to the person you trust the least.` plus at least three other coercive distrust/sacrifice prompts; left/forward/right select Mara/Kip/Juniper, every named choice scores as obedience, and non-choice inputs fail that command. — test: `scripts/test-mr-feast-feast-says.mjs::psychological command deck and trust choice`
- [x] Contestant challenge responses use visible skeletal motion rather than root-only slides: crouch bends the lower body, left/right responses use walk-driven sidesteps while facing Mr. Feast, backward response uses a reversed walk cycle, and the point command raises an arm toward the authored target. Every response resets cleanly at the next command and on release. — test: `scripts/test-mr-feast-feast-says.mjs::contestant response motion`
- [x] At 844×390 and 568×320, every live command card stays ≤90 px tall, uses no more than 48% of the game stage, retains ≥16 px command text and a ≥44 px crouch target, and clears the visible movement and interaction controls. — test: `scripts/test-mr-feast-feast-says.mjs::compact landscape command cards`
- [x] A touch-only player can report to the Ballroom and complete all six authored commands in mobile landscape using the visible direction and crouch controls, correctly ignoring both decoys, qualifying over Kip, eliminating him, and reopening clue progression. — test: `scripts/test-mr-feast-feast-says.mjs::touch-only landscape completion`
- [ ] User playtest confirms that six commands are readable at normal speed, decoys feel fair, the Ballroom staging feels like a produced reality show, and the clue pause feels motivated rather than arbitrary. — verified by user playtest

## Exit condition

User explores for ten minutes or finds one major clue -> Mr. Feast calls Feast Says, additional clue progress waits, the player reports to the Ballroom and competes through six genuine/decoy commands, then beating Kip eliminates him and reopens the investigation.

## Test plan

Create `scripts/test-mr-feast-feast-says.mjs` before implementation and run it red against the missing system. Add source-contract assertions for the tuning table, state machine, DOM, clue gate, save payload, diagnostics, and QA controls. Turn the focused suite green, then run syntax, renovation, opening-welcome, player-systems, contestant-conversations, seating/routines, workroom-code, basement-key, and full Contestant 13 regressions. Complete the live-iterate loop with text-state probes, real keyboard/touch input, console review, and desktop/mobile Ballroom screenshots.

## Notes

- The player must beat Kip rather than merely tie him. Mara and Juniper's authored scores preserve the planned elimination order without making player input cosmetic.
- Only the first discovery is allowed through before the call. Already-earned clues remain readable; only new progression is paused.
- Later competition milestones will add later investigation ceilings. This slice solves the immediate problem of clearing the full chain before competition one without inventing unapproved games two and three.
- The 2026-07-19 countdown-HUD refinement replaces the full dormant card with a compact inline strip across desktop, portrait phone, and short landscape. During live short-landscape commands, a two-column row places the 44 px Crouch action beside the command/timer, removes the redundant header and standings, and yields the location, Bag/Menu, Energy, Stealth, security, speech, and global Scores overlays. The card measures about 63 px at 568×320 and never blocks the lowered movement/interact controls.
- The follow-up trust prompt reuses the existing movement controls: `A`/left chooses Mara, `W`/forward chooses Kip, and `D`/right chooses Juniper. The show scores the act of choosing, not the target, so the subjective instruction remains fair and deterministic.

## Verification

- `node --check assets/js/mr-feast-mansion.js` and `node --check scripts/test-mr-feast-feast-says.mjs` — passed.
- `node scripts/test-mr-feast-feast-says.mjs` — passed the post-welcome ten-minute boundary, Escape-menu pause, book/shovel/scratch first-clue calls, combined clue/call feedback, clue-carrier and housekeeping holds, real Ballroom E/touch reporting, movement locks, compact and control-safe dormant countdowns, ≤90 px live command cards at 844×390 and 568×320, auxiliary-HUD yielding, the exact trust prompt and target mapping, and a touch-only landscape completion using the visible right/left/crouch/back controls plus both decoy holds. The mobile player finished 6–0, eliminated Kip, and reopened clue progression; the suite also retained coercive command, contestant-motion, save/restore, loss/recovery, accessibility, fallback, and zero-console-error coverage.
- Adjacent suites passed `test-mr-feast-renovation.mjs`, `test-mr-feast-seating-and-routes.mjs`, `test-mr-feast-workroom-code-clue.mjs`, `test-mr-feast-basement-key-trail.mjs`, and `test-mr-feast-contestant-13.mjs`; the final seating/routines and full Contestant 13 reruns passed against the completed response-motion runtime.
- `test-mr-feast-player-systems.mjs` still stops at its known unrelated fullscreen/maximize wait at line 168, before reaching its phone section. The focused Feast Says suite now directly covers the portrait dormant countdown, active command card, and real touch choice instead.
- Visual proof: `output/playwright/mr-feast-feast-says/{dormant-countdown-landscape,point-command-landscape,point-command-compact-landscape,six-command-complete-landscape,timer-call-desktop,six-command-round-desktop,contestant-point-desktop,contestant-sidestep-left-desktop,contestant-sidestep-right-desktop,contestant-crouch-desktop,contestant-backpedal-desktop,point-command-mobile,six-command-round-mobile,player-eliminated-desktop}.png` plus `output/iterate/feast-says-cast-framing.png`.
