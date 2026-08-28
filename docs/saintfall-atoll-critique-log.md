# SAINTFALL — The Green Antiphon — critique log

Rubric: [`saintfall-atoll-critique-rubric.md`](saintfall-atoll-critique-rubric.md).
Reference pool: `output/saintfall/island/ref-vesper` — 18 Vesper-IX frames, ultra,
1600×900, captured from `main` before any atoll work began.

> **A defect is not closed because it was fixed. It is closed when a later blind
> round stops naming it.**

---

## Round 0 — pre-build instrumentation

Not a critique round. Recorded because the numbers it establishes are what every
later round is measured against.

| | |
|---|---|
| Vesper-IX baseline | 18 frames, ultra, 1600×900, `output/saintfall/island/ref-vesper` |
| Harness fault found and fixed | `saintfall-shots.mjs` read `T.summit.altitudeAt` in the raking-light swing — a hook that exists **only on the Kenosis page**. The whole authored-pose loop threw on Vesper-IX and captured **2 frames of 18**. Now prefers `T.collide.groundHeight`. The baseline could not have been taken without this. |
| Engine fault found and fixed | `qa.js report()` bare-dereferenced `api.enemies.stats()` and `api.weapons.stats()`. `report()` is the **last** thing the shots harness calls, so on any environment-only level it threw *after* every frame had been captured and turned a successful run into a failed one. Now optional-chained. |
| Field gates at first green | non-finite over the map **0 / 66049**; circuit grade max **0.112** (≤ 0.18); Cauldron road grade max **0.150** (≤ 0.16); reef crest **0.60–0.65 m on all 24 bearings** scanned outboard of the outer waterline; reef flat −0.18…−0.36; Cauldron peak **217.5 m**. |
| Open defects entering round 1 | none named yet |

### Round 0's two-day fault, recorded in full because it named nothing

The level booted, the scene target contained a correct image, no shader failed to
compile, no console message appeared — and **every one of the 1.44 M pixels came
back the same value** (188,186,183; min 182, max 190).

Switching off bloom, AO, contact shadow, shade, the toe and the exposure — the
exposure set to **0.001** — changed the output by *zero*. Only the vignette and
the lens halo moved it, which is what sent the first pass of diagnosis toward the
post chain's screen-space end, where the fault was not.

`render.debugBlit("scene")` settled it in one call: the scene target blitted
straight to the canvas gave mean 98, min 20, max 213 — a real picture. So the
target was fine, the quad pipeline was fine, and the composite was destroying it.

**Cause:** `render.js`'s `applyAtmosphere` writes `uContrast.value = g.contrast`
and `uTintAmount.value = g.tint` **without a finite check**, while defaulting
`toe`, `shade`, `bounce` and `ao` right beside them. `ATOLL_GRADES` defined
neither — both are easy to miss, because neither appears in the schema anyone
reads off. `undefined` reaches a uniform as **NaN**, and
`c = (c - 0.5) * uContrast + 0.5` turns one NaN into the whole frame. NaN does
not care about exposure, which is exactly why the sweep looked inert.

**Fixed twice, deliberately:** all five `ATOLL_GRADES` now carry `contrast`,
`tint`, `shadowTint` and `highlightTint`; and `render.js` now defaults `contrast`
and `tint` the way it already defaulted their four neighbours. Vesper-IX and
Kenosis define both on every row and are unaffected.

Two smaller ones on the way through:

- `atoll-water.js`'s `ShaderMaterial` included `shadowmask_pars_fragment` without
  `lights_pars_begin`, which is where `receiveShadow` is declared. The fragment
  shader failed to compile, and an invalid program is not a missing sea —
  `useProgram` failed and the whole frame went flat. One declared uniform fixed it.
- The comment explaining that fix quoted the chunk names in **backticks**, inside
  a GLSL string that is a **JS template literal**. The level died at boot with
  `SyntaxError: Unexpected identifier 'shadowmask_pars_fragment'`. No backticks in
  GLSL comments.
- `atoll-world.js` did not publish `banners`. `vfx.js:1289` calls
  `buildBanners(ctx, world.banners)` unconditionally and dereferences
  `specs.length` with no guard, so the level died in a module that has nothing to
  do with the world.

---

## Round 1 — first captured frames

`scripts/saintfall-atoll-round.sh 1 trade ultra`, 13 of 15 poses captured,
**422 fps / 2.37 ms** at ultra, 61 draw calls, 218 k triangles.
Dressing is still a placeholder: no vegetation, no wreck, no arena furniture.

**No blind round was run.** With half the level's content absent a preference
round would measure the absence, not the craft. Round 1 is a *self*-critique
against the rubric's twelve tells.

### Defects named, in priority order

| # | defect | evidence | owner |
|---|---|---|---|
| **1** | **The cumulus are upside down.** Towers hang from the top of frame like stalactites with the flat, green-tinged base disc at their *lower* end. Trade cumulus sit *on* a flat base at the lifting condensation level and build upward; that flat base line is the single thing that makes a tropical sky read as tropical, and it is inverted. | `arrival.png`, `atoll.png`, `crest.png` — every frame containing sky | `atoll-sky.js` |
| **2** | **The ocean is corduroy.** From the reef crest the open sea is a field of perfectly parallel, perfectly regular ridges running to the horizon with no decorrelation and no scale change with distance. This is Kenosis's own recorded "corduroy or plaid" defect, on water: one train, one heading, aliasing hard at range. It reads as rippled sheet metal. | `crest.png` | `atoll-water.js` |
| **3** | **There is no foam anywhere in the level, and no reef break.** The `crest` camera stands *on* the reef crest, which is where the swell is specified to trip and break, and there is not one pixel of whitewater in the frame. | `crest.png`, `atoll.png` | `atoll-water.js` |
| **4** | **The Cauldron reads as a flat-topped mesa.** The level's only vertical, and from the aerial camera it is a butte with a flat top and smooth, rounded, featureless flanks. A 217 m volcanic plug should be the most dramatic silhouette on the level; instead the crater floor at 194 and the rim at 217 read at distance as one plateau. The rills are invisible. | `atoll.png` | `atoll-terrain.js` |
| **5** | **The lagoon floor is camouflage.** The bommie field reads as high-contrast leopard blotches at one scale, evenly distributed, with no shadow and no relief — paint, not coral heads. | `atoll.png` | `atoll-terrain.js` |
| **6** | **The arrival frame's near half is a blank flat plane.** Camera clearance measured **1.72 m**. The Landing's pad is flat to ±0 over 118 × 46 m and fills the lower half of the level's most important frame with one untextured tan value. This is Kenosis's "flat untextured hexagon", in sand. | `arrival.png` | `atoll-terrain.js` / `atoll-world.js` |
| **7** | **No sun glitter path.** Specified as the strongest "this is water" cue there is, and absent from every frame. | all water frames | `atoll-water.js` |
| **8** | **Two poses rejected outright** by the harness's own no-image test: `prow` (90 % of luma inside 29 %) and `weeping` (90 % inside 71 %). | harness log | cameras |

### What is already right, and should not be traded away

- The atoll **reads as an atoll** from the air: ring, lagoon, reef flat, drop-off.
- The **depth colour works.** The turquoise is derived, not painted — shallow to
  deep reads correctly across the lagoon, and the drop-off is a hard colour edge.
- **422 fps at ultra** with 218 k triangles and 61 draw calls. There is a very
  large performance budget still unspent, and the dressing has to fit in it.

### Changed in response

Dispatched as round 2's work. Re-tested in round 2.

---

## Round 2 — the sky and the landform

Six agents dispatched; **four were killed mid-flight by a usage limit** and only
two returned reports. The four that died had, however, already written their
files — the loss was the reports, not the work, which is why every claim below is
re-measured here rather than quoted from an agent.

`output/saintfall/island/antiphon-r2/*.png`, 14 of 15 poses captured (was 13).

### Closed

| # | defect | what fixed it | evidence |
|---|---|---|---|
| **1** | **Upside-down cumulus** | Four separate faults, not one sign error. `pushLobe`'s side walls were **wound inside out** (`n · outward` measured −0.57 to −0.95 on all seven quads, now +0.984 to +0.996), so the drawn surface was the *interior of the far wall* and `computeVertexNormals` handed the repainter an inward normal — the lit shoulder was on the wrong side of every cloud in the sky. The lowest lobe also hung **364 m below the flat base** on a congestus, which is the stalactite. And the aspect ratio was a function of *distance* (a congestus came out 164 m wide by 2130 m deep at the near limit — aspect 13.0) because width was authored in degrees while depth was in metres. | 25 of 30 cells now base at exactly y = 640 and 25 of 30 are widest in the bottom decile of their own height. `crest.png`, `strand.png` |
| **1b** | **Green cloud bases** | `repaintCumulus` mixed **38 % of `atmos.groundBounce`** into every down-facing face — and this level's ground bounce is deliberately canopy green. The reflector under a cloud 640 m up and 1.3 km out is twenty kilometres of open ocean at 0.06 albedo, not the canopy. Replaced with a desaturated horizon tint at weight 0.13. | `atoll.png` |
| **4** | **The Cauldron read as a flat-topped mesa** | Rebuilt silhouette: the rim now varies in height around the crater so the skyline is not a level line, and the flanks carry rills deep enough to survive at 900 m. | `strand.png` — it now reads as a volcanic plug from sea level, steep-sided with a serrated summit |
| **5** | **The lagoon floor was camouflage** | Coral heads are now sparse, clustered, sized and three-dimensional, each with its own pale sand halo, instead of evenly-distributed single-scale blotches. | `atoll.png` |
| **6** | **A blank flat plane in the arrival frame** | Pad flatness was re-tuned and a concentric ground-relief term (`groundReliefExtend`, three incommensurate wobbles on one heading) added to the terrain material. **The pad-flatness gate now passes at p95 0.26 m against a 0.35 m budget** (worst was the Weeping Steps at 90.48 m — see below). | audit |

**Unplanned bonus:** the clouds now cast real moving shadows on the lagoon,
which is one of the defining images of an atoll under scattered cumulus.

### Still open

| # | defect | state |
|---|---|---|
| **2** | **The ocean is still corduroy** | The water agent was killed. `atoll-water.js` grew 2409 → 3018 lines and **the frame did not change**, so its work is inert, half-wired, or aimed elsewhere. Re-dispatched in round 3a. |
| **3** | **Still no foam anywhere and no reef break** | as above |
| **7** | **Still no sun glitter path** | as above |
| **—** | **The level has no dressing at all** | `atoll-world.js` is still the placeholder. `atoll-flora.js` (3070 lines, 13 species) and `atoll-structures.js` (2572 lines) are both **built and unplaced** — nothing calls them. Re-dispatched in round 3a. |

### Two calls made by hand, from the audit rather than from a frame

**The Weeping Steps now has no pad at all.** `padA: 0`, which skips it in
`padsAt` exactly as the Hold's does. Its 96 × 62 m levelled ellipse failed its
own gate by two orders of magnitude — **p95 90.48 m against 0.35, rim grade 625 %
against 8 %** — and the cause is geometric rather than a tuning miss: a level
disc of half-width C cut into ground at grade G has a rim grade tending to 1.5 · G
*however wide the feather*, and that flank runs 1.36. Two things made it worse:
the natural terrace there is only ~30 m wide radially, so a 62 m half-width was
reaching 90 m of mountain uphill and 80 m of air downhill; and the pad's local
frame is built from the station's radius vector about the **world origin** while
that terrace's contour runs about the **Cauldron**, which here are 40° apart — so
the ellipse's major axis was pointing across the contour instead of along it. The
mountain already provides a 74 m terrace; the arena's floor is now `atoll-world`'s
job, bedded onto ground that is already the right shape.

**`WADE_MAX` 1.30 → 1.45, and it did not do what it was raised for.** At 1.30 the
reachability gate lost the Drive Cathedral, the Weeping Steps and the Hold to
single shelves at 1.32, 1.35 and 1.36 m — three stations to six centimetres,
which looked like a number that wanted rounding up. At 1.45 the same three block
at 1.47, 1.49 and 1.53. **The blocking depth tracked the cap**, because the
lagoon's edge is a broad gentle shelf and there is always another centimetre of it
past wherever the line is drawn; the companion gate says the same thing as one
number — *44 gentle shelves past the cap*, at any cap. That is the right answer by
the wrong route: two of those three stations are **meant** to need the ship. The
Hold is mid-lagoon in eight metres of water and the Drive Cathedral is half-sunk
in the pass, and finding the Spine and crossing on it is this level's first
objective. The gate should go green when the Spine is placed and publishes its
dorsal walkway, not before. 1.45 is kept on its own merits (hip depth rather than
mid-thigh) and the reason it failed is recorded in the source so nobody raises it
again.

### The acceptance gates, first full run

`scripts/saintfall-atoll-audit.mjs` — 19 gates. **12 pass, 5 fail, 2 skip.**
Failing: the reef flat is 0.1–0.2 m shallower than its band on some bearings; the
three ship-dependent stations; the gentle-shelf count; the baked seabed's
worst-case foam-line error (21.79 m at compass 190 against a 1.2 m budget — mean
1.01 m, so it is one very flat bearing where a 12.7 cm height error becomes 22 m
of horizontal position); and landscape clearance on the eye-level cameras, which
is arguably the gate not distinguishing an eye-level pose from a landscape one.

---

## Round 3 — the level is dressed

`output/saintfall/island/antiphon-r3/*.png`, 14 of 15 poses, **280 fps** at ultra.

