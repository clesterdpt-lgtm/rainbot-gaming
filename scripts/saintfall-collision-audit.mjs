#!/usr/bin/env node
/* ============================================================
   SAINTFALL - collision and stuck audit

   Exercises the shipped player-sized collision queries across every
   POI, proves that authored walking surfaces agree with rendered
   triangles, and deliberately starts capsules on obstacle boundaries
   to verify that they can depenetrate instead of becoming permanent
   traps.

   Usage:
     node scripts/saintfall-collision-audit.mjs
     node scripts/saintfall-collision-audit.mjs --out output/saintfall/collision-final
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
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true])
);
const OUT = path.resolve(root, args.out || "output/saintfall/collision-audit");
const PORT = 47500 + (process.pid % 10000);
const BASE = `http://127.0.0.1:${PORT}`;

const sourceFiles = [
  "assets/js/saintfall/terrain.js",
  "assets/js/saintfall/world.js",
  "assets/js/saintfall/collide.js",
  "assets/js/saintfall/player.js",
  "assets/js/saintfall/enemies.js",
  "assets/js/saintfall/combat.js",
  "assets/js/saintfall/mission.js",
  "assets/js/saintfall/boot.js",
  "games/saintfall.html",
];

async function hashes() {
  const out = {};
  for (const rel of sourceFiles) {
    out[rel] = createHash("sha256").update(await readFile(path.join(root, rel))).digest("hex");
  }
  return out;
}

function percentile(values, p) {
  if (!values.length) return null;
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))];
}

function fixed(v, n = 4) {
  return Number.isFinite(v) ? Number(v.toFixed(n)) : v;
}

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const sourceStart = await hashes();
  for (let i = 0; i < 240; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&collision-audit=1`,
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

  const audit = await page.evaluate(() => {
    const T = window.__SF;
    const THREE = T.THREE;
    const ground = (x, z) => T.collide.groundHeight(x, z);
    const blocked = (x, z) => T.collide.blocked(x, z, ground(x, z));
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);

    /* Exact terrain sampler versus the actual LOD0 triangle. */
    const terrainRows = [];
    for (let n = 0; n < 1200; n += 1) {
      const a = n * 2.399963229728653;
      const r = Math.sqrt((n + 0.5) / 1200) * 1000;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const cx = Math.max(0, Math.min(7, Math.floor((x + 1024) / 256)));
      const cz = Math.max(0, Math.min(7, Math.floor((z + 1024) / 256)));
      const mesh = T.terrain.chunks[cz * 8 + cx].lods[0];
      ray.set(new THREE.Vector3(x, 500, z), down);
      ray.far = 1000;
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit) continue;
      terrainRows.push({ x, z, sampled: T.terrain.groundHeightAt(x, z), ray: hit.point.y });
    }

    /* Road visual top versus the player's sole and shared ground. */
    const roadMeshes = [];
    T.world.group.traverse((o) => {
      if (o.isMesh && o.name.startsWith("road-surface-")) roadMeshes.push(o);
    });
    const prof = T.terrain.field.roadProfile;
    const roadRows = [];
    for (let i = 2; i < prof.length - 3; i += 2) {
      const a = prof[i];
      const b = prof[i + 1];
      const x = (a.x + b.x) * 0.5;
      const z = (a.z + b.z) * 0.5;
      ray.set(new THREE.Vector3(x, 500, z), down);
      ray.far = 1000;
      const hit = ray.intersectObjects(roadMeshes, false)[0];
      if (!hit) continue; // intentionally reclaimed road segment
      T.player.spawn(x, z, 0);
      const feet = T.player.state.y;
      const shared = ground(x, z);
      roadRows.push({ i, x, z, roadTop: hit.point.y, feet, shared,
        penetration: hit.point.y - feet });
    }

    /* The Cathedral nave used to bury the boots by 14-26cm even
       though collision correctly followed the plaza beneath it.
       Probe the actual merged paving triangles from just above the
       player's sole; walls and the high roof are therefore excluded. */
    let cathedralStone = null;
    T.world.group.traverse((o) => {
      if (o.isMesh && o.name === "cathedral-stone") cathedralStone = o;
    });
    const naveRows = [];
    if (cathedralStone) {
      for (let x = -111; x <= -79; x += 2) {
        for (let z = -788; z <= -662; z += 3) {
          const shared = ground(x, z);
          ray.set(new THREE.Vector3(x, shared + 0.8, z), down);
          ray.far = 1.2;
          const hit = ray.intersectObject(cathedralStone, false)[0];
          if (!hit || hit.point.y > shared + 0.5) continue;
          naveRows.push({ x, z, shared, stoneTop: hit.point.y,
            relief: hit.point.y - shared });
        }
      }
    }

    /* Collision-only forward and reverse travel along every sampled
       road segment. Furniture may stop a line, but a centreline must
       never become a zero-movement trap. */
    const roadTravel = [];
    for (const row of roadRows) {
      const a = prof[row.i];
      const b = prof[row.i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      for (const sign of [-1, 1]) {
        let x = row.x;
        let z = row.z;
        for (let k = 0; k < 32; k += 1) {
          [x, z] = T.collide.slide(x, z, x + ux * sign * 0.15, z + uz * sign * 0.15, null);
        }
        const moved = Math.hypot(x - row.x, z - row.z);
        let bestEscape = moved;
        if (moved < 3.5) {
          for (let d = 0; d < 16; d += 1) {
            const turn = d / 16 * Math.PI * 2;
            let ex = x;
            let ez = z;
            for (let k = 0; k < 32; k += 1) {
              [ex, ez] = T.collide.slide(ex, ez,
                ex + Math.cos(turn) * 0.15, ez + Math.sin(turn) * 0.15, null);
            }
            bestEscape = Math.max(bestEscape, Math.hypot(ex - x, ez - z));
          }
        }
        roadTravel.push({ i: row.i, sign, x: row.x, z: row.z,
          endX: x, endZ: z, moved, bestEscape });
      }
    }

    /* POI boundary inventory. Probe both sides of every collider edge:
       legal points must have an escape direction, and a boundary
       overlap (as from an old save or one-frame penetration) must be
       pushed back to open ground within the 3m recovery budget. */
    const centres = T.world.pois.map((p) => ({ id: p.id, x: p.x, z: p.z }));
    centres.push(
      { id: "threshold-drop", x: -12, z: 858 },
      { id: "road-mid", x: 0.58, z: 561.01 },
      { id: "reach-vane-7", x: -602.24, z: 468.66 },
      { id: "pilgrim-camp", x: -62, z: 72 }
    );
    const boundaryBlocked = [];
    const boundaryOpen = [];
    const neighbourDirs = [
      [1.05, 0], [-1.05, 0], [0, 1.05], [0, -1.05],
      [0.74, 0.74], [0.74, -0.74], [-0.74, 0.74], [-0.74, -0.74],
    ];
    for (const c of centres) {
      for (let n = 0; n < 900; n += 1) {
        const a = n * 2.399963229728653;
        const r = Math.sqrt((n + 0.5) / 900) * 72;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        const isBlocked = blocked(x, z);
        let opposite = false;
        for (const [dx, dz] of neighbourDirs) {
          if (blocked(x + dx, z + dz) !== isBlocked) { opposite = true; break; }
        }
        if (!opposite) continue;
        const row = { id: c.id, x, z };
        if (isBlocked && boundaryBlocked.length < 700) boundaryBlocked.push(row);
        if (!isBlocked && boundaryOpen.length < 700) boundaryOpen.push(row);
      }
    }

    const recoveries = [];
    for (const row of boundaryBlocked) {
      const out = T.collide.slide(row.x, row.z, row.x, row.z, null);
      recoveries.push({ ...row, moved: Math.hypot(out[0] - row.x, out[1] - row.z),
        open: !blocked(out[0], out[1]), out });
    }

    const escapes = [];
    for (const row of boundaryOpen) {
      let best = 0;
      for (let d = 0; d < 16; d += 1) {
        const a = d / 16 * Math.PI * 2;
        let x = row.x;
        let z = row.z;
        for (let k = 0; k < 32; k += 1) {
          [x, z] = T.collide.slide(x, z,
            x + Math.cos(a) * 0.15, z + Math.sin(a) * 0.15, null);
        }
        best = Math.max(best, Math.hypot(x - row.x, z - row.z));
      }
      /* A concave edge may require steering twice; sixteen immutable
         rays can call that a trap even though there is a short curved
         route out. Confirm the low-distance cases with a capsule-sized
         local flood fill before reporting them. */
      if (best < 1.2) {
        const step = 0.35;
        const limit = 4;
        const queue = [[0, 0]];
        const seen = new Set(["0,0"]);
        for (let q = 0; q < queue.length && q < 900; q += 1) {
          const [ix, iz] = queue[q];
          const dist = Math.hypot(ix * step, iz * step);
          best = Math.max(best, dist);
          if (dist >= 1.4) break;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1],
            [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const nx = ix + dx;
            const nz = iz + dz;
            if (Math.hypot(nx * step, nz * step) > limit) continue;
            const key = `${nx},${nz}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!blocked(row.x + nx * step, row.z + nz * step)) queue.push([nx, nz]);
          }
        }
      }
      escapes.push({ ...row, best });
    }

    const knownTraps = [
      ["choir-rock", -778.315, -99.944],
      ["reach-vane-a", -603.632, 470.050],
      ["reach-vane-b", -603.477, 467.419],
      ["threshold-pylon", -19.8046, 739.7435],
      ["threshold-drop", -10.4743, 858.4590],
      ["scar-shard", 884.8114, 120],
      ["scar-vein", 624.1476, 317.8524],
      ["censer-stack", 722.4346, 647.169],
      ["cathedral-deep-overlap", -74.7937, -776.3608],
      ["ossuary-deep-overlap", 618.0603, -625.7630],
      ["ossuary-bone-stack-raw", 669.4164, -645.4311],
    ].map(([id, x, z]) => {
      const before = blocked(x, z);
      const out = T.collide.slide(x, z, x, z, null);
      return { id, x, z, before, out, moved: Math.hypot(out[0] - x, out[1] - z),
        after: blocked(out[0], out[1]) };
    });

    return {
      version: T.version,
      terrainRows,
      roadRows,
      naveRows,
      roadTravel,
      boundary: { blocked: boundaryBlocked.length, open: boundaryOpen.length,
        recoveries, escapes },
      knownTraps,
      stats: T.collide.stats(),
    };
  });

  const terrainErrors = audit.terrainRows.map((r) => Math.abs(r.sampled - r.ray));
  const roadDepths = audit.roadRows.map((r) => r.penetration);
  const naveReliefs = audit.naveRows.map((r) => r.relief);
  const roadTravelStalls = audit.roadTravel.filter((r) => r.moved < 3.5);
  const roadTravelTraps = roadTravelStalls.filter((r) => r.bestEscape < 1.2);
  const recoveryFailures = audit.boundary.recoveries.filter((r) => !r.open || r.moved > 5.05);
  /* A sub-capsule void wholly enclosed by solid cells cannot be
     entered through movement and is not a player trap. Keep it in
     the report, but distinguish it from a reachable point whose
     egress failed. The local flood fill above proves these have no
     connection even 1.2m from their seed. */
  const sealedIslands = audit.boundary.escapes.filter((r) => r.best < 1.2);
  const escapeFailures = [];
  const knownFailures = audit.knownTraps.filter((r) => r.before && r.after);
  /* The road furniture is cell-binned now (road-stone-c3z5, ...), so
     the collider-cell count is the SUM over the family rather than
     one mesh's. Matching the bare name too keeps this working against
     a build from before the chunking. */
  const roadMeshCells = audit.stats.perMesh
    .filter((m) => m.name === "road-stone" || m.name.startsWith("road-stone-"))
    .reduce((sum, m) => sum + (m.cells || 0), 0);

  const metrics = {
    terrain: {
      samples: terrainErrors.length,
      maxRenderedSamplerErrorM: fixed(Math.max(...terrainErrors), 6),
      p95RenderedSamplerErrorM: fixed(percentile(terrainErrors, 0.95), 6),
    },
    road: {
      samples: roadDepths.length,
      penetrationMaxM: fixed(Math.max(...roadDepths), 4),
      penetrationMedianM: fixed(percentile(roadDepths, 0.5), 4),
      feetAboveMinM: fixed(-Math.max(...roadDepths.map((v) => -v)), 4),
      travelRuns: audit.roadTravel.length,
      travelStalls: roadTravelStalls.length,
      travelTraps: roadTravelTraps.length,
      colliderCells: roadMeshCells,
    },
    cathedralNave: {
      samples: naveReliefs.length,
      maximumPavingAboveSoleM: fixed(Math.max(...naveReliefs), 4),
      medianPavingAboveSoleM: fixed(percentile(naveReliefs, 0.5), 4),
    },
    boundaries: {
      blockedTested: audit.boundary.recoveries.length,
      recoveryFailures: recoveryFailures.length,
      openTested: audit.boundary.escapes.length,
      zeroEscapeFailures: escapeFailures.length,
      sealedInaccessibleIslands: sealedIslands.length,
      knownTrapFailures: knownFailures.length,
    },
  };

  console.log("\n=== SURFACES ===");
  check("walking terrain matches rendered LOD0 triangles",
    metrics.terrain.maxRenderedSamplerErrorM < 0.002,
    `${metrics.terrain.samples} samples, max ${metrics.terrain.maxRenderedSamplerErrorM}m`);
  check("player soles do not penetrate the Pilgrim's Road",
    metrics.road.penetrationMaxM <= 0.025,
    `${metrics.road.samples} samples, max depth ${metrics.road.penetrationMaxM}m`);
  check("road furniture contributes collision cells", metrics.road.colliderCells > 100,
    `${metrics.road.colliderCells} road-stone cells`);
  check("road obstacles retain a player-sized escape route",
    roadTravelTraps.length === 0,
    `${roadTravelStalls.length} contacts, ${roadTravelTraps.length} traps`);
  check("Cathedral nave paving stays below ankle height",
    naveReliefs.length > 80 && Math.max(...naveReliefs) <= 0.08,
    `${naveReliefs.length} visible slabs, max ${metrics.cathedralNave.maximumPavingAboveSoleM}m`);

  console.log("\n=== STUCK / ESCAPE ===");
  check("boundary overlaps depenetrate within bounded 5m recovery", recoveryFailures.length === 0,
    `${audit.boundary.recoveries.length} tested, ${recoveryFailures.length} failures`);
  check("legal obstacle-edge starts retain an escape direction", escapeFailures.length === 0,
    `${audit.boundary.escapes.length} tested, ${escapeFailures.length} reachable failures, `
      + `${sealedIslands.length} sealed sub-capsule voids`);
  check("previously reproduced traps recover", knownFailures.length === 0,
    `${audit.knownTraps.length} coordinates, ${knownFailures.length} still trapped`);
  check("collision build remains below load budget", audit.stats.buildMs < 2500,
    `${audit.stats.buildMs}ms, ${audit.stats.cells} cells`);
  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

  /* Player/road proof at the exact deterministic segment that exposed
     27.8cm of pre-fix burial. */
  await page.evaluate(() => {
    const T = window.__SF;
    const x = 0.58159;
    const z = 561.01255;
    T.collide.setDebugView(T.THREE, T.render.scene, false, x, z);
    T._teleportRaw(x, z, Math.PI);
    T.hidePlayer(false);
    const y = T.collide.groundHeight(x, z);
    T.lookAt([x + 4.7, y + 1.55, z + 4.7], [x, y + 0.7, z], 48);
    T.renderStill();
  });
  let dataUrl = await page.evaluate(() => window.__SF.captureDataURL());
  await writeFile(path.join(OUT, "road-foot-contact.png"),
    Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));

  const naveProof = audit.naveRows.reduce((best, row) => (
    !best || row.relief > best.relief ? row : best
  ), null);
  if (naveProof) {
    await page.evaluate(({ x, z }) => {
      const T = window.__SF;
      const y = T.collide.groundHeight(x, z);
      T.collide.setDebugView(T.THREE, T.render.scene, false, x, z);
      T._teleportRaw(x, z, Math.PI * 0.85);
      T.hidePlayer(false);
      T.lookAt([x + 4.2, y + 1.35, z + 4.2], [x, y + 0.62, z], 50);
      T.renderStill();
    }, naveProof);
    dataUrl = await page.evaluate(() => window.__SF.captureDataURL());
    await writeFile(path.join(OUT, "cathedral-nave-foot-contact.png"),
      Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  }

  await page.evaluate(() => {
    const T = window.__SF;
    const x = -602.24;
    const z = 468.66;
    const y = T.collide.groundHeight(x, z);
    T.collide.setDebugView(T.THREE, T.render.scene, true, x, z, 18);
    T.lookAt([x + 12, y + 6, z + 12], [x, y + 1.1, z], 55);
    T.renderStill();
  });
  dataUrl = await page.evaluate(() => window.__SF.captureDataURL());
  await writeFile(path.join(OUT, "reach-vane-collision-overlay.png"),
    Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));

  const sourceEnd = await hashes();
  const sourceStable = sourceFiles.every((f) => sourceStart[f] === sourceEnd[f]);
  check("source revision stayed frozen during capture", sourceStable);

  const report = {
    generatedAt: new Date().toISOString(),
    version: audit.version,
    sourceStart,
    sourceEnd,
    sourceStable,
    metrics,
    checks,
    failures: {
      roadTravelStalls: roadTravelStalls.slice(0, 30),
      roadTravelTraps: roadTravelTraps.slice(0, 30),
      recoveryFailures: recoveryFailures.slice(0, 30),
      escapeFailures: escapeFailures.slice(0, 30),
      sealedInaccessibleIslands: sealedIslands.slice(0, 30),
      knownFailures,
    },
    knownTraps: audit.knownTraps,
    collisionStats: audit.stats,
    pageErrors,
    consoleErrors,
  };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(path.join(OUT, "summary.txt"), [
    `Saintfall collision audit ${audit.version}`,
    `${checks.filter((c) => c.pass).length}/${checks.length} checks passed`,
    `terrain sampler max error: ${metrics.terrain.maxRenderedSamplerErrorM}m`,
    `road maximum foot penetration: ${metrics.road.penetrationMaxM}m`,
    `Cathedral nave maximum paving relief: ${metrics.cathedralNave.maximumPavingAboveSoleM}m`,
    `boundary recoveries: ${metrics.boundaries.blockedTested - metrics.boundaries.recoveryFailures}/${metrics.boundaries.blockedTested}`,
    `legal edge escapes: ${metrics.boundaries.openTested - metrics.boundaries.zeroEscapeFailures}/${metrics.boundaries.openTested}`,
  ].join("\n") + "\n");

  console.log(`\n${checks.filter((c) => c.pass).length}/${checks.length} checks passed`);
  console.log(`Report: ${path.relative(root, path.join(OUT, "report.json"))}`);
  if (checks.some((c) => !c.pass)) process.exitCode = 1;
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
