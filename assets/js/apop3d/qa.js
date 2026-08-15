/* ============================================================
   APOP DEMON MOGGERS 3D - qa

   Publishes `window.__APOP3D`, the surface scripts/apop3d-shots.mjs
   drives. CONTRACT.md §7 lists the required members; captureDataURL()
   and renderOnce() are additions that same harness also calls.

   Four things this file exists to work around, each learned the
   expensive way on a previous project:

   1. Headless Chromium throttles requestAnimationFrame to roughly one
      frame per second. A harness that poses the camera and then waits
      for real frames either stalls or captures a black rectangle.
      `advance(seconds)` therefore drives `ctx.step()` - main.js's own
      definition of a frame - synchronously at a fixed dt. No rAF is
      involved and the result does not depend on machine speed. It is
      main.js's function rather than a copy of the update order kept
      here, so adding a module to the table cannot leave the harness
      quietly simulating a different game to the one players run.

   2. page.screenshot() goes through the browser compositor, and the
      compositor only refreshes on a real animation frame - so a run
      that forces its own frames gets several byte-identical captures
      of whatever the compositor last held. `captureDataURL()` reads
      the WebGL drawing buffer instead, which is exactly the surface
      the last renderOnce() drew into. render.js keeps that buffer
      readable with preserveDrawingBuffer when the URL carries qa=1.

   3. Determinism dies if main.js's rAF loop keeps stepping the world
      between harness calls, because the number of steps it gets in
      depends on machine speed and scheduler luck. Under automation
      (qa=1 plus navigator.webdriver) qa.js takes the loop before it
      has run a single frame, so every step the world has ever taken
      came from this file. See freezeLoop() for why the gate is what it
      is, and `?qa=1&freeze=1` for taking the same path by hand.

   4. `setCamera()` returning false makes the harness record a skip.
      Returning true for a framing nobody applied makes it record a
      duplicate of the previous shot, which is worse than a gap: it
      quietly poisons the blind-comparison pool with the same image
      under nine names. So false here means false.

   Everything is called defensively. The modules this drives belong to
   other agents and several are still stubs; qa.js reporting "not
   implemented" is useful, qa.js throwing takes the whole harness down.
   ============================================================ */

import { clamp } from "apop3d/core.js";

const DEG = Math.PI / 180;
const FIXED_DT = 1 / 60;
const MAX_ADVANCE_SECONDS = 120;
/* Sim time and frame count the world is snapped to when the harness
   takes it off rAF. Chosen to sit past any plausible boot warm-up so
   the snap is always forward in time. See freezeLoop(). */
const QA_CLOCK_BASE = 8;
const QA_FRAME_BASE = 480;
/* Fixed-dt seconds the world is warmed for when qa.js takes the loop
   at boot. Enough for a settle, cheap enough to pay on every run. */
const BOOT_WARM_SECONDS = 1.0;

/* Only for the presence map in report(). Deliberately NOT an update
   order - main.js owns that, and a second copy of it here is exactly
   the drift this file used to carry. */
const MODULE_KEYS = [
  "settings", "input", "textures", "materials", "render", "sky", "collision",
  "physics", "cameraRig", "character", "anim", "moveset", "player", "enemies",
  "bosses", "collect", "levels", "world", "vfx", "audio", "hud", "save",
];

/**
 * Fallback framings for the nine capture presets in CONTRACT.md §8.
 *
 * camera.js owns the real ones. These exist so the screenshot pipeline
 * is never blocked on it: an orbit around the player at SM64 framing
 * distance is not the cinematography we want, but it is a real,
 * distinct view of the course, and a pipeline that produces mediocre
 * frames today beats one that produces none until another agent lands.
 *
 * Distances are chosen from the framing note in §8 - character at
 * roughly one sixth of frame height. At 55 degrees vertical fov a
 * 1.7m character fills a sixth of the frame at about 10m, which is
 * also where SM64's own camera sits on flat ground.
 */
