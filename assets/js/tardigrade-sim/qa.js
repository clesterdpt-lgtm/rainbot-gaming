/* ============================================================
   Tardigrade Simulator - QA + screenshot hooks

   Everything the automated harness and the visual-critic loop
   needs lives on `window.__TSIM`.

   IMPORTANT CONTRACT FOR player.js:
     When `ctx.qa.cameraLocked === true`, the player must NOT
     write to ctx.camera. The QA harness owns the camera then.
   ============================================================ */

import * as THREE from "three";
import { clamp } from "./core.js";

/** Fallback poses if the level does not publish its own beauty shots. */
function defaultPoses(ctx) {
  const radius = (ctx.world && ctx.world.bounds && ctx.world.bounds.radius) || 120;
  return [
    { id: "establishing", name: "Establishing wide", position: [radius * 0.55, radius * 0.34, radius * 0.62], target: [0, 4, 0], fov: 55 },
    { id: "hero-closeup", name: "Hero close-up", position: [3.2, 1.9, 4.6], target: [0, 1.1, 0], fov: 42, followHero: true },
    { id: "ground-level", name: "Ground level", position: [12, 1.1, 14], target: [0, 1.2, 0], fov: 64 },
    { id: "backlit", name: "Backlit rim", position: [-14, 3.4, -16], target: [0, 1.4, 0], fov: 50 },
    { id: "top-down", name: "Top down", position: [0, radius * 0.72, 0.01], target: [0, 0, 0], fov: 60 },
  ];
}

