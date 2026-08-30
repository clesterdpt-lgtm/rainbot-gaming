import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const modelRoot = path.join(root, "assets/models/tardigrade");
const manifestPath = path.join(modelRoot, "manifest.json");
const blenderScriptPath = path.join(root, "scripts/blender/prepare-tardigrade-assets.py");
const gameSourcePath = path.join(root, "assets/js/tardigrade-micro-mayhem.js");
const pageSourcePath = path.join(root, "games/tardigrade-micro-mayhem.html");
const artifactDir = path.join(root, "output/playwright/tardigrade-meshy-blender-assets");

const MIB = 1024 * 1024;
const TOTAL_BYTE_BUDGET = 16 * MIB;
const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const HERO_USER_REFERENCE_SHA256 = "ea4b38d8e15184f21121c822b80f26f4a1243337f2c86a177f6c9424ccc1d1dc";
const HERO_MESHY_INPUT_SHA256 = "acdf19f39ea1f9d2bc0a6f31f37abeee4d0c0db616f461b9ebb64e3abef1c7ef";
const RETIRED_STRIPED_HERO_SOURCE_SHA256 = "f9616290f7dadabb207ba2ac5be9abaf4069cbd6e2c799fd987a842a765a9897";
const RETIRED_STRIPED_HERO_RUNTIME_SHA256 = "f53fd6561d408097e6b1d45a00181ac8f10e8463fba4bb1faeb4811183f353fc";
const RETIRED_FIVE_ROW_HERO_SOURCE_SHA256 = "f11be68ba8400d84f41aaa06b7e610b97a10494502ac0856c55ac0a87b032d35";
const RETIRED_FIVE_ROW_HERO_RUNTIME_SHA256 = "a8d05b6267e7c80c43a25c76fa4015d1ce9a96b91353b2b0489db2a7c7434127";
const EXPECTED_ASSETS = [
  {
    id: "hero-tardigrade",
    role: "hero",
    file: "hero-tardigrade.glb",
    triangleBudget: 14_000,
    byteBudget: 4 * MIB,
    clips: ["idle", "scuttle", "dash", "curl", "airborne"],
  },
  {
    id: "creature-rotifer",
    role: "creature",
    file: "creature-rotifer.glb",
    triangleBudget: 10_000,
    byteBudget: 3 * MIB,
    clips: ["idle", "locomotion", "startled"],
  },
  {
    id: "creature-ciliate",
    role: "creature",
    file: "creature-ciliate.glb",
    triangleBudget: 10_000,
    byteBudget: 3 * MIB,
    clips: ["idle", "locomotion", "startled"],
  },
  {
    id: "creature-waterbearling",
    role: "creature",
    file: "creature-waterbearling.glb",
    triangleBudget: 10_000,
    byteBudget: 3 * MIB,
    clips: ["idle", "locomotion", "startled"],
  },
  {
    id: "prop-algae",
    role: "prop",
    file: "prop-algae.glb",
    triangleBudget: 5_000,
    byteBudget: 1.5 * MIB,
    clips: [],
  },
  {
    id: "prop-bacteria",
    role: "prop",
    file: "prop-bacteria.glb",
    triangleBudget: 5_000,
    byteBudget: 1.5 * MIB,
    clips: [],
  },
  {
    id: "prop-droplet",
    role: "prop",
    file: "prop-droplet.glb",
    triangleBudget: 5_000,
    byteBudget: 1.5 * MIB,
    clips: [],
  },
  {
    id: "prop-pollen",
    role: "prop",
    file: "prop-pollen.glb",
    triangleBudget: 5_000,
    byteBudget: 1.5 * MIB,
    clips: [],
  },
];
const EXPECTED_IDS = EXPECTED_ASSETS.map((asset) => asset.id);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is missing or invalid JSON: ${path.relative(root, filePath)} (${error.message})`);
  }
  return parsed;
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJpegDimensions(bytes, label) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const segmentLength = bytes.readUInt16BE(offset + 2);
    const isSizeMarker = marker >= 0xc0 && marker <= 0xc3
      || marker >= 0xc5 && marker <= 0xc7
      || marker >= 0xc9 && marker <= 0xcb
      || marker >= 0xcd && marker <= 0xcf;
    if (isSizeMarker && offset + 8 < bytes.length) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    assert(segmentLength >= 2, `${label} has an invalid JPEG segment`);
    offset += 2 + segmentLength;
  }
  throw new Error(`${label} has no readable JPEG dimensions`);
}

function embeddedImageDimensions(bytes, mimeType, label) {
  if (mimeType === "image/png") {
    assert(bytes.length >= 24 && bytes.toString("hex", 0, 8) === "89504e470d0a1a0a", `${label} is not a valid embedded PNG`);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mimeType === "image/jpeg") {
    assert(bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8, `${label} is not a valid embedded JPEG`);
    return readJpegDimensions(bytes, label);
  }
  throw new Error(`${label} uses unsupported embedded image type ${mimeType || "unknown"}`);
}

const ACCESSOR_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};
const COMPONENT_READERS = {
  5120: { bytes: 1, read: (view, offset) => view.getInt8(offset) },
  5121: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
  5122: { bytes: 2, read: (view, offset) => view.getInt16(offset, true) },
  5123: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
  5125: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
  5126: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
};

function readAccessor(json, binary, accessorIndex, label) {
  const accessor = json.accessors?.[accessorIndex];
  assert(accessor && Number.isInteger(accessor.bufferView), `${label} uses an accessor without a bufferView`);
  assert(!accessor.sparse, `${label} uses an unsupported sparse accessor`);
  const bufferView = json.bufferViews?.[accessor.bufferView];
  assert(bufferView && (bufferView.buffer ?? 0) === 0, `${label} does not resolve to the embedded GLB buffer`);
  const reader = COMPONENT_READERS[accessor.componentType];
  const components = ACCESSOR_COMPONENTS[accessor.type];
  assert(reader && components, `${label} uses an unsupported accessor layout`);
  const packedStride = reader.bytes * components;
  const stride = bufferView.byteStride || packedStride;
  const start = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const values = [];
  for (let element = 0; element < accessor.count; element += 1) {
    const elementOffset = start + element * stride;
    assert(elementOffset + packedStride <= binary.byteLength, `${label} reads beyond the embedded GLB buffer`);
    for (let component = 0; component < components; component += 1) {
      values.push(reader.read(view, elementOffset + component * reader.bytes));
    }
  }
  assert(values.every(Number.isFinite), `${label} contains a non-finite accessor value`);
  return { accessor, components, values };
}

function samplerPoseVariation(json, binary, sampler, label) {
  const input = readAccessor(json, binary, sampler.input, `${label} input`);
  const output = readAccessor(json, binary, sampler.output, `${label} output`);
  assert(input.accessor.count >= 2, `${label} must contain at least two animation keyframes`);
  const cubic = String(sampler.interpolation || "LINEAR").toUpperCase() === "CUBICSPLINE";
  const outputElements = output.values.length / output.components;
  const expectedElements = input.accessor.count * (cubic ? 3 : 1);
  assert(outputElements === expectedElements, `${label} input/output keyframe counts do not agree`);
  const elementAt = (frame) => (cubic ? frame * 3 + 1 : frame);
  const firstOffset = elementAt(0) * output.components;
  let maximumDelta = 0;
  for (let frame = 1; frame < input.accessor.count; frame += 1) {
    const frameOffset = elementAt(frame) * output.components;
    for (let component = 0; component < output.components; component += 1) {
      maximumDelta = Math.max(maximumDelta, Math.abs(output.values[frameOffset + component] - output.values[firstOffset + component]));
    }
  }
  return maximumDelta;
}

function parseGlb(filePath) {
  const bytes = fs.readFileSync(filePath);
  const relativePath = path.relative(root, filePath);
  assert(bytes.length >= 20, `${relativePath} is too small to be a GLB`);
  assert(bytes.toString("ascii", 0, 4) === "glTF", `${relativePath} is not a binary glTF file`);
  assert(bytes.readUInt32LE(4) === 2, `${relativePath} must use glTF 2.0`);
  assert(bytes.readUInt32LE(8) === bytes.length, `${relativePath} has an invalid declared byte length`);

  let json = null;
  let binary = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLength;
    assert(end <= bytes.length, `${relativePath} contains a truncated GLB chunk`);
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(bytes.subarray(start, end).toString("utf8").replaceAll("\0", "").trim());
    } else if (chunkType === 0x004e4942) {
      binary = bytes.subarray(start, end);
    }
    offset = end;
  }
  assert(json, `${relativePath} has no readable glTF JSON chunk`);
  assert(binary, `${relativePath} has no embedded binary chunk`);

  let triangles = 0;
  for (const [meshIndex, mesh] of (json.meshes || []).entries()) {
    for (const [primitiveIndex, primitive] of (mesh.primitives || []).entries()) {
      if ((primitive.mode ?? 4) !== 4) continue;
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      const count = json.accessors?.[accessorIndex]?.count;
      triangles += Math.floor((Number(count) || 0) / 3);
      for (const [semantic, attributeAccessor] of Object.entries(primitive.attributes || {})) {
        readAccessor(json, binary, attributeAccessor, `${relativePath} mesh ${meshIndex} primitive ${primitiveIndex} ${semantic}`);
      }
    }
  }

  const serialized = JSON.stringify(json);
  const extensions = new Set([...(json.extensionsUsed || []), ...(json.extensionsRequired || [])]);
  const images = (json.images || []).map((image, index) => {
    const label = `${relativePath} image ${index}`;
    assert(Number.isInteger(image.bufferView) && !image.uri, `${label} must be embedded in the GLB`);
    const bufferView = json.bufferViews?.[image.bufferView];
    assert(bufferView && (bufferView.buffer ?? 0) === 0, `${label} has an invalid embedded bufferView`);
    const start = bufferView.byteOffset || 0;
    const end = start + (bufferView.byteLength || 0);
    assert(end <= binary.length, `${label} reads beyond the embedded GLB buffer`);
    return {
      mimeType: image.mimeType,
      ...embeddedImageDimensions(binary.subarray(start, end), image.mimeType, label),
    };
  });
  const sceneRoots = new Set((json.scenes?.[json.scene ?? 0]?.nodes || []));
  const animationDetails = (json.animations || []).map((animation, animationIndex) => {
    let varyingChannels = 0;
    let maximumPoseDelta = 0;
    const rootTranslationChannels = [];
    for (const [channelIndex, channel] of (animation.channels || []).entries()) {
      const sampler = animation.samplers?.[channel.sampler];
      assert(sampler, `${relativePath} ${animation.name || animationIndex} channel ${channelIndex} has no sampler`);
      const nodeIndex = channel.target?.node;
      const nodeName = json.nodes?.[nodeIndex]?.name || `node-${nodeIndex}`;
      const delta = samplerPoseVariation(json, binary, sampler, `${relativePath} ${animation.name || animationIndex} ${nodeName}.${channel.target?.path || "unknown"}`);
      maximumPoseDelta = Math.max(maximumPoseDelta, delta);
      if (delta > 1e-5) varyingChannels += 1;
      if (channel.target?.path === "translation" && (
        sceneRoots.has(nodeIndex)
        || /(?:^|[_\s-])(root|world|scene|armature)(?:$|[_\s-])/i.test(nodeName)
      )) {
        rootTranslationChannels.push(nodeName);
      }
    }
    return {
      name: animation.name || "",
      channels: animation.channels?.length || 0,
      varyingChannels,
      maximumPoseDelta,
      rootTranslationChannels,
    };
  });
  return {
    bytes: bytes.length,
    binary,
    json,
    triangles,
    meshes: json.meshes?.length || 0,
    materials: json.materials?.length || 0,
    textures: json.textures?.length || 0,
    images,
    skins: json.skins?.length || 0,
    animations: (json.animations || []).map((animation) => animation.name || ""),
    animationDetails,
    nodeNames: (json.nodes || []).map((node) => node.name || ""),
    compressed: extensions.has("KHR_draco_mesh_compression")
      || extensions.has("EXT_meshopt_compression")
      || serialized.includes("KHR_draco_mesh_compression")
      || serialized.includes("EXT_meshopt_compression"),
  };
}

function measureHeroLegRows(glb) {
  const positions = [];
  for (const mesh of glb.json.meshes || []) {
    for (const primitive of mesh.primitives || []) {
      const materialName = glb.json.materials?.[primitive.material]?.name || "";
      if (materialName !== "SkinPrimary" || !Number.isInteger(primitive.attributes?.POSITION)) continue;
      const accessor = readAccessor(glb.json, glb.binary, primitive.attributes.POSITION, "hero SkinPrimary POSITION");
      for (let offset = 0; offset < accessor.values.length; offset += accessor.components) {
        positions.push(accessor.values.slice(offset, offset + 3));
      }
    }
  }
  assert(positions.length > 0, "hero GLB has no measurable SkinPrimary positions");

  const bounds = [0, 1, 2].map((axis) => ({
    min: Math.min(...positions.map((position) => position[axis])),
    max: Math.max(...positions.map((position) => position[axis])),
  }));
  const width = bounds[0].max - bounds[0].min;
  const height = bounds[1].max - bounds[1].min;
  const length = bounds[2].max - bounds[2].min;
  const centerX = (bounds[0].min + bounds[0].max) * 0.5;
  const bins = 48;
  const counts = Array.from({ length: bins }, () => 0);
  for (const [x, y, z] of positions) {
    const isLowAppendage = y <= bounds[1].min + height * 0.48;
    const isLateral = Math.abs(x - centerX) >= width * 0.22;
    if (!isLowAppendage || !isLateral) continue;
    const index = Math.max(0, Math.min(bins - 1, Math.floor((z - bounds[2].min) / length * bins)));
    counts[index] += 1;
  }
  const rootCounts = counts.map(Math.sqrt);
  const smoothed = rootCounts.map((count, index) => (
    count + (rootCounts[index - 1] || 0) + (rootCounts[index + 1] || 0)
  ));
  const threshold = Math.max(...smoothed) * 0.45;
  const candidates = smoothed
    .map((value, index) => ({ value, index }))
    .filter(({ value, index }) => (
      value >= threshold
      && value >= (smoothed[index - 1] ?? -1)
      && value >= (smoothed[index + 1] ?? -1)
    ))
    .sort((a, b) => b.value - a.value);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every((index) => Math.abs(index - candidate.index) >= 5)) selected.push(candidate.index);
  }
  selected.sort((a, b) => a - b);
  return selected.map((index) => (
    bounds[2].min + length * ((index + 0.5) / bins)
  ));
}

function manifestAssets(manifest) {
  if (Array.isArray(manifest.assets)) return manifest.assets;
  if (manifest.assets && typeof manifest.assets === "object") {
    return Object.entries(manifest.assets).map(([id, entry]) => ({ id, ...entry }));
  }
  return [];
}

function runtimeFile(entry) {
  return entry.runtimeFile || entry.file || entry.model || "";
}

function reportFile(entry) {
  return entry.blenderReport || entry.report || entry.blender?.report || "";
}

function declaredClipNames(entry) {
  if (Array.isArray(entry.clips)) return entry.clips.map(String);
  if (entry.clips && typeof entry.clips === "object") return Object.keys(entry.clips);
  if (Array.isArray(entry.animations)) return entry.animations.map((item) => typeof item === "string" ? item : item?.name).filter(Boolean);
  if (entry.animations && typeof entry.animations === "object") return Object.keys(entry.animations);
  return [];
}

function collectTaskIds(value, output = []) {
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value)) {
    if (/taskid$/i.test(key) && typeof child === "string") output.push(child);
    else if (child && typeof child === "object") collectTaskIds(child, output);
  }
  return output;
}

function resolveAssetRelative(reference) {
  if (!reference) return "";
  return reference.startsWith("assets/") || reference.startsWith("scripts/")
    ? path.join(root, reference)
    : path.join(modelRoot, reference);
}

function validateStaticAssets() {
  assert(
    fs.existsSync(manifestPath),
    "missing required Meshy/Blender manifest: assets/models/tardigrade/manifest.json",
  );
  const manifest = readJson(manifestPath, "Tardigrade asset manifest");
  const entries = manifestAssets(manifest);
  assert(entries.length === EXPECTED_ASSETS.length, `manifest must contain exactly ${EXPECTED_ASSETS.length} assets; found ${entries.length}`);
  assert(
    String(manifest.pipeline || manifest.runtimeContract?.pipeline || "").match(/Meshy/i),
    "manifest pipeline must identify Meshy as the source generator",
  );
  assert(
    String(manifest.pipeline || manifest.runtimeContract?.pipeline || "").match(/Blender/i),
    "manifest pipeline must identify Blender as the polish/animation/export step",
  );
  assert(
    String(manifest.runtimeContract?.compression || "none").toLowerCase() === "none",
    "manifest runtime contract must declare uncompressed GLBs for the current Three.js r128 loader",
  );

  let totalBytes = 0;
  for (const expected of EXPECTED_ASSETS) {
    const entry = entries.find((candidate) => candidate.id === expected.id);
    assert(entry, `manifest is missing ${expected.id}`);
    assert(entry.role === expected.role, `${expected.id} must explicitly declare role ${expected.role}; found ${entry.role || "missing"}`);
    assert(runtimeFile(entry) === expected.file, `${expected.id} runtime file must be ${expected.file}`);

    const provenance = entry.meshy;
    assert(provenance && typeof provenance === "object", `${expected.id} is missing its Meshy provenance object`);
    const generationMode = provenance.generationMode || "text-to-3d";
    if (generationMode === "image-to-3d") {
      assert(TASK_ID.test(provenance.taskId || ""), `${expected.id} has no valid Meshy image-to-3D taskId`);
    } else {
      assert(TASK_ID.test(provenance.previewTaskId || ""), `${expected.id} has no valid Meshy previewTaskId`);
      assert(TASK_ID.test(provenance.refineTaskId || ""), `${expected.id} has no valid Meshy refineTaskId`);
      assert(provenance.previewTaskId !== provenance.refineTaskId, `${expected.id} preview/refine Meshy task IDs must be distinct`);
      assert(typeof provenance.prompt === "string" && provenance.prompt.trim().length >= 40, `${expected.id} must preserve its full Meshy prompt`);
    }
    assert(Number(provenance.consumedCredits) > 0, `${expected.id} must record positive consumedCredits`);
    assert(typeof provenance.texturePrompt === "string" && provenance.texturePrompt.trim().length >= 30, `${expected.id} must preserve its Meshy texturePrompt`);
    assert(typeof provenance.sourceFile === "string" && provenance.sourceFile.startsWith("source/") && provenance.sourceFile.endsWith(".glb"), `${expected.id} has an invalid Meshy sourceFile`);
    assert(SHA256.test(provenance.sourceSha256 || ""), `${expected.id} has an invalid sourceSha256`);
    const sourcePath = resolveAssetRelative(provenance.sourceFile);
    assert(fs.existsSync(sourcePath), `${expected.id} Meshy source is missing: ${path.relative(root, sourcePath)}`);
    const actualSourceSha = sha256File(sourcePath);
    assert(provenance.sourceSha256 === actualSourceSha, `${expected.id} sourceSha256 does not match ${provenance.sourceFile}`);

    const reportReference = reportFile(entry);
    assert(reportReference, `${expected.id} is missing a Blender report reference`);
    const reportPath = resolveAssetRelative(reportReference);
    assert(fs.existsSync(reportPath), `${expected.id} Blender report is missing: ${path.relative(root, reportPath)}`);
    const report = readJson(reportPath, `${expected.id} Blender report`);
    const reportText = JSON.stringify(report);
    assert(/Blender/i.test(reportText), `${expected.id} report does not identify its Blender pipeline/version`);

    const assetPath = path.join(modelRoot, expected.file);
    assert(fs.existsSync(assetPath), `missing runtime model ${path.relative(root, assetPath)}`);
    const glb = parseGlb(assetPath);
    const actualRuntimeSha = sha256File(assetPath);
    totalBytes += glb.bytes;
    assert(SHA256.test(entry.sha256 || "") && entry.sha256 === actualRuntimeSha, `${expected.id} manifest sha256 does not match its runtime GLB`);
    assert(report.source?.sha256 === actualSourceSha, `${expected.id} Blender report source hash does not match the Meshy master`);
    assert(report.output?.file === expected.file, `${expected.id} Blender report names the wrong runtime file`);
    assert(report.output?.sha256 === actualRuntimeSha, `${expected.id} Blender report output hash does not match the runtime GLB`);
    assert(report.validation?.sha256 === actualRuntimeSha, `${expected.id} Blender validation hash does not match the runtime GLB`);
    assert(report.output?.fileBytes === glb.bytes && report.validation?.fileBytes === glb.bytes, `${expected.id} Blender report byte counts do not match the runtime GLB`);
    assert(glb.meshes >= 1 && glb.triangles > 0, `${expected.file} has no readable mesh triangles`);
    assert(glb.triangles <= expected.triangleBudget, `${expected.file} exceeds ${expected.triangleBudget.toLocaleString()} triangles (${glb.triangles.toLocaleString()})`);
    assert(glb.bytes <= expected.byteBudget, `${expected.file} exceeds ${(expected.byteBudget / MIB).toFixed(1)} MiB (${(glb.bytes / MIB).toFixed(2)} MiB)`);
    assert(glb.textures <= 4, `${expected.file} exceeds the four-texture budget (${glb.textures})`);
    assert(glb.materials <= 4, `${expected.file} exceeds the four-material budget (${glb.materials})`);
    assert(glb.images.length > 0, `${expected.file} must retain at least one embedded runtime texture`);
    assert(glb.images.every((image) => image.width > 0 && image.height > 0 && image.width <= 512 && image.height <= 512), `${expected.file} has an embedded image above 512x512: ${JSON.stringify(glb.images)}`);
    assert(report.output?.triangles === glb.triangles, `${expected.id} Blender report triangle count does not match the GLB`);
    assert(report.output?.materials === glb.materials && report.output?.materials <= 4, `${expected.id} Blender report material count does not match the GLB`);
    assert(report.output?.textures === glb.textures, `${expected.id} Blender report texture count does not match the GLB`);
    assert(!glb.compressed, `${expected.file} requires Draco or meshopt, which is not wired into the current Three.js r128 runtime`);

    const declared = declaredClipNames(entry);
    if (expected.role === "prop") {
      assert(glb.animations.length === 0 && glb.skins === 0, `${expected.file} must remain a static, unskinned prop`);
      assert(declared.length === 0, `${expected.id} must not declare animation clips`);
    } else {
      assert(glb.skins >= 1, `${expected.file} must preserve a Blender-authored skin/armature`);
      assert(report.rig?.worldRootTranslation === false && report.features?.worldRootTranslation === false, `${expected.id} Blender report must forbid world-root translation`);
      assert(Array.isArray(report.validation?.rootTranslationChannels) && report.validation.rootTranslationChannels.length === 0, `${expected.id} Blender report found root translation channels`);
      for (const clip of expected.clips) {
        assert(declared.includes(clip), `${expected.id} manifest is missing required ${clip} semantics`);
        assert(glb.animations.includes(clip), `${expected.file} is missing embedded animation clip ${clip}`);
        const animation = glb.animationDetails.find((candidate) => candidate.name === clip);
        assert(animation?.channels > 0, `${expected.file} ${clip} has no animation channels`);
        assert(animation.varyingChannels > 0 && animation.maximumPoseDelta > 1e-5, `${expected.file} ${clip} contains no actual pose variation`);
        assert(animation.rootTranslationChannels.length === 0, `${expected.file} ${clip} translates a world/root node: ${animation.rootTranslationChannels.join(", ")}`);
      }
    }

    if (expected.role === "hero") {
      assert(provenance.generationMode === "image-to-3d", "hero must be regenerated through Meshy image-to-3D from the approved reference");
      assert(provenance.sourceSha256 !== RETIRED_STRIPED_HERO_SOURCE_SHA256, "hero still points at the retired striped Meshy source");
      assert(entry.sha256 !== RETIRED_STRIPED_HERO_RUNTIME_SHA256, "hero runtime GLB was not regenerated");
      assert(provenance.sourceSha256 !== RETIRED_FIVE_ROW_HERO_SOURCE_SHA256, "hero still points at the retired five-row Meshy source");
      assert(entry.sha256 !== RETIRED_FIVE_ROW_HERO_RUNTIME_SHA256, "hero runtime still points at the retired five-row Blender export");

      const reference = provenance.reference;
      assert(reference?.userSourceSha256 === HERO_USER_REFERENCE_SHA256, "hero provenance does not pin the supplied user reference");
      assert(reference?.meshyInputSha256 === HERO_MESHY_INPUT_SHA256, "hero provenance does not pin the approved isolated Meshy input");
      for (const [fileKey, hashKey] of [["userSourceFile", "userSourceSha256"], ["meshyInputFile", "meshyInputSha256"]]) {
        const referencePath = resolveAssetRelative(reference?.[fileKey]);
        assert(referencePath && fs.existsSync(referencePath), `hero ${fileKey} is missing`);
        assert(sha256File(referencePath) === reference[hashKey], `hero ${hashKey} does not match ${reference[fileKey]}`);
      }
      const metadataPath = resolveAssetRelative(provenance.metadataFile);
      assert(metadataPath && fs.existsSync(metadataPath), "hero Meshy image-to-3D metadata is missing");
      const metadata = readJson(metadataPath, "hero Meshy image-to-3D metadata");
      assert(metadata.id === provenance.taskId, "hero manifest taskId does not match Meshy metadata");
      assert(path.resolve(root, metadata.sourceImage) === resolveAssetRelative(reference.meshyInputFile), "Meshy metadata does not identify the declared hero input image");

      const direction = entry.artDirection;
      assert(direction?.palette === "uniform-peach", "hero palette must be uniform peach");
      assert(direction?.deepBodyFolds === true && direction.bodyFoldsMin >= 5, "hero must target at least five deep body folds");
      assert(direction?.legPairs === 4, "hero must target exactly four leg pairs");
      assert(direction?.oralTube === "circular-front", "hero must target a circular front oral tube");
      assert(direction?.stripes === false, "hero must explicitly forbid stripes");
      const measuredLegRows = measureHeroLegRows(glb);
      assert(
        measuredLegRows.length === 4,
        `hero mesh must visibly contain exactly four planted leg rows; measured ${measuredLegRows.length} near ${measuredLegRows.map((value) => value.toFixed(2)).join(", ")}`,
      );
      assert(report.geometry?.anatomy?.method === "source-already-has-four-planted-rows", "accepted hero must originate from a Meshy source with four planted rows before Blender rigging");
      assert(report.geometry.anatomy.targetLegPairs === 4, "hero anatomy report must target four bilateral leg pairs");
      assert(report.geometry.anatomy.legRowsBefore?.length === 4 && report.geometry.anatomy.legRowsAfter?.length === 4, "hero Blender report must measure four leg rows before and after cleanup");
      assert(/uniform.{0,30}peach|peach.{0,30}uniform/i.test(provenance.texturePrompt), "hero texture prompt must request uniform peach skin");
      assert(/no (?:stripes|bands)|without (?:stripes|bands)/i.test(provenance.texturePrompt), "hero texture prompt must explicitly forbid stripes or bands");
      const heroMaterialNames = (glb.json.materials || []).map((material) => material.name || "");
      assert(heroMaterialNames.includes("SkinPrimary"), "hero GLB must retain the tintable SkinPrimary material");
      assert(heroMaterialNames.includes("MouthDark"), "hero GLB must retain a non-tintable dark oral inset for gameplay readability");
      assert(
        report.materials?.oralInset?.radius > 0
          && report.materials?.oralInset?.triangles > 0
          && report.materials?.oralInset?.frontProtrusion >= 0.03,
        "hero Blender report must describe an oral inset placed far enough forward to avoid browser depth fighting",
      );

      const requiredSockets = ["Head", "Face", "Back", "Camera"];
      assert(Array.isArray(entry.sockets) && requiredSockets.every((name) => entry.sockets.includes(name)), "hero manifest must declare Head, Face, Back, and Camera sockets");
      assert(Array.isArray(report.rig?.sockets) && requiredSockets.every((name) => report.rig.sockets.includes(name)), "hero Blender report must preserve Head, Face, Back, and Camera sockets");
      for (const name of requiredSockets) {
        assert(glb.nodeNames.filter((nodeName) => nodeName === name).length === 1, `hero GLB must contain exactly one ${name} node/socket`);
      }
      const nodes = glb.json.nodes || [];
      const indexOf = (name) => nodes.findIndex((node) => node.name === name);
      assert(nodes[indexOf("Head")]?.children?.includes(indexOf("Face")), "hero Face socket must be parented beneath Head");
      assert(nodes[indexOf("Back")]?.children?.includes(indexOf("Camera")), "hero Camera socket must be parented beneath Back");
      const expectedLegBones = [];
      for (let pair = 1; pair <= 4; pair += 1) {
        for (const side of ["L", "R"]) expectedLegBones.push(`Leg_${side}${pair}_Upper`, `Leg_${side}${pair}_Lower`);
      }
      const actualLegBones = report.rig.deformBones.filter((name) => /^Leg_[LR]\d+_(?:Upper|Lower)$/.test(name));
      assert(
        actualLegBones.length === expectedLegBones.length && expectedLegBones.every((name) => actualLegBones.includes(name)),
        "hero rig must contain exactly four left/right leg pairs",
      );
    }
  }
  assert(totalBytes <= TOTAL_BYTE_BUDGET, `Tardigrade GLB roster exceeds 16 MiB (${(totalBytes / MIB).toFixed(2)} MiB)`);

  const declaredScript = manifest.blenderScript || manifest.pipelineScript || manifest.blender?.script || "scripts/blender/prepare-tardigrade-assets.py";
  assert(
    declaredScript === "scripts/blender/prepare-tardigrade-assets.py",
    `manifest Blender script must be scripts/blender/prepare-tardigrade-assets.py; found ${declaredScript}`,
  );
  assert(fs.existsSync(blenderScriptPath), "missing Blender pipeline script: scripts/blender/prepare-tardigrade-assets.py");
  const blenderSource = fs.readFileSync(blenderScriptPath, "utf8");
  for (const marker of ["bpy.ops.import_scene.gltf", "bpy.ops.export_scene.gltf", "export_animations", "json.dump"]) {
    assert(blenderSource.includes(marker), `Blender pipeline is missing ${marker}`);
  }

  const gameSource = fs.readFileSync(gameSourcePath, "utf8");
  const pageSource = fs.readFileSync(pageSourcePath, "utf8");
  for (const marker of [
    "assets/models/tardigrade/manifest.json",
    "THREE.GLTFLoader",
    "THREE.SkeletonUtils.clone",
    "THREE.AnimationMixer",
    "getModelDiagnostics",
    "window.render_game_to_text",
    "window.advanceTime",
  ]) {
    assert(gameSource.includes(marker), `Tardigrade runtime is missing ${marker}`);
  }
  const threeIndex = pageSource.indexOf("three-r128.min.js");
  const loaderIndex = pageSource.indexOf("GLTFLoader-r128.js");
  const skeletonIndex = pageSource.indexOf("SkeletonUtils-r128.js");
  const gameIndex = pageSource.indexOf("tardigrade-micro-mayhem.js");
  assert(
    threeIndex >= 0 && loaderIndex > threeIndex && skeletonIndex > loaderIndex && gameIndex > skeletonIndex,
    "page must load vendored Three.js, GLTFLoader, and SkeletonUtils in order before the Tardigrade runtime",
  );
}

const mime = {
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function createStaticServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const decodedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const absolutePath = path.resolve(root, `.${decodedPath}`);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    fs.readFile(absolutePath, (error, body) => {
      if (error) {
        response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": mime[path.extname(absolutePath).toLowerCase()] || "application/octet-stream",
      });
      response.end(body);
    });
  });
}

function isCiliateUrl(url) {
  return /\/assets\/models\/tardigrade\/creature-ciliate\.glb(?:\?|$)/.test(url);
}

function watchPage(page, origin, label, issues, { allowCiliateFailure = false } = {}) {
  page.on("pageerror", (error) => issues.push(`${label} page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/fonts\.(googleapis|gstatic)|favicon\.ico/i.test(text)) return;
    if (allowCiliateFailure && /creature-ciliate\.glb|ERR_FAILED|Failed to load resource/i.test(text)) return;
    issues.push(`${label} console error: ${text}`);
  });
  page.on("requestfailed", (request) => {
    if (!request.url().startsWith(origin)) return;
    if (allowCiliateFailure && isCiliateUrl(request.url())) return;
    issues.push(`${label} request failed: ${request.url()} (${request.failure()?.errorText || "unknown"})`);
  });
  page.on("response", (response) => {
    if (!response.url().startsWith(origin) || response.status() < 400) return;
    if (allowCiliateFailure && isCiliateUrl(response.url())) return;
    issues.push(`${label} HTTP ${response.status()}: ${response.url()}`);
  });
}

