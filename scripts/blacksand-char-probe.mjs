#!/usr/bin/env node
/* ============================================================
   BLACKSAND - character / AI probe

   The beauty-shot harness frames landscape. This one frames people:
   it stages soldiers at known distances, stances and gait phases in
   front of a fixed camera so the mesh and the walk cycle can actually
   be judged, and it measures what the AI costs with a full bot count.

   Usage:
     node scripts/blacksand-char-probe.mjs --out output/blacksand-shots/char-1
     node scripts/blacksand-char-probe.mjs --out ... --perf   (AI cost only)

   Same two traps as the beauty harness apply and are handled the same
   way: frames are forced with __BS.renderOnce() rather than waited for,
   and pixels come from __BS.captureDataURL() rather than
   page.screenshot(), because the compositor is throttled to ~1fps.
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

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
const OUT_DIR = path.resolve(root, args.out || "output/blacksand-shots/char-probe");
const WIDTH = Number(args.width || 1400);
const HEIGHT = Number(args.height || 900);
const QUALITY = String(args.quality || "ultra");
const BOTS = Number(args.bots || 40);
const PERF_ONLY = Boolean(args.perf);
const PORT = Number(args.port || 43000 + (process.pid % 9000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const GAME_URL = `${BASE_URL}/games/blacksand.html?qa=1&quality=${QUALITY}&bots=${BOTS}`;

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const res = await fetch(`${BASE_URL}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error(`static server never came up on ${BASE_URL}`);
}

async function grabFrame(page, file) {
  const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
  const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (file) await writeFile(file, buffer);
  return buffer;
}

/* ---------------------------------------------------------------- *
 * Page-side staging.
 *
 * Bots are pinned every forced frame rather than once, because their
 * own fixedUpdate would walk them out of shot between the frames the
 * pose needs to settle. `characters.pose` damps toward its targets, so
 * a stance needs ~0.4s of forced frames before it is worth capturing.
 * ---------------------------------------------------------------- */
