#!/usr/bin/env node
/* ============================================================
   SAINTFALL - blind A/B comparison builder

   Pairs our boss renders against real original-Xbox Halo screenshots,
   randomises which side is which, and writes each pair to its own
   folder as A.png / B.png plus a side-by-side sheet.

   The answer key is written to `_key.json`, which the reviewing agent
   must not read. Use `--reveal` afterwards to score.

   Usage:
     node scripts/saintfall-blind-compare.mjs \
       --ours output/saintfall/stylite-shots \
       --out  output/saintfall/blind/round-1 --seed 7

     node scripts/saintfall-blind-compare.mjs \
       --reveal output/saintfall/blind/round-1 --answers A,B,A,A,B,B
     node scripts/saintfall-blind-compare.mjs \
       --reveal output/saintfall/blind/round-1 --mode identify --answers A,B,A

   ------------------------------------------------------------
   WHY THE PIPELINE LOOKS LIKE THIS

   scripts/blacksand-blind-compare.mjs already worked this out against
   Battlefield 2 and its header lists the four things that identify a
   reference for reasons that have nothing to do with render quality:
   HUD, resolution/compression, aspect, and repeats. That reasoning is
   ported wholesale and is not re-derived here. What follows is only
   where the HALO pool forced a different answer, plus the two leaks
   the BF2 rig does not close.

   1. HUD - AND WHY THE ANSWER IS NOT "EQUALISE IT".

      BF2 was easy in one respect: every reference carried burned-in UI
      and ours carried none, so one fixed central band cleared it. The
      Halo pool is mixed - and, measured rather than assumed, mostly
      HUD-FREE. All 28 frames were opened and looked at. Exactly one
      (halo-06) carries the full CE HUD, and it is rejected below for a
      different reason entirely. One (halo-18) carries a pink uploader
      watermark low-left. The rest are theatre, cutscene and
      weapon-in-hand captures with the HUD off. (The pool has since
      been vetted down to 18 upstream; halo-06 went with it, so the
      live pool is HUD-free apart from that one watermark.)

      That matters because of the shape of Halo's HUD. Three of its
      four elements - shield bar top-left, motion tracker bottom-left,
      ammo top-right - hug the frame corners, and a corner is
      removable by a crop that is applied to BOTH sides, so it needs no
      equalisation at all. The reticle is the exception: it sits DEAD
      CENTRE, which for a boss portrait is on the subject. Cropping
      around it means cropping the boss in half.

      Blacksand's rule for an artefact you cannot crop is "equalise it
      rather than pretend it is not there", and that rule still holds -
      but it is the fallback here, not the default, because a BF2
      nametag floats over world at a random position while a reticle
      lands on the subject by construction. The pixels a reticle
      covers are exactly the pixels the AAA brief asks the critic to
      judge: surface, specular, cavity. So:

        - references are RANKED, HUD-free first. The pool is large
          enough that a full-size round never has to reach a HUD frame.
        - a HUD frame, when one is reached, is cropped by a tighter
          per-class inset that clears the corner furniture - and that
          same inset is applied to OUR panel in that pair, so framing
          looseness cannot identify a side either.
        - and only then is a synthetic reticle composited, identically,
          onto BOTH panels. It is deliberately a generic ring, not
          Halo's, so it cannot be scored as "that one is Halo".

      `--reticle always` forces it on; `--reticle never` forces it off.
      Default `auto` = on iff a HUD-class reference is in the run.

   2. RESOLUTION AND COMPRESSION. The pool runs 1920x1080 to 3840x2160
      and mixes PNG with JPEG; ours are 1600x900 PNG. Both sides
      therefore go through an IDENTICAL resample and JPEG round-trip.

      The tempting extra step - push both through a 480p bottleneck,
      since these are upscales of a 640x480-era game - was MEASURED and
      rejected. Mean |laplacian| through this pipeline: Halo pool
      median 7.5, ours 3.5-4.3. Edge density: pool 12.6%, ours ~5%.
      The references are not softer than us, they are twice as
      detailed. A bottleneck would only have blurred away the very
      thing the brief says we are losing on, and flattered us.

   3. ASPECT. 4:3 and 16:9 both appear (halo-05/06 are 2592x1944,
      halo-08/09/10 are 1920x1440). The crop is a fraction of each
      image's own size and is then covered into one panel shape, so
      neither side arrives pre-letterboxed. Panel aspect 1.5625 sits
      between 1.333 and 1.778 so `cover` trims a comparable slice off
      each rather than gutting one.

   4. REPEATS - and the half of it the BF2 rig gets wrong. There, the
      pair count is capped at the size of the REFERENCE pool, with the
      note that a panel recognised from an earlier pair is necessarily
      the reference. True, but only in one direction: that code then
      does `ourPool[i % ourPool.length]`, so when we have fewer shots
      than references OUR panels repeat instead, and a recognised panel
      is necessarily OURS. Here the count is capped at the smaller of
      the two pools, so neither side ever repeats.

   5. CAPTURE ARTEFACTS - not on the BF2 list, because BF2's pool was
      clean digital grabs. Halopedia's is not. As fetched, halo-05 and
      halo-06 were photographs of a CRT (screen-door moire, glare,
      barrel distortion) and halo-17 was an interlaced video capture
      with comb artefacts and a burned-in PLAY overlay. Their edge
      density measured 86%, 90% and 79% against a pool median of 13%:
      they announce "photograph of a television" before anyone judges
      a material.

      saintfall-fetch-refs.mjs has since grown its own vetting pass
      and holds those three (and seven more) in
      output/reference/halo-rejected/. The screen here is kept anyway,
      for two reasons: this harness must not assume a particular
      vetting state of a gitignored directory it does not own, and the
      screen is SELF-CALIBRATING where a held list is not. Anything
      above ARTEFACT_RATIO x the pool's own median edge density is
      dropped, so the next re-fetch is screened too rather than only
      the frames someone has already looked at. On the current
      18-frame pool the median is 12.8% and the most detailed genuine
      frame (halo-12, a heavily JPEG-noised purple corridor) is 26.3%,
      so the limit sits at 33.4% - comfortably between real detail and
      a photographed screen.

   6. BYTE SIZE - the leak nobody looks for. A reviewer who runs `ls`
      sees A.png at 620K and B.png at 480K. Across a whole round that
      is directional and free: our flat, under-detailed frames compress
      smaller than Halo's, consistently. So both panels of a pair are
      padded to an identical byte length with a PNG tEXt chunk
      (inserted before IEND, so the file stays a valid PNG rather than
      carrying junk after the end marker). Nothing else in the output
      directory names a side: both panels are A.png/B.png, the sheet
      labels are "A"/"B", and sharp does not copy input metadata
      forward unless asked, which it is not.
   ============================================================ */

