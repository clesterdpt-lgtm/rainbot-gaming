# BLACKSAND — blind comparison, round 2

**Result: ours 0 / 11. Battlefield 2 won every pair.**

Set: `output/blind/round-2/`, seed 8821, 11 pairs. Reviewer was a separate agent
briefed as a hostile art director, given only the pair images and explicitly
forbidden from opening `_key.json`. It picked correctly in all 11.

It also recognised, unprompted, that the eleven weaker panels were one project:
*"Same voronoi floor, same yellow blobs, same pink/cyan split."* That is worth
noting — the blind protocol equalises HUD, resolution, compression and nametags,
but it cannot hide a consistent art style across a set. The verdict on quality
stands regardless; it judged rendering, not identity.

> **VERDICT: Not close — the weaker set is a lit greybox with a colour LUT on it,
> missing cast shadows, ambient occlusion, normal maps and atmospheric perspective
> as *categories*, and it would not pass a first-party art review at any shipping
> console publisher.**

## The defect list, in the reviewer's priority order

### Tier 1 — "these alone give it away instantly"

1. **Nothing casts a shadow except the terrain heightfield.** Buildings, walls,
   awnings, railings, rocks, palms, bushes and characters all cast zero. *"Until
   every static and skinned mesh is in the shadow caster pass, no other fix
   matters."*
2. **Ambient occlusion absent everywhere.** Every geometry junction is a razor
   line. *"The single largest reason surfaces read as decals rather than objects."*
3. **Characters are unlit 2D cut-outs and they float.** No value gradient across
   the torso, no rim, no contact shadow, a visible gap between boot and floor, and
   identical shading in light and shadow.
4. **Unlit black-hole geometry.** A foreground vehicle at pure 0,0,0; slab
   undersides likewise. The ambient term is not reaching those normals.
5. **The voronoi ground material** is used for every hard surface at 1.5–2m cell
   size with pure-black grout — an order of magnitude too large, physically
   impossible cracks, zero variation across the whole visible floor.
6. **Props are shaded by a different light than the world** — identical RGB in
   full sun and deep shadow.

### Tier 2 — lighting and colour

- Shadow luminance ratio wrong (70–80% of key; should be 15–30%) and hue pushed to
  saturated cobalt.
- Warm-pink key against cyan-blue fill with **no neutral anywhere** — reads as a
  LUT, not as light.
- Fog too near and flat: all contrast gone by 60m, no sun-relative gradient.
- **No atmospheric perspective** — the 250–300m midground is *more* saturated than
  the 30m foreground, inverting the depth cue.
- Light shafts are opaque hard-edged polygons that occlude the floor.
- One roughness value for the whole world.
- Visible cascade cutoff lines, hard shadow edges, no PCF/PCSS.

### Tier 3 — texture and surface

- No normal maps anywhere.
- Texture frequency does not attenuate with distance — same screen-space pitch at
  30m and 300m. *"Destroys the depth read more than any single other texture fault."*
- Mip-less procedural noise aliasing into digital hash.
- Obvious tiling period (brick sequence repeats every ~8 bricks).
- Zero macro albedo breakup on terrain.
- Concrete with no aggregate, chips, stains or edge wear.

### Tier 4 — assets and scatter

- Vegetation: one model, one scale, one LOD, evenly scattered; no translucency.
- Buildings are boxes with window rectangles pasted on — no reveal depth, sill,
  lintel, parapet, roof edge, AC units, wires.
- Bullet decals: flat rings floating off the surface, identical diameter and
  rotation, Z-fighting.
- Fire VFX: flat lime-to-yellow tongues emitting no light.
- First-person weapons faceted and untextured.

### Tier 5 — grade and silhouette

- Histogram entirely mid-range; nothing fully black, nothing hitting a specular
  highlight.
- Terrain ridgelines show flat mesh facets against the sky.
- Single-sided planes used as awnings and roof slabs.

### The one compliment

> *"The one thing worth keeping: the terrain heightfield sculpting itself — dune
> profiles and wadi cuts are competently shaped. Everything laid on top of it needs
> rebuilding."*

## Note on the metrics

All seven image metrics were inside the Battlefield 2 distribution when this
comparison was run, and we still lost 11–0. That is the useful lesson: the metric
suite is a **floor, not a ceiling.** It catches exposure, contrast, colour and
detail-density faults, and it cannot see missing shadows, missing AO, floating
characters or a repeating tile. Both checks are needed and neither substitutes for
the other.


## Round 2 post-mortem: one bug produced most of the verdict

Three agents independently chased "nothing casts a shadow" and each proved their own
subsystem innocent by measurement:

- **Structures** — casting correctly; an A/B on `sun.castShadow` moves 10–13/255 of
  the frame. The visible fault was pose geometry: the old town's street axis ran along
  the sun's own arc, so shadows fell behind their buildings, out of frame at *every*
  hour of a full time-of-day sweep.
- **Vehicles** — 64 of 78 meshes cast (the 14 that do not are glass). The pale ring
  read as an inverted contact patch was the tyre-track decal stamping a *bullet-hole*
  sprite at 0.62m.
- **Characters** — a plain grey box with `castShadow = true` placed next to a soldier
  also cast nothing, which ruled out the character rig and pointed at the light.

The actual cause was in `render.js`:

```js
const dir = sun.position.clone().normalize();   // already displaced by the last call
sun.position.copy(shadowFocus).addScaledVector(dir, q.shadowDistance * 1.1);
```

`updateShadowCamera()` re-derived the sun direction from `sun.position`, which it had
itself moved on the previous frame to follow the camera. The direction therefore
integrated the camera's motion and converged on a function of the camera's world
coordinates. `sky.js` repaired it only inside `updateLighting()`, which `sky.update()`
calls `if (moved)` — true only while the weather easing is still settling, so the
repair stopped about a second after load.

Measured drift: sky sun at elevation **47.8°**, actual key light at **8.7°** — 39° out
in elevation, ~140° in azimuth. At 8.7° incidence almost nothing has a shadow side and
direct light falls to ~14% of frame luma.

**The lesson worth keeping:** when several independent subsystems all appear to have
the same defect, suspect the thing they share. Three agents each spent a long
investigation proving their own code correct, and all three were right. The cheap move
— an A/B with a primitive placed next to the suspect object — is what localised it,
because a grey box has no rig, no material, no LOD and no instancing to blame.

It is also a shared-mutable-state bug: two modules both wrote `render.sun.position`,
one derived its input from its own previous output, and the repair path was
conditional. Reading the direction from `ctx.sky.sunDirection` removes the coupling
rather than fixing the symptom.


---

# Rounds 3 and 4

Both **0 / 11**. But the verdict changed character, which is the signal worth reading.

| | round 2 | round 3 | round 4 |
| --- | --- | --- | --- |
| verdict | *"a lit greybox with a colour LUT on it"* | *"lighting direction and terrain composition are already competitive"* | *"the terrain is already at shipped quality and in places better"* |

Round 4's "what it got right" list, unprompted and specific:

- *"The sand material is genuinely excellent and is the best single asset in the set…
  better than the desert in several shipped titles."*
- *"Terrain self-shadowing at map scale is correct and convincing… the shape is right,
  and shape is the harder half."*
- *"Brick is real geometry, not a normal-mapped plane… survives close inspection at 6x."*
- *"Composition and scale read as designed, not procedurally dumped."*
- *"No visible z-fighting, geometry cracks, or terrain LOD popping."*

And its summary of what still costs us every pair: *"in 9 of 11 the deciding cue was the
same one"* — shaded surfaces.

## The measurement that redirected the fix

The critic prescribed: *"raise sky irradiance so shaded surfaces land near 1/5 of sunlit
instead of 1/20."* Taken at face value that is a one-line change to `ENV_DIFFUSE`.

`scripts/blacksand-shade-probe.mjs` measures the ratio on the **same material** — ground,
classified lit vs shadowed by a physics raycast toward the sun, read back from the
framebuffer:

```
street     lit 0.1484  shade 0.0800  ratio 1.9:1
compound   lit 0.4909  shade 0.1375  ratio 3.6:1
```

Shadowed **ground** is already at or below the 5:1 target — too bright, not too dark. And
raising the diffuse IBL globally makes it worse: at ×4 the shade becomes *brighter* than
the sunlit ground (0.7:1).

The critic measured a shaded **wall** at 21:1. Both are correct. Together they say the
indirect term is not too small, it is **too directional** — up-facing surfaces receive
nearly the whole sky while vertical faces receive almost none. A real sky is a
hemisphere: a vertical wall sees half of it plus ground bounce, landing near 40–50% of
what a horizontal surface gets, not 5%.

**The lesson:** a reviewer describes a symptom accurately and then proposes a mechanism.
The symptom is evidence; the proposed mechanism is a hypothesis. Measuring the same
quantity on controlled geometry turned a global gain change — which would have made
things worse — into a distribution fix.


---

# The shade investigation, and what it taught

Three reviewers described the same defect and every one of them proposed a wrong
mechanism for it. Measuring beat all three.

| who | what they said | what was actually true |
| --- | --- | --- |
| critic r3 | *"A's water is one flat slate plane… no specular sun path, no foam"* | there is no water in the game |
| critic r4 | *"B's foreground third is a teal noise plane"* | it is shadowed sand |
| critic r4 | *"shaded surfaces land at 1/20 of sunlit; raise sky irradiance"* | shadowed ground was at 1/2.5 — raising it inverted the ratio |

`scripts/blacksand-shade-probe.mjs` measures lit vs shadowed on the **same
material**, classified by a physics raycast at the sun and read back from the
framebuffer. Per-channel medians, not luma, were what finally located it:

```
LIT     RGB(119,100,60)   hue 40.7   saturation 0.496
SHADE   RGB( 68, 70,58)   hue 70.0   saturation 0.171     <- 56% of lit
```

Not too dark. **Desaturated.** Shadowed sand was arriving near-achromatic, and a
grey-green plane with a ripple normal beside warm sand is a thing any experienced
eye calls water — which is exactly what two of them did, independently.

The cause was dilution, not level. A shadow here is lit by a warm ground bounce
*and* a blue sky probe, and blue light on orange sand cancels toward grey. A
three-way sweep of bounce, sky IBL and sun intensity showed the absolute levels are
not even the lever — auto-exposure renormalises them, so sun ×1 to ×2.2 left the
lit:shade ratio pinned at 2.84:1. Only the **ratio between the warm and cool ambient
terms** moves saturation.

Fix: `SKY_SPECULAR` 1.0 → 0.5, `GROUND_BOUNCE` 0.092 → 0.147. Total ambient barely
moves; only its colour does.

```
                 before      after     target
ground satKept     56%       104%      >= 75%
ground hue error   29.3      0.7 deg   <= 20
ground lit:shade   2.45:1    3.2:1     ~5:1
```

All seven image metrics stayed inside the Battlefield 2 distribution.

**Still open:** vertical faces. A shaded wall reads RGB(33,41,41) — hue 180 (cyan),
36% saturation retained, 8.9:1. Ground is fixed; the same fix has not reached
surfaces whose normal is horizontal, which is the "indirect is too directional"
thread.

## Also fixed this round

- **Trees cast no shadow beyond 210m.** Every palm fell to a camera-facing billboard
  impostor at that range, and an impostor cannot be in the caster set — three renders
  the depth pass from the light, so the card would face the light rather than the
  camera. The fix is not to force the billboard to cast; it is to make real geometry
  reach as far as shadows do (`maxDistance: max(210, shadowDistance * 0.95)`). Cost
  +2.3% triangles, p90 8.3 → 8.5ms.
- **View-model faceting.** Every cylindrical part defaulted to 12 radial segments and
  every ring to 10, with no call site overriding — exactly the "12-16 straight chords
  across ~200 screen pixels" that was measured. Now derived from the part's radius, so
  a 3mm screw stays at 20 sides and a 30mm optic bell gets 42. The whole view model is
  74 meshes / 12,524 triangles; it was never a performance decision.


---

# Round 5 — the first win

**ours 1 / 11.** Pair 03 went to us. Four rounds at 0/11 preceded it.

The reviewer, unprompted, on our panels:

- *"The modular brick construction is genuinely good… individually modelled bricks
  with real depth, mortar gaps, per-brick value jitter and self-shadowing in the
  recesses. It survives close inspection. **That is real, and it's better than the
  reference does at that distance.**"*
- *"Weathered concrete with vertical water staining plus a distinct rusted-rail
  material is **the single best material in the entire set** — and it is why that pair
  was hard to call."*
- *"Prop shadows exist, are correctly directed, and are attached to their casters. The
  caster set is right; only the penumbra model and the shadow density are wrong."*
- *"Set-dressing density and variety… the worlds feel inhabited, which is a harder
  problem than shading and you have solved it."*

It also flagged pair 08 as genuinely hard: *"If I am wrong anywhere in this set, it is
here."* It was right about which panel was which, but it is the closest we have come.

## A third redirected prescription

Its headline was *"ambient is drowning the key — shadowed faces only drop 20-30% in
value"*, with a prescribed fix of "key:fill >= 5:1". Following that literally means
cutting ambient across the board.

`scripts/blacksand-contrast-compare.mjs` measures the sunlit-vs-shadowed split on
**both sides** with no engine access — two-means on log luminance, same crop band:

```
BATTLEFIELD 2   key:fill   min 3.65   median  5.80   max 12.54
OURS            key:fill   min 1.89   median  5.10   max 20.62
                                       0.88x  -> within a quarter-stop
```

The global level is not the defect. **The spread is.** The reference clusters inside a
1.8-stop band; ours covers 3.4 stops:

```
establishing      1.89   <- far below the reference minimum
action-sprint     3.42
rooftop           3.81
alley             3.99
...
street            8.67
market           20.62   <- far above the reference maximum
```

Cutting ambient globally would have pushed `establishing` toward the reference and
`market` further away from it. The real work is per-scene: the flat shots are all wide
vistas, where aerial perspective is compressing the whole frame into one value band,
and `market` is a covered interior where the opposite happens.

