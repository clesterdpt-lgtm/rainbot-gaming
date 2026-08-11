#!/usr/bin/env node
/* ============================================================
   BLACKSAND - close-range material probe

   Every beauty shot in the suite is framed at 15-300m. The blind art
   director's strongest surface complaints are all about 2-5m:

     "no near-field detail tile - at 2-5m the ground is a smooth
      blurred wash"
     "albedo-only shading, nothing has a specular lobe"
     "sand at grazing angle should sheen; it doesn't"
     "hard splatmap seams with no height-based blend"

   None of those are answerable from a 60m establishing shot, so this
   probe stands the camera 2-3m off each surface and measures four
   things that a screenshot metric cannot see:

   1. OCTAVE ENERGY. A band-pass pyramid on the luma plane. Reported in
      centimetres per band using the pose's own metres-per-pixel, so
      "there is no detail below 10cm" is a number rather than an
      impression. A surface whose energy is all in the 30cm+ bands with
      nothing under 5cm IS the "smooth blurred wash" being described.

   2. NORMAL MAP DIFFERENTIAL, per material class. Switch the normal
      contribution off and diff the frame. Done at a low sun so the
      cosine term has somewhere to go. A material whose frame does not
      move is a material whose normal map is not reaching the shader,
      whatever the code says.

   3. SPECULAR ISOLATION. Set the material's albedo to black and
      re-render: what is left is the specular lobe alone, direct plus
      IBL. This answers "is there a specular lobe" directly instead of
      inferring it, and comparing the grazing pose against the
      face-on pose answers "does it sheen at grazing angle".

   4. ROUGHNESS DIFFERENTIAL. Flatten the roughness to a constant and
      diff. Measures whether the authored roughness spread survives to
      the frame, which is a different question from whether a material
      has a roughness map.

   Auto exposure is pinned off for every A/B - it renormalises the
   frame and would eat exactly the difference being measured.

   Usage:
     node scripts/blacksand-close-probe.mjs
     node scripts/blacksand-close-probe.mjs --out output/blacksand-close/mat-1
     node scripts/blacksand-close-probe.mjs --hour 7.4 --quality ultra
   ============================================================ */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

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
const PORT = Number(args.port || 47000 + (process.pid % 1500));
const BASE = `http://127.0.0.1:${PORT}`;
const QUALITY = String(args.quality || "high");
const HOUR = args.hour === undefined ? 7.4 : Number(args.hour);
const OUT = path.resolve(root, String(args.out || "output/blacksand-close/latest"));
const ONLY = args.only ? String(args.only).split(",").map((s) => s.trim()) : null;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const r = await fetch(`${BASE}/games/blacksand.html`, { cache: "no-store" });
      if (r.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

/* ------------------------- image analysis ------------------------- */

/** Decode a data URL into { w, h, luma:Float32Array, rgb:Uint8Array }. */
async function decode(dataUrl) {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const { data, info } = await sharp(buf).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const luma = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    luma[i] = 0.2126 * data[i * 3] + 0.7152 * data[i * 3 + 1] + 0.0722 * data[i * 3 + 2];
  }
  return { w: info.width, h: info.height, luma, rgb: data };
}

/** Summed-area table, so a box blur of any radius is O(1) per pixel. */
function integral(src, w, h) {
  const s = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += src[y * w + x];
      s[(y + 1) * (w + 1) + (x + 1)] = s[y * (w + 1) + (x + 1)] + row;
    }
  }
  return s;
}

function boxBlur(src, w, h, radius) {
  if (radius <= 0) return src;
  const s = integral(src, w, h);
  const out = new Float32Array(w * h);
  const W = w + 1;
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w - 1, x + radius);
      const area = (y1 - y0 + 1) * (x1 - x0 + 1);
      out[y * w + x] = (s[(y1 + 1) * W + (x1 + 1)] - s[y0 * W + (x1 + 1)]
        - s[(y1 + 1) * W + x0] + s[y0 * W + x0]) / area;
    }
  }
  return out;
}

/**
 * Band-pass energy per spatial octave, in luma counts (0..255).
 *
 * band[k] = mean| blur(r=2^k) - blur(r=2^(k+1)) | over the crop, i.e.
 * how much contrast lives at roughly 2^(k+1) pixels. A real surface at
 * arm's length puts most of its energy in the 1-4px bands; a magnified
 * mip or an albedo-only wash puts all of it above 16px.
 */
function octaveEnergy(luma, w, h, crop) {
  const { x0, y0, x1, y1 } = crop;
  const cw = x1 - x0;
  const ch = y1 - y0;
  const sub = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) sub[y * cw + x] = luma[(y0 + y) * w + (x0 + x)];
  }
  const radii = [0, 1, 2, 4, 8, 16, 32];
  const blurs = radii.map((r) => boxBlur(sub, cw, ch, r));
  const bands = [];
  for (let k = 0; k < radii.length - 1; k += 1) {
    let sum = 0;
    for (let i = 0; i < sub.length; i += 1) sum += Math.abs(blurs[k][i] - blurs[k + 1][i]);
    bands.push(sum / sub.length);
  }
  let mean = 0;
  for (let i = 0; i < sub.length; i += 1) mean += sub[i];
  mean /= sub.length;
  let sd = 0;
  for (let i = 0; i < sub.length; i += 1) sd += (sub[i] - mean) ** 2;
  return {
    bands,                        // ~2px, 4px, 8px, 16px, 32px, 64px
    mean,
    sd: Math.sqrt(sd / sub.length),
  };
}

/**
 * Coverage mask for one material, taken for free out of the
 * albedo-black frame.
 *
 * A whole-frame diff is only a per-material diff when the frame is
 * that material, and none of these poses are. Zeroing a material's
 * albedo changes exactly the pixels that material shades, so the same
 * capture that isolates the specular lobe also says which pixels to
 * trust - "26.9% of the frame moved" turns into "of the pixels this
 * material actually covers, 78% moved", which is the number the claim
 * is about.
 */
