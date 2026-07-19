# Milestone 35: Player Mobility, Inventory, and Test Menu

## Status

in-progress

## Objective

Add one cohesive player-control and testing layer to the mansion: stamina-limited sprinting, stealth-oriented crouching, a combined inventory/clue dossier, explicit save/load controls, and a reversible developer mode that removes repetitive quest setup during testing without completing the final sabotage for the player.

## Scope

- Hold `Shift` while moving to sprint until the visible energy reserve is exhausted; recover energy while not sprinting.
- Toggle crouch with `C`, lowering the viewpoint and movement speed while exposing stronger stealth and quieter-movement multipliers for future detection logic.
- Open and close a combined carried-object and recovered-clue dossier with `Tab`; retire the previous `I` / `J` bindings.
- On touch/mobile layouts, expose persistent hold-to-`Sprint`, `Crouch`, and `Menu` controls that drive the same authoritative stamina, stance, and pause-menu state as keyboard input.
- Show the dossier toolbar control only on touch/mobile layouts and label it `Bag`; keep `Tab` as the desktop keyboard shortcut without desktop toolbar clutter.
- Keep the left-side investigation HUD hidden until Contestant 13's first clue is discovered instead of telling a fresh player to search the Library.
- Present carried objects as illustrated item cards and recovered clues as handwritten entries on a ruled notepad without changing quest state or controls.
- Open a mansion-specific menu with `Escape` that blocks player/world simulation and offers Resume, Maximize, Save, Load, and Dev Mode controls.
- Save and restore the player's position, view direction, current Contestant 13 progression, inventory, journal, and relevant story-world presentation through the existing `RBGameSaves` layer.
- Make Dev Mode reversible: enabling it snapshots the current quest state, grants all current objects/clues and opens the basement/Archive testing gates, while disabling it restores the snapshot and never auto-completes the patron-feed sabotage.

## Out of scope

- Mr. Feast detection, hearing, pursuit, capture, or AI reactions to the new stealth multipliers.
- A broader touch-control redesign beyond the requested Sprint, Crouch, Menu, and Bag controls.
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
- [x] Every current carried object has a distinct, decorative SVG illustration in a readable item card, and every recovered clue is rendered as handwriting on one ruled-paper notepad at desktop and mobile widths. — tests: `scripts/test-mr-feast-player-systems.mjs::illustrated dossier` and `scripts/test-mr-feast-renovation.mjs::50 illustrated dossier`
- [x] Pressing `Escape` opens a focus-safe mansion menu, releases pointer lock, blocks simulation, resumes cleanly, and exposes working Maximize, Save, Load, and Dev Mode actions. — test: `scripts/test-mr-feast-player-systems.mjs::escape menu controls`
- [x] On a 390×844 touch viewport, hold-to-`Sprint` drains the same stamina reserve as `Shift`, `Crouch` toggles the same stealth stance as `C`, `Menu` opens the simulation-blocking mansion menu, and the mobile-only dossier control reads `Bag`. Every action remains at least 44 px, the movement pad remains 48 px per direction, Sprint/Crouch do not overlap Interact, and the complete lower control footprint stays within 24% of the stage. Persistent Sprint/Crouch yield while Feast Says owns movement. — tests: `scripts/test-mr-feast-player-systems.mjs::mobile touch controls` and `scripts/test-mr-feast-feast-says.mjs::mobile challenge input ownership`
- [x] The intro and Escape menus fit without internal scrolling at desktop, portrait-phone, and short-landscape sizes; every action remains at least 44 px tall, the embedded stage stays inside the visible viewport, and a viewport grow/shrink cycle returns the stage and canvas to their original height instead of ratcheting downward. — tests: `scripts/test-mr-feast-menu-viewport.mjs` and `scripts/test-mr-feast-renovation.mjs::26 explicit mobile stage height`
- [x] Save/Load restores player transform plus idempotent Contestant 13 story, inventory, journal, and story-world presentation without saving transient actions or Dev Mode, including a cold Load from the main intro. — tests: `scripts/test-mr-feast-player-systems.mjs::save and load round trip` and `scripts/test-mr-feast-intro-save-load.mjs::cold main-menu restore and invalid-save containment`
- [x] Dev Mode is reversible, grants every current item and clue, opens the basement/Archive test gates, leaves `relaySabotaged` false, and restores the exact pre-dev quest snapshot when disabled. — test: `scripts/test-mr-feast-player-systems.mjs::reversible dev inventory grant`
- [x] The mansion boots without new console errors and the existing renovation, Contestant 13, and basement-key regressions retain their prior results. — tests: `node scripts/test-mr-feast-player-systems.mjs`, `node scripts/test-mr-feast-renovation.mjs`, `node scripts/test-mr-feast-contestant-13.mjs`, and `node scripts/test-mr-feast-basement-key-trail.mjs`

