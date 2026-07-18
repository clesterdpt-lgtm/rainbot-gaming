# Milestone 48: Shared Seating and Contestant Routines

## Status

in-progress — implementation and automated acceptance complete; final chair/sofa feel awaits user re-playtest

## Objective

Make the mansion feel occupied instead of staged: the player can sit on authored furniture, while Mara, Kip, and Juniper spend most of their ambient time seated and occasionally stand, walk a compact room-safe route, and settle at another hangout. Standing idle contestants hold relaxed arms-down poses instead of a confused hands-up shrug, and sit/stand transitions interpolate into and out of the furniture. Seating remains a visible, vulnerable state rather than a hiding shortcut, and moving contestants keep their rendered bodies, interactions, speech anchors, and physical colliders synchronized.

## Scope

- Register reusable, exclusively occupied seat slots on the mansion's standard chairs and sofas.
- Let the player sit and stand through the existing E/touch interaction while retaining free look and locking locomotion, sprint, and crouch.
- Give each contestant a sit-dominant in-room routine with named speed, turning, arrival, brief hangout pause, and long seated-dwell values.
- Apply contestant-specific relaxed arms-down rest poses while standing idle, without overriding the walk animation or seated pose.
- Interpolate contestant root position, facing, and pose blend through sit/stand transitions instead of snapping between the floor and seat.
- Keep seated hips and feet planted while subtle upper-body breathing, weight shifts, and glances prevent contestants from becoming statues.
- Use a lower, floor-anchored lounge-sofa profile for Juniper's Reading Room seat so the cushion supports her legs from below instead of intersecting them; keep all other mansion sofas at their existing height.
- Give every standard chair a shared floor-anchored height profile so Mara and Kip clear the cushion while retaining supported hips, forward knees, and floor-near boots; keep sofa tuning independent.
- Enforce a hard seated-dwell ceiling below five minutes and require every contestant to reach a distinct non-seat hangout after standing before that seat can be selected again.
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

