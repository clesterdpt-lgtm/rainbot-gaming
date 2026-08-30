# SAINTFALL — per-boss art direction

Companion to `docs/saintfall-boss-aaa-brief.md`. The brief says what "AAA"
means and how it is scored. This says what each boss is supposed to LOOK like,
so eight agents do not invent eight different games.

## The one rule that applies to every boss

**A boss may not wear its district's sand.** Look at
`output/saintfall/abbess-shots/02-head-on.png`: the Abbess is the same brown,
at the same value, as the dune in front of her and the ridge behind her. She
reads as terrain. Nothing about surface detail fixes that, because the failure
happens before detail is resolvable — at the silhouette, at 40 m.

Halo never did this. The Hunter is blue-violet plate over orange flesh in a
grey-green corridor. The Elite is iridescent purple in a sand-coloured valley.
The creature is always a different **hue family AND a different value band**
from what is behind it.

Vesper-IX's ground is warm orange-brown at mid value, its sky is pale warm, and
`DISTRICT_TINT` in `art.js` already gives every district its own cast. So each
boss below is assigned a separation strategy against its own district, and it
is not negotiable:

| boss | district ground | boss must separate by |
| --- | --- | --- |
| Winnower | Censer Works, dark warm grey `#6a5a52` | **value up and hue in** — near-black char body, furnace-orange interior |
| Distaff | Glass Scar, cold blue-grey `#6f8b98` | **value down, hue cold** — pale bone-white and glass teal |
| Garner | Ossuary, pale bone `#cfc7a8` | **value down hard** — wet dark maw against chalk |
| Abbess | Bloom, violet `#6f5480` | **saturation and glow** — translucent lit abdomen, violet chitin |
| Stylite | Choir Spires, warm rock `#a98a72` | **camouflage, then break it** — see below |
| Matriarch | Gilded Reach, warm gold `#f2c88a` | **metal against sand** — verdigris and blackened bronze |
| Coulter | the Fallen Saint, warm `#d9a97a` | **wet against dry** — slick dark hide, sand-caked topside |
| Apostate | the Cathedral, grey-taupe `#bfa88c` | **the player's own palette, corrupted** |

You have a free hand to repaint: `COLOR_0` is authored per-vertex in the `.glb`
but nothing stops the surface kit remapping it through a palette in-shader. A
recolour needs no Blender round-trip. Use it.

## The bosses

### The Winnower — Censer Works, flying insect

It lives in a furnace and its gut *is* one. It should look like something that
has been on fire for a long time and is used to it.

- **Body:** carbon-black chitin, matte and sooted on top, with heat-cracked
  fissures where the shell has split. Char reads as value, which is the whole
  separation strategy — everything else in the Censer Works is mid-grey smoke.
- **Interior:** the furnace glows through the fissures and between the plates.
  Brightest at the gut, banding down the abdomen. This is the boss's light
  source and it should light its own underside and the ground beneath it.
- **Heat sacs** (the shootable weak points on the wing roots) must be
  legible from the ground at fighting distance: swollen, translucent, lit from
  within, and visibly *deflating* as they are drained. A weak point a player
  cannot find is a mechanic that does not exist.
- **Wings:** thin translucent membrane, veined, backlit by the flare stacks.
  Soot builds toward the roots.
- **Motion:** it is heavy and it is flying. Wingbeat should push air — dust
  off the ground on low passes, embers shed on every beat, the body sinking
  slightly between beats rather than floating on rails.
- **Stoke** (the scheduled landing) is the fight's held breath: wings fold,
  the gut goes dark, and it re-lights in a stage the player can watch happen.
  Make the re-light an event — a visible pressure build, then a flare.

### The Distaff — Glass Scar, eight-legged guardian

It has been standing in a glass crater long enough to have become part of it.

- **Body:** pale chalk-white chitin, chalky and dry, with **glass fused into
  the shell** — shards catching the sun along the leg tops and the carapace
  ridge. Those glints are the surface read, and they are cold against a warm
  world.
- **Legs:** the fight's first half is legs, so legs get the detail budget.
  Segment joints wrapped in dried silk. A broken leg must read as *broken* from
  50 m: a wet dark fracture, the segment hanging, silk trailing.
- **Underside:** what the player sees once it collapses, and currently nobody
  has looked at it. Soft, unarmoured, wet, a different material from the top.
  This is the reward for breaking eight legs and it should look like one.
- **Silk:** cold blue-white, translucent, catching light. Not white polygons.
- **Motion:** nine metres of animal on eight legs. Every step should transmit
  into the body; the body should never translate on a rail. Camera shake and
  dust on foot plant, scaled by how close the player is.

### The Garner — the Ossuary, pit

Fully procedural — every vertex is built in the module, so there is no model
constraining you.

- **The rim** is bone and ossified matter, chalky, bleached, dry. The Ossuary
  is already pale, so the rim must go slightly darker and much rougher, or the
  pit disappears into its own district.
- **The maw** is the opposite: wet, dark, glistening, ringed with translucent
  soft tissue. The value drop from bleached rim to wet throat is the whole
  image, and it should be visible from the far side of the arena.
- **The arms/limbs** are the readable threat. Chitin over sinew, wet at the
  joints, dry and dusty at the tips where they drag through bone meal.
- **Motion:** a pit cannot dodge, so its drama is entirely in anticipation —
  the ground trembling before a lash, the rim shedding dust, the maw dilating
  before an inhale. Sell the inhale with everything: dust, debris, the player's
  own footing.

### The Abbess — the Bloom, termite queen

The best subsurface-scattering subject in the game and currently the flattest
thing in it.

