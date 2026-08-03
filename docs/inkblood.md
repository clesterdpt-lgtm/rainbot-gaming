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

## The art engine

Nothing in this game is a bitmap asset. Every character, prop, effect
and UI panel is drawn from four primitives at boot and blitted at
runtime.

### `art.js` — marks

| Primitive | What it is | Why |
| --- | --- | --- |
| `brush(ctx, pts, opts)` | Tapered, wobbly filled ribbon | A constant-width `stroke()` is the biggest tell that a drawing was made by a machine. **`width` is a HALF-width.** |
| `inkContour(ctx, pts, opts)` | Variable-weight silhouette outline | Swells where the surface turns from the light, thins to nothing where it faces it, with occasional dry-brush gaps. `rimOnly: true` draws the pale highlight instead. |
| `feather(ctx, opts)` | Field of tapered strokes whose length, width and density all fall off along a gradient axis | The core shading mark. Density is sampled per dash, so one lane can be solid at one end and absent at the other. |
| `hatchShade(ctx, opts)` | Three feather passes (lay-in, cross, core) clipped to the current path | The whole value structure. `dark` 0..1. |
| `stipple` / `stippleShade` | Density-graded dots | Grain under the hatching: stone, rot, old skin. |
| `splat` / `spray` | Wobbled radial blobs, directional flicks | Blood and ink impacts. |
| `toneTile` / `fillToneDevice` | Seamless 45° halftone | Used sparingly now — hatching carries most of the value. |

**Everything is measured in device pixels.** `fillToneDevice`,
`hatchShade` and `stippleShade` all reset the transform before
drawing. Screentone and pen weight are properties of the *paper*, not
of the thing being drawn: let them scale with the figure and a sprite
baked at 2x comes out looking like a chessboard.

### `figure.js` — bodies

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

### `sprites.js` — the cast

Eleven characters, each a parametric rig (`buildRig` + `runPose`)
drawn through the figure primitives and baked into frames at boot.
`PX_PER_UNIT` sets world scale; `SS` is the supersample.

`bakeFigure(name, { scale })` bakes one character at arbitrary size —
used by `tests/fixtures/inkblood-figure.html` to inspect a character at 3–4x,
which is the only way to judge whether hatch density is reading as
strokes or as mud.

---

## Systems

| Module | Owns |
| --- | --- |
| `game.js` | Loop, entity arrays, spatial hash, camera, render layering, screens |
| `weapons.js` | 9 weapon lines + evolutions, 10 passives, projectile motion + rendering |
| `enemies.js` | Roster, wave schedule, scripted events, per-enemy AI |
| `fx.js` | Baked effect atlas, damage numbers, katakana SFX, blood, screen shake |
| `props.js` | Deterministic infinite ground scatter, drifting ash |
| `hud.js` | Canvas HUD panels, level-up cards |
| `audio.js` | Fully synthesised taiko + drone score, no sound files |
| `input.js` | Keyboard, gamepad, floating touch thumbstick |

**Performance shape.** One array per entity class, all swept with a
backwards splice. A uniform-grid spatial hash is rebuilt each frame
and every "what is near X" query goes through it. Measured **75fps
with 330 enemies, 300 pickups, 150 blood decals and a live boss at
DPR 2 on a 3200×1800 backing store.**

---

## Debug hook

`window.__INK`:

```js
__INK.stats                 // fps, entity counts, time, level, kills
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

---

## Harnesses

```bash
node scripts/inkblood-artcheck.mjs  # sprite bake boxes: is any art cropped?
node scripts/inkblood-e2e.mjs       # 17 checks, real key/mouse input
node scripts/inkblood-soak.mjs --god  # full 15-minute run, leak + curve report
node scripts/inkblood-perf.mjs      # headed FPS probe at worst case
node scripts/inkblood-shots.mjs --script title,play,swarm,boss,levelup
node scripts/inkblood-shots.mjs --url "/tests/fixtures/inkblood-figure.html?who=hero&scale=4"
```

The perf probe runs **headed on purpose** — headless has no compositor
and reports render costs roughly 30× worse than reality.

### Bake boxes

Each entry in `CAST` (and `heroBox`) carries a hand-written extents
box in figure units. Get it wrong and the art is **silently cropped** —
a sword tip, a horn, a club head just stops at the canvas edge and
nothing errors. Five of twelve figures were clipped on the first pass.

`scripts/inkblood-artcheck.mjs` bakes every figure across its whole
cycle, reads the alpha channel, and reports both border contact and
the *minimum* margin across frames (minimum, because trimming a box
against one frame's slack would clip another frame where a limb swings
further). **Run it after changing any figure's proportions, pose
amplitude or held equipment.**

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

- **The Crimson Arc opens with TWO arcs, front and back.** With a
  single forward arc the opening minutes are unwinnable: you spend
  them retreating, the cut lands on empty ground, no souls drop, no
  levels arrive, and the run never starts.
- **Bosses opt out of the HP curve** (`Director.bossCurve`). Scaling
  authored boss health a second time by the clock made the final boss
  ~480,000 HP and stretched a 15-minute run past 30.
- **Loose pickups are capped at 320** and surplus gems are folded into
  the newest one, so no experience is lost. Uncollected souls reached
  1,991 objects by minute 15 before this.
- Blood decals cap at 150; enemies at 340.
