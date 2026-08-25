#!/usr/bin/env node
/* Prepare a Meshy-rigged Saintfall playable character for the browser.

   Meshy returns a valid humanoid skin plus a zero-duration bind-pose clip.
   Saintfall owns locomotion, terrain IK, wrists, and free-arm posing at
   runtime, so that placeholder clip must not remain in the shipped GLB.

   Usage:
     node scripts/saintfall-prepare-playable.mjs \
       --in assets/models/saintfall/red-bastion/red-bastion-player-rigged.glb \
       --out assets/models/saintfall/red-bastion/red-bastion-player.glb
*/

import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress } from "@gltf-transform/functions";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) args[key] = true;
    else {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.in || !args.out) {
  throw new Error("Both --in and --out are required");
}

const input = path.resolve(projectRoot, String(args.in));
const output = path.resolve(projectRoot, String(args.out));
const maxTriangles = Number(args["max-triangles"] || 60000);
const maxSizeMb = Number(args["max-size-mb"] || 6);

const requiredBones = [
  "Spine",
  "Head",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightArm",
  "RightForeArm",
  "RightHand",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "LeftToeBase",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
  "RightToeBase",
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);
const gltf = document.getRoot();
const before = statSync(input).size;
const removedAnimations = gltf.listAnimations().map((animation) => animation.getName());
for (const animation of gltf.listAnimations()) animation.dispose();

await document.transform(
  dedup(),
  prune(),
  textureCompress({
    encoder: sharp,
    targetFormat: "webp",
    resize: [2048, 2048],
    quality: Number(args["texture-quality"] || 90),
    effort: 5,
  }),
);

mkdirSync(path.dirname(output), { recursive: true });
await io.write(output, document);

let triangles = 0;
let invalidValues = 0;
for (const mesh of gltf.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute("POSITION");
    if (!position) throw new Error("Playable mesh primitive is missing POSITION");
    for (const value of position.getArray()) {
      if (!Number.isFinite(value)) invalidValues += 1;
    }
    const count = primitive.getIndices()?.getCount() ?? position.getCount();
    if (count % 3 !== 0) throw new Error(`Non-triangular index count: ${count}`);
    triangles += count / 3;
  }
}

const nodeNames = new Set(gltf.listNodes().map((node) => node.getName()));
const missingBones = requiredBones.filter((name) => !nodeNames.has(name));
const skins = gltf.listSkins();
const after = statSync(output).size;
const relativeInput = path.relative(projectRoot, input);
const relativeOutput = path.relative(projectRoot, output);

console.log(`${relativeInput} -> ${relativeOutput}`);
console.log(`  ${(before / 1048576).toFixed(2)}MB -> ${(after / 1048576).toFixed(2)}MB`);
console.log(`  ${triangles.toLocaleString()} triangles · ${gltf.listMeshes().length} mesh · `
  + `${skins[0]?.listJoints().length ?? 0} joints · ${gltf.listTextures().length} texture`);
console.log(`  removed ${removedAnimations.length} runtime-conflicting clip(s): `
  + `${removedAnimations.join(", ") || "none"}`);

if (gltf.listMeshes().length !== 1) throw new Error("Playable character must contain exactly one mesh");
if (skins.length !== 1) throw new Error("Playable character must contain exactly one skin");
if (skins[0].listJoints().length < 20) throw new Error("Playable skin has too few humanoid joints");
if (gltf.listAnimations().length !== 0) throw new Error("Runtime playable must not contain baked clips");
if (missingBones.length) throw new Error(`Playable rig is missing: ${missingBones.join(", ")}`);
if (invalidValues) throw new Error(`Playable mesh contains ${invalidValues} invalid accessor values`);
if (triangles > maxTriangles) throw new Error(`Triangle budget exceeded: ${triangles} > ${maxTriangles}`);
if (after > maxSizeMb * 1048576) throw new Error(`Download budget exceeded: ${after} bytes`);
