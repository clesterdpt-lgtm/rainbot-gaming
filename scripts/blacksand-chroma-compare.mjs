#!/usr/bin/env node
/* ============================================================
   BLACKSAND - where does the colour live, lit or shaded?

   Six rounds of art directors have said some version of "shaded
   surfaces lose their material identity and go grey". Every one of
   them named a mechanism in the AMBIENT term, and the grounding probe
   just measured the opposite: our shade carries 186% of the saturation
   our LIT surfaces do. The chroma is not missing from the shadows. It
   is missing from the sunlight.

   That is a different bug with a different fix, so before acting on it
   this asks the only authority that settles it: in real Battlefield 2
   frames, is sunlit ground more saturated than shaded ground, or less?

   Method, identical on both sides:
     - crop to the same band the blind harness shows the reviewer, which
       is mostly ground and building and almost never sky
     - split into a lit and a shaded population by two-means on LOG
       luminance, because a lighting ratio is a ratio
     - report mean saturation and hue of each population, and the
       lit:shade saturation ratio

   Usage:
     node scripts/blacksand-chroma-compare.mjs --ours output/blacksand-shots/critic-6b
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

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function sat(r, g, b) {
  const mx = Math.max(r, g, b);
  return mx > 1e-6 ? (mx - Math.min(r, g, b)) / mx : 0;
}

function hue(r, g, b) {
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
  if (d < 1e-6) return 0;
  let h;
  if (mx === r) h = 60 * (((g - b) / d) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return h < 0 ? h + 360 : h;
}

async function measure(file) {
  const meta = await sharp(file).metadata();
  const { data } = await sharp(file)
    .extract({
      left: Math.round(meta.width * CROP.x0),
      top: Math.round(meta.height * CROP.y0),
      width: Math.round(meta.width * (CROP.x1 - CROP.x0)),
      height: Math.round(meta.height * (CROP.y1 - CROP.y0)),
    })
    .resize(360, 140, { fit: "cover" })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });

  const px = [];
  for (let i = 0; i < data.length; i += 3) {
    const r = toLinear(data[i]); const g = toLinear(data[i + 1]); const b = toLinear(data[i + 2]);
    px.push([r, g, b, 0.2126 * r + 0.7152 * g + 0.0722 * b]);
  }
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
  const side = (wantShade) => {
    let s = 0; let hx = 0; let hy = 0; let v = 0; let n = 0;
    for (const p of px) {
      const isShade = Math.abs(L(p[3]) - L(lo)) < Math.abs(L(p[3]) - L(hi));
      if (isShade !== wantShade) continue;
      const st = sat(p[0], p[1], p[2]);
      const h = (hue(p[0], p[1], p[2]) * Math.PI) / 180;
      // Average hue on the circle, weighted by saturation - an
      // unweighted mean of degrees is meaningless near the wrap point
      // and lets near-grey pixels vote on the hue as loudly as a
      // strongly coloured one.
      s += st; hx += Math.cos(h) * st; hy += Math.sin(h) * st; v += p[3]; n += 1;
    }
    if (!n) return null;
    let h = (Math.atan2(hy, hx) * 180) / Math.PI;
    if (h < 0) h += 360;
    return { s: s / n, h, v: v / n, n };
  };
  const lit = side(false); const shade = side(true);
  if (!lit || !shade) return null;
  return { lit, shade, satRatio: lit.s / Math.max(shade.s, 1e-4), lumRatio: hi / Math.max(lo, 1e-5) };
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
  const m = {
    litS: med(rows.map((r) => r.lit.s)),
    shadeS: med(rows.map((r) => r.shade.s)),
    litH: med(rows.map((r) => r.lit.h)),
    shadeH: med(rows.map((r) => r.shade.h)),
    satRatio: med(rows.map((r) => r.satRatio)),
  };
  console.log(`${label.padEnd(16)} n=${String(rows.length).padStart(3)}   `
    + `lit  sat ${m.litS.toFixed(3)} hue ${m.litH.toFixed(0).padStart(3)}   `
    + `shade  sat ${m.shadeS.toFixed(3)} hue ${m.shadeH.toFixed(0).padStart(3)}   `
    + `lit:shade sat ${m.satRatio.toFixed(2)}`);
  return { rows, m };
}

async function main() {
  const refs = await run(args.refs || "output/reference/bf2", "BATTLEFIELD 2");
  const ours = await run(args.ours || "output/blacksand-shots/latest", "OURS");

  console.log("");
  const rr = refs.m.satRatio; const or = ours.m.satRatio;
  console.log(`Battlefield 2 sunlit ground is ${rr.toFixed(2)}x the saturation of its shade.`);
  console.log(`Ours is             ${or.toFixed(2)}x.`);
  if (rr > 1 && or < 1) {
    console.log("\n-> INVERTED. The reference puts its colour in the sunlight and lets");
    console.log("   shade fall towards neutral. We do the exact opposite: our lit");
    console.log("   surfaces wash out and our shadows carry the chroma. Every reviewer");
    console.log("   who called this 'shade going grey' was reading the same inversion");
    console.log("   from the other end.");
  } else if (Math.abs(Math.log(or / rr)) < 0.18) {
    console.log("\n-> matched within 20%. This is not the defect.");
  } else {
    console.log(`\n-> ours is ${(or / rr).toFixed(2)}x the reference's ratio.`);
  }

  console.log(`\nlit saturation: reference ${refs.m.litS.toFixed(3)} vs ours ${ours.m.litS.toFixed(3)}`
    + `  (${(ours.m.litS / refs.m.litS).toFixed(2)}x)`);
  console.log(`shade saturation: reference ${refs.m.shadeS.toFixed(3)} vs ours ${ours.m.shadeS.toFixed(3)}`
    + `  (${(ours.m.shadeS / refs.m.shadeS).toFixed(2)}x)`);

  console.log("\nper shot, ours (lit sat / shade sat):");
  for (const x of ours.rows.sort((a, b) => a.satRatio - b.satRatio)) {
    console.log(`  ${x.f.replace(/\.(png|jpe?g)$/, "").padEnd(22)} `
      + `${x.lit.s.toFixed(3)} / ${x.shade.s.toFixed(3)}   ratio ${x.satRatio.toFixed(2)}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
