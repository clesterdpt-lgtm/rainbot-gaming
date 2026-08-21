/* ============================================================
   APOP DEMON MOGGERS 3D - entry point and frame loop

   Builds the ctx object described in CONTRACT.md, wires every
   module into it, and runs the fixed update order.

   Modules are imported eagerly but treated as optional at wiring
   time: a module that is still a stub simply contributes nothing.
   That is deliberate - several agents build these in parallel, and
   a half-finished enemies.js must not stop the camera work from
   being visible.
   ============================================================ */

import * as THREE from "three";
import { Bus, Rolling, clamp, makeRng } from "apop3d/core.js";

import * as settingsMod from "apop3d/settings.js";
import * as inputMod from "apop3d/input.js";
import * as texturesMod from "apop3d/textures.js";
import * as materialsMod from "apop3d/materials.js";
import * as renderMod from "apop3d/render.js";
import * as skyMod from "apop3d/sky.js";
import * as collisionMod from "apop3d/collision.js";
import * as physicsMod from "apop3d/physics.js";
import * as cameraMod from "apop3d/camera.js";
import * as characterMod from "apop3d/character.js";
import * as animMod from "apop3d/anim.js";
import * as movesetMod from "apop3d/moveset.js";
import * as playerMod from "apop3d/player.js";
import * as enemiesMod from "apop3d/enemies.js";
import * as bossesMod from "apop3d/bosses.js";
import * as collectMod from "apop3d/collect.js";
import * as levelsMod from "apop3d/levels.js";
import * as worldMod from "apop3d/world.js";
import * as vfxMod from "apop3d/vfx.js";
import * as audioMod from "apop3d/audio.js";
import * as hudMod from "apop3d/hud.js";
import * as saveMod from "apop3d/save.js";
import * as qaMod from "apop3d/qa.js";

const MAX_DT = 1 / 15;   // a tab-switch must not teleport the player
const BPM = 124;
const ON_BEAT_WINDOW = 0.14; // seconds either side of the beat

/** Modules in wiring order. `key` is the ctx property they land on. */
const MODULE_TABLE = [
  { key: "settings", mod: settingsMod },
  { key: "input", mod: inputMod },
  { key: "textures", mod: texturesMod },
  { key: "materials", mod: materialsMod },
  { key: "render", mod: renderMod },
  { key: "sky", mod: skyMod },
  { key: "collision", mod: collisionMod },
  { key: "physics", mod: physicsMod },
  { key: "cameraRig", mod: cameraMod },
  { key: "character", mod: characterMod },
  { key: "anim", mod: animMod },
  { key: "moveset", mod: movesetMod },
  { key: "player", mod: playerMod },
  { key: "enemies", mod: enemiesMod },
  { key: "bosses", mod: bossesMod },
  { key: "collect", mod: collectMod },
  { key: "levels", mod: levelsMod },
  { key: "world", mod: worldMod },
  { key: "vfx", mod: vfxMod },
  { key: "audio", mod: audioMod },
  { key: "hud", mod: hudMod },
  { key: "save", mod: saveMod },
  { key: "qa", mod: qaMod },
];

/** Fixed per-frame update order. See CONTRACT.md §4. */
const UPDATE_ORDER = [
  "input", "audio", "moveset", "physics", "player", "enemies", "bosses",
  "collect", "world", "sky", "vfx", "hud",
];

/** lateUpdate runs after every body has its final transform. */
const LATE_ORDER = ["cameraRig", "anim", "vfx", "render"];

