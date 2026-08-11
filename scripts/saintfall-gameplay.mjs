#!/usr/bin/env node
/* ============================================================
   SAINTFALL - gameplay verification

   Drives the real systems and asserts on what they return. "It
   boots with no console errors" is not a test of a game: collision
   that never blocks, a hitscan that never connects and a mission
   state machine that never advances all boot perfectly.

   Each check names a failure mode that has actually happened in
   something like this before:
     - collision built but never queried (player walks through walls)
     - hitscan aimed from the camera, not the muzzle (shoots own cover)
     - damage applied but death never triggered (bullet sponges)
     - stratagem code accepted but never resolved (silent no-op)
     - enemies that see through masonry (shot from inside a wall)
     - objectives that complete on proximity alone (no channel)

   Usage:
     node scripts/saintfall-gameplay.mjs
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
    .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true])
);
const OUT = path.resolve(root, args.out || "output/saintfall/gameplay");
const PORT = 48000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
let failed = 0;

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  const tag = ok ? "  PASS" : "  FAIL";
  console.log(`${tag}  ${name}`);
  if (detail) console.log(`        ${detail}`);
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

try {
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }

  const browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleErrors.push(m.text());
  });

  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize();
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  /* ---------------------------------------------------------- */
  console.log("\n=== COLLISION ===");
  const cstats = await page.evaluate(() => window.__SF.collideStats());
  console.log(`  grid: ${cstats.pages} pages · ${cstats.cells} solid cells `
    + `· rasterised from ${cstats.meshes} meshes in ${cstats.buildMs}ms`);
  check("collision builds fast enough not to hurt load", cstats.buildMs < 2500,
    `${cstats.buildMs}ms`);
  check("collision grid is populated", cstats.cells > 20000,
    `${cstats.cells} solid cells`);

  /* How much of the playable interior is impassable?
     This is the invisible-wall number. A bounding-box triangle fill
     put it at 4.27%, walling off open desert with nothing standing on
     it - which no screenshot of the game can show, because the whole
     defect is that there is nothing there. */
  const survey = await page.evaluate(() => window.__SF.blockSurvey(40000, 700));
  console.log(`  interior blocked: ${survey.blockedPct}% `
    + `(${JSON.stringify(survey.byProudHeight)})`);
  check("the playable interior is mostly passable", survey.blockedPct < 2.5,
    `${survey.blockedPct}% of ground within 700m blocks`);

  // Find real masonry in the Cathedral district and walk into it.
  const wall = await page.evaluate(() => window.__SF.walkIntoWall(-95, -725, 7, 3.0));
  console.log(`  wall found at ${wall.wallAt}: walked ${wall.movedM}m `
    + `of an unobstructed ${wall.unobstructedM}m`);
  check("a wall stops the player", wall.stopped,
    `moved ${wall.movedM}m vs ${wall.unobstructedM}m free`);
  check("player never ends up inside masonry", !wall.endedInsideSolid);

  // ...and open dune must NOT block, or the whole map is a maze.
  const open = await page.evaluate(() => window.__SF.walkInto(300, 430, 0, 3.0));
  console.log(`  open ground: walked ${open.movedM}m of ${open.unobstructedM}m`);
  check("open ground does not block", !open.stopped,
    `moved ${open.movedM}m vs ${open.unobstructedM}m free`);

  /* ---------------------------------------------------------- */
  console.log("\n=== CONTROLS ===");
  const ctl = await page.evaluate(() => window.__SF.controlCheck());
  for (const k of ["W", "S", "A", "D"]) {
    console.log(`  ${k}: forward ${String(ctl[k].forward).padStart(6)} · `
    + `right ${String(ctl[k].right).padStart(6)}   (camera-space)`);
  }
  console.log(`  drag right -> view swings ${ctl.mouse.dragRight.swungRight} `
    + `toward screen-right · drag down -> tilts ${ctl.mouse.dragDown.tiltedY} in Y`);
  check("W moves forward", ctl.W.forward > 1, `forward ${ctl.W.forward}`);
  check("S moves backward", ctl.S.forward < -1, `forward ${ctl.S.forward}`);
  check("A strafes left", ctl.A.right < -1, `right ${ctl.A.right}`);
  check("D strafes right", ctl.D.right > 1, `right ${ctl.D.right}`);
  check("dragging right turns right", ctl.mouse.turnsRight,
    `view swung ${ctl.mouse.dragRight.swungRight} toward screen-right`);
  check("dragging down looks down", ctl.mouse.looksDown,
    `view tilted ${ctl.mouse.dragDown.tiltedY} in Y`);

  /* Blocks with nothing visible standing at them - the actual
     definition of an invisible wall, as opposed to "collision is
     wrong somewhere". */
  const inv = await page.evaluate(() => window.__SF.invisibleWallScan(20000, 900));
  console.log(`  blocked ${inv.blocked} samples · ${inv.invisible} with nothing `
    + `visible (${inv.pct}%) · ${JSON.stringify(inv.byMesh)}`);
  check("few blocks have nothing visible at them", inv.pct < 15,
    `${inv.pct}% of blocked samples`);

  /* Can the player leave the road? The reported symptom was a
     corridor down the middle of the map, and that is a statement
     about MOBILITY - not about any one gate - so it is measured by
     walking, far enough to actually reach the flanks. */
  const trav = await page.evaluate(() => window.__SF.traverseScan(20, 40));
  console.log(`  perpendicular traverses: median ${trav.medianM}m of `
    + `${trav.unobstructedM}m unobstructed · ${trav.badlyBlocked}/${trav.runs} badly blocked`);
  check("the player can walk off the road", trav.badlyBlocked <= trav.runs * 0.25,
    `${trav.badlyBlocked} of ${trav.runs} traverses stopped early`);
  check("a typical traverse covers real ground", trav.medianM > trav.unobstructedM * 0.7,
    `median ${trav.medianM}m`);

  /* ---------------------------------------------------------- */
  console.log("\n=== AUDIO ===");
  const audio = await page.evaluate(async () => await window.__SF.audioCheck());
  if (audio.error) {
    check("audio graph renders", false, audio.error);
  } else {
    const silent = Object.entries(audio).filter(([, v]) => !v.audible).map(([k]) => k);
    for (const [name, v] of Object.entries(audio)) {
      console.log(`  ${name.padEnd(12)} peak ${v.peak}`);
    }
    check("every sound produces signal", silent.length === 0,
      silent.length ? `silent: ${silent.join(", ")}` : `${Object.keys(audio).length} sounds`);
    // The gunshot is the sound the player hears most; if an impact or
    // a footstep is louder than it, the mix is inverted.
    check("the gunshot sits above the incidental sounds",
      audio.shot.peak > audio.impact.peak && audio.shot.peak > audio.step.peak,
      `shot ${audio.shot.peak} vs impact ${audio.impact.peak}, step ${audio.step.peak}`);
    check("a stratagem is the loudest thing on the field",
      audio.explosion.peak > audio.shot.peak,
      `explosion ${audio.explosion.peak} vs shot ${audio.shot.peak}`);
  }

  /* ---------------------------------------------------------- */
  console.log("\n=== WEAPON AND DAMAGE ===");
  /* The limiter, not a magazine. Three things have to be true for
     "infinite ammo with an overheat" to actually be that: it starts
     cold, sustained fire eventually locks it, and it comes back on
     its own without any resupply. The third is the one that would
     quietly turn this back into ammunition if it broke. */
  const heat = await page.evaluate(async () => {
    const T = window.__SF;
    T.teleport(655, 700, 0);
    T.advanceTime(0.5, 1 / 60);
    const start = T.weapons.heatState();
    // Hold the trigger until it locks, or give up after 12s.
    let shots = 0;
    let lockedAfter = -1;
    for (let i = 0; i < 720 && lockedAfter < 0; i += 1) {
      if (T.weapons.fire()) shots += 1;
      T.advanceTime(1 / 60, 1 / 60);
      if (T.weapons.heatState().overheated) lockedAfter = i / 60;
    }
    const locked = T.weapons.heatState();
    // Now stop shooting and let it cool with no intervention.
    let freeAfter = -1;
    for (let i = 0; i < 900 && freeAfter < 0; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      if (!T.weapons.heatState().overheated) freeAfter = i / 60;
    }
    const recovered = T.weapons.heatState();
    const fired = T.weapons.fire();
    return { start, shots, lockedAfter, locked, freeAfter, recovered, fired };
  });
  console.log(`  starts at ${Math.round(heat.start.heat * 100)}% heat · `
    + `${heat.shots} rounds and ${heat.lockedAfter.toFixed(1)}s of held trigger to lock`);
  console.log(`  unlocks ${heat.freeAfter.toFixed(1)}s later at `
    + `${Math.round(heat.recovered.heat * 100)}%, with no resupply`);
  check("weapon starts cold", heat.start.heat === 0 && !heat.start.overheated);
  check("sustained fire overheats it", heat.lockedAfter > 0.5 && heat.lockedAfter < 8,
    `locked after ${heat.lockedAfter.toFixed(1)}s and ${heat.shots} rounds`);
  check("it cools on its own and fires again", heat.freeAfter > 0 && heat.fired,
    `free after ${heat.freeAfter.toFixed(1)}s, next shot ${heat.fired}`);

  const engage = await page.evaluate(() => {
    const e = window.__SF.enemies.live.find((x) => x.state !== "death");
    window.__SF.teleport(e.x + 20, e.z + 20, 0);
    window.__SF.advanceTime(0.4, 1 / 60);
    return window.__SF.engage(40, 18);
  });
  console.log(`  ${engage.key} at ${engage.rangeM}m: ${engage.hits}/${engage.shots} hits `
    + `(${engage.accuracy}%), hp ${engage.hpBefore} -> ${engage.hpAfter}`);
  check("aimed shots connect reliably", engage.accuracy >= 70,
    `${engage.hits} of ${engage.shots} aimed shots (${engage.accuracy}%)`);
  check("hits reduce enemy health", engage.hpAfter < engage.hpBefore);
  check("enough damage kills", engage.killed && engage.killsDelta === 1,
    `killed=${engage.killed} killsDelta=${engage.killsDelta}`);

  /* ---------------------------------------------------------- */
  console.log("\n=== ENEMY BEHAVIOUR ===");
  const fight = await page.evaluate(() => {
    const T = window.__SF;
    const e = T.enemies.live.find((x) => x.state !== "death");
    /* Hearing wakes a garrison, but cover must no longer authorise a
       shot. Choose a nearby open point with a clear full-height ray
       so this gate measures enemy damage rather than whether the
       arbitrary +5,+5 point happened to sit behind world geometry. */
    let site = null;
    for (const radius of [7, 9, 12]) {
      for (let i = 0; i < 16 && !site; i += 1) {
        const a = i * Math.PI / 8;
        const x = e.x + Math.cos(a) * radius;
        const z = e.z + Math.sin(a) * radius;
        const y = T.collide.groundHeight(x, z);
        if (T.collide.blocked(x, z, y)) continue;
        const fromY = e.y + 1.7;
        const toY = y + 1.35;
        const dx = x - e.x;
        const dy = toY - fromY;
        const dz = z - e.z;
        const distance = Math.hypot(dx, dy, dz);
        if (T.collide.rayBlock(e.x, fromY, e.z,
          dx / distance, dy / distance, dz / distance, distance) < distance - 0.05) continue;
        site = [x, z];
      }
      if (site) break;
    }
    T.teleport(...(site || [e.x + 5, e.z + 5]), 0);
    T.combat.player.hp = 100;
    return { ...T.takeFire(9), clearSite: site };
  });
  console.log(`  hp ${fight.hpBefore} -> ${fight.hpAfter}, ${fight.alerted} units alerted, `
    + `nearest closed to ${fight.closedToM}m`);
  check("standing in a garrison alerts it", fight.alerted > 0,
    `${fight.alerted} alerted`);
  check("enemies damage the player", fight.tookDamage,
    `hp ${fight.hpBefore} -> ${fight.hpAfter}`);

  /* ----------------------------------------------------------
     RESET THE RUN before anything below here.

     Everything above this line is about whether the garrison can hurt
     you, and it can - the checks kill the subject on purpose. Every
     death costs a reinforcement, and once the level was garrisoned
     properly the subject burned all five of them in the combat
     section. At that point `mission.state.phase` is "lost", and the
     very first line of `mission.update` is an early return.

     That one early return failed seven checks below, in two sections,
     none of which are about dying: no relay could channel, and the
     orbital beacon could not even resolve, because resolving it is
     something mission.update does. Seven false failures are more than
     enough to hide a real one. */
  await page.evaluate(() => {
    const T = window.__SF;
    T.invulnerable(true);
    const s = T.mission.state;
    s.phase = "relays";
    s.deaths = 0;
    s.reinforcements = 5;
    s.countedDeath = false;
  });

  console.log("\n=== STRATAGEMS ===");
  for (const key of ["orbital", "resupply"]) {
    const st = await page.evaluate((k) => {
      const T = window.__SF;
      T.combat.player.dead = false;
      if (k === "resupply") T.combat.player.hp = 30;
      else {
        T.combat.player.hp = 100;
        const e = T.enemies.live.find((x) => x.state !== "death");
        // The beacon is thrown along the LOOK direction, so the test
        // has to aim at the target the way a player would - standing
        // near it is not the same as throwing at it.
        if (e) {
          T.teleport(e.x - 24, e.z, 0);
          const ps = T.player.state;
          ps.camYaw = Math.atan2(e.x - ps.x, e.z - ps.z);
          ps.yaw = ps.camYaw;
        }
      }
      return T.stratagem(k);
    }, key);
    console.log(`  ${st.name}: accepted=${st.accepted} cooldown=${st.onCooldown}s `
      + `live ${st.liveBefore} -> ${st.liveAfter}, hp ${st.hpBefore} -> ${st.playerHp}`);
    check(`${key} code is accepted`, st.accepted);
    check(`${key} goes on cooldown`, st.onCooldown > 0);
    if (key === "orbital") {
      check("orbital lance kills what it lands on", st.liveAfter < st.liveBefore,
        `${st.liveBefore} -> ${st.liveAfter} live`);
    } else {
      check("resupply restores the player", st.playerHp > st.hpBefore,
        `hp ${st.hpBefore} -> ${st.playerHp}`);
    }
  }
  const rejected = await page.evaluate(() => {
    window.__SF.mission.beginEntry();
    window.__SF.mission.pushDirection("left");
    window.__SF.mission.pushDirection("left");
    return { active: window.__SF.mission.entry.active };
  });
  check("an invalid code is rejected", !rejected.active);

  /* ---------------------------------------------------------- */
  console.log("\n=== MISSION ===");
  const before = await page.evaluate(() => window.__SF.missionState());
  console.log(`  start: phase=${before.phase} relays=${before.relays}`);

  // Proximity alone must not complete an objective.
  const brush = await page.evaluate(() => {
    const r = window.__SF.mission.relays[0];
    window.__SF.teleport(r.x + 2, r.z + 2, 0);
    window.__SF.advanceTime(1.2, 1 / 60);
    return { progress: Number(r.progress.toFixed(2)), done: r.done };
  });
  check("a relay is not completed by walking past it",
    !brush.done && brush.progress > 0 && brush.progress < 1,
    `progress ${brush.progress} after 1.2s of a 7.5s channel`);

  for (let i = 0; i < 3; i += 1) {
    const rel = await page.evaluate((n) => window.__SF.channelRelay(n), i);
    console.log(`  ${rel.name}: done=${rel.done} (${rel.relaysDone}) phase=${rel.phase}`);
    check(`relay ${i + 1} can be silenced`, rel.done);
  }

  const after = await page.evaluate(() => {
    const T = window.__SF;
    const s = T.missionState();
    return { ...s, extractCalled: T.mission.state.extractCalled };
  });
  console.log(`  after: phase=${after.phase} relays=${after.relays}`);
  check("silencing all relays opens extraction", after.phase === "extract",
    `phase=${after.phase}`);

  const extract = await page.evaluate(() => {
    const T = window.__SF;
    T.teleport(T.mission.extract.x, T.mission.extract.z, 0);
    T.advanceTime(2.0, 1 / 60);
    return {
      called: T.mission.state.extractCalled,
      timer: Math.round(T.mission.state.extractTimer),
      alerted: T.enemies.live.filter((e) => e.suspicion > 0.5).length,
    };
  });
  console.log(`  extraction called=${extract.called} timer=${extract.timer}s `
    + `· ${extract.alerted} units converging`);
  check("reaching the pad calls the shuttle", extract.called);
  check("calling extraction wakes the map", extract.alerted > 0,
    `${extract.alerted} units alerted`);

  /* ---------------------------------------------------------- */
  console.log("\n=== STABILITY ===");
  const perf = await page.evaluate(() => {
    const T = window.__SF;
    T.teleport(-655, -655, 0);              // into the Bloom, mid-garrison
    T.advanceTime(4, 1 / 60);
    const t0 = performance.now();
    for (let i = 0; i < 240; i += 1) T.renderOnce(1 / 60);
    const ms = (performance.now() - t0) / 240;
    return { frameMs: Number(ms.toFixed(2)), ...T.combatState(), calls: T.report().render.calls };
  });
  console.log(`  in-fight frame ${perf.frameMs}ms · ${perf.calls} calls `
    + `· ${perf.live} live · hp ${perf.hp}`);
  check("frame time under load stays playable", perf.frameMs < 8,
    `${perf.frameMs}ms in a garrison`);
  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  const shot = await page.evaluate(() => window.__SF.captureDataURL());
  await writeFile(path.join(OUT, "in-fight.png"),
    Buffer.from(shot.slice(shot.indexOf(",") + 1), "base64"));

  await writeFile(path.join(OUT, "report.json"),
    JSON.stringify({ results, pageErrors, consoleErrors }, null, 2));

  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed) process.exitCode = 1;
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
