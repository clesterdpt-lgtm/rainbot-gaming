import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const milestonePath = path.join(root, "docs", "milestones", "68-throwable-distractions.md");
const port = Number(process.env.MR_FEAST_THROWABLE_TEST_PORT || (53000 + (process.pid % 8000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-throwable-distractions");

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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await serverResponds()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

function watchErrors(page, errors, label) {
  page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico|fonts\.googleapis|fonts\.gstatic/i.test(message.text())) {
      errors.push(`${label}: ${message.text()}`);
    }
  });
}

async function bootPage(browser, viewport, errors, contextOptions = {}) {
  const page = await browser.newPage({ viewport, ...contextOptions });
  watchErrors(page, errors, `${viewport.width}x${viewport.height}`);
  await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 180000 });
  await page.waitForFunction(() => Boolean(window.MrFeastFresh?.getThrowableDistractions), null, { timeout: 180000 });
  return page;
}

async function diagnostics(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function throwableState(page) {
  return page.evaluate(() => window.MrFeastFresh.getThrowableDistractions());
}

async function beginCarry(page, seconds = 0.05) {
  // One E press latches the prop; E-up must not drop it.
  await page.keyboard.press("e");
  await page.evaluate((duration) => window.MrFeastFresh.advanceThrowableDistractionsForQA(duration), seconds);
}

async function assertSourceContract() {
  const [runtime, html, milestone] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
    readFile(milestonePath, "utf8"),
  ]);
  assert(/const THROWABLE_DISTRACTIONS\s*=\s*Object\.freeze/.test(runtime), "missing named THROWABLE_DISTRACTIONS tuning table");
  const runtimeVersion = runtime.match(/const MANSION_RUNTIME_VERSION = "([^"]+)";/)?.[1] || null;
  assert(
    runtimeVersion && html.includes(`mr-feast-mansion.js?v=${runtimeVersion}`),
    "page and runtime must share the active mansion cache identity",
  );
  assert(/class ThrowableDistractionSystem/.test(runtime), "missing focused ThrowableDistractionSystem");
  assert(/minimumPortablePropCount:\s*65/.test(runtime), "cabinet expansion must require at least sixty-five portable objects");
  assert(/cabinetProfiles:\s*Object\.freeze/.test(runtime), "cabinet throwables need named stock-kind profiles");
  assert(/registerCabinetEntries\s*\(/.test(runtime), "every Cabinet needs automatic throwable registration");
  assert(/adoptAuthoredVisual\s*\(/.test(runtime), "existing multi-part decor needs one portable assembly adoption path");
  assert(/addDynamicBox\s*\(/.test(runtime), "PhysicsWorld needs a bounded dynamic prop helper");
  assert(/Pick up \$\{placement\.label\}/.test(runtime), "throwables need a single-press pick-up label");
  assert(/getDropInteraction\s*\(/.test(runtime), "a free second E press must offer a synthetic drop prompt while carrying");
  assert(!/pickupHoldSeconds/.test(runtime), "instant pickup must remove the old delayed pickup timer");
  assert(
    !/throwableDistractionSystem\?\.dropCarried\(reason\)/.test(runtime),
    "E/touch key-up must not automatically drop a latched throwable",
  );
  assert(/dropCarried\s*\(/.test(runtime), "a deliberate second interact press must own the drop path");
  assert(
    /releaseCarried\s*\(\s*"drop"/.test(runtime)
      && /releaseCarried\s*\(\s*"throw"/.test(runtime),
    "drop and throw need distinct one-shot release cues",
  );
  assert(
    /event\.code === "KeyQ"[\s\S]{0,180}throwableDistractionSystem\?\.throwCarried\("keyboard"\)/.test(runtime),
    "Q must throw a carried throwable",
  );
  assert(!/event\.code === "KeyG"[\s\S]{0,180}throwableDistractionSystem\?\.throwCarried/.test(runtime), "G must no longer own throw");
  assert(
    /event\.code === "KeyF"[\s\S]{0,160}flashlightSystem\?\.toggle\("keyboard"\)/.test(runtime),
    "F must remain the flashlight key",
  );
  assert(/hearFinaleDistraction\s*\(/.test(runtime), "the Saint needs an explicit thrown-sound handoff");
  assert(/transientSound/.test(runtime), "Mr. Feast needs a one-shot response task distinction");
  assert(/throwableImpact\s*\(/.test(runtime), "MansionAudio needs a spatial impact cue");
  assert(/throwableRelease\s*\(/.test(runtime), "MansionAudio needs a physical drop/throw release cue");
  assert((html.match(/F<\/kbd>\s*flashlight/gi) || []).length >= 2, "both desktop guides must retain F for flashlight");
  assert((html.match(/Q<\/kbd>\s*throw carried item/gi) || []).length >= 2, "both desktop guides must explain Q throw");
  assert((html.match(/E<\/kbd>\s*pick up \/ drop/gi) || []).length >= 2, "both desktop guides must explain toggle pick-up and drop");
  assert(!/id="mansion-throwable-inventory"/.test(html), "throwables must not add inventory UI");
  assert(/User playtest/i.test(milestone), "Milestone 68 must retain subjective throw-balance playtest");
  for (const hook of [
    "getThrowableDistractions",
    "placePlayerNearThrowableForQA",
    "advanceThrowableDistractionsForQA",
    "throwCarriedForQA",
    "resetThrowableDistractionsForQA",
    "probeThrowableThreatForQA",
    "placePlayerNearCabinetThrowableForQA",
  ]) {
    assert(runtime.includes(hook), `missing deterministic throwable QA hook: ${hook}`);
  }
}

async function runBrowserFlow() {
  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn(
      "python3",
      ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root],
      { stdio: "ignore" },
    );
  }
  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const errors = [];
    const page = await bootPage(browser, { width: 1280, height: 820 }, errors);
    if (!(await diagnostics(page)).audio.enabled) await page.keyboard.press("m");
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).audio.enabled);

    let throwables = await throwableState(page);
    assert(
      throwables.entries.length >= 40
        && throwables.entries.length >= throwables.tuning.minimumPortablePropCount,
      `expected broad sixty-five-prop mansion coverage: ${JSON.stringify(throwables)}`,
    );
    const floors = new Set(throwables.entries.map((entry) => entry.floor));
    assert(
      ["MAIN LEVEL", "SECOND FLOOR", "BASEMENT"].every((floor) => floors.has(floor)),
      `props must span all mansion levels: ${JSON.stringify([...floors])}`,
    );
    const rooms = new Set(throwables.entries.map((entry) => entry.room));
    assert(rooms.size >= 16, `portable clutter must span at least sixteen authored rooms: ${JSON.stringify([...rooms])}`);
    assert(
      throwables.cabinetCoverage.total >= 24
        && throwables.cabinetCoverage.covered === throwables.cabinetCoverage.total
        && throwables.cabinetCoverage.uncoveredNames.length === 0
        && throwables.cabinetCoverage.entries.every((entry) => (
          entry.propId
          && entry.mode === "resting"
          && entry.atAuthoredPosition
          && !entry.storageOpen
          && !entry.homeVisible
          && !entry.interactionRegistered
        )),
      `every closed Cabinet must own one hidden, storage-gated portable object: ${JSON.stringify(throwables.cabinetCoverage)}`,
    );
    const representativeCabinet = throwables.cabinetCoverage.entries.find((entry) => (
      entry.storageName === "kitchen inner food cabinet"
    )) || throwables.cabinetCoverage.entries[0];
    const closedCabinetPlacement = await page.evaluate(
      (storageName) => window.MrFeastFresh.placePlayerNearCabinetThrowableForQA(storageName, false),
      representativeCabinet.storageName,
    );
    assert(
      /^Open /i.test(closedCabinetPlacement?.prompt || ""),
      `a closed cabinet should present its real door interaction first: ${JSON.stringify(closedCabinetPlacement)}`,
    );
    await page.keyboard.press("e");
    await page.waitForTimeout(900);
    const openCabinetPlacement = await page.evaluate(
      (storageName) => window.MrFeastFresh.placePlayerNearCabinetThrowableForQA(storageName, true),
      representativeCabinet.storageName,
    );
    assert(
      openCabinetPlacement?.storageOpen
        && openCabinetPlacement?.homeVisible
        && /pick up/i.test(openCabinetPlacement?.prompt || ""),
      `opening a cabinet must reveal its reachable portable object: ${JSON.stringify(openCabinetPlacement)}`,
    );
    await page.evaluate(() => {
      window.MrFeastFresh.turnOnAllLights();
      window.MrFeastFresh.collectFlashlightForQA();
      window.MrFeastFresh.setFlashlightForQA(true, { silent: true });
      window.MrFeastFresh.advanceThrowableDistractionsForQA(0.1);
    });
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "desktop-open-cabinet-item.png"),
    });
    await beginCarry(page);
    let cabinetCarry = await throwableState(page);
    assert(
      cabinetCarry.carried?.storageName === representativeCabinet.storageName
        && cabinetCarry.carried?.visibleInHand,
      `a real press must immediately lift the cabinet's portable object: ${JSON.stringify(cabinetCarry.carried)}`,
    );
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "desktop-carried-cabinet-item.png"),
    });
    await page.evaluate(() => window.MrFeastFresh.setFlashlightForQA(false, { silent: true }));
    await page.evaluate(() => window.MrFeastFresh.resetThrowableDistractionsForQA());
    throwables = await throwableState(page);
    const cabinetReachability = await page.evaluate(() => (
      window.MrFeastFresh.getThrowableDistractions().cabinetCoverage.entries.map((entry) => ({
        storageName: entry.storageName,
        placement: window.MrFeastFresh.placePlayerNearCabinetThrowableForQA(entry.storageName, true),
      }))
    ));
    assert(
      cabinetReachability.every((entry) => (
        entry.placement?.storageOpen
        && entry.placement?.homeVisible
        && /pick up/i.test(entry.placement?.prompt || "")
      )),
      `every Cabinet must reveal a reachable throwable when opened: ${JSON.stringify(
        cabinetReachability.filter((entry) => !/pick up/i.test(entry.placement?.prompt || "")),
      )}`,
    );
    const authoredProps = throwables.entries.filter((entry) => entry.minimumSourceParts > 0);
    assert(
      authoredProps.length >= 32
        && authoredProps.every((entry) => (
          entry.sourceAdoptionComplete
          && entry.adoptedPartCount >= entry.minimumSourceParts
          && entry.strandedSourcePartCount === 0
        )),
      `existing mansion dressing must be wholly adopted into portable assemblies: ${JSON.stringify(
        authoredProps.filter((entry) => (
          !entry.sourceAdoptionComplete
          || entry.adoptedPartCount < entry.minimumSourceParts
          || entry.strandedSourcePartCount !== 0
        )),
      )}`,
    );
    const reachability = await page.evaluate(() => (
      window.MrFeastFresh.getThrowableDistractions().entries.map((entry) => ({
        id: entry.id,
        placement: window.MrFeastFresh.placePlayerNearThrowableForQA(entry.id),
      }))
    ));
    assert(
      reachability.every((entry) => /pick up/i.test(entry.placement?.prompt || "")),
      `every authored small prop must expose a real reachable pickup prompt: ${JSON.stringify(
        reachability.filter((entry) => !/pick up/i.test(entry.placement?.prompt || "")),
      )}`,
    );
    const floralVases = throwables.entries.filter((entry) => (
      ["foyer-silver-vase", "foyer-east-flower-vase"].includes(entry.id)
    ));
    assert(
      floralVases.length === 2
        && floralVases.every((entry) => (
          entry.adoptedPartCount >= 7
          && entry.visualPartCount >= 7
          && entry.strandedSourcePartCount === 0
        )),
      `both foyer vases must own their vase, stems, and blooms as one assembly: ${JSON.stringify(floralVases)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.placePlayerNearThrowableForQA("foyer-silver-vase"));
    await beginCarry(page);
    let carriedVase = await throwableState(page);
    assert(
      carriedVase.carried?.id === "foyer-silver-vase"
        && carriedVase.carried.adoptedPartCount >= 7
        && carriedVase.carried.visualPartCount >= 7
        && carriedVase.carried.strandedSourcePartCount === 0,
      `picking up the vase must carry every flower part with it: ${JSON.stringify(carriedVase.carried)}`,
    );
    await page.keyboard.press("f");
    await page.evaluate(() => window.MrFeastFresh.advanceThrowableDistractionsForQA(0.1));
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "desktop-carried-flower-vase.png"),
    });
    await page.keyboard.press("f");
    await page.evaluate(() => window.MrFeastFresh.resetThrowableDistractionsForQA());
    throwables = await throwableState(page);
    const target = throwables.entries.find((entry) => entry.floor === "MAIN LEVEL");
    assert(target, "missing main-floor throwable");

    // One E press latches the prop; releasing E keeps it carried; a second
    // free E drops it with one release cue.
    let placement = await page.evaluate((id) => window.MrFeastFresh.placePlayerNearThrowableForQA(id), target.id);
    assert(placement?.placed, `QA placement failed: ${JSON.stringify(placement)}`);
    await page.waitForFunction(
      () => /pick up/i.test(JSON.parse(window.render_game_to_text()).prompt || ""),
      null,
      { timeout: 8000 },
    );
    const inventoryBefore = (await diagnostics(page)).inventory.items.map((entry) => entry.id);
    const releaseAudioBefore = (await diagnostics(page)).audio.cueCounts;
    await beginCarry(page, 0);
    throwables = await throwableState(page);
    let state = await diagnostics(page);
    assert(
      throwables.carried?.id === target.id
        && throwables.carried.visibleInHand
        && throwables.carried.renderedWithCamera
        && throwables.carried.mode === "carried",
      `E press must visibly carry the prop: ${JSON.stringify(throwables.carried)}`,
    );
    await page.evaluate(() => window.MrFeastFresh.advanceThrowableDistractionsForQA(0.4));
    throwables = await throwableState(page);
    assert(throwables.carried?.id === target.id, `releasing E must keep the prop carried: ${JSON.stringify(throwables.carried)}`);
    assert(
      JSON.stringify(state.inventory.items.map((entry) => entry.id)) === JSON.stringify(inventoryBefore),
      `carry must not mutate Bag inventory: ${JSON.stringify(state.inventory)}`,
    );
    assert(/drop/i.test(state.prompt || ""), `a free carried prop should offer drop: ${state.prompt}`);
    assert(await page.locator("#mansion-flashlight-button").textContent() === "Throw", "contextual tool must say Throw while carrying");
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "desktop-carried.png"),
    });
    await page.keyboard.press("e");
    throwables = await throwableState(page);
    state = await diagnostics(page);
    const dropped = throwables.entries.find((entry) => entry.id === target.id);
    assert(
      !throwables.carried
        && dropped.dropCount === 1
        && dropped.mode === "thrown",
      `a second free E must physically drop the carried prop: ${JSON.stringify(dropped)}`,
    );
    assert(
      (state.audio.cueCounts.throwableDrop || 0) === (releaseAudioBefore.throwableDrop || 0) + 1,
      `drop must emit exactly one drop-release cue: ${JSON.stringify(state.audio.cueCounts)}`,
    );

    // Reset the dropped prop, then latch carry again and exercise F/G/Q.
    await page.evaluate(() => window.MrFeastFresh.resetThrowableDistractionsForQA());
    placement = await page.evaluate((id) => window.MrFeastFresh.placePlayerNearThrowableForQA(id), target.id);
    assert(/pick up/i.test(placement?.prompt || ""), `reset prop must be immediately carryable: ${JSON.stringify(placement)}`);
    await beginCarry(page, 0);

    // F stays the flashlight even while carrying; real Q input owns throwing.
    await page.evaluate(() => window.MrFeastFresh.collectFlashlightForQA());
    const beforeThrow = await diagnostics(page);
    const flashlightBefore = beforeThrow.flashlight.activationCount;
    const cameraAlarmsBefore = beforeThrow.security.alarmCount;
    await page.keyboard.press("f");
    let afterFlashlight = await diagnostics(page);
    throwables = await throwableState(page);
    assert(
      throwables.carried?.id === target.id
        && afterFlashlight.flashlight.activationCount === flashlightBefore + 1,
      `F must toggle the flashlight without dropping a carried prop: ${JSON.stringify({
        carried: throwables.carried,
        flashlight: afterFlashlight.flashlight,
      })}`,
    );
    await page.keyboard.press("g");
    throwables = await throwableState(page);
    assert(
      throwables.carried?.id === target.id,
      `G must no longer throw the carried prop: ${JSON.stringify(throwables.carried)}`,
    );
    await page.keyboard.press("q");
    await page.evaluate(() => window.MrFeastFresh.advanceThrowableDistractionsForQA(3));
    throwables = await throwableState(page);
    state = await diagnostics(page);
    const thrown = throwables.entries.find((entry) => entry.id === target.id);
    assert(
      !throwables.carried && thrown.throwCount === 1 && thrown.dropCount === 1,
      `Q must throw once without inventing a second drop: ${JSON.stringify(thrown)}`,
    );
    assert(thrown.impactCount === 1 && thrown.distanceTravelled > 0.5, `throw must make one moving impact: ${JSON.stringify(thrown)}`);
    assert(["settled", "thrown"].includes(thrown.mode), `prop must remain physical after impact: ${JSON.stringify(thrown)}`);
    assert(
      (state.audio.cueCounts.throwableThrow || 0) === (releaseAudioBefore.throwableThrow || 0) + 1,
      `Q must emit exactly one throw-release cue: ${JSON.stringify(state.audio.cueCounts)}`,
    );
    assert((state.audio.cueCounts.throwableImpact || 0) >= 1, `first impact must emit its spatial audio cue: ${JSON.stringify(state.audio.cueCounts)}`);
    assert(state.flashlight.activationCount === afterFlashlight.flashlight.activationCount, "throwing must not toggle the flashlight");
    assert(state.security.alarmCount === cameraAlarmsBefore, "cameras must not hear thrown objects");
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "desktop-thrown.png"),
    });

    // Empty-hand F keeps the same dedicated flashlight contract.
    const lightWasOn = state.flashlight.on;
    await page.keyboard.press("f");
    state = await diagnostics(page);
    assert(state.flashlight.on !== lightWasOn, "empty-hand F must toggle the flashlight");

    // A settled prop can be reused, and load/reset returns every prop home.
    placement = await page.evaluate((id) => window.MrFeastFresh.placePlayerNearThrowableForQA(id), target.id);
    assert(
      /pick up/i.test(placement?.prompt || ""),
      `restored prop must reacquire its interaction prompt: ${JSON.stringify({ placement, diagnostics: await diagnostics(page) })}`,
    );
    await beginCarry(page);
    const repicked = await throwableState(page);
    assert(repicked.carried?.id === target.id, `settled prop must be pickable again: ${JSON.stringify(repicked)}`);
    const saveProbe = await page.evaluate(() => {
      const saved = window.MrFeastFresh.saveGameForQA();
      const payload = Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index);
        return `${key}:${localStorage.getItem(key)}`;
      }).join("\n");
      return { saved, payload };
    });
    assert(saveProbe.saved, "a carried prop must not block an ordinary mansion save");
    assert(
      !saveProbe.payload.includes(target.id)
        && !saveProbe.payload.includes("throwableDistractions")
        && !saveProbe.payload.includes("\"carriedId\""),
      `throwable state must not enter the save payload: ${saveProbe.payload}`,
    );
    assert(await page.evaluate(() => window.MrFeastFresh.loadGameForQA()), "the focused save must reload");
    await page.keyboard.up("e");
    const reset = await throwableState(page);
    assert(
      !reset.carried && reset.entries.every((entry) => entry.mode === "resting" && entry.atAuthoredPosition),
      `load must restore every transient prop: ${JSON.stringify(reset)}`,
    );

    // Priority/range boundaries are deterministic and do not require a chase.
    const threat = await page.evaluate(() => ({
      feastAccepted: window.MrFeastFresh.probeThrowableThreatForQA({ target: "mr-feast", distance: 8, sameFloor: true, threatBusy: false }),
      feastFar: window.MrFeastFresh.probeThrowableThreatForQA({ target: "mr-feast", distance: 30, sameFloor: true, threatBusy: false }),
      feastPursuit: window.MrFeastFresh.probeThrowableThreatForQA({ target: "mr-feast", distance: 4, sameFloor: true, threatBusy: true }),
      saintHidden: window.MrFeastFresh.probeThrowableThreatForQA({ target: "saint", hidden: true }),
      saintExposed: window.MrFeastFresh.probeThrowableThreatForQA({ target: "saint", hidden: false }),
    }));
    assert(threat.feastAccepted.accepted, `near free Mr. Feast must hear impact: ${JSON.stringify(threat)}`);
    assert(!threat.feastFar.accepted && threat.feastFar.reason === "out-of-range", `far Mr. Feast must not hear impact: ${JSON.stringify(threat)}`);
    assert(!threat.feastPursuit.accepted && threat.feastPursuit.reason === "higher-priority-threat", `pursuit must win: ${JSON.stringify(threat)}`);
    assert(threat.saintHidden.accepted && !threat.saintExposed.accepted, `only hidden player may redirect Saint: ${JSON.stringify(threat)}`);

    // A real first-impact event sends a nearby free Mr. Feast through his
    // physical response/search/return route without teleporting.
    await page.evaluate(() => {
      window.MrFeastFresh.resetThrowableDistractionsForQA();
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.setMrFeastPoseForQA({
        action: "idle",
        x: -5.8,
        y: 0.2,
        z: -6,
        yaw: -Math.PI / 2,
      });
      window.MrFeastFresh.resumeMrFeastForQA();
    });
    const diningTarget = (await throwableState(page)).entries.find((entry) => entry.id === "dining-sideboard-cup");
    assert(diningTarget, "missing Dining Room response prop");
    await page.evaluate((id) => window.MrFeastFresh.placePlayerNearThrowableForQA(id), diningTarget.id);
    await beginCarry(page);
    await page.keyboard.press("q");
    await page.keyboard.up("e");
    await page.evaluate(() => window.MrFeastFresh.advanceThrowableDistractionsForQA(2.5));
    state = await diagnostics(page);
    throwables = await throwableState(page);
    assert(
      throwables.lastThreatResult?.mrFeast?.accepted
        && state.mrFeast.housekeeping.activeTaskKind === "thrown-distraction",
      `a nearby free Mr. Feast must own the real impact task: ${JSON.stringify({
        threat: throwables.lastThreatResult,
        housekeeping: state.mrFeast.housekeeping,
      })}`,
    );
    const soundRoute = await page.evaluate(() => window.MrFeastFresh.runMrFeastHousekeepingForQA(420));
    state = await diagnostics(page);
    assert(
      soundRoute.completed
        && soundRoute.soundInvestigationsCompleted === 1
        && soundRoute.teleports === 0
        && soundRoute.states.includes("responding")
        && soundRoute.states.includes("searching")
        && soundRoute.states.includes("returning")
        && state.mrFeast.housekeeping.soundInvestigationsCompleted === 1,
      `Mr. Feast must walk to the sound, search, and return: ${JSON.stringify({
        soundRoute,
        housekeeping: state.mrFeast.housekeeping,
      })}`,
    );
    throwables = await throwableState(page);
    const resetDiningProp = throwables.entries.find((entry) => entry.id === diningTarget.id);
    assert(
      resetDiningProp.mode === "resting"
        && resetDiningProp.atAuthoredPosition
        && resetDiningProp.resetByMrFeastCount === 1
        && state.mrFeast.housekeeping.portableObjectsReset === 1,
      `Mr. Feast must return the investigated object to its authored spot: ${JSON.stringify({
        prop: resetDiningProp,
        housekeeping: state.mrFeast.housekeeping,
      })}`,
    );

    // An unheard settled object joins a delayed housekeeping queue, so
    // repeatedly thrown clutter cannot remain scattered around the mansion.
    await page.evaluate(() => {
      window.MrFeastFresh.resetThrowableDistractionsForQA();
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.resumeMrFeastForQA();
    });
    await page.evaluate((id) => window.MrFeastFresh.placePlayerNearThrowableForQA(id), target.id);
    await beginCarry(page);
    await page.keyboard.press("q");
    await page.keyboard.up("e");
    await page.evaluate(() => window.MrFeastFresh.advanceThrowableDistractionsForQA(3));
    throwables = await throwableState(page);
    const queuedProp = throwables.entries.find((entry) => entry.id === target.id);
    assert(
      queuedProp.cleanupPending && !throwables.activeSoundTask,
      `an unheard impact must wait in the physical cleanup queue: ${JSON.stringify({
        prop: queuedProp,
        task: throwables.activeSoundTask,
      })}`,
    );
    await page.evaluate(
      (seconds) => window.MrFeastFresh.advanceThrowableDistractionsForQA(seconds),
      throwables.tuning.cleanupDelaySeconds + 0.1,
    );
    throwables = await throwableState(page);
    state = await diagnostics(page);
    assert(
      throwables.activeSoundTask?.kind === "thrown-cleanup"
        && state.mrFeast.housekeeping.activeTaskKind === "thrown-cleanup",
      `Mr. Feast must accept delayed prop cleanup when free: ${JSON.stringify({
        task: throwables.activeSoundTask,
        housekeeping: state.mrFeast.housekeeping,
      })}`,
    );
    const cleanupRoute = await page.evaluate(() => window.MrFeastFresh.runMrFeastHousekeepingForQA(420));
    throwables = await throwableState(page);
    state = await diagnostics(page);
    const cleanedProp = throwables.entries.find((entry) => entry.id === target.id);
    assert(
      cleanupRoute.completed
        && cleanupRoute.teleports === 0
        && cleanupRoute.portableObjectsReset === 1
        && cleanedProp.mode === "resting"
        && cleanedProp.atAuthoredPosition
        && cleanedProp.resetByMrFeastCount === 1,
      `delayed housekeeping must physically reset unattended clutter: ${JSON.stringify({
        cleanupRoute,
        prop: cleanedProp,
        housekeeping: state.mrFeast.housekeeping,
      })}`,
    );

    // Competition ownership blocks pickup and cleans an already carried item.
    await page.evaluate(() => window.MrFeastFresh.resetThrowableDistractionsForQA());
    await page.evaluate((id) => window.MrFeastFresh.placePlayerNearThrowableForQA(id), target.id);
    await beginCarry(page);
    const competition = await page.evaluate(() => {
      const before = window.MrFeastFresh.getThrowableDistractions();
      const call = window.MrFeastFresh.callFeastSaysForQA("qa-throwable-block");
      window.MrFeastFresh.advanceThrowableDistractionsForQA(0.1);
      return { before, call, after: window.MrFeastFresh.getThrowableDistractions() };
    });
    await page.keyboard.up("e");
    assert(competition.call.started, `Feast Says must start: ${JSON.stringify(competition.call)}`);
    assert(competition.before.carried && !competition.after.carried, "competition start must clear carried prop");
    assert(competition.after.entries.every((entry) => entry.atAuthoredPosition), "competition must restore prop positions");
    assert(errors.length === 0, `desktop console errors: ${errors.join(" | ")}`);
    await page.close();

    // In the real finale state, a physical impact redirects the loaded Saint
    // only after an authoritative hiding spot has concealed the player.
    const finaleErrors = [];
    const finale = await bootPage(browser, { width: 1280, height: 820 }, finaleErrors);
    const called = await finale.evaluate(() => window.MrFeastFresh.callVictoryFeastForQA("feast-hunt-player-win"));
    assert(called?.started, `Victory Feast QA call failed: ${JSON.stringify(called)}`);
    await finale.evaluate(() => window.MrFeastFresh.awaitVictoryFeastAssetsForQA());
    await finale.waitForFunction(
      () => (
        ["ready", "error"].includes(window.MrFeastFresh.getMrFeastState?.()?.loadStatus)
        && window.MrFeastFresh.getVictoryFeastState()?.saint?.loadStatus === "ready"
      ),
      null,
      { timeout: 180000 },
    );
    const feastStaging = await finale.evaluate(() => window.MrFeastFresh.startVictoryFeastForQA());
    assert(feastStaging?.started, `Victory Feast report staging failed: ${JSON.stringify(feastStaging)}`);
    await finale.evaluate(() => window.MrFeastFresh.skipVictoryFeastDialogueForQA());
    assert((await finale.evaluate(() => window.MrFeastFresh.revealVictoryFeastSaintForQA()))?.triggered, "Saint reveal failed");
    await finale.waitForFunction(
      () => window.MrFeastFresh.getVictoryFeastState()?.saint?.loadStatus === "ready",
      null,
      { timeout: 180000 },
    );
    assert((await finale.evaluate(() => window.MrFeastFresh.startVictoryFeastEscapeForQA()))?.started, "Victory Feast escape failed");
    let finaleThrowables = await throwableState(finale);
    const finaleTarget = finaleThrowables.entries.find((entry) => entry.id === "dining-sideboard-cup");
    await finale.evaluate((id) => window.MrFeastFresh.placePlayerNearThrowableForQA(id), finaleTarget.id);
    await beginCarry(finale);
    const exposedBefore = await finale.evaluate(() => window.MrFeastFresh.getVictoryFeastState().saint);
    await finale.keyboard.press("q");
    await finale.keyboard.up("e");
    await finale.evaluate(() => window.MrFeastFresh.advanceThrowableDistractionsForQA(2.5));
    let finaleState = await finale.evaluate(() => window.MrFeastFresh.getVictoryFeastState());
    finaleThrowables = await throwableState(finale);
    assert(
      finaleThrowables.lastThreatResult?.saint?.reason === "player-visible"
        && finaleState.saint.targetSource !== "thrown-distraction",
      `an exposed throw must not replace the Saint's player target: ${JSON.stringify({
        threat: finaleThrowables.lastThreatResult,
        saint: finaleState.saint,
      })}`,
    );
    await finale.evaluate(() => window.MrFeastFresh.resetThrowableDistractionsForQA());
    await finale.evaluate((id) => window.MrFeastFresh.placePlayerNearThrowableForQA(id), finaleTarget.id);
    await beginCarry(finale);
    const hidden = await finale.evaluate(() => window.MrFeastFresh.hideFromVictoryFeastForQA("coat"));
    assert(hidden?.hidden, `finale distraction test needs real cover: ${JSON.stringify(hidden)}`);
    const saintBefore = await finale.evaluate(() => window.MrFeastFresh.getVictoryFeastState().saint);
    await finale.keyboard.press("q");
    await finale.keyboard.up("e");
    await finale.evaluate(() => window.MrFeastFresh.advanceThrowableDistractionsForQA(2.5));
    finaleThrowables = await throwableState(finale);
    finaleState = await finale.evaluate(() => window.MrFeastFresh.getVictoryFeastState());
    assert(
      finaleThrowables.lastThreatResult?.saint?.accepted
        && finaleState.saint.targetSource === "thrown-distraction"
        && finaleState.saint.distractionHeardCount === saintBefore.distractionHeardCount + 1,
      `a hidden player's real impact must redirect the Saint: ${JSON.stringify({
        threat: finaleThrowables.lastThreatResult,
        before: saintBefore,
        after: finaleState.saint,
      })}`,
    );
    await finale.evaluate(() => window.MrFeastFresh.advanceVictoryFeastForQA(0.5));
    const saintAfter = await finale.evaluate(() => window.MrFeastFresh.getVictoryFeastState().saint);
    assert(
      saintAfter.distanceTravelled > saintBefore.distanceTravelled
        && saintAfter.targetSource === "thrown-distraction",
      `the loaded Saint must physically travel toward the thrown impact: ${JSON.stringify({
        exposedBefore,
        before: saintBefore,
        after: saintAfter,
      })}`,
    );
    await finale.screenshot({
      path: path.join(artifactDir, "desktop-saint-distraction.png"),
    });
    assert(finaleErrors.length === 0, `finale console errors: ${finaleErrors.join(" | ")}`);
    await finale.close();

    // Touch Interact holds the same world object; the existing Light tool becomes Throw.
    const mobileErrors = [];
    const mobile = await bootPage(
      browser,
      { width: 390, height: 844 },
      mobileErrors,
      { isMobile: true, hasTouch: true },
    );
    if (!(await diagnostics(mobile)).audio.enabled) await mobile.keyboard.press("m");
    await mobile.waitForFunction(() => JSON.parse(window.render_game_to_text()).audio.enabled);
    throwables = await throwableState(mobile);
    const mobileCabinet = throwables.cabinetCoverage.entries.find((entry) => entry.walkIn)
      || throwables.cabinetCoverage.entries[0];
    let mobileCabinetPlacement = await mobile.evaluate(
      (storageName) => window.MrFeastFresh.placePlayerNearCabinetThrowableForQA(storageName, false),
      mobileCabinet.storageName,
    );
    assert(
      /^Open /i.test(mobileCabinetPlacement?.prompt || ""),
      `touch cabinet path must begin on the closed door: ${JSON.stringify(mobileCabinetPlacement)}`,
    );
    await mobile.locator("#touch-interact").tap();
    await mobile.waitForTimeout(900);
    mobileCabinetPlacement = await mobile.evaluate(
      (storageName) => window.MrFeastFresh.placePlayerNearCabinetThrowableForQA(storageName, true),
      mobileCabinet.storageName,
    );
    assert(
      mobileCabinetPlacement?.storageOpen
        && mobileCabinetPlacement?.homeVisible
        && /pick up/i.test(mobileCabinetPlacement?.prompt || ""),
      `touch must reveal the cabinet item: ${JSON.stringify(mobileCabinetPlacement)}`,
    );
    const mobileTarget = throwables.entries.find((entry) => entry.id === mobileCabinet.propId);
    const mobileReleaseAudioBefore = (await diagnostics(mobile)).audio.cueCounts;
    await mobile.locator("#touch-interact").tap();
    throwables = await throwableState(mobile);
    assert(throwables.carried?.id === mobileTarget.id, `touch Interact must latch the prop: ${JSON.stringify(throwables.carried)}`);
    await mobile.evaluate(() => window.MrFeastFresh.advanceThrowableDistractionsForQA(0.4));
    throwables = await throwableState(mobile);
    assert(throwables.carried?.id === mobileTarget.id, `a latched prop must stay carried without holding Interact: ${JSON.stringify(throwables.carried)}`);
    assert(await mobile.locator("#mansion-flashlight-button").isVisible(), "contextual Throw must be visible on touch");
    assert(await mobile.locator("#mansion-flashlight-button").textContent() === "Throw", "touch tool must relabel to Throw");
    await mobile.locator("#mansion-flashlight-button").tap();
    await mobile.evaluate(() => window.MrFeastFresh.advanceThrowableDistractionsForQA(1.5));
    throwables = await throwableState(mobile);
    const mobileState = await diagnostics(mobile);
    const mobileThrown = throwables.entries.find((entry) => entry.id === mobileTarget.id);
    assert(
      !throwables.carried && mobileThrown.throwCount === 1 && mobileThrown.dropCount === 0,
      `touch Throw must release once without a later pointer-up drop: ${JSON.stringify(mobileThrown)}`,
    );
    assert(
      (mobileState.audio.cueCounts.throwableThrow || 0) === (mobileReleaseAudioBefore.throwableThrow || 0) + 1
        && (mobileState.audio.cueCounts.throwableDrop || 0) === (mobileReleaseAudioBefore.throwableDrop || 0),
      `touch Throw must emit only the throw-release cue: ${JSON.stringify(mobileState.audio.cueCounts)}`,
    );
    assert(await mobile.locator("#mansion-throwable-inventory").count() === 0, "mobile must not add throwable inventory UI");
    await mobile.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "mobile-throw.png"),
    });
    assert(mobileErrors.length === 0, `mobile console errors: ${mobileErrors.join(" | ")}`);

    console.log(JSON.stringify({
      ok: true,
      props: throwables.entries.length,
      artifacts: artifactDir,
      desktopErrors: errors,
      mobileErrors,
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

async function run() {
  await assertSourceContract();
  await runBrowserFlow();
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
