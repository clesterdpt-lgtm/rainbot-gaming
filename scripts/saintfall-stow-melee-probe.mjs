#!/usr/bin/env node
/* ============================================================
   SAINTFALL - sheathing and the melee key

   Two behaviours that only exist over TIME, so a screenshot cannot
   grade either of them:

     SHEATHE. Left alone with nothing to fight, the lance should
     travel to the trooper's back - and travel, not teleport, with the
     hands letting go somewhere in the middle. Anything that looks
     like a fight should bring it back, faster than it went away.

     MELEE. One key, one swing. The lance is a ranged rite that
     borrows its melee rite for the length of the animation and hands
     it back; the failure mode is being left stuck in melee, which no
     still frame would show.

   Usage: node scripts/saintfall-stow-melee-probe.mjs [outfile.json]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.resolve(root, process.argv[2] || "output/saintfall/stow-melee-probe.json");
const PORT = 43900 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=low`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

    const result = await page.evaluate(() => {
      const T = window.__SF;
      /* The original fixed dune coordinate became obstructed as the
         world evolved, so this movement test could report bolted arms
         while the player was simply standing against collision. */
      const site = T.findFlatSite(12);
      const step = (n) => { for (let i = 0; i < n; i += 1) T.renderOnce(1 / 60); };
      const rest = () => {
        T.clearEnemies();
        T.releaseCamera();
        T.teleport(site[0], site[1], 0);
        T.weapons.setMode("ranged");
        T.setFiring(false); T.setAds(0); T.setGaitInput(0, 0);
        T.setCam(0, -0.06, 5.2);
        step(40);
      };
      const out = {};

      /* --- sheathe: idle long enough and it should go away --- */
      rest();
      const sheathe = [];
      /* Sampled every 5 frames, not every 30. The whole travel takes
         0.85s, so a half-second sample interval caught it at 0 and at
         1 and reported "the hands never released" about an animation
         that was working. */
      for (let i = 0; i < 12 * 60; i += 1) {
        T.renderOnce(1 / 60);
        if (i % 5 === 0) sheathe.push({ t: +(i / 60).toFixed(2), ...T.stowState() });
      }
      out.sheathe = sheathe;
      out.stowedAtRest = T.stowState();

      /* --- draw: firing must bring it back, and faster --- */
      const draw = [];
      T.setFiring(true);
      for (let i = 0; i < 90; i += 1) {
        T.renderOnce(1 / 60);
        if (i % 6 === 0) draw.push({ t: +(i / 60).toFixed(2), ...T.stowState() });
      }
      T.setFiring(false);
      out.draw = draw;
      out.drawnAfterFire = T.stowState();

      /* --- melee key: one press, one swing, rite handed back --- */
      rest();
      const before = T.stowState();
      T.pressMelee();
      const swing = [];
      let sawMelee = false;
      let sawAction = null;
      for (let i = 0; i < 150; i += 1) {
        T.renderOnce(1 / 60);
        const s = T.stowState();
        if (s.melee) sawMelee = true;
        if (s.action && !sawAction) sawAction = s.action;
        if (i % 10 === 0) swing.push({ t: +(i / 60).toFixed(2), melee: s.melee, action: s.action });
      }
      out.melee = {
        beforeWasMelee: before.melee,
        enteredMelee: sawMelee,
        actionPlayed: sawAction,
        afterwards: T.stowState(),
        timeline: swing,
      };

      /* --- melee while slung must draw first, not swing on air --- */
      rest();
      for (let i = 0; i < 12 * 60; i += 1) T.renderOnce(1 / 60);
      const slung = T.stowState();
      T.pressMelee();
      step(6);
      out.meleeWhileSlung = { slungPhase: slung.phase, immediately: T.stowState() };
      for (let i = 0; i < 200; i += 1) T.renderOnce(1 / 60);
      out.meleeWhileSlung.settled = T.stowState();

      /* --- arms: hanging, and SWINGING, once the lance is slung ---
         "Relaxed at the sides" is only half the ask. A trooper
         jogging with both arms bolted to his hips is the defect;
         what makes a run read as a run from the front is the arms
         opposing the legs. So measure the hands in the body frame
         across a full stride and check three things: they move, they
         move in ANTIPHASE, and they are down by the hips rather than
         up at a grip. */
      rest();
      T.setGaitInput(0, 0);
      for (let i = 0; i < 9 * 60; i += 1) T.renderOnce(1 / 60);
      const slungForRun = T.stowState();
      for (let i = 0; i < 80; i += 1) { T.setGaitInput(0, -1); T.renderOnce(1 / 60); }
      const hands = [];
      for (let i = 0; i < 150; i += 1) {
        T.setGaitInput(0, -1);
        T.renderOnce(1 / 60);
        const st = T.gaitState();
        const fig = T.figureNodes();
        const sin = Math.sin(st.yaw);
        const cos = Math.cos(st.yaw);
        const v = new T.THREE.Vector3();
        const row = { phase: +T.gaitPhase().toFixed(3) };
        for (let h = 0; h < 2; h += 1) {
          fig.handPivots[h].getWorldPosition(v);
          const dx = v.x - st.x;
          const dz = v.z - st.z;
          row[h === 0 ? "leftFore" : "rightFore"] = +(dx * sin + dz * cos).toFixed(4);
          row[h === 0 ? "leftUp" : "rightUp"] = +(v.y - st.y).toFixed(4);
        }
        hands.push(row);
      }
      T.setGaitInput(null);
      const span = (k) => {
        const vals = hands.map((r) => r[k]);
        return { min: Math.min(...vals), max: Math.max(...vals) };
      };
      const lf = span("leftFore");
      const rf = span("rightFore");
      // Antiphase: left forward when right is back.
      let opposed = 0;
      const lm = (lf.min + lf.max) / 2;
      const rm = (rf.min + rf.max) / 2;
      for (const r of hands) {
        if ((r.leftFore - lm) * (r.rightFore - rm) < 0) opposed += 1;
      }
      out.armSwing = {
        stowedWhileRunning: slungForRun.stowed,
        leftSwingM: +(lf.max - lf.min).toFixed(3),
        rightSwingM: +(rf.max - rf.min).toFixed(3),
        opposedPct: +(100 * opposed / hands.length).toFixed(1),
        handHeightM: +(span("leftUp").min).toFixed(3),
        samples: hands.length,
      };

      /* --- a threat alone should keep it drawn ---
         LAST, deliberately. Run before the melee tests, its thresher
         spent twelve seconds killing the player, and every melee
         press after that was refused by the dead check in
         `meleeStrike` - which reads exactly like the melee key being
         broken. */
      rest();
      T.spawnEnemy("thresher", site[0] + 18, site[1], {});
      for (let i = 0; i < 12 * 60; i += 1) T.renderOnce(1 / 60);
      out.withThreatNearby = T.stowState();
      T.clearEnemies();
      return out;
    });

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(result, null, 2));

    const fails = [];
    console.log("\nSAINTFALL sheathe + melee\n" + "=".repeat(72));

    console.log("SHEATHE (idle)   t     phase  release  gripFore  gripUp");
    for (const r of result.sheathe.filter((x, i) => x.phase > 0 || (i && result.sheathe[i - 1].phase === 0 && x.phase === 0 && i % 12 === 0)).slice(0, 26)) {
      console.log(`                ${String(r.t).padStart(5)}${String(r.phase).padStart(8)}`
        + `${String(r.handRelease).padStart(9)}${String(r.gripFore).padStart(10)}`
        + `${String(r.gripUp).padStart(8)}`);
    }
    if (!result.stowedAtRest.stowed) fails.push("lance never stowed while idle");
    const midway = result.sheathe.filter((r) => r.phase > 0.05 && r.phase < 0.95);
    if (!midway.length) fails.push("sheathe teleported - no frame caught mid-travel");
    if (!result.sheathe.some((r) => r.handRelease > 0.2 && r.handRelease < 0.9)) {
      fails.push("hands never released progressively during the sheathe");
    }

    const drawEnd = result.draw.findIndex((r) => r.phase <= 0.02);
    console.log(`\nDRAW: reached phase 0 after ${drawEnd >= 0 ? result.draw[drawEnd].t : "never"}s`
      + ` (sheathe is 0.85s, draw should be quicker)`);
    if (!result.drawnAfterFire || result.drawnAfterFire.phase > 0.02) {
      fails.push("firing did not draw the lance");
    }
    if (drawEnd >= 0 && result.draw[drawEnd].t > 0.62) fails.push("draw slower than the sheathe");

    console.log(`THREAT NEARBY: phase ${result.withThreatNearby.phase} `
      + `(stowed=${result.withThreatNearby.stowed}) - must stay drawn`);
    if (result.withThreatNearby.stowed) fails.push("stowed with an enemy 18m away");

    const m = result.melee;
    console.log(`\nMELEE KEY: entered melee=${m.enteredMelee} action=${m.actionPlayed} `
      + `-> afterwards melee=${m.afterwards.melee} action=${m.afterwards.action}`);
    if (m.beforeWasMelee) fails.push("started in melee mode, test invalid");
    if (!m.enteredMelee) fails.push("melee key did not enter the melee rite");
    if (!m.actionPlayed || !String(m.actionPlayed).startsWith("melee")) {
      fails.push(`melee key played "${m.actionPlayed}" instead of a melee swing`);
    }
    if (m.afterwards.melee) fails.push("left stuck in the melee rite after the swing");

    const a = result.armSwing;
    console.log(`\nARMS WHEN SLUNG: swing L ${a.leftSwingM}m / R ${a.rightSwingM}m, `
      + `opposed ${a.opposedPct}% of frames, hands at ${a.handHeightM}m`);
    if (!a.stowedWhileRunning) fails.push("lance was not slung for the arm test");
    if (a.leftSwingM < 0.12 || a.rightSwingM < 0.12) {
      fails.push(`arms barely swing (L ${a.leftSwingM}m, R ${a.rightSwingM}m) - bolted to the hips`);
    }
    if (a.opposedPct < 80) fails.push(`arms not opposed (${a.opposedPct}% of frames)`);
    if (a.handHeightM > 1.25) fails.push(`hands riding at ${a.handHeightM}m, not relaxed at the sides`);

    const ws = result.meleeWhileSlung;
    console.log(`MELEE WHILE SLUNG: phase ${ws.slungPhase} -> immediately `
      + `action=${ws.immediately.action} -> settled action=${ws.settled.action} `
      + `phase=${ws.settled.phase}`);
    if (ws.immediately.action) fails.push("swung a melee while the lance was still on the back");
    if (ws.settled.phase > 0.02) fails.push("melee press did not draw the lance");

    console.log("=".repeat(72));
    if (errors.length) fails.push(`${errors.length} page errors: ${errors[0]}`);
    if (fails.length) {
      console.log("FAIL");
      for (const f of fails) console.log(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log("sheathe, draw and the melee key all behave");
    }
    console.log(`wrote ${path.relative(root, outFile)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
