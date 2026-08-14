#!/usr/bin/env node
/* Saintfall third-person shot convergence and reticle-spread proof.

   Reproduces the reported ground interception by finding a ground-level
   enemy that the camera-centre ray sees while the old parallel emitter
   ray reaches terrain first. The real trigger must now converge from the
   posed lance emitter onto that enemy. It also measures and photographs
   the hip-fire and RMB/ADS reticle gaps.

   Usage: node scripts/saintfall-reticle-ballistics-probe.mjs [--out DIR]
*/

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const out = path.resolve(root, outArg >= 0
  ? process.argv[outArg + 1]
  : "output/saintfall/reticle-ballistics-probe");
const port = 46600 + (process.pid % 900);
const base = `http://127.0.0.1:${port}`;

function startServer() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}

async function waitForServer() {
  for (let i = 0; i < 200; i += 1) {
    try {
      if ((await fetch(`${base}/games/saintfall.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

async function main() {
  await mkdir(out, { recursive: true });
  const server = startServer();
  let browser = null;
  const errors = [];
  const checks = {};
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    await page.goto(`${base}/games/saintfall.html?qa=1&intro=0&quality=low`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });

    await page.evaluate(() => {
      const T = window.__SF;
      T.maximize();
      T.setAutoStow?.(false);
      T.clearEnemies();
      T.releaseCamera();
      T.weapons.setMode("ranged");
      T.weapons.resupply();
      T.setGaitInput(0, 0);
      T.setAds(0);
      T.setFiring(false);
      for (let i = 0; i < 50; i += 1) T.renderOnce(1 / 60);
    });
    await page.waitForTimeout(150);
    const hipReticle = await page.evaluate(() => window.__SF.reticleState());
    await page.locator(".sf-stage").screenshot({ path: path.join(out, "reticle-hip.png") });

    await page.evaluate(() => {
      const T = window.__SF;
      T.setAds(1);
      for (let i = 0; i < 50; i += 1) T.renderOnce(1 / 60);
    });
    await page.waitForTimeout(150);
    const adsReticle = await page.evaluate(() => window.__SF.reticleState());
    await page.locator(".sf-stage").screenshot({ path: path.join(out, "reticle-ads.png") });

    const ballistic = await page.evaluate(() => {
      const T = window.__SF;
      const THREE = T.ctx.THREE;
      const range = 18;
      let setup = null;
      const candidates = [];
      /* Prefer locally level lanes. The regression needs the CAMERA
         to see the target and the lower emitter to see it too after
         convergence; a dune crest hiding the target from the weapon
         is honest cover, not the defect under test. */
      for (let px = -760; px <= 760 && candidates.length < 72; px += 190) {
        for (let pz = -760; pz <= 760 && candidates.length < 72; pz += 190) {
          const py = T.ctx.terrain.heightAt(px, pz);
          if (T.ctx.collide.blocked(px, pz, py)) continue;
          for (let bearing = 0; bearing < 16 && candidates.length < 72; bearing += 1) {
            const yaw = bearing * Math.PI * 2 / 16;
            const tx = px + Math.sin(yaw) * range;
            const tz = pz + Math.cos(yaw) * range;
            const ty = T.ctx.terrain.heightAt(tx, tz);
            if (T.ctx.collide.blocked(tx, tz, ty)) continue;
            let laneHigh = -Infinity;
            for (let sample = 1; sample < 8; sample += 1) {
              const t = sample / 8;
              laneHigh = Math.max(laneHigh, T.ctx.terrain.heightAt(
                px + (tx - px) * t,
                pz + (tz - pz) * t
              ));
            }
            if (Math.abs(ty - py) <= 0.45 && laneHigh <= Math.max(py, ty) + 0.28) {
              candidates.push({ x: px, z: pz, yaw, tx, tz });
            }
          }
        }
      }

      for (const candidate of candidates) {
        if (setup) break;
        T.clearEnemies();
        T.teleport(candidate.x, candidate.z, candidate.yaw);
        const yaw = candidate.yaw;
        const tx = candidate.tx;
        const tz = candidate.tz;
        const ty = T.ctx.terrain.heightAt(tx, tz);
        T.spawnEnemy("thresher", tx, tz, { health: 180, yaw: yaw + Math.PI });
        const enemy = T.ctx.enemies.live[0];
        if (!enemy) continue;
        enemy.stunTime = 999;
        const box = T.ctx.combat.hitbox[enemy.key];
        const aimY = enemy.y + (box.y0 + box.y1) * 0.5;
        T.setAds(1);
        const aim = T.aimAt(enemy.x, aimY, enemy.z, 10);
        for (let i = 0; i < 35; i += 1) T.renderOnce(1 / 60);

        const eye = T.render.camera.getWorldPosition(new THREE.Vector3());
        const cameraDir = T.render.camera.getWorldDirection(new THREE.Vector3());
        const cameraWall = T.ctx.collide.rayBlock(
          eye.x, eye.y, eye.z,
          cameraDir.x, cameraDir.y, cameraDir.z, 320
        );
        const cameraHit = T.ctx.combat.raycastEnemies(
          eye.x, eye.y, eye.z,
          cameraDir.x, cameraDir.y, cameraDir.z,
          Math.min(320, cameraWall)
        );
        const port = T.weapons.current.emitter || T.weapons.current.muzzle;
        const emitter = port.getWorldPosition(new THREE.Vector3());
        const legacy = T.ctx.collide.rayBlock(
          emitter.x, emitter.y, emitter.z,
          cameraDir.x, cameraDir.y, cameraDir.z, 320
        );
        const aimPoint = cameraHit
          ? eye.clone().addScaledVector(cameraDir, cameraHit.t)
          : null;
        const converged = aimPoint ? aimPoint.clone().sub(emitter) : null;
        const emitterToAim = converged?.length() || Infinity;
        if (converged) converged.normalize();
        const convergedClear = converged ? T.ctx.collide.rayBlock(
          emitter.x, emitter.y, emitter.z,
          converged.x, converged.y, converged.z, 320
        ) : 0;
        if (cameraHit?.inst === enemy
          && legacy + 0.5 < cameraHit.t
          && (convergedClear === Infinity || convergedClear + 0.01 >= emitterToAim)) {
          setup = {
            yaw,
            aimErrorDeg: aim.errorDeg,
            cameraHitM: cameraHit.t,
            legacyParallelClearM: legacy,
            convergedClearM: convergedClear,
            emitterToAimM: emitterToAim,
            enemy: enemy.key,
          };
        }
      }

      if (!setup) return { error: "could not reproduce the parallel-ray ground interception" };
      const before = T.combatStats();
      const beforeHealth = T.enemyStatus()[0].health;
      const random = Math.random;
      Math.random = () => 0;
      try {
        T.setFiring(true);
        T.fireWeapon(1);
        T.setFiring(false);
      } finally {
        Math.random = random;
      }
      const after = T.combatStats();
      return {
        ...setup,
        before,
        after,
        beforeHealth,
        afterHealth: T.enemyStatus()[0]?.health ?? 0,
        solution: T.shotSolution(),
      };
    });

    checks.hipReticleIsWide = hipReticle.gapPx >= 24 && hipReticle.coneRad >= 0.05;
    checks.adsReticleIsTight = adsReticle.gapPx <= 14 && adsReticle.coneRad <= 0.01;
    checks.adsTightensAtLeastTwofold = hipReticle.gapPx >= adsReticle.gapPx * 2;
    checks.reproducedOldGroundCutoff = !ballistic.error
      && ballistic.legacyParallelClearM + 0.5 < ballistic.cameraHitM;
    checks.reticleRaySelectedEnemy = ballistic.solution?.aimKind === "enemy"
      && ballistic.solution?.aimEnemy === ballistic.enemy;
    checks.convergedShotHitSelectedEnemy = ballistic.solution?.resolvedEnemy === ballistic.enemy
      && ballistic.after?.hits === ballistic.before?.hits + 1
      && ballistic.afterHealth < ballistic.beforeHealth;
    checks.shotActuallyConverged = ballistic.solution?.convergenceDeg > 0.1;
    checks.noBrowserErrors = errors.length === 0;

    const report = { hipReticle, adsReticle, ballistic, checks, errors };
    await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

    console.log("SAINTFALL reticle + ballistics");
    console.log(`hip gap ${hipReticle.gapPx.toFixed(2)}px at ${(hipReticle.coneRad * 180 / Math.PI).toFixed(2)}deg`);
    console.log(`ADS gap ${adsReticle.gapPx.toFixed(2)}px at ${(adsReticle.coneRad * 180 / Math.PI).toFixed(2)}deg`);
    if (ballistic.error) console.log(ballistic.error);
    else {
      console.log(`legacy parallel ray stopped at ${ballistic.legacyParallelClearM.toFixed(2)}m; camera target ${ballistic.cameraHitM.toFixed(2)}m`);
      console.log(`converged ${ballistic.solution.convergenceDeg.toFixed(2)}deg -> ${ballistic.solution.resolvedEnemy || "miss"}`);
    }
    for (const [name, passed] of Object.entries(checks)) {
      console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
    }
    console.log(path.relative(root, path.join(out, "report.json")));
    if (Object.values(checks).some((passed) => !passed)) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
