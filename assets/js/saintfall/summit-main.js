/* ============================================================
   SAINTFALL - Kenosis entry point  ("The White Vigil")

   A peer of main.js, not a fork of it, and the reason is scope:
   main.js builds forty systems because Vesper-IX is a campaign.
   This level is an ENVIRONMENT - no enemies, no bosses, no
   mission, no combat, no progression, no saves - so it builds
   twelve, and every omission below was checked against the code
   that would have used it rather than assumed to be safe.

   ------------------------------------------------------------
   CONSTRUCTION ORDER, AND THE FOUR PLACES IT IS LOAD-BEARING

     atmosphere -> renderer -> materials -> sky -> field ->
     terrain -> world -> collision -> vfx -> weather -> player ->
     shell -> QA

   1. ATMOSPHERE FIRST. Every patched material Object.assigns
      `atmos.uniforms` at compile time, and player.js reads
      `ctx.atmos.duskFactor` / `.nightFactor` with a BARE
      dereference inside update() - the only non-optional
      dependency the controller has on anything outside itself.
   2. TERRAIN BEFORE COLLISION. buildCollision dereferences
      ctx.terrain immediately and throws if it is unset.
   3. WORLD BEFORE COLLISION. The rasteriser traverses
      world.group, ONCE. Anything added to that group afterwards
      has no collision at all and nothing says so.
   4. THE GROUND OVERRIDE BEFORE THE FIRST groundHeight CALL.
      collide.js optional-chains it, so a late assignment is
      SILENT rather than fatal - which is worse, because the
      moulins simply stop being holes.

   ------------------------------------------------------------
   WHAT IS OMITTED, AND THE EVIDENCE

   enemies, combat, campaign weapons, boost, shield, slam,
   progression, breaches, every boss module, save, intro, pod,
   tutorial, audio. Every reference to those inside player.js and
   collide.js is optional-chained or mode-gated - melee swings
   still play, they just deal no damage; the plain 6.4 m/s jump is
   untouched. The separate Meshy props and their non-damaging
   crescent discharge are Kenosis-local proofs built below; they do
   not reintroduce the campaign weapon/combat graph. The one
   exception is `ctx.mission`, which is STUBBED
   rather than omitted: ui.js gates the entire field interface on
   it, so without a stub there is no Esc menu, no settings, no
   quality switch and no map. The stub is inert, not a fake
   mission - see `makeVigilStub`.
   ============================================================ */

import * as THREE from "three";
import { makeStat, clamp01, hashString } from "saintfall/core.js";
import { createRenderer, normalizeQuality } from "saintfall/render.js";
import { createPlayer } from "saintfall/player.js";
import { buildCollision } from "saintfall/collide.js";
import { buildJetpack } from "saintfall/jetpack.js";
import { buildVfx } from "saintfall/vfx.js";
import { buildTouchControls } from "saintfall/touch.js";
import { buildDifficulty } from "saintfall/difficulty.js";
import { buildGameUi, readStoredSettings } from "saintfall/ui.js";
import { installQa } from "saintfall/qa.js";

import {
  makeSummitAtmosphere, makeSummitMaterials, applySummitWind, SUMMIT_TIMES,
} from "saintfall/summit-art.js";
import { buildSummitSky } from "saintfall/summit-sky.js";
import {
  makeSummitField, buildSummitTerrain, STATIONS, BASECAMP,
} from "saintfall/summit-terrain.js";
import { buildSummitWorld } from "saintfall/summit-world.js";
import { buildSummitWeather } from "saintfall/summit-weather.js";
import { buildSummitHud } from "saintfall/summit-hud.js";
import { installSummitQa } from "saintfall/summit-qa.js";
import { chooseSummitCharacter } from "saintfall/summit-characters.js";
import { buildSummitLoadout } from "saintfall/summit-loadout.js";
import { buildSummitDischarge } from "saintfall/summit-discharge.js";
/* The Kenosis kits (m107) made this level a COMBAT level: the
   campaign's own bestiary, combat rules, audio, boost and slam are
   built here now - filtered to the three trial castes - plus the
   two modules that are this level's own: the operative kits and the
   trials ground that proves them. */
