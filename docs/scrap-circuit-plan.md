# Scrap Circuit: Last Chassis Standing

Working plan for Rainbot Gaming's PS1-era arena vehicular-combat parody.

## Current Decision

- Format: third-person 3D arena vehicular combat — armored parody cars in destructible arenas, weapon pickups, one signature special per vehicle, last-chassis-standing free-for-all against AI.
- Runtime: plain Three.js (vendored `three-r128.min.js`, classic script global) inside the existing static site. No build step.
- Rendering: authentic PS1-console-era pipeline — low internal render resolution upscaled with hard pixels, clip-space vertex snap, flat/vertex lighting, aggressive per-arena fog, ordered dither. Centralized in a reusable `Ps1Renderer` module.
- Physics: arcade car model (accel/brake/steer with drift), circle-vs-box collision, per-arena ground-height sampling for ramps and elevated decks, simple gravity when airborne. No physics engine.
- Page shape: one HTML page under `games/`, game code split into `assets/js/scrap-circuit/` modules (ps1, textures, vehicles, arenas, main) loaded as ordinary script tags sharing a `window.SCRAP` namespace, shared site CSS and `RB` helpers.
- Tone: absurd late-capitalism demolition satire. Every vehicle is a parody of an economic archetype (repo man, reverse mortgage RV, rating-obsessed rideshare). All content is original — no reference to any real vehicular-combat game, brand, vehicle, or person.
- Texture retrofit is a hard requirement: all materials route through a logical-key registry backed by `assets/textures/scrap-circuit/manifest.json`, so hand-picked AI textures can be dropped in later with zero code changes.

Working title: **Scrap Circuit: Last Chassis Standing** (slug `scrap-circuit`).

## High Concept

A shadowy insurance conglomerate runs an underground demolition tournament where America's most unhinged service vehicles settle their grudges. An ice cream truck with a melting mascot, a repo tow truck, a boomer RV with full equity, and seven other menaces batter each other through suburbs, junkyards, highway interchanges, carnivals, foggy rooftops, and a midnight cemetery. The announcer is **The Adjuster**, an insurance-adjuster hype-man who denies every claim mid-explosion ("CLAIM DENIED!", "THAT'S NOT COVERED!").

It looks like it shipped on a grey console in 1997: 480x270 internal resolution, wobbling vertices, fog hiding the draw distance, dithered gradients, chunky Press Start 2P HUD.

## Player Fantasy

You are one absurd vehicle with one loud special weapon, and the whole arena is your demolition invoice. The fantasy is silhouette-first: you should recognize every opponent from a rooftop with no textures, just shape — and fear the specific thing each one does.

Primary verbs:

- Drive fast, drift, ram, jump ramps, take shortcuts.
- Grab weapon pickups and fire them at rivals.
- Charge and unleash your vehicle's signature special.
- Break scenery (fences, barrels, coffins, snack stands) for cover, chaos, and pickups.
- Outlive everyone. Last chassis standing.

## Core Loop

1. Pick a vehicle (10 roster slots) and an arena (6).
2. Free-for-all against 5 AI opponents with distinct behavior archetypes.
3. Weapon pickups respawn around the arena; specials charge over time and from battery pickups.
4. Destructible scenery reacts to hits; arena hazards (crusher, fall edges, coaster, graves) punish careless driving.
5. Wreck rivals to earn Salvage (score); survive to raise your placement bonus.
6. Match ends when you're the last chassis standing (win) or wrecked (placement + score screen).
7. Salvage feeds the site-wide high score (`RB.recordScore("scrap-circuit", salvage)`).

Target session: one arena match, 3–6 minutes. Rewarded-ad loop: one **Sponsor Drop** per match (full special charge + armor) via `RB.showRewarded()`, granted directly for ad-free/Pro users.

## First Playable Slice

- One arena fully hazard-complete (Cul-de-Sac Flats) plus the other five in playable geometry.
- All 10 vehicles drivable with stats, silhouettes, and working specials.
- Weapon set: machine gun, homing missile, freeze missile, fire trail, remote bomb, proximity mine, ricochet bomb, shield, turbo.
- 5-bot free-for-all with rammer / camper / hoarder / coward archetypes.
- PS1 pipeline items 1–2 (low-res target + vertex snap) working before anything else; fog and flat lighting with the arena palettes; dither pass after.
- HUD: health, weapon + ammo, special charge, minimap, placement, announcer bark line.
- Desktop keyboard/mouse + mobile twin-stick touch controls.
- Menu, pause, wreck/victory overlays, high score via `RB`.

