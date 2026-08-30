# 86 — SAINTFALL boss AAA pass

Bring every boss up to a standard that survives a blind side-by-side against a
real original-Xbox Halo frame. Scored, not asserted: a hostile critic is shown
two panels, told nothing about which is which, and asked which it would ship.

Contract: `docs/saintfall-boss-aaa-brief.md`
Per-boss direction: `docs/saintfall-boss-art-direction.md`

## The diagnosis this started from

Every boss `.glb` in `assets/models/saintfall/` carries
`POSITION, NORMAL, COLOR_0, JOINTS_0, WEIGHTS_0` — **no UVs, no textures, zero
images**. Our bosses were untextured flat-shaded vertex colour. Halo CE in 2001
had painted plate with specular sheen, grime and wear. Triangle counts (9k–13k)
were already in the Xbox-era band and were never the problem.

Measured against a vetted 19-frame original-Xbox pool, before any work:

| metric | ours | Halo pool |
| --- | --- | --- |
| shadowP01 | 27.0 | 7.56 |
| darkPct | 0.37% | 29.0% |
| localContrast | 6.85 | 15.3 |
| microDetail | 2.67 | 8.79 |
| edgeDensity | 2.82 | 13.7 |

## What landed

### The shared creature-surface kit — `assets/js/saintfall/boss-surface.js`

Sub-facet grain, gloss breakup, cavity, edge wear, damage response and distance
fade, all object-space triplanar so nothing needs a UV unwrap or a Blender
round trip. **0 texture fetches, 6 transcendentals, 4 screen-derivative reads**;
four octaves come out of the triple-angle identities in multiply-adds only,
which also makes octave N's screen footprint exactly 3ᴺ times the base one's and
so gives exact antialiasing from a single `fwidth`. Normal perturbation uses
Mikkelsen's surface-gradient form — no tangent frame, no UVs — with analytic
height derivatives rather than a finite difference.

Cost: **+0.08 ms worst case, +0 draw calls.**

It composes with `art.js`'s `patchMaterial` through a new `extend`/`extendKey`
option rather than going around it, so a surfaced material still gets the
level's aerial perspective and cannot render as a sticker at range.

### The frame's value range — `art.js`, `render.js`

`GRADES.warm.lift` decoded to sRGB 30, and `c = lift + (gain - lift) * pow(c,
gamma)` cannot return below it. It was an absolute wall across the bottom of
every frame the game would ever draw. The tell was that **the statistic did not
move when the picture did**: eighteen gallery frames — six framings, three
bosses, two districts, one lit by a bioluminescent abdomen and one shot at
120 m — all reported a 1st-percentile luminance of 27–29.

Fixed by cutting `lift` ~6× on all five grades (channel ratios preserved), and
adding a real per-grade `toe` weighted by `1 - smoothstep(0, m, x)` so it has no
authority above linear 0.22 and cannot touch sand, sky or a highlight. A
luma-normalised `shade`/`shadeHue` rotation replaces the hue duty the old lift's
blue channel had been quietly doing — without it the new dark end inherited the
key's orange and headed straight for the saturated maroon that `SAND_RAMP`'s
header calls mud.

`shadowP01` 27–29 → 4–16 across 30 frames. `darkPct` 0.1–0.4% → 14–39%.

### Grounding — `render.js`

The ambient-occlusion pass sampled a single 0.55 m radius: exactly the gap
between two armour plates, and two orders of magnitude away from a nine-metre
animal standing on sand. Every boss had cavity in its creases and **nothing
under its feet**. It is now a geometric ladder, 0.15 m → 3.2 m, across the same
12 samples, with per-sample range falloff and per-pixel ladder jitter — without
the jitter the twelve fixed radii print concentric rings that survive the
bilateral blur. Zero extra taps.

A shadow-map improvement cannot answer this: the dark under a creature is
missing *sky*, and a shadow map only occludes the sun.

### Breaking the lattice — `boss-surface.js`

Rotating the field off the rig's axes stopped the grain running square up a
creature's spine; it did not stop there being a lattice. Every octave is exactly
3× the last, all four share one rotation, and a gyroid is triply periodic — so
all four crest sets landed on cells of one common lattice and reinforced. On a
flat facet the visible result was a regular diagonal cross-hatch that read as
knitted cloth. Two fixes, both free:

- the three wavenumbers are now **mutually irrational** (`φ^(-1/3) : 1 : φ^(1/3)`,
  product 1 so every tuned amplitude is unchanged), making the field
  quasi-periodic — no exact repeat anywhere, so no lattice to recognise;
- the finest octave was `s.x*s.y*s.z`, a **separable** product and therefore a
  perfect rectangular grid, sitting at the most resolvable scale on the model.
  It is now the reverse-order gyroid, which has its own exact gradient. No
  octave in the stack is separable any more.

### Harnesses

- `scripts/saintfall-boss-gallery.mjs` — eight bosses, six identical framings,
  with a marched-sightline `visibleFraction` so "in frustum at the right fill"
  cannot pass as "visible". It caught a Garner portrait that was dead centre, at
  the requested fill, fully on screen — and a photograph of a dune.
