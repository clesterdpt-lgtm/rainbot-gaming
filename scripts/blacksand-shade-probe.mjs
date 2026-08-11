#!/usr/bin/env node
/* ============================================================
   BLACKSAND - shade budget probe

   Measures how much light a surface receives when the sun does not
   reach it, and - the part that matters - how that answer changes with
   the surface's ORIENTATION.

   Why this metric: a blind art director identified our panel in 11 of
   11 pairs and said the deciding cue in nine of them was the same one -
   shaded surfaces are far too dark, so form and material identity both
   vanish the moment a surface turns away from the sun. It measured our
   brick at lit 63 / shaded 16 sRGB, about 10:1 in linear terms, against
   roughly 5:1 for clear-sky sun-to-skylight on the same albedo.

   Four measurements, in the order they were found to be necessary:

   1. GROUND. Many points on the terrain, classified lit or shadowed by
      a physics raycast towards the sun, projected to screen and read
      out of the framebuffer. Same material, same tiling, same shader -
      the only difference is whether the sun reaches it. This one came
      back at 1.9:1 and 3.6:1, i.e. ALREADY inside the target, which is
      what proved the problem was not the overall level.

   2. NORMAL CHART. A row of cards at a fixed spot in front of the
      camera, all sharing one 0.35-albedo material, whose SHADING
      normals are overridden to +Y, 45 degrees, horizontal, -45 and -Y.
      Read with the sun on and again with the sun off, so the indirect
      term can be separated from the total and plotted against
      orientation. The cards always face the camera, so a normal that
      would be invisible on real geometry is still measurable. This is
      the instrument that shows the DISTRIBUTION rather than the level.

   3. WALL. The same lit/shadowed classification as (1) but on
      near-vertical faces of real structures, which is what the critic
      actually sampled.

   4. CANOPY. Ground luma where a foliage crown blocks the sun, against
      open sand a few metres away with nothing above it. A palm that
      casts nothing reads 1.0 here.

   Usage:
     node scripts/blacksand-shade-probe.mjs
     node scripts/blacksand-shade-probe.mjs --sweep --target 5.0
     node scripts/blacksand-shade-probe.mjs --quality ultra
   ============================================================ */

import { spawn } from "node:child_process";
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
const PORT = Number(args.port || 48000 + (process.pid % 1500));
const BASE = `http://127.0.0.1:${PORT}`;
const TARGET = Number(args.target || 5.0);
const QUALITY = String(args.quality || "high");
const POSES = String(args.poses || "street,compound,rooftop").split(",");

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

/** sRGB -> linear, so the ratio is a ratio of light and not of encoded
 *  values. An sRGB ratio of 3.9 is a linear ratio of about 10. */
function toLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Hue angle in degrees and saturation, from a linear RGB triple.
 *
 * Reported because the level being right does not mean the shadow is
 * right: two blind reviewers independently called our shadowed sand a
 * body of water. Shadowed sand is still SAND - it is lit by a blue sky
 * and by an enormous ring of warm bounce off the sunlit sand around it,
 * so its hue should stay within about 20 degrees of the lit side. A
 * shadow that swings 90 degrees to teal has lost the albedo, and no
 * ratio measurement can see that.
 */
function hueSat(rgb) {
  if (!rgb) return { hue: null, sat: null };
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { hue: h, sat: max > 1e-9 ? d / max : 0 };
}

/** Signed shortest distance between two hue angles, in degrees. */
function hueDelta(a, b) {
  if (a === null || b === null) return null;
  let d = ((a - b + 540) % 360) - 180;
  return Math.abs(d);
}

/** Grab the drawing buffer once and hand back samplers in uv space. */
async function grab(page) {
  const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const { data, info } = await sharp(buf).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });

  /** Component-wise median linear RGB over a list of [u, v] pairs.
   *  `spread` box-averages first, which keeps a single dithered pixel
   *  or a grain sample from deciding the answer. Medians are taken per
   *  channel so one blown sample cannot drag the hue. */
  const rgb = (list, spread = 1) => {
    const cols = [[], [], []];
    for (const [u, v] of list) {
      const cx = Math.round(u * (info.width - 1));
      const cy = Math.round(v * (info.height - 1));
      const sum = [0, 0, 0];
      let n = 0;
      for (let dy = -spread; dy <= spread; dy += 1) {
        for (let dx = -spread; dx <= spread; dx += 1) {
          const x = Math.min(info.width - 1, Math.max(0, cx + dx));
          const y = Math.min(info.height - 1, Math.max(0, cy + dy));
          const i = (y * info.width + x) * 3;
          sum[0] += toLinear(data[i]);
          sum[1] += toLinear(data[i + 1]);
          sum[2] += toLinear(data[i + 2]);
          n += 1;
        }
      }
      for (let c = 0; c < 3; c += 1) cols[c].push(sum[c] / n);
    }
    if (!cols[0].length) return null;
    return cols.map((list2) => {
      list2.sort((a, b) => a - b);
      return list2[Math.floor(list2.length / 2)];
    });
  };

  const read = (list, spread = 1) => {
    const c = rgb(list, spread);
    return c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : null;
  };
  read.rgb = rgb;
  return read;
}

