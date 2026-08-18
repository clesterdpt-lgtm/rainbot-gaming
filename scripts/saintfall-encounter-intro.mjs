#!/usr/bin/env node
/* ============================================================
   SAINTFALL - encounter intro / Coulter bar gates

   Three player-facing promises that failed together:

     1. The Coulter HP bar is the Fallen Saint fight, not the staged
        spine that exists from drop.
     2. Walking into a district guardian from the far side of its
        landmark must play the reveal and then start the fight, not
        loop the camera on a reset.
     3. The reveal hold must freeze incoming damage. A player who
        cannot steer must not be eaten by garrison fire.

   Usage:
     node scripts/saintfall-encounter-intro.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "output/saintfall/encounter-intro");
const port = 53100 + (process.pid % 4000);
const base = `http://127.0.0.1:${port}`;
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
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
    args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${base}/games/saintfall.html?qa=1&quality=high`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    window.__SF.hideHud(false);
    document.getElementById("sf-boot")?.remove();
  });

  console.log("\n=== COULTER BAR ===");
  const startBar = await page.evaluate(() => {
    const T = window.__SF;
    T.player.spawn(-40, 380, 0);
    for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
    const bar = document.querySelector("#sf-bossbar");
    const saint = T.ctx.districtBosses.status("saint");
    const coulter = T.ctx.coulter.status();
    return {
      hidden: !!bar?.hidden,
      name: document.querySelector("#sf-bossbar-name")?.textContent || "",
      saintPhase: saint?.phase,
      saintAvailable: !!saint?.available,
      coulterPhase: coulter?.phase || null,
      coulterHealth: coulter?.health || 0,
    };
  });
  check("the Coulter bar is absent at drop",
    startBar.hidden && !/COULTER/i.test(startBar.name),
    JSON.stringify(startBar));
  check("a staged Coulter already exists with a live burrow phase",
    startBar.coulterPhase && startBar.coulterPhase !== "dormant" && startBar.coulterHealth > 0
      && startBar.saintPhase === "dormant" && !startBar.saintAvailable,
    JSON.stringify({
      phase: startBar.coulterPhase,
      hp: startBar.coulterHealth,
      saint: startBar.saintPhase,
    }));

  const saintBar = await page.evaluate(() => {
    const T = window.__SF;
    const M = T.ctx.mission;
    M.state.phase = "saintBoss";
    for (const boss of M.bosses) {
      if (boss.key !== "saint") boss.done = true;
    }
    M.state.bossesDone = M.bosses.filter((boss) => boss.done).length;
    for (let i = 0; i < 6; i += 1) T.renderOnce(1 / 60);
    const beforeApproach = {
      hidden: !!document.querySelector("#sf-bossbar")?.hidden,
      name: document.querySelector("#sf-bossbar-name")?.textContent || "",
      available: !!T.ctx.districtBosses.status("saint")?.available,
      phase: T.ctx.districtBosses.status("saint")?.phase,
    };
    const inst = T.ctx.enemies.live.find((enemy) => enemy.eventId === "district-boss:saint");
    T._teleportRaw(inst.x + 18, inst.z + 18, 0);
    T.setBodyHeading?.(0);
    let secs = 0;
    while (T.ctx.districtBosses.status("saint")?.phase === "dormant" && secs < 4) {
      T.renderOnce(1 / 60);
      secs += 1 / 60;
    }
    const during = {
      phase: T.ctx.districtBosses.status("saint")?.phase,
      hidden: !!document.querySelector("#sf-bossbar")?.hidden,
      name: document.querySelector("#sf-bossbar-name")?.textContent || "",
    };
    while (T.ctx.districtBosses.status("saint")?.phase === "alert" && secs < 8) {
      T.renderOnce(1 / 60);
      secs += 1 / 60;
    }
    return {
      beforeApproach,
      during,
      after: {
        phase: T.ctx.districtBosses.status("saint")?.phase,
        hidden: !!document.querySelector("#sf-bossbar")?.hidden,
        name: document.querySelector("#sf-bossbar-name")?.textContent || "",
        secs: Number(secs.toFixed(2)),
      },
    };
  });
  check("unlocking the Fallen Saint does not show the bar until the approach",
    saintBar.beforeApproach.available && saintBar.beforeApproach.phase === "dormant"
      && saintBar.beforeApproach.hidden && !/COULTER/i.test(saintBar.beforeApproach.name),
    JSON.stringify(saintBar.beforeApproach));
  check("approaching the Fallen Saint wakes the Coulter and shows its bar",
    (saintBar.during.phase === "alert" || saintBar.after.phase === "active")
      && /COULTER/i.test(saintBar.during.name || saintBar.after.name)
      && saintBar.after.phase === "active" && !saintBar.after.hidden,
    JSON.stringify(saintBar));

  console.log("\n=== OUTSIDE-IN INTRO ===");
  const outside = await page.evaluate(() => {
    const T = window.__SF;
    T.ctx.mission.state.phase = "districtBosses";
    T.ctx.winnower.resetToPerch();
    T.releaseCamera();
    for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
    const site = T.ctx.districtBosses.sites.find((entry) => entry.key === "censer");
    const w = T.winnowerState();
    const dx = w.x - site.x;
    const dz = w.z - site.z;
    const span = Math.hypot(dx, dz) || 1;
    const offset = Math.min(T.winnower.config.aggroRadius - 4,
      Math.max(56, site.arenaRadius - span + 12));
    const ox = w.x + (dx / span) * offset;
    const oz = w.z + (dz / span) * offset;
    T._teleportRaw(ox, oz, 0);
    T.setBodyHeading?.(0);
    const start = {
      siteDist: Number(Math.hypot(ox - site.x, oz - site.z).toFixed(1)),
      bossDist: Number(Math.hypot(ox - w.x, oz - w.z).toFixed(1)),
      arena: site.arenaRadius,
      aggro: T.winnower.config.aggroRadius,
    };
    const hpBefore = T.combat.player.hp;
    let secs = 0;
    let sawFree = false;
    let damagedDuringHold = false;
    /* OUTSIDE THE RING NOTHING MAY WAKE - see districtBosses.insideArena.
       This block used to expect the opposite: an alert from 106m,
       then "soar", checked at exactly the second the alert ended. It
       passed, and the frame after it stopped looking the ring reset
       the fight it had just watched begin - the player was still
       outside it - which re-armed the reveal, which the still-in-aggro
       player then re-triggered: measured as eight reveals in forty
       seconds with the camera held for 39.9 of them. So the far-side
       approach now waits OUTSIDE for three seconds and asserts the
       animal stays asleep, then steps inside the ring for the reveal. */
    for (let i = 0; i < 180; i += 1) { T.renderOnce(1 / 60); secs += 1 / 60; }
    const wokeOutside = T.winnowerState().phase !== "dormant";
    const inD = site.arenaRadius - 6;
    const ix = site.x + ((ox - site.x) / start.siteDist) * inD;
    const iz = site.z + ((oz - site.z) / start.siteDist) * inD;
    T._teleportRaw(ix, iz, 0);
    while (T.winnowerState().phase === "dormant" && secs < 6) {
      T.renderOnce(1 / 60);
      secs += 1 / 60;
    }
    const alertAt = T.winnowerState().phase;
    /* Measured from the hold's FIRST frame, not from before the walk
       in: the walk crosses the Censer Works' own garrison, whose fire
       is allowed to land, and comparing against a pre-walk figure
       reported that fire as a breach of the hold. */
    let hpAtHold = null;
    while (T.winnowerState().phase === "alert" && secs < 15) {
      if (T.player.state.free) {
        if (hpAtHold === null) hpAtHold = T.combat.player.hp;
        sawFree = true;
        T.combat.hurtPlayer(80, { source: "qa-garrison", x: ix, y: 2, z: iz });
        if (T.combat.player.hp < hpAtHold - 1e-6) damagedDuringHold = true;
      }
      T.renderOnce(1 / 60);
      secs += 1 / 60;
    }
    const phaseAfterAlert = T.winnowerState().phase;
    /* AND THEN THE PART THE OLD CHECK NEVER REACHED: thirty more
       seconds of fight, counting how many times the camera is taken.
       Once is the reveal. Twice is the loop. */
    let cameraTakes = 0;
    let wasFree = !!T.player.state.free;
    let resets = 0;
    const off = T.ctx.districtBosses.bus.on("arenaReset", () => { resets += 1; });
    for (let i = 0; i < 60 * 30; i += 1) {
      T.renderOnce(1 / 60);
      const f = !!T.player.state.free;
      if (f && !wasFree) cameraTakes += 1;
      wasFree = f;
    }
    off?.();
    return {
      start,
      wokeOutside,
      alertAt,
      phase: phaseAfterAlert,
      freeAfter: !!T.player.state.free,
      sawFree,
      damagedDuringHold,
      hpBefore,
      hpAfter: T.combat.player.hp,
      cameraTakes,
      resets,
      finalPhase: T.winnowerState().phase,
      secs: Number(secs.toFixed(2)),
    };
  });
  check("the outside approach is inside aggro and outside the district pin",
    outside.start.bossDist <= outside.start.aggro
      && outside.start.siteDist > outside.start.arena,
    JSON.stringify(outside.start));
  check("outside the ring, inside aggro, the animal stays asleep",
    !outside.wokeOutside, JSON.stringify(outside.start));
  check("stepping inside plays the reveal once and becomes a soaring fight",
    outside.alertAt === "alert" && outside.phase === "soar" && !outside.freeAfter,
    JSON.stringify(outside));
  check("...and thirty seconds later the camera has not been taken again",
    outside.cameraTakes === 0 && outside.resets === 0 && !outside.freeAfter,
    `camera taken ${outside.cameraTakes} more times, ${outside.resets} arena resets, final ${outside.finalPhase}`);
  check("the reveal camera holds, and garrison fire cannot land during it",
    outside.sawFree && !outside.damagedDuringHold && outside.hpAfter === outside.hpBefore,
    JSON.stringify({
      sawFree: outside.sawFree,
      damaged: outside.damagedDuringHold,
      hp: `${outside.hpBefore} -> ${outside.hpAfter}`,
    }));

  console.log("\n=== PAGE ===");
  check("no page errors", pageErrors.length === 0, pageErrors[0] || "");

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

console.log(`\n${failed === 0 ? "OK" : "FAILED"}  ${results.length - failed}/${results.length} checks`);
if (failed) process.exit(1);
