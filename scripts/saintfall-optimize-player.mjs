#!/usr/bin/env node
/* Build the final browser asset from Blender's deterministic raw export.

   The Meshy rig carries one excellent 2K colour atlas, but as a packed PNG
   it accounts for more than 80% of the download.  WebP keeps the authored
   patina and chipped ivory at the gameplay camera while avoiding a 9MB
   character payload.  No mesh compression is used, so the asset remains
   compatible with Saintfall's existing GLTFLoader configuration. */

import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress } from "@gltf-transform/functions";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, "assets/models/saintfall/vesper/vesper-reliquary-polished.raw.glb");
const output = path.join(root, "assets/models/saintfall/vesper/vesper-reliquary-player.glb");

/* ============================================================
   WHITE AND GOLD

   Meshy's atlas is a four-colour scheme: ivory plate, sage/verdigris
   green, amber-gold trim and near-black recesses. The brief is white
   and gold only, and the green is 15% of the texture by area with
   much of the "yellow" bucket actually olive.

   A flat luminance duotone is the obvious move and the wrong one: it
   pushes EVERYTHING gold, including the ivory plate, and the figure
   loses the plate/trim distinction that carries its whole read. What
   separates those two families in the source is not luminance, it is
   SATURATION - the plate and the recesses are near-neutral, the
   verdigris and the trim are not.

   So the remap splits on saturation and keeps luminance untouched on
   both sides. Neutral pixels become warm greys (shades of white);
   saturated pixels land on a gold ramp at the luminance they already
   had. Every panel line, chip and dirt pass in the original survives,
   because none of this touches local contrast.
   ============================================================ */

// Deep gold shadow, mid gold, near-white polish. Three stops, not two:
// a straight dark->gold lerp reads as flat brass with no highlight.
/* The LOW stops have to stay genuinely dark. A three-stop ramp maps
   luminance 0 onto its bottom colour, so picking a mid-shadow brown
   there raises the floor of the whole figure - the first pass put
   0x4a3314/0x3a3127 in and the plate's p05 luminance went 11 -> 17,
   which reads as an armour with no junctions. Warm is a hue
   decision; dark is a value decision, and these two stops are the
   ones carrying the value. */
const GOLD_LOW = [0x11, 0x0b, 0x03];
const GOLD_MID = [0xd8, 0xac, 0x45];
const GOLD_HIGH = [0xff, 0xf6, 0xd8];

/* The white family is a RAMP, not a luminance multiplier.
   Tinting a neutral grey by a constant (the first version multiplied
   luminance by [1.0, 0.984, 0.945]) keeps the tint proportional to
   brightness, so it vanishes exactly where it is needed: every
   recess, every panel line, the whole shadow side of the figure
   stayed dead neutral and the trooper read grey in play even though
   the lit plate was white. Warmth has to be strongest in the darks.
   Three stops - warm shadow, cream, near-white - do that. */
const IVORY_LOW = [0x0c, 0x0a, 0x07];
const IVORY_MID = [0xd6, 0xcc, 0xb4];
const IVORY_HIGH = [0xff, 0xfc, 0xf2];

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function ramp(low, mid, high, l) {
  if (l < 0.5) {
    const t = l / 0.5;
    return low.map((c, i) => c + (mid[i] - c) * t);
  }
  const t = (l - 0.5) / 0.5;
  return mid.map((c, i) => c + (high[i] - c) * t);
}

async function recolourAtlas(image, mime) {
  const source = sharp(Buffer.from(image));
  const meta = await source.metadata();
  const hasAlpha = !!meta.hasAlpha;
  const { data, info } = await sharp(Buffer.from(image))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const lightness = (mx + mn) / 2;
    const sat = mx === mn
      ? 0
      : (lightness > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn));
    // Perceptual luminance drives both ramps, so the two families keep
    // matching values where they meet at a panel edge.
    const luma = Math.min(1, 0.2126 * r + 0.7152 * g + 0.0722 * b);
    /* Where this threshold sits decides the whole read of the figure.
       At 0.10-0.26 it caught the ivory itself - Meshy's plate is not
       a clean neutral, it carries a warm dirt pass - and the trooper
       came out gold from helm to sabaton with white only in the
       greaves. The armour is white with gold TRIM, so the band has to
       clear the dirtied plate and admit only the verdigris and the
       amber, which are genuinely saturated. */
    const goldness = smoothstep(0.26, 0.46, sat);
    const gold = ramp(GOLD_LOW, GOLD_MID, GOLD_HIGH, luma);
    const ivory = ramp(IVORY_LOW, IVORY_MID, IVORY_HIGH, luma);
    /* HUE FROM THE RAMP, VALUE FROM THE SOURCE.

       Taking the ramp's colour directly rewrites the atlas's own
       tonal structure: a three-stop curve through a mid at 0xd6ccb4
       sits far above a linear response, so everything below the
       midpoint came out roughly twice as bright. The figure did read
       warmer - but the plate's 5th-percentile luminance went 11 to
       15, and an armour whose junctions have lifted out of shadow has
       lost the thing that makes it armour.

       Renormalising each ramp sample back onto the source luminance
       keeps every chip, panel line and dirt pass at exactly the value
       Meshy painted it, and lets this pass do only the job it is for.
       Warmth is a hue decision. It was being spent as a value one. */
    let rr = ivory[0] + (gold[0] - ivory[0]) * goldness;
    let gg = ivory[1] + (gold[1] - ivory[1]) * goldness;
    let bb = ivory[2] + (gold[2] - ivory[2]) * goldness;
    const tint = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
    const scale = tint > 1 ? (luma * 255) / tint : 0;
    data[i] = Math.min(255, Math.round(rr * scale));
    data[i + 1] = Math.min(255, Math.round(gg * scale));
    data[i + 2] = Math.min(255, Math.round(bb * scale));
  }
  const out = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  const encoded = hasAlpha || mime === "image/png"
    ? await out.png().toBuffer()
    : await out.removeAlpha().jpeg({ quality: 96 }).toBuffer();
  return { buffer: encoded, mime: hasAlpha || mime === "image/png" ? "image/png" : "image/jpeg" };
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);

