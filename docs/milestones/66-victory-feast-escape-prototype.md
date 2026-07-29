# Milestone 66: Victory Feast Escape Prototype

## Status

Implementation and automated acceptance complete; user story/pressure playtest remains.

## Objective

Turn the player’s Feast Hunt victory into the opening movement of the mansion finale. Mr. Feast congratulates the winner, calls them to a camera-covered Victory Feast after five minutes, reveals that Contestant 13 and the clue trail were manufactured parts of the show, then kills the house lights. A lightning flash exposes the Banquet Saint in the Dining Room corner and releases the player into a first playable escape phase built from the mansion’s existing cameras, pursuit, crouch, flashlight, and hiding systems.

## Scope

- Call the Victory Feast exactly once after a player Feast Hunt victory.
- Give the player a five-minute Dining Room report countdown and a clear spoken call from Mr. Feast.
- Stage Mr. Feast, multiple production cameras, and a large feast spread in the Dining Room.
- Deliver complete readable dialogue revealing that Contestant 13 never existed and the clue trail was part of the game.
- Black out every interior light circuit only after the dialogue completes while leaving cameras hostile and operational.
- Lazy-load the existing Banquet Saint outside Developer Mode and reveal it in a Dining Room corner during one authored lightning flash.
- Release ordinary movement into a first escape phase where Mr. Feast, cameras, the Saint, and existing hiding spots create immediate pressure.
- Let a collected flashlight stun the Saint while giving the finale-only flashlight two deterministic defect modes: brief stuttering and a complete give-out.
- Preserve focused diagnostics, deterministic QA controls, replay-safe save normalization, and desktop/mobile presentation.

## Out of scope

- Workroom sabotage, additional sabotage targets, front-gate unlocking, or a completed escape/win ending.
- A new navigation mesh or full systemic Saint pathfinder. This first slice may use a short authored glide/chase route, but it must remain physical and consequential.
- New demon generation, rigging, or animation assets.
- Rewriting or deleting previously earned Contestant 13 Bag entries.
- Replacing the existing captured-at-dinner loss tableau.
- Voice acting, cinematics, combat, damage, batteries, or flashlight upgrades.

## Dependencies

- **Depends on:** Milestone 50 front-door host speech; Milestone 56 flashlight; Milestone 57 pursuit evasion; Milestone 59 Feast Hunt; Milestone 62 curtain hiding; Milestone 63 shared light circuits; Milestone 65 Banquet Saint.
- **Blocks:** Workroom sabotage, gate escape, and final ending milestones.

## Acceptance criteria

- [x] A player Feast Hunt victory calls Victory Feast exactly once with a `300s` report countdown. Mr. Feast congratulates the player for winning all three games and directs them to the Dining Room in five minutes for cameras and a celebration feast. Incomplete or failed Game 3 states do not call it. — test: `scripts/test-mr-feast-victory-feast.mjs::Game 3 handoff and five-minute call`
- [x] Blocking UI pauses the called countdown, and an explicit save/load preserves its exact remaining time. The player begins the event through a real E/touch Dining Room report interaction. — test: `scripts/test-mr-feast-victory-feast.mjs::called timer, persistence, and physical report`
- [x] Reporting stages the player face-to-face with Mr. Feast, locks movement for the dialogue, keeps at least two production cameras trained on the host/winner marks, and fills the Dining table with a large multi-dish spread that adds no gameplay colliders or blocked host sightline. — test: `scripts/test-mr-feast-victory-feast.mjs::Dining Room production feast`
- [x] Mr. Feast’s complete transcript explicitly reveals that Contestant Thirteen never existed, the XIII book/tape/warnings were planted by production, following the trail was part of the game, and the winner now faces a final survival challenge. The reveal does not remove or duplicate earned Bag entries. — test: `scripts/test-mr-feast-victory-feast.mjs::fake Contestant 13 reveal`
- [x] The final dialogue line blacks out every interior light circuit, rejects ordinary switch relighting, and leaves the camera network operational and hostile. Loading or resetting out of the finale restores the pre-feast circuit state. — test: `scripts/test-mr-feast-victory-feast.mjs::finale blackout and live cameras`
- [x] The Banquet Saint remains unloaded during ordinary play, then lazy-loads without enabling Developer Mode. One deterministic lightning flash reveals it grounded, unobstructed, and readable in an authored Dining Room corner; it neither appears early nor repeats the reveal. — test: `scripts/test-mr-feast-victory-feast.mjs::lightning Saint corner reveal`
- [x] After the flash, ordinary sprint, crouch, camera acquisition, Mr. Feast pursuit, and existing hiding remain authoritative. The Saint uses a small physical first-slice threat loop without teleporting. Existing hiding switches off the flashlight, blocks camera acquisition, prevents a silent hidden Saint catch, and lets Mr. Feast lose the player through the existing bounded window; Milestone 67 adds the explicit audible-breath exception without restoring live visual tracking. — test: `scripts/test-mr-feast-victory-feast.mjs::escape, hide, breath investigation, and catch`
- [x] A collected, actually emitting flashlight with a clear centered beam stuns the Saint for a named duration and stops its travel without damaging or removing it. An off, occluded, or defective beam cannot begin a stun, and the Saint resumes after the stun expires. — test: `scripts/test-mr-feast-victory-feast.mjs::flashlight Saint stun`
- [x] Finale-only flashlight defects distinguish requested power from actual beam output. `stutter` briefly interrupts output and recovers automatically; `give-out` extinguishes the light until the player reactivates it. Diagnostics and deterministic QA expose the mode, remaining time, event counts, and actual beam output. — test: `scripts/test-mr-feast-victory-feast.mjs::deterministic flashlight defects`
- [x] The emitting beam can lower concealment and stun the Saint but never creates a flashlight-specific camera offense. Only the finale's independently hostile camera policy, active sabotage, basement trespass, direct sight, or breathing can start/redirect a threat; a zero-output defect contributes no flashlight visibility. — tests: `scripts/test-mr-feast-flashlight.mjs::policy-gated camera response` and `scripts/test-mr-feast-victory-feast.mjs::flashlight stun and defects`
- [x] A save made during the escape phase restores to a replay-safe Dining Room report checkpoint: circuits restored, Saint hidden, pursuit cleared, flashlight ownership retained but switched off, and stun/defect timers cleared. Sabotage and gate escape remain explicitly pending. — test: `scripts/test-mr-feast-victory-feast.mjs::escape save normalization`
- [x] `render_game_to_text()` and `window.MrFeastFresh` expose the phase, timer, dialogue, feast staging, blackout, reveal, Saint motion/stun, flashlight defects, hiding/catch state, and deferred sabotage/escape outcome. Desktop and 390×844 touch presentation remain readable with zero unexpected browser errors. — test: `scripts/test-mr-feast-victory-feast.mjs::diagnostics and responsive presentation`
- [ ] User playtest confirms the feast reads as a large staged celebration, the fake-Contestant-13 reveal lands clearly, the Saint is unmistakable in the lightning flash, and flashlight failure plus hiding feels tense rather than arbitrary.

