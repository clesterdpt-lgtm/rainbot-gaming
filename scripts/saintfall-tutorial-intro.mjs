#!/usr/bin/env node
/* Focused end-to-end proof for Saintfall's new-operation controls tutorial.

   The suite uses production input listeners for movement, mouse look,
   mobility, combat, command-wheel, and Skip Tutorial. QA hooks are limited
   to deterministic setup/observation and do not complete tutorial steps.
*/

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 52800 + (process.pid % 700);
const base = `http://127.0.0.1:${port}`;
const out = path.resolve(root, "output/saintfall/tutorial-intro");
const results = [];
const diagnostics = { consoleErrors: [], pageErrors: [], networkErrors: [] };

function check(name, pass, actual, expected) {
  const entry = { name, pass: !!pass, actual, expected };
  results.push(entry);
  console.log(`${entry.pass ? "PASS" : "FAIL"} ${name}`);
  if (!entry.pass) console.log(`     actual: ${JSON.stringify(actual)}\n   expected: ${JSON.stringify(expected)}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      if ((await fetch(`${base}/games/saintfall.html`, { cache: "no-store" })).ok) return true;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local Saintfall server did not start");
}

function attachDiagnostics(page, label) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location?.() || {};
    if (/jsdelivr|unpkg|gstatic|googleapis|fonts\.google|favicon/i.test(location.url || "")) return;
    const source = location.url
      ? ` @ ${location.url}:${Number(location.lineNumber || 0) + 1}` : "";
    diagnostics.consoleErrors.push(`${label}: ${message.text()}${source}`);
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(`${label}: ${error.message}`));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === base && response.status() >= 400) {
      diagnostics.networkErrors.push(`${label}: ${response.status()} ${url.pathname}`);
    }
  });
}

async function gotoReady(page, query) {
  await page.goto(`${base}/games/saintfall.html?${query}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
}

async function tutorialLayout(page) {
  return page.evaluate(() => {
    const stage = document.querySelector(".sf-stage").getBoundingClientRect();
    const tutorial = document.querySelector(".sf-tutorial").getBoundingClientRect();
    const skip = document.querySelector("[data-tutorial-skip]").getBoundingClientRect();
    const touchControls = [...document.querySelectorAll("#sf-touch [data-touch-stick], #sf-touch [data-touch-actions]")]
      .map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 1 && rect.height > 1);
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return {
      stage: { left: stage.left, top: stage.top, right: stage.right, bottom: stage.bottom },
      tutorial: { left: tutorial.left, top: tutorial.top, right: tutorial.right, bottom: tutorial.bottom },
      skip: { width: skip.width, height: skip.height },
      touchOverlap: touchControls.reduce((sum, rect) => sum + overlap(tutorial, rect), 0),
      pageOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    };
  });
}

async function driveOrientation(page) {
  const canvas = page.locator("#sf-canvas");
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: Math.max(2, box.width * .5), y: Math.max(2, box.height * .55) } });
  try {
    await page.waitForFunction(() => document.pointerLockElement?.id === "sf-canvas", null,
      { timeout: 2500 });
  } catch (_) {
    /* Headless Chromium may reject the platform lock. Keep the production
       mousemove listener and real mouse events, but establish its documented
       QA ownership boundary exactly as the shared UI regression does. */
    await page.evaluate(() => {
      const canvasNode = document.getElementById("sf-canvas");
      window.__SF.player.input.state.locked = true;
      try {
        Object.defineProperty(document, "pointerLockElement", {
          configurable: true, get: () => canvasNode,
        });
      } catch (_) { /* input.state.locked remains the ownership boundary */ }
    });
  }
  await page.keyboard.down("KeyW");
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.move(box.x + box.width * .66, box.y + box.height * .43, { steps: 5 });
  await delay(650);
  await page.keyboard.up("KeyW");
  await page.waitForFunction(() => window.__SF.tutorialState()?.step === "mobility", null,
    { timeout: 10000 });
}

