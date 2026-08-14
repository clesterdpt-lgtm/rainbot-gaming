#!/usr/bin/env node
/* ============================================================
   APOP DEMON MOGGERS 3D - one round of the art-director critic loop

   Mechanises the parts of a review round that do not need judgement:

     1. capture shots at the current build
     2. build a blind A/B set against the Super Mario 64 references
     3. print the directory the reviewing agent should open

   The judgement itself is done by a separate agent which must NOT see
   `_key.json`. Score it afterwards with:

     node scripts/apop3d-blind-compare.mjs --reveal <dir> --answers A,B,...

   Usage:
     node scripts/apop3d-critic-round.mjs --round 1
     node scripts/apop3d-critic-round.mjs --round 2 --course 1 --seed 91
     node scripts/apop3d-critic-round.mjs --round 3 --soft   (matched softness)
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
// A fresh seed per round, or the run compares against the same pairing
// every time and the reviewer starts recognising panels.
const SEED = Number(args.seed || (Date.now() % 100000));
const COURSE = String(args.course ?? "1");
const SOFT = Boolean(args.soft);
const SHOTS_DIR = `output/apop3d-shots/critic-${ROUND}`;
const BLIND_DIR = `output/apop3d-blind/round-${ROUND}`;

function run(script, extra) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, ...extra], { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
    child.on("error", reject);
  });
}

async function main() {
  process.stdout.write(`\n=== CRITIC ROUND ${ROUND}  (course ${COURSE}, seed ${SEED}${SOFT ? ", softness matched" : ""}) ===\n\n`);

  process.stdout.write("1. Capturing shots\n");
  await run("scripts/apop3d-shots.mjs", ["--out", SHOTS_DIR, "--course", COURSE]);

  // A round built on skipped or blank frames wastes a full review, so
  // fail here rather than handing the critic a folder of black panels.
  const diag = JSON.parse(await readFile(path.join(root, SHOTS_DIR, "_diagnostics.json"), "utf8"));
  const usable = diag.shots.filter((s) => !s.skipped && !s.blank);
  const skipped = diag.shots.filter((s) => s.skipped);
  const blank = diag.shots.filter((s) => s.blank);
  process.stdout.write(`   ${usable.length} usable, ${skipped.length} skipped, ${blank.length} blank\n`);
  if (skipped.length) process.stdout.write(`   skipped: ${skipped.map((s) => s.preset).join(", ")}\n`);
  if (blank.length) process.stdout.write(`   BLANK:   ${blank.map((s) => s.preset).join(", ")}\n`);
  if (diag.console.length) {
    process.stdout.write(`   console issues (${diag.console.length}):\n`);
    for (const line of diag.console.slice(0, 12)) process.stdout.write(`     ${line}\n`);
  }
  if (!usable.length) throw new Error("no usable shots — fix capture before running a review round");

  /* Never build a review round on frames the harness does not trust.
     A run that hit an engine error still writes PNGs - they just show
     a stand-in pose or a stale scene - and those are indistinguishable
     from real captures once they are cropped into a blind pair. A
     reviewer's time is the scarce resource here; spending it on
     frames that never rendered what they claim is worse than not
     running the round at all. */
  if (diag.trustworthy === false) {
    throw new Error(
      `capture reported ${diag.engineErrors} engine error(s) and is marked untrustworthy.\n`
      + "Fix the error and recapture before reviewing - do not score these frames."
    );
  }

  process.stdout.write("\n2. Building blind pairs\n");
  const compareArgs = [
    "--ours", SHOTS_DIR, "--out", BLIND_DIR, "--seed", String(SEED),
  ];
  if (SOFT) compareArgs.push("--match-softness");
  await run("scripts/apop3d-blind-compare.mjs", compareArgs);

  process.stdout.write(`\n3. Review\n`);
  process.stdout.write(`   Open each ${BLIND_DIR}/pair-NN/sheet.png and record A or B.\n`);
  process.stdout.write(`   Do NOT open ${BLIND_DIR}/_key.json.\n\n`);
  process.stdout.write(`   Score with:\n`);
  process.stdout.write(`     node scripts/apop3d-blind-compare.mjs --reveal ${BLIND_DIR} --answers A,B,...\n\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
