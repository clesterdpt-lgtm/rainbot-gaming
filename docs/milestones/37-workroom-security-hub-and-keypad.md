# Milestone 37: Workroom Security Hub and Keypad

## Status

in-progress — automated acceptance complete; user layout/readability playtest pending

## Objective

Turn the basement Workshop and Cold Room footprint into one access-controlled Workroom that feels like the mansion's surveillance nerve center. Keep one entrance, gate it with a persistent four-digit keypad, and show the live public-camera network on a performant physical monitor wall.

## Scope

- Merge the former Workshop and Cold Room room zones, lighting, patrol route, and player-facing copy into one `WORKROOM`.
- Keep the Workroom interior camera-free while the monitor wall continues to page through every remaining public camera elsewhere on the estate.
- Retain the west corridor entrance and restore the former Cold Room doorway as solid wall and collision.
- Add a physical PIN pad plus a focus-safe desktop/touch keypad overlay; unlocking persists through explicit save/load and is reversible in Dev Mode.
- Use a named placeholder combination while deliberately deferring the in-world clue that reveals it.
- Build an eight-screen 4×2 monitoring wall whose paged roster covers every public security camera.
- Render each screen from its source camera's live scan/tracking pose through a low-light CCTV pass.
- Time-slice the feeds at low resolution, with reduced mobile cadence, no monitor recursion, and full renderer-state restoration.
- Add an operator console, rolling chairs, server racks, patch hardware, cable trays, radio, shift logs, binders, equipment cases, and small human clutter while keeping a clear central route.
- Rebalance the existing two-fixture Workroom circuit toward the east server bank and add switched emissive task practicals so the racks remain readable without increasing the shader-light count.
- Expose Workroom access, monitor feed, paging, render-target, pose, signature, and performance diagnostics through the existing QA surface.

## Out of scope

- The clue chain, prop, note, or puzzle that reveals the Workroom combination.
- Additional sabotage targets, camera controls, recording/rewind UI, or player-controlled feed selection in ordinary play.
- Disabling the public security network when the separate patron feed is cut.
- Full Mr. Feast vision/hearing, pursuit, capture, combat, or a final escape/exposure ending.

## Dependencies

- **Depends on:** Milestone 34 — Basement Key Trail
- **Depends on:** Milestone 36 — Camera Surveillance and Alarm Investigation
- **Blocks:** Future Workroom code-discovery and broader sabotage-network milestone

## Acceptance criteria

