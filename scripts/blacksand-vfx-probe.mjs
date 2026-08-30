#!/usr/bin/env node
/* ============================================================
   BLACKSAND - VFX / weapons / vehicles probe

   The beauty-shot harness frames landscape and the vehicle harness
   frames parked hardware. Neither of them ever gets close enough to
   a bullet hole, a burning wreck or an optic ring for the faults that
   lose a blind comparison to be visible at all.

   This one parks the camera at contact range:

     decals      a wall shot forty times, from 0.6m and from 4m
     fire        a burning APC at dusk, so "does the fire light the
                 ground" is answerable from the image
     muzzle      the frame of the shot, viewmodel visible
     optic       the red dot filling a third of frame width
     vehicle     an unoccupied jeep in full sun and in shade, plus a
                 luma histogram of the pixels the vehicle actually
                 covers (a black-hole vehicle is invisible to a
                 whole-frame mean)
     shadow      a low sun raking across a parked jeep, framed on the
                 GROUND beside it, so a missing cast shadow is a
                 missing black shape rather than a subtle one

   Usage:
     node scripts/blacksand-vfx-probe.mjs --out output/blacksand-shots/vfx-1
     node scripts/blacksand-vfx-probe.mjs --shots decals,optic
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
const OUT_DIR = path.resolve(root, args.out || "output/blacksand-shots/vfx-latest");
const WIDTH = Number(args.width || 1600);
const HEIGHT = Number(args.height || 900);
const QUALITY = String(args.quality || "ultra");
const HEADED = Boolean(args.headed);
const PORT = Number(args.port || 45000 + (process.pid % 7000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE_URL}/games/blacksand.html?qa=1&quality=${QUALITY}`;

const WANT = !args.shots || args.shots === true || args.shots === "all"
  ? null
  : String(args.shots).split(",").map((s) => s.trim()).filter(Boolean);
const wanted = (id) => !WANT || WANT.includes(id);

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

/** Whole-frame stats plus, optionally, stats over a rect only. A dark
 *  subject in a bright frame does not move the whole-frame mean at
 *  all, which is exactly how "the vehicle is a black hole" survived
 *  several rounds of image checks. */
async function analyse(file, rect) {
  const image = sharp(file).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const measure = (x0, y0, x1, y1) => {
    let sum = 0; let sumSq = 0; let n = 0; let minL = 255; let maxL = 0;
    let rs = 0; let gs = 0; let bs = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * info.width + x) * info.channels;
        const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        sum += luma; sumSq += luma * luma; n += 1;
        rs += data[i]; gs += data[i + 1]; bs += data[i + 2];
        if (luma < minL) minL = luma;
        if (luma > maxL) maxL = luma;
      }
    }
    const mean = sum / n;
    return {
      mean: Number(mean.toFixed(2)),
      sd: Number(Math.sqrt(Math.max(0, sumSq / n - mean * mean)).toFixed(2)),
      min: Number(minL.toFixed(1)),
      max: Number(maxL.toFixed(1)),
      rgb: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)],
    };
  };
  const out = { frame: measure(0, 0, info.width, info.height) };
  if (rect) {
    // Fractions, not pixels: `maximize()` resizes the canvas to the
    // page, so the drawing buffer is not the viewport the harness asked
    // for and a pixel rect silently lands off the image.
    const x = Math.floor(rect[0] * info.width);
    const y = Math.floor(rect[1] * info.height);
    const w = Math.ceil(rect[2] * info.width);
    const h = Math.ceil(rect[3] * info.height);
    out.region = measure(x, y, Math.min(info.width, x + w), Math.min(info.height, y + h));
  }
  return out;
}

/* ------------------------- in-page helpers ------------------------- */

/** Free an unoccupied vehicle of `type` and park it somewhere flat and
 *  clear, facing a chosen heading. Returns its world position. */
