/* ============================================================
   BLACKSAND - QA / automation surface

   Publishes `window.__BS`. Everything the screenshot harness, the
   perf probes and the art-director critic loop need to drive the game
   without a human at the keyboard.

   Two hard-won rules from the last project that used a harness like
   this, repeated here so they are not relearned:

   1. Never trust a fixed wait for "the frame is ready". Headless
      Chromium throttles requestAnimationFrame to roughly 1fps, so a
      capture taken after `await delay(500)` is a black rectangle.
      `renderOnce()` and `advanceTime()` exist so the harness can force
      frames synchronously and poll `report().frame` for real progress.

   2. A camera pose that looks fine in the editor can end up inside
      geometry once the world is rebuilt. `cameraClearance()` measures
      it. There is no image statistic that reliably detects "the camera
      is inside a wall" - it is a geometric fault and needs a geometric
      test.
   ============================================================ */

export function createQa(ctx) {
  const { THREE, render, settings, bus } = ctx;

  const raycaster = new THREE.Raycaster();
  const tmpVec = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  /** Poses the harness can request by id. World modules contribute
   *  their own through `world.getBeautyShots()`; these are the fixed
   *  camera-only ones that do not depend on the map layout. */
  const localPoses = [];

  let freeCamera = false;

  function allPoses() {
    const fromWorld = (ctx.world && typeof ctx.world.getBeautyShots === "function")
      ? ctx.world.getBeautyShots()
      : [];
    return [...fromWorld, ...localPoses];
  }

  const api = {
    THREE,
    ctx,
    get input() { return ctx.input; },

    /* ------------------------- readiness ------------------------- */

    isReady() {
      return Boolean(ctx.render && ctx.world && ctx.player && render.frame >= 0);
    },

    /** One synchronous frame. The harness's escape hatch from rAF
     *  throttling. */
    renderOnce(dt = 1 / 60) {
      ctx.loop.frame(dt);
      return render.frame;
    },

    /** Advance simulation and rendering by `seconds` of game time. */
    advanceTime(seconds, stepSize = 1 / 60) {
      ctx.loop.advance(seconds, stepSize);
      return render.frame;
    },

    pause(value = true) { ctx.paused = value; },

    /* --------------------------- camera --------------------------- */

    listPoses() {
      return allPoses().map((p) => ({
        id: p.id,
        label: p.label || p.id,
        followPlayer: Boolean(p.followPlayer),
      }));
    },

    setPose(id) {
      const pose = allPoses().find((p) => p.id === id);
      if (!pose) return false;
      freeCamera = true;
      if (pose.position && pose.target) {
        api.lookAt(pose.position, pose.target, pose.fov);
      }
      if (pose.timeOfDay !== undefined && ctx.sky && ctx.sky.setTimeOfDay) {
        ctx.sky.setTimeOfDay(pose.timeOfDay);
      }
      if (pose.apply) pose.apply(ctx);
      return true;
    },

    lookAt(position, target, fov) {
      freeCamera = true;
      const cam = render.camera;
      cam.position.fromArray(position);
      tmpVec.fromArray(target);
      cam.lookAt(tmpVec);
      if (fov) render.setFov(fov);
      cam.updateMatrixWorld(true);
      return true;
    },

    /** Frame the local player from a spherical offset.
     *  azimuth/elevation in degrees, distance in metres. */
    orbitPlayer(azimuthDeg = 200, distance = 6, height = 1.7, fov = 50) {
      const player = ctx.player;
      if (!player || !player.position) return false;
      freeCamera = true;
      const a = azimuthDeg * Math.PI / 180;
      const cam = render.camera;
      cam.position.set(
        player.position.x + Math.sin(a) * distance,
        player.position.y + height,
        player.position.z + Math.cos(a) * distance
      );
      tmpVec.set(player.position.x, player.position.y + 1.1, player.position.z);
      cam.lookAt(tmpVec);
      render.setFov(fov);
      cam.updateMatrixWorld(true);
      return true;
    },

    releaseCamera() { freeCamera = false; },
    get cameraIsFree() { return freeCamera; },

    /**
     * Shortest distance from the camera to any collidable surface, by
     * casting a small fan forward. Returns metres, or null when the
     * fan hits nothing within range.
     */
    cameraClearance(range = 60) {
      const cam = render.camera;
      const targets = [];
      render.scene.traverse((obj) => {
        if (obj.isMesh && obj.visible && obj.userData.qaOpaque !== false) targets.push(obj);
      });

      const dirs = [
        [0, 0, -1], [0.35, 0, -1], [-0.35, 0, -1],
        [0, 0.3, -1], [0, -0.3, -1],
      ];
      let nearest = null;
      let nearestName = null;
      for (const d of dirs) {
        tmpDir.set(d[0], d[1], d[2]).normalize().applyQuaternion(cam.quaternion);
        raycaster.set(cam.position, tmpDir);
        raycaster.far = range;
        const hits = raycaster.intersectObjects(targets, false);
        if (hits.length && (nearest === null || hits[0].distance < nearest)) {
          nearest = hits[0].distance;
          nearestName = hits[0].object.name || hits[0].object.type;
        }
      }
      return {
        nearest: nearest === null ? null : Number(nearest.toFixed(2)),
        object: nearestName,
      };
    },

    /* ---------------------------- world ---------------------------- */

    teleport(x, y, z) {
      if (!ctx.player || !ctx.player.teleport) return false;
      ctx.player.teleport(x, y, z);
      return true;
    },

    heightAt(x, z) {
      return ctx.terrain && ctx.terrain.heightAt ? ctx.terrain.heightAt(x, z) : 0;
    },

    setTimeOfDay(hours) {
      if (ctx.sky && ctx.sky.setTimeOfDay) { ctx.sky.setTimeOfDay(hours); return true; }
      return false;
    },

    setWeather(name) {
      if (ctx.sky && ctx.sky.setWeather) { ctx.sky.setWeather(name); return true; }
      return false;
    },

    grade(patch) {
      if (patch) render.grade(patch);
      return render.readGrade();
    },

    /* ----------------------------- ui ----------------------------- */

    hideHud(hide = true) {
      if (ctx.hudRoot) ctx.hudRoot.style.display = hide ? "none" : "";
      if (ctx.touchRoot) ctx.touchRoot.style.display = hide ? "none" : "";
      if (ctx.overlayRoot) ctx.overlayRoot.style.display = hide ? "none" : "";
      if (ctx.viewmodel && ctx.viewmodel.setVisible) ctx.viewmodel.setVisible(!hide ? true : false);
      /* The objective markers are HUD that happens to live in the 3D
         scene - flat white capture-radius discs, depthWrite off,
         renderOrder 5, floating 0.12m over the terrain. Hiding only the
         DOM roots left them in every "HUD hidden" capture we have ever
         taken, and at a grazing angle a capture radius is a white ribbon
         swooping across the frame. It was the brightest object in two of
         the round-6 beauty shots and I mis-attributed it to a blown
         specular on the fuel pipeline; an agent raycast the pixels and
         found this instead. */
      const markers = render.scene && render.scene.getObjectByName("objective-markers");
      if (markers) markers.visible = !hide;
      return true;
    },

    showHud() { return api.hideHud(false); },

    /** Hide the first-person weapon without touching the HUD, so a
     *  beauty shot can be taken from the player's own eyes. */
    hideViewmodel(hide = true) {
      if (ctx.viewmodel && ctx.viewmodel.setVisible) ctx.viewmodel.setVisible(!hide);
      return true;
    },

    /* ---------------------------- capture ---------------------------- */

    /**
     * Expand the playfield to fill the viewport.
     *
     * The game normally sits inside the site's page chrome, so a plain
     * page screenshot is mostly navigation bar and sidebar - the actual
     * render was 1150x650 of a 1600x900 shot, and every image metric
     * was dominated by the dark page background rather than the frame.
     */
    maximize() {
      const style = document.createElement("style");
      style.id = "bs-qa-maximize";
      style.textContent = `
        html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important;
                     background: #000 !important; }
        .nav, .footer, .game-page__header, .game-side, #ad-leaderboard, #ad-rectangle,
        .fs-btn { display: none !important; }
        .game-page, .game-layout, .game-stage, .canvas-wrap {
          position: fixed !important; inset: 0 !important;
          margin: 0 !important; padding: 0 !important;
          max-width: none !important; width: 100vw !important; height: 100vh !important;
          border: 0 !important; border-radius: 0 !important; aspect-ratio: auto !important;
          transform: none !important;
        }
      `;
      document.head.appendChild(style);
      render.resize(true);
      return { width: window.innerWidth, height: window.innerHeight };
    },

    /**
     * The rendered frame as a PNG data URL, read straight out of the
     * WebGL drawing buffer.
     *
     * Playwright's own screenshot goes through the compositor, and the
     * compositor only refreshes on a real animation frame. Headless
     * Chromium throttles those to about 1fps, so a run that forces its
     * own frames synchronously gets EIGHT BYTE-IDENTICAL captures of
     * whatever the compositor last happened to hold. Reading the
     * drawing buffer here cannot go stale - it is the exact surface the
     * last renderOnce() drew into. (This is why the renderer is
     * constructed with preserveDrawingBuffer when qa=1.)
     */
    captureDataURL(type = "image/png") {
      return ctx.canvas.toDataURL(type);
    },

    /* ---------------------------- report ---------------------------- */

    report() {
      const r = render.stats();
      return {
        frame: r.frame,
        fps: Number((ctx.stats.fps || 0).toFixed(1)),
        frameMs: Number((ctx.stats.frameMs || 0).toFixed(2)),
        tick: ctx.tick,
        time: Number(ctx.time.toFixed(2)),
        seed: ctx.seed,
        quality: settings.tier,
        detectedQuality: settings.detected,
        render: r,
        sky: ctx.sky && ctx.sky.report ? ctx.sky.report() : null,
        world: ctx.world && ctx.world.report ? ctx.world.report() : null,
        player: ctx.player && ctx.player.report ? ctx.player.report() : null,
        physics: ctx.physics && ctx.physics.report ? ctx.physics.report() : null,
        bots: ctx.bots && ctx.bots.report ? ctx.bots.report() : null,
        net: ctx.net && ctx.net.report ? ctx.net.report() : null,
        grade: render.readGrade(),
      };
    },

    /** Register an extra pose from a module or from the console. */
    addPose(pose) { localPoses.push(pose); },

    bus,
  };

  window.__BS = api;
  return api;
}
