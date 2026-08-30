#!/usr/bin/env node
/* ============================================================
   INKBLOOD — shipping asset audit

   Loads the generated manga plates through the real game pipeline,
   checks every gameplay-facing canvas for alpha touching its frame,
   and writes contact sheets for human inspection.

   Usage: node scripts/inkblood-asset-audit.mjs
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8741;
const OUT = path.join(root, "output", "inkblood-asset-audit");

async function ensureServer() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/`, { method: "HEAD" });
    if (response.ok || response.status === 404) return null;
  } catch { /* start a local server */ }

  const proc = spawn("python3", ["-m", "http.server", String(PORT)], {
    cwd: root,
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    await delay(120);
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/`, { method: "HEAD" });
      if (response.ok || response.status === 404) return proc;
    } catch { /* keep waiting */ }
  }
  throw new Error("server never came up");
}

await mkdir(OUT, { recursive: true });
const proc = await ensureServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.goto(`http://127.0.0.1:${PORT}/games/inkblood.html`, {
  waitUntil: "domcontentloaded",
});
await page.waitForFunction(() => window.__INK?.ready, null, { timeout: 60000 });

const report = await page.evaluate(async () => {
  // Match the exact versioned module URLs imported by game.js. Importing the
  // bare paths would create fresh module instances with uninstalled atlases.
  const { PROPS } = await import("/assets/js/inkblood/props.js?v=20260803-calm-1");
  const { ATLAS } = await import("/assets/js/inkblood/fx.js?v=20260803-close-slash-1");
  const { WEP_ART } = await import("/assets/js/inkblood/weapons.js?v=20260803-close-slash-1");
  const game = window.__INK.game;
  const records = [];
  const gallery = { cast: [], props: [], combat: [] };

  const canvasOf = (value) => value?.canvas || value;
  const add = (group, name, value) => {
    const canvas = canvasOf(value);
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) {
      records.push({ group, name, missing: true });
      return;
    }

    const context = canvas.getContext("2d", { willReadFrequently: true });
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    const alphaAt = (x, y) => pixels[(y * width + x) * 4 + 3];
    let top = 0;
    let bottom = 0;
    let left = 0;
    let right = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let x = 0; x < width; x++) {
      if (alphaAt(x, 0) > 8) top++;
      if (alphaAt(x, height - 1) > 8) bottom++;
    }
    for (let y = 0; y < height; y++) {
      if (alphaAt(0, y) > 8) left++;
      if (alphaAt(width - 1, y) > 8) right++;
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (alphaAt(x, y) <= 8) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    records.push({
      group,
      name,
      width,
      height,
      border: { top, bottom, left, right },
      margin: maxX < 0 ? null : {
        top: minY,
        bottom: height - 1 - maxY,
        left: minX,
        right: width - 1 - maxX,
      },
    });
  };

  const addClip = (group, name, frames) => {
    frames.forEach((frame, index) => add(group, `${name}.${index}`, frame));
  };

  addClip("hero", "idle", game.art.hero.idle);
  addClip("hero", "run", game.art.hero.run);
  addClip("hero", "slash", game.art.hero.slash);
  for (const [name, record] of Object.entries(game.art.cast)) {
    addClip("cast", `${name}.walk`, record.frames);
    addClip("cast", `${name}.attack`, record.attackFrames);
    gallery.cast.push({
      name,
      frames: [record.frames[0], record.frames[1], record.attackFrames[1]],
    });
  }

  for (const key of ["grass", "stone", "bone", "grave", "tree", "ruin"]) {
    PROPS[key].forEach((asset, index) => {
      add("props", `${key}.${index}`, asset);
      gallery.props.push({ name: `${key} ${index + 1}`, canvas: asset });
    });
  }
  for (const key of ["lantern", "torii"]) {
    add("props", key, PROPS[key]);
    gallery.props.push({ name: key, canvas: PROPS[key] });
  }

  const combat = {
    gem: ATLAS.gem,
    gemBig: ATLAS.gemBig,
    coin: ATLAS.coin,
    heart: ATLAS.heart,
    chest: ATLAS.chest,
    enemyShot: ATLAS.enemyShot,
    inkHit: ATLAS.inkHit?.[0],
    slash: ATLAS.slash?.[0],
    bloodSplat: ATLAS.bloodSplat?.[0],
    kunai: WEP_ART.kunai,
    ofuda: WEP_ART.ofuda,
    crowA: WEP_ART.crow?.[0],
    crowB: WEP_ART.crow?.[1],
    sickle: WEP_ART.sickle,
    fang: WEP_ART.fang,
  };
  for (const [name, asset] of Object.entries(combat)) {
    add("combat", name, asset);
    gallery.combat.push({ name, canvas: canvasOf(asset) });
  }

  const sheet = (items, columns, tileW, tileH, drawItem) => {
    const rows = Math.ceil(items.length / columns);
    const canvas = document.createElement("canvas");
    canvas.width = columns * tileW;
    canvas.height = rows * tileH;
    const context = canvas.getContext("2d");
    context.fillStyle = "#efeade";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(16,16,20,0.24)";
    context.fillStyle = "#101014";
    context.font = "700 18px system-ui";
    items.forEach((item, index) => {
      const x = (index % columns) * tileW;
      const y = Math.floor(index / columns) * tileH;
      context.strokeRect(x + 0.5, y + 0.5, tileW - 1, tileH - 1);
      context.fillText(item.name, x + 14, y + 26);
      drawItem(context, item, x, y, tileW, tileH);
    });
    return canvas.toDataURL("image/png");
  };

  const drawFit = (context, canvas, x, y, w, h) => {
    if (!canvas) return;
    const scale = Math.min(w / canvas.width, h / canvas.height, 1.35);
    const dw = canvas.width * scale;
    const dh = canvas.height * scale;
    context.drawImage(canvas, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  };

  const castSheet = sheet(gallery.cast, 3, 560, 390, (context, item, x, y, w, h) => {
    const cellW = w / item.frames.length;
    item.frames.forEach((frame, index) => {
      drawFit(context, canvasOf(frame), x + index * cellW, y + 44, cellW, h - 54);
    });
  });
  const propsSheet = sheet(gallery.props, 4, 420, 360, (context, item, x, y, w, h) => {
    drawFit(context, item.canvas, x + 8, y + 38, w - 16, h - 46);
  });
  const combatSheet = sheet(gallery.combat, 5, 336, 250, (context, item, x, y, w, h) => {
    drawFit(context, item.canvas, x + 8, y + 38, w - 16, h - 46);
  });

  return {
    manifest: game.generatedAssets,
    records,
    sheets: { castSheet, propsSheet, combatSheet },
  };
});