/* ---------------------------------------------------------------
   1 + 3 + 4: classification done on the page, sampling done here
   --------------------------------------------------------------- */

/** Ground and wall points, classified lit vs shadowed by the physics
 *  world, returned as screen uv. */
function collectSurfacePoints() {
  const T = window.__BS;
  const THREE = T.THREE;
  const physics = T.ctx.physics;
  const camera = T.ctx.render.camera;
  const sun = T.ctx.sky.sunDirection.clone().normalize();

  const out = { groundLit: [], groundShade: [], wallLit: [], wallShade: [] };
  const v = new THREE.Vector3();

  for (let i = 0; i < 14000; i += 1) {
    if (out.groundLit.length >= 400 && out.groundShade.length >= 400
      && out.wallLit.length >= 200 && out.wallShade.length >= 200) break;
    const ndcX = Math.random() * 2 - 1;
    const ndcY = Math.random() * 2 - 1;
    v.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    const hit = physics.raycast(camera.position, v, 400, {
      layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
    });
    if (!hit.hit) continue;
    if (hit.distance < 4 || hit.distance > 140) continue;

    const screen = hit.point.clone().project(camera);
    if (Math.abs(screen.x) > 0.95 || Math.abs(screen.y) > 0.95) continue;
    const px = [(screen.x * 0.5 + 0.5), (1 - (screen.y * 0.5 + 0.5))];

    const above = hit.point.clone().addScaledVector(hit.normal, 0.06);
    const blocked = physics.raycast(above, sun, 260, {
      layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
    }).hit;
    const facing = hit.normal.dot(sun);

    if (hit.normal.y > 0.985) {
      // Near-flat ground, so the sun's incidence angle is identical for
      // every sample and cannot skew the ratio.
      (blocked ? out.groundShade : out.groundLit).push(px);
    } else if (Math.abs(hit.normal.y) < 0.2) {
      // A vertical face. "Lit" means the sun is well onto it, so the
      // cosine term is comparable across samples; "shaded" means it
      // receives no direct light at all, which is what the critic
      // sampled when it read a wall at 63 against 16.
      if (!blocked && facing > 0.45) out.wallLit.push(px);
      else if (facing < -0.15 || blocked) out.wallShade.push(px);
    }
  }
  return out;
}

/** Ground points that a foliage CROWN shades, and open control points
 *  a few metres away with nothing above them at all. */
function collectCanopyPoints() {
  const T = window.__BS;
  const THREE = T.THREE;
  const physics = T.ctx.physics;
  const camera = T.ctx.render.camera;
  const sun = T.ctx.sky.sunDirection.clone().normalize();

  const foliage = [];
  T.ctx.render.scene.traverse((o) => {
    if (o.isMesh && o.visible && /^foliage-/.test(o.name)
      && !/contact|impostor/.test(o.name) && (o.count === undefined || o.count > 0)) {
      foliage.push(o);
    }
  });

  const ray = new THREE.Raycaster();
  ray.far = 90;
  const shaded = [];
  const open = [];
  const v = new THREE.Vector3();

  for (let i = 0; i < 9000 && (shaded.length < 160 || open.length < 160); i += 1) {
    const ndcX = Math.random() * 2 - 1;
    const ndcY = Math.random() * 2 - 1;
    v.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
    const hit = physics.raycast(camera.position, v, 260, { layer: physics.LAYER.TERRAIN });
    if (!hit.hit) continue;
    if (hit.normal.y < 0.97) continue;
    if (hit.distance < 4 || hit.distance > 90) continue;

    const screen = hit.point.clone().project(camera);
    if (Math.abs(screen.x) > 0.93 || Math.abs(screen.y) > 0.93) continue;

    const above = hit.point.clone().addScaledVector(hit.normal, 0.06);
    // Terrain or a building blocking the sun disqualifies the sample
    // either way - this measures FOLIAGE, and nothing else.
    if (physics.raycast(above, sun, 260, {
      layer: physics.LAYER.TERRAIN | physics.LAYER.STATIC,
    }).hit) continue;

    ray.set(above, sun);
    const leaves = ray.intersectObjects(foliage, false).length > 0;
    const px = [(screen.x * 0.5 + 0.5), (1 - (screen.y * 0.5 + 0.5))];
    (leaves ? shaded : open).push(px);
  }
  return { shaded, open, meshes: foliage.length };
}