- [x] Both former room halves resolve to one `WORKROOM`, the internal floor remains continuous, and the Cold Room doorway is replaced by a solid wall/collider. — tests: `scripts/test-mr-feast-renovation.mjs::52 merged Workroom` and `scripts/test-mr-feast-workroom-security-hub.mjs::merged room diagnostics`
- [x] The retained Workroom entrance begins locked, rejects incorrect/incomplete combinations, unlocks idempotently with the named four-digit combination, and preserves that state through explicit save/load. — test: `scripts/test-mr-feast-workroom-security-hub.mjs::keypad access and persistence`
- [x] Looking at the physical PIN pad and pressing `E` opens a focus-safe overlay; digit, clear, enter, keyboard (including character-only layout events), click, and touch controls remain at least 44px and fit without horizontal overflow at 390×844. — test: `scripts/test-mr-feast-workroom-security-hub.mjs::real keypad input and mobile layout`
- [x] Dev Mode opens the current testing gate without completing the relay sabotage, and disabling Dev Mode restores the exact prior Workroom access state. — tests: `scripts/test-mr-feast-player-systems.mjs::reversible Dev Mode` and `scripts/test-mr-feast-workroom-security-hub.mjs::persistent Workroom state`
- [x] Eight physical screens use independent `WebGLRenderTarget` textures and a paged roster covering all public camera IDs; each feed copies its source camera's live lens position, yaw, and pitch. — tests: `scripts/test-mr-feast-renovation.mjs::52 live monitor bank` and `scripts/test-mr-feast-workroom-security-hub.mjs::authentic camera feeds`
- [x] Feed frames are nonblank and distinct, and changing a source camera's sweep changes both the copied pose and rendered pixel signature. — test: `scripts/test-mr-feast-workroom-security-hub.mjs::live pan signature`
- [x] Desktop feeds render at no more than 256×144, mobile feeds at 128×72, ordinary play renders at most one extra feed per main frame, and the monitor pass restores the prior target, viewport, scissor, scene override, and visibility state without adding mansion light topology. — tests: `scripts/test-mr-feast-renovation.mjs::52 monitor performance` and `scripts/test-mr-feast-workroom-security-hub.mjs::render budget and state restoration`
- [x] The security hub includes semantic operator, server, cable, storage, and human-clutter props while preserving access to the existing patron relay and room aisle. — test: `scripts/test-mr-feast-workroom-security-hub.mjs::Workroom ambience diagnostics` plus desktop visual capture
- [x] No public security-camera body or detection cone remains inside the Workroom, and the eight-screen monitor roster covers all 32 remaining cameras without blank or duplicate first-page feeds. — tests: `scripts/test-mr-feast-renovation.mjs::camera-free Workroom` and `scripts/test-mr-feast-workroom-security-hub.mjs::camera-free monitor roster`
- [ ] The east server bank is visibly readable from the wide Workroom view using the existing two real emitters plus switched task practicals, with no additional shader light. — tests: `scripts/test-mr-feast-renovation.mjs::Workroom server lighting` and `scripts/test-mr-feast-workroom-security-hub.mjs::server-side luminance`; final appearance verified by user playtest
- [x] Existing renovation, Contestant 13, basement-key, and player-system suites retain their previous outcomes. — tests: `node scripts/test-mr-feast-renovation.mjs`, `node scripts/test-mr-feast-contestant-13.mjs`, `node scripts/test-mr-feast-basement-key-trail.mjs`, and `node scripts/test-mr-feast-player-systems.mjs`
- [ ] User confirms the merged room, keypad, monitor readability, feed refresh cadence, and ambience feel right in live play.

## Exit condition

User reaches the former two-door basement footprint, sees one sealed Workroom entrance, enters the temporary test PIN, walks into one continuous security hub, recognizes live changing room views across the monitor wall, and can still reach the existing patron-feed relay without snagging on the new furniture.

## Test plan

1. Add a focused browser regression and static milestone invariants; prove they fail against the split, always-open, monitorless baseline.
2. Merge room data and physical access, then add persistent keypad state and real desktop/touch interaction.
3. Build the monitor presentation and time-sliced render-target system using the authoritative security-camera poses.
4. Add Workroom ambience, inspect diagnostics, capture desktop/mobile proof, and correct any visually unreadable feeds.
5. Run syntax, static, focused browser, and all adjacent mansion regressions; record unrelated environment failures separately.
6. User playtests layout, code-entry feel, screen readability, refresh pacing, and relay access.

## Notes

- The temporary testing combination is `0513`. It is not displayed in ordinary player diagnostics or UI; a later milestone will author the discoverable clue and may replace the value.
- The low-light feed pass renders real scene geometry from the live camera transform, then applies a restrained green CCTV treatment on the physical screen. This keeps remote floors readable without mutating room circuits or adding one real-time light per feed.
- The monitor bank freezes its last frames when the player leaves the Workroom vicinity and cycles across the full public network in pages while nearby.
- The camera-free refinement reduces the live roster from 34 to 32 sources. It does not disable the monitor wall or the remaining public security network after the private patron feed is cut.
- The east fixture remains one of the Workroom circuit's original two real emitters, but is now the circuit's fixed-budget primary at `1.55×` intensity with a `7.6m` reach. Three switched emissive task practicals align with the rack bank without increasing shader-light topology. In the 1280×820 wide-view proof, the server-side region improved from `4.455` mean luminance / `5.05%` visible pixels to `50.371` / `57.11%`; compare `output/iterate/2026-07-16-workroom-server-lighting-before.png` and `output/iterate/2026-07-16-workroom-server-lighting-after.png`.
- Keypad number entry now accepts both physical `KeyboardEvent.code` values and character-only `KeyboardEvent.key` values, covering layouts and input environments that do not report a usable physical key code. Click and 390×844 touch entry remain regression-covered.
