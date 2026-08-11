#!/usr/bin/env node
/* ============================================================
   BLACKSAND - first-person weapon probe

   The beauty harness frames landscape and the vfx probe frames a
   muzzle flash. Neither answers the question a blind art director
   actually asked about the view model: "does aluminium read as
   aluminium, or as unfired clay?"

   Two things here that the other harnesses do not do:

   MATERIAL READBACK. The weapon is merged one mesh per material, so
   hiding every mesh but one and rendering the view scene against a
   flat clear colour isolates exactly the pixels a single material
   covers. Mean RGB, spread, and the fraction of pixels pinned at 255
   are then a direct measurement of "are these materials
   distinguishable from each other" and "is the highlight clipping" -
   both of which a whole-frame mean is completely blind to.

   VIEW-CAMERA FRAMING. window.__BS.lookAt drives the WORLD camera,
   which cannot see the view scene at all. Every close-up here drives
   render.viewCamera directly.

   Usage:
     node scripts/blacksand-gun-probe.mjs --out output/blacksand-shots/gun-1
     node scripts/blacksand-gun-probe.mjs --weapon carbine --tod 9.5
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i += 1; }
    } else args._.push(token);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = path.resolve(root, args.out || "output/blacksand-shots/gun-latest");
const WIDTH = Number(args.width || 1600);
const HEIGHT = Number(args.height || 900);
const QUALITY = String(args.quality || "ultra");
const TOD = Number(args.tod || 15.6);
const PORT = Number(args.port || 45000 + (process.pid % 7000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE_URL}/games/blacksand.html?qa=1&quality=${QUALITY}`;

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

async function grab(page, file) {
  const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  await writeFile(file, buffer);
  return buffer;
}

/**
 * Draw and capture inside ONE evaluate.
 *
 * The page's own requestAnimationFrame loop is still running, and a
 * frame landing between "render what I asked for" and "read the canvas"
 * overwrites the drawing buffer with an ordinary gameplay frame. That
 * is not a hypothetical - the first version of this probe wrote
 * seventeen identical screenshots of a building. Nothing can interleave
 * inside a single synchronous task.
 */
async function drawAndGrab(page, file, fn, arg) {
  const dataUrl = await page.evaluate(({ src, a }) => {
    // eslint-disable-next-line no-new-func
    const run = new Function(`return (${src});`)();
    run(a, window.__BS);
    return window.__BS.captureDataURL();
  }, { src: fn.toString(), a: arg ?? null });
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  await writeFile(file, buffer);
  return buffer;
}

/** Stats over the pixels that are NOT the flat clear colour, which for
 *  an isolated-mesh render is exactly the pixels the material covers. */
async function subjectStats(file, keyRGB = [0, 96, 0], tol = 26) {
  const { data, info } = await sharp(file).removeAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  let n = 0; let rs = 0; let gs = 0; let bs = 0;
  let sum = 0; let sumSq = 0; let clipped = 0; let dark = 0;
  let minL = 255; let maxL = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    if (Math.abs(r - keyRGB[0]) < tol && Math.abs(g - keyRGB[1]) < tol
      && Math.abs(b - keyRGB[2]) < tol) continue;
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    n += 1; rs += r; gs += g; bs += b; sum += luma; sumSq += luma * luma;
    if (r >= 250 && g >= 250 && b >= 250) clipped += 1;
    if (luma <= 6) dark += 1;
    if (luma < minL) minL = luma;
    if (luma > maxL) maxL = luma;
  }
  if (!n) return { pixels: 0 };
  const mean = sum / n;
  return {
    pixels: n,
    rgb: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)],
    luma: Number(mean.toFixed(1)),
    sd: Number(Math.sqrt(Math.max(0, sumSq / n - mean * mean)).toFixed(1)),
    min: Number(minL.toFixed(0)),
    max: Number(maxL.toFixed(0)),
    clipPct: Number((clipped / n * 100).toFixed(2)),
    darkPct: Number((dark / n * 100).toFixed(2)),
  };
}

