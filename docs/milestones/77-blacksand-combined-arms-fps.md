# 77 — BLACKSAND: combined-arms multiplayer FPS

A new game built to a single bar: **hold up against Battlefield 2 in a blind
side-by-side comparison.** Not "good for a browser game" — better, judged by a
reviewer who is not told which panel is which.

## What it is

- `games/blacksand.html` — page shell and boot screen
- `assets/css/blacksand.css` — page frame and the DOM HUD
- `assets/js/blacksand/*.js` — 24 ES modules, Three r180 via CDN import map
- 1024m desert theatre, five Conquest objectives, ticket bleed, infantry,
  transports and helicopters, bots, and RBNet online play

Everything visible is generated at load from `ctx.seed`: terrain, textures,
buildings, vegetation, soldiers, vehicles, weapons and audio. No new asset
downloads, no new external hosts, and a map that is byte-identical for every
player in a match because the netcode ships a seed rather than a heightfield.

## Architecture

One `ctx` object threaded through every subsystem. A module exports
`createX(ctx)`, returns an object assigned onto `ctx`, and may implement
`fixedUpdate` (fixed 1/120s), `update` (per frame), `lateUpdate` (after the
camera is final) and `report`. **Modules never import each other for runtime
state.** That constraint is what let ten agents rewrite ten subsystems in
parallel without stepping on each other.

Construction order, dependencies flowing downward:

```
input → render → textures → materials → sky → terrain → physics → structures
      → foliage → world → vfx → audio → characters → player → weapons
      → viewmodel → vehicles → bots → net → hud
```

Full contract: `docs/blacksand-agent-brief.md`.

## Harnesses

| script | what it proves |
| --- | --- |
| `blacksand-boot-check.mjs` | syntax, imports, shader compiles, runtime errors (~30s gate) |
| `blacksand-shots.mjs` | beauty shots + objective image metrics |
| `blacksand-movement-probe.mjs` | speeds, jump apex, stances, mantle, slide, terrain integrity |
| `blacksand-blind-compare.mjs` | randomised A/B against real BF2 screenshots, hidden key |
| `blacksand-critic-round.mjs` | one full capture → pair → metrics round |

## Four traps, already paid for

Recorded because each one cost a debugging round and each one presents as a
different bug than it is.

1. **A backtick inside a GLSL comment ends the template literal.** The failure
   surfaces as `SyntaxError: Unexpected identifier` pointing at a word inside
   what you think is a string.

2. **`composer.renderToScreen = false` means no pass ever writes to the
   canvas.** EffectComposer derives each pass's flag from its own
   (`pass.renderToScreen = this.renderToScreen && isLastEnabledPass(i)`), so the
   frame is black however correct the chain is — and it looks exactly like a
   lighting bug.

3. **`OutputPass` after a tonemap that already ends in display space encodes
   sRGB twice.** This was the entire "the frame is milk" symptom: mid grey 0.18
   arrived at 188/255 instead of 126, every shadow lifted into fog, and no
   amount of exposure tuning could fix it because the curve was applied twice.

4. **`page.screenshot()` cannot capture a harness-driven render.** It goes
   through the compositor, which headless Chromium throttles to ~1fps along with
   `requestAnimationFrame` — so eight poses produced eight byte-identical PNGs of
   a stale surface. `__BS.captureDataURL()` reads the WebGL drawing buffer
   instead and cannot go stale.

A fifth is worth stating as a rule rather than a bug: **there is no image
statistic that detects "the camera is inside a wall".** That fault is geometric.
`__BS.cameraClearance()` is the guard that works.

## The blind comparison

`output/reference/bf2/` holds real Battlefield 2 screenshots (gitignored — never
committed, never published). Both sides go through an identical pipeline before a
reviewer sees them, because four separate things would otherwise identify the
reference with no reference to render quality at all:

