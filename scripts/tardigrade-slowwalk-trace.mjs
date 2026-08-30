#!/usr/bin/env node
/* Per-frame trace of a slow walk on flat ground.
 *
 * At (-160, 240) the ground is flat (measured vertical range 0.1 over four
 * seconds), nothing is in the way (deflection 0.00) and the climb assist
 * never arms - yet holding forward yields 4.1 units/s where jumping yields
 * 10.3. So the loss is not collision. This dumps what the controller asked
 * for against what it got, frame by frame, to find where it goes.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const URL_ = `${BASE}/games/tardigrade-simulator.html?qa=1&quality=${process.env.Q || "ultra"}`;
const AT = (process.env.AT || "-160,240").split(",").map(Number);

const server = spawn("/opt/homebrew/bin/python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: root, stdio: ["ignore", "ignore", "ignore"],
});
for (let i = 0; i < 200; i += 1) {
  try { if ((await fetch(`${BASE}/games/tardigrade-simulator.html`)).ok) break; } catch (_) {}
  await delay(100);
}

const browser = await chromium.launch({
  channel: "chromium", headless: true,
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  [page error]", m.text()); });
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__TSIM && window.__TSIM.isReady(), null, { timeout: 120000 });

const out = await page.evaluate(([x, z]) => {
  const T = window.__TSIM;
  const ctx = T.ctx;
  const DT = 1 / 60;

  T.teleportHero(x, ctx.world.heightAt(x, z) + 1.2, z);
  T.input.stopMove();
  ctx.advanceTime(0.6);
  T.input.move(0, 1);

  const rows = [];
  let prev = ctx.player.report().position;
  for (let i = 0; i < 180; i += 1) {
    ctx.advanceTime(DT);
    const r = ctx.player.report();
    const stepDist = Math.hypot(r.position.x - prev.x, r.position.z - prev.z);
    rows.push({
      i,
      // reported horizontal speed from `velocity`
      v: Number(r.speed.toFixed(2)),
      // speed actually realised in position this frame
      real: Number((stepDist / DT).toFixed(2)),
      vy: Number(r.verticalSpeed.toFixed(1)),
      g: r.grounded ? 1 : 0,
      slope: Number(r.slope.toFixed(2)),
      defl: Number(r.blockedFrac.toFixed(4)),
      into: Number(r.into.toFixed(2)),
      ts: Number(r.timeScale.toFixed(2)),
      hs: Number(r.hitStop.toFixed(2)),
      y: Number(r.position.y.toFixed(2)),
      yaw: Number(r.yaw.toFixed(2)),
      camYaw: Number(r.camYaw.toFixed(2)),
      sub: Number(r.submersion.toFixed(2)),
    });
    prev = r.position;
  }
  T.input.stopMove();

  const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / rows.length;
  const tail = rows.slice(60);   // after the first second, i.e. at steady state
  const meanTail = (k) => tail.reduce((s, r) => s + r[k], 0) / tail.length;

  return {
    ground: ctx.world.heightAt(x, z),
    rows: rows.filter((r) => r.i % 3 === 0 && r.i >= 100 && r.i < 160),
    summary: {
      meanV: mean("v"), meanReal: mean("real"),
      steadyV: meanTail("v"), steadyReal: meanTail("real"),
      groundedFrac: mean("g"), meanSlope: mean("slope"),
      meanTs: mean("ts"), meanSub: mean("sub"),
      camYawDrift: rows[rows.length - 1].camYaw - rows[0].camYaw,
      yawDrift: rows[rows.length - 1].yaw - rows[0].yaw,
    },
  };
}, AT);

console.log(`=== SLOW WALK TRACE at (${AT[0]}, ${AT[1]}) ground y=${out.ground.toFixed(2)} ===\n`);
console.log("  frame   vel  realised   into    defl  gnd  slope     y");
for (const r of out.rows) {
  console.log(`  ${String(r.i).padStart(5)}  ${String(r.v).padStart(5)}  ${String(r.real).padStart(8)}  ${String(r.into).padStart(5)}  ${String(r.defl).padStart(6)}  ${r.g}  ${String(r.slope).padStart(5)}  ${String(r.y).padStart(6)}`);
}
const s = out.summary;
console.log(`\nmean velocity ${s.meanV.toFixed(2)}   mean realised ${s.meanReal.toFixed(2)}`);
console.log(`steady-state (after 1s): velocity ${s.steadyV.toFixed(2)}   realised ${s.steadyReal.toFixed(2)}`);
console.log(`grounded ${(s.groundedFrac * 100).toFixed(0)}%   mean slope ${s.meanSlope.toFixed(3)}   timeScale ${s.meanTs.toFixed(2)}   submersion ${s.meanSub.toFixed(2)}`);
console.log(`camera yaw drift ${s.camYawDrift.toFixed(2)} rad   hero yaw drift ${s.yawDrift.toFixed(2)} rad`);

await browser.close();
server.kill("SIGTERM");
