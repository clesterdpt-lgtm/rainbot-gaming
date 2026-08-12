#!/usr/bin/env node
/* Saintfall downhill locomotion proof.

   Two authored terrain routes exercise the player-facing contract:

     GENTLE  - a sustained 25-29 degree descent stays grounded and
               keeps the ordinary distance-driven walking gait.
     STEEP   - a sustained 48-57 degree slip face stays grounded but
               changes to the wide, braced downhill skid pose.

   A separate support-gap case proves the grounding repair did not
   turn a real ledge into sticky terrain.

   Usage: node scripts/saintfall-downhill-probe.mjs [--out DIR]
*/

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const outDir = path.resolve(root, outArg >= 0
  ? process.argv[outArg + 1]
  : "output/saintfall/downhill-probe");
const port = 47400 + (process.pid % 700);
const base = `http://127.0.0.1:${port}`;

const ROUTES = {
  gentle: { x: 140, z: 780, yaw: 1.9634954084936207 },
  steep: { x: -20, z: 840, yaw: Math.PI / 2 },
  /* Open-dune visual fixture. The stronger physics route above sits
     beside the Pilgrim's Road structures, which proves collision
     continuity but obscures the body silhouette in a still. */
  steepVisual: { x: 350, z: -830, yaw: 5.868670 },
};

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}

async function waitServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

