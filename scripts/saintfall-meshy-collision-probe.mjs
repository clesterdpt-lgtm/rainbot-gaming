#!/usr/bin/env node
/* Verify that the approved Meshy landmarks and opened drop pod, rather
   than their retired or hidden procedural stand-ins, own Saintfall's
   walking and flight collision. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const outDir = path.resolve(root, outArg >= 0
  ? process.argv[outArg + 1]
  : "output/saintfall/meshy-collision");
const port = 47800 + (process.pid % 1500);
const base = `http://127.0.0.1:${port}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "ignore"] });

async function waitForServer() {
  for (let i = 0; i < 240; i += 1) {
    try {
      if ((await fetch(`${base}/games/saintfall.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local Saintfall server did not start");
}

async function saveDataUrl(file, value) {
  await writeFile(file, Buffer.from(value.replace(/^data:image\/png;base64,/, ""), "base64"));
}

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
let browser;

try {
  await mkdir(outDir, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: [
      "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--mute-audio",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&time=goldenhour&cycle=0&intro=0`,
    { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  const diagnostics = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const collision = T.collide.stats();
    const sceneProxyNames = [];
    T.world.group.traverse((object) => {
      if (object.userData?.collisionProxy || /collision-proxy/.test(object.name || "")) {
        sceneProxyNames.push(object.name || "(unnamed)");
      }
    });

    const landmarks = T.world.authoredLandmarks.map((landmark) => {
      landmark.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(landmark.root);
      const size = box.getSize(new THREE.Vector3());
      return {
        key: landmark.key,
        meshes: landmark.meshes.length,
        collisionSolid: landmark.meshes.every((mesh) => mesh.userData.collisionSolid === true),
        noCollide: landmark.meshes.some((mesh) => mesh.userData.noCollide === true),
        size: size.toArray().map((value) => Number(value.toFixed(2))),
      };
    });
    const landmarkColliders = collision.perMesh.filter((entry) =>
      /(?:saint-meshy|reach-meshy-choir-wheel)/.test(entry.name));
    const retiredColliders = collision.perMesh.filter((entry) =>
      /(?:saint-(?:head|hand)-collision-proxy|reach-vane-(?:masts|sails)-collision-proxy)/
        .test(entry.name));
    const podColliders = collision.perMesh.filter((entry) =>
      /(?:pod|sanctum-drop)/.test(entry.name));
    return {
      version: T.version,
      landmarks,
      sceneProxyNames,
      landmarkColliders,
      retiredColliders,
      podColliders,
      collision: {
        cells: collision.cells,
        flightCells: collision.flightCells,
        meshes: collision.meshes,
        buildMs: collision.buildMs,
      },
    };
  });

  const heads = diagnostics.landmarks.filter((entry) => entry.key === "fallenSaintHead");
  const hands = diagnostics.landmarks.filter((entry) => entry.key === "fallenSaintHand");
  const crosses = diagnostics.landmarks.filter((entry) => entry.key.startsWith("gildedReachCross-"));
  check("one Meshy head is registered", heads.length === 1, `count=${heads.length}`);
  check("one Meshy hand is registered", hands.length === 1, `count=${hands.length}`);
  check("all seventeen Choir wheels are registered", crosses.length === 17, `count=${crosses.length}`);
  check("every Meshy landmark mesh owns structural collision",
    diagnostics.landmarks.every((entry) => entry.meshes > 0 && entry.collisionSolid && !entry.noCollide),
    `${diagnostics.landmarks.filter((entry) => !entry.collisionSolid || entry.noCollide).length} bad landmark records`);
  check("retired hidden collision proxies are absent",
    diagnostics.sceneProxyNames.length === 0 && diagnostics.retiredColliders.length === 0,
    JSON.stringify({ scene: diagnostics.sceneProxyNames, raster: diagnostics.retiredColliders }));
  check("each Meshy model contributes walking and flight cells",
    diagnostics.landmarkColliders.length === 19
      && diagnostics.landmarkColliders.every((entry) => entry.cells > 0 && entry.flightCells > 0),
    `${diagnostics.landmarkColliders.length}/19 collider records`);
  check("collision baking remains within its load budget",
    diagnostics.collision.buildMs < 1200, `buildMs=${diagnostics.collision.buildMs}`);
  check("only the visible opened Meshy pod owns lander collision",
    diagnostics.podColliders.length === 1
      && diagnostics.podColliders[0].name === "sanctum-drop-pod-open-mesh"
      && diagnostics.podColliders[0].cells > 0
      && diagnostics.podColliders[0].flightIntervals > 0,
    JSON.stringify(diagnostics.podColliders));

  /* These are the empty-sand contacts measured against the retired
     proxies before the fix. Keeping them explicit turns the reported
     invisible barriers into a permanent regression gate. */
  const phantomClearance = await page.evaluate(() => {
    const T = window.__SF;
    return [
      { id: "head-north", x: -4.9822, z: 19.536 },
      { id: "head-northeast", x: 15.75, z: 13.67 },
      { id: "head-northwest", x: -12.54, z: 21.01 },
      { id: "hand-southeast", x: 236.735, z: -182.592 },
    ].map((point) => {
      const ground = T.collide.groundHeight(point.x, point.z);
      return { ...point, blocked: T.collide.blocked(point.x, point.z, ground) };
    });
  });
  check("the former head and hand phantom contacts are open",
    phantomClearance.every((entry) => !entry.blocked), JSON.stringify(phantomClearance));

  const traversal = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const result = T.walkInto(-5, 35, Math.PI, 4, true);
    return { ...result, position: T.player.position };
  });
  check("real player movement crosses the former north-head barrier",
    traversal.position.z < 18 && !traversal.stopped && !traversal.endedInsideSolid,
    JSON.stringify(traversal));
  check("browser console stays clean", errors.length === 0, errors.join(" | ") || "no errors");

  const captures = [
    { key: "fallenSaintHead", file: "head-collision.png", bearing: 218, rangeScale: 0.48 },
    { key: "fallenSaintHand", file: "hand-collision.png", bearing: 205, rangeScale: 0.62 },
    { key: "gildedReachCross-8", file: "cross-collision.png", bearing: 210, rangeScale: 0.8 },
  ];
  for (const shot of captures) {
    const dataUrl = await page.evaluate((spec) => {
      const T = window.__SF;
      const THREE = T.THREE;
      const landmark = T.world.authoredLandmarks.find((entry) => entry.key === spec.key);
      landmark.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(landmark.root);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const ground = T.collide.groundHeight(center.x, center.z);
      const horizontal = Math.max(size.x, size.z);
      const angle = spec.bearing * Math.PI / 180;
      const radius = Math.max(15, horizontal * 0.64);
      const targetY = ground + Math.min(18, size.y * 0.12);
      const cameraY = ground + Math.min(38, size.y * 0.24 + 4);

      T.clearEnemies();
      T.hideHud(true);
      T.hidePlayer(true);
      T.lookAt([
        center.x + Math.sin(angle) * radius,
        cameraY,
        center.z + Math.cos(angle) * radius,
      ], [center.x, targetY, center.z], 58);
      T.collide.setDebugView(THREE, T.render.scene, true, center.x, center.z,
        Math.max(10, horizontal * spec.rangeScale));
      T.render.render(T.render.camera);
      return T.captureDataURL();
    }, shot);
    await saveDataUrl(path.join(outDir, shot.file), dataUrl);
  }

  const report = {
    checks,
    diagnostics,
    phantomClearance,
    traversal,
    errors,
    captures: captures.map((entry) => entry.file),
  };
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  for (const result of checks) {
    console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.name} - ${result.detail}`);
  }
  console.log(`\n${checks.filter((entry) => entry.pass).length}/${checks.length} checks passed`);
  console.log(`Artifacts: ${outDir}`);
  if (checks.some((entry) => !entry.pass)) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