const STAGE_FN = `
window.__CHARSTAGE = (function () {
  const T = window.__BS;
  const ctx = T.ctx;
  const THREE = T.THREE;

  /** Flat-ish open ground, found by sampling. Staged soldiers on a
   *  ridge would confound the foot-IK read. */
  function findFlat() {
    let best = null;
    for (let i = 0; i < 900; i += 1) {
      const x = -420 + (i % 30) * 28;
      const z = -420 + Math.floor(i / 30) * 28;
      const h = ctx.terrain.heightAt(x, z);
      let rough = 0;
      for (const [dx, dz] of [[6,0],[-6,0],[0,6],[0,-6],[10,10],[-10,-10]]) {
        rough += Math.abs(ctx.terrain.heightAt(x + dx, z + dz) - h);
      }
      const clear = ctx.physics.overlapSphere
        ? ctx.physics.overlapSphere(new THREE.Vector3(x, h + 1, z), 14).length
        : 0;
      const score = -rough - clear * 4;
      if (!best || score > best.score) best = { x, z, h, score };
    }
    return best;
  }

  const flat = findFlat();

  function slopeSpot() {
    let best = null;
    for (let i = 0; i < 900; i += 1) {
      const x = -420 + (i % 30) * 28;
      const z = -420 + Math.floor(i / 30) * 28;
      const h = ctx.terrain.heightAt(x, z);
      const g = Math.abs(ctx.terrain.heightAt(x + 4, z) - h) + Math.abs(ctx.terrain.heightAt(x, z + 4) - h);
      const clear = ctx.physics.overlapSphere
        ? ctx.physics.overlapSphere(new THREE.Vector3(x, h + 1, z), 12).length
        : 0;
      if (clear > 0) continue;
      const score = g;
      if (!best || score > best.score) best = { x, z, h, score };
    }
    return best || flat;
  }

  const slope = slopeSpot();

  function pin(spec) {
    const bots = ctx.bots.bots;
    for (let i = 0; i < spec.length && i < bots.length; i += 1) {
      const bot = bots[i];
      const s = spec[i];
      bot.alive = true;
      bot.health = 100;
      bot.root.visible = true;
      bot.position.set(s.x, ctx.terrain.heightAt(s.x, s.z), s.z);
      bot.yaw = s.yaw || 0;
      bot.aimYaw = s.aimYaw === undefined ? (s.yaw || 0) : s.aimYaw;
      bot.aimPitch = s.aimPitch || 0;
      bot.stance = s.stance || "stand";
      bot.speed = s.speed === undefined ? 0 : s.speed;
      bot.firing = s.firing || 0;
      if (s.phase !== undefined) bot.animPhase = s.phase;
      bot.__qaPin = s;
    }
    for (let i = spec.length; i < bots.length; i += 1) {
      bots[i].root.visible = false;
      bots[i].__qaPin = null;
      // Park the rest far away so their AI cannot see anything staged.
      bots[i].position.set(9000, 0, 9000);
    }
  }

  function settle(spec, frames, dtStep) {
    const bots = ctx.bots.bots;
    const dt = dtStep === undefined ? 1 / 60 : dtStep;
    for (let f = 0; f < frames; f += 1) {
      for (let i = 0; i < spec.length && i < bots.length; i += 1) {
        const bot = bots[i];
        const s = spec[i];
        bot.position.set(s.x, ctx.terrain.heightAt(s.x, s.z), s.z);
        bot.velocity.set(0, 0, 0);
        bot.yaw = s.yaw || 0;
        bot.aimYaw = s.aimYaw === undefined ? (s.yaw || 0) : s.aimYaw;
        bot.aimPitch = s.aimPitch || 0;
        bot.stance = s.stance || "stand";
        bot.speed = s.speed === undefined ? 0 : s.speed;
        bot.firing = s.firing || 0;
        if (s.phase !== undefined) bot.animPhase = s.phase + f * dt * (s.speed || 0) * 2.1;
        if (s.advancePhase) bot.animPhase += dt * (s.speed || 0) * 2.1;
      }
      T.renderOnce(dt);
    }
  }

  return {
    flat,
    slope,
    pin,
    settle,
    look(p, t, fov) { T.lookAt(p, t, fov); },
    sun(hours) { T.setTimeOfDay(hours); },
  };
})();
`;

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
      headless: !args.headed,
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
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 180000 });

    await page.evaluate(() => window.__BS.maximize());
    await page.evaluate(() => { for (let i = 0; i < 20; i += 1) window.__BS.renderOnce(1 / 60); });
    await page.evaluate(() => window.__BS.hideHud(true));
    await page.evaluate(() => window.__BS.hideViewmodel(true));
    await page.evaluate(() => {
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    await page.evaluate(() => window.__BS.advanceTime(2, 1 / 60));

    /* ------------------------- AI cost ------------------------- */

    const perf = await page.evaluate(() => {
      const T = window.__BS;
      const ctx = T.ctx;
      // Let the bots disperse and find each other first, so perception
      // is measured with real contacts rather than an empty world.
      T.advanceTime(14, 1 / 60);

      const bots = ctx.bots;
      const before = bots.report ? bots.report() : {};

      // Cost of the bot fixedUpdate alone, isolated from rendering.
      const STEPS = 600;                     // 5 simulated seconds at 120Hz
      const t0 = performance.now();
      for (let i = 0; i < STEPS; i += 1) ctx.bots.fixedUpdate(1 / 120);
      const t1 = performance.now();
      const after = bots.report ? bots.report() : {};

      const totalMs = t1 - t0;
      return {
        botCount: ctx.bots.bots.length,
        steps: STEPS,
        simSeconds: STEPS / 120,
        msPerStep: Number((totalMs / STEPS).toFixed(4)),
        msPerSimSecond: Number((totalMs / (STEPS / 120)).toFixed(2)),
        budgetPctOf120Hz: Number(((totalMs / STEPS) / (1000 / 120) * 100).toFixed(1)),
        before,
        after,
      };
    });

    console.log("--- AI cost ---");
    console.log(JSON.stringify(perf, null, 2));

    if (PERF_ONLY) {
      await writeFile(path.join(OUT_DIR, "perf.json"), JSON.stringify({ perf }, null, 2));
      return;
    }

    /* ------------------------- staged shots ------------------------- */

    await page.evaluate(STAGE_FN);
    await page.evaluate(() => window.__BS.setTimeOfDay(15.2));
    await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60); });

    const scenes = [
      {
        id: "close-front",
        note: "3.2m, three-quarter front. The read-from-arm's-length test.",
        build: `
          const o = S.flat;
          const spec = [{ x: o.x, z: o.z, yaw: Math.PI * 0.78, stance: "stand", speed: 0 }];
          S.pin(spec); S.settle(spec, 40);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.look([o.x + 2.3, h + 1.45, o.z + 2.3], [o.x, h + 1.05, o.z], 42);
        `,
      },
      {
        id: "close-back",
        note: "3.2m from behind - pack, antenna, helmet rear.",
        build: `
          const o = S.flat;
          const spec = [{ x: o.x, z: o.z, yaw: 0, stance: "stand", speed: 0 }];
          S.pin(spec); S.settle(spec, 40);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.look([o.x + 1.1, h + 1.5, o.z + 3.0], [o.x, h + 1.05, o.z], 42);
        `,
      },
      {
        id: "close-side",
        note: "3.5m profile - weapon carry, helmet profile, boots.",
        build: `
          const o = S.flat;
          const spec = [{ x: o.x, z: o.z, yaw: Math.PI * 0.5, stance: "stand", speed: 0 }];
          S.pin(spec); S.settle(spec, 40);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.look([o.x, h + 1.4, o.z + 3.4], [o.x, h + 1.0, o.z], 44);
        `,
      },
      {
        id: "squad-variation",
        note: "Eight of one team at 11m. If they read as clones, variation failed.",
        build: `
          const o = S.flat;
          const spec = [];
          for (let i = 0; i < 8; i += 1) {
            spec.push({
              x: o.x + (i - 3.5) * 1.5, z: o.z + (i % 2) * 0.9,
              yaw: Math.PI + (i - 3.5) * 0.04, stance: "stand", speed: 0,
            });
          }
          S.pin(spec); S.settle(spec, 40);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.look([o.x, h + 1.75, o.z - 10.5], [o.x, h + 1.05, o.z], 46);
        `,
      },
      {
        id: "teams-150",
        note: "Two fireteams at 150m, one per team. Team identity must be instant.",
        build: `
          const o = S.flat;
          const spec = [];
          const bots = ctx.bots.bots;
          // bots alternate team by index, so take evens then odds.
          const order = [];
          for (let i = 0; i < bots.length; i += 2) order.push(i);
          for (let i = 1; i < bots.length; i += 2) order.push(i);
          for (let i = 0; i < 8; i += 1) {
            spec.push({
              x: o.x + (i < 4 ? -7 : 7) + (i % 4) * 2.1,
              z: o.z - 150,
              yaw: Math.PI, stance: "stand", speed: 0,
            });
          }
          S.pin(spec); S.settle(spec, 40);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.look([o.x, h + 1.7, o.z], [o.x, h + 1.5, o.z - 150], 34);
        `,
      },
      {
        id: "stances",
        note: "stand / crouch / prone / sprint, left to right at 9m.",
        build: `
          const o = S.flat;
          const spec = [
            { x: o.x - 3.0, z: o.z, yaw: Math.PI, stance: "stand", speed: 0 },
            { x: o.x - 1.0, z: o.z, yaw: Math.PI, stance: "crouch", speed: 0 },
            { x: o.x + 1.2, z: o.z, yaw: Math.PI, stance: "prone", speed: 0 },
            { x: o.x + 3.4, z: o.z, yaw: Math.PI, stance: "stand", speed: 7.2, phase: 1.1 },
          ];
          S.pin(spec); S.settle(spec, 50);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.look([o.x, h + 1.55, o.z - 8.5], [o.x, h + 0.85, o.z], 52);
        `,
      },
      {
        id: "gait-run",
        note: "Running, side on, mid-stride. Knees, pelvis, contralateral swing.",
        build: `
          const o = S.flat;
          const spec = [
            { x: o.x - 2.4, z: o.z, yaw: Math.PI * 0.5, speed: 6.4, phase: 0.0 },
            { x: o.x, z: o.z, yaw: Math.PI * 0.5, speed: 6.4, phase: Math.PI * 0.5 },
            { x: o.x + 2.4, z: o.z, yaw: Math.PI * 0.5, speed: 6.4, phase: Math.PI },
          ];
          S.pin(spec); S.settle(spec, 40);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.look([o.x, h + 1.35, o.z + 7.5], [o.x, h + 0.95, o.z], 50);
        `,
      },
      {
        id: "slope-feet",
        note: "On the steepest ground found. Feet must sit on the surface.",
        build: `
          const o = S.slope;
          const spec = [];
          for (let i = 0; i < 4; i += 1) {
            spec.push({ x: o.x + (i - 1.5) * 2.0, z: o.z, yaw: Math.PI, stance: "stand", speed: 0 });
          }
          S.pin(spec); S.settle(spec, 40);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.look([o.x, h + 1.15, o.z - 7.0], [o.x, h + 0.5, o.z], 48);
        `,
      },
      {
        id: "aim-separation",
        note: "Walking left-to-right while aiming at the camera. Upper/lower split.",
        build: `
          const o = S.flat;
          const spec = [
            { x: o.x - 2.6, z: o.z, yaw: Math.PI * 0.5, aimYaw: Math.PI, speed: 3.6, phase: 0.7, firing: 1 },
            { x: o.x + 0.6, z: o.z, yaw: -Math.PI * 0.5, aimYaw: Math.PI, speed: 3.6, phase: 2.4 },
            { x: o.x + 3.4, z: o.z, yaw: 0, aimYaw: Math.PI, speed: 3.2, phase: 4.0 },
          ];
          S.pin(spec); S.settle(spec, 45);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.look([o.x, h + 1.6, o.z - 8.0], [o.x, h + 1.05, o.z], 50);
        `,
      },
      {
        id: "range-300",
        note: "Six soldiers at 300m. Silhouette test at engagement range.",
        build: `
          const o = S.flat;
          const spec = [];
          for (let i = 0; i < 6; i += 1) {
            spec.push({ x: o.x + (i - 2.5) * 3.4, z: o.z - 300, yaw: Math.PI, speed: 0 });
          }
          S.pin(spec); S.settle(spec, 30);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.look([o.x, h + 1.7, o.z], [o.x, h + 1.9, o.z - 300], 16);
        `,
      },
      {
        id: "dead",
        note: "Four dead soldiers. Collapse must vary and end plausibly.",
        build: `
          const o = S.flat;
          const spec = [];
          for (let i = 0; i < 4; i += 1) {
            spec.push({ x: o.x + (i - 1.5) * 2.4, z: o.z, yaw: i * 1.3, speed: 0 });
          }
          S.pin(spec); S.settle(spec, 6);
          const bots = ctx.bots.bots;
          for (let i = 0; i < 4; i += 1) {
            if (bots[i].alive && ctx.bots.applyDamage) ctx.bots.applyDamage(bots[i], 500, {});
            bots[i].alive = false;
            bots[i].root.visible = true;
          }
          S.settle(spec, 90);
          const h = ctx.terrain.heightAt(o.x, o.z);
          S.look([o.x, h + 2.1, o.z - 7.0], [o.x, h + 0.4, o.z], 52);
        `,
      },
    ];

    const captured = [];
    for (const scene of scenes) {
      try {
        await page.evaluate(new Function("scene", `
          const S = window.__CHARSTAGE;
          const T = window.__BS;
          const ctx = T.ctx;
          const THREE = T.THREE;
          ${scene.build}
        `), scene);
        await page.evaluate(() => { for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60); });
        const file = path.join(OUT_DIR, `${scene.id}.png`);
        await grabFrame(page, file);
        captured.push({ id: scene.id, note: scene.note, file: path.relative(root, file) });
        console.log(`captured ${scene.id}`);
      } catch (error) {
        console.warn(`scene "${scene.id}" failed: ${error.message}`);
        captured.push({ id: scene.id, error: error.message });
      }
    }

    const report = await page.evaluate(() => window.__BS.report());
    await writeFile(path.join(OUT_DIR, "report.json"), JSON.stringify({
      url: GAME_URL, perf, scenes: captured, report, consoleErrors, pageErrors,
    }, null, 2));

    console.log("\n--- render ---");
    console.log(JSON.stringify({
      calls: report.render.calls, triangles: report.render.triangles,
      bots: report.bots,
    }, null, 2));
    if (pageErrors.length) {
      console.error(`\n${pageErrors.length} page error(s):`);
      pageErrors.slice(0, 10).forEach((e) => console.error(`  ${e}`));
      process.exitCode = 1;
    }
    if (consoleErrors.length) {
      console.error(`\n${consoleErrors.length} console error(s):`);
      consoleErrors.slice(0, 10).forEach((e) => console.error(`  ${e}`));
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