function coverageMask(base, black, w, h, threshold = 3) {
  const mask = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0; i < w * h; i += 1) {
    if (base[i] - black[i] > threshold) { mask[i] = 1; n += 1; }
  }
  return { mask, count: n, fraction: n / (w * h) };
}

/** Fraction of masked pixels that moved, and the mean magnitude. */
function diffStats(a, b, w, h, crop, mask = null, threshold = 2) {
  const { x0, y0, x1, y1 } = crop;
  let moved = 0;
  let sum = 0;
  let peak = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = y * w + x;
      if (mask && !mask[i]) continue;
      const d = Math.abs(a[i] - b[i]);
      sum += d;
      if (d > peak) peak = d;
      if (d > threshold) moved += 1;
      n += 1;
    }
  }
  if (!n) return { moved: 0, mean: 0, peak: 0, n: 0 };
  return { moved: moved / n, mean: sum / n, peak, n };
}

/**
 * Strongest periodic repeat along the crop's horizontal axis.
 *
 * "Obvious tiling period - the brick sequence repeats every ~8 bricks"
 * is a claim about periodicity, which is not something the eye can be
 * trusted on and not something an octave-energy measure can see. The
 * column means of a wall crop, mean-removed and autocorrelated, put a
 * number on it: a surface with no repeat decays smoothly toward zero,
 * a tiled one puts a spike at its period. Reported as the peak
 * normalised correlation over lags of 12px and up, so the width of a
 * single brick does not count as a repeat.
 */
function repeatPeak(luma, w, h, crop) {
  const { x0, y0, x1, y1 } = crop;
  const n = x1 - x0;
  const col = new Float64Array(n);
  for (let x = 0; x < n; x += 1) {
    let s = 0;
    for (let y = y0; y < y1; y += 1) s += luma[y * w + (x0 + x)];
    col[x] = s / (y1 - y0);
  }
  // Remove a linear trend as well as the mean: a wall lit from one
  // side has a luma ramp across it, and a ramp autocorrelates strongly
  // at every lag, which would swamp any real period.
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  for (let i = 0; i < n; i += 1) { sx += i; sy += col[i]; sxx += i * i; sxy += i * col[i]; }
  const slope = (n * sxy - sx * sy) / Math.max(1e-9, n * sxx - sx * sx);
  const inter = (sy - slope * sx) / n;
  for (let i = 0; i < n; i += 1) col[i] -= slope * i + inter;
  let denom = 0;
  for (let i = 0; i < n; i += 1) denom += col[i] * col[i];
  if (denom < 1e-9) return { peak: 0, lag: 0 };
  let best = { peak: 0, lag: 0 };
  for (let lag = 12; lag < Math.floor(n * 0.55); lag += 1) {
    let acc = 0;
    for (let i = 0; i + lag < n; i += 1) acc += col[i] * col[i + lag];
    const r = acc / denom;
    if (r > best.peak) best = { peak: r, lag };
  }
  return best;
}

/** Mean of `src` over the masked pixels inside the crop. */
function maskedMean(src, w, h, crop, mask) {
  const { x0, y0, x1, y1 } = crop;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = y * w + x;
      if (mask && !mask[i]) continue;
      sum += src[i];
      n += 1;
    }
  }
  return n ? sum / n : 0;
}

/** Median linear-RGB, hue and saturation over the material's own pixels. */
function colourStats(rgb, w, h, crop, mask = null) {
  const { x0, y0, x1, y1 } = crop;
  const cols = [[], [], []];
  const toLinear = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      if (mask && !mask[y * w + x]) continue;
      const i = (y * w + x) * 3;
      cols[0].push(toLinear(rgb[i]));
      cols[1].push(toLinear(rgb[i + 1]));
      cols[2].push(toLinear(rgb[i + 2]));
    }
  }
  if (!cols[0].length) return { rgb: [0, 0, 0], hue: 0, sat: 0, luma: 0 };
  const med = cols.map((c) => { c.sort((p, q) => p - q); return c[Math.floor(c.length / 2)]; });
  const [r, g, b] = med;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 1e-9) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return {
    rgb: med,
    hue,
    sat: max > 1e-9 ? d / max : 0,
    luma: 0.2126 * r + 0.7152 * g + 0.0722 * b,
  };
}

/* --------------------------- page helpers --------------------------- */

/**
 * Find one close-range camera pose per material class.
 *
 * For a wall the camera goes on the surface normal at `standoff`; for
 * the ground it goes `eye` metres up and pitches down, which is the
 * view the reviewer described and the one no beauty shot samples.
 */
