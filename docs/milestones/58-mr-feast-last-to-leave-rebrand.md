# Milestone 58: Mr Feast: Last to Leave Rebrand

## Status

In progress.

## Objective

Bring the public identity of the mansion game in line with its current reality-competition horror concept. The exact player-facing title becomes `Mr Feast: Last to Leave`, the Rainbot catalog and game page use the same contemporary presentation as the other games, and a new original cover communicates contestants, cameras, a storm-bound mansion, and an unsettling host at thumbnail size.

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

- [ ] The catalog card and game page present the exact title `Mr Feast: Last to Leave`; outdated promotional uses of `Mr Feast's Mansion` are removed from those player-facing surfaces.
- [ ] The catalog card uses the new cover and describes a reality-show competition, investigation, and sabotage rather than generic architectural exploration.
- [ ] The detail page uses the shared `rb-standalone-shell`, `game-layout`, `game-stage`, `canvas-wrap`, `game-side`, poster, controls, and how-to patterns without changing `#mansion-stage` or its runtime contract.
- [ ] The new 16:9 cover is legible at card size and shows a fictional host, contestants, broadcast/surveillance imagery, the storm-bound mansion, and the exact title with no unrelated logos or text.
- [ ] Desktop and mobile browser checks show no horizontal overflow, a loaded cover, a usable game stage, and no page/runtime errors.
- [ ] Mansion syntax, renovation, Contestant 13, and focused rebrand regressions pass.
- [ ] User approves the new title, cover direction, and Rainbot page presentation.

## Exit condition

From the Rainbot catalog, the player sees a cover and description that accurately promise a sinister last-to-leave reality competition, opens the unchanged mansion route, and lands on a standard Rainbot game page carrying the same title and artwork around the intact playable runtime.

## Test plan

Add `scripts/test-mr-feast-last-to-leave-rebrand.mjs` before implementation and confirm it fails on the missing title, artwork, and shared-shell contracts. Then run the focused check, `node --check assets/js/mr-feast-mansion.js`, both required mansion suites, `git diff --check`, and desktop/mobile Chromium screenshots with `render_game_to_text()` available.

