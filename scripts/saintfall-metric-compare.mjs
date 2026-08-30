#!/usr/bin/env node
/* ============================================================
   SAINTFALL - objective metric comparison against the Halo pool

   Measures our boss captures against the DISTRIBUTION the real
   original-Xbox Halo frames actually occupy. Not against absolute
   numbers someone picked: every threshold in this file is computed
   from the reference pool at run time, and the pool moves when
   saintfall-fetch-refs.mjs refreshes it.

   That is deliberate, and it is the lesson
   saintfall-measure-reference.mjs paid for over thirteen flat review
   rounds: thresholds ASSERTED in a comment drove the work away from
   its own reference, because several of them were set such that the
   reference itself would have failed them. A bar you cannot fail is
   not a bar. A bar the reference passes by construction is a bar.

   This does not replace the blind critic. It is the part of "does it
   look right" that CAN be measured, and it is useful precisely
   because it is blind to subject matter: if our frames sit outside
   Halo's distribution on value range, contrast, colour separation or
   surface detail, that is a defect regardless of anyone's taste.

   Usage:
     node scripts/saintfall-metric-compare.mjs --ours output/saintfall/stylite-shots
     node scripts/saintfall-metric-compare.mjs --ours <dir> --refs <dir> --json

   ------------------------------------------------------------
   BOTH SIDES GO THROUGH THE SAME PIPE, LITERALLY

   scripts/blacksand-metric-compare.mjs copy-pasted its crop constant
   out of the blind-compare script next to it, with a comment saying
   the two must match. They are one edit apart from silently
   disagreeing, and the day they do, this harness measures pixels no
   critic was ever shown.

   So the normalisation is IMPORTED from saintfall-blind-compare.mjs -
   the same bar trim, the same per-edge inset, the same cover into the
   same panel, the same JPEG round-trip - and the same pool screen
   drops the CRT photographs and the interlaced capture, whose edge
   density would otherwise put the "surface detail" bar at 80%.

   The JPEG round-trip is applied to OUR shots too, and that is not
   cosmetic. Half the pool is natively JPEG and carries mosquito noise
   on high-contrast edges; ours are lossless PNG. Comparing raw would
   score our renders against a codec and report a detail deficit we do
   not have. Both sides now carry one identical compression signature
   on top of whatever they arrived with.

   ------------------------------------------------------------
   WHAT EACH METRIC IS FOR

   Every one of these answers a specific line in
   docs/saintfall-boss-aaa-brief.md, so a FAIL points at work rather
   than at a number:

     meanLuma       exposure. Context for everything below it.
     rmsContrast    global contrast. The brief's "narrow mid band".
     localContrast  mean per-tile spread - contrast WITHIN a surface,
                    which is what cavity and grime buy you. A frame can
                    have huge global contrast (bright sky, dark boss)
                    and still be plastic up close.
     midBandPct     share of pixels between luma 64 and 160. The
                    brief's complaint stated as a number: "ours never
                    gets dark and never gets bright".
     shadowP01      1st-percentile luma - how dark the frame's darkest
                    real content gets. Halo puts near-black in creases.
     highlightP99   99th-percentile luma - headroom actually used.
     darkPct        share below 26 (crushed).
     brightPct      share above 229 (blown). Both should be non-zero;
                    a frame with neither is the mid-band failure again.
     chromaMean     mean CIELAB chroma. Colour that is there at all.
     chromaSpread   sd of chroma - a frame where everything is equally
                    saturated has no focal point.
     hueFamilies    count of 30-degree hue bins holding at least 6% of
                    the frame's chromatic mass. Axis 7 of the brief:
                    "a frame where boss and background are the same
                    orange is a failed frame". This is that test. Halo
                    CE runs blue creature / grey-green architecture /
                    orange fire and scores 3+.
     edgeDensity    share of pixels with a Sobel gradient over 18.
                    Proxy for surface detail surviving to the screen.
     microDetail    mean |laplacian|. Same question at a finer scale -
                    edgeDensity counts silhouettes and panel lines,
                    microDetail counts grain.

   PASS is the pool's central 80% band (p10..p90), not its full
   min..max. With 28 references a single freak frame widens min..max
   until almost nothing can fail, which is how a harness ends up
   green while the pictures stay bad.
   ============================================================ */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseArgs, listImages, screenPool, panel, CLASS_INSETS, PANEL_W, PANEL_H,
} from "./saintfall-blind-compare.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));

/* sRGB -> linear as a 256-entry table. The naive version calls pow()
   three times per pixel, which is 1.9M pow per panel and turns a
   38-image run into a coffee break. */
const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;
const labF = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

const HUE_BINS = 12;          // 30 degrees each
const HUE_MIN_CHROMA = 8;     // below this the hue angle is noise
const HUE_FAMILY_SHARE = 0.06; // a bin holding 6% of chromatic mass counts

