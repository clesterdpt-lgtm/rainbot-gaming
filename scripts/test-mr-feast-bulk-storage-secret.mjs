import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const port = Number(process.env.MR_FEAST_BULK_SECRET_TEST_PORT || (47000 + (process.pid % 15000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-bulk-storage-secret");

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

async function secretState(page) {
  return page.evaluate(() => window.MrFeastFresh.getBulkStorageSecretState());
}

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function bootPage(browser, errors, contextOptions = { viewport: { width: 1280, height: 820 } }) {
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
  await page.waitForTimeout(450);
  return { context, page };
}

async function holdMoveBox(page, boxId, key, seconds = 1.15) {
  const staged = await page.evaluate(
    ({ id, movementKey }) => window.MrFeastFresh.placePlayerNearBulkStorageBoxForQA(id, movementKey === "s" ? "pull" : "push"),
    { id: boxId, movementKey: key },
  );
  assert(staged?.boxId === boxId, `QA should stage ${boxId}: ${JSON.stringify(staged)}`);
  await page.waitForFunction(
    () => /hold.*move box/i.test(document.getElementById("mansion-prompt-text")?.textContent || ""),
    null,
    { timeout: 5000 },
  );
  const before = (await secretState(page)).boxes.find((box) => box.id === boxId);
  await page.keyboard.down("e");
  await page.waitForFunction(
    (id) => window.MrFeastFresh.getBulkStorageSecretState()?.grabbedBoxId === id,
    boxId,
    { timeout: 3000 },
  );
  await page.keyboard.down(key);
  await page.evaluate((duration) => window.MrFeastFresh.advancePlayerForQA(duration), seconds);
  await page.keyboard.up(key);
  await page.keyboard.up("e");
  await page.waitForFunction(() => window.MrFeastFresh.getBulkStorageSecretState()?.grabbedBoxId == null);
  const after = (await secretState(page)).boxes.find((box) => box.id === boxId);
  assert(after.distanceFromHome >= before.distanceFromHome + 0.48, `${boxId} should move materially while E and ${key.toUpperCase()} are held: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  return { before, after };
}

async function run() {
  const [runtime, html] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
  ]);

  // Red-first source contract. Before implementation this must fail on the
  // missing named system rather than launching a browser against old behavior.
  assert(/const BULK_STORAGE_SECRET = Object\.freeze\(\{/.test(runtime), "missing named BULK_STORAGE_SECRET tuning table");
  assert(/MANSION_RUNTIME_VERSION = "20260724-bulk-storage-secret-1"/.test(runtime), "runtime cache identity is stale");
  assert(/mr-feast-mansion\.js\?v=20260724-bulk-storage-secret-1/.test(html), "page and runtime cache identities must agree");
  assert(/class BulkStorageSecretSystem/.test(runtime), "missing focused BulkStorageSecretSystem");
  assert(/bulk-secret-movable-box/.test(runtime) && /addKinematicBox/.test(runtime), "center boxes need visible meshes and aligned solid kinematic colliders");
  assert(/bulk-secret-demonic-symbol/.test(runtime) && /THREE\.(?:Line|LineLoop)/.test(runtime), "demonic markings must be real floor geometry");
  assert(/beginCurrentInteractionHold/.test(runtime) && /endCurrentInteractionHold/.test(runtime), "central input needs explicit held-interaction lifecycle");
  assert(/event\.code === "KeyE"[\s\S]{0,240}beginCurrentInteractionHold/.test(runtime), "E keydown must start the held interaction");
  assert(/event\.code === "KeyE"[\s\S]{0,180}endCurrentInteractionHold/.test(runtime), "E keyup must release the held interaction");
  assert(/touchInteract[\s\S]{0,900}pointerup/.test(runtime), "the existing touch Interact button must support release as well as press");
  assert(/kip-clothing/.test(runtime) && /what Kip was wearing/i.test(runtime), "Kip's clothing clue and requested observation text are missing");
  assert(/getBulkStorageSecretState/.test(runtime) && /placePlayerNearBulkStorageBoxForQA/.test(runtime), "focused bulk-storage diagnostics and QA controls are missing");
  assert(/id="touch-interact"/.test(html), "the existing touch Interact control must remain available");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  const errors = [];
  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });

    const desktop = await bootPage(browser, errors);
    const page = desktop.page;
    let secret = await secretState(page);

    // initial physical concealment
    assert(secret?.boxes?.length >= 4, `Bulk Storage needs at least four movable center boxes: ${JSON.stringify(secret?.boxes)}`);
    assert(secret?.symbols?.length >= 3, `Bulk Storage needs several floor symbols: ${JSON.stringify(secret?.symbols)}`);
    assert(secret.symbols.every((symbol) => symbol.visible && symbol.covered), `every marking should exist but begin covered by physical boxes: ${JSON.stringify(secret.symbols)}`);
    assert(secret.revealedCount === 0 && !secret.allRevealed, `fresh secret must begin hidden: ${JSON.stringify(secret)}`);
    assert(secret.boxes.every((box) => box.colliderAligned && box.insideRoom), `fresh visible boxes and colliders must align inside the room: ${JSON.stringify(secret.boxes)}`);
    await page.evaluate(() => window.MrFeastFresh.frameBulkStorageSecretForQA());
    await page.screenshot({ path: path.join(artifactDir, "bulk-storage-secret-covered-desktop.png") });

    // real held keyboard manipulation: W pushes, S pulls, keyup releases.
    const pushed = await holdMoveBox(page, "bulk-box-a", "w");
    secret = await secretState(page);
    assert(secret.pushDistance >= 0.48 && secret.lastMoveMode === "push", `forward movement should register a push: ${JSON.stringify(secret)}`);
    assert(!secret.interactionHeld && secret.grabbedBoxId == null, "releasing E must end the box grab");
    assert(pushed.after.colliderAligned, "the pushed box collider must remain aligned");

    const pulled = await holdMoveBox(page, "bulk-box-b", "s");
    secret = await secretState(page);
    assert(secret.pullDistance >= 0.48 && secret.lastMoveMode === "pull", `backward movement should register a pull: ${JSON.stringify(secret)}`);
    assert(pulled.after.colliderAligned, "the pulled box collider must remain aligned");

    // physical reveal and collider alignment
    await holdMoveBox(page, "bulk-box-c", "w");
    secret = await secretState(page);
    assert(secret.allRevealed && secret.revealedCount === secret.symbols.length, `moving the three covering boxes should uncover every symbol: ${JSON.stringify(secret.symbols)}`);
    assert(secret.symbols.every((symbol) => symbol.visible && !symbol.covered && symbol.visibilityToggles === 0), `symbols must remain continuously present and be uncovered only by movement: ${JSON.stringify(secret.symbols)}`);
    assert(secret.boxes.every((box) => box.colliderAligned && box.insideRoom), `all moved boxes must stay solid, aligned, and inside Bulk Storage: ${JSON.stringify(secret.boxes)}`);
    await page.evaluate(() => window.MrFeastFresh.frameBulkStorageSecretForQA());
    await page.screenshot({ path: path.join(artifactDir, "bulk-storage-secret-revealed-desktop.png") });

    // Kip clothing clue: ordinary E remains a one-press interaction.
    const clothingStage = await page.evaluate(() => window.MrFeastFresh.placePlayerNearKipClothingForQA());
    assert(clothingStage?.visible && /inspect.*kip.*clothing/i.test(clothingStage.prompt || ""), `Kip's corner clothing needs a reachable prompt: ${JSON.stringify(clothingStage)}`);
    await page.waitForFunction(() => /inspect.*kip.*clothing/i.test(document.getElementById("mansion-prompt-text")?.textContent || ""), null, { timeout: 5000 });
    await page.screenshot({ path: path.join(artifactDir, "kip-clothing-corner-desktop.png") });
    await page.keyboard.press("e");
    await page.waitForFunction(() => window.MrFeastFresh.getBulkStorageSecretState()?.clothing?.discovered === true);
    const discoveryText = await page.locator("#mansion-discovery-body").textContent();
    assert(/dark green jacket.*leather-trimmed shirt.*look like what Kip was wearing/i.test(discoveryText || ""), `the observation should directly recall Kip's outfit: ${discoveryText}`);
    await page.screenshot({ path: path.join(artifactDir, "kip-clothing-observation-desktop.png") });
    secret = await secretState(page);
    let state = await diagnostics(page);
    assert(secret.clothing.journalEntryCount === 1 && state.journal.entries.filter((id) => id === "kip-clothing").length === 1, `the clothing clue should enter the dossier exactly once: ${JSON.stringify({ clothing: secret.clothing, journal: state.journal })}`);
    await page.keyboard.press("e");
    secret = await secretState(page);
    state = await diagnostics(page);
    assert(secret.clothing.journalEntryCount === 1 && state.journal.entries.filter((id) => id === "kip-clothing").length === 1, "reinspection must not duplicate Kip's clothing clue");

    // save restore contract
    const movedBeforeSave = Object.fromEntries(secret.boxes.map((box) => [box.id, box.position]));
    assert(await page.evaluate(() => window.MrFeastFresh.saveGameForQA()), "QA save should capture the moved boxes and clothing clue");
    await page.evaluate(() => window.MrFeastFresh.resetBulkStorageSecretForQA({ clearClue: true }));
    let reset = await secretState(page);
    assert(!reset.clothing.discovered && reset.boxes.every((box) => box.distanceFromHome <= 0.001), `QA reset should prove the later load is real: ${JSON.stringify(reset)}`);
    assert(await page.evaluate(() => window.MrFeastFresh.loadGameForQA()), "QA load should restore the saved secret state");
    await page.waitForFunction(() => window.MrFeastFresh.getBulkStorageSecretState()?.clothing?.discovered === true);
    secret = await secretState(page);
    state = await diagnostics(page);
    assert(!secret.interactionHeld && secret.grabbedBoxId == null, "load must never resume a transient grab");
    for (const box of secret.boxes) {
      const saved = movedBeforeSave[box.id];
      assert(saved && Math.hypot(box.position.x - saved.x, box.position.z - saved.z) <= 0.015, `load should restore ${box.id}: saved=${JSON.stringify(saved)} loaded=${JSON.stringify(box.position)}`);
    }
    assert(state.journal.entries.filter((id) => id === "kip-clothing").length === 1, "load must retain exactly one Kip-clothing journal entry");

    // touch hold parity through the existing Interact + movement controls.
    const mobile = await bootPage(browser, errors, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    const mobilePage = mobile.page;
    await mobilePage.evaluate(() => window.MrFeastFresh.placePlayerNearBulkStorageBoxForQA("bulk-box-d", "push"));
    await mobilePage.waitForFunction(() => /hold.*move box/i.test(document.getElementById("mansion-prompt-text")?.textContent || ""), null, { timeout: 5000 });
    const mobileBefore = (await secretState(mobilePage)).boxes.find((box) => box.id === "bulk-box-d");
    await mobilePage.locator("#touch-interact").dispatchEvent("pointerdown", { pointerId: 41, pointerType: "touch", isPrimary: true, buttons: 1 });
    await mobilePage.locator("#touch-forward").dispatchEvent("pointerdown", { pointerId: 42, pointerType: "touch", isPrimary: false, buttons: 1 });
    await mobilePage.evaluate(() => window.MrFeastFresh.advancePlayerForQA(1.1));
    await mobilePage.locator("#touch-forward").dispatchEvent("pointerup", { pointerId: 42, pointerType: "touch", isPrimary: false, buttons: 0 });
    await mobilePage.locator("#touch-interact").dispatchEvent("pointerup", { pointerId: 41, pointerType: "touch", isPrimary: true, buttons: 0 });
    const mobileAfterState = await secretState(mobilePage);
    const mobileAfter = mobileAfterState.boxes.find((box) => box.id === "bulk-box-d");
    assert(mobileAfter.distanceFromHome >= mobileBefore.distanceFromHome + 0.42, `held touch Interact plus Forward should move the box: before=${JSON.stringify(mobileBefore)} after=${JSON.stringify(mobileAfter)}`);
    assert(!mobileAfterState.interactionHeld && mobileAfterState.grabbedBoxId == null, "touch pointerup must release the box");
    await mobilePage.screenshot({ path: path.join(artifactDir, "bulk-storage-touch-hold-mobile.png") });
    await mobile.context.close();
    await desktop.context.close();

    assert(errors.length === 0, `unexpected browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast bulk storage secret acceptance passed: physical box reveal, held keyboard/touch manipulation, Kip clothing clue, and save/load verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await run();
