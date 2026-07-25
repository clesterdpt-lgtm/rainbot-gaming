# Milestone 63: Shared Room Light Circuits

## Status

Implementation and automated acceptance complete; user playtest remains.

## Objective

Make every physical switch in a continuous architectural volume control the whole space. The Wine Cellar/Laundry wing, Archive/Pantry wing, and two-storey foyer/stair volume keep their distinct room labels for navigation and story systems, but no longer leave one visible section lit when an adjoining section has been switched off. The rear lounge stays independent.

## Scope

- Replace the independent Wine Cellar and Laundry circuits with one `wine cellar and laundry lights` circuit.
- Replace the independent Archive and Pantry circuits with one `archive and pantry lights` circuit.
- Keep both existing wall switches in each wing and bind either one to the complete shared circuit.
- Preserve every existing fixture and the fixed six-spot/eleven-point shader-light budget.
- Reserve one live fixed-budget fixture representative for each named half of a shared circuit.
- Map both room labels in each wing to the same circuit for light sampling and diagnostics.
- Replace the separate foyer chandelier, grand stair, and upper landing circuits with one `foyer and staircase lights` circuit.
- Keep the main-foyer, foyer-balcony, grand-stair, and upper-landing wall controls and bind all four to the complete open volume.
- Preserve one fixed-budget live emitter for the foyer, grand-stair, and upper-landing fixture roles.
- Keep `rear lounge lights` as an independent circuit and prove its switch does not alter the foyer/stair state.
- Expose shared room roles, active shared room roles, and both physical switch approaches through the existing QA surface.

## Out of scope

- Joining any rooms beyond the two basement wings and specifically requested foyer/stair open volume.
- Moving switches or fixtures, adding lights, changing shadows, or increasing the shader-light budget.
- Changing cameras, room labels, clues, furniture, patrol routes, or stealth tuning.

## Dependencies

- **Depends on:** Milestone 16 — Mansion Lighting
- **Blocks:** none

## Acceptance criteria

- [x] `ROOM_LIGHTING` maps Wine Cellar and Laundry to one named circuit and Archive and Pantry to one named circuit; the four legacy independent circuit objects no longer exist. — test: `scripts/test-mr-feast-shared-light-circuits.mjs::source contract`
- [x] Each shared circuit retains two physical wall switches and every existing fixture: six across Wine Cellar/Laundry and four across Archive/Pantry. — test: `scripts/test-mr-feast-shared-light-circuits.mjs::runtime inventory`
- [x] Real E interaction at either switch turns the complete paired wing off or on, while the other shared wing remains unchanged. — test: `scripts/test-mr-feast-shared-light-circuits.mjs::physical two-way switching`
- [x] An energized shared circuit keeps at least one selected real emitter in each named room half without changing the fixed shader budgets. — tests: `scripts/test-mr-feast-shared-light-circuits.mjs::fixed-budget coverage` and `scripts/test-mr-feast-renovation.mjs::global shader padding`
- [x] Feast Hunt still blacks out every interior circuit, rejects switch restores during the hunt, and restores the exact pre-hunt shared-circuit states afterward. — test: `scripts/test-mr-feast-feast-hunt.mjs::full-house blackout lifecycle`
- [x] `render_game_to_text()` exposes both shared room roles and which roles currently retain active rendered fixtures. — test: `scripts/test-mr-feast-shared-light-circuits.mjs::diagnostics`
- [x] `ROOM_LIGHTING` maps Front Foyer, Grand Stair Hall, Foyer Balcony, and Upper Landing to one named circuit; the three legacy independent circuit objects no longer exist. — test: `scripts/test-mr-feast-shared-light-circuits.mjs::open-volume source contract`
- [x] All four existing foyer/stair wall controls own the same circuit, and a real E interaction downstairs can darken the upper landing while the upper-landing control can relight the complete volume. — test: `scripts/test-mr-feast-shared-light-circuits.mjs::open-volume physical switching`
- [x] The rear lounge remains independently switchable without changing the energized foyer/stair circuit. — test: `scripts/test-mr-feast-shared-light-circuits.mjs::rear-lounge isolation`
- [x] The merged open-volume circuit keeps active fixed-budget representatives for foyer, grand stair, and upper landing without changing the six-spot/eleven-point budget. — test: `scripts/test-mr-feast-shared-light-circuits.mjs::open-volume fixed-budget coverage`
- [ ] User playtest confirms every switch in the Wine Cellar/Laundry wing, Archive/Pantry wing, and foyer/stair volume changes every visible fixture in its continuous space, that all lit sections remain evenly readable, and that the rear lounge remains independent. — verified by user playtest

## Exit condition

The player can use any switch in the Wine Cellar/Laundry wing, Archive/Pantry wing, or foyer/stair volume and see every fixture in that physically continuous space change together, with no unrelated circuit changing and no section going unlit because of the fixed renderer budget. The lounge remains separate.

## Test plan

Create `scripts/test-mr-feast-shared-light-circuits.mjs` before implementation and confirm it fails on the missing named shared-room table. Extend it red-first for the missing foyer/stair shared contract. Turn the focused source and browser sequence green by driving real E interactions at the basement switches, the main foyer, upper landing, and rear lounge; inspect circuit inventory and active section roles; and capture cross-volume dark/lit states. Then run runtime/test syntax, renovation, Feast Hunt, Contestant 13, and `git diff --check`, followed by visual inspection of the dark/lit captures.

## Notes

- The focused regression failed red first with `missing named shared-room lighting table`.
- The foyer/stair extension failed red first with `missing named foyer/stair shared-lighting contract`.
- The two merged circuit representatives displaced exactly the two representatives removed with the legacy split circuits, so `MOBILE_SHADER_POINT_BUDGET` remains `11`.
- Runtime/test syntax, renovation invariants, the focused physical-switch browser suite, the complete Feast Hunt blackout/restoration suite, the stealth-meter browser suite, full desktop/mobile Contestant 13, and `git diff --check` pass.
- The foyer/stair refinement additionally passes all four real switch approaches, rear-lounge isolation, the upper-window/gallery physical guard and balcony loop, and the complete Feast Hunt blackout/restoration lifecycle.
- Browser proof lives under `output/playwright/mr-feast-shared-light-circuits/`.
