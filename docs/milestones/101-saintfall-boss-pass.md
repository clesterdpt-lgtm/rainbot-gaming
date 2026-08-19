# Milestone 101 — SAINTFALL boss pass: reveals that see, arenas that are owned, deaths that hold

Eight player-facing changes to the boss game, requested together and shipped together:
every boss intro must actually show the boss; the boss bar carries the name and the bar,
nothing else; a boss fight owns its arena (no field enemies inside it); every arena grew;
the Matriarch fights on flat ground; the Stylite's arena floor is flat; the reinforcement
budget is gone — dying holds the field until a record is loaded; and autosave never fires
during a boss fight.

## 1. The reveal camera solver (`reveal-camera.js`)

Every intro's authored camera is now a PREFERENCE, not an order. `revealCamera(ctx, ...)`
ray-tests the authored lens against the collision grid (five body samples — aim point,
top, base, both flanks — through `collide.rayBlock`) and keeps it when ≥80% of the body
is seeable. Blocked, it walks a fan of alternatives — same bearing first, then ±yaw
steps, extra lift, then range changes — and takes the first clear shot, falling back to
the best-seen candidate. Deterministic given the boss position, so the QA invariance
checks still hold.

Call sites: winnower/distaff/garner/abbess/stylite/apostate `beginAlert`/`beginRouse`/
`beginBreach`/`beginReveal`, and district-bosses' shared reveals for the Matriarch and
the Coulter.

Two buried-target traps, both now clamped **above the pan**:
- the Coulter is 16m underground at reveal — a subterranean aim point reads as
  "blocked" to every ray and sends the solver hunting for a view that cannot exist;
- the Garner's pit has not opened yet when its camera cuts (`lipY` is metres below
  ground that does not exist yet) — its solve aims at `max(lipY+1.2, panY+2.2)`.

`saintfall-boss-intro-probe.mjs` now carries an INDEPENDENT occlusion witness: its own
rays from the actual `freePos` to the boss, best frame across the whole hold (the
Garner's reveal is an animated uncovering — "was the subject seeable during the intro"
is the honest question). 33/33 across all eight bosses × four approach angles.

## 2. The boss bar is a name over a bar

`hud.js` dropped the district kicker, the `health / maxHealth` numerals and the state
caption from `#sf-bossbar`. The captions still exist as data (`packBoss` keeps
`boss.detail`) and ride the ARIA `aria-valuetext` for screen readers; they are just not
drawn. Dead CSS removed.

## 3. The arena is the boss's alone

`district-bosses.js` gained a per-frame stray purge: while a site is **engaged** (any
phase but dormant/dead — intros included; the stage should already be clear for the
reveal), every enemy inside `arenaRadius + 24` that the fight did not spawn is removed,
projectiles first. Kept, by provenance not species: boss bodies (`district-boss:*`
eventIds, `districtBossKey`, the Apostate's key), boss adds (owner eventIds — the
Matriarch's brood now inherits hers in `combat.brood`; the Abbess's kids carry
`abbessBornAt`), and breach waves (`breach-*` — breaches.js already submerges those with
its own bookkeeping; racing it would leak the buried-roster health). Boss instances are
NEVER removed here — five bespoke controllers keep a closure over their instance and
cannot recover from losing it. The Apostate's nave is purged too
(`APOSTATE_CONFIG.disengageRadius + 24`).

**QA spawns carry `eventId: "qa-probe"`** (qa.js `spawnEnemy`) so review scenes staged
inside engaged arenas — the Apostate palette lineup was swept mid-shot — survive the
purge. A harness that wants to watch the purge itself spawns through
`ctx.enemies.spawn` directly.

## 4. Arenas grew ~40%

censer 98→140, scar 92→132, ossuary 112→155, bloom 104→148, choir 96→138, reach
102→145 (saint stays 285). Ossuary/bloom/choir now read their module configs
(`GARNER_CONFIG/ABBESS_CONFIG/STYLITE_CONFIG.arenaRadius`) so the numbers cannot drift.
Every ring stays inside its module's disengage leash — the invariant that keeps "you
left the arena" firing before "the boss lost you". A structural consequence worth
keeping: **the Winnower's ring now contains its whole aggro halo** (perch offset 32m +
aggro 78m < 140m), so the woken-from-outside reveal loop is impossible by construction —
`saintfall-encounter-intro.mjs` asserts the containment directly.

