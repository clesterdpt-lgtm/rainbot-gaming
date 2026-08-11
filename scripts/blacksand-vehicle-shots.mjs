#!/usr/bin/env node
/* ============================================================
   BLACKSAND - vehicle probe harness

   The standard beauty shots frame landscape, not hardware. This one
   frames each vehicle as a product shot: hero three-quarter, side
   elevation for silhouette, rear for stowage, and a top-down on the
   helicopter's rotor head. It also drives one, flies one, and burns
   one, because a vehicle that only looks right parked is half a
   vehicle.

   Usage:
     node scripts/blacksand-vehicle-shots.mjs --out output/blacksand-shots/veh-1
     node scripts/blacksand-vehicle-shots.mjs --shots jeep-hero,heli-hero

   Flags:
     --out <dir>       artifact directory
     --shots <a,b,c>   shot ids, or "all" (default all)
     --width/--height  viewport (default 1600x900)
     --quality <tier>  low|medium|high|ultra (default ultra)
     --headed          run with a visible browser window
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
const OUT_DIR = path.resolve(root, args.out || "output/blacksand-shots/veh-latest");
const WIDTH = Number(args.width || 1600);
const HEIGHT = Number(args.height || 900);
const QUALITY = String(args.quality || "ultra");
const HEADED = Boolean(args.headed);
const PORT = Number(args.port || 43000 + (process.pid % 9000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE_URL}/games/blacksand.html?qa=1&quality=${QUALITY}`;

/* ---------------------------- shot list ---------------------------- */

/**
 * `type` picks the first live vehicle of that type. `az` is degrees
 * clockwise from the vehicle's nose, `el` degrees above the horizon,
 * `dist` in metres, `aim` a height offset on the vehicle to look at.
 * Distances are set so the subject fills roughly two thirds of frame
 * width - close enough that panel breaks and wear have to hold up.
 */
const SHOTS = [
  { id: "jeep-hero", type: "jeep", az: 38, el: 11, dist: 7.6, aim: 0.7, fov: 42, tod: 16.2 },
  { id: "jeep-side", type: "jeep", az: 90, el: 5, dist: 8.4, aim: 0.8, fov: 40, tod: 15.0 },
  { id: "jeep-rear", type: "jeep", az: 208, el: 14, dist: 7.4, aim: 0.7, fov: 44, tod: 16.8 },
  { id: "jeep-front", type: "jeep", az: 0, el: 8, dist: 7.0, aim: 0.8, fov: 44, tod: 10.5 },
  { id: "apc-hero", type: "apc", az: 42, el: 12, dist: 11.5, aim: 1.2, fov: 42, tod: 16.2 },
  { id: "apc-side", type: "apc", az: 90, el: 6, dist: 12.5, aim: 1.3, fov: 40, tod: 15.0 },
  { id: "apc-rear", type: "apc", az: 214, el: 13, dist: 11.0, aim: 1.2, fov: 44, tod: 9.5 },
  { id: "heli-hero", type: "heli", az: 44, el: 9, dist: 15.5, aim: 1.2, fov: 42, tod: 16.4 },
  { id: "heli-side", type: "heli", az: 90, el: 5, dist: 17.0, aim: 1.4, fov: 40, tod: 15.2 },
  { id: "heli-nose", type: "heli", az: 8, el: 6, dist: 12.0, aim: 1.0, fov: 44, tod: 11.0 },
  { id: "heli-rotor", type: "heli", az: 50, el: 46, dist: 12.0, aim: 1.6, fov: 45, tod: 13.0 },
  { id: "fleet", type: "jeep", az: 300, el: 16, dist: 30, aim: 1.0, fov: 46, tod: 16.6 },
];

/* ------------------------- static server ------------------------- */

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

async function grabFrame(page, file) {
  const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const buffer = Buffer.from(base64, "base64");
  if (file) await writeFile(file, buffer);
  return buffer;
}

