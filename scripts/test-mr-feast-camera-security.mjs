import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_CAMERA_TEST_PORT || (47000 + (process.pid % 14000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-camera-security");

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function screenshotStage(page, fileName) {
  const clip = await page.locator("#mansion-stage").boundingBox();
  assert(clip?.width > 0 && clip?.height > 0, `cannot capture ${fileName}: mansion stage has no bounds`);
  return page.screenshot({
    path: path.join(artifactDir, fileName),
    clip,
    animations: "disabled",
  });
}

async function configureCameraScenario(page, { cameraId, mode, sweep = 0, distance = 4, occluded = false }) {
  return page.evaluate(({ cameraId: id, mode: policy, sweep: normalized, distance: laneDistance, occluded: blocked }) => {
    window.MrFeastFresh.resetCameraSecurityForQA(policy);
    window.MrFeastFresh.setCameraSoloForQA(id);
    window.MrFeastFresh.setCameraSweepForQA(id, normalized);
    window.MrFeastFresh.setCameraOccludedForQA(id, blocked);
    window.MrFeastFresh.placePlayerInCameraLaneForQA(id, { distance: laneDistance });
    return window.MrFeastFresh.getCameraSecurityState();
  }, { cameraId, mode, sweep, distance, occluded });
}

async function advanceSecurity(page, seconds) {
  return page.evaluate((duration) => window.MrFeastFresh.advanceCameraSecurityForQA(duration), seconds);
}

async function countFixtureIndicatorPixels(page, label) {
  const screenshot = await screenshotStage(page, `camera-indicator-${label}.png`);
  const metadata = await sharp(screenshot).metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const region = {
    left: Math.floor(width * 0.38),
    top: Math.floor(height * 0.06),
    width: Math.max(1, Math.floor(width * 0.24)),
    height: Math.max(1, Math.floor(height * 0.3)),
  };
  const { data, info } = await sharp(screenshot).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let green = 0;
  let red = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    if (g > 145 && g > r * 1.08 && g > b * 1.02) green += 1;
    if (r > 160 && r > g * 1.2 && r > b * 1.08) red += 1;
  }
  return { green, red, region };
}

async function run() {
  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
    });
    await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.waitForTimeout(1200);

    let state = await diagnostics(page);
    assert(state.security, "render_game_to_text() should expose the camera-security system");
    assert(state.security.mode === "show", `fresh security policy should start in show mode; security=${JSON.stringify(state.security)}`);
    assert(state.security.cameras.total === 32, `removing both Workroom cameras should leave 32 public cameras; total=${state.security.cameras.total}`);
    assert(state.security.cameras.indoors === 24 && state.security.cameras.outdoors === 8, `camera coverage should retain 24 interior and eight grounds units; cameras=${JSON.stringify(state.security.cameras)}`);
    for (const safeZone of ["MAIN HALL BATHROOM", "UPPER GRAND BATHROOM", "COAT CLOSET", "WORKROOM"]) {
      assert(state.security.cameras.exemptZones.includes(safeZone), `intentional camera-free zone is missing: ${safeZone}`);
      assert(!state.security.cameras.coveredZones.includes(safeZone), `safe zone should not contain a camera: ${safeZone}`);
    }
    for (const coveredZone of ["FRONT FOYER", "BALLROOM", "FRONT DRIVE", "FORMAL GARDEN", "REAR LAWN"]) {
      assert(state.security.cameras.coveredZones.includes(coveredZone), `major camera coverage is missing: ${coveredZone}`);
    }

    const mainCamera = state.security.qa.mainCameraId;
    const basementCamera = state.security.qa.basementCameraId;
    assert(mainCamera && basementCamera, `QA camera anchors are missing; qa=${JSON.stringify(state.security.qa)}`);
    assert(state.security.tuning.scanMinimumSeconds >= 10 && state.security.tuning.scanMaximumSeconds > state.security.tuning.scanMinimumSeconds, `camera one-way sweeps should be deliberately slow; tuning=${JSON.stringify(state.security.tuning)}`);
    assert(state.security.tuning.warningPulseCount === 3 && state.security.tuning.trackingThreshold > 0.5 && state.security.tuning.trackingThreshold < 1, `camera warning/tracking tuning should provide three pulses before alarm; tuning=${JSON.stringify(state.security.tuning)}`);
    assert(state.security.tuning.warningSeconds >= 2 && state.security.tuning.trackingGraceSeconds >= 1.5 && state.security.tuning.exposureSeconds >= state.security.tuning.warningSeconds + state.security.tuning.trackingGraceSeconds, `warning and solid-red tracking phases need readable real-time durations; tuning=${JSON.stringify(state.security.tuning)}`);
    assert(
      state.security.tuning.lastSeenRefreshSeconds <= 1
        && state.security.tuning.lastSeenRetargetMeters <= 1
        && state.security.tuning.searchPatrolSeconds >= 180
        && state.security.tuning.searchPatrolRadiusMeters >= 8
        && state.security.tuning.searchPatrolPauseSeconds >= 3
        && state.security.tuning.searchPatrolMaximumNodes >= 8
        && state.security.tuning.searchAwarenessCheckSeconds <= 0.25,
      `camera alarms need frequent final-position refresh, a broad three-minute sweep, and personal reacquisition; tuning=${JSON.stringify(state.security.tuning)}`,
    );
    const securityDetails = await page.evaluate(() => window.MrFeastFresh.getCameraSecurityState());
    const indoorMounts = securityDetails.cameras.details.filter((entry) => !entry.outdoors);
    const cameraById = new Map(securityDetails.cameras.details.map((entry) => [entry.id, entry]));
    assert(!cameraById.has("cam-main-stair"), "the duplicate camera behind the grand-stair mid-landing should be removed");
    assert(!cameraById.has("cam-basement-workroom-west") && !cameraById.has("cam-basement-workroom-east"), "the Workroom should contain no public security cameras");
    const readingCamera = cameraById.get("cam-upper-reading");
    assert(readingCamera && Math.abs(Math.abs(readingCamera.baseYaw) - Math.PI) < 0.001, `Reading Room camera should face north into the room from its south-wall mount; camera=${JSON.stringify(readingCamera)}`);
    const poolCamera = cameraById.get("cam-yard-pool");
    assert(poolCamera?.mount === "post" && poolCamera.support === "post", `pool camera should be visibly attached to a dedicated support post; camera=${JSON.stringify(poolCamera)}`);
    assert(indoorMounts.every((entry) => entry.mount === "wall-center" && entry.wallCentered), `every indoor camera should be centered on one wall rather than tucked into a corner; offenders=${JSON.stringify(indoorMounts.filter((entry) => entry.mount !== "wall-center" || !entry.wallCentered))}`);
    assert(indoorMounts.every((entry) => {
      const cardinal = Math.PI / 2;
      return Math.abs(entry.baseYaw / cardinal - Math.round(entry.baseYaw / cardinal)) < 0.001;
    }), `indoor camera mounts should face cardinally away from their centered wall; mounts=${JSON.stringify(indoorMounts)}`);
    const ceilingUndersideByFloor = new Map([
      [-3.8, -0.24],
      [0, 4.26],
      [4.5, 7.8],
    ]);
    const detachedIndoorMounts = indoorMounts.filter((entry) => {
      const ceilingY = ceilingUndersideByFloor.get(entry.floorY);
      return !Number.isFinite(ceilingY) || Math.abs((entry.position.y + 0.09) - ceilingY) > 0.011;
    });
    assert(detachedIndoorMounts.length === 0, `indoor camera brackets should meet their floor's ceiling underside; offenders=${JSON.stringify(detachedIndoorMounts)}`);
    const initialLightLayout = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    const cameraMeshes = await page.evaluate(() => window.MrFeastFresh.inspectScene("security-camera-"));
    assert(cameraMeshes.count >= 4, `shared camera presentation meshes should exist; scene=${JSON.stringify(cameraMeshes)}`);

    const scanProbe = await page.evaluate((id) => {
      window.MrFeastFresh.resetCameraSecurityForQA("show");
      window.MrFeastFresh.setCameraSoloForQA(id);
      const samples = [];
      for (let step = 0; step < 360; step += 1) {
        const security = window.MrFeastFresh.advanceCameraSecurityForQA(0.1);
        const camera = security.cameras.details.find((entry) => entry.id === id);
        samples.push({ yaw: camera.yaw, sweep: camera.sweepNormalized, direction: camera.scanDirection });
      }
      return {
        minYaw: Math.min(...samples.map((sample) => sample.yaw)),
        maxYaw: Math.max(...samples.map((sample) => sample.yaw)),
        minSweep: Math.min(...samples.map((sample) => sample.sweep)),
        maxSweep: Math.max(...samples.map((sample) => sample.sweep)),
        directions: [...new Set(samples.map((sample) => sample.direction))],
      };
    }, mainCamera);
    assert(scanProbe.maxYaw - scanProbe.minYaw > 0.35, `camera should visibly scan across its authored arc; scan=${JSON.stringify(scanProbe)}`);
    assert(scanProbe.minSweep >= -1 && scanProbe.maxSweep <= 1, `camera sweep must remain clamped to its authored endpoints; scan=${JSON.stringify(scanProbe)}`);
    assert(scanProbe.directions.length === 2, `camera should reverse at a left/right endpoint; scan=${JSON.stringify(scanProbe)}`);
    await page.evaluate(() => {
      window.MrFeastFresh.resetCameraSecurityForQA("show");
      window.MrFeastFresh.teleport("yardGateEastSeam");
    });
    await page.waitForTimeout(120);
    await screenshotStage(page, "camera-yard-gate-desktop.png");

    await configureCameraScenario(page, { cameraId: mainCamera, mode: "show", sweep: 0, occluded: true });
    await advanceSecurity(page, 0.2);
    state = await diagnostics(page);
    assert(!state.security.observed, `steady green fixture check needs a clear non-detection state; security=${JSON.stringify(state.security)}`);
    const greenIndicatorPixels = await countFixtureIndicatorPixels(page, "green-desktop");
    assert(greenIndicatorPixels.green >= 20, `steady green fixture LED should be visibly readable in the rendered camera housing; pixels=${JSON.stringify(greenIndicatorPixels)}`);

    await configureCameraScenario(page, { cameraId: mainCamera, mode: "show", sweep: 0 });
    await page.evaluate((id) => window.MrFeastFresh.setCameraOccludedForQA(id, null), mainCamera);
    await advanceSecurity(page, state.security.tuning.warningSeconds + 0.2);
    state = await diagnostics(page);
    assert(state.security.observed && state.security.permitted, `ordinary show-space filming should be visible but permitted; security=${JSON.stringify(state.security)}`);
    assert(state.security.exposure === 0 && state.security.alarm.count === 0, "permitted filming must not build suspicion or raise an alarm");
    const permittedCamera = await page.evaluate((id) => window.MrFeastFresh.getCameraSecurityState().cameras.details.find((entry) => entry.id === id), mainCamera);
    assert(permittedCamera.trackingPlayer && permittedCamera.indicator === "tracking-red", `a permitted show camera should still visibly acquire and follow its filmed subject without alarming; camera=${JSON.stringify(permittedCamera)}`);
    await screenshotStage(page, "camera-permitted-tracking-desktop.png");
    const permittedYawBefore = permittedCamera.yaw;
    await page.evaluate((id) => window.MrFeastFresh.placePlayerInCameraLaneForQA(id, { distance: 4, lateral: -1.5 }), mainCamera);
    await advanceSecurity(page, 0.6);
    const permittedTrackedCamera = await page.evaluate((id) => window.MrFeastFresh.getCameraSecurityState().cameras.details.find((entry) => entry.id === id), mainCamera);
    state = await diagnostics(page);
    assert(permittedTrackedCamera.trackingPlayer && Math.abs(permittedTrackedCamera.yaw - permittedYawBefore) > 0.08 && state.security.alarm.count === 0, `permitted camera should follow room movement without raising an alarm; before=${permittedYawBefore} after=${JSON.stringify(permittedTrackedCamera)}`);
    await page.evaluate((id) => window.MrFeastFresh.setCameraOccludedForQA(id, null), mainCamera);
    await advanceSecurity(page, 0.25);
    state = await diagnostics(page);
    assert(state.security.observed && !state.security.occludedBy, `the real foyer sightline should remain open without a synthetic LOS override; security=${JSON.stringify(state.security)}`);

    await configureCameraScenario(page, { cameraId: mainCamera, mode: "lockdown", sweep: 1 });
    await advanceSecurity(page, 2);
    state = await diagnostics(page);
    assert(!state.security.observed && state.security.exposure === 0 && state.security.alarm.count === 0, `a player in the lane should pass while the camera faces away; security=${JSON.stringify(state.security)}`);
    await page.evaluate((id) => window.MrFeastFresh.placePlayerInCameraLaneForQA(id, {
      distance: 4,
      lateral: -1.5,
      yaw: -Math.PI / 2,
    }), mainCamera);
    await page.keyboard.down("w");
    const blindCrossing = await page.evaluate(() => {
      let maxExposure = 0;
      let observed = false;
      for (let step = 0; step < 14; step += 1) {
        window.MrFeastFresh.advancePlayerForQA(0.1);
        const security = window.MrFeastFresh.advanceCameraSecurityForQA(0.1);
        maxExposure = Math.max(maxExposure, security.exposure);
        observed ||= security.observed;
      }
      const state = JSON.parse(window.render_game_to_text());
      return { maxExposure, observed, alarms: state.security.alarm.count, x: state.player.x };
    });
    await page.keyboard.up("w");
    assert(blindCrossing.x > 1.2 && !blindCrossing.observed && blindCrossing.maxExposure === 0 && blindCrossing.alarms === 0, `the player should physically cross the blind side without detection; crossing=${JSON.stringify(blindCrossing)}`);

    await page.evaluate((id) => window.MrFeastFresh.setCameraSweepForQA(id, 0), mainCamera);
    await page.evaluate((id) => window.MrFeastFresh.placePlayerInCameraLaneForQA(id, { distance: 4 }), mainCamera);
    await page.evaluate((id) => window.MrFeastFresh.setCameraOccludedForQA(id, null), mainCamera);
    const warningProbe = await page.evaluate((id) => {
      const samples = [];
      for (let step = 0; step < 60; step += 1) {
        const security = window.MrFeastFresh.advanceCameraSecurityForQA(0.08);
        const camera = security.cameras.details.find((entry) => entry.id === id);
        samples.push({
          indicator: camera.indicator,
          pulse: camera.warningPulseIndex,
          tracking: camera.trackingPlayer,
          exposure: security.exposure,
          alarms: security.alarm.count,
        });
        if (camera.indicator === "tracking-red") break;
      }
      return samples;
    }, mainCamera);
    const warnedPulses = new Set(warningProbe.filter((sample) => sample.indicator === "warning-red").map((sample) => sample.pulse));
    assert(warningProbe[0]?.indicator === "warning-red" || warningProbe.some((sample) => sample.indicator === "warning-green"), `hostile acquisition should visibly pulse between red and green; warning=${JSON.stringify(warningProbe)}`);
    assert(warnedPulses.size === 3, `camera should give exactly three visible red warning pulses before solid lock; warning=${JSON.stringify(warningProbe)}`);
    await configureCameraScenario(page, { cameraId: mainCamera, mode: "lockdown", sweep: 0 });
    await page.evaluate((id) => window.MrFeastFresh.setCameraOccludedForQA(id, null), mainCamera);
    for (let step = 0; step < 12; step += 1) {
      const indicator = await page.evaluate((id) => {
        const security = window.MrFeastFresh.advanceCameraSecurityForQA(0.1);
        return security.cameras.details.find((entry) => entry.id === id).indicator;
      }, mainCamera);
      if (indicator === "warning-red") break;
    }
    const redIndicatorPixels = await countFixtureIndicatorPixels(page, "warning-red-desktop");
    assert(redIndicatorPixels.red >= 24, `warning-red fixture LED should be visibly readable before lock-on; pixels=${JSON.stringify(redIndicatorPixels)}`);
    await configureCameraScenario(page, { cameraId: mainCamera, mode: "lockdown", sweep: 0 });
    await page.evaluate((id) => window.MrFeastFresh.setCameraOccludedForQA(id, null), mainCamera);
    let trackingElapsed = 0;
    let trackingState = null;
    while (trackingElapsed < 6) {
      trackingState = await advanceSecurity(page, 0.1);
      trackingElapsed += 0.1;
      const cameraState = trackingState.cameras.details.find((entry) => entry.id === mainCamera);
      if (cameraState.indicator === "tracking-red") break;
    }
    assert(trackingElapsed >= 2 && trackingState?.alarm.count === 0, `warning pulses should leave an observable pre-alarm interval before tracking; elapsed=${trackingElapsed} security=${JSON.stringify(trackingState)}`);
    await screenshotStage(page, "camera-solid-red-tracking-desktop.png");
    const trackingSample = warningProbe.find((sample) => sample.indicator === "tracking-red");
    assert(trackingSample?.tracking || trackingState?.cameras.details.find((entry) => entry.id === mainCamera)?.trackingPlayer, `solid red tracking should begin before the alarm so the player still has time to escape; warning=${JSON.stringify(warningProbe)}`);
    const trackingYawBefore = (await page.evaluate((id) => window.MrFeastFresh.getCameraSecurityState().cameras.details.find((entry) => entry.id === id).yaw, mainCamera));
    await page.evaluate((id) => window.MrFeastFresh.placePlayerInCameraLaneForQA(id, { distance: 4, lateral: 1.5 }), mainCamera);
    await advanceSecurity(page, 0.6);
    const trackedCamera = await page.evaluate((id) => window.MrFeastFresh.getCameraSecurityState().cameras.details.find((entry) => entry.id === id), mainCamera);
    state = await diagnostics(page);
    assert(trackedCamera.trackingPlayer && trackedCamera.indicator === "tracking-red" && Math.abs(trackedCamera.yaw - trackingYawBefore) > 0.08 && state.security.alarm.count === 0, `solid-red camera should visibly follow player movement during a pre-alarm grace window; before=${trackingYawBefore} after=${JSON.stringify(trackedCamera)} alarm=${JSON.stringify(state.security.alarm)}`);
    await configureCameraScenario(page, { cameraId: mainCamera, mode: "lockdown", sweep: 0 });
    await advanceSecurity(page, 0.55);
    state = await diagnostics(page);
    assert(state.security.observed && state.security.exposure > 0 && state.security.exposure < 1, `facing-toward exposure should build through a grace period; security=${JSON.stringify(state.security)}`);
    await advanceSecurity(page, 5);
    state = await diagnostics(page);
    assert(state.security.alarm.count === 1 && state.security.mode === "lockdown", `sustained hostile exposure should raise one alarm; security=${JSON.stringify(state.security)}`);
    const firstAlarmPosition = { ...state.security.alarm.last.lastSeen };
    await page.evaluate((id) => window.MrFeastFresh.placePlayerInCameraLaneForQA(id, {
      distance: 4,
      lateral: 1.35,
    }), mainCamera);
    await advanceSecurity(page, 1.2);
    state = await diagnostics(page);
    const refreshedAlarmPosition = state.security.alarm.last.lastSeen;
    assert(
      state.security.alarm.count === 1
        && state.security.alarm.last.trackingRefreshCount >= 1
        && Math.hypot(
          refreshedAlarmPosition.x - firstAlarmPosition.x,
          refreshedAlarmPosition.z - firstAlarmPosition.z,
        ) >= state.security.tuning.lastSeenRetargetMeters,
      `one latched alarm must keep the final recorded position current without spamming alarm count; first=${JSON.stringify(firstAlarmPosition)} refreshed=${JSON.stringify(state.security.alarm.last)}`,
    );
    await advanceSecurity(page, 3);
    state = await diagnostics(page);
    assert(state.security.alarm.count === 1, `one continuous camera sighting should stay latched instead of spamming alarms; alarm=${JSON.stringify(state.security.alarm)}`);

    await configureCameraScenario(page, { cameraId: mainCamera, mode: "lockdown", sweep: 0 });
    await advanceSecurity(page, 0.5);
    const standingExposure = (await diagnostics(page)).security.exposure;
    await configureCameraScenario(page, { cameraId: mainCamera, mode: "lockdown", sweep: 0 });
    await page.keyboard.press("c");
    await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.2));
    await advanceSecurity(page, 0.5);
    state = await diagnostics(page);
    const crouchedExposure = state.security.exposure;
    assert(state.player.movement.stealth.visibilityMultiplier === 0.5, "camera regression should consume Milestone 35's authoritative crouch visibility multiplier");
    assert(crouchedExposure > 0 && crouchedExposure < standingExposure * 0.7, `crouching should materially slow camera exposure; standing=${standingExposure} crouched=${crouchedExposure}`);
    await page.keyboard.press("c");
    await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(0.2));

    await configureCameraScenario(page, { cameraId: mainCamera, mode: "lockdown", sweep: 0 });
    await page.evaluate(() => window.MrFeastFresh.setCameraPlayerHiddenForQA(true));
    await advanceSecurity(page, 2);
    state = await diagnostics(page);
    assert(state.hidden && !state.security.observed && state.security.exposure === 0 && state.security.alarm.count === 0, `an active hiding state should be fully camera-safe; security=${JSON.stringify(state.security)}`);
    await page.evaluate(() => window.MrFeastFresh.setCameraPlayerHiddenForQA(false));

    await configureCameraScenario(page, { cameraId: mainCamera, mode: "show", sweep: 0 });
    await advanceSecurity(page, 0.15);
    await page.evaluate(() => window.MrFeastFresh.setCameraIllegalActionForQA("qa-sabotage"));
    await advanceSecurity(page, 0.15);
    state = await diagnostics(page);
    assert(state.security.alarm.count === 1 && state.security.alarm.last?.reason === "observed-sabotage", `tagged sabotage in permitted view should alarm immediately; alarm=${JSON.stringify(state.security.alarm)}`);

    await configureCameraScenario(page, { cameraId: basementCamera, mode: "restricted", sweep: 0 });
    await advanceSecurity(page, 5.4);
    state = await diagnostics(page);
    assert(state.security.alarm.count === 1 && state.security.alarm.last?.reason === "restricted-trespass", `unlocked-basement camera exposure should be trespassing; security=${JSON.stringify(state.security)}`);

    await configureCameraScenario(page, { cameraId: mainCamera, mode: "restricted", sweep: 0 });
    await advanceSecurity(page, 2);
    state = await diagnostics(page);
    assert(state.security.permitted && state.security.alarm.count === 0, "restricted mode should continue allowing normal filming outside the basement");

    await page.evaluate(() => {
      window.MrFeastFresh.resetCameraSecurityForQA(null);
      window.MrFeastFresh.setCameraStoryStateForQA({ basementUnlocked: true, relaySabotaged: false });
    });
    state = await diagnostics(page);
    assert(state.security.mode === "restricted", `basement unlock should derive restricted policy; security=${JSON.stringify(state.security)}`);
    await page.evaluate(() => window.MrFeastFresh.setCameraStoryStateForQA({ relaySabotaged: true }));
    state = await diagnostics(page);
    assert(state.security.mode === "lockdown", "patron-feed sabotage should derive global lockdown while public cameras remain active");

    await configureCameraScenario(page, { cameraId: mainCamera, mode: "lockdown", sweep: 0, occluded: true });
    await advanceSecurity(page, 2);
    state = await diagnostics(page);
    assert(!state.security.observed && state.security.exposure === 0 && state.security.alarm.count === 0, `an occluder should fully interrupt camera sight; security=${JSON.stringify(state.security)}`);
    await page.evaluate((id) => window.MrFeastFresh.setCameraOccludedForQA(id, false), mainCamera);
    await advanceSecurity(page, 5);
    state = await diagnostics(page);
    assert(state.security.alarm.count === 1, "clearing the same sightline should restore detection");

    const partitionCamera = "cam-basement-cross";
    await configureCameraScenario(page, { cameraId: partitionCamera, mode: "lockdown", sweep: 0, occluded: false });
    await page.evaluate((id) => window.MrFeastFresh.setCameraOccludedForQA(id, null), partitionCamera);
    await advanceSecurity(page, 0.3);
    state = await diagnostics(page);
    assert(!state.security.observed && state.security.occludedBy, `a real basement partition should block the cross-corridor camera; security=${JSON.stringify(state.security)}`);

    await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loadStatus === "ready", null, { timeout: 120000 });
    await page.evaluate((id) => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.resetCameraSecurityForQA("show");
      window.MrFeastFresh.setCameraSoloForQA(id);
      window.MrFeastFresh.setCameraSweepForQA(id, 0);
      window.MrFeastFresh.setCameraOccludedForQA(id, false);
      window.MrFeastFresh.placePlayerInCameraLaneForQA(id, { distance: 4, lateral: 1.2 });
      window.MrFeastFresh.triggerCameraAlarmForQA(id, "qa-investigation");
      window.MrFeastFresh.setCameraPlayerHiddenForQA(true);
    }, mainCamera);
    state = await diagnostics(page);
    assert(state.mrFeast.security.state === "responding", `camera alarm should divert Mr. Feast from patrol; mrFeast=${JSON.stringify(state.mrFeast.security)}`);
    const expectedLastSeen = { ...state.security.alarm.last.lastSeen };
    const arrivalProbe = await page.evaluate(() => window.MrFeastFresh.runMrFeastCameraResponseForQA(45));
    const searchingHost = await page.evaluate(() => window.MrFeastFresh.getMrFeastState());
    assert(
      !arrivalProbe.completed
        && arrivalProbe.search?.arrivedLastSeen
        && arrivalProbe.search.minimumDistanceToLastSeen <= 0.5
        && arrivalProbe.search.elapsedSeconds > 0
        && arrivalProbe.search.plannedNodeCount >= 8
        && arrivalProbe.search.plannedZoneCount >= 2
        && searchingHost.security?.state === "searching"
        && searchingHost.security.searchRemaining > 120,
      `Mr. Feast must physically reach the exact reachable camera position before beginning his long patrol; expected=${JSON.stringify(expectedLastSeen)} response=${JSON.stringify(arrivalProbe)}`,
    );
    await screenshotStage(page, "camera-last-seen-search-desktop.png");
    const response = await page.evaluate(() => window.MrFeastFresh.runMrFeastCameraResponseForQA(360));
    assert(response.completed, `Mr. Feast response should complete in deterministic QA time; response=${JSON.stringify(response)}`);
    for (const responseState of ["responding", "searching", "returning", "patrol"]) {
      assert(response.states.includes(responseState), `alarm lifecycle never entered ${responseState}; response=${JSON.stringify(response)}`);
    }
    assert(
      response.teleports === 0
        && response.distanceTravelled > 0
        && response.search?.durationSeconds >= 120
        && response.search.elapsedSeconds >= response.search.durationSeconds
        && response.search.patrolDistance >= 20
        && response.search.nodeVisits >= 4
        && response.search.visitedZoneCount >= 2
        && response.search.minimumDistanceToLastSeen <= 0.5,
      `Mr. Feast must navigate to the final camera position and patrol nearby for a few minutes before returning; response=${JSON.stringify(response)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.setCameraPlayerHiddenForQA(false));

    // A camera search is active perception rather than blind waypoint
    // walking. Silent hiding remains authoritative, but an exposed player in
    // his clear forward view must be reacquired through normal pursuit.
    await page.evaluate((id) => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.resetCameraSecurityForQA("show");
      window.MrFeastFresh.setCameraSoloForQA(id);
      window.MrFeastFresh.setCameraSweepForQA(id, 0);
      window.MrFeastFresh.setCameraOccludedForQA(id, false);
      window.MrFeastFresh.placePlayerInCameraLaneForQA(id, { distance: 4, lateral: 1.2 });
      window.MrFeastFresh.triggerCameraAlarmForQA(id, "qa-search-reacquisition");
      window.MrFeastFresh.setCameraPlayerHiddenForQA(true);
      window.MrFeastFresh.runMrFeastCameraResponseForQA(45);
    }, mainCamera);
    const hiddenSearchStage = await page.evaluate(() => (
      window.MrFeastFresh.stagePlayerForCameraSearchQA({ distance: 2.5, hidden: true })
    ));
    await page.evaluate(() => window.MrFeastFresh.advanceMrFeastAwarenessForQA(1));
    let searchReacquisition = await page.evaluate(() => window.MrFeastFresh.getMrFeastState());
    assert(
      hiddenSearchStage?.hidden
        && hiddenSearchStage.clearLane
        && !searchReacquisition.pursuit?.active
        && searchReacquisition.security?.state === "searching",
      `silent hiding must remain safe during a deliberate nearby search: ${JSON.stringify({ hiddenSearchStage, searchReacquisition })}`,
    );
    const exposedSearchStage = await page.evaluate(() => (
      window.MrFeastFresh.stagePlayerForCameraSearchQA({ distance: 2.5, hidden: false })
    ));
    await page.evaluate(() => window.MrFeastFresh.advanceMrFeastAwarenessForQA(0.5));
    searchReacquisition = await page.evaluate(() => window.MrFeastFresh.getMrFeastState());
    assert(
      exposedSearchStage?.clearLane
        && !exposedSearchStage.hidden
        && exposedSearchStage.personalSight
        && searchReacquisition.pursuit?.active?.kind === "camera-search"
        && searchReacquisition.pursuit?.active?.reason === "witnessed",
      `an exposed player found during the area sweep must start normal sight-led pursuit: ${JSON.stringify({ exposedSearchStage, searchReacquisition })}`,
    );
    await screenshotStage(page, "camera-search-reacquired-desktop.png");
    await page.evaluate(() => {
      window.MrFeastFresh.setCameraPlayerHiddenForQA(false);
      window.MrFeastFresh.resetMrFeastWandererForQA();
    });

    await configureCameraScenario(page, { cameraId: mainCamera, mode: "lockdown", sweep: 0 });
    await advanceSecurity(page, 0.35);
    state = await diagnostics(page);
    const securityNotice = page.locator("#mansion-security");
    assert(await securityNotice.isVisible(), "camera status should appear during acquisition");
    assert((await securityNotice.getAttribute("role")) === "status", "camera feedback should be an unobtrusive live status rather than a suspicion meter");
    assert((await page.locator("#mansion-security-status").textContent() || "").trim() === "Spotted", "the three-pulse acquisition warning should say only Spotted");
    assert(await page.locator("#mansion-security-mode, #mansion-security-value, .mansion-security__track").count() === 0, "camera notice should not retain policy, percentage, or meter-track UI");
    let recordingState = await page.evaluate((id) => window.MrFeastFresh.getCameraSecurityState().cameras.details.find((entry) => entry.id === id), mainCamera);
    for (let step = 0; step < 30 && !recordingState.trackingPlayer; step += 1) {
      await advanceSecurity(page, 0.1);
      recordingState = await page.evaluate((id) => window.MrFeastFresh.getCameraSecurityState().cameras.details.find((entry) => entry.id === id), mainCamera);
    }
    assert(recordingState.trackingPlayer, `camera should reach its solid-red recording phase; camera=${JSON.stringify(recordingState)}`);
    assert((await page.locator("#mansion-security-status").textContent() || "").trim() === "Being recorded", "solid-red tracking should change the notice to Being recorded");
    const desktopNoticeLayout = await securityNotice.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    assert(desktopNoticeLayout.width <= 160 && desktopNoticeLayout.height <= 40, `desktop camera notice should stay subtle and compact; layout=${JSON.stringify(desktopNoticeLayout)}`);
    await screenshotStage(page, "camera-status-desktop.png");
    await page.evaluate((id) => window.MrFeastFresh.setCameraOccludedForQA(id, true), mainCamera);
    await advanceSecurity(page, 0.2);
    assert(!(await securityNotice.isVisible()), "camera notice should disappear immediately after observation ends, even during lockdown");

    const finalLightLayout = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    assert(JSON.stringify(finalLightLayout) === JSON.stringify(initialLightLayout), `security cameras must not add or toggle shader lights; before=${JSON.stringify(initialLightLayout)} after=${JSON.stringify(finalLightLayout)}`);

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const mobilePage = await mobileContext.newPage();
    mobilePage.on("pageerror", (error) => errors.push(`mobile: ${error.message}`));
    mobilePage.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(`mobile: ${message.text()}`);
    });
    await mobilePage.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await mobilePage.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    const mobileState = await diagnostics(mobilePage);
    await configureCameraScenario(mobilePage, { cameraId: mobileState.security.qa.mainCameraId, mode: "lockdown", sweep: 0 });
    await advanceSecurity(mobilePage, 0.65);
    const mobileLayout = await mobilePage.locator("#mansion-security").evaluate((element) => {
      const stage = document.getElementById("mansion-stage").getBoundingClientRect();
      const meter = element.getBoundingClientRect();
      return {
        withinStage: meter.left >= stage.left && meter.right <= stage.right && meter.top >= stage.top && meter.bottom <= stage.bottom,
        width: meter.width,
        height: meter.height,
        stageWidth: stage.width,
      };
    });
    assert(mobileLayout.withinStage && mobileLayout.width <= 160 && mobileLayout.height <= 40, `mobile camera notice should remain compact inside the stage; layout=${JSON.stringify(mobileLayout)}`);
    assert((await mobilePage.locator("#mansion-security-status").textContent() || "").trim() === "Spotted", "mobile acquisition notice should use the same subtle Spotted copy");
    await screenshotStage(mobilePage, "camera-status-mobile.png");
    await mobileContext.close();

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast camera security browser test: wall-centered slow scanning, warning pulses, player tracking, policy, stealth, occlusion, alarm investigation, and transient camera status passed");
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast camera security browser test failed: ${error.message}`);
  process.exitCode = 1;
});
