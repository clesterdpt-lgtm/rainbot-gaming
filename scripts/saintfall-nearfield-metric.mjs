#!/usr/bin/env node
/* ============================================================
   SAINTFALL - NEAR-FIELD METRIC

   Round 5's judge 1 named one defect as a shape rather than as a
   value: "the closest ten metres of the frame has the LEAST
   information in the shot", and "let the ground get MORE detailed
   as it approaches camera, not less".

   That is a claim about how detail varies DOWN the frame, and no
   whole-frame number can carry it. saintfall-shots.mjs prints one
   luma / sd / edge per image; a frame whose near field is a smooth
   tan sheet and whose middle band is busy scores the same as its
   opposite.

   So this cuts the lower part of the frame into three horizontal
   strips and reports each one separately:

     far    0.58 .. 0.72 of frame height   ~ 25 m and beyond
     mid    0.72 .. 0.86                   ~ 10 to 25 m
     near   0.86 .. 1.00                   ~ under 10 m, the strip
                                             judge 1 is pointing at

   Per strip:
     sd     luma standard deviation - how much VALUE range is in it
     hf     mean |Laplacian| at one pixel - FINE detail energy. A
            long smooth streak has almost none: it is smooth along
            its own length, which is most of its pixels.
     gy/gx  mean |vertical gradient| over mean |horizontal gradient|.
            A field of long lines running to a vanishing point in
            the lower frame is broadly banded, so gy runs well
            above gx. Dressed ground - stones, wrack, contact
            shadows - has no preferred direction and sits near 1.
     dark   fraction of pixels under luma 45. Contact shadows live
            here and a beach with nothing on it has none.

   THE SHAPE IS THE READING, not any single number: hf should RISE
   from far to near. On antiphon-r5 it falls.
   ============================================================ */

import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const STRIPS = [
  ["far", 0.58, 0.72],
  ["mid", 0.72, 0.86],
  ["near", 0.86, 1.00],
];

export async function nearFieldMetric(file) {
  const { data, info } = await sharp(file)
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const L = new Float32Array(W * H);
  for (let i = 0, p = 0; i < L.length; i += 1, p += C) {
    L[i] = data[p] * 0.2126 + data[p + 1] * 0.7152 + data[p + 2] * 0.0722;
  }
  const out = { file: path.basename(file), strips: {} };
  for (const [name, a, b] of STRIPS) {
    const y0 = Math.max(1, Math.floor(a * H));
    const y1 = Math.min(H - 1, Math.floor(b * H));
    let n = 0, sum = 0, sum2 = 0, hf = 0, gx = 0, gy = 0, dark = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = 1; x < W - 1; x += 1) {
        const i = y * W + x;
        const v = L[i];
        sum += v; sum2 += v * v; n += 1;
        if (v < 45) dark += 1;
        const dx = L[i + 1] - L[i - 1];
        const dy = L[i + W] - L[i - W];
        gx += Math.abs(dx); gy += Math.abs(dy);
        hf += Math.abs(v - (L[i - 1] + L[i + 1] + L[i - W] + L[i + W]) * 0.25);
      }
    }
    const mean = sum / n;
    out.strips[name] = {
      luma: +mean.toFixed(1),
      sd: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(1),
      hf: +(hf / n).toFixed(3),
      gx: +(gx / n).toFixed(3),
      gy: +(gy / n).toFixed(3),
      aniso: +((gy / n) / Math.max(1e-4, gx / n)).toFixed(2),
      dark: +(100 * dark / n).toFixed(1),
    };
  }
  const s = out.strips;
  /* THE GRADIENT THAT IS THE WHOLE COMPLAINT. Above 1.0 the ground
     gains detail as it comes toward the lens, which is what judge 1
     asked for; below 1.0 it loses it. */
  out.detailSlope = +(s.near.hf / Math.max(1e-4, s.far.hf)).toFixed(2);
  return out;
}

function fmt(m) {
  const r = (k) => {
    const s = m.strips[k];
    return `${k.padEnd(4)} luma ${String(s.luma).padStart(5)}  sd ${String(s.sd).padStart(5)}`
      + `  hf ${String(s.hf).padStart(6)}  gx ${String(s.gx).padStart(6)}`
      + `  gy ${String(s.gy).padStart(6)}  aniso ${String(s.aniso).padStart(5)}`
      + `  dark% ${String(s.dark).padStart(5)}`;
  };
  return `${m.file}\n  ${r("far")}\n  ${r("mid")}\n  ${r("near")}`
    + `\n  detailSlope(near/far hf) ${m.detailSlope}`;
}

const files = process.argv.slice(2).flatMap((a) => (
  fs.statSync(a).isDirectory()
    ? fs.readdirSync(a).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(a, f))
    : [a]
));
if (files.length) {
  const all = [];
  for (const f of files) { const m = await nearFieldMetric(f); all.push(m); console.log(fmt(m)); }
  const avg = (k, s) => (all.reduce((t, m) => t + m.strips[s][k], 0) / all.length).toFixed(3);
  console.log(`\nMEAN over ${all.length}: `
    + `hf far ${avg("hf", "far")} mid ${avg("hf", "mid")} near ${avg("hf", "near")}`
    + ` | near sd ${avg("sd", "near")} aniso ${avg("aniso", "near")} dark% ${avg("dark", "near")}`
    + ` | detailSlope ${(all.reduce((t, m) => t + m.detailSlope, 0) / all.length).toFixed(2)}`);
}
