/* ============================================================
   INKBLOOD — props.js
   The ground the fight happens on.

   The page itself never moves: the paper grain is locked to the
   screen because it is the paper the panel is printed on, not a
   texture lying in the world. Everything drawn ON that paper —
   tone patches, grass, stones, torii gates — scrolls with the
   camera.

   Scatter is deterministic: a hash of the grid cell decides what
   grows there, so the world is stable, infinite, and needs no
   storage at all.
   ============================================================ */

"use strict";

import {
  PAL, makeCanvas, ctxOf, brush, splat, rng, wobble, tone, roughCircle,
  hatch, starburst, fillToneDevice, hatchShade, stippleShade, feather,
} from "./art.js?v=20260803-2";
import { shape, smoothPath, lock, gloss, folds, LIGHT } from "./figure.js?v=20260803-2";

const CELL = 300;
// A large cell keeps the authored composition from reading as wallpaper.
// The half-cell offset puts a new run in the plate's open combat centre
// instead of at the meeting point of four mirrored edges.
const GROUND_CELL = 2100;
const GROUND_OFFSET = GROUND_CELL / 2;
let generatedGround = null;

export const PROPS = {
  grass: [],
  stone: [],
  bone: [],
  grave: [],
  lantern: null,
  torii: null,
  tree: [],
  ruin: [],
  patch: [],
};

/**
 * Replace the procedural boot art with the generated manga plates.
 * The original canvases remain the fallback when an image fails to load.
 */
export function installGeneratedEnvironment({ props, ground } = {}) {
  if (ground) {
    generatedGround = ground;
    // The authored plate already carries cracks, scuffs and hatch fields.
    // Clear the old oval patches even if the optional prop sheet failed.
    PROPS.patch.length = 0;
  }
  if (!props) return;

  for (const key of ["grass", "stone", "bone", "grave", "tree", "ruin"]) {
    if (Array.isArray(props[key]) && props[key].length) PROPS[key] = props[key];
  }
  for (const key of ["lantern", "torii"]) {
    if (props[key]) PROPS[key] = props[key];
  }
}

/* ---------------------------------------------------------- */
/* Baking                                                      */
/* ---------------------------------------------------------- */

function bakeInto(w, h, drawFn) {
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  g.lineJoin = "round";
  g.lineCap = "round";
  drawFn(g, w, h);
  return c;
}

