#!/usr/bin/env node
/* ============================================================
   SAINTFALL - durable field-state integrity regression

   This suite exercises the production save service through the QA
   surface. It deliberately keeps all mutations inside the browser and
   writes only its JSON report to the requested output directory.

   Usage:
     node scripts/saintfall-save-integrity.mjs
     node scripts/saintfall-save-integrity.mjs --out output/saintfall/save-integrity
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
const OUT = path.resolve(root, args.out || "output/saintfall/save-integrity");
const PORT = 53000 + (process.pid % 6000);
const BASE = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE}/games/saintfall.html?qa=1&quality=high&intro=skip&seed=save-integrity-v2`;
const results = [];
const diagnostics = { pageErrors: [], consoleErrors: [], resourceErrors: [] };
const evidence = {};
let failed = 0;

function check(name, ok, detail = "") {
  const pass = !!ok;
  results.push({ name, ok: pass, detail });
  if (!pass) failed += 1;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  if (detail) console.log(`        ${detail}`);
}

function closeEnough(a, b, tolerance = 0.002) {
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b))
    && Math.abs(Number(a) - Number(b)) <= tolerance;
}

function sortedIds(state) {
  return (state?.enemies?.ids || []).slice().sort();
}

function sameIds(a, b) {
  return JSON.stringify(sortedIds(a)) === JSON.stringify(sortedIds(b));
}

function missionMatches(actual, snapshot) {
  if (!actual || !snapshot) return false;
  const savedRelays = Array.isArray(snapshot.relays) ? snapshot.relays : [];
  const actualRelays = Array.isArray(actual.relays) ? actual.relays : [];
  if (actual.phase !== snapshot.phase || actual.relaysDone !== snapshot.relaysDone
    || actual.reinforcements !== snapshot.reinforcements
    || actualRelays.length !== savedRelays.length) return false;
  for (let i = 0; i < savedRelays.length; i += 1) {
    if (actualRelays[i].key !== savedRelays[i].key
      || actualRelays[i].done !== savedRelays[i].done
      || !closeEnough(actualRelays[i].progress, savedRelays[i].progress)) return false;
  }
  for (const [key, value] of Object.entries(snapshot.cooldowns || {})) {
    if (!closeEnough(actual.cooldowns?.[key], value)) return false;
  }
  return true;
}

function combatMatches(actual, snapshot) {
  return !!actual && !!snapshot
    && closeEnough(actual.hp, snapshot.hp)
    && closeEnough(actual.maxHp, snapshot.maxHp)
    && actual.kills === snapshot.kills
    && actual.shots === snapshot.shots
    && actual.hits === snapshot.hits;
}

function weaponMatches(actual, snapshot) {
  return !!actual && !!snapshot
    && actual.mode === "ranged"
    && closeEnough(actual.heat, snapshot.heat)
    && actual.overheated === snapshot.overheated
    && closeEnough(actual.venting, snapshot.venting)
    && closeEnough(actual.sinceShot, snapshot.sinceShot)
    && closeEnough(actual.cooldown, snapshot.cooldown);
}

function jetpackMatches(actual, snapshot) {
  return !!actual && !!snapshot
    && closeEnough(actual.fuel, snapshot.fuel)
    && closeEnough(actual.maxFuel, snapshot.maxFuel)
    && closeEnough(actual.cooldownRemaining, snapshot.cooldownRemaining)
    && closeEnough(actual.rechargeDelayRemaining, snapshot.rechargeDelayRemaining);
}

function attachDiagnostics(page, label) {
  page.on("pageerror", (error) => diagnostics.pageErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      const source = location?.url
        ? ` @ ${location.url}:${Number(location.lineNumber || 0) + 1}` : "";
      diagnostics.consoleErrors.push(`${label}: ${message.text()}${source}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      diagnostics.resourceErrors.push(
        `${label}: ${response.status()} ${response.request().method()} ${response.url()}`
      );
    }
  });
}

async function bootPage(context, label) {
  const page = await context.newPage();
  attachDiagnostics(page, label);
  await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.openMenu("saves");
  });
  await page.waitForFunction(() => window.__SF?.menuState?.()?.open
    && window.__SF?.persistenceState?.(), null, { timeout: 5000 });
  return page;
}

async function invalidPayloadPass(page) {
  console.log("\n=== INVALID PAYLOAD CONTAINMENT ===");
  const probe = await page.evaluate(() => {
    const T = window.__SF;
    const fingerprint = () => ({
      player: {
        x: Number(T.player.state.x.toFixed(5)),
        z: Number(T.player.state.z.toFixed(5)),
        yaw: Number(T.player.state.yaw.toFixed(5)),
        camYaw: Number(T.player.state.camYaw.toFixed(5)),
      },
      combat: T.combat.snapshot(),
      mission: T.mission.snapshot(),
      breaches: T.breachState(),
      enemies: T.enemies.snapshot(),
      weapon: T.weapons.snapshot(),
      jetpack: T.jetpackState(),
    });
    const valid = T.saves.capture();
    const before = fingerprint();
    const firstEnemy = valid.enemies.live[0] || null;
    const cases = [
      { name: "wrong schema", payload: { ...valid, schema: T.saves.version + 1 } },
      { name: "wrong seed", payload: { ...valid, seed: (Number(valid.seed) + 1) >>> 0 } },
      { name: "malformed body", payload: {
        schema: T.saves.version, seed: valid.seed, player: valid.player,
      } },
      { name: "empty required domain objects", payload: {
        schema: T.saves.version,
        seed: valid.seed,
        player: {},
        mission: {},
        combat: {},
        enemies: {},
      } },
      /* Every property guarded by save.apply() is present and truthy, but
         the nested domain shapes are deliberately unusable. This catches a
         shallow validator that mistakes top-level presence for a compatible
         save and then lets restore() clear or reset authoritative state. */
      { name: "truthy invalid nested shapes", adversarial: true, payload: {
        ...valid,
        enemies: { live: "not-an-enemy-array" },
        mission: "not-a-mission-snapshot",
        combat: "not-a-combat-snapshot",
      } },
      { name: "string boost domain", adversarial: true, payload: {
        ...valid,
        boost: "not-a-boost-snapshot",
      } },
      { name: "truthy invalid boost object", adversarial: true, payload: {
        ...valid,
        boost: { cooldownRemaining: -1, boosts: "many", hits: Number.NaN },
      } },
      { name: "malformed breach memberIds", adversarial: true, payload: {
        ...valid,
        breaches: { ...valid.breaches, memberIds: { not: "an-array" } },
      } },
      { name: "foreign breach memberId", adversarial: true, payload: {
        ...valid,
        breaches: { ...valid.breaches, memberIds: ["sf-foreign-enemy"] },
      } },
      { name: "stale enemy nextId", adversarial: true, payload: {
        ...valid,
        enemies: { ...valid.enemies, nextId: 1 },
      } },
      { name: "unsafe oversized enemy nextId", adversarial: true, payload: {
        ...valid,
        enemies: { ...valid.enemies, nextId: 1e20 },
      } },
      { name: "unsafe oversized enemy ID suffix", adversarial: true, payload: {
        ...valid,
        enemies: {
          ...valid.enemies,
          live: firstEnemy ? [
            { ...firstEnemy, id: "sf-enemy-9007199254740992" },
            ...valid.enemies.live.slice(1),
          ] : valid.enemies.live,
        },
      } },
      { name: "impossible active wave zero breach", adversarial: true, payload: {
        ...valid,
        breaches: {
          ...valid.breaches,
          phase: "active",
          wave: 0,
          waveIndex: -1,
          complete: false,
        },
      } },
      { name: "breach boss ID and summary mismatch", adversarial: true, payload: {
        ...valid,
        breaches: {
          ...valid.breaches,
          bossId: firstEnemy?.id || null,
          boss: { health: 1, maxHealth: 1 },
        },
      } },
    ];
    const attempts = cases.map(({ name, payload, adversarial = false }) => {
      const accepted = T.saves.apply(payload);
      const after = fingerprint();
      const result = {
        name,
        accepted,
        unchanged: JSON.stringify(after) === JSON.stringify(before),
        adversarial,
        mutation: {
          enemiesBefore: before.enemies.live.length,
          enemiesAfter: after.enemies.live.length,
          relaysBefore: before.mission.relaysDone,
          relaysAfter: after.mission.relaysDone,
          hpBefore: before.combat.hp,
          hpAfter: after.combat.hp,
        },
      };
      // Test isolation only: preserve the observed failure above, then put the
      // known-good snapshot back so later round-trip assertions are independent.
      if (adversarial && (accepted || !result.unchanged)) {
        result.recoveryAccepted = T.saves.apply(valid);
      }
      return result;
    });
    const dormantApplied = T.saves.apply(valid);
    const dormantAfter = T.breachState();
    return {
      validSchema: valid.schema,
      validSeed: valid.seed,
      before,
      attempts,
      dormant: {
        saved: valid.breaches,
        applied: dormantApplied,
        after: dormantAfter,
        lastResult: T.persistenceState()?.lastResult?.type || null,
      },
    };
  });
  evidence.invalidPayloads = probe;
  for (const attempt of probe.attempts) {
    check(`${attempt.name} save is rejected before mutation`,
      attempt.accepted === false && attempt.unchanged,
      JSON.stringify(attempt));
  }
  check("legitimate dormant breach shape loads successfully",
    probe.dormant?.saved?.phase === "dormant"
      && probe.dormant?.saved?.wave === 0
      && probe.dormant?.saved?.waveIndex === -1
      && probe.dormant?.saved?.remaining === 0
      && probe.dormant?.saved?.memberIds?.length === 0
      && probe.dormant?.saved?.complete === false
      && probe.dormant?.saved?.bossId === null
      && probe.dormant?.saved?.boss === null
      && probe.dormant?.applied === true
      && probe.dormant?.after?.phase === "dormant"
      && probe.dormant?.after?.wave === 0
      && probe.dormant?.after?.waveIndex === -1
      && probe.dormant?.after?.remaining === 0
      && probe.dormant?.after?.memberIds?.length === 0
      && probe.dormant?.after?.complete === false
      && probe.dormant?.after?.bossId === null
      && probe.dormant?.after?.boss === null
      && probe.dormant?.lastResult === "loaded",
    JSON.stringify(probe.dormant));
}