async function saveDataUrl(file, value) {
  await writeFile(file, Buffer.from(value.replace(/^data:image\/png;base64,/, ""), "base64"));
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const child = server();
  let browser;
  const errors = [];
  const failures = [];
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    await page.goto(`${base}/games/saintfall.html?qa=1&intro=0&time=noon`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
    await page.evaluate(() => {
      const T = window.__SF;
      T.maximize();
      T.hideHud(true);
      T.clearEnemies();
      T.setAutoStow?.(false);
    });

    async function runRoute(route, frames = 105, dt = 1 / 60) {
      const result = await page.evaluate(({ route, frames, dt }) => {
        const T = window.__SF;
        const p = T.playerState();
        T.player.setFree(false);
        T.player.spawn(route.x, route.z, route.yaw);
        p.camYaw = route.yaw;
        p.figureOverride = true;
        T.player.input.inject(0, -1);
        const start = {
          x: p.x, y: p.y, z: p.z,
          gait: p.gait, stride: p.stride,
        };
        let airborneFrames = 0;
        let slideFrames = 0;
        let maxClearance = 0;
        let maxVerticalStep = 0;
        let maxVerticalJerk = 0;
        let maxGroundMismatch = 0;
        let maxPose = 0;
        let maxGrade = 0;
        let previousY = p.y;
        let previousGround = p.y;
        let previousStep = 0;
        let braceOffsetMax = 0;
        let slideTransitions = 0;
        let slideEnterFrame = null;
        let previousSliding = false;
        let stableSlideFrames = 0;
        let bothLegsStillFrames = 0;
        let minBraceFore = Infinity;
        let minBraceLateral = Infinity;
        let rootRollMin = Infinity;
        let rootRollMax = -Infinity;
        let rootYMin = Infinity;
        let rootYMax = -Infinity;
        const samples = [];
        for (let i = 0; i < frames; i += 1) {
          T.advanceTime(dt, dt);
          const state = T.downhillState();
          const yStep = p.y - previousY;
          const ground = p.y - state.clearance;
          const groundStep = ground - previousGround;
          maxVerticalStep = Math.max(maxVerticalStep, Math.abs(yStep));
          maxVerticalJerk = Math.max(maxVerticalJerk, Math.abs(yStep - previousStep));
          maxGroundMismatch = Math.max(maxGroundMismatch, Math.abs(yStep - groundStep));
          previousY = p.y;
          previousGround = ground;
          previousStep = yStep;
          if (!state.grounded) airborneFrames += 1;
          if (state.sliding) slideFrames += 1;
          if (state.sliding !== previousSliding) {
            slideTransitions += 1;
            if (state.sliding && slideEnterFrame === null) slideEnterFrame = i + 1;
            previousSliding = state.sliding;
          }
          maxClearance = Math.max(maxClearance, Math.abs(state.clearance));
          maxPose = Math.max(maxPose, state.pose);
          maxGrade = Math.max(maxGrade, state.grade);
          for (const foot of state.feet) {
            braceOffsetMax = Math.max(braceOffsetMax, Math.hypot(foot[0] - p.x, foot[2] - p.z));
          }
          if (state.pose >= 0.9) {
            stableSlideFrames += 1;
            if (state.legs.every((leg) => !leg.swinging)) bothLegsStillFrames += 1;
            const dx = state.feet[0][0] - state.feet[1][0];
            const dz = state.feet[0][2] - state.feet[1][2];
            const sin = Math.sin(p.travelYaw);
            const cos = Math.cos(p.travelYaw);
            minBraceFore = Math.min(minBraceFore, Math.abs(dx * sin + dz * cos));
            minBraceLateral = Math.min(minBraceLateral, Math.abs(dx * cos - dz * sin));
            rootRollMin = Math.min(rootRollMin, state.root.roll);
            rootRollMax = Math.max(rootRollMax, state.root.roll);
            rootYMin = Math.min(rootYMin, state.root.relativeY);
            rootYMax = Math.max(rootYMax, state.root.relativeY);
          }
          if (i % 10 === 0 || i === frames - 1) {
            samples.push({
              frame: i + 1,
              y: Number(p.y.toFixed(3)),
              ground: Number((p.y - state.clearance).toFixed(3)),
              grounded: state.grounded,
              grade: state.grade,
              sliding: state.sliding,
              pose: state.pose,
              gait: state.gait,
            });
          }
        }
        T.player.input.inject(null, null);
        const end = T.downhillState();
        return {
          route,
          frames,
          dt,
          movedM: Number(Math.hypot(p.x - start.x, p.z - start.z).toFixed(3)),
          descendedM: Number((start.y - p.y).toFixed(3)),
          gaitDelta: Number((p.gait - start.gait).toFixed(4)),
          strideDelta: Number((p.stride - start.stride).toFixed(4)),
          airborneFrames,
          slideFrames,
          maxClearance: Number(maxClearance.toFixed(4)),
          maxVerticalStep: Number(maxVerticalStep.toFixed(4)),
          maxVerticalJerk: Number(maxVerticalJerk.toFixed(4)),
          maxGroundMismatch: Number(maxGroundMismatch.toFixed(4)),
          maxPose: Number(maxPose.toFixed(4)),
          maxGrade: Number(maxGrade.toFixed(4)),
          braceOffsetMax: Number(braceOffsetMax.toFixed(4)),
          slideTransitions,
          slideEnterFrame,
          stableSlideFrames,
          bothLegsStillFrames,
          minBraceFore: Number((Number.isFinite(minBraceFore) ? minBraceFore : 0).toFixed(4)),
          minBraceLateral: Number((Number.isFinite(minBraceLateral) ? minBraceLateral : 0).toFixed(4)),
          rootRollSpan: Number((Number.isFinite(rootRollMin) ? rootRollMax - rootRollMin : 0).toFixed(4)),
          rootYSpan: Number((Number.isFinite(rootYMin) ? rootYMax - rootYMin : 0).toFixed(4)),
          final: end,
          player: { x: p.x, y: p.y, z: p.z, yaw: p.travelYaw },
          samples,
        };
      }, { route, frames, dt });
      return result;
    }

    async function captureRoute(label, route, frames) {
      const dataUrl = await page.evaluate(({ route, frames }) => {
        const T = window.__SF;
        const p = T.playerState();
        T.player.setFree(false);
        T.player.spawn(route.x, route.z, route.yaw);
        p.camYaw = route.yaw;
        p.figureOverride = true;
        T.player.input.inject(0, -1);
        for (let i = 0; i < frames; i += 1) T.advanceTime(1 / 60, 1 / 60);
        T.player.input.inject(null, null);
        T.heroCamera({
          /* Frame from the downhill-side profile. An uphill-side
             camera has to rise over the slip face and turns a useful
             silhouette proof into a near-overhead shot. */
          bearing: Math.PI - p.travelYaw,
          radius: 5.2,
          height: 1.05,
          aim: 0.92,
          fov: 34,
          pitch: 0.04,
        });
        T.renderStill();
        return T.captureDataURL();
      }, { route, frames });
      await saveDataUrl(path.join(outDir, `${label}.png`), dataUrl);
    }

    const gentle = await runRoute(ROUTES.gentle);
    const steep = await runRoute(ROUTES.steep);
    await captureRoute("gentle-walk-downhill", ROUTES.gentle, 82);
    await captureRoute("steep-slide-downhill", ROUTES.steepVisual, 66);

    const exit = await page.evaluate(() => {
      const T = window.__SF;
      T.player.setFree(false);
      T.player.input.inject(null, null);
      T.advanceTime(1.0, 1 / 60);
      return T.downhillState();
    });

    const supportGap = await page.evaluate(() => {
      const T = window.__SF;
      const p = T.playerState();
      const site = T.findFlatSite(18);
      T.player.setFree(false);
      T.player.spawn(site[0], site[1], 0);
      p.y += 1.0;
      p.grounded = true;
      T.advanceTime(1 / 60, 1 / 60);
      return T.downhillState();
    });

    /* The original fault was frame-rate sensitive: horizontal travel
       advanced by the full step while vertical settling had a per-second
       cap. Exercise the same routes at 60, 30, 20 and 10 FPS so the
       surface transport cannot regress into a throttled-frame judder. */
    const rates = {};
    for (const dt of [1 / 60, 1 / 30, 0.05, 0.1]) {
      const key = `${Math.round(1 / dt)}fps`;
      const frames = Math.round(1.7 / dt);
      rates[key] = {
        gentle: await runRoute(ROUTES.gentle, frames, dt),
        steep: await runRoute(ROUTES.steep, frames, dt),
      };
    }

    const transition = await page.evaluate(() => {
      const T = window.__SF;
      const p = T.playerState();
      const route = { x: -10, z: 850, yaw: 1.9634954084936207 };
      T.player.setFree(false);
      T.player.spawn(route.x, route.z, route.yaw);
      p.camYaw = route.yaw;
      p.figureOverride = true;
      T.player.input.inject(0, -1);
      let previousSliding = false;
      let transitions = 0;
      let enterFrame = null;
      let exitFrame = null;
      let gaitAtExit = null;
      let airborneFrames = 0;
      let maxClearance = 0;
      for (let i = 0; i < 170; i += 1) {
        T.advanceTime(1 / 60, 1 / 60);
        const state = T.downhillState();
        if (!state.grounded) airborneFrames += 1;
        maxClearance = Math.max(maxClearance, Math.abs(state.clearance));
        if (state.sliding !== previousSliding) {
          transitions += 1;
          if (state.sliding) enterFrame = i + 1;
          else {
            exitFrame = i + 1;
            gaitAtExit = p.gait;
          }
          previousSliding = state.sliding;
        }
      }
      T.player.input.inject(null, null);
      const final = T.downhillState();
      return {
        transitions,
        enterFrame,
        exitFrame,
        airborneFrames,
        maxClearance: Number(maxClearance.toFixed(4)),
        postExitGait: Number((gaitAtExit === null ? 0 : p.gait - gaitAtExit).toFixed(4)),
        final,
      };
    });

    /* A genuine ravine edge must still release the capsule. Its first
       quarter metre drops almost 1.8m, far beyond the continuous dune
       classifier, so this is the map-authored negative—not a synthetic
       height offset. */
    const cliff = await page.evaluate(() => {
      const T = window.__SF;
      const p = T.playerState();
      const route = { x: -652, z: 319, yaw: Math.PI };
      T.player.setFree(false);
      T.player.spawn(route.x, route.z, route.yaw);
      p.camYaw = route.yaw;
      p.figureOverride = true;
      T.player.input.inject(0, -1);
      const startX = p.x;
      const startZ = p.z;
      let firstAirFrame = null;
      let movedAtAir = null;
      let slideFrames = 0;
      let minVy = p.vy;
      for (let i = 0; i < 20; i += 1) {
        T.advanceTime(1 / 60, 1 / 60);
        const state = T.downhillState();
        if (state.sliding) slideFrames += 1;
        minVy = Math.min(minVy, p.vy);
        if (!state.grounded && firstAirFrame === null) {
          firstAirFrame = i + 1;
          movedAtAir = Math.hypot(p.x - startX, p.z - startZ);
        }
      }
      T.player.input.inject(null, null);
      return {
        firstAirFrame,
        movedAtAir: movedAtAir === null ? null : Number(movedAtAir.toFixed(4)),
        slideFrames,
        minVy: Number(minVy.toFixed(4)),
        final: T.downhillState(),
      };
    });

    if (gentle.airborneFrames !== 0) failures.push(`gentle descent spent ${gentle.airborneFrames} frames airborne`);
    if (gentle.slideFrames !== 0 || gentle.maxPose >= 0.10) {
      failures.push(`gentle descent entered skid (${gentle.slideFrames} frames, pose ${gentle.maxPose})`);
    }
    if (gentle.maxClearance > 0.03) failures.push(`gentle descent left ${gentle.maxClearance}m ground clearance`);
    if (gentle.maxGroundMismatch > 0.02) failures.push(`gentle body/ground motion diverged ${gentle.maxGroundMismatch}m`);
    if (gentle.gaitDelta < 2.0) failures.push(`gentle walking gait advanced only ${gentle.gaitDelta} cycles`);
    if (gentle.maxVerticalJerk > 0.08) failures.push(`gentle vertical motion jerked ${gentle.maxVerticalJerk}m/frame`);

    if (steep.airborneFrames !== 0) failures.push(`steep descent spent ${steep.airborneFrames} frames airborne`);
    if (steep.slideFrames < 80 || steep.maxPose < 0.90) {
      failures.push(`steep descent did not establish skid (${steep.slideFrames} frames, pose ${steep.maxPose})`);
    }
    if (steep.maxClearance > 0.03) failures.push(`steep slide left ${steep.maxClearance}m ground clearance`);
    if (steep.maxGroundMismatch > 0.02) failures.push(`steep body/ground motion diverged ${steep.maxGroundMismatch}m`);
    if (steep.slideTransitions !== 1 || steep.slideEnterFrame > 12) {
      failures.push(`steep skid latch was unstable: ${steep.slideTransitions} transitions, entered frame ${steep.slideEnterFrame}`);
    }
    if (!(steep.gaitDelta < gentle.gaitDelta * 0.45)) {
      failures.push(`steep skid still walked: ${steep.gaitDelta} vs gentle ${gentle.gaitDelta} gait cycles`);
    }
    if (steep.braceOffsetMax > 0.55) failures.push(`skid boot brace reached ${steep.braceOffsetMax}m from body`);
    if (steep.minBraceFore < 0.32 || steep.minBraceLateral < 0.28) {
      failures.push(`skid stance collapsed to ${steep.minBraceFore}m fore / ${steep.minBraceLateral}m lateral`);
    }
    if (steep.bothLegsStillFrames !== steep.stableSlideFrames) {
      failures.push(`skid ran the walking leg swing for ${steep.stableSlideFrames - steep.bothLegsStillFrames} stable frames`);
    }
    if (steep.final.root.pitch > -0.10 || steep.final.root.scaleY > 0.92) {
      failures.push(`skid body did not brace: ${JSON.stringify(steep.final.root)}`);
    }
    if (steep.rootRollSpan < 0.012 || steep.rootYSpan < 0.008) {
      failures.push(`skid pose froze: roll span ${steep.rootRollSpan}, root-Y span ${steep.rootYSpan}`);
    }
    if (exit.sliding || exit.pose > 0.05) failures.push(`skid did not release at rest: ${JSON.stringify(exit)}`);
    if (supportGap.grounded) failures.push("a true one-metre support gap stayed grounded");
    for (const [label, pair] of Object.entries(rates)) {
      if (pair.gentle.airborneFrames || pair.gentle.slideTransitions
        || pair.gentle.maxClearance > 0.03 || pair.gentle.maxGroundMismatch > 0.02
        || pair.gentle.movedM < 11.5) {
        failures.push(`${label} gentle descent lost smooth walking: ${JSON.stringify(pair.gentle)}`);
      }
      if (pair.steep.airborneFrames || pair.steep.slideTransitions !== 1
        || pair.steep.maxClearance > 0.03 || pair.steep.maxGroundMismatch > 0.02
        || pair.steep.maxPose < 0.90 || pair.steep.gaitDelta > 0.40
        || pair.steep.movedM < 11.5) {
        failures.push(`${label} steep descent lost stable skid: ${JSON.stringify(pair.steep)}`);
      }
    }
    if (transition.transitions !== 2 || transition.airborneFrames
      || transition.maxClearance > 0.05 || transition.final.sliding
      || transition.final.pose > 0.05 || transition.postExitGait < 2.0) {
      failures.push(`steep-to-gentle transition failed: ${JSON.stringify(transition)}`);
    }
    if (cliff.slideFrames || cliff.firstAirFrame === null || cliff.firstAirFrame > 15
      || cliff.movedAtAir === null || cliff.movedAtAir > 0.8 || cliff.minVy >= 0) {
      failures.push(`real cliff did not become a fall: ${JSON.stringify(cliff)}`);
    }
    if (errors.length) failures.push(...errors);

    const report = { gentle, steep, exit, supportGap, rates, transition, cliff, errors, failures };
    await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

    console.log(`gentle: ${gentle.movedM}m forward / ${gentle.descendedM}m down · `
      + `${gentle.airborneFrames} air · ${gentle.slideFrames} skid · gait ${gentle.gaitDelta}`);
    console.log(`steep:  ${steep.movedM}m forward / ${steep.descendedM}m down · `
      + `${steep.airborneFrames} air · ${steep.slideFrames} skid · gait ${steep.gaitDelta}`);
    console.log(`clearance gentle/steep: ${gentle.maxClearance}m / ${steep.maxClearance}m`);
    console.log(`rate sweep: ${Object.keys(rates).join(", ")} · transition ${transition.transitions} latches`);
    console.log(`real cliff releases on frame ${cliff.firstAirFrame} after ${cliff.movedAtAir}m`);
    console.log(`support gap becomes airborne: ${!supportGap.grounded}`);
    if (failures.length) {
      console.log("FAIL:");
      for (const failure of failures) console.log(`  - ${failure}`);
      process.exitCode = 1;
    } else {
      console.log("PASS: gentle hills walk smoothly; steep hills use the grounded skid");
    }
    console.log(`artifacts: ${path.relative(root, outDir)}`);
  } finally {
    await browser?.close().catch(() => {});
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
