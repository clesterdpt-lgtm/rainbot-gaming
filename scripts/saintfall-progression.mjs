#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Field Rank and Doctrine regression

   Definition-driven coverage for the persistent career, five Doctrine
   Orders, and the two-Vow limit. The suite mutates progression only
   through the QA facade, whose methods call the production progression
   service. No local/cloud career record is written while `?qa=1` is set.

   Usage:
     node scripts/saintfall-progression.mjs
     node scripts/saintfall-progression.mjs --out output/saintfall/progression
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
const OUT = path.resolve(root, args.out || "output/saintfall/progression");
const PORT = 55000 + (process.pid % 5000);
const BASE = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE}/games/saintfall.html?qa=1&quality=low&intro=skip&seed=doctrine-v1`;
const results = [];
const diagnostics = { pageErrors: [], consoleErrors: [], fatal: null };
const evidence = {};
let failed = 0;

function check(name, ok, detail = "") {
  const pass = !!ok;
  results.push({ name, ok: pass, detail });
  if (!pass) failed += 1;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  if (detail) console.log(`        ${detail}`);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function normalizeDefinitions(raw) {
  const source = record(raw?.config || raw?.definitions || raw);
  const field = record(source.fieldRank || source.field || source.career);
  /* definitions() may return PROGRESSION_CONFIG or the doctrine-root view
     used by the menu. In the latter shape, points/seals/orders live directly
     on `source` beside `fieldRank`. */
  const doctrine = record(source.doctrine || source);
  const rawOrders = Array.isArray(doctrine.orders) ? doctrine.orders
    : Array.isArray(source.orders) ? source.orders
      : Object.values(record(doctrine.orders || source.orders));
  const orders = rawOrders.map((rawOrder) => {
    const order = record(rawOrder);
    const talents = (Array.isArray(order.talents) ? order.talents : []).map((rawTalent) => {
      const talent = record(rawTalent);
      return {
        ...talent,
        id: String(talent.id || ""),
        maxRank: Math.max(1, Math.floor(number(talent.maxRank,
          doctrine.talentMaxRank || 1))),
        requiredPoints: Math.max(0, Math.floor(number(
          talent.requires?.orderPoints,
          talent.requiredPoints ?? talent.orderPointsRequired ?? 0
        ))),
      };
    }).filter((talent) => talent.id);
    const capstone = record(order.capstone);
    return {
      ...order,
      id: String(order.id || ""),
      talents,
      capstone: capstone.id ? {
        ...capstone,
        id: String(capstone.id),
        requiredPoints: Math.max(0, Math.floor(number(
          capstone.requires?.orderPoints,
          capstone.requiredPoints ?? doctrine.capstoneEligibilityPoints ?? 8
        ))),
      } : null,
    };
  }).filter((order) => order.id);
  const thresholds = (field.xpThresholds || source.xpThresholds || [])
    .map((value) => Math.max(0, Math.floor(number(value))));
  return {
    raw,
    rankCap: Math.max(1, Math.floor(number(
      field.cap ?? field.maxRank ?? source.rankCap,
      thresholds.length || 25
    ))),
    thresholds,
    pointsPerRank: Math.max(0, Math.floor(number(doctrine.pointsPerRank, 1))),
    pointStartRank: Math.max(1, Math.floor(number(doctrine.pointStartRank, 2))),
    maxPointsPerOrder: Math.max(1, Math.floor(number(doctrine.maxPointsPerOrder, 8))),
    maxActiveCapstones: Math.max(1, Math.floor(number(doctrine.maxActiveCapstones, 2))),
    capstoneEligibilityPoints: Math.max(1, Math.floor(number(
      doctrine.capstoneEligibilityPoints, 8
    ))),
    sealRanks: (doctrine.vowSealRanks || doctrine.sealRanks || [])
      .map((value) => Math.max(1, Math.floor(number(value)))),
    orders,
  };
}

function normalizeAllocations(raw) {
  const out = {};
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") out[entry] = 1;
      else if (entry?.id) out[entry.id] = Math.max(0, Math.floor(number(entry.rank, 0)));
    }
    return out;
  }
  for (const [id, value] of Object.entries(record(raw))) {
    out[id] = Math.max(0, Math.floor(number(value?.rank ?? value, 0)));
  }
  return out;
}

function normalizeCapstones(raw) {
  const values = Array.isArray(raw) ? raw : Object.values(record(raw));
  return values.map((entry) => typeof entry === "string" ? entry
    : entry?.id || entry?.capstoneId || entry?.talentId || null).filter(Boolean);
}

function normalizeState(raw, definitions = null) {
  const source = record(raw);
  const career = record(source.career || source.fieldRank);
  const doctrine = record(source.doctrine);
  const loadout = record(source.loadout || doctrine.loadout);
  const rank = Math.max(1, Math.floor(number(firstDefined(
    source.rank, source.fieldRank?.rank, career.rank, career.fieldRank
  ), 1)));
  const allocations = normalizeAllocations(firstDefined(
    source.allocations, doctrine.allocations, loadout.allocations, source.talents
  ));
  const orderStates = Array.isArray(source.orders)
    ? source.orders
    : Object.entries(record(source.orders)).map(([id, value]) => ({ id, ...record(value) }));
  for (const orderState of orderStates) {
    const orderTalents = Array.isArray(orderState?.talents)
      ? orderState.talents
      : Object.entries(record(orderState?.talents)).map(([id, value]) => ({
        id,
        ...(typeof value === "object" ? value : { rank: value }),
      }));
    for (const talent of orderTalents) {
      if (talent?.id) {
        allocations[talent.id] = Math.max(0, Math.floor(number(talent.rank, 0)));
      }
    }
  }
  const activeCapstones = normalizeCapstones(firstDefined(
    source.activeCapstones, doctrine.activeCapstones, loadout.activeCapstones,
    source.equippedCapstones, doctrine.equippedCapstones
  ));
  const spentFromAllocations = Object.values(allocations).reduce((sum, value) => sum + value, 0);
  const points = record(source.points || doctrine.points || source.doctrinePoints);
  const expectedEarned = definitions
    ? Math.max(0, rank - definitions.pointStartRank + 1) * definitions.pointsPerRank : 0;
  const pointsEarned = Math.max(0, Math.floor(number(firstDefined(
    points.earned, source.pointsEarned, doctrine.pointsEarned
  ), expectedEarned)));
  const pointsSpent = Math.max(0, Math.floor(number(firstDefined(
    points.spent, source.pointsSpent, doctrine.pointsSpent
  ), spentFromAllocations)));
  const pointsFree = Math.max(0, Math.floor(number(firstDefined(
    points.free, points.available, source.pointsAvailable, doctrine.pointsAvailable
  ), pointsEarned - pointsSpent)));
  const seals = record(source.vowSeals || doctrine.vowSeals || source.seals);
  const expectedSeals = definitions
    ? definitions.sealRanks.filter((requiredRank) => rank >= requiredRank).length : 0;
  const sealsEarned = Math.max(0, Math.floor(number(firstDefined(
    seals.earned, source.vowSealsEarned, source.sealsEarned,
    doctrine.vowSealsEarned, doctrine.sealsEarned
  ), expectedSeals)));
  const sealsUsed = Math.max(0, Math.floor(number(firstDefined(
    seals.used, source.sealsUsed, doctrine.sealsUsed
  ), activeCapstones.length)));
  const sealsFree = Math.max(0, Math.floor(number(firstDefined(
    seals.free, seals.available, source.sealsAvailable, doctrine.sealsAvailable
  ), sealsEarned - sealsUsed)));
  return {
    raw,
    rank,
    xp: Math.max(0, Math.floor(number(firstDefined(
      source.totalXp, source.xpTotal, source.xp,
      career.totalXp, career.xpTotal, career.xp
    ), 0))),
    allocations,
    activeCapstones,
    points: { earned: pointsEarned, spent: pointsSpent, free: pointsFree },
    seals: { earned: sealsEarned, used: sealsUsed, free: sealsFree },
  };
}

function allocationRank(state, talentId) {
  return Math.max(0, Math.floor(number(state.allocations[talentId], 0)));
}

function investedInOrder(state, order) {
  return order.talents.reduce((sum, talent) => sum + allocationRank(state, talent.id), 0);
}

function sameIds(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

function mutationResult(result, expectedOk) {
  return !!result && typeof result === "object"
    && result.ok === expectedOk
    && !!result.state && typeof result.state === "object"
    && Number.isFinite(Number(result.state.rank));
}

function attachDiagnostics(page, label) {
  page.on("pageerror", (error) => diagnostics.pageErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location?.();
      diagnostics.consoleErrors.push(`${label}: ${message.text()}`
        + (location?.url ? ` @ ${location.url}:${location.lineNumber || 0}` : ""));
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
    window.__SF.invulnerable(true);
    document.getElementById("sf-boot")?.remove();
  });
  const hooks = await page.evaluate(() => {
    const T = window.__SF || {};
    const names = [
      "progressionState", "progressionDefinitions", "progressionCareerForQA",
      "validateProgressionCareerForQA", "progressionFieldForQA",
      "restoreProgressionFieldForQA", "clearProgressionFieldForQA",
      "grantProgressionXpForQA",
      "spendTalentForQA", "refundTalentForQA", "equipCapstoneForQA",
      "unequipCapstoneForQA", "respecProgressionForQA", "resetProgressionForQA",
      "careerConflictStateForQA", "stageCareerConflictForQA",
      "resolveCareerConflictForQA",
    ];
    return Object.fromEntries(names.map((name) => [name, typeof T[name] === "function"]));
  });
  check(`${label} exposes the complete progression QA facade`,
    Object.values(hooks).every(Boolean), JSON.stringify(hooks));
  return page;
}

async function openMenuWithEscape(page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.keyboard.press("Escape");
    try {
      await page.waitForFunction(() => window.__SF?.menuState?.()?.open,
        null, { timeout: 2500 });
      return true;
    } catch (_) { /* Pointer lock may consume the first Escape. */ }
  }
  return false;
}

async function rawDefinitions(page) {
  return await page.evaluate(() => window.__SF.progressionDefinitions?.() || null);
}

async function rawState(page) {
  return await page.evaluate(() => window.__SF.progressionState?.() || null);
}

async function state(page, definitions) {
  return normalizeState(await rawState(page), definitions);
}

async function invoke(page, method, ...methodArgs) {
  return await page.evaluate(({ name, args: values }) => {
    const fn = window.__SF?.[name];
    return typeof fn === "function" ? fn(...values) : { ok: false, reason: `missing-${name}` };
  }, { name: method, args: methodArgs });
}

async function grantToRank(page, definitions, targetRank, receipt) {
  const before = await state(page, definitions);
  const threshold = definitions.thresholds[targetRank - 1];
  if (!Number.isFinite(threshold)) throw new Error(`No XP threshold for rank ${targetRank}`);
  const amount = Math.max(0, threshold - before.xp);
  if (amount > 0) await invoke(page, "grantProgressionXpForQA", amount, receipt);
  return await state(page, definitions);
}

async function fillOrder(page, definitions, order, targetPoints) {
  const attempts = [];
  for (let guard = 0; guard < 40; guard += 1) {
    const before = await state(page, definitions);
    const invested = investedInOrder(before, order);
    if (invested >= targetPoints) return { ok: invested === targetPoints, attempts, state: before };
    const talent = order.talents.find((candidate) =>
      candidate.implemented !== false
      && allocationRank(before, candidate.id) < candidate.maxRank
      && candidate.requiredPoints <= invested
    );
    if (!talent) return { ok: false, attempts, state: before, reason: "no-eligible-talent" };
    const response = await invoke(page, "spendTalentForQA", talent.id);
    const after = await state(page, definitions);
    attempts.push({ talentId: talent.id, before: invested,
      after: investedInOrder(after, order), response });
    if (investedInOrder(after, order) !== invested + 1) {
      return { ok: false, attempts, state: after, reason: "spend-did-not-advance" };
    }
  }
  return { ok: false, attempts, state: await state(page, definitions), reason: "guard" };
}

async function prepareOrder(page, definitions, orderId, {
  targetRank = definitions.rankCap,
  equipCapstone = false,
  receipt = `qa:prepare:${orderId}`,
} = {}) {
  await invoke(page, "resetProgressionForQA");
  const order = definitions.orders.find((candidate) => candidate.id === orderId);
  if (!order) return { ok: false, reason: "missing-order", order: null };
  const ranked = await grantToRank(page, definitions, targetRank, receipt);
  const fill = await fillOrder(page, definitions, order, definitions.maxPointsPerOrder);
  const equip = equipCapstone && order.capstone
    ? await invoke(page, "equipCapstoneForQA", order.capstone.id) : null;
  return {
    ok: ranked.rank === targetRank && fill.ok && (!equipCapstone || equip?.ok === true),
    order,
    ranked,
    fill,
    equip,
    state: await state(page, definitions),
  };
}

async function progressionPass(page) {
  console.log("\n=== FIELD RANK AND DOCTRINE RULES ===");
  const rawDefinitionValue = await rawDefinitions(page);
  const definitionRoot = record(rawDefinitionValue?.config
    || rawDefinitionValue?.definitions || rawDefinitionValue);
  const rawDoctrine = record(definitionRoot.doctrine || definitionRoot);
  const rawField = record(definitionRoot.fieldRank || rawDoctrine.fieldRank);
  const definitions = normalizeDefinitions(rawDefinitionValue);
  check("definitions() exposes the required Field Rank and Doctrine contract",
    Number.isFinite(Number(definitionRoot.schemaVersion || rawDoctrine.schemaVersion))
      && Number(rawField.cap) === 25
      && Array.isArray(rawField.xpThresholds)
      && rawField.xpThresholds.length === 25
      && Number(rawDoctrine.pointsPerRank) === 1
      && Number(rawDoctrine.pointStartRank) === 2
      && Number(rawDoctrine.maxPointsPerOrder) === 8
      && Number(rawDoctrine.maxActiveCapstones) === 2
      && Array.isArray(rawDoctrine.vowSealRanks)
      && Array.isArray(rawDoctrine.orders),
    JSON.stringify({ schemaVersion: definitionRoot.schemaVersion || rawDoctrine.schemaVersion,
      fieldRank: rawField, doctrineKeys: Object.keys(rawDoctrine) }));
  evidence.definitions = {
    rankCap: definitions.rankCap,
    thresholds: definitions.thresholds,
    pointsPerRank: definitions.pointsPerRank,
    pointStartRank: definitions.pointStartRank,
    maxPointsPerOrder: definitions.maxPointsPerOrder,
    maxActiveCapstones: definitions.maxActiveCapstones,
    sealRanks: definitions.sealRanks,
    orders: definitions.orders.map((order) => ({
      id: order.id,
      talents: order.talents.map((talent) => ({ id: talent.id, maxRank: talent.maxRank,
        requiredPoints: talent.requiredPoints })),
      capstone: order.capstone?.id || null,
    })),
  };
  check("progression definitions retain five Orders and a rank-25 curve",
    definitions.orders.length === 5 && definitions.rankCap === 25
      && definitions.thresholds.length === 25
      && definitions.thresholds.every((value, index, values) => index === 0 || value > values[index - 1]),
    JSON.stringify(evidence.definitions));
  check("Doctrine grants 24 points and Vow Seals at ranks 12 and 22",
    definitions.pointsPerRank === 1 && definitions.pointStartRank === 2
      && JSON.stringify(definitions.sealRanks) === JSON.stringify([12, 22])
      && definitions.maxActiveCapstones === 2,
    JSON.stringify({ pointsPerRank: definitions.pointsPerRank,
      pointStartRank: definitions.pointStartRank, sealRanks: definitions.sealRanks,
      maxActiveCapstones: definitions.maxActiveCapstones }));
  check("every Order exposes ranked talents and one eligible capstone",
    definitions.orders.reduce((sum, order) => sum + order.talents.length, 0) === 20
      && definitions.orders.every((order) => order.talents.length === 4
      && order.talents.every((talent) => talent.maxRank >= 1)
      && order.capstone?.id
      && order.capstone.requiredPoints === definitions.capstoneEligibilityPoints),
    JSON.stringify(evidence.definitions.orders));
  check("a Vow needs one maxed T1/T2/T3 path (6 pts); the second T1 is optional",
    definitions.capstoneEligibilityPoints === 6
      && definitions.maxPointsPerOrder === 8
      && definitions.orders.every((order) => {
        const open = order.talents.filter((talent) => talent.requiredPoints === 0);
        const t2 = order.talents.find((talent) => talent.requiredPoints === 2);
        const t3 = order.talents.find((talent) => talent.requiredPoints === 4);
        return open.length === 2 && open.every((talent) => talent.maxRank === 2)
          && t2?.maxRank === 2 && t3?.maxRank === 2
          && order.capstone.requiredPoints === 6;
      }),
    JSON.stringify({
      capstoneEligibilityPoints: definitions.capstoneEligibilityPoints,
      maxPointsPerOrder: definitions.maxPointsPerOrder,
      orders: definitions.orders.map((order) => ({
        id: order.id,
        talents: order.talents.map((talent) => ({
          id: talent.id, requiredPoints: talent.requiredPoints, maxRank: talent.maxRank,
        })),
        vow: order.capstone.requiredPoints,
      })),
    }));
  const unimplemented = definitions.orders.flatMap((order) => [
    ...order.talents.filter((talent) => talent.implemented === false)
      .map((talent) => talent.id),
    ...(order.capstone?.implemented === false ? [order.capstone.id] : []),
  ]);
  check("all five Orders expose playable talents and capstones",
    unimplemented.length === 0,
    JSON.stringify({ unimplemented }));

  await invoke(page, "resetProgressionForQA");
  const freshRaw = await rawState(page);
  check("state() exposes unsynthesized career, point, seal, Order, and effect fields",
    Number.isFinite(Number(freshRaw?.rank))
      && Number.isFinite(Number(freshRaw?.xp ?? freshRaw?.totalXp))
      && Number.isFinite(Number(freshRaw?.pointsEarned))
      && Number.isFinite(Number(freshRaw?.pointsSpent))
      && Number.isFinite(Number(freshRaw?.pointsAvailable))
      && Number.isFinite(Number(freshRaw?.vowSealsEarned))
      && Array.isArray(freshRaw?.activeCapstones)
      && (Array.isArray(freshRaw?.orders)
        || !!freshRaw?.orders && typeof freshRaw.orders === "object")
      && !!freshRaw?.effects && typeof freshRaw.effects === "object",
    JSON.stringify({ rank: freshRaw?.rank, xp: freshRaw?.xp,
      pointsEarned: freshRaw?.pointsEarned, pointsSpent: freshRaw?.pointsSpent,
      pointsAvailable: freshRaw?.pointsAvailable,
      vowSealsEarned: freshRaw?.vowSealsEarned,
      activeCapstones: freshRaw?.activeCapstones,
      orders: Array.isArray(freshRaw?.orders) ? freshRaw.orders.length : null,
      effectKeys: Object.keys(record(freshRaw?.effects)) }));
  let current = await state(page, definitions);
  check("a fresh career begins at Rank 1 with no points, seals, or Vows",
    current.rank === 1 && current.xp === 0
      && current.points.earned === 0 && current.points.spent === 0 && current.points.free === 0
      && current.seals.earned === 0 && current.activeCapstones.length === 0,
    JSON.stringify(current));

  const rankTwoThreshold = definitions.thresholds[1];
  await invoke(page, "grantProgressionXpForQA", rankTwoThreshold - 1, "qa:rank-2-below");
  const below = await state(page, definitions);
  await invoke(page, "grantProgressionXpForQA", 1, "qa:rank-2-boundary");
  const boundary = await state(page, definitions);
  check("the first rank changes only at the exact configured XP threshold",
    below.rank === 1 && below.xp === rankTwoThreshold - 1
      && boundary.rank === 2 && boundary.xp === rankTwoThreshold
      && boundary.points.earned === 1 && boundary.points.free === 1,
    JSON.stringify({ below, boundary }));

  const duplicateBefore = boundary.xp;
  await invoke(page, "grantProgressionXpForQA", 7, "qa:duplicate-receipt");
  const duplicateFirst = await state(page, definitions);
  await invoke(page, "grantProgressionXpForQA", 7, "qa:duplicate-receipt");
  const duplicateSecond = await state(page, definitions);
  check("an XP receipt is idempotent",
    duplicateFirst.xp === duplicateBefore + 7 && duplicateSecond.xp === duplicateFirst.xp,
    JSON.stringify({ before: duplicateBefore, first: duplicateFirst.xp,
      second: duplicateSecond.xp }));

  await invoke(page, "resetProgressionForQA");
  const thresholdAudit = [];
  let atFirstSeal = null;
  let atSecondSeal = null;
  let atCap = null;
  for (let targetRank = 2; targetRank <= definitions.rankCap; targetRank += 1) {
    const beforeThreshold = await state(page, definitions);
    const threshold = definitions.thresholds[targetRank - 1];
    const gap = threshold - beforeThreshold.xp;
    if (gap > 1) {
      await invoke(page, "grantProgressionXpForQA", gap - 1,
        `qa:audit-rank-${targetRank}-below`);
    }
    const belowThreshold = await state(page, definitions);
    await invoke(page, "grantProgressionXpForQA", threshold - belowThreshold.xp,
      `qa:audit-rank-${targetRank}-boundary`);
    const atThreshold = await state(page, definitions);
    thresholdAudit.push({ targetRank, threshold, belowRank: belowThreshold.rank,
      belowXp: belowThreshold.xp, boundaryRank: atThreshold.rank,
      boundaryXp: atThreshold.xp });
    if (targetRank === 12) atFirstSeal = atThreshold;
    if (targetRank === 22) atSecondSeal = atThreshold;
    if (targetRank === definitions.rankCap) atCap = atThreshold;
  }
  evidence.thresholdAudit = thresholdAudit;
  check("every configured XP boundary advances to its exact Field Rank",
    thresholdAudit.length === definitions.rankCap - 1
      && thresholdAudit.every((entry) => entry.belowRank === entry.targetRank - 1
        && entry.belowXp === entry.threshold - 1
        && entry.boundaryRank === entry.targetRank
        && entry.boundaryXp === entry.threshold),
    JSON.stringify(thresholdAudit));
  await invoke(page, "grantProgressionXpForQA", 999999, "qa:rank-cap-overflow");
  const overflow = await state(page, definitions);
  check("rank-ups across multiple thresholds preserve every Doctrine point",
    atFirstSeal.rank === 12 && atFirstSeal.points.earned === 11
      && atFirstSeal.seals.earned === 1
      && atSecondSeal.rank === 22 && atSecondSeal.points.earned === 21
      && atSecondSeal.seals.earned === 2,
    JSON.stringify({ atFirstSeal, atSecondSeal }));
  check("Rank 25 clamps at exactly 24 earned Doctrine points",
    atCap.rank === 25 && overflow.rank === 25
      && overflow.points.earned === 24 && overflow.points.free === 24,
    JSON.stringify({ atCap, overflow }));

  const firstOrder = definitions.orders[0];
  const lockedTalent = firstOrder.talents
    .filter((talent) => talent.implemented !== false && talent.requiredPoints > 0)
    .sort((a, b) => b.requiredPoints - a.requiredPoints)[0];
  const beforeLocked = await state(page, definitions);
  const lockedResponse = lockedTalent
    ? await invoke(page, "spendTalentForQA", lockedTalent.id) : null;
  const afterLocked = await state(page, definitions);
  check("higher-tier talents remain locked until their Order investment is met",
    !!lockedTalent && allocationRank(afterLocked, lockedTalent.id) === 0
      && afterLocked.points.spent === beforeLocked.points.spent
      && mutationResult(lockedResponse, false),
    JSON.stringify({ talent: lockedTalent, response: lockedResponse,
      before: beforeLocked.points, after: afterLocked.points }));

  const openTalents = firstOrder.talents.filter((talent) => talent.requiredPoints === 0);
  const branchT1 = openTalents[0];
  const spareT1 = openTalents[1];
  const branchT2 = firstOrder.talents.find((talent) => talent.requiredPoints === 2);
  const branchT3 = firstOrder.talents.find((talent) => talent.requiredPoints === 4);
  const branchSpends = [];
  for (const talent of [branchT1, branchT2, branchT3]) {
    for (let rank = 0; rank < talent.maxRank; rank += 1) {
      branchSpends.push(await invoke(page, "spendTalentForQA", talent.id));
    }
  }
  const afterBranch = await state(page, definitions);
  const branchEquip = firstOrder.capstone
    ? await invoke(page, "equipCapstoneForQA", firstOrder.capstone.id) : null;
  const afterBranchVow = await state(page, definitions);
  check("maxing one T1 plus T2 and T3 (6 pts) binds the Vow without the other T1",
    openTalents.length === 2 && branchT1 && spareT1 && branchT2 && branchT3
      && branchSpends.every((response) => mutationResult(response, true))
      && allocationRank(afterBranch, branchT1.id) === 2
      && allocationRank(afterBranch, spareT1.id) === 0
      && allocationRank(afterBranch, branchT2.id) === 2
      && allocationRank(afterBranch, branchT3.id) === 2
      && afterBranch.points.spent === 6
      && mutationResult(branchEquip, true)
      && afterBranchVow.activeCapstones.includes(firstOrder.capstone.id),
    JSON.stringify({
      branchT1: branchT1?.id, spareT1: spareT1?.id, branchT2: branchT2?.id, branchT3: branchT3?.id,
      spends: branchSpends, spent: afterBranch.points.spent,
      ranks: {
        t1: allocationRank(afterBranch, branchT1?.id),
        spare: allocationRank(afterBranch, spareT1?.id),
        t2: allocationRank(afterBranch, branchT2?.id),
        t3: allocationRank(afterBranch, branchT3?.id),
      },
      equip: branchEquip, vows: afterBranchVow.activeCapstones,
    }));
  await invoke(page, "resetProgressionForQA");
  await grantToRank(page, definitions, definitions.rankCap, "qa:restore-after-branch");

  const starter = firstOrder.talents.find((talent) =>
    talent.implemented !== false && talent.requiredPoints === 0);
  const spendResponse = await invoke(page, "spendTalentForQA", starter.id);
  const afterFirstSpend = await state(page, definitions);
  const refundResponse = await invoke(page, "refundTalentForQA", starter.id);
  const afterRefund = await state(page, definitions);
  check("a valid spend and refund move exactly one Doctrine point",
    mutationResult(spendResponse, true) && mutationResult(refundResponse, true)
      && allocationRank(afterFirstSpend, starter.id) === 1
      && afterFirstSpend.points.spent === 1 && afterFirstSpend.points.free === 23
      && allocationRank(afterRefund, starter.id) === 0
      && afterRefund.points.spent === 0 && afterRefund.points.free === 24,
    JSON.stringify({ spendResponse, refundResponse, afterFirstSpend, afterRefund }));

  for (let rank = 0; rank < starter.maxRank; rank += 1) {
    await invoke(page, "spendTalentForQA", starter.id);
  }
  const atTalentMax = await state(page, definitions);
  const maxResponse = await invoke(page, "spendTalentForQA", starter.id);
  const beyondTalentMax = await state(page, definitions);
  check("a talent cannot be purchased beyond its configured maximum rank",
    mutationResult(maxResponse, false)
      && allocationRank(atTalentMax, starter.id) === starter.maxRank
      && allocationRank(beyondTalentMax, starter.id) === starter.maxRank
      && beyondTalentMax.points.spent === atTalentMax.points.spent,
    JSON.stringify({ talent: starter, response: maxResponse,
      atMax: atTalentMax.points, beyond: beyondTalentMax.points }));

  const orderFills = [];
  for (const order of definitions.orders.slice(0, 3)) {
    const fill = await fillOrder(page, definitions, order, definitions.maxPointsPerOrder);
    orderFills.push({ orderId: order.id, ok: fill.ok, reason: fill.reason,
      invested: investedInOrder(fill.state, order), attempts: fill.attempts });
  }
  current = await state(page, definitions);
  evidence.orderFills = orderFills;
  check("three Orders can each reach capstone eligibility with the 24-point budget",
    orderFills.every((fill) => fill.ok && fill.invested === definitions.maxPointsPerOrder)
      && current.points.spent === 24 && current.points.free === 0,
    JSON.stringify({ orderFills, points: current.points }));

  const caps = definitions.orders.slice(0, 3).map((order) => order.capstone);
  const firstEquip = await invoke(page, "equipCapstoneForQA", caps[0].id);
  const oneVow = await state(page, definitions);
  const duplicateEquip = await invoke(page, "equipCapstoneForQA", caps[0].id);
  const duplicateState = await state(page, definitions);
  const secondEquip = await invoke(page, "equipCapstoneForQA", caps[1].id);
  const twoVows = await state(page, definitions);
  const thirdResponse = await invoke(page, "equipCapstoneForQA", caps[2].id);
  const thirdState = await state(page, definitions);
  check("equipping the same capstone twice is idempotent",
    mutationResult(firstEquip, true) && mutationResult(duplicateEquip, true)
      && duplicateEquip.idempotent === true
      && oneVow.activeCapstones.length === 1
      && duplicateState.activeCapstones.length === 1
      && sameIds(oneVow.activeCapstones, duplicateState.activeCapstones),
    JSON.stringify({ duplicateEquip, one: oneVow.activeCapstones,
      duplicate: duplicateState.activeCapstones }));
  check("two Vow Seals activate exactly two eligible capstones",
    mutationResult(secondEquip, true)
      && twoVows.activeCapstones.length === 2 && twoVows.seals.used === 2
      && caps.slice(0, 2).every((capstone) => twoVows.activeCapstones.includes(capstone.id)),
    JSON.stringify({ active: twoVows.activeCapstones, seals: twoVows.seals }));
  check("a third eligible capstone is rejected without replacing either active Vow",
    mutationResult(thirdResponse, false)
      && thirdState.activeCapstones.length === 2
      && !thirdState.activeCapstones.includes(caps[2].id)
      && sameIds(twoVows.activeCapstones, thirdState.activeCapstones),
    JSON.stringify({ response: thirdResponse, before: twoVows.activeCapstones,
      after: thirdState.activeCapstones }));

  const unequipResponse = await invoke(page, "unequipCapstoneForQA", caps[0].id);
  const afterUnequip = await state(page, definitions);
  const replacementResponse = await invoke(page, "equipCapstoneForQA", caps[2].id);
  const replacement = await state(page, definitions);
  check("unequipping a Vow frees one seal for another eligible capstone",
    mutationResult(unequipResponse, true) && mutationResult(replacementResponse, true)
      && afterUnequip.activeCapstones.length === 1 && afterUnequip.seals.free === 1
      && replacement.activeCapstones.length === 2
      && replacement.activeCapstones.includes(caps[2].id),
    JSON.stringify({ unequipResponse, replacementResponse, afterUnequip, replacement }));

  evidence.progressionTerminal = replacement.raw;
  return definitions;
}

async function gameplayEffectsPass(page, definitions) {
  console.log("\n=== PRODUCTION DOCTRINE EFFECTS ===");

  /* Two real enemies intentionally share one authoritative identity. Both
     traverse combat.damageEnemy -> kill event -> progression receipt, so the
     second event proves deduplication applies to both XP and lifetime stats. */
  await invoke(page, "resetProgressionForQA");
  const duplicateKillProbe = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    const ps = T.player.state;
    const kill = () => {
      const target = T.enemies.spawn("thresher", ps.x + 4, ps.z + 4, {
        id: "qa-duplicate-authoritative-kill", health: 1,
      });
      return T.combat.damageEnemy(target, 999, {
        source: "shot", x: target.x, y: target.y + 0.5, z: target.z,
      });
    };
    const firstDamage = kill();
    const afterFirst = T.progressionState();
    const secondDamage = kill();
    const afterSecond = T.progressionState();
    T.clearEnemies();
    return {
      firstDamage,
      secondDamage,
      firstXp: afterFirst?.xp,
      secondXp: afterSecond?.xp,
      firstKills: afterFirst?.lifetime?.kills,
      secondKills: afterSecond?.lifetime?.kills,
    };
  });
  evidence.duplicateKill = duplicateKillProbe;
  check("duplicate authoritative kill identity awards XP and lifetime credit only once",
    duplicateKillProbe.firstDamage === 1
      && duplicateKillProbe.secondDamage === 1
      && duplicateKillProbe.firstXp > 0
      && duplicateKillProbe.secondXp === duplicateKillProbe.firstXp
      && duplicateKillProbe.firstKills === 1
      && duplicateKillProbe.secondKills === 1,
    JSON.stringify(duplicateKillProbe));

  /* Rite of Censure is driven through combat.damageEnemy, the same
     authoritative damage function used by shots, melee, shockwaves, and
     explosions. The QA facade only establishes the owned talent; it does
     not touch the brand map, damage modifier, heat refund, or counters. */
  await invoke(page, "resetProgressionForQA");
  await grantToRank(page, definitions, 3, "qa:effect:censure-rank");
  const censer = definitions.orders.find((order) => order.id === "censer")
    || definitions.orders[0];
  const censure = censer?.talents.find((talent) =>
    talent.implemented !== false && talent.requiredPoints === 0);
  const censureSpends = censure
    ? [await invoke(page, "spendTalentForQA", censure.id),
      await invoke(page, "spendTalentForQA", censure.id)] : [];
  const censureProbe = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.teleport(-520, -562, 0);
    const ps = T.player.state;
    const target = T.enemies.spawn("harrow",
      ps.x + 4, ps.z, { health: 400 });
    if (!target) return { error: "enemy-spawn-failed" };
    const bystander = T.enemies.spawn("thresher",
      target.x + 2.2, target.z, { health: 400 });
    if (!bystander) return { error: "bystander-spawn-failed" };
    let pulse = null;
    const stopPulse = T.combat.bus.on("shockwave", (event) => {
      if (event?.source === "censure-brand") pulse = { ...event };
    });
    T.weapons.setHeat(0.5, { reason: "qa-censure-boundary" });
    const healthBefore = target.health;
    const bystanderBefore = {
      health: bystander.health, state: bystander.state,
      x: bystander.x, z: bystander.z,
    };
    const precisionDamage = T.combat.damageEnemy(target, 10, {
      source: "shot", head: true, x: target.x, y: target.y + 1, z: target.z,
    });
    const branded = T.progressionState();
    const healthAfterPrecision = target.health;
    const meleeDamage = T.combat.damageEnemy(target, 20, {
      source: "melee", x: target.x, y: target.y + 1, z: target.z,
    });
    const resolved = T.progressionState();
    const heatAfterMelee = T.weapons.heatState()?.heat;
    const impulse = Math.hypot(bystander.knockbackX || 0, bystander.knockbackZ || 0);
    const distanceBefore = Math.hypot(bystander.x - target.x, bystander.z - target.z);
    const stunnedBeforeStep = bystander.stunTime || 0;
    const knockbackBeforeStep = bystander.knockbackTime || 0;
    T.advanceTime(0.1, 1 / 120);
    const distanceAfter = Math.hypot(bystander.x - target.x, bystander.z - target.z);
    stopPulse?.();
    return {
      healthBefore,
      healthAfterPrecision,
      healthAfterMelee: target.health,
      precisionDamage,
      meleeDamage,
      heatAfter: heatAfterMelee,
      brandsAfterPrecision: branded?.effects?.brands,
      brandsAfterMelee: resolved?.effects?.brands,
      brandsBroken: resolved?.effects?.counters?.brandsBroken || 0,
      pulse,
      bystanderBefore,
      bystanderAfter: {
        health: bystander.health, state: bystander.state,
        stunTime: bystander.stunTime || 0,
        knockbackTime: bystander.knockbackTime || 0,
      },
      stunnedBeforeStep,
      knockbackBeforeStep,
      impulse,
      distanceBefore,
      distanceAfter,
    };
  });
  evidence.censureEffect = { talentId: censure?.id || null,
    spends: censureSpends, probe: censureProbe };
  check("Rite of Censure brands a precision hit, amplifies melee, and refunds heat",
    !!censure && censureSpends.length === 2 && censureSpends.every((entry) => entry?.ok === true)
      && censureProbe.brandsAfterPrecision === 1
      && censureProbe.brandsAfterMelee === 0
      && censureProbe.precisionDamage === 10
      && Math.abs(censureProbe.meleeDamage - 27) < 0.001
      && Math.abs(censureProbe.healthAfterPrecision
        - censureProbe.healthAfterMelee - 27) < 0.001
      && Math.abs(censureProbe.heatAfter - 0.38) < 0.001
      && censureProbe.brandsBroken === 1,
    JSON.stringify(evidence.censureEffect));
  check("a zero-damage progression shockwave stuns and knocks back without killing",
    censureProbe.pulse?.hits >= 2
      && censureProbe.pulse?.stunned >= 1
      && censureProbe.pulse?.kills === 0
      && censureProbe.bystanderBefore?.health === censureProbe.bystanderAfter?.health
      && censureProbe.bystanderAfter?.state !== "death"
      && censureProbe.stunnedBeforeStep > 0
      && censureProbe.knockbackBeforeStep > 0
      && censureProbe.impulse > 0,
    JSON.stringify(evidence.censureEffect));

  /* Hold the real ground boost beyond Wingbeat's entire rank-2 window,
     then release and ignite promptly. A start-time implementation cannot
     pass because the boost has already been active for more than 0.7s. */
  await invoke(page, "resetProgressionForQA");
  await grantToRank(page, definitions, 3, "qa:effect:wingbeat-rank");
  const wingOrder = definitions.orders.find((order) => order.id === "wing");
  const wingbeat = wingOrder?.talents.find((talent) => talent.id === "wing_wingbeat_conversion");
  const wingbeatSpends = wingbeat
    ? [await invoke(page, "spendTalentForQA", wingbeat.id),
      await invoke(page, "spendTalentForQA", wingbeat.id)] : [];
  const wingbeatProbe = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.teleport(655, 700, 0);
    T.setJetInput(false);
    T.setBoostHold(false);
    T.setGaitInput(0, -1);
    T.resetBoost(true);
    T.jetpack.reset(true);
    T.setJetpackState({ fuel: 90, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
    T.renderOnce(1 / 60);
    T.setBoostHold(true);
    const boost = T.triggerBoost(0, -1);
    T.advanceTime(0.01, 1 / 120);
    const held = { ...T.boostState(), active: true, elapsed: 1.05 };
    T.progression.noteVerb("boostEnd", {
      verb: "boostEnd", x: T.player.state.x, y: T.player.state.y,
      z: T.player.state.z, elapsed: 1.05, reason: "released",
    });
    T.setBoostHold(false);
    T.resetBoost(false);
    const released = { ...T.boostState(), active: false };
    const fuelBeforeJet = T.jetpackState().fuel;
    T.setJetInput(false);
    T.renderOnce(1 / 120);
    T.setJetInput(true);
    T.renderOnce(1 / 120);
    const afterJet = T.jetpackState();
    const progression = T.progressionState();
    const restoreReason = T.jetpack.state.lastRestoreReason || "";
    T.setJetInput(false);
    T.setBoostHold(false);
    T.setGaitInput(null, null);
    T.resetBoost(true);
    T.jetpack.reset(true);
    T.teleport(T.player.state.x, T.player.state.z, T.player.state.yaw);
    return {
      boost,
      held,
      released,
      fuelBeforeJet,
      afterJet,
      restoreReason,
      conversions: progression?.effects?.counters?.wingbeatConversions || 0,
    };
  });
  evidence.wingbeatReleaseTiming = {
    talentId: wingbeat?.id || null, spends: wingbeatSpends, probe: wingbeatProbe,
  };
  check("Wingbeat Conversion times its jet window from a long boost's release",
    !!wingbeat && wingbeatSpends.length === 2
      && wingbeatSpends.every((entry) => entry?.ok === true)
      && wingbeatProbe.boost?.triggered === true
      && wingbeatProbe.held?.active === true
      && wingbeatProbe.held?.elapsed > 0.9
      && wingbeatProbe.released?.active === false
      && wingbeatProbe.afterJet?.inFlight === true
      && wingbeatProbe.restoreReason === "wingbeat-conversion"
      && wingbeatProbe.conversions === 1
      && wingbeatProbe.afterJet.fuel > wingbeatProbe.fuelBeforeJet - 1,
    JSON.stringify(evidence.wingbeatReleaseTiming));

  /* Unbroken Circuit is completed by two production-owned Wing verbs. Boost
     triggers its real movement module and jet ignition crosses the actual
     input edge in jetpack.update. Penitent's Fall then proves the surge's
     free action cost and empowered impact contract. */
  await invoke(page, "resetProgressionForQA");
  await grantToRank(page, definitions, 12, "qa:effect:circuit-rank");
  const wing = definitions.orders.find((order) => order.id === "wing")
    || definitions.orders.find((order) => order.capstone?.implemented !== false);
  const wingFill = wing
    ? await fillOrder(page, definitions, wing, definitions.maxPointsPerOrder) : null;
  const circuitEquip = wing?.capstone
    ? await invoke(page, "equipCapstoneForQA", wing.capstone.id) : null;
  const circuitProbe = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.setJetInput(false);
    T.setShieldInput(false);
    T.resetBoost(true);
    T.resetSlam(true);
    T.jetpack.reset(true);
    T.teleport(655, 700, 0);
    T.setJetpackState({ fuel: 60, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
    T.renderOnce(1 / 60);
    const initial = T.jetpackState();

    const boost = T.triggerBoost(1, 0);
    const afterBoost = T.progressionState();
    T.resetBoost(true);

    /* Establish a released frame before the rising edge. */
    T.setJetInput(false);
    T.renderOnce(1 / 60);
    T.setJetInput(true);
    T.renderOnce(1 / 60);
    const afterJet = T.progressionState();
    const afterJetpack = T.jetpackState();
    const completionRestoreReason = T.jetpack.state.lastRestoreReason || "";
    T.setJetInput(false);
    T.renderOnce(1 / 60);

    /* Keep the mechanic path real while making the airborne precondition
       deterministic; terrain contact in a single rendered QA frame should
       not decide whether the Circuit's slam verb is testable. */
    const ps = T.player.state;
    ps.y = T.collide.groundHeight(ps.x, ps.z) + 8;
    ps.grounded = false;
    ps.vy = 0;

    const beforeSlam = T.jetpackState();
    const altitude = T.slamAltitude();
    const slam = T.triggerSlam();
    const afterSlam = T.jetpackState();
    const completed = T.progressionState();
    const restoreReason = T.jetpack.state.lastRestoreReason || "";
    const empoweredFall = T.progression.modifySlam({ radius: 7, damage: 120 });
    T.setJetInput(false);
    T.resetBoost(true);
    T.resetSlam(true);
    T.jetpack.reset(true);
    T.teleport(T.player.state.x, T.player.state.z, T.player.state.yaw);
    return {
      initial,
      boost,
      verbsAfterBoost: afterBoost?.effects?.circuitVerbs || [],
      verbsAfterJet: afterJet?.effects?.circuitVerbs || [],
      surgeAfterJet: afterJet?.effects?.circuitSurgeRemaining || 0,
      cooldownAfterJet: afterJet?.effects?.circuitCooldown || 0,
      circuitsAfterJet: afterJet?.effects?.counters?.circuitsCompleted || 0,
      afterJetpack,
      completionRestoreReason,
      beforeSlam,
      altitude,
      slam,
      afterSlam,
      restoreReason,
      verbsAfterSlam: completed?.effects?.circuitVerbs || [],
      cooldown: completed?.effects?.circuitCooldown || 0,
      circuitsCompleted: completed?.effects?.counters?.circuitsCompleted || 0,
      empoweredFall,
    };
  });
  evidence.circuitEffect = {
    orderId: wing?.id || null,
    capstoneId: wing?.capstone?.id || null,
    fill: wingFill ? { ok: wingFill.ok,
      invested: investedInOrder(wingFill.state, wing) } : null,
    equip: circuitEquip,
    probe: circuitProbe,
  };
  check("Unbroken Circuit completes through boost and jet, then empowers a free Fall",
    !!wing && wingFill?.ok === true && circuitEquip?.ok === true
      && circuitProbe.boost?.triggered === true
      && circuitProbe.verbsAfterBoost.includes("boost")
      && circuitProbe.verbsAfterJet.length === 0
      && circuitProbe.circuitsAfterJet === 1
      && circuitProbe.surgeAfterJet > 5.8
      && circuitProbe.cooldownAfterJet > 13.8
      && circuitProbe.completionRestoreReason === "unbroken-circuit"
      && circuitProbe.altitude >= 1.5
      && circuitProbe.slam?.triggered === true
      && circuitProbe.verbsAfterSlam.length === 0
      && circuitProbe.circuitsCompleted === 1
      && circuitProbe.cooldown > 13
      && circuitProbe.restoreReason === "unbroken-circuit-surge"
      && Math.abs(circuitProbe.afterSlam.fuel - circuitProbe.beforeSlam.fuel) < 0.15
      && Math.abs(circuitProbe.empoweredFall?.radius - 10) < 0.05
      && Math.abs(circuitProbe.empoweredFall?.damage - 168) < 0.05,
    JSON.stringify(evidence.circuitEffect));

  await invoke(page, "resetProgressionForQA");
}

async function haloEffectsPass(page, definitions) {
  console.log("\n=== ORDER OF THE HALO EFFECTS ===");
  const prepared = await prepareOrder(page, definitions, "halo", {
    receipt: "qa:effect:halo-rank",
  });
  const order = prepared.order;
  /* Ram's Halo has to be genuinely owned for the reversal probe to prove
     the important negative path: a doctrine-authorized side/back contact
     is still mobility, not a forward Ram. Rank 25 leaves enough points to
     inscribe both complete Orders through the same progression service. */
  const wing = definitions.orders.find((candidate) => candidate.id === "wing");
  const wingFill = wing
    ? await fillOrder(page, definitions, wing, definitions.maxPointsPerOrder) : null;
  evidence.haloPreparation = {
    ok: prepared.ok && wingFill?.ok === true,
    invested: order && prepared.fill ? investedInOrder(prepared.fill.state, order) : 0,
    wingInvested: wing && wingFill ? investedInOrder(wingFill.state, wing) : 0,
    allocations: prepared.state?.allocations || {},
  };

  const guardProbe = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.teleport(655, 700, 0);
    T.setShieldInput(false);
    T.resetBoost(true);
    T.shield.reset(true);
    T.jetpack.reset(true);
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
    T.invulnerable(false);
    const ps = T.player.state;
    ps.yaw = 0;
    ps.camYaw = 0;
    const attacker = T.enemies.spawn("gleaner", ps.x, ps.z + 3, {
      id: "qa-halo-guard-attacker", health: 400,
    });
    const waves = [];
    const stopWave = T.combat.bus.on("shockwave", (event) => {
      if (["votive-parry", "stored-wrath"].includes(event?.source)) waves.push({ ...event });
    });
    const healthBefore = attacker.health;
    T.setShieldInput(true);
    T.renderOnce(1 / 120);
    const blockedDamage = T.combat.hurtPlayer(40, {
      source: "enemy-fire", enemyId: attacker.id, enemyKey: attacker.key,
      x: attacker.x, y: attacker.y + 1, z: attacker.z,
    });
    const afterBlock = T.shieldState();
    const afterBlockProgression = T.progressionState();
    const healthAfterBlock = attacker.health;
    T.setShieldInput(false);
    T.renderOnce(1 / 120);
    const release = T.shield.lastRelease();
    const healthAfterRelease = attacker.health;

    T.clearEnemies();
    T.resetBoost(true);
    const reversalTarget = T.enemies.spawn("thresher", ps.x, ps.z - 2.2, {
      id: "qa-halo-reversal-target", health: 400,
    });
    const countersBeforeBoost = {
      ...(T.progressionState()?.effects?.counters || {}),
    };
    const fuelBeforeBoost = T.jetpackState().fuel;
    const boost = T.triggerBoost(0, 1);
    const boostStarted = T.boostState();
    const fromX = ps.x;
    const fromZ = ps.z;
    const contactHits = T.boost.noteMotion(fromX, fromZ,
      fromX + boostStarted.direction[0] * 3.2,
      fromZ + boostStarted.direction[1] * 3.2, 0.1);
    const boostAfterContact = T.boostState();
    const reversal = {
      fuelBeforeBoost,
      fuelAfterBoost: T.jetpackState().fuel,
      boost,
      started: boostStarted,
      contactHits,
      afterContact: boostAfterContact,
      targetHealth: reversalTarget.health,
      targetStun: reversalTarget.stunTime || 0,
      countersBeforeBoost,
      progression: T.progressionState(),
    };
    stopWave?.();
    T.setShieldInput(false);
    T.resetBoost(true);
    T.shield.reset(true);
    T.invulnerable(true);
    T.clearEnemies();
    return {
      blockedDamage,
      healthBefore,
      healthAfterBlock,
      healthAfterRelease,
      afterBlock,
      afterBlockProgression,
      release,
      waves,
      reversal,
    };
  });
  evidence.haloGuard = guardProbe;
  check("Votive Parry answers a real perfect Aegis block",
    prepared.ok
      && guardProbe.blockedDamage === 0
      && guardProbe.afterBlock?.lastPerfect === true
      && guardProbe.afterBlock?.sessionBlocks === 1
      && guardProbe.afterBlock?.sessionAbsorbed === 40
      && guardProbe.healthAfterBlock < guardProbe.healthBefore
      && guardProbe.waves.some((wave) => wave.source === "votive-parry")
      && (guardProbe.afterBlockProgression?.effects?.counters?.perfectGuards || 0) >= 1,
    JSON.stringify(guardProbe));
  check("Stored Wrath returns one block's force once when Aegis is released",
    guardProbe.release?.dome === false
      && guardProbe.release?.blocks === 1
      && guardProbe.release?.absorbed === 40
      && guardProbe.afterBlock?.sessionAbsorbed === 40
      && guardProbe.healthAfterRelease < guardProbe.healthAfterBlock
      && guardProbe.waves.some((wave) => wave.source === "stored-wrath"),
    JSON.stringify(guardProbe));
  check("Pilgrim's Reversal makes a backward mobility boost contact without priming Ram's Halo",
    guardProbe.reversal?.boost?.triggered === true
      && guardProbe.reversal?.started?.chargeSpent === 0
      && guardProbe.reversal?.started?.modifierSource === "pilgrims-reversal"
      && guardProbe.reversal?.started?.attack === false
      && guardProbe.reversal?.started?.contactEnabled === true
      && Math.abs(Math.abs(guardProbe.reversal?.started?.yaw || 0) - Math.PI) < 0.08
      && guardProbe.reversal?.fuelAfterBoost === guardProbe.reversal?.fuelBeforeBoost
      && guardProbe.reversal?.contactHits === 1
      && guardProbe.reversal?.afterContact?.impactModified === true
      && guardProbe.reversal?.targetStun > 0
      && (guardProbe.reversal?.progression?.effects?.counters?.ramsHalos || 0)
        === (guardProbe.reversal?.countersBeforeBoost?.ramsHalos || 0),
    JSON.stringify(guardProbe.reversal));

  const reversalId = order?.talents.find((talent) =>
    talent.id === "halo_pilgrims_reversal")?.id;
  const rankOneRefund = reversalId
    ? await invoke(page, "refundTalentForQA", reversalId) : null;
  const lockedReversalProbe = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.teleport(655, 700, 0);
    T.setShieldInput(false);
    T.resetBoost(true);
    T.shield.reset(true);
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
    T.invulnerable(false);
    const ps = T.player.state;
    ps.yaw = 0;
    ps.camYaw = 0;
    T.setShieldInput(true);
    T.renderOnce(1 / 120);
    T.combat.hurtPlayer(12, {
      source: "enemy-melee", enemyId: "qa-rank-one-reversal",
      enemyKey: "thresher", x: ps.x, y: ps.y + 1, z: ps.z + 3,
    });
    T.setShieldInput(false);
    T.renderOnce(1 / 120);
    const fuelBefore = T.jetpackState().fuel;
    const boost = T.triggerBoost(1, 0);
    const status = T.boostState();
    const result = { boost, status, fuelBefore, fuelAfter: T.jetpackState().fuel };
    T.resetBoost(true);
    T.shield.reset(true);
    T.invulnerable(true);
    return result;
  });
  evidence.haloRankOneReversal = { refund: rankOneRefund, probe: lockedReversalProbe };
  check("rank-one Pilgrim's Reversal forces a charge-free backward launch before steering",
    rankOneRefund?.ok === true
      && lockedReversalProbe.boost?.triggered === true
      && lockedReversalProbe.status?.chargeSpent === 0
      && lockedReversalProbe.status?.modifierSource === "pilgrims-reversal"
      && lockedReversalProbe.status?.attack === false
      && lockedReversalProbe.status?.contactEnabled === false
      && lockedReversalProbe.status?.steerLockRemaining > 0
      && Math.abs(Math.abs(lockedReversalProbe.status?.yaw || 0) - Math.PI) < 0.08
      && lockedReversalProbe.fuelAfter === lockedReversalProbe.fuelBefore,
    JSON.stringify(evidence.haloRankOneReversal));
  if (reversalId) await invoke(page, "spendTalentForQA", reversalId);

  const mercyProbe = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.setShieldInput(false);
    T.shield.reset(true);
    T.mission.restore({
      phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
      elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
      relays: [], cooldowns: {}, pending: [],
    });
    const relay = T.mission.relays[0];
    T.player.spawn(relay.x, relay.z, 0);
    T.player.state.grounded = true;
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
    const progressBefore = relay.progress;
    const fuelBefore = T.jetpackState().fuel;
    T.setShieldInput(true);
    T.advanceTime(1, 1 / 120);
    const result = {
      progressBefore,
      progressAfter: relay.progress,
      fuelBefore,
      fuelAfter: T.jetpackState().fuel,
      shield: T.shieldState(),
      channelling: T.mission.state.channelling?.key || null,
    };
    T.setShieldInput(false);
    T.renderOnce(1 / 120);
    T.shield.reset(true);
    return result;
  });
  evidence.haloMercyCircuit = mercyProbe;
  const mercyProgress = mercyProbe.progressAfter - mercyProbe.progressBefore;
  const mercyDrain = mercyProbe.fuelBefore - mercyProbe.fuelAfter;
  const expectedMercyDrain = Number(mercyProbe.shield?.drainRate);
  check("Mercy Circuit advances a protected relay at rank-two pace without extra drain",
    mercyProbe.channelling
      && mercyProbe.shield?.active === true
      && mercyProbe.shield?.drainMultiplier === 1
      && mercyProgress > 0.085 && mercyProgress < 0.115
      && Number.isFinite(expectedMercyDrain)
      && Math.abs(mercyDrain - expectedMercyDrain) < 0.5,
    JSON.stringify({ ...mercyProbe, mercyProgress, mercyDrain, expectedMercyDrain }));

  const capstoneEquip = order?.capstone
    ? await invoke(page, "equipCapstoneForQA", order.capstone.id) : null;
  const seraphProbe = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.teleport(655, 700, 0);
    T.setShieldInput(false);
    T.shield.reset(true);
    T.jetpack.reset(true);
    T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
    T.invulnerable(false);
    const ps = T.player.state;
    ps.yaw = 0;
    ps.camYaw = 0;
    const waves = [];
    const stopWave = T.combat.bus.on("shockwave", (event) => {
      if (event?.source === "seraph-aegis") waves.push({ ...event });
    });
    T.setShieldInput(true);
    T.renderOnce(1 / 120);
    const activationDamage = T.combat.hurtPlayer(40, {
      source: "enemy-melee", enemyId: "qa-seraph-front", enemyKey: "harrow",
      x: ps.x, y: ps.y + 1, z: ps.z + 3,
    });
    T.renderOnce(1 / 120);
    const dome = T.shieldState();
    /* Spawn after formation so ordinary AI cannot wander beyond the blast
       while this probe is proving the shield response rather than pursuit. */
    const attacker = T.enemies.spawn("harrow", ps.x, ps.z - 0.3, {
      id: "qa-seraph-rear-attacker", health: 500,
    });
    T.enemies.stun(attacker, 3);
    const healthBefore = attacker.health;
    const blockedDamage = T.combat.hurtPlayer(40, {
      source: "enemy-melee", enemyId: attacker.id, enemyKey: attacker.key,
      x: attacker.x, y: attacker.y + 1, z: attacker.z,
    });
    const afterBlock = T.shieldState();
    T.setShieldInput(false);
    T.renderOnce(1 / 120);
    const release = T.shield.lastRelease();
    const result = {
      dome,
      activationDamage,
      afterBlock,
      blockedDamage,
      release,
      healthBefore,
      healthAfter: attacker.health,
      waves,
      progression: T.progressionState(),
    };
    stopWave?.();
    T.shield.reset(true);
    T.invulnerable(true);
    T.clearEnemies();
    return result;
  });
  evidence.haloSeraph = { equip: capstoneEquip, probe: seraphProbe };
  check("Seraph Aegis turns a perfect guard into a mobile all-round dome and blast",
    capstoneEquip?.ok === true
      && seraphProbe.dome?.dome === true
      && seraphProbe.dome?.mode === "dome"
      && seraphProbe.dome?.omniDirectional === true
      && seraphProbe.dome?.movementLocked === false
      && seraphProbe.dome?.moveSpeed === 3
      && seraphProbe.dome?.baseMoveSpeed === 3
      && seraphProbe.dome?.drainMultiplier === 1
      && seraphProbe.activationDamage === 0
      && seraphProbe.blockedDamage === 0
      && seraphProbe.afterBlock?.sessionAbsorbed === 80
      && seraphProbe.release?.dome === true
      && seraphProbe.release?.absorbed === 80
      && Math.abs(seraphProbe.progression?.effects?.lastDomeBlast - 100) < 0.05
      && seraphProbe.healthAfter < seraphProbe.healthBefore
      && seraphProbe.waves.some((wave) => wave.source === "seraph-aegis"),
    JSON.stringify(evidence.haloSeraph));

  await invoke(page, "resetProgressionForQA");
}

async function edictEffectsPass(page, definitions) {
  console.log("\n=== ORDER OF THE EDICT EFFECTS ===");
  const prepared = await prepareOrder(page, definitions, "edict", {
    receipt: "qa:effect:edict-rank",
  });
  const order = prepared.order;
  evidence.edictPreparation = {
    ok: prepared.ok,
    invested: order && prepared.fill ? investedInOrder(prepared.fill.state, order) : 0,
    allocations: prepared.state?.allocations || {},
  };

  /* One live offensive command covers the three cooperating Edict rites.
     Enemies consume Siren's orders in combat.update, Recall moves the same
     authoritative marker, and Live Fuse is struck through the accepted
     weapon/combat ray rather than by editing its timer. */
  const commandProbe = await page.evaluate(() => {
    const T = window.__SF;
    const freshMission = () => T.mission.restore({
      phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
      elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
      relays: [], cooldowns: {}, pending: [],
    });
    const angleDistance = (a, b) => Math.abs(((a - b + Math.PI * 3)
      % (Math.PI * 2)) - Math.PI);
    T.clearEnemies();
    freshMission();
    T.teleport(0, 0, 0);
    T.invulnerable(true);
    const ps = T.player.state;
    ps.yaw = 0;
    ps.camYaw = 0;
    ps.camPitch = 0;
    ps.grounded = true;

    const inboundEvents = [];
    const relocatedEvents = [];
    const beaconHits = [];
    const stopInbound = T.mission.bus.on("inbound", (event) => inboundEvents.push({ ...event }));
    const stopRelocated = T.mission.bus.on("relocated", (event) => relocatedEvents.push({ ...event }));
    const stopBeacon = T.mission.bus.on("beaconHit", (event) => beaconHits.push({ ...event }));
    const firstCall = T.mission.call("orbital");
    const initial = T.mission.pending()[0] || null;
    if (!initial) {
      stopInbound?.(); stopRelocated?.(); stopBeacon?.();
      return { firstCall, initial: null, inboundEvents, relocatedEvents, beaconHits };
    }

    const thresher = T.enemies.spawn("thresher", initial.x + 13, initial.z, {
      id: "qa-edict-siren-thresher", health: 500,
    });
    const gleaner = T.enemies.spawn("gleaner", initial.x - 13, initial.z, {
      id: "qa-edict-siren-gleaner", health: 500,
    });
    const harrow = T.enemies.spawn("harrow", initial.x + 14, initial.z, {
      id: "qa-edict-siren-harrow", health: 900,
    });
    const lightBefore = {
      thresher: Math.hypot(thresher.x - initial.x, thresher.z - initial.z),
      gleaner: Math.hypot(gleaner.x - initial.x, gleaner.z - initial.z),
    };
    const harrowWant = Math.atan2(initial.x - harrow.x, initial.z - harrow.z);
    const harrowFacingBefore = angleDistance(harrow.yaw, harrowWant);
    T.advanceTime(0.45, 1 / 120);
    const afterSiren = {
      thresherDistance: Math.hypot(thresher.x - initial.x, thresher.z - initial.z),
      gleanerDistance: Math.hypot(gleaner.x - initial.x, gleaner.z - initial.z),
      thresherLure: thresher.commandLure ? { ...thresher.commandLure } : null,
      gleanerLure: gleaner.commandLure ? { ...gleaner.commandLure } : null,
      harrowLure: harrow.commandLure ? { ...harrow.commandLure } : null,
      harrowFacing: angleDistance(harrow.yaw, harrowWant),
    };

    const beforeRecall = T.mission.pending()[0] || null;
    ps.camYaw = Math.PI * 0.5;
    const recallCall = T.mission.call("orbital");
    const afterRecall = T.mission.pending()[0] || null;
    T.advanceTime(0.02, 1 / 120);
    const luresAfterRecall = [thresher, gleaner, harrow].map((enemy) => ({
      id: enemy.id,
      lure: enemy.commandLure ? { ...enemy.commandLure } : null,
    }));

    const shotsBefore = T.combat.player.shots;
    let fired = 0;
    if (afterRecall) {
      for (let index = 0; index < 4; index += 1) {
        /* combat.fire is the authoritative accepted hitscan path used by
           flushShot. A fixed beam-crossing ray avoids consuming the inbound
           timer in camera/recoil settling while still exercising mission's
           real precision target and the ordinary combat shot counter. */
        T.combat.fire(
          { x: afterRecall.x, y: afterRecall.y + 12.5, z: afterRecall.z - 10 },
          { x: 0, y: 0, z: 1 },
          { damage: 0, precision: true }
        );
        fired += 1;
      }
    }
    const afterShots = T.mission.pending()[0] || null;
    const shotsAfter = T.combat.player.shots;
    const progression = T.progressionState();

    stopInbound?.(); stopRelocated?.(); stopBeacon?.();
    T.mission.restore({
      phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
      elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
      relays: [], cooldowns: {}, pending: [],
    });
    T.clearEnemies();
    return {
      firstCall,
      initial,
      lightBefore,
      harrowFacingBefore,
      afterSiren,
      beforeRecall,
      recallCall,
      afterRecall,
      luresAfterRecall,
      fired,
      shotsBefore,
      shotsAfter,
      beaconHits,
      afterShots,
      progression,
      inboundEvents,
      relocatedEvents,
    };
  });
  evidence.edictCommands = commandProbe;
  check("Siren Beacon gives a real inbound strike a 20-metre pull and heavy-facing response",
    prepared.ok
      && commandProbe.initial?.siren?.radius === 20
      && commandProbe.afterSiren?.thresherLure?.mode === "pull"
      && commandProbe.afterSiren?.gleanerLure?.mode === "pull"
      && commandProbe.afterSiren?.harrowLure?.mode === "face"
      && commandProbe.afterSiren?.thresherDistance < commandProbe.lightBefore?.thresher - 0.05
      && commandProbe.afterSiren?.gleanerDistance < commandProbe.lightBefore?.gleaner - 0.05
      && commandProbe.afterSiren?.harrowFacing < commandProbe.harrowFacingBefore,
    JSON.stringify(commandProbe));
  check("Recall Rite relocates the same inbound command once and preserves its Siren at rank two",
    commandProbe.beforeRecall?.id
      && commandProbe.recallCall === commandProbe.beforeRecall.key
      && commandProbe.afterRecall?.id === commandProbe.beforeRecall.id
      && commandProbe.afterRecall?.relocated === true
      && Math.hypot(commandProbe.afterRecall.x - commandProbe.beforeRecall.x,
        commandProbe.afterRecall.z - commandProbe.beforeRecall.z) > 20
      && Math.abs(commandProbe.afterRecall.remaining
        - commandProbe.beforeRecall.remaining - 0.75) < 0.04
      && commandProbe.afterRecall?.siren?.radius === 20
      && commandProbe.relocatedEvents?.[0]?.preserveSiren === true,
    JSON.stringify(commandProbe));
  check("Live Fuse spends four accepted precision rifle shots to remove exactly 2.8 seconds",
    commandProbe.fired === 4
      && commandProbe.beaconHits?.length === 4
      && commandProbe.beaconHits.every((hit) => hit.precision && Math.abs(hit.reduced - 0.7) < 0.001)
      && Math.abs(commandProbe.beaconHits.at(-1)?.totalReduced - 2.8) < 0.001
      && Math.abs(commandProbe.afterShots?.reducedBy - 2.8) < 0.001
      && commandProbe.shotsAfter - commandProbe.shotsBefore === 4
      && (commandProbe.progression?.effects?.counters?.precisionFuses || 0) === 4,
    JSON.stringify(commandProbe));

  const fieldProbe = await page.evaluate(() => {
    const T = window.__SF;
    T.clearEnemies();
    T.mission.restore({
      phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
      elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
      relays: [], cooldowns: {}, pending: [],
    });
    T.teleport(120, -160, 0);
    T.invulnerable(true);
    const call = T.mission.call("resupply");
    const inbound = T.mission.pending()[0] || null;
    if (inbound) T.advanceTime(inbound.remaining + 0.08, 1 / 120);
    const landed = T.mission.activeFields().sanctuaries[0] || null;
    if (!landed) return { call, inbound, landed: null };

    T.player.spawn(landed.x, landed.z, 0);
    T.player.state.grounded = true;
    T.setJetpackState({ fuel: 40, cooldownRemaining: 0, rechargeDelayRemaining: 20 });
    T.weapons.setHeat(0.6, { reason: "qa-field-chapel", clearOverheat: true });
    const cooled = [];
    const blocked = [];
    const stopCool = T.weapons.bus.on("cool", (event) => {
      if (event?.reason === "field-chapel") cooled.push({ ...event });
    });
    const stopBlock = T.combat.bus.on("projectileBlocked", (event) => blocked.push({ ...event }));
    const enemy = T.enemies.spawn("thresher", landed.x + 15, landed.z, {
      id: "qa-field-chapel-gleaner", health: 400,
    });
    const enemyDistanceBefore = Math.hypot(enemy.x - landed.x, enemy.z - landed.z);
    const heatBefore = T.weapons.heatState().heat;
    const chargeBefore = T.jetpackState().fuel;
    T.advanceTime(1, 1 / 120);
    const heatAfter = T.weapons.heatState().heat;
    const chargeAfter = T.jetpackState().fuel;
    const enemyDistanceAfter = Math.hypot(enemy.x - landed.x, enemy.z - landed.z);
    const lure = enemy.commandLure ? { ...enemy.commandLure } : null;
    /* The sanctuary draws every caste, while projectile interception is
       deliberately Gleaner-only. This second actor owns the real shot. */
    const shooter = T.enemies.spawn("gleaner", landed.x + 15, landed.z + 4, {
      id: "qa-field-chapel-shooter", health: 400,
    });
    const hpBefore = T.combat.player.hp;
    T.invulnerable(false);
    const projectileDamage = T.combat.hurtPlayer(24, {
      source: "enemy-fire", enemyId: shooter.id, enemyKey: "gleaner",
      x: shooter.x, y: shooter.y + 1, z: shooter.z,
    });
    const hpAfter = T.combat.player.hp;
    T.invulnerable(true);
    const fields = T.mission.activeFields();
    const progression = T.progressionState();
    stopCool?.(); stopBlock?.();
    T.clearEnemies();
    return {
      call, inbound, landed, fields, heatBefore, heatAfter,
      fieldCooling: cooled.reduce((sum, event) => sum + (Number(event.amount) || 0), 0),
      chargeBefore, chargeAfter, enemyDistanceBefore, enemyDistanceAfter,
      lure, projectileDamage, hpBefore, hpAfter, blocked, progression,
    };
  });
  evidence.edictFieldChapel = fieldProbe;
  check("Field Chapel creates a 14-second sanctuary that cools, recharges, lures, and blocks Gleaner fire",
    fieldProbe.inbound?.sanctuary?.duration === 14
      && fieldProbe.landed?.blocksProjectiles === true
      && fieldProbe.landed?.radius === 8
      && fieldProbe.fields?.sanctuaries?.[0]?.remaining > 12.8
      && fieldProbe.fieldCooling > 0.045 && fieldProbe.fieldCooling < 0.055
      && fieldProbe.chargeAfter - fieldProbe.chargeBefore > 2.9
      && fieldProbe.chargeAfter - fieldProbe.chargeBefore < 3.1
      && fieldProbe.lure?.mode === "pull"
      && fieldProbe.enemyDistanceAfter < fieldProbe.enemyDistanceBefore - 0.05
      && fieldProbe.projectileDamage === 0
      && fieldProbe.hpAfter === fieldProbe.hpBefore
      && fieldProbe.blocked?.some((event) => event.reason === "field-sanctuary"),
    JSON.stringify(fieldProbe));

  const fusionCases = [
    { first: "orbital", second: "cluster", id: "sunshard" },
    { first: "orbital", second: "resupply", id: "halo_bastion" },
    { first: "cluster", second: "resupply", id: "reliquary_minefield" },
  ];
  evidence.edictFusions = {};
  for (const fusionCase of fusionCases) {
    const fusionPrepared = await prepareOrder(page, definitions, "edict", {
      equipCapstone: true,
      receipt: `qa:effect:edict-fusion:${fusionCase.id}`,
    });
    const probe = await page.evaluate(({ first, second, expectedId }) => {
      const T = window.__SF;
      T.clearEnemies();
      T.mission.restore({
        phase: "relays", relaysDone: 0, extractCalled: false, extractTimer: 0,
        elapsed: 0, deaths: 0, reinforcements: 5, maxReinforcements: 5,
        relays: [], cooldowns: {}, pending: [],
      });
      T.teleport(-180, 120, 0);
      T.invulnerable(true);
      const fusions = [];
      const mines = [];
      const impacts = [];
      const stopFusion = T.mission.bus.on("fusion", (event) => fusions.push({ ...event }));
      const stopMine = T.mission.bus.on("mine", (event) => mines.push({ ...event }));
      const stopImpact = T.mission.bus.on("impact", (event) => impacts.push({ ...event }));
      const firstCall = T.mission.call(first);
      const firstPending = T.mission.pending()[0] || null;
      let target = null;
      if (expectedId === "sunshard" && firstPending) {
        target = T.enemies.spawn("harrow", firstPending.x, firstPending.z, {
          id: "qa-sunshard-target", health: 1000,
        });
      }
      if (firstPending) T.advanceTime(firstPending.remaining + 0.08, 1 / 120);
      const fieldsAfterFirst = T.mission.activeFields();
      const targetAfterFirst = target?.health ?? null;
      T.mission.cooldowns[second] = 37;
      const secondCall = T.mission.call(second);
      const secondPending = T.mission.pending()[0] || null;
      if (secondPending) T.advanceTime(secondPending.remaining + 0.08, 1 / 120);
      const fieldsAfterFusion = T.mission.activeFields();
      const targetAfterFusion = target?.health ?? null;
      let mineTarget = null;
      let mineTargetBefore = null;
      if (expectedId === "reliquary_minefield" && fieldsAfterFusion.mines[0]) {
        const mine = fieldsAfterFusion.mines[0];
        mineTarget = T.enemies.spawn("gleaner", mine.x, mine.z, {
          id: "qa-reliquary-mine-target", health: 300,
        });
        mineTargetBefore = mineTarget.health;
        T.advanceTime(0.12, 1 / 120);
      }
      const fieldsAfterResponse = T.mission.activeFields();
      const progression = T.progressionState();
      const result = {
        firstCall, firstPending, fieldsAfterFirst, secondCall, secondPending,
        fieldsAfterFusion, fieldsAfterResponse, fusions, mines, impacts,
        targetAfterFirst, targetAfterFusion,
        mineTargetBefore,
        mineTargetAfter: mineTarget?.health ?? null,
        mineTargetState: mineTarget?.state || null,
        progression,
      };
      stopFusion?.(); stopMine?.(); stopImpact?.();
      T.clearEnemies();
      return result;
    }, { ...fusionCase, expectedId: fusionCase.id });
    evidence.edictFusions[fusionCase.id] = {
      preparation: {
        ok: fusionPrepared.ok,
        equip: fusionPrepared.equip,
      },
      probe,
    };
    const fusion = probe.fusions?.find((event) => event.id === fusionCase.id);
    const common = fusionPrepared.ok
      && fusionPrepared.equip?.ok === true
      && probe.fieldsAfterFirst?.sigils?.some((sigil) => sigil.commandKey === fusionCase.first)
      && !!fusion
      && probe.impacts?.some((impact) => impact.fusionId === fusionCase.id)
      && probe.progression?.effects?.lastFusion?.id === fusionCase.id
      && probe.progression?.effects?.fusionCooldown > 17
      && Math.abs((fusion.outcome?.cooldownRefundFraction || 0) - 0.35) < 0.001
      && Object.keys(fusion.outcome?.cooldownsBefore || {}).every((key) =>
        Math.abs(fusion.outcome.cooldownsAfter[key]
          - fusion.outcome.cooldownsBefore[key] * 0.65) < 0.05)
      && (probe.progression?.effects?.counters?.combinedLiturgies || 0) === 1
      && (probe.progression?.effects?.counters?.fusionsResolved || 0) === 1;
    if (fusionCase.id === "sunshard") {
      check("Combined Liturgy resolves Orbital plus Cluster into a damaging Sunshard",
        common
          && fusion.outcome?.targetId === "qa-sunshard-target"
          && fusion.outcome?.damage > 500
          && probe.targetAfterFusion < probe.targetAfterFirst,
        JSON.stringify(evidence.edictFusions[fusionCase.id]));
    } else if (fusionCase.id === "halo_bastion") {
      const bastion = probe.fieldsAfterFusion?.sanctuaries?.find(
        (field) => field.fusionId === "halo_bastion");
      check("Combined Liturgy resolves Orbital plus Resupply into a projectile-blocking Halo Bastion",
        common && !!bastion && bastion.blocksProjectiles === true
          && bastion.radius === 11
          && bastion.heatPerSecond === 0.08
          && bastion.chargePerSecond === 5
          && fusion.outcome?.fieldId === bastion.id,
        JSON.stringify(evidence.edictFusions[fusionCase.id]));
    } else {
      check("Combined Liturgy resolves Cluster plus Resupply into nine live Reliquary mines",
        common
          && probe.fieldsAfterFusion?.mines?.length === 9
          && fusion.outcome?.count === 9
          && probe.mines?.some((event) => event.triggered
            && event.targetId === "qa-reliquary-mine-target")
          && probe.fieldsAfterResponse?.mines?.length === 8
          && probe.mineTargetAfter < probe.mineTargetBefore,
        JSON.stringify(evidence.edictFusions[fusionCase.id]));
    }
  }

  await invoke(page, "resetProgressionForQA");
}

async function careerValidationPass(page, definitions) {
  console.log("\n=== CAREER VALIDATION BOUNDARY ===");
  await invoke(page, "resetProgressionForQA");
  const overTierTalent = definitions.orders
    .flatMap((order) => order.talents)
    .filter((talent) => talent.requiredPoints > 0)
    .sort((a, b) => b.requiredPoints - a.requiredPoints)[0];
  const starterTalent = definitions.orders
    .flatMap((order) => order.talents)
    .find((talent) => talent.implemented !== false && talent.requiredPoints === 0);
  const probe = await page.evaluate(({ overTierId, starterId, maxXp }) => {
    const T = window.__SF;
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const baseline = T.progressionCareerForQA();
    const beforeCareer = JSON.stringify(baseline);
    const beforeState = JSON.stringify(T.progressionState());
    const invalid = {};

    invalid.wrongSchema = clone(baseline);
    invalid.wrongSchema.schema += 1;
    invalid.missingSchema = clone(baseline);
    delete invalid.missingSchema.schema;

    invalid.stringRank = clone(baseline);
    invalid.stringRank.totalXp = maxXp;
    invalid.stringRank.allocations = { [starterId]: "1" };

    invalid.missingReceiptsLedger = clone(baseline);
    delete invalid.missingReceiptsLedger.receipts;
    invalid.missingLifetimeLedger = clone(baseline);
    delete invalid.missingLifetimeLedger.lifetime;

    invalid.overTierAllocation = clone(baseline);
    invalid.overTierAllocation.totalXp = maxXp;
    invalid.overTierAllocation.allocations = { [overTierId]: 1 };

    invalid.overlongReceipt = clone(baseline);
    invalid.overlongReceipt.receipts = ["x".repeat(1000)];
    invalid.duplicateReceipts = clone(baseline);
    invalid.duplicateReceipts.receipts = ["qa:duplicate", "qa:duplicate"];
    invalid.receiptLedgerOverflow = clone(baseline);
    invalid.receiptLedgerOverflow.receipts = Array.from({ length: 20000 },
      (_, index) => `qa:receipt:${index}`);

    invalid.tooManyCapstones = clone(baseline);
    invalid.tooManyCapstones.activeCapstones = [null, null, null];

    const validAccepted = T.validateProgressionCareerForQA(clone(baseline));
    const rejected = Object.fromEntries(Object.entries(invalid)
      .map(([name, candidate]) => [name,
        T.validateProgressionCareerForQA(candidate) === false]));
    return {
      validAccepted: !!validAccepted && validAccepted.schema === baseline.schema,
      rejected,
      careerUnchanged: JSON.stringify(T.progressionCareerForQA()) === beforeCareer,
      stateUnchanged: JSON.stringify(T.progressionState()) === beforeState,
      caseCount: Object.keys(invalid).length,
    };
  }, {
    overTierId: overTierTalent?.id || "",
    starterId: starterTalent?.id || "",
    maxXp: definitions.thresholds.at(-1),
  });
  evidence.careerValidation = {
    overTierTalent: overTierTalent?.id || null,
    starterTalent: starterTalent?.id || null,
    ...probe,
  };
  check("production career validation accepts a valid QA career baseline",
    probe.validAccepted === true,
    JSON.stringify(evidence.careerValidation));
  check("malformed career schemas, ranks, ledgers, tiers, receipts, and Vows fail closed",
    probe.caseCount === 10
      && Object.values(probe.rejected).every(Boolean),
    JSON.stringify(evidence.careerValidation));
  check("career validation never mutates live progression state",
    probe.careerUnchanged && probe.stateUnchanged,
    JSON.stringify(evidence.careerValidation));
  await invoke(page, "resetProgressionForQA");
}

async function desktopUiPass(page, definitions) {
  console.log("\n=== DESKTOP DOCTRINE MENU ===");
  await invoke(page, "resetProgressionForQA");
  await grantToRank(page, definitions, 2, "qa:desktop-ui-point");
  const escapedIntoMenu = await openMenuWithEscape(page);
  check("Escape opens the native field menu", escapedIntoMenu);
  const doctrineNav = page.locator('[data-menu-panel="doctrine"]');
  await doctrineNav.click();
  await page.waitForFunction(() => window.__SF?.menuState?.()?.panel === "doctrine",
    null, { timeout: 3000 });
  const structure = await page.evaluate(() => {
    const menu = document.getElementById("sf-menu");
    const progress = menu?.querySelector('[data-doctrine-xp][role="progressbar"]');
    const tabs = [...(menu?.querySelectorAll('button[role="tab"][data-doctrine-order]') || [])];
    const panels = [...(menu?.querySelectorAll('[role="tabpanel"][data-doctrine-order-panel]') || [])];
    return {
      panelVisible: !!menu?.querySelector('[data-menu-page="doctrine"]:not([hidden])'),
      navCount: menu?.querySelectorAll("[data-menu-panel]").length || 0,
      tabs: tabs.length,
      panels: panels.length,
      selectedTabs: tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").length,
      visiblePanels: panels.filter((panel) => !panel.hidden).length,
      talentCards: menu?.querySelectorAll("[data-doctrine-talent][data-talent-id]").length || 0,
      spendActions: menu?.querySelectorAll('[data-doctrine-action="spend"][data-talent-id]').length || 0,
      vowActions: menu?.querySelectorAll('button[data-doctrine-action="vow"][data-capstone-id]').length || 0,
      resetActions: menu?.querySelectorAll('[data-doctrine-action="respec"]').length || 0,
      rankText: menu?.querySelector("[data-doctrine-rank]")?.textContent?.trim() || "",
      pointsText: menu?.querySelector("[data-doctrine-points]")?.textContent?.trim() || "",
      progressAria: progress ? {
        now: progress.getAttribute("aria-valuenow"),
        min: progress.getAttribute("aria-valuemin"),
        max: progress.getAttribute("aria-valuemax"),
      } : null,
      paused: document.body.classList.contains("rb-escape-menu-open"),
      focusInside: !!menu?.contains(document.activeElement),
      touchInert: !!document.getElementById("sf-touch")?.inert,
      permanentHudNodes: document.querySelectorAll("#sf-hud [data-doctrine-rank],"
        + "#sf-hud [data-doctrine-points],#sf-hud [data-doctrine-xp]").length,
    };
  });
  evidence.desktopUi = structure;
  check("Escape exposes one focus-owned Doctrine page without adding permanent HUD",
    structure.panelVisible && structure.navCount === 6
      && structure.paused && structure.focusInside && structure.touchInert
      && structure.permanentHudNodes === 0,
    JSON.stringify(structure));
  check("Doctrine renders five accessible Order tabs and definition-driven actions",
    structure.tabs === 5 && structure.panels === 1
      && structure.selectedTabs === 1 && structure.visiblePanels === 1
      && structure.talentCards >= 4 && structure.spendActions >= 4
      && structure.vowActions === 1 && structure.resetActions === 1
      && structure.progressAria?.now !== null
      && Number(structure.progressAria?.max) > Number(structure.progressAria?.min),
    JSON.stringify(structure));

  const tabs = page.locator('button[role="tab"][data-doctrine-order]');
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => {
    const focused = document.activeElement?.dataset?.doctrineOrder;
    const selected = document.querySelector(
      'button[role="tab"][data-doctrine-order][aria-selected="true"]')
      ?.dataset?.doctrineOrder;
    const visible = document.querySelector(
      '[role="tabpanel"][data-doctrine-order-panel]:not([hidden])')
      ?.dataset?.orderId;
    return !!focused && focused === selected && selected === visible;
  }, null, { timeout: 3000 });
  const arrowSelection = await page.evaluate(() => ({
    focused: document.activeElement?.dataset?.doctrineOrder || null,
    selected: document.querySelector('button[role="tab"][data-doctrine-order][aria-selected="true"]')
      ?.dataset?.doctrineOrder || null,
    visible: document.querySelector('[role="tabpanel"][data-doctrine-order-panel]:not([hidden])')
      ?.dataset?.orderId || null,
  }));
  check("Arrow navigation switches the selected Order tab and tabpanel together",
    !!arrowSelection.focused && arrowSelection.focused === arrowSelection.selected
      && arrowSelection.selected === arrowSelection.visible,
    JSON.stringify(arrowSelection));

  await page.keyboard.press("End");
  await page.waitForFunction(() => {
    const tabs = [...document.querySelectorAll(
      'button[role="tab"][data-doctrine-order]')];
    const selected = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
    return !!selected && selected === tabs.at(-1) && document.activeElement === selected;
  }, null, { timeout: 3000 });
  const endSelection = await page.evaluate(() => ({
    selected: document.querySelector('button[role="tab"][data-doctrine-order][aria-selected="true"]')
      ?.dataset?.doctrineOrder || null,
    last: [...document.querySelectorAll('button[role="tab"][data-doctrine-order]')].at(-1)
      ?.dataset?.doctrineOrder || null,
  }));
  await page.keyboard.press("Home");
  await page.waitForFunction(() => {
    const tabs = [...document.querySelectorAll(
      'button[role="tab"][data-doctrine-order]')];
    const selected = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
    return !!selected && selected === tabs[0] && document.activeElement === selected;
  }, null, { timeout: 3000 });
  const homeSelection = await page.evaluate(() => ({
    selected: document.querySelector('button[role="tab"][data-doctrine-order][aria-selected="true"]')
      ?.dataset?.doctrineOrder || null,
    first: document.querySelector('button[role="tab"][data-doctrine-order]')
      ?.dataset?.doctrineOrder || null,
  }));
  check("Home and End move directly between the first and final Orders",
    endSelection.selected === endSelection.last
      && homeSelection.selected === homeSelection.first,
    JSON.stringify({ endSelection, homeSelection }));

  const spend = page.locator(
    '[data-doctrine-preview] button[data-doctrine-action="spend"][data-talent-id]:not([disabled])'
  ).first();
  await spend.waitFor({ state: "visible", timeout: 3000 });
  const spendId = await spend.getAttribute("data-talent-id");
  const beforeSpend = await state(page, definitions);
  await spend.click();
  await page.waitForFunction(({ talentId, beforeRank }) =>
    (window.__SF?.progressionState?.()?.allocations?.[talentId] || 0) === beforeRank + 1,
  { talentId: spendId, beforeRank: allocationRank(beforeSpend, spendId) }, { timeout: 3000 });
  const afterSpend = await state(page, definitions);
  check("a real desktop Doctrine button spends one available point",
    !!spendId && allocationRank(afterSpend, spendId) === allocationRank(beforeSpend, spendId) + 1
      && afterSpend.points.free === beforeSpend.points.free - 1,
    JSON.stringify({ spendId, before: beforeSpend, after: afterSpend }));

  const respec = page.locator('button[data-doctrine-action="respec"]');
  await respec.click();
  await page.waitForFunction(() => document.querySelector(
    'button[data-doctrine-action="respec"]')?.textContent?.includes("CONFIRM"),
  null, { timeout: 3000 });
  const afterFirstReset = await state(page, definitions);
  const confirmText = (await respec.textContent())?.trim() || "";
  await respec.click();
  await page.waitForFunction(() =>
    Number(window.__SF?.progressionState?.()?.pointsSpent) === 0,
  null, { timeout: 3000 });
  const afterConfirmedReset = await state(page, definitions);
  check("reset requires a second confirming click before changing the build",
    allocationRank(afterFirstReset, spendId) === allocationRank(afterSpend, spendId)
      && confirmText.includes("CONFIRM")
      && allocationRank(afterConfirmedReset, spendId) === 0
      && afterConfirmedReset.points.spent === 0,
    JSON.stringify({ confirmText, afterFirstReset, afterConfirmedReset }));
  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "desktop-doctrine.png") });
  await page.locator("[data-menu-close]").first().click();
  await page.waitForFunction(() => !window.__SF?.menuState?.()?.open, null, { timeout: 3000 });
}

async function mobileUiPass(browser) {
  console.log("\n=== MOBILE DOCTRINE MENU 390x844 ===");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await bootPage(context, "mobile-390x844");
  const definitions = normalizeDefinitions(await rawDefinitions(page));
  await invoke(page, "resetProgressionForQA");
  await grantToRank(page, definitions, 2, "qa:mobile-ui-point");
  const trigger = page.locator(".sf-menu-trigger--mobile");
  await page.waitForFunction(() => {
    const button = document.querySelector(".sf-menu-trigger--mobile");
    return button && getComputedStyle(button).display !== "none"
      && button.getBoundingClientRect().width >= 44;
  }, null, { timeout: 5000 });
  await trigger.tap();
  await page.waitForFunction(() => window.__SF?.menuState?.()?.open, null, { timeout: 3000 });
  await page.locator('[data-menu-panel="doctrine"]').tap();
  await page.waitForFunction(() => window.__SF?.menuState?.()?.panel === "doctrine",
    null, { timeout: 3000 });
  const layout = await page.evaluate(() => {
    const stage = document.querySelector(".sf-stage")?.getBoundingClientRect();
    const menu = document.getElementById("sf-menu");
    const pageEl = menu?.querySelector('[data-menu-page="doctrine"]');
    const visibleButtons = [...(menu?.querySelectorAll(
      '[data-menu-panel],button[role="tab"][data-doctrine-order],'
      + 'button[data-doctrine-action="spend"],button[data-doctrine-action="vow"],'
      + 'button[data-doctrine-action="respec"]'
    ) || [])].filter((button) => {
      const style = getComputedStyle(button);
      const box = button.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden"
        && Number(style.opacity) > 0 && box.width > 1 && box.height > 1;
    });
    const undersized = visibleButtons.map((button) => {
      const box = button.getBoundingClientRect();
      return { label: button.dataset.menuPanel || button.dataset.doctrineOrder
        || button.dataset.talentId || button.dataset.orderId || button.dataset.doctrineAction,
      width: Number(box.width.toFixed(1)), height: Number(box.height.toFixed(1)) };
    }).filter((entry) => entry.width < 43.5 || entry.height < 43.5);
    const navButtons = [...(menu?.querySelectorAll("[data-menu-panel]") || [])]
      .filter((button) => getComputedStyle(button).display !== "none");
    return {
      stage: stage ? [stage.width, stage.height] : null,
      navCount: navButtons.length,
      orderTabs: menu?.querySelectorAll('button[role="tab"][data-doctrine-order]').length || 0,
      undersized,
      horizontalOverflow: pageEl ? Math.max(0, pageEl.scrollWidth - pageEl.clientWidth) : Infinity,
      contentOverflow: menu ? Math.max(0,
        menu.querySelector(".sf-menu__content").scrollWidth
          - menu.querySelector(".sf-menu__content").clientWidth) : Infinity,
      paused: document.body.classList.contains("rb-escape-menu-open"),
      touchInert: !!document.getElementById("sf-touch")?.inert,
      focusInside: !!menu?.contains(document.activeElement),
    };
  });
  evidence.mobileUi = layout;
  check("portrait mobile exposes all six menu destinations and five Order tabs",
    layout.navCount === 6 && layout.orderTabs === 5,
    JSON.stringify(layout));
  check("portrait Doctrine remains focus-owned, paused, touch-safe, and overflow-free",
    layout.paused && layout.touchInert && layout.focusInside
      && layout.undersized.length === 0
      && layout.horizontalOverflow <= 2 && layout.contentOverflow <= 2,
    JSON.stringify(layout));

  const spend = page.locator('button[data-doctrine-action="spend"][data-talent-id]:not([disabled])').first();
  const spendId = await spend.getAttribute("data-talent-id");
  const beforeSpend = await state(page, definitions);
  await spend.tap();
  await page.waitForFunction(({ talentId, beforeRank }) =>
    (window.__SF?.progressionState?.()?.allocations?.[talentId] || 0) === beforeRank + 1,
  { talentId: spendId, beforeRank: allocationRank(beforeSpend, spendId) }, { timeout: 3000 });
  const afterSpend = await state(page, definitions);
  check("a real mobile Doctrine tap spends one point without leaking into gameplay",
    !!spendId && allocationRank(afterSpend, spendId) === allocationRank(beforeSpend, spendId) + 1
      && afterSpend.points.free === beforeSpend.points.free - 1
      && (await page.evaluate(() => window.__SF?.menuState?.()?.open
        && document.getElementById("sf-touch")?.inert)),
    JSON.stringify({ spendId, before: beforeSpend, after: afterSpend }));
  await page.locator(".sf-stage").screenshot({ path: path.join(OUT, "mobile-doctrine-390x844.png") });
  await page.locator("[data-menu-close]").first().tap();
  await page.waitForFunction(() => !window.__SF?.menuState?.()?.open, null, { timeout: 3000 });
  const closed = await page.evaluate(() => ({
    paused: document.body.classList.contains("rb-escape-menu-open"),
    touchInert: !!document.getElementById("sf-touch")?.inert,
  }));
  check("closing Doctrine restores mobile simulation and touch ownership",
    !closed.paused && !closed.touchInert, JSON.stringify(closed));
  await context.close();
}

async function landscapeUiPass(browser) {
  console.log("\n=== MOBILE DOCTRINE MENU 844x390 ===");
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await bootPage(context, "mobile-844x390");
  const definitions = normalizeDefinitions(await rawDefinitions(page));
  await invoke(page, "resetProgressionForQA");
  await grantToRank(page, definitions, 2, "qa:landscape-ui-point");

  const trigger = page.locator(".sf-menu-trigger--mobile");
  await page.waitForFunction(() => {
    const button = document.querySelector(".sf-menu-trigger--mobile");
    const box = button?.getBoundingClientRect();
    return !!box && getComputedStyle(button).display !== "none"
      && box.width >= 44 && box.height >= 44;
  }, null, { timeout: 5000 });
  await trigger.tap();
  await page.waitForFunction(() => window.__SF?.menuState?.()?.open,
    null, { timeout: 3000 });
  await page.locator('[data-menu-panel="doctrine"]').tap();
  await page.waitForFunction(() => window.__SF?.menuState?.()?.panel === "doctrine",
    null, { timeout: 3000 });

  const reachedOrders = [];
  for (const order of definitions.orders) {
    const tab = page.locator(
      `button[role="tab"][data-doctrine-order="${order.id}"]`);
    await tab.scrollIntoViewIfNeeded();
    await tab.tap();
    await page.waitForFunction((orderId) => {
      const selected = document.querySelector(
        'button[role="tab"][data-doctrine-order][aria-selected="true"]');
      const panel = document.querySelector("[data-doctrine-order-panel]");
      return selected?.dataset?.doctrineOrder === orderId
        && panel?.dataset?.orderId === orderId;
    }, order.id, { timeout: 3000 });
    reachedOrders.push(await tab.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const rail = node.closest("[data-doctrine-orders]")?.getBoundingClientRect();
      const stage = document.querySelector(".sf-stage")?.getBoundingClientRect();
      const within = (inner, outer) => !!outer
        && inner.left >= outer.left - 1 && inner.top >= outer.top - 1
        && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;
      return {
        id: node.dataset.doctrineOrder,
        label: node.textContent.replace(/\s+/g, " ").trim(),
        selected: node.getAttribute("aria-selected") === "true",
        width: Number(box.width.toFixed(1)),
        height: Number(box.height.toFixed(1)),
        withinRail: within(box, rail),
        withinStage: within(box, stage),
      };
    }));
  }

  const edict = reachedOrders.find((entry) => entry.label.toUpperCase().includes("EDICT"));
  const vow = page.locator('button[data-doctrine-action="vow"]').first();
  await vow.scrollIntoViewIfNeeded();
  const orderPanel = page.locator("[data-doctrine-order-panel]");
  await orderPanel.evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: "instant" }));
  await page.waitForFunction(() => {
    const node = document.querySelector("[data-doctrine-order-panel]");
    return !!node && node.scrollTop + node.clientHeight >= node.scrollHeight - 2;
  }, null, { timeout: 3000 });

  const layout = await page.evaluate(() => {
    const rect = (node) => {
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom,
        width: box.width, height: box.height };
    };
    const within = (inner, outer, tolerance = 2) => !!inner && !!outer
      && inner.left >= outer.left - tolerance && inner.top >= outer.top - tolerance
      && inner.right <= outer.right + tolerance && inner.bottom <= outer.bottom + tolerance;
    const overlap = (a, b) => !a || !b ? 0
      : Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const visible = (node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden"
        && Number(style.opacity) > 0 && box.width > 1 && box.height > 1;
    };

    const stage = document.querySelector(".sf-stage");
    const frame = document.querySelector(".sf-menu__frame");
    const content = document.querySelector(".sf-menu__content");
    const pageEl = document.querySelector('[data-menu-page="doctrine"]');
    const orderRail = document.querySelector("[data-doctrine-orders]");
    const order = document.querySelector("[data-doctrine-order-panel]");
    const doctrineFooter = document.querySelector(".sf-doctrine__footer");
    const menuFooter = document.querySelector(".sf-menu__footer");
    const reset = document.querySelector('[data-doctrine-action="respec"]');
    const vowAction = document.querySelector('[data-doctrine-action="vow"]');
    const boxes = {
      stage: rect(stage), frame: rect(frame), content: rect(content), page: rect(pageEl),
      orderRail: rect(orderRail), order: rect(order), doctrineFooter: rect(doctrineFooter),
      menuFooter: rect(menuFooter), reset: rect(reset), vowAction: rect(vowAction),
    };
    const targetNodes = [...document.querySelectorAll(
      "#sf-menu [data-menu-panel],#sf-menu button[role='tab'][data-doctrine-order],"
      + "#sf-menu button[data-doctrine-action]"
    )].filter(visible);
    const undersized = targetNodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { label: node.dataset.menuPanel || node.dataset.doctrineOrder
        || node.dataset.doctrineAction || node.textContent.trim(),
      width: Number(box.width.toFixed(1)), height: Number(box.height.toFixed(1)) };
    }).filter((entry) => entry.width < 43.5 || entry.height < 43.5);
    const containers = {
      frame: boxes.stage,
      content: boxes.frame,
      page: boxes.content,
      orderRail: boxes.page,
      order: boxes.page,
      doctrineFooter: boxes.page,
    };
    const clipped = Object.keys(containers)
      .filter((key) => !within(boxes[key], containers[key]));
    return {
      stage: boxes.stage ? [boxes.stage.width, boxes.stage.height] : null,
      undersized,
      clipped,
      pageHorizontalOverflow: pageEl ? Math.max(0, pageEl.scrollWidth - pageEl.clientWidth) : Infinity,
      contentHorizontalOverflow: content ? Math.max(0, content.scrollWidth - content.clientWidth) : Infinity,
      orderHorizontalOverflow: order ? Math.max(0, order.scrollWidth - order.clientWidth) : Infinity,
      orderScrollable: !!order && order.scrollHeight > order.clientHeight + 1,
      orderAtBottom: !!order && order.scrollTop + order.clientHeight >= order.scrollHeight - 2,
      vowReachable: within(boxes.vowAction, boxes.order, 1),
      resetReachable: within(boxes.reset, boxes.doctrineFooter, 1),
      orderFooterOverlap: overlap(boxes.order, boxes.doctrineFooter),
      globalFooterOverlap: visible(menuFooter) ? overlap(boxes.doctrineFooter, boxes.menuFooter) : 0,
      selected: document.querySelector(
        'button[role="tab"][data-doctrine-order][aria-selected="true"]')
        ?.dataset?.doctrineOrder || null,
      paused: document.body.classList.contains("rb-escape-menu-open"),
      touchInert: !!document.getElementById("sf-touch")?.inert,
      focusInside: !!document.getElementById("sf-menu")?.contains(document.activeElement),
    };
  });
  evidence.landscapeUi = { reachedOrders, edict, layout };
  check("short-landscape touch reaches and selects all five Orders including EDICT",
    reachedOrders.length === 5
      && new Set(reachedOrders.map((entry) => entry.id)).size === 5
      && reachedOrders.every((entry) => entry.selected && entry.withinRail
        && entry.withinStage && entry.width >= 43.5 && entry.height >= 43.5)
      && !!edict?.selected,
    JSON.stringify({ reachedOrders, edict }));
  check("short-landscape Doctrine exposes its Vow and compact reset action",
    layout.vowReachable && layout.resetReachable
      && layout.orderFooterOverlap === 0 && layout.globalFooterOverlap === 0,
    JSON.stringify(layout));
  check("844x390 Doctrine has no clipping, overflow, or undersized touch targets",
    layout.clipped.length === 0 && layout.undersized.length === 0
      && layout.pageHorizontalOverflow <= 2
      && layout.contentHorizontalOverflow <= 2
      && layout.orderHorizontalOverflow <= 2
      && layout.paused && layout.touchInert && layout.focusInside,
    JSON.stringify(layout));
  await page.locator(".sf-stage").screenshot({
    path: path.join(OUT, "mobile-doctrine-844x390.png"),
  });
  await page.locator("[data-menu-close]").first().tap();
  await page.waitForFunction(() => !window.__SF?.menuState?.()?.open,
    null, { timeout: 3000 });
  await context.close();
}

async function makeCareerConflictBranches(page, definitions) {
  await invoke(page, "resetProgressionForQA");
  await grantToRank(page, definitions, 12, "qa:career-conflict:local-rank");
  const halo = definitions.orders.find((order) => order.id === "halo");
  if (halo) await fillOrder(page, definitions, halo, 6);
  const local = await invoke(page, "progressionCareerForQA");

  await invoke(page, "resetProgressionForQA");
  await grantToRank(page, definitions, 22, "qa:career-conflict:synced-rank");
  const edict = definitions.orders.find((order) => order.id === "edict");
  if (edict) await fillOrder(page, definitions, edict, definitions.maxPointsPerOrder);
  const synced = await invoke(page, "progressionCareerForQA");
  await invoke(page, "resetProgressionForQA");
  return { local, synced };
}

async function careerRecoveryDesktopPass(browser, choice) {
  console.log(`\n=== DESKTOP CAREER RECOVERY · ${choice.toUpperCase()} ===`);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await bootPage(context, `career-${choice}-desktop`);
  const definitions = normalizeDefinitions(await rawDefinitions(page));
  const branches = await makeCareerConflictBranches(page, definitions);
  const expected = branches[choice];
  const saveBefore = await page.evaluate(() => window.__SF.persistenceState());
  const storageBefore = await page.evaluate(() => localStorage.getItem("saintfall:career-conflict:v1"));
  const staged = await invoke(page, "stageCareerConflictForQA",
    branches.local, branches.synced, `qa-ui-${choice}`);
  const conflictBeforeMenu = await invoke(page, "careerConflictStateForQA");
  const escapedIntoMenu = await openMenuWithEscape(page);
  const savesNav = page.locator('[data-menu-panel="saves"]');
  const navBefore = await savesNav.evaluate((button) => {
    const badge = button.querySelector("[data-career-recovery-nav]");
    const box = button.getBoundingClientRect();
    return {
      badgeVisible: !!badge && !badge.hidden && getComputedStyle(badge).display !== "none",
      label: button.getAttribute("aria-label") || "",
      width: box.width,
      height: box.height,
    };
  });
  await savesNav.click();
  await page.waitForFunction(() => window.__SF?.menuState?.()?.panel === "saves"
    && window.__SF?.menuState?.()?.careerRecovery?.state === "conflict",
  null, { timeout: 3000 });
  const action = page.locator(
    `[data-career-recovery-action][data-career-choice="${choice}"]`);
  const initialUi = await page.evaluate(() => {
    const panel = document.querySelector("[data-career-recovery]");
    const status = panel?.querySelector("[data-career-recovery-status]");
    return {
      panelVisible: !!panel && !panel.hidden,
      panelState: panel?.dataset.state || null,
      busy: panel?.getAttribute("aria-busy") || null,
      statusRole: status?.getAttribute("role") || null,
      statusLive: status?.getAttribute("aria-live") || null,
      localCard: panel?.querySelector('[data-career-branch-card="local"]')?.dataset.state || null,
      syncedCard: panel?.querySelector('[data-career-branch-card="synced"]')?.dataset.state || null,
    };
  });
  const careerBeforeFirstClick = await invoke(page, "progressionCareerForQA");
  await action.click();
  await page.waitForFunction((wanted) =>
    window.__SF?.menuState?.()?.careerRecovery?.armedChoice === wanted,
  choice, { timeout: 3000 });
  const armed = await page.evaluate((wanted) => {
    const button = document.querySelector(
      `[data-career-recovery-action][data-career-choice="${wanted}"]`);
    const box = button?.getBoundingClientRect();
    return {
      menu: window.__SF.menuState().careerRecovery,
      text: button?.textContent?.trim() || "",
      pressed: button?.getAttribute("aria-pressed") || null,
      cardState: button?.closest("[data-career-branch-card]")?.dataset.state || null,
      target: box ? [box.width, box.height] : null,
      conflict: window.__SF.careerConflictStateForQA(),
      career: window.__SF.progressionCareerForQA(),
    };
  }, choice);
  await action.click();
  await page.waitForFunction(() => {
    const state = window.__SF?.menuState?.()?.careerRecovery;
    return state?.state === "resolved" && state?.active === false;
  }, null, { timeout: 3000 });
  await page.waitForFunction(() => document.activeElement
    === document.querySelector("[data-career-recovery]"), null, { timeout: 3000 });
  const resolved = await page.evaluate(() => ({
    career: window.__SF.progressionCareerForQA(),
    conflict: window.__SF.careerConflictStateForQA(),
    save: window.__SF.persistenceState(),
    menu: window.__SF.menuState().careerRecovery,
    storage: localStorage.getItem("saintfall:career-conflict:v1"),
    focusedPanel: document.activeElement === document.querySelector("[data-career-recovery]"),
    branchesHidden: getComputedStyle(
      document.querySelector("[data-career-recovery-branches]")).display === "none",
  }));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const proof = {
    choice, staged, conflictBeforeMenu, escapedIntoMenu, navBefore,
    initialUi, careerBeforeFirstClick, armed, expected, saveBefore,
    storageBefore, resolved,
  };
  evidence[`careerRecoveryDesktop_${choice}`] = proof;
  check(`desktop recovery keeps the exact ${choice === "local" ? "device" : "synced"} career only after two real clicks`,
    staged?.ok === true && conflictBeforeMenu?.active === true
      && escapedIntoMenu && navBefore.badgeVisible
      && navBefore.label.toLowerCase().includes("review required")
      && initialUi.panelVisible && initialUi.panelState === "conflict"
      && initialUi.busy === "false" && initialUi.statusRole === "status"
      && initialUi.statusLive === "polite"
      && armed.menu?.armedChoice === choice
      && armed.text.startsWith("CONFIRM") && armed.pressed === "true"
      && armed.cardState === "armed"
      && armed.target?.[1] >= 43.5
      && armed.conflict?.active === true
      && same(armed.career, careerBeforeFirstClick)
      && resolved.conflict?.active === false
      && resolved.save?.careerQuarantined === false
      && same(resolved.career, expected)
      && same(resolved.save?.autosave, saveBefore?.autosave)
      && same(resolved.save?.manuals, saveBefore?.manuals)
      && resolved.storage === storageBefore
      && resolved.menu?.state === "resolved"
      && resolved.focusedPanel && resolved.branchesHidden,
    JSON.stringify(proof));
  await page.locator(".sf-stage").screenshot({
    path: path.join(OUT, `desktop-career-recovery-${choice}.png`),
  });
  await context.close();
}

async function careerRecoveryMobilePass(browser) {
  console.log("\n=== MOBILE CAREER RECOVERY · INVALID SYNCED ===");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await bootPage(context, "career-mobile-390x844");
  const definitions = normalizeDefinitions(await rawDefinitions(page));
  const branches = await makeCareerConflictBranches(page, definitions);
  const invalidSynced = { schema: -1, totalXp: 999999, allocations: {} };
  const saveBefore = await page.evaluate(() => window.__SF.persistenceState());
  const staged = await invoke(page, "stageCareerConflictForQA",
    branches.local, invalidSynced, "qa-ui-mobile-invalid-synced");

  const trigger = page.locator(".sf-menu-trigger--mobile");
  /* A conflict stages through save.onChange and the production UI may open
     Saves automatically. Only use the mobile menu control when it did not. */
  const autoOpened = await page.evaluate(() => !!window.__SF?.menuState?.()?.open);
  if (!autoOpened) {
    await page.waitForFunction(() => {
      const button = document.querySelector(".sf-menu-trigger--mobile");
      return button && getComputedStyle(button).display !== "none"
        && button.getBoundingClientRect().width >= 44;
    }, null, { timeout: 5000 });
    await trigger.tap();
  }
  await page.waitForFunction(() => window.__SF?.menuState?.()?.open,
    null, { timeout: 3000 });
  const savesNav = page.locator('[data-menu-panel="saves"]');
  const navBadge = await savesNav.locator("[data-career-recovery-nav]").evaluate(
    (badge) => !badge.hidden && getComputedStyle(badge).display !== "none");
  if (await page.evaluate(() => window.__SF?.menuState?.()?.panel !== "saves")) {
    await savesNav.tap();
  }
  await page.waitForFunction(() => window.__SF?.menuState?.()?.panel === "saves",
    null, { timeout: 3000 });
  const layout = await page.evaluate(() => {
    const panel = document.querySelector("[data-career-recovery]");
    const content = document.querySelector(".sf-menu__content");
    const entries = ["local", "synced"].map((choice) => {
      const button = panel.querySelector(
        `[data-career-recovery-action][data-career-choice="${choice}"]`);
      const card = button.closest("[data-career-branch-card]");
      const box = button.getBoundingClientRect();
      return {
        choice,
        disabled: button.disabled,
        cardState: card.dataset.state,
        width: box.width,
        height: box.height,
      };
    });
    return {
      visible: !panel.hidden,
      state: panel.dataset.state,
      horizontalOverflow: Math.max(0, content.scrollWidth - content.clientWidth),
      entries,
      status: panel.querySelector("[data-career-recovery-status]").textContent.trim(),
    };
  });
  const localAction = page.locator(
    '[data-career-recovery-action][data-career-choice="local"]');
  const syncedAction = page.locator(
    '[data-career-recovery-action][data-career-choice="synced"]');
  const syncedDisabled = await syncedAction.isDisabled();
  await localAction.tap();
  await page.waitForFunction(() =>
    window.__SF?.menuState?.()?.careerRecovery?.armedChoice === "local",
  null, { timeout: 3000 });
  const conflictAfterFirst = await invoke(page, "careerConflictStateForQA");
  await localAction.tap();
  await page.waitForFunction(() =>
    window.__SF?.menuState?.()?.careerRecovery?.state === "resolved",
  null, { timeout: 3000 });
  const resolved = await page.evaluate(() => ({
    career: window.__SF.progressionCareerForQA(),
    conflict: window.__SF.careerConflictStateForQA(),
    save: window.__SF.persistenceState(),
    menu: window.__SF.menuState().careerRecovery,
  }));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const proof = {
    staged, navBadge, layout, syncedDisabled, conflictAfterFirst,
    expected: branches.local, saveBefore, resolved,
  };
  evidence.careerRecoveryMobile = proof;
  check("mobile recovery exposes a 44px two-tap safe choice and disables an invalid synced branch",
    staged?.ok === true && navBadge && layout.visible && layout.state === "conflict"
      && layout.horizontalOverflow <= 2
      && layout.entries.every((entry) => entry.width >= 43.5 && entry.height >= 43.5)
      && layout.entries.find((entry) => entry.choice === "local")?.cardState === "available"
      && layout.entries.find((entry) => entry.choice === "synced")?.cardState === "unavailable"
      && syncedDisabled && conflictAfterFirst?.active === true
      && conflictAfterFirst?.branches?.synced?.valid === false
      && resolved.conflict?.active === false
      && resolved.save?.careerQuarantined === false
      && same(resolved.career, branches.local)
      && same(resolved.save?.autosave, saveBefore?.autosave)
      && same(resolved.save?.manuals, saveBefore?.manuals),
    JSON.stringify(proof));
  await page.locator(".sf-stage").screenshot({
    path: path.join(OUT, "mobile-career-recovery-390x844.png"),
  });
  await context.close();
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
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await bootPage(context, "desktop");
    const definitions = await progressionPass(page);
    await careerValidationPass(page, definitions);
    await gameplayEffectsPass(page, definitions);
    await haloEffectsPass(page, definitions);
    await edictEffectsPass(page, definitions);
    await desktopUiPass(page, definitions);
    await context.close();
    await mobileUiPass(browser);
    await landscapeUiPass(browser);
    await careerRecoveryDesktopPass(browser, "local");
    await careerRecoveryDesktopPass(browser, "synced");
    await careerRecoveryMobilePass(browser);
  } finally {
    await browser.close();
  }
} catch (error) {
  diagnostics.fatal = error?.stack || String(error);
  check("progression suite completes without a fatal harness error", false, diagnostics.fatal);
} finally {
  server.kill("SIGTERM");
}

check("no page errors", diagnostics.pageErrors.length === 0,
  diagnostics.pageErrors.slice(0, 8).join(" | "));
check("no console errors", diagnostics.consoleErrors.length === 0,
  diagnostics.consoleErrors.slice(0, 8).join(" | "));

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
