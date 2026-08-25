# THE WHITE VIGIL — critique log

Every blind round against the Vesper-IX baseline, in order. The rubric
is `saintfall-summit-critique-rubric.md`; the reference pool is
`output/saintfall/summit/baseline-vesper` (30 Vesper frames, ultra,
1600x900, captured before any summit work began).

A defect is **not** closed because it was fixed. It is closed when a
later blind round stops naming it.

---

## Round 0 — pre-build instrumentation (no comparison)

Not a critique round. Recorded because the numbers it establishes are
what every later round is measured against.

| what | result |
|---|---|
| Vesper baseline captured | 30 frames, ultra, 1600x900 |
| Harness run-to-run noise | up to 75 k differing bytes of 5.76 M on `cathedral-front`; metrics stable to 2 d.p. **Any pixel comparison must be read against this floor.** |
| Vesper parity after the four engine edits | metrics identical to 2 d.p. on `establishing`, `cathedral-front`, `choir` |
| Vesper quality-tier suite | all checks passed |
| Vesper day/night suite | 27/29 — **both failures pre-existing on `main`**, verified in a clean worktree at `ed05914a` |
| Snow/ice shader compile | 13 programs, 0 errors, 0 GL errors; sastrugi relief and sparkle confirmed rendering |

**Open defects entering round 1:** none named yet.

---

<!-- Rounds are appended below. Template:

## Round N — <what changed since round N-1>

Seed: `N`  ·  Pairs: `12`  ·  Sheets: `output/saintfall/summit/blind/round-N`

### N.a identify
`RESULT: identified X / Y correctly (Z%)`
Reading: at chance / above chance / leaking — and if leaking, the tell.

### N.b prefer
`RESULT: ours A / T   reference B / T`

| pair | won | the critic's reason |
|---|---|---|

### Top defects named
1. …
2. …
3. …

### Changed in response
- …  (re-tested in round N+1)
-->

## Round 1 — the level boots

Not a blind round. The build reached its first rendered frames; these are
the defects found by looking at them and by measuring, in the order they
were found and fixed.

### Fixed, each with the measurement that found it

| defect | how it presented | root cause | how it was found |
|---|---|---|---|
| **Every building black** | cathedral, spire, parapet, buttresses all silhouettes | `sunAzimuth` written as a COMPASS bearing; `az = 180 − compass` because +Z is south. At "158" the alpenglow sun sat NNE instead of SSE and lit nothing the level is composed around. | looking at the parvis frame |
| **Stone still too dark** | masonry read as a hole in the frame | `GRANITE_RAMP` bottomed at `#22262a`; under a 7° key most masonry area takes fill only | same frame, after the sun moved |
| **Dark specks across the upper sky** | read as broken geometry; a raycast through them returned nothing | world props placed at **double altitude** — `snowCap`'s `seatY` is already a world height and `place()` added the ground height again. Moraine at 743 m, its drift collars at 1094 m, on a 452 m mountain. | subtree bisect (`hide:world` → 0% dark), then projecting every mesh's bounding box |
| **Every drift the same depth** | invisible | the depth sampler passed unwrapped — the exact trap `snowCap`'s own header warns about; every prop used the depth at the map origin | reading the primitive's contract after the altitude bug |
| **Vesper's desert in the sky** | brown motes over an alpine frame | `buildVfx` builds `dust`/`grit`/`streamers` unconditionally, in sand colours | scene enumeration |
| **Flat, formless mountain** | one pale mass, its own ridge noise the only structure | **ambient fill far too high.** Cutting it to a third moved frame σ from 41.5 → 52.2 (+26%); raising the key by half moved it 0.1, and disabling shadows moved it 0.4. The key was never the missing term. | a three-way sweep on the arrival frame |

The last one overturned this project's own art direction, which argued
that snow is an enormous bounce card and that underlighting it reads as
chalk. True of the world, false of this renderer: the fill here is a
non-directional hemisphere plus a convolved environment, so every unit
of it removes form everywhere at once.

### Measured state

`node scripts/saintfall-summit-audit.mjs` — **10 of 11 gates pass**:

- all nine pads flat to **0.015 m** (gate: 0.45)
- summit at **452.0 m** exactly
- single peak on all four bearings
- **9/9 stations reachable on foot** by the player's own slope rule
- **6/6 crevasses are real open holes**, narrowest 70 m
- inversion deck at 120 m; all 14 camera stations clear; no page errors; no NaN uniforms
- **FAIL: Via Sacra max grade 17.2%** against a 13% ceiling (mean 8.1%), worst at (−113, −125) — inside the summit cone, where the authored profile is steepest

Vesper-IX after every engine edit: Δluma ≤ 0.03, Δσ 0.00, Δsat ≤ 0.01 on
three ultra poses — inside the harness's own run-to-run noise.

### Top defects still open, in priority order

1. **The mountain is a dome, not a peak.** `PROFILE_ROWS` is close to
   uniform in slope between r = 190 and r = 700, and a uniform slope is
   a cone. A peak needs a concave-up profile: shallow apron, steep
   summit pyramid. This is the single biggest remaining defect and it is
   what makes the arrival frame — the level's most important image —
   read as a hill.
   *Blocked on:* the eight arena shelves are cut against the current
   profile, so re-authoring it means re-measuring `shelfAt`.
2. **The Via Sacra breaks grade in the summit cone** (gate failure above).
3. **The radial ridge noise reads as fur** at 800 m — too fine and too
   regular for the distance it is mostly seen from.
4. **The inversion deck veils the mountain from the basecamp**, which is
   correct behaviour (the camera is under the deck) and the wrong
   picture. It needs a hole, a lower base, or the gate moved above it.
5. **Sastrugi invisible in play.** `sastrugi-graze` measures σ 11 and
   0.24% edge density. Proven to render in isolation, so this is
   exposure and viewing distance, not the shader.
6. **The stations are first drafts.** Every one carries a TODO block
   naming what its finishing pass owes it; the cathedral is correct
   massing with no detail at all.

## Round 2 — it is a mountain now

The headline defect of round 1 ("the mountain is a dome, not a peak") is
closed, and closing it broke and then fixed six other things. Recorded in
order, because the cascade is the interesting part.

### The design error underneath it

The layout put all nine stations on one ring at r = 740-870 and gave them
elevations from 12 m to 241 m. **Those two statements cannot both be
satisfied by a mountain.** At r = 800 the ground is 32 m, so the Bell
Terrace's pad needed a 209 m artificial terrace under it, the Cascade's
176 m, the Fumarole's 135 m. Built, they were not terraces — they were
eight lumps stuck on a dome, and they were half the reason the silhouette
failed.

Stations are now sited at the radius where `summitProfile` already passes
through their own elevation. Bearings are unchanged. **The largest
artificial lift fell from 209 m to under 20 m**, and the level became the
inward-tightening spiral its own layout text describes.

### The profile

`PROFILE_ROWS` was monotone in elevation and near-uniform in grade —
26°/30°/35°, steepest in the *middle*. That is a shield volcano. It now
runs 5-10-16-25-35-42-37 degrees outward to inward: a gentle apron and a
summit pyramid, steepest at the headwall. The eight shelf fades are
derived from the table, so re-authoring it re-derived every one for free.

### The six things that broke, and what each taught

| symptom | cause | fix |
|---|---|---|
| Glacier arena 31.5 m out of level | station loop ran shelf-A, pad-A, shelf-B, pad-B — a later station's *shelf* overwrote an earlier station's *floor*. Harmless while stations were 500 m apart. | two passes: every shelf, then every pad |
| Arenas out of level again (36.9 m) | derived feathers reach 105-260 m, so pads overlap; the pad pass applied in array order | winner-take-all, applied weakest-first |
| Bell Terrace unreachable, 387% grade | `PAD_FEATHER` was a constant 40 m, sized for pads that sat on pre-levelled shelves. A disc cut into live 40° slope has ~85 m to resolve → 1.75 grade, past the 1.7 walk limit | feather derived per station from `padR × local grade` |
| Road bed 112 m under the Bell Terrace | I added a grade limiter *on top of* an existing one, and the bed sampled arena floors whose flats eat the road's length. 78% of stations sat exactly on the ceiling — the limiter had stopped being a safety net and become the road | bed follows the march's own design elevation, which is grade-correct by construction |
| Six stations unreachable at one shared coordinate | `VIA_SACRA_START_R` was a literal 838 while the re-sited gate moved to 891 — the road began 53 m *inside* its own arena | derived from the basecamp |
| Road mean grade stuck at 14-21% whatever the guard width | **the guard was the wrong mechanism.** Suppressing the cut's *strength* near an arena leaves the centreline lying on the pad's feather, which is the steepest ground there is. Tried at 1.55·padR, padR+18, padR+8 and padR+feather; the blocked coordinate moved every time | blend the cut's **target** instead — bed in the open, arena floor inside the disc, ramped over `padR + 46` |

Also: crevasses were cutting an 8 m slot straight across the carriageway.
A crevasse across a road is a bridge problem and this level has no
bridges — the road is now built *last*, and owns its carriageway outright.

### The mountain was brown

Two rules were cut against the old dome and inverted on the new peak:

- `rock` at 34-44° put most of a 25-42° mountain into its own window.
  Moved to 46-58°, which is also truer: what coats an alpine face past 38°
  is wind-plastered snow and rime, which *adhere* rather than rest, and
  this world has 31 m/s at the crown.
- **Raising the rock threshold made it worse**, because `scree` reads
  `scree × (1 − rock)` — less rock simply handed the same ground to talus.
  Scree blanketed everything under 190 m, which after the re-profiling is
  the lower two-thirds. Confined to 30-40° under 110 m at half weight.

### Measured

| gate | round 1 | round 2 |
|---|---|---|
| pads flat | 0.015 m | 0.543 m (summit only, 9 cm over) |
| **stations reachable on foot** | 9/9 | **9/9** |
| Via Sacra mean grade | 8.1% | 11.4% |
| Via Sacra max grade | 17.2% (measured on the *design*) | 134% (measured on the **ground** — the instrument was fixed; it had been asking the road whether it agreed with itself) |
| arrival frame σ | 39.8 | 37.8 |
| arrival saturation | 25.7 | **62.0** |

### Still open

1. One 134% spot on the road near the Rime Forest.
2. Summit pad 9 cm over the flatness gate where the road reaches the parvis.
3. Station dressing — in progress.

## Round 3 — the barrier, the bare ground, and the floating assets

Review: *"There needs to be a barrier surrounding the whole level, similar
to Vesper. Some of the areas are a little bare and empty feeling. Vesper
has some open dunes but White Vigil is more bare feeling. Also some of the
assets have gaps that make objects look floating."*

### 1. The barrier

Kenosis was built with no rim, on the theory that the cloud inversion
would hide the boundary. It does not: the deck lies at 120 m and the ring
valley floor at 30, so the player looks *over* the cloud at nothing, and
can walk off the apron.

**The encircling range.** Eleven principal summits with cols between them,
on Vesper's rounded-square distance (`p = 6`) so it uses the map's corners
— which is where the ring valley is widest. Sized off a ridged field on
the *bearing alone*, so it is one 720-entry table read with a lerp rather
than noise at 1.35 M sample points.

New gate, `rimProbe`: **gentlest face anywhere on the perimeter is grade
2.50 against a walk limit of 1.7; lowest crest 119 m.** The level is
sealed and measured to be.

Two things it taught:
- The probe was wrong before the range was. Sweeping a fixed *radius* band
  finds the crest on four bearings and empty valley on the other
  sixty-eight, because a rounded-square crest sits at r = 962 on the axes
  and r = 1214 on the diagonals. It has to march in `rimDist`.
- **Applied before the stations, the range was carved.** The Basecamp's
  shelf holds its floor out to r = 966 and fades to 1186 — straight
  through the range — and cut the crest to 51 m with a 1.16 face, a
  walkable ramp out of the level 85° round from anywhere you would look.
  Nothing may carve the map boundary; it is added *after* station shaping.

### 2. The bare ground

Not too few props — **too little ground**. Vesper's flats are never flat:
three dune trains at 168/74/27 m carry them, and its own header says the
trains are what make that desert read. Kenosis had the radial ribs and
then a 1.7 m dither.

**Wind drifts**, two trains (64 m at 2.6 m, 19 m at 0.7 m), transverse to
the world's one wind, with the long windward back and short slip face that
separates drifts from corrugation. No third train — the metre scale is
already carried per-pixel by the sastrugi shader, which sand has no
equivalent of.

`sastrugi-graze` went from **σ 11.2 / 0.24% edge density with three "frame
may be empty" warnings** to **σ 36.4 / 5.7% and no warnings.**

Arenas get the drift too, at a fifth of the amplitude — 0.55 m over a 64 m
wavelength, a 3.4% worst grade. The flatness gate was re-stated to assert
**grade** rather than absolute spread, because grade is what decides
whether a fight is fair and spread is what makes a floor read as a sheet
of card.

### 3. The floating assets

Measured rather than hunted: `floatingProps` walks every merged mesh in
world space and reports the minimum gap to the terrain beneath it.
**13 of 95 meshes, and all but two are legitimate** — icicle fringes hang
off eaves, bells hang in frames, prayer flags hang on cords.

The real floater was not a prop at all. **The Via Sacra was flying.** At a
fixed 22 m falloff the cut's influence ends 22 m out whatever it is doing
there, so where the bed runs 30 m above a gully the corridor became a
ribbon of raised ground with a 1.8-grade wall down each side — visible
from the Avalanche Bowl as a pale causeway crossing the mountain on
nothing. Embankments now have a **side slope**: 1.6 horizontal to 1
vertical, sized per-sample by how far the bed is from the ground, with the
drainage ditch riding the toe of the batter instead of being buried
halfway up it.

