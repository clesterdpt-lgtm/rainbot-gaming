#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = process.cwd();
const PORT = 49961;
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

  const pageErrors = [];
  page.on("pageerror", (err) => {
    console.error("[PAGEERROR]", err.message);
    pageErrors.push(err.message);
  });

  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 45000 });

  const hitboxTest = await page.evaluate(async () => {
    const T = window.__SF;
    const ctx = T.ctx;
    const arena = ctx.districtBosses.sites.find((s) => s.key === "reach");
    T._teleportRaw(arena.x, arena.z, 0);
    for (let i = 0; i < 60; i += 1) T.renderOnce(1 / 60);

    const inst = ctx.enemies.live.find((e) => e.key === "matriarch");
    const brain = ctx.matriarch.brainFor?.(inst);

    // Test direct frontal head hit
    // Place player directly in front of head at along = 4.5m, across = 0m
    const fx = Math.sin(inst.yaw);
    const fz = Math.cos(inst.yaw);
    const rx = fz;
    const rz = -fx;

    const ps = ctx.player.state;
    ps.x = inst.x + fx * 4.5;
    ps.z = inst.z + fz * 4.5;
    ps.y = inst.y;

    const directLance = ctx.matriarch.tryLand?.(inst, brain, 6.8, 0.20, 28, "lance");

    // Test sidestepped / distanced player (along = 4.5m, across = 3.5m)
    ps.x = inst.x + fx * 4.5 + rx * 3.5;
    ps.z = inst.z + fz * 4.5 + rz * 3.5;
    ps.y = inst.y;

    const sideDodgedLance = ctx.matriarch.tryLand?.(inst, brain, 6.8, 0.20, 28, "lance");

    // Test distant player (along = 12.0m, across = 0m)
    ps.x = inst.x + fx * 12.0;
    ps.z = inst.z + fz * 12.0;
    ps.y = inst.y;

    const distantLance = ctx.matriarch.tryLand?.(inst, brain, 6.8, 0.20, 28, "lance");

    return {
      directHit: directLance,
      sideDodgeMiss: !sideDodgedLance,
      distantMiss: !distantLance,
    };
  });

  console.log("\n=== MATRIARCH DIRECT CHARGE & TIGHT HITBOX SURVEY ===");
  console.log(`  Data: ${JSON.stringify(hitboxTest)}`);
  check(hitboxTest.directHit, "Direct frontal lance impact lands on targeted player");
  check(hitboxTest.sideDodgeMiss, "Sidestepping / lateral distance cleanly avoids lance charge (no phantom hitbox)");
  check(hitboxTest.distantMiss, "Distant player outside charge range is not damaged");

  check(pageErrors.length === 0, "Zero page errors during hitbox tests", pageErrors.join("; "));

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

if (findings.length > 0) {
  console.error(`\nFAILED: ${findings.length} check(s)`);
  process.exit(1);
} else {
  console.log("\nALL DIRECT CHARGE & HITBOX CHECKS PASSED!");
  process.exit(0);
}
