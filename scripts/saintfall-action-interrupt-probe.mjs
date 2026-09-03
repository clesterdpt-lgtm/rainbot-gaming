#!/usr/bin/env node
/* Focused browser acceptance for responsive melee action transitions. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 59600 + (process.pid % 300);
const url = `http://127.0.0.1:${port}/games/saintfall.html?qa=1&intro=skip&quality=low&seed=action-interrupt-v1`;
const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
});

const results = [];
let failed = 0;
function check(name, ok, detail = null) {
  const pass = !!ok;
  results.push({ name, ok: pass, detail });
  if (!pass) failed += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${JSON.stringify(detail)}` : ""}`);
}

let browser;
try {
  await delay(350);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 180000 });
  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    T.clearEnemies();
    T.autoStow(false);
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
  });

  const block = await page.evaluate(() => {
    const T = window.__SF;
    T.player.cancelTransientActions();
    T.player.state.grounded = true;
    T.player.beginAction("melee1");
    T.advanceTime(0.20, 1 / 120);
    const before = { action: T.player.action, t: T.player.actionState.t };
    T.player.input.setTouchHold("block", true);
    T.renderOnce(1 / 120);
    const after = {
      action: T.player.action,
      shield: T.shield.status(),
      grounded: T.player.state.grounded,
    };
    T.player.input.setTouchHold("block", false);
    T.renderOnce(1 / 120);
    return { before, after };
  });
  check("guard cancels an in-progress melee in the same frame",
    block.before.action === "melee1" && block.after.action === null
      && block.after.shield.active && block.after.shield.lastReason === "blocking",
    block);

  const jump = await page.evaluate(() => {
    const T = window.__SF;
    T.player.cancelTransientActions();
    T.player.state.grounded = true;
    T.player.state.vy = 0;
    T.player.beginAction("melee1");
    T.advanceTime(0.20, 1 / 120);
    const before = { action: T.player.action, t: T.player.actionState.t };
    T.player.input.pressTouch("jump");
    T.renderOnce(1 / 120);
    return {
      before,
      after: {
        action: T.player.action,
        grounded: T.player.state.grounded,
        vy: T.player.state.vy,
      },
    };
  });
  check("vault cancels an in-progress melee in the same frame",
    jump.before.action === "melee1" && jump.after.action === null
      && !jump.after.grounded && jump.after.vy > 9,
    jump);

  const combo = await page.evaluate(() => {
    const T = window.__SF;
    T.player.cancelTransientActions();
    T.player.state.grounded = true;
    T.player.state.vy = 0;
    T.weapons.setMode("melee");
    T.player.meleeSwing(T.player.state.yaw);
    T.advanceTime(0.20, 1 / 120);
    T.player.meleeSwing(T.player.state.yaw);
    const queuedAt = T.player.actionState.t;
    let transitionAt = null;
    for (let i = 0; i < 100; i += 1) {
      T.renderOnce(1 / 120);
      if (T.player.action === "melee2") {
        transitionAt = queuedAt + (i + 1) / 120;
        break;
      }
    }
    return {
      queuedAt,
      transitionAt,
      firstDuration: T.actionDuration("melee1"),
      firstHitEnd: T.player.actionSpec("melee1").hit[1],
      action: T.player.action,
    };
  });
  check("buffered melee starts after the hit window instead of full recovery",
    combo.action === "melee2" && combo.transitionAt >= combo.firstHitEnd
      && combo.transitionAt < combo.firstDuration - 0.15,
    combo);

  const heldFire = await page.evaluate(() => {
    const T = window.__SF;
    T.player.cancelTransientActions();
    T.weapons.setMode("ranged");
    T.setFiring(true);
    T.advanceTime(0.45, 1 / 120);
    T.setFiring(false);
    return { action: T.player.action, mode: T.weapons.current?.spec?.melee ? "melee" : "ranged" };
  });
  check("held primary fire still cannot chain a melee action",
    heldFire.action === null && heldFire.mode === "ranged", heldFire);

  check("focused browser run has no page or console errors",
    pageErrors.length === 0 && consoleErrors.length === 0,
    { pageErrors, consoleErrors });
} catch (error) {
  failed += 1;
  console.error(error.stack || error.message || error);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

console.log(JSON.stringify({
  passed: results.filter((result) => result.ok).length,
  failed,
  results,
}, null, 2));
process.exitCode = failed ? 1 : 0;