export function bakeProps() {
  // --- Grass: a few tapered blades from a common root ---------
  for (let v = 0; v < 4; v++) {
    PROPS.grass.push(bakeInto(90, 70, (g, w, h) => {
      const rand = rng(600 + v * 13);
      const n = 5 + ((v * 3) % 4);
      for (let i = 0; i < n; i++) {
        const x0 = w / 2 + (rand() - 0.5) * 26;
        const lean = (rand() - 0.5) * 34;
        const len = 26 + rand() * 32;
        brush(g, [
          [x0, h - 4],
          [x0 + lean * 0.4, h - 4 - len * 0.55],
          [x0 + lean, h - 4 - len],
        ], { width: 2.6, taper: "end", jitter: 0.2, seed: v * 9 + i, colour: PAL.ink });
      }
    }));
  }

  // --- Stones: faceted lumps with a tone shadow side ----------
  for (let v = 0; v < 3; v++) {
    PROPS.stone.push(bakeInto(110, 80, (g, w, h) => {
      const rand = rng(700 + v * 29);
      const pts = [];
      const n = 6 + v;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = (22 + rand() * 16) * (1 - Math.abs(Math.sin(a)) * 0.28);
        pts.push([w / 2 + Math.cos(a) * rr, h * 0.62 + Math.sin(a) * rr * 0.7]);
      }
      shape(g, pts, {
        fill: PAL.paperLit, line: 2.4, tension: 0.22,
        shade: 0.62, stipple: 0.14, seed: 90 + v, contrast: 1.4, gap: 3.6,
      });
      // Facet lines and a crack or two.
      brush(g, [[w / 2 - 10, h * 0.46], [w / 2 + 1, h * 0.56], [w / 2 + 13, h * 0.5]],
        { width: 0.5, taper: "both", jitter: 0.5, seed: 90 + v, colour: PAL.ink });
      brush(g, [[w / 2 - 3, h * 0.4], [w / 2 - 6, h * 0.72]],
        { width: 0.35, taper: "both", jitter: 0.6, seed: 96 + v, colour: PAL.ink });
    }));
  }

  // --- Bones: a skull and scattered ribs -----------------------
  for (let v = 0; v < 3; v++) {
    PROPS.bone.push(bakeInto(100, 70, (g, w, h) => {
      const rand = rng(800 + v * 17);
      if (v === 0) {
        // Half-buried skull.
        shape(g, [
          [w / 2 - 16, h * 0.7], [w / 2 - 14, h * 0.42],
          [w / 2, h * 0.32], [w / 2 + 14, h * 0.44],
          [w / 2 + 15, h * 0.72],
        ], { fill: PAL.paperLit, line: 2.4, tension: 0.5 });
        g.fillStyle = PAL.ink;
        for (let i = 0; i < 2; i++) {
          g.beginPath();
          g.ellipse(w / 2 - 6 + i * 12, h * 0.55, 4.2, 5, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillRect(w / 2 - 1.6, h * 0.63, 3.2, 4);
      } else {
        for (let i = 0; i < 3 + v; i++) {
          const x = 20 + rand() * (w - 40);
          const y = h * 0.5 + rand() * 18;
          const a = rand() * Math.PI;
          const l = 12 + rand() * 16;
          brush(g, [
            [x - Math.cos(a) * l, y - Math.sin(a) * l],
            [x + Math.cos(a) * l, y + Math.sin(a) * l],
          ], { width: 3, taper: "none", jitter: 0.1, seed: v * 5 + i, colour: PAL.paperLit });
          brush(g, [
            [x - Math.cos(a) * l, y - Math.sin(a) * l],
            [x + Math.cos(a) * l, y + Math.sin(a) * l],
          ], { width: 1, taper: "none", jitter: 0.1, seed: v * 5 + i + 40, colour: PAL.ink });
        }
      }
    }));
  }

  // --- Gravestones ---------------------------------------------
  for (let v = 0; v < 2; v++) {
    PROPS.grave.push(bakeInto(90, 150, (g, w, h) => {
      const tilt = v === 0 ? 0.05 : -0.09;
      g.save();
      g.translate(w / 2, h - 10);
      g.rotate(tilt);
      shape(g, [
        [-19, 0], [-17, -78], [-11, -92], [11, -92], [17, -78], [19, 0],
      ], {
        fill: PAL.paperLit, line: 2.6, tension: 0.2,
        shade: 0.6, stipple: 0.16, seed: 300 + v, contrast: 1.4, gap: 3.4,
      });
      // Weathered inscription: three abstract strokes, not real kanji.
      for (let i = 0; i < 3; i++) {
        brush(g, [[-8, -70 + i * 18], [8, -70 + i * 18]],
          { width: 2.2, taper: "both", jitter: 0.3, seed: 30 + i + v * 4, colour: PAL.ink });
      }
      brush(g, [[0, -80], [0, -22]], { width: 1.6, taper: "both", jitter: 0.3, seed: 44, colour: PAL.ink });
      g.restore();
      // Ground shadow.
      g.beginPath();
      g.ellipse(w / 2, h - 8, 26, 7, 0, 0, Math.PI * 2);
      fillToneDevice(g, 0.5, 3);
    }));
  }

  // --- Stone lantern (灯籠) --------------------------------------
  PROPS.lantern = bakeInto(110, 190, (g, w, h) => {
    const cx = w / 2;
    const base = h - 12;
    const seg = (y0, y1, halfW0, halfW1, fill) => {
      shape(g, [
        [cx - halfW0, y0], [cx + halfW0, y0], [cx + halfW1, y1], [cx - halfW1, y1],
      ], { fill, line: 2.6, tension: 0.05 });
    };
    seg(base, base - 16, 26, 20, PAL.paperLit);
    seg(base - 16, base - 62, 11, 11, PAL.paperLit);
    seg(base - 62, base - 76, 30, 26, PAL.paperLit);
    // Light box, glowing (the one warm thing in the world).
    shape(g, [[cx - 24, base - 76], [cx + 24, base - 76], [cx + 22, base - 116], [cx - 22, base - 116]],
      { fill: PAL.paperLit, line: 2.8, tension: 0.05 });
    g.fillStyle = PAL.ink;
    g.beginPath();
    g.arc(cx, base - 96, 11, 0, Math.PI * 2);
    g.fill();
    starburst(g, cx, base - 96, 8, { points: 4, inner: 0.2, colour: PAL.paperLit });
    // Roof.
    shape(g, [
      [cx - 38, base - 116], [cx + 38, base - 116],
      [cx + 22, base - 140], [cx - 22, base - 140],
    ], { fill: PAL.ink, line: 2.6, tension: 0.08 });
    g.beginPath();
    g.arc(cx, base - 148, 7, 0, Math.PI * 2);
    g.fillStyle = PAL.ink;
    g.fill();
    // Form shadow across the whole lantern, clipped to what has
    // already been drawn rather than to a box.
    g.save();
    g.globalCompositeOperation = "source-atop";
    g.beginPath();
    g.rect(0, 0, w, h);
    hatchShade(g, { dark: 0.5, seed: 320, gap: 3.4, weight: 1.0, light: LIGHT });
    g.restore();
    g.beginPath();
    g.ellipse(cx, base + 4, 34, 9, 0, 0, Math.PI * 2);
    fillToneDevice(g, 0.5, 3);
  });

  // --- Torii gate -----------------------------------------------
  PROPS.torii = bakeInto(320, 260, (g, w, h) => {
    const base = h - 14;
    const L = w * 0.2;
    const R = w * 0.8;
    // Pillars, tapering slightly.
    for (const x of [L, R]) {
      shape(g, [[x - 15, base], [x + 15, base], [x + 11, base - 172], [x - 11, base - 172]],
        { fill: PAL.ink, line: 3, tension: 0.05 });
      gloss(g, [[x - 5, base - 12], [x - 5, base - 160]], 2.6);
    }
    // Nuki (lower tie beam).
    shape(g, [[L - 34, base - 128], [R + 34, base - 128], [R + 34, base - 112], [L - 34, base - 112]],
      { fill: PAL.ink, line: 2.8, tension: 0.02 });
    // Kasagi (upswept top lintel).
    g.beginPath();
    g.moveTo(L - 62, base - 168);
    g.quadraticCurveTo(w / 2, base - 194, R + 62, base - 168);
    g.lineTo(R + 62, base - 150);
    g.quadraticCurveTo(w / 2, base - 176, L - 62, base - 150);
    g.closePath();
    g.fillStyle = PAL.ink;
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 3;
    g.stroke();
    // Shimenawa rope with paper streamers.
    for (let i = 0; i < 5; i++) {
      const x = L + 30 + i * ((R - L - 60) / 4);
      shape(g, [[x - 7, base - 112], [x + 7, base - 112], [x + 5, base - 90], [x - 5, base - 90]],
        { fill: PAL.paperLit, line: 2, tension: 0.02 });
    }
    for (const x of [L, R]) {
      g.beginPath();
      g.ellipse(x, base + 4, 30, 8, 0, 0, Math.PI * 2);
      fillToneDevice(g, 0.5, 3);
    }
  });

  // --- Dead trees ------------------------------------------------
  for (let v = 0; v < 2; v++) {
    PROPS.tree.push(bakeInto(260, 300, (g, w, h) => {
      const rand = rng(950 + v * 61);
      const base = h - 16;
      const branch = (x, y, a, len, wgt, depth) => {
        const x1 = x + Math.cos(a) * len;
        const y1 = y + Math.sin(a) * len;
        brush(g, [
          [x, y],
          [(x + x1) / 2 + (rand() - 0.5) * len * 0.2, (y + y1) / 2 + (rand() - 0.5) * len * 0.2],
          [x1, y1],
        ], { width: wgt, taper: "end", jitter: 0.22, seed: depth * 17 + x, colour: PAL.ink });
        if (depth <= 0) return;
        const n = rand() < 0.35 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          branch(x1, y1, a + (rand() - 0.5) * 1.5, len * (0.56 + rand() * 0.2),
            wgt * 0.58, depth - 1);
        }
      };
      branch(w / 2, base, -Math.PI / 2 + (v ? 0.12 : -0.1), 78, 13, 3);
      // Roots.
      for (let i = 0; i < 4; i++) {
        const a = Math.PI * (0.1 + i * 0.26);
        brush(g, [[w / 2, base - 10], [w / 2 + Math.cos(a) * 34, base + Math.sin(a) * 12]],
          { width: 7, taper: "end", jitter: 0.2, seed: 200 + i, colour: PAL.ink });
      }
      g.beginPath();
      g.ellipse(w / 2, base + 6, 46, 12, 0, 0, Math.PI * 2);
      fillToneDevice(g, 0.5, 3);
    }));
  }

  // --- Ground patches -------------------------------------------
  // Hatched, not toned, and much smaller than the first pass: big
  // soft grey ovals read as smudges on the page rather than as
  // ground, and they fight the figures for attention.
  for (let v = 0; v < 3; v++) {
    PROPS.patch.push(bakeInto(250, 150, (g, w, h) => {
      const pts = [];
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const rr = 1 + wobble(a * 2 + v * 3, v + 1) * 0.4;
        pts.push([w / 2 + Math.cos(a) * w * 0.42 * rr, h / 2 + Math.sin(a) * h * 0.4 * rr]);
      }
      g.beginPath();
      smoothPath(g, pts, true, 0.5);
      hatchShade(g, {
        dark: 0.3 + v * 0.08, seed: 500 + v, gap: 4.2, weight: 0.9,
        light: [0.4, -0.9],
      });
      // A broken contour so the patch has an edge, not a fade.
      for (let i = 0; i < n; i++) {
        if ((i + v) % 3 === 0) continue;
        brush(g, [pts[i], pts[(i + 1) % n]],
          { width: 0.45, taper: "both", jitter: 0.5, seed: 510 + v * 7 + i, colour: PAL.ink });
      }
    }));
  }
}

