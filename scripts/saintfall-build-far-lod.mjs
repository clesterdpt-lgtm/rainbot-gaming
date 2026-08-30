#!/usr/bin/env node
/* ============================================================
   SAINTFALL - far-LOD variant builder

   Produces the "<name>-far.glb" a landmark swaps to past its LOD
   distance (see addAuthoredLandmark in world.js). Quadric edge
   collapse via meshoptimizer, with the error bound expressed as a
   fraction of the mesh radius - the runtime swap distance is chosen
   so that bound lands under one device pixel, which is what makes
   the switch invisible rather than merely "probably fine".

   The far file keeps its own (shrunken) textures only as a fallback:
   at runtime the far meshes are re-pointed at the FULL model's
   patched materials, so no second texture set is ever uploaded and
   the shading matches to the bit. See the far-material note in
   world.js.

   Usage:
     node scripts/saintfall-build-far-lod.mjs \
       --in assets/models/saintfall/meshy/gilded-reach-choir-wheel.glb \
       [--ratio 0.18] [--error 0.006] [--texture-size 256]
   ============================================================ */

import path from "node:path";
import { statSync } from "node:fs";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

const root = path.resolve(path.dirname(import.meta.dirname ?? "."), "..");

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

function countTris(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute("POSITION");
      tris += Math.floor((idx ? idx.getCount() : pos.getCount()) / 3);
    }
  }
  return tris;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.in;
  if (!input) throw new Error("Missing required --in");
  const inPath = path.resolve(process.cwd(), input);
  const outPath = args.out
    ? path.resolve(process.cwd(), args.out)
    : inPath.replace(/\.glb$/i, "-far.glb");
  const ratio = Number(args.ratio ?? 0.17);
  const error = Number(args.error ?? 0.012);
  const textureSize = Number(args["texture-size"] ?? 256);

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(inPath);
  const before = countTris(doc);

  await MeshoptSimplifier.ready;

  /* NOT gltf-transform's simplify(). Meshy splits a vertex along every
     UV-island seam (this wheel: 26,691 verts for 17,712 tris), and an
     attribute-aware simplify treats each island boundary as a border
     it may not move - measured on this model, the collapse stalls at
     61% no matter how loose the error bound is.

     So the collapse runs on POSITION-WELDED connectivity instead, the
     way gltfpack's -si does: seam twins share exact position bits, so
     an exact-bits weld merges them for topology purposes only. The
     output indices then reference one twin per welded slot, which
     means a seam-adjacent triangle can sample the other island's
     patch of the atlas. That is a real (tiny) UV lie, and it is why
     this variant is only ever shown past the LOD distance, where the
     whole object is a few dozen pixels. Everything nearer renders the
     untouched original. */
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const posAttr = prim.getAttribute("POSITION");
      const idxAcc = prim.getIndices();
      if (!posAttr || !idxAcc) continue;
      const positions = posAttr.getArray();
      const srcIndices = idxAcc.getArray();

      // Position-bits weld map: vertex -> first vertex with identical bits.
      const seen = new Map();
      const remap = new Uint32Array(posAttr.getCount());
      const posU32 = new Uint32Array(positions.buffer, positions.byteOffset, positions.length);
      for (let v = 0; v < remap.length; v += 1) {
        const key = `${posU32[v * 3]}:${posU32[v * 3 + 1]}:${posU32[v * 3 + 2]}`;
        const first = seen.get(key);
        if (first === undefined) { seen.set(key, v); remap[v] = v; }
        else remap[v] = first;
      }
      const welded = new Uint32Array(srcIndices.length);
      for (let i = 0; i < srcIndices.length; i += 1) welded[i] = remap[srcIndices[i]];

      const targetIndexCount = 3 * Math.max(1, Math.floor((srcIndices.length / 3) * ratio));
      /* 'Prune' removes disconnected components smaller than the error
         bound - this wheel is thousands of separate rivets and beads,
         which is why a plain collapse stalls at 93% (measured; no
         error cap moved it). 'Sparse' is required alongside it: with
         the full-buffer analysis the same call still returns the
         stalled result, with it the target is reached at HALF the
         error cap (measured 2,994 tris at 0.0053 of extent). */
      const [outIndices, achievedError] = MeshoptSimplifier.simplify(
        welded, positions, 3, targetIndexCount, error, ["Prune", "Sparse"]
      );

      // Compact: keep only referenced vertices, rewrite every attribute.
      const used = new Map();
      const compact = new Uint32Array(outIndices.length);
      for (let i = 0; i < outIndices.length; i += 1) {
        const v = outIndices[i];
        let slot = used.get(v);
        if (slot === undefined) { slot = used.size; used.set(v, slot); }
        compact[i] = slot;
      }
      for (const semantic of prim.listSemantics()) {
        const attr = prim.getAttribute(semantic);
        const size = attr.getElementSize();
        const src = attr.getArray();
        const dst = new src.constructor(used.size * size);
        for (const [v, slot] of used) {
          for (let k = 0; k < size; k += 1) dst[slot * size + k] = src[v * size + k];
        }
        attr.setArray(dst);
      }
      idxAcc.setArray(used.size <= 65535 ? new Uint16Array(compact) : compact);
      console.log(`  ${mesh.getName()}: achieved error ${(achievedError).toFixed(5)} of extent`);
    }
  }

  await doc.transform(
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [textureSize, textureSize] }),
    prune()
  );
  const after = countTris(doc);

  await io.write(outPath, doc);
  const kb = (statSync(outPath).size / 1024).toFixed(0);
  console.log(`${path.relative(root, inPath)} -> ${path.relative(root, outPath)}`);
  console.log(`tris ${before} -> ${after} (${(100 * after / before).toFixed(1)}%), ${kb} KB, error bound ${error} of radius`);
}

main().catch((e) => { console.error(e); process.exit(1); });
