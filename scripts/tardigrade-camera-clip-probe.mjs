#!/usr/bin/env node
/* Is it the HERO inside the object, or the CAMERA?
 *
 * The walking clip probe found the hero never ends up inside a landmark, so
 * this checks the two remaining candidates:
 *
 *   CAMERA   press the hero against each landmark from several bearings and
 *            ask whether the hero is still VISIBLE from the camera. Geometry
 *            between camera and hero is the "I am inside the object" shot.
 *            camMinDist (1.5) is a hard floor on the pull-in, so a wall
 *            closer than that behind the pivot puts the lens inside it.
 *
 *   HIGH ENERGY  walking is slow enough for the controller to sweep
 *            cleanly. Tun (curlTop 30), bonk (bonkLunge 21) and terminal
 *            falls (52) move the body far enough per step to matter, so
 *            each landmark is also charged, headbutted and dropped on.
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
  const THREE = T.THREE;

  const LANDMARKS = {
    bottleCap: { x: -158, z: -166, reach: 120 },
    legoBrick: { x: -271, z: 250, reach: 150 },
    screw: { x: -166, z: 148, reach: 140 },
    shard: { x: 292, z: -232, reach: 250 },
    lolly: { x: 135, z: -148, reach: 200 },
    hose: { x: 306, z: 296, reach: 230 },
    boulders: { x: 8, z: -320, reach: 130 },
  };

  const hidden = [];
  ctx.scene.traverse((o) => { if (o.visible === false) { hidden.push(o); o.visible = true; } });
  const heroRoot = (ctx.tardigrade && ctx.tardigrade.root) || null;
  const isHero = (o) => { for (let n = o; n; n = n.parent) if (n === heroRoot) return true; return false; };

  const rc = new THREE.Raycaster();
  const camPos = new THREE.Vector3();
  const toHero = new THREE.Vector3();

  /** Distance from the camera to the first thing between it and the hero. */
  function occlusion() {
    const p = ctx.player.report().position;
    camPos.copy(ctx.camera.position);
    toHero.set(p.x, p.y + 0.6, p.z).sub(camPos);
    const dist = toHero.length();
    if (dist < 1e-4) return { dist, blockedAt: null };
    toHero.multiplyScalar(1 / dist);
    rc.set(camPos, toHero);
    rc.far = dist;
    for (const h of rc.intersectObject(ctx.scene, true)) {
      const o = h.object;
      if (!o.visible || o.name === "Sky" || o.isPoints || isHero(o)) continue;
      // Water is translucent by design - seeing the animal through the
      // surface of a puddle it is standing in is the intended look, not an
      // occlusion. Counting it conflated "camera stuck inside an object"
      // with "camera correctly above a shallow pool".
      if (/Puddle|SpilledDrink/.test(o.name || "")) continue;
      let vis = true;
      for (let n = o; n; n = n.parent) if (n.visible === false) { vis = false; break; }
      if (vis) return { dist, blockedAt: h.distance, what: o.name || (o.parent && o.parent.name) || "?" };
    }
    return { dist, blockedAt: null };
  }

  const BEARINGS = [0, 72, 144, 216, 288];
  const modes = ["walk", "tun", "bonk", "drop"];
  const out = {};
  for (const m of modes) out[m] = { runs: 0, occluded: 0, heroInside: 0, worst: [] };
  // Grass and moss between lens and animal is normal when you are standing
  // in a thicket; a landmark filling the screen is the reported bug. Tally
  // the blockers so the two are not averaged together.
  const byBlocker = {};
  const BIG = /BottleCap|Lego|Screw|Terracotta|Lolly|Hose|Boulder|Slab|Pot|Drink|Puddle/i;
  let bigBlocks = 0, smallBlocks = 0;

  for (const [id, L] of Object.entries(LANDMARKS)) {
    for (const deg of BEARINGS) {
      const a = (deg * Math.PI) / 180;
      const sx = L.x + Math.cos(a) * L.reach;
      const sz = L.z + Math.sin(a) * L.reach;
      if (Math.abs(sx) > 440 || Math.abs(sz) > 440) continue;

      for (const mode of modes) {
        T.input.stopMove();
        T.input.release("jump"); T.input.release("tun"); T.input.release("slam");
        const y0 = ctx.world.heightAt(sx, sz);
        T.teleportHero(sx, mode === "drop" ? y0 + 160 : y0 + 1.2, sz);
        ctx.advanceTime(0.4);

        const want = Math.atan2(L.x - sx, L.z - sz);
        T.input.look((want - ctx.player.report().camYaw) * 220, 0);
        ctx.advanceTime(0.25);

        if (mode === "tun") T.input.press("tun");
        T.input.move(0, 1);
        if (mode === "bonk") {
          for (let k = 0; k < 10; k += 1) { T.input.tap("slam", 0.06); ctx.advanceTime(0.45); }
        } else {
          ctx.advanceTime(5.0);
        }
        T.input.stopMove();
        T.input.release("tun");
        ctx.advanceTime(0.4);

        const o = occlusion();
        const rec = out[mode];
        rec.runs += 1;
        // Anything solid between lens and hero, closer than ~85% of the way,
        // is the object filling the screen rather than a blade of grass at
        // the edge of frame.
        if (o.blockedAt !== null && o.blockedAt < o.dist * 0.85) {
          rec.occluded += 1;
          const key = String(o.what).replace(/Chunk.*$/, "");
          byBlocker[key] = (byBlocker[key] || 0) + 1;
          if (BIG.test(key)) bigBlocks += 1; else smallBlocks += 1;
          if (rec.worst.length < 8) rec.worst.push({ id, deg, at: Number(o.blockedAt.toFixed(1)), of: Number(o.dist.toFixed(1)), what: o.what });
        }
      }
    }
  }

  for (const o of hidden) o.visible = false;
  return { modes: out, byBlocker, bigBlocks, smallBlocks };
});

console.log("=== CAMERA / HIGH-ENERGY CLIP PROBE ===");
console.log("hero driven at 7 landmarks from up to 5 bearings each\n");
console.log("  mode    runs   camera view blocked by geometry");
for (const [mode, r] of Object.entries(result.modes)) {
  const pct = r.runs ? ((r.occluded / r.runs) * 100).toFixed(0) : "0";
  console.log(`  ${mode.padEnd(6)}  ${String(r.runs).padStart(4)}   ${String(r.occluded + "/" + r.runs).padStart(7)}  (${pct}%)`);
}
console.log(`\n  blocked by a LARGE object : ${result.bigBlocks}`);
console.log(`  blocked by grass/moss     : ${result.smallBlocks}`);
console.log("  by blocker:", JSON.stringify(result.byBlocker));

await browser.close();
server.kill("SIGTERM");
