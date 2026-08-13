#!/usr/bin/env node
/* ============================================================
   SAINTFALL - enemy collision, cover, and navigation audit

   Reproduces the shipped large-capsule overlap, transformed-pod,
   ranged-cover, trapped-garrison, and Cathedral detour failures at
   the browser seam that owns them.

   Usage:
     node scripts/saintfall-enemy-navigation-probe.mjs
     node scripts/saintfall-enemy-navigation-probe.mjs --out output/saintfall/enemy-navigation-final
   ============================================================ */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((s) => s.trim().split(/\s+/)).map(([key, value]) => [key, value ?? true])
);
const OUT = path.resolve(root, args.out || "output/saintfall/enemy-navigation-audit");
const PORT = 48600 + (process.pid % 10000);
const BASE = `http://127.0.0.1:${PORT}`;
const sourceFiles = [
  "assets/js/saintfall/collide.js",
  "assets/js/saintfall/combat.js",
  "assets/js/saintfall/enemies.js",
  "assets/js/saintfall/pod.js",
  "assets/js/saintfall/qa.js",
  "assets/js/saintfall/main.js",
  "games/saintfall.html",
];

async function hashes() {
  const out = {};
  for (const rel of sourceFiles) {
    out[rel] = createHash("sha256")
      .update(await readFile(path.join(root, rel))).digest("hex");
  }
  return out;
}

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass: Boolean(pass), detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

