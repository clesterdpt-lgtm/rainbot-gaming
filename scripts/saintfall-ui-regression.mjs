#!/usr/bin/env node
/* ============================================================
   SAINTFALL - command interface and tactical-map regression

   This suite drives the production input listeners. QA hooks are used to
   observe state and establish deterministic boundaries, never to stand in
   for Tab, mouse, Escape, menu clicks, or touch.

   Usage:
     node scripts/saintfall-ui-regression.mjs
     node scripts/saintfall-ui-regression.mjs --out output/saintfall/ui-overhaul
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((part) => part.trim().split(/\s+/)).map(([key, value]) => [key, value ?? true])
);
const OUT = path.resolve(root, args.out || "output/saintfall/ui-regression");
const PORT = 51000 + (process.pid % 8000);
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const diagnostics = { pageErrors: [], consoleErrors: [] };
const evidence = {};
let failed = 0;

function check(name, ok, detail = "") {
  const pass = !!ok;
  results.push({ name, ok: pass, detail });
  if (!pass) failed += 1;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  if (detail) console.log(`        ${detail}`);
}

function angleDelta(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

async function openMenuWithEscape(page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.keyboard.press("Escape");
    try {
      await page.waitForFunction(() => window.__SF?.menuState?.()?.open,
        null, { timeout: 2500 });
      return true;
    } catch (_) { /* Pointer lock may consume the first Escape. */ }
  }
  return false;
}

async function layoutAudit(page) {
  return await page.evaluate(() => {
    const stage = document.querySelector(".sf-stage");
    if (!stage) return { stage: null, offenders: ["missing .sf-stage"], scrollOverflow: Infinity };
    const bounds = stage.getBoundingClientRect();
    const selectors = [
      "#sf-native-ui", "#sf-hud", "#sf-command-wheel", "#sf-menu",
      "#sf-minimap", "#sf-touch", ".sf-command-wheel__dial",
      ".sf-menu__frame", ".sf-menu__content", ".sf-menu__rail",
      "[data-touch-command]",
    ];
    const nodes = [...new Set(selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)]))];
    const offenders = [];
    for (const node of nodes) {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden"
        || Number(style.opacity) === 0 || rect.width < 1 || rect.height < 1) continue;
      if (rect.left < bounds.left - 2 || rect.top < bounds.top - 2
        || rect.right > bounds.right + 2 || rect.bottom > bounds.bottom + 2) {
        offenders.push(`${node.id || node.getAttribute("data-menu-page")
          || node.getAttribute("data-touch-command") || node.className}:`
          + `${Math.round(rect.left)},${Math.round(rect.top)},`
          + `${Math.round(rect.right)},${Math.round(rect.bottom)}`);
      }
    }
    return {
      stage: [bounds.left, bounds.top, bounds.right, bounds.bottom].map((n) => Math.round(n)),
      offenders,
      scrollOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  });
}

async function hudDensityAudit(page) {
  return await page.evaluate(() => {
    const stage = document.querySelector(".sf-stage");
    if (!stage) return { stage: null, coveragePct: Infinity,
      overlaps: ["missing .sf-stage"], readyLabels: [], largeClusters: [] };
    const stageRect = stage.getBoundingClientRect();
    const stageArea = Math.max(1, stageRect.width * stageRect.height);
    const isVisible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden"
        && Number(style.opacity) > 0 && rect.width > 1 && rect.height > 1;
    };
    const selectors = [
      ".sf-menu-trigger", "#sf-fullscreen", "#sf-objective", "#sf-compass",
      "#sf-minimap", "#sf-vitals", "#sf-command-status", "#sf-hint",
    ];
    const clusters = selectors.map((selector) => {
      const node = document.querySelector(selector);
      if (!isVisible(node)) return null;
      const rect = node.getBoundingClientRect();
      return {
        selector,
        left: Number((rect.left - stageRect.left).toFixed(1)),
        top: Number((rect.top - stageRect.top).toFixed(1)),
        right: Number((rect.right - stageRect.left).toFixed(1)),
        bottom: Number((rect.bottom - stageRect.top).toFixed(1)),
        width: Number(rect.width.toFixed(1)),
        height: Number(rect.height.toFixed(1)),
        areaPct: Number(((rect.width * rect.height / stageArea) * 100).toFixed(2)),
      };
    }).filter(Boolean);
    const overlaps = [];
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const a = clusters[i];
        const b = clusters[j];
        const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (width * height > 4) {
          overlaps.push(`${a.selector} x ${b.selector}: ${width.toFixed(1)}x${height.toFixed(1)}`);
        }
      }
    }
    const readyLabels = [
      ...document.querySelectorAll(
        "#sf-boost-value, #sf-shield-value, #sf-command-status .sf-hud__stratstatus"
      ),
    ].filter((node) => isVisible(node) && node.textContent.trim().toUpperCase() === "READY")
      .map((node) => node.id || node.className);
    return {
      stage: { width: Number(stageRect.width.toFixed(1)),
        height: Number(stageRect.height.toFixed(1)) },
      coveragePct: Number(clusters.reduce((sum, cluster) => sum + cluster.areaPct, 0).toFixed(2)),
      overlaps,
      readyLabels,
      largeClusters: clusters.filter((cluster) => cluster.areaPct > 6)
        .map((cluster) => `${cluster.selector}:${cluster.areaPct}%`),
      clusters,
    };
  });
}

async function touchTargetAudit(page) {
  return await page.evaluate(() => {
    const stage = document.querySelector(".sf-stage");
    const nodes = [...stage.querySelectorAll(
      "button, [data-touch-stick], [data-touch-look]"
    )];
    const measured = [];
    const offenders = [];
    for (const node of nodes) {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden"
        || Number(style.opacity) === 0 || rect.width < 1 || rect.height < 1) continue;
      const label = node.getAttribute("aria-label") || node.textContent.replace(/\s+/g, " ").trim()
        || node.dataset.touchAction || node.className;
      const item = { label: label.slice(0, 80), width: Number(rect.width.toFixed(1)),
        height: Number(rect.height.toFixed(1)) };
      measured.push(item);
      if (rect.width < 43.5 || rect.height < 43.5) offenders.push(item);
    }
    return { count: measured.length, offenders };
  });
}