function measurePanel(data) {
  const W = PANEL_W;
  const H = PANEL_H;
  const n = W * H;

  const lum = new Float32Array(n);
  const hist = new Uint32Array(256);
  const hueWeight = new Float64Array(HUE_BINS);

  let sumL = 0;
  let sumC = 0;
  let sumCSq = 0;
  let chromaMass = 0;

  for (let i = 0, p = 0; p < n; i += 3, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
    lum[p] = l;
    sumL += l;
    hist[Math.min(255, l | 0)] += 1;

    const rl = LINEAR[r];
    const gl = LINEAR[g];
    const bl = LINEAR[b];
    const x = labF((rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / XN);
    const y = labF((rl * 0.2126 + gl * 0.7152 + bl * 0.0722) / YN);
    const z = labF((rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / ZN);
    const aStar = 500 * (x - y);
    const bStar = 200 * (y - z);
    const chroma = Math.hypot(aStar, bStar);

    sumC += chroma;
    sumCSq += chroma * chroma;

    if (chroma > HUE_MIN_CHROMA) {
      let hue = Math.atan2(bStar, aStar);
      if (hue < 0) hue += Math.PI * 2;
      const bin = Math.min(HUE_BINS - 1, ((hue / (Math.PI * 2)) * HUE_BINS) | 0);
      hueWeight[bin] += chroma;
      chromaMass += chroma;
    }
  }

  const meanLuma = sumL / n;
  let varL = 0;
  for (let p = 0; p < n; p += 1) {
    const d = lum[p] - meanLuma;
    varL += d * d;
  }
  const rmsContrast = Math.sqrt(varL / n);

  const meanC = sumC / n;
  const chromaSpread = Math.sqrt(Math.max(0, sumCSq / n - meanC * meanC));

  /* Percentiles off the histogram - exact enough at 1-luma resolution
     and far cheaper than sorting 640k floats. */
  const pct = (target) => {
    const want = n * target;
    let acc = 0;
    for (let v = 0; v < 256; v += 1) {
      acc += hist[v];
      if (acc >= want) return v;
    }
    return 255;
  };

  let midBand = 0;
  for (let v = 64; v < 160; v += 1) midBand += hist[v];
  let dark = 0;
  for (let v = 0; v < 26; v += 1) dark += hist[v];
  let bright = 0;
  for (let v = 230; v < 256; v += 1) bright += hist[v];

  /* Local contrast: mean of per-tile standard deviation. 32px tiles at
     this panel size is roughly a shoulder plate - big enough to hold a
     highlight and its cavity, small enough that a bright sky behind a
     dark boss does not count as "surface contrast". */
  const TILE = 32;
  let tileSum = 0;
  let tiles = 0;
  for (let ty = 0; ty + TILE <= H; ty += TILE) {
    for (let tx = 0; tx + TILE <= W; tx += TILE) {
      let s = 0;
      let sq = 0;
      for (let y = 0; y < TILE; y += 1) {
        const row = (ty + y) * W + tx;
        for (let x = 0; x < TILE; x += 1) {
          const v = lum[row + x];
          s += v;
          sq += v * v;
        }
      }
      const m = s / (TILE * TILE);
      tileSum += Math.sqrt(Math.max(0, sq / (TILE * TILE) - m * m));
      tiles += 1;
    }
  }

  let edges = 0;
  let lap = 0;
  let inner = 0;
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + W] - lum[i - W];
      if (Math.hypot(gx, gy) > 18) edges += 1;
      lap += Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - W] - lum[i + W]);
      inner += 1;
    }
  }

  const families = hueWeight.reduce(
    (acc, w) => acc + (chromaMass > 0 && w / chromaMass >= HUE_FAMILY_SHARE ? 1 : 0), 0
  );

  /* Eight-bucket profile, kept alongside the scalars so the shape of
     the histogram can be printed rather than summarised away. */
  const profile = new Array(8).fill(0);
  for (let v = 0; v < 256; v += 1) profile[v >> 5] += hist[v];

  return {
    meanLuma,
    rmsContrast,
    localContrast: tileSum / tiles,
    midBandPct: (midBand / n) * 100,
    shadowP01: pct(0.01),
    highlightP99: pct(0.99),
    darkPct: (dark / n) * 100,
    brightPct: (bright / n) * 100,
    chromaMean: meanC,
    chromaSpread,
    hueFamilies: families,
    edgeDensity: (edges / inner) * 100,
    microDetail: lap / inner,
    profile: profile.map((v) => (v / n) * 100),
  };
}

const KEYS = [
  "meanLuma", "rmsContrast", "localContrast", "midBandPct",
  "shadowP01", "highlightP99", "darkPct", "brightPct",
  "chromaMean", "chromaSpread", "hueFamilies", "edgeDensity", "microDetail",
];

