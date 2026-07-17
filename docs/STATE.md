# Project state

## Current milestone

**33 — Mr. Feast Face Retopology** is paused after the current visual result was rejected. Its experimental assets remain local reference material only; the original rigged model stays authoritative.

**34 — Basement Key Trail** remains preserved with automated acceptance complete and the subtle shelf-book discovery awaiting user playtest.

**35 — Player Mobility, Inventory, and Test Menu** is in progress with automated acceptance complete and sprint/crouch pacing awaiting user playtest.

**36 — Camera Surveillance and Alarm Investigation** is in progress with automated acceptance complete and stealth timing, feedback, and Mr. Feast search tension awaiting user playtest.

**37 — Workroom Security Hub and Keypad** is in progress with automated acceptance complete and room layout, keypad feel, monitor readability, and ambience awaiting user playtest.

**38 — Estate Statue Trio** is in progress with implementation and automated acceptance complete; the creepy-elegant foyer pair and formal-garden fountain figure await user visual approval.

**39 — Mr. Feast Grounded Gait** is in progress with implementation and automated acceptance complete; planted-foot weight and pacing await user playtest.

**40 — Upper Window Gallery** is in progress with implementation and automated acceptance complete; the wider path and finished railing composition await user playtest.

**41 — Super Slop Character Animation Upgrade** is in progress with implementation and automated acceptance complete; the six-fighter Meshy/Blender roster and ability feel await user playtest.

**42 — Super Slop Mobile Max Screen** is in progress with implementation and automated acceptance complete; portrait/landscape control comfort awaits user phone playtest.

**43 — Readable Mansion Books** is in progress with implementation and automated acceptance complete; the 20-volume lore collection and parchment reader await user playtest.

## Stable baseline

