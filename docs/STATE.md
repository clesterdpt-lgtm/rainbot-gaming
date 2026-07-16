# Project state

## Current milestone

**34 — Basement Key Trail** remains preserved with automated acceptance complete and the subtle shelf-book discovery awaiting user playtest.

**35 — Player Mobility, Inventory, and Test Menu** is in progress with automated acceptance complete and sprint/crouch pacing awaiting user playtest.

**36 — Camera Surveillance and Alarm Investigation** is in progress with automated acceptance complete and stealth timing, feedback, and Mr. Feast search tension awaiting user playtest.

## Stable baseline

- Playable chain: subtly misfiled Library shelf book → rose-hidden hand shovel → B-13 basement key beneath faint XIII at the deepest hedge-maze dead end → locked Kitchen service stair → Archive evidence cage and recording → Workshop patron-feed sabotage.
- The middle Library case now omits one generated volume so the clue book occupies a clean shelf gap rather than overlapping it. The off-tone spine is pulled about `0.07m` ahead of its neighbors and carries a small scratched `XIII` above the interaction reticle.
- The shelf book separately points to the formal-garden shovel and hedge-maze key; the basement key and unlock are idempotent and exposed in diagnostics.
- Holding `Shift` now sprints at a faster named speed while draining a visible energy reserve; exhaustion blocks sprint until the reserve recovers.
- `C` toggles a slower, lower crouched stance with authoritative `0.5` visibility and `0.32` movement-noise multipliers for the future detection system.
- `Tab` opens and closes the combined carried-object and clue dossier; the previous `I` / `J` bindings are retired, while `Escape` opens a true pause menu with Resume, Maximize, Save, Load, and reversible Dev Mode controls.
- A fresh playthrough withholds the left-side Contestant 13 case file and its Library direction until the player discovers the shelf book; later objectives still appear after that first clue.
- The Tab dossier now presents the shovel, B-13 key, badge, and tape as distinct illustrated cards, while recovered clues are written on one cream ruled-paper evidence pad with a mobile-safe scrolling layout.
- Explicit saves preserve the player transform and Contestant 13 state through `RBGameSaves`. Dev Mode grants every current item/clue and testing gate without completing sabotage, cannot be saved, and restores the exact pre-dev snapshot when disabled.
- The west-lawn garden paving remains one continuous `ShapeGeometry` network, with both approach lamps offset onto the grass beyond the walking line.
- The Music Room grand piano now sits `0.45m` farther north from the south wall, while its rotated table and couch use their true oriented footprints instead of oversized axis-aligned collision boxes.
- Mr. Feast skips the basement patrol branch until the story door is unlocked; full-route QA temporarily releases and restores that lock without advancing story state.
- Thirty-five unsynchronized surveillance cameras now scan 27 eligible interior zones and eight outdoor chokepoints. Bathrooms, the coat-closet hiding space, walk-in wardrobes, and the deep maze remain deliberate blind spots.
- Indoor cameras are centered on cardinal walls rather than tucked into corners, and their one-way sweeps now take 10.5–14.5 seconds. A small green LED marks normal scanning; hostile acquisition gives three red pulses, then turns solid red and follows the player within the authored sweep before the alarm threshold.
- Camera policy progresses from public-show filming to restricted-basement rules and global lockdown. Watched sabotage alarms immediately; blind patron-feed sabotage starts lockdown without summoning Mr. Feast until a later camera sighting.
- Hostile camera exposure has a grace meter, consumes crouch's `0.5` visibility multiplier, respects active hiding, and uses explicit wall/live-door/hedge occluders. A continuous sighting raises only one latched alarm until line of sight is broken.
- Camera alarms record source and last-seen data, then divert Mr. Feast through responding, searching, returning, and patrol along authored route/door points without teleporting. This is bounded investigation, not direct perception or chase.
- Whole-home patrol: 624.95m through 227 waypoints, all 30 major room/stair zones, and 21 route doors across the main, upper, and basement levels.
- Reload starts fresh unless the player explicitly restores a saved game. Mr. Feast still has no collider, direct player perception, pursuit, attack, capture, or failure state outside the bounded camera-alarm investigation.

