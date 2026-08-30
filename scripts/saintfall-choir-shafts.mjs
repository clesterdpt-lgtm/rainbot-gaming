#!/usr/bin/env node
/* ============================================================
   SAINTFALL - Choir Spires light-shaft review

   The report was "random beams of light that look strange in the
   Choir Spires". A light shaft is only a light shaft when it has a
   slot to come THROUGH and a floor to land ON; anything else is an
   additive cone shell hanging in open sky, and an additive cone
   shell is brightest exactly along its own silhouette.

   So this photographs the district the way a player meets it -
   standing on the floor, looking up and across - at several times
   of day, because the sun MOVES and the shafts are baked once.

   Usage: node scripts/saintfall-choir-shafts.mjs [outdir]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, process.argv[2] || "output/saintfall/choir-shafts");
const PORT = 46200 + (process.pid % 1500);
const BASE = `http://127.0.0.1:${PORT}`;

function tag(width, text) {
  const safe = String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return Buffer.from(`<svg width="${width}" height="22" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="22" fill="#0d0b10" fill-opacity="0.86"/>
    <text x="7" y="16" fill="#f4d487" font-family="monospace" font-size="11">${safe}</text>
  </svg>`);
}

async function sheet(tiles, cols, tw, th, file) {
  const rows = Math.ceil(tiles.length / cols);
  const buffer = await sharp({
    create: { width: cols * tw, height: rows * th, channels: 3, background: "#0d0b10" },
  }).composite(tiles.map((input, i) => ({
    input, left: (i % cols) * tw, top: Math.floor(i / cols) * th,
  }))).png().toBuffer();
  await writeFile(file, buffer);
  return file;
}

const server = spawn("/opt/homebrew/bin/python3",
  ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
  { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {});

let browser = null;
try {
  for (let i = 0; i < 200; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) break; } catch (_) { /* retry */ }
    await delay(100);
  }
  await mkdir(out, { recursive: true });

  browser = await chromium.launch({
    channel: "chromium", headless: true,
    args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
      "--enable-unsafe-swiftshader", "--disable-frame-rate-limit", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 620 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
  await page.evaluate(() => {
    window.__SF.maximize(); window.__SF.hideHud(true);
    const el = document.getElementById("sf-boot");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });

  /* ---- what is actually up there ---- */
  const facts = await page.evaluate(() => {
    const T = window.__SF;
    const ctx = T.ctx;
    const d = ctx.districts.choir;
    let shafts = null;
    ctx.scene.traverse((o) => { if (o.name === "shafts") shafts = o; });
    const box = new T.THREE.Box3();
    let bounds = null;
    if (shafts) {
      box.setFromObject(shafts);
      bounds = [box.min.toArray().map((v) => +v.toFixed(1)),
        box.max.toArray().map((v) => +v.toFixed(1))];
    }
    // Tallest spire crown anywhere near the district centre, sampled
    // by raycasting straight down from high above a grid.
    const ray = new T.THREE.Raycaster();
    const down = new T.THREE.Vector3(0, -1, 0);
    const meshes = ctx.world ? ctx.world.meshes : [];
    let tallest = 0;
    for (let i = 0; i < 260; i += 1) {
      const a = (i / 260) * Math.PI * 2 * 7;
      const r = (i / 260) * 300;
      const x = d.x + Math.cos(a) * r;
      const z = d.z + Math.sin(a) * r;
      ray.set(new T.THREE.Vector3(x, 400, z), down);
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) tallest = Math.max(tallest, hit.point.y - ctx.terrain.heightAt(x, z));
    }
    return {
      district: { x: d.x, z: d.z, r: d.r },
      groundY: +ctx.terrain.heightAt(d.x, d.z).toFixed(2),
      shaftBounds: bounds,
      shaftTris: shafts ? shafts.geometry.index.count / 3 : 0,
      sunDir: ctx.atmos.sunDir.toArray().map((v) => +v.toFixed(3)),
      solarHour: +ctx.atmos.solarHour.toFixed(2),
      cycleRunning: !!ctx.atmos.cycleRunning,
      tallestSpire: +tallest.toFixed(1),
    };
  });
  console.log(JSON.stringify(facts, null, 2));

  /* ---- an eye-level pan, which is how a player meets the district ---- */
  const shoot = async (time, view) => {
    const url = await page.evaluate(([t, v]) => {
      const T = window.__SF;
      const d = T.ctx.districts.choir;
      T.setTime(t);
      const ex = d.x + v.eye[0];
      const ez = d.z + v.eye[2];
      const ey = T.ctx.terrain.heightAt(ex, ez) + v.eye[1];
      const tx = v.bearing === undefined
        ? d.x + v.target[0] : ex + Math.sin(v.bearing) * 200;
      const tz = v.bearing === undefined
        ? d.z + v.target[2] : ez + Math.cos(v.bearing) * 200;
      const ty = v.bearing === undefined
        ? T.ctx.terrain.heightAt(d.x, d.z) + v.target[1] : ey + (v.rise || 0) * 200;
      T.lookAt([ex, ey, ez], [tx, ty, tz], v.fov || 62);
      for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
      T.renderStill();
      return T.captureDataURL();
    }, [time, view]);
    return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  };

  /* ---- does a shaft still land, at every hour? ----

     The failure this whole pass exists to stop is a cone hanging in
     open air, so measure it rather than trusting a frame: walk the
     day cycle and read the real vertex buffer back. */
  const walk = await page.evaluate(() => {
    const T = window.__SF;
    let mesh = null;
    T.ctx.scene.traverse((o) => { if (o.name === "shafts") mesh = o; });
    const anchors = T.ctx.world.emitters.filter((e) => e.kind === "shaft" && e.sun === true);
    const first = T.ctx.world.emitters.filter((e) => e.kind === "shaft").indexOf(anchors[0]);
    const RING = 22 * 7;
    const rows = [];
    for (let i = 0; i < 12; i += 1) {
      const phase = i / 12;
      T.setDayCycle(phase, false);
      T.renderOnce(1 / 60);
      const p = mesh.geometry.attributes.position.array;
      const c = mesh.geometry.attributes.color.array;
      let worstGap = -1e9;
      let peakCol = 0;
      let maxLen = 0;
      for (let s = 0; s < anchors.length; s += 1) {
        const base = (first + s) * RING * 3;
        // The last ring is the landing end; the first is the entry.
        let low = 1e9;
        let high = -1e9;
        let lx = 0;
        let lz = 0;
        for (let k = 0; k < 22; k += 1) {
          const w = base + (6 * 22 + k) * 3;
          low = Math.min(low, p[w + 1]);
          lx += p[w] / 22;
          lz += p[w + 2] / 22;
        }
        for (let k = 0; k < RING; k += 1) {
          high = Math.max(high, p[base + k * 3 + 1]);
          peakCol = Math.max(peakCol, c[base + k * 3], c[base + k * 3 + 1], c[base + k * 3 + 2]);
        }
        maxLen = Math.max(maxLen, high - low);
        worstGap = Math.max(worstGap, low - T.ctx.terrain.heightAt(lx, lz));
      }
      rows.push({
        phase: +phase.toFixed(2),
        hour: +T.ctx.atmos.solarHour.toFixed(1),
        daylight: +(T.ctx.atmos.daylightFactor ?? 1).toFixed(2),
        gapAboveGround: +worstGap.toFixed(1),
        maxDrop: +maxLen.toFixed(1),
        peakColour: +peakCol.toFixed(3),
      });
    }
    T.setTime("goldenhour");
    return rows;
  });
  console.log("\nphase  hour  daylight  gap above ground  vertical drop  peak vertex colour");
  for (const r of walk) {
    console.log(`${String(r.phase).padEnd(6)} ${String(r.hour).padStart(4)}  `
      + `${String(r.daylight).padStart(8)}  ${String(r.gapAboveGround).padStart(16)}  `
      + `${String(r.maxDrop).padStart(13)}  ${String(r.peakColour).padStart(18)}`);
  }
  const floating = walk.filter((r) => r.gapAboveGround > 2.5);
  const noon = Math.max(...walk.map((r) => r.peakColour));
  /* Not "zero at night" - `daylightFactor` is a crossfade and bottoms
     out at 0.03 rather than 0. Under a twentieth of the noon value is
     the honest test, and it is the one that would have caught the
     warm cones that used to hang over the district at midnight. */
  const litAtNight = walk.filter((r) => r.daylight < 0.05 && r.peakColour > noon * 0.05);
  if (floating.length) {
    console.log(`FAIL: shaft ends above the sand at ${floating.length} hour(s)`);
    process.exitCode = 1;
  }
  if (litAtNight.length) {
    console.log(`FAIL: sun shafts still lit at ${litAtNight.length} night hour(s)`);
    process.exitCode = 1;
  }

  /* ---- one frame per shaft, from where it lands, WITH the shafts
     isolated. The mission beacon and the sunlit rock faces are both
     pale vertical shapes in this district, and three review passes
     were spent looking at the wrong one. The only way to know what a
     shaft contributes is to render the frame twice. ---- */
  const anchors = await page.evaluate(() =>
    window.__SF.ctx.world.emitters.filter((e) => e.kind === "shaft" && e.sun === true));
  console.log(`sun shafts: ${anchors.length}`);
  const closeTiles = [];
  for (const time of ["goldenhour", "day", "dusk"]) {
    for (let i = 0; i < Math.min(3, anchors.length); i += 1) {
      const pair = await page.evaluate(([t, n]) => {
        const T = window.__SF;
        T.setTime(t);
        const sun = T.ctx.atmos.sunDir;
        // Stand off to the side of the shaft, downsun, and look at it.
        const flat = Math.hypot(sun.x, sun.z) || 1;
        const px = -sun.z / flat;
        const pz = sun.x / flat;
        // Broadside, at eye height: the way you meet one walking past.
        const ex = n.x - sun.x / flat * 22 + px * 56;
        const ez = n.z - sun.z / flat * 22 + pz * 56;
        const ey = T.ctx.terrain.heightAt(ex, ez) + 2.4;
        let shafts = null;
        T.ctx.scene.traverse((o) => { if (o.name === "shafts") shafts = o; });
        T.lookAt([ex, ey, ez], [n.x, n.y - 14, n.z], 64);
        for (let k = 0; k < 8; k += 1) T.renderOnce(1 / 60);
        /* Both halves of the pair are drawn WITHOUT advancing time.
           Stepping between them let the dust field move, and the diff
           came back speckled with motes that were read as shaft
           artefacts - and swung the reported peak by 60%. */
        T.renderStill();
        const on = T.captureDataURL();
        shafts.visible = false;
        T.renderStill();
        const off = T.captureDataURL();
        shafts.visible = true;
        return [on, off];
      }, [time, anchors[i]]);
      const [on, off] = pair.map((u) => Buffer.from(u.slice(u.indexOf(",") + 1), "base64"));
      await writeFile(path.join(out, `close-${time}-${i}.png`), on);
      // The shaft alone: |with - without|, lifted so it is readable.
      const a = await sharp(on).removeAlpha().raw().toBuffer();
      const b = await sharp(off).removeAlpha().raw().toBuffer();
      const d = Buffer.alloc(a.length);
      let peak = 0;
      let lit = 0;
      for (let k = 0; k < a.length; k += 1) {
        const v = Math.abs(a[k] - b[k]);
        peak = Math.max(peak, v);
        if (v > 3) lit += 1;
        d[k] = Math.min(255, v * 6);
      }
      console.log(`  ${time} shaft ${i}: peak delta ${peak}/255, `
        + `${(lit / a.length * 100).toFixed(1)}% of subpixels touched`);
      const iso = await sharp(d, { raw: { width: 960, height: 620, channels: 3 } })
        .png().toBuffer();
      closeTiles.push(await sharp(on).resize(420, 272, { fit: "cover" })
        .composite([{ input: tag(420, `${time} - shaft ${i}`), left: 0, top: 0 }])
        .png().toBuffer());
      closeTiles.push(await sharp(iso).resize(420, 272, { fit: "cover" })
        .composite([{ input: tag(420, `^ shaft alone (x6)  peak ${peak}`), left: 0, top: 0 }])
        .png().toBuffer());
    }
  }
  const closeFile = await sheet(closeTiles, 2, 420, 272, path.join(out, "choir-close.png"));
  console.log(`close: ${path.relative(root, closeFile)}`);

  const panTiles = [];
  for (const time of ["goldenhour", "dusk"]) {
    for (let i = 0; i < 6; i += 1) {
      const bearing = (i / 6) * Math.PI * 2;
      const buffer = await shoot(time, { eye: [30, 2.4, 120], bearing, rise: 0.34, fov: 64 });
      await writeFile(path.join(out, `pan-${time}-${Math.round(bearing * 57.3)}.png`), buffer);
      panTiles.push(await sharp(buffer).resize(420, 272, { fit: "cover" })
        .composite([{ input: tag(420, `${time} - ${Math.round(bearing * 57.3)}deg`), left: 0, top: 0 }])
        .png().toBuffer());
    }
  }
  const panFile = await sheet(panTiles, 3, 420, 272, path.join(out, "choir-pan.png"));
  console.log(`pan:   ${path.relative(root, panFile)}`);

  /* ---- and the district as a whole, at four hours ---- */
  const tiles = [];
  const TIMES = ["goldenhour", "day", "dusk", "night"];
  const VIEWS = [
    { name: "floor look-up", eye: [40, 3.0, 150], target: [0, 70, -40], fov: 62 },
    { name: "floor across", eye: [40, 3.0, 150], target: [0, 24, -60], fov: 62 },
    { name: "high 3/4", eye: [300, 120, 300], target: [0, 40, 0], fov: 48 },
  ];
  for (const time of TIMES) {
    for (const v of VIEWS) {
      const buffer = await shoot(time, v);
      await writeFile(path.join(out, `${time}-${v.name.replace(/[^a-z]+/gi, "-")}.png`), buffer);
      tiles.push(await sharp(buffer).resize(420, 272, { fit: "cover" })
        .composite([{ input: tag(420, `${time} - ${v.name}`), left: 0, top: 0 }])
        .png().toBuffer());
    }
  }
  const file = await sheet(tiles, 3, 420, 272, path.join(out, "choir-shafts.png"));
  console.log(`sheet: ${path.relative(root, file)}`);

  /* ---- the nave, which shares the shaft material and must not have
     been dragged along by any of this ---- */
  const naveTiles = [];
  for (const [name, view] of [
    ["nave up", [0, 2.2, 44, 0, 22, -40]],
    ["nave crossing", [-14, 2.2, 8, 10, 16, -34]],
    ["rose", [0, 2.2, -18, 0, 26, 62]],
  ]) {
    const url = await page.evaluate(([v]) => {
      const T = window.__SF;
      const c = T.ctx.districts.cathedral;
      const y = T.ctx.terrain.field.cathedralPlazaY;
      T.setTime("goldenhour");
      T.lookAt([c.x + v[0], y + v[1], c.z + v[2]], [c.x + v[3], y + v[4], c.z + v[5]], 66);
      for (let i = 0; i < 8; i += 1) T.renderOnce(1 / 60);
      T.renderStill();
      return T.captureDataURL();
    }, [view]);
    const buffer = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    await writeFile(path.join(out, `nave-${name.replace(/\W+/g, "-")}.png`), buffer);
    naveTiles.push(await sharp(buffer).resize(420, 272, { fit: "cover" })
      .composite([{ input: tag(420, name), left: 0, top: 0 }]).png().toBuffer());
  }
  const naveFile = await sheet(naveTiles, 3, 420, 272, path.join(out, "nave-shafts.png"));
  console.log(`nave:  ${path.relative(root, naveFile)}`);
  if (errors.length) {
    console.log("console errors:");
    for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
    process.exitCode = 1;
  }
} finally {
  if (browser) await browser.close();
  server.kill("SIGKILL");
}
