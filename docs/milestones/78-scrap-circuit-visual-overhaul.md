# Milestone 78 — Scrap Circuit visual overhaul

**Goal:** bring Scrap Circuit's environments, vehicles and VFX to the standard of
the 1995-era arena vehicular-combat games it parodies, verified by blind
comparison against real screenshots of the genre rather than by eye.

**Status:** done (2026-08-05).

---

## Where it started

The arenas were flat fields with 4–5 m sheds on them, scattered across a plane
that visibly ended in mid-air. Baseline capture across all six arenas:

| | mean luma | contrast | detail density |
|---|---|---|---|
| worst (rooftop overview) | 99.8 | **3.3** | **1.62** |
| worst (cemetery) | **29.4** | 6.7 | 2.16 |
| best (interchange street) | 127.9 | 53.9 | 3.40 |

Detail density is the mean absolute luma gradient — the single most diagnostic
number for "does this look like a textured world or like untextured primitives".
Ten of thirty baseline shots tripped the flat-shading warning.

### The root cause was one line of missing maths

Every arena texture was 128×128 and good. They were applied to geometry with
UVs running 0..1 across the whole surface, so a 190 m ground plane displayed
exactly **one** texture tile, stretched. Roads read as brown smears. The fix is
texel density: because materials are shared across dozens of meshes,
`texture.repeat` is useless (every mesh would fight over one value), so tiling
has to live in each geometry's UVs. `arenas.js` now rewrites the `uv` attribute
per primitive, driven by a metres-per-tile hint carried on each material.

---

## What changed

### 1. Texel density (`arenas.js`)
- `uvBox` / `uvPlane` / `uvRadial` / `uvDisk` rewrite geometry UVs from world
  size and a per-material `tile` hint (plus `tileV` where a facade tile must be
  exactly one storey tall).
- Every kit primitive — `box`, `block`, `deck`, `ramp`, `ground`, `flatOverlay`,
  `flatDisk`, `tree`, `barrel`, `perimeter` — routes through it.

### 2. Procedural texture bakery (`procedural.js`, new)
The hand-picked AI textures cover ground, walls and vehicles. They cannot cover
*structured* surfaces — a grid of lit and unlit windows has to line up with the
storey height of the building it is on. Those are painted at runtime on a 2D
canvas: `facade`, `storefront`, `towerNight`, `soundwall`, `sidewalk`,
`chainlink`, `garage`, `asphalt`, `roadLine`, `shingle`, `brick`, `billboard`,
`sky`, `water`, `panel`, `hazard`, `glowDisc`, `wallSign`, plus the automotive
set (`carPaint`, `carGlass`, `wheelFace`, `grille`, `lamp`) and the FX sheets.

Everything routes through `SCRAP.textures`, so a manifest PNG dropped in under
the same logical key still wins — the procedural tile is the floor, not a
ceiling.

### 3. Scale, enclosure and density (all six arenas)
- A storey is 3.6 m; buildings are 2–9 storeys with parapets, roof plant,
  storefront ground floors and lit window grids.
- Every arena is closed by real geometry (building ring, container walls,
  segmented highway barrier, arcade row, tower shafts, iron railing) instead of
  a 3 m fence, backed by a two-ring hazed skyline and a camera-following sky
  dome.
- City kit added: streetlights, kerbed sidewalks, junk cars, dumpsters,
  chain-link, jersey barriers, billboards, power poles, traffic signals, painted
  lane lines.
- Per-arena landmarks: gantry crane, sorting conveyor and rail spur (junkyard);
  pier trestle, ferris wheel, carousel, bumper-car pen, drop tower (boardwalk);
  pier-and-cap viaduct with sign gantries (interchange); tower cranes and water
  towers over lit building shafts (rooftop); pedimented mausoleums, bell-tower
  chapel and 80 varied headstones (cemetery).

### 4. Lighting
Pools of light on the ground under every lamp, neon and sign, additive so they
brighten the surface rather than pasting a grey disc on it. This is the era's
signature look — bright puddles, near-dark between them — and the arenas had
none of it.

### 5. Vehicles (`vehicles.js`)
Wheel arches, bumpers, grilles, headlamps, tail lamps, wing mirrors, exhaust
tips, roof detail and rims with spokes across all ten. Three shipped textures
were the wrong art for their slot and were retired to `manifest.retired` in
favour of painted replacements:

