# Milestone 54: Storm Run Second Competition

## Status

Implemented — automated acceptance complete; user playtest pending

## Objective

Add the mansion's second sanctioned reality-show competition as a readable, non-backtracking checkpoint race across the existing grounds. Storm Run becomes eligible only after Feast Says is complete, then calls the player after ten active exploration minutes or immediately after the next newly earned major clue. The triggering clue remains earned, further investigation pauses, and the player must outrun Mara through twelve ordered breadcrumb checkpoints while two close lightning bolts briefly reveal Mr. Feast dead ahead in deep shadow.

## Scope

- One authoritative `STORM_RUN` tuning table and explicit event state machine.
- A ten-minute active-exploration timer beginning at Feast Says completion and pausing with existing game pause surfaces.
- An early call on the first newly earned major clue after Feast Says, preserving that discovery before later clue progression pauses.
- A physical report/start station on the rear terrace and twelve ordered checkpoints distributed across the formal garden, front grounds, east lawn, hedge-maze interior, rear grounds, and pool terrace. After checkpoint one the route continues north through the garden's verified east clearance, crosses its front edge, and uses a carriage-turn marker to reach the front drive without returning toward the start. Every active marker uses a tall blue beacon and raised guide configured to remain visible from the previous checkpoint, with no leg longer than 32 metres.
- A real player race using existing movement, sprint, stamina, collision, and mobile controls.
- Mara and Juniper visibly running the authored course with their existing compatible source run motions reduced through the checked-in stationary-animation extractor. Their measured world speed must remain below the player's maximum sprint speed.
- Exactly two authored lightning scares, at the front drive and inside a straight hedge-maze corridor. Each places Mr. Feast `4.5–5m` dead ahead under the player's natural incoming yaw with measured `0.05` baseline exposure and an unobstructed ray to his torso. A dedicated close-bolt profile uses a sharp procedural crack, a `1.7x` recorded roll after `0.02s`, a `1.35x` flash, and `1.55x` exterior light multiplier. He disappears as soon as the flash goes dark and no later than `1.2s`. Ordinary ambient lightning is unchanged, and neither profile has collision, damage, stun, slowdown, or a time penalty.
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
| `running` | player reaches checkpoint twelve before Mara | `completed` |
| `running` | Mara reaches checkpoint twelve before player | `failed` |
| `failed` | load or restart | restored save or fresh `dormant` |

## Acceptance criteria

- [x] Storm Run cannot count down or trigger before Feast Says completes. After completion it calls exactly once at ten active exploration minutes, while the menu and other existing pause surfaces stop the clock. — test: `scripts/test-mr-feast-storm-run.mjs::post-Feast timer contract`
- [x] The first newly earned major clue after Feast Says calls Storm Run immediately while preserving that clue's discovery feedback; subsequent undiscovered story interactions pause until the race resolves. — test: `scripts/test-mr-feast-storm-run.mjs::next-clue call and investigation hold`
- [x] Reporting at the rear-terrace station stages the player, Mara, Juniper, and Mr. Feast, then begins one readable countdown without restoring eliminated Kip. — test: `scripts/test-mr-feast-storm-run.mjs::start-line staging`
- [x] Twelve physical breadcrumb checkpoints must be crossed in order and span at least seven named grounds regions, with exactly one marker inside a walkable hedge-maze cell. After checkpoint one, the next two markers continue north through the garden's real player-capsule clearance before its front-edge exit and carriage turn; the route cannot double back toward the start, and touching markers out of order cannot advance progress. — test: `scripts/test-mr-feast-storm-run.mjs::ordered collision-clear yard course`
- [x] From the start line and every collected checkpoint, the next active marker's raised guide projects on-screen, remains readable through hedge occlusion, and sits no more than 32 metres away. The player never has to follow an NPC to infer the route. — test: `scripts/test-mr-feast-storm-run.mjs::visible breadcrumb chain`
- [x] Mara and Juniper visibly traverse the authored course with a challenge-only run animation, report `running` activity and nonzero animation playback, never teleport between route points, and never exceed their stamina-fair configured speeds of `2.4` and `2.5 m/s` or the player's `3.75 m/s` sprint speed. — test: `scripts/test-mr-feast-storm-run.mjs::contestant run contract`
- [x] Approaching the front-drive and maze checkpoints automatically triggers exactly two authored scares. Under the player's natural incoming yaw, each reveal is centered, projects at readable size from `4.5–5m`, has an unobstructed occluder ray, and measures `0.05` baseline exposure. A brighter close-bolt flash lights the surrounding space while an immediate sharp crack and `1.7x` recorded roll land together; Mr. Feast becomes invisible exactly when the flash returns to zero and no later than `1.2s`. The event exposes no damaging or penalizing lightning hazard and leaves ordinary ambient storms unchanged. — test: `scripts/test-mr-feast-storm-run.mjs::unmissable close-bolt scares`
- [x] Reaching checkpoint twelve before Mara completes the event, eliminates only Mara, releases Juniper and Mr. Feast, and reopens investigation; Mara finishing first produces a recoverable `ELIMINATED` screen for the player. — test: `scripts/test-mr-feast-storm-run.mjs::race outcomes`
- [x] Explicit save/load preserves dormant elapsed time, called/completed state, and Mara's elimination; briefing/running saves normalize to `called`. — test: `scripts/test-mr-feast-storm-run.mjs::save restore contract`
- [x] `render_game_to_text()` and focused QA controls expose phase, trigger, elapsed time, current checkpoint, all checkpoint regions, per-leg guidance distance/visibility, contestant distance/progress/speed/animation, lightning reveal state, investigation lock, and outcome. — test: `scripts/test-mr-feast-storm-run.mjs::diagnostics and QA controls`
- [x] The called, countdown, running, checkpoint, standings, and result HUD fit 1280x820 and 390x844 while leaving touch movement, sprint, interact, and menu controls usable. — test: `scripts/test-mr-feast-storm-run.mjs::desktop and phone presentation`
- [ ] User playtest confirms that the yard-spanning route is readable without a minimap, the contestants visibly read as running without feeling unfairly fast, and the Mr. Feast lightning appearances are startling without becoming repetitive. — verified by user playtest

