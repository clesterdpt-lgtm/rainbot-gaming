#!/usr/bin/env node
/* ============================================================
   SAINTFALL - melee survivability and Gleaner dodge-window probe

   Exercises the production simulation through the QA facade:

     1. Aegis drains the shared tank at the tuned sustained rate.
     2. A near-edge melee connection reclaims charge, and a fully
        specialized Processional Mercy kill adds its stronger return.
     3. Combo grace begins after recovery rather than during wind-up.
     4. Gleaner damage waits for the visible travelling bolt, the bolt
        moves at its configured speed, and a launch-time aim can be
        evaded by moving out of the swept capsule path.

   Usage:
     node scripts/saintfall-melee-balance-probe.mjs
     node scripts/saintfall-melee-balance-probe.mjs --out output/path
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const outDir = path.resolve(root, outArg >= 0
  ? process.argv[outArg + 1] : "output/saintfall/melee-balance-probe");
const port = 51800 + (process.pid % 1100);
const base = `http://127.0.0.1:${port}`;
const results = [];
let failures = 0;

function check(name, ok, detail = "") {
  const pass = !!ok;
  if (!pass) failures += 1;
  results.push({ name, ok: pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

function startServer() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${base}/games/saintfall.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = startServer();
  let browser = null;
  const diagnostics = { pageErrors: [], consoleErrors: [] };
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    })).newPage();
    page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    });
    await page.goto(`${base}/games/saintfall.html?qa=1&quality=low&intro=0&seed=melee-balance`, {
      waitUntil: "domcontentloaded", timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

    const setup = await page.evaluate(() => {
      const T = window.__SF;
      T.maximize();
      T.ctx.runtime.paused = true;
      document.getElementById("sf-boot")?.remove();
      T.autoStow(false);
      T.player.input.clearAll?.();
      T.setGaitInput(null);
      T.clearEnemies();
      T.resetProgressionForQA();
      const site = T.findFlatSite(46);
      const Q = {
        site: [site[0], site[1]],
        launched: [],
        resolved: [],
        melee: [],
        resetPlayer(yaw = 0) {
          T.player.input.clearAll?.();
          T.setShieldInput(false);
          T.releaseCamera();
          T._teleportRaw(Q.site[0], Q.site[1], yaw);
          T.setCam(yaw, -0.03, 5.2);
          T.combat.player.dead = false;
          T.combat.player.hp = T.combat.player.maxHp;
          T.invulnerable(false);
          T.combat.clearProjectiles();
        },
        launchDirectBolt(distance = 40) {
          const ps = T.player.state;
          const enemy = T.enemies.spawn("gleaner",
            ps.x + Math.sin(ps.yaw) * distance,
            ps.z + Math.cos(ps.yaw) * distance,
            { yaw: ps.yaw + Math.PI });
          enemy.suspicion = 1;
          enemy.alerted = true;
          enemy.fireTimer = 0;
          enemy.burstLeft = 0;
          const random = Math.random;
          Math.random = () => 0;
          try { T.renderOnce(1 / 60); } finally { Math.random = random; }
          enemy.stunTime = 99;
          return enemy;
        },
      };
      T.combat.bus.on("enemyProjectileLaunched", (event) => Q.launched.push({ ...event }));
      T.combat.bus.on("enemyProjectileResolved", (event) => Q.resolved.push({ ...event }));
      T.combat.bus.on("melee", (event) => Q.melee.push({ ...event }));
      window.__SF_MELEE_BALANCE_QA = Q;
      return { site: Q.site, maxHp: T.combat.player.maxHp };
    });

    const shield = await page.evaluate(() => {
      const T = window.__SF;
      const Q = window.__SF_MELEE_BALANCE_QA;
      T.clearEnemies();
      Q.resetPlayer(0);
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      T.setShieldInput(true);
      T.advanceTime(3, 1 / 60);
      const status = T.shieldState();
      const jetpack = T.jetpackState();
      T.setShieldInput(false);
      T.renderOnce(1 / 60);
      return {
        status,
        jetpack,
        drained: Number((100 - jetpack.fuel).toFixed(3)),
        fullTankSeconds: Number((100 / status.drainRate).toFixed(3)),
      };
    });

    const melee = await page.evaluate(() => {
      const T = window.__SF;
      const Q = window.__SF_MELEE_BALANCE_QA;
      T.clearEnemies();
      T.resetProgressionForQA();
      Q.resetPlayer(0);
      T.weapons.setMode("melee");
      T.setJetpackState({ fuel: 30, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      const ps = T.player.state;
      const target = T.enemies.spawn("thresher", ps.x, ps.z + 4.12, { yaw: Math.PI });
      const fuelBefore = T.jetpackState().fuel;
      const hits = T.combat.meleeStrike(1, 2.4, false, 1, 1);
      const fuelAfter = T.jetpackState().fuel;
      const baselineEvent = Q.melee.at(-1);

      T.clearEnemies();
      const reset = T.resetProgressionForQA();
      const xp = T.grantProgressionXpForQA(999999, "qa:melee-balance");
      const spends = [];
      for (const talent of [
        "procession_hooking_step", "procession_hooking_step",
        "procession_third_toll", "procession_third_toll",
        "procession_processional_mercy", "procession_processional_mercy",
      ]) spends.push(T.spendTalentForQA(talent));
      T.setJetpackState({ fuel: 30, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      const target2 = T.enemies.spawn("thresher", ps.x, ps.z + 4.12, { yaw: Math.PI });
      const specializedBefore = T.jetpackState().fuel;
      const specializedHits = T.combat.meleeStrike(1, 2.4, false, 1, 3);
      const specializedAfter = T.jetpackState().fuel;
      const specializedEvent = Q.melee.at(-1);
      const definitions = T.progressionDefinitions();
      const mercyDefinition = (definitions.orders || definitions.doctrine?.orders || [])
        .find((order) => order.id === "procession")?.talents
        .find((talent) => talent.id === "procession_processional_mercy");

      T.clearEnemies();
      T.player.cancelTransientActions();
      T.weapons.setMode("melee");
      const firstStarted = T.player.meleeSwing(0);
      const firstName = T.player.action;
      T.advanceTime(0.9, 1 / 60);
      T.advanceTime(1.1, 1 / 60);
      const secondStarted = T.player.meleeSwing(0);
      const secondName = T.player.action;

      return {
        baseline: {
          hits, killed: target.state === "death", fuelBefore, fuelAfter,
          restored: Number((fuelAfter - fuelBefore).toFixed(3)),
          event: baselineEvent,
        },
        specialized: {
          resetOk: !!reset?.ok,
          xpOk: !!xp?.ok,
          spendsOk: spends.every((result) => result?.ok),
          rank: T.progression.rank("procession_processional_mercy"),
          hits: specializedHits,
          killed: target2.state === "death",
          fuelBefore: specializedBefore,
          fuelAfter: specializedAfter,
          restored: Number((specializedAfter - specializedBefore).toFixed(3)),
          event: specializedEvent,
          definition: mercyDefinition,
        },
        combo: { firstStarted, firstName, secondStarted, secondName },
      };
    });

    const stationary = await page.evaluate(() => {
      const T = window.__SF;
      const Q = window.__SF_MELEE_BALANCE_QA;
      T.clearEnemies();
      Q.resetPlayer(0);
      const hpBefore = T.combat.player.hp;
      const enemy = Q.launchDirectBolt(40);
      const launch = Q.launched.at(-1);
      const hpAtLaunch = T.combat.player.hp;
      T.advanceTime(0.18, 1 / 120);
      const inFlight = T.combat.projectileState();
      const hpBeforeArrival = T.combat.player.hp;
      T.renderOnce(1 / 120);
      const image = T.captureDataURL();
      const tracer = T.vfx.group.getObjectByName("tracers");
      const births = tracer.geometry.getAttribute("aBirth").array;
      const speeds = tracer.geometry.getAttribute("aSpeed")?.array || [];
      let newest = 0;
      for (let i = 4; i < births.length; i += 4) {
        if (births[i] > births[newest]) newest = i;
      }
      const visualSpeed = speeds[newest] ?? null;
      T.advanceTime(0.30, 1 / 120);
      const hpAfterArrival = T.combat.player.hp;
      const resolution = [...Q.resolved].reverse()
        .find((event) => event.id === launch?.id) || null;
      return {
        hpBefore, hpAtLaunch, hpBeforeArrival, hpAfterArrival,
        launch, inFlight, resolution, visualSpeed, image,
        enemyId: enemy.id,
      };
    });
    await writeFile(path.join(outDir, "gleaner-dodge-window.png"),
      Buffer.from(stationary.image.slice(stationary.image.indexOf(",") + 1), "base64"));
    delete stationary.image;

    const dodge = await page.evaluate(() => {
      const T = window.__SF;
      const Q = window.__SF_MELEE_BALANCE_QA;
      T.clearEnemies();
      Q.resetPlayer(0);
      const hpBefore = T.combat.player.hp;
      Q.launchDirectBolt(40);
      const launch = Q.launched.at(-1);
      T.advanceTime(0.14, 1 / 120);
      T._teleportRaw(Q.site[0] + 3.5, Q.site[1], 0);
      T.advanceTime(0.55, 1 / 120);
      const hpAfter = T.combat.player.hp;
      const resolution = [...Q.resolved].reverse()
        .find((event) => event.id === launch?.id) || null;
      return { hpBefore, hpAfter, launch, resolution, state: T.combat.projectileState() };
    });

    const config = stationary.launch ? {
      ...stationary.inFlight.config,
      launchSpeed: stationary.launch.speed,
      visualSpeed: stationary.visualSpeed,
    } : stationary.inFlight.config;

    check("Aegis uses the tuned 12 charge/second drain", shield.status.drainRate === 12,
      `rate=${shield.status.drainRate}`);
    check("Aegis drains 36 charge over a three-second hold",
      Math.abs(shield.drained - 36) <= 0.15, `drained=${shield.drained}`);
    check("A full tank sustains at least eight seconds of ordinary guard",
      shield.fullTankSeconds >= 8, `seconds=${shield.fullTankSeconds}`);

    check("near-edge melee reach connects", melee.baseline.hits === 1 && melee.baseline.killed,
      `hits=${melee.baseline.hits}, reach=${melee.baseline.event?.reach}`);
    check("baseline melee kill reclaims six charge", melee.baseline.restored === 6,
      `restored=${melee.baseline.restored}`);
    check("Processional Mercy rank two is live", melee.specialized.rank === 2
      && melee.specialized.spendsOk, `rank=${melee.specialized.rank}`);
    check("specialized third-strike kill restores twenty-two total charge",
      melee.specialized.restored === 22, `restored=${melee.specialized.restored}`);
    check("combo grace survives a defensive beat after recovery",
      melee.combo.firstStarted && melee.combo.firstName === "melee1"
      && melee.combo.secondStarted && melee.combo.secondName === "melee2",
      `${melee.combo.firstName} -> ${melee.combo.secondName}`);

    check("Gleaner launch does not deal instant damage",
      stationary.hpAtLaunch === stationary.hpBefore,
      `hp=${stationary.hpBefore} -> ${stationary.hpAtLaunch}`);
    check("Gleaner bolt remains harmless during its visible approach",
      stationary.hpBeforeArrival === stationary.hpBefore && stationary.inFlight.active === 1,
      `active=${stationary.inFlight.active}, hp=${stationary.hpBeforeArrival}`);
    check("stationary player is hit only after projectile travel",
      stationary.hpAfterArrival < stationary.hpBeforeArrival
      && stationary.resolution?.reason === "hit"
      && stationary.resolution.flightSeconds >= 0.30,
      `reason=${stationary.resolution?.reason}, flight=${stationary.resolution?.flightSeconds}`);
    check("logical and rendered projectile speeds match at 105 m/s",
      config.speed === 105 && config.launchSpeed === 105 && config.visualSpeed === 105,
      `config=${config.speed}, launch=${config.launchSpeed}, visual=${config.visualSpeed}`);
    check("Gleaner direct aim frequency is reduced below the old 55%",
      config.directAimChance === 0.42 && config.horizontalSpread >= 0.14,
      `direct=${config.directAimChance}, spread=${config.horizontalSpread}`);
    check("a 3.5m sidestep evades a launch-time direct shot",
      dodge.hpAfter === dodge.hpBefore && dodge.resolution?.reason === "miss",
      `hp=${dodge.hpBefore} -> ${dodge.hpAfter}, reason=${dodge.resolution?.reason}`);
    check("browser runtime has no page or console errors",
      diagnostics.pageErrors.length === 0 && diagnostics.consoleErrors.length === 0,
      `page=${diagnostics.pageErrors.length}, console=${diagnostics.consoleErrors.length}`);

    const report = { setup, shield, melee, stationary, dodge, config, diagnostics, results };
    await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nReport: ${path.relative(root, path.join(outDir, "report.json"))}`);
    console.log(`Frame:  ${path.relative(root, path.join(outDir, "gleaner-dodge-window.png"))}`);
    if (failures) process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