### 4. The snow was grey (found while fixing the above)

At eye level the arena floors read as wet asphalt. Four candidates were
tested in order and three were wrong:

| suspect | result |
|---|---|
| station tint | real but minor — `#8a8d7e` at 0.16 on snow reads as a change of *material*, not hue. All tints re-weighted; a strength cut for sand is not a strength for an 0.85-albedo surface |
| sun elevation | real — at 7.2° flat ground takes `sin(7.2)` = 0.125 of the key, and flat ground is most of every eye-level frame. Raised to 15°, which is within 1.5° of Vesper's own golden hour |
| snow multiple scattering | **compiled and active, and nearly inert** — proved by toggling the uniform at runtime: 0 → 1.6 moves the frame 21 luma. Worth having, not the cause |
| **the grade's shade knee** | **the cause.** It desaturates toward `shadeHue` below linear luma 0.30, and flat snow under a 15° sun lands at 0.28 — inside its authority. Every arena floor was being pulled toward `#4f74c4`. Knee to 0.16 |

Raising exposure and warming the ramp had both failed to shift it, because
neither was what was doing it.

### Measured

| gate | round 2 | round 3 |
|---|---|---|
| pads flat | 0.543 m spread | **5.0% grade** (gate re-stated) |
| stations reachable | 9/9 | 9/9 |
| **level sealed** | — (no barrier) | **face 2.50 vs limit 1.7** |
| crevasses open | 5/6 | **6/6** |
| beauty shots clear | 14/14 | 14/14 |
| frames with "may be empty" | 3 | **1** (`inversion`) |
| arrival luma / σ / sat | 121.9 / 37.8 / 62.0 | 137.2 / 34.0 / 59.4 |

**10 of 11 gates.** The residual is one 104% sample on the Via Sacra near
the Rime Forest — see §Road below.

### Road: three approaches, one kept

The road/arena interaction was attacked three ways and the record is kept
so it is not re-attacked:

1. **Suppress the cut near arenas** (guard at 1.55·padR, padR+18, padR+8,
   padR+feather). No width works. Suppressing the cut's *strength* leaves
   the centreline lying on the pad's feather, which is the steepest ground
   on the mountain. Mean grade never came under 14%.
2. **Blend the cut's target** toward the arena floor. Works, and the ramp
   width is a genuine trade: 12 m cliffs where the road grazes the
   Avalanche Bowl's rim; the pad's own feather (105–260 m) drags the road
   toward terraces it passes 150 m outside. **46 m is the only width that
   holds both ends** — kept, with one 104% residual.
3. **Exempt the road corridor from the pads entirely.** Gave the best road
   in the programme — mean **8.5%**, the design grade, 9/9 reachable — and
   destroyed the arenas: the Frozen Cascade came back with a 160 m spread
   and a 2107% grade across its floor. Reverted. A road one gate over
   beats five arenas that are trenches.

### Still open

1. The 104% Via Sacra sample near the Rime Forest.
2. `inversion` pose still measures as an empty frame.
3. Station dressing agent had not returned when this was written.

## Round 4 — the first real blind rounds

Two blind A/B rounds against the Vesper baseline, scored by critics who
had seen neither level and were told both sides were ours.

### Round 4a — **ours 2 / 12**

The critic identified the split **12/12** on colour cast alone. That is a
biome tell, not a quality leak, so the preference result stands.

Its ranked defects against us, all confirmed by looking:

| defect | frame | verdict |
|---|---|---|
| **spindrift as cotton wool** | `eye-basecamp-lander` | *"billboards glued over the largest object in frame destroy its silhouette and its form"* — the weather agent had read "legible from across the map" as "dense" and pushed opacity to 0.70 |
| **snow as hard uniform discs** | `eye-rime` | reads as confetti, not weather |
| **value compression** | `eye-moulin-1` | *"snow, ridge and sky all sit between 60% and 85%, with one small black slot as the only dark"* |
| two suns / unmotivated bloom halo | `eye-summit-parvis` | the dome's wide forward-scatter lobe at `sunScatter` 1.20 washing a quarter of the frame |
| one tree, one scale, even spacing | `eye-rime` | Rime Forest scatter has no variance |
| placeholder slab field | `tarn-mirror` | *"twenty identical untextured rectangles"* |
| floating black strokes in the sky | `bell-terrace-drop` | unparented geometry — **the floating assets the review reported** |

### What changed

| change | from | to | why |
|---|---|---|---|
| spindrift opacity | 0.70 | **0.15** | it was occluding the ridge it is supposed to be leaving |
| spindrift rise | 16 | **30** | peak lift of 26 m over a 175 m run lies *on* the face; spindrift that touches the mountain reads as snow stuck to it |
| snowfall alpha | 0.42 | 0.26 | 3000 fine flakes was the right count; each one was opaque enough to read as an object |
| `sunScatter` | 1.20 | **0.72** | the wide lobe is `pow(mu, 3.0)` — a ~50° half-angle. A low sun wants a tight aureole and a bright horizon, not a hemisphere of glare |
| exposure | 1.06 | 0.92 | the review's own ⅔-stop prescription |
| grade `toe` | 1.26 | **1.44** | the toe has authority only below the linear midpoint, so it makes a black without touching the snow, the sky or a highlight |
| `envIntensity` | 0.36 | **0.26** | third cut. Non-directional fill raises the darkest thing as much as the brightest |
| snow ramp dark end | `#4a6494` | `#2c4373` | there was no black in the palette to reach |
| sastrugi amplitude | 0.128 | **0.218** | authored at a strength that works at 40 m and vanishes at 4 m — and on an open snowfield it is the *only* near-field texture |
| pad drift | 0.55 m | 0.80 m | 1.10 m measured 10.1% grade and broke the gate; 0.80 m gives 7.3% against an 8% ceiling |
| wreck smoke scale | 1.7 | 0.7 | a smoking wreck is good storytelling; a 40 m brown column across the arrival frame is not |

### Round 4b — **ours 5 / 12**

Same rig, new seed, fresh critic. **2/12 → 5/12.** Every one of round 4a's
named defects went unmentioned in 4b except in Vesper's own frames.

Its new ranked list — and note that two of the three now name *Vesper*:

1. **Stacked hard-edged haze bands** (a Vesper frame) — *"the only frame in
   the set that looks broken rather than unfinished"*. Fix is shared: one
   exponential height fog, plus blue-noise dither pre-tonemap.
2. **Snow as hard discs, still** (ours) — soft radial alpha, per-particle
   size 0.3–1.0×, opacity 0.15–0.6, velocity streaking, near-camera cull.
