# Milestone 35: Player Mobility, Inventory, and Test Menu

## Status

in-progress

## Objective

Add one cohesive player-control and testing layer to the mansion: stamina-limited sprinting, stealth-oriented crouching, a combined inventory/clue dossier, explicit save/load controls, and a reversible developer mode that removes repetitive quest setup during testing without completing the final sabotage for the player.

## Scope

- Hold `Shift` while moving to sprint until the visible energy reserve is exhausted; recover energy while not sprinting.
- Toggle crouch with `C`, lowering the viewpoint and movement speed while exposing stronger stealth and quieter-movement multipliers for future detection logic.
- Open and close a combined carried-object and recovered-clue dossier with `Tab`; retire the previous `I` / `J` bindings.
- Keep the left-side investigation HUD hidden until Contestant 13's first clue is discovered instead of telling a fresh player to search the Library.
- Open a mansion-specific menu with `Escape` that blocks player/world simulation and offers Resume, Maximize, Save, Load, and Dev Mode controls.
- Save and restore the player's position, view direction, current Contestant 13 progression, inventory, journal, and relevant story-world presentation through the existing `RBGameSaves` layer.
- Make Dev Mode reversible: enabling it snapshots the current quest state, grants all current objects/clues and opens the basement/Archive testing gates, while disabling it restores the snapshot and never auto-completes the patron-feed sabotage.

## Out of scope

- Mr. Feast detection, hearing, pursuit, capture, or AI reactions to the new stealth multipliers.
- Mobile sprint/crouch buttons or touch-menu redesign in this desktop-keyboard control slice.
- Multiple named save slots, cloud-save UI, checkpoints, or autosave.
- Workshop keypad implementation or additional basement clue chains.

## Dependencies

- **Depends on:** Milestone 34 — Basement Key Trail
- **Blocks:** Future Mr. Feast detection and pursuit milestone

## Acceptance criteria

- [x] Holding `Shift` while moving selects sprint speed, drains energy only during active movement, prevents sprint at zero energy, and recharges the reserve after sprinting stops; the HUD and diagnostics expose the same reserve and mode. — test: `scripts/test-mr-feast-player-systems.mjs::sprint energy lifecycle`
- [x] Pressing `C` toggles crouch, lowers the eye line, prevents sprinting, slows movement, and exposes improved noise/visibility multipliers; pressing `C` again restores standing movement. — test: `scripts/test-mr-feast-player-systems.mjs::crouch movement and stealth contract`
- [x] Pressing `Tab` opens one accessible modal showing carried objects and recovered clues, blocks movement, and closes with `Tab` or `Escape`; the old `I` and `J` bindings no longer open it. — test: `scripts/test-mr-feast-player-systems.mjs::inventory and clues dossier`
- [x] A fresh playthrough shows no left-side case file or Library-search objective; the investigation HUD appears only after the first clue is discovered. — tests: `scripts/test-mr-feast-player-systems.mjs::withheld opening guidance`, `scripts/test-mr-feast-contestant-13.mjs::discovery-first objective HUD`, and `scripts/test-mr-feast-renovation.mjs::49 discovery-first HUD`
- [x] Pressing `Escape` opens a focus-safe mansion menu, releases pointer lock, blocks simulation, resumes cleanly, and exposes working Maximize, Save, Load, and Dev Mode actions. — test: `scripts/test-mr-feast-player-systems.mjs::escape menu controls`
- [x] Save/Load restores player transform plus idempotent Contestant 13 story, inventory, journal, and story-world presentation without saving transient actions or Dev Mode. — test: `scripts/test-mr-feast-player-systems.mjs::save and load round trip`
- [x] Dev Mode is reversible, grants every current item and clue, opens the basement/Archive test gates, leaves `relaySabotaged` false, and restores the exact pre-dev quest snapshot when disabled. — test: `scripts/test-mr-feast-player-systems.mjs::reversible dev inventory grant`
- [x] The mansion boots without new console errors and the existing renovation, Contestant 13, and basement-key regressions retain their prior results. — tests: `node scripts/test-mr-feast-player-systems.mjs`, `node scripts/test-mr-feast-renovation.mjs`, `node scripts/test-mr-feast-contestant-13.mjs`, and `node scripts/test-mr-feast-basement-key-trail.mjs`

## Exit condition

User enters the mansion without an explicit Library direction, discovers the first clue through exploration, sprints until the energy bar drains, crouches and observes the slower/lower stealth state, opens Inventory with `Tab`, then uses the `Escape` menu to save, alter progress with Dev Mode, restore the clean state, and maximize the game.

## Test plan

1. Add focused static/browser assertions for the new movement state, HUD, modal controls, persistence round trip, and reversible Dev Mode; run them red against the current walk/journal-only baseline.
2. Implement named player-control tuning, modal state contracts, save serialization/restoration, and Dev Mode through the existing centralized `state` and Contestant 13 system.
3. Run the focused browser test through keyboard and button interactions, inspect `render_game_to_text()`, and capture desktop proof of the energy HUD, inventory dossier, and Escape menu.
4. Run syntax, static mansion regression, Contestant 13 browser regression, basement-key browser regression, and `git diff --check`, reporting unrelated worktree failures separately.
5. User playtests sprint/crouch feel and confirms the energy/recharge pacing.

## Notes

- `Tab` supersedes both previous dossier shortcuts so the displayed control and runtime binding remain unambiguous.
- The current Mr. Feast wanderer is visual-only. Crouch therefore establishes authoritative stealth/noise values now so the future detection system can consume them without redefining the player contract.
- Dev Mode exists only for test acceleration and is intentionally excluded from saved-game payloads.
- Automated acceptance completed on 2026-07-15. The milestone remains in progress only for the user's sprint/crouch pacing playtest.
- The 2026-07-16 discovery refinement moved the dossier to `Tab` and withheld the opening case-file direction until the shelf book is found.