async function preparePage(browser, name, contextOptions, { maximize = true } = {}) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on("pageerror", (error) => diagnostics.pageErrors.push(`${name}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(`${name}: ${message.text()}`);
  });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high&intro=skip`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate((shouldMaximize) => {
    if (shouldMaximize) window.__SF.maximize();
    window.__SF.invulnerable(true);
    const boot = document.getElementById("sf-boot");
    boot?.remove();
  }, maximize);
  await page.waitForTimeout(180);
  return { context, page };
}

async function embeddedKeyboardPass(browser) {
  console.log("\n=== EMBEDDED PAGE KEYBOARD SCOPE ===");
  const { context, page } = await preparePage(browser, "embedded-keyboard", {
    viewport: { width: 1440, height: 1000 },
  }, { maximize: false });
  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "embedded-active-play.png") });
  const embeddedDensity = await hudDensityAudit(page);
  evidence.embeddedDensity = embeddedDensity;
  check("embedded HUD keeps a sparse non-overlapping hierarchy",
    embeddedDensity.coveragePct <= 10 && embeddedDensity.overlaps.length === 0
      && embeddedDensity.readyLabels.length === 0 && embeddedDensity.largeClusters.length === 0,
    JSON.stringify(embeddedDensity));
  const allGames = page.locator(".game-page__header a", { hasText: "All games" });
  await page.evaluate(() => {
    const snapshot = () => {
      const T = window.__SF;
      let debugMeshes = 0;
      T.ctx.scene?.traverse?.((node) => { if (node.name === "collision-debug") debugMeshes += 1; });
      return {
        keys: [...T.player.input.keys],
        events: T.player.input.state.events.map((event) => event.type),
        jumpPressed: T.player.input.state.jumpPressed,
        jump: T.player.input.state.jump,
        action: T.player.action,
        free: T.player.state.free,
        time: T.atmos.time,
        storm: T.atmos.storm,
        audio: T.settingsState()?.audioEnabled,
        hudDisplay: document.getElementById("sf-hud")?.style.display || "",
        debugMeshes,
      };
    };
    window.__sfEmbeddedInputState = snapshot;
    window.__sfEmbeddedKeyAudit = [];
    window.addEventListener("keydown", (event) => {
      window.__sfEmbeddedKeyAudit.push({
        code: event.code,
        prevented: event.defaultPrevented,
        target: event.target?.id || event.target?.textContent?.replace(/\s+/g, " ").trim() || null,
        ...snapshot(),
      });
    });
  });
  await allGames.focus();
  const before = await page.evaluate(() => ({
    focus: document.activeElement?.textContent?.replace(/\s+/g, " ").trim() || null,
    focusOutsideStage: !document.querySelector(".sf-stage")?.contains(document.activeElement),
    wheel: window.__SF.commandWheelState(),
    menu: window.__SF.menuState(),
    maximized: document.documentElement.classList.contains("sf-maximised"),
    input: window.__sfEmbeddedInputState(),
  }));
  await page.keyboard.down("Tab");
  await page.waitForTimeout(120);
  const held = await page.evaluate(() => ({
    focusId: document.activeElement?.id || null,
    focusText: document.activeElement?.textContent?.replace(/\s+/g, " ").trim() || null,
    focusAdvanced: document.activeElement !== document.querySelector(".game-page__header a"),
    wheel: window.__SF.commandWheelState(),
    menu: window.__SF.menuState(),
  }));
  await page.keyboard.up("Tab");
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => ({
    focusId: document.activeElement?.id || null,
    wheel: window.__SF.commandWheelState(),
    menu: window.__SF.menuState(),
  }));

  for (const code of ["KeyW", "KeyQ", "Space", "Digit4", "KeyF", "KeyH", "KeyK", "KeyM"]) {
    await allGames.focus();
    await page.keyboard.down(code);
    await page.waitForTimeout(25);
    await page.keyboard.up(code);
    await page.waitForTimeout(25);
  }
  const outsideKeys = await page.evaluate(() => ({
    audits: window.__sfEmbeddedKeyAudit.filter((entry) => entry.code !== "Tab"),
    input: window.__sfEmbeddedInputState(),
  }));
  await page.screenshot({ path: path.join(OUT, "embedded-page-tab-focus.png"), fullPage: false });
  evidence.embeddedKeyboard = { before, held, after, outsideKeys };
  check("embedded page Tab advances normal document focus without owning game input",
    before.focusOutsideStage && !before.maximized
      && held.focusAdvanced && held.focusId === "sf-fullscreen"
      && !held.wheel?.open && !held.menu?.open
      && after.wheel?.dispatchSeq === before.wheel?.dispatchSeq
      && !after.wheel?.open && !after.menu?.open,
    JSON.stringify({ before, held, after }));
  const gameplayAudits = outsideKeys.audits.filter((entry) =>
    ["KeyW", "KeyQ", "Space"].includes(entry.code));
  check("embedded W, Q, and Space remain ordinary page keys without gameplay fallthrough",
    gameplayAudits.length === 3 && gameplayAudits.every((entry) =>
      !entry.prevented && entry.keys.length === 0 && entry.events.length === 0
        && !entry.jumpPressed && !entry.jump && !entry.action)
      && outsideKeys.input.keys.length === 0 && outsideKeys.input.events.length === 0
      && !outsideKeys.input.jumpPressed && !outsideKeys.input.jump && !outsideKeys.input.action,
    JSON.stringify(gameplayAudits));
  check("embedded time, debug, camera, HUD, and audio hotkeys do not mutate game state",
    ["free", "time", "storm", "audio", "hudDisplay", "debugMeshes"].every((key) =>
      outsideKeys.input[key] === before.input[key]),
    JSON.stringify({ before: before.input, after: outsideKeys.input }));
  await context.close();
}

