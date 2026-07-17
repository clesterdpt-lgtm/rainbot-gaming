#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const assetRoot = path.join(root, "assets/models/super-slop-brothers");
const sourceDir = path.join(assetRoot, "source");
const animationDir = path.join(assetRoot, "animations");
const processedDir = path.join(assetRoot, "processed");
const outputPath = path.join(assetRoot, "super-slop-character-manifest.json");

const CLIP_ORDER = [
  "idle",
  "run",
  "jump",
  "fall",
  "hit",
  "shield",
  "dodge",
  "grab",
  "attack",
  "special-neutral",
  "special-side",
  "special-up",
  "special-down",
];

const MESHY_ANIMATIONS = [
  "idle",
  "hit",
  "special-neutral",
  "special-side",
  "special-up",
  "special-down",
];

const FIGHTERS = [
  {
    id: "rainbot",
    specialActions: { neutral: 125, side: 96, up: 86, down: 138 },
  },
  {
    id: "gigachad",
    specialActions: { neutral: 96, side: 510, up: 94, down: 93 },
  },
  {
    id: "mrfeast",
    specialActions: { neutral: 393, side: 280, up: 86, down: 389 },
  },
  {
    id: "skibidi",
    specialActions: { neutral: 125, side: 516, up: 397, down: 398 },
  },
  {
    id: "sigma",
    specialActions: { neutral: 104, side: 94, up: 402, down: 93 },
  },
  {
    id: "slopbot",
    specialActions: { neutral: 125, side: 100, up: 384, down: 129 },
  },
];

