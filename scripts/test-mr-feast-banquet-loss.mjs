import { spawn } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_BANQUET_TEST_PORT || (59200 + (process.pid % 5000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-banquet-loss");
const closingLine = "Contestant Thirteen—you lost the million, but you still made the final cut. Our patrons call it sacrifice. The Guest calls it supper. I call it a feast.";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readGlbJson(filePath) {
  const buffer = await readFile(filePath);
  assert(buffer.length >= 20, `${path.basename(filePath)} is too small to contain a GLB header`);
  assert(buffer.readUInt32LE(0) === 0x46546c67, `${path.basename(filePath)} is not a binary glTF file`);
  assert(buffer.readUInt32LE(4) === 2, `${path.basename(filePath)} must use glTF 2.0`);
  assert(buffer.readUInt32LE(8) === buffer.length, `${path.basename(filePath)} has an invalid GLB byte length`);
  const jsonChunkLength = buffer.readUInt32LE(12);
  assert(buffer.readUInt32LE(16) === 0x4e4f534a, `${path.basename(filePath)} is missing its leading JSON chunk`);
  assert(20 + jsonChunkLength <= buffer.length, `${path.basename(filePath)} has a truncated JSON chunk`);
  return JSON.parse(buffer.subarray(20, 20 + jsonChunkLength).toString("utf8").trimEnd());
}

function assertExactNames(actualNames, expectedNames, label) {
  const actual = actualNames.slice().sort();
  const expected = expectedNames.slice().sort();
  assert(
    actual.length === expected.length && actual.every((name, index) => name === expected[index]),
    `${label} must be exactly ${expected.join(", ")}; found ${actual.join(", ") || "none"}`,
  );
}

function assertCenteredHorizontalBounds(label, manifestSize, reportBounds) {
  const minimum = reportBounds?.min;
  const maximum = reportBounds?.max;
  const reportSize = reportBounds?.size;
  assert(
    [manifestSize, minimum, maximum, reportSize].every(
      (values) => Array.isArray(values) && values.length === 3 && values.every(Number.isFinite),
    ),
    `${label} needs finite three-axis manifest and report bounds`,
  );
  reportSize.forEach((size, axis) => {
    assert(size > 0, `${label} axis ${axis} must have positive extent`);
    assert(
      Math.abs(size - manifestSize[axis]) <= 0.002,
      `${label} manifest/report bounds disagree on axis ${axis}: ${manifestSize[axis]} vs ${size}`,
    );
  });
  for (const axis of [0, 2]) {
    const centerOffset = Math.abs((minimum[axis] + maximum[axis]) / 2);
    const allowedOffset = Math.max(0.01, reportSize[axis] * 0.08);
    assert(
      centerOffset <= allowedOffset,
      `${label} axis ${axis} is offset ${centerOffset.toFixed(3)}m from its runtime mark (allowed ${allowedOffset.toFixed(3)}m): ${JSON.stringify(reportBounds)}`,
    );
  }
}

async function serverResponds() {
  try {
    return (await fetch(`${baseUrl}/games/mr-feast-mansion.html`, { cache: "no-store" })).ok;
  } catch (_) {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await serverResponds()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

function watchErrors(page, errors) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
  });
}

async function bootPage(browser, viewport, errors) {
  const page = await browser.newPage({ viewport });
  watchErrors(page, errors);
  await page.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
  await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 180000 });
  await page.waitForFunction(
    () => ["ready", "error"].includes(window.MrFeastFresh.getMrFeastState()?.loadStatus),
    null,
    { timeout: 180000 },
  );
  return page;
}

async function readState(page) {
  return page.evaluate(() => window.MrFeastFresh.getBanquetLossState());
}

