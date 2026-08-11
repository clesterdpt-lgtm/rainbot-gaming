#!/usr/bin/env node
/* ============================================================
   SAINTFALL - aim commitment probe

   Mouse-look used to drive the breastplate 1:1 and without limit, so
   orbiting the camera spun the shoulders a half-turn on stationary
   hips. The replacement has three claims, and all three are
   measurable rather than matters of taste:

     1. FREE LOOK MOVES NOTHING. Orbit the camera without touching a
        mouse button and the body yaw and the chest twist must both
        stay exactly where they were.

     2. THE SPINE HAS A LIMIT. However far the reticle goes, the chest
        must never lead the hips by more than MAX_CHEST_TWIST (54deg).

     3. COMMITTING TURNS THE TROOPER. Hold fire and the body must come
        round until the reticle is inside that twist limit - and no
        further, so shooting at something roughly ahead does not slew
        a moving player off their path.

   Usage: node scripts/saintfall-aim-commit-probe.mjs [outfile.json]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.resolve(root, process.argv[2] || "output/saintfall/aim-commit-probe.json");
const PORT = 45300 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const TWIST_LIMIT_DEG = 54.4;   // MAX_CHEST_TWIST 0.95 rad, plus a hair

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

    const result = await page.evaluate((limit) => {
      const T = window.__SF;
      const out = { free: [], committed: [], release: null };

      const settle = (n) => { for (let i = 0; i < n; i += 1) T.renderOnce(1 / 60); };
      const setup = (camYawDeg) => {
        T.releaseCamera();
        T.teleport(-520, -562, 0);
        T.setFiring(false);
        T.setAds(0);
        T.setGaitInput(0, 0);
        T.weapons.setMode("ranged");
        T.setCam(camYawDeg * Math.PI / 180, 0);
        settle(90);
      };

      /* 1 + 2. Free look at a spread of reticle bearings, including
         directly behind, which is the case that used to wind the
         breastplate right round. */
      for (const camYawDeg of [0, 45, 90, 135, 180, -135, -90, -45]) {
        setup(0);
        const before = T.aimCommitState();
        T.setCam(camYawDeg * Math.PI / 180, 0);
        settle(120);
        const after = T.aimCommitState();
        out.free.push({
          camYawDeg,
          bodyYawMovedDeg: Number(Math.abs(after.bodyYawDeg - before.bodyYawDeg).toFixed(2)),
          chestTwistDeg: after.chestTwistDeg,
          commit: after.commit,
        });
      }

      // 3. Same bearings, but committed.
      for (const camYawDeg of [0, 45, 90, 135, 180, -135, -90, -45]) {
        setup(0);
        T.setCam(camYawDeg * Math.PI / 180, 0);
        T.setFiring(true);
        settle(180);
        const s = T.aimCommitState();
        out.committed.push({
          camYawDeg,
          commit: s.commit,
          chestTwistDeg: s.chestTwistDeg,
          bodyToAimDeg: s.bodyToAimDeg,
        });
      }

      // Releasing must let the twist bleed back to zero.
      setup(0);
      T.setCam(Math.PI / 2, 0);
      T.setFiring(true);
      settle(150);
      const held = T.aimCommitState();
      T.setFiring(false);
      settle(180);
      const let_go = T.aimCommitState();
      out.release = { held, released: let_go };

      /* 4. RUNNING AND FIRING AT ONCE. The body turn feeds the gait's
         turn-rate term, so committing while at speed drives the same
         predicted foot placement a hard stick turn does. If that goes
         wrong the ankles cross, which is the defect the turn-gait
         work removed and the one most likely to come back here. */
      setup(0);
      T.setGaitInput(0, -1);
      settle(120);
      T.setCam(2.0, 0);
      T.setFiring(true);
      let worstSep = Infinity;
      let maxTwist = 0;
      let nonFinite = 0;
      const P = T.playerLegs();
      for (let i = 0; i < 240; i += 1) {
        T.renderOnce(1 / 60);
        const s = T.gaitState();
        const sin = Math.sin(s.yaw);
        const cos = Math.cos(s.yaw);
        const lat = [0, 1].map((l) => {
          const f = P[l].foot;
          const dx = f.x - s.x;
          const dz = f.z - s.z;
          if (!Number.isFinite(dx) || !Number.isFinite(dz)) nonFinite += 1;
          return dx * cos - dz * sin;
        });
        worstSep = Math.min(worstSep, lat[1] - lat[0]);
        maxTwist = Math.max(maxTwist, Math.abs(T.aimCommitState().chestTwistDeg));
      }
      T.setGaitInput(null);
      T.setFiring(false);
      out.runAndFire = {
        minLateralSeparationM: Number(worstSep.toFixed(3)),
        maxChestTwistDeg: Number(maxTwist.toFixed(1)),
        nonFiniteFootReads: nonFinite,
      };
      return out;
    }, TWIST_LIMIT_DEG);

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(result, null, 2));

    const fails = [];
    console.log("\nSAINTFALL aim commitment\n" + "=".repeat(70));
    console.log("FREE LOOK (no button) - body and chest must not move");
    console.log("  camYaw   bodyMoved   chestTwist   commit");
    for (const r of result.free) {
      if (r.bodyYawMovedDeg > 0.5) fails.push(`free look turned the body at ${r.camYawDeg}deg`);
      if (Math.abs(r.chestTwistDeg) > 0.5) fails.push(`free look twisted the chest at ${r.camYawDeg}deg`);
      console.log(`  ${String(r.camYawDeg).padStart(6)}${String(r.bodyYawMovedDeg).padStart(12)}`
        + `${String(r.chestTwistDeg).padStart(13)}${String(r.commit).padStart(9)}`);
    }
    console.log("\nCOMMITTED (fire held) - body comes round, spine stays inside its limit");
    console.log("  camYaw   commit   chestTwist   bodyToAim");
    for (const r of result.committed) {
      if (Math.abs(r.chestTwistDeg) > TWIST_LIMIT_DEG) {
        fails.push(`chest twist ${r.chestTwistDeg}deg exceeds limit at ${r.camYawDeg}deg`);
      }
      if (Math.abs(r.bodyToAimDeg) > TWIST_LIMIT_DEG + 1.5) {
        fails.push(`body never came round at ${r.camYawDeg}deg (${r.bodyToAimDeg}deg off)`);
      }
      console.log(`  ${String(r.camYawDeg).padStart(6)}${String(r.commit).padStart(9)}`
        + `${String(r.chestTwistDeg).padStart(13)}${String(r.bodyToAimDeg).padStart(12)}`);
    }
    const rel = result.release;
    console.log(`\nRELEASE: twist ${rel.held.chestTwistDeg}deg held -> `
      + `${rel.released.chestTwistDeg}deg released (commit ${rel.held.commit} -> ${rel.released.commit})`);
    if (Math.abs(rel.released.chestTwistDeg) > 0.5) fails.push("twist did not bleed off on release");
    if (rel.released.commit > 0.05) fails.push("commitment did not decay on release");

    const rf = result.runAndFire;
    console.log(`RUN + FIRE: min lateral foot separation ${rf.minLateralSeparationM}m, `
      + `peak twist ${rf.maxChestTwistDeg}deg, non-finite reads ${rf.nonFiniteFootReads}`);
    if (rf.minLateralSeparationM <= 0) fails.push("legs crossed while running and firing");
    if (rf.maxChestTwistDeg > TWIST_LIMIT_DEG) fails.push("twist limit broken while running");
    if (rf.nonFiniteFootReads > 0) fails.push("non-finite foot position while running and firing");

    console.log("=".repeat(70));
    if (errors.length) fails.push(`${errors.length} page errors: ${errors[0]}`);
    if (fails.length) {
      console.log("FAIL");
      for (const f of fails) console.log(`  - ${f}`);
    } else {
      console.log("all aim-commitment claims hold");
    }
    console.log(`wrote ${path.relative(root, outFile)}`);
    if (fails.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