Current implementation status:

- Initial build (2026-07-03): all of the slice above implemented — six arenas with per-arena palettes/fog/hazards/ramps, ten vehicles with specials, nine pickup weapon types, four AI archetypes, PS1 renderer (480x270 internal target, vertex snap, Bayer dither, per-arena fog), container-query HUD, twin-stick touch, synth SFX + jingle stingers, The Adjuster bark feed, Sponsor Drop rewarded loop, Salvage high score, site cards + README row.

## Systems

### Simulation

Game state lives apart from Three.js meshes; meshes are a render bridge.

- `car`: position, heading, velocity, drift state, hp, armor, special charge, weapon + ammo, status effects (frozen, burning, smoked).
- `combat`: projectile pool (tracer, missile, freeze, ricochet, junk), mines/bombs, fire-trail patches, hitscan beams, explosion FX, damage/knockback resolution.
- `specials`: one scripted signature move per roster vehicle (see Content Plan), charging over time + battery pickups.
- `pickups`: typed spawn points per arena, respawn timers, magnet radius.
- `hazards`: per-arena scripted dangers (crusher press, fall volumes, coaster train, elevator platforms, exploding scenery).
- `destructibles`: breakable props with hp, debris burst, occasional pickup drop.
- `ai`: archetypes — Rammer (hunts nearest, loves ram damage), Camper (keeps standoff range, prefers missiles), Hoarder (routes to pickups, fights only when stacked), Coward (flees under 40% hp, snipes from range). Bots get rubber-band special charge so every match has "wow" moments.
- `match`: spawn ordering, placement tracking, last-chassis win condition, Salvage scoring (damage + wrecks + placement), Sponsor Drop state.
- `announcer`: The Adjuster's bark table keyed to events (first blood, double wreck, special fired, player low hp, victory) with cooldowns so he never spams.

### Rendering (PS1 pipeline — priority order)

1. Low internal render target (480x270, `NearestFilter`) blitted to the visible canvas with `image-rendering: pixelated`.
2. Clip-space vertex snap via a shared `onBeforeCompile` patch (`SCRAP.ps1ify(material)`) — subtle wobble, tuned to read as retro charm.
3. No affine-texture fakery — skipped on purpose; not worth a software rasterizer.
4. Flat/vertex lighting only: flat-shaded Lambert + vertex-color AO darkening, one directional + one hemisphere light, no shadow maps.
5. Aggressive per-arena `THREE.Fog` tied to each palette (dusk orange, junkyard grey, smog beige, carnival violet, rooftop grey-teal, graveyard green-black).
6. Ordered 4x4 Bayer dither + 15-bit color quantize inside the blit shader.
7. Chunky Press Start 2P HUD; CSS scanline/vignette overlay on the canvas wrap.

The whole pipeline lives in `assets/js/scrap-circuit/ps1.js` as a small reusable `Ps1Renderer` wrapper so future Rainbot retro-3D games can lift it unchanged.

### Physics

- Arcade car: throttle/brake/steer with speed-scaled turn rate, lateral friction for drift, ram damage from relative velocity on car-vs-car hits.
- Collision: car circles vs static AABBs (props/walls) and vs cars; knockback impulses.
- Elevation: per-arena `sampleGround(x, z)` from flat rects and linear ramp gradients; cars follow ground height, go airborne off edges with gravity; big drops deal chassis damage; marked fall volumes (interchange edges) wreck or heavily damage.
- Destructibles are colliders until broken.

### Input

Desktop:

- `W/S` or `↑/↓` throttle/brake-reverse, `A/D` or `←/→` steer, `Shift` handbrake drift.
- `Space` or left-click: fire current weapon. `E` or right-click: special (when charged).
- `Q` cycle stored weapon, `R` look-behind, `P`/`Escape` pause, `⛶` max screen (same pseudo-fullscreen pattern as Unhoused and Unhinged).

Mobile / touch (twin-stick, following the `rb-touch-layer` pattern):

- Invisible left-half floating stick: forward = throttle, back = brake/reverse, sides = steer.
- Right cluster buttons: FIRE, SPECIAL, DRIFT.
- Container-query HUD (`container-type: size` on the canvas wrap) so nothing overlaps at any window size, sidebar layout, max screen, or phone.

## Content Plan

