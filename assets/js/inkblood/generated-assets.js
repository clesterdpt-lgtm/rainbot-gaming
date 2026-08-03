"use strict";

import { PAL, makeCanvas, ctxOf } from "./art.js?v=20260803-2";
import { silhouetteOf } from "./figure.js?v=20260803-2";

const VERSION = "20260803-manga-1";
const MODULE_URL = new URL(import.meta.url);
const ASSET_ROOT = new URL("../../img/inkblood/generated/", MODULE_URL);
const ALPHA_THRESHOLD = 8;
const FRAME_PADDING = 8;
const LOAD_TIMEOUT_MS = 30000;

const SOURCES = {
  hero: {
    file: "hero-manga-v1.webp", width: 1003, height: 1568, required: true,
  },
  heroPortrait: {
    file: "hero-portrait-manga-v1.webp", width: 1254, height: 1254, required: true,
  },
  enemies: {
    file: "enemies-manga-v1.webp", width: 1536, height: 1024, required: true,
  },
  bosses: {
    file: "bosses-manga-v1.webp", width: 1254, height: 1254, required: true,
  },
  props: {
    file: "props-manga-v1.webp", width: 1254, height: 1254, required: false,
  },
  ground: {
    file: "ground-manga-v1.webp", width: 1254, height: 1254, required: false,
  },
  combat: {
    file: "combat-manga-v1.webp", width: 1254, height: 1254, required: false,
  },
};

const COMMON_CAST = {
  gaki: [200, 210],
  tsukumo: [170, 160],
  kamaitachi: [230, 170],
  kappa: [200, 205],
  nurikabe: [240, 240],
  yurei: [230, 285],
  mukade: [240, 155],
  onryo: [260, 345],
};

const BOSS_CAST = {
  gashadokuro: [480, 500],
  oni: [470, 470],
  nurarihyon: [470, 480],
};

const ENEMY_ROWS = [
  ["gaki", "tsukumo"],
  ["kamaitachi", "kappa"],
  ["nurikabe", "yurei"],
  ["mukade", "onryo"],
];

const BOSS_ROWS = ["gashadokuro", "oni", "nurarihyon"];
const FLOATING_CAST = new Set(["yurei", "onryo"]);

function sourceUrl(file) {
  const url = new URL(file, ASSET_ROOT);
  if (url.origin !== MODULE_URL.origin || url.protocol !== MODULE_URL.protocol) {
    throw new Error(`Generated asset must be same-origin: ${file}`);
  }
  url.searchParams.set("v", VERSION);
  return url;
}

function makeManifest() {
  const sources = {};
  const urls = {};
  for (const [key, def] of Object.entries(SOURCES)) {
    const url = sourceUrl(def.file).href;
    urls[key] = url;
    sources[key] = {
      url,
      status: "pending",
      required: def.required,
      expectedWidth: def.width,
      expectedHeight: def.height,
    };
  }
  return {
    version: VERSION,
    status: "loading",
    sources,
    urls,
    loaded: [],
    failed: [],
    failures: [],
  };
}

function reportFailure(manifest, key, error) {
  const rec = manifest.sources[key];
  const message = error instanceof Error ? error.message : String(error);
  rec.status = "failed";
  rec.error = message;
  if (!manifest.failed.includes(key)) manifest.failed.push(key);
  manifest.failures.push({
    key,
    url: rec.url,
    required: rec.required,
    error: message,
  });
}

function reportReady(manifest, key, image) {
  const rec = manifest.sources[key];
  rec.status = "ready";
  rec.width = image.naturalWidth;
  rec.height = image.naturalHeight;
  if (!manifest.loaded.includes(key)) manifest.loaded.push(key);
}

function loadImage(key, def, manifest) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = manifest.sources[key].url;
    let settled = false;
    const timeout = window.setTimeout(
      () => finish(new Error(`Timed out loading ${def.file}`)),
      LOAD_TIMEOUT_MS,
    );

    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve(image);
    };

    image.decoding = "async";
    image.onload = () => {
      if (image.naturalWidth !== def.width || image.naturalHeight !== def.height) {
        finish(new Error(
          `${def.file} is ${image.naturalWidth}x${image.naturalHeight}; expected ${def.width}x${def.height}`,
        ));
        return;
      }
      finish();
    };
    image.onerror = () => finish(new Error(`Could not load ${def.file}`));
    image.src = url;
  });
}

