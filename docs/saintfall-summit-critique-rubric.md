# THE WHITE VIGIL — critique rubric

The build is not finished when it looks good. It is finished when a
critic who has never seen either level, shown one Kenosis frame and one
Vesper-IX frame side by side **with the labels removed**, picks the
Kenosis frame — and can say why in terms of composition, material
response and light rather than novelty.

This document is what every critic round is scored against, so that
"it looks better now" is a measurement instead of an opinion.

---

## 1. How a round runs

```bash
node scripts/saintfall-shots.mjs --page saintfall-white-vigil.html \
  --out output/saintfall/summit/shots --quality ultra --eye
```
```bash
node scripts/saintfall-blind-compare.mjs \
  --ours output/saintfall/summit/shots \
  --refs output/saintfall/summit/baseline-vesper \
  --out  output/saintfall/summit/blind/round-N --seed N --pairs 12
```

The critic is shown `pair-NN/sheet.png` and nothing else. It does not
see filenames, does not see `_key.json`, and is not told which level is
which — or even that the two sides are different levels. Then:

```bash
node scripts/saintfall-blind-compare.mjs \
  --reveal output/saintfall/summit/blind/round-N --answers A,B,A,...
```

**Two rounds, in this order, and the order matters.**

1. **`--mode identify`** first. The critic is asked *"which of these two
   was made by the same hand as the other pairs?"* — i.e. can it tell
   the sides apart at all. Scoring at or near 50% means the set is
   genuinely blind. **Scoring above 65% means something is leaking**, and
   a preference round run on a leaky set measures the leak, not the art.
   Find the tell and fix it before going on.
2. **`--mode prefer`** second, and only then. *"Which frame is the
   better-looking game?"* A tie is a loss.

## 2. What the critic is instructed to be

Harsh. Specifically:

- It is reviewing a shipped AAA title, not a hobby project, and it is
  writing for an art director who will act on every sentence.
- It must name the **single worst thing** in each frame it rejects, with
  a location in the frame, and say what the fix is.
- "Looks nice" is not a review. Neither is a list of adjectives.
- It may not credit novelty. Snow is not automatically more impressive
  than sand; a mountain is not automatically more impressive than a
  basin. The question is only which frame is better MADE.
- It must assume the other side is also ours and also improvable. It is
  not being asked to be kind to either.

## 3. The seven axes

Every frame is scored 0-5 on each. A frame that scores below 3 on any
axis fails the round regardless of its total.

| axis | what a 5 looks like | what a 1 looks like |
|---|---|---|
| **Composition** | The frame has a subject, a foreground and a read. Something leads the eye. | A landscape photographed at random. Nothing is nearest, nothing is furthest. |
| **Value structure** | A full range with a deliberate distribution: real blacks, protected highlights, and the brightest thing in frame is the thing that should be. | One mid-grey band. Or blown white. Or a black floor everything converges on. |
| **Colour** | Lit and shaded surfaces differ in HUE, not merely in level. Accents survive the grade. | Shadow is the key light at lower brightness. Or one global tint over everything. |
| **Material response** | Surfaces read as different substances: this scatters, that reflects, that one is rough. Specular behaves. | Everything shares one roughness. Snow reads as plastic; ice reads as blue plastic. |
| **Silhouette & scale** | You can tell how big things are without being told, and the shapes are legible against the sky. | No scale reference. Shapes merge into their background. |
| **Micro-detail** | The near field rewards looking at it. Relief at every scale down to the pixel. | Flat polygons up close. Detail that stops at 20 m. |
| **Atmosphere** | Depth is carried by air. Distance desaturates and lifts in a way that reads as a real medium. | A flat fog lerp, or no depth cue at all. |

## 4. Kenosis-specific tells the critic must actively hunt for

These are the ways *this* level fails, listed so a critic does not have
to rediscover them:

1. **White mush.** Snow that has lost its hue swing and reads as grey
   concrete. Symptom: the shadow side of a drift is the same hue as the
   lit side.
2. **Plastic snow.** No micro-relief, so a 200 m snowfield is one
   smooth-shaded surface. Symptom: the terminator on a drift is a hard
   line.
3. **Sticker props.** Anything standing *on* the snow rather than *in*
   it. Symptom: a hard contact line where a prop meets the ground with
   no drift piled against it.
4. **The paper mountain.** The peak reads as a flat cutout because the
   aerial perspective is not height-dependent. Symptom: the summit is
   the same haze as the valley at the same distance.
5. **Painted crevasses.** A dark line on the ground you can walk over.
6. **Weatherless.** No spindrift off the ridges, so the mountain looks
   like a model rather than a place with wind.
7. **A cathedral that is a smaller Vesper cathedral.** If the summit
   building reads as the same building in white, the level has no second
   act.
8. **Blown snow (the other kind).** The bloom threshold left at the
   desert's, so the whole snowfield glows and the braziers lose.
9. **Dead contacts.** The AO key exemption switching occlusion off on a
   bright scene, so nothing has a contact shadow and the frame has no
   form.
10. **Corduroy or plaid.** Sastrugi trains on more than one heading, or
    fine enough to alias at range.

## 5. Reporting

Each round appends to `docs/saintfall-summit-critique-log.md`:

- round number, seed, mode, and the raw result line the reveal prints;
- per-pair: which side won and the critic's one-sentence reason;
- the top three defects named, in priority order;
- what was changed in response, and the round number that re-tested it.

A defect is not closed because it was fixed. It is closed when a **later
blind round stops naming it.**
