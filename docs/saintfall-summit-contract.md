# SAINTFALL — THE WHITE VIGIL
### Integration contract for the "summit" content pack (Kenosis)

> Status: **binding spec.** The art counterpart is
> `docs/saintfall-summit-art-direction.md`; the authored coordinates are
> `docs/saintfall-summit-layout.md`. This document says how the pack
> plugs into the engine. Where the three disagree, layout wins on
> numbers, art direction wins on intent, and **this document wins on
> interfaces**.
>
> Scope: **environment only.** No enemies, no bosses, no mission, no
> combat, no progression, no saves. Every one of those is *omitted*,
> not stubbed, except where a reused UI module refuses to build without
> one — those exceptions are enumerated in §2.4 and nowhere else.
>
> The governing constraint: **Vesper-IX must not regress.** The pack is
> parallel content, not a fork. Four existing files may be touched, and
> the diff in three of them is already made.

---

## 0. What already exists (do not redo)

| file | state | what it is |
|---|---|---|
| `assets/js/saintfall/boot.js` | **edited, uncommitted** | `BUILD = "20260821-summit-1"`; the nine `summit-*` names appended to `MODULES` (boot.js:106-115); `entryModule()` allowlist reading `document.body.dataset.sfEntry` (boot.js:118-129); the entry import interpolates it (boot.js:239). |
| `games/saintfall-white-vigil.html` | **new, uncommitted** | The level page. `data-sf-entry="summit-main"`, `data-sf-world="summit"`, `class="… saintfall-shell saintfall-shell--vigil"`, `data-rb-native-escape-menu="true"`. Carries `#sf-canvas`, `#sf-hud`, `#sf-touch`, `#sf-tutorial`, `#sf-intro`, `#sf-boot` and the `.sf-stage` / `.rb-standalone-surface` / `.rb-standalone-stage` wrapper chain. |
| `games/saintfall.html` | **edited, uncommitted** | Cache tag only: three `?v=` bumped to `20260821-summit-1`. No structural change. |
| `scripts/saintfall-shots.mjs` | **edited, uncommitted** | `--page <file>` flag so the shared review harness can point at either level. |

Nine module *names* are therefore already frozen by boot.js. Do not
invent a tenth without editing that array — an unlisted module resolves
through the unversioned `"saintfall/"` prefix rule (boot.js:112-114) and
Chrome caches it heuristically for days. That failure is recorded in
boot.js's own comment block.

---

## 1. MODULE MAP

### 1.1 New files — nine modules, one page, N harnesses

All under `assets/js/saintfall/`. The name column is the exact
`MODULES` entry; the import specifier is `saintfall/<name>.js`.

#### `summit-art.js`
Owns **the alpine atmosphere model and the snow/ice material library.**

