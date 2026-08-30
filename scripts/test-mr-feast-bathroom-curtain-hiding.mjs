import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_BATHROOM_CURTAIN_TEST_PORT || (52000 + (process.pid % 10000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-bathroom-curtains");

const EXPECTED = Object.freeze([
  Object.freeze({ id: "main-hall-bathtub-curtain", kind: "tub", floor: "MAIN LEVEL" }),
  Object.freeze({ id: "main-hall-shower-curtain", kind: "shower", floor: "MAIN LEVEL" }),
  Object.freeze({ id: "upper-grand-bathtub-curtain", kind: "tub", floor: "SECOND FLOOR" }),
  Object.freeze({ id: "upper-grand-shower-curtain", kind: "shower", floor: "SECOND FLOOR" }),
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

async function bathroomCurtainState(page) {
  return page.evaluate(() => window.MrFeastFresh.getBathroomCurtainState());
}

async function stageCurtain(page, id) {
  const staged = await page.evaluate(
    (curtainId) => window.MrFeastFresh.placePlayerNearBathroomCurtainForQA(curtainId),
    id,
  );
  assert(staged?.id === id, `QA should stage ${id}: ${JSON.stringify(staged)}`);
  await page.waitForFunction(
    (curtainId) => {
      const state = window.MrFeastFresh.getBathroomCurtainState();
      const entry = state?.installations?.find((curtain) => curtain.id === curtainId);
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

  // Red-first source contract: bathroom curtains must be real authored hide
  // locations using the mansion's existing concealment authority.
  assert(/const BATHROOM_CURTAINS = Object\.freeze\(\{/.test(runtime), "missing named BATHROOM_CURTAINS tuning table");
  assert(/class BathroomCurtain/.test(runtime), "missing focused BathroomCurtain system");
  for (const { id } of EXPECTED) assert(runtime.includes(`"${id}"`), `missing authored bathroom curtain ${id}`);
  assert(/bathroom-curtain-interaction/.test(runtime), "bathroom curtains need dedicated interaction targets");
  assert(/category:\s*"bathroom-curtain"/.test(runtime), "bathroom curtains must use authoritative HidingSpot entries");
  assert(/bathroomCurtain/.test(runtime) && /bathroom-curtain-woven-linen/.test(runtime), "bathroom curtains need a dedicated textured fabric material");
  assert(/is-bathroom-curtain-hiding/.test(html), "bathroom curtains need a distinct responsive hiding view");
  assert(
    /getBathroomCurtainState/.test(runtime)
      && /placePlayerNearBathroomCurtainForQA/.test(runtime)
      && /advanceBathroomCurtainsForQA/.test(runtime),
    "focused bathroom curtain diagnostics and QA controls are missing",
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

    let curtainState = await bathroomCurtainState(page);
    assert(curtainState?.count === 4, `expected four bathroom curtain hides: ${JSON.stringify(curtainState)}`);
    assert(curtainState.tubCount === 2 && curtainState.showerCount === 2, `expected two tub and two shower curtains: ${JSON.stringify(curtainState)}`);
    assert(EXPECTED.every(({ id, kind, floor }) => curtainState.installations.some((entry) => entry.id === id && entry.kind === kind && entry.floor === floor)), `bathroom curtain inventory is incomplete: ${JSON.stringify(curtainState.installations)}`);
    assert(curtainState.material.textured && curtainState.material.doubleSided, `curtains should use double-sided textured cloth: ${JSON.stringify(curtainState.material)}`);
    assert(curtainState.material.shaderLightsAdded === 0, "bathroom curtains must not add shader lights");

    for (const { id } of EXPECTED) {
      const staged = await stageCurtain(page, id);
      assert(staged.distance <= 2.35, `${id} must stage within the real interaction range: ${JSON.stringify(staged)}`);
      assert(/^Hide behind /.test(staged.prompt || ""), `${id} needs a clear hide prompt: ${JSON.stringify(staged)}`);
      if (id === "main-hall-bathtub-curtain") await captureStage(page, "main-hall-bathtub-curtain-open-desktop.png");

      await page.evaluate(() => {
        window.MrFeastFresh.collectFlashlightForQA();
        window.MrFeastFresh.setFlashlightForQA(true, { silent: true });
      });
      await page.keyboard.press("e");
      await page.waitForFunction(() => window.MrFeastFresh.isPlayerHidden());
      await page.evaluate(() => window.MrFeastFresh.advanceBathroomCurtainsForQA(1));

      curtainState = await bathroomCurtainState(page);
      const active = curtainState.installations.find((entry) => entry.id === id);
      const rendered = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
      const classes = await page.locator("#mansion-stage").getAttribute("class");
      assert(active?.active && curtainState.activeId === id, `${id} should own the hidden state: ${JSON.stringify(curtainState)}`);
      assert(active.openness <= 0.01, `${id} should close around the player: ${JSON.stringify(active)}`);
      assert(rendered.hiding.active && rendered.hiding.movementLocked && rendered.player.hidden, `${id} should reuse the authoritative concealment and movement lock`);
      assert(rendered.player.movement.mode === "hidden", `${id} should report hidden movement mode: ${JSON.stringify(rendered.player.movement)}`);
      assert(!(await page.evaluate(() => window.MrFeastFresh.getFlashlightState().on)), `${id} should switch off the flashlight`);
      assert(/is-bathroom-curtain-hiding/.test(classes || "") && /is-curtain-hiding/.test(classes || ""), `${id} should apply the bathroom curtain view treatment: ${classes}`);
      assert(curtainState.activeCameraHeight >= 1.0 && curtainState.activeCameraHeight <= 1.6, `${id} camera should sit inside the curtained fixture: ${JSON.stringify(curtainState)}`);

      if (id === "main-hall-bathtub-curtain" || id === "main-hall-shower-curtain") {
        await captureStage(page, id.includes("bathtub") ? "main-hall-bathtub-hidden-desktop.png" : "main-hall-shower-hidden-desktop.png");
      }

      if (id === "main-hall-bathtub-curtain") {
        const before = rendered.player;
        await page.keyboard.down("w");
        await page.evaluate(() => window.MrFeastFresh.advancePlayerForQA(1.1));
        await page.keyboard.up("w");
        const after = await page.evaluate(() => JSON.parse(window.render_game_to_text()).player);
        assert(Math.hypot(after.x - before.x, after.z - before.z) <= 0.01, `${id} must lock movement: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
      }

      await page.keyboard.press("e");
      await page.waitForFunction(() => !window.MrFeastFresh.isPlayerHidden());
      await page.evaluate(() => window.MrFeastFresh.advanceBathroomCurtainsForQA(1));
      curtainState = await bathroomCurtainState(page);
      const exited = curtainState.installations.find((entry) => entry.id === id);
      assert(!curtainState.activeId && !exited.active, `${id} should clear hidden ownership on exit: ${JSON.stringify(curtainState)}`);
      assert(exited.openness >= 0.99, `${id} should reopen after exit: ${JSON.stringify(exited)}`);
      const exitedClasses = await page.locator("#mansion-stage").getAttribute("class");
      assert(!/is-bathroom-curtain-hiding/.test(exitedClasses || ""), `${id} should clear its view treatment after exit: ${exitedClasses}`);
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
    await stageCurtain(mobilePage, "upper-grand-shower-curtain");
    await interact.tap();
    await mobilePage.waitForFunction(() => window.MrFeastFresh.isPlayerHidden());
    await mobilePage.evaluate(() => window.MrFeastFresh.advanceBathroomCurtainsForQA(1));
    assert(await mobilePage.locator("#mansion-hidden").isVisible(), "bathroom curtain hidden status should remain visible on phone");
    await captureStage(mobilePage, "upper-grand-shower-hidden-mobile.png");
    await interact.tap();
    await mobilePage.waitForFunction(() => !window.MrFeastFresh.isPlayerHidden());
    await mobilePage.evaluate(() => window.MrFeastFresh.advanceBathroomCurtainsForQA(1));

    await mobile.context.close();
    await desktop.context.close();
    assert(errors.length === 0, `unexpected browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast bathroom curtain acceptance passed: two tub and two shower curtains, real E/touch hiding, textured animated cloth, partial views, movement lock, flashlight shutdown, safe exit, reuse, responsive presentation, and clean browser consoles verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await run();
