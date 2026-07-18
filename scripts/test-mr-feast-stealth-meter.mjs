import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_STEALTH_TEST_PORT || (46000 + (process.pid % 16000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-stealth-meter");

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

async function stealthState(page) {
  return page.evaluate(() => window.MrFeastFresh.getStealth());
}

async function settle(page, seconds = 1.2) {
  await page.evaluate((value) => window.MrFeastFresh.advancePlayerForQA(value), seconds);
}

async function crouchMeterWhileMoving(page, seconds = 1.2) {
  await page.keyboard.down("w");
  await page.evaluate((value) => window.MrFeastFresh.advancePlayerForQA(value), seconds);
  const during = await stealthState(page);
  await page.keyboard.up("w");
  await page.waitForTimeout(40);
  return during;
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

    // 1. Standing exposes the Milestone 35 stance contract untouched, keeps the
    // meter HUD hidden, and reports full stealth telemetry for QA.
    await page.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    await settle(page, 0.6);
    let state = await diagnostics(page);
    assert(state.player.movement.stealth.visibilityMultiplier === 1 && state.player.movement.stealth.noiseMultiplier === 1, "standing must preserve the exact Milestone 35 neutral stance multipliers");
    assert(Number.isFinite(state.player.movement.stealth.meter), "movement.stealth.meter should always report a numeric concealment score");
    assert(await page.locator("#mansion-stealth").isHidden(), "the stealth meter HUD must stay hidden while standing");
    let stealth = await stealthState(page);
    assert(stealth && Number.isFinite(stealth.meter) && Number.isFinite(stealth.lightExposure) && Number.isFinite(stealth.motionActivity) && Number.isFinite(stealth.effectiveVisibility), "getStealth() should expose meter, light, motion, and effective visibility telemetry");
    assert(!stealth.meterVisible && !stealth.crouched, "standing telemetry should mark the meter not visible");
    assert(stealth.effectiveVisibility === 1, "standing effective visibility must stay exactly at the authored baseline of 1");
    assert(stealth.mrFeastSightRangeMeters === 9, "standing must leave Mr. Feast's authored 9m sight range untouched");

    // 2. Crouching shows the meter, keeps the authored 0.5 stance multiplier,
    // and improves effective visibility beyond it while motionless.
    await page.keyboard.press("c");
    await settle(page, 1.4);
    state = await diagnostics(page);
    stealth = await stealthState(page);
    assert(state.player.movement.crouched, "C should crouch the player");
    assert(state.player.movement.stealth.visibilityMultiplier === 0.5, "crouch must preserve the exact authored 0.5 stance visibility multiplier");
    assert(await page.locator("#mansion-stealth").isVisible(), "crouching should reveal the stealth meter HUD");
    assert(stealth.meterVisible && stealth.crouched, "crouched telemetry should mark the meter visible");
    const meterAria = await page.locator("#mansion-stealth").getAttribute("aria-valuenow");
    assert(Math.abs(Number(meterAria) - Math.round(stealth.meter)) <= 1, `stealth HUD aria value should mirror telemetry; aria=${meterAria} meter=${stealth.meter}`);
    assert((await page.locator("#mansion-stealth").getAttribute("role")) === "meter", "stealth HUD should be an accessible meter");
    assert(/stealth/i.test(await page.locator("#mansion-stealth-mode").textContent() || ""), "stealth HUD should label itself");
    assert(stealth.effectiveVisibility < 0.5, "a motionless crouch should improve effective visibility beyond the 0.5 stance baseline");
    assert(stealth.effectiveVisibility >= 0.1, "effective visibility must respect the fairness floor");
    const litStillMeter = stealth.meter;
    assert(litStillMeter > 40 && litStillMeter < 85, `a lit motionless crouch should read mid-high on the meter; meter=${litStillMeter}`);

    // 3. Moving while crouched lowers the meter and raises effective
    // visibility; stopping recovers both.
    const movingStealth = await crouchMeterWhileMoving(page, 1.2);
    assert(movingStealth.meter < litStillMeter - 8, `crouch-walking should clearly lower the stealth meter; still=${litStillMeter} moving=${movingStealth.meter}`);
    assert(movingStealth.motionActivity > 0.5, `crouch-walking should raise motion activity; motion=${movingStealth.motionActivity}`);
    assert(movingStealth.effectiveVisibility > stealth.effectiveVisibility, "moving while crouched should be more visible than holding still");
    assert(movingStealth.effectiveVisibility <= 0.5 + 0.0001, "crouch-walking must never exceed the authored 0.5 stance visibility");
    await settle(page, 2.2);
    const recoveredStealth = await stealthState(page);
    assert(recoveredStealth.meter > movingStealth.meter + 5, `standing still should recover the stealth meter; moving=${movingStealth.meter} recovered=${recoveredStealth.meter}`);
    const litFill = await page.locator("#mansion-stealth-fill").evaluate((fill) => fill.style.width);
    assert(/%$/.test(litFill), "stealth HUD fill should track the meter percentage");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "stealth-meter-crouch-lit-desktop.png") });

    // 4. Darkness raises the meter and lowers effective visibility through the
    // real light circuits.
    const litLightExposure = recoveredStealth.lightExposure;
    assert(litLightExposure > 0.3, `the lit foyer should register meaningful light exposure; light=${litLightExposure}`);
    await page.evaluate(() => {
      window.MrFeastFresh.turnOffAllLights();
      window.MrFeastFresh.advanceLightFade(4);
    });
    await settle(page, 1.2);
    const darkStealth = await stealthState(page);
    assert(darkStealth.lightExposure < 0.15, `all lights off should drop sampled light exposure; light=${darkStealth.lightExposure}`);
    assert(darkStealth.meter > recoveredStealth.meter + 10, `darkness should clearly raise the stealth meter; lit=${recoveredStealth.meter} dark=${darkStealth.meter}`);
    assert(darkStealth.meter >= 85, `a dark motionless crouch should read as near-total concealment; meter=${darkStealth.meter}`);
    assert(darkStealth.effectiveVisibility < recoveredStealth.effectiveVisibility, "darkness should lower crouched effective visibility");
    assert(darkStealth.mrFeastSightRangeMeters < 4.6, `a dark motionless crouch should strangle Mr. Feast's sight range; range=${darkStealth.mrFeastSightRangeMeters}`);
    assert(darkStealth.mrFeastSightRangeMeters >= 2, "the scaled sight range must keep a close-quarters fairness floor");
    await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "stealth-meter-crouch-dark-desktop.png") });

    // 5. Moving in darkness still costs concealment on the meter.
    const darkMoving = await crouchMeterWhileMoving(page, 1.2);
    assert(darkMoving.meter < darkStealth.meter - 8, `movement should still cost concealment in darkness; still=${darkStealth.meter} moving=${darkMoving.meter}`);
    await settle(page, 2.2);

    // 6. The deterministic light override pins both endpoints for QA.
    const overrideBright = await page.evaluate(() => {
      window.MrFeastFresh.setStealthLightOverrideForQA(1);
      window.MrFeastFresh.advancePlayerForQA(1.2);
      return window.MrFeastFresh.getStealth();
    });
    const overrideDark = await page.evaluate(() => {
      window.MrFeastFresh.setStealthLightOverrideForQA(0);
      window.MrFeastFresh.advancePlayerForQA(1.2);
      return window.MrFeastFresh.getStealth();
    });
    await page.evaluate(() => window.MrFeastFresh.setStealthLightOverrideForQA(null));
    assert(overrideBright.lightExposure > 0.9 && overrideDark.lightExposure < 0.1, "the QA light override should pin both exposure endpoints");
    assert(overrideDark.effectiveVisibility < overrideBright.effectiveVisibility, "the QA light override should drive effective visibility");

    // 7. Mr. Feast's witnessed check consumes the scaled sight range: the same
    // mid-range infraction is seen standing in light but missed by a dark,
    // motionless crouch, while a point-blank crouch stays seen for fairness.
    await page.keyboard.press("c");
    await page.evaluate(() => {
      window.MrFeastFresh.turnOnAllLights();
      window.MrFeastFresh.advanceLightFade(4);
    });
    await settle(page, 1.2);
    assert(!(await diagnostics(page)).player.movement.crouched, "pressing C again should stand the player back up");
    await page.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loaded === true, null, { timeout: 120000 });
    const witnessSetup = await page.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 8.2, y: 0, z: 7.8, yaw: Math.PI / 2 });
      window.MrFeastFresh.teleport("tamperMusicPortrait");
      window.MrFeastFresh.advancePlayerForQA(0.6);
      const host = window.MrFeastFresh.getMrFeastState();
      const player = JSON.parse(window.render_game_to_text()).player;
      return {
        distance: Math.hypot(player.x - host.position.x, player.z - host.position.z),
        stealth: window.MrFeastFresh.getStealth(),
        result: window.MrFeastFresh.reportInfractionForQA("portrait"),
      };
    });
    assert(witnessSetup.distance > 3 && witnessSetup.distance < 9, `witness staging should sit mid-range inside the authored cone; distance=${witnessSetup.distance}`);
    assert(witnessSetup.result?.accepted && witnessSetup.stealth.mrFeastSightRangeMeters === 9, `a standing lit infraction at ${witnessSetup.distance.toFixed(2)}m must stay witnessed`);

    const stealthEvasion = await page.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.setMrFeastPoseForQA({ action: "idle", x: 8.2, y: 0, z: 7.8, yaw: Math.PI / 2 });
      window.MrFeastFresh.teleport("tamperMusicPortrait");
      window.MrFeastFresh.turnOffAllLights();
      window.MrFeastFresh.advanceLightFade(4);
      return null;
    });
    void stealthEvasion;
    await page.keyboard.press("c");
    await settle(page, 1.6);
    const darkCrouchWitness = await page.evaluate(() => ({
      stealth: window.MrFeastFresh.getStealth(),
      result: window.MrFeastFresh.reportInfractionForQA("portrait"),
    }));
    assert(darkCrouchWitness.stealth.crouched, "the evasion probe must run crouched");
    assert(darkCrouchWitness.stealth.mrFeastSightRangeMeters < 4.6, `the dark crouch probe should shrink his sight; range=${darkCrouchWitness.stealth.mrFeastSightRangeMeters}`);
    assert(darkCrouchWitness.stealth.mrFeastSightRangeMeters < witnessSetup.distance, "the scaled sight range must fall inside the staged infraction distance for a meaningful evasion probe");
    assert(darkCrouchWitness.result === null, "the same mid-range infraction must go unseen from a dark, motionless crouch");

    const pointBlank = await page.evaluate(() => {
      window.MrFeastFresh.placePlayerNearMrFeastForQA(1.6, 0);
      window.MrFeastFresh.advancePlayerForQA(0.4);
      return {
        stealth: window.MrFeastFresh.getStealth(),
        result: window.MrFeastFresh.reportInfractionForQA("portrait"),
      };
    });
    assert(pointBlank.result?.accepted, "a point-blank infraction must stay witnessed even from a dark crouch");
    await page.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.turnOnAllLights();
      window.MrFeastFresh.advanceLightFade(4);
    });

    // 8. The hiding-spot and camera contracts keep their authority: hiding pegs
    // concealment, and the camera system consumes the crouch-scaled effective
    // visibility (already asserted in the camera suite via the stance pin).
    await page.evaluate(() => window.MrFeastFresh.enterHideSpotForQA("coat"));
    await settle(page, 0.4);
    const hiddenStealth = await stealthState(page);
    assert(hiddenStealth.meter >= 99, `entering a hiding spot should peg the concealment score; meter=${hiddenStealth.meter}`);
    assert(await page.locator("#mansion-stealth").isHidden(), "the crouch meter HUD should yield to the dedicated hidden status pill");
    await page.evaluate(() => window.MrFeastFresh.leaveHideSpotForQA());
    await settle(page, 0.4);

    await context.close();

    // 9. Phone layout: crouch stays a desktop control for now, so the meter
    // must remain hidden without disturbing the touch HUD.
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
    assert(await mobilePage.locator("#mansion-stealth").isHidden(), "the stealth meter must stay hidden on the touch layout while crouch remains desktop-only");
    const mobileOverflow = await mobilePage.evaluate(() => {
      const stage = document.getElementById("mansion-stage");
      return stage.scrollWidth - stage.clientWidth;
    });
    assert(mobileOverflow <= 0, "the stealth HUD must not add horizontal overflow to the phone layout");
    await mobilePage.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "stealth-hud-mobile.png") });
    await mobileContext.close();

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast stealth meter browser test: crouch meter HUD, movement and light response, effective visibility, scaled Mr. Feast sight, fairness floor, hiding handoff, and phone layout passed");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(`Mr. Feast stealth meter browser test failed: ${error.message}`);
  process.exitCode = 1;
});
