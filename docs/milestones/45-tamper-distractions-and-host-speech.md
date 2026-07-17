# Milestone 45 — Tamper Distractions and Host Speech

## Goal

Give the player a distraction economy built on Mr. Feast's fastidiousness: tilting portraits, pulling chairs out of line, and leaving the refrigerator open each summon him to walk over and correct the disorder, announcing his displeasure in a distance-readable speech bubble. The player can also speak with him directly for sophisticated, cryptic, and occasionally creepy host smalltalk.

## Acceptance criteria

- Every framed wall portrait exposes a `Tilt`/`Straighten` interaction that visibly rolls the frame in the wall plane; every standard chair exposes a `Pull askew`/`Straighten` interaction that twists it diagonally and slides it out while its Rapier collider follows the mesh exactly.
- Leaving the kitchen refrigerator door open counts as a third tamper kind with no new player-facing interaction beyond the existing open/close.
- A tampered object is noticed after a tuned delay, then Mr. Feast walks the authored response graph to the object without teleporting, spends a tuned fixing pause facing it, restores it (portrait roll to zero, chair to its original pose and collider, fridge closed), and returns to his interrupted patrol point.
- Tamper tasks reuse the existing patrol → responding → searching → returning response contract; a real camera alarm always preempts housekeeping and re-queues the interrupted tamper, and multiple noticed tampers are fixed one after another before he returns to patrol.
- Straightening the object yourself (or closing the fridge) before he arrives cancels the errand; a just-fixed object holds a short re-tamper cooldown, and an object he is actively correcting cannot be re-tampered mid-fix.
- Noticing and fixing each show one bubble-style speech line over Mr. Feast's head drawn from per-kind pools that mix irritation, menace, and humor; portrait lines can reference the artwork's real title.
- A dedicated `Speak with Mr. Feast` interaction on the host himself plays lines from a sophisticated/cryptic/creepy smalltalk pool with no immediate repeats, briefly pauses his patrol walk, and uses a distinct busy pool when he is mid-errand or mid-alarm.
- The talk hitbox stops below his face so the QA-only expression-cycle interaction keeps owning close-up face aims; outside QA the model itself also converses, so face aims still offer the prompt in normal play.
- The speech bubble is a DOM overlay anchored to his head bone with a fixed screen-space font size of at least 13px, stays legible at any distance, clamps to the viewport edges when he is off-screen or behind the camera so a hiding player still sees it, and fits both 1280×820 and 390×844 layouts.
- Tamper, housekeeping, and speech state are exposed through `window.render_game_to_text()` plus focused `window.MrFeastFresh` QA controls (tamper an object, read tamper/speech state, converse) while `window.advanceTime(ms)` drives all timers deterministically.
- Fixed point-light budget, draw-call batching, and shader-light layout are unchanged; new interactions use invisible material hit targets, not per-mesh raycast registration.

## Verification

- `node --check assets/js/mr-feast-mansion.js` — passed
- `node --check scripts/test-mr-feast-tamper-distractions.mjs` — passed
- `node scripts/test-mr-feast-tamper-distractions.mjs` — passed 19/16/1 portrait/chair/fridge registration, real E-key portrait tilt with collider-synced chair pull, deterministic notice dispatch with an upset line, the walk-fix-return lifecycle with restored decor and zero teleports, camera-alarm preemption and re-queue, self-fix cancellation with re-tamper cooldown, refrigerator closing, talk interaction with patrol pause, non-repeat smalltalk and busy pools, on-screen and edge-clamped bubble geometry at readable font sizes, and desktop/mobile layouts with zero console errors
- `node scripts/test-mr-feast-renovation.mjs` — passed (the shared page-cache-key/assetVersion pin is being juggled by the concurrent Milestone 44 SFX session; keep the pair identical at handoff)
- `node scripts/test-mr-feast-camera-security.mjs` — passed unchanged alarm behavior alongside housekeeping preemption
- `node scripts/test-mr-feast-player-systems.mjs` — passed adjacent input/inventory/menu behavior
- `node scripts/test-mr-feast-contestant-13.mjs` — passed full story progression after the talk hitbox was capped below the face to preserve the QA expression-cycle prompt
- `node scripts/test-mr-feast-readable-books.mjs` — passed adjacent shelf interactions
- `node scripts/test-mr-feast-workroom-security-hub.mjs` and `node scripts/test-mr-feast-basement-key-trail.mjs` — passed adjacent keypad and story-trail behavior
- Browser proofs under `output/playwright/mr-feast-tamper-distractions/`: `tilted-portrait-desktop.png`, `pulled-chair-desktop.png`, `noticed-bubble-desktop.png`, `speech-bubble-desktop.png`, `speech-bubble-mobile.png`
- Live preview pass confirmed the clamped bubble stays fully inside the stage after switching its `max-width` from viewport units to stage-relative percentages (viewport units collapse to `0` in embedded panes reporting `window.innerWidth === 0`)
