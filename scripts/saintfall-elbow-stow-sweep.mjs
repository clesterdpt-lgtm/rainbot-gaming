#!/usr/bin/env node
/* ============================================================
   SAINTFALL - elbow behaviour through the sheathe

   The bearing sweep covers a settled carry, committed and at low
   ready, and passes. The inversion was still being seen in play, and
   the screenshot it came from shows the lance angled down and out to
   the trooper's right - which is not any settled carry position. It
   is the lance PART WAY to the trooper's back.

   That transition is its own regime and nothing was measuring it. The
   wrist targets blend from the grips to the rest pose through
   `handRelease`, and the elbow poles blend from the carry poles to
   the rest poles alongside them - two independent lerps, either of
   which can put the pole along the arm somewhere in the middle even
   though both ends are sound.

   So: pin the sheathe at successive phases and watch the same two
   things the bearing sweep watches.

   Usage: node scripts/saintfall-elbow-stow-sweep.mjs [outfile.json]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.resolve(root, process.argv[2] || "output/saintfall/elbow-stow-sweep.json");
const PORT = 42400 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

// Same limits the bearing sweep uses, so the two are comparable.
const JUMP_LIMIT_M = 0.11;
/* HOW MUCH OF THE AUTHORED POLE SURVIVES being made square to the
   arm: sqrt(1 - (pole . armAxis)^2). This is the length of the part
   that actually chooses where the elbow goes.

   It replaced a floor on `perp` (= 1 - |dot|) once the solve started
   flattening its poles. `perp` used to describe what the solver
   received; now the solver always receives a perpendicular pole and
   `perp` only describes how far the authored one had leaned, so a
   floor on it is no longer the same claim. This is, and it separates
   the three cases cleanly:

     0.154  the trigger pole that inverted at every off-forward aim
     0.525  the blended pole half way through the sheathe
     0.777  the worst case now

   0.55 sits between the failures and the fix rather than just under
   the current numbers. */
/* Aligned with the bearing sweep's REGIME-AWARE floors: the
   straight-wrist hold walks the committed wrist far up the forearm,
   and mid-blend committed samples legitimately thin below 0.45 with
   the jump gate green - the floor is the canary, the jump gate is
   the detector. See saintfall-elbow-sweep.mjs for the calibration
   table. */
