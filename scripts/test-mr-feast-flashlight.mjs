import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_FLASHLIGHT_TEST_PORT || (44000 + (process.pid % 18000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-flashlight");
const useHardwareBrowser = process.env.MR_FEAST_HARDWARE_BROWSER === "1";

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

async function flashlight(page) {
  return page.evaluate(() => window.MrFeastFresh.getFlashlightState());
}

async function settlePlayer(page, seconds = 1.2) {
  await page.evaluate((value) => window.MrFeastFresh.advancePlayerForQA(value), seconds);
}

async function averageLuminance(buffer, region) {
  let image = sharp(buffer).removeAlpha();
  if (region) image = image.extract(region);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let total = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    total += data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
  }
  return total / Math.max(1, data.length / info.channels);
}

async function captureBeamMetrics(page, name) {
  const canvasBox = await page.locator("#mansion-canvas").boundingBox();
  assert(canvasBox, "mansion canvas should have a captureable viewport");
  const buffer = await page.screenshot({ clip: canvasBox });
  await sharp(buffer).png().toFile(path.join(artifactDir, `${name}.png`));
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const center = {
    left: Math.floor(width * 0.36),
    top: Math.floor(height * 0.30),
    width: Math.floor(width * 0.28),
    height: Math.floor(height * 0.34),
  };
  const periphery = {
    left: Math.floor(width * 0.05),
    top: Math.floor(height * 0.30),
    width: Math.floor(width * 0.20),
    height: Math.floor(height * 0.34),
  };
  return {
    center: await averageLuminance(buffer, center),
    periphery: await averageLuminance(buffer, periphery),
  };
}

async function run() {
  const [runtime, html] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  // Red-first source contract: fail before a browser is launched if the
  // authoritative system/input/security surfaces do not exist.
  assert(/const FLASHLIGHT = Object\.freeze\(\{/.test(runtime), "missing named FLASHLIGHT tuning table");
  assert(/class FlashlightSystem/.test(runtime), "missing focused FlashlightSystem");
  assert(/code === "KeyF"/.test(runtime) && /event\.repeat/.test(runtime), "F must toggle through the central non-repeating input path");
  assert(/reportFlashlightUse/.test(runtime) && /flashlight-use/.test(runtime), "flashlight use must report a camera-security event");
  assert(/getFlashlightState/.test(runtime) && /setFlashlightForQA/.test(runtime), "focused flashlight diagnostics and QA controls are missing");
  assert(/locations:\s*Object\.freeze\(\[/.test(runtime), "flashlight should declare its three discoverable pickup locations");
  assert(/kitchen-under-sink/.test(runtime) && /upper-east-front-closet/.test(runtime) && /basement-archive/.test(runtime), "flashlight locations should cover the kitchen sink cabinet, an upper walk-in closet, and the basement");
  assert(/simple-flashlight-body/.test(runtime) && !/brass-cradle/.test(runtime), "pickup should be a simple household flashlight without the ornate cradle");
  assert(/id="mansion-flashlight-button"/.test(html), "touch Light control is missing");
  assert(/intensity:\s*74\b/.test(runtime), "flashlight beam should use the slightly brighter 74 intensity tuning");
  assert(!/carried-flashlight-(?:body|head|lens)/.test(runtime), "active flashlight should show only its light, not a carried model");

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
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      const sourceUrl = message.location().url || "";
      if (message.type() === "error" && !/favicon\.ico/i.test(`${message.text()} ${sourceUrl}`)) errors.push(message.text());
    });
    await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.waitForTimeout(1000);
    console.log("flashlight qa: desktop ready");

    // 1. Fresh state and pre-collection input stay inert.
    let light = await flashlight(page);
    assert(light && !light.collected && !light.on && light.pickupVisible, `fresh flashlight state is wrong: ${JSON.stringify(light)}`);
    assert(light.pickups?.length === 3 && light.pickups.every((pickup) => pickup.visible), `fresh run should show all three flashlight pickups: ${JSON.stringify(light.pickups)}`);
    await page.keyboard.press("f");
    assert(!(await flashlight(page)).on, "F must do nothing before the flashlight is collected");

    // 2. Each authored location can be reached and collected with the real E
    // interaction. Each fresh attempt must collapse all three world copies
    // into exactly one authoritative Bag item.
    for (const locationId of ["kitchen-under-sink", "upper-east-front-closet"]) {
      const pickupPage = await context.newPage();
      pickupPage.on("pageerror", (error) => errors.push(`${locationId}: ${error.message}`));
      pickupPage.on("console", (message) => {
        const sourceUrl = message.location().url || "";
        if (message.type() === "error" && !/favicon\.ico/i.test(`${message.text()} ${sourceUrl}`)) errors.push(`${locationId}: ${message.text()}`);
      });
      await pickupPage.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
      await pickupPage.goto(gameUrl, { waitUntil: "domcontentloaded" });
      await pickupPage.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
      const locationStaging = await pickupPage.evaluate((id) => window.MrFeastFresh.placePlayerNearFlashlightForQA(id), locationId);
      assert(locationStaging?.locationId === locationId, `QA staging should target ${locationId}; staging=${JSON.stringify(locationStaging)}`);
      try {
        await pickupPage.waitForFunction(() => /take flashlight/i.test(document.getElementById("mansion-prompt-text")?.textContent || ""), null, { timeout: 15000 });
      } catch (_) {
        const missedPrompt = await pickupPage.evaluate(() => ({
          prompt: document.getElementById("mansion-prompt-text")?.textContent || "",
          state: JSON.parse(window.render_game_to_text()),
          flashlight: window.MrFeastFresh.getFlashlightState(),
        }));
        throw new Error(`${locationId} should expose Take flashlight after opening its cabinet: ${JSON.stringify(missedPrompt)}`);
      }
      await pickupPage.screenshot({ path: path.join(artifactDir, `flashlight-pickup-${locationId}-desktop.png`) });
      await pickupPage.keyboard.press("e");
      await pickupPage.waitForFunction(() => window.MrFeastFresh.getFlashlightState()?.collected === true);
      const locationLight = await flashlight(pickupPage);
      const locationState = await diagnostics(pickupPage);
      assert(locationLight.pickups?.every((pickup) => !pickup.visible && !pickup.registered), `taking ${locationId} should remove every world copy: ${JSON.stringify(locationLight.pickups)}`);
      assert(locationState.inventory.items.filter((id) => id === "basement-flashlight").length === 1, `taking ${locationId} should grant exactly one Bag item`);
      await pickupPage.close();
    }

    // The basement copy remains close to the service stair and uses the same
    // real interaction path.
    const staging = await page.evaluate(() => window.MrFeastFresh.placePlayerNearFlashlightForQA("basement-archive"));
    assert(staging?.locationId === "basement-archive", `basement QA staging targeted the wrong pickup: ${JSON.stringify(staging)}`);
    assert(staging?.distanceToServiceStairBottom <= 3.2, `flashlight should be easy to find from the service stairs; distance=${staging?.distanceToServiceStairBottom}`);
    await page.waitForFunction(() => /take flashlight/i.test(document.getElementById("mansion-prompt-text")?.textContent || ""), null, { timeout: 3000 });
    await page.screenshot({ path: path.join(artifactDir, "flashlight-pickup-desktop.png") });
    await page.keyboard.press("e");
    await page.waitForFunction(() => window.MrFeastFresh.getFlashlightState()?.collected === true);
    light = await flashlight(page);
    let state = await diagnostics(page);
    assert(!light.pickupVisible && light.pickups?.every((pickup) => !pickup.visible) && state.inventory.items.filter((id) => id === "basement-flashlight").length === 1, "taking any flashlight should remove all three props and grant exactly one Bag item");
    assert(/press f/i.test(await page.locator("#mansion-discovery-body").textContent() || ""), "pickup discovery should explain the F control");
    console.log("flashlight qa: pickup collected");

    // 3. Real F input toggles one authoritative light without changing shader
    // topology, ignores repeat, and yields while the pause menu is open.
    await page.evaluate(() => window.MrFeastFresh.frameFlashlightBeamForQA());
    await page.evaluate(() => window.MrFeastFresh.turnOffAllLights());
    await page.evaluate(() => window.MrFeastFresh.advanceLightFade(4));
    await settlePlayer(page, 0.8);
    const layoutOff = (await diagnostics(page)).lighting;
    const offVisual = await captureBeamMetrics(page, "flashlight-beam-off-desktop");
    await page.keyboard.press("f");
    await page.waitForFunction(() => window.MrFeastFresh.getFlashlightState()?.on === true);
    light = await flashlight(page);
    const layoutOn = (await diagnostics(page)).lighting;
    assert(light.beam.intensity > 0 && !light.beam.castShadow, "active flashlight should expose a real shadow-free beam");
    assert(light.beam.authoredIntensity === 74, `beam should use the slightly brighter authored intensity; beam=${JSON.stringify(light.beam)}`);
    assert(light.beam.distance >= 7.5 && light.beam.distance <= 9, `beam reach should stay useful but bounded; distance=${light.beam.distance}`);
    assert(light.beam.angle >= 0.30 && light.beam.angle <= 0.58 && light.beam.penumbra >= 0.7, `beam cone should stay focused and soft; beam=${JSON.stringify(light.beam)}`);
    assert(layoutOff.shaderSpotLights === layoutOn.shaderSpotLights && layoutOn.shaderSpotLights === layoutOn.shaderSpotBudget, `F must not change spot-light topology; off=${layoutOff.shaderSpotLights} on=${layoutOn.shaderSpotLights} budget=${layoutOn.shaderSpotBudget}`);
    const activations = light.activationCount;
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF", key: "f", repeat: true, bubbles: true })));
    assert((await flashlight(page)).on && (await flashlight(page)).activationCount === activations, "a repeated F keydown must not toggle or duplicate activation");
    const onVisual = await captureBeamMetrics(page, "flashlight-beam-on-desktop");
    const centerDelta = onVisual.center - offVisual.center;
    const peripheralDelta = onVisual.periphery - offVisual.periphery;
    assert(centerDelta >= 4, `the beam should materially brighten its central patch; off=${offVisual.center.toFixed(1)} on=${onVisual.center.toFixed(1)}`);
    assert(peripheralDelta <= centerDelta * 0.62 + 1.5, `the spooky periphery should brighten much less than the center; center delta=${centerDelta.toFixed(1)} edge delta=${peripheralDelta.toFixed(1)}`);
    assert(onVisual.center < 155, `the beam center should not wash out the Archive; luminance=${onVisual.center.toFixed(1)}`);
    console.log(`flashlight qa: beam center delta ${centerDelta.toFixed(1)}, edge delta ${peripheralDelta.toFixed(1)}`);
    await page.keyboard.press("f");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).menus.escapeOpen);
    await page.keyboard.press("f");
    assert(!(await flashlight(page)).on, "F must yield while the Escape menu is open");
    await page.evaluate(() => document.getElementById("mansion-menu-resume").click());

    // 4. The light carries an explicit crouched concealment cost while the
    // standing baseline remains exactly one.
    await page.keyboard.press("c");
    await page.evaluate(() => window.MrFeastFresh.setStealthLightOverrideForQA(0));
    await page.evaluate(() => window.MrFeastFresh.setFlashlightForQA(false, { silent: true }));
    await settlePlayer(page, 1.5);
    const stealthOff = await page.evaluate(() => window.MrFeastFresh.getStealth());
    await page.evaluate(() => window.MrFeastFresh.setFlashlightForQA(true, { silent: true }));
    await settlePlayer(page, 1.5);
    const stealthOn = await page.evaluate(() => window.MrFeastFresh.getStealth());
    assert(stealthOff.crouched && stealthOff.stanceVisibilityMultiplier === 0.5, "stealth comparison must preserve the authored crouch stance");
    assert(stealthOn.meter <= stealthOff.meter - 12, `flashlight use should clearly lower concealment; off=${stealthOff.meter} on=${stealthOn.meter}`);
    assert(stealthOn.effectiveVisibility >= stealthOff.effectiveVisibility + 0.12, `flashlight use should raise effective visibility; off=${stealthOff.effectiveVisibility} on=${stealthOn.effectiveVisibility}`);
    assert(stealthOn.mrFeastSightRangeMeters > stealthOff.mrFeastSightRangeMeters, "flashlight use should increase Mr. Feast's sight range");
    await page.keyboard.press("c");
    await settlePlayer(page, 0.5);
    assert((await page.evaluate(() => window.MrFeastFresh.getStealth())).effectiveVisibility === 1, "standing visibility must remain exactly 1 with the flashlight on");
    await page.evaluate(() => window.MrFeastFresh.setStealthLightOverrideForQA(null));
    console.log(`flashlight qa: stealth ${stealthOff.meter.toFixed(1)} off -> ${stealthOn.meter.toFixed(1)} on`);

    // 5. One camera-visible activation produces one recoverable security
    // event and one bounded Mr. Feast investigation, not lockdown or pursuit.
    await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loaded === true, null, { timeout: 120000 });
    console.log("flashlight qa: Mr. Feast loaded");
    const alert = await page.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.resetCameraSecurityForQA("restricted");
      window.MrFeastFresh.setCameraSoloForQA("cam-basement-archive");
      window.MrFeastFresh.setCameraSweepForQA("cam-basement-archive", 0);
      window.MrFeastFresh.setCameraOccludedForQA("cam-basement-archive", false);
      window.MrFeastFresh.placePlayerInCameraLaneForQA("cam-basement-archive", { distance: 4 });
      window.MrFeastFresh.setFlashlightForQA(false, { silent: true });
      window.MrFeastFresh.setFlashlightForQA(true);
      return {
        flashlight: window.MrFeastFresh.getFlashlightState(),
        security: window.MrFeastFresh.getCameraSecurityState(),
        host: window.MrFeastFresh.getMrFeastState(),
        pursuit: window.MrFeastFresh.getPursuitState?.() || null,
      };
    });
    assert(alert.flashlight.alertCount === 1 && alert.flashlight.lastAlert?.reason === "flashlight-use", `activation should create one flashlight-specific alert; ${JSON.stringify(alert.flashlight)}`);
    assert(alert.flashlight.lastAlert.cameraId === "cam-basement-archive", `alert should identify the plausible Archive camera; ${JSON.stringify(alert.flashlight.lastAlert)}`);
    assert(alert.security.alarm?.count === 0 && alert.security.mode === "restricted", "flashlight alert must stay recoverable rather than forcing permanent lockdown");
    assert(alert.host.security?.state === "responding", `Mr. Feast should begin the bounded camera response; state=${alert.host.security?.state}`);
    assert(!alert.host.pursuit?.active && !alert.pursuit?.active, "flashlight activation must not directly start pursuit");
    await page.evaluate(() => window.MrFeastFresh.advanceCameraSecurityForQA(2));
    assert((await flashlight(page)).alertCount === 1, "leaving the beam on must not spam security alerts");

    // An occluded camera cannot become an invented source.
    const occluded = await page.evaluate(async () => {
      window.MrFeastFresh.setFlashlightForQA(false, { silent: true });
      window.MrFeastFresh.setCameraOccludedForQA("cam-basement-archive", true);
      await window.advanceTime(1600);
      window.MrFeastFresh.setFlashlightForQA(true);
      return window.MrFeastFresh.getFlashlightState();
    });
    assert(occluded.alertCount === 1, "occluded flashlight use must not invent another camera alert");
    console.log("flashlight qa: bounded camera and host alert passed");

    // 6. Possession saves, but loading always extinguishes the transient beam
    // without manufacturing another alert.
    await page.evaluate(() => {
      window.MrFeastFresh.setCameraOccludedForQA("cam-basement-archive", false);
      window.MrFeastFresh.saveGameForQA();
      window.MrFeastFresh.loadGameForQA();
    });
    await page.waitForTimeout(180);
    light = await flashlight(page);
    state = await diagnostics(page);
    assert(light.collected && !light.on && !light.pickupVisible, "save/load should preserve possession and restore the beam switched off");
    assert(state.inventory.items.filter((id) => id === "basement-flashlight").length === 1, "loaded Bag should contain one flashlight");
    assert(light.alertCount === 0, "load hydration must clear transient flashlight alerts");
    console.log("flashlight qa: save/load passed");

    await context.close();

    // 7. Touch parity: collected players get one 44px Light button that
    // toggles the same state without overflowing the phone stage.
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const mobilePage = await mobileContext.newPage();
    mobilePage.on("pageerror", (error) => errors.push(`mobile: ${error.message}`));
    mobilePage.on("console", (message) => {
      const sourceUrl = message.location().url || "";
      if (message.type() === "error" && !/favicon\.ico/i.test(`${message.text()} ${sourceUrl}`)) errors.push(`mobile: ${message.text()}`);
    });
    await mobilePage.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await mobilePage.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await mobilePage.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    console.log("flashlight qa: mobile ready");
    const lightButton = mobilePage.locator("#mansion-flashlight-button");
    assert(!(await lightButton.isVisible()), "touch Light control must stay hidden before the flashlight is collected");
    await mobilePage.evaluate(() => window.MrFeastFresh.collectFlashlightForQA());
    assert(await lightButton.isVisible(), "touch Light control should become visible after collection");
    const buttonBox = await lightButton.boundingBox();
    assert(buttonBox && buttonBox.width >= 44 && buttonBox.height >= 44, `touch Light target must be at least 44px; box=${JSON.stringify(buttonBox)}`);
    await lightButton.click();
    assert((await flashlight(mobilePage)).on, "touch Light must toggle the same authoritative flashlight state");
    const overflow = await mobilePage.locator("#mansion-stage").evaluate((element) => element.scrollWidth - element.clientWidth);
    assert(overflow <= 0, `touch Light control must not overflow the stage; overflow=${overflow}`);
    await mobilePage.screenshot({ path: path.join(artifactDir, "flashlight-touch-mobile.png") });
    await mobileContext.close();

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast flashlight browser test: landing pickup, F/touch input, restrained beam, fixed shader topology, stealth cost, recoverable camera/Mr. Feast alert, persistence, and mobile layout passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast flashlight browser test failed: ${error.message}`);
  process.exitCode = 1;
});
