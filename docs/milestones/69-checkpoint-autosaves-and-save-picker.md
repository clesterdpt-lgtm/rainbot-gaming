# Milestone 69: Checkpoint Autosaves and Save Picker

## Status

in-progress

## Objective

Protect meaningful Mr. Feast progress with a small rolling set of safe checkpoint autosaves while preserving the player's explicit manual save as a separate, player-controlled state. Every Load action should open one clear picker so the player chooses the manual save or a specific autosave instead of the game silently selecting one.

## Scope

- Keep the existing `rainbot_game_save:mr-feast-mansion` manual save slot and cloud behavior unchanged.
- Maintain up to three local, versioned checkpoint autosaves with checkpoint name, room, objective, and timestamp metadata.
- Create autosaves only after stable story or competition checkpoints, never during the welcome, Dev Mode, a live competition, an active threat/search, a timed interaction, hiding/seating, or game over.
- Open the same accessible save picker from the intro, Escape menu, and game-over recovery controls.
- Restore the selected envelope through the existing atomic mansion restore path and normalize transient systems exactly as manual Load already does.

## Out of scope

- Player-named save slots, save renaming, save deletion UI, or an unlimited save browser.
- Changing the shared site-wide `RBGameSaves` API or the existing manual-save cloud contract.
- Mid-command, mid-race, mid-pursuit, or mid-capture autosaves.

## Dependencies

- **Depends on:** Milestone 35 — Player Mobility, Inventory, and Test Menu
- **Blocks:** none

## Acceptance criteria

- [x] The manual save remains independent while up to three newest safe checkpoint autosaves persist under a separate versioned local key; a new autosave never overwrites the manual envelope. — test: `scripts/test-mr-feast-checkpoint-autosaves.mjs::manual slot isolation and rolling checkpoint history`
- [x] Arrival, investigation progression, and completed competitions can create named checkpoints, while welcome, Dev Mode, live competition, pursuit/search, transient interaction, hiding/seating, and game-over states cannot. — test: `scripts/test-mr-feast-checkpoint-autosaves.mjs::safe checkpoint gates`
- [x] Intro, Escape-menu, and game-over Load actions open one accessible picker listing the manual save and each compatible autosave with its source, checkpoint/room, and timestamp; Cancel or Escape returns without mutating gameplay. — test: `scripts/test-mr-feast-checkpoint-autosaves.mjs::shared accessible load picker`
- [x] Selecting a manual or autosave restores that exact player/story snapshot through the existing atomic load path, suppresses the opening welcome on an intro load, and safely omits malformed autosaves. — test: `scripts/test-mr-feast-checkpoint-autosaves.mjs::selected snapshot restore and malformed containment`
- [x] The picker remains fully visible with 44 px-or-larger actions at 1280×820, 390×844, and 568×320, and the browser reports no new console errors. — test: `scripts/test-mr-feast-checkpoint-autosaves.mjs::responsive picker layout`

## Exit condition

User reaches a named checkpoint, creates a different manual save, then chooses Load from either the intro or pause menu → sees both sources with clear labels and restores the one they explicitly select.

## Test plan

1. Add the focused real-browser regression and run it red against the current single-slot direct-load behavior.
2. Add the rolling autosave store, stable-checkpoint gate, shared load picker, and selected-envelope restore path.
3. Run the focused suite, intro cold-load regression, player-systems regression, menu-viewport regression, renovation invariants, runtime/test syntax checks, and `git diff --check`.
4. Inspect `render_game_to_text()` plus desktop, phone, and short-landscape picker captures under `output/playwright/mr-feast-checkpoint-autosaves/`.

## Notes

- Autosaves are local recovery checkpoints rather than additional site-wide game identities, so their storage key deliberately does not use the shared `rainbot_game_save:` prefix.
- The newest three distinct checkpoint ids are retained. Reaching the same checkpoint again replaces its older entry instead of consuming another slot.
- Automated acceptance is complete. The focused Chromium regression covers the rolling store, safe-state gates, all three picker entry points, exact manual/autosave restoration, malformed-record containment, automatic first-clue capture after its book closes, and the three target layouts with zero browser errors.
- Visual proof: `output/playwright/mr-feast-checkpoint-autosaves/load-picker-desktop.png`, `load-picker-mobile.png`, and `load-picker-short-landscape.png`.
- Final exit remains a user playtest comparing one natural checkpoint with a deliberately different manual save.
