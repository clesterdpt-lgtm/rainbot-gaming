/* ============================================================
   Tardigrade Simulator - entry point + system orchestrator

   ------------------------------------------------------------
   THE SYSTEM CONTRACT (read this before editing any module)
   ------------------------------------------------------------
   Every subsystem lives in its own file and exports one async
   factory:

       export async function createThing(ctx) { ...; return api; }

   `ctx` is the single shared context object described in
   `createContext()` below. It is created once, before any system
   loads, and is passed to every factory and every update call.

   The returned `api` may implement any of these optional hooks:

       api.fixedUpdate(step, ctx)  // fixed 1/120s cadence, physics
       api.update(dt, ctx)         // once per frame, variable dt
       api.lateUpdate(dt, ctx)     // after update, before render
       api.resize(width, height)   // on viewport change
       api.dispose()               // teardown

   Systems are created in the order listed in SYSTEM_SPECS, so a
   later system may rely on `ctx.<earlier system id>` existing.
   Never reach forward to a system created after you: subscribe to
   `ctx.events` instead.

   Rules that keep the parallel work merge-safe:
     * One system owns one file. Do not edit another system's file.
     * Talk across systems through `ctx` fields + `ctx.events`.
     * Never call Math.random(); use makeRng() from core.js so
       screenshots are reproducible frame for frame.
     * Register every disposable Three resource you create so the
       level can be rebuilt without leaking GPU memory.
   ============================================================ */

import * as THREE from "three";
// NOTE: these siblings are imported WITHOUT a cache-busting query, so a
// browser keeps serving the versions it already has even when boot.js and
// main.js are bumped. After editing any of them, hard-reload once (or bump
// the module URLs) - otherwise the game silently runs old code, which is
// easy to mistake for a fix that did not work.
import { Emitter, RollingAverage, clamp, makeRng } from "./core.js";
import { createSettings } from "./settings.js";
import { createInput } from "./input.js";
import { createEngine } from "./engine.js";
import { installQaHooks } from "./qa.js";

const RAPIER_URL = new URL("../../vendor/rapier/rapier-0.19.3.mjs", import.meta.url).href;

/**
 * Load order matters. `weight` is the share of the loading bar each
 * step gets, and `required` decides whether a failure is fatal.
 */
const SYSTEM_SPECS = [
  { id: "materials", path: "./materials.js", factory: "createMaterials", weight: 14, required: true, label: "Baking materials" },
  { id: "physics", path: "./physics.js", factory: "createPhysics", weight: 8, required: true, label: "Starting physics" },
  { id: "world", path: "./world.js", factory: "createWorld", weight: 24, required: true, label: "Growing the garden" },
  { id: "props", path: "./props.js", factory: "createProps", weight: 12, required: false, label: "Scattering debris" },
  { id: "tardigrade", path: "./tardigrade.js", factory: "createTardigrade", weight: 10, required: true, label: "Assembling the water bear" },
  { id: "player", path: "./player.js", factory: "createPlayer", weight: 8, required: true, label: "Calibrating claws" },
  { id: "vfx", path: "./vfx.js", factory: "createVfx", weight: 8, required: false, label: "Seeding dust motes" },
  { id: "audio", path: "./audio.js", factory: "createAudio", weight: 4, required: false, label: "Tuning audio" },
  { id: "ui", path: "./ui.js", factory: "createUi", weight: 6, required: false, label: "Drawing the HUD" },
];

const FIXED_STEP = 1 / 120;
const MAX_FRAME_DT = 0.1;
const MAX_SUBSTEPS = 8;

