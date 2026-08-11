#!/usr/bin/env node
/* ============================================================
   BLACKSAND - atmosphere / scene-contrast probe

   `blacksand-contrast-compare.mjs` says WHAT the defect is: our
   key:fill spread covers 3.4 stops where Battlefield 2's covers 1.8.
   It cannot say WHY, because it only ever sees the finished PNG.

   This does. It renders each beauty shot twice - once normally, once
   through a fullscreen pass that decodes the scene depth buffer into
   a per-pixel view DISTANCE - and then runs the identical two-means
   key:fill split per distance band. So "the wide shots are flat"
   becomes a number attached to a range in metres, and a change to the
   aerial model can be judged where it acts instead of by its effect
   on a whole-frame average.

   It also answers, in the same boot, four claims a round-5 reviewer
   made about this subsystem that contradict what is implemented:
   highlight clipping, sun-disc visibility, and the alpha-tested-prop
   fog ordering. Every one of them is cheaper to measure than to argue
   about - see docs/blacksand-critic-round-2.md for why that matters
   in this project.

   Usage:
     node scripts/blacksand-atmos-probe.mjs
     node scripts/blacksand-atmos-probe.mjs --mode penumbra
     node scripts/blacksand-atmos-probe.mjs --poses establishing,market
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
const MODE = String(args.mode || "profile");
const OUT_DIR = path.resolve(root, args.out || "output/blacksand-atmos");
const WIDTH = Number(args.width || 1600);
const HEIGHT = Number(args.height || 900);
const PORT = Number(args.port || 41000 + (process.pid % 9000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE_URL}/games/blacksand.html?qa=1&quality=${args.quality || "ultra"}`;

/* The distance buffer's resolution. Small on purpose: it is read back
   to the CPU, and the analysis bands are hundreds of metres wide. */
const DW = 480;
const DH = 270;
const FAR = 4200;

/* Identical to blacksand-contrast-compare.mjs, so a ratio printed here
   and a ratio printed there are the same quantity. */
const CROP = { x0: 0.08, x1: 0.92, y0: 0.44, y1: 0.76 };

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Two-means on log luminance - the contrast-compare split, verbatim. */
function keyFill(lum) {
  if (lum.length < 40) return null;
  const s = [...lum].sort((a, b) => a - b);
  let lo = s[Math.floor(0.2 * s.length)];
  let hi = s[Math.floor(0.8 * s.length)];
  const L = (v) => Math.log(v + 1e-5);
  for (let it = 0; it < 30; it += 1) {
    let sl = 0; let nl = 0; let sh = 0; let nh = 0;
    for (const v of s) {
      if (Math.abs(L(v) - L(lo)) < Math.abs(L(v) - L(hi))) { sl += v; nl += 1; }
      else { sh += v; nh += 1; }
    }
    if (nl) lo = sl / nl;
    if (nh) hi = sh / nh;
  }
  return lo > 1e-5 ? { ratio: hi / lo, key: hi, fill: lo } : null;
}

const BANDS = [
  ["0-25m", 0, 25],
  ["25-60m", 25, 60],
  ["60-120m", 60, 120],
  ["120-250m", 120, 250],
  ["250-500m", 250, 500],
  ["500-1000m", 500, 1000],
  ["1000m+", 1000, 1e9],
];

/* ------------------------- harness plumbing ------------------------- */

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`Static server never came up on ${BASE_URL}`);
}

/**
 * Install the distance grabber in the page.
 *
 * It reads the SAME depth texture the composite reads, through a
 * fullscreen pass of its own into a target it owns. Rendering the
 * scene again with an override material would have been the obvious
 * route and it is wrong twice: the override replaces alpha-tested
 * foliage with an opaque quad, and it replaces the sky dome's
 * depth-test flags so the dome paints over everything at one metre.
 * Decoding the depth the real materials already wrote has neither
 * problem, and it is one draw.
 */
const INSTALL = ([dw, dh, far]) => {
  const T = window.__BS;
  const THREE = T.THREE;
  const render = T.ctx.render;

  const rt = new THREE.WebGLRenderTarget(dw, dh, {
    type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false,
  });
  rt.texture.minFilter = THREE.NearestFilter;
  rt.texture.magFilter = THREE.NearestFilter;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() },
      uCam: { value: new THREE.Vector3() },
      uFar: { value: far },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: [
      "precision highp float;",
      "varying vec2 vUv;",
      "uniform sampler2D tDepth;",
      "uniform mat4 uInvViewProj;",
      "uniform vec3 uCam;",
      "uniform float uFar;",
      "void main() {",
      "  float d = texture2D(tDepth, vUv).x;",
      "  if (d >= 0.999999) { gl_FragColor = vec4(1.0, 1.0, 0.0, 1.0); return; }",
      "  vec4 wh = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);",
      "  vec3 wp = wh.xyz / wh.w;",
      "  float t = clamp(length(wp - uCam) / uFar, 0.0, 0.99);",
      "  float hi = floor(t * 255.0);",
      "  float lo = floor((t * 255.0 - hi) * 255.0);",
      "  gl_FragColor = vec4(hi / 255.0, lo / 255.0, 0.0, 1.0);",
      "}",
    ].join("\n"),
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  window.__ATMOS = {
    grabDistance() {
      const u = render.composite.uniforms;
      material.uniforms.tDepth.value = u.tDepth.value;
      material.uniforms.uInvViewProj.value.copy(u.uInvViewProj.value);
      material.uniforms.uCam.value.copy(u.uCameraPos.value);

      const r = render.renderer;
      r.setRenderTarget(rt);
      r.clear(true, false, false);
      r.render(scene, camera);
      const buffer = new Uint8Array(dw * dh * 4);
      r.readRenderTargetPixels(rt, 0, 0, dw, dh, buffer);
      r.setRenderTarget(null);

      // readRenderTargetPixels is bottom-up; the PNG is top-down.
      let s = "";
      for (let y = dh - 1; y >= 0; y -= 1) {
        for (let x = 0; x < dw; x += 1) {
          const i = (y * dw + x) * 4;
          s += String.fromCharCode(buffer[i], buffer[i + 1]);
        }
      }
      return btoa(s);
    },

    /** Where the sun lands on screen, and how much of it we believe. */
    sunScreen() {
      const sky = T.ctx.sky;
      const cam = render.camera;
      const dir = sky.sunDirection.clone();
      const p = cam.position.clone().addScaledVector(dir, 8000);
      const mvp = new THREE.Matrix4().multiplyMatrices(
        cam.projectionMatrix, cam.matrixWorldInverse
      );
      p.applyMatrix4(mvp);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      return {
        x: p.x * 0.5 + 0.5,
        y: 1 - (p.y * 0.5 + 0.5),
        inFront: dir.dot(fwd) > 0,
        elevationDeg: Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180 / Math.PI,
        angleFromViewDeg: Math.acos(Math.max(-1, Math.min(1, dir.dot(fwd)))) * 180 / Math.PI,
        fov: cam.fov,
      };
    },
  };
  return true;
};