import { buildEnemies } from "saintfall/enemies.js";
import { buildCombat } from "saintfall/combat.js";
import { buildAudio } from "saintfall/audio.js";
import { buildBoost } from "saintfall/boost.js";
import { buildSlam } from "saintfall/slam.js";
import { buildKenosisKit } from "saintfall/summit-kenosis.js";
import { buildSummitTrials } from "saintfall/summit-trials.js";
import { buildSummitDoctrine } from "saintfall/summit-doctrine.js";
import { buildSummitCommand } from "saintfall/summit-command.js";
import { KENOSIS_TREES } from "saintfall/summit-doctrine-config.js";

/* The LABELS are alpine and the ROW NAMES are not - see
   summit-art.js's header: `goldenhour`/`dusk`/`night` set
   goldenFactor/duskFactor/nightFactor inside makeAtmosphere and
   modules outside art.js read them. A reviewer will type the
   label, so the label resolves. */
const TIME_ALIASES = {
  alpenglow: "goldenhour",
  whitenoon: "noon",
  bluehour: "dusk",
  vigil: "night",
  whiteout: "storm",
};
const resolveTime = (key) => {
  const k = String(key || "").toLowerCase();
  return SUMMIT_TIMES[k] ? k : (TIME_ALIASES[k] || "goldenhour");
};

/* ============================================================
   THE POST CHAIN, RE-AIMED AT A WHITE WORLD

   Every constant in render.js's composite was measured on dark
   warm sand: the scene buffer of a live Vesper frame runs p50
   0.165, 99.2% below 0.78 in linear units. A sunlit snow frame
   runs an order of magnitude higher - albedo about 0.85 against
   sand's 0.30 - and four of the pipeline's decisions invert as a
   result.

   THE AO KEY KNEE IS NOT SET HERE. It is a GRADE property
   (`ao: [skyTint, knee]`, on every SUMMIT_GRADE), because the day
   cycle blends grades continuously and a knee written once at
   boot would be wrong for four of the five times of day. Writing
   it here as well would fight the blend.

   This runs after EVERY applyAtmosphere, because applyAtmosphere
   rewrites the whole grade block and never touches these four.
   ============================================================ */
function applySummitPostChain(render) {
  const u = render.uniforms;
  if (!u) return;

  /* BLOOM THRESHOLD. In linear scene units, BEFORE the exposure
     multiply, with a soft knee starting at 0.38 below it. Vesper's
     1.0 is cleared by any snow facet with N.L over about 0.78, so
     at the desert's setting THE ENTIRE SNOWFIELD BLOOMS and the
     braziers - which the art direction requires to be the
     brightest thing in any frame containing them - lose to a
     hillside. 2.35 puts sunlit snow just under the knee and leaves
     the flames, the rose window and the specular on black ice
     above it. */
  if (u.uThreshold && u.uThreshold.value && u.uThreshold.value.set) {
    u.uThreshold.value.set(2.35, 0.55, 0);
  }

  /* THE CONTACT SHADOW'S LIT KNEE. `smoothstep(knee, knee*3, luma)`
     at 0.05 means everything in a snow frame counts as "lit", so
     the screen-space term runs at full authority in the blue
     shadows too - and those shadows are already being darkened by
     the grade's shade block. Double-darkening the shadow side is
     precisely how a snow level turns muddy. */
  /* AO and the contact term are left at the tier's own values.

     A large flat brighter-than-its-surroundings polygon appears on
     near ground in the harness's eye-level basecamp frame - a blind
     reviewer called it "a flat untextured white hexagon, an obvious
     unshipped plane" and lost the frame on it. It is NOT yet
     diagnosed, and four candidate fixes here were reverted:

       - the powder material's relief (raised; frame unchanged)
       - the drift-collar tail (capped to the footprint; unchanged)
       - the contact term's authority and knee (0.98 -> 0.42 -> 0.26
         via `setContactShadow`; unchanged)
       - the AO authority (0.95 -> 0.30 -> 0 via `setAo`; the plate
         survived all three and `setAo(0)` darkened the whole level
         by 15% of luma, so the composite does not handle a disabled
         AO pass gracefully)

     The A/B that appeared to implicate AO was invalid twice over: its
     mutations were applied CUMULATIVELY without resetting between
     shots, and - the one that matters - it framed the shot with
     `setPose("eye-basecamp")` while the artefact only appears in the
     shots harness's `--eye` mode, which SEARCHES for its own standing
     point. Those are two different cameras. The frame I was A/Bing
     never contained the plate.

     Repro for whoever picks this up: `saintfall-shots.mjs --eye`, the
     `eye-basecamp` frame. A raycast into it returns terrain-3-7-l0 /
     sf-snow at 5-12m, so it is not a prop, a collar or a decal. */
  u.uContactGain.value.y = 0.62;
  /* VIGNETTE. Vesper's 0.30 is a desert convention - it holds the
     eye in a frame with no natural edges. On a mountain the
     silhouette IS the edge, and a heavy vignette darkens exactly
     the corners where the cloud sea and the far ridges live. */
  if (u.uVignette && u.uVignette.value) u.uVignette.value.set(0.16, 0.42);

  /* THE LENS HALO. A warm bloom flare around the sun, which on a
     level whose sun sits 7 degrees above a white horizon veils the
     whole upper frame. Nearly off. */
  if (u.uHaloAmount) u.uHaloAmount.value = 0.02;
}

