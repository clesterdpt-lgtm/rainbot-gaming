#!/usr/bin/env node
/* ============================================================
   SAINTFALL - ROCK SURFACE METRIC

   Round 7's finding 1, in the judges' own words: "cliffs and
   volcano flanks are BLURRED VERTEX PAINT: no strata, no facet
   break, no micro-detail, occupying 30% of frame at the focal
   point."

   That complaint is about a REGION, not a frame, and the whole
   frame's numbers cannot carry it: the atoll frames are mostly
   sea and sky, and the water shader - which the same judges
   praised - keeps the frame-wide detail statistics respectable
   while the 217 m plug in the middle of the shot is a smooth
   airbrushed gradient. saintfall-shots.mjs would score the round
   6 Cauldron and a photograph of a cliff about the same.

   So this reads ONE RECTANGLE and reports what "surface" means
   as four numbers, at three scales, because "micro-detail that
   survives at 900 m and at 4 m" is a claim about scale:

     sd       luma standard deviation over the crop. How much
              VALUE range the rock carries at all.
     hf1      mean |Laplacian| at a 1 px stencil - the finest
              detail the image can hold. Vertex paint has almost
              none: an interpolated colour is a linear ramp and a
              Laplacian annihilates a linear ramp exactly.
     hf3      the same at a 3 px stencil - the facet / joint scale
              at conversational range.
     hf9      the same at a 9 px stencil - strata and block
              structure, which is the read that has to survive at
              900 m.
     iso      mean |vertical gradient| / mean |horizontal
              gradient|. STRATA ARE THE ONE PLACE THIS SHOULD NOT
              BE 1: horizontal banding puts energy in the vertical
              gradient, so a cliff with bedding on it reads above
              1.0 and a smooth gradient reads at whatever the
              landform's own shading happens to be. Reported so a
              strata claim is falsifiable, not as a target.
     lowP     fraction of crop pixels under luma 45, and highP
              over luma 200. A fractured rock face has crevices and
              catch-lights; an airbrush has neither.

   Usage:
     node scripts/saintfall-rock-metric.mjs IMAGE x0 y0 x1 y1 [label]
       coordinates are FRACTIONS of width/height, 0..1.
     node scripts/saintfall-rock-metric.mjs --preset r7
       runs the authored crop table over a directory (--dir).
   ============================================================ */

import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

/* THE CROPS, and they were read off the frames by eye rather than
   derived, because the thing being measured is "the part of the
   picture the judge was looking at" and no classifier knows that.
   Each one is the largest rectangle that is ENTIRELY rock face -
   no sky, no sea, no canopy - because a crop that catches the
   horizon measures the horizon's contrast and not the rock's. */
const CROPS = {
  /* the Cauldron's flank across the lagoon, ~900 m: the level's
     most important frame and the one the "30% of frame at the
     focal point" sentence is about. */
  "atoll":    [0.055, 0.36, 0.33, 0.70],
  /* the plug from the Landing at ~430 m, the second-worst offender */
  "cauldron": [0.37, 0.50, 0.60, 0.70],
  /* the reef crest / rampart rock in the strand frame */
  "strand":   [0.30, 0.55, 0.70, 0.80],
  "rim":      [0.20, 0.35, 0.80, 0.75],
  "weeping":  [0.25, 0.30, 0.75, 0.80],
  /* Vesper's own rock, for the reference band */
  "scar":         [0.05, 0.55, 0.45, 0.95],
  "saint-face":   [0.30, 0.55, 0.95, 0.95],
  "vista-north":  [0.10, 0.45, 0.90, 0.90],
  "fosse":        [0.10, 0.40, 0.90, 0.90],
};

function lapl(lum, w, h, step) {
  let sum = 0; let n = 0;
  for (let y = step; y < h - step; y += 1) {
    for (let x = step; x < w - step; x += 1) {
      const c = lum[y * w + x];
      const v = Math.abs(4 * c
        - lum[y * w + x - step] - lum[y * w + x + step]
        - lum[(y - step) * w + x] - lum[(y + step) * w + x]);
      sum += v; n += 1;
    }
  }
  return n ? sum / n : 0;
}

async function measure(file, box, label) {
  const img = sharp(file);
  const meta = await img.metadata();
  const x0 = Math.round(box[0] * meta.width);
  const y0 = Math.round(box[1] * meta.height);
  const w = Math.max(8, Math.round((box[2] - box[0]) * meta.width));
  const h = Math.max(8, Math.round((box[3] - box[1]) * meta.height));
  /* removeAlpha() IS LOAD-BEARING. The shots harness writes RGBA
     PNGs, sharp's raw() then hands back four bytes per pixel, and
     a reader striding by three walks a rotating channel phase -
     which produces a fake high-frequency signal an order of
     magnitude above the real one and makes every image score the
     same. The first run of this script did exactly that: hf1, hf3
     and hf9 all came back near 130 on ten different pictures. */
  const { data } = await sharp(file)
    .extract({ left: x0, top: y0, width: w, height: h })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    lum[i] = data[i * 3] * 0.2126 + data[i * 3 + 1] * 0.7152 + data[i * 3 + 2] * 0.0722;
  }
  let sum = 0; let lowP = 0; let highP = 0;
  for (let i = 0; i < n; i += 1) {
    sum += lum[i];
    if (lum[i] < 45) lowP += 1;
    if (lum[i] > 200) highP += 1;
  }
  const mean = sum / n;
  let ss = 0;
  for (let i = 0; i < n; i += 1) ss += (lum[i] - mean) ** 2;
  let gx = 0; let gy = 0; let gn = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      gx += Math.abs(lum[y * w + x + 1] - lum[y * w + x - 1]);
      gy += Math.abs(lum[(y + 1) * w + x] - lum[(y - 1) * w + x]);
      gn += 1;
    }
  }
  return {
    label, size: `${w}x${h}`,
    mean: +mean.toFixed(1),
    sd: +Math.sqrt(ss / n).toFixed(2),
    hf1: +lapl(lum, w, h, 1).toFixed(3),
    hf3: +lapl(lum, w, h, 3).toFixed(3),
    hf9: +lapl(lum, w, h, 9).toFixed(3),
    iso: +(gn ? (gy / gn) / Math.max(1e-6, gx / gn) : 0).toFixed(3),
    lowP: +(100 * lowP / n).toFixed(2),
    highP: +(100 * highP / n).toFixed(2),
  };
}

const argv = process.argv.slice(2);
const rows = [];
if (argv[0] === "--dir") {
  const dir = argv[1];
  const only = argv.slice(2);
  for (const [name, box] of Object.entries(CROPS)) {
    if (only.length && !only.includes(name)) continue;
    const f = path.join(dir, `${name}.png`);
    if (!fs.existsSync(f)) continue;
    rows.push(await measure(f, box, `${path.basename(dir)}/${name}`));
  }
} else {
  const [file, x0, y0, x1, y1, label] = argv;
  rows.push(await measure(file, [+x0, +y0, +x1, +y1], label || path.basename(file)));
}
const cols = ["label", "size", "mean", "sd", "hf1", "hf3", "hf9", "iso", "lowP", "highP"];
console.log(cols.map((c) => c.padStart(c === "label" ? 26 : 8)).join(" "));
for (const r of rows) {
  console.log(cols.map((c) => String(r[c]).padStart(c === "label" ? 26 : 8)).join(" "));
}
