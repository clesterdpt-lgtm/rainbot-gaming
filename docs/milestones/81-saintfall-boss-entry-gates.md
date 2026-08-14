# 81 — SAINTFALL: boss entry gates and longer reveals

**Date:** 2026-08-13
**Slug:** `saintfall` · `assets/js/saintfall/{distaff,winnower}.js`
**Status:** implementation and automated acceptance complete; user playtest remains

## Objective

Make the district boss introductions feel deliberate and prevent players from
scouting or damaging a boss before they have crossed into its arena.

## Scope

- The Glass Scar Distaff and Censer Works Winnower stay absent from both the
  world view and minimap, and remain untargetable while their encounters are
  dormant.
- Crossing each encounter boundary reveals the boss in a protected cinematic
  that holds the authored camera for at least four seconds.
- The boss becomes targetable only when the reveal ends and normal combat
  control returns.
- Existing reset, restore, leash, death, and forced-QA phase behavior keeps the
  same encounter-state contract.

## Acceptance criteria

- [x] `scripts/saintfall-distaff-fight.mjs` proves the dormant Distaff is hidden
  and cannot take damage, the reveal holds for at least four seconds, and the
  standing fight is visible and targetable after handoff (38/38).
- [x] `scripts/saintfall-winnower-fight.mjs` proves the dormant Winnower is
  hidden and cannot take damage, the reveal holds for at least four seconds,
  and the soaring fight is visible and targetable after handoff (38/38).
- [x] Both focused encounter regressions pass with no page, console, or
  same-origin asset errors; shared regressions also pass (`saintfall-gameplay`
  50/50, `saintfall-ui-regression` 79/79, plus the complete Coulter and
  Matriarch encounter harnesses).
- [x] Real-browser captures confirm each reveal frames a visible boss:
  `output/saintfall/boss-entry-final2-distaff/distaff-reveal.png` and
  `output/saintfall/boss-entry-final2-winnower/winnower-reveal.png`.

## Exit condition

Approach either district arena in normal gameplay: the boss is absent before
the boundary, then receives a readable four-second-plus reveal, and can only be
damaged after the camera returns to the player.