function diagnosticAssets(diagnostics) {
  if (Array.isArray(diagnostics?.assets)) return diagnostics.assets;
  if (diagnostics?.assets && typeof diagnostics.assets === "object") {
    return Object.entries(diagnostics.assets).map(([id, asset]) => ({ id, ...asset }));
  }
  return [];
}

function diagnosticAsset(diagnostics, id) {
  return diagnosticAssets(diagnostics).find((asset) => asset.id === id);
}

function assetClips(asset) {
  if (Array.isArray(asset?.clips)) return asset.clips.map((clip) => typeof clip === "string" ? clip : clip?.name).filter(Boolean);
  if (asset?.clips && typeof asset.clips === "object") return Object.keys(asset.clips);
  return [];
}

function activeHeroClip(diagnostics) {
  return diagnostics?.hero?.activeClip
    || diagnostics?.hero?.clip
    || diagnosticAsset(diagnostics, "hero-tardigrade")?.activeClip
    || diagnosticAsset(diagnostics, "hero-tardigrade")?.clip
    || "";
}

async function seedContext(context) {
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch (_) {}
    let seed = 0x71a6d4de;
    Math.random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  });
}

async function bootPage(context, origin, label, issues, options = {}) {
  const page = await context.newPage();
  watchPage(page, origin, label, issues, options);
  await page.goto(`${origin}/games/tardigrade-micro-mayhem.html?qa=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const debug = window.__MICRO_MAYHEM_DEBUG;
    return debug?.state?.ready
      && debug?.world?.renderer
      && debug?.world?.tardigrade
      && (debug.world.physics?.ready || debug.world.physics?.failed)
      && typeof debug.getModelDiagnostics === "function"
      && typeof window.render_game_to_text === "function"
      && typeof window.advanceTime === "function";
  }, null, { timeout: 120_000 });
  await page.waitForFunction((expectedIds) => {
    const diagnostics = window.__MICRO_MAYHEM_DEBUG.getModelDiagnostics();
    const assets = Array.isArray(diagnostics?.assets)
      ? diagnostics.assets
      : Object.entries(diagnostics?.assets || {}).map(([id, asset]) => ({ id, ...asset }));
    return diagnostics?.settled === true && expectedIds.every((id) => assets.some((asset) => asset.id === id));
  }, EXPECTED_IDS, { timeout: 120_000 });
  return page;
}

async function readDiagnostics(page) {
  return page.evaluate(() => window.__MICRO_MAYHEM_DEBUG.getModelDiagnostics());
}

async function advance(page, ms) {
  await page.evaluate((duration) => window.advanceTime(duration), ms);
}

async function captureCanvas(page, filename) {
  const box = await page.locator("#gameCanvas").boundingBox();
  assert(box && box.width > 0 && box.height > 0, "gameCanvas has no capturable browser bounds");
  await page.screenshot({
    path: path.join(artifactDir, filename),
    clip: {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: box.width,
      height: box.height,
    },
  });
}

async function frameHeroForProof(page) {
  await page.evaluate(() => {
    const debug = window.__MICRO_MAYHEM_DEBUG;
    debug.state.calloutTimer = 0;
    document.getElementById("micro-callout")?.classList.remove("micro-callout--show");
    document.getElementById("micro-prompt")?.classList.remove("micro-prompt--show");
    debug.world.tardigrade.rotation.y = Math.PI;
    debug.frameHero();
  });
}

async function startFromOverlay(page) {
  // A trusted headless pointer event also primes the site's shared Web Audio
  // context and can spend tens of seconds waiting on the CI audio backend.
  // This focused model regression invokes the same button click handler without
  // coupling asset validation to that unrelated browser-audio cold start.
  await page.locator("#btn-primary").evaluate((button) => button.click());
  await page.waitForFunction(() => window.__MICRO_MAYHEM_DEBUG.state.running);
}

async function expectHeroClip(page, expected, action) {
  await action();
  const diagnostics = await readDiagnostics(page);
  assert(activeHeroClip(diagnostics) === expected, `hero should use ${expected}; diagnostics: ${JSON.stringify(diagnostics.hero || diagnosticAsset(diagnostics, "hero-tardigrade"))}`);
}

async function runBrowserRegression() {
  fs.mkdirSync(artifactDir, { recursive: true });
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser = null;
  const issues = [];

  try {
    browser = await chromium.launch({ headless: true });

    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await seedContext(desktop);
    const desktopPage = await bootPage(desktop, origin, "desktop", issues);
    const initialDiagnostics = await readDiagnostics(desktopPage);
    for (const expected of EXPECTED_ASSETS) {
      const asset = diagnosticAsset(initialDiagnostics, expected.id);
      assert(asset, `runtime diagnostics are missing ${expected.id}`);
      assert(["ready", "loaded", "active"].includes(String(asset.status || "").toLowerCase()), `${expected.id} did not load: ${JSON.stringify(asset)}`);
      assert(!asset.fallbackActive, `${expected.id} unexpectedly used its procedural fallback`);
      assert(Number(asset.totalInstances) > 0, `${expected.id} diagnostics report no live instances`);
      assert(Number(asset.activeInstances) > 0, `${expected.id} diagnostics report no active authored instances`);
      assert(Number(asset.fallbackInstances) === 0, `${expected.id} retained visible fallback instances after its GLB loaded`);
      for (const clip of expected.clips) {
        assert(assetClips(asset).includes(clip), `${expected.id} diagnostics are missing ${clip}`);
      }
    }

    await desktopPage.evaluate(() => {
      window.__TARDIGRADE_PROXY_QA__ = window.__MICRO_MAYHEM_DEBUG.world.tardigrade;
    });
    await startFromOverlay(desktopPage);
    await advance(desktopPage, 80);
    await expectHeroClip(desktopPage, "idle", async () => {});
    await frameHeroForProof(desktopPage);
    await captureCanvas(desktopPage, "hero-reference-idle.png");
    await desktopPage.evaluate(() => window.__MICRO_MAYHEM_DEBUG.clearModelFrame());
    await advance(desktopPage, 20);

    const beforeMove = await desktopPage.evaluate(() => ({ ...window.__MICRO_MAYHEM_DEBUG.state.player }));
    await desktopPage.keyboard.down("w");
    await advance(desktopPage, 260);
    await expectHeroClip(desktopPage, "scuttle", async () => {});
    await desktopPage.keyboard.up("w");
    const proxyAfterMove = await desktopPage.evaluate(() => {
      const debug = window.__MICRO_MAYHEM_DEBUG;
      const root = debug.world.tardigrade;
      return {
        sameRoot: root === window.__TARDIGRADE_PROXY_QA__,
        player: { ...debug.state.player },
        root: { x: root.position.x, y: root.position.y, z: root.position.z },
      };
    });
    assert(
      Math.hypot(proxyAfterMove.player.x - beforeMove.x, proxyAfterMove.player.z - beforeMove.z) > 0.05,
      "W input no longer moves the authoritative player state",
    );
    assert(proxyAfterMove.sameRoot, "loading the hero GLB replaced the authoritative gameplay proxy root");
    assert(
      Math.hypot(
        proxyAfterMove.root.x - proxyAfterMove.player.x,
        proxyAfterMove.root.y - proxyAfterMove.player.y,
        proxyAfterMove.root.z - proxyAfterMove.player.z,
      ) < 0.15,
      "hero visual root no longer follows the authoritative gameplay proxy",
    );

    await expectHeroClip(desktopPage, "dash", async () => {
      await desktopPage.keyboard.press("Shift");
      await advance(desktopPage, 40);
    });
    await expectHeroClip(desktopPage, "curl", async () => {
      await desktopPage.keyboard.down("e");
      await advance(desktopPage, 50);
    });
    await desktopPage.keyboard.up("e");
    await expectHeroClip(desktopPage, "airborne", async () => {
      await desktopPage.keyboard.press("Space");
      await advance(desktopPage, 50);
    });

    const stageProxy = await desktopPage.evaluate(async () => {
      const debug = window.__MICRO_MAYHEM_DEBUG;
      const firstSkinnedMesh = (root) => {
        let result = null;
        root?.traverse((child) => {
          if (!result && child.isSkinnedMesh) result = child;
        });
        return result;
      };
      debug.unlockStage(2);
      debug.transitionToStage(2);
      await window.advanceTime(60);
      const preservedOnTwo = debug.world.tardigrade === window.__TARDIGRADE_PROXY_QA__;

      const rotiferOwners = debug.world.creatures.filter((creature) => creature.userData?.type === "rotifer");
      const rotiferBindings = rotiferOwners.map((owner) => owner.userData?.modelBinding).filter(Boolean);
      const first = rotiferBindings[0];
      const second = rotiferBindings[1];
      const firstMesh = firstSkinnedMesh(first?.model);
      const secondMesh = firstSkinnedMesh(second?.model);
      const firstBone = firstMesh?.skeleton?.bones?.find((bone) => bone.name === "Body_01") || firstMesh?.skeleton?.bones?.[0];
      const secondBone = secondMesh?.skeleton?.bones?.find((bone) => bone.name === firstBone?.name) || secondMesh?.skeleton?.bones?.[0];
      let independentBonePose = false;
      if (firstBone && secondBone) {
        const firstBefore = firstBone.rotation.x;
        const secondBefore = secondBone.rotation.x;
        firstBone.rotation.x += 0.137;
        independentBonePose = Math.abs(secondBone.rotation.x - secondBefore) < 1e-9;
        firstBone.rotation.x = firstBefore;
      }
      const sharedGeometry = firstMesh?.geometry;
      let disposeEvents = 0;
      const onDispose = () => { disposeEvents += 1; };
      sharedGeometry?.addEventListener("dispose", onDispose);
      const cloneAudit = {
        count: rotiferBindings.length,
        distinctBindings: Boolean(first && second && first !== second),
        distinctModels: Boolean(first?.model && second?.model && first.model !== second.model),
        distinctMixers: Boolean(first?.mixer && second?.mixer && first.mixer !== second.mixer),
        distinctSkeletons: Boolean(firstMesh?.skeleton && secondMesh?.skeleton && firstMesh.skeleton !== secondMesh.skeleton),
        sharedGeometry: Boolean(sharedGeometry && secondMesh?.geometry === sharedGeometry),
        independentBonePose,
      };

      debug.transitionToStage(3);
      await window.advanceTime(40);
      debug.transitionToStage(2);
      await window.advanceTime(40);
      const replacementRotifer = debug.world.creatures
        .filter((creature) => creature.userData?.type === "rotifer")
        .map((owner) => owner.userData?.modelBinding)
        .find((binding) => binding?.model);
      const replacementMesh = firstSkinnedMesh(replacementRotifer?.model);
      const resourceAudit = {
        disposeEvents,
        reusedGeometry: Boolean(sharedGeometry && replacementMesh?.geometry === sharedGeometry),
        positionCount: Number(replacementMesh?.geometry?.attributes?.position?.count || 0),
        activeRotifers: debug.getModelDiagnostics().assets.find((asset) => asset.id === "creature-rotifer")?.activeInstances || 0,
      };
      sharedGeometry?.removeEventListener("dispose", onDispose);

      debug.transitionToStage(1);
      await window.advanceTime(60);
      return {
        preservedOnTwo,
        preservedOnOne: debug.world.tardigrade === window.__TARDIGRADE_PROXY_QA__,
        stage: debug.state.stage,
        cloneAudit,
        resourceAudit,
      };
    });
    assert(stageProxy.preservedOnTwo && stageProxy.preservedOnOne && stageProxy.stage === 1, `stage rebuild replaced the gameplay proxy: ${JSON.stringify(stageProxy)}`);
    assert(
      stageProxy.cloneAudit.count >= 2
        && stageProxy.cloneAudit.distinctBindings
        && stageProxy.cloneAudit.distinctModels
        && stageProxy.cloneAudit.distinctMixers
        && stageProxy.cloneAudit.distinctSkeletons
        && stageProxy.cloneAudit.sharedGeometry
        && stageProxy.cloneAudit.independentBonePose,
      `same-archetype rotifer clones are not independent while sharing immutable resources: ${JSON.stringify(stageProxy.cloneAudit)}`,
    );
    assert(
      stageProxy.resourceAudit.disposeEvents === 0
        && stageProxy.resourceAudit.reusedGeometry
        && stageProxy.resourceAudit.positionCount > 0
        && stageProxy.resourceAudit.activeRotifers >= 2,
      `shared rotifer resources did not survive a stage rebuild: ${JSON.stringify(stageProxy.resourceAudit)}`,
    );

    const textState = await desktopPage.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert(typeof textState.coords === "string" && textState.coords.length > 0, "render_game_to_text must describe its coordinate system");
    assert(["playing", "gameplay", "running"].includes(String(textState.mode || textState.screen || "").toLowerCase()), `render_game_to_text has the wrong mode: ${JSON.stringify(textState)}`);
    assert(Number(textState.stage ?? textState.level) === 1, `render_game_to_text must report stage 1: ${JSON.stringify(textState)}`);
    assert(
      [textState.player?.x, textState.player?.y, textState.player?.z].every(Number.isFinite),
      `render_game_to_text must report finite player coordinates: ${JSON.stringify(textState.player)}`,
    );
    await advance(desktopPage, 900);
    await captureCanvas(desktopPage, "desktop-stage-one.png");
    await desktop.close();

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
    });
    await seedContext(mobile);
    const mobilePage = await bootPage(mobile, origin, "mobile", issues);
    await startFromOverlay(mobilePage);
    await advance(mobilePage, 250);
    const mobileLayout = await mobilePage.evaluate(() => {
      const canvas = document.getElementById("gameCanvas");
      const canvasRect = canvas.getBoundingClientRect();
      const controls = ["btn-jump", "btn-dash", "btn-curl"].map((id) => {
        const element = document.getElementById(id);
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          id,
          width: rect.width,
          height: rect.height,
          visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
        };
      });
      return {
        canvas: { width: canvasRect.width, height: canvasRect.height },
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        controls,
      };
    });
    assert(mobileLayout.canvas.width >= 350 && mobileLayout.canvas.width <= 390, `mobile canvas width is invalid: ${JSON.stringify(mobileLayout)}`);
    assert(mobileLayout.scrollWidth <= mobileLayout.innerWidth + 1, `mobile page overflows horizontally: ${JSON.stringify(mobileLayout)}`);
    assert(mobileLayout.controls.every((control) => control.visible && control.width >= 44 && control.height >= 44), `mobile controls are obscured or too small: ${JSON.stringify(mobileLayout.controls)}`);
    await captureCanvas(mobilePage, "mobile-stage-one.png");
    await mobile.close();

    const fallbackIssues = [];
    const fallback = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await seedContext(fallback);
    await fallback.route("**/assets/models/tardigrade/creature-ciliate.glb*", (route) => route.abort("failed"));
    const fallbackPage = await bootPage(fallback, origin, "ciliate-fallback", fallbackIssues, { allowCiliateFailure: true });
    const fallbackDiagnostics = await readDiagnostics(fallbackPage);
    const ciliate = diagnosticAsset(fallbackDiagnostics, "creature-ciliate");
    assert(
      ciliate?.fallbackActive === true || ["fallback", "failed-with-fallback"].includes(String(ciliate?.status || "").toLowerCase()),
      `ciliate network failure did not activate the procedural fallback: ${JSON.stringify(ciliate)}`,
    );
    assert(Number(ciliate?.activeInstances) === 0, `failed ciliate GLB unexpectedly retained authored instances: ${JSON.stringify(ciliate)}`);
    assert(Number(ciliate?.fallbackInstances) > 0, `failed ciliate GLB reports no procedural fallback instances: ${JSON.stringify(ciliate)}`);
    await startFromOverlay(fallbackPage);
    await advance(fallbackPage, 200);
    const fallbackState = await fallbackPage.evaluate(() => {
      const debug = window.__MICRO_MAYHEM_DEBUG;
      const ciliateOwners = debug.world.creatures.filter((creature) => creature.userData?.type === "ciliate");
      const details = ciliateOwners.map((owner) => {
        const binding = owner.userData?.modelBinding;
        const fallback = binding?.fallback;
        let fallbackMeshCount = 0;
        let authoredModelCount = 0;
        fallback?.traverse((child) => {
          if (child.isMesh) fallbackMeshCount += 1;
        });
        owner.traverse((child) => {
          if (child.userData?.kind === "authoredModel" || /-authored-visual$/.test(child.name || "")) {
            authoredModelCount += 1;
          }
        });
        const box = fallback ? new window.THREE.Box3().setFromObject(fallback) : null;
        const size = box ? box.getSize(new window.THREE.Vector3()) : null;
        const dimensions = size ? [size.x, size.y, size.z] : [];
        return {
          ownerVisible: owner.visible && owner.parent === debug.world.scene,
          authoredModelAbsent: !binding?.modelRoot && !binding?.model && authoredModelCount === 0,
          fallbackVisible: fallback?.visible === true && fallback.parent === owner,
          fallbackMeshCount,
          fallbackNonempty: dimensions.length === 3
            && dimensions.every(Number.isFinite)
            && Math.max(...dimensions) > 0.05,
        };
      });
      return {
        running: debug.state.running,
        ciliates: ciliateOwners.length,
        hero: Boolean(debug.world.tardigrade),
        details,
      };
    });
    assert(fallbackState.running && fallbackState.hero && fallbackState.ciliates >= 1, `ciliate fallback did not preserve gameplay: ${JSON.stringify(fallbackState)}`);
    assert(
      fallbackState.details.length === fallbackState.ciliates
        && fallbackState.details.every((detail) => (
          detail.ownerVisible
          && detail.authoredModelAbsent
          && detail.fallbackVisible
          && detail.fallbackMeshCount > 0
          && detail.fallbackNonempty
        )),
      `ciliate fallback is hidden, empty, detached, or mixed with an authored model: ${JSON.stringify(fallbackState.details)}`,
    );
    await captureCanvas(fallbackPage, "fallback-ciliate.png");
    assert(fallbackIssues.length === 0, `unexpected fallback errors:\n${fallbackIssues.join("\n")}`);
    await fallback.close();

    assert(issues.length === 0, `unexpected browser errors:\n${issues.join("\n")}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function run() {
  validateStaticAssets();
  if (process.env.TARDIGRADE_STATIC_ONLY === "1") {
    console.log("Tardigrade Meshy/Blender static validation passed: provenance, hashes, budgets, textures, sockets, and animation pose semantics.");
    return;
  }
  await runBrowserRegression();
  console.log("Tardigrade Meshy/Blender regression passed: eight budgeted GLBs, required animation semantics, gameplay proxies, diagnostics, desktop/mobile proof, and ciliate fallback.");
}

run().catch((error) => {
  console.error(`Tardigrade Meshy/Blender regression failed: ${error.message}`);
  process.exitCode = 1;
});