async function createDurableScenario(page) {
  console.log("\n=== DURABLE SCENARIO CAPTURE ===");
  const setup = await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(true);
    const relay = T.channelRelay(0);
    const victim = T.enemies.live.find((enemy) => enemy?.id && enemy.health > 0
      && enemy.key !== "matriarch" && !enemy.emerging?.active);
    const victimRecord = victim ? { id: victim.id, key: victim.key, hp: victim.health } : null;
    if (victim) T.combat.damageEnemy(victim, victim.health + 1000, { source: "save-integrity-qa" });

    T.combat.player.maxHp = 100;
    T.combat.player.hp = 57;
    T.combat.player.kills = 7;
    T.combat.player.shots = 41;
    T.combat.player.hits = 29;
    T.mission.state.reinforcements = 3;
    T.mission.cooldowns.orbital = 72.5;
    T.mission.cooldowns.cluster = 31.25;
    T.mission.cooldowns.resupply = 19.75;
    T.weapons.setMode("ranged");
    T.weapons.carry.heat = 0.64;
    T.weapons.carry.overheated = true;
    T.weapons.carry.venting = 0.84;
    T.weapons.carry.sinceShot = 0.27;
    T.weapons.carry.cooldown = 0.38;
    T.setJetpackState({
      fuel: 42.75,
      cooldownRemaining: 5.5,
      rechargeDelayRemaining: 3.25,
    });
    T.setBodyHeading(0.81);
    T.setCam(-1.37, 0.18, 6.1);

    const reason = T.saves.saveReason();
    const saved = T.saveSlot(0);
    const envelope = T.persistenceState()?.manuals?.[0] || null;
    return {
      relay,
      victim: victimRecord,
      victimAfter: victim ? { id: victim.id, state: victim.state, hp: victim.health } : null,
      reason,
      saved,
      envelope,
      storageBytes: localStorage.getItem("rainbot_game_save:saintfall")?.length || 0,
    };
  });
  evidence.scenario = setup;
  check("field scenario is saveable after the relay channel completes",
    setup.reason === "" && setup.relay?.done && setup.relay?.advanced,
    JSON.stringify({ reason: setup.reason, relay: setup.relay }));
  check("manual slot captures a versioned durable snapshot",
    setup.saved?.schema === 2 && setup.envelope?.snapshot?.schema === 2
      && setup.storageBytes > 100,
    JSON.stringify({ schema: setup.saved?.schema, storageBytes: setup.storageBytes }));
  check("captured state contains relay, cooldown, HP, weapon, and jetpack domains",
    setup.saved?.mission?.relays?.[0]?.done === true
      && closeEnough(setup.saved?.mission?.cooldowns?.orbital, 72.5)
      && closeEnough(setup.saved?.combat?.hp, 57)
      && closeEnough(setup.saved?.weapon?.heat, 0.64)
      && closeEnough(setup.saved?.reliquary?.fuel, 42.75),
    JSON.stringify({
      relay: setup.saved?.mission?.relays?.[0],
      cooldowns: setup.saved?.mission?.cooldowns,
      combat: setup.saved?.combat,
      weapon: setup.saved?.weapon,
      reliquary: setup.saved?.reliquary,
    }));
  check("killed enemy is excluded from the durable roster",
    !!setup.victim?.id && setup.victimAfter?.hp === 0
      && !setup.saved?.enemies?.live?.some((enemy) => enemy.id === setup.victim.id),
    JSON.stringify({ victim: setup.victim, victimAfter: setup.victimAfter,
      savedEnemies: setup.saved?.enemies?.live?.length }));
  return setup;
}

async function corruptEnvelopePass(page) {
  console.log("\n=== CORRUPT STORAGE ENVELOPE CONTAINMENT ===");
  const probe = await page.evaluate(() => {
    const T = window.__SF;
    const key = "rainbot_game_save:saintfall";
    const raw = localStorage.getItem(key);
    const fingerprint = () => JSON.stringify({
      player: [T.player.state.x, T.player.state.z, T.player.state.yaw, T.player.state.camYaw],
      combat: T.combat.snapshot(),
      mission: T.mission.snapshot(),
      enemies: T.enemies.snapshot(),
      weapon: T.weapons.snapshot(),
      jetpack: T.jetpackState(),
    });
    const before = fingerprint();

    localStorage.setItem(key, "{not-json");
    const malformedAccepted = T.loadSlot(0);
    const malformedUnchanged = fingerprint() === before;

    localStorage.setItem(key, JSON.stringify({
      version: 999,
      savedAt: Date.now(),
      data: { schema: 999, manuals: [], autosave: null },
    }));
    const wrongVersionAccepted = T.loadSlot(0);
    const wrongVersionUnchanged = fingerprint() === before;

    localStorage.setItem(key, raw);
    return {
      rawBytes: raw?.length || 0,
      malformedAccepted,
      malformedUnchanged,
      wrongVersionAccepted,
      wrongVersionUnchanged,
      restoredSlot: !!T.persistenceState()?.manuals?.[0],
    };
  });
  evidence.corruptEnvelope = probe;
  check("malformed localStorage JSON is ignored without mutation",
    probe.malformedAccepted === false && probe.malformedUnchanged, JSON.stringify(probe));
  check("wrong outer save version is ignored without mutation",
    probe.wrongVersionAccepted === false && probe.wrongVersionUnchanged
      && probe.restoredSlot && probe.rawBytes > 100,
    JSON.stringify(probe));
}

async function repeatedLoadPass(page, setup) {
  console.log("\n=== THREE-CYCLE RESTORE INTEGRITY ===");
  const expectedIds = (setup.saved?.enemies?.live || []).map((enemy) => enemy.id).sort();
  const expected = {
    enemies: { ids: expectedIds, count: expectedIds.length },
    mission: setup.saved.mission,
    combat: setup.saved.combat,
    weapon: setup.saved.weapon,
    jetpack: setup.saved.reliquary,
  };

  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const state = await page.evaluate((iteration) => {
      const T = window.__SF;
      const key = T.listSpecies().find((species) => species !== "matriarch")
        || T.listSpecies()[0];
      const extra = T.enemies.spawn(key, T.player.state.x + 20 + iteration,
        T.player.state.z + 16, { yaw: 0.2 * iteration });
      T.combat.player.hp = 8 + iteration;
      T.combat.player.kills = 900 + iteration;
      T.combat.player.shots = 1000 + iteration;
      T.combat.player.hits = 0;
      T.mission.state.relaysDone = 0;
      T.mission.state.reinforcements = 1;
      for (const relay of T.mission.relays) { relay.done = false; relay.progress = 0; }
      for (const command of Object.keys(T.mission.cooldowns)) T.mission.cooldowns[command] = 0;
      T.weapons.carry.heat = 0.03;
      T.weapons.carry.overheated = false;
      T.weapons.carry.venting = 0;
      T.weapons.carry.sinceShot = 8;
      T.weapons.carry.cooldown = 0;
      T.setJetpackState({ fuel: 5 + iteration, cooldownRemaining: 0,
        rechargeDelayRemaining: 0 });
      const beforeLoad = { extraId: extra?.id || null, count: T.enemies.live.length };
      const loaded = T.loadSlot(0);
      const ids = T.enemies.live.map((enemy) => enemy.id);
      return {
        iteration,
        loaded,
        beforeLoad,
        enemies: {
          count: ids.length,
          ids,
          unique: new Set(ids).size,
          extraPresent: !!extra && ids.includes(extra.id),
        },
        mission: T.mission.snapshot(),
        combat: T.combat.snapshot(),
        weapon: T.weapons.snapshot(),
        jetpack: T.jetpackState(),
      };
    }, cycle);
    evidence[`loadCycle${cycle}`] = state;
    const domains = missionMatches(state.mission, expected.mission)
      && combatMatches(state.combat, expected.combat)
      && weaponMatches(state.weapon, expected.weapon)
      && jetpackMatches(state.jetpack, expected.jetpack);
    check(`load cycle ${cycle} restores each durable gameplay domain`,
      state.loaded && domains,
      JSON.stringify({ mission: state.mission, combat: state.combat,
        weapon: state.weapon, jetpack: state.jetpack }));
    check(`load cycle ${cycle} replaces rather than duplicates the enemy roster`,
      state.enemies.count === expected.enemies.count
        && state.enemies.unique === expected.enemies.count
        && sameIds(state, expected)
        && !state.enemies.extraPresent,
      JSON.stringify({ beforeLoad: state.beforeLoad, afterLoad: state.enemies }));
    check(`load cycle ${cycle} keeps the killed enemy absent`,
      !state.enemies.ids.includes(setup.victim.id),
      `${setup.victim.id} absent from ${state.enemies.count} restored enemies`);
  }
}

