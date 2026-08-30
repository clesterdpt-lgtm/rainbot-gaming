# 91 — SAINTFALL: the VFX pass

**Goal.** Audit every visual effect in the game and lift the basic ones to
the standard of the best ones, keeping the player's own abilities in one
language: holy, gold, reliquary light. Ordered by what a player sees most.

## The audit

A new harness, `scripts/saintfall-vfx-sheet.mjs`, fires each player-facing
effect through the REAL systems (weapons, combat, boost, jetpack, slam,
shield, ordnance, progression) and captures a timed strip of each —
seventeen scenes, `--tag before|after`, deterministic frames via
`renderOnce`. Alongside it a full call-site catalogue of every effect in
the game (165 `vfx.*` call sites plus every inline effect in shield /
jetpack / weapons / bosses / mission / hud). Baseline verdicts:

- **Basic:** slam (vertex-tinted cone + torus rings + a glass-bowl dome),
  ordnance beams (an open cylinder that read as a plank), pressure rings
  (hairline tori), Aegis plate (five flat additive planes + LineSegments
  runes), Seraph dome (a wireframe sphere), jetpack plume (two tinted
  boxes), melee arc (six motes on a dotted line), `blast` (two puffs — the
  most-called area effect in the game), enemy death (one orange spark),
  mission beacons (six-sided lampshades), player death (nothing),
  overheat (nothing), Distaff/Apostate deaths (nothing).
- **Every particle was the same soft disc**, so every hit, blast and rite
  read as bokeh however it was tinted.
- **Broken:** `abbess.js` calls `vfx.scorchFx`, which was never exported —
  three ichor-stain call sites had been silent no-ops.

## What changed

**Foundation (`vfx.js`).**
- The impacts pool draws five procedural SDF sprite shapes (disc, glint,
  ember, smoke, shard) chosen per particle by an `aKind` attribute, plus
  two new colour bands: brood ichor (12) and sand (13, drawn dark — dust
  is read from what it dims). Smoke grows as it dies; sparks do not.
- A **sparks** pool: 384 velocity-stretched quads integrated on the GPU
  (drag + gravity), stretched between now and a few hundredths of a second
  ago so length is speed and the curve is the arc. One draw call.
- Ordnance primitives are shaders: **beam** (`|N·V|` chord term doubling as
  a free radial coordinate for a hot core, both ends dying to zero, light
  scrolling down), **shockwave** (flat annulus with a hot leading edge +
  a short skirt wall so the level chase camera still reads it; `uBand`
  makes gyres thin loops), **dust** (silhouette-thick, mottled, torn open
  as it dies). Per-mesh materials, three programs.
- A pooled **slash** crescent built in the vertex shader from a unit strip.
- `blast` rebuilt (flash, streak fan, grit, sand ring, shockwave);
  `spark` rebuilt (energy hits: glints + ichor spurt; masonry: slivers +
  sand); new `deathBurst` (teal rupture, droplets, chitin, pool stain,
  bigger for heavy castes) wired into `combat.applyDamage`; new
  `shieldBlock`, `jetIgnite`, `boostLaunch`, `playerFall`; `scorchFx` and
  `reset()` exported. Stratagems re-authored on the new primitives; the
  consecration writes its eight-fold seal for its whole duration.
- The Penitent's Fall rig: a gathering column + a tightening halo above the
  head on the ordnance families, a seal struck under the landing point at
  the trigger frame, landfall = seal + two shockwaves + rising gyres +
  streak fan + sand ring. The dome is gone: a smooth hemisphere at any
  alpha read as a force field.

**Aegis (`shield.js`).** The plate is one shader: silhouette glow from a
polygon SDF (the same outline the mesh uses), twelve spokes, three rings,
a central sun, turning ticks, a sweeping band, a fill; formed rim-first
then boss-out; a ripple thrown from where the blow landed (plate-space hit
point from the attacker's bearing); perfect guards flash white-gold and
throw a halo off the face. The Seraph dome is a cathedral dome: fresnel,
ribs fading before the crown, courses, a climbing band, a gold foot,
a ripple as an angle over the sphere. Light count still stable (19/19/19).

**Jetpack (`jetpack.js`).** Plume sheets are a shader (white throat →
gold → clear, turbulence, shock diamonds on the inner sheet), a throat
flare of three crossed cards, ember-shaped exhaust, an ignition burst.

**Mission beacons.** `MeshBasicMaterial` kept (three call sites drive
`.opacity`), given the chord term via `onBeforeCompile`, 24 sides, its own
program key. Found on the way: `ctx.patchBasic` was never assigned, so the
beacons had never had the atmosphere fade — now `patchBasicMaterial`.

**Weapons.** Overheat bleeds steam off the ports while the lockout holds.

## Things worth not re-learning

- **`smoothstep(a, b, x)` with `a >= b` is NaN, and NaN survives `mix()`
  into every branch that was supposed to be masked off.** One sprite shape
  with a noise-driven edge hit `edge0 == edge1` at `n ≈ 1`, and every
  glint in the pool rendered as an opaque square — the kind that was NOT
  smoke. Clamp the noise range under the far edge.
- **A backtick inside a GLSL comment closes the template literal.**
  `node --check` passed; the browser said `Unexpected identifier`.
- **A free camera freezes the figure.** `T.lookAt` puts the player in free
  mode and `player.update` returns early, so a side camera photographs a
  statue that never swings. Player-centred scenes need the chase camera;
  world-centred ones (lance, salvo) can use the free camera.
- **`enemies.live` holds every dormant boss.** `live[0]` was the Matriarch
  two kilometres away, and "kill the enemy" killed her; the command-shots
  harness had the same bug (`the probe shots all connected` — pre-existing
  at HEAD, still failing for a different reason). Pick by distance or key.
- **A smooth hemisphere at any alpha reads as a bubble.** Dust that lifts
  from a strike is sprites thrown as a ring, not a shell.
- **The skirt on a shockwave must be a fraction of the leading edge** or a
  3m rite ring reads as a tin can standing on the sand.

## Verification

- `saintfall-gameplay.mjs` 55/55; `saintfall-movement-probe.mjs` 62/62 (its
  slam-rig assertions now read the pooled shock ring and the impact pool);
  `saintfall-shield-light-check.mjs` light count stable, reference
  refreshed; `saintfall-lint-glsl.mjs` clean; `saintfall-command-shots.mjs`
  14/16 with the two failures pre-existing at HEAD (verified in a worktree);
  `saintfall-talent-feedback.mjs` 95/104 — identical at HEAD.
- Perf (`saintfall-perf-probe.mjs --scenarios combat`, high): 145 draw calls
  vs 144, sim p50 1.8ms vs 1.7ms, GPU sync p50 13.6ms both ways.
- Sheets: `output/saintfall/vfx-sheet-before/` and
  `output/saintfall/vfx-sheet-after/` (`grids/*-grid.png` for review).

Build key `20260817-vfx-aaa-1`.
