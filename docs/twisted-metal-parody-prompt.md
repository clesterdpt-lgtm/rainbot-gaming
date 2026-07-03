# Fable 5 Build Prompt: Vehicular Combat Parody

This is a ready-to-paste prompt for Claude (Fable 5) to build Rainbot Gaming's
next large browser game: an original parody of PS1-era arena vehicular
combat games (Twisted Metal, Vigilante 8, Rogue Trip). It is written the
same way `docs/unhoused-and-unhinged-plan.md` frames that project, but as a
single build prompt instead of a living plan doc.

**Do not name the real game or its characters/vehicles anywhere in the
output** (title, code, comments, filenames, assets, marketing copy). Rainbot
Gaming's existing games (Boomer Monopoly, DoorCrash, Apop Demon Moggers,
Billionaire Space Race) all satirize a genre/category with wholly invented
names, characters, and brands rather than referencing the real IP directly —
this project follows the same rule. Treat "PS1-era arena vehicular combat
games" as the genre being parodied, not any single title.

## How to use this

1. Open a session on the `rainbot-gaming` repo.
2. Paste the prompt block below to Fable 5 as-is (edit the working title
   first if you want something else).
3. Let it propose the plan doc and first playable slice before it writes
   a large amount of code, the same way `unhoused-and-unhinged-plan.md`
   preceded `unhoused-and-unhinged.html`.

---

## The prompt

```
You are building a new large browser game for the Rainbot Gaming static
site (this repo). It's an original parody of PS1-era arena vehicular
combat games — armored cars fighting in destructible arenas with weapon
pickups, special weapons per vehicle, and a run-and-gun announcer vibe.
Do not reference the real genre-defining game or its vehicles/characters
by name, likeness, or exact design anywhere (title, filenames, code,
comments, copy). Everything — title, vehicle roster, arenas, weapons,
announcer, story beats — must be original parody content in Rainbot's
house style: absurd, satirical, self-aware, and legally distinct from
any real game, brand, or person. Look at how Boomer Monopoly, DoorCrash:
No Tip Nitro, and Billionaire Space Race handle parody (README.md has
the disclaimer language) and match that bar.

WORKING TITLE: pick something in Rainbot's naming voice (short, punchy,
faux-brand energy like "DoorCrash: No Tip Nitro" or "Billionaire Space
Race"). Suggestion to riff on or replace: "SCRAP CIRCUIT: Last Chassis
Standing".

## Fit the existing site, exactly

Read `README.md`, `docs/unhoused-and-unhinged-plan.md`, and
`games/unhoused-and-unhinged.html` /
`assets/js/unhoused-and-unhinged-topdown.js` first — they're the closest
precedent (a large original 3D browser game built directly into this
static site) and you should match their conventions:

- No build step. Plain HTML + vanilla JS + Three.js.
- Three.js is vendored locally at `assets/vendor/three/three-r128.min.js`
  (classic `<script>` global, not ES modules, not a CDN import) — reuse
  that exact file, don't fetch a different version.
- One page at `games/<slug>.html`, reusing `assets/css/styles.css`, the
  shared `<nav class="nav">`, the `.game-layout` / `.canvas-wrap` /
  `#gameCanvas` structure, and the HUD-over-canvas pattern (see
  `.unhinged-game-hud` in `unhoused-and-unhinged.html` for the
  container-query HUD approach — copy that technique so the HUD scales
  cleanly at any window size, sidebar layout, max-screen, and on phones).
- Game logic in `assets/js/<slug>.js` (or `assets/js/<slug>/` modules
  only if one file gets unwieldy — see the "Prototype Architecture"
  section pattern in `docs/unhoused-and-unhinged-plan.md`).
- Wire up `RB` from `assets/js/ads.js`: `RB.showRewarded()` for a
  rewarded-ad power-up loop, `RB.recordScore(gameId, score)` for a high
  score, `RB.isAdFree()` to gate ad slots. Don't build a new ad/score
  system.
- Add a card to `index.html` and `games.html`, add a row + parody
  disclaimer sentence to the `README.md` game table, matching the
  existing tone and table format exactly.