/* ---------------------------------------------------------- */
/* Scatter                                                     */
/* ---------------------------------------------------------- */

/** Cheap deterministic 2-D hash -> [0,1). */
function hash2(x, y, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Draw the scrolling world layer for the visible rectangle.
 * `view` is in world coordinates: { x, y, w, h }.
 */
export function drawGround(g, view) {
  const x0 = Math.floor((view.x - CELL) / CELL);
  const x1 = Math.ceil((view.x + view.w + CELL) / CELL);
  const y0 = Math.floor((view.y - CELL) / CELL);
  const y1 = Math.ceil((view.y + view.h + CELL) / CELL);

  if (generatedGround) drawGeneratedGround(g, view);

  // Pass 1: tone patches, well underneath everything.
  if (PROPS.patch.length) {
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const r = hash2(cx, cy, 11);
        if (r > 0.34) continue;
        const img = PROPS.patch[(hash2(cx, cy, 12) * PROPS.patch.length) | 0];
        const px = cx * CELL + hash2(cx, cy, 13) * CELL;
        const py = cy * CELL + hash2(cx, cy, 14) * CELL;
        const s = 0.7 + hash2(cx, cy, 15) * 0.85;
        g.save();
        g.globalAlpha = 0.75;
        g.translate(px, py);
        g.scale(s, s * 0.8);
        g.drawImage(img, -img.width / 2, -img.height / 2);
        g.restore();
      }
    }
  }

  // Pass 2: scatter. Two small props and, rarely, one landmark.
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const base = hash2(cx, cy, 1);

      for (let k = 0; k < 4; k++) {
        const r = hash2(cx, cy, 20 + k);
        if (r > 0.72) continue;
        const px = cx * CELL + hash2(cx, cy, 30 + k) * CELL;
        const py = cy * CELL + hash2(cx, cy, 40 + k) * CELL;
        const pick = hash2(cx, cy, 50 + k);
        let img;
        if (pick < 0.5) img = PROPS.grass[(hash2(cx, cy, 60 + k) * PROPS.grass.length) | 0];
        else if (pick < 0.82) img = PROPS.stone[(hash2(cx, cy, 61 + k) * PROPS.stone.length) | 0];
        else img = PROPS.bone[(hash2(cx, cy, 62 + k) * PROPS.bone.length) | 0];
        const s = 0.65 + hash2(cx, cy, 70 + k) * 0.7;
        const flip = hash2(cx, cy, 80 + k) < 0.5 ? -1 : 1;
        g.save();
        g.translate(px, py);
        g.scale(s * flip, s);
        g.globalAlpha = 0.9;
        g.drawImage(img, -img.width / 2, -img.height + 8);
        g.restore();
      }

      if (base < 0.14) {
        const px = cx * CELL + hash2(cx, cy, 2) * CELL;
        const py = cy * CELL + hash2(cx, cy, 3) * CELL;
        const pick = hash2(cx, cy, 4);
        let img;
        let scale = 1;
        if (pick < 0.28) img = PROPS.grave[(hash2(cx, cy, 5) * PROPS.grave.length) | 0];
        else if (pick < 0.5) img = PROPS.lantern;
        else if (pick < 0.72) img = PROPS.tree[(hash2(cx, cy, 6) * PROPS.tree.length) | 0];
        else if (pick < 0.9 || !PROPS.ruin.length) { img = PROPS.torii; scale = 1.1; }
        else img = PROPS.ruin[(hash2(cx, cy, 7) * PROPS.ruin.length) | 0];
        g.save();
        g.translate(px, py);
        g.scale(scale, scale);
        g.drawImage(img, -img.width / 2, -img.height + 10);
        g.restore();
      }
    }
  }
}

