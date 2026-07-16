import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mansionPath = path.join(root, "assets/js/mr-feast-mansion.js");
const tuningPath = path.join(root, "scripts/tune-mr-feast-animations.mjs");
const manifestPath = path.join(root, "assets/models/mr-feast/mr-feast-asset-manifest.json");
const mansion = await readFile(mansionPath, "utf8");
const tuning = await readFile(tuningPath, "utf8");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const port = Number(process.env.MR_FEAST_GAIT_TEST_PORT || (43000 + (process.pid % 18000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1&view=mrFeastGaitSide`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-grounded-gait");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function range(values) {
  return Math.max(...values) - Math.min(...values);
}

function trajectoryMetrics(samples, key) {
  const points = samples.map((sample) => sample[key]);
  const lateral = range(points.map((point) => point.x));
  const forward = range(points.map((point) => point.z));
  return {
    lateral,
    forward,
    angleDegrees: Math.atan2(lateral, Math.max(0.000001, forward)) * 180 / Math.PI,
  };
}

function plantedIntervals(samples, key, fps = 60) {
  const points = samples.map((sample) => sample[key]);
  const rootStart = samples[0].root;
  const rootEnd = samples[samples.length - 1].root;
  const rootTravel = Math.hypot(rootEnd.x - rootStart.x, rootEnd.z - rootStart.z) || 1;
  const forwardX = (rootEnd.x - rootStart.x) / rootTravel;
  const forwardZ = (rootEnd.z - rootStart.z) / rootTravel;
  const lateralCoordinate = (point) => -point.x * forwardZ + point.z * forwardX;
  const minimumY = Math.min(...points.map((point) => point.y));
  const grounded = points.map((point, index) => {
    if (index === 0) return false;
    const verticalSpeed = Math.abs(point.y - points[index - 1].y) * fps;
    return point.y <= minimumY + 0.025 && verticalSpeed <= 0.2;
  });
  const intervals = [];
  let start = null;
  for (let index = 0; index <= grounded.length; index += 1) {
    if (grounded[index] && start == null) start = index;
    if ((!grounded[index] || index === grounded.length) && start != null) {
      const end = index - 1;
      if ((end - start + 1) / fps >= 0.12) {
        const window = points.slice(start, end + 1);
        const origin = window[0];
        const horizontalDrift = Math.max(...window.map((point) => Math.hypot(point.x - origin.x, point.z - origin.z)));
        intervals.push({
          start,
          end,
          seconds: (end - start + 1) / fps,
          horizontalDrift,
          lateralDrift: range(window.map(lateralCoordinate)),
        });
      }
      start = null;
    }
  }
  return intervals;
}

async function serverResponds() {
  try {
    return (await fetch(`${baseUrl}/games/mr-feast-mansion.html`, { cache: "no-store" })).ok;
  } catch (_) {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await serverResponds()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function run() {
  assert(/movementAlignment:\s*0\.985/.test(mansion), "Mr. Feast needs a named 0.985 movement/facing alignment gate");
  assert((mansion.match(/facingAlignment < MR_FEAST_NPC\.movementAlignment/g) || []).length === 2, "patrol and camera response must share the named alignment gate");
  assert(/const STALK_LOCOMOTION_BONES\s*=\s*new Set/.test(tuning) && /profile === "stalk" && STALK_LOCOMOTION_BONES\.has\(boneName\)/.test(tuning), "stalk tuning must preserve the source pelvis and lower-body rotation chain");
  assert(manifest.animations?.stalk?.playbackRate >= 0.36 && manifest.animations?.stalk?.playbackRate <= 0.39, `patrol stalk playback should be stride-calibrated; found ${manifest.animations?.stalk?.playbackRate}`);

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }
  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico|fonts\.googleapis|fonts\.gstatic/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready && window.MrFeastFresh?.getMrFeastState?.().loaded, null, { timeout: 120000 });

    const poseSamples = await page.evaluate(() => {
      const initial = window.MrFeastFresh.getMrFeastState();
      const duration = initial.clipDurations.stalk;
      const samples = [];
      for (let index = 0; index <= 48; index += 1) {
        const phase = index / 48;
        const state = window.MrFeastFresh.setMrFeastPoseForQA({
          action: "stalk",
          time: duration * phase,
          x: 0,
          y: 0,
          z: -9,
          yaw: 0,
        });
        samples.push({
          phase,
          leftFoot: state.liveBones.leftFoot,
          rightFoot: state.liveBones.rightFoot,
          leftToe: state.liveBones.leftToe,
          rightToe: state.liveBones.rightToe,
        });
      }
      return samples;
    });
    assert(poseSamples.every((sample) => sample.leftFoot && sample.rightFoot && sample.leftToe && sample.rightToe), "gait diagnostics must expose both foot and toe positions");
    const trajectoryByBone = {};
    for (const [name, key] of [["left", "leftToe"], ["right", "rightToe"]]) {
      const metrics = trajectoryMetrics(poseSamples, key);
      trajectoryByBone[key] = metrics;
      assert(metrics.angleDegrees <= 10, `${name} toe travels diagonally at ${metrics.angleDegrees.toFixed(2)} degrees`);
      assert(metrics.forward >= 0.85 && metrics.forward <= 1.25, `${name} toe forward excursion ${metrics.forward.toFixed(3)}m is not a grounded stalk stride`);
      assert(metrics.lateral / metrics.forward <= 0.10, `${name} toe lateral/forward ratio ${(metrics.lateral / metrics.forward).toFixed(3)} exceeds 0.10`);
    }
    for (const [name, key] of [["left", "leftFoot"], ["right", "rightFoot"]]) {
      const metrics = trajectoryMetrics(poseSamples, key);
      trajectoryByBone[key] = metrics;
      assert(metrics.angleDegrees <= 10, `${name} foot travels diagonally at ${metrics.angleDegrees.toFixed(2)} degrees`);
      assert(metrics.forward >= 0.85 && metrics.forward <= 1.10, `${name} foot forward excursion ${metrics.forward.toFixed(3)}m is outside the grounded gait range`);
      assert(metrics.lateral / metrics.forward <= 0.10, `${name} foot lateral/forward ratio ${(metrics.lateral / metrics.forward).toFixed(3)} exceeds 0.10`);
    }
    console.log(`Gait trajectory metrics: ${JSON.stringify(trajectoryByBone)}`);

    const straightProbe = await page.evaluate(() => window.MrFeastFresh.runMrFeastLocomotionProbeForQA({
      sourceId: "main-dining-south",
      targetId: "main-dining-west",
      seconds: 9,
      settleSeconds: 0.8,
    }));
    assert(straightProbe.samples.length > 300, "straight gait probe did not collect enough fixed-step samples");
    const movingSamples = straightProbe.samples.filter((sample) => sample.distance > 0.00001);
    assert(movingSamples.length > 0 && movingSamples.every((sample) => sample.travelFacingAngleDeg <= 10), "Mr. Feast translated before facing within 10 degrees of travel");
    assert(straightProbe.patrolPlaybackRate >= 0.36 && straightProbe.patrolPlaybackRate <= 0.39, `patrol playback ${straightProbe.patrolPlaybackRate} is not stride-calibrated`);
    assert(straightProbe.responsePlaybackRate >= 0.62 && straightProbe.responsePlaybackRate <= 0.67, `response playback ${straightProbe.responsePlaybackRate} does not scale with response speed`);
    for (const key of ["leftToe", "rightToe"]) {
      const intervals = plantedIntervals(straightProbe.samples, key);
      assert(intervals.length >= 2, `${key} did not produce repeated planted intervals`);
      assert(intervals.every((interval) => interval.horizontalDrift <= 0.07), `${key} planted drift exceeded 0.07m: ${JSON.stringify(intervals)}`);
      assert(intervals.every((interval) => interval.lateralDrift <= 0.04), `${key} planted lateral drift exceeded 0.04m: ${JSON.stringify(intervals)}`);
    }

    const responseProbe = await page.evaluate(() => window.MrFeastFresh.runMrFeastLocomotionProbeForQA({
      mode: "response",
      sourceId: "main-dining-south",
      targetId: "main-dining-west",
      seconds: 4,
      settleSeconds: 0.5,
    }));
    const responseMovingSamples = responseProbe.samples.filter((sample) => sample.distance > 0.00001);
    assert(responseProbe.mode === "response" && responseMovingSamples.length > 120, "camera-response locomotion probe did not exercise the real response path");
    assert(responseMovingSamples.every((sample) => Math.abs(sample.distance * 60 - 1.08) <= 0.02), "camera-response root speed is no longer 1.08m/s");
    assert(responseMovingSamples.every((sample) => sample.action === "stalk" && sample.playbackRate >= 0.62 && sample.playbackRate <= 0.67), "camera-response action did not run at the stride-scaled playback rate");

    const turnProbe = await page.evaluate(() => window.MrFeastFresh.runMrFeastLocomotionProbeForQA({
      sourceId: "main-dining-east",
      targetId: "main-dining-south",
      initialFromId: "main-ballroom-west",
      seconds: 2,
      settleSeconds: 0,
    }));
    const translatingTurnSamples = turnProbe.samples.filter((sample) => sample.distance > 0.00001);
    assert(translatingTurnSamples.length > 0 && translatingTurnSamples.every((sample) => sample.travelFacingAngleDeg <= 10), "corner probe still permits diagonal translation");

    await page.evaluate(() => {
      window.MrFeastFresh.teleport("mrFeastGaitTurnSide");
      const source = { x: -5.8, z: -6 };
      const incoming = { x: -3.2, z: -9.2 };
      window.MrFeastFresh.setMrFeastPoseForQA({
        action: "idle",
        time: 0,
        x: source.x,
        y: 0,
        z: source.z,
        yaw: Math.atan2(source.x - incoming.x, source.z - incoming.z),
      });
    });
    await page.waitForTimeout(80);
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "corner-pivot-start.png") });
    await page.evaluate(() => window.MrFeastFresh.runMrFeastLocomotionProbeForQA({
      sourceId: "main-dining-east",
      targetId: "main-dining-south",
      initialFromId: "main-ballroom-west",
      seconds: 2,
      stopAfterFirstTranslationFrames: 4,
    }));
    await page.waitForTimeout(80);
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "corner-first-planted-steps.png") });

    for (const [label, phase] of [["00", 0], ["25", 0.25], ["50", 0.5], ["75", 0.75]]) {
      await page.evaluate(({ phase }) => {
        window.MrFeastFresh.teleport("mrFeastGaitSide");
        const duration = window.MrFeastFresh.getMrFeastState().clipDurations.stalk;
        window.MrFeastFresh.setMrFeastPoseForQA({ action: "stalk", time: duration * phase, x: 0, y: 0, z: -9, yaw: 0 });
      }, { phase });
      await page.waitForTimeout(80);
      await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, `grounded-stalk-${label}.png`) });
    }
    assert(errors.length === 0, `browser console errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast grounded gait browser test: forward leg plane, calibrated cadence, planted-foot drift, aligned cornering, and visual sequence passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast grounded gait test failed: ${error.message}`);
  process.exitCode = 1;
});
