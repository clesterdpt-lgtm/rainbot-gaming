#!/usr/bin/env node
/* ============================================================
   BLACKSAND - grounding probe

   Answers the round-6 art director's three highest-ranked claims with
   measurements instead of argument. Its symptoms have been reliable
   every round; its named mechanisms have been wrong five times out of
   five, so this measures the mechanism directly.

     1. "No ambient occlusion anywhere in the build - there is no SSAO
        pass, or one whose intensity is effectively zero."
        -> render each pose with ao.strength at its shipped value and
           again at 0, and report how much of the frame actually moves.

     2. "Small and medium props do not cast shadows - castShadow is not
        set on prop and foliage meshes."
        -> render each pose with sun.castShadow on and off. If shadows
           are absent from a frame, the A/B is flat, and that is true
           whatever the reason.

     5. "Shadows disappear entirely in wide and aerial framings - one
        cascade with a fixed ortho extent tied to the camera."
        -> the same A/B, reported per pose, next to the cascade extent
           the frame was actually rendered with.

     3. "Shaded surfaces lose material identity and go neutral cold -
        the sand albedo is near-grey and the warmth is all sun."
        -> split each frame into a sunlit and a shadowed population and
           report the mean hue and saturation of each. The reviewer is
           judging pixels, so measure pixels.

   Usage:
     node scripts/blacksand-grounding-probe.mjs
     node scripts/blacksand-grounding-probe.mjs --poses establishing,ridge
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
const PORT = Number(args.port || 44000 + (process.pid % 3000));
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve(root, args.out || "output/blacksand-shots/grounding");

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

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: mx > 1e-6 ? d / mx : 0, v: mx };
}

/** Decode a data URL into a flat RGB buffer at a fixed small size, so
 *  every comparison below is pixel-aligned across renders. */
async function decode(dataUrl) {
  const buf = Buffer.from(dataUrl.split(",")[1], "base64");
  const out = await sharp(buf).resize(400, 225, { fit: "fill" })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return out.data;
}

/** Mean absolute difference and the fraction of pixels that moved by
 *  more than a threshold a viewer could see. */
function diff(a, b, threshold = 4) {
  let sum = 0; let moved = 0; let n = 0; let peak = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1])
      + Math.abs(a[i + 2] - b[i + 2])) / 3;
    sum += d; if (d > threshold) moved += 1; if (d > peak) peak = d;
    n += 1;
  }
  return { mean: sum / n, movedPct: (100 * moved) / n, peak };
}

/** Split the frame into a sunlit and a shadowed population by log-luma
 *  two-means (a lighting ratio is a ratio), skipping sky pixels, then
 *  report the chroma of each. This is the number the reviewer is
 *  reacting to when they say shade "goes slate". */