/**
 * The authored plate is mirrored on alternating cells. That makes each
 * shared edge meet the same source edge, eliminating hard repeat seams
 * while keeping the battlefield world-locked under the camera.
 */
function drawGeneratedGround(g, view) {
  const x0 = Math.floor((view.x + GROUND_OFFSET) / GROUND_CELL);
  const x1 = Math.floor((view.x + view.w + GROUND_OFFSET) / GROUND_CELL);
  const y0 = Math.floor((view.y + GROUND_OFFSET) / GROUND_CELL);
  const y1 = Math.floor((view.y + view.h + GROUND_OFFSET) / GROUND_CELL);

  g.save();
  // Let silhouettes and blood remain the darkest values in a busy fight.
  g.globalAlpha = 0.62;
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const flipX = Math.abs(cx) % 2 === 1;
      const flipY = Math.abs(cy) % 2 === 1;
      const left = cx * GROUND_CELL - GROUND_OFFSET;
      const top = cy * GROUND_CELL - GROUND_OFFSET;
      g.save();
      g.translate(left + (flipX ? GROUND_CELL : 0),
        top + (flipY ? GROUND_CELL : 0));
      g.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      g.drawImage(generatedGround, 0, 0, GROUND_CELL, GROUND_CELL);
      g.restore();
    }
  }
  g.restore();
}