## 5–6. Two authored arena pads (`terrain.js`)

`MATRIARCH_ARENA` (reach site, flat r78, feather 48) and `STYLITE_ARENA` (choir centre,
flat r96, feather 52) are exported siting constants (the GARNER_PIT precedent), each
with a module-scope resolved target off `smoothBase` — the Matriarch's pan sits at the
smooth landform (an inter-dune clearing), the Stylite's plaza at the Choir dome's +26m
with the shatter field and base dune trains removed. Needles, plates and crags re-seat
themselves (they sample `heightAt`). `world.js` keeps props out: masts inside the
Matriarch keep-ring are **pushed radially to it** (a skip would re-time the shared rng
stream and delete a vane from the line), the Wind Shrine moved from 30m to 81m off the
choir centre (the crater-lance lesson: no altar in the melee core), and the global
scatter culls crags inside both pads — with the `continue` placed AFTER every rng draw
so 3,400 downstream boulders don't silently re-scatter.

**`findFlatSite` rejects only the two pads**, nothing else: a blanket all-arenas ban was
tried first and it evicted QA's neutral ground from its historical winner in the Fallen
Saint basin, silently re-siting every tuned harness onto the Pilgrim's Road (two
matriarch checks failed from the bearing change alone — the mantis brain turns toward
the player and the old site was due south by luck).

## 7. Reinforcements are gone; death holds

- `mission.js`: no `reinforcements`/`maxReinforcements` state, no budget decrement, no
  "MISSION FAILED — NO REINFORCEMENTS" `lost` path. Deaths are still counted (they are
  saved state — loading a record rewinds them to what the record holds).
- `combat.js`: the dead branch no longer calls `respawn()`; `respawnIn` runs to 0 and
  stays (it is the death presentation's clock). `respawn` is exported for harnesses and
  any future restart-from-drop flow.
- `ui.js`: a death screen (`.sf-death`, z60 — under the field menu) reveals at
  `respawnIn <= 0.8` (**sim time**, so `advanceTime` harnesses see it and a paused menu
  cannot race it) with RESTORE <newest record>, ALL FIELD RECORDS (opens the saves
  panel over it), and a two-press RESTART OPERATION. It dismisses itself the moment the
  trooper lives, whichever path revived them — no load path needs to know it exists.
  The REINFORCEMENTS operation card became DEATHS; the HUD `#sf-reinf` pip is gone.
- `save.js` validator: the reinforcement fields are neither required nor rejected —
  `readData()` runs `validSnapshot` at read time and a validator stricter than
  `restore()` silently EMPTIES every existing slot (the save-validation lesson).

## 8. Autosave never during a boss fight

`district-bosses.js` exports `anyFightActive()` (all seven sites via the status router,
plus the Apostate) and `save.js:saveAuto` refuses while it is true — **including the
forced pagehide flush** — holding `autosaveClock` AT the threshold so the record is
written the moment the fight ends. `autosaveClock` also now starts at the threshold, so
the first frame in which saving is possible writes the baseline autosave: a death before
the first 42-second interval still has something to load. Manual saves stay the
player's own business.

## Harness truths worth keeping

- **Baseline before blaming yourself**: `git stash` + run showed the matriarch corpse
  float (p05 0.143m vs 0.12) and the death-shots trooper cascade and both command-shots
  probe-shot misses were all **pre-existing** — three would-be wild-goose chases.
- The old encounter-intro hp check "passed" only because auto-respawn quietly refilled
  the hp it compared. Death that holds exposed it; the check now scopes to the hold.
- death-shots' trooper section inherited a dead/freecam probe from the corpse passes —
  with auto-respawn gone that state no longer clears itself; the section now starts
  from a living trooper explicitly.
- Fight-harness budget checks (garner 12ms, abbess 12ms, apostate 12ms) fail under
  parallel Chromium load; run them solo before believing them.

Verification: `saintfall-boss-pass-probe.mjs` (new, 18 checks — flat pads measured at
spread 0.0m, purge/brood/bar/autosave-gate/death-load flows), boss-intro-probe 33/33,
encounter-intro 10/10, save-integrity 62/62, ui-regression 97/97, arena-entry all pass,
district-hunt 33/33, matriarch/stylite/abbess/garner/apostate fights all green
(winnower/distaff/coulter run at close of milestone), death-shots green but for the
pre-existing corpse float (chipped for a follow-up).
