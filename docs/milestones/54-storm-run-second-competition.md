# Milestone 54: Storm Run Second Competition

## Status

Implemented — automated acceptance complete; user playtest pending

## Objective

Add the mansion's second sanctioned reality-show competition as a readable, non-backtracking checkpoint race across the existing grounds. Storm Run becomes eligible only after Feast Says is complete, then calls the player after ten active exploration minutes or immediately after the next newly earned major clue. The triggering clue remains earned, further investigation pauses, and the player must hear Mr. Feast explain the rules at the back door before outrunning Mara through twelve ordered breadcrumb checkpoints while two close lightning bolts briefly reveal him in deep shadow.

## Scope

- One authoritative `STORM_RUN` tuning table and explicit event state machine.
- A ten-minute active-exploration timer beginning at Feast Says completion and pausing with existing game pause surfaces.
- An early call on the first newly earned major clue after Feast Says, preserving that discovery before later clue progression pauses.
- A physical report/start station on the rear terrace, a movement-locked rear-door briefing with Mr. Feast visibly explaining the rules, an audible `3–2–1–GO`, and a west-facing race release. Twelve ordered checkpoints are distributed across the formal garden, front grounds, east lawn, hedge-maze interior, rear grounds, and pool terrace. After checkpoint one the route continues north through the garden's verified east clearance, crosses its front edge, and uses a carriage-turn marker to reach the front drive without returning toward the start. Every active marker uses a tall blue beacon, a raised guide configured to remain visible from the previous checkpoint, and a dedicated collection chime, with no leg longer than 32 metres.
- A real player race using existing movement, sprint, stamina, collision, and mobile controls.
- Mara and Juniper visibly running the authored course with their existing compatible source run motions reduced through the checked-in stationary-animation extractor. Their measured world speed must remain below the player's maximum sprint speed.
- Exactly two authored lightning scares: the first among the front-lawn trees after the driveway checkpoint, with trigger coverage for both the direct checkpoint-six-to-seven diagonal and the carriage-path approach, and the second inside a straight hedge-maze corridor. Each places Mr. Feast at readable size under the player's natural incoming yaw with measured deep-shadow exposure and an unobstructed ray to his torso. A dedicated scare sting and close-bolt profile use a sharp procedural crack, a `1.7x` recorded roll after `0.02s`, a `1.35x` flash, and `1.55x` exterior light multiplier. He disappears as soon as the flash goes dark and no later than `1.2s`.
- A minimal race status strip showing only event, checkpoint count, and elapsed time. Mr. Feast's speech carries only the briefing, countdown, `Run!`, and outcomes; glowing beacons and collection chimes provide all checkpoint guidance.
- A localized north-maze phone-readability refinement that selects the nearer entrance lamp and an existing row-three wayfinding lamp inside the unchanged six-spot grounds budget. The first bend must measure at least `0.16` light exposure and the phone canvas at least `0.035` luminance without lifting the second apparition out of deep shadow.
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
- [x] Reporting at the rear-terrace station holds the player facing Mr. Feast at the back door while he explains the checkpoint and elimination rules, stages Mara and Juniper without restoring eliminated Kip, plays one audible `3–2–1–GO`, then releases the player facing west toward checkpoint one. — test: `scripts/test-mr-feast-storm-run.mjs::rear-door briefing and start-line staging`
- [x] Twelve physical breadcrumb checkpoints must be crossed in order and span at least seven named grounds regions, with exactly one marker inside a walkable hedge-maze cell. After checkpoint one, the next two markers continue north through the garden's real player-capsule clearance before its front-edge exit and carriage turn; the route cannot double back toward the start, and touching markers out of order cannot advance progress. — test: `scripts/test-mr-feast-storm-run.mjs::ordered collision-clear yard course`
- [x] From the start line and every collected checkpoint, the next raised guide projects on-screen, remains readable through hedge occlusion, sits no more than 32 metres away, and emits a dedicated chime when collected. Mr. Feast says only `Run!` at release and never announces a checkpoint or landmark. — test: `scripts/test-mr-feast-storm-run.mjs::visual-only breadcrumb chain`
- [x] Mara and Juniper visibly traverse the authored course with a challenge-only run animation, report `running` activity and nonzero animation playback, never teleport between route points, and never exceed their stamina-fair configured speeds of `2.4` and `2.5 m/s` or the player's `3.75 m/s` sprint speed. — test: `scripts/test-mr-feast-storm-run.mjs::contestant run contract`
- [x] After the driveway checkpoint, both the natural diagonal and carriage-path approaches to checkpoint seven automatically reveal Mr. Feast among the front trees; entering the authored maze corridor triggers the second and final scare. Desktop and portrait-phone cameras keep the first reveal on-screen at readable size. Each close bolt retains the sting, immediate crack, `1.7x` recorded roll, deep-shadow start, darkness-synced disappearance, and zero gameplay penalty. — test: `scripts/test-mr-feast-storm-run.mjs::natural-route desktop and phone scares`
- [x] At 390×844, the north entrance and first maze bend keep the localized row-three and nearer entrance fixtures active within the unchanged fixed light budget. Three route samples stay at or above `0.16` exposure and the rendered canvas stays at or above `0.035` luminance, while the maze apparition remains below its `0.12` deep-shadow cap. — test: `scripts/test-mr-feast-storm-run.mjs::north-maze phone luminance`
- [x] Reaching checkpoint twelve before Mara completes the event, eliminates only Mara, releases Juniper and Mr. Feast, and reopens investigation; Mara finishing first produces a recoverable `ELIMINATED` screen for the player. — test: `scripts/test-mr-feast-storm-run.mjs::race outcomes`
- [x] Explicit save/load preserves dormant elapsed time, called/completed state, and Mara's elimination; briefing/running saves normalize to `called`. — test: `scripts/test-mr-feast-storm-run.mjs::save restore contract`
- [x] `render_game_to_text()` and focused QA controls expose phase, trigger, elapsed time, current checkpoint, all checkpoint regions, per-leg guidance distance/visibility, contestant distance/progress/speed/animation, lightning reveal state, investigation lock, and outcome. — test: `scripts/test-mr-feast-storm-run.mjs::diagnostics and QA controls`
- [x] At 1280×820 and 390×844, Mr. Feast's briefing, spoken `3–2–1`, plain `Run!`, and outcome remain visible alongside a ≤58 px event/progress/time strip. No checkpoint announcement, written direction, or standings appear, and touch movement, Sprint, Interact, Bag, and Menu remain clear. — test: `scripts/test-mr-feast-storm-run.mjs::visual-led desktop and phone presentation`
- [ ] User playtest confirms that the yard-spanning route is readable without a minimap, the contestants visibly read as running without feeling unfairly fast, and the Mr. Feast lightning appearances are startling without becoming repetitive. — verified by user playtest

