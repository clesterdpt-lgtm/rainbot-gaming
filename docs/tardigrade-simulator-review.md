# Tardigrade Simulator — visual review rubric

This is the standard every visual-critic pass uses. The job of a critic is to be **harsh
and specific**. Vague praise is worthless; "the lighting is nice" tells the implementer
nothing. Every criticism must name the defect, name where it is visible, and name what
would fix it.

## The bar

> A person shown our screenshot and a shipped commercial game's screenshot side by side,
> without being told which is which, picks ours as the better-looking image.

Not "comparable to". Not "good for a browser game". **Better.** The phrase "good for
WebGL" is a failure state — if that qualifier is needed, the shot has not passed.

## Scoring

Score each axis 1–10. **7 is "a shipped game would accept this". 9 is "this is a
marketing screenshot".** Be stingy. A first pass that scores above 6 on anything is
probably being graded too generously.

| # | Axis | What a 9–10 looks like |
|---|---|---|
| 1 | **Lighting** | Clear key/fill/bounce separation. Warm sun, cool sky-shadow. Highlights roll off instead of clipping. The image has a lighting *design*, not just "a sun". |
| 2 | **Materials** | Every surface reads as a specific real substance. Correct roughness response, believable specular, real surface detail at close range. Nothing looks like flat vertex colour or obvious tiling noise. |
| 3 | **Shadows** | Crisp contact shadows where objects meet ground, softening with distance. No acne, no peter-panning, no visible cascade seams, no shimmer. Objects feel *attached* to the ground. |
| 4 | **Composition** | The frame is composed — leading lines, foreground/mid/background layering, a clear subject. Not "camera pointed at the middle of the level". |
| 5 | **Detail density** | The frame rewards looking closer. No large empty regions of untextured surface. Small-scale detail supports the big shapes. |
| 6 | **Colour & grade** | A deliberate palette. Filmic contrast. Colour variety without mud. No washed-out grey haze, no oversaturated candy. |
| 7 | **Sense of scale** | The single most important axis for this game. The image must read unmistakably as a micro-world. If it could plausibly be a normal-sized landscape, this axis scores 3 or less regardless of how pretty it is. |
| 8 | **Character** | The tardigrade is appealing, well-formed, well-lit, readable in silhouette, and clearly the subject when on screen. |
| 9 | **Atmosphere** | Air has substance — dust, haze, depth falloff, light shafts. Depth is felt, not just implied by perspective. |
| 10 | **Technical cleanliness** | No z-fighting, no clipping, no floating objects, no stretched textures, no visible seams, no aliasing crawl, no obviously repeated instances. |

## Known failure patterns to hunt for

These are the specific things that make browser 3D look cheap. Check every one on every
pass:

- **Blown-out sky** and clipped highlights from an uncalibrated exposure.
- **Grey wash** — fog or ambient light with no colour, flattening the whole frame.
- **Flat matte surfaces** with no specular response at any angle.
- **Obvious tiling** — the same texture patch visibly repeating across a large surface.
- **Clone stamping** — scattered objects that are all the same mesh at the same scale and
  rotation.
- **Floating objects** — anything not visibly connected to the ground by a contact shadow.
- **Shadow acne / peter-panning** — stripey self-shadowing, or a shadow detached from the
  object casting it.
- **Uniform detail scale** — everything the same size, giving no scale anchor.
- **Empty middle ground** — detailed foreground and detailed background with a barren gap.
- **Aliasing crawl** on foliage and thin geometry.
- **Dead air** — nothing in the atmosphere, so distance is unreadable.

## Required output format for a critic pass

```
SCORES
  lighting        n/10  - one specific sentence
  materials       n/10  - one specific sentence
  ...
  OVERALL         n/10

BLIND COMPARISON
  pair-01  picked A  because ...
  pair-02  picked B  because ...
  ...

TOP DEFECTS (ranked, most damaging first)
  1. <what is wrong> | <where it is visible> | <what would fix it> | <which module owns it>
  2. ...

VERDICT: SHIP or KEEP WORKING
```

`VERDICT: SHIP` is only permitted when the blind comparison picks our image at least as
often as the reference AND no axis scores below 7.

## Blind comparison procedure

```bash
# build a set
node scripts/tardigrade-blind-compare.mjs --ours output/tardigrade-shots/<run> \
  --out output/blind/<round> --seed <n>

# after the critic answers
node scripts/tardigrade-blind-compare.mjs --reveal output/blind/<round> --answers A,B,A,...
```

Each `pair-NN/` folder holds `A.png`, `B.png` and `side-by-side.png`. The critic reads the
images and answers with a letter per pair. **The critic must never read `_key.json`.**

Judge the 3D rendering only. Ignore HUD overlays — the reference screenshots ship with
their HUD burned in and ours are captured with the HUD hidden, so UI presence is a tell,
not a quality signal. Ignore subject matter; a goat is not inherently better or worse
than a water bear.
