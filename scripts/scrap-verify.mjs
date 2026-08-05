#!/usr/bin/env node
/* ============================================================
   SCRAP CIRCUIT — verification probe

   Three things the screenshot harnesses cannot tell you:

   1. PERFORMANCE. The arenas went from ~420 meshes to ~1600. This
      measures real frame time with the renderer actually drawing,
      per arena, and reports draw calls and triangle counts.

   2. DRIVABILITY. Every arena is driven from its spawn in eight
      directions, checking the car actually travels — a new
      collider in the wrong place walls a spawn in and the only
      symptom is a car that will not move.

   3. VERTICALITY. The ramps and decks are still reachable, which
      is the thing most likely to break when arena geometry moves.

   Usage: node scripts/scrap-verify.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 48000 + (process.pid % 9000);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARENAS = ["suburb", "junkyard", "interchange", "boardwalk", "rooftop", "cemetery"];

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
  const server = startServer();
  let browser = null;
  let failures = 0;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--force-device-scale-factor=1", "--mute-audio"],
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") pageErrors.push(`console: ${m.text()}`); });
    await page.goto(`${BASE_URL}/games/scrap-circuit.html?qa=1`, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__scrapQA, null, { timeout: 30000 });
    await delay(1400);

    console.log("arena         meshes  tris    ms/frame  headings     wedged    ramps  tallest deck");
    for (const arenaId of ARENAS) {
      const r = await page.evaluate(async (a) => {
        const qa = window.__scrapQA;
        qa.begin(a, "towtruck");
        qa.hideHUD(true);
        qa.step(1);

        // --- render timing: real frames, measured on the wall clock ---
        qa.freeCam(false);
        const N = 45;
        const t0 = performance.now();
        for (let i = 0; i < N; i += 1) { qa.step(1 / 60, 1 / 60); qa.chase(); }
        const ms = (performance.now() - t0) / N;
        const stats = qa.stats();

        /* --- drivability: eight headings from spawn ---
           Bots are parked first: one ramming the car mid-test is
           indistinguishable from a spawn wedged in a wall. */
        qa.clearBots();
        const p = qa.state.player;
        const home = { x: p.x, z: p.z };
        /* Two different things can stop the car, and only one is a bug.
           Wedged (< 4 m of travel in two and a half seconds at full
           throttle) means the spawn is inside geometry and the round is
           unplayable from it. Simply hitting a building after driving a
           way is dense level design, which is the point. */
        let wedged = 0;
        let clear = 0;
        let maxY = p.y;
        for (let dir = 0; dir < 8; dir += 1) {
          p.x = home.x; p.z = home.z; p.vx = 0; p.vz = 0;
          p.heading = (dir / 8) * Math.PI * 2;
          p.y = qa.sampleGround(p.x, p.z, 100);
          const sx = p.x, sz = p.z;
          qa.input({ throttle: 1, steer: 0 });
          let peak = 0;
          for (let i = 0; i < 150; i += 1) {
            qa.step(1 / 60, 1 / 60);
            peak = Math.max(peak, Math.hypot(p.vx, p.vz));
            maxY = Math.max(maxY, p.y);
          }
          const d = Math.hypot(p.x - sx, p.z - sz);
          /* Peak speed, not net displacement, is what separates wedged
             from legitimately stopped: on the rooftops a car driven at a
             roof edge falls into the abyss and is respawned back where it
             started, which looks identical to never having moved. */
          if (peak < 3) wedged += 1;
          else if (d > 12) clear += 1;
        }
        const moved = clear;
        /* --- verticality -------------------------------------------------
           Elevated access has broken before in this game (guardrails
           walling off ramp mouths, colliders capping their own decks), and
           it is invisible in a screenshot. Drive each ramp from its low
           end and check the car actually gains the height. */
        let bestDeck = 0;
        const ramps = [];
        (qa.arena.heights || []).forEach((h) => {
          if (h.type === "rect") bestDeck = Math.max(bestDeck, h.y);
          if (h.type === "ramp") {
            bestDeck = Math.max(bestDeck, h.y0, h.y1);
            if (Math.abs(h.y1 - h.y0) > 1.5) ramps.push(h);
          }
        });
        let rampsOk = 0;
        ramps.forEach((h) => {
          const up = h.y1 > h.y0;
          const along = h.axis === "z" ? "z" : "x";
          const half = along === "z" ? h.hd : h.hw;
          // Start a little before the low end, aimed up the slope.
          const sign = up ? -1 : 1;
          const sx = along === "x" ? h.x + sign * (half - 0.6) : h.x;
          const sz = along === "z" ? h.z + sign * (half - 0.6) : h.z;
          p.x = sx; p.z = sz; p.vx = 0; p.vz = 0; p.vy = 0;
          p.y = qa.sampleGround(sx, sz, Math.min(h.y0, h.y1) + 2);
          p.heading = along === "x" ? (sign < 0 ? Math.PI / 2 : -Math.PI / 2)
                                    : (sign < 0 ? 0 : Math.PI);
          qa.input({ throttle: 1, steer: 0 });
          let top = p.y;
          for (let i = 0; i < 190; i += 1) { qa.step(1 / 60, 1 / 60); top = Math.max(top, p.y); }
          if (top >= Math.max(h.y0, h.y1) - 1.0) rampsOk += 1;
        });
        qa.input(null);
        return { ms, stats, moved, wedged, maxY, bestDeck, ramps: ramps.length, rampsOk };
      }, arenaId);

      const ok = r.wedged === 0 && r.ms < 12 && (r.ramps === 0 || r.rampsOk === r.ramps);
      if (!ok) failures += 1;
      console.log(
        `${arenaId.padEnd(13)} ${String(r.stats.meshes).padEnd(7)} ${String(r.stats.tris).padEnd(7)} ` +
        `${r.ms.toFixed(2).padStart(7)}   ${r.moved}/8 clear  ${r.wedged} wedged  ` +
        `ramps ${r.rampsOk}/${r.ramps}  deck ${r.bestDeck.toFixed(1)}m ${ok ? "" : "  !!"}`
      );
    }
    if (pageErrors.length) {
      failures += 1;
      console.log(`\nERRORS:\n  ${pageErrors.slice(0, 10).join("\n  ")}`);
    }
    console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
    process.exitCode = failures ? 1 : 0;
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
