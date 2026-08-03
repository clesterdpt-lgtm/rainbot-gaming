/* ============================================================
   INKBLOOD — figure.js
   Procedural inked humanoids.

   Nothing here is a bitmap. A character is a rig (joint positions
   derived from a pose) plus a stack of drawing passes:

       silhouette -> garments -> hair -> face -> tone -> hatching

   The house style, in order of importance:
     * BIG BLACK MASSES. Hair and coats are solid ink. That single
       decision is what makes the read "manga" instead of "cartoon".
     * WHITE HIGHLIGHT STREAKS cut back into those masses.
     * SCREENTONE only in the mid-values, never on the lit side.
     * Outlines vary in weight — heavy on the shadow side, whisper
       thin on the lit side.
   ============================================================ */

"use strict";

import {
  PAL, brush, tone, wobble, rng, splat, fillToneDevice, deviceSpace,
  hatchShade, stippleShade, inkContour, samplePath, feather,
} from "./art.js?v=20260803-1";

/**
 * The light. Everything in the game is lit from the upper right by
 * the same source, in device space, so shadows agree across every
 * character and prop no matter how each one was built.
 */
export const LIGHT = [0.66, -0.52];

/**
 * Global shading gain.
 *
 * One knob for how dark the whole cast reads, so the page value can
 * be tuned without touching sixty individual call sites. Raising it
 * pushes everything toward a heavy Seinen page; dropping it toward
 * clean shonen line art.
 */
export const SHADE_GAIN = 1.35;

/**
 * Value structure, and why it matters.
 *
 * A figure drawn in pure black-and-white collapses into a blob the
 * moment two black masses touch. So every character is built from
 * four values and neighbouring parts must never share one:
 *
 *   PAPER  (paperLit) — skin, blade steel, inner lining
 *   LIGHT  (tone .22) — light cloth, bone
 *   MID    (tone .45) — trousers, hakama, shell
 *   INK    (ink)      — hair, coats, cast shadow
 *
 * `TONE` below is the shorthand you pass to shape({ fill }).
 */
export const TONE = {
  light: { tone: 0.2, cell: 3.4 },
  mid: { tone: 0.42, cell: 3.4 },
  deep: { tone: 0.66, cell: 3.4 },
  fine: { tone: 0.3, cell: 2.6 },
};

/* ---------------------------------------------------------- */
/* Path helpers                                                */
/* ---------------------------------------------------------- */

/** Catmull-Rom through points, emitted as cubic beziers. */
export function smoothPath(ctx, pts, closed = true, tension = 0.5) {
  const n = pts.length;
  if (n < 2) return;
  const at = (i) => {
    if (closed) return pts[(i + n) % n];
    return pts[Math.max(0, Math.min(n - 1, i))];
  };
  ctx.moveTo(pts[0][0], pts[0][1]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1); const p1 = at(i); const p2 = at(i + 1); const p3 = at(i + 2);
    ctx.bezierCurveTo(
      p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2,
      p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2,
      p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2,
      p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2,
      p2[0], p2[1]
    );
  }
  if (closed) ctx.closePath();
}

/**
 * Fill + ink a closed smooth shape.
 * opts.fill      fill style ("none" to skip)
 * opts.line      outline weight (0 to skip)
 * opts.shadowSide unit vector [x,y]; the outline thickens on that side
 */
/**
 * Fill, shade and ink a closed form in one call.
 *
 * opts:
 *   fill     colour, "none", or a legacy {tone,cell} screentone spec
 *   shade    0..1 — how deep the hatched form shadow goes
 *   stipple  0..1 — grain density laid under the hatching
 *   line     contour weight (0 to skip)
 *   contrast how much the contour swells on the shadow side
 *   tension  curve tension for the silhouette
 */
export function shape(ctx, pts, opts = {}) {
  const tension = opts.tension == null ? 0.5 : opts.tension;
  const path = () => { ctx.beginPath(); smoothPath(ctx, pts, true, tension); };

  if (opts.fill !== "none") {
    const f = opts.fill || PAL.paperLit;
    if (f && typeof f === "object") {
      path();
      ctx.fillStyle = f.under || PAL.paperLit;
      ctx.fill();
      path();
      fillToneDevice(ctx, f.tone, f.cell || 3.4, f.colour || PAL.ink);
    } else {
      path();
      ctx.fillStyle = f;
      ctx.fill();
    }
  }

  // Grain first, hatching over it — the same order a pen would go
  // down on the board.
  if (opts.stipple) {
    path();
    stippleShade(ctx, {
      count: opts.stippleCount || 900,
      seed: (opts.seed || 5) + 3,
      rMax: 1.1,
      density: () => opts.stipple,
      colour: opts.stippleColour || PAL.ink,
    });
  }

  if (opts.shade) {
    path();
    hatchShade(ctx, {
      dark: Math.min(0.95, opts.shade * SHADE_GAIN),
      seed: opts.seed || 11,
      light: opts.light || LIGHT,
      gap: opts.gap || 3.9,
      weight: opts.hatchWeight || 1.05,
      tilt: opts.tilt || 0,
      colour: opts.hatchColour || PAL.ink,
    });
  }

  const lw = opts.line == null ? 2 : opts.line;
  const light = opts.light || LIGHT;
  const dark = opts.fill === PAL.ink || opts.fill === PAL.inkSoft;

  if (lw > 0) {
    inkContour(ctx, pts, {
      width: lw,
      light,
      contrast: opts.contrast == null ? 1 : opts.contrast,
      breaks: opts.breaks == null ? 0.14 : opts.breaks,
      seed: opts.seed || 3,
      colour: opts.lineColour || PAL.ink,
      per: 7,
      seg: opts.seg || 5,
    });
  }

  /**
   * Rim light on solid blacks.
   *
   * Spotted blacks are the backbone of this style, but two black
   * shapes that touch merge into one unreadable mass — which is
   * exactly what a cloak over black boots over black hair does. A
   * thin broken highlight along the LIT edge of every dark shape
   * separates them again, and it is also how the form gets read at
   * all once the local value is zero. Drawn by re-running the
   * contour with the light inverted, so it only lands where the ink
   * pass was thinnest.
   */
  const rim = opts.rim == null ? dark : opts.rim;
  if (rim) {
    inkContour(ctx, pts, {
      rimOnly: true,
      width: opts.rimWidth || Math.max(0.8, lw * 0.5),
      light,
      seed: (opts.seed || 3) + 500,
      colour: opts.rimColour || PAL.paperLit,
      per: 7,
      seg: opts.seg || 6,
    });
  }
}

