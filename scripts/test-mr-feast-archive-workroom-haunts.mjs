import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const silhouetteAssetPath = path.join(root, "assets", "img", "mr-feast", "feast-father-static-silhouette.png");
const silhouetteBakePath = path.join(root, "scripts", "blender", "render-demon-silhouette.py");
const port = Number(process.env.MR_FEAST_BASEMENT_HAUNT_TEST_PORT || (50000 + (process.pid % 12000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1&view=archiveHauntBook&frame=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-archive-workroom-haunts");

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

function watchErrors(page, errors) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
  });
}

async function captureStage(page, fileName) {
  await page.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, fileName) });
}

async function run() {
  const [runtime, html, silhouetteAsset, silhouetteBake] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
    readFile(silhouetteAssetPath),
    readFile(silhouetteBakePath, "utf8"),
  ]);

  assert(/const BASEMENT_HAUNT = Object\.freeze\(\{/.test(runtime), "missing named BASEMENT_HAUNT tuning and story table");
  assert(/class BasementHauntSystem/.test(runtime), "missing lifecycle-owned BasementHauntSystem");
  assert(/archive-feast-father-lore-book-floor/.test(runtime), "the Feast Father lore volume is not a physical Archive floor discovery");
  assert(!/feast-father-lore-book-cover/.test(runtime), "the Feast Father lore volume still has a duplicate Library-table prop");
  assert((runtime.match(/archive-contestant-preparation-file-/g) || []).length >= 3, "the Archive needs at least three physical previous-contestant files");
  assert(
    /\["2-north",\s*\[\s*\{ kind: "reel-to-reel", x: -0\.72 \},\s*\{ kind: "skull", x: 0 \},\s*\{ kind: "sealed-ledger", x: 0\.92 \}/.test(runtime),
    "the previous-guest ledger and Player 13 recorder must share the authored skull display shelf",
  );
  assert(
    /contestantFileShelf:\s*Object\.freeze\(\{\s*x:\s*11\.455,[\s\S]{0,180}z:\s*5\.25/.test(runtime)
      && /\["3-south", "contestant-files"\]/.test(runtime),
    "the three previous-guest records must reserve the recorder's former row-3 south display shelf",
  );
  assert(/workroomFeastFatherBreathing/.test(runtime), "the Workroom blackout lacks a dedicated Feast Father breathing treatment");
  assert(
    /durationSeconds:\s*18/.test(runtime)
      && /breathingSeconds:\s*18/.test(runtime)
      && /breathingRampSeconds:\s*15/.test(runtime)
      && /breathingGain:\s*0\.3/.test(runtime)
      && /linearRampToValueAtTime\(haunt\.targetGain, rampEnd\)/.test(runtime),
    "the patron-feed static must hold for 18 seconds while breathing rises to its louder peak over 15 seconds",
  );
  assert(
    /setStatic\(active/.test(runtime)
      && /staticMix/.test(runtime)
      && /float feastFatherShadow\(vec2 uv\)/.test(runtime)
      && /feastFatherProgress/.test(runtime)
      && /sampler2D feastFatherSilhouette/.test(runtime)
      && /shadowSourceModel:\s*"assets\/models\/mr-feast\/demon-prototypes\/banquet-saint\.glb"/.test(runtime)
      && /texture2D\(feastFatherSilhouette, silhouetteUv\)\.a/.test(runtime)
      && !/ellipseMask\(|segmentMask\(/.test(runtime),
    "the static must use an exact Banquet Saint model mask instead of a geometric approximation",
  );
  assert(
    silhouetteAsset.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && silhouetteAsset.readUInt32BE(16) === 512
      && silhouetteAsset.readUInt32BE(20) === 1024
      && silhouetteAsset.byteLength > 12000
      && /banquet-saint\.glb/.test(silhouetteBake)
      && /film_transparent = True/.test(silhouetteBake),
    "the model-derived 512x1024 transparent Feast Father silhouette and reproducible Blender bake are missing",
  );
  assert(
    /door\.locked = !state\.workroom\.unlocked \|\| Boolean\(basementHauntSystem\?\.workroom\?\.active\)/.test(runtime),
    "the Workroom door must remain locked for the complete patron-feed haunt",
  );
  assert(/setTransientBlackout\(active/.test(runtime), "room circuits need a transient blackout that preserves switch state");
  const runtimeVersion = runtime.match(/MANSION_RUNTIME_VERSION\s*=\s*"([^"]+)"/)?.[1];
  assert(runtimeVersion && html.includes(`mr-feast-mansion.js?v=${runtimeVersion}`), "page/runtime cache identities must match");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    watchErrors(page, errors);
    await page.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await page.evaluate(() => window.MrFeastFresh.prepareBasementHauntAudioForQA());

    const archiveDisplay = await page.evaluate(() => ({
      skull: window.MrFeastFresh.inspectScene("archive-curio-skull-cranium"),
      ledger: window.MrFeastFresh.inspectScene("archive-curio-sealed-ledger"),
      recorder: window.MrFeastFresh.inspectScene("archive-curio-reel-to-reel-deck"),
    }));
    const skull = archiveDisplay.skull.meshes[0]?.position;
    const ledger = archiveDisplay.ledger.meshes[0]?.position;
    const recorder = archiveDisplay.recorder.meshes[0]?.position;
    assert(skull && ledger && recorder, `the skull-shelf display is missing an authored prop: ${JSON.stringify(archiveDisplay)}`);
    assert(
      Math.max(skull.x, ledger.x, recorder.x) - Math.min(skull.x, ledger.x, recorder.x) < 0.02
        && Math.max(skull.y, ledger.y, recorder.y) - Math.min(skull.y, ledger.y, recorder.y) < 0.25
        && ledger.z < skull.z
        && recorder.z > skull.z,
      `the guest ledger, skull, and Player 13 recorder must form one readable shelf row: ${JSON.stringify({ skull, ledger, recorder })}`,
    );

    const recordDisplay = await page.evaluate(() => ({
      records: window.MrFeastFresh.inspectScene("archive-contestant-preparation-file-"),
      shelf: window.MrFeastFresh.inspectScene("archive-row-3-south-shelf-3"),
    }));
    const recordFolders = recordDisplay.records.meshes
      .filter((mesh) => /file-\d+$/.test(mesh.name))
      .sort((a, b) => a.position.z - b.position.z);
    const recordLabels = recordDisplay.records.meshes
      .filter((mesh) => /typed-label$/.test(mesh.name))
      .sort((a, b) => a.position.z - b.position.z);
    const formerRecorderShelf = recordDisplay.shelf.meshes[0];
    assert(recordFolders.length === 3 && recordLabels.length === 3 && formerRecorderShelf, `the former recorder shelf must hold three complete record folders: ${JSON.stringify(recordDisplay)}`);
    assert(
      recordFolders.every((folder, index) => (
        Math.abs(folder.position.x - 11.455) < 0.01
        && Math.abs(folder.position.y - formerRecorderShelf.position.y - 0.23) < 0.02
        && folder.size.x < folder.size.z
        && folder.size.y > folder.size.z
        && recordLabels[index].position.x > folder.position.x
        && Math.abs(recordLabels[index].position.z - folder.position.z) < 0.01
      ))
        && Math.abs(recordFolders[1].position.z - recordFolders[0].position.z - 0.36) < 0.01
        && Math.abs(recordFolders[2].position.z - recordFolders[1].position.z - 0.36) < 0.01,
      `the previous-guest records must sit upright, evenly spaced, with labels facing the east aisle: ${JSON.stringify({ recordFolders, recordLabels, formerRecorderShelf })}`,
    );
    await page.evaluate(() => window.MrFeastFresh.teleport("archiveSkull"));
    await page.evaluate(() => window.advanceTime(100));
    await captureStage(page, "archive-skull-ledger-player-13-display-desktop.png");
    const recorderView = await page.evaluate(() => window.MrFeastFresh.teleport("contestant13ArchiveCage"));
    assert(/evidence cage.*locked/i.test(recorderView.prompt || ""), `the moved Player 13 recorder must remain interactable beside the skull: ${JSON.stringify(recorderView.prompt)}`);

    let haunt = await page.evaluate(() => window.MrFeastFresh.resetBasementHauntForQA({ clearSeen: true }));
    assert(!haunt.archive.dropSeen && !haunt.archive.book.visible, `fresh Archive haunt state should hide the floor book: ${JSON.stringify(haunt)}`);
    haunt = await page.evaluate(() => window.MrFeastFresh.triggerArchiveHauntForQA());
    assert(haunt.archive.active && haunt.archive.phase === "book-falling", `Archive exploration should begin with the book fall: ${JSON.stringify(haunt)}`);
    haunt = await page.evaluate(() => window.MrFeastFresh.advanceBasementHauntForQA(0.9));
    assert(haunt.archive.dropSeen && haunt.archive.book.visible && haunt.archive.book.onFloor, `the impact must leave the lore book on the Archive floor: ${JSON.stringify(haunt.archive)}`);
    assert(haunt.archive.dropSoundCount === 1, `the physical drop should emit exactly one spatial impact: ${JSON.stringify(haunt.archive)}`);
    assert(haunt.archive.closedDoors.includes("basement stair door"), `the service-stair door should close behind the player: ${JSON.stringify(haunt.archive.closedDoors)}`);
    assert(haunt.archive.blackoutActive, `the Archive light circuit should fail after the drop: ${JSON.stringify(haunt.archive)}`);
    await captureStage(page, "archive-book-drop-blackout-desktop.png");

    haunt = await page.evaluate(() => window.MrFeastFresh.advanceBasementHauntForQA(5));
    assert(!haunt.archive.active && !haunt.archive.blackoutActive && haunt.archive.circuitOn, `Archive lighting should restore its pre-scare switch state: ${JSON.stringify(haunt.archive)}`);
    assert(haunt.archive.book.visible && haunt.archive.book.onFloor, "the dropped lore book should remain discoverable after the scare ends");
    await page.evaluate(() => window.MrFeastFresh.frameArchiveHauntBookForQA());
    await captureStage(page, "archive-book-grounded-restored-desktop.png");

    const loreOpened = await page.evaluate(() => window.MrFeastFresh.openFeastFatherLoreBookForQA());
    assert(loreOpened === true, "the dropped lore volume should use the shared readable-book UI");
    await page.waitForFunction(() => !document.getElementById("mansion-book-reader")?.hidden);
    const lore = await page.evaluate(() => ({
      title: document.getElementById("mansion-book-title")?.textContent,
      collection: document.getElementById("mansion-book-collection")?.textContent,
      preview: document.getElementById("mansion-book-preview")?.textContent,
    }));
    assert(/Household Observances/.test(lore.title || "") && /Archive/i.test(lore.collection || "") && /Feast Father/i.test(lore.preview || ""), `the floor book should be the canonical Feast Father lore volume: ${JSON.stringify(lore)}`);
    await captureStage(page, "archive-feast-father-lore-book-desktop.png");
    await page.keyboard.press("Escape");

    for (const id of ["contestant-04", "contestant-09", "contestant-12"]) {
      await page.evaluate((fileId) => window.MrFeastFresh.frameArchiveContestantFilesForQA(fileId), id);
      const framed = await diagnostics(page);
      assert(new RegExp(`preparation file ${id.slice(-2)}`, "i").test(framed.prompt || ""), `Archive file ${id} must expose its physical read interaction from the aisle: ${JSON.stringify(framed.prompt)}`);
      await page.keyboard.press("e");
      await page.waitForTimeout(120);
      const file = await page.evaluate(() => ({
        title: document.getElementById("mansion-discovery-title")?.textContent || "",
        body: document.getElementById("mansion-discovery-body")?.textContent || "",
      }));
      assert(/prepared|course|served|roast|brais|carv/i.test(`${file.title} ${file.body}`), `Archive file ${id} needs disturbing preparation records: ${JSON.stringify(file)}`);
    }
    haunt = await page.evaluate(() => window.MrFeastFresh.getBasementHauntState());
    assert(haunt.archive.files.readIds.length === 3 && haunt.archive.files.physicalCount >= 3, `all physical contestant dossiers should be independently readable: ${JSON.stringify(haunt.archive.files)}`);
    await page.evaluate(() => window.MrFeastFresh.frameArchiveContestantFilesForQA("contestant-09"));
    await captureStage(page, "archive-contestant-preparation-files-desktop.png");

    await page.evaluate(() => window.MrFeastFresh.teleport("workroomMonitorWall"));
    const lightLayoutBefore = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    await page.evaluate(() => window.MrFeastFresh.triggerWorkroomPatronHauntForQA());
    await page.evaluate(() => window.MrFeastFresh.advanceBasementHauntForQA(0));
    haunt = await page.evaluate(() => window.MrFeastFresh.getBasementHauntState());
    assert(haunt.workroom.active && haunt.workroom.phase === "blackout", `relay sabotage should begin the Workroom haunt: ${JSON.stringify(haunt.workroom)}`);
    assert(haunt.workroom.blackoutActive && haunt.workroom.staticActive, `Workroom lights and all screens should fail together: ${JSON.stringify(haunt.workroom)}`);
    assert(
      haunt.workroom.closedDoors.includes("workroom door")
        && haunt.workroom.lockedDoors.includes("workroom door")
        && haunt.workroom.doorLocked,
      `the Workroom entrance should close and lock for the scare: ${JSON.stringify(haunt.workroom)}`,
    );
    assert(
      haunt.workroom.durationSeconds === 18
        && haunt.workroom.remainingSeconds > 17
        && haunt.workroom.breathing.active
        && haunt.workroom.breathing.durationSeconds === 18
        && haunt.workroom.breathing.staticDurationSeconds === 18
        && haunt.workroom.breathing.rampSeconds === 15
        && haunt.workroom.breathing.startGain < 0.01
        && haunt.workroom.breathing.targetGain >= 0.3
        && haunt.workroom.breathing.automation === "linear-rise-then-short-exponential-release",
      `the close Feast Father breathing should start almost inaudibly and rise across the extended static: ${JSON.stringify(haunt.workroom.breathing)}`,
    );
    const monitorStatic = await page.evaluate(() => window.MrFeastFresh.getMonitorWallState());
    assert(monitorStatic.staticActive && monitorStatic.staticScreens === monitorStatic.screenCount, `every Workroom display should show animated static: ${JSON.stringify(monitorStatic)}`);
    assert(
      monitorStatic.feastFatherShadow.active
        && monitorStatic.feastFatherShadow.screenCount === monitorStatic.screenCount
        && monitorStatic.feastFatherShadow.progress < 0.08
        && monitorStatic.feastFatherShadow.scale <= monitorStatic.feastFatherShadow.startScale + 0.05
        && monitorStatic.feastFatherShadow.synchronizedTo === "feast-father-breathing-gain"
        && monitorStatic.feastFatherShadow.silhouette === "exact-banquet-saint-model-mask"
        && monitorStatic.feastFatherShadow.sourceModel.endsWith("banquet-saint.glb")
        && monitorStatic.feastFatherShadow.textureReady
        && monitorStatic.feastFatherShadow.maskKind === "model-derived-alpha",
      `a small Feast Father shadow should begin inside every static feed: ${JSON.stringify(monitorStatic.feastFatherShadow)}`,
    );
    await page.waitForTimeout(250);
    await captureStage(page, "workroom-patron-feed-static-blackout-desktop.png");

    await page.waitForFunction(
      () => window.MrFeastFresh?.getBasementHauntState?.()?.workroom?.breathing?.elapsedSeconds >= 6.5,
      null,
      { timeout: 25000 },
    );
    haunt = await page.evaluate(() => window.MrFeastFresh.getBasementHauntState());
    assert(
      haunt.workroom.active
        && haunt.workroom.blackoutActive
        && haunt.workroom.staticActive
        && haunt.workroom.breathing.active
        && haunt.workroom.breathing.rampProgress > 0.35
        && haunt.workroom.breathing.rampProgress < 1
        && haunt.workroom.breathing.currentGain > haunt.workroom.breathing.startGain
        && haunt.workroom.breathing.currentGain < haunt.workroom.breathing.targetGain,
      `static must outlast the old six-second scare while breathing is still rising toward its fifteen-second peak: ${JSON.stringify(haunt.workroom)}`,
    );
    const monitorGrowing = await page.evaluate(() => window.MrFeastFresh.getMonitorWallState());
    assert(
      monitorGrowing.feastFatherShadow.active
        && monitorGrowing.feastFatherShadow.progress > 0.35
        && monitorGrowing.feastFatherShadow.progress < 0.75
        && monitorGrowing.feastFatherShadow.scale > monitorGrowing.feastFatherShadow.startScale
        && monitorGrowing.feastFatherShadow.scale < monitorGrowing.feastFatherShadow.endScale,
      `the black Feast Father shadow should grow with the rising breath: ${JSON.stringify(monitorGrowing.feastFatherShadow)}`,
    );
    await captureStage(page, "workroom-feast-father-shadow-growing-desktop.png");
    haunt = await page.evaluate(() => window.MrFeastFresh.advanceBasementHauntForQA(7));
    assert(
      haunt.workroom.active
        && haunt.workroom.elapsed >= 7
        && haunt.workroom.staticActive
        && haunt.workroom.blackoutActive,
      `the simulated Workroom clock must retain static and blackout beyond the old six-second duration: ${JSON.stringify(haunt.workroom)}`,
    );
    await page.waitForFunction(
      () => window.MrFeastFresh?.getBasementHauntState?.()?.workroom?.breathing?.elapsedSeconds >= 14.7,
      null,
      { timeout: 25000 },
    );
    haunt = await page.evaluate(() => window.MrFeastFresh.getBasementHauntState());
    const breathAtPeakCheck = haunt.workroom.breathing;
    const peakReachedOrReleaseStarted = breathAtPeakCheck.currentGain >= breathAtPeakCheck.targetGain * 0.95
      || breathAtPeakCheck.elapsedSeconds >= breathAtPeakCheck.durationSeconds - breathAtPeakCheck.releaseSeconds;
    const breathPeakWindowReached = breathAtPeakCheck.active
      || breathAtPeakCheck.elapsedSeconds >= breathAtPeakCheck.durationSeconds - breathAtPeakCheck.releaseSeconds;
    assert(
      haunt.workroom.active
        && haunt.workroom.staticActive
        && haunt.workroom.elapsed < haunt.workroom.durationSeconds
        && breathPeakWindowReached
        && haunt.workroom.breathing.rampProgress >= 0.98
        && peakReachedOrReleaseStarted,
      `breathing must reach its authored maximum around fifteen seconds, or complete its short release, while static still holds: ${JSON.stringify(haunt.workroom)}`,
    );
    const monitorLarge = await page.evaluate(() => window.MrFeastFresh.getMonitorWallState());
    assert(
      monitorLarge.feastFatherShadow.active
        && monitorLarge.feastFatherShadow.progress >= 0.98
        && monitorLarge.feastFatherShadow.scale >= monitorLarge.feastFatherShadow.endScale * 0.98,
      `the Feast Father shadow should fill the feed as the breathing peaks: ${JSON.stringify(monitorLarge.feastFatherShadow)}`,
    );
    await captureStage(page, "workroom-feast-father-shadow-large-desktop.png");
    haunt = await page.evaluate(() => window.MrFeastFresh.advanceBasementHauntForQA(20));
    assert(!haunt.workroom.active && haunt.workroom.seen && !haunt.workroom.blackoutActive && !haunt.workroom.staticActive, `the Workroom should return to normal after the bounded scare: ${JSON.stringify(haunt.workroom)}`);
    assert(!haunt.workroom.breathing.active && haunt.workroom.circuitOn, `breathing must stop and the prior Workroom light state must restore: ${JSON.stringify(haunt.workroom)}`);
    const monitorRestored = await page.evaluate(() => window.MrFeastFresh.getMonitorWallState());
    assert(!monitorRestored.staticActive && monitorRestored.staticScreens === 0, `live monitor presentation should return after the scare: ${JSON.stringify(monitorRestored)}`);
    assert(
      !monitorRestored.feastFatherShadow.active
        && monitorRestored.feastFatherShadow.screenCount === 0
        && monitorRestored.feastFatherShadow.progress === 0
        && !haunt.workroom.doorLocked,
      `the shadow and temporary Workroom door lock must clear with the scare: ${JSON.stringify({ shadow: monitorRestored.feastFatherShadow, workroom: haunt.workroom })}`,
    );
    const lightLayoutAfter = await page.evaluate(() => window.MrFeastFresh.lightLayout());
    assert(JSON.stringify(lightLayoutAfter) === JSON.stringify(lightLayoutBefore), `haunts must not change the fixed shader-light topology: before=${JSON.stringify(lightLayoutBefore)} after=${JSON.stringify(lightLayoutAfter)}`);

    const saved = await page.evaluate(() => window.MrFeastFresh.saveGameForQA());
    assert(saved === true, "completed basement haunt flags should save");
    await page.evaluate(() => window.MrFeastFresh.resetBasementHauntForQA({ clearSeen: true }));
    const loaded = await page.evaluate(() => window.MrFeastFresh.loadGameForQA());
    assert(loaded === true, "completed basement haunt flags should load");
    haunt = await page.evaluate(() => window.MrFeastFresh.getBasementHauntState());
    assert(haunt.archive.dropSeen && haunt.workroom.seen && haunt.archive.files.readIds.length === 3, `one-shot discoveries and file reads should survive save/load: ${JSON.stringify(haunt)}`);
    assert(!haunt.archive.active && !haunt.workroom.active && !haunt.workroom.breathing.active, "save restoration must clear transient scare/audio state");

    assert(errors.length === 0, `browser errors: ${errors.join(" | ")}`);
    console.log("Mr. Feast Archive and Workroom haunt regression passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
