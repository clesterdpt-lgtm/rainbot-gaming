# Milestone 49 — Workroom Keycode Scratches

## Goal

Give the Workroom keypad its long-deferred in-world clue without explaining the connection: four Painting Room paintings each conceal a wall scratching of a Roman numeral and a digit. Tilting a painting — the existing risky tamper interaction Mr. Feast can witness and will come to straighten — reveals its scratch. Each discovery is retained in a neutral Painting Room note so the player can remember the marks, but the HUD never identifies their destination or assembles an answer. Also fixes the reported live keypad bug where digit presses were silently swallowed.

## Acceptance criteria

- A `WORKROOM_CODE_SCRATCHES` table assigns each of four Painting Room wall paintings (one per wall: `five-doors`, `polite-eclipse`, `garden-knees`, `choir-floorboards`) a Roman numeral order mark (`I`–`IV`) and a digit; the digits joined in numeral order equal `WORKROOM_SECURITY.code` (`0513`).
- Each carrier painting hides a scratched wall marking (numeral plus digit in a broken gouge style consistent with the estate's `XIII` treatment) anchored to the wall behind it. The scratch never tilts with the painting, is hidden while the painting hangs straight, and becomes visible whenever that painting is tilted — by the player, QA, or dev tooling — and hides again when straightened or when Mr. Feast fixes it.
- The first time the player tilts a carrier painting, that scratch is permanently discovered: a neutral discovery toast appears and one evolving `Painting Room notes` entry on the evidence pad records the found numeral–digit pairs with undiscovered positions shown as unknowns.
- Discovering all four completes the neutral note with all four raw marks. Neither the on-screen text nor the evidence pad names a keypad, Workroom, access PIN, or code, and it never assembles `0513` into an answer.
- Discoveries persist through explicit save/load (scratch visibility itself resyncs to the reloaded untampered paintings), reversible Dev Mode grants all four plus the finalized entry and restores the prior state on disable, and a fresh run starts with none.
- The keypad accepts and echoes digit presses even when the Workroom is already unlocked (the live report: a save that had unlocked the Workroom reopened the pad in the accepted state, where digits were silently ignored and read as a dead keypad); submit on an unlocked pad still reports `ACCESS GRANTED`.
- Scratch state is exposed through `window.render_game_to_text()` (targets, per-target revealed/discovered, count, completion; the assembled code only under QA) plus tamper-entry `artId`s, and existing QA tamper controls can drive every reveal deterministically.
- No new lights, raycast targets, or per-frame costs beyond four static scratch planes; the existing portrait tilt/straighten interaction flow remains authoritative.

## Refinement — 2026-07-18 clue exposure and finish

- Only the four code-carrier paintings use the stronger `0.32rad` reveal roll; the other mansion portraits retain their subtler `0.17rad` housekeeping tilt.
- Every mark is positioned under the bottom corner raised by its carrier's actual alternating tilt sign. Regression geometry samples the clue plane's inner edge and requires at least 94% of every mark to clear the rotated bottom rail.
- Numerals and digits use deterministic hand-traced paths for `I`, `V`, `0`, `1`, `3`, and `5`, with layered broken gouges, plaster cores, hairline highlights, and stray fibers. Canvas font/text APIs are not used, and all four marks remain readable in real desktop captures plus the representative phone close view.
- The player-facing clue language is intentionally neutral: the toast identifies only scratched plaster and the evidence pad preserves the individual marks as `Painting Room notes`; the player must infer what they open and how to use them.

## Verification

- `node --check assets/js/mr-feast-mansion.js` — passed
- `node --check scripts/test-mr-feast-workroom-code-clue.mjs` — passed
- `node scripts/test-mr-feast-workroom-code-clue.mjs` — passed the static table/code agreement, carrier-only stronger tilt, raised-corner sign alignment, 94% minimum inner-edge exposure, manual non-font gouge paths, hidden-by-default scratches, real E-key reveal with a neutral toast and evolving `Painting Room notes` entry, full raw-mark completion without an assembled answer or keypad/Workroom/PIN/code wording, straighten re-hide with persistent discovery, Mr. Feast fix re-hide, save/load persistence with visibility resync, reversible Dev Mode grants, the unlocked-keypad digit-echo regression, all-four desktop captures, the phone close view, renderer diagnostics, and zero console errors
- Adjacent suites re-passed: tamper-distractions, caught-pursuit, workroom-security-hub, contestant-13, renovation
- Browser proofs under `output/playwright/mr-feast-workroom-code-clue/`: `scratch-{five-doors,polite-eclipse,garden-knees,choir-floorboards}-corner-desktop.png` and `scratch-five-doors-corner-mobile.png`
