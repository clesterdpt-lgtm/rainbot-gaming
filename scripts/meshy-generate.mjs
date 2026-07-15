#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API_ROOT = "https://api.meshy.ai/openapi";
const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);
const DEFAULT_POLL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

const HELP = `Meshy character pipeline

Usage:
  node scripts/meshy-generate.mjs --mode balance
  node scripts/meshy-generate.mjs --mode status --task-type TYPE --task-id ID
  node scripts/meshy-generate.mjs --mode image-to-3d --image FILE --output DIR --slug NAME [--polycount 100000]
  node scripts/meshy-generate.mjs --mode rig --task-id IMAGE_TASK_ID --output DIR --slug NAME [--height 1.92]
  node scripts/meshy-generate.mjs --mode animate --task-id RIG_TASK_ID --action-id ID --output DIR --slug NAME

The API key is read from MESHY_API_KEY or a git-ignored .env file.`;

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

async function loadApiKey() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  try {
    const env = await readFile(path.resolve(".env"), "utf8");
    const line = env.split(/\r?\n/).find((candidate) => candidate.startsWith("MESHY_API_KEY="));
    if (line) return line.slice("MESHY_API_KEY=".length).trim().replace(/^['"]|['"]$/g, "");
  } catch (_) {
    // The explicit error below is more actionable than ENOENT.
  }
  throw new Error("MESHY_API_KEY is not set in the environment or .env");
}

function required(args, name) {
  const value = args[name];
  if (value == null || value === true || value === "") throw new Error(`Missing required --${name}`);
  return value;
}

function positiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive number`);
  return parsed;
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer`);
  return parsed;
}

function endpointForTaskType(type, id = "") {
  const collection = {
    "image-to-3d": "image-to-3d",
    rigging: "rigging",
    animations: "animations",
  }[type];
  if (!collection) throw new Error(`Unsupported --task-type ${type}`);
  return `/v1/${collection}${id ? `/${id}` : ""}`;
}

