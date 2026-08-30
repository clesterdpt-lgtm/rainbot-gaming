#!/usr/bin/env node
/* ============================================================
   BLACKSAND - key-to-fill comparison against the references

   Answers one question: do OUR frames separate sunlit from shadowed
   by as much as a shipped game's frames do?

   A round-5 art director's top finding was "ambient is drowning the
   key - shadowed faces only drop 20-30% in value". That contradicted
   the in-engine probe, which measures shadowed ground at 5.7:1 linear
   against the sunlit ground beside it. Both can be true: the probe
   measures ONE material on flat ground, and the reviewer is judging
   every surface in the frame including vertical faces, props and the
   view model.

   So measure the thing the reviewer actually sees, on both sides, with
   no engine access: split each frame's luminance into a sunlit
   population and a shadowed one and report the ratio between them.
   Two-means on LOG luminance, because a lighting ratio is a ratio -
   clustering on linear values just finds the brightest region.

   Usage:
     node scripts/blacksand-contrast-compare.mjs --ours output/blacksand-shots/critic-5
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

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

async function measure(file) {
  const meta = await sharp(file).metadata();
  // `.raw().toBuffer()` without resolveWithObject returns the Buffer
  // itself, not { data, info } - destructuring it yields undefined.
  const data = await sharp(file)
    .extract({
      left: Math.round(meta.width * CROP.x0),
      top: Math.round(meta.height * CROP.y0),
      width: Math.round(meta.width * (CROP.x1 - CROP.x0)),
      height: Math.round(meta.height * (CROP.y1 - CROP.y0)),
    })
    .resize(300, 88, { fit: "cover" })
    .removeAlpha().raw().toBuffer();

  const lum = [];
  for (let i = 0; i < data.length; i += 3) {
    lum.push(0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1])
      + 0.0722 * toLinear(data[i + 2]));
  }
  lum.sort((a, b) => a - b);

  let lo = lum[Math.floor(0.2 * lum.length)];
  let hi = lum[Math.floor(0.8 * lum.length)];
  const L = (v) => Math.log(v + 1e-5);
  for (let it = 0; it < 30; it += 1) {
    let sl = 0; let nl = 0; let sh = 0; let nh = 0;
    for (const v of lum) {
      if (Math.abs(L(v) - L(lo)) < Math.abs(L(v) - L(hi))) { sl += v; nl += 1; }
      else { sh += v; nh += 1; }
    }
    if (nl) lo = sl / nl;
    if (nh) hi = sh / nh;
  }
  return lo > 1e-5 ? hi / lo : null;
}

async function run(dir, label) {
  const abs = path.resolve(root, dir);
  const files = (await readdir(abs))
    .filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith("_"))
    .sort();
  const rows = [];
  for (const f of files) {
    const r = await measure(path.join(abs, f));
    if (r) rows.push({ f, r });
  }
  const vals = rows.map((x) => x.r).sort((a, b) => a - b);
  console.log(`${label.padEnd(18)} n=${String(vals.length).padStart(3)}   `
    + `key:fill  min ${vals[0].toFixed(2)}  median ${vals[Math.floor(vals.length / 2)].toFixed(2)}`
    + `  max ${vals[vals.length - 1].toFixed(2)}`);
  return { rows, vals };
}

async function main() {
  const refs = await run(args.refs || "output/reference/bf2", "BATTLEFIELD 2");
  const ours = await run(args.ours || "output/blacksand-shots/latest", "OURS");

  const rm = refs.vals[Math.floor(refs.vals.length / 2)];
  const om = ours.vals[Math.floor(ours.vals.length / 2)];
  console.log(`\nours / reference = ${(om / rm).toFixed(2)}x`);
  console.log(om < rm * 0.8
    ? "-> OUR FRAMES ARE FLATTER. Ambient is too strong relative to the key."
    : om > rm * 1.25
      ? "-> our frames are more contrasty than the reference."
      : "-> within a quarter-stop of the reference. This is not the defect.");

  console.log("\nper shot, ours:");
  for (const x of ours.rows.sort((a, b) => a.r - b.r)) {
    console.log(`  ${x.f.replace(/\.(png|jpe?g)$/, "").padEnd(20)} ${x.r.toFixed(2)}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