/**
 * Cloth folds. A handful of tapered lines that start at a stress
 * point and die out across the fabric, plus a shadow hatch in the
 * trough of the deepest ones. Cloth without folds reads as vinyl.
 */
export function folds(ctx, x, y, dir, count, len, spread, opts = {}) {
  const seed = opts.seed || 17;
  const rand = rng(Math.floor(seed * 5501) + 5);
  const colour = opts.colour || PAL.ink;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const a = dir + (t - 0.5) * spread + (rand() - 0.5) * 0.16;
    const l = len * (0.5 + rand() * 0.75);
    const bow = (rand() - 0.5) * 0.5;
    const pts = [];
    for (let s = 0; s <= 4; s++) {
      const k = s / 4;
      const aa = a + bow * k;
      pts.push([x + Math.cos(aa) * l * k, y + Math.sin(aa) * l * k]);
    }
    brush(ctx, pts, {
      width: (opts.width || 1.1) * 0.5 * (0.6 + rand() * 0.8),
      taper: "end", jitter: 0.24, seed: seed + i * 5, colour,
    });
    // Every third fold gets a companion shadow line.
    if (i % 3 === 1) {
      brush(ctx, pts.map((p) => [p[0] + 1.6, p[1] + 1.4]), {
        width: (opts.width || 1.1) * 0.25,
        taper: "end", jitter: 0.3, seed: seed + i * 5 + 90, colour,
      });
    }
  }
}

/** Tapered capsule between two joints — the workhorse for limbs. */
export function limb(ctx, x0, y0, x1, y1, w0, w1, opts = {}) {
  const dx = x1 - x0; const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len; const uy = dy / len;
  const nx = -uy; const ny = ux;
  const bow = opts.bow || 0;
  const mx = (x0 + x1) / 2 + nx * bow;
  const my = (y0 + y1) / 2 + ny * bow;
  const wm = (w0 + w1) / 2 * (opts.belly == null ? 1.06 : opts.belly);

  const pts = [];
  const steps = 10;
  // One side out...
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = quad(x0, y0, mx, my, x1, y1, t);
    const w = lerp3(w0, wm, w1, t);
    pts.push([p[0] + nx * w, p[1] + ny * w]);
  }
  // Round the far cap.
  for (let i = 1; i < 5; i++) {
    const a = Math.atan2(ny, nx) - (i / 5) * Math.PI;
    pts.push([x1 + Math.cos(a) * w1, y1 + Math.sin(a) * w1]);
  }
  // ...and back down the other.
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const p = quad(x0, y0, mx, my, x1, y1, t);
    const w = lerp3(w0, wm, w1, t);
    pts.push([p[0] - nx * w, p[1] - ny * w]);
  }
  for (let i = 1; i < 5; i++) {
    const a = Math.atan2(-ny, -nx) - (i / 5) * Math.PI;
    pts.push([x0 + Math.cos(a) * w0, y0 + Math.sin(a) * w0]);
  }
  shape(ctx, pts, {
    tension: 0.32,
    shade: opts.shade == null ? 0.5 : opts.shade,
    ...opts,
  });
}

function quad(x0, y0, cx, cy, x1, y1, t) {
  const mt = 1 - t;
  return [mt * mt * x0 + 2 * mt * t * cx + t * t * x1, mt * mt * y0 + 2 * mt * t * cy + t * t * y1];
}
function lerp3(a, b, c, t) {
  return t < 0.5 ? a + (b - a) * (t * 2) : b + (c - b) * ((t - 0.5) * 2);
}
export function lerp(a, b, t) { return a + (b - a) * t; }

/* ---------------------------------------------------------- */
/* Hair / cloth                                                */
/* ---------------------------------------------------------- */

/**
 * One lock of hair (or one ribbon of cloth): a curved tapered
 * black mass with a white highlight streak carved out of it.
 */