### Vehicle Roster (10 — all original parody archetypes)

| # | Vehicle | Archetype | Special | Flavor |
|---|---------|-----------|---------|--------|
| 1 | **Mr. Drippy's Meltdown** | soft-serve horror-show ice cream truck, jingle stuck on | **Brain Freeze** — frost nova that freezes nearby cars solid | "The jingle is a warning." |
| 2 | **Late Fees** | reaper-chic chopper, skeleton-masked rider, scythe sidecar | **Soul Garnishment** — life-drain beam on the nearest rival | "Death waives nothing." |
| 3 | **Mall Law** | off-duty mall-cop cruiser gone rogue, light bar spinning | **Clearance Spikes** — rear spike-strip barrage | "The food court closes when HE says it closes." |
| 4 | **Lawnzilla** | oversized backyard monster truck, absurd suspension | **Property Value Slam** — ground-pound that knocks back everything nearby | "HOA-certified natural disaster." |
| 5 | **Casket Case** | funeral hearse in heavy-metal livery | **Pre-Paid Plots** — trail of casket proximity bombs | "Ask about the family discount." |
| 6 | **Detention Express** | substitute-driver-from-hell school bus | **Mandatory Attendance** — tractor beam yank + point-blank shock burst | "You WILL be marked present." |
| 7 | **Five Star Frenzy** | rating-obsessed rideshare sedan, mirror trophy | **Surge Volley** — multi-missile volley costing a sliver of own HP per shot | "He tips himself." |
| 8 | **The Equity** | boomer road-trip RV, satellite dish, roof lawn chairs | **Reverse Mortgage** — mower-blade sweep + smoke screen | "Bought in '78 for a handshake." |
| 9 | **Repo Rocket** | repo-man tow truck | **Asset Seizure** — chain hook that yanks a target toward the nearest hazard | "Your car called. It's his now." |
| 10 | **Trash Talker** | overflowing garbage truck | **Hot Takes** — compactor crush + thrown-junk barrage | "Certified curbside menace." |

Poly budgets: vehicles ~150–500 tris from Three.js primitives grouped per vehicle with shared `ps1ify`'d materials; every silhouette must be identifiable from a rooftop screenshot with zero textures.

### Weapon Pickups

Machine gun (tracer stream), homing missile, freeze missile, fire trail (napalm patches), remote-detonated bomb, proximity mine, ricochet bomb (bounces off walls), temporary shield, turbo boost. Support pickups: wrench (hp), battery (special charge).

### Arenas (6 — each its own factory function)

| # | Arena | Theme | Fog / palette | Signature elements |
|---|-------|-------|----------------|--------------------|
| 1 | **Cul-de-Sac Flats** | suburban block | dusk orange | drive-through pools, garage shortcuts, picket-fence destructibles, roof ramp, exploding grills |
| 2 | **Crush Depot** | junkyard/warehouse sprawl | warehouse grey | working car-crusher hazard, stacked container catwalks, forklifts, barrel clusters |
| 3 | **The Mixing Bowl** | stacked highway interchange | smog beige | two elevated deck loops, on/off ramps, fall-off-the-edge wreck volumes, cone zones |
| 4 | **Pier Pressure** | seaside boardwalk carnival | carnival violet | coaster-track shortcut loop, Ferris wheel landmark, funhouse mini-zone, snack-stand destructibles |
| 5 | **Fog Exchange** | downtown rooftop district | grey-teal, heaviest fog | helipads, crane bridges, freight elevator platform, AC-unit clutter |
| 6 | **Plot Twist Acres** | midnight cemetery / haunted junkyard | green-black | mausoleum maze, narrow winding paths into open crypt yard, popping graves, dead-tree ring |

All large enough for 6 vehicles; every arena has at least one vertical or shortcut element; adding an arena later touches only `arenas.js`.

### Announcer — The Adjuster

Insurance-adjuster hype-man. Bark lines are HUD text stingers with synth horn hits: "CLAIM DENIED!", "ACT OF GOD! NOT COVERED!", "PREMIUMS ARE GOING UP!", "TOTAL LOSS!", "DEDUCTIBLE MET!". Cooldown-gated so he lands as punctuation, not noise.

### Audio

100% synthesized WebAudio (house precedent: AGAIN.) — engine hum tied to speed, weapon blips, chunky noise-burst explosions, freeze shimmer, announcer horn stingers, per-vehicle 2-second victory jingle. No sound files.