/* ---------------------------------------------------------------
   2: the normal chart
   --------------------------------------------------------------- */

/**
 * Build (once) a row of camera-facing cards whose SHADING normals are
 * overridden, so every orientation is measurable from one viewpoint.
 *
 * A cube would be the obvious rig and it does not work: half its
 * normals face away from the camera, so the interesting ones (down, and
 * the wall facing away from the sun) are exactly the ones you cannot
 * see. Overriding the normal attribute on a card that still faces the
 * viewer separates "which way does this surface face the light" from
 * "can I see it", which are independent questions everywhere except in
 * a rasteriser.
 */
function installNormalChart() {
  const T = window.__BS;
  const THREE = T.THREE;
  const render = T.ctx.render;
  if (window.__bsChart) return window.__bsChart.ids;

  const S = Math.SQRT1_2;
  const dirs = [
    ["up", [0, 1, 0]],
    ["up45", [S, S, 0]],
    ["vert", [1, 0, 0]],
    ["down45", [S, -S, 0]],
    ["down", [0, -1, 0]],
  ];

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.35, 0.35, 0.35),
    roughness: 0.95,
    metalness: 0.0,
  });
  material.name = "bs-normal-chart";

  const group = new THREE.Group();
  group.name = "bs-normal-chart";
  // Not scene geometry: it must never appear in a beauty shot, be
  // picked up by the clearance probe, or cast into the shadow map.
  group.userData.qaOpaque = false;
  group.visible = false;
  render.scene.add(group);

  const cards = dirs.map(([id, n], i) => {
    const geometry = new THREE.PlaneGeometry(0.34, 0.34);
    const normal = geometry.getAttribute("normal");
    for (let k = 0; k < normal.count; k += 1) normal.setXYZ(k, n[0], n[1], n[2]);
    normal.needsUpdate = true;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `bs-chart-${id}`;
    mesh.castShadow = false;
    // receiveShadow off on purpose: "is this card in shadow" is
    // controlled by the sun A/B below, not by where the rig happens to
    // stand, so the direct term is the same for every capture.
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.userData.qaOpaque = false;
    mesh.userData.slot = i;
    group.add(mesh);
    return { id, mesh, dir: n };
  });

  window.__bsChart = {
    group, cards, material,
    ids: cards.map((c) => c.id),

    /** Park the rig in front of the camera and hand back screen uv per
     *  card. The cards face the camera exactly; their shading normal is
     *  the thing under test and is untouched by this. */
    place() {
      const camera = render.camera;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const centre = camera.position.clone().addScaledVector(forward, 3.0);
      group.visible = true;
      const uv = {};
      cards.forEach((card, i) => {
        const offset = (i - (cards.length - 1) / 2) * 0.42;
        card.mesh.position.copy(centre).addScaledVector(right, offset);
        card.mesh.quaternion.copy(camera.quaternion);
        card.mesh.updateMatrixWorld(true);
        const p = card.mesh.position.clone().project(camera);
        uv[card.id] = [p.x * 0.5 + 0.5, 1 - (p.y * 0.5 + 0.5)];
      });
      return uv;
    },

    hide() { group.visible = false; },
  };
  return window.__bsChart.ids;
}

/* ---------------------------------------------------------------
   driver
   --------------------------------------------------------------- */

const fmt = (v, n = 4) => (v === null || v === undefined || !Number.isFinite(v)
  ? " n/a  " : v.toFixed(n));
const ratio = (a, b) => (a && b ? a / b : null);

