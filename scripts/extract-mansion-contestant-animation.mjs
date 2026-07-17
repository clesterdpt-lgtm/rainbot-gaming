#!/usr/bin/env node

/**
 * Reduce one Meshy character motion to a stationary, mesh-free runtime clip.
 *
 * Usage:
 *   node scripts/extract-mansion-contestant-animation.mjs \
 *     --input assets/models/mr-feast/source/contestants/mara-voss-idle.glb \
 *     --output assets/models/mr-feast/contestants/mara-voss-idle.glb \
 *     --name idle --force
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";

function parseArgs(argv) {
  const args = { name: "idle", force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") args.input = argv[++index];
    else if (token === "--output") args.output = argv[++index];
    else if (token === "--name") args.name = argv[++index];
    else if (token === "--force") args.force = true;
    else if (token === "--help" || token === "-h") {
      console.log("Usage: node scripts/extract-mansion-contestant-animation.mjs --input FILE --output FILE [--name idle] [--force]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.input || !args.output) throw new Error("--input and --output are required");
  return args;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function channelCounts(animation) {
  const counts = { rotation: 0, translation: 0, scale: 0, weights: 0, other: 0 };
  for (const channel of animation.listChannels()) {
    const targetPath = channel.getTargetPath();
    if (targetPath in counts) counts[targetPath] += 1;
    else counts.other += 1;
  }
  return counts;
}

function shiftTimeToZero(animation) {
  const visited = new Set();
  for (const sampler of animation.listSamplers()) {
    const input = sampler.getInput();
    if (!input || visited.has(input)) continue;
    visited.add(input);
    const values = input.getArray();
    if (!values?.length || values[0] === 0) continue;
    input.setArray(Float32Array.from(values, (value) => value - values[0]));
  }
}

function closeLoop(animation) {
  for (const sampler of animation.listSamplers()) {
    const output = sampler.getOutput();
    const values = output?.getArray();
    const elementSize = output?.getElementSize() || 0;
    if (!values?.length || elementSize <= 0 || values.length < elementSize * 2) continue;
    const closed = new Float32Array(values);
    closed.set(closed.slice(0, elementSize), closed.length - elementSize);
    output.setArray(closed);
    sampler.setInterpolation("LINEAR");
  }
}

function clipDuration(animation) {
  let duration = 0;
  for (const sampler of animation.listSamplers()) {
    const values = sampler.getInput()?.getArray();
    if (values?.length) duration = Math.max(duration, values[values.length - 1]);
  }
  return duration;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  const reportPath = outputPath.replace(/\.glb$/i, ".animation-report.json");
  if (!args.force && ((await exists(outputPath)) || (await exists(reportPath)))) {
    throw new Error("Refusing to replace contestant animation outputs without --force");
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(inputPath);
  const root = document.getRoot();
  const animations = root.listAnimations();
  if (animations.length !== 1) throw new Error(`Expected one animation, found ${animations.length}`);
  const animation = animations[0];
  animation.setName(args.name);
  const before = channelCounts(animation);

  // Stationary social NPCs only need the authored skeletal rotations. Meshy's
  // per-bone scale and translation keys can resize or drift a fitted model.
  for (const channel of [...animation.listChannels()]) {
    if (channel.getTargetPath() !== "rotation") channel.dispose();
  }
  shiftTimeToZero(animation);
  closeLoop(animation);

  for (const node of root.listNodes()) {
    if (node.getMesh()) node.setMesh(null);
    if (node.getSkin()) node.setSkin(null);
  }
  for (const skin of [...root.listSkins()]) skin.dispose();
  for (const mesh of [...root.listMeshes()]) mesh.dispose();
  await document.transform(prune());

  const after = channelCounts(animation);
  if (after.rotation < 20 || after.rotation > 32 || after.translation || after.scale || after.weights || after.other) {
    throw new Error(`Unexpected stationary animation channels ${JSON.stringify(after)}`);
  }
  const counts = {
    animations: root.listAnimations().length,
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    skins: root.listSkins().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
  };
  if (counts.animations !== 1 || counts.meshes || counts.skins || counts.materials || counts.textures) {
    throw new Error(`Animation extraction left runtime baggage ${JSON.stringify(counts)}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await io.write(outputPath, document);
  const outputStats = await stat(outputPath);
  const report = {
    generatedAt: new Date().toISOString(),
    format: "animation-only-glb",
    source: path.relative(process.cwd(), inputPath),
    file: path.basename(outputPath),
    name: args.name,
    stationary: true,
    loopClosed: true,
    compression: "none",
    bytes: outputStats.size,
    durationSeconds: clipDuration(animation),
    channelsBefore: before,
    channelsAfter: after,
    ...counts,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
