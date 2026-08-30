#!/usr/bin/env node
/* ============================================================
   BLACKSAND - where does the DETAIL live, lit or shaded?

   Two independent blind reviewers and one offline measurement have now
   converged on the same defect from three directions:

     round 6 critic  "the lit sand is a smooth pale wash and the
                      shadowed sand is visibly rippled"
     control critic  "the ripple detail is clearly readable INSIDE the
                      shadow and invisible OUTSIDE it, which is
                      backwards"
     chroma-compare  our shade carries 1.74x the reference's saturation
                     while our lit surfaces sit at 0.93x

   All three describe one thing: our sunlight destroys surface
   information and our shade preserves it. Real sunlight does the
   opposite - it is the shadows that lose detail, because they are lit
   by a dim, broad, low-contrast source.

   This measures it directly. Split the frame into a lit and a shaded
   population by two-means on log luminance (same split the chroma
   comparator uses), then measure high-pass energy WITHIN each
   population and report the ratio. Run on both sides so the target is
   measured rather than assumed.

   High-pass energy is normalised by the population's mean luminance:
   a darker region has less absolute contrast for trivial reasons, and
   the question is whether the TEXTURE survives, not the brightness.

   Usage:
     node scripts/blacksand-detail-split.mjs --ours output/blacksand-shots/critic-6b
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
const W = 520; const H = 240;

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
    .greyscale().raw().toBuffer({ resolveWithObject: true });

  // Linear luminance per pixel, for the split.
  const lin = new Float64Array(W * H);
  for (let i = 0; i < W * H; i += 1) lin[i] = toLinear(data[i]);

  const sorted = Array.from(lin).sort((a, b) => a - b);
  let lo = sorted[Math.floor(0.2 * sorted.length)];
  let hi = sorted[Math.floor(0.8 * sorted.length)];
  const L = (v) => Math.log(v + 1e-5);
  for (let it = 0; it < 30; it += 1) {
    let sl = 0; let nl = 0; let sh = 0; let nh = 0;
    for (let i = 0; i < lin.length; i += 1) {
      if (Math.abs(L(lin[i]) - L(lo)) < Math.abs(L(lin[i]) - L(hi))) { sl += lin[i]; nl += 1; }
      else { sh += lin[i]; nh += 1; }
    }
    if (nl) lo = sl / nl;
    if (nh) hi = sh / nh;
  }

  // 3x3 Laplacian, evaluated only where the whole neighbourhood is in
  // the same population - a kernel straddling a shadow edge measures
  // the edge, which is not what "does this surface keep its texture"
  // is asking.
  const isShade = new Uint8Array(W * H);
  for (let i = 0; i < lin.length; i += 1) {
    isShade[i] = Math.abs(L(lin[i]) - L(lo)) < Math.abs(L(lin[i]) - L(hi)) ? 1 : 0;
  }
  const acc = { lit: { e: 0, n: 0, m: 0 }, shade: { e: 0, n: 0, m: 0 } };
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      const s = isShade[i];
      if (isShade[i - 1] !== s || isShade[i + 1] !== s
        || isShade[i - W] !== s || isShade[i + W] !== s) continue;
      const lap = 4 * lin[i] - lin[i - 1] - lin[i + 1] - lin[i - W] - lin[i + W];
      const t = s ? acc.shade : acc.lit;
      t.e += Math.abs(lap); t.m += lin[i]; t.n += 1;
    }
  }
  if (acc.lit.n < 500 || acc.shade.n < 500) return null;
  // Michelson-style normalisation: texture energy per unit of the
  // surface's own brightness.
  const litD = (acc.lit.e / acc.lit.n) / Math.max(acc.lit.m / acc.lit.n, 1e-5);
  const shadeD = (acc.shade.e / acc.shade.n) / Math.max(acc.shade.m / acc.shade.n, 1e-5);
  return { litD, shadeD, ratio: litD / Math.max(shadeD, 1e-6) };
}

async function run(dir, label) {
  const abs = path.resolve(root, dir);
  const files = (await readdir(abs))
    .filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith("_"))
    .sort();
  const rows = [];
  for (const f of files) {
    const r = await measure(path.join(abs, f));
    if (r) rows.push({ f, ...r });
  }
  const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const m = med(rows.map((r) => r.ratio));
  console.log(`${label.padEnd(16)} n=${String(rows.length).padStart(3)}   `
    + `detail in lit ${med(rows.map((r) => r.litD)).toFixed(4)}   `
    + `in shade ${med(rows.map((r) => r.shadeD)).toFixed(4)}   `
    + `lit:shade ${m.toFixed(2)}`);
  return { rows, m };
}

async function main() {
  const refs = await run(args.refs || "output/reference/bf2", "BATTLEFIELD 2");
  const ours = await run(args.ours || "output/blacksand-shots/latest", "OURS");
  console.log("");
  console.log(`Battlefield 2 keeps ${refs.m.toFixed(2)}x as much surface detail in sunlight as in shade.`);
  console.log(`Ours keeps          ${ours.m.toFixed(2)}x.`);
  if (refs.m > 1 && ours.m < 1) {
    console.log("\n-> INVERTED. Our sunlight is destroying surface information and our");
    console.log("   shade is preserving it. Real sun does the opposite: shade is lit by a");
    console.log("   dim broad source and is the half that goes smooth.");
  } else if (ours.m < refs.m * 0.75) {
    console.log(`\n-> ours is ${(ours.m / refs.m).toFixed(2)}x the reference. Lit surfaces are losing detail.`);
  } else {
    console.log("\n-> inside the reference's range. This is not the defect.");
  }
  console.log("\nper shot, ours (worst first):");
  for (const x of ours.rows.sort((a, b) => a.ratio - b.ratio)) {
    console.log(`  ${x.f.replace(/\.(png|jpe?g)$/, "").padEnd(22)} `
      + `lit ${x.litD.toFixed(4)}  shade ${x.shadeD.toFixed(4)}  ratio ${x.ratio.toFixed(2)}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
