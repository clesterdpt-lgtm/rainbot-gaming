# SHIFT'S END — Rainbot After Dark · No. 003

**Status:** MVP scaffolded (Puzzle 1 working). Puzzles 2 + 3 stubbed.
**Origin:** Council synthesis 2026-06-15 (Codex/GPT-5.5, Gemini/3.5 Flash, Grok/4.3)
**Differentiation from AGAIN.:** Third-person fixed-camera retail liminal horror. NOT first-person, NOT single-hallway loop. Inventory-driven puzzles, audio-positioning, multi-room.
**Stack:** Vanilla web, Three.js r128 (vendored), WebAudio. No build step. Reuses RB API.

---

## Logline

You've clocked out, but the exit is gone. Navigate an infinite, flickering "Big Box" retail store where the inventory is watching you. Fixed-CCTV perspective, Price Scanner reveals hidden barcodes, planogram puzzles and mannequin encounters gate the Loading Dock exit.

## Setting

The Greatmart. Endless beige linoleum, towering metal shelving, plastic-wrapped pallets. Caught in "closing time" — fluorescent hum, far ends of aisles dissolve into artificial haze. Rainbot brainrot in the products: *Brainrot Bites™, Sigma Scented Candles, NPC Energy Drink*.

## Perspective

Third-person fixed-camera (CCTV high angles, classic survival horror). Camera snaps on zone threshold crossing. Player sees their character — hi-vis vest, "TRAINEE" name tag — from cinematic fixed positions.

---

## MVP Scope (this iteration)

**In scope:**
- Working Three.js scene with one camera angle showing the "Vestibule + first aisle"
- WASD/arrow movement (tank-style relative to camera)
- Price Scanner mechanic (point + click to ping; reveals hidden barcodes on certain objects)
- Planogram puzzle (Puzzle 1) fully playable
- Procedural WebAudio: fluorescent hum bed, muzak loop, scanner beep, success/fail stings
- Esc/pause, R restart

**Out of scope (next iterations):**
- Barcode Sequence puzzle (Puzzle 2) — needs at least 3 zones
- Mannequin Stare puzzle (Puzzle 3) — needs 4 mannequins + camera-cut system
- Night Manager threat — needs full 10-min act structure
- Multiple camera cuts (currently single fixed angle)
- Final act / Loading Dock finale

---

## Core Mechanics

1. **Price Scanner** — handheld device. Click to ping. Reveals hidden barcodes on tagged objects and identifies Non-Stock Entities.
2. **Light Management** — aisle zones can be lit/dark. Push ladder platforms to create light paths.
3. **Inventory Tetris** — cart as mobile grid; tactical carry decisions.
4. **Audio Proximity** — fixed camera means threats heard before seen.

## Puzzle 1 — Planogram (FULLY IMPLEMENTED)

Player finds a discarded Aisle Reset map showing where products must go. Rearranging a shelf of colored detergent bottles to match the diagram opens a hydraulic gate to the next zone.

**Mechanics:**
- 3 bottle slots on a shelf, 6 bottles on the floor (2 of each color)
- Click bottle to pick up, click slot to place
- Match the planogram (specific color positions)
- Wrong placement triggers "manager call" audio sting
- Correct placement plays "register cha-ching" + gate opens

**Audio cues:**
- Pickup: subtle "thunk"
- Place correct: chime
- Place wrong: low buzz
- Complete: register receipt sound + hydraulic gate

---

## Puzzle 2 — Barcode Sequence (STUBBED)

Three "Manager Special" prices hidden in Home Goods. Digits form security office keypad code. Requires Zone 2 (Home Goods) to exist.

## Puzzle 3 — Mannequin Stare (STUBBED)

Four mannequins block the path. Move only when camera angle changes. Find the Blind Spot angle. Requires camera-cut system.

## 10-Minute Act Structure (target)

| Act | Time | Beat | MVP Status |
|-----|------|------|------------|
| I | 0:00-3:00 | Clock out, find scanner, learn fixed cameras in vestibule | ✅ scaffolded |
| II | 3:00-7:00 | Planogram puzzle opens first gate, first Manager sighting | ✅ Puzzle 1 works |
| III | 7:00-10:00 | Home Goods zone, Barcode Sequence, Mannequin Stare | ❌ next iteration |
| IV | 10:00-12:00 | Warehouse + Loading Dock finale | ❌ future |

---

## File Layout

```
/games/shifts-end.html          # Page chrome + game canvas
/assets/js/shifts-end.js        # Game runtime
/docs/shifts-end-plan.md        # This doc
```

## Asset Reuse

- `../assets/vendor/three/three-r128.min.js` (vendored)
- `../assets/css/styles.css` (game-page chrome)
- `../assets/js/main.js` (nav + RB bootstrap)
- `../assets/js/ads.js` (ad slots)

## Brand Voice Anchors

- "Clock in" / "Clock out" / "Shift logged" terminology
- TRAINEE name tag
- Products: *Brainrot Bites™, Sigma Scented Candles, NPC Energy Drink, Rizz-Os, Gyatt Gum*
- PA system: "Clean up in Aisle 9", "Manager to the floor"
- End card: "Shift logged. See you tomorrow."

## Open Questions / Risks

- **Camera-cut system:** hardest technical piece. Tank-style movement within a single fixed angle is straightforward; cutting between fixed angles requires player-position-driven trigger zones and a small state machine.
- **Threat AI:** the Night Manager is a "peripheral only" presence. Implementation: don't render in fixed camera, but render a tall silhouette on a "wrong angle" preview overlay or as a one-frame scare. Cheap, effective.
- **Save state:** RBGameSaves available per main.js. Use it for "shift progress" between sessions.
- **Performance budget:** low-poly by mandate. Use InstancedMesh for shelving rows. Cap DPR at 1.5.

---

## Build Log

- 2026-06-15: Council synthesis (Codex/Gemini/Grok in parallel, ~94s total)
- 2026-06-15: MVP scaffolded (this commit)
