#!/usr/bin/env node
/* ============================================================
   SAINTFALL - animation probe

   Reports what three actually sees after GLTFLoader: clip names,
   track names and counts, and - the part that matters - whether a
   named bone's quaternion actually MOVES as the mixer advances.

   Written because the bestiary harness found all five Thresher
   clips rendering identically, and there are at least four
   plausible causes (empty clips, unbound tracks, actions never
   stopped so everything blends to the mean, or the IK solver
   overwriting the bones after the mixer). Guessing between them
   costs a round each; sampling the bone costs one.
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 48000 + (process.pid % 9000);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const c = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  c.stderr.on("data", () => {});
  return c;
}

async function waitForServer() {
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`${BASE}/games/saintfall.html`)).ok) return; } catch (_) { /* retry */ }
    await delay(100);
  }
  throw new Error("server never came up");
}

async function main() {
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
    await page.goto(`${BASE}/games/saintfall.html?qa=1&quality=low`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SF && window.__SF.isReady(), null, { timeout: 300000 });

    const out = await page.evaluate(() => {
      const T = window.__SF;
      T.clearEnemies();
      T.spawnEnemy("thresher", -520, -562, {});
      const inst = T.enemies.live[0];
      const res = { clips: [], sample: {}, bones: [] };

      for (const [name, action] of inst.actions) {
        const clip = action.getClip();
        res.clips.push({
          name,
          duration: Number(clip.duration.toFixed(3)),
          tracks: clip.tracks.length,
          sampleTracks: clip.tracks.slice(0, 3).map((t) => t.name),
          bound: action.isRunning(),
        });
      }
      res.bones = [...inst.bones.keys()].slice(0, 8);

      // Does a BODY bone move as time advances under one clip?
      const probe = (clipName) => {
        T.playEnemyClip(clipName, 0);
        const readings = [];
        for (let i = 0; i < 5; i += 1) {
          T.advanceTime(0.28, 1 / 60);
          const b = inst.bones.get("thorax");
          const h = inst.bones.get("head");
          readings.push({
            t: Number((i * 0.28).toFixed(2)),
            thorax: b ? b.quaternion.toArray().map((n) => Number(n.toFixed(4))) : null,
            head: h ? h.quaternion.toArray().map((n) => Number(n.toFixed(4))) : null,
          });
        }
        return readings;
      };
      res.sample.idle = probe("idle");
      res.sample.strike = probe("strike");

      // And is anything actually being weighted?
      res.weights = [...inst.actions].map(([n, a]) => ({
        name: n, weight: Number(a.getEffectiveWeight().toFixed(3)),
        time: Number(a.time.toFixed(3)), running: a.isRunning(),
      }));
      return res;
    });

    console.log("clips:");
    for (const c of out.clips) {
      console.log(`  ${c.name.padEnd(8)} dur ${String(c.duration).padStart(6)}s `
        + `tracks ${String(c.tracks).padStart(3)}  e.g. ${c.sampleTracks.join(" | ")}`);
    }
    console.log("\nbones (first 8):", out.bones.join(", "));
    console.log("\naction weights after probing:");
    for (const w of out.weights) {
      console.log(`  ${w.name.padEnd(8)} weight ${String(w.weight).padStart(6)} `
        + `time ${String(w.time).padStart(7)} running ${w.running}`);
    }
    for (const [clip, readings] of Object.entries(out.sample)) {
      console.log(`\n"${clip}" - does the thorax move?`);
      for (const r of readings) {
        console.log(`  t=${String(r.t).padStart(5)}  thorax ${JSON.stringify(r.thorax)}`);
      }
      const first = JSON.stringify(readings[0].thorax);
      const moved = readings.some((r) => JSON.stringify(r.thorax) !== first);
      console.log(`  => ${moved ? "MOVES" : "STATIC - the mixer is not driving this bone"}`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