/* The modules report() enumerates. This used to reference main.js's
   UPDATE_ORDER, which is not in scope here, so report() threw a
   ReferenceError every time it was called - including from the very
   diagnostics a failed capture is supposed to explain itself with. */
const REPORTED_MODULES = [
  "input", "audio", "moveset", "physics", "player", "enemies", "bosses",
  "collect", "world", "sky", "vfx", "hud", "cameraRig", "anim", "render",
  "settings", "textures", "materials", "levels", "save", "character",
  "collision",
];

const FALLBACK_POSES = {
  "arrival":          { az: 205, dist: 11.5, height: 4.6, aimY: 1.4, fov: 55 },
  "vista":            { az: 150, dist: 30.0, height: 16.0, aimY: 2.0, fov: 58, aimCentre: true },
  "platforming":      { az: 248, dist: 12.5, height: 5.2, aimY: 1.6, fov: 55 },
  "enemy-encounter":  { az: 218, dist: 9.0, height: 3.1, aimY: 1.3, fov: 52 },
  "collect":          { az: 165, dist: 8.0, height: 3.4, aimY: 1.5, fov: 50 },
  "boss":             { az: 185, dist: 17.0, height: 4.0, aimY: 3.0, fov: 60 },
  "interior":         { az: 235, dist: 8.5, height: 3.0, aimY: 1.5, fov: 62 },
  "water":            { az: 120, dist: 10.5, height: 2.2, aimY: 1.0, fov: 55 },
  "high-ground":      { az: 300, dist: 14.0, height: 12.0, aimY: 0.6, fov: 55 },
};

const RELEASE_NAMES = new Set([null, undefined, "", "follow", "release", "game", "default"]);