export function lock(ctx, x0, y0, angle, len, width, opts = {}) {
  const curve = opts.curve == null ? 0.55 : opts.curve;
  const seg = opts.seg || 7;
  const spine = [];
  let a = angle;
  let x = x0; let y = y0;
  for (let i = 0; i <= seg; i++) {
    spine.push([x, y]);
    a += curve / seg + (opts.wave ? Math.sin(i * 1.5 + (opts.phase || 0)) * (opts.wave / seg) : 0);
    x += Math.cos(a) * (len / seg);
    y += Math.sin(a) * (len / seg);
  }

  const colour = opts.colour || PAL.ink;
  brush(ctx, spine, {
    width,
    taper: opts.taper || "end",
    jitter: opts.jitter == null ? 0.1 : opts.jitter,
    seed: opts.seed || 3,
    colour,
  });

  // Highlight: a thinner pale streak riding along the mass.
  if (opts.gloss !== false && colour === PAL.ink) {
    const hi = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const p = spine[i];
      const nA = i < seg
        ? Math.atan2(spine[i + 1][1] - p[1], spine[i + 1][0] - p[0])
        : Math.atan2(p[1] - spine[i - 1][1], p[0] - spine[i - 1][0]);
      const off = width * (opts.glossOffset == null ? -0.34 : opts.glossOffset) * (1 - t * 0.35);
      hi.push([p[0] + Math.cos(nA - Math.PI / 2) * off, p[1] + Math.sin(nA - Math.PI / 2) * off]);
    }
    const from = Math.floor(seg * (opts.glossFrom == null ? 0.12 : opts.glossFrom));
    const to = Math.ceil(seg * (opts.glossTo == null ? 0.72 : opts.glossTo));
    brush(ctx, hi.slice(from, to + 1), {
      width: width * (opts.glossWidth == null ? 0.2 : opts.glossWidth),
      taper: "both",
      jitter: 0.12,
      seed: (opts.seed || 3) + 41,
      colour: opts.glossColour || PAL.paperLit,
    });
  }
  return spine;
}

/** White highlight streaks carved into a black mass. */
export function gloss(ctx, pts, width, colour = PAL.paperLit) {
  brush(ctx, pts, { width, taper: "both", jitter: 0.16, seed: 19, colour });
}

/* ---------------------------------------------------------- */
/* Shading passes                                              */
/* ---------------------------------------------------------- */

/**
 * Screentone a region defined by a clip callback. The tone is
 * applied as a soft wedge so it falls away from the light.
 */
export function toneRegion(ctx, clipFn, box, level = 0.34, cell = 3.4) {
  ctx.beginPath();
  clipFn(ctx);
  fillToneDevice(ctx, level, cell);
}

/* ---------------------------------------------------------- */
/* Rig                                                         */
/* ---------------------------------------------------------- */

/**
 * Build joint positions for a humanoid.
 *
 * `p` (proportions) is in figure units where 0 = ground and the
 * character's nominal height is `p.h`. +x is the facing direction.
 */
export function buildRig(p, pose) {
  const bob = pose.bob || 0;
  const lean = pose.lean || 0;

  const hipY = p.hip + bob;
  const chestY = p.chest + bob;
  const shoY = p.shoulder + bob;
  const headY = p.head + bob;

  const leanX = (y) => lean * (y / p.h);

  const hip = [leanX(hipY), -hipY];
  const chest = [leanX(chestY) + (p.chestFwd || 0), -chestY];
  const neck = [leanX(shoY) + (p.neckFwd || 0), -shoY];
  const headC = [leanX(headY) + (p.headFwd || 0), -headY];

  const legs = [];
  for (let s = 0; s < 2; s++) {
    const swing = s === 0 ? pose.legA : pose.legB;
    const bend = s === 0 ? pose.kneeA : pose.kneeB;
    const hipX = hip[0] + (s === 0 ? p.hipW : -p.hipW) * 0.5;
    const kx = hipX + Math.sin(swing) * p.thigh;
    const ky = hip[1] + Math.cos(swing) * p.thigh;
    const shinA = swing - bend;
    const ax = kx + Math.sin(shinA) * p.shin;
    const ay = ky + Math.cos(shinA) * p.shin;
    legs.push({ hip: [hipX, hip[1]], knee: [kx, ky], ankle: [ax, ay], swing, shinA });
  }

  const arms = [];
  for (let s = 0; s < 2; s++) {
    const swing = s === 0 ? pose.armA : pose.armB;
    const bend = s === 0 ? pose.elbowA : pose.elbowB;
    const shX = neck[0] + (s === 0 ? p.shoulderW : -p.shoulderW) * 0.5;
    const shY = neck[1] + p.shoulderDrop;
    const ex = shX + Math.sin(swing) * p.upperArm;
    const ey = shY + Math.cos(swing) * p.upperArm;
    const fA = swing - bend;
    const wx = ex + Math.sin(fA) * p.foreArm;
    const wy = ey + Math.cos(fA) * p.foreArm;
    arms.push({ sh: [shX, shY], elbow: [ex, ey], wrist: [wx, wy], swing, fA });
  }

  return { hip, chest, neck, headC, legs, arms, p, pose };
}

/** A walk/run cycle pose at phase t (0..1). */
export function runPose(t, opts = {}) {
  const amp = opts.amp == null ? 1 : opts.amp;
  const w = t * Math.PI * 2;
  const legA = Math.sin(w) * 0.62 * amp;
  const legB = Math.sin(w + Math.PI) * 0.62 * amp;
  return {
    legA,
    legB,
    kneeA: Math.max(0, Math.sin(w - 0.9)) * 0.95 * amp + 0.12,
    kneeB: Math.max(0, Math.sin(w + Math.PI - 0.9)) * 0.95 * amp + 0.12,
    armA: Math.sin(w + Math.PI) * 0.5 * amp - 0.1,
    armB: Math.sin(w) * 0.5 * amp - 0.1,
    elbowA: 0.5 + Math.max(0, Math.sin(w + Math.PI)) * 0.5,
    elbowB: 0.5 + Math.max(0, Math.sin(w)) * 0.5,
    bob: Math.abs(Math.sin(w * 2)) * 1.9 * amp,
    lean: opts.lean == null ? 3.5 : opts.lean,
    phase: t,
  };
}

