#!/usr/bin/env node
/* Saintfall finite jetpack: central-thruster/stow presentation,
   real-input, fuel, landing, collision and multi-angle rendered proof. */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/saintfall/jetpack-qa");
const port = 45200 + (process.pid % 1400);
const base = `http://127.0.0.1:${port}`;
const sources = [
  "assets/js/saintfall/jetpack.js", "assets/js/saintfall/player.js",
  "assets/js/saintfall/collide.js", "assets/js/saintfall/terrain.js",
  "assets/js/saintfall/world.js", "assets/js/saintfall/main.js",
  "assets/js/saintfall/hud.js", "assets/js/saintfall/audio.js",
  "assets/js/saintfall/combat.js", "assets/js/saintfall/mission.js",
  "assets/js/saintfall/weapons.js", "assets/js/saintfall/vfx.js",
  "assets/js/saintfall/qa.js", "assets/js/saintfall/boot.js",
  "assets/css/saintfall.css", "games/saintfall.html",
];

async function hashes() {
  const out = {};
  for (const file of sources) {
    out[file] = createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");
  }
  return out;
}

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}

async function waitServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

async function saveDataUrl(file, value) {
  await writeFile(file, Buffer.from(value.replace(/^data:image\/png;base64,/, ""), "base64"));
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const before = await hashes();
  const child = server();
  let browser;
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&time=noon`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

    /* CLAIM THE KEYBOARD.
       The game only takes gameplay keys once the canvas owns
       interaction - pointer lock, canvas focus, or max-screen - and
       headless Chromium grants none of those on its own. Without this
       every real-key check here silently tested a trooper that never
       received the keystroke: seventeen of them failed at once, all
       reporting a pack that had simply never been asked to light.
       Max-screen is a real player state and the one route a test can
       take honestly. */
    await page.evaluate(() => document.documentElement.classList.add("sf-maximised"));

    await page.evaluate(() => {
      const T = window.__SF;
      T.clearEnemies();
      T.releaseCamera();
      const site = T.findFlatSite(18);
      T.teleport(site[0], site[1], 0);
      T.player.state.figureOverride = true;
      T.setFiring(false);
      T.setAds(0);
      /* Let the location title finish before the first HUD proof;
         thrust is readable only when it is not beneath a full-width
         district introduction. */
      /* Auto-stow waits six calm seconds, then needs its authored
         0.85s travel. Start the proof from the completed back carry
         so ignition has the full draw animation to reverse. */
      T.advanceTime(7, 1 / 30);
    });

    const report = {
      build: await page.evaluate(() => window.__SF?.version || window.__SF_BOOT?.build || null),
      sourceBefore: before,
      checks: [],
      states: {},
      collision: null,
      errors,
    };
    const check = (name, pass, detail) => report.checks.push({ name, pass: !!pass, detail });
    const step = (seconds, dt = 1 / 60) => page.evaluate(({ seconds, dt }) => {
      window.__SF.advanceTime(seconds, dt);
      return window.__SF.jetpackState();
    }, { seconds, dt });

    async function capture(
      label,
      bearings = [0, 60, 120, 180, 240, 300],
      { radius = 5.4, fov = 54, targetY = 1.05 } = {}
    ) {
      const files = [];
      for (const bearing of bearings) {
        const data = await page.evaluate(({ bearing, radius, fov, targetY }) => {
          const T = window.__SF;
          const p = T.player.state;
          const a = bearing * Math.PI / 180;
          const target = new T.THREE.Vector3(p.x, p.y + targetY, p.z);
          const camera = T.render.camera;
          camera.position.set(
            p.x + Math.sin(a) * radius,
            p.y + 1.72 + (bearing === 180 ? -0.18 : 0.12),
            p.z + Math.cos(a) * radius
          );
          camera.lookAt(target);
          camera.fov = fov;
          camera.updateProjectionMatrix();
          T.render.render(camera);
          return T.captureDataURL();
        }, { bearing, radius, fov, targetY });
        const file = path.join(outDir, `${label}-${String(bearing).padStart(3, "0")}.png`);
        await saveDataUrl(file, data);
        files.push(path.basename(file));
      }
      return files;
    }

    async function measurePack() {
      return page.evaluate(() => {
        const T = window.__SF;
        const J = T.jetpack;
        const THREE = T.THREE;
        J.visual.root.updateMatrixWorld(true);
        const rootInverse = new THREE.Matrix4().copy(J.visual.root.matrixWorld).invert();
        const bounds = new THREE.Box3();
        const local = new THREE.Box3();
        const matrix = new THREE.Matrix4();
        J.visual.root.traverse((o) => {
          if (!o.isMesh || o.name.includes("flame")) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          local.copy(o.geometry.boundingBox);
          matrix.multiplyMatrices(rootInverse, o.matrixWorld);
          local.applyMatrix4(matrix);
          bounds.union(local);
        });
        const size = bounds.getSize(new THREE.Vector3());
        const nodes = [];
        J.visual.root.traverse((o) => nodes.push({
          name: o.name || "",
          type: o.geometry?.type || o.type || "",
        }));
        const nodeCount = (name) => nodes.filter((o) => o.name === name).length;
        const legacyPropulsionNodes = nodes
          .filter((o) => /^jetpack-(?:pod|nozzle)-(?:l|r)(?:$|-)/.test(o.name))
          .map((o) => o.name);
        const nozzleWorld = J.visual.nozzles.map(
          (n) => n.getWorldPosition(new THREE.Vector3())
        );
        const nozzleLocal = nozzleWorld.map(
          (p) => p.clone().applyMatrix4(rootInverse).toArray()
        );
        const geometrySize = (name) => {
          const o = J.visual.root.getObjectByName(name);
          if (!o?.geometry) return null;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          return o.geometry.boundingBox.getSize(new THREE.Vector3()).toArray();
        };
        const palette = J.visual.materials.map((material) => {
          const colorHsl = { h: 0, s: 0, l: 0 };
          const emissiveHsl = { h: 0, s: 0, l: 0 };
          material.color?.getHSL(colorHsl);
          material.emissive?.getHSL(emissiveHsl);
          return {
            name: material.name || "",
            color: material.color?.getHexString?.() || null,
            hue: Number(colorHsl.h.toFixed(4)),
            saturation: Number(colorHsl.s.toFixed(4)),
            emissive: material.emissive?.getHexString?.() || null,
            emissiveHue: Number(emissiveHsl.h.toFixed(4)),
            emissiveSaturation: Number(emissiveHsl.s.toFixed(4)),
          };
        });
        return {
          solidBounds: size.toArray(),
          nozzleCount: J.visual.nozzles.length,
          nozzleNames: J.visual.nozzles.map((n) => n.name),
          nozzleParents: J.visual.nozzles.map((n) => n.parent?.name || null),
          nozzleLocal,
          centralThrusterCount: nodeCount("jetpack-central-thruster"),
          centralHousingCount: nodeCount("jetpack-central-thruster-housing"),
          centralApertureCount: nodeCount("jetpack-central-thruster-aperture"),
          centralHousingSize: geometrySize("jetpack-central-thruster-housing"),
          centralApertureSize: geometrySize("jetpack-central-thruster-aperture"),
          centralHousingGeometry: J.visual.root
            .getObjectByName("jetpack-central-thruster-housing")?.geometry?.type || null,
          centralApertureGeometry: J.visual.root
            .getObjectByName("jetpack-central-thruster-aperture")?.geometry?.type || null,
          legacyPropulsionNodes,
          wingSpread: J.visual.root.userData.wingSpread || 0,
          wingNames: J.visual.wings.map((w) => w.root.name),
          featherCounts: J.visual.wings.map((w) => w.feathers.length),
          flamePairCount: J.visual.flames.length,
          flames: J.visual.flames.map((f) => ({
            outerName: f.outer.name,
            innerName: f.inner.name,
            outerParent: f.outer.parent?.name || null,
            innerParent: f.inner.parent?.name || null,
            outerGeometry: f.outer.geometry?.type || null,
            innerGeometry: f.inner.geometry?.type || null,
            outerVisible: f.outer.visible,
            innerVisible: f.inner.visible,
            opacity: f.outer.material.opacity,
          })),
          palette,
        };
      });
    }

    function measureVerticalStow(state) {
      const lateral = state.tipLat - state.buttLat;
      const fore = state.tipFore - state.buttFore;
      const up = state.tipUp - state.buttUp;
      const length = Math.hypot(lateral, fore, up);
      const verticalErrorDeg = length > 0
        ? Math.acos(Math.min(1, Math.abs(up) / length)) * 180 / Math.PI
        : 180;
      return {
        length: Number(length.toFixed(3)),
        verticalErrorDeg: Number(verticalErrorDeg.toFixed(2)),
        lateralCenter: Number(((state.tipLat + state.buttLat) * 0.5).toFixed(3)),
        lateralMin: Number(Math.min(state.tipLat, state.buttLat).toFixed(3)),
        lateralMax: Number(Math.max(state.tipLat, state.buttLat).toFixed(3)),
        foreCenter: Number(((state.tipFore + state.buttFore) * 0.5).toFixed(3)),
      };
    }

    report.states.idle = await page.evaluate(() => window.__SF.jetpackState());
    report.states.idleWeapon = await page.evaluate(() => window.__SF.stowState());
    report.states.idleWeaponMount = measureVerticalStow(report.states.idleWeapon);
    check("weapon is sheathed before ignition", report.states.idleWeapon.stowed
      && report.states.idleWeapon.phase >= 0.98,
    JSON.stringify(report.states.idleWeapon));
    check("sheathed lance is vertical within seven degrees",
      report.states.idleWeaponMount.verticalErrorDeg <= 7
        && report.states.idleWeaponMount.length >= 1.35,
      JSON.stringify(report.states.idleWeaponMount));
    check("sheathed lance occupies the right-side rear cradle",
      /* The imported Meshy rig's anatomical right is negative in the
         QA body-lateral convention (rear-view screen right). */
      report.states.idleWeaponMount.lateralMin >= -0.90
        && report.states.idleWeaponMount.lateralMax <= -0.22
        && report.states.idleWeaponMount.foreCenter <= -0.12
        && report.states.idleWeaponMount.foreCenter >= -0.90,
      JSON.stringify(report.states.idleWeaponMount));
    report.states.idleVisual = await measurePack();
    const [foldW, foldH, foldD] = report.states.idleVisual.solidBounds;
    check("seraph wings fold into a compact grounded silhouette",
      foldW <= 0.82 && foldH <= 1.10 && foldD <= 0.32
        && report.states.idleVisual.wingSpread <= 0.03,
      JSON.stringify(report.states.idleVisual));
    check("seraph rig exposes two symmetric five-feather wings",
      report.states.idleVisual.wingNames.join(",") === "jetpack-wing-l,jetpack-wing-r"
        && report.states.idleVisual.featherCounts.every((n) => n === 5),
      JSON.stringify(report.states.idleVisual));
    const central = report.states.idleVisual;
    check("one centered nozzle replaces both legacy propulsion pods",
      central.nozzleCount === 1
        && central.nozzleNames[0] === "jetpack-nozzle-center"
        && central.nozzleParents[0] === "jetpack-central-thruster"
        && Math.abs(central.nozzleLocal[0]?.[0] ?? Infinity) <= 0.005
        && central.legacyPropulsionNodes.length === 0,
      JSON.stringify({ nozzles: central.nozzleNames, parents: central.nozzleParents,
        local: central.nozzleLocal, legacy: central.legacyPropulsionNodes }));
    const [housingW = 0, housingH = 0, housingD = Infinity]
      = central.centralHousingSize || [];
    const [apertureW = 0, apertureH = Infinity, apertureD = 0]
      = central.centralApertureSize || [];
    check("central thruster is a shallow rectangular vector cell",
      central.centralThrusterCount === 1
        && central.centralHousingCount === 1
        && central.centralApertureCount === 1
        && central.centralHousingGeometry === "ExtrudeGeometry"
        && central.centralApertureGeometry === "BoxGeometry"
        && housingW >= 0.07 && housingW <= 0.12
        && housingH >= 0.28 && housingH <= 0.34
        && housingD <= 0.075
        && apertureW >= 0.08 && apertureW <= 0.12
        && apertureH <= 0.026
        && apertureD >= 0.07 && apertureD <= 0.11,
      JSON.stringify({ count: central.centralThrusterCount,
        housing: central.centralHousingSize, aperture: central.centralApertureSize,
        geometry: [central.centralHousingGeometry, central.centralApertureGeometry] }));
    check("central thruster owns exactly one rectangular flame pair",
      central.flamePairCount === 1
        && central.flames[0]?.outerName === "jetpack-nozzle-center-flame-outer"
        && central.flames[0]?.innerName === "jetpack-nozzle-center-flame-inner"
        && central.flames[0]?.outerParent === "jetpack-nozzle-center"
        && central.flames[0]?.innerParent === "jetpack-nozzle-center"
        && central.flames[0]?.outerGeometry === "BufferGeometry"
        && central.flames[0]?.innerGeometry === "BufferGeometry",
      JSON.stringify(central.flames));
    const cyanMaterials = central.palette.filter((m) =>
      (m.saturation >= 0.25 && m.hue >= 0.44 && m.hue <= 0.68)
        || (m.emissiveSaturation >= 0.25
          && m.emissiveHue >= 0.44 && m.emissiveHue <= 0.68)
    );
    const goldStructural = central.palette.filter((m) =>
      m.name.startsWith("jetpack-seraph-")
        && m.saturation >= 0.35 && m.hue >= 0.05 && m.hue <= 0.17
    );
    check("seraph structure uses sacred gold without cyan remnants",
      cyanMaterials.length === 0 && goldStructural.length >= 3,
      JSON.stringify({ goldStructural: goldStructural.map((m) => m.name), cyanMaterials }));
    report.states.idleShots = await capture("idle", [0, 180, 270]);
    report.states.idleDetailShots = await capture(
      "idle-detail", [90, 180, 270], { radius: 2.75, fov: 46, targetY: 1.12 }
    );

    // Real DOM input is deliberate: this also proves key mapping and
    // browser event cleanup instead of only exercising QA injection.
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("Space");
    report.states.weaponDrawSamples = [];
    report.states.wingDrawSamples = [];
    for (let i = 0; i < 3; i += 1) {
      report.states.ignition = await step(0.14);
      report.states.weaponDrawSamples.push(await page.evaluate(() => window.__SF.stowState()));
      report.states.wingDrawSamples.push(await page.evaluate(() => window.__SF.jetpackState()));
      if (i < 2) await capture(`draw-${i === 0 ? "early" : "mid"}`, [120, 180, 240]);
    }
    report.states.flightWeapon = await page.evaluate(() => window.__SF.stowState());
    const drawPhases = report.states.weaponDrawSamples.map((s) => s.phase);
    check("weapon draw progresses smoothly during ignition",
      drawPhases[0] < 0.78 && drawPhases[0] > 0.12
        && drawPhases[1] < drawPhases[0] - 0.18
        && drawPhases[1] <= 0.05
        && drawPhases[2] <= 0.02,
      JSON.stringify(report.states.weaponDrawSamples));
    check("ignition visibly completes the weapon draw",
      !report.states.flightWeapon.stowed
        && report.states.flightWeapon.phase <= 0.02
        && report.states.flightWeapon.handRelease <= 0.02,
    JSON.stringify(report.states.flightWeapon));
    check("wings wait for the lance to clear before fanning",
      report.states.wingDrawSamples[0].wingSpread <= 0.08
        && report.states.weaponDrawSamples[0].phase > 0.05
        && report.states.weaponDrawSamples[1].phase <= 0.02
        && report.states.wingDrawSamples[1].wingSpread > 0.55
        && report.states.wingDrawSamples[2].wingSpread > report.states.wingDrawSamples[1].wingSpread,
      JSON.stringify(report.states.wingDrawSamples));
    report.states.deployed = await step(0.18);
    report.states.ignitionVisual = await measurePack();
    const [packW, packH, packD] = report.states.ignitionVisual.solidBounds;
    check("powered seraph wings deploy to a controlled heroic span",
      packW >= 1.35 && packW <= 1.75
        && packH >= 0.70 && packH <= 1.16 && packD <= 0.42
        && report.states.ignitionVisual.nozzleCount === 1
        && Math.abs(report.states.ignitionVisual.nozzleLocal[0]?.[0] ?? Infinity) <= 0.005
        && report.states.ignitionVisual.wingSpread >= 0.94
        && report.states.ignition.wallTuckL <= 0.05
        && report.states.ignition.wallTuckR <= 0.05,
      JSON.stringify({ bounds: report.states.ignitionVisual.solidBounds,
        nozzle: report.states.ignitionVisual.nozzleLocal }));
    check("the sole rectangular exhaust pair burns during powered flight",
      report.states.ignitionVisual.flamePairCount === 1
        && report.states.ignitionVisual.flames[0]?.outerVisible
        && report.states.ignitionVisual.flames[0]?.innerVisible,
      JSON.stringify(report.states.ignitionVisual.flames));
    check("real Shift+Space ignites", report.states.ignition.active
      && report.states.ignition.inFlight && report.states.ignition.fuel < 95,
    JSON.stringify(report.states.ignition));
    await page.screenshot({ path: path.join(outDir, "hud-thrust.png") });
    report.states.takeoffShots = await capture("takeoff");
    report.states.takeoffDetailShots = await capture(
      "takeoff-detail", [120, 180, 240], { radius: 2.9, fov: 48, targetY: 1.12 }
    );

    await page.keyboard.down("KeyW");
    const start = await page.evaluate(() => ({ ...window.__SF.player.position }));
    report.states.flight = await step(2.0);
    const end = await page.evaluate(() => ({ ...window.__SF.player.position }));
    const travelled = Math.hypot(end.x - start.x, end.z - start.z);
    check("powered flight is materially faster than sprint", travelled > 32,
      `${travelled.toFixed(2)}m in 2s`);
    check("flight stays below altitude cap", end.y - await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state;
      return T.collide.groundHeight(p.x, p.z);
    }) <= 10.12, `position ${JSON.stringify(end)}`);
    report.states.flightShots = await capture("flight");

    await page.keyboard.up("Space");
    report.states.glide = await step(0.35);
    report.states.glideVisual = await measurePack();
    check("glide opens wider and flatter than powered flight",
      report.states.glideVisual.solidBounds[0] > packW + 0.035
        && report.states.glideVisual.solidBounds[1] < packH + 0.04,
      JSON.stringify({ powered: report.states.ignitionVisual.solidBounds,
        glide: report.states.glideVisual.solidBounds }));
    report.states.glideWeapon = await page.evaluate(() => window.__SF.stowState());
    check("release cuts thrust", !report.states.glide.active && report.states.glide.inFlight,
      JSON.stringify(report.states.glide));
    check("weapon remains drawn throughout glide", report.states.glideWeapon.phase <= 0.02,
      JSON.stringify(report.states.glideWeapon));
    report.states.glideShots = await capture("glide");
    await page.keyboard.up("KeyW");
    await page.keyboard.up("ShiftLeft");

    let landed = null;
    for (let i = 0; i < 12 * 60; i += 1) {
      landed = await step(1 / 60);
      if (landed.grounded) break;
    }
    /* Terrain-rim handoff intentionally preserves the resolved
       flight height on its first grounded frame, then eases onto the
       center walking support. Let that short visible settle finish
       before applying the exact foot-height gate. */
    if (landed?.grounded) landed = await step(0.25);
    report.states.landed = landed;
    const landGround = await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state;
      return { y: p.y, ground: T.collide.groundHeight(p.x, p.z), blocked: T.collide.blocked(p.x, p.z, p.y) };
    });
    check("glide lands on an open support", landed?.grounded && !landGround.blocked
      && Math.abs(landGround.y - landGround.ground) <= 0.02, JSON.stringify(landGround));
    report.states.landingShots = await capture("landing");

    // Boundary fuel test: 18 units includes the ignition charge and
    // cannot sustain a two-second hold.
    await page.evaluate(() => window.__SF.setJetpackState({ fuel: 18, cooldownRemaining: 0, rechargeDelayRemaining: 0 }));
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("Space");
    report.states.lowFuelStart = await step(0.15);
    report.states.exhausted = await step(1.4);
    check("fuel exhausts and clamps at zero", report.states.exhausted.fuel === 0
      && !report.states.exhausted.active && report.states.exhausted.lockedOut,
    JSON.stringify(report.states.exhausted));
    await page.screenshot({ path: path.join(outDir, "hud-empty.png") });
    report.states.emptyShots = await capture("empty", [60, 180, 300]);
    const heldAfterEmpty = await step(0.5);
    check("holding after burnout cannot relight", !heldAfterEmpty.active && heldAfterEmpty.fuel === 0,
      JSON.stringify(heldAfterEmpty));
    await page.keyboard.up("Space");
    await page.keyboard.up("ShiftLeft");
    for (let i = 0; i < 12 * 60; i += 1) {
      const s = await step(1 / 60);
      if (s.grounded) break;
    }
    const beforeDelay = await step(2.0);
    const afterDelay = await step(3.0);
    check("empty pack cools before grounded recharge", beforeDelay.fuel === 0 && afterDelay.fuel > 0,
      `2s=${beforeDelay.fuel}, 5s=${afterDelay.fuel}`);

    // A standalone sweep proof against a real Cathedral flight cell.
    report.collision = await page.evaluate(() => {
      const T = window.__SF;
      const C = T.collide;
      let found = null;
      for (let z = -760; z <= -660 && !found; z += 1) {
        for (let x = -145; x <= -45; x += 1) {
          const y = C.groundHeight(x, z) + 5;
          if (!C.flightBlocked(x, z, y)) continue;
          for (const [dx, dz] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) {
            if (C.flightBlocked(x + dx, z + dz, y)) continue;
            const out = C.sweepFlightCapsule(x + dx, y, z + dz, x - dx, y, z - dz);
            found = {
              obstacle: [x, y, z], start: [x + dx, y, z + dz], requested: [x - dx, y, z - dz],
              result: out, resultBlocked: C.flightBlocked(out.x, out.z, out.y),
            };
            break;
          }
          if (found) break;
        }
      }
      return found;
    });
    check("aerial sweep stops at elevated Cathedral geometry",
      report.collision && report.collision.result.blocked && !report.collision.resultBlocked,
      JSON.stringify(report.collision));

    // Terrain is a flight boundary too. This Fosse bank rises more
    // than twenty metres across the attempted three-metre segment;
    // an endpoint-only aerial grid once crossed it and the controller
    // snapped the player onto the ridge on the following frame.
    report.terrainSweep = await page.evaluate(() => {
      const T = window.__SF;
      const C = T.collide;
      const x = -652; const z = 315;
      /* Start genuinely airborne and clear of the bank. Beginning at
         z=316 on the ground already puts this radius across the
         cliff face, which cannot distinguish a bad result from an
         invalid initial overlap. */
      const y = C.groundHeight(x, z) + 1;
      const targetGround = C.groundHeight(x, z + 4);
      const result = C.sweepFlightCapsule(x, y, z, x, y, z + 4);
      const denseOffsets = [[0, 0]];
      for (let ring = 1; ring <= 8; ring += 1) {
        const r = C.radius * ring / 8;
        for (let deg = 0; deg < 360; deg += 2) {
          const a = deg * Math.PI / 180;
          denseOffsets.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
      }
      let maxGround = Math.max(...denseOffsets.map(([dx, dz]) =>
        C.groundHeight(result.x + dx, result.z + dz)));
      const gridStep = T.ctx.terrain.groundSampleStep;
      const minGX = Math.ceil((result.x - C.radius + 1024) / gridStep);
      const maxGX = Math.floor((result.x + C.radius + 1024) / gridStep);
      const minGZ = Math.ceil((result.z - C.radius + 1024) / gridStep);
      const maxGZ = Math.floor((result.z + C.radius + 1024) / gridStep);
      for (let gx = minGX; gx <= maxGX; gx += 1) {
        for (let gz = minGZ; gz <= maxGZ; gz += 1) {
          const px = gx * gridStep - 1024;
          const pz = gz * gridStep - 1024;
          if ((px - result.x) ** 2 + (pz - result.z) ** 2 <= C.radius ** 2 + 1e-9) {
            maxGround = Math.max(maxGround, C.groundHeight(px, pz));
          }
        }
      }
      return {
        start: [x, y, z], targetGround, result,
        approachDistance: result.z - z,
        maxCapsuleGround: maxGround,
        terrainPenetration: maxGround - result.y,
      };
    });
    check("flight sweep cannot tunnel through steep terrain",
      report.terrainSweep.result.hitZ
        && report.terrainSweep.result.z < 318
        && report.terrainSweep.approachDistance >= 0.20
        && report.terrainSweep.result.y + 0.12 >= report.terrainSweep.start[1],
      JSON.stringify(report.terrainSweep));
    check("flight sweep keeps the whole capsule above steep terrain",
      report.terrainSweep.terrainPenetration <= 0.025,
      JSON.stringify(report.terrainSweep));

    report.authoredFootprint = await page.evaluate(() => {
      const T = window.__SF;
      const C = T.collide;
      const x = -66.418158;
      const z = -443.940060;
      const footprint = C.flightGroundHeight(x, z, C.radius);
      const authoredVertex = T.ctx.world.walkSurfaceMaxInCircle(x, z, C.radius);
      return {
        x, z, footprint, authoredVertex,
        blocksThreeCmBelow: C.flightBlocked(x, z, footprint - 0.03),
        clearsThreeCmAbove: !C.flightBlocked(x, z, footprint + 0.03),
      };
    });
    check("flight footprint includes authored road vertices",
      Number.isFinite(report.authoredFootprint.authoredVertex)
        && report.authoredFootprint.footprint + 1e-6
          >= report.authoredFootprint.authoredVertex
        && report.authoredFootprint.blocksThreeCmBelow
        && report.authoredFootprint.clearsThreeCmAbove,
      JSON.stringify(report.authoredFootprint));

    /* Controller-level proof of the reported path: ignite with real
       Shift+Space, hold real W into the same Fosse bank, and inspect
       every resolved frame over a dense full-disk capsule footprint.
       The old collision primitive called an uphill overlap a
       fresh takeoff and allowed the feet 0.82m under the hill for a
       frame even though its final endpoint looked blocked. */
    await page.evaluate(() => {
      const T = window.__SF;
      T.clearEnemies();
      T.releaseCamera();
      T.teleport(-652, 315.30, 0);
      T.setCam(0, -0.04, 5.2);
      T.setGaitInput(null, null);
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
    });
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("Space");
    await step(0.06);
    await page.keyboard.down("KeyW");
    report.hillContact = await page.evaluate(() => {
      const T = window.__SF;
      const p = T.player.state;
      const C = T.collide;
      /* Launch clearance has already done its job. Clearing this
         latch makes the hill contact prove ordinary airborne rules,
         not the intentionally bounded takeoff exemption. */
      const denseOffsets = [[0, 0]];
      for (let ring = 1; ring <= 8; ring += 1) {
        const r = C.radius * ring / 8;
        for (let deg = 0; deg < 360; deg += 2) {
          const a = deg * Math.PI / 180;
          denseOffsets.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
      }
      const maxFootprintGround = (x, z) => {
        let high = -Infinity;
        for (const [dx, dz] of denseOffsets) {
          high = Math.max(high, C.groundHeight(x + dx, z + dz));
        }
        const gridStep = T.ctx.terrain.groundSampleStep;
        const minGX = Math.ceil((x - C.radius + 1024) / gridStep);
        const maxGX = Math.floor((x + C.radius + 1024) / gridStep);
        const minGZ = Math.ceil((z - C.radius + 1024) / gridStep);
        const maxGZ = Math.floor((z + C.radius + 1024) / gridStep);
        for (let gx = minGX; gx <= maxGX; gx += 1) {
          for (let gz = minGZ; gz <= maxGZ; gz += 1) {
            const px = gx * gridStep - 1024;
            const pz = gz * gridStep - 1024;
            if ((px - x) ** 2 + (pz - z) ** 2 <= C.radius ** 2 + 1e-9) {
              high = Math.max(high, C.groundHeight(px, pz));
            }
          }
        }
        return high;
      };
      const startGround = C.groundHeight(p.x, p.z);
      const startMaxGround = maxFootprintGround(p.x, p.z);
      /* Start clear across the full capsule footprint, but still inside the old
         +STEP proximity test so a regression would re-arm its false
         takeoff exemption on the first high-speed frame. */
      p.y = startMaxGround + 0.03;
      p.vy = 0;
      p.speed = T.jetpack.config.cruiseSpeed;
      p.grounded = false;
      T.jetpack.state.takeoffClearing = false;
      const startedInFlight = T.jetpack.state.inFlight;
      const startedActive = T.jetpack.state.active;
      const blockedBefore = T.jetpack.state.blockedFrames;
      let minClearance = Infinity;
      let maxUpStep = 0;
      let maxForwardProgress = 0;
      let poweredFrames = 0;
      let worst = null;
      let previousY = p.y;
      const samples = [];
      for (let frame = 0; frame < 120; frame += 1) {
        T.renderOnce(1 / 60);
        const maxGround = maxFootprintGround(p.x, p.z);
        const clearance = p.y - maxGround;
        const upStep = p.y - previousY;
        previousY = p.y;
        maxUpStep = Math.max(maxUpStep, upStep);
        maxForwardProgress = Math.max(maxForwardProgress, p.z - 315.30);
        if (T.jetpack.state.inFlight && T.jetpack.state.active) poweredFrames += 1;
        if (clearance < minClearance) {
          minClearance = clearance;
          worst = { frame, x: p.x, y: p.y, z: p.z, maxGround, clearance };
        }
        if (frame % 15 === 0) {
          samples.push({ frame, x: p.x, y: p.y, z: p.z, maxGround, clearance });
        }
      }
      return {
        start: {
          x: -652, z: 315.30, ground: startGround, maxGround: startMaxGround,
          y: startMaxGround + 0.03,
        },
        end: { x: p.x, y: p.y, z: p.z },
        startedInFlight,
        startedActive,
        poweredFrames,
        maxForwardProgress,
        minClearance,
        maxUpStep,
        blockedFrames: T.jetpack.state.blockedFrames - blockedBefore,
        climbStepLimit: T.jetpack.config.climbSpeed / 60 + 0.05,
        worst,
        samples,
      };
    });
    await page.screenshot({ path: path.join(outDir, "hill-contact.png") });
    await page.keyboard.up("KeyW");
    await page.keyboard.up("Space");
    await page.keyboard.up("ShiftLeft");
    check("powered flight contacts the Fosse hill without entering it",
      report.hillContact.blockedFrames > 0
        && report.hillContact.startedInFlight
        && report.hillContact.startedActive
        && report.hillContact.poweredFrames >= 60
        && report.hillContact.maxForwardProgress >= 1.0
        && report.hillContact.minClearance >= -0.025
        && report.hillContact.maxUpStep <= report.hillContact.climbStepLimit,
      JSON.stringify(report.hillContact));

    report.slopeTakeoff = await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state;
      T.teleport(-576, 332, 0);
      const ground = T.collide.groundHeight(p.x, p.z);
      T.setJetInput(true);
      T.advanceTime(0.06, 1 / 60);
      const sawTakeoffClearing = T.jetpack.state.takeoffClearing;
      let clearFrames = 0;
      while (T.jetpack.state.takeoffClearing && clearFrames < 60) {
        T.advanceTime(1 / 60, 1 / 60);
        clearFrames += 1;
      }
      const clearedTakeoff = !T.jetpack.state.takeoffClearing;
      const before = [p.x, p.z];
      T.player.input.keys.add("KeyW");
      T.advanceTime(0.5, 1 / 60);
      T.player.input.keys.delete("KeyW");
      const horizontalProgress = Math.hypot(p.x - before[0], p.z - before[1]);
      const out = {
        ...T.jetpackState(), ground, sawTakeoffClearing,
        clearedTakeoff, clearFrames, horizontalProgress,
      };
      T.setJetInput(false); T.advanceTime(0.05, 1 / 60);
      return out;
    });
    check("a walking-legal slope can launch vertically",
      report.slopeTakeoff.active
        && report.slopeTakeoff.sawTakeoffClearing
        && report.slopeTakeoff.clearedTakeoff
        && report.slopeTakeoff.clearFrames < 60
        && report.slopeTakeoff.y - report.slopeTakeoff.ground > 1
        && report.slopeTakeoff.horizontalProgress >= 0.5,
      JSON.stringify(report.slopeTakeoff));

    /* A strict disk capsule contacts the uphill rim before its center
       reaches walking ground. That must hand off to terrain landing,
       not be mistaken for a roof and drift forever. */
    report.slopeLanding = await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state;
      /* This point sits in the old 0.36-1.05m gap: every direction
         passes the grounded controller's step/sustained-slope gates,
         and ordinary KeyW traversal climbs it, but a fixed 0.36m
         landing cutoff treated the capsule rim as a roof forever. */
      const x = 154.5163302217;
      const z = -68.5529218521;
      T.player.input.clearAll();
      T.teleport(x, z, 0);
      const support = T.collide.groundHeight(x, z);
      const footprintSupport = T.collide.flightGroundHeight(x, z, T.collide.radius);
      const centerBlocked = T.collide.blocked(x, z, support);
      p.y = support + 2;
      p.vy = -6;
      p.grounded = false;
      p.speed = 0;
      Object.assign(T.jetpack.state, {
        inFlight: true, active: false, requested: false,
        takeoffClearing: false, fuel: 50,
        cooldownRemaining: 0, rechargeDelayRemaining: 0,
      });
      const landingsBefore = T.jetpack.state.landings;
      let framesToGround = null;
      let maxDownStep = 0;
      let previousY = p.y;
      let yAtGround = null;
      for (let frame = 1; frame <= 720; frame += 1) {
        T.renderOnce(1 / 60);
        maxDownStep = Math.max(maxDownStep, previousY - p.y);
        previousY = p.y;
        if (p.grounded) {
          framesToGround = frame;
          yAtGround = p.y;
          break;
        }
      }
      const fuelAtLanding = T.jetpack.state.fuel;
      let maxPostLandingDownStep = 0;
      previousY = p.y;
      for (let frame = 0; frame < 4; frame += 1) {
        T.renderOnce(0.1);
        maxPostLandingDownStep = Math.max(maxPostLandingDownStep, previousY - p.y);
        previousY = p.y;
      }
      for (let frame = 0; frame < 300; frame += 1) T.renderOnce(1 / 60);
      return {
        support,
        footprintSupport,
        footprintRise: footprintSupport - support,
        centerBlocked,
        framesToGround,
        maxDownStep,
        maxPostLandingDownStep,
        yAtGround,
        footprintDropAtGround: yAtGround === null ? null : footprintSupport - yAtGround,
        grounded: p.grounded,
        inFlight: T.jetpack.state.inFlight,
        y: p.y,
        fuelAtLanding,
        fuelAfterRecharge: T.jetpack.state.fuel,
        landings: T.jetpack.state.landings - landingsBefore,
      };
    });
    check("steep walkable slope lands and resumes recharge",
      report.slopeLanding.footprintRise > 0.40
        && report.slopeLanding.footprintRise < 1.05
        && !report.slopeLanding.centerBlocked
        && report.slopeLanding.framesToGround !== null
        && report.slopeLanding.framesToGround < 120
        && report.slopeLanding.maxDownStep <= 0.205
        && report.slopeLanding.maxPostLandingDownStep <= 0.155
        && report.slopeLanding.footprintDropAtGround <= 0.025
        && report.slopeLanding.grounded
        && !report.slopeLanding.inFlight
        && Math.abs(report.slopeLanding.y - report.slopeLanding.support) <= 0.02
        && report.slopeLanding.landings === 1
        && report.slopeLanding.fuelAfterRecharge > report.slopeLanding.fuelAtLanding,
      JSON.stringify(report.slopeLanding));

    report.groundedUphill = await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state; const C = T.collide;
      const x = 154.5163302217;
      const z = -68.5529218521;
      const startGround = C.groundHeight(x, z);
      let best = null;
      for (let i = 0; i < 64; i += 1) {
        const yaw = i * Math.PI * 2 / 64;
        const dx = Math.sin(yaw);
        const dz = Math.cos(yaw);
        const nearGround = C.groundHeight(x + dx * 0.45, z + dz * 0.45);
        const farRise = C.groundHeight(x + dx * 1.6, z + dz * 1.6) - startGround;
        const nearRise = nearGround - startGround;
        if (nearRise > 0.05 && nearRise <= 1.05 && farRise / 1.6 < 1.7
          && (!best || nearRise > best.nearRise)) {
          best = { yaw, nearRise, farRise };
        }
      }
      if (!best) return null;
      T.player.input.clearAll();
      T.teleport(x, z, best.yaw);
      p.speed = 4.4;
      T.player.input.keys.add("KeyW");
      const beforeY = p.y;
      T.renderOnce(0.1);
      T.player.input.keys.delete("KeyW");
      const support = C.groundHeight(p.x, p.z);
      return {
        ...best,
        distance: Math.hypot(p.x - x, p.z - z),
        supportRise: support - startGround,
        bodyRise: p.y - beforeY,
        remainingEase: support - p.y,
      };
    });
    check("low-FPS grounded uphill motion keeps its eased vertical handoff",
      report.groundedUphill
        && report.groundedUphill.distance > 0.2
        && report.groundedUphill.supportRise > 0.05
        && report.groundedUphill.bodyRise > 0
        && report.groundedUphill.remainingEase > 0.002,
      JSON.stringify(report.groundedUphill));

    report.extremeRimLanding = await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state; const C = T.collide;
      const x = 597.8852967732;
      const z = 172.1405016491;
      T.player.input.clearAll();
      T.teleport(x, z, 0);
      const initialCenter = C.groundHeight(x, z);
      const initialFootprint = C.flightGroundHeight(x, z, C.radius);
      const initialGroundBlocked = C.blocked(x, z, initialCenter);
      p.y = initialFootprint + 2;
      p.vy = -6;
      p.grounded = false;
      p.speed = 0;
      Object.assign(T.jetpack.state, {
        inFlight: true, active: false, requested: false,
        takeoffClearing: false, fuel: 50,
        cooldownRemaining: 0, rechargeDelayRemaining: 0,
      });
      let previousY = p.y;
      let maxDownStep = 0;
      let minFlightClearance = Infinity;
      let landingRise = null;
      let framesToGround = null;
      for (let frame = 1; frame <= 360; frame += 1) {
        T.renderOnce(1 / 60);
        maxDownStep = Math.max(maxDownStep, previousY - p.y);
        previousY = p.y;
        const footprint = C.flightGroundHeight(p.x, p.z, C.radius);
        if (T.jetpack.state.inFlight) {
          minFlightClearance = Math.min(minFlightClearance, p.y - footprint);
        }
        if (p.grounded) {
          framesToGround = frame;
          landingRise = footprint - C.groundHeight(p.x, p.z);
          break;
        }
      }
      return {
        initialCenter,
        initialFootprint,
        initialRise: initialFootprint - initialCenter,
        initialGroundBlocked,
        maxDownStep,
        minFlightClearance,
        framesToGround,
        landingRise,
        end: { x: p.x, y: p.y, z: p.z, grounded: p.grounded },
      };
    });
    check("extreme hill rim never becomes a center-support teleport",
      report.extremeRimLanding.initialRise > 1
        && !report.extremeRimLanding.initialGroundBlocked
        && report.extremeRimLanding.maxDownStep <= 0.205
        && report.extremeRimLanding.minFlightClearance >= -0.025
        && (report.extremeRimLanding.framesToGround === null
          || report.extremeRimLanding.landingRise <= 1.05),
      JSON.stringify(report.extremeRimLanding));

    report.diagonalSweep = await page.evaluate(() => {
      const C = window.__SF.collide;
      const start = [621.55, 25.258, 720];
      const end = [618.45, 23.998, 720];
      return { start, end, result: C.sweepFlightCapsule(...start, ...end) };
    });
    check("combined descending sweep catches diagonal roof contact",
      report.diagonalSweep.result.hitY && report.diagonalSweep.result.y > 24.45,
      JSON.stringify(report.diagonalSweep));

    report.aerialCoverRay = await page.evaluate(() => {
      const C = window.__SF.collide;
      return C.rayBlock(605, 12, 778, 0, 1, 0, 20);
    });
    check("flight-only decks block combat sight rays",
      Number.isFinite(report.aerialCoverRay) && report.aerialCoverRay < 8,
      String(report.aerialCoverRay));

    report.poweredRoof = await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state;
      T.teleport(605, 778, 0); T.setJetInput(true); T.advanceTime(0.06, 1 / 60);
      p.y = 19.15; p.vy = -8; p.grounded = false;
      T.jetpack.state.inFlight = true; T.jetpack.state.active = true;
      T.player.input.keys.add("ControlLeft");
      const before = [p.x, p.z];
      T.advanceTime(0.1, 0.1);
      const out = { moved: Math.hypot(p.x - before[0], p.z - before[1]), state: T.jetpackState() };
      T.player.input.keys.delete("ControlLeft"); T.setJetInput(false);
      return out;
    });
    check("powered roof contact never triggers landing assist",
      report.poweredRoof.moved < 0.02 && report.poweredRoof.state.active,
      JSON.stringify(report.poweredRoof));

    report.broadRoof = await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state;
      T.teleport(448, -900, 0);
      p.y = 12.8; p.vy = -6; p.grounded = false;
      T.jetpack.state.inFlight = true; T.jetpack.state.active = false;
      const before = [p.x, p.z];
      T.advanceTime(1.5, 0.1);
      return { moved: Math.hypot(p.x - before[0], p.z - before[1]), state: T.jetpackState() };
    });
    check("unpowered broad-roof contact cannot become an infinite hover",
      report.broadRoof.state.grounded || report.broadRoof.moved > 0.5,
      JSON.stringify(report.broadRoof));

    report.terrainDrop = await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state;
      T.teleport(-652, 319, Math.PI);
      T.setJetInput(true);
      T.advanceTime(0.05, 0.05);
      const highGround = T.collide.groundHeight(-652, 319);
      p.y = highGround + 7; p.vy = 0; p.speed = 30;
      /* This case manually relocates an already-ignited body seven
         metres into clear air. It is no longer a takeoff-clearance
         test, so release the launch latch before asking for its one
         frame of horizontal terrain-drop motion. */
      T.jetpack.state.takeoffClearing = false;
      p.yaw = Math.PI; p.camYaw = Math.PI;
      T.setGaitInput(0, -1);
      const beforeY = p.y;
      T.advanceTime(0.1, 0.1);
      const out = { beforeY, afterY: p.y, z: p.z, ground: T.collide.groundHeight(p.x, p.z) };
      T.setGaitInput(null, null); T.setJetInput(false);
      return out;
    });
    check("crossing a terrain drop descends without a vertical teleport",
      report.terrainDrop.z < 317 && Math.abs(report.terrainDrop.afterY - report.terrainDrop.beforeY) < 1.2,
      JSON.stringify(report.terrainDrop));

    report.impactLanding = await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state;
      const site = T.findFlatSite(18);
      T.teleport(site[0], site[1], 0);
      const ground = T.collide.groundHeight(p.x, p.z);
      p.y = ground + 2; p.vy = -20; p.grounded = false;
      T.jetpack.state.inFlight = true; T.jetpack.state.active = false;
      T.advanceTime(0.5, 1 / 60);
      return T.jetpackState();
    });
    check("landing animation preserves pre-contact impact speed",
      report.impactLanding.grounded && report.impactLanding.lastLandingSpeed >= 15,
      JSON.stringify(report.impactLanding));

    report.ventGate = await page.evaluate(() => {
      const T = window.__SF;
      const site = T.findFlatSite(18);
      T.teleport(site[0], site[1], 0);
      T.weapons.carry.venting = 1;
      T.setJetInput(true); T.advanceTime(0.15, 1 / 60);
      const out = T.jetpackState();
      T.setJetInput(false); T.weapons.carry.venting = 0;
      T.advanceTime(0.05, 1 / 60);
      return out;
    });
    check("an in-progress vent prevents ignition",
      !report.ventGate.active && report.ventGate.grounded,
      JSON.stringify(report.reloadGate));

    report.deadSteering = await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state;
      const site = T.findFlatSite(18);
      T.teleport(site[0], site[1], 0);
      T.setJetInput(true); T.advanceTime(0.12, 1 / 60);
      p.speed = 30; T.setGaitInput(0, -1);
      const before = [p.x, p.z];
      T.combat.player.dead = true;
      T.combat.player.respawnIn = 3.4;
      T.advanceTime(0.5, 1 / 60);
      const out = { moved: Math.hypot(p.x - before[0], p.z - before[1]), state: T.jetpackState() };
      T.combat.player.dead = false; T.combat.player.deathTimer = 0;
      T.setGaitInput(null, null); T.setJetInput(false);
      return out;
    });
    check("dead airborne players cannot steer during respawn",
      report.deadSteering.moved < 0.02 && !report.deadSteering.state.active,
      JSON.stringify(report.deadSteering));

    // A software gate closing while the physical chord remains held
    // must not create a synthetic second press when it reopens.
    await page.evaluate(() => {
      const T = window.__SF;
      const site = T.findFlatSite(18);
      T.teleport(site[0], site[1], 0);
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      T.releaseCamera();
    });
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("Space");
    const beforeFree = await step(0.25);
    await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state;
      T.player.setFree(true, [p.x + 4, p.y + 3, p.z + 4], [p.x, p.y + 1, p.z], 60);
    });
    const duringFree = await step(0.12);
    await page.evaluate(() => window.__SF.releaseCamera());
    const afterFree = await step(0.25);
    check("held chord does not re-ignite after a software gate",
      beforeFree.active && !duringFree.active && !afterFree.active
        && afterFree.ignitions === beforeFree.ignitions,
      JSON.stringify({ beforeFree, duringFree, afterFree }));
    await page.keyboard.up("Space");
    await page.keyboard.up("ShiftLeft");
    await step(0.1);

    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("Space");
    const beforeSpawn = await step(0.2);
    await page.evaluate(() => {
      const T = window.__SF; const p = T.player.state;
      T.player.spawn(p.x, p.z, p.yaw);
    });
    const afterSpawn = await step(0.2);
    check("holding the chord across spawn cannot re-ignite",
      beforeSpawn.active && !afterSpawn.active && afterSpawn.ignitions === beforeSpawn.ignitions,
      JSON.stringify({ beforeSpawn, afterSpawn }));
    await page.keyboard.up("Space");
    await page.keyboard.up("ShiftLeft");
    await step(0.1);

    // Browser blur must clear held thrust.
    await page.evaluate(() => {
      const T = window.__SF;
      T.teleport(...T.findFlatSite(18), 0);
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
    });
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("Space");
    await step(0.25);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const blurred = await step(0.12);
    check("window blur clears thrust", !blurred.requested && !blurred.active, JSON.stringify(blurred));
    await page.keyboard.up("Space").catch(() => {});
    await page.keyboard.up("ShiftLeft").catch(() => {});

    /* Deployed feathers are wider than the traversal capsule by
       design. Two mirrored Cathedral faces prove the presentation
       rig independently folds only the wall-side wing instead of
       visibly cutting through masonry or widening player collision. */
    async function proveWallTuck(label, x, z, yaw) {
      await page.evaluate(({ x, z, yaw }) => {
        const T = window.__SF;
        T.teleport(x, z, yaw);
        T.releaseCamera();
        T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      }, { x, z, yaw });
      await page.keyboard.down("ShiftLeft");
      await page.keyboard.down("Space");
      const state = await step(0.85);
      const shots = await capture(label, [180]);
      await page.keyboard.up("Space");
      await page.keyboard.up("ShiftLeft");
      await step(0.08);
      return { state, shots };
    }
    report.states.wallTuckRight = await proveWallTuck(
      "wall-tuck-right", -75.5, -736.5, 0
    );
    check("right seraph wing folds away from nearby masonry",
      report.states.wallTuckRight.state.wallTuckR >= 0.30
        && report.states.wallTuckRight.state.wallTuckL <= 0.12,
      JSON.stringify(report.states.wallTuckRight.state));
    report.states.wallTuckLeft = await proveWallTuck(
      "wall-tuck-left", -70.5, -736.5, 0
    );
    check("left seraph wing folds away from nearby masonry",
      report.states.wallTuckLeft.state.wallTuckL >= 0.30
        && report.states.wallTuckLeft.state.wallTuckR <= 0.12,
      JSON.stringify(report.states.wallTuckLeft.state));

    report.collideStats = await page.evaluate(() => window.__SF.collideStats());
    report.final = await page.evaluate(() => window.__SF.jetpackState());
    report.sourceAfter = await hashes();
    report.sourceStable = JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
    check("source stayed stable during browser proof", report.sourceStable, "before/after SHA-256");
    check("no page or console errors", errors.length === 0, errors.join("\n") || "none");

    await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    const failed = report.checks.filter((c) => !c.pass);
    for (const c of report.checks) console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name} - ${c.detail}`);
    console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
    if (failed.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