async function driveMobility(page) {
  await page.keyboard.press("Shift");
  await page.keyboard.press("Space");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Space");
  await page.keyboard.up("Shift");
  await page.waitForFunction(() => window.__SF.tutorialState()?.step === "combat", null,
    { timeout: 10000 });
}

async function driveTouchOrientation(page) {
  const stick = page.locator("[data-touch-stick]");
  const stickBox = await stick.boundingBox();
  const stickX = stickBox.x + stickBox.width * 0.5;
  const stickY = stickBox.y + stickBox.height * 0.5;
  const stickEvent = { pointerId: 31, pointerType: "touch", isPrimary: true,
    clientX: stickX, clientY: stickY - stickBox.height * 0.34, bubbles: true };
  await stick.dispatchEvent("pointerdown", stickEvent);
  await page.waitForFunction(() => window.__SF.touchState()?.move?.active, null,
    { timeout: 5000 });
  await page.waitForFunction(() => window.__SF.tutorialState()?.observed?.move, null,
    { timeout: 10000 });
  await stick.dispatchEvent("pointerup", stickEvent);

  const look = page.locator("[data-touch-look]");
  const lookBox = await look.boundingBox();
  const lookStart = { pointerId: 32, pointerType: "touch", isPrimary: true,
    clientX: lookBox.x + lookBox.width * 0.5,
    clientY: lookBox.y + lookBox.height * 0.45, bubbles: true };
  await look.dispatchEvent("pointerdown", lookStart);
  await look.dispatchEvent("pointermove", { ...lookStart,
    clientX: lookStart.clientX + Math.min(86, lookBox.width * 0.28),
    clientY: lookStart.clientY - 24 });
  await page.waitForFunction(() => window.__SF.tutorialState()?.observed?.look, null,
    { timeout: 5000 });
  await look.dispatchEvent("pointerup", { ...lookStart,
    clientX: lookStart.clientX + Math.min(86, lookBox.width * 0.28),
    clientY: lookStart.clientY - 24 });
  await page.waitForFunction(() => window.__SF.tutorialState()?.step === "mobility", null,
    { timeout: 10000 });
}

async function driveTouchMobility(page) {
  await page.locator('[data-touch-action="boost"]').tap();
  await page.locator('[data-touch-action="vault"]').tap();
  await page.locator('[data-touch-action="jet"]').tap();
  await page.waitForFunction(() => window.__SF.tutorialState()?.step === "combat", null,
    { timeout: 10000 });
}

async function driveDefense(page, characterId, screenshotName) {
  await page.evaluate(() => {
    const player = window.__SF.playerState();
    window.__SF.teleport(player.x + 18, player.z + 18, 0);
  });
  const before = await page.evaluate(() => ({
    player: { x: window.__SF.playerState().x, z: window.__SF.playerState().z },
    blinkCasts: window.__SF.kenosis?.status?.()?.blink?.casts || 0,
  }));
  await page.keyboard.down("e");
  await page.waitForFunction(() => window.__SF.tutorialState()?.defenseAnimationSeen, null,
    { timeout: 10000 });
  if (characterId !== "white-vigil") {
    await page.waitForFunction((id) => {
      const shield = window.__SF.shieldState();
      return shield?.active && (id === "bastion-penitent"
        ? shield.guardBlend >= 0.12 : shield.pose >= 0.12);
    }, characterId, { timeout: 10000 });
  }
  await delay(120);
  const evidence = await page.evaluate(({ id, beforeState }) => {
    const tutorial = window.__SF.tutorialState();
    const shield = window.__SF.shieldState();
    const blink = window.__SF.kenosis?.status?.()?.blink || null;
    const player = window.__SF.playerState();
    return {
      id,
      tutorial,
      shield,
      blink,
      moved: Number(Math.hypot(player.x - beforeState.player.x,
        player.z - beforeState.player.z).toFixed(2)),
      castsAdded: (blink?.casts || 0) - beforeState.blinkCasts,
    };
  }, { id: characterId, beforeState: before });
  await page.screenshot({ path: path.join(out, screenshotName) });
  await page.keyboard.up("e");
  await delay(180);
  return evidence;
}