async function meleeCancellationPass(page) {
  console.log("\n=== LOAD DURING ACTIVE MELEE ===");
  const probe = await page.evaluate(() => {
    const T = window.__SF;
    const saved = T.persistenceState()?.manuals?.[0]?.snapshot;
    const originalStrike = T.combat.meleeStrike;
    let strikeCalls = 0;
    T.combat.meleeStrike = (...args) => {
      strikeCalls += 1;
      return originalStrike(...args);
    };

    T.weapons.setMode("melee");
    const started = T.player.meleeSwing(T.player.state.yaw + 0.35);
    const activeName = T.player.action;
    const spec = T.player.actionSpec(activeName);
    if (spec) T.player.sampleActionAt(spec.dur * 0.62);
    const queuedReturn = T.player.meleeSwing(T.player.state.yaw - 0.4);
    const midSwingSave = {
      action: T.player.action,
      canSave: T.saves.canSave(),
      capture: T.saves.capture(),
      reason: T.saves.saveReason(),
    };

    const accepted = T.saves.apply(saved);
    const immediatelyAfter = {
      action: T.player.action,
      weapon: T.weapons.snapshot(),
      inputEvents: T.player.input.drain().length,
    };
    T.invulnerable(true);
    const killsBefore = T.combat.player.kills;
    const healthBefore = new Map(T.enemies.live.map((enemy) => [enemy.id, enemy.health]));
    T.advanceTime(2.4, 1 / 60);
    const healthChanges = T.enemies.live.filter((enemy) =>
      healthBefore.has(enemy.id) && healthBefore.get(enemy.id) !== enemy.health)
      .map((enemy) => ({ id: enemy.id, before: healthBefore.get(enemy.id), after: enemy.health }));
    const afterAdvance = {
      action: T.player.action,
      weapon: T.weapons.snapshot(),
      strikeCalls,
      killsBefore,
      killsAfter: T.combat.player.kills,
      healthChanges,
    };
    T.combat.meleeStrike = originalStrike;
    return {
      boundary: { started, activeName, queuedReturn, duration: spec?.dur || null },
      midSwingSave,
      accepted,
      immediatelyAfter,
      afterAdvance,
    };
  });
  evidence.meleeCancellation = probe;
  check("active melee and its buffered follow-up establish the load boundary",
    probe.boundary.started && /^melee/.test(probe.boundary.activeName || "")
      && probe.boundary.queuedReturn === false && probe.boundary.duration > 0,
    JSON.stringify(probe.boundary));
  check("manual capture is unavailable during an active melee timeline",
    probe.midSwingSave.action?.startsWith("melee")
      && probe.midSwingSave.canSave === false
      && probe.midSwingSave.capture === null
      && /action/i.test(probe.midSwingSave.reason),
    JSON.stringify(probe.midSwingSave));
  check("applying an existing save cancels melee and normalizes the weapon",
    probe.accepted && probe.immediatelyAfter.action === null
      && probe.immediatelyAfter.weapon?.mode === "ranged"
      && probe.immediatelyAfter.inputEvents === 0,
    JSON.stringify({ accepted: probe.accepted, after: probe.immediatelyAfter }));
  check("cancelled melee has no queued action or hit replay after advancing",
    probe.afterAdvance.action === null
      && probe.afterAdvance.weapon?.mode === "ranged"
      && probe.afterAdvance.strikeCalls === 0
      && probe.afterAdvance.killsAfter === probe.afterAdvance.killsBefore
      && probe.afterAdvance.healthChanges.length === 0,
    JSON.stringify(probe.afterAdvance));
}

async function transactionalRollbackPass(page) {
  console.log("\n=== INJECTED RESTORE FAILURE / ROLLBACK ===");
  const probe = await page.evaluate(() => {
    const T = window.__SF;
    T.player.cancelTransientActions();
    T.weapons.setMode("ranged");
    T.combat.player.invulnerable = false;

    const canonical = (snapshot) => {
      const breach = snapshot?.breaches ? JSON.parse(JSON.stringify(snapshot.breaches)) : null;
      /* The breach serial is an internal monotonic event revision. restore()
         intentionally advances it when announcing restored state; every
         player-facing and durable breach field remains part of this exact
         comparison. */
      if (breach) delete breach.serial;
      return {
        player: snapshot?.player,
        combat: snapshot?.combat,
        mission: snapshot?.mission,
        breaches: breach,
        enemies: snapshot?.enemies,
        weapon: snapshot?.weapon,
        boost: snapshot?.boost,
        atmosphere: snapshot?.atmosphere,
        reliquary: snapshot?.reliquary,
      };
    };

    const beforeSnapshot = T.saves.capture();
    const before = canonical(beforeSnapshot);
    const target = JSON.parse(JSON.stringify(beforeSnapshot));
    target.player.x += 48;
    target.player.z -= 36;
    target.combat.hp = Math.max(1, Math.min(target.combat.maxHp, 22));
    target.combat.kills += 11;
    target.mission.cooldowns.cluster = Math.max(0,
      Math.min(T.mission.stratagems.cluster.cooldown, 7.25));

    const originalRestore = T.mission.restore;
    let restoreCalls = 0;
    T.mission.restore = (...args) => {
      restoreCalls += 1;
      if (restoreCalls === 1) throw new Error("injected-save-rollback-probe");
      return originalRestore(...args);
    };
    let accepted;
    try {
      accepted = T.saves.apply(target);
    } finally {
      T.mission.restore = originalRestore;
    }
    const afterSnapshot = T.saves.capture();
    const after = canonical(afterSnapshot);
    const beforeJson = JSON.stringify(before);
    const afterJson = JSON.stringify(after);
    return {
      accepted,
      restoreCalls,
      exact: beforeJson === afterJson,
      lastResult: T.persistenceState()?.lastResult || null,
      beforeSummary: {
        player: before.player,
        combat: before.combat,
        mission: before.mission,
        enemyCount: before.enemies?.live?.length,
        weapon: before.weapon,
        reliquary: before.reliquary,
      },
      afterSummary: {
        player: after.player,
        combat: after.combat,
        mission: after.mission,
        enemyCount: after.enemies?.live?.length,
        weapon: after.weapon,
        reliquary: after.reliquary,
      },
      // Only emitted on failure, so the report can diagnose an allegedly
      // transactional rollback without flooding successful console output.
      mismatch: beforeJson === afterJson ? null : { before, after },
    };
  });
  evidence.transactionalRollback = probe;
  check("an injected subsystem restore exception is contained",
    probe.accepted === false && probe.restoreCalls === 2
      && probe.lastResult?.type === "error",
    JSON.stringify({ accepted: probe.accepted, restoreCalls: probe.restoreCalls,
      lastResult: probe.lastResult }));
  check("failed apply restores the exact pre-load durable state",
    probe.exact,
    JSON.stringify({ exact: probe.exact, before: probe.beforeSummary,
      after: probe.afterSummary, mismatch: probe.mismatch }));
}

