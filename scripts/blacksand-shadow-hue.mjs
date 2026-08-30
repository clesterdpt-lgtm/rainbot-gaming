#!/usr/bin/env node
/* ============================================================
   BLACKSAND - what does a shadow do to a material's hue?

   The round-10 art director measured the one thing this project's
   chroma tooling could not see:

     our sand   lit hue 33 sat 0.23  ->  shaded hue 56 sat 0.40
                (+23 degrees toward olive, saturation UP 74%)
     BF2 hull   lit hue 34.5         ->  shaded hue 33.5-37.3
                (under 3 degrees, saturation correctly DOWN)

   `blacksand-chroma-compare.mjs` reports a 2 degree lit->shade drift and
   is not wrong - it splits the whole frame by luminance, so its two
   populations are made of DIFFERENT MATERIALS. Sand in sun versus brick
   in shade tells you nothing about what shadow does to sand. Averaged
   over a frame the material differences cancel and the effect vanishes.

   This controls for material by pairing pixels that are a few
   centimetres apart across a shadow boundary. Two samples that close are
   overwhelmingly the same surface, so the difference between them is the
   light and nothing else.

   Method: find pixels whose local neighbourhood straddles a strong
   luminance step (a shadow edge), take the mean of the bright side and
   the dark side within a small window, and accumulate the hue rotation
   and saturation ratio. Runs on both sides, because the question is not
   "does shade shift hue" - all shade does - but "does ours shift more
   than a shipped title's".

   Usage:
     node scripts/blacksand-shadow-hue.mjs --ours output/blacksand-shots/r10-4
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
const CROP = { x0: 0.04, x1: 0.96, y0: 0.40, y1: 0.96 };
const W = 620; const H = 300;
/* Half-width of the sampling window, in pixels of the resized crop. At
   this scale that is a few tens of centimetres of ground at mid
   distance - close enough that both samples are the same surface,
   far enough that the penumbra does not swallow the pair. */
const R = 3;

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function hueOf(r, g, b) {
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
  if (d < 1e-9) return null;
  let h;
  if (mx === r) h = 60 * (((g - b) / d) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return h < 0 ? h + 360 : h;
}
const satOf = (r, g, b) => {
  const mx = Math.max(r, g, b);
  return mx > 1e-9 ? (mx - Math.min(r, g, b)) / mx : 0;
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

  const lum = new Float64Array(W * H);
  for (let i = 0, p = 0; i < data.length; i += 3, p += 1) {
    lum[p] = 0.2126 * toLinear(data[i]) + 0.7152 * toLinear(data[i + 1])
      + 0.0722 * toLinear(data[i + 2]);
  }

  let dx = 0; let dy = 0; let sumSat = 0; let n = 0;
  const step = 2;
  for (let y = R; y < H - R; y += step) {
    for (let x = R; x < W - R; x += step) {
      // Collect the window, split it at its own midpoint, and require a
      // real step with enough population on both sides. A gradient
      // across a curved surface fails the step test; a shadow edge
      // passes it.
      let lo = 1e9; let hi = -1e9;
      for (let j = -R; j <= R; j += 1) {
        for (let i = -R; i <= R; i += 1) {
          const v = lum[(y + j) * W + (x + i)];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      if (hi < 0.02 || lo <= 1e-5) continue;
      if (hi / lo < 2.2) continue;          // not a shadow edge
      const mid = Math.sqrt(hi * lo);       // geometric mean: a ratio split
      let br = 0; let bg = 0; let bb = 0; let bn = 0;
      let dr = 0; let dg = 0; let db = 0; let dn = 0;
      for (let j = -R; j <= R; j += 1) {
        for (let i = -R; i <= R; i += 1) {
          const p = (y + j) * W + (x + i);
          const o = p * 3;
          const r = toLinear(data[o]); const g = toLinear(data[o + 1]);
          const b = toLinear(data[o + 2]);
          if (lum[p] > mid) { br += r; bg += g; bb += b; bn += 1; }
          else { dr += r; dg += g; db += b; dn += 1; }
        }
      }
      if (bn < 6 || dn < 6) continue;
      const hL = hueOf(br / bn, bg / bn, bb / bn);
      const hS = hueOf(dr / dn, dg / dn, db / dn);
      if (hL === null || hS === null) continue;
      const sL = satOf(br / bn, bg / bn, bb / bn);
      const sS = satOf(dr / dn, dg / dn, db / dn);
      if (sL < 0.06) continue;              // a neutral lit side has no hue to rotate
      let d = hS - hL;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      if (Math.abs(d) > 120) continue;      // different material, not a shadow
      const rad = (d * Math.PI) / 180;
      dx += Math.cos(rad); dy += Math.sin(rad);
      sumSat += sS / Math.max(sL, 1e-4);
      n += 1;
    }
  }
  if (n < 40) return null;
  const drift = (Math.atan2(dy / n, dx / n) * 180) / Math.PI;
  return { drift, satRatio: sumSat / n, n };
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
    + `hue drift lit->shade ${med("drift") >= 0 ? "+" : ""}${med("drift").toFixed(1)} deg   `
    + `saturation ratio shade/lit ${med("satRatio").toFixed(2)}`);
  return { rows, med };
}

async function main() {
  const refs = await run(args.refs || "output/reference/bf2", "BATTLEFIELD 2");
  const ours = await run(args.ours || "output/blacksand-shots/latest", "OURS");
  console.log("");
  const rd = Math.abs(refs.med("drift")); const od = Math.abs(ours.med("drift"));
  const rs = refs.med("satRatio"); const os = ours.med("satRatio");
  console.log(`Battlefield 2 rotates a material's hue ${rd.toFixed(1)} deg when it enters shadow,`);
  console.log(`and takes its saturation to ${rs.toFixed(2)}x.`);
  console.log(`Ours rotates ${od.toFixed(1)} deg and takes saturation to ${os.toFixed(2)}x.`);
  if (od > rd * 2 && od > 8) {
    console.log("\n-> OUR SHADOWS RECOLOUR THE MATERIAL. The ambient term is not neutral");
    console.log("   with respect to what it is lighting.");
  } else if (os > 1.0 && rs < 1.0) {
    console.log("\n-> our shade SATURATES where the reference desaturates. Same defect,");
    console.log("   read off the saturation axis instead of the hue axis.");
  } else {
    console.log("\n-> inside the reference's behaviour. This is not the defect.");
  }
  console.log("\nper shot, ours (largest rotation first):");
  for (const x of ours.rows.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))) {
    console.log(`  ${x.f.replace(/\.(png|jpe?g)$/, "").padEnd(22)} `
      + `${x.drift >= 0 ? "+" : ""}${x.drift.toFixed(1)} deg   sat x${x.satRatio.toFixed(2)}   n=${x.n}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
