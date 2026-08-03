/* ============================================================
   INKBLOOD — art.js
   The pen-and-ink rendering core.

   Everything the game draws is built here from four primitives:

     1. BRUSH STROKES  — tapered, slightly wobbly filled ribbons
                         that read as a sable brush rather than a
                         constant-width vector line.
     2. SCREENTONE     — seamless 45-degree halftone dot tiles at
                         eleven densities, the way real manga is
                         shaded.
     3. HATCHING       — clipped parallel line fills for the darker
                         shadow passes.
     4. SPLATTER       — ink / blood blobs made from a wobbled
                         radial polygon plus satellite droplets.

   Colour discipline (the whole point of the art direction):
   the world is ONLY paper white, ink black and screentone grey.
   Red exists exclusively for blood and player attacks; violet
   exists exclusively for arcane energy and XP. Nothing else is
   ever allowed to be coloured.
   ============================================================ */

"use strict";

/* ---------------------------------------------------------- */
/* Palette                                                     */
/* ---------------------------------------------------------- */

export const PAL = {
  paper: "#efeade",
  paperLit: "#f8f5ec",
  paperDeep: "#ded7c6",
  ink: "#101014",
  inkSoft: "#2a2a31",
  inkFaint: "rgba(16,16,20,0.42)",

  // The only two hues in the entire game.
  blood: "#c01421",
  bloodDeep: "#7d0a13",
  bloodHot: "#ff3a3a",
  arcane: "#7b2ff7",
  arcaneHot: "#c39cff",
};

/* ---------------------------------------------------------- */
/* Deterministic noise                                         */
/* ---------------------------------------------------------- */

/** Mulberry32 — small, fast, and repeatable so baked art never
 *  changes between reloads (important: the character you see is
 *  the character you saw last run). */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap 1-D value noise, used for the organic wobble on strokes. */
export function wobble(t, seed) {
  const s = Math.sin(t * 1.7 + seed * 12.9898) * 43758.5453;
  const a = s - Math.floor(s);
  const s2 = Math.sin(t * 0.61 + seed * 78.233) * 12345.6789;
  const b = s2 - Math.floor(s2);
  return a * 0.6 + b * 0.4 - 0.5;
}

/* ---------------------------------------------------------- */
/* Canvas helpers                                              */
/* ---------------------------------------------------------- */

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctxOf(canvas) {
  return canvas.getContext("2d", { willReadFrequently: false });
}

/* ---------------------------------------------------------- */
/* Screentone                                                  */
/* ---------------------------------------------------------- */

const toneCache = new Map();

/**
 * Build a seamless halftone tile.
 *
 * Dots sit on the four corners plus the centre of a square cell,
 * which is exactly a 45-degree rotated grid — the classic manga
 * screen angle — and it tiles without any pattern transform.
 *
 * `level` runs 0 (paper) .. 1 (solid ink). Past the halfway point
 * the tile inverts: black field with shrinking white dots, so the
 * dark end of the ramp stays a real dot pattern instead of mush.
 */
export function toneTile(level, cell = 6, colour = PAL.ink, paper = null) {
  const key = `${level.toFixed(3)}|${cell}|${colour}|${paper || "-"}`;
  const hit = toneCache.get(key);
  if (hit) return hit;

  const c = makeCanvas(cell, cell);
  const g = ctxOf(c);
  const t = Math.max(0, Math.min(1, level));

  // A dot of radius cell*0.354 exactly touches its neighbours, so
  // that radius is our "50% coverage" pivot.
  const rMax = cell * 0.3535;

  if (paper) {
    g.fillStyle = paper;
    g.fillRect(0, 0, cell, cell);
  }

  if (t <= 0.5) {
    const r = rMax * (t / 0.5);
    g.fillStyle = colour;
    stampDots(g, cell, r);
  } else {
    g.fillStyle = colour;
    g.fillRect(0, 0, cell, cell);
    const r = rMax * (1 - (t - 0.5) / 0.5);
    g.globalCompositeOperation = paper ? "source-over" : "destination-out";
    g.fillStyle = paper || "#000";
    stampDots(g, cell, r);
    g.globalCompositeOperation = "source-over";
  }

  toneCache.set(key, c);
  return c;
}

