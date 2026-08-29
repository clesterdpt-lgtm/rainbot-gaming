#!/usr/bin/env node
/* ============================================================
   SAINTFALL - production difficulty consistency regression

   Verifies that the three authored tier tables remain unchanged and that
   custom encounter paths apply those values exactly once. It also proves a
   fresh Martyr field (which legitimately exceeds the old 420-enemy ceiling)
   survives a full manual save/load round trip.

   Usage:
     node scripts/saintfall-difficulty-consistency.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 54000 + (process.pid % 5000);
const BASE = `http://127.0.0.1:${PORT}`;
const GAME = `${BASE}/games/saintfall.html?qa=1&quality=low&intro=skip&seed=difficulty-consistency`;
const failures = [];
const diagnostics = { pageErrors: [], consoleErrors: [] };

const EXPECTED_VALUES = Object.freeze({
  pilgrim: {
    incoming: 0.82, lightHealth: 0.85, heavyHealth: 0.85, bossHealth: 0.85,
    roster: 0.8, gleanerDelta: -1, gleanerDirectAim: 0.5, breachPace: 1.25,
    thresherSpeed: 0.9, pounce: 1, heat: 0.88, slotCap: 2, sustain: 1,
    regenDelay: 4.5, regenRate: 1, garrison: 0.85, alertRadius: 1, sight: 1,
    gleanerBurst: 3, gleanerRoster: 1,
  },
  penitent: {
    incoming: 1, lightHealth: 1, heavyHealth: 1, bossHealth: 1,
    roster: 1, gleanerDelta: 0, gleanerDirectAim: 0.65, breachPace: 1,
    thresherSpeed: 1, pounce: 1, heat: 1, slotCap: 2, sustain: 1,
    regenDelay: 5.5, regenRate: 1, garrison: 1, alertRadius: 1, sight: 1,
    gleanerBurst: 3, gleanerRoster: 1,
  },
  martyr: {
    incoming: 1.25, lightHealth: 1.6, heavyHealth: 1.3, bossHealth: 1.5,
    roster: 1.7, gleanerDelta: 0, gleanerDirectAim: 0.8, breachPace: 0.55,
    thresherSpeed: 1.35, pounce: 1.25, heat: 1.5, slotCap: 3, sustain: 1.4,
    regenDelay: 8.5, regenRate: 0.65, garrison: 1.65, alertRadius: 1.65,
    sight: 1.25, gleanerBurst: 3, gleanerRoster: 1,
  },
});

const EXPECTED_WAVE = Object.freeze({
  pilgrim: {
    count: 18,
    byKey: { thresher: { count: 12, maxHealth: 51 }, gleaner: { count: 4, maxHealth: 128 }, harrow: { count: 2, maxHealth: 357 } },
  },
  penitent: {
    count: 23,
    byKey: { thresher: { count: 15, maxHealth: 60 }, gleaner: { count: 5, maxHealth: 150 }, harrow: { count: 3, maxHealth: 420 } },
  },
  martyr: {
    count: 36,
    byKey: { thresher: { count: 26, maxHealth: 96 }, gleaner: { count: 5, maxHealth: 240 }, harrow: { count: 5, maxHealth: 546 } },
  },
});

/* A live setting change rescales health but never despawns combatants from an
   encounter already in progress. The next wave receives the new roster. */
const EXPECTED_LIVE_SWITCH = Object.freeze({
  count: EXPECTED_WAVE.martyr.count,
  byKey: {
    thresher: { count: EXPECTED_WAVE.martyr.byKey.thresher.count, maxHealth: 60 },
    gleaner: { count: EXPECTED_WAVE.martyr.byKey.gleaner.count, maxHealth: 150 },
    harrow: { count: EXPECTED_WAVE.martyr.byKey.harrow.count, maxHealth: 420 },
  },
});

function check(ok, label, detail = "") {
  const pass = !!ok;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!pass) failures.push(label);
}

function sameNumbers(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual?.[key] === value);
}