async function desktopPass(browser) {
  console.log("\n=== DESKTOP COMMAND INTERFACE ===");
  const { context, page } = await preparePage(browser, "desktop", {
    viewport: { width: 1440, height: 900 },
  });

  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "desktop-active-play.png") });
  const desktopDensity = await hudDensityAudit(page);
  evidence.desktopDensity = desktopDensity;
  check("desktop HUD keeps a sparse non-overlapping hierarchy",
    desktopDensity.coveragePct <= 10 && desktopDensity.overlaps.length === 0
      && desktopDensity.readyLabels.length === 0 && desktopDensity.largeClusters.length === 0,
    JSON.stringify(desktopDensity));

  const map = await page.evaluate(() => {
    const T = window.__SF;
    const saved = { body: T.player.state.yaw, camera: T.player.state.camYaw,
      pitch: T.player.state.camPitch, dist: T.player.state.camDist };
    T.setBodyHeading(0.64);
    T.setCam(-1.2, saved.pitch, saved.dist);
    T.ctx.hud.redrawMinimap();
    const a = T.minimapState();
    T.setCam(1.45, saved.pitch, saved.dist);
    T.ctx.hud.redrawMinimap();
    const b = T.minimapState();
    T.setBodyHeading(2.35);
    const c = T.minimapState();
    T.setBodyHeading(saved.body);
    T.setCam(saved.camera, saved.pitch, saved.dist);
    T.ctx.hud.redrawMinimap();
    return { a, b, c };
  });
  evidence.desktopMap = map;
  check("map uses authored -Z north", map.a?.north?.axis === "-Z"
    && map.a?.worldRotation === 0 && map.a?.north?.canvasYaw === 0,
  JSON.stringify(map.a?.north || null));
  check("camera orbit leaves the map arrow fixed",
    Number.isFinite(map.a?.arrowYaw) && angleDelta(map.a.arrowYaw, map.b.arrowYaw) < 0.001,
    `${map.a?.arrowYaw} -> ${map.b?.arrowYaw}`);
  check("map arrow follows model-facing yaw",
    angleDelta(map.c?.arrowYaw, map.c?.bodyYaw) < 0.001
      && angleDelta(map.b?.arrowYaw, map.c?.arrowYaw) > 1,
    `body ${map.c?.bodyYaw}, arrow ${map.c?.arrowYaw}`);

  const legacyBefore = await page.evaluate(() => ({
    wheel: window.__SF.commandWheelState(),
    cooldowns: { ...window.__SF.mission.cooldowns },
  }));
  await page.keyboard.down("KeyV");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(140);
  const legacyHeld = await page.evaluate(() => ({
    wheel: window.__SF.commandWheelState(),
    moveY: window.__SF.player.input.state.move.y,
    cooldowns: { ...window.__SF.mission.cooldowns },
  }));
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("KeyV");
  check("V plus arrows is not a public command path and preserves movement",
    !legacyHeld.wheel?.open
      && legacyHeld.wheel?.dispatchSeq === legacyBefore.wheel?.dispatchSeq
      && legacyHeld.moveY < -0.5
      && Object.keys(legacyBefore.cooldowns).every((key) =>
        legacyHeld.cooldowns[key] === legacyBefore.cooldowns[key]),
    JSON.stringify(legacyHeld));

  const beforeWheel = await page.evaluate(() => {
    const T = window.__SF;
    T.mission.cooldowns.cluster = 0;
    return { wheel: T.commandWheelState(), camera: T.player.state.camYaw,
      body: T.player.state.yaw, cooldown: T.mission.cooldowns.cluster };
  });
  await page.keyboard.down("Tab");
  await page.waitForFunction(() => window.__SF.commandWheelState()?.open,
    null, { timeout: 3000 });
  const dialBox = await page.locator(".sf-command-wheel__dial").boundingBox();
  await page.mouse.move(dialBox.x + dialBox.width / 2 + 0.866 * 132,
    dialBox.y + dialBox.height / 2 + 0.5 * 132, { steps: 5 });
  let pointerSelected = false;
  try {
    await page.waitForFunction(() => window.__SF.commandWheelState()?.selectedKey === "cluster",
      null, { timeout: 800 });
    pointerSelected = true;
  } catch (_) {
    // Keep the rest of the diagnostics running; Digit2 is a real supported
    // selection input, while the failed pointer gate remains a reported fail.
    await page.keyboard.press("Digit2");
    await page.waitForFunction(() => window.__SF.commandWheelState()?.selectedKey === "cluster",
      null, { timeout: 2000 });
  }
  check("pointer movement selects the matching wheel sector", pointerSelected,
    JSON.stringify({ dialBox, vector: await page.evaluate(() => window.__SF.commandWheelState()?.vector) }));
  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "desktop-command-wheel.png") });
  const openWheel = await page.evaluate(() => window.__SF.commandWheelState());
  await page.keyboard.up("Tab");
  await page.waitForFunction((seq) => {
    const state = window.__SF.commandWheelState();
    return state && !state.open && state.dispatchSeq === seq + 1;
  }, beforeWheel.wheel?.dispatchSeq || 0, { timeout: 4000 });
  await page.waitForTimeout(180);
  const afterWheel = await page.evaluate(() => ({
    wheel: window.__SF.commandWheelState(),
    camera: window.__SF.player.state.camYaw,
    body: window.__SF.player.state.yaw,
    cooldown: window.__SF.mission.cooldowns.cluster,
  }));
  evidence.desktopWheel = { beforeWheel, openWheel, afterWheel };
  check("holding Tab opens a three-choice command wheel",
    openWheel?.open && openWheel?.commands?.length === 3 && openWheel.selectedKey === "cluster",
    JSON.stringify(openWheel));
  check("releasing Tab dispatches the highlighted command exactly once",
    afterWheel.wheel?.dispatchSeq === (beforeWheel.wheel?.dispatchSeq || 0) + 1
      && afterWheel.wheel?.lastDispatch?.key === "cluster" && afterWheel.cooldown > 0,
    JSON.stringify(afterWheel.wheel));
  check("command-wheel pointer selection does not turn the camera",
    angleDelta(beforeWheel.camera, afterWheel.camera) < 0.001,
    `${beforeWheel.camera} -> ${afterWheel.camera}`);

  const semanticWheelKeys = [];
  for (const code of ["KeyW", "ArrowUp"]) {
    const fresh = await page.evaluate(() => {
      const T = window.__SF;
      T.mission.cooldowns.orbital = 0;
      return T.commandWheelState();
    });
    await page.keyboard.down("Tab");
    await page.waitForFunction(() => window.__SF.commandWheelState()?.open,
      null, { timeout: 3000 });
    const unselected = await page.evaluate(() => window.__SF.commandWheelState());
    await page.keyboard.press(code);
    await page.waitForFunction(() => window.__SF.commandWheelState()?.selectedKey === "orbital",
      null, { timeout: 2000 });
    const selected = await page.evaluate(() => window.__SF.commandWheelState());
    await page.keyboard.up("Tab");
    await page.waitForFunction((seq) => window.__SF.commandWheelState()?.dispatchSeq === seq + 1,
      fresh?.dispatchSeq || 0, { timeout: 4000 });
    const dispatched = await page.evaluate(() => ({
      wheel: window.__SF.commandWheelState(),
      movementKeyLeaked: window.__SF.player.input.keys.has("KeyW")
        || window.__SF.player.input.keys.has("ArrowUp"),
    }));
    semanticWheelKeys.push({ code, fresh, unselected, selected, dispatched });
  }
  evidence.semanticWheelKeys = semanticWheelKeys;
  check("fresh-wheel W and Up select the visible Orbital sector and dispatch once",
    semanticWheelKeys.length === 2 && semanticWheelKeys.every((probe) =>
      probe.unselected.open && probe.unselected.selectedIndex === -1
        && probe.selected.selectedKey === "orbital" && probe.selected.selectedIndex === 0
        && probe.dispatched.wheel.dispatchSeq === (probe.fresh?.dispatchSeq || 0) + 1
        && probe.dispatched.wheel.lastDispatch?.key === "orbital"
        && !probe.dispatched.movementKeyLeaked),
    JSON.stringify(semanticWheelKeys));

  let pointerLocked = false;
  await page.evaluate(() => {
    window.__sfPointerLockProbe = { requested: false, resolved: false, error: null };
    const canvas = document.getElementById("sf-canvas");
    canvas.addEventListener("click", (event) => {
      event.stopImmediatePropagation();
      window.__sfPointerLockProbe.requested = true;
      try {
        const lock = canvas.requestPointerLock();
        Promise.resolve(lock).then(() => {
          window.__sfPointerLockProbe.resolved = true;
        }).catch((error) => {
          window.__sfPointerLockProbe.error = error?.message || String(error);
        });
      } catch (error) {
        window.__sfPointerLockProbe.error = error?.message || String(error);
      }
    }, { capture: true, once: true });
  });
  try {
    await page.locator("#sf-canvas").click({ position: { x: 720, y: 450 } });
    await page.waitForFunction(() => document.pointerLockElement?.id === "sf-canvas",
      null, { timeout: 2500 });
    pointerLocked = true;
  } catch (_) { /* Keep evidence flowing; the ownership check will fail. */ }
  const pointerLockProbe = await page.evaluate(() => window.__sfPointerLockProbe);
  if (!pointerLocked) {
    // Headless Chromium can reject the platform Pointer Lock request. The
    // production-owned state is the deterministic boundary for exercising
    // the exact same keyboard contract with real browser key events.
    await page.evaluate(() => { window.__SF.player.input.state.locked = true; });
  }
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(140);
  const lockedW = await page.evaluate(() => ({
    locked: document.pointerLockElement?.id === "sf-canvas",
    ownsPointerInput: document.pointerLockElement?.id === "sf-canvas"
      || window.__SF.player.input.state.locked,
    keyHeld: window.__SF.player.input.keys.has("KeyW"),
    moveY: window.__SF.player.input.state.move.y,
  }));
  await page.keyboard.up("KeyW");
  await page.evaluate(() => {
    const T = window.__SF;
    T.autoStow(false);
    T.player.cancelTransientActions?.();
    T.weapons.setMode?.("ranged");
    T.weapons.setStow?.(false);
    T.advanceTime(0.5, 1 / 60);
  });
  await page.keyboard.press("KeyQ");
  let meleeStarted = false;
  try {
    await page.waitForFunction(() => /^melee/.test(window.__SF.player.action || ""),
      null, { timeout: 1500 });
    meleeStarted = true;
  } catch (_) { /* Report through the check below. */ }
  const lockedAudioBefore = await page.evaluate(() => window.__SF.settingsState().audioEnabled);
  await page.keyboard.press("KeyM");
  let lockedAudioAfter = lockedAudioBefore;
  try {
    await page.waitForFunction((before) => window.__SF.settingsState().audioEnabled !== before,
      lockedAudioBefore, { timeout: 1500 });
    lockedAudioAfter = await page.evaluate(() => window.__SF.settingsState().audioEnabled);
  } catch (_) { /* Report through the check below. */ }
  await page.keyboard.press("KeyM");
  try {
    await page.waitForFunction((before) => window.__SF.settingsState().audioEnabled === before,
      lockedAudioBefore, { timeout: 1500 });
  } catch (_) { /* Restoration is best effort; the positive edge is graded. */ }

  const lockedWheelBefore = await page.evaluate(() => {
    const T = window.__SF;
    T.mission.cooldowns.orbital = 0;
    return T.commandWheelState();
  });
  await page.keyboard.down("Tab");
  await page.waitForFunction(() => window.__SF.commandWheelState()?.open,
    null, { timeout: 3000 });
  const lockedWheelOpen = await page.evaluate(() => ({
    locked: document.pointerLockElement?.id === "sf-canvas",
    ownsPointerInput: document.pointerLockElement?.id === "sf-canvas"
      || window.__SF.player.input.state.locked,
    wheel: window.__SF.commandWheelState(),
  }));
  await page.keyboard.press("Digit1");
  await page.keyboard.up("Tab");
  await page.waitForFunction((seq) => window.__SF.commandWheelState()?.dispatchSeq === seq + 1,
    lockedWheelBefore?.dispatchSeq || 0, { timeout: 4000 });
  const lockedWheelAfter = await page.evaluate(() => window.__SF.commandWheelState());
  evidence.pointerLockInput = {
    pointerLocked, pointerLockProbe, lockedW, meleeStarted, lockedAudioBefore, lockedAudioAfter,
    lockedWheelBefore, lockedWheelOpen, lockedWheelAfter,
  };
  check("pointer-locked W and Q retain movement and melee gameplay input",
    lockedW.ownsPointerInput && lockedW.keyHeld && lockedW.moveY < -0.5 && meleeStarted,
    JSON.stringify({ pointerLocked, pointerLockProbe, lockedW, meleeStarted }));
  check("pointer-locked M hotkey still toggles field audio",
    lockedAudioAfter !== lockedAudioBefore,
    `${lockedAudioBefore} -> ${lockedAudioAfter}`);
  check("pointer-locked Tab wheel still opens and dispatches exactly once",
    lockedWheelOpen.ownsPointerInput && lockedWheelOpen.wheel?.open
      && lockedWheelAfter.dispatchSeq === (lockedWheelBefore?.dispatchSeq || 0) + 1
      && lockedWheelAfter.lastDispatch?.key === "orbital",
    JSON.stringify({ lockedWheelOpen, lockedWheelAfter }));

  let pointerLockBoundary = pointerLocked ? "platform" : "qa-state";
  if (!pointerLocked) {
    const simulated = await page.evaluate(() => {
      try {
        const canvas = document.getElementById("sf-canvas");
        Object.defineProperty(document, "pointerLockElement", {
          configurable: true, get: () => canvas,
        });
        return document.pointerLockElement === canvas;
      } catch (_) { return false; }
    });
    if (simulated) pointerLockBoundary = "qa-document-boundary";
  }
  await page.mouse.move(100, 450);
  await page.keyboard.down("Tab");
  await page.waitForFunction(() => window.__SF.commandWheelState()?.open,
    null, { timeout: 3000 });
  await page.mouse.move(900, 450);
  await page.waitForFunction(() => window.__SF.commandWheelState()?.selectedKey === "cluster",
    null, { timeout: 2000 });
  const flickRight = await page.evaluate(() => window.__SF.commandWheelState());
  await page.mouse.move(600, 450);
  await page.waitForFunction(() => window.__SF.commandWheelState()?.selectedKey === "resupply",
    null, { timeout: 2000 });
  const flickLeft = await page.evaluate(() => window.__SF.commandWheelState());
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !window.__SF.commandWheelState()?.open,
    null, { timeout: 2000 });
  if (!pointerLocked) {
    await page.evaluate(() => {
      try { delete document.pointerLockElement; } catch (_) { /* best effort */ }
      window.__SF.player.input.state.locked = false;
    });
  }
  evidence.wheelOvershoot = { pointerLockBoundary, flickRight, flickLeft };
  check("large right flick then 300px left changes sector without overshoot debt",
    ["platform", "qa-document-boundary"].includes(pointerLockBoundary)
      && flickRight.selectedKey === "cluster" && flickRight.vector?.x > 0
      && flickRight.vector?.magnitude <= 132.01
      && flickLeft.selectedKey === "resupply" && flickLeft.vector?.x < 0
      && flickLeft.vector?.magnitude <= 132.01,
    JSON.stringify({ pointerLockBoundary, flickRight, flickLeft }));

  // Let every command call resolve before creating the persistence boundary.
  await page.evaluate(() => window.__SF.advanceTime(5.0, 1 / 60));
  check("Escape opens the native operation menu", await openMenuWithEscape(page));
  await page.waitForSelector('#sf-menu[aria-modal="true"]');
  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "desktop-operation-menu.png") });
  const pauseProbe = await page.evaluate(() => {
    const T = window.__SF;
    const before = T.mission.state.elapsed;
    const runtime = T.advanceRuntimeTime(1, 1 / 60);
    const after = T.mission.state.elapsed;
    const menu = document.getElementById("sf-menu");
    return {
      before, after, runtime, state: T.menuState(),
      modal: menu?.getAttribute("aria-modal"),
      focusInside: !!menu?.contains(document.activeElement),
      bodyPaused: document.body.classList.contains("rb-escape-menu-open"),
    };
  });
  evidence.desktopMenu = pauseProbe;
  check("operation menu is a focus-owned modal",
    pauseProbe.modal === "true" && pauseProbe.focusInside && pauseProbe.bodyPaused,
    JSON.stringify(pauseProbe));
  check("operation menu freezes production runtime time",
    pauseProbe.runtime?.supported && pauseProbe.runtime?.paused
      && Math.abs(pauseProbe.after - pauseProbe.before) < 1e-6,
    `${pauseProbe.before} -> ${pauseProbe.after}`);
  await page.keyboard.press("Tab");
  const trapped = await page.evaluate(() => document.getElementById("sf-menu")
    ?.contains(document.activeElement));
  check("Tab focus remains inside the operation menu", trapped);

  await page.locator('[data-menu-panel="controls"]').click();
  await page.waitForFunction(() => window.__SF.menuState()?.panel === "controls");
  const controlCount = await page.locator('[data-menu-page="controls"] .sf-control-row').count();
  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "desktop-controls-menu.png") });
  const settingsNav = page.locator('[data-menu-panel="settings"]');
  await settingsNav.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__SF.menuState()?.panel === "settings");
  const settingsSpace = await page.evaluate(() => ({
    panel: window.__SF.menuState()?.panel,
    focusPanel: document.activeElement?.dataset?.menuPanel || null,
  }));
  const settingCount = await page.locator('[data-menu-page="settings"] .sf-setting').count();
  const contrastBefore = await page.evaluate(() => window.__SF.settingsState().highContrast);
  const contrastSwitch = page.locator('[data-setting="high-contrast"]');
  await contrastSwitch.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction((before) => window.__SF.settingsState().highContrast !== before,
    contrastBefore);
  const contrastAfter = await page.evaluate(() => ({
    setting: window.__SF.settingsState().highContrast,
    bodyClass: document.body.classList.contains("sf-high-contrast"),
  }));
  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "desktop-settings-menu.png") });
  check("menu exposes complete controls and accessibility settings",
    controlCount >= 12 && settingCount >= 4,
    `${controlCount} control rows · ${settingCount} settings`);
  check("focused menu navigation and switch retain native Space activation",
    settingsSpace.panel === "settings" && settingsSpace.focusPanel === "settings"
      && contrastAfter.setting !== contrastBefore,
    JSON.stringify({ settingsSpace, contrastBefore, contrastAfter }));
  check("accessibility settings apply through real menu input",
    contrastAfter.setting !== contrastBefore && contrastAfter.bodyClass === contrastAfter.setting,
    JSON.stringify({ contrastBefore, contrastAfter }));
  await page.keyboard.press("Space");

  console.log("\n=== FIELD SAVE ROUND TRIP ===");
  await page.locator('[data-menu-panel="saves"]').click();
  await page.waitForFunction(() => window.__SF.menuState()?.panel === "saves");
  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "desktop-save-load-menu.png") });
  const saveAction = page.locator(
    '[data-save-kind="manual"][data-save-index="0"] [data-save-action="save"],'
    + '[data-save-action="save"][data-save-kind="manual"][data-save-index="0"]'
  ).first();
  const loadAction = page.locator(
    '[data-save-kind="manual"][data-save-index="0"] [data-save-action="load"],'
    + '[data-save-action="load"][data-save-kind="manual"][data-save-index="0"]'
  ).first();
  const clearAction = page.locator(
    '[data-save-kind="manual"][data-save-index="0"] [data-save-action="clear"],'
    + '[data-save-action="clear"][data-save-kind="manual"][data-save-index="0"]'
  ).first();
  const restartAction = page.locator('[data-menu-action="restart"]');
  const original = await page.evaluate(() => {
    const T = window.__SF;
    T.combat.player.hp = 87;
    T.setBodyHeading(0.91);
    return { x: T.player.state.x, z: T.player.state.z, yaw: T.player.state.yaw,
      camYaw: T.player.state.camYaw, hp: T.combat.player.hp };
  });
  await saveAction.click();
  await page.waitForFunction(() => window.__SF.persistenceState()?.manuals?.[0]);
  const overwriteBefore = await page.evaluate(() => {
    const state = window.__SF.persistenceState();
    return {
      label: document.querySelector('[data-save-kind="manual"][data-save-index="0"]'
        + ' [data-save-action="save"]')?.textContent?.trim(),
      resultAt: state?.lastResult?.at || 0,
      snapshotAt: state?.manuals?.[0]?.snapshot?.timestamp || 0,
    };
  });
  await saveAction.click();
  const overwriteArmed = await page.evaluate(() => {
    const state = window.__SF.persistenceState();
    return {
      label: document.querySelector('[data-save-kind="manual"][data-save-index="0"]'
        + ' [data-save-action="save"]')?.textContent?.trim(),
      resultAt: state?.lastResult?.at || 0,
      snapshotAt: state?.manuals?.[0]?.snapshot?.timestamp || 0,
    };
  });
  await page.locator('[data-menu-panel="operation"]').click();
  await page.waitForFunction(() => window.__SF.menuState()?.panel === "operation");
  await page.locator('[data-menu-panel="saves"]').click();
  await page.waitForFunction(() => window.__SF.menuState()?.panel === "saves");
  const overwriteReturned = await page.evaluate(() => {
    const state = window.__SF.persistenceState();
    return {
      label: document.querySelector('[data-save-kind="manual"][data-save-index="0"]'
        + ' [data-save-action="save"]')?.textContent?.trim(),
      resultAt: state?.lastResult?.at || 0,
      snapshotAt: state?.manuals?.[0]?.snapshot?.timestamp || 0,
    };
  });
  await saveAction.click();
  await page.waitForFunction((beforeAt) => {
    const result = window.__SF.persistenceState()?.lastResult;
    return result?.type === "saved" && result.at > beforeAt;
  }, overwriteBefore.resultAt);
  const overwriteConfirmed = await page.evaluate(() => {
    const state = window.__SF.persistenceState();
    return {
      label: document.querySelector('[data-save-kind="manual"][data-save-index="0"]'
        + ' [data-save-action="save"]')?.textContent?.trim(),
      resultType: state?.lastResult?.type || null,
      resultAt: state?.lastResult?.at || 0,
      snapshotAt: state?.manuals?.[0]?.snapshot?.timestamp || 0,
      savePresent: !!state?.manuals?.[0]?.snapshot,
    };
  });
  evidence.overwriteSafety = {
    overwriteBefore, overwriteArmed, overwriteReturned, overwriteConfirmed,
  };
  check("overwrite stays explicitly armed across panel navigation and requires a second click",
    overwriteBefore.label === "OVERWRITE"
      && overwriteArmed.label === "CONFIRM OVERWRITE"
      && overwriteArmed.resultAt === overwriteBefore.resultAt
      && overwriteArmed.snapshotAt === overwriteBefore.snapshotAt
      && overwriteReturned.label === "CONFIRM OVERWRITE"
      && overwriteReturned.resultAt === overwriteBefore.resultAt
      && overwriteReturned.snapshotAt === overwriteBefore.snapshotAt
      && overwriteConfirmed.label === "OVERWRITE"
      && overwriteConfirmed.resultType === "saved"
      && overwriteConfirmed.resultAt > overwriteBefore.resultAt
      && overwriteConfirmed.snapshotAt >= overwriteBefore.snapshotAt
      && overwriteConfirmed.savePresent,
    JSON.stringify({ overwriteBefore, overwriteArmed, overwriteReturned, overwriteConfirmed }));
  await clearAction.click();
  await restartAction.click();
  const confirmationsArmed = await page.evaluate(() => ({
    clear: document.querySelector('[data-save-kind="manual"][data-save-index="0"]'
      + ' [data-save-action="clear"]')?.textContent?.trim(),
    restart: document.querySelector('[data-menu-action="restart"]')?.textContent?.trim(),
    restartArmed: window.__SF.menuState()?.restartArmed,
    savePresent: !!window.__SF.persistenceState()?.manuals?.[0],
    paused: window.__SF.menuState()?.paused,
  }));
  await page.waitForTimeout(4800);
  const confirmationsExpired = await page.evaluate(() => ({
    clear: document.querySelector('[data-save-kind="manual"][data-save-index="0"]'
      + ' [data-save-action="clear"]')?.textContent?.trim(),
    restart: document.querySelector('[data-menu-action="restart"]')?.textContent?.trim(),
    restartArmed: window.__SF.menuState()?.restartArmed,
    savePresent: !!window.__SF.persistenceState()?.manuals?.[0],
    paused: window.__SF.menuState()?.paused,
  }));
  await clearAction.click();
  await restartAction.click();
  const confirmationsRearmed = await page.evaluate(() => ({
    clear: document.querySelector('[data-save-kind="manual"][data-save-index="0"]'
      + ' [data-save-action="clear"]')?.textContent?.trim(),
    restart: document.querySelector('[data-menu-action="restart"]')?.textContent?.trim(),
    restartArmed: window.__SF.menuState()?.restartArmed,
    savePresent: !!window.__SF.persistenceState()?.manuals?.[0],
    paused: window.__SF.menuState()?.paused,
  }));
  evidence.confirmationExpiry = {
    confirmationsArmed, confirmationsExpired, confirmationsRearmed,
  };
  check("paused CLEAR and RESTART confirmations expire and rearm on the next click",
    confirmationsArmed.paused && confirmationsArmed.savePresent
      && confirmationsArmed.clear === "CONFIRM CLEAR"
      && confirmationsArmed.restart === "CONFIRM RESTART"
      && confirmationsArmed.restartArmed
      && confirmationsExpired.paused && confirmationsExpired.savePresent
      && confirmationsExpired.clear === "CLEAR"
      && confirmationsExpired.restart === "RESTART OPERATION"
      && !confirmationsExpired.restartArmed
      && confirmationsRearmed.savePresent
      && confirmationsRearmed.clear === "CONFIRM CLEAR"
      && confirmationsRearmed.restart === "CONFIRM RESTART"
      && confirmationsRearmed.restartArmed,
    JSON.stringify({ confirmationsArmed, confirmationsExpired, confirmationsRearmed }));
  await page.locator("[data-menu-close]").first().click();
  await page.waitForFunction(() => !window.__SF.menuState()?.open);
  const confirmationClosed = await page.evaluate(() => ({
    restart: document.querySelector('[data-menu-action="restart"]')?.textContent?.trim(),
    restartArmed: window.__SF.menuState()?.restartArmed,
  }));
  await openMenuWithEscape(page);
  const confirmationReopened = await page.evaluate(() => ({
    restart: document.querySelector('[data-menu-action="restart"]')?.textContent?.trim(),
    restartArmed: window.__SF.menuState()?.restartArmed,
    open: window.__SF.menuState()?.open,
  }));
  evidence.confirmationExpiry.confirmationClosed = confirmationClosed;
  evidence.confirmationExpiry.confirmationReopened = confirmationReopened;
  check("closing and reopening clears stale restart confirmation state",
    confirmationClosed.restart === "RESTART OPERATION" && !confirmationClosed.restartArmed
      && confirmationReopened.open
      && confirmationReopened.restart === "RESTART OPERATION"
      && !confirmationReopened.restartArmed,
    JSON.stringify({ confirmationClosed, confirmationReopened }));
  await page.locator("[data-menu-close]").first().click();
  await page.waitForFunction(() => !window.__SF.menuState()?.open);
  const mutated = await page.evaluate(() => {
    const T = window.__SF;
    T._teleportRaw(T.player.state.x + 34, T.player.state.z - 28, -2.2);
    T.combat.player.hp = 23;
    T.setCam(2.4, T.player.state.camPitch, T.player.state.camDist);
    return { x: T.player.state.x, z: T.player.state.z, yaw: T.player.state.yaw,
      camYaw: T.player.state.camYaw, hp: T.combat.player.hp };
  });
  await openMenuWithEscape(page);
  await page.locator('[data-menu-panel="saves"]').click();
  await loadAction.click();
  await page.waitForFunction(() => window.__SF.persistenceState()?.lastResult?.type === "loaded");
  const restored = await page.evaluate(() => ({
    x: window.__SF.player.state.x, z: window.__SF.player.state.z,
    yaw: window.__SF.player.state.yaw, camYaw: window.__SF.player.state.camYaw,
    hp: window.__SF.combat.player.hp, maxHp: window.__SF.combat.player.maxHp,
    persistence: window.__SF.persistenceState(),
  }));
  evidence.desktopSave = { original, mutated, restored };
  check("manual save captures and load restores meaningful player state",
    Math.hypot(restored.x - original.x, restored.z - original.z) < 0.1
      && angleDelta(restored.yaw, original.yaw) < 0.001
      && angleDelta(restored.camYaw, original.camYaw) < 0.001
      // Loading resumes play immediately, so health can regenerate between
      // the authoritative restore and this observation. It must return to at
      // least the saved value without exceeding the combat-owned maximum; a
      // missing restore would remain near the deliberately mutated 23 HP.
      && restored.hp >= original.hp - 0.01 && restored.hp <= restored.maxHp + 0.01,
    `saved ${JSON.stringify(original)} · mutated ${JSON.stringify(mutated)} · `
      + `restored ${JSON.stringify({ x: restored.x, z: restored.z,
        yaw: restored.yaw, camYaw: restored.camYaw, hp: restored.hp })}`);

  const desktopLayout = await layoutAudit(page);
  evidence.desktopLayout = desktopLayout;
  check("desktop HUD and modal stay inside the playfield",
    desktopLayout.offenders.length === 0 && desktopLayout.scrollOverflow <= 2,
    JSON.stringify(desktopLayout));
  await context.close();
}

