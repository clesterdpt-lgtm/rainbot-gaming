#!/usr/bin/env node
/* ============================================================
   SAINTFALL - turning gait probe

   The straight-line foot-slip check passes and the run still looks
   wrong the moment you turn. Two complaints, both about the frame
   the feet are measured in rather than about the cycle itself:

     - the legs swing too LATERAL while you turn
     - they CROSS OVER on a change of direction

   Neither is visible in a still and neither is measured by
   `footSlipCheck`, which only ever walks straight ahead. The
   measurement lives in `__SF.turnGaitCheck` (qa.js), which expresses
   each foot in the BODY frame - origin at the pelvis, +X across to
   the trooper's right - so both complaints become numbers.

   Usage: node scripts/saintfall-turn-gait-probe.mjs [outfile.json]
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.resolve(root, process.argv[2] || "output/saintfall/turn-gait-probe.json");
const PORT = 47200 + (process.pid % 2000);
const BASE = `http://127.0.0.1:${PORT}`;

const NOTES = {
  "straight-run": "control: no turn at all",
  "gentle-arc": "45deg held turn, the commonest thing a player does",
  "hard-90": "stick slammed to a right angle at speed",
  "reversal-180": "full about-face - the reported crossed-legs case",
  "serpentine": "alternating hard turns, about one per stride",
};

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

    const results = await page.evaluate(() => window.__SF.turnGaitCheck());

    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, JSON.stringify(results, null, 2));

    console.log("\nSAINTFALL turning gait\n" + "=".repeat(78));
    console.log("manoeuvre".padEnd(15) + "maxLat".padStart(8) + "swingLat".padStart(10)
      + "minSep".padStart(9) + "cross%".padStart(8) + "worstX".padStart(8) + "  note");
    let fails = 0;
    for (const r of results) {
      if (r.crossoverFrames > 0 || r.maxLateralOffsetM > 0.34) fails += 1;
      console.log(
        r.id.padEnd(15)
        + `${r.maxLateralOffsetM}`.padStart(8)
        + `${r.maxSwingLateralM}`.padStart(10)
        + `${r.minLateralSeparationM}`.padStart(9)
        + `${r.crossoverPct}`.padStart(8)
        + `${r.worstCrossoverM}`.padStart(8)
        + "  " + (NOTES[r.id] || ""));
    }
    console.log("=".repeat(78));
    console.log("stance half-width is 0.115m. maxLat over ~0.34 is a foot thrown out");
    console.log("sideways; minSep at or below 0 is a literal crossover.");
    console.log(fails ? `\n${fails}/${results.length} manoeuvres FAIL` : "\nall manoeuvres pass");
    console.log(`wrote ${path.relative(root, outFile)}`);
  } finally {
    if (browser) await browser.close();
    server.kill("SIGKILL");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
