#!/usr/bin/env node
/* Kenosis melee ARCS, measured rather than judged from a still.
   "The swing is too small" is a claim about the path the WEAPON
   takes, and neither a screenshot nor the hand's own travel can
   settle it: a hand moves a metre at most, while the head of a
   reliquary hammer sits ~0.6m beyond the fist and is carried much
   further by the wrist. This walks each melee clip at 24 samples,
   tracks the mounted prop's far point in the body frame, and reports
   lateral span, vertical span and total path length - plus the
   crescent id the hit will actually draw, so the VFX direction can
   be checked against the direction the weapon travelled.

   Gates: the bulwark must out-swing the scout on every shared blow. */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.indexOf("--out");
const outDir = path.resolve(root, arg >= 0 ? process.argv[arg + 1] : "output/saintfall/kenosis-arcs");
const port = 46800 + (process.pid % 1200);
const base = `http://127.0.0.1:${port}`;
const CLIPS = ["melee1", "melee2", "melee3"];

function server() {
  return spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "ignore"] });
}
async function waitServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/games/saintfall-white-vigil.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("local server did not start");
}

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
};

/* `partIds` is every prop the figure can swing: a dual-wield
   procession alternates fists, so the clip that throws the LEFT
   backhand leaves the right hybrid hanging at the hip. Measuring one
   part reports that idle hand's carry sway as the swing (it read
   1.17m against the real 5m). Each clip takes whichever hand
   actually travelled. */
