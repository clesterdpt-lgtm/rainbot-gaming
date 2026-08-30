/* ============================================================
   BLACKSAND - entry point and frame loop

   Builds the `ctx` object, constructs every subsystem in dependency
   order, then runs the loop.

   ---- the ctx contract ----
   Every module exports `createX(ctx)` (sync or async) and returns an
   object that is assigned onto `ctx` under a fixed key. A module may
   implement any of:

     fixedUpdate(dt, ctx)   simulation. Fixed 1/120s steps, may run
                            several times per frame, never skipped.
     update(dt, ctx)        per-frame logic. Variable dt.
     lateUpdate(dt, ctx)    after the camera is final. Anything that
                            must react to the finished camera pose.
     dispose()

   Modules must not import each other for runtime state - they read it
   off ctx. That is what lets each one be rewritten independently.
   ============================================================ */

import * as THREE from "three";
import { makeBus, makeRng, makeStat, clamp, hashString } from "./core.js";
import { createSettings } from "./settings.js";
import { createInput } from "./input.js";
import { createRenderer } from "./render.js";
import { createSky } from "./sky.js";
import { createTextures } from "./textures.js";
import { createMaterials } from "./materials.js";
import { createTerrain } from "./terrain.js";
import { createFoliage } from "./foliage.js";
import { createStructures } from "./structures.js";
import { createWorld } from "./world.js";
import { createPhysics } from "./physics.js";
import { createVfx } from "./vfx.js";
import { createAudio } from "./audio.js";
import { createWeapons } from "./weapons.js";
import { createViewmodel } from "./viewmodel.js";
import { createCharacters } from "./characters.js";
import { createPlayer } from "./player.js";
import { createVehicles } from "./vehicles.js";
import { createBots } from "./bots.js";
import { createNet } from "./net.js";
import { createHud } from "./hud.js";
import { createQa } from "./qa.js";

/** Fixed simulation step. 120Hz: a shooter's hit registration and the
 *  feel of recoil both degrade visibly at 60, and the step is cheap
 *  because rendering is not inside it. */
const FIXED_DT = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;