- Support desktop (keyboard + mouse) and mobile touch controls (on-canvas
  twin-stick-style: one virtual stick to drive, tap/drag or buttons to
  aim and fire), following the touch pattern already used in
  `unhoused-and-unhinged-topdown.js`.
- Before writing significant code, write a plan doc at
  `docs/<slug>-plan.md` in the same shape as
  `docs/unhoused-and-unhinged-plan.md` (Current Decision, High Concept,
  Core Loop, First Playable Slice, Systems, Content Plan, Tone
  Guardrails, Visual Direction, File Plan, Milestones, Open Questions),
  then build toward it in the same staged-milestone way that project
  did. Update the plan doc as you go instead of a separate changelog.

## PS1-era visual fidelity — be literal about this, it's the whole pitch

The ask is authentic PS1-console-era look, not just "low poly." Implement
the actual tricks that gave PS1 3D its texture, in this order of
priority:

1. **Low internal render resolution, upscaled with hard pixels.** Render
   the Three.js scene to an offscreen render target at a low fixed
   resolution (roughly 320x240–480x272 internally, scaled up to fill the
   canvas) and blit it to the visible canvas with nearest-neighbor
   scaling (`image-rendering: pixelated` on the canvas, `THREE.NearestFilter`
   on the render target texture). This one trick does more for the look
   than anything else — get it working first.
2. **Vertex jitter / geometric wobble.** PS1 had no sub-pixel vertex
   precision, so geometry visibly snaps and wobbles as the camera moves.
   Approximate this with a custom vertex shader (or a
   `onBeforeCompile` patch on a shared material) that quantizes clip-space
   vertex positions to a coarse grid before rasterizing. Keep it subtle
   enough that it reads as "retro charm," not motion sickness.
3. **No perspective-correct texture warping fakery is required** — real
   affine mapping needs a software rasterizer and isn't worth the
   engineering cost here. Skip it; the low-res render target + vertex
   snap already sells the era.
4. **Flat/vertex lighting only.** No dynamic shadow maps, no PBR. Use
   `MeshBasicMaterial`/flat-shaded `MeshLambertMaterial` with vertex
   colors and a couple of cheap directional/hemisphere lights. Baked-in
   AO via vertex color darkening on lower faces is fine and period
   correct.
5. **Fog as a draw-distance excuse.** Aggressive `THREE.Fog` tuned so
   distant geometry disappears into flat color, exactly like PS1 games
   used fog to hide pop-in and short draw distance. Each arena should
   have its own fog color tied to its palette (dusk orange, warehouse
   grey, graveyard green-black, etc).
6. **Dithering instead of smooth gradients.** A cheap ordered-dither
   post-process pass (screen-space Bayer matrix in a fragment shader,
   applied after the low-res render target) sells 15-bit color depth.
   This is a nice-to-have after 1–5 are solid — don't block the first
   playable slice on it.
7. **Chunky retro UI.** The site already loads "Press Start 2P" — use it
   for HUD numerals/labels. Optional CRT scanline overlay as a cheap CSS
   `::after` gradient, same technique as the vignette overlay in
   `unhoused-and-unhinged.html`.

Keep this rendering pipeline centralized (one small module, e.g. a
`Ps1Renderer` wrapper around the low-res render target + dither pass) so
it can be reused if Rainbot builds another retro 3D game later.

## Original 3D models — build them, don't fetch them

No external model downloads, no scraped assets. Everything is built from
Three.js primitives (`BoxGeometry`, `CylinderGeometry`, etc., merged into
`BufferGeometry` per vehicle) or hand-authored low-poly `.glb`/`.obj`
files checked into `assets/models/<slug>/` if you choose to author them
that way instead. Either approach is fine; consistency and a clean asset
boundary matter more than the exact toolchain.

Poly budgets, to stay period-authentic and performant with ~10 vehicles
and AI opponents on screen at once:

- Vehicles: roughly 150–500 triangles each.
- Arena hero props (buildings, landmarks): roughly 100–400 triangles.
- Small props (barrels, signs, debris): under 60 triangles.

