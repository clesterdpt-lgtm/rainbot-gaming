#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Antiphon frame probe

   A small, fast diagnostic for "the level boots and the frame is
   wrong". The shots harness rejects a flat frame and moves on,
   which is correct behaviour for a review tool and useless for
   finding out WHY - and the in-app Browser pane cannot be used
   for this at all, because its `window.innerWidth` is 0, which
   collapses every vw/vh unit on the page and leaves the canvas at
   2x2. That is a property of the pane, not of the level, and it
   has cost this project a diagnosis before.

   So: real Playwright, real GPU Chromium, a real viewport, and
   then read the pixels and the scene rather than photographing
   them.

   Usage:
     node scripts/saintfall-atoll-probe.mjs
     node scripts/saintfall-atoll-probe.mjs --pose lagoon --time vespers
     node scripts/saintfall-atoll-probe.mjs --isolate      # one layer at a time
   ============================================================ */

import { spawn } from "node:child_process";
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
const POSE = String(args.pose || "arrival");
const TIME = String(args.time || "trade");
const QUALITY = String(args.quality || "high");
const PORT = Number(args.port || 43700 + (process.pid % 8000));
const PAGE = String(args.page || "saintfall-green-antiphon.html");
const URL = `http://127.0.0.1:${PORT}/games/${PAGE}`
  + `?qa=1&quality=${QUALITY}&time=${TIME}`;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(URL, { cache: "no-store" }); if (r.ok) return; } catch (_) {}
    await delay(100);
  }
  throw new Error("server never came up");
}