async function mobilePass(browser) {
  console.log("\n=== MOBILE COMMAND INTERFACE ===");
  const { context, page } = await preparePage(browser, "mobile", {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const cdp = await context.newCDPSession(page);
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-touch-command]");
    return button && getComputedStyle(button).display !== "none"
      && button.getBoundingClientRect().width > 0;
  }, null, { timeout: 5000 });
  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "mobile-active-play.png") });
  const mobileDensity = await hudDensityAudit(page);
  evidence.mobileDensity = mobileDensity;
  check("portrait touch HUD keeps a sparse non-overlapping hierarchy",
    mobileDensity.coveragePct <= 15 && mobileDensity.overlaps.length === 0
      && mobileDensity.readyLabels.length === 0 && mobileDensity.largeClusters.length === 0,
    JSON.stringify(mobileDensity));

  const commandBox = await page.locator("[data-touch-command]").boundingBox();
  const wheelBefore = await page.evaluate(() => {
    window.__SF.mission.cooldowns.orbital = 0;
    return window.__SF.commandWheelState();
  });
  const start = { x: commandBox.x + commandBox.width / 2,
    y: commandBox.y + commandBox.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ ...start, id: 1, radiusX: 5, radiusY: 5 }],
  });
  await page.waitForFunction(() => window.__SF.commandWheelState()?.open,
    null, { timeout: 3000 });
  const target = { x: start.x, y: start.y - 132 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove", touchPoints: [{ ...target, id: 1, radiusX: 5, radiusY: 5 }],
  });
  await page.waitForFunction(() => window.__SF.commandWheelState()?.selectedKey === "orbital",
    null, { timeout: 3000 });
  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "mobile-command-wheel.png") });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction((seq) => {
    const state = window.__SF.commandWheelState();
    return state && !state.open && state.dispatchSeq === seq + 1;
  }, wheelBefore?.dispatchSeq || 0, { timeout: 4000 });
  const wheelAfter = await page.evaluate(() => window.__SF.commandWheelState());
  evidence.mobileWheel = { wheelBefore, wheelAfter };
  check("touch hold-drag-release dispatches one wheel command",
    wheelAfter?.dispatchSeq === (wheelBefore?.dispatchSeq || 0) + 1
      && wheelAfter?.lastDispatch?.key === "orbital",
    JSON.stringify(wheelAfter));

  const fireButton = page.locator('[data-touch-action="fire"]');
  await page.evaluate(() => {
    window.__sfTouchSpaceAudit = [];
    window.addEventListener("keydown", (event) => {
      if (event.code !== "Space") return;
      const T = window.__SF;
      window.__sfTouchSpaceAudit.push({
        targetAction: event.target?.dataset?.touchAction || null,
        prevented: event.defaultPrevented,
        keys: [...T.player.input.keys],
        events: T.player.input.state.events.map((entry) => entry.type),
        jumpPressed: T.player.input.state.jumpPressed,
        jump: T.player.input.state.jump,
        action: T.player.action,
        jetRequested: !!T.jetpack.state.requested,
        jetInFlight: !!T.jetpack.state.inFlight,
        shots: T.combat.player.shots,
      });
    });
  });
  const touchSpaceBefore = await page.evaluate(() => ({
    action: window.__SF.player.action,
    firing: window.__SF.player.input.state.firing,
    shots: window.__SF.combat.player.shots,
  }));
  await fireButton.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(80);
  const touchSpaceHeld = await page.evaluate(() => ({
    audit: window.__sfTouchSpaceAudit[0] || null,
    keys: [...window.__SF.player.input.keys],
    events: window.__SF.player.input.state.events.map((entry) => entry.type),
    jumpPressed: window.__SF.player.input.state.jumpPressed,
    jump: window.__SF.player.input.state.jump,
    action: window.__SF.player.action,
    firing: window.__SF.player.input.state.firing,
    jetRequested: !!window.__SF.jetpack.state.requested,
    jetInFlight: !!window.__SF.jetpack.state.inFlight,
    shots: window.__SF.combat.player.shots,
  }));
  await page.keyboard.up("Space");
  await page.waitForTimeout(80);
  const touchSpaceAfter = await page.evaluate(() => ({
    keys: [...window.__SF.player.input.keys],
    events: window.__SF.player.input.state.events.map((entry) => entry.type),
    jumpPressed: window.__SF.player.input.state.jumpPressed,
    jump: window.__SF.player.input.state.jump,
    action: window.__SF.player.action,
    firing: window.__SF.player.input.state.firing,
    jetRequested: !!window.__SF.jetpack.state.requested,
    jetInFlight: !!window.__SF.jetpack.state.inFlight,
    shots: window.__SF.combat.player.shots,
  }));
  evidence.touchSpace = { touchSpaceBefore, touchSpaceHeld, touchSpaceAfter };
  check("focused touch FIRE button Space does not fall through to jump, jet, or vault",
    touchSpaceHeld.audit?.targetAction === "fire"
      && touchSpaceHeld.audit.keys.length === 0 && touchSpaceHeld.audit.events.length === 0
      && !touchSpaceHeld.audit.jumpPressed && !touchSpaceHeld.audit.jump
      && !touchSpaceHeld.audit.action && !touchSpaceHeld.audit.jetRequested
      && !touchSpaceHeld.audit.jetInFlight
      && touchSpaceHeld.keys.length === 0 && touchSpaceHeld.events.length === 0
      && !touchSpaceHeld.jumpPressed && !touchSpaceHeld.jump && !touchSpaceHeld.action
      && !touchSpaceHeld.jetRequested && !touchSpaceHeld.jetInFlight
      && touchSpaceAfter.keys.length === 0 && touchSpaceAfter.events.length === 0
      && !touchSpaceAfter.jumpPressed && !touchSpaceAfter.jump && !touchSpaceAfter.action
      && !touchSpaceAfter.jetRequested && !touchSpaceAfter.jetInFlight
      // Space belongs to the focused FIRE button here. Firing is expected;
      // movement/jump/jet/vault fallthrough is the regression boundary.
      && touchSpaceHeld.firing && !touchSpaceAfter.firing
      && touchSpaceAfter.shots > touchSpaceBefore.shots,
    JSON.stringify({ touchSpaceBefore, touchSpaceHeld, touchSpaceAfter }));

  const fireBox = await fireButton.boundingBox();
  await openMenuWithEscape(page);
  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "mobile-operation-menu.png") });
  const shotsBefore = await page.evaluate(() => window.__SF.combat.player.shots);
  const firePoint = { x: fireBox.x + fireBox.width / 2,
    y: fireBox.y + fireBox.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ ...firePoint, id: 2, radiusX: 5, radiusY: 5 }],
  });
  await page.waitForTimeout(120);
  const touchLeak = await page.evaluate((before) => ({
    before,
    after: window.__SF.combat.player.shots,
    firing: window.__SF.player.input.state.firing,
    touchFiring: window.__SF.player.input.touch.firing,
    menu: window.__SF.menuState(),
    touchInert: !!document.getElementById("sf-touch")?.inert,
    touchHidden: document.getElementById("sf-touch")?.getAttribute("aria-hidden"),
    focusInside: document.getElementById("sf-menu")?.contains(document.activeElement),
  }), shotsBefore);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  evidence.mobileTouchLeak = touchLeak;
  check("paused mobile combat controls cannot leak through the menu",
    touchLeak.after === touchLeak.before && !touchLeak.firing && !touchLeak.touchFiring
      && touchLeak.menu?.open && touchLeak.touchInert,
    JSON.stringify(touchLeak));
  check("mobile operation menu owns focus", touchLeak.focusInside);

  const mobileLayout = await layoutAudit(page);
  evidence.mobileLayout = mobileLayout;
  check("mobile HUD and modal stay inside the safe playfield",
    mobileLayout.offenders.length === 0 && mobileLayout.scrollOverflow <= 2,
    JSON.stringify(mobileLayout));
  await context.close();
}

