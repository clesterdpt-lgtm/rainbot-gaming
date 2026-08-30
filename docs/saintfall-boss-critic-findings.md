# SAINTFALL — what the blind critics said

Five independent hostile art directors, each shown blind pairs of our boss
frames against real original-Xbox Halo frames, each told nothing about which
side was which, each instructed to judge craft rather than recognition.
**Every one of them picked Halo in every pair.**

| review | score |
| --- | --- |
| ten-pair round (Stylite + Coulter) | **ours 0 / 10** |
| the Winnower | **ours 0 / 5** |
| the Distaff | **ours 0 / 5** |
| the Coulter | **ours 0 / 5** |

## The convergence is the finding

These reviews ran separately, by different agents, on different bosses, with
no shared context. They did not agree because they were told to. Every single
one named the same thing first:

> **No occlusion darkening at contact — at any scale.** Where plate laps
> plate, limb meets body, or armour meets undersuit, nothing gets darker.
> Creatures do not darken the ground they stand on. Every glowing element
> contributes zero illumination to its neighbourhood. They are all stickers.

Nobody said "low-poly". Nobody said the art direction was wrong — one review
went out of its way to say the style is fine and that our best frame proves
the direction can stage a shot. The defect is that the renderer never darkens
anything where two things meet, and once a viewer notices it, every frame
reads as flat-shaded props hovering over a painted backdrop.

Three failure modes recur near-verbatim across all five:

1. **Contact.** No per-foot shadow; blob decals that follow neither the body
   outline nor the scene's light direction; limbs terminating in mid-air.
2. **Cavity.** No darkening at any seam, overlap or joint, so a boss resolves
   as one continuous cutout instead of a stack of parts. Both Halo wins in
   the Winnower round were awarded explicitly on "soot in the cavities".
3. **Emissive.** Every glow is a hard-edged flat quad that lights nothing —
   no falloff into the surrounding shell, no bounce onto the ground beneath.

A fourth, nearly as common: **single-sided zero-thickness geometry** (spikes,
blades, palps, hair cards) that vanishes edge-on, and **flat ribbon limbs**
whose inner face reads lighter than their outer face — geometrically
impossible, and it reads instantly as a plane pretending to be a leg.

## Per-boss work lists, in the critics' own words

### The Winnower — ours 0 / 5

1. SUBJECT/BACKGROUND SEPARATION (cited in 4 of 5 of our frames, and the stated deciding reason in pair-01 and pair-04). Our panels are a single orange hue band — 'mean 53, saturation 0.58 across a single orange band', 'the right wing tip dissolves into the dune entirely', repeated verbatim in pair-04. The Winnower must not share hue AND value with the sand it flies over. Needs a cool/desaturated rim or backlight on the carapace, a value push between subject and dune, or a hue shift in the creature's dark chitin away from the sand's orange. This one change moves more pairs than everything else combined.

2. CAVITY DARKENING AND SELF-SHADOW — none exists anywhere on our model. 'The black carapace has zero cavity darkening' (pair-01), 'where the wing crosses the abdomen there is no self-shadow, so the two read as one continuous flat surface and the wing loses its identity as a separate limb' (pair-04), 'the ring divisions are geometry with no texture bridging them and no darkening in the grooves' (pair-03), 'no occlusion at the join... the seam line is lighter than both lobes' (pair-02). Both Halo wins were explicitly awarded on 'soot in the cavities' and 'cavity soot in every plate recess'. Needs baked AO or an AO/cavity term in the material, plus self-shadow casting enabled on the wings.

3. FLAT EMISSIVE PANELS. 'The orange emissive panels butt directly against unlit black with a hard stair-stepped polygon boundary and no transition value, so the panels read as holes cut in card rather than glowing tissue under plates' (pair-01); repeated in pair-04 ('hard-edged unshaded polygons with stair-stepped boundaries; they never gradate into the surrounding chitin') and pair-05 ('flat-filled quads with no gradient across their surface, sitting against near-black chitin with no cavity or transition'). The emissive needs a falloff/bleed into surrounding chitin and its boundary needs to stop being a raw polygon edge.