- `scripts/saintfall-blind-compare.mjs` — blind A/B against the pool. Panels are
  byte-padded so `ls -l` cannot leak the answer.
- `scripts/saintfall-metric-compare.mjs` — our shots against the pool's measured
  distribution, both sides through one identical normalisation imported from the
  blind rig rather than copy-pasted next to it.
- `scripts/saintfall-fetch-refs.mjs` — the reference pool, vetted by eye
  afterwards because filenames cannot say "this is the Anniversary renderer".
- `scripts/saintfall-surface-ab.mjs`, `scripts/saintfall-surface-cost.mjs`.

## Bugs found on the way, all fixed

- **`districtBosses.status(key)` returned `null` for five of seven sites.** It
  read the `records` map, which is built only from the two generic-controller
  sites. `mission.js` and `breaches.js` had each grown a private copy of the
  lookup to route around it, and `breaches.js` still fell through — so a
  *defeated* Stylite kept its arena protected against breach waves.
- **The save validator rejected files the game itself writes.** Every boss
  record carries an `instanceId` back-reference; `enemies.js` `snapshot()`
  deliberately filters the roster, so the game wrote ids the roster did not
  contain and then refused its own file. Every `restore()` already treats an
  unresolvable id exactly like `null`, so rejecting bought nothing — while an id
  that *did* resolve was waved through without a species test, which would let a
  hand-edited save hand the Distaff a thresher. Validation now checks the thing
  that matters. `saintfall-save-integrity.mjs` 39/62 → **62/62**.
- `saintfall-surface-cost.mjs` green-lit three bosses that had no surface at all,
  because its toggle traversed the whole scene and its row was labelled per
  boss. It now asserts a uniform actually moved and skips loudly otherwise.

## Where it stands

`saintfall-gameplay.mjs` **55/55**. `saintfall-save-integrity.mjs` **62/62**.
`saintfall-stylite-fight.mjs` 33/33.

| boss | ms/frame (baseline → now) | draws |
| --- | --- | --- |
| Distaff | 3.83 → 3.84 | 146 → 146 |
| Winnower | 3.62 → 3.49 | 120 → 120 |
| Garner | 4.02 → 4.04 | 181 → 182 |
| Abbess | 4.88 → 4.96 | 212 → 214 |
| Stylite | 4.00 → 3.89 | 164 → 169 |
| Coulter | 4.50 → 4.25 | 172 → 172 |

Cap is 5.6 ms and +24 draws. Every boss is inside both.

## The blind verdict: 0 out of 10, four times over

See `docs/saintfall-boss-critic-findings.md` for the full reviews.

Four separate hostile critics were each shown blind pairs against the Halo
pool. They scored **0/10**, **0/5**, **0/5** and **0/5**. None of them could
name either game; all were told to judge craft, not recognition.

They converged, independently, on one defect:

> No occlusion darkening at contact — at any scale. Where plate laps plate,
> limb meets body, or armour meets undersuit, nothing gets darker. Creatures
> do not darken the ground they stand on. Every glowing element contributes
> zero illumination to its neighbourhood. They are all stickers.

Nobody said "low-poly", and one review explicitly said the style is fine and
that our best frame proves the direction can stage a shot. That is the useful
result: the gap is not the art direction and not the polygon budget. It is
that the renderer never darkens anything where two things meet.

Since that verdict, and verified in the tree: a glint term took `brightPct`
from 0.00 to 0.22 (Halo band 0.015–1.10), carrying `microDetail` to 6.17 and
`edgeDensity` to 10.1 — both into band, taking us from 8 of 13 metrics outside
the pool to 3, two of which the harness itself attributes to Vesper-IX being a
lit desert rather than to a defect. The grain now derives its frequency from
the object-to-world matrix per draw rather than a per-material uniform, closing
a **6.14× world-cell spread inside a single shared material**. And the world
casts real sun shadows where the critic counted roughly forty spires casting
none.

## Not done

Two separate rounds were cut short by an account spend limit.

- **Garner, Stylite, Apostate** have had one build round against the art
  direction and are visibly transformed (the Garner's bleached rim against a
  near-black wet throat now reads from across the arena). **Abbess** did not get
  her round, and is currently the weakest boss in the game: her frame is too
  dark (`darkPct` 77.3 against a pool band of 4.9–55.3, `meanLuma` 24.3 against
  31.4–91.6) and still too flat. She needs light coming *out of the abdomen*,
  not a brighter grade.
- **Winnower, Distaff, Coulter, Matriarch** have the shared kit through
  `enemies.js` but no per-boss pass.
- **No blind critic round has been scored yet.** The rig is built and proven —
  panels do not announce which side they are — but every critic agent died on
  the spend limit before returning a verdict.
- `brightPct` is still **0.00** on the Stylite against a pool band of
  0.015–1.10. Nothing in this game has a blown specular highlight anywhere. That
  is the single biggest remaining difference from the reference frames.
- The gallery's portrait framing shoots from eye level. Every strong boss frame
  in the reference pool — the Halo 2 Scarab especially — puts the lens *below*
  the animal looking up.
- A coarse diamond motif is still visible on large flat plates (the Stylite's
  shell). The fine grain is fixed; the mid-frequency octaves still read as
  regular on a big facet.
