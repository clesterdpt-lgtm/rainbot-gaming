# 109 — Six field commands for Kenosis, and the two Orders that answer them

**Build:** `20260829-kenosis-commands-1` · **Scope:** each summit operative gains three call actions — the Concord's own Gilding Rite plus two that belong to them alone — and each doctrine gains a fifth Order that specialises in calling them. The trees go from 4 Orders / 20 rites to **5 Orders / 25 rites each**, the same count Vesper's carries.

The Kenosis operatives had kits and doctrines but nothing to ask the sky for. The command wheel existed on the summit and opened onto an empty dial.

## The six commands

**Shared — GILDING RITE** (`resupply`, keeping its campaign key: it is the same rite, reads the same boon record, and a harness that knows the campaign's name for the gilded call finds it here too). Full vitality, a full reliquary, +40% damage and free flight for twenty seconds.

| White Vigil | | Bastion Penitent | |
|---|---|---|---|
| **Mirror Choir** `#9df3e0` | Three standing afterimages of the Vigil. Low damage on purpose — what it buys is eight seconds in which nothing is shooting at the real one. | **The Standing Gate** `#ff9540` | A reliquary wall, planted facing the caller. It really does stop gleaner fire. |
| **Crescent Rain** `#ffe6a2` | The emitters answer from the cloud deck: nine blades walking outward, weighted 1.7× against anything in the air. | **The Falling Anvil** `#e8503a` | Two tonnes. 460 in eleven metres, and a twenty-metre pressure ring that carries no damage at all and takes the sky away from every flyer inside it. |

The wheel holds exactly three, and that is not a coincidence: `ui.js`'s `WHEEL_POINTS` is a frozen three-entry table and `commandMarkup` falls back to `WHEEL_POINTS[0]` for anything past it — a fourth command would silently stack on top of the first.

## The two call Orders

**ORDER OF THE ANTIPHON** `#c9a8ff` — White Vigil. Call and response. Cooldowns fall 26%; a completed Vigil Step takes five seconds off every command; commands cover 32% more ground for 30% more damage; the marked point holds for eight seconds at 38% speed. **The Response** — every command is answered by lesser echoes of your other two. One call becomes three.

**ORDER OF THE TOCSIN** `#6fd3b0` — Bastion. Strike the bell and stand still. Commands land 48% sooner; calling one braces the Bastion for 48% less damage; they hit 40% harder; every command banks a second use. **The Great Bell** — a command called from behind a raised shield skips its fuse entirely and lands at his feet, dragging everything within twelve metres out of the air.

Both Vows change the *shape* of a call rather than a number, and neither could be a multiplier — so `summit-command.js` asks the doctrine two structured questions (`callEcho`, `callInstant`), gets a small record back, and performs it. No talent id crosses the seam.

## Architecture

`summit-command.js` is a parallel pack, like everything else on this level. `mission.js`'s command layer is 900 lines of relays, sanctuaries, mines, sirens and doctrine fusions welded to Operation Saintfall's phase machine; a trials ground needs none of it. What it needs is the **external contract**, which is small enough to state exactly — `wheelOrder` / `stratagems` / `cooldowns` / `call()` for the wheel, `boon()` and `blocksEnemyProjectile()` for combat, `boon().active` for the pack — so the module answers that and `summit-main.js` merges it onto the level's existing mission stub rather than replacing it (`combat.respawn()` reads `ctx.mission.spawn` unguarded).

Two mechanics needed real homes rather than new ones:

- **The lure is `inst.commandLure`**, combat.js's own attention override, checked *before* ordinary player sensing — which is the only reason the Choir works at all. Anything else is overwritten by a nearby player on the very next frame. The `owner: "mission"` tag is not decoration; combat.js refuses a lure it does not recognise.
- **Enemy slow had no consumer.** `inst.slowUntil` / `inst.slowFactor` was already being written — by the shipped Shearwater rite — and read by *nothing*: the quietest kind of dead mechanic, where the field is set, the probe sees it set, and the creature walks at full speed anyway. Both of combat.js's speed terms now pass through a `speedScale(inst)`, so a slow written anywhere is a slow the player can see. The campaign is provably unchanged: nothing outside Kenosis writes `slowUntil`, so `speedScale` returns 1 and both expressions are arithmetically identical.

## Proof

**`scripts/saintfall-kenosis-command-probe.mjs` — 30/30.** A call action is the hardest thing here to verify by looking: it is asynchronous, it resolves through a shockwave whose return value the caller discards, and every seam it crosses is optional-chained — so `call()` returning its own key proves only that the catalog has an entry. Each command is asked the question it exists to answer, and measured:

- Gilding: pool 40 → 150, and a spend of 80% of the tank leaves it **full** under the blessing and at **26** without it.
- Choir: **three** effigies standing, **four** enemies carrying a `mission`-owned lure, all four damaged by the shatter, zero effigies left afterwards.
- Rain: the same body at the same place takes **46.7** on the ground and **111.1** in the air.
- Gate: a shot whose line crosses the span is stopped; one from behind the player is not; a melee blow is not.
- Anvil: **460** at the centre with the flyer grounded, and a second flyer at 16m grounded for **0** damage.
- The Response: one call, **three** impacts, **two** marked as echoes, three distinct keys.
- The Great Bell: control call lands 21.9m away on a 1.04s fuse; guarded call lands **0.0m away on a 0.0s fuse**.

**`scripts/saintfall-kenosis-doctrine-probe.mjs` — 24/24** across 50 nodes. Measured: swift verse 58 → 42.9, wider verse 12 → 15.8, short fuse 2.0 → 1.04, heavy ordnance 90 → 126, two bells 1 → 2 charges. **`saintfall-kenosis-command-sheet.mjs`** and the doctrine sheet render 13 + 21 plates with zero page errors and zero cue fallbacks. Kenosis regression: kit 40/40, arcs 12/12, mobility 18/18. The summit audit's one failing gate (Via Sacra grade, 104.0% at 528,146) reproduces identically on a clean-HEAD worktree.

## What the contact sheets caught

Every one of these was invisible to the probe and obvious in a still.

1. **`window.setTimeout` was the wrong clock.** Every staged beat — the Rain walking outward, an echo following its parent — was scheduled in wall time. A paused game would keep landing blades, and a harness that advances six *simulated* seconds inside one real frame never sees a timer fire, which is how The Response read as completely dead while being perfectly implemented. Now a sim-time scheduler drained by `update(dt)`.
2. **The Gate rendered as a black rectangle** and took three passes to fix, because it had three separate causes stacked. The ramp's "weathered grey" `#2c2a2b` is an albedo of **0.026** once `paintGeometry` converts it out of sRGB — measured vertices at 0.05. Raising the ramp got them to 0.28–0.54 and the wall was *still* black: a flat vertical plate receives almost nothing in a world with a low sun and near-zero ambient fill, so the face became a colonnade of round staves that catch light from any direction. And it was *still* black — because the level's shadow map covers 2km, its texel is metres across, and an 8.5m slab shadow-acnes against **itself**. A structure that stands for eighteen seconds does not need `receiveShadow`.
3. **The effigies were glowing capsules.** The Choir's whole job is to be mistaken for the operative, and nobody shoots a pill by mistake. Replaced with a merged figure silhouette at the right proportions — including the sidearms, which are the one detail that says *which* operative it is meant to be.
4. **The Anvil read as a small white puff.** The ground here is snow at golden hour: adding light to white does nothing. What reads against snow is darkness and scale, so the hot core is now the smallest part of it and the weight is carried by smoke, thrown grit, a scorch and rings that actually span the radius the number promises.
5. **The beacon column had a hard top edge and no atmosphere fade** — the exact trap the campaign's own `makeBeacon` documents. Additive geometry seen through haze *adds* the sky, so an unpatched beacon 200m out is brighter than one at 50m.

## Probe faults worth recording

Three of the six original failures were the instrument, not the code.

- **The summit has no flying enemy.** Its roster is thresher/gleaner/harrow and the trials' censer-kites are the trials module's own drones, not bestiary instances — so `spawnEnemy("censer-kite")` returns nothing and every flyer assertion silently compares `undefined` to `undefined`. `inst.spec` is a per-instance reference, so replacing it with a copy gives one body wings and leaves every other thresher alone.
- **A thresher does not wait for a fuse.** Charge speed is 7.4 m/s: a body alerted at the beacon has run twenty-five metres by the time a 3.4-second fuse burns down, and every blast assertion reads zero against a target that was simply somewhere else.
- **`input.state.block` is recomputed every frame** from the held keys, so writing it is erased before anything looks. `setTouchHold("block", …)` is the half of that expression a harness can set. And `doctrineVoice` debounces on **real** seconds, so a probe that advanced six simulated seconds inside one real frame is still inside the 0.07s Order gap.
