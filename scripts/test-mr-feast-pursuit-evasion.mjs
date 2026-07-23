import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const port = Number(process.env.MR_FEAST_EVASION_TEST_PORT || (45200 + (process.pid % 16000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&allLights=1&frame=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-pursuit-evasion");
const useHardwareBrowser = process.env.MR_FEAST_HARDWARE_BROWSER === "1";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function phaseDistance(a, b) {
  const difference = Math.abs(Number(a) - Number(b));
  return Math.min(difference, 1 - difference);
}

function positionDistance(a, b) {
  return Math.hypot(Number(a?.x) - Number(b?.x), Number(a?.y) - Number(b?.y), Number(a?.z) - Number(b?.z));
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

async function state(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function run() {
  const runtime = await readFile(runtimePath, "utf8");

  // Red-first source contracts. These intentionally fail on the omniscient
  // chase and silent host that preceded Milestone 57.
  assert(/const MR_FEAST_FOOTSTEPS\s*=\s*Object\.freeze/.test(runtime), "missing named MR_FEAST_FOOTSTEPS animation-contact tuning");
  assert(/updateMrFeastFootsteps\(/.test(runtime) && /mrFeastFootstep\(/.test(runtime), "Mr. Feast animation is not wired to the mansion surface-step mix");
  assert(/pursuitLastKnownPosition/.test(runtime) && /pursuitTrackingSource/.test(runtime), "pursuit lacks explicit last-known tracking state");
  assert(/hiddenGiveUpSeconds/.test(runtime) && /unseenGiveUpSeconds/.test(runtime), "pursuit lacks bounded hidden and unseen escape windows");
  assert(/pursuitDirectSight/.test(runtime) && /pursuitDirectSteeringFrames/.test(runtime), "clear-line direct pursuit steering is missing");
  assert(/advanceMrFeastPursuitForQA/.test(runtime), "short deterministic pursuit stepping QA hook is missing");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch(useHardwareBrowser
      ? { channel: "chrome", headless: false }
      : { headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const sourceUrl = message.location().url || "";
      if (message.type() === "error" && !/favicon\.ico/i.test(`${message.text()} ${sourceUrl}`)) errors.push(`${message.text()} ${sourceUrl}`.trim());
    });
    await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 180000 });
    await page.waitForFunction(() => !document.getElementById("mansion-enter")?.disabled, null, { timeout: 120000 });
    await page.locator("#mansion-enter").click({ force: true });
    await page.waitForFunction(() => window.MrFeastFresh?.getMrFeastState?.()?.loadStatus === "ready", null, { timeout: 180000 });
    await page.waitForFunction(() => {
      const audio = window.MrFeastFresh?.getAudioStateForQA?.();
      return audio?.contextState === "running" && audio.loadedAssets?.length === audio.expectedAssets;
    }, null, { timeout: 45000 });

    // 1. The existing local surface bank follows the planted contacts of the
    // shipped stalk clip. Stationary and muted updates stay silent.
    let audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    const stalkBefore = audio.mrFeastFootsteps.count;
    await page.evaluate(() => {
      window.MrFeastFresh.teleport("dining");
      return window.MrFeastFresh.runMrFeastLocomotionProbeForQA({
        sourceId: "main-dining-south",
        targetId: "main-dining-west",
        seconds: 5.2,
      });
    });
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    const stalkEvents = audio.mrFeastFootsteps.events.filter((event) => event.sequence > stalkBefore);
    assert(stalkEvents.length >= 4, `walking stalk animation should emit repeated host steps; events=${JSON.stringify(stalkEvents)}`);
    assert(stalkEvents.every((event) => event.action === "stalk" && event.surface === "wood"), `main-floor stalk steps should be wood; events=${JSON.stringify(stalkEvents)}`);
    assert(stalkEvents.every((event) => phaseDistance(event.phase, event.foot === "right" ? 0.025 : 0.542) <= 0.035), `stalk steps should land at sampled grounded phases; events=${JSON.stringify(stalkEvents)}`);
    assert(stalkEvents.every((event, index) => index === 0 || event.foot !== stalkEvents[index - 1].foot), `host steps must alternate feet; events=${JSON.stringify(stalkEvents)}`);

    await page.evaluate(() => window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: -9, y: 0, z: -8, yaw: 0 }));
    const idleBefore = (await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA())).mrFeastFootsteps.count;
    await page.evaluate(() => window.MrFeastFresh.advanceMrFeastAnimationForQA(2));
    assert((await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA())).mrFeastFootsteps.count === idleBefore, "idle animation must not emit Mr. Feast footsteps");
    await page.keyboard.press("m");
    await page.evaluate(() => window.MrFeastFresh.runMrFeastLocomotionProbeForQA({ sourceId: "main-dining-south", targetId: "main-dining-west", seconds: 2.2 }));
    assert((await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA())).mrFeastFootsteps.count === idleBefore, "master mute must suppress Mr. Feast footsteps");
    await page.keyboard.press("m");

    // 2. A witnessed runner in an open ballroom lane is pursued on the real
    // straight line instead of being detoured through graph waypoints.
    const direct = await page.evaluate(() => {
      window.MrFeastFresh.resetCameraSecurityForQA(null);
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.teleport("ballroom");
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 0, y: 0, z: -0.2, yaw: Math.PI });
      window.MrFeastFresh.reportInfractionForQA("portrait");
      return window.MrFeastFresh.advanceMrFeastPursuitForQA(1.7);
    });
    assert(direct.active && direct.directSteeringFrames >= 45, `visible clear-lane pursuit should sustain direct steering; result=${JSON.stringify(direct)}`);
    assert(direct.distanceTravelled >= 2.2 && direct.maximumLateralDeviation <= 0.14, `clear-lane pursuit should stay straight; result=${JSON.stringify(direct)}`);
    assert(direct.teleports === 0 && direct.maximumFrameSpeed <= direct.pursuitSpeed + 0.05, `direct pursuit must remain physical and below its speed cap; result=${JSON.stringify(direct)}`);
    audio = await page.evaluate(() => window.MrFeastFresh.getAudioStateForQA());
    const runEvents = audio.mrFeastFootsteps.events.filter((event) => event.action === "run");
    assert(runEvents.length >= 2 && runEvents.every((event) => phaseDistance(event.phase, event.foot === "left" ? 0.333 : 0.817) <= 0.035), `run footsteps should land at sampled contacts; events=${JSON.stringify(runEvents)}`);
    await page.evaluate(() => window.MrFeastFresh.placePlayerNearMrFeastForQA(3));
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(artifactDir, "direct-ballroom-pursuit.png") });

    // 3. Breaking both personal sight and camera tracking freezes the last
    // known position. He may pursue that stale clue, but never the live player.
    const memory = await page.evaluate(() => {
      window.MrFeastFresh.resetCameraSecurityForQA(null);
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.teleport("music");
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 5.5, y: 0, z: 7.7, yaw: Math.PI / 2 });
      window.MrFeastFresh.reportInfractionForQA("portrait");
      window.MrFeastFresh.advanceMrFeastPursuitForQA(0.3);
      const before = window.MrFeastFresh.getMrFeastState().pursuit;
      window.MrFeastFresh.teleport("coatCloset");
      const step = window.MrFeastFresh.advanceMrFeastPursuitForQA(1.5);
      const after = window.MrFeastFresh.getMrFeastState().pursuit;
      return { before, step, after, player: JSON.parse(window.render_game_to_text()).player };
    });
    assert(positionDistance(memory.before.lastKnownPosition, memory.after.lastKnownPosition) <= 0.01, `unseen movement must not update the chase target; memory=${JSON.stringify(memory)}`);
    assert(memory.after.targetNodeId === memory.before.targetNodeId, `unseen player must not retarget the response graph; memory=${JSON.stringify(memory)}`);
    assert(positionDistance(memory.after.lastKnownPosition, memory.player) >= 5, `last-known point should remain distinct from the unseen live player; memory=${JSON.stringify(memory)}`);
    assert(memory.after.giveUpRemaining <= memory.before.giveUpRemaining - 1.1, `unseen timer should drain while he is still moving; memory=${JSON.stringify(memory)}`);
    assert(memory.after.trackingSource === "lost" && memory.after.unseenSeconds >= 1.2, `diagnostics should expose the lost trail; memory=${JSON.stringify(memory)}`);

    const lost = await page.evaluate(() => window.MrFeastFresh.advanceMrFeastPursuitForQA(9));
    assert(!lost.active && lost.outcome === "lost", `an unseen, unrecorded player should escape inside the authored window; result=${JSON.stringify(lost)}`);

    // 4. A real hiding spot uses the shorter escape window and never catches
    // or retargets the hidden player.
    const hidden = await page.evaluate(() => {
      window.MrFeastFresh.resetCameraSecurityForQA(null);
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.teleport("music");
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 5.5, y: 0, z: 7.7, yaw: Math.PI / 2 });
      window.MrFeastFresh.reportInfractionForQA("portrait");
      window.MrFeastFresh.advanceMrFeastPursuitForQA(0.3);
      const lastKnown = window.MrFeastFresh.getMrFeastState().pursuit.lastKnownPosition;
      const hid = window.MrFeastFresh.enterHideSpotForQA("coat");
      const run = window.MrFeastFresh.advanceMrFeastPursuitForQA(4.5);
      const diagnostics = window.MrFeastFresh.getMrFeastState();
      return { hid, run, diagnostics, lastKnown };
    });
    assert(hidden.hid?.hidden && !hidden.run.active && hidden.run.outcome === "lost", `hiding should reliably end active pursuit; result=${JSON.stringify(hidden)}`);
    assert(hidden.run.catches === 0 && hidden.diagnostics.pursuit.catches === 0, `a hidden player must not be caught; result=${JSON.stringify(hidden)}`);
    assert(positionDistance(hidden.lastKnown, hidden.diagnostics.pursuit.lastKnownPosition) <= 0.01, `hiding must not broadcast the hiding spot; result=${JSON.stringify(hidden)}`);
    await page.screenshot({ path: path.join(artifactDir, "hidden-pursuit-escaped.png") });

    assert(errors.length === 0, `browser emitted errors: ${errors.join(" | ")}`);
    console.log(`Mr. Feast pursuit/evasion passed: stalk steps=${stalkEvents.length}, run steps=${runEvents.length}, direct frames=${direct.directSteeringFrames}, hidden outcome=${hidden.run.outcome}`);
  } finally {
    await browser?.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
