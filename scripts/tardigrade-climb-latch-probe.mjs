#!/usr/bin/env node
/* Does the climb assist engage during ORDINARY walking?
 *
 * Unlike the bare-capsule probe, this drives the real player through the
 * real game loop, which is where the reported bug lives: hold forward and
 * the animal crawls, tap jump and it moves at full speed.
 *
 * player.report() publishes `climb` (seconds left on the climb latch) and
 * `press` (seconds spent pushing without moving), so we can watch the assist
 * arm itself while the player is doing nothing but walking on open ground.
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

const result = await page.evaluate(() => {
  const T = window.__TSIM;
  const ctx = T.ctx;
  const DT = 1 / 60;
  const WALK = 13.5;

  // Open ground across the map: patio, soil, and the bed east of the paving.
  const SPOTS = [
    [-160, -160], [-160, 40], [-160, 240], [-360, -360], [-360, 200],
    [40, 40], [40, -200], [200, 200], [200, -100], [-40, 300],
    [300, 40], [120, -320], [-260, 400], [360, 300], [80, 160], [-100, -400],
  ];

  /** Walk forward for `seconds`, optionally spamming jump. Returns metrics. */
  function run(x, z, seconds, jump) {
    T.teleportHero(x, ctx.world.heightAt(x, z) + 1.2, z);
    T.input.stopMove();
    T.input.release("jump");
    ctx.advanceTime(0.6);            // settle

    const p0 = ctx.player.report().position;
    T.input.move(0, 1);              // hold forward

    const frames = Math.round(seconds / DT);
    let climbFrames = 0, pressFrames = 0, airFrames = 0;
    let sumBlocked = 0, maxY = -Infinity, minY = Infinity;
    // Straight-line displacement undercounts any curved path, and the
    // camera-relative stick means the hero does curve. Path length and the
    // controller's own reported speed are the honest measures.
    let pathLen = 0, sumSpeed = 0, sumGroundSpeed = 0, groundFrames = 0;
    let prev = ctx.player.report().position;

    for (let i = 0; i < frames; i += 1) {
      if (jump && i % 24 === 0) T.input.press("jump");
      ctx.advanceTime(DT);
      if (jump && i % 24 === 2) T.input.release("jump");
      const r = ctx.player.report();
      if (r.climb > 0) climbFrames += 1;
      if (r.press > 0) pressFrames += 1;
      if (r.airborne) airFrames += 1;
      else { groundFrames += 1; sumGroundSpeed += r.speed; }
      sumBlocked += r.blockedFrac;
      sumSpeed += r.speed;
      pathLen += Math.hypot(r.position.x - prev.x, r.position.z - prev.z);
      prev = r.position;
      if (r.position.y > maxY) maxY = r.position.y;
      if (r.position.y < minY) minY = r.position.y;
    }

    T.input.stopMove();
    T.input.release("jump");
    const p1 = ctx.player.report().position;
    const dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    return {
      dist,
      frac: dist / (WALK * seconds),
      pathFrac: pathLen / (WALK * seconds),
      meanSpeed: sumSpeed / frames,
      groundSpeed: groundFrames ? sumGroundSpeed / groundFrames : 0,
      climb: climbFrames / frames,
      press: pressFrames / frames,
      air: airFrames / frames,
      blocked: sumBlocked / frames,
      yRange: maxY - minY,
    };
  }

  const SECONDS = 4;
  const walkRuns = [];
  const jumpRuns = [];
  for (const [x, z] of SPOTS) {
    walkRuns.push({ x, z, ...run(x, z, SECONDS, false) });
    jumpRuns.push({ x, z, ...run(x, z, SECONDS, true) });
  }

  const mean = (a, k) => a.reduce((s, r) => s + r[k], 0) / a.length;
  return {
    seconds: SECONDS,
    walk: {
      frac: mean(walkRuns, "frac"), pathFrac: mean(walkRuns, "pathFrac"),
      meanSpeed: mean(walkRuns, "meanSpeed"), groundSpeed: mean(walkRuns, "groundSpeed"),
      climb: mean(walkRuns, "climb"),
      press: mean(walkRuns, "press"), blocked: mean(walkRuns, "blocked"),
      air: mean(walkRuns, "air"), yRange: mean(walkRuns, "yRange"),
    },
    jump: {
      frac: mean(jumpRuns, "frac"), pathFrac: mean(jumpRuns, "pathFrac"),
      meanSpeed: mean(jumpRuns, "meanSpeed"), groundSpeed: mean(jumpRuns, "groundSpeed"),
      climb: mean(jumpRuns, "climb"),
      press: mean(jumpRuns, "press"), blocked: mean(jumpRuns, "blocked"),
      air: mean(jumpRuns, "air"), yRange: mean(jumpRuns, "yRange"),
    },
    detail: walkRuns.map((r, i) => ({
      x: r.x, z: r.z,
      walkPct: Number((r.pathFrac * 100).toFixed(0)),
      jumpPct: Number((jumpRuns[i].pathFrac * 100).toFixed(0)),
      walkSpd: Number(r.meanSpeed.toFixed(1)),
      jumpSpd: Number(jumpRuns[i].meanSpeed.toFixed(1)),
      climb: Number(r.climb.toFixed(2)),
      press: Number(r.press.toFixed(2)),
      blocked: Number(r.blocked.toFixed(2)),
      yRange: Number(r.yRange.toFixed(1)),
    })),
  };
});

const pc = (v) => `${(v * 100).toFixed(0)}%`;
console.log("=== CLIMB LATCH PROBE (real player, real loop) ===");
console.log(`each run: hold forward ${result.seconds}s\n`);
for (const mode of ["walk", "jump"]) {
  const m = result[mode];
  console.log(`${mode.padEnd(5)} path ${pc(m.pathFrac)} of walk speed | mean speed ${m.meanSpeed.toFixed(1)}/13.5 (grounded ${m.groundSpeed.toFixed(1)}) | straight-line ${pc(m.frac)} | climb ${pc(m.climb)} | press ${pc(m.press)} | airborne ${pc(m.air)} | deflection ${m.blocked.toFixed(2)} | yRange ${m.yRange.toFixed(1)}`);
}
console.log("\nper spot:");
console.log("     x     z   walk%  jump%  wSpd  jSpd  climb  press  defl   yRange");
for (const d of result.detail) {
  console.log(`  ${String(d.x).padStart(5)} ${String(d.z).padStart(5)}   ${String(d.walkPct).padStart(4)}   ${String(d.jumpPct).padStart(4)}  ${String(d.walkSpd).padStart(4)}  ${String(d.jumpSpd).padStart(4)}   ${d.climb.toFixed(2)}   ${d.press.toFixed(2)}   ${d.blocked.toFixed(2)}   ${d.yRange}`);
}

await browser.close();
server.kill("SIGTERM");
