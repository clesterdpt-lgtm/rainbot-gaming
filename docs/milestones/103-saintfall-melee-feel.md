# Milestone 103 — Melee feel: the turn slash and the lunge

Two complaints about the censer-lance, one root cause each.

**"Turning to melee feels clunky."** A press with the reticle far off
the body played the ordinary opener while `MELEE_TURN_RESPONSE` (an
exponential damp at R=15) pirouetted the root underneath it. The damp
was correct for what it was — milestone 93's probes hold the body to
within 3° of the captured bearing by melee1's 0.317s hit — but from a
quarter turn or more the experience is a thrust wind-up playing
sideways while the legs catch up: the input reads as lag even though
the blow lands where it was aimed.

**"Holding W while swinging is just running while swinging."** It
literally was: `isForwardMelee` raised the locomotion target to
12.8 m/s under the normal run gait for any melee action with forward
held. No dedicated silhouette, no commitment, no burst.

## The turn slash (`meleeTurn` / `meleeTurnCw`)

At 90° or more between body yaw and the captured press bearing
(`TURN_SLASH_MIN`, checked in `meleeSwing` on the signed
`angleDelta`), the press becomes a different attack in which **the
spin is the swing**:

- The root sweeps the whole signed offset on the clip's own authored
  window (`spec.turn = [0.08, 0.34]`) with a smoothstep profile, and
  the facing solve applies it **directly** — not through `dampAngle`.
  An exponential response front-loads the turn (R=20 measured 114° in
  the first three frames — a teleport with an animation over it); the
  smoothstep spends the same offset evenly and settles *exactly* on
  the bearing. Measured trace for a 180° press: 0° → 3° at 0.10s
  (gather) → 80° at 0.20s → 180° flat from 0.35s, residual 0.0°.
- The strike fires **mid-spin at 0.20s** — versus 0.31s for melee1 —
  and its arc is computed per swing: `action.strikeArc =
  min(TAU, |sweep| + 1.5)`. Everything the blade carved through is an
  honest hit: probed at 180°, a target on the new bearing AND a decoy
  on the old forward both take the 1.1× blow.
- It counts as combo step 1 (spinning onto a new target restarts the
  procession), so a follow-up press chains to melee2/melee3, and
  progression's step-1 hooks (Endless Litany etc.) see it as an
  opener.
- Direction matters visually: the clip is authored for a positive
  sweep and `meleeTurnCw` is generated at module scope by negating
  only the side-picking channels (x, mount yaw/roll, chest/pelvis
  lead). The strike passes a **signed sweep id** (±4) through
  `combat.meleeStrike(..., sweepId)` so vfx draws the crescent
  revealing in the direction the body actually swept
  (`MELEE_SWEEPS[4]`, mirrored by sign).

At exactly 180° the offset's sign is a coin flip (the camera
normalises π to −π); either clip is correct there, and the probes pin
the deterministic cases at ±90° instead.

## The lunge (`meleeLunge`)

Forward held at the press (`move.y < -0.25`, keyboard or touch stick)
turns **the opener only** into a committed dash — follow-up blows stay
the close-range procession steps, or they would carry the combo
through its own target:

- `spec.drive = { start: 0.05, ramp: 0.11, end: 0.30, fade: 0.20 }`
  is a trapezoid speed profile the update owns directly, peaking at
  `MELEE_LUNGE_SPEED = 16.5`. It is a **floor under the damped
  speed**, not a target: releasing W mid-lunge doesn't abort the dash,
  and the ordinary damp takes over as the profile fades. Zeroed by
  root/stun/flight/boost/shield/slam/death.
- Travel is locked to the captured bearing (`moveYaw = action.aimYaw`
  while the drive is live) — the one deliberate exception to "the
  stick owns travel during melee". The movement gate also opens on
  `lungeDrive > 0` so the dash continues if the key lifts.
- The clip coils the blade high off the rear shoulder, then rams it
  out level as the body drops into a deep front split (`drop -0.13`,
  `stanceZ 0.30`, `lean 0.24`, grip `slide 0.32`). Measured tip reach
  **2.49m** — the deepest in the kit (melee2 was 1.96) — peaking at
  clip t 0.342, inside the [0.30, 0.46] hit window. Damage 1.45×,
  arc 1.05 (a thrust buys depth, not width), reach ×1.5.
- `isForwardMelee` now excludes drive actions so the old 12.8 thrust
  target can't re-accelerate the recovery; melee2/melee3 keep it.
- Probed: from a standing start with W held, 6.1m covered by hit
  close at 0° bearing error, peak 16.5 m/s, and a target parked at
  6.5m — beyond any standing swing — takes the hit.

## Contracts that moved (probe updates)

`saintfall-melee-reticle-probe.mjs`:

- The primary off-forward case and the buffered-combo camera moved
  from 90° to **80°** — the largest offset that still takes the
  damped melee1 turn, keeping those sections about the original
  contract. The event-routing sentinel likewise (its
  `bodyToReticleDeg` floor is now `RETICLE_MOVE_MIN_DEG`).
- New sections: 180° about-face (action is a turn slash, strikes
  sooner than melee1, hits both the reticle-side target and the
  old-forward decoy, settles ≤3° on the bearing, rite restores),
  ±90° direction pinning (`meleeTurnCw` / `meleeTurn`), and the lunge
  (action, dash distance/bearing/peak speed, out-of-reach target
  damage, rite restore). 32 checks, all green.

`saintfall-melee-arc-probe.mjs` samples the two new clips and reads
the hit-open time off whatever action a 180° press actually starts.

New: `saintfall-melee-feel-sheet.mjs` — frozen silhouettes of both
clips plus live sequences (a 180° spin through a three-Gleaner ring;
a W-held lunge into a target at 6.5m) to
`output/saintfall/melee-feel/*.png`, with a tiny-PNG guard against
blank frames.

## Files

- `assets/js/saintfall/player.js` — gate + both actions + mirrored
  clip + authored spin drive + lunge drive; per-swing `strikeArc`
  and signed sweep id into the strike call.
- `assets/js/saintfall/combat.js` — `meleeStrike` gains trailing
  `sweepId = 0` (arity-compatible: existing five-arg callers,
  including the Garner post-load hittability checks, are unchanged).
- `assets/js/saintfall/vfx.js` — `MELEE_SWEEPS[4]` (near-full flat
  crescent) and `[5]` (narrow thrust streak); negative step mirrors
  arc/centre/roll and the tip-spark bearing.
- `assets/js/saintfall/boot.js` + `games/saintfall.html` — build
  `20260819-melee-feel-1`.

## Traps for the next reader

- The spin's yaw is driven off `action.t`, so a throttled frame turns
  further rather than falling behind its own strike; don't "fix" it
  back onto wall-clock damping.
- `freezeAction` on `meleeTurn` never spins the root — the turn data
  lives on the live `action` (`turnFrom`/`turnSweep`), which
  `beginAction` resets for every other swing. A frozen still shows
  the carry pose only; the arc probe's body-frame envelope for this
  clip (span 1.13 rad) is *without* the root's contribution.
- `heroCamera` framed empty road for these stills; the feel sheet
  uses the chase rig (`setCam` past π looks back into the figure's
  front three-quarter).
