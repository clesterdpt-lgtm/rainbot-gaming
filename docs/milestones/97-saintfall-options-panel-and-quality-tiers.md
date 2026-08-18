# 97 — SAINTFALL: the start-screen OPTIONS panel you could not read, and a graphics quality switch

Two reports from one session: "some of the text in the options menu on
the start screen is black and can't be seen", and "add the ability to
change graphics quality so people with bad hardware can run it smoothly".
Build `20260817-options-quality-1`.

## The options panel had gone back to user-agent defaults

`assets/css/saintfall.css`. Milestone 96's main-menu pass floated the four
actions as bare typography over the art and, to do it, removed the shared
`.sf-intro__gate button` base. The load slots and option switches had been
leaning on that base for their colour, their font, and their flex layout.
A `<button>` inherits none of those, so every panel control fell to the
browser's own: black `buttontext` on a near-black panel (FIELD AUDIO,
REDUCED MOTION, HIGH CONTRAST, DYNAMIC RESOLUTION and every OFF were
invisible; only the italic descriptions and the teal ONs survived), the
system sans, and no flex — the ON/OFF badge wrapped under its label.

Fixed by giving panel controls their own base,
`.sf-intro__gate .sf-entry__panel button` (placed *before* the slot and
option rules — same specificity, so source order decides), and by
promoting the HUD-scale row into a generic segmented picker
(`.sf-entry__pick`, `--wide` for four segments on their own line). Labels
went from .58rem to .62rem and the descriptions from 42% to 66% opacity
while at it. High contrast now treats the panels, not the frame that is
no longer there.

Three more things found on the way and fixed:

- **A shrunk grid collapses its rows.** The gate is now a flex column with
  `max-height: calc(100% - 2.5rem)` so an open panel shrinks to the stage
  instead of spilling past it (the un-maximised embed is ~500px tall and
  `vh` cannot see that). But a list that becomes a definite-height flex
  item hands grid a container smaller than its rows, and grid `auto` rows
  then collapse to their *minimum contributions* — the 3rem `min-height` —
  so the two-line GRAPHICS QUALITY row painted its segments straight over
  DYNAMIC RESOLUTION. `grid-auto-rows: max-content` on both lists; the
  panel scrolls and, via `data-scroll-more` from intro.js, fades its
  bottom edge while rows are under the fold.
- **`.sf-entry__options` is two things**: the OPTIONS toggle button's
  class *and* the options list's class. Measuring "the list" with a bare
  selector measures the hidden button (height 0, scrollHeight 0), which
  cost twenty minutes. List rules are scoped under `.sf-entry__panel--options`.
- **Invisible overlays above the menu.** `.sf-intro__chapter` and
  `.sf-intro__telemetry` sit at z 20 over the gate at z 10, at opacity 0
  while the menu is up. On the phone layout the chapter card lies exactly
  over the bottom-anchored buttons and swallowed every tap on OPTIONS.
  Both are `pointer-events: none`; neither contains a control.

## Graphics quality is a setting, in both menus, applied before the first frame

The renderer already had a four-tier `setQuality` (URL `?quality=` only)
whose `low` still drew at the full device pixel ratio with 4x MSAA. The
frame is fill-bound (milestone perf-1: at device ratio 2 the scene + post
chain alone is the 60fps budget), so the tiers are now ordered by pixels
first — `render.js` `QUALITY`, at module scope so the UI can list it:

| tier | device-ratio cap | ratio | MSAA | shadow map | redraw every | AO | bloom |
|---|---|---|---|---|---|---|---|
| LOW | 1 | 0.75 | 0 | 1024 | 3 frames | off | .35 |
| MEDIUM | 1.5 | 1.0 | 2 | 2048 | 2 | .72 | .45 |
| HIGH | 2 | 1.0 | 4 | 4096 | 2 | .85 | .5 |
| ULTRA | 2 | 1.0 | 4 | 4096 | 2 | .95 | .5 |

HIGH is byte-identical to what it was, so goldens and every review harness
are unaffected (`saintfall-perf-verify.mjs` still passes its QA-pinning
contract; `?qa=1` still redraws shadows every frame regardless of tier).
LOW on a Retina laptop draws 960x540 where HIGH draws 2560x1440 — seven
times fewer pixels, no MSAA, no AO — and the dynamic-resolution controller
still runs on top of whichever tier is chosen.

Two mechanics worth recording. **MSAA cannot be changed by changing
`samples`**: three builds the multisampled framebuffer the first time the
target is bound and never revisits it, and `resize()` is a no-op when the
buffer size is unchanged, so the switch does `sceneTarget.samples = n;
sceneTarget.dispose()` and lets the next bind rebuild everything — the
depth texture the AO and composite passes read is re-created on the same
JS object, so their uniforms stay valid (proved by reading the drawing
buffer after every switch: mean luma 93–96, 99.8% lit, all six
transitions). And **the menus highlight the LIVE tier**: a `?quality=`
URL is a session override harnesses use and must never write itself into
the preference, so `settingsState().quality` is `render.quality`,
`qualityStored` is the preference, and both the entry OPTIONS panel and
the in-game SETTINGS page follow the frame rather than the store.

Wiring: ui.js owns the `quality` key in `saintfall:field-ui:v1` and takes
a `setQuality` callback from main.js (whose version also resizes the
sun's shadow map and re-fits the canvas); intro.js renders the same
picker from `QUALITY_TIERS`; main.js applies `?quality=` || stored ||
high before the first frame and then refreshes both menus.

## Evidence

`scripts/saintfall-quality-tier-check.mjs` — 76 checks: default tier at
DPR 2, every tier through the real in-game control (ratio, MSAA, AO,
shadow size, cadence, stored, highlighted, frame-is-a-picture), stored
tier applied at boot, URL override live-but-not-stored, entry panel
contrast (23 texts, none dark, none in the UA font), the short-stage
row-collapse regression, and a LOW-vs-HIGH crop. Artifacts in
`output/saintfall/quality/`. `saintfall-perf-verify.mjs`,
`saintfall-dynres-toggle-check.mjs` and `saintfall-ui-regression.mjs`
(97/97) all pass after the change.