3. **Flat untextured slope filling half the frame** (Vesper's dunes).

Systemic, worth its own ticket: *"a pale grey diagonal ribbon with detached
dark blocks crosses the sky in six frames — whatever it is meant to be, it
currently reads as a scratch on the lens."* That appears in both levels, so
it is engine-side.

### Still open, ranked

1. Snow particles still read as discs at some sizes.
2. The sky-ribbon artefact (both levels).
3. Bare near-field still called in several frames.
4. Rime Forest scatter variance; Tarn pressure-ridge repetition.
5. Unparented sky geometry at the Bell Terrace.

## Rounds 5–6 — a regression, and the discovery underneath it

| round | result | what changed before it |
|---|---|---|
| 4a | ours **2 / 12** | first blind round |
| 4b | ours **5 / 12** | spindrift, glare, blacks, snowfall |
| 5 | ours **1 / 12** | sastrugi tripled, meander widened, ground litter |
| 6 | ours **3 / 12** | sastrugi reverted, **the sun raised to clear the barrier** |

### The regression was mine, and measuring caught it

Round 4b's critic said the near field was bare. I measured it properly —
mean absolute luminance difference across a 6 px baseline in the bottom
third — and got a clean answer: sastrugi off 0.67, as authored 1.10,
×4 = 2.43, against Vesper's open-ground frames at 2.4–4.1. So I tripled
the term.

**The metric went up and the picture got worse.** Round 5's critic named
corduroy in eight frames as the top systemic defect and dropped us to
1/12. The wavelength is the constraint, not the amplitude: the finest
train is 1.05 m and projects into wide horizontal bands at any eye-level
angle, and no amplitude makes a periodic function stop being periodic.
Reverted.

Two things worth keeping from that detour:

- **My reframing was wrong and the critic corrected it.** I argued the
  bare near-field was a *composition* problem, citing that Vesper's own
  bare-sand frame (`eye-saint-camp`) measures 0.95 — lower than ours.
  Round 5's verdict: *"It is the ground, not the missing subject… Add a
  subject to those frames and you still have a bad surface; light the
  surface and the empty shots survive. Fix the ground."*
- Ground litter was added anyway (4200 pieces, density by curvature,
  altitude and slope, batched per 256 m cell, arena floors kept clear).
  It is a small win and not the answer.

### The discovery: the level was lit by ambient, and the barrier was why

Round 5's Q3 was *"put a low raking key on the snow and let it cast real
shadows — these scenes have ambient and no key."* Measured, looking
straight down at the basecamp pan so the frame is all terrain:

| | before | after |
|---|---|---|
| frame luma | 38.8 | **95.5** |
| key light's contribution | 1.3 (3%) | **61.3 (64%)** |
| with shadows disabled | 79.1 (×2!) | 95.3 (≈ no change) |

The ground was **in shadow**, and raising the shadow bias ninefold
recovered only a fifth of it — so it was not acne, it was a real
shadow. **Cast by the encircling range I had added two rounds
earlier.** At a 15° sun an obstacle 500 m away shadows everything
shorter than 134 m behind it; the rim is 119–310 m and stands 400–600 m
out from the ring valley, so the barrier was laying its own shadow
across the arrival area and every station in the ring.

Sun raised to 24°. Still raking — shadows run 2.2× object height — and
it is the price of a level you cannot walk out of.

### Two instrument bugs found on the way, both mine

1. **The frame-mean probe was measuring sky.** Pointed at the horizon,
   half the pixels are dome, so halving the light on the terrain moves
   the mean a few percent and reads as "the key does nothing". The probe
   now looks straight down.
2. **Runtime overrides were being undone by the frame step.** `renderOnce`
   runs `sky.update`, which re-applies the atmosphere and restores the
   sun's intensity — so every "key off" measurement was measuring the key
   *on*. Overrides are now applied after the step and drawn without
   stepping. This nearly had me "fix" a light that was working.

### Round 6's remaining defects against us

1. **Vertical smear on near-vertical faces** (`eye-bell-refectory`,
   `cascade-backlit`) — *"planar UVs stretched down a near-vertical
   wall"*. Systemic on cliffs.
2. **Corduroy still** on `eye-fumarole`.
3. **`crevasse-edge` is a broken camera** — *"an accidental crop with no
   subject or horizon; this is not a frame"*.
4. **`tarn-mirror`**: washed pink haze, no key, no focal point.

Notably, the critic's single worst frame in round 6 and its worst
corduroy were both **Vesper's**, and it judged Vesper's lighting stronger
only *"narrowly, and despite owning the worst frame in the set."*

---

## Rounds 6 and 7 — the shadow map was never wired up

Round 6 scored **ours 1 / 12**, round 7 **ours 0 / 12** (seeds 211 and 907,
fresh reviewer each round, `_key.json` unread both times). Both are worse
than round 5's 5 / 12. The score moving the wrong way is recorded here as
measured, not explained away: rounds use different pairings and different
reviewers, so the instrument is noisy, but "lost seven of twelve
decisively" is not noise.

What the rounds bought was the diagnosis. Round 6's reviewer wrote *"the
character casts no shadow at all"* across four pairs. That had already been
measured in this log as good news — "shadows off makes no change to the
frame" was read as the encircling range no longer shadowing the basecamp.
It meant the opposite.

### 1. `render.setQuality(tier, sky)` was called with one argument

`summit-main.js` called `render.setQuality(t)`. The sky is the SECOND
parameter and render.js guards its entire shadow block on `if (sky)`, so
the block never ran and the sun kept this module's boot defaults, sized for
a 452m mountain:

| | span | map | texel | normalBias |
|---|---|---|---|---|
| before | 900m | 2048 | 0.879m | **1.274m** |
| after | 340m | 8192 | 0.083m | 0.120m |

`applyShadowBias` derives normalBias from the texel, so the coarse map
produced a 1.27m push along the normal. At a 24-degree sun that displaces
the shadow lookup 2.86m across the ground. The player is 1.8m tall. Every
prop, every drift lip and the player's own cast shadow were pushed clean
out of their own shadow — which is exactly why disabling shadows measured
as no change. There was nothing there to disable.

### 2. The arrival plaza was painted 68% gravel

`SURFACE_ZONES.basecamp` is `{ key: "scree", w: 0.68 }`, applied as a flat
constant over a radial band. Measured at the lander: `scree 0.68, snow
0.289`, on dead-flat ground. The terrain's vertex colour there was
`[0.318, 0.298, 0.265]` — a warm dark brown. Four reviewers across two
rounds wrote variations of *"nothing in that frame would be called snow
unless you were told"*, and this table is why.

The authored geology is right; its distribution was a paint bucket. Zone
weights for the debris keys are now scoured by an exposure mask (convexity,
slope, windward) times a two-scale patch field, so gravel is what is LEFT
where wind strips the snow and the flats fill in. Basecamp now measures
`snow 0.83-0.90, scree 0.07-0.14`. The ice keys are exempt: a glacier
tongue is a continuous sheet and scouring it would open holes in it.

### 3. The corduroy was a linear phase, not an amplitude

Halving the amplitude gave fainter stripes at the same spacing. Cutting the
mask floor gave patchier stripes at the same spacing. Turning the term off
proved it owned the artefact — edge density 16.07% to 7.81%, and the ground
became the featureless white plate the shader exists to prevent.

The ground was also measured directly: 0.4m of height variation over 60m in
front of the camera, monotonic. There is no geometric banding at all. The
whole artefact is `cos(along * k)` — periodic by construction, and no gain
or meander term can fix a periodic function.

Fixed by domain-warping the phase (76m / 49m / 30m rates, ~2.5m swing,
under half the 5.6m train's wavelength) so crests bunch and spread. The
warp goes into the phase only; the gradient basis still points along the
true crest direction or the lighting stops agreeing with the shape. The
patch mask also gained lobes at 45m and 64m — every existing lobe was 174m
or longer, so across one eye-level frame the mask was a constant and could
not break anything a reviewer could see.

`reliefAt`'s geometric drift trains were rebuilt the same way (per-train
heading 30 degrees apart, spatially varying wavelength, occupancy that
genuinely reaches zero) — correct on its own terms, but not what owned this
artefact.

### 4. Fixing the shadows exposed the snow ramp

With real shadows finally landing, round 7 came back with *"slate-navy"*,
*"reads as water"*, *"painted metal"* on five frames. `K.snowShade` was
`#2c4373` — 17/26/45 percent. A snow ramp whose dark end absorbs five
sixths of the light is wrong: snow's albedo is ~0.85, and what makes
shadowed snow dark is that only the sky is lighting it. Rebuilt so the
darkest snow sits at 58 percent and stays blue by HUE rather than by level.
This was invisible for the level's whole life because nothing was ever
properly in shadow to land on it.

### Still open

- Distant ridges resolve as flat dark cutouts with no aerial perspective
  and no snow on them (the encircling range). Named in both rounds.
- Near-field emptiness inside ~15m: no micro-relief, crust plates or
  footprints.
- Props meet snow at a hard line with no banked drift skirt.
- One beauty shot resolves against geometry and returns an empty gradient.
- The Via Sacra grade gate: one 104% sample at (528, 146). 11/12 audit.

---

## Flight: "the snow doesn't follow you"

Reported from play: flying with the jetpack looks like flying ABOVE the
weather. Three separate causes, all of them consequences of the same thing
- every field was tuned, and every assumption checked, at eye level, before
the jetpack existed.

### 1. The vertical band was welded to the camera

The xz band wraps in WORLD space: a mote sits at a fixed place on the
mountain and `mod()` folds the nearest copy into the box around the camera,
which is what gives parallax when you walk. The y band did not wrap at all.
For the snowfall, `uFoldY` is 0, so the line read:

    p.y = uAnchor.y + (hash * 2 - 1) * uBox.y      // no mod

`uAnchor` is `camera.position`. Every flake's height was the camera's height
plus a fixed per-flake offset, so vertically the entire field moved with the
viewer, rigidly. Snow could not fall past you and you could not rise through
it.

The module is explicit about why, and the reasoning was correct when it was
written: a mote wrapping a full band height directly overhead is the visible
artefact the whole model exists to avoid, and *"its anchor rides the camera,
so the artefact this prevents does not arise for it in the first place."*
That holds exactly as long as the only way to move vertically is to walk up
a hill.

Now `wrapY` gives the field a world-fixed y that wraps around the camera,
and the wrap is made safe the way the ground blizzard's fold already was -
by fading both boundaries 6m inside a 20m half-height, so nothing is ever
drawn at the instant it jumps.

### 2. Nothing took over from the ground blizzard

The blizzard is what you actually see in this world - 12000 motes at 0.85
against the snowfall's 3000 at 0.26 - and it is ground-anchored, hugging the
terrain in a 2.4m sheet, which is correct: that is what blowing snow does.
Climb thirty metres and you leave it, properly, and the snowfall is far too
thin to carry a storm alone. Measured at the basecamp, snow covered 4.50% of
the frame at +2m and 2.43% at +30m.

The snowfall now ramps 1x to 2.5x as the camera leaves the layer (4m to 30m
over the surface, measured against the ground sample rather than altitude -
the mountain climbs 452m and a player on the summit is still standing on
it). The ramp is flat for the whole blizzard layer, so every ground-level
frame and every beauty shot it was tuned against is untouched: the arrival
frame measures luma 148.91 / edge 16.91% before and after.

Box height also went 26m to 40m with the count 3000 to 4600, holding density
per cubic metre constant - what the extra height buys is depth when the
camera is not on the ground.

### 3. White flakes over sunlit snow composite to nothing

These draw with normal alpha blending and both colour endpoints were
near-white, so a flake over lit snow returns lit snow. Spread across a
bright end and a cool mid-grey, which is also what real snow does: against
the ground a flake is darker, against the sky it is brighter.

### What was NOT established

The parallax fix is correct by construction and can be read off the shader,
but three attempts at a pixel-level A/B of it failed and none of the numbers
they produced should be trusted:

- a rigid vertical-shift correlation cannot detect parallax at all, because
  motes at 8m and 40m shift by 449px and 90px for the same rise;
- an overlap test that did not isolate the field measured the blizzard and
  the spindrift, and reported the change as a no-op;
- a snow-only mask under frozen time reported 0.3% overlap for two captures
  from an IDENTICAL camera, which is a broken instrument, not a result.

The one clean measurement was the frozen-time whole-frame diff: a control
with an identical camera differed by 0.000% of pixels, so the renders are
deterministic and the harness was sound up to that point.

---

## Two weathers, authored per district

Follow-up from play: *"snow doesn't just follow the ground unless it is
snowdrifts, but it looks more like blizzard snow that stops above a certain
height. Certain areas should have a static snowfall from all heights and
some can be more like snow drifts, but they should be distinct visually."*

Both halves of that were true of the model. The ground blizzard IS the
level's weather by weight - 12000 motes at 0.86 against the snowfall's 4600
at 0.26 - and it is ground-anchored; and the snowfall had ONE global ceiling
at the inversion, so climbing anywhere on a 452m mountain broke out into
clear air. A ground blizzard hugging the surface is not a bug, it is what
blowing snow does. The bug is that it was the only weather, so its
behaviour got read as the behaviour of snow in general.

There are now two weathers, meant to look nothing alike:

  SNOWFALL is a column - the whole air from the ground to above the peak,
  indifferent to how high you fly, near-round flakes falling slowly
  (stretch 1.6 -> 1.15).

  DRIFT is a surface phenomenon - a 2.4m sheet on the terrain that STREAMS
  rather than falls (stretch 4.0 -> 5.4). Flying out of it is correct: you
  have left the snow that was being lifted off the ground.

Which one a place gets is authored in `WEATHER_ZONES`, blended toward an
open-mountain default by `districtWeight` (a station's weather does not stop
at its naming radius), and smoothed on the same throttle-and-tau the supply
term already used. It costs nothing extra: the district comes back from the
`surfaceAt` call `sampleSupply` was already paying for.

Measured, settled, at ground level and at +60m:

| district | fall | drift | ceiling | fallOp @+3m / +60m | driftOp |
|---|---|---|---|---|---|
| basecamp | 1.00 | 0.85 | 640m | 0.26 / 0.65 | 0.73 |
| rime | 1.13 | 0.42 | 630m | 0.27 / 0.74 | 0.45 |
| bowl | 0.30 | 1.24 | ~200m | 0.10 / 0.19 | 1.02 |
| glacier | 0.26 | 0.99 | ~190m | 0.10 / 0.17 | 0.31 |
| summit | 0.14 | 0.36 | ~151m | 0.04 / 0.09 | 0.19 |

The Glacier's drift zone is 0.99 but lands at 0.31 because the supply term
holds it down - bare ice has nothing to lift - which is the two systems
composing correctly rather than fighting.

Breaking out of the deck is still a moment; it belongs to the places that
are above it (the summit, the wind-scoured basins) instead of being a
global fact about the level. Ground-level frames are unchanged within
noise: the arrival reads luma 148.76 / edge 16.36% against 148.91 / 16.91%.

---

## Rounds 8-11: what four more rounds bought

Scores: **r8 2/12, r9 2/12, r10 1/12, r11 0/12** (seeds 1453, 2207, 3301,
4409; a fresh reviewer each round, `_key.json` unread every time). No trend.
The instrument is noisy enough at this range that the score is not the
useful output - the diagnoses are.

### The corduroy was never a waveform problem

Four rounds were spent tuning a periodic function. Halving the amplitude
gave fainter stripes at the same spacing. Dropping the mask floor gave
patchier stripes at the same spacing. Domain-warping the phase bunched them
but kept them. Giving all three trains their own steered headings produced a
regular BASKET WEAVE - worse than the stripes, and it would alias harder.

The step that mattered was noticing that every variation mechanism ran at a
scale LARGER THAN THE MAP: the heading steered on 3471m, 2768m and 5280m and
the wavelength scaled on 4393m and 6477m, on a 2048m level. This is the same
mistake as the patch mask's 174m lobes, and it is worth a name of its own -
**a variation term whose period exceeds the thing it varies is not weak, it
is absent.** All the numbers read like variation in the source.

The fix was to stop using sines. Sastrugi are erosional - sharp crests,
scoured hollows, no spacing repeated - and that is ridged value noise, not a
sum of cosines. Two octaves, gradient by forward difference in the wind
frame with the along-axis stretched 3.6:1.15, faded by pixel footprint via
`fwidth` so it cannot alias. Edge density 17.08% to 12.23%, cost +0.44ms at
the basecamp and +1.09ms on the widest frame. The corduroy is gone.

### The fluted cliffs are the grid, not a pattern

Every reviewer from r8 on ranked this first, and all of them described it as
a displacement to be tuned: "per-flute variation", "jitter per-rib width",
"replace the periodic vertical relief". Two attempts at exactly that changed
the frame by 0.00 in every metric.

Measured, the wall is at **88.8 degrees**. At the L0 grid's 3.8m spacing that
means each column differs from its neighbour by 181m, so every column is its
own tall flat facet. A height field cannot draw a vertical face; it draws a
comb. The module's own bedding comment says this in as many words - it was
known, and the bedding term is the attempted cure.

Only 0.31% of the map stands over 80 degrees, but it is concentrated exactly
where the cliff frames point. Eliminated as sources by measurement, each a
separate A/B: the macro and meso rib terms, the shelf outward fade, the pad
feather, and the cliff-band risers (58-65 degrees by construction). Still
open.

### Bedding: the constraint is on the product

The term adds `A*sin(h*k)` to h, so its gradient with respect to h is A*k.
At 3.4 and 0.30 that product was 1.02 - past 1 it cancels the slope's own
rise and the surface folds. Measured up the north-east flank, a 480m
transect climbing 235m had FOURTEEN slope reversals, one every 17m of
elevation. On screen: a sawtooth of triangular teeth wrapping the mountain
in contour lines, which is what "one repeating flute" and "vertical
hair-like smearing" were describing. Two milestones were spent tuning the
sastrugi shader for an artefact the terrain was generating.

Capping to A*k = 0.63 fixed the terracing (four reversals, same as the term
disabled) but left the ledges too small to break a 128m cliff. Buying
amplitude with WAVELENGTH instead - k 0.30 to 0.16, A 1.1 to 3.6, A*k 0.58 -
gives three times the relief at half the inversion risk. Nine reversals,
which reads as bedding rather than as a staircase.

### Two darkening levers at once

Answering an earlier "no blacks" review, envIntensity went 0.36 to 0.26 AND
the grade's toe 1.26 to 1.44 in the same pass. Measured across the beauty
set, 10.1% of all pixels ended up under 15% luma with four frames over a
quarter black and the Cascade lip at 56%. Blind review: "every non-snow
surface crushed to one hueless black", "a horizon trunk is as black as one
at 20m". env back to 0.40 (it drives the hemisphere fill, so it lifts shadow
sides toward cool daylight rather than lifting the whole frame) and toe to
1.32. Mean crush 10.1% to 5.6%.

### Things that measured as no-ops, recorded as such

- Rib radial variation (r/300 to r/58) plus horizontal strata bedding on
  both rib scales: frame identical to three decimal places.
- Deriving the shelf outward fade against a 1.9 grade the way the inward
  fade is derived: slope census unchanged. The tabulated values already
  exceeded it.
- Sizing the pad feather against real relief rather than the smooth
  profile's drop: over-80 went 0.31% to 0.37%. Slightly worse.

### A capture defect is not a level defect

Three of twelve pairs in r11 were broken shots - "camera inside the
terrain", "crops the character into frame bottom", "cropped helmet". The
eye-pose generator already tested clearance and then stood at the best
candidate regardless, so a POI with no clear standing point still shipped a
frame. It now skips instead. A missing frame is strictly better than a
broken one in a comparison set.

Two caveats learned immediately after: the clearance figure for GOOD frames
is 1.3-2.1m, so the original `>= 3.0` was an early-exit target and never a
validity threshold - a 2.2 cutoff rejected two thirds of the set. And
widening the search (8 to 16 bearings, two more standoffs) changed which
point wins and sent the Cascade lip from 52% crushed to 99%. Widening
reverted, guard kept at 0.85.

The moulins are a separate problem the guard cannot fix: their clearance is
the HIGHEST in the set (3.3-4.0m) because a moulin is a hole, and a hole is
not visible from 46m at eye level. The frame is the player's back and haze.
Those POIs need a standoff rule of their own or should not generate eye
shots.

### Honest position

