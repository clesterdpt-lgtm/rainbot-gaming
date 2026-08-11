#!/usr/bin/env node
/* ============================================================
   BLACKSAND - is sunlit ground clipping?

   The round-7 art director's top finding, with the falsification test
   it supplied:

     "Detail present in shade and absent in sun is not a texture
      problem - the texture data is demonstrably there. Histogram the
      lit sand region. If more than a few percent of pixels sit within
      2/255 of max, it's clipping. If the histogram is healthy and the
      detail is STILL gone, the cause is mip/LOD bias or aniso, not
      exposure, and the fix is completely different."

   That is the right shape of test and it costs nothing, so run it - on
   both sides, because "a few percent" is only meaningful next to what
   the reference does with its own sunlit sand.

   Splits each frame into lit and shaded populations by two-means on log
   luminance (the same split the chroma and detail comparators use), then
   reports, for the LIT population only:

     top2      percent of pixels within 2/255 of white on any channel
     top8      percent within 8/255 - the shoulder, not just the clip
     p99/p50   how far the brightest lit pixels sit above the median
     spread    interquartile range of the lit population, in 8-bit counts

   A clipping surface shows a high top2 AND a collapsed spread. A surface
   that is merely bright shows a high p99/p50 with the spread intact.
   Those need opposite fixes, which is exactly the reviewer's point.

   Usage:
     node scripts/blacksand-clip-probe.mjs --ours output/blacksand-shots/rep-f
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
const CROP = { x0: 0.06, x1: 0.94, y0: 0.46, y1: 0.94 };
const W = 480; const H = 210;

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

async function measure(file) {
  const meta = await sharp(file).metadata();
  const { data } = await sharp(file)
    .extract({
      left: Math.round(meta.width * CROP.x0),
      top: Math.round(meta.height * CROP.y0),
      width: Math.round(meta.width * (CROP.x1 - CROP.x0)),
      height: Math.round(meta.height * (CROP.y1 - CROP.y0)),
    })
    .resize(W, H, { fit: "fill" })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });

  const px = [];
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
    const lin = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
    px.push({ lin, top: Math.max(r, g, b), grey: (r * 0.2126 + g * 0.7152 + b * 0.0722) });
  }
  const lum = px.map((p) => p.lin).sort((a, b) => a - b);
  let lo = lum[Math.floor(0.2 * lum.length)];
  let hi = lum[Math.floor(0.8 * lum.length)];
  const L = (v) => Math.log(v + 1e-5);
  for (let it = 0; it < 30; it += 1) {
    let sl = 0; let nl = 0; let sh = 0; let nh = 0;
    for (const p of px) {
      if (Math.abs(L(p.lin) - L(lo)) < Math.abs(L(p.lin) - L(hi))) { sl += p.lin; nl += 1; }
      else { sh += p.lin; nh += 1; }
    }
    if (nl) lo = sl / nl;
    if (nh) hi = sh / nh;
  }
  const lit = px.filter((p) => Math.abs(L(p.lin) - L(lo)) >= Math.abs(L(p.lin) - L(hi)));
  if (lit.length < 400) return null;

  const top2 = (100 * lit.filter((p) => p.top >= 253).length) / lit.length;
  const top8 = (100 * lit.filter((p) => p.top >= 247).length) / lit.length;
  const g = lit.map((p) => p.grey).sort((a, b) => a - b);
  const at = (q) => g[Math.min(g.length - 1, Math.floor(q * g.length))];
  return {
    top2, top8, p50: at(0.5), p99: at(0.99),
    ratio: at(0.99) / Math.max(at(0.5), 1e-3),
    iqr: at(0.75) - at(0.25),
  };
}

async function run(dir, label) {
  const abs = path.resolve(root, dir);
  const files = (await readdir(abs))
    .filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith("_"))
    .sort();
  const rows = [];
  for (const f of files) {
    const m = await measure(path.join(abs, f));
    if (m) rows.push({ f, ...m });
  }
  const med = (k) => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  console.log(`${label.padEnd(16)} n=${String(rows.length).padStart(3)}   `
    + `top2 ${med("top2").toFixed(2)}%   top8 ${med("top8").toFixed(2)}%   `
    + `p99/p50 ${med("ratio").toFixed(2)}   lit IQR ${med("iqr").toFixed(1)}`);
  return { rows, med };
}

async function main() {
  const refs = await run(args.refs || "output/reference/bf2", "BATTLEFIELD 2");
  const ours = await run(args.ours || "output/blacksand-shots/latest", "OURS");
  console.log("");

  const oTop = ours.med("top2"); const rTop = refs.med("top2");
  const oIqr = ours.med("iqr"); const rIqr = refs.med("iqr");

  console.log(`clipped lit pixels: reference ${rTop.toFixed(2)}%  ours ${oTop.toFixed(2)}%`);
  console.log(`lit tonal spread (IQR): reference ${rIqr.toFixed(1)}  ours ${oIqr.toFixed(1)}`
    + `  (${(oIqr / rIqr).toFixed(2)}x)`);

  if (oTop > 2 && oTop > rTop * 2) {
    console.log("\n-> CLIPPING. The reviewer is right and exposure is the lever.");
  } else if (oIqr < rIqr * 0.75) {
    console.log("\n-> NOT clipping, but our sunlit surfaces carry less tonal spread than the");
    console.log("   reference's. The detail is being lost to something other than the top of");
    console.log("   the curve - mip/LOD bias, anisotropy, or the albedo itself being flat.");
  } else {
    console.log("\n-> neither clipped nor flat. This is not the defect.");
  }

  console.log("\nper shot, ours (most clipped first):");
  for (const x of ours.rows.sort((a, b) => b.top2 - a.top2)) {
    console.log(`  ${x.f.replace(/\.(png|jpe?g)$/, "").padEnd(22)} `
      + `top2 ${x.top2.toFixed(2)}%  top8 ${x.top8.toFixed(2)}%  IQR ${x.iqr.toFixed(1)}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
