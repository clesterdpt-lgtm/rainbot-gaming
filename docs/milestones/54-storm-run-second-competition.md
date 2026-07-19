# Milestone 54: Storm Run Second Competition

## Status

Implemented — automated acceptance complete; user playtest pending

## Objective

Add the mansion's second sanctioned reality-show competition as a readable checkpoint race across the existing grounds. Storm Run becomes eligible only after Feast Says is complete, then calls the player after ten active exploration minutes or immediately after the next newly earned major clue. The triggering clue remains earned, further investigation pauses, and the player must outrun Mara through five ordered yard checkpoints while lightning briefly reveals Mr. Feast near selected course markers.

## Scope

- One authoritative `STORM_RUN` tuning table and explicit event state machine.
- A ten-minute active-exploration timer beginning at Feast Says completion and pausing with existing game pause surfaces.
- An early call on the first newly earned major clue after Feast Says, preserving that discovery before later clue progression pauses.
- A physical report/start station on the rear terrace and five ordered checkpoints distributed across the rear grounds, formal garden, front grounds, east lawn, and hedge-maze interior.
- A real player race using existing movement, sprint, stamina, collision, and mobile controls.
- Mara and Juniper visibly running the authored course with their existing compatible source run motions reduced through the checked-in stationary-animation extractor. Their measured world speed must remain below the player's maximum sprint speed.
- Authored lightning scares near selected checkpoints: Mr. Feast appears only during the flash and disappears with it. Lightning has no collision, damage, stun, slowdown, or time penalty.
- Race HUD, checkpoint feedback, contestant progress, result handling, Mara elimination on a player win, and recoverable player elimination on a loss.
- Save/load persistence for the countdown, called/completed state, and Mara elimination. Mid-race saves restore to the clean report call.
- Deterministic diagnostics and QA controls through `render_game_to_text()` and `window.MrFeastFresh`.

## Out of scope

- Lightning strike hazards, physics debris, falling trees, mud slowdown, knockback, damage, or ragdolls.
- Dynamic course generation, branching routes, a rearranging maze, or navigation AI.
- New character generation, rerigging, animation authoring, or external asset services.
- The previously drafted Lights Out competition, Game 3, Mara's death scene, or elimination-dinner aftermath.

## Dependencies

- **Depends on:** Milestone 35 player sprint/stamina, Milestone 44 storm audio, Milestone 47 contestant cast, Milestone 48 contestant locomotion, Milestone 52 Feast Says
- **Blocks:** later investigation ceiling and Game 3 milestones

## State graph

| From | Event | To |
|---|---|---|
| `dormant` | Feast Says complete, then ten active minutes or next major clue | `called` |
| `called` | player reports at rear-terrace start station | `briefing` |
| `briefing` | countdown expires | `running` |
| `running` | player reaches checkpoint five before Mara | `completed` |
| `running` | Mara reaches checkpoint five before player | `failed` |
| `failed` | load or restart | restored save or fresh `dormant` |

## Acceptance criteria