`atoll-world.js` went from a 445-line placeholder to 3057 lines and the level has
content for the first time: **8297 flora instances across 14 species** (1294 palms,
1573 sea grape, 1026 mangroves, 772 pandani, 153 ironwoods, 60 lianas), the
Antiphon's three pieces, 748 coral heads, 1917 shingle, 471 driftwood, 147
boulders. Rays from the review cameras now land on `antiphon-spine-hull-choir`,
`flora-canopy-oct6` and `flora-seagrape-wood-l1` instead of on bare terrain, and
edge density on the arrival frame went **7.1 % → 24.5 %**.

### Closed

| # | defect | evidence |
|---|---|---|
| **2** | **The corduroy ocean.** Gone. The open sea now has irregular chop with real wave structure and the aliasing to the horizon is largely resolved. | `crest.png` beside `antiphon-r2/crest.png` |
| **7** | **No sun glitter path.** There is now a real sparkle path toward the sun. | `hold.png` |

### Opened, and one of them is the worst artefact in the level so far

| # | defect | evidence |
|---|---|---|
| **9** | **Flat tan discs floating on the open ocean.** Dozens of them, lying on the surface like pancakes, including well outside the reef in forty metres of water where there is no seabed within reach. Almost certainly coral-head sand haloes or shingle placed at a constant Y instead of bedded on the ground. | `crest.png` |
| **9b** | **The audit's own bedding gate says "0 floating of 0 meshes".** It is not seeing instanced props at all. A gate that passes while the defect is visible from the level's own camera is worse than no gate — and this is the **second** time this session an instrument has agreed with itself rather than with the world (the first was a `readRenderTargetPixels` call passing a `Float32Array` to a `HALF_FLOAT` target, which returns zeros and a warning and reads exactly like an empty render target). | audit |
| **10** | **The palms have no crowns.** Near, they are tall dark near-vertical poles carrying a few tiny green slivers, and several carry a single long bare green whip arcing across the sky — a leaf rib whose blade never generated. Far, the same species is a row of identical little umbrellas. The crown fails at both ends of the range. The foreground littoral scrub has the same disease: a bare brown twig with five flat leaves. | `arrival.png`, `crest.png` |
| **11** | **The Antiphon is an untextured black slab.** The Reliquary Hold — the level's hero space, and the thing the world is named after — reads as a stack of flat plates: shadow side pure featureless black, lit side flat pale grey, **no panel line, no rust, no verdigris, no tide line, no scale furniture, no deformation, and no brass**. It fails rubric tells 4, 11 and 12 in one frame. | `hold.png` |
| **3** | **Still no foam and no reef break.** `crest.png` is taken standing *on* the reef crest and there is not one pixel of whitewater. The shoreline meets the water as a clean line. | `crest.png` |

### Note on how these were found

Every defect above was named from an opened PNG, not from a metric. The metrics
were all green or improving at the time: 280 fps, edge density up threefold,
14 of 15 poses passing the harness's own no-image test, and the bedding gate
reporting a clean pass while the floating discs were visible in the frame the
gate's own level shipped. **The frames are the instrument of record.**

---

## Round 4 — the four defects, and three instruments that lied

All four agents returned. Every one of them **corrected the brief it was given**,
which is the round's most useful outcome.

### 9. The floating discs were not props. My diagnosis was wrong.

The brief said coral-head haloes placed at a constant Y. Three independent
measurements said otherwise: raycasts over the lower half of `crest` hit only
`atoll-sea`; forcing `float capWhite = 0.0;` into the compiled fragment shader
in-page removed **every one of them**; and blitting `capWhite` alone drew exactly
the disc field.

**The cause was topology, not placement.** The whitecap field
`capDrv * (0.45 + 1.10·fbm3) + (vnoise − 0.5)·0.85` is *smooth*, so every level
set of it is a closed convex curve — and two thresholds cut two nested ones.
Zoomed, each cap was a lozenge with a concentric grey rim around a white core: a
fried egg. **No shading, colour or placement change could have stopped that
reading as a decal, because the shape was wrong before the shading started.**
Blitting the *drive* alone showed it had been right all along — crest-aligned
streaks running to the horizon. Everything between the drive and the stencil
threw the shape away.

Fixed by adding one zero-mean `fbm3` at 9× the patch scale **into `capField`**,
not onto the stencil, so both thresholds shatter on the same tear. Coverage
measured from a near-nadir pose (a grazing camera reads 3.7 % for the identical
field and must not be used for an area figure): any cap 1.47 % → 1.27 %, bright
core 0.17 % → 0.10 %.

### 9b. The bedding gate was measuring a prototype at the origin

**54 of the 164 world meshes are `InstancedMesh`**, and the gate walked
`geometry.attributes.position` through `mesh.matrixWorld` — which measures the
prototype *once* for all copies. That is why every flora row it printed landed
within 5 m of (0,0), and why it first reported `0 floating of 0 meshes` and then
`73 floating of 162` — both garbage.

It now reads `instanceMatrix` per copy and reports
**7 floating of 11,573 copies in 163 meshes**, with every exemption bucket
counted. The seven are real, findable and named.

> This is the **third** instrument this session to agree with itself instead of
> with the world. The first was `readRenderTargetPixels` handed a `Float32Array`
> for a `HALF_FLOAT` target — returns zeros and a console *warning*, and reads
> exactly like an empty render target. The second was the same gate's earlier
> incarnation. An instrument that cannot fail visibly is worse than no instrument.

### 10. The palms — four faults, and one of them was not a palm

- **The crown was a flat disc, not a shuttlecock.** Measured off built LOD0
  geometry: crown depth **4.05 m on a 17.49 m trunk — 22 %**, highest frond tip
  only 0.83 m above the trunk top. `drop = u^1.7 · frondLen · 0.42` was
  subtracted from *every* frond including the up-pitched ones, cancelling the
  launch pitch almost exactly. 12 fronds where a coconut carries 25–30.
- **The trunk was twice life size** — 0.68 m across against a real 0.30–0.40 m.
  Fat trunk plus small crown *is* the telegraph-pole read.
- **The green whips were lianas with an inverted catenary.** `lianaCurtain`
  computes the correct curve and then subtracts `sag · (1 − c)`, which is that
  curve upside down: every liana in the level was an arch that dropped a full sag
  at its anchors and peaked in mid-air. The comment above it describes the shape
  the code does not produce.
- **Every palm was the same geometry** — one mesh for 590 stems. Yaw and scale
  cannot hide a repeated silhouette at 400 m.

**And a fifth, found while measuring:** `geometryFor` hashed `lod` into the shape
rng while its comment claimed the opposite. Seed `0x9e3` built an **11.3 m trunk
at LOD0 and 18.3 m at LOD2** — *every plant in the level changed size when the
camera crossed an LOD ring.*

### 3 and 7. The foam and the glitter were never absent

The shore foam terms **fired correctly all along** — blitting them showed a ring
on the outer reef and a collar round every bommie. `crest` had none because the
whole frame is 22–46 m of water: there is no shore in it. What was missing was
**whitecaps**, the only white water that exists in deep water.

The glitter was never absent either. Rendered alone it was at **luma 1.000 —
fully clipped white — over roughly 400 × 600 px**. The term had no structure left
because everything it produced was above the display ceiling. A monotone soft
knee that preserves every glint's order pulled it back under: clipped water
pixels **11.15 % → 6.99 %**.

Two further real bugs found there: **both foam-noise thresholds were quantile
errors** — `sfFbm2` is not uniform (measured mean 0.5041, sd 0.1597), so a
threshold documented as "leaves the top 25 % uncovered" was at +1.54σ and **93 %
of the reef flat was above it**, which is the rubric's blown-foam tell; and foam
measured **(214,200,181) sRGB — within a hue step of the level's own carbonate
sand** — because the water's irradiance is 99 % sun.

### 2. The corduroy

Diagnosed by FFT of the slope field on a 512² world grid rather than by eye. The
bandlimit was fine and the "no distance roughening" hypothesis was wrong. The
cause was **one heading**, and the file's own inherited rule. Replaced with six
trains on a directional spread at the same Cox & Munk slope budget
(σ = 0.1276 exactly):

| chop slope field | arc40 (isotropic = 0.222) | anisotropy |
|---|---|---|
| three trains, one heading | 0.629 | 5.96 |
| six-train spread | **0.394** | **2.21** |

And it is **cheaper** than the three it replaced — nine noise fetches down to six.

### Where the level stands

15 of 15 poses capture. **278 fps / 3.59 ms at ultra**, 234 draw calls,
6.4 M triangles. The water is ~23 % of frame GPU time at the crest pose where it
is ~55 % of the frame.

---

## Round 5 — the first blind round. **We lost 0 – 15.**

`scripts/saintfall-atoll-round.sh 5 trade ultra`. Fifteen pairs, each one frame
of the atoll against one frame of Vesper-IX. Sides randomised independently per
pair, the answer key moved out of the folder before any judge saw it.

**Two identify judges, then three prefer judges, all five independent, no shared
context.**

### The identify round: inapplicable, and worth saying why

Both judges scored **strong** confidence and separated every pair instantly.
Their tells, unprompted and nearly identical:

> "The two levels are separated instantly and without ambiguity by sky and
> palette — the island level always has a blue daylight sky with chunky white
> stacked-block cumulus, teal/blue water and green foliage, while the other has
> an orange-sunset gradient sky with flat pink/mauve lozenge clouds over
> red-orange dune sand; **every one of the fifteen pairs was decided on that
> single glance**."

That is not a leak that can be closed. A desert and an ocean cannot be made
indistinguishable, and pretending otherwise would mean making one of them look
like the other. **The identify gate does not transfer to a cross-biome
comparison** and is recorded here as inapplicable rather than as a failure. The
consequence is that the preference round runs *knowing* which side is which, so
novelty and subject bias are live — which is exactly why all three prefer judges
were explicitly forbidden from crediting either.

### The preference round: 0 / 15

**All three judges returned the identical fifteen-letter answer string.** Every
pick went to Vesper. Not one pair was close. A tie is a loss; this was not a tie.

The recurring phrases, across forty-five independent pair judgements:

> *milky · blackless · one flat mid-level · no darks at all · collapses to pure
> black with zero sky bounce · reads as a hole cut in the sky · one
> undifferentiated dark green paste · flat green stamps with no contact ·
> differs only in level, never in colour*

### The three judges' closing verdicts, written independently

1. > "Give the island level a committed directional key with hue separation —
   > warm light, cool sky-bounce shade, real blacks in the occluded areas —
   > because **right now every surface in it differs only in level, never in
   > colour**, and that is what makes it read as cheap."

2. > "Put the island level on a real directional key — a low sun with foliage and
   > terrain casting shadows and a **hue-shifted ambient in the shade** — so its
   > trees, landforms and water get form instead of flat albedo under a white
   > sky."

3. > "The island level **has no shadow-side colour** and no highlight discipline
   > — give it a cool sky-ambient fill so shaded canopy, trunks and hulls
   > separate in hue instead of collapsing to black, and **pull the clouds and
   > horizon band down in luminance so the brightest thing in frame is the
   > subject rather than the sky**."

Three judges, one diagnosis. That is a measurement, not an opinion.

### What they did NOT say

They did not say the geometry was bad, the water was bad, the palms were bad or
the composition was bad. Several notes praised the water's depth read and the
cloud shadows' existence. **They said the light is wrong.** Every finding below
is that one problem wearing a different hat.

### The number behind "milky"

| | luma | sd |
|---|---|---|
| Vesper-IX, 18 frames | 72 – 130 | 40 – 64 |
| The atoll, 15 frames | **121 – 163** | 33 – 65 |

**Thirty to sixty per cent brighter with less contrast.** That is the whole
complaint as two columns.

### Defects opened

| # | defect | named by |
|---|---|---|
| **12** | **No hue-shifted ambient in shade.** Shaded surfaces collapse toward black or toward flat mid-level instead of separating in hue. The Cauldron's shaded flank "reads as a black hole punched in a blue sky — silhouette, scale and surface all lost in one go". Prime suspect: `ATOLL_GRADES.trade`'s `shade: [0.38, 0.16]`, whose knee was set against an **assumed** median linear luma of 0.19 written into the file's own comment, while the level actually measures far above that. A shade knee below the true median fires *nowhere*. | all three |
| **13** | **The sky out-competes the subject.** In at least one pair the cumulus are the brightest thing in frame. `uHaloAmount` is **0.34** against Vesper's 0.06 and Kenosis's 0.02. | judge 3 |
| **14** | **Shadows on water are opaque black polygons with straight corners.** The wreck's cast shadow and the cloud shadows both. "It does not tint, refract or soften with depth, so the ship reads as pasted onto the ocean." A shadow on water should be an *absorption tint into the water's own colour* — and should mostly remove the specular, which is what actually reads. | judges 1 and 2 |
| **15** | **The near field has the least information in the frame.** The ground relief is concentric about the world origin, and concentric rings seen from inside at a grazing angle *are* long radial streaks. "The closest ten metres — the part the player stares at — has the least information in the shot." | judge 1 |
| **16** | **The cumulus are flat hex slabs with one dark bottom facet and a hard silhouette**, and the stamp repeats. | judge 3 |
| **17** | **A hard straight tonal seam** across the mangrove ground between two flat greens, and "small black cones that read as placeholder markers" — pneumatophores that were never dressed. | judge 3 |
| **18** | **The hull's plank striping aliases into moiré** at mid-distance. | judge 2 |

### Changed in response

Round 6 dispatched against these, four agents, all of them aimed at the light.
Re-tested by a fresh blind round with a new seed.

---

