import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_TEST_PORT || (43000 + (process.pid % 18000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1&view=workroomMonitorWall&frame=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-workroom-security-hub");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function serverResponds() {
  try {
    const response = await fetch(`${baseUrl}/games/mr-feast-mansion.html`, { cache: "no-store" });
    return response.ok;
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

async function captureServerSideVisibility(page, outputPath) {
  const screenshot = await page.screenshot();
  await sharp(screenshot).png().toFile(outputPath);
  const metadata = await sharp(screenshot).metadata();
  const region = {
    left: Math.floor((metadata.width || 1) * 0.68),
    top: Math.floor((metadata.height || 1) * 0.15),
    width: Math.floor((metadata.width || 1) * 0.30),
    height: Math.floor((metadata.height || 1) * 0.65),
  };
  const { data, info } = await sharp(screenshot).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let luminance = 0;
  let visiblePixels = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const value = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    luminance += value;
    if (value >= 18) visiblePixels += 1;
  }
  const pixelCount = data.length / info.channels;
  return {
    meanLuminance: Number((luminance / pixelCount).toFixed(3)),
    visiblePercent: Number((visiblePixels / pixelCount * 100).toFixed(2)),
    region,
  };
}

async function run() {
  let server = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], {
      stdio: "ignore",
    });
  }

  let browser;
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

    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.waitForTimeout(500);

    let state = await diagnostics(page);
    assert(state.room === "WORKROOM", `both former room halves should resolve to WORKROOM, received ${state.room}`);
    assert(state.security.cameras.total === 32 && state.security.cameras.indoors === 24 && state.security.cameras.outdoors === 8, `the Workroom camera removal should leave a 32-camera estate roster; cameras=${JSON.stringify(state.security.cameras)}`);
    assert(state.security.cameras.exemptZones.includes("WORKROOM") && !state.security.cameras.coveredZones.includes("WORKROOM"), "the Workroom should be an explicit camera-free zone");
    const eastHalf = await page.evaluate(() => window.MrFeastFresh.teleport("workroomEast"));
    assert(eastHalf.room === "WORKROOM", `the former Cold Room half should resolve to WORKROOM, received ${eastHalf.room}`);
    await page.evaluate(() => window.MrFeastFresh.teleport("workroomMonitorWall"));
    assert(state.workroom?.merged === true, "diagnostics should expose one merged Workroom");
    assert(state.workroom?.formerColdRoomDoorRemoved === true, "the Cold Room doorway should be filled with wall and collider");
    assert(state.workroom?.entrance?.name === "workroom door", "the retained entrance should be the canonical workroom door");
    assert(state.workroom?.entrance?.locked === true && state.workroom?.entrance?.colliderEnabled === true, "the Workroom should begin locked and physically blocked");
    assert(state.workroom?.keypad?.codeLength === 4 && state.workroom?.keypad?.codeExposedToPlayer === false, "the keypad should require an unrevealed four-digit code");

    const wrongAttempt = await page.evaluate(() => window.MrFeastFresh.submitWorkroomCodeForQA("0000"));
    assert(wrongAttempt.keypad.status === "denied", "a wrong Workroom code should show denied status");
    assert(wrongAttempt.entrance.locked === true && wrongAttempt.entrance.colliderEnabled === true, "a wrong code must leave the door locked and blocking");

    const unlocked = await page.evaluate(() => {
      const code = window.MrFeastFresh.getWorkroomState().qaCode;
      return window.MrFeastFresh.submitWorkroomCodeForQA(code);
    });
    assert(unlocked.keypad.status === "accepted", "the special Workroom code should be accepted");
    assert(unlocked.entrance.locked === false, "the correct code should unlock the retained door");

    const restoredLock = await page.evaluate(() => window.MrFeastFresh.resetWorkroomForQA());
    assert(restoredLock.entrance.locked === true, "the QA reset should restore a locked Workroom");

    await page.evaluate(() => window.MrFeastFresh.teleport("workroomKeypadOutside"));
    await page.waitForFunction(() => /workroom.*pin|access pin/i.test(JSON.parse(window.render_game_to_text()).prompt || ""));
    await page.keyboard.press("e");
    await page.waitForFunction(() => !document.getElementById("mansion-workroom-keypad")?.hidden);
    const qaCode = await page.evaluate(() => window.MrFeastFresh.getWorkroomState().qaCode);

    // Some browser/keyboard layouts report the typed character through
    // `event.key` without a usable physical `event.code`. Exercise that real
    // input path so the PIN pad does not silently ignore number entry.
    for (const digit of qaCode) {
      await page.evaluate((key) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })), digit);
    }
    state = await diagnostics(page);
    assert(state.workroom.keypad.inputLength === qaCode.length, `layout-neutral keyboard digits should populate the Workroom keypad; keypad=${JSON.stringify(state.workroom.keypad)}`);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    state = await diagnostics(page);
    assert(state.workroom.entrance.locked === false && state.workroom.keypad.status === "accepted", "layout-neutral keyboard input should submit and unlock the Workroom");
    await page.evaluate(() => window.MrFeastFresh.resetWorkroomForQA());

    for (const digit of qaCode) await page.locator(`[data-workroom-key][data-digit="${digit}"]`).click();
    await page.locator('[data-workroom-key][data-action="enter"]').click();
    state = await diagnostics(page);
    assert(state.workroom.entrance.locked === false && state.workroom.keypad.status === "accepted", "clicking the physical PIN sequence should unlock the Workroom");
    await page.locator("#mansion-workroom-keypad-close").click();
    const saved = await page.evaluate(() => window.MrFeastFresh.saveGameForQA());
    assert(saved === true, "explicit save should accept an unlocked Workroom state");
    await page.evaluate(() => window.MrFeastFresh.resetWorkroomForQA());
    const loaded = await page.evaluate(() => window.MrFeastFresh.loadGameForQA());
    assert(loaded === true, "explicit load should restore the Workroom save");
    state = await diagnostics(page);
    assert(state.workroom.entrance.locked === false, "Workroom unlock should survive an explicit save/load round trip");
    await page.evaluate(() => window.MrFeastFresh.resetWorkroomForQA());
    await page.evaluate(() => window.MrFeastFresh.teleport("workroomMonitorWall"));

    const lightLayoutBefore = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    const monitor = await page.evaluate(() => window.MrFeastFresh.refreshMonitorWallForQA());
    assert(monitor.screenCount >= 6, "the Workroom needs a full bank of at least six live screens");
    assert(monitor.renderTargets === monitor.screenCount, "every Workroom screen should own a WebGL render target");
    assert(monitor.feeds.every((feed) => feed.cameraId && feed.sourceRoom && feed.width <= 256 && feed.height <= 144 && feed.renderTargetTexture), "every screen should map to a low-resolution real security-camera render-target texture");
    assert(new Set(monitor.feeds.map((feed) => feed.cameraId)).size === monitor.screenCount, "the monitor bank should begin on distinct camera feeds");
    assert(monitor.rosterCameraCount === state.security.cameras.total, "the paged Workroom monitor roster should cover the full security-camera network");
    assert(monitor.feeds.filter((feed) => feed.signature && feed.signature !== "00000000").length >= 4, "the monitor bank should render nonblank room imagery");
    assert(new Set(monitor.feeds.map((feed) => feed.signature)).size >= 3, "different room cameras should produce visibly different feed signatures");
    assert(monitor.maxFeedsPerFrame === 1, "monitor rendering should be time-sliced to one feed per main frame");
    assert(monitor.renderStateRestored === true, "offscreen feeds should restore the main renderer state");

    const firstFeed = monitor.feeds[0];
    const changedFeed = await page.evaluate(({ cameraId }) => {
      window.MrFeastFresh.setCameraSweepForQA(cameraId, 0.92);
      return window.MrFeastFresh.refreshMonitorWallForQA(cameraId);
    }, firstFeed);
    const changed = changedFeed.feeds.find((feed) => feed.cameraId === firstFeed.cameraId);
    assert(changed && Math.abs(changed.sourceYaw - firstFeed.sourceYaw) > 0.01, "the live feed camera should follow the scanning security-camera yaw");
    assert(changed.signature && changed.signature !== firstFeed.signature, "the rendered monitor image should change when its source camera pans");
    const lightLayoutAfter = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    assert(lightLayoutAfter.spot === lightLayoutBefore.spot && lightLayoutAfter.point === lightLayoutBefore.point && lightLayoutAfter.directional === lightLayoutBefore.directional && lightLayoutAfter.hemisphere === lightLayoutBefore.hemisphere, "refreshing monitor feeds must not add shader lights");

    assert(state.workroom?.ambience?.serverRacks >= 2, "the Workroom should include server racks");
    assert(state.workroom?.ambience?.operatorStations >= 1, "the Workroom should include an operator console");
    assert(state.workroom?.ambience?.propCount >= 12, "the Workroom should include substantial atmospheric equipment and clutter");
    assert(state.workroom?.serverLighting?.cameraFree === true && state.workroom.serverLighting.fixtureCount === 2, `Workroom diagnostics should expose a camera-free two-emitter circuit; lighting=${JSON.stringify(state.workroom?.serverLighting)}`);
    assert(state.workroom.serverLighting.serverFixture?.x >= 6 && state.workroom.serverLighting.serverFixture?.intensityScale >= 1.5 && state.workroom.serverLighting.serverFixture?.rendered === true && state.workroom.serverLighting.taskLights >= 3, `the east rack bank should own a budgeted real emitter plus switched task practicals; lighting=${JSON.stringify(state.workroom.serverLighting)}`);

    await page.screenshot({ path: path.join(artifactDir, "workroom-monitor-wall-desktop.png") });
    await page.evaluate(() => window.MrFeastFresh.teleport("workroomWide"));
    await page.waitForTimeout(500);
    const serverVisibility = await captureServerSideVisibility(page, path.join(artifactDir, "workroom-server-racks-desktop.png"));
    assert(serverVisibility.meanLuminance >= 10 && serverVisibility.visiblePercent >= 15, `the server side remains too dark to read; visibility=${JSON.stringify(serverVisibility)}`);

    await page.evaluate(() => window.MrFeastFresh.openWorkroomKeypadForQA());
    await page.waitForFunction(() => !document.getElementById("mansion-workroom-keypad")?.hidden);
    const keypadLayout = await page.evaluate(() => {
      const dialog = document.getElementById("mansion-workroom-keypad");
      const keys = [...dialog.querySelectorAll("[data-workroom-key]")];
      return {
        visible: !dialog.hidden,
        keys: keys.length,
        minWidth: Math.min(...keys.map((key) => key.getBoundingClientRect().width)),
        minHeight: Math.min(...keys.map((key) => key.getBoundingClientRect().height)),
      };
    });
    assert(keypadLayout.visible && keypadLayout.keys >= 12, "the keypad should expose digits plus clear/enter controls");
    assert(keypadLayout.minWidth >= 44 && keypadLayout.minHeight >= 44, "keypad controls should meet the 44px touch target");
    await page.screenshot({ path: path.join(artifactDir, "workroom-keypad-desktop.png") });

    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobilePage = await mobileContext.newPage();
    const mobileErrors = [];
    mobilePage.on("pageerror", (error) => mobileErrors.push(error.message));
    mobilePage.on("console", (message) => {
      if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) mobileErrors.push(message.text());
    });
    await mobilePage.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await mobilePage.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await mobilePage.evaluate(() => window.MrFeastFresh.openWorkroomKeypadForQA());
    await mobilePage.waitForFunction(() => !document.getElementById("mansion-workroom-keypad")?.hidden);
    const mobileOverflow = await mobilePage.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      keypadRight: document.querySelector(".mansion-keypad__panel").getBoundingClientRect().right,
    }));
    assert(mobileOverflow.width <= mobileOverflow.viewport && mobileOverflow.keypadRight <= mobileOverflow.viewport + 0.5, "the touch keypad should not overflow a 390px viewport");
    const mobileCode = await mobilePage.evaluate(() => window.MrFeastFresh.getWorkroomState().qaCode);
    for (const digit of mobileCode) await mobilePage.locator(`[data-workroom-key][data-digit="${digit}"]`).tap();
    await mobilePage.locator('[data-workroom-key][data-action="enter"]').tap();
    const mobileState = await diagnostics(mobilePage);
    assert(mobileState.workroom.entrance.locked === false && mobileState.workroom.keypad.status === "accepted", "touch PIN entry should unlock the Workroom");
    await mobilePage.screenshot({ path: path.join(artifactDir, "workroom-keypad-mobile.png") });
    await mobileContext.close();

    assert(!errors.some((message) => /feedback loop|framebuffer|GL_INVALID_OPERATION/i.test(message)), `monitor rendering caused a WebGL feedback loop: ${errors.join(" | ")}`);
    assert(errors.length === 0, `desktop console errors: ${errors.join(" | ")}`);
    assert(mobileErrors.length === 0, `mobile console errors: ${mobileErrors.join(" | ")}`);
    console.log("Mr. Feast Workroom security-hub regression passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