function safeProgress(onProgress, value, label) {
  if (typeof onProgress !== "function") return;
  try {
    onProgress(Math.max(0, Math.min(1, value)), label);
  } catch (_) {
    // Loading art must not fail because a presentation callback did.
  }
}

function nextTask() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function edgeTable(length, count) {
  return Array.from({ length: count + 1 }, (_, i) => Math.round((length * i) / count));
}

function cellAt(value, edges) {
  let low = 0;
  let high = edges.length - 2;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (value < edges[mid]) high = mid - 1;
    else if (value >= edges[mid + 1]) low = mid + 1;
    else return mid;
  }
  return Math.max(0, Math.min(edges.length - 2, low));
}

function addCount(map, key, x, y, core) {
  let rec = map.get(key);
  if (!rec) {
    rec = { count: 0, coreCount: 0, coreX: 0, coreY: 0 };
    map.set(key, rec);
  }
  rec.count += 1;
  if (core) {
    rec.coreCount += 1;
    rec.coreX += x;
    rec.coreY += y;
  }
}

function isolateGrid(image, columns, rows, options = {}) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const pixelCount = width * height;
  const xEdges = edgeTable(width, columns);
  const yEdges = edgeTable(height, rows);
  const cellCount = columns * rows;
  const source = makeCanvas(width, height);
  const sourceCtx = ctxOf(source);
  sourceCtx.clearRect(0, 0, width, height);
  sourceCtx.drawImage(image, 0, 0);
  const sourceData = sourceCtx.getImageData(0, 0, width, height);
  const rgba = sourceData.data;
  const labels = new Int32Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components = [null];
  let nextLabel = 0;

  const foreground = (index) => rgba[index * 4 + 3] >= ALPHA_THRESHOLD;
  const enqueue = (index, label, tail) => {
    if (labels[index] || !foreground(index)) return tail;
    labels[index] = label;
    queue[tail] = index;
    return tail + 1;
  };

  for (let start = 0; start < pixelCount; start++) {
    if (labels[start] || !foreground(start)) continue;
    const label = ++nextLabel;
    const stats = {
      count: 0,
      cells: new Map(),
      left: width,
      top: height,
      right: -1,
      bottom: -1,
    };
    let head = 0;
    let tail = 0;
    labels[start] = label;
    queue[tail++] = start;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = (index / width) | 0;
      const column = cellAt(x, xEdges);
      const row = cellAt(y, yEdges);
      const cell = row * columns + column;
      const cellW = xEdges[column + 1] - xEdges[column];
      const cellH = yEdges[row + 1] - yEdges[row];
      const u = (x - xEdges[column]) / Math.max(1, cellW);
      const v = (y - yEdges[row]) / Math.max(1, cellH);
      const core = u >= 0.18 && u <= 0.82 && v >= 0.18 && v <= 0.88;
      addCount(stats.cells, cell, x, y, core);
      stats.count += 1;
      stats.left = Math.min(stats.left, x);
      stats.top = Math.min(stats.top, y);
      stats.right = Math.max(stats.right, x);
      stats.bottom = Math.max(stats.bottom, y);

      if (x > 0) tail = enqueue(index - 1, label, tail);
      if (x + 1 < width) tail = enqueue(index + 1, label, tail);
      if (y > 0) {
        tail = enqueue(index - width, label, tail);
        if (x > 0) tail = enqueue(index - width - 1, label, tail);
        if (x + 1 < width) tail = enqueue(index - width + 1, label, tail);
      }
      if (y + 1 < height) {
        tail = enqueue(index + width, label, tail);
        if (x > 0) tail = enqueue(index + width - 1, label, tail);
        if (x + 1 < width) tail = enqueue(index + width + 1, label, tail);
      }
    }

    let dominantCell = 0;
    let dominantCount = -1;
    const seeds = [];
    for (const [cell, rec] of stats.cells) {
      if (rec.count > dominantCount) {
        dominantCell = cell;
        dominantCount = rec.count;
      }
      if (rec.coreCount >= Math.max(24, Math.floor(stats.count * 0.012))) {
        seeds.push({
          cell,
          x: rec.coreX / rec.coreCount,
          y: rec.coreY / rec.coreCount,
        });
      }
    }
    stats.owner = seeds.length === 1 ? seeds[0].cell : dominantCell;
    stats.seeds = seeds.length > 1 ? seeds : null;

    // The tall tree and shrine ruin deliberately break into the cell above
    // their nominal row. Their fine upper branches are disconnected from the
    // trunks by transparent gaps, so position-only ownership used to donate
    // those fragments to the two gravestones above: clipped landmarks plus
    // graves wearing stray branches. Reunite only low, disconnected spill
    // components from the explicitly named source cells.
    const spillSource = options.spillDownFrom?.find((cell) => {
      const lowerCell = cell + columns;
      if (!stats.cells.has(cell) || lowerCell >= cellCount) return false;
      if (stats.cells.has(lowerCell)) return true;
      const ownerRow = (cell / columns) | 0;
      const ownerHeight = yEdges[ownerRow + 1] - yEdges[ownerRow];
      return stats.owner === cell
        && stats.top >= yEdges[ownerRow] + ownerHeight * 0.42;
    });
    if (spillSource != null) {
      stats.owner = spillSource + columns;
      // Do not Voronoi-split a connected trunk/branch component back across
      // the row boundary after explicitly reuniting it with its landmark.
      stats.seeds = null;
    }
    components[label] = stats;
  }

  const ownerOf = (index, x, y) => {
    const component = components[labels[index]];
    if (!component || component.count < 3) return -1;
    if (!component.seeds) return component.owner;
    let winner = component.seeds[0].cell;
    let best = Infinity;
    for (const seed of component.seeds) {
      const dx = x - seed.x;
      const dy = y - seed.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        winner = seed.cell;
      }
    }
    return winner;
  };

  const bounds = Array.from({ length: cellCount }, () => ({
    left: width, top: height, right: -1, bottom: -1, count: 0,
  }));
  for (let index = 0; index < pixelCount; index++) {
    if (!labels[index]) continue;
    const x = index % width;
    const y = (index / width) | 0;
    const owner = ownerOf(index, x, y);
    if (owner < 0) continue;
    const b = bounds[owner];
    b.left = Math.min(b.left, x);
    b.top = Math.min(b.top, y);
    b.right = Math.max(b.right, x);
    b.bottom = Math.max(b.bottom, y);
    b.count += 1;
  }

  const cells = bounds.map((b, cell) => {
    if (b.right < b.left || b.bottom < b.top) {
      throw new Error(`Generated atlas cell ${cell} has no visible art`);
    }
    const column = cell % columns;
    const row = (cell / columns) | 0;
    const canvas = makeCanvas(b.right - b.left + 1, b.bottom - b.top + 1);
    const context = ctxOf(canvas);
    const data = context.createImageData(canvas.width, canvas.height);
    return {
      canvas,
      context,
      data,
      count: b.count,
      atlasLeft: b.left,
      atlasTop: b.top,
      offsetX: b.left - xEdges[column],
      offsetY: b.top - yEdges[row],
      nominalWidth: xEdges[column + 1] - xEdges[column],
      nominalHeight: yEdges[row + 1] - yEdges[row],
      row,
      column,
    };
  });

  for (let index = 0; index < pixelCount; index++) {
    if (!labels[index]) continue;
    const x = index % width;
    const y = (index / width) | 0;
    const owner = ownerOf(index, x, y);
    if (owner < 0) continue;
    const cell = cells[owner];
    const targetIndex = ((y - cell.atlasTop) * cell.canvas.width + (x - cell.atlasLeft)) * 4;
    const sourceIndex = index * 4;
    cell.data.data[targetIndex] = rgba[sourceIndex];
    cell.data.data[targetIndex + 1] = rgba[sourceIndex + 1];
    cell.data.data[targetIndex + 2] = rgba[sourceIndex + 2];
    cell.data.data[targetIndex + 3] = rgba[sourceIndex + 3];
  }
  for (const cell of cells) {
    cell.context.putImageData(cell.data, 0, 0);
    delete cell.context;
    delete cell.data;
  }

  return cells;
}

