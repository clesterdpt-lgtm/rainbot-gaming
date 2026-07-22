import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_STORM_EXIT_TEST_PORT || (56600 + (process.pid % 7000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactPath = path.join(root, "output", "iterate", "2026-07-21-storm-run-final-straight-lightning.png");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function angleDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(gameUrl, { cache: "no-store" })).ok) return;
    } catch (_) {
      // The temporary localhost server can take a moment to claim its port.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function run() {
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: "ignore",
  });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
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

    const feast = await page.evaluate(() => window.MrFeastFresh.completeFeastSaysForQA(6));
    assert(feast?.survived, `Feast Says setup failed: ${JSON.stringify(feast)}`);
    const called = await page.evaluate(() => window.MrFeastFresh.callStormRunForQA("qa"));
    assert(called?.started, `Storm Run call failed: ${JSON.stringify(called)}`);
    const started = await page.evaluate(() => window.MrFeastFresh.startStormRunForQA());
    assert(started?.started, `Storm Run briefing failed: ${JSON.stringify(started)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(16));
    await page.waitForFunction(() => window.MrFeastFresh.getStormRunState?.()?.phase === "running");

    for (let index = 0; index <= 9; index += 1) {
      const collected = await page.evaluate((checkpointIndex) => (
        window.MrFeastFresh.collectStormCheckpointForQA(checkpointIndex)
      ), index);
      assert(
        collected?.accepted && collected.completed === index + 1,
        `checkpoint ${index + 1} setup failed: ${JSON.stringify(collected)}`,
      );
    }

    let storm = await page.evaluate(() => window.MrFeastFresh.getStormRunState());
    const scare = storm.scares[2];
    assert(
      scare.trigger.id === "maze-final-corridor-turn"
        && scare.trigger.x === 22
        && scare.trigger.z === -0.25,
      `the final scare must arm on entry to the long last straight: ${JSON.stringify(scare.trigger)}`,
    );
    assert(
      scare.reveal.position.x === 22
        && scare.reveal.position.z === -13.75
        && angleDistance(scare.reveal.yaw, 0) <= 0.001,
      `Mr. Feast must stand at the far end facing north toward the player: ${JSON.stringify(scare.reveal)}`,
    );
    const preview = await page.evaluate(() => window.MrFeastFresh.previewStormScareForQA(2));
    assert(
      preview?.onScreen
        && preview.lineOfSight
        && preview.blocker == null
        && Math.abs(preview.projected.x) <= 0.06
        && preview.distance >= 13.4
        && preview.distance <= 13.6
        && preview.projectedHeight >= 0.1
        && preview.hostFacingPlayerDot >= 0.99,
      `the final-straight composition must be clear, centered, life-size, and player-facing: ${JSON.stringify(preview)}`,
    );
    storm = await page.evaluate(() => window.MrFeastFresh.getStormRunState());
    assert(
      storm.mazeExitLighting?.dark
        && storm.mazeExitLighting.energizedFixtureCount === 0
        && storm.mazeExitLighting.shaderResidentFixtureCount >= 1,
      `the exit practical must stay dark in the final-straight render topology before the reveal: ${JSON.stringify(storm.mazeExitLighting)}`,
    );

    await page.evaluate(() => window.MrFeastFresh.placePlayerAtStormScareTriggerForQA(2, false));
    await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    storm = await page.evaluate(() => window.MrFeastFresh.getStormRunState());
    assert(
      storm.scare.candidateId === "maze-turn"
        && storm.scare.waitingForFacing
        && !storm.scare.hostVisible,
      `turning into the straight while facing away must arm without consuming the reveal: ${JSON.stringify(storm.scare)}`,
    );

    const facing = await page.evaluate(() => window.MrFeastFresh.placePlayerAtStormScareTriggerForQA(2, true));
    assert(facing?.onScreen && facing.lineOfSight && facing.facingDot >= facing.facingMinimumDot, `the authored turn must face the clear final straight: ${JSON.stringify(facing)}`);
    await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(0.05));
    await page.waitForTimeout(120);
    const visible = await page.evaluate(() => window.MrFeastFresh.getStormRunState());
    assert(
      visible.scare.hostVisible
        && visible.scare.lightning > 0
        && visible.mazeExitLighting?.dark
        && visible.mazeExitLighting.energizedFixtureCount === 0,
      `Mr. Feast and lightning must appear while the exit practical remains dark: ${JSON.stringify({ scare: visible.scare, lighting: visible.mazeExitLighting })}`,
    );
    await page.screenshot({ path: artifactPath });

    await page.evaluate(() => window.MrFeastFresh.advanceStormRunForQA(1.25));
    const after = await page.evaluate(() => window.MrFeastFresh.getStormRunState());
    assert(
      !after.scare.hostVisible
        && after.scare.lightning === 0
        && !after.mazeExitLighting?.dark
        && after.mazeExitLighting.restoredAfterScare
        && after.mazeExitLighting.energizedFixtureCount >= 1,
      `the exit practical must restore only after Mr. Feast disappears: ${JSON.stringify({ scare: after.scare, lighting: after.mazeExitLighting })}`,
    );
    assert(errors.length === 0, `final-straight reveal produced browser errors: ${JSON.stringify(errors)}`);
    console.log(`Storm Run final-straight reveal passed: ${JSON.stringify({
      trigger: scare.trigger,
      reveal: scare.reveal,
      distance: preview.distance,
      projectedHeight: preview.projectedHeight,
      hostFacingPlayerDot: preview.hostFacingPlayerDot,
      lightDuring: visible.mazeExitLighting.fixtures,
      lightAfter: after.mazeExitLighting.fixtures,
    })}`);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast Storm Run final-straight check failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