/* --------------------------- analysis --------------------------- */

function decodeDistance(b64) {
  const raw = Buffer.from(b64, "base64");
  const out = new Float32Array(DW * DH);
  for (let i = 0; i < DW * DH; i += 1) {
    const hi = raw[i * 2];
    const lo = raw[i * 2 + 1];
    // (255, 255) is the sky sentinel; the packer can never emit it for
    // a real surface because it clamps the normalised distance to 0.99.
    out[i] = (hi === 255 && lo === 255) ? Infinity : ((hi + lo / 255) / 255) * FAR;
  }
  return out;
}

async function analyse(pngBuffer, distances, sun) {
  /* Nearest, not lanczos: averaging colour across a depth discontinuity
     puts a pixel in a distance band it was never in. */
  const { data } = await sharp(pngBuffer)
    .resize(DW, DH, { fit: "fill", kernel: "nearest" })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });

  const x0 = Math.round(DW * CROP.x0);
  const x1 = Math.round(DW * CROP.x1);
  const y0 = Math.round(DH * CROP.y0);
  const y1 = Math.round(DH * CROP.y1);

  const all = [];
  const perBand = BANDS.map(() => []);
  let skyPixels = 0;
  let cropPixels = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = y * DW + x;
      const r = data[i * 3];
      const g = data[i * 3 + 1];
      const b = data[i * 3 + 2];
      const lum = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
      cropPixels += 1;
      const d = distances[i];
      if (!Number.isFinite(d)) { skyPixels += 1; continue; }
      all.push(lum);
      for (let k = 0; k < BANDS.length; k += 1) {
        if (d >= BANDS[k][1] && d < BANDS[k][2]) { perBand[k].push(lum); break; }
      }
    }
  }

  /* ---- clipping, over the WHOLE frame at full resolution ----
     A reviewer said "highlights clip to paper white with no roll-off".
     The honest test is how many pixels sit at literal 255, not how
     many sit near it. */
  const full = await sharp(pngBuffer).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const fd = full.data;
  const n = fd.length / 3;
  let white = 0;
  let anyChannel = 0;
  let over250 = 0;
  const lumHist = new Uint32Array(256);
  for (let i = 0; i < fd.length; i += 3) {
    const r = fd[i]; const g = fd[i + 1]; const b = fd[i + 2];
    if (r === 255 && g === 255 && b === 255) white += 1;
    if (r === 255 || g === 255 || b === 255) anyChannel += 1;
    const l = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    if (l >= 250) over250 += 1;
    lumHist[Math.min(255, l)] += 1;
  }
  let acc = 0;
  let p999 = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += lumHist[v];
    if (acc >= n * 0.999) { p999 = v; break; }
  }

  /* ---- is the sun disc actually on screen, and does it read? ---- */
  let disc = null;
  if (sun && sun.inFront && sun.x > 0 && sun.x < 1 && sun.y > 0 && sun.y < 1) {
    const meta = await sharp(pngBuffer).metadata();
    const cx = Math.round(sun.x * meta.width);
    const cy = Math.round(sun.y * meta.height);
    const half = 60;
    const left = Math.max(0, cx - half);
    const top = Math.max(0, cy - half);
    const w = Math.min(meta.width - left, half * 2);
    const h = Math.min(meta.height - top, half * 2);
    if (w > 4 && h > 4) {
      const patch = await sharp(pngBuffer).extract({ left, top, width: w, height: h })
        .removeAlpha().raw().toBuffer();
      let peak = 0;
      let hot = 0;
      for (let i = 0; i < patch.length; i += 3) {
        const l = 0.2126 * patch[i] + 0.7152 * patch[i + 1] + 0.0722 * patch[i + 2];
        if (l > peak) peak = l;
        if (l >= 250) hot += 1;
      }
      disc = { peakLuma: Number(peak.toFixed(1)), hotPixels: hot, window: [w, h] };
    }
  }

  const overall = keyFill(all);
  return {
    overall: overall ? Number(overall.ratio.toFixed(2)) : null,
    skyShare: Number((skyPixels / cropPixels).toFixed(3)),
    bands: BANDS.map((b, k) => {
      const kf = keyFill(perBand[k]);
      const share = perBand[k].length / cropPixels;
      const sorted = [...perBand[k]].sort((a, b2) => a - b2);
      return {
        band: b[0],
        share: Number(share.toFixed(3)),
        ratio: kf ? Number(kf.ratio.toFixed(2)) : null,
        medianLum: sorted.length ? Number(sorted[Math.floor(sorted.length / 2)].toFixed(4)) : null,
      };
    }),
    clip: {
      whitePct: Number(((white / n) * 100).toFixed(4)),
      anyChannelPct: Number(((anyChannel / n) * 100).toFixed(4)),
      over250Pct: Number(((over250 / n) * 100).toFixed(4)),
      p999Luma: p999,
    },
    sun: sun ? {
      ...sun,
      x: Number(sun.x.toFixed(3)),
      y: Number(sun.y.toFixed(3)),
      elevationDeg: Number(sun.elevationDeg.toFixed(1)),
      angleFromViewDeg: Number(sun.angleFromViewDeg.toFixed(1)),
      disc,
    } : null,
  };
}