/** Stats over a fractional rect of the frame. */
async function rectStats(file, rect) {
  const { data, info } = await sharp(file).removeAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  const x0 = Math.floor(rect[0] * info.width);
  const y0 = Math.floor(rect[1] * info.height);
  const x1 = Math.min(info.width, x0 + Math.ceil(rect[2] * info.width));
  const y1 = Math.min(info.height, y0 + Math.ceil(rect[3] * info.height));
  let n = 0; let sum = 0; let sumSq = 0; let rs = 0; let gs = 0; let bs = 0;
  let maxL = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * info.width + x) * info.channels;
      const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      n += 1; sum += luma; sumSq += luma * luma;
      rs += data[i]; gs += data[i + 1]; bs += data[i + 2];
      if (luma > maxL) maxL = luma;
    }
  }
  const mean = sum / n;
  return {
    luma: Number(mean.toFixed(1)),
    sd: Number(Math.sqrt(Math.max(0, sumSq / n - mean * mean)).toFixed(1)),
    max: Number(maxL.toFixed(0)),
    rgb: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)],
  };
}

/* ------------------------- in-page helpers ------------------------- */

const RESET_VIEWCAM = () => {
  const cam = window.__BS.ctx.render.viewCamera;
  cam.position.set(0, 0, 0);
  cam.rotation.set(0, 0, 0);
  cam.fov = 58;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
};

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const server = startServer();
  let browser = null;
  const consoleErrors = [];
  const pageErrors = [];
  const results = [];
  let page = null;

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
      viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1,
    });
    page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 180000 });
    await page.evaluate(() => window.__BS.maximize());
    await page.evaluate(() => window.__BS.hideHud(true));
    await page.evaluate(() => {
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    await page.evaluate((t) => window.__BS.setTimeOfDay(t), TOD);
    await page.evaluate(() => window.__BS.hideViewmodel(false));
    await page.evaluate(() => window.__BS.advanceTime(3, 1 / 60));
    await page.evaluate(() => { for (let i = 0; i < 24; i += 1) window.__BS.renderOnce(1 / 60); });

    if (args.weapon) {
      // weapons.js has no select()/equip() - the loadout is three fixed
      // slots and switchTo() takes an INDEX. Calling the two methods
      // that do not exist silently did nothing, so --weapon has been a
      // no-op: `--weapon carbine` and `--weapon marksman` returned
      // byte-identical numbers to the default rifle.
      const ok = await page.evaluate((w) => {
        const W = window.__BS.ctx.weapons;
        const index = W.loadout.findIndex((s) => s.def.id === w);
        if (index < 0) return false;
        W.switchTo(index);
        window.__BS.advanceTime(1.6, 1 / 60);
        return true;
      }, String(args.weapon));
      if (!ok) {
        const have = await page.evaluate(() =>
          window.__BS.ctx.weapons.loadout.map((s) => s.def.id));
        throw new Error(`no weapon "${args.weapon}" in the loadout (have: ${have.join(", ")})`);
      }
    }

    /* ---------------- 1. hip-fire and ADS beauty frames ---------------- */

    const GAMEPLAY = (a, T) => {
      T.releaseCamera();
      T.ctx.input.state.ads = a.ads;
      T.advanceTime(1.4, 1 / 60);
      for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
    };
    for (const [id, ads] of [["hip", false], ["ads", true]]) {
      const file = path.join(OUT_DIR, `${id}.png`);
      await drawAndGrab(page, file, GAMEPLAY, { ads });
      const whole = await rectStats(file, [0, 0, 1, 1]);
      // The lower third is the weapon's permanent real estate.
      const lower = await rectStats(file, [0.25, 0.55, 0.5, 0.45]);
      results.push({ id, whole, lower });
      console.log(`${id.padEnd(14)} frame ${whole.luma} sd ${whole.sd}   `
        + `lower-third ${lower.luma} sd ${lower.sd} max ${lower.max} rgb ${lower.rgb.join(",")}`);
    }

    /* --------------- 2. optic close-up, ADS, cropped hard --------------- */

    {
      const file = path.join(OUT_DIR, "optic.png");
      await drawAndGrab(page, file, (a, T) => {
        T.ctx.input.state.ads = true;
        T.advanceTime(1.2, 1 / 60);
        for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
      });
      // maximize() resizes the canvas to the page, so the drawing buffer
      // is NOT the viewport the harness asked for. Crop in fractions of
      // the real image or the extract lands off it.
      const meta = await sharp(file).metadata();
      await sharp(file).extract({
        left: Math.round(meta.width * 0.34), top: Math.round(meta.height * 0.22),
        width: Math.round(meta.width * 0.32), height: Math.round(meta.height * 0.56),
      }).resize({ width: 1000 }).toFile(path.join(OUT_DIR, "optic-crop.png"));
      // The reticle lives in the middle of the tube. If it is invisible
      // against sand this rect will be indistinguishable from its ring.
      const dot = await rectStats(file, [0.487, 0.455, 0.026, 0.05]);
      const tube = await rectStats(file, [0.45, 0.40, 0.10, 0.16]);
      results.push({ id: "optic", dot, tube });
      console.log(`optic          reticle rgb ${dot.rgb.join(",")} luma ${dot.luma} max ${dot.max}`
        + `   tube ${tube.luma} sd ${tube.sd}`);
    }

    /* ---------------- 3. close-ups from the view camera ---------------- */

    /* Close-up framings, in GUN-LOCAL metres relative to the sight node.
     *
     * They used to be absolute view-scene coordinates, and two of the
     * five had been photographing empty space since they were written -
     * `cu-optic` came back luma 15.7 sd 0, which is the clear colour,
     * in every report going back to the baseline. The weapon is not at
     * the view scene's origin: it hangs off `holder`, whose position is
     * the whole hip-to-ADS pose solve, so any fixed point in view space
     * means a different point on the rifle depending on what the player
     * was doing. Anchoring to the sight node - which the model already
     * publishes, because the ADS solve needs it - makes a framing mean
     * the same thing every run.
     *
     * `cu-seam` is deliberately tight on the optic mount where it lands
     * on the rail. That junction is the one the art director called out
     * as floating, and it is far too small to judge in any framing that
     * also contains the receiver.
     */
    const ANGLES = [
      ["cu-optic", [0.10, 0.048, 0.145], [0.0, 0.0, -0.02], 30],
      ["cu-receiver", [0.20, 0.10, 0.02], [0.01, -0.01, -0.14], 26, true],
      ["cu-mag", [0.19, -0.05, -0.05], [0.01, -0.10, -0.16], 32, true],
      ["cu-muzzle", [0.13, 0.05, -0.30], [0.0, 0.0, -0.50], 34, true],
      ["cu-rail", [0.03, 0.16, -0.02], [0.0, 0.04, -0.20], 30, true],
      ["cu-seam", [0.105, -0.008, 0.030], [0.0, -0.028, 0.002], 18],
    ];
    const CLOSEUP = (p, T) => {
      const R = T.ctx.render;
      const cam = R.viewCamera;
      const gun = T.ctx.viewmodel.current;
      gun.updateMatrixWorld(true);
      let ox = 0; let oy = 0; let oz = 0;
      if (!p.absolute) {
        const s = gun.userData.sightLocal.clone().applyMatrix4(gun.matrixWorld);
        ox = s.x; oy = s.y; oz = s.z;
      }
      cam.position.set(p.eye[0] + ox, p.eye[1] + oy, p.eye[2] + oz);
      cam.fov = p.fov;
      cam.up.set(0, 1, 0);
      cam.lookAt(p.at[0] + ox, p.at[1] + oy, p.at[2] + oz);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      R.renderer.autoClear = true;
      R.renderer.setClearColor(0x0d1014, 1);
      R.renderer.render(R.viewScene, cam);
    };
    for (const [id, eye, at, fov, absolute] of ANGLES) {
      const file = path.join(OUT_DIR, `${id}.png`);
      await drawAndGrab(page, file, CLOSEUP, { eye, at, fov, absolute: Boolean(absolute) });
      const centre = await rectStats(file, [0.3, 0.3, 0.4, 0.4]);
      results.push({ id, centre });
      console.log(`${id.padEnd(14)} centre ${centre.luma} sd ${centre.sd} max ${centre.max}`);
    }

    /* ------------- 4. per-material readback (the real test) ------------- */

    const materialStats = [];
    const meshList = await page.evaluate(() => {
      const T = window.__BS;
      const out = [];
      T.ctx.viewmodel.current.traverse((o) => {
        if (o.isMesh && o.visible) {
          out.push({ name: o.material.name || o.material.type, uuid: o.uuid });
        }
      });
      return out;
    });

    // A three-quarter view that shows every material at once, so each
    // isolated render is framed the same way and the means are
    // comparable between materials.
    const ISOLATE = (p, T) => {
      const R = T.ctx.render;
      const cam = R.viewCamera;
      cam.position.set(0.30, 0.11, 0.10);
      cam.fov = 34;
      cam.up.set(0, 1, 0);
      cam.lookAt(0.01, -0.03, -0.20);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      const hidden = [];
      R.viewScene.traverse((o) => {
        if (o.isMesh && o.visible && o.uuid !== p.uuid) { o.visible = false; hidden.push(o); }
      });
      R.renderer.autoClear = true;
      R.renderer.setClearColor(0x006000, 1);
      R.renderer.render(R.viewScene, cam);
      for (const o of hidden) o.visible = true;
    };
    const seen = new Map();
    for (const entry of meshList) {
      const n = (seen.get(entry.name) || 0) + 1;
      seen.set(entry.name, n);
      const label = n > 1 ? `${entry.name}${n}` : entry.name;
      const file = path.join(OUT_DIR, `mat-${label}.png`);
      await drawAndGrab(page, file, ISOLATE, { uuid: entry.uuid });
      const stats = await subjectStats(file);
      materialStats.push({ material: label, ...stats });
    }

    console.log("\n--- material readback (isolated mesh, ADS-adjacent view) ---");
    console.log("material        px      rgb            luma    sd   min  max  clip%  black%");
    for (const m of materialStats) {
      if (!m.pixels) { console.log(`${(m.material || "?").padEnd(15)} (no pixels)`); continue; }
      console.log(
        `${m.material.padEnd(15)} ${String(m.pixels).padStart(7)} `
        + `${m.rgb.join(",").padEnd(14)} ${String(m.luma).padStart(6)} `
        + `${String(m.sd).padStart(5)} ${String(m.min).padStart(4)} ${String(m.max).padStart(4)} `
        + `${String(m.clipPct).padStart(6)} ${String(m.darkPct).padStart(6)}`
      );
    }
    // The separation the art director asked for, as one number: the
    // spread of per-material mean luma. Everything landing within a few
    // points of each other IS "the whole weapon reads as one object".
    const lumas = materialStats.filter((m) => m.pixels > 200).map((m) => m.luma);
    if (lumas.length > 1) {
      const lo = Math.min(...lumas); const hi = Math.max(...lumas);
      const mu = lumas.reduce((a, b) => a + b, 0) / lumas.length;
      const sd = Math.sqrt(lumas.reduce((a, b) => a + (b - mu) ** 2, 0) / lumas.length);
      console.log(`\nmaterial separation: range ${lo.toFixed(1)}..${hi.toFixed(1)} `
        + `(spread ${(hi - lo).toFixed(1)}), sd across materials ${sd.toFixed(1)}`);
      results.push({ id: "separation", lo, hi, spread: hi - lo, sd: Number(sd.toFixed(2)) });
    }

    await page.evaluate(RESET_VIEWCAM);

    const report = await page.evaluate(() => window.__BS.report());
    // qa.js does not surface the view model, and the thing this probe
    // most needs to know - what EV the weapon is tone-mapping itself at
    // relative to the world - lives there. Ask the module directly.
    const viewmodel = await page.evaluate(() => {
      const vm = window.__BS.ctx.viewmodel;
      return vm && vm.report ? vm.report() : null;
    });
    if (viewmodel && viewmodel.tone) {
      console.log(`\ntone  ev ${viewmodel.tone.ev} (scale ${viewmodel.tone.evScale}) `
        + `metered ${viewmodel.tone.metered} shadowLift ${viewmodel.tone.shadowLift}`
        + `   envMap bound ${viewmodel.envMapBound}`);
    }
    if (viewmodel && viewmodel.occlusion) {
      const o = viewmodel.occlusion;
      console.log(`occlusion bake  ${o.parts} parts / ${o.vertices} verts in ${o.ms}ms`
        + `   mean ${o.mean} max ${o.max} shaded ${o.shadedPct}%`);
    }
    console.log(`grade  exposure ${report.grade.exposure} bias ${report.grade.exposureBias} `
      + `shadowLift ${report.grade.shadowLift} lookSat ${report.grade.look.saturation}`);
    await writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify({
      url: GAME_URL, tod: TOD, results, materials: materialStats,
      viewmodel, grade: report.grade, render: report.render,
      consoleErrors, pageErrors,
    }, null, 2));

    console.log("\n--- render ---");
    console.log(JSON.stringify(report.render, null, 2));
    if (pageErrors.length) {
      console.error(`\n${pageErrors.length} page error(s):`);
      pageErrors.forEach((e) => console.error(`  ${e}`));
      process.exitCode = 1;
    }
    if (consoleErrors.length) {
      console.error(`\n${consoleErrors.length} console error(s):`);
      consoleErrors.slice(0, 10).forEach((e) => console.error(`  ${e}`));
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
