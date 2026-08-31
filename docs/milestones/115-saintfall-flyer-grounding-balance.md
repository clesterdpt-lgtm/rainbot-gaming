# 115 — Bringing a flying boss down, in the encounter's own currency

**Build:** `20260830-mission-presentation-1`

Reported from play: the Bastion's cast downed the Winnower instantly and it went straight back into the air.

## The bug

`combat.groundFlyer` called `ctx.winnower.forcePhase("stoke")` **with no timer**, and `forcePhase` only sets `state.timer` when it is given one. So the forced stoke inherited whatever fraction of a second the interrupted soar had left. `beginStoke()` sets 5.5 seconds; the forced path set nothing — the boss hit the ground and relaunched immediately.

## Why restoring the timer was the wrong fix

It would have cured the flicker and left a worse problem, which is the one the report actually worried about: one thrown hammer, on one cooldown, opening a boss window the fight otherwise makes you earn.

The Winnower already states its own design in a comment:

> *Two ways to reach the same landing: the fuel, which always runs out, and the lift pool, which the player empties by shooting the sacs. The first is the floor a melee build is owed; the second is what a rifle build buys.*

So the cast becomes a **third way in, in the same currency**. A boss that carries a lift pool is no longer switched off — its pool is drained, and its own module decides what that means. An emptied pool drops it through the stall path the encounter already owns.

That matters because a stall is the *good* landing: **7.5 seconds instead of 5.5, opening with 2.6 in which the animal cannot answer at all.** The player who spent three cooldowns getting there is paid the same way the player who shot out both sacs is.

## The numbers, and why

| | |
|---|---|
| Lift pool | 4 (each of the two gas sacs is worth half) |
| Hammer cast | **1.5** per connected hit — three casts bring it down |
| Falling Anvil | **2.0** — two, because an 88-second call action should be worth more per use than a weapon cooldown |
| Cast cooldown | 8.0s, or 5.5s with *Second Reliquary* |

Three connected casts is roughly sixteen seconds of committed anti-air work — against a boss that lands by itself every twenty-one regardless. The cast competes with the fight's natural rhythm instead of replacing it, and a miss costs a full cooldown.

**It cannot burst a boss down.** `downDamageCap` already limits a single downing to 18% of maximum health, so even flawless play needs six windows. That guard rail existed before any of this and is untouched.

**Trash flyers are unchanged** — no lift pool means the old instant grounding, which is the Bastion's whole anti-air identity and should feel absolute against ordinary bodies. The two classes are told apart by whether the creature *has a pool*, not by its key, so a future flying boss gets the right treatment for free.

One correction to the report: **the Stylite does not fly.** It is a stationary pillar boss — "not meant to be out-damaged, it is meant to be brought DOWN" — and reaches its downed state by its own GRIP mechanic. The Winnower is the only flyer in the bestiary, so this affects exactly one encounter.

## Proof

**`scripts/saintfall-winnower-grounding-probe.mjs` (new) — 7/7.** One cast drains 4 → 2.5 and the boss is *still flying two seconds later*, which is the reported bug stated as a check. Three empty the pool; it enters `land`, reaches `stoke` 0.87s later, and the window is **7.5s with `stalled: true`** — the earned landing, not the chosen one. The 18% cap is still reported. A trash flyer still drops in a single blow.

The probe's own first cut sampled 0.8s after the third cast, caught the boss mid-descent in `land`, and read the descent timer as the window — an emptied pool does not teleport the animal to the floor.

Regression: commands 32/32, cast 10/10, carryover 20/20, kit 40/40, entry-point smoke clean, import audit clean.