async function measure(browser, character, partIds) {
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  await page.goto(
    `${base}/games/saintfall-white-vigil.html?qa=1&character=${character}&quality=medium&time=noon`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF?.isReady?.(), null, { timeout: 300000 });

  const out = await page.evaluate(({ partIds, clips }) => {
    const T = window.__SF;
    const P = T.player;
    T.teleport(90, 900, Math.PI);
    T.advanceTime(1.0, 1 / 60);

    const loadout = T.summit.loadoutHandle();
    const parts = partIds
      .map((id) => (loadout?.parts || []).find((p) => p.spec.id === id))
      .filter(Boolean);
    if (!parts.length) return { error: `no parts ${partIds.join()}` };
    const mk = () => P.figure.root.position.clone();

    /* Each prop's far point, found once at rest and then carried in
       MOUNT-LOCAL space so it follows the weapon through the swing. */
    const tracked = [];
    for (const part of parts) {
      part.asset.updateWorldMatrix(true, true);
      const mountW = mk();
      part.mount.getWorldPosition(mountW);
      let farLocal = null;
      let farDist = -1;
      part.asset.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        if (!bb) return;
        for (const cx of [bb.min.x, bb.max.x]) {
          for (const cy of [bb.min.y, bb.max.y]) {
            for (const cz of [bb.min.z, bb.max.z]) {
              const p = mk();
              p.set(cx, cy, cz).applyMatrix4(o.matrixWorld);
              const d = p.distanceTo(mountW);
              if (d > farDist) { farDist = d; farLocal = p.clone(); }
            }
          }
        }
      });
      if (!farLocal) continue;
      part.mount.worldToLocal(farLocal);
      tracked.push({ part, farLocal, farDist, id: part.spec.id });
    }
    if (!tracked.length) return { error: "no geometry" };

    const bodyFrame = (w) => {
      const ps = P.state;
      const dx = w.x - ps.x;
      const dz = w.z - ps.z;
      const yaw = ps.yaw;
      return {
        left: dx * Math.cos(yaw) - dz * Math.sin(yaw),
        up: w.y - ps.y,
        fwd: dx * Math.sin(yaw) + dz * Math.cos(yaw),
      };
    };
    const tipNow = (entry) => {
      entry.part.mount.updateWorldMatrix(true, true);
      const w = entry.farLocal.clone();
      entry.part.mount.localToWorld(w);
      return bodyFrame(w);
    };

    const result = { armM: Math.max(...tracked.map((t) => t.farDist)), clips: {} };
    for (const clip of clips) {
      const dur = T.actionDuration(clip);
      const scale = P.figure.meleeProfile?.timeScale || 1;
      const wall = dur / scale;
      const STEPS = 24;
      P.beginAction(clip);
      const paths = tracked.map(() => []);
      for (let s = 0; s <= STEPS; s += 1) {
        P.figure.root.updateMatrixWorld(true);
        for (let k = 0; k < tracked.length; k += 1) paths[k].push(tipNow(tracked[k]));
        T.advanceTime(wall / STEPS, 1 / 120);
      }
      // let the clip finish before the next one
      T.advanceTime(1.2, 1 / 60);

      /* Does the swing go THROUGH the shield? With arcs this wide the
         hammer finishes near where the shield hand lives, so the two
         props are measured against each other: the closest the
         hammer's head came to the shield plate's centre, against that
         plate's own radius. Under the radius means the head was
         inside the shield's own volume. */
      let clearance = null;
      const hammer = tracked.find((t) => t.id === "bastion-hammer");
      const shield = tracked.find((t) => t.id === "bastion-shield");
      if (hammer && shield) {
        const hi = tracked.indexOf(hammer);
        const si = tracked.indexOf(shield);
        let minD = Infinity;
        for (let s = 0; s < paths[hi].length; s += 1) {
          const a = paths[hi][s];
          const b = paths[si][s];
          minD = Math.min(minD, Math.hypot(a.left - b.left, a.up - b.up, a.fwd - b.fwd));
        }
        clearance = {
          minTipToShieldCentre: Number(minD.toFixed(2)),
          shieldRadius: Number(shield.farDist.toFixed(2)),
        };
      }

      let best = null;
      for (let k = 0; k < tracked.length; k += 1) {
        const pts = paths[k];
        let pathLen = 0;
        let minL = Infinity; let maxL = -Infinity;
        let minU = Infinity; let maxU = -Infinity;
        let maxF = -Infinity;
        for (let s = 0; s < pts.length; s += 1) {
          const p = pts[s];
          minL = Math.min(minL, p.left); maxL = Math.max(maxL, p.left);
          minU = Math.min(minU, p.up); maxU = Math.max(maxU, p.up);
          maxF = Math.max(maxF, p.fwd);
          if (s > 0) {
            const q = pts[s - 1];
            pathLen += Math.hypot(p.left - q.left, p.up - q.up, p.fwd - q.fwd);
          }
        }
        const row = {
          hand: tracked[k].id,
          lateralSpan: Number((maxL - minL).toFixed(2)),
          verticalSpan: Number((maxU - minU).toFixed(2)),
          pathLength: Number(pathLen.toFixed(2)),
          topHeight: Number(maxU.toFixed(2)),
          /* How far ahead of the body the head actually gets. A
             THRUST is judged on this and not on path length - it is
             deliberately the shortest journey in the kit. */
          reach: Number(maxF.toFixed(2)),
        };
        if (!best || row.pathLength > best.pathLength) best = row;
      }
      /* The crescent this blow asks for, straight off the hook
         player.js reads at the hit frame. */
      best.sweep = loadout.meleeSweep ? loadout.meleeSweep(clip) : null;
      if (clearance) best.clearance = clearance;
      result.clips[clip] = best;
    }
    result.sweepScale = loadout.meleeSpec?.sweepScale ?? null;
    return result;
  }, { partIds, clips: CLIPS });

  if (errors.length) console.log(`${character} pageErrors:`, errors.slice(0, 3));
  await context.close();
  return { ...out, errors };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const child = server();
  let browser;
  let vigil;
  let bastion;
  try {
    await waitServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    bastion = await measure(browser, "bastion-penitent", ["bastion-hammer", "bastion-shield"]);
    vigil = await measure(browser, "white-vigil", ["right-hybrid", "left-hybrid"]);
  } finally {
    await browser?.close();
    child.kill();
  }

  console.log("\n-- weapon-tip travel, body frame (metres) --");
  for (const [who, r] of [["bastion", bastion], ["vigil", vigil]]) {
    if (r.error) { check(`${who}: measured`, false, r.error); continue; }
    console.log(`${who}  (tip ${r.armM.toFixed(2)}m from the fist, sweepScale ${r.sweepScale})`);
    for (const clip of CLIPS) {
      const c = r.clips[clip];
      console.log(`   ${clip}  lateral ${c.lateralSpan}  vertical ${c.verticalSpan}`
        + `  path ${c.pathLength}  reach ${c.reach}  top ${c.topHeight}`
        + `  sweep ${c.sweep}  (${c.hand})`);
    }
  }

  if (!bastion.error && !vigil.error) {
    for (const clip of CLIPS) {
      const b = bastion.clips[clip];
      const v = vigil.clips[clip];
      check(`${clip}: the scout swings a real arc`, v.pathLength >= 1.6,
        { pathLength: v.pathLength, lateral: v.lateralSpan });
      /* THE BULWARK'S OPENER IS NO LONGER A SWING. m111 made melee1 a
         forward thrust - the body drives the reliquary straight out
         instead of carrying the chest through 1.5 radians of
         counter-rotation, which is what read as a twist mid-swing.
         A thrust is judged on REACH, not on the distance the head
         travelled: covering less ground is the point of it. The other
         four clips are still swings and are still gated as swings. */
      if (clip === "melee1") {
        check("melee1: the bulwark thrusts further than the scout swings",
          b.reach > v.reach * 1.1 && b.lateralSpan < b.reach,
          { bastionReach: b.reach, vigilReach: v.reach, bastionLateral: b.lateralSpan });
      } else {
        check(`${clip}: the bulwark swings a bigger one`, b.pathLength > v.pathLength * 1.15,
          { bastion: b.pathLength, vigil: v.pathLength });
      }
    }
    check("vigil: the backhand draws a mirrored crescent",
      vigil.clips.melee2.sweep === -2, { sweep: vigil.clips.melee2.sweep });
    check("bastion: every blow is the hammer hand",
      bastion.clips.melee1.sweep === 5 && bastion.clips.melee2.sweep === 2,
      { m1: bastion.clips.melee1.sweep, m2: bastion.clips.melee2.sweep });
    check("bastion: the crescent is sized to the hammer",
      bastion.sweepScale > vigil.sweepScale,
      { bastion: bastion.sweepScale, vigil: vigil.sweepScale });
    /* A swing wide enough to cross the body is wide enough to cross
       the SHIELD, which is a 1.5m plate on the other fist. The off
       hand tucks it out of the lane; this is the proof. */
    for (const clip of CLIPS) {
      const cl = bastion.clips[clip].clearance;
      check(`${clip}: the hammer clears its own shield`,
        cl && cl.minTipToShieldCentre > cl.shieldRadius, cl);
    }
  }

  await writeFile(path.join(outDir, "arcs.json"),
    JSON.stringify({ bastion, vigil, checks }, null, 2));
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  console.log(`report: ${path.join(outDir, "arcs.json")}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