async function compactDesktopPass(browser) {
  console.log("\n=== COMPACT DESKTOP 1280x720 ===");
  const { context, page } = await preparePage(browser, "desktop-1280x720", {
    viewport: { width: 1280, height: 720 },
  });

  await page.locator(".sf-stage").screenshot({
    path: path.join(OUT, "desktop-1280x720-active-play.png"),
  });
  const compactDensity = await hudDensityAudit(page);
  evidence.compactDesktopDensity = compactDensity;
  check("1280x720 HUD keeps a sparse non-overlapping hierarchy",
    compactDensity.coveragePct <= 11 && compactDensity.overlaps.length === 0
      && compactDensity.readyLabels.length === 0 && compactDensity.largeClusters.length === 0,
    JSON.stringify(compactDensity));
  const active = await layoutAudit(page);
  check("1280x720 active HUD stays inside the playfield",
    active.offenders.length === 0 && active.scrollOverflow <= 2, JSON.stringify(active));

  await page.keyboard.down("Tab");
  await page.waitForFunction(() => window.__SF.commandWheelState()?.open,
    null, { timeout: 3000 });
  const dial = await page.locator(".sf-command-wheel__dial").boundingBox();
  await page.mouse.move(dial.x + dial.width / 2, dial.y + dial.height / 2 - 118,
    { steps: 4 });
  await page.waitForFunction(() => window.__SF.commandWheelState()?.selectedKey === "orbital",
    null, { timeout: 2000 });
  await page.locator(".sf-stage").screenshot({
    path: path.join(OUT, "desktop-1280x720-command-wheel.png"),
  });
  const wheel = await layoutAudit(page);
  check("1280x720 command wheel stays inside the playfield",
    wheel.offenders.length === 0 && wheel.scrollOverflow <= 2, JSON.stringify(wheel));
  await page.keyboard.up("Tab");
  await page.waitForFunction(() => !window.__SF.commandWheelState()?.open,
    null, { timeout: 3000 });

  await openMenuWithEscape(page);
  await page.waitForSelector('#sf-menu[aria-modal="true"]');
  await page.locator(".sf-stage").screenshot({
    path: path.join(OUT, "desktop-1280x720-operation-menu.png"),
  });
  const menu = await layoutAudit(page);
  evidence.compactDesktop = { active, wheel, menu };
  check("1280x720 operation menu stays inside the playfield",
    menu.offenders.length === 0 && menu.scrollOverflow <= 2, JSON.stringify(menu));
  await context.close();
}

