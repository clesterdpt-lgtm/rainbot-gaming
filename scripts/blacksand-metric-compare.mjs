#!/usr/bin/env node
/* ============================================================
   BLACKSAND - objective metric comparison against the references

   Runs the same image statistics over our captures and over the real
   Battlefield 2 screenshots, and reports both distributions.

   This is not a substitute for a human (or agent) judging the images.
   It is the part of "does it look right" that CAN be measured, and it
   is useful precisely because it is blind to subject matter: if our
   frames sit outside the reference distribution on exposure, contrast
   or colour, that is a defect regardless of anyone's taste.

   Both sides are measured through the SAME crop band the blind
   comparison uses, so HUD, letterboxing and aspect differences do not
   contaminate the numbers.

   Usage:
     node scripts/blacksand-metric-compare.mjs --ours output/blacksand-shots/solo-2
   ============================================================ */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const CROP = { x0: 0.08, x1: 0.92, y0: 0.44, y1: 0.76 };

async function measure(file) {
  const meta = await sharp(file).metadata();
  const buf = await sharp(file)
    .extract({
      left: Math.round(meta.width * CROP.x0),
      top: Math.round(meta.height * CROP.y0),
      width: Math.round(meta.width * (CROP.x1 - CROP.x0)),
      height: Math.round(meta.height * (CROP.y1 - CROP.y0)),
    })
    .resize(480, 141, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data } = buf;
  const n = data.length / 3;
  let sum = 0;
  let sumSq = 0;
  let sat = 0;
  let dark = 0;
  let bright = 0;
  const hist = new Uint32Array(32);
  const luma = new Float32Array(n);

  for (let i = 0, p = 0; i < data.length; i += 3, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
    luma[p] = l;
    sum += l;
    sumSq += l * l;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
    if (l < 26) dark += 1;
    if (l > 229) bright += 1;
    hist[Math.min(31, l >> 3)] += 1;
  }

  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean));

  // Local detail: mean absolute laplacian. A proxy for how much
  // texture and geometric detail survives to the screen, which is
  // where a low-effort renderer gives itself away against a shipped
  // game - flat, under-detailed surfaces read as "cheap" long before
  // anyone can articulate why.
  const W = 480;
  const H = 141;
  let lap = 0;
  let lapN = 0;
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      const v = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - W] - luma[i + W];
      lap += Math.abs(v);
      lapN += 1;
    }
  }

  return {
    meanLuma: mean,
    sd,
    saturation: sat / n,
    darkPct: (dark / n) * 100,
    brightPct: (bright / n) * 100,
    tonalRange: hist.reduce((a, v) => a + (v > n * 0.0004 ? 1 : 0), 0),
    detail: lap / lapN,
  };
}

function summarise(label, rows) {
  const keys = ["meanLuma", "sd", "saturation", "darkPct", "brightPct", "tonalRange", "detail"];
  const out = { label, count: rows.length };
  for (const k of keys) {
    const vals = rows.map((r) => r[k]).sort((a, b) => a - b);
    out[k] = {
      min: +vals[0].toFixed(1),
      p50: +vals[Math.floor(vals.length / 2)].toFixed(1),
      max: +vals[vals.length - 1].toFixed(1),
      mean: +(vals.reduce((a, v) => a + v, 0) / vals.length).toFixed(1),
    };
  }
  return out;
}

async function listImages(dir) {
  const entries = await readdir(dir);
  return entries.filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith("_"))
    .sort().map((f) => path.join(dir, f));
}

async function main() {
  const oursDir = path.resolve(root, args.ours || "output/blacksand-shots/latest");
  const refsDir = path.resolve(root, args.refs || "output/reference/bf2");

  const ourFiles = await listImages(oursDir);
  const refFiles = await listImages(refsDir);

  const ours = [];
  for (const f of ourFiles) ours.push({ file: path.basename(f), ...await measure(f) });
  const refs = [];
  for (const f of refFiles) refs.push({ file: path.basename(f), ...await measure(f) });

  console.log("\n--- OURS, per shot ---");
  for (const r of ours) {
    console.log(
      `${r.file.replace(/\.png$/, "").padEnd(16)} luma ${r.meanLuma.toFixed(1).padStart(6)}`
      + `  sd ${r.sd.toFixed(1).padStart(5)}  sat ${r.saturation.toFixed(1).padStart(5)}`
      + `  dark% ${r.darkPct.toFixed(1).padStart(5)}  detail ${r.detail.toFixed(1).padStart(5)}`
    );
  }

  const a = summarise("OURS", ours);
  const b = summarise("BATTLEFIELD 2", refs);

  console.log("\n--- distribution comparison (through the same crop band) ---");
  const keys = ["meanLuma", "sd", "saturation", "darkPct", "brightPct", "tonalRange", "detail"];
  console.log(`${"metric".padEnd(12)} ${"OURS min/med/max".padEnd(26)} ${"BF2 min/med/max".padEnd(26)} verdict`);
  for (const k of keys) {
    const o = a[k];
    const r = b[k];
    // Inside the reference range is the bar. Outside it is a defect
    // even when it looks fine in isolation, because it means our
    // frames are systematically different from a shipped game's.
    const inside = o.p50 >= r.min && o.p50 <= r.max;
    const verdict = inside ? "ok" : (o.p50 < r.min ? "LOW" : "HIGH");
    console.log(
      `${k.padEnd(12)} ${`${o.min} / ${o.p50} / ${o.max}`.padEnd(26)} `
      + `${`${r.min} / ${r.p50} / ${r.max}`.padEnd(26)} ${verdict}`
    );
  }

  console.log("\n--- shots outside the reference range ---");
  const bad = [];
  for (const r of ours) {
    const notes = [];
    if (r.meanLuma < b.meanLuma.min) notes.push(`too dark (${r.meanLuma.toFixed(0)} < ${b.meanLuma.min})`);
    if (r.meanLuma > b.meanLuma.max) notes.push(`too bright (${r.meanLuma.toFixed(0)} > ${b.meanLuma.max})`);
    if (r.sd < b.sd.min) notes.push(`too flat (sd ${r.sd.toFixed(0)} < ${b.sd.min})`);
    if (r.saturation < b.saturation.min) notes.push(`too desaturated (${r.saturation.toFixed(0)} < ${b.saturation.min})`);
    if (r.detail < b.detail.min) notes.push(`too little detail (${r.detail.toFixed(1)} < ${b.detail.min})`);
    if (notes.length) { bad.push(r.file); console.log(`  ${r.file}: ${notes.join(", ")}`); }
  }
  if (!bad.length) console.log("  none - every shot sits inside the Battlefield 2 distribution.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