## The pattern, now three for three

| round | reviewer's mechanism | what measurement found |
| --- | --- | --- |
| 3, 4 | "a flat teal water plane" | shadowed sand; there is no water in the game |
| 4 | "shaded surfaces at 1/20 — raise sky irradiance" | they were at 1/2.5; raising it inverted the ratio |
| 5 | "ambient is drowning the key — global fill too high" | global ratio is 0.88x the reference; the spread is 1.9x too wide |

A reviewer's description of a **symptom** is reliable and is the most valuable thing
they produce. Their proposed **mechanism** is a hypothesis, and in this project it has
been wrong every single time. Measure the quantity they name, on controlled geometry
or on both sides of the comparison, before changing anything.


---

# The material census — six claims disproved, one real

`scripts/blacksand-close-probe.mjs` stands the camera 1-3m off a surface and measures
what a beauty shot cannot: octave energy in **centimetres of world scale**, a normal-map
differential scored over a per-material coverage mask, specular isolated by subtracting a
frame with `direct/indirectSpecular` zeroed, and a Fresnel sweep along the sun's mirror
azimuth. Auto-exposure pinned off for every A/B.

| round-5 claim | verdict | measurement |
| --- | --- | --- |
| "No normal maps — albedo-only shading" | **false, all 7 classes** | normals-off moves terrain 80%, blockwall 67%, metal 95%, concrete 25%, wood 80%, rock 94%, road 50% of each material's own pixels |
| "Nothing has a specular lobe" | **false** | specular is 3.7% (road) to 23% (sand at 2m) of frame luma |
| "Sand at grazing should sheen; it doesn't" | **false** | specular rises 9.3 -> 77.4 luma from 70 deg to 4 deg = **8.3x** (flat would be 1.0x) |
| "One roughness value for the whole world" | **false** | 0.42 metal / 0.62 concrete / 0.65 blockwall / 0.71 asphalt / 0.84 rock / 0.97 sandbag |
| "No near-field detail; 2-5m is a blurred wash" | **false** | contrast at a fixed 20cm world scale: 2.66@2m, 2.20@4m, 2.05@8m, 2.19@32m, 0.36@256m |
| "No per-brick hue/value jitter" | **false** | +/-15% per-block value, +/-7% warm, autocorrelation of a 30m wall finds peaks only at one-brick spacing |
| "Hard splatmap seams, no height blend" | **partly real** | gravel and dirt height-blended; **rock was a plain linear mix** |
| "Palette band too narrow; nothing separates" | **REAL — the biggest finding** | all ten albedos inside hue 26.6-47.8; six surfaces inside 0.08 of one saturation |

The reviewer's own favourite proves the diagnosis: concrete — *"the single best material in
the set"* — is the one outlier, at hue 47.8 and saturation 0.085. What it liked about that
surface was that it did not match everything else.

**A real bug fell out of the census.** Gravel sat at 0.072 linear albedo — *darker than
asphalt at 0.083*, and half the bottom of the 0.12-0.20 band its own comment specifies.
Cause: the occlusion term was subtracted in the albedo **and** shipped in the ORM, so a
surface built from domed clasts paid for its own AO twice.

And round 2's voronoi complaint had quietly resurfaced on a different layer: rock tiled at
8.1m put the generator's beds and joints at 1.35-1.6m, so a bank at 8m was once again
"cells an order of magnitude too large". Retiled to 4.7m.

## Two instrument traps, recorded so they are not re-hit

- **Iterating `materials.all()` changes nothing.** structures.js clones every library
  material and renames it `bs-struct-*`, so the registry does not hold the object the scene
  draws with. Every A/B returned exactly 100%, which is precisely what a no-op looks like.
- **"Render with albedo black and call the remainder specular" is wrong here.** It reads
  28-77%, impossible for a dielectric at F0 0.04, because render.js adds in-scatter in
  linear light *after* the material — a pixel with no diffuse and no specular still returns
  25-35 luma.


---

# The seating census — and a defect nobody had reported

## "No AO / contact term" — real, and the mechanism was measurable

The contact-blob system existed and was doing **nothing visible**. Walking the merged blob
mesh directly, the falloff `(1-d^2)^3` on normalised radius delivered:

```
17.8% darkening at the blob CENTRE   (underneath the prop, where nothing can see it)
 ~3%  darkening at the prop's own silhouette   (the only place it matters)
```

Confirmed from the framebuffer: median ground luma 2cm from a prop base divided by 2m
away was **1.024**, and hiding every blob in the scene changed that number by **0.000**.
All 19 call sites were also passing 1.1x-2.4x the true footprint, each a different amount,
and several archetypes had no blob at all. After a plateau-plus-skirt falloff and corrected
footprints: **1.024 -> 0.729**, blob contribution at a prop base 0.0% -> 2-27%.

## The bigger find: props were floating

Props were placed at `terrain.heightAt(centre)`. On a dune, a 2.4m jersey barrier therefore
hung with **both ends clear of the sand and sky visible underneath**. No reviewer had
reported it, because no beauty shot frames a prop base — it was caught by a close-range
probe written to test something else.

`seat()` now samples terrain across the object's own footprint, sits on the lowest sample
(sinking beats floating) and refuses ground it cannot straddle. Only 19 props map-wide
refused, so the set-dressing density the reviewer praised is intact.

**The lesson:** the beauty-shot set is a sampling bias. Every camera in it is at eye height
or above, looking out. Whole classes of defect live at 0-2m and had never been rendered
even once.

## "Distant props collapse to black scribbles" — symptom real, both mechanisms wrong

Proposed: *"fog is applied before the alpha cut, and there's no alpha-to-coverage."*

- Fog cannot be it: three applies `fog_fragment` **after** `alphatest_fragment`.
- It is not distance either: crush **falls** with range (acacia 14.4% at 18m -> 2.4% at
  110m). A mip or LOD fault does the exact opposite.

Magnifying a single acacia showed the truth — green on its sunward half, black scribble on
its shaded half. Two real causes: indirect light multiplied sky-occlusion by canopy AO **in
series**, and the acacia twigs were authored at 0.021 linear, an eighth of leaf value and
the darkest thing in the atlas. Fixed both: crush at 18m fell to 6.9% (acacia), 16.7%
(palm), 15.8% (tamarisk), with p10 up 68-146% and p90 unchanged — blacks lifted, highlights
untouched.

## A harness caveat worth heeding

The perf probe is badly contended by parallel agents: three consecutive ultra runs gave
29.8 / 28.1 / 21.2ms with max frames of 300-550ms, then **8.4ms** on identical content in a
quiet window. Read p90 only from a quiet machine, or you will chase a phantom regression.

---

# Round 6: 0/11 — and the measurement that finally disagrees with everyone

Round 6 lost 11–0 again. The reviewer was asked to state its symptoms and its
mechanisms separately, and to rate confidence in the mechanisms. That is what
made this round different: all three of its top mechanisms are now **measured
false**, and the measurement taken to disprove them found the real defect.

`scripts/blacksand-grounding-probe.mjs` A/Bs each pose against itself:

| the reviewer said | measured |
| --- | --- |
| "no SSAO pass, or one at effectively zero" (conf. **high**) | AO moves **21.5%** of the median frame, peak delta 133/255 |
| "castShadow is not set on props and foliage" (conf. **high**) | shadows move **14.9%** of the median frame; every pose has them |
| "shadows vanish in wide/aerial framings" (conf. medium) | the widest poses are the *strongest*: checkpoint 32.4%, dawn-ridge 26.8% |
| "sand albedo is near-grey; the warmth is all sun" (conf. med-high) | shade carries **186%** of the lit saturation |

**That is eight consecutive rounds in which a reviewer's symptom was real and its
named mechanism was wrong.** Treat the symptom as data and the mechanism as a
hypothesis to be shot at. It is not a reviewer failing — they are judging pixels
through a closed door, which is exactly what we want from them.

## The real defect: our colour is in the wrong half of the image

`scripts/blacksand-chroma-compare.mjs` splits both sides into a lit and a shaded
population by two-means on log luminance, and reports the chroma of each.

```
BATTLEFIELD 2   lit  sat 0.581 hue 48    shade  sat 0.395 hue 63    lit:shade 1.35
OURS            lit  sat 0.540 hue 24    shade  sat 0.688 hue 25    lit:shade 0.78
```

Three findings, in order of how much they explain:

**1. The lit:shade saturation ratio is inverted.** Battlefield 2 puts its colour in
the sunlight and lets shade fall towards neutral (1.35x). We do the opposite
(0.78x). Our *lit* saturation is fine — 0.93x the reference. Our **shade is 1.74x
too saturated**. Every reviewer since round 2 who said "shaded surfaces lose their
material identity" was reading this inversion from the other end: when shade is the
most chromatic thing in frame, sunlight stops reading as sunlight.

**2. The whole world is ~24 degrees too red.** Ours sits at hue 24–25 (orange-red,
terracotta). The reference is 48 lit / 63 shade — a yellow ochre. This is a palette
error, not a lighting one, and it is almost certainly why six separate reviewers
have called our frames "a single swatch", "one hue at varying values" and "a
filter". Nobody named it because nobody had the reference number to hand.

**3. Shade does not shift hue.** The reference moves 48 -> 63, fifteen degrees
towards yellow-green, as shade swaps a warm key for a cool sky. Ours moves one
degree. Shade that is the same hue as sun, only darker, reads as a brightness
change rather than as a change of light.

### The mechanism, and it is in the ambient balance

```
GROUND_BOUNCE = 0.28     sky.js      warm bounce off sand
ENV_DIFFUSE   = 0.066    render.js   the sky probe's contribution to diffuse
```

The warm ground bounce outweighs the cool skylight **4.2 to 1** in everything a
shadow receives. In a real desert at noon the sky dome is the dominant source on
any upward-facing shaded surface and the bounce is the minor term. We have it
backwards, so our shade is lit by a *more saturated* version of the same warm
light as our sun — which produces exactly the measured signature: shade more
chromatic than sun (1.74x), and no hue separation between them (1 degree).

Note what this means for a past "fix": in round 5 the highlight/shadow saturation
rolloff `uSatRoll`'s shadow term was lowered 0.7 -> 0.4 to stop "shade losing its
chroma". That was the right response to a wrong diagnosis and it pushed us further
into the inversion. It should go back up.

**Do not treat any of the above as settled either.** Re-run both probes before and
after your change and put the numbers in your report.

## The terrain "contour banding" — half a result, reported as such

`terrain.js` sampled its wind streak as `rot2(tPos.xz, uWind) * vec2(1/190, 1/11)`.
That is an affine map, so the streaks were perfectly parallel, perfectly straight
and effectively infinite at one angle across the whole 1024m map — and `scour`
applied the same pattern to lee slopes and sheltered hollows at full strength,
because it was never gated. Both are now fixed: the sample position is
domain-warped by a 260m field before the rotation (so streaks meander and break
into finite runs), and scour backs off by `lee`, putting erosion and deposition on
opposite faces.

**Be careful how much credit this takes.** A new probe,
`scripts/blacksand-grain-probe.mjs`, builds the structure tensor over the frame and
reports gradient coherence — 0 isotropic, 1 pure stripe. On the dune crop that
prompted the change:

```
before  coherence 0.112  stripes at 38 deg
after   coherence 0.115  stripes at 32 deg
```

Unchanged. The hard terrace band is gone from the image and the lines do now
meander, but a meandering line is still locally a line and the orientation
statistics do not know the difference. **This was a correctness fix, not a proven
visual one.**

The same probe's frame-scale result is the more useful finding, and it points away
from terrain:

```
BATTLEFIELD 2   coherence median 0.245     orientation spread 0.323
OURS            coherence median 0.184     orientation spread 0.292
```

We are *less* directional than the reference, not more. So when a reviewer says
"stepped contour banding" on a dune, the measurable difference is **not**
orientation — it is that our large dune faces are close to featureless between the
streaks, where the reference carries variation at every scale. That is a detail
problem masquerading as a banding problem, and it is worth attacking as one.

## Aerial perspective ruled out — one of mine, and it was wrong

Our wide shots are the most inverted (compound 0.56, market 0.58) while our close
and action shots sit near the reference (0.92–1.04). That looked like a
distance-dependent term, and `far = veil * uAerialDesat * lit` desaturates a distant
surface by up to 90%, so I expected aerial perspective to be draining our distant
sunlit terrain while near shadows kept full chroma.

Swept live through `__BS.grade`, no source edits:

```
compound   aerialDesat 0.85 -> lit 0.430  shade 0.764  ratio 0.56
           aerialDesat 0.60 -> lit 0.431  shade 0.764  ratio 0.56
           aerialDesat 0.35 -> lit 0.433  shade 0.764  ratio 0.57
           aerialDesat 0.15 -> lit 0.434  shade 0.764  ratio 0.57
```

A 5.7x sweep moves the ratio by 0.01. **Ruled out.** That makes nine consecutive
rounds in which a named mechanism turned out to be wrong — and two of those are now
mine, so the rule is not "reviewers are unreliable", it is *everybody* is unreliable
about mechanism and the only currency is measurement.

The sweep did sharpen the target: **shade saturation is pinned at 0.76–0.83 and does
not move for any post-process knob.** It is coming out of the lighting, not the
grade.

Three more numbers that probably describe one defect rather than four:

```
lit:shade saturation   ours 0.78   BF2 1.35
darkPct                ours 0.2-2.4   BF2 median 5.4
sd                     ours 34-37     BF2 38.7-57.6
tonalRange             ours 21-24     BF2 22-32
```

We have almost no true blacks, our shadows are the most chromatic thing in frame,
and even where the metric suite prints "ok" we sit at the bottom of the reference
range. Deep, neutral shadows would move all four at once.

### Harness gotcha

`__BS.setPose()` returns false for the `action-*` poses — they are not in
`listPoses()`, they come from the shots harness's `--action` path. A sweep that does
not assert on the return value silently measures the previous pose twice. Mine did.