export async function start(options = {}) {
  const boot = options.boot || { progress() {}, fail() {}, hide() {} };

  const root = document.getElementById("bs-root");
  const canvas = document.getElementById("bs-canvas");
  if (!root || !canvas) throw new Error("BLACKSAND: #bs-root / #bs-canvas missing from the page");

  const params = new URLSearchParams(window.location.search);
  const seed = params.has("seed")
    ? (Number(params.get("seed")) || hashString(params.get("seed")))
    : 0x5ea51de;

  /* ----------------------------- ctx ----------------------------- */

  const ctx = {
    THREE,
    root,
    canvas,
    hudRoot: document.getElementById("bs-hud"),
    overlayRoot: document.getElementById("bs-overlay"),
    touchRoot: document.getElementById("bs-touch"),
    bus: makeBus(),
    seed,
    rng: makeRng(seed),
    /** Wall-clock seconds since the world was built. */
    time: 0,
    /** Simulation ticks completed. Authoritative for the netcode. */
    tick: 0,
    paused: false,
    moduleRoot: options.moduleRoot || "./",
  };

  ctx.settings = createSettings(options.settingsOverrides);

  /* --------------------------- build --------------------------- */

  // Each entry is [key, factory, progress-fraction, label]. Keeping the
  // order explicit and data-driven means the loading bar is honest and
  // a failure names the subsystem that failed.
  const steps = [
    ["input", createInput, 0.20, "Binding controls"],
    ["render", createRenderer, 0.26, "Starting renderer"],
    ["textures", createTextures, 0.36, "Synthesising textures"],
    ["materials", createMaterials, 0.42, "Compiling materials"],
    ["sky", createSky, 0.48, "Building atmosphere"],
    ["terrain", createTerrain, 0.58, "Raising terrain"],
    // physics before structures: every wall registers its own collider
    // as it is built, so the collision world has to exist first.
    ["physics", createPhysics, 0.62, "Waking physics"],
    ["structures", createStructures, 0.68, "Constructing buildings"],
    ["foliage", createFoliage, 0.74, "Planting vegetation"],
    ["world", createWorld, 0.84, "Placing objectives"],
    ["vfx", createVfx, 0.87, "Loading effects"],
    ["audio", createAudio, 0.89, "Mixing audio"],
    ["characters", createCharacters, 0.90, "Rigging soldiers"],
    // player before weapons: the weapon module reads the player's eye
    // and aim every shot, so it takes the reference at construction.
    ["player", createPlayer, 0.92, "Deploying"],
    ["weapons", createWeapons, 0.93, "Issuing weapons"],
    ["viewmodel", createViewmodel, 0.95, "Shouldering rifle"],
    ["vehicles", createVehicles, 0.96, "Fuelling vehicles"],
    ["bots", createBots, 0.97, "Briefing squads"],
    ["net", createNet, 0.99, "Opening comms"],
    ["hud", createHud, 1.00, "Drawing HUD"],
  ];

  for (const [key, factory, progress, label] of steps) {
    boot.progress(progress * 0.96, label);
    // Let the loading screen actually paint between heavy steps.
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    try {
      ctx[key] = await factory(ctx);
    } catch (error) {
      const detail = (error && (error.stack || error.message)) || String(error);
      boot.fail(`Failed while building "${key}".`, detail);
      console.error(`[blacksand] ${key} failed`, error);
      throw error;
    }
  }

  ctx.qa = createQa(ctx);

  /* ---------------------- ordered dispatch ---------------------- */

  // Cache the modules that implement each hook once, rather than
  // probing 20 objects for 3 optional methods every frame.
  const order = steps.map(([key]) => key);
  const fixedUpdaters = order.filter((k) => typeof ctx[k]?.fixedUpdate === "function").map((k) => ctx[k]);
  const updaters = order.filter((k) => typeof ctx[k]?.update === "function").map((k) => ctx[k]);
  const lateUpdaters = order.filter((k) => typeof ctx[k]?.lateUpdate === "function").map((k) => ctx[k]);

  /* ----------------------------- loop ----------------------------- */

  const frameStat = makeStat(180);
  let last = performance.now();
  let accumulator = 0;
  let running = true;
  let rafHandle = 0;

  ctx.stats = {
    fps: 0,
    frameMs: 0,
    simSteps: 0,
    frames: 0,
  };

  function step(dt) {
    ctx.input.beginStep(dt);
    for (const module of fixedUpdaters) module.fixedUpdate(dt, ctx);
    ctx.input.endStep();
    ctx.tick += 1;
  }

  /**
   * One frame. Split out from the rAF callback so the QA harness can
   * drive frames synchronously - headless Chromium throttles rAF to
   * about 1fps, which otherwise makes every capture a black rectangle.
   */
  function frame(dtSeconds) {
    const dt = clamp(dtSeconds, 0, 0.25);
    ctx.time += dt;

    if (!ctx.paused) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
        step(FIXED_DT);
        accumulator -= FIXED_DT;
        steps += 1;
      }
      // Long stall (tab restore, a GC pause): drop the backlog rather
      // than spiral-of-death through it.
      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
      ctx.stats.simSteps = steps;

      for (const module of updaters) module.update(dt, ctx);
    }

    for (const module of lateUpdaters) module.lateUpdate(dt, ctx);

    ctx.render.render(dt);
    ctx.stats.frames += 1;
  }

  function tick(now) {
    if (!running) return;
    rafHandle = requestAnimationFrame(tick);
    const dtMs = now - last;
    last = now;

    frame(dtMs / 1000);

    frameStat.push(dtMs);
    ctx.stats.frameMs = frameStat.mean();
    ctx.stats.fps = ctx.stats.frameMs > 0 ? 1000 / ctx.stats.frameMs : 0;
    ctx.render.updateAdaptive(dtMs);
  }

  ctx.loop = {
    get running() { return running; },
    stop() { running = false; cancelAnimationFrame(rafHandle); },
    resume() {
      if (running) return;
      running = true;
      last = performance.now();
      rafHandle = requestAnimationFrame(tick);
    },
    /** Advance the simulation by `seconds` without waiting on rAF. */
    advance(seconds, stepSize = 1 / 60) {
      const total = Math.max(0, seconds);
      let done = 0;
      while (done < total) {
        const dt = Math.min(stepSize, total - done);
        frame(dt);
        done += dt;
      }
    },
    frame,
  };

  // Pause when the tab is hidden: a shooter running full tilt in a
  // background tab melts a laptop and desyncs the netcode anyway.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      ctx.paused = true;
      ctx.audio?.suspend?.();
    } else {
      ctx.paused = false;
      last = performance.now();
      accumulator = 0;
      ctx.audio?.resume?.();
    }
  });

  window.__BS_CTX = ctx;

  boot.progress(1, "Ready");
  // Two real frames before the loading screen lifts, so shaders are
  // compiled and the first thing the player sees is not a hitch.
  ctx.loop.frame(1 / 60);
  ctx.loop.frame(1 / 60);
  boot.hide();

  running = true;
  last = performance.now();
  rafHandle = requestAnimationFrame(tick);

  ctx.bus.emit("game:ready", ctx);
  return ctx;
}