Every vehicle needs an instantly readable, unique silhouette — that's
the actual design lesson to take from the genre being parodied: you
should be able to identify each one from a rooftop screenshot with no
textures at all, just shape and proportion. Build 10 original vehicles,
each an absurd parody archetype with its own gimmick, special weapon,
and one-line flavor text:

1. **Soft-serve horror-show ice cream truck** — jingle-blasting mascot
   driver. Special: a frost-nova that briefly freezes nearby vehicles in
   place.
2. **Reaper-chic chopper motorcycle** — skeleton-masked rider, sidecar
   optional. Special: a life-drain beam that steals health from the
   nearest opponent.
3. **Off-duty mall-cop cruiser gone rogue** — light bar still spinning.
   Special: fires a spike-strip barrage behind it.
4. **Oversized backyard monster truck** — comically tall suspension.
   Special: a ground-pound slam that knocks back everything nearby.
5. **Funeral hearse with a heavy metal paint job** — Special: drops a
   trail of casket-shaped proximity bombs.
6. **"Substitute driver from hell" school bus** — Special: a tractor
   beam that yanks one opponent close, then a point-blank shock burst.
7. **Five-star-obsessed rideshare sedan** — trophy dangling from the
   mirror. Special: a multi-missile volley that costs the driver a
   sliver of their own health per shot (risk/reward flavor).
8. **Boomer road-trip RV** — satellite dish, lawn chairs strapped to the
   roof. Special: a mower-blade sweep plus a smoke screen for cover.
9. **Repo-man tow truck** — Special: fires a chain hook that yanks a
   target vehicle toward the nearest hazard (explosive barrel, edge,
   trap).
10. **Overflowing garbage truck** — Special: a compactor crush plus a
    barrage of thrown junk projectiles.

Keep the names, mascots, and flavor text your own invention — don't
reuse the names above verbatim if you can come up with funnier Rainbot-
house-style ones; they're a starting brief, not a script.

## Arenas — large, unique, and plural

The genre being parodied is remembered for a handful of huge, distinct
arenas per game, not one map. Build several original large arenas, each
with its own theme, palette, fog color, hazards, weapon-pickup layout,
and at least one vertical or shortcut element (ramp, tunnel, elevator,
collapsing bridge). Suggested six, each large enough to support 6+
vehicles without feeling cramped:

1. **A suburban cul-de-sac block** — driveways, backyard pools you can
   drive through, garages as shortcuts, picket-fence destructibles.
2. **A junkyard/warehouse sprawl** — car crushers, forklifts, stacked
   shipping containers, multi-level catwalks.
3. **A stacked highway interchange** — multiple elevated highway levels,
   on/off ramps, a fall-off-the-edge hazard, occasional hazard traffic.
4. **A seaside boardwalk carnival** — roller coaster track as a shortcut
   loop, a Ferris wheel landmark, a funhouse interior mini-zone.
5. **A foggy downtown rooftop district** — rooftop helipads linked by
   construction cranes and freight elevators, heavy fog doing double
   duty as atmosphere and draw-distance cover.
6. **A midnight cemetery/haunted junkyard** — mausoleums, narrow winding
   paths opening into a wide crypt yard, a fog-and-green-light palette.

Each arena is its own scene-building factory function/module so new
arenas can be added later without touching vehicle or combat code.

## Combat systems

- Third-person chase camera per vehicle, screen-space HUD for health,
  ammo/special charge, and a minimap.
- Standard weapon pickups scattered through each arena: machine gun,
  homing missile, freeze missile, napalm/fire trail, remote-detonated
  bomb, temporary shield, turbo boost, proximity mine, ricochet bomb.
- Each vehicle's unique special weapon (see roster) charges over time or
  via pickups and is the build's signature "wow" moment — make it
  visually loud even at PS1 poly budgets (particle bursts, screen flash,
  chunky explosion sprites).
- Destructible/interactive scenery per arena (explosive barrels, breakable
  fences, collapsing props) reacting to weapon hits.
