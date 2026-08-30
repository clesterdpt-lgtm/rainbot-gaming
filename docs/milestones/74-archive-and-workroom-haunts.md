# Milestone 74 — Archive and Workroom haunts

## Goal

Turn the Archive lore and patron-relay sabotage into authored physical horror beats without adding HUD objectives, colliders, shader-light variants, or a second audio permission path.

## Implemented scope

- The Feast Father steward volume has moved from the Library writing table to a one-time Archive shelf fall. It remains absent when the player first reaches the basement and begins falling only after they cross the Archive's center line. Its spatial impact, grounded physical prop, shared readable-book presentation, door closure, and brief east-wing blackout form one bounded sequence.
- Three separate preparation files remain on the adjacent Archive shelf. Contestants 04, 09, and 12 each have their own interaction and disturbing kitchen record.
- The Archive and Workroom use transient circuit gates that preserve the player's physical switch state and fixed renderer light topology.
- Cutting the patron relay closes and temporarily locks the Workroom entrance, blacks out the room, and holds all eight live screens in animated static for `18s`. A transparent black mask baked directly from the active `banquet-saint.glb` Feast Father model preserves its thin cage crown, pointed shoulders, separated long hands, narrow torso, and flared robe hem; it begins small inside every feed and grows with the breathing ramp. The close recorded breath rises from near silence to a louder `0.30` peak over `15s`, then the door, lights, live feeds, and audio restore together. The reproducible mask bake is `scripts/blender/render-demon-silhouette.py`.
- Completed one-shot flags and Archive file reads save. Active blackouts, static, and breathing never resume from a save.

## Acceptance evidence

- `MR_FEAST_ARCHIVE_TRIGGER_ONLY=1 node scripts/test-mr-feast-archive-workroom-haunts.mjs`
- `node scripts/test-mr-feast-archive-workroom-haunts.mjs`
- `node scripts/test-mr-feast-readable-books.mjs`
- `node scripts/test-mr-feast-workroom-security-hub.mjs`
- `node scripts/test-mr-feast-shared-light-circuits.mjs`
- `node scripts/test-mr-feast-contestant-13.mjs`
- `node scripts/test-mr-feast-basement-key-trail.mjs`
- `node scripts/test-mr-feast-feast-father-lore.mjs`

The focused Playwright regression captures the Archive impact blackout, readable lore volume, physical preparation files, and Workroom static blackout under `output/playwright/mr-feast-archive-workroom-haunts/`.
