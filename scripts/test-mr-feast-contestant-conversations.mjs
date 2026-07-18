import { spawn } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_CONTESTANT_TEST_PORT || (50500 + (process.pid % 12000)));
const baseUrl = `http://127.0.0.1:${port}`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-contestant-conversations");
const expected = Object.freeze([
  Object.freeze({ id: "mara-voss", name: "Mara Voss", number: "03", persona: "The Strategist", room: "LIBRARY" }),
  Object.freeze({ id: "kip-solano", name: "Kip Solano", number: "07", persona: "The Wild Card", room: "BALLROOM" }),
  Object.freeze({ id: "juniper-cross", name: "Juniper Cross", number: "10", persona: "The Folklorist", room: "READING ROOM" }),
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
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
    const bindingWarning = message.type() === "warning" && /propertybinding|no target node|could not bind/i.test(message.text());
    if ((message.type() === "error" || bindingWarning) && !/favicon\.ico/i.test(message.text())) errors.push(message.text());
  });
}

async function pressInteract(page) {
  await page.evaluate(() => {
    const canvas = document.getElementById("mansion-canvas");
    canvas.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", key: "e", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyE", key: "e", bubbles: true }));
  });
}

function entryById(state, id) {
  return state.contestants.entries.find((entry) => entry.id === id) || null;
}

