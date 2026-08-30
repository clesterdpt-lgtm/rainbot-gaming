#!/usr/bin/env node
/* ============================================================
   SAINTFALL - elbow inversion sweep

   Reported from play: the arms read correctly with the reticle
   forward and the elbows turn inside-out at other bearings. That is
   the two-joint solver's bend axis degenerating - `cross(dir, pole)`
   loses its direction as the pole swings parallel to the
   shoulder-to-wrist line, and flips sign as it passes through.

   A still frame at one bearing cannot catch it, and neither can the
   carry-pose gate, which only ever photographs the reticle straight
   ahead. This drives the aim over a full sphere and watches the
   elbow for two things:

     SIDE     - which side of the shoulder-wrist axis the elbow sits
                on, as a signed quantity. It must not change sign
                between neighbouring bearings.
     JUMP     - how far the elbow moves between adjacent samples. An
                inversion is a large jump with a tiny input change.

   Usage: node scripts/saintfall-elbow-sweep.mjs [outfile.json]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outFile = path.resolve(root,
  args.find((a) => !a.startsWith("--")) || "output/saintfall/elbow-sweep.json");
/* `--pitches=-5,25` cuts the sweep to named rows. The full sphere is
   a slow gate; a single row is the loop you want while chasing one
   bearing. */
/* `--commit=fire|low|both`. The carry has two regimes and they pose
   the arms differently: committed, the lance tracks the reticle; at
   low ready it eases back to the body's own facing while the elbow
   pole is still rotated by the camera pitch. An earlier version of
   this swept only the committed one, passed, and missed an inversion
   the player was looking straight at. */
const commitArg = args.find((a) => a.startsWith("--commit="));
const COMMITS = {
  fire: [true], low: [false], both: [true, false],
}[commitArg ? commitArg.slice(9) : "both"] || [true, false];
const pitchArg = args.find((a) => a.startsWith("--pitches="));
const PITCHES = pitchArg
  ? pitchArg.slice(10).split(",").map(Number)
  : [-55, -45, -35, -25, -15, -5, 5, 15, 25, 35, 45, 55];
const PORT = 42600 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

// An elbow that moves more than this between 10-degree neighbours is
// not tracking the aim, it is snapping.
const JUMP_LIMIT_M = 0.11;

/* ANATOMY, not just continuity. Three earlier passes of this sweep
   were green while the elbow read as inverted in play, because every
   number here measured whether the arms moved SMOOTHLY and none of
   them asked which way the bend pointed. These do.

   `fore` in the recorded rows is the forward component of the elbow's
   perpendicular offset from the shoulder-wrist line, in the body's
   own frame - the direction the bend kinks. A right elbow folds
   BACKWARD; a forward kink is the "bending the wrong way" read.

   The bound is regime-aware because the anatomy is:
   - LOW READY the arm hangs to a grip at the hip and the bend must
     never kink forward. Measured envelope -0.075..-0.004 across all
     432 bearings; the gate allows +0.02.
   - COMMITTED the arm follows the weapon. Raising the aim brings the
     elbow forward UNDER the hand - reach upward and watch your own
     arm do it - and the chest-twist hysteresis carries the grip
     across the body, so forward kink up to a sanity ceiling is
     correct there, not a defect. What is never correct in either
     regime is the elbow crossing INBOARD of the arm line toward the
     sternum: lat must stay negative for the right arm. */
const LOWREADY_KINK_FWD_MAX = 0.02;
/* 0.32, not 0.30: the wrist-bend cap re-seats the palm a few cm up
   the forearm, and the steep-down reach at pitch 55 measures 0.301.
   Forward under the hand is the correct posture for that reach, and
   1mm over an uncalibrated ceiling is not a defect. */
