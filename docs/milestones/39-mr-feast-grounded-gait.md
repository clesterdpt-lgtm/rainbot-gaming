# Milestone 39: Mr. Feast grounded gait

## Status

in progress — implementation and automated acceptance complete; live feel awaiting user playtest

## Objective

Correct Mr. Feast's visual patrol so his lower body walks in the same direction as his route and each planted foot appears to propel the character instead of sliding across the floor. Preserve his restrained host posture, current patrol speed, route, model, facial system, and camera-alarm response.

## Scope

- Preserve the source walk clip's pelvis and complete lower-body rotation chain while retaining the existing restrained upper-body, arm, neck, and head treatment.
- Rebuild the animation-only stalk GLB with no scale tracks, no non-Hips translation, and no Armature/root motion.
- Calibrate stalk playback to the actual patrol speed and scale its cadence for faster camera-alarm response movement.
- Require near-complete travel/facing alignment before either patrol or response translation begins.
- Expose deterministic foot, toe, action-phase, playback-rate, and travel/facing diagnostics for browser QA.
- Capture a side-on contact sequence and turn-to-walk sequence in the real mansion.

## Out of scope

- A different character model, skeleton, patrol route, movement speed, run animation, chase system, or procedural full-body IK solver.
- Changes to Mr. Feast's face, proportions, wardrobe, route doors, camera policy, or player controls.

## Acceptance criteria

- [x] The tuned stalk preserves full source rotation on Hips and the complete left/right leg, foot, and toe chains while retaining restrained upper-body motion.
- [x] Each foot and toe remains within 10 degrees of forward; feet cover 0.85–1.10 meters and toes cover 0.85–1.25 meters across one stalk cycle.
- [x] During deterministic straight travel, every qualifying planted-toe interval lasts at least 0.12 seconds, drifts at most 0.07 meters horizontally, and moves laterally at most 0.04 meters.
- [x] Patrol stalk playback is 0.36–0.39 and camera-response playback scales to 0.62–0.67 without changing the authored 0.62m/s patrol or 1.08m/s response speeds.
- [x] Patrol and response translation begin only when travel/facing alignment is at least 0.985, and every moving QA sample stays within 10 degrees of its travel vector.
- [x] The regenerated stalk remains an animation-only GLB with 24 rotation tracks, one Hips translation, no scale tracks, and no non-Hips translation tracks.
- [x] Focused browser QA, renovation, Contestant 13, camera-security, and syntax checks remain green with zero console errors.
- [ ] The side-on live sequence reads as planted and propulsive rather than diagonal or sliding — verified by user playtest.

## Exit condition

User watches Mr. Feast pivot through a mansion corner and cross a straight stretch from the side → his hips and legs remain aligned with the route, the planted boot stays visually attached to the floor long enough to push him forward, and the swing foot advances naturally without obvious skating.

## Measured baseline

- The raw Meshy walk travels only 1–3 degrees off forward, but the previous tuning pass bends the left/right toe paths to roughly 31/36 degrees by slerping the pelvis and leg chain toward an idle frame whose pelvis differs by about 44 degrees.
- The current tuned toes travel only about 0.53m left and 0.45m right while the fixed wrapper cadence and speed produce visible stance drift of roughly 0.12–0.17m.
- Runtime route yaw and the model's `+Z` forward axis agree; no model-facing correction is required.

## Implemented result

- The rebuilt in-game toe trajectories now sit roughly 3.0 degrees off-forward instead of 31/36 degrees, with 1.20m left and 1.13m right forward excursion on the pending retopologized runtime model.
- Patrol playback is 0.37 and scales from the same stride contract to about 0.645 during the existing 1.08m/s camera-alarm response.
- Repeated fixed-step planted intervals drift at most about 0.051m horizontally and remain below the 0.04m true lateral limit.
- Both patrol and response paths share the named 0.985 alignment gate, eliminating translation through the old 23-degree cornering allowance.
- Four side-on gait phases plus the corner pivot and first translating steps were inspected at original resolution under `output/playwright/mr-feast-grounded-gait/`.

## Test plan

1. [x] Run `node scripts/test-mr-feast-grounded-gait.mjs` against the existing build and confirm it fails on the missing named alignment/cadence contract and foot diagnostics.
2. [x] Regenerate the tuned stalk, then use deterministic one-cycle pose sampling to validate its local toe trajectories.
3. [x] Run fixed-step straight and corner probes in Chromium, classify planted intervals from toe height/vertical speed, and capture the contact/turn frames.
4. [x] Run the adjacent mansion suites and inspect the side-on images at original resolution.
5. [ ] User playtests the gait for the remaining subjective weight and polish check.