function stampDots(g, cell, r) {
  if (r <= 0.05) return;
  const pts = [
    [0, 0], [cell, 0], [0, cell], [cell, cell], [cell / 2, cell / 2],
  ];
  for (const [x, y] of pts) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
}

const patternCache = new Map();

/** CanvasPattern for a tone level. Cached per (ctx-less) key —
 *  patterns are context-agnostic in every browser we target. */
export function tone(ctx, level, cell = 6, colour = PAL.ink) {
  const key = `${level.toFixed(3)}|${cell}|${colour}`;
  let p = patternCache.get(key);
  if (!p) {
    p = ctx.createPattern(toneTile(level, cell, colour), "repeat");
    patternCache.set(key, p);
  }
  return p;
}

/** Fill the current path with screentone. */
export function fillTone(ctx, level, cell = 6, colour = PAL.ink) {
  ctx.fillStyle = tone(ctx, level, cell, colour);
  ctx.fill();
}

/**
 * Fill the CURRENT PATH with screentone whose dots are sized in
 * device pixels, ignoring whatever scale the context is under.
 *
 * This matters more than it sounds. Screentone is a physical
 * artefact of print — the dots are a property of the paper, not of
 * the thing being drawn. If you let them scale with the figure,
 * a sprite baked at 2x comes out looking like a chessboard while
 * the same tone on a UI panel looks like fine grey. Every tone
 * pass in the game goes through here so the dot pitch is constant
 * across the entire image.
 */
export function fillToneDevice(ctx, level, cell = 3.4, colour = PAL.ink) {
  ctx.save();
  ctx.clip();               // captures the path in device space
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = tone(ctx, level, cell, colour);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

/** Run `fn` with the transform reset to device pixels. */
export function deviceSpace(ctx, fn) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  fn(ctx);
  ctx.restore();
}

/* ---------------------------------------------------------- */
/* Brush strokes                                               */
/* ---------------------------------------------------------- */

/**
 * Draw a tapered ink ribbon through `pts`.
 *
 * opts:
 *   width   base half-width in px
 *   taper   "both" | "end" | "start" | "none"
 *   jitter  0..1 organic edge wobble
 *   seed    stroke identity, so a given stroke wobbles the same way
 *   colour  fill style
 *   press   optional (t)=>0..1 pressure curve overriding taper
 */
export function brush(ctx, pts, opts = {}) {
  if (!pts || pts.length < 2) return;
  const width = opts.width == null ? 3 : opts.width;
  const taper = opts.taper || "both";
  const jitter = opts.jitter == null ? 0.22 : opts.jitter;
  const seed = opts.seed == null ? 1 : opts.seed;
  const press = opts.press || defaultPress(taper);

  const n = pts.length;
  const left = [];
  const right = [];

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    // Normal
    const nx = -ty;
    const ny = tx;

    const t = n === 1 ? 0.5 : i / (n - 1);
    let w = width * press(t);
    // Organic thickness variation along the stroke.
    w *= 1 + wobble(t * 6 + seed, seed) * jitter * 0.9;
    if (w < 0.05) w = 0.05;

    // Slight sideways drift so the spine is not mathematically straight.
    const drift = wobble(t * 3.3 + seed * 2.1, seed + 7) * jitter * width * 0.5;

    left.push([p[0] + nx * (w + drift), p[1] + ny * (w + drift)]);
    right.push([p[0] - nx * (w - drift), p[1] - ny * (w - drift)]);
  }

  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = opts.colour || PAL.ink;
  ctx.fill();
}

function defaultPress(taper) {
  if (taper === "none") return () => 1;
  if (taper === "end") return (t) => Math.pow(1 - t, 0.62);
  if (taper === "start") return (t) => Math.pow(t, 0.62);
  // "both": fat belly, whisker-thin tips — the classic sable profile.
  return (t) => Math.pow(Math.sin(Math.PI * t), 0.45);
}

