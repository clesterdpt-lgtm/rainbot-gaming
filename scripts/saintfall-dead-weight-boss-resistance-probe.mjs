#!/usr/bin/env node
/* Focused browser acceptance for Torren's boss-only Dead Weight resistance. */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 59900 + (process.pid % 80);
const url = `http://127.0.0.1:${port}/games/saintfall.html?qa=1&intro=0&quality=low&character=bastion-penitent&seed=dead-weight-resistance-v1`;
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

function closeTo(actual, expected, tolerance = 0.015) {
  return Math.abs(actual - expected) <= tolerance;
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
  await page.waitForFunction(() => window.__SF?.isReady?.()
    && window.__SF?.progression?.state?.(), null, { timeout: 300000 });

  const report = await page.evaluate(() => {
    const T = window.__SF;
    const doctrine = T.progression;
    doctrine.resetCareer({ source: "qa" });
    doctrine.grantXp(99999, null, "qa");
    for (const id of [
      "anvil_dead_weight", "anvil_dead_weight",
      "anvil_measured_swing", "anvil_measured_swing",
      "anvil_shatterpoint", "anvil_shatterpoint",
    ]) doctrine.spend(id);

    const makeTarget = (key) => ({
      id: `qa-${key}`,
      key,
      state: "idle",
      stunTime: 0,
      health: 5000,
      maxHealth: 5000,
      x: T.player.state.x + 3,
      y: T.player.state.y,
      z: T.player.state.z,
      spec: { selfDriven: key === "apostate" },
      actions: new Map(),
      current: null,
      alerted: true,
      suspicion: 1,
    });

    const cues = [];
    const stop = doctrine.bus.on("doctrine", (event) => cues.push({
      cue: event.cue, stage: event.stage, talentId: event.talentId,
    }));

    const ordinary = makeTarget("thresher");
    doctrine.verb("hammerHit", {
      inst: ordinary, x: ordinary.x, y: ordinary.y, z: ordinary.z,
    });
    const ordinaryFirst = ordinary.stunTime;
    ordinary.stunTime = 0;
    doctrine.verb("hammerHit", {
      inst: ordinary, x: ordinary.x, y: ordinary.y, z: ordinary.z,
    });
    const ordinarySecond = ordinary.stunTime;

    const boss = makeTarget("apostate");
    doctrine.verb("hammerHit", { inst: boss, x: boss.x, y: boss.y, z: boss.z });
    const firstBossStun = boss.stunTime;
    const firstStatus = doctrine.deadWeightStatus(boss);

    boss.stunTime = 0;
    doctrine.verb("hammerHit", { inst: boss, x: boss.x, y: boss.y, z: boss.z });
    const resistedBossStun = boss.stunTime;
    const resistedStatus = doctrine.deadWeightStatus(boss);

    const healthBeforeShatterpoint = boss.health;
    T.combat.bus.emit("melee", {
      hits: 1, comboStep: 2, targets: [{ inst: boss }],
      x: boss.x, y: boss.y, z: boss.z,
    });
    const shatterpointDamage = healthBeforeShatterpoint - boss.health;

    T.advanceTime(1.6, 1 / 60);
    const afterVulnerability = doctrine.deadWeightStatus(boss);
    T.advanceTime(1.0, 1 / 60);
    boss.stunTime = 0;
    doctrine.verb("hammerHit", { inst: boss, x: boss.x, y: boss.y, z: boss.z });
    const recoveredBossStun = boss.stunTime;
    const recoveredStatus = doctrine.deadWeightStatus(boss);
    stop?.();

    return {
      ranks: {
        deadWeight: doctrine.rank("anvil_dead_weight"),
        shatterpoint: doctrine.rank("anvil_shatterpoint"),
      },
      ordinaryFirst,
      ordinarySecond,
      firstBossStun,
      firstStatus,
      resistedBossStun,
      resistedStatus,
      shatterpointDamage,
      afterVulnerability,
      recoveredBossStun,
      recoveredStatus,
      cues,
    };
  });

  check("rank-two Dead Weight keeps the full ordinary-enemy stagger",
    report.ranks.deadWeight === 2
      && closeTo(report.ordinaryFirst, 0.85) && closeTo(report.ordinarySecond, 0.85),
    report);
  check("a boss yields to the first hit for only 0.40 seconds",
    closeTo(report.firstBossStun, 0.40)
      && report.firstStatus.braced && report.firstStatus.offBalance
      && closeTo(report.firstStatus.lockRemaining, 2.5),
    report.firstStatus);
  check("repeated Dead Weight cannot refresh a boss stagger",
    report.resistedBossStun === 0 && report.resistedStatus.staggers === 1
      && report.resistedStatus.resisted === 1
      && report.cues.some((cue) => cue.cue === "brace" && cue.stage === "resist"),
    { resistedBossStun: report.resistedBossStun, status: report.resistedStatus,
      cues: report.cues });
  check("Shatterpoint still consumes the separate off-balance damage window",
    report.ranks.shatterpoint === 2 && report.shatterpointDamage > 0,
    { damage: report.shatterpointDamage, status: report.resistedStatus });
  check("off-balance ends before the boss stagger lockout",
    !report.afterVulnerability.offBalance && report.afterVulnerability.braced
      && report.afterVulnerability.lockRemaining > 0.7,
    report.afterVulnerability);
  check("Dead Weight can interrupt the boss again after resistance expires",
    closeTo(report.recoveredBossStun, 0.40)
      && report.recoveredStatus.staggers === 2,
    report.recoveredStatus);
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