| key | was | now |
|---|---|---|
| `vehicle.shared.glass` | cracked turquoise ice — made every cabin glow | tinted `carGlass` |
| `vehicle.rideshare.body` | cracked ice | `carPaint` |
| `vehicle.garbage.body` | lawn turf | `carPaint` |

### 6. VFX (`main.js`)
Billboarded sprite animation replaces the expanding sphere: a 4×4 fireball sheet
with a white core punch, boiling flame and embers, plus a smoke plume that
outlives the flame by two seconds, an additive flash, and a ground scorch.
Tracers are long hot additive streaks. Cars trail grey smoke below half health
and black smoke with flame below a quarter; the handbrake raises tyre smoke.

---

## Gameplay fixes found along the way

These are not cosmetic and would have shipped as bugs:

- **`block()` ignored its own rotation** when building its collider, so a turned
  building collided at ninety degrees to the wall you could see. The cemetery's
  spawn ring sat inside a mausoleum as a result.
- **Spawn points are now cleared automatically** (`clearSpawns`) after an arena
  builds, pushing each one radially until it has a car-length of room. Hand-tuned
  spawn radii silently break every time the geometry moves.
- **The chase camera reversed into walls.** It now stops at the first collider
  between car and eye, *and* climbs and looks down as it is forced in — being
  pinned against a wall with no view is bad play, not just a bad screenshot.

---

## Results

Frame time (GPU-backed headless Chromium, 1280×720, real frames):

| arena | meshes | tris | ms/frame |
|---|---|---|---|
| suburb | 1091 | 25 341 | 2.31 |
| junkyard | 1154 | 28 941 | 1.56 |
| interchange | 1177 | 26 283 | 1.22 |
| boardwalk | 1253 | 29 304 | 1.68 |
| rooftop | 946 | 24 037 | 0.59 |
| cemetery | 1660 | 33 975 | 1.64 |

Mesh counts roughly tripled; the budget is 16.6 ms and the worst arena uses 2.5.

Blind comparison against 11 real 1995-era screenshots, normalised through an
identical crop / console-resolution / JPEG pipeline so neither side is
identifiable by sharpness, HUD or aspect:

| round | preference for our renders |
|---|---|
| 2 (after arenas + vehicles) | 10/11 — 90% |
| 3 (after light pools) | 8/11 — 73% |
| 4 (after camera + sound wall) | 8/10 — 80% |
| **final** | **11/11 — 100%** |

Identification stayed at 100% throughout, which is expected and not the goal:
our renders are cleaner and denser than the era, so the two are always tellable
apart. The direction of the difference is what the preference vote measures.

Each round's losses were specific and fixable, and drove the last four changes:
a blank 190 m sound wall (now five varied segments per side), the camera pinned
flat against it, a shield bubble opaque enough to hide the car it protected, and
the junkyard's empty middle.

---

## Harnesses

| script | what it does |
|---|---|
| `scripts/scrap-shots.mjs` | five camera poses per arena, with luma / contrast / saturation / detail-density metrics and a contact sheet |
| `scripts/scrap-vehicle-shots.mjs` | four-angle turntable per chassis on a neutral stage |
| `scripts/scrap-vfx-probe.mjs` | fires an effect on a stopped clock and steps only the FX pools, so any frame of an explosion can be captured exactly |
| `scripts/scrap-action-shots.mjs` | runs a real match until ordnance is in the air, then grabs chase-cam frames |
| `scripts/scrap-verify.mjs` | frame time, spawn drivability, ramp climbs — the things a screenshot cannot show |
| `scripts/scrap-blind-compare.mjs` | builds and scores the blind A/B rounds |

All six drive the `?qa=1` hooks in `main.js` (`__scrapQA`): free camera,
deterministic sim stepping, player input override, bot parking, effect firing,
and a synchronous drawing-buffer grab.

## Open follow-ups

- The boardwalk's stall canopies still fill the frame when a car noses into one.
- The cemetery's detail density (2.6–2.8) is the lowest of the six; its ground is
  mostly dark earth by design, but more mid-field structure would help.
- Reference pool is 11 images. More would tighten the comparison.