function sourceCenter(cell) {
  return cell.nominalWidth * 0.5 - cell.offsetX;
}

function ownBaseline(cell) {
  return cell.canvas.height;
}

function rowBaseline(cells) {
  return Math.max(...cells.map((cell) => cell.offsetY + cell.canvas.height));
}

function placement(cell, baseline = ownBaseline(cell)) {
  return { cell, x: sourceCenter(cell), y: baseline };
}

function fitScale(placements, width, height, anchorX, anchorY, padding = FRAME_PADDING) {
  const leftRoom = Math.max(1, anchorX - padding);
  const rightRoom = Math.max(1, width - anchorX - padding);
  const topRoom = Math.max(1, anchorY - padding);
  const bottomRoom = Math.max(1, height - anchorY - padding);
  let scale = Infinity;
  for (const item of placements) {
    scale = Math.min(
      scale,
      item.x > 0 ? leftRoom / item.x : Infinity,
      item.cell.canvas.width > item.x ? rightRoom / (item.cell.canvas.width - item.x) : Infinity,
      item.y > 0 ? topRoom / item.y : Infinity,
      item.cell.canvas.height > item.y ? bottomRoom / (item.cell.canvas.height - item.y) : Infinity,
    );
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Could not fit generated frame");
  return scale;
}

function drawPlaced(item, width, height, anchorX, anchorY, scale) {
  const canvas = makeCanvas(width, height);
  const context = ctxOf(canvas);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    item.cell.canvas,
    anchorX - item.x * scale,
    anchorY - item.y * scale,
    item.cell.canvas.width * scale,
    item.cell.canvas.height * scale,
  );
  return canvas;
}