- [x] Aiming at an available chair cushion or sofa slot offers `Sit`; E/touch seats the player, changes the prompt to `Stand up`, and the second interaction returns them to a safe grounded position. — test: `scripts/test-mr-feast-seating-and-routes.mjs::player real E and touch sit-stand`
- [x] While seated, W/Shift/C cannot move, sprint, crouch, drain energy, or emit footsteps; free look and Escape remain available, and diagnostics report a visible non-hidden seated state. — test: `scripts/test-mr-feast-seating-and-routes.mjs::seated player movement lock and vulnerability`
- [x] Seat occupancy is exclusive for player and contestants, releases on stand/teleport/load, and never persists as stale save state. — test: `scripts/test-mr-feast-seating-and-routes.mjs::exclusive occupancy and transient recovery`
- [x] Chair-back aiming still pulls/straightens a vacant chair, while a seated chair cannot be tampered with or dispatched as a housekeeping errand until vacated. — test: `scripts/test-mr-feast-seating-and-routes.mjs::chair seating and tamper resolver compatibility`
- [x] Mara, Kip, and Juniper each use a sit-dominant routine with a long seated dwell, occasionally traverse a compact multi-point room route to another hangout, turn toward travel, use a bound walk clip while moving, and pause without gliding. — test: `scripts/test-mr-feast-seating-and-routes.mjs::three deterministic walk-idle-sit routines`
- [x] A standing idle contestant uses their authored relaxed arms-down rest pose instead of the confused hands-up shrug, while walking and seated poses remain activity-specific. — test: `scripts/test-mr-feast-seating-and-routes.mjs::three deterministic walk-idle-sit routines`
- [x] Contestant sit/stand transitions interpolate root position, facing, and pose blend so entering or leaving furniture does not snap or teleport. — test: `scripts/test-mr-feast-seating-and-routes.mjs::three deterministic walk-idle-sit routines`
- [x] Every authored seated dwell is clamped by one runtime ceiling below 300 seconds; after every stand transition, the contestant reaches a distinct non-seat hangout at least 0.35m away before the vacated seat can be selected again. — test: `scripts/test-mr-feast-seating-and-routes.mjs::bounded dwell and post-seat departure`
- [x] Seated contestants visibly breathe, shift their upper torso, and glance on contestant-specific loops while the root, hips, thighs, knees, and feet remain planted. — test: `scripts/test-mr-feast-seating-and-routes.mjs::planted procedural seated idle`
- [x] Juniper's sofa pose moves most of each thigh beyond the cushion front, keeps both knees beyond the fascia, and retains supported hips and floor-near boots at the user's three-quarter embedded-page view. — test: `scripts/test-mr-feast-seating-and-routes.mjs::Juniper sofa support metrics and embedded visual proof`
- [x] The Reading Room sofa alone uses the named `0.77` floor-anchored height scale, placing its cushion top at about `0.55m`; its Rapier collider follows the same scale, every other sofa remains at `1.0` / `0.72m`, and Juniper's thigh line visibly clears the lowered cushion top with a floor-anchored root and planted boots. — test: `scripts/test-mr-feast-seating-and-routes.mjs::lower Reading Room sofa isolation and support alignment`
- [x] Every standard chair uses the named `0.86` floor-anchored height profile, placing its cushion top at about `0.525m` while the existing floor-anchored Rapier/tamper collider remains within `0.03m` of the shortened back-post top; Mara and Kip retain at least `0.025m` thigh clearance, supported hips, forward knees, floor-near boots, and an unchanged floor root in front, profile, and three-quarter proof views, while sofa measurements remain unchanged. — test: `scripts/test-mr-feast-seating-and-routes.mjs::regular-chair fit isolation and multi-angle visual proof`
- [x] Every contestant route stays on its authored floor, clear of static furniture and Mr. Feast's same-floor patrol, while its kinematic collider stays within 0.03m of the rendered root. — test: `scripts/test-mr-feast-seating-and-routes.mjs::route clearance and moving collider sync`
- [x] Contestant walk clips suppress their erratic source arm tracks; imported GLBs preserve GLTFLoader's Y-up orientation and fit to upright 1.65–1.9m vertical-major bounds; contestant and Mr. Feast floor movement rejects forced furniture collisions and steers around fixed furniture while authored stair travel remains intact. — test: `scripts/test-mr-feast-seating-and-routes.mjs::upright contestant bounds and NPC furniture collision probes`
- [x] Conversations still target the moving contestant body and keep the named speech bubble anchored to the live head while idle, walking, or seated. — test: `scripts/test-mr-feast-seating-and-routes.mjs::conversation follows active contestant`
- [x] Failed optional contestant animation loads remain isolated and never block mansion startup or the other contestants. — test: `scripts/test-mr-feast-seating-and-routes.mjs::optional locomotion asset isolation`
- [ ] The seated player and at least one seated contestant read as physically supported, with believable eye/cushion height and no obvious sit/stand snap, skating, or buried legs at 1280×820 and 390×844; standing idle contestants visibly hold relaxed arms-down poses. — verified by user playtest
- [x] Existing contestant conversation, player systems, tamper/housekeeping, Contestant 13, and renovation regressions remain green with zero browser errors or animation-binding warnings. — test: full mansion regression commands in the Test plan

## Exit condition

User approaches a chair or sofa and presses E/taps to sit, then visits Mara, Kip, and Juniper and observes them resting mostly in seats, occasionally rising smoothly to walk a short room route to another hangout, and standing with relaxed arms-down idle poses without invisible blockers or lost dialogue prompts.

## Test plan

1. Write `scripts/test-mr-feast-seating-and-routes.mjs` first and confirm it fails on the missing seating/routine contract before implementation.
2. Run the focused browser test through desktop and 390×844 touch contexts, saving screenshots under `output/playwright/mr-feast-seating-and-routes/`.
3. Run `node --check assets/js/mr-feast-mansion.js`, `node --check scripts/test-mr-feast-seating-and-routes.mjs`, and `git diff --check`.
4. Run `node scripts/test-mr-feast-seating-and-routes.mjs`, `node scripts/test-mr-feast-contestant-conversations.mjs`, `node scripts/test-mr-feast-player-systems.mjs`, `node scripts/test-mr-feast-tamper-distractions.mjs`, `node scripts/test-mr-feast-contestant-13.mjs`, and `node scripts/test-mr-feast-renovation.mjs`.
5. Inspect `render_game_to_text()` before screenshots, then visually review player seating, one chair-seated contestant, one sofa-seated contestant, and Kip's ballroom route on desktop and phone.

## Notes

- The three requests are one ambient-living feature: shared seating is the reusable action, and contestant routines are its first NPC consumer.
- Contestant routes are authored ping-pong routines, not general pathfinding. Their small scope keeps door/security behavior and the mansion single-runtime architecture unchanged; long seated dwells and brief room-scale outings make the routines feel like hanging out rather than continuous patrols.
- Mr. Feast remains patrol-focused in this milestone; the shared seat reservation contract can support a later interruptible host-seat waypoint without coupling it to this slice.
