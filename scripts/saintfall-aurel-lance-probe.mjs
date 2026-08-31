#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Saint Aurel authored Censer-Lance proof

   Locks the contract for the approved Reliquary Needle model:
     - Aurel loads the optimized Meshy GLB, not the procedural body;
     - the authored point/pommel fit the established weapon envelope;
     - grip, shot and melee anchors remain the gameplay authorities;
     - ranged/melee/replica presentations share that authored visual;
     - a failed GLB request restores the complete procedural fallback.
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 46900 + (process.pid % 500);
const base = `http://127.0.0.1:${port}`;
const output = path.resolve(root, process.argv[2] || "output/saintfall/aurel-lance-option1-probe");

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${base}/games/saintfall.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never became ready");
}

function near(actual, expected, epsilon = 0.002) {
  return Math.abs(actual - expected) <= epsilon;
}

const server = startServer();
let browser;
try {
  await waitForServer();
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--hide-scrollbars", "--mute-audio"],
  });

  async function boot({ abortAsset = false } = {}) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    if (abortAsset) {
      await context.route("**/saint-aurel-censer-lance.glb*", (route) => route.abort());
    }
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      /* Chromium reports our intentional route.abort() as a resource
         error before the loader exercises the fallback. It is the
         stimulus for this half of the probe, not an application fault. */
      if (abortAsset && message.text().includes("Failed to load resource: net::ERR_FAILED")) return;
      errors.push(`console: ${message.text()}`);
    });
    await page.goto(
      `${base}/games/saintfall.html?qa=1&intro=0&quality=low&character=vesper-reliquary&proof=aurel-lance`,
      { waitUntil: "domcontentloaded", timeout: 60000 },
    );
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 180000 });
    return { context, page, errors };
  }

  const live = await boot();
  const contract = await live.page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    T.hideHud(true);
    T.studio(true);
    T.autoStow(false);
    T.equipWeapon("autogun");
    const weapon = T.weapons.current;
    const authored = weapon.authoredVisual;
    const meshes = [];
    weapon.root.traverse((node) => {
      if (!node.isMesh) return;
      meshes.push({
        name: node.name,
        authored: node.userData.authoredPlayerWeapon || null,
      });
    });
    const replica = T.weapons.cloneVisual("autogun");
    let replicaAuthoredMeshes = 0;
    replica.root.traverse((node) => {
      if (node.isMesh && node.userData.authoredPlayerWeapon) replicaAuthoredMeshes += 1;
    });
    T.weapons.setMode("ranged");
    const rangedRoot = T.weapons.current.root.uuid;
    T.weapons.setMode("melee");
    const meleeRoot = T.weapons.current.root.uuid;
    T.weapons.setMode("ranged");
    return {
      stats: T.weapons.stats(),
      file: authored?.asset?.file || null,
      sourceImage: authored?.asset?.sourceImage || null,
      sourceMeshes: authored?.asset?.meshes || 0,
      sourceTriangles: authored?.asset?.triangles || 0,
      bounds: authored ? {
        min: authored.box.min.toArray(),
        max: authored.box.max.toArray(),
      } : null,
      anchors: {
        rear: weapon.gripRear.position.toArray(),
        front: weapon.gripFront.position.toArray(),
        emitter: weapon.emitter.position.toArray(),
        tip: weapon.tip.position.toArray(),
        butt: weapon.butt.position.toArray(),
      },
      totalMeshes: meshes.length,
      authoredMeshes: meshes.filter((mesh) => mesh.authored).length,
      proceduralCenser: !!weapon.censer,
      rangedRoot,
      meleeRoot,
      replicaAuthoredMeshes,
    };
  });

  await live.page.evaluate(() => {
    const T = window.__SF;
    const site = T.findFlatSite(9);
    T.forceStow(0);
    T.poseFigure(Math.PI / 4, {
      x: site[0], z: site[1], yaw: 0, radius: 4.45, fov: 31, aim: 0.60, eye: 0.62,
    });
    T.player.state.figureOverride = true;
    for (let i = 0; i < 8; i += 1) T.renderStill();
  });
  const drawnShot = path.join(output, "aurel-lance-drawn.png");
  await live.page.screenshot({ path: drawnShot });

  await live.page.evaluate(() => {
    const T = window.__SF;
    T.forceStow(1);
    for (let i = 0; i < 8; i += 1) T.renderStill();
  });
  const stowedShot = path.join(output, "aurel-lance-stowed.png");
  await live.page.screenshot({ path: stowedShot });
  await live.context.close();

  const fallbackRun = await boot({ abortAsset: true });
  const fallback = await fallbackRun.page.evaluate(() => {
    const T = window.__SF;
    T.equipWeapon("autogun");
    const weapon = T.weapons.current;
    let authoredMeshes = 0;
    let totalMeshes = 0;
    weapon.root.traverse((node) => {
      if (!node.isMesh) return;
      totalMeshes += 1;
      if (node.userData.authoredPlayerWeapon) authoredMeshes += 1;
    });
    return {
      stats: T.weapons.stats(),
      authoredVisual: !!weapon.authoredVisual,
      authoredMeshes,
      totalMeshes,
      proceduralCenser: !!weapon.censer,
      hasGrips: !!weapon.gripRear && !!weapon.gripFront,
      hasEmitter: !!weapon.emitter,
    };
  });
  await fallbackRun.context.close();

  const failures = [];
  if (live.errors.length) failures.push(`live console/page errors: ${live.errors.join(" | ")}`);
  if (fallbackRun.errors.length) failures.push(`fallback console/page errors: ${fallbackRun.errors.join(" | ")}`);
  if (contract.file !== "saint-aurel-censer-lance.glb") failures.push(`authored file is ${contract.file}`);
  if (contract.sourceImage !== "saint-aurel-censer-lance-option-1-reliquary-needle.png") {
    failures.push(`source concept is ${contract.sourceImage}`);
  }
  if (contract.sourceMeshes !== 1) failures.push(`source mesh count is ${contract.sourceMeshes}`);
  if (contract.sourceTriangles !== 18066) failures.push(`source triangle count is ${contract.sourceTriangles}`);
  if (contract.authoredMeshes !== 1) failures.push(`runtime authored mesh count is ${contract.authoredMeshes}`);
  if (contract.totalMeshes !== 6) failures.push(`runtime total mesh count is ${contract.totalMeshes}`);
  if (contract.proceduralCenser) failures.push("procedural censer remained beside authored visual");
  if (contract.rangedRoot !== contract.meleeRoot) failures.push("ranged/melee modes changed physical weapon roots");
  if (contract.replicaAuthoredMeshes !== 1) failures.push(`replica authored mesh count is ${contract.replicaAuthoredMeshes}`);

  const haft = 1.92;
  const expected = {
    rear: [-haft * 0.155, -0.048, 0],
    front: [haft * 0.030, 0, 0],
    emitterX: haft * 0.59 + 0.18 + 0.285,
    tipX: haft * 0.78,
    buttX: -haft * 0.40,
  };
  contract.anchors.rear.forEach((value, index) => {
    if (!near(value, expected.rear[index], 1e-6)) failures.push(`rear grip axis ${index} is ${value}`);
  });
  contract.anchors.front.forEach((value, index) => {
    if (!near(value, expected.front[index], 1e-6)) failures.push(`front grip axis ${index} is ${value}`);
  });
  if (!near(contract.anchors.emitter[0], expected.emitterX, 1e-6)) failures.push("bolt emitter moved");
  if (!near(contract.anchors.tip[0], expected.tipX, 1e-6)) failures.push("melee tip moved");
  if (!near(contract.anchors.butt[0], expected.buttX, 1e-6)) failures.push("weapon butt moved");
  if (!contract.bounds || !near(contract.bounds.min[0], expected.buttX)) failures.push("authored pommel misses old envelope");
  if (!contract.bounds || !near(contract.bounds.max[0], expected.emitterX)) failures.push("authored point misses bolt emitter");
  if (!contract.bounds || !near((contract.bounds.min[1] + contract.bounds.max[1]) * 0.5, -0.040, 1e-6)) {
    failures.push("authored shaft is not lowered onto the solved grip line");
  }

  if (fallback.stats.authored !== null) failures.push(`fallback reports authored file ${fallback.stats.authored}`);
  if (fallback.authoredVisual || fallback.authoredMeshes) failures.push("fallback retained authored geometry");
  if (!fallback.proceduralCenser) failures.push("fallback has no procedural censer");
  if (fallback.totalMeshes <= contract.totalMeshes) failures.push("fallback did not rebuild procedural body meshes");
  if (!fallback.hasGrips || !fallback.hasEmitter) failures.push("fallback lost gameplay anchors");

  console.log(JSON.stringify({
    passed: failures.length === 0,
    contract,
    fallback,
    screenshots: [path.relative(root, drawnShot), path.relative(root, stowedShot)],
    liveErrors: live.errors,
    fallbackErrors: fallbackRun.errors,
    failures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