let recoloured = 0;
for (const texture of document.getRoot().listTextures()) {
  const image = texture.getImage();
  if (!image) continue;
  const { buffer, mime } = await recolourAtlas(image, texture.getMimeType());
  texture.setImage(buffer);
  texture.setMimeType(mime);
  recoloured += 1;
}

await document.transform(
  dedup(),
  prune(),
  textureCompress({
    encoder: sharp,
    targetFormat: "webp",
    resize: [2048, 2048],
    quality: 90,
    effort: 5,
  }),
);

await io.write(output, document);

const gltf = document.getRoot();
let triangles = 0;
let invalidValues = 0;
let duplicateFaces = 0;
const faceKeys = new Set();
for (const mesh of gltf.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const indices = primitive.getIndices();
    const position = primitive.getAttribute("POSITION");
    if (!position) throw new Error("player primitive is missing POSITION");
    const positions = position.getArray();
    for (const value of positions) if (!Number.isFinite(value)) invalidValues += 1;
    const indexArray = indices?.getArray();
    const count = indices ? indices.getCount() : position.getCount();
    if (count % 3) throw new Error(`player primitive index count is not triangular: ${count}`);
    triangles += Math.round(count / 3);

    /* Export regressions need a geometric test, not a density test.
       Quantisation is deliberately near float precision in the
       armature-scaled accessor space; it merges UV-split copies at
       the same location without treating legitimate sub-millimetre
       bevel triangles as duplicate faces. */
    const pointKey = (vertexIndex) => {
      const base = vertexIndex * 3;
      return [positions[base], positions[base + 1], positions[base + 2]]
        .map((value) => Math.round(value / 0.00001)).join(",");
    };
    for (let i = 0; i < count; i += 3) {
      const ia = indexArray ? indexArray[i] : i;
      const ib = indexArray ? indexArray[i + 1] : i + 1;
      const ic = indexArray ? indexArray[i + 2] : i + 2;
      const key = [pointKey(ia), pointKey(ib), pointKey(ic)].sort().join("|");
      if (faceKeys.has(key)) duplicateFaces += 1;
      else faceKeys.add(key);
    }
  }
}

const before = statSync(input).size;
const after = statSync(output).size;
console.log(`${path.relative(root, input)} -> ${path.relative(root, output)}`);
console.log(`  ${(before / 1048576).toFixed(2)}MB -> ${(after / 1048576).toFixed(2)}MB`);
console.log(`  ${recoloured} texture(s) remapped to white + gold`);
console.log(`  ${triangles.toLocaleString()} triangles · ${gltf.listMaterials().length} materials`
  + ` · ${gltf.listTextures().length} texture · ${gltf.listSkins()[0]?.listJoints().length ?? 0} joints`);
console.log(`  ${duplicateFaces} duplicate faces · ${invalidValues} invalid accessor values`
  + ` · ${gltf.listNodes().length} scene nodes`);

if (triangles > 28000) throw new Error(`player triangle budget exceeded: ${triangles}`);
if (after > 6 * 1048576) throw new Error(`player download budget exceeded: ${after} bytes`);
if (gltf.listSkins().length !== 1) throw new Error("player must export exactly one skin");
if (gltf.listAnimations().length !== 0) throw new Error("runtime-owned player rig must not contain baked clips");
if (gltf.listMeshes().length !== 1) throw new Error("player must export exactly one mesh");
if (invalidValues !== 0) throw new Error(`player contains ${invalidValues} invalid accessor values`);
if (duplicateFaces !== 0) throw new Error(`player contains ${duplicateFaces} duplicate faces`);
const forbiddenHelpers = new Set(["Cube", "Icosphere", "Camera", "Light"]);
const leakedHelpers = gltf.listNodes().map((node) => node.getName()).filter((name) => forbiddenHelpers.has(name));
if (leakedHelpers.length) throw new Error(`player contains leaked Blender helpers: ${leakedHelpers.join(", ")}`);