- Playable chain: subtly misfiled Library shelf book → rose-hidden hand shovel → B-13 basement key beneath faint XIII at the deepest hedge-maze dead end → locked Kitchen service stair → Archive evidence cage and recording → keypad-gated Workroom patron-feed sabotage. The future combination clue is not implemented yet; `0513` is the temporary playtest PIN.
- The middle Library case now omits one generated volume so the clue book occupies a clean shelf gap rather than overlapping it. The off-tone spine is pulled about `0.07m` ahead of its neighbors and carries a small scratched `XIII` above the interaction reticle.
- The shelf book separately points to the formal-garden shovel and hedge-maze key; the basement key and unlock are idempotent and exposed in diagnostics.
- Trying the locked Kitchen basement door now gives only generic locked feedback; it no longer repeats the book or reveals the hedge-maze key solution.
- Every ordinary shelf volume in the main Library, upper Reading Room, and basement Archive is now readable. Twenty original titled excerpts shuffle in complete 20-book cycles across 384 physical copies on every fresh run, while the XIII-marked Contestant 13 volume retains its dedicated clue interaction.
- The parchment reader exposes the aimed-at title in the E/touch prompt, manages focus and Escape/E/backdrop closing, and fits desktop and phone layouts. The original instanced books remain batched; 35 invisible shelf-row hit targets resolve individual spines without adding per-book meshes, materials, draw calls, or shader lights.
- Holding `Shift` now sprints at a faster named speed while draining a visible energy reserve; exhaustion blocks sprint until the reserve recovers.
- `C` toggles a slower, lower crouched stance with authoritative `0.5` visibility and `0.32` movement-noise multipliers for the future detection system.
- `Tab` opens and closes the combined carried-object and clue dossier; the previous `I` / `J` bindings are retired, while `Escape` opens a true pause menu with Resume, Maximize, Save, Load, and reversible Dev Mode controls.
- A fresh playthrough withholds the left-side Contestant 13 case file and its Library direction until the player discovers the shelf book; later objectives still appear after that first clue.
- The Tab dossier now presents the shovel, B-13 key, badge, and tape as distinct illustrated cards, while recovered clues are written on one cream ruled-paper evidence pad with a mobile-safe scrolling layout.
- Explicit saves preserve the player transform and Contestant 13 state through `RBGameSaves`. Dev Mode grants every current item/clue and testing gate without completing sabotage, cannot be saved, and restores the exact pre-dev snapshot when disabled.
- The west-lawn garden paving remains one continuous `ShapeGeometry` network, with both approach lamps offset onto the grass beyond the walking line.
- The Music Room grand piano now sits `0.45m` farther north from the south wall, while its rotated table and couch use their true oriented footprints instead of oversized axis-aligned collision boxes.
- Mr. Feast skips the basement patrol branch until the story door is unlocked; full-route QA temporarily releases and restores that lock without advancing story state.
- Thirty-two unsynchronized surveillance cameras now scan 24 eligible interior zones and eight outdoor chokepoints. Bathrooms, the coat-closet hiding space, walk-in wardrobes, the Workroom, and the deep maze remain deliberate blind spots.
- Indoor cameras are centered on cardinal walls with their brackets raised flush to each floor's ceiling underside, and their one-way sweeps now take 10.5–14.5 seconds. The Reading Room unit faces into the room, the redundant camera behind the grand-stair mid-landing is gone, and the pool camera is grounded on a dedicated support post. A small readable green LED marks normal scanning; any visible player acquisition gives three red pulses over 2.4 seconds, then turns solid red and follows room movement. A small transient pill says `Spotted` during those pulses and `Being recorded` after lock, then disappears when observation ends. Permitted show filming can visibly track without raising suspicion, while hostile policy keeps a further two-second escape window before the alarm threshold.
- Camera policy progresses from public-show filming to restricted-basement rules and global lockdown. Watched sabotage alarms immediately; blind patron-feed sabotage starts lockdown without summoning Mr. Feast until a later camera sighting.
- Hostile camera exposure has a grace window, consumes crouch's `0.5` visibility multiplier, respects active hiding, and uses explicit wall/live-door/hedge occluders. A continuous sighting raises only one latched alarm until line of sight is broken.
- Camera alarms record source and last-seen data, then divert Mr. Feast through responding, searching, returning, and patrol along authored route/door points without teleporting. This is bounded investigation, not direct perception or chase.
- The former Workshop and Cold Room are now one continuous, deliberately camera-free `WORKROOM`. The west entrance is the only remaining door; the former east doorway is solid wall and collision, while the two ceiling fixtures, player label, and Mr. Feast route share the merged identity.
- The retained entrance begins behind a persistent four-digit PIN pad with a real in-world terminal and focus-safe desktop/touch overlay. Number entry accepts physical and character-only keyboard events as well as click/touch controls. Explicit save/load and reversible Dev Mode preserve the gate correctly without revealing the code in ordinary diagnostics.
- An eight-screen 4×2 monitor bank cycles through all 32 remaining public cameras. Each low-resolution feed copies its source camera's live lens/yaw/pitch, uses a legible green low-light pass, refreshes one target at a time, and freezes when the player leaves the Workroom vicinity.
- The Workroom now includes a broad operator console, three rolling chairs, three server racks, patch ports, cable trays/bundles, equipment cases, radio, coffee cup, shift logs, binders, and the existing tool bench/relay while preserving the central aisle. Both original ceiling emitters are explicitly reserved inside the unchanged fixed point-light budget; the east fixture remains stronger at `1.55×` intensity with a `7.6m` reach, and three switched emissive task practicals keep the server side readable without darkening the west operator/monitor half.
- Three Meshy-authored, Blender-prepared sculptures now establish the estate's creepy-elegant art language: The Listening Host and The Veiled Waltz replace the foyer's procedural busts, while The Weeping Crown replaces only the primitive fountain figure and preserves the existing basin, water, jets, practical glow, paths, and collider.
- The static Three.js r128 statue assets total 45,985 triangles and 13.1 MB across three uncompressed GLBs with 1024 px PBR textures. Runtime bounds fitting grounds each model at its authored anchor, the foyer pair remains outside the central rug, all three placements have simple fixed colliders, and the black-marble host uses a restrained material-only readability lift rather than a new light.
- Estate-statue diagnostics expose per-model load state, dimensions, triangle/material/texture cost, placement, grounding, and collider state. The provenance manifest preserves the Meshy task IDs/prompts and is regression-locked to the JavaScript runtime IDs and filenames.
- Whole-home patrol still traverses more than 220 authored points across all 29 current major room/stair zones and 20 route doors; while the Workroom is locked, Mr. Feast skips that room branch instead of stalling or walking through its door.
- Mr. Feast continues to use the original 65,000-triangle rigged runtime model. The rejected face-retopology model, reports, and Blender scripts are not part of the active manifest or release baseline.
- The 2.01m fit, 24-bone rig, and whole-home animations remain controlled through the existing static Three.js r128 runtime; a replacement facial direction is deferred.
- Mr. Feast's stalk now preserves the source pelvis and full lower-body rotation chain instead of pulling it toward the idle pose. In-browser toe travel is about 3 degrees off-forward rather than 31–36 degrees, and fixed-step planted intervals stay below 0.051m horizontal drift.
- The stalk cadence is calibrated to the existing 0.62m/s patrol at 0.37 playback and scales to about 0.645 for the existing 1.08m/s camera response. Patrol and response movement share a 0.985 facing gate so he pivots before translating through corners.
- The marble path directly inside the large upper foyer window is now a finished `1.7m`-deep gallery with `1.5m` of usable clearance, replacing the exposed `0.9m` strip. A mansion-matched `0.98m` railing, repeated balusters, brass-topped corner newels, and a full Rapier guard join both side-balcony rails across its open edge.
- Mr. Feast's east, center, and west window-gallery patrol points now share the widened deck centerline at `z=11.15`. The player can complete the full upper-balcony loop without falling, and a forward edge probe stops against the new guard while remaining grounded on the second floor.
- Super Slop Brothers now uses six Meshy-authored, 24-bone fighter rigs prepared in Blender 4.5: Rainbot, Gigachad, Mr. Feast, Skibidi, Sigma, and AI Slop Bot. The preserved processed GLBs are 7.39–8.77 MiB each; raw Meshy masters/actions and editable Blender files remain ignored.
- Each fighter has one 8-column × 13-row WebP atlas covering idle, run, jump, fall, hit, shield, dodge, grab, normal attack, and all four directional specials. The six atlases total 2,206,564 bytes, retain at least a six-pixel transparent margin, and contain zero clipped poses.
- The Canvas2D simulation remains authoritative. Root translation is removed from the offline motion bake, active-match sheets load lazily with the old body atlas as fallback, hitlag freezes animation time, left-facing art mirrors without collision changes, and instant gameplay effects start on their rendered release pose.
- All 24 directional specials now carry explicit animation identity. Deterministic QA executes the real dispatcher and verifies each move's projectile, melee, recovery, counter, reflect, teleport/clone, falling object, trap, or summoned dog alongside clip selection and frame progression.
- Super Slop's phone setup surface now expands enough to expose the fighter, mode, stage, and match controls without a tiny nested viewport. The page HUD is one compact row, keyboard-only instructions are hidden on phone layouts, and menu-only screens no longer show combat controls.
- Entering Max reparents the active nine-button touch dock into the fullscreen canvas subtree, applies safe-area-aware 44 px-or-larger targets, leaves the arena center clear in portrait and landscape, and restores the dock and unchanged match state on exit. Native fullscreen and the CSS fallback share the same behavior.
- Reload starts fresh unless the player explicitly restores a saved game. Mr. Feast still has no collider, direct player perception, pursuit, attack, capture, or failure state outside the bounded camera-alarm investigation.