4. UNTEXTURED PLACEHOLDER PRIMITIVE SHIPPED IN 01-portrait.png. 'A bare flat-shaded orange hexagon floats at centre-right: single flat fill, no shading gradient across its faces, no specular, no shadow, no scene context.' The critic led its entire pair-05 verdict with this. Cheapest fix on the list and it single-handedly decided a pair — find what that hexagon is (untextured prop, debug gizmo, or an unskinned emitter mesh) and remove or texture it.

5. CONTACT SHADOWS — cited on every one of our frames that shows ground. 'The only darkening under the body is a broad soft blob that does not follow the body outline, and it sits at a different angle from the long cast shadows the rails throw' (pair-01); 'a wide soft ellipse offset to the LEFT of the body it belongs to and shaped nothing like the creature' (pair-05); 'soft undirected darkening under the creature' that contradicts the scene's hard directional shadows (pair-02). The blob shadow must at minimum be centred under the body and share the scene light's direction; a shaped/projected shadow would be better.

6. GROUND TEXTURE TILING, visible at full strength in 4 of our 5 frames. 'A repeating diagonal stripe lattice runs uninterrupted across the whole sand plane with no breakup, decal or detail map' (pair-01, repeated in pair-02, pair-04, pair-05). Needs a detail/breakup layer, UV rotation or noise-driven blend. Cheap, and it is polluting every screenshot the boss appears in.

7. SINGLE-SIDED FLAT-PLANE GEOMETRY. 'The spikes and blades are single-sided flat planes: several of them show their edge-on sliver mid-frame and effectively vanish' (pair-01). The critic's summary of pair-01 called our whole boss 'a stack of zero-thickness planes whose head, thorax and tail cannot be told apart at any zoom' — the single harshest sentence in the review. Spikes/blades/wings need thickness, or at least double-sided shading with a normal flip.

8. GROUND RITE DECAL DEPTH AND MOIRE (pair-04). 'The ground rite effect is a flat projected decal that draws over and through the creature's legs — the orange sits at the wrong depth and there is no depth sort against the body at all', plus 'concentric-ring moire aliasing across its whole radius'. Fix the depth sort against the boss body and add mip/AA to the ring texture.

9. SMOOTH UNTEXTURED BODY SURFACES (pair-03, our 04-impact). 'The abdomen is a smooth lozenge carrying only a faint speckle — no scale, plate seam or grain at all... it reads as moulded plastic', 'the segmented section beneath it is visibly a bare quad cylinder', and 'the eye is a plain orange sphere... no socket darkening, no cornea highlight... it reads as a bead glued on'. Needs surface grain/plate seams on the abdomen and socket geometry around the eye.

10. BLOWN HIGHLIGHTS WITH NO STRUCTURE, across three of our frames. 'The blowout at centre clips to flat white with no core-to-halo structure, so the brightest event in the frame has no shape' (pair-02); 'a large amoeba clipped to pure white with no falloff shape or highlight geometry' (pair-03); 'a blown white smear with no core, clipped to pure white' (pair-05). Give flares a core-to-halo falloff and stop the specular clipping to a shapeless white mass.

11. PARTICLES AND GIBS. 'Large soft round blobs with no internal shape, no size variance and no orientation; they read as out-of-focus dots rather than sparks or chitin fragments' (pair-02); 'flat two-tone paper triangles at a single unlit value, all facing camera with no rotation variety — they read as confetti, not tissue' (pair-04). Needs per-particle rotation, size variance and lit/shaped sprites.

12. WING/BODY INTERPENETRATION (pair-02, our 03-telegraph). 'The wing planes clip straight through the thorax at lower centre with no intersection darkening and no self-shadow — the geometry is interpenetrating, not attached', and the head/thorax and abdomen are 'two ellipsoids pushed into each other'. The wing roots need actual attachment geometry, not planes pushed into a lobe.

13. VALUE RANGE COMPRESSION in 02-full (pair-04): '38% dark pixels but essentially no bright anchor (0.1% above 230) — the value range is compressed into a mid-dark orange band with nothing to read against.' Needs a bright anchor in frame.