/* ---------------------------- penumbra ---------------------------- */

/**
 * Two bars at different heights over the same flat sand, seen from
 * straight above so ground metres per pixel is exact. If the shadow
 * edges come back the same width the filter is a constant blur; if
 * their widths are in the ratio of their heights it is PCSS.
 */
const PENUMBRA_SETUP = (heights) => {
  const T = window.__BS;
  const THREE = T.THREE;
  const ctx = T.ctx;
  const render = ctx.render;

  // A flat patch, searched rather than assumed - the map is dunes.
  let best = null;
  for (let x = -300; x <= 300; x += 25) {
    for (let z = -300; z <= 300; z += 25) {
      const h = ctx.terrain.heightAt(x, z);
      let spread = 0;
      for (const [dx, dz] of [[14, 0], [-14, 0], [0, 14], [0, -14], [10, 10], [-10, -10]]) {
        spread = Math.max(spread, Math.abs(ctx.terrain.heightAt(x + dx, z + dz) - h));
      }
      if (!best || spread < best.spread) best = { x, z, y: h, spread };
    }
  }

  const sun = ctx.sky.sunDirection.clone();
  // Lay each bar across the sun's horizontal bearing so its shadow edge
  // is one straight line running perpendicular to the offset direction.
  const az = Math.atan2(sun.x, sun.z);
  const group = new THREE.Group();
  group.name = "bs-penumbra-rig";
  const material = new THREE.MeshStandardMaterial({ color: 0x303030, roughness: 0.9 });
  const spacing = 26;
  const bars = [];
  heights.forEach((h, i) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(24, 0.22, 0.22), material);
    const ox = Math.cos(az) * (i - (heights.length - 1) / 2) * spacing;
    const oz = -Math.sin(az) * (i - (heights.length - 1) / 2) * spacing;
    bar.position.set(best.x + ox, best.y + h, best.z + oz);
    bar.rotation.y = -az;
    bar.castShadow = true;
    bar.receiveShadow = false;
    group.add(bar);
    // Where the shadow lands: offset from the bar along -sun, on the
    // ground plane.
    bars.push({
      h,
      shadowX: best.x + ox - (sun.x / sun.y) * h,
      shadowZ: best.z + oz - (sun.z / sun.y) * h,
    });
  });
  render.scene.add(group);

  const camHeight = 70;
  const cam = render.camera;
  T.lookAt(
    [best.x, best.y + camHeight, best.z + 0.001],
    [best.x, best.y, best.z],
    40
  );
  cam.updateMatrixWorld(true);

  return {
    ground: best,
    sun: sun.toArray(),
    az,
    bars,
    // Metres of ground per rendered pixel, straight down at fov 40.
    metresPerPixelY: (2 * camHeight * Math.tan((40 * Math.PI / 180) / 2)) / window.innerHeight,
    aspect: cam.aspect,
    viewport: [window.innerWidth, window.innerHeight],
    shadowRadius: render.sun.shadow.radius,
    shadowExtent: render.sun.shadow.camera.right,
    shadowMapSize: render.sun.shadow.mapSize.x,
    texelWorld: (render.sun.shadow.camera.right * 2) / render.sun.shadow.mapSize.x,
  };
};

/**
 * Measure a shadow edge's 10-90 width, in pixels, from a luminance
 * profile taken along the sun's ground bearing.
 */
function edgeWidth(profile) {
  const lo = Math.min(...profile);
  const hi = Math.max(...profile);
  if (hi - lo < 6) return null;
  const at = (frac) => {
    const target = lo + (hi - lo) * frac;
    for (let i = 1; i < profile.length; i += 1) {
      const a = profile[i - 1];
      const b = profile[i];
      if ((a < target && b >= target) || (a > target && b <= target)) {
        const t = (target - a) / (b - a || 1e-6);
        return i - 1 + t;
      }
    }
    return null;
  };
  const p10 = at(0.1);
  const p90 = at(0.9);
  if (p10 === null || p90 === null) return null;
  return { width: Math.abs(p90 - p10), low: lo, high: hi };
}

