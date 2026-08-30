# 111 — The Gate becomes a wall, and the Bastion's opener becomes a thrust

**Build:** `20260830-bastion-thrust-1`

Two reports from play, and the first one is a good lesson in testing the mechanism rather than the assumption.

## The Standing Gate was scenery with an opinion about damage

`blocksEnemyProjectile` was implemented, wired, and probed — and the wall still did not stop anything, because it is a **damage-path test**. It fires at the moment a bolt has already reached the player and asks whether it should have. Everything upstream of that never heard of the Gate at all: the Gleaner deciding it had line of sight, the bolt's own flight span, and the player and the swarm walking straight through the slab.

The probe passed because it fed the function a synthetic shooter origin and asked "would you block this". That is the function working. It was not the wall working.

**`collide.js` bakes its grid at load and has no runtime insert or removal** — right for a world of static masonry, useless for a wall that stands for eighteen seconds. So the Gate goes in as an **override layer** over the two collision queries that matter, the same shape the Undercroft uses for its cavern floor:

- **`rayBlock`** — every line-of-sight and cover query in the game. `spawnProjectile` sets a bolt's entire span from it (`span = min(pathRange, blocked)`), so a bolt now *dies* at the wall, which is also what makes it look blocked.
- **`blocked`** — the walk solve, `findOpen` and `slide`, for the player and for every creature.

Both wrappers short-circuit on an empty gate list, and `releaseCollision()` puts the originals back. A ray-vs-OBB slab test and a circle-vs-rectangle test in gate-local space; the vertical slab is the wall's own height band, so a jetborne Vigil clears it — which is the counterplay the Bastion's own wall should have.

`blocksEnemyProjectile` is kept as the backstop it should always have been: it catches the one case the ray cannot, a shot already in flight when the Gate lands, whose span was measured against a world that did not yet contain it.

**Measured** with the production `launchEnemyProjectile`, six bolts from a Gleaner 40m beyond the beacon:

| | bolt span | damage to player |
|---|---|---|
| no wall | 40.69 m | 9.35 |
| Gate standing | **18.40 m** | **0** |

Plus: solid underfoot at the wall, clear 3m to the side of it, clear 6m above it.

## The opener does a weird twist mid-swing

It does, and it is not the Bastion's animation. The shared `melee1` is authored for Vesper's polearm: it counters the chest through **1.56 radians** and the pelvis through 0.72 while the blade crosses the body. On a figure carrying a two-handed hammer and a tower shield, that is a torso twisting mid-blow.

So the Bastion opens with a **forward thrust** instead, as asked. `meleeProfile` gains a `clips` map — a figure may now replace whole clips, merged once at build, so the table every other figure sees is untouched and a figure that declares nothing is bit-identical. The Bastion's `melee1`:

- the chest opens **a twelfth** of what the shared clip does; the pelvis barely moves at all
- what moves instead is the **weight** — hips square, body sinks, front foot plants, `slide` and `lean` drive forward
- `sweep: 5` draws the lunge streak rather than a wide crescent, because a thrust that paints an arc is a thrust nobody believes

Its arm track travels almost entirely on the forward axis, and the wrist turns **0.64 radians end to end against 2.2 for the carve** — the near-absence of wrist rotation is what a thrust *is*, and the old opener's 2.2-radian sweep under the shared clip's counter-rotation is exactly what read as the twist.

**Holding forward still turns the press into `meleeLunge`**, which was already the behaviour and is exactly what was asked for: a standing thrust and a charging one are the same blow at two ranges. Measured off the real hook and the real world position — standing press → `melee1`, **0.00m** travelled; forward held → `meleeLunge`, **12.12m**.

melee2 and melee3 are still swings and still gated as swings.

### One authoring note worth keeping

The first cut of the thrust had a dead stop at 3% of mean speed: outboard, height and reach all reversed at the same key, so every component of the hand's velocity crossed zero on one frame. The fix is to **stagger the reversals** — the hand reaches its widest at 0.24, its furthest back at 0.32 and its lowest at 0.39 — so something is always moving and the draw reads as a loaded pause rather than a hitch.

## Proof

- **`saintfall-kenosis-command-probe.mjs` — 32/32**, including the two new gate-collision gates above.
- **`saintfall-kenosis-swing-probe.mjs` — 18/18** (2 known baseline). melee1 as a thrust: jolt 1.97, mid-stall 0.245, contact on the fastest frame, whip 3.91. Plus the two new opener gates.
- **`saintfall-kenosis-arc-probe.mjs` — 12/12.** Its melee1 gate was re-authored rather than relaxed: the Bastion's opener is no longer a swing, so it is judged on **reach**, not on the distance the head travelled. Measured 1.62m of forward reach against the Vigil's 0.70m, with only 0.58m of lateral span — the shape of a thrust, stated as numbers. The other four clips are still gated as swings.
- Kit 40/40, mobility 18/18, doctrine 24/24, import audit clean.