/* ============================================================
   THE ONE STUB

   ui.js:164 gates the entire field interface on ctx.mission and
   returns a no-op object without it - which would cost this level
   its Esc/Tab menu, its settings panel, its quality switch and
   its map. So a mission object exists. It is INERT: no orders, no
   wheel, no bosses, no save. `bus.on` must return an unsubscribe
   function or ui.js's teardown throws.
   ============================================================ */
function makeVigilStub() {
  return {
    wheelOrder: [],
    stratagems: {},
    cooldowns: {},
    bosses: [],
    state: { phase: "vigil", bossesDone: 0, deaths: 0, elapsed: 0 },
    objective: () => ({
      title: "THE ASCENT",
      detail: "Reach the Cathedral of the Ninth Ascent.",
    }),
    call: () => false,
    bus: { on: () => () => {}, emit: () => {} },
    snapshot: () => null,
    restore: () => true,
    /* combat.respawn() reads `ctx.mission.spawn.x/z` UNGUARDED - on
       the campaign the mission always exists and always has a drop
       point. With combat built on this level, the stub must carry
       one too or the first death throws at the revive. */
    spawn: { x: BASECAMP.x, z: BASECAMP.z },
  };
}

/* ============================================================
   START
   ============================================================ */

export async function start({ boot, build } = {}) {
  const params = new URLSearchParams(window.location.search);
  const qa = params.has("qa");
  if (boot) boot.progress(0.08, qa ? "Selecting review operative" : "Choose your Vigil");
  const character = await chooseSummitCharacter({ params, qa });
  const seed = params.has("seed")
    ? (hashString(params.get("seed")) >>> 0) : 0x5e17fa11;
  const timeKey = resolveTime(params.get("time"));
  const qualityParam = params.get("quality");
  const cycleParam = params.get("cycle");
  /* Same contract as Vesper's: an explicit ?time= pins the hour, so
     a harness that asks for alpenglow gets alpenglow and not
     whatever the clock has drifted to. */
  const cycleEnabled = cycleParam === "1"
    || (!qa && cycleParam !== "0" && !params.has("time"));
  const cyclePhase = params.has("cyclePhase") ? Number(params.get("cyclePhase")) : NaN;

  const canvas = document.getElementById("sf-canvas");
  const hudHost = document.getElementById("sf-hud");
  const touchHost = document.getElementById("sf-touch");
  const stage = document.querySelector(".sf-stage");

  const progress = (v, label) => { if (boot) boot.progress(clamp01(v), label); };

  /* ---------------------------- context ---------------------------- */

  progress(0.16, "Reading the sky");
  const atmos = makeSummitAtmosphere(THREE, timeKey, {
    cycle: cycleEnabled,
    phase: Number.isFinite(cyclePhase) ? cyclePhase : undefined,
  });
  applySummitWind(atmos);

  const ctx = {
    THREE,
    seed,
    build,
    atmos,
    /* The naming table. summit-hud reads it, vfx.js probes it for a
       `cathedral` key it will not find (guarded), and every module
       that asks "where am I" asks this. */
    districts: STATIONS,
    qa,
    playerFigureFactory: character.factory,
    playerFigureName: character.name,
    playerCharacter: {
      id: character.id,
      name: character.name,
      designation: character.designation,
      accent: character.accent,
    },
    runtime: { phase: "playing", paused: false, handoffFrames: 0 },
  };

  ctx.difficulty = buildDifficulty();
  ctx.difficulty.set(readStoredSettings().difficulty, "settings");

  progress(0.20, "Opening the eye");
  const render = createRenderer(ctx, canvas);
  /* NEVER ASSIGNED IN main.js, and two modules optional-chain it:
     hud.js reads ctx.render?.renderer?.domElement for the reticle
     projection and falls back to a hardcoded 720px, and
     undercroft.js calls ctx.render?.requestShadowUpdate?.(), which
     is therefore a permanent no-op in the shipped game. Setting it
     here is a summit-side fix; main.js is left alone. */
  ctx.render = render;
  ctx.scene = render.scene;
  ctx.camera = render.camera;

  ctx.materials = makeSummitMaterials(THREE, atmos);
  render.applyAtmosphere(atmos);
  applySummitPostChain(render);

  progress(0.24, "Hanging the halo");
  const sky = buildSummitSky(ctx);
  ctx.sky = sky;
  render.refreshEnvironment(atmos);

  progress(0.28, "Raising Kenosis");
  ctx.field = makeSummitField(seed);
  const terrain = await buildSummitTerrain(ctx, (v) => progress(0.28 + v * 0.34, "Raising Kenosis"));
  ctx.terrain = terrain;

  const world = await buildSummitWorld(ctx, (v, label) => progress(0.62 + v * 0.24, label || "Dressing the stations"));
  ctx.world = world;

  /* THE MOULIN FLOOR OVERRIDE, and it is published under the key
     collide.js reads BY NAME (`ctx.undercroft.groundOverrideAt`).
     Reusing the hard-coded name is what lets a second world have
     holes in its floor without editing the collider - the same
     mechanism the Undercroft uses under Vesper's cathedral, which
     is the only way a cavern exists in a height-field game. */
  if (terrain.groundOverride) ctx.undercroft = terrain.groundOverride;

  progress(0.88, "Setting the stones against you");
  ctx.collide = buildCollision(ctx, world);

  progress(0.90, "Raising the wind");
  ctx.vfx = buildVfx(ctx, world);

  /* KENOSIS DOES NOT HAVE A DESERT IN IT.

     buildVfx unconditionally builds Vesper's three ambient fields -
     `dust`, `grit` and the wind `streamers` - and they are not
     neutral atmosphere, they are SAND: colours #c8ab84/#9c7050 and
     #c39c6c/#8a5638, normal-blended, in a 110m box around the
     camera. Against warm dune they are invisible. Against a pale
     alpine sky they are a scatter of dark brown specks across the
     upper half of every frame, and on the first parvis capture they
     read as broken geometry - a raycast through them returns
     nothing, because they are points, which is exactly why the
     defect is hard to name from a screenshot.

     Hidden rather than removed: everything else buildVfx owns is
     wanted here - the impact pool, the pooled decals and footprints,
     the plume emitters that carry the fumarole steam and the nine
     brazier flames - and this level supplies its own three fields
     through summit-weather instead. */
  for (const name of ["dust", "grit", "streamers"]) {
    const obj = ctx.vfx.group && ctx.vfx.group.getObjectByName(name);
    if (obj) obj.visible = false;
  }

  ctx.weather = buildSummitWeather(ctx, world);

  progress(0.93, "Making landfall");
  const player = await createPlayer(ctx, canvas);
  ctx.player = player;
  /* createPlayer spawns once at Vesper's default on construction,
     so the real spawn has to follow immediately or the first frame
     is measured 900m away over ground that does not exist here. */
  player.spawn(BASECAMP.x, BASECAMP.z, BASECAMP.yaw);

  progress(0.945, "Arming the vigil");
  ctx.playerLoadout = await buildSummitLoadout(ctx, player);
  /* player.js reads the carry rules through `ctx.loadout`, and reads
     it optional-chained, so this is the whole wiring: how a shield
     arm braces and how much stroke each hand keeps. */
  ctx.loadout = ctx.playerLoadout;

  /* -------------------- the combat stack (m107) --------------------
     The campaign's own modules, in the campaign's own dependency
     order: audio first (so every build below may cue it), then the
     bestiary - FILTERED: `ctx.enemyRoster` keeps the trials to the
     three ordinary castes so this page does not download seven boss
     rigs - then combat over it, then the two charge verbs the kits
     and the page's own "How to play" promise. Everything here reads
     the wider game optional-chained, which is why the same files run
     both worlds. */
  ctx.audio = buildAudio(ctx);
  progress(0.947, "Waking the trial castes");
  ctx.enemyRoster = ["thresher", "gleaner", "harrow"];
  ctx.enemies = await buildEnemies(ctx, (f, label) => {
    progress(0.947 + clamp01(f) * 0.006, label);
  });
  ctx.combat = buildCombat(ctx);
  ctx.combat.bus.on("playerDied", () => player.die());
  ctx.boost = buildBoost(ctx, player);
  ctx.slam = buildSlam(ctx, player);

  /* THE OPERATIVE KIT - the level's doctrine module. Built after the
     loadout (it wraps the carry hooks and publishes `meleeSpec`) and
     before the discharge (which takes its weapon numbers from the
     kit). The Bastion's kit brings its own `ctx.shield`: the tower
     shield rides the same contract the Aegis does, so the player
     controller's shield walk and combat's hurtPlayer intercept both
     engage without either knowing the difference. */
  /* THE DOCTRINE, BEFORE THE KIT THAT READS IT. The kit asks the
     doctrine for its numbers (`doctrine.kit(...)`) and reports its
     verbs to it (`doctrine.verb(...)`), so the doctrine has to exist
     first. `ctx.progression` is the name ui.js's board and audio's
     cue subscriber both look for - this level's doctrine answers the
     same contract the campaign's does. */
  ctx.doctrine = buildSummitDoctrine(ctx, player);
  ctx.progression = ctx.doctrine;
  if (ctx.doctrine) {
    /* Publish this operative's Orders into the VFX vocabulary. The
       style `id` claims one of the five doctrine mote channels and
       repoints it at the Order's own colour - Vesper's Orders are
       never on screen here, so nothing is taken from anyone. */
    const tree = KENOSIS_TREES[ctx.doctrine.treeId];
    const styles = {};
    tree.orders.forEach((order, index) => {
      styles[order.id] = { ...order.art, id: 6 + index, family: "kenosis" };
    });
    ctx.vfx.registerDoctrineOrders?.(styles);
  }

  ctx.kenosis = buildKenosisKit(ctx, player, ctx.playerLoadout);
  if (ctx.kenosis?.blockModule) ctx.shield = ctx.kenosis.blockModule;
  ctx.playerDischarge = buildSummitDischarge(ctx, player, ctx.playerLoadout,
    ctx.kenosis?.dischargeSpec);
  let lastShotCount = 0;

  /* Audio wants a user gesture before the context runs, and this
     level has no intro to provide one - the first press or pointer
     down is it. */
  const unlockAudio = () => {
    ctx.audio?.unlock?.({ ambience: false })?.catch?.(() => {});
    window.removeEventListener("pointerdown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
  };
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);

  /* THE JETPACK, and on this level it is traversal rather than
     a combat mobility tool.

     Kenosis is 452m tall and its Via Sacra is 4.9km long. Vesper is
     a basin you can cross on foot in a couple of minutes; here a
     player who wants to look at the Bell Terrace and then the
     Fumarole Steps is asking for a twenty-minute walk, and the
     climb is the level's subject rather than its content. The pack
     is what makes the vertical readable from the inside.

     It costs three lines because player.js already drives it: the
     input chord is decoded there (`state.jetpack = (state.jump &&
     shift)`, player.js:2063), the flight physics live in the
     controller, and every one of the module's own reads of the wider
     game - combat, mission, progression, weapons, boost, shield,
     slam, audio - is optional-chained, so it runs unchanged against
     this level's much smaller ctx. What it needs from here is to
     exist, to be on `ctx`, and to have its visual ticked.

     Shift + Space to fly; the charge recharges after 2.5s on the
     ground.

     THE TANK IS UNLIMITED ON THIS LEVEL WHILE IT IS BEING BUILT.
     Kenosis is 2 km across with 452 m of climb and no fast travel,
     and every content pass means getting to a station, looking at
     it, and getting to the next one. A 9-second tank makes that the
     slowest part of the work. `?fuel=limited` restores the real
     economy for anyone testing the flight model itself, and this
     constant is the one line to flip when the level ships. */
  const UNLIMITED_JETPACK = params.get("fuel") !== "limited";
  ctx.jetpack = buildJetpack(ctx, player, { unlimitedFuel: UNLIMITED_JETPACK });

  /* ------------------------- the trials ground -------------------------
     Sited at boot rather than authored: seventy metres out from
     basecamp - clear of the trials' own 40m wake radius, so arriving
     at the gate is quiet and walking to the yard is the consent -
     along whichever of eight bearings is flattest and most level
     with the pads, so a terrain pass never silently buries the yard
     in a drift or hangs it over the moraine. */
  progress(0.955, "Marking the trial yard");
  const trialYard = (() => {
    const g0 = ctx.collide.groundHeight(BASECAMP.x, BASECAMP.z);
    let best = null;
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      const x = BASECAMP.x + Math.sin(a) * 70;
      const z = BASECAMP.z + Math.cos(a) * 70;
      const g = ctx.collide.groundHeight(x, z);
      let spread = 0;
      for (const [ox, oz] of [[8, 0], [-8, 0], [0, 8], [0, -8]]) {
        spread = Math.max(spread,
          Math.abs(ctx.collide.groundHeight(x + ox, z + oz) - g));
      }
      const score = Math.abs(g - g0) * 0.5 + spread;
      if (!best || score < best.score) best = { x, z, score };
    }
    return best;
  })();
  ctx.trials = buildSummitTrials(ctx, player, {
    x: trialYard.x,
    z: trialYard.z,
    homeX: BASECAMP.x,
    homeZ: BASECAMP.z,
    homeYaw: BASECAMP.yaw,
  });
  /* Wire the ear last: attach() subscribes to whatever buses exist,
     and by now combat does. */
  ctx.audio.attach();

  progress(0.96, "Opening the operation");
  const hud = buildSummitHud(ctx, hudHost);
  ctx.hud = hud;
  /* The reticle belongs to a figure that has something to aim. Set
     here and not beside the discharge, because `hud` is a const
     declared further down and reaching it earlier is a dead-zone
     throw, not an undefined. The Bastion aims too now - the hammer
     cast flies at the crosshair. */
  hud.setReticle?.(!!ctx.playerDischarge?.status?.()?.supported
    || ctx.playerCharacter?.id === "bastion-penitent");
  const touch = buildTouchControls(ctx, player, touchHost, stage);
  ctx.touch = touch;
  ctx.mission = makeVigilStub();
  /* THE COMMAND WHEEL. Built after the stub and merged ONTO it, not
     instead of it: `combat.respawn()` reads `ctx.mission.spawn.x/z`
     unguarded and `ui.js` refuses to build at all without a mission,
     so the stub stays the object and the command layer supplies the
     four fields the wheel, combat and the pack actually read.

     Also published as `ctx.command`, because the doctrine's call
     Orders reach it by name - `ctx.mission` is the campaign's word
     for a phase machine this level does not have. */
  ctx.command = buildSummitCommand(ctx, player, {
    characterId: ctx.playerCharacter?.id,
  });
  if (ctx.command) {
    ctx.mission.wheelOrder = ctx.command.wheelOrder;
    ctx.mission.stratagems = ctx.command.stratagems;
    ctx.mission.cooldowns = ctx.command.cooldowns;
    ctx.mission.call = ctx.command.call;
    ctx.mission.boon = ctx.command.boon;
    ctx.mission.grantBoon = ctx.command.grantBoon;
    ctx.mission.blocksEnemyProjectile = ctx.command.blocksEnemyProjectile;
    ctx.mission.pending = ctx.command.pending;
    ctx.mission.activeFields = ctx.command.activeFields;
    ctx.mission.announce = ctx.command.announce;
    ctx.mission.bus = ctx.command.bus;
  }

  /* ---------------------------- shell ---------------------------- */

  function setQuality(tier) {
    const t = normalizeQuality(tier);
    /* The sky is the SECOND argument and it is not optional. Without
       it render.js skips its whole shadow block, and the sun keeps
       the boot defaults this module set for a 452m mountain: a 900m
       half-span on a 2048 map. That is 0.88m per shadow texel, so
       `applyShadowBias` derives a 1.27m normalBias - and a 1.27m push
       along the normal at a 24-degree sun moves the shadow lookup
       2.86m across the ground. The player is 1.8m tall. Every prop,
       every drift lip and the player's own cast shadow were pushed
       clean out of their own shadow, which is why turning shadows off
       measured as no change at all: there was nothing there to turn
       off. Passing `sky` lets the tier table size the map (ultra is
       8192 at a 340m span - 0.083m per texel), and setShadowRadius
       re-derives both biases from it. */
    render.setQuality(t, sky);
    /* setQuality writes uAo.x - the occlusion STRENGTH, which
       belongs to the hardware tier - and leaves the grade's own
       ao pair alone. But it does not know about the four white-
       scene uniforms, so they are re-applied after it. */
    applySummitPostChain(render);
    return t;
  }

  const gameUi = buildGameUi(ctx, {
    stage, canvas, save: undefined, touch, render, setQuality,
  });
  ctx.gameUi = gameUi;

  function resize() {
    const w = (stage ? stage.clientWidth : window.innerWidth) || window.innerWidth;
    const h = (stage ? stage.clientHeight : window.innerHeight) || window.innerHeight;
    render.resize(w, h);
  }
  window.addEventListener("resize", resize);
  resize();

  function setTime(key) {
    const k = resolveTime(key);
    atmos.apply(k, atmos.storm);
    render.applyAtmosphere(atmos);
    render.syncEnvironment(atmos);
    applySummitPostChain(render);
    sky.refresh();
    render.requestShadowUpdate?.();
  }

  function setDayCycle(phase = atmos.cyclePhase, running = true, cycleCount = atmos.cycleCount) {
    atmos.setCyclePhase(phase, running, cycleCount);
    render.applyAtmosphere(atmos);
    render.syncEnvironment(atmos);
    applySummitPostChain(render);
    sky.refresh();
    render.requestShadowUpdate?.();
    return atmos.cycleStatus();
  }

  function setStorm(v) {
    atmos.setStorm(clamp01(v));
    ctx.weather.setStorm(clamp01(v));
    render.applyAtmosphere(atmos);
    applySummitPostChain(render);
    sky.refresh();
  }

  /* --------------------------- the loop --------------------------- */

  const runtimePauseReasons = { menu: false, visibility: false, command: false };
  function syncRuntimePaused() {
    runtimePauseReasons.menu = document.body.classList.contains("rb-escape-menu-open");
    runtimePauseReasons.visibility = document.hidden;
    runtimePauseReasons.command = document.body.classList.contains("sf-command-open");
    if (ctx.runtime.phase !== "playing") return ctx.runtime.paused;
    const next = Object.values(runtimePauseReasons).some(Boolean);
    if (next !== ctx.runtime.paused) {
      ctx.runtime.paused = next;
      if (next) player.input.clearAll?.();
    }
    return next;
  }
  const pauseObserver = new MutationObserver(syncRuntimePaused);
  pauseObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", syncRuntimePaused);
  syncRuntimePaused();

  function step(d0, draw = true) {
    /* CLAMPED HERE, not by the caller. qa.js's renderStill() calls
       api.step(0, true) and every harness passes its own dt, so a
       clamp anywhere else is a clamp that can be bypassed. */
    const d = Math.min(Math.max(d0, 0), 0.1);
    player.update(d, render.camera);
    const changed = sky.update(d, render.camera);
    if (changed) {
      render.applyAtmosphere(atmos);
      render.syncEnvironment(atmos);
      applySummitPostChain(render);
    }
    terrain.updateLod(render.camera);
    player.postUpdate?.(d);
    /* The arm solver raises both hands first; the mount then resolves
       its blade-forward firing orientation against those live palms;
       only after both are final may a pulse read its emitter socket. */
    ctx.playerLoadout.update?.(d);
    /* The kit is this level's input router (the campaign's main.js
       drain loop is not here) and the hammer cast reads the posed
       hand, so it runs after the solve and before the discharge. */
    ctx.kenosis?.update?.(d);
    ctx.playerDischarge.update(d);
    /* The campaign's own order: combat drives every enemy decision
       and the player's regen; the trials then manage what exists to
       decide about; crowding resolves the shared body space once;
       and the bestiary's animation pass runs against final
       positions. */
    /* BEFORE combat. A beacon's lure and a lingering field's slow are
       both written onto enemies and then READ by combat's decision
       pass in the same frame - reversed, every command is one frame
       stale and the Choir visibly fails to hold anything. */
    ctx.command?.update?.(d);
    ctx.combat?.update?.(d);
    ctx.doctrine?.update?.(d);
    ctx.trials?.update?.(d);
    ctx.enemies?.resolveCrowding?.(player.state);
    ctx.enemies?.update?.(d, render.camera);
    /* AFTER postUpdate, exactly as main.js:1016 has it. The pack's
       nozzles and plume are parented to the figure's rig, so a
       visual tick before the pose is resolved draws last frame's
       flame on this frame's back. */
    ctx.jetpack.updateVisual(d);
    ctx.vfx.update(d, render.camera);
    ctx.weather.update(d, render.camera);
    ctx.audio?.update?.(d, player, render.camera);
    touch.update?.(d);
    /* The reticle belongs to a figure that has something to aim, and
       its kick is the only feedback a discharge with no impact yet
       gives back. `fired` is a running count, so a rise in it is a
       shot that actually left the weapon this frame. */
    const shotCount = ctx.playerDischarge?.status?.()?.fired ?? 0;
    if (shotCount > lastShotCount) {
      hud.reticleKick?.(0.9);
      lastShotCount = shotCount;
    }
    hud.update(d, player, render.camera);
    gameUi.update?.(d);
    if (draw) render.render(render.camera);
  }

  function frame(dt, draw = true) {
    if (ctx.runtime.paused) {
      gameUi.update?.(0);
      if (draw) render.render(render.camera);
      return;
    }
    step(dt, draw);
  }

  const frameStat = makeStat(180);
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    const rawMs = now - last;
    const dt = Math.min(0.1, rawMs / 1000);
    last = now;
    const t0 = performance.now();
    frame(dt, true);
    const ms = performance.now() - t0;
    frameStat.push(ms);
    api.frameMs = frameStat.mean();
    api.fps = api.frameMs > 0 ? 1000 / Math.max(api.frameMs, 1e-3) : 0;
    /* RAW rAF SPACING, not the clamped dt: a fill-bound frame spends
       its overrun in the compositor, where a timer straddling
       frame() never sees it. Skipped while hidden or the controller
       reads a backgrounded tab as a 1fps machine. */
    if (!document.hidden) render.tickAutoScale(rawMs);
  }

  /* ---------------------------- the api ---------------------------- */

  const api = {
    ready: false,
    render, sky, terrain, world,
    vfx: ctx.vfx, weather: ctx.weather,
    player, collide: ctx.collide, hud, touch, gameUi,
    jetpack: ctx.jetpack,
    loadout: ctx.playerLoadout,
    discharge: ctx.playerDischarge,
    kenosis: ctx.kenosis,
    doctrine: ctx.doctrine,
    progression: ctx.doctrine,
    trials: ctx.trials,
    combat: ctx.combat,
    enemies: ctx.enemies,
    audio: ctx.audio,
    boost: ctx.boost,
    slam: ctx.slam,
    shield: ctx.shield || null,
    runtime: ctx.runtime,
    fps: 0, frameMs: 0,
    resize, step, frameOnce: frame,
    setTime, setDayCycle, setStorm, setQuality,
    /* qa.js touches these on a full build; present and inert here so
       a shared harness does not have to branch. */
    intro: null, tutorial: null,
  };

  setQuality(qualityParam || readStoredSettings().quality || "high");

  const hook = installQa(ctx, api);
  installSummitQa(ctx, api, hook);

  /* ------------------------- warm, then reveal -------------------------
     Same discipline as main.js. A light appearing or a material
     compiling on the frame it first becomes visible is a measured
     198ms freeze; on this level the first frame contains nine
     brazier lights and thirteen material variants at once. */
  progress(0.985, "Consecrating the ascent");
  try {
    const warmed = await render.warmShaders(render.camera, render.scene);
    if (qa) console.info("[white-vigil] shader warm-up", warmed);
  } catch (err) {
    console.warn("[white-vigil] shader warm-up skipped:", err && err.message);
  }

  /* A few real frames under the loader, so the first thing anyone
     sees is a composed image rather than a black canvas - and so the
     LOD selector has run at least once. Every LOD mesh is built
     invisible with chunk.active = -1; a harness that photographs
     before the first step captures empty sky and reports a build
     failure. */
  for (let i = 0; i < 4; i += 1) step(1 / 60, true);

  progress(1, "Ready");
  if (boot) await boot.hide();
  api.ready = true;
  requestAnimationFrame(loop);
  return api;
}
