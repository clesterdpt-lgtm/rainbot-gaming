#!/usr/bin/env node
/* ============================================================
   SAINTFALL - White Vigil carry/fire anatomy proof

   Measures the joint angle and bend direction of each arm, records
   the held emitter axes in figure space, and captures both carry and
   firing poses from four body-relative bearings. This complements
   the discharge probe: a shot can be mathematically aligned while
   the gun or elbow still looks inverted.
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
const tag = arg("--tag", "pose");
const outDir = path.resolve(root, arg("--out", "output/playwright/white-vigil-pose"));
const carryY = Number(arg("--carry-y", "NaN"));
const carryZ = Number(arg("--carry-z", "NaN"));
const holdX = Number(arg("--hold-x", "NaN"));
const PORT = 49100 + (process.pid % 700);
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

function inspectPose(label) {
  const T = window.__SF;
  const THREE = T.THREE;
  const player = T.player;
  const figure = player.figure;
  const loadout = T.ctx.playerLoadout;
  figure.root.updateMatrixWorld(true);
  const inverseRoot = figure.root.matrixWorld.clone().invert();
  const point = new THREE.Vector3();
  const localPoint = (node) => node.getWorldPosition(point.clone())
    .applyMatrix4(inverseRoot).toArray().map((v) => +v.toFixed(4));
  const vector = (a, b) => new THREE.Vector3().fromArray(a)
    .sub(new THREE.Vector3().fromArray(b));
  const arms = [0, 1].map((hand) => {
    const shoulder = localPoint(figure.armPivots[hand]);
    const elbow = localPoint(figure.elbowPivots[hand]);
    const wrist = localPoint(figure.handPivots[hand]);
    const upper = vector(shoulder, elbow);
    const fore = vector(wrist, elbow);
    const elbowAngleDeg = THREE.MathUtils.radToDeg(upper.angleTo(fore));
    const axis = vector(wrist, shoulder).normalize();
    const shoulderToElbow = vector(elbow, shoulder);
    const bend = shoulderToElbow.addScaledVector(axis, -shoulderToElbow.dot(axis));
    const part = loadout.parts.find((candidate) => candidate.spec.hand === hand);
    part.asset.updateWorldMatrix(true, true);
    const inFigure = (axisLocal) => new THREE.Vector3().fromArray(axisLocal)
      .transformDirection(part.asset.matrixWorld)
      .transformDirection(inverseRoot).toArray().map((v) => +v.toFixed(4));
    return {
      hand: hand === 0 ? "left" : "right",
      shoulder, elbow, wrist,
      elbowAngleDeg: +elbowAngleDeg.toFixed(2),
      bendM: bend.toArray().map((v) => +v.toFixed(4)),
      muzzle: inFigure(part.spec.emitterAxis),
      plateNormal: inFigure([0, 0, 1]),
      gripErrorM: T.summit.loadoutState().parts[hand].gripErrorM,
    };
  });
  return { label, arms, loadout: T.summit.loadoutState() };
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
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/games/saintfall-white-vigil.html?qa=1&quality=high&character=white-vigil&time=alpenglow&cycle=0`, {
      waitUntil: "domcontentloaded", timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
    await page.evaluate(({ carryY: y, carryZ: z, holdX: x }) => {
      const T = window.__SF;
      T.maximize();
      T.hideHud(true);
      if (Number.isFinite(y) || Number.isFinite(z)) {
        T.ctx.playerLoadout.setCarryPose({ y, z });
      }
      if (Number.isFinite(x)) {
        const up = Math.sqrt(Math.max(0, 1 - x * x));
        T.ctx.playerLoadout.setHold("left-hybrid", { longTo: [-x, up, 0] });
        T.ctx.playerLoadout.setHold("right-hybrid", { longTo: [x, up, 0] });
      }
      T.poseFigure(0, { radius: 3.5, fov: 33, eye: 0.56, aim: 0.50 });
      T.setFiring(false);
      T.advanceTime(0.8, 1 / 120);
    }, { carryY, carryZ, holdX });

    const poses = [];
    poses.push(await page.evaluate(inspectPose, "carry"));
    await mkdir(outDir, { recursive: true });
    const bearings = [
      ["right-profile", 0], ["rear", Math.PI / 2],
      ["left-profile", Math.PI], ["front", Math.PI * 1.5],
    ];
    for (const [name, bearing] of bearings) {
      await page.evaluate((angle) => {
        window.__SF.poseFigure(angle, { radius: 3.5, fov: 33, eye: 0.56, aim: 0.50 });
        window.__SF.setFiring(false);
        window.__SF.advanceTime(0.25, 1 / 120);
        window.__SF.renderOnce();
      }, bearing);
      await page.screenshot({ path: path.join(outDir, `${tag}-carry-${name}.png`) });
    }

    await page.evaluate(() => {
      for (let i = 0; i < 90; i += 1) {
        window.__SF.setFiring(true);
        window.__SF.advanceTime(1 / 120, 1 / 120);
      }
    });
    poses.push(await page.evaluate(inspectPose, "fire"));
    for (const [name, bearing] of bearings) {
      await page.evaluate((angle) => {
        window.__SF.poseFigure(angle, { radius: 3.5, fov: 33, eye: 0.56, aim: 0.50 });
        for (let i = 0; i < 12; i += 1) {
          window.__SF.setFiring(true);
          window.__SF.advanceTime(1 / 120, 1 / 120);
        }
        window.__SF.renderOnce();
      }, bearing);
      await page.screenshot({ path: path.join(outDir, `${tag}-fire-${name}.png`) });
    }

    const failures = [];
    for (const pose of poses) {
      for (const arm of pose.arms) {
        if (arm.gripErrorM !== 0) failures.push(`${pose.label} ${arm.hand} grip drift ${arm.gripErrorM}m`);
        if (arm.elbowAngleDeg > 168) failures.push(`${pose.label} ${arm.hand} elbow locked at ${arm.elbowAngleDeg}deg`);
        if (arm.bendM[2] > 0.025) failures.push(`${pose.label} ${arm.hand} elbow bends forward ${arm.bendM[2]}m`);
      }
    }
    const carry = poses.find((pose) => pose.label === "carry")?.arms;
    if (carry?.length === 2) {
      const [left, right] = carry;
      if (Math.abs(left.muzzle[0] + right.muzzle[0]) > 0.04
        || Math.abs(left.muzzle[1] - right.muzzle[1]) > 0.08
        || Math.abs(left.muzzle[2] - right.muzzle[2]) > 0.08) {
        failures.push(`carry weapons are not mirrored: ${JSON.stringify(carry.map((arm) => arm.muzzle))}`);
      }
      if (carry.some((arm) => arm.muzzle[1] > -0.35 || arm.muzzle[2] < 0.55)) {
        failures.push(`carry weapon inverted or inward: ${JSON.stringify(carry.map((arm) => arm.muzzle))}`);
      }
    }
    if (errors.length) failures.push(`console errors: ${errors.join(" | ")}`);
    const report = { passed: failures.length === 0, poses, errors, failures };
    await writeFile(path.join(outDir, `${tag}-report.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
