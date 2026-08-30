#!/usr/bin/env node
/* ============================================================
   INKBLOOD — player action regression

   Deterministic browser coverage for the two manual combat verbs:
   Ink Step (Space/Shift) and Blood Eclipse (Q). The test drives
   real keyboard and touch/pointer input, but freezes the ordinary
   enemy/weapon simulation so cooldown, charge, radius and iframe
   assertions cannot be changed by an unrelated random spawn.

   Usage: node scripts/test-inkblood-actions.mjs [--headed]
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8768;
const headed = process.argv.includes("--headed");
const url = `http://127.0.0.1:${PORT}/games/inkblood.html`;

async function ensureServer() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/`, { method: "HEAD" });
    if (response.ok || response.status === 404) return null;
  } catch { /* start a local server */ }

  const process = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: root,
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    await delay(100);
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/`, { method: "HEAD" });
      if (response.ok || response.status === 404) return process;
    } catch { /* keep waiting */ }
  }
  process.kill("SIGTERM");
  throw new Error("Ink Blood action-test server never came up");
}

const checks = [];
function check(name, pass, detail = "") {
  const result = { name, pass: Boolean(pass), detail };
  checks.push(result);
  console.log(`${result.pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function approx(value, target, tolerance) {
  return Math.abs(value - target) <= tolerance;
}

function captureErrors(page, bucket) {
  page.on("pageerror", (error) => bucket.push(`page: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") bucket.push(`console: ${message.text()}`);
  });
}

async function loadGame(page) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__INK?.ready, null, { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById("ink-boot"), null, { timeout: 10000 });
}

/**
 * Stop the animation loop and remove autonomous combat systems. ActionSystem,
 * Input, damage, FX and UI synchronization remain the production methods.
 */
async function installDeterministicHarness(page) {
  return page.evaluate(() => {
    const game = window.__INK.game;
    cancelAnimationFrame(game.raf);
    game.raf = 0;
    game.newRun();

    game.director.update = () => {};
    game.updateEnemies = () => {};
    game.updateWeapons = () => {};
    game.updateProjectiles = () => {};
    game.updateEnemyShots = () => {};
    game.updatePickups = () => {};

    game.enemies.length = 0;
    game.projectiles.length = 0;
    game.enemyShots.length = 0;
    game.pickups.length = 0;
    game.timers.length = 0;
    game.slowmo = 0;
    game.input.keys.clear();
    game.input.x = 0;
    game.input.y = 0;
    game.input.clearActionPresses();
    game.input.takePressed();
    game.input.consumeAny();
    game.render();
    return game.phase;
  });
}

async function resetScenario(page) {
  return page.evaluate(() => {
    const game = window.__INK.game;
    game.newRun();
    game.enemies.length = 0;
    game.projectiles.length = 0;
    game.enemyShots.length = 0;
    game.pickups.length = 0;
    game.timers.length = 0;
    game.slowmo = 0;
    game.fx.reset();
    game.player.x = 0;
    game.player.y = 0;
    game.input.keys.clear();
    game.input.x = 0;
    game.input.y = 0;
    game.input.touchId = null;
    game.input.touchActive = false;
    game.input.clearActionPresses();
    game.input.takePressed();
    game.input.consumeAny();
    game.render();
    return game.actionState();
  });
}

async function step(page, count = 1, dt = 1 / 60, render = false) {
  return page.evaluate(({ count, dt, render }) => {
    const game = window.__INK.game;
    for (let index = 0; index < count; index++) game.step(dt);
    if (render) game.render();
    const action = game.actionState();
    return {
      x: game.player.x,
      y: game.player.y,
      hp: game.player.hp,
      invuln: game.player.invuln,
      facing: game.player.facing,
      dodgeT: game.player.dodgeT,
      dodgeCd: game.player.dodgeCd,
      dodgeDirX: game.player.dodgeDirX,
      dodgeDirY: game.player.dodgeDirY,
      specialT: game.player.specialT,
      trail: game.player.dodgeTrail.length,
      dashes: game.fx.dashes.length,
      eclipses: game.fx.eclipses.length,
      slashes: game.fx.slashes.length,
      rings: game.fx.rings.length,
      action,
    };
  }, { count, dt, render });
}

const server = await ensureServer();
const browser = await chromium.launch({ headless: !headed });
const browserErrors = [];

try {
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 860 },
    deviceScaleFactor: 1,
  });
  captureErrors(desktop, browserErrors);
  await loadGame(desktop);

  // Start through the real title input path, then freeze randomness.
  await desktop.keyboard.press("Enter");
  await desktop.waitForFunction(() => window.__INK.phase === "playing", null, { timeout: 10000 });
  check("title starts a playable run before action testing", await installDeterministicHarness(desktop) === "playing");

  /* -------------------------------------------------------- */
  /* Ink Step: edge input, displacement, cooldown and visuals */
  /* -------------------------------------------------------- */

  await resetScenario(desktop);
  await desktop.keyboard.down("d");
  await desktop.keyboard.down("Space");
  const dodgeStart = await step(desktop);
  await desktop.keyboard.up("Space");
  await desktop.keyboard.up("d");

  check("Space starts one directional Ink Step edge",
    dodgeStart.dodgeT > 0 && dodgeStart.dodgeCd > 1 && dodgeStart.dodgeDirX > 0.99,
    `t=${dodgeStart.dodgeT.toFixed(3)} cd=${dodgeStart.dodgeCd.toFixed(3)} dir=${dodgeStart.dodgeDirX.toFixed(2)},${dodgeStart.dodgeDirY.toFixed(2)}`);
  check("Ink Step starts invulnerability and authored speed FX",
    dodgeStart.invuln > dodgeStart.dodgeT && dodgeStart.trail >= 1 && dodgeStart.dashes >= 1 && dodgeStart.rings >= 1,
    `iframe=${dodgeStart.invuln.toFixed(3)} echoes=${dodgeStart.trail} cuts=${dodgeStart.dashes}`);

  const cooldownBeforeRejectedPress = dodgeStart.dodgeCd;
  await desktop.keyboard.press("Space");
  const rejectedDuringCooldown = await step(desktop);
  check("a second Space edge cannot reset an active dodge or its cooldown",
    rejectedDuringCooldown.dodgeCd < cooldownBeforeRejectedPress
      && rejectedDuringCooldown.dodgeCd > cooldownBeforeRejectedPress - 0.04,
    `${cooldownBeforeRejectedPress.toFixed(3)} -> ${rejectedDuringCooldown.dodgeCd.toFixed(3)}`);

  const dodgeEnd = await step(desktop, 20);
  check("Ink Step covers its authored distance and then stops",
    dodgeEnd.dodgeT === 0 && dodgeEnd.x >= 160 && dodgeEnd.x <= 172 && Math.abs(dodgeEnd.y) < 1,
    `position=${dodgeEnd.x.toFixed(2)},${dodgeEnd.y.toFixed(2)}`);

  // Holding the key through a full cooldown must not manufacture a second
  // key edge. Starting from x=0 makes an accidental second dash obvious.
  await step(desktop, 70);
  await desktop.evaluate(() => {
    const game = window.__INK.game;
    game.player.x = 0;
    game.player.y = 0;
    game.player.invuln = 0;
  });
  await desktop.keyboard.down("d");
  await desktop.keyboard.down("Space");
  await step(desktop);
  await desktop.keyboard.up("d");
  const heldResult = await step(desktop, 90);
  await desktop.keyboard.up("Space");
  check("holding Space never retriggers after the cooldown expires",
    heldResult.dodgeT === 0 && heldResult.dodgeCd === 0
      && heldResult.x >= 160 && heldResult.x <= 172,
    `position=${heldResult.x.toFixed(2)} cd=${heldResult.dodgeCd.toFixed(3)}`);

  await desktop.keyboard.press("Space");
  const freshEdge = await step(desktop);
  check("releasing and pressing again creates a fresh dodge edge",
    freshEdge.dodgeT > 0 && freshEdge.dodgeCd > 1,
    `t=${freshEdge.dodgeT.toFixed(3)} cd=${freshEdge.dodgeCd.toFixed(3)}`);

  /* -------------------------------------------------------- */
  /* Ink Step: fallback facing and damage immunity            */
  /* -------------------------------------------------------- */

  await resetScenario(desktop);
  await desktop.evaluate(() => { window.__INK.game.player.facing = -1; });
  await desktop.keyboard.press("Space");
  const fallback = await step(desktop);
  const iframeHit = await desktop.evaluate(() => {
    const game = window.__INK.game;
    const before = game.player.hp;
    game.hurtPlayer(25, 0);
    return { before, after: game.player.hp };
  });
  check("a neutral Ink Step falls back to the current facing direction",
    fallback.dodgeDirX === -1 && fallback.x < 0 && fallback.facing === -1,
    `x=${fallback.x.toFixed(2)} dir=${fallback.dodgeDirX}`);
  check("Ink Step iframes reject player damage",
    iframeHit.after === iframeHit.before,
    `hp=${iframeHit.before} -> ${iframeHit.after}`);

  await step(desktop, 22);
  const afterIframe = await desktop.evaluate(() => {
    const game = window.__INK.game;
    const before = game.player.hp;
    game.hurtPlayer(25, 0);
    return { before, after: game.player.hp, invuln: game.player.invuln };
  });
  check("damage resumes after the dodge iframe window",
    afterIframe.after === afterIframe.before - 25 && afterIframe.invuln > 0,
    `hp=${afterIframe.before} -> ${afterIframe.after}`);

  /* -------------------------------------------------------- */
  /* Blood Eclipse: earned charge and input gate              */
  /* -------------------------------------------------------- */

  await resetScenario(desktop);
  const earnedCharge = await desktop.evaluate(() => {
    const game = window.__INK.game;
    const curve = { hp: 1, speed: 1, damage: 1 };
    const normal = game.spawnEnemy("gaki", 100, 8, curve);
    game.damageEnemy(normal, 9999, 0);
    const afterNormal = game.actionState().special.charge;
    const elite = game.spawnEnemy("onryo", 120, 8, curve);
    game.damageEnemy(elite, 9999, 0);
    return {
      afterNormal,
      afterElite: game.actionState().special.charge,
      normalDead: normal.dead,
      eliteDead: elite.dead,
    };
  });
  check("kills build Blood Eclipse charge, with an elite bonus",
    earnedCharge.normalDead && earnedCharge.eliteDead
      && earnedCharge.afterNormal === 1 && earnedCharge.afterElite === 5,
    `normal=${earnedCharge.afterNormal} elite-total=${earnedCharge.afterElite}`);

  await desktop.keyboard.press("q");
  const belowFull = await step(desktop);
  check("Q is inert until the Blood Eclipse seal is full",
    belowFull.specialT === 0 && belowFull.action.special.charge === 5
      && !belowFull.action.special.ready && belowFull.eclipses === 0,
    `charge=${belowFull.action.special.charge}/${belowFull.action.special.maxCharge}`);

  /* -------------------------------------------------------- */
  /* Blood Eclipse: cast, radius, damage and no self-refill   */
  /* -------------------------------------------------------- */

  const targets = await desktop.evaluate(() => {
    const game = window.__INK.game;
    const curve = { hp: 1, speed: 1, damage: 1 };
    game.enemies.length = 0;
    game.pickups.length = 0;
    game.fx.reset();
    game.actions.setCharge(game.actionState().special.maxCharge, { quiet: true });

    const killedInside = game.spawnEnemy("gaki", 100, 8, curve);
    const damagedInside = game.spawnEnemy("gaki", 350, 8, curve);
    const untouchedOutside = game.spawnEnemy("gaki", 390, 8, curve);
    damagedInside.hp = damagedInside.maxHp = 1000;
    untouchedOutside.hp = untouchedOutside.maxHp = 1000;
    window.__inkActionTargets = { killedInside, damagedInside, untouchedOutside };
    return {
      radius: game.actionState().special.radius,
      charge: game.actionState().special.charge,
      max: game.actionState().special.maxCharge,
    };
  });
  check("the earned seal reaches a deterministic full state",
    targets.charge === targets.max && targets.radius > 350 && targets.radius < 390,
    `charge=${targets.charge}/${targets.max} radius=${targets.radius}`);

  await desktop.keyboard.press("q");
  const castStart = await step(desktop, 1, 1 / 60, true);
  const activeButtonAnimation = await desktop.locator("#btn-special").evaluate((button) => ({
    active: button.classList.contains("is-active"),
    animation: getComputedStyle(button).animationName,
  }));
  check("Q consumes the full seal and starts the Eclipse wind-up",
    castStart.specialT > 0 && castStart.action.special.charge === 0
      && castStart.eclipses >= 1,
    `t=${castStart.specialT.toFixed(3)} charge=${castStart.action.special.charge} tableaux=${castStart.eclipses}`);
  check("the active Eclipse exposes its authored control animation",
    activeButtonAnimation.active && activeButtonAnimation.animation !== "none",
    `animation=${activeButtonAnimation.animation}`);

  const impact = await step(desktop, 19);
  const impactTargets = await desktop.evaluate(() => {
    const game = window.__INK.game;
    const { killedInside, damagedInside, untouchedOutside } = window.__inkActionTargets;
    return {
      killedInside: killedInside.dead,
      damagedInside: damagedInside.hp,
      untouchedOutside: untouchedOutside.hp,
      charge: game.actionState().special.charge,
      impactDone: game.actions.specialImpactDone,
      slashes: game.fx.slashes.length,
      rings: game.fx.rings.length,
      motes: game.fx.motes.length,
    };
  });
  check("Blood Eclipse damages targets inside its radius only",
    impactTargets.killedInside && impactTargets.damagedInside < 1000
      && impactTargets.untouchedOutside === 1000,
    `inside=${impactTargets.damagedInside.toFixed(1)} outside=${impactTargets.untouchedOutside.toFixed(1)}`);
  check("kills caused by the same Eclipse cannot refill its seal",
    impactTargets.charge === 0 && impactTargets.impactDone,
    `charge=${impactTargets.charge}`);
  check("the Eclipse impact emits the radial manga animation package",
    impactTargets.slashes >= 10 && impactTargets.rings >= 2 && impactTargets.motes >= 40,
    `slashes=${impactTargets.slashes} rings=${impactTargets.rings} motes=${impactTargets.motes}`);
  check("the special remains an authored animation beat after impact",
    impact.specialT > 0 && impact.eclipses >= 1,
    `t=${impact.specialT.toFixed(3)} tableaux=${impact.eclipses}`);

  /* -------------------------------------------------------- */
  /* Run reset and title-key leakage                          */
  /* -------------------------------------------------------- */

  const resetState = await desktop.evaluate(() => {
    const game = window.__INK.game;
    game.actions.setCharge(game.actionState().special.maxCharge, { quiet: true });
    game.player.dodgeCd = 0.7;
    game.player.dodgeT = 0.1;
    game.player.specialT = 0.4;
    game.input.pressDodge();
    game.input.pressSpecial();
    game.newRun();
    return {
      action: game.actionState(),
      dodgePressed: game.input.dodgePressed,
      specialPressed: game.input.specialPressed,
    };
  });
  check("a new run resets charge, cooldown, active actions and queued intents",
    resetState.action.special.charge === 0
      && resetState.action.dodge.cooldown === 0
      && !resetState.action.dodge.active && !resetState.action.special.active
      && !resetState.dodgePressed && !resetState.specialPressed,
    JSON.stringify(resetState));

  await desktop.evaluate(() => {
    const game = window.__INK.game;
    game.phase = "title";
    game.input.keys.clear();
    game.input.clearActionPresses();
    game.input.consumeAny();
  });
  await desktop.keyboard.press("Space");
  const titleSpace = await step(desktop, 2);
  check("Space starts a title run without leaking into an immediate dodge",
    await desktop.evaluate(() => window.__INK.phase === "playing")
      && titleSpace.dodgeT === 0 && titleSpace.dodgeCd === 0,
    `dodgeT=${titleSpace.dodgeT} cooldown=${titleSpace.dodgeCd}`);

  /* -------------------------------------------------------- */
  /* Coarse-pointer/mobile geometry and simultaneous control  */
  /* -------------------------------------------------------- */

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const mobile = await mobileContext.newPage();
  captureErrors(mobile, browserErrors);
  await loadGame(mobile);
  await installDeterministicHarness(mobile);
  await mobile.locator(".rb-standalone-surface").scrollIntoViewIfNeeded();
  await mobile.evaluate(() => {
    window.__INK.game.resize();
    window.__INK.game.render();
  });

  const mobileGeometry = await mobile.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      const box = element?.getBoundingClientRect();
      return box && {
        left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        width: box.width, height: box.height,
      };
    };
    const surface = rect(".rb-standalone-surface");
    const dodge = rect("#btn-dodge");
    const special = rect("#btn-special");
    const dock = document.getElementById("ink-action-dock");
    const inside = (child, parent) => child && parent
      && child.left >= parent.left - 1 && child.top >= parent.top - 1
      && child.right <= parent.right + 1 && child.bottom <= parent.bottom + 1;
    const overlap = dodge && special
      && !(dodge.right <= special.left || special.right <= dodge.left
        || dodge.bottom <= special.top || special.bottom <= dodge.top);
    return {
      surface, dodge, special,
      visible: dock?.classList.contains("is-visible")
        && getComputedStyle(dock).visibility === "visible",
      inside: inside(dodge, surface) && inside(special, surface),
      overlap,
      dodgeDisabled: document.getElementById("btn-dodge")?.disabled,
      specialDisabled: document.getElementById("btn-special")?.disabled,
      shortcuts: {
        dodge: document.getElementById("btn-dodge")?.getAttribute("aria-keyshortcuts"),
        special: document.getElementById("btn-special")?.getAttribute("aria-keyshortcuts"),
      },
    };
  });
  check("mobile action seals are visible, separated and stay inside the play surface",
    mobileGeometry.visible && mobileGeometry.inside && !mobileGeometry.overlap,
    JSON.stringify(mobileGeometry));
  check("mobile action seals meet touch-target size and expose keyboard equivalents",
    mobileGeometry.dodge.width >= 44 && mobileGeometry.dodge.height >= 44
      && mobileGeometry.special.width >= 44 && mobileGeometry.special.height >= 44
      && mobileGeometry.shortcuts.dodge?.includes("Space")
      && mobileGeometry.shortcuts.special === "Q",
    `dodge=${mobileGeometry.dodge.width}x${mobileGeometry.dodge.height} special=${mobileGeometry.special.width}x${mobileGeometry.special.height}`);
  check("mobile buttons mirror action availability",
    mobileGeometry.dodgeDisabled === false && mobileGeometry.specialDisabled === true,
    `dodgeDisabled=${mobileGeometry.dodgeDisabled} specialDisabled=${mobileGeometry.specialDisabled}`);

  await mobile.locator("#btn-dodge").tap();
  const tappedDodge = await step(mobile, 1, 1 / 60, true);
  check("the mobile Ink Step seal feeds the production dodge input",
    tappedDodge.dodgeT > 0 && tappedDodge.invuln > 0 && tappedDodge.dashes >= 1,
    `t=${tappedDodge.dodgeT.toFixed(3)} cuts=${tappedDodge.dashes}`);

  await resetScenario(mobile);
  await mobile.evaluate(() => {
    const game = window.__INK.game;
    game.actions.setCharge(game.actionState().special.maxCharge, { quiet: true });
    game.render();
  });
  const readySpecialAnimation = await mobile.locator("#btn-special").evaluate((button) => ({
    enabled: !button.disabled,
    ready: button.classList.contains("is-ready"),
    animation: getComputedStyle(button).animationName,
  }));
  check("a full mobile Eclipse seal visibly pulses as ready",
    readySpecialAnimation.enabled && readySpecialAnimation.ready
      && readySpecialAnimation.animation !== "none",
    JSON.stringify(readySpecialAnimation));
  await mobile.locator("#btn-special").tap();
  const tappedSpecial = await step(mobile, 1, 1 / 60, true);
  check("the mobile Eclipse seal feeds the production special input",
    tappedSpecial.specialT > 0 && tappedSpecial.action.special.charge === 0
      && tappedSpecial.eclipses >= 1,
    `t=${tappedSpecial.specialT.toFixed(3)} charge=${tappedSpecial.action.special.charge}`);

  // Keep the steering finger in Chrome's native touch dispatcher, then feed a
  // distinct touch PointerEvent to the action target. DevTools groups added
  // touch contacts under the first contact's DOM target, unlike normal Pointer
  // Events, so dispatching the second pointer at its real target avoids testing
  // that protocol quirk instead of the game's simultaneous-control contract.
  await resetScenario(mobile);
  const touchPoints = await mobile.evaluate(() => {
    const canvas = document.getElementById("ink-canvas").getBoundingClientRect();
    const dodge = document.getElementById("btn-dodge").getBoundingClientRect();
    return {
      // Mid-left avoids the persistent Rainbot exit hatch at the bottom-left.
      stickStart: { x: canvas.left + 48, y: canvas.top + canvas.height * 0.56 },
      stickMove: { x: canvas.left + 116, y: canvas.top + canvas.height * 0.56 },
      dodge: { x: dodge.left + dodge.width / 2, y: dodge.top + dodge.height / 2 },
    };
  });
  const cdp = await mobileContext.newCDPSession(mobile);
  const point = (coords, id) => ({
    x: coords.x, y: coords.y, id,
    radiusX: 5, radiusY: 5, force: 1,
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(touchPoints.stickStart, 1)],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point(touchPoints.stickMove, 1)],
  });
  const stickBeforeAction = await mobile.evaluate(() => ({
    active: window.__INK.game.input.touchActive,
    touchId: window.__INK.game.input.touchId,
  }));
  await mobile.locator("#btn-dodge").dispatchEvent("pointerdown", {
    pointerId: 202,
    pointerType: "touch",
    isPrimary: false,
    clientX: touchPoints.dodge.x,
    clientY: touchPoints.dodge.y,
    buttons: 1,
  });
  const multiTouch = await mobile.evaluate((stickBeforeAction) => {
    const game = window.__INK.game;
    game.step(1 / 60);
    return {
      stickActive: game.input.touchActive,
      stickX: game.input.x,
      dodgeT: game.player.dodgeT,
      dodgeDirX: game.player.dodgeDirX,
      touchId: game.input.touchId,
      stickBeforeAction,
    };
  }, stickBeforeAction);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  check("mobile supports steering and pressing Ink Step with two fingers",
    multiTouch.stickBeforeAction.active && multiTouch.stickActive && multiTouch.stickX > 0.5
      && multiTouch.dodgeT > 0 && multiTouch.dodgeDirX > 0.5,
    JSON.stringify(multiTouch));

  await mobileContext.close();
  check("action flows produce no browser errors", browserErrors.length === 0, browserErrors.join(" | "));
} finally {
  await browser.close();
  if (server) server.kill("SIGTERM");
}

const failures = checks.filter((result) => !result.pass);
if (failures.length) {
  console.error(`\nInk Blood action regression failed: ${failures.length}/${checks.length} checks failed.`);
  process.exit(1);
}

console.log(`\nInk Blood action regression passed: ${checks.length} deterministic keyboard, combat, animation, reset and mobile checks.`);
