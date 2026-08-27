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
     4. The boss's rendered geometry is materially on-screen during the reveal,
        rather than merely placing an unobstructed aim point under the reticle.
     5. Screenshots of every boss intro are captured for verification.

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

  let bosses = [
    { key: "reach", name: "The Matriarch", district: "reach" },
    { key: "censer", name: "The Winnower", district: "censer" },
    { key: "scar", name: "The Distaff", district: "scar" },
    { key: "ossuary", name: "The Garner", district: "ossuary" },
    { key: "choir", name: "The Stylite", district: "choir" },
    { key: "bloom", name: "The Abbess", district: "bloom" },
    { key: "saint", name: "The Coulter", district: "saint" },
    { key: "cathedral", name: "The Apostate", district: "cathedral" },
  ];
  const requestedBosses = new Set(process.argv.slice(2).map((value) => value.toLowerCase()));
  if (requestedBosses.size) {
    bosses = bosses.filter((boss) => requestedBosses.has(boss.key)
      || requestedBosses.has(boss.name.replace(/^the /i, "").toLowerCase()));
  }

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

        /* Each approach is an isolated encounter. Bespoke district
           controllers remain live when the mission phase changes, so
           leaving the previous boss active can advance animation or
           camera state under the next reveal. Re-arm and hide the
           whole cast before selecting this subject. */
        T.releaseCamera();
        T.ctx.winnower?.resetToPerch?.();
        T.ctx.distaff?.resetToLair?.();
        T.ctx.garner?.resetToPit?.();
        T.ctx.stylite?.resetToPerch?.();
        T.ctx.abbess?.resetToSeat?.();
        T.ctx.apostate?.reset?.();
        T.ctx.districtBosses?.reset?.("reach");
        T.ctx.districtBosses?.reset?.("saint");

        /* The reveal solver reasons about authored body samples. This audit
           also walks the geometry the renderer is actually drawing. That
           distinction matters for burrowers, procedural bosses whose enemy
           root is empty, and tall rigs whose anchor can be visible while the
           animal itself is outside the frame. */
        const bossRoots = () => {
          const pick = (group, names) => group
            ? names.map((name) => group.getObjectByName(name)).filter(Boolean)
            : [];
          if (key === "choir") {
            const roots = pick(T.ctx.stylite?.group, ["sf-stylite-body"]);
            if (roots.length) return roots;
          }
          if (key === "bloom") {
            const roots = pick(T.ctx.abbess?.group, ["sf-abbess-sac", "sf-abbess-head"]);
            if (roots.length) return roots;
          }
          if (key === "ossuary") {
            const roots = pick(T.ctx.garner?.group, ["sf-garner-maw", "sf-garner-arms"]);
            if (roots.length) return roots;
          }
          if (key === "cathedral") {
            const apostate = T.apostate?.instance?.();
            return apostate?.root ? [apostate.root] : [];
          }
          const enemyKey = ({
            reach: "matriarch",
            censer: "winnower",
            scar: "distaff",
            saint: "coulter",
          })[key] || key;
          return T.enemies.live
            .filter((enemy) => enemy.key === enemyKey && enemy.state !== "death" && enemy.root)
            .map((enemy) => enemy.root);
        };

        const renderedBossVisibility = () => {
          const THREE = T.THREE;
          const camera = T.render.camera;
          camera.updateMatrixWorld(true);
          const point = new THREE.Vector3();
          const projected = new THREE.Vector3();
          const samples = [];
          for (const root of bossRoots()) {
            let chainVisible = true;
            for (let node = root; node; node = node.parent) {
              if (!node.visible) chainVisible = false;
            }
            if (!chainVisible) continue;
            root.updateWorldMatrix(true, true);
            root.traverseVisible((object) => {
              if (!object.isMesh && !object.isSkinnedMesh) return;
              const position = object.geometry?.attributes?.position;
              if (!position?.count) return;
              const stride = Math.max(1, Math.ceil(position.count / 90));
              for (let i = 0; i < position.count; i += stride) {
                if (object.isSkinnedMesh) object.getVertexPosition(i, point).applyMatrix4(object.matrixWorld);
                else point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
                if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
                /* Buried geometry is intentionally not photographable.
                   Counting the Coulter's underground tail or the
                   Garner's sub-floor throat as a hidden body makes a
                   correct pit shot fail at exactly the buried fraction. */
                const floor = T.ctx.collide.groundHeight(point.x, point.z);
                if (Number.isFinite(floor) && point.y < floor - 0.35) continue;
                samples.push([point.x, point.y, point.z]);
              }
            });
          }
          if (!samples.length) return { samples: 0, onScreen: 0, clearOnScreen: 0, fillH: 0, fillW: 0 };

          let onScreen = 0;
          let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
          let allU0 = Infinity, allU1 = -Infinity, allV0 = Infinity, allV1 = -Infinity;
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          const screenPoints = [];
          for (const sample of samples) {
            point.set(sample[0], sample[1], sample[2]);
            projected.copy(point).project(camera);
            allU0 = Math.min(allU0, projected.x); allU1 = Math.max(allU1, projected.x);
            allV0 = Math.min(allV0, projected.y); allV1 = Math.max(allV1, projected.y);
            x0 = Math.min(x0, sample[0]); x1 = Math.max(x1, sample[0]);
            y0 = Math.min(y0, sample[1]); y1 = Math.max(y1, sample[1]);
            z0 = Math.min(z0, sample[2]); z1 = Math.max(z1, sample[2]);
            const inside = projected.z >= -1 && projected.z <= 1
              && projected.x >= -1 && projected.x <= 1
              && projected.y >= -1 && projected.y <= 1;
            if (!inside) continue;
            onScreen += 1;
            screenPoints.push(sample);
            u0 = Math.min(u0, projected.x); u1 = Math.max(u1, projected.x);
            v0 = Math.min(v0, projected.y); v1 = Math.max(v1, projected.y);
          }

          let clear = 0;
          const rayBudget = Math.min(24, screenPoints.length);
          for (let i = 0; i < rayBudget; i += 1) {
            const sample = screenPoints[Math.floor((i + 0.5) * screenPoints.length / rayBudget)];
            const dx = sample[0] - camera.position.x;
            const dy = sample[1] - camera.position.y;
            const dz = sample[2] - camera.position.z;
            const len = Math.hypot(dx, dy, dz);
            const reach = Math.max(0.5, len - 0.9);
            const hit = T.ctx.collide.rayBlock(camera.position.x, camera.position.y, camera.position.z,
              dx / len, dy / len, dz / len, reach, true);
            if (!(hit < reach)) clear += 1;
          }
          return {
            samples: samples.length,
            onScreen: onScreen / samples.length,
            clearOnScreen: rayBudget ? clear / rayBudget : 0,
            fillH: Number.isFinite(v0) ? (v1 - v0) / 2 : 0,
            fillW: Number.isFinite(u0) ? (u1 - u0) / 2 : 0,
            ndcCentre: [(allU0 + allU1) / 2, (allV0 + allV1) / 2],
            worldCentre: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
          };
        };

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
        let visibility = null;
        let renderedVisibility = null;
        let secs = 0;
        let freeReleased = false;

        let lastPhase = "";
        /* Follow the complete reveal hold. Garner's ground opening and
           Coulter's breach deliberately uncover the subject over time;
           sampling only the first three seconds grades the lid, not the
           completed introduction. Eight seconds is a hard upper bound. */
        for (let frame = 0; frame < 480; frame += 1) {
          T.renderOnce(1 / 60);
          secs += 1 / 60;
          if (key === "choir") {
            const st = T.ctx.stylite.status();
            lastPhase = st?.phase;
          }
          if (T.player.state.free) {
            sawFree = true;
            const measureNow = !camPos || frame % 12 === 0;
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
              /* INDEPENDENT OCCLUSION WITNESS. The reveal solver picks
                 the shot; this probe re-derives visibility with its own
                 rays through the same collision grid - camera to the aim
                 point, a point above it, and both flanks - so a solver
                 bug cannot mark its own homework. A ray that gets within
                 a metre of its sample counts as arrived. */
            }
            /* Measured across the WHOLE hold, best frame kept: some
               reveals are animated uncoverings (the Garner's pit opens
               under the shot, the Coulter breaches into it), so the
               honest question is "was the subject seeable during the
               intro", not "on its first frame". */
            if (measureNow) {
              const collide = T.ctx.collide;
              const samples = [
                [camTarget.x, camTarget.y, camTarget.z],
                [camTarget.x, camTarget.y + 3, camTarget.z],
              ];
              {
                const vx = camTarget.x - camPos.x;
                const vz = camTarget.z - camPos.z;
                const vl = Math.hypot(vx, vz) || 1;
                const rx = vz / vl, rz = -vx / vl;
                samples.push([camTarget.x + rx * 2.5, camTarget.y + 0.5, camTarget.z + rz * 2.5]);
                samples.push([camTarget.x - rx * 2.5, camTarget.y + 0.5, camTarget.z - rz * 2.5]);
              }
              let clear = 0;
              for (const sm of samples) {
                const dx = sm[0] - camPos.x;
                const dy = sm[1] - camPos.y;
                const dz = sm[2] - camPos.z;
                const len = Math.hypot(dx, dy, dz);
                if (len < 1.5) { clear += 1; continue; }
                const reach = Math.max(0.5, len - 1.0);
                const hit = collide.rayBlock(camPos.x, camPos.y, camPos.z,
                  dx / len, dy / len, dz / len, reach, true);
                if (!(hit < reach)) clear += 1;
              }
              visibility = Math.max(visibility ?? 0, clear / samples.length);
              const rendered = renderedBossVisibility();
              const score = rendered.onScreen * rendered.clearOnScreen
                + Math.max(rendered.fillH, rendered.fillW);
              const bestScore = renderedVisibility
                ? renderedVisibility.onScreen * renderedVisibility.clearOnScreen
                  + Math.max(renderedVisibility.fillH, renderedVisibility.fillW)
                : -1;
              if (score > bestScore) renderedVisibility = rendered;
            }
          } else if (sawFree) {
            freeReleased = true;
            break;
          }
        }

        return {
          sawFree,
          camPos,
          camTarget,
          camFov,
          visibility,
          renderedVisibility,
          freeReleased,
        };
      }, { key: b.key, angle: a.angle });

      camPoses.push({ name: a.name, ...introData });
    }

    // Log angle details
    for (const p of camPoses) {
      const drawn = p.renderedVisibility;
      console.log(`    [${p.name}] sawFree: ${p.sawFree}, camPos: ${p.camPos ? `(${p.camPos.x}, ${p.camPos.y}, ${p.camPos.z})` : "none"}, aimVis: ${p.visibility ?? "—"}, meshOnScreen: ${drawn ? `${Math.round(drawn.onScreen * 100)}%` : "—"}, meshClear: ${drawn ? `${Math.round(drawn.clearOnScreen * 100)}%` : "—"}, ndc: ${drawn?.ndcCentre ? drawn.ndcCentre.map((v) => v.toFixed(2)).join(",") : "—"}, world: ${drawn?.worldCentre ? drawn.worldCentre.map((v) => v.toFixed(1)).join(",") : "—"}, released: ${p.freeReleased}`);
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

    // Check 3: the boss is actually SEEABLE from the chosen camera -
    // the whole point of an intro. At least 3 of 4 body rays must
    // arrive from every approach angle.
    const worstVisibility = Math.min(...camPoses.map((p) => p.visibility ?? 0));
    check(`${b.name} intro camera has line of sight to the boss (not behind scenery)`,
      worstVisibility >= 0.75,
      `worst angle sees ${(worstVisibility * 100).toFixed(0)}% of body rays`);

    // Check 4: actual rendered boss geometry, not just its authored aim
    // point, occupies a meaningful part of the frame and is not occluded.
    const worstMeshOnScreen = Math.min(...camPoses.map((p) => p.renderedVisibility?.onScreen ?? 0));
    const worstMeshClear = Math.min(...camPoses.map((p) => p.renderedVisibility?.clearOnScreen ?? 0));
    const smallestFill = Math.min(...camPoses.map((p) => Math.max(
      p.renderedVisibility?.fillH ?? 0, p.renderedVisibility?.fillW ?? 0)));
    check(`${b.name} rendered body is visible on-screen during the intro`,
      worstMeshOnScreen >= 0.35 && worstMeshClear >= 0.75 && smallestFill >= 0.06,
      `worst angle: ${Math.round(worstMeshOnScreen * 100)}% on-screen, ${Math.round(worstMeshClear * 100)}% unobstructed, ${(smallestFill * 100).toFixed(1)}% frame footprint`);

    // Check 5: Camera is cleanly released back to the player
    const allReleased = camPoses.every((p) => p.freeReleased);
    check(`${b.name} intro camera releases back to player when alert completes`, allReleased);

    // Save screenshot of the reveal shot
    await page.evaluate(async (args) => {
      const T = window.__SF;
      const M = T.ctx.mission;
      const key = args.key;
      T.releaseCamera();
      T.ctx.winnower?.resetToPerch?.();
      T.ctx.distaff?.resetToLair?.();
      T.ctx.garner?.resetToPit?.();
      T.ctx.stylite?.resetToPerch?.();
      T.ctx.abbess?.resetToSeat?.();
      T.ctx.apostate?.reset?.();
      T.ctx.districtBosses?.reset?.("reach");
      T.ctx.districtBosses?.reset?.("saint");
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
        bx = site.x; bz = site.z; appDist = 45;
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

      const revealFrames = key === "ossuary" ? 220 : key === "saint" ? 210 : 60;
      for (let i = 0; i < revealFrames; i += 1) T.renderOnce(1 / 60);
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