## Implementation and verification

- Added the authoritative Storm Run state machine, post-Feast timer and next-clue scheduler, shared investigation ceiling, rear-terrace report station, twelve ordered breadcrumb markers, race outcomes, save normalization, diagnostics, and deterministic QA controls.
- Added stationary 24-bone run clips for Mara and Juniper. Their tuned `2.4` and `2.5 m/s` world speeds remain below the player's sprint maximum and permit stamina recovery; live diagnostics pin observed speed and reject race teleports.
- The original landmarks are connected by intermediate markers that now form one clean loop. Checkpoint one sits in the formal garden's rear-east lane; the next two continue north at `x=-17.2`, clear the fountain and bed borders with the full player capsule, cross the garden's north edge, and force a front-carriage turn before the drive. Each active checkpoint combines the physical ground ring with a `4.4m` blue beam and raised depth-independent diamond, and focused QA proves all twelve guides are on-screen from the prior marker.
- The rear-door start separates a north-facing briefing pose from the west-facing race release. Mr. Feast delivers the rules and spoken `3–2–1`, then says only `Run!`; the checkpoint-announcement path and all twelve landmark lines are removed. The minimal strip keeps only progress and time, while the existing chimes and physical beacons carry all route feedback.
- The apparition count remains exactly two. The first reveal stays at `(16.2,20)` among the front trees, but two approach zones now cover the natural diagonal near `(7.3,23.65)` and the carriage path near `(7.2,16.3)`; the maze pair remains `(28,8.75) → (28,4.25)`. Browser QA follows the actual checkpoint-six-to-seven line on desktop and phone instead of teleporting only into the trigger. Both scares retain their deep-shadow, clear-ray, close-bolt, and `1.2s` disappearance contracts.
- North-maze readability now spends the same six exterior spot slots more usefully: the nearer entrance lamp replaces its far-side mate and `maze-wayfinding-lamp-3` replaces the row-eleven selection. The formerly dark first bend rises from `0.051` to `0.282` measured exposure; the phone proof crop measures `0.118` luminance.
- Review fixes keep an active pursuit or camera response from leaking into the live-event call, delay the maze scare until the player enters its visible corridor, preserve the sprint-energy meter, report checkpoint counts instead of a false fixed ranking, and prevent clue/timer/result HUD overlap.
- `scripts/test-mr-feast-storm-run.mjs`, the full Feast Says suite, renovation invariants, player systems, Workroom scratches, basement trail, Contestant 13, contestant conversations, and seating/routines all pass. Syntax and `git diff --check` pass.
- Visual proof adds `mr-feast-tree-line-lightning-reveal-mobile.png` for the real diagonal trigger and `hedge-maze-north-mobile.png` for the brighter north route, alongside the existing desktop briefing, breadcrumb, both-scare, darkness-return, and phone-layout captures.

## Exit condition

User completes Feast Says, explores for ten minutes or earns the next clue, reports to the rear terrace, hears Mr. Feast explain the race from the back door followed by an audible `3–2–1–GO`, and releases facing west. The player follows twelve mutually visible and audibly confirmed ordered yard checkpoints north through the garden and around the front without backtracking, sees Mr. Feast unmistakably appear among the post-driveway trees and inside the maze during exactly two close lightning bolts with scare stings, watches him vanish with their darkness, and reaches the finish before Mara to eliminate her and reopen investigation.

## Test plan

Create `scripts/test-mr-feast-storm-run.mjs` before implementation and run it red against the missing system. Cover the timer boundary, next-clue trigger, progression hold, physical report interaction, ordered checkpoints, real contestant movement and run animation, player-relative speed cap, non-hazard lightning reveals, both outcomes, persistence, diagnostics, console output, and desktop/mobile geometry. Turn the focused suite green, then run syntax, Feast Says, player movement, Workroom, basement-key, and Contestant 13 regressions plus the live iterate loop.