async function driveCombatActions(page, characterId) {
  await page.mouse.down({ button: "left" });
  await delay(80);
  await page.mouse.up({ button: "left" });
  await page.mouse.down({ button: "right" });
  await delay(80);
  await page.mouse.up({ button: "right" });
  await page.keyboard.press("f");
  if (characterId === "vesper-reliquary") await page.keyboard.press("r");
  await page.waitForFunction(() => window.__SF.tutorialState()?.step === "command", null,
    { timeout: 10000 });
}

async function deploySelectedSaint(page) {
  await page.locator("[data-intro-start]").click();
  await page.waitForFunction(() => window.__SF.introState()?.entryPanel === "characters", null,
    { timeout: 10000 });
  await page.locator("[data-intro-character-confirm]").click();
  await page.waitForFunction(() => window.__SF.introState()?.entryPanel === "briefing", null,
    { timeout: 10000 });
  await page.locator("[data-intro-briefing-deploy]").click();
  await page.waitForSelector("[data-intro-skip]:not([disabled])", { timeout: 10000 });
}

async function driveCommand(page) {
  await page.keyboard.down("q");
  await page.waitForFunction(() => document.body.classList.contains("sf-command-open"), null,
    { timeout: 5000 });
  await page.waitForFunction(() => window.__SF.tutorialState()?.observed?.command, null,
    { timeout: 5000 });
  await page.keyboard.up("q");
  await page.waitForFunction(() => !document.body.classList.contains("sf-command-open"), null,
    { timeout: 5000 });
  await page.waitForFunction(() => window.__SF.tutorialState()?.completed, null,
    { timeout: 10000 });
}

const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
});

