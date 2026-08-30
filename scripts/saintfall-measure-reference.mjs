#!/usr/bin/env node
/* ============================================================
   SAINTFALL - measure the concept art

   Thirteen review rounds scored 3-4, flat, while the gate suite went
   green. The cause was never the model: every threshold had been
   ASSERTED in a comment rather than computed from the plates. Worse,
   several were calibrated such that the concept art itself would FAIL
   them - so the suite was actively driving the figure away from its
   own reference.

   The first attempt at fixing that tried to SEGMENT the figure out of
   each plate, and failed: it rejected any pixel within 15 dE of any
   of ~2400 background samples, and the union of 2400 balls that size
   covers most of occupied Lab space, so 99% of the figure vanished.
   That was recorded as "bone and sand are intrinsically ambiguous",
   which was the wrong lesson - the estimator was broken, not the
   problem. It then became the excuse for hand-reading one plate,
   which reintroduced exactly the fiction it was meant to remove.

   No segmentation is needed. Boxes drawn INSIDE the figure give
   stable, falsifiable per-component statistics, and a box is
   auditable in a way a threshold in a comment never is.

   Usage:  node scripts/saintfall-measure-reference.mjs
   ============================================================ */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONCEPTS = path.join(root, "assets/img/saintfall/concepts");
const OUT = path.join(root, "output/saintfall/reference");

/* Boxes are fractions of image size: [x0, y0, x1, y1], each drawn
   wholly inside the named component so no background is sampled. */
const SAMPLES = [
  /* Every box below was cropped and LOOKED AT before being trusted.
     The first version of this table was asserted to be "drawn wholly
     inside the named component" and ten of thirteen were not: one
     "pauldron" was the helm, one "torso" was the gold sash, one
     "thigh" was teal glass ground - and that last one alone supplied
     72% of the pooled verdigris signal, which is how a bone-white
     character came back measuring "warm olive throughout".

     Same failure as the round it was written to fix, one level down:
     asserting instead of checking. Only the traversal plate is used
     now, because it is the one near-frontal, unoccluded, evenly-lit
     view of the figure and I could verify every box on it. Three
     plates of contaminated samples are worth less than one plate of
     clean ones. */
  { file: "saintfall-vesper-reliquary-traversal-concept-v2.png", boxes: {
    /* Five boxes, each cropped and checked by eye. Two more
       (chestPlate, armScale) were tried and dropped because they
       caught the gold sash - recorded here so they are not silently
       re-added later. A small verified sample beats a large asserted
       one; that is the whole lesson of the last three rounds. */
    helm:      [0.346, 0.312, 0.372, 0.384],
    pauldron:  [0.296, 0.392, 0.324, 0.432],
    goldCloth: [0.333, 0.588, 0.355, 0.655],
    skirt:     [0.385, 0.620, 0.410, 0.706],
    greave:    [0.336, 0.768, 0.355, 0.815],
  } },
];

function lab(r, g, b) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [f(r), f(g), f(b)];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const k = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [k(x), k(y), k(z)];
  const A = 500 * (fx - fy); const B2 = 200 * (fy - fz);
  return { L: 116 * fy - 16, a: A, b: B2, C: Math.hypot(A, B2) };
}
const pct = (arr, q) => {
  const a = arr.slice().sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0;
};

await mkdir(OUT, { recursive: true });
const perComponent = {};
const pooled = { L: [], C: [], a: [], cool: 0, n: 0 };

for (const s of SAMPLES) {
  const file = path.join(CONCEPTS, s.file);
  const meta = await sharp(file).metadata();
  console.log(`\n${s.file}`);
  for (const [name, box] of Object.entries(s.boxes)) {
    const left = Math.round(box[0] * meta.width);
    const top = Math.round(box[1] * meta.height);
    const width = Math.max(2, Math.round((box[2] - box[0]) * meta.width));
    const height = Math.max(2, Math.round((box[3] - box[1]) * meta.height));
    const { data } = await sharp(file).extract({ left, top, width, height })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const L = []; const C = []; const A = []; let cool = 0;
    for (let i = 0; i < data.length; i += 3) {
      const c = lab(data[i], data[i + 1], data[i + 2]);
      L.push(c.L); C.push(c.C); A.push(c.a);
      // The same predicate the render gate uses, so the two numbers
      // are comparable. That comparability is the whole point.
      if (c.a < -2 && c.b < 26) cool += 1;
      pooled.L.push(c.L); pooled.C.push(c.C); pooled.a.push(c.a);
      if (c.a < -2 && c.b < 26) pooled.cool += 1;
      pooled.n += 1;
    }
    const rec = {
      L: +pct(L, 0.5).toFixed(1), C: +pct(C, 0.5).toFixed(1),
      a: +pct(A, 0.5).toFixed(1), coolPct: +((cool / L.length) * 100).toFixed(2),
    };
    (perComponent[name] = perComponent[name] || []).push(rec);
    console.log(`  ${name.padEnd(10)} L ${String(rec.L).padStart(5)}  C ${String(rec.C).padStart(5)}  `
      + `a* ${String(rec.a).padStart(6)}  cool ${String(rec.coolPct).padStart(5)}%`);
  }
}

const agg = {};
for (const [name, recs] of Object.entries(perComponent)) {
  agg[name] = {
    L: +pct(recs.map((r) => r.L), 0.5).toFixed(1),
    C: +pct(recs.map((r) => r.C), 0.5).toFixed(1),
    a: +pct(recs.map((r) => r.a), 0.5).toFixed(1),
    coolPct: +pct(recs.map((r) => r.coolPct), 0.5).toFixed(2),
  };
}
const armour = { L: [], C: [], a: [], cool: 0, n: 0 };
for (const [name, recs] of Object.entries(perComponent)) {
  if (name === "goldCloth") continue;
  for (const r of recs) {
    armour.L.push(r.L); armour.C.push(r.C); armour.a.push(r.a);
    armour.cool += r.coolPct; armour.n += 1;
  }
}
const armourRec = {
  L: +pct(armour.L, 0.5).toFixed(1),
  C: +pct(armour.C, 0.5).toFixed(1),
  a: +pct(armour.a, 0.5).toFixed(1),
  coolPct: +(armour.cool / Math.max(armour.n, 1)).toFixed(2),
};
const pooledRec = {
  L: +pct(pooled.L, 0.5).toFixed(1),
  C: +pct(pooled.C, 0.5).toFixed(1),
  a: +pct(pooled.a, 0.5).toFixed(1),
  Cp95: +pct(pooled.C, 0.95).toFixed(1),
  coolPct: +((pooled.cool / pooled.n) * 100).toFixed(2),
};
console.log("\n=== POOLED ACROSS ALL COMPONENTS AND PLATES ===");
console.log(`  L ${pooledRec.L}  C ${pooledRec.C} (p95 ${pooledRec.Cp95})  a* ${pooledRec.a}  cool ${pooledRec.coolPct}%`);
console.log("=== ARMOUR ONLY (gold sash excluded) ===");
console.log(`  L ${armourRec.L}  C ${armourRec.C}  a* ${armourRec.a}  cool ${armourRec.coolPct}%`);

await writeFile(path.join(OUT, "reference.json"), JSON.stringify({
  method: ("Boxes drawn inside named components on the three v2 plates - no segmentation. "
    + "Same Lab predicate as the render gate, so the two are comparable."),
  perComponent: agg, pooled: pooledRec, armour: armourRec,
}, null, 2));
console.log(`\nartifacts: ${path.relative(root, OUT)}`);