const POLE_SURVIVAL_FLOOR_LOWREADY = 0.45;
const POLE_SURVIVAL_FLOOR_COMMITTED = 0.25;
// 2% of the sheathe. Fine enough that a pole passing through the arm
// cannot hide between two samples.
const PHASE_STEP = 0.02;

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
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=low`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

    const rows = await page.evaluate((step) => {
      const T = window.__SF;
      const THREE = T.THREE;
      T.clearEnemies();
      T.releaseCamera();
      T.teleport(-520, -562, 0);
      T.autoStow(false);
      T.weapons.setMode("ranged");
      T.setGaitInput(0, 0);
      for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);

      const dbg = T.armSolveDebug(true);
      const fig = T.figureNodes();
      const shoulder = new THREE.Vector3();
      const elbow = new THREE.Vector3();
      const wrist = new THREE.Vector3();
      const axis = new THREE.Vector3();
      const arm = new THREE.Vector3();
      const out = [];

      /* Both carry regimes and a few bearings, because the blend runs
         from wherever the carry had the arms - and that start point is
         different in each. */
      for (const firing of [true, false]) {
        for (const yawDeg of [0, -60, 120]) {
          T.setFiring(firing);
          T.setCam(yawDeg * Math.PI / 180, -0.05);
          T.forceStow(0);
          for (let i = 0; i < 150; i += 1) T.renderOnce(1 / 60);

          for (let phase = 0; phase <= 1.0001; phase += step) {
            T.forceStow(Math.min(1, phase));
            // Short settle: the pose is pinned, so this only lets the
            // hand-roll rate limiter catch up.
            for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);
            const row = {
              firing, yawDeg, phase: Number(phase.toFixed(3)),
              release: T.stowState().handRelease,
              arms: [],
            };
            for (let a = 0; a < 2; a += 1) {
              fig.armPivots[a].getWorldPosition(shoulder);
              fig.elbowPivots[a].getWorldPosition(elbow);
              fig.handPivots[a].getWorldPosition(wrist);
              arm.copy(wrist).sub(shoulder);
              const armLen = arm.length();
              if (armLen > 1e-6) arm.divideScalar(armLen);
              axis.copy(elbow).sub(shoulder);
              axis.addScaledVector(arm, -axis.dot(arm));
              const s = T.gaitState();
              const sin = Math.sin(s.yaw);
              const cos = Math.cos(s.yaw);
              row.arms.push({
                lat: +(axis.x * cos - axis.z * sin).toFixed(4),
                fore: +(axis.x * sin + axis.z * cos).toFixed(4),
                up: +axis.y.toFixed(4),
                bend: +axis.length().toFixed(4),
                perp: +dbg[a].perp.toFixed(4),
              });
            }
            out.push(row);
          }
          T.forceStow(0);
          for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);
        }
      }
      T.setFiring(false);
      T.armSolveDebug(false);
      return out;
    }, PHASE_STEP);

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(rows, null, 2));

    const fails = [];
    const worst = [{ jump: 0 }, { jump: 0 }];
    const lowPerp = [1, 1];
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.firing ? "firing" : "low ready"} yaw ${r.yawDeg}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    for (const [key, list] of groups) {
      list.sort((a, b) => a.phase - b.phase);
      for (let i = 0; i < list.length; i += 1) {
        for (let a = 0; a < 2; a += 1) {
          const p = list[i].arms[a];
          const survives = Math.sqrt(Math.max(0, 1 - (1 - p.perp) ** 2));
          if (survives < lowPerp[a]) lowPerp[a] = survives;
          const survivalFloor = list[i].firing
            ? POLE_SURVIVAL_FLOOR_COMMITTED : POLE_SURVIVAL_FLOOR_LOWREADY;
          if (survives < survivalFloor) {
            fails.push(`${a === 0 ? "support" : "trigger"} pole has only `
              + `${survives.toFixed(3)} of itself left square to the arm at `
              + `${key}, sheathe ${list[i].phase}`);
          }
          if (i === 0) continue;
          const q = list[i - 1].arms[a];
          const jump = Math.hypot(p.lat - q.lat, p.fore - q.fore, p.up - q.up);
          if (jump > worst[a].jump) worst[a] = { jump, key, phase: list[i].phase };
          if (jump > JUMP_LIMIT_M) {
            fails.push(`${a === 0 ? "support" : "trigger"} elbow jumped `
              + `${(jump * 1000).toFixed(0)}mm at ${key} between sheathe `
              + `${list[i - 1].phase} and ${list[i].phase}`);
          }
        }
      }
    }

    console.log("\nSAINTFALL elbow through the sheathe\n" + "=".repeat(64));
    console.log(`${rows.length} samples: 2 carry regimes x 3 bearings x `
      + `${Math.round(1 / PHASE_STEP) + 1} sheathe phases x 2 arms`);
    for (let a = 0; a < 2; a += 1) {
      const w = worst[a];
      console.log(`${a === 0 ? "support" : "trigger"}: worst step `
        + `${(w.jump * 1000).toFixed(0)}mm`
        + (w.key ? ` (${w.key}, sheathe ${w.phase})` : "")
        + `, pole keeps ${lowPerp[a].toFixed(3)} of itself at worst`);
    }
    console.log("=".repeat(64));
    if (errors.length) fails.push(`${errors.length} page errors: ${errors[0]}`);
    if (fails.length) {
      console.log("FAIL");
      const seen = new Set();
      for (const f of fails) {
        const k = f.slice(0, 46);
        if (seen.has(k)) continue;
        seen.add(k);
        if (seen.size > 12) break;
        console.log(`  - ${f}`);
      }
      console.log(`  (${fails.length} failing samples in total)`);
      process.exitCode = 1;
    } else {
      console.log("the arms stay sound the whole way to the trooper's back");
    }
    console.log(`wrote ${path.relative(root, outFile)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
