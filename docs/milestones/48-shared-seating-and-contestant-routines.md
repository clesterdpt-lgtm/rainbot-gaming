# Milestone 48: Shared Seating and Contestant Routines

## Status

in-progress — implementation and automated acceptance complete; final chair/sofa feel awaits user re-playtest

## Objective

Make the mansion feel occupied instead of staged: the player can sit on authored furniture, while Mara, Kip, and Juniper spend most of their ambient time seated and occasionally stand, walk a compact room-safe route, and settle at another hangout. Contestants use coherent relaxed arm chains with a restrained walking counter-swing, and nearby players inside the forward field of view draw a smoothly limited head-and-neck glance from the contestants and Mr. Feast. Sit/stand transitions interpolate into and out of the furniture. Seating remains a visible, vulnerable state rather than a hiding shortcut, and moving contestants keep their rendered bodies, interactions, speech anchors, and physical colliders synchronized.

## Scope

- Register reusable, exclusively occupied seat slots on the mansion's standard chairs and sofas.
- Let the player sit and stand through the existing E/touch interaction while retaining free look and locking locomotion, sprint, and crouch.
- Give each contestant a sit-dominant in-room routine with named speed, turning, arrival, brief hangout pause, and long seated-dwell values.
- Apply contestant-specific coherent shoulder/arm/forearm/hand poses while standing and seated, and replace the rejected source walk-arm tracks with a restrained procedural counter-swing.
- Let nearby contestants and Mr. Feast glance toward the player only inside a named forward field of view, ease back to neutral outside it, and clamp combined head/neck yaw and pitch well below a backward turn.
- Rebuild Juniper's split head normals after decimation, retain a higher-quality face budget, and restore a restrained albedo-based material lift without making her glow.
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
- [x] Standing, walking, and seated arm layers include the complete shoulder-to-hand chain; hands stay separated on their anatomical sides, standing wrists hang below the shoulders, and walking adds a bounded `0.105rad` opposing counter-swing instead of frozen or reversed arms. — test: `scripts/test-mr-feast-seating-and-routes.mjs::coherent arm-chain and procedural swing probes`
- [x] Every seated contestant flexes both elbows through a relaxed `45–105°` range, keeps wrists over the upper thighs, points fingers down the same-side thigh instead of backward, and rolls both hands palm-down so the signed palm normal points toward the thigh surface by at least `0.65`; fingertips finish within `0.11m` of the thigh line. — test: `scripts/test-mr-feast-seating-and-routes.mjs::seated arm support and signed per-rig palm-axis probes`
- [x] Juniper's shipped 50,000-triangle / 1024px GLB has finite unit head normals, no degenerate head triangles, no more than 0.5% inverted head triangles, and no more than 2% flat head triangles; runtime removes skin/cloth metalness and restores only the manifest-authored albedo emission lift. — test: `scripts/test-mr-feast-seating-and-routes.mjs::direct shipped-GLB head shading audit`
- [x] Each contestant smoothly glances toward a nearby player inside the forward 120-degree field, leaves body yaw unchanged, eases back within one degree of neutral, ignores a player behind them, and remains hard-clamped to about 31.5 degrees yaw / 13.8 degrees pitch during a ten-second extreme hold. — test: `scripts/test-mr-feast-seating-and-routes.mjs::contestant attention acquisition, release, and extreme hold`
- [x] Mr. Feast uses the same head-and-neck-only behavior within 4.8m and his narrower forward field, visibly aims the shipped rig's `Head → headfront` direction toward the player, ignores just-outside, rear, hidden, occluded, and distant targets, and never exceeds about 28.7 degrees yaw / 10.3 degrees pitch. — test: `scripts/test-mr-feast-seating-and-routes.mjs::Mr Feast nearby-FOV visual attention boundaries`
- [x] A real E-key conversation makes Mr. Feast stop in idle for the complete spoken-line duration, keeps following the player's live nearby position with his visible face rig, lets the head own movement inside its safe arc, and smoothly turns the body instead of snapping or rotating the head backward when the player moves outside that arc. Camera alarms and witnessed trespass preempt the pause and continue their full security response. — test: `scripts/test-mr-feast-tamper-distractions.mjs::conversation pause, bounded live gaze, and security preemption`
- [x] Contestant sit/stand transitions interpolate root position, facing, pose blend, and the supported-arm IK solution so entering or leaving furniture does not snap or teleport; no transition arm bone rotates more than `0.22rad` in one 30Hz QA frame. — test: `scripts/test-mr-feast-seating-and-routes.mjs::three deterministic walk-idle-sit routines`
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

User approaches a chair or sofa and presses E/taps to sit, then visits Mara, Kip, and Juniper and observes them resting mostly in seats, occasionally rising smoothly to walk a short room route to another hangout, using relaxed separated arms and lap-supported hands, and glancing toward a nearby player without twisting their heads backward. Juniper's face remains smooth and readable at conversational distance. Mr. Feast gives the same restrained nearby-FOV glance, stops for the whole line when spoken to, and follows a nearby moving player without exceeding his anatomical head arc.

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
