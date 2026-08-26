#!/usr/bin/env node
/* ============================================================
   SAINTFALL - carried-weapon fit search

   `saintfall-loadout-audit.mjs` says a prop is inside a leg. This
   finds the mount transform that gets it out.

   The search is offline, which is the whole trick. Driving the
   trooper into a pose costs 150 frames, so scoring even a few dozen
   candidate transforms by re-posing per candidate would be hopeless.
   Instead each pose is captured ONCE as (a) the capsule skeleton that
   stands in for the body and (b) the palm's world matrix; the prop's
   vertices are sampled once in MOUNT space; and a candidate is then
   just a matrix compose and a few hundred capsule tests. Thousands of
   candidates per second, over every pose at once.

   Coordinate descent over the six mount numbers, a few passes. Not
   because the space is convex - it is not - but because the starting
   point is already roughly right and the useful moves are small.

   Usage:
     node scripts/saintfall-loadout-fit.mjs --character bastion-penitent
     node scripts/saintfall-loadout-fit.mjs --character white-vigil --part right-hybrid
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
const character = arg("--character", "bastion-penitent");
const onlyPart = arg("--part", null);
const outFile = path.resolve(root, arg("--out", `output/saintfall/loadout-fit-${character}.json`));
const PORT = 45800 + (process.pid % 900);
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
    try {
      if ((await fetch(`${BASE}/games/saintfall-white-vigil.html`)).ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

function inPage(job) {
  const T = window.__SF;
  const p = T.player;
  const THREE = T.THREE;
  const fig = p.figure;
  const loadout = T.ctx?.playerLoadout;
  if (!loadout?.parts?.length) return { missing: true };

  const DEG = Math.PI / 180;
  const scratch = new THREE.Vector3();
  const near = new THREE.Vector3();

  const skinnedVertex = (m, attr, vi, out) => {
    out.fromBufferAttribute(attr, vi);
    if (m.isSkinnedMesh && typeof m.applyBoneTransform === "function") {
      m.applyBoneTransform(vi, out);
    }
    return out.applyMatrix4(m.matrixWorld);
  };

  const midHip = () => {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    fig.legPivots[0].getWorldPosition(a);
    fig.legPivots[1].getWorldPosition(b);
    return a.add(b).multiplyScalar(0.5);
  };
  const SEGMENTS = [
    { id: "thigh-l", band: "legs", a: () => fig.legPivots[0], b: () => fig.kneePivots[0] },
    { id: "shin-l", band: "legs", a: () => fig.kneePivots[0], b: () => fig.footPivots[0] },
    { id: "thigh-r", band: "legs", a: () => fig.legPivots[1], b: () => fig.kneePivots[1] },
    { id: "shin-r", band: "legs", a: () => fig.kneePivots[1], b: () => fig.footPivots[1] },
    { id: "torso", band: "torso", a: null, b: () => fig.chest },
    { id: "neck", band: "head", a: () => fig.chest, b: () => fig.head },
    { id: "upper-l", band: "arms", a: () => fig.armPivots[0], b: () => fig.elbowPivots[0] },
    { id: "fore-l", band: "arms", a: () => fig.elbowPivots[0], b: () => fig.handPivots[0] },
    { id: "upper-r", band: "arms", a: () => fig.armPivots[1], b: () => fig.elbowPivots[1] },
    { id: "fore-r", band: "arms", a: () => fig.elbowPivots[1], b: () => fig.handPivots[1] },
  ];
  const radii = SEGMENTS.map(() => 0.06);
  const segClosest = (p0, p1, point, out) => {
    out.copy(p1).sub(p0);
    const len2 = out.lengthSq();
    const t = len2 < 1e-9 ? 0
      : Math.max(0, Math.min(1, scratch.copy(point).sub(p0).dot(out) / len2));
    return out.multiplyScalar(t).add(p0);
  };
  const liveEnds = () => SEGMENTS.map((seg) => {
    const p0 = seg.a ? seg.a().getWorldPosition(new THREE.Vector3()) : midHip();
    const p1 = seg.b().getWorldPosition(new THREE.Vector3());
    return [p0, p1];
  });

  const fitRadii = () => {
    const ends = liveEnds();
    const buckets = SEGMENTS.map(() => []);
    for (const m of (fig.partMeshes || [])) {
      const attr = m.geometry?.attributes?.position;
      if (!attr) continue;
      const step = Math.max(1, Math.floor(attr.count / 4000));
      for (let i = 0; i < attr.count; i += step) {
        const v = skinnedVertex(m, attr, i, new THREE.Vector3());
        let best = -1;
        let bestD = Infinity;
        for (let c = 0; c < ends.length; c += 1) {
          const d = v.distanceToSquared(segClosest(ends[c][0], ends[c][1], v, near));
          if (d < bestD) { bestD = d; best = c; }
        }
        if (best >= 0) buckets[best].push(Math.sqrt(bestD));
      }
    }
    for (let c = 0; c < SEGMENTS.length; c += 1) {
      const list = buckets[c].sort((x, y) => x - y);
      radii[c] = list.length ? list[Math.floor(list.length * 0.72)] : 0.06;
    }
  };

  /* ---- capture the poses ---- */
  const ground = (x, z) => T.ctx.collide.groundHeight(x, z);
  let site = { x: 0, z: 0, w: 9 };
  for (let ring = 14; ring <= 180; ring += 12) {
    for (let k = 0; k < 12; k += 1) {
      const a = (k / 12) * Math.PI * 2 + ring * 0.31;
      const x = Math.cos(a) * ring;
      const z = Math.sin(a) * ring;
      const h = ground(x, z);
      if (!Number.isFinite(h)) continue;
      let worst = 0;
      let clear = true;
      for (let b = 0; b < 8 && clear; b += 1) {
        const bb = (b / 8) * Math.PI * 2;
        for (let d = 2; d <= 8; d += 2) {
          const qh = ground(x + Math.cos(bb) * d, z + Math.sin(bb) * d);
          if (!Number.isFinite(qh)) { clear = false; break; }
          worst = Math.max(worst, Math.abs(qh - h));
        }
      }
      if (clear && worst < site.w) site = { x, z, w: worst };
    }
    if (site.w < 0.05) break;
  }
  T.teleport(site.x, site.z, 0);
  T.advanceTime(1.4, 1 / 60);
  fitRadii();

  const prof = p.locomotionProfile();
  const poses = [];
  const capture = (id) => {
    poses.push({
      id,
      ends: liveEnds(),
      groundY: ground(p.state.x, p.state.z),
      palms: [0, 1].map((h) => {
        const node = fig.palmLocators?.[h] || fig.handPivots[h];
        node.updateWorldMatrix(true, false);
        return node.matrixWorld.clone();
      }),
    });
  };
  capture("stand");
  p.input.inject(0, -Math.min(1, prof.walkSpeed / prof.sprintSpeed));
  for (let i = 0; i < 150; i += 1) T.advanceTime(1 / 60, 1 / 60);
  for (const phase of [0.10, 0.35, 0.60, 0.85]) {
    for (let i = 0; i < 600; i += 1) {
      const before = p.state.gait % 1;
      T.advanceTime(1 / 60, 1 / 60);
      const after = p.state.gait % 1;
      const passed = before <= after
        ? (phase > before && phase <= after) : (phase > before || phase <= after);
      if (passed) break;
    }
    capture(`walk${phase}`);
  }
  p.input.inject(0, -1);
  for (let i = 0; i < 150; i += 1) T.advanceTime(1 / 60, 1 / 60);
  capture("sprint");
  p.input.inject(null);
  T.advanceTime(1.0, 1 / 60);
  T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
  T.setJetInput(true);
  for (let i = 0; i < 170; i += 1) {
    T.setJetpackState({ fuel: 100 });
    T.advanceTime(1 / 60, 1 / 60);
  }
  capture("flight");
  T.setJetInput(false);
  T.advanceTime(1.0, 1 / 60);

  /* ---- the prop, sampled once in MOUNT space ---- */
  const results = [];
  for (const part of loadout.parts) {
    if (job.part && part.spec.id !== job.part) continue;
    const gripSeg = part.spec.hand === 0 ? "fore-l" : "fore-r";
    const gripIndex = SEGMENTS.findIndex((s) => s.id === gripSeg);
    const mountInverse = part.mount.matrixWorld.clone().invert();
    const local = [];
    part.asset.updateWorldMatrix(true, true);
    part.asset.traverse((o) => {
      const attr = o.isMesh ? o.geometry?.attributes?.position : null;
      if (!attr) return;
      const step = Math.max(1, Math.floor(attr.count / job.samples));
      for (let i = 0; i < attr.count; i += step) {
        local.push(new THREE.Vector3().fromBufferAttribute(attr, i)
          .applyMatrix4(o.matrixWorld).applyMatrix4(mountInverse));
      }
    });

    const m4 = new THREE.Matrix4();
    const euler = new THREE.Euler();
    const quat = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    const world = new THREE.Vector3();

    /* CLIPPING, plus the two things that make a technically clear
       transform still wrong: a prop dragging in the snow, and a prop
       wandering off the hand it is supposed to be held in. */
    const score = (t) => {
      euler.set(t[3] * DEG, t[4] * DEG, t[5] * DEG);
      quat.setFromEuler(euler);
      pos.set(t[0], t[1], t[2]);
      let clip = 0;
      let deepest = 0;
      let lowClear = Infinity;
      for (const pose of poses) {
        m4.compose(pos, quat, one).premultiply(pose.palms[part.spec.hand]);
        let lowest = Infinity;
        for (const v of local) {
          world.copy(v).applyMatrix4(m4);
          if (world.y < lowest) lowest = world.y;
          for (let c = 0; c < SEGMENTS.length; c += 1) {
            if (c === gripIndex) continue;
            const d = world.distanceTo(segClosest(pose.ends[c][0], pose.ends[c][1], world, near));
            if (d <= radii[c]) {
              clip += 1;
              const depth = radii[c] - d;
              if (depth > deepest) deepest = depth;
              break;
            }
          }
        }
        lowClear = Math.min(lowClear, lowest - pose.groundY);
      }
      const drag = Math.max(0, 0.10 - lowClear);
      const stray = Math.max(0, pos.length() - 0.22);
      /* HOLD THE AUTHORED AIM. The carry orientation is chosen for
         how it LOOKS - head up, shield face forward - and the search
         has no idea about that; left free it will happily rotate a
         hammer into the small of the back because nothing there is
         inside a leg. So rotation drifts only when it buys real
         clearance, while position stays cheap to move. */
      let drift = 0;
      for (let a = 3; a < 6; a += 1) drift += Math.abs(t[a] - job.start[a]);
      return {
        clip, deepest, lowClear, drift,
        cost: clip + deepest * 220 + drag * 900 + stray * 400 + drift * 1.6,
      };
    };

    const start = [
      part.mount.position.x, part.mount.position.y, part.mount.position.z,
      part.mount.rotation.x / DEG, part.mount.rotation.y / DEG, part.mount.rotation.z / DEG,
    ];
    job.start = start;
    let best = start.slice();
    let bestScore = score(best);
    const before = bestScore;
    const steps = [
      [0.04, 0.04, 0.04, 3, 3, 3],
      [0.015, 0.015, 0.015, 1.5, 1.5, 1.5],
      [0.006, 0.006, 0.006, 0.5, 0.5, 0.5],
    ];
    for (const step of steps) {
      for (let pass = 0; pass < 3; pass += 1) {
        let improved = false;
        for (let axis = 0; axis < 6; axis += 1) {
          for (const dir of [1, -1]) {
            for (let mult = 1; mult <= 4; mult += 1) {
              const trial = best.slice();
              trial[axis] += dir * step[axis] * mult;
              const s = score(trial);
              if (s.cost < bestScore.cost - 1e-6) {
                best = trial; bestScore = s; improved = true;
              } else break;
            }
          }
        }
        if (!improved) break;
      }
    }
    results.push({
      id: part.spec.id,
      hand: part.spec.hand,
      samples: local.length,
      poses: poses.length,
      before: { transform: start, ...before },
      after: { transform: best, ...bestScore },
    });
  }
  return { character: T.summit?.character?.()?.id || null, poses: poses.map((q) => q.id), results };
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
    const page = await (await browser.newContext({
      viewport: { width: 900, height: 620 },
    })).newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
    const url = new URL(`${BASE}/games/saintfall-white-vigil.html`);
    url.searchParams.set("qa", "1");
    url.searchParams.set("quality", "low");
    url.searchParams.set("character", character);
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
    const res = await page.evaluate(inPage, { part: onlyPart, samples: 110 });
    await page.close();
    if (res.missing) { console.log("no loadout on this character"); return; }

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(res, null, 2));
    console.log(`\n${character}   poses: ${res.poses.join(", ")}`);
    for (const r of res.results) {
      const f = (t) => `[${t.slice(0, 3).map((n) => n.toFixed(3)).join(", ")}]`
        + ` rot [${t.slice(3).map((n) => n.toFixed(1)).join(", ")}]`;
      console.log(`\n  ${r.id}  (${r.samples} samples x ${r.poses} poses)`);
      console.log(`    before  clip ${String(r.before.clip).padStart(5)}`
        + `  deepest ${r.before.deepest.toFixed(3)}m  clearance ${r.before.lowClear.toFixed(3)}m`);
      console.log(`            ${f(r.before.transform)}`);
      console.log(`    after   clip ${String(r.after.clip).padStart(5)}`
        + `  deepest ${r.after.deepest.toFixed(3)}m  clearance ${r.after.lowClear.toFixed(3)}m`
        + `  rot drift ${r.after.drift.toFixed(1)}deg`);
      console.log(`            ${f(r.after.transform)}`);
    }
    console.log(`\nwrote ${path.relative(root, outFile)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
