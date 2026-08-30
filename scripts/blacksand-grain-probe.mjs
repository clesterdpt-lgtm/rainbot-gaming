#!/usr/bin/env node
/* ============================================================
   BLACKSAND - directional grain probe

   Catches a class of defect the seven-metric suite is blind to: a
   surface pattern that runs in ONE direction across the whole frame.

   Round 6's terrain sampled its wind streak through a rigid rotation of
   world XZ squashed 17:1. That is an affine map, so the streaks came out
   perfectly parallel and effectively infinite, at a single angle over
   1024m of map. Every blind reviewer since round 4 has described it -
   "stepped LOD contour banding", "terracing", "a filter" - and every
   image metric we had said the frame was fine, because the pattern has
   the right contrast, the right detail density and the right histogram.
   It is only wrong in its ORIENTATION STATISTICS.

   Method: take the local image gradient, and build the structure tensor
   over the whole frame. Its two eigenvalues say how much gradient energy
   lies along the dominant direction versus across it. Isotropic ground -
   real sand, gravel, rubble - has eigenvalues close to equal. Corduroy
   has one much larger than the other.

     coherence = (l1 - l2) / (l1 + l2)      0 = isotropic, 1 = pure stripe

   Reported on our shots and on real Battlefield 2 frames, so the target
   is measured rather than guessed. The gradient is taken on a blurred
   copy: at full resolution the score is dominated by pixel noise and
   every image looks isotropic.

   Usage:
     node scripts/blacksand-grain-probe.mjs --ours output/blacksand-shots/terrain-1
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

/* The ground band. Sky has no texture and would read as perfectly
   isotropic, diluting the score; the very bottom of frame is often the
   view model. This is the band the blind harness shows the reviewer. */
const CROP = { x0: 0.05, x1: 0.95, y0: 0.42, y1: 0.92 };
const W = 480; const H = 200;

async function grain(file) {
  const meta = await sharp(file).metadata();
  const { data } = await sharp(file)
    .extract({
      left: Math.round(meta.width * CROP.x0),
      top: Math.round(meta.height * CROP.y0),
      width: Math.round(meta.width * (CROP.x1 - CROP.x0)),
      height: Math.round(meta.height * (CROP.y1 - CROP.y0)),
    })
    .resize(W, H, { fit: "fill" })
    .greyscale()
    // Sensor/compression noise is isotropic and swamps the structure
    // tensor at full rate. The pattern we are hunting is tens of pixels
    // across, so blurring away the last two is free.
    .blur(1.6)
    .raw().toBuffer({ resolveWithObject: true });

  let jxx = 0; let jxy = 0; let jyy = 0;
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      const gx = (data[i + 1] - data[i - 1]) * 0.5;
      const gy = (data[i + W] - data[i - W]) * 0.5;
      // A flat region contributes nothing but rounding, and there are a
      // lot of flat regions in a desert. Weighting by magnitude keeps
      // the tensor honest about where the structure actually is.
      const m = Math.hypot(gx, gy);
      if (m < 0.8) continue;
      jxx += gx * gx; jxy += gx * gy; jyy += gy * gy;
    }
  }
  const tr = jxx + jyy;
  if (tr < 1e-6) return null;
  const d = Math.sqrt(Math.max(0, (jxx - jyy) * (jxx - jyy) + 4 * jxy * jxy));
  const l1 = (tr + d) / 2; const l2 = (tr - d) / 2;
  const coherence = d / tr;
  // Orientation of the dominant gradient, rotated 90deg to give the
  // direction the STRIPES run, which is the thing a human describes.
  let angle = (Math.atan2(2 * jxy, jxx - jyy) / 2) * (180 / Math.PI) + 90;
  if (angle < 0) angle += 180;
  if (angle >= 180) angle -= 180;
  return { coherence, angle, l1, l2 };
}

async function run(dir, label) {
  const abs = path.resolve(root, dir);
  const files = (await readdir(abs))
    .filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith("_"))
    .sort();
  const rows = [];
  for (const f of files) {
    const g = await grain(path.join(abs, f));
    if (g) rows.push({ f, ...g });
  }
  const vals = rows.map((r) => r.coherence).sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)];
  console.log(`${label.padEnd(16)} n=${String(rows.length).padStart(3)}   `
    + `coherence  min ${vals[0].toFixed(3)}  median ${med.toFixed(3)}  `
    + `max ${vals[vals.length - 1].toFixed(3)}`);
  return { rows, med, max: vals[vals.length - 1] };
}

async function main() {
  const refs = await run(args.refs || "output/reference/bf2", "BATTLEFIELD 2");
  const ours = await run(args.ours || "output/blacksand-shots/latest", "OURS");

  console.log("");
  // A single global stripe direction shows up twice: as a high
  // coherence, and as an angle that barely moves between shots taken
  // from completely different places. The second is the stronger tell.
  const spread = (rows) => {
    const a = rows.map((r) => (r.angle * Math.PI) / 90);
    const x = a.reduce((s, v) => s + Math.cos(v), 0) / a.length;
    const y = a.reduce((s, v) => s + Math.sin(v), 0) / a.length;
    return 1 - Math.hypot(x, y);
  };
  console.log(`orientation spread across shots: reference ${spread(refs.rows).toFixed(3)}`
    + `  ours ${spread(ours.rows).toFixed(3)}   (1 = every shot differs, 0 = one global direction)`);

  const r = refs.med; const o = ours.med;
  console.log(`\nmedian coherence: reference ${r.toFixed(3)}  ours ${o.toFixed(3)}`
    + `  (${(o / r).toFixed(2)}x)`);
  console.log(o > r * 1.35
    ? "-> OUR GROUND HAS A MECHANICAL GRAIN the reference does not."
    : o < r * 0.7
      ? "-> ours is less directional than the reference, which is not a defect."
      : "-> inside the reference's range. This is not the defect.");

  console.log("\nper shot, ours (worst first):");
  for (const x of ours.rows.sort((a, b) => b.coherence - a.coherence)) {
    console.log(`  ${x.f.replace(/\.(png|jpe?g)$/, "").padEnd(22)} `
      + `coherence ${x.coherence.toFixed(3)}  stripes run ${x.angle.toFixed(0)} deg`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