let browser;
try {
  await waitForServer();
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  attachDiagnostics(page, "desktop");

  await gotoReady(page, "qa=1&intro=skip&touch=0&quality=low&seed=tutorial-default");
  const defaultQa = await page.evaluate(() => ({
    tutorial: window.__SF.tutorialState(),
    hidden: document.getElementById("sf-tutorial").hidden,
  }));
  check("legacy QA remains direct-to-gameplay with tutorial disabled",
    defaultQa.tutorial?.enabled === false && defaultQa.hidden,
    defaultQa, { enabled: false, hidden: true });

  /* The player-facing skip belongs to the entry menu, before character
     selection. Select Veyra after turning it off to prove the preference
     survives the authored body reload and still suppresses orientation. */
  await page.evaluate(() => {
    localStorage.removeItem("saintfall:field-ui:v1");
    localStorage.setItem("sf-saintfall-character", "vesper-reliquary");
  });
  await gotoReady(page, "qa=1&intro=force&introClock=manual&tutorial=menu&touch=0&quality=low&seed=tutorial-menu-skip&character=vesper-reliquary");
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const menuTutorial = page.locator("[data-intro-tutorial-toggle]");
  const menuInitial = await menuTutorial.evaluate((button) => ({
    checked: button.getAttribute("aria-checked"),
    state: button.querySelector("b")?.textContent?.trim(),
    box: button.getBoundingClientRect().toJSON(),
  }));
  check("main menu exposes a usable tutorial switch before New Game",
    menuInitial.checked === "true" && menuInitial.state === "ON"
      && menuInitial.box.height >= 44,
    menuInitial, { checked: "true", state: "ON", minHeight: 44 });
  await menuTutorial.click();
  const menuSkipped = await page.evaluate(() => ({
    checked: document.querySelector("[data-intro-tutorial-toggle]")?.getAttribute("aria-checked"),
    label: document.querySelector("[data-intro-tutorial-state]")?.textContent?.trim(),
    stored: JSON.parse(localStorage.getItem("saintfall:field-ui:v1") || "{}").tutorialEnabled,
    intro: window.__SF.introState(),
  }));
  check("Tutorial Skip is stored before saint selection",
    menuSkipped.checked === "false" && menuSkipped.label === "SKIP"
      && menuSkipped.stored === false && menuSkipped.intro?.tutorialEnabled === false,
    menuSkipped, { checked: "false", label: "SKIP", stored: false });
  await page.screenshot({ path: path.join(out, "main-menu-tutorial-skip.png") });
  await page.locator("[data-intro-start]").click();
  await page.waitForFunction(() => window.__SF.introState()?.entryPanel === "characters", null,
    { timeout: 10000 });
  await page.locator('[data-intro-character="white-vigil"]').click();
  await Promise.all([
    page.waitForURL((url) => url.searchParams.get("character") === "white-vigil", { timeout: 60000 }),
    page.locator("[data-intro-character-confirm]").click(),
  ]);
  await page.waitForFunction(() => window.__SF?.isReady?.()
    && window.__SF.introState()?.entryPanel === "briefing", null, { timeout: 300000 });
  const reloadedSkip = await page.evaluate(() => ({
    intro: window.__SF.introState(),
    character: new URL(location.href).searchParams.get("character"),
    stored: JSON.parse(localStorage.getItem("saintfall:field-ui:v1") || "{}").tutorialEnabled,
  }));
  check("Tutorial Skip survives the Saint Veyra body reload",
    reloadedSkip.character === "white-vigil"
      && reloadedSkip.intro?.tutorialEnabled === false && reloadedSkip.stored === false,
    reloadedSkip, { character: "white-vigil", tutorialEnabled: false, stored: false });
  await page.locator("[data-intro-briefing-deploy]").click();
  await page.waitForSelector("[data-intro-skip]:not([disabled])", { timeout: 10000 });
  await page.locator("[data-intro-skip]").click();
  await page.waitForFunction(() => window.__SF.introState()?.completed, null, { timeout: 10000 });
  const pregameSkip = await page.evaluate(() => ({
    intro: window.__SF.introState(),
    tutorial: window.__SF.tutorialState(),
    hidden: document.getElementById("sf-tutorial").hidden,
  }));
  check("pre-game Tutorial Skip enters gameplay without opening orientation",
    pregameSkip.intro?.completed && pregameSkip.intro?.tutorialEnabled === false
      && pregameSkip.tutorial?.mode === "idle" && !pregameSkip.tutorial?.active
      && pregameSkip.hidden,
    pregameSkip, { introCompleted: true, tutorialEnabled: false, tutorialMode: "idle" });
  /* Keep the Veyra menu/reload fixture out of the Aurel Continue fixture
     below. They prove separate entry contracts and should not create an
     artificial cross-operative career merge in one browser profile. */
  await page.evaluate(() => localStorage.clear());

  /* Field-save QA is deliberately isolated. Create the Continue fixture
     through the normal persistence path so the next navigation exercises
     the same durable envelope a player would actually load. */
  await gotoReady(page, "intro=skip&tutorial=skip&touch=0&quality=low&seed=tutorial-save-fixture&character=vesper-reliquary");
  const saved = await page.evaluate(() => window.__SF.saveAutosave(true));
  check("a valid autosave is available for Continue bypass proof", !!saved,
    !!saved, true);

  await gotoReady(page, "intro=force&tutorial=force&touch=0&quality=low&seed=tutorial-save-fixture&character=vesper-reliquary");
  const persistedFixture = await page.evaluate(() => ({
    raw: JSON.parse(localStorage.getItem("rainbot_game_save:saintfall") || "null"),
    intro: window.__SF.introState(),
  }));
  check("normal entry can read the persisted Continue fixture",
    !!persistedFixture.raw?.data?.autosave && persistedFixture.intro?.hasSave,
    { rawAutosave: !!persistedFixture.raw?.data?.autosave, intro: persistedFixture.intro },
    { rawAutosave: true, hasSave: true });
  await page.waitForSelector("[data-intro-continue]:not([disabled])", { timeout: 10000 });
  await page.locator("[data-intro-continue]").click();
  await page.waitForFunction(() => window.__SF.introState()?.completed, null, { timeout: 10000 });
  const loadBypass = await page.evaluate(() => ({
    intro: window.__SF.introState(),
    tutorial: window.__SF.tutorialState(),
  }));
  check("Continue restores gameplay without starting new-operation orientation",
    loadBypass.intro?.launchMode === "load"
      && !loadBypass.tutorial?.active && loadBypass.tutorial?.mode === "idle",
    loadBypass, { launchMode: "load", tutorialMode: "idle" });

  await gotoReady(page, "qa=1&intro=force&introClock=manual&tutorial=force&touch=0&quality=low&seed=tutorial-new&character=vesper-reliquary");
  await deploySelectedSaint(page);
  await page.locator("[data-intro-skip]").click();
  await page.waitForFunction(() => window.__SF.tutorialState()?.active, null, { timeout: 10000 });
  const descentSkip = await page.evaluate(() => ({
    intro: window.__SF.introState(), tutorial: window.__SF.tutorialState(),
  }));
  check("skipping the descent still begins the controls tutorial for New Game",
    descentSkip.intro?.skipped && descentSkip.tutorial?.step === "orientation"
      && descentSkip.tutorial?.source === "new-operation",
    descentSkip, { introSkipped: true, step: "orientation", source: "new-operation" });
  await page.locator("[data-tutorial-skip]").click();
  await page.waitForFunction(() => window.__SF.tutorialState()?.skipped, null, { timeout: 5000 });

  const profileCases = [
    {
      id: "vesper-reliquary", name: "Saint Aurel", slug: "aurel",
      defense: "guard", defenseCheck: "guard", title: "Censer-lance and Aegis",
      copy: "visible Aegis block pose", control: "HOLD E",
    },
    {
      id: "white-vigil", name: "Saint Veyra", slug: "veyra",
      defense: "blink", defenseCheck: "blink", title: "Crescents and Vigil Step",
      copy: "cannot block", control: "TAP E",
    },
    {
      id: "bastion-penitent", name: "Saint Torren", slug: "torren",
      defense: "guard", defenseCheck: "guard", title: "Hammer and tower guard",
      copy: "tower-shield block pose", control: "HOLD E",
    },
  ];

  for (const [profileIndex, profileCase] of profileCases.entries()) {
    await gotoReady(page, `qa=1&intro=skip&tutorial=force&touch=0&quality=low&seed=tutorial-${profileCase.slug}&character=${profileCase.id}`);
    await page.evaluate(() => { window.__SF.maximize(); window.__SF.invulnerable(true); });
    await page.waitForFunction(() => window.__SF.tutorialState()?.step === "orientation", null,
      { timeout: 5000 });
    const desktopStart = await page.evaluate(() => window.__SF.tutorialState());
    check(`${profileCase.name} starts a named four-step walkthrough`,
      desktopStart.active && desktopStart.stepNumber === 1 && desktopStart.stepCount === 4
        && desktopStart.inputMode === "desktop"
        && desktopStart.characterId === profileCase.id
        && desktopStart.saintName === profileCase.name
        && desktopStart.defense === profileCase.defense,
      desktopStart, { characterId: profileCase.id, saintName: profileCase.name,
        stepNumber: 1, stepCount: 4, defense: profileCase.defense });
    if (profileIndex === 0) {
      const desktopLayout = await tutorialLayout(page);
      check("desktop tutorial and skip action fit the playfield",
        desktopLayout.tutorial.left >= desktopLayout.stage.left - 1
          && desktopLayout.tutorial.top >= desktopLayout.stage.top - 1
          && desktopLayout.tutorial.right <= desktopLayout.stage.right + 1
          && desktopLayout.tutorial.bottom <= desktopLayout.stage.bottom + 1
          && desktopLayout.skip.width >= 44 && desktopLayout.skip.height >= 44
          && desktopLayout.pageOverflow <= 1,
        desktopLayout, "contained tutorial, 44px skip target, no page overflow");
      await page.screenshot({ path: path.join(out, "desktop-aurel-orientation.png") });
    }

    await driveOrientation(page);
    const orientation = await page.evaluate(() => window.__SF.tutorialState());
    check(`${profileCase.name} advances from movement to tailored mobility`,
      orientation.step === "mobility", orientation, { step: "mobility" });
    await driveMobility(page);
    const combatSurface = await page.evaluate(() => ({
      tutorial: window.__SF.tutorialState(),
      title: document.querySelector("[data-tutorial-title]")?.textContent?.trim(),
      copy: document.querySelector("[data-tutorial-copy]")?.textContent?.trim(),
      controls: [...document.querySelectorAll("[data-tutorial-controls] kbd")]
        .map((node) => node.textContent.trim()),
      checks: [...document.querySelectorAll("[data-tutorial-checks] span")]
        .map((node) => node.textContent.trim()),
    }));
    check(`${profileCase.name}'s combat card names the correct kit and defense`,
      combatSurface.tutorial?.step === "combat"
        && combatSurface.title === profileCase.title
        && combatSurface.copy.includes(profileCase.copy)
        && combatSurface.controls.includes(profileCase.control)
        && combatSurface.checks.some((label) => label.includes(
          profileCase.defense === "blink" ? "BLINK" : "GUARD")
          || combatSurface.checks.includes("AEGIS BLOCK")),
      combatSurface, { title: profileCase.title, copy: profileCase.copy,
        control: profileCase.control, defense: profileCase.defense });

    const defenseEvidence = await driveDefense(page, profileCase.id,
      `desktop-${profileCase.slug}-defense.png`);
    const actualDefense = profileCase.defense === "blink"
      ? defenseEvidence.castsAdded >= 1 && defenseEvidence.moved >= 1
      : defenseEvidence.shield?.active
        && (profileCase.id === "bastion-penitent"
          ? defenseEvidence.shield.guardBlend >= 0.12
          : defenseEvidence.shield.pose >= 0.12);
    check(`${profileCase.name}'s defense check waits for the visible runtime action`,
      defenseEvidence.tutorial?.defenseAnimationSeen
        && defenseEvidence.tutorial?.observed?.[profileCase.defenseCheck]
        && actualDefense,
      defenseEvidence, profileCase.defense === "blink"
        ? { blinkCast: true, moved: ">= 1m" }
        : { shieldActive: true, visiblePose: true });

    await driveCombatActions(page, profileCase.id);
    const combat = await page.evaluate(() => window.__SF.tutorialState());
    check(`${profileCase.name}'s real kit inputs advance combat to Field Command`,
      combat.step === "command" && combat.defenseAnimationSeen,
      combat, { step: "command", defenseAnimationSeen: true });

    if (profileIndex === 0) {
      await driveCommand(page);
      const complete = await page.evaluate(() => ({
        tutorial: window.__SF.tutorialState(),
        runtime: window.__SF.report().runtime,
        canvas: window.__SF.captureDataURL().length,
      }));
      check("opening and releasing Q completes Saint Aurel's tutorial without pausing gameplay",
        complete.tutorial.completed && !complete.tutorial.skipped
          && complete.tutorial.mode === "complete" && !complete.runtime.paused,
        complete, { completed: true, skipped: false, mode: "complete", paused: false });
      check("active gameplay canvas remains nonblank after tutorial", complete.canvas > 10000,
        complete.canvas, "> 10000-byte canvas data URL");
      await page.screenshot({ path: path.join(out, "desktop-aurel-complete.png") });
    } else {
      await page.locator("[data-tutorial-skip]").click();
      await page.waitForFunction(() => window.__SF.tutorialState()?.skipped, null,
        { timeout: 5000 });
    }
  }

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const touchPage = await touchContext.newPage();
  attachDiagnostics(touchPage, "touch-portrait");
  await gotoReady(touchPage, "qa=1&intro=skip&tutorial=force&touch=1&quality=low&seed=tutorial-touch&character=white-vigil");
  await touchPage.evaluate(() => { window.__SF.maximize(); window.__SF.invulnerable(true); });
  const touchStart = await touchPage.evaluate(() => ({
    tutorial: window.__SF.tutorialState(),
    copy: document.querySelector("[data-tutorial-copy]")?.textContent,
    controls: [...document.querySelectorAll("[data-tutorial-controls] kbd")].map((node) => node.textContent),
    defenseButton: document.querySelector('[data-touch-action="shield"] span')?.textContent?.trim(),
    defenseMode: document.querySelector('[data-touch-action="shield"] small')?.textContent?.trim(),
  }));
  check("Saint Veyra's touch walkthrough and live defense control say Blink",
    touchStart.tutorial?.inputMode === "touch"
      && touchStart.tutorial?.characterId === "white-vigil"
      && touchStart.copy.includes("left relic")
      && touchStart.controls.includes("SWIPE TO LOOK")
      && touchStart.defenseButton === "BLINK" && touchStart.defenseMode === "tap",
    touchStart, { inputMode: "touch", characterId: "white-vigil", copy: "left relic",
      control: "SWIPE TO LOOK", defenseButton: "BLINK", defenseMode: "tap" });
  const touchLayout = await tutorialLayout(touchPage);
  check("portrait tutorial fits safe play space without covering touch controls",
    touchLayout.tutorial.left >= touchLayout.stage.left - 1
      && touchLayout.tutorial.top >= touchLayout.stage.top - 1
      && touchLayout.tutorial.right <= touchLayout.stage.right + 1
      && touchLayout.tutorial.bottom <= touchLayout.stage.bottom + 1
      && touchLayout.skip.width >= 44 && touchLayout.skip.height >= 44
      && touchLayout.touchOverlap <= 1 && touchLayout.pageOverflow <= 1,
    touchLayout, "contained, 44px skip, zero touch-control overlap, no page overflow");
  await touchPage.screenshot({ path: path.join(out, "touch-portrait-orientation.png") });
  await driveTouchOrientation(touchPage);
  await driveTouchMobility(touchPage);
  const touchCombat = await touchPage.evaluate(() => ({
    tutorial: window.__SF.tutorialState(),
    title: document.querySelector("[data-tutorial-title]")?.textContent?.trim(),
    copy: document.querySelector("[data-tutorial-copy]")?.textContent?.trim(),
    controls: [...document.querySelectorAll("[data-tutorial-controls] kbd")]
      .map((node) => node.textContent.trim()),
  }));
  const touchCombatLayout = await tutorialLayout(touchPage);
  check("Saint Veyra's portrait combat card explicitly teaches Blink instead of block",
    touchCombat.tutorial?.step === "combat"
      && touchCombat.title === "Crescents and Vigil Step"
      && touchCombat.copy.includes("cannot block")
      && touchCombat.controls.includes("TAP BLINK")
      && touchCombatLayout.tutorial.bottom <= touchCombatLayout.stage.bottom + 1
      && touchCombatLayout.touchOverlap <= 1 && touchCombatLayout.pageOverflow <= 1,
    { touchCombat, touchCombatLayout },
    { step: "combat", title: "Crescents and Vigil Step", control: "TAP BLINK",
      touchOverlap: 0, pageOverflow: 0 });
  await touchPage.screenshot({ path: path.join(out, "touch-portrait-veyra-combat.png") });
  await touchPage.locator("[data-tutorial-skip]").tap();
  await touchPage.waitForFunction(() => window.__SF.tutorialState()?.skipped, null, { timeout: 5000 });
  await delay(250);
  const touchSkip = await touchPage.evaluate(() => ({
    tutorial: window.__SF.tutorialState(),
    hidden: document.getElementById("sf-tutorial").hidden,
    touch: window.__SF.touchState(),
  }));
  check("Skip Tutorial works by touch and leaves gameplay controls enabled",
    touchSkip.tutorial.skipped && touchSkip.hidden && touchSkip.touch.enabled,
    touchSkip, { skipped: true, hidden: true, touchEnabled: true });

  check("browser, page, and same-origin network diagnostics remain clean",
    diagnostics.consoleErrors.length === 0 && diagnostics.pageErrors.length === 0
      && diagnostics.networkErrors.length === 0,
    diagnostics, { consoleErrors: [], pageErrors: [], networkErrors: [] });

  await touchContext.close();
  await context.close();
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

const report = {
  generatedAt: new Date().toISOString(),
  url: base,
  checks: results,
  passed: results.filter((entry) => entry.pass).length,
  failed: results.filter((entry) => !entry.pass).length,
  diagnostics,
};
await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`\n${report.passed}/${results.length} checks passed`);
if (report.failed) process.exitCode = 1;
