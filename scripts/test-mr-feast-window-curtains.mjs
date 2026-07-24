import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_CURTAIN_TEST_PORT || (48000 + (process.pid % 14000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-window-curtains");

const EXPECTED_IDS = [
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
  assert(/is-curtain-hiding/.test(html) && /curtain-crack-left/.test(html) && /curtain-crack-right/.test(html), "missing asymmetric curtain partial-view treatment");
  assert(/MANSION_RUNTIME_VERSION = "20260724-window-curtain-hiding-1"/.test(runtime), "curtain runtime cache identity is stale");
  assert(/mr-feast-mansion\.js\?v=20260724-window-curtain-hiding-1/.test(html), "curtain page cache identity is stale");
  for (const id of EXPECTED_IDS) assert(runtime.includes(`id: "${id}"`), `missing authored curtain ${id}`);
  assert(!/basement-(?:front|rear|west|east)-wall[^]*?curtain:/i.test(runtime), "basement windows must remain curtain-free");

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

    // Authored placement, exclusions, material, and geometry.
    let curtains = await curtainState(page);
    assert(curtains?.count === 10, `expected ten curtain installations: ${JSON.stringify(curtains)}`);
    assert(JSON.stringify(curtains.installations.map((entry) => entry.id).sort()) === JSON.stringify([...EXPECTED_IDS].sort()), `curtain IDs drifted: ${JSON.stringify(curtains.installations)}`);
    const roomCounts = Object.fromEntries(["LIBRARY", "MUSIC ROOM", "DINING ROOM", "BALLROOM", "REAR LOUNGE"].map((room) => [
      room,
      curtains.installations.filter((entry) => entry.room === room).length,
    ]));
    assert(Object.values(roomCounts).every((count) => count === 2), `each authored room needs exactly two curtains: ${JSON.stringify(roomCounts)}`);
    assert(curtains.excludedKinds.includes("kitchen") && curtains.excludedKinds.includes("basement") && curtains.excludedKinds.includes("headboard") && curtains.excludedKinds.includes("gallery"), `curtain exclusions are incomplete: ${JSON.stringify(curtains.excludedKinds)}`);
    assert(curtains.material.textureName === "window-curtain-woven-damask" && curtains.material.sharedTextureCount === 1, `curtains should share one woven damask texture: ${JSON.stringify(curtains.material)}`);
    assert(curtains.material.doubleSided && curtains.material.lined && !curtains.material.castsShadow, `curtain fabric contract is wrong: ${JSON.stringify(curtains.material)}`);
    assert(curtains.installations.every((entry) => entry.geometry.folds >= 8 && entry.geometry.rings >= 8 && entry.geometry.finials === 2 && entry.geometry.tiebacks === 2), `curtain hardware/folds are incomplete: ${JSON.stringify(curtains.installations)}`);
    assert(curtains.installations.every((entry) => entry.clearance.visualOverlaps.length === 0 && entry.clearance.egressOverlaps.length === 0), `curtains must not overlap props or their exit pockets: ${JSON.stringify(curtains.installations.map((entry) => ({ id: entry.id, clearance: entry.clearance })))}`);
    assert(curtains.installations.some((entry) => entry.crackSide === "left") && curtains.installations.some((entry) => entry.crackSide === "right"), "both left and right viewing cracks must be authored");
    assert(curtains.installations.every((entry) => entry.crackWidth >= 0.12 && entry.crackWidth <= 0.18), `cracks must stay narrow: ${JSON.stringify(curtains.installations)}`);

    // Every authored approach must resolve through the real center-look prompt.
    for (const id of EXPECTED_IDS) {
      const staged = await stageCurtain(page, id);
      assert(staged.clearance?.visualOverlaps === 0 && staged.clearance?.egressOverlaps === 0, `${id} should stage from a clear pocket: ${JSON.stringify(staged)}`);
      assert(staged.distance <= 1.35, `${id} staging should remain inside interaction range: ${JSON.stringify(staged)}`);
    }

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
    console.log("Mr. Feast window curtain acceptance passed: ten clear textured installations, real E/touch hiding, left/right partial views, movement lock, flashlight shutdown, exit, and reuse verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await run();
