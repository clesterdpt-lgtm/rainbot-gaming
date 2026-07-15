#!/usr/bin/env node

/**
 * Build restrained, scale-stable Mr. Feast animation-only GLBs.
 *
 * The Meshy clips key translation, rotation, and scale on every bone. In the
 * supplied idle, Hips.scale is 1.17647 while the walk uses 1.0, so an ordinary
 * cross-fade visibly enlarges the whole character. This pass removes every
 * scale track and every non-Hips translation track, recenters Hips on the base
 * rig, and reduces the large limb arcs for the slow mansion stalk.
 *
 * Usage:
 *   node scripts/tune-mr-feast-animations.mjs --force
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune } from "@gltf-transform/functions";

const MOTIONS = Object.freeze([
  Object.freeze({
    source: "mr-feast-idle.glb",
    output: "mr-feast-idle-tuned.glb",
    name: "idle",
    profile: "idle",
    loop: true,
    hipsWeights: [0.03, 0.08, 0.03],
  }),
  Object.freeze({
    source: "mr-feast-walk.glb",
    output: "mr-feast-stalk-tuned.glb",
    name: "stalk",
    profile: "stalk",
    loop: true,
    hipsWeights: [0.08, 0.30, 0.08],
  }),
  Object.freeze({
    source: "mr-feast-alert.glb",
    output: "mr-feast-alert-clean.glb",
    name: "alert",
    profile: "preserve",
    loop: false,
    hipsWeights: [0.10, 0.22, 0.10],
  }),
  Object.freeze({
    source: "mr-feast-run.glb",
    output: "mr-feast-run-clean.glb",
    name: "run",
    profile: "preserve",
    loop: true,
    hipsWeights: [0.18, 0.45, 0.18],
  }),
]);

function parseArgs(argv) {
  const args = {
    sourceDir: "assets/models/mr-feast/animations",
    outputDir: "assets/models/mr-feast/animations",
    baseModel: "assets/models/mr-feast/processed/mr-feast-game-rigged.glb",
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--source-dir") args.sourceDir = argv[++index];
    else if (token === "--output-dir") args.outputDir = argv[++index];
    else if (token === "--base-model") args.baseModel = argv[++index];
    else if (token === "--force") args.force = true;
    else if (token === "--help" || token === "-h") {
      console.log("Usage: node scripts/tune-mr-feast-animations.mjs [--source-dir DIR] [--output-dir DIR] [--base-model GLB] [--force]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
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

function normalizeQuaternion(values) {
  const length = Math.hypot(values[0], values[1], values[2], values[3]) || 1;
  return values.map((value) => value / length);
}

function slerpQuaternion(fromValues, toValues, amount) {
  const from = normalizeQuaternion(fromValues);
  let to = normalizeQuaternion(toValues);
  let cosine = from.reduce((sum, value, index) => sum + value * to[index], 0);
  if (cosine < 0) {
    to = to.map((value) => -value);
    cosine = -cosine;
  }
  cosine = Math.min(1, Math.max(-1, cosine));
  if (cosine > 0.9995) {
    return normalizeQuaternion(from.map((value, index) => value + (to[index] - value) * amount));
  }
  const angle = Math.acos(cosine);
  const sine = Math.sin(angle);
  const fromWeight = Math.sin((1 - amount) * angle) / sine;
  const toWeight = Math.sin(amount * angle) / sine;
  return from.map((value, index) => value * fromWeight + to[index] * toWeight);
}

function rotationWeight(profile, boneName) {
  if (profile === "preserve") return 1;
  if (profile === "idle") {
    if (/headfront|head_end/i.test(boneName)) return 0.04;
    if (/head|neck/i.test(boneName)) return 0.08;
    if (/shoulder|arm|hand/i.test(boneName)) return 0.10;
    if (/upleg|leg|foot|toe/i.test(boneName)) return 0.10;
    return 0.10;
  }
  if (/shoulder/i.test(boneName)) return 0.15;
  if (/forearm/i.test(boneName)) return 0.24;
  if (/arm/i.test(boneName)) return 0.20;
  if (/hand/i.test(boneName)) return 0.18;
  if (/upleg/i.test(boneName)) return 0.48;
  if (/^LeftLeg$|^RightLeg$/i.test(boneName)) return 0.52;
  if (/foot|toe/i.test(boneName)) return 0.48;
  if (/head|neck/i.test(boneName)) return 0.18;
  if (/spine|hips/i.test(boneName)) return 0.30;
  return 0.30;
}

function firstRotationByBone(document) {
  const animation = document.getRoot().listAnimations()[0];
  if (!animation) throw new Error("Idle source has no animation");
  const rotations = new Map();
  for (const channel of animation.listChannels()) {
    if (channel.getTargetPath() !== "rotation") continue;
    const nodeName = channel.getTargetNode()?.getName();
    const values = channel.getSampler()?.getOutput()?.getArray();
    if (nodeName && values?.length >= 4) rotations.set(nodeName, Array.from(values.slice(0, 4)));
  }
  return rotations;
}

function recenterHips(values, basePosition, weights) {
  const count = values.length / 3;
  const means = [0, 0, 0];
  for (let index = 0; index < count; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) means[axis] += values[index * 3 + axis] / count;
  }
  const tuned = new Float32Array(values.length);
  for (let index = 0; index < count; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      tuned[index * 3 + axis] = basePosition[axis]
        + (values[index * 3 + axis] - means[axis]) * weights[axis];
    }
  }
  return tuned;
}

function tuneRotations(values, neutral, amount) {
  const tuned = new Float32Array(values.length);
  for (let offset = 0; offset < values.length; offset += 4) {
    tuned.set(slerpQuaternion(neutral, Array.from(values.slice(offset, offset + 4)), amount), offset);
  }
  return tuned;
}

function closeLoop(animation) {
  for (const sampler of animation.listSamplers()) {
    const output = sampler.getOutput();
    const values = output?.getArray();
    if (!values?.length) continue;
    const elementSize = output.getElementSize();
    if (values.length < elementSize * 2) continue;
    const closed = new Float32Array(values);
    closed.set(closed.slice(0, elementSize), closed.length - elementSize);
    output.setArray(closed);
  }
}

function shiftClipToZero(animation) {
  const visited = new Set();
  for (const sampler of animation.listSamplers()) {
    const input = sampler.getInput();
    if (!input || visited.has(input)) continue;
    visited.add(input);
    const values = input.getArray();
    if (!values?.length) continue;
    const first = values[0];
    input.setArray(Float32Array.from(values, (value) => value - first));
  }
}

function channelCounts(animation) {
  const counts = { rotation: 0, translation: 0, scale: 0, other: 0 };
  for (const channel of animation.listChannels()) {
    const pathName = channel.getTargetPath();
    if (pathName in counts) counts[pathName] += 1;
    else counts.other += 1;
  }
  return counts;
}

async function tuneMotion(io, spec, sourceDir, outputDir, idleNeutral, baseHips, force) {
  const inputPath = path.join(sourceDir, spec.source);
  const outputPath = path.join(outputDir, spec.output);
  if (!force && await exists(outputPath)) throw new Error(`Refusing to replace ${outputPath} without --force`);
  const document = await io.read(inputPath);
  const root = document.getRoot();
  const animations = root.listAnimations();
  if (animations.length !== 1) throw new Error(`${inputPath}: expected one animation, found ${animations.length}`);
  const animation = animations[0];
  const before = channelCounts(animation);
  animation.setName(spec.name);

  for (const channel of [...animation.listChannels()]) {
    const targetPath = channel.getTargetPath();
    const boneName = channel.getTargetNode()?.getName() || "";
    const sampler = channel.getSampler();
    const output = sampler?.getOutput();
    const values = output?.getArray();
    if (targetPath === "scale" || (targetPath === "translation" && boneName !== "Hips")) {
      channel.dispose();
      continue;
    }
    if (!values) continue;
    sampler.setInterpolation("LINEAR");
    if (targetPath === "translation" && boneName === "Hips") {
      output.setArray(recenterHips(values, baseHips, spec.hipsWeights));
    } else if (targetPath === "rotation") {
      const neutral = idleNeutral.get(boneName);
      if (!neutral) throw new Error(`${spec.name}: missing idle reference rotation for ${boneName}`);
      output.setArray(tuneRotations(values, neutral, rotationWeight(spec.profile, boneName)));
    }
  }

  shiftClipToZero(animation);
  if (spec.loop) closeLoop(animation);
  await document.transform(prune());

  const after = channelCounts(animation);
  if (after.rotation !== 24 || after.translation !== 1 || after.scale !== 0 || after.other !== 0) {
    throw new Error(`${spec.name}: unexpected tuned channels ${JSON.stringify(after)}`);
  }
  const hipsChannel = animation.listChannels().find((channel) => channel.getTargetPath() === "translation");
  if (hipsChannel?.getTargetNode()?.getName() !== "Hips") throw new Error(`${spec.name}: remaining translation is not Hips`);
  await io.write(outputPath, document);
  const outputStats = await stat(outputPath);
  const input = animation.listSamplers()[0]?.getInput()?.getArray();
  return {
    name: spec.name,
    profile: spec.profile,
    source: spec.source,
    file: spec.output,
    bytes: outputStats.size,
    durationSeconds: input?.length ? input[input.length - 1] : 0,
    hipsWeights: spec.hipsWeights,
    channelsBefore: before,
    channelsAfter: after,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.sourceDir);
  const outputDir = path.resolve(args.outputDir);
  const baseModelPath = path.resolve(args.baseModel);
  await mkdir(outputDir, { recursive: true });

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const idleSource = await io.read(path.join(sourceDir, "mr-feast-idle.glb"));
  const idleNeutral = firstRotationByBone(idleSource);
  const baseDocument = await io.read(baseModelPath);
  const baseHipsNode = baseDocument.getRoot().listNodes().find((node) => node.getName() === "Hips");
  if (!baseHipsNode) throw new Error("Base rig has no Hips node");
  const baseHips = baseHipsNode.getTranslation();

  const clips = [];
  for (const motion of MOTIONS) {
    clips.push(await tuneMotion(io, motion, sourceDir, outputDir, idleNeutral, baseHips, args.force));
  }
  const report = {
    generatedAt: new Date().toISOString(),
    format: "animation-only-glb",
    policy: "no-scale; hips-translation-only; restrained-idle-and-stalk",
    baseHips,
    clips,
  };
  const reportPath = path.join(outputDir, "mr-feast-tuning-report.json");
  if (!args.force && await exists(reportPath)) throw new Error(`Refusing to replace ${reportPath} without --force`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
