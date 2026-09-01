#!/usr/bin/env node
/* ============================================================
   SAINTFALL - braced stance probe (boost / skid)

   "The legs cross while boosting backwards, usually when firing
   forward and boosting back."

   Every braced-leg solver in player.js - the ground boost, the
   downhill skid, the pierce - rebuilds both foot targets from the
   TRAVEL direction each frame, including the left/right stance
   offset. That is correct only while the body faces the way it is
   going. Firing detaches the two: the aim owns the pelvis, the stick
   owns the travel, and a backward boost puts the travel frame 180
   degrees off the body. The stance offset then places the LEFT boot
   on the body's RIGHT - crossed legs, boots pointing backwards under
   a forward-facing trooper, and knees poled the wrong way.

   None of that is a picture, so none of it is judged by eye here:

     footGap    right ankle lateral MINUS left ankle lateral, in the
                BODY frame. Negative is literally crossed.
     ownSide    the smaller of side*lateral over both boots. Below
                zero the boot is across the midline.
     toeDot     the boot's own toe direction against the body's
                forward, in the XZ plane. Negative is a sabaton on
                backwards.
     kneeFore   the knee's offset from the hip-ankle chord, along
                the body forward. Negative is a knee bending
                BACKWARDS.
     jump       the largest one-frame ankle move measured in the
                BODY frame, so 27m/s of honest translation does not
                register as a snap. Guards the fix itself: a stance
                clamp that pops is a new defect.

   `--shots` adds one front-quarter still per interesting drive. It
   detaches the camera to take them, and a detached camera is one of
   the things `boost.blocked()` refuses to glide through, so a shot
   ENDS the drive it was taken in - the run is still measured, on
   fewer frames. Take the numbers from a plain run and the pictures
   from a `--shots` one rather than reading both off the same line.

   Usage:
     node scripts/saintfall-brace-stance-probe.mjs
     node scripts/saintfall-brace-stance-probe.mjs --character white-vigil
     node scripts/saintfall-brace-stance-probe.mjs --tag before --shots
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const tag = arg("--tag", "now");
const wantShots = process.argv.includes("--shots");
const shotDir = path.resolve(root, arg("--shot-dir", "output/saintfall/brace-stance-shots"));
/* Which drives are worth looking at. A number can say the ankles are
   0.34m apart on the wrong sides; only a picture says whether what
   is left looks like a person. */
const SHOT_CASES = new Set(["boost-fwd", "boost-back", "skid-back"]);
const only = arg("--character", null);
const outFile = path.resolve(root, arg("--out", `output/saintfall/brace-stance-${tag}.json`));
const PORT = 46100 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

const FIGURES = [
  { id: "vesper-reliquary", page: "/games/saintfall.html" },
  { id: "white-vigil", page: "/games/saintfall.html" },
  { id: "bastion-penitent", page: "/games/saintfall.html" },
];

/* The stick, the trigger, and what the case is called. `fire` is what
   splits the body from its travel: without it the trooper simply
   turns around and every one of these reduces to a forward boost. */
/* `commit` is HOW the body is detached from its travel. Sights are
   the portable one: every saint can hold them, and holding them
   starts no action, whereas the Bastion's trigger starts a hammer
   swing and a swing refuses to boost at all - which is a rule, not a
   defect, so that case is reported as skipped rather than failed. */
const CASES = [
  { id: "boost-fwd", x: 0, y: -1, commit: "ads" },
  { id: "boost-back", x: 0, y: 1, commit: "ads" },
  { id: "boost-back-fire", x: 0, y: 1, commit: "fire" },
  { id: "boost-back-cold", x: 0, y: 1, commit: "none" },
  { id: "boost-strafe", x: 1, y: 0, commit: "ads" },
  { id: "boost-diag-back", x: 0.7, y: 0.7, commit: "ads" },
  /* The OTHER braced solver. A steep dune retreat holds the same
     shape - the boots ride with the body instead of stepping - and
     had the same travel-frame stance, so it crossed in exactly the
     same place. */
  { id: "skid-back", verb: "skid", x: 0, y: 1, commit: "ads" },
];

/* What a leg may not do, whatever the travel frame is saying. */
const GATES = {
  footGap: 0.09,      // m, ankles apart across the midline
  ownSide: 0.02,      // m, each boot outboard of the centreline
  toeDot: 0.30,       // boots within ~72deg of the body's own forward
  kneeFore: -0.005,   // m, knees do not bend backwards
  jump: 0.30,         // m per frame, in the body frame
};

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; }
    catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* ---- everything below runs IN THE PAGE ---- */
