#!/usr/bin/env node
/* ============================================================
   SAINTFALL - leg rig probe

   Three complaints from play, all about the LEGS and none of them
   visible in a still frame:

     - the sabatons point up under the jetpack (dorsiflexed),
     - the legs "warp" climbing a steep grade,
     - the legs "warp" braking out of a run.

   `__SF.legRigCheck()` (qa.js) measures the posed bones rather than
   the targets the solver was fed, because every one of these is the
   same defect: the pose that came OUT is not a pose a leg can hold.
   This drives it on both playable bodies - Vesper on the dunes and
   White Vigil on Kenosis - since the two rigs disagree about where
   their own foot bones point and a fix that only suits one of them
   is not a fix.

   `--series <scenario>` adds a per-frame dump of one scenario to the
   JSON. A summary cannot say WHERE in a stride something happens, and
   every fault found here was identified by its phase: the ankle snap
   at the shin's wrap, the target teleport at the brake, the lateral
   flick at toe-off.

   Usage:
     node scripts/saintfall-leg-rig-probe.mjs [--out FILE]
     node scripts/saintfall-leg-rig-probe.mjs --level summit --character bastion-penitent
     node scripts/saintfall-leg-rig-probe.mjs --level summit --series climb-1.15
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const outFile = path.resolve(root, outArg >= 0
  ? process.argv[outArg + 1]
  : "output/saintfall/leg-rig-probe.json");
const levelArg = process.argv.indexOf("--level");
const which = levelArg >= 0 ? process.argv[levelArg + 1] : "both";
const seriesArg = process.argv.indexOf("--series");
const series = seriesArg >= 0 ? process.argv[seriesArg + 1] : null;
const characterArg = process.argv.indexOf("--character");
const character = characterArg >= 0 ? process.argv[characterArg + 1] : null;
const PORT = 47900 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

const LEVELS = [
  { id: "vesper", page: "games/saintfall.html", at: { x: -520, z: -562 }, radius: 260 },
  { id: "summit", page: "games/saintfall-white-vigil.html", at: { x: 0, z: 0 }, radius: 300 },
];

/* WHAT AN ANKLE CAN ACTUALLY DO, as a deviation from its own
   neutral, so one gate covers two rigs that disagree by 26 degrees
   about where their foot bones point. Walking spans about -20
   (toe-off) to +10 (heel strike); the extremes anyone can reach are
   -50 pointed and +25 pulled up. Outside -55..+30 is not a stiff
   pose, it is a broken joint. */
const DEV_MIN = -55;
const DEV_MAX = 30;
/* A knee folds to about 150 degrees, heel against the buttock, and
   a running swing peaks well short of that. */
const KNEE_MAX = 150;
/* The two-joint solver clamps rather than stretching, so a miss is
   the ankle sitting somewhere the gait does not think it is. A
   centimetre is invisible; 10cm is a floating boot. */
const MISS_LIMIT = 0.05;
/* A boot planted on a hill should lie ALONG the hill. This is the
   residual after the slope is taken out, so it stays a fixed gate
   whatever the grade is. */
const SOLE_LIMIT = 22;
/* How far a single frame's ankle step exceeds twice its neighbours',
   in the body frame. Continuous motion - however fast - has
   neighbours its own size and scores at or below zero; only a snap
   stands alone. 4cm is a snap you can see. */
const JUMP_LIMIT = 0.04;
/* How long a boot may sit in the air while the body is barely
   moving. A step lands in a fraction of a second; a third of one is
   already a pause, and anything beyond that is a leg parked. */
const HANG_LIMIT = 0.35;

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

function grade(scn) {
  const bad = [];
  if (scn.footHangS > HANG_LIMIT) bad.push(`hang ${scn.footHangS}s`);
  for (const side of ["left", "right"]) {
    const s = scn[side];
    if (!s) continue;
    if (s.ankleDevDeg[1] > DEV_MAX) bad.push(`${side} ankle +${s.ankleDevDeg[1]}deg`);
    if (s.ankleDevDeg[0] < DEV_MIN) bad.push(`${side} ankle ${s.ankleDevDeg[0]}deg`);
    if (s.maxKneeBendDeg > KNEE_MAX) bad.push(`${side} knee ${s.maxKneeBendDeg}deg`);
    if (s.maxTargetMissM > MISS_LIMIT) bad.push(`${side} miss ${s.maxTargetMissM}m`);
    if (Math.abs(s.plantedSoleMaxDeg) > SOLE_LIMIT && s.plantedSoleMaxDeg > -900) {
      bad.push(`${side} sole ${s.plantedSoleMaxDeg}deg`);
    }
    if (s.jumpM > JUMP_LIMIT) bad.push(`${side} jump ${s.jumpM}m`);
  }
  return bad;
}

