#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Doctrine feedback regression

   A definition-driven acceptance gate for all twenty ranked rites and
   five capstone Vows. QA helpers establish the loadout and deterministic
   boundary conditions; every feedback event is then caused by a production
   combat, movement, shield, weapon, or mission path.

   Usage:
     node scripts/saintfall-talent-feedback.mjs
     node scripts/saintfall-talent-feedback.mjs --out output/saintfall/talent-feedback
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).join(" ").split("--").filter(Boolean)
    .map((part) => part.trim().split(/\s+/)).map(([key, value]) => [key, value ?? true])
);
const OUT = path.resolve(root, args.out || "output/saintfall/talent-feedback");
const WING_ONLY = args["wing-only"] === true || args["wing-only"] === "true";
const PORT = 57000 + (process.pid % 4000);
const BASE = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE}/games/saintfall.html?qa=1&quality=high&intro=skip&seed=talent-feedback-v1`;
const results = [];
const diagnostics = {
  pageErrors: [], consoleErrors: [], externalWarnings: [], fatal: null,
};
const evidence = { contracts: {}, desktop: {}, mobile: {} };
let failed = 0;

const ORDER_CONTRACTS = Object.freeze({
  censer: Object.freeze({
    ids: Object.freeze([
      "censer_rite_of_censure",
      "censer_ashen_rebuke",
      "censer_gold_nail",
      "censer_furnace_reprieve",
      "censer_martyrs_furnace",
    ]),
    cues: Object.freeze({
      censer_rite_of_censure: ["brand", "brand-break"],
      censer_ashen_rebuke: ["vent"],
      censer_gold_nail: ["heatless"],
      censer_furnace_reprieve: ["reprieve"],
      censer_martyrs_furnace: ["martyr"],
    }),
  }),
  procession: Object.freeze({
    ids: Object.freeze([
      "procession_hooking_step",
      "procession_third_toll",
      "procession_executioners_measure",
      "procession_processional_mercy",
      "procession_endless_litany",
    ]),
    cues: Object.freeze({
      procession_hooking_step: ["hook"],
      procession_third_toll: ["toll"],
      procession_executioners_measure: ["expose"],
      procession_processional_mercy: ["mercy"],
      procession_endless_litany: ["litany"],
    }),
  }),
  wing: Object.freeze({
    ids: Object.freeze([
      "wing_wingbeat_conversion",
      "wing_falling_gospel",
      "wing_gravitic_wake",
      "wing_rams_halo",
      "wing_unbroken_circuit",
    ]),
    cues: Object.freeze({
      wing_wingbeat_conversion: ["conversion"],
      wing_falling_gospel: ["feather"],
      wing_gravitic_wake: ["wake"],
      wing_rams_halo: ["ram"],
      wing_unbroken_circuit: ["circuit"],
    }),
  }),
  halo: Object.freeze({
    ids: Object.freeze([
      "halo_votive_parry",
      "halo_stored_wrath",
      "halo_pilgrims_reversal",
      "halo_mercy_circuit",
      "halo_seraph_aegis",
    ]),
    cues: Object.freeze({
      halo_votive_parry: ["parry"],
      halo_stored_wrath: ["wrath-store", "wrath-release"],
      halo_pilgrims_reversal: ["reversal"],
      halo_mercy_circuit: ["mercy"],
      halo_seraph_aegis: ["dome", "seraph"],
    }),
  }),
  edict: Object.freeze({
    ids: Object.freeze([
      "edict_siren_beacon",
      "edict_live_fuse",
      "edict_recall_rite",
      "edict_field_chapel",
      "edict_combined_liturgy",
    ]),
    cues: Object.freeze({
      edict_siren_beacon: ["siren"],
      edict_live_fuse: ["fuse"],
      edict_recall_rite: ["recall"],
      edict_field_chapel: ["chapel"],
      edict_combined_liturgy: ["sigil", "fusion"],
    }),
  }),
});

const ALL_CONTRACT_IDS = Object.values(ORDER_CONTRACTS).flatMap((order) => order.ids);

function check(name, ok, detail = "") {
  const pass = !!ok;
  results.push({ name, ok: pass, detail });
  if (!pass) failed += 1;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  if (detail) console.log(`        ${detail}`);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sameIds(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function activeDoctrineVfx(state) {
  return Object.values(record(state?.pools))
    .reduce((sum, pool) => sum + Math.max(0, finite(pool?.active)), 0);
}

function doctrinePoolCapacity(state) {
  return Object.values(record(state?.pools))
    .reduce((sum, pool) => sum + Math.max(0, finite(pool?.capacity)), 0);
}

function audioCueCount(state, cue) {
  return Math.max(0, finite(state?.doctrine?.cueCounts?.[cue]));
}

function nearPoint(left, right, tolerance = 0.08) {
  if (!left || !right) return false;
  return Math.hypot(finite(left.x) - finite(right.x),
    finite(left.y) - finite(right.y), finite(left.z) - finite(right.z)) <= tolerance;
}

function normalizeDefinitions(raw) {
  const source = record(raw?.config || raw?.definitions || raw);
  const doctrine = record(source.doctrine || source);
  const field = record(source.fieldRank || doctrine.fieldRank);
  const orderSource = Array.isArray(doctrine.orders) ? doctrine.orders
    : Object.values(record(doctrine.orders));
  return {
    rankCap: Math.max(1, Math.floor(finite(field.cap, 25))),
    thresholds: (field.xpThresholds || []).map((value) => finite(value)),
    maxPointsPerOrder: Math.max(1, Math.floor(finite(doctrine.maxPointsPerOrder, 8))),
    orders: orderSource.map((rawOrder) => {
      const order = record(rawOrder);
      return {
        id: String(order.id || ""),
        talents: (order.talents || []).map((talent) => ({
          id: String(talent.id || ""),
          implemented: talent.implemented !== false,
          maxRank: Math.max(1, Math.floor(finite(talent.maxRank, 1))),
          requiredPoints: Math.max(0, Math.floor(finite(
            talent.requires?.orderPoints, talent.requiredPoints || 0
          ))),
        })).filter((talent) => talent.id),
        capstone: order.capstone?.id ? {
          id: String(order.capstone.id),
          implemented: order.capstone.implemented !== false,
        } : null,
      };
    }).filter((order) => order.id),
  };
}

function attachDiagnostics(page, label) {
  page.on("pageerror", (error) => diagnostics.pageErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location?.();
    const entry = `${label}: ${message.text()}`
      + (location?.url ? ` @ ${location.url}:${location.lineNumber || 0}` : "");
    if (/fonts\.(?:gstatic|googleapis)\.com/.test(location?.url || entry)) {
      diagnostics.externalWarnings.push(entry);
      return;
    }
    diagnostics.consoleErrors.push(entry);
  });
}

async function invoke(page, method, ...methodArgs) {
  return await page.evaluate(({ name, values }) => {
    const fn = window.__SF?.[name];
    return typeof fn === "function" ? fn(...values)
      : { ok: false, reason: `missing-${name}` };
  }, { name: method, values: methodArgs });
}

async function bootPage(context, label) {
  const page = await context.newPage();
  attachDiagnostics(page, label);
  await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    T.invulnerable(true);
    T.setTime("day");
    T.setDayCycleRunning(false);
    T.setStorm(0);
    T.setQuality("high");
    document.getElementById("sf-boot")?.remove();
  });
  /* The keydown is the real browser gesture. `unlock()` only awaits the
     context transition that gesture authorized; it does not fabricate it. */
  await page.keyboard.press("KeyF");
  await page.evaluate(async () => {
    await window.__SF?.ctx?.audio?.unlock?.({ ambience: false });
  });
  const hooks = await page.evaluate(() => {
    const T = window.__SF;
    return {
      progressionBus: typeof T?.progression?.bus?.on === "function",
      doctrineCue: typeof T?.vfx?.doctrineCue === "function",
      doctrineState: typeof T?.vfx?.doctrineState === "function",
      playerPulse: typeof T?.player?.pulseDoctrine === "function",
      audioState: typeof T?.audioState === "function",
      audioRunning: T?.audioState?.()?.state || null,
    };
  });
  check(`${label} exposes Doctrine feedback observability`,
    hooks.progressionBus && hooks.doctrineCue && hooks.doctrineState
      && hooks.playerPulse && hooks.audioState,
    JSON.stringify(hooks));
  return page;
}

async function prepareOrder(page, definitions, orderId) {
  await invoke(page, "resetProgressionForQA");
  const order = definitions.orders.find((candidate) => candidate.id === orderId);
  if (!order) return { ok: false, reason: "missing-order" };
  const targetXp = definitions.thresholds[definitions.rankCap - 1];
  const grant = await invoke(page, "grantProgressionXpForQA", targetXp,
    `qa:talent-feedback:${orderId}`);
  const attempts = [];
  let invested = 0;
  for (let guard = 0; guard < 40 && invested < definitions.maxPointsPerOrder; guard += 1) {
    const state = await invoke(page, "progressionState");
    const allocations = record(state?.allocations);
    invested = order.talents.reduce((sum, talent) =>
      sum + Math.max(0, Math.floor(finite(allocations[talent.id]))), 0);
    if (invested >= definitions.maxPointsPerOrder) break;
    const talent = order.talents.find((candidate) => candidate.implemented
      && finite(allocations[candidate.id]) < candidate.maxRank
      && candidate.requiredPoints <= invested);
    if (!talent) break;
    const response = await invoke(page, "spendTalentForQA", talent.id);
    attempts.push({ id: talent.id, ok: response?.ok === true });
  }
  const equip = order.capstone
    ? await invoke(page, "equipCapstoneForQA", order.capstone.id, 0) : null;
  const state = await invoke(page, "progressionState");
  const owned = order.talents.filter((talent) => finite(state?.allocations?.[talent.id]) > 0)
    .map((talent) => talent.id);
  return {
    ok: grant?.ok === true
      && owned.length === order.talents.length
      && order.talents.reduce((sum, talent) =>
        sum + finite(state?.allocations?.[talent.id]), 0) === definitions.maxPointsPerOrder
      && equip?.ok === true
      && state?.activeCapstones?.includes(order.capstone?.id),
    order,
    owned,
    equip,
    attempts,
    state,
  };
}

async function captureWingNoTalentBaseline(page) {
  await invoke(page, "resetProgressionForQA");
  return await page.evaluate(() => {
    const T = window.__SF;
    const baseMission = {
      phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
      elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
      relays: [], cooldowns: {}, pending: [],
    };
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({ ...event }));
    T.clearEnemies();
    T.mission.restore(baseMission);
    T.mission.group.visible = false;
    T.setJetInput(false);
    T.setShieldInput(false);
    T.setBoostHold(false);
    T.resetBoost(true);
    T.resetSlam(true);
    T.shield.reset(true);
    T.jetpack.reset(true);
    T.invulnerable(true);
    T._teleportRaw(-12, 830, 0);
    T.setBodyHeading(0);
    const ps = T.player.state;
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
    T.setGaitInput(1, 0);
    const boost = T.triggerBoost(1, 0);
    T.renderOnce(1 / 60);
    const orbit = T.safeOrbit(ps.x, ps.z, ps.y + 1.05,
      -Math.PI / 2, 7.2, 0.18, 48);
    const capturePlayer = { x: ps.x, y: ps.y, z: ps.z };
    T.renderStill();
    const cameraWorld = T.render.camera.position.toArray();
    const targetWorld = orbit.target;
    const cameraRelative = cameraWorld.map((value, index) =>
      value - [ps.x, ps.y, ps.z][index]);
    const targetRelative = targetWorld.map((value, index) =>
      value - [ps.x, ps.y, ps.z][index]);
    const projected = new T.THREE.Vector3(ps.x, ps.y + 1.05, ps.z)
      .project(T.render.camera).toArray();
    const result = {
      image: T.captureDataURL(),
      noTalent: Object.keys(T.progressionState()?.allocations || {}).length === 0,
      events,
      boost,
      jetpack: T.jetpackState(),
      player: capturePlayer,
      orbit,
      projected,
      playerInFrame: Math.abs(projected[0]) <= 0.72
        && Math.abs(projected[1]) <= 0.72
        && projected[2] >= -1 && projected[2] <= 1,
      cameraRelative,
      targetRelative,
      missionVisible: T.mission.group.visible,
    };
    T.releaseCamera();
    T.mission.group.visible = true;
    T.setJetInput(false);
    T.setBoostHold(false);
    T.setGaitInput(null, null);
    T.resetBoost(true);
    T.jetpack.reset(true);
    stop?.();
    return result;
  });
}

async function runProcessionScenario(page) {
  const before = await page.evaluate(() => {
    const T = window.__SF;
    const number = (value, fallback = 0) => Number.isFinite(Number(value))
      ? Number(value) : fallback;
    const playerVisual = () => {
      const figure = T.player.figure;
      const heart = figure.heartLight;
      const eye = figure.eyeGlow?.material;
      const readable = figure.readabilityMaterials || [];
      return {
        heartIntensity: number(heart?.intensity),
        heartColour: heart?.color?.toArray?.() || null,
        eyeIntensity: number(eye?.emissiveIntensity),
        eyeColour: eye?.emissive?.toArray?.() || null,
        readability: readable.length
          ? readable.reduce((sum, material) => sum + number(material.emissiveIntensity), 0)
            / readable.length : 0,
      };
    };
    const snapshot = () => ({
      progression: T.progressionState(),
      vfx: T.vfx.doctrineState(),
      audio: T.audioState(),
      player: playerVisual(),
      image: T.captureDataURL(),
      render: T.report().render,
    });
    T.clearEnemies();
    T.mission.restore({
      phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
      elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
      relays: [], cooldowns: {}, pending: [],
    });
    T.setJetInput(false);
    T.setShieldInput(false);
    T.setBoostHold(false);
    T.resetBoost(true);
    T.resetSlam(true);
    T.shield.reset(true);
    T.jetpack.reset(true);
    T.invulnerable(true);
    T._teleportRaw(-12, 830, 0);
    T.setBodyHeading(0);
    T.setCam(0, -0.1, 5.8);
    T.autoStow(false);
    T.weapons.setMode("ranged");
    T.advanceTime(2.8, 1 / 60);
    T.renderStill();
    const events = [];
    const meleeEvents = [];
    const stopDoctrine = T.progression.bus.on("doctrine", (event) => events.push({
      ...event,
      qaPlayer: { x: T.player.state.x, y: T.player.state.y, z: T.player.state.z },
      qaAudio: T.audioState().doctrine,
    }));
    const stopMelee = T.combat.bus.on("melee", (event) => meleeEvents.push({
      comboStep: event.comboStep,
      hits: event.hits,
      kills: event.kills,
      targets: event.targets?.map((target) => ({
        enemyId: target.enemyId,
        enemyKey: target.enemyKey,
      })) || [],
    }));
    const heavy = T.enemies.spawn("harrow", -12, 832.7, {
      id: "qa-feedback-procession-heavy", health: 5000, yaw: Math.PI,
    });
    const light = T.enemies.spawn("thresher", -11.35, 832.45, {
      id: "qa-feedback-procession-kill", health: 1, yaw: Math.PI,
    });
    if (heavy) heavy.stunTime = 20;
    if (light) light.stunTime = 20;
    const baseline = snapshot();
    window.__SF_PROCESSION_FEEDBACK_QA = {
      events,
      meleeEvents,
      stopDoctrine,
      stopMelee,
      heavy,
      light,
      first: null,
      actions: [],
      snapshot,
    };
    return baseline;
  });

  async function pressAndResolve(expectedStep) {
    await page.keyboard.press("KeyF");
    return await page.evaluate((step) => {
      const T = window.__SF;
      const probe = window.__SF_PROCESSION_FEEDBACK_QA;
      T.renderOnce(1 / 120);
      const started = T.player.action;
      let frames = 0;
      for (; frames < 180; frames += 1) {
        T.renderOnce(1 / 120);
        if (!probe.first && probe.events.length > 0) probe.first = probe.snapshot();
        if (frames > 3 && !T.player.action) break;
      }
      const result = {
        expectedStep: step,
        started,
        frames,
        ended: !T.player.action,
        latestMelee: probe.meleeEvents.at(-1) || null,
      };
      probe.actions.push(result);
      return result;
    }, expectedStep);
  }

  const actions = [];
  actions.push(await pressAndResolve(1));
  actions.push(await pressAndResolve(2));
  actions.push(await pressAndResolve(3));
  await page.evaluate(() => {
    const T = window.__SF;
    const target = T.enemies.spawn("thresher", T.player.state.x,
      T.player.state.z + 2.7, {
        id: "qa-feedback-litany-target", health: 500, yaw: Math.PI,
      });
    if (target) target.stunTime = 20;
  });
  actions.push(await pressAndResolve(1));

  const result = await page.evaluate((resolvedActions) => {
    const T = window.__SF;
    const probe = window.__SF_PROCESSION_FEEDBACK_QA;
    T.renderOnce(1 / 60);
    const peak = probe.snapshot();
    const mechanics = {
      input: "page.keyboard.press(KeyF)",
      actions: resolvedActions,
      meleeEvents: probe.meleeEvents,
      weapon: {
        key: T.weapons.carry.key,
        mode: T.weapons.carry.record?.mode,
        melee: !!T.weapons.carry.record?.spec?.melee,
      },
      player: { x: T.player.state.x, y: T.player.state.y,
        z: T.player.state.z, yaw: T.player.state.yaw },
      heavy: probe.heavy ? { x: probe.heavy.x, y: probe.heavy.y, z: probe.heavy.z,
        health: probe.heavy.health, state: probe.heavy.state } : null,
      light: probe.light ? { x: probe.light.x, y: probe.light.y, z: probe.light.z,
        health: probe.light.health, state: probe.light.state } : null,
    };
    probe.stopDoctrine?.();
    probe.stopMelee?.();
    const events = [...probe.events];
    const first = probe.first;
    delete window.__SF_PROCESSION_FEEDBACK_QA;
    T.autoStow(true);
    T.clearEnemies();
    return { order: "procession", before: null, first, peak, events, mechanics };
  }, actions);
  result.before = before;
  return result;
}

async function runOrderScenario(page, orderId) {
  if (orderId === "procession") return await runProcessionScenario(page);
  return await page.evaluate((requestedOrder) => {
    const T = window.__SF;
    const baseMission = () => ({
      phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
      elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
      relays: [], cooldowns: {}, pending: [],
    });
    const playerVisual = () => {
      const figure = T.player.figure;
      const heart = figure.heartLight;
      const eye = figure.eyeGlow?.material;
      const readable = figure.readabilityMaterials || [];
      return {
        heartIntensity: finite(heart?.intensity),
        heartColour: heart?.color?.toArray?.() || null,
        eyeIntensity: finite(eye?.emissiveIntensity),
        eyeColour: eye?.emissive?.toArray?.() || null,
        readability: readable.length
          ? readable.reduce((sum, material) => sum + finite(material.emissiveIntensity), 0)
            / readable.length : 0,
      };
    };
    const finite = (value, fallback = 0) => Number.isFinite(Number(value))
      ? Number(value) : fallback;
    const vfxState = () => T.vfx.doctrineState?.() || null;
    const events = [];
    const fusionEvents = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({
      ...event,
      qaPlayer: { x: T.player.state.x, y: T.player.state.y, z: T.player.state.z },
      qaAudio: T.audioState().doctrine,
    }));
    const stopFusion = T.mission.bus.on("fusion", (event) => fusionEvents.push({
      event: JSON.parse(JSON.stringify(event)),
      audio: T.audioState().doctrine,
    }));
    T.clearEnemies();
    T.mission.restore(baseMission());
    T.setJetInput(false);
    T.setShieldInput(false);
    T.setBoostHold(false);
    T.resetBoost(true);
    T.resetSlam(true);
    T.shield.reset(true);
    T.jetpack.reset(true);
    T.invulnerable(true);
    T.teleport(655, 700, 0);
    T.player.state.grounded = true;
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
    T.advanceTime(2.8, 1 / 60);
    T.renderStill();

    const before = {
      progression: T.progressionState(),
      vfx: vfxState(),
      audio: T.audioState(),
      player: playerVisual(),
      image: T.captureDataURL(),
      render: T.report().render,
    };
    let first = null;
    let mechanics = null;
    const firstFeedbackFrame = () => {
      T.renderOnce(1 / 60);
      first = {
        eventCount: events.length,
        vfx: vfxState(),
        audio: T.audioState(),
        player: playerVisual(),
      };
    };

    if (requestedOrder === "censer") {
      T.weapons.setMode("ranged");
      const ps = T.player.state;
      const heavy = T.enemies.spawn("harrow", ps.x, ps.z + 3, {
        id: "qa-feedback-censer-heavy", health: 5000,
      });
      T.weapons.setHeat(0.72, { reason: "qa-feedback-censer" });
      T.combat.damageEnemy(heavy, 10, {
        source: "shot", head: true, x: heavy.x, y: heavy.y + 2, z: heavy.z,
      });
      firstFeedbackFrame();
      T.fireWeapon(1);
      const light = T.enemies.spawn("thresher", ps.x + 1, ps.z + 2.2, {
        id: "qa-feedback-censer-kill", health: 1,
      });
      T.weapons.setHeat(0.76, { reason: "qa-feedback-reprieve" });
      T.combat.damageEnemy(light, 999, {
        source: "shot", head: true, x: light.x, y: light.y + 1, z: light.z,
      });
      T.weapons.carry.venting = 0;
      T.weapons.setHeat(0.9, { reason: "qa-feedback-vent" });
      T.weapons.vent();
      T.combat.damageEnemy(heavy, 20, {
        source: "melee", x: heavy.x, y: heavy.y + 1, z: heavy.z,
      });
    } else if (requestedOrder === "procession") {
      const mode = T.weapons.setMode("melee");
      const ps = T.player.state;
      const heavy = T.enemies.spawn("harrow", ps.x, ps.z + 2.5, {
        id: "qa-feedback-procession-heavy", health: 5000,
      });
      const light = T.enemies.spawn("thresher", ps.x + 0.5, ps.z + 2.2, {
        id: "qa-feedback-procession-kill", health: 1,
      });
      const meleeEvents = [];
      const stopMelee = T.combat.bus.on("melee", (event) => meleeEvents.push({
        comboStep: event.comboStep, hits: event.hits, kills: event.kills,
        targets: event.targets?.map((target) => ({
          enemyId: target.enemyId, enemyKey: target.enemyKey,
        })) || [],
      }));
      const hits = [];
      hits.push(T.combat.meleeStrike(1, 2.4, false, 1.3, 1));
      firstFeedbackFrame();
      hits.push(T.combat.meleeStrike(1, 2.4, false, 1.3, 2));
      hits.push(T.combat.meleeStrike(1, 2.4, false, 1.3, 3));
      hits.push(T.combat.meleeStrike(1, 2.4, false, 1.3, 1));
      stopMelee?.();
      mechanics = {
        weapon: { key: T.weapons.carry.key, mode: T.weapons.carry.record?.mode,
          melee: !!T.weapons.carry.record?.spec?.melee, setMode: !!mode },
        player: { x: ps.x, y: ps.y, z: ps.z, yaw: ps.yaw },
        heavy: heavy ? { x: heavy.x, y: heavy.y, z: heavy.z,
          health: heavy.health, state: heavy.state, emerging: !!heavy.emerging?.active } : null,
        light: light ? { x: light.x, y: light.y, z: light.z,
          health: light.health, state: light.state, emerging: !!light.emerging?.active } : null,
        hits,
        meleeEvents,
      };
    } else if (requestedOrder === "wing") {
      T.mission.group.visible = false;
      T._teleportRaw(-12, 830, 0);
      T.setBodyHeading(0);
      const visualPlayer = T.player.state;
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      T.setGaitInput(1, 0);
      const visualBoost = T.triggerBoost(1, 0);
      firstFeedbackFrame();
      const orbit = T.safeOrbit(visualPlayer.x, visualPlayer.z,
        visualPlayer.y + 1.05, -Math.PI / 2, 7.2, 0.18, 48);
      const capturePlayer = {
        x: visualPlayer.x, y: visualPlayer.y, z: visualPlayer.z,
      };
      T.renderStill();
      const cameraWorld = T.render.camera.position.toArray();
      const targetWorld = orbit.target;
      const cameraRelative = cameraWorld.map((value, index) =>
        value - [visualPlayer.x, visualPlayer.y, visualPlayer.z][index]);
      const targetRelative = targetWorld.map((value, index) =>
        value - [visualPlayer.x, visualPlayer.y, visualPlayer.z][index]);
      const projected = new T.THREE.Vector3(visualPlayer.x,
        visualPlayer.y + 1.05, visualPlayer.z).project(T.render.camera).toArray();
      mechanics = {
        visualEffect: {
          image: T.captureDataURL(),
          boost: visualBoost,
          jetpack: T.jetpackState(),
          player: capturePlayer,
          orbit,
          projected,
          playerInFrame: Math.abs(projected[0]) <= 0.72
            && Math.abs(projected[1]) <= 0.72
            && projected[2] >= -1 && projected[2] <= 1,
          cameraRelative,
          targetRelative,
          missionVisible: T.mission.group.visible,
          eventCount: events.length,
        },
      };
      T.releaseCamera();
      T.mission.group.visible = true;
      T.setJetInput(false);
      T.setBoostHold(false);
      T.advanceTime(0.5, 1 / 120);
      T.resetBoost(true);
      T.setGaitInput(0, -1);
      T.triggerBoost(0, -1);
      T.setBoostHold(false);
      T.advanceTime(0.5, 1 / 120);
      T.resetBoost(true);
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
      T.setJetInput(false);
      T.renderOnce(1 / 120);
      T.setJetInput(true);
      T.renderOnce(1 / 120);
      const ps = T.player.state;
      const target = T.enemies.spawn("thresher", ps.x, ps.z + 3, {
        id: "qa-feedback-wing-kill", health: 1,
      });
      T.combat.damageEnemy(target, 999, {
        source: "shot", head: true, x: target.x, y: target.y + 1, z: target.z,
      });
      T.setJetInput(false);
      ps.y = T.collide.groundHeight(ps.x, ps.z) + 8;
      ps.vy = 0;
      ps.grounded = false;
      T.triggerSlam();
      for (let frame = 0; frame < 240; frame += 1) {
        T.renderOnce(1 / 120);
        const slam = T.slamState();
        if (!slam?.active && slam?.phase === "recover") break;
      }
      T.setGaitInput(null, null);
    } else if (requestedOrder === "halo") {
      T.invulnerable(false);
      const ps = T.player.state;
      const attacker = T.enemies.spawn("gleaner", ps.x, ps.z + 3, {
        id: "qa-feedback-halo-attacker", health: 500,
      });
      T.setShieldInput(true);
      T.renderOnce(1 / 120);
      T.combat.hurtPlayer(40, {
        source: "enemy-fire", enemyId: attacker.id, enemyKey: attacker.key,
        x: attacker.x, y: attacker.y + 1, z: attacker.z,
      });
      firstFeedbackFrame();
      T.setShieldInput(false);
      T.renderOnce(1 / 120);
      T.invulnerable(true);

      T.shield.reset(true);
      const relay = T.mission.relays[0];
      T.player.spawn(relay.x, relay.z, 0);
      T.player.state.grounded = true;
      T.setShieldInput(true);
      T.advanceTime(0.2, 1 / 120);
      T.setShieldInput(false);
      T.renderOnce(1 / 120);

      T.shield.reset(true);
      T.teleport(655, 700, 0);
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
      T.setShieldInput(true);
      T.advanceTime(1.06, 1 / 120);
      const domeTarget = T.enemies.spawn("thresher",
        T.player.state.x + 3, T.player.state.z, {
          id: "qa-feedback-seraph-target", health: 500,
        });
      T.invulnerable(false);
      T.combat.hurtPlayer(60, {
        source: "enemy-melee", enemyId: domeTarget.id, enemyKey: domeTarget.key,
        x: domeTarget.x, y: domeTarget.y + 1, z: domeTarget.z,
      });
      T.setShieldInput(false);
      T.renderOnce(1 / 120);
      T.invulnerable(true);
    } else if (requestedOrder === "edict") {
      const firstCall = T.mission.call("orbital");
      const inbound = T.mission.pending()[0] || null;
      firstFeedbackFrame();
      T.player.state.camYaw += Math.PI * 0.5;
      T.mission.call("orbital");
      const relocated = T.mission.pending()[0] || inbound;
      if (relocated) {
        T.combat.fire(
          { x: relocated.x, y: relocated.y + 12.5, z: relocated.z - 10 },
          { x: 0, y: 0, z: 1 },
          { damage: 0, precision: true }
        );
      }
      T.mission.restore(baseMission());
      T.teleport(655, 700, 0);
      T.mission.call("resupply");
      const supply = T.mission.pending()[0] || null;
      if (supply) T.advanceTime(supply.remaining + 0.08, 1 / 120);

      T.mission.restore(baseMission());
      T.teleport(655, 700, 0);
      T.mission.call("orbital");
      const firstFusion = T.mission.pending()[0] || null;
      if (firstFusion) T.advanceTime(firstFusion.remaining + 0.08, 1 / 120);
      T.mission.cooldowns.cluster = 0;
      T.mission.call("cluster");
      const secondFusion = T.mission.pending()[0] || null;
      if (secondFusion) T.advanceTime(secondFusion.remaining + 0.08, 1 / 120);
      mechanics = { fusionEvents };
      void firstCall;
    }

    T.renderOnce(1 / 60);
    const peak = {
      progression: T.progressionState(),
      vfx: vfxState(),
      audio: T.audioState(),
      player: playerVisual(),
      image: T.captureDataURL(),
      render: T.report().render,
    };
    stop?.();
    stopFusion?.();
    T.setJetInput(false);
    T.setShieldInput(false);
    T.setBoostHold(false);
    T.setGaitInput(null, null);
    T.invulnerable(true);
    return { order: requestedOrder, before, first, peak, events, mechanics };
  }, orderId);
}

function playerVisualDelta(before, after) {
  const colourDelta = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right)) return 0;
    return Math.hypot(...left.map((value, index) => finite(right[index]) - finite(value)));
  };
  return {
    heartIntensity: Math.abs(finite(after?.heartIntensity) - finite(before?.heartIntensity)),
    eyeIntensity: Math.abs(finite(after?.eyeIntensity) - finite(before?.eyeIntensity)),
    readability: Math.abs(finite(after?.readability) - finite(before?.readability)),
    heartColour: colourDelta(before?.heartColour, after?.heartColour),
    eyeColour: colourDelta(before?.eyeColour, after?.eyeColour),
  };
}

function imageBuffer(dataUrl) {
  const comma = String(dataUrl || "").indexOf(",");
  return comma >= 0 ? Buffer.from(dataUrl.slice(comma + 1), "base64") : Buffer.alloc(0);
}

async function imageDelta(beforeUrl, afterUrl) {
  const before = await sharp(imageBuffer(beforeUrl)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const after = await sharp(imageBuffer(afterUrl)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  if (before.info.width !== after.info.width || before.info.height !== after.info.height) {
    return { error: "dimension-mismatch", before: before.info, after: after.info };
  }
  let changed = 0;
  let energy = 0;
  let max = 0;
  const pixels = before.info.width * before.info.height;
  for (let index = 0; index < before.data.length; index += 4) {
    const delta = Math.max(
      Math.abs(before.data[index] - after.data[index]),
      Math.abs(before.data[index + 1] - after.data[index + 1]),
      Math.abs(before.data[index + 2] - after.data[index + 2])
    );
    if (delta >= 10) changed += 1;
    energy += delta;
    if (delta > max) max = delta;
  }
  return {
    width: before.info.width,
    height: before.info.height,
    changedPixels: changed,
    changedPct: Number((changed / pixels * 100).toFixed(4)),
    meanDelta: Number((energy / pixels).toFixed(4)),
    maxDelta: max,
  };
}

async function cyanEffectDelta(beforeUrl, afterUrl) {
  const before = await sharp(imageBuffer(beforeUrl)).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const after = await sharp(imageBuffer(afterUrl)).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  if (before.info.width !== after.info.width || before.info.height !== after.info.height) {
    return { error: "dimension-mismatch", before: before.info, after: after.info };
  }
  let pixels = 0;
  let minX = before.info.width;
  let minY = before.info.height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < after.data.length; index += 3) {
    const r = after.data[index];
    const g = after.data[index + 1];
    const b = after.data[index + 2];
    const beforeR = before.data[index];
    const beforeG = before.data[index + 1];
    const beforeB = before.data[index + 2];
    const cyan = b >= 120 && g >= 105 && b - r >= 35 && g - r >= 24;
    const appeared = Math.max(Math.abs(r - beforeR), Math.abs(g - beforeG),
      Math.abs(b - beforeB)) >= 28;
    if (!cyan || !appeared) continue;
    const pixel = index / 3;
    const x = pixel % after.info.width;
    const y = Math.floor(pixel / after.info.width);
    pixels += 1;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const area = pixels ? (maxX - minX + 1) * (maxY - minY + 1) : 0;
  const frameArea = after.info.width * after.info.height;
  return {
    pixels,
    bounds: pixels ? { minX, minY, maxX, maxY } : null,
    localizedPct: Number((area / frameArea * 100).toFixed(3)),
  };
}

async function saveScenarioImages(scope, orderId, scenario) {
  const beforePath = path.join(OUT, `${scope}-${orderId}-before.png`);
  const effectPath = path.join(OUT, `${scope}-${orderId}-feedback.png`);
  const beforeImage = scenario.visualComparison?.baseline?.image || scenario.before.image;
  const effectImage = scenario.visualComparison?.effect?.image || scenario.peak.image;
  await writeFile(beforePath, imageBuffer(beforeImage));
  await writeFile(effectPath, imageBuffer(effectImage));
  return {
    beforePath,
    effectPath,
    delta: await imageDelta(beforeImage, effectImage),
    cyan: orderId === "wing" ? await cyanEffectDelta(beforeImage, effectImage) : null,
  };
}

async function negativeControlPass(page) {
  console.log("\n=== NO-OWNED-TALENT NEGATIVE CONTROL ===");
  await invoke(page, "resetProgressionForQA");
  await page.waitForTimeout(1300);
  const probe = await page.evaluate(() => {
    const T = window.__SF;
    const baseMission = {
      phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
      elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
      relays: [], cooldowns: {}, pending: [],
    };
    T.clearEnemies();
    T.mission.restore(baseMission);
    T.teleport(655, 700, 0);
    T.setJetInput(false);
    T.setShieldInput(false);
    T.resetBoost(true);
    T.shield.reset(true);
    T.jetpack.reset(true);
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
    T.advanceTime(3, 1 / 60);
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({ ...event }));
    const before = {
      progression: T.progressionState(),
      vfx: T.vfx.doctrineState(),
      audio: T.audioState(),
    };
    const ps = T.player.state;
    const target = T.enemies.spawn("harrow", ps.x, ps.z + 3, {
      id: "qa-feedback-negative-target", health: 5000,
    });
    T.combat.damageEnemy(target, 10, {
      source: "shot", head: true, x: target.x, y: target.y + 2, z: target.z,
    });
    T.weapons.setHeat(0.9, { reason: "qa-feedback-negative" });
    T.weapons.carry.venting = 0;
    T.weapons.vent();
    T.weapons.setMode("melee");
    T.combat.meleeStrike(1, 2.4, false, 1.3, 2);
    T.weapons.setMode("ranged");
    T.triggerBoost(1, 0);
    T.resetBoost(true);
    T.invulnerable(false);
    T.setShieldInput(true);
    T.renderOnce(1 / 120);
    T.combat.hurtPlayer(20, {
      source: "enemy-melee", enemyId: target.id, enemyKey: target.key,
      x: target.x, y: target.y + 1, z: target.z,
    });
    T.setShieldInput(false);
    T.renderOnce(1 / 120);
    T.invulnerable(true);
    T.mission.call("orbital");
    T.renderOnce(1 / 60);
    const after = {
      progression: T.progressionState(),
      vfx: T.vfx.doctrineState(),
      audio: T.audioState(),
    };
    stop?.();
    return { events, before, after };
  });
  evidence.negativeControl = probe;
  check("ordinary production actions emit no Doctrine event with no owned rites",
    probe.events.length === 0
      && finite(probe.after?.progression?.effects?.feedback?.serial) === 0,
    JSON.stringify({ events: probe.events,
      feedback: probe.after?.progression?.effects?.feedback }));
  check("no-owned-talent actions create no Doctrine VFX or audio voice",
    finite(probe.after?.vfx?.accepted) === finite(probe.before?.vfx?.accepted)
      && activeDoctrineVfx(probe.after?.vfx) === 0
      && finite(probe.after?.audio?.doctrineVoices) === 0,
    JSON.stringify({ before: { vfx: probe.before?.vfx, audio: probe.before?.audio },
      after: { vfx: probe.after?.vfx, audio: probe.after?.audio } }));
}

async function lifecyclePass(page, definitions) {
  console.log("\n=== VFX LIFETIME, CLEANUP, AND POOL STABILITY ===");
  const prepared = await prepareOrder(page, definitions, "censer");
  const probe = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.mission.restore({
      phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
      elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
      relays: [], cooldowns: {}, pending: [],
    });
    T.teleport(655, 700, 0);
    // Negative-control ordnance is a global mission queue, not Doctrine VFX.
    // Let that production command finish before taking an isolated baseline.
    for (let frame = 0; frame < 1800
      && T.vfx.doctrineState().pools.deferred > 0; frame += 1) {
      T.renderOnce(1 / 120);
    }
    T.advanceTime(1.2, 1 / 120);
    T.renderStill();
    const before = T.vfx.doctrineState();
    const ps = T.player.state;
    const trigger = (index) => {
      const target = T.enemies.spawn("harrow", ps.x, ps.z + 3, {
        id: `qa-feedback-life-${index}`, health: 5000,
      });
      T.combat.damageEnemy(target, 1, {
        source: "shot", head: true, x: target.x, y: target.y + 2, z: target.z,
      });
    };
    trigger(0);
    T.renderOnce(1 / 60);
    const born = T.vfx.doctrineState();
    T.advanceTime(0.12, 1 / 120);
    T.renderStill();
    const captureWindow = T.vfx.doctrineState();
    const capture = T.captureDataURL();
    T.advanceTime(3.5, 1 / 120);
    T.renderStill();
    const cleaned = T.vfx.doctrineState();
    for (let index = 1; index <= 48; index += 1) trigger(index);
    T.renderOnce(1 / 60);
    const stressed = T.vfx.doctrineState();
    T.advanceTime(4, 1 / 120);
    T.renderStill();
    const recovered = T.vfx.doctrineState();
    T.clearEnemies();
    return { before, born, captureWindow, cleaned, stressed, recovered, capture };
  });
  await writeFile(path.join(OUT, "desktop-vfx-capture-window.png"),
    imageBuffer(probe.capture));
  delete probe.capture;
  evidence.lifecycle = { prepared: prepared.ok, ...probe };
  check("a production talent cue remains live through the capture window",
    prepared.ok
      && finite(probe.born?.accepted) > finite(probe.before?.accepted)
      && probe.born?.last?.order === "censer"
      && activeDoctrineVfx(probe.born) > 0
      && activeDoctrineVfx(probe.captureWindow) > 0,
    JSON.stringify(probe));
  check("Doctrine VFX fully clean up after their authored lifetime",
    activeDoctrineVfx(probe.cleaned) === 0
      && activeDoctrineVfx(probe.recovered) === 0,
    JSON.stringify({ cleaned: probe.cleaned, recovered: probe.recovered }));
  check("repeated talent cues reuse fixed VFX pools without capacity growth",
    doctrinePoolCapacity(probe.before) === doctrinePoolCapacity(probe.stressed)
      && doctrinePoolCapacity(probe.before) === doctrinePoolCapacity(probe.recovered)
      && activeDoctrineVfx(probe.stressed) <= doctrinePoolCapacity(probe.stressed)
      && finite(probe.born?.pools?.deferred) <= finite(probe.before?.pools?.deferred)
      && finite(probe.stressed?.pools?.deferred) <= finite(probe.cleaned?.pools?.deferred),
    JSON.stringify({ before: probe.before, stressed: probe.stressed,
      recovered: probe.recovered }));
}

async function audioSignaturesPass(page) {
  console.log("\n=== FIVE PROCEDURAL AUDIO SIGNATURES ===");
  const audio = await page.evaluate(async () => await window.__SF.audioCheck());
  const names = [
    "doctrineCenser",
    "doctrineProcession",
    "doctrineWing",
    "doctrineHalo",
    "doctrineEdict",
  ];
  const signatures = Object.fromEntries(names.map((name) => [name, audio?.[name] || null]));
  evidence.audioSignatures = signatures;
  check("all five Order signatures render measurable offline audio",
    names.every((name) => signatures[name]?.audible === true
      && finite(signatures[name]?.peak) > 0.002
      && finite(signatures[name]?.energy) > 0),
    JSON.stringify(signatures));
  const fingerprints = new Set(names.map((name) =>
    `${finite(signatures[name]?.peak).toFixed(4)}:${finite(signatures[name]?.energy).toFixed(5)}`));
  check("the five Order signatures do not collapse to one audio fingerprint",
    fingerprints.size >= 4, JSON.stringify([...fingerprints]));
}

async function semanticContractsPass(page, definitions) {
  console.log("\n=== SEMANTIC FEEDBACK CONTRACTS ===");
  const semantic = {};

  await prepareOrder(page, definitions, "procession");
  semantic.measureMiss = await page.evaluate(() => {
    const T = window.__SF;
    const target = { enemyId: "qa-semantic-measure-heavy", enemyKey: "harrow" };
    const strike = (comboStep, hits, targets) => ({
      comboStep, hits, kills: 0, targets, x: T.player.state.x,
      y: T.player.state.y, z: T.player.state.z + 1.2, yaw: T.player.state.yaw,
    });
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({ ...event }));
    T.progression.onMeleeStrike(strike(1, 1, [target]));
    T.progression.onMeleeStrike(strike(2, 1, [target]));
    const beforeThird = T.progressionState();
    T.progression.onMeleeStrike(strike(3, 0, []));
    const damageAfterMiss = T.progression.modifyEnemyDamage({
      enemyId: target.enemyId, enemyKey: target.enemyKey, source: "shot",
      damage: 100, requested: 100, x: T.player.state.x,
      y: T.player.state.y, z: T.player.state.z + 1.2,
    });
    const afterThird = T.progressionState();
    stop?.();
    return { events, beforeThird, afterThird, damageAfterMiss };
  });
  const measureEvents = semantic.measureMiss.events.filter((event) =>
    event.talentId === "procession_executioners_measure");
  check("Executioner's Measure third-strike miss emits no exposure cue or damage effect",
    measureEvents.length === 0
      && finite(semantic.measureMiss.beforeThird?.effects?.exposed) === 0
      && finite(semantic.measureMiss.afterThird?.effects?.exposed) === 0
      && finite(semantic.measureMiss.damageAfterMiss) === 100,
    JSON.stringify({ measureEvents, before: semantic.measureMiss.beforeThird?.effects,
      after: semantic.measureMiss.afterThird?.effects,
      damageAfterMiss: semantic.measureMiss.damageAfterMiss }));
  const observableEffects = semantic.measureMiss.afterThird?.effects;
  check("Doctrine state exposes armed and target-level feedback observability",
    Array.isArray(observableEffects?.brandTargets)
      && Array.isArray(observableEffects?.exposedTargets)
      && Array.isArray(observableEffects?.circuitSegments)
      && record(observableEffects?.armed).goldNail !== undefined
      && Object.prototype.hasOwnProperty.call(record(observableEffects), "wake"),
    JSON.stringify(observableEffects));

  await prepareOrder(page, definitions, "procession");
  semantic.tollSingle = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const target = {
      enemyId: "qa-semantic-toll-solo", enemyKey: "harrow", killed: false,
      x: T.player.state.x, y: T.player.state.y + 1, z: T.player.state.z + 1.2,
    };
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({ ...event }));
    for (const comboStep of [1, 2, 3]) {
      T.progression.onMeleeStrike({
        comboStep, hits: 1, kills: 0, targets: [target], x: T.player.state.x,
        y: T.player.state.y, z: T.player.state.z + 1.2, yaw: T.player.state.yaw,
      });
    }
    const state = T.progressionState();
    stop?.();
    return { events, state };
  });
  const singleToll = semantic.tollSingle.events.find((event) =>
    event.talentId === "procession_third_toll");
  check("rank-two Third Toll reports one rupture when fewer than three enemies are hit",
    singleToll?.count === 1
      && semantic.tollSingle.state?.effects?.exposedTargets?.length === 1
      && semantic.tollSingle.state?.effects?.armed?.endlessLitany?.active === true,
    JSON.stringify(semantic.tollSingle));

  await prepareOrder(page, definitions, "procession");
  semantic.tollEcho = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.invulnerable(true);
    T._teleportRaw(655, 700, 0);
    T.setBodyHeading(0);
    const ps = T.player.state;
    const centre = {
      x: ps.x, z: ps.z + 3,
      y: T.collide.groundHeight(ps.x, ps.z + 3),
    };
    const spawned = [
      T.enemies.spawn("harrow", centre.x, centre.z,
        { id: "qa-semantic-toll-heavy", health: 5000 }),
      T.enemies.spawn("thresher", centre.x - 1.1, centre.z + 0.2,
        { id: "qa-semantic-toll-light-a", health: 500 }),
      T.enemies.spawn("thresher", centre.x + 1.1, centre.z + 0.2,
        { id: "qa-semantic-toll-light-b", health: 500 }),
      T.enemies.spawn("thresher", centre.x - 2.2, centre.z - 0.4,
        { id: "qa-semantic-toll-light-c", health: 500 }),
      T.enemies.spawn("thresher", centre.x + 2.2, centre.z - 0.4,
        { id: "qa-semantic-toll-light-d", health: 500 }),
      T.enemies.spawn("thresher", centre.x, centre.z + 2,
        { id: "qa-semantic-toll-light-e", health: 500 }),
      T.enemies.spawn("thresher", centre.x, centre.z - 2,
        { id: "qa-semantic-toll-light-f", health: 500 }),
    ].filter(Boolean);
    for (const enemy of spawned) enemy.stunTime = 20;
    T.advanceTime(2.8, 1 / 120);
    const fixtureHits = T.combat.shockwave(centre.x, centre.y, centre.z, {
      radius: 6, damage: 0, source: "qa-toll-fixture-proof",
    });
    const heavy = spawned[0];
    const target = {
      enemyId: heavy.id, enemyKey: heavy.key, killed: false,
      x: heavy.x, y: heavy.y + 1, z: heavy.z,
    };
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({ ...event }));
    for (const comboStep of [1, 2, 3]) {
      T.progression.onMeleeStrike({
        comboStep, hits: 1, kills: 0, targets: [target], x: centre.x,
        y: centre.y, z: centre.z, yaw: ps.yaw,
      });
    }
    stop?.();
    T.clearEnemies();
    return { events, fixtureHits, spawned: spawned.map((enemy) => enemy.id) };
  });
  const echoToll = semantic.tollEcho.events.find((event) =>
    event.talentId === "procession_third_toll");
  check("rank-two Third Toll reports two ruptures only after hitting at least three enemies",
    finite(semantic.tollEcho.fixtureHits?.hits) >= 3 && echoToll?.count === 2,
    JSON.stringify(semantic.tollEcho));

  await prepareOrder(page, definitions, "procession");
  await page.evaluate(() => {
    const T = window.__SF;
    const target = { enemyId: "qa-semantic-litany-heavy", enemyKey: "harrow" };
    const event = (comboStep) => ({
      comboStep, hits: 1, kills: 0, targets: [target], x: T.player.state.x,
      y: T.player.state.y, z: T.player.state.z + 1.2, yaw: T.player.state.yaw,
    });
    T.progression.onMeleeStrike(event(1));
    T.progression.onMeleeStrike(event(2));
  });
  await page.waitForTimeout(1150);
  semantic.litanyAudio = await page.evaluate(() => {
    const T = window.__SF;
    const target = { enemyId: "qa-semantic-litany-heavy", enemyKey: "harrow" };
    const before = T.audioState();
    const beforeVfx = T.vfx.doctrineState();
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({ ...event }));
    T.progression.onMeleeStrike({
      comboStep: 3, hits: 1, kills: 0, targets: [target], x: T.player.state.x,
      y: T.player.state.y, z: T.player.state.z + 1.2, yaw: T.player.state.yaw,
    });
    const after = T.audioState();
    const afterVfx = T.vfx.doctrineState();
    stop?.();
    return { before, after, beforeVfx, afterVfx, events };
  });
  const litanyArmCue = semantic.litanyAudio.events.find((event) =>
    event.talentId === "procession_endless_litany" && event.stage === "arm");
  const tollFinisherCue = semantic.litanyAudio.events.find((event) =>
    event.talentId === "procession_third_toll" && event.stage === "finisher");
  check("Third Toll audio outranks Litany preparation while both remain visual events",
    litanyArmCue?.priority === 0 && tollFinisherCue?.priority === 2
      && finite(semantic.litanyAudio.afterVfx?.accepted)
        - finite(semantic.litanyAudio.beforeVfx?.accepted)
          === semantic.litanyAudio.events.length
      && semantic.litanyAudio.afterVfx?.last?.talentId === "procession_endless_litany"
      && semantic.litanyAudio.afterVfx?.last?.stage === "arm"
      && audioCueCount(semantic.litanyAudio.after, "procession:toll")
        === audioCueCount(semantic.litanyAudio.before, "procession:toll") + 1
      && audioCueCount(semantic.litanyAudio.after, "procession:litany")
        === audioCueCount(semantic.litanyAudio.before, "procession:litany")
      && semantic.litanyAudio.after?.doctrine?.lastCue?.cue === "toll"
      && semantic.litanyAudio.after?.doctrine?.lastCue?.stage === "finisher",
    JSON.stringify(semantic.litanyAudio));

  await prepareOrder(page, definitions, "wing");
  semantic.featherCap = await page.evaluate(() => {
    const T = window.__SF;
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({ ...event }));
    T.player.state.grounded = false;
    const kill = (index) => T.progression.onEnemyKilled({
      enemyId: `qa-semantic-feather-${index}`, enemyKey: "thresher",
      source: "shot", head: true, x: T.player.state.x,
      y: T.player.state.y + 1, z: T.player.state.z + 2,
    });
    for (let index = 1; index <= 3; index += 1) kill(index);
    const capped = {
      state: T.progressionState(), vfx: T.vfx.doctrineState(), audio: T.audioState(),
      events: events.length,
    };
    kill(4);
    const after = {
      state: T.progressionState(), vfx: T.vfx.doctrineState(), audio: T.audioState(),
      events: events.length,
    };
    T.player.state.grounded = true;
    stop?.();
    return { events, capped, after };
  });
  const featherEvents = semantic.featherCap.events.filter((event) =>
    event.talentId === "wing_falling_gospel" && event.stage !== "consume");
  check("Falling Gospel at three feathers emits no redundant fourth cue",
    finite(semantic.featherCap.capped?.state?.effects?.feathers) === 3
      && finite(semantic.featherCap.after?.state?.effects?.feathers) === 3
      && featherEvents.length === 3
      && semantic.featherCap.after.events === semantic.featherCap.capped.events
      && finite(semantic.featherCap.after?.vfx?.accepted)
        === finite(semantic.featherCap.capped?.vfx?.accepted)
      && audioCueCount(semantic.featherCap.after?.audio, "wing:feather")
        === audioCueCount(semantic.featherCap.capped?.audio, "wing:feather"),
    JSON.stringify(semantic.featherCap));

  await prepareOrder(page, definitions, "wing");
  await page.waitForTimeout(1150);
  await page.evaluate(() => {
    const T = window.__SF;
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({ ...event }));
    window.__SF_SEMANTIC_CIRCUIT = {
      before: { vfx: T.vfx.doctrineState(), audio: T.audioState() }, events, stop,
      afterFirst: null,
    };
    const ps = T.player.state;
    T.progression.noteVerb("jet", { x: ps.x, y: ps.y, z: ps.z, ignitionCost: 6 });
    window.__SF_SEMANTIC_CIRCUIT.afterFirst = T.progressionState();
  });
  await page.waitForTimeout(220);
  await page.evaluate(() => {
    const T = window.__SF;
    const ps = T.player.state;
    T.progression.noteVerb("slam", { x: ps.x, y: ps.y, z: ps.z });
    window.__SF_SEMANTIC_CIRCUIT.afterSecond = T.progressionState();
  });
  await page.waitForTimeout(1150);
  semantic.circuit = await page.evaluate(() => {
    const T = window.__SF;
    const probe = window.__SF_SEMANTIC_CIRCUIT;
    const ps = T.player.state;
    T.progression.noteVerb("boost", {
      x: ps.x, y: ps.y, z: ps.z, attack: false, boostIndex: 1,
    });
    const after = {
      vfx: T.vfx.doctrineState(), audio: T.audioState(), progression: T.progressionState(),
    };
    probe.stop?.();
    const result = {
      before: probe.before, afterFirst: probe.afterFirst,
      afterSecond: probe.afterSecond, after, events: [...probe.events],
    };
    delete window.__SF_SEMANTIC_CIRCUIT;
    return result;
  });
  const circuitEvents = semantic.circuit.events.filter((event) =>
    event.talentId === "wing_unbroken_circuit");
  const circuitSegments = circuitEvents.filter((event) => event.stage === "segment");
  const circuitCompletes = circuitEvents.filter((event) => event.stage === "complete");
  check("Unbroken Circuit's third verb emits one complete VFX and no segment three",
    circuitSegments.length === 2
      && circuitSegments.every((event) => event.count === 1 || event.count === 2)
      && circuitCompletes.length === 1
      && finite(semantic.circuit.after?.vfx?.accepted)
        - finite(semantic.circuit.before?.vfx?.accepted) === semantic.circuit.events.length
      && semantic.circuit.after?.vfx?.last?.talentId === "wing_unbroken_circuit"
      && semantic.circuit.after?.vfx?.last?.stage === "complete"
      && semantic.circuit.afterFirst?.effects?.circuitSegments?.length === 1
      && semantic.circuit.afterSecond?.effects?.circuitSegments?.length === 2
      && semantic.circuit.after?.progression?.effects?.circuitSegments?.length === 0
      && !!semantic.circuit.after?.progression?.effects?.wake,
    JSON.stringify(semantic.circuit));
  check("Unbroken Circuit completion audio survives its preceding Wake cue",
    audioCueCount(semantic.circuit.after?.audio, "wing:circuit")
      === audioCueCount(semantic.circuit.before?.audio, "wing:circuit") + 3
      && audioCueCount(semantic.circuit.after?.audio, "wing:wake")
        === audioCueCount(semantic.circuit.before?.audio, "wing:wake") + 1
      && semantic.circuit.after?.audio?.doctrine?.lastCue?.cue === "circuit"
      && semantic.circuit.after?.audio?.doctrine?.lastCue?.stage === "complete",
    JSON.stringify(semantic.circuit));

  await invoke(page, "resetProgressionForQA");
  semantic.chapelRankZero = await page.evaluate(() => {
    const T = window.__SF;
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({ ...event }));
    const before = { vfx: T.vfx.doctrineState(), audio: T.audioState() };
    T.progression.onCommandSanctuary({
      id: "qa-semantic-halo-bastion", commandKey: "resupply",
      x: T.player.state.x, y: T.player.state.y, z: T.player.state.z,
      radius: 10, remaining: 10, blocksProjectiles: true,
      fusionId: "halo_bastion",
    });
    const after = { vfx: T.vfx.doctrineState(), audio: T.audioState() };
    stop?.();
    return { rank: T.progression.rank("edict_field_chapel"), events, before, after };
  });
  check("Halo Bastion does not impersonate Field Chapel at Chapel rank zero",
    semantic.chapelRankZero.rank === 0
      && !semantic.chapelRankZero.events.some((event) =>
        event.talentId === "edict_field_chapel" || event.cue === "chapel")
      && finite(semantic.chapelRankZero.after?.vfx?.accepted)
        === finite(semantic.chapelRankZero.before?.vfx?.accepted)
      && audioCueCount(semantic.chapelRankZero.after?.audio, "edict:chapel")
        === audioCueCount(semantic.chapelRankZero.before?.audio, "edict:chapel"),
    JSON.stringify(semantic.chapelRankZero));

  await prepareOrder(page, definitions, "halo");
  await page.waitForTimeout(1150);
  semantic.haloBlock = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.shield.reset(true);
    T.resetBoost(true);
    T.invulnerable(true);
    T._teleportRaw(-12, 830, 0);
    T.setBodyHeading(0);
    const ps = T.player.state;
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({
      ...event, qaPlayer: { x: ps.x, y: ps.y, z: ps.z },
    }));
    const attacker = T.enemies.spawn("gleaner", ps.x, ps.z + 2.4, {
      id: "qa-semantic-halo-attacker", health: 500,
    });
    const before = T.audioState();
    T.invulnerable(false);
    T.setShieldInput(true);
    T.renderOnce(1 / 120);
    T.combat.hurtPlayer(40, {
      source: "enemy-fire", enemyId: attacker.id, enemyKey: attacker.key,
      x: attacker.x, y: attacker.y + 1, z: attacker.z,
    });
    const afterBlock = T.audioState();
    T.setShieldInput(false);
    T.renderOnce(1 / 120);
    const boost = T.triggerBoost(1, 0);
    const afterBoost = T.audioState();
    T.invulnerable(true);
    stop?.();
    T.clearEnemies();
    return { events, before, afterBlock, afterBoost, boost };
  });
  const shieldCueIds = new Set([
    "halo_stored_wrath", "halo_pilgrims_reversal", "halo_votive_parry",
  ]);
  const shieldCues = semantic.haloBlock.events.filter((event) =>
    shieldCueIds.has(event.talentId));
  check("shield and Reversal feedback stays centred on the player",
    shieldCues.length >= 4 && shieldCues.every((event) => nearPoint(event, event.qaPlayer)),
    JSON.stringify(shieldCues));
  check("Votive Parry and Reversal consume audio survive their same-block cues",
    audioCueCount(semantic.haloBlock.afterBlock, "halo:parry")
      === audioCueCount(semantic.haloBlock.before, "halo:parry") + 1
      && audioCueCount(semantic.haloBlock.afterBoost, "halo:reversal")
        === audioCueCount(semantic.haloBlock.before, "halo:reversal") + 1
      && semantic.haloBlock.afterBoost?.doctrine?.lastCue?.cue === "reversal"
      && semantic.haloBlock.afterBoost?.doctrine?.lastCue?.stage === "consume",
    JSON.stringify(semantic.haloBlock));

  await prepareOrder(page, definitions, "halo");
  await page.waitForTimeout(1150);
  semantic.seraphAudio = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.shield.reset(true);
    T._teleportRaw(-12, 830, 0);
    T.setBodyHeading(0);
    const ps = T.player.state;
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({
      ...event, qaPlayer: { x: ps.x, y: ps.y, z: ps.z },
    }));
    const before = T.audioState();
    T.setShieldInput(true);
    T.advanceTime(1.06, 1 / 120);
    const attacker = T.enemies.spawn("thresher", ps.x + 2.4, ps.z, {
      id: "qa-semantic-seraph-attacker", health: 500,
    });
    T.invulnerable(false);
    T.combat.hurtPlayer(60, {
      source: "enemy-melee", enemyId: attacker.id, enemyKey: attacker.key,
      x: attacker.x, y: attacker.y + 1, z: attacker.z,
    });
    T.setShieldInput(false);
    T.renderOnce(1 / 120);
    const after = T.audioState();
    T.invulnerable(true);
    stop?.();
    T.clearEnemies();
    return { events, before, after };
  });
  const domeCues = semantic.seraphAudio.events.filter((event) =>
    event.talentId === "halo_seraph_aegis" || event.talentId === "halo_pilgrims_reversal");
  check("Seraph dome feedback is player-centred and its release audio is not suppressed",
    domeCues.length >= 3 && domeCues.every((event) => nearPoint(event, event.qaPlayer))
      && audioCueCount(semantic.seraphAudio.after, "halo:seraph")
        === audioCueCount(semantic.seraphAudio.before, "halo:seraph") + 1
      && semantic.seraphAudio.after?.doctrine?.lastCue?.cue === "seraph"
      && semantic.seraphAudio.after?.doctrine?.lastCue?.stage === "release",
    JSON.stringify(semantic.seraphAudio));

  await prepareOrder(page, definitions, "censer");
  await page.waitForTimeout(1150);
  semantic.martyrAudio = await page.evaluate(() => {
    const T = window.__SF;
    T.weapons.carry.venting = 0;
    T.weapons.setHeat(0.9, { reason: "qa-semantic-martyr" });
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({ ...event }));
    const before = T.audioState();
    const vented = T.weapons.vent();
    const after = T.audioState();
    stop?.();
    return { events, before, after, vented };
  });
  check("Martyr's Furnace audio survives the routine Vent cue from the same action",
    semantic.martyrAudio.events.some((event) => event.talentId === "censer_ashen_rebuke")
      && semantic.martyrAudio.events.some((event) => event.talentId === "censer_martyrs_furnace")
      && audioCueCount(semantic.martyrAudio.after, "censer:martyr")
        === audioCueCount(semantic.martyrAudio.before, "censer:martyr") + 1
      && semantic.martyrAudio.after?.doctrine?.lastCue?.cue === "martyr",
    JSON.stringify(semantic.martyrAudio));

  await prepareOrder(page, definitions, "edict");
  await page.waitForTimeout(1150);
  semantic.sigilTiming = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.mission.restore({
      phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
      elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
      relays: [], cooldowns: {}, pending: [],
    });
    T.teleport(655, 700, 0);
    const events = [];
    const stop = T.progression.bus.on("doctrine", (event) => events.push({ ...event }));
    T.mission.call("resupply");
    const inbound = events.map((event) => ({ ...event }));
    const supply = T.mission.pending()[0];
    if (supply) T.advanceTime(supply.remaining + 0.08, 1 / 120);
    const impact = events.map((event) => ({ ...event }));
    stop?.();
    return { inbound, impact };
  });
  const inboundSigils = semantic.sigilTiming.inbound.filter((event) =>
    event.talentId === "edict_combined_liturgy" && event.cue === "sigil");
  const impactSigils = semantic.sigilTiming.impact.filter((event) =>
    event.talentId === "edict_combined_liturgy" && event.cue === "sigil");
  check("Combined Liturgy publishes its sigil only when the command impacts",
    inboundSigils.length === 0 && impactSigils.length === 1
      && impactSigils[0].stage === "form",
    JSON.stringify(semantic.sigilTiming));
  await page.waitForTimeout(1150);
  semantic.fusion = await page.evaluate(() => {
    const T = window.__SF;
    const doctrineEvents = [];
    const fusionEvents = [];
    const before = T.audioState();
    const stopDoctrine = T.progression.bus.on("doctrine", (event) =>
      doctrineEvents.push({ ...event }));
    const stopFusion = T.mission.bus.on("fusion", (event) => fusionEvents.push({
      event: JSON.parse(JSON.stringify(event)), audioAtFusion: T.audioState(),
    }));
    T.mission.cooldowns.orbital = 0;
    T.mission.call("orbital");
    const orbital = T.mission.pending()[0];
    if (orbital) T.advanceTime(orbital.remaining + 0.08, 1 / 120);
    const after = T.audioState();
    stopDoctrine?.();
    stopFusion?.();
    return { doctrineEvents, fusionEvents, before, after };
  });
  const haloBastion = semantic.fusion.fusionEvents.find((entry) =>
    entry.event?.id === "halo_bastion");
  const fusionCue = semantic.fusion.doctrineEvents.find((event) =>
    event.talentId === "edict_combined_liturgy" && event.stage === "resolve");
  const effectPoint = haloBastion?.event?.effectPoint;
  check("Combined Liturgy fusion cue is placed at its resolved outcome effect point",
    !!effectPoint && !!fusionCue && nearPoint(fusionCue, effectPoint),
    JSON.stringify({ haloBastion, fusionCue, effectPoint }));
  check("Combined Liturgy resolve audio survives preceding command cues",
    audioCueCount(haloBastion?.audioAtFusion, "edict:fusion")
      === audioCueCount(semantic.fusion.before, "edict:fusion") + 1
      && haloBastion?.audioAtFusion?.doctrine?.lastCue?.cue === "fusion"
      && haloBastion?.audioAtFusion?.doctrine?.lastCue?.stage === "resolve",
    JSON.stringify(semantic.fusion));

  const priorityEvents = [
    ...semantic.tollSingle.events,
    ...semantic.litanyAudio.events,
    ...semantic.circuit.events,
    ...semantic.haloBlock.events,
    ...semantic.seraphAudio.events,
    ...semantic.martyrAudio.events,
    ...semantic.fusion.doctrineEvents,
  ];
  const litanyArm = priorityEvents.find((event) =>
    event.talentId === "procession_endless_litany" && event.stage === "arm");
  const circuitComplete = priorityEvents.find((event) =>
    event.talentId === "wing_unbroken_circuit" && event.stage === "complete");
  const reversalConsume = priorityEvents.find((event) =>
    event.talentId === "halo_pilgrims_reversal" && event.stage === "consume");
  const martyr = priorityEvents.find((event) => event.talentId === "censer_martyrs_furnace");
  check("Doctrine priority is bounded and promotes resolves above preparation cues",
    priorityEvents.length > 0
      && priorityEvents.every((event) => Number.isInteger(event.priority)
        && event.priority >= 0 && event.priority <= 3)
      && litanyArm?.priority === 0
      && reversalConsume?.priority === 2
      && circuitComplete?.priority === 3
      && fusionCue?.priority === 3
      && martyr?.priority === 3,
    JSON.stringify(priorityEvents.map((event) => ({
      talentId: event.talentId, cue: event.cue, stage: event.stage,
      priority: event.priority,
    }))));

  evidence.semantic = semantic;
}

async function performancePass(page, definitions, scope) {
  const prepared = await prepareOrder(page, definitions, "censer");
  const sample = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.mission.restore({
      phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
      elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
      relays: [], cooldowns: {}, pending: [],
    });
    T.teleport(655, 700, 0);
    T.advanceTime(4, 1 / 120);
    const trigger = (id) => {
      const ps = T.player.state;
      const target = T.enemies.spawn("harrow", ps.x, ps.z + 3, {
        id, health: 5000,
      });
      T.combat.damageEnemy(target, 1, {
        source: "shot", head: true, x: target.x, y: target.y + 2, z: target.z,
      });
      T.clearEnemies();
    };
    const renderStats = () => ({ ...T.report().render });
    const vfxStats = () => structuredClone(T.vfx.doctrineState());
    const capacities = (state) => ({
      beams: state.pools.beams.capacity,
      rings: state.pools.rings.capacity,
      domes: state.pools.domes.capacity,
      impacts: state.pools.impacts.capacity,
      flashes: state.pools.flashes.capacity,
    });
    const percentile = (values, fraction) => values[Math.min(values.length - 1,
      Math.floor(values.length * fraction))];
    for (let frame = 0; frame < 36; frame += 1) T.renderOnce(1 / 120);
    const baseline = { render: renderStats(), vfx: vfxStats() };
    trigger("qa-feedback-performance-peak");
    T.renderOnce(1 / 120);
    const effect = { render: renderStats(), vfx: vfxStats() };
    T.advanceTime(1.3, 1 / 120);
    const batches = [];
    for (let batch = 0; batch < 3; batch += 1) {
      trigger(`qa-feedback-performance-${batch}`);
      // Warm the active Doctrine materials before collecting this batch.
      for (let frame = 0; frame < 10; frame += 1) T.renderOnce(1 / 120);
      const times = [];
      for (let frame = 0; frame < 48; frame += 1) {
        const start = performance.now();
        T.renderOnce(1 / 120);
        times.push(performance.now() - start);
      }
      times.sort((left, right) => left - right);
      batches.push({
        frames: times.length,
        medianMs: Number(percentile(times, 0.5).toFixed(3)),
        p95Ms: Number(percentile(times, 0.95).toFixed(3)),
        maxMs: Number(times.at(-1).toFixed(3)),
      });
      T.advanceTime(1.3, 1 / 120);
    }
    const medianValues = batches.map((batch) => batch.medianMs)
      .sort((left, right) => left - right);
    const p95Values = batches.map((batch) => batch.p95Ms)
      .sort((left, right) => left - right);
    const recovered = { render: renderStats(), vfx: vfxStats() };
    return {
      frames: batches.reduce((sum, batch) => sum + batch.frames, 0),
      batches,
      medianMs: percentile(medianValues, 0.5),
      medianBatchP95Ms: percentile(p95Values, 0.5),
      baseline,
      effect,
      recovered,
      delta: {
        calls: effect.render.calls - baseline.render.calls,
        triangles: effect.render.triangles - baseline.render.triangles,
        points: effect.render.points - baseline.render.points,
        geometries: effect.render.geometries - baseline.render.geometries,
        textures: effect.render.textures - baseline.render.textures,
        programs: effect.render.programs - baseline.render.programs,
      },
      capacities: {
        baseline: capacities(baseline.vfx),
        effect: capacities(effect.vfx),
        recovered: capacities(recovered.vfx),
      },
      report: T.report(),
    };
  });
  evidence[scope].performance = { prepared: prepared.ok, ...sample };
  const budget = { callsDelta: 8, trianglesDelta: 24000, pointsDelta: 8192 };
  check(`${scope} production feedback is active in the renderer sample`,
    prepared.ok
      && finite(sample.effect?.vfx?.accepted) > finite(sample.baseline?.vfx?.accepted)
      && activeDoctrineVfx(sample.effect?.vfx) > 0,
    JSON.stringify({ prepared: prepared.ok, baseline: sample.baseline?.vfx,
      effect: sample.effect?.vfx }));
  check(`${scope} Doctrine feedback stays inside its incremental renderer budget`,
    finite(sample.delta?.calls) <= budget.callsDelta
      && finite(sample.delta?.triangles) <= budget.trianglesDelta
      && finite(sample.delta?.points) <= budget.pointsDelta,
    JSON.stringify({ delta: sample.delta, budget }));
  check(`${scope} feedback reuses fixed VFX capacity and warmed frames stay responsive`,
    JSON.stringify(sample.capacities.baseline) === JSON.stringify(sample.capacities.effect)
      && JSON.stringify(sample.capacities.baseline) === JSON.stringify(sample.capacities.recovered)
      && sample.medianMs <= 8
      && sample.medianBatchP95Ms <= 16.67,
    JSON.stringify(sample));
}

async function orderCoveragePass(page, definitions, scope) {
  console.log(`\n=== ${scope.toUpperCase()} ALL-ORDER FEEDBACK ===`);
  const seen = new Set();
  const contracts = WING_ONLY
    ? [["wing", ORDER_CONTRACTS.wing]] : Object.entries(ORDER_CONTRACTS);
  for (const [orderId, contract] of contracts) {
    await page.waitForTimeout(1300);
    const wingBaseline = orderId === "wing"
      ? await captureWingNoTalentBaseline(page) : null;
    if (wingBaseline) {
      check(`${scope} wing visual baseline uses ordinary no-talent jet-assisted boost`,
        wingBaseline.noTalent
          && wingBaseline.events.length === 0
          && wingBaseline.boost?.triggered === true
          && wingBaseline.orbit?.ok === true
          && wingBaseline.playerInFrame === true,
        JSON.stringify({ ...wingBaseline, image: "[captured]" }));
    }
    const prepared = await prepareOrder(page, definitions, orderId);
    check(`${scope} ${orderId} loadout owns all four rites and its Vow`,
      prepared.ok, JSON.stringify({ owned: prepared.owned, equip: prepared.equip }));
    const scenario = await runOrderScenario(page, orderId);
    if (wingBaseline) {
      scenario.visualComparison = {
        baseline: wingBaseline,
        effect: scenario.mechanics?.visualEffect || null,
      };
      const baselineCamera = JSON.stringify(wingBaseline.cameraRelative);
      const effectCamera = JSON.stringify(
        scenario.visualComparison.effect?.cameraRelative
      );
      const baselineTarget = JSON.stringify(wingBaseline.targetRelative);
      const effectTarget = JSON.stringify(
        scenario.visualComparison.effect?.targetRelative
      );
      check(`${scope} wing comparison locks identical player-relative framing`,
        baselineCamera === effectCamera
          && baselineTarget === effectTarget
          && wingBaseline.missionVisible === false
          && scenario.visualComparison.effect?.missionVisible === false
          && scenario.visualComparison.effect?.orbit?.ok === true
          && scenario.visualComparison.effect?.playerInFrame === true,
        JSON.stringify({
          baseline: { cameraRelative: wingBaseline.cameraRelative,
            targetRelative: wingBaseline.targetRelative,
            missionVisible: wingBaseline.missionVisible },
          effect: { cameraRelative: scenario.visualComparison.effect?.cameraRelative,
            targetRelative: scenario.visualComparison.effect?.targetRelative,
            missionVisible: scenario.visualComparison.effect?.missionVisible },
        }));
    }
    const images = await saveScenarioImages(scope, orderId, scenario);
    const visualComparison = scenario.visualComparison ? {
      baseline: { ...scenario.visualComparison.baseline, image: "[captured]" },
      effect: { ...scenario.visualComparison.effect, image: "[captured]" },
    } : null;
    if (scenario.mechanics?.visualEffect?.image) {
      scenario.mechanics.visualEffect.image = "[captured]";
    }
    const eventsById = Object.groupBy
      ? Object.groupBy(scenario.events, (event) => event.talentId || "")
      : scenario.events.reduce((groups, event) => {
        const key = event.talentId || "";
        (groups[key] ||= []).push(event);
        return groups;
      }, {});
    const contractRows = contract.ids.map((id) => {
      const events = eventsById[id] || [];
      const allowed = contract.cues[id];
      const cueMatch = events.some((event) => allowed.includes(event.cue));
      if (cueMatch) seen.add(id);
      return { id, allowed, seen: events.map((event) => `${event.cue}:${event.stage}`), cueMatch };
    });
    const pulseDelta = playerVisualDelta(scenario.before.player, scenario.first?.player);
    const beforeOrderVfx = finite(scenario.before?.vfx?.byOrder?.[orderId]);
    const peakOrderVfx = finite(scenario.peak?.vfx?.byOrder?.[orderId]);
    const audioBefore = finite(scenario.before?.audio?.doctrineVoices);
    const audioFirst = finite(scenario.first?.audio?.doctrineVoices);
    const orderEvidence = {
      prepared: prepared.ok,
      events: scenario.events,
      contractRows,
      pulseDelta,
      vfx: { before: scenario.before.vfx, first: scenario.first?.vfx, peak: scenario.peak.vfx },
      audio: { before: scenario.before.audio, first: scenario.first?.audio,
        peak: scenario.peak.audio },
      render: { before: scenario.before.render, peak: scenario.peak.render },
      images,
      visualComparison,
      mechanics: scenario.mechanics,
    };
    evidence[scope][orderId] = orderEvidence;
    check(`${scope} ${orderId} production mechanics emit every contracted talent cue`,
      contractRows.every((row) => row.cueMatch),
      JSON.stringify({ contractRows, mechanics: scenario.mechanics }));
    check(`${scope} ${orderId} cues are represented in live VFX state`,
      finite(scenario.peak?.vfx?.accepted) > finite(scenario.before?.vfx?.accepted)
        && peakOrderVfx - beforeOrderVfx >= scenario.events.length
        && activeDoctrineVfx(scenario.peak?.vfx) > 0,
      JSON.stringify(orderEvidence.vfx));
    check(`${scope} ${orderId} invokes its procedural audio signature`,
      audioBefore === 0 && audioFirst > audioBefore,
      JSON.stringify(orderEvidence.audio));
    check(`${scope} ${orderId} drives the player Doctrine emissive pulse`,
      Object.values(pulseDelta).some((value) => value >= 0.01),
      JSON.stringify(pulseDelta));
    check(`${scope} ${orderId} feedback is present in the captured frame`,
      images.delta.changedPct >= 0.02 && images.delta.maxDelta >= 24,
      JSON.stringify(images.delta));
    if (orderId === "wing") {
      check(`${scope} wing capture contains a localized cyan Doctrine signature`,
        images.cyan?.pixels >= 80
          && images.cyan?.localizedPct > 0
          && images.cyan?.localizedPct <= 15,
        JSON.stringify(images.cyan));
    }
  }
  evidence[scope].coveredIds = [...seen].sort();
  const expectedIds = WING_ONLY ? ORDER_CONTRACTS.wing.ids : ALL_CONTRACT_IDS;
  check(`${scope} scenario contract covers ${WING_ONLY ? "all five Wing" : "all 25 implemented"} IDs`,
    sameIds(seen, expectedIds),
    JSON.stringify({ expected: [...expectedIds].sort(), actual: [...seen].sort() }));
}

async function definitionsPass(page) {
  const raw = await invoke(page, "progressionDefinitions");
  const definitions = normalizeDefinitions(raw);
  const implemented = definitions.orders.flatMap((order) => [
    ...order.talents.filter((talent) => talent.implemented).map((talent) => talent.id),
    ...(order.capstone?.implemented ? [order.capstone.id] : []),
  ]);
  evidence.contracts = {
    implemented,
    expected: ALL_CONTRACT_IDS,
    orders: definitions.orders,
  };
  check("feedback contract is definition-driven and exactly covers 25 implemented IDs",
    implemented.length === 25 && ALL_CONTRACT_IDS.length === 25
      && new Set(ALL_CONTRACT_IDS).size === 25 && sameIds(implemented, ALL_CONTRACT_IDS),
    JSON.stringify({ implemented, contract: ALL_CONTRACT_IDS }));
  check("each contracted ID declares at least one semantic feedback cue",
    Object.entries(ORDER_CONTRACTS).every(([, order]) =>
      order.ids.every((id) => Array.isArray(order.cues[id]) && order.cues[id].length > 0)),
    JSON.stringify(ORDER_CONTRACTS));
  return definitions;
}

const python = process.env.SAINTFALL_PYTHON || "/opt/homebrew/bin/python3";
const server = spawn(python,
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(OUT, { recursive: true });
  let serverReady = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/games/saintfall.html`)).ok) {
        serverReady = true;
        break;
      }
    } catch (_) { /* retry */ }
    await delay(100);
  }
  if (!serverReady) throw new Error("local Saintfall server did not start");

  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit"],
  });
  try {
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    });
    const desktop = await bootPage(desktopContext, "desktop");
    const definitions = await definitionsPass(desktop);
    if (!WING_ONLY) {
      await audioSignaturesPass(desktop);
      await negativeControlPass(desktop);
      await lifecyclePass(desktop, definitions);
      await performancePass(desktop, definitions, "desktop");
      await semanticContractsPass(desktop, definitions);
    }
    await orderCoveragePass(desktop, definitions, "desktop");
    await desktopContext.close();

    const mobileContext = await browser.newContext({
      viewport: { width: 844, height: 390 }, deviceScaleFactor: 2,
      hasTouch: true, isMobile: true,
    });
    const mobile = await bootPage(mobileContext, "mobile-844x390");
    const mobileDefinitions = normalizeDefinitions(
      await invoke(mobile, "progressionDefinitions")
    );
    if (!WING_ONLY) await performancePass(mobile, mobileDefinitions, "mobile");
    await orderCoveragePass(mobile, mobileDefinitions, "mobile");
    await mobileContext.close();
  } finally {
    await browser.close();
  }
} catch (error) {
  diagnostics.fatal = error?.stack || String(error);
  check("talent feedback suite completes without a fatal harness error", false,
    diagnostics.fatal);
} finally {
  server.kill("SIGTERM");
}

check("no page errors", diagnostics.pageErrors.length === 0,
  diagnostics.pageErrors.slice(0, 12).join(" | "));
check("no console errors", diagnostics.consoleErrors.length === 0,
  diagnostics.consoleErrors.slice(0, 12).join(" | "));

const report = {
  gameUrl: GAME_URL,
  assertions: results.length,
  passed: results.length - failed,
  failed,
  results,
  diagnostics,
  evidence,
};
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.passed}/${report.assertions} checks passed`);
console.log(`Report: ${path.join(OUT, "report.json")}`);
if (failed) process.exitCode = 1;
