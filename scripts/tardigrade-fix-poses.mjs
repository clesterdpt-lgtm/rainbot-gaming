#!/usr/bin/env node
/* ============================================================
   Search for camera positions with real clearance.

   For every beauty shot whose camera is jammed into geometry, walk
   the camera back along its own view axis and lift it, until it has
   room to breathe while still framing the same target. Prints the
   positions to paste into world.js.
   ============================================================ */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 53100 + (process.pid % 1500);
const BASE = `http://127.0.0.1:${PORT}`;
const MIN_CLEARANCE = Number(process.env.MIN_CLEARANCE || 26);

const server = spawn("/opt/homebrew/bin/python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: root, stdio: ["ignore", "ignore", "ignore"],
});
for (let i = 0; i < 100; i += 1) {
  try { if ((await fetch(`${BASE}/games/tardigrade-simulator.html`)).ok) break; } catch (_) {}
  await delay(100);
}

const browser = await chromium.launch({
  channel: "chromium", headless: true,
  args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto(`${BASE}/games/tardigrade-simulator.html?qa=1&quality=ultra`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__TSIM && window.__TSIM.isReady(), null, { timeout: 90000 });
await page.evaluate(() => { window.__TSIM.hideHud(true); window.__TSIM.advanceTime(2.5); });

const poses = await page.evaluate(() => window.__TSIM_CTX.world.getBeautyShots().map((p) => ({
  id: p.id, position: p.position, target: p.target, fov: p.fov, followHero: !!p.followHero,
})));

/** Candidate offsets: (extra height, pull-back multiplier). */
const LIFTS = [0, 30, 60, 100, 150, 210, 280];
const PULLS = [1, 1.25, 1.6, 2.0, 2.6];

for (const pose of poses) {
  if (pose.followHero) { console.log(`${pose.id.padEnd(16)} skipped (follows hero)`); continue; }

  const baseline = await page.evaluate((p) => {
    window.__TSIM.lookAt(p.position, p.target, p.fov);
    return window.__TSIM.cameraClearance();
  }, pose);

  if (baseline.nearest === null || baseline.nearest >= MIN_CLEARANCE) {
    console.log(`${pose.id.padEnd(16)} ok      clearance=${baseline.nearest}`);
    continue;
  }

  let best = null;
  for (const lift of LIFTS) {
    for (const pull of PULLS) {
      const candidate = await page.evaluate(({ p, lift: l, pull: k }) => {
        const t = p.target;
        const d = [p.position[0] - t[0], p.position[1] - t[1], p.position[2] - t[2]];
        const pos = [t[0] + d[0] * k, t[1] + d[1] * k + l, t[2] + d[2] * k];

        // Pulling back along the view axis can drag the camera under the
        // terrain, where "clearance" is meaninglessly large because it is
        // sitting in a void. Keep it above ground.
        const world = window.__TSIM_CTX.world;
        const ground = world.heightAt ? world.heightAt(pos[0], pos[2]) : 0;
        pos[1] = Math.max(pos[1], ground + 14);

        window.__TSIM.lookAt(pos, t, p.fov);

        // The subject must still be the first thing down the barrel.
        const THREE = window.__TSIM.THREE;
        const cam = window.__TSIM_CTX.camera;
        const tgt = new THREE.Vector3(t[0], t[1], t[2]);
        const toTarget = tgt.distanceTo(cam.position);
        const cl = window.__TSIM.cameraClearance();
        const subjectVisible = cl.downBarrel === null || cl.downBarrel >= toTarget * 0.75;

        return { pos, clearance: cl, subjectVisible };
      }, { p: pose, lift, pull });

      const moved = Math.hypot(
        candidate.pos[0] - pose.position[0],
        candidate.pos[1] - pose.position[1],
        candidate.pos[2] - pose.position[2]
      );
      const valid = candidate.clearance.nearest !== null
        && candidate.clearance.nearest >= MIN_CLEARANCE
        && candidate.subjectVisible;

      // Prefer the smallest move that works - a big pull-back technically
      // clears the lens but throws away the shot the pose was composed for.
      if (valid && (!best || !best.valid || moved < best.moved)) {
        best = { ...candidate, lift, pull, moved, valid: true };
      } else if (!best) {
        best = { ...candidate, lift, pull, moved, valid: false };
      } else if (!best.valid && (candidate.clearance.nearest || 0) > (best.clearance.nearest || 0)) {
        best = { ...candidate, lift, pull, moved, valid: false };
      }
    }
  }

  const p = best.pos.map((v) => Math.round(v));
  console.log(
    `${pose.id.padEnd(16)} FIXED   ${String(baseline.nearest).padStart(6)} -> ` +
    `${String(best.clearance.nearest).padStart(6)}   position: [${p.join(", ")}]  (lift ${best.lift}, pull ${best.pull})`
  );
}

await browser.close();
server.kill("SIGTERM");