function findPoses() {
  const T = window.__BS;
  const THREE = T.THREE;
  const scene = T.ctx.render.camera.parent ? T.ctx.render.scene : T.ctx.render.scene;
  const terrain = T.ctx.terrain;
  const out = {};

  /* ---- ground poses ----
     The spot has to be open terrain. The first version scored purely
     on flatness and every winner was a graded building pad, so the
     "2m above the ground" pose ended up inside a room photographing a
     ceiling. Anything with a structure overhead or within 12m is
     rejected outright. */
  const physics = T.ctx.physics;
  const up = new THREE.Vector3(0, 1, 0);
  // Deterministic: Math.random() here gave a different patch of desert
  // every run, so a round-over-round comparison of octave energy was
  // comparing two different places.
  let rngState = 0x2f6e2b1;
  const rand = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  };
  const openSpot = (cx, cz, radius, want) => {
    let best = null;
    for (let i = 0; i < 6000; i += 1) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!terrain.inBounds(x, z)) continue;
      const h = terrain.heightAt(x, z);
      const eye = new THREE.Vector3(x, h + 2.2, z);
      if (physics.raycast(eye, up, 40, { layer: physics.LAYER.STATIC }).hit) continue;
      let blocked = false;
      for (let k = 0; k < 8 && !blocked; k += 1) {
        const t = (k / 8) * Math.PI * 2;
        const d = new THREE.Vector3(Math.cos(t), 0, Math.sin(t));
        if (physics.raycast(eye, d, 12, { layer: physics.LAYER.STATIC }).hit) blocked = true;
      }
      if (blocked) continue;
      const slope = terrain.slopeAt(x, z);
      const score = want === "flat" ? -Math.abs(slope - 0.04) : slope;
      if (best === null || score > best.score) best = { x, z, slope, score };
    }
    return best;
  };

  const flat = openSpot(-40, 60, 110, "flat") || openSpot(0, 0, 220, "flat");
  const steep = openSpot(-186, 208, 130, "steep") || flat;

  /* A separate spot for the detail-reach walk, chosen for FETCH rather
     than flatness: the ground has to stay unobstructed for a couple of
     hundred metres or every "far" strip lands on the next rise 6m away,
     which is what the first version measured. */
  {
    let best = null;
    const yaw = 0.7;
    for (let i = 0; i < 2500; i += 1) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 300;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!terrain.inBounds(x, z)) continue;
      const y = terrain.heightAt(x, z) + 1.75;
      const eye = new THREE.Vector3(x, y, z);
      if (physics.raycast(eye, up, 40, { layer: physics.LAYER.STATIC }).hit) continue;
      const pr = 3.0 * Math.PI / 180;
      const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pr), -Math.sin(pr),
        Math.cos(yaw) * Math.cos(pr)).normalize();
      const h = physics.raycast(eye, d, 900, { layer: physics.LAYER.TERRAIN });
      const fetch = h.hit ? h.distance : 900;
      if (physics.raycast(eye, d, Math.min(fetch, 400), { layer: physics.LAYER.STATIC }).hit) continue;
      if (best === null || fetch > best.fetch) best = { x, z, fetch };
    }
    out._reachSpot = best;
  }

  /* `cropV` is where in the frame the measurement is taken. It matters
     for the grazing pose, where the frame centre is 16m away and the
     interesting ground - the 2-5m the reviewer is complaining about -
     sits in the bottom third. Measuring the middle of a grazing frame
     answers a question nobody asked. */
  const FOV = 60;
  const groundPose = (spot, eye, pitchDeg, id, cropV = 0.5, half = 0.30) => {
    const y = terrain.heightAt(spot.x, spot.z) + eye;
    const pitch = pitchDeg * Math.PI / 180;
    const yaw = 0.7;
    const dir = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)
    ).normalize();
    const tanHalf = Math.tan(FOV * Math.PI / 360);
    const angle = pitch + Math.atan((2 * (cropV - 0.5)) * tanHalf);
    const dist = eye / Math.max(0.05, Math.sin(angle));
    out[id] = {
      position: [spot.x, y, spot.z],
      target: [spot.x + dir.x * 20, y + dir.y * 20, spot.z + dir.z * 20],
      fov: FOV,
      dist,
      incidence: angle,
      slope: spot.slope,
      crop: {
        fx0: 0.5 - half, fx1: 0.5 + half,
        fy0: Math.max(0.02, cropV - half * 0.55), fy1: Math.min(0.98, cropV + half * 0.55),
      },
    };
  };

  groundPose(flat, 1.2, 55, "ground1m");
  groundPose(flat, 2.0, 38, "ground2m");
  groundPose(flat, 5.0, 45, "ground5m");
  // Grazing: measured in the bottom third, ~4m out at eye height.
  groundPose(flat, 1.65, 7, "groundGraze", 0.78, 0.26);
  groundPose(steep, 3.0, 30, "rockEdge");

  /* The splat transition itself.
     "Hard splatmap seams between terrain layers with no height-based
     blend" is a claim about a BOUNDARY, and none of the poses above is
     guaranteed to contain one. This finds a point where the rockiness
     mask is crossing its midpoint - the sand-to-outcrop transition, the
     one a desert map shows most - and stands 9m off it looking down, so
     the boundary crosses the frame. */
  {
    let best = null;
    for (let i = 0; i < 9000; i += 1) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 320;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!terrain.inBounds(x, z)) continue;
      const s0 = terrain.slopeAt(x, z);
      // A texel whose slope sits in the middle of the rock ramp, with
      // neighbours on both sides of it: that is a transition, not just
      // a rocky spot.
      const lo = terrain.slopeAt(x + 7, z + 7);
      const hi = terrain.slopeAt(x - 7, z - 7);
      if (Math.min(lo, hi) > 0.22 || Math.max(lo, hi) < 0.34) continue;
      const score = -Math.abs(s0 - 0.30);
      if (best === null || score > best.score) best = { x, z, slope: s0, score };
    }
    if (best) {
      const y = terrain.heightAt(best.x, best.z) + 6.5;
      out.splatSeam = {
        position: [best.x + 6, y, best.z + 6],
        target: [best.x, terrain.heightAt(best.x, best.z), best.z],
        fov: 50, dist: 9, incidence: 0.7,
      };
    }
  }

  /* ---- wall poses, one per material name ---- */
  const wanted = ["bs-struct-blockwall", "bs-struct-concrete", "bs-struct-metal",
    "bs-struct-rock", "bs-struct-wood", "bs-road"];
  const byName = new Map();
  T.ctx.render.scene.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!wanted.includes(m.name)) continue;
      if (!byName.has(m.name)) byName.set(m.name, []);
      byName.get(m.name).push(o);
    }
  });

  const ray = new THREE.Raycaster();
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  const size = new THREE.Vector3();

  for (const [name, meshes] of byName) {
    // Largest instance first: a big wall gives a full frame of one
    // material, which is what makes a whole-frame diff a per-material
    // diff.
    meshes.sort((a, b) => {
      box.setFromObject(a); const va = box.getSize(size).length();
      box.setFromObject(b); const vb = box.getSize(size).length();
      return vb - va;
    });
    let pose = null;
    for (const mesh of meshes.slice(0, 24)) {
      box.setFromObject(mesh);
      box.getCenter(centre);
      box.getSize(size);
      if (size.length() < 1.2) continue;
      const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];
      for (const d of dirs) {
        const from = centre.clone().addScaledVector(new THREE.Vector3(d[0], d[1], d[2]),
          size.length() * 0.75 + 6);
        const to = centre.clone().sub(from).normalize();
        ray.set(from, to);
        ray.far = size.length() * 1.6 + 12;
        const hits = ray.intersectObject(mesh, true);
        if (!hits.length) continue;
        const hit = hits[0];
        const n = hit.face
          ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
          : new THREE.Vector3(d[0], d[1], d[2]);
        if (n.dot(to) > 0) n.negate();
        const standoff = 2.6;
        const eye = hit.point.clone().addScaledVector(n, standoff);
        // Reject a pose whose camera is buried in something else.
        ray.set(eye, n.clone().negate());
        ray.far = standoff * 1.05;
        const back = ray.intersectObject(mesh, true);
        if (!back.length) continue;
        pose = {
          position: eye.toArray(),
          target: hit.point.toArray(),
          fov: 55,
          dist: standoff,
          incidence: Math.PI / 2,
          mesh: mesh.name || mesh.type,
        };
        break;
      }
      if (pose) break;
    }
    if (pose) { pose.material = name; out[name.replace(/^bs-(struct-)?/, "")] = pose; }
  }

  out._materials = [];
  T.ctx.render.scene.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.name && m.name.startsWith("bs-")) out._materials.push(m.name);
    }
  });
  out._materials = [...new Set(out._materials)].sort();
  return out;
}

