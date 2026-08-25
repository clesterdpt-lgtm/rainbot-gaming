#!/usr/bin/env node
/* ============================================================
   SAINTFALL - leg shot sheet

   `saintfall-leg-rig-probe.mjs` turns the three reported leg faults
   into numbers. This is the other half: the same moments, seen.

   Numbers alone have already been wrong here twice - a metric that
   scored a foot's swing ACCELERATION as a teleport failed every
   scenario in the game, and one that graded a boot against a hill
   steeper than an ankle called Kenosis broken. A picture cannot say
   how many degrees, but it can say whether a leg looks like a leg.

   Reads the site each scenario chose from the probe's own JSON, so
   the two harnesses stand on exactly the same ground. Run the probe
   first.

   Usage: node scripts/saintfall-leg-shots.mjs [--in FILE] [--out DIR] [--level both|vesper|summit]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const inFile = path.resolve(root, arg("--in", "output/saintfall/leg-rig-probe.json"));
const outDir = path.resolve(root, arg("--out", "output/saintfall/leg-shots"));
const which = arg("--level", "both");
const tag = arg("--tag", "after");
const PORT = 46700 + (process.pid % 900);
const BASE = `http://127.0.0.1:${PORT}`;

const LEVELS = [
  { id: "vesper", page: "games/saintfall.html" },
  { id: "summit", page: "games/saintfall-white-vigil.html" },
];

/* Each entry is a scenario from the probe plus the instants worth
   looking at, in seconds from the start of the drive. */
const SHOTS = [
  { id: "flat-walk", drive: [0, -1], at: [2.10, 2.17, 2.23, 2.30, 2.37, 2.44] },
  { id: "run-to-stop", drive: [0, -1], release: 2.0, at: [1.95, 2.05, 2.20, 2.60] },
  { id: "climb-0.55", drive: [0, -1], at: [1.60, 1.72, 1.85, 2.40] },
  { id: "climb-1.15", drive: [0, -1], at: [1.60, 1.72, 1.85, 1.97, 2.10, 2.40] },
  { id: "jet-hover", jet: true, drive: [0, 0], at: [1.6, 2.6] },
  { id: "jet-forward", jet: true, drive: [0, -1], at: [1.6, 2.6] },
];

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function main() {
  const probe = JSON.parse(await readFile(inFile, "utf8"));
  const server = startServer();
  let browser = null;
  const written = [];
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    await mkdir(outDir, { recursive: true });

    for (const level of LEVELS) {
      if (which !== "both" && which !== level.id) continue;
      const res = probe[level.id];
      if (!res) continue;
      const page = await (await browser.newContext({ viewport: { width: 900, height: 760 } })).newPage();
      page.on("pageerror", (e) => console.error(`PAGE ERROR [${level.id}]`, e.message));
      await page.goto(`${BASE}/${level.page}?qa=1&quality=high`,
        { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });
      /* A raking key, not whatever hour the save happened to be at.
         The first sheet came back as a black plate with a lit column
         in it, which is a photograph of the level's night. */
      await page.evaluate(() => window.__SF.setTime("goldenhour"));

      for (const shot of SHOTS) {
        const scn = res.scenarios.find((s) => s.id === shot.id);
        if (!scn || !scn.site) { console.log(`  ${level.id}/${shot.id}: no site in probe output`); continue; }
        const frames = await page.evaluate((job) => {
          const T = window.__SF;
          const p = T.player;
          const s = job.site;
          T.teleport(s.x - Math.sin(s.yaw) * s.back, s.z - Math.cos(s.yaw) * s.back, s.yaw);
          p.setFree(false);
          for (let i = 0; i < 45; i += 1) T.advanceTime(1 / 60, 1 / 60);
          T.setJetInput(!!job.jet);
          p.input.inject(job.drive[0], job.drive[1]);
          const out = [];
          let done = 0;
          for (const mark of job.at) {
            const want = Math.round(mark * 60);
            while (done < want) {
              if (job.release !== undefined && done === Math.round(job.release * 60)) {
                p.input.inject(null);
              }
              T.advanceTime(1 / 60, 1 / 60);
              done += 1;
            }
            /* Side on, level with the knees, close enough that a
               boot is a boot. Set through `setFree` and drawn with
               `renderStill`, which does not advance the clock - a
               camera that steps the world puts every later mark in
               this list at the wrong moment. */
            const st = p.state;
            /* Framed on the FIGURE ROOT, not on `state.y`. They are
               the same thing standing still and a jetpack's whole
               point is that they are not: aiming at the ground put
               the flying trooper out of the top of the frame. */
            const base = p.figure.root.position;
            const right = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
            const eye = [
              base.x + right[0] * 2.05 - Math.sin(st.yaw) * 0.30,
              base.y + 0.66,
              base.z + right[2] * 2.05 - Math.cos(st.yaw) * 0.30,
            ];
            /* THE FIGURE IS HIDDEN BY A FREE CAMERA. `showFigure` is
               recomputed every frame as `!state.free` unless the
               override says otherwise, so a beauty camera pointed at
               the trooper photographs the ground the trooper is
               standing on. */
            T.hidePlayer(false);
            p.setFree(true, eye, [base.x, base.y + 0.52, base.z], 46);
            T.renderStill();
            T.renderStill();
            const url = T.captureDataURL();
            p.setFree(false);
            T.autoPlayer();
            out.push({
              t: mark,
              url,
              speed: Number(st.speed.toFixed(2)),
              swinging: [p.legs[0].swinging, p.legs[1].swinging],
            });
          }
          p.input.inject(null);
          T.setJetInput(false);
          return out;
        }, { site: scn.site, drive: shot.drive, at: shot.at, jet: !!shot.jet, release: shot.release });

        for (const f of frames) {
          const file = path.join(outDir, `${tag}-${level.id}-${shot.id}-t${f.t.toFixed(2)}.png`);
          await writeFile(file, Buffer.from(f.url.slice(f.url.indexOf(",") + 1), "base64"));
          written.push(path.relative(root, file));
          console.log(`  ${path.basename(file)}  speed ${f.speed}  swinging ${f.swinging}`);
        }
      }
      await page.close();
    }
    console.log(`\nwrote ${written.length} frames to ${path.relative(root, outDir)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