export function installQaHooks(ctx) {
  const qa = {
    cameraLocked: false,
    hudHidden: false,
  };
  ctx.qa = qa;

  const freeCam = {
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
  };
  const _heroQuat = new THREE.Quaternion();
  const _heroFwd = new THREE.Vector3();
  const _heroRight = new THREE.Vector3();

  function poses() {
    if (ctx.world && typeof ctx.world.getBeautyShots === "function") {
      const list = ctx.world.getBeautyShots();
      if (Array.isArray(list) && list.length) return list;
    }
    return defaultPoses(ctx);
  }

  const heroFocus = new THREE.Vector3();

  /**
   * Where a hero-following pose should aim.
   *
   * NOT the player position: that is a controller origin sitting a
   * self-calibrated distance above the ground, which varies with the surface
   * (0.5 on soil, 1.46 standing on a patio slab). Framing off it aimed nearly
   * two units above the animal, and since applyPose also hands this point to
   * engine.setFocus(), the depth-of-field plane landed behind the subject too
   * - so the hero came out small AND soft in its own close-up.
   * `tardigrade.focusPoint()` is the actual body centre.
   */
  function heroPosition() {
    if (ctx.tardigrade && typeof ctx.tardigrade.focusPoint === "function") {
      return ctx.tardigrade.focusPoint(heroFocus);
    }
    if (ctx.player && ctx.player.position) return ctx.player.position;
    if (ctx.tardigrade && ctx.tardigrade.root) return ctx.tardigrade.root.position;
    return new THREE.Vector3();
  }

  /** Distance from `point` to the nearest non-hero, non-sky geometry. */
  const CLEARANCE_DIRS = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
  ];
  const clearanceRaycaster = new THREE.Raycaster();

  function clearanceAt(point) {
    const heroRoot = ctx.tardigrade && ctx.tardigrade.root;
    const isHero = (object) => {
      for (let p = object; p; p = p.parent) if (p === heroRoot) return true;
      return false;
    };
    let nearest = Infinity;
    const consider = (dir) => {
      clearanceRaycaster.set(point, dir);
      clearanceRaycaster.far = 60;
      const hit = clearanceRaycaster
        .intersectObject(ctx.scene, true)
        .find((h) => h.object.visible && h.object.name !== "Sky" && !h.object.isPoints && !isHero(h.object));
      if (hit && hit.distance < nearest) nearest = hit.distance;
    };

    // Six axis-aligned rays answer "is anything near the camera", which is
    // NOT the question. What matters is whether anything close is IN SHOT: a
    // clover stem 30 units away and off to the left missed all six axes, so
    // the backlit frame reported 105 units of clearance while a blurred stem
    // filled its left third. Sample through the frustum instead.
    const ndc = [-0.8, -0.4, 0, 0.4, 0.8];
    const dir = new THREE.Vector3();
    for (const nx of ndc) {
      for (const ny of ndc) {
        dir.set(nx, ny, 0.5).unproject(ctx.camera).sub(point).normalize();
        consider(dir.clone());
      }
    }
    // Keep the axis probes too - they catch geometry behind or beside the
    // camera that the frustum grid cannot see.
    for (const d of CLEARANCE_DIRS) consider(d);

    return Number.isFinite(nearest) ? nearest : 60;
  }

  /** The hero's own left/forward basis on the ground plane.
   *  Local forward is +Z (player.js derives yaw as atan2(x, z)). */
  function heroBasis() {
    const root = ctx.tardigrade && ctx.tardigrade.root;
    if (!root) return null;
    root.getWorldQuaternion(_heroQuat);
    _heroFwd.set(0, 0, 1).applyQuaternion(_heroQuat);
    _heroFwd.y = 0;
    if (_heroFwd.lengthSq() < 1e-6) return null;
    _heroFwd.normalize();
    _heroRight.set(_heroFwd.z, 0, -_heroFwd.x);
    return true;
  }

  function applyPose(pose) {
    const hero = heroPosition();
    const origin = pose.followHero ? hero : { x: 0, y: 0, z: 0 };

    // `heroRelative` reads pose.position as [side, up, forward] in the
    // ANIMAL's frame rather than the world's. Without it a hero offset is a
    // fixed world-space vector, so which side of the creature you see depends
    // entirely on whichever heading it happened to stop at - which is why the
    // "hero close-up" was shooting the tardigrade squarely from behind and a
    // reviewer concluded it had no eyes, no mouth and no head, when in fact
    // the model carries all three at the far end.
    // `aimLandmarks` guarantees the composition a scale shot depends on:
    // put the camera on the far side of the hero from the nearest human-made
    // object, so that object is always BEHIND the animal. heroRelative fixes
    // the view of the creature but says nothing about the background, and the
    // creature's heading is arbitrary - so which landmark (if any) ended up
    // in frame was pure chance, which is why scale kept scoring 3-4/10.
    let aim = null;
    if (pose.aimLandmarks && pose.followHero) {
      let bestD = Infinity;
      for (const [lx, lz] of pose.aimLandmarks) {
        const d = Math.hypot(hero.x - lx, hero.z - lz);
        if (d < bestD) { bestD = d; aim = [lx, lz]; }
      }
    }
    if (aim) {
      const dx = hero.x - aim[0];
      const dz = hero.z - aim[1];
      const len = Math.hypot(dx, dz) || 1;
      _heroFwd.set(dx / len, 0, dz / len);      // landmark -> hero
      _heroRight.set(_heroFwd.z, 0, -_heroFwd.x);
    }
    const rel = aim ? true : (pose.heroRelative && pose.followHero ? heroBasis() : null);
    const map = (v) => (rel
      ? { x: _heroRight.x * v[0] + _heroFwd.x * v[2], z: _heroRight.z * v[0] + _heroFwd.z * v[2] }
      : { x: v[0], z: v[2] });

    const p = map(pose.position);
    const t = map(pose.target);

    freeCam.position.set(
      origin.x + p.x,
      (pose.followHero ? origin.y : 0) + pose.position[1],
      origin.z + p.z
    );
    freeCam.target.set(
      origin.x + t.x,
      (pose.followHero ? origin.y : 0) + pose.target[1],
      origin.z + t.z
    );

    qa.cameraLocked = true;
    ctx.camera.fov = pose.fov || ctx.settings.fov;
    ctx.camera.position.copy(freeCam.position);
    ctx.camera.lookAt(freeCam.target);
    ctx.camera.updateProjectionMatrix();
    ctx.camera.updateMatrixWorld(true);

    // Hero-following poses are composed around a subject that moves, and at
    // this scale the hero is usually standing in grass taller than itself.
    // Pulling the camera straight in just buries it further, so orbit around
    // the hero and pick the angle with the most room. Height is raised on
    // later attempts so a fully enclosed spot can still find sky.
    if (pose.followHero) {
      const offset = new THREE.Vector3().subVectors(ctx.camera.position, freeCam.target);
      const radius = Math.hypot(offset.x, offset.z);
      const baseAngle = Math.atan2(offset.x, offset.z);
      const candidate = new THREE.Vector3();

      let bestPos = ctx.camera.position.clone();
      let bestClear = clearanceAt(ctx.camera.position);

      outer:
      for (const lift of [0, 0.6, 1.6, 3.2]) {
        for (let i = 1; i <= 12; i += 1) {
          // Alternate either side of the authored angle so the composition
          // changes as little as possible.
          const step = Math.ceil(i / 2) * (Math.PI / 6) * (i % 2 === 0 ? 1 : -1);
          const a = baseAngle + step;
          candidate.set(
            freeCam.target.x + Math.sin(a) * radius,
            freeCam.target.y + offset.y + lift,
            freeCam.target.z + Math.cos(a) * radius
          );
          const clear = clearanceAt(candidate);
          if (clear > bestClear) {
            bestClear = clear;
            bestPos.copy(candidate);
          }
          if (bestClear > 2.5) break outer;
        }
      }

      ctx.camera.position.copy(bestPos);
      ctx.camera.lookAt(freeCam.target);
      ctx.camera.updateMatrixWorld(true);
    }

    ctx.engine.setFocus(freeCam.target);
  }

  /** Diagnostics used by both the smoke test and the critic. */
  function report() {
    const info = ctx.renderer.info;
    const hero = heroPosition();
    return {
      phase: ctx.state.phase,
      ready: ctx.state.ready,
      frame: ctx.time.frame,
      elapsed: Number(ctx.time.elapsed.toFixed(3)),
      fps: Number(ctx.time.fps.toFixed(1)),
      cpuMs: Number(ctx.perf.cpuMs.mean.toFixed(2)),
      frameMsP90: Number(ctx.perf.frameMs.percentile(0.9).toFixed(2)),
      renderScale: Number(ctx.engine.renderScale.toFixed(3)),
      quality: ctx.settings.tierName,
      draws: ctx.perf.drawCalls,
      triangles: ctx.perf.triangles,
      programs: info.programs ? info.programs.length : 0,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      hero: { x: Number(hero.x.toFixed(2)), y: Number(hero.y.toFixed(2)), z: Number(hero.z.toFixed(2)) },
      score: ctx.state.score,
      combo: ctx.state.combo,
      systems: (ctx.systems || []).map((entry) => entry.id),
      missingSystems: ["materials", "physics", "world", "props", "tardigrade", "player", "vfx", "audio", "ui"]
        .filter((id) => !ctx[id]),
      world: ctx.world && typeof ctx.world.report === "function" ? ctx.world.report() : null,
      physics: ctx.physics && typeof ctx.physics.report === "function" ? ctx.physics.report() : null,
      player: ctx.player && typeof ctx.player.report === "function" ? ctx.player.report() : null,
      props: ctx.props && typeof ctx.props.report === "function" ? ctx.props.report() : null,
      vfx: ctx.vfx && typeof ctx.vfx.report === "function" ? ctx.vfx.report() : null,
    };
  }

  const api = {
    ctx,
    THREE,

    /* ---- lifecycle ---- */
    isReady: () => ctx.state.ready,
    report,
    render_game_to_text: () => JSON.stringify(report()),

    /* ---- deterministic stepping ---- */
    advanceTime: (seconds, step) => ctx.advanceTime(seconds, step),
    renderOnce: () => { ctx.engine.render(ctx); return ctx.time.frame; },

    /* ---- camera control for beauty shots ---- */
    listPoses: () => poses().map((p) => ({ id: p.id, name: p.name, followHero: !!p.followHero })),
    setPose: (idOrPose) => {
      const pose = typeof idOrPose === "string"
        ? poses().find((p) => p.id === idOrPose)
        : idOrPose;
      if (!pose) throw new Error(`unknown pose: ${idOrPose}`);
      applyPose(pose);
      ctx.engine.render(ctx);
      return pose.id || "custom";
    },
    lookAt: (position, target, fov = 55) => {
      applyPose({ id: "custom", position, target, fov });
      ctx.engine.render(ctx);
    },
    orbitHero: (angleDeg, distance = 6, height = 2.4, fov = 46) => {
      const a = (angleDeg * Math.PI) / 180;
      applyPose({
        id: "orbit",
        followHero: true,
        position: [Math.sin(a) * distance, height, Math.cos(a) * distance],
        target: [0, 0.9, 0],
        fov,
      });

      // Third-person camera collision. Without this the orbit camera ends up
      // inside terrain whenever the hero is in a canyon or under an
      // overhang, and the shot is a flat wall of nothing.
      const heroRoot = ctx.tardigrade && ctx.tardigrade.root;
      const isHero = (object) => {
        for (let p = object; p; p = p.parent) if (p === heroRoot) return true;
        return false;
      };

      const dir = new THREE.Vector3().subVectors(ctx.camera.position, freeCam.target);
      const wanted = dir.length();
      dir.normalize();

      const raycaster = new THREE.Raycaster(freeCam.target, dir, 0.05, wanted);
      const blocker = raycaster
        .intersectObject(ctx.scene, true)
        .find((h) => h.object.visible && h.object.name !== "Sky" && !h.object.isPoints && !isHero(h.object));

      if (blocker) {
        // Pull in to just short of whatever is in the way.
        const safe = Math.max(1.6, blocker.distance * 0.82);
        ctx.camera.position.copy(freeCam.target).addScaledVector(dir, safe);
        ctx.camera.lookAt(freeCam.target);
        ctx.camera.updateMatrixWorld(true);
      }

      ctx.engine.render(ctx);
    },
    releaseCamera: () => { qa.cameraLocked = false; },

    /**
     * How much empty space surrounds the current camera, and how far the
     * first thing down the barrel is. A pose whose `nearest` is a couple of
     * units has geometry pressed against the lens, which reads as an
     * unidentifiable blur no matter how good the rendering is.
     */
    cameraClearance: () => {
      const origin = ctx.camera.position.clone();
      const forward = new THREE.Vector3();
      ctx.camera.getWorldDirection(forward);

      // Forward plus six axes answers "is anything near the camera", which is
      // not the question a beauty shot asks. What matters is whether anything
      // close is IN SHOT: a clover stem 30 units away and off to the left
      // misses every one of these, so the backlit frame reported 105 units of
      // clearance while a blurred stem filled its left third. Sample the
      // frustum as well, so off-centre obstructions are actually seen.
      const dirs = [
        forward.clone(),
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
      ];
      for (const nx of [-0.85, -0.45, 0, 0.45, 0.85]) {
        for (const ny of [-0.85, -0.45, 0, 0.45, 0.85]) {
          if (nx === 0 && ny === 0) continue;
          dirs.push(new THREE.Vector3(nx, ny, 0.5).unproject(ctx.camera).sub(origin).normalize());
        }
      }

      // The hero is legitimately close in a hero close-up, so it must not
      // count as an obstruction.
      const heroRoot = ctx.tardigrade && ctx.tardigrade.root;
      const isHero = (object) => {
        for (let p = object; p; p = p.parent) if (p === heroRoot) return true;
        return false;
      };
      const skip = (object) =>
        !object.visible || object.name === "Sky" || object.isPoints || isHero(object);
      const raycaster = new THREE.Raycaster();
      raycaster.far = 4000;

      let minAny = Infinity;
      let downBarrel = Infinity;

      dirs.forEach((dir, index) => {
        raycaster.set(origin, dir.normalize());
        const hit = raycaster.intersectObject(ctx.scene, true).find((h) => !skip(h.object));
        if (!hit) return;
        if (index === 0) downBarrel = hit.distance;
        if (hit.distance < minAny) minAny = hit.distance;
      });

      return {
        nearest: Number.isFinite(minAny) ? Number(minAny.toFixed(2)) : null,
        downBarrel: Number.isFinite(downBarrel) ? Number(downBarrel.toFixed(2)) : null,
      };
    },

    /* ---- presentation toggles for clean screenshots ---- */
    hideHud: (hidden = true) => {
      qa.hudHidden = hidden;
      for (const id of ["ts-hud", "ts-touch", "ts-overlay"]) {
        const el = document.getElementById(id);
        if (el) el.style.display = hidden ? "none" : "";
      }
      // The boot overlay fades out on a timer and is removed 800ms later.
      // Headless capture regularly beats that timer, and the overlay is
      // opaque - it silently blacks out entire screenshots. Take it out now.
      if (hidden) {
        const bootEl = document.getElementById("ts-boot");
        if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
      }
    },
    setQuality: (tier) => { ctx.settings.setTier(tier); },
    setExposure: (value) => ctx.engine.setExposure(value),
    setTimeScale: (value) => { ctx.time.timeScale = clamp(value, 0, 4); },

    /* ---- driving the game without real input ---- */
    input: {
      press: (action) => ctx.input.qaSet(action, true),
      release: (action) => ctx.input.qaSet(action, false),
      tap: (action, seconds = 0.08) => {
        ctx.input.qaSet(action, true);
        ctx.advanceTime(seconds);
        ctx.input.qaSet(action, false);
      },
      move: (x, y) => ctx.input.qaMove(x, y),
      stopMove: () => ctx.input.qaClearMove(),
      look: (dx, dy) => ctx.input.qaLook(dx, dy),
    },

    teleportHero: (x, y, z) => {
      if (ctx.player && typeof ctx.player.teleport === "function") ctx.player.teleport(x, y, z);
    },

    /* ---- module handles for ad-hoc probing ---- */
    get engine() { return ctx.engine; },
    get world() { return ctx.world; },
    get player() { return ctx.player; },
    get physics() { return ctx.physics; },
    get materials() { return ctx.materials; },
  };

  window.__TSIM = api;
  // Site-wide convention used by the other Rainbot games + agent harness.
  window.render_game_to_text = api.render_game_to_text;
  window.advanceTime = api.advanceTime;

  return api;
}