export function create(ctx) {
  const THREE = ctx.THREE;
  const params = new URLSearchParams(window.location.search);
  const debugEnabled = params.get("debug") === "1" || params.get("debug") === "true";

  const anchor = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const scratch = new THREE.Vector3();

  const held = {
    /** Preset name currently applied, or null. */
    preset: null,
    /** "camera" when camera.js served it, "qa" when the fallback did. */
    source: null,
    pose: null,
  };

  const errors = new Set();
  let advancing = false;
  let loopFrozen = false;
  let lastAction = null;
  let stepsRun = 0;

  /* ------------------------- small helpers ------------------------- */

  function logOnce(where, error) {
    if (errors.has(where)) return;
    errors.add(where);
    console.error(`[apop3d/qa] ${where} threw (further identical errors suppressed)`, error);
  }

  /** Try a list of method names on a module; first one present wins. */
  function invoke(mod, names, args) {
    if (!mod) return { found: false, value: undefined };
    for (const name of names) {
      if (typeof mod[name] === "function") {
        try {
          return { found: true, value: mod[name].apply(mod, args), name };
        } catch (error) {
          logOnce(`invoke ${name}`, error);
          // A THROW is not the same answer as `false`. Collapsing the
          // two let a broken module masquerade as one that had simply
          // declined, and the caller then silently substituted a
          // stand-in. Report the throw so callers can tell them apart.
          return { found: true, threw: true, value: undefined, name };
        }
      }
    }
    return { found: false, value: undefined };
  }

  /**
   * Where the player is, whatever shape player.js settles on. Probed
   * rather than assumed because player.js is being written in parallel;
   * the day it exposes `position` this stops guessing.
   */
  function playerPosition(out) {
    const p = ctx.player;
    if (!p) return null;
    const candidates = [
      p.position,
      p.body && p.body.position,
      p.root && p.root.position,
      p.rig && p.rig.root && p.rig.root.position,
      p.mesh && p.mesh.position,
    ];
    for (const c of candidates) {
      if (c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)) {
        return out.set(c.x, c.y, c.z);
      }
    }
    if (typeof p.getPosition === "function") {
      try {
        const v = p.getPosition();
        if (v && Number.isFinite(v.x)) return out.set(v.x, v.y, v.z);
      } catch (error) { logOnce("player.getPosition", error); }
    }
    return null;
  }

  /** Centre of the loaded course, for the framings that look at the
   *  level rather than at the character. */
  function worldCentre(out) {
    const cur = ctx.world && ctx.world.current;
    const b = cur && cur.bounds;
    if (b) {
      if (typeof b.getCenter === "function") { b.getCenter(out); return out; }
      if (b.min && b.max) {
        // world.js builds bounds as plain ARRAYS ({min:[x,y,z]}), not
        // Vector3s. Reading .x off those yields undefined, so the
        // centre came back NaN and any preset aiming at it produced a
        // NaN camera quaternion and a black frame. Handle both shapes.
        const ax = Array.isArray(b.min) ? b.min[0] : b.min.x;
        const ay = Array.isArray(b.min) ? b.min[1] : b.min.y;
        const az = Array.isArray(b.min) ? b.min[2] : b.min.z;
        const bx = Array.isArray(b.max) ? b.max[0] : b.max.x;
        const by = Array.isArray(b.max) ? b.max[1] : b.max.y;
        const bz = Array.isArray(b.max) ? b.max[2] : b.max.z;
        if ([ax, ay, az, bx, by, bz].every(Number.isFinite)) {
          return out.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
        }
      }
      if (b.center && Number.isFinite(b.center.x)) return out.copy(b.center);
    }
    return null;
  }

  function currentAnchor(out) {
    if (playerPosition(out)) return out;
    if (worldCentre(out)) return out;
    return out.set(0, 0, 0);
  }

  function currentAction() {
    const p = ctx.player;
    const m = ctx.moveset;
    const from = (o) => (o && (o.action || o.actionName || o.state || o.current)) || null;
    const a = from(p) || from(m) || lastAction;
    return typeof a === "string" ? a : (a && a.name) || null;
  }

  /* --------------------------- the clock --------------------------- */

  /**
   * One simulation step at a fixed dt, through main.js's own step().
   *
   * `draw` is false for every step of an advance(): the intermediate
   * frames are never looked at, and at 1600x900 on a software
   * rasteriser they are most of the wall clock. advance() draws once at
   * the end instead, after re-asserting any pose this module is
   * holding - which is also how a qa fallback framing survives a camera
   * rig that runs its own lateUpdate on every step.
   */
  function stepOnce(dt, draw) {
    if (typeof ctx.step !== "function") {
      logOnce("ctx.step", new Error("main.js did not export step(dt, drawFrame)"));
      return false;
    }
    ctx.clock.raw = dt;   // main.js's frame() sets this; step() does not
    try {
      ctx.step(dt, draw === true);
    } catch (error) {
      logOnce("ctx.step", error);
      return false;
    }
    stepsRun += 1;
    return true;
  }

  /**
   * Take main.js's rAF loop, then snap the clock to a fixed baseline.
   *
   * The snap is the part that matters. Any real animation frames that
   * ran before this point carried wall-clock deltas, so `clock.t`
   * arrives here at a different value on every run; everything driven
   * by time after that - the beat clock, an idle cycle, drifting motes
   * - lands somewhere else, and CONTRACT §10 says two runs of the same
   * build must produce identical frames.
   *
   * The snap only ever moves time forward, so nothing that stamped a
   * timestamp during boot finds itself in the future. Transient effects
   * boot spawned simply age out, which is what a warmed scene should
   * look like anyway.
   *
   * Reversible now that main.js exposes setRunning - see resumeLoop.
   */
  function freezeLoop() {
    if (loopFrozen) return false;
    const stop = typeof ctx.setRunning === "function"
      ? () => ctx.setRunning(false)
      : (typeof ctx.stop === "function" ? ctx.stop : null);
    if (!stop) return false;
    stop();
    loopFrozen = true;
    const c = ctx.clock;
    c.t = Math.max(QA_CLOCK_BASE, c.t);
    c.frame = Math.max(QA_FRAME_BASE, c.frame);
    c.dt = FIXED_DT;
    c.raw = FIXED_DT;
    ctx.bus.emit("qa:freeze", { frozen: true });
    return true;
  }

  /** Hand the loop back. main.js resets its wall-clock baseline on the
   *  way in, so the frozen gap is not integrated as one huge delta. */
  function resumeLoop() {
    if (!loopFrozen) return false;
    if (typeof ctx.setRunning !== "function") {
      logOnce("ctx.setRunning", new Error("spine cannot restart the loop; freeze is one-way here"));
      return false;
    }
    ctx.setRunning(true);
    loopFrozen = false;
    ctx.bus.emit("qa:freeze", { frozen: false });
    return true;
  }

  /* ---------------------------- camera ---------------------------- */

  function applyPose(pose) {
    const cam = ctx.camera;
    if (!cam || !pose) return false;

    currentAnchor(anchor);
    const a = pose.az * DEG;
    const x = anchor.x + Math.sin(a) * pose.dist;
    const z = anchor.z + Math.cos(a) * pose.dist;
    let y = anchor.y + pose.height;

    // A framing that ends up underground is a wasted shot and no image
    // statistic detects it - it is a geometric fault, so test it
    // geometrically. Lift the eye above whatever floor is beneath it.
    const ground = ctx.collision && typeof ctx.collision.groundAt === "function"
      ? (() => {
        try { return ctx.collision.groundAt(x, z, y + 60, 400); } catch (error) { logOnce("collision.groundAt", error); return null; }
      })()
      : null;
    if (ground && Number.isFinite(ground.y) && y < ground.y + 1.2) y = ground.y + 1.2;

    cam.position.set(x, y, z);

    if (pose.aimCentre && worldCentre(aim)) aim.y += pose.aimY;
    else aim.set(anchor.x, anchor.y + pose.aimY, anchor.z);
    cam.lookAt(aim);

    if (pose.fov && cam.isPerspectiveCamera) {
      cam.fov = pose.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
    return true;
  }

  /** Re-assert a qa-held pose. Called immediately before every capture
   *  so whatever the live loop did to the camera in the meantime does
   *  not end up in the golden. */
  function reassert() {
    if (held.source === "qa" && held.pose) applyPose(held.pose);
  }

  /* -------------------------- debug overlay -------------------------- */

  const overlay = { el: null, raf: 0, last: 0 };

  function mountOverlay() {
    if (overlay.el || !debugEnabled) return;
    const host = document.querySelector(".ap-stage") || document.body;
    const el = document.createElement("div");
    el.id = "ap-debug";
    el.style.cssText = [
      "position:absolute", "top:8px", "left:8px", "z-index:60",
      "font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
      "color:#d8f4ff", "background:rgba(4,6,14,0.72)",
      "border:1px solid rgba(120,200,255,0.28)", "border-radius:6px",
      "padding:6px 9px", "white-space:pre", "pointer-events:none",
      "text-shadow:0 1px 2px rgba(0,0,0,0.9)",
    ].join(";");
    if (getComputedStyle(host).position === "static") el.style.position = "fixed";
    host.appendChild(el);
    overlay.el = el;

    // Its own rAF rather than a hook into the loop: qa.js is not in
    // main.js's update order at all, so there is no frame callback to
    // borrow. Throttled to ~6Hz because a debug readout that flickers
    // every value every frame is unreadable.
    const tick = (now) => {
      overlay.raf = requestAnimationFrame(tick);
      if (now - overlay.last < 160) return;
      overlay.last = now;
      paintOverlay();
    };
    overlay.raf = requestAnimationFrame(tick);
  }

  function paintOverlay() {
    if (!overlay.el) return;
    const s = api.stats();
    const pos = playerPosition(scratch);
    const q = ctx.settings && ctx.settings.tier ? ctx.settings.tier : "?";
    overlay.el.textContent = [
      `fps ${s.fps.toFixed(0).padStart(3)}  ${s.ms.toFixed(1)}ms  q:${q}`,
      `draws ${s.draws}  tris ${(s.tris / 1000).toFixed(0)}k  x${(s.scale || 1).toFixed(2)}`,
      `act  ${currentAction() || "-"}`,
      `pos  ${pos ? `${pos.x.toFixed(1)} ${pos.y.toFixed(1)} ${pos.z.toFixed(1)}` : "-"}`,
      `cam  ${held.preset ? `${held.preset} (${held.source})` : "follow"}`,
      `beat ${ctx.clock.beatIndex}${ctx.clock.onBeat ? " *" : ""}  f${ctx.clock.frame}`,
    ].join("\n");
  }

  /* ----------------------------- the api ----------------------------- */

  const api = {
    /** True once the renderer has actually put a frame on the buffer.
     *  info.render.frame is never reset by info.reset(), so it is a
     *  real "we have drawn" signal rather than a loop counter. */
    get ready() {
      const r = ctx.renderer;
      return Boolean(r && r.info && r.info.render.frame > 0 && ctx.clock.frame > 0);
    },

    /** The counter the harness polls. */
    get frame() { return ctx.clock.frame; },

    /* ---------------------------- world ---------------------------- */

    /**
     * Jump straight to a course. Returns a promise resolving to a
     * boolean - never to a world object, because the harness passes the
     * result straight back through page.evaluate and a live THREE
     * object there is an unserialisable-value error, not a shot.
     */
    async loadCourse(n = 1, spawn = 0) {
      const course = Number(n) || 0;
      const w = ctx.world;
      if (!w || typeof w.load !== "function") return false;
      try {
        await w.load(course, spawn || 0);
      } catch (error) {
        logOnce("world.load", error);
        return false;
      }
      ctx.state.course = course;
      if (ctx.state.mode === "boot" || ctx.state.mode === "title") {
        ctx.state.mode = course === 0 ? "hub" : "course";
      }
      ctx.bus.emit("qa:course", { course, spawn: spawn || 0 });
      return true;
    },

    teleport(x, y, z) {
      const p = ctx.player;
      if (!p) return false;
      const done = invoke(p, ["teleport", "setPosition", "warpTo"], [x, y, z]);
      if (done.found) return done.value !== false;
      const target = p.position || (p.body && p.body.position) || (p.root && p.root.position);
      if (target && typeof target.set === "function") {
        target.set(x, y, z);
        const vel = p.velocity || (p.body && p.body.velocity);
        if (vel && typeof vel.set === "function") vel.set(0, 0, 0);
        return true;
      }
      return false;
    },

    /* ---------------------------- camera ---------------------------- */

    /**
     * Named framing for a shot golden. camera.js owns these; the table
     * in this file is the fallback while it is being written.
     *
     * Returns false for anything nobody can frame, so the harness logs
     * a skip instead of writing the previous pose out under a second
     * name. camera.js must follow the same rule: return false, not
     * undefined, for a preset it does not support.
     */
    setCamera(preset) {
      if (RELEASE_NAMES.has(preset)) {
        held.preset = null; held.source = null; held.pose = null;
        invoke(ctx.cameraRig, ["releaseCapture", "setCapturePreset"], [null]);
        return true;
      }
      const name = String(preset);

      const rig = invoke(ctx.cameraRig, ["setCapturePreset", "setPreset", "capturePreset"], [name]);
      if (rig.found && !rig.threw && rig.value !== false && rig.value !== null) {
        held.preset = name; held.source = "camera"; held.pose = null;
        return true;
      }

      /* The fallback exists so the pipeline is never BLOCKED on
         camera.js being unwritten - not to overrule it.
         If camera.js is present and deliberately answered `false`, it
         is telling us this shot is impossible (occluded, no landmark,
         nowhere to stand) and the honest result is a SKIP. Substituting
         a stand-in pose here reported those as successful captures, and
         the stand-ins are not collision-checked - which is how frames
         of the inside of a ceiling tile reached a blind art review as
         if they were real shots. Only fall back when the module truly
         could not answer: it is missing, or it threw. */
      if (rig.found && !rig.threw) return false;

      const pose = FALLBACK_POSES[name];
      if (!pose) return false;
      if (!applyPose(pose)) return false;
      held.preset = name; held.source = "qa"; held.pose = pose;
      return true;
    },

    /**
     * Force a moveset action so an animation golden shows the pose we
     * asked for. Falls back to driving the animation controller alone,
     * which is enough for an anim golden even before moveset.js can
     * enter a state on command.
     */
    setAction(name) {
      lastAction = name;
      const direct = invoke(ctx.player, ["setAction", "forceAction"], [name]);
      if (direct.found && direct.value !== false) return true;
      const ms = invoke(ctx.moveset, ["setAction", "forceAction", "force"], [name]);
      if (ms.found && ms.value !== false) return true;
      const animator = (ctx.player && (ctx.player.animator || ctx.player.anim)) || null;
      const clip = invoke(animator, ["play"], [name, { fade: 0, loop: true }]);
      return Boolean(clip.found && clip.value !== false);
    },

    /* ------------------------------ ui ------------------------------ */

    /**
     * Clear the HUD for blind comparison. hud.js owns the real switch;
     * the DOM and scene passes below catch the parts a HUD tends to
     * leave behind - the touch pad, the fullscreen button, and anything
     * a module parked in the 3D scene and thinks of as HUD.
     */
    hideHud(on = true) {
      const hide = on !== false;
      invoke(ctx.hud, ["setVisible"], [!hide]);

      for (const id of ["ap-hud", "ap-overlay", "ap-touch", "btn-fullscreen"]) {
        const el = document.getElementById(id);
        if (el) el.style.display = hide ? "none" : "";
      }
      const scene = ctx.scene;
      if (scene) {
        scene.traverse((obj) => {
          if (obj.userData && obj.userData.hud === true) obj.visible = !hide;
        });
      }
      return true;
    },

    /* --------------------------- capture --------------------------- */

    /** Freeze resolution and shadow cadence so two runs of the same
     *  build are comparable. Delegated to render.js, which owns both. */
    pin(on = true) {
      const done = invoke(ctx.render, ["pin"], [on !== false]);
      if (ctx.settings && typeof ctx.settings.setDeterministic === "function") {
        try { ctx.settings.setDeterministic(on !== false); } catch (error) { logOnce("settings.setDeterministic", error); }
      }
      return done.found;
    },

    /**
     * Step the simulation deterministically and synchronously.
     *
     * This is the whole reason the harness can work at all: it runs
     * main.js's update order at a fixed 1/60 dt, N times, with no
     * requestAnimationFrame anywhere in the path. The scene it leaves
     * behind is warmed up and posed, and it is the same scene on every
     * machine because nothing here reads a wall clock.
     */
    advance(seconds = 1 / 60, opts) {
      if (advancing) return ctx.clock.frame;   // reentrancy from a module callback
      const wanted = clamp(Number(seconds) || 0, 0, MAX_ADVANCE_SECONDS);
      const steps = Math.max(1, Math.round(wanted / FIXED_DT));
      const drawEvery = opts && Number(opts.drawEvery) > 0 ? Number(opts.drawEvery) : 0;

      // Under automation, take the loop away from rAF the first time we
      // are asked to step, so the run is reproducible from here on.
      if (ctx.qaMode && typeof navigator !== "undefined" && navigator.webdriver) freezeLoop();

      const wasPaused = ctx.state.paused;
      ctx.state.paused = false;
      advancing = true;
      try {
        for (let i = 0; i < steps; i += 1) {
          const last = i === steps - 1;
          stepOnce(FIXED_DT, last || (drawEvery > 0 && i % drawEvery === 0));
          if (held.source === "qa" && held.pose) applyPose(held.pose);
        }
      } finally {
        advancing = false;
        ctx.state.paused = wasPaused;
      }
      if (debugEnabled) paintOverlay();
      return ctx.clock.frame;
    },

    /** Force one synchronous draw of exactly the pose we asked for. */
    renderOnce() {
      reassert();
      const done = invoke(ctx.render, ["renderOnce"], []);
      if (!done.found && ctx.renderer && ctx.scene && ctx.camera) {
        try { ctx.renderer.render(ctx.scene, ctx.camera); } catch (error) { logOnce("renderer.render", error); }
      }
      return ctx.clock.frame;
    },

    /**
     * The drawn frame as a data URL, read out of the WebGL drawing
     * buffer rather than through the compositor. See the header note:
     * the compositor hands back stale pixels under headless rAF
     * throttling and every shot in the run comes out identical.
     */
    captureDataURL(type = "image/png") {
      const canvas = ctx.canvas || document.getElementById("apopCanvas");
      if (!canvas) return "";
      try {
        return canvas.toDataURL(type || "image/png");
      } catch (error) {
        logOnce("canvas.toDataURL", error);
        return "";
      }
    },

    /* ---------------------------- readouts ---------------------------- */

    stats() {
      const r = invoke(ctx.render, ["stats"], []);
      const s = (r.found && r.value) || {};
      return {
        fps: Number(s.fps || 0),
        draws: Number(s.draws || 0),
        tris: Number(s.tris || 0),
        ms: Number(s.ms || 0),
        scale: Number(s.scale || 1),
        programs: Number(s.programs || 0),
        frame: ctx.clock.frame,
      };
    },

    /* A/B toggles for the art passes.
       Without these on the QA surface every probe has to reach through
       window.__APOP3D_CTX, which is a debug handle rather than a
       contract. These are the switches an attribution measurement
       actually needs: capture with the pass on, capture with it off,
       difference them in one process from one solved pose. */
    setWaterEnabled(on) {
      const r = invoke(ctx.materials, ["setWaterEnabled"], [!!on]);
      return r.found && !r.threw;
    },
    setGroundSkirt(on) {
      const r = invoke(ctx.vfx, ["setGroundSkirt"], [!!on]);
      return r.found && !r.threw;
    },
    /* Note: this one RE-BAKES rather than hiding a mesh, so an
       advance() is required after toggling before the frame reflects it. */
    setGroundCast(on) {
      const r = invoke(ctx.vfx, ["setGroundCast"], [!!on]);
      return r.found && !r.threw;
    },
    /* The specular sheen injected onto Lambert level surfaces, and the
       roof-lid exclusion that lets the key reach the floor at all in a
       roofed course. Both are on their modules but a probe had to reach
       through __APOP3D_CTX to get at them, which is a debug handle
       rather than a contract. */
    setKeySheen(v) {
      const r = invoke(ctx.vfx, ["setKeySheen"], [v]);
      return r.found && !r.threw;
    },
    setLid(v) {
      const r = invoke(ctx.sky, ["setLid"], [v]);
      return r.found && !r.threw;
    },
    setGroundPatches(on) {
      const r = invoke(ctx.vfx, ["setGroundPatches"], [!!on]);
      return r.found && !r.threw;
    },
    setContactShadows(on) {
      const r = invoke(ctx.vfx, ["setContactShadows"], [!!on]);
      return r.found && !r.threw;
    },

    /** Everything a failed shot needs explained, in one serialisable
     *  object - the harness dumps this straight into its diagnostics. */
    report() {
      const s = api.stats();
      const pos = playerPosition(scratch);
      const modules = {};
      for (const key of REPORTED_MODULES) {
        const m = ctx[key];
        modules[key] = Boolean(m && Object.keys(m).some((k) => k !== "update" && k !== "lateUpdate"));
      }
      return {
        build: ctx.build,
        ready: api.ready,
        frame: ctx.clock.frame,
        time: Number(ctx.clock.t.toFixed(3)),
        beat: { index: ctx.clock.beatIndex, phase: Number(ctx.clock.beat.toFixed(3)), onBeat: ctx.clock.onBeat },
        qaMode: Boolean(ctx.qaMode),
        loopFrozen,
        stepsRun,
        state: { ...ctx.state },
        quality: ctx.settings ? ctx.settings.tier : null,
        detectedQuality: ctx.settings ? ctx.settings.detected : null,
        stats: s,
        camera: {
          preset: held.preset,
          source: held.source,
          fov: ctx.camera ? Number(ctx.camera.fov.toFixed(1)) : null,
          position: ctx.camera ? [
            Number(ctx.camera.position.x.toFixed(2)),
            Number(ctx.camera.position.y.toFixed(2)),
            Number(ctx.camera.position.z.toFixed(2)),
          ] : null,
        },
        player: {
          action: currentAction(),
          position: pos ? [Number(pos.x.toFixed(2)), Number(pos.y.toFixed(2)), Number(pos.z.toFixed(2))] : null,
        },
        world: ctx.world && ctx.world.current
          ? { id: ctx.world.current.id, name: ctx.world.current.def && ctx.world.current.def.name }
          : null,
        presets: Object.keys(FALLBACK_POSES),
        modules,
        errors: Array.from(errors),
      };
    },

    /* --------------------------- extras --------------------------- */

    /** Direct pose, for one-off diagnostics from the console. */
    lookAt(position, target, fov) {
      const cam = ctx.camera;
      if (!cam || !position || !target) return false;
      held.preset = "manual"; held.source = "qa";
      held.pose = null;
      cam.position.set(position[0], position[1], position[2]);
      aim.set(target[0], target[1], target[2]);
      cam.lookAt(aim);
      if (fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
      cam.updateMatrixWorld(true);
      return true;
    },

    setQuality(name) {
      const done = invoke(ctx.settings, ["setTier"], [name]);
      return Boolean(done.found && done.value !== false);
    },

    setPaused(on) { ctx.state.paused = on !== false; return ctx.state.paused; },

    /** Take the world off rAF by hand. Irreversible - main.js has no
     *  restart hook, which is why advance() only does this under an
     *  actual automation driver. */
    freeze() { return freezeLoop(); },

    debug(on = true) {
      if (on) { mountOverlay(); paintOverlay(); }
      else if (overlay.el) {
        cancelAnimationFrame(overlay.raf);
        overlay.el.remove();
        overlay.el = null;
      }
      return Boolean(overlay.el);
    },

    /** Escape hatches for hand debugging in a console. */
    get ctx() { return ctx; },
    THREE,
  };

  if (debugEnabled) mountOverlay();

  /**
   * Under a real automation driver, take the loop before it has run a
   * single frame and warm the world with a fixed number of fixed-dt
   * steps instead.
   *
   * Snapping the clock at the first advance() was not enough. The
   * harness waits for eight real animation frames before it touches
   * anything, and every module that smooths a value - the camera rig
   * above all - integrates during those frames with wall-clock deltas.
   * Two runs arrive at the same `clock.t` but with the camera settling
   * from two slightly different places, and an exponential smoother
   * never fully forgets where it started, so the goldens differ by a
   * pixel or two forever. Taking the loop at boot means every step the
   * world has ever taken came from this file, at 1/60, in the same
   * order, on every machine.
   *
   * It is also much faster: headless Chromium throttles rAF to about
   * 1fps, so waiting for those eight frames cost eight seconds per run.
   *
   * Gated on navigator.webdriver, not on qa=1 alone - a person opening
   * ?qa=1 to look at something must still get a live game.
   */
  const autoDrive = Boolean(
    (ctx.qaMode || params.get("qa") === "1")
    && typeof navigator !== "undefined" && navigator.webdriver
    && params.get("autodrive") !== "0"
  );
  if (autoDrive) {
    ctx.bus.on("boot:ready", () => {
      // main.js assigns ctx.stop after it emits boot:ready, so hand the
      // rest of that synchronous tail a chance to finish first.
      queueMicrotask(() => {
        if (!freezeLoop()) return;
        api.advance(BOOT_WARM_SECONDS);
      });
    });
  }

  window.__APOP3D = api;
  return api;
}