function attachDiagnostics(page, label) {
  page.on("pageerror", (error) => diagnostics.pageErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    if (/jsdelivr|unpkg|gstatic|googleapis|favicon/i.test(location?.url || "")) return;
    diagnostics.consoleErrors.push(`${label}: ${message.text()}`);
  });
}

async function boot(context, tier, label) {
  const page = await context.newPage();
  attachDiagnostics(page, label);
  await page.goto(`${GAME}&difficulty=${tier}`, {
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    const T = window.__SF;
    T.maximize();
    document.getElementById("sf-boot")?.remove();
    T.invulnerable(true);
    T.setBreachAuto(false);
  });
  return page;
}

function waveMatches(actual, expected) {
  if (!actual || actual.count !== expected.count) return false;
  return Object.entries(expected.byKey).every(([key, spec]) => {
    const item = actual.byKey?.[key];
    return item?.count === spec.count
      && item?.maxHealth?.length === 1 && item.maxHealth[0] === spec.maxHealth;
  });
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

let browser;
try {
  for (let i = 0; i < 150; i += 1) {
    try {
      const response = await fetch(`${BASE}/games/saintfall.html`);
      if (response.ok) break;
    } catch (_) { /* retry while the server binds */ }
    await delay(100);
  }

  browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });

  console.log("\n=== AUTHORED TIER TABLES AND CUSTOM HEALTH PATHS ===");
  const mechanicsContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await boot(mechanicsContext, "martyr", "mechanics");
  const mechanics = await page.evaluate(() => {
    const T = window.__SF;
    const tables = {};
    for (const tier of ["pilgrim", "penitent", "martyr"]) {
      tables[tier] = T.setDifficultyForQA(tier).values;
    }

    T.setDifficultyForQA("martyr");
    const apostate = { martyr: T.apostateState() };
    T.setDifficultyForQA("penitent");
    apostate.penitent = T.apostateState();
    T.setDifficultyForQA("pilgrim");
    apostate.pilgrim = T.apostateState();

    const surveyWave = (tier) => {
      T.clearEnemies();
      T.setDifficultyForQA(tier);
      const ps = T.player.state;
      T.startBreachWave(2, ps.x + 34, ps.z + 34, true);
      const memberIds = new Set(T.breachState()?.memberIds || []);
      const members = T.enemies.live.filter((enemy) => memberIds.has(enemy.id));
      const byKey = {};
      for (const key of ["thresher", "gleaner", "harrow"]) {
        const caste = members.filter((enemy) => enemy.key === key);
        byKey[key] = {
          count: caste.length,
          maxHealth: [...new Set(caste.map((enemy) => enemy.maxHealth))].sort((a, b) => a - b),
        };
      }
      return { count: members.length, byKey, ids: members.map((enemy) => enemy.id) };
    };

    const waves = {
      pilgrim: surveyWave("pilgrim"),
      penitent: surveyWave("penitent"),
      martyr: surveyWave("martyr"),
    };
    const martyrIds = new Set(waves.martyr.ids);
    T.setDifficultyForQA("penitent");
    const switched = T.enemies.live.filter((enemy) => martyrIds.has(enemy.id));
    const switchedByKey = {};
    for (const key of ["thresher", "gleaner", "harrow"]) {
      const caste = switched.filter((enemy) => enemy.key === key);
      switchedByKey[key] = {
        count: caste.length,
        maxHealth: [...new Set(caste.map((enemy) => enemy.maxHealth))].sort((a, b) => a - b),
      };
    }
    return {
      tables,
      apostate,
      waves,
      switched: { count: switched.length, byKey: switchedByKey },
    };
  });

  for (const tier of ["pilgrim", "penitent", "martyr"]) {
    check(sameNumbers(mechanics.tables[tier], EXPECTED_VALUES[tier]),
      `${tier} authored values are unchanged`, JSON.stringify(mechanics.tables[tier]));
  }
  check(mechanics.apostate.martyr?.maxHealth === 8400,
    "Apostate receives Martyr boss health at initial spawn",
    JSON.stringify(mechanics.apostate.martyr));
  check(mechanics.apostate.penitent?.maxHealth === 5600
      && mechanics.apostate.pilgrim?.maxHealth === 4760,
    "Apostate preserves the correct pool across live tier changes",
    JSON.stringify({
      penitent: mechanics.apostate.penitent?.maxHealth,
      pilgrim: mechanics.apostate.pilgrim?.maxHealth,
    }));
  for (const tier of ["pilgrim", "penitent", "martyr"]) {
    check(waveMatches(mechanics.waves[tier], EXPECTED_WAVE[tier]),
      `Breaker Brood applies ${tier} roster and health exactly once`,
      JSON.stringify(mechanics.waves[tier]));
  }
  check(waveMatches(mechanics.switched, EXPECTED_LIVE_SWITCH),
    "Live Martyr-to-Penitent switch rescales the existing breach once",
    JSON.stringify(mechanics.switched));
  await page.close();
  await mechanicsContext.close();

  console.log("\n=== FULL MARTYR FIELD SAVE / LOAD ===");
  const saveContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const savePage = await boot(saveContext, "martyr", "save-load");
  const saveLoad = await savePage.evaluate(() => {
    const T = window.__SF;
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
    if (!T.player.state.grounded) {
      T._teleportRaw(T.player.state.x, T.player.state.z, T.player.state.yaw);
    }
    const reason = T.saves.saveReason();
    const saved = T.saveSlot(0);
    const visibleSlot = T.persistenceState()?.manuals?.[0] || null;
    const savedIds = (saved?.enemies?.live || []).map((enemy) => enemy.id).sort();
    const victim = T.enemies.live.find((enemy) => !enemy.spec?.durableDomain);
    if (victim) T.enemies.remove(victim);
    const loaded = T.loadSlot(0);
    const restoredIds = T.enemies.live.filter((enemy) => !enemy.spec?.durableDomain)
      .map((enemy) => enemy.id).sort();
    return {
      reason,
      savedCount: savedIds.length,
      slotVisible: !!visibleSlot,
      slotCount: visibleSlot?.snapshot?.enemies?.live?.length ?? null,
      loaded,
      restoredCount: restoredIds.length,
      uniqueRestored: new Set(restoredIds).size,
      idsMatch: JSON.stringify(restoredIds) === JSON.stringify(savedIds),
      tierAfter: T.difficultyState()?.tier,
      apostateMaxAfter: T.apostateState()?.maxHealth ?? null,
      lastResult: T.persistenceState()?.lastResult?.type || null,
    };
  });
  check(saveLoad.reason === "" && saveLoad.savedCount > 420,
    "Fresh Martyr field creates a valid save above the former 420-enemy cap",
    JSON.stringify(saveLoad));
  check(saveLoad.slotVisible && saveLoad.slotCount === saveLoad.savedCount,
    "High-density Martyr slot survives validation and remains visible",
    JSON.stringify(saveLoad));
  check(saveLoad.loaded && saveLoad.idsMatch
      && saveLoad.restoredCount === saveLoad.savedCount
      && saveLoad.uniqueRestored === saveLoad.savedCount,
    "High-density Martyr roster restores completely with stable unique IDs",
    JSON.stringify(saveLoad));
  check(saveLoad.tierAfter === "martyr" && saveLoad.apostateMaxAfter === 8400
      && saveLoad.lastResult === "loaded",
    "Save restore retains Martyr and its Apostate pool",
    JSON.stringify(saveLoad));
  await savePage.close();
  await saveContext.close();

  check(diagnostics.pageErrors.length === 0,
    "Zero page errors", diagnostics.pageErrors.join("; "));
  check(diagnostics.consoleErrors.length === 0,
    "Zero same-origin console errors", diagnostics.consoleErrors.join("; "));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}

console.log("\nALL DIFFICULTY CONSISTENCY CHECKS PASSED");