export async function start({ boot, build } = {}) {
  const canvas = document.getElementById("apopCanvas");
  if (!canvas) throw new Error("apop3d: #apopCanvas not found");

  const ctx = {
    THREE,
    build: build || "dev",
    canvas,
    renderer: null,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 4000),
    clock: { t: 0, dt: 0, raw: 0, frame: 0, beat: 0, beatIndex: 0, onBeat: false, bpm: BPM },
    bus: new Bus(),
    rng: makeRng(0xA90D),
    state: {
      mode: "boot",
      course: 0,
      records: 0,
      clout: 0,
      hp: 8,
      maxHp: 8,
      mog: 0,
      paused: false,
    },
    perf: { cpu: new Rolling(90), gpuFrame: new Rolling(90) },
    modules: {},
  };
  ctx.camera.name = "mainCamera";
  ctx.scene.name = "apopScene";

  // ---- create pass -------------------------------------------------
  const created = [];
  for (let i = 0; i < MODULE_TABLE.length; i += 1) {
    const { key, mod } = MODULE_TABLE[i];
    const factory = mod && (mod.create || mod.init);
    if (typeof factory !== "function") {
      ctx[key] = ctx[key] || null;
      continue;
    }
    if (boot) boot.progress(0.25 + 0.6 * (i / MODULE_TABLE.length), `Building ${key}`);
    try {
      const api = await factory(ctx);
      ctx[key] = api || ctx[key] || {};
      ctx.modules[key] = ctx[key];
      created.push(key);
    } catch (error) {
      console.error(`[apop3d] module "${key}" failed to create`, error);
      ctx[key] = ctx[key] || {};
    }
  }

  if (!ctx.renderer) {
    throw new Error("apop3d: render.js did not produce a renderer");
  }

  // ---- ready pass: modules that need every other module present ----
  for (const { key, mod } of MODULE_TABLE) {
    if (mod && typeof mod.ready === "function") {
      try { await mod.ready(ctx); } catch (error) { console.error(`[apop3d] ready("${key}") failed`, error); }
    }
  }

  // ---- the loop ----------------------------------------------------
  let last = performance.now() / 1000;
  let running = true;
  let rafId = 0;

  const thrown = new Set();
  function logOnce(key, phase, error) {
    const id = `${key}:${phase}`;
    if (thrown.has(id)) return;
    thrown.add(id);
    console.error(`[apop3d] ${id} threw (further identical errors suppressed)`, error);
  }

  /**
   * Advance the whole simulation by one step and draw it.
   *
   * This is the single definition of the frame. The screenshot harness
   * drives it directly at a fixed dt instead of waiting on rAF, because
   * headless Chromium throttles animation frames to roughly 1fps - so
   * qa.js must be able to step the game without one. Exporting it here
   * rather than letting qa.js keep its own copy of the update order is
   * what stops the two drifting apart the next time a module is added.
   *
   * `drawFrame` is false while warming, so a 240-step warm-up costs one
   * draw rather than 240.
   */
  function step(dt, drawFrame = true) {
    const cpuStart = performance.now();

    const c = ctx.clock;
    c.dt = dt;
    c.t += dt;
    c.frame += 1;

    // Beat clock. audio.js owns the authoritative phase once it has a
    // real transport running; until then this keeps the on-beat bonus,
    // enemy choreography and light pulses in step from the wall clock.
    if (!ctx.audio || typeof ctx.audio.beatPhase !== "function") {
      const beats = (c.t * BPM) / 60;
      c.beatIndex = Math.floor(beats);
      c.beat = beats - c.beatIndex;
      const secPerBeat = 60 / BPM;
      const toNearest = Math.min(c.beat, 1 - c.beat) * secPerBeat;
      c.onBeat = toNearest <= ON_BEAT_WINDOW;
    }

    for (const key of UPDATE_ORDER) {
      const m = ctx[key];
      if (m && typeof m.update === "function") {
        try { m.update(ctx); } catch (error) { logOnce(key, "update", error); }
      }
    }
    for (const key of LATE_ORDER) {
      if (key === "render" && !drawFrame) continue;
      const m = ctx[key];
      if (m && typeof m.lateUpdate === "function") {
        try { m.lateUpdate(ctx); } catch (error) { logOnce(key, "lateUpdate", error); }
      }
    }

    // render.js owns the draw. If it exposes no lateUpdate it is
    // expected to expose draw() instead.
    const r = ctx.render;
    if (drawFrame && r && typeof r.lateUpdate !== "function" && typeof r.draw === "function") {
      try { r.draw(ctx); } catch (error) { logOnce("render", "draw", error); }
    }

    ctx.perf.cpu.push(performance.now() - cpuStart);
  }

  function frame(nowMs) {
    if (!running) return;
    const now = nowMs / 1000;
    const raw = now - last;
    last = now;
    ctx.clock.raw = raw;
    step(ctx.state.paused ? 0 : clamp(raw, 0, MAX_DT));
    rafId = requestAnimationFrame(frame);
  }

  ctx.step = step;

  /** Start or stop the rAF loop. The harness takes the loop over so it
   *  can step deterministically; it must be able to hand it back. */
  ctx.setRunning = (on) => {
    const want = !!on;
    if (want === running) return running;
    running = want;
    if (running) {
      last = performance.now() / 1000;   // do not integrate the gap
      rafId = requestAnimationFrame(frame);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    return running;
  };
  ctx.isRunning = () => running;
  ctx.stop = () => ctx.setRunning(false);

  /* The HUD emits these; nobody else was listening. Restart and
     "exit to lobby" therefore painted a menu over an unchanged
     (or empty) scene. The spine owns course changes. */
  async function loadCourse(id, spawnIndex = 0) {
    const course = Number(id);
    const n = Number.isFinite(course) && course >= 0 && course <= 5 ? course : 0;
    if (!ctx.world || typeof ctx.world.load !== "function") {
      throw new Error("apop3d: world.load is not available");
    }
    await ctx.world.load(n, spawnIndex || 0);
    ctx.state.course = n;
    ctx.state.mode = n === 0 ? "hub" : "course";
    return n;
  }
  ctx.loadCourse = loadCourse;

  ctx.bus.on("hud:restart", (event = {}) => {
    const id = event.course !== undefined ? event.course : ctx.state.course;
    Promise.resolve(loadCourse(id, 0)).catch((error) => {
      console.error("[apop3d] restart failed", error);
    });
  });
  ctx.bus.on("hud:quit", (event = {}) => {
    Promise.resolve(loadCourse(event.to !== undefined ? event.to : 0, 0)).catch((error) => {
      console.error("[apop3d] return to lobby failed", error);
    });
  });

  /* A real player never called loadCourse. The screenshot harness
     does, via __APOP3D.loadCourse, so the goldens had a floor and
     the shipped game did not: Moggadonna spawned at y=1.2 in an
     empty scene and fell. Load the opening theatre here, before
     rAF, so the first frame has collision.

     Skip it under the Playwright driver (qa=1 + webdriver). That
     harness freezes the loop on boot:ready and loads its own
     course; building the hub first would double the cost and
     warm the wrong room. */
  const params = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  const harnessDriving = Boolean(
    params.get("qa") === "1"
    && typeof navigator !== "undefined"
    && navigator.webdriver
  );
  if (!harnessDriving) {
    const requested = Number(params.get("course"));
    const opening = Number.isInteger(requested) && requested >= 0 && requested <= 5
      ? requested
      : 0;
    try {
      if (boot) boot.progress(0.92, "Raising the house");
      await loadCourse(opening, 0);
    } catch (error) {
      console.error("[apop3d] opening course failed to load", error);
      ctx.state.mode = "title";
    }
  } else {
    ctx.state.mode = "title";
  }

  // Emitted only now, not right after the ready pass. A listener's
  // whole reason to wait for this event is that it wants a finished
  // ctx, and the screenshot harness in particular takes the loop over
  // the moment it fires - which it cannot do before setRunning exists.
  ctx.bus.emit("boot:ready", { created });

  if (boot) { boot.progress(1, "Ready"); boot.hide(); }
  if (ctx.state.mode === "boot") ctx.state.mode = "title";
  rafId = requestAnimationFrame(frame);

  window.__APOP3D_CTX = ctx;   // debug handle; qa.js builds the real surface
  return ctx;
}
