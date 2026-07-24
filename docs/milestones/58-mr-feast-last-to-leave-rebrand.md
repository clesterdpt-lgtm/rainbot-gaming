# Milestone 58: Mr Feast: Last to Leave Rebrand

## Status

Implementation and automated acceptance complete; user visual approval pending.

## Objective

Bring the public identity of the mansion game in line with its current reality-competition horror concept. The exact player-facing title becomes `Mr Feast: Last to Leave`, the Rainbot catalog and game page use the same contemporary presentation as the other games, and a new original cover communicates cameras, a storm-bound mansion, and an unsettling host at thumbnail size.

## Scope

- Update the catalog card, game-page title, accessible labels, description, and social metadata without changing the existing URL or save key.
- Replace the old flat poster with original generative cover art made specifically for the current competition-investigation concept.
- Move the detail page onto the shared Rainbot standalone shell, game layout, stage surface, sidebar panel, poster, controls, and how-to patterns while preserving the authoritative `#mansion-stage` runtime.
- Add focused static and browser regression coverage for desktop and mobile presentation.

## Out of scope

- Renaming the existing HTML/JavaScript files, route, local save key, or launcher.
- Rewriting story dialogue, competition rules, mansion geometry, or gameplay systems.
- Adding new gameplay, characters, audio, or runtime 3D models.

## Acceptance criteria

- [x] The catalog card and game page present the exact title `Mr Feast: Last to Leave`; outdated promotional uses of `Mr Feast's Mansion` are removed from those player-facing surfaces. — test: `scripts/test-mr-feast-last-to-leave-rebrand.mjs::source title contract`
- [x] The catalog card uses the new cover and describes a reality-show competition, investigation, and sabotage rather than generic architectural exploration. — test: `scripts/test-mr-feast-last-to-leave-rebrand.mjs::catalog card`
- [x] The detail page uses the shared `rb-standalone-shell`, `game-layout`, `game-stage`, `canvas-wrap`, `game-side`, poster, controls, and how-to patterns without changing `#mansion-stage` or its runtime contract. — test: `scripts/test-mr-feast-last-to-leave-rebrand.mjs::shared shell`
- [x] The new 16:9 cover is legible at card size and shows the fictional host alone, matching his in-game hair, beard, ornate black-and-oxblood costume, and uncanny expression alongside broadcast/surveillance imagery, the storm-bound mansion, and the exact title with no unrelated people, logos, or text. — test: `scripts/test-mr-feast-last-to-leave-rebrand.mjs::cover dimensions and browser load`
- [x] The rebrand does not replace or add anything inside `#mansion-stage`; the existing intro, Escape menu, HUD, prompts, journal, and touch controls remain authoritative and unchanged. — tests: `scripts/test-mr-feast-last-to-leave-rebrand.mjs::native menu ownership`, `scripts/test-mr-feast-contestant-13.mjs`
- [x] Desktop and mobile browser checks show no horizontal overflow, a loaded cover, a usable game stage, and no page/runtime errors. — test: `scripts/test-mr-feast-last-to-leave-rebrand.mjs::desktop and mobile`
- [x] Mansion syntax, renovation, Contestant 13, and focused rebrand regressions pass.
- [ ] User approves the new title, cover direction, and Rainbot page presentation.

## Exit condition

From the Rainbot catalog, the player sees a cover and description that accurately promise a sinister last-to-leave reality competition, opens the unchanged mansion route, and lands on a standard Rainbot game page carrying the same title and artwork around the intact playable runtime.

## Test plan

Add `scripts/test-mr-feast-last-to-leave-rebrand.mjs` before implementation and confirm it fails on the missing title, artwork, and shared-shell contracts. Then run the focused check, `node --check assets/js/mr-feast-mansion.js`, both required mansion suites, `git diff --check`, and desktop/mobile Chromium screenshots with `render_game_to_text()` available.

## Notes

The first generated cover was rejected because its clean-cut modern host and visible contestants did not match the game. The accepted implementation candidate instead uses the game's own character concept and watching-face render as references: Mr Feast appears alone with his swept dark hair, narrow beard, asymmetrical stare, ornate black tailcoat, oxblood waistcoat, cravat, and medallion against the storm-dark foyer and surveillance cameras. The production source remains under the Codex generated-image archive; the site ships a `1600×900`, 487 KB JPEG at `assets/img/mr-feast/card-mr-feast-last-to-leave-ai-v1.jpg`.

Adding the shared `.game-stage` class initially activated Rainbot's universal Escape overlay. A page-level native-menu ownership flag now prevents that injection before it adds a button or key handler. The focused desktop/mobile browser test proves no `#rb-escape-menu` or `.rb-escape-btn` exists, while the complete Contestant 13 suite proves the mansion's native intro, journal, Escape menu, progression, persistence, accessibility, and mobile touch paths still pass. Visual proof is under `output/playwright/mr-feast-last-to-leave-rebrand/`.