function chromaSplit(data) {
  const px = [];
  for (let i = 0; i < data.length; i += 3) {
    const r = toLinear(data[i]); const g = toLinear(data[i + 1]);
    const b = toLinear(data[i + 2]);
    // Sky is the one thing in frame that is genuinely meant to be blue
    // and unlit; including it would poison both populations.
    if (b > r * 1.12 && b > 0.10) continue;
    px.push([r, g, b, 0.2126 * r + 0.7152 * g + 0.0722 * b]);
  }
  if (px.length < 200) return null;
  const lum = px.map((p) => p[3]).sort((a, b) => a - b);
  let lo = lum[Math.floor(0.2 * lum.length)];
  let hi = lum[Math.floor(0.8 * lum.length)];
  const L = (v) => Math.log(v + 1e-5);
  for (let it = 0; it < 30; it += 1) {
    let sl = 0; let nl = 0; let sh = 0; let nh = 0;
    for (const p of px) {
      if (Math.abs(L(p[3]) - L(lo)) < Math.abs(L(p[3]) - L(hi))) { sl += p[3]; nl += 1; }
      else { sh += p[3]; nh += 1; }
    }
    if (nl) lo = sl / nl;
    if (nh) hi = sh / nh;
  }
  const acc = (pick) => {
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (const p of px) {
      const isLo = Math.abs(L(p[3]) - L(lo)) < Math.abs(L(p[3]) - L(hi));
      if (isLo === pick) { r += p[0]; g += p[1]; b += p[2]; n += 1; }
    }
    if (!n) return null;
    const hsv = rgbToHsv(r / n, g / n, b / n);
    return { ...hsv, n };
  };
  const shade = acc(true); const lit = acc(false);
  if (!shade || !lit) return null;
  return { lit, shade, ratio: hi / Math.max(lo, 1e-5) };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = startServer();
  let browser = null;
  try {
    await waitForServer();
    browser = await chromium.launch({
      channel: "chromium", headless: true,
      args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader", "--disable-frame-rate-limit",
        "--disable-gpu-vsync", "--mute-audio"],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
    })).newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    await page.goto(`${BASE}/games/blacksand.html?qa=1&quality=ultra`,
      { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__BS && window.__BS.isReady(),
      null, { timeout: 180000 });
    await page.evaluate(() => {
      window.__BS.maximize();
      window.__BS.hideHud(true);
      const el = document.getElementById("bs-boot");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });

    const config = await page.evaluate(() => {
      const r = window.__BS.report();
      return { grade: r.grade, poses: window.__BS.listPoses() };
    });
    const poseIds = args.poses && args.poses !== true
      ? String(args.poses).split(",")
      : config.poses.map((p) => (typeof p === "string" ? p : p.id));

    console.log("shipped AO config:", JSON.stringify(config.grade.ao ?? "(not reported)"));
    console.log(`poses: ${poseIds.length}\n`);

    const rows = [];
    for (const id of poseIds) {
      const ok = await page.evaluate((pid) => window.__BS.setPose(pid), id);
      if (!ok) { console.log(`  ${id}: pose not found`); continue; }
      // Exposure adapts over time and setPose moves its target, so a
      // capture taken immediately measures the adaptation, not the shot.
      await page.evaluate(() => window.__BS.advanceTime(3.0, 1 / 60));

      const shot = async (mutate, restore) => {
        if (mutate) await page.evaluate(mutate);
        await page.evaluate(() => { for (let i = 0; i < 3; i += 1) window.__BS.renderOnce(1 / 60); });
        const url = await page.evaluate(() => window.__BS.captureDataURL("image/png"));
        if (restore) await page.evaluate(restore);
        return decode(url);
      };

      const base = await shot(null, null);

      const noShadow = await shot(() => {
        const r = window.__BS.ctx.render;
        window.__bsSaved = { a: r.sun.castShadow, b: r.sunFar ? r.sunFar.castShadow : null };
        r.sun.castShadow = false;
        if (r.sunFar) r.sunFar.castShadow = false;
      }, () => {
        const r = window.__BS.ctx.render;
        r.sun.castShadow = window.__bsSaved.a;
        if (r.sunFar) r.sunFar.castShadow = window.__bsSaved.b;
      });

      const noAo = await shot(() => {
        window.__bsAo = window.__BS.report().grade.ao;
        window.__BS.grade({ ao: 0 });
      }, () => {
        const a = window.__bsAo;
        window.__BS.grade({ ao: typeof a === "number" ? a : (a && a.strength) || 0.5 });
      });

      const shadowD = diff(base, noShadow);
      const aoD = diff(base, noAo, 2);
      const chroma = chromaSplit(base);
      const cascades = await page.evaluate(() => {
        const r = window.__BS.report();
        return r.render && r.render.shadow ? r.render.shadow : null;
      });

      rows.push({ id, shadowD, aoD, chroma, cascades });
      const c = chroma;
      console.log(
        `${id.padEnd(18)} shadow ${shadowD.movedPct.toFixed(1).padStart(5)}% `
        + `(mean ${shadowD.mean.toFixed(2)})   `
        + `ao ${aoD.movedPct.toFixed(1).padStart(5)}% (mean ${aoD.mean.toFixed(2)})   `
        + (c
          ? `lit h${c.lit.h.toFixed(0).padStart(3)} s${c.lit.s.toFixed(2)}  `
            + `shade h${c.shade.h.toFixed(0).padStart(3)} s${c.shade.s.toFixed(2)}  `
            + `ratio ${c.ratio.toFixed(1)}`
          : "chroma n/a")
      );
    }

    await writeFile(path.join(OUT, "grounding.json"),
      JSON.stringify({ config, rows }, null, 2));

    // ---- verdicts ----
    console.log("\n--- verdict ---");
    const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

    const shadowPct = rows.map((r) => r.shadowD.movedPct);
    const dead = rows.filter((r) => r.shadowD.movedPct < 1.0);
    console.log(`shadows: median ${med(shadowPct).toFixed(1)}% of the frame changes when the`
      + ` sun stops casting.`);
    if (dead.length) {
      console.log(`  !! ${dead.length}/${rows.length} poses render with effectively NO cast shadow:`);
      for (const r of dead) console.log(`       ${r.id}  ${r.shadowD.movedPct.toFixed(2)}%`);
      console.log("     The reviewer's symptom is real in these frames.");
    } else {
      console.log("  every pose has visible cast shadow. Claim 2/5 is false as stated.");
    }

    const aoPct = rows.map((r) => r.aoD.movedPct);
    console.log(`AO: median ${med(aoPct).toFixed(1)}% of the frame changes when AO is`
      + ` switched off, peak pixel delta ${Math.max(...rows.map((r) => r.aoD.peak)).toFixed(0)}/255.`);
    console.log(med(aoPct) < 5
      ? "  !! AO is present but doing almost nothing. Claim 1's SYMPTOM holds."
      : "  AO is materially affecting the image. Claim 1 is false as stated.");

    const withC = rows.filter((r) => r.chroma);
    if (withC.length) {
      const dh = withC.map((r) => r.chroma.lit.h - r.chroma.shade.h);
      const ds = withC.map((r) => r.chroma.shade.s / Math.max(r.chroma.lit.s, 1e-4));
      console.log(`shade chroma: shade keeps ${(100 * med(ds)).toFixed(0)}% of the lit`
        + ` saturation; hue shifts ${med(dh).toFixed(0)} deg lit->shade`);
      console.log(med(ds) < 0.7
        ? "  !! shade IS desaturating hard. Claim 3's symptom holds."
        : "  shade retains its chroma. Claim 3 is false as stated.");
    }
    if (errors.length) console.log(`\n!! ${errors.length} console error(s), first: ${errors[0]}`);
    await page.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