14. FLAT-SHADED FACETED BACKGROUNDS (pair-03, pair-04): 'Background mountains are flat-shaded facets, one value per triangle, with no atmospheric value shift with distance', 'large untextured flat-shaded facets, one value per plane, with visible banding on the largest wall.' Add aerial perspective / distance fog gradient and dither the banding.

15. FRAMING: the boss's ground contact is cropped out of 04-impact ('there is no weight evidence in the frame at all') and the top 40% of that frame is empty sky. Recompose the capture so feet and contact are in shot — the critic treats missing contact as missing weight, which is a structural read, not a taste one.

16. FOOTPRINT DECALS (pair-05): 'soft ellipses scattered at inconsistent depths and orientations, none aligned to a stride or to the light direction.' Align to stride and light.

### The Distaff — ours 0 / 5

1. GROUNDING (worst, named by the critic as the overall worst defect, hit in 4 of our 5 frames — 02/A, 03/A, 04/B, 05/A): the Distaff never touches the ground. Not one of the eight feet casts a contact shadow or darkens the mound; in 02/A four front legs terminate blunt in mid-air at four different heights unrelated to ground curvature, and in 04/B two left legs have a visible gap under them. The only grounding cue in the whole set is a soft dark ellipse under the abdomen that does not follow leg placement — a blob-shadow decal. Fix: real per-foot contact AO or per-leg shadow casting, plus IK that actually plants tips on groundHeightAt.

2. CAVITY / AO AT EVERY SEAM (01/B, 03/A, 05/A): zero cavity darkening where any leg meets the body, and adjacent facets butt at identical brightness, so the entire animal reads as one continuous shell with no anatomy. Bake or shade occlusion at leg-to-thorax joints and facet-to-facet seams — this is what turned 'boss' into 'pile of same-value facets' in pair-01.

3. LIMBS READ AS FOLDED PAPER, NOT TUBES (01/B, 04/B): each femur is a single flat plane with a specular stripe running unbroken end to end and a hard crease where the ribbon turns; joints are dark dashes painted on a flat strip rather than modelled cavity. Give segments a real cross-section (even 4–6 sided) and break the specular run.

4. SILHOUETTE / HEAD READ (01/B): the thorax between the front leg pairs is an undifferentiated same-value jumble — no head, no eye cluster, no front-to-back orientation. The critic noted a tiny background spider had a more legible silhouette than the foreground boss. Needs value separation and a readable head mass.

5. THE MOUND HAS NO SURFACE (02/A, 03/A, 04/B): a pure smooth gradient with no texture at any frequency (vector art at 3x), stepped horizontal banding when lifted, and a hard low-poly polygon edge against pure black with no falloff or AO where it meets darker ground. Give it grain at two frequencies and fade the silhouette edge.

6. TWO INCOMPATIBLE MATERIAL LANGUAGES (02/A, 03/A, 05/A): the smooth glossy abdomen dome and the faceted crystal cephalothorax meet in a razor-clean seam with no occlusion, so the body reads as two props butted together; the abdomen has no chitin grain, pores or wear at all.

7. UNLIT BLACK MASSES (03/A, 05/A): the black slab across the back in 03/A is a hard-edged, completely unshaded plane intersecting the abdomen with a raw boolean seam and zero AO; the pedicel/spinneret mass in 05/A is pure unlit black with a hard silhouette while the mound centimetres away is fully lit. Both read as holes punched through the frame, not body parts.

8. UV STRETCHING AND SCALE MISMATCH (02/A, 04/B, 05/A): the mottled grey noise is the body texture at a far coarser UV scale, smears lengthwise along long leg segments, and changes scale segment to segment; the same tiling noise appears on head facets and legs at different scales.

9. SINGLE-SIDED GEOMETRY (02/A, 03/A, 05/A): mouth palps are no-thickness quads that flip to nothing at grazing angles, and the abdomen is ringed by single-sided white hair quads. Cheap to fix, and it is a hard tell.

10. ENVIRONMENT / LIGHTING CONTEXT (01/B, 04/B): the background is a black void with flat unlit triangles standing in for rock, the arena has no depth and no bounce, and the dark spire at upper right in 01/B has an implied light direction that disagrees with the lit ground plane beneath it. In 01/B the frame's 5th-percentile value is 7/255 — the entire left half carries no information and the leg tips vanish into it.

