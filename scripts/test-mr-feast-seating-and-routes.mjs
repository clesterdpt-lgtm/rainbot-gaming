import { spawn } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_SEATING_TEST_PORT || (52000 + (process.pid % 10000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-seating-and-routes");
const contestantIds = Object.freeze(["mara-voss", "kip-solano", "juniper-cross"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function planarDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
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

function watchErrors(page, errors, prefix = "", ignoredPatterns = []) {
  page.on("pageerror", (error) => errors.push(`${prefix}${error.message}`));
  page.on("console", (message) => {
    if (ignoredPatterns.some((pattern) => pattern.test(message.text()))) return;
    const bindingWarning = message.type() === "warning" && /propertybinding|no target node|could not bind/i.test(message.text());
    if ((message.type() === "error" || bindingWarning) && !/favicon\.ico/i.test(message.text())) {
      errors.push(`${prefix}${message.text()}`);
    }
  });
}

async function pressKey(page, code, key) {
  await page.evaluate(({ code, key }) => {
    const canvas = document.getElementById("mansion-canvas");
    canvas.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true }));
  }, { code, key });
}

async function pressInteract(page) {
  await pressKey(page, "KeyE", "e");
}

async function holdMove(page, { sprint = false, seconds = 0.75 } = {}) {
  if (sprint) await page.keyboard.down("Shift");
  await page.keyboard.down("w");
  await page.evaluate((duration) => window.MrFeastFresh.advancePlayerForQA(duration), seconds);
  await page.keyboard.up("w");
  if (sprint) await page.keyboard.up("Shift");
  return diagnostics(page);
}

function entryById(state, id) {
  return state.contestants.entries.find((entry) => entry.id === id) || null;
}

async function run() {
  const runtimeSource = await readFile(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8");
  const manifestPath = path.join(root, "assets/models/mr-feast/contestants/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  // Keep the first failure focused on the missing feature rather than waiting
  // for three WebGL character loads. This is the red-first milestone gate.
  assert(/const MANSION_SEATING\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the MANSION_SEATING tuning table");
  assert(/const CONTESTANT_ACTIVITY\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the contestant activity state table");
  assert(/class MansionSeatingSystem/.test(runtimeSource), "runtime is missing MansionSeatingSystem");
  assert(/runContestantRoutineForQA/.test(runtimeSource), "runtime is missing deterministic contestant routine QA");
  assert(/getSeatingState/.test(runtimeSource), "runtime is missing focused seating diagnostics");

  for (const id of contestantIds) {
    const spec = manifest.characters.find((entry) => entry.id === id);
    assert(spec?.animations?.walk?.file, `${id} is missing its walk clip manifest entry`);
    const walkPath = path.join(path.dirname(manifestPath), spec.animations.walk.file);
    const walkReportPath = walkPath.replace(/\.glb$/i, ".animation-report.json");
    const [walkStats, walkReport] = await Promise.all([
      stat(walkPath),
      readFile(walkReportPath, "utf8").then(JSON.parse),
    ]);
    assert(walkStats.size > 1_000 && walkStats.size <= 512 * 1024, `${id} walk clip exceeds the 512 KiB budget (${walkStats.size})`);
    assert(
      walkReport.name === "walk"
      && walkReport.stationary === true
      && walkReport.channelsAfter?.rotation >= 20
      && walkReport.channelsAfter?.translation === 0
      && walkReport.channelsAfter?.scale === 0,
      `${id} walk clip must be a stationary rotation-only rig action; got ${JSON.stringify(walkReport)}`,
    );
  }

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
    await desktop.addInitScript(() => localStorage.removeItem("rainbot_game_save:mr-feast-mansion"));
    await desktop.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await desktop.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await desktop.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled, null, { timeout: 120000 });
    await desktop.waitForTimeout(300);

    let state = await diagnostics(desktop);
    assert(state.seating?.total >= 20, `chairs and sofas should register reusable seats; got ${JSON.stringify(state.seating)}`);
    assert(state.seating.entries.some((entry) => entry.kind === "chair"), "seating registry should include standard chairs");
    assert(state.seating.entries.some((entry) => entry.kind === "sofa"), "seating registry should include sofa slots");
    assert(state.seating.occupied === 0 && state.seating.player.seated === false, "fresh seating should begin unoccupied");

    // --- Real player E interaction and movement lock ------------------------
    const sofaSeat = state.seating.entries.find((entry) => entry.kind === "sofa" && !entry.occupiedBy);
    assert(sofaSeat, "expected at least one available sofa slot");
    const approach = await desktop.evaluate((seatId) => window.MrFeastFresh.placePlayerNearSeatForQA(seatId), sofaSeat.id);
    assert(approach?.seatId === sofaSeat.id && approach.distance <= 2.35, `QA seat placement should use a real interaction approach; got ${JSON.stringify(approach)}`);
    await desktop.waitForFunction(() => /^sit\b/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    const beforeSit = await diagnostics(desktop);
    await pressInteract(desktop);
    await desktop.waitForTimeout(100);
    state = await diagnostics(desktop);
    assert(state.seating.player.seated && state.seating.player.seatId === sofaSeat.id, `E should occupy the aimed sofa slot; got ${JSON.stringify(state.seating.player)}`);
    assert(state.seating.player.movementLocked && state.player.movement.mode === "seated", "sitting should select the authoritative movement-locked seated mode");
    assert(state.hidden === false && state.player.hidden === false, "sitting must stay visible to cameras and danger");
    assert(state.player.movement.eyeHeight < state.player.movement.standingEyeHeight - 0.2, "sitting should visibly lower the player's eye line");
    assert(/^stand up$/i.test(state.prompt || ""), `the occupied seat should expose Stand up; got ${state.prompt}`);

    const seatedEnergy = state.player.movement.energy;
    await pressKey(desktop, "KeyC", "c");
    const afterBlockedMove = await holdMove(desktop, { sprint: true, seconds: 0.8 });
    assert(planarDistance(beforeSit.player, afterBlockedMove.player) < 0.01, "W/Shift must not move the seated player capsule");
    assert(afterBlockedMove.player.movement.mode === "seated" && !afterBlockedMove.player.movement.crouched && !afterBlockedMove.player.movement.sprinting, "seated input must not crouch or sprint");
    assert(Math.abs(afterBlockedMove.player.movement.energy - seatedEnergy) < 0.01, "blocked seated sprint input must not drain energy");

    await pressKey(desktop, "Escape", "Escape");
    state = await diagnostics(desktop);
    assert(state.menus.escapeOpen, "Escape menu should remain available while seated");
    await pressKey(desktop, "Escape", "Escape");
    await pressInteract(desktop);
    await desktop.waitForTimeout(80);
    state = await diagnostics(desktop);
    assert(!state.seating.player.seated && state.player.movement.mode !== "seated", "second real E interaction should stand the player");
    assert(state.seating.entries.find((entry) => entry.id === sofaSeat.id).occupiedBy === null, "standing should release the sofa slot");
    const afterStandStart = state.player;
    const afterStandMove = await holdMove(desktop, { seconds: 0.45 });
    assert(planarDistance(afterStandStart, afterStandMove.player) > 0.35, "normal movement should resume after standing");

    // --- Exclusive occupancy and transient save/load recovery ---------------
    await desktop.evaluate((seatId) => window.MrFeastFresh.sitPlayerForQA(seatId), sofaSeat.id);
    const blockedNpcSeat = await desktop.evaluate(({ id, seatId }) => window.MrFeastFresh.seatContestantForQA(id, seatId), { id: "juniper-cross", seatId: sofaSeat.id });
    assert(blockedNpcSeat?.seated === false && /occupied/i.test(blockedNpcSeat.reason || ""), `a contestant must not steal the player's seat; got ${JSON.stringify(blockedNpcSeat)}`);
    assert(await desktop.evaluate(() => window.MrFeastFresh.saveGameForQA()), "saving should remain available while seated");
    await desktop.evaluate(() => window.MrFeastFresh.standPlayerForQA());
    const npcSeat = await desktop.evaluate(({ id, seatId }) => window.MrFeastFresh.seatContestantForQA(id, seatId), { id: "juniper-cross", seatId: sofaSeat.id });
    assert(npcSeat?.seated === true && npcSeat.seatId === sofaSeat.id, `released seat should accept a contestant; got ${JSON.stringify(npcSeat)}`);
    const blockedPlayerSeat = await desktop.evaluate((seatId) => window.MrFeastFresh.sitPlayerForQA(seatId), sofaSeat.id);
    assert(blockedPlayerSeat?.seated === false && /occupied/i.test(blockedPlayerSeat.reason || ""), `player must not steal an NPC seat; got ${JSON.stringify(blockedPlayerSeat)}`);
    await desktop.evaluate(() => window.MrFeastFresh.standContestantForQA("juniper-cross"));
    await desktop.evaluate(() => window.MrFeastFresh.teleport("foyer"));
    assert(await desktop.evaluate(() => window.MrFeastFresh.loadGameForQA()), "the seated save should restore as a compatible save");
    state = await diagnostics(desktop);
    assert(!state.seating.player.seated && state.seating.occupied === 0, "load should clear transient seat reservations rather than restore a stale seated state");

    // --- Chair cushion/back resolver and tamper compatibility ----------------
    const chairSeat = state.seating.entries.find((entry) => entry.kind === "chair" && entry.tamperId);
    assert(chairSeat, "standard chair seats should link to the existing tamper entry");
    await desktop.evaluate((seatId) => window.MrFeastFresh.placePlayerNearSeatForQA(seatId), chairSeat.id);
    await desktop.waitForFunction(() => /^sit\b/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressInteract(desktop);
    const occupiedTamper = await desktop.evaluate((tamperId) => window.MrFeastFresh.tamperForQA(tamperId, true), chairSeat.tamperId);
    assert(occupiedTamper?.tampered === false && /occupied/i.test(occupiedTamper.blockedReason || ""), `occupied chairs must reject tampering; got ${JSON.stringify(occupiedTamper)}`);
    await desktop.evaluate(() => window.MrFeastFresh.standPlayerForQA());
    const vacantTamper = await desktop.evaluate((tamperId) => window.MrFeastFresh.tamperForQA(tamperId, true), chairSeat.tamperId);
    assert(vacantTamper?.tampered === true, `vacant chair should keep the existing tamper action; got ${JSON.stringify(vacantTamper)}`);
    await desktop.evaluate((tamperId) => window.MrFeastFresh.tamperForQA(tamperId, false), chairSeat.tamperId);

    // --- Three deterministic walk-idle-sit routines --------------------------
    for (const id of contestantIds) {
      const initial = entryById(await diagnostics(desktop), id);
      assert(initial?.route?.points >= 3, `${id} needs a compact multi-point route; got ${JSON.stringify(initial?.route)}`);
      assert(initial.route.length >= 1 && initial.route.length <= 8, `${id} route should remain room-scale; got ${initial.route.length}m`);
      assert(initial.route.minimumPatrolClearance >= 1.65, `${id} route is too close to Mr. Feast's patrol; got ${initial.route.minimumPatrolClearance}m`);
      assert(initial.animation?.available?.includes("walk") && initial.animation.available.includes("idle"), `${id} should bind idle and walk actions; got ${JSON.stringify(initial.animation)}`);
      const result = await desktop.evaluate(({ id, seconds }) => window.MrFeastFresh.runContestantRoutineForQA(id, seconds), { id, seconds: 90 });
      assert(result?.completed === true && result.cycles >= 1, `${id} should complete a deterministic routine cycle; got ${JSON.stringify(result)}`);
      assert(result.activities.includes("walking") && result.activities.includes("idle") && result.activities.includes("seated"), `${id} routine should walk, pause, and sit; got ${JSON.stringify(result.activities)}`);
      assert(result.distanceTravelled >= 1 && result.teleports === 0, `${id} should materially walk without teleporting; got ${JSON.stringify(result)}`);
      assert(result.blockedSteps === 0 && result.maximumColliderOffset <= 0.03, `${id} collider should follow the rendered root; got ${JSON.stringify(result)}`);
      assert(result.floorStayedFixed === true && result.minimumPatrolClearance >= 1.65, `${id} should remain on a route-safe authored floor; got ${JSON.stringify(result)}`);
    }

    // Conversations must still bind to the contestant's live moving root.
    await desktop.evaluate(() => window.MrFeastFresh.placePlayerNearContestantForQA("mara-voss", 1.6));
    await desktop.waitForFunction(() => /speak with mara voss/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressInteract(desktop);
    await desktop.waitForTimeout(100);
    state = await diagnostics(desktop);
    assert(state.speech.speakerId === "mara-voss" && state.speech.visible, `conversation should follow Mara's moved body; got ${JSON.stringify(state.speech)}`);

    // Visual proof for both sides of the shared seating contract.
    await desktop.evaluate((seatId) => window.MrFeastFresh.sitPlayerForQA(seatId), sofaSeat.id);
    await desktop.waitForTimeout(100);
    await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "player-seated-desktop.png") });
    await desktop.evaluate(() => window.MrFeastFresh.standPlayerForQA());
    const seatedContestant = await desktop.evaluate(() => window.MrFeastFresh.seatContestantForQA("juniper-cross"));
    assert(seatedContestant?.seated && seatedContestant.poseApplied, `Juniper should visibly use the shared seated pose; got ${JSON.stringify(seatedContestant)}`);
    await desktop.evaluate(() => window.MrFeastFresh.placePlayerNearContestantForQA("juniper-cross", 2.1));
    await desktop.waitForTimeout(120);
    await desktop.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "juniper-seated-desktop.png") });
    await desktop.evaluate(() => window.MrFeastFresh.standContestantForQA("juniper-cross"));
    assert(desktopErrors.length === 0, `desktop console errors: ${desktopErrors.join(" | ")}`);
    await desktop.close();

    // Abort one optional walk request: the mansion and social roster must
    // still boot, while that contestant reports an idle-only fallback.
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobileErrors = [];
    watchErrors(mobile, mobileErrors, "mobile: ", [/net::ERR_FAILED/i]);
    await mobile.route(/kip-solano-walk\.glb(?:\?|$)/, (route) => route.abort("failed"));
    await mobile.goto(gameUrl, { waitUntil: "domcontentloaded" });
    await mobile.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await mobile.waitForFunction(() => window.MrFeastFresh.getContestantState?.()?.settled, null, { timeout: 120000 });
    state = await diagnostics(mobile);
    const mobileKip = entryById(state, "kip-solano");
    assert(state.ready && state.contestants.loaded === 3, `optional walk failure must not block the roster or mansion; got ${JSON.stringify(state.contestants)}`);
    assert(mobileKip.locomotionStatus === "idle-fallback" && mobileKip.loaded, `Kip should isolate the failed walk clip; got ${JSON.stringify(mobileKip)}`);

    const mobileSeat = state.seating.entries.find((entry) => entry.kind === "sofa" && !entry.occupiedBy);
    await mobile.evaluate((seatId) => window.MrFeastFresh.placePlayerNearSeatForQA(seatId), mobileSeat.id);
    await mobile.waitForFunction(() => /^sit\b/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await mobile.locator("#touch-interact").click({ force: true });
    await mobile.waitForTimeout(100);
    state = await diagnostics(mobile);
    assert(state.seating.player.seated && /^stand up$/i.test(state.prompt || ""), `touch interaction should sit and expose Stand up; got ${JSON.stringify(state.seating.player)}`);
    const touchControl = await mobile.locator("#touch-interact").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const stage = document.getElementById("mansion-stage").getBoundingClientRect();
      return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, stage };
    });
    assert(touchControl.width >= 44 && touchControl.height >= 44, `touch interact should remain at least 44px; got ${JSON.stringify(touchControl)}`);
    assert(touchControl.left >= touchControl.stage.left && touchControl.right <= touchControl.stage.right && touchControl.top >= touchControl.stage.top && touchControl.bottom <= touchControl.stage.bottom, `touch interact should remain inside the stage; got ${JSON.stringify(touchControl)}`);
    await mobile.locator("#mansion-stage").screenshot({ path: path.join(artifactDir, "player-seated-mobile.png") });
    await mobile.locator("#touch-interact").click({ force: true });
    assert(!(await diagnostics(mobile)).seating.player.seated, "second touch interaction should stand the player");
    assert(mobileErrors.length === 0, `mobile console errors: ${mobileErrors.join(" | ")}`);
    await mobile.close();

    console.log("Mr. Feast seating and contestant routine checks passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
