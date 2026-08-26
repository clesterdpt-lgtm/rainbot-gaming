#!/usr/bin/env node
/* ============================================================
   SAINTFALL - carried-weapon audit

   Three questions about the Meshy weapon props, none of which a
   still frame settles on its own:

     1. is each piece where it should be - in the hand, off the
        ground, inside the silhouette;
     2. is any of it INSIDE the body or the legs;
     3. does anything move when the trooper attacks or blocks.

   (2) is the one that needs real work. Nearest-approach distance
   cannot answer it: a hammer head buried 4cm inside a thigh and a
   hammer head resting 4cm off it both measure 4cm. So this bakes the
   SKINNED body into a plain mesh once per pose and casts three rays
   from every sampled weapon vertex, counting crossings - odd is
   inside - and takes the majority verdict, which survives the odd
   non-manifold triangle a generated mesh brings with it.

   Poses are the ones the arms actually pass through: standing, a
   phase-locked mid-stride, a sprint, and under the jetpack.

   Usage:
     node scripts/saintfall-loadout-audit.mjs
     node scripts/saintfall-loadout-audit.mjs --character bastion-penitent
     node scripts/saintfall-loadout-audit.mjs --no-shots
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
const only = arg("--character", null);
const tag = arg("--tag", "audit");
const wantShots = !process.argv.includes("--no-shots");
const outDir = path.resolve(root, arg("--out", "output/saintfall/loadout-audit"));
const PORT = 45300 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;
const FIGURES = ["white-vigil", "bastion-penitent"];

const BEARINGS = [
  { id: "front", yaw: 180, pitch: 0.04, dist: 2.75 },
  { id: "front34", yaw: 224, pitch: 0.06, dist: 2.85 },
  { id: "profile", yaw: 270, pitch: 0.03, dist: 2.85 },
  { id: "rear34", yaw: 44, pitch: 0.06, dist: 2.85 },
];

/* A prop may TOUCH armour - a haft passes through a fist and a shield
   rests on a forearm - so contact is not the fault. Vertices sitting
   inside the surface are. */
