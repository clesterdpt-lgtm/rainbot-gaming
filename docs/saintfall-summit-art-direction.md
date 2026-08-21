# SAINTFALL — THE WHITE VIGIL
### Art direction & level design brief for the second world ("summit")

> Status: authoring brief. The engineering counterpart is
> `saintfall-summit-contract.md`. Read both before touching code.

---

## 0. The one-line pitch

**Vesper-IX was a basin you cross. Kenosis is a mountain you climb.**

Everything below follows from that inversion. The first level's whole
composition is horizontal: a 2km pan with a rim you look *across*, and
districts you *walk between*. This level's composition is vertical: a
single 450m peak in the dead centre with a cathedral on its crown,
and seven arenas terraced around and below it. From the basecamp gate
you can see the destination the entire game. From the summit you can
see every place you have been.

That is the AAA idea and it is a **layout** idea, not a shader idea.
A snow reskin of a desert basin would be a worse level than the desert
basin. The peak has to be legible from the floor, the floor has to be
legible from the peak, and the route between them has to be a readable
spiral rather than a maze.

---

## 1. The world

| | |
|---|---|
| World | **Kenosis** — the ninth world of the Concord's ascent liturgy |
| Operation | **The White Vigil** |
| The mountain | **The Ascendant** (peak 452m above the basecamp pan) |
| Summit structure | **The Cathedral of the Ninth Ascent** |
| Map | 2048 m square, same chunk/LOD scaffold as Vesper-IX |
| Time of day | Default **alpenglow** (low sun, pink on the snow, deep blue shadow). Also: whiteout, high noon, and blue hour. |

### Why it is cold

Kenosis is a *high* world, not a frozen one — the thing that kills you
is altitude. Below ~120m there is a permanent **cloud inversion**: a
flat white sea of stratus lying in the ring valley. Above it the air is
thin, the zenith is almost navy, and shadows are lit only by bounced
snow and sky. That inversion layer is the single most valuable image
in the level: it gives every high shot a horizon that is *not the map
edge*, and it is why the map does not need a rim.

---

## 2. Layout — the spiral

```
                        N
        [ Frozen Cascade ]        [ Fumarole Steps ]
              (N, 210m)               (NE, 160m)

  [ Glacier Tongue ]                       [ Rime Forest ]
      (NW, 95m)          ▲ SUMMIT              (E, 140m)
                      Cathedral of
                    the Ninth Ascent
  [ Bell Terrace ]        (452m)            [ Avalanche Bowl ]
      (W, 240m)                                 (SE, 60m)

        [ Black Tarn ]            [ THE BASECAMP ]
           (SW, 40m)                  (S, 0m — spawn)
                        S
```

**The Via Sacra** is one continuous switchback road from the basecamp
gate to the cathedral parvis. It climbs anticlockwise, and each arena
hangs off it as a spur. You are never lost, because you can always see
the peak and always see the road. Arena altitudes are deliberately
*not* monotonic with the spiral — the Bell Terrace at 240m sits above
the Cascade at 210m — so the climb does not feel like a staircase.

### The seven arenas, and what makes each unmistakable at 600m

1. **The Glacier Tongue** (NW, 95m) — a blue-ice river 380m long spilling
   off the north shoulder. Seracs the size of houses, a crevasse field
   with real gaps you must route around, three moulins, and a terminal
   moraine of dirty ice and rock. *Silhouette: a wide pale-cyan wedge.*
2. **The Frozen Cascade** (N, 210m) — a 130m waterfall caught mid-fall.
   A cirque amphitheatre behind it; the ice is columnar, translucent,
   and lit from behind at alpenglow. *Silhouette: a vertical white organ pipe.*
3. **The Fumarole Steps** (NE, 160m) — the mountain is not dead. Sulphur-
   stained terraces, steam venting through snow, rime-free black rock
   and orange crusts. The one warm-hued place in the level, which is
   exactly why it exists. *Silhouette: a stepped dark stain with plumes.*
4. **The Rime Forest** (E, 140m) — a stand of petrified conifers armoured
   in horizontal wind-driven rime feathers, all pointing the same way.
   Snow-loaded, blue-shadowed, and the only place with a canopy.
   *Silhouette: a bristling dark band.*
5. **The Avalanche Bowl** (SE, 60m) — a vast open snowfield under a
   loaded headwall, cut by old debris cones, with a snow bridge over a
   runnel. Wind-sculpted sastrugi read as ripples at grazing light.
   *Silhouette: a clean white bowl — the level's negative space.*
6. **The Black Tarn** (SW, 40m) — a frozen lake of black ice, pressure
   ridges, thermokarst cracks, and drowned pilgrim statues standing in
   it to the chin. Reflective, dark, and the sky's mirror.
   *Silhouette: a flat dark oval.*
7. **The Bell Terrace** (W, 240m) — the ruined Carillon Priory clinging to
   a west-facing cliff: broken cloister arcades, a collapsed campanile,
   and nine frozen bronze bells, one of them fallen through the floor.
   *Silhouette: a broken comb of masonry on a cliff edge.*

**The Basecamp** (S, 0m) is the landing zone and the tutorial view:
you arrive on a gravel-and-snow pan at the mouth of the valley with the
entire mountain framed by two rock buttresses.

---

## 3. The summit

The **Cathedral of the Ninth Ascent** must not be the Vault-Cathedral in
white. Vesper's cathedral is a *ruin lying open* — a broken nave with a
collapsed chancel you walk into. This one is the opposite: **intact,
sealed, and small**. It is a high-altitude reliquary chapel, not a
basilica; the awe comes from where it is, not how big it is.

