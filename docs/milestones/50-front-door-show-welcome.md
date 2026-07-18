# Milestone 50: Front-Door Show Welcome

## Status

In progress

## Objective

Replace the abrupt handoff from the title card into free exploration with a staged, suspicious welcome: Mr. Feast meets the player just inside the front door, explains that they are competing in a reality show for one million dollars, introduces selected parts of the house, and makes the basement restriction feel more like a threat than a safety rule.

## Scope

- Stage Mr. Feast at the front-door foyer facing the fresh player while both characters remain in place.
- Present seven complete host lines through the existing readable speech bubble, with generous automatic dwell time and a guarded E/tap advance.
- Keep movement and ordinary interactions locked until the final line finishes, then release the player and resume Mr. Feast's existing foyer patrol naturally.
- Expose opening progress, timing, placement, and completion through the existing text diagnostics and focused QA controls.
- Keep the first uncached load behind progress-aware startup protection so slow but healthy runtime and mansion-asset downloads cannot flash a false retry error.
- Preserve the existing intro/loading card, speech presentation, quest state, security rules, saves, and static Three.js runtime.

## Out of scope

- Recorded voice acting, lip synchronization, cinematic camera cuts, new character animation clips, or changes to later ambient dialogue.
- Rewriting the Contestant 13 clue trail or revealing its Library objective during the welcome.

## Dependencies

- **Depends on:** Milestone 45 host speech and Milestone 48 conversation focus
- **Blocks:** none

## Acceptance criteria

- [x] Starting a fresh run places the loaded Mr. Feast just inside the front door, facing the threshold player, while player translation, host patrol, and ordinary interactions remain locked. — test: `scripts/test-mr-feast-opening-welcome.mjs::front-door staging and input gate`
- [x] Seven sequential lines explicitly establish a reality-show competition, the one-million-dollar prize, accessible house areas, camera/house rules, and a prohibition on entering the basement, ending on a suspicious consequence. — test: `scripts/test-mr-feast-opening-welcome.mjs::authored briefing contract`
- [x] Every line appears complete and remains visible for a named 6–10 second reading window; E/tap cannot advance it before a named minimum hold, and the sequence progresses automatically if the player does nothing. — test: `scripts/test-mr-feast-opening-welcome.mjs::deterministic pacing and guarded advance`
- [x] After the final line, movement and normal interactions unlock, the opening never repeats during that run, and Mr. Feast resumes from the foyer without altering quest, security, inventory, or save state. — test: `scripts/test-mr-feast-opening-welcome.mjs::clean release to exploration`
- [x] The existing speaker-labelled bubble and Continue prompt stay fully readable inside the stage at 1280×820 and 390×844. — test: `scripts/test-mr-feast-opening-welcome.mjs::desktop and mobile presentation`
- [x] A healthy cold runtime request and multiple healthy asset phases can exceed the old fixed deadlines without ever exposing a false Retry state, while a genuinely inactive initialization still restores the retry action. — test: `scripts/test-mr-feast-load-reliability.mjs`
- [ ] User playtest confirms that the delivery is slow enough to read and that the host's welcome feels suspicious and cryptic rather than plainly expository.

## Exit condition

User starts a fresh game on desktop or phone → Mr. Feast visibly welcomes them at the front door, delivers the complete readable reality-show briefing and cryptic basement warning, then releases control cleanly into normal mansion exploration.

## Test plan

Write and run `scripts/test-mr-feast-opening-welcome.mjs` red before implementation, then green after implementation. For the load-reliability refinement, write and run `scripts/test-mr-feast-load-reliability.mjs` red against the legacy fixed deadlines, then green with a delayed cold runtime, phased delayed assets, and a true initialization stall. Capture the basement warning on desktop and the final threat on mobile, inspect `window.render_game_to_text()` throughout the sequence, and rerun both mansion regression suites plus the adjacent host-speech and player-system suites.

## Verification

- Red-first focused regression failed on the missing `MR_FEAST_OPENING_WELCOME` contract before implementation, then passed after implementation.
- The load-reliability regression failed red on the missing cold-start timeout contract, after controlled Chromium runs reproduced the false page retry at `18.1s` and false runtime retry at `15.4s`; it then passed with a delayed core runtime, separately delayed texture/statue phases, a genuine silent-init failure, and zero browser errors.
- Runtime and focused-test syntax checks, `git diff --check`, `scripts/test-mr-feast-renovation.mjs`, `scripts/test-mr-feast-contestant-13.mjs`, `scripts/test-mr-feast-tamper-distractions.mjs`, and `scripts/test-mr-feast-contestant-conversations.mjs` passed.
- The focused browser suite passed fresh-run staging, real wall-clock auto-progression, deterministic timing, guarded E/tap continuation, clean exploration release, 1280×820 desktop layout, 390×844 touch layout, and zero browser-console errors.
- Visual proof: `output/playwright/mr-feast-opening-welcome/front-door-welcome-desktop.png` and `output/playwright/mr-feast-opening-welcome/front-door-welcome-mobile.png`.
- Cold-start proof: `output/playwright/mr-feast-load-reliability/cold-runtime-ready.png` and `progressive-assets-ready.png` both show the normal enabled entry card after intentionally delayed first-load paths, without an intervening Retry state.
- The adjacent player-systems suite still stops at its pre-existing fullscreen/maximize assertion; the opening welcome does not touch that path.

## Notes

This is a focused onboarding state layered over the existing speech and patrol systems; it does not change the mansion's top-level architecture or require a new ADR.
