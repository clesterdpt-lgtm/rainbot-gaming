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

    // Test 3: Final kill when boss is already low health
    inst.health = maxHp * 0.2; // 20% health
    winnower.forcePhase("stoke", 10);
    const finalDamage = ctx.combat.damageEnemy(inst, maxHp * 0.3, { source: "melee", x: inst.x, y: inst.y, z: inst.z });
    const hpFinal = inst.health;
    const isDead = inst.state === "death" || inst.health <= 0;

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
      hpFinal,
      isDead,
    };
  });

  console.log("\n=== WINNOWER CHECKS ===");
  const THREE_NormalBlending = 1;
  const THREE_AdditiveBlending = 2;

  check(results.castMatBlending === THREE_NormalBlending, "Contact shadow uses NormalBlending (not MultiplyBlending)", `blending=${results.castMatBlending}`);
  check(results.castMatTint === "140f12", "Contact shadow tint is dark (no white rgb)", `tint=${results.castMatTint}`);
  check(results.poolMatBlending === THREE_AdditiveBlending, "Pool uses AdditiveBlending", `blending=${results.poolMatBlending}`);
  check(results.dealt1 <= results.maxHp * 0.36 && results.dealt1 >= results.maxHp * 0.34, "Single downing damage is capped at ~35%", `dealt=${results.dealt1} maxHp=${results.maxHp}`);
  check(results.dealt2 === 0 && results.hpAfter2 === results.hpAfter1, "Additional damage in SAME downing is rejected/absorbed", `dealt2=${results.dealt2} hp=${results.hpAfter2}`);
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
