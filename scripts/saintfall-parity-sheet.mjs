#!/usr/bin/env node
/* Side-by-side Vesper production-target review sheet. */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "output/saintfall/critic/v8");
const out = path.join(outDir, "v3-target-vs-v8-browser.png");
await mkdir(outDir, { recursive: true });

const cells = [
  ["TARGET · TRAVERSAL", "assets/img/saintfall/concepts/saintfall-vesper-reliquary-production-traversal-v3.png"],
  ["TARGET · COMBAT", "assets/img/saintfall/concepts/saintfall-vesper-reliquary-production-combat-v3.png"],
  ["TARGET · SHRINE", "assets/img/saintfall/concepts/saintfall-vesper-reliquary-production-shrine-v3.png"],
  ["BROWSER · MARCH", "output/saintfall/aaa-vesper-v8-hero/3-march.png"],
  ["BROWSER · COMBAT", "output/saintfall/aaa-vesper-v8-hero/2-combat.png"],
  ["BROWSER · REAR", "output/saintfall/aaa-vesper-v8-hero/7-back.png"],
];

const width = 1920;
const height = 1200;
const cellWidth = width / 3;
const cellHeight = height / 2;
const composites = [];

for (let i = 0; i < cells.length; i += 1) {
  const [label, relative] = cells[i];
  const image = await sharp(path.join(root, relative))
    .resize(Math.round(cellWidth), Math.round(cellHeight), {
      fit: "cover", position: "attention",
    })
    .modulate({ brightness: 1.0 })
    .png()
    .toBuffer();
  const x = Math.round((i % 3) * cellWidth);
  const y = Math.round(Math.floor(i / 3) * cellHeight);
  composites.push({ input: image, left: x, top: y });
  const labelSvg = Buffer.from(`<svg width="${Math.round(cellWidth)}" height="54">
    <rect width="100%" height="54" fill="rgba(9,10,13,0.82)"/>
    <text x="22" y="35" fill="#f4d28b" font-family="Arial, sans-serif"
      font-weight="700" font-size="22" letter-spacing="2">${label}</text>
  </svg>`);
  composites.push({ input: labelSvg, left: x, top: y });
}

await sharp({
  create: { width, height, channels: 3, background: "#0c0d10" },
}).composite(composites).png().toFile(out);

console.log(path.relative(root, out));