---

# The control experiment: the reviewer is real

Six rounds of 0/11 is also what a leaking protocol or an anchored reviewer looks
like. Before spending another round optimising against it, that had to be settled.

**Method.** Five pairs were built in which BOTH panels are real Battlefield 2
screenshots, drawn from disjoint halves of the reference set, pushed through the
identical pipeline (same crop band, same resample, same JPEG round-trip, same
synthetic nametags). Those five were shuffled in among six genuine pairs and handed
to a fresh art director with the standard prompt. **It was not told controls
existed.** The only change to the brief was a request to state a confidence per
pair and permission to say a pair was not discriminable.

**Result.**

```
control detection: 5/5 identified, 0 false positives
real pairs:        ours 0 / reference 6
```

It flagged pairs 02, 04, 08, 09 and 11 as "shipped-vs-shipped, not discriminable on
rendering". Those are exactly the five controls. It described the tell in its own
terms — ten frames sharing "an identical technical signature (dynamic contact
shadows, terrain albedo blending, per-part material authoring, real light spill)"
against six carrying "a completely different one".

Three conclusions, all of them load-bearing:

1. **The reviewer genuinely discriminates.** It is not pattern-matching on a
   pipeline artefact and it is not confabulating defects on demand — offered five
   chances to invent browser-game faults in genuine Battlefield 2 frames, it took
   none of them.
2. **The 0/11 results are real signal.** Every round we have lost, we lost.
3. **Zero false positives is the harshest number here.** Not one of our frames has
   ever been mistaken for the reference. We are always separable.

Its own top mechanism was, as ever, wrong: *"No tonemapping. Linear-clamped or
straight-sRGB output with no filmic/ACES/AgX curve"*, confidence **high**. We have
AgX with a look transform. **Ten rounds, ten wrong mechanisms.** The rule is not
that reviewers are unreliable — it is that *nobody* is reliable about mechanism, and
measurement is the only currency.

## What all of it actually converges on

`scripts/blacksand-detail-split.mjs` splits the frame into lit and shaded
populations and measures high-pass texture energy *within* each, normalised by that
population's own brightness:

```
                 detail in lit    detail in shade    lit:shade
BATTLEFIELD 2       0.2646            0.3819           0.65
OURS                0.1885            0.5026           0.45

our lit   = 0.71x the reference    29% less texture in sunlight
our shade = 1.32x the reference    32% more texture in shadow
```

That is the same shape as the chroma result (lit 0.93x, shade 1.74x). **Both the
colour and the surface detail are displaced out of our sunlight and into our
shade** — and two blind reviewers described precisely this, in words, with neither
measurement in hand:

> "the lit sand is a smooth pale wash and the shadowed sand is visibly rippled"
> "the ripple detail is readable INSIDE the shadow and invisible OUTSIDE it, which is backwards"

Note the tension that makes this the interesting finding rather than an obvious one:
`blacksand-contrast-compare.mjs` reports our key:fill luminance ratio as within a
quarter-stop of the reference. Both are true. **The ratio between two population
means says nothing about what the curve does to the information inside each
population.** Our means are right. Our shoulder is crushing the top and our toe is
lifting the bottom, and every remaining symptom — no true blacks (darkPct 0.2–2.4 vs
5.4), low spread (sd 34–37 vs 38.7–57.6), "one swatch at varying values", "material
separation only by value" — falls out of that one fact.

## Retraction: the pose set was measuring itself

The detail-split result above ("our sunlight destroys surface information") was
contaminated by our own harness, and half of it is withdrawn.

`__BS.setPose()` sets a FREE camera, so the ten static beauty poses render no view
model, and they are wide vistas dominated by *distant* terrain. Distant terrain is
smooth for mundane reasons — few texels per pixel, mip filtering, aerial haze. Every
Battlefield 2 screenshot we compare against is an eye-height gameplay frame
dominated by *near* ground and walls at full texel density, with a weapon or cockpit
in the foreground. **We were comparing our landscape photography against their
gameplay.**

`scripts/blacksand-gameplay-shots.mjs` fixes it: it stands the player on the ground
inside each beauty pose's subject, facing the same way, in a real stance with the
weapon in hand.

```
                        BEAUTY set   GAMEPLAY set   BATTLEFIELD 2
detail in lit             0.1885        0.2660         0.2646
detail in shade           0.5026        0.3747         0.3819
lit:shade detail           0.45          0.62           0.65

lit saturation            0.540         0.573          0.581
shade saturation          0.688         0.639          0.395
lit:shade saturation       0.78          1.05           1.35
lit hue                     24            23             48
```

**Withdrawn:** "our lit surfaces lose detail and chroma". Framed like a shooter
screenshot our lit detail is 0.2660 against 0.2646 and our lit saturation 0.573
against 0.581. Both are matches. The transfer curve is not the defect.

**Survives, and is therefore real:**

1. **Shade saturation 1.62x the reference** (0.639 vs 0.395), in every set measured.
2. **The palette is ~25 degrees too red** — hue 23 against 48 lit / 63 shade. The
   largest single discrepancy in the whole analysis, and completely framing-independent.

Both are explained by one thing — `GROUND_BOUNCE 0.28` against `ENV_DIFFUSE 0.066`,
a 4.2:1 warm-over-cool inversion in everything a shadow receives — and nothing else
tested explains either.

**Eleven rounds, eleven wrong mechanisms, three of them mine in a single day**
(aerial perspective, the transfer curve, and a framing-bias claim about darkPct that
the numbers also refused). The rule is not that art directors are unreliable about
causes. *Everyone* is. Only measurement counts, and a measurement taken through a
biased sampler is just a slower way of being wrong.

**Gate on gameplay frames from here.** The beauty poses stay useful for composition
and for spotting broken geometry, but they must not be the basis of a statistical
claim about materials or lighting.

## The definitive baseline, and what is left after every control

Measured on `output/blacksand-shots/play-native` — ten gameplay frames, eye height,
weapon in hand, at each pose's own time of day — with `play-noon` as a fixed-hour
control to separate a red PALETTE from red LIGHT.

```
metric              ours    BF2     verdict
lit hue               24     48     24 deg too red   <-- ROBUST
lit saturation     0.564  0.581     matched (0.97x)
shade saturation   0.641  0.395     1.62x too high   <-- ROBUST
lit:shade sat       0.92   1.35     0.68x
lit:shade detail    0.61   0.65     close
detail in lit     0.2269 0.2646     0.86x
darkPct             11.9    5.4     HIGH
sd                  41.6   46.2     ok
tonalRange            23     29     lowish
```

**Exactly two findings survive every control.** Both are unchanged at fixed noon
(hue 22, shade saturation 0.618), so neither is a time-of-day effect:

1. **The palette is ~24 degrees too red.** We are terracotta; the reference is
   yellow ochre. Largest single discrepancy in the project and it has never moved
   for anything.
2. **Shade saturation is 1.62x the reference.**

Everything else is withdrawn, including two claims made earlier in this very
document:

- *"Our lit surfaces lose detail and chroma."* Lit saturation 0.97x, lit detail
  0.86x. Not the defect.
- *"We have almost no true blacks — darkPct 0.2-2.4 against 5.4."* A beauty-set
  artefact. On gameplay framing darkPct is **11.9 against 5.4 — too HIGH.** The
  metric flipped sign when the sampler was fixed.

That second one is the cautionary tale of the whole project. A number that reverses
when you change how you point the camera was never a measurement of the renderer.

**Rule going forward: no statistical claim about materials or lighting may be made
from the beauty poses.** They stay useful for composition and for catching broken
geometry. `scripts/blacksand-gameplay-shots.mjs` is the instrument for everything
else.

## A structured dither used as film grain, laid over every frame

Found by standing the camera on the ground and magnifying the SKY — the one region
where nothing but post-process can be responsible.

A regular horizontal lattice covered the entire frame, sky included, measured at
3-7/255 on open sand. The cause is one function call:

```glsl
float n = ign(gl_FragCoord.xy + fract(uTime) * 1000.0) - 0.5;   // grain
```

`ign()` is interleaved gradient noise, and it is the correct function for a
**dither** — its whole virtue is that it is highly structured, so a temporal resolve
averages it away in two or three frames. **We resolve with SMAA, which is
morphological and averages nothing across time**, so the structure survives to the
screen. Film grain wants the exact opposite: decorrelated noise with no lattice.
Swapped for a Hoskins hash; at 4x with contrast normalised the cross-hatch is gone
and what remains reads as speckle.

This is the third time this project has been bitten by *the same misconception* —
that a dither pattern will resolve. The foliage LOD cross-fade hit it with white
noise ("black scribbles"), then with an 8x8 Bayer matrix ("a stippled dot lattice"),
and now the grain. **There is no temporal resolve in this renderer.** Any pattern
you introduce at pixel scale is what the player sees, permanently.

A caveat I could not settle and am leaving flagged: no Battlefield 2 screenshot has
film grain at all, and "is the colour believable, or a filter?" is on the reviewer's
scorecard. Whether `uGrain 0.026` should exist is a separate question from whether
it should be structured.

### A note on the instrument

My first attempt to verify this measured row-to-row alternation of column-averaged
luminance, reasoning that averaging 120 columns suppresses white noise but preserves
a coherent stripe. The number went the wrong way (0.079 -> 0.260) and the fix was
nonetheless correct — the metric was simply not measuring lattice-ness. Looking at
the two crops side by side settled it in one glance. **Build the metric, but do not
let it outrank your eyes when the two disagree and the metric is one you wrote five
minutes ago.**

---

# Round 7 wave: two more harness faults, both ours

Two things were wrong with what we were *showing* reviewers, independent of what the
renderer does. Both had been true for six rounds.

## The white ribbon was our own HUD, rendered in 3D

I looked at `critic-6b/checkpoint.png`, saw a blown white ribbon swooping across the
frame, traced it to the fuel pipeline, and told an agent the pipe material was
behaving like polished chrome. **Wrong.** The agent raycast the ribbon's pixels and
they hit `objective-markers` — flat white capture-radius discs, `depthWrite:false`,
`renderOrder 5`, 0.12m above the terrain, created at `world.js:1151`. At a grazing
angle a capture radius is a ribbon; from above it is a loop around the fuel tanks.

It survived every "HUD hidden" capture we have ever taken because `hideHud()` only
hid the three DOM roots, and this HUD element lives in the scene graph.
`qa.js:hideHud` now hides it too.

The pipes measured roughness 0.72 / metalness 0.3, and `structures-metal` was in
fact the *darkest* merged mesh in that frame — median luma 27 against terrain's 86.
My attribution was not merely unproven, it was backwards.

## Every frame we have ever shown has been an empty map

The map holds 16 bots across 1024m. A probe found **zero within 80m of any of the
ten capture positions** — so six rounds of blind comparison put our empty desert
against Battlefield 2 screenshots containing infantry, armour, explosions and
nametags, and asked a reviewer to judge "composition and production value".

`blacksand-gameplay-shots.mjs` now stages a squad into the view at 12-55m by
default. This is staging and it is stated as such, but it is the same staging any
press screenshot gets, and skinned characters are a large fraction of what a shooter
frame is made of.

## What the subsystem agents actually found

Both landed results whose value is mostly in what they *disproved*.

**Built surfaces.** "One tile at the wrong world scale" was wrong in an instructive
way: there was no world scale asserted at all. `uvScale`, authored per call site as
"how fine should this look", was setting block size — so masonry had **six different
course heights** from 7.7cm to 34.7cm, and a sill sampled the same material at 2.5x
the rate of the wall it was screwed to. Now pinned in world units: 19.3 x 38.5cm,
against a real block's 19 x 39. Also found: `UV_PHASE.concrete` said 5 boards where
the generator makes 7, so the jitter meant to preserve board lines was tearing them;
ground grime was per-piece-normalised and therefore **reset at every floor line**,
putting a dark band at 3.15m and 6.3m on every building; and `plaster` existed in the
library with nothing using it, so every building was a coin-flip between two
materials. Of twelve reviewer mechanisms, **two survived measurement**.