## Important constraint

The Workroom keypad and security hub are implemented in Milestone 37. Only the in-world clue/puzzle that reveals its combination remains deferred, along with the broader basement sabotage network; use temporary PIN `0513` for the current playtest.

Mobile sprint/crouch buttons remain deferred; Milestone 35 adds the desktop keyboard controls while preserving the existing touch exploration and interaction layer.

Full Mr. Feast sight/hearing perception, live pursuit, capture, recovery, and failure flow remain deferred beyond Milestone 36.

The current face-retopology experiment is paused and must not be published or treated as the active runtime. A future facial pass needs a new visual direction before implementation resumes.

## Verification

- `node --check assets/js/mr-feast-mansion.js` — passed
- `node --check scripts/test-mr-feast-basement-key-trail.mjs` — passed
- `node scripts/test-mr-feast-basement-key-trail.mjs` — passed after the shelf-spacing, `XIII`, and clue-free locked-door refinements: real E/touch interactions, reserved book slot diagnostics, dual clue copy, generic early-door feedback, early gates, idempotent maze key, locked/unlocked door state, full-route lock restoration, Archive recording, Workshop sabotage, desktop/mobile layout, and zero console errors
- `node scripts/test-mr-feast-renovation.mjs` — all current renovation invariants passed in the development checkout; the rejected facial-retopology checkpoint is not part of the release baseline
- `node scripts/test-mr-feast-readable-books.mjs` — passed exactly 20 unique lore titles, all 384 physical assignments, Library/Reading Room/Archive distribution, seed-based reshuffling, physical E interaction, direct QA opening, focus-managed desktop/mobile parchment layout, reserved clue-book priority, unchanged shader-light layout, and zero browser errors
- Previous garden browser proof completed both connection routes with zero fall recoveries and confirmed one `18.8m × 32.4m` walkway mesh
- `node scripts/test-mr-feast-contestant-13.mjs` — passes progression, patrol, persistence, accessibility, mobile touch, and discovery-first objective visibility; its experimental facial-checkpoint coverage is paused with Milestone 33
- `node scripts/test-mr-feast-player-systems.mjs` — passed real-browser keyboard, Rapier movement, stamina lifecycle, crouch eye/stealth contract, Tab dossier toggling with retired I/J bindings, withheld opening guidance, focus-safe pause, maximize, save/load, and reversible Dev Mode with zero console errors
- `node scripts/test-mr-feast-camera-security.mjs` — passed exact 32-camera placement, 24 ceiling-height wall-centered indoor mounts, camera-free Workroom, corrected Reading Room facing, removed mid-landing unit, supported pool fixture, 10.5–14.5 second one-way sweep/reversal, rendered green/red fixture-pixel checks, three-pulse warning, permitted and hostile solid-red tracking, `Spotted`/`Being recorded` status transitions, immediate status dismissal after cover, two-second pre-alarm grace, physical blind-side traversal, show/restricted/lockdown policy, watched sabotage, crouch/hiding, natural and deterministic occlusion, alarm latching, Mr. Feast response/search/return, unchanged light layout, and desktop/mobile HUD checks with zero console errors
- `node scripts/test-mr-feast-workroom-security-hub.mjs` — passed merged west/east room identity, removed doorway, physical-code and character-only keyboard entry, real E/click/touch keypad entry, wrong/correct PIN states, explicit save/load persistence, eight independent render targets, full 32-camera roster, camera-free Workroom diagnostics, distinct/nonblank feed signatures, live sweep-image change, one-feed-per-frame budget, renderer restoration, both budget-selected Workroom fixtures, three task practicals, dual-side luminance, ambience diagnostics, and desktop/mobile layout
- `node scripts/test-mr-feast-estate-statues.mjs` — passed three browser-safe GLB budgets, runtime loading, bounds fitting, grounding, three fixed colliders, removal of the old foyer/fountain primitives, central-aisle clearance, deterministic foyer/garden framing, and zero console errors
- `node scripts/test-mr-feast-grounded-gait.mjs` — passed source lower-body preservation, 3-degree toe travel planes, stride-scaled patrol/response cadence, repeated planted-toe drift, aligned corner translation, four side-on gait phases, and zero console errors
- `node scripts/test-mr-feast-upper-window-gallery.mjs` — passed `1.7m` deck and `1.5m` usable-clearance diagnostics, a real forward walk into the physical upper guard, full balcony-loop traversal with zero fall recoveries, upper/main-floor framing, stable circuits, and zero console errors
- `python3 -m py_compile scripts/blender/prepare-estate-statue.py` and `node --check scripts/meshy-generate.mjs` — passed the reusable Meshy preview/refine and Blender static-prop preparation pipeline checks
- Estate statue browser captures — `output/playwright/mr-feast-estate-statues/foyer-statues-desktop.png` and `garden-fountain-statue-desktop.png` confirm the balanced wall-side foyer composition and the retained working fountain at 1280×820
- Grounded gait browser captures — `output/playwright/mr-feast-grounded-gait/grounded-stalk-00.png`, `grounded-stalk-25.png`, `grounded-stalk-50.png`, `grounded-stalk-75.png`, `corner-pivot-start.png`, and `corner-first-planted-steps.png` confirm a forward-aligned side profile plus pivot-before-travel cornering at 1280×820
- Upper window gallery captures — `output/iterate/2026-07-16-upper-window-gallery-after.png` and `output/iterate/2026-07-16-upper-window-gallery-foyer-after.png` confirm the wider marble path, continuous front guard, clean side-rail returns, large-window relationship, and foyer sightline at 1280×820
- Workroom browser captures — `output/playwright/mr-feast-workroom-security-hub/workroom-monitor-wall-desktop.png`, `workroom-both-sides-desktop.png`, `workroom-keypad-desktop.png`, and `workroom-keypad-mobile.png` confirm the camera-free live 4×2 wall, balanced room lighting, and working access terminal at 1280×820 and 390×844. In `output/iterate/2026-07-16-workroom-dual-lighting-before.png` versus `output/iterate/2026-07-16-workroom-dual-lighting-after.png`, the west operator region rises from `0.304` / `0.07%` to `20.367` / `47.21%` while the east server region holds at `52.970` / `62.09%` mean-luminance/visible-pixel coverage.
- Camera browser captures — `output/playwright/mr-feast-camera-security/camera-indicator-green-desktop.png`, `camera-indicator-warning-red-desktop.png`, `camera-permitted-tracking-desktop.png`, `camera-solid-red-tracking-desktop.png`, `camera-status-desktop.png`, and `camera-status-mobile.png` confirm readable fixture feedback, tracking states, and the transient status pill at 1280×820 and 390×844
- Camera placement captures — `output/iterate/2026-07-16-camera-reading-facing.png`, `2026-07-16-camera-stair-landing-removed.png`, and `2026-07-16-camera-pool-post-close.png` confirm the corrected Reading Room facing, empty mid-landing wall, ceiling-height indoor bracket, and grounded pool support at 1280×820 with zero console errors
- The focused player-system suite also verifies four unique scalable object icons, the ruled handwritten clue pad, and in-stage title/close placement without horizontal overflow at 390×844
- `musicTableWestClearance` QA route — clears the couch-table aisle beyond `z=8.0`, grounded with zero fall recoveries, unchanged light circuits, and zero console errors
- Browser captures — `output/iterate/2026-07-15-music-room-layout-a.png` and `output/iterate/2026-07-15-music-room-layout-b.png` confirm the piano wall clearance and corrected center-table layout
- Browser capture — `output/iterate/2026-07-16-tab-inventory-no-library-prompt.png` confirms the opening foyer has no left-side Library direction and displays the new Tab inventory control
- Browser captures — `output/iterate/2026-07-16-inventory-icons-notepad-desktop.png` and `output/iterate/2026-07-16-inventory-icons-notepad-mobile.png` confirm the illustrated object cards and evidence-pad treatment at both target layouts
- `python3 -m py_compile scripts/blender/retopologize-mr-feast-face.py` — passed
- `python3 -m py_compile scripts/blender/prepare-super-slop-fighter.py scripts/build-super-slop-animation-atlas.py` — passed under the bundled Python/Blender 4.5 toolchain
- `node --check assets/js/super-slop-brothers.js` and `node --check scripts/test-super-slop-character-animations.mjs` — passed with bundled Node 24
- `node scripts/test-super-slop-character-animations.mjs` — passed six manifests/rigs/sheets, all 624 decoded poses, exact atlas layout, animation variation, all 24 real special dispatches, release-pose sync, frame progression, hitlag freeze, read-only diagnostics, lazy active-roster loading, forced legacy fallback, four-fighter rendering, desktop/mobile layout, touch controls, and zero unexpected browser errors
- Super Slop browser captures — `output/iterate/super-slop-character-upgrade/all-24-specials-contact-sheet.jpg` summarizes the 24 deterministic ability captures; the source desktop, mobile, and fallback proofs are under `output/playwright/super-slop-character-animations/`
- `node scripts/test-super-slop-mobile-maximize.mjs` — passed 390×844 embedded/portrait-max and 844×390 landscape-max layouts, native fullscreen subtree and rejected-request fallback paths, nine visible non-overlapping touch targets, safe-area/chrome geometry, real movement and attack input, max exit/restoration, zero horizontal overflow, and zero console/page errors
- Super Slop mobile captures — `output/playwright/super-slop-mobile-maximize/after-portrait-embedded.png`, `after-portrait-max.png`, and `after-landscape-max.png` confirm the complete phone setup UI, lower-letterbox portrait dock, and edge-mounted landscape controls
- Browser captures — `output/playwright/mr-feast-player-systems/sprint-energy-hud-desktop.png`, `escape-menu-desktop.png`, and `inventory-and-clues-dev-desktop.png` confirm the new HUD and overlays; the existing basement-key captures continue to cover the adjacent story states
- Readable-book captures — `output/playwright/mr-feast-readable-books/readable-book-desktop.png` and `readable-book-mobile.png` confirm the centered parchment volume, title/author hierarchy, short drop-cap excerpt, close affordance, and unobtrusive scene backdrop at 1280×820 and 390×844

## Next action

User enters the temporary PIN `0513`, confirms number keys visibly populate the Workroom pad, and checks that the camera-free room and brighter east server bank feel right while walking around. The widened upper-window gallery, grounded-gait pacing, estate-statue approval, camera warning/search tension, Music Room spacing, sprint/crouch feel, Mr. Feast facial approval, and the unguided Library shelf-book discovery remain separate playtests.

For mansion books, user aims at several spines in the Library, Reading Room, and Archive, confirms their titles and excerpts vary naturally, and checks that the parchment reader feels quick to open and dismiss while exploring.

## Working conventions

- Preserve the current static Three.js/Blender GLB architecture from ADR 0001.
- Preserve Super Slop Brothers' static Canvas2D runtime; Meshy/Blender stay offline and sprite atlases remain a visual layer over existing gameplay authority.
- Keep the three unrelated `.rainbot-*-state.json` files untouched.
- Do not commit or push this milestone unless the user asks.
