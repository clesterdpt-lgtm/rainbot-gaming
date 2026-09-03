#!/usr/bin/env node
/* Acceptance probe verifying Stylite takes damage when it jumps down voluntarily (stoop)
   and stays down for the extended ground window. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, "output/saintfall/stylite-stoop");
const port = 49000 + (process.pid % 7000);
const base = `http://127.0.0.1:${port}`;
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? ` · ${detail}` : ""}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(out, { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    if (text.includes("preloaded using link preload but not used")) return;
    consoleErrors.push(text);
  });

  console.log("\n=== STYLITE VOLUNTARY STOOP AND GROUND DAMAGE ===");
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=low&seed=boss-hitbox-v1`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  // 1. Setup Stylite in combat
  const setup = await page.evaluate(() => {
    const T = window.__SF;
    T.releaseCamera?.();
    T.ctx.stylite?.resetToPerch?.();
    T.teleportToStylite(24);
    T.advanceTime(2.0, 1 / 60);
    T.forceStylitePhase("perched", 120);
    T.advanceTime(0.5, 1 / 60);
    const s0 = T.styliteState();
    return {
      phase: s0?.phase,
      grounded: s0?.grounded,
      altitude: s0?.altitude,
      health: s0?.health,
    };
  });
  check("Stylite starts perched with grounded=false",
    setup.phase === "perched" && setup.grounded === false && setup.altitude > 20,
    `phase=${setup.phase} grounded=${setup.grounded} alt=${setup.altitude}`);

  // 2. Trigger voluntary stoop jump down to the player
  const stoopTrigger = await page.evaluate(() => {
    const T = window.__SF;
    const ret = T.forceStyliteStoop();
    return { phase: ret?.phase, statePhase: T.styliteState()?.phase };
  });
  check("Force voluntary stoop initiates stoop phase",
    stoopTrigger.phase === "stoop" || stoopTrigger.statePhase === "stoop",
    `phase=${stoopTrigger.phase}`);

  // 3. Advance time through the flight until landing
  const landing = await page.evaluate(() => {
    const T = window.__SF;
    let landed = false;
    for (let i = 0; i < 120; i += 1) {
      T.advanceTime(0.033, 1 / 60);
      const st = T.styliteState();
      if (st?.phase === "stoopGrounded") {
        landed = true;
        break;
      }
    }
    const s = T.styliteState();
    const inst = T.ctx?.stylite?.instance?.();
    return {
      landed,
      phase: s?.phase,
      grounded: s?.grounded,
      instGrounded: inst?.grounded,
      altitude: s?.altitude,
      health: s?.health,
      maxHealth: s?.maxHealth,
    };
  });
  check("Stylite lands into stoopGrounded phase with grounded=true",
    landing.landed && landing.phase === "stoopGrounded" && landing.grounded === true && landing.instGrounded === true,
    `phase=${landing.phase} grounded=${landing.grounded} instGrounded=${landing.instGrounded} alt=${landing.altitude}`);

  // 4. Test Melee Damage while grounded
  const meleeTest = await page.evaluate(() => {
    const T = window.__SF;
    const sBefore = T.styliteState();
    const inst = T.ctx?.stylite?.instance?.();
    const hp0 = inst?.health || sBefore?.health || 0;

    // Position player right against Stylite facing it
    T.player.state.x = inst.x + 1.5;
    T.player.state.y = inst.y;
    T.player.state.z = inst.z;
    const heading = Math.atan2(inst.x - T.player.state.x, inst.z - T.player.state.z);
    T.player.state.yaw = heading;
    T.player.state.camYaw = heading;
    T.setBodyHeading?.(heading);

    // Enable melee weapon mode
    T.weapons?.setMode?.("melee");
    const w = T.ctx?.weapons?.current;
    const spec = (T.ctx?.operativeKitActive || !T.ctx?.weapons)
      && T.ctx?.loadout?.meleeSpec?.melee ? T.ctx?.loadout?.meleeSpec : (w?.spec?.melee ? w?.spec : null);

    const box = T.ctx?.combat?.hitbox?.stylite;
    const reach = (spec?.reach || 2.4) * 1.2 * 1.0;
    const near = Math.hypot(inst.x - T.player.state.x, inst.z - T.player.state.z);

    // Perform melee strike
    const dealt = T.ctx?.combat?.meleeStrike?.(1.5, Math.PI * 1.5, false, 1.2) || 0;

    T.advanceTime(0.1, 1 / 60);
    const sAfter = T.styliteState();
    const hpAfter = inst?.health || sAfter?.health || 0;

    return {
      hp0,
      hpAfter,
      dealt,
      diff: hp0 - hpAfter,
      hasSpec: !!spec,
      specMelee: spec?.melee,
      instGrounded: inst?.grounded,
      reach,
      targetR: box?.r,
      near,
      enemiesLiveCount: T.enemies.live.length,
      hasStyliteInLive: T.enemies.live.some(e => e.key === "stylite"),
    };
  });
  check("Stylite takes melee damage while grounded from voluntary stoop",
    meleeTest.diff > 0,
    `dealt=${meleeTest.dealt} diff=${meleeTest.diff.toFixed(1)} hp=${meleeTest.hpAfter.toFixed(1)}`);

  // 5. Test Ranged Damage while grounded
  const rangedTest = await page.evaluate(() => {
    const T = window.__SF;
    const inst = T.ctx?.stylite?.instance?.();
    const hp0 = inst?.health || 0;

    const dealt = T.ctx?.combat?.damageEnemy?.(inst, 150, {
      source: "shot",
      x: inst.x,
      y: inst.y + 1,
      z: inst.z,
    }) || 0;

    T.advanceTime(0.1, 1 / 60);
    const hpAfter = inst?.health || 0;
    return { hp0, hpAfter, dealt, diff: hp0 - hpAfter };
  });
  check("Stylite takes ranged damage while grounded from voluntary stoop",
    rangedTest.diff > 0,
    `dealt=${rangedTest.dealt} diff=${rangedTest.diff}`);

  // 6. Verify extended grounded duration (> 2.0s after landing)
  const durationTest = await page.evaluate(() => {
    const T = window.__SF;
    // We already advanced ~0.2s. Advance 2.0 more seconds (total ~2.2s).
    // The previous 1.1s timer would have already transitioned to leap and re-perched.
    T.advanceTime(2.0, 1 / 60);
    const sMid = T.styliteState();

    // Advance 1.5 more seconds to exceed 3.2s
    T.advanceTime(1.5, 1 / 60);
    const sEnd = T.styliteState();

    return {
      midPhase: sMid?.phase,
      midGrounded: sMid?.grounded,
      endPhase: sEnd?.phase,
    };
  });
  check("Stylite remains grounded past 2.0s (> old 1.1s timer)",
    durationTest.midPhase === "stoopGrounded" && durationTest.midGrounded === true,
    `midPhase=${durationTest.midPhase} midGrounded=${durationTest.midGrounded}`);

  check("Stylite transitions back to leap after extended ground timer expires",
    durationTest.endPhase === "leap" || durationTest.endPhase === "perched",
    `endPhase=${durationTest.endPhase}`);

  check("presentation run has no page errors", pageErrors.length === 0, pageErrors.join("; "));
  check("presentation run has no console errors", consoleErrors.length === 0, consoleErrors.join("; "));

  await writeFile(path.resolve(out, "results.json"), JSON.stringify({ results, failed }, null, 2));
  await browser.close();
} finally {
  server.kill("SIGTERM");
}

console.log(`\n${results.length - failed}/${results.length} checks passed\n`);
if (failed > 0) process.exit(1);