for (const [name, dataUrl] of Object.entries(report.sheets)) {
  const selector = `#${name}`;
  await page.setContent(`<img id="${name}" src="${dataUrl}" style="display:block">`);
  await page.locator(selector).screenshot({ path: path.join(OUT, `${name}.png`) });
}

const failures = report.records.filter((record) => {
  if (record.missing || !record.margin) return true;
  return Object.values(record.border).some((value) => value > 0);
});
const groups = Object.groupBy
  ? Object.groupBy(report.records, (record) => record.group)
  : report.records.reduce((out, record) => {
    (out[record.group] ||= []).push(record);
    return out;
  }, {});

console.log(`generated manifest: ${report.manifest.status} (${report.manifest.loaded.length} loaded, ${report.manifest.failed.length} failed)`);
for (const [group, records] of Object.entries(groups)) {
  const clipped = records.filter((record) => failures.includes(record));
  console.log(`${group.padEnd(8)} ${String(records.length).padStart(3)} checked, ${clipped.length} clipped or missing`);
}
for (const failure of failures) console.log("CLIPPED", JSON.stringify(failure));
if (errors.length) console.log("browser errors:", errors);
console.log(`contact sheets: ${OUT}`);

await browser.close();
if (proc) proc.kill();
process.exit(failures.length || errors.length ? 1 : 0);