11. PLACEHOLDER GEOMETRY LEFT IN SHOT (05/A): the small dark pyramid on the mound at right is an untextured flat-shaded cone. Remove or texture it.

### The Coulter — ours 0 / 5

1. Crushed-black single diffuse with zero self-occlusion at plate overlaps. Named in ALL FIVE of our panels and elevated to worstDefectOverall. Hood-over-neck, wing-over-thorax, abdomen-ring-over-ring and thorax/abdomen join all sit at one near-black value, so the creature carries exactly one information channel: its outline. Fix: an AO/cavity term darkening every under-slid plate edge, and lift the body's base value off black so there is range left to darken into.

2. No directional light term on the shell. Stripe and plate brightness is identical on the sunlit top of the hood and its shadowed underside; frontal plates and receding side plates read the same, so the form never turns and the boss is a flat cutout (pairs 01, 04, 05). Fix: make the ridges take the sun, with a broad anisotropic highlight along the abdomen's top ridge — the critic notes there is currently zero specular anywhere on the chitin (pair 03).

3. Silhouette is not legible as a creature. In three of five frames (01, 02, 05) the critic could not find a head, limbs, front or back; pair-01 could not tell which end bites, pair-05 says 'the creature cannot be identified as a creature'. This is downstream of the two items above but must be re-checked as its own pass/fail after they land — it is the single reason three pairs were lost 'decisive'.

4. No contact shadow anywhere. Named in all five: no occlusion, no sand displacement, no dust, no sand mound where the body rests in or erupts through the dune; pair-01's right leg terminates in motion blur with nothing under it; pair-05's body enters the dune along a hard straight polygon crease. The reference won pair-03 partly on contact weight. Fix: contact shadow plus displaced-sand mound and a dust term at every body/ground intersection.

5. Emissive is a hard-clipped flat quad that lights nothing. Chartreuse eyes (pair-02 blobs, pair-04 quads with a visible polygon outline and no socket cavity), the green organ glow (pair-03) and the chartreuse belly glow (pair-01) all clip flat with a hard silhouette edge, no falloff onto surrounding chitin, and the ground directly beneath the belly glow is exactly the shadow maroon. Fix: falloff onto the shell, real socket geometry for eyes, and a bounce term on the ground under the belly.

6. Stripes read as a projected decal, not chitin. Uniform width and spacing running straight across faceted panel breaks with no crowding as the surface turns away (pair-01); direction breaks abruptly at each polygon edge because the pattern is generated per-face and does not wrap, which exposes the low-poly cage (pair-03).

7. Loose black polygon slivers floating unattached around the legs, mandible and neck, plus mid-air debris slivers across the frame (pairs 01, 02, 04, 05). Degenerate faces poking through the shell. Also pair-02's 'bright tan slivers' — near-degenerate triangles or z-fighting between overlapping plates.

8. Untextured white sprite ball / particle billboard at bottom-centre, called a never-art-passed placeholder (pairs 01, 02, 05). Cheap to fix and it is currently reading to the critic as unfinished work, which colours the whole judgement.