- **HUD** — the references carry burned-in chat, minimap and ammo bars. Both
  panels are cropped to the same measured central band (y 0.44–0.76, x 0.08–0.92)
  that clears all of it.
- **Resolution and compression** — ours are sharp PNG, theirs are soft JPEG. Both
  go through the same resample and JPEG round-trip.
- **Floating nametags** — unavoidable in a multiplayer capture and uncroppable.
  So synthetic tags are composited onto *both* panels by the same generator.
- **Repeats** — our shots never repeat within a run, so a recognised panel is
  necessarily the reference. Each reference is used at most once per run.

Our shots are captured with the view model visible, because nearly every BF2
screenshot is first-person with a weapon in frame and "which panel has a gun in
it" would otherwise sort the two sets perfectly.


## Where it landed

Verified state at the end of the first build pass.

**Objective bar — all seven metrics inside the Battlefield 2 distribution**, measured
through the identical crop band (`blacksand-metric-compare.mjs`, ours / BF2 median,
with BF2's full range in brackets):

| metric | ours | BF2 | range |
| --- | --- | --- | --- |
| mean luma | 126.7 | 100.4 | 81.4 – 160.2 |
| std dev | 40.7 | 46.2 | 38.7 – 57.6 |
| saturation | 41.6 | 30.9 | 7.3 – 71.0 |
| dark % | 3.7 | 5.4 | 0.1 – 10.8 |
| bright % | 0.2 | 0.0 | 0.0 – 5.8 |
| tonal range | 28 | 29 | 22 – 32 |
| local detail | 17.8 | 14.6 | 8.1 – 27.1 |

**Movement probe: 14/14.** Run 4.60 m/s, sprint 6.39 (target 4.6 × 1.39 = 6.394),
jump apex 1.02m, stance heights correct, vault clears a 0.9m wall at 0.93m peak and
correctly refuses a 2.6m one, slide preserves sprint momentum and holds a 0.9s
cooldown, zero terrain penetration over a 40-leg random walk.

**Budget:** 546 draw calls, 760k triangles, clean console.

## Bugs found by the harnesses, not by looking

Each of these presented as something other than what it was.

- **`ground(x, z, h)` called 14 times as `ground(x, z)`** — `h` undefined, every
  beauty-shot camera at NaN. Nine of ten poses rendered flat grey and read as fog.
- **UnrealBloomPass blanking the frame** — with its own strength at 0. Replaced.
- **The player walked through walls** — `closestPointOnBox` shared a scratch vector
  with its caller's argument and transformed it into box-local space behind the
  caller's back. Measured 21m past a wall a raycast saw 2.15m ahead. `mantleProbe`
  had the same aliasing against `raycast`'s internals.
- **Auto-vault gated on `result.hitWall`** — a flag the step-up logic clears. Every
  component tested correct in isolation while the feature never fired. Now a
  throttled forward probe at 30Hz.
- **`injectMove` was inert** — overwritten by `beginStep` every step, so the probe
  measured 0.00 m/s and blamed the controller.
- **The bots were shooting the test subject** — a 12m traversal run got the player
  killed and respawned elsewhere, so the fixture measured a different player in a
  different place. A movement test must own the world it measures in.

## Round 2: the blind comparison ran, and we lost 0-11

A separate agent, briefed as a hostile art director and forbidden from opening the
answer key, judged all 11 pairs and picked Battlefield 2 every single time. Full
verdict and the prioritised defect list: `docs/blacksand-critic-round-2.md`.

Its summary: *"a lit greybox with a colour LUT on it, missing cast shadows, ambient
occlusion, normal maps and atmospheric perspective as categories."*

**The single most useful thing learned:** every one of the seven image metrics was
inside the Battlefield 2 distribution when we lost 11-0. The metric suite is a
**floor, not a ceiling** — it catches exposure, contrast, colour and detail-density
faults, and it is blind to missing shadows, missing AO, floating characters and
repeating tiles. Both gates are needed and neither substitutes for the other.