function createContext(options) {
  const canvas = document.getElementById("ts-canvas");
  if (!canvas) throw new Error("#ts-canvas is missing from the page");

  const ctx = {
    /* ---- constants ---- */
    /** World units are "tardigrade body lengths" ~= 0.5 mm of reality.
     *  The hero is ~1.6 units long. A human shoe is ~90 units.
     *  Gravity is tuned for arcade weight, not for realism. */
    GRAVITY: -19.6,
    FIXED_STEP,

    /* ---- platform ---- */
    THREE,
    RAPIER: null,
    canvas,
    dom: {
      root: document.getElementById("ts-root"),
      hud: document.getElementById("ts-hud"),
      touch: document.getElementById("ts-touch"),
      overlay: document.getElementById("ts-overlay"),
    },
    boot: options.boot,
    moduleRoot: options.moduleRoot,

    /* ---- rendering (populated by engine.js) ---- */
    renderer: null,
    scene: null,
    camera: null,
    engine: null,

    /* ---- systems (populated below, in SYSTEM_SPECS order) ---- */
    materials: null,
    physics: null,
    world: null,
    props: null,
    tardigrade: null,
    player: null,
    vfx: null,
    audio: null,
    ui: null,

    /* ---- shared services ---- */
    settings: null,
    input: null,
    events: new Emitter(),
    rng: makeRng(0x7a1d16),

    /* ---- frame timing ---- */
    time: {
      elapsed: 0,
      dt: 0,
      /** dt scaled by `timeScale`; gameplay should use this. */
      scaledDt: 0,
      timeScale: 1,
      frame: 0,
      fps: 0,
      alpha: 0,
    },

    /* ---- run state ---- */
    state: {
      phase: "loading", // loading | menu | playing | paused | photo
      score: 0,
      combo: 0,
      comboBest: 0,
      ready: false,
    },

    perf: {
      frameMs: new RollingAverage(120),
      cpuMs: new RollingAverage(120),
      drawCalls: 0,
      triangles: 0,
      programs: 0,
    },

    /** Systems push disposables here so level rebuilds are leak-free. */
    disposables: new Set(),
    track(resource) {
      if (resource && typeof resource.dispose === "function") ctx.disposables.add(resource);
      return resource;
    },

    /** True while a QA/screenshot harness is driving the game. */
    get qaMode() {
      return new URLSearchParams(location.search).has("qa");
    },
  };

  return ctx;
}

function isDisposable(value) {
  return value && typeof value.dispose === "function";
}