/**
 * Census of every material actually in the scene: roughness trim,
 * whether a roughness/normal map is bound, and - the number that
 * matters for "one roughness value for the whole world" - the mean and
 * spread of the bound roughness map's own green channel.
 */
function materialCensus() {
  const T = window.__BS;
  const seen = new Map();
  T.ctx.render.scene.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m.name || seen.has(m.name)) continue;
      let mapMean = null;
      let mapSd = null;
      const rm = m.roughnessMap;
      const data = rm && rm.image && rm.image.data;
      if (data) {
        let sum = 0; let sum2 = 0; let n = 0;
        for (let i = 1; i < data.length; i += 64) {
          const v = data[i] / 255; sum += v; sum2 += v * v; n += 1;
        }
        mapMean = sum / n;
        mapSd = Math.sqrt(Math.max(0, sum2 / n - mapMean * mapMean));
      }
      /* Albedo hue and saturation read off the SOURCE texture, in
         linear light, with no lighting in the path.
         "Salmon/pink-tan carries sand, brick AND haze" is a claim about
         the palette, and a rendered frame cannot answer it: a low warm
         sun puts everything in the shot at hue 20 whatever the albedos
         are. The generator's own texels can. */
      let albedo = null;
      const am = m.map;
      const adata = am && am.image && am.image.data;
      if (adata) {
        const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        const ch = [[], [], []];
        for (let i = 0; i < adata.length; i += 4 * 37) {
          ch[0].push(lin(adata[i])); ch[1].push(lin(adata[i + 1])); ch[2].push(lin(adata[i + 2]));
        }
        const md = ch.map((c) => { c.sort((p, q) => p - q); return c[Math.floor(c.length / 2)]; });
        const [r, g, b] = md;
        const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const dd = mx - mn;
        let hue = 0;
        if (dd > 1e-9) {
          if (mx === r) hue = ((g - b) / dd) % 6;
          else if (mx === g) hue = (b - r) / dd + 2;
          else hue = (r - g) / dd + 4;
          hue *= 60; if (hue < 0) hue += 360;
        }
        albedo = {
          hue: Number(hue.toFixed(1)),
          sat: Number((mx > 1e-9 ? dd / mx : 0).toFixed(3)),
          y: Number((0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(3)),
        };
      }
      seen.set(m.name, {
        name: m.name,
        albedo,
        roughness: m.roughness,
        metalness: m.metalness,
        hasNormal: Boolean(m.normalMap),
        normalScale: m.normalScale ? m.normalScale.x : null,
        hasRoughMap: Boolean(m.roughnessMap),
        hasAoMap: Boolean(m.aoMap),
        aoIntensity: m.aoMapIntensity,
        mapMean: mapMean === null ? null : Number(mapMean.toFixed(3)),
        mapSd: mapSd === null ? null : Number(mapSd.toFixed(3)),
        // Effective roughness = trim * map, which is what the shader
        // multiplies; a 1.0 trim over a 0.95-mean map is a different
        // world from a 0.9 trim over no map at all.
        effMean: mapMean === null ? m.roughness : Number((m.roughness * mapMean).toFixed(3)),
      });
    }
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Every live instance of a named material.
 *
 * NOT `materials.all()`: structures.js clones each library material and
 * renames the clone `bs-struct-<name>`, so the registry does not
 * contain the object the scene is actually drawing with. Iterating the
 * registry silently changed nothing and every A/B came back at exactly
 * 100%, which is what a no-op looks like.
 */
function materialsNamed(which) {
  const T = window.__BS;
  if (which === "terrain") return [T.ctx.terrain.material];
  const found = new Set();
  T.ctx.render.scene.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m.name === which) found.add(m);
  });
  return [...found];
}

/** Switch off the normal contribution for one material class. */
function setNormalStrength(which, value) {
  const T = window.__BS;
  if (which === "terrain") {
    T.ctx.terrain.uniforms.uNormalStrength.value = value;
    return 1;
  }
  let n = 0;
  for (const m of window.__bsNamed(which)) {
    if (!m.normalMap || !m.normalScale) continue;
    if (m.userData._nsBase === undefined) m.userData._nsBase = m.normalScale.x;
    m.normalScale.setScalar(m.userData._nsBase * value);
    n += 1;
  }
  return n;
}