- AI opponents with a few distinct behavior archetypes (aggressive rammer,
  ranged camper, item-hoarder, coward-that-snipes) so a single-arena
  free-for-all against bots feels varied, plus a survive-the-wave or
  last-chassis-standing win condition for the first playable slice.

## Texture retrofit architecture — this is a hard requirement

The game ships now with flat/vertex-colored placeholder materials, but it
must be architected so that hand-picked, later-generated AI textures can
be dropped in afterward with zero code changes. Build this:

- A single manifest file, `assets/textures/<slug>/manifest.json`, mapping
  logical texture keys to file paths, e.g.:
  ```json
  {
    "vehicle.icecream.body": "vehicle/icecream_body.png",
    "vehicle.icecream.decal": "vehicle/icecream_decal.png",
    "arena.suburb.road": "arena/suburb_road.png",
    "arena.suburb.house_wall_a": "arena/suburb_house_wall_a.png",
    "ui.hud.frame": "ui/hud_frame.png"
  }
  ```
- A small texture-loader module (`assets/js/<slug>/textures.js` or a
  section in the main runtime) that, for every material in the game,
  looks up its logical key in the manifest and tries to load that file.
  If the manifest has no entry, or the file 404s, fall back automatically
  to a generated placeholder — a solid color or a tiny procedural
  canvas pattern (checkerboard, dither noise) in the vehicle/arena's
  palette — so the game always runs standalone with zero external
  texture files present, today and after any future partial texture
  drop.
- Document, in the plan doc, the UV convention for every mesh part that's
  meant to take a texture later (box-mapped/planar UVs in 0–1 space,
  which face maps to which manifest key) and a target texture resolution
  to generate at (something small and PS1-authentic — 64x64 or 128x128 —
  with a note that any higher-res AI-generated image should be downsampled
  and lightly dithered/quantized before dropping in, so it matches the
  rest of the game's palette instead of looking like a hi-res patch on a
  low-poly model).
- Add a `?hires=1` (or similar) query-param / debug-menu toggle that
  disables the low-res render target and nearest-neighbor upscale, purely
  as a development aid for comparing placeholder vs. real textures while
  authoring them later — not a shipped user-facing setting.
- End state: adding real art later is "drop PNGs into
  `assets/textures/<slug>/...` and add lines to `manifest.json`" — no
  material code, no shader code, no build step.

## Tone guardrails

- Everything is a cartoon. Violence is slapstick — parts fly off, comic
  smoke puffs, exaggerated crunch sound cues — not gory or realistic.
- Satirize the vibe of over-the-top vehicular carnage and the mundane
  things Rainbot already skewers elsewhere on the site (rideshare apps,
  boomers, suburbia, gig work, bureaucracy) rather than punching at real
  people, brands, or protected groups.
- No real trademarks, logos, or vehicle liveries — every brand referenced
  in flavor text (the rideshare app, the ice cream jingle, etc.) should be
  an invented parody name, the same way DoorCrash and Boomer Monopoly
  invent their targets instead of naming real companies.
- Match the disclaimer style already in `README.md`'s parody notice and
  add a sentence for this game when you update that table.

## Deliverable shape

1. `docs/<slug>-plan.md` — written first, in the
   `unhoused-and-unhinged-plan.md` shape.
2. `games/<slug>.html`
3. `assets/js/<slug>.js` (or `assets/js/<slug>/` module set)
4. `assets/textures/<slug>/manifest.json` (can start empty/near-empty —
   the fallback path is what matters for launch)
5. `assets/models/<slug>/` only if you hand-author any `.glb`/`.obj`
   files instead of building geometry procedurally.
6. Updated `index.html`, `games.html`, and `README.md` game table +
   disclaimer paragraph.

Ship a first playable slice — one arena, three or four vehicles, core
combat loop, HUD, win/loss state — before expanding to the full six-arena,
ten-vehicle roster, exactly the way `unhoused-and-unhinged-plan.md`
staged its milestones. Playtest in a browser at desktop and a narrow
mobile viewport before calling any milestone done.
```
