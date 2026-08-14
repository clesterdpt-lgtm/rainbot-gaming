#!/usr/bin/env node
/* ============================================================
   APOP DEMON MOGGERS 3D - image metrics gate

   Measures our captured frames against the real Super Mario 64
   reference pool on the four properties a blind art critic has twice
   named as the reason we lose. Running this is far cheaper than a
   review round and it fails loudly, so art changes can be checked
   between reviews instead of only at them.

   Usage:
     node scripts/apop3d-metrics.mjs
     node scripts/apop3d-metrics.mjs --ours output/apop3d-shots/floor-check
     node scripts/apop3d-metrics.mjs --json

   ------------------------------------------------------------
   WHAT IS MEASURED AND WHY

   1. SQUINT VALUE RANGE. Downsample hard (24px on the long edge) and
      take P95 minus P5 of luminance. This is the "squint test" that
      art directors do by eye: at that scale detail is gone and only
      the big value masses remain. A frame that collapses to one grey
      mush scores low no matter how much geometry is in it.
      SM64 pool: ~123. Ours at the last review: 91.

   2. SQUINT P5 - THE DARKS. The darkest 5% of the squinted frame.
      SM64 sits at 2-11: it has real blacks. Ours sat at 18-45, i.e.
      nothing in frame was ever actually dark, which is why nothing
      ever popped against anything.

   3. HIGH-FREQUENCY ENERGY. Mean absolute Laplacian at full
      resolution. This catches surfaces that vibrate at pixel scale -
      confetti terrazzo, aliasing checkerboards, moire on a stair
      mesh. It is the noise that was drowning our subject.
      SM64 pool: ~5.5. Ours: 15.6, with one frame at 20.9.

   4. SATURATION. Mean HSV S. SM64 is confident colour at ~0.52; we
      were muddy at 0.35.

   The reference numbers are computed from the pool on every run, not
   hard-coded, so the bar moves if the pool does.
   ============================================================ */

import { readdir, writeFile } from "node:fs/promises";
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
const OURS_DIR = path.resolve(root, args.ours || "output/apop3d-shots/latest");
const REFS_DIR = path.resolve(root, args.refs || "output/reference/sm64");

/* The crop must match the blind-compare harness, or the numbers
   describe a different picture from the one being reviewed: the
   references carry a burned-in N64 HUD that would otherwise dominate
   both the darks and the high-frequency score. */
const CROP = { x0: 0.04, x1: 0.96, y0: 0.155, y1: 0.845 };

const SQUINT = 24;      // long edge, in pixels, for the value-mass test
const WORK = 480;       // long edge for the high-frequency test

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[i];
}

async function cropped(file) {
  const meta = await sharp(file).metadata();
  const left = Math.round(meta.width * CROP.x0);
  const top = Math.round(meta.height * CROP.y0);
  const width = Math.max(8, Math.round(meta.width * (CROP.x1 - CROP.x0)));
  const height = Math.max(8, Math.round(meta.height * (CROP.y1 - CROP.y0)));
  return sharp(file).extract({ left, top, width, height });
}

async function measure(file) {
  // --- squint: value masses ---
  const sq = await (await cropped(file))
    .resize(SQUINT, SQUINT, { fit: "fill", kernel: "cubic" })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = [];
  for (let i = 0; i < sq.data.length; i += 3) {
    lum.push(0.2126 * sq.data[i] + 0.7152 * sq.data[i + 1] + 0.0722 * sq.data[i + 2]);
  }
  lum.sort((a, b) => a - b);
  const p5 = percentile(lum, 0.05);
  const p95 = percentile(lum, 0.95);

  // --- full-res-ish: high frequency and saturation ---
  const w = await (await cropped(file))
    .resize(WORK, null, { fit: "inside" })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: ww, height: hh } = w.info;
  const g = new Float32Array(ww * hh);
  let satSum = 0;
  for (let i = 0, p = 0; i < w.data.length; i += 3, p += 1) {
    const r = w.data[i], gg = w.data[i + 1], b = w.data[i + 2];
    g[p] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    satSum += mx === 0 ? 0 : (mx - mn) / mx;
  }
  // 4-neighbour Laplacian. Interior only, so the crop edge does not
  // register as an enormous gradient.
  let hf = 0, n = 0;
  for (let y = 1; y < hh - 1; y += 1) {
    for (let x = 1; x < ww - 1; x += 1) {
      const i = y * ww + x;
      hf += Math.abs(4 * g[i] - g[i - 1] - g[i + 1] - g[i - ww] - g[i + ww]);
      n += 1;
    }
  }
  return {
    file: path.basename(file),
    range: +(p95 - p5).toFixed(1),
    p5: +p5.toFixed(1),
    hf: +(hf / Math.max(1, n)).toFixed(1),
    sat: +(satSum / (w.data.length / 3)).toFixed(3),
  };
}

