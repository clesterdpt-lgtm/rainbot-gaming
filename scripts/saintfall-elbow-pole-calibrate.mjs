#!/usr/bin/env node
/* ============================================================
   SAINTFALL - elbow pole calibration

   A pole vector only chooses the elbow's swivel if it is SQUARE to
   the shoulder-wrist line; one lying along that line chooses nothing
   and the elbow is free to sit anywhere on its circle. The trigger
   arm's authored pole sat 8.9 degrees off the arm - which is why the
   elbow inverted the moment the reticle left dead ahead.

   Re-authoring it needs a target, and the target already exists: the
   pose at the forward reticle is the one that looks right. Because a
   pole solver puts the elbow in the half-plane of (armAxis, pole),
   the elbow's own perpendicular offset from the arm axis IS the pole
   that would have produced it. So measure that offset at neutral aim,
   undo the carry-aim rotation and the figure's yaw, and what comes
   out is the authored figure-space pole to write into player.js -
   same pose, but square to the arm and therefore stable.

   Usage: node scripts/saintfall-elbow-pole-calibrate.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 42200 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
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
    const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=low`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

    const out = await page.evaluate(() => {
      const T = window.__SF;
      const THREE = T.THREE;
      T.clearEnemies();
      T.releaseCamera();
      T.teleport(-520, -562, 0);
      T.autoStow(false);
      T.weapons.setMode("ranged");
      T.setGaitInput(0, 0);
      T.setFiring(true);
      T.setCam(0, 0);
      for (let i = 0; i < 180; i += 1) T.renderOnce(1 / 60);

      const fig = T.figureNodes();
      const st = T.playerState ? T.playerState() : null;
      const shoulder = new THREE.Vector3();
      const elbow = new THREE.Vector3();
      const wrist = new THREE.Vector3();
      const arm = new THREE.Vector3();
      const off = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const rows = [];
      for (let i = 0; i < 2; i += 1) {
        fig.armPivots[i].getWorldPosition(shoulder);
        fig.elbowPivots[i].getWorldPosition(elbow);
        fig.handPivots[i].getWorldPosition(wrist);
        arm.copy(wrist).sub(shoulder).normalize();
        // Perpendicular offset of the elbow from the shoulder-wrist
        // line: the direction a pole would have had to point.
        off.copy(elbow).sub(shoulder);
        off.addScaledVector(arm, -off.dot(arm));
        const bend = off.length();
        off.normalize();
        // Undo the carry aim, then the figure's own yaw, leaving the
        // pole in the space it is authored in.
        const yaw = (st && st.carryAimYaw) || 0;
        const pitch = (st && st.carryAimPitch) || 0;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(fig.root.quaternion);
        q.setFromAxisAngle(right, -pitch); off.applyQuaternion(q);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw); off.applyQuaternion(q);
        off.applyQuaternion(q.copy(fig.root.quaternion).invert());
        rows.push({
          arm: i === 0 ? "support" : "trigger",
          pole: [+off.x.toFixed(3), +off.y.toFixed(3), +off.z.toFixed(3)],
          bendMm: Math.round(bend * 1000),
          armAxisDown: +(-arm.y).toFixed(3),
        });
      }
      T.setFiring(false);
      return rows;
    });

    console.log("\nSAINTFALL elbow pole calibration\n" + "=".repeat(64));
    for (const r of out) {
      console.log(`${r.arm.padEnd(8)} authored pole (${r.pole.join(", ")})`
        + `   elbow stands ${r.bendMm}mm off the arm axis`
        + `   arm points down ${r.armAxisDown}`);
    }
    console.log("=".repeat(64));
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
