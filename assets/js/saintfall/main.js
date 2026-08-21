/* ============================================================
   SAINTFALL - entry point

   Builds the context every module shares, in the one order that
   works: atmosphere before materials (they hold its uniforms),
   materials before terrain (it needs one), terrain before world
   (it stands on it), world before VFX (it emits from it).
   ============================================================ */

import * as THREE from "three";
import { makeStat, hashString, clamp01 } from "saintfall/core.js";
import { makeAtmosphere, makeMaterials, TIMES } from "saintfall/art.js";
import { createRenderer } from "saintfall/render.js";
import { buildSky } from "saintfall/sky.js";
import {
  buildTerrain, makeHeightField, DISTRICTS, DROP_SITE,
} from "saintfall/terrain.js";
import { buildWorld } from "saintfall/world.js";
import { loadIntroVehicleModels } from "saintfall/intro-models.js";
import { buildPod } from "saintfall/pod.js";
import { buildVfx } from "saintfall/vfx.js";
import { createPlayer } from "saintfall/player.js";
import { buildJetpack } from "saintfall/jetpack.js";
import { buildBoost } from "saintfall/boost.js";
import { buildSlam } from "saintfall/slam.js";
import { buildShield } from "saintfall/shield.js";
import { buildEnemies } from "saintfall/enemies.js";
import { buildCollision } from "saintfall/collide.js";
import { buildCombat } from "saintfall/combat.js";
import { buildMission } from "saintfall/mission.js";
import { buildBreaches } from "saintfall/breaches.js";
import { buildAbbess } from "saintfall/abbess.js";
import { buildCoulter } from "saintfall/coulter.js";
import { buildDistaff } from "saintfall/distaff.js";
import { buildGarner } from "saintfall/garner.js";
import { buildMatriarch } from "saintfall/matriarch.js";
import { buildStylite } from "saintfall/stylite.js";
import { buildWinnower } from "saintfall/winnower.js";
import { buildDistrictBosses } from "saintfall/district-bosses.js";
import { buildApostate } from "saintfall/apostate.js";
import { buildUndercroft } from "saintfall/undercroft.js";
import { buildProgression } from "saintfall/progression.js";
import { buildAudio } from "saintfall/audio.js";
import { buildWeapons } from "saintfall/weapons.js";
import { buildHud } from "saintfall/hud.js";
import { buildTouchControls } from "saintfall/touch.js";
import { buildTutorial } from "saintfall/tutorial.js";
import { buildDropIntro } from "saintfall/intro.js";
import { buildSaveSystem } from "saintfall/save.js";
import { buildGameUi, readStoredSettings } from "saintfall/ui.js";
import { buildDifficulty } from "saintfall/difficulty.js";
import { installQa } from "saintfall/qa.js";