An independent reviewer asked directly how far this is from parity: *"A
large amount of work. This is not a few targeted fixes... one full milestone
on surface, lighting and grade; a second on landmarks, set dressing and shot
composition."* That matches the evidence. The desert wins most pairs on set
dressing alone - a ribcage, a wreck, an obelisk field - and the summit has
one landmark and very little near-field content.

---

## Round 12: authoring the mid-ground, and a measurement that was wrong

**r12: 1/12** (seed 5501). Trajectory r8-r12: 2, 2, 1, 0, 1.

### The level had nothing between four metres and a cathedral

Measured, not guessed: `buildGroundLitter` places 4200 pieces and 84% of
them are 0.28-1.25m; the largest is 4.2m. The next thing up in scale is the
cathedral. That whole band - the mid-ground, the part of a frame that
carries depth - was empty, which is what every review since r8 has been
describing as "no framing mass", "a horizon line with a centred figure",
"the camera cannot find a shot where there is nothing".

The kit already had the answer and it was barely used: `kit.serac` was
called TWICE in the whole world and `kit.pressureRidge` once. The new
`buildOpenGroundMasses` pass places serac clusters, wind-scoured crags and
pressure ridges at 6-30m, in clusters rather than as singletons (a lone
block is an object; five with a size hierarchy are a place), each with a
real drift collar because at that scale the contact is most of the read.

### And then put them where nothing looks

The first version weighted density by `nearest / 260` - densest FAR from a
station, reasoning that pads already have dressing and the gaps are the
emptiest ground. True of the map, useless for the picture: **every camera in
the game stands at a station.** The pass filled the far gaps and the next
review still counted half the frames as running empty to the skyline.

Mid-ground is 20-200m *from a viewer*. The weight now peaks across that band
measured from the pad edge and falls away both sides.

### The shadow measurement was wrong, twice

Four reviews said the character casts nothing. An earlier probe here
reported props casting 8.09% of frame pixels and treated the claim as
disproven. That probe had **no control**: it toggled a flag, re-rendered,
and diffed - and this scene animates between any two captures. Re-run with
an identical-toggle control, the noise floor is **6.1-6.4%**, so 8.09% was
mostly noise.

Controlled properly (20 player meshes found by world position, three poses,
control subtracted) the character's shadow is a consistent **0.9-1.2% of
frame at every pose, including the two the reviews called empty**. So both
statements are true: the shadow exists, and it is unreadable. A 1% shadow at
low contrast on a 0.85-albedo surface under a strong sky fill is present and
invisible.

Raising the key would fix the read and undo the crushed-blacks work - the
sky fill is what makes shaded stone carry material at all. Contact gain
raised 0.62 to 0.98 instead, which touches only the pixels where surfaces
meet. It landed (`uContactGain` reads [0.85, 0.98] at runtime, AO on at
0.95) but moved the frame metrics by 0.01 luma. Not yet solved.

**The rule this earns:** any toggle-and-diff on an animated scene needs a
same-toggle control, and the control must be *reported*. Two separate
findings in this log were built on uncontrolled diffs.

### The remaining gap, in the reviewer's words

Asked directly how much set dressing is still needed against a level with a
ribcage, a crashed machine and an obelisk field: *"A great deal - roughly
five times what it has. The desert frames average two to three authored
objects at different distances; the snow frames average under one, and two
of them have zero. The snow level is currently terrain plus sky."*

Its concrete list, which is the actual remaining work: a wrecked funicular
pylon line with sagging cables; a frozen procession of half-buried stone
pilgrims along a ridge; a real crevasse field with an ice bridge and blue
interior walls; a fallen cathedral bell cracked open with drift piled
against its windward side; iron censers or shredded banners strung between
crags. Then mid-ground filler at three size classes: nunataks, calved-ice
block fields, sastrugi as *geometry* rather than shader, moraine lines,
three more conifer silhouettes, route cairns with iced rope, cornices with
fracture lines. And spindrift plumes off every ridge crest, because the
level currently has no visible wind in it.

One explicit warning worth keeping: *"not another cathedral"* - the summit
building reads as the Vesper cathedral repainted white.

---

## Round 13: set pieces land, the score does not move, and the blocker is named

**r13: 1/12** (seed 6607). Trajectory r8-r13: 2, 2, 1, 0, 1, 1.

### What was authored

Two set pieces, both chosen because the only snow frame that has ever won a
pair won it on a stand of dead conifers - black verticals, a receding line,
long shadows:

  THE VIGIL LINE - ten lattice pylons on one bearing from the valley to the
  shoulder, with catenary cables between them and two spans down. A tower is
  a known size; ten of them receding tells you how far away the mountain is,
  and the cable draws the eye up the slope. Sited 17 degrees off the Via
  Sacra so the two do not read as one corridor.

  THE DROWNED PROCESSION - forty pilgrims on a ridge walking toward the
  peak, bedded to the chest so the line of heads is what carries at range.
  Done with `bedFactor`/`maxBed` rather than by translating the figures down,
  so each one's drift collar still builds at the real snow line.

Placed: vigil 3 batches / 7.0k tris, procession 2 / 13.2k, and the
mid-ground masses re-weighted from 56 batches / 34.8k tris to 76 / 96.7k.

Two build failures worth recording, both TDZ-class:
  - `polar` is a module `const` declared 260 lines BELOW these builders, so
    calling it from the world build threw "Cannot access before
    initialization" - the same trap that killed PAD_FEATHER. Localised.
  - `slab(w, h, d, bevel)` is POSITIONAL. Handed an options object every
    dimension is `undefined`, the geometry is all NaN, three reports a NaN
    bounding sphere, and the level boots to a failure screen.

### The reviewer's verdict on it

Asked directly whether the gap had narrowed: *"Yes - genuinely, and it is
visible in the pictures, not just in the object count... The snow level has
stopped being terrain-plus-sky in about half the set."*

And then the part that matters: *"But the score barely moved, and the reason
is that the dressing pass fixed the wrong axis. The objects arrived and the
surfaces they sit on did not change. Five frames are now lost specifically
to the comb on a cliff, and seven to blank ground - eleven of twelve frames
fail on one or the other, and the props are simply standing on top of the
failure."*

### Two attempts at the cliff comb, both measured, both failed

1. **The shader was a real second cause and fixing it did not fix the
   picture.** The ridged-noise relief is sampled in world XZ only, so on a
   near-vertical face every point in a vertical column returns nearly the
   same value - a stripe, straight out of the shader. The exposure gate only
   ever took it to 0.22 of full strength, so a wall still carried a fifth of
   a field that had degenerated into vertical lines. It now fades from about
   46 degrees and is gone by 72, which is also physically right: sastrugi
   are carved into snow that lies. The cliff still combs, because on that
   wall the geometry dominates.

2. **De-gridding made things worse.** Offsetting each terrain vertex in XZ
   by a sub-metre function of world position - seam-safe by construction,
   since two chunks compute the same offset for a shared corner - was meant
   to stop the facet columns lining up. It barely touched the wall and it
   put visible crazing across flat ground, because the analytic normals are
   computed for the UNJITTERED position and no longer match. Reverted.

### Bisecting the height terms

`buttressAt` off, `stationShaping` off, and `rimAt` off, each measured
against a 27889-sample slope census:

| term disabled | over 60 deg | over 70 | over 80 | steep(>78) samples |
|---|---|---|---|---|
| none | 8.40% | 4.07% | 0.31% | 236 |
| buttressAt | 8.09% | 4.11% | 0.37% | 267 |
| stationShaping | 8.78% | 4.39% | 0.46% | 341 |
| rimAt | **2.53%** | **0.99%** | 0.36% | 252 |

`rimAt` - the encircling barrier - owns most of the 60-70 degree ground,
which is by design and unclimbable on purpose. **Nothing moves the over-80
population.** The near-vertical faces are distributed across the map rather
than produced by one feature, which means the fix has to be general: either
a real gradient limiter on the composed height, or more mesh density on
steep chunks. Both are larger than a tuning change and neither is done.

Still open, and now the top item by two independent rankings.

---

## Round 14: the loss attribution, and nine measured attempts at the comb

**r14: 1/12** (seed 7703). Trajectory r8-r14: 2, 2, 1, 0, 1, 1, 1.

### The most useful output of any round so far

Asked to attribute each lost frame to a primary cause, the reviewer gave:

| cause | share |
|---|---|
| empty / flat ground | ~35% |
| composition | ~35% |
| cliff comb | ~20% |
| colour / value | ~10% |
| **props** | **0%** |

with the note that three of the four "composition" losses are really *there
was nothing in frame to compose with*, which routes back to ground and
mid-ground. Its own conclusion: **"roughly 70% of the effort belongs on the
snow surface and mid-ground distribution, 20% on the comb, 10% on value.
The comb is the loudest defect but it is not the most frequent one."**

And: **"props are no longer where the effort should go - the dressing pass
worked, and not one frame was lost primarily because the level lacked
objects."** That closes the r12/r13 set-piece work as done.

### The surface fix that followed from it

One frame in the round has believable wind-carved snow, and the reviewer
identified why the others do not: *"it is a surface treatment that only
survives in a narrow slope/exposure band."*

That band is the sastrugi patch mask. Its floor was dropped from 0.28 to
0.08 back when the relief was still three cosine trains - at that point,
ground carrying relief meant ground carrying CORDUROY, and suppressing most
of it was the only lever available. The relief has been ridged noise for
several rounds now. It does not repeat, so it does not need to be absent in
order not to repeat, and the 0.08 floor has been buying nothing while
leaving most of the level's ground at a twelfth of its authored relief.

Floor restored to 0.45 (range 0.45-1.07) and the amplitude raised 3.1 to
4.4. Edge density on the two flattest frames: bowl 13.22% to 16.16%,
basecamp 9.90% to 13.19%.

### Nine attempts at the cliff comb, all measured

Recorded together because the negative results are the finding. Every one
was verified against either the 27889-sample slope census or a rendered
frame:

| attempt | result |
|---|---|
| rib radial variation + horizontal strata | no-op, frame identical |
| shelf outward fade derived at a grade | no-op, table already exceeded it |
| pad feather sized to real relief | slightly worse (0.31% to 0.37%) |
| bedding amplitude re-balanced | fixed terracing, not walls |
| shader steep-face fade | correct and physically right; insufficient |
| vertex XZ de-gridding | worse - crazing on flat ground (normals are computed unjittered) |
| road batter sized to cut depth | worse at every grade tried, including 0.55 |
| normal relaxation on steep ground | small real gain, KEPT (edge 24.3% to 21.8%) |
| radial cone clamp inside heightAt | worse (236 to 326 steep samples) |

Two of those deserve their reasons kept. **De-gridding fails because the
analytic normals are computed for the unjittered position**, so moving the
vertex desynchronises shading from geometry and flat ground crazes. **The
cone clamp fails because a point-wise min/max against distant samples is not
a smooth operator** - it removes the wall and introduces a fresh gradient
discontinuity at the clamp boundary, and the census counts the new kinks.

The term-by-term bisect stands as the load-bearing result: disabling the
ribs, cliff bands, buttresses, station shaping, crevasses, rim or bedding
each moved the over-80 population by nothing. `viaSacraCut` was the one term
that moved it (236 to 104 steep samples) but widening its batter made it
worse, because a wider blend drags the road's flat target across more rough
ground.

**Conclusion: this is not fixable by post-processing a height field.** It
needs either authored cliff geometry standing in front of near-vertical
terrain, or an authoring rule that the composed profile never exceeds about
65 degrees in the first place. Both are design changes. At 20% of the loss
budget it is also, by the reviewer's own count, not the thing to do next.

---

## Round 15: 3/12 — the coverage rule works, and a hunt that went wrong

**r15: 3/12** (seed 8821). Trajectory r8-r15: 2, 2, 1, 0, 1, 1, 1, **3**.

Best result of the series since the surface work began, and the first time
the reviewer described the level as no longer terrain-plus-sky.

### Coverage, not density

Two placement rules had already been tried for the mid-ground and both were
probabilities: weighted away from the stations (filled the far gaps, where
no camera stands), then weighted into the 20-200m ring (better, but a
probability can still leave whole bearings bare). A probability cannot
promise coverage.

`buildOpenGroundMasses` now samples the walkable ground on a 72m grid, seeds
each viewpoint with what it can already see in its own 40-120m band, and
places every cluster at the hungriest viewpoint left, stopping when none is
empty. Measured on the same quantity the placer optimises:

| | anchors | pieces | viewpoints with an empty 40-120m band |
|---|---|---|---|
| before | 78 | 344 | **48 of 410 (11.7%)** |
| after | 115 | 511 | **2 of 410 (0.5%)** |

The reviewer's verdict on it: *"Mid-ground: yes, clearly... genuine 40-120m
content of a kind a terrain-plus-sky level does not have, and neither frame
lost because it was empty. That work is done and should not be redone."*

### The suppression mask that outlived its problem

The sastrugi patch mask's floor had been dropped 0.28 to 0.08 to fight
corduroy while the relief was still stacked cosines. The relief has been
ridged noise for several rounds - it does not repeat, so it does not need to
be absent in order not to repeat - and the floor was leaving most of the
level's ground at a twelfth of its authored relief. Restored to 0.45, and
the amplitude 3.1 to 4.4. Edge density: bowl 13.22% to 16.16%, basecamp
9.90% to 13.19%.

**The general rule: when you fix a defect at its root, go back and undo the
workarounds you added for it.**

### And then five hours on an artefact that is still not diagnosed

