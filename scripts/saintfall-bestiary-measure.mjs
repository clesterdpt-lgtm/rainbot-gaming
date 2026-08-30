#!/usr/bin/env node
/* ============================================================
   SAINTFALL - bestiary measurement

   What a creature actually occupies in world metres, per clip, so
   the combat capsules in combat.js are fitted to the model instead
   of guessed at and then argued about across review rounds.

   TWO THINGS THIS GETS RIGHT THAT AN EYEBALLED NUMBER DOES NOT

   1. IT MEASURES ON FLAT GROUND. The review stage sits on a dune
      slope, and these creatures plant their feet procedurally
      against the terrain - so on a slope the downhill legs reach
      half a metre further and the bounding box grows by most of
      that. Measured there, the Thresher came out 1.65m tall against
      a model that is 1.19m; the extra 46cm was slope, not creature,
      and a hit capsule cut to it would have had a shootable third
      that contained nothing.

   2. IT SEPARATES BODY RADIUS FROM LEG SPLAY. A hexapod's widest
      point is its feet, and a capsule cut to the feet means shots
      that pass a metre wide of the animal register as body hits.
      The body radius reported here is a high percentile of the
      per-height-slab radius, which is the mass a player is aiming
      at.

   Usage:
     node scripts/saintfall-bestiary-measure.mjs
     node scripts/saintfall-bestiary-measure.mjs --species thresher
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) args[k] = true;
      else { args[k] = n; i += 1; }
    } else args._.push(t);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || 47000 + (process.pid % 9000));
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve(root, args.out || "output/saintfall/bestiary-measure");
const NEAR = { x: -388, z: -448 };

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const r = await fetch(`${BASE}/games/saintfall.html`, { cache: "no-store" });
      if (r.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* Runs in the page. Walks the skinned vertices in the pose the
   creature is standing in and puts each one into world space
   exactly once. */
const MEASURE = () => {
  const T = window.__SF;
  const THREE = T.THREE;
  const inst = T.enemies.live[0];
  if (!inst) return null;
  let mesh = null;
  inst.root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (!mesh) return null;
  inst.root.updateMatrixWorld(true);

  const v = new THREE.Vector3();
  const origin = new THREE.Vector3(inst.x, inst.y, inst.z);
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const slabs = new Map();
  const n = mesh.geometry.attributes.position.count;
  for (let i = 0; i < n; i += 1) {
    mesh.getVertexPosition(i, v);          // posed, in the mesh's own space
    v.applyMatrix4(mesh.matrixWorld).sub(origin);
    lo.min(v); hi.max(v);
    const slab = Math.floor(v.y / 0.1);
    const r = Math.hypot(v.x, v.z);
    slabs.set(slab, Math.max(slabs.get(slab) || 0, r));
  }

  const rows = [...slabs.entries()].sort((a, b) => a[0] - b[0])
    .map(([s, r]) => [Number((s * 0.1).toFixed(2)), Number(r.toFixed(3))]);
  const sorted = rows.map((r) => r[1]).slice().sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;

  return {
    key: inst.key,
    heightM: Number((hi.y - lo.y).toFixed(3)),
    topM: Number(hi.y.toFixed(3)),
    bottomM: Number(lo.y.toFixed(3)),
    widthM: Number((hi.x - lo.x).toFixed(3)),
    lengthM: Number((hi.z - lo.z).toFixed(3)),
    maxRadiusM: Number(Math.max(...sorted).toFixed(3)),
    bodyRadiusM: Number(pct(0.75).toFixed(3)),
    slabs: rows,
  };
};

/* The flattest patch within a short walk. Anything under about 12cm
   of relief across the creature's own footprint is flat enough that
   the legs solve to a level stance. */
