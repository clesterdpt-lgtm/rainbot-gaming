# Milestone 43 — Readable Mansion Books

## Goal

Make the mansion's decorative books feel like a real estate collection: every visible shelf volume can be examined, and 20 original lore excerpts are shuffled throughout the Library, Reading Room, and Archive on each fresh run.

## Acceptance criteria

- Exactly 20 original book records provide a distinct title, credited author, and short atmospheric excerpt.
- Every ordinary physical shelf book receives one of those records; shuffled cycles distribute all 20 before repeating.
- Every assigned title is subtly printed on its physical 3D spine in shadow-free matte-black ink. The 384 copies remain instanced, while title planes are grouped into 20 reusable instanced batches rather than creating a mesh, material, or texture per book.
- The main Library, upper Reading Room, and basement Archive all contain readable volumes.
- Aiming at a spine shows `Read “Title”`; desktop E/click and the existing mobile interaction control open the selected volume.
- The reader uses an accessible, focus-managed parchment dialog that closes with E, Escape, its close button, or the surrounding backdrop and fits at 1280×820 and 390×844.
- The reserved XIII-marked Contestant 13 copy selects one seeded title, author, and printed excerpt from the same 20-book catalog on each fresh run; its physical spine and reader title match that disguised ordinary volume while the scratch, journal entry, and story progression remain dedicated.
- Reading or rereading that special copy opens the same accessible parchment dialog as ordinary books. The catalog excerpt remains typeset as printed prose, while a separate compressed, slightly uneven blue-ink marginal note—placed at one of three seeded angles—points to the formal-garden shovel and hedge-maze basement key, adds a hurried `Hurry.`, and is signed `XIII`.
- Existing instanced book rendering remains batched. Lightweight shelf-row hit targets resolve individual titles without creating a mesh, material, draw call, or ray target per book.
- Readable-book diagnostics expose seed, catalog size, physical/assigned copy counts, collection counts, interaction-target count, active volume, and a deterministic QA assignment sample.
- `window.render_game_to_text()`, `window.advanceTime(ms)`, and focused `window.MrFeastFresh` QA controls remain available.

## Verification

- `node --check assets/js/mr-feast-mansion.js` — passed
- `node --check scripts/test-mr-feast-readable-books.mjs` — passed
- `node scripts/test-mr-feast-readable-books.mjs` — passed 20 titles, 384 assigned copies with shadow-free matte-black labels in 20 title batches, 35 shelf-row targets, three collections, deterministic reshuffling, seeded clue-book print/position variation, matching XIII spine title, separate printed prose and hurried angled marginalia, desktop/mobile layout, and zero browser errors
- `node scripts/test-mr-feast-renovation.mjs` — passed
- `node scripts/test-mr-feast-basement-key-trail.mjs` — passed desktop E/touch clue progression and the full basement-key trail
- `node scripts/test-mr-feast-contestant-13.mjs` — passed full progression, persistence, accessibility, and mobile touch on final rerun
- `node scripts/test-mr-feast-player-systems.mjs` — passed adjacent inventory, menu, focus, save/load, and maximize behavior
- `node scripts/test-mr-feast-workroom-security-hub.mjs` — passed adjacent keypad focus/input and complete Workroom behavior
- `git diff --check` — passed
- Desktop and mobile proof saved under `output/playwright/mr-feast-readable-books/`, including titled Library/Reading Room/Archive spines and `printed-book-with-handwritten-marginalia-desktop.png`
