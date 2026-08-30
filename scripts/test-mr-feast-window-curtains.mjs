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
const port = Number(process.env.MR_FEAST_CURTAIN_TEST_PORT || (48000 + (process.pid % 14000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-window-curtains");

const REPRESENTATIVE_IDS = [
  "library-front-west",
  "library-front-center",
  "music-front-center",
  "music-front-east",
  "dining-rear-center",
  "dining-west-window",
  "ballroom-rear-west",
  "ballroom-rear-east",
  "upper-lounge-rear-west",
  "upper-lounge-rear-east",
];
const EXPECTED_WINDOW_WALL_COUNTS = Object.freeze({
  "main-front-wall": 6,
  "main-rear-wall": 8,
  "main-west-wall": 4,
  "main-east-wall": 5,
  "upper-front-wall": 7,
  "upper-rear-wall": 8,
  "upper-west-wall": 5,
  "upper-east-wall": 5,
  "basement-front-wall": 6,
  "basement-rear-wall": 6,
  "basement-west-wall": 4,
  "basement-east-wall": 3,
});
const EXPECTED_WINDOW_LEVEL_COUNTS = Object.freeze({
  "MAIN LEVEL": 23,
  "SECOND FLOOR": 25,
  "BASEMENT": 19,
});
const EXPECTED_CURTAIN_WALL_COUNTS = Object.freeze({
  "main-front-wall": 6,
  "main-rear-wall": 8,
  "main-west-wall": 4,
  "main-east-wall": 5,
  "upper-front-wall": 7,
  "upper-rear-wall": 8,
  "upper-west-wall": 5,
  "upper-east-wall": 5,
  "basement-front-wall": 0,
  "basement-rear-wall": 0,
  "basement-west-wall": 0,
  "basement-east-wall": 0,
});
const EXPECTED_CURTAIN_LEVEL_COUNTS = Object.freeze({
  "MAIN LEVEL": 23,
  "SECOND FLOOR": 25,
  "BASEMENT": 0,
});
const KITCHEN_CURTAIN_IDS = Object.freeze([
  "main-rear-window-pos-6-4",
  "main-rear-window-pos-9-4",
  "main-rear-window-pos-12-4",
  "main-east-window-neg-9-4",
  "main-east-window-neg-6-7",
]);
const EXPECTED_WINDOW_COUNT = Object.values(EXPECTED_WINDOW_WALL_COUNTS).reduce((total, count) => total + count, 0);
const EXPECTED_CURTAIN_COUNT = Object.values(EXPECTED_CURTAIN_WALL_COUNTS).reduce((total, count) => total + count, 0);
const EXPECTED_INTERACTIVE_COUNT = EXPECTED_CURTAIN_COUNT - KITCHEN_CURTAIN_IDS.length;
const EXPECTED_BARE_BASEMENT_COUNT = EXPECTED_WINDOW_LEVEL_COUNTS.BASEMENT;

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

async function bootPage(browser, errors, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const sourceUrl = message.location().url || "";
    if (message.type() === "error" && !/favicon\.ico/i.test(`${message.text()} ${sourceUrl}`)) {
      errors.push(message.text());
    }
  });
  await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  return { context, page };
}

async function curtainState(page) {
  return page.evaluate(() => window.MrFeastFresh.getWindowCurtainState());
}

async function stageCurtain(page, id) {
  const staged = await page.evaluate(
    (curtainId) => window.MrFeastFresh.placePlayerNearWindowCurtainForQA(curtainId),
    id,
  );
  assert(staged?.id === id, `QA should stage ${id}: ${JSON.stringify(staged)}`);
  try {
    await page.waitForFunction(
      (roomWord) => {
        const text = document.getElementById("mansion-prompt-text")?.textContent || "";
        return text.toLowerCase().includes("hide behind") && text.toLowerCase().includes(roomWord);
      },
      staged.room.toLowerCase().split(" ")[0],
      { timeout: 5000 },
    );
  } catch (_) {
    const miss = await page.evaluate(() => ({
      prompt: document.getElementById("mansion-prompt-text")?.textContent || "",
      ray: window.MrFeastFresh.inspectLookRay(),
      interaction: JSON.parse(window.render_game_to_text()).interactionRay,
    }));
    throw new Error(`${id} should expose its curtain prompt: staged=${JSON.stringify(staged)} miss=${JSON.stringify(miss)}`);
  }
  return staged;
}

async function captureStage(page, fileName) {
  const clip = await page.locator("#mansion-stage").boundingBox();
  assert(clip?.width > 0 && clip?.height > 0, `cannot capture ${fileName}: stage has no bounds`);
  await page.screenshot({ path: path.join(artifactDir, fileName), clip });
}

async function captureCurtainLuminance(page, fileName) {
  const clip = await page.locator("#mansion-stage").boundingBox();
  assert(clip?.width > 0 && clip?.height > 0, `cannot capture ${fileName}: stage has no bounds`);
  const buffer = await page.screenshot({ clip });
  await sharp(buffer).png().toFile(path.join(artifactDir, fileName));
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const region = {
    left: Math.floor(width * 0.12),
    top: Math.floor(height * 0.13),
    width: Math.max(1, Math.floor(width * 0.76)),
    height: Math.max(1, Math.floor(height * 0.68)),
  };
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let total = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    total += data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
  }
  return total / Math.max(1, data.length / info.channels);
}

