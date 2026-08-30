#!/usr/bin/env node
/* ============================================================
   SAINTFALL - crescent pulse vertical-slice proof

   The pulse now flies edge-first in a vertical plane. This holds
   the trigger through real input, freezes time with pulses mid
   flight, then measures every live pulse and photographs the flight
   corridor from the three bearings that define a slice:

     side     the full crescent - the only bearing that shows it
     rear     the chase camera's own view - a thin vertical slash
     ahead34  approaching view - still thin

   Gates per live pulse: face normal horizontal (|n.y| <= 0.05) and
   face normal perpendicular to its flight (|n.dot(dir)| <= 0.02).
   Together those PROVE the crescent's plane contains the world
   vertical - up is orthogonal to the face normal, so it lies in the
   plane. planeY.dot(up) is reported but NOT gated: it measures the
   shot's own pitch toward the reticle plus the authored 0.14rad
   hand tilt, which a first draft of this probe misread as the plane
   "losing the vertical".

   Usage: node scripts/saintfall-slice-probe.mjs --tag now
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const tag = arg("--tag", "slice");
const outDir = path.resolve(root, arg("--out", "output/saintfall/slice-probe"));
const PORT = 41700 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${BASE}/games/saintfall-white-vigil.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never became ready");
}

function run() {
  const T = window.__SF;
  const THREE = T.THREE;
  const p = T.player;
  T.maximize();
  T.hideHud(true);
  const site = T.findFlatSite(6);
  p.spawn(site[0], site[1], Math.PI * 0.25);
  if ("camDist" in p.state) p.state.camDist = 3.4;
  T.advanceTime(1.2, 1 / 60);

  /* Hold the trigger through real input; stop mid-burst so several
     pulses are alive at staggered distances. */
  for (let i = 0; i < 38; i += 1) {
    T.setFiring(true);
    T.advanceTime(1 / 60, 1 / 60);
  }
  const plates = [];
  /* The live chase frame first - the player's own view of the burst. */
  T.renderOnce();
  plates.push({ label: "rear-chase", url: T.captureDataURL() });

  /* Measure every live pulse. Time is frozen from here on. */
  const dischargeGroup = T.ctx.scene.getObjectByName("white-vigil-crescent-discharges");
  const state = T.summit.dischargeState();
  const up = new THREE.Vector3(0, 1, 0);
  const worldY = new THREE.Vector3();
  const worldZ = new THREE.Vector3();
  const pulses = [];
  for (const node of dischargeGroup?.children || []) {
    node.updateWorldMatrix(true, false);
    worldY.set(0, 1, 0).transformDirection(node.matrixWorld);
    worldZ.set(0, 0, 1).transformDirection(node.matrixWorld);
    /* Match the pulse to its recorded direction by nearest origin
       ray: recentShots keeps the last 8, ours are the newest. */
    let direction = null;
    let best = Infinity;
    for (const shot of state.recentShots) {
      const o = new THREE.Vector3().fromArray(shot.origin);
      const d = new THREE.Vector3().fromArray(shot.direction);
      const toPulse = node.position.clone().sub(o);
      const along = toPulse.dot(d);
      const off = toPulse.addScaledVector(d, -along).length();
      if (off < best) { best = off; direction = d; }
    }
    pulses.push({
      name: node.name,
      offAxisM: +best.toFixed(4),
      normal: worldZ.toArray().map((v) => +v.toFixed(4)),
      planeY: worldY.toArray().map((v) => +v.toFixed(4)),
      normalDotUp: +worldZ.dot(up).toFixed(4),
      normalDotDir: direction ? +worldZ.dot(direction).toFixed(4) : null,
      planeYDotUp: +worldY.dot(up).toFixed(4),
    });
  }

  /* Freeze-frame bearings around the corridor. Pulses fly along the
     chase camera's forward; frame the span 0..10m ahead of the
     figure at chest height. */
  const camDir = new THREE.Vector3();
  T.ctx.render.camera.getWorldDirection(camDir);
  const figurePos = new THREE.Vector3(p.state.x,
    T.ctx.terrain.heightAt(p.state.x, p.state.z) + 1.35, p.state.z);
  const mid = figurePos.clone().addScaledVector(camDir, 4.5);
  const right = new THREE.Vector3().crossVectors(camDir, up).normalize();
  const BEARINGS = [
    ["side", mid.clone().addScaledVector(right, 8.5), mid, 40],
    ["side-close", figurePos.clone().addScaledVector(camDir, 2.2).addScaledVector(right, 4.2), figurePos.clone().addScaledVector(camDir, 2.2), 38],
    ["ahead34", mid.clone().addScaledVector(camDir, 5.5).addScaledVector(right, -3.2), mid, 42],
  ];
  for (const [label, eye, aim, fov] of BEARINGS) {
    T.hidePlayer(false);
    p.setFree(true, eye.toArray(), aim.toArray(), fov);
    T.renderStill();
    T.renderStill();
    plates.push({ label, url: T.captureDataURL() });
    p.setFree(false);
  }
  T.setFiring(false);
  return { pulses, active: state.active, plates };
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/games/saintfall-white-vigil.html?qa=1&quality=high&character=white-vigil&cycle=0`, {
      waitUntil: "domcontentloaded", timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
    await page.evaluate(() => {
      try { window.__SF.setTime("day"); } catch (_) { window.__SF.setTime("goldenhour"); }
    });
    const res = await page.evaluate(run);

    await mkdir(outDir, { recursive: true });
    for (const plate of res.plates) {
      await writeFile(path.join(outDir, `${tag}-${plate.label}.png`),
        Buffer.from(plate.url.slice(plate.url.indexOf(",") + 1), "base64"));
    }

    const failures = [];
    if (!res.pulses.length) failures.push("no live pulses at freeze time");
    for (const pulse of res.pulses) {
      if (Math.abs(pulse.normalDotUp) > 0.05) {
        failures.push(`${pulse.name} face normal off horizontal: n.y ${pulse.normalDotUp}`);
      }
      if (pulse.normalDotDir !== null && Math.abs(pulse.normalDotDir) > 0.02) {
        failures.push(`${pulse.name} face normal not perpendicular to flight: ${pulse.normalDotDir}`);
      }
    }
    if (errors.length) failures.push(`page errors: ${errors.join(" | ")}`);
    console.log(JSON.stringify({ passed: !failures.length, active: res.active, pulses: res.pulses, failures }, null, 2));
    console.log(`plates -> ${path.relative(root, outDir)}`);
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
