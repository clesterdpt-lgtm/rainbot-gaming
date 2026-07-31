import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_BEDROOM_HIDING_TEST_PORT || (50000 + (process.pid % 12000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-bedroom-hiding");

const SUITES = Object.freeze([
  Object.freeze({ id: "west-front", label: "West Front Suite" }),
  Object.freeze({ id: "east-front", label: "East Front Suite" }),
  Object.freeze({ id: "primary", label: "Primary Suite" }),
  Object.freeze({ id: "east-rear", label: "East Rear Suite" }),
]);
const EXPECTED_IDS = SUITES.flatMap((suite) => [
  `${suite.id}-closet`,
  `${suite.id}-bed`,
]);

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

async function bedroomState(page) {
  return page.evaluate(() => window.MrFeastFresh.getBedroomHidingState());
}

async function stageSpot(page, id) {
  const staged = await page.evaluate(
    (spotId) => window.MrFeastFresh.placePlayerNearBedroomHideForQA(spotId),
    id,
  );
  assert(staged?.id === id, `QA should stage ${id}: ${JSON.stringify(staged)}`);
  await page.waitForFunction(
    (spotId) => {
      const state = window.MrFeastFresh.getBedroomHidingState();
      const entry = state?.spots?.find((spot) => spot.id === spotId);
      const prompt = document.getElementById("mansion-prompt-text")?.textContent || "";
      return entry?.prompt && prompt === entry.prompt;
    },
    id,
    { timeout: 5000 },
  );
  return staged;
}

async function captureStage(page, fileName) {
  const box = await page.locator("#mansion-stage").boundingBox();
  assert(box, "mansion stage should have a captureable box");
  await page.screenshot({ path: path.join(artifactDir, fileName), clip: box });
}

async function run() {
  const [runtime, html] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  // Red-first contract: the source gate fails before Chromium while the
  // bedroom hiding table, physical bed gap, and focused QA surface are absent.
  assert(/const BEDROOM_HIDING = Object\.freeze\(\{/.test(runtime), "missing named BEDROOM_HIDING tuning table");
  for (const id of EXPECTED_IDS) {
    assert(runtime.includes(`"${id}"`), `missing authored bedroom hiding id ${id}`);
  }
  assert(/walk-in-hiding-interaction/.test(runtime), "walk-in closets need a dedicated interior hiding target");
  assert(/under-bed-hiding-interaction/.test(runtime), "beds need a dedicated low hiding target");
  assert(/underBedInteractionWidth:\s*0\.34/.test(runtime) && /underBedInteractionHeight:\s*0\.72/.test(runtime), "under-bed hiding needs a forgiving side interaction target");
  assert(/underBedInteractionDepth:\s*1\.45/.test(runtime) && /underBedTargetOutset:\s*0\.16/.test(runtime), "under-bed hiding target should cover a useful approach span outside the bed rail");
  assert(/bed-side-rail/.test(runtime) && /bed-leg/.test(runtime), "beds need a real raised frame with visible under-bed clearance");
  assert(/playerCameraAnchor/.test(runtime) && /cameraPosition/.test(runtime), "under-bed hiding needs a low first-person camera anchor");
  assert(/underBedRangeMultiplier/.test(runtime) && /breathHidingKind:\s*"under-bed"/.test(runtime), "under-bed hiding must participate in breath-stealth authority");
  assert(/is-under-bed-hiding/.test(html), "under-bed hiding needs a responsive low-slit stage treatment");
  assert(
    /getBedroomHidingState/.test(runtime)
      && /placePlayerNearBedroomHideForQA/.test(runtime)
      && /advanceBedroomHidingForQA/.test(runtime),
    "focused bedroom hiding diagnostics and QA controls are missing",
  );

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

    let hiding = await bedroomState(page);
    assert(hiding?.spots?.length === 8, `four bedrooms should expose one closet and one bed hide each: ${JSON.stringify(hiding)}`);
    assert(hiding.spots.filter((spot) => spot.category === "bedroom-closet").length === 4, `expected four bedroom closet hides: ${JSON.stringify(hiding.spots)}`);
    assert(hiding.spots.filter((spot) => spot.category === "under-bed").length === 4, `expected four under-bed hides: ${JSON.stringify(hiding.spots)}`);
    assert(EXPECTED_IDS.every((id) => hiding.spots.some((spot) => spot.id === id)), `bedroom hiding ids are incomplete: ${JSON.stringify(hiding.spots)}`);
    assert(SUITES.every((suite) => hiding.spots.filter((spot) => spot.suiteId === suite.id).length === 2), `every suite should own exactly two hides: ${JSON.stringify(hiding.spots)}`);

    for (const id of EXPECTED_IDS) {
      const staged = await stageSpot(page, id);
      assert(staged.distance <= 2.35, `${id} must stage within the real interaction range: ${JSON.stringify(staged)}`);
      if (id.endsWith("-closet")) {
        assert(staged.enclosureOpen && staged.interiorVisible, `${id} should be entered through an open walk-in: ${JSON.stringify(staged)}`);
      }
      await page.evaluate(() => {
        window.MrFeastFresh.collectFlashlightForQA();
        window.MrFeastFresh.setFlashlightForQA(true, { silent: true });
      });
      await page.keyboard.press("e");
      await page.waitForFunction(() => window.MrFeastFresh.isPlayerHidden());
      await page.evaluate(() => window.MrFeastFresh.advanceBedroomHidingForQA(1));
      await page.waitForTimeout(80);

      hiding = await bedroomState(page);
      const active = hiding.spots.find((spot) => spot.id === id);
      const rendered = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
      assert(active?.active && hiding.activeId === id, `${id} should own the authoritative hidden state: ${JSON.stringify(hiding)}`);
      assert(rendered.hiding.active && rendered.hiding.movementLocked && rendered.player.hidden, `${id} should reuse the authoritative movement/threat concealment state`);
      assert(rendered.player.movement.mode === "hidden", `${id} should report hidden movement mode: ${JSON.stringify(rendered.player.movement)}`);
      assert(!(await page.evaluate(() => window.MrFeastFresh.getFlashlightState().on)), `${id} should switch off the flashlight`);
      if (active.category === "bedroom-closet") {
        assert(!active.enclosureOpen, `${id} doors should close around the hidden player: ${JSON.stringify(active)}`);
        assert(hiding.activeCameraHeight >= 1.2, `${id} should retain an upright inside-closet view: ${JSON.stringify(hiding)}`);
      } else {
        const classes = await page.locator("#mansion-stage").getAttribute("class");
        assert(/is-under-bed-hiding/.test(classes || ""), `${id} should apply the low under-bed view treatment: ${classes}`);
        assert(hiding.activeCameraHeight >= 0.16 && hiding.activeCameraHeight <= 0.34, `${id} camera should sit in the physical under-bed gap: ${JSON.stringify(hiding)}`);
      }

      if (id === "west-front-closet" || id === "west-front-bed") {
        const before = rendered.player;
        await page.keyboard.down("w");
        await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(1.1));
        await page.keyboard.up("w");
        const after = await page.evaluate(() => JSON.parse(window.render_game_to_text()).player);
        assert(Math.hypot(after.x - before.x, after.z - before.z) <= 0.01, `${id} must lock movement: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
        await captureStage(page, id === "west-front-closet" ? "west-front-closet-hidden-desktop.png" : "west-front-under-bed-hidden-desktop.png");
      }

      await page.keyboard.press("e");
      await page.waitForFunction(() => !window.MrFeastFresh.isPlayerHidden());
      await page.evaluate(() => window.MrFeastFresh.advanceBedroomHidingForQA(1));
      hiding = await bedroomState(page);
      const exited = hiding.spots.find((spot) => spot.id === id);
      assert(!hiding.activeId && !exited.active, `${id} should clear hidden ownership on exit: ${JSON.stringify(hiding)}`);
      if (exited.category === "bedroom-closet") {
        assert(exited.enclosureOpen, `${id} should reopen for a clear exit: ${JSON.stringify(exited)}`);
      }
      const classes = await page.locator("#mansion-stage").getAttribute("class");
      assert(!/is-under-bed-hiding/.test(classes || ""), `${id} should clear its stage treatment after exit: ${classes}`);
    }

    const mobile = await bootPage(browser, errors, {
      viewport: { width: 390, height: 844 },
      screen: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    const mobilePage = mobile.page;
    const interact = mobilePage.locator("#touch-interact");
    const interactBox = await interact.boundingBox();
    assert(interactBox && interactBox.width >= 44 && interactBox.height >= 44, `touch Interact should remain at least 44px: ${JSON.stringify(interactBox)}`);

    for (const id of ["east-front-closet", "east-front-bed"]) {
      await stageSpot(mobilePage, id);
      await interact.tap();
      await mobilePage.waitForFunction(() => window.MrFeastFresh.isPlayerHidden());
      await mobilePage.evaluate(() => window.MrFeastFresh.advanceBedroomHidingForQA(1));
      assert(await mobilePage.locator("#mansion-hidden").isVisible(), `${id} should retain the hidden status on phone`);
      await captureStage(mobilePage, id.endsWith("-closet") ? "east-front-closet-hidden-mobile.png" : "east-front-under-bed-hidden-mobile.png");
      await interact.tap();
      await mobilePage.waitForFunction(() => !window.MrFeastFresh.isPlayerHidden());
      await mobilePage.evaluate(() => window.MrFeastFresh.advanceBedroomHidingForQA(1));
    }

    await mobile.context.close();
    await desktop.context.close();
    assert(errors.length === 0, `unexpected browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast bedroom hiding acceptance passed: four closets, four raised beds, real E/touch entry and exit, low under-bed camera, closed closet doors, movement lock, flashlight shutdown, responsive views, and clean browser consoles verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await run();