function frameFrom(item, spec, scale) {
  const canvas = drawPlaced(item, spec.width, spec.height, spec.ox, spec.oy, scale);
  return {
    canvas,
    ox: spec.ox,
    oy: spec.oy,
    w: canvas.width / 2,
    h: canvas.height / 2,
  };
}

function silhouetteFrames(frames, colour) {
  const cache = new Map();
  return frames.map((frame) => {
    if (!cache.has(frame.canvas)) cache.set(frame.canvas, silhouetteOf(frame.canvas, colour));
    return cache.get(frame.canvas);
  });
}

function heroArt(heroImage, portraitImage) {
  const cells = isolateGrid(heroImage, 4, 5);
  const idleCells = cells.slice(0, 4);
  const runCells = cells.slice(4, 12);
  const slashCells = cells.slice(12, 20);
  const idleItems = idleCells.map((cell) => placement(cell));
  const runItems = runCells.map((cell) => placement(cell));
  const slashItems = slashCells.map((cell) => placement(cell));
  const base = { width: 309, height: 355, ox: 147, oy: 331 };
  const slash = { width: 460, height: 396, ox: 184, oy: 354 };
  const scale = Math.min(
    fitScale(runItems, base.width, base.height, base.ox, base.oy),
    fitScale(idleItems, base.width, base.height, base.ox, base.oy),
    fitScale(slashItems, slash.width, slash.height, slash.ox, slash.oy),
  );
  const idle = idleItems.map((item) => frameFrom(item, base, scale));
  const run = runItems.map((item) => frameFrom(item, base, scale));
  const slashFrames = slashItems.map((item) => frameFrom(item, slash, scale));
  const portraitCanvas = makePortrait(portraitImage);
  return {
    idle,
    run,
    slash: slashFrames,
    variants: {
      flash: silhouetteOf(run[0].canvas, PAL.paperLit),
      ink: silhouetteOf(run[0].canvas, PAL.ink),
    },
    hurtIdle: silhouetteFrames(idle, PAL.blood),
    hurtRun: silhouetteFrames(run, PAL.blood),
    hurtSlash: silhouetteFrames(slashFrames, PAL.blood),
    portrait: { canvas: portraitCanvas, w: 300, h: 336 },
  };
}

function makePortrait(image) {
  const canvas = makeCanvas(300, 336);
  const context = ctxOf(canvas);
  const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight) * 1.035;
  const focusX = image.naturalWidth * 0.6;
  const focusY = image.naturalHeight * 0.515;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    canvas.width * 0.5 - focusX * scale,
    canvas.height * 0.5 - focusY * scale,
    image.naturalWidth * scale,
    image.naturalHeight * scale,
  );
  return canvas;
}