## Texture Retrofit Architecture (hard requirement)

- Single manifest: `assets/textures/scrap-circuit/manifest.json` mapping logical texture keys to file paths relative to the manifest folder (e.g. `"vehicle.icecream.body": "vehicle/icecream_body.png"`).
- Every material in the game is created through `SCRAP.textures.mat(key, { color, ... })`, which registers the logical key in a material registry.
- On boot the loader fetches the manifest; any key with an existing file gets its texture applied (`NearestFilter`, sRGB, no mip blur) onto the already-registered material — zero code changes to retrofit.
- Missing/unresolvable entries fall back silently to the flat/vertex-colored placeholder material.
- Geometry that expects a texture (vehicle bodies, arena floors/walls, HUD frame) is authored with sane UVs now, so drop-in art maps correctly later.
- The manifest ships with the full supported key list under `"planned"`; promoting an entry into `"textures"` plus dropping the PNG is the entire retrofit step.

## Tone Guardrails

- Parody targets are systems and archetypes — repo economics, HOA culture, gig-economy ratings, mall authority, reverse mortgages — never real people, brands, or the real genre-defining game.
- No real vehicle marques, no real game's vehicle/character names or likenesses, in code, comments, copy, or filenames.
- Violence is cartoon demolition: cars pop into springs and doors, drivers are never shown harmed, wrecks are "totaled," not killed (The Adjuster insists on correct terminology).
- The reaper bike and cemetery are Halloween-flavored, not gore. The ice cream mascot is horror-comedy, not horror.
- Match the README parody-disclaimer bar set by Boomer Monopoly / DoorCrash / Billionaire Space Race.

## Visual Direction

- Authentic PS1: 480x270 internal target with hard-pixel upscale, vertex wobble, flat-shaded Lambert with vertex-color AO, per-arena heavy fog, Bayer dither, short draw distance as an aesthetic.
- Every arena owns a palette and fog color; silhouettes and proportion carry all vehicle identity (no textures required to tell anyone apart).
- Specials are the loud moment: particle bursts, screen flash, chunky sprite explosions — visually loud even at PS1 budgets.
- HUD: Press Start 2P numerals, hard drop shadows, CSS scanline + vignette overlay on the wrap.

## File Plan

- `docs/scrap-circuit-plan.md` — this plan.
- `games/scrap-circuit.html` — page, HUD markup, touch layer.
- `assets/js/scrap-circuit/ps1.js` — Ps1Renderer (render target, dither blit, vertex snap patch).
- `assets/js/scrap-circuit/textures.js` — manifest loader + material registry.
- `assets/js/scrap-circuit/vehicles.js` — roster data + 10 mesh factories.
- `assets/js/scrap-circuit/arenas.js` — shared kit + 6 arena factories.
- `assets/js/scrap-circuit/main.js` — simulation, combat, AI, HUD, input, loop.
- `assets/textures/scrap-circuit/manifest.json` — texture retrofit manifest.
- `assets/img/scrap-circuit/card-scrap-circuit.png` — generated poster/card art with crisp local title overlay.
- Site integration: card in `index.html`, card in `games.html`, README row + disclaimer sentence.

## Milestones

### Milestone 1: PS1 Pipeline First

Low-res target + nearest blit + vertex snap running on a test scene. This is the whole pitch; nothing else lands until it does.

### Milestone 2: One Car, One Arena

Arcade driving model, chase camera, collision, ramps/elevation in Cul-de-Sac Flats.

### Milestone 3: Combat Slice

Pickups, machine gun + missiles, damage/wreck states, 2 AI archetypes, last-chassis win.

### Milestone 4: Full Roster + Specials

All 10 vehicles with silhouettes, stats, and signature specials.

### Milestone 5: Six Arenas + Hazards

Remaining arenas with palettes, fog, hazards, destructibles, verticality.

### Milestone 6: Site Release

HUD polish, touch controls, announcer, synth audio, dither pass, cards, README, browser playtest desktop + mobile viewport.

## Open Questions

- Tournament/ladder mode (fight all arenas in sequence with persistent damage) or stay single-match?
- Should specials have alt-fire depth (hold to aim Asset Seizure) or stay one-button loud?
- 2-player split-keyboard local mode later?
- Do bots need per-vehicle personality lines beyond The Adjuster's barks?
- Generated AI textures: which surfaces first — arena floors (biggest wins at PS1 resolution) or vehicle decals (most character)?
