import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_STORM_INTRO_TEST_PORT || (55600 + (process.pid % 8000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactPath = path.join(root, "output", "playwright", "mr-feast-storm-run", "storm-run-animated-briefing-desktop.png");
const waitingArtifactPath = path.join(root, "output", "playwright", "mr-feast-storm-run", "storm-run-planted-wait-desktop.png");
const runtimeCacheKey = "20260721-storm-run-wait-pose-1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pointDistance(before, after) {
  return Math.hypot(
    (after?.x || 0) - (before?.x || 0),
    (after?.y || 0) - (before?.y || 0),
    (after?.z || 0) - (before?.z || 0),
  );
}

function footTravel(before, after) {
  return Math.max(
    pointDistance(before.leftFoot, after.leftFoot),
    pointDistance(before.rightFoot, after.rightFoot),
  );
}

async function hostPose(page) {
  return page.evaluate(() => {
    const host = window.MrFeastFresh.getMrFeastState();
    return {
      animation: host.currentAnimation,
      moving: host.moving,
      challengeIdlePoseTime: host.challengeIdlePoseTime,
      position: host.position,
      leftFoot: host.liveBones?.leftFoot || null,
      rightFoot: host.liveBones?.rightFoot || null,
    };
  });
}

async function sampleHostPoseTrack(page, sampleDelays) {
  const samples = [await hostPose(page)];
  for (const sampleDelay of sampleDelays) {
    await page.waitForTimeout(sampleDelay);
    samples.push(await hostPose(page));
  }
  return samples;
}

function maximumFootTravel(samples) {
  const origin = samples[0];
  return Math.max(...samples.map((sample) => footTravel(origin, sample)));
}

async function captureViewport(page, artifact) {
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = await session.send("Page.captureScreenshot", { format: "png" });
    await writeFile(artifact, Buffer.from(data, "base64"));
  } finally {
    await session.detach();
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(gameUrl, { cache: "no-store" })).ok) return;
    } catch (_) {
      // The local server can take a moment to claim the port.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function run() {
  const mansionHtml = await readFile(path.join(root, "games", "mr-feast-mansion.html"), "utf8");
  assert(
    mansionHtml.includes(`mr-feast-mansion.js?v=${runtimeCacheKey}`),
    `the mansion page must publish the planted-wait runtime under cache key ${runtimeCacheKey}`,
  );
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: "ignore",
  });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const ignored = /favicon\.ico|fonts\.googleapis|fonts\.gstatic/i.test(message.text());
      if (message.type() === "error" && !ignored) errors.push(message.text());
    });
    await page.addInitScript(() => localStorage.clear());
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready);
    assert(await page.evaluate(() => window.MrFeastFresh.startOptionalCharacterLoadsForQA?.()), "optional character loads did not start");
    await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState?.()?.loadStatus === "ready");
    await page.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled);
    console.log("Storm Run intro: host and cast ready");

    const feast = await page.evaluate(() => window.MrFeastFresh.completeFeastSaysForQA(6));
    assert(feast?.survived, `Feast Says setup failed: ${JSON.stringify(feast)}`);
    const called = await page.evaluate(() => window.MrFeastFresh.callStormRunForQA("qa"));
    assert(called?.started, `Storm Run call failed: ${JSON.stringify(called)}`);
    console.log("Storm Run intro: call staged");
    await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0));
    console.log("Storm Run intro: called-state presentation synchronized");

    const waitingSamples = await sampleHostPoseTrack(page, [73, 101, 137, 89, 151, 113]);
    const waitingBefore = waitingSamples[0];
    const waitingAfter = waitingSamples.at(-1);
    const waitingFootTravel = maximumFootTravel(waitingSamples);
    assert(
      waitingSamples.every((sample) => sample.challengeIdlePoseTime === 0)
        && waitingFootTravel <= 0.002,
      `waiting host must remain planted across the complete interval: ${JSON.stringify({ waitingSamples, waitingFootTravel })}`,
    );
    console.log(`Storm Run intro: waiting samples planted at ${waitingFootTravel.toFixed(6)}m`);
    await captureViewport(page, waitingArtifactPath);
    console.log("Storm Run intro: waiting proof captured");

    const started = await page.evaluate(() => window.MrFeastFresh.startStormRunForQA());
    assert(started?.started, `Storm Run briefing failed to start: ${JSON.stringify(started)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0));
    console.log("Storm Run intro: briefing staged");
    const briefingBefore = await hostPose(page);
    await page.waitForTimeout(650);
    const briefingAfter = await hostPose(page);
    const briefingBodyTravel = footTravel(briefingBefore, briefingAfter);
    const briefingRootTravel = pointDistance(briefingBefore.position, briefingAfter.position);
    assert(
      briefingBefore.animation === "idle"
        && briefingAfter.animation === "idle"
        && briefingBefore.challengeIdlePoseTime === null
        && briefingAfter.challengeIdlePoseTime === null
        && briefingBodyTravel >= 0.005
        && briefingBodyTravel <= 0.25
        && briefingRootTravel <= 0.002,
      `briefing host must animate in place: ${JSON.stringify({ briefingBefore, briefingAfter, briefingBodyTravel, briefingRootTravel })}`,
    );
    await captureViewport(page, artifactPath);
    assert(errors.length === 0, `Storm Run intro produced browser errors: ${JSON.stringify(errors)}`);
    console.log(`Storm Run intro animation passed: waiting=${waitingFootTravel.toFixed(6)}m briefing=${briefingBodyTravel.toFixed(6)}m root=${briefingRootTravel.toFixed(6)}m`);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast Storm Run intro check failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