/**
 * Subject-local contrast, from a subject-hidden companion frame.
 *
 * This exists because the four aggregate rows are global histogram
 * statistics and cannot see WHERE values sit. A blind reviewer scored
 * this build at 33% while every aggregate row read "at reference
 * level": one frame passed the value-range row with a black bottom
 * half and its subject hidden behind a crate, and its catastrophic
 * darks were averaged away across the set.
 *
 * Differencing frame against companion gives an exact silhouette mask.
 * From that: the subject's median luminance, the median of the annulus
 * immediately around it, and the signed delta. Sorting that reviewer's
 * wins from its losses, this delta - and the CONSISTENCY of its sign -
 * was the discriminator. Both wins put the subject as the darkest mass
 * against the lightest local field.
 */
async function subjectContrast(file) {
  const companion = file.replace(/\.png$/i, ".nosubject.png");
  let a, b;
  try {
    a = await (await cropped(file)).resize(WORK, null, { fit: "inside" })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    b = await (await cropped(companion)).resize(WORK, null, { fit: "inside" })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (_) {
    return null;   // no companion frame; older capture
  }
  if (a.data.length !== b.data.length) return null;
  const { width: w, height: h } = a.info;
  const lumA = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  let count = 0;
  for (let i = 0, p = 0; i < a.data.length; i += 3, p += 1) {
    lumA[p] = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2];
    const d = Math.abs(a.data[i] - b.data[i])
      + Math.abs(a.data[i + 1] - b.data[i + 1])
      + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > 24) { mask[p] = 1; count += 1; }
  }
  if (count < 40) return { fraction: 0, subject: 0, annulus: 0, delta: 0, thin: true };

  // Dilate the mask a few times; the ring between the original and the
  // dilated edge is the field the subject is actually read against.
  let ring = new Uint8Array(mask);
  for (let pass = 0; pass < 12; pass += 1) {
    const next = new Uint8Array(ring);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        if (ring[i]) continue;
        if (ring[i - 1] || ring[i + 1] || ring[i - w] || ring[i + w]) next[i] = 1;
      }
    }
    ring = next;
  }
  const subj = [], annu = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) subj.push(lumA[i]);
    else if (ring[i]) annu.push(lumA[i]);
  }
  subj.sort((x, y) => x - y);
  annu.sort((x, y) => x - y);
  const med = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : 0);
  const sm = med(subj), am = med(annu);
  return {
    // AREA fraction of the frame, not height. A slim figure at ~23%
    // of frame height covers only ~1.5% of its area; the useful signal
    // is comparing shots, where a subject that is small OR occluded
    // drops sharply (0.4% on a frame whose subject sat behind a crate).
    fraction: +(count / (w * h)).toFixed(4),
    subject: +sm.toFixed(1),
    annulus: +am.toFixed(1),
    delta: +(sm - am).toFixed(1),
  };
}

async function listImages(dir) {
  const entries = await readdir(dir);
  return entries.filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith("_") && !f.includes(".nosubject."))
    .sort().map((f) => path.join(dir, f));
}

function summarise(rows) {
  const avg = (k) => +(rows.reduce((s, r) => s + r[k], 0) / Math.max(1, rows.length)).toFixed(1);
  return { range: avg("range"), p5: avg("p5"), hf: avg("hf"), sat: +(rows.reduce((s, r) => s + r.sat, 0) / Math.max(1, rows.length)).toFixed(3) };
}

