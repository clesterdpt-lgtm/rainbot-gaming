#!/usr/bin/env node
/* Saint Veyra / Saint Torren versus the Distaff's real leg economy.

   Each path uses the authored kit projectile, the shared analytic enemy
   raycast, and the Distaff's production footing controller.  No direct
   footing writes or QA leg-break helpers are used. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 53200 + (process.pid % 600);
const base = `http://127.0.0.1:${port}`;
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
    && window.__SF?.distaffState?.()
    && window.__SF?.kenosis?.status?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    T.invulnerable(true);
    T.distaff.resetToLair();
    T.teleportToDistaff(30);
    T.advanceToDistaffPhase("standing", 10);
    T.forceDistaffPhase("standing", 60);
    for (let i = 0; i < 4; i += 1) T.renderOnce(1 / 60);
  });
}

/* Find a real, unobstructed ray from player height to one authored leg joint.
   The same lane serves the weapon after teleport; it is selected through the
   production world blocker and enemy raycast rather than assumed clear. */
function selectLegLaneInPage() {
  const T = window.__SF;
  const inst = T.enemies.live.find((enemy) => enemy.key === "distaff");
  const THREE = T.THREE;
  const pointA = new THREE.Vector3();
  const pointB = new THREE.Vector3();
  const target = new THREE.Vector3();
  for (let legIndex = 0; legIndex < inst.legs.length; legIndex += 1) {
    const leg = inst.legs[legIndex];
    const spans = [[leg.femur, leg.tibia], [leg.tibia, leg.toe]];
    for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
      const [fromBone, toBone] = spans[spanIndex];
      fromBone.updateWorldMatrix(true, false);
      toBone.updateWorldMatrix(true, false);
      fromBone.getWorldPosition(pointA);
      toBone.getWorldPosition(pointB);
      for (const fraction of [0.25, 0.5, 0.75]) {
        target.copy(pointA).lerp(pointB, fraction);
        for (const radius of [3, 5, 8, 11]) {
          for (let i = 0; i < 32; i += 1) {
            const angle = i * Math.PI * 2 / 32;
            const x = target.x + Math.cos(angle) * radius;
            const z = target.z + Math.sin(angle) * radius;
            for (const height of [1.3, 1.9, 2.5, 3.1]) {
              const y = T.collide.groundHeight(x, z) + height;
              const dx = target.x - x;
              const dy = target.y - y;
              const dz = target.z - z;
              const distance = Math.hypot(dx, dy, dz);
              const ux = dx / distance;
              const uy = dy / distance;
              const uz = dz / distance;
              const wall = T.collide.rayBlock(x, y, z, ux, uy, uz, distance);
              const hit = T.combat.raycastEnemies(x, y, z,
                ux, uy, uz, distance + 0.5);
              if ((!Number.isFinite(wall) || wall >= distance - 0.35)
                && hit?.inst === inst && hit.legIndex >= 0) {
                return {
                  legIndex: hit.legIndex,
                  joint: !!hit.joint,
                  spanIndex,
                  fraction,
                  x,
                  z,
                  yaw: Math.atan2(dx, dz),
                  target: target.toArray(),
                };
              }
            }
          }
        }
      }
    }
  }
  return null;
}