export async function start({ boot, build } = {}) {
  const params = new URLSearchParams(window.location.search);
  /* Temporary encounter shortcut for hands-on Apostate testing. Treat it as
     QA even without `?qa=1`, so the isolated fight cannot overwrite a real
     field save or award durable career progress. */
  const apostateTestStart = params.get("boss") === "apostate";
  const qa = params.has("qa") || apostateTestStart;
  const introParam = params.get("intro");
  const tutorialParam = params.get("tutorial");
  /* Existing QA harnesses expect assets-ready to mean immediately
     playable. Normal players get the cinematic; QA opts into it
     explicitly with ?qa=1&intro=force. */
  const introEnabled = introParam !== "0" && introParam !== "skip"
    && (!qa || introParam === "1" || introParam === "force");
  // A frozen clock is a deterministic QA instrument, never a player URL mode.
  const introManualClock = qa && params.get("introClock") === "manual";
  /* Production new operations receive orientation by default. Existing QA
     URLs retain their direct-gameplay contract and opt in explicitly. */
  const tutorialForced = tutorialParam === "1" || tutorialParam === "force";
  const tutorialEnabled = tutorialParam !== "0" && tutorialParam !== "skip"
    && (!qa || tutorialForced);
  /* A `?quality=` URL value is a SESSION override - harnesses pin a tier
     with it, and it must not write itself into the player's stored
     preference. Absent the param, the tier comes from the settings
     store (read once gameUi exists, below) and defaults to high. */
  const qualityParam = params.get("quality");
  /* Same contract for difficulty: `?difficulty=` runs the session at a
     tier without touching the stored preference (the duel probe pins
     tiers with it); absent the param, the stored preference applies. */
  const difficultyParam = params.get("difficulty");
  const timeKey = params.get("time") || "goldenhour";
  const cycleParam = params.get("cycle");
  const cycleEnabled = cycleParam === "1"
    || (!qa && cycleParam !== "0" && !params.has("time"));
  const cyclePhase = params.has("cyclePhase") ? Number(params.get("cyclePhase")) : NaN;
  const seed = params.has("seed") ? (hashString(params.get("seed")) >>> 0) : 0x5a17fa11;

  const canvas = document.getElementById("sf-canvas");
  const hudHost = document.getElementById("sf-hud");
  const touchHost = document.getElementById("sf-touch");
  const stage = document.querySelector(".sf-stage");

  const progress = (v, label) => { if (boot) boot.progress(clamp01(v), label); };

  /* ----------------------------- context ----------------------------- */

  progress(0.18, "Reading the sky");
  const atmos = makeAtmosphere(THREE, TIMES[timeKey] ? timeKey : "goldenhour", {
    cycle: cycleEnabled,
    phase: Number.isFinite(cyclePhase) ? cyclePhase : undefined,
  });

  const ctx = {
    THREE,
    seed,
    build,
    atmos,
    districts: DISTRICTS,
    qa,
    deferAmbience: introEnabled,
    runtime: {
      phase: introEnabled ? "awaiting-deploy" : "playing",
      paused: false,
      handoffFrames: 0,
    },
  };

  /* The tier has to be in force before the garrison is spawned, because
     enemy health is scaled at spawn - so it is read from the settings
     store here, ahead of the menu that owns that store. */
  ctx.difficulty = buildDifficulty();
  ctx.difficulty.set(difficultyParam || readStoredSettings().difficulty,
    difficultyParam ? "url" : "settings");

  progress(0.22, "Opening the eye");
  const render = createRenderer(ctx, canvas);
  ctx.scene = render.scene;
  ctx.camera = render.camera;
  ctx.materials = makeMaterials(THREE, atmos);
  render.applyAtmosphere(atmos);

  progress(0.26, "Hanging the halo");
  const sky = buildSky(ctx);
  ctx.sky = sky;
  render.refreshEnvironment(atmos);
  /* The visible gradient, grade and zero-shadow sky fill follow the
     cycle continuously. The one convolved reflection map is built at
     boot and fades beneath that live fill; no periodic GPU bake is
     allowed to hitch an active fight. */
  function advanceSky(dt, camera) {
    const changed = sky.update(dt, camera);
    if (changed) {
      render.applyAtmosphere(atmos);
      render.syncEnvironment(atmos);
    }
    return changed;
  }

  progress(0.30, "Shaping the basin");
  ctx.field = makeHeightField(seed);
  const terrain = await buildTerrain(ctx, (v) => progress(0.30 + v * 0.30, "Shaping the basin"));
  ctx.terrain = terrain;

  const world = await buildWorld(ctx, (v, label) => progress(0.60 + v * 0.32, label));
  ctx.world = world;

  /* The landed pod contributes its own shipped triangles to collision,
     so the authored vehicle assets must resolve before the raster is baked.
     Production also loads the carrier and sealed pod for the orbital act;
     direct-gameplay QA only pays for the open world landmark. */
  progress(0.921, "Consecrating the descent vehicles");
  ctx.introVehicles = await loadIntroVehicleModels(ctx, { includeFlight: introEnabled });

  /* The lander is built ONCE, here, in its landed pose - not by the
     cinematic. The intro borrows it, flies it down and hands it back
     at the same transform, so the object the player walks away from
     is literally the object they arrived in. Building it before
     collision is what lets the rasteriser bake it as an obstacle;
     building it before the player is what lets the spawn be measured
     off the real gangway instead of a guess. */
  progress(0.923, "Setting the lander down");
  const pod = buildPod(ctx, {
    x: DROP_SITE.podX, z: DROP_SITE.podZ, yaw: DROP_SITE.podYaw,
  });
  ctx.pod = pod;

  progress(0.925, "Setting the stones against you");
  const collide = buildCollision(ctx, world);
  ctx.collide = collide;

  progress(0.93, "Raising the wind");
  const vfx = buildVfx(ctx, world);
  ctx.vfx = vfx;

  progress(0.94, "Reading the Bloom");
  const enemies = await buildEnemies(ctx, (v, label) => progress(0.94 + v * 0.02, label));
  ctx.enemies = enemies;
  // Both factions take up their positions. Without this the models
  // load, cost their memory, and never appear in the level at all -
  // which is exactly what was happening: every enemy shot in the
  // review came from a harness that spawned its own subject, so the
  // level itself had been empty the whole time and nothing measured
  // it, because nothing was looking at the level for enemies.
  enemies.garrison();

  progress(0.96, "Making landfall");
  const player = await createPlayer(ctx, canvas);
  ctx.player = player;
  /* The drop lands ON THE CAUSEWAY, facing up it toward the
     cathedral. It used to land at x -12, which is 28m off the road on
     the shoulder above it - a hillside, with the road visible below
     and a rise close enough in front to stop a shot at 13m. */
  player.spawn(DROP_SITE.x, DROP_SITE.z, DROP_SITE.yaw);

  const weapons = buildWeapons(ctx);
  ctx.weapons = weapons;
  weapons.equip("autogun", player.figure.weaponMount);

  const jetpack = buildJetpack(ctx, player);
  ctx.jetpack = jetpack;

  progress(0.97, "Opening the operation");
  const combat = buildCombat(ctx);
  ctx.combat = combat;
  const mission = buildMission(ctx);
  ctx.mission = mission;
  const breaches = buildBreaches(ctx);
  ctx.breaches = breaches;
  const shield = buildShield(ctx, player);
  ctx.shield = shield;
  const boost = buildBoost(ctx, player);
  ctx.boost = boost;
  const slam = buildSlam(ctx, player);
  ctx.slam = slam;
  /* The burrower owns its own behaviour, its projectiles and the venom
     they leave. Built after combat because it damages through it, and
     before audio because audio subscribes to its bus. */
  const coulter = buildCoulter(ctx);
  ctx.coulter = coulter;
  /* The Glass Scar's own guardian: a district-bound encounter rather
     than a breach-wave one, so it is built and spawned independently
     of both. Same ordering reasons as the burrower - after combat,
     which it damages the player through, and before audio, which
     subscribes to its bus. */
  const distaff = buildDistaff(ctx);
  ctx.distaff = distaff;
  distaff.ensureSpawned();
  /* The Censer Works' flyer. Same construction slot and the same
     reasons as the Distaff - after combat, before audio. */
  const winnower = buildWinnower(ctx);
  ctx.winnower = winnower;
  winnower.ensureSpawned();
  /* The Ossuary's pit. Same construction slot and the same reasons
     again - after combat, before audio - with one addition of its own:
     it builds its entire body procedurally at construction time, so it
     must not be created before the collision grid exists. Every plate
     of the crater is laid against `collide.groundHeight`. */
  const garner = buildGarner(ctx);
  ctx.garner = garner;
  garner.ensureSpawned();
  /* The Bloom's queen. Same construction slot and the same reasons -
     after combat, which she damages the player through and whose egg
     tests call back into her, and before audio, which subscribes to
     her bus. */
  const abbess = buildAbbess(ctx);
  ctx.abbess = abbess;
  abbess.ensureSpawned();
  /* The Choir's tenant. Same construction slot as the rest - after
     combat, which wears its grip, and before audio - with one extra
     dependency of its own: it perches on the world builder's own list
     of standing needles, so it must be built after the world. */
  const stylite = buildStylite(ctx);
  ctx.stylite = stylite;
  stylite.ensureSpawned();
  /* Shared lifecycle for the ordinary-simulation district guardians plus
     the penultimate giant Coulter beneath the Fallen Saint. */
  const districtBosses = buildDistrictBosses(ctx);
  ctx.districtBosses = districtBosses;
  /* The Gilded Reach's mantis. The one boss whose LIFECYCLE stays with
     the shared controller above - it is still a `domain: "district"`
     site, still in that snapshot, still reset by that arena ring - and
     whose BEHAVIOUR is its own. Built after districtBosses because the
     animal it drives is the one districtBosses spawns. */
  const matriarch = buildMatriarch(ctx);
  ctx.matriarch = matriarch;
  /* The Cathedral's false saint borrows the authored player figure but owns
     an entirely separate combat brain. It is asynchronous because the same
     GLB/fallback figure contract is loaded for a second, corrupted body. */
  const apostate = await buildApostate(ctx);
  ctx.apostate = apostate;
  apostate.ensureSpawned();
  /* The room under the Cathedral. Built after the boss because it
     drives that body through the collapse, and after collision
     because its floor is measured off the nave's - and it is the one
     module in this list that owns a `groundHeight` override, so
     nothing that reads the ground may be constructed after it
     without expecting the answer to move. */
  const undercroft = buildUndercroft(ctx);
  ctx.undercroft = undercroft;

  if (apostateTestStart) {
    const armed = mission.snapshot();
    armed.phase = "cathedralBoss";
    armed.extractCalled = false;
    armed.extractTimer = 0;
    armed.relays = armed.relays.map((relay) => ({
      ...relay,
      done: true,
      progress: 1,
    }));
    armed.relaysDone = armed.relays.length;
    mission.restore(armed);
    apostate.reset();

    const boss = apostate.status();
    const bossInst = apostate.instance();
    /* The Cathedral garrison belongs to the full operation, but it obscures
       a direct boss test and can kill the player during the reveal. Keep the
       Apostate itself; its Call ability still creates its authored brood. */
    for (const enemy of [...enemies.live]) {
      if (enemy === bossInst) continue;
      if (Math.hypot(enemy.x - boss.x, enemy.z - boss.z) <= 96) enemies.remove(enemy);
    }
    player.spawn(boss.x - 18, boss.z, 0);
  }

  /* Career rank and Doctrine choices sit above the field systems they
     observe. Constructing progression here lets it subscribe to authoritative
     combat/mission events while every lower-level mechanic can still query
     `ctx.progression` lazily without creating import cycles. */
  const progression = buildProgression(ctx);
  ctx.progression = progression;

  /* Audio subscribes to the buses combat and mission already emit,
     so it can be removed without touching either. It is built after
     both so there is something to subscribe to. */
  const audio = buildAudio(ctx);
  ctx.audio = audio;
  audio.attach();

  /* The trooper falls over when killed. Subscribed here rather than
     called from combat, for the same reason audio is: the player is
     built before combat exists and cannot subscribe to a bus that is
     not there yet, and combat has no business knowing that a body has
     an animation. `spawn` puts them back on their feet. */
  combat.bus.on("playerDied", () => player.die());

  const hud = buildHud(ctx, hudHost);
  ctx.hud = hud;
  const touch = buildTouchControls(ctx, player, touchHost, stage);
  ctx.touch = touch;

  /* Durable state and the native field interface are deliberately
     constructed after every owning gameplay domain. The menu never
     reaches into scene graphs itself: save.js asks each domain for a
     normalized snapshot, and the command wheel confirms through the
     same mission.call() path as every other deployment. */
  const saves = buildSaveSystem(ctx, { setTime, setDayCycle, setStorm });
  ctx.saves = saves;
  /* `setQuality` is the function declared further down (hoisted); the
     menu calls it so a tier change moves the sun's shadow map and
     re-fits the canvas exactly as the boot-time application does. */
  const gameUi = buildGameUi(ctx, {
    stage, canvas, save: saves, touch, render, setQuality: (tier) => setQuality(tier),
  });
  ctx.gameUi = gameUi;

  const tutorial = buildTutorial(ctx, {
    enabled: tutorialEnabled,
    host: document.getElementById("sf-tutorial"),
    stage,
    canvas,
    touch,
  });
  ctx.tutorial = tutorial;

  const introHost = document.getElementById("sf-intro");
  const touchEnabledAfterDrop = !!touch.enabled;
  const runtimePauseReasons = {
    menu: document.body.classList.contains("rb-escape-menu-open"),
    visibility: document.hidden,
    command: document.body.classList.contains("sf-command-open"),
  };
  let runtimeAudioPaused = false;
  function syncRuntimePaused() {
    runtimePauseReasons.menu = document.body.classList.contains("rb-escape-menu-open");
    runtimePauseReasons.visibility = document.hidden;
    runtimePauseReasons.command = document.body.classList.contains("sf-command-open");
    if (ctx.runtime.phase !== "playing") return ctx.runtime.paused;
    const nextSimulation = Object.values(runtimePauseReasons).some(Boolean);
    const nextAudio = runtimePauseReasons.menu || runtimePauseReasons.visibility;
    if (nextSimulation !== ctx.runtime.paused) {
      ctx.runtime.paused = nextSimulation;
      if (nextSimulation) player.input.clearAll?.();
    }
    /* The command wheel freezes the battlefield for deliberate
       selection, but its confirmation tones and the held ambience
       remain live. A real menu/hidden tab suspends both. */
    if (nextAudio !== runtimeAudioPaused) {
      runtimeAudioPaused = nextAudio;
      void audio.setPaused?.(nextAudio);
    }
    return nextSimulation;
  }
  if (introEnabled) {
    hud.setVisible(false);
    touch.setEnabled(false);
    /* Arm the stage before the loader starts fading. This makes the canvas
       pointer-inert during the loader -> Deploy crossfade, so an eager click
       cannot acquire pointer lock through two translucent layers. */
    stage?.classList.add("sf-intro-active");
  }
  /* ------------------------------------------------------------
     THE CINEMATIC'S WINDOW ONTO THE LIVE WORLD

     From cloud-break onward the drop is filmed inside the real
     basin, so the intro needs the live scene to be *presented* -
     terrain LOD paged in, enemies culled, sky and particles moving
     - without gameplay advancing. `combat`, `mission`, `breaches`,
     `saves` and the HUD are deliberately absent: a cinematic that
     ticks the mission clock has already started the game.

     `figure` opts the trooper's own simulation in for the egress
     beat. That is the whole trick behind the walk-out: it is not an
     animation of a player, it is the player, moving under the same
     locomotion, foot IK and camera rig that takes over a second
     later - which is why there is nothing to cut between.
     ------------------------------------------------------------ */
  function cinematicStep(dt, opts = {}) {
    const d = Math.min(Math.max(dt, 0), 0.1);
    const cam = opts.camera || render.camera;
    /* Deliberately the same ORDER as `step`, minus the gameplay
       systems. Order is load-bearing here for the same reason it is
       there - the weapon hangs off a mount the figure pose moves -
       and a cinematic that resolved the pose in a different order
       left the first real gameplay frame to correct the difference,
       which is a visible pop on the one frame that must not have
       one. */
    if (opts.figure) player.update(d, render.camera);
    advanceSky(d, cam, true);
    terrain.updateLod(cam);
    enemies.update(d, cam);
    if (opts.figure) {
      weapons.update(d, player, render.camera);
      player.postUpdate(d);
      jetpack.updateVisual(d);
      shield.updateVisual(d);
    }
    vfx.update(d, cam);
    return true;
  }

  const intro = buildDropIntro(ctx, {
    enabled: introEnabled,
    host: introHost,
    stage,
    render,
    audio,
    pod,
    cinematicStep,
    manualClock: introManualClock,
    reducedMotion: gameUi.settingsState?.().reducedMotion,
    deferReveal: introEnabled && !!boot,
    preserveForQa: qa,
    readSaves: () => saves.read?.() || { autosave: null, manuals: [] },
    subscribeSaves: (listener) => saves.onChange?.(listener),
    onLoad: (kind, index) => saves.load?.(kind, index),
    settingsState: () => gameUi.settingsState?.() || {},
    onSetting: (name, value) => gameUi.setSetting?.(name, value),
    onComplete({ launchMode } = {}) {
      ctx.runtime.phase = "playing";
      ctx.runtime.paused = false;
      ctx.runtime.handoffFrames = 1;
      ctx.deferAmbience = false;
      player.input.clearAll?.();
      hud.setVisible(true);
      touch.setEnabled(touchEnabledAfterDrop);
      audio.startAmbience?.();
      audio.startMusic?.();
      syncRuntimePaused();
      if (launchMode === "new") tutorial.start?.({ source: "new-operation" });
    },
  });
  ctx.intro = intro;
  const runtimeMenuObserver = new MutationObserver(syncRuntimePaused);
  runtimeMenuObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", syncRuntimePaused);

  // Scratch vectors for the shot path, allocated once. A firefight
  // is the worst possible time to be making garbage.
  let colliderView = false;
  let colliderTick = 0;
  const shotOrigin = new THREE.Vector3();
  const shotDir = new THREE.Vector3();
  const shotCameraOrigin = new THREE.Vector3();
  const shotCameraDir = new THREE.Vector3();
  const shotAimPoint = new THREE.Vector3();
  const shotSide = new THREE.Vector3();
  const shotUp = new THREE.Vector3();
  const SHOT_RANGE = 320;
  let shotQueued = false;
  let shotPort = null;
  let shotDamage = 22;
  let shotAimKind = "range";
  let shotAimEnemy = null;
  let shotAimReach = SHOT_RANGE;
  let lastShotSolution = null;

  /* ------------------------------ loop ------------------------------ */

  const frameStat = makeStat(180);
  const api = {
    ready: false,
    render,
    sky,
    terrain,
    world,
    vfx,
    enemies,
    weapons,
    jetpack,
    boost,
    slam,
    shield,
    player,
    hud,
    touch,
    collide,
    combat,
    mission,
    breaches,
    abbess,
    stylite,
    coulter,
    distaff,
    garner,
    winnower,
    matriarch,
    apostate,
    undercroft,
    progression,
    audio,
    intro,
    saves,
    gameUi,
    tutorial,
    runtime: ctx.runtime,
    audioFactory: buildAudio,
    fps: 0,
    frameMs: 0,
    shotSolution: () => lastShotSolution ? {
      ...lastShotSolution,
      cameraOrigin: [...lastShotSolution.cameraOrigin],
      cameraDirection: [...lastShotSolution.cameraDirection],
      aimPoint: [...lastShotSolution.aimPoint],
      origin: [...lastShotSolution.origin],
      direction: [...lastShotSolution.direction],
    } : null,
    resize,
    step,
    setTime,
    setDayCycle,
    setStorm,
    setQuality,
    frameOnce: null,
    /* Assigned once `shoot` is defined below. The QA trigger has to
       come through HERE and not through `weapons.fire()`, which only
       spends a round and kicks the weapon - everything a shot does
       that a player would notice (the bolt, the muzzle flash, the
       camera shove, the report) lives in `shoot`. A harness that
       pulls the trigger past it is testing an ammunition counter. */
    shoot: null,
  };

  function resize() {
    const w = (stage ? stage.clientWidth : window.innerWidth) || window.innerWidth;
    const h = (stage ? stage.clientHeight : window.innerHeight) || window.innerHeight;
    render.resize(w, h);
    intro.resize(w, h);
  }
  window.addEventListener("resize", resize);
  resize();

  function setTime(key) {
    if (!TIMES[key]) return;
    atmos.apply(key, atmos.storm);
    render.applyAtmosphere(atmos);
    render.syncEnvironment(atmos);
    sky.refresh();
    // The sun just moved in a step; a shadow map from before the step
    // must not survive into the next interleave gap.
    render.requestShadowUpdate();
  }

  function setDayCycle(phase = atmos.cyclePhase, running = true, cycleCount = atmos.cycleCount) {
    atmos.setCyclePhase(phase, running, cycleCount);
    render.applyAtmosphere(atmos);
    render.syncEnvironment(atmos);
    sky.refresh();
    render.requestShadowUpdate();
    return atmos.cycleStatus();
  }

  /* ------------------------------------------------------------
     THE GAME LOOP PROPER

     Ordering is load-bearing:
       combat  needs ctx.player  (it reads the trooper's position)
       mission needs ctx.combat  (it damages and heals through it)
       hud     needs both        (it renders their state)
     ------------------------------------------------------------ */
  function shoot() {
    if (combat.player.dead) return;
    /* AIRBORNE AND BOOSTING BOTH FIRE NOW.
       The lance was refused in flight and during a boost, which meant
       the two verbs that get you into and across a fight both ended
       it - every engagement was "move, stop, shoot". What still
       refuses is the SLAM, because that is itself an attack and the
       lance is over the trooper's head for the whole of it. */
    if (slam.state.active) return;
    if (shield.state.active) return;
    if (!weapons.fire()) return;
    /* Accept the shot now, but resolve it after the visible weapon has
       received this frame's aim and recoil pose. Reading a world-space
       socket here samples LAST frame's lance: `weapons.fire()` has just
       added recoil, while `weapons.update()` has not applied it yet.
       During a burst that left the streak 7-8cm away from the rendered
       needle, and a fast turn could separate them much further. */
    const w = weapons.current;
    shotPort = w ? (w.emitter || w.muzzle) : null;
    render.camera.updateWorldMatrix(true, false);
    shotCameraOrigin.setFromMatrixPosition(render.camera.matrixWorld);
    render.camera.getWorldDirection(shotCameraDir);
    const cone = weapons.spread();
    if (cone > 0) {
      // Cone, not a square: adding independent jitter per axis
      // concentrates shots at the diagonals.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * cone;
      shotSide.set(shotCameraDir.z, 0, -shotCameraDir.x).normalize();
      shotUp.crossVectors(shotSide, shotCameraDir).normalize();
      shotCameraDir.addScaledVector(shotSide, Math.cos(a) * r)
        .addScaledVector(shotUp, Math.sin(a) * r).normalize();
    }

    /* THIRD-PERSON CONVERGENCE.

       The camera owns the reticle, but the lance owns the physical
       origin. Casting a ray from that lower emitter PARALLEL to the
       camera ray makes a target under the reticle sit above the bolt.
       On level ground the parallel ray can enter the sand several
       metres in front of the trooper even though the camera has a
       clear view of an enemy.

       First resolve what the spread-adjusted reticle ray points at,
       then converge the posed emitter onto that world point in
       `flushShot`. Cover is still resolved a second time from the
       emitter by `combat.fire`, so a camera peeking over a wall does
       not let the lance shoot through it. */
    const cameraWall = collide.rayBlock(
      shotCameraOrigin.x, shotCameraOrigin.y, shotCameraOrigin.z,
      shotCameraDir.x, shotCameraDir.y, shotCameraDir.z, SHOT_RANGE
    );
    const cameraEnemy = combat.raycastEnemies(
      shotCameraOrigin.x, shotCameraOrigin.y, shotCameraOrigin.z,
      shotCameraDir.x, shotCameraDir.y, shotCameraDir.z,
      Math.min(SHOT_RANGE, cameraWall)
    );
    shotAimKind = cameraEnemy ? "enemy" : (cameraWall !== Infinity ? "cover" : "range");
    shotAimEnemy = cameraEnemy ? cameraEnemy.inst.key : null;
    shotAimReach = cameraEnemy
      ? cameraEnemy.t
      : Math.min(SHOT_RANGE, cameraWall);
    shotAimPoint.copy(shotCameraOrigin).addScaledVector(shotCameraDir, shotAimReach);
    shotDamage = (w && w.spec.damage) || 22;
    shotQueued = true;
    weapons.flashMuzzle();
    return true;
  }
  api.shoot = shoot;

  /** Resolve an accepted shot from the lance's FINAL posed tip.
   *
   * Damage remains hitscan. The spread-adjusted reticle target is frozen
   * at press time, while the near end waits: the socket is read after
   * `weapons.update()` and `player.postUpdate()` so the singular beam
   * begins on the needle the player actually sees in the discharge
   * frame. */
  function flushShot() {
    if (!shotQueued) return;
    shotQueued = false;
    if (shotPort) {
      shotPort.updateWorldMatrix(true, false);
      shotOrigin.setFromMatrixPosition(shotPort.matrixWorld);
    } else {
      shotOrigin.copy(render.camera.position);
    }
    shotDir.subVectors(shotAimPoint, shotOrigin);
    if (shotDir.lengthSq() < 1e-8) shotDir.copy(shotCameraDir);
    else shotDir.normalize();

    /* Retain the old parallel-ray clearance as a diagnostic. It makes
       the exact regression measurable: in the failing ground-level
       case this stops before the camera-selected enemy, while the
       converged ray lands on it. */
    const parallelBlock = collide.rayBlock(
      shotOrigin.x, shotOrigin.y, shotOrigin.z,
      shotCameraDir.x, shotCameraDir.y, shotCameraDir.z, SHOT_RANGE
    );
    const hit = combat.fire(shotOrigin, shotDir, { damage: shotDamage });
    lastShotSolution = {
      aimKind: shotAimKind,
      aimEnemy: shotAimEnemy,
      resolvedEnemy: hit ? hit.inst.key : null,
      cameraReach: Number(shotAimReach.toFixed(4)),
      emitterToAim: Number(shotOrigin.distanceTo(shotAimPoint).toFixed(4)),
      legacyParallelClear: parallelBlock === Infinity
        ? SHOT_RANGE : Number(parallelBlock.toFixed(4)),
      convergenceDeg: Number((shotDir.angleTo(shotCameraDir) * 180 / Math.PI).toFixed(4)),
      cameraOrigin: shotCameraOrigin.toArray(),
      cameraDirection: shotCameraDir.toArray(),
      aimPoint: shotAimPoint.toArray(),
      origin: shotOrigin.toArray(),
      direction: shotDir.toArray(),
    };
    player.punch(1);
    audio.shot(shotOrigin.x, shotOrigin.z, { gain: 0.78 });
    shotPort = null;
  }

  /* Two rites, one physical censer-lance. `autogun` is retained as
     the ranged-mode compatibility key; setMode changes ballistics
     without replacing the visible weapon or breaking either grip.

     There is no longer a swap CONTROL. The lance lives in its ranged
     rite, and a melee press borrows the melee rite for exactly as
     long as the swing takes. That is what makes one key enough: the
     player never has to know which mode they left it in. */
  let meleeBorrowed = false;
  function meleeStrike(aimYaw = null) {
    if (combat.player.dead) return;
    if (jetpack.state.inFlight) return;
    if (shield.state.active) return;
    /* Drawing first. The press has already reset the calm timer via
       `updateStow`, so this frame starts the draw and the swing waits
       for the lance to be in hand - a melee that begins with the
       weapon still on the trooper's back swings an empty fist. */
    calmFor = 0;
    if (weapons.stowPhase > 0.08) return;
    const wasRanged = !!weapons.current && !weapons.current.spec.melee;
    if (wasRanged) {
      weapons.setMode("melee");
      meleeBorrowed = true;
    }
    /* A press during recovery chains the combo, and `meleeSwing`
       returns false for that case as well as for a refusal - so the
       rite is handed back on the ACTION ending, not on this result.
       Returning it here dropped the player out of melee mid-combo. */
    if (!player.meleeSwing(aimYaw) && wasRanged && !player.action) {
      weapons.setMode("ranged");
      meleeBorrowed = false;
    }
  }

  /* ------------------------------------------------------------
     SLINGING THE LANCE

     A trooper walking a supply road with a censer-lance levelled at
     nothing reads as a game character waiting for input. Stowing it
     when there is no reason to hold it is most of what makes the
     walk between objectives feel like anything.

     "In combat" is deliberately generous. A weapon that puts itself
     away while an enemy is circling behind a dune, and then has to be
     drawn again the moment it comes back into view, is worse than one
     that never stows at all - so anything that even looks like a
     fight resets the clock, and the radius is well past the range at
     which the player can do anything about a threat.
     ------------------------------------------------------------ */
  const STOW_IDLE_SECONDS = 6.0;
  const STOW_THREAT_RANGE = 42;
  let calmFor = 0;
  function threatNearby() {
    const px = player.state.x;
    const pz = player.state.z;
    for (const inst of enemies.live) {
      // `state === "death"` is how enemies.js marks a corpse mid-clip;
      // there is no `dead` flag, and testing for one silently treated
      // every body on the field as a live threat.
      if (inst.state === "death" || inst.emerging?.active
        || inst.encounterHidden || inst.encounterLocked) continue;
      const dx = inst.root.position.x - px;
      const dz = inst.root.position.z - pz;
      if (dx * dx + dz * dz < STOW_THREAT_RANGE * STOW_THREAT_RANGE) return true;
    }
    return false;
  }
  /* Review harnesses stand the trooper still for ten or twenty
     seconds while they photograph a carry pose, which is exactly the
     condition that puts the lance on its back - and then they grade
     "hands on the grips" against a weapon that is no longer in them.
     That is not a bug in the sheathe, it is a harness measuring the
     wrong pose, so the harness gets a way to say which pose it wants
     rather than the feature getting a special case. */
  let autoStow = true;
  api.setAutoStow = (on) => {
    autoStow = !!on;
    if (!autoStow) { calmFor = 0; weapons.setStow(false); }
    return autoStow;
  };
  function updateStow(d) {
    /* Ignition is an alert state: draw the lance while the pack lifts
       the body. The existing 0.42s draw and hand-release blend make
       that a visible unsheathe animation rather than a pose switch,
       and keeping it drawn through glide/landing gives both arms a
       purposeful airborne silhouette. */
    if (jetpack.state.inFlight || jetpack.state.requested
      || boost.state.active || slam.state.active || shield.state.active) {
      calmFor = 0;
      weapons.setStow(false);
      /* ADS is suppressed in flight and on a glide but FIRING is not:
         hip fire from a moving trooper is the point of both, and
         sights while travelling at nineteen metres a second is a
         readability problem, not a capability the player wants. */
      weapons.setAds(0);
      return;
    }
    if (!autoStow) { calmFor = 0; weapons.setStow(false); return; }
    const busy = player.input.state.firing
      || player.input.state.ads
      || !!player.action
      || boost.state.active
      || shield.state.active
      || weapons.carry.venting > 0
      || combat.player.dead
      || threatNearby();
    calmFor = busy ? 0 : calmFor + d;
    weapons.setStow(calmFor > STOW_IDLE_SECONDS);
  }

  /** Feet off the ground, by any route: pack, jump or a fall in progress. */
  function airborne() {
    return jetpack.state.inFlight || slam.state.active || !player.state.grounded;
  }

  function stepGame(d) {
    const encounterHold = !!player.state.free;
    if (encounterHold) {
      /* The reveal camera is a hold, not a second control scheme.
         Drain and drop any combat input so a held trigger cannot
         fire from off-camera, then let the encounter modules below
         finish the intro on their own clocks. */
      player.input.clearAll?.();
      weapons.setAds(0);
    }
    /* FLATTENED. `player.applyStun` takes the hands as well as the
       feet - see its note - and this is the half of that the player
       module cannot enforce, because what a press MEANS is decided
       here. Drained and dropped, exactly like the reveal camera's
       hold: a trigger held through a stun must not fire the moment it
       ends, and a melee press must not queue a combo out of it. */
    const stunned = (player.state.stunFor || 0) > 0;
    for (const ev of player.input.drain()) {
      if (encounterHold || stunned || combat.player.dead) continue;
      if (ev.type === "boost") {
        if (!jetpack.state.inFlight) boost.trigger();
        continue;
      }
      if (ev.type === "stratCancel") {
        mission.cancelEntry();
        continue;
      }
      /* ONE KEY, TWO ATTACKS, DECIDED BY ALTITUDE.
         Q swings on the ground and falls in the air. Routing it here
         rather than in the input layer keeps the decision next to the
         systems that know what the trooper is standing on - and means
         a slam that refuses (too low, no charge) can fall back to the
         swing instead of eating the press. */
      if (ev.type === "melee" && airborne()) {
        if (slam.trigger()) continue;
        if (jetpack.state.inFlight || slam.state.active) continue;
      }
      if (slam.state.active) continue;
      if (ev.type === "stratOpen" || ev.type === "dir" || ev.type === "vent") {
        if (jetpack.state.inFlight || boost.state.active || shield.state.active) continue;
      }
      if (ev.type === "stratOpen") mission.beginEntry();
      else if (ev.type === "dir") mission.pushDirection(ev.dir);
      else if (ev.type === "vent") weapons.vent();
      else if (ev.type === "melee" && !boost.state.active && !shield.state.active) {
        meleeStrike(ev.aimYaw);
      }
    }
    const melee = weapons.current && weapons.current.spec.melee;
    /* The trigger only ever fires now. Melee has its own key, and
       mapping it onto the trigger as well meant that holding fire
       through a swing chained a combo nobody asked for.

       A slung lance has to be DRAWN before it can be used. Pressing
       fire already resets the calm timer, so the draw is under way by
       the time this runs; refusing the shot until it lands is the
       difference between a weapon that was put away and a weapon
       that fires out of the player's back. */
    if (!encounterHold && !stunned && player.input.state.firing && !melee
      && !slam.state.active && !shield.state.active
      && weapons.stowPhase < 0.08) shoot();
    /* Hand the rite back once the swing is over. `meleeSwing` buffers
       a press during recovery into the next combo step, so the mode
       has to survive until the whole chain has run out - which is
       exactly when the action clears. */
    if (meleeBorrowed && !player.action) {
      weapons.setMode("ranged");
      meleeBorrowed = false;
    }
    if (!encounterHold) {
      weapons.setAds(!melee && !jetpack.state.inFlight && !boost.state.active
        && !shield.state.active && player.input.state.ads ? 1 : 0);
    }
    updateStow(d);
    combat.update(d);
    /* After combat, because the burrower damages through it and reads
       the player position combat has just resolved against - and before
       breaches, so a Coulter that dies to its own frame's venom is
       counted as dead by the event that is waiting for it. */
    coulter.update(d);
    distaff.update(d);
    garner.update(d);
    abbess.update(d);
    stylite.update(d);
    winnower.update(d);
    districtBosses.update(d);
    /* AFTER the shared controller, not before it. That controller owns
       the Matriarch's reveal gate and its arena reset, and both are
       decided this frame; a module that acted first would spend one
       frame per reset swinging at a player it had just been teleported
       away from. */
    matriarch.update(d);
    apostate.update(d);
    /* AFTER the boss, and it has to be. The collapse writes the
       player's position and the boss's absolute height for the
       length of the cinematic, and both of those have to be the last
       word on the frame - apostate.js's own `poseFigure` would
       otherwise put the body back on a nave floor that is currently
       being taken away. */
    undercroft.update(d);
    breaches.update(d);
    mission.update(d);
    progression.update?.(d);
    audio.update(d, player, render.camera);
    if (colliderView) {
      colliderTick -= d;
      if (colliderTick <= 0) {
        colliderTick = 0.5;
        collide.setDebugView(THREE, scene, true, player.state.x, player.state.z);
      }
    }
  }

  function setStorm(v) {
    atmos.setStorm(v);
    render.applyAtmosphere(atmos);
    render.syncEnvironment(atmos);
    sky.refresh();
    render.requestShadowUpdate();
    vfx.setStorm(atmos.storm);
  }

  function setQuality(tier) {
    const applied = render.setQuality(tier, sky);
    ctx.quality = applied;
    resize();
    return applied;
  }
  /* Applied before the first frame is drawn, so a machine that stored
     LOW never has to survive a HIGH frame to reach the menu. The URL
     param wins for the session; the stored preference is the default
     for the tier switch in both menus. */
  const quality = qualityParam || gameUi.settingsState?.().qualityStored || "high";
  setQuality(quality);
  // Both menus highlight the LIVE tier, so a URL override shows as such.
  gameUi.refresh?.();
  intro.refreshMenu?.();
  /* A difficulty change is data, not a rebuild: every consumer reads the
     tier live. The two things that do not are already-spawned health
     pools and the menus, so both follow here. A save restore sets the
     tier from the file (source "save") and stores it as the preference,
     so a new road starts where the last one was walked. */
  ctx.difficulty.onChange((next, previous, source) => {
    enemies.rescaleForDifficulty?.(previous, next);
    if (source === "save") gameUi.setSetting?.("difficulty", next);
    gameUi.refresh?.();
    intro.refreshMenu?.();
  });
  /* `?ao=0` (or any strength 0..1) overrides the tier's screen-space
     occlusion. A diagnostic first and a relief second: the pass prints
     a fixed-position plaid on Apple GPUs (milestone 96) that no other
     tier setting isolates - `quality=low` also drops shadows and pixel
     ratio - and a player who sees a grid over the desert deserves a
     switch that removes exactly the thing drawing it. */
  if (params.has("ao")) render.setAo(Math.max(0, Math.min(1, Number(params.get("ao")) || 0)), 0.7);

  /* `?dynres=0` pins native resolution for a player who wants it;
     `?dynres=1` opts a QA run INTO the controller, which is otherwise
     held at scale 1 so goldens stay deterministic. The settings menu
     drives the same switch through gameUi. */
  const dynresParam = params.get("dynres");
  if (dynresParam === "0") render.setAutoScale(false);
  else if (dynresParam === "1") render.setAutoScale(true, { force: true });

  /** One simulation + render step. `draw` false steps the world
   *  without drawing, which is what lets the harness settle three
   *  simulated seconds in a few milliseconds. */
  function step(dt, draw = true) {
    const d = Math.min(dt, 0.1);
    player.update(d, render.camera);
    advanceSky(d, render.camera, draw);
    terrain.updateLod(render.camera);
    enemies.update(d, render.camera);
    stepGame(d);
    weapons.update(d, player, render.camera);
    player.postUpdate(d);
    flushShot();
    jetpack.updateVisual(d);
    shield.updateVisual(d);
    vfx.update(d, render.camera);
    touch.update(d);
    hud.update(d, player, render.camera);
    saves.update(d);
    gameUi.update?.(d);
    tutorial.update?.(d);
    if (draw) render.render(render.camera);
  }

  function frame(dt, draw = true) {
    if (intro.isBlocking()) {
      intro.update(dt);
      return;
    }
    /* Present one exact live-world frame after the match cut before any
       simulation, particles, or lighting advance. The following rAF then
       becomes the first moving gameplay frame rather than a visible pop. */
    if (ctx.runtime.handoffFrames > 0) {
      ctx.runtime.handoffFrames -= 1;
      if (draw) render.render(render.camera);
      return;
    }
    if (ctx.runtime.paused) {
      gameUi.update?.(0);
      tutorial.update?.(0);
      if (draw) render.render(render.camera);
      return;
    }
    step(dt, draw);
  }
  api.frameOnce = frame;

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
    /* Presented cadence, not CPU work time: a fill-bound frame spends
       its overrun in the compositor where performance.now() straddling
       frame() never sees it, and rAF spacing is the one signal that
       does. A hidden tab's rAF starvation is excluded by the
       controller's own outlier guard. */
    if (!document.hidden) render.tickAutoScale(rawMs);
  }

  /* -------------------------- keyboard extras -------------------------- */

  const TIME_KEYS = ["goldenhour", "noon", "dusk", "night", "storm"];
  const ownsKeyboard = () => document.pointerLockElement === canvas
    || player.input?.state?.locked || document.activeElement === canvas
    || document.documentElement.classList.contains("sf-maximised");
  const isInteractiveKeyTarget = (target) => target instanceof Element
    && !!target.closest("button, a, input, select, textarea, [contenteditable='true'],"
      + " [role='button'], [role='menuitem'], [role='tab']");
  window.addEventListener("keydown", (e) => {
    if (!ownsKeyboard() || e.defaultPrevented || isInteractiveKeyTarget(e.target)) return;
    if (intro.isBlocking()) return;
    if (ctx.runtime.paused) return;
    if (qa && e.code >= "Digit1" && e.code <= "Digit5") {
      const idx = Number(e.code.slice(5)) - 1;
      if (TIME_KEYS[idx] === "storm") { setTime("goldenhour"); setStorm(1); }
      else { setStorm(0); setTime(TIME_KEYS[idx]); }
      hud.flashDistrict(atmos.preset.label);
    }
    if (qa && e.code === "KeyP") {
      const free = player.state.free;
      if (free) player.setFree(false);
      else {
        /* Free camera is a review tool, not a way to pause an
           airborne body while combat and mission time continue. */
        if (jetpack.state.inFlight) return;
        const c = render.camera;
        const dir = new THREE.Vector3();
        c.getWorldDirection(dir);
        player.setFree(true,
          c.position.toArray(),
          c.position.clone().addScaledVector(dir, 50).toArray(),
          c.fov);
      }
    }
    if (e.code === "KeyH") hud.setVisible(hudHost.style.display === "none");
    if (e.code === "KeyK") {
      // Show what is actually stopping you. See collide.setDebugView.
      colliderView = !colliderView;
      const r = collide.setDebugView(THREE, scene, colliderView,
        player.state.x, player.state.z);
      hud.flashDistrict(colliderView
        ? `Colliders shown (${r && r.boxes ? r.boxes : 0} cells)`
        : "Colliders hidden");
    }
  });

  /* ------------------------------ go ------------------------------ */

  installQa(ctx, api);

  /* WARM EVERY SHADER WHILE THE LOADER IS STILL UP.
     Stepping frames below compiles what is VISIBLE. Everything built
     hidden and revealed on use - the Aegis shield, the jetpack plume,
     the slam, the VFX pools, the Coulter - would otherwise compile its
     program inside the first frame it is used in, which is a freeze on
     the exact input the player pressed to survive something. Measured
     as a 60-200ms stall on first shield, first jetpack and first shot.
     Failure here must never block the drop: a driver that refuses the
     parallel-compile path should cost a hitch, not the game. */
  progress(0.985, "Lighting the censers");
  /* Which adapter the browser actually handed over. A dual-GPU laptop
     can give the page its integrated chip, and a browser with
     hardware acceleration off (or a crashed GPU process) gives back a
     CPU rasteriser - either presents as "strong machine, weak game"
     with no error anywhere, so name the adapter where a bug report
     can find it. The settings menu shows the same string. */
  console.info(`[saintfall] GPU: ${render.gpu || "unknown"}`
    + `${render.softwareRendered ? " - SOFTWARE RENDERING (hardware acceleration is off)" : ""}`);
  try {
    const warmed = await render.warmShaders(render.camera, render.scene);
    if (qa) console.info("[saintfall] shader warm-up", warmed);
    /* The cinematic's orbital act is its OWN scene - the star dome,
       Vesper-IX, the barge, and the entry effects that stay hidden
       until the plasma beat (sheath, wake, embers) live there, not in
       render.scene, so the warm-up above never reaches them. Compile
       them here or each first appearance is a program build on the
       exact beat it becomes visible, mid-cinematic. The getters serve
       the orbit pair while the intro is in its orbital act, which is
       exactly the boot state. */
    if (introEnabled && intro.scene && intro.camera && intro.scene !== render.scene) {
      const warmedOrbit = await render.warmShaders(intro.camera, intro.scene);
      if (qa) console.info("[saintfall] intro shader warm-up", warmedOrbit);
    }
    /* The pod is LENT to that orbital scene right now - the entry
       menu shows it hanging under the barge - so the level warm-up
       above never saw it, and the orbital warm-up compiled it against
       the ORBIT's three lights. Its six materials were then first
       drawn in the level on the cloud-break frame, at the level's
       light count, none of them compiled: measured as seven program
       builds inside the one frame of the match cut. Compile the
       borrowed subtree against the LEVEL's lighting state explicitly. */
    if (introEnabled && pod?.root) {
      const warmedPod = await render.warmShaders(render.camera, pod.root, render.scene);
      if (qa) console.info("[saintfall] pod shader warm-up", warmedPod);
    }
  } catch (err) {
    console.warn("[saintfall] shader warm-up skipped:", err && err.message);
  }

  // A few real frames before the loader lifts, so the first thing
  // anyone sees is a composed image rather than a black canvas.
  for (let i = 0; i < 4; i += 1) {
    if (intro.isBlocking()) {
      // Compile and cull the live basin under the loader as well as
      // the isolated intro. The hatch match-cut must not discover 50
      // world shaders and 193 unculled enemies on its first frame.
      player.input.clearAll?.();
      /* The cinematic holds the trooper hidden until egress via
         figureOverride - which also kept the figure and the lance out
         of these warm frames, so their shadow-depth programs and GPU
         buffers were first built ON the egress beat. Hold the figure
         visible for the hidden draw (the loader is an opaque layer
         over the canvas, and the orbit render below repaints it), then
         put the override back exactly as the cinematic left it. */
      const figureOverride = player.state.figureOverride;
      player.state.figureOverride = null;
      step(0, true);
      player.state.figureOverride = figureOverride;
      if (figureOverride === false) player.figure.root.visible = false;
      intro.update(0);
    } else step(1 / 60, true);
  }
  progress(1, "Ready");
  /* Put the save-aware entry card underneath the opaque loader first,
     then fade the loader away. Reversing these two operations exposes
     the intro's already-rendered orbital frame for the loader's 950ms
     teardown before the menu becomes visible. */
  intro.reveal?.();
  if (boot) await boot.hide();
  api.ready = true;
  if (tutorialForced && !introEnabled) tutorial.start?.({ source: "forced-direct" });
  requestAnimationFrame(loop);

  return api;
}