async function run() {
  const runtimePath = path.join(root, "assets/js/mr-feast-mansion.js");
  const pagePath = path.join(root, "games/mr-feast-mansion.html");
  const runtimeSource = await readFile(runtimePath, "utf8");
  const pageSource = await readFile(pagePath, "utf8");

  // This source contract is intentionally checked before asset reads so a new
  // implementation starts red with a precise missing-system failure.
  assert(/const MANSION_CONTESTANTS\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the MANSION_CONTESTANTS tuning/persona table");
  assert(/class MansionContestantSystem/.test(runtimeSource), "runtime is missing the MansionContestantSystem");
  assert(/getContestantState/.test(runtimeSource), "runtime is missing focused contestant diagnostics");
  assert(/id="mansion-speech-speaker"/.test(pageSource), "the shared speech bubble is missing its speaker-name element");
  assert(/window\.render_game_to_text/.test(runtimeSource), "the text diagnostics contract must remain available");

  const manifestPath = path.join(root, "assets/models/mr-feast/contestants/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(manifest.version >= 1, "contestant manifest needs a version");
  assert(manifest.characters?.length === 3, `expected exactly three contestant assets; got ${manifest.characters?.length}`);
  const allLines = [];
  for (const spec of expected) {
    const character = manifest.characters.find((entry) => entry.id === spec.id);
    assert(character, `manifest is missing ${spec.id}`);
    assert(character.name === spec.name && character.number === spec.number, `${spec.id} identity drifted from the milestone`);
    assert(character.persona === spec.persona && character.room === spec.room, `${spec.id} persona or room drifted from the milestone`);
    assert(character.source?.provider === "Meshy" && character.source?.rigTaskId, `${spec.id} needs Meshy generation and rig provenance`);
    assert(character.blender?.version && character.report, `${spec.id} needs Blender preparation provenance`);
    assert(Array.isArray(character.dialogue) && character.dialogue.length >= 8, `${spec.id} needs at least eight lines`);
    assert(new Set(character.dialogue).size === character.dialogue.length, `${spec.id} has duplicate lines in its own pool`);
    allLines.push(...character.dialogue);

    const modelPath = path.join(path.dirname(manifestPath), character.model);
    const idlePath = path.join(path.dirname(manifestPath), character.animations.idle.file);
    const reportPath = path.join(path.dirname(manifestPath), character.report);
    const [modelStats, idleStats, report] = await Promise.all([
      stat(modelPath),
      stat(idlePath),
      readFile(reportPath, "utf8").then(JSON.parse),
    ]);
    assert(modelStats.size > 100_000 && modelStats.size <= 12 * 1024 * 1024, `${spec.id} model exceeds the 12 MiB browser budget (${modelStats.size})`);
    assert(idleStats.size > 1_000 && idleStats.size <= 512 * 1024, `${spec.id} idle clip exceeds the 512 KiB budget (${idleStats.size})`);
    assert(report.rigged === true && report.bones >= 20, `${spec.id} Blender report must prove a humanoid rig`);
    const triangleBudget = spec.id === "juniper-cross" ? 55_000 : 30_000;
    assert(report.game?.triangles > 1_000 && report.game.triangles <= triangleBudget, `${spec.id} exceeds its ${triangleBudget.toLocaleString()} triangle budget`);
    assert(report.textureMaxSize <= 1024, `${spec.id} exceeds the 1024 px texture budget`);
  }
  assert(new Set(allLines).size === allLines.length, "contestants must not share dialogue lines");

  let server = null;
  let browser = null;
  if (!(await serverResponds())) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", root], { stdio: "ignore" });
  }

  try {
    await waitForServer();
    await mkdir(artifactDir, { recursive: true });
    browser = await chromium.launch({ headless: true });

    const desktop = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const desktopErrors = [];
    watchErrors(desktop, desktopErrors);
    await desktop.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`, { waitUntil: "domcontentloaded" });
    await desktop.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await desktop.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled, null, { timeout: 120000 });
    await desktop.waitForTimeout(250);

    let state = await diagnostics(desktop);
    assert(state.contestants, "render_game_to_text should expose contestant diagnostics");
    assert(state.contestants.expected === 3 && state.contestants.loaded === 3 && state.contestants.failed === 0, `all three contestants should load; got ${JSON.stringify(state.contestants)}`);
    assert(new Set(state.contestants.entries.map((entry) => entry.room)).size === 3, "contestants should occupy three different rooms");
    for (const spec of expected) {
      const entry = entryById(state, spec.id);
      assert(entry?.status === "ready" && entry.loaded, `${spec.name} should be ready`);
      assert(entry.name === spec.name && entry.persona === spec.persona && entry.room === spec.room, `${spec.id} runtime identity drifted`);
      assert(entry.grounded === true && entry.height >= 1.6 && entry.height <= 1.95, `${spec.name} should be grounded at a human scale; got ${JSON.stringify(entry)}`);
      assert(entry.bones >= 20 && entry.skinnedMeshes >= 1, `${spec.name} should remain a skinned rig; got ${JSON.stringify(entry)}`);
      assert(entry.animation?.name === "idle" && entry.animation.playing === true, `${spec.name} should play the idle clip`);
      assert(
        entry.animation.tracks?.rotation >= 20
        && entry.animation.tracks.boundRotation === entry.animation.tracks.rotation
        && entry.animation.tracks.dynamicRotation >= 1
        && entry.animation.tracks.translation === 0
        && entry.animation.tracks.scale === 0,
        `${spec.name}'s stationary idle should bind to the rig; got ${JSON.stringify(entry.animation.tracks)}`,
      );
      assert(entry.modelVisible && entry.colliderEnabled, `${spec.name} should be visible and physically grounded in the room`);
      assert(entry.interactionRegistered === true, `${spec.name} should have one body interaction target`);
      assert(entry.routeClearance >= 1.7, `${spec.name} should remain clear of Mr. Feast's patrol path; got ${entry.routeClearance}m`);
    }

    const animationBefore = Object.fromEntries(state.contestants.entries.map((entry) => [entry.id, entry.animation.time]));
    await desktop.evaluate(() => window.advanceTime(650));
    state = await diagnostics(desktop);
    for (const entry of state.contestants.entries) {
      assert(entry.animation.time !== animationBefore[entry.id], `${entry.name}'s idle mixer should advance`);
      assert(entry.animation.poseChanged === true, `${entry.name}'s bound idle should move a skeleton bone`);
    }

    const firstLines = new Map();
    for (const spec of expected) {
      const placement = await desktop.evaluate((id) => window.MrFeastFresh.placePlayerNearContestantForQA(id, 1.65), spec.id);
      assert(placement?.id === spec.id && placement.distance <= 2.35, `QA placement should put the player near ${spec.name}; got ${JSON.stringify(placement)}`);
      if (spec.id === "juniper-cross") {
        const clearOfReadingSofa = placement.position.x > 9.75 || Math.abs(placement.position.z) > 1.425;
        assert(clearOfReadingSofa, `Juniper's approach should stay outside the Reading Room sofa collider; got ${JSON.stringify(placement.position)}`);
      }
      await desktop.waitForFunction((name) => new RegExp(`speak with ${name}`, "i").test(JSON.parse(window.render_game_to_text()).prompt || ""), spec.name, { timeout: 8000 });
      await pressInteract(desktop);
      await desktop.waitForTimeout(120);
      state = await diagnostics(desktop);
      assert(state.speech.visible && state.speech.speakerId === spec.id && state.speech.speakerName === spec.name, `the bubble should identify ${spec.name}; got ${JSON.stringify(state.speech)}`);
      assert(state.speech.category === `contestant-${spec.id}`, `${spec.name} should use a private dialogue category`);
      assert(entryById(state, spec.id).lastLine === state.speech.text, `${spec.name}'s diagnostics should record the spoken line`);
      assert(manifest.characters.find((entry) => entry.id === spec.id).dialogue.includes(state.speech.text), `${spec.name} spoke outside their authored pool`);
      firstLines.set(spec.id, state.speech.text);
      const second = await desktop.evaluate((id) => window.MrFeastFresh.converseWithContestantForQA(id), spec.id);
      assert(second?.text && second.text !== firstLines.get(spec.id), `${spec.name} should not immediately repeat a line`);
      await desktop.waitForTimeout(80);
      const speakerLabel = await desktop.locator("#mansion-speech-speaker").textContent();
      assert(speakerLabel === spec.name, `speaker label should show ${spec.name}; got ${speakerLabel}`);
      await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, `${spec.id}-desktop.png`) });
    }
    assert(new Set(firstLines.values()).size === 3, "the first line from each persona should be unique");

    // Existing host dialogue must still use the same bubble after it was
    // generalized to support multiple speakers.
    await desktop.waitForFunction(() => window.MrFeastFresh.getMrFeastState?.()?.loaded, null, { timeout: 120000 });
    await desktop.evaluate(() => window.MrFeastFresh.placePlayerNearMrFeastForQA(1.8));
    await desktop.evaluate(() => window.MrFeastFresh.converseWithMrFeastForQA());
    await desktop.waitForTimeout(100);
    state = await diagnostics(desktop);
    assert(state.speech.speakerId === "mr-feast" && state.speech.speakerName === "Mr. Feast", `host speech compatibility regressed; got ${JSON.stringify(state.speech)}`);
    assert(desktopErrors.length === 0, `desktop console errors: ${desktopErrors.join(" | ")}`);
    await desktop.close();

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobileErrors = [];
    watchErrors(mobile, mobileErrors);
    await mobile.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`, { waitUntil: "domcontentloaded" });
    await mobile.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await mobile.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled, null, { timeout: 120000 });
    const mobileContestants = await mobile.evaluate(() => window.MrFeastFresh.getContestantState());
    assert(mobileContestants.loaded === 3 && mobileContestants.failed === 0, `all mobile contestant loads should settle successfully; got ${JSON.stringify(mobileContestants)}`);
    await mobile.evaluate(() => window.MrFeastFresh.placePlayerNearContestantForQA("kip-solano", 1.6));
    await mobile.waitForFunction(() => /speak with kip solano/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await mobile.locator("#touch-interact").click({ force: true });
    await mobile.waitForTimeout(120);
    const mobileBubble = await mobile.evaluate(() => {
      const element = document.getElementById("mansion-speech");
      const rect = element.getBoundingClientRect();
      return {
        hidden: element.hidden,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        fontPx: Number.parseFloat(getComputedStyle(document.getElementById("mansion-speech-text")).fontSize),
        state: JSON.parse(window.render_game_to_text()).speech,
      };
    });
    assert(!mobileBubble.hidden && mobileBubble.state.speakerId === "kip-solano", `touch interaction should open Kip's bubble; got ${JSON.stringify(mobileBubble.state)}`);
    assert(mobileBubble.rect.left >= 0 && mobileBubble.rect.right <= 390 && mobileBubble.rect.top >= 0 && mobileBubble.rect.bottom <= 844, `mobile bubble should fit the stage; got ${JSON.stringify(mobileBubble.rect)}`);
    assert(mobileBubble.fontPx >= 12, `mobile dialogue should stay readable; got ${mobileBubble.fontPx}px`);
    await mobile.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "kip-solano-mobile.png") });
    assert(mobileErrors.length === 0, `mobile console errors: ${mobileErrors.join(" | ")}`);
    await mobile.close();

    console.log("Mr. Feast mansion contestant conversations checks passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