async function measurePose(page, pose) {
  await page.evaluate((id) => {
    window.__BS.setPose(id);
    window.__BS.advanceTime(3, 1 / 60);
    for (let i = 0; i < 8; i += 1) window.__BS.renderOnce(1 / 60);
  }, pose);

  /* ---- surfaces and canopy: one capture, three classifications ---- */
  const surface = await page.evaluate(collectSurfacePoints);
  const canopy = await page.evaluate(collectCanopyPoints);
  let read = await grab(page);

  const result = {
    pose,
    ground: {
      lit: read(surface.groundLit), shade: read(surface.groundShade),
      litRgb: read.rgb(surface.groundLit), shadeRgb: read.rgb(surface.groundShade),
      n: [surface.groundLit.length, surface.groundShade.length],
    },
    wall: {
      lit: read(surface.wallLit), shade: read(surface.wallShade),
      litRgb: read.rgb(surface.wallLit), shadeRgb: read.rgb(surface.wallShade),
      n: [surface.wallLit.length, surface.wallShade.length],
    },
    canopy: {
      shade: read(canopy.shaded, 0), open: read(canopy.open, 0),
      n: [canopy.shaded.length, canopy.open.length],
    },
  };

  /* ---- normal chart: sun on, then sun off, at pinned exposure ---- */
  const uv = await page.evaluate(() => {
    const T = window.__BS;
    const render = T.ctx.render;
    // Pin the exposure before the A/B. Turning the key light off moves
    // the auto-exposure meter by up to half a stop over the frames it
    // takes to settle, which would land entirely inside the number
    // being measured.
    T.grade({ autoExposure: false, exposure: render.exposure, exposureBias: 1 });
    window.__bsInstallChart();
    const map = window.__bsChart.place();
    for (let i = 0; i < 4; i += 1) T.renderOnce(1 / 60);
    return map;
  });

  const chartUv = Object.entries(uv);
  read = await grab(page);
  const lit = {};
  for (const [id, p] of chartUv) lit[id] = read([p], 3);

  await page.evaluate(() => {
    window.__bsSunIntensity = window.__BS.ctx.render.sun.intensity;
    window.__BS.ctx.render.sun.intensity = 0;
    for (let i = 0; i < 3; i += 1) window.__BS.renderOnce(1 / 60);
  });
  read = await grab(page);
  const indirect = {};
  for (const [id, p] of chartUv) indirect[id] = read([p], 3);

  // Split the indirect term into its two sources, so a wrong
  // distribution can be attributed rather than guessed at.
  await page.evaluate(() => {
    const r = window.__BS.ctx.render;
    window.__bsHemi = r.hemi.intensity;
    r.hemi.intensity = 0;
    for (let i = 0; i < 3; i += 1) window.__BS.renderOnce(1 / 60);
  });
  read = await grab(page);
  const iblOnly = {};
  for (const [id, p] of chartUv) iblOnly[id] = read([p], 3);

  await page.evaluate(() => {
    const r = window.__BS.ctx.render;
    r.hemi.intensity = window.__bsHemi;
    r.sun.intensity = window.__bsSunIntensity;
    window.__bsChart.hide();
    window.__BS.grade({ autoExposure: true });
    for (let i = 0; i < 3; i += 1) window.__BS.renderOnce(1 / 60);
  });

  result.chart = { lit, indirect, iblOnly };
  return result;
}

/** sRGB byte triple, for eyeballing against a screenshot. */
function srgb(rgb) {
  if (!rgb) return "---,---,---";
  return rgb.map((c) => {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return String(Math.round(Math.min(1, Math.max(0, v)) * 255)).padStart(3);
  }).join(",");
}

function chroma(label, litRgb, shadeRgb) {
  const a = hueSat(litRgb);
  const b = hueSat(shadeRgb);
  if (a.hue === null || b.hue === null) return;
  const keep = a.sat > 1e-6 ? b.sat / a.sat : null;
  console.log(`  ${label} lit  RGB(${srgb(litRgb)})  hue ${a.hue.toFixed(1).padStart(5)}  sat ${a.sat.toFixed(3)}`);
  console.log(`  ${label} shade RGB(${srgb(shadeRgb)})  hue ${b.hue.toFixed(1).padStart(5)}  sat ${b.sat.toFixed(3)}`
    + `   dHue ${hueDelta(a.hue, b.hue).toFixed(1)}  satKept ${keep === null ? "n/a" : `${Math.round(keep * 100)}%`}`);
}

