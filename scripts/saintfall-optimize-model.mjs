#!/usr/bin/env node
/* ============================================================
   SAINTFALL - enemy model post-process

   Takes a raw Blender export and produces the runtime .glb.

   Two jobs, and the first is a correctness fix rather than a size
   one:

   1. STRIP ANIMATION CHANNELS THE RUNTIME MUST OWN.
      Blender's glTF exporter writes a track for every bone in the
      armature on every action, whether or not that bone was keyed.
      SAINTFALL solves leg placement procedurally against
      `terrain.heightAt`, because the level is 45-degree crater
      walls, dune slip faces and trench floors and a baked cycle
      foot-slides on all of them. A clip that also drives the legs
      fights the solver every frame, and whichever writes last wins
      - which presents as jitter and is actually two systems
      disagreeing about who owns a bone.

      So: leg channels are removed from every clip except the ones
      named in `--own-legs` (death, normally, because a corpse whose
      feet are still being solved against the ground stands back up).

   2. Ordinary glTF hygiene: dedup, prune, and a report.

   Usage:
     node scripts/saintfall-optimize-model.mjs \
       --in assets/models/saintfall/thresher.raw.glb \
       --out assets/models/saintfall/thresher.glb \
       --leg-bones '^(coxa|femur|tibia|foot)' --own-legs death
   ============================================================ */

import { readFileSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { dedup, prune } from "@gltf-transform/functions";

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
const IN = path.resolve(root, args.in);
const OUT = path.resolve(root, args.out);
const LEG_RE = new RegExp(String(args["leg-bones"] || "^(coxa|femur|tibia|foot)"));
const OWN_LEGS = new Set(String(args["own-legs"] || "death").split(",").map((s) => s.trim()));

async function main() {
  const io = new NodeIO();
  const doc = await io.read(IN);
  const rootNode = doc.getRoot();
  const before = statSync(IN).size;

  const summary = [];
  for (const anim of rootNode.listAnimations()) {
    const name = anim.getName();
    const keepLegs = OWN_LEGS.has(name);
    let removed = 0;
    let kept = 0;
    for (const channel of anim.listChannels()) {
      const target = channel.getTargetNode();
      const bone = target ? target.getName() : "";
      if (!keepLegs && LEG_RE.test(bone)) {
        const sampler = channel.getSampler();
        channel.dispose();
        // A sampler with no channel left pointing at it is dead
        // weight; prune() below would find it, but disposing here
        // keeps the accounting honest.
        if (sampler && sampler.listParents().length <= 1) sampler.dispose();
        removed += 1;
      } else {
        kept += 1;
      }
    }
    summary.push({ name, keptChannels: kept, removedLegChannels: removed, ownsLegs: keepLegs });
  }

  await doc.transform(dedup(), prune());

  mkdirSync(path.dirname(OUT), { recursive: true });
  await io.write(OUT, doc);
  const after = statSync(OUT).size;

  const prim = rootNode.listMeshes()[0].listPrimitives()[0];
  const idx = prim.getIndices();
  const tris = Math.round((idx ? idx.getCount() : prim.getAttribute("POSITION").getCount()) / 3);

  console.log(`${path.relative(root, IN)} -> ${path.relative(root, OUT)}`);
  console.log(`  ${(before / 1024).toFixed(1)}KB -> ${(after / 1024).toFixed(1)}KB `
    + `(${(((after - before) / before) * 100).toFixed(1)}%)`);
  console.log(`  ${tris} triangles · ${rootNode.listSkins()[0]?.listJoints().length ?? 0} joints `
    + `· ${rootNode.listTextures().length} textures · ${prim.listSemantics().join(",")}`);
  for (const s of summary) {
    console.log(`  ${s.name.padEnd(9)} kept ${String(s.keptChannels).padStart(3)} `
      + `· stripped ${String(s.removedLegChannels).padStart(3)} leg channels`
      + (s.ownsLegs ? "   <- owns the legs" : ""));
  }

  // Hard gate: nothing but a clip in --own-legs may touch a leg bone.
  let leaked = 0;
  for (const anim of rootNode.listAnimations()) {
    if (OWN_LEGS.has(anim.getName())) continue;
    for (const channel of anim.listChannels()) {
      const n = channel.getTargetNode();
      if (n && LEG_RE.test(n.getName())) leaked += 1;
    }
  }
  if (leaked) {
    console.error(`\nFAILED: ${leaked} leg channel(s) survived in body-only clips`);
    process.exitCode = 1;
  }
  void readFileSync;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