## Important constraint

The future Workshop keypad/code clue chain and broader basement puzzle/sabotage network are intentionally deferred beyond Milestone 34. The Workshop stays accessible for the existing patron-feed ending until that later milestone is designed.

Mobile sprint/crouch buttons remain deferred; Milestone 35 adds the desktop keyboard controls while preserving the existing touch exploration and interaction layer.

Full Mr. Feast sight/hearing perception, live pursuit, capture, recovery, and failure flow remain deferred beyond Milestone 36.

## Verification

- `node --check assets/js/mr-feast-mansion.js` — passed
- `node --check scripts/test-mr-feast-basement-key-trail.mjs` — passed
- `node scripts/test-mr-feast-basement-key-trail.mjs` — passed after the shelf-spacing and `XIII` refinement: real E/touch interactions, reserved book slot diagnostics, dual clue copy, early gates, idempotent maze key, locked/unlocked door state, full-route lock restoration, Archive recording, Workshop sabotage, desktop/mobile layout, and zero console errors
- `node scripts/test-mr-feast-renovation.mjs` — all renovation and Milestone 34/Requirement 47 invariants passed on the isolated publish patch
- Previous garden browser proof completed both connection routes with zero fall recoveries and confirmed one `18.8m × 32.4m` walkway mesh
- Browser captures — `output/playwright/mr-feast-basement-key-trail/library-shelf-book-subtle-desktop.png` now visibly confirms the clean gap and correctly ordered `XIII`; `basement-door-locked-desktop.png`, `basement-door-unlocked-desktop.png`, and `library-shelf-book-mobile.png` cover the adjacent states
- `node scripts/test-mr-feast-player-systems.mjs` — passed real-browser keyboard, Rapier movement, stamina lifecycle, crouch eye/stealth contract, Tab dossier toggling with retired I/J bindings, withheld opening guidance, focus-safe pause, maximize, save/load, and reversible Dev Mode with zero console errors
- `node scripts/test-mr-feast-camera-security.mjs` — passed 35-camera placement, 27 wall-centered indoor mounts, 10.5–14.5 second one-way sweep/reversal, three-pulse red warning, solid-red pre-alarm tracking, physical blind-side traversal, show/restricted/lockdown policy, watched sabotage, crouch/hiding, natural and deterministic occlusion, alarm latching, Mr. Feast response/search/return, unchanged light layout, and desktop/mobile HUD checks with zero console errors
- Camera browser captures — `output/playwright/mr-feast-camera-security/camera-suspicion-desktop.png` and `camera-suspicion-mobile.png` confirm the working fixture and compact lockdown meter at 1280×820 and 390×844
- The focused player-system suite also verifies four unique scalable object icons, the ruled handwritten clue pad, and in-stage title/close placement without horizontal overflow at 390×844
- `node scripts/test-mr-feast-contestant-13.mjs` — passed progression, gates, persistence, accessibility, mobile touch, and discovery-first objective visibility
- `musicTableWestClearance` QA route — clears the couch-table aisle beyond `z=8.0`, grounded with zero fall recoveries, unchanged light circuits, and zero console errors
- Browser captures — `output/playwright/mr-feast-player-systems/sprint-energy-hud-desktop.png`, `escape-menu-desktop.png`, and `inventory-and-clues-dev-desktop.png` confirm the new HUD and overlays

## Next action

User watches the slower wall-centered indoor and outdoor camera sweeps, confirms the green → three red pulses → solid-red tracking sequence is readable, crosses a blind window, tests watched versus blind Workshop sabotage, and judges the lockdown warning plus Mr. Feast investigation timing. Music Room spacing, sprint/crouch feel, and the now-unguided Library shelf-book discovery remain separate Milestone 34–35 playtests.

## Working conventions

- Keep the three unrelated `.rainbot-*-state.json` files untouched.
- Do not commit or push this milestone unless the user asks.
