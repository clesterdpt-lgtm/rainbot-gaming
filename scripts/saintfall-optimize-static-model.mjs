#!/usr/bin/env node
/* ============================================================
   SAINTFALL - static GLB post-process

   Meshy static props arrive with game-ready geometry but oversized PBR
   atlases. Saintfall intentionally loads ordinary GLBs without a mesh
   compression decoder, so this pass keeps the mesh uncompressed while
   deduplicating/pruning the document and resizing every embedded texture
   into a browser-sized WebP.

   Usage:
     node scripts/saintfall-optimize-static-model.mjs \
       --in assets/models/saintfall/meshy/prop-master.glb \
       --out assets/models/saintfall/meshy/prop.glb \
       --texture-size 2048 --texture-quality 90 \
       --max-triangles 40000 --max-mb 6
   ============================================================ */

import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress } from "@gltf-transform/functions";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i += 1; }
  }
  return args;
}

function required(args, name) {
  const value = args[name];
  if (value === undefined || value === true || value === "") {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

function positiveNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return number;
}

const args = parseArgs(process.argv.slice(2));
const input = path.resolve(root, required(args, "in"));
const output = path.resolve(root, required(args, "out"));
const textureSize = positiveNumber(args["texture-size"] || 2048, "texture-size");
const textureQuality = positiveNumber(args["texture-quality"] || 90, "texture-quality");
const maxTriangles = positiveNumber(args["max-triangles"] || 50000, "max-triangles");
const maxBytes = positiveNumber(args["max-mb"] || 6, "max-mb") * 1048576;

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(input);
  const gltf = document.getRoot();

  if (gltf.listSkins().length) throw new Error("static prop unexpectedly contains a skin");
  if (gltf.listAnimations().length) throw new Error("static prop unexpectedly contains animations");

  await document.transform(
    dedup(),
    prune(),
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [textureSize, textureSize],
      quality: textureQuality,
      effort: 5,
    }),
  );

  let triangles = 0;
  let invalidValues = 0;
  for (const mesh of gltf.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (!position) throw new Error(`mesh ${mesh.getName() || "<unnamed>"} is missing POSITION`);
      const positions = position.getArray();
      for (const value of positions) if (!Number.isFinite(value)) invalidValues += 1;
      const count = primitive.getIndices()?.getCount() || position.getCount();
      if (count % 3) throw new Error(`non-triangular primitive index count: ${count}`);
      triangles += count / 3;
    }
  }

  if (invalidValues) throw new Error(`${invalidValues} non-finite position values`);
  if (triangles > maxTriangles) {
    throw new Error(`triangle budget exceeded: ${triangles} > ${maxTriangles}`);
  }

  mkdirSync(path.dirname(output), { recursive: true });
  await io.write(output, document);

  const before = statSync(input).size;
  const after = statSync(output).size;
  if (after > maxBytes) {
    throw new Error(`download budget exceeded: ${(after / 1048576).toFixed(2)}MB`);
  }

  console.log(`${path.relative(root, input)} -> ${path.relative(root, output)}`);
  console.log(`  ${(before / 1048576).toFixed(2)}MB -> ${(after / 1048576).toFixed(2)}MB`);
  console.log(`  ${Math.round(triangles).toLocaleString()} triangles · ${gltf.listMeshes().length} mesh`
    + ` · ${gltf.listMaterials().length} material · ${gltf.listTextures().length} textures`);
  console.log(`  textures <= ${textureSize}px WebP · no mesh compression`);
}

main().catch((error) => {
  console.error(`Static model optimization failed: ${error.message}`);
  process.exitCode = 1;
});