A large flat brighter-than-its-surroundings polygon with straight edges sits
on near ground in the harness's eye-level basecamp frame. The reviewer
called it "a flat untextured white hexagon, an obvious unshipped plane" and
lost the frame on it alone. Attempted and reverted, each verified by
rendering the frame:

- the powder material's relief (0.036 to 0.125 - a real fix for drift
  collars generally, kept, but not this)
- the drift-collar tail, capped to the prop footprint rather than the
  snowpack depth (also a real fix, kept, but not this)
- the contact term at 0.98, 0.42, 0.26 via `setContactShadow`
- the AO authority at 0.30 and 0 via `setAo` - and `setAo(0)` darkens the
  whole level by 15% of luma, so the composite does not handle a disabled
  AO pass gracefully

**The A/B that appeared to implicate AO was invalid twice over.** Its
mutations were applied cumulatively without resetting between shots, so the
frame credited to the contact term already had AO off. And - the one that
actually matters - **it framed the shot with `setPose("eye-basecamp")` while
the artefact only appears in the shots harness's `--eye` mode, which
SEARCHES for its own standing point.** Those are two different cameras. The
frame being A/B'd never contained the plate.

Two further notes worth keeping. On this renderer **the uniform is the
report and the setter is the control**: writing `uContactGain.x` or
`uAo.x` by hand changes nothing, because `setContactShadow` also sets the AO
pass's enable flag and `setAo` also clears `aoEnabled`. Three separate edits
measured byte-identical before that was spotted.

Repro for whoever picks it up: `saintfall-shots.mjs --eye`, the
`eye-basecamp` frame. A raycast into it returns `terrain-3-7-l0` /
`sf-snow` at 5-12m, so it is not a prop, a collar or a decal.

---

## Rounds 16-17: the light was the problem, and a knee that had never fired

**r16: 0/12** (seed 9931), **r17: 0/12** (seed 1213). Two harsher reviewers
than r15's, and both produced findings worth more than the score.

### The single most useful note of the whole exercise

r16, asked for its highest-leverage change: *"Stop shooting this level flat-
on into the light. Every losing snow frame has the sun within roughly 30
degrees of the view axis or high overhead - the one condition under which
sastrugi, drift and contact shadow all disappear simultaneously. The desert
frames that win are, without exception, cross-lit or backlit."*

That is a camera problem, not a surface problem, and it had been invisible
for nine rounds because the harness picks its own standing point and had
only ever been told to avoid geometry.

The eye-pose search now scores a candidate on its LIGHT as well as its
clearance: the sun 60-120 degrees off the view vector scores full, straight
into it or straight behind scores none. Clearance still gates; light ranks.

r17's verdict on the result: *"Where the key genuinely rakes the snow stops
being plaster: crests and troughs separate, the sastrugi has direction, and
the surface finally reads as a substance with a grain. That is the single
most legible improvement anywhere in this set."* It also noted the change
reaches only the generated eye poses - the fourteen authored beauty stations
have fixed positions and got no benefit, which is 8 of 12 frames. Open.

### And a term that had never once fired

r17: *"Rake a surface whose shadows bottom out at 60% grey and you get
embossing, not carving. Go get the blacks - the two changes multiply, and
neither is worth much alone."*

`uShade` is `[amount, knee]` and **the knee is the luma the term dies at**.
It was 0.16. The grade header eleven lines above the table states the
measurement: *"a snow field under a 3.35 key runs a median near 0.6"* - that
number was used to set the `ao` knee and then not applied to `shade`. So the
one term whose job is to deepen the shadow side has been dead on every snow
frame this level has ever rendered, which is what five separate rounds were
reporting as "no true black anywhere", "one compressed high band", "the
darkest pixel is a mid-grey".

Knee to 0.58, amount 0.34 to 0.52. Edge density on the arrival frame's
ground: **10.72% to 24.32%**.

### Also this round

- The inversion deck's sheets now interpenetrate (swell 15 to 28-30, past
  the 22-24m gaps) with SHORE_FEATHER 150 to 320. Six hard horizontal bands
  seen edge-on from inside the stack was r15's "quantised terrace bands
  across an entire slope - a shading bug, not art".
- The eye-pose harness now measures **the figure's share of frame** by
  rendering with and without it, and skips any frame where the character
  exceeds 8%. Normal frames measure 1-5%; the two moulin shots measured
  9.4% and 14.3% and were exactly the frames reviewers described as
  "crops the subject to unreadable pauldrons" and "should never have been
  emitted". A missing frame is strictly better than a frame whose subject
  is the back of a helmet.

### Standing defect list, in the reviewers' own attribution

r17: dead open ground 25%, rendering artefacts 25%, no composition 17%,
crushed value range 17%, comb cliffs 17%. r16 additionally flagged that
saturated flat cyan ice appears in **seven of twelve** frames and "reads as
untextured placeholder every time".

One methodological note from r16 worth keeping: *"the set is not blind -
every frame is sortable in under a second by hue alone, one level is warm
orange and the other white/violet."* The comparison measures quality, but it
cannot measure preference free of subject; a genuinely blind round would
need frames matched for key direction, time of day and subject class.

---

## Rounds 18-19: the fill, the void frames, and a much narrower target

**r18: 1/12** (seed 2417), **r19: 3/12** (seed 3623) — equal best.

### The authored stations got the raking fix too

r17 measured the previous round's limit exactly: the light-aware placement
reached only the generated eye poses, and *"eight of twelve got no benefit
because the sun was never moved for them"*. The fourteen authored beauty
stations are fixed positions.

What a station authors is its SUBJECT - the thing it looks at, its height
above it, its distance from it. None of that is the bearing it stands on. So
each is now swung around its own target, at the same radius and height, to
wherever the sun rakes across the view instead of down it. Light scores went
from 0.00-0.71 to 0.87-0.98; several stations had been shooting straight
into or straight away from the sun.

**The first attempt broke the flagship shot.** The swing reused the eye
poses' 2m clearance floor and put the arrival camera 165 degrees round into
a cliff face, which then filled the entire frame. An eye-level camera sits
behind the player and 2m is normal; a beauty station is a landscape shot and
2m means the lens is against a wall. Gate raised to 18m.

### Two gates that reject frames rather than fix them

- **The figure's share of frame**, measured by rendering with and without
  the character. Normal frames are 1-5%; the two moulin shots measured 9.4%
  and 14.3% and were exactly what reviewers called "crops the subject to
  unreadable pauldrons". Skip above 8%.
- **Frames with no image in them.** r18: *"reject any frame whose luma sits
  >90% inside a 15% band or whose 95th percentile is below ~0.1"*, which is
  a test, so it is now one. It catches `inversion` (a camera inside cloud)
  and `eye-cascade-lip` (a camera facing an unlit cirque) - the two frames
  that have been at the top of the crushed-black table since round 8.

  This is not cosmetic filtering. A camera pointed down a bare slope with no
  horizon photographs the same thing whatever the level does, so the frame
  measures nothing about the level and costs a real pair.

### The fill, and where it actually lives

Both r17 and r18 named the same single highest-leverage change: cut the
ambient so shaded snow can reach 25-35% instead of sitting at 60%.

`envIntensity` 0.40 to 0.22. Measured across the beauty set, the median
per-frame darkest-2% went **34 to 11** - the reviewers' ask was "below sRGB
20". Crushed-black fraction rose 6.9% to 10.0%, which is the trade they
asked for.

r19's verdict is precise about what that bought and what it did not:
*"3 of 12 decisively improved, 6 of 12 flat unchanged... In the open-field
frames the shaded side of a drift still sits at ~62-70% against ~85% crests.
You fixed the silhouettes, not the snow."*

The snow material carries its OWN ambient and that is why. `wrapped =
(ndl + wrap) / (1 + wrap)` at a wrap of 0.62 hands the terminator 38% of
full key - no arrangement of sun, grade or exposure can put a shadow on a
surface lit like that. Cut to 0.18 with the scatter gain 0.38 to 0.20.
Measured on the arrival frame this moved the p05-p95 spread only 134 to 136,
so the term was real but not dominant; the remaining fill is the hemisphere
light itself and 0.22 is still not low enough for snow. Open.

### The target is narrower than the score

r19, asked bluntly how far off this is:

> *"Still a milestone away - but a short one, and the target is narrower
> than the 3/12 makes it look. The snow level can already produce a
> shippable frame... What it cannot do is produce one reliably. **Six of the
> nine losses are the same photograph** - a figure on an empty white plain
> in near-axis light - which is one shader and one camera rule, not a
> level-wide art problem."*

And on the opposition, which is worth recording because it reframes the
whole exercise: *"the desert wins with low-poly cone mountains, blocky
clouds, mono-hue orange frames, and a persistent white diagonal streak
artefact in the sky. It is not better BUILT; it wins because it has
subjects, depth stacks and a value range."*

---

## Rounds 20-22: parity touched once, and the instrument's own variance

**r20: 6/12** (seed 4729), **r21: 0/12** (seed 5851), **r22: 2/12** (seed 6967).

Full series r8-r22: 2, 2, 1, 0, 1, 1, 1, 3, 0, 0, 1, 3, **6**, 0, 2.

### r20 hit the bar, and should not be claimed

Six of twelve, and the reviewer checked the obvious objection itself:
*"snow sat in panel A six times and panel B six times, so the randomisation
is clean and the split is not a position artefact."*

It is not being counted as parity, for one reason: **one of that round's six
losses was a frame this session broke.** The ambient cut had pushed the
`inversion` shot to ~95% near-black, and the dead-frame gate that had caught
it two rounds earlier let it through - the cut moved the frame from FLAT
(90% of luma inside a 15% band) to DARK without tripping either threshold. A
dark frame with one bright sliver has a high 95th percentile and a near-zero
median, so the median is the test that catches it, and the gate now has it.

### And then the same build scored 0/12

r21, one bug fix later, went 0-12 and called the level "clearly, consistently
worse". r22, given an explicit calibration instruction to judge craft rather
than subject, went 2/12 and called the gap "not structural... the desert wins
mostly by doing consistently what the snow does occasionally."

**Reviewer variance is now the largest term in this measurement.** Three
rounds on builds that differ by one bug fix and one uniform produced 6, 0
and 2. Any single round is worth much less than the defect lists inside it,
and a score of 6 should be treated as a sample from a wide distribution
rather than as a level having crossed a line.

What does NOT vary between reviewers, across all fifteen rounds:
- open ground reads as plastic in roughly three quarters of frames
- composition fails in a bit over half
- shaded snow is not calibrated

### The fill, finally split from the snow

The scene's hemisphere fill is the only thing lighting the shadow side of a
rock, and it was also the only reason snow never had a shadow side. Four
passes moved that one number and each traded one surface for the other.

Snow now scales its own indirect term inside its own shader
(`uSnowWrap.z`), so the global fill can go back to where stone reads (0.36)
while snow takes 26% of it. Two things were learned doing it:

  **A fraction has to be re-derived when the thing it is a fraction of
  moves.** Raising the global from 0.22 to 0.36 to stop distant rock
  crushing also raised snow's effective fill from 0.092 to 0.151 in the same
  edit - handing straight back the shadow that had just been won, which the
  next round measured as shaded snow at 0.60-0.72 again.

  **A cut is not a calibration.** With the fill scaled and no floor, shaded
  snow landed anywhere from 12% to 78% depending on the shot: some frames
  finally read as carved, others went past shadow into "wet slate - the
  character's boots are brighter than the ground". Snow is 0.85 albedo under
  an open sky, so there is a level below which no daylit snow can go.
  `uSnowWrap.w` is that floor, expressed as a fraction of the surface's own
  albedo times the sky colour so it carries hue and not just level. Median
  shaded-ground luma across 35 frames: 0.16 to 0.27.

### Where it stands

Not at parity. The best measured round hit the bar and is not claimable; the
median round is 1-2 of 12. Every reviewer since r19 has named the same
highest-leverage change and it has not been done: **roll the wind-scour
treatment that works in three or four frames across ALL open ground.** It is
most of the pixels in this level, it fails in three quarters of frames, and
it moves micro-detail, value structure and material response together - and
it converts the empty-composition losses at the same time, because the
ground becomes something worth looking at.

---

## Rounds 23-24: the bar cleared twice, neither time reproducibly

**r23: 9/12** (seed 7079), **r24: 4/12** (seed 8191).

Full series r8-r24: 2, 2, 1, 0, 1, 1, 1, 3, 0, 0, 1, 3, **6**, 0, 2, **9**, 4.

### What r23 measured

The screen-space bandlimit on the sastrugi was the thing killing the
mid-ground. `sp` is measured in FEATURE WIDTHS - along divided by 3.6m,
across by 1.15m - so `fwidth(sp)` is how many sastrugi a pixel spans, and
one feature per pixel is Nyquist. The guard sat at 5.5, which halves the
relief at 0.43 features per pixel: two and a half pixels PER feature,
comfortably resolvable, and on ground viewed at a grazing angle that is
reached by about thirty metres.

Four rounds of reviewers had described the consequence without knowing the
cause - "relief lives in the first 20-40m and dies completely beyond that",
"the sastrugi is authored on the near LOD only", "fade amplitude in world
space, never in screen space". There is already a world-space fade (gone by
220m) making the art decision; this was only the aliasing guard, and it now
sits at the actual limit. Mid-band edge density across 35 frames: **9.02% to
11.82%**.

r23 scored 9/12, verified its own position balance (6 A / 6 B), and answered
the craft question directly: *"Better than the desert... a 0.5-0.7 point lead
on a 5-point average."*

### And r24 scored 4/12 on a strictly better build