import { readdir, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i += 1; }
    } else args._.push(token);
  }
  return args;
}

/* mulberry32 so pairings are reproducible from a seed */
export function makeRng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------
   THE PANEL

   1.5625:1, between 4:3 and 16:9 (see note 3 above). 1000px wide is
   enough that a critic can judge a specular roll on a shoulder plate
   and small enough that 28 references measure in a few seconds.
   ------------------------------------------------------------ */
export const PANEL_W = 1000;
export const PANEL_H = 640;

/* ------------------------------------------------------------
   CROP CLASSES

   An inset is per-EDGE, not uniform, so a frame with one bad corner
   loses one edge instead of all four. Whichever class a pair draws,
   BOTH of its panels are cropped by it - a looser or tighter framing
   is itself a tell if only one side gets it.

   `hud` numbers are CE's HUD at 640x480 expressed as fractions:
   shield bar top-left ends about y 0.10, ammo top-right about y 0.12,
   motion tracker bottom-left runs to about y 0.97 and x 0.20. Top
   0.16 / bottom 0.20 / sides 0.12 clears all of it with margin.
   ------------------------------------------------------------ */
export const CLASS_INSETS = {
  /* Just enough to drop encoder mush and any one-pixel border. */
  clean:  { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  /* Uploader watermarks and stray corner furniture. Only the offending
     edge is cut hard; there is no reason to throw away the sky as well. */
  corner: { top: 0.05, right: 0.05, bottom: 0.15, left: 0.05 },
  /* Live game HUD. */
  hud:    { top: 0.16, right: 0.12, bottom: 0.20, left: 0.12 },
};

/* ------------------------------------------------------------
   THE POOL TABLE

   Every entry below was cropped and LOOKED AT at full resolution
   before it was written down - which is the lesson
   saintfall-measure-reference.mjs paid for the hard way: an asserted
   classification is worth nothing, and ten of its thirteen sample
   boxes turned out to be measuring the wrong thing.

   Two things nearly went in here wrong, recorded so they are not
   re-added: halo-08's paired white shapes are Covenant door glyphs,
   not a rocket-launcher reticle, and halo-03/04/10/13 carry a
   first-person WEAPON but no HUD chrome - a viewmodel is part of the
   render and is fair game to judge.

   Four of the five entries below now name frames that
   saintfall-fetch-refs.mjs has itself moved to halo-rejected/ since
   this table was written. They stay: the fetcher holds them by SOURCE
   TITLE, this holds them by filename, and neither directory is
   committed, so the day someone clears halo-rejected/ to widen the
   pool these are still classified rather than silently re-admitted.

   BUT AN ENTRY THAT NAMES NOTHING IS NOT A CLASSIFICATION, IT IS A
   COMMENT. As written, those four resolved against no file in either
   direction: `screenPool` only ever looked at the files it was handed,
   so nothing distinguished "the fetcher already holds halo-05, and
   this table agrees" from "halo-05 was renamed two re-fetches ago and
   this line has been inert ever since". Both printed the same thing,
   which was nothing at all, under a banner that said 18 usable and
   listed no rejects - and a reader could not tell whether the vetting
   this header describes was in force or dead.

   So every note is now RESOLVED, against the pool being screened and
   against the sibling `-rejected/` directory the fetcher holds, and
   each one comes out as exactly one of three things:

     applied  - the file is in the pool and this table classified it
     upstream - the file is in halo-rejected/; the fetcher got there
                first and this table agrees with it
     stale    - the file is in neither, so the entry describes a frame
                that no longer exists under that name

   All three are counted in the banner and the stale ones are named,
   because a stale entry is the one state that needs a human.

   Files not listed default to `clean` and are named in a warning, so
   a re-fetch is loud rather than silently mis-cropped.
   ------------------------------------------------------------ */
export const POOL_NOTES = {
  "halo-05.jpg": { cls: "reject", why: "photograph of a CRT - moire, glare, edge density 86% vs pool median 13%" },
  "halo-06.jpg": { cls: "reject", why: "photograph of a CRT, and the only full-HUD frame in the pool - edge density 90%" },
  "halo-07.png": { cls: "reject", why: "asset render on a flat black backdrop, no environment light - scores our frame against a turntable" },
  "halo-17.png": { cls: "reject", why: "interlaced video capture, comb artefacts plus burned-in subtitle - edge density 79%" },
  "halo-18.jpg": { cls: "corner", why: "pink uploader watermark low-left at about y 0.90" },
};

/* A frame this far above the pool's median edge density is not a
   detailed render, it is a capture artefact. Set from the measured
   gap: the three screen captures sit at 79-90% against a median of
   12.6%, and the most detailed genuine frame in the pool (halo-12,
   a heavily JPEG-noised purple corridor) sits at 26%. */
const ARTEFACT_RATIO = 2.6;

export async function listImages(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`no such directory: ${dir}`);
    throw error;
  }
  return entries
    .filter((name) => /\.(png|jpe?g)$/i.test(name))
    .filter((name) => !name.startsWith("_"))
    .sort()
    .map((name) => path.join(dir, name));
}