async function apiRequest(apiKey, endpoint, options = {}) {
  const response = await fetch(`${API_ROOT}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || payload.detail || payload.error || `HTTP ${response.status}`;
    throw new Error(`Meshy API ${response.status}: ${typeof message === "string" ? message : JSON.stringify(message)}`);
  }
  return payload;
}

async function pollTask(apiKey, taskType, taskId, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastProgress = null;
  while (Date.now() - startedAt < timeoutMs) {
    const task = await apiRequest(apiKey, endpointForTaskType(taskType, taskId));
    if (task.progress !== lastProgress || TERMINAL_STATUSES.has(task.status)) {
      console.log(`[Meshy] ${taskType} ${task.status || "UNKNOWN"} ${task.progress ?? 0}%`);
      lastProgress = task.progress;
    }
    if (TERMINAL_STATUSES.has(task.status)) {
      if (task.status !== "SUCCEEDED") {
        const reason = task.task_error?.message || task.error?.message || "no reason supplied";
        throw new Error(`${taskType} task ${taskId} ended ${task.status}: ${reason}`);
      }
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_MS));
  }
  throw new Error(`${taskType} task ${taskId} exceeded ${Math.round(timeoutMs / 60000)} minute timeout; resume with --mode status`);
}

async function createTask(apiKey, taskType, body) {
  const payload = await apiRequest(apiKey, endpointForTaskType(taskType), {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!payload.result) throw new Error(`Meshy did not return a task ID for ${taskType}`);
  console.log(`[Meshy] submitted ${taskType} task ${payload.result}`);
  return payload.result;
}

async function download(url, destination) {
  if (!url) throw new Error(`Missing download URL for ${destination}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed for ${path.basename(destination)} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  console.log(`[Meshy] saved ${path.relative(process.cwd(), destination)} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function downloadOptional(url, destination) {
  if (!url) return false;
  await download(url, destination);
  return true;
}

async function writeMetadata(destination, metadata) {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`[Meshy] saved ${path.relative(process.cwd(), destination)}`);
}

function taskSummary(task) {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    progress: task.progress,
    createdAt: task.created_at,
    startedAt: task.started_at,
    finishedAt: task.finished_at,
    expiresAt: task.expires_at,
    consumedCredits: task.consumed_credits,
    taskError: task.task_error || null,
  };
}

async function localImageDataUri(file) {
  const resolved = path.resolve(file);
  const extension = path.extname(resolved).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : null;
  if (!mime) throw new Error("--image must be a PNG or JPEG file");
  const bytes = await readFile(resolved);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function runImageTo3d(apiKey, args) {
  const image = required(args, "image");
  const output = path.resolve(required(args, "output"));
  const slug = required(args, "slug");
  const polycount = positiveNumber(args.polycount || 100000, "polycount");
  const texturePrompt = args["texture-prompt"] || "";
  if (texturePrompt.length > 600) throw new Error("--texture-prompt must be 600 characters or fewer");
  const request = {
    image_url: await localImageDataUri(image),
    model_type: "standard",
    ai_model: args["ai-model"] || "meshy-6",
    enable_pbr: true,
    should_texture: true,
    should_remesh: true,
    topology: "triangle",
    target_polycount: polycount,
    pose_mode: args.pose || "a-pose",
    image_enhancement: false,
    remove_lighting: true,
    target_formats: ["glb"],
    ...(texturePrompt ? { texture_prompt: texturePrompt } : {}),
  };
  const taskId = await createTask(apiKey, "image-to-3d", request);
  await writeMetadata(path.join(output, `${slug}.submission.json`), {
    taskId,
    taskType: "image-to-3d",
    input: path.relative(process.cwd(), path.resolve(image)),
    request: { ...request, image_url: "[local image data URI omitted]" },
  });
  if (args["no-poll"]) return;
  const task = await pollTask(apiKey, "image-to-3d", taskId);
  await download(task.model_urls?.glb, path.join(output, `${slug}-master.glb`));
  const thumbnailEntries = Object.entries(task.thumbnail_urls || {});
  if (!thumbnailEntries.length && task.thumbnail_url) thumbnailEntries.push(["preview", task.thumbnail_url]);
  for (const [view, url] of thumbnailEntries) {
    await downloadOptional(url, path.join(output, `${slug}-${view}.png`));
  }
  await writeMetadata(path.join(output, `${slug}.meta.json`), {
    ...taskSummary(task),
    sourceImage: path.relative(process.cwd(), path.resolve(image)),
    masterFile: `${slug}-master.glb`,
    thumbnails: thumbnailEntries.map(([view]) => `${slug}-${view}.png`),
    request: { ...request, image_url: "[local image data URI omitted]" },
  });
}

async function runRig(apiKey, args) {
  const inputTaskId = required(args, "task-id");
  const output = path.resolve(required(args, "output"));
  const slug = required(args, "slug");
  const height = positiveNumber(args.height || 1.92, "height");
  const taskId = await createTask(apiKey, "rigging", { input_task_id: inputTaskId, height_meters: height });
  await writeMetadata(path.join(output, `${slug}-rig.submission.json`), {
    taskId,
    taskType: "rigging",
    inputTaskId,
    heightMeters: height,
  });
  if (args["no-poll"]) return;
  const task = await pollTask(apiKey, "rigging", taskId);
  await download(task.result?.rigged_character_glb_url, path.join(output, `${slug}-rigged.glb`));
  await downloadOptional(task.result?.basic_animations?.walking_glb_url, path.join(output, `${slug}-walk.glb`));
  await downloadOptional(task.result?.basic_animations?.running_glb_url, path.join(output, `${slug}-run.glb`));
  await writeMetadata(path.join(output, `${slug}-rig.meta.json`), {
    ...taskSummary(task),
    inputTaskId,
    heightMeters: height,
    files: {
      rigged: `${slug}-rigged.glb`,
      walking: `${slug}-walk.glb`,
      running: `${slug}-run.glb`,
    },
  });
}

async function runAnimation(apiKey, args) {
  const rigTaskId = required(args, "task-id");
  const output = path.resolve(required(args, "output"));
  const slug = required(args, "slug");
  const actionId = nonNegativeInteger(args["action-id"] ?? 0, "action-id");
  const taskId = await createTask(apiKey, "animations", { rig_task_id: rigTaskId, action_id: actionId });
  await writeMetadata(path.join(output, `${slug}.submission.json`), {
    taskId,
    taskType: "animations",
    rigTaskId,
    actionId,
  });
  if (args["no-poll"]) return;
  const task = await pollTask(apiKey, "animations", taskId);
  await download(task.result?.animation_glb_url, path.join(output, `${slug}.glb`));
  await writeMetadata(path.join(output, `${slug}.meta.json`), {
    ...taskSummary(task),
    rigTaskId,
    actionId,
    file: `${slug}.glb`,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(HELP);
    return;
  }
  const mode = required(args, "mode");
  const apiKey = await loadApiKey();
  if (mode === "balance") {
    const balance = await apiRequest(apiKey, "/v1/balance");
    console.log(JSON.stringify({ authenticated: true, balance: balance.balance }, null, 2));
    return;
  }
  if (mode === "status") {
    const taskType = required(args, "task-type");
    const taskId = required(args, "task-id");
    const task = await apiRequest(apiKey, endpointForTaskType(taskType, taskId));
    console.log(JSON.stringify(taskSummary(task), null, 2));
    return;
  }
  if (mode === "image-to-3d") return runImageTo3d(apiKey, args);
  if (mode === "rig") return runRig(apiKey, args);
  if (mode === "animate") return runAnimation(apiKey, args);
  throw new Error(`Unsupported --mode ${mode}`);
}

main().catch((error) => {
  console.error(`Meshy pipeline failed: ${error.message}`);
  process.exitCode = 1;
});