const PARK = ({ type, dx, dz, yaw }) => {
  const T = window.__BS;
  const V = T.ctx.vehicles;
  const P = T.ctx.player;
  const v = V.vehicles.find((k) => k.type === type && k.alive);
  if (!v) return null;
  for (const o of v.occupants.slice()) V.exit(v, o);
  // Sweep for a bearing with nothing within 22m, so the subject is not
  // parked inside a compound wall. Falls back to the requested offset.
  const radius = Math.hypot(dx, dz);
  let x = P.position.x + dx;
  let z = P.position.z + dz;
  const THREE = T.THREE;
  let bestClear = -1;
  for (let i = 0; i < 48; i += 1) {
    const a = (i / 48) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const origin = new THREE.Vector3(P.position.x, P.position.y + 1.2, P.position.z);
    const h = T.ctx.physics.raycast(origin, dir, 40);
    const clear = h && h.hit ? h.distance : 40;
    const gx = P.position.x + Math.sin(a) * radius;
    const gz = P.position.z + Math.cos(a) * radius;
    // Reject slopes: a vehicle on a dune edge frames against sky.
    const slope = Math.abs(T.heightAt(gx + 3, gz) - T.heightAt(gx - 3, gz))
      + Math.abs(T.heightAt(gx, gz + 3) - T.heightAt(gx, gz - 3));
    const score = clear - slope * 6;
    if (score > bestClear) { bestClear = score; x = gx; z = gz; }
  }
  v.position.set(x, T.heightAt(x, z) + 1.2, z);
  v.velocity.set(0, 0, 0);
  v.yaw = yaw;
  v.pitch = 0;
  v.roll = 0;
  v.asleep = false;
  v.sleepTimer = 0;
  if (v.quaternion) v.quaternion.setFromEuler(new T.THREE.Euler(0, yaw, 0, "YXZ"));
  T.advanceTime(2.0, 1 / 60);
  return { id: v.id, pos: v.position.toArray(), state: v.state };
};

const FRAME = ({ pos, az, el, dist, aim, fov }) => {
  const T = window.__BS;
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  const flat = Math.cos(e) * dist;
  T.lookAt(
    [pos[0] + Math.sin(a) * flat, pos[1] + aim + Math.sin(e) * dist, pos[2] + Math.cos(a) * flat],
    [pos[0], pos[1] + aim, pos[2]],
    fov
  );
  return T.cameraClearance(80);
};

