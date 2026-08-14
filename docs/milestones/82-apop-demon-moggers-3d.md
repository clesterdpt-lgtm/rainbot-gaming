# 82 — Apop Demon Moggers 3D

Rebuild of the 2D side-scroller `apop-demon-hunters` as a Super Mario 64-class
3D collectathon platformer in Three.js, at the same page URL.

## Why the page URL did not change

`games/apop-demon-hunters.html` is linked from the game catalog in
`assets/js/main.js`, from `games.html`, and from the sitemap. Rebuilding in
place keeps every one of those links working and keeps the existing card art.
The old 2D build stays in git history; the new engine lives in a new module
directory rather than overwriting `assets/js/apop-demon-hunters.js` in place,
so the diff is readable.

## Shape of the build

| Path | What |
| --- | --- |
| `assets/js/apop3d/boot.js` | classic script: CDN pick, import map, entry handoff |
| `assets/js/apop3d/main.js` | ctx construction, module wiring, the frame loop |
| `assets/js/apop3d/core.js` | pure helpers — math, seeded RNG, noise, easing, Pool/Bus/Timer |
| `assets/js/apop3d/CONTRACT.md` | the engine contract every module codes against |
| `assets/js/apop3d/*.js` | 23 domain modules, one owner each |
| `assets/css/apop3d.css` | page shell, boot overlay, HUD frames |

Three.js 0.180 is pulled from a CDN with a fallback, exactly as `blacksand`
does. Every module is listed in the boot import map so a `?v=` bump
invalidates all of them — without that, a browser keeps serving a stale
`player.js` and a shipped fix looks like it did nothing.

## The contract

`assets/js/apop3d/CONTRACT.md` is the load-bearing document. It fixes:

- the game identity carried over from the 2D original (Moggadonna, Lucifer
  Lipsync, Boyz II Hell, the eight-demon roster, the five courses)
- the `ctx` object and the lifecycle every module implements
- **the fixed per-frame update order** — anything that moves a body runs in
  `update`, anything that needs a final transform (camera, IK, attachments)
  runs in `lateUpdate`
- frozen cross-module signatures (§9), so ten agents could build against each
  other's modules before those modules existed
- units, tuning constants, and the performance budget

## Known traps, written down so they are not rediscovered

- **Resizing a canvas clears it.** The dynamic-resolution controller only
  changes the drawing-buffer size immediately before a draw, or the player
  sees a black flash.
- **Adding a light recompiles every material in the scene.** The full light
  set is allocated at course load and dimmed to zero, never added or removed.
- **sRGB gets applied exactly once.** Colour maps are tagged `SRGBColorSpace`;
  normal/roughness/AO stay `NoColorSpace`.
- **Headless Chromium throttles rAF to about 1 fps.** The shot harness polls
  `__APOP3D.frame` and drives `advance(seconds)` rather than waiting on real
  frames, and reads the WebGL drawing buffer rather than compositing a
  screenshot — the compositor hands back stale surfaces otherwise.
- **The in-app preview pane never ticks rAF at all.** Visual verification goes
  through the Playwright harness, not the preview pane.

## Verification pipeline

```bash
node scripts/apop3d-shots.mjs --course 1
```
Boots the game in GPU-backed headless Chromium, pins resolution and shadow
cadence, hides the HUD, poses the camera through the §8 capture presets and
writes PNGs plus `_diagnostics.json` (draw calls, triangles, console errors).

```bash
node scripts/apop3d-fetch-refs.mjs
```
Pulls real Super Mario 64 gameplay frames into `output/reference/sm64/` via
the Super Mario Wiki MediaWiki API. `output/` is gitignored — the pool is
local art-review input, never committed, published or shipped. Menus and
non-gameplay frames are culled to `output/reference/sm64-rejected/`.

```bash
node scripts/apop3d-blind-compare.mjs --ours output/apop3d-shots/latest \
  --out output/apop3d-blind/round-1 --seed 7 --match-softness
node scripts/apop3d-blind-compare.mjs --reveal output/apop3d-blind/round-1 \
  --answers A,B,A,...
```
Builds blind A/B pairs against the reference pool and scores them. The pairing
neutralises every non-art tell it can: a measured HUD-clear crop applied to
both sides, an identical resample and JPEG round-trip, optional matched
softness so pixel sharpness cannot be the discriminator, no reference reused
within a run, and an exactly balanced side plan.

`--match-softness` matters. If we only win with it off, we won on resolution
rather than on art direction, and the round does not count.
