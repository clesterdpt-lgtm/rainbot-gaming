#!/usr/bin/env node
/* ============================================================
   SAINTFALL - walk shape probe

   Four complaints about the Bastion Penitent's walk, all of them
   about SHAPE rather than about the rig being broken: the steps are
   too long, the feet are too far apart, the arms hang straight, and
   the torso stays upright. `saintfall-leg-rig-probe.mjs` passes the
   whole set, because none of them is an impossible joint - they are
   a gait that is legal and wrong. Nothing that existed could say so,
   because every leg gate here asks whether a pose is REACHABLE.

   So this measures the gait as a gait: stride and step length, step
   width, cadence, elbow flexion through the swing, shoulder swing
   amplitude, and trunk inclination. Both figures are driven at the
   SAME normalised pace (their own walk, their own sprint) so the two
   columns are comparable even though the profiles disagree about how
   fast a walk is, and everything that scales with the body is also
   reported against leg length and stature.

   `--sweep` retunes `figure.freeArmPose` LIVE and re-measures, many
   candidate poses per boot. The elbow angle is not authored anywhere
   in this game - it is whatever the distance from the shoulder to
   the authored hand target leaves over - so choosing one by
   arithmetic is guesswork and choosing one by trying it is not.

   `slip` is the no-slip claim measured on ground this probe has
   already proved flat AND open. `footSlipCheck` in qa.js asks the
   same question from wherever the player happens to be standing,
   which on Kenosis walked the subject into masonry and then graded
   the wall: 216 blocked frames out of 240.

   Usage:
     node scripts/saintfall-walk-shape-probe.mjs
     node scripts/saintfall-walk-shape-probe.mjs --character bastion-penitent
     node scripts/saintfall-walk-shape-probe.mjs --shots --tag before
     node scripts/saintfall-walk-shape-probe.mjs --sweep hang|fold
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
const flag = (name) => process.argv.includes(name);
const only = arg("--character", null);
const tag = arg("--tag", "now");
const wantShots = flag("--shots");
const outFile = path.resolve(root, arg("--out", `output/saintfall/walk-shape-${tag}.json`));
const shotDir = path.resolve(root, arg("--shot-dir", "output/saintfall/walk-shape"));
const PORT = 45100 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

const FIGURES = ["white-vigil", "bastion-penitent"];
/* Candidate free-arm poses, measured live in one boot. The elbow is
   not an authored number anywhere - it is whatever the distance from
   shoulder to this hand target leaves over - so the only honest way
   to choose one is to try it and read the joint back. */