/**
 * Zero the specular terms in the shader, so `base - noSpec` is the
 * specular contribution in luma counts.
 *
 * The obvious instrument - render with the albedo black and call what
 * is left "the specular lobe" - is wrong here and read 28-77%, which
 * is impossible for a dielectric at F0 0.04. render.js adds
 * atmospheric inscatter in linear light AFTER the material, so a pixel
 * with no diffuse and no specular at all still comes back at 25-35
 * luma. Subtracting a frame that differs ONLY in the specular terms
 * removes the fog, the ambient floor and the grade in one step.
 */
function setSpecularKill(which, on) {
  const KILL = "\n  reflectedLight.directSpecular = vec3( 0.0 );"
    + "\n  reflectedLight.indirectSpecular = vec3( 0.0 );";
  let n = 0;
  for (const m of window.__bsNamed(which)) {
    if (on) {
      if (m.userData._obc === undefined) {
        m.userData._obc = m.onBeforeCompile;
        m.userData._cpck = m.customProgramCacheKey;
      }
      const base = m.userData._obc;
      const baseKey = m.userData._cpck;
      m.onBeforeCompile = function patched(shader, renderer) {
        if (base) base.call(this, shader, renderer);
        const before = shader.fragmentShader;
        shader.fragmentShader = before.replace(
          "#include <lights_fragment_end>", `#include <lights_fragment_end>${KILL}`
        );
        m.userData._killApplied = shader.fragmentShader !== before;
      };
      // A material whose cache key does not change hands back the
      // program it already compiled, and the injection above is a
      // silent no-op - which reads exactly like "no specular lobe".
      m.customProgramCacheKey = function keyed() {
        return `nospec|${baseKey ? baseKey.call(this) : (m.name || "x")}`;
      };
    } else {
      if (m.userData._obc !== undefined) {
        m.onBeforeCompile = m.userData._obc;
        m.customProgramCacheKey = m.userData._cpck;
      }
    }
    m.needsUpdate = true;
    n += 1;
  }
  return n;
}

/** Did the specular injection actually reach a compiled program? */
function specularKillApplied(which) {
  return window.__bsNamed(which).some((m) => m.userData._killApplied === true);
}

/** Kill the albedo so only the specular lobe is left. */
function setAlbedoBlack(which, on) {
  let n = 0;
  for (const m of window.__bsNamed(which)) {
    if (!m.color) continue;
    if (on) {
      if (!m.userData._colBase) m.userData._colBase = m.color.clone();
      m.color.setRGB(0, 0, 0);
      // A vertex-tinted material multiplies the base colour by vColor,
      // so zeroing the base is enough - but structures.js treats the
      // tint as an ABSOLUTE albedo, so the vertex attribute has to go
      // too or the diffuse term survives.
      if (m.vertexColors) { m.userData._vcBase = true; m.vertexColors = false; m.needsUpdate = true; }
    } else {
      if (m.userData._colBase) m.color.copy(m.userData._colBase);
      if (m.userData._vcBase) { m.vertexColors = true; m.needsUpdate = true; }
    }
    n += 1;
  }
  return n;
}

/* ------------------------------ driver ------------------------------ */

const CROP = { fx0: 0.20, fy0: 0.20, fx1: 0.80, fy1: 0.80 };

function cropFor(w, h, box = CROP) {
  return {
    x0: Math.round(w * box.fx0), y0: Math.round(h * box.fy0),
    x1: Math.round(w * box.fx1), y1: Math.round(h * box.fy1),
  };
}

async function capture(page, name, saveDir) {
  const url = await page.evaluate(() => window.__BS.captureDataURL());
  const img = await decode(url);
  if (saveDir && name) {
    const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    await fs.writeFile(path.join(saveDir, `${name}.png`), buf);
  }
  return img;
}

async function settle(page, frames = 10) {
  await page.evaluate((n) => {
    for (let i = 0; i < n; i += 1) window.__BS.renderOnce(1 / 60);
  }, frames);
}

const TERRAIN_POSES = new Set([
  "ground1m", "ground2m", "ground5m", "groundGraze", "rockEdge", "splatSeam",
]);