let browser;
try {
  await waitServer();
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
  const veyra = await page.evaluate((selectLaneSource) => {
    const selectLane = Function(`return (${selectLaneSource})`)();
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.key === "distaff");
    const lane = selectLane();
    if (!lane) return { setupError: "no clear Distaff leg lane" };
    T.teleport(lane.x, lane.z, lane.yaw);
    T.forceDistaffPhase("standing", 60);
    T.renderOnce(1 / 60);
    const aimA = new T.THREE.Vector3();
    const aimB = new T.THREE.Vector3();
    const aimLeg = (out) => {
      const leg = inst.legs[lane.legIndex];
      const spans = [[leg.femur, leg.tibia], [leg.tibia, leg.toe]];
      const [fromBone, toBone] = spans[lane.spanIndex];
      fromBone.updateWorldMatrix(true, false);
      toBone.updateWorldMatrix(true, false);
      fromBone.getWorldPosition(aimA);
      toBone.getWorldPosition(aimB);
      return out.copy(aimA).lerp(aimB, lane.fraction);
    };
    const originalAimPoint = T.loadout.aimPoint;
    const originalRandom = Math.random;
    const events = [];
    const off = T.combat.bus.on("legHit", (event) => {
      if (event.enemyKey === "distaff") events.push({
        source: event.source,
        legIndex: event.legIndex,
        joint: event.joint,
        damage: event.damage,
        bodyDamage: event.bodyDamage,
      });
    });
    Math.random = () => 0;
    T.loadout.aimPoint = aimLeg;
    const start = T.distaffState();
    let fired = 0;
    let lowestFooting = start.footingHp;
    try {
      while (T.distaffState().phase === "standing" && fired < 80) {
        if (!T.discharge.fireOnce()) break;
        fired += 1;
        T.discharge.update(0.30);
        lowestFooting = Math.min(lowestFooting, T.distaffState().footingHp);
      }
    } finally {
      off();
      Math.random = originalRandom;
      T.loadout.aimPoint = originalAimPoint;
    }
    return {
      lane,
      fired,
      startFooting: start.footingHp,
      lowestFooting,
      phase: T.distaffState().phase,
      legsBroken: T.distaffState().legsBroken,
      projectileHits: T.discharge.status().hits,
      events,
    };
  }, selectLegLaneInPage.toString());
  check("Veyra's real crescents hit Distaff legs through the shared leg path",
    !veyra.setupError && veyra.events.length > 0
      && veyra.events.every((event) => event.source === "crescent"), veyra);
  check("Veyra can empty Distaff footing and trigger its collapse",
    veyra.phase === "collapsed" && veyra.legsBroken > 0
      && veyra.lowestFooting < veyra.startFooting, veyra);

  await boot(page, "bastion-penitent");
  const torren = await page.evaluate((selectLaneSource) => {
    const selectLane = Function(`return (${selectLaneSource})`)();
    const T = window.__SF;
    const inst = T.enemies.live.find((enemy) => enemy.key === "distaff");
    const lane = selectLane();
    if (!lane) return { setupError: "no clear Distaff leg lane" };
    T.teleport(lane.x, lane.z, lane.yaw);
    T.forceDistaffPhase("standing", 60);
    T.renderOnce(1 / 60);
    const aimA = new T.THREE.Vector3();
    const aimB = new T.THREE.Vector3();
    const aimLeg = (out) => {
      const leg = inst.legs[lane.legIndex];
      const spans = [[leg.femur, leg.tibia], [leg.tibia, leg.toe]];
      const [fromBone, toBone] = spans[lane.spanIndex];
      fromBone.updateWorldMatrix(true, false);
      toBone.updateWorldMatrix(true, false);
      fromBone.getWorldPosition(aimA);
      toBone.getWorldPosition(aimB);
      return out.copy(aimA).lerp(aimB, lane.fraction);
    };
    const originalAimPoint = T.loadout.aimPoint;
    const events = [];
    const off = T.combat.bus.on("legHit", (event) => {
      if (event.enemyKey === "distaff") events.push({
        source: event.source,
        legIndex: event.legIndex,
        joint: event.joint,
        damage: event.damage,
        bodyDamage: event.bodyDamage,
      });
    });
    T.loadout.aimPoint = aimLeg;
    const start = T.distaffState();
    let casts = 0;
    let lowestFooting = start.footingHp;
    try {
      while (T.distaffState().phase === "standing" && casts < 10) {
        if (!T.kenosis.tryThrowHammer()) break;
        casts += 1;
        for (let frame = 0; frame < 720; frame += 1) {
          /* The throw releases from the real player action timeline,
             so step the production frame rather than advancing only
             the kit's projectile controller. */
          T.renderOnce(1 / 60);
          lowestFooting = Math.min(lowestFooting, T.distaffState().footingHp);
          const status = T.kenosis.status().hammer;
          if (status.phase === "held" && status.cooldown <= 0) break;
          if (T.distaffState().phase !== "standing") break;
        }
        T.renderOnce(1 / 60);
      }
    } finally {
      off();
      T.loadout.aimPoint = originalAimPoint;
    }
    return {
      lane,
      casts,
      startFooting: start.footingHp,
      lowestFooting,
      phase: T.distaffState().phase,
      legsBroken: T.distaffState().legsBroken,
      hammer: T.kenosis.status().hammer,
      events,
    };
  }, selectLegLaneInPage.toString());
  check("Torren's real Hammer Cast hits Distaff legs through the shared leg path",
    !torren.setupError && torren.events.length > 0
      && torren.events.every((event) => event.source === "hammer-cast"), torren);
  check("Torren can empty Distaff footing and trigger its collapse",
    torren.phase === "collapsed" && torren.legsBroken > 0
      && torren.lowestFooting < torren.startFooting, torren);
  check("the Distaff operative audit is console-clean", errors.length === 0,
    errors.slice(0, 3));
} finally {
  await browser?.close();
  server.kill();
}

const failed = checks.filter((entry) => !entry.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