const COMMITTED_KINK_FWD_MAX = 0.32;
const TRIGGER_LAT_MAX = -0.03;
/* HOW MUCH OF THE AUTHORED POLE SURVIVES being made square to the
   arm: sqrt(1 - (pole . armAxis)^2). This is the length of the part
   that actually chooses where the elbow goes.

   It replaced a floor on `perp` (= 1 - |dot|) once the solve started
   flattening its poles. `perp` used to describe what the solver
   received; now the solver always receives a perpendicular pole and
   `perp` only describes how far the authored one had leaned, so a
   floor on it is no longer the same claim. This is, and it separates
   the three cases cleanly:

     0.154  the trigger pole that inverted at every off-forward aim
     0.525  the blended pole half way through the sheathe (jumping)
     0.495  a legitimate steep-down committed aim after the wrist cap
            re-seated the palms - NOT jumping: the flatten still hands
            the solver a clean choice and the jump gate stays green

   So the floor can no longer sit between the failures and health;
   the two sides overlap. PER REGIME, like the kink gate, because the
   regimes genuinely differ: at low ready the pose is authored and the
   pole should keep real leverage (measured 0.52+); committed, the
   straight-wrist seat walks the wrist far up the forearm and the
   steep-down reach at pitch 45-55 legitimately thins to 0.29 with the
   jump gate green at every one of those bearings - the flatten still
   hands the solver a clean choice, and the JUMP gate above is the
   detector of an elbow actually misbehaving. This one is the canary
   that says the authored pose is running out of leverage. */