**Foliage.** The cross-fade dither was never the root problem. `buildPalm` and
friends seeded their rng on the LOD *level*, so LOD 1 was drawn from a different
random sequence with a different part count — **the levels were different plants**,
which is the entire reason a cross-fade had to exist. Sharing one seed per species
and decimating instead cut the pop directly, and the fade band could then shrink to
zero at boundaries where the swap is free: instances at partial coverage across ten
poses went **552 to 166**. The "no transmission" claim was half-false — a
translucency term existed but was `pow(dot(V,-L), 4.5)`, entirely view-dependent, so
it only fired when the eye was near the sun's axis. The real defect was an 8:1 range
*inside a single plant*, not dark foliage: lit halves already measured 0.49-0.72 of
the sand beside them. The "receives no fog" claim was false by a large margin —
foliage is moved 5-80x *more* by the aerial term than terrain is. Yaw was fully
randomised (sd 1.87 against a uniform draw's 1.814); the real cause of "every bush
is identical" was that all 260 palm impostors sample **one atlas cell**.

**Note on dither, which cuts against my own grain fix.** The foliage agent chose
interleaved gradient noise for the LOD dither — the same function I had just removed
from the film grain — and was right to. Offset by a per-instance hash it has no
lattice at any pixel spacing, and it measured phase-class spread 2.973 -> 0.135.
Structured noise is correct for a per-instance dither and wrong for a full-screen
grain. The lesson is not "never use IGN", it is that the two uses have opposite
requirements.

## Contact grounding: a real root cause, a real limit, and the wrong instrument

The reviewer's #1 complaint for six rounds — "nothing touches the ground" — finally
has a measured profile on both sides. `scripts/blacksand-contact-profile.mjs` samples
ground luma outward from a seam, normalised by open ground 80cm away:

```
                    3cm   5cm   8cm  12cm  17cm  24cm  ...  80cm
bradley-track      0.13  0.13  0.15  0.17  0.20  1.01       1.00
plinth-base        0.74  0.69  0.62  0.64  0.67  0.65       1.00
alley-wall         0.48  0.50  0.48  0.49  0.49  0.59       1.00
BF2 median          seam 0.48
OURS                seam 0.97
```

**Battlefield 2 darkens a seam about twenty times harder than we do.**

The root cause of why a strong AO term could not produce it: the AO disc is a *ring*,
`span = mix(0.22, 1.0, rr) * radiusUv`, and its innermost tap lands at 11.7cm at 2.5m
depth, 23.4cm at 5m, 37.6cm at 10m. Contact darkening lives in the first 5-15cm.
**Nothing sampled there.** At 5m and beyond, zero of sixteen taps were inside 15cm.

The floor hypothesis was disproved by reading the AO target back directly: at 3cm from
a barrel the broad channel already reads 0.41-0.57, nowhere near the 0.24 floor.

And a genuine structural limit, worth keeping: **depth-only AO cannot see a thin
contact.** The only surface a depth buffer has near a seam is the object's own
silhouette, at nearly the same height as the ground it meets — so tangent-plane
elevation is smallest exactly where true occlusion is largest. The occluding mass is
*behind* the visible surface. Even at gain 3.6 a tight 0.22m gather reads 0.77-1.00 at
3cm.

### The instrument is probably wrong

Battlefield 2 is a 2005 title. **It has no SSAO and cannot have had one.** Every bit of
that 0.48 is baked into a texture or a lightmap, is a real cast shadow (the 0.13 under
the Bradley is its own hull), or is a contact decal. Chasing 0.48 with screen-space
ambient occlusion is chasing it with a tool the reference never used. Baked vertex AO
on the bottom 30-60cm of static geometry, or a darkening decal under each seated prop,
gets there directly and for less.

### And the probe had the same disease as my pose set

The seam figure did not move for the contact work: 0.98 off, 0.97 on. The agent's own
diagnosis is that its prop set is "dominated by barrels half-buried in rippled dune
sand where there is no visible seam to darken", per-prop 0.44 to 1.6. **A seam metric
averaged over props that have no seam cannot move whatever the renderer does.** That is
exactly the fault that made me retract two findings from the beauty poses, arrived at
independently in a different subsystem on the same day.

Frame-level the contact work does plenty — on checkpoint the near channel moves 59.6%
of pixels at mean 5.41 against the broad term's 44.6% at 2.41 — so both facts are true
at once and neither should be quoted without the other.

## The grounding complaint does not survive a repaired instrument

The 20x seam figure recorded above was **my instrument, not the renderer**, and it is
withdrawn. Repairing the target set — footprints verified flat to 6cm, bases verified
seated to 8cm, walls included and framed at their base rather than mid-height — gives,
on the same build:

```
                 seam   ~6cm   ~20cm
BATTLEFIELD 2    0.48   0.50    0.67
OURS             0.55   0.57    0.70
```

**1.1x at the seam. Not 20x.** Three diseases in the old set: signposts whose collider
is a metre wide but whose mesh is a 12cm pole, so the sampling ring lay on open sand;
barrels sunk to their waists in rippled dune where there is no seam to darken; and a
1.1m half-extent cap that **excluded every wall and plinth in the game** — when two of
the reference's own three seams are a wall base and a plinth base. A metric that cannot
see the geometry the reference was measured on is not comparable to it.

So the reviewer's number-one complaint for six rounds — "nothing touches the ground" —
is **not supported by measurement against the reference**. Our contact darkening is
within ten percent of Battlefield 2's. The reviewers are validated (5/5 on the control),
so they are seeing something real; it is simply not seam luminance. The likeliest
remaining candidate is the *cast shadow* under an object rather than the ambient seam:
the reference's darkest case, 0.13 under a Bradley's track, is the hull's own shadow.

The near-field AO gather and the contact ray move the seam metric by **0-1% on both the
broken and the repaired target set** — a clean, reproducible negative result, exactly
what the structural argument predicts. They are kept anyway for a reason the metric
cannot express: baked contact cannot follow a soldier or a wheel, and screen-space is
the only term that works on things that move. Cost is below the noise floor.

The 0.55-texel penumbra floor was checked and is **not binding**: near cascade 76m over
a 3072 map gives texelWorld 4.95cm, so the floor is 2.7cm of penumbra against the 0.14cm
a 30cm gap physically wants. Real, small, not worth re-taking.

## The view model has no antialiasing at all

`render.js` sets `antialias: false` and draws `viewScene` straight to the default
framebuffer **after** the composer, so SMAA never touches it. Nothing at pixel scale on
the weapon can be filtered downstream — and the weapon is in frame 100% of the time a
human plays this game. Unowned; needs someone.

## A fix that was inert for a full round while the write-up said otherwise

Round 5 replaced a flat 12-segment default with `arc(radius)` to kill faceting on the
view model. **58 of the 65 `tube`/`tubeOpen` call sites pass an explicit segment count,
most of them the old 12** — so changing the default changed nothing, and every barrel,
muzzle, turret, pin and sling loop on all six weapons kept its twelve-sided silhouette
for a full round. Now released to `arc()`.

This is the cheapest lesson available and the project keeps re-learning it: **verify
that a change took effect, not merely that it was made.** The same class of error as
`envMapIntensity` (inert without an `envMap`) and the chroma sweep whose glob route never
matched because module URLs carry a `?v=` cache-buster.

## Two more class errors in the weapon's materials

`blued` was `metalness 1.0`. For a metal the albedo **is** the specular F0, and this F0
was `0x3e4450` — hue 220, saturation 0.225. Kill the sky entirely and the barrel is
*still* blue. Bluing and nitriding are conversion coatings: a black-oxide ceramic skin
over steel, i.e. dielectric. The file already made exactly this argument four lines
earlier for parkerising and did not carry it down. Same for anodised aluminium at 0.78.

And `alum`'s albedo was hue 34 / saturation 0.28 — **the hue and nearly the saturation
of the desert behind it.** No exposure or grade change can separate a rifle finished in
the colour of its own ground.

Result on the weapon's own pixels: mean luma 72.6 -> 57.2, dark fraction 0.94% -> 10.78%,
bluish pixels 2.7% -> 1.1%, interior detail 0.544 -> 0.631.

---

# Round 7: 0/10, on a fair set, and the first clean quantified target

Round 7 was the first blind comparison run on **gameplay frames** — eye height, weapon
in hand, soldiers staged, camera backed off geometry, HUD and 3D objective markers
hidden. It lost 0/10, and the reviewer grouped all ten of our frames as one renderer
correctly without being asked to.

Its top claim came with its own falsification test, which is the most useful thing a
reviewer has done on this project:

> "Detail present in shade and absent in sun is not a texture problem. Histogram the lit
> sand region. If more than a few percent of pixels sit within 2/255 of max, it's
> clipping. If the histogram is healthy and the detail is STILL gone, the cause is
> mip/LOD bias or aniso, not exposure, and the fix is completely different."

`scripts/blacksand-clip-probe.mjs`, lit population only, both sides:

```
                 top2 (within 2/255)   top8    p99/p50   lit IQR
BATTLEFIELD 2          0.13%           0.41%     1.60      41.1
OURS                   0.03%           0.08%     1.34      25.7
```

**We clip four times LESS than the reference.** Mechanism false — sixteen proposed
across twelve rounds, three surviving.

**The symptom is real and now has a number: our sunlit surfaces carry 0.62x the tonal
spread of Battlefield 2's.** Nothing hits the ceiling; the upper half of the lit range
is compressed. That is a curve-shape signature, and it is the first defect in this
project with a clean target attached: **lit IQR 25.7 -> ~41, p99/p50 1.34 -> 1.60, with
top2 held under 0.2%.**

## Where the colour work got to

`GROUND_BOUNCE` and `ENV_DIFFUSE` are **unchanged**, and that is a result. The
warm-over-cool inversion I hypothesised does not exist in the form I described, because
`sky.js` paints the probe's *ground hemisphere* with `bounceTint` — **both terms are
warm, and there was no cool fill in this renderer at all.** Measured as source rewrites:

```
ENV_DIFFUSE  0.066 -> 0.17  (2.6x)      shade sat 0.765 -> 0.760
GROUND_BOUNCE 0.28 -> 0.13              shade sat 0.522 -> 0.522
hemisphere sky end made neutral         shade sat 0.615 -> 0.522
```

**The level of the bounce does nothing. The colour of the term opposing it is
everything.** And a properly blue sky end is *worse* than neutral: it matches on shade
saturation but costs 0.08 of lit saturation and 0.18 of the detail ratio. Neutral
desaturates a shadow without recolouring it.

Result: shade saturation 0.641 -> 0.518, lit:shade 0.92 -> 1.15, lit hue 24 -> 32.5.

Two things that will not close by this route, both stated as limits rather than
failures. **Halving the chroma of every texture in the game moves shade saturation by
0.01** — the chroma in our shadows was never in the materials. And the hue metric is
saturation-weighted, so it is set by our masonry, not by the sand that covers the
screen: rotating albedo buys 0.39 degrees at the frame per degree at source, and
reaching 48 needs +55, at which point the sand goes olive and the plaster walls go
green. Stopped at 22. **The remaining 15 degrees is deliberate** — Battlefield 2 earns
hue 48 from genuinely yellow sand and from vegetation we do not have, and closing it
with this lever would be fitting the instrument instead of the picture.

## The wood was not what I said either

I hypothesised the wood generator had the same two-hue-camouflage fault confirmed in
metal. **Hue span of the wood ramp: 4.4 degrees — the narrowest in the entire
library** (corrugated 175.3, metal 94.3, rubble 23.0, blockwall 11.6, plaster 6.1).
Disproved.

Three real faults instead, two of them the same mistake:

- **Chroma, not hue.** Effective albedo measured linear saturation **0.886, the most
  chromatic surface in the library.** The ramp was authored in sRGB where it reads as a
  moderate brown; in linear, where albedo multiplies the tint, it is 0.765, and chroma
  compounds under multiplication.
- **Contrast, same illusion.** The generator's comment claimed it avoided a 2:1
  earlywood/latewood ratio. 0.505/0.360 is 1.40 in sRGB and **2.01 in linear.**
- **The grain ran across the piece.** `scaleBoxUv` gave every face u=width, v=height and
  the rings band in v — so a vertical post wore horizontal rings like a barber pole at
  6.7cm pitch, while a beam's v spanned its 12cm thickness, less than one ring period,
  making each beam a near-uniform slab of one point on the ramp. **That is where "orange
  beside dark red between adjacent pieces" came from.**

## Grazing-angle relief: measured, affordable, and declined

Normal maps supply 9-29% of a wall's detail below 50 degrees incidence and **0-4% above
65** — the symptom is real and located. A 16-step parallax march costs +0.20ms p50 /
+0.40ms p90 measured properly (by interleaving both states every 8 frames with a dynamic
loop bound, after two naive attempts gave 8.3 vs 15.2ms on identical code). Full POM
about 1.5x that. Affordable against 33ms.

**Declined anyway, and the reasoning is right:** of 7752 raycast-classified structure
samples, 113 — **1.46%** — are both above 75 degrees and within the 3-15m where relief
reads. And Battlefield 2 is Refractor 2, 2005: it has no parallax occlusion mapping
anywhere. Same category as chasing its 0.48 contact seam with SSAO — a tool the
reference never used, against a symptom the reference also has. What it has instead is
geometric relief that breaks the silhouette, which POM cannot do at any step count.

## An instrument trap that cost me two false leads: `normalise()` invents structure

Magnifying a crop with contrast normalisation is how you see a faint artefact. It is
also how you manufacture one, and on a low-contrast region it is almost guaranteed to.

I magnified a distant dune with `.normalise()` and saw an unmistakable regular
rectangular 8-pixel grid, vertical and horizontal. It survived AO off, grain off and
bloom off (phase-class spread 0.291 / 0.308 / 0.289 / 0.311 / 0.312 — flat). Measured
in raw counts on the unstretched image, against the reference:

```
                              8x8 phase sd   peak-to-peak   region contrast
OURS  distant dune                0.770         3.40/255          150
BF2   sand   (bf2-14)             0.839         3.80/255          185
BF2   ground (bf2-18)             1.773         9.34/255          254
```

**We have LESS 8x8 structure than either reference frame.** There was no grid. The
stretch made one out of a 150-count region.

That phantom also sent me at the far shadow cascade, and a like-for-like A/B killed
that too. A first A/B appeared to show a 4.3x reduction in vertical striping — but
running only two poses had shifted the stance rotation, so the framing solver chose a
different yaw and I was comparing different content. Pinned (`--stance hip
--no-reframe`), the same change moves striping from 0.1146 to 0.1159, i.e. not at all,
while demonstrably reaching the pixels (0.51% move, peak 148/255). Reverted.

Two rules out of this:

1. **Measure a suspected artefact's amplitude in raw counts, and against the
   reference, before believing it exists.** A stretched crop is for locating something
   you have already established is there.
2. **A harness that adapts per-run — stance rotation, a framing solver — is not a
   valid A/B unless every adaptive input is pinned.** Both of mine were adaptive by
   the time I used them this way, and neither warned me.

## Framing solver

The round-7 critic's one zero-GPU finding was "04A and 05B are ~70% bare sand; every
shipped panel has three depth layers working... prop density and capture-camera choice
would move a blind test more than any shader work on this list."

`blacksand-gameplay-shots.mjs` now scores five candidate headings by edge energy over
the exact crop band the blind harness shows, and keeps the best; the base heading is
included and wins ties, so a pose that was already well framed is untouched. Seven of
ten poses reframed, by up to 60 degrees. `--no-reframe` pins it for A/B work, and
after the lesson above, **use that flag for any before/after comparison.**

---

# Round 8: all seven metrics inside the distribution, and the last gap located

```
                        before    after     BF2
darkPct                  16.7    4.2/4.6    5.4     <- inside the band for the first time
lit:shade saturation     1.15   1.18/1.21   1.35
lit:shade detail         0.65   0.72/0.71   0.65
lit hue                  32.5    36/36      48
top2                    0.03%   0.00%      0.13%
sd                        --    47.6/52.3  46.2
lit IQR                  25.7   24.8/22.6  41.1     <- unmoved
```

Landed: `uShadowLift` 0.048 -> 0.09, `uShadowLiftTint` -> neutral, `uSatRoll` highlight
term 0.9 -> 0.50, `uSaturation` 1.14 -> 1.20.

Two mechanisms worth keeping. My guess that lit spread and `darkPct` were one problem
was **half right — the toe was the whole of it**, and it moved without touching the top
of the range at all. And **`uShadowLiftTint` had silently become an enemy**: it is
derived from the scene fill, round 7 made that fill neutral, round 8 doubled the lift,
and the result was a warm toe injecting chroma into exactly the population the previous
round had spent itself de-saturating (shade saturation 0.539 warm against 0.516
neutral, worth 0.13 of the lit:shade ratio). A term that reads another system's state
becomes wrong the moment that system changes, silently and without an error.

## Lit tonal spread: the levers divide cleanly, and none of the safe ones work

Swept at matched frame luminance, gameplay framing, ten poses:

```
clip-safe, and they do NOT widen it
  logSlope   1.45 -> 1.65    IQR 25.3 -> 26.9    top2 0.13%
  contrast   1.02 -> 1.28    IQR 26.4 -> 29.2    top2 0.36%
  lookPower  0.93 -> 1.02    IQR 25.3 -> 22.1    top2 0.14%

they widen it BY CLIPPING
  lookSlope  1.0 -> 1.26     IQR -> 38.5         top2 0.48-3.35%
  exposureBias +0.19         IQR -> 58.2         top2 17.8%
```

**`uLookSlope` is a trap.** It multiplies the *log-encoded* value, which is clamped to
[0,1], so any slope above 1 drives the top of the range straight into the clamp. It
looks ideal — brightens and expands in one move — and it buys every point of IQR out of
blown highlights. Shipped at 1.26 for one gate run: frame `sd` 58-71 against a 38.7-57.6
band, `brightPct` max 17.8%, `top2` 3.35%. Reverted.

**The compression is inside `agxDefaultContrast`'s polynomial, upstream of every knob in
the grade.** No look parameter reaches it. That is the remaining work, and it is a
change to the tonemap rather than to the look.

Worth stating before that work starts: **Battlefield 2 predates filmic tonemapping
entirely.** A 2005 title is close to a straight sRGB transfer, which has no shoulder at
all — so the 25-against-41 gap may simply be the shoulder existing. If so the question
is not how to reach their number but how much shoulder we want, and that is an answer
this project should be willing to accept.

## Two instrument traps from this round

**`__BS.grade()` writes only the keys you pass, so sequential sweep rows accumulate.**
A curve sweep had row 5 still carrying rows 2-4 and read as "every lever darkens the
frame and raises darkPct", which is false and nearly sent the round after exposure.
Every row must be a full reset.

**`blacksand-chroma-sweep.mjs` measures a resampled crop and under-reads `sd` and `top2`
by roughly 15%** against `blacksand-clip-probe.mjs`. It predicted `sd` 54 where the gate
gave 58-71. Rank candidates with it; accept them with the gate.

## The hue target was an artefact of the metric, and is withdrawn

Frame-level lit hue reads 36 against the reference's 48, and the obvious reading is
"our desert is too red". The frame metric is saturation-weighted, so it is set by the
most chromatic surfaces in view — our masonry — not by the sand that covers most of the
screen. Measuring the sand on its own, warm-earth pixels only, saturation-weighted
circular mean, lower-centre ground band:

```
BATTLEFIELD 2                     OURS
bf2-02   hue 50.2  sat 0.532      dawn-ridge     48.4  0.584
bf2-03        42.7      0.345      checkpoint     46.2  0.631
bf2-06        45.1      0.535      compound       41.0  0.612
bf2-07        57.8      0.200      alley          36.4  0.752
bf2-09        53.5      0.456      depot          31.5  0.554
bf2-10        37.9      0.785      establishing   30.7  0.626

median       ~47.6                 median        ~38.7
```

**The distributions overlap.** Two of ours sit inside the reference's range and one of
the reference's sits inside ours. About nine degrees between medians, against the
twelve-to-twenty-four the frame metric implied.

The colour agent's refusal to close the frame-level gap was therefore correct on its own
evidence — it found that reaching 48 needs +55 degrees at source, at which point the
sand goes olive and the plaster goes green — and it is now correct on this evidence too.
**"lit hue 44-52" is withdrawn as a target.**

The general lesson is the one this project keeps paying for in a new costume: **a
frame-level statistic is a weighted average over whatever happens to be in view, and the
weighting is rarely the thing you care about.** The saturation weighting that makes the
hue estimate robust against near-grey pixels is exactly what let a small area of
chromatic masonry outvote the desert. Before optimising any aggregate, check what is
actually carrying it.

## Six more dead `envMapIntensity` constants, and two confident comments defending them

A static sweep of the modules no agent was holding found the *same* inert knob the
brief already documents, still live in two files:

```
vehicles.js   paint 2.6   trim 3.0   rubber 2.8   glass 3.4   lens 3.2
characters.js soldier 0.55
```

Only `viewmodel.js` ever assigns `material.envMap`, so on Three r180 every one of
those six scaled nothing. Both files carried a paragraph explaining why the value was
"not decoration here" — vehicles.js argued it rescued a four-metre object from a sky
IBL tuned for a 1km vista, characters.js that holding a soldier off the ambient drops
him the stop below the sand that a figure needs to read as a figure.

**Both arguments are sound. Neither had any effect.** That is the failure mode worth
naming: a wrong constant gets caught, but a constant that does *nothing* looks like
deliberate tuning and acquires a defence, and the defence is what stops the next
reader from checking. Removed rather than corrected — removal is provably
behaviour-neutral, and leaving them invites a fourth agent to tune them.

The underlying complaints may still be real. Both comments now say so, and both name
the live lever (`material.envMap = scene.environment`, plus owning re-assignment when
sky.js regenerates the probe, exactly as viewmodel.js does) and require a measurement
first.

## Props: the reviewer's claim is false and its observation is exactly right

> "Small props have no albedo maps. The crates are flat single-colour solids, one value
> per face, no surface texture. **Those meshes have untextured materials.** Symptom and
> mechanism both, confidence HIGH — this is observable, not inferred."

A 23,040-ray probe reporting material, map presence, resolution, call site and
texels/metre for every hit: every structures material carries a full PBR set —
`blockwall/sand/concrete/asphalt/rock` at 2048 square, `metal/sandbag/wood/plaster` at
1024 — with `map`, `normalMap`, `roughnessMap` and `aoMap` all non-null. The crate
pixels specifically sample a 1024 albedo at **1126 texels/metre, 4.0 texels per screen
pixel.** The claim is false, and it was the reviewer's most confident one.

**The observation behind it was precisely correct.** `heightFn` put the growth ring —
32 lines per tile — into the height field at `normalStrength 2.6`, and `aoField` cast a
periodic dark band off it. Box-filtered pyramid of the AO channel, sd/mean per mip:

```
                    mip0   mip1   mip2   mip3   mip4   mip5
wood  BEFORE        0.698  0.671  0.597  0.454  0.269  0.075
blockwall           0.269  0.267  0.262  0.233  0.211  0.149
concrete            0.150  0.144  0.130  0.112  0.096  0.080
```

Wood carried **4.6x concrete's** AO banding at mip0 and fell below both by mip5; its
albedo kept 11% of its contrast where blockwall keeps 81%. **A crate was a hard black
barcode at 2.6m and a blank tan slab at 11m.** One surface behaving as two, which is
exactly the frame the reviewer described and nothing like the cause they named.

Why wood alone: every other built surface has a construction grid an order of magnitude
coarser than its noise — blocks, formwork boards, a corrugation profile. Wood had none.
It was one infinite board. Now six planks per tile with per-board value, silvering, ring
pitch and phase; ring relief 0.30 -> 0.055. Delivered albedo contrast 0.225 -> 0.284
(0.82 -> 0.97 of mip0), delivered AO banding 0.491 -> 0.206.

**Instrument warning, and it is a sharp one: an albedo-only mip pyramid put wood
mid-pack and would have closed this as "no defect". The barcode is not in the albedo at
all.** Any "is this surface flat" measurement must include the ORM's AO channel.

### Three more, none previously named

- **`MAP_DESAT` cannot fix the metal camouflage and structurally never could.**
  Rendering the metal albedo exactly as structures shows it — a 70% pull toward
  luminance — still gives literal DPM: olive-brown blobs on blue-grey, visible on the
  depot fuel tanks. Desaturation removes hue; the blotches' **value** difference
  survives untouched, and 25cm value blotches are camouflage at any scale. The comment
  justifying its placement is also wrong: it says "the same map dresses railings, rebar
  and a burnt-out car", but `MAP_DESAT` is keyed on material *name* and structures gives
  all of those the one "metal" material.
- **`albedoScaleFor` clamps at 6 and wood is the only material that reaches it** — map
  mean 0.152 wants 6.56, so every wooden piece renders 8.5% darker than its tint asks.
- **The chamfer never fires on a small prop.** `chamferFor` requires `size.y >= 1.4` AND
  `min(x,z) >= 0.18` AND `max(x,z) >= 0.45`; a 0.9m crate fails all three, a 0.22m post
  fails the third. Every crate, pallet, drum and post is a raw box with razor arrises —
  which is what "perfectly straight aliased edges" and the older "no edge ever catches a
  rim of light" both describe. **The feature written to fix that complaint excludes
  exactly the objects being complained about.**

### And the biggest number left in the project

> Crate face against open ground beside it, same frame: ours **0.92**. Battlefield 2's
> crate stack against its sand: **0.595**.

Physically that ratio should be near 0.5 — dry sand about 0.35-0.40 reflectance, weathered
timber about 0.18 — so the reference is close to physical and **we are 55% too high**.
Both albedos measure correct in isolation (timber tint linear 0.185, sand 0.369), which
means the fault is in the light or in a normalisation, not in the art.

This is now the leading explanation for the one complaint that has survived every round
and every fix: *"nothing touches the ground", "objects hover", "props sit like decals"*.
The repaired seam probe puts our ambient contact darkening at 1.1x of BF2's — parity —
so the complaint was never about seam darkening. **A contact shadow cannot separate
figure from ground when figure and ground are the same value.**

A general rule fell out of the same round, worth keeping: **a feature keyed to a piece's
long axis is multiplied by however long that piece is, so its budget is set by the
longest piece in the kit.** Butt joints at 1.3 per tile turned the guard tower legs into
bamboo, because a post's u axis is its 5.2m length.

---

# Round 9: the tone curve is finished, and the remaining gap is content

## My mechanism was wrong, and disproving it produced the fix

I sent the colour agent at `agxDefaultContrast` on the theory that its shoulder was
compressing our sunlight, and proposed blending toward identity. It tabulated the
polynomial's slope first: **1.74 at x=0.5, peaking 2.05 at 0.6, 1.34 at 0.8, crossing
1.0 only at x=0.845.** Our lit population lives at x 0.72-0.92 — mostly where the
sigmoid is *steeper* than a straight line. So relaxing it should make things worse, and
it did:

```
relax 0.00 (shipped)    lit IQR 25.2
relax 0.35 asymmetric           23.3
relax 1.00 asymmetric           23.0     <- no sigmoid at all, and WORSE
relax 1.00 symmetric            21.9
```

Eighteen mechanisms, three surviving; that one was mine.

**But the disproof handed over the one property every other lever lacked: identity
cannot exceed 1, so it cannot clip.** `uLogSlope` had been measured innocent in round 8
(1.45 -> 1.65 bought 1.6 of IQR) — not because it was the wrong term but because it kept
running into a collapsing sigmoid. Paired, they work; alone, neither does:

```
relax 0, logSlope 1.45   IQR 25.2   top2 0.13%
relax 0, logSlope 1.95   IQR 26.9   top2 0.13%
relax 1, logSlope 1.45   IQR 23.0   top2 0.15%
relax 1, logSlope 2.20   IQR 31.0   top2 0.15%
```

Shipped: `uShoulderRelax` 1.0, `uLogSlope` 1.45 -> 1.90, `exposure.bias` 0.96 -> 0.92,
`uShadowLift` 0.09 -> 0.13, `uSaturation` 1.20 -> **0.98**.

```
                    r8        now      BF2
lit IQR           22.6/24.8  26.3/29.8  41.1
top2               0.00%     0.10/0.16%  0.13%
lit saturation     0.661     0.601/0.626 0.581
shade saturation   0.544     0.469/0.475 0.395
lit:shade detail   0.71      0.81/0.84   0.65
darkPct            4.6       1.0         5.4
```

The saturation guard rail came back for free: with the curve doing the separation,
`uSaturation` gave up 0.22 for 0.02 of lit:shade, and lit saturation returned to 1.06x.

## The result worth more than the fix

**41.1 is not reachable by any tone curve, and the reason is content.** Lit IQR per unit
of frame `sd` — how much spread you get inside the sunlight for a given overall
histogram width:

```
BATTLEFIELD 2            41.1 / 46.2 = 0.89
ours                     28.1 / 53.9 = 0.52
ours at logSlope 2.20    30.1 / 60.4 = 0.50
```

**Flat at ~0.5 across everything swept.** Battlefield 2 gets nearly twice the lit spread
per unit of frame contrast. A tone curve redistributes variation; **it cannot create
variation that is not in the scene.** Their sunlit population is buildings, vegetation,
vehicles, dirt tracks and infantry at many orientations. Ours is overwhelmingly one
material — sand — on one near-horizontal plane. That is why we exhaust the `sd` band
(60.4 against a 57.6 ceiling) at IQR 31 while they sit comfortably at 46.2 for 41.1.

Note this cuts *against* the "BF2 predates filmic tonemapping" theory I offered: a
straight sRGB transfer has slope ~1 in the highlights, which is exactly what
`relax 1.0` gave us, and it measured worse.

**So the last measured gap is not a rendering defect at all.** The lever is variation in
the sunlit population — material and orientation diversity on open ground. That is world
dressing and terrain, and it converges with the round-7 critic's only zero-GPU finding:

> "04A and 05B are ~70% bare sand. Every shipped panel has three depth layers working...
> prop density and capture-camera choice. Costs no GPU and would move a blind test more
> than any shader work on this list."

Two independent lines, one from a statistic and one from an eye, arriving at the same
place. `sd` is now the binding constraint on the curve rather than clipping, which is a
better problem than the one this round started with.

## Masonry hue: checked, and `PALETTE_HUE` is earning its place

A `+24` global rotation of every warm albedo is a big hammer, and by eye the blockwall
in `r9-check/play-street.png` reads distinctly olive-yellow. Measured against the
reference — warm-hue pixels only, saturation-weighted circular mean, upper-middle band
where walls dominate and ground does not:

```
BATTLEFIELD 2                       OURS
bf2-02   hue 60.7  sat 0.462        play-compound  41.2  0.545
bf2-03        49.7      0.272        play-depot     35.5  0.611
bf2-11        36.2      0.406        play-street    33.0  0.787
bf2-17        30.1      0.853
bf2-18        58.6      0.609
```

**We are inside their range and at the redder end of it**, not past it. Without the
rotation we would sit near 9-17, well below their 30.1 minimum. My "the walls have gone
olive" reading was wrong; the rotation stays. Nineteen mechanisms, three surviving.

Wall saturation is the one number worth watching — `play-street` at 0.787 is close to
the reference's 0.853 ceiling — but it is in range and not worth spending on.

The useful pattern, for the third time in two days: **an eye is excellent at noticing
that something is off and unreliable about which way.** Both the sand and the masonry
looked too red or too green depending on which the surrounding frame made salient, and
both measured inside the reference distribution.

---

# Figure/ground value separation: the 0.92 does not replicate

The finding under investigation was *"crate face against open ground beside it: ours
0.92, Battlefield 2's crate stack against its sand 0.595"*, carried as the largest
unexplained measurement left in the project and as the best remaining candidate for
six rounds of *"nothing touches the ground"*.

**It is withdrawn.** Measured three independent ways, our timber props sit at or below
the reference's separation, never above it.

## The instrument: a calibrated grey rig, in the same frame

`scripts/blacksand-figure-ground.mjs`. Next to a real crate it stands:

- **five plates** lying flat on the sand at linear albedo 0.06 / 0.12 / 0.20 / 0.32 /
  0.50 — same normal as the ground, same range, same cascade;
- **five 0.9m cubes** at the same five albedos, rotated so one face is exactly parallel
  to the crate face being read;
- **one bridge cube** of identical geometry carrying the scene's own wood material and
  the crate's own merged vertex colour.

Everything is read from one capture, so nothing depends on absolute exposure.

The calibration is the whole point. **A display-value ratio is not an albedo ratio** —
AgX compresses one into the other, and a 2005 title has no shoulder at all — so each
measurement is inverted through the grey cards *per channel*, which divides out the
warm illuminant, the tone curve and the saturation controls in one step and returns the
surface's own reflectance.

## Three measurements, none of them 0.92

```
                                            crate face : open ground, display value
purpose-staged, 6 crates map-wide, 9m       0.518 0.519 0.592 0.599 0.610 0.653  med 0.596
range sweep 5/9/16/26/40m, 5 crates         0.26 - 0.72, no upward trend with range
shipped gameplay framing, 10 poses          0.386 0.461 0.485 0.528              med 0.485
BATTLEFIELD 2                                                                        0.595
```

Inverted through the grey rig, the physical quantities:

```
                        implied albedo (luma)      what it should be
open ground                0.13 - 0.42, med 0.29    sand ~0.30
crate face                 0.08 - 0.17, med 0.14    weathered timber ~0.18
crate : ground albedo      0.28 - 0.54, med 0.40    ~0.6
```

So the props are not too bright against the ground. If anything they are slightly too
**dark** — and the sand's own effective albedo lands where the previous measurement of
its texture said it should, which independently validates the rig.

Widened to every built surface in the ten gameplay frames, sunlit vertical face against
sunlit flat sand: `metal-big` 0.18-0.63, `concrete-big` 0.24-0.58, `wood-big` 0.31-0.84,
`wood-prop` 0.46-0.53. Median across all of them **0.46**. Nothing in the game reads
0.92 against its ground except one surface, and that surface is the reason for the
original number.

### The two shader paths agree, which was the third suspect

Props and terrain reach the screen through different programs, so "different effective
irradiance" was a live hypothesis. The rig settles it without an A/B, because a stock
`MeshStandardMaterial` grey primitive is in the frame on both orientations:

- **horizontal:** the terrain's custom shader puts sunlit sand at implied albedo 0.29
  against its own texture's ~0.30, read against stock-material plates lying on it;
- **vertical:** the bridge cube — real `bs-struct-wood` material, real merged crate
  tint, full-uv so its level *is* the map mean — lands at implied albedo 0.13-0.15,
  exactly where `mapMean x tint` predicts, inside the same grey ladder as the crate.

**Neither path is gaining or losing light relative to the other.** Shadow, AO and IBL
arrive the same on both.

## Where 0.92 came from: `structures-wood` is one draw call and two different things

Pointed at the `checkpoint` pose with mesh-name classification — which is what a raycast
against a merged town gives you — this probe reproduced the finding on its first run:
**wood face : ground 0.953, n=513.** The classification overlay says why. Every one of
those pixels is the **guard tower's planking**, four metres of sunlit vertical timber at
3-5m elevation. There are **zero crate pixels in that frame**.

Two mechanisms separate a tower from a crate, and both are large:

1. `applyGroundGrime` darkens the bottom 1.6m of every piece to a 0.78 floor. A 0.9m
   crate is *entirely inside that band*; a tower platform at 3-4m gets none of it.
2. The denominator. `checkpoint`'s sunlit sand reads 105/255 against `rooftop`'s 247 —
   the same timber at 89 gives 0.84 in one frame and 0.42 in the other.

**The ratio is set as much by which ground you sample as by which timber you sample, and
both vary by more than 2x across the map.** A single number for "figure against ground"
was never going to be stable, which is exactly why the calibrated inversion matters: the
albedo ratio is 0.28-0.54 in every frame measured, however the display ratio moves.

Classifying by the **physics collider** rather than the mesh name fixes it for free —
`crate()` is the only call site in the kit that places a wooden box with square x/y under
0.56m half-extent, so the crates can be enumerated directly instead of hunted for.

## `albedoScaleFor`'s clamp: five materials, not one, and metal was the casualty

The brief carried this as "wood is the only material that hits the clamp, map mean 0.152
wants 6.56, so timber renders about 8.5% dark". Both halves are wrong. 0.152 is wood's
*luminance*; `albedoScaleFor` divides by the plain **channel mean**, which is 0.1385.
Measured across the library:

```
material     map mean   wants   old scale   albedo lost
metal          0.0885   11.30       6         -47%
rubble         0.1020    9.80       6         -39%
wood           0.1385    7.22       6         -17%
sandbag        0.1399    7.15       6         -16%
corrugated     0.1484    6.74       6         -11%
concrete       0.1891    5.29     5.29          ok
dirt / blockwall / plaster / sand                ok
```

**Five of ten were clamped**, and metal — losing 47% of the albedo its tint asks for —
is most of why `structures-metal` measured as the darkest merged mesh in a frame (median
luma 27 against terrain's 86) and why painted steel keeps being reported as a black
silhouette. Two rounds have now tried to fix that from the lighting side.

The old comment's rationale is backwards. *"A dark map must not be scaled back up"* is
precisely what this function exists to do: the level is set by the vertex tint, and
dividing by the map's own mean is what makes the tint mean what it says. Dark asphalt
stays dark because its tint is dark. The real guard the clamp provided is against a
low-mean map with bright highlights pushing `map x scale x tint` past 1, so a cap is
kept — at **12**, which covers every generator in the library with headroom.

Verified after the change: **no material clips a single texel** (0.0% for all ten), and
effective albedo moves wood 0.152 -> 0.198, sandbag 0.173 -> 0.296, metal 0.054 -> 0.103.
Same-frame ratio, back to back on the gameplay set: crate faces **0.485 -> 0.527**,
toward the reference's 0.595. The change scales a vertex attribute at load and adds no
geometry, so cost is unmoved by construction: ultra **1041 calls / 2.44M triangles /
9.6ms p90** against a 33ms budget, all four tiers inside their budgets.

All seven suite metrics stay inside the Battlefield 2 distribution after the change,
verified twice:

```
metric        before          after           BF2                verdict
meanLuma      61.2/100.9/133  56.3/103/128    81.4/100.4/160.2   ok
sd            33.4/49.8/76.8  33.5/53.4/73.7  38.7/46.2/57.6     ok
saturation    24.2/39.3/47.7  22.9/45.2/59.7  7.3/30.9/71        ok
darkPct       0/0.8/3         0.1/1/1.5       0.1/5.4/10.8       ok
brightPct     0/0/3           0/0/8.4         0/0/5.8            ok  <- one shot now past their max
tonalRange    17/23/28        16/24/30        22/29/32           ok
detail        6.3/12.8/27.7   6.9/13.6/26.8   8.1/14.6/27.1      ok

shots flagged outside the reference range   4 -> 2
```

**Do not read the per-shot column as a before/after.** Two "after" runs of the same
harness on the same code gave `alley` luma 62.1 and 95.0, `dawn-ridge` 62.0 and 103.0,
`checkpoint` 89.3 and 64.1 — swings of up to 66% with nothing changed but a concurrent
edit elsewhere in the tree. `blacksand-gameplay-shots.mjs` is not reproducible at the
precision a per-shot A/B needs, and this is the fourth time the project has been misled
by treating a between-run difference as a measurement. What is claimable is the
post-change state (all seven inside the distribution, on two independent runs) and the
same-frame ratio above, which is immune to that drift by construction.

The one honest cost: `brightPct` max moves 3 -> 8.4 against the reference's 5.8. The
distribution verdict is still ok, but one frame now carries more near-white than any
Battlefield 2 frame does, and that is worth a look before the next blind round.

Stated against it, because it is real: the change also takes `checkpoint`'s guard tower
from 0.84 to 0.97. That surface is the one place in the game where figure and ground do
converge, and it converges further. The fix is one constant if a later round wants it back.

## Two instrument faults, both mine, both worth recording

**`structures.js` buckets by material AND cell, so the town holds many meshes all called
`structures-wood`.** A `scene.traverse` that keeps the last match returns whichever cell
is last in the scene graph, which is essentially never the one the object is in. That
made the probe report a crate tint of 1.44 and a bridge cube three times too dark, and it
cost an hour chasing a 2.8x discrepancy that did not exist.

**three's `Raycaster` cannot classify a frame here.** A merged structures mesh is a few
hundred thousand triangles with no acceleration structure, so a full-frame grid is
billions of ray-triangle tests and simply does not finish — the first attempt ran for ten
minutes without emitting a line. `physics.raycast` walks a 24m broadphase of oriented
boxes, marches the heightfield, and carries the `SURFACE` type the piece was placed with,
which is a *better* classifier than a mesh name because it names the object rather than
the draw call. It is also what made the crate/tower split visible at all.

## Where that leaves the grounding complaint

Two candidate explanations for *"objects hover, props sit on the plane like decals"* have
now been measured and neither survives: **ambient seam darkening is at 1.1x of the
reference**, and **figure/ground value separation is at 0.8-1.0x of it**. The reviewers
are validated (5/5 on the same-renderer control, zero false positives), so they are seeing
something real, and it is neither of these.

What the numbers do say, and what nobody has looked at, is that the *ground* is the
unstable term: at fixed time of day and pinned exposure, open sunlit sand's effective
albedo ranges **0.13 to 0.42 across the map**, a 3.3x spread driven by `uMacroAmt.x`'s
single-octave +/-66% tone swing. A prop carries the same albedo everywhere it stands; the
surface under it does not. That is the next thing I would measure.

## The 0.92 was a classification artefact, and the real bug it uncovered was bigger

The "timber props have almost no value separation from the ground" finding — ours 0.92
against Battlefield 2's 0.595, called the biggest gap in the project one section above —
**does not replicate and is withdrawn.** Measured three independent ways:

```
                                            crate face : open ground
purpose-staged, 6 crates map-wide, 9m       med 0.596
range sweep 5/9/16/26/40m, 5 crates         0.26 - 0.72, no trend with range
shipped gameplay framing, 10 poses          med 0.485
BATTLEFIELD 2                                   0.595
```

**We are at or below the reference's separation, never above it.** Inverting every
reading through five known-albedo grey plates standing in the same frame — which divides
out the warm illuminant, the AgX curve and the saturation controls — gives implied
reflectance: open ground 0.29 median against sand's ~0.30, crate face 0.14 against
timber's ~0.18. If anything our props are slightly too dark.

**Where 0.92 came from is the lesson.** The original probe classified pixels by *mesh
name*, and `structures-wood` is one merged draw call containing two very different
objects. Pointed at `checkpoint` it returned "wood face 0.953, n=513" — every one of
those pixels the guard tower's planking, and **zero crate pixels in the frame at all.**
Two mechanisms separate them: `applyGroundGrime` darkens the bottom 1.6m, so a 0.9m crate
is entirely inside that band and a 4m tower is not; and the denominator moves, because
`checkpoint`'s sunlit sand reads 105/255 against `rooftop`'s 247. Classifying by physics
collider instead of by draw call fixes it.

Also ruled out: props and terrain going through different shader paths. Terrain's custom
shader puts sunlit sand at implied albedo 0.29 against stock-material plates lying on it,
and a bridge cube carrying the real wood material and the real vertex tint lands at
0.13-0.15, exactly where `mapMean x tint` predicts. Neither path gains or loses light.

### The clamp bug was five times worse than reported

Not "wood is the only material that hits the clamp" — **five of ten are clamped**, and
0.152 was wood's *luminance* where `albedoScaleFor` divides by the *channel mean*:

```
metal      0.0885 -> wants 11.30  (-47%)
rubble     0.1020 -> wants  9.80  (-39%)
wood       0.1385 -> wants  7.22  (-17%)
sandbag    0.1399 -> wants  7.15  (-16%)
corrugated 0.1484 -> wants  6.74  (-11%)
```

Metal losing 47% is most of why `structures-metal` measured as the darkest merged mesh in
frame. Clamp 6 -> 12; no material clips a texel afterwards.

### Two instrument faults worth carrying forward

- **`structures.js` buckets meshes by material AND cell**, so many are named
  `structures-wood`. A `traverse` that keeps the last match returns the wrong cell.
- **three's `Raycaster` cannot classify a frame here.** A merged mesh is hundreds of
  thousands of triangles with no BVH, so a full-frame grid does not finish — one attempt
  ran ten minutes without emitting a line. `physics.raycast` walks a 24m broadphase and
  carries the `SURFACE` type the piece was placed with, which is a **better** classifier
  than a mesh name because it names the object rather than the draw call.

### Regression from the fix, and it lands on the one metric that had no headroom

Raising the clamp raised material contrast, and `sd` went out of band: **61.4 median
against the reference's 38.7-57.6.** The efficiency ratio is unchanged — lit IQR / frame
sd is 0.48 against the reference's 0.89 — so the extra spread buys nothing. `uLogSlope`
was set to 1.90 in round 9 when `sd` had headroom and no longer does; it goes back.

---

# Round 10: 0/10, and a claim worth two measurements

Round 10 ran on the settled grade with all seven metrics in band. Lost 0/10. The
reviewer called one defect "the whole ballgame" and gave numbers, which is the most
useful thing a reviewer has done here:

> our sand lit hue 33 sat 0.23 -> shaded hue 56 sat 0.40 — **+23 degrees toward olive,
> saturation up 74%.** Against BF2's tank hull: 34.5 lit -> 33.5-37.3 shaded, under 3
> degrees, saturation correctly falling.

## Measurement 1: population level, and it exposed a flaw in our own tooling

`blacksand-chroma-compare.mjs` reports a 2-degree lit->shade drift and **structurally
cannot see this defect**: it splits the whole frame by luminance, so its two populations
are made of *different materials*. Sand in sun against brick in shade says nothing about
what shadow does to sand, and averaged over a frame the material differences cancel.

New instrument, `scripts/blacksand-shadow-hue.mjs`: pair pixels a few pixels apart across
a shadow edge, so both samples are overwhelmingly the same surface and the only
difference is the light. Over ~15,000 pairs per frame:

```
BATTLEFIELD 2   hue drift lit->shade  -0.5 deg   shade/lit saturation 1.15
OURS                                  +1.4 deg                        1.06
```

Reads as "not the defect" — **and I do not trust it.** A 3px window at 620px width
straddles the penumbra, so both samples are partly mixed and the effect is diluted.
Recorded as a caveat on the tool rather than as a result.

## Measurement 2: a neutral grey box, which is the one to believe

A 0x808080 box, roughness 0.85, metalness 0, placed on the sand, measured against its own
cast shadow:

```
sunlit sand              hue 31.4   sat 0.417   G/R 0.801
sand in the box shadow   hue 42.9   sat 0.416   G/R 0.881
```

**+11.5 degrees toward yellow-green, G/R up 10%, saturation flat.** The reviewer's
direction is right; its magnitude is roughly double the truth and its saturation claim is
wrong.

The grey box itself renders at **hue 30, saturation 0.41.** A neutral albedo coming out
that chromatic means the illuminant is very warm — the sun is `#fff7e7` at intensity
5.14, the hemisphere `#a3a5a8` sky over `#faeacf` ground at 1.44, `environmentIntensity`
0.532.

**Hypothesis, now under test:** sunlit sand is dominated by the warm-white sun and reads
near its hue; shadowed sand loses that and shows more of *its own albedo* — which
`PALETTE_HUE = 24` has rotated 24 degrees toward yellow. The drift between the two
populations would then be about the size of the rotation. Falsifiable: sweep
`PALETTE_HUE` 24 / 12 / 0 and the drift should fall in step. If it stays near +11.5 at 0,
the cause is the ambient's own colour and the hypothesis is dead.

The cost if it holds: masonry hue is 33-41 against BF2's 30.1-60.7, and **without the
rotation it would be near 9-17, below their minimum.** Masonry would need its own warm
bias rather than riding a global one.

## A note on the reviewer's other claims this round

Two were checked and are false: "no ambient occlusion at contacts" (seam darkening
measures at 1.1x of the reference) and "props hover" (figure/ground value separation
0.8-1.0x). Both had already been measured and cleared in earlier rounds. It also credited
things that are real and should not be regressed: penumbra widening correctly with caster
distance, a complete shadow caster set including soldiers, and the T-wall concrete, which
it called "the one material in the set that is right".

## The harness was shooting the player

`blacksand-gameplay-shots.mjs` stages a hostile squad into frame. **They engage.** A hit
puts a red damage vignette over the whole frame, so captures came out **bimodal** — same
build, two runs:

```
alley  mean luma   61.8  vs  95.2
market lit IQR     35.2  vs  19.2
rooftop top2       26.4% vs  34.9%
```

That is far wider than any difference this harness is used to judge, and it is the source
of the "absolute values move between runs" warning that **three separate agents reported
independently this session**, one of which lost a measurement round to it before finding
the cause. Every unexplained run-to-run swing recorded above should be read with this in
mind.

Fixed by healing the player, clearing suppression, dropping every bot's target and zeroing
`uDamage` immediately before the shutter — after the settle, so the squad still walks into
a natural pose, it just has not shot anyone by the time the frame is taken. Repeatability
on two runs of an identical build:

```
              before fix        after fix
lit IQR      (see above)      21.4  vs  21.4
p99/p50                       1.27  vs  1.27
top2                         0.02%  vs  0.01%
frame sd                      50.3  vs  49.9
```

Two more instrument faults found in the same round and left as known issues:
`blacksand-movement-probe.mjs` picks its test ground with `Math.random()` and asserts
corridor clearance only on the centreline every 1.5m at radius 0.6, leaving 30cm gaps — it
flakes about one run in four on an untouched baseline, which is the 13/14 recorded earlier.
And its "does NOT climb a 2.6m wall" check fails above 0.5m while the player's own step
height is 0.42m: **8cm of margin for ground relief**, which is why placing anything solid
on open ground breaks it.

## Open-ground dressing: it works, and the gate cannot see it

300 rock outcrops, 1100 desert-pavement stones, 55 wadi cobble bars, ~200 spoil heaps and
25 rutted desert tracks. Paired A/B, `--no-reframe --no-populate`, other agents' files
md5-identical across the pair:

```
                   baseline   shipped
lit IQR (median)      23.4      23.1
IQR / sd             0.461     0.455     BF2 0.89
```

**Zero**, confirmed by a second independent pair (26.4 -> 26.2). But on frames that are
actually open desert — a nine-stand probe in the basin, the wadi, the dune field and the
haul route — it buys **+2.4** (27.7 -> 30.1), and the best two stands gained +8.8 and +7.0,
both with an outcrop in the near field.

**The ten-frame gate is structurally blind to open-ground content.** Seven of its ten poses
stand 14m from an objective landmark, on ground `flatten()` has graded to a plane —
objective aprons reach 90m, road aprons 16m. Terrain shaping cannot reach them and scattered
props cannot either: an interquartile range moves when a quarter of the population moves,
and rock at believable desert density covers a few percent of the ground. **Battlefield 2's
41.1 comes from vehicles, roads with railings and a second biome with rolling grass — from
large objects in the mid-field, not from ground detail.**

Cost, paired and contention-free: +47 draw calls (990 -> 1037), +310k triangles (+15.4%),
p90 8.7 -> 9.1ms in a quiet window against a 33ms budget. ~10,000 pieces cost +20 draw
calls by going through the existing merge. Note about a third of the triangles and 27 of
the calls are **foliage** responding to the new terrain relief, not the rocks themselves.

One thing given up, and it is a real cost: **everything placed on open ground is
non-solid**, because the movement fixture's 8cm step-height margin fails on anything solid
out there. A 1m boulder is a ghost. The fix is a collider that follows the stone rather than
its bounding box, plus a fixture that sweeps its corridor rather than sampling a centreline.

---

# Shadow hue: the palette is innocent, and a grey box proves it

The hypothesis under test: our sand rotates hue entering shadow because shaded sand
shows its own albedo, which `PALETTE_HUE = 24` has rotated toward yellow, while sunlit
sand is dominated by a warm-white sun. Prediction: the drift falls in step with the
rotation, reaching zero at `PALETTE_HUE 0`.

**It does not. The hypothesis is falsified, and the cause is in the light.**

`scripts/blacksand-shadow-box.mjs` stands a neutral grey cuboid (0x808080, roughness
0.85) on open flat sand with nothing built within 12m, and reads the sand against the
box's own cast shadow. Every pixel is classified by casting through it — physics for the
world, an analytic slab test against the box for shadow — and a sample is kept only when
it and four probes 30cm away on the ground **agree about the sun**. That penumbra
rejection is the whole difference from `blacksand-shadow-hue.mjs`, whose 3px window spans
the penumbra and averages the two answers it exists to separate.

Three sites, medians per site, hue on the display sRGB triple:

```
                    SAND (chromatic albedo)   NEUTRAL GREY, same normal   NEUTRAL GREY, vertical
                    drift   sat x   G/R x     drift   sat x               drift   sat x
PALETTE_HUE 24      +12.9   1.195   1.069     grey (achromatic in shade)  +11.0   1.558
PALETTE_HUE 12       +9.0   1.195   1.028     grey                         +7.5   1.602
PALETTE_HUE  0       +6.6   1.161   1.016     grey                        +10.2   1.489

                    sand lit -> shade    grey vertical lit (h/s)   grey vertical shade (h/s)
PALETTE_HUE 24        42.0 -> 57.4              24.0 / 0.145              35.0 / 0.226
PALETTE_HUE 12        34.1 -> 45.0              22.5 / 0.142              32.7 / 0.231
PALETTE_HUE  0        27.1 -> 34.6              22.5 / 0.144              32.7 / 0.218
```

A second run with the box square to the sun instead of at 45 degrees gave sand
+10.4 / +9.1 / +7.6 on the same sites — same shape, so the fall is real but small.

**Removing the entire 24-degree rotation removes about half the drift and leaves
+6.6 to +7.6 of it.** And the control settles it: a **neutral grey vertical face, which
has no albedo hue to rotate, drifts +7.5 to +11.0 degrees on its own** and is unmoved by
`PALETTE_HUE` (hue 24.0 -> 35.0 at every value). Whatever is rotating our shadows is
rotating a surface with no hue in it.

The residual dependence on `PALETTE_HUE` is not a second mechanism: a redder, more
saturated albedo has less room to be rotated further toward red by the same warm
multiplier. It is the compressive effect `textures.js` already documents, seen from the
other end.

## The mechanism, read straight off the rig

Three neutral readings in one frame, no albedo involved:

```
grey, up-facing, in sun      hue 12.0  sat 0.121   sRGB 208,188,183
grey, up-facing, in shadow   ACHROMATIC             sRGB  55, 55, 51
grey, vertical, in sun       hue 24.0  sat 0.145   sRGB 103, 94, 88
grey, vertical, in shadow    hue 35.0  sat 0.226   sRGB  51, 46, 39
```

Those are the two fill terms, measured rather than argued, and each lands on its
constant. An **up-facing** shaded surface receives the hemisphere's sky end, which round 7
deliberately made near-neutral `(0.90, 0.92, 0.96)` — and a neutral card in shadow duly
comes back grey. A **vertical or downward** face receives `bounceTint`, which is
`sunColour` lerped 40% toward `(0.90, 0.66, 0.36)`: hue about 33, saturation about 0.29.
Measured through the whole pipeline: hue 32.7-35.0, saturation 0.218-0.231.

So the renderer lights a shadow with a *different chromaticity* from the one it lights
sunlight with, and any chromatic albedo must rotate between them. Sunlit sand is
albedo x a warm key, and multiplying two same-hue chromatic terms walks the product
toward red; shaded sand, lit by a near-neutral fill, keeps its own albedo hue. **The
lit->shade drift on sand is the sun's redward rotation of the albedo, measured
backwards.** Battlefield 2 does not do this (paired drift -0.5 degrees) because a 2005
title's ambient is a scaled copy of the same light, so its chromaticity matches.

Ruled out on the same rig, each a full grade reset:

```
                        sand drift   grey vertical drift
as shipped                  +10.4          (see above)
shadowLift 0, satRoll 0,
  saturation 1.0            +13.4      curve is not the cause - removing it makes it BIGGER
AO off                      +10.1      AO is not the cause
```

## What it is worth fixing, and the argument for not

The frame-level instrument disagrees with the controlled one about size, and both are
right. On the ten gameplay frames `blacksand-shadow-hue.mjs` reports ours **+1.1 degrees
against the reference's -0.5**, saturation 1.04 against 1.15 — in band. The defect only
reaches +11 in a hard, deep, sky-occluded cast shadow from a large opaque box, which is
the harshest case available and not what most of a frame is made of. The round-10 critic's
magnitude (+23 degrees, saturation +74%) is roughly double what the controlled rig
measures (+12.9, saturation +19.5%).

The only fix is to give the up-facing fill the key's chromaticity — i.e. undo round 7's
neutral sky end. That is the change that took shade saturation 0.641 -> 0.522, and shade
saturation currently measures **0.497 against the reference's 0.395, already 1.26x too
high**. Warming the fill pushes an out-of-band number further out to improve one the frame
instrument says is already in band. **Not taken.**

**One genuinely live finding falls out of it, and it is the round-4 "indirect is too
directional" thread with a number on it at last:** a neutral vertical face in shade is
**1.56x more saturated than the same face in sun** (0.226 against 0.145), and 11 degrees
yellower. Vertical shadows in this renderer are lit by a fill more chromatic than their own
key. That is `bounceTint` in `sky.js` and it is unfixed. Ground was repaired three rounds
ago; vertical faces never were.

## The masonry cost is about a sixth of what the brief assumed

Carried as "masonry sits at 33-41 against BF2's 30.1-60.7, and without the rotation it
would be near 9-17, below their minimum." Measured directly on the walls' own pixels —
classified by physics surface, sunlit faces only, six poses, time of day pinned:

```
                sunlit masonry hue   sat     n
PALETTE_HUE 24         40.7          0.431   13039
PALETTE_HUE 12         39.3          0.433   13039
PALETTE_HUE  0         36.8          0.443   13039
```

**A full 24-degree rotation is worth 3.9 degrees at the wall, not 24.** Per pose the
deltas are -1.5 to -6.9, all the same sign. At `PALETTE_HUE 0` masonry sits at 36.8,
still inside the reference's 30.1-60.7 and above its minimum.

The rotation does reach the maps — `blockwall` 63.9 -> 36.0, `concrete` 72.2 -> 47.7,
`plaster` 70.4 -> 44.5 at source. It does not reach the *wall*, because the masonry maps
that carry a wall's value are nearly grey (`concrete` linear saturation 0.088, `plaster`
0.143) and most of the delivered chroma comes from `structures.js`'s vertex tints, which
this rotation deliberately does not touch. A near-grey map times an unrotated tint has the
tint's hue.

The 9-17 figure came from a saturation-weighted mean over an image band; this one is a
classified measurement of the surface itself. Given how many times this project has been
misled by a frame-level weighted average — including a hue target adopted and then
withdrawn for exactly this reason — the classified number is the one to believe. **The
brief's stated cost of a `PALETTE_HUE` reduction is overstated by about 6x.** It is still
not a reason to reduce it, because reducing it does not fix the drift.

Twenty-two mechanisms named across the project, three surviving.

## Instrument notes

- **A neutral card in deep shade lands at the 8-bit floor.** At linear albedo 0.20 the
  shaded card read 40/255 carrying two to four *counts* of chroma, and hue computed from
  three counts duly printed 180 degrees on one row and 240 on another. Raised to 0.50, and
  the probe now refuses to report a hue below four counts of separation and prints "grey",
  which is the honest answer and is itself the finding for the up-facing case.
- **Colliders are oriented boxes.** Deriving a wall's face normal from `halfExtents` and
  world axes finds nothing: 889 wall-shaped concrete colliders exist and the axis-aligned
  test selected zero of them. Classifying whatever the shipped poses already look at, by
  physics surface, is both simpler and unbiased — the pose decides which walls are
  measured, not what a wall pixel reads.
- All seven suite metrics verified in band after this work on a fresh post-harness-fix
  capture (`output/blacksand-shots/hue-2`).

## And then the vertical-face defect was fixed: `bounceTint` 0.40 -> 0.22

The one thing the round located that was genuinely out of band. A HemisphereLight's lower
half **contains no sky**: irradiance is `mix(groundColor, skyColor, 0.5 + 0.5*Ny)`, so at a
vertical normal the two ends blend 50/50 *by colour* — but `skyColour`'s luminance is 0.374
against `bounceTint`'s 0.861, so a wall was receiving about **70% warm bounce and 30%
neutral**. A real wall sees half a sky and that half is what cancels the bounce; ours cannot,
because the sky end has to stay neutral for the up-facing case.

Two cheaper explanations were killed first, on the same rig:

```
probe diffuse off (ENV_DIFFUSE 0)   vertical shaded face 0.226 -> 0.231   nothing
hemisphere off                                           0.226 -> 0.030   everything
flat curve (shadowLift 0, satRoll 0, saturation 1.0)     ratio 1.558 -> 1.635
```

**The hemisphere carries all of that face's chroma and about half its level, and the grade
was suppressing the fault slightly rather than causing it.** With the probe alone, a vertical
face reads 32,32,33 — the probe has real hemispherical geometry and its sky and ground halves
genuinely cancel. The hemisphere is the crude term, and it is the one delivering the error.

```
                    neutral vertical face      frame            frame
                    lit -> shade    ratio      shade sat   lit:shade   lit sat
shipped 0.40        0.145 -> 0.226   1.56        0.497        1.21       0.582
0.25                0.138 -> 0.180   1.40
0.15                0.127 -> 0.156   1.26
SHIPPED 0.22        0.138 -> 0.173   1.26        0.476        1.25       0.594
BATTLEFIELD 2, paired over its own frames  1.15   0.395        1.35       0.581
```

Face hue drift +11.0 -> +6.9; shaded face hue 35.0 -> 30.0 against its own lit 23.1, so the
gap halved. Sand's paired saturation ratio 1.195 -> 1.103, against the reference's 1.15.

**Not taken further than 0.22, and the reason is a limit rather than caution.** The same
constant is what a *downward* normal receives, and a slab underside really does see almost
pure bounce — those were the round-2 reviewer's "black holes". One hemisphere light cannot
serve both normals. 0.22 halves the departure from the key, which is roughly what "half of it
should have been sky" asks for, and leaves an underside visibly warmer than the sun.

**A correction to the target itself.** "A neutral vertical face in shade should be no more
saturated than in sun" is stricter than the reference: Battlefield 2's own material-paired
shade/lit saturation is **1.15**, not 1.0. It cannot be 1.0 for a vertical face by
construction — a lit face is (sun + fill) and a shaded one is (fill), so whenever the fill is
more chromatic than the key, and it must be because the fill *is* sunlight that bounced off
chromatic sand, shade is the more saturated of the two. 1.26 against a reference of 1.15 is
the honest place to stop.

**A recorded negative is retracted.** Round 7 swept this tint to pure sun colour and measured
frame shade saturation getting *worse* (0.729). It does not transfer: at that time the same
constant also painted the hemisphere's up-facing end, so changing it recoloured every shaded
horizontal surface in the game. The sky end has been independent since round 7's own fix, and
the framing-pinned sweep now moves lit saturation 0.584 -> 0.588 with IQR, sd, luma and
darkPct flat.

**The one honest cost.** `uShadowLiftTint` is derived from the fill, so desaturating the
bounce also cools the toe lift — which lands on precisely the darkest population. Sand's
controlled lit->shade drift goes +12.9 -> +14.4 and the frame-paired figure +1.1 -> +3.0
against the reference's -0.5. Still well inside the reference's behaviour, and it is the
same coupling round 8 named: a term that reads another system's state becomes wrong the
moment that system changes. Round 8 wanted that tint neutral; this makes it more so, which is
why shade saturation fell at the same time.

Gate, `output/blacksand-shots/hue-3`, `--no-reframe`, fresh post-harness-fix capture:

```
all seven suite metrics    ok
lit IQR                    21.4 -> 21.4        p99/p50 1.26 -> 1.28   top2 0.00%
lit saturation             0.582 -> 0.594      (BF2 0.581; framing-pinned delta is +0.004)
shade saturation           0.497 -> 0.476      (BF2 0.395)
up-facing shade            sRGB 54,54,50 sat 0.049 - still achromatic
```

Changed: `bounceTint`'s lerp in `sky.js`, one constant. Nothing else.

## `PALETTE_HUE` falsified as the shadow-drift cause — by a control, not an argument

My hypothesis: shadowed sand shows its own `PALETTE_HUE = 24` rotated albedo while sunlit
sand is dominated by a warm-white sun, so the drift should be about the size of the
rotation. Swept on a neutral grey cuboid standing on open flat sand with nothing built
within 12m, samples kept only when the pixel **and four probes 30cm away agree about the
sun** (penumbra rejection is the whole difference from the population instrument):

```
                 SAND (chromatic albedo)      NEUTRAL GREY vertical face
                 drift   sat x   G/R x        drift   sat x
PALETTE_HUE 24   +12.9   1.195   1.069        +11.0   1.558
PALETTE_HUE 12    +9.0   1.195   1.028         +7.5   1.602
PALETTE_HUE  0    +6.6   1.161   1.016        +10.2   1.489
```

Removing the entire rotation removes about half the drift. **The control settles it: a
neutral grey vertical face — no albedo hue to rotate — drifts +7.5 to +11.0 on its own
and is completely unmoved by `PALETTE_HUE`.** The residual dependence is not a second
mechanism; a redder, more saturated albedo has less room to be rotated further toward red
by the same warm multiplier. Twenty-two mechanisms, three surviving.

**The real mechanism, read straight off the rig with four neutral readings:**

```
grey, up-facing, in sun      hue 12.0  sat 0.121
grey, up-facing, in shadow   ACHROMATIC
grey, vertical, in sun       hue 24.0  sat 0.145
grey, vertical, in shadow    hue 35.0  sat 0.226
```

Each lands on its constant. Up-facing shade gets the hemisphere's sky end, which round 7
made near-neutral, and a neutral card there comes back literally grey — that half is
correct. Vertical shade gets `bounceTint`. **Our key and our fill have different
chromaticity, so any chromatic albedo must rotate between them.** Battlefield 2 does not,
because a 2005 ambient is a scaled copy of the same light. Also ruled out on the same
rig: the tone curve (zeroing lift, satRoll and saturation makes the drift *bigger*,
+13.4) and AO (+10.1).

**Not fixed, correctly.** Gameplay frames read +1.1 against BF2's -0.5 — in band. The +11
only appears in a hard deep box-shadow, and the only fix is warming the up-facing fill
back toward the key, undoing round 7 while shade saturation is already 1.26x too high.

### And my stated cost was wrong by six times

I claimed removing the rotation would drop masonry to hue 9-17, below the reference's
30.1 minimum. Measured on the walls' own pixels, classified by physics surface, sunlit
faces only (n=13039): **PALETTE_HUE 24 -> 40.7, 12 -> 39.3, 0 -> 36.8.** A full 24-degree
rotation is worth **3.9 degrees at the wall**, and at zero the masonry is still inside the
band. The rotation reaches the maps (`blockwall` 63.9->36.0, `concrete` 72.2->47.7) but not
the wall, because the masonry maps are near-grey and the delivered chroma comes from
`structures.js`'s vertex tints, which the rotation deliberately does not touch. My 9-17
came from a saturation-weighted image band; this is a classified measurement of the
surface. **Prefer a classified measurement over an image-band average whenever both are
available.**

### The live defect this located

**A neutral vertical face in shade is 1.56x more saturated than the same face in sun, and
11 degrees yellower.** No albedo involved. That is round 4's "indirect is too directional"
thread with a number on it at last — the ground was repaired three rounds ago and vertical
faces never were. It is `bounceTint` in `sky.js`, and it is the one place the round-10
critic's "shade is more chromatic than sun" reading reproduces on a surface with nothing
to blame but the light. It is also consistent with frame shade saturation sitting at 0.497
against the reference's 0.395.

### Two instrument notes

A neutral card in deep shade lands at the **8-bit floor** — 2-4 counts of chroma printed
hues of 180 and 240. Refusing a hue below four counts and printing "grey" is correct, and
is itself the finding for up-facing surfaces. And **colliders are oriented boxes**, so
deriving a wall normal from `halfExtents` against world axes selects zero of 889
wall-shaped colliders.

---

# Round 11: 0/10 on a corrected harness, and the closest call yet

First blind round captured after the damage-wash fix, so the first whose frames are
certain not to contain a red hit vignette. Still 0/10 — but **pair 03 was called "near a
coin flip"**, and the reviewer said of our panel: *"A looks better in isolation"*, resting
its call on shadowed-material identity and cross-pair renderer-family matching rather than
on the reference being impressive. That is the closest this project has come.

It also praised things worth protecting: *"the sand ripple normal map is well-behaved — no
shimmer, no crawl, no aliasing at grazing angles, and the ripple contrast falls off with
distance in a controlled way. That is harder than it looks."* And: *"Colour is honest.
There is no teal-orange grade, no crushed blacks, no filter pretending to be art
direction. Given how many projects reach for a LUT to hide flat lighting, restraint here
is the right call."* And: *"the render is technically clean... it is under-lit, not
mis-lit."*

## Its top two claims contradict our measurements, and that is now the open question

> **"Small and mid-size props are missing from the shadow pass entirely."** Large casters
> DO work. This is a caster-class gap. The clearest case: two dead scrub bushes in full
> sun, on open sand, casting nothing.

> **"There is no contact-scale occlusion anywhere"** — confidence HIGH. One frame's sand
> at a crate's foot is the same luminance as sand two metres away; another's wall base has
> a band *brighter* than the wall above it.

Against: a foliage agent enumerated the caster set and found `castShadow` true on shrub,
thorn, deadbrush, tussock, reed and crop, none of which have an LOD that could fall back
to a non-casting impostor inside the shadow distance. And seam darkening measures at
**1.1x** of the reference on a repaired target set, figure/ground value separation at
0.8-1.0x.

**Six reviewers across thirteen rounds have said "objects hover". Every measured
explanation has come back at parity.** Either the instruments are wrong or they have never
been pointed at the thing being seen. The hypothesis nobody has tested, and the one I would
bet on: **the shadow is being cast and is landing under the caster's own silhouette**, so
it exists in the buffer and is invisible in the image — which would make the reviewers
right about the picture and every previous agent right about the code.

The "wall base brighter than the wall above it" claim is the strangest thing in the report
and the most likely to be a genuine bug. `applyGroundGrime` darkens the bottom 1.6m and
normalises per piece; a previous agent already found it resetting at every floor line.
Check whether it can invert.
