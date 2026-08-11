#!/usr/bin/env node
/* ============================================================
   SAINTFALL - melee reticle commitment probe

   A melee press means "attack where the reticle points now." This
   probe exercises that promise through the real keyboard listener,
   the real action timing and the real combat arc:

     1. Hold a conflicting movement key, press Q, and prove the body
        still reaches the captured reticle bearing before melee1 hits.
     2. Put one target on that bearing and a decoy on the old body
        forward; only the reticle-side target may take damage.
     3. Prove the borrowed melee rite returns to ranged afterwards.
     4. Buffer melee2 with a second Q, move the camera away, and prove
        the next swing keeps the bearing captured by that Q press.

   Usage:
     node scripts/saintfall-melee-reticle-probe.mjs [outfile.json]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.resolve(
  root,
  process.argv[2] || "output/saintfall/melee-reticle-probe.json"
);
const PORT = 46600 + (process.pid % 1800);
const BASE = `http://127.0.0.1:${PORT}`;
const AIM_TOLERANCE_DEG = 3;
const RETICLE_MOVE_MIN_DEG = 60;
const DAMAGE_EPSILON = 1e-6;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return;
    } catch (_) { /* retry */ }
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
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=low`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

    /* Install page-local helpers once. Pausing the rAF-owned runtime
       removes real-time frames between keyboard calls; renderOnce()
       deliberately steps api.step() directly, so real input and exact
       simulation timing still travel through the production paths. */
    const environment = await page.evaluate(() => {
      const T = window.__SF;
      T.ctx.runtime.paused = true;
      const site = T.findFlatSite(14);
      const Q = {
        site: [site[0], site[1]],
        step(frames) {
          for (let i = 0; i < frames; i += 1) T.renderOnce(1 / 60);
        },
        angleErrorDeg(a, b) {
          return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) * 180 / Math.PI;
        },
        snapshot(capturedYaw = null) {
          const state = T.player.state;
          const aimYaw = state.aimViewYaw ?? state.camYaw;
          return {
            action: T.player.action || null,
            meleeMode: !!T.weapons.current?.spec?.melee,
            bodyYawDeg: Number((state.yaw * 180 / Math.PI).toFixed(2)),
            reticleYawDeg: Number((aimYaw * 180 / Math.PI).toFixed(2)),
            bodyToReticleDeg: Number(Q.angleErrorDeg(state.yaw, aimYaw).toFixed(2)),
            bodyToCapturedDeg: Number.isFinite(capturedYaw)
              ? Number(Q.angleErrorDeg(state.yaw, capturedYaw).toFixed(2)) : null,
            reticleFromCapturedDeg: Number.isFinite(capturedYaw)
              ? Number(Q.angleErrorDeg(aimYaw, capturedYaw).toFixed(2)) : null,
            travelYawDeg: Number((state.travelYaw * 180 / Math.PI).toFixed(2)),
            travelSpeed: Number(state.travelSpeed.toFixed(3)),
            x: Number(state.x.toFixed(4)),
            z: Number(state.z.toFixed(4)),
            speed: Number(state.speed.toFixed(3)),
          };
        },
        reset(bodyYaw = 0, cameraYaw = 0) {
          T.player.input.clearAll?.();
          T.clearEnemies();
          T.releaseCamera();
          T.teleport(Q.site[0], Q.site[1], bodyYaw);
          T.invulnerable(true);
          T.autoStow(false);
          T.weapons.setMode("ranged");
          T.setFiring(false);
          T.setAds(0);
          /* An injected QA stick overrides real keyboard state. Clear
             it so page.keyboard.down("KeyA"/"KeyD") is authoritative. */
          T.setGaitInput(null);
          T.setCam(cameraYaw, 0, 5.2);
          Q.step(120);
          return Q.snapshot();
        },
      };
      window.__SF_MELEE_RETICLE_QA = Q;
      return { site: Q.site, build: T.version || null };
    });

    /* ----------------------------------------------------------
       PRIMARY STRIKE

       Body starts at 0deg; the reticle is 90deg to the side. A is
       then held through the hit window, and camera intent changes
       another 180deg after Q but before the input event drains.
       Without press-time capture plus a per-action bearing lock,
       either update can redirect the thrust before it connects.
       ---------------------------------------------------------- */
    const primarySetup = await page.evaluate(() => {
      const T = window.__SF;
      const Q = window.__SF_MELEE_RETICLE_QA;
      const reset = Q.reset(0, Math.PI / 2);
      const state = T.player.state;
      const capturedAimYaw = state.aimViewYaw ?? state.camYaw;
      const oldForwardYaw = state.yaw;
      const distance = 2.6;
      const target = T.enemies.spawn("gleaner",
        state.x + Math.sin(capturedAimYaw) * distance,
        state.z + Math.cos(capturedAimYaw) * distance,
        { health: 1000, yaw: capturedAimYaw + Math.PI });
      const decoy = T.enemies.spawn("gleaner",
        state.x + Math.sin(oldForwardYaw) * distance,
        state.z + Math.cos(oldForwardYaw) * distance,
        { health: 1000, yaw: oldForwardYaw + Math.PI });
      Q.primary = {
        capturedAimYaw,
        oldForwardYaw,
        target,
        decoy,
        targetHealthBefore: target?.health ?? null,
        decoyHealthBefore: decoy?.health ?? null,
        startX: state.x,
        startZ: state.z,
      };
      return {
        reset,
        spawned: !!target && !!decoy,
        capturedAimDeg: Number((capturedAimYaw * 180 / Math.PI).toFixed(2)),
        oldForwardDeg: Number((oldForwardYaw * 180 / Math.PI).toFixed(2)),
        oldForwardToAimDeg: Number(Q.angleErrorDeg(oldForwardYaw, capturedAimYaw).toFixed(2)),
        targetAt: target ? [target.x, target.z] : null,
        decoyAt: decoy ? [decoy.x, decoy.z] : null,
      };
    });

    await page.keyboard.down("KeyA");
    /* Real input is non-negotiable here: this must cover the window
       key listener, repeat suppression, event queue and main handler. */
    await page.keyboard.press("KeyQ");
    /* Move camera intent before the next simulation frame drains Q.
       The committed bearing must come from the key event, not from
       meleeSwing() sampling after player.update applies this change. */
    const primaryPressCapture = await page.evaluate(() => {
      const T = window.__SF;
      const Q = window.__SF_MELEE_RETICLE_QA;
      const P = Q.primary;
      const event = [...T.player.input.state.events]
        .reverse().find((entry) => entry.type === "melee");
      const eventAimYaw = event?.aimYaw;
      T.setCam(-Math.PI / 2, 0, 5.2);
      return {
        eventHasAimYaw: Number.isFinite(eventAimYaw),
        eventAimDeg: Number.isFinite(eventAimYaw)
          ? Number((eventAimYaw * 180 / Math.PI).toFixed(2)) : null,
        eventToPressReticleDeg: Number.isFinite(eventAimYaw)
          ? Number(Q.angleErrorDeg(eventAimYaw, P.capturedAimYaw).toFixed(2)) : null,
        cameraIntentFromPressReticleDeg: Number(Q.angleErrorDeg(
          T.player.state.camYaw, P.capturedAimYaw
        ).toFixed(2)),
      };
    });
    const primaryStrike = await page.evaluate(() => {
      const T = window.__SF;
      const Q = window.__SF_MELEE_RETICLE_QA;
      const P = Q.primary;
      const hit = T.player.actionSpec("melee1").hit;

      Q.step(1); // drain the real Q event and begin melee1 at t=0
      const started = Q.snapshot(P.capturedAimYaw);
      const framesBeforeHit = Math.max(0, Math.ceil(hit[0] * 60) - 1);
      Q.step(framesBeforeHit);
      const beforeHit = Q.snapshot(P.capturedAimYaw);
      const beforeTravelYaw = T.player.state.travelYaw;
      const beforeFeet = T.player.legs.map((leg) => {
        const dx = leg.foot.x - T.player.state.x;
        const dz = leg.foot.z - T.player.state.z;
        const tx = leg.target.x - T.player.state.x;
        const tz = leg.target.z - T.player.state.z;
        const yaw = T.player.state.yaw;
        const travelYaw = T.player.state.travelYaw;
        return {
          side: leg.side,
          swinging: leg.swinging,
          lateral: dx * Math.cos(yaw) - dz * Math.sin(yaw),
          forward: dx * Math.sin(yaw) + dz * Math.cos(yaw),
          targetDistance: Math.hypot(tx, tz),
          targetTravelForward: tx * Math.sin(travelYaw) + tz * Math.cos(travelYaw),
          targetTravelLateral: tx * Math.cos(travelYaw) - tz * Math.sin(travelYaw),
        };
      });
      /* Cross the complete hit window. A direction bug must not pass
         merely because the first eligible frame happened to miss. */
      Q.step(Math.ceil((hit[1] - hit[0]) * 60) + 2);
      const afterHit = Q.snapshot(P.capturedAimYaw);
      const targetHealthAfter = P.target?.health ?? null;
      const decoyHealthAfter = P.decoy?.health ?? null;
      const displacementX = beforeHit.x - P.startX;
      const displacementZ = beforeHit.z - P.startZ;
      const displacement = Math.hypot(displacementX, displacementZ);
      /* KeyA is screen-left. Derive its expected world bearing from
         the production camera-relative convention rather than from a
         hard-coded cardinal direction. */
      const expectedMoveYaw = T.player.state.camYaw + Math.PI / 2;
      const displacementYaw = displacement > 1e-5
        ? Math.atan2(displacementX, displacementZ)
        : expectedMoveYaw;
      return {
        input: { melee: "page.keyboard.press(KeyQ)", heldMovement: "KeyA" },
        hitWindow: hit,
        framesBeforeHit,
        started,
        beforeHit,
        afterHit,
        movement: {
          distance: Number(displacement.toFixed(4)),
          expectedYawDeg: Number((expectedMoveYaw * 180 / Math.PI).toFixed(2)),
          displacementYawDeg: Number((displacementYaw * 180 / Math.PI).toFixed(2)),
          directionErrorDeg: Number(Q.angleErrorDeg(
            displacementYaw, expectedMoveYaw
          ).toFixed(2)),
          trackedTravelErrorDeg: Number(Q.angleErrorDeg(
            beforeTravelYaw, displacementYaw
          ).toFixed(2)),
          bodyToTravelDeg: Number(Q.angleErrorDeg(
            beforeTravelYaw, P.capturedAimYaw
          ).toFixed(2)),
          feet: beforeFeet.map((foot) => ({
            side: foot.side,
            swinging: foot.swinging,
            lateral: Number(foot.lateral.toFixed(4)),
            forward: Number(foot.forward.toFixed(4)),
            targetDistance: Number(foot.targetDistance.toFixed(4)),
            targetTravelForward: Number(foot.targetTravelForward.toFixed(4)),
            targetTravelLateral: Number(foot.targetTravelLateral.toFixed(4)),
          })),
          footLateralSeparation: Number(Math.abs(
            beforeFeet[0].lateral - beforeFeet[1].lateral
          ).toFixed(4)),
        },
        targetHealthBefore: P.targetHealthBefore,
        targetHealthAfter,
        targetDamage: P.targetHealthBefore === null || targetHealthAfter === null
          ? null : Number((P.targetHealthBefore - targetHealthAfter).toFixed(3)),
        decoyHealthBefore: P.decoyHealthBefore,
        decoyHealthAfter,
        decoyDamage: P.decoyHealthBefore === null || decoyHealthAfter === null
          ? null : Number((P.decoyHealthBefore - decoyHealthAfter).toFixed(3)),
      };
    });
    await page.keyboard.up("KeyA");
    const primaryRestored = await page.evaluate(() => {
      const T = window.__SF;
      const Q = window.__SF_MELEE_RETICLE_QA;
      Q.step(100);
      return Q.snapshot();
    });

    /* Consumer-routing adversary: real Q must create the event, then
       a distinct sentinel bearing is placed in that event before the
       frame drains it. This isolates main.js forwarding from the
       keydown-capture assertion above; sampling the live reticle in
       meleeSwing() would face 0deg and fail the 120deg sentinel. */
    await page.evaluate(() => window.__SF_MELEE_RETICLE_QA.reset(0, 0));
    await page.keyboard.press("KeyQ");
    const eventRouting = await page.evaluate(() => {
      const T = window.__SF;
      const Q = window.__SF_MELEE_RETICLE_QA;
      const event = [...T.player.input.state.events]
        .reverse().find((entry) => entry.type === "melee");
      const capturedAimYaw = event?.aimYaw;
      const sentinelAimYaw = Math.PI * 2 / 3;
      event.aimYaw = sentinelAimYaw;
      Q.step(1);
      const started = Q.snapshot(sentinelAimYaw);
      const spec = T.player.actionSpec(T.player.action);
      Q.step(Math.max(0, Math.ceil(spec.hit[0] * 60) - 1));
      const beforeHit = Q.snapshot(sentinelAimYaw);
      Q.step(100);
      return {
        capturedAimDeg: Number((capturedAimYaw * 180 / Math.PI).toFixed(2)),
        sentinelAimDeg: Number((sentinelAimYaw * 180 / Math.PI).toFixed(2)),
        started,
        beforeHit,
        restored: Q.snapshot(),
      };
    });

    /* ----------------------------------------------------------
       BUFFERED COMBO

       melee1 starts at 0deg. During its recovery the camera settles
       at +90deg and a second real Q is accepted. The camera then moves
       to -90deg and D stays held. melee2 must turn toward the bearing
       that existed when Q was processed, not either later influence.
       ---------------------------------------------------------- */
    await page.evaluate(() => window.__SF_MELEE_RETICLE_QA.reset(0, 0));
    await page.keyboard.press("KeyQ");
    const comboQueueReady = await page.evaluate(() => {
      const T = window.__SF;
      const Q = window.__SF_MELEE_RETICLE_QA;
      Q.step(1); // begin melee1
      const started = Q.snapshot();
      const first = T.player.actionSpec("melee1");
      T.setCam(Math.PI / 2, 0, 5.2);
      /* Strictly beyond the action's >42% buffer threshold, while
         leaving ample recovery time for the second Q event. */
      const framesToBuffer = Math.ceil(first.dur * 0.42 * 60) + 1;
      Q.step(framesToBuffer);
      return {
        started,
        framesToBuffer,
        atQueue: Q.snapshot(),
        queueReticleYaw: T.player.state.aimViewYaw ?? T.player.state.camYaw,
      };
    });

    await page.keyboard.press("KeyQ");
    await page.keyboard.down("KeyD");
    const bufferedCombo = await page.evaluate(() => {
      const T = window.__SF;
      const Q = window.__SF_MELEE_RETICLE_QA;

      Q.step(1); // process the second real Q while the camera is stable
      const queuedAimYaw = T.player.state.aimViewYaw ?? T.player.state.camYaw;
      const afterQueue = Q.snapshot(queuedAimYaw);
      T.setCam(-Math.PI / 2, 0, 5.2);

      let transitionFrames = 0;
      while (T.player.action === "melee1" && transitionFrames < 90) {
        Q.step(1);
        transitionFrames += 1;
      }
      const secondStarted = Q.snapshot(queuedAimYaw);
      const second = T.player.actionSpec("melee2");
      const framesBeforeHit = Math.max(0, Math.ceil(second.hit[0] * 60) - 1);
      Q.step(framesBeforeHit);
      const beforeSecondHit = Q.snapshot(queuedAimYaw);
      Q.step(Math.ceil((second.hit[1] - second.hit[0]) * 60) + 2);
      const afterSecondHit = Q.snapshot(queuedAimYaw);
      return {
        input: { melee: "page.keyboard.press(KeyQ)", heldMovement: "KeyD" },
        queuedAimDeg: Number((queuedAimYaw * 180 / Math.PI).toFixed(2)),
        afterQueue,
        transitionFrames,
        secondStarted,
        secondHitWindow: second.hit,
        framesBeforeHit,
        beforeSecondHit,
        afterSecondHit,
      };
    });
    await page.keyboard.up("KeyD");
    const comboRestored = await page.evaluate(() => {
      const Q = window.__SF_MELEE_RETICLE_QA;
      Q.step(140);
      return Q.snapshot();
    });

    /* Assertions live outside the page so every failed claim is still
       written to the JSON report and shown in one run. */
    const checks = [];
    const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

    check("primary setup is a meaningful off-forward attack",
      primarySetup.spawned && primarySetup.oldForwardToAimDeg >= 75,
      `${primarySetup.oldForwardToAimDeg}deg between old forward and reticle`);
    check("real Q begins melee1 and borrows melee mode",
      primaryStrike.started.action === "melee1" && primaryStrike.started.meleeMode,
      JSON.stringify(primaryStrike.started));
    check("Q event captures its bearing before the consumer drains it",
      primaryPressCapture.eventHasAimYaw
        && primaryPressCapture.eventToPressReticleDeg <= 0.1
        && primaryPressCapture.cameraIntentFromPressReticleDeg >= RETICLE_MOVE_MIN_DEG,
      JSON.stringify(primaryPressCapture));
    check("conflicting movement is active before melee1 hits",
      primaryStrike.beforeHit.speed >= 0.5,
      `KeyA held, speed ${primaryStrike.beforeHit.speed}m/s`);
    check("melee turn preserves KeyA travel direction",
      primaryStrike.movement.distance >= 0.1
        && primaryStrike.movement.directionErrorDeg <= AIM_TOLERANCE_DEG,
      `${primaryStrike.movement.distance}m at ${primaryStrike.movement.directionErrorDeg}deg error`);
    check("melee gait predicts the resolved travel vector without scissoring",
      primaryStrike.movement.trackedTravelErrorDeg <= AIM_TOLERANCE_DEG
        && primaryStrike.movement.bodyToTravelDeg >= 75
        && primaryStrike.movement.footLateralSeparation >= 0.04
        && primaryStrike.movement.feet.every((foot) => Number.isFinite(foot.lateral)
          && Number.isFinite(foot.targetDistance)
          && foot.targetDistance <= 0.75
          && foot.lateral * foot.side >= -0.02)
        && primaryStrike.movement.feet.some((foot) => foot.swinging
          && foot.targetTravelForward >= 0.15
          && foot.targetTravelForward > Math.abs(foot.targetTravelLateral)),
      JSON.stringify(primaryStrike.movement));
    check("body reaches captured reticle before melee1 hit",
      primaryStrike.beforeHit.action === "melee1"
        && primaryStrike.beforeHit.bodyToCapturedDeg <= AIM_TOLERANCE_DEG,
      `${primaryStrike.beforeHit.bodyToCapturedDeg}deg error (limit ${AIM_TOLERANCE_DEG})`);
    check("reticle-side target takes melee damage",
      Number.isFinite(primaryStrike.targetDamage) && primaryStrike.targetDamage > DAMAGE_EPSILON,
      `${primaryStrike.targetHealthBefore} -> ${primaryStrike.targetHealthAfter}`);
    check("old-forward decoy takes no melee damage",
      Number.isFinite(primaryStrike.decoyDamage)
        && Math.abs(primaryStrike.decoyDamage) <= DAMAGE_EPSILON,
      `${primaryStrike.decoyHealthBefore} -> ${primaryStrike.decoyHealthAfter}`);
    check("ranged mode restores after melee1",
      primaryRestored.action === null && !primaryRestored.meleeMode,
      JSON.stringify(primaryRestored));
    check("main forwards the event bearing into the live swing",
      eventRouting.started.action === "melee1"
        && eventRouting.beforeHit.bodyToCapturedDeg <= AIM_TOLERANCE_DEG
        && eventRouting.beforeHit.bodyToReticleDeg >= 90
        && eventRouting.restored.action === null,
      JSON.stringify(eventRouting));

    check("first combo press begins melee1",
      comboQueueReady.started.action === "melee1" && comboQueueReady.started.meleeMode,
      JSON.stringify(comboQueueReady.started));
    check("second real Q is processed during melee1 recovery",
      comboQueueReady.atQueue.action === "melee1" && bufferedCombo.afterQueue.action === "melee1",
      `before=${comboQueueReady.atQueue.action}, after=${bufferedCombo.afterQueue.action}`);
    check("buffered action advances to melee2",
      bufferedCombo.secondStarted.action === "melee2",
      `action=${bufferedCombo.secondStarted.action}, transition=${bufferedCombo.transitionFrames} frames`);
    check("camera moves far away after buffered Q",
      bufferedCombo.beforeSecondHit.reticleFromCapturedDeg >= RETICLE_MOVE_MIN_DEG,
      `${bufferedCombo.beforeSecondHit.reticleFromCapturedDeg}deg from queued bearing`);
    check("melee2 keeps its own Q-press bearing before hit",
      bufferedCombo.beforeSecondHit.action === "melee2"
        && bufferedCombo.beforeSecondHit.bodyToCapturedDeg <= AIM_TOLERANCE_DEG,
      `${bufferedCombo.beforeSecondHit.bodyToCapturedDeg}deg to queued bearing; `
        + `${bufferedCombo.beforeSecondHit.bodyToReticleDeg}deg to moved reticle`);
    check("ranged mode restores after buffered combo",
      comboRestored.action === null && !comboRestored.meleeMode,
      JSON.stringify(comboRestored));
    check("page and console remain error-free",
      pageErrors.length === 0 && consoleErrors.length === 0,
      JSON.stringify({ pageErrors, consoleErrors }));

    const failures = checks.filter((row) => !row.pass).map((row) => row.name);
    const report = {
      build: environment.build,
      site: environment.site,
      thresholds: {
        aimToleranceDeg: AIM_TOLERANCE_DEG,
        reticleMoveMinimumDeg: RETICLE_MOVE_MIN_DEG,
        damageEpsilon: DAMAGE_EPSILON,
      },
      primary: {
        setup: primarySetup,
        pressCapture: primaryPressCapture,
        strike: primaryStrike,
        restored: primaryRestored,
      },
      eventRouting,
      combo: {
        queueReady: comboQueueReady,
        buffered: bufferedCombo,
        restored: comboRestored,
      },
      errors: { page: pageErrors, console: consoleErrors },
      checks,
      failures,
    };

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(report, null, 2));

    console.log("\nSAINTFALL melee reticle commitment\n" + "=".repeat(76));
    for (const row of checks) {
      console.log(`${row.pass ? "  PASS" : "  FAIL"}  ${row.name}`);
      console.log(`        ${row.detail}`);
    }
    console.log("=".repeat(76));
    console.log(`wrote ${path.relative(root, outFile)}`);
    if (failures.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