const POLE_SURVIVAL_FLOOR_LOWREADY = 0.45;
const POLE_SURVIVAL_FLOOR_COMMITTED = 0.25;

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

    const rows = await page.evaluate(([PITCHES, COMMITS]) => {
      const T = window.__SF;
      const THREE = T.THREE;
      T.clearEnemies();
      T.releaseCamera();
      T.teleport(-520, -562, 0);
      T.autoStow(false);
      T.weapons.setMode("ranged");
      T.setGaitInput(0, 0);
      for (let i = 0; i < 90; i += 1) T.renderOnce(1 / 60);

      const dbg = T.armSolveDebug(true);
      const fig = T.figureNodes();
      const shoulder = new THREE.Vector3();
      const elbow = new THREE.Vector3();
      const wrist = new THREE.Vector3();
      const axis = new THREE.Vector3();
      const arm = new THREE.Vector3();
      const out = [];
      /* Sampled finely (10 degrees) because the failure is a
         discontinuity: a coarse sweep steps over it and reports two
         perfectly good poses either side. */
      const yaws = [];
      for (let y = -180; y < 180; y += 10) yaws.push(y);
      let first = true;
      for (const firing of COMMITS) {
      T.setFiring(firing);
      for (let i = 0; i < 120; i += 1) T.renderOnce(1 / 60);
      for (const pitchDeg of PITCHES) {
        /* SERPENTINE, alternating direction each row. Sweeping every
           row left-to-right looks tidier and is wrong: restarting at
           -180 after finishing at +170 asks the body to spin 350
           degrees between two samples, and the trooper is still
           turning when the next one is taken. That showed up as the
           only two failures left after the poles were fixed - a
           property of the probe, not of the rig. Reversing alternate
           rows keeps every move to 10 degrees. Order does not affect
           the analysis below, which sorts by bearing. */
        const order = (PITCHES.indexOf(pitchDeg) % 2) ? yaws.slice().reverse() : yaws;
        for (const yawDeg of order) {
          T.setCam(yawDeg * Math.PI / 180, pitchDeg * Math.PI / 180);
          /* Settled TO CONVERGENCE, not for a fixed count.

             The trooper turns toward a new bearing at a capped rate,
             and 10 degrees of bearing takes about as long as a fixed
             40-frame settle allowed - so the body was still moving in
             every sample, lagging the sweep by a bearing or two. With
             the rows serpentined that lag reverses direction each
             row, and comparing the two ends of a row then measured
             twice the lag rather than the pose. It looked exactly
             like an inversion at the +-180 seam.

             Waiting for the body to actually stop removes the sweep's
             own motion from the measurement. */
          let prev = 1e9;
          for (let i = 0; i < (first ? 900 : 600); i += 1) {
            T.renderOnce(1 / 60);
            if (i % 10 !== 9) continue;
            const y = T.gaitState().yaw;
            if (Math.abs(Math.atan2(Math.sin(y - prev), Math.cos(y - prev))) < 1e-4) break;
            prev = y;
          }
          first = false;
          const aim = T.aimCommitState();
          const row = {
            yawDeg, pitchDeg, firing, arms: [],
            bodyYawDeg: aim.bodyYawDeg, twistDeg: aim.chestTwistDeg, commit: aim.commit,
          };
          for (let a = 0; a < 2; a += 1) {
            fig.armPivots[a].getWorldPosition(shoulder);
            fig.elbowPivots[a].getWorldPosition(elbow);
            fig.handPivots[a].getWorldPosition(wrist);
            arm.copy(wrist).sub(shoulder);
            const armLen = arm.length();
            if (armLen > 1e-6) arm.divideScalar(armLen);
            // Elbow offset from the shoulder-wrist axis, in the
            // figure's own frame, so "which side" is meaningful.
            axis.copy(elbow).sub(shoulder);
            axis.addScaledVector(arm, -axis.dot(arm));
            const s = T.gaitState();
            const sin = Math.sin(s.yaw);
            const cos = Math.cos(s.yaw);
            row.arms.push({
              lat: +(axis.x * cos - axis.z * sin).toFixed(4),
              fore: +(axis.x * sin + axis.z * cos).toFixed(4),
              up: +axis.y.toFixed(4),
              ex: +elbow.x.toFixed(4), ey: +elbow.y.toFixed(4), ez: +elbow.z.toFixed(4),
              bend: +(axis.length()).toFixed(4),
              /* 1 - |pole . armAxis|. This is the conditioning of the
                 whole solve: near 0 the pole lies along the arm and
                 cannot say which way the elbow points. */
              perp: +dbg[a].perp.toFixed(4),
              // The wrist the solver was asked for, so a moved target
              // can be told apart from an elbow that span on its own.
              wx: +dbg[a].wx.toFixed(4), wy: +dbg[a].wy.toFixed(4), wz: +dbg[a].wz.toFixed(4),
            });
          }
          out.push(row);
        }
      }
      }
      T.setFiring(false);
      return out;
    }, [PITCHES, COMMITS]);

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(rows, null, 2));

    /* Neighbours in yaw at the same pitch, ALONG THE SWEEP - which is
       what a player does with the mouse. A jump between them is the
       signature: 10 degrees of aim cannot legitimately move an elbow
       a tenth of a metre.

       The two ends of a row are deliberately NOT compared, though
       they are 10 degrees apart in bearing. The chest absorbs up to
       MAX_CHEST_TWIST before the legs come round, so where the body
       is standing depends on which way the aim arrived: sweeping to
       -180 leaves it lagging one way, arriving at +170 leaves it
       lagging the other, and the arms sit at opposite ends of the
       twist band. That is the hysteresis working, and comparing
       across it measured 400mm of it as an inversion. Both sweep
       directions are still covered - the rows serpentine. */
    const fails = [];
    const worst = [{ jump: 0 }, { jump: 0 }];
    const byPitch = new Map();
    for (const r of rows) {
      const key = `${r.firing ? "firing" : "low ready"}@${r.pitchDeg}`;
      if (!byPitch.has(key)) byPitch.set(key, []);
      byPitch.get(key).push(r);
    }
    for (const [key, list] of byPitch) {
      const pitchDeg = key;
      list.sort((a, b) => a.yawDeg - b.yawDeg);
      for (let i = 0; i < list.length - 1; i += 1) {
        const cur = list[i];
        const next = list[i + 1];
        for (let a = 0; a < 2; a += 1) {
          const p = cur.arms[a];
          const q = next.arms[a];
          /* Compared in the BODY frame, not world. Committing to a
             bearing turns the whole trooper, so a world-space elbow
             legitimately travels metres across a yaw sweep - the
             first run of this reported 146 "jumps" that were just
             the body rotating. The offset from the shoulder-wrist
             axis is rotation-invariant and is what inverting
             actually changes. */
          const jump = Math.hypot(q.lat - p.lat, q.fore - p.fore, q.up - p.up);
          if (jump > worst[a].jump) {
            worst[a] = { jump, pitchDeg, fromYaw: cur.yawDeg, toYaw: next.yawDeg };
          }
          if (jump > JUMP_LIMIT_M) {
            fails.push(`${a === 0 ? "support" : "trigger"} elbow jumped `
              + `${(jump * 1000).toFixed(0)}mm between yaw ${cur.yawDeg} and ${next.yawDeg} `
              + `at pitch ${pitchDeg}`);
          }
          /* The cause, not just the symptom. A 10-degree sample can
             step clean over an inversion and report two good poses
             either side, but a pole collapsing onto the arm axis is
             visible at every bearing. This is the number that was
             0.012 when the elbow was spinning. */
          if (a === 1) {
            const kinkMax = cur.firing
              ? COMMITTED_KINK_FWD_MAX : LOWREADY_KINK_FWD_MAX;
            if (p.fore > kinkMax) {
              fails.push(`trigger elbow kinks ${(p.fore * 1000).toFixed(0)}mm `
                + `FORWARD of the arm at yaw ${cur.yawDeg} `
                + `${cur.firing ? "committed" : "low ready"} pitch ${cur.pitchDeg} `
                + `- an elbow folds backward`);
            }
            /* Regime-aware, like the kink bound: at low ready the
               elbow rides deeply outboard (measured -0.168 at the
               closest), while a steep committed reach rotates the
               bend plane toward pure-backward and the LATERAL
               component legitimately thins to -0.007. The claim that
               is never allowed to fail is lat > 0: the elbow on the
               sternum side of its own arm. */
            const latMax = cur.firing ? 0 : TRIGGER_LAT_MAX;
            if (p.lat > latMax) {
              fails.push(`trigger elbow crosses INBOARD (${(p.lat * 1000).toFixed(0)}mm) `
                + `at yaw ${cur.yawDeg} pitch ${cur.pitchDeg}`);
            }
          }
          const survives = Math.sqrt(Math.max(0, 1 - (1 - p.perp) ** 2));
          const survivalFloor = cur.firing
            ? POLE_SURVIVAL_FLOOR_COMMITTED : POLE_SURVIVAL_FLOOR_LOWREADY;
          if (survives < survivalFloor) {
            fails.push(`${a === 0 ? "support" : "trigger"} pole has only `
              + `${survives.toFixed(3)} of itself left square to the arm at `
              + `yaw ${cur.yawDeg} pitch ${pitchDeg} - it barely places the elbow`);
          }
        }
      }
    }

    console.log("\nSAINTFALL elbow sweep\n" + "=".repeat(64));
    console.log(`${rows.length} samples: ${COMMITS.length} carry regime(s) `
      + `x ${PITCHES.length} pitches x 36 bearings x 2 arms`);
    for (const firing of COMMITS) {
      for (let a = 0; a < 2; a += 1) {
        const v = rows.filter((r) => r.firing === firing)
          .map((r) => Math.sqrt(Math.max(0, 1 - (1 - r.arms[a].perp) ** 2)));
        if (!v.length) continue;
        v.sort((x, y) => x - y);
        console.log(`  ${(firing ? "firing" : "low ready").padEnd(10)} `
          + `${a === 0 ? "support" : "trigger"}: pole keeps `
          + `${v[0].toFixed(3)}..${v[v.length - 1].toFixed(3)} of itself square`);
      }
    }
    for (let a = 0; a < 2; a += 1) {
      const w = worst[a];
      console.log(`${a === 0 ? "support" : "trigger"}: worst neighbour jump `
        + `${(w.jump * 1000).toFixed(0)}mm`
        + (w.fromYaw !== undefined ? ` (yaw ${w.fromYaw}->${w.toYaw}, pitch ${w.pitchDeg})` : ""));
    }
    for (let a = 0; a < 2; a += 1) {
      const v = rows.map((r) => Math.sqrt(Math.max(0, 1 - (1 - r.arms[a].perp) ** 2)))
        .sort((x, y) => x - y);
      console.log(`${a === 0 ? "support" : "trigger"}: pole keeps `
        + `${v[0].toFixed(3)}..${v[v.length - 1].toFixed(3)} of itself square `
        + `(floors ${POLE_SURVIVAL_FLOOR_LOWREADY} low ready / ${POLE_SURVIVAL_FLOOR_COMMITTED} committed)`);
    }
    console.log("=".repeat(64));
    if (errors.length) fails.push(`${errors.length} page errors: ${errors[0]}`);
    if (fails.length) {
      console.log("FAIL");
      for (const f of fails.slice(0, 12)) console.log(`  - ${f}`);
      if (fails.length > 12) console.log(`  ... and ${fails.length - 12} more`);
      process.exitCode = 1;
    } else {
      console.log(`no elbow moves more than ${JUMP_LIMIT_M * 1000}mm between neighbouring bearings`);
    }
    console.log(`wrote ${path.relative(root, outFile)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