const server = startServer();
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: [
      "--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
      "--disable-gpu-vsync", "--force-device-scale-factor=1",
      "--hide-scrollbars", "--mute-audio",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  const logs = [];
  page.on("console", (m) => { logs.push(`[${m.type()}] ${m.text()}`); });
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => !!window.__SF, null, { timeout: 180000 });
  } catch (e) {
    /* A BOOT THAT NEVER FINISHES IS THE COMMONEST FAILURE HERE, and
       "Timeout exceeded" on its own says nothing. The loader keeps a
       progress bar and an error pane; read both before giving up,
       because the progress percentage alone localises the hang to one
       construction step. */
    const state = await page.evaluate(() => ({
      status: document.getElementById("sf-boot-status")?.textContent,
      fill: document.getElementById("sf-boot-fill")?.style.width,
      err: document.getElementById("sf-boot-error")?.textContent,
    })).catch(() => null);
    console.log("BOOT DID NOT COMPLETE");
    console.log(JSON.stringify(state, null, 1));
    if (logs.length) { console.log("\n--- console ---"); for (const l of logs.slice(0, 40)) console.log(l); }
    throw e;
  }

  const out = await page.evaluate(async ({ pose }) => {
    const T = window.__SF;
    const stage = T.maximize();
    T.setPose(pose);
    for (let i = 0; i < 3; i += 1) T.renderStill();

    const r = T.render.renderer;
    const cv = r.domElement;

    /* --- read the frame straight off the canvas ---------------- */
    async function sample() {
      const url = T.captureDataURL();
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = url; });
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      let min = 255, max = 0, sum = 0, n = 0;
      const hist = new Array(16).fill(0);
      for (let i = 0; i < d.length; i += 4 * 37) {
        const l = (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722);
        if (l < min) min = l; if (l > max) max = l;
        sum += l; n += 1;
        hist[Math.min(15, Math.floor(l / 16))] += 1;
      }
      const grid = [];
      for (const fy of [0.08, 0.28, 0.5, 0.72, 0.92]) {
        const y = Math.floor(fy * img.height); const row = [];
        for (const fx of [0.08, 0.3, 0.5, 0.7, 0.92]) {
          const x = Math.floor(fx * img.width);
          const o = (y * img.width + x) * 4;
          row.push(`${d[o]},${d[o + 1]},${d[o + 2]}`);
        }
        grid.push(row.join("  "));
      }
      return { size: [img.width, img.height], min: Math.round(min), max: Math.round(max),
        mean: Math.round(sum / n), hist, grid };
    }

    const frame = await sample();

    /* --- what is in the scene, and what the centre ray hits ---- */
    const scene = [];
    T.render.scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isInstancedMesh) return;
      const g = o.geometry;
      const tris = g && g.attributes && g.attributes.position
        ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0;
      scene.push({
        name: o.name || o.type,
        visible: o.visible,
        tris: Math.round(tris),
        mat: (o.material && (o.material.name || o.material.type)) || null,
        depthWrite: o.material ? o.material.depthWrite : null,
        transparent: o.material ? o.material.transparent : null,
        renderOrder: o.renderOrder,
        pos: o.position ? [Math.round(o.position.x), Math.round(o.position.y), Math.round(o.position.z)] : null,
      });
    });
    scene.sort((a, b) => b.tris - a.tris);

    const cam = T.render.camera;
    const rays = {};
    for (const [k, u, v] of [["centre", 0.5, 0.5], ["low", 0.5, 0.8], ["lower", 0.5, 0.95], ["left", 0.15, 0.6]]) {
      rays[k] = T.probe ? T.probe(u, v) : null;
    }

    return {
      stage,
      canvas: { attr: [cv.width, cv.height], client: [cv.clientWidth, cv.clientHeight], pr: r.getPixelRatio() },
      win: [window.innerWidth, window.innerHeight],
      camera: { pos: [cam.position.x, cam.position.y, cam.position.z].map((n) => +n.toFixed(1)),
        near: cam.near, far: cam.far, fov: cam.fov },
      frame,
      rays,
      topMeshes: scene.slice(0, 22),
      meshCount: scene.length,
      atmos: T.atmos ? { time: T.atmos.time, exposure: +(T.atmos.exposure || 0).toFixed(3),
        sunDir: [T.atmos.sunDir.x, T.atmos.sunDir.y, T.atmos.sunDir.z].map((n) => +n.toFixed(3)),
        sunIntensity: T.atmos.sunIntensity } : null,
      water: T.render.scene.getObjectByName("atoll-water") ? "present" : "MISSING",
      atollQa: T.atoll ? Object.keys(T.atoll).length : 0,

      /* EVERY COMPOSITE UNIFORM, flattened. A frame that is one flat
         value is nearly always a uniform that is wrong by an order of
         magnitude, and the only way to tell which is to read them
         all rather than to guess three. */
      uniforms: (() => {
        const u = T.render.uniforms || {};
        const out = {};
        for (const k of Object.keys(u)) {
          const v = u[k] && u[k].value;
          if (v === undefined || v === null) { out[k] = null; continue; }
          if (typeof v === "number") out[k] = +v.toFixed(5);
          else if (v.isColor) out[k] = [+v.r.toFixed(3), +v.g.toFixed(3), +v.b.toFixed(3)];
          else if (v.isVector4) out[k] = [v.x, v.y, v.z, v.w].map((n) => +n.toFixed(5));
          else if (v.isVector3) out[k] = [v.x, v.y, v.z].map((n) => +n.toFixed(5));
          else if (v.isVector2) out[k] = [v.x, v.y].map((n) => +n.toFixed(5));
          else if (v.isTexture) out[k] = "texture";
          else out[k] = String(v.constructor && v.constructor.name);
        }
        return out;
      })(),

      /* BLIT tScene STRAIGHT TO THE CANVAS.

         The composite reads sceneTarget.texture and outputs a flat
         value; readRenderTargetPixels on the same target returns
         real content. Those two cannot both be true unless the
         thing the composite is sampling is not the thing the read
         is reading. A trivial textured quad settles it: an image
         here means the texture is fine and the composite's maths is
         at fault; a flat frame here means the texture is not what
         we think it is. */
      /* THE ENGINE'S OWN BLIT. render.js exposes debugBlit precisely
         so an intermediate buffer can be looked at rather than
         reasoned about. If this shows a picture, the scene target
         and the quad pipeline are both fine and the composite
         MATERIAL is the fault. */
      debugBlits: await (async () => {
        const res = {};
        for (const which of ["scene", "ao", "depth"]) {
          try {
            T.render.debugBlit(which);
            const s2 = await sample();
            res[which] = { mean: s2.mean, min: s2.min, max: s2.max };
          } catch (e) { res[which] = "threw: " + e.message; }
        }
        T.renderStill();
        return res;
      })(),

      blitOld: await (async () => {
        try {
          const THREE_ = T.render.camera.constructor.prototype.constructor
            && window.__SF_THREE ? window.__SF_THREE : null;
          const r = T.render.renderer;
          const tex = T.render.targets.sceneTarget.texture;
          const geo = T.render.scene.constructor; // not usable; build via raw GL-free path
          // Reuse three through an existing object's constructor chain.
          const Mesh = T.player.figure && T.player.figure.root
            ? Object.getPrototypeOf(T.player.figure.root).constructor : null;
          if (!Mesh) return "no THREE handle";
          return "skipped";
        } catch (e) { return "threw: " + e.message; }
      })(),

      /* ZERO ONE COMPOSITE TERM AT A TIME.

         The scene target has content and the composite output is
         flat, so the fault is a term in the composite. Rather than
         reason about which, switch each off and re-measure: the one
         that restores a range is the one that was destroying it.
         Restored after each, so the sweep is not cumulative - that
         mistake invalidated a whole A/B round on Kenosis. */
      sweep: await (async () => {
        const u = T.render.uniforms || {};
        const res = {};
        const cases = [
          ["bloom", () => { const p0 = u.uBloom.value; u.uBloom.value = 0; return () => { u.uBloom.value = p0; }; }],
          ["halo", () => { const p0 = u.uHaloAmount.value; u.uHaloAmount.value = 0; return () => { u.uHaloAmount.value = p0; }; }],
          ["ao", () => { const v = u.uAo.value; const p0 = v.x; v.x = 0; return () => { v.x = p0; }; }],
          ["contact", () => { const v = u.uContactGain.value; const p0 = v.x; v.x = 0; return () => { v.x = p0; }; }],
          ["shade", () => { const v = u.uShade.value; const p0 = v.x; v.x = 0; return () => { v.x = p0; }; }],
          ["vignette", () => { const v = u.uVignette.value; const p0 = v.x; v.x = 0; return () => { v.x = p0; }; }],
          ["exposure1", () => { const p0 = u.uExposure.value; u.uExposure.value = 1; return () => { u.uExposure.value = p0; }; }],
          /* IF THE SCENE TEXTURE IS SATURATED, everything above is
             inert by construction - a clipped pixel does not care
             about a toe, a bloom add or an occlusion multiply. Only
             a very large exposure cut can tell the difference
             between "flat because the image is flat" and "flat
             because the image is off the top of the curve". */
          ["exposure0.01", () => { const p0 = u.uExposure.value; u.uExposure.value = 0.01; return () => { u.uExposure.value = p0; }; }],
          ["exposure0.001", () => { const p0 = u.uExposure.value; u.uExposure.value = 0.001; return () => { u.uExposure.value = p0; }; }],
          ["toe1", () => { const p0 = u.uToe.value; u.uToe.value = 1; return () => { u.uToe.value = p0; }; }],
        ];
        for (const [name, apply] of cases) {
          let undo = null;
          try { undo = apply(); } catch (e) { res[name] = "n/a"; continue; }
          T.renderStill();
          const s2 = await sample();
          res[name] = { mean: s2.mean, min: s2.min, max: s2.max };
          if (undo) undo();
        }
        T.renderStill();
        return res;
      })(),

      /* WHAT IS ACTUALLY IN THE SCENE TARGET.

         The composite reads sceneTarget.texture. Sampling the
         canvas tells you what came OUT of the composite; this tells
         you what went IN, which is the only way to place the fault
         on one side of it. Read after a normal renderStill so the
         target holds what the composite last saw. */
      sceneTargetPixels: (() => {
        try {
          const r = T.render.renderer;
          const t = T.render.targets && T.render.targets.sceneTarget;
          if (!t) return "no target";
          const w = t.width, h = t.height;
          const pts = [[w >> 1, (h * 3) >> 2], [w >> 1, h >> 1], [w >> 2, h >> 3], [w >> 1, h >> 4]];
          const out = [];
          /* HALF FLOAT NEEDS A Uint16Array, and passing a
             Float32Array does not throw - WebGL logs
             "INVALID_OPERATION: readPixels: type HALF_FLOAT but
             ArrayBufferView not Uint16Array" as a warning and
             leaves the buffer full of zeros, which reads exactly
             like an empty render target. */
          const half = (h16) => {
            const s0 = (h16 & 0x8000) ? -1 : 1;
            const e = (h16 & 0x7C00) >> 10;
            const f = h16 & 0x03FF;
            if (e === 0) return s0 * Math.pow(2, -14) * (f / 1024);
            if (e === 31) return f ? NaN : s0 * Infinity;
            return s0 * Math.pow(2, e - 15) * (1 + f / 1024);
          };
          for (const [x, y] of pts) {
            const buf = new Uint16Array(4);
            try { r.readRenderTargetPixels(t, x, y, 1, 1, buf); }
            catch (e) { return "readRenderTargetPixels failed: " + e.message; }
            out.push([x, y, [...buf].map((n) => { const v = half(n); return Number.isFinite(v) ? +v.toFixed(4) : String(v); })]);
          }
          return out;
        } catch (e) { return "threw: " + e.message; }
      })(),

      /* THE TARGET SIZES. A composite that upscales a 2x2 scene
         target produces exactly the symptom above - a near-flat
         frame with a gentle vignette - and it is indistinguishable
         from a broken shader by eye. */
      renderStats: T.render.stats ? T.render.stats() : null,
      targets: T.render.targets ? {
        scene: [T.render.targets.sceneTarget.width, T.render.targets.sceneTarget.height],
        samples: T.render.targets.sceneTarget.samples,
        ao: T.render.targets.aoTarget ? [T.render.targets.aoTarget.width, T.render.targets.aoTarget.height] : null,
      } : null,

      /* THE SCENE WITHOUT THE COMPOSITE.

         If every layer can be hidden with no change to the frame,
         the fault is not in a layer - it is that the composite is
         not reading the scene at all. Rendering the scene straight
         to the default framebuffer separates those two in one
         call: a picture here and a flat frame above means the post
         chain; flat in both means the scene pass. */
      raw: await (async () => {
        const r = T.render.renderer;
        const prevTarget = r.getRenderTarget();
        r.setRenderTarget(null);
        r.render(T.render.scene, T.render.camera);
        const s2 = await sample();
        r.setRenderTarget(prevTarget);
        T.renderStill();
        return { mean: s2.mean, min: s2.min, max: s2.max, grid: s2.grid };
      })(),

      /* WHAT HAPPENS WHEN EACH LAYER IS TAKEN AWAY. A flat frame
         with a fullscreen occluder in it and a flat frame with a
         broken composite look identical; hiding one layer at a time
         separates them in one run. */
      isolate: await (async () => {
        const names = ["sky", "atoll-water", "terrain", "vfx", "atoll-weather"];
        const res = {};
        for (const n of names) {
          const o = T.render.scene.getObjectByName(n);
          if (!o) { res[n] = "absent"; continue; }
          const was = o.visible;
          o.visible = false;
          T.renderStill();
          const s2 = await sample();
          res[n] = { mean: s2.mean, min: s2.min, max: s2.max, centre: s2.grid[2].split("  ")[2] };
          o.visible = was;
        }
        T.renderStill();
        return res;
      })(),
    };
  }, { pose: POSE });

  console.log(JSON.stringify(out, null, 1));
  if (logs.length) {
    console.log("\n--- console ---");
    for (const l of logs.slice(0, 30)) console.log(l);
  }
} catch (err) {
  console.error(err && (err.stack || err.message));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill();
}