function inPage(job) {
  const T = window.__SF;
  const p = T.player;
  const THREE = T.THREE;
  const fig = p.figure;
  const v = () => new THREE.Vector3();
  const a = v(); const b = v(); const c = v(); const d = v(); const e = v();
  const q = new THREE.Quaternion();

  const ground = (x, z) => (T.ctx?.collide?.groundHeight
    ? T.ctx.collide.groundHeight(x, z)
    : p.groundY(x, z));

  /* A flat, open lane long enough for a 27m/s burst to live on. A
     boost that runs into a boulder measures the collision resolver,
     not the stance. */
  function findLane() {
    let best = null;
    for (let ring = 14; ring <= 300; ring += 13) {
      for (let k = 0; k < 20; k += 1) {
        const ang = (k / 20) * Math.PI * 2 + ring * 0.29;
        const x = Math.cos(ang) * ring;
        const z = Math.sin(ang) * ring;
        const h = ground(x, z);
        if (!Number.isFinite(h)) continue;
        for (let s = 0; s < 16; s += 1) {
          const yaw = (s / 16) * Math.PI * 2;
          const dx = Math.sin(yaw);
          const dz = Math.cos(yaw);
          let worst = 0;
          let prev = h;
          let ok = true;
          /* Both ways down the lane: a case may travel along it or
             against it, and only one site has to serve every case. */
          for (let dist = -34; dist <= 34; dist += 2) {
            if (dist === 0) continue;
            const hh = ground(x + dx * dist, z + dz * dist);
            if (!Number.isFinite(hh)) { ok = false; break; }
            worst = Math.max(worst, Math.abs((hh - prev) / 2));
            prev = hh;
          }
          if (!ok) continue;
          if (!best || worst < best.worst) best = { x, z, yaw, worst };
        }
      }
      if (best && best.worst < 0.035) break;
    }
    return best || { x: 0, z: 0, yaw: 0, worst: 9 };
  }

  const lane = findLane();

  /* A slope steep enough to make the controller latch its skid: the
     enter grade is 0.72 and the continuous-terrain classifier gives
     up past 2.6, so this wants a long, honest dune face and not a
     ledge. Faced UP the hill while walking down it, which is what
     retreating under fire looks like. */
  function findSlope() {
    let best = null;
    for (let ring = 20; ring <= 320; ring += 9) {
      for (let k = 0; k < 24; k += 1) {
        const ang = (k / 24) * Math.PI * 2 + ring * 0.37;
        const x = Math.cos(ang) * ring;
        const z = Math.sin(ang) * ring;
        const h = ground(x, z);
        if (!Number.isFinite(h)) continue;
        for (let sdir = 0; sdir < 12; sdir += 1) {
          const yaw = (sdir / 12) * Math.PI * 2;
          const dx = Math.sin(yaw);
          const dz = Math.cos(yaw);
          let prev = h;
          let ok = true;
          let worst = 9;
          for (let dist = 2.5; dist <= 15; dist += 2.5) {
            const hh = ground(x + dx * dist, z + dz * dist);
            if (!Number.isFinite(hh)) { ok = false; break; }
            const grade = (prev - hh) / 2.5;      // positive = descending
            if (grade < 0.80 || grade > 2.2) { ok = false; break; }
            worst = Math.min(worst, grade);
            prev = hh;
          }
          if (!ok) continue;
          /* Face UP the hill; travel goes down it. */
          if (!best || worst > best.grade) {
            best = { x, z, yaw: yaw + Math.PI, grade: worst };
          }
        }
      }
      if (best && best.grade > 1.0) break;
    }
    return best;
  }

  const slope = findSlope();

  function settle(seconds) { T.advanceTime(seconds, 1 / 60); }

  function measure(bodyYaw) {
    const sin = Math.sin(bodyYaw);
    const cos = Math.cos(bodyYaw);
    const row = [];
    for (let k = 0; k < 2; k += 1) {
      fig.footPivots[k].getWorldPosition(a);
      fig.kneePivots[k].getWorldPosition(b);
      fig.legPivots[k].getWorldPosition(c);
      const dx = a.x - p.state.x;
      const dz = a.z - p.state.z;
      const lat = dx * cos - dz * sin;      // +X is the trooper's right
      const fore = dx * sin + dz * cos;
      /* WHICH WAY THE BOOT WAS AIMED - read back off the sabaton's
         own basis rather than off a guessed bone axis.
         `orientFoot` builds that basis with local +X along the
         trooper's right and the toe in the plane of the facing it
         was given, so the +X column is horizontal by construction on
         every rig. The first version of this probe took local +Y for
         the toe, which is true for Aurel and false for Veyra, whose
         foot bone is raked: it read her boots as facing backwards
         through a clean strafe. The X column recovers the commanded
         facing exactly, and that heading is the thing under test. */
      fig.footPivots[k].getWorldQuaternion(q);
      d.set(1, 0, 0).applyQuaternion(q);
      const axisLen = Math.hypot(d.x, d.z);
      const bootYaw = Math.atan2(-d.z, d.x);
      const toeDot = axisLen > 1e-5 ? Math.cos(bootYaw - bodyYaw) : 1;
      const soleLevel = axisLen;   // 1 = boot level, 0 = rolled on edge
      /* Which way the knee breaks: its offset from the hip-ankle
         chord, resolved along the body's forward. A leg reaching
         behind the body still bends FORWARD; a negative number here
         is a joint no knee has. */
      e.copy(a).sub(c);
      d.copy(b).sub(c);
      const chordLenSq = Math.max(1e-8, e.lengthSq());
      const t = Math.max(0, Math.min(1, d.dot(e) / chordLenSq));
      d.addScaledVector(e, -t);
      row.push({
        side: p.legs[k].side,
        lat,
        fore,
        ownSide: p.legs[k].side * lat,
        toeDot,
        soleLevel,
        kneeFore: d.x * sin + d.z * cos,
      });
    }
    const right = row.find((r) => r.side > 0) || row[0];
    const left = row.find((r) => r.side < 0) || row[1];
    return {
      footGap: right.lat - left.lat,
      ownSide: Math.min(row[0].ownSide, row[1].ownSide),
      toeDot: Math.min(row[0].toeDot, row[1].toeDot),
      soleLevel: Math.min(row[0].soleLevel, row[1].soleLevel),
      kneeFore: Math.min(row[0].kneeFore, row[1].kneeFore),
      legs: row,
    };
  }

  function runCase(spec) {
    /* Face down the lane, then travel wherever the case says. The
       body is always put back to a known heading first so one case
       cannot inherit another's turn. */
    const skid = spec.verb === "skid";
    if (skid && !slope) {
      return { id: spec.id, commit: spec.commit, triggered: false,
        refusal: "no slope steep enough on this map", frames: 0, jump: 0 };
    }
    const site = skid ? slope : lane;
    T.teleport(site.x, site.z, site.yaw);
    p.setFree(false);
    T.invulnerable(true);
    T.setFiring(false);
    T.setAds(false);
    p.input.inject(null);
    T.setBoostHold(false);
    T.resetBoost(true);
    T.setJetpackState({ fuel: 9999, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
    T.setCam(site.yaw, 0);
    /* LONG ENOUGH TO ACTUALLY BE COLD. Commitment holds for 0.55s
       after the trigger and then decays at 3.4/s, so the first
       version's 0.6s settle left the "cold" case still carrying 0.13
       of the previous case's aim - and 0.13 is well over the 0.002
       the facing branch tests, so the body stayed aimed and the case
       measured the same thing twice. */
    settle(2.5);

    if (spec.commit === "fire") T.setFiring(true);
    if (spec.commit === "ads") T.setAds(true);
    if (spec.commit !== "none") settle(0.5);   // commitment is damped

    p.input.inject(spec.x, spec.y);
    const actionAt = p.action || null;   // `player.action` IS the name
    const fired = skid ? { triggered: true } : T.triggerBoost(spec.x, spec.y);
    if (!skid) T.setBoostHold(true);

    const frames = [];
    const shots = [];
    let prev = null;
    let jump = 0;
    let poseMax = 0;
    for (let i = 0; i < 78; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      T.setJetpackState({ fuel: 9999 });      // hold the glide open
      const boost = T.boostState();
      const pose = Number(boost?.pose) || 0;
      poseMax = Math.max(poseMax, pose);
      /* ONLY THE FRAMES THE BRACED SOLVER ACTUALLY OWNS.
         `solveLegs` gives the boots to the AIRBORNE solve first -
         any jetpack pose at all, or both feet off the ground - and
         that one hangs the sabatons nearly vertical. A vertical boot
         has no meaningful heading in the XZ plane, so sampling those
         frames reported the toe direction as a normalised rounding
         error and failed a forward boost that is not broken. */
      const jetPose = Number(T.jetpackState()?.pose) || 0;
      const owned = skid ? (Number(p.state.downhillPose) || 0) : pose;
      if (!(owned > 0.20) || !p.state.grounded || jetPose > 0.001) {
        prev = null;
        continue;
      }
      const bodyYaw = fig.root.rotation.y;
      const m = measure(bodyYaw);
      const travelYaw = skid
        ? (Number.isFinite(p.state.travelYaw) ? p.state.travelYaw : bodyYaw)
        : Math.atan2(
          Number(boost?.direction?.[0]) || 0,
          Number(boost?.direction?.[1]) || 0
        );
      let delta = (travelYaw - bodyYaw) % (Math.PI * 2);
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      if (prev) {
        for (let k = 0; k < 2; k += 1) {
          jump = Math.max(jump, Math.hypot(
            m.legs[k].lat - prev.legs[k].lat,
            m.legs[k].fore - prev.legs[k].fore
          ));
        }
      }
      prev = m;
      if (job.shots && job.shotCases.includes(spec.id) && job.shotAt.includes(i)) {
        /* Front quarter, knee height. The defect is lateral, so the
           one view that cannot hide it is the one down the body's
           own forward. `renderStill` does not advance the clock, and
           the figure is hidden under a free camera unless
           `hidePlayer(false)` says otherwise. */
        const base = fig.root.position;
        const fwd = [Math.sin(bodyYaw), Math.cos(bodyYaw)];
        const right = [Math.cos(bodyYaw), -Math.sin(bodyYaw)];
        T.hidePlayer(false);
        p.setFree(true, [
          base.x + fwd[0] * 2.6 + right[0] * 1.15,
          base.y + 0.98,
          base.z + fwd[1] * 2.6 + right[1] * 1.15,
        ], [base.x, base.y + 0.50, base.z], 44);
        T.renderStill();
        T.renderStill();
        shots.push({ i, url: T.captureDataURL() });
        p.setFree(false);
        T.autoPlayer();
      }
      frames.push({
        i,
        pose: owned,
        deltaDeg: delta * 180 / Math.PI,
        footGap: m.footGap,
        ownSide: m.ownSide,
        toeDot: m.toeDot,
        soleLevel: m.soleLevel,
        kneeFore: m.kneeFore,
        speed: p.state.travelSpeed,
        aimCommit: p.state.aimCommit,
      });
    }
    p.input.inject(null);
    T.setBoostHold(false);
    T.setFiring(false);
    T.setAds(false);
    settle(0.5);

    const worst = (key) => frames.reduce(
      (acc, f) => Math.min(acc, f[key]), Infinity);
    /* A HEADING NEEDS A SOLE TO MEASURE IT ON. `soleLevel` is how much
       of the boot's own long axis survives projection into the ground
       plane; near zero the sabaton is hanging toe-down and its
       compass bearing is a normalised rounding error - which is
       exactly how the first version of this probe failed a forward
       boost that was not broken. Judge the toe only where there is a
       boot pointing somewhere. */
    const levelFrames = frames.filter((f) => f.soleLevel > 0.35);
    const worstLevel = (key) => (levelFrames.length
      ? levelFrames.reduce((acc, f) => Math.min(acc, f[key]), Infinity)
      : null);
    const mean = (key) => (frames.length
      ? frames.reduce((acc, f) => acc + f[key], 0) / frames.length : NaN);
    return {
      id: spec.id,
      shots,
      commit: spec.commit,
      triggered: !!fired?.triggered,
      refusal: fired?.triggered ? null : (fired?.state?.lastReason || "refused"),
      actionAt,
      poseMax,
      frames: frames.length,
      deltaDeg: mean("deltaDeg"),
      deltaDegMax: frames.reduce((acc, f) => Math.max(acc, Math.abs(f.deltaDeg)), 0),
      speed: mean("speed"),
      aimCommit: mean("aimCommit"),
      footGap: worst("footGap"),
      ownSide: worst("ownSide"),
      toeDot: worstLevel("toeDot"),
      toeFrames: levelFrames.length,
      soleLevel: worst("soleLevel"),
      worstToeFrame: levelFrames.reduce(
        (acc, f) => (!acc || f.toeDot < acc.toeDot ? f : acc), null),
      kneeFore: worst("kneeFore"),
      jump,
      samples: frames.filter((_, i) => i % 6 === 0).slice(0, 8),
    };
  }

  const cases = job.cases.map(runCase);
  return {
    lane,
    slope,
    character: T.ctx?.character?.id || null,
    cases,
  };
}

const server = startServer();
let code = 0;
try {
  await waitForServer();
  const browser = await chromium.launch();
  const report = {};
  for (const figure of FIGURES) {
    if (only && only !== figure.id) continue;
    const page = await (await browser.newContext({
      viewport: { width: 900, height: 700 },
    })).newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err.message || err)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    const url = new URL(BASE + figure.page);
    url.searchParams.set("qa", "1");
    url.searchParams.set("quality", wantShots ? "high" : "low");
    url.searchParams.set("character", figure.id);
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 420000 });
    if (wantShots) await page.evaluate(() => window.__SF.setTime("goldenhour"));
    report[figure.id] = await page.evaluate(inPage, {
      cases: CASES,
      shots: wantShots,
      shotCases: [...SHOT_CASES],
      shotAt: [22, 48],
    });
    if (wantShots) {
      await mkdir(shotDir, { recursive: true });
      for (const cs of report[figure.id].cases) {
        for (const shot of cs.shots || []) {
          const file = path.join(shotDir, `${tag}-${figure.id}-${cs.id}-f${shot.i}.png`);
          await writeFile(file, Buffer.from(shot.url.slice(shot.url.indexOf(",") + 1), "base64"));
          console.log(`  wrote ${path.relative(root, file)}`);
        }
      }
    }
    for (const cs of report[figure.id].cases) delete cs.shots;
    report[figure.id].errors = errors;
    await page.close();
  }
  await browser.close();

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(report, null, 2));

  const n = (x, k = 3) => (Number.isFinite(x) ? x.toFixed(k) : "-");
  let failures = 0;
  let skipped = 0;
  for (const [id, res] of Object.entries(report)) {
    console.log(`\n${"=".repeat(104)}\n${id}   lane flatness ${n(res.lane.worst, 3)}m/m`
      + `   skid slope ${res.slope ? `${n(res.slope.grade, 2)} grade` : "not found"}`);
    console.log("case".padEnd(18) + "frames".padStart(7) + "delta".padStart(8)
      + "spd".padStart(7) + "aim".padStart(6) + "footGap".padStart(9)
      + "ownSide".padStart(9) + "toeDot".padStart(8) + "kneeFore".padStart(10)
      + "jump".padStart(7) + "  verdict");
    for (const cs of res.cases) {
      const bad = [];
      /* A VERB THAT REFUSED IS NOT A POSE THAT FAILED. The Bastion's
         trigger starts a hammer swing and `boost.blocked()` will not
         ignite through an action, so its firing case never gets a
         glide to measure. Reported, and not counted against the
         stance. */
      if (!cs.triggered || cs.frames < 8) {
        console.log(cs.id.padEnd(18) + String(cs.frames).padStart(7)
          + "       -      -     -        -        -       -         -      -"
          + `  skip (${cs.refusal || "no frames"}${cs.actionAt ? `, action=${cs.actionAt}` : ""})`);
        skipped += 1;
        continue;
      }
      if (cs.footGap < GATES.footGap) bad.push("crossed");
      if (cs.ownSide < GATES.ownSide) bad.push("midline");
      if (cs.toeDot !== null && cs.toeDot < GATES.toeDot) bad.push("boots-backwards");
      if (cs.kneeFore < GATES.kneeFore) bad.push("knee-back");
      if (cs.jump > GATES.jump) bad.push("snap");
      if (bad.length) failures += 1;
      console.log(cs.id.padEnd(18) + String(cs.frames).padStart(7)
        + n(cs.deltaDeg, 0).padStart(8) + n(cs.speed, 1).padStart(7)
        + n(cs.aimCommit, 2).padStart(6) + n(cs.footGap).padStart(9)
        + n(cs.ownSide).padStart(9) + n(cs.toeDot, 2).padStart(8)
        + n(cs.kneeFore).padStart(10) + n(cs.jump).padStart(7)
        + (bad.length ? `  FAIL ${bad.join(",")}` : "  ok"));
    }
    if (res.errors?.length) {
      failures += 1;
      console.log(`  page errors: ${res.errors.slice(0, 3).join(" | ")}`);
    }
  }
  console.log(`\n${failures ? `${failures} FAILING case(s)` : "all measured cases pass"}`
    + `${skipped ? `, ${skipped} skipped` : ""}  ->  ${path.relative(root, outFile)}`);
  code = failures ? 1 : 0;
} catch (err) {
  console.error(err);
  code = 1;
} finally {
  server.kill();
}
process.exit(code);