## Round 6 — shade-and-fill (defects 12 and 13)

Agent scope: the five `ATOLL_TIMES` rows, the five `ATOLL_GRADES`, and
`applyAtollPostChain` in `atoll-main.js`. No geometry.

### The three prime suspects, and which of them were real

**All three were real, and a fourth one was bigger than any of them.**

#### 1. The shade knee — CONFIRMED, and it was never firing

`ATOLL_GRADES.trade` ran `shade: [0.38, 0.16]`. The knee was placed "just under"
a median linear luma of **0.19** that the file's own comment states as *measured
intent* — what the author expected the built level to render at. Nobody went back
and measured the level.

Decoded from the fifteen r5 PNGs (sRGB → linear, per-frame median, then the
median of those):

| | predicted | measured |
|---|---|---|
| trade-hour median linear luma | 0.19 | **0.335** (per frame 0.036 – 0.409) |

The knee sat below the **25th percentile** of most frames. The file's own rule
says a knee below the median fires nowhere; it was below the lower quartile.

Not an inference — `saintfall-atoll-probe.mjs --pose cauldron --time trade`
zeroes each composite term in turn and re-renders:

```
live frame          min 17   mean 159   max 229
uShade.x forced 0   min 17   mean 159   max 229     ← identical
uToe forced 1.0     min 17   mean 160   max 229     ← the toe too
```

The one term whose entire job is to give shade a colour of its own, and the one
term whose entire job is to give the frame a dark end, were **both measurably
inert**. Three judges independently reported the level "has no shadow-side
colour". Same fact.

The toe was inert for an upstream reason: the GT curve's shadow exponent only has
authority below its linear midpoint of 0.22, and the exposure was holding the
whole picture above it.

#### 2. The fill — CONFIRMED, and it was BOTH too weak and the wrong colour

`groundBounce` was `#6f8a63`, a canopy green, chosen on an **area** weighting.

Area is the wrong weight. A bounce is weighted by **albedo × area**, and this
row's own `sunIntensity` note puts the canopy at albedo 0.12 against a lagoon at
about 0.35 with a sheen on top. Per square metre the water returns roughly three
times what the leaves do.

And green was the one hue the fill could not afford: a green fill on a green
canopy gives a lit leaf and a shaded leaf **the same hue at two levels**, which
is judge 1's sentence verbatim.

The colour is load-bearing twice, and the second time was invisible from this
file: `art.js:1979` mixes `groundBounce` into the **upper** hemisphere of the
environment bake at 0.52 of the zenith — written for a desert, where the enormous
sunlit floor genuinely is what lights a shaded face. On this level that meant
**half the sky fill was tinted green**. The other half was `skyHorizon` /
`skyLow`, at `#cfe4f2` / `#eaf2f6` — L95, very nearly paper (`art.js:1969`
flattens the dome toward the horizon band at 0.88 before convolving).

So the light falling on every shaded surface in the level was *near-white mixed
with canopy green*. A near-white fill has no hue to give. That is the mechanism
behind "differs only in level, never in colour", and it is also why lifting the
fill strength alone would not have fixed it.

#### 3. The lift and the toe — the lift was innocent

`lift` decodes to rgb(5,7,13) and is already *lower* and cooler than Vesper's.
The frames had no black for two other reasons.

#### 4. THE LENS HALO WAS HOLDING THE BLACK FLOOR UP, and its comment described a term the shader does not contain

`uHaloAmount = 0.34`, justified in `atoll-main.js` as "a warm bloom flare around
the sun … the sun is over water and that is the level's signature image".

`render.js:1122` is:

```glsl
c += uHaloTint * pow(length(vUv - 0.5) * 1.42, 2.2) * uHaloAmount;
```

Radial from the **centre of the frame**, with no knowledge of where the sun is.
It cannot draw a flare over water, or anywhere else, at any value. 0.34 was tuned
by eye against a belief about the code.

What it actually did: `uHaloTint` resolves to (0.140, 0.101, 0.062) linear, so at
the frame corner it adds a **warm pedestal of +0.048 linear red — sRGB code 61**,
before a 0.12 vignette takes 12% back. The bottom corners of every frame on this
level are near lagoon and foreground sand, which is where the darkest, most
saturated pixels are supposed to live. The probe's sweep isolates it:

```
live frame          min 17
uHaloAmount → 0     min  6
```

**Three times off black, for a 3-code change in the mean.** Vesper runs 0.06 and
Kenosis 0.02, and both have real black.

### What changed

`assets/js/saintfall/atoll-main.js`

| | before | after |
|---|---|---|
| `uHaloAmount` | 0.34 | **0.05** |

`assets/js/saintfall/atoll-art.js` — `ATOLL_TIMES.goldenhour`

| | before | after |
|---|---|---|
| `sunColor` | `#ffeed6` | **`#ffe2b4`** — a committed warm key, affordable now the fill is cool |
| `sunIntensity` | 5.05 | **5.35** — compensating the warmer white's lower luma |
| `skyHorizon` / `skyLow` | `#cfe4f2` / `#eaf2f6` (L95) | **`#9dc7e0` / `#b9d6e4`** (L78) |
| `groundBounce` | `#6f8a63` canopy green | **`#4a848c` lagoon cyan** |
| `envIntensity` | 0.44 | **0.52** |
| `exposure` | 0.96 | **0.84** |

`assets/js/saintfall/atoll-art.js` — `ATOLL_GRADES.trade`

| | before | after |
|---|---|---|
| `shade` | `[0.38, 0.16]` | **`[0.52, 0.19]`** — knee against the *measured* post-regrade median of 0.195 |
| `shadeHue` | `#3f6f9e` | **`#3a76a8`** |
| `gamma` | `[1.0, 1.005, 1.02]` | **`[1.14, 1.12, 1.09]`** — order inverted so the midtone darkens cool |
| `saturation` | 0.97 | **1.02** |
| `shadowTint` | `#2f5a72` | **`#3c5560`** — nearly neutral, Vesper-style |
| `highlightTint` | `#ffedcf` | **`#ffe4bc`** |
| `tint` | 0.18 | **0.20** |
| `ao` | `[0.55, 0.42]` | **`[0.70, 0.42]`** — sky tint on the occlusion residual |
| `toe` | 1.46 | 1.46 — unchanged, and now it fires |

### Two wrong turns, recorded because the numbers alibi each other

**A first pass took exposure to 0.78, `tint` to 0.28 and `gamma` to
`[1.22, 1.17, 1.09]`, and the whole set rendered as moonlight.** Every headline
number was inside Vesper's band and the pictures were worse. Three separate
causes, all of the same shape — *a term keyed on luma, on a frame whose luma had
just moved*:

- **The split tone's crossover is hardcoded.** `smoothstep(0.02, 0.62)` in
  `render.js:1070`. Once the median came down to 0.195, **four fifths of every
  frame sat on the shadow side of it**. A split tone that reaches four fifths of
  the picture is a colour filter. Vesper runs a nearly achromatic `#3a3630`
  shadow tint for exactly this reason and lets the *shade term* carry the hue.
- **Gamma cannot aim.** It cannot tell a dark pixel from a lit one, only a mid
  one from a bright one — and on this level the midrange is the lit sand and the
  lit canopy, not the shade. A 0.13 channel spread cooled the subject.
- **The fill lights everything, not only the shade.** The environment is applied
  by normal, not by whether the sun reaches the fragment. At `envIntensity` 0.58
  with a fully saturated `#3f8f96`, sunlit sand went blue-grey. *The moment a
  fill is strong enough to be seen on a lit surface it has stopped being a fill
  and started being a second key of the wrong colour.*

**The lesson generalises: when you move a frame's exposure you have moved the
input to every luma-keyed term in the grade, and each of them needs re-placing
against the new median rather than the old one.** That is the same failure that
put the shade knee at 0.16 in the first place, run forwards instead of backwards.

**And min/mean/max cannot see the shade term.** It is a hue rotation normalised
by its own luma — by design it does not change level. The probe's sweep still
shows `shade` identical to the live frame after the fix, and that is correct
behaviour, not a null result. It has to be measured as chroma in the dark band.

### The result

Fifteen trade-hour frames, ultra, 1600×900. `output/saintfall/island/antiphon-r5`
against `output/saintfall/island/check-shade-c`. sRGB unless marked.

| | mean luma | sd | 1st pct | 95th pct | median **linear** |
|---|---|---|---|---|---|
| Vesper-IX, 18 frames | 47 – 130 | 34 – 67 | 7 – 34 | 118 – 213 | 0.020 – 0.309 |
| atoll, **before** | 72 – 163 | 34 – 65 | **7 – 70** | **177 – 249** | 0.036 – 0.409 |
| atoll, **after** | **47 – 123** | **29 – 63** | **7 – 29** | **145 – 221** | 0.011 – 0.242 |

Per frame, mean luma before → after: arrival 136→104, atoll 163→118,
bone-reef 158→119, cauldron 161→123, crest 148→108, drive 152→114, hold 138→100,
lagoon 153→108, nave 137→112, prow 72→47, rim 158→123, roost 146→107,
spine 160→118, strand 122→89, weeping 98→77.

**Every one of the fifteen is now inside Vesper's band on mean, on the 1st
percentile and on the 95th.** The only frame outside Vesper's *sd* band is
`cauldron` at 28.5 against Vesper's floor of 33.7, and that pose is nine tenths
sky and open water.

#### The hue number, which is the one that mattered

Comparing the darkest quartile of each frame against the brightest, in OKLab:

| | chroma, dark quartile | chroma, bright quartile | lit surfaces more colourful than shaded? |
|---|---|---|---|
| Vesper-IX | 0.010 – 0.086 | 0.032 – 0.089 | 12 of 18 |
| atoll, before | 0.010 – 0.061 | 0.008 – 0.086 | **4 of 15** |
| atoll, after | 0.010 – 0.067 | 0.033 – 0.088 | **14 of 15** |

Before the regrade the atoll's **shaded** surfaces were more chromatic than its
**lit** ones in eleven of fifteen frames — the lit half of the picture was the
grey half. That is "differs only in level, never in colour" from the other
direction, and it is not something the luma table can show.

#### The water, which the panel did not complain about

`lagoon` pose, mean chroma of the lit quartile: **0.022 → 0.071**. Darker water
is more turquoise, not less — the tonemap desaturates what it compresses, so
taking the lagoon off the shoulder of the curve gave the colour back. The noon
frames make the same point more loudly.

### The noon hour had the identical defect and nobody had looked

The blind set was trade-hour only. Captured at noon after the trade regrade
landed: mean 155 and 172, median linear **0.50 and 0.46**, 95th percentile 218
and 225, dark quartile more chromatic than the bright one. `blaze`'s shade knee
was **0.26 against a true median of ~0.48** — the same fault, roughly the same
factor. Corrected by the same method: mean 125–131, median linear 0.22–0.27, 95th
percentile 171–207, 1st percentile 10–18.

`dusk` measured healthy and was left alone (mean 74–129, lit-quartile chroma
0.09–0.12, hue separation 21–76°). `night` and `storm` are untested — see below.

### Still open, and not caused by this work

- **`--time night` captures zero frames.** `saintfall-shots.mjs` exits 1 with a
  `padError` in the authored-pose loop and writes a report with `shots: []`.
  Verified as pre-existing by re-running it with the other agents' in-flight
  edits stashed; it fails identically. The `phosphor` and `squall` rows are
  therefore unmeasured and their knees are still predictions.
- The `cauldron` pose's sd sits below Vesper's floor.
- Defects 14–18 belong to other agents in this round.
- `saintfall-atoll-audit.mjs --quality high --time trade`: 5 gates fail, all of
  them geometry or traversal (reef crest band, wade cap, beauty-shot clearance,
  prop bedding). All three health gates — page errors, NaN in a composite
  uniform, NaN in the atmosphere or water uniforms — pass.

---

## Round 6 — the light. Every number moved. **The verdict did not.**

Four agents, all aimed at round 5's single diagnosis. The numbers, over all
fifteen frames:

| | mean luma | sd | 1st pct | 95th pct | median linear |
|---|---|---|---|---|---|
| before | 72–163 | 34–65 | 7–70 | 177–249 | 0.036–0.409 |
| **after** | **47–123** | 29–63 | **7–29** | **145–221** | 0.011–0.242 |
| Vesper-IX | 47–130 | 34–67 | 7–34 | 118–213 | 0.020–0.309 |

**Inside Vesper's envelope on every column.** And the metric that actually
encodes the complaint — *is the lit quartile more chromatic than the shaded
quartile* — went from **4 of 15 to 14 of 15**, against Vesper's 12 of 18.

### What was actually wrong, and it was four things

1. **The shade knee.** The file predicted a trade median linear luma of 0.19 and
   wrote that prediction into its own comment. The frames measure **0.335**. The
   probe settled it without inference: forcing `uShade.x` to 0 returned a frame
   *identical* to the live one. The one term whose job is to give shade its
   colour had never fired. (Forcing `uToe` to 1.0 moved the mean by one code
   value — the toe was innocent, held above the GT curve's 0.22 midpoint by the
   exposure.)
2. **The fill was wrong in two ways at once.** `groundBounce` was area-weighted,
   but a bounce weights by **albedo × area**, and canopy 0.12 against lagoon 0.35
   puts it on the water's side. Worse, `buildSkyEnvironment` mixes `groundBounce`
   into the **upper** hemisphere at 0.52 of the zenith — so the light on every
   shaded surface was near-white mixed with canopy green. **A green fill on a
   green canopy is, by construction, "differs only in level, never in colour".**
