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

async function readablePixelFraction(buffer, region, minimumLuminance = 8) {
  let image = sharp(buffer).removeAlpha();
  if (region) image = image.extract(region);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let readable = 0;
  const pixels = Math.max(1, data.length / info.channels);
  for (let index = 0; index < data.length; index += info.channels) {
    const luminance = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    if (luminance >= minimumLuminance) readable += 1;
  }
  return readable / pixels;
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
    centerReadableFraction: await readablePixelFraction(buffer, center),
    peripheryReadableFraction: await readablePixelFraction(buffer, periphery),
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
  assert(
    !/reportFlashlightUse/.test(runtime) && !/reason:\s*"flashlight-use"/.test(runtime),
    "flashlight visibility must not create its own camera offense or Mr. Feast response",
  );
  assert(/getFlashlightState/.test(runtime) && /setFlashlightForQA/.test(runtime), "focused flashlight diagnostics and QA controls are missing");
  assert(/locations:\s*Object\.freeze\(\[/.test(runtime), "flashlight should declare its three discoverable pickup locations");
  assert(/kitchen-under-sink/.test(runtime) && /upper-east-front-closet/.test(runtime) && /basement-archive/.test(runtime), "flashlight locations should cover the kitchen sink cabinet, an upper walk-in closet, and the basement");
  assert(/simple-flashlight-body/.test(runtime) && !/brass-cradle/.test(runtime), "pickup should be a simple household flashlight without the ornate cradle");
  assert(/id="mansion-flashlight-button"/.test(html), "touch Light control is missing");
  assert(/intensity:\s*112\b/.test(runtime), "flashlight beam should use the brighter 112 intensity tuning");
  assert(
    /distance:\s*11\.2\b/.test(runtime)
      && /angle:\s*0\.39\b/.test(runtime)
      && /penumbra:\s*0\.68\b/.test(runtime)
      && /decay:\s*1\.85\b/.test(runtime),
    "flashlight beam should use the broader-core, slower-falloff texture-readability tuning",
  );
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

    // 1. Fresh state and pre-collection input stay inert. Only open-shelf
    // copies are world-visible; under-sink and walk-in copies stay sealed
    // until their storage is opened.
    let light = await flashlight(page);
    assert(light && !light.collected && !light.on && light.pickupVisible, `fresh flashlight state is wrong: ${JSON.stringify(light)}`);
    assert(light.pickups?.length === 3, `fresh run should declare all three flashlight pickups: ${JSON.stringify(light.pickups)}`);
    const byId = Object.fromEntries((light.pickups || []).map((pickup) => [pickup.id, pickup]));
    assert(byId["basement-archive"]?.visible && byId["basement-archive"]?.registered, `open-shelf archive copy should be free: ${JSON.stringify(byId["basement-archive"])}`);
    assert(!byId["kitchen-under-sink"]?.visible && !byId["kitchen-under-sink"]?.registered && byId["kitchen-under-sink"]?.storageAccessible === false, `kitchen under-sink copy must stay sealed until the cabinet opens: ${JSON.stringify(byId["kitchen-under-sink"])}`);
    assert(!byId["upper-east-front-closet"]?.visible && !byId["upper-east-front-closet"]?.registered && byId["upper-east-front-closet"]?.storageAccessible === false, `walk-in copy must stay sealed until the closet opens: ${JSON.stringify(byId["upper-east-front-closet"])}`);
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
      // Closed storage must not offer the pickup prompt before the helper opens it.
      const sealed = await pickupPage.evaluate((id) => {
        const before = window.MrFeastFresh.getFlashlightState()?.pickups?.find((pickup) => pickup.id === id);
        return {
          visible: Boolean(before?.visible),
          registered: Boolean(before?.registered),
          storageAccessible: before?.storageAccessible,
        };
      }, locationId);
      assert(!sealed.visible && !sealed.registered && sealed.storageAccessible === false, `${locationId} must stay sealed before its storage opens: ${JSON.stringify(sealed)}`);
      const locationStaging = await pickupPage.evaluate((id) => window.MrFeastFresh.placePlayerNearFlashlightForQA(id), locationId);
      assert(locationStaging?.locationId === locationId, `QA staging should target ${locationId}; staging=${JSON.stringify(locationStaging)}`);
      assert(locationStaging?.storageOpen === true, `${locationId} QA staging should open its storage: ${JSON.stringify(locationStaging)}`);
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

    // The basement copy sits on the archive shelf next to the skull curio.
    const staging = await page.evaluate(() => window.MrFeastFresh.placePlayerNearFlashlightForQA("basement-archive"));
    assert(staging?.locationId === "basement-archive", `basement QA staging targeted the wrong pickup: ${JSON.stringify(staging)}`);
    assert(staging?.distanceToSkullShelf <= 0.6, `flashlight should sit on the skull shelf, not off on the stair wall; distance=${staging?.distanceToSkullShelf}`);
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
    assert(light.beam.authoredIntensity === 112, `beam should use the brighter authored intensity; beam=${JSON.stringify(light.beam)}`);
    assert(light.beam.distance >= 10.9 && light.beam.distance <= 11.5, `beam should travel farther without becoming room-wide; distance=${light.beam.distance}`);
    assert(
      light.beam.angle >= 0.37
        && light.beam.angle <= 0.41
        && light.beam.penumbra >= 0.64
        && light.beam.penumbra <= 0.72
        && light.beam.decay >= 1.8
        && light.beam.decay <= 1.9,
      `beam cone should keep a focused soft edge while improving its usable core; beam=${JSON.stringify(light.beam)}`,
    );
    assert(layoutOff.shaderSpotLights === layoutOn.shaderSpotLights && layoutOn.shaderSpotLights === layoutOn.shaderSpotBudget, `F must not change spot-light topology; off=${layoutOff.shaderSpotLights} on=${layoutOn.shaderSpotLights} budget=${layoutOn.shaderSpotBudget}`);
    const activations = light.activationCount;
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF", key: "f", repeat: true, bubbles: true })));
    assert((await flashlight(page)).on && (await flashlight(page)).activationCount === activations, "a repeated F keydown must not toggle or duplicate activation");
    const onVisual = await captureBeamMetrics(page, "flashlight-beam-on-desktop");
    const centerDelta = onVisual.center - offVisual.center;
    const peripheralDelta = onVisual.periphery - offVisual.periphery;
    const readableCoverageDelta = onVisual.centerReadableFraction - offVisual.centerReadableFraction;
    assert(centerDelta >= 7.5, `the brighter beam should materially lift its central patch; off=${offVisual.center.toFixed(1)} on=${onVisual.center.toFixed(1)}`);
    assert(
      readableCoverageDelta >= 0.24,
      `the beam should reveal substantially more of the Archive's mixed dark textures; off=${(offVisual.centerReadableFraction * 100).toFixed(1)}% on=${(onVisual.centerReadableFraction * 100).toFixed(1)}%`,
    );
    assert(peripheralDelta <= centerDelta * 0.5 + 1, `the longer beam must keep the spooky room edges dark; center delta=${centerDelta.toFixed(1)} edge delta=${peripheralDelta.toFixed(1)}`);
    assert(
      onVisual.peripheryReadableFraction <= offVisual.peripheryReadableFraction + 0.04,
      `texture readability should stay localized to the beam; off edge=${(offVisual.peripheryReadableFraction * 100).toFixed(1)}% on edge=${(onVisual.peripheryReadableFraction * 100).toFixed(1)}%`,
    );
    assert(onVisual.center < 160, `the brighter beam center should not wash out the Archive; luminance=${onVisual.center.toFixed(1)}`);
    console.log(`flashlight qa: beam center delta ${centerDelta.toFixed(1)}, readable texture coverage +${(readableCoverageDelta * 100).toFixed(1)} points, edge delta ${peripheralDelta.toFixed(1)}`);
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

    // 5. The flashlight changes visibility, not camera policy. Ordinary
    // show-space filming must stay harmless even when the beam is plainly on;
    // only an independently hostile basement or sabotage sighting may summon
    // Mr. Feast.
    await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loaded === true, null, { timeout: 120000 });
    console.log("flashlight qa: Mr. Feast loaded");
    const permittedFilming = await page.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.resetCameraSecurityForQA("show");
      window.MrFeastFresh.setCameraSoloForQA("cam-main-foyer");
      window.MrFeastFresh.setCameraSweepForQA("cam-main-foyer", 0);
      window.MrFeastFresh.setCameraOccludedForQA("cam-main-foyer", false);
      window.MrFeastFresh.placePlayerInCameraLaneForQA("cam-main-foyer", { distance: 4 });
      window.MrFeastFresh.setFlashlightForQA(true, { silent: true });
      window.MrFeastFresh.advanceCameraSecurityForQA(2);
      return {
        flashlight: window.MrFeastFresh.getFlashlightState(),
        security: window.MrFeastFresh.getCameraSecurityState(),
        host: window.MrFeastFresh.getMrFeastState(),
        pursuit: window.MrFeastFresh.getPursuitState?.() || null,
      };
    });
    assert(
      permittedFilming.flashlight.on
        && permittedFilming.flashlight.alertCount === 0
        && permittedFilming.security.observed
        && permittedFilming.security.permitted
        && permittedFilming.security.alarm?.count === 0
        && permittedFilming.host.security?.state === "patrol"
        && !permittedFilming.host.pursuit?.active
        && !permittedFilming.pursuit?.active,
      `an ordinary camera must not aggro on flashlight use: ${JSON.stringify(permittedFilming)}`,
    );
    await page.screenshot({ path: path.join(artifactDir, "flashlight-permitted-filming-desktop.png") });

    // A restricted basement camera remains dangerous, but because the player
    // is trespassing—not because the flashlight itself is a separate offense.
    const activationProbe = await page.evaluate(() => {
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
    assert(activationProbe.flashlight.alertCount === 0, `switching the beam on must not create a security offense; ${JSON.stringify(activationProbe)}`);
    assert(activationProbe.host.security?.state === "patrol", `switch-on alone should not summon Mr. Feast before camera observation; ${JSON.stringify(activationProbe.host.security)}`);
    const basementWarning = await page.evaluate(() => {
      window.MrFeastFresh.advanceCameraSecurityForQA(0.25);
      return {
        flashlight: window.MrFeastFresh.getFlashlightState(),
        security: window.MrFeastFresh.getCameraSecurityState(),
        host: window.MrFeastFresh.getMrFeastState(),
        pursuit: window.MrFeastFresh.getPursuitState?.() || null,
      };
    });
    assert(
      basementWarning.flashlight.alertCount === 0
        && basementWarning.security.observed
        && !basementWarning.security.permitted
        && basementWarning.security.alarm?.count === 0
        && basementWarning.host.security?.state === "patrol",
      `early basement observation should warn without a flashlight-specific response: ${JSON.stringify(basementWarning)}`,
    );
    const basementAlarm = await page.evaluate(() => {
      window.MrFeastFresh.advanceCameraSecurityForQA(6);
      return {
        flashlight: window.MrFeastFresh.getFlashlightState(),
        security: window.MrFeastFresh.getCameraSecurityState(),
        host: window.MrFeastFresh.getMrFeastState(),
        pursuit: window.MrFeastFresh.getPursuitState?.() || null,
      };
    });
    assert(
      basementAlarm.flashlight.alertCount === 0
        && basementAlarm.security.alarm?.count === 1
        && basementAlarm.security.alarm?.last?.reason === "restricted-trespass"
        && basementAlarm.host.security?.state === "responding"
        && !basementAlarm.host.pursuit?.active
        && !basementAlarm.pursuit?.active,
      `the basement should summon Mr. Feast for trespass, never for the flashlight itself: ${JSON.stringify(basementAlarm)}`,
    );

    // Turning the light on behind an occluder must not make the later visible
    // trespass safe. The ordinary camera acquisition should begin when the
    // player emerges, without creating a separate beam offense.
    const delayedTrespass = await page.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.resetCameraSecurityForQA("restricted");
      window.MrFeastFresh.setCameraSoloForQA("cam-basement-archive");
      window.MrFeastFresh.setCameraSweepForQA("cam-basement-archive", 0);
      window.MrFeastFresh.placePlayerInCameraLaneForQA("cam-basement-archive", { distance: 4 });
      window.MrFeastFresh.setCameraOccludedForQA("cam-basement-archive", true);
      window.MrFeastFresh.setFlashlightForQA(false, { silent: true });
      window.MrFeastFresh.setFlashlightForQA(true);
      const atActivation = window.MrFeastFresh.getFlashlightState();
      window.MrFeastFresh.advanceCameraSecurityForQA(2);
      const whileOccluded = window.MrFeastFresh.getCameraSecurityState();
      window.MrFeastFresh.setCameraOccludedForQA("cam-basement-archive", false);
      window.MrFeastFresh.advanceCameraSecurityForQA(6);
      return {
        atActivation,
        afterObservation: window.MrFeastFresh.getFlashlightState(),
        whileOccluded,
        security: window.MrFeastFresh.getCameraSecurityState(),
        host: window.MrFeastFresh.getMrFeastState(),
      };
    });
    assert(delayedTrespass.atActivation.alertCount === 0, `occluded activation should stay harmless: ${JSON.stringify(delayedTrespass.atActivation)}`);
    assert(!delayedTrespass.whileOccluded.observed && delayedTrespass.whileOccluded.alarm?.count === 0, `the occluder must prevent any invented trespass sighting: ${JSON.stringify(delayedTrespass.whileOccluded)}`);
    assert(
      delayedTrespass.afterObservation.alertCount === 0
        && delayedTrespass.security.alarm?.count === 1
        && delayedTrespass.security.alarm?.last?.reason === "restricted-trespass"
        && delayedTrespass.host.security?.state === "responding",
      `emerging in the basement should create only the normal trespass response: ${JSON.stringify(delayedTrespass)}`,
    );
    await page.screenshot({ path: path.join(artifactDir, "flashlight-policy-gated-basement-alarm-desktop.png") });

    // An occluded camera cannot become an invented source.
    const occluded = await page.evaluate(async () => {
      window.MrFeastFresh.setFlashlightForQA(false, { silent: true });
      window.MrFeastFresh.setCameraOccludedForQA("cam-basement-archive", true);
      await window.advanceTime(1600);
      window.MrFeastFresh.setFlashlightForQA(true);
      return {
        flashlight: window.MrFeastFresh.getFlashlightState(),
        security: window.MrFeastFresh.getCameraSecurityState(),
      };
    });
    assert(
      occluded.flashlight.alertCount === 0
        && occluded.security.alarm?.count === 1,
      `occluded flashlight use must not invent another security event: ${JSON.stringify(occluded)}`,
    );
    console.log("flashlight qa: policy-gated camera response passed");

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
    console.log("Mr. Feast flashlight browser test: landing pickup, F/touch input, restrained beam, fixed shader topology, stealth cost, policy-gated camera response, persistence, and mobile layout passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast flashlight browser test failed: ${error.message}`);
  process.exitCode = 1;
});