/** Idle breathing pose. */
export function idlePose(t, opts = {}) {
  const w = t * Math.PI * 2;
  return {
    legA: 0.1, legB: -0.1,
    kneeA: 0.14, kneeB: 0.1,
    armA: 0.16 + Math.sin(w) * 0.04,
    armB: -0.12 - Math.sin(w) * 0.04,
    elbowA: 0.34, elbowB: 0.28,
    bob: Math.sin(w) * 0.7,
    lean: opts.lean == null ? 1.2 : opts.lean,
    phase: t,
  };
}

/* ---------------------------------------------------------- */
/* Body parts                                                  */
/* ---------------------------------------------------------- */

export function drawLeg(ctx, leg, p, opts = {}) {
  const dark = opts.dark !== false;
  const fill = opts.fill || (dark ? PAL.ink : PAL.paperLit);
  limb(ctx, leg.hip[0], leg.hip[1], leg.knee[0], leg.knee[1], p.thighW, p.kneeW, {
    fill, line: opts.line == null ? 1.7 : opts.line, bow: opts.bow || 0,
  });
  limb(ctx, leg.knee[0], leg.knee[1], leg.ankle[0], leg.ankle[1], p.kneeW, p.ankleW, {
    fill, line: opts.line == null ? 1.7 : opts.line,
  });
  // Boot / foot wedge.
  const fA = leg.shinA;
  const fx = leg.ankle[0] + Math.sin(fA) * 1.2;
  const fy = leg.ankle[1] + Math.cos(fA) * 1.2;
  const toe = p.foot || 7;
  shape(ctx, [
    [fx - toe * 0.35, fy - p.ankleW * 1.5],
    [fx + toe, fy - p.ankleW * 0.5],
    [fx + toe * 0.92, fy + 1.6],
    [fx - toe * 0.5, fy + 1.6],
  ], { fill: PAL.ink, line: 1.6, tension: 0.28 });
}

export function drawArm(ctx, arm, p, opts = {}) {
  const fill = opts.fill || PAL.paperLit;
  limb(ctx, arm.sh[0], arm.sh[1], arm.elbow[0], arm.elbow[1], p.upperArmW, p.elbowW, {
    fill, line: opts.line == null ? 1.7 : opts.line,
  });
  limb(ctx, arm.elbow[0], arm.elbow[1], arm.wrist[0], arm.wrist[1], p.elbowW, p.wristW, {
    fill: opts.foreFill || fill, line: opts.line == null ? 1.7 : opts.line,
  });
  if (opts.hand !== false) {
    // A fist, not a ball. A plain filled circle reads as a floating
    // white sphere at any size — it needs the same form shadow and
    // weighted contour as the rest of the body, plus a knuckle line.
    const wx = arm.wrist[0];
    const wy = arm.wrist[1];
    const r = p.wristW * 1.3;
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = r * (1 + wobble(a * 2 + (opts.seed || 1), 3) * 0.14);
      pts.push([wx + Math.cos(a) * rr * 1.06, wy + Math.sin(a) * rr * 0.94]);
    }
    shape(ctx, pts, {
      fill: opts.handFill || PAL.paperLit,
      line: opts.line == null ? 1.6 : opts.line * 0.85,
      tension: 0.45,
      shade: opts.shade == null ? 0.55 : Math.min(0.95, opts.shade + 0.12),
      seed: (opts.seed || 1) + 77,
      gap: 3.0,
      contrast: 1.2,
    });
    // Knuckles.
    brush(ctx, [[wx - r * 0.5, wy - r * 0.3], [wx + r * 0.55, wy - r * 0.12]],
      { width: 0.28, taper: "both", jitter: 0.3, seed: (opts.seed || 1) + 91, colour: PAL.ink });
  }
}

export function drawTorso(ctx, rig, p, opts = {}) {
  const { hip, chest, neck } = rig;
  const w = p.torsoW;
  const pts = [
    [neck[0] - w * 0.46, neck[1] + 1],
    [neck[0] + w * 0.46, neck[1] + 1],
    [chest[0] + w * 0.55, chest[1]],
    [hip[0] + w * 0.42, hip[1] + 1],
    [hip[0] - w * 0.42, hip[1] + 1],
    [chest[0] - w * 0.55, chest[1]],
  ];
  shape(ctx, pts, {
    fill: opts.fill || PAL.paperLit,
    line: opts.line == null ? 1.9 : opts.line,
    tension: 0.42,
    shade: opts.shade == null ? 0.5 : opts.shade,
    seed: opts.seed || 23,
    contrast: 1.2,
  });
  return pts;
}

/**
 * Neck. MUST be drawn before the head — drawing it after puts a
 * pale capsule straight over the character's chin and mouth, which
 * is exactly what it did in the first bake.
 */
export function drawNeck(ctx, rig, p, opts = {}) {
  const [hx, hy] = rig.headC;
  const r = p.headR;
  limb(ctx, hx - r * 0.1, hy + r * 0.35, rig.neck[0], rig.neck[1] + 1.5, r * 0.36, r * 0.44, {
    fill: opts.fill || PAL.paperLit, line: opts.line == null ? 1.5 : opts.line,
  });
  // Jaw shadow where the head overhangs the throat.
  if (opts.shade !== false) {
    ctx.beginPath();
    ctx.ellipse(hx - r * 0.05, hy + r * 0.66, r * 0.42, r * 0.22, 0, 0, Math.PI * 2);
    fillToneDevice(ctx, 0.5, 3);
  }
}

