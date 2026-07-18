# Milestone 49 — Workroom Keycode Scratches

## Goal

Give the Workroom keypad its long-deferred in-world clue: four Painting Room paintings each conceal a wall scratching of a Roman numeral (the digit's position in the code) and the digit beside it. Tilting a painting — the existing risky tamper interaction Mr. Feast can witness and will come to straighten — reveals its scratch. Each discovery is recorded on the evidence pad in one evolving clue entry that finalizes with the assembled `0513` code. Also fixes the reported live keypad bug where digit presses were silently swallowed.

## Acceptance criteria

- A `WORKROOM_CODE_SCRATCHES` table assigns each of four Painting Room wall paintings (one per wall: `five-doors`, `polite-eclipse`, `garden-knees`, `choir-floorboards`) a Roman numeral order mark (`I`–`IV`) and a digit; the digits joined in numeral order equal `WORKROOM_SECURITY.code` (`0513`).
- Each carrier painting hides a scratched wall marking (numeral plus digit in a broken gouge style consistent with the estate's `XIII` treatment) anchored to the wall behind it. The scratch never tilts with the painting, is hidden while the painting hangs straight, and becomes visible whenever that painting is tilted — by the player, QA, or dev tooling — and hides again when straightened or when Mr. Feast fixes it.
- The first time the player tilts a carrier painting, that scratch is permanently discovered: a discovery toast appears and one evolving `Workroom keypad scratches` entry on the evidence pad records the found numeral–digit pairs in numeral order, with undiscovered positions shown as unknowns.
- Discovering all four finalizes the entry with the assembled code (`… — 0513`) and a completion toast; the full code never appears in the entry before all four are found.
- Discoveries persist through explicit save/load (scratch visibility itself resyncs to the reloaded untampered paintings), reversible Dev Mode grants all four plus the finalized entry and restores the prior state on disable, and a fresh run starts with none.
- The keypad accepts and echoes digit presses even when the Workroom is already unlocked (the live report: a save that had unlocked the Workroom reopened the pad in the accepted state, where digits were silently ignored and read as a dead keypad); submit on an unlocked pad still reports `ACCESS GRANTED`.
- Scratch state is exposed through `window.render_game_to_text()` (targets, per-target revealed/discovered, count, completion; the assembled code only under QA) plus tamper-entry `artId`s, and existing QA tamper controls can drive every reveal deterministically.
- No new lights, raycast targets, or per-frame costs beyond four static scratch planes; the existing portrait tilt interaction is reused unchanged.

## Verification

- `node --check assets/js/mr-feast-mansion.js` — passed
- `node --check scripts/test-mr-feast-workroom-code-clue.mjs` — passed
- `node scripts/test-mr-feast-workroom-code-clue.mjs` — passed the static table/code agreement, hidden-by-default scratches, real E-key reveal with discovery toast and evolving pad entry, straighten re-hide with persistent discovery, Mr. Feast fix re-hide, full four-scratch completion with the assembled code appearing only at the end, save/load persistence with visibility resync, reversible Dev Mode grants, the unlocked-keypad digit-echo regression, and zero console errors
- Adjacent suites re-passed: tamper-distractions, caught-pursuit, workroom-security-hub, contestant-13, renovation
- Browser proofs under `output/playwright/mr-feast-workroom-code-clue/`
