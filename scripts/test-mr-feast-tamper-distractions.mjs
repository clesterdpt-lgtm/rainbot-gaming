import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MR_FEAST_TAMPER_TEST_PORT || (48000 + (process.pid % 14000)));
const baseUrl = `http://127.0.0.1:${port}`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-tamper-distractions");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wrappedAngleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
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

async function pressKey(page, code, key) {
  await page.evaluate(({ code, key }) => {
    const canvas = document.getElementById("mansion-canvas");
    canvas.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true }));
  }, { code, key });
}

function entryById(tamper, id) {
  return tamper.entries.find((entry) => entry.id === id) || null;
}

function nearestEntry(tamper, kind, x, z) {
  return tamper.entries
    .filter((entry) => entry.kind === kind)
    .reduce((nearest, entry) => {
      const distance = Math.hypot(entry.position.x - x, entry.position.z - z);
      return !nearest || distance < nearest.distance ? { entry, distance } : nearest;
    }, null)?.entry || null;
}

async function run() {
  const runtimeSource = await readFile(path.join(root, "assets/js/mr-feast-mansion.js"), "utf8");
  const pageSource = await readFile(path.join(root, "games/mr-feast-mansion.html"), "utf8");
  assert(/const MANSION_TAMPER\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the MANSION_TAMPER tuning table");
  assert(/const MR_FEAST_SPEECH\s*=\s*Object\.freeze/.test(runtimeSource), "runtime is missing the MR_FEAST_SPEECH line table");
  assert(/class TamperSystem/.test(runtimeSource), "runtime is missing the TamperSystem class");
  assert(/id="mansion-speech"/.test(pageSource), "page is missing the Mr. Feast speech bubble element");
  assert(/if \(state\.qa[^\n]*\) this\.registerFaceQaInteraction\(model\)/.test(runtimeSource), "the QA-only face interaction registration must be preserved");

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
    await desktop.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loadStatus === "ready", null, { timeout: 120000 });
    await desktop.waitForTimeout(300);

    // --- Registration counts -------------------------------------------------
    let state = await diagnostics(desktop);
    const tamper = state.tamper;
    assert(tamper, "diagnostics should expose a tamper block");
    assert(tamper.counts.portrait >= 12, `expected at least 12 tamperable portraits; got ${JSON.stringify(tamper?.counts)}`);
    assert(tamper.counts.chair >= 14, `expected at least 14 tamperable chairs; got ${JSON.stringify(tamper?.counts)}`);
    assert(tamper.counts.fridge >= 1, `expected the kitchen refrigerator to be tamperable; got ${JSON.stringify(tamper?.counts)}`);
    assert(state.speech && state.speech.visible === false, "speech diagnostics should start hidden");
    assert(state.mrFeast.housekeeping && state.mrFeast.housekeeping.state === "idle", "housekeeping diagnostics should start idle");

    // --- Real portrait interaction: aim, tilt, and read the prompt -----------
    await desktop.evaluate(() => window.MrFeastFresh.teleport("tamperMusicPortrait"));
    await desktop.waitForFunction(() => /tilt/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    state = await diagnostics(desktop);
    assert(/portrait/i.test(state.prompt), `aiming at a portrait should offer a tilt prompt; got ${state.prompt}`);
    await pressKey(desktop, "KeyE", "e");
    await desktop.waitForTimeout(120);
    state = await diagnostics(desktop);
    const portraitEntry = nearestEntry(state.tamper, "portrait", 14.8, 7.8);
    assert(portraitEntry?.tampered === true, `pressing E should tilt the aimed portrait; got ${JSON.stringify(portraitEntry)}`);
    assert(Math.abs(portraitEntry.visualOffset) > 0.05, `a tilted portrait should carry a visible roll offset; got ${JSON.stringify(portraitEntry)}`);
    assert(/straighten/i.test(state.prompt || ""), `a tilted portrait should offer a straighten prompt; got ${state.prompt}`);

    // --- Notice, walk over, speak, and fix ------------------------------------
    let notice = await desktop.evaluate(() => window.MrFeastFresh.advanceTamperForQA(30));
    assert(notice.dispatched.includes(portraitEntry.id), `the tilted portrait should be noticed and dispatched after the notice delay; got ${JSON.stringify(notice)}`);
    state = await diagnostics(desktop);
    assert(state.mrFeast.security.state === "responding", `Mr. Feast should walk toward the tampered portrait; got ${state.mrFeast.security.state}`);
    assert(state.mrFeast.housekeeping.activeTaskId === portraitEntry.id, `housekeeping should carry the portrait task; got ${JSON.stringify(state.mrFeast.housekeeping)}`);
    assert(state.speech.visible === true && state.speech.category === "noticed-portrait", `noticing should show an upset portrait line; got ${JSON.stringify(state.speech)}`);
    assert(state.speech.text.length >= 12, `the noticed line should be a real sentence; got ${JSON.stringify(state.speech.text)}`);

    const housekeepingRun = await desktop.evaluate(() => window.MrFeastFresh.runMrFeastHousekeepingForQA(420));
    assert(housekeepingRun.completed === true, `the housekeeping errand should finish; got ${JSON.stringify(housekeepingRun)}`);
    assert(housekeepingRun.fixesCompleted >= 1, `the errand should record a completed fix; got ${JSON.stringify(housekeepingRun)}`);
    assert(housekeepingRun.teleports === 0, "housekeeping must not teleport Mr. Feast");
    assert(housekeepingRun.states.includes("responding") && housekeepingRun.states.includes("searching") && housekeepingRun.states.includes("returning"), `housekeeping should reuse the bounded response states; got ${JSON.stringify(housekeepingRun.states)}`);
    state = await diagnostics(desktop);
    const fixedPortrait = entryById(state.tamper, portraitEntry.id);
    assert(fixedPortrait.tampered === false && Math.abs(fixedPortrait.visualOffset) < 0.001, `the portrait should be straightened after the fix; got ${JSON.stringify(fixedPortrait)}`);
    assert(state.mrFeast.security.state === "patrol", `Mr. Feast should resume patrol after fixing; got ${state.mrFeast.security.state}`);
    assert(state.speech.lastCategory === "fixed-portrait", `the fix should speak a fixed-portrait line; got ${JSON.stringify(state.speech)}`);
    await desktop.evaluate(() => window.MrFeastFresh.resetMrFeastWandererForQA());

    // --- Real chair interaction with collider sync ---------------------------
    await desktop.evaluate(() => window.MrFeastFresh.teleport("tamperDiningChair"));
    await desktop.waitForFunction(() => /pull/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(desktop, "KeyE", "e");
    await desktop.waitForTimeout(120);
    state = await diagnostics(desktop);
    const chairEntry = nearestEntry(state.tamper, "chair", -12.0, -7.25);
    assert(chairEntry?.tampered === true, `pressing E should pull the aimed chair askew; got ${JSON.stringify(chairEntry)}`);
    assert(chairEntry.colliderOffset > 0.15, `the chair collider should follow the pulled mesh; got ${JSON.stringify(chairEntry)}`);
    assert(Math.abs(chairEntry.visualOffset) > 0.2, `a pulled chair should carry a diagonal yaw offset; got ${JSON.stringify(chairEntry)}`);

    // --- Self-fix before he arrives cancels the errand ------------------------
    notice = await desktop.evaluate(() => window.MrFeastFresh.advanceTamperForQA(30));
    assert(notice.dispatched.includes(chairEntry.id), `the pulled chair should be noticed; got ${JSON.stringify(notice)}`);
    await desktop.waitForFunction(() => /straighten/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(desktop, "KeyE", "e");
    await desktop.waitForTimeout(120);
    state = await diagnostics(desktop);
    const straightenedChair = entryById(state.tamper, chairEntry.id);
    assert(straightenedChair.tampered === false && straightenedChair.colliderOffset < 0.01, `straightening the chair yourself should restore mesh and collider; got ${JSON.stringify(straightenedChair)}`);
    assert(straightenedChair.cooldownRemaining > 0, `a just-restored object should hold a re-tamper cooldown; got ${JSON.stringify(straightenedChair)}`);
    assert(state.mrFeast.housekeeping.activeTaskId === null, `a self-fixed tamper should cancel the errand; got ${JSON.stringify(state.mrFeast.housekeeping)}`);
    const cancelRun = await desktop.evaluate(() => window.MrFeastFresh.runMrFeastHousekeepingForQA(420));
    assert(cancelRun.completed === true, `Mr. Feast should walk back to patrol after a cancelled errand; got ${JSON.stringify(cancelRun)}`);
    await desktop.evaluate(() => window.MrFeastFresh.resetMrFeastWandererForQA());

    // --- Fridge left open ------------------------------------------------------
    await desktop.evaluate(() => window.MrFeastFresh.teleport("tamperFridge"));
    await desktop.waitForFunction(() => /refrigerator/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(desktop, "KeyE", "e");
    await desktop.waitForTimeout(400);
    state = await diagnostics(desktop);
    const fridgeEntry = state.tamper.entries.find((entry) => entry.kind === "fridge");
    assert(fridgeEntry?.tampered === true, `an open refrigerator should count as tampered; got ${JSON.stringify(fridgeEntry)}`);
    notice = await desktop.evaluate(() => window.MrFeastFresh.advanceTamperForQA(30));
    assert(notice.dispatched.includes(fridgeEntry.id), `the open refrigerator should be noticed; got ${JSON.stringify(notice)}`);
    state = await diagnostics(desktop);
    assert(state.speech.category === "noticed-fridge", `the fridge notice should use the fridge pool; got ${JSON.stringify(state.speech)}`);
    const fridgeRun = await desktop.evaluate(() => window.MrFeastFresh.runMrFeastHousekeepingForQA(420));
    assert(fridgeRun.completed === true && fridgeRun.fixesCompleted >= 1, `Mr. Feast should close the refrigerator; got ${JSON.stringify(fridgeRun)}`);
    state = await diagnostics(desktop);
    assert(state.tamper.entries.find((entry) => entry.kind === "fridge").tampered === false, "the refrigerator should be closed after the fix");

    // --- Camera alarm preempts housekeeping and re-queues the tamper ----------
    await desktop.evaluate(() => window.MrFeastFresh.resetMrFeastWandererForQA());
    await desktop.evaluate((id) => window.MrFeastFresh.tamperForQA(id, true), portraitEntry.id);
    notice = await desktop.evaluate(() => window.MrFeastFresh.advanceTamperForQA(30));
    assert(notice.dispatched.includes(portraitEntry.id), `the portrait should re-dispatch after its cooldown; got ${JSON.stringify(notice)}`);
    const alarmDuringErrand = await desktop.evaluate(() => {
      const cameraId = window.MrFeastFresh.getCameraSecurityState().cameras.details[0].id;
      window.MrFeastFresh.triggerCameraAlarmForQA(cameraId, "qa-tamper-preemption");
      return JSON.parse(window.render_game_to_text());
    });
    assert(alarmDuringErrand.mrFeast.housekeeping.activeTaskId === null, `a real camera alarm should preempt the errand; got ${JSON.stringify(alarmDuringErrand.mrFeast.housekeeping)}`);
    assert(alarmDuringErrand.mrFeast.security.activeAlarm, "the camera alarm should own the response after preemption");
    assert(alarmDuringErrand.tamper.entries.find((entry) => entry.id === portraitEntry.id).tampered === true, "the interrupted tamper should stay tampered for a later errand");
    const alarmRun = await desktop.evaluate(() => window.MrFeastFresh.runMrFeastCameraResponseForQA(420));
    assert(alarmRun.completed === true, `the preempting camera response should still complete; got ${JSON.stringify(alarmRun)}`);
    await desktop.evaluate(() => window.MrFeastFresh.resetMrFeastWandererForQA());
    notice = await desktop.evaluate(() => window.MrFeastFresh.advanceTamperForQA(60));
    assert(notice.dispatched.includes(portraitEntry.id), `the interrupted tamper should re-queue after the alarm; got ${JSON.stringify(notice)}`);
    const requeueRun = await desktop.evaluate(() => window.MrFeastFresh.runMrFeastHousekeepingForQA(420));
    assert(requeueRun.completed === true && requeueRun.fixesCompleted >= 1, `the re-queued tamper should be fixed after the alarm; got ${JSON.stringify(requeueRun)}`);

    // --- Speak with Mr. Feast --------------------------------------------------
    await desktop.evaluate(() => window.MrFeastFresh.resetMrFeastWandererForQA());
    const talkSetup = await desktop.evaluate(() => window.MrFeastFresh.placePlayerNearMrFeastForQA(1.6));
    assert(talkSetup && talkSetup.distance <= 2.35, `the QA talk placement should stand within interaction range; got ${JSON.stringify(talkSetup)}`);
    await desktop.waitForFunction(() => /speak with mr\. feast/i.test(JSON.parse(window.render_game_to_text()).prompt || ""), null, { timeout: 8000 });
    await pressKey(desktop, "KeyE", "e");
    await desktop.waitForTimeout(150);
    state = await diagnostics(desktop);
    assert(state.speech.visible === true && state.speech.category === "talk", `speaking should show a smalltalk line; got ${JSON.stringify(state.speech)}`);
    assert(state.speech.text.length >= 16, `smalltalk should be a full sentence; got ${JSON.stringify(state.speech.text)}`);
    assert(state.mrFeast.pauseRemaining > 0, `smalltalk should briefly pause the patrol; got ${state.mrFeast.pauseRemaining}`);
    assert(state.mrFeast.conversationFocusRemaining > 0, `smalltalk should keep Mr. Feast focused on the player while he is paused; got ${JSON.stringify(state.mrFeast)}`);
    assert(state.mrFeast.conversationFocusRemaining >= state.speech.secondsRemaining - 0.25, `Mr. Feast should stay paused for the whole spoken line; got ${JSON.stringify({ focus: state.mrFeast.conversationFocusRemaining, speech: state.speech.secondsRemaining })}`);
    const firstTalkAttentionYaw = state.mrFeast.face.attention.visualYawDegrees;
    const firstTalkBodyYaw = state.mrFeast.yaw;
    const conversationAdvance = await desktop.evaluate(() => {
      window.MrFeastFresh.placePlayerNearMrFeastForQA(1.6, -0.38);
      return window.MrFeastFresh.advanceMrFeastConversationForQA(0.8);
    });
    state = await diagnostics(desktop);
    assert(conversationAdvance.maximumRootDrift <= 0.005 && !conversationAdvance.moving && conversationAdvance.currentAnimation === "idle", `Mr. Feast should stop walking while the conversation line is active; got ${JSON.stringify(conversationAdvance)}`);
    assert(conversationAdvance.focusAfter < conversationAdvance.focusBefore && conversationAdvance.pauseAfter < conversationAdvance.pauseBefore, `the deterministic conversation step should advance both pause timers; got ${JSON.stringify(conversationAdvance)}`);
    assert(state.mrFeast.pauseRemaining > 0 && state.mrFeast.conversationFocusRemaining > 0, `moving nearby during smalltalk must not resume his patrol; got ${JSON.stringify(state.mrFeast)}`);
    assert(state.mrFeast.face.attention.active && state.mrFeast.face.attention.visualFacingDot >= 0.96, `Mr. Feast should keep his face aimed at the player's updated position during smalltalk; got ${JSON.stringify(state.mrFeast.face.attention)}`);
    assert(Math.abs(state.mrFeast.face.attention.visualYawDegrees - firstTalkAttentionYaw) >= 5, `Mr. Feast's head should visibly follow the player across his nearby field of vision; got ${JSON.stringify(state.mrFeast.face.attention)}`);
    assert(Math.abs(state.mrFeast.yaw - firstTalkBodyYaw) <= 0.001, `a nearby conversation target inside the head limit should not rotate Mr. Feast's whole body; got ${JSON.stringify({ before: firstTalkBodyYaw, after: state.mrFeast.yaw })}`);
    const firstLine = state.speech.text;
    const secondLine = await desktop.evaluate(() => window.MrFeastFresh.converseWithMrFeastForQA().text);
    assert(secondLine && secondLine !== firstLine, `back-to-back smalltalk should avoid repeating the same line; got ${JSON.stringify(secondLine)}`);

    const behindConversation = await desktop.evaluate(() => {
      window.MrFeastFresh.placePlayerNearMrFeastForQA(1.6, Math.PI);
      const advanced = window.MrFeastFresh.advanceMrFeastConversationForQA(0.9);
      return { advanced, state: JSON.parse(window.render_game_to_text()) };
    });
    const behindAttention = behindConversation.state.mrFeast.face.attention;
    assert(Math.abs(wrappedAngleDelta(behindConversation.advanced.bodyYawAfter, behindConversation.advanced.bodyYawBefore)) >= 2, `Mr. Feast should turn his torso when a conversation partner moves behind his safe head arc; got ${JSON.stringify(behindConversation.advanced)}`);
    assert(behindConversation.advanced.maximumBodyYawStep <= 0.07, `Mr. Feast should turn toward a rear conversation partner smoothly instead of snapping around; got ${JSON.stringify(behindConversation.advanced)}`);
    assert(behindAttention.active && behindAttention.visualFacingDot >= 0.96, `after turning his torso, Mr. Feast should reacquire and face the nearby player; got ${JSON.stringify(behindAttention)}`);
    assert(Math.abs(behindAttention.visualYawDegrees) <= behindAttention.limits.maxYawDegrees + 0.5, `Mr. Feast's visible head must stay inside its anatomical yaw limit during torso follow; got ${JSON.stringify(behindAttention)}`);

    const alarmDuringTalk = await desktop.evaluate(() => {
      const cameraId = window.MrFeastFresh.getCameraSecurityState().cameras.details[0].id;
      window.MrFeastFresh.triggerCameraAlarmForQA(cameraId, "qa-conversation-preemption");
      const advanced = window.MrFeastFresh.advanceMrFeastConversationForQA(0.5);
      return { advanced, state: JSON.parse(window.render_game_to_text()) };
    });
    assert(alarmDuringTalk.state.mrFeast.conversationFocusRemaining === 0, `a security alarm must preempt conversation focus instead of freezing Mr. Feast; got ${JSON.stringify(alarmDuringTalk)}`);
    assert(alarmDuringTalk.state.mrFeast.security.activeAlarm, `the camera alarm should own Mr. Feast immediately after preempting a conversation; got ${JSON.stringify(alarmDuringTalk.state.mrFeast.security)}`);
    const conversationAlarmRun = await desktop.evaluate(() => window.MrFeastFresh.runMrFeastCameraResponseForQA(420));
    assert(conversationAlarmRun.completed === true, `Mr. Feast should finish the security response that preempted his conversation; got ${JSON.stringify(conversationAlarmRun)}`);

    const trespassDuringTalk = await desktop.evaluate(() => {
      window.MrFeastFresh.resetMrFeastWandererForQA();
      window.MrFeastFresh.placePlayerNearMrFeastForQA(1.6);
      window.MrFeastFresh.converseWithMrFeastForQA();
      window.MrFeastFresh.teleport("archive");
      window.MrFeastFresh.setMrFeastRouteSegmentForQA("basement-archive-inner", 0.35);
      window.MrFeastFresh.resumeMrFeastForQA();
      window.MrFeastFresh.advanceMrFeastConversationForQA(0.9);
      return JSON.parse(window.render_game_to_text());
    });
    assert(trespassDuringTalk.mrFeast.conversationFocusRemaining === 0, `a witnessed basement trespass must cancel conversational focus; got ${JSON.stringify(trespassDuringTalk.mrFeast)}`);
    assert(trespassDuringTalk.mrFeast.pursuit.active?.kind === "trespass", `trespass detection should still start pursuit during an active conversation; got ${JSON.stringify(trespassDuringTalk.mrFeast.pursuit)}`);
    await desktop.evaluate(() => window.MrFeastFresh.resetMrFeastWandererForQA());

    // Busy pool while he is on an errand.
    await desktop.evaluate((id) => window.MrFeastFresh.tamperForQA(id, true), chairEntry.id);
    await desktop.evaluate(() => window.MrFeastFresh.advanceTamperForQA(30));
    const busyLine = await desktop.evaluate(() => window.MrFeastFresh.converseWithMrFeastForQA());
    assert(busyLine.category === "busy", `talking mid-errand should use the busy pool; got ${JSON.stringify(busyLine)}`);
    await desktop.evaluate(() => window.MrFeastFresh.runMrFeastHousekeepingForQA(420));

    // --- Bubble anchoring, clamping, and legibility ---------------------------
    await desktop.evaluate(() => window.MrFeastFresh.placePlayerNearMrFeastForQA(3.5));
    await desktop.evaluate(() => window.MrFeastFresh.converseWithMrFeastForQA());
    await desktop.waitForTimeout(120);
    let bubble = await desktop.evaluate(() => {
      const element = document.getElementById("mansion-speech");
      const rect = element.getBoundingClientRect();
      return {
        hidden: element.hidden,
        fontPx: Number.parseFloat(getComputedStyle(element).fontSize),
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width },
        state: JSON.parse(window.render_game_to_text()).speech,
      };
    });
    assert(!bubble.hidden && bubble.state.visible, `the bubble should render while a line is active; got ${JSON.stringify(bubble.state)}`);
    assert(bubble.fontPx >= 14, `the desktop bubble text should stay readable from a distance; got ${bubble.fontPx}px`);
    assert(bubble.rect.left >= 0 && bubble.rect.right <= 1280 && bubble.rect.top >= 0, `the bubble should stay inside the viewport; got ${JSON.stringify(bubble.rect)}`);
    assert(bubble.state.x > 40 && bubble.state.x < 1240, `a visible on-screen host should anchor the bubble away from the side edges; got ${JSON.stringify(bubble.state)}`);

    // Turn the player away: the bubble must clamp to the viewport edge instead of vanishing.
    await desktop.evaluate(() => window.MrFeastFresh.faceAwayFromMrFeastForQA());
    await desktop.evaluate(() => window.MrFeastFresh.converseWithMrFeastForQA());
    await desktop.waitForTimeout(120);
    bubble = await desktop.evaluate(() => {
      const element = document.getElementById("mansion-speech");
      const rect = element.getBoundingClientRect();
      return { hidden: element.hidden, rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, state: JSON.parse(window.render_game_to_text()).speech };
    });
    assert(!bubble.hidden && bubble.state.visible, "the bubble should stay visible while the host is behind the player");
    assert(bubble.state.clamped === true, `an off-screen host should clamp the bubble to the viewport edge; got ${JSON.stringify(bubble.state)}`);
    assert(bubble.rect.left >= 0 && bubble.rect.right <= 1280 && bubble.rect.top >= 0 && bubble.rect.bottom <= 820, `the clamped bubble should remain fully on screen; got ${JSON.stringify(bubble.rect)}`);

    // Desktop proof with a visible bubble.
    await desktop.evaluate(() => window.MrFeastFresh.placePlayerNearMrFeastForQA(2.6));
    await desktop.evaluate(() => window.MrFeastFresh.converseWithMrFeastForQA());
    await desktop.waitForTimeout(150);
    await desktop.screenshot({ path: path.join(artifactDir, "speech-bubble-desktop.png") });

    assert(desktopErrors.length === 0, `desktop console errors: ${desktopErrors.join(" | ")}`);
    await desktop.close();

    // --- Mobile layout ---------------------------------------------------------
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const mobileErrors = [];
    watchErrors(mobile, mobileErrors);
    await mobile.goto(`${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`, { waitUntil: "domcontentloaded" });
    await mobile.waitForFunction(() => window.MrFeastFresh?.state?.ready, null, { timeout: 120000 });
    await mobile.waitForFunction(() => window.MrFeastFresh.getMrFeastState()?.loadStatus === "ready", null, { timeout: 120000 });
    await mobile.evaluate(() => window.MrFeastFresh.placePlayerNearMrFeastForQA(2.2));
    await mobile.evaluate(() => window.MrFeastFresh.converseWithMrFeastForQA());
    await mobile.waitForTimeout(150);
    const mobileBubble = await mobile.evaluate(() => {
      const element = document.getElementById("mansion-speech");
      const rect = element.getBoundingClientRect();
      return {
        hidden: element.hidden,
        fontPx: Number.parseFloat(getComputedStyle(element).fontSize),
        rect: { left: rect.left, right: rect.right },
        state: JSON.parse(window.render_game_to_text()).speech,
      };
    });
    assert(!mobileBubble.hidden && mobileBubble.state.visible, "the mobile bubble should render");
    assert(mobileBubble.fontPx >= 12, `the mobile bubble text should stay readable; got ${mobileBubble.fontPx}px`);
    assert(mobileBubble.rect.left >= 0 && mobileBubble.rect.right <= 390, `the mobile bubble should fit the phone viewport; got ${JSON.stringify(mobileBubble.rect)}`);
    await mobile.screenshot({ path: path.join(artifactDir, "speech-bubble-mobile.png") });
    assert(mobileErrors.length === 0, `mobile console errors: ${mobileErrors.join(" | ")}`);
    await mobile.close();

    console.log("Mr. Feast tamper distraction and host speech checks passed.");
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