- `export function makeSummitAtmosphere(THREE, timeKey = "alpenglow", options = {})` — a peer of `art.js:655 makeAtmosphere`, producing an object with the **identical field set** (§4.1). It closes over its own `TIMES` / `GRADES` / `DAY_CYCLE_STOPS`, and blends toward `TIMES.whiteout` where art.js blends toward `TIMES.storm` (art.js:746, art.js:786).
- `export const SUMMIT_TIMES`, `export const SUMMIT_GRADES` — plain objects, exported so `summit-qa.js` can list them (qa.js:152 does `Object.keys(TIMES)` on art.js's table; ours is a parallel list).
- `export function makeSummitMaterials(THREE, atmos)` — calls `makeMaterials(THREE, atmos)` from `art.js:1472` for the shared archetypes (`stone, rock, basalt, iron, rust, bone, bronze, verdigris, gold, cloth, glow, emissive`) and **adds** `snow, slab, powder, blueIce, blackIce, rime, granite, sulphur, scree` (§4.3). Returns one merged lib object with `all`, `get(name)` and `transparentOf(name, opacity)` preserved.
- The ramps: `SNOW_RAMP, SLAB_RAMP, BLUEICE_RAMP, BLACKICE_RAMP, GRANITE_RAMP, RIME_RAMP, SULPHUR_RAMP, SCREE_RAMP`, built with `makeRamp` from `core.js:306`.
- `export const STATION_TINT` — the peer of art.js's `DISTRICT_TINT`, keyed by the nine station ids.

**Must not** edit `art.js`. It *imports* from it: `patchMaterial`, `patchBasicMaterial`, `makeMaterials`, `paintGeometry`, `paintFlat`, `paintByHeight`, `srgbTransfer`, `buildSkyEnvironment`.

#### `summit-terrain.js`
Owns **the height field, the snow-depth field, the Via Sacra spatial index, the station table, and the chunked mesh build.** Full contract in §3.

#### `summit-structures.js`
Owns **alpine primitives that `structures.js`'s kit does not have.**
`makeKit(THREE)` (structures.js:35) is imported and reused verbatim for
`ringSolid / prism / slab / polyExtrudeY / extrudeZ / ribbonSolid /
rockTube / tube / crag / shard / boulderField / archOutline /
gothicArch / column / flyingButtress / spire / statue / banner /
catwalk / transform / roughen / facet / merge`.

New, and only these:
`serac(rng, opts)`, `crevasseLip(rng, opts)`, `icicleFringe(edgePts, opts)`,
`rimeFeathers(geo, windDir, opts)` (a displacement pass, not a solid),
`snowCap(geo, depthAt, opts)` (the drift skin that beds a prop into its
own snow), `columnarIce(rng, opts)` (the Cascade's organ pipes),
`pressureRidge(rng, opts)` (the Tarn), `bellFrame(rng, opts)`,
`votiveMarker(rng, opts)`, `parapet(points, opts)`.
Plus a **copy** of `polyRadiusFactor` (structures.js:1685-1690) — it is
private to `saintHead` and is required by anything studded onto a
`ringSolid` facet.

#### `summit-sky.js`
Owns **the alpine dome, the cloud inversion deck, the 22° halo and sun
dogs, and the two scene lights.** A copy-and-replace of `sky.js:190
buildSky`, exporting the same shape: `{ group, sun, skyFill, dome,
halo, clouds, setUnderground(v), underground(), status(), refresh(),
update(dt, camera) -> boolean, setShadowRadius(half), shadowSpan,
shadowTexel, applyShadowBias }`.

Rules, all load-bearing:
- `DOME_FRAG`'s `sfSky()` must stay **byte-identical** to art.js's copy at `art.js:1030-1045`. sky.js:4-9 records the failure: any drift is "a visible seam along every horizon line, and it reads as a bug in the terrain rather than in the sky." Since we reuse `patchMaterial` unchanged, art.js's copy is fixed, so **ours must match art.js, not the other way round.**
- **The 22° halo and the sun dogs are GEOMETRY, not a dome term.** A dome-only ring crosses the horizon at a low sun, and the terrain's aerial-perspective fade (`mix(gl_FragColor.rgb, sfSky(rd), f)`, art.js:1126) would not have it — a bright arc would terminate at every ridge line. Build them the way sky.js builds its existing halo ring at R=6200 (sky.js:278-437): additive geometry through `patchBasicMaterial(mat, atmos, fade, /* additive */ true)` (art.js:1412).
- **Exactly two lights, both scene-parented at build**: the `DirectionalLight` sun and the `HemisphereLight` fill (sky.js:248, 257). A light that joins the scene later recompiles every lit program — the 198 ms freeze in the light-state note. Any runtime light must exist from frame zero at intensity 0.
- `update(dt, camera)` **must return `atmos.update(dt)`'s boolean**; the caller re-applies grade + environment on it (main.js:143-150).
- The inversion deck replaces sky.js's 26 cloud shelves. It is a flowing stratus slab at y ≈ 120 m, sized by **subtended angle** and with width divided by `sin(elev)` — the cirrus rules in the sky-cirrus note apply unchanged, as does the 4-component vertex-colour buffer (`USE_COLOR_ALPHA`) and the rule that a 4-component geometry may never be merged with a 3-component one (sky.js:1006).
- Imports `mergeGeometries` from `sky.js:1001` rather than copying it.

#### `summit-weather.js`
Owns **spindrift, ground blizzard, the snow-fall field, and station
plumes** — everything vfx.js's three ambient systems do not cover.

- `export function buildSummitWeather(ctx, world) -> { group, update(dt, camera), setStorm(v), setVisible(v), reset(), status() }`.
- It is built with **`buildPoints`-shaped code copied from `vfx.js:293`**, because that builder is not exported. Copy the model exactly: a mote is at a **fixed world position** folded into the box around the camera by whole box-widths (`vfx.js:254-256`), the anchor is `camera.position` **unsnapped** (vfx.js:5691), the distance fade ends at `uBox.x * 0.95` (vfx.js:262), and `gl_PointSize` is clamped to `[1, 26]` (vfx.js:271). Re-introducing an anchor snap is the single most expensive mistake available here — see §7.
- Fields: `spindrift` (ridge-anchored, downwind, visible from across the map), `blizzard` (a flat box like vfx.js's `grit` at `[42, 5, 42]`, high drift), `fall` (light snow, low drift, only under the inversion deck or in whiteout).
- It reads `atmos.uniforms.uWind` / `uTimeSF` / `uStorm` **by reference** (vfx.js:135-137, 313-314) — one write per frame drives every mote.
- Every field is `frustumCulled = false` with a 1e6 bounding sphere and therefore a **permanent** fill cost on a frame that is already fill-bound. Three fields is the budget; a fourth needs a measurement, not an opinion.
- `ctx.weather = buildSummitWeather(ctx, world)` and it is ticked from `summit-main`'s `step`, immediately after `vfx.update`.

#### `summit-world.js`
Owns **the nine stations, the Via Sacra dressing, and the cathedral.**
Same contract as `world.js:112 buildWorld`:

```
export async function buildSummitWorld(ctx, onProgress) -> {
  group,                    // THREE.Group named "world"  (MANDATORY, collide.js:526)
  meshes,                   // batch.flush().concat(authoredMeshes)
  lights,                   // THREE.PointLight[], HARD CAP 12 (world.js:4955)
  emitters,                 // {kind,x,y,z,...}  kinds limited to PLUME_PRESETS + "shaft"
  banners,                  // [] unless a bell-terrace pennant is authored
  pois,                     // [{id,name,x,z}]  — summit-hud reads this
  beautyShots,              // [{id,name,position:[x,y,z],target:[x,y,z],fov}]
  getBeautyShots: () => beautyShots,
  walkSurfaceAt,            // (x,z) => y | -Infinity      (collide.js:207)
  walkSurfaceMaxInCircle,   // (x,z,r) => y | -Infinity    (collide.js:893)
  stationSites,             // [{id,x,z,padR,padY}] — the peer of world.choirNeedles
  stats(),
}
```
It reuses `makeBatcher`'s strategy verbatim (world.js:51-106): merge-only,
no instancing, bin key `${station}|${matName}|${tag}`, **first `opts`
object wins for the whole bin** (world.js:60). Batch **per station**, never
per level, or one merged mesh's bounding sphere spans 2 km and never
frustum-culls.

#### `summit-hud.js`
A **fork of `hud.js`**, and it must be a fork: `hud.js:11-13` imports
`DISTRICTS, FOSSE_PATH, FOSSE_SPUR, MAP_HALF, MAP_SIZE, ROAD_PATH` from
`saintfall/terrain.js` at module scope and draws the whole-map raster,
the projection and the reported `range` from them (hud.js:504-506,
573-574, 677-678). None of that is injectable.

The fork changes exactly five things and nothing else:
1. the import re-points to `saintfall/summit-terrain.js` (`STATIONS`, `VIA_SACRA_PATH`, `MAP_HALF`, `MAP_SIZE`);
2. `drawPath` is called once for the Via Sacra instead of three times for road/fosse/spur (hud.js:603-605);
3. the minimap hillshade reads `ctx.field.heightAt` over a 452 m range instead of a 168 m one — **the ramp must be re-normalised or the whole map renders as a white disc**;
4. `for (const [i, inst] of ctx.enemies.live.entries())` at hud.js:815 is deleted (there are no enemies) — it is *not* optional-chained and throws on the first tick otherwise;
5. the chrome strings: eyebrow (hud.js:19), title (hud.js:37-40), and the `if (!combat || !mission) return;` early-out at hud.js:1524-1526 becomes an unconditional continue past the combat/objective block, so the compass, minimap and station labels still draw with no mission.

Everything below that line — health bar, heat, objective, banner, stratagem dock, reticle — is deleted from the fork, not stubbed.

#### `summit-qa.js`
**Augments** `window.__SF`; it does not replace it. `summit-main.js`
calls `installQa(ctx, api)` from `qa.js` unchanged (qa.js:26 reads only
`ctx.THREE`, `ctx.build`, `ctx.qa`, `ctx.runtime` at construction and is
safe on a lean ctx), then `installSummitQa(ctx, api, hook)` bolts on:

```
summit: {
  stations(),                       // the table, with live pad centres
  stationPose(id),                  // camera station -> lookAt args
  snowDepthAt(x, z),
  slopeAt(x, z),                    // degrees
  padFlatness(id),                  // {min,max,spread} over the pad disc
  viaSacraGrade(samples = 600),     // {max, mean, histogram}
  reachability(id),                 // walk-solver march from the basecamp
  crevasseProbe(x, z),              // {open, floorY, lipY, width}
  weatherState(),                   // mote counts, drift speed, anchor delta
  listTimes(),                      // SUMMIT_TIMES keys (qa.js:152 lists art.js's)
}
```
Every one of these is a **method**, not construction work, so a broken
probe cannot stop the level from booting.

#### `summit-main.js`
The entry point. `export async function start({ boot, build } = {})`,
returning the `api` object. Full contract in §2.

#### Harnesses (new files under `scripts/`)
`saintfall-white-vigil-review.mjs` (the station contact sheet),
`saintfall-summit-traversal.mjs` (grade / reachability / pad-flatness
assertions), `saintfall-summit-weather.mjs` (the mote-drift regression),
`saintfall-summit-post.mjs` (the white-scene post-chain measurements).
House pattern in §6.

### 1.2 Existing files that may be edited — **four, and no more**

| file | edit | risk to Vesper |
|---|---|---|
| `assets/js/saintfall/boot.js` | **done.** Nine names in `MODULES`; `entryModule()` allowlist; entry import interpolation; `BUILD` bumped. | None. Absent `data-sf-entry` the function returns `"main"` (boot.js:128), so saintfall.html is byte-for-byte unaffected in behaviour. |
| `games/saintfall.html` | **done.** Three `?v=` tags bumped. | None. Cache tag only. |
| `scripts/saintfall-shots.mjs` | **done.** `--page` flag, default `saintfall.html`. | None. Default preserves the old URL exactly. |
| `assets/js/saintfall/vfx.js` | **TO DO — two lines.** Guard the Vesper clerestory block. | None: Vesper always satisfies the guard. |

The vfx.js edit, and its justification. `buildVfx` runs this
unconditionally at vfx.js:1212-1213:

```js
const cath = ctx.districts.cathedral;
const plazaY = terrain.field.cathedralPlazaY;
```

then builds ten clerestory shafts plus a rose shaft from them. A summit
`ctx` whose station table has no `cathedral` key throws inside
`buildVfx` before a single particle exists; one whose field lacks
`cathedralPlazaY` produces NaN shaft geometry. The fix is a guard, not a
parameterisation:

```js
const cath = ctx.districts?.cathedral;
const plazaY = terrain.field?.cathedralPlazaY;
if (cath && Number.isFinite(plazaY)) {
  /* …the existing ten clerestory shafts and the rose shaft, unchanged… */
}
```

The **alternative was rejected**: making `summit-terrain` export a
`cathedralPlazaY = 452` and `STATIONS.cathedral`. That would build ten
shafts authored to a 132 m Vesper nave inside a sealed 54 m chapel, and
it would couple the summit's naming table to a Vesper mesh's dimensions
forever. The summit publishes its own light shafts the supported way —
`world.emitters` entries with `kind: "shaft"`, which `buildVfx` already
diverts into `buildShafts` (vfx.js:1174, and `buildShafts` returns null
on an empty list at vfx.js:734).

### 1.3 Existing files reused **unchanged** (and therefore untouchable)

`render.js`, `player.js`, `collide.js`, `art.js`, `core.js`,
`structures.js`, `sky.js` (imported for `mergeGeometries` only),
`boss-surface.js`, `ui.js`, `touch.js`, `difficulty.js`, `qa.js`,
`assets/css/saintfall.css`, `assets/css/saintfall-ui.css`.

If a summit requirement appears to need one of these changed, the
requirement is wrong until proven otherwise in a written note appended
to this document. Two temptations in particular:

- **render.js has no setter for the bloom threshold or the contact
  lit-knee.** Do not add one. `render.uniforms` is the documented escape
  hatch (render.js:2027) and reaches both: `render.uniforms.uThreshold.value`
  (render.js:1318) and `render.uniforms.uContactGain.value.y` (render.js:1405).
- **art.js's `TIMES` / `GRADES` are plain mutable objects.** Do not add
  alpine keys to them at runtime either. `DAY_CYCLE_STOPS` is frozen
  (art.js:414) and the storm blend target is a hard reference
  (art.js:746), so a summit key added to art.js's table would still
  interpolate through Vesper's four stops and toward Vesper's storm.
  `summit-art.js` owns its own tables.

---

## 2. THE `ctx` CONTRACT

`summit-main.js` builds one shared `ctx` object exactly the way
`main.js:106-118` does, and hands it to every builder. The ordering is
not stylistic — six dependencies are hard (dereferenced without a
guard) and the build throws if they are late.

### 2.1 Construction order

```js
export async function start({ boot, build } = {}) {
  const params      = new URLSearchParams(location.search);
  const qa          = params.has("qa") || params.get("qa") === "1";
  const seed        = Number(params.get("seed")) || 0x5e17fa11;
  const timeKey     = params.get("time") || "alpenglow";
  const qualityParam= params.get("quality") || null;

  const canvas    = document.getElementById("sf-canvas");
  const hudHost   = document.getElementById("sf-hud");
  const touchHost = document.getElementById("sf-touch");
  const stage     = document.querySelector(".sf-stage");

  // 1. ATMOSPHERE FIRST. Materials, sky, terrain paint, vfx and the
  //    player's own figure all need it, and player.js dereferences
  //    ctx.atmos.duskFactor WITHOUT a guard (player.js:3737-3738).
  const atmos = makeSummitAtmosphere(THREE, timeKey, { cycle: false });

  // 2. THE LITERAL. Mirrors main.js:106-118 minus the mission world.
  const ctx = {
    THREE, seed, build, atmos,
    districts: STATIONS,          // the naming table; summit-hud + vfx read it
    qa,
    runtime: { phase: "playing", paused: false, handoffFrames: 0 },
  };

  // 3. RENDERER. Reads only ctx.THREE (render.js:1165) and ctx.qa
  //    (render.js:1503, 1678, 1847). Owns its own scene + camera.
  const render = createRenderer(ctx, canvas);
  ctx.render = render;            // main.js NEVER sets this; see 2.5
  ctx.scene  = render.scene;
  ctx.camera = render.camera;

  // 4. MATERIALS, then the grade. applyAtmosphere must run before the
  //    first frame or every uniform is at its desert default.
  ctx.materials = makeSummitMaterials(THREE, atmos);
  render.applyAtmosphere(atmos);
  applySummitPostChain(render);   // §5. MUST run after applyAtmosphere.

  // 5. SKY. Needs THREE, scene, atmos. Adds the only two lights.
  ctx.sky = buildSummitSky(ctx);
  render.refreshEnvironment(atmos);

  // 6. FIELD, then TERRAIN. Two steps, exactly as main.js:153-155:
  //    the field is a pure sampler, the terrain is the mesh over it.
  ctx.field   = makeSummitField(seed);
  ctx.terrain = await buildSummitTerrain(ctx, (v) => boot.progress(0.30 + v * 0.30, "Raising Kenosis"));

  // 7. WORLD. Destructures THREE/scene/terrain/atmos; reads materials.
  ctx.world = await buildSummitWorld(ctx, (v, label) => boot.progress(0.60 + v * 0.26, label));

  // 8. THE CREVASSE / MOULIN FLOOR OVERRIDE. collide.js reads this key
  //    by name and it is the ONLY way to lower the floor (collide.js:202).
  ctx.undercroft = ctx.terrain.groundOverride;   // { groundOverrideAt(x,z) }

  // 9. COLLISION. Bakes ONCE. Nothing added to world.group afterwards
  //    has any collision at all.
  ctx.collide = buildCollision(ctx, ctx.world);

  // 10. VFX, then WEATHER.
  ctx.vfx     = buildVfx(ctx, ctx.world);
  ctx.weather = buildSummitWeather(ctx, ctx.world);

  // 11. PLAYER. Async (the trooper GLB loads). Its constructor calls
  //     spawn() once at the Vesper default (-12, 900) — player.js:3334 —
  //     so the real spawn must follow immediately.
  ctx.player = await createPlayer(ctx, canvas);
  ctx.player.spawn(BASECAMP.x, BASECAMP.z, BASECAMP.yaw);

  // 12. SHELL. HUD, touch, then the field menu with a mission stub.
  ctx.hud    = buildSummitHud(ctx, hudHost);
  ctx.touch  = buildTouchControls(ctx, ctx.player, touchHost, stage);
  ctx.mission = makeVigilStub();                 // §2.4 — the one stub
  ctx.gameUi = buildGameUi(ctx, { stage, canvas, save: undefined, touch: ctx.touch, render, setQuality });

  // 13. api, setQuality, then QA.
  const api = { /* §2.3 */ };
  setQuality(qualityParam || readStoredSettings().quality || "high");
  const hook = installQa(ctx, api);
  installSummitQa(ctx, api, hook);

  // 14. WARM, then reveal. Same discipline as main.js:1139-1194.
  await render.warmShaders(render.camera, render.scene);
  for (let i = 0; i < 4; i += 1) frame(1 / 60, true);
  await boot.hide();
  api.ready = true;
  requestAnimationFrame(loop);
  return api;
}
```

Four ordering facts, each with its evidence:

- **`atmos` before anything.** `player.js:3737-3738` reads
  `ctx.atmos.duskFactor` and `ctx.atmos.nightFactor` with a bare
  dereference inside `update()` — the only non-optional gameplay
  dependency in the whole controller. Every patched material also
  `Object.assign`s `atmos.uniforms` at compile (art.js:1332-1335).
- **`terrain` before `collide`.** `collide.js:187` does
  `const terrain = ctx.terrain;` and dereferences it at
  `collide.js:205-206` and `:897`. `buildCollision` throws immediately
  if it is unset.
- **`world` before `collide`.** `collide.js:526` does
  `world.group.traverse(collect)`. The raster is baked once, and
  `mesh.updateWorldMatrix(true, false)` at collide.js:279 exists because
  nested live objects still hold identity matrices at build time.
- **`ctx.undercroft` before `collide`** — strictly, before the first
  `groundHeight` call. `collide.js:202` optional-chains it, so a late
  assignment is silent rather than fatal, which is worse.

### 2.2 System-by-system: omitted / stubbed / reused

**Omitted outright** — no stub, no key on `ctx`, and the evidence that
the omission is safe:

| system | why it is safe to omit | evidence |
|---|---|---|
| `enemies` | never referenced in player.js or collide.js; `summit-hud` deletes the one hard read | grep across player.js/collide.js returns nothing; hud.js:815 is the only hard consumer and is forked out |
| `combat` | guarded at every site | player.js:3104 `if (ctx.combat && ctx.combat.meleeStrike)`; player.js:3839, 4633 `ctx.combat?.player?.dead`. Melee swings play, they just deal no damage |
| `weapons` | every site is `?.` or `&&`-guarded; `postUpdate` takes the no-weapon branch | player.js:2981, 3441, 3450, 3452, 3848, 3975, 5838, 5853, 6020; rest-arm solve at player.js:5847-5851 |
| `jetpack` | all sites `?.` or inside `if (flightMode)`, and `flightMode = !!jetState?.inFlight` | player.js:3316, 3354, 3371, 3501, 3523, 3715, 3866, 3932-3933, 4323, 4431, 4574, 4697. The plain 6.4 m/s jump at player.js:4318-4321 is unaffected |
| `boost`, `shield`, `slam` | all optional-chained or mode-gated | boost player.js:3317/3372/3714/3717/4297/4871/5109/5261; shield 3318/3700/3864 (3864 needs `shieldMode`); slam 3355/3411/3705, 4576/4606 gated by `slamMode` |
| `progression`, `breaches`, `districtBosses`, every boss module | zero references outside main.js's own wiring | grep; the seven boss modules are imported only by main.js |
| `save.js` | `ui.js` optional-chains **every** `save.*` call — ui.js:1551, 1553, 1755, 1815, 1869, 1877, 1881, 2035, 2037, 2052, 2093, 2644, 2691, 2742. Pass `save: undefined` | Also: `save.js:21 GAME_ID = "saintfall"` would clobber Vesper's field slots |
| `intro.js`, `pod.js`, `intro-models.js` | there is no drop cinematic; `runtime.phase` starts at `"playing"` | player.js:4632 `ctx.intro?.`; collide.js:531 `ctx.pod?.root` |
| `tutorial.js` | returns a stub when the host is absent; the summit page ships `#sf-tutorial` but summit-main passes `enabled: false` | tutorial.js:116-126 |
| `audio.js` | `ctx.audio?.chord?.()` inside a `try` | player.js:3275. Wire it later if wanted; nothing depends on it |
| `mission.js` (the real one) | replaced by a stub — see 2.4 | |

**Reused unchanged, wired normally:** `render`, `sky` (our fork, same
shape), `player`, `collide`, `vfx`, `touch`, `difficulty` (build it: it
is pure data, `difficulty.js:154`, and `ui.js` shows a tier selector),
`gameUi`, `qa`.

**Stubbed — exactly one.** See 2.4.

### 2.3 The `api` object handed to `installQa`

`installQa(ctx, api)` will not throw on a lean api — every boss/mission
hook is an opt-in method body (qa.js). But six screenshot hooks are
**not** optional-chained and must be satisfied:

```js
const api = {
  ready: false,
  render, sky: ctx.sky, terrain: ctx.terrain, world: ctx.world,
  vfx: ctx.vfx, weather: ctx.weather, player: ctx.player,
  collide: ctx.collide, hud: ctx.hud, touch: ctx.touch,
  gameUi: ctx.gameUi, runtime: ctx.runtime,
  fps: 0, frameMs: 0,
  resize, step, frameOnce: frame,
  setTime, setDayCycle, setStorm, setQuality,
};
```
- `api.hud` must be non-null: `qa.js:89 hideHud(hidden) { api.hud.setVisible(!hidden); }` has no guard. `summit-hud` always returns a real object, so this is satisfied; if the HUD is ever made optional, pass `{ setVisible(){} }`.
- `api.step(dt, draw = true)` must clamp `dt` itself (`Math.min(dt, 0.1)`, main.js:1007) **and** accept `dt === 0` — `qa.js:107 renderStill()` calls `api.step(0, true)`.
- `api.setTime` / `setQuality` / `setStorm` are called unguarded by qa.js:137, 153, 154.
- `api.render.captureDataURL()` works for free because `render.js:1186` sets `preserveDrawingBuffer: true`.
- There is no `freeCamera` hook anywhere in the repo. The pair is `lookAt(pos, target, fov)` (qa.js:173) / `releaseCamera()` (qa.js:178), both routed through `player.setFree` (player.js:6396).

### 2.4 The one stub: `ctx.mission`

`ui.js:164` gates the entire field interface on
`if (!stage || !canvas || !ctx?.mission)` and returns a no-op object.
Without a mission there is **no Esc/Tab menu, no settings panel, no
quality-tier switch, no M map and no audio toggle** — and main.js's own
fallback `gameUi.settingsState?.().qualityStored` (main.js:969) goes
undefined, so the player's stored quality preference is silently
ignored. That is not acceptable for a shipped level, so summit supplies
a stub. It is *inert*, not a fake mission:

```js
function makeVigilStub() {
  return {
    wheelOrder: [],                 // ui.js:186 — non-optional
    stratagems: {},                 // ui.js:139, 1257, 1272, 2719
    cooldowns: {},                  // ui.js:1253, 2720
    bosses: [],                     // ui.js:1452, 1535 — `|| 7` fallback, so [] shows 0/0
    state: { phase: "vigil", bossesDone: 0, deaths: 0, elapsed: 0 },   // ui.js:1449, 1507
    objective: () => ({ title: "THE ASCENT", detail: "Reach the Cathedral of the Ninth Ascent." }),
    call: () => false,              // ui.js:1405
    bus: { on: () => () => {} },    // ui.js:2637, 2640 — must return an unsubscribe fn
    snapshot: () => null,
    restore: () => true,
  };
}
```
The command wheel renders empty and `wheelOrder: []` makes it
unopenable. `refreshOperation` (ui.js:1505+) does non-optional
`root.querySelector("[data-operation-objective]")` reads, but those
nodes are in ui.js's own generated markup, so they always exist.

### 2.5 `ctx.render` — set it

`ctx.render` is **never assigned anywhere in the repository**, yet
`hud.js:1671` reads `ctx.render?.renderer?.domElement` for the reticle
projection (falling back to a hardcoded 720 px height) and
`undercroft.js:2563` calls `ctx.render?.requestShadowUpdate?.()`, which
is therefore a permanent no-op in the shipped game. `summit-main.js`
sets it immediately after `createRenderer`. This is a summit-side fix
only; do **not** "fix" main.js as part of this work.

### 2.6 The frame loop

Copy main.js's shape, minus the mission half of `stepGame`:

```js
function step(d0, draw = true) {
  const d = Math.min(d0, 0.1);
  ctx.player.update(d, render.camera);
  const changed = ctx.sky.update(d, render.camera);
  if (changed) { render.applyAtmosphere(atmos); render.syncEnvironment(atmos); applySummitPostChain(render); }
  ctx.terrain.updateLod(render.camera);
  ctx.player.postUpdate(d);
  ctx.vfx.update(d, render.camera);
  ctx.weather.update(d, render.camera);
  ctx.touch.update(d);
  ctx.hud.update(d, ctx.player, render.camera);
  ctx.gameUi.update?.(d);
  if (draw) render.render(render.camera);
}
```
Three details that are easy to lose and expensive to rediscover:
- `applySummitPostChain` must re-run after every `applyAtmosphere`, because `applyAtmosphere` overwrites `uExposure` and the whole grade block (render.js:1601-1639) but never touches `uThreshold`, `uAo.z`, `uContactGain.y`, `uVignette` or `uHaloAmount`.
- `terrain.updateLod(camera)` must run at least once before the first draw. Every LOD mesh is built `visible = false` and `chunk.active` starts at `-1` (terrain.js:1384, 1393) — a harness that photographs a frame before the first step captures an empty sky and reports a build failure.
- `render.tickAutoScale(rawMs)` takes the **raw** rAF spacing, not the clamped dt, and is skipped while `document.hidden` (main.js:1054-1062). Copy that or the dynamic-resolution controller reads a backgrounded tab as a 1 fps machine.

Pause plumbing: copy `syncRuntimePaused` (main.js:378) verbatim, including
its three reasons (`rb-escape-menu-open`, `document.hidden`,
`sf-command-open`) and the `MutationObserver` on `document.body`. Note its
early-out — `if (ctx.runtime.phase !== "playing") return` (main.js:382) —
which is exactly why summit starts at `"playing"` and never leaves it.

---

## 3. TERRAIN CONTRACT — `summit-terrain.js`

Modelled on `terrain.js` (1684 lines), which is two decoupled things: a
pure sampler factory (`makeHeightField`, terrain.js:404) and an async
mesh builder (`buildTerrain`, terrain.js:1019). Keep them decoupled —
`summit-main` builds the field, hangs it on `ctx.field`, then calls the
mesh builder, which does `const field = ctx.field || makeSummitField(ctx.seed)`.

### 3.1 Exports — names are not negotiable

Consumers reach these **by exact name**. The right-hand column is who
reads it and dies without it.

| export | consumer |
|---|---|
| `MAP_SIZE = 2048`, `MAP_HALF = 1024` | `summit-hud` (raster grid, projection, range). **See the hard constraint below.** |
| `CHUNKS = 8`, `CHUNK_SIZE = 256`, `LOD_CELLS = [64,32,16,8]`, `LOD_RANGES = [430,780,1350,Infinity]` | `summit-world` (prop scatter chunking), `summit-hud` |
| `STATIONS` — `{ id: { x, z, r, name } }`, nine entries | `ctx.districts`; `summit-hud` colour table and labels; `summit-world` naming |
| `BASECAMP` — `{ x, z, yaw }` | `summit-main`'s `player.spawn` |
| `VIA_SACRA_PATH` — `[[x,z], …]` | `summit-hud`'s `drawPath` |
| `viaSacraPointAt(t)` -> `{ x, z, y, yaw }` | respawn / QA station derivation. **Parameterised by arc length, not northing** — `roadPointAtZ` (terrain.js:280) assumes monotonic z, and a 2.35-turn spiral is not |
| `makeSummitField(seed)` | `summit-main`, and the mesh builder's own fallback |
| `buildSummitTerrain(ctx, onProgress)` | `summit-main` |

The returned **terrain object** must carry, verbatim by name
(terrain.js:1648-1683 is the template):

```
{ group, chunks, groundSampleStep, field, rng, coarseHeight, occlusionAt,
  heightAt, groundHeightAt, normalAt, surfaceAt, snowDepthAt,
  groundOverride: { groundOverrideAt(x, z) },
  updateLod(camera), stats() }
```

Who reads which, with the line:
- `groundHeightAt` — `collide.js:204` (preferred over `heightAt`), `vfx.js:1071` (decal corners).
- `heightAt` — `collide.js:206` (fallback), `player.js:3137` (fallback when `ctx.collide` is absent), **`vfx.js:5523` (footprint puff height, called directly, not through collide)**. Export both or footprint puffs land at the wrong altitude.
- `groundSampleStep` — `collide.js:897`, guarded by `Number.isFinite` at :898, so a missing value degrades *silently*: `flightGroundHeight` stops catching interior grid maxima under the capsule footprint.
- `chunks[].active` / `chunks[].lods[]` — `qa.js:211, 251` build raycast targets from `c.lods[c.active]` where `c.active >= 0`.
- `stats()` -> `{ chunks, visible, triangles }` — `qa.js:1496`.
- `group.visible` — `qa.js:2730, 2759` isolation shots.
- `field.heightAt` — `summit-hud`'s hillshade (hud.js:507 in the fork).

**Hard constraint: `MAP_SIZE` stays 2048.** `collide.js:28` hardcodes
`const HALF = 1024;` rather than importing `MAP_HALF`, computes
`Math.ceil((HALF*2)/CELL)` for its paged ground cache (collide.js:225-236),
tests `Math.abs(x) <= 1010` in `findPath` (collide.js:743), and
`REACH = 1030` bounds the raster (collide.js:38). `player.js` clamps to
±1010 in three places (4120-4121, 4201-4202, 6339-6340). A larger map
needs edits in both files and regresses Vesper. The layout is authored
to 2048; keep it there.

### 3.2 `heightAt(x, z)` — semantics and order

The signature is `heightAt(x, z) -> number` (metres, y = 0 at the
ring-valley floor) and it must be **total**: defined everywhere,
including outside ±1024, and never NaN. Vesper achieves that by having
`rimHeight` saturate outside the map (terrain.js:477). Kenosis has **no
rim** — the layout says the edge falls away into cloud — so the
saturating term is instead a *floor*: beyond r = 1024 the profile
continues its outward decay and is clamped at the valley floor minus a
few metres. A stray probe at (4000, 4000) must return a finite number.

Evaluation order, and it is load-bearing exactly as terrain.js:29-35
and :894-905 record:

```
1. radial = profile(r)              // the authored elevation table, §1 of the layout,
                                    // smootherstep-blended between rows
2. h = radial + ridgeNoise(x, z, r) // ANISOTROPIC: spurs and gullies run downhill.
                                    // Isotropic fBm on a cone reads as a crumpled bag.
3. h += buttressSpurs(x, z)         // eight, at the arena bearings
4. for each station in a fixed order:
     k = w(x, z, station, softness)          // terrain.js:625
     if (k > 0.001) h = padBlend(h, station, k)   // flat to +/-0.35 m, 40 m feather
5. h = viaSacraCut(h, x, z)         // LAST but one — see below
6. h = crevasseSlots(h, x, z)       // LAST. Pure subtraction, like terrain.js:906's crater
```

The two helpers are copied verbatim from terrain.js:625-628:

```js
const w = (x, z, d, softness = 0.42) =>
  1 - sstep(1 - softness, 1.0, Math.hypot(x - d.x, z - d.z) / d.r);
const pad = (h, target, x, z, cx, cz, r, feather) =>
  lerp(h, target, 1 - sstep(r, r + feather, Math.hypot(x - cx, z - cz)));
```

Every station block is guarded `if (k > 0.001)` so an out-of-station
sample costs one `hypot` and a compare. That guard is what keeps
1.35 M `heightAt` evaluations affordable at build time.

**The Via Sacra cut, and the trap it must avoid.**
`buildPathProfile(path, samples, smoothPasses)` (terrain.js:493-514)
resamples the polyline uniformly in `t`, sets each `p.y` from the
**raw** ground — `baseHeight + rimHeight`, *before any station
shaping* — then runs a `[1,2,1]/4` binomial smooth with endpoints
pinned. Use it unchanged, at 6 m sampling (the layout's number, ≈ 620
samples) with ~26 smoothing passes.

That "raw ground only" detail is precisely why Vesper's road cut has to
be faded out over the Cathedral mesa: `const mesaExit = sstep(205, 330,
cathedralDist); const roadCut = Math.pow(bed, 0.55) * mesaExit;`
(terrain.js:888-889). The note at terrain.js:881-886 records the
un-faded version carving a 48-60 m trench straight through the level
plaza. **A spiral road climbing a 452 m cone will do exactly this, at
ten times the scale, at every station pad it passes and at the parvis.**
Two acceptable answers, and you must pick one and write it down:
- **(a) fold the cone into the profile source** — make `buildPathProfile`
  sample `radial + ridgeNoise` rather than a `baseHeight` that excludes
  the mountain. This is the recommended route: the road then *knows*
  about the mountain and rides it.
- **(b) a `padExit` fade per station**, `sstep(padR * 1.2, padR * 2.1, dist)`,
  multiplied into the cut. Required in addition to (a) at the parvis,
  where the last switchback meets a 78 m flat disc.

The cut profile itself, adapted from terrain.js:866-892 to the layout's
11 m carriageway:

```js
const bed   = 1 - sstep(5.5, 22.0, r.d);   // level to 5.5 m, graded shoulder to 22 m
const ditch = Math.exp(-((r.d - 26.0) ** 2) / (2 * 4.2 * 4.2)) * -1.1;
const cut   = Math.pow(bed, 0.55) * padExit;
h = lerp(h, r.y + 1.05, cut) + ditch * (1 - bed) * padExit;
```
The shoulder width is not decoration. terrain.js:875-878 records that at
3.5 m the cut met a 22 m dune with a vertical wall and read as a canyon.

**Grade ceiling.** A smoothstep of depth D across span S peaks at
`1.5 D / S` (terrain.js:165-171). `player.js:2392 WALK_SLOPE_LIMIT = 1.7`
is measured as `rise / WALK_SLOPE_LOOK` over 1.6 m, with
`WALK_MAX_STEP_UP = 1.05` over 0.45 m (player.js:3181-3193). The layout's
13% grade ceiling is a factor of 13 inside that, which is deliberate: it
leaves the whole margin for ridge noise, hairpin aprons and drift. Two
adjacent switchback legs must be **≥ 2× the shoulder width apart**
(≥ 44 m centre to centre) or their cuts merge into one slab and the
hairpin disappears.

**Crevasses.** They are slots in `heightAt`, not decals and not
`walkSurfaceAt` (which can only *raise* the floor — `Math.max` at
collide.js:208). Two hard rules:
- **Minimum top width ≈ 12 m.** `groundHeightAt` reproduces the drawn
  LOD0 triangulation from the retained 65×65 sample plane (terrain.js:1616-1646)
  at a 4 m cell. A slot narrower than the cell is not drawn and therefore
  not collidable, while the analytic `heightAt` insists it is there —
  and `vfx.footprint` reads `heightAt` directly (vfx.js:5523), so prints
  drop into a hole that does not exist. terrain.js:1613-1615 records the
  same split at Vesper's narrow Fosse.
- **Walls steeper than `WALK_SLOPE_LIMIT`** so a crevasse is a hazard
  rather than a ramp, and the floor is far enough down that the fall
  reads.
- A crevasse with an **overhanging lip or a snow bridge over it** is not
  a height-field feature. That needs `groundOverrideAt` (below) for the
  gap plus authored geometry with `walkSurfaceAt` for the bridge.

**The floor-lowering hook.** `collide.js:192-209`:

```js
function groundHeight(x, z) {
  const underY = ctx.undercroft?.groundOverrideAt?.(x, z);
  if (underY !== null && underY !== undefined) return underY;
  const terrainY = terrain.groundHeightAt ? terrain.groundHeightAt(x, z) : terrain.heightAt(x, z);
  const authoredY = world.walkSurfaceAt ? world.walkSurfaceAt(x, z) : -Infinity;
  return Math.max(terrainY, authoredY);
}
```
It is an **override, not a max**, it answers first, and it answers for a
whole **column** — every altitude at that x/z. `summit-terrain` exports
`groundOverride.groundOverrideAt` and `summit-main` hangs it on the
hard-named `ctx.undercroft` key (§2.1 step 8). Use it for the three
moulins and any cathedral undercroft; do **not** use it for open
crevasses, which are height-field slots.

### 3.3 `normalAt` and `surfaceAt`

`normalAt(x, z, out)` — analytic central difference, `EPS = 1.6`
(terrain.js:925-933):
```js
const nx = heightAt(x - EPS, z) - heightAt(x + EPS, z);
const nz = heightAt(x, z - EPS) - heightAt(x, z + EPS);
const ny = 2 * EPS;   // then normalise into `out` if given
```
Four full `heightAt` evaluations per call. This is why two LODs of the
same ground light identically and an LOD swap does not flash
(terrain.js:21-24). Do not substitute a mesh-derived normal.

`surfaceAt(x, z, slopeHint)` returns a fresh object literal. The
**material keys are ours to name**; the two fields that are not are
`district` and `districtWeight`, because they carry the station naming
and the tint lookup:

```js
{ snow: 1, slab: 0, blueIce: 0, blackIce: 0, rock: 0, rime: 0, scree: 0,
  district: null, districtWeight: 0 }
```
Semantics copied from terrain.js:947-982:
- **Two independent radial fields per station.** (a) naming proximity,
  `near = 1 - sstep(d.r * 0.55, d.r * 1.05, dist)`, max wins, becomes
  `district` / `districtWeight`. (b) ground material, from a separate
  `SURFACE_ZONES` table keyed by station with `{ key, in, out, w }` —
  the Tarn's black ice and the Tongue's blue ice have nothing to do
  with where the label appears.
- Then the physical modifiers, which on a mountain do most of the work:
  slope → `rock` above ~38°, aspect + wind → `rime` on the windward
  side, altitude → `slab` on exposed ground above the inversion,
  curvature → `snow` in gullies.
- Finally the residual: `out.snow = clamp01(1 - clamp01(slab + blueIce + blackIce + rock + rime + scree))`.
- `slopeHint` is an optional `[nx, ny, nz]` and only `[1]` is read
  (terrain.js:975). Passing it saves four `heightAt` calls per vertex —
  the chunk sampler must pass it.

### 3.4 `snowDepthAt(x, z)` — the fourth field, one reader each

The layout defines snow depth as a real scalar field. It has four
consumers and they must all read **this** function; if any of them
computes its own, they drift and the level looks like snow painted on:

```
depth = base(altitude) * slopeFalloff(slope) * aspectBias(normal, WIND) * curvatureBias(k) + drift(x, z)
```
1. `summit-terrain`'s own `colourAt` — the deep-snow ↔ wind-slab blend.
2. `summit-world`'s prop bedding — `snowCap` and the bed-in depth.
3. `summit-weather` — spindrift density is proportional to available loose snow.
4. Player feel (deep-snow slowdown / knee line), if and when it is
   wired. **Note it cannot be wired without touching `player.js`**, which
   this contract forbids; the supported route is `ctx.player.applySlow`
   driven from `summit-main`'s `step`, sampling `snowDepthAt` at the
   trooper's feet. That is a summit-side call into an existing public
   method (player.js API, `applySlow`/`clearSlow`), not an engine edit.

### 3.5 Mesh build recipe — distilled from `terrain.js:1019-1413`

```
buildSummitTerrain(ctx, onProgress):
  const { THREE, scene, materials } = ctx;
  group = new THREE.Group(); group.name = "terrain"; scene.add(group);
  material = materials.snow;              // ONE material for all 256 meshes
```

1. **Coarse grid** (terrain.js:1037-1062). `COARSE = 8`, `cDim = 2048/8 + 1 = 257`,
   a `Float32Array(257*257)` = 66 049 `heightAt` calls, 264 KB.
   `coarseHeight(x, z)` is a clamped bilinear read.
2. **Occlusion** (terrain.js:1077-1096). 28 directions from four rings
   `[[4,6],[11,6],[26,8],[54,8]]` stored `[dx, dz, radius]`, each ring's
   angle offset by `radius * 0.37` to decorrelate. Weight `1/(1 + r*0.10)`,
   scale `*0.34`, and the result is **squared** so only genuine pits
   darken. Keep the radii short: terrain.js:1070-1076 records that a 190 m
   ring painted a hundred-metre unexplained blob. On a cone this matters
   more, not less — a long ring reads the mountain itself as occlusion.
3. **Chunk sampling** (terrain.js:1252-1275). `FINE = LOD_CELLS[0] = 64`,
   `FINE_SIDE = 65`, `step = CHUNK_SIZE / FINE = 4 m`. `sampleChunk(cx, cz)`
   fills three `Float32Array`s — `ys` (65×65), `ns` (×3), `cs` (×3) — and
   returns `{ ys, ns, cs, ox, oz, step }`. Per sample: one `heightAt`, one
   `normalAt` (four more), one `colourAt`. Colours are written through
   `srgbTransfer` (art.js:963) on the way into the buffer (terrain.js:1271).
4. **LOD decimation** (terrain.js:1279-1303). `geometryFromSamples(s, lod)`
   uses `stride = FINE / LOD_CELLS[lod]` (1, 2, 4, 8) and reads
   `src = (j*stride)*FINE_SIDE + i*stride`. **Every LOD is a stride of the
   one sample grid** — a chunk is sampled once and decimated four times, so
   shared samples agree exactly. This requires `FINE % cells === 0` for
   every LOD entry; a non-divisor set produces fractional strides and
   silently corrupted reads, not an error.
5. **Triangulation.** Alternate the quad diagonal by `((i + j) & 1)`
   (terrain.js:1314-1315) to avoid a herringbone at grazing sun — which on
   a level whose whole texture story is grazing light is not optional.
   `groundHeightAt` must reproduce this branch exactly (terrain.js:1638-1645).
6. **Skirts.** `SKIRT = 11`. There is no LOD stitching: each geometry
   appends `4 × side` duplicated edge vertices dropped 11 m in y, keeping
   the source normal and darkening the colour by `[0.80, 0.78, 0.84]`
   (terrain.js:1341-1343). Skirt quads are emitted with **both windings**
   (terrain.js:1354-1355) — cheaper than deriving the correct orientation
   for four traversal directions. 11 m covers a 32 m LOD3 cell against the
   fine field; on 40%+ summit grades **re-measure it**, because the worst
   case is a function of local slope and Vesper's steepest ground is a dune.
7. **Attributes** (terrain.js:1359-1366): `position`, `normal`, `color`,
   all `BufferAttribute(Float32Array, 3)`, plus an index — `Uint32Array`
   past 65 535 verts, else `Uint16Array`. **No UVs.** Then
   `computeBoundingSphere()`.
8. **Scene assembly** (terrain.js:1375-1413). For each of 8×8 chunks build
   all four LODs, `group.add` each, name `terrain-${cx}-${cz}-l${lod}`,
   `castShadow = lod <= 1`, `receiveShadow = true`, `visible = false`,
   `matrixAutoUpdate = false` + one `updateMatrix()`. Chunk record:
   `{ cx, cz, lods, active: -1, centreX, centreZ, centreY: samples.ys[(FINE_SIDE*FINE_SIDE)>>1], heightSamples: samples.ys }`.
   The 65×65 plane is retained (~17 KB/chunk, 1.08 MB total) because
   gameplay must stand on the drawn triangles, not the analytic field.
9. **`updateLod(camera)`** (terrain.js:1593-1607). 3D distance from
   `camera.position` to `(centreX, centreY, centreZ)`; first `LOD_RANGES[i]`
   the distance is under wins; on change hide the old mesh and show the new.
   **On a mountain the `centreY` term does real work** — a chunk 400 m below
   the camera is far even when it is near in plan. Keep the distance 3D.
10. **Yield cadence — do not "improve" it.** `if (onProgress && (j & 63) === 0)`
    in the coarse pass (terrain.js:1045) and `if (done % 4 === 0)` in the
    chunk pass (terrain.js:1410): ~21 yields total. terrain.js:1405-1409
    records that yielding per chunk turned a 2.7 s load into seventy-odd
    seconds, because a hidden tab throttles `setTimeout` to 1 s.

**Vertex colour**, `colourAt(x, z, y, normal) -> [r, g, b]` in sRGB
(terrain.js:1101-1243), same seven steps: surface weights → tonal
position `local = (y - coarseHeight)*0.06 + (y - baseHeight)*0.012` →
`crest` → weighted ramp blend over the surface keys → station tint →
occlusion → scour. Two summit-specific changes:
- `SHADOW_TINT` is `[0.30, 0.16, 0.26]` in Vesper — a violet, because
  multiplying to grey makes baked AO look dirty (terrain.js:1158-1159).
  Kenosis wants **saturated blue**, not grey and not violet: roughly
  `[0.34, 0.44, 0.72]`, and the additive terms (`+0.055 / +0.030 / +0.062`)
  must be re-weighted to keep the blue channel highest.
- The crest-scour step (terrain.js:1188-1194) is what gives the dune
  field its drawn quality at distance. Its analogue here is **sastrugi
  scour on wind slab**, keyed off `surf.slab` rather than `surf.sand`,
  aligned to the wind axis, and it is the single cheapest thing that
  makes the snowfield read as carved rather than smooth.

### 3.6 Animated terrain

Not required for the environment build. If an animated feature is ever
added (a collapsing serac, a snow bridge that fails), the five rules
from `pitPatch` (terrain.js:1442-1589) are mandatory and cheap to get
wrong: displacement is a pure function of position × **one** scalar;
both ends are precomputed at load and the *closed* end is read back out
of the LOD0 buffers rather than recomputed; `targetsFor` must include
the **skirt duplicates** (`base = side*side`, terrain.js:1463-1466) or an
11 m apron hangs at pan height along every chunk seam; bounding spheres
are grown **once** at patch construction (terrain.js:1510) or the chunk
is frustum-culled while the player stands in the hole; and `occlusionAt`
reads a coarse grid baked **before** the mutation, so inside a new hole
every AO sample saturates and `o*o` returns 1 — it must be faded out and
replaced with hand-written radial shading (terrain.js:1160-1176, 1203-1240).

---

## 4. ART CONTRACT — `summit-art.js`

### 4.1 The atmosphere object

`makeSummitAtmosphere` must return an object carrying **every** field
art.js's does (art.js:660-708, methods attached 949-957), because
`render.applyAtmosphere`, `render.syncEnvironment`, `summit-sky`,
`buildSkyEnvironment`, `vfx.js` and every patched material read it:

```
THREE, time, preset, storm, windDir:Vector2, windSpeed, elapsed,
cyclePhase, cycleDuration, cycleRunning, cycleCount, cycleFrom, cycleTo,
cycleBlend, solarHour, daylightFactor, goldenFactor, duskFactor,
nightFactor, sunDir:Vector3 (points TOWARD the sun), sunColor:Color,
sunIntensity, skyZenith, skyHigh, skyHorizon, skyLow, sunHalo,
groundBounce, haloSpread, envIntensity, fogDensity, fogHeightFalloff,
fogStart, sunScatter, exposure, grade, uniforms,
apply(key, stormMix), applyCycle(phase), setCyclePhase(phase, running, count),
setCycleRunning(running), setStorm(mix), cycleStatus(), sync(),
update(dt) -> boolean, skyAt(x, y, z) -> [r,g,b] linear
```

The shared uniform block, verbatim from art.js:714-727 — every patched
material `Object.assign`s this, so the shapes are fixed:

```js
uSunDir:   { value: new THREE.Vector3() },
uSunHalo:  { value: new THREE.Color() },
uSkyZenith:{ value: new THREE.Color() },
uSkyHigh:  { value: new THREE.Color() },
uSkyHorizon:{ value: new THREE.Color() },
uSkyLow:   { value: new THREE.Color() },
uFog:      { value: new THREE.Vector4(density, heightFalloff, start, scatter) },
uRim:      { value: new THREE.Vector3(strength, power, unused) },
uTimeSF:   { value: 0 },
uWind:     { value: new THREE.Vector3(x, z, speed) },
uGlitter:  { value: new THREE.Vector2(strength, falloff) },
uStorm:    { value: 0 },
```

Three fields are **not** cosmetic and must be set deliberately:

- **`goldenFactor`.** `render.js:1669-1670` computes
  `dynamic = Math.max(1 - (atmos.goldenFactor ?? 1), atmos.storm || 0)`
  and sets `scene.environmentIntensity = atmos.envIntensity * lerp(1, 0.18, dynamic)`.
  `sky.js:901-904` has the mirror rule for the HemisphereLight
  (`intensity = dynamicFill * envIntensity * 0.72`). The two are designed
  to hand off: `goldenFactor = 1` means full PMREM and **zero**
  hemisphere fill; `goldenFactor = 0` means 18% PMREM and full hemisphere.
  Alpenglow is a golden-hour state, so `goldenFactor` runs high (0.85-1.0)
  and the ambient comes from the environment bake. Whiteout is the
  opposite: `goldenFactor` low, hemisphere fill carrying the frame.
  Leaving it at 0 by accident silently runs the PMREM at 18% and the
  level looks flat with no error anywhere.
- **`windDir` / `windSpeed`.** One vector for the world: WNW, bearing
  292°, 14 m/s valley to 31 m/s summit. `uWind` is `(x, z, speed)` and
  drives spindrift, blizzard, banners and the streamers by reference.
- **`fogHeightFalloff`.** The layout's cloud inversion depends on it.
  See §5.

### 4.2 `TIMES` and `GRADES` entries — the literal shapes

A `TIMES` entry, copied verbatim from art.js:305-325 (`noon`) as the
template — every key is required, and `grade` names a `GRADES` key:

```js
noon: {
  label: "High Sun",
  sunAzimuth: 214,
  sunElevation: 62,
  sunColor: "#fff4dd",
  sunIntensity: 4.1,
  skyZenith: "#20489c",
  skyHigh: "#5c85cc",
  skyHorizon: "#d5d3c0",
  skyLow: "#efe0bd",
  sunHalo: "#ffffff",
  haloSpread: 0.11,
  groundBounce: "#d8a86a",
  envIntensity: 1.0,
  fogDensity: 0.00030,
  fogHeightFalloff: 0.011,
  fogStart: 90,
  sunScatter: 0.55,
  exposure: 0.98,
  grade: "bleach",
},
```

A `GRADES` entry, verbatim from art.js:558-573 (`bleach`):

```js
bleach: {
  lift: [0.0018, 0.0018, 0.0032],
  toe: 1.34,
  shade: [0.30, 0.18],
  shadeHue: "#5e6a90",
  bounce: [0.18, 2.4],
  gamma: [1.0, 1.0, 1.02],
  gain: [1.02, 1.0, 0.98],
  saturation: 0.96,
  shadowTint: "#39406a",
  highlightTint: "#fff6e2",
  tint: 0.20,
  contrast: 1.10,
},
```

**`SUMMIT_TIMES` must define four keys** — `alpenglow` (default),
`whiteout` (the blend target, replacing art.js's `storm`), `highnoon`,
`bluehour` — plus the starting values below. These are a starting point
measured against the risk register in §5, not a finished grade; the
harness in §6 is what settles them.

```js
alpenglow: {
  label: "Alpenglow",
  sunAzimuth: 158,          // SSE, low and raking — grazing light is
  sunElevation: 6.5,        // what reveals sastrugi and rime
  sunColor: "#ffd9bd",
  sunIntensity: 3.2,        // LOWER than Vesper's 4.75: snow albedo ~0.85 vs sand ~0.30
  skyZenith: "#0b1c52",     // almost navy — thin air
  skyHigh: "#3560a8",
  skyHorizon: "#b9c9e2",
  skyLow: "#f0c9b4",        // the peach band the snow picks up
  sunHalo: "#ffe6d2",
  haloSpread: 0.09,
  groundBounce: "#cfe0f2",  // snow bounces BLUE-WHITE, not sand's #d8a86a
  envIntensity: 1.15,
  fogDensity: 0.00042,
  fogHeightFalloff: 0.026,  // ~2.4x Vesper's: dense valley, thin summit
  fogStart: 60,
  sunScatter: 0.62,
  exposure: 0.86,           // see 5.4
  grade: "alpine",
},
whiteout: {                 // the blend target; the peer of TIMES.storm
  label: "Whiteout", sunAzimuth: 158, sunElevation: 18,
  sunColor: "#e8eef4", sunIntensity: 1.35,
  skyZenith: "#8f9fae", skyHigh: "#a9b6c2", skyHorizon: "#c7ced4", skyLow: "#d2d6d9",
  sunHalo: "#dfe6ec", haloSpread: 0.30, groundBounce: "#c2ccd6",
  envIntensity: 0.72, fogDensity: 0.0021, fogHeightFalloff: 0.004,
  fogStart: 18, sunScatter: 0.30, exposure: 0.80, grade: "whiteout",
},
```

```js
alpine: {                   // the alpenglow grade
  lift:  [0.0016, 0.0022, 0.0044],   // the black floor is BLUE, not neutral
  toe: 1.06,                          // low: a snow scene has no real black
  shade: [0.42, 0.30],                // MORE deep-shade authority than bleach's 0.30/0.18
  shadeHue: "#2b4f9c",                // BLUE. Inheriting warm's violet #6a5f86 is wrong
  bounce: [0.10, 1.9],
  gamma: [1.0, 1.0, 1.01],
  gain:  [1.0, 0.995, 0.99],
  saturation: 1.06,                   // >1: shadowed snow must NOT desaturate
  shadowTint: "#2a4a8e",
  highlightTint: "#ffe4cf",
  tint: 0.26,
  contrast: 1.04,                     // lower than bleach: the top is the risk here
},
```

**`blendGrade` must list every field or the cycle drops it.**
art.js:965-991 adds `toe`, `shade`, `shadeHue` and `bounce` with `??`
fallbacks precisely because "a field this function forgets arrives as
undefined, which three writes into the uniform as NaN. One NaN in the
composite is the whole frame." Any new grade field needs a line in
`summit-art`'s `blendGrade` **and** a defaulted read wherever it is
consumed — and `render.applyAtmosphere` (render.js:1614-1633) will only
read the fields it already knows, so a genuinely new field has to be
written through `render.uniforms` by `applySummitPostChain` instead.

**The cycle.** `SUMMIT_DAY_CYCLE_STOPS` is the peer of art.js:414-420 —
a frozen array of `{ phase, key, sunAzimuth, sunElevation }` with a
repeated first stop at phase 1.0 so the loop closes. Default is
`{ cycle: false }`: the level ships pinned at alpenglow, and the cycle
exists for the harness and for the `?cycle=` parameter.

### 4.3 Snow and ice materials

`base(name, spec)` in art.js:1475-1497 builds a `MeshStandardMaterial`
with `vertexColors: spec.vertexColors !== false`, `flatShading:
spec.flat !== false`, `roughness ?? 0.95`, `metalness ?? 0`,
`envMapIntensity: 1`, names it `sf-<name>`, then calls
`patchMaterial(m, atmos, { rim, glitter, dunes })`. `summit-art` uses
the same recipe. Starting specs:

| name | flat | roughness | metalness | rim | glitter | notes |
|---|---|---|---|---|---|---|
| `snow` | false (smooth) | 0.92 | 0 | 0.85 | 0.55 | deep snow; the terrain material. Wrap lighting via `extend` |
| `slab` | **true** | 0.78 | 0 | 0.60 | 0.06 | wind slab / sastrugi. Faceted, faintly bluer, barely sparkles |
| `powder` | false | 0.97 | 0 | 0.95 | 0.75 | fresh drift on props and ledges |
| `blueIce` | true | 0.22 | 0 | 0.40 | 0.30 | the Tongue and the Cascade. Depth-tinted cyan through `extend` |
| `blackIce` | false | 0.08 | 0.02 | 0.25 | 0.12 | the Tarn. `envMapIntensity` raised — it reflects sky more than it scatters |
| `rime` | true | 0.88 | 0 | 1.15 | 0.35 | off-white, feathery, high rim: it is translucent at the edges |
| `granite` | true | 0.86 | 0 | 0.50 | 0 | pale grey-green; the cathedral and the exposed rock |
| `sulphur` | true | 0.90 | 0 | 0.55 | 0 | the Fumarole Steps' orange crusts |
| `scree` | true | 0.94 | 0 | 0.45 | 0 | moraine, terminal debris |

`patchMaterial` opts and their exact meanings (art.js:1308-1397):
- `rim` — scales `uRim.x`; the final uniform is `Vector3(0.155 * rim, 2.55, 0)` (art.js:1334).
- `glitter` — strength only; the **falloff is hard-coded to 55**
  (`new atmos.THREE.Vector2(glitter, 55)`, art.js:1335) and ignores
  `atmos.uniforms.uGlitter`'s own default of 60. `GLITTER_FRAG`
  (art.js:1448-1461) works on 18 cm world cells,
  `step(0.982, hash + spec*0.4) * pow(spec, 90)`, added to
  `outgoingLight` as `uSunHalo * … * 2.4`. This is the sparkle the art
  direction asks for — **extend it, do not reinvent it**, and keep it
  off `slab`, `granite` and `scree`.
- `dunes` — **do not use it for sastrugi.** The ripple field has a
  hard-coded prevailing wind, `vec2 wdir = vec2(0.947, 0.322)`
  (art.js:1187-1188), which is Vesper's, and it fires only on gentle
  ground (`smoothstep(0.42, 0.88, sfWN.y)`, art.js:1180). Sastrugi is
  authored in `colourAt`'s scour term (§3.5) and in `slab`'s `extend`.
- `extend(shader, renderer, material)` runs **last** (art.js:1385), and
  `extendKey` folds into `customProgramCacheKey`
  (`sf:${rim}:${glitter}:${bio}:${dunes}|${extendKey}`, art.js:1392-1394).

**The `extend` pattern**, proven at boss-surface.js:654-744:

```js
// Build the uniform value-objects ONCE, outside the compile: a material
// that recompiles otherwise gets fresh uniforms. (boss-surface.js:682-697)
const uniforms = {
  uSnowWrap:  { value: new THREE.Vector2(0.55, 0.30) },
  uSnowDepth: { value: new THREE.Vector3(/* tint */) },
};
const extend = (shader) => {
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${DECLS}`)
    .replace("#include <lights_physical_fragment>", SNOW_BLOCK);   // see below
};
patchMaterial(mat, atmos, { rim: 0.85, glitter: 0.55, extend, extendKey: "snow2" });
```

**Wrap lighting anchors at `#include <lights_physical_fragment>`, and
nowhere else.** coulter.js:288-299 records an hour lost to this: that is
where three folds `material.diffuseColor = diffuseColor.rgb * (1.0 -
metalnessFactor)`, so writing `diffuseColor`, `roughnessFactor` or
`normal` after `#include <lights_fragment_begin>` is a **dead store**.
The block must re-emit the include at its end (coulter.js:458, 592).
`lights_physical_fragment` and `lights_fragment_begin` are both free —
neither `patchMaterial` nor the surface kit touches them.

**`patchMaterial` early-returns on an already-patched material**
(`if (!material || material.userData.sfPatched) return material;`,
art.js:1309) — silently. boss-surface.js:665-669 exists purely to
`console.warn` on that case; copy that guard into `summit-art`, because
a snow material patched twice loses half its shader with no error.

**`boss-surface.js`'s `applySurface` is available but mostly wrong
here.** It *replaces* `patchMaterial` and refuses a material that has
already been through it (boss-surface.js:665), so anything from
`makeMaterials`' `base()` can never take it. It also fades out entirely
past `fadeFar` (42-118 m per family, boss-surface.js:210-250) while still
costing six transcendentals and four screen derivatives per pixel on a
frame that is already fill-bound. Verdict: **do not put it on the
snowfield.** It is legitimate on near-field hero surfaces only — the
cathedral's granite and the Tarn's ice — and only with a new family
authored for the purpose (short wavelength, high cavity, near-zero
metalness). It samples `position`, which for a batched world mesh is
already world space, so the grain will be world-anchored and identical
everywhere: fine for ground, wrong for per-object variation.

### 4.4 Painting

- `paintByHeight(THREE, geo, ramp, opts)` (art.js:1780) defaults `min` /
  `max` to the geometry's **own bounding box** (art.js:1783-1784). On a
  merged station mesh that maps the whole ramp across whatever happens
  to be in the bin. **Always pass explicit `min`/`max`** — world.js:1676
  is the reference (`{ min: plazaY, max: plazaY + WALL_H }`). On this
  level the natural range is the station's own pad elevation to pad + the
  feature's height, never the map's 0-452 m.
- `paintGeometry(THREE, geo, ramp, fn, opts)` (art.js:1666) writes a
  colour attribute of **itemSize 3**, sRGB→linear transferred.
- `srgbTransfer` (art.js:963) is **sRGB → LINEAR**, despite the name:
  `c <= 0.04045 ? c/12.92 : pow((c + 0.055)/1.055, 2.4)`. Ramps are
  authored in sRGB hex and converted on write (terrain.js:1271). Snow
  ramps authored as linear values and passed through this render far too
  dark — and on a white level "far too dark" reads as a lighting bug.
- `kit.facet(geo)` (structures.js:2030) bakes flat shading by exploding
  the index; six times the vertices, zero extra draw calls. Apply it
  **after** displacement and **before** painting so vertex colours land
  per facet (world.js:4530-4537). Wind slab, seracs, columnar ice and
  granite all want it; deep snow does not.
- `mergeGeometries` takes its attribute name list from `geometries[0]`
  (sky.js:1006) and pads missing attributes with zeros (sky.js:1031).
  Merge an unpainted geometry first and the whole batch loses colour;
  merge it last and it renders black. Never merge a 4-component cloud
  colour buffer with a 3-component painted one.

---

## 5. POST-CHAIN RISK REGISTER — a WHITE scene on a desert-calibrated pipe

Every number in `render.js`'s composite was measured on dark warm sand.
The scene buffer of a live Vesper boss frame runs **p50 0.165, 99.2%
below 0.78** in linear scene units (render.js:1399-1404). A sunlit snow
frame runs an order of magnitude higher: albedo ≈ 0.85 linear under
`sunIntensity` ≈ 3.2, i.e. ≈ 0.87 × N·L before any bounce, against
sand's ≈ 0.30 albedo. Ten of the pipeline's decisions invert as a
result.

All mitigations live in **one function** in `summit-main.js`, called
after `render.applyAtmosphere(atmos)` at boot and after **every**
subsequent `applyAtmosphere` (§2.6):

```js
function applySummitPostChain(render) {
  const u = render.uniforms;
  u.uThreshold.value.set(2.35, 0.55, 0);   // 5.1
  render.setAoKeyKnee(1.55);               // 5.2
  u.uContactGain.value.y = 0.55;           // 5.3
  render.setExposureScale(0.88);           // 5.4  (grade also carries exposure)
  render.setBounce(0.10, 1.9);             // 5.7  (or let the grade do it)
  u.uVignette.value.set(0.16, 0.42);       // 5.8
  u.uHaloAmount.value = 0.02;              // 5.9
}
```
The numbers above are **starting points chosen against the arithmetic
below**. `scripts/saintfall-summit-post.mjs` (§6) is what settles them,
and it must record the measured p50/p99 of the scene buffer the way
render.js:1399-1404 records Vesper's.

### 5.1 Bloom threshold — calibrated for sand, no setter

`render.js:1318`: `uThreshold: { value: new THREE.Vector3(1.0, 0.62, 0) }`
in **linear scene units, before** `c *= uExposure` (render.js:1052); the
soft knee starts at 0.38.

Sunlit snow computes to ≈ 1.29 × N·L at Vesper's `sunIntensity`, so
every facet with N·L > ~0.78 clears the threshold and **the whole
snowfield blooms**. Sand's ≈ 0.30 albedo never gets there. The dome is
worse: a near-white `skyLow`/`skyHorizon` plus `disc*6.5 + glare*2.2`
(sky.js:149) puts the entire sky over threshold and veils the mountains.

`setBloom(v)` (render.js:1964) changes only the **mix**. There is no
setter for the threshold. **Mitigation:** write
`render.uniforms.uThreshold.value` (render.js:2027 exposes the block).
Set it so the brightest *snow* sits below the knee and the **braziers
are still the brightest thing in frame** — which is the art direction's
explicit requirement, and the reason "nothing pure white" is a material
rule and not a taste.

### 5.2 The AO key exemption switches AO off on snow

`render.js:942-944`:
```glsl
float keyed = smoothstep(uAo.z, uAo.z * 2.2, keyLuma);
float ao = mix(1.0, texture2D(tAo, vUv).r, uAo.x * (1.0 - 0.7 * keyed));
```
`uAo.z = 0.55` (render.js:1403) was chosen *because* the desert buffer
measured p50 0.165. On snow most pixels exceed it, so occlusion is cut
to 30% **exactly where white-on-white contact is the only thing giving
the frame form**. This is the single most damaging inherited default.

**Mitigation:** `render.setAoKeyKnee(v)` (render.js:1973). Raise it
above the snow p50 so the exemption goes back to meaning "this is a
light source", not "this is snow". Sky is already excluded from AO by
the `-z >= far*0.98` early-out (render.js:554), so raising the knee does
not put AO on the dome.

### 5.3 The contact-shadow lit-knee saturates, and has no setter

`render.js:984`: `float lit = smoothstep(uContactGain.y, uContactGain.y * 3.0, keyLuma);`
with `.y = 0.05` (render.js:1405). Everything in a snow frame is "lit",
so the screen-space contact term runs at **full authority in shaded snow
too** — and that shaded snow is already being darkened by the grade's
`uShade` block. Double darkening in the blue shadows is how a snow level
gets muddy.

`setContactShadow(gain, steps)` (render.js:2014) writes only `.x` and
the tap count. **Mitigation:** write `render.uniforms.uContactGain.value.y`
directly, to roughly the same order as the new AO knee.

### 5.4 Tone curve, exposure and the shoulder

`c *= uExposure` (render.js:1052) then `gt(x, P=1.0, a=1.06, m=0.22,
l=0.36, c=uToe, b=0.0)` (render.js:891-897). The white point is 1.0 and
the shoulder is exponential, so snow parks on the shoulder and clips.
**Mitigations, together:**
- A materially lower `exposure` in the TIMES entry than golden hour's
  1.02 (art.js:301) — 0.86 is the starting value in §4.2.
- A **low `toe`**: a snow scene has no real black. Compare `storm`'s
  1.10 (art.js:621) against `bleach`'s 1.34; `alpine` uses 1.06.
- `render.setExposureScale(v)` (render.js:2026) as the harness-facing
  trim, so the grade's own `exposure` stays the authored number.

### 5.5 The grade's black floor is not the risk; the top is

`c = uLift + (uGain - uLift) * pow(c, uGamma)` (render.js:1114) is an
absolute floor. The header block at render.js:43-55 and art.js:438-456
records the sRGB-30 wall that made eighteen captures report an identical
1st-percentile luminance. Current floors are ~0.002-0.012 and that is
fine here. **What must not happen is the mirror failure at the top:**
if every snow pixel lands on the shoulder, eighteen captures will report
an identical 99th percentile and every A/B will measure as no-op. The
post harness must report **p99 and the clipped-pixel fraction**, not
just p1, or it will repeat the same mistake in the other direction.

### 5.6 Deep-shade hue rotation — the right instrument, wrong hue

`uShade = [amount, knee]` with `uShadeHue` (render.js:1106-1111) rotates
everything below the luma knee toward the grade's hue at constant level.
Snow shadows *are* genuinely blue, so this is the correct tool and
`alpine` leans on it harder than `bleach` does (0.42/0.30 vs 0.30/0.18).
**The trap is inheritance:** copying `warm`'s `shadeHue: "#6a5f86"`
gives violet shadows, and `bleach`'s `#5e6a90` gives grey-blue — the art
direction requires *saturated* blue, and requires that shadow **does not
desaturate** (hence `saturation: 1.06` in `alpine`, above 1.0, which no
Vesper grade uses).

### 5.7 Emissive bounce

`recv = 1 - smoothstep(uBounce.y * 0.45, uBounce.y, sceneLuma)`
(render.js:1043). With `bounce.y = 1.6` snow luma kills the term
entirely — which is *correct* (snow should not receive coloured bounce
from a brazier at fifty metres) but must be stated in the grade rather
than inherited by accident, because the nine braziers on the parvis are
the level's only warm light and their falloff on the surrounding snow is
a composed effect. `alpine` sets `bounce: [0.10, 1.9]`. `setBounce(gain,
knee)` (render.js:2020) is the runtime knob. Note the bounce term is
already excluded from the sky by `isWorld = step(zc, far*0.98)`
(render.js:1041).

### 5.8 Vignette is a module constant and reads far harder on white

`render.js:1423`: `uVignette: { value: new THREE.Vector2(0.30, 0.30) }`,
applied **multiplicatively** at render.js:1126-1127. On dark sand a 30%
corner falloff is atmosphere; on a near-white frame it is a grey frame
painted around the picture, and it will show up in exactly the wide
summit vistas the level is built for. No grade field reaches it and
there is no setter. **Mitigation:** `render.uniforms.uVignette.value` —
reduce the amount and push the start radius outward.

### 5.9 The lens halo veil is red-weighted and never written

`render.js:1636`: `compMat.uniforms.uHaloTint.value.set(halo.r * 0.14,
halo.g * 0.11, halo.b * 0.08)` — deliberately warm — with
`uHaloAmount` fixed at 0.06 (render.js:1425) and **never written by
`applyAtmosphere`**. On a blue-shadowed white frame a warm edge veil
reads as a lens smudge. **Mitigation:** drop `uHaloAmount` through
`render.uniforms`, and let the *authored* 22° halo and sun dogs
(geometry, §1.1) carry the ice-crystal optics instead. These are two
different things with confusingly similar names — do not use the
composite's lens halo to fake the atmospheric one.

### 5.10 Fog, the inversion, and the thing that makes the peak read

`uFog` is `(density, heightFalloff, start, scatter)` and the aerial
perspective in `ATMOS_FRAG` (art.js:1098) fades opaque surfaces toward
`sfSky(rd)` — `mix(gl_FragColor.rgb, sfSky(rd), f)` at art.js:1126.
Two consequences the art direction depends on:
- **Height-dependent fog is what stops the peak reading as a flat
  cutout.** `fogHeightFalloff` at Vesper's 0.011 barely varies over a
  36 m dune; over 452 m of elevation it is the whole image. §4.2 sets it
  ~2.4× higher and the cloud inversion at 120 m is where the density
  transition sits.
- **An additive layer must fade to BLACK, not to sky.** art.js:1094:
  `gl_FragColor.rgb *= (1.0 - f * uRim.z) * smoothstep(0.6, 11.0, sfDist);`
  versus the opaque `mix(..., sfSky(rd), f)` at art.js:1126. Calling
  `patchBasicMaterial(mat, atmos, fade)` **without `additive = true`** on
  a spindrift sheet, a halo ring, a brazier glow or a light shaft makes
  it a full-brightness patch of sky at distance — art.js:1405-1411
  records exactly that: a hazed shaft "read as a pale wedge stamped over
  the mountains". On a level whose signature image is a hazed distance,
  this failure is everywhere at once.

### 5.11 The shadow radius is too small for a 452 m peak, and `setQuality` resets it

`QUALITY` (render.js:115-136, frozen) tops out at `shadowRadius: 340` on
ultra; high is 250. `sky.setShadowRadius(half)` sets the ortho box **and**
`camera.far = half * 6`, then re-derives both biases from the texel
(`normalBias = max(0.02, texel * 1.45)`, `bias = -min(0.0008, texel *
0.9 / range)`, sky.js:844-849), and the sun is placed at
`target + sunDir * shadowSpan * 2.6` (sky.js:963).

A 452 m peak with a cathedral on it sits **outside** a 250 m box and
casts nothing. And `setQuality(tier, sky)` calls
`sky.setShadowRadius(q.shadowRadius)` on **every** tier change
(render.js:1863), so any per-level override is wiped each time the
player touches the settings panel. **Mitigation:** `summit-main`'s
`setQuality` wrapper re-applies its own radius immediately after the
call, and re-runs `resize()`, exactly as main.js:961-966 does:

```js
function setQuality(tier) {
  const key = render.setQuality(tier, ctx.sky);
  ctx.sky.setShadowRadius(SUMMIT_SHADOW_RADIUS[key]);   // per-tier, > the tier default
  render.requestShadowUpdate();
  resize();
  ctx.quality = key;
  return key;
}
```
Raising the radius coarsens the texel, which re-derives a larger
`normalBias`. The shadow note in memory records a 0.35 m `normalBias`
erasing the player's own cast shadow at a low sun — and alpenglow **is**
a low sun. Measure the trooper's contact shadow at every tier, at the
parvis and at the basecamp, before calling the radius settled.

### 5.12 Two more that are correct already — do not "fix" them

- **Dither** (render.js:1151-1156, triangular IGN at ±1/255 in sRGB) is
  *more* valuable on snow than on sand, because a near-white gradient is
  where banding is visible. Leave it on.
- **Sky exclusion.** The dome writes depth 1.0 and is excluded from AO
  (render.js:554) and from bounce (render.js:1041). Those early-outs are
  what let §5.2's knee change be safe.

### 5.13 MSAA and the black-frame rule

`setQuality` disposes the scene target when `samples` changes
(render.js:1840-1843) because MSAA only takes effect on a fresh
framebuffer; `resize()` alone is a no-op when the buffer size is
unchanged. And **a resized canvas is a cleared canvas** — the dynamic
resolution change is deliberately deferred to the top of `render()`
(render.js:1515-1526, `flushPendingScale()` at :1692). Never call
`setRenderScale`/`resize` from the summit loop *after* the draw, or every
resolution step presents a black frame with the HUD painted on top.

---

## 6. HARNESS CONTRACT

Seven existing harnesses were read for this pattern; the cleanest
templates are `scripts/saintfall-vesper-review.mjs` (contact sheet),
`scripts/saintfall-vfx-sheet.mjs` (per-scene strips + an in-page helper
object) and `scripts/saintfall-ground-fx.mjs` (mote-level assertions).
Copy them; do not invent a new shape.

### 6.1 Skeleton

```js
#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 49957;                       // or 43000 + (process.pid % 9000) for parallel runs
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = "/games/saintfall-white-vigil.html";
const OUT  = path.join(root, "output/saintfall/white-vigil");

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});
try {
  // READINESS: poll-fetch the page. NEVER a fixed sleep.
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}${PAGE}`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
           "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`${BASE}${PAGE}?qa=1&quality=high&time=alpenglow`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.hideHud(true);
  });
  // … shots …
} finally { server.kill(); }
```

`?qa=1` unlocks the real `ctx` on the hook (qa.js:44) and pins render
scale and shadow cadence for reproducible goldens (render.js:1503, 1678,
1847). `&quality=` is session-only and does not write the stored
setting. The 300 s ready timeout is the house number and this level
builds more terrain than Vesper does — do not shorten it.

### 6.2 The rAF workaround — mandatory, and the reason it exists

Documented at `qa.js:8-19`: headless Chromium throttles `requestAnimationFrame`
to about **one frame a second**, so a harness that waits on real frames
"captures the same stale image eight times and reports eight passing
poses". And `page.screenshot()` goes through the browser compositor,
which only refreshes on a real animation frame — it "returns
byte-identical captures of a stale surface for exactly the same reason".

The synchronous stepper is the answer:

```
window.__SF.renderOnce(dt = 1/60)   // qa.js:100  — api.step(dt, true): steps AND draws
window.__SF.renderStill()           // qa.js:107  — api.step(0, true): draws WITHOUT advancing
window.__SF.advanceTime(s, dt)      // qa.js:113  — N x api.step(dt, false): steps, no draw
window.__SF.captureDataURL()        // qa.js:1483 — reads the WebGL drawing buffer
```
`renderStill` exists because settling a frame with three `renderOnce`
calls silently pushes the clock 0.05 s (qa.js:101-106) — which once made
an animation strip sample 0.133 s per frame instead of the 0.085 s it
asked for. Capture idiom:

```js
const url = await page.evaluate(() => {
  for (let i = 0; i < 3; i += 1) window.__SF.renderStill();
  return window.__SF.captureDataURL();
});
await writeFile(file, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
```
This works because `render.js:1186` sets `preserveDrawingBuffer: true`.
`page.screenshot()` is permitted **only** where a DOM overlay is the
subject (the field menu, the ascent map).

Two more traps that bite on this level specifically:
- **`terrain.updateLod(camera)` must have run** before the first capture,
  or every chunk is still `visible = false` (terrain.js:1384, 1393) and
  the shot is an empty sky. Any `renderOnce`/`renderStill` satisfies it,
  because `step` calls it — but a harness that captures immediately after
  `waitForFunction` without stepping will not.
- **`vfx.reset()` before every beauty shot** (vfx.js:5728). Otherwise the
  previous scene's live effects are photographed under this one's subject.

### 6.3 Camera

There is no `freeCamera` method anywhere in the repo. The pair is:

```js
window.__SF.lookAt([x, y, z], [tx, ty, tz], fov)   // qa.js:173
window.__SF.releaseCamera()                        // qa.js:178
```
both routed through `player.setFree(on, pos, target, fov)`
(player.js:6396). Also available and safe on a lean api: `orbit(x, z, y,
bearing, radius, pitch, fov)` (qa.js:2114), `safeOrbit` (qa.js:2134,
needs `world.group` + `terrain.heightAt`), `heroCamera(opts)`
(qa.js:2964), `setCam(yaw, pitch, dist)` (qa.js:578), `setPose(id)`
(reads `world.beautyShots` via `getBeautyShots()`).

**The detached-camera trap** (from the harness-damage note): a beauty
shot's detached camera makes `hurtPlayer` return 0 for the rest of the
run and only `releaseCamera()` clears it. There is no combat here, but
the same latch affects anything that samples the player — always pair
`lookAt` with `releaseCamera`.

**Every station shot must have an eye-level twin.** The art direction's
bar is explicit: a frame that only works from a floating camera is not
finished. So each entry produces two files — the composed vista, and the
same subject at 1.7 m with the figure in shot (`releaseCamera()`, then
`_teleportRaw(x, z, yaw)` and `setCam`).

### 6.4 Scenes are stringified

`await page.evaluate(\`(${setup.toString()})(window.__SF)\`)` — nothing
from module scope travels with the function (garner-shots:96 records
this explicitly). Anything shared must be installed on `window`, the way
`saintfall-vfx-sheet.mjs:509` does `window.__VFXH = H`. The summit
harnesses install `window.__VIGIL` with
`{ station(id), eye(id), settle(n), grazeSun(), depthAt(x,z), tile(label, frames) }`.

### 6.5 Contact sheets

```js
async function sheet(tiles, cols, tw, th, file) {
  const rows = Math.ceil(tiles.length / cols);
  const buffer = await sharp({
    create: { width: cols * tw, height: rows * th, channels: 3, background: "#0d0b10" },
  }).composite(tiles.map((input, i) => ({
    input, left: (i % cols) * tw, top: Math.floor(i / cols) * th,
  }))).png().toBuffer();
  await writeFile(file, buffer);
  return file;
}
```
Labels are inline SVG buffers composited over the tile
(`fill="#e8e2d6" font-family="monospace" font-size="13"` on
`rgb(8,8,10)`, vfx-sheet:350-363), with text entity-escaped
(`.replaceAll("&", "&amp;").replaceAll("<", "&lt;")`). Per-scene
horizontal strips at `SHOT_W = 640, SHOT_H = 400` plus a 22 px label
band, stacked into `sheet.png` (vfx-sheet:529-552). **On a white level,
change the sheet background** — `#0d0b10` behind white tiles hides
nothing, but a mid-grey (`#3a3d42`) makes a clipped white edge visible
at a glance, which is the whole point here.

### 6.6 Output and exit

`output/saintfall/<harness-name>/`, with `<harness-name>/<tag>` for A/B
runs (`--tag before`). `output/` is gitignored (.gitignore:20).
`mkdir(OUT, { recursive: true })`, and print `path.relative(root, file)`
at the end.

Assertion harnesses use the house `check(name, ok, detail)` helper and
set `process.exitCode = 1` on any failure **or any captured page error**.
The four summit harnesses and what each must prove:

| harness | must assert |
|---|---|
| `saintfall-white-vigil-review.mjs` | all fourteen camera stations render; a contact sheet per station; eye-level twin for each; zero page errors |
| `saintfall-summit-traversal.mjs` | Via Sacra grade max ≤ 13% and mean ≤ 9% over 600 samples; every pad flat to ±0.35 m across its radius; every station reachable on foot from the basecamp without exceeding `WALK_SLOPE_LIMIT`; no two pads overlap; the player is never stuck (`collide.stats()` + an unstuck counter of 0) |
| `saintfall-summit-weather.mjs` | motes drift at the same speed walking as standing; worst single-frame mote jump while walking < 0.25 m (the anchor-snap regression, modelled on ground-fx:162-215, which re-derives mote world positions from the same `h11(aSeed)` hashes the shader uses) |
| `saintfall-summit-post.mjs` | scene-buffer p50/p99 and clipped-pixel fraction at each of the four TIMES presets; bloom does not veil the mountains; AO is present in the snow-on-snow contacts; the braziers are the brightest thing in the parvis frame |

---

## 7. DO-NOT-BREAK LIST

### 7.1 Vesper-IX must be bit-for-bit unaffected

| regression | how it would happen | detector |
|---|---|---|
| Vesper fails to boot | a typo in `boot.js`'s `MODULES` array or `entryModule()` | `node --check assets/js/saintfall/boot.js` then `node scripts/saintfall-shots.mjs --shots hero --page saintfall.html` — it must produce its usual sheet with zero page errors |
| Vesper's entry point changes | `entryModule()` returning something other than `"main"` when `data-sf-entry` is absent | `grep -n 'data-sf-entry' games/saintfall.html` must return **nothing**; boot.js:128 must still be `MODULES.includes(name) ? name : "main"` |
| Vesper's clerestory shafts vanish | the vfx.js guard written as `if (cath)` without the finite check, or wrapping too much of the block | `node scripts/saintfall-shots.mjs --page saintfall.html --shots cathedral` and diff against the pre-change capture; `window.__SF.ctx.vfx.group.getObjectByName("shafts")` must still exist on the Vesper page |
| Vesper's field saves are clobbered | reusing `save.js` from summit (`GAME_ID = "saintfall"`, save.js:21) | `save.js` must not appear in any `summit-*.js` import — `grep -rn 'saintfall/save.js' assets/js/saintfall/summit-*.js` returns nothing |
| Vesper's UI settings drift | summit writing a different shape into `localStorage["saintfall:field-ui:v1"]` (ui.js:15) | summit only ever *reads* via `readStoredSettings()` and writes through `gameUi.setSetting` |
| stale modules served | a new `summit-*.js` not in `MODULES`, or `BUILD` not bumped | `node -e` script that parses the MODULES array and `ls assets/js/saintfall/summit-*.js`, asserting the sets match; and the three `?v=` tags in both HTML pages equal `BUILD` |

### 7.2 Engine invariants the summit itself must not break

| invariant | why | detector |
|---|---|---|
| **`MAP_SIZE` stays 2048** | `collide.js:28` hardcodes `HALF = 1024`; `REACH = 1030`; `player.js` clamps ±1010 in three places. A larger map mis-pages the ground cache silently | `grep -n 'MAP_SIZE\|MAP_HALF' assets/js/saintfall/summit-terrain.js` |
| **Nothing added to `world.group` after `buildCollision`** | the raster bakes once (collide.js:40) — later geometry has zero collision, with no error | `window.__SF.collideStats().perMesh` must list every station's structural mesh; `saintfall-summit-traversal.mjs` walks each pad perimeter |
| **`userData.collisionSolid = true` on sub-metre-triangle solids** | the 0.5 m longer-horizontal-dimension filter at collide.js:369 is per **triangle**. Seracs, columnar ice, cathedral steps, rime trunks, `facet()`ed landforms are all built from small triangles and become walk-through | `collide.stats().perMesh` cell counts per mesh; any structural mesh with < 50 cells is suspect |
| **`userData.noCollide = true` on every additive card** | collide.js:523. The recorded failure is the lander's 26 m additive halo cone rasterising into an invisible tower. Spindrift sheets, brazier glows, light shafts, the 22° halo ring | walk the parvis and every station with `collide.setDebugView` on; `blocked()` must be false in open air |
| **No mesh named `road-surface-*` unless it is support** | collide.js:518 excludes that prefix from the raster **unconditionally**. The batcher names meshes `${district}-${tag}-${matName}` (world.js:79), so a Via Sacra deck is walkable-but-not-blocking only via `batch.add("road", mat, geo, { tag: "surface" })` — and any other mesh that accidentally takes the prefix silently stops blocking | `grep` the built mesh names in `world.meshes` for the prefix and cross-check against the walk-surface list |
| **Exactly two lights from the sky, ≤ 12 point lights from the world** | no clustered lighting: every point light is a per-fragment cost on every material (world.js:4955), and a light that joins the scene later recompiles every lit program | `window.__SF.ctx.scene` light count; the nine parvis braziers + three fumarole vents = 12 exactly, so a thirteenth is silently dropped |
| **Every runtime light exists from frame zero at intensity 0** | the constant-visible-light invariant; a late light is a multi-hundred-millisecond freeze | `scripts/saintfall-cutscene-freeze-check.mjs`-style hitch probe over a full station tour |
| **The weather anchor is never snapped** | vfx.js:5685-5691 and the shader comment at vfx.js:226-241: an 8 m anchor snap trades a slide for a jump, is invisible standing still, and passed every still review in the project | `saintfall-summit-weather.mjs`: worst single-frame mote jump while walking < 0.25 m |
| **Emitter kinds are real** | an unknown `kind` is silently dropped (`if (!preset) continue;`, vfx.js:1177). Valid: `fire, flare, flaresmoke, smoke, steam, heat, spore`, plus `shaft` | assert `vfx.plumes.length === world.emitters.filter(e => e.kind !== "shaft").length` |
| **Crevasses are ≥ ~12 m at the top** | narrower than the 4 m LOD0 cell and the drawn mesh (`groundHeightAt`) disagrees with the analytic field (`heightAt`) that `vfx.footprint` reads (vfx.js:5523) | `summit.crevasseProbe(x, z)` at every authored crevasse; assert `|heightAt - groundHeightAt| < 0.5` on the lip |
| **`runtime.phase` stays `"playing"`** | `syncRuntimePaused` early-outs otherwise (main.js:382) — the level would never pause for the menu or a hidden tab, and `ui.js:1914` would refuse to open the field menu at all | open the menu in the harness and assert `ctx.runtime.paused === true` |
| **`applySummitPostChain` re-runs after every `applyAtmosphere`** | `applyAtmosphere` overwrites the grade block but never touches `uThreshold`, `uAo.z`, `uContactGain.y`, `uVignette`, `uHaloAmount` | `saintfall-summit-post.mjs` cycles the time of day and re-reads `render.uniforms` after each change |
| **The shadow radius survives a quality change** | `setQuality` calls `sky.setShadowRadius(q.shadowRadius)` unconditionally (render.js:1863) | step through all four tiers and assert `sky.shadowSpan >= SUMMIT_SHADOW_RADIUS[tier]` after each, and that the trooper still casts a contact shadow at alpenglow |
| **`patchMaterial` is never called twice on one material** | it early-returns silently (art.js:1309); half the shader is lost with no error | copy boss-surface.js:665-669's `console.warn` guard; assert zero warnings in the harness console capture |
| **Additive materials pass `additive = true`** | art.js:1094 vs :1126 — otherwise a hazed additive surface is a full-brightness patch of sky | visual: the `inversion` and `summit-look-back` shots; numeric: no additive mesh's far-field pixels exceed the local sky luma |
| **Load stays under ~6 s** | the yield cadence (terrain.js:1405-1410) and the collision raster are the two costs; a hidden tab throttles `setTimeout` to 1 s | time from `goto` to `isReady()` in every harness; print it, fail over 12 s |

### 7.3 The commands

```sh
# syntax, every new and edited module
node --check assets/js/saintfall/boot.js
for f in assets/js/saintfall/summit-*.js; do node --check "$f"; done
node scripts/saintfall-lint-glsl.mjs          # backticks in GLSL comments kill the template literal

# Vesper regression — must be run before and after every summit change
node scripts/saintfall-shots.mjs --page saintfall.html --shots hero
node scripts/saintfall-vesper-review.mjs
node scripts/saintfall-boss-audit.mjs

# the summit itself
node scripts/saintfall-shots.mjs --page saintfall-white-vigil.html --shots hero
node scripts/saintfall-white-vigil-review.mjs
node scripts/saintfall-summit-traversal.mjs
node scripts/saintfall-summit-weather.mjs
node scripts/saintfall-summit-post.mjs
node scripts/saintfall-quality-tier-check.mjs --page saintfall-white-vigil.html
node scripts/saintfall-hitch-probe.mjs --page saintfall-white-vigil.html
```

`node --check` does **not** catch a duplicate `const` in an ESM module —
that lesson is already paid for. Boot the page.

---

## 8. Open questions for the implementer to close, in writing

1. **Via Sacra profile source** — §3.2 option (a) or (b). Recommendation is (a) plus a parvis `padExit`. Whichever is chosen, record the measured grade histogram.
2. **Skirt depth** — `SKIRT = 11` is measured against a 36 m dune, not a 40% summit grade. Re-measure or justify.
3. **Snow-depth → player feel** — `applySlow` from `summit-main` is the only route that does not edit `player.js`. Confirm it feels like depth rather than like mud, or drop the feature.
4. **`boss-surface.js` families** — if the cathedral granite takes the surface kit, a new family must be authored and its per-pixel cost measured on the fill-bound frame before it ships.
5. **The 12-light budget** — nine braziers plus the fumarole vents is exactly 12. Decide now which lights are real and which are emissive geometry, because the thirteenth is dropped silently.