## Exit condition

User enters the mansion without an explicit Library direction, discovers the first clue through exploration, sprints until the energy bar drains, crouches and observes the slower/lower stealth state, opens Inventory with `Tab`, then uses the `Escape` menu to save, alter progress with Dev Mode, restore the clean state, and maximize the game. On phone, the same sprint, crouch, dossier, and menu actions remain directly available through `Sprint`, `Crouch`, `Bag`, and `Menu` touch controls.

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
- The 2026-07-16 visual refinement gives the shovel, B-13 key, badge, and tape distinct inline SVG illustrations; the evidence trail now reads from a warm ruled notepad with mobile-safe internal scrolling.
- The 2026-07-18 mobile refinement adds persistent touch Crouch and Menu controls, renames the touch-only dossier toolbar control to Bag, removes that toolbar from desktop, and prevents duplicate crouch controls during Feast Says.
- The 2026-07-19 mobile refinement adds hold-to-Sprint through the authoritative stamina input, compacts the energy/stealth cards and movement-pad spacing, preserves 44–48 px targets, and caps the lower touch footprint at 24% of the phone stage.

## Post-launch fix — reliable main-menu Load

The first intro-menu Load implementation called an undeclared `mrFeastSystem` name after applying the saved player and quest state. That threw a browser error and left the intro hidden in a half-finished transition. The repaired path now uses the authoritative `mrFeastNpc`, reads one versioned save snapshot once, validates its required transform before mutating quest/world state, and leaves an invalid save safely at the intro with a clear Start-new fallback.

The base estate also renders once before Start/Load becomes actionable, while optional character GLBs begin shortly after exploration starts. This keeps character parsing from competing with the load click. Focused Chromium QA measured a 4.1 ms restore task and an 18.1 ms next frame, with the saved Archive position, crouch/energy state, skipped welcome, confirmation copy, and zero browser errors all verified.

- `node scripts/test-mr-feast-intro-save-load.mjs` — passed valid cold-menu restore, malformed-save containment, 100 ms restore-task budget, 250 ms next-frame budget, screenshots, and zero console errors.
- `node scripts/test-mr-feast-player-systems.mjs` — passed the original in-session save/dev-mode round trip after its fullscreen assertion was made asynchronous like the production control.
- `node scripts/test-mr-feast-caught-pursuit.mjs` — passed the shared game-over Load recovery path.
- `node scripts/test-mr-feast-contestant-13.mjs` and `node scripts/test-mr-feast-renovation.mjs` — passed adjacent progression and static mansion coverage.

## Post-launch fix — viewport-safe menus and stable canvas sizing

The embedded stage now owns a definite viewport-budgeted height, and its absolutely positioned canvas can no longer feed an enlarged intrinsic height back into the stage. The renderer measures the stage content box, skips redundant backing-buffer resizes, and returns to the original dimensions after browser-toolbar, orientation, or viewport grow/shrink changes. This removes the reported downward expansion after Start.

The intro and Escape panels use compact responsive spacing and multi-column actions, with a deliberately reduced presentation on very short landscape screens. The page header also compacts in that constrained layout so the whole stage—not only the menu panel—remains visible while all actionable buttons retain 44 px targets.

- `node scripts/test-mr-feast-menu-viewport.mjs` — passed a real saved-game intro plus the Escape menu at 1024×600, 1280×720, 390×844, 390×667, 560×600, 844×390, and 568×320 at DPR 2; asserted zero menu overflow, visible stage/panels/buttons, stable Start sizing, exact grow/shrink recovery, unchanged page scroll, and zero unexpected browser errors.
- Final adjacent reruns passed `node scripts/test-mr-feast-renovation.mjs`, `node scripts/test-mr-feast-player-systems.mjs`, and `node scripts/test-mr-feast-contestant-13.mjs`.
- Browser proof under `output/playwright/mr-feast-menu-viewport/` covers the saved-game intro and pause menu at desktop, portrait, short-landscape, and compact 568×320 landscape sizes.
