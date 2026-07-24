# Milestone 61: Reveal the Bulk Storage Secret

## Status

in-progress

## Objective

Turn the basement Bulk Storage room into a compact physical investigation scene: ordinary center-floor boxes conceal demonic floor markings, the player must hold E and move to push or pull those boxes aside, and a discarded set of Kip's distinctive clothes in the far corner becomes a persistent clue. This deepens the existing below-grade mystery without making the secret a competition objective or adding another HUD layer.

## Scope

- Replace the fixed center-line storage crates with a small cluster of solid movable boxes.
- Let keyboard players hold E while moving to push or pull a targeted box; reuse the same held Interact contract for touch controls.
- Place several restrained oxblood/soot demonic markings physically beneath the initial box positions so the boxes, rather than a visibility flag, hide them.
- Add a recognizable dark-green and leather-trimmed clothing pile in the room corner that recalls Kip's outfit.
- Show the observation `This dark green jacket and leather-trimmed shirt look like what Kip was wearing.` on interaction and preserve it in the clue dossier.
- Expose deterministic box, symbol-coverage, held-interaction, clothing-clue, and save/load diagnostics.

## Out of scope

- Turning the symbols into a lock, combination, collectible, ritual, or competition gate.
- A new Mr. Feast response, pursuit rule, audio asset, HUD element, inventory object, or objective arrow.
- Changing Kip's Feast Says elimination, adding a body reveal, or explaining who placed the clothes and symbols.
- General-purpose physics for every crate or furniture item in the mansion.

## Dependencies

- **Depends on:** Milestone 34 — Basement Key Trail; Milestone 52 — Feast Says First Competition
- **Blocks:** none

## Acceptance criteria

- [x] Bulk Storage contains at least four solid center-floor boxes and at least three always-present floor symbols that begin physically covered by those boxes. — test: `scripts/test-mr-feast-bulk-storage-secret.mjs::initial physical concealment`
- [x] A reachable box prompt tells the player to hold E; holding E while moving forward pushes a box, moving backward pulls one, releasing E ends the grab, and an ordinary E press still activates non-hold clues. — test: `scripts/test-mr-feast-bulk-storage-secret.mjs::real held keyboard manipulation`
- [x] Moving the covering boxes exposes all demonic symbols without spawning, fading, or toggling the markings, while the solid colliders remain aligned with the visible boxes and the cluster stays inside Bulk Storage. — test: `scripts/test-mr-feast-bulk-storage-secret.mjs::physical reveal and collider alignment`
- [x] The existing touch Interact button supports the same hold-and-move contract without adding a new control. — test: `scripts/test-mr-feast-bulk-storage-secret.mjs::touch hold parity`
- [x] Kip's dark-green, leather-trimmed clothing is visible in a room corner, exposes a real E/touch interaction, shows text saying it looks like what Kip was wearing, and adds exactly one persistent clue-dossier entry. — test: `scripts/test-mr-feast-bulk-storage-secret.mjs::Kip clothing clue`
- [x] Save/load restores moved box positions and the discovered Kip-clothing clue, releases any transient grab, and does not duplicate the journal entry. — test: `scripts/test-mr-feast-bulk-storage-secret.mjs::save restore contract`
- [ ] User playtest confirms the boxes read as ordinary movable storage, the markings remain genuinely hidden until uncovered, and the clothing resembles Kip's outfit without over-explaining the secret. — verified by user playtest

## Exit condition

User enters Bulk Storage, holds E while moving to push or pull the center boxes, reveals the demonic floor markings beneath them, then inspects the corner clothing → sees text that it looks like what Kip was wearing and finds the observation once in the Bag clue dossier.

## Test plan

Create `scripts/test-mr-feast-bulk-storage-secret.mjs` before implementation and confirm it fails on the missing named tuning/system contract. The focused browser sequence then checks the initially covered symbols, drives real keyboard and touch holds through the existing input path, captures before/after room views, interacts with Kip's clothing, and proves save/load restoration plus zero browser-console errors. Final verification includes runtime/test syntax, the focused suite, ambient details, player systems, basement key trail, Contestant 13, Feast Hunt, renovation, and `git diff --check`.

## Notes

- The boxes and floor marks belong to one focused `BulkStorageSecretSystem` inside the existing single mansion runtime.
- The symbols are real depth-tested floor geometry from boot; reveal state is derived from box coverage, not an authored show/hide switch.
- The clothing observation extends the clue dossier but deliberately does not call or advance a sanctioned competition.
- Red-first evidence: the focused regression initially failed on the absent `BULK_STORAGE_SECRET` contract, then passed its desktop and 390×844 mobile browser sequence with zero console errors.
- Automated verification passed runtime/test syntax, focused Bulk Storage, ambient details, basement key trail, complete Contestant 13, complete Feast Hunt, flashlight, and `git diff --check`. The broader renovation checker currently stops on an unrelated curtain-hiding source-shape assertion (`leaveLabel` versus a literal `Leave` token), and Player Systems reaches its unrelated existing phone-control-height gate at about 25.4% versus 24%.
- Visual proof: `output/playwright/mr-feast-bulk-storage-secret/bulk-storage-secret-covered-desktop.png`, `bulk-storage-secret-revealed-desktop.png`, `kip-clothing-corner-desktop.png`, `kip-clothing-observation-desktop.png`, and `bulk-storage-touch-hold-mobile.png`.