3. **`uHaloAmount` was not a sun flare.** It is `c += uHaloTint · pow(r, 2.2) ·
   uHaloAmount` — **radial from frame centre, sun-independent**. At 0.34 it added
   sRGB 61 at the corners. Live 1st-percentile 17; with the halo forced to zero, 6.
   Three times off black, for a three-code change in the mean. That was the
   mechanism behind "milky". Now 0.05.
4. **The clouds out-ran every diffuse surface in the level.** A lit shoulder
   measured 0.883 linear — comfortably *under* the 1.62 bloom threshold, which is
   why four rounds of gates never caught it. Capped in linear on all three
   channels so it changes level and not hue.

### And a fifth, which explains the "same cloud everywhere" note

`buildCell`'s lobe spiral was **deterministic in k**: `radial = (k·0.618 + 0.37) %
1`, `ang = k·GOLDEN`. Every cell in the sky had the same lobe layout in the same
order — *any two cells with the same lobe count were the same cloud at a different
scale.* Plus every lobe started its polygon at angle 0 with ±8° of jitter, so
~1,100 lobes shared one azimuthal phase and one plan-ellipse axis.

### One wrong turn, recorded because the shape of it recurs

A first pass hit every headline number and **rendered as moonlight**. Three
causes of one shape, and all three are the same mistake: *a luma-keyed term left
standing after the luma moved.* The split tone's crossover is hardcoded at 0.62,
so four fifths of a regraded frame fell on the shadow side; gamma cannot tell a
dark pixel from a lit one, only a mid one from a bright one; and the fill lights
everything, not only the shade.

Also worth keeping: **`min/mean/max` cannot see the shade term at all.** It is a
luma-normalised hue rotation, so its sweep reads identical before and after the
fix. It has to be measured as **chroma in the dark band**, and nothing else works.

---

## Round 7 — the second blind round. **0 / 14 and 1 / 14.**

Same rig, new seed, three fresh judges, no shared context. Two returned the
identical answer string; the third differed on one pair.

**We lost again. And not one judge repeated round 5's complaint.**

That is the result. The light is no longer what they see. What they see now:

| # | defect | who |
|---|---|---|
| **19** | **The rock is blurred vertex paint.** *"Cliffs and volcano flanks: no strata, no facet break, no micro-detail, occupying 30 % of frame at the focal point. It is the single tell that most says unfinished."* Named by **all three judges in four separate pairs**. The asked-for fix is a slope-and-height-masked **triplanar** rock material. | all three |
| **20** | **The beach is a tiling comb.** *"A fixed-period diagonal shadow comb tiles visibly from the camera to the horizon; it is the first thing the eye finds and it reads as a broken texture, not as terrain."* **Round 6 introduced this** — it is the corduroy defect again, moved from the ocean to the sand, and it has the same cause: a field whose spectrum lies on one axis. | two of three |
| **21** | **The key is overhead.** *"Lights everything from overhead at one level ... which is why its landforms, canopy and props all flatten into the same putty regardless of how good the water shader is. Drop the key light to a low angle."* We run 26°. Vesper runs 13.5 and beat us fourteen times out of fourteen. | judge 1 |
| **22** | **The ship is still unlit dark boxes.** *"A black slab sitting on the sea with no waterline, no wake and no contact."* **Third round running.** What beat it, from the same judge: *"the only convincing metal in the set — ribbed specular, patina, warm highlight against cool shade."* | two of three |
| **23** | **Debris casts no shadow.** *"Flat white debris quads scattered on it that cast nothing."* Rubric tell 10. | two of three |
| **24** | **Repeated stamps.** *"The same tree stamped hundreds of times at one value."* | judge 1 |
| **25** | **Frames with no subject.** *"A good water shader in an empty frame"; "a bisected horizon with no subject"; "no subject beyond survey."* This is rubric tell 13 and it is a **camera** defect, not a rendering one — several of the fifteen cameras were authored before the level had any content in it. | all three |

### What they praised

*"B has the best water in the set."* The depth read and the glitter path were
cited approvingly in three separate pairs. **The water is no longer the problem**
and must not be traded away.

### Reading the two rounds together

Round 5's complaint was global and about light. Round 7's is local and about
surface, and it names four different subsystems. That is the shape of a level
getting closer rather than a level standing still — but it is still 0 / 14, and
a tie is a loss, so it counts as a loss.

### Changed in response

Round 8 dispatched: triplanar rock, the key angle, the ground comb, the ship's
materials. The camera set (defect 25) is held back for round 9 to avoid two
agents editing `atoll-world.js` at once.

### Round 7, per frame — what a judge said about each of ours

Recovered by joining the judges' pair notes to `output/saintfall/island/keys/r7.json`.
This is the most useful artefact of the round: every one of our fourteen frames
has a named defect, in a judge's words, with the Vesper frame it lost to.

| our frame | lost to | what the judge said about ours |
|---|---|---|
| `cauldron` | saint-hand | *"sits entirely in one pale mid-band with a **vertex-smeared cone** for a subject and a sea that is a flat lerp"* |
| `bone-reef` | censer | *"whole lower half is a **repeating diagonal shadow comb** with litter cards floating shadowless on top of it"* |
| `weeping` | ossuary | *"a shadow-side landmass with **zero sky fill** — half the frame is near-zero black with no hue in it and unlit foliage sprites floating in the void"* |
| `crest` | choir | *"a good water shader in an **empty frame**, with grey putty clouds that have no light side and a hard top crop"* |
| `drive` | cathedral-front | *"the **submerged rock reads as a hard-rimmed decal** punched through the lagoon and its canopy is one stamped dark-green wall"* |
| `atoll` | vista-east | *"the **hero landform — the exact thing the eye lands on — is airbrushed vertex paint** with no rock structure, and the entire distance collapses into one dead grey band"* |
| `arrival` | fosse | *"the **palm cast shadow is a hard-edged blob unrelated to the trunk** and the headland is smear"* |
| `rim` | road | *"parks a **featureless blurred cliff** across the left third and blows the right-hand glitter into a flat white wash"* |
| `spine` | cathedral-nave | *"uniformly mid-value, its subject a stack of **unlit dark boxes**, with **the brightest thing in frame an incidental sand strip**"* |
| `hold` | establishing | *"the barge is a **value-2 slab with no facet response** sitting on a blobby colour decal in the water"* |
| `roost` | ossuary-inside | *"**the same tree stamped hundreds of times** at one value with unlit black shelter planes and a dead upper half"* |
| `strand` | saint-face | *"**has the best water in the set** but ruins it with a straight hedge of identical canopy stamps and a smeared, structureless mountain behind it"* |
| `nave` | vista-north | *"the entire near field is a **visibly tiling diagonal shadow comb** and its trees are flat black cutouts with no lit side"* |
| `lagoon` | saint-scale | *"the clouds are an unlit grey lump wall over **a small grey box of a subject**"* |

**Counted by cause:** the rock surface 4, the ground comb 3, the ship 2, canopy
stamping 3, no subject or a subject too small 2, no fill 1, the submerged-rock
decal 1, the palm's cast shadow 1.

**Three frames need a camera decision rather than a shader.** `crest` looks out
to open ocean and has nothing in it; `lagoon` frames its subject so far away it
reads as "a small grey box"; and `spine` puts the brightest thing in the frame on
an incidental sand strip rather than on the ship. All three were authored before
the level had any content in it, which is rubric tell 13 exactly. Held for round
9 so two agents do not edit `atoll-world.js` at once.

---

## Round 8 (in progress) — defect 20, the ground comb, and defect 23, the debris

One agent, two defects, both on the beach. Round 8's other work — the rock
surface, the key angle, the ship's materials — is recorded by its own agents.

### Defect 20 — THE GROUND COMB. Closed on the measurement, open until round 9 names it or does not.

**The cause, and it is the ocean's round-1 cause exactly.** `atoll-art.js`'s
three ripple trains all had the phase `r * k`. Every wave vector on the level
therefore pointed along the radial, and the entire slope spectrum sat on one
axis. Round 6 answered the streak with a meander, per-train amplitude envelopes
and an isotropic grain, and the streak became a *comb* rather than going away,
because — as `atoll-water.js`'s corduroy block states and this now confirms on
a second surface — **phase and amplitude modulation cannot move energy off a
heading.** Modulating a plane wave broadens its spectral line; it does not
rotate it.

And at the radius the frames are shot at, concentric *is* a plane wave: the
`bone-reef` camera stands at r = 1041 m, where a 64 m patch of a concentric
field is bent by 64/1041 = **3.5 degrees**. The ring's own curvature buys no
directional spread at all. "The crests are shore-parallel so they run across the
view" was never true of the four authored cameras that look *along* the shore,
and `bone-reef`, `nave` and `strand` are three of them.

**Measured** with the instrument round 2 built for the water, pointed at the
ground: `scripts/saintfall-atoll-groundcomb.py`, which reads the shipped ladder
out of `atoll-art.js` at run time and FFTs the slope field over **36 patches** —
three radii (420 m lagoon flat, 900 m ring beach, 1041 m reef flat) by twelve
bearings, so no single lucky heading can carry the number.

| | arc40 mean | arc40 worst | aniso mean | slope sd |
|---|---|---|---|---|
| round 7, three concentric trains | **0.981** | 0.991 | **11.34** | 0.0323 |
| round 8, six trains on a spread | **0.437** | 0.528 | **2.68** | 0.0324 |
| at the 6 m near gate, r7 → r8 | 0.992 → **0.498** | 0.997 → 0.561 | 11.44 → **3.28** | 0.0645 → 0.0646 |
| the water, before its own fix | 0.629 | – | 5.96 | – |
| the water, after its own fix | 0.394 | – | 2.21 | – |
| perfectly isotropic | 0.222 | 0.222 | 1.00 | – |

The ground was **worse than the water ever was** — 0.98 against 0.63 — because
the water at least had a swell on a second heading under its chop.

**The fix is the water's fix, and the slope budget is unchanged.** Six trains
(19.4, 11.9, 6.10, 2.77, 1.31, 0.58 m) on a directional spread about the trade,
deviations +21 −24 +37 −46 +64 −71 degrees, all fifteen pairwise gaps distinct,
widest pair 135 and not 180 (two trains dead against each other make a standing
wave, which is a checkerboard). `GREL_BUDGET` was solved so the field's measured
slope sigma equals the three-train field's **to four places** at every gate:
this round changed the field's *geometry* and nothing else, which is what makes
the numbers above comparable at all.

Three things are worth carrying forward:

1. **Rotating the radial is not a rotation.** The obvious construction —
   `h = rd·cos a + tg·sin a`, then `dot(p, h)` — collapses to `r·cos(a)`,
   because `dot(p, tg)` is identically zero. The "rotated" train is the same
   concentric train at a longer wavelength. The headings have to be in **world**
   space, which makes the trains aeolian, which is also the honest reading: a
   wind ripple runs across the wind on every bearing of a ring.
2. **Half the fix is the crest frame.** Six headings alone give arc40 0.638 and
   aniso 7.4 — six sharp spectral lines. A crest-frame envelope and a
   crest-frame phase jitter at a 2.2-wavelength crest length broaden each line
   into a ~24-degree lobe, the lobes overlap, and the number goes to 0.437 /
   2.68. Six taps, paid for by deleting the 4.3 m meander tap.
3. **The heading set was searched, not tasted.** Copying the water's ladder
   verbatim scores 0.506 far and 0.599 *near*, because the two trains the near
   gate boosts land 31 degrees apart and the boost then piles the near-field
   power into one lobe. Scoring the far and near weightings together and keeping
   the worse of the two is what produced the shipped set.

**Frames opened:** `antiphon-r7/{strand,arrival,bone-reef,nave}.png` against
`check-comb1`, `check-comb2`, `check-comb5` at ultra/trade, plus 3× and 6× crops
of the `bone-reef` plate field. The ruling is gone from the beach in every one.

### Defect 23 — THE DEBRIS CASTS NOTHING. It was not a flag, and it was not the bias.

Three things were ruled out by measurement before anything was changed:

- **`castShadow` is true on every ground bin** (`kit.makeBins` sets
  `castShadow = opts.castShadow !== false`; only the mangrove collar opts out).
- **The props do enter the shadow pass.** Rendering `arrival` with those bins'
  `castShadow` forced false and diffing against the shipped frame changes
  **4.9 %** of the pixels. They cast. Each piece casts a handful of pixels.
- **It is not the shadow map's resolution.** At ultra the map is 8192 over a
  340 m radius: **0.083 m per texel**, which resolves a 40 cm stone across five
  texels.

**It is the height of the prop against the normal bias, and the arithmetic
closes:**

| | |
|---|---|
| plate thickness | 0.016 – 0.186 m |
| proud of the sand | 0.72 t → 0.011 – 0.134 m |
| its shadow at the trade sun (26°) | height / tan 26 = 0.023 – 0.28 m |
| `normalBias` at ultra | 1.45 texels × 0.083 = **0.120 m** |
| which displaces the receiver's lookup ALONG the light by | 0.120 / tan 26 = **0.246 m** |

**The displacement is longer than the whole shadow, for every plate in the
bin.** That is Kenosis's recorded trap on a third world: `normalBias` is in
TEXELS, and a bias cut against a 452 m mountain erases every small prop's
contact. Setting it to zero was tried and rejected — it moves the palms' own
shadows by a quarter of a metre, brings acne back on the flat, and is the same
number that stops a 4.5° vespers sun making the whole beach crawl.

**Two fixes, both in the scatter rather than in the light:**

1. **A third of the plates are propped to 35°** instead of all of them to 24°.
   The high corner of a 0.4 m plate then stands 0.23 m up and its shadow runs
   0.47 m — twice the displacement, and it reads. The low corner goes the same
   distance into the sand, which is what a slab caught on its neighbour does.
   A third and not all, because propping all of them is a field of fins.
2. **A damp patch under every plate wider than 0.26 m** — the device this file
   already invented for the mangrove pneumatophores, one size down: a disc of
   `sand` at a low `WETSAND_RAMP` t, sized `b.relief + 18 mm` tall so it clears
   the ripple it lies in, `castShadow` off. It does not depend on the shadow map
   resolving a 4 cm plate, and it is what is physically there — sand under a
   slab drains last. **On `sand` and not on `sandWet`**: `sandWet` is roughness
   0.42 with a rim of 0.95, and a disc of it came back **sky blue**, which is
   the same defect wearing a different colour.

**Cost:** ground layer 1 506 798 → 1 697 682 triangles (+12.7 %), draws 46 → 47,
ultra fps 138.7 → 166.1 across runs — no measurable cost. Every audit gate
returns the **identical** detail string to `gates-r7.json`, including
"every prop is bedded" at 6 floating of 12 064 copies (r7: 6 of 12 063), so the
propping added no floaters.

### One thing found on the way that belongs to somebody else

**The Drowned Nave and the Bone Reef's flat are flooded, and they were not in
round 7.** Reproduced with `atoll-art.js` reverted to the exact r7 file on the
current tree — `output/saintfall/island/check-r7repro/nave.png` — so it is not
this round's work. The camera, the terrain and the probe hit are identical to
r7 (`terrain-7-4-l0`, point `823.08, −0.34, 48.05`); what changed is that a pale
rippled water sheet now covers the mud flat, and the comb still visible in
`nave` is **the water's**, not the ground's. The only file modified between the
r7 capture and the first frame that shows it is `atoll-main.js`. Whoever owns
the water or the tide should take this: it makes `nave` and `bone-reef`
unusable as ground-surface references until it is fixed.

---

## Round 8 — the surface, the light's direction, and three cameras

Split into waves after a usage limit killed all four agents of the first attempt
mid-flight. **Their on-disk edits survived; only the reports were lost** — the
fourth time this session, and the reason every brief now says *write early and
often*.

### 8a: the rock. Defect 19 closed.

All three round-7 judges named it in four separate pairs as *"the single tell
that most says unfinished."*

The fix is the project's own **boss-surface triplanar kit brought up two orders
of magnitude in scale** — read and reused rather than reinvented. One `sin` and
one `cos` of a vec3 give six octaves (52, 17.3, 5.8, 1.92, 0.64, 0.213 m) through
the triple-angle identities; analytic gradients and Mikkelsen surface-gradient
normals mean no tangent frame, no UVs and no finite differences. **Octave N's
footprint is exactly 3ᴺ times the base**, so six fade terms come off one
derivative and every octave switches *itself* off when it goes sub-pixel — which
is the whole answer to "must survive at 900 m *and* at 4 m".

What is new because a cliff is not a boss:

- **The field is anisotropic in world Y** (horizontal axes at 0.32 of the
  vertical rate). The cells become lens-shaped and their level sets lie down
  flat — *that is the strata*, at all six octaves, for one multiply. And it
  answers "a different substance on the flat tops" for free: **the crater floor
  and the walls are one field looked at from two directions.**
- **The facet break is one minus sign.** The joint octave's height is
  `-abs(joint)`, so its gradient is `sign()·∇` — *discontinuous* across the zero
  set. Two planar faces meeting at a hard edge every 5.8 m, which a smooth field
  cannot produce however much amplitude it is given.
- **Strata is albedo first**, because at 900 m every normal term is sub-pixel and
  only albedo survives.
- **Luma-matched hue substitution**: both lithologies are scaled to the incoming
  vertex colour's luminance before mixing, so the block changes *hue* and cannot
  disturb round 6's histogram.

Measured with `scripts/saintfall-rock-metric.mjs` on crops that are entirely rock:

| crop | hf3 | hf9 | iso |
|---|---|---|---|
| atoll (900 m) | 5.57 → **14.92** | 16.35 → **30.18** | 1.079 → **1.585** |
| cauldron (430 m) | 6.94 → **12.77** | 17.11 → **24.95** | 1.121 → **1.601** |
| Vesper-IX, 4 crops | 7.03–18.94 | 14.88–38.97 | 1.19–2.84 |

Both offending frames were **half Vesper at the block scale and a third at the
facet scale**. Both are now inside Vesper's band, and `iso` — the vertical /
horizontal gradient ratio, which is where strata put their energy — went from
1.08 to 1.59.

**Cost ≤ 0.45 ms worst case, inconsistent in sign, inside the ±0.7 ms
run-to-run spread.** Zero texture fetches, zero extra draw calls. The shots
harness's own `frameMs` returned 3.65, 5.51 and 9.86 ms on three runs of the
*same* build, so it could not settle this; a GPU-drained throughput harness
(batches of 60 renders, one `readPixels` per batch) was written because a
per-frame `readPixels` serialises and reported the rock-OFF build as *slower*.

Three wrong turns, all left in the source: **roof tiles** (one amplitude, no
envelope, hf3 26.1 against Vesper's 12.5–18.9); **laminated plywood** (one warp
bends a bed across the whole mountain and does nothing inside one view);
and **a blank bed at 4 m** (the clinker floor multiplied out to 0.066).

### The three cameras — defect 25 closed by hand

Three of the fourteen frames needed a decision rather than a shader. All three
were authored before the level had any content in it, which is rubric tell 13.

- **`lagoon`** — *"an unlit grey lump wall over a small grey box of a subject."*
  Its own comment had called it *"deliberately almost empty"*. Deliberate
  emptiness is a composition when something in the frame earns it; sixty per cent
  was featureless water and the ship was eleven pixels tall. Moved to (230, 210),
  where the view axis meets the Spine's at about 48° so a 469 m object reads as
  long rather than as a wall or a dot, at 305 m. Still on the water at 2.2 m, so
  the depth gradient the water is judged on is still the near field.
- **`spine`** — *"the brightest thing in frame an incidental sand strip."* The old
  camera sat at 4.2 m and put a lit sand bar across the middle distance at the
  same height as the hull. Raised to 6 m and aimed further down the hull so the
  ship's 53 m crown carries the skyline, with the Drive Cathedral's containment
  ring — 96 m out of the water at (−122, −870) — as the backdrop.
- **`crest`** — *"a good water shader in an empty frame."* It was: the shot was
  authored to prove the boundary exists, and it proved it against nine hundred
  kilometres of nothing. Turned **along** the crest instead, keeping the surf and
  the ocean edge and gaining the Prow as a subject at 268 m. The stand point is
  measured, not guessed — the crest wanders with the ring, so its radius was
  scanned per bearing; compass 118 at r = 962 puts the ground at **+0.62 m**.

`crest` is now the strongest frame the level has produced: breaking whitewater
across the foreground, the rusted ribbed bow driven into the reef with spray at
its base, a palm-lined beach, and the smoking plug behind it.

### Still open going into round 9

- **The hull is still near-black on its shadow side** (defect 22, live in 8b).
- **Two large flat unlit black rectangles float on the lagoon** either side of the
  Spine in the new `spine` frame — debris pieces with no material response. New.
- The five long-standing audit gates: reef-flat band, the wade cap, station
  reachability, beauty-shot clearance, and seven bedded-prop outliers.

---

## Round 8 — defect 21, THE KEY ANGLE, and the "zero sky fill" note

One agent, two things that turned out to be the same thing.

### The sweep had to be rebuilt, because two of the cameras move with the sun

The previous attempt's `key-el*` sets are not a controlled sweep. Probe points
across six captures:

| pose | | |
|---|---|---|
| `atoll` | **stable** | (−7.0, −8.7, 293.0) |
| `cauldron` | **stable** | (−199.3, 72.8, 335.2) |
| `strand` | **stable** | (−414.6, −2.5, 928.7) |
| `arrival` | **stable** | (−1.4, 3.5, 756.2) |
| `lagoon` | **moves** | (246, −8, 395) at 26/24 → (72, −9, 76) at 20 and below |
| `crest` | **moves** | (914, −39, −914) at 26/24 → (752, 0, 505) at 20 and below |

`lagoon` and `crest` are search-placed eye-level poses and the search result
changes with the light. "At 14 the lagoon has gone grey-blue" was measured on a
**different camera in different water**. Every colour number below is taken off
`atoll`, and any future sun sweep must be too.

### The elevation: there is no Fresnel cliff, and 26 was on the wrong side of the level's own answer

Lit quartile of the lagoon band, `atoll` pose. `SEA_EXTINCTION.turquoiseCheck`
records hue **186.4** as the answer.

| el | lit quartile | hue | err | value | okC | flank okC | flank sd | shadow |
|---|---|---|---|---|---|---|---|---|
| 26 | `#377173` | 181.2 | 5.2 | 45.0 | 0.061 | 0.0109 | 22.0 | 2.05× |
| 24 | `#2f676f` | **187.3** | **0.9** | 43.5 | 0.060 | 0.0117 | 22.2 | 2.25× |
| **20** | `#2d5c69` | 193.7 | 7.3 | 41.4 | 0.055 | 0.0134 | **22.6** | **2.75×** |
| 17 | `#285367` | 199.1 | 12.7 | 40.3 | 0.058 | 0.0197 | 19.2 | 3.27× |
| 14 | `#275566` | 195.4 | 9.0 | 39.8 | 0.057 | 0.0199 | 21.2 | 4.01× |

