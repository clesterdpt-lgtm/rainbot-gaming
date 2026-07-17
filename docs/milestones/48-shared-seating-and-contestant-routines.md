# Milestone 48: Shared Seating and Contestant Routines

## Status

in-progress

## Objective

Make the mansion feel occupied instead of staged: the player can sit on authored furniture, and Mara, Kip, and Juniper move through compact room-safe routines that include walking, pausing, and taking a seat. Seating remains a visible, vulnerable state rather than a hiding shortcut, and moving contestants keep their rendered bodies, interactions, speech anchors, and physical colliders synchronized.

## Scope

- Register reusable, exclusively occupied seat slots on the mansion's standard chairs and sofas.
- Let the player sit and stand through the existing E/touch interaction while retaining free look and locking locomotion, sprint, and crouch.
- Give each contestant a short in-room route with named speed, turning, arrival, pause, and seating values.
- Reuse the existing authored Meshy walk sources as stripped animation-only runtime clips; runtime translation remains authoritative.
- Move contestant Rapier colliders with their rendered roots and keep dialogue/head anchoring correct in every activity.
- Add a small ballroom sideline chair outside the dance-floor and Mr. Feast circulation lanes so Kip's routine can include a seated break.
- Expose seat occupancy, player posture, contestant activity, route progress, animation, distance, clearance, and collider alignment through diagnostics and focused QA controls.

## Out of scope

- Turning sitting into hiding, immunity, autosave state, or a stealth multiplier.
- Beds, toilets, piano stools, Workroom operator chairs, and outdoor benches in this first seating pass.
- Reworking Mr. Feast's patrol/security state machine to add host seating.
- New dialogue, story progression, camera policy, or broad mansion pathfinding.

## Dependencies

- **Depends on:** Milestone 47 — Mansion Contestant Conversations
- **Blocks:** none

## Acceptance criteria

> Every checkable AC must reference the test that proves it. AC that depends on visual feel is explicitly reserved for user playtest.

- [ ] Aiming at an available chair cushion or sofa slot offers `Sit`; E/touch seats the player, changes the prompt to `Stand up`, and the second interaction returns them to a safe grounded position. — test: `scripts/test-mr-feast-seating-and-routes.mjs::player real E and touch sit-stand`
- [ ] While seated, W/Shift/C cannot move, sprint, crouch, drain energy, or emit footsteps; free look and Escape remain available, and diagnostics report a visible non-hidden seated state. — test: `scripts/test-mr-feast-seating-and-routes.mjs::seated player movement lock and vulnerability`
- [ ] Seat occupancy is exclusive for player and contestants, releases on stand/teleport/load, and never persists as stale save state. — test: `scripts/test-mr-feast-seating-and-routes.mjs::exclusive occupancy and transient recovery`
- [ ] Chair-back aiming still pulls/straightens a vacant chair, while a seated chair cannot be tampered with or dispatched as a housekeeping errand until vacated. — test: `scripts/test-mr-feast-seating-and-routes.mjs::chair seating and tamper resolver compatibility`
- [ ] Mara, Kip, and Juniper each traverse a compact multi-point room route, turn toward travel, use a bound walk clip while moving, pause without gliding, complete a seated dwell, and resume without teleporting. — test: `scripts/test-mr-feast-seating-and-routes.mjs::three deterministic walk-idle-sit routines`
- [ ] Every contestant route stays on its authored floor, clear of static furniture and Mr. Feast's same-floor patrol, while its kinematic collider stays within 0.03m of the rendered root. — test: `scripts/test-mr-feast-seating-and-routes.mjs::route clearance and moving collider sync`
- [ ] Conversations still target the moving contestant body and keep the named speech bubble anchored to the live head while idle, walking, or seated. — test: `scripts/test-mr-feast-seating-and-routes.mjs::conversation follows active contestant`
- [ ] Failed optional contestant animation loads remain isolated and never block mansion startup or the other contestants. — test: `scripts/test-mr-feast-seating-and-routes.mjs::optional locomotion asset isolation`
- [ ] The seated player and at least one seated contestant read as physically supported, with believable eye/cushion height and no obvious skating or buried legs at 1280×820 and 390×844. — verified by user playtest
- [ ] Existing contestant conversation, player systems, tamper/housekeeping, Contestant 13, and renovation regressions remain green with zero browser errors or animation-binding warnings. — test: full mansion regression commands in the Test plan

## Exit condition

User approaches a chair or sofa and presses E/taps to sit, then visits Mara, Kip, and Juniper and observes each walking a short room route and taking a believable seated break without invisible blockers or lost dialogue prompts.

## Test plan

1. Write `scripts/test-mr-feast-seating-and-routes.mjs` first and confirm it fails on the missing seating/routine contract before implementation.
2. Run the focused browser test through desktop and 390×844 touch contexts, saving screenshots under `output/playwright/mr-feast-seating-and-routes/`.
3. Run `node --check assets/js/mr-feast-mansion.js`, `node --check scripts/test-mr-feast-seating-and-routes.mjs`, and `git diff --check`.
4. Run `node scripts/test-mr-feast-seating-and-routes.mjs`, `node scripts/test-mr-feast-contestant-conversations.mjs`, `node scripts/test-mr-feast-player-systems.mjs`, `node scripts/test-mr-feast-tamper-distractions.mjs`, `node scripts/test-mr-feast-contestant-13.mjs`, and `node scripts/test-mr-feast-renovation.mjs`.
5. Inspect `render_game_to_text()` before screenshots, then visually review player seating, one chair-seated contestant, one sofa-seated contestant, and Kip's ballroom route on desktop and phone.

## Notes

- The three requests are one ambient-living feature: shared seating is the reusable action, and contestant routines are its first NPC consumer.
- Contestant routes are authored ping-pong routines, not general pathfinding. Their small scope keeps door/security behavior and the mansion single-runtime architecture unchanged.
- Mr. Feast remains patrol-focused in this milestone; the shared seat reservation contract can support a later interruptible host-seat waypoint without coupling it to this slice.