/* ------------------------------------------------------------
   Letterbox / pillarbox trim.

   A cutscene grab carries baked black bars. Cropping by a FRACTION of
   such an image measures the fraction against the bars as well as the
   picture, so the two sides end up framed differently - and a residual
   black band that survives `cover` identifies the panel outright.
   Bars are found and removed first, per image, before any fractional
   inset.

   The threshold is deliberately mean: max luma under 10 AND spread
   under 3. Half this pool is a genuinely dark frame (halo-21, -22,
   -24, -26 are night or interior), and a permissive detector eats
   them alive. The trim is also capped at 25% per side for the same
   reason - a detector that can consume half the picture is worse than
   no detector.
   ------------------------------------------------------------ */
export async function findBars(file) {
  const probeW = 160;
  const probeH = 120;
  const { data } = await sharp(file)
    .resize(probeW, probeH, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rowIsBar = [];
  for (let y = 0; y < probeH; y += 1) {
    let max = 0;
    let sum = 0;
    let sumSq = 0;
    for (let x = 0; x < probeW; x += 1) {
      const v = data[y * probeW + x];
      if (v > max) max = v;
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / probeW;
    const sd = Math.sqrt(Math.max(0, sumSq / probeW - mean * mean));
    rowIsBar.push(max < 10 && sd < 3);
  }
  const colIsBar = [];
  for (let x = 0; x < probeW; x += 1) {
    let max = 0;
    let sum = 0;
    let sumSq = 0;
    for (let y = 0; y < probeH; y += 1) {
      const v = data[y * probeW + x];
      if (v > max) max = v;
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / probeH;
    const sd = Math.sqrt(Math.max(0, sumSq / probeH - mean * mean));
    colIsBar.push(max < 10 && sd < 3);
  }

  const run = (arr, from) => {
    let n = 0;
    if (from === "start") { while (n < arr.length && arr[n]) n += 1; }
    else { while (n < arr.length && arr[arr.length - 1 - n]) n += 1; }
    return Math.min(n / arr.length, 0.25);
  };

  return {
    top: run(rowIsBar, "start"),
    bottom: run(rowIsBar, "end"),
    left: run(colIsBar, "start"),
    right: run(colIsBar, "end"),
  };
}

/**
 * Normalise any input to one panel buffer: trim baked bars, apply the
 * pair's per-edge inset as a fraction of what is left, cover into the
 * panel shape, then round-trip through JPEG so both sides carry the
 * same compression signature.
 *
 * `raw: true` returns the pixels instead of a PNG - that is the door
 * saintfall-metric-compare.mjs comes through, so the metrics are
 * measured on literally the same pixels the critic is shown rather
 * than on a copy-pasted crop constant that can drift out of step.
 */
export async function panel(file, inset = CLASS_INSETS.clean, opts = {}) {
  const meta = await sharp(file).metadata();
  const bars = opts.bars || await findBars(file);

  const barLeft = Math.round(meta.width * bars.left);
  const barTop = Math.round(meta.height * bars.top);
  const barW = meta.width - barLeft - Math.round(meta.width * bars.right);
  const barH = meta.height - barTop - Math.round(meta.height * bars.bottom);

  const left = barLeft + Math.round(barW * inset.left);
  const top = barTop + Math.round(barH * inset.top);
  const width = Math.max(8, Math.round(barW * (1 - inset.left - inset.right)));
  const height = Math.max(8, Math.round(barH * (1 - inset.top - inset.bottom)));

  const jpeg = await sharp(file)
    .extract({ left, top, width, height })
    .resize(PANEL_W, PANEL_H, { fit: "cover", position: "centre" })
    .jpeg({ quality: 82, chromaSubsampling: "4:2:0" })
    .toBuffer();

  if (opts.raw) {
    return sharp(jpeg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  }
  return sharp(jpeg).png().toBuffer();
}

/**
 * Screen the reference pool: drop the named rejects, then drop
 * anything whose edge density is ARTEFACT_RATIO above the pool median.
 * Returns the usable files with their crop class.
 *
 * Doing this by measurement as well as by name is the point. The four
 * named rejects are the ones I found by eye in THIS pool;
 * saintfall-fetch-refs.mjs will happily pull a different 28 tomorrow.
 */
export async function screenPool(files, { quiet = false, heldDir = null } = {}) {
  /* Where the fetcher parks what IT rejected. Derived from the pool
     being screened rather than hard-coded, so a run pointed at a
     different reference set resolves its own notes and not the Halo
     pool's. Missing directory is not an error - it only means every
     note has to resolve inside the pool or be called stale. */
  const poolDir = files.length ? path.dirname(files[0]) : null;
  const held = new Set();
  const heldPath = heldDir || (poolDir ? `${poolDir}-rejected` : null);
  if (heldPath) {
    try {
      for (const name of await readdir(heldPath)) held.add(name);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const rows = [];
  for (const file of files) {
    const base = path.basename(file);
    const note = POOL_NOTES[base];
    if (note && note.cls === "reject") {
      rows.push({ file, base, cls: "reject", why: note.why, edge: null });
      continue;
    }
    const { data } = await panel(file, CLASS_INSETS.clean, { raw: true });
    rows.push({
      file,
      base,
      cls: note ? note.cls : "clean",
      why: note ? note.why : null,
      known: Boolean(note),
      edge: edgeDensity(data, PANEL_W, PANEL_H),
    });
  }

  const measured = rows.filter((r) => r.edge !== null).map((r) => r.edge).sort((a, b) => a - b);
  const median = measured[measured.length >> 1] || 1;
  const limit = median * ARTEFACT_RATIO;

  for (const row of rows) {
    if (row.cls !== "reject" && row.edge > limit) {
      row.cls = "reject";
      row.why = `capture artefact: edge density ${row.edge.toFixed(1)}% > ${limit.toFixed(1)}% (${ARTEFACT_RATIO}x pool median)`;
    }
  }

  const usable = rows.filter((r) => r.cls !== "reject");
  const unknown = usable.filter((r) => !r.known && !POOL_NOTES[r.base]);

  /* Resolve the table itself, not just the pool. See the POOL_NOTES
     header: an entry that names no file anywhere is inert, and inert
     used to look exactly like enforced. */
  const inPool = new Set(rows.map((r) => r.base));
  const notes = { applied: [], upstream: [], stale: [] };
  for (const base of Object.keys(POOL_NOTES)) {
    if (inPool.has(base)) notes.applied.push(base);
    else if (held.has(base)) notes.upstream.push(base);
    else notes.stale.push(base);
  }
  const rejected = rows.filter((r) => r.cls === "reject");

  if (!quiet) {
    for (const row of rejected) console.log(`  reject ${row.base}: ${row.why}`);
    console.log(`  POOL_NOTES: ${Object.keys(POOL_NOTES).length} entries -`
      + ` ${notes.applied.length} applied to this pool,`
      + ` ${notes.upstream.length} already held in ${heldPath
        ? path.basename(heldPath) : "(no held directory)"},`
      + ` ${notes.stale.length} stale`);
    if (notes.stale.length) {
      console.log(`  STALE: ${notes.stale.join(", ")} - named in POOL_NOTES but present`
        + " in neither the pool nor the held set. Re-check the table against a fresh fetch.");
    }
    if (unknown.length) {
      console.log(
        `  note: ${unknown.length} reference(s) are not in POOL_NOTES and default to "clean".`
        + ` Look at them before trusting a round: ${unknown.map((r) => r.base).join(", ")}`
      );
    }
  }
  /* Hung off the returned array rather than changing the return type:
     saintfall-metric-compare.mjs imports this and treats the result as
     a plain list of references, and it must keep working. */
  usable.notes = notes;
  usable.rejected = rejected.length;
  usable.screened = rows.length;

  /* HUD-free first, so a normal-sized round never reaches a frame that
     needs the reticle fallback. Ties keep filename order for
     reproducibility - the shuffle downstream is the randomness. */
  const rank = { clean: 0, corner: 1, hud: 2 };
  usable.sort((a, b) => (rank[a.cls] - rank[b.cls]) || a.base.localeCompare(b.base));
  return usable;
}

/* Edge density as a percentage: share of interior pixels whose Sobel
   gradient magnitude clears 18/255. Used here only as the artefact
   screen; saintfall-metric-compare.mjs reports it as a metric. */
export function edgeDensity(data, W, H) {
  let hits = 0;
  let n = 0;
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; p < W * H; i += 3, p += 1) {
    lum[p] = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
  }
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + W] - lum[i - W];
      if (Math.hypot(gx, gy) > 18) hits += 1;
      n += 1;
    }
  }
  return (hits / n) * 100;
}

/* ------------------------------------------------------------
   The synthetic reticle.

   Composited onto BOTH panels of a pair when a HUD-class reference is
   in play, from one buffer, so its presence carries no information.
   Deliberately NOT Halo's reticle: a critic who recognises the shape
   would be scoring the overlay, and a doubled reticle on a reference
   whose real one survived the crop would be worse than either.

   Hollow, thin, with a dark casing stroke under a light one so it
   reads over both a blown highlight and a black crease. Line-work
   only - it occludes almost no subject area, which is the whole
   objection to putting a reticle over a boss portrait in the first
   place.
   ------------------------------------------------------------ */
function reticleSvg(width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.round(width * 0.026);
  const tick = Math.round(r * 0.85);
  const arms = [
    [cx, cy - r - 2, cx, cy - r - 2 - tick],
    [cx, cy + r + 2, cx, cy + r + 2 + tick],
    [cx - r - 2, cy, cx - r - 2 - tick, cy],
    [cx + r + 2, cy, cx + r + 2 + tick, cy],
  ].map(([x1, y1, x2, y2]) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join("");
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <g fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="3.6" stroke-linecap="round">
        <circle cx="${cx}" cy="${cy}" r="${r}"/>${arms}
      </g>
      <g fill="none" stroke="rgba(232,240,246,0.82)" stroke-width="1.5" stroke-linecap="round">
        <circle cx="${cx}" cy="${cy}" r="${r}"/>${arms}
      </g>
      <circle cx="${cx}" cy="${cy}" r="1.4" fill="rgba(232,240,246,0.7)"/>
    </svg>
  `);
}

function labelSvg(text, width, height) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="16" y="16" width="74" height="74" rx="12" fill="rgba(6,10,14,0.78)"
            stroke="rgba(255,255,255,0.7)" stroke-width="3"/>
      <text x="53" y="70" font-family="Helvetica,Arial,sans-serif" font-size="54"
            font-weight="700" fill="#ffffff" text-anchor="middle">${text}</text>
    </svg>
  `);
}

/* ------------------------------------------------------------
   PNG byte-length equalisation (note 6 in the header).

   A tEXt chunk is inserted immediately before IEND. It has to go
   BEFORE IEND, not after: bytes trailing the end marker are tolerated
   by most decoders but the file is no longer a valid PNG, and a
   reviewer's image viewer refusing to open one panel would be a
   spectacular own goal.

   A tEXt chunk costs 12 bytes of framing plus the keyword and its
   null, so the smallest useful pad is 20 bytes; callers ask for a
   target at least that far above the larger file.
   ------------------------------------------------------------ */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function padPngTo(png, target) {
  const KEYWORD = "Comment";
  const overhead = 12 + KEYWORD.length + 1;
  const padBytes = target - png.length - overhead;
  if (padBytes < 0) return png;

  const data = Buffer.concat([
    Buffer.from(KEYWORD, "latin1"),
    Buffer.from([0]),
    Buffer.alloc(padBytes, 0x20),
  ]);
  const type = Buffer.from("tEXt", "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])), 0);
  const chunk = Buffer.concat([len, type, data, crc]);

  // IEND is always the final 12 bytes of a well-formed PNG.
  const iendAt = png.length - 12;
  return Buffer.concat([png.subarray(0, iendAt), chunk, png.subarray(iendAt)]);
}

async function writeEqualSized(aPng, bPng, aPath, bPath) {
  const target = Math.max(aPng.length, bPng.length) + 40;
  await writeFile(aPath, padPngTo(aPng, target));
  await writeFile(bPath, padPngTo(bPng, target));
}

async function buildPairs() {
  const oursDir = path.resolve(root, args.ours || "output/saintfall/stylite-shots");
  const refsDir = path.resolve(root, args.refs || "output/reference/halo");
  const outDir = path.resolve(root, args.out || "output/saintfall/blind/latest");
  const seed = Number(args.seed || 1);
  const rng = makeRng(seed);

  const ours = await listImages(oursDir);
  const refFiles = await listImages(refsDir);
  if (!ours.length) throw new Error(`no images in ${oursDir}`);
  if (!refFiles.length) throw new Error(`no images in ${refsDir}`);

  console.log(`screening ${refFiles.length} references in ${path.relative(root, refsDir)}`);
  const refs = await screenPool(refFiles);
  console.log(`  ${refs.length} usable of ${refs.screened} screened`
    + ` (${refs.filter((r) => r.cls === "clean").length} HUD-free,`
    + ` ${refs.filter((r) => r.cls === "corner").length} corner-cropped,`
    + ` ${refs.filter((r) => r.cls === "hud").length} HUD,`
    + ` ${refs.rejected} rejected here)`);

  // Neither side may repeat within a run - see note 4. Capping at the
  // reference pool alone is not enough.
  const requested = Number(args.pairs || Math.min(ours.length, refs.length));
  const count = Math.min(requested, refs.length, ours.length);
  if (requested > count) {
    console.log(`  capped ${requested} -> ${count} pairs (a repeated panel identifies its own side)`);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // Fisher-Yates. `sort(() => rng() - 0.5)` is NOT a uniform shuffle -
  // the comparator is inconsistent, so the permutation is biased and
  // some entries are systematically over-sampled. That matters because
  // it decides which of our shots get tested across seeds.
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  /* Shuffle WITHIN each rank class, then concatenate, then slice.
     The obvious version - shuffle(refs.slice(0, count)) - keeps the
     HUD-free-first preference but freezes WHICH clean frames get used:
     screenPool() sorts ties by filename, so the slice takes halo-01
     through halo-13 every time and the eight frames after them are
     dead weight at every seed. Two rounds at different seeds then show
     the critic the same ten Halo pictures, which is failure mode 4
     leaking ACROSS runs instead of within one - a critic who has seen
     halo-08 in round 1 recognises it in round 3 and knows that panel
     is the reference. */
  const byClass = new Map();
  for (const ref of refs) {
    if (!byClass.has(ref.cls)) byClass.set(ref.cls, []);
    byClass.get(ref.cls).push(ref);
  }
  const refPool = shuffle(
    ["clean", "corner", "hud"].flatMap((cls) => shuffle(byClass.get(cls) || [])).slice(0, count)
  );
  const ourPool = shuffle(ours).slice(0, count);

  const reticleMode = typeof args.reticle === "string" ? args.reticle : "auto";
  const anyHud = refPool.some((r) => r.cls === "hud");
  const useReticle = reticleMode === "always" || (reticleMode === "auto" && anyHud);
  if (useReticle) {
    console.log(`  reticle: ON (${reticleMode === "always" ? "forced" : "a HUD reference is in the run"}) - composited identically on both panels`);
  }
  const reticle = useReticle ? reticleSvg(PANEL_W, PANEL_H) : null;

  // A fair per-pair coin is not good enough: it can easily put ours on
  // panel A in 13 of 14 pairs, which is a free guess after two pairs.
  // Build an exactly balanced assignment and shuffle THAT.
  const sidePlan = [];
  for (let i = 0; i < count; i += 1) sidePlan.push(i % 2 === 0);
  for (let i = sidePlan.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = sidePlan[i]; sidePlan[i] = sidePlan[j]; sidePlan[j] = t;
  }

  const key = [];

  for (let i = 0; i < count; i += 1) {
    const ourFile = ourPool[i];
    const ref = refPool[i];
    const oursIsA = sidePlan[i];
    const inset = CLASS_INSETS[ref.cls] || CLASS_INSETS.clean;

    const pairDir = path.join(outDir, `pair-${String(i + 1).padStart(2, "0")}`);
    await mkdir(pairDir, { recursive: true });

    // Same inset for both panels of the pair: framing looseness is a
    // tell as surely as a visible HUD is.
    const oursPanel = await panel(ourFile, inset);
    const refPanel = await panel(ref.file, inset);
    let aBuf = oursIsA ? oursPanel : refPanel;
    let bBuf = oursIsA ? refPanel : oursPanel;

    if (reticle) {
      aBuf = await sharp(aBuf).composite([{ input: reticle }]).png().toBuffer();
      bBuf = await sharp(bBuf).composite([{ input: reticle }]).png().toBuffer();
    }

    const aLabelled = await sharp(aBuf)
      .composite([{ input: labelSvg("A", PANEL_W, PANEL_H), top: 0, left: 0 }]).png().toBuffer();
    const bLabelled = await sharp(bBuf)
      .composite([{ input: labelSvg("B", PANEL_W, PANEL_H), top: 0, left: 0 }]).png().toBuffer();

    await writeEqualSized(
      aLabelled, bLabelled,
      path.join(pairDir, "A.png"), path.join(pairDir, "B.png")
    );

    const GAP = 14;
    await sharp({
      create: {
        width: PANEL_W, height: PANEL_H * 2 + GAP, channels: 3,
        background: { r: 12, g: 14, b: 18 },
      },
    })
      .composite([
        { input: aBuf, top: 0, left: 0 },
        { input: bBuf, top: PANEL_H + GAP, left: 0 },
        { input: labelSvg("A", PANEL_W, PANEL_H), top: 0, left: 0 },
        { input: labelSvg("B", PANEL_W, PANEL_H), top: PANEL_H + GAP, left: 0 },
      ])
      .png()
      .toFile(path.join(pairDir, "side-by-side.png"));

    key.push({
      pair: i + 1,
      A: oursIsA ? "ours" : "reference",
      B: oursIsA ? "reference" : "ours",
      oursFile: path.relative(root, ourFile),
      referenceFile: path.relative(root, ref.file),
      cropClass: ref.cls,
    });
  }

  await writeFile(
    path.join(outDir, "_key.json"),
    JSON.stringify({ seed, reticle: useReticle, pairs: key }, null, 2)
  );
  await writeFile(
    path.join(outDir, "README.txt"),
    [
      "BLIND COMPARISON SET",
      "",
      `${count} pairs. Each pair-NN folder holds A.png, B.png and side-by-side.png.`,
      "One of A/B is our game, the other is a shipped commercial game. You are not told which.",
      "",
      "DO NOT OPEN _key.json.",
      "",
      "For each pair, answer one question: WHICH PANEL WOULD YOU RATHER SHIP?",
      "Judge ONLY the quality of the rendering: surface and material believability,",
      "light response and specular, silhouette readability, shadow and contact,",
      "value range, colour separation between subject and background, and sense of weight.",
      "Ignore subject matter entirely. A creature is not better or worse than a vehicle.",
      "",
      "Both panels of a pair were cropped by the SAME per-edge inset, resampled to the",
      "same size and JPEG round-tripped identically, so framing, sharpness, resolution,",
      "aspect and compression artefacts carry no information about which is which.",
      useReticle
        ? "A synthetic aiming reticle was composited onto BOTH panels by the harness. It\nbelongs to neither game. Ignore it."
        : "",
      "",
      "A tie is a loss. Say which letter, and say why in terms of craft.",
    ].filter(Boolean).join("\n")
  );

  console.log(`built ${count} blind pairs in ${path.relative(root, outDir)}`);
  console.log(`answer key: ${path.relative(root, path.join(outDir, "_key.json"))} (do not show the reviewer)`);
}

async function reveal() {
  const dir = path.resolve(root, String(args.reveal));
  const key = JSON.parse(await readFile(path.join(dir, "_key.json"), "utf8"));
  const answers = args.answers
    ? String(args.answers).split(",").map((s) => s.trim().toUpperCase())
    : null;

  /* Two different questions can be asked of the same set, and they
     score in opposite directions, so the mode is explicit rather than
     inferred:

       prefer   (default) - the letter is the panel the critic would
                            rather ship. Ours winning is the goal.
       identify           - the letter is the panel the critic thinks
                            is ours. Here 50% is the goal; a critic who
                            scores 100% can see the tell even if they
                            like our panel. */
  const mode = typeof args.mode === "string" ? args.mode : "prefer";
  if (mode !== "prefer" && mode !== "identify") {
    throw new Error(`--mode must be "prefer" or "identify", got "${mode}"`);
  }

  /* A short answer list scores only the pairs it covers, and then
     reports a verdict off three of ten pairs as if it were the round.
     Say so loudly - a partial round is a partial result. */
  if (answers && answers.length !== key.pairs.length) {
    console.log(
      `WARNING: ${answers.length} answer(s) for ${key.pairs.length} pairs.`
      + " The result below covers only the pairs answered."
    );
  }

  let oursWins = 0;
  let refWins = 0;
  let right = 0;
  let answered = 0;

  console.log(`\nseed ${key.seed}   mode ${mode}${key.reticle ? "   (reticle equalised)" : ""}\n`);
  key.pairs.forEach((entry, index) => {
    const picked = answers ? answers[index] : null;
    const side = picked ? entry[picked] : null;
    let verdict = "";
    if (side) {
      answered += 1;
      if (mode === "prefer") {
        if (side === "ours") { oursWins += 1; verdict = "  picked " + picked + " -> OURS      WIN"; }
        else { refWins += 1; verdict = "  picked " + picked + " -> REFERENCE LOSS"; }
      } else {
        const correct = side === "ours";
        if (correct) right += 1;
        verdict = `  picked ${picked} -> ${side.toUpperCase().padEnd(9)} ${correct ? "RIGHT" : "WRONG"}`;
      }
    }
    console.log(
      `pair ${String(entry.pair).padStart(2, "0")}  A=${entry.A.padEnd(9)} B=${entry.B.padEnd(9)}`
      + ` [${entry.cropClass}]${verdict}`
    );
    console.log(`         ours: ${entry.oursFile}`);
    console.log(`         ref : ${entry.referenceFile}`);
  });

  if (!answers) return;

  if (mode === "prefer") {
    const total = oursWins + refWins;
    console.log(`\nRESULT: ours ${oursWins} / ${total}   reference ${refWins} / ${total}`);
    if (oursWins > refWins) console.log("Our bosses won the blind comparison.");
    else if (oursWins === refWins) console.log("Tied - the brief says a tie is a loss. Keep working.");
    else console.log("Halo won. Take the critic's stated reason and fix that.");
  } else {
    const pct = answered ? (right / answered) * 100 : 0;
    console.log(`\nRESULT: identified ${right} / ${answered} correctly (${pct.toFixed(0)}%)`);
    if (pct >= 80) console.log("The critic can see which is ours. There is a tell - find it before trusting any preference round.");
    else if (pct >= 65) console.log("Above chance. Something is leaking.");
    else console.log("At or near chance - the set is genuinely blind.");
  }
}

const args = parseArgs(process.argv.slice(2));

/* Only run when invoked directly. saintfall-metric-compare.mjs imports
   the normalisation from this file so the two harnesses cannot drift
   apart - without this guard, importing it would build a round. */
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  (async () => {
    if (args.reveal) await reveal();
    else await buildPairs();
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
