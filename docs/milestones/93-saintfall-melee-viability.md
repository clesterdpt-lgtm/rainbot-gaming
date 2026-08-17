# 93 — SAINTFALL: a lance build can stand in reach

The censer-lance build died in melee range and the previous balance pass
(commit `73d1f740`: charge reclaim on connected sweeps, a longer Aegis
tank, a dodgeable Gleaner bolt) had not changed that, because it was
economic and the problem was mitigational. Standing in reach was
**unreadable, unmitigated and unrewarded**, and nothing in the kit or the
Doctrine tree touched any of the three.

> "Melee isn't losing because the lance is weak — it's losing because
> standing in reach is unreadable, unmitigated, and unrewarded."

---

## What was measured before anything was changed

`scripts/saintfall-melee-duel-probe.mjs` drives the production
simulation through the QA facade with a scripted bot — frame-perfect
swing lead for the lance, perfect centre-mass aim and the real heat
cycle for the Volley — against the real breach rosters and single-caste
duels. Before this milestone (HP lost of 150):

| Scenario | Volley | Lance, best play |
|---|---|---|
| 1 Harrow | 0 (0.7 s) | **55.8** — two unavoidable bites in four swings |
| 1 Gleaner | 0 | **72** — just to reach it |
| W2 Needle Brood | 15 | 72–102 |
| W3 Breaker Brood | 33 | **died**, every run |
| W4 Crowned Surge | 117 | **died** in 4 s |

Guarding the approach with Aegis changed nothing: the bite landed the
instant the guard dropped to swing.

## Why

1. **Enemy melee had no wind-up and bit on the first frame in reach.**
   `attack()` played the strike clip and called `hurtPlayer` in the same
   call, and `fireTimer` began at zero. The Gleaner's bolt had been
   rewritten so damage arrives when the bolt does; the melee castes never
   were. A chained lance strike (0.28–0.34 s to contact) *cannot* pre-empt
   a Thresher with 0.21 s of travel inside its own reach.
2. **The Gleaner was an anti-melee turret.** No minimum range, no
   fall-back. At 2 m its bolt flies 20 ms and its spread is 0.14 m against
   a 0.52 m capsule — hitscan again, exactly where the lance stands.
3. **Nothing on the intake path mitigated anything.** No post-hit grace,
   no attack-slot cap, and enemies do not collide with each other, so ten
   Threshers on one square metre were ~100 damage a second. The whole
   25-talent tree has no damage-reduction, healing or lifesteal node.
4. **Lance hits suppressed nothing.** Knockback was Thresher-only, and
   Threshers die to any connected sweep anyway. A Harrow — reach 4.4 m
   against the lance's 4.57 m on two of three strikes — always got two
   bites in per kill.
5. **Sustain came back as charge, not health.** Regen needs 5.5 untouched
   seconds; a lance never gets them.

## What changed

All of it lives in `combat.js` beside the numbers it governs
(`ENEMY_MELEE_CONFIG`, additions to `MELEE_CONFIG` and
`GLEANER_PROJECTILE_CONFIG`), with `enemies.replay()`, an audible tell in
`audio.js`, and Processional Mercy in `progression.js`.

**A. Every bite is a tell and then a strike.** The timer expiring begins a
wind-up: the strike clip restarts from its first frame, time-scaled so
its *measured* contact frame lands at the caste's wind-up (Thresher 0.40 s
— its mandibles reach full extension at 0.40 s of a 1.58 s clip; Harrow
0.60 s; Precentor 0.65 s; Matriarch 0.75 s), the creature locks the
bearing it has and lunges along it (a Thresher pounces at 0.75× charge
speed; the big animals plant), and only at the contact frame is the bite
resolved — against where the player *is*, with reach, a ±37° facing arc
and line of sight re-checked. Committed tracking is 0.6 rad/s: a sidestep
beats a pounce, a backstep beats a Harrow, and standing still gets bitten
(all three are asserted). Arrival is not the bite: on entering reach the
timer is held to 30 % of the cadence. A whiff costs the creature a beat.
The Apostate's hiss now plays at every tell.

**B. Attack slots.** At most two tells may begin per second per trooper;
the rest hold at reach and wait. An eight-Thresher ring lands at most one
bite a second (asserted). Precentor and Matriarch are exempt.

**C. Post-hit grace**, 0.30 s, for `enemy-melee` only — bolts, venom, ash
and every boss hazard keep their own cadence.

