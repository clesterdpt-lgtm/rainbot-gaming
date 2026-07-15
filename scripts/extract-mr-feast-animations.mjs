#!/usr/bin/env node

/**
 * Extract Meshy's animation clips into tiny, mesh-free GLBs.
 *
 * One-time local dependency setup:
 *   npm install --no-save --package-lock=false \
 *     @gltf-transform/core@4.4.1 \
 *     @gltf-transform/extensions@4.4.1 \
 *     @gltf-transform/functions@4.4.1
 *
 * Usage:
 *   node scripts/extract-mr-feast-animations.mjs --force
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";

const MOTIONS = ["idle", "walk", "alert", "run"];

function parseArgs(argv) {
  const args = {
    sourceDir: "assets/models/mr-feast",
    outputDir: "assets/models/mr-feast/animations",
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--source-dir") args.sourceDir = argv[++index];
    else if (token === "--output-dir") args.outputDir = argv[++index];
    else if (token === "--force") args.force = true;
    else if (token === "--help" || token === "-h") {
      console.log("Usage: node scripts/extract-mr-feast-animations.mjs [--source-dir DIR] [--output-dir DIR] [--force]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.sourceDir || !args.outputDir) throw new Error("Source and output directories are required");
  return args;
}

function clipTiming(animation) {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const sampler of animation.listSamplers()) {
    const input = sampler.getInput();
    if (!input) continue;
    const values = input.getArray();
    for (const value of values) {
      first = Math.min(first, value);
      last = Math.max(last, value);
    }
  }
  return Number.isFinite(first)
    ? { firstKeySeconds: first, lastKeySeconds: last, durationSeconds: last }
    : { firstKeySeconds: 0, lastKeySeconds: 0, durationSeconds: 0 };
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

async function extractAnimation(io, inputPath, outputPath, stableName, force) {
  if (!force && (await exists(outputPath))) {
    throw new Error(`Refusing to replace ${outputPath} without --force`);
  }

  const document = await io.read(inputPath);
  const root = document.getRoot();
  const animations = root.listAnimations();
  if (animations.length !== 1) {
    throw new Error(`${inputPath}: expected exactly one animation, found ${animations.length}`);
  }

  const animation = animations[0];
  animation.setName(stableName);
  const timing = clipTiming(animation);

  for (const node of [...root.listNodes()]) {
    if (node.getMesh()) node.dispose();
  }
  for (const skin of [...root.listSkins()]) skin.dispose();

  await document.transform(prune());

  const counts = {
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    skins: root.listSkins().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    animations: root.listAnimations().length,
    channels: animation.listChannels().length,
  };
  if (counts.animations !== 1 || counts.channels !== 72 || counts.meshes || counts.skins) {
    throw new Error(`${stableName}: unexpected extracted asset shape ${JSON.stringify(counts)}`);
  }

  await io.write(outputPath, document);
  const outputStats = await stat(outputPath);
  return {
    name: stableName,
    source: path.basename(inputPath),
    file: path.basename(outputPath),
    bytes: outputStats.size,
    ...timing,
    ...counts,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.sourceDir);
  const outputDir = path.resolve(args.outputDir);
  await mkdir(outputDir, { recursive: true });

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const clips = [];
  for (const motion of MOTIONS) {
    const inputPath = path.join(sourceDir, `mr-feast-${motion}.glb`);
    const outputPath = path.join(outputDir, `mr-feast-${motion}.glb`);
    clips.push(await extractAnimation(io, inputPath, outputPath, motion, args.force));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    format: "animation-only-glb",
    totalBytes: clips.reduce((sum, clip) => sum + clip.bytes, 0),
    clips,
  };
  const reportPath = path.join(outputDir, "mr-feast-animation-report.json");
  if (!args.force && (await exists(reportPath))) {
    throw new Error(`Refusing to replace ${reportPath} without --force`);
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
