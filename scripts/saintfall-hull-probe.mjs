#!/usr/bin/env node
/* ============================================================
   SAINTFALL - THE GREEN ANTIPHON - hull probe

   "The hull is a value-2 slab" is a claim about a SUBSET of the
   frame's pixels, and every frame-wide instrument this level owns
   averages that subset away. The Hold barge is about 4 % of
   hold.png; a frame mean moves by less than a level when the whole
   ship goes from black to white.

   So this probe MASKS THE SHIP and reports on nothing else.

   How the mask is built, and why it is a difference rather than a
   depth or a stencil: render the frame, hide every group whose
   name begins "antiphon-" plus the wreck's own scatter, render
   again, and take the pixels that moved by more than 3/255 in any
   channel. That catches the hull AND everything the hull was
   occluding-into (its own cast shadow does not move, because the
   shadow map is not re-rendered - which is exactly what we want:
   the mask is the ship's own body).

   What it reports for the masked set:
     - the luminance ladder (p1..p99) in sRGB display levels, which
       is the units the judges' "value 2" is stated in - a 0..10
       scale where 10 is white, so a display level of 51 is value 2.
     - mean RGB and the BLUE MINUS RED figure, which is the
       rubric's colour axis as a number.
     - the fraction under level 26 (value 1) and under 51 (value 2).
     - a "ladder occupancy" count: how many of the ten value bands
       hold at least 1.5 % of the ship's pixels. The winning frame
       was praised for "a full value ladder"; this counts it.

   And then it A/Bs the causes ON THE MASK, one at a time, undoing
   each before the next:
     albedo   - the vertex colour forced to a mid grey
     fill     - uFill.x zeroed on every hull material
     ao       - the composite's AO term zeroed
     contact  - the composite's contact term zeroed
     sun      - the key light's intensity zeroed
     env      - scene.environment removed

   The one that moves the ladder is the one at fault. Round 7's
   agents changed HULL_RAMP first and it did nothing, which is a
   whole round spent on the wrong term.

   Geometry, separately, because "a big flat plate has no normal
   variation" is a geometric claim and pixels cannot settle it:
   every triangle of every wreck mesh is area-weighted into an
   n-dot-l histogram against the live sun direction.

   Usage:
     node scripts/saintfall-hull-probe.mjs --pose hold --time trade
     node scripts/saintfall-hull-probe.mjs --pose hold --ab
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
const POSES = String(args.pose || args.poses || "hold").split(",").map((s) => s.trim());
const TIME = String(args.time || "trade");
const QUALITY = String(args.quality || "ultra");
const AB = !!args.ab;
const PORT = Number(args.port || 44100 + (process.pid % 6000));
const PAGE = String(args.page || "saintfall-green-antiphon.html");
const URL = `http://127.0.0.1:${PORT}/games/${PAGE}`
  + `?qa=1&quality=${QUALITY}&time=${TIME}`;

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

async function waitForServer() {
  for (let i = 0; i < 200; i += 1) {
    try { const r = await fetch(URL, { cache: "no-store" }); if (r.ok) return; } catch (_) {}
    await delay(100);
  }
  throw new Error("server never came up");
}

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
  page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
  page.on("pageerror", (e) => logs.push("[pageerror] " + e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__SF, null, { timeout: 240000 });

  const out = await page.evaluate(async ({ poses, ab }) => {
    const T = window.__SF;
    T.maximize();

    /* ---- pixels ------------------------------------------------ */
    async function grab() {
      const url = T.captureDataURL();
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = url; });
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      return { d: g.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
    }

    /* Every group that is part of the wreck. The Drive is built
       inline in atoll-world under its own name; the other three
       name themselves in atoll-structures. */
    function wreckRoots() {
      const found = [];
      T.render.scene.traverse((o) => {
        if (typeof o.name === "string" && /^antiphon-/.test(o.name)) found.push(o);
      });
      return found;
    }

    /* Report on one masked set. `mask` is a Uint8Array flag per
       pixel. Everything is in DISPLAY sRGB levels 0..255, because
       that is the space a judge's eye and the word "value 2" both
       live in. */
    function stats(d, mask) {
      const lum = [];
      let r = 0, g = 0, b = 0, n = 0;
      const band = new Array(10).fill(0);   // ten value steps, 0..9
      for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
        if (!mask[i]) continue;
        const R = d[p], G = d[p + 1], B = d[p + 2];
        const l = R * 0.2126 + G * 0.7152 + B * 0.0722;
        lum.push(l);
        r += R; g += G; b += B; n += 1;
        band[Math.min(9, Math.floor(l / 25.6))] += 1;
      }
      if (!n) return null;
      lum.sort((x, y) => x - y);
      const q = (f) => +lum[Math.min(lum.length - 1, Math.floor(f * lum.length))].toFixed(1);
      const under = (v) => +(lum.filter((x) => x < v).length / n * 100).toFixed(1);
      return {
        px: n,
        mean: [+(r / n).toFixed(1), +(g / n).toFixed(1), +(b / n).toFixed(1)],
        blueMinusRed: +((b - r) / n).toFixed(1),
        p01: q(0.01), p10: q(0.10), p50: q(0.50), p90: q(0.90), p99: q(0.99),
        range10to90: +(q(0.90) - q(0.10)).toFixed(1),
        pctUnderValue1: under(25.6),
        pctUnderValue2: under(51.2),
        /* How many of the ten value steps hold >= 1.5 % of the
           ship. "A full value ladder" counted. */
        ladderSteps: band.filter((c) => c / n >= 0.015).length,
        bandPct: band.map((c) => +(c / n * 100).toFixed(1)),
      };
    }

    /* THE MASK IS A SILHOUETTE RENDER, NOT A DIFFERENCE.

       The first version of this probe took the mask as "pixels that
       moved when the wreck was hidden", and on `spine` it selected
       37.9 % of the frame - the whole ocean. Hiding the ship changes
       the water's reflection, the AO buffer and the composite's own
       dither everywhere at once, so a difference mask measures the
       frame's noise floor rather than the ship.

       So: hide everything that is not the wreck, clear to pure
       green, and render the scene STRAIGHT to the default
       framebuffer with no composite. Any pixel that is not pure
       green is the ship. The grade does not run, which is exactly
       right - a mask must not depend on the thing being measured.
       The STATS are then read off the normal composited frame. */
    async function maskedStats() {
      T.renderStill();
      const A = await grab();

      const roots = new Set(wreckRoots());
      const scene = T.render.scene;
      const hidden = [];
      scene.traverse((o) => {
        if (o === scene || roots.has(o)) return;
        let anc = o.parent;
        while (anc) { if (roots.has(anc)) return; anc = anc.parent; }
        if (o.visible && (o.isMesh || o.isPoints || o.isInstancedMesh)) {
          hidden.push(o); o.visible = false;
        }
      });
      /* The wreck's own materials, forced to unshaded white. Not a
         clone: cloning a patched material re-runs onBeforeCompile
         and a second program per material costs more than the
         restore does. `emissive` survives every extend in this
         file because they all write `diffuseColor` or add to
         `outgoingLight` before the emissive add. */
      const swapped = [];
      for (const m of hullMaterials()) {
        swapped.push([m, m.emissive ? m.emissive.getHex() : null,
          m.emissiveIntensity, m.vertexColors, m.color.getHex()]);
        if (m.emissive) m.emissive.setRGB(1, 1, 1);
        m.emissiveIntensity = 1;
        m.vertexColors = false;
        m.color.setRGB(0, 0, 0);
        m.needsUpdate = true;
      }
      const r = T.render.renderer;
      const prevTarget = r.getRenderTarget();
      const bg = scene.background;
      scene.background = null;
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, true);
      r.render(scene, T.render.camera);
      const S = await grab();
      scene.background = bg;
      hidden.forEach((o) => { o.visible = true; });
      for (const [m, em, ei, vc, col] of swapped) {
        if (em !== null && m.emissive) m.emissive.setHex(em);
        m.emissiveIntensity = ei;
        m.vertexColors = vc;
        m.color.setHex(col);
        m.needsUpdate = true;
      }
      r.setRenderTarget(prevTarget);
      T.renderStill();

      const mask = new Uint8Array(A.w * A.h);
      let n = 0;
      for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
        /* 200, not 8: a silhouette edge pixel is a partial coverage
           blend of white ship and black plate, and in the REAL frame
           that same pixel is half sky. Half-sky pixels dragged the
           ladder up by a whole band. Only interior ship counts. */
        if (S.d[p + 1] > 200) { mask[i] = 1; n += 1; }
      }
      return { mask, n, w: A.w, h: A.h, A };
    }

    /* ---- geometry: the n-dot-l ladder -------------------------- */
    function normalLadder() {
      const sun = T.atmos.sunDir;
      const sx = sun.x, sy = sun.y, sz = sun.z;
      const bins = new Array(12).fill(0);   // n.l from -1 to 1
      let area = 0;
      const v = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (const root of wreckRoots()) {
        root.updateWorldMatrix(true, true);
        root.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          const g = o.geometry;
          const pos = g && g.attributes && g.attributes.position;
          if (!pos) return;
          const m = o.matrixWorld.elements;
          const idx = g.index ? g.index.array : null;
          const tri = idx ? idx.length / 3 : pos.count / 3;
          /* Stride so a two-million-triangle wreck stays under a
             second. Area weighting makes the stride unbiased. */
          const step = Math.max(1, Math.floor(tri / 60000));
          for (let t = 0; t < tri; t += step) {
            for (let k = 0; k < 3; k += 1) {
              const i = idx ? idx[t * 3 + k] : t * 3 + k;
              const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
              v[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
              v[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
              v[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
            }
            const ax = v[3] - v[0], ay = v[4] - v[1], az = v[5] - v[2];
            const bx = v[6] - v[0], by = v[7] - v[1], bz = v[8] - v[2];
            let nx = ay * bz - az * by;
            let ny = az * bx - ax * bz;
            let nz = ax * by - ay * bx;
            const L = Math.hypot(nx, ny, nz);
            if (!(L > 1e-9)) continue;
            const a = 0.5 * L * step;
            nx /= L; ny /= L; nz /= L;
            const ndl = nx * sx + ny * sy + nz * sz;
            bins[Math.min(11, Math.floor((ndl + 1) * 6))] += a;
            area += a;
          }
        });
      }
      if (!area) return null;
      return {
        areaM2: Math.round(area),
        /* Fraction of the ship's surface area in each n.l band.
           Bands 0..5 are facing away from the sun (shade side),
           6..11 are lit. */
        ndlPct: bins.map((c) => +(c / area * 100).toFixed(1)),
        shadePct: +(bins.slice(0, 6).reduce((a, c) => a + c, 0) / area * 100).toFixed(1),
        /* The number that decides whether "no facet response" is a
           geometry fault: how much of the LIT area sits inside one
           n.l band. A slab puts all of it in one. */
        litSpreadTopBand: +(Math.max(...bins.slice(6)) /
          Math.max(1e-9, bins.slice(6).reduce((a, c) => a + c, 0)) * 100).toFixed(1),
      };
    }

    /* ---- the A/B cases ----------------------------------------- */
    function hullMaterials() {
      const seen = new Set();
      const out = [];
      for (const root of wreckRoots()) {
        root.traverse((o) => {
          const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          for (const m of ms) {
            if (!m || seen.has(m.uuid)) continue;
            seen.add(m.uuid); out.push(m);
          }
        });
      }
      return out;
    }

    /* THE DIAGNOSTIC CAMERAS, derived exactly as the hull sheet
       derives them so a number here and a picture there are the
       same view. `flank` and `band` are the two the whole defect
       lives on: 400 m of shade-side shell, and the tide bands. */
    const st = T.atoll.stations();
    const by = {}; for (const s of st) by[s.id] = s;
    const sp = by.spine || by.hold;
    const sunB = Math.atan2(T.atmos.sunDir.x, T.atmos.sunDir.z);
    const R = (a, r) => [sp.x + Math.sin(a) * r, sp.z + Math.cos(a) * r];
    const CUSTOM = {
      flank: [R(sunB + Math.PI + 0.9, 120), 26, [sp.x, 22, sp.z], 52],
      lit: [R(sunB + 0.9, 120), 26, [sp.x, 22, sp.z], 52],
      band: [R(sunB + Math.PI, 110), 4.0, [sp.x, 2.0, sp.z], 24],
    };

    const results = {};
    for (const pose of poses) {
      if (CUSTOM[pose]) {
        const [p, y, t, fov] = CUSTOM[pose];
        T.lookAt([p[0], y, p[1]], t, fov);
      } else T.setPose(pose);
      for (let i = 0; i < 3; i += 1) T.renderStill();

      const m = await maskedStats();
      const base = stats(m.A.d, m.mask);

      const rec = {
        pose,
        maskPx: m.n,
        maskPctOfFrame: +(m.n / (m.w * m.h) * 100).toFixed(2),
        sunDir: [T.atmos.sunDir.x, T.atmos.sunDir.y, T.atmos.sunDir.z].map((v) => +v.toFixed(3)),
        exposure: +(T.atmos.exposure || 0).toFixed(3),
        base,
        geometry: normalLadder(),
      };

      if (ab) {
        const mats = hullMaterials();
        const u = T.render.uniforms || {};
        const cases = [
          ["fill=0", () => {
            const saved = [];
            for (const mm of mats) {
              const s = mm.userData && mm.userData.sfShader;
              if (s && s.uniforms && s.uniforms.uFill) {
                saved.push([s.uniforms.uFill.value, s.uniforms.uFill.value.x]);
                s.uniforms.uFill.value.x = 0;
              }
            }
            return () => saved.forEach(([v, x]) => { v.x = x; });
          }],
          ["bevel=0", () => {
            const saved = [];
            for (const mm of mats) {
              const s = mm.userData && mm.userData.sfShader;
              if (s && s.uniforms && s.uniforms.uPlateB) {
                saved.push([s.uniforms.uPlateB.value, s.uniforms.uPlateB.value.w]);
                s.uniforms.uPlateB.value.w = 0;
              }
            }
            return () => saved.forEach(([v, w]) => { v.w = w; });
          }],
          ["fill=x3", () => {
            const saved = [];
            for (const mm of mats) {
              const s = mm.userData && mm.userData.sfShader;
              if (s && s.uniforms && s.uniforms.uFill) {
                saved.push([s.uniforms.uFill.value, s.uniforms.uFill.value.x]);
                s.uniforms.uFill.value.x *= 3;
              }
            }
            return () => saved.forEach(([v, x]) => { v.x = x; });
          }],
          ["albedo=midgrey", () => {
            const saved = mats.map((mm) => [mm, mm.vertexColors, mm.color.clone()]);
            for (const mm of mats) { mm.vertexColors = false; mm.color.setRGB(0.25, 0.25, 0.25); mm.needsUpdate = true; }
            return () => saved.forEach(([mm, vc, c]) => { mm.vertexColors = vc; mm.color.copy(c); mm.needsUpdate = true; });
          }],
          ["ao=0", () => {
            if (!u.uAo) return () => {};
            const v = u.uAo.value; const p = v.x; v.x = 0; return () => { v.x = p; };
          }],
          ["contact=0", () => {
            if (!u.uContactGain) return () => {};
            const v = u.uContactGain.value; const p = v.x; v.x = 0; return () => { v.x = p; };
          }],
          ["shade=0", () => {
            if (!u.uShade) return () => {};
            const v = u.uShade.value; const p = v.x; v.x = 0; return () => { v.x = p; };
          }],
          ["env=null", () => {
            const e = T.render.scene.environment;
            T.render.scene.environment = null;
            return () => { T.render.scene.environment = e; };
          }],
          ["envx3", () => {
            const e = T.render.scene.environmentIntensity;
            T.render.scene.environmentIntensity = (e ?? 1) * 3;
            return () => { T.render.scene.environmentIntensity = e; };
          }],
          ["sun=0", () => {
            const saved = [];
            T.render.scene.traverse((o) => {
              if (o.isDirectionalLight) { saved.push([o, o.intensity]); o.intensity = 0; }
            });
            return () => saved.forEach(([o, i]) => { o.intensity = i; });
          }],
          ["shadowmap=off", () => {
            const r = T.render.renderer;
            const p = r.shadowMap.enabled;
            r.shadowMap.enabled = false;
            return () => { r.shadowMap.enabled = p; };
          }],
        ];
        rec.ab = {};
        for (const [name, apply] of cases) {
          let undo = null;
          try { undo = apply(); } catch (e) { rec.ab[name] = "threw: " + e.message; continue; }
          T.renderStill(); T.renderStill();
          const g2 = await grab();
          const s = stats(g2.d, m.mask);
          rec.ab[name] = s ? {
            mean: s.mean, p10: s.p10, p50: s.p50, p90: s.p90,
            blueMinusRed: s.blueMinusRed, ladderSteps: s.ladderSteps,
            pctUnderValue2: s.pctUnderValue2,
          } : null;
          if (undo) undo();
          T.renderStill();
        }
      }
      results[pose] = rec;
    }
    return results;
  }, { poses: POSES, ab: AB });

  console.log(JSON.stringify(out, null, 1));
  if (logs.length) { console.log("\n--- errors ---"); logs.slice(0, 12).forEach((l) => console.log(l)); }
} catch (err) {
  console.error(err && (err.stack || err.message));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill();
}