async function deadStateRollbackPass(browser) {
  console.log("\n=== DEAD-STATE RESTORE FAILURE / ROLLBACK ===");
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await bootPage(context, "dead-rollback");
  const probe = await page.evaluate(() => {
    const T = window.__SF;
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const breachSnapshot = () => {
      const breach = clone(T.breaches.status());
      /* restore() advances the internal notification revision. It is not a
         durable gameplay value, while every other breach field is. */
      delete breach.serial;
      return breach;
    };
    const reliquarySnapshot = () => {
      const jetpack = T.jetpackState();
      return {
        fuel: jetpack.fuel,
        maxFuel: jetpack.maxFuel,
        cooldownRemaining: jetpack.cooldownRemaining,
        rechargeDelayRemaining: jetpack.rechargeDelayRemaining,
      };
    };
    const fingerprint = () => {
      const ps = T.player.state;
      const cp = T.combat.player;
      const ms = T.mission.state;
      return {
        player: {
          x: ps.x,
          z: ps.z,
          yaw: ps.yaw,
          camYaw: ps.camYaw,
          camPitch: ps.camPitch,
          camDist: ps.camDist,
        },
        combat: T.combat.snapshot(),
        combatTransient: {
          hp: cp.hp,
          dead: cp.dead,
          respawnIn: cp.respawnIn,
          invulnerable: cp.invulnerable,
        },
        mission: T.mission.snapshot(),
        missionTransient: {
          countedDeath: ms.countedDeath,
          channellingKey: ms.channelling?.key || null,
          banner: ms.banner,
          bannerFor: ms.bannerFor,
        },
        breaches: breachSnapshot(),
        enemies: T.enemies.snapshot(),
        weapon: T.weapons.snapshot(),
        boost: T.boost.status(),
        atmosphere: { time: T.atmos.time, storm: T.atmos.storm },
        reliquary: reliquarySnapshot(),
      };
    };

    T.player.cancelTransientActions();
    T.weapons.setMode("ranged");
    T.clearEnemies();
    T.enemies.spawn("thresher", 850, 850, { yaw: 0.35 });
    T.enemies.spawn("gleaner", -850, 850, { yaw: -0.45 });
    T.shield.reset(true);
    T.combat.player.invulnerable = false;

    /* A single valid restore canonicalises generated enemy homes and all
       other restore-owned fields before exact checkpoint comparison. */
    const initial = T.saves.capture();
    const normalised = !!initial && T.saves.apply(initial);
    if (!normalised) return { setupError: "normalisation save/apply failed" };

    const missionTarget = T.mission.snapshot();
    missionTarget.phase = "relays";
    missionTarget.deaths = 0;
    missionTarget.reinforcements = 3;
    missionTarget.maxReinforcements = 5;
    missionTarget.extractCalled = false;
    missionTarget.extractTimer = 0;
    missionTarget.relays = missionTarget.relays.map((relay, index) => ({
      ...relay,
      done: false,
      progress: index === 0 ? 0.42 : index === 1 ? 0.17 : 0,
    }));
    T.mission.restore(missionTarget);
    const savedAlive = T.saves.capture();
    if (!savedAlive) return { setupError: "alive rollback target was unavailable" };
    const target = clone(savedAlive);
    target.player.x += 34;
    target.player.z -= 29;

    const budgetBeforeDeath = {
      deaths: T.mission.state.deaths,
      reinforcements: T.mission.state.reinforcements,
    };
    const damageApplied = T.combat.hurtPlayer(T.combat.player.maxHp + 100, {
      source: "dead-state-rollback-qa",
    });
    const killed = {
      damageApplied,
      hp: T.combat.player.hp,
      dead: T.combat.player.dead,
      respawnIn: T.combat.player.respawnIn,
    };
    T.advanceTime(1 / 60, 1 / 60);
    const budgetAfterDeath = {
      deaths: T.mission.state.deaths,
      reinforcements: T.mission.state.reinforcements,
      countedDeath: T.mission.state.countedDeath,
    };

    /* These values deliberately exercise the transient portion of the
       private rollback checkpoint in addition to schema-2 durable fields. */
    T.combat.player.invulnerable = true;
    T.mission.state.channelling = T.mission.relays[1];
    T.mission.state.banner = "ROLLBACK DEATH TIMER";
    T.mission.state.bannerFor = 8.75;
    const before = fingerprint();
    const beforeJson = JSON.stringify(before);

    const originalRestore = T.mission.restore;
    let restoreCalls = 0;
    T.mission.restore = (...restoreArgs) => {
      restoreCalls += 1;
      if (restoreCalls === 1) throw new Error("injected-dead-state-rollback-probe");
      return originalRestore(...restoreArgs);
    };
    let accepted;
    try {
      accepted = T.saves.apply(target);
    } finally {
      T.mission.restore = originalRestore;
    }

    const after = fingerprint();
    const afterJson = JSON.stringify(after);
    const budgetAfterRollback = {
      deaths: T.mission.state.deaths,
      reinforcements: T.mission.state.reinforcements,
      countedDeath: T.mission.state.countedDeath,
      hp: T.combat.player.hp,
      dead: T.combat.player.dead,
      respawnIn: T.combat.player.respawnIn,
      invulnerable: T.combat.player.invulnerable,
    };

    const halfTimer = Math.max(0.1, T.combat.player.respawnIn * 0.5);
    T.advanceTime(halfTimer, 1 / 60);
    const duringTimer = {
      deaths: T.mission.state.deaths,
      reinforcements: T.mission.state.reinforcements,
      countedDeath: T.mission.state.countedDeath,
      hp: T.combat.player.hp,
      dead: T.combat.player.dead,
      respawnIn: T.combat.player.respawnIn,
    };
    T.advanceTime(T.combat.player.respawnIn + 0.25, 1 / 60);
    const afterRespawn = {
      deaths: T.mission.state.deaths,
      reinforcements: T.mission.state.reinforcements,
      countedDeath: T.mission.state.countedDeath,
      hp: T.combat.player.hp,
      maxHp: T.combat.player.maxHp,
      dead: T.combat.player.dead,
      respawnIn: T.combat.player.respawnIn,
    };

    return {
      setup: {
        normalised,
        rosterCount: before.enemies.live.length,
        rosterIds: before.enemies.live.map((enemy) => enemy.id),
      },
      budgetBeforeDeath,
      killed,
      budgetAfterDeath,
      accepted,
      restoreCalls,
      lastResult: T.persistenceState()?.lastResult || null,
      exact: beforeJson === afterJson,
      before,
      after,
      mismatch: beforeJson === afterJson ? null : { before, after },
      budgetAfterRollback,
      duringTimer,
      afterRespawn,
    };
  });
  evidence.deadStateRollback = probe;
  check("authoritative death enters a counted reinforcement timer exactly once",
    !probe.setupError
      && probe.killed?.damageApplied > 0
      && probe.killed?.hp === 0
      && probe.killed?.dead === true
      && probe.killed?.respawnIn === 3.4
      && probe.budgetAfterDeath?.deaths === probe.budgetBeforeDeath?.deaths + 1
      && probe.budgetAfterDeath?.reinforcements
        === probe.budgetBeforeDeath?.reinforcements - 1
      && probe.budgetAfterDeath?.countedDeath === true,
    JSON.stringify({ setupError: probe.setupError, killed: probe.killed,
      before: probe.budgetBeforeDeath, after: probe.budgetAfterDeath }));
  check("dead-state injected restore failure is contained by a two-call rollback",
    probe.accepted === false && probe.restoreCalls === 2
      && probe.lastResult?.type === "error",
    JSON.stringify({ accepted: probe.accepted, restoreCalls: probe.restoreCalls,
      lastResult: probe.lastResult }));
  check("dead rollback exactly restores durable state, roster, and death transients",
    probe.exact
      && probe.setup?.rosterCount === 2
      && new Set(probe.setup?.rosterIds || []).size === 2
      && probe.budgetAfterRollback?.hp === 0
      && probe.budgetAfterRollback?.dead === true
      && probe.budgetAfterRollback?.respawnIn === probe.after?.combatTransient?.respawnIn
      && probe.budgetAfterRollback?.invulnerable === true
      && probe.budgetAfterRollback?.countedDeath === true
      && probe.after?.missionTransient?.channellingKey
        === probe.before?.missionTransient?.channellingKey
      && probe.after?.missionTransient?.banner === "ROLLBACK DEATH TIMER"
      && probe.after?.missionTransient?.bannerFor === 8.75,
    JSON.stringify({ exact: probe.exact, setup: probe.setup,
      checkpoint: probe.budgetAfterRollback, transient: probe.after?.missionTransient,
      mismatch: probe.mismatch }));
  check("advancing through respawn does not double-count the reinforcement loss",
    probe.duringTimer?.dead === true
      && probe.duringTimer?.hp === 0
      && probe.duringTimer?.countedDeath === true
      && probe.duringTimer?.deaths === probe.budgetAfterRollback?.deaths
      && probe.duringTimer?.reinforcements === probe.budgetAfterRollback?.reinforcements
      && probe.afterRespawn?.dead === false
      && probe.afterRespawn?.hp === probe.afterRespawn?.maxHp
      && probe.afterRespawn?.countedDeath === false
      && probe.afterRespawn?.deaths === probe.budgetAfterRollback?.deaths
      && probe.afterRespawn?.reinforcements === probe.budgetAfterRollback?.reinforcements,
    JSON.stringify({ checkpoint: probe.budgetAfterRollback,
      during: probe.duringTimer, after: probe.afterRespawn }));
  await page.close();
  await context.close();
}