/** Convenience: a brush stroke along a quadratic arc. */
export function brushArc(ctx, x0, y0, cx, cy, x1, y1, opts = {}) {
  const steps = opts.steps || 14;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    pts.push([
      mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
      mt * mt * y0 + 2 * mt * t * cy + t * t * y1,
    ]);
  }
  brush(ctx, pts, opts);
}

/**
 * Variable-weight contour.
 *
 * A constant-width stroke() is the single biggest tell that a
 * drawing was made by a machine. A pen laid over a form swells
 * where the surface turns away from the light and lifts almost to
 * nothing where the light hits it square, and it breaks entirely on
 * the brightest edge. This walks a closed silhouette and modulates
 * the weight by the angle between the local outward normal and the
 * light, then drops occasional dry-brush gaps.
 *
 * opts:
 *   width     nominal weight
 *   light     [x,y] unit-ish direction the light comes FROM
 *   contrast  how much heavier the shadow side gets (0..2)
 *   breaks    0..1 chance a lit-side segment is skipped entirely
 */
export function inkContour(ctx, pts, opts = {}) {
  const closed = opts.closed !== false;
  const samples = samplePath(pts, closed, opts.per || 7);
  const n = samples.length;
  if (n < 4) return;

  const width = opts.width == null ? 2.2 : opts.width;
  const light = opts.light || [0.62, -0.5];
  const llen = Math.hypot(light[0], light[1]) || 1;
  const lx = light[0] / llen;
  const ly = light[1] / llen;
  const contrast = opts.contrast == null ? 1 : opts.contrast;
  const breaks = opts.breaks == null ? 0.18 : opts.breaks;
  const colour = opts.colour || PAL.ink;
  const seed = opts.seed || 3;
  const rand = rng(Math.floor(seed * 9187) + 11);

  // Signed area tells us which way "outward" is.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sign = area >= 0 ? 1 : -1;

  const SEG = Math.max(3, Math.round(opts.seg || 5));
  const rimOnly = !!opts.rimOnly;

  for (let i = 0; i < n; i += SEG) {
    // Chunks overlap by one sample at each end. Without the overlap
    // — and with a tapered profile — every chunk shrinks to a point
    // at both ends and the whole contour renders as a string of
    // beads rather than one line that swells and thins.
    const chunk = [];
    for (let k = -1; k <= SEG + 1; k++) chunk.push(samples[(i + k + n) % n]);

    const a = chunk[1];
    const b = chunk[chunk.length - 2];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = -ty * sign;
    const ny = tx * sign;

    // 1 when the normal faces the light, -1 when it faces away.
    const facing = nx * lx + ny * ly;
    const shade = (1 - facing) * 0.5;                 // 0 lit .. 1 dark

    if (rimOnly) {
      // A highlight only where the surface is turned hard into the
      // light, so it reads as a sliver of reflected light rather
      // than an outline drawn around everything.
      if (facing < 0.45) continue;
      const k = (facing - 0.45) / 0.55;
      brush(ctx, chunk, {
        width: width * 0.5 * (0.25 + k * 0.9),
        taper: "none", jitter: 0.2, seed: seed + i, colour,
      });
      continue;
    }

    // `width` is stroke THICKNESS; brush() wants a half-width.
    const w = width * 0.5 * (0.26 + shade * (0.7 + contrast));
    if (shade < 0.28 && rand() < breaks) continue;    // dry-brush gap
    if (w < 0.08) continue;

    brush(ctx, chunk, {
      width: w,
      taper: "none",
      jitter: 0.16,
      seed: seed + i,
      colour,
    });
  }
}

/**
 * Ink an existing path outline with brush character: several
 * offset passes of decreasing width so the contour reads as
 * hand-drawn rather than a stroke() of uniform weight.
 */
export function inkOutline(ctx, pathFn, width = 2.4, colour = PAL.ink) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = width;
  pathFn(ctx);
  ctx.stroke();
  // A second, thinner and slightly offset pass thickens the
  // "downstrokes" the way a nib loads more ink on one side.
  ctx.lineWidth = width * 0.55;
  ctx.translate(width * 0.22, width * 0.3);
  pathFn(ctx);
  ctx.stroke();
  ctx.restore();
}

