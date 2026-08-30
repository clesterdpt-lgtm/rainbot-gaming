#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Wing, Halo, and Edict capstone acceptance probe

   Exercises the three reworked Vows through the production Doctrine,
   shield, and mission services. QA helpers only establish deterministic
   loadouts and battlefield state.

   Usage:
     node scripts/saintfall-vow-capstones.mjs
     node scripts/saintfall-vow-capstones.mjs --out output/path
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
  ? process.argv[outArg + 1] : "output/saintfall/vow-capstones");
const port = 54800 + (process.pid % 1000);
const base = `http://127.0.0.1:${port}`;
const results = [];
let failures = 0;

function check(name, ok, detail = "") {
  const pass = !!ok;
  if (!pass) failures += 1;
  results.push({ name, ok: pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

function near(value, expected, tolerance = 0.08) {
  return Number.isFinite(Number(value))
    && Math.abs(Number(value) - expected) <= tolerance;
}

function startServer() {
  const python = process.env.SAINTFALL_PYTHON || "/opt/homebrew/bin/python3";
  return spawn(python,
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
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
  const diagnostics = { pageErrors: [], consoleErrors: [], fatal: null };
  let browser = null;
  let evidence = {};
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
    });
    await page.goto(`${base}/games/saintfall.html?qa=1&quality=low&intro=0&seed=vow-capstones`, {
      waitUntil: "domcontentloaded", timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

    evidence = await page.evaluate(() => {
      const T = window.__SF;
      const baseMission = () => ({
        phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
        elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
        relays: [], cooldowns: {}, pending: [],
      });
      const equipOrder = (orderId) => {
        T.resetProgressionForQA();
        T.grantProgressionXpForQA(999999, `qa:vow-capstone:${orderId}`);
        const definitions = T.progressionDefinitions();
        const order = definitions.doctrine.orders.find((candidate) => candidate.id === orderId);
        const spends = [];
        for (const talent of [...order.talents].sort((left, right) => left.tier - right.tier)) {
          for (let rank = 0; rank < talent.maxRank; rank += 1) {
            spends.push(T.spendTalentForQA(talent.id));
          }
        }
        const equip = T.equipCapstoneForQA(order.capstone.id, 0);
        return { order, spends, equip };
      };
      const resetActionState = () => {
        T.player.input.clearAll?.();
        T.setJetInput(false);
        T.setShieldInput(false);
        T.setBoostHold(false);
        T.setGaitInput(null, null);
        T.resetBoost(true);
        T.resetSlam(true);
        T.shield.reset(true);
        T.jetpack.reset(true);
        T.clearEnemies();
        T.invulnerable(true);
        T._teleportRaw(-12, 830, 0);
        T.setBodyHeading(0);
        T.setCam(0, -0.03, 5.4);
        T.player.state.grounded = true;
        T.setJetpackState({ fuel: 20, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
      };

      T.maximize();
      T.ctx.runtime.paused = true;
      document.getElementById("sf-boot")?.remove();
      T.autoStow(false);

      const wingLoadout = equipOrder("wing");
      resetActionState();
      const wingEvents = [];
      const stopWing = T.progression.bus.on("doctrine", (event) => wingEvents.push({ ...event }));
      const ps = T.player.state;
      const fuelStart = T.jetpackState().fuel;
      T.progression.noteVerb("boost", {
        x: ps.x, y: ps.y, z: ps.z, attack: false, boostIndex: 1,
      });
      T.progression.noteVerb("boostEnd", { x: ps.x, y: ps.y, z: ps.z });
      const afterBookkeeping = T.progressionState();
      T.progression.noteVerb("jet", {
        x: ps.x, y: ps.y, z: ps.z, ignitionCost: 6, ignitionIndex: 1,
      });
      const afterIgnition = T.progressionState();
      const freeBoost = T.progression.modifyBoostTrigger({
        baseYaw: 0, intendedYaw: 0, intendedAttack: true, anticipatedBoostIndex: 2,
      });
      const surgeFuelBefore = T.jetpackState().fuel;
      T.progression.noteVerb("slam", {
        x: ps.x, y: ps.y, z: ps.z, fuelCost: 18, slamIndex: 1,
      });
      const surgeFuelAfter = T.jetpackState().fuel;
      const empoweredFall = T.progression.modifySlam({
        x: ps.x, y: ps.y, z: ps.z, radius: 7, damage: 120,
      });
      stopWing?.();
      const wing = {
        loadout: wingLoadout,
        fuelStart,
        afterBookkeeping: afterBookkeeping.effects,
        afterIgnition: afterIgnition.effects,
        freeBoost,
        surgeFuelBefore,
        surgeFuelAfter,
        empoweredFall,
        events: wingEvents,
      };

      const haloLoadout = equipOrder("halo");
      resetActionState();
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
      const haloEvents = [];
      const stopHalo = T.progression.bus.on("doctrine", (event) => haloEvents.push({ ...event }));
      T.invulnerable(false);
      T.setShieldInput(true);
      T.renderOnce(1 / 120);
      const haloPlayer = T.player.state;
      const hpBefore = T.combat.player.hp;
      T.combat.hurtPlayer(40, {
        source: "qa-front-hit", enemyId: "qa-front", enemyKey: "thresher",
        x: haloPlayer.x, y: haloPlayer.y + 1, z: haloPlayer.z + 3,
      });
      T.renderOnce(1 / 120);
      const afterPerfect = {
        progression: T.progressionState(),
        shield: T.shieldState(),
        hp: T.combat.player.hp,
      };
      T.combat.hurtPlayer(40, {
        source: "qa-rear-hit", enemyId: "qa-rear", enemyKey: "thresher",
        x: haloPlayer.x, y: haloPlayer.y + 1, z: haloPlayer.z - 3,
      });
      const afterRearBlock = {
        progression: T.progressionState(),
        shield: T.shieldState(),
        hp: T.combat.player.hp,
      };
      T.advanceTime(0.75, 1 / 120);
      T.safeOrbit(haloPlayer.x, haloPlayer.z, haloPlayer.y + 1.1,
        -0.82, 8.4, 0.12, 52);
      T.renderStill();
      const haloImage = T.captureDataURL();
      T.releaseCamera();
      T.setShieldInput(false);
      T.renderOnce(1 / 120);
      const afterRelease = {
        progression: T.progressionState(),
        shield: T.shieldState(),
        hp: T.combat.player.hp,
      };
      T.invulnerable(true);
      stopHalo?.();
      const halo = {
        loadout: haloLoadout,
        hpBefore,
        afterPerfect,
        afterRearBlock,
        afterRelease,
        events: haloEvents,
        image: haloImage,
      };

      const edictLoadout = equipOrder("edict");
      resetActionState();
      T.mission.restore(baseMission());
      T.teleport(655, 700, 0);
      const fusionEvents = [];
      const stopFusion = T.mission.bus.on("fusion", (event) =>
        fusionEvents.push(JSON.parse(JSON.stringify(event))));
      const firstCall = T.mission.call("resupply");
      const firstInbound = T.mission.pending()[0];
      if (firstInbound) T.advanceTime(firstInbound.remaining + 0.08, 1 / 120);
      const sigil = T.progressionState().effects.activeSigils[0] || null;
      T.mission.cooldowns.cluster = 37;
      const coolingBeforeFusionCall = T.mission.cooldowns.cluster;
      const secondCall = T.mission.call("cluster");
      const fusedInbound = T.mission.pending().find((shot) => shot.key === "cluster") || null;
      const coolingAfterFusionCall = T.mission.cooldowns.cluster;
      if (fusedInbound) T.advanceTime(fusedInbound.remaining + 0.08, 1 / 120);
      stopFusion?.();
      const edict = {
        loadout: edictLoadout,
        firstCall,
        firstInbound,
        sigil,
        coolingBeforeFusionCall,
        secondCall,
        fusedInbound,
        coolingAfterFusionCall,
        fusionEvents,
        progression: T.progressionState(),
        mission: T.missionState(),
      };

      const definitions = T.progressionDefinitions().doctrine.orders
        .filter((order) => ["wing", "halo", "edict"].includes(order.id))
        .map((order) => ({ id: order.id, capstone: order.capstone }));
      return { definitions, wing, halo, edict, report: T.report() };
    });

    const wingComplete = evidence.wing.events.find((event) =>
      event.talentId === "wing_unbroken_circuit" && event.stage === "complete");
    check("Wing bookkeeping does not count as a second circuit action",
      evidence.wing.afterBookkeeping.circuitVerbs?.length === 1
        && evidence.wing.afterBookkeeping.circuitVerbs[0] === "boost",
      JSON.stringify(evidence.wing.afterBookkeeping));
    check("two distinct Wing actions ignite the six-second Unbroken surge",
      evidence.wing.afterIgnition.circuitSurgeActive === true
        && evidence.wing.afterIgnition.circuitSurgeRemaining >= 5.9
        && evidence.wing.afterIgnition.circuitCooldown >= 13.9
        && evidence.wing.afterIgnition.circuitVerbs.length === 0
        && wingComplete?.count === 2 && near(wingComplete?.radius, 7),
      JSON.stringify({ effects: evidence.wing.afterIgnition, wingComplete }));
    check("Unbroken surge makes Wing costs free and empowers Penitent's Fall",
      evidence.wing.freeBoost?.cost === 0
        && evidence.wing.freeBoost?.source === "unbroken-circuit"
        && near(evidence.wing.surgeFuelAfter - evidence.wing.surgeFuelBefore, 18)
        && near(evidence.wing.empoweredFall?.radius, 10)
        && near(evidence.wing.empoweredFall?.damage, 168),
      JSON.stringify({ freeBoost: evidence.wing.freeBoost,
        fuel: [evidence.wing.surgeFuelBefore, evidence.wing.surgeFuelAfter],
        fall: evidence.wing.empoweredFall }));

    const haloArm = evidence.halo.events.find((event) =>
      event.talentId === "halo_seraph_aegis" && event.stage === "arm");
    const haloRelease = evidence.halo.events.find((event) =>
      event.talentId === "halo_seraph_aegis" && event.stage === "release");
    check("a perfect guard immediately unfolds a mobile normal-drain Seraph dome",
      evidence.halo.afterPerfect.progression.effects.domeActive === true
        && near(evidence.halo.afterPerfect.progression.effects.domeStored, 50)
        && evidence.halo.afterPerfect.shield.dome === true
        && evidence.halo.afterPerfect.shield.omniDirectional === true
        && evidence.halo.afterPerfect.shield.movementLocked === false
        && near(evidence.halo.afterPerfect.shield.drainMultiplier, 1)
        && !!haloArm,
      JSON.stringify({ progression: evidence.halo.afterPerfect.progression.effects,
        shield: evidence.halo.afterPerfect.shield, haloArm }));
    check("the Seraph dome blocks from behind and stores 125 percent of absorbed force",
      evidence.halo.afterRearBlock.hp === evidence.halo.hpBefore
        && near(evidence.halo.afterRearBlock.progression.effects.domeStored, 100)
        && evidence.halo.afterRearBlock.progression.effects.domeBlocks === 2,
      JSON.stringify({ hpBefore: evidence.halo.hpBefore,
        afterRearBlock: evidence.halo.afterRearBlock }));
    check("releasing Seraph Aegis detonates the stored force across nine metres",
      near(evidence.halo.afterRelease.progression.effects.lastDomeBlast, 100)
        && evidence.halo.afterRelease.progression.effects.domeActive === false
        && near(haloRelease?.radius, 9) && near(haloRelease?.value, 100),
      JSON.stringify({ effects: evidence.halo.afterRelease.progression.effects, haloRelease }));

    const fusion = evidence.edict.fusionEvents.find((event) => event.id === "reliquary_minefield");
    check("Combined Liturgy leaves an 18-second, 14-metre impact sigil",
      evidence.edict.firstCall === "resupply"
        && near(evidence.edict.sigil?.radius, 14)
        && evidence.edict.sigil?.remaining >= 17.8,
      JSON.stringify(evidence.edict.sigil));
    check("a different command fuses through its active command cooldown",
      near(evidence.edict.coolingBeforeFusionCall, 37)
        && evidence.edict.secondCall === "cluster"
        && evidence.edict.fusedInbound?.fusion?.id === "reliquary_minefield",
      JSON.stringify({ before: evidence.edict.coolingBeforeFusionCall,
        afterCall: evidence.edict.coolingAfterFusionCall,
        inbound: evidence.edict.fusedInbound }));
    check("the upgraded minefield forms nine mines and refunds 35 percent of all cooldowns",
      fusion?.outcome?.count === 9
        && near(fusion?.outcome?.cooldownRefundFraction, 0.35)
        && Object.keys(fusion?.outcome?.cooldownsBefore || {}).every((key) =>
          near(fusion.outcome.cooldownsAfter[key], fusion.outcome.cooldownsBefore[key] * 0.65)),
      JSON.stringify(fusion));
    check("the reworked Vow descriptions expose their concrete final-reward contracts",
      evidence.definitions.every((order) => order.capstone?.implemented === true)
        && evidence.definitions.find((order) => order.id === "wing")?.capstone?.description.includes("40 charge")
        && evidence.definitions.find((order) => order.id === "halo")?.capstone?.description.includes("perfect guard")
        && evidence.definitions.find((order) => order.id === "edict")?.capstone?.description.includes("35%"),
      JSON.stringify(evidence.definitions));
    check("focused Vow probe has no page or console errors",
      diagnostics.pageErrors.length === 0 && diagnostics.consoleErrors.length === 0,
      JSON.stringify(diagnostics));

    const imageData = String(evidence.halo.image || "");
    const comma = imageData.indexOf(",");
    if (comma >= 0) {
      await writeFile(path.join(outDir, "seraph-dome.png"),
        Buffer.from(imageData.slice(comma + 1), "base64"));
    }
    delete evidence.halo.image;
    await context.close();
  } catch (error) {
    diagnostics.fatal = error?.stack || String(error);
    check("focused Vow probe completes without a fatal harness error", false, diagnostics.fatal);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }

  const report = {
    assertions: results.length,
    passed: results.length - failures,
    failed: failures,
    results,
    diagnostics,
    evidence,
  };
  await writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed}/${report.assertions} checks passed`);
  console.log(`Report: ${path.join(outDir, "report.json")}`);
  if (failures) process.exitCode = 1;
}

await main();