async function pendingCommandRollbackPass(browser) {
  console.log("\n=== INBOUND COMMAND FAILURE / ROLLBACK ===");
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await bootPage(context, "pending-command-rollback");
  const probe = await page.evaluate(() => {
    const T = window.__SF;
    const markerAt = (shot) => {
      if (!shot) return { count: 0, markers: [] };
      const markers = T.mission.group.children.filter((candidate) =>
        candidate?.children?.some((child) =>
          Math.abs(child.position.x - shot.x) < 0.001
          && Math.abs(child.position.z - shot.z) < 0.001))
        .map((candidate) => ({
          attached: candidate.parent === T.mission.group,
          visible: candidate.visible,
          children: candidate.children.length,
        }));
      return { count: markers.length, markers };
    };

    T.invulnerable(true);
    T.clearEnemies();
    T.setBreachAuto(false);
    T.player.cancelTransientActions();
    T.weapons.setMode("ranged");
    T.setCam(0, -0.1, 5.2);
    const ps = T.player.state;
    const callX = ps.x;
    const callZ = ps.z + 22;
    const subject = T.enemies.spawn("matriarch", callX, callZ, {
      yaw: Math.PI,
      health: 3600,
    });

    /* Normalise generated enemy defaults once so the later comparison is
       solely about the transactional command checkpoint. */
    const normalise = T.saves.capture();
    const normalised = !!normalise && T.saves.apply(normalise);
    T.invulnerable(true);
    const target = T.saves.capture();
    if (!normalised || !target || !subject) {
      return { setupError: "normalisation or rollback target failed" };
    }

    T.mission.cooldowns.cluster = 0;
    const dispatched = T.mission.call("cluster");
    T.advanceTime(0.65, 1 / 60);
    const beforeMission = T.mission.snapshot();
    const beforePending = beforeMission.pending[0] || null;
    const beforeMarker = markerAt(beforePending);
    const beforeHealth = T.enemies.live.find((enemy) => enemy.id === subject.id)?.health ?? null;

    const originalRestore = T.breaches.restore;
    let restoreCalls = 0;
    T.breaches.restore = (...restoreArgs) => {
      restoreCalls += 1;
      if (restoreCalls === 1) throw new Error("injected-pending-command-rollback-probe");
      return originalRestore(...restoreArgs);
    };
    let accepted;
    try {
      accepted = T.saves.apply(target);
    } finally {
      T.breaches.restore = originalRestore;
    }
    const afterMission = T.mission.snapshot();
    const afterPending = afterMission.pending[0] || null;
    const afterMarker = markerAt(afterPending);
    const afterHealth = T.enemies.live.find((enemy) => enemy.id === subject.id)?.health ?? null;

    let impacts = 0;
    let explosions = 0;
    const offImpact = T.mission.bus.on("impact", () => { impacts += 1; });
    const originalExplode = T.combat.explode;
    T.combat.explode = (...explodeArgs) => {
      explosions += 1;
      return originalExplode(...explodeArgs);
    };
    T.advanceTime((afterPending?.remaining || 0) + 0.2, 1 / 60);
    const resolvedMission = T.mission.snapshot();
    const resolvedMarker = markerAt(afterPending);
    const resolvedHealth = T.enemies.live.find((enemy) => enemy.id === subject.id)?.health ?? null;
    const countsAfterResolve = { impacts, explosions };
    T.advanceTime(T.mission.stratagems.cluster.delay + 0.5, 1 / 60);
    const settledMission = T.mission.snapshot();
    const settledMarker = markerAt(afterPending);
    const settledHealth = T.enemies.live.find((enemy) => enemy.id === subject.id)?.health ?? null;
    const countsAfterSettle = { impacts, explosions };
    T.combat.explode = originalExplode;
    offImpact();

    return {
      setup: { normalised, dispatched, subjectId: subject.id },
      accepted,
      restoreCalls,
      lastResult: T.persistenceState()?.lastResult || null,
      before: {
        mission: beforeMission,
        pending: beforePending,
        marker: beforeMarker,
        health: beforeHealth,
      },
      after: {
        mission: afterMission,
        pending: afterPending,
        marker: afterMarker,
        health: afterHealth,
      },
      exactMission: JSON.stringify(beforeMission) === JSON.stringify(afterMission),
      resolved: {
        mission: resolvedMission,
        marker: resolvedMarker,
        health: resolvedHealth,
        counts: countsAfterResolve,
      },
      settled: {
        mission: settledMission,
        marker: settledMarker,
        health: settledHealth,
        counts: countsAfterSettle,
      },
    };
  });
  evidence.pendingCommandRollback = probe;
  check("cluster flight establishes one spent pending command and marker",
    !probe.setupError
      && probe.setup?.dispatched === "cluster"
      && probe.before?.mission?.pending?.length === 1
      && probe.before?.pending?.key === "cluster"
      && probe.before?.pending?.remaining > 0
      && probe.before?.pending?.remaining < 2.4
      && probe.before?.mission?.cooldowns?.cluster > 0
      && probe.before?.marker?.count === 1
      && probe.before?.marker?.markers?.[0]?.attached === true
      && probe.before?.marker?.markers?.[0]?.visible === true
      && probe.before?.marker?.markers?.[0]?.children === 2,
    JSON.stringify({ setupError: probe.setupError, setup: probe.setup,
      pending: probe.before?.pending, cooldown: probe.before?.mission?.cooldowns?.cluster,
      marker: probe.before?.marker }));
  check("later restore failure reinstates the exact flight, cooldown, and marker",
    probe.accepted === false && probe.restoreCalls === 2
      && probe.lastResult?.type === "error"
      && probe.exactMission
      && JSON.stringify(probe.after?.pending) === JSON.stringify(probe.before?.pending)
      && probe.after?.mission?.cooldowns?.cluster === probe.before?.mission?.cooldowns?.cluster
      && probe.after?.marker?.count === 1
      && probe.after?.marker?.markers?.[0]?.attached === true
      && probe.after?.marker?.markers?.[0]?.visible === true
      && probe.after?.marker?.markers?.[0]?.children === 2
      && probe.after?.health === probe.before?.health,
    JSON.stringify({ accepted: probe.accepted, restoreCalls: probe.restoreCalls,
      lastResult: probe.lastResult, exactMission: probe.exactMission,
      before: probe.before, after: probe.after }));
  check("restored command resolves once without loss and removes its marker",
    probe.resolved?.mission?.pending?.length === 0
      && probe.resolved?.marker?.count === 0
      && probe.resolved?.counts?.impacts === 1
      && probe.resolved?.counts?.explosions === 1
      && probe.resolved?.health < probe.after?.health,
    JSON.stringify(probe.resolved));
  check("resolved command cannot duplicate on later simulation steps",
    probe.settled?.mission?.pending?.length === 0
      && probe.settled?.marker?.count === 0
      && probe.settled?.counts?.impacts === 1
      && probe.settled?.counts?.explosions === 1
      && probe.settled?.health === probe.resolved?.health,
    JSON.stringify(probe.settled));
  await page.close();
  await context.close();
}

async function emptyActiveBreachRoundtripPass(browser) {
  console.log("\n=== EMPTY ACTIVE BREACH ROUNDTRIP ===");
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await bootPage(context, "empty-active-breach");
  const probe = await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(true);
    T.clearEnemies();
    T.setBreachAuto(false);
    const control = T.enemies.spawn("gleaner", -850, -850, { yaw: 0.4 });
    const ps = T.player.state;
    T.startBreachWave(0, ps.x, ps.z - 44, true);
    T.advanceTime(0.12, 1 / 60);
    /* Damage is intentionally rejected during the rise. Cross the complete
       emergence window before taking the authoritative last-member kills. */
    T.advanceTime(2.0, 1 / 60);
    const memberIds = T.breachState().memberIds.slice();
    for (const id of memberIds) {
      const member = T.enemies.live.find((enemy) => enemy.id === id);
      if (member) T.combat.damageEnemy(member, member.health + 1000, {
        source: "empty-active-save-qa",
      });
    }
    const boundary = T.breachState();
    const saved = T.saves.capture();
    if (!control || !saved) return { setupError: "empty active snapshot was unavailable" };

    const savedEnemy = saved.enemies;
    const savedBreach = saved.breaches;
    const originalSpawn = T.enemies.spawn;
    let fallbackSpawnCalls = 0;
    T.enemies.spawn = (...spawnArgs) => {
      fallbackSpawnCalls += 1;
      return originalSpawn(...spawnArgs);
    };
    let applied;
    try {
      applied = T.saves.apply(saved);
    } finally {
      T.enemies.spawn = originalSpawn;
    }
    const restoredEnemy = T.enemies.snapshot();
    const restoredBreach = T.breachState();
    const restoredIds = restoredEnemy.live.map((enemy) => enemy.id);
    T.advanceTime(0.05, 1 / 60);
    const advancedEnemy = T.enemies.snapshot();
    const advancedBreach = T.breachState();
    const intermissionSaved = T.saves.capture();
    const intermissionApplied = intermissionSaved
      ? T.saves.apply(intermissionSaved) : false;
    const intermissionEnemy = T.enemies.snapshot();
    const intermissionRestored = T.breachState();
    return {
      controlId: control.id,
      killedMemberIds: memberIds,
      boundary,
      saved: {
        enemyCount: savedEnemy.live.length,
        enemyIds: savedEnemy.live.map((enemy) => enemy.id),
        nextId: savedEnemy.nextId,
        enemyRng: savedEnemy.rng,
        breach: savedBreach,
      },
      applied,
      fallbackSpawnCalls,
      restored: {
        enemyCount: restoredEnemy.live.length,
        enemyIds: restoredIds,
        unique: new Set(restoredIds).size,
        nextId: restoredEnemy.nextId,
        enemyRng: restoredEnemy.rng,
        breach: restoredBreach,
      },
      advanced: {
        enemyCount: advancedEnemy.live.length,
        enemyIds: advancedEnemy.live.map((enemy) => enemy.id),
        nextId: advancedEnemy.nextId,
        enemyRng: advancedEnemy.rng,
        breach: advancedBreach,
      },
      intermission: {
        saved: intermissionSaved?.breaches || null,
        savedEnemyCount: intermissionSaved?.enemies?.live?.length ?? null,
        applied: intermissionApplied,
        restored: intermissionRestored,
        restoredEnemyCount: intermissionEnemy.live.length,
        restoredUnique: new Set(intermissionEnemy.live.map((enemy) => enemy.id)).size,
        lastResult: T.persistenceState()?.lastResult?.type || null,
      },
      lastResult: T.persistenceState()?.lastResult || null,
    };
  });
  evidence.emptyActiveBreachRoundtrip = probe;
  check("legitimate active empty breach snapshot loads without fallback spawning",
    !probe.setupError
      && probe.killedMemberIds?.length === 4
      && probe.boundary?.phase === "active"
      && probe.boundary?.remaining === 0
      && probe.boundary?.memberIds?.length === 0
      && probe.saved?.breach?.phase === "active"
      && probe.saved?.breach?.remaining === 0
      && probe.saved?.breach?.memberIds?.length === 0
      && probe.applied === true
      && probe.fallbackSpawnCalls === 0
      && probe.restored?.breach?.phase === "active"
      && probe.restored?.breach?.remaining === 0
      && probe.restored?.breach?.memberIds?.length === 0
      && probe.lastResult?.type === "loaded",
    JSON.stringify({ setupError: probe.setupError, killed: probe.killedMemberIds,
      boundary: probe.boundary, saved: probe.saved, applied: probe.applied,
      fallbackSpawnCalls: probe.fallbackSpawnCalls, restored: probe.restored,
      lastResult: probe.lastResult }));
  check("empty breach restore preserves roster, RNG, and next ID without drift",
    probe.saved?.enemyCount === 1
      && probe.restored?.enemyCount === 1
      && probe.restored?.unique === 1
      && JSON.stringify(probe.restored?.enemyIds) === JSON.stringify(probe.saved?.enemyIds)
      && probe.restored?.enemyIds?.[0] === probe.controlId
      && probe.restored?.nextId === probe.saved?.nextId
      && JSON.stringify(probe.restored?.enemyRng) === JSON.stringify(probe.saved?.enemyRng)
      && JSON.stringify(probe.restored?.breach?.rng) === JSON.stringify(probe.saved?.breach?.rng)
      && probe.advanced?.breach?.phase === "intermission"
      && probe.advanced?.enemyCount === 1
      && JSON.stringify(probe.advanced?.enemyIds) === JSON.stringify(probe.saved?.enemyIds)
      && probe.advanced?.nextId === probe.saved?.nextId
      && JSON.stringify(probe.advanced?.enemyRng) === JSON.stringify(probe.saved?.enemyRng)
      && JSON.stringify(probe.advanced?.breach?.rng) === JSON.stringify(probe.saved?.breach?.rng),
    JSON.stringify({ controlId: probe.controlId, saved: probe.saved,
      restored: probe.restored, advanced: probe.advanced }));
  check("legitimate intermission breach shape loads successfully",
    probe.intermission?.saved?.phase === "intermission"
      && probe.intermission?.saved?.wave === 1
      && probe.intermission?.saved?.waveIndex === 0
      && probe.intermission?.saved?.remaining === 0
      && probe.intermission?.saved?.memberIds?.length === 0
      && probe.intermission?.saved?.complete === false
      && probe.intermission?.saved?.bossId === null
      && probe.intermission?.saved?.boss === null
      && probe.intermission?.applied === true
      && probe.intermission?.restored?.phase === "intermission"
      && probe.intermission?.restored?.wave === 1
      && probe.intermission?.restored?.waveIndex === 0
      && probe.intermission?.restored?.remaining === 0
      && probe.intermission?.restored?.memberIds?.length === 0
      && probe.intermission?.restored?.complete === false
      && probe.intermission?.restored?.bossId === null
      && probe.intermission?.restored?.boss === null
      && probe.intermission?.restoredEnemyCount === probe.intermission?.savedEnemyCount
      && probe.intermission?.restoredUnique === probe.intermission?.savedEnemyCount
      && probe.intermission?.lastResult === "loaded",
    JSON.stringify(probe.intermission));
  await page.close();
  await context.close();
}