/** Head: skull mass with a tapering jaw. Face is drawn separately. */
export function drawHead(ctx, rig, p, opts = {}) {
  const [hx, hy] = rig.headC;
  const r = p.headR;
  const pts = [
    [hx - r * 0.92, hy - r * 0.5],
    [hx - r * 0.3, hy - r * 1.06],
    [hx + r * 0.55, hy - r * 0.98],
    [hx + r * 0.98, hy - r * 0.2],
    [hx + r * 0.82, hy + r * 0.6],
    [hx + r * 0.22, hy + r * 1.1],
    [hx - r * 0.52, hy + r * 0.66],
  ];
  shape(ctx, pts, {
    fill: opts.fill || PAL.paperLit,
    line: opts.line == null ? 1.8 : opts.line,
    tension: 0.5,
    shade: opts.shade == null ? 0.34 : opts.shade,
    seed: opts.seed || 31,
    gap: 3.4,
    hatchWeight: 0.85,
    contrast: 1.3,
  });
  return pts;
}

/* ---------------------------------------------------------- */
/* Faces                                                       */
/* ---------------------------------------------------------- */

/** Sharp shonen-heroine eyes: a heavy upper lid, a light lower. */
export function faceHero(ctx, rig, p, opts = {}) {
  const [hx, hy] = rig.headC;
  const r = p.headR;
  const eyeY = hy + r * 0.05;
  const glare = opts.glare || 0;

  for (let i = 0; i < 2; i++) {
    const ex = hx + (i === 0 ? r * 0.16 : r * 0.62);
    const ew = r * 0.26;
    // Upper lid — thick, angled, angry.
    brush(ctx, [
      [ex - ew, eyeY - r * 0.02 + glare * 0.05 * r],
      [ex, eyeY - r * 0.13],
      [ex + ew, eyeY - r * 0.06],
    ], { width: r * 0.11, taper: "both", jitter: 0.1, seed: 3 + i, colour: PAL.ink });
    // Iris.
    ctx.beginPath();
    ctx.ellipse(ex + ew * 0.05, eyeY + r * 0.05, ew * 0.42, ew * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = PAL.ink;
    ctx.fill();
    // Catchlight.
    ctx.beginPath();
    ctx.arc(ex + ew * 0.2, eyeY, ew * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = PAL.paperLit;
    ctx.fill();
    // Brow.
    brush(ctx, [
      [ex - ew * 1.05, eyeY - r * 0.34 + i * r * 0.02],
      [ex + ew * 0.9, eyeY - r * 0.44 - i * r * 0.02],
    ], { width: r * 0.075, taper: "end", jitter: 0.1, seed: 11 + i, colour: PAL.ink });
  }

  // Nose + mouth: two economical flicks.
  brush(ctx, [[hx + r * 0.62, hy + r * 0.28], [hx + r * 0.46, hy + r * 0.46]],
    { width: r * 0.06, taper: "both", jitter: 0.1, seed: 21, colour: PAL.ink });
  brush(ctx, [[hx + r * 0.2, hy + r * 0.68], [hx + r * 0.56, hy + r * 0.64]],
    { width: r * 0.07, taper: "both", jitter: 0.1, seed: 23, colour: PAL.ink });

  // Socket shadow: a wedge of hatching under the brow. This is what
  // makes a face read as grim rather than merely drawn.
  ctx.beginPath();
  ctx.moveTo(hx - r * 0.08, hy - r * 0.34);
  ctx.lineTo(hx + r * 0.92, hy - r * 0.28);
  ctx.lineTo(hx + r * 0.86, hy + r * 0.14);
  ctx.lineTo(hx - r * 0.04, hy + r * 0.1);
  ctx.closePath();
  hatchShade(ctx, { dark: 0.5, seed: 27, gap: 2.4, weight: 0.9, light: LIGHT });

  // Cheek hollow.
  brush(ctx, [[hx + r * 0.86, hy + r * 0.2], [hx + r * 0.7, hy + r * 0.6]],
    { width: r * 0.045, taper: "both", jitter: 0.3, seed: 29, colour: PAL.ink });

  if (opts.scar) {
    brush(ctx, [[hx + r * 0.1, hy - r * 0.62], [hx + r * 0.3, hy + r * 0.24]],
      { width: r * 0.06, taper: "both", jitter: 0.2, seed: 33, colour: PAL.ink });
    for (let i = 0; i < 3; i++) {
      const t = 0.2 + i * 0.3;
      brush(ctx, [
        [hx + r * (0.1 + 0.2 * t) - r * 0.07, hy + r * (-0.62 + 0.86 * t)],
        [hx + r * (0.1 + 0.2 * t) + r * 0.07, hy + r * (-0.62 + 0.86 * t)],
      ], { width: r * 0.03, taper: "both", jitter: 0.2, seed: 34 + i, colour: PAL.ink });
    }
  }
}

/** Hollow-socket yokai face: black pits, pin pupils, split grin. */
export function faceYokai(ctx, rig, p, opts = {}) {
  const [hx, hy] = rig.headC;
  const r = p.headR;
  const grin = opts.grin == null ? 1 : opts.grin;

  for (let i = 0; i < 2; i++) {
    const ex = hx + (i === 0 ? r * 0.12 : r * 0.62);
    ctx.beginPath();
    ctx.ellipse(ex, hy + r * 0.02, r * 0.24, r * 0.3, 0.1, 0, Math.PI * 2);
    ctx.fillStyle = PAL.ink;
    ctx.fill();
    if (opts.pupils !== false) {
      ctx.beginPath();
      ctx.arc(ex + r * 0.05, hy + r * 0.02, r * 0.075, 0, Math.PI * 2);
      ctx.fillStyle = PAL.paperLit;
      ctx.fill();
    }
  }

  if (grin > 0) {
    const my = hy + r * 0.62;
    const mw = r * 0.52 * grin;
    ctx.beginPath();
    ctx.moveTo(hx + r * 0.1, my);
    ctx.quadraticCurveTo(hx + r * 0.4, my + r * 0.42 * grin, hx + r * 0.1 + mw, my - r * 0.06);
    ctx.quadraticCurveTo(hx + r * 0.4, my + r * 0.12, hx + r * 0.1, my);
    ctx.closePath();
    ctx.fillStyle = PAL.ink;
    ctx.fill();
    // Teeth.
    ctx.strokeStyle = PAL.paperLit;
    ctx.lineWidth = Math.max(0.6, r * 0.05);
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      ctx.beginPath();
      ctx.moveTo(hx + r * 0.1 + mw * t, my + r * 0.02);
      ctx.lineTo(hx + r * 0.1 + mw * t, my + r * 0.22 * grin);
      ctx.stroke();
    }
  }
}

/* ---------------------------------------------------------- */
/* Garments                                                    */
/* ---------------------------------------------------------- */

/**
 * A long coat: solid ink mass from the shoulders down, split at
 * the front, with tails that flare on the wind vector.
 */
export function drawCoat(ctx, rig, p, opts = {}) {
  const { neck, hip } = rig;
  const wind = opts.wind == null ? 0 : opts.wind;
  const len = opts.len == null ? p.coatLen : opts.len;
  const w = p.torsoW;
  const flare = opts.flare == null ? 1 : opts.flare;

  const hemY = hip[1] + len;
  const back = [
    [neck[0] - w * 0.58, neck[1] + 1],
    [neck[0] - w * 0.72, neck[1] + p.h * 0.1],
    [hip[0] - w * 0.66 - wind * 0.4, hip[1] + len * 0.45],
    [hip[0] - w * 0.86 - wind * 1.5 * flare, hemY + Math.sin(wind * 0.6) * 2],
    [hip[0] - w * 0.1 - wind * 0.9 * flare, hemY + len * 0.16],
    [hip[0] + w * 0.56 - wind * 0.35 * flare, hemY - len * 0.04],
    [hip[0] + w * 0.66, hip[1] + len * 0.35],
    [neck[0] + w * 0.58, neck[1] + p.h * 0.08],
    [neck[0] + w * 0.46, neck[1] + 1],
  ];
  shape(ctx, back, { fill: opts.fill || PAL.ink, line: 2, tension: 0.44 });

  // The chest stays open so the pale shirt breaks up the black mass.
  // Without this the whole torso reads as one silhouette and the
  // character stops having a body.
  if (opts.open !== false) {
    shape(ctx, [
      [neck[0] - w * 0.02, neck[1] + 3],
      [neck[0] + w * 0.34, neck[1] + 2],
      [hip[0] + w * 0.18, hip[1] - 2],
      [hip[0] - w * 0.16, hip[1] - 1],
    ], { fill: opts.shirt || PAL.paperLit, line: 1.6, tension: 0.35 });
  }

  // Inner lining flashes white where the coat opens.
  if (opts.lining !== false) {
    shape(ctx, [
      [hip[0] - w * 0.2, hip[1] + len * 0.1],
      [hip[0] - w * 0.6 - wind * 1.2 * flare, hemY - len * 0.06],
      [hip[0] - w * 0.16 - wind * 0.7 * flare, hemY + len * 0.1],
      [hip[0] + w * 0.12, hip[1] + len * 0.42],
    ], { fill: PAL.paperLit, line: 1.5, tension: 0.4 });
  }

  // Highlight streaks down the black mass.
  gloss(ctx, [
    [neck[0] - w * 0.3, neck[1] + p.h * 0.05],
    [hip[0] - w * 0.36, hip[1] + len * 0.3],
    [hip[0] - w * 0.5 - wind * 0.8, hemY - len * 0.12],
  ], Math.max(0.6, w * 0.055));
  gloss(ctx, [
    [neck[0] + w * 0.36, neck[1] + p.h * 0.06],
    [hip[0] + w * 0.42, hip[1] + len * 0.3],
  ], Math.max(0.5, w * 0.04));
}

/** Tattered rags: a ragged-hem shift used by the lesser yokai. */
export function drawRags(ctx, rig, p, opts = {}) {
  const { neck, hip } = rig;
  const w = p.torsoW;
  const len = opts.len == null ? p.h * 0.3 : opts.len;
  const wind = opts.wind || 0;
  const seed = opts.seed || 5;
  const hemY = hip[1] + len;

  const pts = [
    [neck[0] - w * 0.56, neck[1] + 2],
    [neck[0] + w * 0.5, neck[1] + 2],
    [hip[0] + w * 0.6, hip[1] + len * 0.4],
  ];
  // Ragged hem: alternating deep notches.
  const teeth = 7;
  for (let i = 0; i <= teeth; i++) {
    const t = i / teeth;
    const x = lerp(hip[0] + w * 0.62, hip[0] - w * 0.66, t) - wind * t * 1.2;
    const deep = (i % 2 === 0 ? 1 : 0.42) + wobble(i * 2.7, seed) * 0.3;
    pts.push([x, lerp(hip[1] + len * 0.42, hemY, deep)]);
  }
  pts.push([hip[0] - w * 0.66, hip[1] + len * 0.3]);

  shape(ctx, pts, { fill: opts.fill || PAL.paperLit, line: 1.8, tension: 0.25 });

  // Grime tone on the lower half of the cloth.
  toneRegion(ctx, (c) => smoothPath(c, pts, true, 0.25),
    [hip[0] - w * 1.2, hip[1] - 2, w * 2.6, len + 6], opts.tone == null ? 0.34 : opts.tone, 4);
}

/**
 * Long flowing hair, in two passes.
 *
 * The split is not cosmetic. Hair drawn in one pass sits on top of
 * the face and the character loses their eyes — which, at 90px
 * tall, means they lose all personality. So the streaming mass is
 * drawn BEFORE the head and only the cap and a few brow-length
 * bangs are drawn after it.
 *
 *   drawHairBack(...)   -> then drawHead / face -> drawHairFront(...)
 */
/**
 * Long hair as a SOLID MASS with a saw-tooth trailing edge.
 *
 * Drawing long hair as N independent locks produces a spiky fan
 * that reads as a feathered headdress, not hair. Real manga hair
 * is one big black shape whose silhouette is broken only at the
 * tips. So: one filled ribbon from the scalp along a stream
 * direction, tapering, with pointed tips cut into the trailing
 * edge and a couple of gloss streaks over the top.
 */
export function hairMass(ctx, hx, hy, r, opts = {}) {
  const dir = opts.dir == null ? Math.PI * 0.86 : opts.dir;
  const len = opts.len == null ? r * 4 : opts.len;
  const curl = opts.curl == null ? 0.5 : opts.curl;
  const wave = opts.wave == null ? 0.5 : opts.wave;
  const phase = opts.phase || 0;
  const seed = opts.seed || 4;
  const tips = opts.tips == null ? 4 : opts.tips;
  const colour = opts.colour || PAL.ink;

  // Spine: from just behind the crown, streaming away and falling.
  // Canvas angles have +y downward, so a NEGATIVE curl is what makes
  // hair swing back and then hang. A positive one splays it outward
  // into a shape that reads as a shop awning, not hair.
  const steps = 12;
  const spine = [];
  let a = dir;
  let x = hx - r * (opts.rootX == null ? 0.45 : opts.rootX);
  let y = hy - r * (opts.rootY == null ? 0.3 : opts.rootY);
  for (let i = 0; i <= steps; i++) {
    spine.push([x, y]);
    a += curl / steps + Math.sin(i * 0.9 + phase) * (wave / steps);
    x += Math.cos(a) * (len / steps);
    y += Math.sin(a) * (len / steps);
  }

  const widthAt = (t) => r * (1.02 - 0.62 * t * t) * (opts.thick == null ? 1 : opts.thick);

  const normalAt = (i) => {
    const p0 = spine[Math.max(0, i - 1)];
    const p1 = spine[Math.min(steps, i + 1)];
    const dx = p1[0] - p0[0]; const dy = p1[1] - p0[1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  };

  // Leading edge (the side against the head/back).
  const outline = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [nx, ny] = normalAt(i);
    const w = widthAt(t);
    outline.push([spine[i][0] + nx * w, spine[i][1] + ny * w]);
  }
  // Trailing edge, walked back with pointed tips cut into it.
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const [nx, ny] = normalAt(i);
    const w = widthAt(t);
    // Saw-tooth: alternate between the full width and a notch, with
    // enough jitter that the teeth do not march in lockstep.
    const seg = Math.floor((1 - t) * tips * 2);
    const notch = seg % 2 === 0
      ? 0.94 + Math.abs(wobble(i * 1.7, seed + 2)) * 0.2
      : 0.58 + Math.abs(wobble(i * 2.3, seed)) * 0.26;
    outline.push([spine[i][0] - nx * w * notch, spine[i][1] - ny * w * notch]);
  }

  shape(ctx, outline, { fill: colour, line: opts.line == null ? 1.7 : opts.line, tension: 0.34 });

  // Gloss: two streaks riding the mass, offset to the lit side.
  if (opts.gloss !== false && colour === PAL.ink) {
    for (let s = 0; s < 2; s++) {
      const off = (s === 0 ? 0.38 : -0.1);
      const from = s === 0 ? 1 : 3;
      const to = s === 0 ? Math.floor(steps * 0.62) : Math.floor(steps * 0.44);
      const streak = [];
      for (let i = from; i <= to; i++) {
        const t = i / steps;
        const [nx, ny] = normalAt(i);
        const w = widthAt(t) * off;
        streak.push([spine[i][0] + nx * w, spine[i][1] + ny * w]);
      }
      if (streak.length > 1) {
        gloss(ctx, streak, r * (s === 0 ? 0.12 : 0.075));
      }
    }
  }
  return spine;
}

