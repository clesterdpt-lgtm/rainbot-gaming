#!/usr/bin/env node
/* Grounded-walk blockage probe.
 *
 * The reported bug: holding forward crawls, jumping moves at full speed,
 * and the animal can end up standing on nothing. All three are things that
 * only differ between a GROUNDED and an AIRBORNE character, which points at
 * the character controller rather than at any particular piece of geometry.
 *
 * So this drives a bare capsule with the hero's exact parameters directly
 * against ctx.physics, with no player.js in the loop at all - no climb
 * assist, no acceleration curve, no camera. Desired translation is a
 * constant walkSpeed * dt. Anything less than that arriving in
 * `translation` was eaten by the controller.
 *
 * Each sample is run under several autostep settings so the contribution of
 * autostep is measured rather than guessed.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;
const STEP = Number(process.env.STEP || 60);
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

const result = await page.evaluate((step) => {
  const T = window.__TSIM;
  const ctx = T.ctx;
  const phys = ctx.physics;
  const world = ctx.world;

  // Hero body, straight out of player.js's tuning table.
  const RADIUS = 0.32, HALF = 0.07, SKIN = 0.02;
  const FOOT = RADIUS + HALF;          // capsule centre above the foot point
  const SPEED = 13.5;                  // T.walkSpeed
  const DT = 1 / 60;
  const GRAV = 19.6;
  const SETTLE = 30;                   // frames to let it come to rest
  const RUN = 90;                      // 1.5s of walking
  const IDEAL = SPEED * RUN * DT;      // distance an unobstructed walk covers

  // Rapier only copies body positions onto their colliders during a world
  // step. Moving a kinematic body and immediately asking the controller to
  // sweep from there therefore sweeps from the OLD position - the first run
  // of this probe reported a clean 100% everywhere with zero contacts,
  // because the capsule was never actually anywhere near the world.
  const rworld = phys.world;
  const commit = (ch, p) => {
    ch.body.setTranslation(p, true);
    rworld.propagateModifiedBodyPositionsToColliders();
  };

  const MAPHALF = 420;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  /** Drive `ch` forward for RUN frames; return distance + diagnostics. */
  function walk(ch, x0, z0, dx, dz) {
    const y0 = world.heightAt(x0, z0);
    ch.teleport(x0, y0 + FOOT + 0.05, z0);
    rworld.propagateModifiedBodyPositionsToColliders();

    let vy = 0;
    // Settle onto the surface first, so the run itself starts grounded.
    for (let i = 0; i < SETTLE; i += 1) {
      vy -= GRAV * DT;
      const s = ch.move({ x: 0, y: vy * DT, z: 0 }, DT);
      if (s.grounded) vy = 0;
      commit(ch, s.position);
    }

    const start = ch.body.translation();
    const sx = start.x, sy = start.y, sz = start.z;
    const kinds = {};
    let groundedFrames = 0;
    let rise = 0;

    for (let i = 0; i < RUN; i += 1) {
      vy -= GRAV * DT;
      const s = ch.move({ x: dx * SPEED * DT, y: vy * DT, z: dz * SPEED * DT }, DT);
      if (s.grounded) { vy = 0; groundedFrames += 1; }
      for (const c of s.collisions) {
        const k = (c.record && c.record.kind) || "?";
        kinds[k] = (kinds[k] || 0) + 1;
      }
      commit(ch, s.position);
      const t = ch.body.translation();
      if (t.y - sy > rise) rise = t.y - sy;
    }

    const end = ch.body.translation();
    const dist = Math.hypot(end.x - sx, end.z - sz);
    // How far the capsule ended up above the drawn ground under it.
    const float = end.y - FOOT - world.heightAt(end.x, end.z);
    return {
      dist,
      frac: dist / IDEAL,
      grounded: groundedFrames / RUN,
      rise,
      float,
      kinds,
    };
  }

  /* Sample the map on a coarse grid, four directions each. */
  const points = [];
  for (let x = -MAPHALF; x <= MAPHALF; x += step) {
    for (let z = -MAPHALF; z <= MAPHALF; z += step) points.push([x, z]);
  }

  // Autostep variants. `null` disables it entirely.
  const VARIANTS = [
    { id: "shipping", h: Math.min(3.4, (HALF + RADIUS) * 7.5) },
    { id: "off", h: null },
    { id: "half-capsule", h: (HALF + RADIUS) * 0.5 },
    { id: "one-capsule", h: (HALF + RADIUS) * 1.0 },
  ];

  const out = { ideal: IDEAL, samples: 0, variants: {}, worst: [] };

  for (const v of VARIANTS) {
    const ch = phys.createCharacter({ radius: RADIUS, halfHeight: HALF, offset: SKIN, position: [0, 200, 0] });
    if (v.h === null) ch.controller.disableAutostep();
    else ch.controller.enableAutostep(v.h, 0.04, true);

    let n = 0, sumFrac = 0, blocked = 0, floaters = 0, sumRise = 0, sumGround = 0;
    const kinds = {};
    const worst = [];

    for (const [x, z] of points) {
      for (const [dx, dz] of DIRS) {
        const r = walk(ch, x, z, dx, dz);
        if (!Number.isFinite(r.dist)) continue;
        n += 1;
        sumFrac += r.frac;
        sumRise += r.rise;
        sumGround += r.grounded;
        if (r.frac < 0.5) blocked += 1;
        if (r.float > 1.0) floaters += 1;
        for (const k in r.kinds) kinds[k] = (kinds[k] || 0) + r.kinds[k];
        if (v.id === "shipping" && r.frac < 0.4) {
          worst.push({ x, z, dir: [dx, dz], frac: Number(r.frac.toFixed(3)),
                       rise: Number(r.rise.toFixed(2)), float: Number(r.float.toFixed(2)),
                       kinds: r.kinds, grounded: Number(r.grounded.toFixed(2)) });
        }
      }
    }

    out.samples = n;
    out.variants[v.id] = {
      autostep: v.h === null ? "off" : Number(v.h.toFixed(3)),
      meanFrac: Number((sumFrac / n).toFixed(3)),
      blockedPct: Number(((blocked / n) * 100).toFixed(1)),
      floatPct: Number(((floaters / n) * 100).toFixed(1)),
      meanRise: Number((sumRise / n).toFixed(3)),
      meanGrounded: Number((sumGround / n).toFixed(3)),
      kinds,
    };
    if (v.id === "shipping") out.worst = worst.slice(0, 16);

    ch.dispose();
  }

  return out;
}, STEP);

console.log("=== GROUNDED WALK PROBE ===");
console.log(`samples ${result.samples}   ideal distance ${result.ideal.toFixed(2)} units\n`);
for (const [id, v] of Object.entries(result.variants)) {
  console.log(`${id.padEnd(14)} autostep=${String(v.autostep).padEnd(7)} mean speed ${(v.meanFrac * 100).toFixed(1)}% of walk   blocked(<50%) ${v.blockedPct}%   left floating ${v.floatPct}%   mean rise ${v.meanRise}   grounded ${v.meanGrounded}`);
  console.log(`${"".padEnd(14)} collider contacts: ${JSON.stringify(v.kinds)}`);
}
console.log("\nworst shipping-config samples:");
result.worst.forEach((w) => console.log(
  `   (${w.x}, ${w.z}) dir ${w.dir}  speed ${(w.frac * 100).toFixed(0)}%  rise ${w.rise}  float ${w.float}  grounded ${w.grounded}  ${JSON.stringify(w.kinds)}`));

await browser.close();
server.kill("SIGTERM");
