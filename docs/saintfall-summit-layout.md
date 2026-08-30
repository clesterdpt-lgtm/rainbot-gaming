# THE WHITE VIGIL — authored layout numbers

Every coordinate in the level, fixed here so terrain, world, weather and
the harness cannot disagree. Axis convention is inherited from Vesper-IX:
**+Z is south, −Z is north, +X is east, −X is west.** Map is 2048 m square,
`MAP_HALF = 1024`.

---

## 1. The elevation profile

`y = 0` is the ring-valley floor. The mountain is a single radial profile
with noise on top, so the silhouette is authored rather than emergent.

| radius from (0,0) | elevation | character |
|---|---|---|
| 1024 → 860 m | 0 → 18 m | outer valley, cloud sea sits here |
| 860 → 700 m | 18 → 70 m | apron; the arena shelves are cut into this |
| 700 → 460 m | 70 → 236 m | the flanks — 26% mean grade, ribbed by spurs |
| 460 → 190 m | 236 → 392 m | the shoulders — steeper, 33%, couloirs and cliff bands |
| 190 → 74 m | 392 → 448 m | the summit cone — 40%+, bare rock and rime |
| 74 → 0 m | 448 → 452 m | **the parvis**, levelled flat at 452 m |

Rules:
- **No rim.** The map edge falls away into cloud instead of climbing.
  The inversion deck hides the boundary; that is its second job.
- The radial profile is `smootherstep`-blended between the rows above,
  so there are no slope discontinuities to catch the walk solver.
- Ridge noise is **anisotropic and radial** — spurs run downhill, gullies
  run downhill. Isotropic fBm on a cone reads as a crumpled paper bag.
- Eight **buttress spurs** at the arena bearings, so each arena sits on
  its own shoulder rather than on an arbitrary patch of slope.

## 2. The nine stations

`r` is the district naming radius (same semantics as Vesper's `DISTRICTS`).
`pad` is the levelled arena floor: a flat disc the encounter will use.

| id | name | x | z | bearing | r | pad radius | pad elevation |
|---|---|---|---|---|---|---|---|
| `basecamp` | The Basecamp | 0 | 828 | S | 320 | 120 | 12 |
| `tarn` | The Black Tarn | −604 | 604 | SW | 270 | 150 | 41 |
| `bowl` | The Avalanche Bowl | 590 | 632 | SE | 310 | 190 | 62 |
| `glacier` | The Glacier Tongue | −656 | −524 | NW | 300 | 165 | 96 |
| `rime` | The Rime Forest | 762 | 44 | E | 285 | 150 | 141 |
| `fumarole` | The Fumarole Steps | 596 | −596 | NE | 255 | 130 | 162 |
| `cascade` | The Frozen Cascade | −44 | −772 | N | 285 | 145 | 209 |
| `bell` | The Bell Terrace | −800 | 58 | W | 250 | 110 | 241 |
| `summit` | Cathedral of the Ninth Ascent | 0 | 0 | — | 210 | 78 | 452 |

Sanity checks that must hold in code:
- Every pad is **flat to ±0.35 m** across its radius, and its rim blends
  out over 40 m so it is not a poker chip on a hillside.
- No two pads overlap; nearest pair is `bowl`↔`basecamp` at 618 m centre
  to centre against radii 190 + 120.
- Every pad is reachable on foot from the Via Sacra without exceeding
  `WALK_SLOPE_LIMIT`. This is a test, not an intention.

## 3. The Via Sacra

One continuous road, basecamp gate → summit parvis, climbing
**anticlockwise** (decreasing bearing when read from above with +Z south).

Parametric centreline, `t` in `[0, 1]`:

```
turns   = 2.35                       // full revolutions
theta   = theta0 - t * turns * 2PI   // anticlockwise
radius  = lerp(838, 96, ease(t))     // ease = smootherstep, so the
                                     // spiral tightens as it climbs
y       = profile(radius)            // the road SITS ON the profile;
                                     // it is a cut, not a viaduct
```

- Sampled at **6 m** into a polyline, then cut into the height field with
  the same spatial-index technique `roadIndex`/`roadProfile` uses in
  `terrain.js` — a linear scan over ~600 segments is half a billion
  segment tests at build time and was already measured as fatal there.
- **Width 11 m** carriageway, 2.2 m of cut on the uphill side and a
  0.9 m parapet on the downhill side. The parapet is what makes an
  exposed road readable as exposed.
- **Six hairpins** above 300 m, where the spiral alone would exceed
  grade. Each hairpin gets a widened apron and a votive marker.
- **Grade ceiling 13%.** Measured, not assumed: a `slopeHistogram`
  sample along the centreline must show max ≤ 13% and mean ≤ 9%.
- **Eight spurs** leave the Via Sacra for the arena pads, each ≤ 260 m
  and each ending in the pad, not near it.
- Surface: cobbled granite setts under drifted snow, with the wheel ruts
  scoured clean. Snow depth on the road is 40% of the ambient field —
  the road reads as *travelled*.

## 4. Snow depth field

A second scalar field sampled exactly like height, in metres:

```
depth = base(altitude)              // 1.4 m at valley, 0.35 m at 400 m
      * slopeFalloff(slope)         // 1 at flat, 0 above 38 degrees
      * aspectBias(normal, wind)    // 1.55 on lee, 0.45 on windward
      * curvatureBias(curvature)    // fills gullies, strips ridges
      + drift(x, z)                 // authored drift tails behind props
```

Consumers: the walk solver (speed and knee height), the footprint decal
depth, the wind-slab/deep-snow material blend, and prop bedding. One
field, four readers — if any of them computes its own, they will drift
apart and the level will look like snow painted on rather than snow lying
in.

## 5. Wind

One vector for the entire world, exactly as Vesper has one: **from the
WNW, bearing 292°**, 14 m/s at the valley and 31 m/s at the summit.
Everything directional obeys it — sastrugi grain, rime feathers, spindrift
plumes, drift tails, the cascade's frozen curtain lean, banner flap,
ground-blizzard sheets and the cloud-deck flow.

## 6. Camera stations

Nine `beautyShots` (one per station) plus five composed vistas:

| id | what it must prove |
|---|---|
| `arrival` | the whole mountain framed by the basecamp buttresses |
| `via-sacra` | the spiral legible as a spiral, three levels of road in one frame |
| `summit-parvis` | the cathedral against sky, braziers lit |
| `summit-look-back` | every station visible below, cloud sea beyond |
| `inversion` | standing in the cloud deck at 120 m, half in half out |
| `crevasse-edge` | eye-level at the lip of a real hole |
| `cascade-backlit` | translucent ice with the sun behind it |
| `bell-terrace-drop` | the cliff exposure, at eye level |
| `rime-forest-graze` | grazing light across rime feathers |
| `sastrugi-graze` | grazing light across wind slab — the texture test |
| `tarn-mirror` | sky in black ice |
| `fumarole-plume` | the one warm frame |
| `bowl-scale` | the player figure alone in white negative space |
| `night-vigil` | the braziers as the only light above 400 m |

Each must also survive as an **eye-level** frame at 1.7 m with the figure
in shot. A station that only works from a floating camera is not done.