const FRAMES_PER_CLIP = 8;
const TASK_ID_PATTERN = /^[0-9a-f-]{20,}$/i;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function repoRelative(absolutePath) {
  const relative = path.relative(root, absolutePath);
  assert(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`), `File is outside the repository: ${absolutePath}`);
  return toPosix(relative);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, label) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    fail(`${label} is missing or unreadable at ${repoRelative(filePath)}: ${error.message}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${label} is not valid JSON at ${repoRelative(filePath)}: ${error.message}`);
  }
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function fileRecord(filePath, label) {
  let details;
  try {
    details = await stat(filePath);
  } catch (error) {
    fail(`${label} is missing or unreadable at ${repoRelative(filePath)}: ${error.message}`);
  }
  assert(details.isFile(), `${label} is not a file: ${repoRelative(filePath)}`);
  assert(details.size > 0, `${label} is empty: ${repoRelative(filePath)}`);
  return {
    file: repoRelative(filePath),
    bytes: details.size,
    sha256: await sha256(filePath),
  };
}

async function resolveReportedFile(value, reportPath, label, extraBases = []) {
  assert(typeof value === "string" && value.trim(), `${label} path is missing from ${repoRelative(reportPath)}`);
  const raw = value.trim();
  const candidates = path.isAbsolute(raw)
    ? [path.normalize(raw)]
    : [
        path.resolve(root, raw),
        path.resolve(path.dirname(reportPath), raw),
        path.resolve(assetRoot, raw),
        ...extraBases.map((base) => path.resolve(base, raw)),
      ];

  for (const candidate of [...new Set(candidates)]) {
    if (await exists(candidate)) return candidate;
  }

  fail(`${label} does not resolve to an existing file from ${repoRelative(reportPath)}: ${value}`);
}

function validateTask(meta, expectedType, label) {
  assert(meta && typeof meta === "object" && !Array.isArray(meta), `${label} must be a JSON object`);
  assert(meta.type === expectedType, `${label} has type ${JSON.stringify(meta.type)}; expected ${expectedType}`);
  assert(meta.status === "SUCCEEDED", `${label} has status ${JSON.stringify(meta.status)}; expected SUCCEEDED`);
  assert(TASK_ID_PATTERN.test(meta.id || ""), `${label} is missing a valid Meshy task ID`);
  assert(Number.isFinite(meta.consumedCredits) && meta.consumedCredits >= 0, `${label} is missing consumedCredits`);
}

function credits(meta) {
  return Number(meta.consumedCredits);
}

function publicGenerationRequest(request = {}) {
  return {
    aiModel: request.ai_model ?? null,
    modelType: request.model_type ?? null,
    pbr: Boolean(request.enable_pbr),
    textured: Boolean(request.should_texture),
    remeshed: Boolean(request.should_remesh),
    topology: request.topology ?? null,
    targetPolycount: Number.isFinite(request.target_polycount) ? request.target_polycount : null,
    poseMode: request.pose_mode ?? null,
    texturePrompt: request.texture_prompt ?? null,
  };
}

function indexClips(clips, fighterId, reportLabel) {
  assert(Array.isArray(clips), `${fighterId} ${reportLabel} clips must be an array`);
  const indexed = Object.fromEntries(clips.map((clip) => [clip?.name, clip]));
  assert(Object.keys(indexed).length === CLIP_ORDER.length, `${fighterId} ${reportLabel} must contain exactly ${CLIP_ORDER.length} unique clips`);

  for (const [row, name] of CLIP_ORDER.entries()) {
    const clip = indexed[name];
    assert(clip, `${fighterId} ${reportLabel} is missing ${name}`);
    assert(clip.row === row, `${fighterId} ${reportLabel} ${name} is row ${clip.row}; expected ${row}`);
    assert(clip.frames === FRAMES_PER_CLIP, `${fighterId} ${reportLabel} ${name} declares ${clip.frames} frames; expected ${FRAMES_PER_CLIP}`);
    assert(
      Array.isArray(clip.renderedFrames) && clip.renderedFrames.length === FRAMES_PER_CLIP,
      `${fighterId} ${reportLabel} ${name} must record ${FRAMES_PER_CLIP} rendered frame files`,
    );
    assert(typeof clip.sourceMotion === "string" && clip.sourceMotion, `${fighterId} ${reportLabel} ${name} is missing sourceMotion`);
    assert(typeof clip.derived === "boolean", `${fighterId} ${reportLabel} ${name} is missing its derived flag`);
  }

  return indexed;
}

async function validateBlenderSources(fighterId, report, reportPath, expected) {
  assert(report.sourceFiles && typeof report.sourceFiles === "object", `${fighterId} Blender report is missing sourceFiles`);
  for (const [name, expectedPath] of Object.entries(expected)) {
    const reportedPath = await resolveReportedFile(
      report.sourceFiles[name],
      reportPath,
      `${fighterId} Blender source ${name}`,
      [sourceDir, animationDir],
    );
    assert(
      path.resolve(reportedPath) === path.resolve(expectedPath),
      `${fighterId} Blender source ${name} resolves to ${repoRelative(reportedPath)}; expected ${repoRelative(expectedPath)}`,
    );
  }
}

async function buildFighter(fighter) {
  const { id, specialActions } = fighter;
  const referencePath = path.join(assetRoot, "concepts", `${id}-reference.png`);
  const generationMetaPath = path.join(sourceDir, `${id}.meta.json`);
  const rigMetaPath = path.join(sourceDir, `${id}-rig.meta.json`);
  const blenderReportPath = path.join(processedDir, `${id}-blender-report.json`);
  const atlasReportPath = path.join(processedDir, `${id}-atlas-report.json`);

  const [generationMeta, rigMeta, blenderReport, atlasReport] = await Promise.all([
    readJson(generationMetaPath, `${id} Meshy generation metadata`),
    readJson(rigMetaPath, `${id} Meshy rig metadata`),
    readJson(blenderReportPath, `${id} Blender report`),
    readJson(atlasReportPath, `${id} atlas report`),
  ]);

  validateTask(generationMeta, "image-to-3d", `${id} Meshy generation metadata`);
  validateTask(rigMeta, "rig", `${id} Meshy rig metadata`);
  assert(rigMeta.inputTaskId === generationMeta.id, `${id} rig input task does not match its image-to-3D task`);

  const reference = await fileRecord(referencePath, `${id} reference image`);
  assert(
    toPosix(generationMeta.sourceImage || "") === reference.file,
    `${id} Meshy source image is ${JSON.stringify(generationMeta.sourceImage)}; expected ${reference.file}`,
  );

  assert(typeof generationMeta.masterFile === "string" && generationMeta.masterFile, `${id} generation metadata is missing masterFile`);
  assert(rigMeta.files && typeof rigMeta.files === "object", `${id} rig metadata is missing files`);
  for (const name of ["rigged", "walking", "running"]) {
    assert(typeof rigMeta.files[name] === "string" && rigMeta.files[name], `${id} rig metadata is missing files.${name}`);
  }

  const sourceMasterPath = path.join(sourceDir, generationMeta.masterFile);
  assert(Array.isArray(generationMeta.thumbnails) && generationMeta.thumbnails.length > 0, `${id} generation metadata is missing downloaded thumbnails`);
  const sourceThumbnailPaths = generationMeta.thumbnails.map((thumbnail, index) => {
    assert(typeof thumbnail === "string" && thumbnail, `${id} generation thumbnail ${index} is invalid`);
    return path.join(sourceDir, thumbnail);
  });
  const sourceRiggedPath = path.join(sourceDir, rigMeta.files.rigged);
  const sourceWalkPath = path.join(sourceDir, rigMeta.files.walking);
  const sourceRunPath = path.join(sourceDir, rigMeta.files.running);

  const animationMeta = {};
  const animationMetaPaths = {};
  const animationPaths = {};
  for (const motion of MESHY_ANIMATIONS) {
    const metaPath = path.join(animationDir, `${id}-${motion}.meta.json`);
    const meta = await readJson(metaPath, `${id} ${motion} Meshy animation metadata`);
    validateTask(meta, "animate", `${id} ${motion} Meshy animation metadata`);
    assert(meta.rigTaskId === rigMeta.id, `${id} ${motion} task does not reference rig task ${rigMeta.id}`);
    assert(Number.isInteger(meta.actionId), `${id} ${motion} is missing an integer Meshy actionId`);
    assert(typeof meta.file === "string" && meta.file, `${id} ${motion} metadata is missing its downloaded file`);
    if (motion.startsWith("special-")) {
      const direction = motion.slice("special-".length);
      assert(
        meta.actionId === specialActions[direction],
        `${id} ${motion} uses action ${meta.actionId}; expected ${specialActions[direction]}`,
      );
    }
    animationMeta[motion] = meta;
    animationMetaPaths[motion] = metaPath;
    animationPaths[motion] = path.join(animationDir, meta.file);
  }

  assert(blenderReport.fighterId === id, `${id} Blender report has fighterId ${JSON.stringify(blenderReport.fighterId)}`);
  assert(typeof blenderReport.pipeline === "string" && blenderReport.pipeline, `${id} Blender report is missing pipeline`);
  assert(typeof blenderReport.blenderVersion === "string" && blenderReport.blenderVersion, `${id} Blender report is missing blenderVersion`);
  assert(blenderReport.processedRig && typeof blenderReport.processedRig === "object", `${id} Blender report is missing processedRig`);
  assert(blenderReport.render && typeof blenderReport.render === "object", `${id} Blender report is missing render settings`);
  assert(blenderReport.render.framesPerClip === FRAMES_PER_CLIP, `${id} Blender report must render ${FRAMES_PER_CLIP} frames per clip`);
  assert(blenderReport.render.columns === FRAMES_PER_CLIP, `${id} Blender report must render ${FRAMES_PER_CLIP} columns`);
  assert(blenderReport.render.rows === CLIP_ORDER.length, `${id} Blender report must render ${CLIP_ORDER.length} rows`);
  assert(blenderReport.render.frameSize >= 160, `${id} Blender frameSize must be at least 160 pixels`);
  assert(blenderReport.render.transparent === true, `${id} Blender renders must preserve transparency`);
  const blenderClips = indexClips(blenderReport.clips, id, "Blender report");

  await validateBlenderSources(id, blenderReport, blenderReportPath, {
    base: sourceRiggedPath,
    run: sourceRunPath,
    idle: animationPaths.idle,
    hit: animationPaths.hit,
    "special-neutral": animationPaths["special-neutral"],
    "special-side": animationPaths["special-side"],
    "special-up": animationPaths["special-up"],
    "special-down": animationPaths["special-down"],
  });

  const processedRigPath = await resolveReportedFile(
    blenderReport.processedRig.file,
    blenderReportPath,
    `${id} processed rig`,
    [processedDir],
  );
  const processedRig = await fileRecord(processedRigPath, `${id} processed rig`);
  assert(
    processedRig.file === `assets/models/super-slop-brothers/processed/${id}-rigged.glb`,
    `${id} processed rig must use the canonical runtime-preservation path`,
  );
  assert(processedRig.bytes === blenderReport.processedRig.fileBytes, `${id} processed rig byte count drifted from its Blender report`);
  assert(processedRig.sha256 === blenderReport.processedRig.sha256, `${id} processed rig hash drifted from its Blender report`);
  assert(processedRig.bytes > 100_000, `${id} processed rig is unexpectedly small (${processedRig.bytes} bytes)`);
  assert(processedRig.bytes <= 15 * 1024 * 1024, `${id} processed rig exceeds 15 MiB`);

  assert(atlasReport.fighterId === id, `${id} atlas report has fighterId ${JSON.stringify(atlasReport.fighterId)}`);
  assert(atlasReport.cellSize >= 160, `${id} atlas cellSize must be at least 160 pixels`);
  assert(atlasReport.columns === FRAMES_PER_CLIP, `${id} atlas must contain ${FRAMES_PER_CLIP} columns`);
  assert(atlasReport.rows === CLIP_ORDER.length, `${id} atlas must contain ${CLIP_ORDER.length} rows`);
  assert(atlasReport.width === atlasReport.cellSize * atlasReport.columns, `${id} atlas width does not match cellSize x columns`);
  assert(atlasReport.height === atlasReport.cellSize * atlasReport.rows, `${id} atlas height does not match cellSize x rows`);
  assert(atlasReport.alpha === true, `${id} atlas must preserve alpha`);
  assert(String(atlasReport.format).toLowerCase() === "webp", `${id} runtime atlas must use WebP`);
  assert(atlasReport.visualQA && typeof atlasReport.visualQA === "object", `${id} atlas report is missing visualQA`);
  assert(atlasReport.visualQA.requiredAlphaMarginPixels >= 6, `${id} atlas must require at least a 6px alpha margin`);
  assert(atlasReport.visualQA.minimumAlphaMarginPixels >= 6, `${id} atlas contains a pose inside the 6px alpha safety margin`);
  assert(atlasReport.visualQA.clippedFrames === 0, `${id} atlas report contains clipped frames`);
  assert(atlasReport.clips && typeof atlasReport.clips === "object" && !Array.isArray(atlasReport.clips), `${id} atlas report is missing clips`);

  const clips = {};
  for (const [row, name] of CLIP_ORDER.entries()) {
    const atlasClip = atlasReport.clips[name];
    const blenderClip = blenderClips[name];
    assert(atlasClip, `${id} atlas report is missing ${name}`);
    assert(atlasClip.row === row, `${id} atlas ${name} is row ${atlasClip.row}; expected ${row}`);
    assert(atlasClip.frames === FRAMES_PER_CLIP, `${id} atlas ${name} contains ${atlasClip.frames} frames; expected ${FRAMES_PER_CLIP}`);
    assert(atlasClip.sourceMotion === blenderClip.sourceMotion, `${id} atlas ${name} sourceMotion drifted from the Blender report`);
    assert(atlasClip.derived === blenderClip.derived, `${id} atlas ${name} derived flag drifted from the Blender report`);
    assert(Boolean(atlasClip.loop) === Boolean(blenderClip.loop), `${id} atlas ${name} loop flag drifted from the Blender report`);
    clips[name] = {
      row,
      frames: FRAMES_PER_CLIP,
      loop: Boolean(atlasClip.loop),
      sourceMotion: atlasClip.sourceMotion,
      derived: atlasClip.derived,
    };
  }
  assert(Object.keys(atlasReport.clips).length === CLIP_ORDER.length, `${id} atlas report must contain exactly ${CLIP_ORDER.length} clips`);

  const sourceReportPath = await resolveReportedFile(
    atlasReport.sourceReport,
    atlasReportPath,
    `${id} atlas source report`,
    [processedDir],
  );
  assert(path.resolve(sourceReportPath) === path.resolve(blenderReportPath), `${id} atlas was not built from its Blender report`);

  const spriteSheetPath = await resolveReportedFile(
    atlasReport.runtimePath || atlasReport.output,
    atlasReportPath,
    `${id} runtime sprite sheet`,
    [path.join(root, "assets/img/super-slop-brothers"), processedDir],
  );
  const spriteSheet = await fileRecord(spriteSheetPath, `${id} runtime sprite sheet`);
  assert(
    spriteSheet.file === `assets/img/super-slop-brothers/animated/${id}.webp`,
    `${id} sprite sheet must use the fixed Canvas2D runtime path`,
  );
  assert(spriteSheet.bytes === atlasReport.fileBytes, `${id} sprite sheet byte count drifted from its atlas report`);
  assert(spriteSheet.sha256 === atlasReport.sha256, `${id} sprite sheet hash drifted from its atlas report`);
  assert(spriteSheet.bytes > 100_000, `${id} sprite sheet is unexpectedly small (${spriteSheet.bytes} bytes)`);
  assert(spriteSheet.bytes <= 3 * 1024 * 1024, `${id} sprite sheet exceeds 3 MiB`);

  const [
    sourceMaster,
    sourceThumbnails,
    sourceRigged,
    sourceWalk,
    sourceRun,
    generationMetadata,
    rigMetadata,
    blenderReportFile,
    atlasReportFile,
  ] = await Promise.all([
    fileRecord(sourceMasterPath, `${id} Meshy master`),
    Promise.all(sourceThumbnailPaths.map((thumbnailPath, index) => fileRecord(thumbnailPath, `${id} Meshy thumbnail ${index}`))),
    fileRecord(sourceRiggedPath, `${id} Meshy rigged source`),
    fileRecord(sourceWalkPath, `${id} Meshy walk motion`),
    fileRecord(sourceRunPath, `${id} Meshy run motion`),
    fileRecord(generationMetaPath, `${id} generation metadata`),
    fileRecord(rigMetaPath, `${id} rig metadata`),
    fileRecord(blenderReportPath, `${id} Blender report`),
    fileRecord(atlasReportPath, `${id} atlas report`),
  ]);

  const animationTasks = {};
  const animationMetadataIntegrity = {};
  const animationFileIntegrity = {};
  let animationCredits = 0;
  for (const motion of MESHY_ANIMATIONS) {
    const meta = animationMeta[motion];
    const [metadataRecord, animationRecord] = await Promise.all([
      fileRecord(animationMetaPaths[motion], `${id} ${motion} metadata`),
      fileRecord(animationPaths[motion], `${id} ${motion} Meshy motion`),
    ]);
    animationCredits += credits(meta);
    animationTasks[motion] = {
      taskId: meta.id,
      actionId: meta.actionId,
      consumedCredits: credits(meta),
      file: animationRecord.file,
    };
    animationMetadataIntegrity[motion] = metadataRecord;
    animationFileIntegrity[motion] = animationRecord;
  }

  const generationCredits = credits(generationMeta);
  const rigCredits = credits(rigMeta);

  return {
    id,
    reference: reference.file,
    riggedModel: processedRig.file,
    spriteSheet: spriteSheet.file,
    sheet: {
      format: atlasReport.format,
      width: atlasReport.width,
      height: atlasReport.height,
      cellSize: atlasReport.cellSize,
      columns: atlasReport.columns,
      rows: atlasReport.rows,
      framesPerClip: FRAMES_PER_CLIP,
      alpha: true,
      minimumAlphaMargin: atlasReport.visualQA.minimumAlphaMarginPixels,
    },
    clips,
    meshy: {
      imageTaskId: generationMeta.id,
      rigTaskId: rigMeta.id,
      consumedCredits: {
        imageTo3d: generationCredits,
        rig: rigCredits,
        animations: animationCredits,
        total: generationCredits + rigCredits + animationCredits,
      },
      generation: {
        sourceImage: reference.file,
        request: publicGenerationRequest(generationMeta.request),
        masterFile: sourceMaster.file,
        thumbnails: sourceThumbnails.map((thumbnail) => thumbnail.file),
      },
      rig: {
        heightMeters: rigMeta.heightMeters,
        riggedFile: sourceRigged.file,
        walkingFile: sourceWalk.file,
        runningFile: sourceRun.file,
      },
      animationTasks,
    },
    blender: {
      pipeline: blenderReport.pipeline,
      version: blenderReport.blenderVersion,
      report: blenderReportFile.file,
      atlasReport: atlasReportFile.file,
      processedRig: {
        meshCount: blenderReport.processedRig.meshCount,
        armature: blenderReport.processedRig.armature,
        bones: blenderReport.processedRig.bones,
        triangles: blenderReport.processedRig.triangles,
        materials: blenderReport.processedRig.materials,
        images: blenderReport.processedRig.images,
      },
      render: {
        frameSize: blenderReport.render.frameSize,
        framesPerClip: blenderReport.render.framesPerClip,
        columns: blenderReport.render.columns,
        rows: blenderReport.render.rows,
        transparent: blenderReport.render.transparent,
        camera: blenderReport.render.camera,
        lighting: blenderReport.render.lighting,
      },
      atlas: {
        quality: atlasReport.encoding?.actualQuality ?? null,
        method: atlasReport.encoding?.method ?? null,
        requiredAlphaMargin: atlasReport.visualQA.requiredAlphaMarginPixels,
        minimumAlphaMargin: atlasReport.visualQA.minimumAlphaMarginPixels,
        clippedFrames: atlasReport.visualQA.clippedFrames,
      },
    },
    integrity: {
      algorithm: "sha256",
      reference,
      runtime: {
        processedRig,
        spriteSheet,
      },
      source: {
        master: sourceMaster,
        thumbnails: sourceThumbnails,
        rigged: sourceRigged,
        walking: sourceWalk,
        running: sourceRun,
        animations: animationFileIntegrity,
      },
      metadata: {
        generation: generationMetadata,
        rig: rigMetadata,
        animations: animationMetadataIntegrity,
      },
      reports: {
        blender: blenderReportFile,
        atlas: atlasReportFile,
      },
    },
  };
}

function collectDigests(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (typeof value.file === "string" && typeof value.sha256 === "string") {
    output.push(`${value.file}:${value.sha256}`);
    return output;
  }
  for (const key of Object.keys(value).sort()) collectDigests(value[key], output);
  return output;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage: node scripts/build-super-slop-character-manifest.mjs\n\nReads the six Meshy/Blender pipelines and writes:\n  ${repoRelative(outputPath)}`);
    return;
  }
  assert(process.argv.length === 2, "This builder takes no arguments. Use --help for usage.");

  const fighters = [];
  for (const fighter of FIGHTERS) fighters.push(await buildFighter(fighter));

  const totalSpriteSheetBytes = fighters.reduce((total, fighter) => total + fighter.integrity.runtime.spriteSheet.bytes, 0);
  assert(totalSpriteSheetBytes <= 14 * 1024 * 1024, `Runtime sprite sheets total ${(totalSpriteSheetBytes / 1024 / 1024).toFixed(2)} MiB; budget is 14 MiB`);

  const digestLines = fighters.flatMap((fighter) => collectDigests(fighter.integrity)).sort();
  const inputDigest = createHash("sha256").update(digestLines.join("\n")).digest("hex");
  const manifest = {
    version: 1,
    generator: "scripts/build-super-slop-character-manifest.mjs",
    inputDigest: {
      algorithm: "sha256",
      value: inputDigest,
    },
    runtimeContract: {
      renderer: "Canvas2D sprite atlas",
      clips: CLIP_ORDER,
      framesPerClip: FRAMES_PER_CLIP,
      mirrorLeftFacing: true,
      staticBodyAtlasFallback: true,
      maxProcessedRigBytes: 15 * 1024 * 1024,
      maxSpriteSheetBytes: 3 * 1024 * 1024,
      maxRosterSpriteSheetBytes: 14 * 1024 * 1024,
      totalSpriteSheetBytes,
    },
    fighters,
  };

  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  try {
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
  console.log(`Wrote ${repoRelative(outputPath)} for ${fighters.length} fighters (${(totalSpriteSheetBytes / 1024 / 1024).toFixed(2)} MiB of atlases).`);
}

main().catch((error) => {
  console.error(`Super Slop character manifest build failed: ${error.message}`);
  process.exitCode = 1;
});