/* ---------------------------------------------------------- */
/* Path sampling                                               */
/* ---------------------------------------------------------- */

/**
 * Numeric Catmull-Rom sampling. `smoothPath` in figure.js emits the
 * same curve into a canvas path; this returns the points, which is
 * what the contour-inking and hatching passes need in order to walk
 * a silhouette and vary line weight along it.
 */
export function samplePath(pts, closed = true, per = 8) {
  const n = pts.length;
  if (n < 2) return pts.slice();
  const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1); const p1 = at(i); const p2 = at(i + 1); const p3 = at(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
          + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
          + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
          + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
          + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/* ---------------------------------------------------------- */
/* Feathered hatching — the Berserk mark                       */
/* ---------------------------------------------------------- */

/**
 * A field of parallel tapered strokes whose LENGTH, WIDTH and
 * DENSITY all fall off across the field.
 *
 * This is the single most important primitive in the game's look.
 * Flat screentone gives you a photocopied grey; what makes a dark
 * Seinen page read as *drawn* is that the shadow is built from
 * hundreds of individual pen strokes that get shorter, thinner and
 * sparser as they approach the light, so the gradient is made of
 * marks rather than dots.
 *
 * Strokes run along `angle`. The falloff is measured along the
 * perpendicular axis, from the dark edge (t=0) to the lit edge
 * (t=1).
 *
 * opts:
 *   x,y,w,h    field box (current transform space)
 *   angle      stroke direction, radians
 *   gap        spacing between stroke lanes
 *   weight     stroke width at the dark edge
 *   len        stroke length at the dark edge (defaults to the box)
 *   density    (t)=>0..1 chance a lane is drawn at all
 *   power      shorthand falloff exponent when `density` is absent
 *   jitterLen  random shortening, 0..1
 *   seed, colour
 */
export function feather(ctx, opts = {}) {
  const x = opts.x || 0;
  const y = opts.y || 0;
  const w = opts.w || 100;
  const h = opts.h || 100;
  const angle = opts.angle == null ? -0.9 : opts.angle;
  const gap = opts.gap || 3.4;
  const weight = opts.weight || 1.5;
  const seed = opts.seed || 7;
  const colour = opts.colour || PAL.ink;
  const power = opts.power == null ? 1.5 : opts.power;
  const density = opts.density || ((t) => Math.pow(1 - t, power));
  const rand = rng(Math.floor(seed * 7717) + 3);

  const cx = x + w / 2;
  const cy = y + h / 2;
  const diag = Math.hypot(w, h) * 0.62;

  // Gradient axis, in the field's own space. Density is sampled by
  // projecting each stroke segment onto it, which lets the strokes
  // run in a direction unrelated to the light — required, because a
  // cross-hatch pass must lie at a different angle while still
  // fading toward the same light source.
  const gx = opts.gx == null ? Math.cos(angle - Math.PI / 2) : opts.gx;
  const gy = opts.gy == null ? Math.sin(angle - Math.PI / 2) : opts.gy;

  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const nx = -sa;
  const ny = ca;
  const dash = opts.dash || gap * 3.6;

  ctx.save();
  ctx.translate(cx, cy);
  const lanes = Math.ceil((diag * 2) / gap);
  for (let i = 0; i <= lanes; i++) {
    const u = -diag + i * gap + (rand() - 0.5) * gap * 0.45;
    // Walk the lane in dashes, evaluating the gradient per dash so a
    // single lane can be solid at one end and absent at the other.
    for (let s = -diag; s < diag; s += dash) {
      const jitterS = (rand() - 0.5) * dash * 0.4;
      const mid = s + dash / 2 + jitterS;
      const px = ca * mid + nx * u;
      const py = sa * mid + ny * u;
      const proj = (px * gx + py * gy) / (diag * 2) + 0.5;
      const t = Math.max(0, Math.min(1, proj));
      const d = density(t);
      if (d <= 0.015) continue;
      if (rand() > d * 1.15) continue;

      const len = dash * (0.5 + d * 0.7);
      // `weight` is stroke THICKNESS; brush() wants a half-width.
      const lw = weight * 0.5 * (0.3 + d * 0.85);
      if (lw < 0.06) continue;
      const bow = (rand() - 0.5) * len * 0.06;
      const a0 = [ca * (mid - len / 2) + nx * u, sa * (mid - len / 2) + ny * u];
      const a1 = [ca * mid + nx * (u + bow), sa * mid + ny * (u + bow)];
      const a2 = [ca * (mid + len / 2) + nx * u, sa * (mid + len / 2) + ny * u];
      brush(ctx, [a0, a1, a2], {
        width: lw, taper: opts.taper || "both", jitter: 0.3,
        seed: seed + i * 7 + s, colour,
      });
    }
  }
  ctx.restore();
}

/**
 * Fill the CURRENT PATH with a full Berserk-style shading stack:
 * a primary feather pass, a cross pass over the darker half, and a
 * third pass in the core, all in device pixels so the pen weight is
 * constant regardless of how the figure is scaled.
 *
 * `dark` 0..1 sets how deep the shadow goes.
 */
export function hatchShade(ctx, opts = {}) {
  const dark = opts.dark == null ? 0.55 : opts.dark;
  const seed = opts.seed || 11;
  const colour = opts.colour || PAL.ink;
  const gap = opts.gap || 3.4;
  const weight = opts.weight || 1.4;

  ctx.save();
  ctx.clip();
  const m = ctx.getTransform();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  // Light direction in device space (unit-ish, pointing FROM the
  // light TOWARD the subject's lit side). Default: upper right.
  const light = opts.light || [0.66, -0.52];
  const ll = Math.hypot(light[0], light[1]) || 1;
  const gx = light[0] / ll;
  const gy = light[1] / ll;
  const lightAngle = Math.atan2(gy, gx);

  const field = { x: 0, y: 0, w: W, h: H, colour, seed, gx, gy };

  // Strokes lie across the light so they follow the form's turn.
  const base = lightAngle - Math.PI / 2 + (opts.tilt || 0);

  feather(ctx, {
    ...field, angle: base, gap, weight,
    seed: seed + 1,
    density: (t) => Math.pow(Math.max(0, 1 - t), 1.15) * dark * 1.55,
  });

  if (dark > 0.3) {
    feather(ctx, {
      ...field, angle: base + 1.06, gap: gap * 1.15, weight: weight * 0.85,
      seed: seed + 41,
      density: (t) => Math.pow(Math.max(0, 1 - t * 1.55), 1.5) * dark * 1.45,
    });
  }
  if (dark > 0.62) {
    feather(ctx, {
      ...field, angle: base + 0.5, gap: gap * 0.9, weight: weight * 0.82,
      seed: seed + 83,
      density: (t) => Math.pow(Math.max(0, 1 - t * 2.3), 1.6) * dark * 1.5,
    });
  }

  ctx.setTransform(m);
  ctx.restore();
}

/**
 * Stipple: density-graded dots. Stone, dirt, rot, old skin — the
 * texture pass that sits underneath the hatching.
 */
export function stipple(ctx, opts = {}) {
  const count = opts.count || 300;
  const seed = opts.seed || 5;
  const rand = rng(Math.floor(seed * 3313) + 9);
  const colour = opts.colour || PAL.ink;
  const x = opts.x || 0;
  const y = opts.y || 0;
  const w = opts.w || 100;
  const h = opts.h || 100;
  const rMin = opts.rMin == null ? 0.35 : opts.rMin;
  const rMax = opts.rMax == null ? 1.25 : opts.rMax;
  const density = opts.density || (() => 1);

  ctx.fillStyle = colour;
  for (let i = 0; i < count; i++) {
    const px = x + rand() * w;
    const py = y + rand() * h;
    if (rand() > density((px - x) / w, (py - y) / h)) continue;
    const r = rMin + rand() * rand() * (rMax - rMin);
    ctx.beginPath();
    ctx.ellipse(px, py, r, r * (0.7 + rand() * 0.6), rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Stipple the CURRENT PATH, in device pixels. */
export function stippleShade(ctx, opts = {}) {
  ctx.save();
  ctx.clip();
  const m = ctx.getTransform();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  stipple(ctx, { ...opts, x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height });
  ctx.setTransform(m);
  ctx.restore();
}

/* ---------------------------------------------------------- */
/* Hatching (legacy box helper, still used by props)           */
/* ---------------------------------------------------------- */

/**
 * Parallel hatch lines across a box, intended to be used inside a
 * clip. `density` is the gap in px, `angle` in radians.
 */
export function hatch(ctx, x, y, w, h, opts = {}) {
  const angle = opts.angle == null ? -Math.PI / 4 : opts.angle;
  const gap = opts.gap || 5;
  const weight = opts.weight || 1.1;
  const seed = opts.seed || 3;
  const colour = opts.colour || PAL.ink;
  const jitter = opts.jitter == null ? 0.5 : opts.jitter;

  const cx = x + w / 2;
  const cy = y + h / 2;
  const diag = Math.hypot(w, h) * 0.72;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = colour;
  let i = 0;
  for (let u = -diag; u <= diag; u += gap) {
    i++;
    const jitterA = wobble(i * 0.7, seed) * jitter * gap * 0.5;
    const shrink = Math.abs(wobble(i * 1.3, seed + 2)) * diag * 0.18;
    const wgt = weight * (0.7 + Math.abs(wobble(i * 2.1, seed + 5)) * 0.9);
    brush(ctx, [
      [-diag + shrink, u + jitterA],
      [0, u + jitterA * 0.4],
      [diag - shrink, u + jitterA * 0.8],
    ], { width: wgt, taper: "both", jitter: 0.3, seed: seed + i, colour });
  }
  ctx.restore();
}

/** Cross-hatch: two hatch passes at complementary angles. */
export function crossHatch(ctx, x, y, w, h, opts = {}) {
  hatch(ctx, x, y, w, h, opts);
  hatch(ctx, x, y, w, h, {
    ...opts,
    angle: (opts.angle == null ? -Math.PI / 4 : opts.angle) + Math.PI / 2.4,
    seed: (opts.seed || 3) + 31,
    weight: (opts.weight || 1.1) * 0.8,
  });
}

/* ---------------------------------------------------------- */
/* Splatter                                                    */
/* ---------------------------------------------------------- */

/**
 * A wobbled radial blob plus satellite droplets. Used for ink
 * impacts, blood spray and the grimy accents on UI panels.
 */
export function splat(ctx, x, y, r, opts = {}) {
  const seed = opts.seed == null ? 5 : opts.seed;
  const rand = rng(Math.floor(seed * 9973) + 1);
  const colour = opts.colour || PAL.ink;
  const lobes = opts.lobes || 9;
  const rough = opts.rough == null ? 0.45 : opts.rough;

  ctx.fillStyle = colour;
  ctx.beginPath();
  const steps = lobes * 4;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const lobe = 1 + Math.sin(a * lobes + seed) * rough * 0.5;
    const noise = 1 + wobble(a * 3 + seed, seed) * rough;
    const rr = r * lobe * noise * 0.62;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  const drops = opts.drops == null ? 7 : opts.drops;
  for (let i = 0; i < drops; i++) {
    const a = rand() * Math.PI * 2;
    const d = r * (0.7 + rand() * 1.5);
    const rr = r * (0.05 + rand() * 0.2);
    ctx.beginPath();
    ctx.ellipse(
      x + Math.cos(a) * d, y + Math.sin(a) * d,
      rr, rr * (0.6 + rand() * 0.8), a, 0, Math.PI * 2
    );
    ctx.fill();
  }
}

/** A directional blood arc: a spray of tapered flicks along a cone. */
export function spray(ctx, x, y, dir, spread, len, opts = {}) {
  const seed = opts.seed == null ? 11 : opts.seed;
  const rand = rng(Math.floor(seed * 7919) + 3);
  const colour = opts.colour || PAL.blood;
  const count = opts.count || 9;
  for (let i = 0; i < count; i++) {
    const a = dir + (rand() - 0.5) * spread;
    const l = len * (0.35 + rand() * 0.85);
    const w = (opts.width || 3) * (0.4 + rand() * 0.9);
    const curve = (rand() - 0.5) * 0.5;
    const pts = [];
    for (let s = 0; s <= 5; s++) {
      const t = s / 5;
      const aa = a + curve * t;
      pts.push([x + Math.cos(aa) * l * t, y + Math.sin(aa) * l * t]);
    }
    brush(ctx, pts, { width: w, taper: "end", jitter: 0.4, seed: seed + i, colour });
    if (rand() < 0.55) {
      const dd = l * (1 + rand() * 0.35);
      splat(ctx, x + Math.cos(a) * dd, y + Math.sin(a) * dd, w * (0.6 + rand()), {
        seed: seed + i * 3, colour, drops: 2, rough: 0.6,
      });
    }
  }
}

/* ---------------------------------------------------------- */
/* Paper                                                       */
/* ---------------------------------------------------------- */

let paperTile = null;

/** Warm off-white newsprint with fibre speckle and slow mottling. */
export function paper(size = 512) {
  if (paperTile) return paperTile;
  const c = makeCanvas(size, size);
  const g = ctxOf(c);
  g.fillStyle = PAL.paper;
  g.fillRect(0, 0, size, size);

  const rand = rng(20260802);

  // Large-scale mottling, kept very low contrast. Anything stronger
  // makes the tile's repeat visible as a grid across the playfield,
  // which is the one thing that instantly reads as "computer".
  for (let i = 0; i < 70; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 24 + rand() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rand() < 0.5;
    grd.addColorStop(0, dark ? "rgba(120,110,90,0.018)" : "rgba(255,253,246,0.025)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fibres.
  for (let i = 0; i < 1200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI;
    const l = 2 + rand() * 9;
    g.strokeStyle = rand() < 0.55
      ? "rgba(120,110,88,0.10)"
      : "rgba(255,255,250,0.16)";
    g.lineWidth = rand() < 0.8 ? 0.6 : 1.1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }

  // Speckle grain.
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 10;
    d[i] = clamp255(d[i] + n);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n * 0.85);
  }
  g.putImageData(img, 0, 0);

  paperTile = c;
  return c;
}

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

/* ---------------------------------------------------------- */
/* Speed lines (集中線 / 流線)                                  */
/* ---------------------------------------------------------- */

/**
 * Focus lines: tapered spokes converging on the centre with a
 * clean "hole" in the middle where the action reads.
 */
export function focusLines(size, opts = {}) {
  const c = makeCanvas(size, size);
  const g = ctxOf(c);
  const rand = rng(opts.seed || 77);
  const count = opts.count || 130;
  const hole = (opts.hole == null ? 0.26 : opts.hole) * size * 0.5;
  const colour = opts.colour || PAL.ink;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.72;

  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const inner = hole * (0.85 + rand() * 0.7);
    const outer = R * (0.8 + rand() * 0.35);
    const w = (opts.width || 5) * (0.25 + rand() * rand() * 1.8);
    brush(g, [
      [cx + Math.cos(a) * inner, cy + Math.sin(a) * inner],
      [cx + Math.cos(a) * (inner + outer) * 0.5, cy + Math.sin(a) * (inner + outer) * 0.5],
      [cx + Math.cos(a) * outer, cy + Math.sin(a) * outer],
    ], { width: w, taper: "start", jitter: 0.1, seed: i * 3 + 1, colour });
  }
  return c;
}

/** Motion lines: near-parallel horizontal streaks for dashes. */
export function flowLines(w, h, opts = {}) {
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  const rand = rng(opts.seed || 41);
  const count = opts.count || 26;
  const colour = opts.colour || PAL.ink;
  for (let i = 0; i < count; i++) {
    const y = rand() * h;
    const x0 = rand() * w * 0.35;
    const len = w * (0.4 + rand() * 0.6);
    const wgt = (opts.width || 3) * (0.25 + rand() * rand() * 1.6);
    brush(g, [
      [x0, y], [x0 + len * 0.5, y + (rand() - 0.5) * 3], [x0 + len, y],
    ], { width: wgt, taper: "both", jitter: 0.15, seed: i * 7, colour });
  }
  return c;
}

/* ---------------------------------------------------------- */
/* Panels & frames                                             */
/* ---------------------------------------------------------- */

/**
 * A manga panel border: hand-inked rectangle with slightly
 * un-square corners. Draws only the border; fill separately.
 */
export function panelFrame(ctx, x, y, w, h, opts = {}) {
  const weight = opts.weight || 3.2;
  const seed = opts.seed || 13;
  const colour = opts.colour || PAL.ink;
  const j = opts.jitter == null ? 1.6 : opts.jitter;

  const corner = (i) => [
    wobble(i * 3.7, seed) * j,
    wobble(i * 5.1, seed + 4) * j,
  ];
  const [ax, ay] = corner(1);
  const [bx, by] = corner(2);
  const [cx2, cy2] = corner(3);
  const [dx, dy] = corner(4);

  const p = [
    [x + ax, y + ay],
    [x + w + bx, y + by],
    [x + w + cx2, y + h + cy2],
    [x + dx, y + h + dy],
  ];

  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    brush(ctx, [
      a,
      [(a[0] + b[0]) / 2 + wobble(i * 2.2, seed) * j, (a[1] + b[1]) / 2 + wobble(i * 4.4, seed + 9) * j],
      b,
    ], { width: weight, taper: "none", jitter: 0.14, seed: seed + i * 11, colour });
  }
}

/** Paper-coloured panel body with a soft drop shadow. */
export function panelBody(ctx, x, y, w, h, opts = {}) {
  const fill = opts.fill || "rgba(244,240,230,0.94)";
  if (opts.shadow !== false) {
    ctx.fillStyle = "rgba(16,16,20,0.28)";
    ctx.fillRect(x + 4, y + 5, w, h);
  }
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

/* ---------------------------------------------------------- */
/* Text                                                        */
/* ---------------------------------------------------------- */

/**
 * Manga lettering: a white knock-out halo, then a heavy ink
 * outline, then the fill. Optionally jittered to hand-drawn.
 */
export function inkText(ctx, text, x, y, opts = {}) {
  const font = opts.font || '700 28px "Bebas Neue", "Arial Narrow", sans-serif';
  ctx.save();
  ctx.font = font;
  ctx.textAlign = opts.align || "center";
  ctx.textBaseline = opts.baseline || "alphabetic";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  const halo = opts.halo == null ? 6 : opts.halo;
  const outline = opts.outline == null ? 3 : opts.outline;

  if (halo > 0) {
    ctx.strokeStyle = opts.haloColour || PAL.paperLit;
    ctx.lineWidth = halo + outline;
    ctx.strokeText(text, x, y);
  }
  if (outline > 0) {
    ctx.strokeStyle = opts.outlineColour || PAL.ink;
    ctx.lineWidth = outline;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = opts.colour || PAL.ink;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/* ---------------------------------------------------------- */
/* Misc shapes used across the game                            */
/* ---------------------------------------------------------- */

/** Rough circle path (no fill/stroke) — organic, not compass-drawn. */
export function roughCircle(ctx, x, y, r, seed = 1, rough = 0.05) {
  ctx.beginPath();
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r * (1 + wobble(a * 2.4 + seed, seed) * rough);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Four-point sparkle/star — the manga "impact" glint. */
export function starburst(ctx, x, y, r, opts = {}) {
  const points = opts.points || 4;
  const inner = opts.inner == null ? 0.16 : opts.inner;
  const rot = opts.rot || 0;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * inner;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = opts.colour || PAL.ink;
  ctx.fill();
}

/** Jagged lightning polyline between two points. */
export function boltPath(x0, y0, x1, y1, segments, amp, seed) {
  const pts = [[x0, y0]];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const rand = rng(Math.floor(seed * 4099) + 7);
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const off = (rand() - 0.5) * amp * Math.sin(Math.PI * t) * 2;
    pts.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]);
  }
  pts.push([x1, y1]);
  return pts;
}