function castRecord(walkA, walkB, attack, spec, frameCount, boss, floating = false) {
  const walkItems = [placement(walkA), placement(walkB)];
  const attackBaseline = rowBaseline([walkA, walkB]) - attack.offsetY;
  const attackItem = placement(attack, attackBaseline);
  const scale = Math.min(
    fitScale(walkItems, spec.width, spec.height, spec.ox, spec.oy),
    fitScale([attackItem], spec.width, spec.height, spec.ox, spec.oy),
  );
  const walkFrames = walkItems.map((item) => frameFrom(item, spec, scale));
  const attackPose = frameFrom(attackItem, spec, scale);
  // Wraiths translate through the world and bob vertically; alternating their
  // trailing robes reads as footfall locomotion. Their generated lunge cells
  // also contain detached cloth islands, so a clean held float pose is both
  // the intended motion language and the safest combat silhouette.
  const frames = floating
    ? Array.from({ length: frameCount }, () => walkFrames[0])
    : Array.from({ length: frameCount }, (_, i) => walkFrames[i % 2]);
  const attackFrames = floating
    ? Array.from({ length: 4 }, () => walkFrames[0])
    : [walkFrames[0], attackPose, attackPose, walkFrames[1]];
  return {
    frames,
    attackFrames,
    variants: {
      flash: silhouetteOf(frames[0].canvas, PAL.paperLit),
      ink: silhouetteOf(frames[0].canvas, PAL.ink),
    },
    flashFrames: silhouetteFrames(frames, PAL.paperLit),
    inkFrames: silhouetteFrames(frames, PAL.ink),
    attackFlashFrames: silhouetteFrames(attackFrames, PAL.paperLit),
    boss,
  };
}

function castArt(enemyImage, bossImage) {
  const cast = {};
  const enemyCells = isolateGrid(enemyImage, 6, 4);
  for (let row = 0; row < ENEMY_ROWS.length; row++) {
    for (let type = 0; type < 2; type++) {
      const name = ENEMY_ROWS[row][type];
      const start = row * 6 + type * 3;
      const [width, height] = COMMON_CAST[name];
      cast[name] = castRecord(
        enemyCells[start],
        enemyCells[start + 1],
        enemyCells[start + 2],
        { width, height, ox: width * 0.5, oy: height * 0.92 },
        6,
        false,
        FLOATING_CAST.has(name),
      );
    }
  }

  const bossCells = isolateGrid(bossImage, 3, 3);
  for (let row = 0; row < BOSS_ROWS.length; row++) {
    const name = BOSS_ROWS[row];
    const [width, height] = BOSS_CAST[name];
    const start = row * 3;
    cast[name] = castRecord(
      bossCells[start],
      bossCells[start + 1],
      bossCells[start + 2],
      { width, height, ox: width * 0.5, oy: height * 0.93 },
      4,
      true,
    );
  }
  return cast;
}

function staticPadding(width, height) {
  return Math.max(2, Math.min(8, Math.floor(Math.min(width, height) * 0.08)));
}