- **Abdomen:** hugely swollen, translucent, **lit from inside** — brood light
  glowing through a stretched membrane, veined and mottled, wet where it meets
  the thorax. It should read like a lamp with something moving in it. As she
  loses health the light should sicken.
- **Thorax and head:** hard violet-black chitin, glossy, in hard contrast to
  the soft abdomen. Two materials, unmistakably.
- **The ventral weak point** (the `sac` hit model) needs to be a place a
  player can *see* and aim at, not a coordinate. Brighter, wetter, obviously
  softer than everything around it.
- **Eggs** are destructible and are not enemies. They should look laid — wet,
  clustered, cabled to the floor, and they should burst rather than vanish.
- **Motion:** she is enormous and mostly stationary. Weight comes from the
  abdomen lagging behind the thorax, the legs bracing before the clutch, and
  the floor answering when she slams.

### The Stylite — Choir Spires, leaping ambusher

Its camouflage is the fight's opening and it is the hardest thing here to get
right, because a boss you cannot see is also a boss nobody can admire.

- **Dormant:** genuinely stone. Same rock family as a Choir needle, dry,
  matte, dusty, with the body's own edges broken up. A player should walk
  under it.
- **The rouse** is the money shot: camouflage cracking off in sheets, the
  stone crust shedding as real debris, and the animal underneath revealed as
  something completely different — dark, wet, hot-bellied. Sell the transition
  over ~1 s, not in one frame.
- **Roused:** the belly glow is the read (per the existing design). Give it
  somewhere to fall — it should light the crown it grips and the ground below.
- **Grip** is the mechanic, so grip must be visible: claws deforming the rock,
  dust falling from the contact, and visible strain as the pool drains.
- **Motion:** the leap is the signature. Coil, launch, an arc that reads, a
  landing that absorbs through the legs and cracks the crown it lands on.

### The Matriarch — the Gilded Reach

The Bloom's former guardian, in a district of gold sand.

- **Plating:** blackened and verdigris'd bronze over violet chitin — she was
  the Bloom's, so the chitin family must match the Abbess's, and the metal must
  match the Saint's `bronze`/`verdigris` palette. She is the visual bridge
  between the two, and that is her whole design.
- Corroded metal is the best possible showcase for the surface kit: pitting,
  streaked verdigris running downward, polished high points where something
  has rubbed. Make her the demonstration piece.
- **Motion:** older and heavier than the Abbess. Armour should shift and
  settle audibly-visibly when she moves.

### The Coulter — the Fallen Saint, burrower

The player only ever sees the top third of it, which means the top third has
to carry everything.

- **Hide:** slick, dark, segmented, WET — this is the one boss whose entire
  read is specular. It has just come out of the ground, so the topside is
  caked with sand that sheets off as it rears, while the flanks stay glistening.
- **The mouth** is the weak point and must be the brightest, wettest, most
  detailed thing on the animal: ringed teeth, translucent gum, venom strung
  between the jaws.
- **Venom sacs** fill visibly before a spew. That is the telegraph and it
  should be readable at 60 m.
- **The ridge** it pushes through the sand while burrowed is the phase the
  player reads instead of fighting. It must look like displaced sand — a
  crest, a spill, dust thrown off the peak — not a moving bump.
- **Motion:** eleven metres of muscle anchored at the ground. It should coil
  and uncoil, never rotate rigidly.

### The Apostate — the Cathedral, the player's mirror

Deliberately the player silhouette. So it must be the player's *materials*
too — and then corrupted, or the fight has no image.

- **Armour:** the same Reliquary iron and gold-leaf language as the player's,
  but scarred, stripped, and growing Bloom chitin at the seams. The corruption
  should advance visibly as its phases progress.
- It is fought in the nave, under a broken vault. That is the best light in the
  game — shafts through a hole in the roof. Use them: stage the fight so it
  moves through light and shadow.
- **Motion:** it mirrors player timings on purpose. Keep that, but let the
  corruption cost it something — a hitch, a drag, a limb that answers late.

## Two things the reference does that we do not

Look at `output/reference/halo/halo-02.jpg` — the Halo 2 Scarab, and the best
boss frame in the pool. Two of the reasons it reads as a boss have nothing to
do with the model:

**1. The camera is BELOW it.** The lens is at knee height looking up, the
animal's head is against the sky, and its legs leave the frame. Every one of
our gallery portraits is shot from eye level or above, which is the angle you
photograph a prop from. A boss shot from below is a boss; a boss shot from
above is a diorama. Portrait framing should sit low and look up wherever the
encounter allows it.

**2. It has an ACCENT LANGUAGE.** The Scarab is not one colour. It is cool
blue-grey plate, and then a small number of hot orange-gold panels carrying
black hazard striping, and then one cyan core. Three families, deliberately
unequal in area: a lot of the neutral, a little of the warm, a spot of the
saturated. That is what stops a big model reading as one undifferentiated mass.

Every boss here needs its own version of that: a dominant material, a secondary
accent that appears on a minority of the surface in a repeating designed
pattern, and one saturated focal element — which for most of ours is already
the weak point, and should be. Marking, banding, striping and plate-edge trim
are all available in-shader through the surface kit's material families, and
they cost nothing extra.

## What every boss owes the frame

1. A **contact shadow** where it meets the ground. Nothing looks placed
   without one.
2. **Self-occlusion** where plate meets plate. A creature with no dark in its
   creases is a toy.
3. A **hit response** that says where it was hit, and a **damage state** that
   accumulates and stays.
4. A **death** that is a physical event: it falls, it lands, it settles, it
   leaves something behind. Not a fade.
5. **One frame that sells it** — the portrait framing in the gallery harness.
   If that frame is not something you would put on the game's page, the boss
   is not finished.