export function drawHairBack(ctx, rig, p, opts = {}) {
  const [hx, hy] = rig.headC;
  const r = p.headR;
  const wind = opts.wind == null ? 0 : opts.wind;
  const len = opts.len == null ? p.h * 0.3 : opts.len;
  const seed = opts.seed || 9;

  // Main mass: sweeps back off the crown, then falls past the shoulder.
  hairMass(ctx, hx, hy, r, {
    dir: Math.PI * (0.80 - wind * 0.012),
    len,
    curl: -0.72 - wind * 0.03,
    wave: 0.34,
    phase: opts.phase || 0,
    seed,
    tips: opts.tips == null ? 4 : opts.tips,
    thick: opts.thick == null ? 1 : opts.thick,
  });

  // A lighter secondary strand catching the wind, for movement.
  if (opts.strand !== false) {
    lock(ctx, hx - r * 0.5, hy - r * 0.6,
      Math.PI * (0.9 - wind * 0.018), len * 0.66, r * 0.19, {
        curve: -0.45, wave: 0.8, phase: (opts.phase || 0) + 1.7,
        seed: seed + 17, glossFrom: 0.1, glossTo: 0.5,
      });
  }
}

export function drawHairFront(ctx, rig, p, opts = {}) {
  const [hx, hy] = rig.headC;
  const r = p.headR;
  const seed = opts.seed || 9;

  // Skull cap: solid ink from the crown down to the brow line only.
  const cap = [
    [hx - r * 1.02, hy + r * 0.05],
    [hx - r * 0.9, hy - r * 0.82],
    [hx - r * 0.05, hy - r * 1.24],
    [hx + r * 0.8, hy - r * 0.94],
    [hx + r * 1.06, hy - r * 0.3],
    [hx + r * 0.82, hy - r * 0.46],
    [hx + r * 0.26, hy - r * 0.72],
    [hx - r * 0.34, hy - r * 0.6],
    [hx - r * 0.74, hy + r * 0.2],
  ];
  shape(ctx, cap, { fill: PAL.ink, line: 1.6, tension: 0.44 });

  // Bangs: short wedges that stop above the eyes.
  // Bangs: uneven in length and spacing. Evenly spaced equal-length
  // wedges read as a fringe of teeth, not hair.
  const bangs = opts.bangs == null ? 4 : opts.bangs;
  for (let i = 0; i < bangs; i++) {
    const t = i / Math.max(1, bangs - 1);
    const skew = wobble(i * 5.3, seed + 11) * 0.22;
    const bx = lerp(hx - r * 0.66, hx + r * 0.88, t + skew * 0.4);
    const by = hy - r * 0.88 + t * r * 0.24;
    const a = lerp(Math.PI * 0.7, Math.PI * 0.26, t) + skew;
    lock(ctx, bx, by, a, r * (0.5 + Math.abs(wobble(i * 2.2, seed)) * 0.7), r * (0.13 + t * 0.07), {
      curve: 0.28, seed: seed + 30 + i, glossFrom: 0.05, glossTo: 0.5, glossWidth: 0.16,
    });
  }

  // A sidelock in front of the ear — reads as depth around the jaw.
  lock(ctx, hx - r * 0.86, hy - r * 0.35, Math.PI * 0.46, r * 1.5, r * 0.16,
    { curve: 0.1, seed: seed + 61, glossFrom: 0.1, glossTo: 0.6, glossWidth: 0.2 });

  // Crown highlight — the single sweep that says "glossy black hair".
  gloss(ctx, [
    [hx - r * 0.62, hy - r * 0.6],
    [hx + r * 0.05, hy - r * 0.98],
    [hx + r * 0.68, hy - r * 0.7],
  ], r * 0.085);
}