- [x] Storm Run cannot count down or trigger before Feast Says completes. After completion it calls exactly once at ten active exploration minutes, while the menu and other existing pause surfaces stop the clock. — test: `scripts/test-mr-feast-storm-run.mjs::post-Feast timer contract`
- [x] The first newly earned major clue after Feast Says calls Storm Run immediately while preserving that clue's discovery feedback; subsequent undiscovered story interactions pause until the race resolves. — test: `scripts/test-mr-feast-storm-run.mjs::next-clue call and investigation hold`
- [x] Reporting at the rear-terrace station stages the player, Mara, Juniper, and Mr. Feast, then begins one readable countdown without restoring eliminated Kip. — test: `scripts/test-mr-feast-storm-run.mjs::start-line staging`
- [x] Five physical checkpoints must be crossed in order and occupy five distinct grounds regions, with exactly one marker inside a walkable hedge-maze cell; touching markers out of order cannot advance progress. — test: `scripts/test-mr-feast-storm-run.mjs::ordered yard course`
- [x] Mara and Juniper visibly traverse the authored course with a challenge-only run animation, report `running` activity and nonzero animation playback, never teleport between route points, and never exceed the player's `3.75 m/s` sprint speed. — test: `scripts/test-mr-feast-storm-run.mjs::contestant run contract`
- [x] Approaching selected active checkpoints triggers an authored storm flash that reveals Mr. Feast only during visible lightning, then hides him again; the event exposes no damaging or penalizing lightning hazard. — test: `scripts/test-mr-feast-storm-run.mjs::lightning reveal scare`
- [x] Reaching checkpoint five before Mara completes the event, eliminates only Mara, releases Juniper and Mr. Feast, and reopens investigation; Mara finishing first produces a recoverable `ELIMINATED` screen for the player. — test: `scripts/test-mr-feast-storm-run.mjs::race outcomes`
- [x] Explicit save/load preserves dormant elapsed time, called/completed state, and Mara's elimination; briefing/running saves normalize to `called`. — test: `scripts/test-mr-feast-storm-run.mjs::save restore contract`
- [x] `render_game_to_text()` and focused QA controls expose phase, trigger, elapsed time, current checkpoint, all checkpoint regions, contestant distance/progress/speed/animation, lightning reveal state, investigation lock, and outcome. — test: `scripts/test-mr-feast-storm-run.mjs::diagnostics and QA controls`
- [x] The called, countdown, running, checkpoint, standings, and result HUD fit 1280x820 and 390x844 while leaving touch movement, sprint, interact, and menu controls usable. — test: `scripts/test-mr-feast-storm-run.mjs::desktop and phone presentation`
- [ ] User playtest confirms that the yard-spanning route is readable without a minimap, the contestants visibly read as running without feeling unfairly fast, and the Mr. Feast lightning appearances are startling without becoming repetitive. — verified by user playtest

## Implementation and verification

- Added the authoritative Storm Run state machine, post-Feast timer and next-clue scheduler, shared investigation ceiling, rear-terrace report station, five ordered course markers, race outcomes, save normalization, diagnostics, and deterministic QA controls.
- Added stationary 24-bone run clips for Mara and Juniper. Both authored world speeds remain below the player's sprint maximum; live diagnostics pin observed speed and reject race teleports.
- Review fixes keep an active pursuit or camera response from leaking into the live-event call, delay the maze scare until the player enters its visible corridor, preserve the sprint-energy meter, report checkpoint counts instead of a false fixed ranking, and prevent clue/timer/result HUD overlap.
- `scripts/test-mr-feast-storm-run.mjs`, the full Feast Says suite, renovation invariants, player systems, Workroom scratches, basement trail, Contestant 13, contestant conversations, and seating/routines all pass. Syntax and `git diff --check` pass.
- Visual proof: `output/playwright/mr-feast-storm-run/mr-feast-lightning-reveal-desktop.png` and `output/playwright/mr-feast-storm-run/storm-run-mobile.png`.

## Exit condition

User completes Feast Says, explores for ten minutes or earns the next clue, reports to the rear terrace, races through five ordered yard checkpoints including the hedge maze, sees Mr. Feast appear only in authored lightning flashes, and reaches the finish before Mara to eliminate her and reopen investigation.

## Test plan

Create `scripts/test-mr-feast-storm-run.mjs` before implementation and run it red against the missing system. Cover the timer boundary, next-clue trigger, progression hold, physical report interaction, ordered checkpoints, real contestant movement and run animation, player-relative speed cap, non-hazard lightning reveals, both outcomes, persistence, diagnostics, console output, and desktop/mobile geometry. Turn the focused suite green, then run syntax, Feast Says, player movement, Workroom, basement-key, and Contestant 13 regressions plus the live iterate loop.