async function run() {
  const [runtime, html] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  // Red-first source contract.
  assert(/const WINDOW_CURTAINS = Object\.freeze\(\{/.test(runtime), "missing named WINDOW_CURTAINS tuning table");
  assert(/class WindowCurtain/.test(runtime), "missing focused WindowCurtain system");
  assert(/function makeCurtainDamaskTexture/.test(runtime), "missing procedural woven-damask curtain texture");
  assert(/getWindowCurtainState/.test(runtime) && /placePlayerNearWindowCurtainForQA/.test(runtime), "missing focused curtain diagnostics and staging controls");
  const curtainMaterialSource = runtime.match(/curtainDamask:\s*new THREE\.MeshStandardMaterial\(\{[\s\S]*?\}\),\s*curtainLining:/)?.[0] || "";
  assert(curtainMaterialSource && !/emissive(?:Map|Intensity)?:/.test(curtainMaterialSource), "curtain damask must not emit light or glow when room circuits are off");
  assert(/basement-curtains-removed/.test(runtime), "basement windows need an explicit intentionally-bare curtain exclusion");
  assert(/interactive:\s*room !== "KITCHEN"/.test(runtime), "Kitchen curtains must be authored as decorative-only");
  assert(/frameBareExteriorWindowForQA/.test(runtime), "missing bare-window visual QA framing control");
  assert(/is-curtain-hiding/.test(html) && /curtain-crack-left/.test(html) && /curtain-crack-right/.test(html), "missing asymmetric curtain partial-view treatment");
  for (const id of REPRESENTATIVE_IDS) assert(runtime.includes(`id: "${id}"`), `missing preserved authored curtain override ${id}`);

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const errors = [];
    const desktop = await bootPage(browser, errors, { viewport: { width: 1280, height: 820 } });
    const page = desktop.page;

    // Complete exterior-window coverage, orientation, mounting, material, and geometry.
    let curtains = await curtainState(page);
    assert(curtains?.count === EXPECTED_CURTAIN_COUNT, `expected ${EXPECTED_CURTAIN_COUNT} main/upper curtain installations: ${JSON.stringify(curtains?.windowInventory || curtains)}`);
    const runtimeVersion = runtime.match(/MANSION_RUNTIME_VERSION = "([^"]+)"/)?.[1] || "";
    assert(runtimeVersion.length > 0, "curtain/furniture runtime cache identity is missing");
    assert(html.includes(`mr-feast-mansion.js?v=${runtimeVersion}`), `curtain page/runtime cache identities differ: ${runtimeVersion}`);
    assert(curtains.windowInventory?.total === EXPECTED_WINDOW_COUNT, `exterior window inventory should contain ${EXPECTED_WINDOW_COUNT}: ${JSON.stringify(curtains.windowInventory)}`);
    assert(curtains.windowInventory?.uncoveredIds?.length === 0, `no exterior window may be accidentally uncovered: ${JSON.stringify(curtains.windowInventory)}`);
    assert(JSON.stringify(curtains.windowInventory?.byWall) === JSON.stringify(EXPECTED_WINDOW_WALL_COUNTS), `exterior window inventory drifted: ${JSON.stringify(curtains.windowInventory)}`);
    assert(JSON.stringify(curtains.windowInventory?.byLevel) === JSON.stringify(EXPECTED_WINDOW_LEVEL_COUNTS), `exterior window levels drifted: ${JSON.stringify(curtains.windowInventory)}`);
    assert(JSON.stringify(curtains.curtainInventory?.byWall) === JSON.stringify(EXPECTED_CURTAIN_WALL_COUNTS), `curtain wall coverage drifted: ${JSON.stringify(curtains.curtainInventory)}`);
    assert(JSON.stringify(curtains.curtainInventory?.byLevel) === JSON.stringify(EXPECTED_CURTAIN_LEVEL_COUNTS), `curtain levels drifted: ${JSON.stringify(curtains.curtainInventory)}`);
    assert(curtains.interactiveCount === EXPECTED_INTERACTIVE_COUNT && curtains.decorativeOnlyCount === KITCHEN_CURTAIN_IDS.length, `expected ${EXPECTED_INTERACTIVE_COUNT} interactive and ${KITCHEN_CURTAIN_IDS.length} decorative-only curtains: ${JSON.stringify(curtains)}`);
    assert(curtains.windowInventory?.intentionallyBareIds?.length === EXPECTED_BARE_BASEMENT_COUNT, `all ${EXPECTED_BARE_BASEMENT_COUNT} basement windows should be intentionally bare: ${JSON.stringify(curtains.windowInventory)}`);
    assert(curtains.windowInventory.intentionallyBareIds.every((id) => id.startsWith("basement-")), `only basement windows may be intentionally bare: ${JSON.stringify(curtains.windowInventory)}`);
    assert(new Set(curtains.installations.map((entry) => entry.id)).size === EXPECTED_CURTAIN_COUNT, `curtain IDs must be unique: ${JSON.stringify(curtains.installations.map((entry) => entry.id))}`);
    assert(curtains.installations.every((entry) => entry.floor !== "BASEMENT"), `basement curtains must be removed entirely: ${JSON.stringify(curtains.installations.filter((entry) => entry.floor === "BASEMENT"))}`);
    assert(curtains.installations.every((entry) => entry.roomFacingDot >= 0.99 && entry.liningFacingDot <= -0.99), `every curtain must face damask into its room and lining toward glass: ${JSON.stringify(curtains.installations.map((entry) => ({ id: entry.id, roomFacingDot: entry.roomFacingDot, liningFacingDot: entry.liningFacingDot })))}`);
    assert(curtains.installations.every((entry) => entry.wallInset <= 0.36 && entry.wallInset >= 0.2), `curtains should sit close to their walls: ${JSON.stringify(curtains.installations.map((entry) => ({ id: entry.id, wallInset: entry.wallInset })))}`);
    assert(curtains.installations.every((entry) => entry.windowAlignmentError <= 0.001), `curtains must remain centered on their windows: ${JSON.stringify(curtains.installations.map((entry) => ({ id: entry.id, windowAlignmentError: entry.windowAlignmentError })))}`);
    assert(curtains.material.textureName === "window-curtain-woven-damask" && curtains.material.sharedTextureCount === 1, `curtains should share one woven damask texture: ${JSON.stringify(curtains.material)}`);
    assert(curtains.material.doubleSided && curtains.material.lined && !curtains.material.castsShadow, `curtain fabric contract is wrong: ${JSON.stringify(curtains.material)}`);
    assert(!curtains.material.emissiveMap && curtains.material.emissiveIntensity === 0, `curtains must receive switched room light without self-illumination: ${JSON.stringify(curtains.material)}`);
    assert(curtains.material.circuitResponsive && curtains.material.litFabricResponse > 0 && curtains.material.litFabricResponse <= 0.16, `curtain visibility lift must be subtle and owned by each room circuit: ${JSON.stringify(curtains.material)}`);
    assert(curtains.material.activeResponseCount === EXPECTED_CURTAIN_COUNT, `all lit-room curtain materials should carry the subtle circuit response: ${JSON.stringify(curtains.material)}`);
    assert(curtains.installations.every((entry) => entry.geometry.folds >= 8 && entry.geometry.rings >= 8 && entry.geometry.finials === 2 && entry.geometry.tiebacks === 2), `curtain hardware/folds are incomplete: ${JSON.stringify(curtains.installations)}`);
    assert(curtains.installations.every((entry) => entry.clearance.visualOverlaps.length === 0 && entry.clearance.egressOverlaps.length === 0), `curtains must not overlap props or their exit pockets: ${JSON.stringify(curtains.installations.map((entry) => ({ id: entry.id, clearance: entry.clearance })))}`);
    assert(curtains.installations.some((entry) => entry.crackSide === "left") && curtains.installations.some((entry) => entry.crackSide === "right"), "both left and right viewing cracks must be authored");
    assert(curtains.installations.every((entry) => entry.crackWidth >= 0.12 && entry.crackWidth <= 0.18), `cracks must stay narrow: ${JSON.stringify(curtains.installations)}`);

    // The material must visibly follow the room circuit instead of keeping a
    // self-lit red surface after every authored fixture has faded out.
    await stageCurtain(page, "main-east-window-pos-6-4");
    const litCurtainLuminance = await captureCurtainLuminance(page, "east-wall-curtain-lights-on-desktop.png");
    await page.evaluate(() => {
      window.MrFeastFresh.turnOffAllLights();
      return window.MrFeastFresh.advanceLightFade(4);
    });
    const darkCurtainLuminance = await captureCurtainLuminance(page, "east-wall-curtain-lights-off-desktop.png");
    const darkLighting = await page.evaluate(() => JSON.parse(window.render_game_to_text()).lighting);
    const darkCurtains = await curtainState(page);
    assert(darkLighting.allOff && darkLighting.activeLocalLights === 0, `curtain blackout comparison needs every room circuit off: ${JSON.stringify(darkLighting)}`);
    assert(darkCurtains.material.activeResponseCount === 0 && darkCurtains.installations.every((entry) => entry.fabricLightLift === 0), `every curtain visibility lift must extinguish with its room circuit: ${JSON.stringify(darkCurtains.material)}`);
    assert(darkCurtainLuminance <= litCurtainLuminance * 0.72, `curtains should become materially darker with room lights off: lit=${litCurtainLuminance.toFixed(1)} dark=${darkCurtainLuminance.toFixed(1)}`);
    await page.evaluate(() => {
      window.MrFeastFresh.turnOnAllLights();
      return window.MrFeastFresh.advanceLightFade(4);
    });

    // Every authored approach must resolve through the real center-look prompt.
    for (const id of curtains.installations.filter((entry) => entry.interactive).map((entry) => entry.id)) {
      const staged = await stageCurtain(page, id);
      assert(staged.clearance?.visualOverlaps === 0 && staged.clearance?.egressOverlaps === 0, `${id} should stage from a clear pocket: ${JSON.stringify(staged)}`);
      assert(staged.distance <= 2.23, `${id} staging should remain inside the real 2.35m interaction range: ${JSON.stringify(staged)}`);
    }

    // Kitchen fabric remains visual dressing but cannot enter the hidden state.
    for (const id of KITCHEN_CURTAIN_IDS) {
      const staged = await page.evaluate(
        (curtainId) => window.MrFeastFresh.placePlayerNearWindowCurtainForQA(curtainId),
        id,
      );
      assert(staged?.id === id && staged.interactive === false && staged.prompt === null, `Kitchen curtain ${id} should be decorative-only: ${JSON.stringify(staged)}`);
      await page.keyboard.press("e");
      assert(!(await page.evaluate(() => window.MrFeastFresh.isPlayerHidden())), `Kitchen curtain ${id} must not hide the player`);
    }

    // Preserve direct visual evidence for room-facing mounting, decorative
    // Kitchen drapery, the upper gallery, and the newly bare basement.
    for (const [id, fileName, framingDistance] of [
      ["main-east-window-pos-6-4", "east-wall-curtain-room-facing-desktop.png"],
      ["main-rear-window-pos-9-4", "kitchen-curtain-decorative-only-desktop.png", 2.75],
      ["upper-front-window-zero", "upper-gallery-curtain-covered-desktop.png", 3.8],
    ]) {
      if (framingDistance) {
        const framed = await page.evaluate(
          ([curtainId, distance]) => window.MrFeastFresh.frameWindowCurtainForQA(curtainId, distance),
          [id, framingDistance],
        );
        assert(framed?.id === id, `QA should frame ${id}: ${JSON.stringify(framed)}`);
      } else {
        await stageCurtain(page, id);
      }
      await captureStage(page, fileName);
    }
    const bareBasement = await page.evaluate(() => (
      window.MrFeastFresh.frameBareExteriorWindowForQA("basement-front-window-neg-11")
    ));
    assert(bareBasement?.id === "basement-front-window-neg-11" && bareBasement.curtainId === null, `QA should frame a bare basement window: ${JSON.stringify(bareBasement)}`);
    await captureStage(page, "basement-window-bare-desktop.png");

    // Real E enters a left-crack curtain, closes its textured panels, switches
    // off the flashlight, locks movement, and leaves looking available.
    await page.evaluate(() => window.MrFeastFresh.frameWindowCurtainForQA("library-front-west"));
    await captureStage(page, "library-curtain-open-desktop.png");
    await stageCurtain(page, "library-front-west");
    await page.evaluate(() => {
      window.MrFeastFresh.collectFlashlightForQA();
      window.MrFeastFresh.setFlashlightForQA(true, { silent: true });
    });
    await page.keyboard.press("e");
    await page.waitForFunction(() => window.MrFeastFresh.isPlayerHidden());
    await page.evaluate(() => window.MrFeastFresh.advanceWindowCurtainsForQA(1));
    curtains = await curtainState(page);
    let active = curtains.installations.find((entry) => entry.active);
    assert(active?.id === "library-front-west" && active.crackSide === "left" && active.openness <= 0.01, `left curtain should close around the player: ${JSON.stringify(active)}`);
    assert(!(await page.evaluate(() => window.MrFeastFresh.getFlashlightState().on)), "entering curtains must switch off the flashlight");
    const stageClassesLeft = await page.locator("#mansion-stage").getAttribute("class");
    assert(/is-curtain-hiding/.test(stageClassesLeft || "") && /curtain-crack-left/.test(stageClassesLeft || ""), `left-crack stage treatment is missing: ${stageClassesLeft}`);
    const hiddenBefore = await page.evaluate(() => JSON.parse(window.render_game_to_text()).player);
    await page.keyboard.down("w");
    await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(1.2));
    await page.keyboard.up("w");
    const hiddenAfter = await page.evaluate(() => JSON.parse(window.render_game_to_text()).player);
    assert(Math.hypot(hiddenAfter.x - hiddenBefore.x, hiddenAfter.z - hiddenBefore.z) <= 0.01, `movement must stay locked behind curtains: before=${JSON.stringify(hiddenBefore)} after=${JSON.stringify(hiddenAfter)}`);
    assert((await page.evaluate(() => JSON.parse(window.render_game_to_text()).hiding)).movementLocked, "curtain hiding must use the authoritative movement lock");
    await captureStage(page, "library-curtain-hidden-left-desktop.png");

    // Exit restores the open composition and can be reused immediately.
    await page.keyboard.press("e");
    await page.waitForFunction(() => !window.MrFeastFresh.isPlayerHidden());
    await page.evaluate(() => window.MrFeastFresh.advanceWindowCurtainsForQA(1));
    curtains = await curtainState(page);
    active = curtains.installations.find((entry) => entry.id === "library-front-west");
    assert(active.openness >= 0.99 && !active.active, `leaving should tie the curtain open: ${JSON.stringify(active)}`);
    const stageClassesOpen = await page.locator("#mansion-stage").getAttribute("class");
    assert(!/is-curtain-hiding|curtain-crack-(?:left|right)/.test(stageClassesOpen || ""), `curtain stage treatment should clear on exit: ${stageClassesOpen}`);
    await stageCurtain(page, "library-front-west");
    await page.keyboard.press("e");
    await page.waitForFunction(() => window.MrFeastFresh.isPlayerHidden());
    await page.keyboard.press("e");
    await page.waitForFunction(() => !window.MrFeastFresh.isPlayerHidden());

    // A right-authored set produces the opposite partial-view treatment.
    await stageCurtain(page, "upper-lounge-rear-east");
    await page.keyboard.press("e");
    await page.waitForFunction(() => window.MrFeastFresh.isPlayerHidden());
    await page.evaluate(() => window.MrFeastFresh.advanceWindowCurtainsForQA(1));
    const rightClasses = await page.locator("#mansion-stage").getAttribute("class");
    active = (await curtainState(page)).installations.find((entry) => entry.active);
    assert(active?.crackSide === "right" && /curtain-crack-right/.test(rightClasses || ""), `right-crack view should match diagnostics: ${JSON.stringify({ active, rightClasses })}`);
    await captureStage(page, "upper-lounge-curtain-hidden-right-desktop.png");
    await page.keyboard.press("e");
    await page.waitForFunction(() => !window.MrFeastFresh.isPlayerHidden());

    // Existing touch Interact owns the same enter/leave contract on phone.
    const mobile = await bootPage(browser, errors, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    const mobilePage = mobile.page;
    await stageCurtain(mobilePage, "ballroom-rear-east");
    await mobilePage.locator("#touch-interact").tap();
    await mobilePage.waitForFunction(() => window.MrFeastFresh.isPlayerHidden());
    await mobilePage.evaluate(() => window.MrFeastFresh.advanceWindowCurtainsForQA(1));
    assert(await mobilePage.locator("#mansion-hidden").isVisible(), "phone curtain hiding should retain the existing hidden-status pill");
    await captureStage(mobilePage, "ballroom-curtain-hidden-mobile.png");
    await mobilePage.locator("#touch-interact").tap();
    await mobilePage.waitForFunction(() => !window.MrFeastFresh.isPlayerHidden());
    await mobile.context.close();
    await desktop.context.close();

    assert(errors.length === 0, `unexpected browser errors: ${errors.join(" | ")}`);
    console.log(`Mr. Feast window curtain acceptance passed: ${EXPECTED_CURTAIN_COUNT} main/upper installations, ${EXPECTED_INTERACTIVE_COUNT} interactive hides, ${KITCHEN_CURTAIN_IDS.length} decorative-only Kitchen sets, ${EXPECTED_BARE_BASEMENT_COUNT} bare basement windows, real E/touch hiding, left/right partial views, movement lock, flashlight shutdown, exit, and reuse verified`);
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await run();