const FIND_FLAT = (near) => {
  const T = window.__SF;
  const g = (x, z) => T.groundHeightAt(x, z);
  let best = null;
  for (let a = 0; a < 220; a += 1) {
    const ang = a * 2.399;
    const d = 6 + a * 0.9;
    const x = near.x + Math.cos(ang) * d;
    const z = near.z + Math.sin(ang) * d;
    const h = g(x, z);
    let relief = 0;
    for (const [dx, dz] of [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4],
      [1.0, 1.0], [-1.0, -1.0]]) {
      relief = Math.max(relief, Math.abs(g(x + dx, z + dz) - h));
    }
    if (!best || relief < best.relief) best = { x, z, relief };
    if (relief < 0.05) break;
  }
  return best;
};

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(),
      null, { timeout: 300000 });

    const flat = await page.evaluate(FIND_FLAT, NEAR);
    console.log(`flat stage at ${flat.x.toFixed(1)}, ${flat.z.toFixed(1)} `
      + `(relief ${flat.relief.toFixed(3)}m)`);

    const speciesList = await page.evaluate(() => window.__SF.listSpecies());
    const wanted = args.species && args.species !== true
      ? String(args.species).split(",").map((s) => s.trim())
      : speciesList;

    const out = [];
    for (const key of wanted) {
      if (!speciesList.includes(key)) { console.warn(`unknown "${key}"`); continue; }
      const clips = await page.evaluate((s) => {
        const T = window.__SF;
        T.clearEnemies();
        if (!T.spawnEnemy(s.key, s.x, s.z, { yaw: 0 })) return null;
        // Long enough that every foot has taken at least one step and
        // settled; measuring mid-stride reports a stride, not a size.
        T.advanceTime(2.5, 1 / 60);
        const inst = T.enemies.live[0];
        // The subject can SEE the trooper the harness left standing
        // nearby, rears into `alert`, and then measures a third taller
        // than it stands. Pinning suspicion is what makes this a
        // measurement of the model rather than of the AI.
        inst.suspicion = 0;
        inst.alerted = false;
        return [...inst.actions.keys()];
      }, { ...flat, key });
      if (!clips) { console.error(`${key}: spawn failed`); continue; }

      const perClip = {};
      for (const clip of clips) {
        await page.evaluate((c) => {
          const inst = window.__SF.enemies.live[0];
          inst.suspicion = 0;
          inst.alerted = false;
          window.__SF.playEnemyClip(c, 0);
          window.__SF.advanceTime(0.6, 1 / 60);
        }, clip);
        perClip[clip] = await page.evaluate(MEASURE);
      }
      const rest = perClip.idle || Object.values(perClip)[0];
      const tallest = Object.entries(perClip)
        .filter(([c]) => c !== "death")
        .reduce((a, b) => (b[1].topM > a[1].topM ? b : a));

      /* Everything above and below this measures a creature that STANDS:
         it is posed on flat ground, its height is read off the top of
         the mesh and its capsule radius off its horizontal spread. A
         burrower breaks every one of those assumptions - it is authored
         lying flat along its own axis, so "widest point" comes back as
         its LENGTH and the suggested capsule is a 24m cylinder.
         The numbers are still worth having; the capsule suggestion is
         not, and printing it anyway is how a wrong hit volume gets
         copied into combat.js by someone trusting this tool. */
      const chained = await page.evaluate(
        () => !!window.__SF.enemies.live[0]?.spine?.length);
      console.log(`\n${key}`);
      console.log(`  rest    ${rest.heightM}m tall · ${rest.widthM}m wide `
        + `· ${rest.lengthM}m long · ${(rest.heightM / 1.85).toFixed(2)}x trooper`);
      if (chained) {
        const chain = await page.evaluate(() => {
          const inst = window.__SF.enemies.live[0];
          return { vertebrae: inst.spine.length, span: +inst.spineLength.toFixed(2),
            segment: +(inst.spineArc[1] - inst.spineArc[0]).toFixed(3) };
        });
        console.log(`  chain   ${chain.vertebrae} vertebrae · ${chain.span}m of body `
          + `· ${chain.segment}m per segment`);
        console.log("  NO CAPSULE. This species is a body chain: its hit volume is a "
          + "run of\n            per-vertebra capsules along the live spine, and its "
          + "radii come\n            from HITBOX.profile rather than from anything "
          + "measurable here.");
      } else {
        console.log(`  radius  body ${rest.bodyRadiusM}m · widest (feet) ${rest.maxRadiusM}m`);
        console.log(`  tallest pose "${tallest[0]}" tops out at ${tallest[1].topM}m`);
        const y1 = tallest[1].topM * 1.04;
        console.log(`  suggested HITBOX  { r: ${rest.bodyRadiusM.toFixed(2)}, `
          + `y0: 0.02, y1: ${y1.toFixed(2)}, head: ?, headR: ? }`);
      }
      out.push({ key, rest, tallest: { clip: tallest[0], ...tallest[1] }, perClip });
    }

    await writeFile(path.join(OUT, "measure.json"), JSON.stringify({
      measuredAt: new Date().toISOString(), stage: flat, species: out,
    }, null, 2));
    console.log(`\nwrote ${path.join(OUT, "measure.json")}`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