/* What a FAIL means in words, so the table points at work. Direction
   is filled in at print time from the verdict. */
const DIAGNOSIS = {
  meanLuma: { LOW: "underexposed against the pool", HIGH: "washed out against the pool" },
  rmsContrast: { LOW: "flat - the brief's narrow mid band, measured", HIGH: "contrast is louder than Halo's" },
  localContrast: { LOW: "surfaces have no internal variation - no cavity, no grime, no gloss breakup", HIGH: "surface noise is louder than Halo's" },
  midBandPct: { LOW: "more tonal spread than Halo, which is not a defect", HIGH: "too many pixels in the mid band - never gets dark, never gets bright" },
  shadowP01: { LOW: "darker creases than Halo", HIGH: "nothing in the frame is actually dark - no occlusion, no contact" },
  highlightP99: { LOW: "no highlight headroom used - nothing catches the sun", HIGH: "brighter peaks than Halo" },
  darkPct: { LOW: "no crushed blacks at all - shadow has no floor", HIGH: "more crush than Halo" },
  brightPct: { LOW: "nothing blows out - no specular hit, no rim catching light", HIGH: "more blown pixels than Halo" },
  chromaMean: { LOW: "desaturated against the pool", HIGH: "more saturated than the pool" },
  chromaSpread: { LOW: "every surface is equally saturated - no chromatic focal point", HIGH: "chroma varies more than Halo's" },
  hueFamilies: { LOW: "boss and background share a hue family - axis 7 of the brief, failed", HIGH: "more hue families than Halo" },
  edgeDensity: { LOW: "under-detailed - not enough survives to the screen", HIGH: "busier than Halo" },
  microDetail: { LOW: "no sub-facet grain - the untextured-model tell", HIGH: "more grain than Halo" },
};

function summarise(rows) {
  const out = {};
  for (const k of KEYS) {
    const vals = rows.map((r) => r[k]).sort((a, b) => a - b);
    const at = (q) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(q * (vals.length - 1))))];
    out[k] = {
      min: vals[0],
      p10: at(0.10),
      p50: at(0.50),
      p90: at(0.90),
      max: vals[vals.length - 1],
      mean: vals.reduce((a, v) => a + v, 0) / vals.length,
    };
  }
  out.profile = new Array(8).fill(0).map(
    (_, i) => rows.reduce((a, r) => a + r.profile[i], 0) / rows.length
  );
  return out;
}

/* Two decimals is not enough at the bottom of the brightPct column:
   the pool's minimum blown-highlight share is 0.004%, ours is exactly
   zero, and both print as "0.00", which reads as a harness bug rather
   than as the finding it is - nothing in our frames blows out at all. */
const fmt = (v) => {
  if (v === 0) return "0";
  if (Math.abs(v) < 1) return Number(v.toPrecision(2)).toString();
  if (Math.abs(v) >= 100) return v.toFixed(0);
  return v.toFixed(v < 10 ? 2 : 1);
};

function bar(pct, scale) {
  const n = Math.round((pct / scale) * 22);
  return "#".repeat(Math.max(0, Math.min(22, n))).padEnd(22, ".");
}