const SWEEPS = {
  none: [],
  hang: [1.015, 1.055, 1.085, 1.115, 1.145].map((idleY) => ({ idleY })),
  fold: [],
};
for (const idleY of [1.040, 1.055]) {
  for (const walkSwing of [0.190, 0.235]) {
    for (const swingFoldY of [0.22, 0.30]) {
      SWEEPS.fold.push({
        idleX: 0.335, idleY, walkSwing, sprintSwing: 0.105, swingFoldY,
      });
    }
  }
}
const sweepArm = SWEEPS[arg("--sweep", "none")] || [];
const PACES = [
  { id: "walk", norm: 1.0 },
  { id: "sprint", norm: null },   // full stick
];

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try {
      if ((await fetch(`${BASE}/games/saintfall-white-vigil.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* Everything below runs IN THE PAGE. Kept as one evaluate so the
   sampled frames and the frames the shots are taken on come from the
   same drive rather than from two boots of the same level. */
function inPage(job) {
  const T = window.__SF;
  const p = T.player;
  const THREE = T.THREE;
  const DEG = 180 / Math.PI;
  const fig = p.figure;
  const prof = p.locomotionProfile ? p.locomotionProfile() : {};

  const v = () => new THREE.Vector3();
  const a = v(); const b = v(); const c = v(); const d = v();
  const chestQ = new THREE.Quaternion();
  const upLocalFallback = v().set(0, 1, 0);

  const world = (node, out) => { node.getWorldPosition(out); return out; };
  /* Its OWN scratch. The first version borrowed `a`/`b`, which are
     also where the caller had just put the shoulder - so every
     shoulder reading downstream of an angle was the leftover of an
     angle calculation, and the probe cheerfully reported the
     shoulder 451 metres underground. */
  const angA = v(); const angB = v();
  const angleAt = (joint, from, to) => {
    angA.copy(from).sub(joint);
    angB.copy(to).sub(joint);
    if (angA.lengthSq() < 1e-12 || angB.lengthSq() < 1e-12) return 0;
    return Math.acos(Math.max(-1, Math.min(1,
      angA.dot(angB) / (angA.length() * angB.length())))) * DEG;
  };

  /* ---- a flat, open run to walk down ---- */
  function findRun() {
    const ground = (x, z) => T.ctx?.collide?.groundHeight
      ? T.ctx.collide.groundHeight(x, z)
      : p.groundY(x, z);
    let best = null;
    for (let ring = 12; ring <= 260; ring += 11) {
      for (let k = 0; k < 16; k += 1) {
        const ang = (k / 16) * Math.PI * 2 + ring * 0.31;
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
          for (let dist = 2; dist <= 46; dist += 2) {
            const hh = ground(x + dx * dist, z + dz * dist);
            if (!Number.isFinite(hh)) { ok = false; break; }
            worst = Math.max(worst, Math.abs((hh - prev) / 2));
            prev = hh;
          }
          if (!ok) continue;
          if (!best || worst < best.worst) best = { x, z, yaw, worst };
        }
      }
      if (best && best.worst < 0.03) break;
    }
    return best || { x: 0, z: 0, yaw: 0, worst: 9 };
  }

  const site = findRun();

  /* ---- drive one pace and sample it ---- */
  function run(pace) {
    T.teleport(site.x, site.z, site.yaw);
    p.setFree(false);
    for (let i = 0; i < 60; i += 1) T.advanceTime(1 / 60, 1 / 60);

    /* The controller's target speed is always SPRINT; stick MAGNITUDE
       is what selects a walk. Driving both figures at their own
       walk/sprint rather than at a shared m/s is the only way the two
       columns describe the same gait. */
    const mag = pace.norm === null
      ? 1
      : Math.min(1, (prof.walkSpeed * pace.norm) / prof.sprintSpeed);
    p.input.inject(0, -mag);
    for (let i = 0; i < 150; i += 1) T.advanceTime(1 / 60, 1 / 60);   // reach speed

    const frames = [];
    const contacts = [[], []];
    const wasSwinging = [!!p.legs[0].swinging, !!p.legs[1].swinging];
    /* HOW FAR A PLANTED BOOT MOVES OVER THE GROUND. `footSlipCheck`
       in qa.js asks the same question but only from wherever the
       player happens to be standing, and on this level that walked
       the subject into masonry and graded the wall - 216 blocked
       frames out of 240. This asks it on the run the probe already
       proved flat and open, horizontally only, because the toe-off
       lift is a pose and not a slide. */
    const slipMax = [0, 0];
    const lastPlant = [null, null];
    let travelled = 0;
    let px = p.state.x;
    let pz = p.state.z;
    let t = 0;

    const FRAMES = Math.round(job.seconds * 60);
    for (let i = 0; i < FRAMES; i += 1) {
      T.advanceTime(1 / 60, 1 / 60);
      travelled += Math.hypot(p.state.x - px, p.state.z - pz);
      px = p.state.x;
      pz = p.state.z;
      t += 1 / 60;

      const sin = Math.sin(p.state.yaw);
      const cos = Math.cos(p.state.yaw);
      const bodyFrame = (pt) => {
        const ddx = pt.x - p.state.x;
        const ddz = pt.z - p.state.z;
        return {
          lat: ddx * cos - ddz * sin,      // +X is the trooper's right
          fore: ddx * sin + ddz * cos,
          up: pt.y - p.state.y,
        };
      };

      const legRow = [0, 1].map((k) => {
        world(fig.footPivots[k], a);
        const bf = bodyFrame(a);
        return {
          lat: bf.lat, fore: bf.fore, up: bf.up,
          swinging: !!p.legs[k].swinging,
        };
      });

      /* Touchdown: the swing flag falling. Recorded with the travel
         odometer so a stride is a real distance over the ground and
         not a difference of two foot positions in a moving frame. */
      for (let k = 0; k < 2; k += 1) {
        const sw = !!p.legs[k].swinging;
        if (wasSwinging[k] && !sw) {
          contacts[k].push({
            t, travelled,
            lat: legRow[k].lat,
            fore: legRow[k].fore,
            otherLat: legRow[1 - k].lat,
            otherFore: legRow[1 - k].fore,
          });
        }
        if (!sw && !wasSwinging[k] && p.state.grounded) {
          const here = { x: p.legs[k].foot.x, z: p.legs[k].foot.z };
          if (lastPlant[k]) {
            const moved = Math.hypot(here.x - lastPlant[k].x, here.z - lastPlant[k].z);
            if (moved > slipMax[k]) slipMax[k] = moved;
          }
          lastPlant[k] = here;
        } else {
          lastPlant[k] = null;
        }
        wasSwinging[k] = sw;
      }

      const arms = [0, 1].map((k) => {
        world(fig.armPivots[k], a);
        world(fig.elbowPivots[k], b);
        world(fig.handPivots[k], c);
        const elbow = angleAt(b.clone(), a, c);
        const bfHand = bodyFrame(c);
        const bfShoulder = bodyFrame(a);
        /* Shoulder flexion: the upper arm against the trunk's own
           long axis, signed positive when the elbow leads. */
        d.copy(b).sub(a);
        const fore = d.x * sin + d.z * cos;
        const drop = -d.y;
        return {
          elbow,
          swing: Math.atan2(fore, Math.max(1e-4, drop)) * DEG,
          /* WHAT THE ELBOW ANGLE IS MADE OF. The bend is not
             authored - it falls out of how far the authored hand
             target sits from the shoulder against the arm's own
             length, so this is the number a pose edit has to move. */
          reach: world(fig.armPivots[k], a).distanceTo(world(fig.handPivots[k], c)),
          handFore: bfHand.fore,
          handLat: bfHand.lat,
          handUp: bfHand.up,
          shoulderUp: bfShoulder.up,
          shoulderFore: bfShoulder.fore,
          shoulderLat: bfShoulder.lat,
        };
      });

      /* Trunk inclination, off the CHEST'S OWN ORIENTATION.
         The first version of this measured mid-hip to the Spine
         bone's position and reported the two figures 3.5 degrees
         apart on a lean that is figure-independent by construction -
         because rotating a bone does not move its own origin, so all
         it ever read was a bind-pose offset. `torsoUpLocal` is the
         direction that pointed at the sky in the bind pose, so
         carrying it through the chest's live world quaternion gives
         the shoulder line's real pitch: root tip plus spine share,
         which is what the eye reads off the side of the figure. */
      fig.chest.getWorldQuaternion(chestQ);
      d.copy(fig.torsoUpLocal || upLocalFallback).applyQuaternion(chestQ).normalize();
      const trunk = Math.atan2(d.x * sin + d.z * cos, Math.max(1e-4, d.y)) * DEG;

      world(fig.head, d);
      frames.push({
        t, speed: p.state.speed, gait: p.state.gait % 1,
        rootPitch: fig.root.rotation.x * DEG,
        trunk,
        headUp: d.y - fig.root.position.y,
        legs: legRow,
        arms,
      });
    }
    p.input.inject(null);
    T.advanceTime(0.5, 1 / 60);

    /* ---- reduce ---- */
    const strides = [];
    const stepWidths = [];
    const cadences = [];
    for (let k = 0; k < 2; k += 1) {
      const list = contacts[k];
      for (let i = 1; i < list.length; i += 1) {
        strides.push(list[i].travelled - list[i - 1].travelled);
        cadences.push(1 / (list[i].t - list[i - 1].t));
      }
      for (const hit of list) stepWidths.push(Math.abs(hit.lat - hit.otherLat));
    }
    /* Step length is the gap between ALTERNATE feet, which on a
       symmetric gait is half the stride; measured rather than halved
       so an asymmetric one is visible. */
    const allContacts = [...contacts[0].map((h) => ({ ...h, k: 0 })),
      ...contacts[1].map((h) => ({ ...h, k: 1 }))].sort((x, y) => x.t - y.t);
    const steps = [];
    for (let i = 1; i < allContacts.length; i += 1) {
      if (allContacts[i].k === allContacts[i - 1].k) continue;
      steps.push(allContacts[i].travelled - allContacts[i - 1].travelled);
    }

    const stat = (list) => {
      if (!list.length) return { n: 0 };
      const s = [...list].sort((x, y) => x - y);
      const sum = s.reduce((acc, n) => acc + n, 0);
      return {
        n: s.length,
        min: s[0],
        med: s[Math.floor(s.length / 2)],
        max: s[s.length - 1],
        mean: sum / s.length,
      };
    };
    const series = (get) => stat(frames.map(get));
    const legSpan = frames.map((f) => f.legs[0].fore - f.legs[1].fore);

    return {
      pace: pace.id,
      stickMag: mag,
      speed: series((f) => f.speed).mean,
      stride: stat(strides),
      step: stat(steps),
      stepWidth: stat(stepWidths),
      cycleHz: stat(cadences),
      footSpanFore: stat(legSpan.map(Math.abs)),
      footLatL: series((f) => f.legs[0].lat),
      footLatR: series((f) => f.legs[1].lat),
      elbowL: series((f) => f.arms[0].elbow),
      elbowR: series((f) => f.arms[1].elbow),
      armSwingL: series((f) => f.arms[0].swing),
      armSwingR: series((f) => f.arms[1].swing),
      handForeL: series((f) => f.arms[0].handFore),
      reachL: series((f) => f.arms[0].reach),
      shoulderUp: series((f) => f.arms[0].shoulderUp),
      shoulderFore: series((f) => f.arms[0].shoulderFore),
      shoulderLat: series((f) => f.arms[0].shoulderLat),
      handUpL: series((f) => f.arms[0].handUp),
      handLatL: series((f) => f.arms[0].handLat),
      rootPitch: series((f) => f.rootPitch),
      trunk: series((f) => f.trunk),
      slipMaxM: slipMax.map((n) => Number(n.toFixed(5))),
      travelM: travelled,
    };
  }

  const out = {
    character: T.summit?.character ? T.summit.character() : null,
    profile: prof,
    site: { x: +site.x.toFixed(2), z: +site.z.toFixed(2), yaw: +site.yaw.toFixed(4), flatness: +site.worst.toFixed(3) },
    rig: {
      stature: null,
      legLength: fig.limb.thigh + fig.limb.shin + fig.limb.ankle,
      thigh: fig.limb.thigh,
      shin: fig.limb.shin,
      ankle: fig.limb.ankle,
      armLength: fig.limb.upper + fig.limb.fore,
      upper: fig.limb.upper,
      fore: fig.limb.fore,
      hipHalfBone: null,
      shoulderHalfBone: null,
    },
    paces: [],
  };

  /* Rig measurements from the BIND pose, taken standing still. */
  T.teleport(site.x, site.z, site.yaw);
  for (let i = 0; i < 90; i += 1) T.advanceTime(1 / 60, 1 / 60);
  world(fig.head, a);
  out.rig.stature = a.y - fig.root.position.y + 0.12;   // crown ~12cm over the head bone
  world(fig.legPivots[0], a); world(fig.legPivots[1], b);
  out.rig.hipHalfBone = a.distanceTo(b) / 2;
  world(fig.armPivots[0], a); world(fig.armPivots[1], b);
  out.rig.shoulderHalfBone = a.distanceTo(b) / 2;
  out.standing = {
    elbowL: angleAt(world(fig.elbowPivots[0], v()), world(fig.armPivots[0], v()), world(fig.handPivots[0], v())),
    elbowR: angleAt(world(fig.elbowPivots[1], v()), world(fig.armPivots[1], v()), world(fig.handPivots[1], v())),
    footGapLat: Math.abs(world(fig.footPivots[0], v()).distanceTo(world(fig.footPivots[1], v()))),
  };

  for (const pace of job.paces) out.paces.push(run(pace));

  /* ---- live pose sweep ----
     `freeArmPose` is read through `freeArmValue` every frame off the
     SAME object the figure adapter handed over, so patching it here
     retunes the arms without a reload. Twenty-odd candidate poses in
     one boot instead of twenty boots. */
  if (job.armSweep && job.armSweep.length) {
    out.armSweep = [];
    const base = { ...fig.freeArmPose };
    for (const patch of job.armSweep) {
      Object.assign(fig.freeArmPose, base, patch);
      out.armSweep.push({
        patch,
        ...run({ id: "walk", norm: 1.0 }),
      });
    }
    Object.assign(fig.freeArmPose, base);
  }
  return out;
}

/* Side-on and head-on frames across one full gait cycle. */
function shotsInPage(job) {
  const T = window.__SF;
  const p = T.player;
  const prof = p.locomotionProfile ? p.locomotionProfile() : {};
  T.teleport(job.site.x, job.site.z, job.site.yaw);
  p.setFree(false);
  for (let i = 0; i < 60; i += 1) T.advanceTime(1 / 60, 1 / 60);
  const mag = Math.min(1, prof.walkSpeed / prof.sprintSpeed);
  p.input.inject(0, -mag);
  for (let i = 0; i < 150; i += 1) T.advanceTime(1 / 60, 1 / 60);

  const out = [];
  /* FRAME OFF THE MESH, NOT OFF A NUMBER. Framing on `state.y + 1.05`
     with a 34-degree lens should have cleared a 1.74m figure by half
     a metre and instead cut the helm off in every plate - because
     "stature" measured to the HEAD BONE, and this figure's helm and
     backpack stand well above it. A bounding box cannot be wrong
     about that. */
  const bounds = (() => {
    const box = new (window.__SF.THREE.Box3)();
    box.setFromObject(p.figure.root);
    const base = p.figure.root.position;
    return {
      top: box.max.y - base.y,
      bottom: Math.min(0, box.min.y - base.y),
    };
  })();
  const span = Math.max(1.2, (bounds.top - bounds.bottom) * 1.18);
  const FOV = 32;
  const dist = (span / 2) / Math.tan((FOV / 2) * Math.PI / 180);
  const aimUp = (bounds.top + bounds.bottom) / 2;

  const shoot = (label, eye, target, fov) => {
    T.hidePlayer(false);
    p.setFree(true, eye, target, fov);
    T.renderStill();
    T.renderStill();
    out.push({ label, url: T.captureDataURL() });
    p.setFree(false);
    T.autoPlayer();
  };

  /* Wait for a known phase so the same instant is photographed on
     both figures however their cadence differs. */
  const waitForPhase = (want) => {
    for (let i = 0; i < 600; i += 1) {
      const before = p.state.gait % 1;
      T.advanceTime(1 / 60, 1 / 60);
      const after = p.state.gait % 1;
      const passed = before <= after
        ? (want > before && want <= after)
        : (want > before || want <= after);
      if (passed) return true;
    }
    return false;
  };

  for (const phase of job.phases) {
    waitForPhase(phase);
    const st = p.state;
    const base = p.figure.root.position;
    const right = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
    const fwd = [Math.sin(st.yaw), 0, Math.cos(st.yaw)];
    const aim = [base.x, base.y + aimUp, base.z];
    shoot(`side-p${phase.toFixed(2)}`, [
      base.x + right[0] * dist, base.y + aimUp, base.z + right[2] * dist,
    ], aim, FOV);
    shoot(`front-p${phase.toFixed(2)}`, [
      base.x + fwd[0] * dist, base.y + aimUp, base.z + fwd[2] * dist,
    ], aim, FOV);
  }
  p.input.inject(null);
  return out;
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
    if (wantShots) await mkdir(shotDir, { recursive: true });

    for (const id of FIGURES) {
      if (only && only !== id) continue;
      const page = await (await browser.newContext({
        viewport: { width: 900, height: 820 },
      })).newPage();
      page.on("pageerror", (e) => console.error(`PAGE ERROR [${id}]`, e.message));
      const url = new URL(`${BASE}/games/saintfall-white-vigil.html`);
      url.searchParams.set("qa", "1");
      url.searchParams.set("quality", wantShots ? "high" : "low");
      url.searchParams.set("character", id);
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

      report[id] = await page.evaluate(inPage, {
        paces: PACES,
        seconds: sweepArm.length ? 3 : 8,
        armSweep: id === "bastion-penitent" ? sweepArm : [],
      });

      if (wantShots) {
        await page.evaluate(() => window.__SF.setTime("goldenhour"));
        const frames = await page.evaluate(shotsInPage, {
          site: report[id].site,
          phases: [0.00, 0.12, 0.25, 0.38, 0.50, 0.62, 0.75, 0.88],
        });
        for (const f of frames) {
          const file = path.join(shotDir, `${tag}-${id}-${f.label}.png`);
          await writeFile(file, Buffer.from(f.url.slice(f.url.indexOf(",") + 1), "base64"));
        }
        console.log(`  wrote ${frames.length} shots for ${id}`);
      }
      await page.close();
    }

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(report, null, 2));

    const n = (x, k = 3) => (Number.isFinite(x) ? x.toFixed(k) : "-");
    for (const [id, res] of Object.entries(report)) {
      console.log(`\n${"=".repeat(96)}\n${id}   ${res.character?.assetSource || ""}`);
      console.log(`stature ${n(res.rig.stature, 2)}m  leg ${n(res.rig.legLength, 3)}m`
        + `  arm ${n(res.rig.armLength, 3)}m  hip bone half ${n(res.rig.hipHalfBone, 3)}m`
        + `  shoulder half ${n(res.rig.shoulderHalfBone, 3)}m`);
      console.log(`standing: elbows ${n(res.standing.elbowL, 1)}/${n(res.standing.elbowR, 1)}deg`
        + `  ankles ${n(res.standing.footGapLat, 3)}m apart`);
      console.log(`site flatness ${n(res.site.flatness, 3)}m/m`);
      console.log("\npace".padEnd(8) + "spd".padStart(6) + "stride".padStart(8)
        + "step".padStart(7) + "width".padStart(7) + "cyc/s".padStart(7)
        + "step/s".padStart(8) + "stride/leg".padStart(11)
        + "elbow min..max".padStart(17) + "armSwing".padStart(10)
        + "root".padStart(7) + "trunk".padStart(8)
        + "slip".padStart(9) + "travel".padStart(8));
      for (const pc of res.paces) {
        const elbow = `${n(Math.min(pc.elbowL.min, pc.elbowR.min), 0)}..${n(Math.max(pc.elbowL.max, pc.elbowR.max), 0)}`;
        const swing = `${n(pc.armSwingL.min, 0)}..${n(pc.armSwingL.max, 0)}`;
        console.log(
          pc.pace.padEnd(8)
          + n(pc.speed, 2).padStart(6)
          + n(pc.stride.med, 2).padStart(8)
          + n(pc.step.med, 2).padStart(7)
          + n(pc.stepWidth.med, 3).padStart(7)
          + n(pc.cycleHz.med, 2).padStart(7)
          + n(pc.cycleHz.med * 2, 2).padStart(8)
          + n(pc.stride.med / res.rig.legLength, 2).padStart(11)
          + elbow.padStart(17)
          + swing.padStart(10)
          + n(pc.rootPitch.mean, 1).padStart(7)
          + n(pc.trunk.mean, 1).padStart(8)
          + n(Math.max(...pc.slipMaxM), 4).padStart(9)
          + n(pc.travelM, 1).padStart(8)
        );
      }
    }
    for (const [id, res] of Object.entries(report)) {
      if (!res.armSweep) continue;
      console.log(`\n${"=".repeat(96)}\narm sweep - ${id}`);
      console.log("patch".padEnd(52) + "elbow min..med..max".padStart(22)
        + "reach".padStart(8) + "swing".padStart(12));
      for (const row of res.armSweep) {
        const lo = Math.min(row.elbowL.min, row.elbowR.min);
        const hi = Math.max(row.elbowL.max, row.elbowR.max);
        const med = (row.elbowL.med + row.elbowR.med) / 2;
        console.log(
          JSON.stringify(row.patch).padEnd(52)
          + `${n(lo, 0)}..${n(med, 0)}..${n(hi, 0)}`.padStart(22)
          + n(row.reachL.mean, 3).padStart(8)
          + `${n(row.armSwingL.min, 0)}..${n(row.armSwingL.max, 0)}`.padStart(12)
        );
      }
    }
    console.log(`\nwrote ${path.relative(root, outFile)}`);
    if (wantShots) console.log(`shots in ${path.relative(root, shotDir)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