function staticScale(cells, width, height, padding) {
  let scale = Infinity;
  for (const cell of cells) {
    scale = Math.min(
      scale,
      (width - padding * 2) / cell.canvas.width,
      (height - padding * 2) / cell.canvas.height,
    );
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Could not fit generated asset");
  return scale;
}

function staticCanvas(cell, width, height, align, scale) {
  const padding = staticPadding(width, height);
  const useScale = scale || staticScale([cell], width, height, padding);
  const canvas = makeCanvas(width, height);
  const context = ctxOf(canvas);
  const drawW = cell.canvas.width * useScale;
  const drawH = cell.canvas.height * useScale;
  const x = (width - drawW) * 0.5;
  const y = align === "bottom" ? height - padding - drawH : (height - drawH) * 0.5;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(cell.canvas, x, y, drawW, drawH);
  return canvas;
}

function staticGroup(cells, width, height, align = "center") {
  const padding = staticPadding(width, height);
  const scale = staticScale(cells, width, height, padding);
  return cells.map((cell) => staticCanvas(cell, width, height, align, scale));
}

function propArt(image) {
  const c = isolateGrid(image, 4, 4, { spillDownFrom: [10, 11] });
  return {
    grass: staticGroup(c.slice(0, 4), 90, 70, "bottom"),
    stone: staticGroup(c.slice(4, 7), 110, 80, "bottom"),
    bone: staticGroup([c[7], c[8], c[9]], 100, 70, "bottom"),
    grave: staticGroup([c[10], c[11]], 90, 150, "bottom"),
    lantern: staticCanvas(c[12], 110, 190, "bottom"),
    torii: staticCanvas(c[13], 320, 260, "bottom"),
    tree: [staticCanvas(c[14], 260, 300, "bottom")],
    ruin: [staticCanvas(c[15], 260, 300, "bottom")],
  };
}

function combatArt(image) {
  const c = isolateGrid(image, 4, 4);
  const crow = staticGroup([c[9], c[10]], 96, 76);
  return {
    gem: staticCanvas(c[0], 21, 27, "center"),
    gemBig: staticCanvas(c[1], 32, 40, "center"),
    coin: staticCanvas(c[2], 30, 30, "center"),
    heart: staticCanvas(c[3], 34, 34, "center"),
    chest: staticCanvas(c[4], 58, 48, "center"),
    magnet: staticCanvas(c[5], 38, 38, "center"),
    bomb: staticCanvas(c[6], 40, 40, "center"),
    kunai: staticCanvas(c[7], 56, 24, "center"),
    ofuda: staticCanvas(c[8], 34, 62, "center"),
    crow,
    sickle: staticCanvas(c[11], 70, 60, "center"),
    fang: staticCanvas(c[12], 54, 26, "center"),
    enemyShot: staticCanvas(c[13], 34, 34, "center"),
    inkHit: staticCanvas(c[13], 110, 110, "center"),
    slash: staticCanvas(c[14], 260, 260, "center"),
    bloodSplat: staticCanvas(c[15], 120, 120, "center"),
  };
}

function throwRequiredFailure(manifest) {
  const failed = manifest.failed.filter((key) => manifest.sources[key]?.required);
  if (!failed.length) return;
  manifest.status = "failed";
  const error = new Error(`Required generated art failed: ${failed.join(", ")}`);
  error.manifest = manifest;
  throw error;
}

export async function loadGeneratedAssets(onProgress) {
  const manifest = makeManifest();
  const images = {};
  safeProgress(onProgress, 0, "Loading generated manga art");

  const loadGroup = async (entries, progressStart, progressEnd) => {
    if (!entries.length) return;
    let settled = 0;
    await Promise.all(entries.map(async ([key, def]) => {
      try {
        images[key] = await loadImage(key, def, manifest);
        reportReady(manifest, key, images[key]);
      } catch (error) {
        reportFailure(manifest, key, error);
      } finally {
        settled += 1;
        const p = progressStart + (progressEnd - progressStart) * (settled / entries.length);
        safeProgress(onProgress, p, `Loading ${key}`);
      }
    }));
  };

  const entries = Object.entries(SOURCES);
  const required = entries.filter(([, def]) => def.required);
  const optional = entries.filter(([, def]) => !def.required);

  // Keep large optional environment plates from starving the cast on a
  // constrained mobile link. Each group still loads in parallel internally.
  await loadGroup(required, 0, 0.25);

  throwRequiredFailure(manifest);
  await loadGroup(optional, 0.25, 0.42);

  let hero;
  let cast;
  let props = null;
  let combat = null;
  let ground = images.ground || null;

  try {
    safeProgress(onProgress, 0.46, "Isolating the swordsman");
    hero = heroArt(images.hero, images.heroPortrait);
    await nextTask();
  } catch (error) {
    reportFailure(manifest, "hero", error);
  }
  throwRequiredFailure(manifest);

  try {
    safeProgress(onProgress, 0.62, "Isolating the yokai");
    cast = castArt(images.enemies, images.bosses);
    await nextTask();
  } catch (error) {
    reportFailure(manifest, "enemies", error);
    reportFailure(manifest, "bosses", error);
  }
  throwRequiredFailure(manifest);

  if (images.props) {
    try {
      safeProgress(onProgress, 0.78, "Preparing the battlefield props");
      props = propArt(images.props);
      await nextTask();
    } catch (error) {
      props = null;
      reportFailure(manifest, "props", error);
    }
  }

  if (images.combat) {
    try {
      safeProgress(onProgress, 0.9, "Preparing combat art");
      combat = combatArt(images.combat);
      await nextTask();
    } catch (error) {
      combat = null;
      reportFailure(manifest, "combat", error);
    }
  }

  manifest.status = manifest.failed.length ? "degraded" : "ready";
  safeProgress(onProgress, 1, manifest.status === "ready" ? "Generated art ready" : "Generated art partly ready");
  return { art: { hero, cast }, props, ground, combat, manifest };
}