async function emergenceLifecycleRoundtripPass(browser) {
  console.log("\n=== MATRIARCH EMERGENCE LIFECYCLE ROUNDTRIPS ===");
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await bootPage(context, "emergence-lifecycle");
  const probe = await page.evaluate(() => {
    const T = window.__SF;
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const bossObject = () => T.enemies.live.find((enemy) => enemy.key === "matriarch") || null;
    const recordFor = (id, snapshot = T.enemies.snapshot()) =>
      snapshot.live.find((record) => record.id === id) || null;
    const poseName = (inst) => {
      if (!inst?.current) return null;
      for (const [name, action] of inst.actions) if (action === inst.current) return name;
      return null;
    };
    const inspectBoss = (controlId) => {
      const inst = bossObject();
      if (!inst) return null;
      const enemySnapshot = T.enemies.snapshot();
      const record = recordFor(inst.id, enemySnapshot);
      const e = inst.emerging;
      const baseScale = e?.baseScale ?? inst.spec.scale * (record?.scale || 1);
      let expectedScale = null;
      let progressionError = null;
      let expectedPose = null;
      let poseProgressionError = null;
      if (e?.active) {
        if (e.elapsed < e.delay) {
          expectedScale = [baseScale * 0.68, baseScale * 0.68, baseScale * 0.68];
          expectedPose = { y: inst.y - e.depth, rotationX: 0, rotationZ: 0 };
        } else {
          const t = Math.max(0, Math.min(1,
            (e.elapsed - e.delay) / Math.max(0.01, e.duration)));
          const rise = 1 - Math.pow(1 - t, 3);
          const widen = Math.sin(t * Math.PI) * 0.09;
          expectedScale = [
            baseScale * (0.68 + rise * 0.32 + widen),
            baseScale * (0.52 + rise * 0.48 - widen * 0.35),
            baseScale * (0.68 + rise * 0.32 + widen),
          ];
          expectedPose = {
            y: inst.y - e.depth * (1 - rise) + Math.sin(t * Math.PI) * e.depth * 0.055,
            rotationX: Math.sin(t * Math.PI * 3) * (1 - t) * 0.075,
            rotationZ: Math.sin(t * Math.PI * 2.2 + inst.yaw) * (1 - t) * 0.06,
          };
        }
        progressionError = Math.max(
          Math.abs(inst.root.scale.x - expectedScale[0]),
          Math.abs(inst.root.scale.y - expectedScale[1]),
          Math.abs(inst.root.scale.z - expectedScale[2])
        );
        poseProgressionError = Math.max(
          Math.abs(inst.root.position.y - expectedPose.y),
          Math.abs(inst.root.rotation.x - expectedPose.rotationX),
          Math.abs(inst.root.rotation.z - expectedPose.rotationZ)
        );
      }
      return {
        id: inst.id,
        eventWave: inst.eventWave,
        state: inst.state,
        pose: poseName(inst),
        alerted: !!inst.alerted,
        broodTimerDefined: Number.isFinite(inst.broodTimer),
        broodTimer: Number.isFinite(inst.broodTimer) ? inst.broodTimer : null,
        broodCount: (inst.broodKids || []).filter((kid) =>
          kid && kid.state !== "death" && kid.health > 0).length,
        rootScale: [inst.root.scale.x, inst.root.scale.y, inst.root.scale.z],
        baseScale,
        rootY: inst.root.position.y,
        groundY: inst.y,
        rootRotation: [inst.root.rotation.x, inst.root.rotation.y, inst.root.rotation.z],
        emergence: e ? {
          active: !!e.active,
          surfaced: !!e.surfaced,
          burst: !!e.burst,
          elapsed: e.elapsed,
          delay: e.delay,
          duration: e.duration,
          depth: e.depth,
          baseScale: e.baseScale,
        } : null,
        expectedScale,
        progressionError,
        expectedPose,
        poseProgressionError,
        record,
        controlEventWave: recordFor(controlId, enemySnapshot)?.eventWave ?? null,
        enemyRng: clone(enemySnapshot.rng),
        breach: clone(T.breachState()),
        roster: {
          count: enemySnapshot.live.length,
          unique: new Set(enemySnapshot.live.map((enemy) => enemy.id)).size,
          ids: enemySnapshot.live.map((enemy) => enemy.id),
        },
      };
    };

    T.invulnerable(true);
    T.clearEnemies();
    T.setBreachAuto(false);
    const control = T.enemies.spawn("thresher", -850, -850, { yaw: 0.25 });
    const controlId = control?.id || null;
    const ps = T.player.state;
    const launched = T.startBreachWave(4, ps.x, ps.z - 44, false);
    const launchedBoss = bossObject();
    if (!launchedBoss || !controlId) return { setupError: "final-wave launch failed" };

    const warningBefore = inspectBoss(controlId);
    const warningSnapshot = T.saves.capture();
    if (!warningSnapshot) return { setupError: "warning snapshot was unavailable" };
    const warningSavedRecord = recordFor(launchedBoss.id, warningSnapshot.enemies);
    const warningControlRecord = recordFor(controlId, warningSnapshot.enemies);
    const warningApplied = T.saves.apply(warningSnapshot);
    T.invulnerable(true);
    const warningRestored = inspectBoss(controlId);

    const warningRemaining = Math.max(0.1, T.breachState().timer + 0.18);
    T.advanceTime(warningRemaining, 1 / 60);
    const activeBefore = inspectBoss(controlId);
    const activeSnapshot = T.saves.capture();
    if (!activeSnapshot) return { setupError: "active-rise snapshot was unavailable" };
    const activeSavedRecord = recordFor(activeBefore.id, activeSnapshot.enemies);
    let restoreBreachFx = 0;
    let restoreBroodEvents = 0;
    const originalBreachFx = T.vfx.breach;
    const offRestoreBrood = T.combat.bus.on("brood", () => { restoreBroodEvents += 1; });
    T.vfx.breach = (...effectArgs) => {
      restoreBreachFx += 1;
      return originalBreachFx(...effectArgs);
    };
    let activeApplied;
    try {
      activeApplied = T.saves.apply(activeSnapshot);
    } finally {
      T.vfx.breach = originalBreachFx;
      offRestoreBrood();
    }
    T.invulnerable(true);
    const activeRestoredImmediate = inspectBoss(controlId);
    T.advanceTime(1 / 60, 1 / 60);
    const activeRestoredStep = inspectBoss(controlId);

    const surfacedBoss = bossObject();
    const nearX = surfacedBoss.x;
    const nearZ = surfacedBoss.z + 10;
    const open = T.collide.findOpen(nearX, nearZ,
      T.collide.groundHeight(nearX, nearZ), 24, 12, 0.48);
    T.player.spawn(open?.[0] ?? nearX, open?.[1] ?? nearZ, Math.PI);
    let broodEvents = 0;
    const offBrood = T.combat.bus.on("brood", () => { broodEvents += 1; });
    let surfaceFrames = 0;
    while (bossObject()?.emerging?.active && surfaceFrames < 360) {
      T.advanceTime(1 / 60, 1 / 60);
      surfaceFrames += 1;
    }
    const surfaced = inspectBoss(controlId);
    const broodEventsAtSurface = broodEvents;
    const tailSnapshot = T.saves.capture();
    if (!tailSnapshot) {
      offBrood();
      return { setupError: "post-surface tail snapshot was unavailable" };
    }
    const tailSavedRecord = recordFor(surfaced.id, tailSnapshot.enemies);
    const tailApplied = T.saves.apply(tailSnapshot);
    T.invulnerable(true);
    const tailRestored = inspectBoss(controlId);
    T.advanceTime(0.3, 1 / 60);
    const tailAdvanced = inspectBoss(controlId);
    const broodEventsAfterTail = broodEvents;
    offBrood();

    return {
      launched,
      controlId,
      warning: {
        before: warningBefore,
        savedRecord: warningSavedRecord,
        savedControl: warningControlRecord,
        savedEnemyRng: clone(warningSnapshot.enemies.rng),
        savedBreachRng: clone(warningSnapshot.breaches.rng),
        applied: warningApplied,
        restored: warningRestored,
      },
      active: {
        before: activeBefore,
        savedRecord: activeSavedRecord,
        savedEnemyRng: clone(activeSnapshot.enemies.rng),
        savedBreachRng: clone(activeSnapshot.breaches.rng),
        applied: activeApplied,
        restoreEffects: { breachFx: restoreBreachFx, brood: restoreBroodEvents },
        restoredImmediate: activeRestoredImmediate,
        restoredStep: activeRestoredStep,
      },
      surface: {
        frames: surfaceFrames,
        state: surfaced,
        broodEvents: broodEventsAtSurface,
      },
      tail: {
        savedRecord: tailSavedRecord,
        savedEnemyRng: clone(tailSnapshot.enemies.rng),
        savedBreachRng: clone(tailSnapshot.breaches.rng),
        applied: tailApplied,
        restored: tailRestored,
        advanced: tailAdvanced,
        broodEvents: broodEventsAfterTail,
      },
      lastResult: T.persistenceState()?.lastResult || null,
    };
  });
  evidence.emergenceLifecycleRoundtrip = probe;
  check("warning Matriarch snapshot keeps authored scale and null lifecycle metadata",
    !probe.setupError
      && probe.warning?.before?.breach?.phase === "warning"
      && probe.warning?.before?.emergence?.active === true
      && probe.warning?.before?.broodTimerDefined === false
      && probe.warning?.savedRecord?.scale === 1
      && probe.warning?.savedRecord?.broodTimer === null
      && probe.warning?.savedRecord?.eventWave === 4
      && probe.warning?.savedControl?.eventWave === null
      && probe.warning?.savedEnemyRng?.spare === null
      && probe.warning?.savedBreachRng?.spare === null,
    JSON.stringify({ setupError: probe.setupError, before: probe.warning?.before,
      savedRecord: probe.warning?.savedRecord, savedControl: probe.warning?.savedControl,
      enemyRng: probe.warning?.savedEnemyRng, breachRng: probe.warning?.savedBreachRng }));
  check("warning roundtrip reconstructs the authored base at the initial emergence scale",
    probe.warning?.applied === true
      && probe.warning?.restored?.emergence?.active === true
      && closeEnough(probe.warning?.restored?.emergence?.baseScale, 1, 0.0001)
      && closeEnough(probe.warning?.restored?.rootScale?.[0], 0.68, 0.0001)
      && closeEnough(probe.warning?.restored?.rootScale?.[1], 0.68, 0.0001)
      && closeEnough(probe.warning?.restored?.rootScale?.[2], 0.68, 0.0001)
      && probe.warning?.restored?.progressionError < 0.0001
      && probe.warning?.restored?.broodTimerDefined === false
      && probe.warning?.restored?.eventWave === 4
      && probe.warning?.restored?.controlEventWave === null
      && probe.warning?.restored?.enemyRng?.spare === null
      && probe.warning?.restored?.breach?.rng?.spare === null,
    JSON.stringify({ applied: probe.warning?.applied, restored: probe.warning?.restored }));
  check("active-rise roundtrip resumes the authored emergence scale curve",
    probe.active?.before?.breach?.phase === "active"
      && probe.active?.before?.emergence?.active === true
      && probe.active?.before?.progressionError < 0.0001
      && probe.active?.savedRecord?.scale === 1
      && probe.active?.savedRecord?.broodTimer === null
      && probe.active?.savedRecord?.eventWave === 4
      && probe.active?.savedEnemyRng?.spare === null
      && probe.active?.savedBreachRng?.spare === null
      && probe.active?.applied === true
      && closeEnough(probe.active?.restoredImmediate?.emergence?.baseScale, 1, 0.0001)
      && probe.active?.restoredImmediate?.broodTimerDefined === false
      && probe.active?.restoredImmediate?.state === probe.active?.before?.state
      && probe.active?.restoredImmediate?.pose === probe.active?.before?.pose
      && probe.active?.restoredImmediate?.progressionError < 0.0001
      && probe.active?.restoredImmediate?.poseProgressionError < 0.0001
      && probe.active?.restoredImmediate?.rootScale?.every((scale, index) =>
        closeEnough(scale, probe.active?.before?.rootScale?.[index], 0.0005))
      && closeEnough(probe.active?.restoredImmediate?.rootY,
        probe.active?.before?.rootY, 0.0005)
      && closeEnough(probe.active?.restoredImmediate?.rootRotation?.[0],
        probe.active?.before?.rootRotation?.[0], 0.0005)
      && closeEnough(probe.active?.restoredImmediate?.rootRotation?.[2],
        probe.active?.before?.rootRotation?.[2], 0.0005)
      && probe.active?.restoreEffects?.breachFx === 0
      && probe.active?.restoreEffects?.brood === 0
      && probe.active?.restoredStep?.progressionError < 0.0001
      && probe.active?.restoredStep?.poseProgressionError < 0.0001
      && probe.active?.restoredStep?.broodTimerDefined === false,
    JSON.stringify({ before: probe.active?.before, savedRecord: probe.active?.savedRecord,
      applied: probe.active?.applied, restoreEffects: probe.active?.restoreEffects,
      immediate: probe.active?.restoredImmediate,
      stepped: probe.active?.restoredStep }));
  check("loaded Matriarch surfaces at authored scale with the initial brood delay",
    probe.surface?.frames > 0 && probe.surface?.frames < 360
      && probe.surface?.state?.emergence?.active === false
      && probe.surface?.state?.emergence?.surfaced === true
      && closeEnough(probe.surface?.state?.rootScale?.[0], 1, 0.0001)
      && closeEnough(probe.surface?.state?.rootScale?.[1], 1, 0.0001)
      && closeEnough(probe.surface?.state?.rootScale?.[2], 1, 0.0001)
      && probe.surface?.state?.broodTimerDefined === true
      && probe.surface?.state?.broodTimer > 7.5
      && probe.surface?.state?.broodTimer < 7.7
      && probe.surface?.state?.broodCount === 0
      && probe.surface?.broodEvents === 0
      && probe.surface?.state?.roster?.count === 6,
    JSON.stringify(probe.surface));
  check("inactive post-surface tail reloads as a full-scale upright alert pose",
    probe.tail?.savedRecord?.emergence?.active === false
      && probe.tail?.savedRecord?.emergence?.surfaced === true
      && probe.tail?.savedRecord?.scale === 1
      && probe.tail?.applied === true
      && probe.tail?.restored?.emergence === null
      && probe.tail?.restored?.state === "alert"
      && probe.tail?.restored?.pose === "alert"
      && probe.tail?.restored?.alerted === true
      && closeEnough(probe.tail?.restored?.rootScale?.[0], 1, 0.0001)
      && closeEnough(probe.tail?.restored?.rootScale?.[1], 1, 0.0001)
      && closeEnough(probe.tail?.restored?.rootScale?.[2], 1, 0.0001)
      && closeEnough(probe.tail?.restored?.rootY, probe.tail?.restored?.groundY, 0.0001)
      && closeEnough(probe.tail?.restored?.rootRotation?.[0], 0, 0.0001)
      && closeEnough(probe.tail?.restored?.rootRotation?.[2], 0, 0.0001),
    JSON.stringify({ savedRecord: probe.tail?.savedRecord, applied: probe.tail?.applied,
      restored: probe.tail?.restored }));
  check("post-surface tail roundtrip preserves roster metadata without brood replay",
    probe.tail?.restored?.eventWave === 4
      && probe.tail?.restored?.controlEventWave === null
      && probe.tail?.restored?.enemyRng?.spare === null
      && probe.tail?.restored?.breach?.rng?.spare === null
      && probe.tail?.restored?.roster?.count === 6
      && probe.tail?.restored?.roster?.unique === 6
      && probe.tail?.advanced?.rootScale?.every((scale) => closeEnough(scale, 1, 0.0001))
      && probe.tail?.advanced?.state === "alert"
      && probe.tail?.advanced?.pose === "alert"
      && probe.tail?.advanced?.broodCount === 0
      && probe.tail?.advanced?.broodTimer > 7
      && probe.tail?.broodEvents === 0
      && probe.lastResult?.type === "loaded",
    JSON.stringify({ restored: probe.tail?.restored, advanced: probe.tail?.advanced,
      broodEvents: probe.tail?.broodEvents, lastResult: probe.lastResult }));
  await page.close();
  await context.close();
}