async function main() {
  const oursDir = path.resolve(root, args.ours || "output/saintfall/stylite-shots");
  const refsDir = path.resolve(root, args.refs || "output/reference/halo");

  const ourFiles = await listImages(oursDir);
  const refFiles = await listImages(refsDir);
  if (!ourFiles.length) throw new Error(`no images in ${oursDir}`);
  if (!refFiles.length) throw new Error(`no images in ${refsDir}`);

  console.log(`screening ${refFiles.length} references in ${path.relative(root, refsDir)}`);
  const refs = await screenPool(refFiles);
  console.log(`  ${refs.length} usable\n`);

  /* Our shots are measured through the CLEAN inset. That is the crop a
     blind round uses for them in every pair whose reference is
     HUD-free, which is every pair a normal round builds. */
  const ours = [];
  for (const file of ourFiles) {
    const { data } = await panel(file, CLASS_INSETS.clean, { raw: true });
    ours.push({ file: path.basename(file), ...measurePanel(data) });
  }
  const pool = [];
  for (const ref of refs) {
    const { data } = await panel(ref.file, CLASS_INSETS[ref.cls] || CLASS_INSETS.clean, { raw: true });
    pool.push({ file: ref.base, ...measurePanel(data) });
  }

  const O = summarise(ours);
  const P = summarise(pool);

  console.log(`--- OURS: ${path.relative(root, oursDir)} (${ours.length} shots) ---`);
  for (const r of ours) {
    console.log(
      `${r.file.replace(/\.png$/i, "").padEnd(18)}`
      + ` luma ${fmt(r.meanLuma).padStart(6)}`
      + `  rms ${fmt(r.rmsContrast).padStart(5)}`
      + `  local ${fmt(r.localContrast).padStart(5)}`
      + `  hues ${String(r.hueFamilies).padStart(2)}`
      + `  edge% ${fmt(r.edgeDensity).padStart(5)}`
      + `  dark% ${fmt(r.darkPct).padStart(5)}`
      + `  blown% ${fmt(r.brightPct).padStart(5)}`
    );
  }

  console.log("\n--- luminance histogram, mean share per 32-luma bucket ---");
  const scale = Math.max(...O.profile, ...P.profile);
  console.log(`${"bucket".padEnd(10)} ${"OURS".padEnd(30)} HALO`);
  for (let i = 0; i < 8; i += 1) {
    const lo = i * 32;
    console.log(
      `${`${lo}-${lo + 31}`.padEnd(10)} ${bar(O.profile[i], scale)} ${O.profile[i].toFixed(1).padStart(5)}%   `
      + `${bar(P.profile[i], scale)} ${P.profile[i].toFixed(1).padStart(5)}%`
    );
  }

  console.log("\n--- distribution comparison (identical crop, resample and JPEG round-trip) ---");
  console.log(
    `${"metric".padEnd(14)} ${"OURS med".padStart(9)} ${"(min-max)".padStart(15)}`
    + ` ${"HALO mean".padStart(10)} ${"pass band p10-p90".padStart(19)}`
    + ` ${"(pool range)".padStart(15)}  verdict`
  );

  const failures = [];
  for (const k of KEYS) {
    const o = O[k];
    const p = P[k];
    let verdict = "PASS";
    if (o.p50 < p.p10) verdict = "LOW";
    else if (o.p50 > p.p90) verdict = "HIGH";
    if (verdict !== "PASS") failures.push({ k, verdict });
    console.log(
      `${k.padEnd(14)} ${fmt(o.p50).padStart(9)} ${`(${fmt(o.min)}-${fmt(o.max)})`.padStart(15)}`
      + ` ${fmt(p.mean).padStart(10)} ${`${fmt(p.p10)} - ${fmt(p.p90)}`.padStart(19)}`
      + ` ${`(${fmt(p.min)}-${fmt(p.max)})`.padStart(15)}  ${verdict === "PASS" ? "pass" : verdict + " **"}`
    );
  }

  console.log(`\n--- ${failures.length} of ${KEYS.length} metrics outside Halo's central 80% ---`);
  if (!failures.length) {
    console.log("  none - our median sits inside the Halo band on every axis.");
  } else {
    for (const f of failures) {
      console.log(`  ${f.verdict.padEnd(4)} ${f.k.padEnd(14)} ${DIAGNOSIS[f.k][f.verdict]}`);
    }

    /* Not every FAIL is work. The pool is what Halopedia had, and what
       it had is mostly Covenant interiors and night exteriors - pool
       mean luma sits near 58. Vesper-IX is a lit desert. Being above
       that band on meanLuma or chromaMean is a statement about the
       pool's subject mix, not a defect, and "fixing" it by darkening
       the sand would be the harness driving the art - exactly the
       failure saintfall-measure-reference.mjs was written to end.

       The axes that are NOT explainable that way are the value-range
       ones (shadowP01, darkPct, brightPct: a frame can be bright and
       still put black in its creases and blow a specular) and the
       detail ones (edgeDensity, microDetail, localContrast). Those are
       the work. */
    const exposureOnly = new Set(["meanLuma", "chromaMean"]);
    const real = failures.filter((f) => !exposureOnly.has(f.k));
    if (real.length !== failures.length) {
      console.log(
        "\n  reading this: the pool skews dark and desaturated (interiors and night, mean"
        + `\n  luma ${fmt(P.meanLuma.mean)}). meanLuma / chromaMean sitting above it is Vesper-IX being a lit`
        + "\n  desert, not a defect - do not darken the sand to satisfy a histogram."
        + `\n  The ${real.length} actionable failure(s): ${real.map((f) => f.k).join(", ") || "none"}.`
      );
    }
  }

  console.log("\n--- per shot, axes outside the pool's FULL range (worse than any Halo frame) ---");
  let flagged = 0;
  for (const r of ours) {
    const notes = [];
    for (const k of KEYS) {
      if (r[k] < P[k].min) notes.push(`${k} ${fmt(r[k])} < ${fmt(P[k].min)}`);
      else if (r[k] > P[k].max) notes.push(`${k} ${fmt(r[k])} > ${fmt(P[k].max)}`);
    }
    if (notes.length) { flagged += 1; console.log(`  ${r.file}: ${notes.join(", ")}`); }
  }
  if (!flagged) console.log("  none - every shot is inside the pool's full range on every axis.");

  if (args.json) {
    console.log(`\n${JSON.stringify({ ours: O, halo: P, failures }, null, 2)}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