function fmtBands(bands, cmPerPx) {
  // band k spans roughly 2^(k+1) pixels
  return bands.map((v, k) => {
    const px = 2 ** (k + 1);
    const cm = cmPerPx * px;
    return `${cm < 10 ? cm.toFixed(1) : Math.round(cm)}cm ${v.toFixed(2)}`;
  }).join("  ");
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  const report = { hour: HOUR, quality: QUALITY, poses: {} };
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    })).newPage();
    page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

    await page.goto(`${BASE}/games/blacksand.html?qa=1&quality=${QUALITY}`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 240000 });
    await page.evaluate(() => {
      window.__BS.maximize();
      window.__BS.hideHud(true);
      window.__BS.hideViewmodel(true);
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    await page.evaluate((h) => {
      window.__BS.setTimeOfDay(h);
      // Auto exposure renormalises the frame and would eat exactly the
      // difference every A/B below is trying to measure.
      window.__BS.grade({ autoExposure: false });
      window.__BS.advanceTime(4, 1 / 60);
    }, HOUR);

    await page.evaluate(`window.__bsNamed = ${materialsNamed.toString()}`);
    await page.evaluate(`window.__bsSetNS = ${setNormalStrength.toString()}`);
    await page.evaluate(`window.__bsAlbedo = ${setAlbedoBlack.toString()}`);
    await page.evaluate(`window.__bsNoSpec = ${setSpecularKill.toString()}`);
    await page.evaluate(`window.__bsKillOk = ${specularKillApplied.toString()}`);

    const sky = await page.evaluate(() => window.__BS.report().sky);
    console.log(`sun elevation ${sky.sunElevationDeg} deg   quality ${QUALITY}\n`);
    report.sunElevationDeg = sky.sunElevationDeg;

    const census = await page.evaluate(materialCensus);
    report.census = census;
    console.log("--- material census: albedo palette + roughness ---");
    console.log("name                 alb.hue  sat     Y | rough  metal  nrm  rMap  mapSd   eff");
    const num = (v, d = 2) => (typeof v === "number" ? v.toFixed(d) : "-");
    for (const m of census) {
      if (!m.name.startsWith("bs-")) continue;
      console.log(
        `${m.name.padEnd(20)} ${num(m.albedo && m.albedo.hue, 1).padStart(7)}`
        + ` ${num(m.albedo && m.albedo.sat, 3).padStart(5)}`
        + ` ${num(m.albedo && m.albedo.y, 3).padStart(5)} |`
        + ` ${num(m.roughness).padStart(5)}`
        + ` ${num(m.metalness).padStart(6)}`
        + ` ${(m.hasNormal ? "y" : "-").padStart(4)}`
        + ` ${(m.hasRoughMap ? "y" : "-").padStart(5)}`
        + ` ${String(m.mapSd ?? "-").padStart(7)}`
        + ` ${String(m.effMean ?? "-").padStart(6)}`
      );
    }
    // The terrain's layers never appear as scene materials - they are
    // samplers inside one shader - so they have to be read directly or
    // the palette table is missing sand, the thing the claim is about.
    const layers = await page.evaluate(() => {
      const T = window.__BS;
      const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const out = [];
      for (const name of ["sand", "dirt", "gravel", "rock", "drymud", "concrete", "blockwall"]) {
        const set = T.ctx.textures.get(name);
        const d = set && set.map && set.map.image && set.map.image.data;
        if (!d) continue;
        const ch = [[], [], []];
        for (let i = 0; i < d.length; i += 4 * 37) {
          ch[0].push(lin(d[i])); ch[1].push(lin(d[i + 1])); ch[2].push(lin(d[i + 2]));
        }
        const md = ch.map((c) => { c.sort((p, q) => p - q); return c[Math.floor(c.length / 2)]; });
        const [r, g, b] = md;
        const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const dd = mx - mn;
        let hue = 0;
        if (dd > 1e-9) {
          if (mx === r) hue = ((g - b) / dd) % 6;
          else if (mx === g) hue = (b - r) / dd + 2;
          else hue = (r - g) / dd + 4;
          hue *= 60; if (hue < 0) hue += 360;
        }
        out.push({ name, hue: Number(hue.toFixed(1)), sat: Number((dd / Math.max(1e-6, mx)).toFixed(3)),
          y: Number((0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(3)) });
      }
      return out;
    });
    report.layerPalette = layers;
    console.log("--- terrain layer albedos (source texels, linear) ---");
    for (const l of layers) {
      console.log(`  ${l.name.padEnd(12)} hue ${String(l.hue).padStart(5)}`
        + `   sat ${l.sat.toFixed(3)}   Y ${l.y.toFixed(3)}`);
    }

    const poses = await page.evaluate(findPoses);
    report.materialsInScene = poses._materials;
    console.log(`\nmaterials present in scene: ${poses._materials.join(", ")}\n`);

    const ids = Object.keys(poses).filter((k) => !k.startsWith("_"))
      .filter((k) => !ONLY || ONLY.includes(k));

    for (const id of ids) {
      const pose = poses[id];
      const which = TERRAIN_POSES.has(id) ? "terrain" : (pose.material || "terrain");
      await page.evaluate((p) => {
        window.__BS.lookAt(p.position, p.target, p.fov);
      }, pose);
      await settle(page, 12);

      const base = await capture(page, `${id}-base`, OUT);
      const crop = cropFor(base.w, base.h, pose.crop || CROP);
      // Metres per pixel at the crop centre, from the pose's own
      // geometry: 2*d*tan(fov/2)/height, divided by the cosine of the
      // incidence so a grazing view reports its real footprint.
      const mPerPx = 2 * pose.dist * Math.tan(pose.fov * Math.PI / 360) / base.h;
      const cmPerPx = mPerPx * 100 / Math.max(0.15, Math.sin(pose.incidence));

      const oct = octaveEnergy(base.luma, base.w, base.h, crop);

      // Albedo-black first: it produces the coverage mask everything
      // else is scored over.
      await page.evaluate(([w]) => window.__bsAlbedo(w, true), [which]);
      await settle(page, 6);
      const specOnly = await capture(page, `${id}-specular`, OUT);
      await page.evaluate(([w]) => window.__bsAlbedo(w, false), [which]);
      await settle(page, 4);
      const cov = coverageMask(base.luma, specOnly.luma, base.w, base.h);
      const baseM = maskedMean(base.luma, base.w, base.h, crop, cov.mask);
      const col = colourStats(base.rgb, base.w, base.h, crop, cov.mask);

      // Specular, isolated by subtraction rather than by inference.
      await page.evaluate(([w]) => window.__bsNoSpec(w, true), [which]);
      await settle(page, 8);
      const noSpec = await capture(page, `${id}-nospec`, OUT);
      const killOk = await page.evaluate(([w]) => window.__bsKillOk(w), [which]);
      await page.evaluate(([w]) => window.__bsNoSpec(w, false), [which]);
      await settle(page, 6);
      const noSpecM = maskedMean(noSpec.luma, base.w, base.h, crop, cov.mask);
      const specM = baseM - noSpecM;

      // 2 - normal differential, scored over the coverage mask
      await page.evaluate(([w]) => window.__bsSetNS(w, 0), [which]);
      await settle(page, 6);
      const noNormal = await capture(page, `${id}-nonormal`, OUT);
      await page.evaluate(([w]) => window.__bsSetNS(w, 1), [which]);
      await settle(page, 4);
      const dNormal = diffStats(base.luma, noNormal.luma, base.w, base.h, crop, cov.mask);

      // True geometry at the crop centre - a pose's assumed distance is
      // only right on flat ground, and half of these are not.
      const hit = await page.evaluate((c) => {
        const T = window.__BS;
        const THREE = T.THREE;
        const cam = T.ctx.render.camera;
        const v = new THREE.Vector3((c[0] * 2 - 1), -(c[1] * 2 - 1), 0.5)
          .unproject(cam).sub(cam.position).normalize();
        const r = T.ctx.physics.raycast(cam.position, v, 600, {
          layer: T.ctx.physics.LAYER.TERRAIN | T.ctx.physics.LAYER.STATIC,
        });
        if (!r.hit) return null;
        return {
          distance: r.distance,
          incidence: Math.abs(r.normal.dot(v)),
        };
      }, [(crop.x0 + crop.x1) / 2 / base.w, (crop.y0 + crop.y1) / 2 / base.h]);

      // Real cm per pixel: measured range, and the real angle the
      // surface makes with the view ray.
      const trueCm = hit
        ? (2 * hit.distance * Math.tan(pose.fov * Math.PI / 360) / base.h) * 100
          / Math.max(0.12, hit.incidence)
        : cmPerPx;

      const entry = {
        pose: { position: pose.position, dist: pose.dist, fov: pose.fov, mesh: pose.mesh },
        material: which,
        coverage: Number((cov.fraction * 100).toFixed(1)),
        hit: hit ? { distance: Number(hit.distance.toFixed(2)), incidence: Number(hit.incidence.toFixed(3)) } : null,
        cmPerPx: Number(trueCm.toFixed(3)),
        octaves: oct.bands.map((v) => Number(v.toFixed(2))),
        sd: Number(oct.sd.toFixed(2)),
        mean: Number(oct.mean.toFixed(1)),
        colour: {
          hue: Number(col.hue.toFixed(1)),
          sat: Number(col.sat.toFixed(3)),
          luma: Number(col.luma.toFixed(4)),
        },
        normalDiff: {
          moved: Number((dNormal.moved * 100).toFixed(1)),
          mean: Number(dNormal.mean.toFixed(2)),
          peak: Number(dNormal.peak.toFixed(0)),
          pixels: dNormal.n,
        },
        specular: {
          luma: Number(specM.toFixed(2)),
          baseOnMaterial: Number(baseM.toFixed(2)),
          fraction: Number((specM / Math.max(1e-6, baseM) * 100).toFixed(2)),
          injected: killOk,
        },
      };
      report.poses[id] = entry;

      console.log(`--- ${id}  [${which}]  ${trueCm.toFixed(2)} cm/px`
        + `  hit ${hit ? hit.distance.toFixed(1) : "?"}m  cover ${(cov.fraction * 100).toFixed(0)}%`);
      console.log(`    octave energy   ${fmtBands(oct.bands, trueCm)}`);
      const rep = repeatPeak(base.luma, base.w, base.h, crop);
      entry.repeat = { peak: Number(rep.peak.toFixed(3)), lagPx: rep.lag,
        lagCm: Number((rep.lag * trueCm).toFixed(1)) };
      console.log(`    frame  mean ${oct.mean.toFixed(1)}  sd ${oct.sd.toFixed(1)}`
        + `   hue ${col.hue.toFixed(1)}  sat ${col.sat.toFixed(3)}`
        + `   repeat ${rep.peak.toFixed(2)} @ ${(rep.lag * trueCm).toFixed(0)}cm`);
      console.log(`    normal off ->  ${(dNormal.moved * 100).toFixed(1)}% of material moved,`
        + ` mean |dLuma| ${dNormal.mean.toFixed(2)}, peak ${dNormal.peak.toFixed(0)}`);
      console.log(`    specular ${specM.toFixed(2)} luma of ${baseM.toFixed(2)}`
        + `  = ${(specM / Math.max(1e-6, baseM) * 100).toFixed(1)}%`
        + `${killOk ? "" : "   [INJECTION MISSED - result meaningless]"}\n`);
    }

    /* ---------------- grazing sheen sweep ----------------
       "Sand at grazing angle should sheen; it doesn't."

       A Fresnel-driven sheen is a function of the VIEW angle, so the
       instrument has to be a view sweep on one patch of ground with
       nothing else moving. The camera swings from looking almost
       straight down at a fixed point to almost along the surface; at
       each step the specular lobe is isolated by zeroing the albedo
       and read over the terrain's own coverage mask. A dielectric with
       a working Fresnel term climbs steeply toward grazing; a surface
       whose specular is flat across the sweep has no sheen whatever
       its roughness says. */
    if (poses.ground2m) {
      console.log("--- grazing sheen sweep (specular-only luma vs view angle) ---");
      const spot = poses.ground2m.position;
      const sweep = [];
      for (const deg of [70, 45, 30, 20, 12, 7, 4]) {
        await page.evaluate(([p, d]) => {
          const T = window.__BS;
          const a = d * Math.PI / 180;
          // Keep the camera at eye height and push the aim point out
          // instead. Orbiting a fixed target put the camera 31cm off
          // the sand at 4 degrees, which measures a worm's view of a
          // 6cm craze rather than a standing player's view of a dune.
          const range = 1.55 / Math.max(0.07, Math.sin(a));
          // The camera is placed on the SUN's azimuth looking back
          // toward it. A sheen is the sun's own reflection: put the
          // camera on the far side and the half-vector never comes
          // near the surface normal, and the sweep measures the
          // absence of a highlight that was never in shot. This is the
          // back-lit low-sun view where real sand goes to silver.
          const s = T.ctx.sky.sunDirection;
          const az = Math.atan2(s.x, s.z);
          const eye = [p[0], p[1] - 0.45, p[2]];
          T.lookAt(eye, [
            p[0] + Math.sin(az) * range * Math.cos(a),
            p[1] - 2.0,
            p[2] + Math.cos(az) * range * Math.cos(a),
          ], 45);
        }, [spot, deg]);
        await settle(page, 8);
        const b = await capture(page, `sheen-${deg}-base`, OUT);
        await page.evaluate(() => window.__bsAlbedo("terrain", true));
        await settle(page, 6);
        const blk = await capture(page, null, null);
        await page.evaluate(() => window.__bsAlbedo("terrain", false));
        await settle(page, 4);
        await page.evaluate(() => window.__bsNoSpec("terrain", true));
        await settle(page, 8);
        const ns = await capture(page, `sheen-${deg}-nospec`, OUT);
        await page.evaluate(() => window.__bsNoSpec("terrain", false));
        await settle(page, 6);
        const c = coverageMask(b.luma, blk.luma, b.w, b.h);
        const cr = cropFor(b.w, b.h, { fx0: 0.3, fy0: 0.4, fx1: 0.7, fy1: 0.85 });
        const bm = maskedMean(b.luma, b.w, b.h, cr, c.mask);
        const sm = bm - maskedMean(ns.luma, b.w, b.h, cr, c.mask);
        sweep.push({ deg, base: Number(bm.toFixed(2)), spec: Number(sm.toFixed(2)),
          pct: Number((sm / Math.max(1e-6, bm) * 100).toFixed(2)) });
        console.log(`    view ${String(deg).padStart(2)} deg above surface`
          + `   base ${bm.toFixed(1).padStart(6)}   specular ${sm.toFixed(2).padStart(6)}`
          + `   ${(sm / Math.max(1e-6, bm) * 100).toFixed(1)}%`);
      }
      report.sheenSweep = sweep;
      const lo = sweep[sweep.length - 1];
      const hi = sweep[0];
      console.log(`    grazing/steep specular ratio ${(lo.spec / Math.max(1e-6, hi.spec)).toFixed(2)}x`
        + `   (a Fresnel sheen is >1.6x; flat is ~1.0x)\n`);
    }

    /* ---------------- detail reach ----------------
       "The ground is a smooth blurred wash."

       At 1-2m the sand is demonstrably not a wash, so either the claim
       is wrong or the reviewer was describing ground further out than
       they thought. This walks the same patch out from 4m to 120m and
       reads the contrast at a FIXED WORLD SCALE - 20cm, the size of a
       ripple - rather than at a fixed pixel scale. Screen-space
       measures always fall with distance and cannot tell attenuation
       from a missing texture; world-scale contrast can. */
    if (poses._reachSpot) {
      const rs = poses._reachSpot;
      console.log(`--- detail reach: one grazing frame, read in horizontal strips`
        + `  (fetch ${rs.fetch.toFixed(0)}m) ---`);
      const spot = [rs.x, 0, rs.z];
      // Re-aiming the camera per distance was the first design and it
      // does not work: on real terrain a 1-degree pitch change lands
      // the crop on whatever rise happens to be in the way, and every
      // "120m" sample came back at 7m. One low frame already contains
      // 2m at the bottom and the horizon at the top; the raycast per
      // strip says which distance each strip actually is.
      /* Straight down from a rising camera.
         Two earlier designs fought the landscape and lost: aiming by
         pitch angle assumes a flat plane, and aiming at a distant
         ground point just grazes the next rise - both produced "240m"
         samples that measured ground 4m away. Looking straight down
         puts the range on the camera's altitude, where it is exact, at
         a fixed 90-degree incidence, so contrast at a fixed world scale
         is the only thing left varying. */
      const reach = [];
      for (const want of [2, 4, 8, 16, 32, 64, 128, 256]) {
        const ok = await page.evaluate(([p, d]) => {
          const T = window.__BS;
          const t = T.ctx.terrain;
          const y = t.heightAt(p[0], p[2]);
          T.lookAt([p[0], y + d, p[2]], [p[0] + 0.0001, y, p[2]], 55);
          return true;
        }, [spot, want]);
        if (!ok) continue;
        await settle(page, 10);
        const img = await capture(page, `reach-${want}m`, want <= 60 ? OUT : null);
        const hit2 = await page.evaluate(() => {
          const T = window.__BS;
          const THREE = T.THREE;
          const cam = T.ctx.render.camera;
          const d = new THREE.Vector3(0, 0, 0.5).unproject(cam).sub(cam.position).normalize();
          const r = T.ctx.physics.raycast(cam.position, d, 1200,
            { layer: T.ctx.physics.LAYER.TERRAIN });
          return r.hit ? { d: r.distance, inc: Math.abs(r.normal.dot(d)) } : null;
        });
        if (!hit2) continue;
        const cr = cropFor(img.w, img.h, { fx0: 0.36, fy0: 0.44, fx1: 0.64, fy1: 0.58 });
        const o = octaveEnergy(img.luma, img.w, img.h, cr);
        const cm = (2 * hit2.d * Math.tan(55 * Math.PI / 360) / img.h) * 100
          / Math.max(0.05, hit2.inc);
        const pick = (wantCm) => {
          const scales = o.bands.map((_, k) => cm * 2 ** (k + 1));
          if (wantCm <= scales[0]) return o.bands[0] * (wantCm / scales[0]);
          for (let k = 0; k < scales.length - 1; k += 1) {
            if (wantCm <= scales[k + 1]) {
              const t = Math.log(wantCm / scales[k]) / Math.log(scales[k + 1] / scales[k]);
              return o.bands[k] + (o.bands[k + 1] - o.bands[k]) * t;
            }
          }
          return o.bands[o.bands.length - 1];
        };
        const row = {
          want, dist: Number(hit2.d.toFixed(1)), cmPerPx: Number(cm.toFixed(2)),
          at20cm: Number(pick(20).toFixed(2)),
          at60cm: Number(pick(60).toFixed(2)),
          at200cm: Number(pick(200).toFixed(2)),
        };
        reach.push(row);
        console.log(`    ${String(row.dist).padStart(6)}m  ${row.cmPerPx.toFixed(1).padStart(6)} cm/px`
          + `   contrast @20cm ${row.at20cm.toFixed(2).padStart(5)}`
          + `  @60cm ${row.at60cm.toFixed(2).padStart(5)}`
          + `  @2m ${row.at200cm.toFixed(2).padStart(5)}`);
      }
      report.detailReach = reach;
      console.log("");
    }

    await fs.writeFile(path.join(OUT, "close-report.json"), JSON.stringify(report, null, 2));
    console.log(`written ${path.relative(root, OUT)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