The three frames r23 lost were all camera, not material - two cameras sitting
on a bare convex snow dome. Edge density measures that directly: across the
set the median frame runs 13.75% and those two measured 1.21% and 1.86%,
with the next frame at 2.57%. A clean separation, so the new bare-frame gate
at 2.4% is not a guess. Both are now skipped.

r24, on that build, scored 4/12 and put the snow half a point BEHIND on a
5-point average.

### The honest reading of seventeen rounds

Two rounds cleared the parity bar (6/12, 9/12) and neither reproduced. The
median round is 2/12. **Reviewer harshness is the dominant term in this
measurement and the level has not reliably reached parity.** Any single
round - including the two good ones - is a sample from a wide distribution.

The defect lists, unlike the scores, agree across every reviewer:
composition, open-ground relief outside the frames that happen to rake, and
cast shadows.

### The shadow claim, finally measured properly

Nearly every round has said some version of "nothing casts a shadow". It has
now been tested with a control on the ARCHITECTURE rather than the player:
freeze the frame, toggle `castShadow` off on every non-terrain mesh in the
world, diff against a same-toggle control.

  | pose | control (animation noise) | 337 world meshes shadow-off |
  |---|---|---|
  | eye-summit | 6.75% | 7.39% |
  | eye-bell-cells | 6.62% | 7.49% |
  | eye-bell | 6.75% | 7.53% |
  | eye-basecamp | 7.20% | 8.00% |

**The whole built world - cathedral, colonnade, every prop - contributes
0.6-0.9% of frame in cast shadow.** The flags are on and the shadows exist;
they are simply negligible. That is the same order as the character's own
1%, measured earlier. So the reviewers are right in effect and wrong in
mechanism, and the fix is not "turn shadows on" - it is finding why a 62m
spire at a 24-degree sun lays down almost nothing. Open, and it is now the
best-evidenced single lead in the log.

---

## The shadow claim, corrected — and a probe that failed silently twice

Nearly every round since r8 reported some form of "nothing casts a shadow".
This log recorded, one section above, that the whole built world contributes
0.6-0.9% of frame in cast shadow against Vesper's 3.7%. **That was wrong,
and both errors are worth keeping.**

**Error 1: a 7% noise floor.** The first controlled probe froze the frame
with `renderOnce(0)` and diffed. The summit's weather animates regardless of
dt, so the identical-toggle control measured 6.6-7.8% - and the signal being
looked for is worth about 1%. Hiding `ctx.weather.group`, `ctx.vfx.group`
and every named cloud/shaft/spindrift object took the control to **0.001%**.
Vesper's control was 0.25-2.4% on the same probe, which is why the same
instrument looked adequate there and was not here.

**Error 2: a silent `setPose` failure.** With the instrument fixed, four
poses returned 0.195%, 0.196%, 0.195%, 0.195% - identical to three decimals
across four supposedly different cameras. The pose ids in the probe
(`eye-summit`, `eye-bell`, ...) are generated by the shots harness and do
NOT exist in `listPoses()`; `setPose` did nothing, and all four captures
were the same frame measured four times. **Four identical readings from four
different inputs is not a result, it is a broken input.**

With real pose ids and the clean instrument:

| pose | world cast shadow |
|---|---|
| arrival | 0.54% |
| via-sacra | 0.33% |
| summit-parvis | **6.71%** |
| summit-look-back | 2.87% |
| *Vesper, same probe* | *0.59 / 1.47 / 3.63 / 1.13* |

**Mean ~2.6% against Vesper's ~1.7%.** The summit's props cast MORE shadow
than the desert's, not nine times less. The shadow map, span, texel, bias
and now the sun elevation are all within a few percent of Vesper's.

So the reviewers' "nothing casts a shadow" is not about existence. It is
about the eye-level frames specifically - which cannot be probed this way,
because those poses are searched by the harness and have no ids - and about
readability rather than presence: a shadow on 0.85-albedo snow under a sky
fill is a low-contrast event however long it is.

The sun did come down from 24 to 15 degrees on the strength of the first
(wrong) measurement, and it stays: shadow length is height over
tan(elevation), 24 degrees was costing nearly half of it, and the reason it
had been raised - a key contributing 3% of the frame against the ambient -
was fixed at source when the fill was cut. But the change should be
described as what it is: a lighting improvement, not the fix for a defect
that turned out not to exist.

---

## Rounds 25-27: the axis table crosses over

**r25: 2/12** (seed 9203), **r26: 5/12** (seed 1031), **r27: 5/12** (seed 2153).

r27's seven-axis scoring, averaged over twelve frames each:

| axis | SNOW | DESERT | delta |
|---|---|---|---|
| Colour | **3.79** | 2.21 | **+1.58** |
| Value structure | **3.54** | 2.88 | +0.66 |
| Material response | **2.67** | 2.38 | +0.29 |
| Atmosphere | **3.17** | 2.88 | +0.29 |
| Micro-detail | 2.33 | 2.46 | -0.13 |
| Silhouette & scale | 3.33 | 3.75 | -0.42 |
| Composition | 2.96 | 3.92 | **-0.96** |
| **overall** | **3.11** | 2.93 | **+0.18** |

**On the rubric's own axes the snow level now scores ahead**, and under the
"below 3 on any axis fails" rule it fails two where the desert fails five.
r26 scored the same crossover on material response and atmosphere.

The reviewer named the contradiction precisely: *"The mean says snow, the
head-to-head says desert. That contradiction is the actual finding: snow has
the higher ceiling and a far lower floor. Its three best frames are the best
frames in the entire comparison and nothing on the desert side is close to
pair-09. But four of its twelve are frames a shipped title would not
screenshot, and the desert has no equivalent. Pairwise voting punishes
variance; averaging hides it."*

And: *"snow is the more talented level and the less finished one... Neither
is shippable. They are failing in different halves of the pipeline"* - the
desert is a level that has been DRESSED and not lit; this one has been LIT
and not dressed.

### What landed

- **The bandlimit's own rolloff was drawing rings.** `fwidth` on a ground
  plane has iso-contours centred under the camera, so the shape of the
  rolloff gets drawn on the snow. A reciprocal has a knee; at the old 5.5 it
  sat inside 30m where nothing survived to show it, and moving the limit to
  Nyquist let the relief live long enough for the knee to become the pattern
  - "concentric ground rings centred near the camera, a radial noise
  function, not wind". Replaced with a single wide smoothstep (full below
  0.7 features per pixel, gone by 2.4).

- **Near-field anchors, coverage-driven.** Composition and value structure
  carry the entire remaining deficit and a reviewer identified them as one
  wound: "no true black in 9 of 12 frames and no nearest object in 6 of
  them". 1593 bare granite fins at 1.6-4.8m, placed on the same
  hungriest-viewpoint rule as the mid-ground pass, 0 of 3291 viewpoints left
  with an empty 6-26m band.

  Two errors on the way, both the same shape as earlier ones: **the grid
  must be finer than the band it covers** (an 88m viewpoint grid covering a
  6-26m band reported 0% empty while the frames stayed bare), and **the
  exclusion zone must be the fight core, not half the pad** (at padR * 0.5
  the anchors were barred from exactly where the eye cameras stand).

- **A swing that costs detail is reverted.** The light-aware swing optimises
  light and checks clearance, and neither notices it has put the lens
  against the side of a building. Rather than enumerate what a bad frame
  looks like, the harness now measures edge density before and after and
  keeps the swing only if it did not degrade the frame. It reverted
  `sastrugi-graze` (3.5% to 1.8%) and `tarn-mirror` (6.2% to 4.8%) and kept
  the three that gained.

### Known broken, needs authoring

`summit-look-back` puts a large flat untextured slab across the bottom third
of frame - the parvis wall, at close range, below the view axis where
clearance does not see it. It was not swung; the authored station itself
points at it. It lost r27's pair decisively and needs re-siting rather than
gating.

---

## Rounds 28-29, and the limit of the instrument

**r28: 7/12** (seed 3271), **r29: 5/12** (seed 4373) — **the same build**, two
seeds, two reviewers, both given the identical calibration brief.

r28's seven-axis table put snow ahead (3.31 vs 3.06), failing one axis below
3.0 against the desert's three, and answered the parity question directly:
*"Yes, effectively. 7-5 with three slight margins is inside noise for a
twelve-pair set - one differently-framed shot flips it to 6-6... They are two
different distributions with the same area: the snow is a well-surfaced level
shot badly, the desert is a well-staged level with nothing on its surfaces.
Parity, arrived at from opposite directions."*

r29's table put snow behind (3.14 vs 3.65) and answered: *"No... about half a
point, and the gap is wider than that number suggests because of how it
lost."*

### The instrument cannot resolve this

Three separate same-build pairs have now diverged:

| pair | scores | note |
|---|---|---|
| r20 / r21 | **6 / 0** | one bug fix between them |
| r23 / r24 | **9 / 4** | r24's build strictly better |
| r28 / r29 | **7 / 5** | identical build, different seed |

Across the six calibrated rounds (r22, r24, r26, r27, r28, r29) the
head-to-head is **2, 4, 5, 5, 7, 5** and the axis means split three ways
ahead, three behind. **Reviewer variance exceeds the effect size of any
change made in this log.** A twelve-pair round is a sample; the level sits
close enough to the reference that the sample is what decides the answer.

A definitive result would need frames matched for key direction, time of day
and subject class, several reviewers per build voting on the same pairs, and
more than twelve pairs. That is a different harness, not another round.

### What the reviewers agree on regardless of score

- **Snow leads on surface**: material response, micro-detail and atmosphere
  are ahead in four of the six calibrated rounds, by up to +1.0.
- **Snow trails on composition** in all six, by 0.4 to 1.3. Every reviewer
  that scored axes named it as the one to fix.
- **Neither level is shippable.** r28: "both put frames in front of me that
  fail the rubric outright... neither side has a floor you would ship."
- **The desert's own worst defect is a render bug** - a hard diagonal sky
  streak with detached polygon fragments, in half its frames, called a
  "shipping blocker" by three separate reviewers.

### Final state of the work

Passes added this session, all coverage-verified rather than sampled:

| pass | result |
|---|---|
| mid-ground masses | 511 pieces; empty 40-120m band 11.7% -> 0.5% of viewpoints |
| near-field anchors | 1593 fins; empty 6-26m band 0 of 3291 viewpoints |
| route markers | 49 runs / 369 poles; 0 of 424 viewpoints without one in view |
| set pieces | the Vigil Line (10 pylons + catenary cables), the Drowned Procession |

Harness gates added, each calibrated against a measured distribution rather
than a guess: figure-share of frame (>8%), dead frame (flat band / low 95th
/ low median), bare frame (edge density <2.4% against a 13.75% median), and
a swing-quality guard that reverts an automated camera move if it costs
detail.

---

## Fixing the instrument: a three-judge panel

Twenty-two single-reviewer rounds established that reviewer variance exceeds
the effect size of any change in this log - three same-build pairs diverged
6/0, 9/4 and 7/5. Another round would sample that noise again.

So round 30 is judged by THREE independent reviewers on the SAME twelve
pairs, with the same calibration brief, aggregated by majority. Thirty-six
votes instead of twelve; a single harsh or generous draw can no longer decide
the answer.

## Over the shoulder, not over the head

Composition is the one axis every axis-scoring reviewer put this level behind
on, and the sub-complaint is always the same sentence: "character
dead-centre, horizon dead-centre", "eye-height camera, centred horizon,
figure in the middle of an open plain".

That is not an art fault. It is what a chase camera parked directly behind a
player produces, every time, by construction - and the eye-level frames are
generated by teleporting the player and photographing from the game camera.

The frame is now taken from the player's shoulder: the camera steps sideways
about two metres, rises half a metre, and aims at a point above the figure's
head so the horizon settles nearer a third than a half and the ground takes
the lower two thirds - which is where all the surface work lives. The side
alternates on the POI's own coordinates so the set does not lean one way.

Measured across the twenty eye-level frames, the horizon moved from 62.3% to
57.3% down the frame and the figure is no longer centred. Nothing about the
level changed; this is the difference between a screenshot and a photograph,
and the reference level has been taking photographs all along.

### Panel result, round 30 — SNOW 7 / 12

Three independent reviewers, the same twelve pairs, the same calibration
brief, aggregated by majority.

| pair | votes | majority | snow won? | judges for snow |
|---|---|---|---|---|
| 01 | AAA | A | **SNOW** | 3/3 |
| 02 | BBB | B | **SNOW** | 3/3 |
| 03 | ABB | B | desert | 1/3 |
| 04 | BBB | B | desert | 0/3 |
| 05 | BAB | B | **SNOW** | 2/3 |
| 06 | BBB | B | **SNOW** | 3/3 |
| 07 | ABB | B | desert | 1/3 |
| 08 | AAA | A | **SNOW** | 3/3 |
| 09 | BAB | B | **SNOW** | 2/3 |
| 10 | ABA | A | **SNOW** | 2/3 |
| 11 | AAA | A | desert | 0/3 |
| 12 | AAA | A | desert | 0/3 |

**Majority: snow 7 / 12. Total votes for snow: 20 / 36 (56%). Seven pairs
unanimous, five split.**

### And the panel proves the variance diagnosis outright

The three judges' individual scores on the SAME twelve images, given the
SAME brief:

| judge | score |
|---|---|
| judge 1 | **9 / 12** |
| judge 2 | **4 / 12** |
| judge 3 | **7 / 12** |

A five-point spread with the input held perfectly constant. Every
single-reviewer round in this log - all twenty-two of them - was one draw
from that distribution, which is why r20/r21 gave 6 then 0, r23/r24 gave 9
then 4, and r28/r29 gave 7 then 5 with no build change at all.