## Exit condition

The player wins Feast Hunt, hears Mr. Feast announce a five-minute Victory Feast, physically reports to the camera-covered Dining Room, sees the large spread, and hears that Contestant 13 was a production fiction. The lights die, lightning reveals the Banquet Saint in the corner, and control returns in a dark hostile mansion. The player can run, crouch, hide from the existing threats, and use a collected but unreliable flashlight to stun the Saint. Sabotage targets and the front-gate escape remain visibly pending rather than falsely completed.

## Test plan

1. Add `scripts/test-mr-feast-victory-feast.mjs` before implementation and confirm it fails on the missing named Victory Feast phase contract before Chromium launches.
2. Implement the smallest centralized Victory Feast state machine and deterministic QA surface, then turn the focused source/browser flow green.
3. Inspect `render_game_to_text()` before every screenshot and capture the feast, fake-Contestant-13 line, Saint lightning reveal, flashlight defect, and hiding state on desktop and phone.
4. Run runtime/test syntax, Feast Hunt, demon prototype, flashlight, pursuit/evasion, window-curtain, shared-light, banquet-loss, opening-welcome, Contestant 13, renovation, and `git diff --check`.

## Notes

- The current Feast Hunt gate still requires the patron relay cut. The finale now explicitly reveals that interaction as production's planted decoy, preserving the existing Game 3 gate while reserving the mansion's real sabotage chain for the later escape milestone.
- The Saint may reuse the existing checked-in model and animations, but story activation must not turn on Developer Mode or expose the rejected Pale Maw.
- The first escape phase is intentionally open-ended. Its HUD may tell the player to evade and find a way to sabotage the house, but it cannot mark sabotage, gate opening, or escape complete.
- Milestone 67 makes respiratory noise part of this loop: a nearby Saint can investigate the last audible position of a hidden player, but silence still withholds the player's live position.

## Automated verification results

- The red-first contract stopped before Chromium on the missing `VICTORY_FEAST_PHASE`. The completed focused suite now passes the full desktop and 390×844 touch chain: five-minute call, pause-safe and exact timer persistence, physical report interaction, staged feast/dialogue, fake-Contestant-13 reveal, switch-proof blackout, one lightning-only Saint reveal, clear-beam stun, deterministic stutter/give-out, hiding/catch consequences, and replay-safe escape save normalization.
- Visual proof lives in `output/playwright/mr-feast-victory-feast/`, including the unobstructed feast spread, desktop/mobile lightning reveal, and desktop/mobile hiding states. The phone reveal deliberately suppresses the large center-screen discovery card so the Saint remains readable during the flash.
- Runtime and changed-test syntax, focused Victory Feast, Feast Hunt, flashlight, pursuit/evasion, window-curtain, shared-light, banquet-loss, opening-welcome, Demon Prototype static/live browser, full desktop/mobile Contestant 13, and `git diff --check` pass. Renovation reaches only its unrelated current-origin `28 stairwell continuity` light-handoff baseline failure. User approval of the feast composition, reveal impact, and pressure balance remains open.