function printPose(r) {
  const g = ratio(r.ground.lit, r.ground.shade);
  const w = ratio(r.wall.lit, r.wall.shade);
  const c = ratio(r.canopy.open, r.canopy.shade);
  console.log(`\n=== ${r.pose} ===`);
  console.log(`  ground  lit ${fmt(r.ground.lit)}  shade ${fmt(r.ground.shade)}`
    + `   ratio ${g ? `${g.toFixed(1)}:1` : "n/a"}   (${r.ground.n[0]}/${r.ground.n[1]})`);
  chroma("  ground", r.ground.litRgb, r.ground.shadeRgb);
  console.log(`  wall    lit ${fmt(r.wall.lit)}  shade ${fmt(r.wall.shade)}`
    + `   ratio ${w ? `${w.toFixed(1)}:1` : "n/a"}   (${r.wall.n[0]}/${r.wall.n[1]})`);
  chroma("  wall  ", r.wall.litRgb, r.wall.shadeRgb);
  console.log(`  canopy  open ${fmt(r.canopy.open)} under ${fmt(r.canopy.shade)}`
    + `   ratio ${c ? `${c.toFixed(2)}:1` : "n/a"}   (${r.canopy.n[1]} open/${r.canopy.n[0]} under)`);

  const ids = Object.keys(r.chart.lit);
  const row = (label, obj, base) => {
    const parts = ids.map((id) => {
      const v = obj[id];
      const pct = base && base[id] && Number.isFinite(v)
        ? ` (${Math.round((v / base[id]) * 100)}%)` : "";
      return `${id} ${fmt(v, 4)}${pct}`;
    });
    console.log(`  ${label} ${parts.join("  ")}`);
  };
  row("total   ", r.chart.lit, null);
  row("indirect", r.chart.indirect, mapAll(ids, r.chart.indirect.up));
  row("ibl only", r.chart.iblOnly, mapAll(ids, r.chart.iblOnly.up));
  const vertOverUp = ratio(r.chart.indirect.vert, r.chart.indirect.up);
  const upShade = ratio(r.chart.lit.up, r.chart.indirect.up);
  const vertShade = ratio(r.chart.lit.vert, r.chart.indirect.vert);
  console.log(`  -> indirect vertical/up ${vertOverUp ? `${(vertOverUp * 100).toFixed(0)}%` : "n/a"}`
    + `   up lit:shade ${upShade ? `${upShade.toFixed(1)}:1` : "n/a"}`
    + `   vertical lit:shade ${vertShade ? `${vertShade.toFixed(1)}:1` : "n/a"}`);
}

function mapAll(ids, value) {
  const out = {};
  for (const id of ids) out[id] = value;
  return out;
}

async function main() {
  const server = startServer();
  let browser = null;
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

    await page.goto(`${BASE}/games/blacksand.html?qa=1&quality=${QUALITY}`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 180000 });
    await page.evaluate(() => {
      window.__BS.maximize();
      window.__BS.hideHud(true);
      window.__BS.hideViewmodel(true);
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    await page.evaluate(`window.__bsInstallChart = ${installNormalChart.toString()}`);
    await page.evaluate(() => window.__BS.advanceTime(4, 1 / 60));

    for (const pose of POSES) {
      const r = await measurePose(page, pose.trim());
      printPose(r);
    }

    if (args.sweep) {
      console.log(`\n--- sweeping the diffuse IBL scale, target ${TARGET.toFixed(1)}:1 ---`);
      await page.evaluate(() => {
        window.__BS.setPose("street");
        window.__BS.advanceTime(3, 1 / 60);
      });
      for (const mult of [1, 2, 3, 4]) {
        await page.evaluate((m) => {
          const r = window.__BS.ctx.render;
          r.scene.environmentIntensity = (r.scene.userData._baseEnv
            || (r.scene.userData._baseEnv = r.scene.environmentIntensity)) * m;
          for (let i = 0; i < 8; i += 1) window.__BS.renderOnce(1 / 60);
        }, mult);
        const surface = await page.evaluate(collectSurfacePoints);
        const read = await grab(page);
        const g = ratio(read(surface.groundLit), read(surface.groundShade));
        const w = ratio(read(surface.wallLit), read(surface.wallShade));
        console.log(`  x${String(mult).padStart(2)}  ground ${g ? g.toFixed(1) : "n/a"}:1`
          + `   wall ${w ? w.toFixed(1) : "n/a"}:1`);
      }
      await page.evaluate(() => {
        const r = window.__BS.ctx.render;
        if (r.scene.userData._baseEnv) r.scene.environmentIntensity = r.scene.userData._baseEnv;
      });
    }

    console.log(`\ntargets: ground and wall lit:shade near ${TARGET.toFixed(1)}:1 linear;`);
    console.log("shadowed ground keeps >=75% of the lit saturation and stays within 20 deg of hue;");
    console.log("indirect on a vertical face 40-50% of a horizontal one;");
    console.log("canopy open:under above 1.6:1 - 1.0 means the crown casts nothing.");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
