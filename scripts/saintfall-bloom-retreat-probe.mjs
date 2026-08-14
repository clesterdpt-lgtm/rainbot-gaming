#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Bloom pacing, retreat, and boss-arena probe

   Usage: node scripts/saintfall-bloom-retreat-probe.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 54800 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const failures = [];
let checks = 0;
function check(ok, label, detail = "") {
  checks += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) failures.push(label);
}

let browser;
try {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 960, height: 640 } })).newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/jsdelivr|unpkg|gstatic|googleapis/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=low&intro=skip&seed=bloom-retreat`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  const result = await page.evaluate(() => {
    const T = window.__SF;
    const B = T.ctx.breaches;
    T.invulnerable(true);
    T.setBreachAuto(true);
    T.teleport(-520, -560, 0);

    const initial = B.status();
    B.update(179);
    const beforeThreeMinutes = B.status();
    // Travelling hundreds of metres no longer skips the opening timer.
    T.teleport(-300, -300, 0);
    B.update(0.5);
    const afterLongMove = B.status();
    B.update(0.6);
    const opened = B.status();

    // Surface the first wave, damage one member, then outrun the event.
    B.update(B.config.warningSeconds + 0.01);
    const hurt = B.members[0];
    hurt.health = Math.max(1, hurt.maxHealth * 0.43);
    const preservedHealth = hurt.health;
    const oldCentre = { x: B.state.x, z: B.state.z };
    T.teleport(oldCentre.x + B.config.eventRadius + 80, oldCentre.z, 0);
    B.update(B.config.retreatGraceSeconds + 0.01);
    const retreated = B.status();
    const liveAfterRetreat = B.members.length;

    // The same roster resurfaces by the player with its damage retained.
    B.state.timer = 0;
    B.update(0.01);
    const resurfaced = B.status();
    const healthAfterReturn = Math.min(...B.members.map((inst) => inst.health));
    const returnDistance = Math.hypot(B.state.x - T.playerState().x,
      B.state.z - T.playerState().z);

    // Entering the undefeated Glass Scar makes the returned wave submerge.
    B.update(B.config.warningSeconds + 0.01);
    const distaff = T.ctx.distaff;
    const lair = distaff.config;
    B.members[0].x = lair.lairX;
    B.members[0].z = lair.lairZ;
    B.update(0.05);
    const enemyBoundaryBlocked = B.status();
    B.state.timer = 0;
    B.update(0.05);
    B.update(B.config.warningSeconds + 0.01);
    T.teleport(lair.lairX, lair.lairZ, 0);
    B.update(0.05);
    const bossBlocked = B.status();
    T.releaseCamera();
    const recoverySaveReason = T.ctx.saves.saveReason();
    const recoverySave = T.saveSlot(0);
    const recoveryLoaded = T.loadSlot(0);
    const restoredRecovery = B.status();
    B.state.timer = 0;
    B.update(0.05);
    const heldAtBoundary = B.status();

    // Once the arena boss is authoritatively dead, resurfacing is allowed.
    const boss = distaff.instance();
    boss.health = 0;
    boss.state = "death";
    distaff.update(0.05);
    B.update(0.05);
    const afterBossDefeat = B.status();

    // The second district boss owns the Censer Works by the same rule.
    B.update(B.config.warningSeconds + 0.01);
    const censer = T.ctx.districts.censer;
    T.teleport(censer.x, censer.z, 0);
    B.update(0.05);
    const winnowerBlocked = B.status();
    B.state.timer = 0;
    T.teleport(-520, -560, 0);
    T.releaseCamera();
    B.update(0.05);

    // Clearing an ordinary wave now grants the longer inter-wave window.
    B.update(B.config.warningSeconds + 0.01);
    for (const inst of [...B.members]) T.ctx.enemies.remove(inst);
    B.update(0.05);
    const intermission = B.status();

    return {
      config: B.config,
      initial,
      beforeThreeMinutes,
      afterLongMove,
      opened,
      preservedHealth,
      retreated,
      liveAfterRetreat,
      resurfaced,
      healthAfterReturn,
      returnDistance,
      enemyBoundaryBlocked,
      bossBlocked,
      recoverySaveReason,
      recoverySave: recoverySave?.breaches || null,
      recoveryLoaded,
      restoredRecovery,
      heldAtBoundary,
      afterBossDefeat,
      winnowerBlocked,
      intermission,
    };
  });

  console.log("\n=== PACING ===");
  check(result.config.firstWarningAfter === 180,
    "the first Bloom warning waits three in-game minutes",
    `${result.config.firstWarningAfter}s`);
  check(result.beforeThreeMinutes.phase === "dormant"
      && result.afterLongMove.phase === "dormant",
    "movement cannot trigger the first wave early",
    `before=${result.beforeThreeMinutes.phase} after move=${result.afterLongMove.phase}`);
  check(result.opened.phase === "warning" && result.opened.wave === 1,
    "the first wave opens when the timer expires");

  console.log("\n=== RETREAT ===");
  check(result.retreated.phase === "intermission" && result.retreated.recovering,
    "an escaped wave goes underground",
    JSON.stringify({ timer: result.retreated.timer, buried: result.retreated.buried.length }));
  check(result.liveAfterRetreat === 0 && result.retreated.buried.length === 4,
    "submerged wave members leave combat");
  check(result.resurfaced.phase === "warning" && result.resurfaced.wave === 1,
    "the same wave warns and resurfaces near the player");
  check(Math.abs(result.healthAfterReturn - result.preservedHealth) < 0.01,
    "resurfacing preserves remaining enemy health",
    `${result.preservedHealth.toFixed(2)} -> ${result.healthAfterReturn.toFixed(2)}`);
  check(result.returnDistance >= result.config.spawnDistanceMin - 2
      && result.returnDistance <= result.config.spawnDistanceMax + 2,
    "the returning wave relocates to the player",
    `${result.returnDistance.toFixed(1)}m`);

  console.log("\n=== BOSS ARENA ===");
  check(result.enemyBoundaryBlocked.recovering
      && result.enemyBoundaryBlocked.blockedByBoss === null,
    "a pursuing enemy cannot cut across an undefeated boss arena");
  check(result.bossBlocked.recovering && result.bossBlocked.blockedByBoss === "scar",
    "an undefeated boss arena forces the Bloom underground");
  check(result.recoveryLoaded && result.recoverySave?.recovering
      && result.restoredRecovery.recovering
      && result.restoredRecovery.buried.length === result.bossBlocked.buried.length,
    "an underground recovery survives save validation and restore",
    JSON.stringify({ saved: !!result.recoverySave, loaded: result.recoveryLoaded,
      reason: result.recoverySaveReason,
      saveRecovering: result.recoverySave?.recovering,
      restored: result.restoredRecovery }));
  check(result.heldAtBoundary.recovering && result.heldAtBoundary.timer === 0,
    "the wave remains buried after recovery while the boss lives");
  check(result.afterBossDefeat.phase === "warning" && !result.afterBossDefeat.recovering,
    "defeating the arena boss releases the Bloom gate");
  check(result.winnowerBlocked.recovering
      && result.winnowerBlocked.blockedByBoss === "censer",
    "the undefeated Censer Works boss arena is protected too");

  console.log("\n=== INTER-WAVE RECOVERY ===");
  check(result.config.intermissionSeconds === 60,
    "cleared waves are separated by one minute");
  check(result.intermission.phase === "intermission" && !result.intermission.recovering
      && result.intermission.timer >= 59.9,
    "a cleared wave enters the full inter-wave respite",
    `${result.intermission.timer}s`);
  check(errors.length === 0, "the browser reports no runtime errors", errors.join(" | "));

  console.log(`\n${failures.length ? "FAIL" : "PASS"}: ${checks - failures.length}/${checks} checks`);
  if (failures.length) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.kill("SIGTERM");
}