**D. A connected sweep staggers what it does not kill** — `enemies.stun`
for 0.35 s (×1.4 on the finisher), the bite timer pushed, the wind-up
cancelled — but only in the *first half* of a wind-up. Past that the
strike is armoured and lands on schedule, so a perfect combo still lets
about one telegraphed Harrow bite through per cycle instead of holding it
harmless forever, and the tell is what the player answers. Guardians take
a 0.15 s flinch; the bosses with their own modules are untouched.

**E. Health comes back from close combat.** +6 per Thresher kill, +12
Gleaner, +18 Harrow, and each melee kill brings the regen timer forward
2 s (`regenAt`, kept separate from `lastHitAt` so the HUD's damage
vignette does not fire on a heal). Processional Mercy restores the same
health as charge — 8, or 16 on a third-strike kill.

**F. A rushed Gleaner falls back.** Inside 10 m it holds fire and gives
ground at charge speed, still facing the trooper; it reloads for 0.7 s
once the range reopens; cornered, it fires anyway.

## What it measures now

Same probe, same bots (plus the intended counterplay: a sidestep on a
Thresher tell, a backstep on a Harrow's, a juke while closing on a
Gleaner):

| Scenario | Volley | Lance | Lance, guarded approach |
|---|---|---|---|
| 1 Harrow | 0 | **27.9** — exactly one telegraphed bite | 27.9 |
| 1 Gleaner | 0 | 18–27 | 0 |
| W2 Needle Brood | 0–15 | 15–22 | 15 |
| W3 Breaker Brood | 17 | 58–83 (35–47 healed back) | 42–50 |
| W4 Crowned Surge | 99–126 | 118–145 (78–81 healed back) | 118 |

Enemy-melee damage to the lance is now the single armoured Harrow bite;
everything else it loses is Gleaner fire from 15–35 m while it is pinned
in the pack. That is the remaining asymmetry and it is a *target-order*
problem — the lance cannot choose to kill the ranged caste first — not a
reach problem. The clean answer is the pack's own bodies blocking bolts
(the swarm as cover), which is a new mechanic and left for the next pass,
along with the Tier 2 kit (Aegis-cancel after the hit frame, a real
forward step on the opener, walk speed during a swing) and the Doctrine
fixes (Executioner's Measure pays off only on a rifle hit; Hooking Step's
config says pull, the runtime pushes).

## Gates

`scripts/saintfall-melee-duel-probe.mjs` — 11 mechanism checks and 8 duel
gates, all passing: every landed bite was telegraphed ≥ 0.35 s earlier;
first contact is not the bite; ≤ 2 bites per second from a mob and none
inside the grace window; sidestep / backstep / stand-still resolve as
designed; the Gleaner holds fire and gives ground then resumes; the
stagger cancels a wind-up; kill-heal, regen rebate and Mercy heal; one
Harrow ≤ 30 HP; Needle Brood ≤ 40 HP; neither melee build dies to Breaker
Brood or Crowned Surge. Regression: `saintfall-melee-balance-probe` 15/15,
`saintfall-gameplay` 55/55, `saintfall-matriarch-fight` 19/19,
`saintfall-save-integrity` 62/62, `saintfall-progression` 64/66 (both
failures reproduce on a clean HEAD — Mercy Circuit relay pace and the
three.js MultiplyBlending console warning — and are unrelated).

## Traps

- **The strike clip loops.** `enemies.play()` is a no-op for the clip
  already playing, so a creature standing in reach looped its strike
  clip unsynchronised with its own timer. `replay()` restarts and
  time-scales it; `play()` now resets `timeScale` on every clip change so
  the scaling does not leak into idle.
- **A stagger that pauses the bite timer stun-locks.** The first version
  paused `fireTimer` during `stunTime`; a combo that never misses held a
  Harrow harmless forever. The timer counts through the stagger now, and
  the wind-up is armoured past its half — a stagger costs the creature its
  swing, not its turn.
- **A ±45° facing arc with 0.9 rad/s tracking means no sidestep ever
  works** (resolved 34° off-axis, bitten). Measure the dodge before
  choosing the arc.
- **The probe must restrict itself to the enemies it spawned** —
  `enemies.live` carries the dormant district bosses — and must pick an
  arena with clear body-centre sightlines or the ranged bot's muzzle ray
  hits a prop 10 m out and "misses". Seed `Math.random` in-page or Gleaner
  aim makes runs noisy by ±15 HP.
