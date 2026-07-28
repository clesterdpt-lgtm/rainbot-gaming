import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimePath = path.join(root, "assets", "js", "mr-feast-mansion.js");
const pagePath = path.join(root, "games", "mr-feast-mansion.html");
const milestonePath = path.join(root, "docs", "milestones", "67-breath-stealth.md");
const port = Number(process.env.MR_FEAST_BREATH_STEALTH_TEST_PORT || (52000 + (process.pid % 9000)));
const baseUrl = `http://127.0.0.1:${port}`;
const gameUrl = `${baseUrl}/games/mr-feast-mansion.html?qa=1&autostart=1&allLights=1`;
const artifactDir = path.join(root, "output", "playwright", "mr-feast-breath-stealth");

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
  await page.waitForFunction(() => Boolean(window.MrFeastFresh?.getBreathStealthState), null, { timeout: 180000 });
  return page;
}

async function breathState(page) {
  return page.evaluate(() => window.MrFeastFresh.getBreathStealthState());
}

async function advanceBreath(page, seconds) {
  return page.evaluate((duration) => window.MrFeastFresh.advanceBreathStealthForQA(duration), seconds);
}

async function assertSourceContract() {
  const [runtime, html, milestone] = await Promise.all([
    readFile(runtimePath, "utf8"),
    readFile(pagePath, "utf8"),
    readFile(milestonePath, "utf8"),
  ]);
  assert(/const BREATH_STEALTH\s*=\s*Object\.freeze/.test(runtime), "missing named BREATH_STEALTH tuning table");
  assert(/class BreathStealthSystem/.test(runtime), "missing focused BreathStealthSystem");
  assert(/breathing:\s*\{[\s\S]*strain:/.test(runtime), "centralized mansion state must own respiratory state");
  assert(/minimumHoldSeconds:\s*5/.test(runtime), "zero-energy hold minimum must be exactly five seconds");
  assert(/maximumHoldSeconds:\s*45/.test(runtime), "full-energy hold maximum must be exactly forty-five seconds");
  assert(/fearTailSeconds:\s*4/.test(runtime), "aggro fear tail must be exactly four seconds");
  assert(/mrFeastHearingMeters:\s*6/.test(runtime), "Mr. Feast hearing maximum must be six metres");
  assert(/saintHearingMeters:\s*7/.test(runtime), "Saint hearing maximum must be seven metres");
  assert(/forcedGaspLockoutSeconds:\s*1/.test(runtime), "empty hold must create a one-second lockout");
  assert(/breathMuffleMultiplier:\s*BREATH_STEALTH\.curtainRangeMultiplier/.test(runtime), "curtain hiding must declare its breath range multiplier");
  assert(/breathMuffleMultiplier:\s*BREATH_STEALTH\.coatClosetRangeMultiplier/.test(runtime), "coat closet must declare its breath range multiplier");
  assert(/hearPlayerBreathing\s*\(/.test(runtime), "Mr. Feast needs a sound-investigation handoff");
  assert(/hearFinaleBreathing\s*\(/.test(runtime), "the Saint needs a finale breath-investigation handoff");
  assert(/playPlayerBreath\s*\(/.test(runtime), "MansionAudio needs a gameplay player-breath cue");
  assert(/stopPlayerBreathing\s*\(/.test(runtime), "holding/cleanup must stop active gameplay breath sources");
  assert(/event\.code === "Space"/.test(runtime), "Space must own the desktop hold-breath input");
  assert(/id="mansion-breath"/.test(html), "missing accessible breath meter");
  assert(/id="touch-breath"/.test(html), "missing contextual touch hold-breath control");
  assert(/<kbd>Space<\/kbd>\s*hold breath/i.test(html), "desktop control guide must explain Space");
  for (const hook of [
    "getBreathStealthState",
    "setBreathStrainForQA",
    "setBreathAggroForQA",
    "holdBreathForQA",
    "advanceBreathStealthForQA",
    "probeBreathHearingForQA",
    "emitPlayerBreathForQA",
    "stageBreathThreatForQA",
  ]) {
    assert(runtime.includes(hook), `missing deterministic breath QA hook: ${hook}`);
  }
  assert(/User playtest/i.test(milestone), "Milestone 67 must retain subjective breathing-balance playtest");
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

    // A rested walking player is the silent baseline.
    await page.evaluate(() => {
      window.MrFeastFresh.setPlayerEnergyForQA(100);
      window.MrFeastFresh.setBreathStrainForQA(0);
      window.MrFeastFresh.setBreathAggroForQA(false);
    });
    await advanceBreath(page, 0.5);
    let breath = await breathState(page);
    assert(
      breath.tier === "silent"
        && !breath.audible
        && !breath.holding
        && breath.holdCapacitySeconds === 45,
      `full-energy calm baseline must be silent with a 45s capacity: ${JSON.stringify(breath)}`,
    );
    assert(await page.locator("#mansion-breath").isHidden(), "calm full-energy walking should not clutter the HUD");
    await page.keyboard.down("Space");
    breath = await breathState(page);
    assert(
      breath.holding && breath.holdCapacitySeconds === 45,
      `holding Space must start the authoritative full-energy breath hold: ${JSON.stringify(breath)}`,
    );
    await page.keyboard.up("Space");
    assert(!(await breathState(page)).holding, "releasing Space must release held breath");

    // Actual sprint input raises strain and drains the existing reserve.
    await page.keyboard.down("w");
    await page.keyboard.down("Shift");
    await advanceBreath(page, 1.65);
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");
    await advanceBreath(page, 0.35);
    breath = await breathState(page);
    const playerAfterSprint = await page.evaluate(() => JSON.parse(window.render_game_to_text()).player);
    assert(
      playerAfterSprint.movement.energy < 65
        && breath.strain >= 40
        && ["heavy", "panicked"].includes(breath.tier)
        && breath.emittedBreaths > 0,
      `sprinting must create audible respiratory strain: ${JSON.stringify({ breath, movement: playerAfterSprint.movement })}`,
    );
    await page.evaluate(() => {
      window.MrFeastFresh.setPlayerEnergyForQA(100);
      window.MrFeastFresh.setBreathStrainForQA(45);
    });
    await advanceBreath(page, 0.05);
    breath = await breathState(page);
    assert(
      breath.strain === 0 && breath.tier === "silent" && !breath.audible,
      `full-energy calm recovery must clear residual breathing: ${JSON.stringify(breath)}`,
    );

    // Exact hold endpoints, energy freeze, empty-hold gasp, and lockout.
    await page.evaluate(() => {
      window.MrFeastFresh.setPlayerEnergyForQA(0);
      window.MrFeastFresh.setBreathStrainForQA(85);
      window.MrFeastFresh.holdBreathForQA(true);
    });
    breath = await breathState(page);
    assert(breath.holding && breath.holdCapacitySeconds === 5, `zero energy must still allow exactly 5s: ${JSON.stringify(breath)}`);
    const energyBeforeHold = await page.evaluate(() => JSON.parse(window.render_game_to_text()).player.movement.energy);
    await advanceBreath(page, 4.8);
    breath = await breathState(page);
    const energyWhileHolding = await page.evaluate(() => JSON.parse(window.render_game_to_text()).player.movement.energy);
    assert(
      breath.holding
        && breath.holdRemainingSeconds > 0
        && energyWhileHolding === energyBeforeHold,
      `the 5s minimum should survive 4.8s without energy recovery: ${JSON.stringify({ breath, energyBeforeHold, energyWhileHolding })}`,
    );
    await advanceBreath(page, 0.3);
    breath = await breathState(page);
    const energyAfterHold = await page.evaluate(() => JSON.parse(window.render_game_to_text()).player.movement.energy);
    assert(
      !breath.holding
        && breath.forcedGasps >= 1
        && breath.holdLockoutSeconds > 0
        && breath.holdLockoutSeconds <= 1
        && energyAfterHold > energyBeforeHold,
      `empty hold must gasp and lock for 1s before normal recovery resumes: ${JSON.stringify({ breath, energyBeforeHold, energyAfterHold })}`,
    );
    await advanceBreath(page, 1.1);
    await page.evaluate(() => {
      window.MrFeastFresh.setPlayerEnergyForQA(100);
      window.MrFeastFresh.holdBreathForQA(true);
    });
    breath = await breathState(page);
    assert(breath.holding && breath.holdCapacitySeconds === 45, `full energy must allow exactly 45s: ${JSON.stringify(breath)}`);

    // Sprinting cancels the hold immediately with a gasp.
    const gaspsBeforeSprintCancel = breath.forcedGasps;
    await page.keyboard.down("w");
    await page.keyboard.down("Shift");
    await advanceBreath(page, 0.12);
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");
    breath = await breathState(page);
    assert(
      !breath.holding && breath.forcedGasps === gaspsBeforeSprintCancel + 1 && breath.lastGaspReason === "sprint-cancel",
      `sprinting must cancel a held breath with one gasp: ${JSON.stringify(breath)}`,
    );

    // Threat-driven idle breathing and the exact four-second tail.
    await page.evaluate(() => {
      window.MrFeastFresh.setPlayerEnergyForQA(100);
      window.MrFeastFresh.setBreathStrainForQA(0);
      window.MrFeastFresh.setBreathAggroForQA(true);
    });
    await advanceBreath(page, 0.2);
    breath = await breathState(page);
    assert(breath.aggro && breath.tier === "light" && breath.audible, `aggro must create light scared breathing at rest: ${JSON.stringify(breath)}`);
    await page.evaluate(() => window.MrFeastFresh.setBreathAggroForQA(false));
    await advanceBreath(page, 3.9);
    breath = await breathState(page);
    assert(breath.fearTailSeconds > 0 && breath.tier === "light", `fear must persist for four seconds: ${JSON.stringify(breath)}`);
    await advanceBreath(page, 0.2);
    breath = await breathState(page);
    assert(breath.fearTailSeconds === 0 && breath.tier === "silent", `fear tail must end after four seconds: ${JSON.stringify(breath)}`);
    const cameraOnly = await page.evaluate(() => {
      window.MrFeastFresh.setBreathAggroForQA(null);
      return window.MrFeastFresh.probeBreathAggroForQA({ cameraObserved: true });
    });
    assert(!cameraOnly.aggro, `mere camera observation must not create scared breathing: ${JSON.stringify(cameraOnly)}`);

    // Exact listener maxima plus room, occlusion, and hiding attenuation.
    const probes = await page.evaluate(() => ({
      feastInside: window.MrFeastFresh.probeBreathHearingForQA({ target: "mr-feast", distance: 5.9, tier: "heavy" }),
      feastOutside: window.MrFeastFresh.probeBreathHearingForQA({ target: "mr-feast", distance: 6.1, tier: "heavy" }),
      saintInside: window.MrFeastFresh.probeBreathHearingForQA({ target: "saint", distance: 6.9, tier: "heavy" }),
      saintOutside: window.MrFeastFresh.probeBreathHearingForQA({ target: "saint", distance: 7.1, tier: "heavy" }),
      otherRoom: window.MrFeastFresh.probeBreathHearingForQA({ target: "mr-feast", distance: 2, tier: "heavy", sameRoom: false }),
      occluded: window.MrFeastFresh.probeBreathHearingForQA({ target: "mr-feast", distance: 2, tier: "heavy", occluded: true }),
      curtain: window.MrFeastFresh.probeBreathHearingForQA({ target: "mr-feast", distance: 5.7, tier: "heavy", hidingKind: "curtain" }),
      coatNear: window.MrFeastFresh.probeBreathHearingForQA({ target: "mr-feast", distance: 3.8, tier: "heavy", hidingKind: "coat-closet" }),
      coatFar: window.MrFeastFresh.probeBreathHearingForQA({ target: "mr-feast", distance: 4.1, tier: "heavy", hidingKind: "coat-closet" }),
    }));
    assert(probes.feastInside.heard && !probes.feastOutside.heard, `Mr. Feast maximum must be 6m: ${JSON.stringify(probes)}`);
    assert(probes.saintInside.heard && !probes.saintOutside.heard, `Saint maximum must be 7m: ${JSON.stringify(probes)}`);
    assert(!probes.otherRoom.heard && probes.otherRoom.reason === "different-room", `other rooms must block breath: ${JSON.stringify(probes.otherRoom)}`);
    assert(!probes.occluded.heard && probes.occluded.reason === "occluded", `walls/closed doors must block breath: ${JSON.stringify(probes.occluded)}`);
    assert(probes.curtain.heard, `curtains should provide almost no acoustic protection: ${JSON.stringify(probes.curtain)}`);
    assert(probes.coatNear.heard && !probes.coatFar.heard, `coat closet should reduce 6m by 35%: ${JSON.stringify(probes)}`);

    // A real first event redirects Mr. Feast; continued close noise exposes a
    // hidden player and resolves through his existing catch path.
    await page.waitForFunction(
      () => window.MrFeastFresh.getMrFeastState?.()?.loadStatus === "ready",
      null,
      { timeout: 180000 },
    );
    const staged = await page.evaluate(() => window.MrFeastFresh.stageBreathThreatForQA({
      target: "mr-feast",
      distance: 4.4,
      hiddenKind: "curtain",
    }));
    assert(staged?.hidden, `breath investigation probe needs an actual curtain hide: ${JSON.stringify(staged)}`);
    const firstHear = await page.evaluate(() => window.MrFeastFresh.emitPlayerBreathForQA("heavy"));
    let host = await page.evaluate(() => window.MrFeastFresh.getMrFeastState());
    assert(
      firstHear.listeners.some((entry) => entry.target === "mr-feast" && entry.heard)
        && host.security?.state === "responding"
        && host.security?.activeAlarm?.kind === "breathing",
      `first breath must start a bounded sound investigation: ${JSON.stringify({ firstHear, host })}`,
    );
    await page.evaluate(() => window.MrFeastFresh.stageBreathThreatForQA({
      target: "mr-feast",
      distance: 1,
      preserveInvestigation: true,
    }));
    const secondHear = await page.evaluate(() => window.MrFeastFresh.emitPlayerBreathForQA("gasp"));
    host = await page.evaluate(() => window.MrFeastFresh.getMrFeastState());
    const hiddenAfterGasp = await page.evaluate(() => window.MrFeastFresh.isPlayerHidden());
    assert(
      secondHear.listeners.some((entry) => entry.target === "mr-feast" && entry.heard)
        && !hiddenAfterGasp
        && host.pursuit?.catches >= 1,
      `continued close gasp must expose and catch through the existing host path: ${JSON.stringify({ secondHear, host })}`,
    );
    assert(!hiddenAfterGasp, "close continued breathing must remove authoritative hiding");
    await page.evaluate(() => window.MrFeastFresh.clearGameOverForQA());

    // Respiratory strain persists, while holding and emitted events normalize.
    await page.evaluate(() => {
      window.MrFeastFresh.setBreathStrainForQA(57);
      window.MrFeastFresh.holdBreathForQA(true);
      window.MrFeastFresh.saveGameForQA();
      window.MrFeastFresh.setBreathStrainForQA(0);
      window.MrFeastFresh.loadGameForQA();
    });
    breath = await breathState(page);
    assert(
      Math.abs(breath.strain - 57) <= 0.1
        && !breath.holding
        && breath.holdLockoutSeconds === 0
        && breath.lastListeners.length === 0,
      `save/load must retain strain but clear transient breath state: ${JSON.stringify(breath)}`,
    );
    await page.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "breath-stealth-desktop.png"),
    });

    // Touch has one contextual 44px hold control and a readable meter.
    const mobile = await bootPage(browser, { width: 390, height: 844 }, errors, {
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await mobile.evaluate(() => {
      window.MrFeastFresh.setPlayerEnergyForQA(50);
      window.MrFeastFresh.setBreathStrainForQA(72);
      window.MrFeastFresh.advanceBreathStealthForQA(0.2);
    });
    assert(await mobile.locator("#mansion-breath").isVisible(), "winded mobile play must show the breath meter");
    assert(await mobile.locator("#touch-breath").isVisible(), "winded mobile play must show contextual Hold Breath");
    const touchBounds = await mobile.locator("#touch-breath").boundingBox();
    const stageBounds = await mobile.locator("#mansion-stage").boundingBox();
    assert(
      touchBounds
        && stageBounds
        && touchBounds.width >= 44
        && touchBounds.height >= 44
        && touchBounds.x >= stageBounds.x
        && touchBounds.y >= stageBounds.y
        && touchBounds.x + touchBounds.width <= stageBounds.x + stageBounds.width + 0.5
        && touchBounds.y + touchBounds.height <= stageBounds.y + stageBounds.height + 0.5,
      `touch Hold Breath must stay at least 44px and inside the phone stage: ${JSON.stringify({ touchBounds, stageBounds })}`,
    );
    await mobile.locator("#touch-breath").dispatchEvent("pointerdown", { pointerId: 17, pointerType: "touch", isPrimary: true });
    breath = await breathState(mobile);
    assert(breath.holding, `touch pointerdown must share authoritative hold state: ${JSON.stringify(breath)}`);
    assert((await mobile.locator("#touch-breath").getAttribute("aria-pressed")) === "true", "touch Hold Breath must expose pressed state");
    assert(await mobile.locator("#touch-breath").evaluate((button) => button.classList.contains("is-held")), "touch Hold Breath must visibly mirror the held state");
    await mobile.locator("#mansion-stage").screenshot({
      path: path.join(artifactDir, "breath-hold-mobile.png"),
    });
    await mobile.locator("#touch-breath").dispatchEvent("pointerup", { pointerId: 17, pointerType: "touch", isPrimary: true });
    assert(!(await breathState(mobile)).holding, "touch release must release held breath");
    assert(!(await mobile.locator("#touch-breath").evaluate((button) => button.classList.contains("is-held"))), "touch release must clear the visible held state");
    const overflow = await mobile.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      stageWidth: document.getElementById("mansion-stage")?.getBoundingClientRect().width || 0,
    }));
    assert(overflow.documentWidth <= overflow.viewportWidth + 1, `phone breath HUD must not overflow: ${JSON.stringify(overflow)}`);
    assert(errors.length === 0, `unexpected browser errors: ${errors.join("\n")}`);
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

await assertSourceContract();
await runBrowserFlow();
console.log("Mr. Feast breath stealth regression passed.");