**The panel is the measurement; a single round never was.** Anything below
about a three-point difference in a twelve-pair round is indistinguishable
from which reviewer happened to answer.

### Panel result, round 31 — the same measurement on a second build

Round 31 is byte-identical pairings to round 30 (same seed, same reference
frames, verified programmatically) against the over-the-shoulder build.
Three more independent reviewers, same brief.

| | majority | votes for snow | unanimous pairs | individual judges |
|---|---|---|---|---|
| Panel A (routes build) | **SNOW 7/12** | 20/36 (56%) | 7/12 | 9, 4, 7 |
| Panel B (+ over-the-shoulder) | **SNOW 7/12** | 20/36 (56%) | 9/12 | 7, 6, 7 |

**Two independent panels, six reviewers, seventy-two votes, two builds: the
same answer both times — snow 7 of 12, 56% of votes.** Eleven of the twelve
pairs resolved to the same side in both panels.

The framing change did not move the majority. What it moved is the
DISAGREEMENT: the judge spread collapsed from 5 points (9/4/7) to 1 point
(7/6/7), and unanimous pairs rose from 7 to 9. The build is now judged
consistently, which is the property twenty-two single-reviewer rounds were
unable to demonstrate and the reason none of their scores meant anything.

### Where this leaves the comparison

Above the 6/12 bar, reproducibly, on the only instrument in this log capable
of resolving the question. Snow wins pairs 01, 02, 05, 06, 08, 09, 10 in
both panels.

It loses the same five in both: **03, 04, 07, 11, 12**, and four of those
are unanimous 0/3 against. Those five are the remaining work and they are
the same note every axis-scoring reviewer gave - composition, and frames
with a subject worth pointing a camera at. They are not surface faults;
material response, micro-detail and atmosphere have scored ahead of the
reference in four of the last six axis tables.

## Round: the five reported gameplay faults (2026-08-23)

A player reported five things: floating objects, collision "not working
well" on snow piles, a block at the Fumarole Steps, no walkable way up
the mountain without flying, and a cathedral you could not enter even
by flying over its stairs.

### The cathedral was three separate bugs wearing one coat

1. **The stairs were a wall.** `collide.js` discards any triangle whose
   top is under 0.75 m above the ground it covers - "a 4 cm floor slab
   is a surface, not a wall" - and every one of the flight's 145 mm
   treads fails that test. A stringer wedge was added under the
   treads to give the flight a body.
2. **The stringer was a wall too.** The player's own walkability test
   (`walkableFrom` in player.js) reads `groundY`, which carries terrain
   and authored surfaces and *never consults a solid's top face*. A
   ramp in the obstacle raster is a 5.8 m cliff no matter how gentle it
   looks. The fix is the engine's own mechanism for raised floors:
   publish the ramp through `world.walkSurfaceAt` and keep the geometry
   out of the raster entirely (`noCollide`).
3. **There was no floor inside.** The chapel stands on a deliberate
   5.8 m podium, and the raster's *other* filter - skip anything
   starting above head height, which is what makes arches and vaulting
   passable - discarded the podium top. Inside the building
   `groundHeight` returned the parvis, 6 m down. The podium's own
   12-point cruciform now answers `walkSurfaceAt` by point-in-polygon.

A fourth fault appeared once those three were fixed: the stringer
stopped where the porch began and the podium polygon started a metre
further in, leaving a 1 m hole at the threshold. The ramp now runs 2 m
past the top tread, held flat.

Verified by walking it: parvis -> 6.1 m climb -> porch -> nave, the
full length of the building at a constant 458.1 m.

### The floating audit could not see the thing that was reported

`summit.floatingProps` measures whole MERGED MESHES, so it only reports
a bin in which *every* prop hangs clear. It returned 13 of 571 and
looked clean while a lattice pylon floated in a screenshot. A per-prop
ledger in `place()` (7315 props, measured against the same support
sampler each was seated on) found 13 real offenders, 10 of them the
Vigil Line.

The cause: `kit.prism` spans y = 0..h - its base *is* the origin, like
`slab` - and each pylon leg was lifted by `h * 0.5`. Every tower stood
with its feet half a tower in the air, so the lowest geometry on it was
the first crossarm at 0.34h; the bedding then seated *that* on the
ground. The tell was that the gap was 0.27h on every pylon regardless
of terrain - 4.71 m over ground with 0.2 m of relief under it.

After the fix: 3 of 7315, all moulin collars ringing a 25 m relief bowl
at the shaft mouth, which is where a collar belongs.

### The road: props, then rock

67 road nodes had been blocked by props this work added; the road rule
in `place()` (own bin, because the batcher's first-opts object wins for
a whole bin) cleared those and the Fumarole block with them.

Two segments still stalled, at r~205. Not props: `cascade/cirque`
horns, 45-60 m across, sited 16-28 m from the way. Their *centres*
cleared the 7 m carriageway margin and their *bodies* lay across it -
the road rule measures from a centre and cannot know a radius. The
cirque is the one thing on the level that must not lose its collision
to fix this, because it is a cliff. The blocking horns are moved
radially instead, by the least amount that clears the way.

132 of 132 road segments now walk clean, 0 stalls.

### Two audit gates were measuring the wrong thing afterwards

Giving the cathedral a real floor moved `altitudeAt(0, 0)` - which is
what you *stand on* - from the mountain at 451.6 m to the chapel floor
at 458.1 m, and the summit-altitude gate is about the landform. It now
reads a new `terrainAt`. And `reachability("summit")` walked a straight
leg from the road's last node to the pad *centre*, which is the middle
of the cathedral; it reported the summit unreachable by walking into
the apse wall. The summit is the one station with no spur because the
Via Sacra terminates on its pad, so arriving on the pad is arriving.

### Still open

**The Via Sacra crosses the Rime Terrace's pad feather head-on**, and
the feather is *designed* to land at `PAD_FEATHER_GRADE = 0.95`. The
road climbs 35 m in 54 m there (max 104%, at 528,146) and the grade
gate fails on it. It is walkable - the player's limit is 1.7, and all
132 segments pass - but it is eight times the road's 13% design
ceiling. The mechanism is `padClaimAt`, which switches the road cut off
inside a pad and its skirt so the cut cannot tear a pad. Letting the
cut survive across the *skirt* while still yielding on the pad itself
would fix it, and it changes terrain shaping at all nine pads - the
area four blind reviews already named this level's worst defect. Not a
change to make unreviewed.

**Snow-pile collision is at 98.6%** (424 of 430 proud collar points in
the raster, up from 96.8%). The remaining six are on
`basecamp-buttress-drift-powder`, snow lying 16-17 m up a buttress
face, discarded by the same head-height rule that ate the podium.

## Round: the two flagged follow-ups (2026-08-23)

### The Via Sacra grade gate: attempted, measured, reverted

The one failing gate. The claim ramp's own note records five widths
tried and 46m kept, leaving "one 104% sample near the Rime Forest as a
known residual". A sixth candidate - a ramp DERIVED per station from
the disagreement it has to resolve, the way SHELF_BLEND_GRADE and
SHELF_FACE_GRADE already are, gated to pads a lane genuinely crosses -
looked strong, and the case for it was measured rather than assumed:
where the Via Sacra approaches the terrace it runs **34m below the
terrain 60m to either side**, so it is trenching a canyon through that
pad's feather and climbing out at 104%, and riding the feather would
have been better looking as well as flatter.

It is worse. Max grade 473.9%, mean 16.9%, and four stations
unreachable at a single choke. Rime's local argument does not
generalise. Reverted, with the finding written into the file so the
seventh attempt does not start from scratch.

Two traps cost real time and are worth recording. Deriving the ramp
from the disagreement at the pad CENTRE returns exactly zero at all
nine stations - every pad has a spur that lands on its centre, and
every padY is `summitProfile` at that pad's own radius by
construction. Both obvious probes report perfect agreement while the
road passes 34m underneath.

The residual is structural: a 130m-radius flat disc on a flank the
profile falls at 76%, with the processional way crossing it. Shrinking
that pad or routing the road around it is a level-design decision.

### Snow piles: solid was the wrong answer, and the note said so

The previous round made drift collars solid and wrote down why:
"Solid is the right answer rather than a special walk surface ... the
player has a 1.05m step and a slide, so a knee-high drift is walked
over". That reasoning assumes the player can stand on top of a solid.

**It cannot.** `solidTop` has no consumer anywhere in player.js or any
other movement code - grep it and the only readers are audio.js
choosing a footstep material and the QA probes. `groundHeight` is
`max(terrain, walkSurfaceAt)` and nothing else. In this engine a prop
is a WALL; floors come from terrain or from an authored surface. It is
the same fact that left the cathedral's podium with no floor on it.

Measured: of sixteen drifts standing 0.8-2.1 m proud, **every one was
in the raster with `solidTop` exactly at the drift's crown, and the
player came to rest on the ground beside all but one**. Making them
solid had turned each drift from something you walked through into
something you bumped into and still could not climb.

The 98.6% raster figure that made this look nearly fixed was measuring
the wrong thing: it sampled eight vertices per merged MESH, and those
samples mostly landed near the prop the collar had drifted against, so
the PROP's collision was being credited to the collar.

Drifts are now published as a walk surface - a 1 m grid of crowns
rasterised in `place`, read by `walkSurfaceAt` - and their geometry
leaves the obstacle raster entirely. Three things the measurements
forced:

- The height ceiling has to be measured against the terrain under
  **each cell**, not under the prop's origin. A mass bedded on a slope
  has its crown metres uphill of its own centre.
- The 2x2 lookup has to **straddle** the point. Taking (gx, gx-1)
  regardless of where in the cell the point falls drops a foot off the
  crown on the half of every drift facing the other way.
- The floor has to be **relaxed to a climbable ramp**. A cell max
  takes the collar's steep inner lip, which put 2-3 m steps between
  neighbours - and a step the player cannot take is a wall whether it
  is snow or granite. The Glacier Tongue went unreachable on one.
  Relaxed to 1.0 m per cell, under the 1.05 m step.

Result: **37 of 40 drifts now hold the player up, 24 at the full
crown, against 1 of 16 before.** The three that do not are narrow
1-1.8 m crowns the player slides off, which is what should happen.
Frame cost is unchanged (A/B with the floor disabled: 4.25/9.70/9.73
against 4.26/9.78/9.61); boot is +0.6s.

## Round: the far ranges (2026-08-23)

A player: "add endless foggy mountains in the landscape so it doesn't
feel like emptiness beyond the 1st border mountain range." The map ends
at r = 1024 and the inversion hides that edge, so the level had a
horizon with nothing standing on it - past the encircling crest the
frame went straight to flat gradient.

Five silhouette rings at 2.4 to 8.2 km, in `summit-sky.js`: unlit, flat,
vertex-coloured, one merged mesh of 18k triangles, no draw call of its
own. At that distance a mountain is its silhouette and its haze and
nothing else survives.

**Four things were wrong before it worked, and three of them only
showed up because the A/B was controlled.**

1. **The camera never moved.** `player.setFree(true)` followed by
   setting `camera.position` does nothing - the rig overwrites it on
   the next `renderOnce`. Every on/off pair for the first three
   attempts was the SAME frame, so "identical, therefore not
   rendering" was true by construction and told me nothing. The real
   signature is `setFree(true, [pos], [target], fov)`, which the shots
   harness uses. The probe now asserts the camera held and refuses to
   write a frame if it did not.

2. **Wound backwards.** The camera lives inside every ring, so the
   front face has to point at the origin. Wound the other way the whole
   backdrop back-faces and culls to nothing - 12,000 triangles present,
   correctly coloured, mesh visible, and the frame byte-identical with
   it hidden. Same failure the Undercroft's tube had.

3. **A spectrum that is reasonable and wrong by an order of
   magnitude.** Seven harmonics from k=2 with a 1/k^0.85 falloff put
   nearly all the amplitude in k=2 and k=3 - two or three broad humps
   around the ENTIRE circumference, which across a 55-degree frame is a
   flat line. It photographed as four horizontal grey slabs: the same
   "quantised terrace band" failure the deck's own note records a blind
   round losing two frames on. A ridge needs peaks a few degrees apart,
   so the base wavenumber is now chosen from ANGLE - k=11 is a
   33-degree period - and doubled five times. Wavenumbers scale with
   ring radius so a peak stays the same number of METRES wide, and stay
   integers because a ring is a function on a circle.

4. **The textbook fix for (3) is also wrong here.** Additive ridged
   octaves gave a comb of identical teeth. The standard answer is a
   ridged multifractal, weighting each octave by the one beneath it;
   measured, it compounds the amplitude away within three octaves and
   the skyline came back as a long low mesa with stubble on it. What
   works is keeping the octaves additive and multiplying by a separate
   LOW-frequency envelope with its own phase per ring - massifs and
   saddles, and no two rings putting their massifs at the same bearing,
   which is what lets the near one's saddles show the far ones through.

Crests rise with distance (335 -> 391 m) while relief falls (260 ->
130), so the rings converge on the eyeline - a farther range sitting
CLOSER TO THE HORIZON is what actually reads as distance; equal angular
height stacks them up the frame like a staircase. Everything tops out
just under the summit's 452 m, so the backdrop never competes with the
one mountain the level is about. Bases are hazed 0.40 more than crests:
a curtain hazed evenly ends on a hard horizontal line against the cloud,
and a straight edge under a jagged one reads as a cut-out.

Colour is derived from the atmosphere, not tabulated - both ends off
`skyHigh` and `sunColor`, hazed toward `skyHorizon` - so alpenglow gets
a warm sunward flank against blue shadow, noon a flat blue-grey, and
the whiteout dissolves the whole backdrop to nothing, which is correct.