async function frames(page, n = 8) {
  await page.evaluate((k) => { for (let i = 0; i < k; i += 1) window.__BS.renderOnce(1 / 60); }, n);
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const server = startServer();
  let browser = null;
  const consoleErrors = [];
  const pageErrors = [];
  const results = [];

  const shot = async (id, file, rect, extra) => {
    const full = path.join(OUT_DIR, `${id}.png`);
    await grab(page, full);
    const stats = await analyse(full, rect);
    results.push({ id, ...stats, ...(extra || {}) });
    console.log(`${id.padEnd(18)} frame ${String(stats.frame.mean).padStart(6)} `
      + `sd ${String(stats.frame.sd).padStart(5)}`
      + (stats.region ? `   region ${stats.region.mean} sd ${stats.region.sd} `
        + `min ${stats.region.min} rgb ${stats.region.rgb.join(",")}` : ""));
    return stats;
  };

  let page = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium",
      headless: !HEADED,
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
    await frames(page, 20);
    await page.evaluate(() => window.__BS.advanceTime(3, 1 / 60));

    /* ---------------- decals: shoot a wall and stand next to it ---------------- */
    if (wanted("decals")) {
      await page.evaluate(() => window.__BS.setTimeOfDay(15.4));
      const hit = await page.evaluate(() => {
        const T = window.__BS;
        const THREE = T.THREE;
        const P = T.ctx.player;
        const phys = T.ctx.physics;
        // Find a wall: cast a fan of rays outward from the player at
        // chest height and keep the closest vertical face.
        let best = null;
        for (let i = 0; i < 720; i += 1) {
          const a = (i / 720) * Math.PI * 2;
          const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
          const origin = new THREE.Vector3(P.position.x, P.position.y + 1.4, P.position.z);
          const h = phys.raycast(origin, dir, 40);
          if (!h || !h.hit || !h.normal) continue;
          if (Math.abs(h.normal.y) > 0.4) continue;
          if (h.distance < 3) continue;
          if (!best || h.distance < best.distance) {
            best = { distance: h.distance, point: h.point.clone(), normal: h.normal.clone(), surface: h.surface };
          }
        }
        if (!best) return null;
        // Forty rounds into a 1.2m patch, at mixed energies.
        const vfx = T.ctx.vfx;
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(up, best.normal).normalize();
        for (let i = 0; i < 40; i += 1) {
          const p = best.point.clone()
            .addScaledVector(right, (Math.random() - 0.5) * 1.3)
            .addScaledVector(up, (Math.random() - 0.5) * 0.9);
          vfx.impact(p, best.normal, best.surface, 0.4 + Math.random() * 0.6);
        }
        T.advanceTime(2.4, 1 / 60);
        return {
          point: best.point.toArray(),
          normal: best.normal.toArray(),
          distance: best.distance,
          surface: best.surface,
        };
      });
      if (hit) {
        for (const [id, back] of [["decals-close", 0.75], ["decals-mid", 4.0]]) {
          await page.evaluate(({ h, b }) => {
            const T = window.__BS;
            const eye = [
              h.point[0] + h.normal[0] * b + 0.18,
              h.point[1] + h.normal[1] * b + 0.12,
              h.point[2] + h.normal[2] * b + 0.18,
            ];
            T.lookAt(eye, h.point, 42);
          }, { h: hit, b: back });
          await frames(page, 6);
          await shot(id, null, [0.30, 0.30, 0.40, 0.40], { hit });
        }
      } else console.warn("no wall found for decals");
    }

    /* ---------------- vehicle: unoccupied jeep, sun and shade ---------------- */
    if (wanted("vehicle")) {
      const parked = await page.evaluate(PARK, { type: "jeep", dx: 9, dz: 4, yaw: 1.1 });
      if (parked) {
        for (const [id, tod] of [["vehicle-noon", 13.0], ["vehicle-low", 17.4], ["vehicle-dusk", 19.2]]) {
          await page.evaluate((t) => window.__BS.setTimeOfDay(t), tod);
          const clear = await page.evaluate(FRAME,
            { pos: parked.pos, az: 40, el: 10, dist: 7.4, aim: 0.7, fov: 42 });
          await frames(page, 8);
          // The jeep occupies roughly the middle third of the frame at
          // this distance; measure there, not over the whole image.
          await shot(id, null, [0.30, 0.35, 0.40, 0.35],
            { parked, clear, tod });
        }
      } else console.warn("no jeep to park");
    }

    /* ---------------- shadow: is the vehicle in the shadow map? ---------------- */
    if (wanted("shadow")) {
      const parked = await page.evaluate(PARK, { type: "jeep", dx: 9, dz: 4, yaw: 0.4 });
      if (parked) {
        await page.evaluate(() => window.__BS.setTimeOfDay(16.8));
        await page.evaluate((p) => {
          const T = window.__BS;
          // Look down at the ground on the anti-sun side. If the jeep
          // casts, there is a hard dark shape here; if it does not,
          // this is plain lit sand.
          T.lookAt([p[0] - 5, p[1] + 6.5, p[2] + 5], [p[0] + 1.5, p[1] - 0.4, p[2] - 1.5], 52);
        }, parked.pos);
        await frames(page, 8);
        await shot("shadow-ground", null, [0.25, 0.40, 0.50, 0.50],
          { parked });
      }
    }

    /* ---------------- fire ---------------- */
    if (wanted("fire")) {
      const parked = await page.evaluate(PARK, { type: "apc", dx: 11, dz: 2, yaw: 2.2 });
      if (parked) {
        for (const [id, tod] of [["fire-day", 14.0], ["fire-dusk", 19.6], ["fire-night", 21.6]]) {
          const info = await page.evaluate(({ p, t }) => {
            const T = window.__BS;
            const V = T.ctx.vehicles;
            const apc = V.vehicles.find((k) => k.id === p.id);
            apc.health = apc.spec.health;
            apc.alive = true;
            if (apc.body) apc.body.visible = true;
            // damage() applies armour, so a single hit sized as a
            // fraction of max health does not reliably reach the
            // burning threshold. Keep hitting until the state changes.
            for (let i = 0; i < 12 && apc.state !== "burning" && apc.alive; i += 1) {
              V.damage(apc, apc.spec.health * 0.35);
            }
            T.setTimeOfDay(t);
            T.advanceTime(5.0, 1 / 60);
            const yaw = apc.yaw + Math.PI * 0.3;
            T.lookAt(
              [apc.position.x + Math.sin(yaw) * 11, apc.position.y + 2.6, apc.position.z + Math.cos(yaw) * 11],
              [apc.position.x, apc.position.y + 1.4, apc.position.z],
              44
            );
            return {
              state: apc.state, alive: apc.alive, health: apc.health,
              vfx: T.ctx.vfx.report ? T.ctx.vfx.report() : null,
            };
          }, { p: parked, t: tod });
          await frames(page, 4);
          await shot(id, null, [0.32, 0.25, 0.36, 0.50], { info, tod });
        }
      }
    }

    /* ---------------- viewmodel: optic and muzzle ---------------- */
    if (wanted("optic") || wanted("muzzle")) {
      await page.evaluate(() => window.__BS.setTimeOfDay(15.6));
      await page.evaluate(() => window.__BS.hideViewmodel(false));
      await page.evaluate(() => {
        const T = window.__BS;
        T.releaseCamera();
        T.ctx.input.state.ads = true;
        T.advanceTime(1.2, 1 / 60);
      });
      await frames(page, 6);
      if (wanted("optic")) {
        await shot("optic-ads", null, [0.38, 0.28, 0.24, 0.44]);
      }
      if (wanted("gun")) {
        // Drive the VIEW camera directly. The QA lookAt moves the world
        // camera, which cannot see the view scene at all - and an ADS
        // screenshot is the one angle from which you cannot tell which
        // part of the weapon you are looking at.
        for (const [id, eye, at, fov] of [
          ["gun-quarter", [0.34, 0.12, 0.16], [0.02, -0.02, -0.26], 40],
          ["gun-side", [0.55, 0.02, -0.20], [0.0, -0.04, -0.22], 38],
          ["gun-rear", [0.10, 0.10, 0.30], [0.0, -0.02, -0.20], 40],
        ]) {
          await page.evaluate(({ e, a, f }) => {
            const T = window.__BS;
            const cam = T.ctx.render.viewCamera;
            cam.position.set(e[0], e[1], e[2]);
            cam.lookAt(a[0], a[1], a[2]);
            cam.fov = f;
            cam.updateProjectionMatrix();
            cam.updateMatrixWorld(true);
            T.ctx.render.renderer.render(T.ctx.render.viewScene, cam);
          }, { e: eye, a: at, f: fov });
          await shot(id, null, [0.15, 0.15, 0.7, 0.7]);
        }
        await page.evaluate(() => {
          const cam = window.__BS.ctx.render.viewCamera;
          cam.position.set(0, 0, 0);
          cam.rotation.set(0, 0, 0);
          cam.updateProjectionMatrix();
        });
      }

      if (wanted("muzzle")) {
        const fired = await page.evaluate(() => {
          const T = window.__BS;
          const W = T.ctx.weapons;
          let ok = false;
          for (let i = 0; i < 6; i += 1) {
            if (W.fireOnce) { W.fireOnce(); ok = true; }
            T.renderOnce(1 / 120);
          }
          return ok;
        }).catch(() => false);
        // Whether or not weapons exposes a fire hook, drive the effect
        // directly so the flash geometry is always exercised.
        await page.evaluate(() => {
          const T = window.__BS;
          const P = T.ctx.player;
          const dir = P.aimDirection.clone();
          const muzzle = P.position.clone();
          muzzle.y += 1.5;
          muzzle.addScaledVector(dir, 0.7);
          T.ctx.vfx.muzzleFlash(muzzle, dir, 1.0, { weapon: "carbine" });
          T.ctx.vfx.tracer(muzzle, dir, 60, {});
          T.renderOnce(1 / 240);
        });
        await shot("muzzle-flash", null, [0.30, 0.30, 0.40, 0.40], { fired });
      }
    }

    const report = await page.evaluate(() => window.__BS.report());
    const vfx = await page.evaluate(() => (window.__BS.ctx.vfx.report ? window.__BS.ctx.vfx.report() : null));
    await writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify({
      url: GAME_URL, results, vfx,
      render: report.render, consoleErrors, pageErrors,
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
      consoleErrors.slice(0, 12).forEach((e) => console.error(`  ${e}`));
    }
    console.log(`\nartifacts: ${path.relative(root, OUT_DIR)}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
