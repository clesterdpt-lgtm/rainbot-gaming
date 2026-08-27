# SAINTFALL — The Green Antiphon — critique rubric

> The build is not finished when it looks good. It is finished when a critic who
> has never seen either level, shown one Antiphon frame and one Vesper-IX frame
> side by side **with the labels removed**, picks the Antiphon frame — and can
> say why in terms of composition, material response and light rather than
> novelty.

This document exists so that *"it looks better now"* is a measurement instead of
an opinion. It is the island's copy of
[`saintfall-summit-critique-rubric.md`](saintfall-summit-critique-rubric.md);
§1–§3 are inherited unchanged because they are properties of the process, and
§4 is entirely new because the defects are properties of the level.

---

## 1. How a round runs

```bash
scripts/saintfall-atoll-round.sh 3 trade ultra
```

That captures the atoll's authored camera set, runs the acceptance gates, and
builds the blind pair set at `output/saintfall/island/blind/r3`.

**The critic is shown `pair-NN/side-by-side.png` and nothing else.** It does not
see filenames, it does not see the answer key — the key is *moved out of the
folder* by the round script, so this is a guarantee rather than an instruction —
and it is not told which level is which, **or even that the two sides are
different levels**.

**Two rounds, in this order, and the order matters.**

1. **`--mode identify` first.** *"Which of these two was made by the same hand as
   the other pairs?"* — i.e. can the critic tell the sides apart at all.
   - at or near **50%** ⇒ the set is genuinely blind, go on
   - above **65%** ⇒ something is leaking. **A preference round run on a leaky
     set measures the leak, not the art.** Find the tell and fix it first.
2. **`--mode prefer` second, and only then.** *"Which frame is the better-looking
   game?"* — **a tie is a loss.**

> ### The identify gate does not transfer to a cross-biome comparison
>
> Kenosis inherited this two-round discipline from the boss work, where both
> sides were creatures shot the same way and a tell genuinely could be closed.
> **It does not apply here and pretending it does would be dishonest.**
>
> Round 5's two identify judges both scored *strong* confidence and separated
> every one of fifteen pairs instantly, on palette and subject alone: *"the
> island level always has a blue daylight sky ... the other an orange-sunset
> gradient over red-orange dune sand; every one of the fifteen pairs was decided
> on that single glance."* A desert and an ocean cannot be made
> indistinguishable, and the only way to close that tell would be to make one of
> them look like the other — which is the opposite of the point.
>
> **So run the identify round, record the result, and treat it as a caveat rather
> than a gate.** What it tells you is real and worth knowing: the preference
> round runs *knowing* which side is which, so novelty and subject bias are live.
> The mitigation is in the instructions, not in the set — every prefer judge is
> forbidden from crediting novelty or subject matter, and told to assume both
> sides are ours. Read a preference result from a cross-biome set as **directional
> and probably harsh**, not as a clean number.

```bash
cp output/saintfall/island/keys/r3.json output/saintfall/island/blind/r3/_key.json
node scripts/saintfall-blind-compare.mjs \
  --reveal output/saintfall/island/blind/r3 --mode prefer --answers A,B,A,...
```

---

## 2. What the critic is instructed to be

Harsh. Specifically:

- It is reviewing a **shipped AAA title, not a hobby project**, and it is writing
  for an art director who will act on every sentence.
- It must name the **single worst thing** in each frame it rejects, **with a
  location in the frame**, and say what the fix is.
- **"Looks nice" is not a review.** Neither is a list of adjectives.
- It **may not credit novelty.** An ocean is not automatically more impressive
  than a desert; water is not automatically more impressive than sand. The
  question is only **which frame is better MADE**.
- It must assume the other side is **also ours and also improvable**. It is not
  being asked to be kind to either.
- It may not credit **subject matter**. A beach is not a better subject than a
  dune field. If it finds itself preferring the panel with more *stuff* in it,
  it is scoring density, not craft.

---

## 3. The seven axes

Every frame is scored **0–5** on each. **A frame that scores below 3 on any axis
fails the round regardless of its total.**

| axis | what a 5 looks like | what a 1 looks like |
|---|---|---|
| **Composition** | The frame has a subject, a foreground and a read. Something leads the eye. | A landscape photographed at random. Nothing is nearest, nothing is furthest. |
| **Value structure** | A full range with a deliberate distribution: real blacks, protected highlights, and the brightest thing in frame is the thing that should be. | One mid band. Or blown white. Or a black floor everything converges on. |
| **Colour** | Lit and shaded surfaces differ in HUE, not merely in level. Accents survive the grade. | Shadow is the key light at lower brightness. Or one global tint over everything. |
| **Material response** | Surfaces read as different substances: this scatters, that reflects, that one is rough. Specular behaves. | Everything shares one roughness. Water reads as plastic; foliage reads as painted card. |
| **Silhouette & scale** | You can tell how big things are without being told, and shapes are legible against the sky. | No scale reference. Shapes merge into their background. |
| **Micro-detail** | The near field rewards looking at it. Relief at every scale down to the pixel. | Flat polygons up close. Detail that stops at 20 m. |
| **Atmosphere** | Depth is carried by air. Distance desaturates and lifts in a way that reads as a real medium. | A flat fog lerp, or no depth cue at all. |

**Pass bars:**

