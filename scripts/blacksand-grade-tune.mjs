#!/usr/bin/env node
/* ============================================================
   BLACKSAND - grade tuner

   Sweeps exposure bias, contrast and shadow lift, renders every beauty
   pose at each setting, and scores the result against the measured
   Battlefield 2 distribution. Prints the winner and the numbers behind
   it.

   Why a sweep rather than eyeballing it: "make it brighter" has three
   knobs that all brighten, and they trade off against each other. Bias
   raises everything including the sky, contrast trades shadow for
   highlight, and the toe lift only opens the bottom. Picking them by
   eye means re-judging ten images per candidate and converging on
   whichever one the last screenshot happened to flatter. The reference
   distribution is a fixed target, so the search has an actual optimum.

   Usage:
     node scripts/blacksand-grade-tune.mjs
     node scripts/blacksand-grade-tune.mjs --quick
   ============================================================ */

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import sharp from "sharp";

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
const PORT = Number(args.port || 45500 + (process.pid % 4000));
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/games/blacksand.html?qa=1&quality=ultra`;
const CROP = { x0: 0.08, x1: 0.92, y0: 0.44, y1: 0.76 };

/* ------------------------- measurement ------------------------- */

async function measureBuffer(buf) {
  const meta = await sharp(buf).metadata();
  const { data } = await sharp(buf)
    .extract({
      left: Math.round(meta.width * CROP.x0),
      top: Math.round(meta.height * CROP.y0),
      width: Math.round(meta.width * (CROP.x1 - CROP.x0)),
      height: Math.round(meta.height * (CROP.y1 - CROP.y0)),
    })
    .resize(320, 94, { fit: "cover" }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });

  const n = data.length / 3;
  let sum = 0; let sumSq = 0; let sat = 0; let dark = 0; let bright = 0;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
    sum += l; sumSq += l * l;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
    if (l < 26) dark += 1;
    if (l > 229) bright += 1;
  }
  const mean = sum / n;
  return {
    meanLuma: mean,
    sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
    saturation: sat / n,
    darkPct: (dark / n) * 100,
    brightPct: (bright / n) * 100,
  };
}

/** Target = the measured BF2 distribution (median, and an acceptable
 *  band). Scoring is a normalised distance so no single metric
 *  dominates just because its units are bigger. */
const TARGET = {
  meanLuma: { want: 100.4, lo: 81.4, hi: 160.2, weight: 1.0 },
  sd: { want: 46.2, lo: 38.7, hi: 57.6, weight: 1.0 },
  darkPct: { want: 5.4, lo: 0.1, hi: 10.8, weight: 0.9 },
  saturation: { want: 30.9, lo: 7.3, hi: 71.0, weight: 0.5 },
  brightPct: { want: 0.6, lo: 0.0, hi: 5.8, weight: 0.4 },
};

function score(metrics) {
  let total = 0;
  for (const key of Object.keys(TARGET)) {
    const t = TARGET[key];
    const v = metrics[key];
    const span = Math.max(t.hi - t.lo, 1e-3);
    // Inside the band costs little; outside it costs quadratically.
    let d = 0;
    if (v < t.lo) d = (t.lo - v) / span;
    else if (v > t.hi) d = (v - t.hi) / span;
    d += Math.abs(v - t.want) / span * 0.35;
    total += d * d * t.weight;
  }
  return total;
}

/* --------------------------- harness --------------------------- */

function startServer() {
  const child = spawn("/opt/homebrew/bin/python3",
    ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"],
    { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", () => {});
  return child;
}

async function waitForServer() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE}/games/blacksand.html`, { cache: "no-store" });
      if (res.ok) return;
    } catch (_) { /* retry */ }
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
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    })).newPage();

    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(), null, { timeout: 150000 });
    await page.evaluate(() => {
      window.__BS.maximize();
      window.__BS.hideHud(true);
      window.__BS.hideViewmodel(true);
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    await page.evaluate(() => window.__BS.advanceTime(4, 1 / 60));

    const poses = await page.evaluate(() => window.__BS.listPoses().map((p) => p.id));
    console.log(`tuning against ${poses.length} poses\n`);

    // The look transform is what actually moves contrast and colour;
    // exposure bias alone saturates against AgX's shoulder. Sweep the
    // look first and keep the pixel grade simple.
    // Power BELOW 1. The look power is applied to the LOG-ENCODED
    // value, which lives in 0..1 - so pow(x, 1.35) darkens everything,
    // the opposite of what "punchy" implies if you think of it as a
    // display gamma. The first sweep ran 1.0-1.5 and every candidate
    // above 1.0 lost 30 points of luma; the useful range is under 1.
    const biases = args.quick ? [3.0, 4.0] : [2.7, 3.4, 4.2, 5.2];
    const powers = args.quick ? [0.85] : [0.75, 0.85, 0.95];
    const sats = args.quick ? [1.5] : [1.3, 1.6, 1.9];
    const lifts = args.quick ? [0.03] : [0.0, 0.03];

    let best = null;
    for (const bias of biases) {
      for (const contrast of powers) {
        for (const lift of lifts) {
          for (const lookSat of sats) {
          await page.evaluate((g) => window.__BS.grade(g),
            { exposureBias: bias, contrast: 1.02, lookPower: contrast,
              lookSat, shadowLift: lift });

          const rows = [];
          for (const pose of poses) {
            await page.evaluate((id) => {
              window.__BS.setPose(id);
              for (let i = 0; i < 6; i += 1) window.__BS.renderOnce(1 / 60);
            }, pose);
            const dataUrl = await page.evaluate(() => window.__BS.captureDataURL());
            rows.push(await measureBuffer(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64")));
          }

          // Score the MEDIAN of the set, not the mean: one deliberately
          // dark interior should not drag the whole grade brighter.
          const med = {};
          for (const k of Object.keys(TARGET)) {
            const v = rows.map((r) => r[k]).sort((a, b) => a - b);
            med[k] = v[Math.floor(v.length / 2)];
          }
          const s = score(med);
          const tag = `bias ${bias.toFixed(2)}  power ${contrast.toFixed(2)}  sat ${lookSat.toFixed(2)}  lift ${lift.toFixed(3)}`;
          console.log(
            `${tag}  ->  luma ${med.meanLuma.toFixed(1).padStart(6)}`
            + `  sd ${med.sd.toFixed(1).padStart(5)}`
            + `  dark% ${med.darkPct.toFixed(1).padStart(5)}`
            + `  sat ${med.saturation.toFixed(1).padStart(5)}`
            + `  score ${s.toFixed(3)}`
          );
          if (!best || s < best.score) best = { bias, contrast, lift, lookSat, score: s, med };
          }
        }
      }
    }

    console.log("\n=== BEST ===");
    console.log(`exposureBias ${best.bias}   lookPower ${best.contrast}   lookSat ${best.lookSat}   shadowLift ${best.lift}`);
    console.log(`median: luma ${best.med.meanLuma.toFixed(1)}  sd ${best.med.sd.toFixed(1)}`
      + `  dark% ${best.med.darkPct.toFixed(1)}  sat ${best.med.saturation.toFixed(1)}`
      + `  bright% ${best.med.brightPct.toFixed(2)}`);
    console.log(`\nBF2 target:  luma 100.4  sd 46.2  dark% 5.4  sat 30.9`);
    console.log("\nApply these as the defaults in render.js.");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
