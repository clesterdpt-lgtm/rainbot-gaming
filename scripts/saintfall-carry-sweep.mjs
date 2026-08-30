#!/usr/bin/env node
/* ============================================================
   SAINTFALL - White Vigil carry candidate sweep

   One boot, many carries: each candidate is applied through the
   loadout's own live setters (setCarryPose / setHold), settled, then
   measured and photographed from the two bearings that decide a rest
   carry - the concept's side view and the chase camera's rear.

   Measures per candidate: elbow angle + bend direction, muzzle in
   figure space (down-forwardness), the butt axis's closest approach
   to the forearm (clip risk from raking the mid-grip prop steeper),
   and the highest point of gun geometry above the wrist (the
   "handle facing the sky" number).

   Usage: node scripts/saintfall-carry-sweep.mjs --tag sweep1
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const tag = arg("--tag", "sweep");
const outDir = path.resolve(root, arg("--out", "output/saintfall/carry-sweep"));
const PORT = 47500 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

/* carry = setCarryPose {x,y,z}; gripY replaces grip[1] on both props;
   holdX replaces the palm-space rake magnitude (sign handled per
   hand, matching mirrorHold). null = leave the shipped value. */
const CANDIDATES = [
  { id: "A-current", carry: null, gripY: null, holdX: null },
  { id: "C-gun-slid", carry: { x: 0.060, y: 0.005, z: 0.040 }, gripY: 0.150, holdX: null },
  { id: "D-steeper", carry: { x: 0.060, y: 0.005, z: 0.040 }, gripY: 0.150, holdX: 0.360 },
  { id: "G-steepest", carry: { x: 0.060, y: 0.005, z: 0.030 }, gripY: 0.150, holdX: 0.340 },
  { id: "H-mid", carry: { x: 0.070, y: 0.010, z: 0.045 }, gripY: 0.180, holdX: 0.380 },
];

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

