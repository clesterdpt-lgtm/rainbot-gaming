# Milestone 102 — the Ossuary fight that could not be fought

Reported from play: *"the ossuary boss does not let you do any damage to the main body
or the tentacles."*

It was true, and it was not a damage bug. **The Garner's encounter opened at 64m while
the animal was unreachable until ~30m.**

## What was measured

Standing on the Ossuary pan at 45m — inside the 64m aggro, boss bar up, field order
reading `CLOSE THE GARNER · 45M`:

| shot at | sightline | stopped by ground at | damage |
|---|---|---|---|
| `garner_throat` | 48.6m | **3.8m** | 0 |
| `garner_lip` | 46.9m | **5.3m** | 0 |

The mouth sits ~11m below the lip of its own funnel, so from the pan the line to it goes
through the ground four metres in front of the muzzle. `output/saintfall/garner-bug/stand-45m.png`
is the whole report in one frame: the HUD insists a boss fight is happening and there is
no boss anywhere on screen. Walk to 30m (already descending) and shots connect; at 12m
you are in among the teeth.

So there was a ~30m band where the fight was live, the animal was shooting back, and
nothing the player did could touch it — which from inside the game is indistinguishable
from "this thing is immune".

## The fix

`GARNER_CONFIG.aggroRadius` 64 → **34**, which is inside `GARNER_PIT.rimRadius` (36).
The encounter now opens with the player already on the funnel slope looking down into
it. The pit's authored surprise is unchanged — flat pan, and then suddenly not — but the
fight no longer starts before the player can join it. Measured after: wakes at 33.7m,
both throat and collar sightlines clear (`blockedAt: null`), 120 damage on each.

`district-bosses.js` takes the site's `aggroRadius` from `GARNER_CONFIG`, so the boss
site followed automatically; nothing else needed changing.

## Why the suite did not catch it, and what now does

Every one of the 37 existing Garner checks **staged** the encounter — `teleportToGarner`,
`forceGarnerPhase`, `advanceToGarnerPhase` — then measured. All 37 passed throughout the
entire period the encounter was unfightable for its first thirty metres, because not one
of them ever walked in.

`saintfall-garner-fight.mjs` gained a section that does: it starts outside aggro, walks
straight in, **stops at the exact metre the encounter wakes**, holds still through the
reveal, and only then fires — asserting both that the sightline is clear from the waking
distance and that a shot from there reaches the animal (either pool counts; a shot that
lands on a tentacle in front of the mouth still reached it). 39/39.

`qa.js:teleportToGarner` now clamps its offset to inside the wake radius. Its nine
callers were all written as bare numbers against the old 64m aggro (`40`, `30`); when
aggro dropped, a probe asking for 40 was suddenly standing outside the encounter and
**nine checks failed in a row, none of them about aggro**. The offset is a request, not
an order. A probe that deliberately wants to be outside aggro should use `_teleportRaw`
and say so.

## Not a regression from milestone 101

Verified rather than assumed: `git diff 93f5d39d HEAD -- combat.js` shows the boss pass
touched only brood provenance and the death flow; `meleeStrike`, `nearestLegPoint`,
`legAndBodyHit` and the Ossuary terrain are byte-identical to before it. The m101 arena
ring did grow (112→155) but rings gate resets, not damage or terrain.

One m101 change did make the symptom *harder to diagnose from inside the game*, and it
is worth knowing: the boss bar no longer carries HP numerals, so there is no readout left
that distinguishes "my shots are being eaten by terrain" from "this boss is immune". The
bar fill is the only remaining signal, and against a 7,400-HP pool it barely moves.

## Two smaller things measured on the way, not changed

- Aiming at the mouth from mid-range frequently resolves on a **tentacle** instead
  (separate 260-HP pool). Damage numbers do draw — `hud.js:221` consumes `legHit` — but
  the boss bar does not move, so it reads as "no damage to the main body".
- Melee on the maw only lands while `inst.collapsed`, i.e. the gorge window; a forced
  12-second gorge fell back to feeding after ~1s in testing, so that payoff window is
  much shorter in practice than the number suggests. Outside it a swing at the mouth does
  nothing unless a tentacle happens to be within `reach + legRadius` (4.32m).

Both are live leads if the fight still reads as unresponsive.

---

## Follow-up, same session: "is this live? it still does not let me damage the garner"

It was not live, and that was the whole of it.

**The fix shipped but could not reach the browser.** `boot.js` pins `?v=BUILD` onto
*every* module through the import map, precisely so a shipped fix cannot be served stale
— but `BUILD` was still `20260819-boss-pass-1` from milestone 101. The m102 change to
`garner.js` went out under a version the browser already had cached, so every player kept
running the 64m-aggro build. `assets/css/saintfall.css` had the same problem going back to
m101: its `#sf-reinf` rules were deleted and its `?v=` was never moved off
`20260818-abbess-pass-1`.

All three saintfall assets are now on `20260819-garner-fix-1` (boot BUILD, `saintfall.css`,
`saintfall-ui.css`). **A code fix in this project is not finished until the cache-buster
moves** — that is the standing convention and it was missed here.

**Damage itself was never broken, and now there are numbers for it.** Measured through the
game's own trigger (`fireWeapon`, which holds the input rather than calling
`weapons.fire()` directly), aiming and re-aiming every frame:

| position | 10s of held trigger | DPS | time to kill (7,400 HP) |
|---|---|---|---|
| the waking distance, 34m | 4,756 | 476 | ~16s |
| the lip, 10m | 3,212 | 321 | ~23s |

The censer-lance does 24 a shot, so a three-round burst in one frame reads as `24` — the
fire-rate gate eats two of them. That is worth knowing before reading any "3 shots dealt
24" measurement as a damage bug: it is one shot, connecting.

## The floating rock

Same report, second bug, and it is the pit's animated terrain meeting props that were
seated before it existed.

Every prop is placed by `restOnTerrain` at load, against the pan while `garnerReveal` is
still zero. When the encounter opens and terrain.js drives that scalar to 1, the floor
drops up to sixteen metres — and anything resting on it stays where it was baked. Measured
inside the opened pit: **8 sample points with solid tops at y≈1.5 over a floor at
y≈-14.7, a 16.2m gap**, at 6-10m from the pit axis (`output/saintfall/garner-bug/floating-rock.png`).

The Ossuary's own debris loop has always re-rolled out of that circle; the **map-wide
scatter** (3,400 crags in `world.js`) never learned about it. It now skips
`GARNER_PIT.rimRadius + 6` — bounded by the rim rather than by `reach` (62m) because
inside the rim the bowl cuts down, while outside it the spoil lip only rises, and a
slightly buried boulder reads as a boulder where a hovering one reads as a bug. The
`continue` sits **after** every rng draw for that crag, so culling one cannot re-time the
shared stream and silently re-scatter the other 3,399.

After: `floaterCount` 0, same camera, nothing bare
(`output/saintfall/garner-bug/floating-rock-fixed.png`). 39/39 on the Garner harness,
18/18 on the boss-pass probe.
