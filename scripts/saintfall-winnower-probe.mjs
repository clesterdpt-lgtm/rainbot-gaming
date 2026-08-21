#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49953;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

const findings = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`        ${detail}`);
  if (!ok) findings.push(label);
};

try {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(`${BASE}/games/saintfall.html`); if (r.ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

  const results = await page.evaluate(() => {
    const T = window.__SF;
    const ctx = T.ctx;
    const winnower = ctx.winnower;
    winnower.ensureSpawned();
    const inst = winnower.instance();
    const maxHp = inst.maxHealth;

    // Test 1: Shadow and Pool materials and colors
    const poolMesh = winnower.group.getObjectByName("sf-winnower-pool");
    const castMesh = winnower.group.getObjectByName("sf-winnower-contact");
    const castMatBlending = castMesh?.material?.blending;
    const castMatTint = castMesh?.material?.uniforms?.uTint?.value?.getHexString();
    const poolMatBlending = poolMesh?.material?.blending;

    // Test 2: Downing damage cap during stoke / stall
    winnower.forcePhase("stoke", 10);
    inst.health = maxHp;
    winnower.status(); // let update run

    // Simulate dealing 5000 damage in one hit while grounded
    const damage1 = winnower.modifyIncomingDamage(inst, { source: "melee" }, 5000);
    const dealt1 = ctx.combat.damageEnemy(inst, 5000, { source: "melee", x: inst.x, y: inst.y, z: inst.z });
    const hpAfter1 = inst.health;

    // Attempt second massive hit in SAME downing
    const damage2 = winnower.modifyIncomingDamage(inst, { source: "rifle" }, 5000);
    const dealt2 = ctx.combat.damageEnemy(inst, 5000, { source: "rifle", x: inst.x, y: inst.y, z: inst.z });
    const hpAfter2 = inst.health;

    // Test 3: Lift cannot be drained while grounded or in launch
    const liftBefore = inst.lift;
    const drainedWhileGrounded = ctx.combat.drainLift ? ctx.combat.drainLift(inst, 2, 0) : 0;
    winnower.forcePhase("launch", 1.2);
    const drainedWhileLaunching = ctx.combat.drainLift ? ctx.combat.drainLift(inst, 2, 0) : 0;

    // Test 4: Lift CAN be drained in active flight (soar)
    winnower.forcePhase("soar", 15);
    const liftInFlight = inst.lift;
    const drainedInFlight = ctx.combat.drainLift ? ctx.combat.drainLift(inst, 2, 0) : 0;
    const liftAfterDrain = inst.lift;

    // Test 5: HUD event count element displays numeric HP when grounded
    inst.health = 4000;
    inst.state = "alive";
    winnower.forcePhase("stoke", 10);
    ctx.hud?.update?.(0.1, ctx.player, ctx.camera);
    const eventCountText = document.getElementById("sf-event-count")?.textContent || "";

    // Test 6: Final kill when boss is already low health
    inst.health = maxHp * 0.15; // 15% health
    winnower.forcePhase("stoke", 10);
    const finalDamage = ctx.combat.damageEnemy(inst, maxHp * 0.3, { source: "melee", x: inst.x, y: inst.y, z: inst.z });
    const hpFinal = inst.health;
    const isDead = inst.state === "death" || inst.health <= 0;

    // Test 7: Strafe bombing and ash AoE duration
    inst.health = maxHp;
    inst.state = "alive";
    T.teleportToWinnower(40);
    let strafeBombs = 0;
    const offBomb = winnower.bus.on("strafeBomb", () => { strafeBombs += 1; });
    winnower.forcePhase("soar", 15);
    winnower.primeStrafe();
    for (let f = 0; f < 180; f += 1) T.renderOnce(1 / 60);
    offBomb();
    const ashField = winnower.spillAsh(inst.x, inst.z);
    const ashSpan = ashField?.span || 0;

    return {
      maxHp,
      castMatBlending,
      castMatTint,
      poolMatBlending,
      damage1,
      dealt1,
      hpAfter1,
      damage2,
      dealt2,
      hpAfter2,
      liftBefore,
      drainedWhileGrounded,
      drainedWhileLaunching,
      liftInFlight,
      drainedInFlight,
      liftAfterDrain,
      eventCountText,
      hpFinal,
      isDead,
      strafeBombs,
      ashSpan,
      downCap: winnower.config.downDamageCap,
      stokeSecs: winnower.config.stokeSeconds,
      ashSecs: winnower.config.ashSeconds,
    };
  });

  console.log("\n=== WINNOWER CHECKS ===");
  const THREE_NormalBlending = 1;
  const THREE_AdditiveBlending = 2;

  check(results.castMatBlending === THREE_NormalBlending, "Contact shadow uses NormalBlending (not MultiplyBlending)", `blending=${results.castMatBlending}`);
  check(results.castMatTint === "140f12", "Contact shadow tint is dark (no white rgb)", `tint=${results.castMatTint}`);
  check(results.poolMatBlending === THREE_AdditiveBlending, "Pool uses AdditiveBlending", `blending=${results.poolMatBlending}`);
  check(results.dealt1 <= results.maxHp * 0.19 && results.dealt1 >= results.maxHp * 0.17, `Single downing damage is capped at ~18% (${results.downCap})`, `dealt=${results.dealt1} maxHp=${results.maxHp}`);
  check(results.stokeSecs <= 6.0, "Downed stoke duration is shorter", `stokeSeconds=${results.stokeSecs}`);
  check(results.dealt2 === 0 && results.hpAfter2 === results.hpAfter1, "Additional damage in SAME downing is rejected/absorbed", `dealt2=${results.dealt2} hp=${results.hpAfter2}`);
  check(results.drainedWhileGrounded === 0 && results.drainedWhileLaunching === 0, "Lift cannot be drained during ground or launch phases", `ground=${results.drainedWhileGrounded} launch=${results.drainedWhileLaunching}`);
  check(results.liftInFlight === 4 && results.drainedInFlight > 0 && results.liftAfterDrain < results.liftInFlight, "Lift pool is full upon reaching flight and drains during soar", `lift=${results.liftInFlight} -> ${results.liftAfterDrain}`);
  check(/HP/.test(results.eventCountText), "HUD readout displays numeric HP while grounded", `text="${results.eventCountText}"`);
  check(results.strafeBombs >= 5, "Swooping strafe run drops a line of bombs", `strafeBombs=${results.strafeBombs}`);
  check(results.ashSecs >= 16.0 && results.ashSpan >= 16.0, "Ground ash AoE damage lasts longer", `ashSeconds=${results.ashSecs}`);
  check(results.isDead && results.hpFinal <= 0, "Boss can still be cleanly killed when on low health", `hpFinal=${results.hpFinal}`);

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

if (findings.length > 0) {
  console.error(`\nFAILED: ${findings.length} check(s)`);
  process.exit(1);
} else {
  console.log("\nALL WINNOWER PROBE CHECKS PASSED!");
  process.exit(0);
}