- Sited on a summit **parvis**: a levelled ring 78m across with a
  parapet, reached by the last switchback and a flight of 40 steps.
- Cruciform, ~54m long, with a single 62m spire. Steep roof pitches so
  snow sheds; every ledge grows an icicle fringe.
- Stone is a pale grey-green granite, wind-polished on the windward
  face and rime-caked on the lee. **The rime is directional** — driven
  horizontally by the same wind vector as everything else in the level.
- A rose window on the south front, glazed with *ice* rather than
  glass: it transmits a cold blue and casts a real coloured pool on the
  floor at alpenglow.
- Nine bronze **votive braziers** around the parvis, still lit — the
  only warm light above 400m, and the thing that tells you from the
  basecamp that someone is still up there.
- The interior is one room. Rib vault, nine niches, a floor of
  polished black stone under a drift of blown snow that has come in
  under the doors. Nothing in it yet — the fight goes here later.

---

## 4. The material bible

Snow is not one material. Getting this wrong is the single most common
way a snow level looks cheap. Six surfaces, blended by slope, altitude,
aspect and curvature:

| Surface | Where | Read |
|---|---|---|
| **Deep snow** | flats, lee slopes, gullies | Soft, near-white, strong subsurface wrap; smooth-shaded. Footprints. |
| **Wind slab / sastrugi** | ridges, exposed flats | Hard, faceted, carved into parallel ridges along the wind axis. Faintly bluer. |
| **Blue glacier ice** | the Tongue, the Cascade, crevasse walls | Saturated cyan in depth, near-white at edges; depth-dependent, fractured, specular. |
| **Black ice** | the Tarn | Dark, mirror-flat, cracked; reflects sky more than it scatters. |
| **Exposed rock** | above 380m, cliff faces, wind-scoured | Grey-green granite, sharply faceted, dusted not covered. |
| **Rime** | windward faces of everything | Off-white, feathery, *directional*, grows on the wind side only. |

Rules that must hold:

- **Snow is not white.** Lit snow at alpenglow is peach; shadowed snow
  is *saturated blue*, not grey. The sunlit-to-shadow hue swing is the
  whole reason the level looks expensive. Shadow must not desaturate.
- **Snow sparkles.** Sub-pixel specular glints, view-dependent, on
  fresh snow only — sparse, small, and never on wind slab or rock.
  (The engine already has a `GLITTER_FRAG`. Extend, do not reinvent.)
- **Snow accumulates by slope and aspect.** Above ~38° it does not
  hold. Under overhangs it does not fall. On the lee side it drifts
  deeper. Every prop must be *bedded into* its drift, not stood on it.
- **Snow scatters light sideways.** Wrap/half-Lambert on the deep-snow
  material, so terminators are soft and rounded rather than hard.
- **Nothing pure white.** Clamp the brightest snow below the clipping
  point so the bloom has somewhere to go and the cathedral's braziers
  are still the brightest thing in frame.

---

## 5. Atmosphere & sky

- **Aerial perspective is the star.** In thin cold air, distant ridges
  go *blue and pale* fast. Fog must be **height-dependent** — dense in
  the valley, thin at the summit — or the peak reads as a flat cutout.
- **The cloud inversion** at ~120m: a flowing stratus deck the player
  can descend into. Below it, visibility drops and everything goes
  monochrome; above it, hard sun and violent contrast.
- **Ice-crystal optics**: a 22° solar halo, and sun dogs at the same
  radius on the horizontal. This is free-looking realism that almost no
  game bothers with, and it is unmistakably *cold*.
- **Spindrift**: snow smoking off every ridgeline, always downwind,
  always at the same angle. Visible from across the map — it is what
  makes the mountain look like it has weather rather than paint.
- **Ground blizzard**: low, fast sheets of blown snow crossing open
  flats, keyed to the same wind vector.
- **Crepuscular light** through the Cascade's ice pillars and the
  Rime Forest canopy.
- **Sun position**: low, raking, from the SSE at alpenglow. Grazing
  light is what reveals sastrugi and rime; overhead light erases them.

---

## 6. Physics & traversal (it must *feel* cold, not just look it)

- **Snow depth** is a real field, sampled like height. Deep snow slows
  the player and raises the knee line; wind slab does not.
- **Post-holing**: in the deepest drifts the stride shortens and the
  figure sinks.
- **Ice friction**: the Black Tarn and glacier ice have low friction —
  momentum carries, turns slide. Rock and wind slab do not.
- **Slope limits**: consistent with the existing `WALK_SLOPE_LIMIT`.
  Couloirs must be walkable; headwalls must not be, or the spiral
  route is pointless.
- **Crevasses are real geometry with real gaps.** If you can walk over
  a crevasse it is a decal, and decals are not AAA.
- **Footprints** are compressed snow — darker, bluer, with a raised
  rim — and they *persist*, then fade as spindrift fills them.
- **Sluff**: small snow slides trail the player on steep faces.

---

## 7. The bar

The build is finished when a critic who has never seen either level,
shown a summit frame and a Vesper-IX frame side by side with the
labels removed, **picks the summit frame** — and can say why in terms
of composition, material response and light, not novelty.

Anything that only looks good from a floating camera is not finished.
Every claim in this document has to survive an eye-level frame at
1.7m with the player figure in it.
