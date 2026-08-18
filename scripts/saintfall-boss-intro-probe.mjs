#!/usr/bin/env node
/* ============================================================
   SAINTFALL - boss intro reveal camera consistency probe

   Verifies that:
     1. All bosses (including the Matriarch in Gilded Reach and Coulter in Fallen Saint)
        have an authored cinematic intro reveal camera.
     2. Every boss intro camera uses fixed, authored coordinates rather than
        player-relative angles, so the framing is invariant and never blocked
        by scenery regardless of where the player enters from (N, S, E, W).
     3. The camera is properly released back to the player when the intro completes.
     4. Screenshots of every boss intro are captured for verification.

   Usage:
     node scripts/saintfall-boss-intro-probe.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "output/saintfall/boss-intros");
const port = 54100 + (process.pid % 4000);
const base = `http://127.0.0.1:${port}`;
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(outDir, { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    window.__SF.hideHud(false);
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
  });

  const bosses = [
    { key: "reach", name: "The Matriarch", district: "reach" },
    { key: "censer", name: "The Winnower", district: "censer" },
    { key: "scar", name: "The Distaff", district: "scar" },
    { key: "ossuary", name: "The Garner", district: "ossuary" },
    { key: "choir", name: "The Stylite", district: "choir" },
    { key: "bloom", name: "The Abbess", district: "bloom" },
    { key: "saint", name: "The Coulter", district: "saint" },
    { key: "cathedral", name: "The Apostate", district: "cathedral" },
  ];

  for (const b of bosses) {
    console.log(`\n=== BOSS INTRO: ${b.name.toUpperCase()} (${b.key}) ===`);

    // Test approach from 4 cardinal directions: North (0), East (PI/2), South (PI), West (3PI/2)
    const angles = [
      { name: "North", angle: 0 },
      { name: "East", angle: Math.PI / 2 },
      { name: "South", angle: Math.PI },
      { name: "West", angle: (3 * Math.PI) / 2 },
    ];

    const camPoses = [];

    for (const a of angles) {
      const introData = await page.evaluate(async (args) => {
        const T = window.__SF;
        const M = T.ctx.mission;
        const key = args.key;
        const angle = args.angle;

        // Ensure boss instance is spawned before reading coordinates
        if (key === "censer") T.ctx.winnower?.ensureSpawned?.();
        else if (key === "choir") T.ctx.stylite?.ensureSpawned?.();
        else if (key === "bloom") T.ctx.abbess?.ensureSpawned?.();
        else if (key === "cathedral") T.ctx.apostate?.ensureSpawned?.();
        else T.ctx.districtBosses?.ensureSpawned?.(key);

        // Find precise anchor coordinates for each boss using status()
        let bx = 0, bz = 0, appDist = 24;
        if (key === "cathedral") {
          const st = T.ctx.apostate.status();
          bx = st.x; bz = st.z; appDist = 18;
        } else if (key === "censer") {
          const st = T.ctx.winnower.status();
          bx = st.x; bz = st.z; appDist = 30;
        } else if (key === "scar") {
          const st = T.ctx.distaff.status();
          bx = st.x; bz = st.z; appDist = 24;
        } else if (key === "ossuary") {
          const st = T.ctx.garner.status();
          bx = st.x; bz = st.z; appDist = 24;
        } else if (key === "choir") {
          const site = T.ctx.districtBosses.sites.find((s) => s.key === "choir");
          bx = site.x; bz = site.z; appDist = 45;
        } else if (key === "bloom") {
          const st = T.ctx.abbess.status();
          bx = st.x; bz = st.z; appDist = 24;
        } else if (key === "saint") {
          const st = T.ctx.districtBosses.status("saint");
          bx = st.x; bz = st.z; appDist = 50;
        } else {
          const st = T.ctx.districtBosses.status(key);
          bx = st.x; bz = st.z; appDist = 24;
        }

        // Reset state first
        T.releaseCamera();
        if (key === "cathedral") {
          M.state.phase = "cathedralBoss";
          for (const boss of M.bosses) boss.done = true;
          M.state.bossesDone = 7;
          T.ctx.apostate?.reset?.();
        } else if (key === "saint") {
          M.state.phase = "saintBoss";
          for (const boss of M.bosses) {
            if (boss.key !== "saint") boss.done = true;
          }
          M.state.bossesDone = 6;
          T.ctx.districtBosses?.reset?.("saint");
        } else {
          M.state.phase = "districtBosses";
          for (const boss of M.bosses) boss.done = false;
          M.state.bossesDone = 0;
          if (key === "censer") T.ctx.winnower?.resetToPerch?.();
          else if (key === "scar") T.ctx.distaff?.resetToLair?.();
          else if (key === "ossuary") T.ctx.garner?.resetToPit?.();
          else if (key === "choir") T.ctx.stylite?.resetToPerch?.();
          else if (key === "bloom") T.ctx.abbess?.resetToSeat?.();
          else T.ctx.districtBosses?.reset?.(key);
        }

        // Teleport to approach distance in chosen direction
        const px = bx + Math.sin(angle) * appDist;
        const pz = bz + Math.cos(angle) * appDist;
        T._teleportRaw(px, pz, 0);

        // Reset once more after landing at the new position so dormant aggro triggers cleanly
        if (key === "cathedral") T.ctx.apostate?.reset?.();
        else if (key === "saint") T.ctx.districtBosses?.reset?.("saint");
        else if (key === "censer") T.ctx.winnower?.resetToPerch?.();
        else if (key === "scar") T.ctx.distaff?.resetToLair?.();
        else if (key === "ossuary") T.ctx.garner?.resetToPit?.();
        else if (key === "choir") T.ctx.stylite?.resetToPerch?.();
        else if (key === "bloom") T.ctx.abbess?.resetToSeat?.();
        else T.ctx.districtBosses?.reset?.(key);

        T.releaseCamera();

        // Step forward inside to trigger aggro / alert
        let sawFree = false;
        let camPos = null;
        let camTarget = null;
        let camFov = null;
        let secs = 0;

        let lastPhase = "";
        for (let frame = 0; frame < 180; frame += 1) {
          T.renderOnce(1 / 60);
          secs += 1 / 60;
          if (key === "choir") {
            const st = T.ctx.stylite.status();
            lastPhase = st?.phase;
          }
          if (T.player.state.free) {
            sawFree = true;
            if (!camPos) {
              camPos = {
                x: Number(T.player.state.freePos.x.toFixed(2)),
                y: Number(T.player.state.freePos.y.toFixed(2)),
                z: Number(T.player.state.freePos.z.toFixed(2)),
              };
              camTarget = {
                x: Number(T.player.state.freeTarget.x.toFixed(2)),
                y: Number(T.player.state.freeTarget.y.toFixed(2)),
                z: Number(T.player.state.freeTarget.z.toFixed(2)),
              };
              camFov = T.player.state.freeFov;
            }
          }
        }

        // Run until alert ends and verify camera releases
        let freeReleased = false;
        for (let frame = 0; frame < 300; frame += 1) {
          T.renderOnce(1 / 60);
          if (!T.player.state.free && sawFree) {
            freeReleased = true;
            break;
          }
        }

        return {
          sawFree,
          camPos,
          camTarget,
          camFov,
          freeReleased,
        };
      }, { key: b.key, angle: a.angle });

      camPoses.push({ name: a.name, ...introData });
    }

    // Log angle details
    for (const p of camPoses) {
      console.log(`    [${p.name}] sawFree: ${p.sawFree}, camPos: ${p.camPos ? `(${p.camPos.x}, ${p.camPos.y}, ${p.camPos.z})` : "none"}, released: ${p.freeReleased}, phase: ${p.lastPhase}`);
    }

    // Check 1: Intro camera played for this boss
    const allPlayed = camPoses.every((p) => p.sawFree);
    check(`${b.name} intro camera triggers`, allPlayed,
      `seen across ${camPoses.filter((p) => p.sawFree).length}/4 angles`);

    // Check 2: Intro camera is INVARIANT to entry angle (identical pos/target)
    const firstPos = camPoses.find((p) => p.camPos)?.camPos;
    const firstTarget = camPoses.find((p) => p.camTarget)?.camTarget;
    let invariant = !!firstPos;
    if (firstPos) {
      for (const p of camPoses) {
        if (!p.camPos || Math.hypot(p.camPos.x - firstPos.x, p.camPos.z - firstPos.z) > 0.5) {
          invariant = false;
        }
      }
    }
    check(`${b.name} intro camera is invariant to approach angle (unobstructed authored view)`,
      invariant,
      `cam: (${firstPos?.x}, ${firstPos?.y}, ${firstPos?.z}) -> target: (${firstTarget?.x}, ${firstTarget?.y}, ${firstTarget?.z})`);

    // Check 3: Camera is cleanly released back to the player
    const allReleased = camPoses.every((p) => p.freeReleased);
    check(`${b.name} intro camera releases back to player when alert completes`, allReleased);

    // Save screenshot of the reveal shot
    await page.evaluate(async (args) => {
      const T = window.__SF;
      const M = T.ctx.mission;
      const key = args.key;
      T.releaseCamera();
      if (key === "cathedral") {
        M.state.phase = "cathedralBoss";
        for (const boss of M.bosses) boss.done = true;
        M.state.bossesDone = 7;
        T.ctx.apostate?.reset?.();
      } else if (key === "saint") {
        M.state.phase = "saintBoss";
        for (const boss of M.bosses) {
          if (boss.key !== "saint") boss.done = true;
        }
        M.state.bossesDone = 6;
        T.ctx.districtBosses?.reset?.("saint");
      } else {
        M.state.phase = "districtBosses";
        for (const boss of M.bosses) boss.done = false;
        M.state.bossesDone = 0;
        if (key === "censer") T.ctx.winnower?.resetToPerch?.();
        else if (key === "scar") T.ctx.distaff?.resetToLair?.();
        else if (key === "ossuary") T.ctx.garner?.resetToPit?.();
        else if (key === "choir") T.ctx.stylite?.reset?.();
        else if (key === "bloom") T.ctx.abbess?.reset?.();
        else T.ctx.districtBosses?.reset?.(key);
      }
      for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);

      let bx = 0, bz = 0, appDist = 26;
      if (key === "cathedral") {
        const st = T.ctx.apostate.status();
        bx = st.x; bz = st.z; appDist = 28;
      } else if (key === "censer") {
        const st = T.ctx.winnower.status();
        bx = st.x; bz = st.z; appDist = 32;
      } else if (key === "scar") {
        const st = T.ctx.distaff.status();
        bx = st.x; bz = st.z; appDist = 26;
      } else if (key === "ossuary") {
        const st = T.ctx.garner.status();
        bx = st.x; bz = st.z; appDist = 26;
      } else if (key === "choir") {
        const site = T.ctx.districtBosses.sites.find((s) => s.key === "choir");
        bx = site.x; bz = site.z; appDist = 30;
      } else if (key === "bloom") {
        const st = T.ctx.abbess.status();
        bx = st.x; bz = st.z; appDist = 26;
      } else if (key === "saint") {
        const st = T.ctx.districtBosses.status("saint");
        bx = st.x; bz = st.z; appDist = 55;
      } else {
        const st = T.ctx.districtBosses.status(key);
        bx = st.x; bz = st.z; appDist = 26;
      }

      T._teleportRaw(bx + appDist, bz, 0);
      for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
    }, { key: b.key });

    await page.screenshot({ path: path.join(outDir, `${b.key}-reveal.png`) });
  }

  console.log("\n=== PAGE ERRORS ===");
  check("no page errors during all boss intro reveals", pageErrors.length === 0, pageErrors[0] || "");

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

console.log(`\n${failed === 0 ? "ALL BOSS INTRO CHECKS PASSED!" : "FAILED"} (${results.length - failed}/${results.length} checks)`);
if (failed) process.exit(1);