async function assertSourceContract() {
  const [runtime, html, milestone] = await Promise.all([
    readFile(path.join(root, "assets", "js", "mr-feast-mansion.js"), "utf8"),
    readFile(path.join(root, "games", "mr-feast-mansion.html"), "utf8"),
    readFile(path.join(root, "docs", "milestones", "64-captured-at-dinner-loss.md"), "utf8"),
  ]);
  assert(/const BANQUET_LOSS\s*=\s*Object\.freeze/.test(runtime), "missing named banquet-loss tuning table");
  assert(/class BanquetLossSystem/.test(runtime), "missing focused BanquetLossSystem");
  assert(/banquetLoss:\s*\{/.test(runtime), "authoritative state must own the banquet loss");
  assert(/caughtReasons:[\s\S]{0,220}?witnessed[\s\S]{0,220}?recorded[\s\S]{0,220}?feast-hunt-eliminated/.test(runtime), "physical catch reasons are not explicitly routed");
  assert(/banquetLossSystem\?\.start/.test(runtime), "physical game over does not route into the banquet system");
  assert(
    /getBanquetLossState/.test(runtime)
      && /triggerBanquetLossForQA/.test(runtime)
      && /advanceBanquetLossForQA/.test(runtime)
      && /setBanquetLookForQA/.test(runtime),
    "focused banquet QA controls must include deterministic free look",
  );
  assert(/overlayAtSeconds:\s*(?:2[0-9]|[3-9][0-9])/.test(runtime), "the banquet must hold for at least 20 seconds");
  assert(runtime.includes(closingLine), "Mr. Feast's complete authored closing line is missing");
  assert(!/placeCard:\s*"CONTESTANT 13 — MAIN COURSE"/.test(runtime), "the loss scene must remove the Contestant 13 main-course sign");
  assert(/data-banquet-loss/.test(html) && /mansion-banquet-look-hint/.test(html), "the stage needs banquet presentation and look-hint states");
  assert(/user playtest/i.test(milestone), "Milestone 64 must retain visual user playtest acceptance");
}

async function assertAssetContract() {
  const manifestPath = path.join(root, "assets", "models", "mr-feast", "banquet", "manifest.json");
  const manifestDir = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(manifest.version === 1, `unexpected banquet manifest version: ${manifest.version}`);
  assert(manifest.body?.rigged === true && manifest.body?.meshy?.rigTaskId, `shared body must retain rigging provenance: ${JSON.stringify(manifest.body)}`);
  assert(manifest.body?.sourceCount === 1 && manifest.body?.runtimeFile, `exactly one body source must be reused: ${JSON.stringify(manifest.body)}`);
  assert(Array.isArray(manifest.masks) && manifest.masks.length === 6, `six masks are required: ${manifest.masks?.length}`);
  assert(new Set(manifest.masks.map((entry) => entry.id)).size === 6, "mask ids must be unique");
  assert(new Set(manifest.masks.map((entry) => entry.runtimeFile)).size === 6, "mask runtime files must be unique");
  assert(new Set(manifest.masks.map((entry) => entry.meshy?.sourceTaskId)).size <= 3, "credit budget allows no more than three Meshy mask source tasks");
  assert(manifest.masks.every((entry) => entry.blenderVariant && entry.boundsMeters && entry.forwardAxis), `every mask needs Blender/proportion metadata: ${JSON.stringify(manifest.masks)}`);
  assert(
    manifest.victim?.sourceCount === 1
      && manifest.victim?.riggedSource === true
      && manifest.victim?.meshy?.generationMode === "image-to-3d"
      && manifest.victim?.meshy?.generationTaskId
      && manifest.victim?.meshy?.rigTaskId,
    `the victim torso and limbs must derive from one selected Meshy image-to-3D and rigged underwear body: ${JSON.stringify(manifest.victim)}`,
  );
  assert(
    manifest.victim?.underwear === true
      && manifest.victim?.limbCount === 4
      && manifest.victim?.sealedSurgicalCaps === 0
      && manifest.victim?.explicitGore === false
      && manifest.victim?.torso?.runtimeFile
      && manifest.victim?.limbs?.runtimeFile
      && manifest.victim?.torso?.boundsMeters
      && manifest.victim?.limbs?.boundsMeters
      && manifest.victim?.torso?.blenderReport
      && manifest.victim?.limbs?.blenderReport
      && manifest.victim?.torso?.visibleMeshyDerivedCore === true
      && manifest.victim?.torso?.torsoOnlySilhouette === true
      && manifest.victim?.torso?.shoulderAttachments === 0
      && manifest.victim?.torso?.splitLegStubs === 0
      && manifest.victim?.torso?.torsoSocketBandageCaps === 0
      && manifest.victim?.limbs?.visibleMeshyDerivedCore === true
      && manifest.victim?.limbs?.arrangement === "flat four-limb presentation"
      && manifest.victim?.limbs?.flatOnPlatter === true
      && manifest.victim?.limbs?.auxiliaryPlateCount === 0
      && Array.isArray(manifest.victim?.limbs?.pieceBoundsMeters)
      && manifest.victim.limbs.pieceBoundsMeters.length === 4,
    `victim outputs need non-gory Blender separation metadata: ${JSON.stringify(manifest.victim)}`,
  );
  assert(
    manifest.victim.meshy.selectedSourceCredits === 35
      && manifest.victim.meshy.rejectedAttempt?.consumedCredits === 40
      && manifest.victim.meshy.consumedCredits === 75
      && manifest.creditStrategy.victimSelectedSourceCredits === 35
      && manifest.creditStrategy.victimRejectedAttemptCredits === 40
      && manifest.creditStrategy.estimatedConsumedCredits <= 200
      && manifest.victim.torso.runtimeFile !== manifest.victim.limbs.runtimeFile,
    `the selected one-source victim pipeline and rejected retry must retain truthful Meshy credit provenance: ${JSON.stringify({ victim: manifest.victim, credits: manifest.creditStrategy })}`,
  );

  const files = [
    manifest.body.runtimeFile,
    ...manifest.masks.map((entry) => entry.runtimeFile),
    manifest.victim.torso.runtimeFile,
    manifest.victim.limbs.runtimeFile,
  ];
  for (const file of files) {
    const fileStat = await stat(path.join(manifestDir, file));
    assert(fileStat.size > 1024, `${file} is not a viable GLB`);
    assert(fileStat.size <= 6 * 1024 * 1024, `${file} exceeds the 6 MB runtime budget (${fileStat.size} bytes)`);
  }

  const [torsoGlb, limbsGlb, torsoReport, limbsReport] = await Promise.all([
    readGlbJson(path.join(manifestDir, manifest.victim.torso.runtimeFile)),
    readGlbJson(path.join(manifestDir, manifest.victim.limbs.runtimeFile)),
    readFile(path.join(manifestDir, manifest.victim.torso.blenderReport), "utf8").then(JSON.parse),
    readFile(path.join(manifestDir, manifest.victim.limbs.blenderReport), "utf8").then(JSON.parse),
  ]);
  const torsoNodeNames = (torsoGlb.nodes || []).map((node) => node.name || "");
  assert(
    torsoNodeNames.filter((name) => name === "Banquet_Victim_Meshy_Torso_Core").length === 1
      && (torsoGlb.materials || []).some((material) => /^Banquet_Victim_Source_PBR_/.test(material.name || ""))
      && (torsoGlb.images || []).length >= 1,
    `the torso GLB needs one textured Meshy-derived underwear core: ${JSON.stringify({ nodes: torsoNodeNames, materials: torsoGlb.materials })}`,
  );
  assert(
    torsoNodeNames.filter((name) => name.endsWith("_Bandage_Cap")).length === 0,
    `the torso-only asset must not retain bulky shoulder or hip caps: ${JSON.stringify(torsoNodeNames)}`,
  );
  const forbiddenTorsoNodes = torsoNodeNames.filter(
    (name) => name.startsWith("Banquet_Victim_")
      && name.split("_").some((part) => /^(?:head|arm|leg)$/i.test(part)),
  );
  assert(
    forbiddenTorsoNodes.length === 0,
    `the first-person torso GLB must not retain head or limb nodes: ${JSON.stringify(forbiddenTorsoNodes)}`,
  );

  const limbNodeNames = (limbsGlb.nodes || []).map((node) => node.name || "");
  assertExactNames(
    limbNodeNames.filter((name) => /^Banquet_Victim_Meshy_.*_(?:Arm|Leg)_Core$/.test(name)),
    [
      "Banquet_Victim_Meshy_Left_Arm_Core",
      "Banquet_Victim_Meshy_Right_Arm_Core",
      "Banquet_Victim_Meshy_Left_Leg_Core",
      "Banquet_Victim_Meshy_Right_Leg_Core",
    ],
    "detached Meshy-derived limb root nodes",
  );
  assertExactNames(
    limbNodeNames.filter((name) => name.endsWith("_Proximal_Bandage")),
    [
      "Banquet_Victim_Left_Arm_Proximal_Bandage",
      "Banquet_Victim_Right_Arm_Proximal_Bandage",
      "Banquet_Victim_Left_Leg_Proximal_Bandage",
      "Banquet_Victim_Right_Leg_Proximal_Bandage",
    ],
    "detached limb proximal-bandage nodes",
  );
  assertCenteredHorizontalBounds(
    "victim torso",
    manifest.victim.torso.boundsMeters,
    torsoReport.boundsMeters,
  );
  assertCenteredHorizontalBounds(
    "detached limb presentation",
    manifest.victim.limbs.boundsMeters,
    limbsReport.boundsMeters,
  );
  assert(
    limbsReport.arrangement === "two proportional arms and two proportional legs in one flat platter layer"
      && limbsReport.maximumLayerOffsetMeters <= 0.005
      && limbsReport.auxiliaryPlateCount === 0
      && limbsReport.boundsMeters.size[1] <= 0.18
      && limbsReport.pieceBoundsMeters.filter((piece) => piece.kind === "arm").every((piece) => piece.longAxisMeters >= 0.48)
      && limbsReport.pieceBoundsMeters.filter((piece) => piece.kind === "leg").every((piece) => piece.longAxisMeters >= 0.68),
    `the detached limbs must be proportional, flat, and separately readable: ${JSON.stringify(limbsReport)}`,
  );
}

async function run() {
  await assertSourceContract();
  await assertAssetContract();

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

    const desktop = await bootPage(browser, { width: 1280, height: 820 }, errors);
    let initial = await readState(desktop);
    assert(initial.assetStatus === "idle", `banquet assets must remain deferred before a catch: ${JSON.stringify(initial)}`);
    assert(initial.phase === "inactive" && initial.visible === false, `loss dressing must be hidden during ordinary play: ${JSON.stringify(initial)}`);

    const caught = await desktop.evaluate(() => window.MrFeastFresh.triggerBanquetLossForQA("witnessed"));
    assert(caught?.reason === "witnessed", `QA catch must use the real game-over route: ${JSON.stringify(caught)}`);
    await desktop.waitForFunction(
      () => window.MrFeastFresh.getBanquetLossState()?.assetStatus === "ready"
        && window.MrFeastFresh.getBanquetLossState()?.visible,
      null,
      { timeout: 180000 },
    );
    let banquet = await readState(desktop);
    assert(
      banquet.phase === "revealing"
        && banquet.camera.mode === "first-person-table"
        && banquet.camera.positionLocked
        && banquet.camera.lookEnabled
        && banquet.camera.ceilingFacing
        && banquet.camera.pitch >= 1.2
        && banquet.camera.room === "DINING ROOM"
        && banquet.camera.movementSuppressed,
      `catch must begin lying face-up while preserving free look: ${JSON.stringify(banquet.camera)}`,
    );
    assert(banquet.presentationDurationSeconds >= 20, `the banquet needs a long look window: ${JSON.stringify(banquet)}`);
    assert(!banquet.overlayVisible, "the game-over overlay must not cover the establishing tableau");
    await desktop.screenshot({ path: path.join(artifactDir, "banquet-ceiling-reveal-desktop.png") });

    const tableLook = await desktop.evaluate(() => window.MrFeastFresh.setBanquetLookForQA({
      yaw: Math.PI / 2,
      pitch: 0.045,
    }));
    assert(
      tableLook?.camera?.pitch < 0.1
        && tableLook.camera.lookEnabled,
      `free look must rotate away from the ceiling without moving the player: ${JSON.stringify(tableLook?.camera)}`,
    );
    banquet = await readState(desktop);
    assert(
      banquet.patrons.length === 6
        && banquet.patrons.every((entry) => entry.visible && entry.seated && entry.facingPlayer)
        && banquet.patrons.every((entry) => entry.faceFullyConcealed && entry.hoodVisible)
        && banquet.patrons.every((entry) => entry.maskScale >= 0.68)
        && banquet.patrons.every((entry) => entry.visibleArmCount === 2)
        && banquet.patrons.every((entry) => entry.armReadability.every((arm) => arm.tabletopReadable))
        && new Set(banquet.patrons.map((entry) => entry.bodyFile)).size === 1
        && new Set(banquet.patrons.map((entry) => entry.maskId)).size === 6
        && new Set(banquet.patrons.map((entry) => entry.maskFile)).size === 6,
      `the Patron tableau must reuse one body with six unique full-face masks: ${JSON.stringify(banquet.patrons)}`,
    );
    assert(
      banquet.host.visible
        && banquet.host.atFarEnd
        && banquet.host.facingPlayer
        && banquet.host.inView
        && banquet.host.unobstructedSightline
        && banquet.host.screenCenterOffset <= 0.24
        && banquet.camera.tableCenterlineOffset <= 0.01
        && banquet.camera.insetFromNearTableEdge >= 0.5
        && banquet.ritualDressing.placeCardRemoved
        && !banquet.ritualDressing.placeCardVisible
        && banquet.ritualDressing.limbPlatterCount === 1
        && banquet.ritualDressing.auxiliaryAngledPlateCount === 0,
      `host/table ritual staging is incomplete: ${JSON.stringify({ host: banquet.host, ritual: banquet.ritualDressing })}`,
    );
    assert(
      banquet.ritualDressing.tabletopCandlePartCount >= 10
        && banquet.ritualDressing.tabletopCandlePartsHidden
        && banquet.ritualDressing.tabletopFlameCount === 0
        && banquet.ritualDressing.perimeterTallCandleCount >= 10
        && banquet.ritualDressing.perimeterCandlesVisible
        && banquet.ritualDressing.gameplayCollidersAdded === 0,
      `ritual candles must surround the room without blocking the table: ${JSON.stringify(banquet.ritualDressing)}`,
    );
    assert(
      banquet.victim.torsoVisible
        && banquet.victim.underwearVisible
        && banquet.victim.missingLimbCount === 4
        && banquet.victim.sealedSurgicalCaps === 0
        && banquet.victim.torsoOnlySilhouette
        && banquet.victim.shoulderAttachments === 0
        && banquet.victim.splitLegStubs === 0
        && banquet.victim.explicitGore === false
        && banquet.victim.torsoCenteredOnPlatter
        && banquet.victim.torsoCenterOffset <= 0.025
        && banquet.victim.gameplayCollidersAdded === 0,
      `the table victim must be a compact torso-only underwear silhouette: ${JSON.stringify(banquet.victim)}`,
    );
    assert(
      banquet.lighting.productionToneLift
        && banquet.lighting.patronFillLightCount === 2
        && banquet.lighting.hemisphereIntensity >= 0.3
        && banquet.lighting.hemisphereIntensity <= 0.4
        && banquet.lighting.moonIntensity >= 0.26
        && banquet.lighting.moonIntensity <= 0.32,
      `the loss scene needs a restrained production-dark light lift: ${JSON.stringify(banquet.lighting)}`,
    );
    assert(
      banquet.victim.limbPlatterVisible
        && banquet.victim.detachedLimbCount === 4
        && banquet.victim.limbPlatterInView
        && banquet.victim.limbPlatterBeforeHost
        && banquet.victim.limbPlatterInsideTable
        && banquet.victim.limbPileCenteredOnPlatter
        && banquet.victim.limbPileCenterOffset <= 0.025
        && banquet.victim.flatOnPlatter
        && banquet.victim.auxiliaryPlateCount === 0
        && banquet.victim.limbWorldBoundsMeters[1] <= 0.24
        && banquet.victim.limbWorldBoundsMeters[0] >= 1.18
        && banquet.victim.limbWorldBoundsMeters[2] <= 1.32
        && banquet.victim.limbPileBelowHostSightline
        && banquet.host.unobstructedSightline,
      `all four limbs must sit on one platter before the visible host: ${JSON.stringify({ victim: banquet.victim, host: banquet.host })}`,
    );
    await desktop.screenshot({ path: path.join(artifactDir, "banquet-table-desktop.png") });

    const torsoLook = await desktop.evaluate(() => window.MrFeastFresh.setBanquetLookForQA({
      yaw: Math.PI / 2,
      pitch: -0.42,
    }));
    assert(
      torsoLook.camera.pitch <= -0.4
        && torsoLook.victim.torsoInView
        && torsoLook.victim.torsoVisible
        && torsoLook.camera.positionLocked,
      `looking down must reveal the player's fixed torso without moving the camera: ${JSON.stringify(torsoLook)}`,
    );
    await desktop.screenshot({ path: path.join(artifactDir, "banquet-victim-torso-desktop.png") });

    const leftLook = await desktop.evaluate(() => window.MrFeastFresh.setBanquetLookForQA({
      yaw: Math.PI / 2 - 0.38,
      pitch: 0.02,
    }));
    assert(leftLook.patrons.filter((entry) => entry.inView).length >= 2, `left look should reveal its Patron row: ${JSON.stringify(leftLook.patrons)}`);
    await desktop.screenshot({ path: path.join(artifactDir, "banquet-look-left-desktop.png") });
    const rightLook = await desktop.evaluate(() => window.MrFeastFresh.setBanquetLookForQA({
      yaw: Math.PI / 2 + 0.38,
      pitch: 0.02,
    }));
    assert(rightLook.patrons.filter((entry) => entry.inView).length >= 2, `right look should reveal its Patron row: ${JSON.stringify(rightLook.patrons)}`);
    await desktop.screenshot({ path: path.join(artifactDir, "banquet-look-right-desktop.png") });
    await desktop.evaluate(() => {
      window.MrFeastFresh.setBanquetLookForQA({ yaw: Math.PI / 2, pitch: 0.045 });
      window.MrFeastFresh.advanceBanquetLossForQA(5);
    });
    banquet = await readState(desktop);
    assert(
      banquet.phase === "closing-line"
        && banquet.closingLine === closingLine
        && banquet.speech?.text === closingLine
        && !banquet.overlayVisible,
      `Mr. Feast must finish the scene before recovery UI: ${JSON.stringify(banquet)}`,
    );
    await desktop.screenshot({ path: path.join(artifactDir, "banquet-closing-line-desktop.png") });

    await desktop.evaluate(() => window.MrFeastFresh.advanceBanquetLossForQA(20));
    banquet = await readState(desktop);
    assert(
      banquet.phase === "complete"
        && banquet.overlayVisible
        && banquet.recovery.loadLabel === "Load last save"
        && banquet.recovery.restartLabel === "Start over",
      `the loss must end in recoverable controls: ${JSON.stringify(banquet)}`,
    );

    const cleared = await desktop.evaluate(() => window.MrFeastFresh.clearBanquetLossForQA());
    assert(
      cleared?.phase === "inactive"
        && !cleared.visible
        && !cleared.ritualDressing.tabletopCandlePartsHidden
        && !cleared.victim.torsoVisible
        && !cleared.victim.limbPlatterVisible,
      `clearing the loss must remove the tableau and restore table service: ${JSON.stringify(cleared)}`,
    );
    const noShow = await desktop.evaluate(() => window.MrFeastFresh.triggerBanquetLossForQA("feast-says-no-show"));
    banquet = await readState(desktop);
    assert(noShow?.reason === "feast-says-no-show" && banquet.phase === "inactive" && banquet.overlayVisible, `non-catch loss must bypass the banquet: ${JSON.stringify(banquet)}`);
    await desktop.close();

    const phone = await bootPage(browser, { width: 390, height: 844 }, errors);
    await phone.evaluate(() => window.MrFeastFresh.triggerBanquetLossForQA("recorded"));
    await phone.waitForFunction(
      () => window.MrFeastFresh.getBanquetLossState()?.assetStatus === "ready"
        && window.MrFeastFresh.getBanquetLossState()?.visible,
      null,
      { timeout: 180000 },
    );
    let phoneState = await readState(phone);
    assert(phoneState.camera.ceilingFacing && phoneState.camera.lookEnabled, `phone must begin face-up with touch look enabled: ${JSON.stringify(phoneState.camera)}`);
    await phone.evaluate(() => {
      const canvas = document.getElementById("mansion-canvas");
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 73,
        pointerType: "touch",
        clientX: 320,
        clientY: 220,
      }));
      canvas.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 73,
        pointerType: "touch",
        clientX: 320,
        clientY: 540,
      }));
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 73,
        pointerType: "touch",
        clientX: 320,
        clientY: 540,
      }));
    });
    phoneState = await readState(phone);
    assert(
      phoneState.camera.lookEnabled
        && phoneState.camera.pitch <= 0.08
        && phoneState.host.visible
        && phoneState.host.inView
        && phoneState.host.unobstructedSightline
        && phoneState.victim.limbPlatterInView
        && phoneState.victim.limbPlatterBeforeHost
        && phoneState.patrons.every((entry) => entry.faceFullyConcealed)
        && phoneState.patrons.filter((entry) => entry.inView).length >= 4,
      `real phone drag must look down to the host and at least four masks: ${JSON.stringify(phoneState)}`,
    );
    await phone.screenshot({ path: path.join(artifactDir, "banquet-table-phone.png") });
    await phone.close();

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast banquet-loss regression passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