async function analyse(file) {
  const { data, info } = await sharp(file).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = data.length / info.channels;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    sum += luma;
    sumSq += luma * luma;
  }
  const mean = sum / pixels;
  return {
    meanLuma: Number(mean.toFixed(2)),
    stdDevLuma: Number(Math.sqrt(Math.max(0, sumSq / pixels - mean * mean)).toFixed(2)),
  };
}

/** Place the camera on a spherical offset from a vehicle, in the
 *  vehicle's own frame so `az` means the same thing whatever its yaw. */
const FRAME_FN = (spec) => {
  const T = window.__BS;
  const list = T.ctx.vehicles.vehicles.filter((v) => v.type === spec.type && v.alive);
  const vehicle = list[spec.index || 0];
  if (!vehicle) return null;
  const yaw = vehicle.yaw + (spec.az * Math.PI) / 180;
  const el = (spec.el * Math.PI) / 180;
  const flat = Math.cos(el) * spec.dist;
  const eye = [
    vehicle.position.x + Math.sin(yaw) * flat,
    vehicle.position.y + spec.aim + Math.sin(el) * spec.dist,
    vehicle.position.z + Math.cos(yaw) * flat,
  ];
  const at = [vehicle.position.x, vehicle.position.y + spec.aim, vehicle.position.z];
  T.lookAt(eye, at, spec.fov);
  return { eye, at, vehicle: vehicle.id, pos: vehicle.position.toArray() };
};

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const server = startServer();
  let browser = null;
  const consoleErrors = [];
  const pageErrors = [];

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
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
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
    // Let the suspension settle onto the ground before any capture.
    await page.evaluate(() => window.__BS.advanceTime(3, 1 / 60));

    const requested = !args.shots || args.shots === "all" || args.shots === true
      ? SHOTS.map((s) => s.id)
      : String(args.shots).split(",").map((s) => s.trim()).filter(Boolean);

    const results = [];

    for (const spec of SHOTS) {
      if (!requested.includes(spec.id)) continue;
      await page.evaluate((tod) => window.__BS.setTimeOfDay(tod), spec.tod);
      const placed = await page.evaluate(FRAME_FN, spec);
      if (!placed) { console.warn(`no vehicle for ${spec.id}`); continue; }
      await page.evaluate(() => { for (let i = 0; i < 10; i += 1) window.__BS.renderOnce(1 / 60); });
      const file = path.join(OUT_DIR, `${spec.id}.png`);
      await grabFrame(page, file);
      const metrics = await analyse(file);
      results.push({ id: spec.id, ...metrics, placed });
      console.log(`captured ${spec.id}  luma ${metrics.meanLuma} sd ${metrics.stdDevLuma}`);
    }

    /* ---- driving: put a bot-equivalent driver in and steer ---- */
    if (requested.includes("drive") || !args.shots || args.shots === "all" || args.shots === true) {
      const telemetry = await page.evaluate(() => {
        const T = window.__BS;
        const V = T.ctx.vehicles;
        const jeep = V.vehicles.find((v) => v.type === "jeep" && v.alive);
        if (!jeep) return null;
        // A synthetic occupant: the AI path uses the same fields, so
        // this exercises exactly what a bot driver would.
        const driver = { isSynthetic: true, position: jeep.position.clone() };
        V.enter(jeep, driver);
        const samples = [];
        for (let i = 0; i < 260; i += 1) {
          V.setDriverInput(jeep, {
            throttle: 1,
            steer: i > 110 ? 0.85 : 0,
            brake: i > 230 ? 1 : 0,
          });
          T.advanceTime(1 / 30, 1 / 60);
          if (i % 20 === 0) {
            samples.push({
              t: Number((i / 30).toFixed(2)),
              speed: Number(Math.hypot(jeep.velocity.x, jeep.velocity.z).toFixed(2)),
              kmh: Number((Math.hypot(jeep.velocity.x, jeep.velocity.z) * 3.6).toFixed(1)),
              gear: jeep.gear,
              rpm: Math.round(jeep.rpm || 0),
              rollDeg: Number(((jeep.roll * 180) / Math.PI).toFixed(1)),
              pitchDeg: Number(((jeep.pitch * 180) / Math.PI).toFixed(1)),
              comp: jeep.wheels.map((w) => Number(w.compression.toFixed(2))),
              slip: jeep.wheels.map((w) => Number((w.slip || 0).toFixed(2))),
              surface: jeep.surface,
            });
          }
        }
        return { id: jeep.id, samples, pos: jeep.position.toArray() };
      }).catch((e) => ({ error: String(e) }));

      if (telemetry && !telemetry.error) {
        // Chase view: behind and above, so dust and body roll are visible.
        await page.evaluate(() => {
          const T = window.__BS;
          const jeep = T.ctx.vehicles.vehicles.find((v) => v.type === "jeep" && v.alive);
          const yaw = jeep.yaw + Math.PI * 1.15;
          T.lookAt(
            [jeep.position.x + Math.sin(yaw) * 9, jeep.position.y + 3.4, jeep.position.z + Math.cos(yaw) * 9],
            [jeep.position.x, jeep.position.y + 0.9, jeep.position.z],
            50
          );
        });
        await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60); });
        const file = path.join(OUT_DIR, "drive.png");
        await grabFrame(page, file);
        results.push({ id: "drive", ...(await analyse(file)) });
        console.log("captured drive");
      }
      if (telemetry) {
        await writeFile(path.join(OUT_DIR, "drive-telemetry.json"), JSON.stringify(telemetry, null, 2));
        if (telemetry.samples) {
          for (const s of telemetry.samples) {
            console.log(`   t=${s.t}s ${s.kmh}km/h gear ${s.gear} rpm ${s.rpm} `
              + `roll ${s.rollDeg} pitch ${s.pitchDeg} comp ${s.comp} surf ${s.surface}`);
          }
        }
      }
    }

    /* ---- flying ---- */
    if (requested.includes("fly") || !args.shots || args.shots === "all" || args.shots === true) {
      const flight = await page.evaluate(() => {
        const T = window.__BS;
        const V = T.ctx.vehicles;
        const heli = V.vehicles.find((v) => v.type === "heli" && v.alive);
        if (!heli) return null;
        V.enter(heli, { isSynthetic: true });
        const samples = [];
        for (let i = 0; i < 320; i += 1) {
          V.setDriverInput(heli, {
            collective: 1,
            pitch: i > 150 ? -0.55 : 0,
            roll: i > 220 ? 0.4 : 0,
            yaw: 0,
          });
          T.advanceTime(1 / 30, 1 / 60);
          if (i % 25 === 0) {
            samples.push({
              t: Number((i / 30).toFixed(2)),
              alt: Number((heli.position.y - T.heightAt(heli.position.x, heli.position.z)).toFixed(2)),
              speed: Number(heli.velocity.length().toFixed(2)),
              rotor: Number((heli.rotorSpin || 0).toFixed(2)),
              pitchDeg: Number(((heli.pitch * 180) / Math.PI).toFixed(1)),
              rollDeg: Number(((heli.roll * 180) / Math.PI).toFixed(1)),
            });
          }
        }
        return { id: heli.id, samples, pos: heli.position.toArray() };
      }).catch((e) => ({ error: String(e) }));

      if (flight && !flight.error) {
        await page.evaluate(() => {
          const T = window.__BS;
          const heli = T.ctx.vehicles.vehicles.find((v) => v.type === "heli" && v.alive);
          const yaw = heli.yaw + Math.PI * 0.72;
          T.lookAt(
            [heli.position.x + Math.sin(yaw) * 20, heli.position.y + 5, heli.position.z + Math.cos(yaw) * 20],
            [heli.position.x, heli.position.y, heli.position.z],
            46
          );
        });
        await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60); });
        const file = path.join(OUT_DIR, "fly.png");
        await grabFrame(page, file);
        results.push({ id: "fly", ...(await analyse(file)) });
        console.log("captured fly");
        for (const s of flight.samples) {
          console.log(`   t=${s.t}s alt ${s.alt}m spd ${s.speed} rotor ${s.rotor} `
            + `pitch ${s.pitchDeg} roll ${s.rollDeg}`);
        }
      }
      if (flight) {
        await writeFile(path.join(OUT_DIR, "fly-telemetry.json"), JSON.stringify(flight, null, 2));
      }
    }

    /* ---- damage states ---- */
    if (requested.includes("damage") || !args.shots || args.shots === "all" || args.shots === true) {
      for (const [id, fraction] of [["damaged", 0.55], ["burning", 0.86], ["wreck", 1.2]]) {
        const ok = await page.evaluate((f) => {
          const T = window.__BS;
          const V = T.ctx.vehicles;
          const apc = V.vehicles.filter((v) => v.type === "apc")[1] || V.vehicles.find((v) => v.type === "apc");
          if (!apc) return false;
          apc.health = apc.spec.health;
          apc.alive = true;
          if (apc.body) apc.body.visible = true;
          V.damage(apc, apc.spec.health * f);
          T.advanceTime(2.5, 1 / 60);
          const yaw = apc.yaw + Math.PI * 0.24;
          T.lookAt(
            [apc.position.x + Math.sin(yaw) * 12, apc.position.y + 3.4, apc.position.z + Math.cos(yaw) * 12],
            [apc.position.x, apc.position.y + 1.0, apc.position.z],
            44
          );
          return true;
        }, fraction).catch(() => false);
        if (!ok) continue;
        await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60); });
        const file = path.join(OUT_DIR, `damage-${id}.png`);
        await grabFrame(page, file);
        results.push({ id: `damage-${id}`, ...(await analyse(file)) });
        console.log(`captured damage-${id}`);
      }
    }

    /* ---- night: headlights ---- */
    if (requested.includes("night") || !args.shots || args.shots === "all" || args.shots === true) {
      await page.evaluate(() => window.__BS.setTimeOfDay(21.4));
      await page.evaluate(() => {
        const T = window.__BS;
        const jeep = T.ctx.vehicles.vehicles.find((v) => v.type === "jeep" && v.alive);
        if (!jeep) return;
        T.ctx.vehicles.setLights(jeep, true);
        T.advanceTime(1.0, 1 / 60);
        const yaw = jeep.yaw + Math.PI * 0.16;
        T.lookAt(
          [jeep.position.x + Math.sin(yaw) * 9, jeep.position.y + 2.4, jeep.position.z + Math.cos(yaw) * 9],
          [jeep.position.x, jeep.position.y + 0.6, jeep.position.z],
          46
        );
      }).catch(() => {});
      await page.evaluate(() => { for (let i = 0; i < 8; i += 1) window.__BS.renderOnce(1 / 60); });
      const file = path.join(OUT_DIR, "night.png");
      await grabFrame(page, file);
      results.push({ id: "night", ...(await analyse(file)) });
      console.log("captured night");
    }

    const report = await page.evaluate(() => window.__BS.report());
    const vehicles = await page.evaluate(() =>
      (window.__BS.ctx.vehicles.report ? window.__BS.ctx.vehicles.report() : null));

    await writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify({
      url: GAME_URL, shots: results, vehicles, report, consoleErrors, pageErrors,
    }, null, 2));

    console.log("\n--- diagnostics ---");
    console.log(JSON.stringify({
      calls: report.render.calls,
      triangles: report.render.triangles,
      geometries: report.render.geometries,
      programs: report.render.programs,
      fps: report.fps,
      vehicles,
    }, null, 2));

    if (pageErrors.length) {
      console.error(`\n${pageErrors.length} page error(s):`);
      pageErrors.forEach((e) => console.error(`  ${e}`));
      process.exitCode = 1;
    }
    if (consoleErrors.length) {
      console.error(`\n${consoleErrors.length} console error(s):`);
      consoleErrors.slice(0, 20).forEach((e) => console.error(`  ${e}`));
      process.exitCode = 1;
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
