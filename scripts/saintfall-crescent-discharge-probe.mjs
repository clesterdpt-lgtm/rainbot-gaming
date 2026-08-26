#!/usr/bin/env node
/* ============================================================
   SAINTFALL - White Vigil crescent emitter proof

   Verifies the contract that prompted the replacement asset:
     - both runtime props are the v2 crescent-emitter GLB;
     - their raw sockets and travel axes are on model -Y, the blade;
     - held primary fire alternates hands;
     - every pulse leaves along the live emitter axis;
     - the pulse expires at the level-local short-range budget.
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 46200 + (process.pid % 700);
const base = `http://127.0.0.1:${port}`;
const shotPath = path.join(root, "output/playwright/white-vigil-crescent-probe.png");

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${base}/games/saintfall-white-vigil.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never became ready");
}

const server = startServer();
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto(`${base}/games/saintfall-white-vigil.html?qa=1&character=white-vigil&time=alpenglow&cycle=0`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 120000 });

  const result = await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    T.hideHud(true);
    T.ctx.runtime.paused = true;
    T.poseFigure(Math.PI / 2, { radius: 4.15, fov: 35, eye: 0.62, aim: 0.58 });
    T.setFiring(false);
    T.advanceTime(0.45, 1 / 120);
    const idle = T.summit.loadoutState();

    T.setFiring(true);
    T.advanceTime(0.50, 1 / 120);
    const firing = T.summit.loadoutState();
    const discharge = T.summit.dischargeState();
    T.renderOnce();

    const raw = T.ctx.playerLoadout.parts.map((part) => ({
      id: part.spec.id,
      file: part.spec.file,
      emitter: part.spec.emitter,
      axis: part.spec.emitterAxis,
    }));
    const rows = discharge.recentShots.slice(-3).map((shot) => {
      const live = firing.parts.find((part) => part.hand === shot.hand);
      const dot = shot.direction.reduce((sum, value, i) => (
        sum + value * live.emitterDirection[i]
      ), 0);
      return {
        hand: shot.hand,
        alignment: Number(Math.max(-1, Math.min(1, dot)).toFixed(4)),
      };
    });

    T.setFiring(false);
    return { raw, idle, firing, discharge, rows };
  });

  await mkdir(path.dirname(shotPath), { recursive: true });
  await page.screenshot({ path: shotPath });
  result.expired = await page.evaluate(() => {
    window.__SF.advanceTime(0.90, 1 / 120);
    return window.__SF.summit.dischargeState();
  });

  const failures = [];
  if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.join(" | ")}`);
  if (result.raw.length !== 2) failures.push(`expected 2 hybrid props, got ${result.raw.length}`);
  for (const part of result.raw) {
    if (part.file !== "white-vigil-crescent-emitter.glb") {
      failures.push(`${part.id} loaded ${part.file}`);
    }
    if (JSON.stringify(part.axis) !== JSON.stringify([0, -1, 0])) {
      failures.push(`${part.id} emitter axis is ${JSON.stringify(part.axis)}`);
    }
    if (!Array.isArray(part.emitter) || !(part.emitter[1] < 0)) {
      failures.push(`${part.id} emitter is not on blade-side -Y`);
    }
  }
  for (const part of result.idle.parts) {
    if (part.gripErrorM !== 0) failures.push(`${part.id} grip drift ${part.gripErrorM}m`);
  }
  const hands = result.discharge.recentShots.slice(-3).map((shot) => shot.hand).join(",");
  if (hands !== "left,right,left") failures.push(`unexpected alternation ${hands || "none"}`);
  if (result.rows.some((row) => row.alignment < 0.98)) {
    failures.push(`blade/projectile alignment ${JSON.stringify(result.rows)}`);
  }
  if (result.discharge.rangeM !== 10) failures.push(`range is ${result.discharge.rangeM}m`);
  if (result.expired.active !== 0) failures.push(`${result.expired.active} pulse(s) survived range expiry`);

  console.log(JSON.stringify({
    passed: failures.length === 0,
    models: result.raw.map((part) => part.file),
    axes: result.raw.map((part) => part.axis),
    hands,
    alignment: result.rows,
    rangeM: result.discharge.rangeM,
    expiredActive: result.expired.active,
    gripErrorsM: result.idle.parts.map((part) => part.gripErrorM),
    screenshot: path.relative(root, shotPath),
    consoleErrors,
    failures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
