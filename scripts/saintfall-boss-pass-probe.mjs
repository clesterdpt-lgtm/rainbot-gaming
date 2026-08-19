#!/usr/bin/env node
/* ============================================================
   SAINTFALL - m101 boss pass probe

   One harness for the five m101 changes that are not the reveal
   camera (saintfall-boss-intro-probe.mjs owns that):

     1. The Matriarch's arena is FLAT and clear of masonry - the
        terrain pad, the mast keep-clear and the crag cull, measured
        rather than trusted.
     2. The Stylite's arena floor is flat, and the Wind Shrine left
        the crash zone.
     3. The boss bar carries the name and the bar, nothing else.
     4. A boss fight owns its arena: strays are purged, the boss's
        own brood is not, and field enemies cannot linger.
     5. Death holds (no auto-respawn), the death screen offers the
        records, autosave never fires during a fight, and loading
        the autosave is what continues the operation.

   Usage: node scripts/saintfall-boss-pass-probe.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "output/saintfall/boss-pass");
const port = 54800 + (process.pid % 3000);
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
    waitUntil: "domcontentloaded", timeout: 60000,
  });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    document.getElementById("sf-boot")?.remove();
    window.__SF.invulnerable(true);
  });

  /* ---------------- 1 + 2: arena terrain ---------------- */
  console.log("\n=== ARENA TERRAIN ===");
  const terrainReport = await page.evaluate(() => {
    const T = window.__SF;
    const sites = T.ctx.districtBosses.sites;
    const reach = sites.find((s) => s.key === "reach");
    const choir = sites.find((s) => s.key === "choir");
    const survey = (cx, cz, radii) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const r of radii) {
        for (let i = 0; i < 16; i += 1) {
          const a = (i / 16) * Math.PI * 2;
          const h = T.ctx.terrain.heightAt(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      const centre = T.ctx.terrain.heightAt(cx, cz);
      return { lo: +lo.toFixed(2), hi: +hi.toFixed(2), centre: +centre.toFixed(2),
        spread: +(hi - lo).toFixed(2) };
    };
    // Masonry survey: highest walking-grid solid proud of the ground.
    const masonry = (cx, cz, radius) => {
      let worst = 0;
      let at = null;
      for (let r = 4; r <= radius; r += 6) {
        for (let i = 0; i < 24; i += 1) {
          const a = (i / 24) * Math.PI * 2;
          const x = cx + Math.cos(a) * r;
          const z = cz + Math.sin(a) * r;
          const top = T.ctx.collide.solidTop(x, z);
          if (top === -Infinity) continue;
          const proud = top - T.ctx.collide.groundHeight(x, z);
          if (proud > worst) { worst = proud; at = [Math.round(x), Math.round(z), +proud.toFixed(2)]; }
        }
      }
      return { worst: +worst.toFixed(2), at };
    };
    const shrine = (T.ctx.world.pois || []).find((p) => p.id === "choir-shrine");
    return {
      reach: {
        site: { x: reach.x, z: reach.z, arenaRadius: reach.arenaRadius },
        flat: survey(reach.x, reach.z, [12, 40, 70]),
        masonry: masonry(reach.x, reach.z, 94),
      },
      choir: {
        site: { x: choir.x, z: choir.z, arenaRadius: choir.arenaRadius },
        flat: survey(choir.x, choir.z, [12, 45, 88]),
        shrineDist: shrine
          ? +Math.hypot(shrine.x - choir.x, shrine.z - choir.z).toFixed(1) : null,
      },
    };
  });
  console.log(`  reach: ${JSON.stringify(terrainReport.reach)}`);
  console.log(`  choir: ${JSON.stringify(terrainReport.choir)}`);
  check("Matriarch arena ground is flat across the pad",
    terrainReport.reach.flat.spread <= 2.0,
    `spread ${terrainReport.reach.flat.spread}m over r<=70`);
  check("Matriarch arena radius grew (>=140)",
    terrainReport.reach.site.arenaRadius >= 140,
    `arenaRadius ${terrainReport.reach.site.arenaRadius}`);
  check("no masonry stands in the Matriarch's arena",
    terrainReport.reach.masonry.worst <= 2.5,
    `tallest solid ${terrainReport.reach.masonry.worst}m at ${JSON.stringify(terrainReport.reach.masonry.at)}`);
  check("Stylite arena floor is flat across the pad",
    terrainReport.choir.flat.spread <= 2.0,
    `spread ${terrainReport.choir.flat.spread}m over r<=88`);
  check("Wind Shrine left the Stylite crash zone",
    (terrainReport.choir.shrineDist || 0) > 70,
    `shrine at ${terrainReport.choir.shrineDist}m from arena centre`);

  /* ---------------- 3 + 4: boss bar and the purge ---------------- */
  console.log("\n=== BOSS BAR + ARENA PURGE ===");
  const fight = await page.evaluate(() => {
    const T = window.__SF;
    const M = T.ctx.mission;
    M.state.phase = "districtBosses";
    for (const boss of M.bosses) boss.done = false;
    M.state.bossesDone = 0;
    const site = T.ctx.districtBosses.sites.find((s) => s.key === "reach");
    T.ctx.districtBosses.reset("reach");
    // Strays: two field threshers with no provenance, parked in the ring.
    const strayA = T.ctx.enemies.spawn("thresher", site.x + 20, site.z + 6, { yaw: 0 });
    const strayB = T.ctx.enemies.spawn("gleaner", site.x - 24, site.z - 10, { yaw: 1 });
    const strayIds = [strayA?.id, strayB?.id];
    T._teleportRaw(site.x + 30, site.z, 0);
    // Wake her and run the intro through.
    for (let i = 0; i < 420; i += 1) T.renderOnce(1 / 60);
    const boss = T.ctx.enemies.live.find((inst) => inst.key === "matriarch");
    // Her own clutch must survive the purge.
    let broodIds = [];
    if (boss) {
      T.ctx.combat.brood(boss, { broodCount: 2, broodCap: 12 });
      broodIds = (boss.broodKids || []).map((kid) => kid.id);
      for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);
    }
    const live = new Set(T.ctx.enemies.live.map((inst) => inst.id));
    const bar = document.getElementById("sf-bossbar");
    return {
      status: T.ctx.districtBosses.status("reach")?.phase,
      anyFight: T.ctx.districtBosses.anyFightActive(),
      strays: strayIds.map((id) => live.has(id)),
      brood: broodIds.map((id) => live.has(id)),
      broodCount: broodIds.length,
      bossAlive: !!boss && boss.health > 0,
      bar: bar ? {
        hidden: bar.hidden,
        name: document.getElementById("sf-bossbar-name")?.textContent || "",
        text: bar.textContent.trim(),
        kicker: !!document.getElementById("sf-bossbar-kicker"),
        hp: !!document.getElementById("sf-bossbar-hp"),
        detail: !!document.getElementById("sf-bossbar-detail"),
      } : null,
    };
  });
  console.log(`  ${JSON.stringify(fight)}`);
  check("the Matriarch fight engages", fight.status === "active" && fight.bossAlive,
    `phase ${fight.status}`);
  check("anyFightActive() reports the fight", fight.anyFight === true);
  check("field strays inside the arena are purged",
    fight.strays.every((alive) => alive === false),
    JSON.stringify(fight.strays));
  check("the boss's own brood survives the purge",
    fight.broodCount > 0 && fight.brood.every(Boolean),
    `${fight.brood.filter(Boolean).length}/${fight.broodCount} kids alive`);
  check("boss bar shows the name and nothing else",
    !!fight.bar && !fight.bar.hidden && fight.bar.name === "THE MATRIARCH"
      && fight.bar.text === "THE MATRIARCH"
      && !fight.bar.kicker && !fight.bar.hp && !fight.bar.detail,
    JSON.stringify(fight.bar));
  await page.screenshot({ path: path.join(outDir, "matriarch-fight-bar.png") });

  /* ---------------- 5a: autosave never fires mid-fight ---------------- */
  console.log("\n=== AUTOSAVE GATE ===");
  const autosave = await page.evaluate(() => {
    const T = window.__SF;
    const during = {
      fight: T.ctx.districtBosses.anyFightActive(),
      forced: T.ctx.saves.saveAuto(true, "probe-during-fight"),
      requested: T.ctx.saves.requestAutosave("probe"),
    };
    for (let i = 0; i < 120; i += 1) T.renderOnce(1 / 60);
    during.autosaveAfterTicks = !!T.ctx.saves.state().autosave
      && T.ctx.saves.state().autosave?.snapshot?.summary?.missionPhase !== undefined
      ? T.ctx.saves.state().autosave.snapshot.timestamp : null;
    // End the fight: the site reset sends her home and dormant.
    T.ctx.districtBosses.reset("reach");
    T._teleportRaw(T.ctx.districtBosses.sites.find((s) => s.key === "reach").x + 400,
      T.ctx.districtBosses.sites.find((s) => s.key === "reach").z + 200, 0);
    for (let i = 0; i < 30; i += 1) T.renderOnce(1 / 60);
    const after = {
      fight: T.ctx.districtBosses.anyFightActive(),
      forced: !!T.ctx.saves.saveAuto(true, "probe-after-fight"),
    };
    return { during, after };
  });
  console.log(`  ${JSON.stringify(autosave)}`);
  check("forced autosave is refused during the fight",
    autosave.during.fight === true && autosave.during.forced === null);
  check("autosave works again once the fight is over",
    autosave.after.fight === false && autosave.after.forced === true);

  /* ---------------- 5b: death holds; loading continues ---------------- */
  console.log("\n=== DEATH -> LOAD FLOW ===");
  const death = await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(false);
    T.ctx.combat.hurtPlayer(9999, { source: "probe-death" });
    const atDeath = { dead: T.ctx.combat.player.dead };
    // Straight through the old 3.4s respawn window and well past it.
    T.advanceTime(6.0, 1 / 60);
    const overlay = document.querySelector("[data-death]");
    const held = {
      dead: T.ctx.combat.player.dead,
      hp: T.ctx.combat.player.hp,
      overlayShown: !!overlay && !overlay.hidden,
      loadLabel: overlay?.querySelector("[data-death-load-label]")?.textContent || "",
      loadDisabled: !!overlay?.querySelector('[data-death-action="load"]')?.disabled,
    };
    return { atDeath, held };
  });
  console.log(`  ${JSON.stringify(death)}`);
  check("death holds - no automatic respawn",
    death.atDeath.dead === true && death.held.dead === true && death.held.hp === 0);
  check("the death screen is up and offers the autosave",
    death.held.overlayShown === true && death.held.loadDisabled === false,
    `label "${death.held.loadLabel}"`);
  // The overlay's fade runs on wall-clock; let it settle before the shot.
  await delay(1000);
  await page.screenshot({ path: path.join(outDir, "death-screen.png") });
  const revive = await page.evaluate(() => {
    const T = window.__SF;
    const overlay = document.querySelector("[data-death]");
    const loaded = T.ctx.saves.load("autosave", -1);
    T.advanceTime(0.8, 1 / 60);
    const after = {
      loaded,
      dead: T.ctx.combat.player.dead,
      hp: T.ctx.combat.player.hp,
      overlayShown: !!overlay && !overlay.hidden,
    };
    T.invulnerable(true);
    return after;
  });
  const after = revive;
  console.log(`  ${JSON.stringify(after)}`);
  death.after = after;
  check("loading the autosave continues the operation",
    death.after.loaded === true && death.after.dead === false && death.after.hp > 0);
  check("the death screen dismisses itself on revival",
    death.after.overlayShown === false);

  /* ---------------- reinforcements are gone ---------------- */
  console.log("\n=== REINFORCEMENTS REMOVED ===");
  const reinf = await page.evaluate(() => {
    const T = window.__SF;
    const snapshot = T.ctx.saves.capture();
    return {
      stateField: "reinforcements" in T.ctx.mission.state,
      snapshotField: snapshot ? "reinforcements" in snapshot.mission : null,
      hudEl: !!document.getElementById("sf-reinf"),
      menuCard: !!document.querySelector("[data-operation-reinforcements]"),
      deathsCard: !!document.querySelector("[data-operation-deaths]"),
    };
  });
  console.log(`  ${JSON.stringify(reinf)}`);
  check("no reinforcement state, snapshot field, HUD readout, or menu card remains",
    reinf.stateField === false && reinf.snapshotField === false
      && reinf.hudEl === false && reinf.menuCard === false && reinf.deathsCard === true,
    JSON.stringify(reinf));

  console.log("\n=== PAGE ERRORS ===");
  check("no page errors during the pass", pageErrors.length === 0, pageErrors[0] || "");

  await browser.close();
} finally {
  server.kill();
}

console.log(`\n${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`} (${results.length} total)`);
process.exit(failed === 0 ? 0 : 1);
