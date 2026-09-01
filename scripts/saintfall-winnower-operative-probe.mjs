#!/usr/bin/env node
/* Winnower contract for Saint Veyra and Saint Torren.

   The district fight was originally proved only through the campaign
   lance and direct combat helpers.  These checks drive the two newer
   kits themselves: Veyra's real crescent projectile must spend the
   heat-sac lift pool, and Torren's real Hammer Cast must enter the
   shared anti-air path.  The same page also measures the live shell's
   signed volume so an inward-wound boss cannot pass as a valid mesh. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 52600 + (process.pid % 900);
const base = `http://127.0.0.1:${port}`;
const outDir = path.join(root, "output", "saintfall", "winnower-operative-audit");
const server = spawn("python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: "ignore" });

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: !!pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
}

async function waitServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

async function boot(page, character) {
  await page.goto(
    `${base}/games/saintfall.html?qa=1&intro=0&quality=high&character=${character}`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.()
    && window.__SF?.kenosis?.status?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize?.();
    T.invulnerable(true);
    T.teleportToWinnower(24);
    T.forceWinnowerPhase("soar", 60);
    T.releaseCamera();
  });
}

let browser;
try {
  await waitServer();
  await mkdir(outDir, { recursive: true });
  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await boot(page, "white-vigil");
  /* Photograph the corrected shell before combat effects cover it.
     Select a clear free-camera ray around the refinery rather than a
     fixed angle that may put one of the stacks across a wing. */
  await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.key === "winnower");
    const target = [inst.x, inst.y - 0.5, inst.z - 1.5];
    let camera = null;
    for (let i = 0; i < 48; i += 1) {
      const angle = i * Math.PI * 2 / 48;
      const candidate = [
        target[0] + Math.cos(angle) * 28,
        target[1] + 7,
        target[2] + Math.sin(angle) * 28,
      ];
      const dx = target[0] - candidate[0];
      const dy = target[1] - candidate[1];
      const dz = target[2] - candidate[2];
      const distance = Math.hypot(dx, dy, dz);
      const wall = T.collide.rayBlock(candidate[0], candidate[1], candidate[2],
        dx / distance, dy / distance, dz / distance, distance);
      if (!Number.isFinite(wall) || wall >= distance - 0.5) {
        camera = candidate;
        break;
      }
    }
    T.lookAt(camera || [inst.x - 20, inst.y + 7, inst.z + 22], target, 46);
    T.renderOnce(1 / 60);
  });
  await page.screenshot({ path: path.join(outDir, "winnower-shell.png") });
  await page.evaluate(() => window.__SF.releaseCamera());

  const veyra = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.key === "winnower");
    const THREE = T.THREE;
    const signedVolume = (geometry) => {
      const pos = geometry.attributes.position;
      const idx = geometry.index;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const cross = new THREE.Vector3();
      const count = idx ? idx.count : pos.count;
      let volume = 0;
      for (let i = 0; i < count; i += 3) {
        a.fromBufferAttribute(pos, idx ? idx.getX(i) : i);
        b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1);
        c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2);
        volume += a.dot(cross.crossVectors(b, c)) / 6;
      }
      return Number(volume.toFixed(2));
    };

    const volume = signedVolume(inst.skin.geometry);
    const startingLift = inst.lift;
    const hitLog = [];
    const aim = new THREE.Vector3();
    const originalAimPoint = T.loadout.aimPoint;
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      for (const boneName of ["sac_L", "sac_L", "sac_R", "sac_R"]) {
        const bone = inst.bones.get(boneName);
        bone.updateWorldMatrix(true, false);
        bone.getWorldPosition(aim);
        /* Attack the visible side of each sac.  From one fixed side of
           the animal the opposite root is correctly occluded by the
           thorax/wing; walking around it is part of the real fight. */
        let sideX = aim.x - inst.x;
        let sideZ = aim.z - inst.z;
        const sideLen = Math.hypot(sideX, sideZ) || 1;
        sideX /= sideLen;
        sideZ /= sideLen;
        T.teleport(inst.x + sideX * 11, inst.z + sideZ * 11,
          Math.atan2(-sideX, -sideZ));
        T.forceWinnowerPhase("soar", 60);
        bone.updateWorldMatrix(true, false);
        bone.getWorldPosition(aim);
        T.loadout.aimPoint = (out) => out.copy(aim);
        const beforeHits = T.discharge.status().hits;
        const beforeLift = inst.lift;
        const fired = T.discharge.fireOnce();
        T.discharge.update(1.0);
        hitLog.push({
          boneName,
          fired,
          hit: T.discharge.status().hits > beforeHits,
          liftBefore: beforeLift,
          liftAfter: inst.lift,
          phase: T.winnowerState().phase,
        });
      }
    } finally {
      Math.random = originalRandom;
      T.loadout.aimPoint = originalAimPoint;
    }
    T.advanceTime(0.2, 1 / 60);
    return {
      volume,
      startingLift,
      endingLift: inst.lift,
      sacBurst: [...inst.sacBurst],
      phase: T.winnowerState().phase,
      grounded: inst.grounded,
      hitLog,
    };
  });

  check("the live Winnower shell is outward-wound", veyra.volume > 0,
    { signedVolume: veyra.volume });
  check("Veyra's real crescents register on all four heat-sac shots",
    veyra.hitLog.every((shot) => shot.fired && shot.hit), veyra.hitLog);
  check("Veyra's heat-sac attacks empty lift and start the downing",
    veyra.startingLift > 0 && veyra.endingLift === 0
      && veyra.sacBurst.every(Boolean)
      && (veyra.phase === "land" || veyra.phase === "stoke"), veyra);

  await boot(page, "bastion-penitent");
  const torren = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.key === "winnower");
    /* Pick a close, open firing lane.  The works has tall stacks by
       design; testing a hammer thrown into one only proves masonry. */
    let firingPoint = null;
    for (let i = 0; i < 24; i += 1) {
      const angle = i * Math.PI * 2 / 24;
      const x = inst.x + Math.cos(angle) * 12;
      const z = inst.z + Math.sin(angle) * 12;
      const y = T.collide.groundHeight(x, z) + 1.2;
      const tx = inst.x - x;
      const ty = inst.y - 0.5 - y;
      const tz = inst.z - z;
      const distance = Math.hypot(tx, ty, tz);
      const wall = T.collide.rayBlock(x, y, z,
        tx / distance, ty / distance, tz / distance, distance);
      if (!Number.isFinite(wall) || wall >= distance - 0.5) {
        firingPoint = { x, z, yaw: Math.atan2(tx, tz) };
        break;
      }
    }
    if (firingPoint) T.teleport(firingPoint.x, firingPoint.z, firingPoint.yaw);
    T.forceWinnowerPhase("soar", 60);
    const aim = new T.THREE.Vector3(inst.x, inst.y - 0.5, inst.z);
    const originalAimPoint = T.loadout.aimPoint;
    T.loadout.aimPoint = (out) => out.copy(aim);
    const before = {
      lift: inst.lift,
      hits: T.kenosis.status().hammer.hits,
      phase: T.winnowerState().phase,
    };
    const cast = T.kenosis.tryThrowHammer();
    let closest = Infinity;
    let closestFrame = null;
    for (let frame = 0; frame < 150; frame += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      const hammer = T.kenosis.status().hammer;
      if (!hammer.position) continue;
      const distance = Math.hypot(
        hammer.position[0] - inst.x,
        hammer.position[1] - inst.y,
        hammer.position[2] - inst.z,
      );
      if (distance < closest) {
        closest = distance;
        closestFrame = {
          frame,
          distance: Number(distance.toFixed(2)),
          hammer: [...hammer.position],
          boss: [inst.x, inst.y, inst.z].map((value) => Number(value.toFixed(2))),
          assisted: hammer.assisted,
        };
      }
    }
    T.loadout.aimPoint = originalAimPoint;
    const after = {
      lift: inst.lift,
      hits: T.kenosis.status().hammer.hits,
      groundedEvents: T.kenosis.status().hammer.grounded,
      phase: T.winnowerState().phase,
      hammerPhase: T.kenosis.status().hammer.phase,
    };
    return { cast, before, after, closestFrame, firingPoint };
  });
  check("Torren's real Hammer Cast hits the Winnower and drains boss lift",
    torren.cast && torren.after.hits > torren.before.hits
      && torren.after.groundedEvents > 0
      && torren.after.lift < torren.before.lift, torren);
  check("Torren's first cast does not skip the earned multi-hit downing",
    torren.after.lift > 0 && torren.after.phase !== "stoke", torren);
  check("the operative audit is console-clean", errors.length === 0, errors.slice(0, 3));
} finally {
  await browser?.close();
  server.kill();
}

const failed = checks.filter((entry) => !entry.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