/** Legacy one-shot wrapper (back + front) for figures with no face. */
export function drawHair(ctx, rig, p, opts = {}) {
  drawHairBack(ctx, rig, p, opts);
  drawHairFront(ctx, rig, p, opts);
}

/* ---------------------------------------------------------- */
/* Post passes                                                 */
/* ---------------------------------------------------------- */

/**
 * Screentone the lower-left of a figure by clipping to whatever
 * is already drawn (alpha as the mask) — the cheap, reliable way
 * to get form shadow on an arbitrary silhouette.
 */
export function formShadow(ctx, opts = {}) {
  deviceSpace(ctx, (g) => {
    const w = g.canvas.width;
    const h = g.canvas.height;
    g.globalCompositeOperation = "source-atop";
    const level = opts.level == null ? 0.4 : opts.level;
    g.fillStyle = tone(g, level, opts.cell || 3.4);
    const dir = opts.dir || [-1, 0.55];
    // A rotated half-plane: everything on the far side of the light
    // direction picks up one step of tone.
    g.translate(w * (opts.px == null ? 0.5 : opts.px), h * (opts.py == null ? 0.52 : opts.py));
    g.rotate(Math.atan2(dir[1], dir[0]));
    const big = Math.hypot(w, h);
    g.beginPath();
    g.moveTo(-big, -big);
    g.lineTo(big, -big);
    g.lineTo(big, 0);
    g.lineTo(-big, 0);
    g.closePath();
    g.fill();
  });
}