export async function start(options) {
  const boot = options.boot;
  const ctx = createContext(options);
  window.__TSIM_CTX = ctx;

  /* ---------- settings + input are synchronous and always present ---------- */
  ctx.settings = createSettings(ctx);
  ctx.input = createInput(ctx);

  /* ---------- physics runtime ---------- */
  boot.progress(0.22, "Loading physics runtime");
  const rapierModule = await import(RAPIER_URL);
  const RAPIER = rapierModule.default && rapierModule.default.World ? rapierModule.default : rapierModule;
  await (RAPIER.init ? RAPIER.init() : rapierModule.init());
  ctx.RAPIER = RAPIER;

  /* ---------- renderer ---------- */
  boot.progress(0.3, "Compiling shaders");
  ctx.engine = await createEngine(ctx);
  ctx.renderer = ctx.engine.renderer;
  ctx.scene = ctx.engine.scene;
  ctx.camera = ctx.engine.camera;

  /* ---------- feature systems ---------- */
  const updatables = [];
  const totalWeight = SYSTEM_SPECS.reduce((sum, spec) => sum + spec.weight, 0);
  let done = 0;

  for (const spec of SYSTEM_SPECS) {
    boot.progress(0.32 + 0.62 * (done / totalWeight), spec.label);
    try {
      const module = await import(new URL(spec.path, import.meta.url).href);
      const factory = module[spec.factory];
      if (typeof factory !== "function") {
        throw new Error(`${spec.path} does not export ${spec.factory}()`);
      }
      const api = await factory(ctx);
      ctx[spec.id] = api || {};
      if (api) {
        updatables.push({ id: spec.id, api });
        if (isDisposable(api)) ctx.disposables.add(api);
      }
    } catch (error) {
      if (spec.required) {
        boot.fail(
          `System "${spec.id}" failed to load.`,
          (error && (error.stack || error.message)) || String(error)
        );
        throw error;
      }
      console.warn(`[tardigrade-sim] optional system "${spec.id}" unavailable:`, error);
      ctx[spec.id] = null;
    }
    done += spec.weight;
  }

  ctx.systems = updatables;
  boot.progress(0.96, "Warming up");

  /* ---------- resize ---------- */
  const applyResize = () => {
    const width = Math.max(1, Math.floor(window.innerWidth));
    const height = Math.max(1, Math.floor(window.innerHeight));
    ctx.engine.resize(width, height);
    for (const entry of updatables) {
      if (typeof entry.api.resize === "function") entry.api.resize(width, height);
    }
    ctx.events.emit("resize", { width, height });
  };
  window.addEventListener("resize", applyResize, { passive: true });
  window.addEventListener("orientationchange", () => window.setTimeout(applyResize, 120), { passive: true });
  applyResize();

  /* ---------- pre-compile so the first frames do not hitch ---------- */
  try {
    ctx.renderer.compile(ctx.scene, ctx.camera);
  } catch (error) {
    console.warn("[tardigrade-sim] shader pre-compile skipped:", error);
  }

  /* ---------- main loop ---------- */
  const clock = new THREE.Clock();
  let accumulator = 0;
  let running = true;

  function stepSystems(dt) {
    const scaled = dt * ctx.time.timeScale;
    ctx.time.dt = dt;
    ctx.time.scaledDt = scaled;

    ctx.input.beginFrame(dt);

    // Fixed-cadence work (physics, character controller) so behaviour is
    // frame-rate independent and reproducible for screenshots.
    accumulator += scaled;
    let substeps = 0;
    while (accumulator >= FIXED_STEP && substeps < MAX_SUBSTEPS) {
      for (const entry of updatables) {
        if (typeof entry.api.fixedUpdate === "function") entry.api.fixedUpdate(FIXED_STEP, ctx);
      }
      accumulator -= FIXED_STEP;
      substeps += 1;
    }
    if (substeps >= MAX_SUBSTEPS) accumulator = 0; // avoid spiral of death
    ctx.time.alpha = accumulator / FIXED_STEP;

    for (const entry of updatables) {
      if (typeof entry.api.update === "function") entry.api.update(scaled, ctx);
    }
    for (const entry of updatables) {
      if (typeof entry.api.lateUpdate === "function") entry.api.lateUpdate(scaled, ctx);
    }

    ctx.engine.update(scaled, ctx);
    ctx.input.endFrame();

    ctx.time.elapsed += scaled;
    ctx.time.frame += 1;
  }

  function renderFrame() {
    ctx.engine.render(ctx);
    const info = ctx.renderer.info;
    // `renderer.info` resets on every draw, and the composer's last pass is a
    // fullscreen quad - so trust engine.stats (captured right after the scene
    // pass) when the engine publishes it, and fall back to raw info otherwise.
    const stats = ctx.engine.stats;
    ctx.perf.drawCalls = stats ? stats.calls : info.render.calls;
    ctx.perf.triangles = stats ? stats.triangles : info.render.triangles;
    ctx.perf.programs = info.programs ? info.programs.length : 0;
  }

  function frame() {
    if (!running) return;
    const raw = clock.getDelta();
    const dt = clamp(raw, 0, MAX_FRAME_DT);
    const cpuStart = performance.now();

    stepSystems(dt);
    renderFrame();

    const frameMs = performance.now() - cpuStart;
    ctx.perf.frameMs.push(raw * 1000);
    ctx.perf.cpuMs.push(frameMs);
    ctx.time.fps = raw > 0 ? 1 / raw : 0;

    ctx.renderer.setAnimationLoop(frame);
  }

  /** Deterministic stepper used by the screenshot + test harness. */
  ctx.advanceTime = (seconds, stepSize = 1 / 60) => {
    const steps = Math.max(1, Math.round(seconds / stepSize));
    for (let i = 0; i < steps; i += 1) stepSystems(stepSize);
    renderFrame();
    return { steps, elapsed: ctx.time.elapsed };
  };

  ctx.stop = () => {
    running = false;
    ctx.renderer.setAnimationLoop(null);
  };

  installQaHooks(ctx);

  ctx.state.ready = true;
  ctx.state.phase = ctx.qaMode ? "playing" : "menu";
  ctx.events.emit("ready", ctx);

  boot.progress(1, "Ready");
  // One synchronous frame before revealing, so we never flash an empty canvas.
  stepSystems(1 / 60);
  renderFrame();
  boot.hide();

  ctx.renderer.setAnimationLoop(frame);
  return ctx;
}