async function saveCanvas(page, filename) {
  const dataUrl = await page.evaluate(() => window.__SF.captureDataURL());
  await writeFile(path.join(OUT, filename),
    Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

let browser;
try {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const sourceStart = await hashes();
  for (let i = 0; i < 240; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=low&collision-audit=1`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady(), null, { timeout: 300000 });
  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    T.hideHud(true);
    T.hideVfx(true);
    const boot = document.getElementById("sf-boot");
    if (boot?.parentNode) boot.parentNode.removeChild(boot);
  });

  const geometry = await page.evaluate(() => {
    const T = window.__SF;
    const C = T.collide;
    const THREE = T.THREE;

    /* The full shipped garrison, using each species' authored radius. */
    const garrison = T.ctx.enemies.live.map((enemy) => {
      const radius = enemy.spec?.collisionRadius || 0.62;
      let exitBearings = 0;
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * Math.PI * 2;
        if (C.walkClear(enemy.x, enemy.z,
          enemy.x + Math.cos(a) * 4, enemy.z + Math.sin(a) * 4, radius)) {
          exitBearings += 1;
        }
      }
      return {
        key: enemy.key,
        x: Number(enemy.x.toFixed(3)),
        z: Number(enemy.z.toFixed(3)),
        radius,
        blocked: C.blocked(enemy.x, enemy.z, C.groundHeight(enemy.x, enemy.z), radius),
        exitBearings,
      };
    });

    /* Exact coordinate that exposed non-monotonic large-body overlap. */
    const capsulePoint = { x: -859.9729741105272, z: -29.307512657638554 };
    const capsuleGround = C.groundHeight(capsulePoint.x, capsulePoint.z);
    const radii = [0, 0.2, 0.42, 0.62, 0.8, 0.96, 1.05, 1.2, 1.5, 2];
    const radiusSweep = radii.map((radius) => ({
      radius,
      blocked: C.blocked(capsulePoint.x, capsulePoint.z, capsuleGround, radius),
    }));
    let seenBlocked = false;
    let monotonic = true;
    for (const row of radiusSweep) {
      if (row.blocked) seenBlocked = true;
      else if (seenBlocked) monotonic = false;
    }

    /* Compare the transformed structural pod triangles against the
       collision ray used by enemy fire. Decorative seams are explicitly
       excluded because they are intentionally brush-through. */
    const pod = T.ctx.pod.root;
    pod.updateWorldMatrix(true, true);
    const center = new THREE.Vector3();
    pod.getWorldPosition(center);
    const structural = [];
    pod.traverse((object) => {
      if (object.isMesh && object.userData.collisionSolid === true) structural.push(object);
    });
    const ray = new THREE.Raycaster();
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const mismatchRows = [];
    let visualHits = 0;
    for (const radius of [6, 8, 10, 12, 15]) {
      for (let i = 0; i < 72; i += 1) {
        const a = (i / 72) * Math.PI * 2;
        const x = center.x + Math.cos(a) * radius;
        const z = center.z + Math.sin(a) * radius;
        const y = C.groundHeight(x, z) + 1.3;
        origin.set(x, y, z);
        direction.set(center.x - x,
          C.groundHeight(center.x, center.z) + 1.3 - y,
          center.z - z);
        const distance = direction.length();
        direction.multiplyScalar(1 / Math.max(distance, 1e-6));
        ray.set(origin, direction);
        ray.far = distance;
        const hit = ray.intersectObjects(structural, false)[0];
        if (!hit) continue;
        visualHits += 1;
        const block = C.rayBlock(x, y, z,
          direction.x, direction.y, direction.z, distance);
        if (!Number.isFinite(block) || block > hit.distance + 0.7) {
          mismatchRows.push({
            radius, bearing: i, mesh: hit.object.name,
            visualM: Number(hit.distance.toFixed(3)),
            collisionM: Number.isFinite(block) ? Number(block.toFixed(3)) : null,
          });
        }
      }
    }
    const stats = C.stats();
    const podStats = stats.perMesh.filter((row) => row.name.startsWith("pod-"));
    return {
      garrison,
      radiusSweep,
      radiusMonotonic: monotonic,
      pod: {
        center: center.toArray(),
        structuralMeshes: structural.map((mesh) => mesh.name),
        visualHits,
        mismatches: mismatchRows,
        stats: podStats,
      },
      collisionStats: stats,
    };
  });

  console.log("\n=== STRUCTURE COLLISION ===");
  const inside = geometry.garrison.filter((row) => row.blocked);
  const pocketed = geometry.garrison.filter((row) => row.exitBearings === 0);
  const podIntervals = geometry.pod.stats.reduce((sum, row) => sum + row.flightIntervals, 0);
  check("all shipped enemies spawn outside masonry", inside.length === 0,
    `${geometry.garrison.length} enemies, ${inside.length} overlaps`);
  check("all shipped enemies have a four-metre exit lane", pocketed.length === 0,
    `${geometry.garrison.length} enemies, ${pocketed.length} pockets`);
  check("larger enemy capsules cannot skip interior collision cells",
    geometry.radiusMonotonic,
    geometry.radiusSweep.map((row) => `${row.radius}:${row.blocked ? 1 : 0}`).join(" "));
  check("transformed pod hull contributes collision intervals",
    geometry.pod.structuralMeshes.length === 7 && podIntervals > 80,
    `${geometry.pod.structuralMeshes.length} meshes, ${podIntervals} intervals`);
  check("pod visual hull and projectile collision agree",
    geometry.pod.visualHits > 250 && geometry.pod.mismatches.length === 0,
    `${geometry.pod.visualHits} structural hits, ${geometry.pod.mismatches.length} mismatches`);

  const route = await page.evaluate(() => {
    const T = window.__SF;
    const C = T.collide;
    T.clearEnemies();
    T._teleportRaw(-90, -725, 0);
    T.ctx.combat.player.maxHp = 1e6;
    T.ctx.combat.player.hp = 1e6;

    const beforeProbe = C.stats().navigation;
    const planStarted = performance.now();
    const planned = C.findPath(-68, -725, -90, -725, 0.64);
    const planMs = performance.now() - planStarted;
    const afterProbe = C.stats().navigation;

    T.spawnEnemy("thresher", -68, -725, { yaw: -Math.PI / 2 });
    const enemy = T.ctx.enemies.live[0];
    const startDistance = Math.hypot(enemy.x + 90, enemy.z + 725);
    const directClear = C.walkClear(enemy.x, enemy.z, -90, -725, 0.64);
    let everHadRoute = false;
    let enteredSolid = false;
    let maximumDistance = startDistance;
    let minimumDistance = startDistance;
    const trace = [];
    for (let frame = 0; frame < 40 * 60; frame += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      const distance = Math.hypot(enemy.x + 90, enemy.z + 725);
      maximumDistance = Math.max(maximumDistance, distance);
      minimumDistance = Math.min(minimumDistance, distance);
      everHadRoute ||= Boolean(enemy.navigation?.path?.length);
      enteredSolid ||= C.blocked(enemy.x, enemy.z,
        C.groundHeight(enemy.x, enemy.z), 0.64);
      if (frame % 240 === 0) {
        trace.push({
          second: frame / 60,
          x: Number(enemy.x.toFixed(2)), z: Number(enemy.z.toFixed(2)),
          distance: Number(distance.toFixed(2)), state: enemy.state,
          waypoints: enemy.navigation?.path?.length || 0,
          waypoint: enemy.navigation?.at || 0,
        });
      }
    }
    return {
      directClear,
      planned,
      planMs,
      probeExpanded: afterProbe.expanded - beforeProbe.expanded,
      startDistance,
      maximumDistance,
      minimumDistance,
      finalDistance: Math.hypot(enemy.x + 90, enemy.z + 725),
      everHadRoute,
      enteredSolid,
      state: enemy.state,
      trace,
      navigation: C.stats().navigation,
    };
  });

  const pack = await page.evaluate(() => {
    const T = window.__SF;
    const C = T.collide;
    T.clearEnemies();
    T._teleportRaw(-90, -725, 0);
    for (let i = 0; i < 8; i += 1) {
      T.spawnEnemy("thresher", -68, -725, { yaw: -Math.PI / 2 });
    }
    let previous = C.stats().navigation.queries;
    let maxQueriesInTick = 0;
    let totalQueries = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      const now = C.stats().navigation.queries;
      const delta = now - previous;
      maxQueriesInTick = Math.max(maxQueriesInTick, delta);
      totalQueries += delta;
      previous = now;
    }
    return { maxQueriesInTick, totalQueries };
  });

  const retarget = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T._teleportRaw(-90, -725, 0);
    T.spawnEnemy("thresher", -68, -725, { yaw: -Math.PI / 2 });
    const enemy = T.ctx.enemies.live[0];
    T.advanceTime(1.2, 1 / 60);
    const first = {
      path: enemy.navigation?.path?.length || 0,
      goalX: enemy.navigation?.pathGoalX,
      goalZ: enemy.navigation?.pathGoalZ,
    };
    T._teleportRaw(-110, -725, 0);
    T.advanceTime(1.4, 1 / 60);
    const second = {
      path: enemy.navigation?.path?.length || 0,
      goalX: enemy.navigation?.pathGoalX,
      goalZ: enemy.navigation?.pathGoalZ,
    };
    return { first, second };
  });

  console.log("\n=== PATHING ===");
  check("Cathedral wall blocks direct pursuit", route.directClear === false);
  check("bounded planner finds the Cathedral detour",
    route.planned?.length > 2 && route.probeExpanded < 7000,
    `${route.planned?.length || 0} waypoints, ${route.probeExpanded} nodes, ${route.planMs.toFixed(1)}ms`);
  check("enemy follows the detour and reaches melee range",
    route.everHadRoute && route.maximumDistance > 65 && route.finalDistance <= 2.75,
    `${route.startDistance.toFixed(1)}m start, ${route.maximumDistance.toFixed(1)}m detour, `
      + `${route.finalDistance.toFixed(1)}m final`);
  check("detouring enemy never enters a structure", route.enteredSolid === false);
  check("pack route planning is amortised to one query per tick",
    pack.totalQueries >= 8 && pack.maxQueriesInTick <= 1,
    `${pack.totalQueries} queries, max ${pack.maxQueriesInTick}/tick`);
  check("a moving player invalidates and rebuilds the retained route",
    retarget.first.path > 0 && Math.abs(retarget.first.goalX + 90) < 0.1
      && retarget.second.path > 0 && Math.abs(retarget.second.goalX + 110) < 0.1,
    `goal ${retarget.first.goalX} -> ${retarget.second.goalX}`);

  const fire = await page.evaluate(() => {
    const T = window.__SF;
    const C = T.collide;
    const P = T.ctx.combat.player;
    const ps = T.ctx.player.state;
    const coverCase = (playerX, playerZ, enemyX, enemyZ, seconds) => {
      T.clearEnemies();
      T._teleportRaw(playerX, playerZ, 0);
      P.maxHp = 10000;
      P.hp = 10000;
      T.spawnEnemy("gleaner", enemyX, enemyZ, { yaw: Math.atan2(playerX - enemyX, playerZ - enemyZ) });
      const enemy = T.ctx.enemies.live[0];
      const oldWalk = enemy.spec.speed.walk;
      enemy.spec.speed.walk = 0;
      const origin = {
        x: enemy.x + Math.sin(enemy.yaw) * 0.92,
        y: C.groundHeight(enemy.x, enemy.z) + 3.10,
        z: enemy.z + Math.cos(enemy.yaw) * 0.92,
      };
      const dx = ps.x - origin.x;
      const dy = ps.y + 1.62 - origin.y;
      const dz = ps.z - origin.z;
      const distance = Math.hypot(dx, dy, dz);
      const block = C.rayBlock(origin.x, origin.y, origin.z,
        dx / distance, dy / distance, dz / distance, distance);
      const start = [enemy.x, enemy.z];
      T.advanceTime(seconds, 1 / 60);
      enemy.spec.speed.walk = oldWalk;
      return {
        distance,
        block: Number.isFinite(block) ? block : null,
        covered: block < distance - 0.12,
        damage: 10000 - P.hp,
        moved: Math.hypot(enemy.x - start[0], enemy.z - start[1]),
        state: enemy.state,
      };
    };

    const threshold = coverCase(8.89, 888.69, -10.59, 863.31, 8);
    const cathedral = coverCase(-90, -725, -68, -725, 8);

    T.clearEnemies();
    T._teleportRaw(320, -300, 0);
    P.maxHp = 10000;
    P.hp = 10000;
    T.spawnEnemy("gleaner", 300, -300, { yaw: Math.PI / 2 });
    const originalRandom = Math.random;
    Math.random = () => 0;
    T.advanceTime(4, 1 / 60);
    Math.random = originalRandom;
    const openDamage = 10000 - P.hp;
    return { threshold, cathedral, openDamage };
  });

  console.log("\n=== RANGED COVER ===");
  check("reproduced Threshold cover blocks the Gleaner muzzle",
    fire.threshold.covered && fire.threshold.block !== null,
    `${fire.threshold.block?.toFixed(1)}m block / ${fire.threshold.distance.toFixed(1)}m target`);
  check("covered Gleaner cannot damage through Threshold terrain",
    fire.threshold.damage === 0 && fire.threshold.moved < 0.01,
    `${fire.threshold.damage.toFixed(1)} damage in 8s`);
  check("covered Gleaner cannot damage through Cathedral masonry",
    fire.cathedral.covered && fire.cathedral.damage === 0 && fire.cathedral.moved < 0.01,
    `${fire.cathedral.block?.toFixed(1)}m block / ${fire.cathedral.distance.toFixed(1)}m target`);
  check("unobstructed Gleaner fire still damages the player", fire.openDamage > 0,
    `${fire.openDamage.toFixed(1)} damage in 4s`);

  /* Visual evidence: authoritative grid around the repaired live pod. */
  await page.evaluate(() => {
    const T = window.__SF;
    const C = T.collide;
    T.clearEnemies();
    const center = new T.THREE.Vector3();
    T.ctx.pod.root.getWorldPosition(center);
    const y = C.groundHeight(center.x, center.z);
    C.setDebugView(T.THREE, T.render.scene, true, center.x, center.z, 17);
    T.lookAt([center.x + 18, y + 11, center.z + 19], [center.x, y + 2.4, center.z], 52);
    for (let i = 0; i < 4; i += 1) T.renderStill();
  });
  await saveCanvas(page, "pod-structural-collision.png");

  /* Mid-route proof: the enemy is at the north Cathedral exit while
     the player remains behind the south wall it could not cross. */
  await page.evaluate(() => {
    const T = window.__SF;
    T.collide.setDebugView(T.THREE, T.render.scene, false, 0, 0);
    T.clearEnemies();
    T._teleportRaw(-90, -725, 0);
    T.hidePlayer(false);
    T.spawnEnemy("thresher", -68, -725, { yaw: -Math.PI / 2 });
    T.advanceTime(12, 1 / 60);
    T.lookAt([-29, 111, -614], [-80, 76, -687], 53);
    for (let i = 0; i < 4; i += 1) T.renderStill();
  });
  await saveCanvas(page, "cathedral-detour.png");

  await page.evaluate(() => {
    const T = window.__SF;
    const C = T.collide;
    T.clearEnemies();
    T._teleportRaw(-90, -725, 0);
    T.hidePlayer(false);
    T.spawnEnemy("gleaner", -68, -725, { yaw: -Math.PI / 2 });
    C.setDebugView(T.THREE, T.render.scene, true, -79, -725, 28);
    T.lookAt([-36, 93, -684], [-79, 78, -725], 46);
    for (let i = 0; i < 4; i += 1) T.renderStill();
  });
  await saveCanvas(page, "cathedral-ranged-cover.png");

  const sourceEnd = await hashes();
  const sourceStable = sourceFiles.every((rel) => sourceStart[rel] === sourceEnd[rel]);
  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
  check("collision build remains below load budget", geometry.collisionStats.buildMs < 2500,
    `${geometry.collisionStats.buildMs}ms, ${geometry.collisionStats.cells} cells`);
  check("source revision stayed frozen during capture", sourceStable);

  const report = {
    generatedAt: new Date().toISOString(),
    sourceStart,
    sourceEnd,
    sourceStable,
    checks,
    geometry,
    route,
    pack,
    retarget,
    fire,
    pageErrors,
    consoleErrors,
  };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(OUT, "summary.txt"), [
    `Saintfall enemy navigation audit`,
    `${checks.filter((row) => row.pass).length}/${checks.length} checks passed`,
    `garrison: ${geometry.garrison.length - inside.length}/${geometry.garrison.length} outside masonry`,
    `garrison egress: ${geometry.garrison.length - pocketed.length}/${geometry.garrison.length}`,
    `pod rays: ${geometry.pod.visualHits} visual hits, ${geometry.pod.mismatches.length} mismatches`,
    `Cathedral route: ${route.startDistance.toFixed(1)}m start, ${route.maximumDistance.toFixed(1)}m detour, ${route.finalDistance.toFixed(1)}m final`,
    `covered damage: Threshold ${fire.threshold.damage.toFixed(1)}, Cathedral ${fire.cathedral.damage.toFixed(1)}`,
  ].join("\n") + "\n");

  console.log(`\n${checks.filter((row) => row.pass).length}/${checks.length} checks passed`);
  console.log(`Report: ${path.relative(root, path.join(OUT, "report.json"))}`);
  if (checks.some((row) => !row.pass)) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
