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
const port = Number(process.env.MR_FEAST_BULK_SECRET_TEST_PORT || (47000 + (process.pid % 15000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-bulk-storage-secret");
const generatedSymbolAssets = [
  "bulk-storage-goat-star-v1-ai.png",
  "bulk-storage-broken-halo-v1-ai.png",
  "bulk-storage-thorn-eye-v1-ai.png",
].map((file) => path.join(root, "assets", "textures", "mr-feast", "generated", "symbols", file));

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

async function generatedSymbolAssetDiagnostics(file) {
  try {
    const metadata = await sharp(file).metadata();
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let visible = 0;
    let opaque = 0;
    for (let offset = 3; offset < data.length; offset += info.channels) {
      if (data[offset] > 24) visible += 1;
      if (data[offset] > 220) opaque += 1;
    }
    const pixels = info.width * info.height;
    return {
      file,
      width: metadata.width,
      height: metadata.height,
      channels: metadata.channels,
      hasAlpha: metadata.hasAlpha,
      visibleRatio: visible / pixels,
      opaqueRatio: opaque / pixels,
    };
  } catch (_) {
    return null;
  }
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
  const runtimeCacheIdentity = runtime.match(/MANSION_RUNTIME_VERSION = "([^"]+)"/)?.[1];
  const pageCacheIdentity = html.match(/mr-feast-mansion\.js\?v=([^"&]+)/)?.[1];
  assert(runtimeCacheIdentity && runtimeCacheIdentity === pageCacheIdentity, `page and runtime cache identities must agree: ${JSON.stringify({ runtimeCacheIdentity, pageCacheIdentity })}`);
  assert(/class BulkStorageSecretSystem/.test(runtime), "missing focused BulkStorageSecretSystem");
  assert(/bulk-secret-movable-box/.test(runtime) && /addKinematicBox/.test(runtime), "center boxes need visible meshes and aligned solid kinematic colliders");
  assert(/bulk-secret-demonic-symbol/.test(runtime) && /THREE\.(?:Line|LineLoop)/.test(runtime), "demonic markings must be real floor geometry");
  const generatedAssetDiagnostics = await Promise.all(generatedSymbolAssets.map(generatedSymbolAssetDiagnostics));
  generatedAssetDiagnostics.forEach((asset, index) => {
    assert(asset, `missing generated decal asset ${generatedSymbolAssets[index]}`);
    assert(asset.width >= 512 && asset.height >= 512, `generated decal must be at least 512px: ${JSON.stringify(asset)}`);
    assert(asset.hasAlpha && asset.channels === 4, `generated decal needs a real alpha channel: ${JSON.stringify(asset)}`);
    assert(asset.visibleRatio >= 0.08 && asset.visibleRatio <= 0.72, `generated decal should preserve transparent floor coverage: ${JSON.stringify(asset)}`);
    assert(asset.opaqueRatio >= 0.025, `generated decal should contain substantial painted detail: ${JSON.stringify(asset)}`);
  });
  assert(/bulk-secret-demonic-symbol-\$\{spec\.id\}-decal/.test(runtime), "generated symbol textures need real floor decal meshes");
  assert(/textureLoaded:[\s\S]{0,240}fallbackVisible:/.test(runtime), "symbol diagnostics must expose generated texture and fallback state");
  assert(/const fallbackMeshes = \[circle, star, thorns\][\s\S]{0,120}mesh\.visible = !decal/.test(runtime), "original line symbols must remain as missing-texture fallbacks");
  assert(/beginCurrentInteractionHold/.test(runtime) && /endCurrentInteractionHold/.test(runtime), "central input needs explicit held-interaction lifecycle");
  assert(/event\.code === "KeyE"[\s\S]{0,240}beginCurrentInteractionHold/.test(runtime), "E keydown must start the held interaction");
  assert(/event\.code === "KeyE"[\s\S]{0,180}endCurrentInteractionHold/.test(runtime), "E keyup must release the held interaction");
  assert(/touchInteract[\s\S]{0,900}pointerup/.test(runtime), "the existing touch Interact button must support release as well as press");
  assert(/kip-clothing/.test(runtime) && /what Kip was wearing/i.test(runtime), "Kip's clothing clue and requested observation text are missing");
  assert(
    /id:\s*"mara"[\s\S]{0,900}unlockAfter:\s*"storm-run"/.test(runtime)
      && /id:\s*"juniper"[\s\S]{0,900}unlockAfter:\s*"feast-hunt"/.test(runtime),
    "Mara and Juniper need named Game 2/Game 3 clothing progression contracts",
  );
  assert(/oxblood jacket and ivory blouse[\s\S]{0,500}Mara was wearing/i.test(runtime), "Mara's storage clothing must recall her oxblood-and-ivory outfit");
  assert(/plum-and-black[\s\S]{0,500}Juniper was wearing/i.test(runtime), "Juniper's storage clothing must recall her plum-and-black outfit");
  assert(
    /getBulkStorageSecretState/.test(runtime)
      && /placePlayerNearBulkStorageBoxForQA/.test(runtime)
      && /frameBulkStorageSymbolForQA/.test(runtime)
      && /placePlayerNearContestantClothingForQA/.test(runtime),
    "focused bulk-storage diagnostics and QA controls are missing",
  );
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
    assert(secret.symbols.every((symbol) => symbol.textureLoaded && symbol.decalVisible && !symbol.fallbackVisible), `every generated symbol decal should load while line geometry remains fallback-only: ${JSON.stringify(secret.symbols)}`);
    assert(secret.symbols.every((symbol) => symbol.textureSize?.width >= 512 && symbol.textureSize?.height >= 512), `runtime decals should preserve high-resolution texture detail: ${JSON.stringify(secret.symbols)}`);
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
    for (const symbolId of ["goat-star", "broken-halo", "thorn-eye"]) {
      const framed = await page.evaluate(
        (id) => window.MrFeastFresh.frameBulkStorageSymbolForQA(id),
        symbolId,
      );
      assert(
        framed?.id === symbolId && framed.textureLoaded && framed.decalVisible && !framed.fallbackVisible,
        `close-up QA should frame the generated ${symbolId} decal: ${JSON.stringify(framed)}`,
      );
      await page.screenshot({ path: path.join(artifactDir, `bulk-storage-${symbolId}-decal-desktop.png`) });
    }

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

    // Competition-gated clothing progression: Kip is already present, Mara
    // joins him after Game 2, and Juniper joins both after Game 3.
    const progression = await bootPage(browser, errors);
    const progressionPage = progression.page;
    await progressionPage.waitForFunction(
      () => window.MrFeastFresh.getContestantState?.()?.settled,
      null,
      { timeout: 120000 },
    );
    let progressionSecret = await secretState(progressionPage);
    let piles = Object.fromEntries(progressionSecret.clothingPiles.map((pile) => [pile.id, pile]));
    assert(
      piles.kip?.visible
        && !piles.mara?.visible
        && !piles.juniper?.visible,
      `fresh storage should contain only Kip's clothing: ${JSON.stringify(progressionSecret.clothingPiles)}`,
    );

    const stormCall = await progressionPage.evaluate(() => window.MrFeastFresh.callStormRunForQA("qa"));
    assert(stormCall?.started, `Game 2 QA call should start: ${JSON.stringify(stormCall)}`);
    await progressionPage.waitForFunction(
      () => window.MrFeastFresh.getStormRunState?.()?.castReady,
      null,
      { timeout: 120000 },
    );
    const stormResult = await progressionPage.evaluate(() => window.MrFeastFresh.completeStormRunForQA("player"));
    assert(stormResult?.survived, `Game 2 QA completion should survive: ${JSON.stringify(stormResult)}`);
    await progressionPage.waitForFunction(
      () => window.MrFeastFresh.getBulkStorageSecretState()?.clothingPiles?.find((pile) => pile.id === "mara")?.visible,
    );
    progressionSecret = await secretState(progressionPage);
    piles = Object.fromEntries(progressionSecret.clothingPiles.map((pile) => [pile.id, pile]));
    assert(
      piles.kip.visible
        && piles.mara.visible
        && !piles.juniper.visible,
      `Game 2 should add Mara beside Kip without revealing Juniper: ${JSON.stringify(progressionSecret.clothingPiles)}`,
    );
    const maraStage = await progressionPage.evaluate(
      () => window.MrFeastFresh.placePlayerNearContestantClothingForQA("mara"),
    );
    assert(maraStage?.visible && /inspect.*mara.*clothing/i.test(maraStage.prompt || ""), `Mara's unlocked pile needs a reachable prompt: ${JSON.stringify(maraStage)}`);
    await progressionPage.keyboard.press("e");
    await progressionPage.waitForFunction(
      () => window.MrFeastFresh.getBulkStorageSecretState()?.clothingPiles?.find((pile) => pile.id === "mara")?.discovered,
    );

    const calledHunt = await progressionPage.evaluate(() => {
      window.MrFeastFresh.setFeastHuntGateForQA({ stormCompleted: true, relaySabotaged: true });
      return window.MrFeastFresh.callFeastHuntForQA("gate");
    });
    assert(calledHunt?.started, `Game 3 should call after its gates: ${JSON.stringify(calledHunt)}`);
    const startedHunt = await progressionPage.evaluate(() => window.MrFeastFresh.startFeastHuntForQA());
    assert(startedHunt?.started, `Game 3 briefing should start: ${JSON.stringify(startedHunt)}`);
    await progressionPage.keyboard.press("e");
    await progressionPage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(3.2));
    assert((await progressionPage.evaluate(() => window.MrFeastFresh.getFeastHuntState())).phase === "hunting", "Game 3 QA progression must reach the live hunt");
    for (const id of ["golden-bell", "golden-goblet", "golden-carving-knife"]) {
      const collected = await progressionPage.evaluate(
        (itemId) => window.MrFeastFresh.collectFeastHuntItemForQA(itemId),
        id,
      );
      assert(collected?.accepted, `QA must collect ${id}: ${JSON.stringify(collected)}`);
      const returnStage = await progressionPage.evaluate(() => window.MrFeastFresh.placePlayerAtFeastHuntReturnForQA());
      assert(returnStage?.readyToReturn, `QA must stage the ${id} hand-in: ${JSON.stringify(returnStage)}`);
      await progressionPage.keyboard.press("e");
    }
    let liveGameThree = await progressionPage.evaluate(() => ({
      feastHunt: window.MrFeastFresh.getFeastHuntState(),
      contestants: window.MrFeastFresh.getContestantState(),
      storage: window.MrFeastFresh.getBulkStorageSecretState(),
    }));
    let liveJuniper = liveGameThree.contestants.entries.find((entry) => entry.id === "juniper-cross");
    let liveJuniperPile = liveGameThree.storage.clothingPiles.find((pile) => pile.id === "juniper");
    assert(
      liveGameThree.feastHunt.aftermath.active
        && liveJuniper?.modelVisible
        && !liveJuniper.eliminated
        && !liveJuniperPile?.visible,
      `Juniper must finish her losing dialogue before her storage clothing appears: ${JSON.stringify(liveGameThree)}`,
    );
    await progressionPage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(16));
    await progressionPage.evaluate(() => window.MrFeastFresh.placePlayerNearBulkStorageBoxForQA("bulk-box-d"));
    await progressionPage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(0.25));
    await progressionPage.waitForFunction(
      () => window.MrFeastFresh.getBulkStorageSecretState()?.clothingPiles?.find((pile) => pile.id === "juniper")?.visible,
    );
    liveGameThree = await progressionPage.evaluate(() => ({
      feastHunt: window.MrFeastFresh.getFeastHuntState(),
      contestants: window.MrFeastFresh.getContestantState(),
      storage: window.MrFeastFresh.getBulkStorageSecretState(),
    }));
    liveJuniper = liveGameThree.contestants.entries.find((entry) => entry.id === "juniper-cross");
    liveJuniperPile = liveGameThree.storage.clothingPiles.find((pile) => pile.id === "juniper");
    assert(
      !liveGameThree.feastHunt.aftermath.active
        && liveJuniper?.eliminated
        && !liveJuniper.modelVisible
        && liveJuniperPile?.visible,
      `Juniper must disappear as her Game 3 clothing pile unlocks: ${JSON.stringify(liveGameThree)}`,
    );
    progressionSecret = await secretState(progressionPage);
    piles = Object.fromEntries(progressionSecret.clothingPiles.map((pile) => [pile.id, pile]));
    assert(
      piles.kip.visible && piles.mara.visible && piles.juniper.visible,
      `Game 3 should leave Kip, Mara, and Juniper's clothing together: ${JSON.stringify(progressionSecret.clothingPiles)}`,
    );
    await progressionPage.evaluate(() => window.MrFeastFresh.advanceFeastHuntForQA(7));
    const juniperStage = await progressionPage.evaluate(
      () => window.MrFeastFresh.placePlayerNearContestantClothingForQA("juniper"),
    );
    assert(juniperStage?.visible && /inspect.*juniper.*clothing/i.test(juniperStage.prompt || ""), `Juniper's unlocked pile needs a reachable prompt: ${JSON.stringify(juniperStage)}`);
    await progressionPage.keyboard.press("e");
    await progressionPage.waitForFunction(
      () => window.MrFeastFresh.getBulkStorageSecretState()?.clothingPiles?.find((pile) => pile.id === "juniper")?.discovered,
    );
    await progressionPage.evaluate(() => window.MrFeastFresh.frameBulkStorageSecretForQA());
    await progressionPage.screenshot({ path: path.join(artifactDir, "all-contestant-clothing-after-game-three-desktop.png") });
    assert(await progressionPage.evaluate(() => window.MrFeastFresh.saveGameForQA()), "completed clothing progression should save");
    assert(await progressionPage.evaluate(() => window.MrFeastFresh.loadGameForQA()), "completed clothing progression should reload");
    progressionSecret = await secretState(progressionPage);
    assert(
      progressionSecret.clothingPiles.every((pile) => pile.visible)
        && progressionSecret.clothingPiles.filter((pile) => pile.discovered).length === 2,
      `save/load should preserve all three visible piles and the inspected Mara/Juniper clues: ${JSON.stringify(progressionSecret.clothingPiles)}`,
    );
    await progression.context.close();
    await desktop.context.close();

    assert(errors.length === 0, `unexpected browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast bulk storage secret acceptance passed: physical box reveal, held keyboard/touch manipulation, all three progression-gated clothing clues, and save/load verified");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await run();
