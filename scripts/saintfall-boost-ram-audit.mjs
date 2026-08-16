#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 46900 + (process.pid % 900);
const base = `http://127.0.0.1:${port}`;

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}

async function main() {
  const s = server();
  let browser;
  try {
    await new Promise((r) => setTimeout(r, 1000));
    browser = await chromium.launch({
      headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/games/saintfall.html?qa=1&quality=high&time=noon`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 60000 });
    await page.evaluate(() => document.documentElement.classList.add("sf-maximised"));

    const step = async (sec) => {
      await page.evaluate((s) => window.__SF.advanceTime(s, 1 / 60), sec);
    };

    console.log("Testing Boost Ram Mechanics...\n");

    // Test 1: Frontal Lance Ram on standard Thresher
    await page.evaluate(() => {
      const T = window.__SF;
      T.releaseCamera();
      T.invulnerable(true);
      const site = T.findFlatSite(12);
      T.teleport(site[0], site[1], 0);
      T.resetBoost(true);
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      T.advanceTime(0.2, 1 / 60);
      const p = T.player.state;
      T.spawnEnemy("thresher", p.x, p.z + 14, { health: 200 });
      T.advanceTime(0.1, 1 / 60);
    });

    const thresherBefore = await page.evaluate(() => {
      const live = window.__SF.enemies.live;
      const e = live[live.length - 1];
      return { id: e.id, x: e.x, z: e.z, health: e.health, stunTime: e.stunTime || 0 };
    });

    await page.keyboard.down("KeyW");
    await step(0.3);
    await page.keyboard.down("ShiftLeft");
    await step(1.2);
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyW");

    const thresherAfter = await page.evaluate((id) => {
      const live = window.__SF.enemies.live;
      const e = live.find((x) => x.id === id) || live[live.length - 1];
      return { id: e.id, x: e.x, z: e.z, health: e.health, stunTime: e.stunTime || 0 };
    }, thresherBefore.id);

    const thresherDmg = thresherBefore.health - thresherAfter.health;
    const thresherDist = Math.hypot(thresherAfter.x - thresherBefore.x, thresherAfter.z - thresherBefore.z);
    console.log(`1. Frontal Ram vs Thresher: Damage = ${thresherDmg} (expected ~145), StunTime = ${thresherAfter.stunTime.toFixed(2)}s, Pushback = ${thresherDist.toFixed(2)}m`);
    if (thresherDmg >= 140 && thresherAfter.stunTime > 0.5 && thresherDist >= 1.0) {
      console.log("   -> PASS: High damage, instant stun, and pushback on thresher.");
    } else {
      throw new Error(`Frontal ram vs thresher failed: dmg=${thresherDmg}, stun=${thresherAfter.stunTime}, dist=${thresherDist}`);
    }

    // Test 2: Frontal Lance Ram on Heavy Enemy (Harrow / Boss)
    await page.evaluate(() => {
      const T = window.__SF;
      T.releaseCamera();
      T.invulnerable(true);
      const site = T.findFlatSite(12);
      T.teleport(site[0], site[1], 0);
      T.resetBoost(true);
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      T.advanceTime(0.2, 1 / 60);
      const p = T.player.state;
      T.spawnEnemy("harrow", p.x, p.z + 10, { health: 1000 });
      T.advanceTime(0.1, 1 / 60);
    });

    await page.keyboard.down("KeyW");
    await page.keyboard.down("ShiftLeft");
    await step(0.4);

    const heavyAtImpact = await page.evaluate(() => {
      const live = window.__SF.enemies.live;
      const e = live[live.length - 1];
      return { id: e.id, x: e.x, z: e.z, health: e.health, stunTime: e.stunTime || 0, knockbackTime: e.knockbackTime || 0 };
    });

    await step(0.4);
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyW");

    const heavyAfter = await page.evaluate((id) => {
      const live = window.__SF.enemies.live;
      const e = live.find((x) => x.id === id) || live[live.length - 1];
      return { id: e.id, x: e.x, z: e.z, health: e.health, stunTime: e.stunTime || 0, knockbackTime: e.knockbackTime || 0 };
    }, heavyAtImpact.id);

    const heavyDmg = 1000 - heavyAfter.health;
    const heavyDisplacement = Math.hypot(heavyAfter.x - heavyAtImpact.x, heavyAfter.z - heavyAtImpact.z);
    console.log(`2. Frontal Ram vs Heavy Boss/Harrow: Damage = ${heavyDmg} (expected ~145), StunTime = ${heavyAfter.stunTime.toFixed(2)}s, KnockbackTime = ${heavyAfter.knockbackTime}s, Post-Impact Displacement = ${heavyDisplacement.toFixed(2)}m`);
    if (heavyDmg >= 140 && heavyAfter.stunTime > 0.5 && heavyAfter.knockbackTime === 0 && heavyDisplacement < 0.1) {
      console.log("   -> PASS: High damage, instant stun, and NO pushback / knockback on heavy enemy.");
    } else {
      throw new Error(`Frontal ram vs heavy failed: dmg=${heavyDmg}, stun=${heavyAfter.stunTime}, knockback=${heavyAfter.knockbackTime}, displacement=${heavyDisplacement}`);
    }

    // Test 3: Backward/Strafe Boost vs Thresher (Glancing contact)
    await page.evaluate(() => {
      const T = window.__SF;
      T.releaseCamera();
      T.invulnerable(true);
      const site = T.findFlatSite(12);
      T.teleport(site[0], site[1], 0);
      T.resetBoost(true);
      T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
      T.advanceTime(0.2, 1 / 60);
      const p = T.player.state;
      T.spawnEnemy("thresher", p.x, p.z - 14, { health: 100 });
      T.advanceTime(0.1, 1 / 60);
    });

    const glanceBefore = await page.evaluate(() => {
      const live = window.__SF.enemies.live;
      const e = live[live.length - 1];
      return { id: e.id, x: e.x, z: e.z, health: e.health, stunTime: e.stunTime || 0 };
    });

    await page.keyboard.down("KeyS");
    await step(0.3);
    await page.keyboard.down("ShiftLeft");
    await step(1.2);
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("KeyS");

    const glanceAfter = await page.evaluate((id) => {
      const live = window.__SF.enemies.live;
      const e = live.find((x) => x.id === id) || live[live.length - 1];
      return { id: e.id, x: e.x, z: e.z, health: e.health, stunTime: e.stunTime || 0 };
    }, glanceBefore.id);

    const glanceDmg = glanceBefore.health - glanceAfter.health;
    const glanceDist = Math.hypot(glanceAfter.x - glanceBefore.x, glanceAfter.z - glanceBefore.z);
    console.log(`3. Backward/Strafe Glance vs Thresher: Damage = ${glanceDmg} (expected ~25), StunTime = ${glanceAfter.stunTime.toFixed(2)}s, Pushback = ${glanceDist.toFixed(2)}m`);
    if (glanceDmg <= 35 && glanceAfter.stunTime === 0 && glanceDist >= 1.0) {
      console.log("   -> PASS: Small damage, NO stun, and pushes back thresher.");
    } else {
      throw new Error(`Backward/strafe glance failed: dmg=${glanceDmg}, stun=${glanceAfter.stunTime}, dist=${glanceDist}`);
    }

    console.log("\nALL BOOST RAM AUDIT CHECKS PASSED!");
  } finally {
    if (browser) await browser.close();
    s.kill();
  }
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
