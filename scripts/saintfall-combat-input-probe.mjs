#!/usr/bin/env node
/* Focused browser acceptance for Executioner's Thrust and Furnace Lance. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 58400 + (process.pid % 1000);
const url = `http://127.0.0.1:${port}/games/saintfall.html?qa=1&intro=skip&quality=low&seed=combat-input-v1`;
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

async function invoke(page, method, ...args) {
  return page.evaluate(([name, values]) => window.__SF[name](...values), [method, args]);
}

async function maxProgression(page, orderId) {
  await invoke(page, "resetProgressionForQA");
  const definitions = await invoke(page, "progressionDefinitions");
  const fieldRank = definitions.fieldRank || definitions.config?.fieldRank;
  await invoke(page, "grantProgressionXpForQA",
    fieldRank.xpThresholds[fieldRank.cap - 1], `qa:combat-input:${orderId}`);
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
  await invoke(page, "maximize");

  /* Rank 2 Executioner's Thrust: two points establish the Procession gate,
     then two ranks buy the talent itself. */
  await maxProgression(page, "procession");
  for (const id of [
    "procession_hooking_step", "procession_hooking_step",
    "procession_executioners_measure", "procession_executioners_measure",
  ]) await invoke(page, "spendTalentForQA", id);

  const executioner = await page.evaluate(async () => {
    const T = window.__SF;
    T.clearEnemies();
    T.autoStow(false);
    T.weapons.setMode("ranged");
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
    T.player.state.grounded = true;
    T.weapons.carry.stow = 1;
    T.weapons.carry.stowWant = 1;
    T.renderStill();
    return {
      rank: T.progression.rank("procession_executioners_measure"),
      fuelBefore: T.jetpack.state.fuel,
      stowBefore: T.weapons.stowPhase,
    };
  });
  await page.keyboard.down("KeyF");
  const thrustTrace = await page.evaluate(() => {
    const T = window.__SF;
    const trace = [];
    for (let frame = 0; frame < 120; frame += 1) {
      T.renderOnce(1 / 120);
      if (T.player.action === "meleePierce") {
        trace.push({
          frame,
          action: T.player.action,
          fuel: T.jetpack.state.fuel,
          stow: Number(T.weapons.stowPhase.toFixed(3)),
        });
        break;
      }
    }
    return trace;
  });
  await page.keyboard.up("KeyF");
  await invoke(page, "advanceTime", 0.8, 1 / 120);
  const executionerAfter = await page.evaluate(() => ({
    fuel: window.__SF.jetpack.state.fuel,
    meleeHeld: window.__SF.player.input.state.meleeHeld,
  }));
  check("holding F activates Executioner's Thrust from a fully stowed lance",
    executioner.rank === 2 && executioner.stowBefore >= 0.99
      && thrustTrace.length === 1 && thrustTrace[0].action === "meleePierce",
    { executioner, thrustTrace, executionerAfter });
  check("Executioner's Thrust spends its 15 Reliquary charge once",
    Math.abs(thrustTrace[0]?.fuel - 85) < 0.01,
    { fuelBefore: executioner.fuelBefore, activation: thrustTrace[0] });

  /* Rank 2 Furnace Lance: four Censer points open tier 3, then two ranks
     buy the alternate-fire rite. */
  await maxProgression(page, "censer");
  for (const id of [
    "censer_rite_of_censure", "censer_rite_of_censure",
    "censer_ashen_rebuke", "censer_ashen_rebuke",
    "censer_furnace_reprieve", "censer_furnace_reprieve",
  ]) await invoke(page, "spendTalentForQA", id);
  await page.evaluate(() => {
    const T = window.__SF;
    T.autoStow(false);
    T.weapons.setMode("ranged");
    T.weapons.carry.stow = 0;
    T.weapons.carry.stowWant = 0;
    T.weapons.setHeat(0, { reason: "qa-combat-input" });
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
    T.renderOnce(1 / 60);
  });

  const volley = await page.evaluate(() => {
    const T = window.__SF;
    const before = { shots: T.combat.player.shots, fuel: T.jetpack.state.fuel };
    T.setFiring(true);
    T.advanceTime(0.62, 1 / 120);
    T.setFiring(false);
    T.renderOnce(1 / 60);
    return {
      before,
      shots: T.combat.player.shots,
      fuel: T.jetpack.state.fuel,
      furnace: T.weapons.furnaceChargeState(),
    };
  });
  check("holding primary fire remains automatic Volley fire",
    volley.shots - volley.before.shots >= 4
      && volley.fuel === volley.before.fuel && !volley.furnace.charging,
    volley);

  const shotsBeforeEarly = await page.evaluate(() => window.__SF.combat.player.shots);
  const fuelBeforeEarly = await page.evaluate(() => window.__SF.jetpack.state.fuel);
  await page.keyboard.down("KeyG");
  const earlyCharge = await page.evaluate(() => {
    const T = window.__SF;
    T.advanceTime(0.42, 1 / 120);
    return { charge: T.weapons.furnaceChargeState(), reticle: T.reticleState() };
  });
  await page.keyboard.up("KeyG");
  await invoke(page, "renderOnce", 1 / 60);
  const earlyAfter = await page.evaluate(() => ({
    shots: window.__SF.combat.player.shots,
    fuel: window.__SF.jetpack.state.fuel,
    charge: window.__SF.weapons.furnaceChargeState(),
  }));
  check("releasing Furnace Lance early cancels without firing or spending charge",
    earlyCharge.charge.progress > 0.3 && earlyCharge.charge.progress < 0.6
      && earlyAfter.shots === shotsBeforeEarly && earlyAfter.fuel === fuelBeforeEarly
      && !earlyAfter.charge.charging,
    { earlyCharge, earlyAfter });

  const shotsBeforeFull = earlyAfter.shots;
  const fuelBeforeFull = earlyAfter.fuel;
  await page.keyboard.down("KeyG");
  const fullCharge = await page.evaluate(() => {
    const T = window.__SF;
    T.advanceTime(1.12, 1 / 120);
    return {
      shots: T.combat.player.shots,
      fuel: T.jetpack.state.fuel,
      charge: T.weapons.furnaceChargeState(),
      reticle: T.reticleState(),
    };
  });
  check("a full Furnace Lance charge waits for release",
    fullCharge.charge.ready && fullCharge.shots === shotsBeforeFull
      && fullCharge.fuel === fuelBeforeFull && fullCharge.reticle.furnaceReady,
    fullCharge);
  await page.keyboard.up("KeyG");
  await invoke(page, "renderOnce", 1 / 60);
  const fullAfter = await page.evaluate(() => ({
    shots: window.__SF.combat.player.shots,
    fuel: window.__SF.jetpack.state.fuel,
    charge: window.__SF.weapons.furnaceChargeState(),
  }));
  check("releasing a full rank-2 Furnace Lance fires once for 20 charge",
    fullAfter.shots === shotsBeforeFull + 1
      && Math.abs(fullAfter.fuel - (fuelBeforeFull - 20)) < 0.01
      && !fullAfter.charge.charging,
    { before: { shotsBeforeFull, fuelBeforeFull }, fullAfter });

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

console.log(JSON.stringify({ passed: results.filter((result) => result.ok).length, failed, results }, null, 2));
process.exitCode = failed ? 1 : 0;
