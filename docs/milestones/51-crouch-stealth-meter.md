# Milestone 51: Crouch Stealth Meter

## Status

In progress

## Objective

Turn the crouch stance from a bookkeeping multiplier into a readable stealth system: a HUD meter that tells the crouched player how concealed they are, driven by movement and by the light actually falling on them, and consumed by Mr. Feast's witnessed-sight check and camera acquisition so that crouching in darkness genuinely helps the player avoid him.

## Scope

- One authoritative `STEALTH` constants table and a per-frame concealment update alongside the existing player update.
- A 0–100 stealth meter HUD, visible only while crouched, styled after the sprint-energy meter with `dark`/`lit` context and an exposed low-concealment state.
- Real light sampling at the player's torso from the live circuit and auxiliary emitters (point radius windows plus spot cones), with a QA override for determinism.
- A motion-activity component that clearly lowers the meter while crouch-walking and recovers after stopping.
- An AI-facing effective visibility that multiplies the authoritative Milestone 35 crouch multiplier with crouch-gated darkness and stillness bonuses, feeding camera acquisition/exposure fill and scaling Mr. Feast's witnessed-sight range down to a close-quarters fairness floor.
- Diagnostics through `render_game_to_text()` plus `MrFeastFresh.getStealth` and `MrFeastFresh.setStealthLightOverrideForQA`.

## Out of scope

- Any hearing/noise-propagation AI: `stealthNoiseMultiplier` keeps its audio-only role and continuous Mr. Feast perception remains deferred.
- Free-roaming chase behavior changes; pursuit still starts only from the existing witnessed/recorded infractions and basement trespass.
- Mobile crouch controls (still deferred from Milestone 35), so the meter is desktop-facing until those exist.
- Raycast occlusion inside the light sampler; room-bounded falloff windows already keep circuit light inside its room.

## Dependencies

- **Depends on:** Milestone 35 crouch stance and stealth multipliers, Milestone 36 camera exposure, Milestone 46 witnessed pursuit
- **Blocks:** none

## Acceptance criteria

- [x] Standing keeps every authored baseline byte-identical: neutral `1` stance multipliers, effective visibility exactly `1`, and Mr. Feast's authored `9m` sight range. — test: `scripts/test-mr-feast-stealth-meter.mjs::standing baseline`
- [x] Crouching reveals an accessible 0–100 meter HUD whose aria value mirrors diagnostics, while the authoritative `0.5` crouch stance multiplier is preserved exactly. — test: `scripts/test-mr-feast-stealth-meter.mjs::crouch meter HUD`
- [x] Moving while crouched clearly lowers the meter and raises effective visibility (never above the authored `0.5`); stopping recovers both. — test: `scripts/test-mr-feast-stealth-meter.mjs::motion response`
- [x] Turning the real light circuits off raises the meter to near-total concealment and lowers sampled light exposure and effective visibility; the QA override pins both endpoints. — test: `scripts/test-mr-feast-stealth-meter.mjs::light response`
- [x] A dark, motionless crouch shrinks Mr. Feast's witnessed-sight range below a staged mid-range infraction so it goes unseen, while the same infraction is witnessed standing in light, and a point-blank infraction stays witnessed from any crouch. — test: `scripts/test-mr-feast-stealth-meter.mjs::scaled witnessed sight`
- [x] Camera acquisition and exposure consume the crouch-scaled effective visibility while hiding pegs the score and defers to the dedicated hidden pill. — tests: `scripts/test-mr-feast-camera-security.mjs`, `scripts/test-mr-feast-stealth-meter.mjs::hiding handoff`
- [x] The meter stays hidden on the touch layout without horizontal overflow while crouch remains desktop-only. — test: `scripts/test-mr-feast-stealth-meter.mjs::phone layout`
- [ ] User playtest confirms the meter reads clearly while sneaking, that light and movement changes feel fair, and that dark crouched evasion of Mr. Feast feels tense rather than trivial.

## Exit condition

User crouches near Mr. Feast on desktop → the meter appears and visibly answers "how hidden am I right now", drops while they crouch-walk or stand in lamplight, climbs in darkness and stillness, and a dark motionless crouch lets them watch him pass outside the fairness floor without being seen.

## Test plan

Write and run `scripts/test-mr-feast-stealth-meter.mjs` red before implementation, then green after. Add renovation section 55 contract pins (constants table, HUD markup, circuit sampling, crouch-gated bonuses, sight gating, camera consumption, diagnostics) red-first alongside. Rerun the renovation static suite, player-systems, camera-security, caught-pursuit, and the full contestant-13 route, and capture lit/dark crouch desktop proof plus the touch layout.

## Verification

- Red-first: renovation section 55 failed all seven new pins before implementation; the focused browser suite failed on the missing staging/meter before the pose fix and implementation.
- `node --check` passed for the runtime and the new suite; `node scripts/test-mr-feast-renovation.mjs` passed after updating the section 51 camera pin to the new `state.stealth.effectiveVisibility` consumption (which still multiplies the Milestone 35 crouch value underneath).
- `node scripts/test-mr-feast-stealth-meter.mjs` passed: standing baselines, crouch meter HUD with aria mirroring, motion drop/recovery, real-circuit dark/lit response, QA override endpoints, scaled witnessed sight with the staged `4.8m` Music Room probe (seen standing lit, unseen from a dark motionless crouch, seen point-blank), hiding handoff, phone layout, zero console errors.
- `node scripts/test-mr-feast-player-systems.mjs`, `node scripts/test-mr-feast-camera-security.mjs`, and `node scripts/test-mr-feast-caught-pursuit.mjs` all passed unchanged scenarios.
- Visual proof: `output/playwright/mr-feast-stealth-meter/stealth-meter-crouch-lit-desktop.png` (meter `62`, `Stealth · lit`), `stealth-meter-crouch-dark-desktop.png` (meter `94`, `Stealth · dark`), and `stealth-hud-mobile.png`.

## Notes

The meter and the AI consume one concealment model with two mappings: an additive exposure mix for readable meter travel, and multiplicative crouch-gated bonuses for the AI so a lit moving crouch equals the authored `0.5` exactly and standing detection timing cannot drift. Bonuses only ever make the runner harder to detect, preserving the Milestone 46 capture-boundary contract and existing regression timing.
