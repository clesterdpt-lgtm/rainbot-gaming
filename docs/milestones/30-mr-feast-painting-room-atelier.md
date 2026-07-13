# Milestone 30 — Painting Room Atelier

## Objective

Turn the Painting Room into a believable working atelier: repair the misaligned easel, display an original unfinished AI-authored canvas, and surround the studio with a cohesive collection of unsettling mansion art.

## Scope

- Rebuild the easel as a connected A/H-frame with a mast, shelf, clamps, rear support, and stretcher-backed canvas.
- Move the chair and paint cart out of the three-door circulation aisle.
- Add one original unfinished canvas texture and six original wall-art textures.
- Hang the new collection on safe wall segments and bind every piece to the Painting Room light circuit.
- Add regression and rendered QA coverage for alignment, asset loading, room circulation, and desktop/mobile composition.

## Acceptance Criteria

- [x] The easel's angled legs, mast, tray, clamps, canvas, backing, and rear braces form one connected, non-z-fighting structure. Covered by `33 connected realistic easel` regression checks and front/rear rendered views.
- [x] The easel canvas uses a generated artwork that clearly reads as unfinished, including exposed linen and underdrawing. Covered by `33 unfinished easel canvas` and the easel-front view.
- [x] Six unique weird, slightly scary artworks hang around the room without overlapping doors, switches, trim, or one another. Covered by `33 painting-room wall collection` and four wall-inspection views.
- [x] The north–south doorway axis and west entry remain physically clear, while the easel retains a believable collider. Verified by the `paintingSouthToMusic`, `paintingWestEntry`, and `paintingEaselCollision` routes.
- [x] All seven new JPEGs load through the mansion artwork pipeline with no fallbacks and stay within the texture budget. Verified by regression checks and runtime diagnostics (`17/17` loaded, `0` fallbacks).
- [x] Desktop, rear/side, artwork-wall, and mobile QA views are visually approved with no mansion runtime errors. The only browser error remains the pre-existing site-wide missing `favicon.ico` request.

## Exit Condition

Enter the Painting Room from any of its three doors and observe a connected realistic easel with an unfinished canvas, a clear working aisle, and a dense uncanny gallery whose pieces respond to the room light switch.