async function main() {
  const ourFiles = await listImages(OURS_DIR);
  const refFiles = await listImages(REFS_DIR);
  if (!ourFiles.length) throw new Error(`no images in ${OURS_DIR}`);
  if (!refFiles.length) throw new Error(`no reference images in ${REFS_DIR}`);

  const ours = [];
  for (const f of ourFiles) {
    const m = await measure(f);
    m.subj = await subjectContrast(f);
    ours.push(m);
  }
  const refs = [];
  for (const f of refFiles) refs.push(await measure(f));

  const o = summarise(ours);
  const r = summarise(refs);

  if (args.json) {
    process.stdout.write(JSON.stringify({ ours: o, refs: r, perShot: ours }, null, 2) + "\n");
    return;
  }

  process.stdout.write(`\nMETRICS  ${path.relative(root, OURS_DIR)}  (${ours.length} shots)`);
  process.stdout.write(`  vs  ${path.relative(root, REFS_DIR)} (${refs.length} refs)\n`);
  process.stdout.write("".padEnd(70, "-") + "\n");
  const line = (name, a, b, better) => {
    const ok = better(a, b);
    process.stdout.write(`  ${name.padEnd(22)} ours ${String(a).padStart(7)}   SM64 ${String(b).padStart(7)}   ${ok ? "ok" : "MISS"}\n`);
  };
  // Value range and saturation want to reach the reference; darks and
  // high frequency want to come DOWN to it.
  line("squint value range", o.range, r.range, (a, b) => a >= b * 0.92);
  line("squint P5 (darks)", o.p5, r.p5, (a, b) => a <= b * 1.6);
  line("high-freq energy", o.hf, r.hf, (a, b) => a <= b * 1.35);
  line("saturation", o.sat, r.sat, (a, b) => a >= b * 0.9);
  process.stdout.write("".padEnd(70, "-") + "\n");
  /* Per-shot, with outliers flagged.
     A mean hides the frame that loses the round: one shot passed the
     aggregate while its own darks sat at 10 against a pool of 46. Any
     row more than 40% off the reference is marked, so a single bad
     frame cannot be averaged away by good ones. */
  const off = (a, b) => Math.abs(a - b) / Math.max(1e-6, b) > 0.4;
  process.stdout.write("  per shot  (! = >40% off reference on that row):\n");
  for (const s of ours) {
    const flags = [
      off(s.range, r.range) ? "range" : null,
      off(s.p5, r.p5) ? "darks" : null,
      off(s.hf, r.hf) ? "noise" : null,
      off(s.sat, r.sat) ? "sat" : null,
    ].filter(Boolean);
    process.stdout.write(
      `    ${s.file.padEnd(22)} range ${String(s.range).padStart(6)}  p5 ${String(s.p5).padStart(6)}`
      + `  hf ${String(s.hf).padStart(6)}  sat ${String(s.sat).padStart(5)}`
      + (flags.length ? `   ! ${flags.join(",")}` : "") + "\n");
  }

  /* Subject-local contrast. The row the aggregates cannot see. */
  const withSubj = ours.filter((s) => s.subj && !s.subj.thin);
  if (withSubj.length) {
    process.stdout.write("\n  subject vs surrounding field  (delta should be large AND same sign everywhere):\n");
    let pos = 0, neg = 0;
    for (const s of withSubj) {
      const d = s.subj.delta;
      if (d > 0) pos += 1; else neg += 1;
      const weak = Math.abs(d) < 25 ? "   ! weak separation" : "";
      process.stdout.write(
        `    ${s.file.padEnd(22)} subject ${String(s.subj.subject).padStart(6)}`
        + `  field ${String(s.subj.annulus).padStart(6)}  delta ${String(d).padStart(7)}`
        + `  area ${(s.subj.fraction * 100).toFixed(2)}%${weak}\n`);
    }
    if (pos && neg) {
      process.stdout.write(`    ! SIGN IS INCONSISTENT (${pos} lighter, ${neg} darker) - `
        + "the subject reads differently frame to frame\n");
    }
  } else {
    process.stdout.write("\n  subject contrast: no companion frames (recapture to enable)\n");
  }
  process.stdout.write("\n");

  await writeFile(path.join(OURS_DIR, "_metrics.json"),
    JSON.stringify({ ours: o, refs: r, perShot: ours }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