async function activeBreachCompatibilityPass(browser) {
  console.log("\n=== ACTIVE MATRIARCH BREACH SAVE COMPATIBILITY ===");
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await bootPage(context, "active-breach");
  const probe = await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(true);
    T.clearEnemies();
    T.setBreachAuto(false);
    const ps = T.player.state;
    const launched = T.startBreachWave(4, ps.x, ps.z - 44, true);
    T.advanceTime(0.12, 1 / 60);

    const before = T.breachState();
    const emergingBefore = T.enemies.live.filter((enemy) => enemy.emerging?.active)
      .map((enemy) => enemy.id);
    const saved = T.saveSlot(0);
    const savedEnemyIds = (saved?.enemies?.live || []).map((enemy) => enemy.id);
    const savedEmergingIds = (saved?.enemies?.live || [])
      .filter((enemy) => enemy.emergence?.active).map((enemy) => enemy.id);

    const removed = T.enemies.live.find((enemy) =>
      before.memberIds.includes(enemy.id) && enemy.id !== before.bossId);
    const removedId = removed?.id || null;
    if (removed) T.enemies.remove(removed);
    const extra = T.enemies.spawn("thresher", ps.x + 18, ps.z + 18, { yaw: 0.4 });
    const mutated = {
      count: T.enemies.live.length,
      removedId,
      extraId: extra?.id || null,
    };

    const loaded = T.loadSlot(0);
    const after = T.breachState();
    const idsAfter = T.enemies.live.map((enemy) => enemy.id);
    const emergingAfter = T.enemies.live.filter((enemy) => enemy.emerging?.active)
      .map((enemy) => enemy.id);
    const afterBossObjectId = T.breaches.state.boss?.id || null;

    /* Finish the restored final wave through the authoritative damage path,
       then round-trip the system-produced terminal shape. This is the
       positive companion to the impossible phase/wave/boss payloads. */
    T.advanceTime(7, 1 / 60);
    const finalMemberIds = T.breachState().memberIds.slice();
    for (const id of finalMemberIds) {
      const member = T.enemies.live.find((enemy) => enemy.id === id);
      if (member) T.combat.damageEnemy(member, member.health + 1000, {
        source: "complete-breach-save-qa",
      });
    }
    const emptyFinalActive = T.breachState();
    T.advanceTime(0.05, 1 / 60);
    const completeBefore = T.breachState();
    const completeSaved = T.saves.capture();
    const completeApplied = completeSaved ? T.saves.apply(completeSaved) : false;
    const completeAfter = T.breachState();
    const completeEnemies = T.enemies.snapshot();
    return {
      launched,
      before,
      emergingBefore,
      saved: saved ? {
        schema: saved.schema,
        phase: saved.breaches?.phase,
        wave: saved.breaches?.wave,
        waveIndex: saved.breaches?.waveIndex,
        memberIds: saved.breaches?.memberIds,
        bossId: saved.breaches?.bossId,
        enemyCount: savedEnemyIds.length,
        enemyIds: savedEnemyIds,
        emergingIds: savedEmergingIds,
      } : null,
      mutated,
      loaded,
      after,
      afterBossObjectId,
      enemiesAfter: {
        count: idsAfter.length,
        unique: new Set(idsAfter).size,
        ids: idsAfter,
        emergingIds: emergingAfter,
        extraPresent: !!extra && idsAfter.includes(extra.id),
      },
      terminal: {
        killedMemberIds: finalMemberIds,
        emptyFinalActive,
        before: completeBefore,
        saved: completeSaved?.breaches || null,
        savedEnemyCount: completeSaved?.enemies?.live?.length ?? null,
        applied: completeApplied,
        after: completeAfter,
        enemyCount: completeEnemies.live.length,
        unique: new Set(completeEnemies.live.map((enemy) => enemy.id)).size,
        lastResult: T.persistenceState()?.lastResult?.type || null,
      },
      lastResult: T.persistenceState()?.lastResult || null,
    };
  });
  evidence.activeBreachCompatibility = probe;
  const sorted = (values) => (values || []).slice().sort();
  const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
  check("active Matriarch emergence produces a legitimate field snapshot",
    probe.before?.phase === "active" && probe.before?.waveIndex === 4
      && probe.before?.bossId && probe.before?.memberIds?.length === 5
      && probe.emergingBefore.length > 0
      && probe.saved?.schema === 2 && probe.saved?.phase === "active"
      && probe.saved?.bossId === probe.before.bossId
      && same(probe.saved?.memberIds, probe.before?.memberIds)
      && same(probe.saved?.emergingIds, probe.emergingBefore),
    JSON.stringify({ before: probe.before, emergingBefore: probe.emergingBefore,
      saved: probe.saved }));
  check("validated active-breach snapshot loads with phase, wave, members, and boss intact",
    probe.loaded && probe.lastResult?.type === "loaded"
      && probe.after?.phase === probe.saved?.phase
      && probe.after?.wave === probe.saved?.wave
      && probe.after?.waveIndex === probe.saved?.waveIndex
      && same(probe.after?.memberIds, probe.saved?.memberIds)
      && probe.after?.bossId === probe.saved?.bossId
      && probe.afterBossObjectId === probe.saved?.bossId,
    JSON.stringify({ loaded: probe.loaded, after: probe.after,
      bossObject: probe.afterBossObjectId, lastResult: probe.lastResult?.type }));
  check("active-breach load replaces mutations without enemy duplication or emergence loss",
    probe.enemiesAfter?.count === probe.saved?.enemyCount
      && probe.enemiesAfter?.unique === probe.saved?.enemyCount
      && same(probe.enemiesAfter?.ids, probe.saved?.enemyIds)
      && same(probe.enemiesAfter?.emergingIds, probe.saved?.emergingIds)
      && !probe.enemiesAfter?.extraPresent
      && probe.mutated?.removedId && probe.mutated?.extraId,
    JSON.stringify({ savedCount: probe.saved?.enemyCount, mutated: probe.mutated,
      after: probe.enemiesAfter }));
  check("legitimate complete breach shape loads successfully",
    probe.terminal?.killedMemberIds?.length === 5
      && probe.terminal?.emptyFinalActive?.phase === "active"
      && probe.terminal?.emptyFinalActive?.remaining === 0
      && probe.terminal?.emptyFinalActive?.memberIds?.length === 0
      && probe.terminal?.before?.phase === "complete"
      && probe.terminal?.before?.wave === 5
      && probe.terminal?.before?.waveIndex === 4
      && probe.terminal?.before?.remaining === 0
      && probe.terminal?.before?.memberIds?.length === 0
      && probe.terminal?.before?.complete === true
      && probe.terminal?.before?.bossId === null
      && probe.terminal?.before?.boss === null
      && probe.terminal?.saved?.phase === "complete"
      && probe.terminal?.saved?.wave === 5
      && probe.terminal?.saved?.waveIndex === 4
      && probe.terminal?.saved?.complete === true
      && probe.terminal?.saved?.bossId === null
      && probe.terminal?.saved?.boss === null
      && probe.terminal?.applied === true
      && probe.terminal?.after?.phase === "complete"
      && probe.terminal?.after?.wave === 5
      && probe.terminal?.after?.waveIndex === 4
      && probe.terminal?.after?.remaining === 0
      && probe.terminal?.after?.memberIds?.length === 0
      && probe.terminal?.after?.complete === true
      && probe.terminal?.after?.bossId === null
      && probe.terminal?.after?.boss === null
      && probe.terminal?.enemyCount === probe.terminal?.savedEnemyCount
      && probe.terminal?.unique === probe.terminal?.savedEnemyCount
      && probe.terminal?.lastResult === "loaded",
    JSON.stringify(probe.terminal));
  await page.close();
  await context.close();
}

