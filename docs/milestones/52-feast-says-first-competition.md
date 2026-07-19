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
- Six authored commands mixing genuine `Feast says ...` instructions with decoys. The player responds through existing movement and crouch controls while Mara, Kip, and Juniper visibly compete.
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
- [ ] User playtest confirms that six commands are readable at normal speed, decoys feel fair, the Ballroom staging feels like a produced reality show, and the clue pause feels motivated rather than arbitrary. — verified by user playtest

## Exit condition

User explores for ten minutes or finds one major clue -> Mr. Feast calls Feast Says, additional clue progress waits, the player reports to the Ballroom and competes through six genuine/decoy commands, then beating Kip eliminates him and reopens the investigation.

## Test plan

Create `scripts/test-mr-feast-feast-says.mjs` before implementation and run it red against the missing system. Add source-contract assertions for the tuning table, state machine, DOM, clue gate, save payload, diagnostics, and QA controls. Turn the focused suite green, then run syntax, renovation, opening-welcome, player-systems, contestant-conversations, seating/routines, workroom-code, basement-key, and full Contestant 13 regressions. Complete the live-iterate loop with text-state probes, real keyboard/touch input, console review, and desktop/mobile Ballroom screenshots.

## Notes

- The player must beat Kip rather than merely tie him. Mara and Juniper's authored scores preserve the planned elimination order without making player input cosmetic.
- Only the first discovery is allowed through before the call. Already-earned clues remain readable; only new progression is paused.
- Later competition milestones will add later investigation ceilings. This slice solves the immediate problem of clearing the full chain before competition one without inventing unapproved games two and three.
- The 2026-07-19 phone-HUD refinement replaces the full dormant card with a compact countdown strip, removes round standings from the active phone card, and preserves only the command, timer, score, and touch action at full readability.

## Verification

- `node --check assets/js/mr-feast-mansion.js` and `node --check scripts/test-mr-feast-feast-says.mjs` — passed.
- `node scripts/test-mr-feast-feast-says.mjs` — passed the post-welcome ten-minute boundary, Escape-menu pause, book/shovel/scratch first-clue calls, combined clue/call feedback, clue-carrier and housekeeping holds, real Ballroom E/touch reporting, movement locks, visibly eased contestant actions, six-command win/loss scoring, Kip interaction removal, recoverable player elimination, dormant/called/transient/completed save restores, partial-cast fallback, stable live regions, desktop/phone geometry, and zero unexpected console errors.
- Adjacent suites passed `test-mr-feast-renovation.mjs`, `test-mr-feast-workroom-code-clue.mjs`, `test-mr-feast-basement-key-trail.mjs`, and `test-mr-feast-contestant-13.mjs` after their first-clue expectations were updated to complete Feast Says before resuming later story checks.
- Visual proof: `output/playwright/mr-feast-feast-says/{timer-call-desktop,six-command-round-desktop,six-command-round-mobile,player-eliminated-desktop}.png` plus `output/iterate/feast-says-cast-framing.png`.
