#!/usr/bin/env node
/* ============================================================
   SAINTFALL - jetpack gallery

   A pack is worn on the BACK of a figure that is usually flying away
   from the camera, which is the one bearing a turntable of the pack
   alone never shows. So this photographs each pack where it is
   actually seen: on its own trooper, at the three states the
   articulation has authored endpoints for (stowed, glide, thrust),
   from the four bearings that matter (rear, rear three-quarter,
   profile, and down the back from above).

   It also reports the numbers a picture cannot settle - triangles,
   draw calls, the pack's own bounding box, and how far the nearest
   part of it stands off the armour - because "unique" must not mean
   "twice the cost of the one it replaces", and a pack that floats
   12cm off a backplate reads as a prop however good the model is.

   Usage:
     node scripts/saintfall-jetpack-gallery.mjs --tag before
     node scripts/saintfall-jetpack-gallery.mjs --character bastion-penitent
     node scripts/saintfall-jetpack-gallery.mjs --level vesper --tag seraph
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
const only = arg("--character", null);
const level = arg("--level", "summit");
const outDir = path.resolve(root, arg("--out", "output/saintfall/jetpack-gallery"));
const PORT = 45400 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

const LEVELS = {
  summit: { page: "games/saintfall-white-vigil.html", figures: ["white-vigil", "bastion-penitent"] },
  vesper: { page: "games/saintfall.html", figures: [null] },
};

/* Yaw is measured from DEAD ASTERN, so 0 is the bearing a chase
   camera holds and the one the pack is designed to read from. */
const BEARINGS = [
  { id: "rear", yaw: 0, pitch: 0.06, dist: 2.15 },
  { id: "rear34", yaw: 42, pitch: 0.10, dist: 2.25 },
  { id: "profile", yaw: 90, pitch: 0.04, dist: 2.30 },
  { id: "above", yaw: 18, pitch: 0.62, dist: 2.05 },
];
/* A pack is worn on the back; a weapon is carried in front of the
   body, so the loadout sheet turns the camera all the way round and
   frames the WHOLE figure rather than the shoulder line. */
const LOADOUT_BEARINGS = [
  { id: "front", yaw: 180, pitch: 0.05, dist: 2.6 },
  { id: "front34", yaw: 218, pitch: 0.07, dist: 2.7 },
  { id: "profile", yaw: 270, pitch: 0.04, dist: 2.7 },
  { id: "rear34", yaw: 40, pitch: 0.08, dist: 2.7 },
];