9. Terrain shading failures under the boss. A regular square grid seam visible in the lit sand (the heightfield's UV grid through the diffuse), single-axis stretch-smear banding where low-frequency noise is squashed along dune slopes, and a horizontal seam across the mid-right dune (pairs 01, 05).

10. Flat untextured tan quads used as ground debris and broken sand crust: straight polygon edges, zero thickness, no cast shadow, one floating clear of the ground, and holding full lit-sand brightness while sitting inside the dune's shadow (pairs 02, 04).

11. Additive green shafts render over the carapace instead of behind it — depth-sorting failure that visually cuts the body in half (pair-02).

12. Framing: in pair-02 the subject occupies roughly a fifth of the frame and the most detailed thing in the shot is the background dunes. Structural composition problem for a boss telegraph pose.

13. Airbrushed leopard-spot patch on the upper carapace sits soft against hard-edged faceted geometry everywhere around it — two incompatible material languages on one creature (pair-01).

14. A solid-black spider silhouette at frame left with no shading whatsoever — a pure alpha cutout standing in a lit scene (pair-05).

## Not yet reviewed

The Abbess, the Garner, the Apostate and the Matriarch have had no blind
review. The Abbess has had no build pass at all — two attempts died on an
account spend limit — and she is currently the weakest boss in the game.

## Follow-up: the "green mass" is narrowed, not yet fixed

The critic's number-one unshippable item — *"untextured, unlit and
semi-transparent… the red dune's silhouette is visible THROUGH its lower half,
and its own back faces show through its front faces as a lighter internal edge
network"* — reproduces on the current build. Evidence: the right-hand third of
`output/saintfall/gallery/verify-contact/coulter/02-full.png`, and a 2x
nearest-neighbour zoom of it, which shows large flat planes with hard straight
polygon boundaries and the terrain's own ripple banding clearly visible through
them.

What it is **not**, established rather than assumed:

- **Not broken geometry.** `__SF.auditMeshes()` reports `saint-bronze` (6,996
  tris), `saint-rust` and `saint-cloth` with `degenerate: 0`, `tiny: 0`,
  `nonFinite: 0`, `badNormals: 0`.
- **Not the Fallen Saint's own material.** The whole Saint block in `world.js`
  emits only `batch.add("saint", …)` with `"bronze"`, `"rust"` and `"cloth"`,
  and none of those three is transparent. `cloth` is `DoubleSide` but opaque.

What it might be, with the evidence for and against each — this is a LEAD, not
a diagnosis, and the next person should test before building:

- **A transparent glow card.** `glow` in `art.js` is the only transparent
  material in the palette, and it is `transparent: true`, `depthWrite: false`,
  `side: DoubleSide`, `AdditiveBlending` — a combination that produces every
  symptom the critic listed, including back faces adding over front faces as a
  "lighter internal edge network". **Against it:** `vfx.js` contains no emitter
  placed at the Fallen Saint, so nothing obvious is drawing one there. Check the
  light-shaft emitters first; this project has already recorded, in
  `saintfall-light-shafts`, an additive cone shell whose silhouette shows unless
  a chord term hides it.

- **The Saint's own head, misread.** The head is bronze with a verdigris patina,
  which is green, and its vertex paint carries a literal streak pattern —
  `Math.sin(x * 0.09 + z * 0.07)` in the Saint block of `world.js`. That would
  produce banding very like what is visible through the "transparent" region. On
  this reading the object is opaque and the real defect is different: a 108 m
  landmark whose surface is a low-frequency painted streak with no material
  response at all, seen through enough aerial haze to wash its value flat.

Both readings agree on one thing and it is the actionable part: **the largest
object in that frame carries no material response** — no cavity, no specular, no
grain that scales — and it sits at a value close enough to the haze behind it
that its silhouette stops reading. Whether the mechanism is a stray additive
card or flat painted bronze, that is what a viewer sees.

It is NOT a Coulter defect and must not be fixed inside `coulter.js`.

## Open regression: the downed Stylite is unreachable

`scripts/saintfall-stylite-fight.mjs` is **32/33**. The failure:

```
FAIL  ...and a player can walk into melee range of where it lands
      closed to 12.2m through real collision      (the gate is < 3.5m)
```

It is deterministic — 12.2 m on every run — and it is **not** caused by
removing the knee pip. Isolated by putting the pip back and re-running: still
12.2 m. It arrived with the round-1 Stylite rebuild, which is in the tree but
whose agent died on a spend limit before reporting.

Why it matters more than a failing number: this is the exact promise the
module's own comment says nothing else in the suite catches. The fall still
happens, it still costs health, it still leaves the animal stunned and
grounded, and it still clears the needle by 11 m — every other assertion about
the fall passes. The animal is simply somewhere no player can reach, so the
reward for breaking the grip is sealed off. The suite caught the same class of
bug once before, when the first version dropped it down the needle's axis and
buried it inside the spire.

Where to look first: the rebuild introduced a **crust** — a separate shell of
stone shards in the needle's own rock, welded over the carapace while the
animal sleeps and shed as real falling debris when it wakes. If those shards
are colliders, or if the crust mesh is inside whatever volume the player
collides against, a ring of debris around the landing site would stop an
approach at roughly that distance. Test the shed debris first.