function applyAndMeasure(candidate) {
  const T = window.__SF;
  const THREE = T.THREE;
  const player = T.player;
  const figure = player.figure;
  const loadout = T.ctx.playerLoadout;

  if (candidate.carry) loadout.setCarryPose(candidate.carry);
  for (const [id, sign] of [["left-hybrid", 1], ["right-hybrid", -1]]) {
    const patch = {};
    if (Number.isFinite(candidate.gripY)) {
      patch.grip = [0.105, candidate.gripY, 0];
    }
    if (Number.isFinite(candidate.holdX)) {
      const up = Math.sqrt(Math.max(0, 1 - candidate.holdX * candidate.holdX));
      patch.longTo = [sign * -candidate.holdX, up, 0];
    }
    if (Object.keys(patch).length) loadout.setHold(id, patch);
  }
  T.setFiring(false);
  T.advanceTime(1.0, 1 / 120);
  figure.root.updateMatrixWorld(true);

  const inverseRoot = figure.root.matrixWorld.clone().invert();
  const scratch = new THREE.Vector3();
  const localPoint = (node) => node.getWorldPosition(scratch.clone())
    .applyMatrix4(inverseRoot).toArray().map((v) => +v.toFixed(4));
  const vec = (a, b) => new THREE.Vector3().fromArray(a).sub(new THREE.Vector3().fromArray(b));

  /* Closest distance between two segments, for butt-vs-forearm. */
  const segSeg = (p1, q1, p2, q2) => {
    const d1 = q1.clone().sub(p1);
    const d2 = q2.clone().sub(p2);
    const r = p1.clone().sub(p2);
    const a = d1.dot(d1); const e = d2.dot(d2); const f = d2.dot(r);
    let s; let t;
    const c = d1.dot(r); const b = d1.dot(d2);
    const denom = a * e - b * b;
    s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
    t = (b * s + f) / e;
    if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    const c1 = p1.clone().addScaledVector(d1, s);
    const c2 = p2.clone().addScaledVector(d2, t);
    return c1.distanceTo(c2);
  };

  const arms = [0, 1].map((hand) => {
    const part = loadout.parts.find((cand) => cand.spec.hand === hand);
    part.asset.updateWorldMatrix(true, true);
    const shoulder = localPoint(figure.armPivots[hand]);
    const elbow = localPoint(figure.elbowPivots[hand]);
    const wrist = localPoint(figure.handPivots[hand]);
    const upper = vec(shoulder, elbow);
    const fore = vec(wrist, elbow);
    const elbowAngleDeg = THREE.MathUtils.radToDeg(upper.angleTo(fore));
    const axis = vec(wrist, shoulder).normalize();
    const shoulderToElbow = vec(elbow, shoulder);
    const bend = shoulderToElbow.addScaledVector(axis, -shoulderToElbow.dot(axis));
    const muzzle = new THREE.Vector3().fromArray(part.spec.emitterAxis)
      .transformDirection(part.asset.matrixWorld)
      .transformDirection(inverseRoot);
    /* Model-space landmarks -> figure space. */
    const modelPoint = (p) => new THREE.Vector3().fromArray(p)
      .applyMatrix4(part.asset.matrixWorld).applyMatrix4(inverseRoot);
    const gripPt = modelPoint(part.spec.grip);
    const buttTip = modelPoint([0.045, 0.93, 0]);
    const bladeTip = modelPoint([0.045, -0.96, 0]);
    const elbowV = new THREE.Vector3().fromArray(elbow);
    const wristV = new THREE.Vector3().fromArray(wrist);
    const buttForearm = segSeg(gripPt, buttTip, elbowV, wristV);
    /* Highest gun point above the wrist: sample the asset's box in
       world by walking its 8 corners is meaningless for a raked
       plate, so sample the butt tip - it is the top of the prop. */
    const skyward = buttTip.y - wristV.y;
    return {
      hand: hand === 0 ? "left" : "right",
      elbowAngleDeg: +elbowAngleDeg.toFixed(1),
      bendZ: +bend.z.toFixed(4),
      muzzle: muzzle.toArray().map((v) => +v.toFixed(3)),
      muzzleDropDeg: +THREE.MathUtils.radToDeg(
        Math.atan2(-muzzle.y, Math.hypot(muzzle.x, muzzle.z))).toFixed(1),
      buttForearmM: +buttForearm.toFixed(3),
      buttTip: buttTip.toArray().map((v) => +v.toFixed(3)),
      bladeTip: bladeTip.toArray().map((v) => +v.toFixed(3)),
      skywardM: +skyward.toFixed(3),
      wrist,
      gripErrorM: loadout.status().parts.find((p) => p.hand === (hand === 0 ? "left" : "right")).gripErrorM,
    };
  });
  return { id: candidate.id, arms };
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
    const context = await browser.newContext({ viewport: { width: 760, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/games/saintfall-white-vigil.html?qa=1&quality=high&character=white-vigil&time=alpenglow&cycle=0`, {
      waitUntil: "domcontentloaded", timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
    await page.evaluate(() => {
      const T = window.__SF;
      T.maximize();
      T.hideHud(true);
      T.advanceTime(0.8, 1 / 120);
    });

    await mkdir(outDir, { recursive: true });
    const reports = [];
    const tiles = [];
    const BEARINGS = [["side", 0], ["rear34", Math.PI * 0.62], ["front34", Math.PI * 1.38]];
    for (const candidate of CANDIDATES) {
      const report = await page.evaluate(applyAndMeasure, candidate);
      reports.push(report);
      for (const [name, bearing] of BEARINGS) {
        await page.evaluate((angle) => {
          window.__SF.poseFigure(angle, { radius: 2.5, fov: 31, eye: 0.60, aim: 0.56 });
          window.__SF.setFiring(false);
          window.__SF.advanceTime(0.2, 1 / 120);
          window.__SF.renderOnce();
        }, bearing);
        const file = path.join(outDir, `${tag}-${candidate.id}-${name}.png`);
        await page.screenshot({ path: file });
        tiles.push({ candidate: candidate.id, name, file });
      }
    }

    /* Contact sheet: one row per candidate, three bearings across. */
    const TILE_W = 380; const TILE_H = 450; const LABEL_H = 24;
    const rows = CANDIDATES.length;
    const sheetW = TILE_W * BEARINGS.length;
    const sheetH = (TILE_H + LABEL_H) * rows;
    const composites = [];
    for (let r = 0; r < rows; r += 1) {
      const candidate = CANDIDATES[r];
      const label = Buffer.from(`<svg width="${sheetW}" height="${LABEL_H}">`
        + `<rect width="${sheetW}" height="${LABEL_H}" fill="#12100c"/>`
        + `<text x="6" y="17" font-family="monospace" font-size="14" fill="#f4d9a0">${candidate.id}`
        + `  carry=${JSON.stringify(candidate.carry)} gripY=${candidate.gripY} holdX=${candidate.holdX}</text>`
        + `</svg>`);
      composites.push({ input: await sharp(label).png().toBuffer(), left: 0, top: r * (TILE_H + LABEL_H) });
      for (let b = 0; b < BEARINGS.length; b += 1) {
        const tile = tiles[r * BEARINGS.length + b];
        const img = await sharp(tile.file)
          .extract({ left: 130, top: 90, width: 500, height: 620 })
          .resize(TILE_W, TILE_H, { fit: "cover" }).png().toBuffer();
        composites.push({ input: img, left: b * TILE_W, top: r * (TILE_H + LABEL_H) + LABEL_H });
      }
    }
    const sheet = path.join(outDir, `${tag}-sheet.png`);
    await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: "#000" } })
      .composite(composites).png().toFile(sheet);

    await writeFile(path.join(outDir, `${tag}-report.json`), JSON.stringify({ reports, errors }, null, 2));
    for (const report of reports) {
      console.log(`\n== ${report.id}`);
      for (const arm of report.arms) {
        console.log(`  ${arm.hand.padEnd(5)} elbow ${arm.elbowAngleDeg}deg bendZ ${arm.bendZ}`
          + ` muzzle ${JSON.stringify(arm.muzzle)} drop ${arm.muzzleDropDeg}deg`
          + ` butt-forearm ${arm.buttForearmM}m skyward ${arm.skywardM}m grip ${arm.gripErrorM}`);
      }
    }
    console.log(`\nsheet -> ${path.relative(root, sheet)}`);
    if (errors.length) console.log(`errors: ${errors.join(" | ")}`);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