- **per frame** — ≥ 3.0 on *every* axis; a sub-3 on one axis fails the frame outright
- **per round** — identify ≈ 50% (fail if > 65%); prefer ≥ 6/12, tie = loss
- **the real bar** — ≥ 6/12 **reproducibly, on a three-judge panel.** One round
  cannot resolve this. Kenosis established that the hard way.

---

## 4. The thirteen tells a critic must actively hunt for

Listed so a critic does not have to rediscover them, and so a builder can be
handed a defect name rather than a mood. Kenosis's list is snow's; this is the
island's. Format is **defect → *Symptom*.**

### The water — six of the thirteen, because water is the level

1. **Pool water.** The lagoon's colour is *painted* rather than *derived*.
   *Symptom: the depth colour barely changes between 1 m and 8 m; or the deep
   end still shows sand; or there is a hard cyan line at the shore. Diagnostic:
   `atoll-art.js` records the answer — nothing in this level may write a
   turquoise constant, and `SEA_EXTINCTION.turquoiseCheck` (`#5cb0ba`) is what
   3.0 m of water over carbonate sand should land on. If the frame does not
   match it, the fault is in the depth, the path length or the bed albedo.*

2. **Sheet water.** A sea with no surface. *Symptom: the water's brightness is
   uniform across the frame; the sun leaves a round hotspot rather than a
   glitter PATH; the horizon meets the water with no change in wave scale.*

3. **Floating foam.** Foam painted at a fixed radius instead of derived from
   depth. *Symptom: the foam line is a smooth curve that ignores a rock standing
   in the shallows, or it does not move with the swell, or it is a soft
   airbrushed gradient rather than a hard edge.*

4. **No tide.** The shore has no intertidal band. *Symptom: dry sand meets water
   in one step; nothing on the hull marks a waterline; the wreck has no crust
   below and no salt bloom above.*

5. **Dead water.** The surface is animated but nothing *responds* to it.
   *Symptom: no caustics on the seabed; no wet-sand band lagging the swash; the
   player wades with no displacement, no ripple and no splash.*

6. **Aquarium glass.** The sea reads as a lid laid over the terrain rather than
   as a volume. *Symptom: you can see the seabed's polygon edges through it
   unattenuated; or the surface has no thickness where it meets a hull.*

### The jungle

7. **Broccoli.** Foliage as a scatter of identical blobs. *Symptom: no canopy
   ceiling from inside; every crown the same silhouette; no emergent layer above
   the canopy; the tree line is a uniform height.*

8. **Plastic leaves.** No translucency. *Symptom: a backlit frond is darker than
   a front-lit one. It should be brighter AND a more saturated green — that is
   the cue, and it is most of what makes a jungle look expensive.*

### The whole frame

9. **The postcard.** Everything at maximum saturation, no hierarchy.
   *Symptom: the water is not the most saturated thing in frame. The level
   rations turquoise to water precisely so that it is; if the canopy, the rust
   or the sky is competing, the rationing has been broken somewhere.*

10. **Sticker props.** Inherited from Kenosis and it applies to every plant, rock
    and piece of hull here. *Symptom: a hard contact line where a prop meets the
    ground with nothing piled against it; no shadow at the root; a palm standing
    ON the sand rather than IN it.*

11. **A clean wreck.** Forty years of salt water that read as a dirt overlay.
    *Symptom: patina as a smooth mid-brown gradient of even value, rather than
    bimodal pooling and vertical runoff; no deformation at a tear; nothing
    exposed inside one; a hull that is the same everywhere.*

12. **Toy scale.** A 400 m ship photographed with nothing human beside it.
    *Symptom: you cannot tell whether the Spine is 40 m or 400 m. The rule is
    absolute — no frame containing the ship may lack a human-scale object, and
    the tide line counts as one.*

13. **A frame with no subject.** Not a rendering defect — a *camera* defect, and
    it costs whole pairs. A blind judge on round 5, on one of our own frames:
    *"A is empty water and cloud kit with no subject, no black and nothing to
    reward looking."* And on another: *"B cuts the frame in half at the horizon
    and puts its only subject on the seam at the same value as everything else."*
    *Symptom: nothing in the frame is nearest, nothing is furthest, and nothing
    leads the eye. A camera authored before the level had any content in it will
    do this by construction, and it will keep doing it after the content arrives
    unless somebody goes back and re-composes it.*

### And two structural faults that are not per-frame

- **The bagel.** The ring reads as a perfect circle. *Symptom: from the rim
  camera the atoll is symmetrical; the island is the same width and height on
  every bearing; there is no breach.*
- **Blown foam.** The bloom threshold left at another world's value.
  *Symptom: the beach glares; the reef flat at low tide is one white shape with
  no ripple in it. Vesper runs 1.0, Kenosis 2.35, this level runs 1.62 — set by
  foam at 1.9 linear having to bloom and wet sand at 1.4 having not to.*

---

## 5. Reporting

Each round appends to [`saintfall-atoll-critique-log.md`](saintfall-atoll-critique-log.md):

- round number, seed, mode, and **the raw result line the reveal prints**
- **per pair**: which side won and the critic's **one-sentence reason**
- **the top three defects named, in priority order**
- **what was changed in response, and the round number that re-tested it**

And the closing rule, which is the most important line in this file:

> **A defect is not closed because it was fixed. It is closed when a later blind
> round stops naming it.**