/** Rim light: a bright sliver along one edge, drawn as a mask cut. */
export function rimLight(ctx, opts = {}) {
  deviceSpace(ctx, (g) => {
    const w = g.canvas.width;
    const h = g.canvas.height;
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = opts.colour || "rgba(255,253,246,0.55)";
    g.translate(w * 0.5, h * 0.5);
    g.rotate(opts.angle == null ? -0.7 : opts.angle);
    g.fillRect(-w, -h, w * 2, h * (opts.thickness || 0.06));
  });
}

/**
 * Solid-silhouette variant of a baked frame, used for hit flashes
 * and for the "boss enters" black-fill dramatics.
 */
export function silhouetteOf(canvas, colour) {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  const g = c.getContext("2d");
  g.drawImage(canvas, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = colour;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Grime pass: a few ink flecks scattered over the figure. */
export function grime(ctx, seed, count = 10, colour = PAL.ink) {
  deviceSpace(ctx, (g) => {
    const w = g.canvas.width;
    const h = g.canvas.height;
    const rand = rng(seed);
    g.globalCompositeOperation = "source-atop";
    for (let i = 0; i < count; i++) {
      splat(g, rand() * w, h * (0.25 + rand() * 0.75), 1.4 + rand() * 3.2, {
        seed: seed + i, colour, drops: 2, rough: 0.7,
      });
    }
  });
}