async function main() {
  const server = startServer();
  let browser = null;
  const report = {};
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    for (const level of LEVELS) {
      if (which !== "both" && which !== level.id) continue;
      const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
      page.on("pageerror", (e) => console.error(`PAGE ERROR [${level.id}]`, e.message));
      const url = new URL(`${BASE}/${level.page}`);
      url.searchParams.set("qa", "1");
      url.searchParams.set("quality", "low");
      if (level.id === "summit" && character) url.searchParams.set("character", character);
      await page.goto(url.href,
        { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
      report[level.id] = await page.evaluate(
        (o) => window.__SF.legRigCheck(o),
        { at: level.at, radius: level.radius, series }
      );
      await page.close();
    }

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(report, null, 2));

    let fails = 0;
    for (const [id, res] of Object.entries(report)) {
      console.log(`\nSAINTFALL leg rig - ${id}\n` + "=".repeat(92));
      console.log(`rest pitch ${res.rig.restPitchDeg}deg  flight ankle ${res.rig.flightDevDeg}deg`
        + `  clamp ${res.rig.devLimitDeg.join("..")}deg`
        + `  reach ${res.rig.reachM.join("/")}m  ankle ${res.rig.ankleM}m`);
      console.log("scenario".padEnd(13) + "grade".padStart(6) + "travel".padStart(7)
        + "blk".padStart(5) + "ankleDev L".padStart(14) + "ankleDev R".padStart(14)
        + "knee".padStart(6) + "miss".padStart(7) + "sole".padStart(6)
        + "jump".padStart(8) + "hang".padStart(6) + "  verdict");
      for (const scn of res.scenarios) {
        if (scn.missing) { console.log(`${scn.id.padEnd(14)}  (no such grade on this map)`); continue; }
        const bad = grade(scn);
        if (bad.length) fails += 1;
        const miss = Math.max(scn.left.maxTargetMissM, scn.right.maxTargetMissM);
        const sole = Math.max(
          scn.left.plantedSoleMaxDeg > -900 ? Math.abs(scn.left.plantedSoleMaxDeg) : 0,
          scn.right.plantedSoleMaxDeg > -900 ? Math.abs(scn.right.plantedSoleMaxDeg) : 0
        );
        const pop = Math.max(scn.left.jumpM, scn.right.jumpM);
        const knee = Math.max(scn.left.maxKneeBendDeg, scn.right.maxKneeBendDeg);
        console.log(
          scn.id.padEnd(13)
          + `${scn.grade ?? "-"}`.padStart(6)
          + `${scn.travelM}`.padStart(7)
          + `${scn.blockedFrames}`.padStart(5)
          + `${scn.left.ankleDevDeg.join("..")}`.padStart(14)
          + `${scn.right.ankleDevDeg.join("..")}`.padStart(14)
          + `${knee.toFixed(0)}`.padStart(6)
          + `${miss.toFixed(3)}`.padStart(7)
          + `${sole.toFixed(0)}`.padStart(6)
          + `${pop.toFixed(4)}`.padStart(8)
          + `${scn.footHangS}`.padStart(6)
          + "  " + (bad.length ? "FAIL " + bad.join(", ") : "ok")
        );
      }
    }
    console.log("\n" + "=".repeat(92));
    console.log(`gates: ankle ${DEV_MIN}..+${DEV_MAX}deg off neutral, knee <${KNEE_MAX}deg,`
      + ` target miss <${MISS_LIMIT}m, planted sole <${SOLE_LIMIT}deg off the hill,`
      + ` ankle jump <${JUMP_LIMIT}m, foot hang <${HANG_LIMIT}s`);
    console.log(fails ? `${fails} scenario(s) FAIL` : "all scenarios pass");
    console.log(`wrote ${path.relative(root, outFile)}`);
    process.exitCode = fails ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