## Implementation and verification

- Added the authoritative Storm Run state machine, post-Feast timer and next-clue scheduler, shared investigation ceiling, rear-terrace report station, twelve ordered breadcrumb markers, race outcomes, save normalization, diagnostics, and deterministic QA controls.
- Added stationary 24-bone run clips for Mara and Juniper. Their tuned `2.4` and `2.5 m/s` world speeds remain below the player's sprint maximum and permit stamina recovery; live diagnostics pin observed speed and reject race teleports.
- The original landmarks are connected by intermediate markers that now form one clean loop. Checkpoint one sits in the formal garden's rear-east lane; the next two continue north at `x=-17.2`, clear the fountain and bed borders with the full player capsule, cross the garden's north edge, and force a front-carriage turn before the drive. Each active checkpoint combines the physical ground ring with a `4.4m` blue beam and raised depth-independent diamond, and focused QA proves all twelve guides are on-screen from the prior marker.
- The apparition count is reduced from three to exactly two. The front-drive trigger/reveal pair is `(0,19.5) → (0,24.5)` and the maze pair is `(28,8.75) → (28,4.25)`; both measure `0.05` baseline exposure, sit dead ahead under the real incoming yaw, and have clear occluder rays. Storm Run owns the stronger/longer flash, close crack plus `1.7x` roll, and `1.2s` hard cap while ambient lightning retains its original profile.
- Review fixes keep an active pursuit or camera response from leaking into the live-event call, delay the maze scare until the player enters its visible corridor, preserve the sprint-energy meter, report checkpoint counts instead of a false fixed ranking, and prevent clue/timer/result HUD overlap.
- `scripts/test-mr-feast-storm-run.mjs`, the full Feast Says suite, renovation invariants, player systems, Workroom scratches, basement trail, Contestant 13, contestant conversations, and seating/routines all pass. Syntax and `git diff --check` pass.
- Visual proof: `output/playwright/mr-feast-storm-run/storm-run-visible-checkpoint-chain-desktop.png`, `mr-feast-dark-lightning-reveal-desktop.png`, `mr-feast-front-dark-after-reveal-desktop.png`, `mr-feast-maze-lightning-reveal-desktop.png`, `mr-feast-maze-dark-after-reveal-desktop.png`, and `storm-run-mobile.png`.

## Exit condition

User completes Feast Says, explores for ten minutes or earns the next clue, reports to the rear terrace, follows twelve mutually visible ordered yard checkpoints north through the garden and around the front without backtracking, sees Mr. Feast unmistakably appear dead ahead during exactly two close lightning bolts and vanish with their darkness, and reaches the finish before Mara to eliminate her and reopen investigation.

## Test plan

Create `scripts/test-mr-feast-storm-run.mjs` before implementation and run it red against the missing system. Cover the timer boundary, next-clue trigger, progression hold, physical report interaction, ordered checkpoints, real contestant movement and run animation, player-relative speed cap, non-hazard lightning reveals, both outcomes, persistence, diagnostics, console output, and desktop/mobile geometry. Turn the focused suite green, then run syntax, Feast Says, player movement, Workroom, basement-key, and Contestant 13 regressions plus the live iterate loop.