Three findings, in order of how much they change the argument:

1. **The cliff does not exist.** 26 → 20 costs eight per cent of the lagoon's
   value and ten per cent of its chroma. The old note predicted "a mirror of the
   sky - one flat pale sheet, no depth colour, no seabed"; the water shader does
   not produce one at any angle in the sweep.
2. **26 overshoots the level's own colour law**, five degrees past 186.4 toward
   green. Dropping the key moves the water *toward* the recorded turquoise
   before it moves away — the hue error is smallest at 24 — and 20 is only two
   degrees further out than 26 was in the other direction.
3. **What decides it is the landform, not the water.** Shaded-side chroma rises
   all the way down, but the flank's *value structure* peaks at 20 and falls
   below it: past 20 the flank stops being modelled and starts being shadow.

**Shipped at 20.0.** The old comment's number was right and its reason was not.
Shadows run 2.75× rather than 2.05×. Still the highest of the three worlds
(Vesper 13.5, Kenosis 15) — that is the water's tax, now measured rather than
asserted. `ATOLL_CYCLE_STOPS` phase 0.14 moved with it; nothing checks that pair.

**Two things that do NOT constrain the elevation**, checked because they looked
as if they would. A prop's cast shadow is `height / tan(el)` and the shadow
map's lookup displacement is `normalBias / tan(el)` — **the ratio is
`height / normalBias` and is independent of the sun**, so dropping the key
neither re-opens nor closes defect 23. And the cloud-shadow elevation fade,
`clamp01((sunDir.y − 0.052) / 0.14)`, is at full strength down to 11 degrees.

### The loose end — "zero sky fill" — and it was NOT the fill

The judge on `weeping`: *"a shadow-side landmass with zero sky fill — half the
frame is near-zero black with no hue in it."*

One composite term switched off at a time, over the shaded flank crop only,
restored between (`scratchpad/fillprobe.mjs`, because a frame-wide mean cannot
see a crop):

| | r | g | b | |
|---|---|---|---|---|
| baseline | 7.71 | 9.32 | 14.63 | |
| AO off | 7.71 | 9.50 | 15.41 | innocent |
| contact off | 7.71 | 9.32 | 14.63 | innocent, exactly |
| shade off | 7.70 | 9.35 | 16.22 | innocent |
| toe → 1 | 7.55 | 17.11 | 32.43 | |
| **environment OFF ENTIRELY** | 7.71 | 9.21 | 13.63 | **0.1 green, 1.0 blue** |
| **lift off** | 3.15 | 2.43 | 2.78 | **the picture in there WAS the lift** |

**Cause: the composite's contrast term is a hard black clip.**
`c = (c − 0.5) * uContrast + 0.5` followed by `pow(max(c, 0.0), uGamma)`. For
`k > 1` the line crosses zero at `0.5 * (1 − 1/k)` — at the trade grade's 1.06
that is display-linear **0.0283, sRGB code 47, a fifth of the range** — and
everything under it lands on exactly 0.0 and is then repainted at `lift`. Round
7's fourteen frames all report a 1st percentile of 7 or 8: **that is the lift's
own luma, in every frame.**