/* ------------------------------ run ------------------------------ */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const server = startServer();
  let browser = null;

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
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 150000 });
    await page.evaluate(() => window.__BS.maximize());
    await page.evaluate(() => { for (let i = 0; i < 20; i += 1) window.__BS.renderOnce(1 / 60); });
    await page.evaluate(() => window.__BS.hideHud(true));
    await page.evaluate(() => window.__BS.hideViewmodel(true));
    await page.evaluate(() => {
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    await page.evaluate(() => window.__BS.advanceTime(3, 1 / 60));
    await page.evaluate(INSTALL, [DW, DH, FAR]);

    if (MODE === "lat") {
      /* ---- the arc's height, at a fixed day length ----
         The bazaar's key:fill is strongly elevation-dependent (19.7 at
         71 degrees, 11.6 at 43) and the wide vistas want longer
         shadows, so a lower arc should move both the right way. The
         latitude/declination pair holds sunrise and sunset fixed, so
         this changes nothing about WHERE the authored hours land in the
         day - only how high the sun is when they arrive. */
      const available = await page.evaluate(() => window.__BS.listPoses());
      const poses = !args.poses || args.poses === true
        ? available.map((p) => p.id)
        : String(args.poses).split(",").map((s) => s.trim());
      const lats = String(args.lats || "34,42,50").split(",").map(Number);
      for (const lat of lats) {
        const geom = await page.evaluate((v) => window.__BS.ctx.sky.setLatitude(v), lat);
        const row = {};
        const scales = String(args.scales || "1").split(",").map(Number);
        for (const scale of scales) {
        await page.evaluate((v) => window.__BS.ctx.sky.setBounceScale(v), scale);
        for (const poseId of poses) {
          if (!available.some((p) => p.id === poseId)) continue;
          await page.evaluate((a) => {
            window.__BS.ctx.sky.setLatitude(a.lat);
            window.__BS.ctx.sky.setBounceScale(a.scale);
            window.__BS.setPose(a.id);
            // setPose re-runs updateLighting through setTimeOfDay, which
            // reads bounceScale - so it has to be set before, not after.
            window.__BS.ctx.sky.setBounceScale(a.scale);
          }, { id: poseId, lat, scale });
          await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
          await page.evaluate(() => { for (let i = 0; i < 10; i += 1) window.__BS.renderOnce(1 / 60); });
          await delay(40);
          const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
          const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
          const m = await sharp(png).metadata();
          const data = await sharp(png).extract({
            left: Math.round(m.width * CROP.x0), top: Math.round(m.height * CROP.y0),
            width: Math.round(m.width * (CROP.x1 - CROP.x0)),
            height: Math.round(m.height * (CROP.y1 - CROP.y0)),
          }).resize(300, 88, { fit: "cover" }).removeAlpha().raw().toBuffer();
          const lum = [];
          for (let i = 0; i < data.length; i += 3) {
            lum.push(0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1])
              + 0.0722 * toLinear(data[i + 2]));
          }
          const kf = keyFill(lum);
          row[poseId] = kf ? Number(kf.ratio.toFixed(2)) : null;
        }
        const vals = Object.values(row).filter((v) => v !== null).sort((a, b) => a - b);
        console.log(`lat ${String(lat).padStart(3)} peak ${(90 - (lat - geom.declination)).toFixed(1).padStart(5)}deg `
          + `bounce ${scale.toFixed(2)}  `
          + `min ${vals[0].toFixed(2)}  median ${vals[Math.floor(vals.length / 2)].toFixed(2)}  `
          + `max ${vals[vals.length - 1].toFixed(2)}  `
          + `inside ${vals.filter((v) => v >= 3.5 && v <= 12.5).length}/${vals.length}`);
        console.log(`         ` + poses.map((p) => `${p.slice(0, 5)} ${row[p]}`).join("  "));
        }
      }
      return;
    }

    if (MODE === "meter") {
      /* ---- how far is auto exposure opening up, per shot? ----
         The bazaar's key population sits at 0.42 linear where every
         other pose's is 0.22-0.28. If that is the meter opening up for
         a dark interior and blowing the plaza behind it, the cap is a
         lever that touches ONLY the frames that are riding it. */
      const available = await page.evaluate(() => window.__BS.listPoses());
      const poses = !args.poses || args.poses === true
        ? available.map((p) => p.id)
        : String(args.poses).split(",").map((s) => s.trim());
      console.log("pose            meterLuma   gain    sky.exposure   final ev");
      for (const poseId of poses) {
        if (!available.some((p) => p.id === poseId)) continue;
        await page.evaluate((id) => window.__BS.setPose(id), poseId);
        await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
        await page.evaluate(() => { for (let i = 0; i < 10; i += 1) window.__BS.renderOnce(1 / 60); });
        const m = await page.evaluate(() => {
          const v = window.__BS.ctx.render.meterValue();
          return { ...v, base: window.__BS.ctx.render.exposure };
        });
        console.log(`${poseId.padEnd(14)} ${String(m.luma).padStart(9)}  ${String(m.gain).padStart(6)}  `
          + `${String(m.base.toFixed(3)).padStart(12)}   ${m.exposure}`);
      }
      return;
    }

    if (MODE === "bearing") {
      /* ---- the map's compass bearing, swept ----
         The tod sweep found that a wide vista's key:fill depends on the
         sun's AZIMUTH relative to the camera far more than on its
         height: `establishing` reads 3.76 with a 42.9-degree morning
         sun and 1.86 with a 42.9-degree afternoon one. That is the
         round-2 finding again - a sun on the camera's own axis throws
         every shadow out of frame.

         northBearing rotates the whole map under the real sun, so it
         changes every shot's azimuth at once and costs nothing at run
         time. The four rake-driven poses re-pick their own hour, so
         this measures what the FIXED poses do. */
      const available = await page.evaluate(() => window.__BS.listPoses());
      const poses = !args.poses || args.poses === true
        ? available.map((p) => p.id)
        : String(args.poses).split(",").map((s) => s.trim());
      const step = Number(args.step || 45);
      const from = Number(args.from ?? 0);
      const to = Number(args.to ?? 359);
      const grid = {};
      for (let bearing = from; bearing <= to; bearing += step) {
        grid[bearing] = {};
        for (const poseId of poses) {
          if (!available.some((p) => p.id === poseId)) continue;
          await page.evaluate((a) => {
            const T = window.__BS;
            // Set the bearing FIRST: setPose runs the pose's rake, which
            // searches hours against the sun's actual azimuth.
            T.ctx.sky.setNorthBearing(a.bearing);
            T.setPose(a.id);
          }, { id: poseId, bearing });
          await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
          await page.evaluate(() => { for (let i = 0; i < 10; i += 1) window.__BS.renderOnce(1 / 60); });
          await delay(40);
          const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
          const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
          const m = await sharp(png).metadata();
          const data = await sharp(png).extract({
            left: Math.round(m.width * CROP.x0), top: Math.round(m.height * CROP.y0),
            width: Math.round(m.width * (CROP.x1 - CROP.x0)),
            height: Math.round(m.height * (CROP.y1 - CROP.y0)),
          }).resize(300, 88, { fit: "cover" }).removeAlpha().raw().toBuffer();
          const lum = [];
          for (let i = 0; i < data.length; i += 3) {
            lum.push(0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1])
              + 0.0722 * toLinear(data[i + 2]));
          }
          const kf = keyFill(lum);
          grid[bearing][poseId] = kf ? Number(kf.ratio.toFixed(2)) : null;
        }
        const vals = Object.values(grid[bearing]).filter((v) => v !== null).sort((a, b) => a - b);
        console.log(`bearing ${String(bearing).padStart(3)}  min ${vals[0].toFixed(2).padStart(6)}  `
          + `median ${vals[Math.floor(vals.length / 2)].toFixed(2).padStart(6)}  `
          + `max ${vals[vals.length - 1].toFixed(2).padStart(6)}  `
          + `inside[3.5,12.5] ${vals.filter((v) => v >= 3.5 && v <= 12.5).length}/${vals.length}`);
        console.log(`            ` + poses.map((p) => `${p.slice(0, 5)} ${grid[bearing][p]}`).join("  "));
      }
      await writeFile(path.join(OUT_DIR, "bearing.json"), JSON.stringify(grid, null, 2));
      return;
    }

    if (MODE === "tod") {
      /* ---- how much of a shot's contrast is the sun's HEIGHT? ----
         Hold the camera still, walk the sun across the sky, read the
         gate's own ratio. If a wide vista is flat because a 42-degree
         sun leaves open dunes with no shadow side, this curve says so
         and says what elevation would fix it. */
      const available = await page.evaluate(() => window.__BS.listPoses());
      const poses = !args.poses || args.poses === true
        ? ["establishing", "rooftop", "market", "depot"]
        : String(args.poses).split(",").map((s) => s.trim());
      for (const poseId of poses) {
        if (!available.some((p) => p.id === poseId)) continue;
        console.log(`\n--- ${poseId} ---`);
        for (let tod = 7.0; tod <= 18.6; tod += 0.8) {
          const elev = await page.evaluate((a) => {
            const T = window.__BS;
            T.setPose(a.id);
            // setPose applies the pose's own hour (and its rake); override
            // it afterwards so the CAMERA is the pose's and only the sun
            // moves.
            T.setTimeOfDay(a.tod);
            const d = T.ctx.sky.sunDirection;
            return Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI;
          }, { id: poseId, tod });
          await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
          await page.evaluate(() => { for (let i = 0; i < 10; i += 1) window.__BS.renderOnce(1 / 60); });
          await delay(50);
          const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
          const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
          const m = await sharp(png).metadata();
          const data = await sharp(png).extract({
            left: Math.round(m.width * CROP.x0), top: Math.round(m.height * CROP.y0),
            width: Math.round(m.width * (CROP.x1 - CROP.x0)),
            height: Math.round(m.height * (CROP.y1 - CROP.y0)),
          }).resize(300, 88, { fit: "cover" }).removeAlpha().raw().toBuffer();
          const lum = [];
          for (let i = 0; i < data.length; i += 3) {
            lum.push(0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1])
              + 0.0722 * toLinear(data[i + 2]));
          }
          const kf = keyFill(lum);
          console.log(`  tod ${tod.toFixed(1).padStart(4)}  elev ${elev.toFixed(1).padStart(5)}  `
            + `key:fill ${kf ? kf.ratio.toFixed(2).padStart(6) : "  n/a "}  `
            + `key ${kf ? kf.key.toFixed(4) : "-"}  fill ${kf ? kf.fill.toFixed(5) : "-"}`);
        }
      }
      return;
    }

    if (MODE === "ablate") {
      /* ---- which term is flattening which shot? ----
         The spread runs from 1.9 to 20.6 across thirteen frames and
         every candidate explanation is plausible in words. Switch one
         term off at a time and read the ratio; whatever does not move
         is not the cause, whatever moves the wrong shot is not the
         fix. Same crop and same two-means split as the gate. */
      /* Every term here either treats the centre of the frame
         differently from its edge (vignette), or amplifies a
         high-contrast EDGE (sharpen), or acts only on the bottom of the
         curve (shadowLift). Those are the three shapes that can move a
         covered interior looking out at a blown plaza without also
         moving a uniformly lit vista, which is what the gate needs. */
      const variants = args.variants === "market" ? [
        ["baseline", {}],
        ["no-vignette", { vignette: 0 }],
        ["half-vignette", { vignette: 0.13 }],
        ["no-sharpen", { sharpen: 0 }],
        ["half-sharpen", { sharpen: 0.18 }],
        ["lift-0.07", { shadowLift: 0.07 }],
        ["lift-0.10", { shadowLift: 0.10 }],
      ] : [
        ["baseline", {}],
        ["no-aerial", { __aerial: 0 }],
        ["no-shadowLift", { shadowLift: 0 }],
        ["no-ao", { ao: 0 }],
        ["no-bloom", { bloomStrength: 0 }],
        ["logSlope-1.0", { logSlope: 1.0 }],
      ];
      const available = await page.evaluate(() => window.__BS.listPoses());
      const poses = !args.poses || args.poses === true
        ? available.map((p) => p.id)
        : String(args.poses).split(",").map((s) => s.trim());
      const table = {};
      for (const poseId of poses) {
        if (!available.some((p) => p.id === poseId)) continue;
        table[poseId] = {};
        for (const [name, patch] of variants) {
          await page.evaluate((a) => {
            const T = window.__BS;
            T.setPose(a.id);
            const u = T.ctx.render.composite.uniforms;
            // uAerial has no grade() entry - it is atmosphere, not look -
            // so poke the uniform. Restored by the next setPose, which
            // re-runs sky.updateLighting through setAtmosphere.
            u.uAerial.value = a.patch.__aerial !== undefined ? a.patch.__aerial : 1;
            const p = { ...a.patch };
            delete p.__aerial;
            if (Object.keys(p).length) T.grade(p);
          }, { id: poseId, patch });
          await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
          await page.evaluate(() => { for (let i = 0; i < 10; i += 1) window.__BS.renderOnce(1 / 60); });
          await delay(60);
          const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
          const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
          const m = await sharp(png).metadata();
          // `.raw().toBuffer()` without resolveWithObject returns the
          // Buffer itself - destructuring `data` off it yields undefined.
          const data = await sharp(png)
            .extract({
              left: Math.round(m.width * CROP.x0), top: Math.round(m.height * CROP.y0),
              width: Math.round(m.width * (CROP.x1 - CROP.x0)),
              height: Math.round(m.height * (CROP.y1 - CROP.y0)),
            })
            .resize(300, 88, { fit: "cover" }).removeAlpha().raw().toBuffer();
          const lum = [];
          for (let i = 0; i < data.length; i += 3) {
            lum.push(0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1])
              + 0.0722 * toLinear(data[i + 2]));
          }
          const kf = keyFill(lum);
          table[poseId][name] = kf
            ? { ratio: Number(kf.ratio.toFixed(2)), key: Number(kf.key.toFixed(4)), fill: Number(kf.fill.toFixed(5)) }
            : null;
          // Put the grade back before the next variant.
          await page.evaluate(() => window.__BS.grade({
            shadowLift: 0.038, ao: 0.95, bloomStrength: 0.10, logSlope: 1.45,
            vignette: 0.26, sharpen: 0.36,
          }));
        }
        const r = table[poseId];
        console.log(`${poseId.padEnd(14)} ` + variants.map(([n]) =>
          `${n} ${r[n] ? r[n].ratio.toFixed(2) : "n/a"}`).join("   "));
      }
      await writeFile(path.join(OUT_DIR, "ablate.json"), JSON.stringify(table, null, 2));
      console.log("\nkey / fill absolutes (baseline):");
      for (const [pose, r] of Object.entries(table)) {
        if (r.baseline) {
          console.log(`  ${pose.padEnd(14)} key ${r.baseline.key}  fill ${r.baseline.fill}`);
        }
      }
      return;
    }

    if (MODE === "disc") {
      /* ---- can the dome draw a sun at all? ----
         Every authored beauty shot points away from the sun (the street
         poses do it deliberately - see rakeAcross in world.js), so
         "there is no sun disc" is unfalsifiable from those frames. Aim
         straight at it instead. */
      const rows = [];
      for (const tod of [7.0, 9.0, 12.4, 15.4, 17.5, 18.6]) {
        const aim = await page.evaluate((t) => {
          const T = window.__BS;
          T.setTimeOfDay(t);
          const c = T.ctx.render.camera;
          const d = T.ctx.sky.sunDirection;
          const eye = [c.position.x, c.position.y, c.position.z];
          T.lookAt(eye, [eye[0] + d.x * 500, eye[1] + d.y * 500, eye[2] + d.z * 500], 55);
          return { elev: Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI };
        }, tod);
        await page.evaluate(() => window.__BS.advanceTime(2.0, 1 / 60));
        await page.evaluate(() => { for (let i = 0; i < 8; i += 1) window.__BS.renderOnce(1 / 60); });
        await delay(80);
        const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
        const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
        await writeFile(path.join(OUT_DIR, `disc-${String(tod).replace(".", "_")}.png`), png);
        const meta = await sharp(png).metadata();
        // The disc sits at frame centre because the camera is aimed at
        // it. Compare a tight centre window against an annulus of plain
        // sky so "bright sky" cannot be mistaken for "a disc".
        const box = 90;
        const centre = await sharp(png).extract({
          left: Math.round(meta.width / 2 - box / 2),
          top: Math.round(meta.height / 2 - box / 2),
          width: box, height: box,
        }).removeAlpha().raw().toBuffer();
        const ring = await sharp(png).extract({
          left: Math.round(meta.width / 2 - 320), top: Math.round(meta.height / 2 - 180),
          width: 160, height: 160,
        }).removeAlpha().raw().toBuffer();
        const stats = (buf) => {
          let peak = 0; let sum = 0; let n = 0;
          for (let i = 0; i < buf.length; i += 3) {
            const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
            peak = Math.max(peak, l); sum += l; n += 1;
          }
          return { peak, mean: sum / n };
        };
        const c = stats(centre);
        const s = stats(ring);
        rows.push({ tod, elev: Number(aim.elev.toFixed(1)), discPeak: c.peak, discMean: c.mean, skyMean: s.mean });
        console.log(`tod ${String(tod).padStart(5)}  elev ${aim.elev.toFixed(1).padStart(5)}  `
          + `disc peak ${c.peak.toFixed(1).padStart(6)}  disc mean ${c.mean.toFixed(1).padStart(6)}  `
          + `sky 20deg off ${s.mean.toFixed(1).padStart(6)}  `
          + `contrast ${(c.mean / Math.max(s.mean, 1e-3)).toFixed(2)}x`);
      }
      await writeFile(path.join(OUT_DIR, "disc.json"), JSON.stringify(rows, null, 2));
      return;
    }

    if (MODE === "sun") {
      /* ---- does the key light actually know what time it is? ----
         Reads the air mass, the beam transmittance and the day factor
         separately, because "the sun is too bright at dusk" has three
         possible causes and they need different fixes. */
      const sweep = await page.evaluate(() => {
        const T = window.__BS;
        const ctx = T.ctx;
        const out = [];
        for (let h = 5.0; h <= 21.0; h += 0.5) {
          ctx.sky.setTimeOfDay(h, true);
          const s = ctx.sky.sunDirection;
          const elevDeg = Math.asin(Math.max(-1, Math.min(1, s.y))) * 180 / Math.PI;
          // Re-derive the two terms the way sky.js does, so the printout
          // separates "the model is wrong" from "the model is fine and
          // something downstream eats it".
          // Kasten 1965, altitude in DEGREES in the correction term.
          // Must be monotonic in elevation and >= 1 everywhere; a value
          // under 1, or a peak part-way up the sky, means sky.js has
          // regressed to feeding it a sine.
          const airMass = 1 / (Math.max(s.y, 0)
            + 0.15 * Math.pow(Math.max(elevDeg, 0) + 3.885, -1.253));
          const c = ctx.render.sun.color;
          out.push({
            tod: Number(h.toFixed(1)),
            elevDeg: Number(elevDeg.toFixed(2)),
            airMass: Number(airMass.toFixed(3)),
            intensity: Number(ctx.render.sun.intensity.toFixed(3)),
            colour: [c.r, c.g, c.b].map((v) => Number(v.toFixed(3))),
            hemi: Number(ctx.render.hemi.intensity.toFixed(3)),
            envIntensity: Number((ctx.render.scene.environmentIntensity || 0).toFixed(3)),
            exposure: Number(ctx.render.exposure.toFixed(3)),
            daylight: Number(ctx.sky.daylight.toFixed(4)),
          });
        }
        return out;
      });
      console.log("tod   elev    airMass  sunI   sunRGB                 hemi   envI   expo   daylight");
      for (const r of sweep) {
        console.log(`${String(r.tod).padStart(4)}  ${String(r.elevDeg).padStart(6)}  `
          + `${String(r.airMass).padStart(7)}  ${String(r.intensity).padStart(5)}  `
          + `${r.colour.map((v) => v.toFixed(3)).join(" ").padEnd(20)}  `
          + `${String(r.hemi).padStart(5)}  ${String(r.envIntensity).padStart(5)}  `
          + `${String(r.exposure).padStart(5)}  ${r.daylight}`);
      }
      await writeFile(path.join(OUT_DIR, "sun-sweep.json"), JSON.stringify(sweep, null, 2));
      return;
    }

    if (MODE === "penumbra") {
      const heights = [0.5, 2.5, 12.0];
      await page.evaluate(() => window.__BS.setPose("golden-hour"));
      await page.evaluate(() => window.__BS.advanceTime(3, 1 / 60));
      const rig = await page.evaluate(PENUMBRA_SETUP, heights);
      await page.evaluate(() => window.__BS.advanceTime(1.5, 1 / 60));
      await page.evaluate(() => { for (let i = 0; i < 10; i += 1) window.__BS.renderOnce(1 / 60); });
      await delay(150);
      const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
      const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
      await writeFile(path.join(OUT_DIR, "penumbra.png"), png);

      const meta = await sharp(png).metadata();
      const grey = await sharp(png).greyscale().raw().toBuffer();
      const W = meta.width;
      const H = meta.height;
      /* The bars run across the frame, so a vertical scan crosses each
         shadow edge once. Median of many columns kills the sand noise. */
      const rows = [];
      for (let y = 0; y < H; y += 1) {
        const samples = [];
        for (let x = Math.round(W * 0.3); x < Math.round(W * 0.7); x += 3) {
          samples.push(grey[y * W + x]);
        }
        samples.sort((a, b) => a - b);
        rows.push(samples[Math.floor(samples.length / 2)]);
      }

      console.log(`ground (${rig.ground.x}, ${rig.ground.z}) flatness ${rig.ground.spread.toFixed(2)}m`);
      console.log(`sun ${rig.sun.map((v) => v.toFixed(3)).join(", ")}`);
      console.log(`shadow map ${rig.shadowMapSize} over ${(rig.shadowExtent * 2).toFixed(0)}m`
        + `  texel ${(rig.texelWorld * 100).toFixed(1)}cm  radius uniform ${rig.shadowRadius.toFixed(1)}`);
      console.log(`${rig.metresPerPixelY.toFixed(4)} m per pixel\n`);

      // Each bar's shadow is a dark trough; find them and measure the
      // outer flank of each.
      const troughs = [];
      let y = 2;
      while (y < H - 2) {
        if (rows[y] < 0.72 * Math.max(...rows)) {
          const start = y;
          while (y < H - 2 && rows[y] < 0.72 * Math.max(...rows)) y += 1;
          if (y - start >= 2) troughs.push([start, y]);
        }
        y += 1;
      }
      console.log(`found ${troughs.length} shadow troughs (expected ${heights.length})`);
      troughs.forEach((t, i) => {
        const pad = 26;
        const before = rows.slice(Math.max(0, t[0] - pad), t[0] + 3);
        const after = rows.slice(t[1] - 3, Math.min(H, t[1] + pad));
        const a = edgeWidth(before);
        const b = edgeWidth(after);
        const px = [a, b].filter(Boolean).map((e) => e.width);
        const mean = px.length ? px.reduce((s, v) => s + v, 0) / px.length : null;
        console.log(`  trough ${i}  rows ${t[0]}-${t[1]}  `
          + `edge 10-90 = ${mean === null ? "n/a" : `${mean.toFixed(1)}px = `
            + `${(mean * rig.metresPerPixelY * 100).toFixed(1)}cm`}`);
      });
      console.log("\nbar heights, in the order they were placed:");
      rig.bars.forEach((b) => {
        console.log(`  h=${b.h}m  predicted penumbra full width `
          + `${(b.h * 0.011 * 100).toFixed(1)}cm  (2 * h * tan(sun radius))`);
      });
      await writeFile(path.join(OUT_DIR, "penumbra.json"),
        JSON.stringify({ rig, rows, troughs }, null, 2));
      return;
    }

    /* ------------------------- profile mode ------------------------- */

    const available = await page.evaluate(() => window.__BS.listPoses());
    const requested = !args.poses || args.poses === true
      ? available.map((p) => p.id)
      : String(args.poses).split(",").map((s) => s.trim()).filter(Boolean);

    const results = [];
    for (const poseId of requested) {
      if (!available.some((p) => p.id === poseId)) continue;
      await page.evaluate((id) => window.__BS.setPose(id), poseId);
      await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));
      await page.evaluate(() => { for (let i = 0; i < 10; i += 1) window.__BS.renderOnce(1 / 60); });
      await delay(100);

      const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
      const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
      const b64 = await page.evaluate(() => window.__ATMOS.grabDistance());
      const sun = await page.evaluate(() => window.__ATMOS.sunScreen());
      const distances = decodeDistance(b64);
      const row = await analyse(png, distances, sun);
      row.pose = poseId;
      results.push(row);

      console.log(`\n=== ${poseId}   overall key:fill ${row.overall}   `
        + `sky ${(row.skyShare * 100).toFixed(0)}% of crop`);
      for (const b of row.bands) {
        if (b.share < 0.005) continue;
        console.log(`   ${b.band.padEnd(10)} ${(b.share * 100).toFixed(1).padStart(5)}%  `
          + `key:fill ${b.ratio === null ? " n/a " : b.ratio.toFixed(2).padStart(6)}  `
          + `medLum ${b.medianLum}`);
      }
      console.log(`   clip: pure white ${row.clip.whitePct}%  any channel 255 `
        + `${row.clip.anyChannelPct}%  luma>=250 ${row.clip.over250Pct}%  p99.9 ${row.clip.p999Luma}`);
      if (row.sun) {
        console.log(`   sun: screen (${row.sun.x}, ${row.sun.y}) inFront=${row.sun.inFront} `
          + `elev ${row.sun.elevationDeg} off-axis ${row.sun.angleFromViewDeg} `
          + `${row.sun.disc ? `disc peak ${row.sun.disc.peakLuma} hot ${row.sun.disc.hotPixels}px` : "(off frame)"}`);
      }
    }

    await writeFile(path.join(OUT_DIR, "profile.json"),
      JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2));

    /* ---- the summary that matters: how flat is each shot, and where ---- */
    console.log("\n=== distance profile summary ===");
    console.log("pose                 overall   near(<120m)   far(>250m)   sky%");
    for (const r of results) {
      const near = r.bands.filter((b) => ["0-25m", "25-60m", "60-120m"].includes(b.band));
      const far = r.bands.filter((b) => ["250-500m", "500-1000m", "1000m+"].includes(b.band));
      const wavg = (rows) => {
        const use = rows.filter((b) => b.ratio !== null && b.share > 0.01);
        if (!use.length) return null;
        const w = use.reduce((s, b) => s + b.share, 0);
        return use.reduce((s, b) => s + b.ratio * b.share, 0) / w;
      };
      const nv = wavg(near);
      const fv = wavg(far);
      const nShare = near.reduce((s, b) => s + b.share, 0);
      const fShare = far.reduce((s, b) => s + b.share, 0);
      console.log(`${r.pose.padEnd(20)} ${String(r.overall).padStart(6)}   `
        + `${(nv === null ? "  -  " : nv.toFixed(2)).padStart(5)} @${(nShare * 100).toFixed(0).padStart(3)}%   `
        + `${(fv === null ? "  -  " : fv.toFixed(2)).padStart(5)} @${(fShare * 100).toFixed(0).padStart(3)}%   `
        + `${(r.skyShare * 100).toFixed(0).padStart(3)}%`);
    }

    if (pageErrors.length) {
      console.error(`\n${pageErrors.length} page error(s):`);
      pageErrors.slice(0, 10).forEach((e) => console.error(`  ${e}`));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
