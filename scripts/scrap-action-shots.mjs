#!/usr/bin/env node
/* ============================================================
   SCRAP CIRCUIT — action shot harness

   Runs a real match forward with the bots fighting, then grabs
   chase-camera frames at moments when something is actually
   happening (weapons in the air, explosions live, cars damaged).
   These are the frames a blind comparison should judge, because
   they are what the player actually looks at.

   Usage:
     node scripts/scrap-action-shots.mjs
     node scripts/scrap-action-shots.mjs --arenas suburb --shots 6
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
  const a = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2); const n = argv[i + 1];
      if (n === undefined || n.startsWith("--")) a[k] = true; else { a[k] = n; i += 1; }
    } else a._.push(t);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const OUT_DIR = path.resolve(root, args.out || "output/scrap-action/latest");
const WIDTH = Number(args.width || 1440);
const HEIGHT = Number(args.height || 810);
const SHOTS = Number(args.shots || 4);
const KEEP_HUD = Boolean(args.hud);
const PORT = Number(args.port || 47000 + (process.pid % 9000));
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ALL = ["suburb", "junkyard", "interchange", "boardwalk", "rooftop", "cemetery"];
const ARENAS = args.arenas && args.arenas !== "all"
  ? String(args.arenas).split(",").map((s) => s.trim()) : ALL;
const VEHICLES = args.vehicle
  ? [String(args.vehicle)]
  : ["towtruck", "mallcop", "rideshare", "hearse", "bus", "monster", "rv", "icecream", "garbage"];

function startServer() {
  const c = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}
async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try { const r = await fetch(`${BASE_URL}/games/scrap-circuit.html`); if (r.ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const server = startServer();
  let browser = null;
  const pageErrors = [];
  const files = [];
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--force-device-scale-factor=1", "--mute-audio"],
    });
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto(`${BASE_URL}/games/scrap-circuit.html?qa=1`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__scrapQA, null, { timeout: 30000 });
    await delay(1400);

    for (const arenaId of ARENAS) {
      /* Rotate the player vehicle per arena. Shooting the whole set with
         one chassis makes every render identifiable by "it's the orange
         tow truck again" — a giveaway that has nothing to do with how
         the renderer looks. */
      const veh = VEHICLES[ARENAS.indexOf(arenaId) % VEHICLES.length];
      await page.evaluate(([a, v, hide]) => {
        const qa = window.__scrapQA;
        qa.begin(a, v);
        if (hide) qa.hideHUD(true);
      }, [arenaId, veh, !KEEP_HUD]);

      for (let shot = 0; shot < SHOTS; shot += 1) {
        /* Run until something is happening. The player car is driven at
           full throttle with a slow weave so the chase cam has motion and
           the bots close in; then we wait for live ordnance or a blast. */
        const info = await page.evaluate(() => {
          const qa = window.__scrapQA;
          const st = qa.state;
          const dt = 1 / 60;
          let interesting = null;
          for (let i = 0; i < 420; i += 1) {
            // Head for the nearest live rival, weave a little, keep firing.
            const p = st.player;
            let steer = Math.sin(st.time * 0.8) * 0.4;
            if (p) {
              let best = null; let bestD = Infinity;
              st.cars.forEach((c) => {
                if (c === p || c.wrecked) return;
                const d = Math.hypot(c.x - p.x, c.z - p.z);
                if (d < bestD) { bestD = d; best = c; }
              });
              if (best) {
                let want = Math.atan2(best.x - p.x, best.z - p.z) - p.heading;
                while (want > Math.PI) want -= Math.PI * 2;
                while (want < -Math.PI) want += Math.PI * 2;
                steer = Math.max(-1, Math.min(1, -want * 1.4));
              }
            }
            qa.input({ throttle: 1, steer, fire: true, drift: i % 90 > 70 });
            qa.step(dt, dt);
            const live = st.projectiles.length;
            const hurt = st.cars.filter((c) => !c.wrecked && c.hp < c.maxHp * 0.55).length;
            if (i > 90 && (live >= 3 || hurt >= 2)) { interesting = { reason: "engaged", live, hurt }; break; }
          }
          return interesting || { reason: "timeout", live: qa.state.projectiles.length, hurt: 0 };
        });
        // Let the ordnance land, so the frame has fireballs in it.
        await page.evaluate(() => {
          const qa = window.__scrapQA;
          qa.input({ throttle: 1, steer: 0.15, fire: true });
          qa.step(0.42);
        });
        const dataUrl = await page.evaluate(() => {
          const qa = window.__scrapQA;
          qa.freeCam(false);
          qa.chase();
          return qa.capture();
        });
        const file = path.join(OUT_DIR, `${arenaId}-action-${shot}.png`);
        await writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
        files.push(file);
        console.log(`${arenaId} shot ${shot}: ${info.reason} (${info.live} live, ${info.hurt} hurt)`);
      }
    }

    if (files.length) {
      const cols = SHOTS;
      const tw = 460, th = Math.round((HEIGHT / WIDTH) * 460);
      const tiles = await Promise.all(files.map(async (f, i) => ({
        input: await sharp(f).resize(tw, th).png().toBuffer(),
        left: (i % cols) * tw, top: Math.floor(i / cols) * th,
      })));
      await sharp({
        create: { width: cols * tw, height: Math.ceil(files.length / cols) * th, channels: 3, background: { r: 10, g: 10, b: 14 } },
      }).composite(tiles).png().toFile(path.join(OUT_DIR, "_contact.png"));
    }
    if (pageErrors.length) console.log(`\npage errors:\n  ${pageErrors.join("\n  ")}`);
    console.log(`\nWrote ${files.length} action shots to ${path.relative(root, OUT_DIR)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