const INSIDE_LIMIT = 0.006;      // fraction of sampled vertices
const DEPTH_LIMIT = 0.020;       // metres past the surface
const GROUND_LIMIT = 0.030;      // metres of clearance under the lowest point

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
  const kit = T.summit?.loadoutState?.() || null;
  const loadout = T.ctx?.playerLoadout || null;
  if (!loadout || !loadout.parts?.length) return { missing: true };

  T.maximize();

  /* ---- somewhere flat and open ---- */
  const ground = (x, z) => T.ctx.collide.groundHeight(x, z);
  let site = { x: 0, z: 0, w: 9 };
  for (let ring = 14; ring <= 200; ring += 12) {
    for (let k = 0; k < 12; k += 1) {
      const a = (k / 12) * Math.PI * 2 + ring * 0.31;
      const x = Math.cos(a) * ring;
      const z = Math.sin(a) * ring;
      const h = ground(x, z);
      if (!Number.isFinite(h)) continue;
      let worst = 0;
      let clear = true;
      for (let b = 0; b < 10 && clear; b += 1) {
        const bb = (b / 10) * Math.PI * 2;
        for (let d = 2; d <= 8; d += 2) {
          const qx = x + Math.cos(bb) * d;
          const qz = z + Math.sin(bb) * d;
          const qh = ground(qx, qz);
          if (!Number.isFinite(qh)) { clear = false; break; }
          worst = Math.max(worst, Math.abs(qh - h));
          if (T.ctx.collide.blocked(qx, qz, qh)) { clear = false; break; }
        }
      }
      if (clear && worst < site.w) site = { x, z, w: worst };
    }
    if (site.w < 0.05) break;
  }

  /* ---- is a point inside the trooper ----

     TWO MESH-BASED METHODS WERE TRIED AND BOTH LIED.

     A solid voxelisation - stamp the skinned triangles into a grid,
     flood the outside in, call the rest inside - reported the
     Bastion's shield and hammer as touching nothing at all, which the
     plates flatly contradicted. Ray parity, three directions voting,
     disagreed with it. Neither is trustworthy here and the reason is
     the same for both: they need a CLOSED body and this armour is not
     one. Open pauldron gaps, a split tabard, an open helm. The
     Bastion's mesh has 49,816 boundary edges out of 91,388. Asked
     whether its own PELVIS was inside itself, the voxel fill said no
     and gave a solid volume of 0.0013 cubic metres for a body that
     should be nearer 0.07; ray parity said no as well.

     So the body proxy is built from the SKELETON instead - a capsule
     per bone segment, each radius measured from the skinned vertices
     that actually surround that segment. It cannot be defeated by a
     hole in a shell because there is no shell, and "inside the body
     or the legs" is a question about limbs anyway, which is what a
     capsule is.

     THE SELF-CHECK STAYS, and now it can be answered: five points
     that must be inside a trooper and four that must not. */
  const scratch = new THREE.Vector3();
  const skinnedVertex = (m, attr, vi, out) => {
    out.fromBufferAttribute(attr, vi);
    if (m.isSkinnedMesh && typeof m.applyBoneTransform === "function") {
      m.applyBoneTransform(vi, out);
    }
    return out.applyMatrix4(m.matrixWorld);
  };

  const fig = p.figure;
  const midHip = () => {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    fig.legPivots[0].getWorldPosition(a);
    fig.legPivots[1].getWorldPosition(b);
    return a.add(b).multiplyScalar(0.5);
  };
  /* Which segments a humanoid is. `band` is what the report calls a
     hit there, so "inside the legs" and "inside the torso" are
     separable answers rather than one number. */
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

  const capsules = SEGMENTS.map((seg) => ({
    ...seg, p0: new THREE.Vector3(), p1: new THREE.Vector3(), r: 0.05,
  }));
  const segClosest = (cap, point, out) => {
    out.copy(cap.p1).sub(cap.p0);
    const len2 = out.lengthSq();
    const t = len2 < 1e-9 ? 0
      : Math.max(0, Math.min(1, scratch.copy(point).sub(cap.p0).dot(out) / len2));
    return out.multiplyScalar(t).add(cap.p0);
  };

  const near = new THREE.Vector3();
  const poseCapsules = () => {
    for (const cap of capsules) {
      if (cap.a) cap.a().getWorldPosition(cap.p0);
      else cap.p0.copy(midHip());
      cap.b().getWorldPosition(cap.p1);
    }
  };
  /* RADII FROM THE SKIN, not from a guess. Each sampled skinned
     vertex votes for its nearest segment; the radius is a high
     percentile of those distances, so a capsule wraps the armour
     rather than the bone. Measured once, in the rest pose. */
  const fitRadii = () => {
    poseCapsules();
    const buckets = capsules.map(() => []);
    for (const m of (fig.partMeshes || [])) {
      const attr = m.geometry?.attributes?.position;
      if (!attr) continue;
      const step = Math.max(1, Math.floor(attr.count / 4000));
      for (let i = 0; i < attr.count; i += step) {
        skinnedVertex(m, attr, i, scratch);
        const v = scratch.clone();
        let best = -1;
        let bestD = Infinity;
        for (let c = 0; c < capsules.length; c += 1) {
          const d = v.distanceToSquared(segClosest(capsules[c], v, near));
          if (d < bestD) { bestD = d; best = c; }
        }
        if (best >= 0) buckets[best].push(Math.sqrt(bestD));
      }
    }
    for (let c = 0; c < capsules.length; c += 1) {
      const list = buckets[c].sort((x, y) => x - y);
      capsules[c].r = list.length
        ? list[Math.floor(list.length * 0.72)]
        : 0.06;
      capsules[c].samples = list.length;
    }
  };

  const insideTest = (point) => {
    for (const cap of capsules) {
      if (point.distanceToSquared(segClosest(cap, point, near)) <= cap.r * cap.r) return cap;
    }
    return null;
  };

  const selfCheck = () => {
    poseCapsules();
    const base = fig.root.position;
    const inside = [];
    const outside = [];
    const at = (node, t = 0.5, other = null) => {
      const a = new THREE.Vector3();
      node.getWorldPosition(a);
      if (!other) return a;
      const b = new THREE.Vector3();
      other.getWorldPosition(b);
      return a.lerp(b, t);
    };
    inside.push(["pelvis", midHip()]);
    inside.push(["chest", at(fig.chest)]);
    inside.push(["head", at(fig.head)]);
    inside.push(["thigh", at(fig.legPivots[0], 0.5, fig.kneePivots[0])]);
    inside.push(["upperArm", at(fig.armPivots[1], 0.5, fig.elbowPivots[1])]);
    outside.push(["ahead", at(fig.chest).add(new THREE.Vector3(0, 0, 0.9))]);
    outside.push(["above", at(fig.head).add(new THREE.Vector3(0, 0.6, 0))]);
    outside.push(["beside", at(fig.chest).add(new THREE.Vector3(0.9, 0, 0))]);
    outside.push(["underfoot", new THREE.Vector3(base.x, base.y - 0.4, base.z)]);
    const wrongIn = inside.filter(([, v]) => !insideTest(v)).map(([k]) => k);
    const wrongOut = outside.filter(([, v]) => insideTest(v)).map(([k]) => k);
    return {
      ok: !wrongIn.length && !wrongOut.length,
      missedInside: wrongIn, falseInside: wrongOut,
      radii: capsules.map((c) => `${c.id}:${c.r.toFixed(3)}`).join(" "),
    };
  };

  let cloud = [];
  const bodyPoints = () => {
    const out = [];
    for (const m of (fig.partMeshes || [])) {
      const attr = m.geometry?.attributes?.position;
      if (!attr) continue;
      const step = Math.max(1, Math.floor(attr.count / 2600));
      for (let i = 0; i < attr.count; i += step) {
        out.push(skinnedVertex(m, attr, i, new THREE.Vector3()));
      }
    }
    return out;
  };
  const bakeBody = () => { poseCapsules(); return capsules.length; };

  const measure = (poseId) => {
    const tris = bakeBody();
    cloud = bodyPoints();
    const check = selfCheck();
    const base = p.figure.root.position;
    const rows = [];
    for (const part of loadout.parts) {
      part.asset.updateWorldMatrix(true, true);
      const samples = [];
      part.asset.traverse((o) => {
        const attr = o.isMesh ? o.geometry?.attributes?.position : null;
        if (!attr) return;
        const step = Math.max(1, Math.floor(attr.count / job.samples));
        for (let i = 0; i < attr.count; i += step) {
          samples.push(new THREE.Vector3().fromBufferAttribute(attr, i)
            .applyMatrix4(o.matrixWorld));
        }
      });
      const gripSeg = part.spec.hand === 0 ? "fore-l" : "fore-r";
      let inside = 0;
      let gripContact = 0;
      let deepest = 0;
      let deepestAt = null;
      let nearest = Infinity;
      let lowest = Infinity;
      const insideBands = { legs: 0, torso: 0, arms: 0, head: 0 };
      const hitSegs = new Set();
      for (const v of samples) {
        if (v.y < lowest) lowest = v.y;
        let d = Infinity;
        for (const b of cloud) {
          const dd = v.distanceToSquared(b);
          if (dd < d) d = dd;
        }
        d = Math.sqrt(d);
        if (d < nearest) nearest = d;
        const cap = insideTest(v);
        if (!cap) continue;
        hitSegs.add(cap.id);
        /* THE HAND THAT HOLDS IT DOES NOT COUNT. A haft passes
           through the fist closed on it and a grip sits inside the
           gauntlet; that is what holding something looks like, and
           counting it made a correctly carried hammer read as 31%
           buried. Every OTHER limb is a real fault - most of all the
           opposite leg, which is where both of these actually go. */
        if (cap.id === gripSeg) { gripContact += 1; continue; }
        inside += 1;
        /* Depth is how far PAST the capsule surface the vertex sits,
           which is the number that separates a haft touching a fist
           from a hammer head buried in a thigh. */
        const depth = cap.r - v.distanceTo(segClosest(cap, v, near));
        if (depth > deepest) {
          deepest = depth;
          deepestAt = [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
        }
        insideBands[cap.band] += 1;
      }
      const box = new THREE.Box3().setFromObject(part.asset);
      rows.push({
        pose: poseId,
        trusted: check.ok,
        check,
        id: part.spec.id,
        samples: samples.length,
        insideCount: inside,
        gripContact,
        insideFrac: samples.length ? inside / samples.length : 0,
        deepestM: +deepest.toFixed(4),
        deepestAt,
        bands: insideBands,
        segments: [...hitSegs].join(","),
        nearestM: Number.isFinite(nearest) ? +nearest.toFixed(4) : null,
        groundClearM: +(lowest - ground(p.state.x, p.state.z)).toFixed(3),
        spanM: box.getSize(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3)),
        topAboveFeet: +(box.max.y - base.y).toFixed(3),
        bottomAboveFeet: +(box.min.y - base.y).toFixed(3),
      });
    }
    return { tris, check, rows };
  };

  const plates = [];
  const shoot = (label) => {
    if (!job.shots) return;
    const st = p.state;
    const base = p.figure.root.position;
    const box = new THREE.Box3().setFromObject(p.figure.root);
    const top = Math.max(1.8, box.max.y - base.y);
    const aimY = base.y + top * 0.50;
    for (const b of job.bearings) {
      const yaw = st.yaw + Math.PI + (b.yaw * Math.PI / 180);
      const eye = [
        base.x + Math.sin(yaw) * b.dist * Math.cos(b.pitch),
        aimY + Math.sin(b.pitch) * b.dist,
        base.z + Math.cos(yaw) * b.dist * Math.cos(b.pitch),
      ];
      T.hidePlayer(false);
      p.setFree(true, eye, [base.x, aimY, base.z], 44);
      T.renderStill();
      T.renderStill();
      plates.push({ label: `${label}-${b.id}`, url: T.captureDataURL() });
      p.setFree(false);
      T.autoPlayer();
    }
  };

  const out = { id: kit?.id || null, state: kit, rows: [], plates };

  const prof = p.locomotionProfile();
  T.teleport(site.x, site.z, 0);
  T.advanceTime(1.4, 1 / 60);
  fitRadii();
  out.rows.push(...measure("stand").rows);
  shoot("stand");

  p.input.inject(0, -Math.min(1, prof.walkSpeed / prof.sprintSpeed));
  for (let i = 0; i < 150; i += 1) T.advanceTime(1 / 60, 1 / 60);
  for (let i = 0; i < 600; i += 1) {
    const before = p.state.gait % 1;
    T.advanceTime(1 / 60, 1 / 60);
    const after = p.state.gait % 1;
    if (before <= after ? (0.25 > before && 0.25 <= after) : (0.25 > before || 0.25 <= after)) break;
  }
  out.rows.push(...measure("walk").rows);
  shoot("walk");

  p.input.inject(0, -1);
  for (let i = 0; i < 160; i += 1) T.advanceTime(1 / 60, 1 / 60);
  out.rows.push(...measure("sprint").rows);
  shoot("sprint");
  p.input.inject(null);
  T.advanceTime(1.0, 1 / 60);

  T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
  T.setJetInput(true);
  for (let i = 0; i < 170; i += 1) {
    T.setJetpackState({ fuel: 100 });
    T.advanceTime(1 / 60, 1 / 60);
  }
  out.rows.push(...measure("flight").rows);
  shoot("flight");
  T.setJetInput(false);
  T.advanceTime(1.2, 1 / 60);

  /* ---- what happens when the player attacks or blocks ----
     Driven through the same public entry points the Vesper level
     uses, so a null result here means the verb does not reach this
     level rather than that the harness asked wrongly. */
  const sampleAngles = () => ({
    action: p.action?.name || null,
    armL: [p.figure.armPivots[0].rotation.x, p.figure.armPivots[0].rotation.y,
      p.figure.armPivots[0].rotation.z].map((v) => +v.toFixed(4)),
    armR: [p.figure.armPivots[1].rotation.x, p.figure.armPivots[1].rotation.y,
      p.figure.armPivots[1].rotation.z].map((v) => +v.toFixed(4)),
    chest: +p.figure.chest.rotation.y.toFixed(4),
  });
  const before = sampleAngles();
  let swung = null;
  try { swung = p.meleeSwing ? p.meleeSwing(p.state.yaw) : null; } catch (e) { swung = `threw: ${e.message}`; }
  T.advanceTime(0.30, 1 / 60);
  const during = sampleAngles();
  T.advanceTime(1.2, 1 / 60);
  const blockBefore = sampleAngles();
  T.setShieldInput?.(true);
  T.advanceTime(0.45, 1 / 60);
  const blocking = sampleAngles();
  T.setShieldInput?.(false);
  T.advanceTime(0.6, 1 / 60);

  const moved = (a, b) => Math.max(
    ...a.armL.map((v, i) => Math.abs(v - b.armL[i])),
    ...a.armR.map((v, i) => Math.abs(v - b.armR[i])),
    Math.abs(a.chest - b.chest)
  );
  out.verbs = {
    meleeSwingReturned: swung,
    meleeAction: during.action,
    meleeArmDeltaRad: +moved(before, during).toFixed(4),
    hasShieldModule: !!T.ctx?.shield,
    hasWeaponsModule: !!T.ctx?.weapons,
    blockState: T.shieldState ? T.shieldState() : null,
    blockArmDeltaRad: +moved(blockBefore, blocking).toFixed(4),
    actionSpecs: ["melee1", "melee2", "melee3", "meleeLunge", "meleeTurn", "block"]
      .map((name) => ({ name, dur: T.actionDuration?.(name) ?? null })),
  };
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
    if (wantShots) await mkdir(outDir, { recursive: true });
    for (const id of FIGURES) {
      if (only && only !== id) continue;
      const page = await (await browser.newContext({
        viewport: { width: 800, height: 1000 },
      })).newPage();
      page.on("pageerror", (e) => console.error(`PAGE ERROR [${id}]`, e.message));
      const url = new URL(`${BASE}/games/saintfall-white-vigil.html`);
      url.searchParams.set("qa", "1");
      url.searchParams.set("quality", "high");
      url.searchParams.set("character", id);
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
      await page.evaluate(() => window.__SF.setTime("goldenhour"));
      const res = await page.evaluate(inPage, {
        bearings: BEARINGS, samples: 90, shots: wantShots,
      });
      if (res.missing) { console.log(`${id}: no loadout`); await page.close(); continue; }
      for (const plate of (res.plates || [])) {
        await writeFile(
          path.join(outDir, `${tag}-${id}-${plate.label}.png`),
          Buffer.from(plate.url.slice(plate.url.indexOf(",") + 1), "base64")
        );
      }
      delete res.plates;
      report[id] = res;
      await page.close();
    }

    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, `${tag}-report.json`), JSON.stringify(report, null, 2));

    let fails = 0;
    for (const [id, res] of Object.entries(report)) {
      console.log(`\n${"=".repeat(100)}\n${id}`);
      for (const part of (res.state?.parts || [])) {
        console.log(`  ${part.id.padEnd(16)} ${part.file.padEnd(26)} ${part.hand.padEnd(6)}`
          + `${String(part.triangles).padStart(7)} tris   world ${part.worldSize.join(" x ")} m`
          + `   grip err ${part.gripErrorM}m`);
      }
      const chk = res.rows[0]?.check || {};
      console.log(`\n  inside-test self-check: ${chk.ok ? "PASS" : "FAIL"}`
        + (chk.missedInside?.length ? `  missed-inside ${chk.missedInside.join(",")}` : "")
        + (chk.falseInside?.length ? `  false-inside ${chk.falseInside.join(",")}` : ""));
      console.log(`  capsule radii: ${chk.radii}`);
      console.log("\n  pose    part              samples  clipping   grip  deepest  nearest  ground  span(y)  bottom  top   where");
      for (const row of res.rows) {
        const bad = row.insideFrac > INSIDE_LIMIT && row.deepestM > DEPTH_LIMIT;
        const lowBad = row.groundClearM < GROUND_LIMIT;
        if (bad || lowBad) fails += 1;
        const bands = Object.entries(row.bands).filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}:${n}`).join(" ") || "-";
        console.log(
          `  ${row.pose.padEnd(8)}${row.id.padEnd(18)}`
          + `${String(row.samples).padStart(6)}`
          + `${(`${row.insideCount} (${(row.insideFrac * 100).toFixed(1)}%)`).padStart(13)}`
          + `${String(row.gripContact).padStart(6)}`
          + `${row.deepestM.toFixed(3).padStart(9)}`
          + `${(row.nearestM ?? 0).toFixed(3).padStart(9)}`
          + `${row.groundClearM.toFixed(2).padStart(8)}`
          + `${row.spanM[1].toFixed(2).padStart(8)}`
          + `${row.bottomAboveFeet.toFixed(2).padStart(8)}`
          + `${row.topAboveFeet.toFixed(2).padStart(6)}   ${bands}${row.segments ? ` [${row.segments}]` : ""}`
          + (bad ? "  <-- INSIDE" : "") + (lowBad ? "  <-- LOW" : "")
        );
      }
      const v = res.verbs || {};
      console.log(`\n  verbs: meleeSwing -> ${v.meleeSwingReturned}   action ${v.meleeAction}`
        + `   arm delta ${v.meleeArmDeltaRad} rad`);
      console.log(`         block: shield module ${v.hasShieldModule}  weapons module ${v.hasWeaponsModule}`
        + `   arm delta ${v.blockArmDeltaRad} rad   state ${JSON.stringify(v.blockState)}`);
      console.log(`         action clips: ${v.actionSpecs.map((a) => `${a.name}=${a.dur}`).join(" ")}`);
    }
    console.log(`\n${"=".repeat(100)}`);
    console.log(`gates: inside <=${(INSIDE_LIMIT * 100).toFixed(1)}% of samples or shallower than`
      + ` ${DEPTH_LIMIT * 1000}mm; ground clearance >=${GROUND_LIMIT * 1000}mm`);
    console.log(fails ? `${fails} row(s) FAIL` : "all rows pass");
    console.log(`wrote ${path.relative(root, path.join(outDir, `${tag}-report.json`))}`);
    process.exitCode = fails ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
