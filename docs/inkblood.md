# INKBLOOD 血墨 — Night Parade of One Hundred Demons

A hand-inked, black-and-white manga horde survivor. Fifteen minutes,
three bosses, nine weapon lines with evolutions. The only colour on
the page is blood (crimson) and arcane energy (violet) — everything
else is paper, ink and hatching.

- Page: `games/inkblood.html`
- Code: `assets/js/inkblood/` (ES modules, loaded by a classic `boot.js`)
- Card art: `assets/img/inkblood/card-inkblood-ai.jpg` (generative AI
  manga key art, composed for the site's 3:2 source and 16:9 card crop)
- Score id: `inkblood`
- Debug hook: `window.__INK`

Immersive full-bleed page (like AGAIN. / Tardigrade Simulator), not the
standard `.game-layout` chrome.

---

## The art pipeline

The shipping presentation is a hybrid rather than an all-procedural
renderer. Human-directed generative-AI manga sheets provide the primary
characters, environment props, ground and combat art. They are processed
into gameplay-ready plates ahead of time and loaded as ordinary same-origin
images at boot; no model or image-generation API runs in the browser.

The original Canvas figure and mark system remains in the repository. It
still draws effects and UI details, provides the complete fallback cast and
environment when the generated plates cannot load, and powers the existing
large-scale figure inspection harness.

### Generated manga plates

All generated gameplay art lives under `assets/img/inkblood/generated/`.
The repository keeps only the cleaned production plates; temporary keyed
generation sheets are not shipped. Character, prop and combat plates have
transparent exteriors so the engine can derive hit flashes and silhouettes
from their alpha. The lossless WebP plates are pixel-identical to their
cleaned PNG masters while reducing the shipped art payload by roughly one
third. `ground-manga-v1.webp` is an opaque authored battlefield plate.

| Plate | Runtime role |
| --- | --- |
| `hero-manga-v1.webp` | Hero animation: **4 idle, 8 run and 8 slash frames** |
| `hero-portrait-manga-v1.webp` | HUD/title portrait |
| `enemies-manga-v1.webp` | Eight normal yokai; grounded enemies use two-pose gaits and explicit attacks, while Yurei and Onryo hold a clean silhouette and bob as floating wraiths |
| `bosses-manga-v1.webp` | Gashadokuro, Oni and Nurarihyon; **4 gait frames plus explicit attack frames** per boss |
| `props-manga-v1.webp` | Authored grass, stones, bones, graves, lantern, torii, tree and broken-shrine ruin props |
| `ground-manga-v1.webp` | World-locked manga ground, enlarged and centre-offset across alternating mirrored cells to avoid hard repeat seams and obvious wallpaper repetition |
| `combat-manga-v1.webp` | Authored pickups, weapon art, enemy shot, ink hit, slash and blood-splat icons; existing motion, rotation and effect systems keep them animated |

The production prompt set used the supplied screenshot as an art-direction
reference for density and mood, while requesting original designs: hand-inked
seinen manga, dry-brush contours, cross-hatching and screentone on bone-white
paper, with crimson blood and restrained violet energy. Separate structured
plates requested a 4x5 hero idle/run/slash sheet, normal-yokai and boss
walk/attack sheets, a shrine-graveyard prop sheet, an open-centre top-down
battlefield, combat/pickup icons, and a square hero portrait. Character and
object plates were generated on a flat chroma field, then alpha-cleaned for
runtime slicing.

`assets/js/inkblood/generated-assets.js` loads and slices these plates into
the engine's existing foot-anchored `{ canvas, ox, oy, w, h }` frame records.
It also builds the blood/white/ink silhouette canvases used for damage
flashes, title crowds and boss panels. Keeping that record contract means
camera motion, y-sorting, facing flips, collision and combat timing did not
need to change for the new art.

`Game.load()` first bakes the procedural props, effects and weapon art, then
installs the generated cast, ground, props and combat images. If a required
generated image cannot load or decode, startup logs the failure, calls
`bakeCast()` and continues with the already-baked procedural art instead.
`__INK.stats.artMode`, `assetsLoaded` and `assetsFailed` expose which path a
run is using.

### `art.js` — procedural marks and fallback effects

| Primitive | What it is | Why |
| --- | --- | --- |
| `brush(ctx, pts, opts)` | Tapered, wobbly filled ribbon | A constant-width `stroke()` is the biggest tell that a drawing was made by a machine. **`width` is a HALF-width.** |
| `inkContour(ctx, pts, opts)` | Variable-weight silhouette outline | Swells where the surface turns from the light, thins to nothing where it faces it, with occasional dry-brush gaps. `rimOnly: true` draws the pale highlight instead. |
| `feather(ctx, opts)` | Field of tapered strokes whose length, width and density all fall off along a gradient axis | The core shading mark. Density is sampled per dash, so one lane can be solid at one end and absent at the other. |
| `hatchShade(ctx, opts)` | Three feather passes (lay-in, cross, core) clipped to the current path | The whole value structure. `dark` 0..1. |
| `stipple` / `stippleShade` | Density-graded dots | Grain under the hatching: stone, rot, old skin. |
| `splat` / `spray` | Wobbled radial blobs, directional flicks | Blood and ink impacts. |
| `toneTile` / `fillToneDevice` | Seamless 45° halftone | Used sparingly now — hatching carries most of the value. |

**Procedural marks are measured in device pixels.** `fillToneDevice`,
`hatchShade` and `stippleShade` all reset the transform before
drawing. Screentone and pen weight are properties of the *paper*, not
of the thing being drawn: let them scale with the figure and a sprite
baked at 2x comes out looking like a chessboard.

### `figure.js` — fallback bodies

`shape(ctx, pts, opts)` is the one call that matters. It fills, grains,
hatches, contours and rim-lights a closed form:

```js
shape(g, pts, {
  fill: PAL.paperLit,   // or PAL.ink, or { tone, cell }
  shade: 0.5,           // hatched form shadow, 0..1
  stipple: 0.12,        // optional grain
  line: 2,              // contour weight
  contrast: 1.3,        // how much the contour swells in shadow
  seed: 42,
});
```

Two rules are load-bearing and were both learned the hard way:

1. **Draw order around the face.** Hair goes down in two passes —
   `drawHairBack()` *before* the head, `drawHairFront()` *after* the
   face. One combined pass paints over the character's eyes and at
   90px tall they lose all personality.
2. **Rim light on every solid black.** Two black shapes that touch
   merge into one unreadable mass, which is exactly what a cape over
   black boots over black hair does. `shape()` adds a broken pale
   highlight along the lit edge of any `PAL.ink` fill automatically.

`SHADE_GAIN` in `figure.js` is a single global knob for how dark the
whole cast reads.

### `sprites.js` — procedural fallback cast

Eleven characters remain available as parametric rigs (`buildRig` +
`runPose`) drawn through the figure primitives. `bakeCast()` produces the
same runtime record shape as the generated loader, including the hero's
4-frame idle, 8-frame run and 8-frame slash sets, six gait frames for normal
enemies and four for bosses. `PX_PER_UNIT` sets world scale; `SS` is the
supersample.

`bakeFigure(name, { scale })` bakes one character at arbitrary size —
used by `tests/fixtures/inkblood-figure.html` to inspect a character at 3–4x,
which is the only way to judge whether hatch density is reading as
strokes or as mud. This fixture intentionally exercises the retained
procedural fallback rather than the generated atlas.

---

## Systems

| Module | Owns |
| --- | --- |
| `game.js` | Loop, entity arrays, spatial hash, camera, render layering, screens |
| `generated-assets.js` | Generated plate loading/slicing, frame records and alpha-derived variants |
| `sprites.js` | Procedural fallback cast and single-figure inspection bake |
| `weapons.js` | 9 weapon lines + evolutions, 10 passives, projectile motion + rendering |
| `enemies.js` | Roster, wave schedule, scripted events, per-enemy AI |
| `fx.js` | Baked effect atlas, damage numbers, katakana SFX, blood, screen shake |
| `props.js` | Generated ground/prop installation, deterministic infinite scatter, procedural fallback, drifting ash |
| `hud.js` | Canvas HUD panels, level-up cards |
| `audio.js` | Fully synthesised sparse taiko/breath score and combat SFX; no continuous drone or sound files |
| `input.js` | Keyboard, gamepad, floating touch thumbstick |

**Performance shape.** One array per entity class, all swept with a
backwards splice. A uniform-grid spatial hash is rebuilt each frame
and every "what is near X" query goes through it. Measured **75fps
with 329 enemies, 293 pickups, 150 blood decals and a live boss at
DPR 2 on a 2252×1266 backing store** after the generated-art integration.

---

## Debug hook

`window.__INK`:

```js
__INK.stats                 // fps, entity counts, time, level, kills
                            // plus artMode/assetsLoaded/assetsFailed
                            // and the current enemyAttacking count
__INK.sim(seconds)          // advance without rendering; kites the player
                            // and auto-resolves level-ups
__INK.newRun()
__INK.god(true)             // goes through baseStats so recomputeStats can't undo it
__INK.give(id, level)       // weapon
__INK.givePassive(id, level)
__INK.levelUp()
__INK.spawn(type, n, radius)
__INK.boss("gashadokuro" | "oni" | "nurarihyon")
__INK.kill() / __INK.win()
__INK.shotStep(name)        // named states for the screenshot harness
```

`sim()` exists because headless Chromium throttles `requestAnimationFrame`,
so waiting real seconds for the game to reach an interesting state does
not work.

Two stable browser-QA hooks are also installed directly on `window`:

```js
render_game_to_text()       // JSON: mode/time/score/art mode, player action,
                            // world-coordinate convention and visible enemies
await advanceTime(ms)       // wait through requestAnimationFrame for real-time
                            // animation/state observation
```

`advanceTime()` does not fast-forward the simulation; use `__INK.sim()` for
that. It exists so browser automation can wait for real rendered animation
without depending on an arbitrary external sleep.

---

## Harnesses

```bash
node scripts/inkblood-artcheck.mjs  # procedural fallback bake boxes: is art cropped?
node scripts/inkblood-asset-audit.mjs  # generated hero/cast/props/combat bounds + contact sheets
node scripts/inkblood-e2e.mjs       # 48 checks, including the Escape menu, mobile meter stack and close-slash coverage
node scripts/inkblood-soak.mjs --god  # full 15-minute run, leak + curve report
node scripts/inkblood-perf.mjs      # headed FPS probe at worst case
node scripts/inkblood-shots.mjs --script title,play,swarm,boss,levelup
node scripts/inkblood-shots.mjs --url "/tests/fixtures/inkblood-figure.html?who=hero&scale=4"
```

The perf probe runs **headed on purpose** — headless has no compositor
and reports render costs roughly 30× worse than reality.

### Procedural fallback bake boxes

Each procedural entry in `CAST` (and `heroBox`) carries a hand-written
extents box in figure units. Get it wrong and the fallback art is
**silently cropped** — a sword tip, a horn, a club head just stops at the
canvas edge and nothing errors. Five of twelve figures were clipped on the
first pass.

`scripts/inkblood-artcheck.mjs` bakes every figure across its whole
cycle, reads the alpha channel, and reports both border contact and
the *minimum* margin across frames (minimum, because trimming a box
against one frame's slack would clip another frame where a limb swings
further). **Run it after changing any fallback figure's proportions, pose
amplitude or held equipment.** Generated plates need their own rendered-game
inspection because their crop and anchors are owned by `generated-assets.js`.
`scripts/inkblood-asset-audit.mjs` now performs that shipping-path inspection:
it checks every generated hero, enemy, boss, prop and combat canvas for edge
contact and writes cast/prop/combat contact sheets for visual review.

### Alternate in-engine cover

```bash
node scripts/inkblood-shots.mjs --script poster --width 1800 --height 1200 --dpr 1 --out output/inkblood-shots/poster
```

The `poster` step sets `game.posterMode`, which suppresses the control
hints. This is useful for an engine-authored alternate cover; the public
site currently uses the generative AI key art above.

---

## Balance notes

Numbers that were tuned against the soak test and are easy to break:

- **The Crimson Arc opens with one forward slash.** Coverage is earned rather
  than granted: the rear slash unlocks at level 3, a third crescent at level 5,
  and a fourth at level 8.
- **Bosses opt out of the HP curve** (`Director.bossCurve`). Scaling
  authored boss health a second time by the clock made the final boss
  ~480,000 HP and stretched a 15-minute run past 30.
- **Loose pickups are capped at 320** and surplus gems are folded into
  the newest one, so no experience is lost. Uncollected souls reached
  1,991 objects by minute 15 before this.
- Blood decals cap at 150; enemies at 340.