const STATES = ["stowed", "glide", "thrust"];

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer(page) {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${BASE}/${page}`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* Runs IN THE PAGE. Returns measurements plus one data URL per plate. */
function inPage(job) {
  const T = window.__SF;
  const p = T.player;
  const THREE = T.THREE;
  const pack = T.jetpack?.visual || null;

  /* ---- somewhere flat and open to hover over ---- */
  const ground = (x, z) => T.ctx.collide.groundHeight(x, z);
  let site = null;
  for (let ring = 14; ring <= 220 && !(site && site.w < 0.05); ring += 13) {
    for (let k = 0; k < 12; k += 1) {
      const a = (k / 12) * Math.PI * 2 + ring * 0.31;
      const x = Math.cos(a) * ring;
      const z = Math.sin(a) * ring;
      const h = ground(x, z);
      if (!Number.isFinite(h)) continue;
      let worst = 0;
      let clear = true;
      for (let b = 0; b < 12; b += 1) {
        const bb = (b / 12) * Math.PI * 2;
        for (let d = 1.5; d <= 6; d += 1.5) {
          const qx = x + Math.cos(bb) * d;
          const qz = z + Math.sin(bb) * d;
          const qh = ground(qx, qz);
          if (!Number.isFinite(qh)) { clear = false; break; }
          worst = Math.max(worst, Math.abs(qh - h));
          if (T.ctx.collide.blocked(qx, qz, qh)) { clear = false; break; }
        }
        if (!clear) break;
      }
      if (clear && (!site || worst < site.w)) site = { x, z, w: worst };
    }
  }
  site = site || { x: 0, z: 0, w: 9 };

  /* A PACK NEEDS A TALL FRAME. The stage's own canvas is 596x335
     whatever the viewport is, and 16:9 spends its pixels on the snow
     either side of a shoulder-height object. `maximize` hands the
     canvas the viewport, which this harness deliberately runs
     portrait. */
  T.maximize();
  T.teleport(site.x, site.z, 0);
  T.advanceTime(1.0, 1 / 60);

  /* ---- what the pack costs and where it sits ---- */
  const measure = () => {
    if (!pack?.root) return null;
    let tris = 0;
    let meshes = 0;
    const materials = new Set();
    pack.root.traverse((o) => {
      if (!o.isMesh && !o.isPoints) return;
      meshes += 1;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m) materials.add(m.uuid);
      }
      const g = o.geometry;
      if (!g || !g.attributes.position) return;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    });
    pack.root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(pack.root);
    /* HOW FAR THE PACK STANDS OFF THE ARMOUR. Reported as the
       CLOSEST approach, because a coarse probe once read 3mm here
       where the true gap was 122mm and sent two rounds of work
       chasing a contact that did not exist.

       A SKINNED VERTEX IS NOT WHERE ITS BUFFER SAYS IT IS. The
       position attribute holds the BIND pose; the pose you can see
       only exists after the skinning matrices are applied, which
       happens in the vertex shader. Reading the buffer through
       `matrixWorld` measured the T-pose and put the pack 0.91m off a
       back it is nearly touching. `applyBoneTransform` is the same
       maths the shader runs. */
    const v = new THREE.Vector3();
    const backPoints = [];
    pack.root.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes.position) return;
      if (/flame|veil|flare|plume/i.test(o.name || "")) return;
      const pos = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 60));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        backPoints.push(v.clone());
      }
    });
    const bodyPoints = [];
    const base = p.figure.root.position;
    for (const mesh of (p.figure.partMeshes || [])) {
      const pos = mesh.geometry?.attributes?.position;
      if (!pos) continue;
      const skinned = mesh.isSkinnedMesh && typeof mesh.applyBoneTransform === "function";
      const step = Math.max(1, Math.floor(pos.count / 2400));
      for (let i = 0; i < pos.count; i += step) {
        /* `applyBoneTransform` reads the vector you hand it as the
           SOURCE position and writes the skinned result back into the
           same object - it does not fetch the attribute for you. Left
           uninitialised it skins whatever was in the scratch and
           returns points nine kilometres up. */
        v.fromBufferAttribute(pos, i);
        if (skinned) mesh.applyBoneTransform(i, v);
        v.applyMatrix4(mesh.matrixWorld);
        // Torso band only: a boot is not what a backpack can foul.
        if (v.y - base.y < 0.95 || v.y - base.y > 1.85) continue;
        bodyPoints.push(v.clone());
      }
    }
    let standoff = Infinity;
    for (const a of backPoints) {
      for (const b of bodyPoints) {
        const d = a.distanceToSquared(b);
        if (d < standoff) standoff = d;
      }
    }
    standoff = Number.isFinite(standoff) ? Math.sqrt(standoff) : Infinity;
    return {
      triangles: Math.round(tris),
      meshes,
      materials: materials.size,
      spanX: +(box.max.x - box.min.x).toFixed(3),
      spanY: +(box.max.y - box.min.y).toFixed(3),
      spanZ: +(box.max.z - box.min.z).toFixed(3),
      topAboveFeet: +(box.max.y - base.y).toFixed(3),
      standoffM: Number.isFinite(standoff) ? +standoff.toFixed(4) : null,
    };
  };

  const out = { site: { x: +site.x.toFixed(1), z: +site.z.toFixed(1), flat: +site.w.toFixed(3) }, plates: [] };

  const shoot = (label) => {
    const st = p.state;
    const base = p.figure.root.position;
    /* Frame on the PACK, not on the figure: it is a shoulder-height
       object and centring the body puts it in the top third. */
    const aimY = base.y + 1.36;
    for (const b of job.bearings) {
      const yaw = st.yaw + Math.PI + (b.yaw * Math.PI / 180);
      const eye = [
        base.x + Math.sin(yaw) * b.dist * Math.cos(b.pitch),
        aimY + Math.sin(b.pitch) * b.dist,
        base.z + Math.cos(yaw) * b.dist * Math.cos(b.pitch),
      ];
      T.hidePlayer(false);
      p.setFree(true, eye, [base.x, aimY, base.z], 40);
      T.renderStill();
      T.renderStill();
      out.plates.push({ label: `${label}-${b.id}`, url: T.captureDataURL() });
      p.setFree(false);
      T.autoPlayer();
    }
  };

  /* ---- stowed ---- */
  T.setJetInput(false);
  T.advanceTime(1.2, 1 / 60);
  out.stats = measure();
  out.stowed = T.jetpackState();
  shoot("stowed");

  /* ---- thrust: hold the real binding until the pack is flying ---- */
  T.setJetpackState({ fuel: 100, cooldownRemaining: 0, rechargeDelayRemaining: 0 });
  T.setJetInput(true);
  for (let i = 0; i < 150; i += 1) T.advanceTime(1 / 60, 1 / 60);
  out.thrust = T.jetpackState();
  shoot("thrust");

  /* ---- glide: airborne with the throttle released ---- */
  T.setJetInput(false);
  T.advanceTime(0.35, 1 / 60);
  out.glide = T.jetpackState();
  shoot("glide");

  T.setJetInput(false);
  T.setJetpackState({ fuel: 100 });
  return out;
}

async function main() {
  const spec = LEVELS[level];
  if (!spec) throw new Error(`unknown level "${level}"`);
  const server = startServer();
  let browser = null;
  const report = {};
  try {
    await waitForServer(spec.page);
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    await mkdir(outDir, { recursive: true });

    for (const figure of spec.figures) {
      if (only && only !== figure) continue;
      const id = figure || level;
      const page = await (await browser.newContext({
        viewport: { width: 760, height: 940 },
      })).newPage();
      page.on("pageerror", (e) => console.error(`PAGE ERROR [${id}]`, e.message));
      const url = new URL(`${BASE}/${spec.page}`);
      url.searchParams.set("qa", "1");
      url.searchParams.set("quality", "high");
      if (figure) url.searchParams.set("character", figure);
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
      await page.evaluate(() => window.__SF.setTime("goldenhour"));

      const res = await page.evaluate(inPage, { bearings: BEARINGS, states: STATES });
      for (const plate of res.plates) {
        await writeFile(
          path.join(outDir, `${tag}-${id}-${plate.label}.png`),
          Buffer.from(plate.url.slice(plate.url.indexOf(",") + 1), "base64")
        );
      }
      delete res.plates;
      report[id] = res;
      const s = res.stats || {};
      console.log(`\n${id}`);
      console.log(`  ${s.triangles} tris   ${s.meshes} meshes   ${s.materials} materials`);
      console.log(`  span ${s.spanX} x ${s.spanY} x ${s.spanZ} m`
        + `   crown ${s.topAboveFeet}m above the soles`
        + `   standoff ${s.standoffM}m`);
      console.log(`  states: stowed=${res.stowed?.mode} glide=${res.glide?.mode} thrust=${res.thrust?.mode}`);
      await page.close();
    }
    await writeFile(path.join(outDir, `${tag}-stats.json`), JSON.stringify(report, null, 2));
    console.log(`\nplates in ${path.relative(root, outDir)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
