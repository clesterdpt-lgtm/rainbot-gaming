#!/usr/bin/env node
/* Focused end-to-end proof for Saintfall's guard readability contract.

   It checks the shared timing data, directional and unblockable outcomes,
   simultaneous ordinary-enemy spacing, desktop/touch presentation, and
   captures the two decisive visual states.
*/

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean)
  .map((part) => part.trim().split(/\s+/)).map(([key, value]) => [key, value ?? true]));
const out = path.resolve(root, args.out || "output/saintfall/block-readability");
const port = 53600 + (process.pid % 900);
const base = `http://127.0.0.1:${port}`;
const results = [];
const diagnostics = { consoleErrors: [], pageErrors: [], networkErrors: [] };

function check(name, pass, actual, expected) {
  const entry = { name, pass: !!pass, actual, expected };
  results.push(entry);
  console.log(`${entry.pass ? "PASS" : "FAIL"} ${name}`);
  if (!entry.pass) console.log(`  actual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      if ((await fetch(`${base}/games/saintfall.html`, { cache: "no-store" })).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local Saintfall server did not start");
}

function attachDiagnostics(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(`${label}: ${message.text()}`);
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
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
}

const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root, stdio: "ignore",
});

let browser;
try {
  await waitForServer();
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  attachDiagnostics(page, "desktop");
  await gotoReady(page, "qa=1&intro=skip&tutorial=skip&touch=0&quality=low&seed=guard-readability");

  const shared = await page.evaluate(() => ({
    shieldWindow: window.__SF.shieldState().perfectWindow,
    cueWindow: window.__SF.guardReadability.config.perfectWindow,
    minImpactSpacing: window.__SF.strikeState().config.minImpactSpacing,
  }));
  check("shield, cue, and enemy cadence share one 250ms timing contract",
    shared.shieldWindow === 0.25 && shared.cueWindow === 0.25
      && shared.minImpactSpacing === 0.15,
    shared, { shieldWindow: 0.25, cueWindow: 0.25, minImpactSpacing: 0.15 });

  const frontal = await page.evaluate(() => {
    window.__SF.previewGuardCue({ impactIn: 1.1, guardType: "frontal" });
    window.__SF.renderStill();
    const early = {
      threat: window.__SF.guardThreatState().primary,
      hud: window.__SF.guardCueState(),
    };
    window.__SF.advanceTime(0.87, 1 / 120);
    window.__SF.renderStill();
    const ready = {
      threat: window.__SF.guardThreatState().primary,
      hud: window.__SF.guardCueState(),
      colour: getComputedStyle(document.getElementById("sf-guard-cue")).color,
      shieldDisplay: getComputedStyle(document.getElementById("sf-shield")).display,
    };
    window.__SF.freezeGuardCue(true);
    return { early, ready };
  });
  check("amber wind-up contracts into the final gold GUARD window",
    frontal.early.hud.state === "windup" && frontal.early.hud.label === "GUARD"
      && frontal.ready.hud.state === "ready" && frontal.ready.threat.ready
      && frontal.ready.threat.remaining <= 0.25,
    frontal, "windup -> ready at <= 0.25 seconds");
  check("compact Aegis readiness is visible during play",
    frontal.ready.shieldDisplay !== "none", frontal.ready.shieldDisplay, "not none");
  await page.screenshot({ path: path.join(out, "desktop-guard-ready.png") });
  await page.evaluate(() => window.__SF.freezeGuardCue(false));

  const outcomes = await page.evaluate(() => {
    window.__SF.resolveGuardCue("guard-training");
    window.__SF.clearEnemies();
    window.__SF.teleport(0, 0, 0);
    const damage = window.__SF.combat;
    const hold = (seconds) => {
      window.__SF.setShieldInput(true);
      window.__SF.advanceTime(seconds, 1 / 120);
    };
    const release = () => {
      window.__SF.setShieldInput(false);
      window.__SF.advanceTime(0.05, 1 / 120);
      damage.player.hp = damage.player.maxHp;
    };

    hold(1 / 120);
    const beforePerfect = window.__SF.shieldState().blocks;
    const perfectDamage = damage.hurtPlayer(20, {
      source: "qa-frontal", x: 0, y: 1, z: 0,
      originX: 0, originY: 1, originZ: 6, guardType: "frontal",
    });
    const perfect = window.__SF.shieldState();
    release();

    hold(0.34);
    const normalDamage = damage.hurtPlayer(20, {
      source: "qa-frontal", x: 0, y: 1, z: 0,
      originX: 0, originY: 1, originZ: 6, guardType: "frontal",
    });
    const normal = window.__SF.shieldState();
    release();

    hold(1 / 120);
    const unblockableDamage = damage.hurtPlayer(20, {
      source: "qa-slam", x: 0, y: 1, z: 0,
      originX: 0, originY: 1, originZ: 6, guardType: "unblockable",
    });
    const unblockable = window.__SF.shieldState();
    release();

    hold(1 / 120);
    const rearDamage = damage.hurtPlayer(20, {
      source: "qa-rear", x: 0, y: 1, z: 0,
      originX: 0, originY: 1, originZ: -6, guardType: "frontal",
    });
    const rear = window.__SF.shieldState();
    release();

    return { beforePerfect, perfectDamage, perfect, normalDamage, normal,
      unblockableDamage, unblockable, rearDamage, rear };
  });
  check("front-facing Aegis blocks and grades perfect versus early holds",
    outcomes.perfectDamage === 0 && outcomes.perfect.blocks === outcomes.beforePerfect + 1
      && outcomes.perfect.lastPerfect && outcomes.normalDamage === 0
      && !outcomes.normal.lastPerfect,
    outcomes, "perfect and normal blocks both absorb; only final-window hold is perfect");
  check("unblockable and rear contacts reject Aegis with an explicit reason",
    outcomes.unblockableDamage > 0 && outcomes.unblockable.lastAttempt?.reason === "unblockable"
      && outcomes.rearDamage > 0 && outcomes.rear.lastAttempt?.reason === "angle",
    outcomes, { unblockable: "unblockable", rear: "angle" });

  const bossCues = await page.evaluate(() => {
    const clear = () => {
      for (const threat of window.__SF.guardThreatState().active) {
        window.__SF.resolveGuardCue(threat.id, { reason: "qa-reset" });
      }
    };
    clear();
    const mat = window.__SF.matriarch.instances()[0];
    window.__SF.matriarch.force("combo", mat);
    window.__SF.renderStill();
    const combo = window.__SF.guardThreatState().primary;
    clear();
    window.__SF.matriarch.force("grab", mat);
    window.__SF.renderStill();
    const grab = window.__SF.guardThreatState().primary;
    clear();
    window.__SF.abbess.forcePhase("hunt", 1);
    window.__SF.abbess.forceBite();
    window.__SF.renderStill();
    const bite = window.__SF.guardThreatState().primary;
    clear();
    window.__SF.abbess.forceSlam();
    window.__SF.renderStill();
    const slam = window.__SF.guardThreatState().primary;
    clear();
    return { combo, grab, bite, slam };
  });
  check("boss tells declare guardable bites/swings and dodge-only grabs/slams",
    bossCues.combo?.guardType === "frontal" && bossCues.combo.remaining >= 0.54
      && bossCues.grab?.guardType === "unblockable"
      && bossCues.bite?.guardType === "frontal"
      && bossCues.slam?.guardType === "unblockable",
    bossCues, { combo: "frontal", grab: "unblockable", bite: "frontal", slam: "unblockable" });

  const spacing = await page.evaluate(() => {
    window.__SF.clearEnemies();
    window.__SF.teleport(0, 0, 0);
    const a = window.__SF.enemies.spawn("thresher", -0.6, 2.0, { eventId: "qa-spacing" });
    const b = window.__SF.enemies.spawn("thresher", 0.6, 2.0, { eventId: "qa-spacing" });
    for (const enemy of [a, b]) {
      enemy.alerted = true;
      enemy.suspicion = 1;
      enemy.fireTimer = 0;
      enemy.inReach = true;
    }
    window.__SF.advanceTime(0.08, 1 / 120);
    const active = window.__SF.strikeState().active.map((strike) => strike.windup).sort((x, y) => x - y);
    return { active, gap: active.length > 1 ? active[1] - active[0] : 0 };
  });
  check("simultaneous ordinary melee contacts are separated by at least 150ms",
    spacing.active.length === 2 && spacing.gap >= 0.149,
    spacing, { active: 2, gap: ">= 0.15" });

  const touchAegis = await page.evaluate(() => {
    window.__SF.clearEnemies();
    window.__SF.touch.setEnabled(true);
    window.__SF.setShieldInput(false);
    window.__SF.advanceTime(0.05, 1 / 120);
    window.__SF.setShieldInput(true);
    window.__SF.advanceTime(1 / 120, 1 / 120);
    const timed = document.querySelector('[data-touch-action="shield"]')?.dataset.state;
    window.__SF.advanceTime(0.3, 1 / 120);
    const held = document.querySelector('[data-touch-action="shield"]')?.dataset.state;
    window.__SF.setShieldInput(false);
    window.__SF.advanceTime(0.05, 1 / 120);
    return { timed, held, enabled: window.__SF.touchState().enabled };
  });
  check("touch Aegis distinguishes the perfect beat from an early hold",
    touchAegis.enabled && touchAegis.timed === "timed" && touchAegis.held === "active",
    touchAegis, { enabled: true, timed: "timed", held: "active" });

  await page.setViewportSize({ width: 390, height: 844 });
  const dodge = await page.evaluate(() => {
    window.__SF.abbess.resetToSeat();
    window.__SF.advanceTime(6, 1 / 60);
    window.__SF.clearEnemies();
    for (const threat of window.__SF.guardThreatState().active) {
      window.__SF.resolveGuardCue(threat.id, { reason: "qa-reset" });
    }
    window.__SF.previewGuardCue({ impactIn: 0.22, guardType: "unblockable" });
    window.__SF.renderStill();
    window.__SF.freezeGuardCue(true);
    const cue = document.getElementById("sf-guard-cue");
    const rect = cue.getBoundingClientRect();
    const stage = document.querySelector(".sf-stage").getBoundingClientRect();
    return {
      hud: window.__SF.guardCueState(),
      colour: getComputedStyle(cue).color,
      contained: rect.left >= stage.left && rect.top >= stage.top
        && rect.right <= stage.right && rect.bottom <= stage.bottom,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    };
  });
  check("portrait crimson state says DODGE and stays inside the play space",
    dodge.hud.guardType === "unblockable" && dodge.hud.label === "DODGE"
      && dodge.contained && dodge.overflow <= 1,
    dodge, { guardType: "unblockable", label: "DODGE", contained: true, overflow: 0 });
  await page.screenshot({ path: path.join(out, "portrait-unblockable-dodge.png") });
  await page.evaluate(() => window.__SF.freezeGuardCue(false));

  check("browser and same-origin diagnostics remain clean",
    diagnostics.consoleErrors.length === 0 && diagnostics.pageErrors.length === 0
      && diagnostics.networkErrors.length === 0,
    diagnostics, { consoleErrors: [], pageErrors: [], networkErrors: [] });
  await context.close();
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

const report = {
  generatedAt: new Date().toISOString(), url: base, checks: results,
  passed: results.filter((entry) => entry.pass).length,
  failed: results.filter((entry) => !entry.pass).length,
  diagnostics,
};
await writeFile(path.join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`\n${report.passed}/${results.length} checks passed`);
if (report.failed) process.exitCode = 1;
