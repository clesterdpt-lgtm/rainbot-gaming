#!/usr/bin/env node
/* ============================================================
   SAINTFALL - the bestiary in the field

   The review stage answers "is this a good model". It cannot answer
   the question that decides whether the game ships: CAN THE PLAYER
   READ THE FIGHT.

   Those are different questions and the stage is actively misleading
   about the second one. It puts one creature four metres from the
   camera, side on, isolated on open sand, in the pose the harness
   chose. A player sees a dozen of them at once, at forty to two
   hundred metres, backed by the district they came out of, moving,
   under whatever light the mission is running in.

   So this harness shoots the real thing: real garrisons, woken, at
   the ranges the fight actually happens at, from eye height, with
   the player's own weapon in frame. What it is looking for is the
   three failures a stage cannot show:

     - two castes that are not distinguishable in a group;
     - a creature that vanishes against its own district;
     - a horde that reads as a texture rather than as individuals.

   Usage:
     node scripts/saintfall-bestiary-field.mjs
     node scripts/saintfall-bestiary-field.mjs --time night
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
const OUT = path.resolve(root, args.out || "output/saintfall/bestiary-field");
const WIDTH = Number(args.width || 1600);
const HEIGHT = Number(args.height || 900);
const PORT = Number(args.port || 47000 + (process.pid % 9000));
const BASE = `http://127.0.0.1:${PORT}`;
const TIMES = String(args.time || "goldenhour,night").split(",");

/* Each scene stands the player where a player would actually be
   standing when this fight starts - on the approach, at the range the
   garrison notices them - rather than in the middle of it. */
/* `at` stands INSIDE the garrison's aggro radius, not on the horizon
   looking at it. Combat only steps units within 240m of the player and
   an idle unit only leaves its post once it is suspicious, so a camera
   parked at the district edge photographs a diorama: enemies that have
   technically woken up, standing exactly where they were garrisoned,
   two hundred metres away and four pixels tall. `settle` is then long
   enough for a charge to actually arrive - a Thresher covers 89m in
   twelve seconds. */
const SCENES = [
  {
    id: "bloom-swarm",
    at: [-655, -480], settle: 13.0,
    note: "The Bloom: the hive garrison, coming",
  },
  {
    id: "bloom-close",
    at: [-655, -600], settle: 15.0,
    note: "The Bloom, inside the spire field and overrun",
  },
  {
    id: "choir-ridge",
    at: [-820, 40], settle: 11.0,
    note: "Choir Spires: Gleaners holding the ridge at their own reach",
  },
  {
    id: "cathedral-front",
    at: [-95, -600], settle: 13.0,
    note: "Vault-Cathedral: a mixed garrison before the west front",
  },
  {
    id: "censer-approach",
    at: [655, 830], settle: 12.0,
    note: "Censer Works: relay ALPHA, the first garrison most players meet",
  },
  {
    id: "saint-extract",
    at: [0, 130], settle: 12.0,
    note: "The Fallen Saint: the extraction ground",
  },
  {
    id: "road-patrol",
    at: [-52, -160], settle: 11.0,
    note: "The Pilgrim's Road: a patrol between districts",
  },
];

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try {
      const r = await fetch(`${BASE}/games/saintfall.html`, { cache: "no-store" });
      if (r.ok) return;
    } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function grab(page, file) {
  const url = await page.evaluate(() => window.__SF.captureDataURL());
  const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  await writeFile(file, buf);
  return buf;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  const pageErrors = [];

  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--force-device-scale-factor=1",
        "--hide-scrollbars", "--mute-audio"],
    });
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=high`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(),
      null, { timeout: 300000 });
    await page.evaluate(() => {
      window.__SF.maximize();
      window.__SF.hideHud(true);
      // Invulnerable, because this harness deliberately stands in
      // front of woken garrisons for ten seconds at a time and a
      // corpse photographs the respawn screen.
      window.__SF.invulnerable(true);
      const el = document.getElementById("sf-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    const rows = [];
    for (const time of TIMES) {
      await page.evaluate((t) => window.__SF.setTime(t), time);
      for (const scene of SCENES) {
        const info = await page.evaluate((s) => {
          const T = window.__SF;
          T.releaseCamera();
          T.invulnerable(true);
          T.teleport(s.at[0], s.at[1], 0);
          const ps = T.player.state;
          // Wake the garrison the way being seen would, then let it
          // come. What a player sees is enemies MOVING TOWARD THEM;
          // a garrison photographed at rest is a diorama.
          for (const e of T.enemies.live) {
            if (e.state === "death") continue;
            if (Math.hypot(e.x - ps.x, e.z - ps.z) < 300) {
              e.suspicion = 1;
              e.alerted = true;
            }
          }
          T.advanceTime(s.settle, 1 / 60);

          const near = T.enemies.live.filter((e) => e.state !== "death"
            && Math.hypot(e.x - ps.x, e.z - ps.z) < 240);
          /* Aim at where the fight ACTUALLY IS, weighted toward the
             close ones. A fixed heading at a district centre framed
             empty sand in four of seven scenes, because a charge does
             not arrive from the direction the garrison was standing
             in - it arrives from wherever each unit happened to have
             a line. */
          let wx = 0;
          let wz = 0;
          let wsum = 0;
          for (const e of near) {
            const d = Math.max(6, Math.hypot(e.x - ps.x, e.z - ps.z));
            const w = 1 / (d * d);
            wx += (e.x - ps.x) * w;
            wz += (e.z - ps.z) * w;
            wsum += w;
          }
          if (wsum > 0) {
            ps.yaw = Math.atan2(wx / wsum, wz / wsum);
          }
          ps.camYaw = ps.yaw;
          ps.camPitch = -0.05;

          const byKey = {};
          for (const e of near) byKey[e.key] = (byKey[e.key] || 0) + 1;
          const dists = near.map((e) => Math.hypot(e.x - ps.x, e.z - ps.z))
            .sort((a, b) => a - b);
          return {
            visible: near.length,
            byKey,
            nearestM: Number((dists[0] || 0).toFixed(1)),
            medianM: Number((dists[Math.floor(dists.length / 2)] || 0).toFixed(1)),
            within60: dists.filter((d) => d < 60).length,
          };
        }, scene);

        // Settle the frame. `renderStill` draws WITHOUT advancing the
        // clock, so the pose photographed is the pose the scene set up
        // rather than an eighth of a second further into the charge.
        await page.evaluate(() => {
          for (let i = 0; i < 8; i += 1) window.__SF.renderStill();
        });

        const file = path.join(OUT, `${time}-${scene.id}.png`);
        await grab(page, file);
        const line = `${time}/${scene.id}: ${info.visible} in view `
          + `(${Object.entries(info.byKey).map(([k, n]) => `${n} ${k}`).join(", ") || "none"}) `
          + `· nearest ${info.nearestM}m · median ${info.medianM}m · ${info.within60} inside 60m`;
        console.log(`  ${line}`);
        rows.push({ time, ...scene, ...info });
      }
    }

    const report = await page.evaluate(() => window.__SF.report());
    await writeFile(path.join(OUT, "report.json"), JSON.stringify({
      capturedAt: new Date().toISOString(), scenes: rows,
      engine: report, pageErrors,
    }, null, 2));
    console.log(`\nfps ${report.fps} · frame ${report.frameMs}ms · `
      + `${JSON.stringify(report.enemies)}`);
    if (pageErrors.length) {
      console.error(`\n${pageErrors.length} page error(s):`);
      pageErrors.slice(0, 5).forEach((e) => console.error(`  ${e}`));
    }
    console.log(`\nartifacts: ${path.relative(root, OUT)}`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