async function landscapeTouchPass(browser) {
  console.log("\n=== TOUCH LANDSCAPE 844x390 ===");
  const { context, page } = await preparePage(browser, "touch-844x390", {
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const cdp = await context.newCDPSession(page);
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-touch-command]");
    return button && getComputedStyle(button).display !== "none"
      && button.getBoundingClientRect().width > 0;
  }, null, { timeout: 5000 });

  await page.locator(".sf-stage").screenshot({
    path: path.join(OUT, "touch-844x390-active-play.png"),
  });
  const landscapeDensity = await hudDensityAudit(page);
  evidence.landscapeTouchDensity = landscapeDensity;
  check("short-landscape touch HUD keeps a sparse non-overlapping hierarchy",
    landscapeDensity.coveragePct <= 15 && landscapeDensity.overlaps.length === 0
      && landscapeDensity.readyLabels.length === 0
      && landscapeDensity.largeClusters.length === 0,
    JSON.stringify(landscapeDensity));
  const active = await layoutAudit(page);
  const activeTargets = await touchTargetAudit(page);
  check("844x390 active HUD stays inside the playfield",
    active.offenders.length === 0 && active.scrollOverflow <= 2, JSON.stringify(active));

  const command = await page.locator("[data-touch-command]").boundingBox();
  const origin = { x: command.x + command.width / 2, y: command.y + command.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ ...origin, id: 11, radiusX: 5, radiusY: 5 }],
  });
  await page.waitForFunction(() => window.__SF.commandWheelState()?.open,
    null, { timeout: 3000 });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: origin.x, y: origin.y - 112, id: 11, radiusX: 5, radiusY: 5 }],
  });
  await page.waitForFunction(() => window.__SF.commandWheelState()?.selectedKey === "orbital",
    null, { timeout: 3000 });
  await page.locator(".sf-stage").screenshot({
    path: path.join(OUT, "touch-844x390-command-wheel.png"),
  });
  const wheel = await layoutAudit(page);
  check("844x390 command wheel stays inside the playfield",
    wheel.offenders.length === 0 && wheel.scrollOverflow <= 2, JSON.stringify(wheel));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => !window.__SF.commandWheelState()?.open,
    null, { timeout: 3000 });

  await openMenuWithEscape(page);
  await page.waitForSelector('#sf-menu[aria-modal="true"]');
  await page.locator(".sf-stage").screenshot({
    path: path.join(OUT, "touch-844x390-operation-menu.png"),
  });
  const menu = await layoutAudit(page);
  const menuTargets = await touchTargetAudit(page);
  evidence.landscapeTouch = { active, wheel, menu, activeTargets, menuTargets };
  check("844x390 operation menu stays inside the playfield",
    menu.offenders.length === 0 && menu.scrollOverflow <= 2, JSON.stringify(menu));
  check("844x390 touch targets are at least 44px",
    activeTargets.count > 10 && activeTargets.offenders.length === 0
      && menuTargets.count >= 5 && menuTargets.offenders.length === 0,
    JSON.stringify({ activeTargets, menuTargets }));
  await context.close();
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(OUT, { recursive: true });
  let serverReady = false;
  for (let i = 0; i < 200; i += 1) {
    try {
      if ((await fetch(`${BASE}/games/saintfall.html`)).ok) { serverReady = true; break; }
    } catch (_) { /* retry */ }
    await delay(100);
  }
  if (!serverReady) throw new Error("local Saintfall server did not start");

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  try {
    await embeddedKeyboardPass(browser);
    await desktopPass(browser);
    await mobilePass(browser);
    await compactDesktopPass(browser);
    await landscapeTouchPass(browser);
  } finally {
    await browser.close();
  }

  check("no page errors", diagnostics.pageErrors.length === 0,
    diagnostics.pageErrors.slice(0, 4).join(" | "));
  check("no console errors", diagnostics.consoleErrors.length === 0,
    diagnostics.consoleErrors.slice(0, 4).join(" | "));

  await writeFile(path.join(OUT, "report.json"), JSON.stringify({
    viewportPasses: ["embedded-page-1440x1000", "desktop-1440x900", "mobile-390x844",
      "desktop-1280x720", "touch-844x390"],
    results,
    diagnostics,
    evidence,
  }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