/* ---------------------------------------------------------- */
/* Drifting ash                                                */
/* ---------------------------------------------------------- */

/**
 * Ash motes that drift across the page. Purely atmospheric, but
 * they stop the white space between fights from feeling dead.
 */
export class Ash {
  constructor(count = 60) {
    this.motes = [];
    for (let i = 0; i < count; i++) {
      this.motes.push({
        x: Math.random(), y: Math.random(),
        r: 0.6 + Math.random() * 2.2,
        vx: -6 - Math.random() * 22,
        vy: 5 + Math.random() * 16,
        p: Math.random() * Math.PI * 2,
        dark: Math.random() < 0.7,
      });
    }
  }

  update(dt, w, h) {
    for (const m of this.motes) {
      m.p += dt * 1.4;
      m.x += (m.vx + Math.sin(m.p) * 12) * dt / w;
      m.y += m.vy * dt / h;
      if (m.x < -0.05) m.x += 1.1;
      if (m.y > 1.05) { m.y -= 1.1; m.x = Math.random(); }
    }
  }

  draw(g, w, h) {
    g.save();
    for (const m of this.motes) {
      g.globalAlpha = m.dark ? 0.34 : 0.5;
      g.fillStyle = m.dark ? PAL.ink : PAL.paperLit;
      g.beginPath();
      g.ellipse(m.x * w, m.y * h, m.r, m.r * 1.4, m.p, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}