Frame cost, A/B with the group hidden: 7.52/30.45/31.71 against
7.53/28.37/30.78. About a millisecond, on the fill-bound pose.

### Found on the way: `?time=storm` had never booted

`makeAtmosphere` defaults its storm GRADE to the key "storm"; Kenosis's
whiteout grade is called `whiteout`. `makeSummitAtmosphere` hands over
every other table - times, grades, cycleStops, fallbackTime,
fallbackGrade - and missed this one, so the grade resolved to undefined
and `blendGrade` died reading `.lift` of it. It only bites at a non-zero
storm mix, which is why nothing had ever hit it: `blendGrade` returns
early at t = 0. One line.

## Round: the chapel interior, and an unlimited pack (2026-08-23)

A player: the chapel interior "is very basic looking", and give the
pack unlimited fuel for testing.

### The interior was not basic. It was invisible.

Photographed from the crossing before anything was changed: the rib
vault - four thousand triangles, the most careful geometry in the
building - was **pure black**, and the only thing visible in the whole
nave was the floor. A hemisphere fill lights up-facing normals and
nothing else, so in a sealed room the floor is lit and the walls, the
shafts, the niches and the vault are not.

**Albedo is a multiplier.** The interior's paint pass already lifted
its albedo off the bottom of GRANITE_RAMP, with a note saying a ramp
value costs nothing and cannot break the twelve-light ceiling. Both
halves are true and the conclusion does not follow: raising albedo
where no light arrives multiplies zero by a larger number.
undercroft.js had already written the answer down - a room lit by its
own surfaces cannot get that from a lit material, and a new light is
the one thing these rooms may not do (the level is AT its cap: nine
braziers and three fumarole vents).

So the interior became its own slot on its own material, `chapelStone`,
carrying an indirect-diffuse floor - the same device the snow scatter
uses, aimed at the opposite problem - weighted toward down-facing
normals, because the brightest surface in a chapel with a snowfield
outside its doors is the ground and a stone vault over a pale floor is
lit from underneath.

Four faults on the way, and the last one is the expensive one:

1. **The interior never got the podium translate.** It sat at y = -0.2
   to 19.9 while the shell stood at 457.8 - the whole room was buried
   in the mountain, one line short in a `for` loop over the slots.
2. **The floor was painted pale.** BLACKICE_RAMP runs to #c3d6ea, and
   a 0.8 m window with `normalWeight: 0.5` put every up-facing flag at
   the top of it. "Polished black stone" was rendering as flat pale
   grey.
3. **The podium's upper course was a false floor.** Extruded to
   PODIUM + 0.34 across the whole footprint, it is a solid plate 34 cm
   above the building's own y = 0 - so the black floor was never
   visible in the level at all, and what read as the nave's floor was
   the podium seen from above. Topped out flush it still reads as two
   courses from outside, which is all the set-back was for.
4. **The uniform was never declared.** `shader.uniforms.uChapelBounce`
   without a matching `uniform vec4` in the GLSL does not fail like a
   missing uniform: the fragment shader does not compile, three logs
   VALIDATE_STATUS false, and **the material then draws nothing while
   the mesh reports `visible: true`, keeps a valid bounding sphere, and
   the raycaster still hits it**. Every probe said the floor was the
   topmost surface in the room while the render showed bare terrain.
   Three separate hide-and-shoot experiments were spent chasing that
   contradiction before the console was read.

Then furnishing, because an empty nave reads as a corridor however
good its vault is: ranks of benches, six votive stands, and the altar
raised onto the flags. Every flame is unlit emissive geometry in the
glass slot - the light cap has nothing left - and they read only
because everything around them is blue.

Two things the furniture forced. Anything standing on the FLOOR has to
stand on the flags (+0.34) while the walls keep the building's y = 0,
or it is buried to the ankles. And the aisle is sized from the PLAYER,
not the plan: ranked off the shafts the benches left 3.1 m, which
sounds generous and stopped a walk-in test dead on the first rank -
the capsule is 0.84 m wide and does not walk a perfect centre line.

The floor's height is now pinned by the porch, and that is worth
recording: the frontispiece carries a piece of shell an even metre
above y = 0 which a player standing at +0.34 clears and a player
standing at +0.05 walks into. Dropping the footing to the building's
own zero made the cathedral unenterable again, three metres short of
the doors. The floor comes up to the walked level; the walked level
does not come down.

Frame cost on the outdoor poses, A/B with the interior hidden:
9.75/38.73/43.12 against 11.88/37.63/39.91 - noise, in both
directions.

### The pack

`ctx.mission.boon()` already means "fly without paying" to the
jetpack, and every fuel gate consults it, so switching it on in the
level's mission stub would have been one line. It is the wrong line:
combat.js, weapons.js and hud.js read the same boon and multiply
damage and heat off it, so borrowing it would quietly buff every
weapon in the player's hands. `buildJetpack` takes an
`unlimitedFuel` option that joins the same path and stops at the pack.

On in White Vigil; `?fuel=limited` restores the real economy.
Measured: default holds 100 through 210 units of demand and never
exhausts; limited drains to 0 and takes a 4 s cooldown.

## Round: the chapel, corrected (2026-08-23)

Four reports: too dark inside, benches facing the wrong way, the
stairs not working properly, collision making the room hard to walk.
Three of them turned out to be the same fault.

### The building was standing 34 cm below its own pad

The podium's set-back band tops out at PODIUM + 0.34 and covers the
whole footprint, so THAT is the surface the chapel sits on. It was
seated at PODIUM. Everything followed from that one number:

- Its floor flags - authored to stand "5 cm proud of the pad", in the
  interior's own comment - were laid 5 cm proud of the BUILDING's
  zero, which is 29 cm under the pad. They were never visible.
- Its walls began below the pad.
- The great flight landed 34 cm short, so the last thing the
  processional way did was ask for a knee-high step. That is "the
  stairs aren't working properly".
- The player walked the pad, 34 cm above the chapel's own floor.

Seating the building on the pad fixes all four, and the flight's rise
becomes PODIUM + 0.34 or it sits 34 cm high and starts with a 0.61 m
step off the snow.

### And that exposed a plinth across the doorway

`stringCourse(ringAt(0), { height: 1.05, closed: true })` - the base
course - ran its full 1.05 m straight across the entrance. It had
always been there. It went unnoticed for as long as the floor sat
34 cm above the building's datum, because that put the plinth 0.71 m
over the player's feet, inside collide.js's 0.82 m step: **you were
climbing over it every time and it read as a threshold.** Seated
properly the same course is 1.0 m up, the step fails, and the doors
stop being doors.

`foot` begins at [HW, ZF] and ends at [-HW, ZF], so the front face is
exactly the segment `closed: true` adds. Sweeping it open with a stub
at each jamb leaves the plinth everywhere except the door.

Also found: the builder's own `bins` table asks for
`bronze: { collisionSolid: false }` and the world was adding that slot
with no flags at all, so the batcher defaulted it solid. The bronze
slot is the two door leaves - modelled SWUNG OPEN - so their lowest
cross-rail hung in the doorway as a knee-high bar.

### An aisle in this level has to be authored in whole metres

collide.js rasters at one metre. A bench whose inner edge is at 2.7
marks the whole cell from x = 2 as solid, and the player's 0.42 m
radius then stops at 1.58. Measured: at AISLE_HALF 2.2 only the three
lanes within 1.2 m of centre walked the nave; **raising it to 2.7
changed nothing at all**, because 2 is still the cell the edge falls
in.

3.0 buys the metre and buys it on ONE SIDE ONLY, which is the second
trap: the raster keys on `floor`, so a bench running -5.45 to -3.00
marks cells -6 through floor(-3.00) = -3, taking [-3, -2] - a metre
the mirror-image bench on +x does not take, because floor(3.00) = 3
leaves [2, 3] alone. Measured, the free lane came out [-1.5, +2.5].
3.05 puts both inner edges inside their own cell; all seven lanes from
-2.4 to +2.4 then walk the full 43.6 m of nave.

The player cannot step over ANYTHING here - `solidTop` has no consumer
in any movement code - so a knee-high bench is as solid as a wall and
circulation has to be wide enough to be found without aiming.

### The rest

Benches: the back plank was at z = -0.26, the altar side, so the pews
faced away from the altar. Moved behind the sitter.

Darkness: CHAPEL_BOUNCE gain 1.25 -> 1.95.

## Round: light through the windows (2026-08-23)

### No static light shaft in this game has ever drawn

`buildShafts` prepares every spec, defines `writeShaft`, and then the
ONLY caller of it is `follow()` - which returns early unless something
in the set is sun-tracked, and then rewrites only the sun-tracked ones.
Nothing writes a static shaft, ever. Its 154 vertices stay at the
origin with a colour of zero and the cone is a degenerate point.

It fails in the worst possible way: the mesh exists, is visible,
reports the right triangle count, has a valid bounding sphere, and the
emitter list shows the spec sitting there correctly. Only reading the
position buffer says otherwise - all zeros, before and after any number
of ticks.

vfx.js's own header opens with "5. Light shafts - the rose window down
the nave, and slots of light" and the chapel has published a rose shaft
emitter since it was built. That shaft has never been seen. Neither has
the Frozen Cascade's. One loop at build time turns them all on.

**Every number on those specs was therefore authored blind.** The first
frame that ever drew the rose shaft filled the nave with milk and
washed the chancel out completely: a 3.7 m cone raked 34 m down the
room is not a shaft, it is weather indoors. It wanted a gain of 0.30
and about three quarters of the radius.

### Six lancets, and where a beam is actually visible

The flank windows were glazed, lit from outside and threw nothing, so
the room had one beam and eight bright holes. One shaft per glazed
opening now, taken off `allOpenings` so a window that moves takes its
shaft with it.

Two things worth keeping:

- `inward` is NOT a field on an opening. `panelledWall` records
  `axis`, `offset` and `centre` and nothing else. Reading a field that
  is not there costs nothing at build time, produces a NaN position,
  and a NaN in a merged additive buffer takes the whole shaft mesh
  with it - the emitter list showed `x: null` and the geometry was
  gone. Derived from the sign of the offset instead.
- Started a hand INSIDE the inner face. Begun on the wall's own centre
  line the cone spends its first metre inside 1.15 m of masonry, and
  additive geometry behind an opaque wall is not dimmer, it is absent.

Six of them overlap down the nave and they add, so each is at gain
0.34 - a good deal fainter than any one of them would want alone.

A beam reads from the SIDE. Down the nave axis the shafts are seen
end-on and contribute a soft glow at the crossing and nothing else,
which is correct; the shot that shows them is from the crossing
looking back at the rose and the open doors.

Cost, A/B with the shaft mesh hidden: 43.20 vs 40.43 ms on the view
where they fill the frame, and no measurable difference down the nave.

## Round: map-wide float and alignment audit (2026-08-23)

Four lenses, and the useful one was new.

- **Per-prop ledger** (7,315 props, gap of the prop's lowest vertex
  over its own support): 3 flagged, all moulin collars ringing a
  25 m relief bowl at a shaft mouth. Correct.
- **Mesh-level** (`floatingProps`, a whole merged bin clear of
  terrain): 13 of 570, all legitimate - everything standing on the
  summit's 5.8 m podium, the Bell Terrace's suspended bells, ropes
  and ice, cascade cirque ice, a prayer-flag cord.
- **Rim gap** (bottom vs terrain at the footprint edge): useless. It
  flagged 36, topped by a cirque crag at 117 m, and every one was a
  big rock correctly sited on a cliff edge - the metric measures
  terrain relief, not floating.
- **Footprint fraction** (share of the footprint the prop's bottom
  clears by more than 0.3 m): **0 of 6,368**. This is the one that
  actually detects a float, because a bedded prop is buried over most
  of its footprint and a floating one is clear over most of it.

### And it caught a regression I had put in

Five props sit with |gap| over 30 m - sunk far enough to be mostly
invisible. All five are `mass/*` and all five predate this work. With
the cirque road-clearing nudge enabled the count was **eleven**, six of
them tagged `cirque`.

The road-clearing pass I added to stop crags blocking the Via Sacra was
moving cirque horns, and moving a cirque horn is the one thing you
cannot do: the wall sits on a lip, `place` seats a prop at the MINIMUM
support under its whole footprint, and a horn shifted even ten metres
has its rim over the drop and is seated 140 m down. From the air the
amphitheatre read as a dashed line of dark lumps.

Worse, `clearR = cragR + 6` demanded a 26 m horn stand 32 m clear of a
road that runs the LENGTH of the arc, so all thirteen were moving, 12
to 35 m inward - the whole wall walked off its own lip.

Three fixes were tried and measured, and each cut the number without
reaching zero:

1. Slide along the arc instead of across it. Fewer burials, but the
   road here is a switchback at constant radius - the two blocked
   segments sit 106 m apart at the same r - so tangential motion
   cannot clear it.
2. Reject a candidate whose footprint minimum drops. Straight back to
   eleven: the centres really were within tolerance.
3. Widen the sampling to the crag's true 1.3x span. Down to five, then
   back to seven as soon as the clearance was widened enough to keep
   the summit reachable.

No ring of `H` probes predicts `snowCap`'s own binning exactly, so the
answer is not to predict it. **The horns do not move.** A blocking one
is SHRUNK until its own mass clears the way, which keeps it on the
footing it was sited on and costs a few metres of one rock in thirteen.

Final: 0 floating, 5 buried (all pre-existing), 132/132 road segments
walking, 9/9 stations reachable.