**Why it bit this world and not the other two.** Vesper's dune shade measures
`#623120`, red at display-linear 0.12, four times clear of its own crossing — a
warm-shadow world survives a black clip. This world's shade is blue-cyan *on
purpose* (round 6's whole finding), and a cool shadow keeps its energy in BLUE,
the smallest linear value and the least luma weight. The clip takes red and
green first and leaves a blue pedestal, which is "near-zero black with no hue in
it" verbatim. Measured on the same crop:

| | shaded quartile | okC |
|---|---|---|
| Vesper `vista-east`, dune shadow band | `#623120` | 0.0762 |
| ours `arrival` at 26°, log cast shadow | `#0a0b0e` | 0.0079 |
| ours `arrival` at 14°, same crop | `#080a0e` | 0.0094 |

**And this is why the key angle could not be judged on its own.** At a lower sun
more of the frame is in cast shadow, so dropping the key without fixing the clip
trades lit pixels for black holes — the same crop went mean 62.6 → 34.2 between
26 and 14. The fill had to be fixed *first*.

### The fix, and it is opt-in per grade because the other two worlds are the ruler

```glsl
vec3 cLine = (c - 0.5) * uContrast + 0.5;           // the shipped operator
vec3 cPow  = 0.5 * pow(max(c, 0.0) * 2.0, vec3(uContrast));
c = mix(cLine, cPow, uContrastFloor * step(1.0, uContrast));
```

A power about the same pivot has **exactly the same slope at mid-grey**, tracks
the line to within 0.008 over the whole upper half, and maps 0 to 0 instead of
to a negative number. `uContrastFloor` defaults to **0** — the line unchanged —
and is read from a new optional grade field carried through `blendGrade`.
Vesper-IX and Kenosis set neither.

**The control, and it is the point of the whole design:** eight Vesper poses
recaptured with the change in came back **identical to `ref-vesper` to within
the dither** on mean, sd, 1st percentile, 95th and median linear.

At `contrastFloor: 1.0` the picture was right and the numbers were not — the
`weeping` flank became a fully modelled landform, but atoll's 1st percentile
went 29 → 46 and cauldron's 23 → 43 against Vesper's whole-set 7–34, and the
deep lagoon lost a fifth of its dark-quartile chroma, because the crush was part
of what was making deep water read deep. **Shipped as a blend at 0.35**, which
is nearly free above display-linear 0.1 and worth 3× at 0.04 — it acts almost
only on the band the clip was destroying. `blaze` takes the same 0.35; its clip
is *deeper* (contrast 1.12 → display-linear 0.0536, code 63).

The trade **lift came down 55 %** to `[0.0006, 0.0009, 0.0017]` with its hue
ratio kept: a pedestal is the right answer to a hole and the wrong answer to a
picture, and seven code values of it sat on top of a flank whose whole range is
about ten.

The `weeping` flank crop, which is the whole of the note:

| | mean | sd | okC | |
|---|---|---|---|---|
| round 7 | 9.30 | 2.20 | 0.0108 | flat pedestal, no form |
| floor 1.0 | 24.80 | 4.50 | 0.0247 | readable, too pale for the set |
| **shipped** | 6.80 | **3.40** | **0.0220** | darker than r7, 55 % more form, twice the chroma |

### The noon hour took the same blend and it was checked, not assumed

`blaze`'s clip is *deeper* than trade's — contrast 1.12 puts it at display-linear
0.0536, **sRGB code 63, a quarter of the range** — and the r5 noon measurement
recorded a 1st percentile of 10–18 and read it as a healthy floor. It was this
term's output. Held at trade's 0.35 rather than raised to match, on the rule
this file already uses: a number checked on three poses does not get to be more
adventurous than one checked on fourteen. Two noon poses before and after:
`arrival` mean 124.9 → 126.3, 1st pct 10 → 10; `atoll` 131.3 → 133.5, 18 → 26.
Contained, no blow-up. `dusk`, `night` and `storm` still carry the clip and are
left at `contrastFloor: 0` because nobody has measured them.

### Found on the way, and it belongs to whoever owns the ship

At 16:24 the level stopped booting — `SyntaxError: Unexpected identifier
'diffuseColor'`, boot stuck at 14 %. **Three backticks inside a GLSL comment in
`PLATE_FRAG`** (`atoll-art.js` 2946, 2962, 2963). `PLATE_FRAG` is a JS template
literal, so the first of the three closed it and every literal after it paired
wrong. This is the one-line trap the house style names and it has now cost this
project three separate days. Stripped; the file parses and boots.

### The histogram, re-measured against round 6's table

Fourteen frames, ultra, trade, at the shipped elevation with the floor fix in
(`output/saintfall/island/key-final20`):

| | mean luma | sd | 1st pct | 95th pct | median linear | lit quartile more chromatic |
|---|---|---|---|---|---|---|
| round 7 | 77–123 | 28–63 | 7–29 | 164–220 | 0.083–0.242 | 14 / 14 |
| **shipped** | **75–124** | **26–65** | **3–55** | **156–221** | **0.083–0.239** | **14 / 14** |
| Vesper-IX | 47–130 | 34–67 | 7–34 | 118–213 | 0.020–0.309 | — |

Mean, sd, 95th and median linear all hold, and round 6's one metric that
actually encodes the original complaint — *is the lit quartile more chromatic
than the shaded quartile* — is **14 of 14**, unchanged.

**The 1st percentile is outside the band at both ends and both ends are worth
naming.** At the top: `cauldron` 55 and `spine` 41 are the two frames the wreck
fills, and the ship agent raised the hull's marine fill between the `key-fix26`
and `key-floor26` captures — `cauldron` went 43 → 52 across a change of mine
that could only lower it, so those two are not this work's and should be
re-taken when the round settles. At the bottom: `drive`, `roost`, `nave`,
`strand` and `weeping` reach 3–4 against Vesper's floor of 7, which is the lift
coming down. That is deeper black than the reference rather than shallower, and
the failure round 6 fixed was blackless milk, so it is left — but it is a
deviation and it is recorded as one.

`saintfall-atoll-audit.mjs --quality high --time trade`: **the same 5 gates fail
as in round 7** (reef crest band, station reachability, the wade cap,
beauty-shot clearance, prop bedding) and all three health gates pass — no page
errors, **no NaN reached a composite uniform**, no NaN in the atmosphere or
water uniforms. Nothing this round touched moved a gate.

**Frames opened:** `antiphon-r7/{weeping,atoll,arrival,strand}`,
`ref-vesper/{vista-east,road}`, `key-el26/{cauldron,lagoon}` and
`key-el14/{cauldron,lagoon}` from the previous attempt, then
`key-base26`, `key-fix26`, `key-floor26`, `key-f24`, `key-f20`, `key-f17` and
`key-final20` at ultra/trade.

---

## Round 8 - SHIP MATERIALS. The defect the ship had failed three rounds on was one number and one missing lobe.

Round 3: "an untextured black slab". Round 4 worked on it. Round 7, from three
judges who did not know which side was which:

> "Its subject is a stack of **unlit dark boxes**."
> "The hull is a **black slab** sitting on the sea with no waterline, no wake and no contact."
> "A **value-2 slab with no facet response** sitting on a blobby colour decal in the water."
> "A **black cutout with no material read** jammed against the horizon."

And the frame that beat it, from the same judges: *"the only convincing metal in
the set - ribbed specular, patina, warm highlight against cool shade - with
braziers as correct brightest points and a full value ladder."*

### The instrument came first, because every existing one averaged the defect away

`scripts/saintfall-hull-probe.mjs`. The Hold barge is about 4 % of `hold.png`;
a frame mean moves by less than a level when the whole ship goes from black to
white, so no frame-wide number this level owns could see the thing three rounds
of judges were describing. The probe masks the ship and reports on nothing else:
the luminance ladder in **display levels** (the units "value 2" is stated in),
blue-minus-red, the fraction under level 26, and a count of how many of the ten
value steps hold at least 1.5 % of the ship - *"a full value ladder"*, counted.

**Its first version was wrong and the way it was wrong is worth keeping.** The
mask was taken as "pixels that moved when the wreck was hidden", and on `spine`
it selected **37.9 % of the frame** - the whole ocean. Hiding the ship moves the
water's reflection, the AO buffer and the composite's dither everywhere at once.
**A mask must not be a difference of the thing it is masking.** It is now a
silhouette render: the wreck's materials forced to unshaded white, everything
else hidden, straight to the framebuffer with no composite, threshold at 200 so
antialiased edge pixels - which in the real frame are half sky - are excluded.

Two diagnostic cameras were added, derived from the live sun bearing so they
cannot go stale: `flank` (120 m off the beam, sun behind the ship) and `band`
(110 m, 24-degree lens on the waterline). **The first `band` camera stood 34 m
off the station and was inside the hull** - the Spine's beam is 72 m - and
returned a black frame that looked exactly like the defect it was hunting.

### What it measured, and it is not what four rounds of comments assumed

At `flank`, over 705 805 masked hull pixels:

| | mean | p50 | ladder | below level 26 |
|---|---|---|---|---|
| round 7 / round 8 baseline | (10.9, 17.0, 28.1) | **11.1** | 3 of 10 | **87.2 %** |

That is not "dark". That is the frame's floor with a ship-shaped hole in it.

The A/B sweep, each term restored before the next:

| | p50 | note |
|---|---|---|
| base | 11.1 | |
| fill x3 | 14.0 | the term that exists for this **moved it three levels** |
| albedo -> mid grey | 16.8 | not the ramp |
| AO off | 12.9 | not the occlusion |
| env x3 | 21.4 | the largest single lever and still not enough |

**No single existing term could fix it, and HULL_RAMP - which two earlier rounds
reached for - was measurably not the fault.**

### Three causes, and the third is the one nobody had looked for

1. **The gain was set on the wrong pixels, three times running.** The marine
   fill's history is in the file: 0.30 overshot into teal, 0.21 was the hue
   rotation at two thirds chroma, 0.40 shipped. Every one of those was measured
   on the **Hold camera at 152 m**, whose hull mask is more than half *lit deck*.
   The shaded flank the term exists for is a tenth of those pixels.

2. **The gate works, so the gain was free all along.** At the `lit` camera,
   tripling the fill moved p50 by **0.4 of a level** (54.4 -> 55.0). The `away`
   gate retires the term about 39 degrees before the terminator. Raising the gain
   cannot soften the one edge this house style lives on - measured, not argued.

3. **THE FILL HAD NO AZIMUTH, AND THAT *IS* THE "NO FACET RESPONSE" COMPLAINT.**
   `sfSky` (art.js:1163) is a function of elevation plus a sun lobe. On the shade
   side `dot(rd, sunDir)` is negative, the lobe is zero, and sfSky collapses to a
   function of `rd.y` alone. The old fill compressed the normal's elevation and
   handed it to that - so **every vertical plate on four hundred metres of shell,
   whichever way it faced, received the identical fill.** The ship's only light
   was a constant. No amount of gain fixes that; it makes a brighter slab.

### The model now, and every lobe is a reflector a hull in a lagoon actually has

- **the dome** - up-facing plate, sky, still sampled at a compressed elevation
  (the un-compressed version put the Hold's shutter leaves in teal plastic and
  that earlier finding stands), then pulled **28 % toward its own luminance**:
  with the gain where it now is the shade side inherits the dome's chroma, and
  the dome on this level is the same blue as the *lagoon*. The Spine measured
  blue-minus-red +51.6 against water at about the same - the rubric's hue
  collision. Desaturating the **lobe** and not the result keeps the shade side
  cooler than the lit side while taking it off the sea's hue.
- **the upwelling** - down-facing plate, the lagoon under the hull.
- **the azimuth** - a wrapped term against the key, `SF_AZ_FLOOR` to 1 across the
  shade side, squared so the bright end stays narrow. This is what makes two
  frames on the same flank different values.
- **the sea glare** - and it is why a waterline reads. A plate three metres over
  a sunlit lagoon sees water across most of its lower hemisphere, and that water
  is the brightest thing on the level: **the sea measures 150-200 in the same
  frames the hull measured 11.** Authored WARM against the cool dome, which is
  the winning frame's sentence exactly, and faded over 20 m so the ship's
  brightest shade-side value sits ON the waterline, where the tide bands are.
- **times (1 - metalness)**, which is a correction and not a taste: three's own
  diffuse albedo is `diffuseColor * (1 - metalnessFactor)`, and without the
  factor the term handed every metal a diffuse lobe the rest of the shader had
  already refused it. The capture that found it had the Hold's **brass glowing
  neon yellow and the verdigris beside it neon cyan** in a room whose deck was
  still black.
- **and both authored constants are horizon-gated.** `uFillDown` and `uFillWarm`
  are fixed colours derived from the trade sun; the dome lobe fades on its own
  through `sfSky` but a constant does not, so an ungated hull is lit at midnight
  from below by a sunlit lagoon that is not there. **The gate is the horizon and
  not the elevation** - the obvious version fades the glare as the sun drops and
  is backwards, because a low sun makes the *longest* glitter path. Vespers is
  the hour this term flatters most.

### The seam is a bevel now, not a painted line

The seam was a multiply on `diffuseColor`: 20 % darker in the joint, 5.6 %
brighter on the lip, both **constant** - identical whichever way the plate faces
and whatever the sun is doing. That is not a facet response. The groove now has
a real V section (`H = -depth * (1-u)^2`, zero slope where it meets the flat, so
no crease at the outer edge) and the normal is bent into it with **the rock
block's technique thirty lines above it** - Mikkelsen's surface gradient, no
tangent frame, no UVs, analytic derivatives. It transfers exactly because
`vPlate` is the same kind of object as the rock's `rkQ`: a position-linear
surface parameterisation in metres, continuous across every facet in the piece.

0.022 m over the 0.13 m half-width is a 19-degree bevel. At 0.05 (39 degrees)
every seam grew a hard bright edge and the hull read as **quilting** - the
greeble field DESIGN-SEED section 9 refuses, and the same failure the rivet line
was cut for. At 0.010 nothing separated on the shade side, which is the only
side that needed it. Per material: scoured x1.25 (a clean plate's joints are the
sharpest edges on the ship), rust x0.55 (crevice corrosion *fills* a joint),
interior x0.8.

**It is value-neutral and that was checked rather than assumed.** A `bevel=0`
A/B reproduces the base ladder to three digits: a symmetric perturbation on the
~9 % of pixels within a seam half-width does not move any percentile. It changes
the picture, not the histogram, which is exactly the right shape for a term
whose job is "facet response" rather than "brightness".

### The fittings and the hero space, both of which had been left behind

`verdigris`, `ceramic` and `brass` had **no extension at all** - the four plated
materials climbed out of the floor and the fittings bolted to them did not.
They now take the fill without the plate grid (`fillExtend`): a 12 m butt seam
across a 1.4 m cleat is how a ship ends up looking like one material with a
texture on it. Their gains are **albedo ratios, not preferences** - the fill is
an irradiance and it multiplies the surface's own albedo, so a gain is only
transferable between surfaces of similar albedo. Fittings 0.52 of the hull's,
brass 0.34 (BRASS_RAMP's working range is three to four times HULL_RAMP's clean
mode) with a bigger share of the *glare*, because brass is the level's only warm
accent and the only thing on the ship allowed to be a brightest point.

`hullInterior`'s fill was the **literal 0.14** written when the outside gain was
0.40. When the outside gain was measured up to 6.40 the literal stayed where it
was, so **the level's hero space was the one part of the ship still on the
floor**. It is derived from `HULL_FILL` now. Its glare was first set to zero on
the argument that a bulkhead under a lid cannot see the lagoon - **the Hold is
not under a lid**, its bulwark is the ship's own sheer, and the frame shot from
inside it has the beach over the rail. Zero left a 176 m bulkhead, the largest
flat surface on the level, at display 0-12 in a room whose port wall reads 130.

### Before and after, at the trade hour, ultra

| camera | | p50 | ladder | below 26 | blue-red |
|---|---|---|---|---|---|
| `flank` shade side | before | 11.1 | 3 | 87.2 % | +17.1 |
| | **after** | **43.8** | **5** | **27.7 %** | **+27.0** |
| `band` the waterline | before | 15.3 | 5 | 57.0 % | +24.4 |
| | **after** | **76.7** | **8** | **11.5 %** | +23.1 |
| `hold` the judged frame | before | 58.0 | 5 | 33.7 % | -6.1 |
| | **after** | **69.6** | 5 | **12.5 %** | -6.6 |
| `spine` the judged frame | before | 35.1 | 5 | 37.7 % | +44.9 |
| | **after** | **99.9** | 6 | **0.4 %** | +45.3 |
| `rim` the judged frame | before | 55.9 | 4 | 0.3 % | +44.5 |
| | **after** | **88.6** | **5** | 0.0 % | +33.4 |
| `lit` control | before | 54.6 | 6 | 26.2 % | -8.3 |
| | after | 67.1 | 6 | 10.3 % | **-10.3** |

**The lit-to-shade hue split is now 37 levels** (`lit` -10.3, `flank` +27.0),
which is "warm highlight against cool shade" stated as a number, and the
waterline camera's ladder went from 5 steps to **8 of 10**.

### Cost, and what could not be measured

Programs **74 before and after** - the two new extend keys reuse existing
material programs. Draw calls unchanged (wreck 60). Three *serialised* ultra runs
of the five-pose set: 5.66, 5.72, 5.79 ms. **The harness cannot resolve the delta
on this machine**: identical work across this session's runs spanned 4.74 to
11.50 ms depending on what else was running, so any figure quoted from a single
pair of runs would be machine load, not shader cost. Structurally the change is
about 25 ALU and four derivative pairs on 4 of 74 programs, over 249 k of the
frame's 8.7 M triangles.

Every audit gate returns the same verdict as `gates-r7.json` - the same five
were already failing (reef crest, reachability, deep-water shelves, beauty-shot
clearance, six floating props) and none of them is a material.

**Frames opened:** `antiphon-r7/{hold,spine,rim,drive}`,
`ref-vesper/{saint-face,ossuary}`, `key-el14/cauldron`, the previous attempt's
`check-hullAB/hold`, then `check-ship-base`, `check-ship-sheet0`,
`check-ship-sheet1`, `check-ship-f1`, `check-ship-f1b`, `check-ship-f2`,
`check-ship-f2b`, `check-ship-f3`, `check-ship-f4`, `check-ship-f5`,
`check-ship-f5s`, `check-ship-f6`, `check-ship-vespers`, `check-ship-night2` and
`check-ship-final` at ultra.

### Still open on the ship

- **The reliquary crate in the Hold** is still a flat cyan-and-olive box with no
  material read on it at all. It is geometry, not a material: it carries no
  patina and no plate coordinate. It is the first thing the eye lands on in the
  level's hero space.
- **The Prow is invisible from its own beauty camera**, buried behind the
  canopy. That is a camera decision, not a surface one.

---

## Rounds 9, 10 and 11 — up to 5/45, then **back down to 2/45.**

### Round 9 — 5 / 45, and the first disagreement

Three judges, three **different** answer strings (3/15, 2/15, 0/15), where rounds
5 and 7 had produced identical ones. `rim` and `drive` won a majority. That
disagreement is worth as much as the score: a unanimous panel is a clear loss, a
split one is a level that has started to compete.

### Round 10 — four root causes, every one of which overturned the brief I gave it

1. **The hull is not see-through.** I handed the agent that diagnosis and it was
   wrong. It built a coverage meter — render the frame, render it again with the
   wreck hidden, render a third with the wreck flat magenta as an exact mask,
   then count mask pixels where the first two agree — and measured
   **0.09 % see-through on `spine`, 0.15 % on `hold`**, all of it silhouette
   antialiasing. The shell covers *more* than the ribs, not less.
   **It is occlusion.** A 0.55 m proud frame on a 4.0 m pitch hides the plate
   entirely once the view ray drops below `atan(0.55/4) = 7.8°` off the shell —
   and the Spine's own camera looks nearly down the hull. Past that you are
   looking at a wall of edge-on unlit frame sides: *a picket fence, which the eye
   reads as transparency.* Fixed by retracting the ribs in the vertex stage as
   the grazing angle closes. Gradient RMS across the flank down 25–41 %.
2. **The sand seam is not in `surfaceAt`. It is the sea.** Vertex colour is
   constant straight across it. Hiding `atoll-sea` removes it entirely. Measured
   at the Nave: **a 2.0 m wave standing in 0.39 m of water, H/d = 5.1.**
3. **The level had been running a fill less than half the size its own file
   believed, for four rounds.** `envIntensity`'s comment computed the fill:key
   ratio as `0.52 / 5.35 ≈ 10 %`. Wrong twice: the key's luminance is
   `sunIntensity × luma(sunColor) = 4.23`, and `envIntensity` scales a dome whose
   cosine-weighted irradiance on a shaded vertical flank measures **0.345**. True
   ratio **4.2 %**, against the 12–18 % a judge had asked for by name.
   And the black mass on `weeping` receives **zero sun** — killing the key
   changed it by nothing — while `antiphon-cycle-fill`'s intensity is **0** at
   trade. *The mass is handed to the grade fully modelled, with terraces, strata,
   a ridge and individual palm trunks, and the grade deletes it.*
4. **No penumbra existed at any tier.** `PCFSoftShadowMap` and **three r180's
   PCF_SOFT branch never reads `shadowRadius`** — only the PCF branch multiplies
   its offsets by it. The kernel was a fixed one-texel tent: 0.083 m at ultra,
   identical at a palm's trunk and 20 m from it. Replaced with a real PCSS.
5. **`FILL_FRAG` was wired to the hull materials and to nothing else.** `leaf`,
   `leafMangrove`, `frondDry` and `bark` had **no fill term at all**. One
   omission explaining *five* separate judge complaints: "canopies merge into one
   unlit mass", "black-disc canopies", "mangroves as unshaded black cutouts",
   "the palms are two-tone cutouts", and the "unexplained shadow slab" — which
   turned out to be an 11 m driftwood log with an albedo of sRGB (166,155,137)
   rendering at sRGB (34,45,44).

**And one of mine.** The elliptical-pad rewrite renamed `padR` to `padA`/`padC`
and the mangrove's mud gate still read `padR`. `undefined * 0.55` is NaN,
`sstep(NaN, NaN, d)` is NaN, and `NaN > 0.001` is **false** — so the block never
fired once and **the Drowned Nave has never had any mud.** It failed in the worst
possible way: no error, no NaN reaching a uniform, no gate tripped; the residual
`sand` simply absorbed the weight, and a blind judge found it from the outside.

### Round 11 — 2 / 45. **A regression, and it is measurable.**

Two judges returned identical strings and the third differed on one pair — back
to the near-unanimity that rounds 5 and 7 produced, from round 9's three-way
split. And the closing verdict returned to round 5's, almost word for word:

> "Give the island level a committed directional key with hue-separated shade …
> because right now its vegetation, terrain, water and cloud kit are all lit from
> nowhere and **all sit inside the same third of the value range**."

The numbers say the same thing, and they are damning:

| | round 9 | round 11 | |
|---|---|---|---|
| mean sd across 15 frames | 49.1 | **43.4** | **−11.6 %** |
| mean luma | 105.7 | 108.1 | +2.3 % |
| between-frame luma range | **109** | **65** | the set collapsed toward one value |
| frames that lost contrast | — | **15 of 15** | every single one |

`nave` lost 20 points of sd, `bone-reef` 15, `arrival` 8.5.

**Round 10 raised the floor and flattened the level.** Every one of its fixes was
individually correct and well measured — and together they were a global answer
to a local problem.

> **THE LESSON, and it is the most expensive one of the session: a global term
> cannot do a local job.** Two frames had a mass crushed to black. The response
> was more global ambient (`skyFillGain 1.5`) and a higher global black floor
> (`contrastFloor 0.35 → 0.60`). Both lifted the two offending masses — and also
> lifted the thirteen frames that were already correct, costing every one of them
> contrast. A mass that goes black because it receives **zero sun** needs a *rim*,
> a *bounce*, or terrain that catches light — something that acts where the
> problem is. It does not need the whole level lit more.

This is the same shape as round 6's recorded wrong turn ("a luma-keyed term left
standing after the luma moved"), arriving from the opposite direction.


---

## Round 12 - the flatten hunt. **Four of round 10's five changes were innocent.**

Reverting `contrastFloor` (0.60 -> 0.35) and `skyFillGain` (1.50 -> 1.00) bought
**0.5 of the 5.7 points of mean sd** round 11 had lost. So the flattening was
somewhere else in round 10 and still in the level, and the only way to find it
was to switch one thing off at a time.

### The instrument first, because nobody had one

Round 10's five changes each needed a source edit, a reload and an edit back to
switch off, so **not one of them had ever been run alone.** `?qa=1&ab=<flag>`
now turns a single term off at load (`nofill`, `noterrfill` in atoll-art.js,
`hard` in atoll-main.js, `notrough` in atoll-water.js, `nomud` in
atoll-terrain.js). Every flag **zeroes a gain rather than skipping a block**, so
the program set, the uniform layout and the draw list are identical on both
sides of a pair - a switch that changes the number of programs measures the
recompile as well as the term. The control run with no flag set reproduced the
baseline **to 0.00 on every frame**, which is what makes the rest of the table
worth reading.

### The table, ultra, trade. sd delta from turning each change OFF

| switch off ... | nave | arrival | roost | bone-reef | crest | mean |
|---|---|---|---|---|---|---|
| **the foliage fill** | **+4.0** | **+4.5** | **+3.8** | +0.4 | +0.3 | **+2.6** |
| PCSS (radius 1) | −0.1 | +0.7 | −0.3 | −0.2 | −0.8 | −0.1 |
| the shoaling floor | +0.1 | +0.0 | +0.0 | −1.2 | −0.0 | −0.2 |
| the mangrove mud | **−4.4** | +0.0 | −0.1 | −0.6 | +0.0 | −1.0 |
| the terrain fill | −0.0 | +1.4 | +0.0 | −2.6 | +0.1 | −0.2 |

**THE PENUMBRA, THE SHOALING FLOOR AND THE MUD ALL PAY CONTRAST IN.** Removing
any of them makes the level flatter, not sharper - the mud alone is worth 4.4
points of sd at the Drowned Nave, because a mangrove flat with mud bands in it
has structure and a mangrove flat without them is one pale sheet. The three
things that looked most like "softer, smoother, more filled-in" were all
earning their place.

Only the foliage fill takes contrast out, and it takes it out of exactly the
three frames that carry foliage.

### Two warnings about the harness, both found by accident

- **`weeping` moved by −3.4 in three unrelated flags at once.** It is not any of
  them: a concurrent session edited `atoll-art.js` mid-chain and every run after
  that edit carries it. A one-line timestamp check (`stat` the sources against
  the capture times) is now part of reading any A/B table on this repo. The
  isolation work moved into a frozen `rsync` copy of the tree after that.
- **`crest` carries about three points of placement noise.** It is
  search-placed: the same code measured 32.23, 35.49 and 35.47 across three
  runs. Round 11's "crest lost 7.5" is at least half camera. Do not put weight
  on that frame.

### And nave's twenty points are mostly a bug being removed

`nave` lost 19.4 sd from round 9 and the switches account for less than four of
it. Round 9's frame had a **hard geometric white-against-dark seam across the
whole flat** - the 2.0 m wave standing in 0.39 m of water, the frame's single
largest source of between-group variance, and round 9's most-named defect. Round
10 removed it correctly. **A defect can carry sd**, and a scoreboard that cannot
tell a white blowout from a white subject will score its removal as a loss. The
Nave needs contrast put back into it deliberately; it does not need the seam
back.


### The fix, and it is two numbers on two materials

Both of them are the same mistake in two places: **a constant measured on the
hull, applied to a surface that is not shaped like a hull.**

**1. `LEAF_FILL`'s away bias, 1.6 -> 3.4.** `away = 1 - clamp(ndl * bias)` is
what retires the fill as a surface turns into the sun, and 1.6 was set on a
near-VERTICAL hull plate whose ndl reaches 0.94 at the trade hour. The trade sun
stands at 20 degrees, so a canopy leaf presenting a horizontal shoulder - which
is most of a crown, because that is what a crown is FOR - has **ndl 0.342 and no
more**:

| bias | ndl * bias | `away` |
|---|---|---|
| 1.6 | 0.547 | **0.453** |
| 2.6 | 0.889 | 0.111 |
| 3.4 | 1.163 | 0.000 |

**A fully sunlit crown was keeping 45 per cent of the sky fill on top of its
key.** Nothing on a 20-degree-sun level is "facing the sun" by a vertical
plate's standard, so the term never retired anywhere and the whole canopy - lit
shoulders and shaded flanks together - went up as one. That is round 11's
recorded failure exactly: it lifted the mass instead of the shade.

**And BARK_FILL's own note had already found this**, on a driftwood log, in the
same commit - "its top facet has ndl = 0.25 against a 20-degree sun, so at bias
1.6 it kept 60 per cent of the fill on a facet that is already taking the key" -
concluded **THE BIAS IS THE LEVER AND THE GAIN IS NOT**, moved bark to 3.4 and
left the leaf on the hull's number.

Measured at the roost camera, the near canopy crop and the frame around it:

| bias | canopy crop luma | its sd | FRAME sd |
|---|---|---|---|
| 1.6 | 40.6 | 27.0 | 50.70 |
| **3.4** | **34.4** | 25.4 | **52.57** |

The mass drops six levels back toward the dark it is meant to be and the frame
gains 1.9 sd. **The crop's own sd falls 1.6 and that is the trade**: the fill
was buying a little spread inside the canopy, in proportion to leaf albedo, by
moving the whole canopy toward the frame's mean.

**2. `BARK_CAP` - the fill becomes a bounded LIFT, not a bounded irradiance.**
The fill is an irradiance and multiplies the surface's own albedo, so a gain is
only transferable between surfaces of similar reflectance. **BARK_RAMP's linear
luminance runs 0.0098 at the dark trunk to 0.3776 at the sun-bleached driftwood
- thirty-eight to one, on one material, under one gain.**

Measured on the `arrival` camera - the 11 m driftwood log's crop, the sunlit
sand it lies on, and the palm trunk beside it:

| | fill off | fill on | fill + cap |
|---|---|---|---|
| the log | 60.1 | **100.8** | **76.6** |
| its own sd | 38.4 | 26.0 | 31.1 |
| sunlit sand | 81.8 | 81.9 | 80.2 |
| palm trunk | 25.5 | 38.0 | **36.9** |

Without the cap **the log renders nineteen levels brighter than the sunlit sand
it is lying on** and its crop loses twelve points of sd doing it. BARK_FILL's
note ends by saying the value it shipped put the log at 66 against shaded sand
at 89, and that "sitting it just UNDER the sand's own shade value is what makes
it read as a piece of wood again". It never did. **The kerbstone that note says
it removed was still the first thing the eye lands on in the level's opening
shot** - and it is the same object a round 9 judge called "an unexplained shadow
slab".

`uFillCap = [strength, reference albedo]` scales the fill by
`reference / ownAlbedo`, **clamped at one**, so it may only ever take the term
DOWN on a surface paler than the reference and never up on a darker one. The
version that boosts the dark end is arithmetically tidier and is a second
flattener wearing the first one's clothes. The reference **0.11** is not chosen:
it is the bottom of the file's own figure for mean canopy albedo. The hull and
the fittings pass `[0, 0]`, `mix()` returns exactly 1.0, and **the ship is
unchanged to the bit** - its plated materials sit inside a 3:1 albedo range, not
38:1.

The test the fix had to pass was not "does sd go up". It was **does the trunk
keep what round 10 bought it**: 38.0 -> 36.9, which is nothing, while the log
comes back under the sand.

### Fifteen frames, snapshot tree, ultra, trade

| pose | before | after | delta |
|---|---|---|---|
| `arrival` | 42.3 | 43.6 | +1.2 |
| `atoll` | 44.9 | 44.9 | -0.0 |
| `lagoon` | 41.2 | 40.9 | -0.2 |
| `spine` | 38.2 | 38.1 | -0.1 |
| `hold` | 45.6 | 45.6 | +0.0 |
| `prow` | 41.7 | 41.9 | +0.2 |
| `drive` | 44.8 | 45.2 | +0.4 |
| `bone-reef` | 37.0 | 37.3 | +0.3 |
| `nave` | 38.0 | 39.4 | +1.4 |
| `weeping` | 48.2 | 48.4 | +0.2 |
| `rim` | 64.3 | 64.3 | +0.0 |
| `cauldron` | 25.1 | 25.6 | +0.6 |
| `roost` | 50.8 | 52.7 | +1.9 |
| `crest` | 35.0 | 38.0 | +3.0 |
| `strand` | 59.1 | 60.0 | +0.9 |
| **mean** | **43.75** | **44.40** | **+0.65** |

Thirteen of fifteen at or above baseline; the two that are not (`lagoon` -0.2,
`spine` -0.1) are the two frames with no foliage and no driftwood in them, and
both are inside a rounding of nil. **`crest`'s +3.0 should not be counted** - it
is search-placed and measured 32.2, 35.5, 35.5 and 35.0 across four runs of
identical code. Without it the mean gain is +0.48, which is the number to hold
the change to.

And the ceiling this buys is not the point. **Round 9's 49.09 is not the target
it looked like**: `nave` and `bone-reef` carried a third of their sd in a
straight white seam that was the level's most-named defect, and round 10 was
right to delete it. The honest scoreboard from here is what a frame's contrast
is MADE of, not how much of it there is.

### And the instrument is now in the file

`?qa=1&ab=nofill,noterrfill,norim,hard,notrough,nomud` for the on/off switches
and `?qa=1&lb=3.4&bcs=1.0` for the numeric sweeps, all QA-gated, all inert
unless passed, each one **zeroing a gain rather than skipping a block** so the
program set and the draw list are identical on both sides of a pair. Round 10
made five changes and not one of them was ever run alone; that is the whole
reason round 11 cost a round to diagnose.

---

## Round 12 - the hull's waterline

Four consecutive blind rounds named the ship's relationship with the water and
they named four separate things. All four were investigated with a purpose-built
instrument, `scripts/saintfall-hull-waterline.mjs`, which renders each pose three
times - composited, wreck hidden, wreck as a magenta silhouette - and reads the
see-through fraction, the hull's own value ladder above the waterline, the
water's value near and far from the hull, and the seam's top end against the
frame's. Two of the four complaints turned out to be the same defect and one was
false.

### 1. "Semi-transparent at the bow" - FALSE, and the perceptual cause found

Round 10 measured 0.09-0.15 % see-through on `spine` and `hold` and called it
antialiasing. Re-run at the bow, which round 10 never framed:

| camera | hull mask | see-through |
| --- | --- | --- |
| `bow` (78 m off the beam) | 35.2 % of frame | **0.024 %** |
| `spine` | 7.4 % | 0.069 % |
| `hold` | 36.8 % | 0.025 % |
| `band` (96 m abeam) | 57.5 % | **0.000 %** |

The hull is opaque. What the judge saw is the SIGN of the value ladder: measured
at the bow, the plate 0.7-2.0 m above the waterline read 82.8 and the plate
2.1-4.7 m above it read 42.6. The hull was brightest where it entered the water.

### 2. "A white skirt" - it was not the scour collar, it was the dead band

Round 12's first move was to read what round 10's scour collar did before adding
another. It is not the collar. `atoll-structures.js` mixes `DEAD_BARNACLE`
(`#c9c2b0`, bleached shell) at a flat 0.62 across `[sub + dead, crustTop + dead]`
- a 1.23 m ribbon at 0.72-1.95 m above the tide plane, running the full 400 m,
with a hard edge top and bottom. The bands either side of it are `SPLASH_LICHEN`
at 0.80, the darkest colour on the ship. The frame therefore contained a bleached
stripe sandwiched between two near-black ones, and at 400 m its lower edge is
sub-pixel from the water.

Measured on the hull's own value, display sRGB, in three screen bands above the
waterline:

| camera | 0-0.6 m | 0.7-2.0 m | 2.1-4.7 m |
| --- | --- | --- | --- |
| `band` | 39.4 | **63.0** | 52.6 |
| `bow` | 75.2 | **82.8** | 42.6 |

Fixed by weathering the colour to `#9d9484`, riding the weight on `blotch`
(0.26-0.66 instead of a flat 0.62) and fading the band's LOWER edge over 0.34 m
while keeping the upper one hard - it is a strand line, so its top is a real
boundary and its bottom is not. After: `band` reads 46.2 / 31.5 across the same
bands, and the stripe is gone from the frame.

### 3. "No draft, no wake, no contact darkening" - the contact field was dead code

The shader block, the uniforms and the world-side solver all existed on disk.
Nothing ever set `uHullA.w`, so the loop broke on the first compare and a hundred
and forty lines of contact field rendered nothing and measured nothing. A
capability that is never switched on is indistinguishable from one that was never
written.

Armed by `water.setHullContacts(world.hullContacts)` in `atoll-main`, solved in
`atoll-world` from the wreck's own oriented boxes and wetted vertices. **One
capsule per piece was not enough**: one width per piece is necessarily its
widest - 40 m on a Spine whose maximum beam is 72 - so at the bow the capsule
stood thirty metres out in open water, the shade band was offset from the plate
it belonged to, and the standing wash, which is measured from the capsule
surface, drew a ring thirty metres off the ship with nothing at the waterline.
Nine capsules now, up to four runs per piece, each run's half-width measured off
the wetted vertices in it. Prow: 29.3 / 26.3 / 13.6 m - the bow tapering to a
point.

Water luminance near the hull minus far from it, display sRGB:

| camera | before | one capsule per piece | tapered chain |
| --- | --- | --- | --- |
| `spine` | **+15.2** | -15.1 | -5.6 |
| `bow` | -1.8 | -2.3 | **-31.1** |
| `band` | +2.2 | -88.9 | -62.9 |

Positive means the water was BRIGHTER at the ship than away from it.

### 4. Floating props: 6 -> 3, and three of the six were the gate

`floatingProps` measures every copy against the landform, which is right for a
crate on a beach and wrong for anything standing on another prop. It now casts
rays from twelve probe points on a failing copy - the four lowest sampled
vertices plus eight spread through the footprint - downward and sideways 0.8 m,
against `world.meshes` only (the landform is not in that list, so a hit is by
definition something the level built). The four-lowest points alone do not work
and the boardwalk is why: a deck on piles has its lowest vertex BETWEEN two
piles.

- `road-surface-atoll-ground-hull-boardwalk` +0.93 m - on its piles. Supported.
- `atoll-ground-hullScoured-pod-hatch` +1.36 m - on the drag furrow's berm. Supported.
- `road-surface-atoll-ground-hull-nave-ledge` +4.36 m - **a real defect**. The
  ledge is offset from its rib in WORLD x and z after the rib has been turned
  through `a0 + 1.1`, so it overlapped the rib's box by 0.78 m at one corner and
  cantilevered 4.3 m over open mud. Given two shores, built in the ledge's own
  frame and merged into it so the prop reaches the ground and needs no support
  test at all.

Three remain, all flora, all small: `flora-ipomoea-leaf-l1-l1` +0.45 m,
`flora-pandanus-wood-l1-l1` +0.41 m, `flora-snag-wood-l0-l0` +0.16 m. Nothing is
under or beside them, so they are genuine; the cause is in the scatter's own
height source and is not diagnosed.

### What it cost, measured the only way that works now

Another session was editing `atoll-art.js`, `atoll-water.js` and
`atoll-terrain.js` while this one ran, so a capture taken now against a capture
taken twenty minutes ago measures their work as well as this. Everything above is
therefore attributed by an **in-session A/B**: one boot, every pose captured
twice, `uHullA.w` toggled between 0 and 9 and nothing else changed.

    MEAN over fifteen frames    42.11 off -> 42.06 on     -0.05   (four capsules)
    MEAN over fifteen frames    43.24 off -> 43.23 on     -0.01   (nine capsules)

Largest single move: `bone-reef` +0.26, `hold` +0.17, `crest` -0.35.

**`crest`'s -0.35 was the harness.** Rendered first in its own boot with four
warm-up frames it reads 40.281 off and 40.273 on, and two consecutive renders of
the SAME state read 40.273 and 40.125 - that camera drifts 0.15 of sd while its
LOD settles, and the fifteen-pose sequence walks it in cold. Two changes were
made chasing it before that was measured, and both were wrong: dropping the wash
cap from 0.55 to 0.36 moved the number by nothing at all, and scaling the
reflection moved it by 0.08. The wash cap is back at 0.55. The reflection stays
scaled, on the argument that a contact which BRIGHTENS the water is wrong
whatever the frame says - and that is recorded in the file as an argument, not
as a measurement.

### Still open

The debris field's torn plates - the "two identical brown quads" - are `hull` and
`rust` material and take the draft, but a plate standing on a bar at 150 m gets
no contact from the sea because the capsule chain covers the three wreck pieces
and not four hundred and sixty fragments. Raycast-confirmed as
`atoll-ground-hull-debris-heavy` at (117, 6.5, 275) and (-20, 1.8, 254). The
bedding gate cannot see them either: they are two MERGED meshes, one copy each,
and the gate takes the minimum gap over the whole copy.
