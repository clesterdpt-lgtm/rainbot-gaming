#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Distaff Web-Bite and Continuous Leg Combat Probe
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(root, "output/saintfall/distaff-combat");
const port = 52100 + (process.pid % 5000);
const base = `http://127.0.0.1:${port}`;
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(outDir, { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 120000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
  });

  console.log("=== DISTAFF WEB AND LEG COMBAT VERIFICATION ===");

  // 1. Teleport to Glass Scar and awaken Distaff
  await page.evaluate(() => {
    const T = window.__SF;
    T.distaff.resetToLair();
    T.teleportToDistaff(25);
    T.advanceToDistaffPhase("standing", 10);
  });

  // 2. Test Continuous Leg Damage & Footing Collapse
  const legCombat = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    const initialHealth = inst.health;
    const initialHp0 = inst.legHp[0];
    const initialHp1 = inst.legHp[1];
    const initialHp2 = inst.legHp[2];

    // Damage leg 0
    T.combat.damageLeg(inst, 0, 60, { x: inst.x, y: inst.y, z: inst.z });
    const after0 = { leg0: inst.legHp[0], health: inst.health, broken0: inst.legBroken[0] };

    // Damage leg 1 (should NOT reset leg 0!)
    T.combat.damageLeg(inst, 1, 70, { x: inst.x, y: inst.y, z: inst.z });
    const after1 = { leg0: inst.legHp[0], leg1: inst.legHp[1], health: inst.health };

    // Damage leg 2
    T.combat.damageLeg(inst, 2, 80, { x: inst.x, y: inst.y, z: inst.z });
    const after2 = { leg0: inst.legHp[0], leg1: inst.legHp[1], leg2: inst.legHp[2], health: inst.health };

    // Continue damaging legs to break footing
    const footingBefore = T.distaffState().footingHp;
    // Deal remaining footing damage (340 - 210 = 130 remaining)
    T.combat.damageLeg(inst, 3, 200, { x: inst.x, y: inst.y, z: inst.z });
    for (let f = 0; f < 30; f += 1) T.renderOnce(1 / 60);
    const afterCollapse = T.distaffState();

    return {
      initialHealth,
      after0,
      after1,
      after2,
      footingBefore,
      afterCollapsePhase: afterCollapse.phase,
      afterCollapseCollapsed: afterCollapse.collapsed,
      afterCollapseHealth: afterCollapse.health,
      legsBroken: afterCollapse.legsBroken,
      allLegsHittable: !inst.legBroken.some(Boolean),
    };
  });

  check("damaging a leg damages the boss directly and keeps the leg active",
    legCombat.after0.health === legCombat.initialHealth - 60 && !legCombat.after0.broken0,
    `boss HP: ${legCombat.initialHealth} -> ${legCombat.after0.health}`);

  check("damaging multiple legs preserves damage across all legs without target-switch resets",
    legCombat.after2.leg0 === 340 - 60 && legCombat.after2.leg1 === 340 - 70 && legCombat.after2.leg2 === 340 - 80,
    `leg0=${legCombat.after2.leg0}, leg1=${legCombat.after2.leg1}, leg2=${legCombat.after2.leg2}`);

  check("cumulative leg damage causes Distaff to lose footing and enter collapsed state",
    legCombat.afterCollapsePhase === "collapsed" && legCombat.afterCollapseCollapsed,
    `phase=${legCombat.afterCollapsePhase}, collapsed=${legCombat.afterCollapseCollapsed}`);

  check("legs are never killed/disabled and remain live targets",
    legCombat.allLegsHittable, "all 8 legs remain unbroken");

  // 3. Test Web Reel -> Bite Attack Sequence
  const webReelBite = await page.evaluate(() => {
    const T = window.__SF;
    T.distaff.resetToLair();
    T.teleportToDistaff(18);
    T.advanceToDistaffPhase("standing", 10);

    const ev = { biteTelegraph: 0, bite: 0, biteMiss: 0, reelHit: 0, reelEnd: 0 };
    const offs = Object.keys(ev).map((k) => T.distaff.bus.on(k, () => { ev[k] += 1; }));

    // Prime and launch web reel
    T.distaff.primeAttack("reel");
    for (let f = 0; f < 300; f += 1) T.renderOnce(1 / 60);

    offs.forEach((f) => f());
    return { events: ev, state: T.distaffState() };
  });

  check("web reel pulls player and executes bite attack",
    webReelBite.events.biteTelegraph > 0 || webReelBite.events.bite > 0 || webReelBite.events.biteMiss > 0,
    JSON.stringify(webReelBite.events));

  // 4. Test Web Pin (Web Bolt) -> Bite Reaction
  const webPinBite = await page.evaluate(() => {
    const T = window.__SF;
    T.distaff.resetToLair();
    T.teleportToDistaff(7);
    T.advanceToDistaffPhase("standing", 10);

    const ev = { biteTelegraph: 0, bite: 0, biteMiss: 0, webHit: 0 };
    const offs = Object.keys(ev).map((k) => T.distaff.bus.on(k, () => { ev[k] += 1; }));

    // Apply web root to simulate web hit
    T.player.applyRoot(3.5);
    for (let f = 0; f < 120; f += 1) T.renderOnce(1 / 60);

    offs.forEach((f) => f());
    return { events: ev, state: T.distaffState() };
  });

  check("webbed/pinned player is targeted with bite attack",
    webPinBite.events.biteTelegraph > 0 || webPinBite.events.bite > 0 || webPinBite.events.biteMiss > 0,
    JSON.stringify(webPinBite.events));

  // 5. Test Recovery and Re-knocking Down
  const recoveryReKnockdown = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.enemies.live.find((e) => e.key === "distaff");
    T.advanceToDistaffPhase("standing", 25);
    const stateStanding = T.distaffState();

    // Damage legs again in second cycle
    T.combat.damageLeg(inst, 0, 150, { x: inst.x, y: inst.y, z: inst.z });
    T.combat.damageLeg(inst, 4, 200, { x: inst.x, y: inst.y, z: inst.z });
    for (let f = 0; f < 30; f += 1) T.renderOnce(1 / 60);
    const stateCollapsed2 = T.distaffState();

    return {
      standingPhase: stateStanding.phase,
      standingFooting: stateStanding.footingHp,
      collapsed2Phase: stateCollapsed2.phase,
      collapsed2Collapsed: stateCollapsed2.collapsed,
    };
  });

  check("Distaff recovers with full footing and can be repeatedly knocked down by damaging legs",
    recoveryReKnockdown.standingPhase === "standing" && recoveryReKnockdown.standingFooting === 340
      && recoveryReKnockdown.collapsed2Phase === "collapsed" && recoveryReKnockdown.collapsed2Collapsed,
    JSON.stringify(recoveryReKnockdown));

  await page.screenshot({ path: path.join(outDir, "distaff-combat.png") });

  await browser.close();
  server.kill();

  console.log(`\nResults: ${results.length - failed}/${results.length} checks passed.`);
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error("Probe error:", err);
  server.kill();
  process.exit(1);
}
