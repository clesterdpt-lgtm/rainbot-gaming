#!/usr/bin/env node
/* ============================================================
   BLACKSAND - blind A/B comparison builder

   Pairs our renders against real Battlefield 2 screenshots,
   randomises which side is which, and writes each pair to its own
   folder as A.png / B.png plus a side-by-side sheet.

   The answer key is written to `_key.json`, which the reviewing agent
   must not read. Use `--reveal` afterwards to score.

   Usage:
     node scripts/blacksand-blind-compare.mjs \
       --ours output/blacksand-shots/latest \
       --out  output/blind/round-1 --seed 7

     node scripts/blacksand-blind-compare.mjs --reveal output/blind/round-1 \
       --answers A,B,A,A,B,B

   ------------------------------------------------------------
   WHY THE PIPELINE LOOKS LIKE THIS

   A blind comparison is only worth running if it is actually blind.
   Four separate things will otherwise identify the reference with no
   reference to render quality at all, and all four are handled here:

   1. HUD. Every BF2 screenshot carries burned-in UI - chat down the
      top-left, minimap top-right, ammo and squad bars along the
      bottom. Ours are captured with the HUD hidden. So both sides are
      cropped to the same central band, measured to clear all of it.

   2. RESOLUTION AND COMPRESSION. Ours are 1600x900 PNG (sharp,
      lossless); the references are 1024x768 JPEG (softer, with
      mosquito noise on high-contrast edges). That difference alone is
      a giveaway. Both sides therefore go through an IDENTICAL
      resample and JPEG round-trip.

   3. ASPECT. 16:9 versus 4:3. The crop is expressed as a fraction of
      each image's own size and then covered into one panel shape, so
      neither side arrives pre-letterboxed.

   4. REPEATS. Our shots never repeat within a run, so any panel the
      reviewer recognises from an earlier pair is necessarily the
      reference. A reference is therefore used AT MOST ONCE per run,
      which caps the pair count at the size of the reference pool.
   ============================================================ */

