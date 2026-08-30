# Milestone 72 — Bathroom Curtain Hiding

## Status

In progress with implementation and automated acceptance complete; curtain visibility, prompt reach, viewing-crack usefulness, and exit feel await user playtest.

## Scope

- Preserve the four existing under-bed hiding spots and their authoritative behavior.
- Add one clawfoot-tub curtain and one walk-in-shower curtain to both complete bathrooms.
- Use textured, double-sided waxed linen, modeled folds, brass rods, rings, tiebacks, and tub return supports.
- Gather both panels while open and close them to an alternating `0.12m` left/right viewing crack while hidden.
- Reuse `HidingSpot`, `state.isHidden`, `state.activeHideSpot`, movement lock, flashlight shutdown, camera/Mr. Feast/Saint concealment, and existing breath/noise policy.
- Keep the physical player in a collision-clear room-side pocket while a hiding-only camera anchor supplies the inside-fixture view.
- Support real E and touch Interact entry, explicit Leave, reopening, clear exit, and immediate reuse.

## Acceptance

- [x] The Main Hall Bathroom and Upper Grand Bathroom each contain one tub curtain and one shower curtain. — test: `scripts/test-mr-feast-bathroom-curtain-hiding.mjs::inventory`
- [x] Every installation exposes a reachable Hide prompt, enters through real E, closes to its authored crack, owns the shared hidden state, locks movement, and switches off the flashlight. — test: `scripts/test-mr-feast-bathroom-curtain-hiding.mjs::desktop lifecycle`
- [x] Leave clears hidden ownership, removes the bathroom view treatment, returns the player to a safe room-side pocket, reopens the cloth, and supports reuse. — test: `scripts/test-mr-feast-bathroom-curtain-hiding.mjs::desktop lifecycle`
- [x] A representative upstairs shower supports touch entry/exit and a readable responsive hidden view at `390×844`. — test: `scripts/test-mr-feast-bathroom-curtain-hiding.mjs::mobile lifecycle`
- [x] Existing four-bedroom closet/under-bed and 48-installation window-curtain suites remain green. — test: `scripts/test-mr-feast-bedroom-hiding.mjs`, `scripts/test-mr-feast-window-curtains.mjs`
- [ ] User playtest confirms all four curtain prompts are naturally discoverable, the material/rod composition does not clip, the crack stays useful, and exits feel clear on desktop or phone. — verified by user playtest

## Verification

Run `node scripts/test-mr-feast-bathroom-curtain-hiding.mjs`, then the bedroom- and window-curtain regressions. Finish with runtime/test syntax checks and `git diff --check`. The renovation suite is expected to retain only its documented unrelated `28 stairwell continuity` invariant until that lighting handoff is addressed.

Automated proof is under `output/playwright/mr-feast-bathroom-curtains/`, including open tub framing, hidden tub/shower desktop views, and an upstairs shower phone view.
