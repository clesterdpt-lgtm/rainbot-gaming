#!/usr/bin/env node
/* ============================================================
   SAINTFALL - natural Vesper day/night cycle

   Proves the four authored lighting states are one continuous,
   persistent cycle and that the binary suns / three moons are live
   sky bodies rather than static copy or disconnected test presets.

   Usage: node scripts/saintfall-day-night-cycle.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "output/saintfall/day-night-cycle");
const PORT = 49942;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const failures = [];
let checks = 0;
const check = (pass, label, detail = "") => {
  checks += 1;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!pass) failures.push(label);
};
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const angularSeparation = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

async function writeCapture(page, name) {
  const data = await page.evaluate(() => window.__SF.captureDataURL());
  const bytes = Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
  await writeFile(path.join(OUT, name), bytes);
  return bytes.length;
}

try {
  for (let i = 0; i < 150; i += 1) {
    try { const response = await fetch(`${BASE}/games/saintfall.html`); if (response.ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 240));
  });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&cycle=1&cyclePhase=0&quality=high`,
    { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await mkdir(OUT, { recursive: true });
  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    T.hideHud(true);
    T.invulnerable(true);
    T.setBreachAuto(false);
  });

  console.log("\n=== FOUR-STATE ARC ===");
  const samples = await page.evaluate(() => {
    const T = window.__SF;
    return [0, 0.125, 0.25, 0.375, 0.5, 0.61, 0.72, 0.86, 0.999].map((phase) => {
      T.setDayCycle(phase, false);
      T.renderOnce(0.3);
      const report = T.report();
      return {
        phase,
        ...T.dayCycleState(),
        sunDir: report.atmos.sunDir,
        elevation: report.atmos.sunElevationDeg,
        exposure: report.atmos.exposure,
      };
    });
  });
  for (const sample of samples) {
    console.log(`  ${sample.solarHour.toFixed(2)}h · ${sample.from} -> ${sample.to} `
      + `${sample.blend.toFixed(3)} · sun ${sample.elevation.toFixed(1)}°`);
  }
  const at = (phase) => samples.find((sample) => sample.phase === phase);
  check(at(0).from === "goldenhour" && at(0).to === "noon" && at(0).blend === 0,
    "the cycle begins at dawn-gold");
  check(at(0.25).from === "noon" && at(0.25).to === "dusk" && at(0.25).blend === 0,
    "high sun is the noon anchor");
  check(at(0.5).from === "dusk" && at(0.5).to === "night" && at(0.5).blend === 0,
    "vespers is the sunset anchor");
  check(at(0.72).from === "night" && at(0.72).night === 1,
    "the Long Dark is a real night anchor");
  check(at(0.999).to === "goldenhour" && at(0.999).blend > 0.999,
    "the end of night returns continuously to dawn");
  check(at(0.61).elevation < 12,
    "the dusk key hands off low across the horizon",
    `${at(0.61).elevation.toFixed(2)}° at the midpoint of twilight`);

  console.log("\n=== CONTINUITY ===");
  const continuity = await page.evaluate(() => {
    const T = window.__SF;
    const wrap = (value) => ((value % 1) + 1) % 1;
    const sample = (phase) => {
      T.setDayCycle(wrap(phase), false);
      const a = T.atmos;
      return {
        phase: wrap(phase),
        sun: a.sunDir.toArray(),
        intensity: a.sunIntensity,
        exposure: a.exposure,
        sky: [a.skyZenith, a.skyHigh, a.skyHorizon, a.skyLow]
          .flatMap((color) => color.toArray()),
      };
    };
    return [0, 0.25, 0.5, 0.72].map((edge) => ({
      edge,
      before: sample(edge - 0.0001),
      after: sample(edge + 0.0001),
    }));
  });
  for (const edge of continuity) {
    const angle = angularSeparation(edge.before.sun, edge.after.sun);
    const colorDelta = Math.max(...edge.before.sky.map(
      (value, index) => Math.abs(value - edge.after.sky[index])
    ));
    const exposureDelta = Math.abs(edge.before.exposure - edge.after.exposure);
    check(angle < 0.01 && colorDelta < 0.01 && exposureDelta < 0.01,
      `lighting is continuous through phase ${edge.edge}`,
      `${(angle * 180 / Math.PI).toFixed(3)}° key · ${colorDelta.toFixed(4)} colour · ${exposureDelta.toFixed(4)} exposure`);
  }

  console.log("\n=== CELESTIAL SYSTEM ===");
  const dawnSky = at(0).sky;
  const nightSky = at(0.72).sky;
  const sunGap = angularSeparation(at(0).sunDir, dawnSky.secondSunDir);
  const moonGaps = [
    angularSeparation(nightSky.moonDirs[0], nightSky.moonDirs[1]),
    angularSeparation(nightSky.moonDirs[0], nightSky.moonDirs[2]),
    angularSeparation(nightSky.moonDirs[1], nightSky.moonDirs[2]),
  ];
  check(dawnSky.primarySun === 1 && dawnSky.secondSun > 0.75 && sunGap > 0.16,
    "two resolved suns occupy the daylight sky",
    `${(sunGap * 180 / Math.PI).toFixed(1)}° separation`);
  check(nightSky.moons === 1 && nightSky.stars === 1
      && moonGaps.every((gap) => gap > 0.45),
    "three independently placed moons own the night",
    `${moonGaps.map((gap) => (gap * 180 / Math.PI).toFixed(0)).join("° / ")}° separations`);
  check(nightSky.primarySun === 0 && nightSky.secondSun === 0,
    "the binary suns set instead of glowing through the night");

  console.log("\n=== NATURAL ADVANCE AND WRAP ===");
  const advance = await page.evaluate(() => {
    const T = window.__SF;
    T.setDayCycle(0, true, 0);
    T.advanceTime(270, 0.1);
    const noon = T.dayCycleState();
    T.setDayCycle(0.99, true, 3);
    T.advanceTime(21.6, 0.1);
    const wrapped = T.dayCycleState();
    return { noon, wrapped };
  });
  check(Math.abs(advance.noon.phase - 0.25) < 0.0015 && advance.noon.solarHour === 12,
    "simulation time advances dawn to noon without a mode switch",
    `phase ${advance.noon.phase} · ${advance.noon.solarHour}h`);
  check(Math.abs(advance.wrapped.phase - 0.01) < 0.0015 && advance.wrapped.cycleCount === 4,
    "the 18-minute cycle wraps without a discontinuity",
    `phase ${advance.wrapped.phase} · day ${advance.wrapped.cycleCount + 1}`);

  console.log("\n=== CYCLE COST ===");
  const performanceState = await page.evaluate(() => {
    const T = window.__SF;
    T.setDayCycle(0.37, true, 0);
    T.renderStill();
    const blocks = [];
    for (let block = 0; block < 3; block += 1) {
      const start = performance.now();
      for (let frame = 0; frame < 120; frame += 1) T.renderOnce(1 / 60);
      blocks.push((performance.now() - start) / 120);
    }
    T.advanceTime(15.2, 0.1);
    const longFrameStart = performance.now();
    T.renderStill();
    const longCycleFrame = performance.now() - longFrameStart;
    return { blocks, longCycleFrame, report: T.report() };
  });
  const cycleMedian = performanceState.blocks.slice().sort((a, b) => a - b)[1];
  check(cycleMedian < 12,
    "continuous atmosphere updates stay inside the gameplay frame budget",
    `${cycleMedian.toFixed(2)}ms median · ${performanceState.blocks.map((n) => n.toFixed(2)).join("/")}ms`);
  check(performanceState.longCycleFrame < 20,
    "long-running sky drift has no periodic environment-bake stall",
    `${performanceState.longCycleFrame.toFixed(2)}ms frame after 15 seconds`);

  console.log("\n=== SAVE ROUND-TRIP ===");
  const saveState = await page.evaluate(() => {
    const T = window.__SF;
    T.setDayCycle(0.61, true, 2);
    T.renderStill();
    const snapshot = T.saves.capture();
    T.setDayCycle(0.25, false, 0);
    const loaded = snapshot ? T.saves.apply(snapshot) : false;
    return { snapshot: snapshot?.atmosphere || null, loaded, restored: T.dayCycleState() };
  });
  check(!!saveState.snapshot && saveState.loaded,
    "field saves include a valid atmosphere record",
    JSON.stringify(saveState.snapshot));
  check(Math.abs(saveState.restored.phase - 0.61) < 0.0001
      && saveState.restored.running && saveState.restored.cycleCount === 2,
    "loading resumes the same hour and day",
    JSON.stringify(saveState.restored));

  console.log("\n=== VISUAL PROOF ===");
  const sceneShots = [
    ["01-dawn-gold.png", 0],
    ["02-high-sun.png", 0.25],
    ["03-vespers.png", 0.5],
    ["04-long-dark.png", 0.72],
  ];
  for (const [name, phase] of sceneShots) {
    await page.evaluate((nextPhase) => {
      const T = window.__SF;
      T.studio(false);
      T.hidePlayer(false);
      T.setDayCycle(nextPhase, false);
      T.setPose("road");
      T.renderStill();
    }, phase);
    const bytes = await writeCapture(page, name);
    check(bytes > 20000, `${name} is a nonblank canvas capture`, `${bytes} bytes`);
  }

  const skyShots = [
    ["05-binary-suns.png", 0, "secondSunDir", 44],
    ["06-ringed-cathedral-moon.png", 0.72, "moon0", 38],
    ["07-ice-moon.png", 0.72, "moon1", 34],
    ["08-rust-moon.png", 0.72, "moon2", 34],
  ];
  for (const [name, phase, target, fov] of skyShots) {
    await page.evaluate(({ nextPhase, targetKey, nextFov }) => {
      const T = window.__SF;
      T.studio(true);
      T.hidePlayer(true);
      T.setDayCycle(nextPhase, false);
      T.renderOnce(0.3);
      const sky = T.sky.status();
      const direction = targetKey === "secondSunDir"
        ? sky.secondSunDir : sky.moonDirs[Number(targetKey.slice(-1))];
      const position = [0, 120, 0];
      const targetPosition = position.map((value, index) => value + direction[index] * 100);
      T.lookAt(position, targetPosition, nextFov);
      T.renderStill();
    }, { nextPhase: phase, targetKey: target, nextFov: fov });
    const bytes = await writeCapture(page, name);
    check(bytes > 14000, `${name} renders authored sky detail`, `${bytes} bytes`);
  }

  check(pageErrors.length === 0, "no page errors", pageErrors.slice(0, 2).join(" | "));
  check(consoleErrors.length === 0, "no console or shader errors", consoleErrors.slice(0, 2).join(" | "));

  const report = { checks, passed: checks - failures.length, failed: failures.length,
    failures, samples, advance, saveState, pageErrors, consoleErrors };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed}/${report.checks} checks passed`);
  await browser.close();
  process.exitCode = failures.length ? 1 : 0;
} finally {
  server.kill("SIGTERM");
}