import { readdir, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
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

const args = parseArgs(process.argv.slice(2));

/* mulberry32 so pairings are reproducible from a seed */
function makeRng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- the crop band ----
   MEASURED against the reference set at 1024x768, not guessed:
     chat text           y 0.06 .. 0.40 of height
     minimap (top right) y 0.00 .. 0.33
     squad / ammo bars   y 0.79 .. 1.00
   Keeping 0.44 .. 0.76 clears all of it with margin on both ends.
   The first attempt used 0.42 .. 0.80 and the darkened top edge of the
   bottom HUD bar was still visible as a black band across the foot of
   every reference panel - which identified it on its own.
   Horizontally, 0.08 .. 0.92 drops the left chat gutter and the
   right-hand minimap column entirely. */
const CROP = { x0: 0.08, x1: 0.92, y0: 0.44, y1: 0.76 };

const PANEL_W = 1100;
// Panel aspect sits between the two sources' cropped bands (ref
// ~2.95:1, ours ~3.93:1) so `cover` trims a comparable amount off
// each rather than gutting one of them.
const PANEL_H = Math.round(PANEL_W / 3.4);

async function listImages(dir) {
  const entries = await readdir(dir);
  return entries
    .filter((name) => /\.(png|jpe?g)$/i.test(name))
    .filter((name) => !name.startsWith("_"))
    .sort()
    .map((name) => path.join(dir, name));
}

/**
 * Normalise any input to one panel: crop the HUD-free band, cover into
 * the panel shape, then round-trip through JPEG so both sides carry
 * the same compression signature.
 */
async function panel(file) {
  const meta = await sharp(file).metadata();
  const w = meta.width;
  const h = meta.height;

  const left = Math.round(w * CROP.x0);
  const top = Math.round(h * CROP.y0);
  const width = Math.max(8, Math.round(w * (CROP.x1 - CROP.x0)));
  const height = Math.max(8, Math.round(h * (CROP.y1 - CROP.y0)));

  const jpeg = await sharp(file)
    .extract({ left, top, width, height })
    .resize(PANEL_W, PANEL_H, { fit: "cover", position: "centre" })
    .jpeg({ quality: 82, chromaSubsampling: "4:2:0" })
    .toBuffer();
  return sharp(jpeg).png().toBuffer();
}

/**
 * Synthetic floating nametags, composited onto BOTH panels.
 *
 * The references are multiplayer captures, so they carry floating
 * player tags and distance readouts over the world - "Jeppesen2",
 * "[121m]". Those cannot be cropped away because they float anywhere a
 * player stands, and their presence identifies the reference in one
 * glance regardless of how either image looks.
 *
 * So instead of removing them from one side, put equivalents on both.
 * Positions and callsigns are derived from the pair's seed, never from
 * image content, and the same generator draws both panels' tags - so a
 * tag is evidence of nothing. This is the same reasoning as the shared
 * JPEG round-trip: equalise the artefact rather than pretend it is not
 * there.
 */
const CALLSIGNS = [
  "Vandenberg", "K_Sorensen", "mjolnir88", "DustOff2", "Rekkr",
  "PFC.Alvarez", "Tango_Six", "hollowpoint", "N.Okafor", "GreyWolf7",
  "Sgt.Bauer", "redline_04", "M.Petrov", "Halcyon", "Bravo_Actual",
];

function nametagSvg(width, height, rng) {
  const count = 1 + Math.floor(rng() * 3);
  const parts = [];
  for (let i = 0; i < count; i += 1) {
    const x = Math.round(width * (0.12 + rng() * 0.72));
    const y = Math.round(height * (0.18 + rng() * 0.6));
    const name = CALLSIGNS[Math.floor(rng() * CALLSIGNS.length)];
    const distance = 40 + Math.floor(rng() * 260);
    const friendly = rng() < 0.6;
    const colour = friendly ? "#5fb0ff" : "#ffd166";
    parts.push(`
      <g opacity="0.92">
        <circle cx="${x}" cy="${y - 13}" r="4" fill="${colour}"
                stroke="rgba(0,0,0,0.65)" stroke-width="1.2"/>
        <text x="${x + 10}" y="${y}" font-family="Verdana,Helvetica,sans-serif"
              font-size="13" fill="${colour}" stroke="rgba(0,0,0,0.8)"
              stroke-width="2.4" paint-order="stroke">${name}</text>
        <text x="${x + 10}" y="${y + 15}" font-family="Verdana,Helvetica,sans-serif"
              font-size="11" fill="#e8eef4" stroke="rgba(0,0,0,0.8)"
              stroke-width="2.4" paint-order="stroke">[${distance}m]</text>
      </g>`);
  }
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`
  );
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

async function buildPairs() {
  const oursDir = path.resolve(root, args.ours || "output/blacksand-shots/latest");
  const refsDir = path.resolve(root, args.refs || "output/reference/bf2");
  const outDir = path.resolve(root, args.out || "output/blind/latest");
  const seed = Number(args.seed || 1);
  const rng = makeRng(seed);

  const ours = await listImages(oursDir);
  const refs = await listImages(refsDir);
  if (!ours.length) throw new Error(`no images in ${oursDir}`);
  if (!refs.length) throw new Error(`no images in ${refsDir}`);

  const requested = Number(args.pairs || ours.length);
  const count = Math.min(requested, refs.length);

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

  const refPool = shuffle(refs);
  const ourPool = shuffle(ours);

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
    const ourFile = ourPool[i % ourPool.length];
    const refFile = refPool[i];
    const oursIsA = sidePlan[i];

    const pairDir = path.join(outDir, `pair-${String(i + 1).padStart(2, "0")}`);
    await mkdir(pairDir, { recursive: true });

    // Both panels get synthetic nametags from the SAME generator, so
    // their presence carries no information about which side is which.
    const tagRng = makeRng(seed * 7919 + i * 31 + 1);
    const rawA = await panel(oursIsA ? ourFile : refFile);
    const rawB = await panel(oursIsA ? refFile : ourFile);
    const aBuf = await sharp(rawA)
      .composite([{ input: nametagSvg(PANEL_W, PANEL_H, tagRng) }]).png().toBuffer();
    const bBuf = await sharp(rawB)
      .composite([{ input: nametagSvg(PANEL_W, PANEL_H, tagRng) }]).png().toBuffer();

    await sharp(aBuf).composite([{ input: labelSvg("A", PANEL_W, PANEL_H), top: 0, left: 0 }])
      .png().toFile(path.join(pairDir, "A.png"));
    await sharp(bBuf).composite([{ input: labelSvg("B", PANEL_W, PANEL_H), top: 0, left: 0 }])
      .png().toFile(path.join(pairDir, "B.png"));

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
      referenceFile: path.relative(root, refFile),
    });
  }

  await writeFile(path.join(outDir, "_key.json"), JSON.stringify({ seed, pairs: key }, null, 2));
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
      "For each pair, judge ONLY the quality of the 3D rendering:",
      "lighting, material believability, shadow quality, texture detail, sense of depth,",
      "composition, colour, and overall production value.",
      "Ignore subject matter entirely. A tank is not better or worse than a building.",
      "Both panels have been cropped, resampled and JPEG round-tripped identically, so",
      "sharpness and compression artefacts carry no information about which is which.",
      "Floating player nametags and distance readouts were added to BOTH panels by the",
      "same generator. They are not part of either render. Ignore them.",
      "",
      "Answer per pair with a single letter and one sentence of reasoning.",
    ].join("\n")
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

  let oursWins = 0;
  let refWins = 0;

  console.log(`\nseed ${key.seed}\n`);
  key.pairs.forEach((entry, index) => {
    const picked = answers ? answers[index] : null;
    const winner = picked ? entry[picked] : "(no answer supplied)";
    if (winner === "ours") oursWins += 1;
    if (winner === "reference") refWins += 1;
    console.log(
      `pair ${String(entry.pair).padStart(2, "0")}  A=${entry.A.padEnd(9)} B=${entry.B.padEnd(9)}`
      + (picked ? `  picked ${picked} -> ${winner.toUpperCase()}` : "")
    );
    console.log(`         ours: ${entry.oursFile}`);
    console.log(`         ref : ${entry.referenceFile}`);
  });

  if (answers) {
    const total = oursWins + refWins;
    console.log(`\nRESULT: ours ${oursWins} / ${total}   reference ${refWins} / ${total}`);
    if (oursWins > refWins) console.log("Our game won the blind comparison.");
    else if (oursWins === refWins) console.log("Tied - not good enough yet.");
    else console.log("The reference won. Keep working.");
  }
}

(async () => {
  if (args.reveal) await reveal();
  else await buildPairs();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
