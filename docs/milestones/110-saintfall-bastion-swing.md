# 110 — The Bastion's swing, and the frame where the gauntlet flipped

**Build:** `20260829-kenosis-swing-1` · **Scope:** "the Bastion still feels clunky" turned into three measurements, and the largest cause turned out to be a rig-wide defect present on every figure in the game — including Vesper.

## Making "clunky" a number

`scripts/saintfall-kenosis-swing-probe.mjs` follows the point on the mounted weapon furthest from its palm, through every melee clip, **sampled once per frame at the rate the game actually runs**, and reports:

- **jolt** — the worst single-frame change in tip speed, as a multiple of the mean. One enormous spike is exactly what the eye catches and exactly what an average hides.
- **whip** — peak over mean. A heavy weapon is not a light weapon played slowly; it coils, accelerates and arrives. A flat profile is a prop being carried.
- **contact phase** — where peak speed sits against the clip's own damage window. A blow whose fastest frame happens before it can hurt anything reads as disconnected from its own effect.
- **mid-stall** — the slowest frame on the way to the target.

The sampling rate is not incidental. The first version stepped at 1/480 and reported a 77 m/s spike that no player could experience: `handTurnStep` rate-limits the wrist as `18 * clamp(dt, 1/240, 1/30)`, so a probe finer than 1/240 lets the hand turn further per unit of real time than the game ever will.

## What it found

| | before | after |
|---|---|---|
| melee1 worst jolt | **8.03** | **1.94** |
| melee1 peak tip speed | **74.5 m/s** | **32.2 m/s** |
| contact at peak speed | 2 of 5 clips | **5 of 5** |
| melee3 mid-stall | stops dead | clears |

For reference the White Vigil — the operative the report called *passable* — sits at 2.78 worst jolt and 38.5 m/s. The Bastion is now better than the bar it was measured against.

## Three causes, in the order they were ruled out

**1. Linear interpolation.** Both the arm tracks and the wrist tracks were sampled with a straight lerp: constant velocity inside each segment, instantaneous direction change at every key. The tip's speed trace was a staircase. Both now use a clamped cubic Hermite — it passes through every authored point, so the arcs tuned in m105 are preserved exactly and the arc probe still reads 8.2–8.5m, but velocity is continuous across every key and the end tangents are zero, which is what a blow leaving and arriving at rest wants. Tangents use real key *times*, because these tracks are deliberately non-uniform.

**2. The phrasing was backwards.** The coil was the fastest thing in the clip and the hammer was already decelerating when the damage window opened. Every Bastion track is now four beats — a long slow coil that sells the mass, a turn-over, a strike segment 2–3× faster than anything else and placed *inside* that clip's own hit window, then a follow-through that carries on in the direction the blow was travelling. That last part matters: the old crown track reversed during its follow-through, and a reversal has to pass through zero speed, which the probe caught as a swing stopping in the middle of itself.

**3. The gauntlet flipped, and it was never the Bastion's bug.** With the wrist overlay *entirely disabled*, the palm still rotated **2.05 radians in one frame** at the same frame. A grip quaternion built from a basis can change which shortest arc it represents between frames; player.js already documents this and already has a rate limiter for it — armed only while a hand is *releasing*. A hand that simply carries something through a swing copied the raw quaternion and took the flip at full size.

The guard is now unconditional, with a ceiling far above any authored motion (40 rad/s, roughly five times the fastest wrist roll in the kit), so nothing that was meant to happen is slowed. Counted across all three figures:

| figure | frames clamped | worst demand |
|---|---|---|
| Vesper (campaign) | 13 / 842 (1.5%) | **2.99 rad** |
| White Vigil | 14 / 728 (1.9%) | 2.25 rad |
| Bastion | 9 / 974 (0.9%) | 2.61 rad |

Vesper demanded a **171° single-frame gauntlet rotation** and has been doing so all along. The campaign gets this fix too.

A fourth change — C1 sampling of the shared body clip, opt-in via `meleeProfile.smooth` and enabled only on the Bastion — is retained because the per-segment easing is continuous in value and not in velocity. It was not the main cause, but it is the same class of defect one layer up.

## The Vigil was left alone, deliberately

The Vigil has the same phrasing fault, smaller and faster. The identical fix was authored, measured, and **reverted**: at 1.30× tempo its clips are ~35 frames against the Bastion's 58, so a strike segment narrow enough to sit inside the damage window is only three or four frames wide, and the worst frame went from 2.78 to **4.35**. A short clip wants fewer, wider beats — which is what it already has. Fixing it properly means lengthening its clips or moving its hit windows, which changes how the whole kit trades and was not what was asked.

Both remaining findings are recorded in the probe as a named `KNOWN` baseline with the reason, so the harness stays green on the current state and still trips on anything new. Nothing is suppressed; the numbers print either way. Its melee3 did improve on its own — worst jolt 1.93 → 0.79 — from the flip ceiling.

## Proof

- **`saintfall-kenosis-swing-probe.mjs` — 14/14** (2 known baseline), including a gate that the flip ceiling stays a *rare* guard: if it ever starts firing on more than 8% of frames it has stopped catching flips and started rate-limiting the animation, which would quietly flatten every swing in the game.
- **`saintfall-kenosis-swing-strip.mjs`** — filmstrips of each clip, because a number cannot show a silhouette. The crescent now fires at the widest, fastest frame of the swing.
- **Regression:** arcs 12/12 (paths preserved at 8.24 / 8.26 / 8.54m, hammer still clears its own shield), kit 40/40, mobility 18/18, commands 30/30, import audit clean.
