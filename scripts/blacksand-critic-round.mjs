#!/usr/bin/env node
/* ============================================================
   BLACKSAND - one round of the art-director critic loop

   Mechanises the parts of a review round that do not need judgement:

     1. capture beauty shots at the current build
     2. build a blind A/B set against the Battlefield 2 references
     3. print the directory the reviewing agent should open

   The judgement itself is done by a separate agent that must NOT see
   `_key.json`. Score it afterwards with:

     node scripts/blacksand-blind-compare.mjs --reveal <dir> --answers A,B,...

   Usage:
     node scripts/blacksand-critic-round.mjs --round 3
     node scripts/blacksand-critic-round.mjs --round 4 --seed 91 --quality ultra
   ============================================================ */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

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
const ROUND = String(args.round || "1");
// A fresh seed per round, or the run is comparing against the same
// pairing every time and the reviewer starts remembering panels.
const SEED = Number(args.seed || (Date.now() % 100000));
const QUALITY = String(args.quality || "ultra");
const SHOTS_DIR = `output/blacksand-shots/critic-${ROUND}`;
const BLIND_DIR = `output/blind/round-${ROUND}`;

function run(script, extra) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...extra], { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
    child.on("error", reject);
  });
}

async function main() {
  console.log(`\n=== CRITIC ROUND ${ROUND} (seed ${SEED}, quality ${QUALITY}) ===\n`);

  console.log("--- capturing beauty shots ---");
  // Captured WITH the view model, and with the action beats.
  //
  // Almost every Battlefield 2 screenshot is a first-person capture
  // with a weapon in the lower third of the frame. If our pool is
  // nothing but weaponless vistas, "which panel has a gun in it" sorts
  // the two sets perfectly and the comparison stops being blind. The
  // HUD stays hidden - that part is croppable and is handled by the
  // band in blacksand-blind-compare.mjs.
  await run("scripts/blacksand-shots.mjs", [
    "--out", SHOTS_DIR, "--quality", QUALITY, "--warm", "4",
    "--viewmodel", "--action",
  ]);

  console.log("\n--- building blind pairs ---");
  await run("scripts/blacksand-blind-compare.mjs", [
    "--ours", SHOTS_DIR, "--out", BLIND_DIR, "--seed", String(SEED),
  ]);

  // Surface the objective metrics alongside, so a reviewer's verdict
  // can be sanity-checked against numbers rather than taken on faith.
  try {
    const report = JSON.parse(await readFile(path.join(root, SHOTS_DIR, "report.json"), "utf8"));
    console.log("\n--- objective metrics ---");
    for (const shot of report.shots) {
      const m = shot.metrics;
      console.log(
        `${shot.pose.padEnd(18)} luma ${String(m.meanLuma).padStart(6)}  sd ${String(m.stdDevLuma).padStart(6)}`
        + `  clipHi ${String(m.clippedHighPct).padStart(6)}%  clipLo ${String(m.clippedLowPct).padStart(6)}%`
        + `  sat ${String(m.saturation).padStart(6)}  range ${m.tonalRange}/32`
        + (shot.warnings.length ? `   !! ${shot.warnings.length}` : "")
      );
    }
    console.log(
      `\nfps ${report.report.fps}  frameMs ${report.report.frameMs}`
      + `  calls ${report.report.render.calls}  tris ${report.report.render.triangles}`
    );
  } catch (error) {
    console.warn(`could not read metrics: ${error.message}`);
  }

  console.log(`\n=== READY ===`);
  console.log(`Reviewer opens: ${BLIND_DIR}/pair-NN/side-by-side.png`);
  console.log(`Reviewer must NOT open: ${BLIND_DIR}/_key.json`);
  console.log(`\nScore with:\n  node scripts/blacksand-blind-compare.mjs --reveal ${BLIND_DIR} --answers <A,B,...>\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