async function coldReloadPass(context, firstPage, setup) {
  console.log("\n=== COLD PAGE / LOCALSTORAGE RESTORE ===");
  await firstPage.close();
  const page = await bootPage(context, "cold-reload");
  const state = await page.evaluate(() => {
    const T = window.__SF;
    const slotBefore = T.persistenceState()?.manuals?.[0] || null;
    const loaded = T.loadSlot(0);
    const ids = T.enemies.live.map((enemy) => enemy.id);
    return {
      slotBefore: slotBefore ? {
        id: slotBefore.id,
        schema: slotBefore.snapshot?.schema,
        timestamp: slotBefore.snapshot?.timestamp,
      } : null,
      loaded,
      enemies: { count: ids.length, ids, unique: new Set(ids).size },
      mission: T.mission.snapshot(),
      combat: T.combat.snapshot(),
      weapon: T.weapons.snapshot(),
      jetpack: T.jetpackState(),
      lastResult: T.persistenceState()?.lastResult || null,
    };
  });
  evidence.coldReload = state;
  const expected = {
    enemies: {
      ids: (setup.saved?.enemies?.live || []).map((enemy) => enemy.id).sort(),
      count: setup.saved?.enemies?.live?.length || 0,
    },
  };
  check("manual slot survives a cold page boot through localStorage",
    state.slotBefore?.schema === 2 && state.slotBefore?.timestamp === setup.saved.timestamp,
    JSON.stringify(state.slotBefore));
  check("cold page load restores relay, cooldown, HP, weapon, and jetpack state",
    state.loaded && state.lastResult?.type === "loaded"
      && missionMatches(state.mission, setup.saved.mission)
      && combatMatches(state.combat, setup.saved.combat)
      && weaponMatches(state.weapon, setup.saved.weapon)
      && jetpackMatches(state.jetpack, setup.saved.reliquary),
    JSON.stringify({ mission: state.mission, combat: state.combat,
      weapon: state.weapon, jetpack: state.jetpack, lastResult: state.lastResult }));
  check("cold page load recreates one exact enemy roster with the killed enemy absent",
    state.enemies.count === expected.enemies.count
      && state.enemies.unique === expected.enemies.count
      && sameIds(state, expected)
      && !state.enemies.ids.includes(setup.victim.id),
    JSON.stringify({ expectedCount: expected.enemies.count, actual: state.enemies,
      killedId: setup.victim.id }));
  return page;
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
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    let page = await bootPage(context, "initial");
    await invalidPayloadPass(page);
    const setup = await createDurableScenario(page);
    await corruptEnvelopePass(page);
    await repeatedLoadPass(page, setup);
    await meleeCancellationPass(page);
    await transactionalRollbackPass(page);
    page = await coldReloadPass(context, page, setup);
    await page.close();
    await context.close();
    await deadStateRollbackPass(browser);
    await pendingCommandRollbackPass(browser);
    await emptyActiveBreachRoundtripPass(browser);
    await emergenceLifecycleRoundtripPass(browser);
    await activeBreachCompatibilityPass(browser);
  } finally {
    await browser.close();
  }

  check("no page errors", diagnostics.pageErrors.length === 0,
    diagnostics.pageErrors.slice(0, 6).join(" | "));
  check("no console errors", diagnostics.consoleErrors.length === 0,
    diagnostics.consoleErrors.slice(0, 6).join(" | "));

  const report = {
    gameUrl: GAME_URL,
    assertions: results.length,
    passed: results.length - failed,
    failed,
    results,
    diagnostics,
    evidence,
  };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(`\n${report.passed}/${report.assertions} checks passed`);
  console.log(`Report: ${path.join(OUT, "report.json")}`);
  if (failed) process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
