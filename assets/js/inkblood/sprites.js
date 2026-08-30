/* ============================================================
   INKBLOOD — sprites.js
   The cast, drawn once at boot into offscreen canvases.

   Every character is inked from the figure.js primitives, baked
   at 2x supersample, and blitted at runtime. Baking rather than
   drawing live is what lets several hundred yokai share a screen
   at 60fps while still being real line art.

   Sprite record:
     { canvas, ox, oy, w, h }   ox/oy = anchor in canvas pixels,
                                positioned at the character's feet.
   ============================================================ */

"use strict";

import {
  PAL, makeCanvas, ctxOf, brush, tone, splat, rng, wobble, starburst, roughCircle,
  hatchShade, stippleShade, inkContour, feather,
} from "./art.js?v=20260803-2";
import {
  shape, limb, lock, gloss, buildRig, runPose, idlePose, drawLeg, drawArm, drawTorso,
  drawHead, drawNeck, drawCoat, drawRags, drawHairBack, drawHairFront, hairMass,
  faceHero, faceYokai, formShadow, rimLight, silhouetteOf, grime, smoothPath, lerp,
  toneRegion, TONE, folds, LIGHT,
} from "./figure.js?v=20260803-2";

/** World pixels per figure unit, and the supersample factor. */
export const PX_PER_UNIT = 1.15;
const SS = 2;
const BAKE = PX_PER_UNIT * SS;

/* ---------------------------------------------------------- */
/* Baking helper                                               */
/* ---------------------------------------------------------- */

/**
 * Render `drawFn` in figure units (origin at the character's feet,
 * -y is up, +x is the facing direction) into a fresh canvas.
 *
 * `box` = [left, top, right, bottom] extents in figure units
 * relative to that origin.
 */
function bake(box, drawFn, finish = {}) {
  const [l, t, r, b] = box;
  const uw = r - l;
  const uh = b - t;
  const c = makeCanvas(uw * BAKE, uh * BAKE);
  const g = ctxOf(c);
  g.save();
  g.scale(BAKE, BAKE);
  g.translate(-l, -t);
  g.lineJoin = "round";
  g.lineCap = "round";
  drawFn(g, { w: uw, h: uh, l, t });
  g.restore();

  // Post passes run in device pixels so the tone dot pitch and the
  // grime fleck size are identical on a 30px lantern and a 190px
  // skeleton. Doing these inside the figure transform is what made
  // the first bake look like a chessboard.
  if (finish.shade !== 0) {
    formShadow(g, {
      level: finish.shade == null ? 0.34 : finish.shade,
      cell: 3.4,
      dir: finish.dir || [-1, 0.5],
      px: finish.px == null ? 0.6 : finish.px,
      py: finish.py == null ? 0.5 : finish.py,
    });
  }
  if (finish.rim !== false) {
    rimLight(g, { angle: -0.62, thickness: 0.035, colour: "rgba(255,253,246,0.4)" });
  }
  if (finish.grime !== 0) grime(g, finish.seed || 7, finish.grime == null ? 6 : finish.grime);

  return {
    canvas: c,
    ox: -l * BAKE,
    oy: -t * BAKE,
    w: c.width / SS,
    h: c.height / SS,
  };
}

/** Flash + silhouette variants derived from a baked frame. */
function variants(frame) {
  return {
    flash: silhouetteOf(frame.canvas, PAL.paperLit),
    ink: silhouetteOf(frame.canvas, PAL.ink),
  };
}

/* ---------------------------------------------------------- */
/* Proportions                                                 */
/* ---------------------------------------------------------- */

const HERO_P = {
  h: 100, hip: 47, chest: 68, shoulder: 79, head: 91, headR: 9.4,
  hipW: 10, shoulderW: 18, shoulderDrop: 2, torsoW: 19,
  chestFwd: 0.6, neckFwd: 0.4, headFwd: 1.4,
  thigh: 23, shin: 22, thighW: 5.0, kneeW: 4.0, ankleW: 3.2, foot: 8,
  upperArm: 18, foreArm: 16.5, upperArmW: 4.2, elbowW: 3.4, wristW: 2.7,
  coatLen: 17,
};

function scaleP(base, k, over = {}) {
  const out = {};
  for (const key of Object.keys(base)) out[key] = base[key] * k;
  return { ...out, ...over };
}

/* ---------------------------------------------------------- */
/* The hero — 血墨の剣士, the Inkblood swordsman                */
/* ---------------------------------------------------------- */

function drawHero(g, pose, opts = {}) {
  const p = HERO_P;
  const rig = buildRig(p, pose);
  const wind = opts.wind == null ? 3 : opts.wind;
  const seed = 900;
  const slashing = Number.isFinite(opts.slashAngle);

  // 0. The slab sword, slung across the back. Drawn first so the
  //    body overlaps it: it reads as a diagonal behind the shoulders
  //    rather than a plank stuck to the hip.
  if (!slashing) drawGreatsword(g, rig, p, opts);

  // 1. Hair, then the cape's wind-caught tails.
  drawHairBack(g, rig, p, {
    wind, phase: opts.phase || 0, len: p.h * 0.26, seed: 9, tips: 5, thick: 0.9,
  });

  // 2. Far arm — deep in shadow so it recedes behind the near one.
  drawArm(g, rig.arms[1], p, {
    fill: PAL.paperLit, foreFill: PAL.paperLit, handFill: PAL.paperLit,
    line: 1.4, shade: 0.8, seed: seed + 3,
  });

  // 3. Legs. Trousers stay PALE and hatched; only the boot is solid.
  //    Black trousers under a black cape erase the legs completely.
  for (const idx of [1, 0]) {
    const leg = rig.legs[idx];
    const far = idx === 1;
    limb(g, leg.hip[0], leg.hip[1], leg.knee[0], leg.knee[1],
      p.thighW * 1.12, p.kneeW * 1.05, {
        fill: PAL.paperLit, line: far ? 1.4 : 1.9,
        shade: far ? 0.66 : 0.42, seed: seed + 10 + idx, contrast: 1.2,
      });
    limb(g, leg.knee[0], leg.knee[1], leg.ankle[0], leg.ankle[1],
      p.kneeW * 1.05, p.ankleW * 1.1, {
        fill: PAL.paperLit, line: far ? 1.4 : 1.9,
        shade: far ? 0.66 : 0.44, seed: seed + 14 + idx, contrast: 1.2,
      });
    folds(g, leg.hip[0], leg.hip[1] + 3, Math.PI * 0.5 + (idx ? 0.18 : -0.14), 3,
      Math.abs(leg.knee[1] - leg.hip[1]) * 0.85, 0.7,
      { seed: seed + 40 + idx * 7, width: 0.9 });

    // Boot: solid ink, only from mid-shin down.
    const bt = 0.52;
    const bx = lerp(leg.knee[0], leg.ankle[0], bt);
    const by = lerp(leg.knee[1], leg.ankle[1], bt);
    shape(g, [
      [bx - p.ankleW * 1.7, by],
      [bx + p.ankleW * 1.7, by - 1],
      [leg.ankle[0] + p.ankleW * 1.45, leg.ankle[1] - 3],
      [leg.ankle[0] + p.foot * 1.05, leg.ankle[1] + 1.5],
      [leg.ankle[0] - p.foot * 0.5, leg.ankle[1] + 1.5],
      [leg.ankle[0] - p.ankleW * 1.6, leg.ankle[1] - 4],
    ], { fill: PAL.ink, line: far ? 1.5 : 2, tension: 0.3, seed: seed + 20 + idx });
    // Buckle strap, pale, across the black.
    brush(g, [[bx - p.ankleW * 1.5, by + 3], [bx + p.ankleW * 1.5, by + 2]],
      { width: 0.55, taper: "both", jitter: 0.2, seed: seed + 30 + idx, colour: PAL.paperLit });
  }

  // 4. Torso — wrapped chest, pale, banded.
  drawTorso(g, rig, p, { fill: PAL.paperLit, shade: 0.4, seed: seed + 50, line: 1.9 });
  for (let i = 0; i < 5; i++) {
    const y = rig.chest[1] + 1 + i * 4.4;
    const wob = wobble(i * 2.1, 4) * 1.4;
    brush(g, [
      [rig.chest[0] - p.torsoW * 0.44, y + wob],
      [rig.chest[0], y + wob + 1.2],
      [rig.chest[0] + p.torsoW * 0.44, y - 0.6 + wob],
    ], { width: 0.42, taper: "both", jitter: 0.3, seed: 60 + i, colour: PAL.ink });
  }
  // Cross-strap over the chest — a hard diagonal to break the pale.
  shape(g, [
    [rig.neck[0] - p.torsoW * 0.42, rig.neck[1] + 5],
    [rig.neck[0] - p.torsoW * 0.2, rig.neck[1] + 4],
    [rig.hip[0] + p.torsoW * 0.34, rig.hip[1] - 8],
    [rig.hip[0] + p.torsoW * 0.14, rig.hip[1] - 7],
  ], { fill: PAL.ink, line: 1.4, tension: 0.1, seed: seed + 55 });

  // 5. The cape: shoulder-hung, mid-thigh, ragged. Narrower than a
  //    full coat so the body underneath still reads.
  drawCape(g, rig, p, wind, seed);

  // High collar swallowing the jaw.
  shape(g, [
    [rig.neck[0] - p.torsoW * 0.58, rig.neck[1] + 3],
    [rig.neck[0] - p.torsoW * 0.46, rig.neck[1] - 8],
    [rig.neck[0] - p.torsoW * 0.08, rig.neck[1] - 11],
    [rig.neck[0] + p.torsoW * 0.42, rig.neck[1] - 7],
    [rig.neck[0] + p.torsoW * 0.52, rig.neck[1] + 4],
    [rig.neck[0] + p.torsoW * 0.18, rig.neck[1] + 8],
    [rig.neck[0] - p.torsoW * 0.28, rig.neck[1] + 8],
  ], { fill: PAL.ink, line: 2, tension: 0.36, seed: seed + 70 });

  // Belt.
  shape(g, [
    [rig.hip[0] - p.torsoW * 0.5, rig.hip[1] - 9],
    [rig.hip[0] + p.torsoW * 0.5, rig.hip[1] - 10],
    [rig.hip[0] + p.torsoW * 0.48, rig.hip[1] - 3],
    [rig.hip[0] - p.torsoW * 0.52, rig.hip[1] - 2],
  ], { fill: PAL.paperLit, line: 1.7, tension: 0.12, shade: 0.55, seed: seed + 80 });
  shape(g, [
    [rig.hip[0] - 3, rig.hip[1] - 10], [rig.hip[0] + 3, rig.hip[1] - 10],
    [rig.hip[0] + 3, rig.hip[1] - 3], [rig.hip[0] - 3, rig.hip[1] - 3],
  ], { fill: PAL.ink, line: 1.2, tension: 0.05, seed: seed + 82 });

  // 6. Near arm: bare, wrapped forearm, over the cape.
  drawArm(g, rig.arms[0], p, {
    fill: PAL.paperLit, foreFill: PAL.paperLit, handFill: PAL.paperLit,
    line: 2, shade: 0.44, seed: seed + 90,
  });
  {
    const a = rig.arms[0];
    for (let i = 0; i < 4; i++) {
      const t = 0.2 + i * 0.2;
      const bx = lerp(a.elbow[0], a.wrist[0], t);
      const by = lerp(a.elbow[1], a.wrist[1], t);
      brush(g, [[bx - p.elbowW * 1.25, by - 0.7], [bx + p.elbowW * 1.25, by + 0.7]],
        { width: 0.45, taper: "both", jitter: 0.25, seed: seed + 100 + i, colour: PAL.ink });
    }
    // Pauldron: one hard black shape on the shoulder.
    shape(g, [
      [a.sh[0] - p.upperArmW * 1.6, a.sh[1] - 2],
      [a.sh[0] + p.upperArmW * 1.3, a.sh[1] - 4],
      [a.sh[0] + p.upperArmW * 1.75, a.sh[1] + 6],
      [a.sh[0] - p.upperArmW * 1.4, a.sh[1] + 8],
    ], { fill: PAL.ink, line: 2, tension: 0.3, seed: seed + 110 });
  }

  // 7. Neck, head, face, THEN the front hair. Order is load-bearing:
  //    hair drawn before the face erases the character's eyes.
  drawNeck(g, rig, p, { fill: PAL.paperLit, shade: 0.7 });
  drawHead(g, rig, p, { fill: PAL.paperLit, shade: 0.36, seed: seed + 120 });
  faceHero(g, rig, p, { glare: opts.glare || 0, scar: true });
  drawHairFront(g, rig, p, { bangs: 5 });

  // During the attack the sword leaves its back scabbard and crosses
  // the whole silhouette. Drawing it last keeps the blade readable
  // over the cape and makes the weapon motion unmistakable at game size.
  if (slashing) drawHeldGreatsword(g, rig, p, opts.slashAngle, opts.slashProgress || 0);
}

/**
 * The greatsword: a raw slab with no fuller and barely a point, so
 * the read is mass rather than elegance. Hatched mid-value with one
 * white lit edge — a solid-white blade at this size becomes the
 * brightest thing on screen and steals the figure.
 */
function drawGreatsword(g, rig, p, opts = {}) {
  const a = -Math.PI * 0.5 - 0.3;
  const ox = rig.neck[0] - p.torsoW * 0.28;
  const oy = rig.neck[1] + 14;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const nx = -sa;
  const ny = ca;
  const L = 74;
  const W = 5.2;
  const at = (d, side) => [ox + ca * d + nx * side, oy + sa * d + ny * side];

  shape(g, [
    at(10, -W * 0.8), at(L * 0.55, -W), at(L - 7, -W * 0.9),
    at(L, -W * 0.05), at(L - 9, W * 0.94),
    at(L * 0.55, W), at(10, W * 0.82),
  ], {
    fill: PAL.paperLit, line: 2.2, tension: 0.16,
    shade: 0.6, seed: 700, contrast: 1.4, gap: 4.6, hatchWeight: 0.85,
  });
  brush(g, [at(16, -W * 0.5), at(L * 0.6, -W * 0.6), at(L - 12, -W * 0.55)],
    { width: 0.7, taper: "both", jitter: 0.12, seed: 701, colour: PAL.paperLit });

  const rand = rng(7011);
  for (let i = 0; i < 4; i++) {
    const d = 20 + rand() * (L - 40);
    const side = rand() < 0.5 ? -1 : 1;
    brush(g, [at(d, side * W), at(d + 2 + rand() * 3, side * W * 0.5)],
      { width: 0.5, taper: "end", jitter: 0.2, seed: 702 + i, colour: PAL.ink });
  }

  // Guard: a short straight bar, not a starburst.
  shape(g, [
    at(6, -W * 1.7), at(11, -W * 1.5), at(11, W * 1.5), at(6, W * 1.7),
  ], { fill: PAL.ink, line: 1.6, tension: 0.04, seed: 703 });
  brush(g, [at(6, 0), at(-13, 0)], { width: 1.3, taper: "none", jitter: 0.1, seed: 704, colour: PAL.ink });
  const pom = at(-16, 0);
  g.beginPath();
  g.arc(pom[0], pom[1], 2.6, 0, Math.PI * 2);
  g.fillStyle = PAL.ink;
  g.fill();
}

/** The same slab sword, now gripped in both hands during the attack. */
function drawHeldGreatsword(g, rig, p, angle, progress) {
  const near = rig.arms[0].wrist;
  const far = rig.arms[1].wrist;
  const ox = (near[0] + far[0]) * 0.5;
  const oy = (near[1] + far[1]) * 0.5;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const nx = -sa;
  const ny = ca;
  const L = 78;
  const W = 5.4;
  const at = (d, side) => [ox + ca * d + nx * side, oy + sa * d + ny * side];

  // Blade: broad enough to read at normal gameplay scale, with a
  // slightly hooked point and the same hatched steel as the back pose.
  shape(g, [
    at(3, -W * 0.82), at(L * 0.55, -W), at(L - 8, -W * 0.86),
    at(L, -W * 0.05), at(L - 9, W * 0.92),
    at(L * 0.54, W), at(3, W * 0.82),
  ], {
    fill: PAL.paperLit, line: 2.3, tension: 0.14,
    shade: 0.58, seed: 780 + Math.round(progress * 7), contrast: 1.45,
    gap: 4.4, hatchWeight: 0.88,
  });
  brush(g, [at(8, -W * 0.52), at(L * 0.6, -W * 0.6), at(L - 12, -W * 0.5)],
    { width: 0.72, taper: "both", jitter: 0.1, seed: 790, colour: PAL.paperLit });

  // Guard, wrapped handle, and two pale gripping hands. The hand
  // marks are deliberately oversized by a fraction so they survive
  // the 2x-to-1x sprite downsample.
  shape(g, [at(-1, -W * 1.75), at(4, -W * 1.55), at(4, W * 1.55), at(-1, W * 1.75)],
    { fill: PAL.ink, line: 1.5, tension: 0.04, seed: 792 });
  brush(g, [at(-1, 0), at(-21, 0)],
    { width: 1.45, taper: "none", jitter: 0.08, seed: 794, colour: PAL.ink });
  for (let i = 0; i < 5; i++) {
    const d = -4 - i * 3.3;
    brush(g, [at(d, -1.8), at(d, 1.8)],
      { width: 0.34, taper: "both", jitter: 0.04, seed: 796 + i, colour: PAL.paperLit });
  }
  for (const d of [-6, -13]) {
    const [hx, hy] = at(d, 0);
    g.beginPath();
    g.arc(hx, hy, 2.8, 0, Math.PI * 2);
    g.fillStyle = PAL.paperLit;
    g.fill();
    g.strokeStyle = PAL.ink;
    g.lineWidth = 1.2;
    g.stroke();
  }
  const [px, py] = at(-23, 0);
  g.beginPath();
  g.arc(px, py, 2.7, 0, Math.PI * 2);
  g.fillStyle = PAL.ink;
  g.fill();
}

/**
 * Hero-only attack pose. The body plants, winds up, lunges, then
 * settles while the blade crosses from high behind to low ahead.
 */
function heroSlashPose(t) {
  const k = Math.max(0, Math.min(1, t));
  const sweep = k < 0.14 ? 0 : 1 - Math.pow(1 - ((k - 0.14) / 0.7), 3);
  const s = Math.max(0, Math.min(1, sweep));
  const recover = Math.max(0, (k - 0.84) / 0.16);
  const angle = lerp(lerp(-2.02, 0.42, s), 0.26, recover);
  const pose = {
    legA: lerp(-0.18, 0.42, s),
    legB: lerp(0.12, -0.46, s),
    kneeA: lerp(0.22, 0.38, s),
    kneeB: lerp(0.18, 0.3, s),
    armA: lerp(2.18, 0.94, s),
    armB: lerp(1.92, 0.7, s),
    elbowA: lerp(1.02, 0.24, s),
    elbowB: lerp(0.88, 0.2, s),
    bob: Math.sin(k * Math.PI) * 1.2,
    lean: lerp(-0.8, 7.2, s) - recover * 1.6,
    phase: k,
  };
  return { pose, angle };
}

/** The cape: ragged hem, heavy black, folds cut back in white. */
function drawCape(g, rig, p, wind, seed) {
  const { neck, hip } = rig;
  const w = p.torsoW;
  const len = p.coatLen;
  const hemY = hip[1] + len;

  const pts = [
    [neck[0] - w * 0.6, neck[1] - 1],
    [neck[0] - w * 0.82, neck[1] + p.h * 0.14],
    [hip[0] - w * 0.78 - wind * 0.45, hip[1] + len * 0.55],
  ];
  const teeth = 8;
  for (let i = 0; i <= teeth; i++) {
    const t = i / teeth;
    const x = lerp(hip[0] - w * 0.86 - wind * 0.9, hip[0] - w * 0.02, t);
    const deep = (i % 2 === 0 ? 1 : 0.46) + wobble(i * 2.7, seed) * 0.24;
    pts.push([x, lerp(hip[1] + len * 0.5, hemY, deep)]);
  }
  pts.push([hip[0] + w * 0.16, hip[1] + len * 0.3]);
  pts.push([neck[0] + w * 0.5, neck[1] + p.h * 0.05]);
  pts.push([neck[0] + w * 0.34, neck[1] - 2]);

  shape(g, pts, { fill: PAL.ink, line: 2.2, tension: 0.3, seed: seed + 200, rimWidth: 1.6 });

  // Fold highlights cut back INTO the black — the only way to get
  // form out of a solid silhouette.
  // Two fold highlights, not five: at sprite size any more than
  // that stops reading as cloth and starts reading as a barcode.
  for (let i = 0; i < 2; i++) {
    const t = 0.28 + i * 0.42;
    const x0 = lerp(neck[0] - w * 0.5, neck[0] + w * 0.16, t);
    const x1 = lerp(hip[0] - w * 0.66 - wind * 0.7, hip[0] - w * 0.1, t);
    gloss(g, [
      [x0, neck[1] + 8],
      [lerp(x0, x1, 0.5) + wobble(i * 3.3, seed) * 2, hip[1] - 8],
      [x1, hemY - len * (0.3 + wobble(i, seed) * 0.1)],
    ], 0.45);
  }
  // A hard black core down the deepest fold keeps the cape from
  // flattening into a single silhouette.
  brush(g, [
    [neck[0] - w * 0.22, neck[1] + 10],
    [hip[0] - w * 0.4 - wind * 0.4, hip[1] + len * 0.3],
    [hip[0] - w * 0.5 - wind * 0.7, hemY - len * 0.3],
  ], { width: 1.1, taper: "both", jitter: 0.3, seed: seed + 260, colour: PAL.ink });
}

/** Wind-caught tails behind the figure. */
function drawCloakTails(g, rig, p, wind, phase) {
  for (let i = 0; i < 3; i++) {
    lock(g, rig.hip[0] - p.torsoW * 0.3, rig.hip[1] - 6 + i * 6,
      Math.PI * (0.9 + i * 0.07), 24 + wind * 3 - i * 4, 4.4 - i * 1.1, {
        curve: 0.3 + i * 0.1, wave: 0.5, phase: phase + i * 1.9,
        seed: 600 + i, glossFrom: 0.08, glossTo: 0.6, glossWidth: 0.14,
      });
  }
}

/* ---------------------------------------------------------- */
/* Yokai                                                       */
/* ---------------------------------------------------------- */

/** A wet, staring eye: black iris, hard catchlight, lid shadow. */
function ctxEye(g, x, y, r) {
  g.beginPath();
  g.ellipse(x, y, r, r * 1.2, 0, 0, Math.PI * 2);
  g.fillStyle = PAL.ink;
  g.fill();
  g.beginPath();
  g.arc(x + r * 0.24, y - r * 0.26, r * 0.3, 0, Math.PI * 2);
  g.fillStyle = PAL.paperLit;
  g.fill();
}

/** 餓鬼 Gaki — the starving dead. Distended belly, spindle limbs. */
function drawGaki(g, pose, opts = {}) {
  const p = scaleP(HERO_P, 0.68, {
    headR: 6.4, torsoW: 13, thighW: 2.4, kneeW: 2.0, ankleW: 1.7, foot: 4.4,
    upperArmW: 2.0, elbowW: 1.6, wristW: 1.4, coatLen: 14,
  });
  const rig = buildRig(p, pose);
  const S = 400;

  drawArm(g, rig.arms[1], p, { fill: PAL.paperLit, line: 1.2, shade: 0.8, seed: S });
  drawLeg(g, rig.legs[1], p, { fill: PAL.paperLit, line: 1.2, shade: 0.74, seed: S + 2 });
  drawLeg(g, rig.legs[0], p, { fill: PAL.paperLit, line: 1.5, shade: 0.5, seed: S + 4 });

  // Ribcage over a swollen, starved belly.
  const { hip, chest, neck } = rig;
  const body = [
    [neck[0] - p.torsoW * 0.38, neck[1] + 1],
    [neck[0] + p.torsoW * 0.38, neck[1] + 1],
    [chest[0] + p.torsoW * 0.48, chest[1] + 2],
    [hip[0] + p.torsoW * 0.66, hip[1] - 5],
    [hip[0] + p.torsoW * 0.28, hip[1] + 1],
    [hip[0] - p.torsoW * 0.32, hip[1] + 1],
    [chest[0] - p.torsoW * 0.48, chest[1] + 2],
  ];
  shape(g, body, {
    fill: PAL.paperLit, line: 1.5, tension: 0.5,
    shade: 0.46, seed: S + 6, stipple: 0.1, contrast: 1.3,
  });
  // Ribs: pairs of arcs, heavier on the shadow side.
  for (let i = 0; i < 4; i++) {
    const y = chest[1] + 0.5 + i * 2.4;
    brush(g, [
      [chest[0] - p.torsoW * 0.36, y],
      [chest[0] - p.torsoW * 0.02, y + 1.3],
      [chest[0] + p.torsoW * 0.3, y - 0.3],
    ], { width: 0.3, taper: "both", jitter: 0.3, seed: S + 10 + i, colour: PAL.ink });
  }
  // Sternum hollow.
  brush(g, [[chest[0] - 1, chest[1] + 1], [chest[0] - 1.4, chest[1] + 9]],
    { width: 0.28, taper: "both", jitter: 0.4, seed: S + 20, colour: PAL.ink });

  drawRags(g, rig, p, { len: p.h * 0.19, wind: opts.wind || 2, seed: 5, tone: 0.3 });
  drawArm(g, rig.arms[0], p, { fill: PAL.paperLit, line: 1.4, shade: 0.44, seed: S + 24 });
  // Long grasping fingers on the near hand.
  {
    const w = rig.arms[0].wrist;
    for (let f = 0; f < 4; f++) {
      const a = Math.PI * 0.36 + f * 0.2;
      brush(g, [[w[0], w[1]], [w[0] + Math.cos(a) * 5.5, w[1] + Math.sin(a) * 5.5]],
        { width: 0.34, taper: "end", jitter: 0.25, seed: S + 30 + f, colour: PAL.ink });
    }
  }

  drawNeck(g, rig, p, { fill: PAL.paperLit, shade: 0.8 });
  drawHead(g, rig, p, { fill: PAL.paperLit, shade: 0.44, seed: S + 40 });
  faceYokai(g, rig, p, { grin: 0.95 });
  // Sunken temples.
  for (let i = 0; i < 2; i++) {
    brush(g, [
      [rig.headC[0] - p.headR * (0.8 - i * 1.6), rig.headC[1] - p.headR * 0.2],
      [rig.headC[0] - p.headR * (0.62 - i * 1.3), rig.headC[1] + p.headR * 0.45],
    ], { width: 0.3, taper: "both", jitter: 0.3, seed: S + 50 + i, colour: PAL.ink });
  }
  // Matted strands.
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    lock(g, rig.headC[0] - p.headR * 0.6 + t * p.headR * 1.2, rig.headC[1] - p.headR * 0.85,
      -Math.PI * 0.5 - 0.5 + t * 1.0, p.headR * (0.7 + wobble(i, 3) * 0.5), p.headR * 0.11,
      { curve: 0.5, seed: 60 + i, gloss: false });
  }
}

/** 鎌鼬 Kamaitachi — the sickle weasel. Low, fast, all forward. */
function drawKamaitachi(g, pose, opts = {}) {
  const p = scaleP(HERO_P, 0.52, {
    headR: 5.6, torsoW: 12, thighW: 2.5, kneeW: 2.0, ankleW: 1.6, foot: 4.6,
    upperArmW: 2.1, elbowW: 1.7, wristW: 1.3,
  });
  const rig = buildRig(p, { ...pose, lean: 12 });
  const S = 700;

  drawLeg(g, rig.legs[1], p, { fill: PAL.paperLit, line: 1.2, shade: 0.78, seed: S });
  drawLeg(g, rig.legs[0], p, { fill: PAL.paperLit, line: 1.4, shade: 0.55, seed: S + 2 });

  // Hunched, furred body — dark, with a pale underside.
  const { hip, neck } = rig;
  shape(g, [
    [neck[0] - p.torsoW * 0.28, neck[1] + 1],
    [neck[0] + p.torsoW * 0.55, neck[1] + 3],
    [hip[0] + p.torsoW * 0.5, hip[1] - 1],
    [hip[0] - p.torsoW * 0.6, hip[1] + 2],
    [hip[0] - p.torsoW * 0.38, neck[1] + p.h * 0.09],
  ], { fill: PAL.ink, line: 1.7, tension: 0.46, seed: S + 4 });
  // Fur: short flicks along the spine, cut in white.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const x = lerp(neck[0] - p.torsoW * 0.2, hip[0] - p.torsoW * 0.5, t);
    const y = lerp(neck[1] + 2, hip[1] + 1, t);
    brush(g, [[x, y], [x - 2.4, y - 2.6]],
      { width: 0.3, taper: "end", jitter: 0.3, seed: S + 10 + i, colour: PAL.paperLit });
  }
  gloss(g, [[neck[0] - p.torsoW * 0.02, neck[1] + 5], [hip[0] + p.torsoW * 0.08, hip[1] - 1]], 0.4);

  // Sickle arms — the signature.
  for (let s2 = 0; s2 < 2; s2++) {
    const arm = rig.arms[s2];
    limb(g, arm.sh[0], arm.sh[1], arm.elbow[0], arm.elbow[1], p.upperArmW, p.elbowW,
      { fill: PAL.ink, line: 1.3, seed: S + 20 + s2 });
    limb(g, arm.elbow[0], arm.elbow[1], arm.wrist[0], arm.wrist[1], p.elbowW, p.wristW,
      { fill: PAL.ink, line: 1.3, seed: S + 24 + s2 });
    const a = arm.fA - 1.5;
    const bx = arm.wrist[0]; const by = arm.wrist[1];
    const tip = [bx + Math.cos(a) * 14, by + Math.sin(a) * 14];
    const nx = -Math.sin(a) * 5.5; const ny = Math.cos(a) * 5.5;
    const arcPts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8; const mt = 1 - t;
      arcPts.push([
        mt * mt * bx + 2 * mt * t * ((bx + tip[0]) / 2 + nx) + t * t * tip[0],
        mt * mt * by + 2 * mt * t * ((by + tip[1]) / 2 + ny) + t * t * tip[1],
      ]);
    }
    brush(g, arcPts, { width: 0.85, taper: "end", jitter: 0.05, seed: S + 30 + s2, colour: PAL.paperLit });
    brush(g, arcPts, { width: 0.26, taper: "end", jitter: 0.05, seed: S + 34 + s2, colour: PAL.ink });
    brush(g, arcPts.slice(0, 6).map((q) => [q[0] + 1, q[1] + 1]),
      { width: 0.16, taper: "both", jitter: 0.3, seed: S + 38 + s2, colour: PAL.ink });
  }

  // Head thrust forward, ears back, muzzle long.
  drawHead(g, rig, p, { fill: PAL.ink, line: 1.6, shade: 0, seed: S + 40 });
  for (let i = 0; i < 2; i++) {
    lock(g, rig.headC[0] - p.headR * (0.2 + i * 0.35), rig.headC[1] - p.headR * 0.7,
      -Math.PI * 0.82 + i * 0.34, p.headR * 1.25, p.headR * 0.2, { curve: -0.3, seed: 80 + i });
  }
  for (let i = 0; i < 2; i++) {
    const ex = rig.headC[0] + p.headR * (0.25 + i * 0.42);
    brush(g, [[ex - p.headR * 0.22, rig.headC[1] - p.headR * 0.06], [ex + p.headR * 0.22, rig.headC[1] + p.headR * 0.06]],
      { width: p.headR * 0.07, taper: "both", jitter: 0.05, seed: 85 + i, colour: PAL.paperLit });
  }
  brush(g, [[rig.headC[0] + p.headR * 0.75, rig.headC[1] + p.headR * 0.28],
    [rig.headC[0] + p.headR * 1.6, rig.headC[1] + p.headR * 0.52]],
  { width: p.headR * 0.16, taper: "end", jitter: 0.1, seed: 88, colour: PAL.ink });
  // Bared teeth.
  for (let i = 0; i < 3; i++) {
    const tx = rig.headC[0] + p.headR * (0.9 + i * 0.22);
    brush(g, [[tx, rig.headC[1] + p.headR * 0.42], [tx - 0.4, rig.headC[1] + p.headR * 0.75]],
      { width: 0.24, taper: "end", jitter: 0.1, seed: 90 + i, colour: PAL.paperLit });
  }
}

/** 塗壁 Nurikabe — the wall that blocks the road. Squat, immense. */
function drawNurikabe(g, pose, opts = {}) {
  const p = scaleP(HERO_P, 0.8, {
    headR: 5.6, torsoW: 42, hipW: 22, shoulderW: 42, shoulderDrop: 4,
    thighW: 8, kneeW: 7, ankleW: 6, foot: 10,
    upperArmW: 7.5, elbowW: 6.5, wristW: 6, upperArm: 18, foreArm: 16,
  });
  const rig = buildRig(p, pose);
  const S = 1000;

  drawArm(g, rig.arms[1], p, { fill: PAL.paperLit, line: 1.6, shade: 0.82, seed: S });
  drawLeg(g, rig.legs[1], p, { fill: PAL.paperLit, line: 1.6, shade: 0.78, seed: S + 2 });
  drawLeg(g, rig.legs[0], p, { fill: PAL.paperLit, line: 2, shade: 0.56, seed: S + 4 });

  // A slab of masonry with a face pushed through it.
  const { hip, neck } = rig;
  const w = p.torsoW;
  const body = [
    [neck[0] - w * 0.5, neck[1] + 2],
    [neck[0] + w * 0.5, neck[1] + 2],
    [neck[0] + w * 0.56, hip[1] - 2],
    [hip[0] + w * 0.44, hip[1] + 3],
    [hip[0] - w * 0.44, hip[1] + 3],
    [neck[0] - w * 0.56, hip[1] - 2],
  ];
  shape(g, body, {
    fill: PAL.paperLit, line: 2.6, tension: 0.18,
    shade: 0.5, seed: S + 6, stipple: 0.16, contrast: 1.5, gap: 5.6,
  });

  // Stone courses, drawn as broken mortar rather than a neat grid.
  g.save();
  g.beginPath();
  smoothPath(g, body, true, 0.18);
  g.clip();
  const rows = 5;
  for (let row = 1; row < rows; row++) {
    const y = neck[1] + (Math.abs(hip[1] - neck[1]) / rows) * row;
    brush(g, [
      [neck[0] - w * 0.6, y],
      [neck[0], y + wobble(row, 2) * 2],
      [neck[0] + w * 0.6, y + wobble(row * 2, 5) * 1.6],
    ], { width: 0.5, taper: "both", jitter: 0.5, seed: S + 10 + row, colour: PAL.ink });
    for (let c2 = 0; c2 < 3; c2++) {
      const x = neck[0] - w * 0.45 + ((c2 + (row % 2) * 0.5) / 3) * w * 0.95;
      brush(g, [[x, y], [x + wobble(c2 + row, 5) * 2, y + (Math.abs(hip[1] - neck[1]) / rows)]],
        { width: 0.42, taper: "both", jitter: 0.5, seed: S + 30 + row * 4 + c2, colour: PAL.ink });
    }
  }
  // A long crack.
  brush(g, [
    [neck[0] + w * 0.3, neck[1] + 6],
    [neck[0] + w * 0.1, (neck[1] + hip[1]) / 2],
    [neck[0] + w * 0.24, hip[1] - 4],
  ], { width: 0.7, taper: "both", jitter: 0.7, seed: S + 60, colour: PAL.ink });
  g.restore();

  drawArm(g, rig.arms[0], p, { fill: PAL.paperLit, line: 2, shade: 0.5, seed: S + 70 });

  // The face sits IN the wall, not on a head above it.
  const fx = neck[0] + w * 0.02;
  const fy = neck[1] + Math.abs(hip[1] - neck[1]) * 0.3;
  const fr = w * 0.2;
  for (let i = 0; i < 2; i++) {
    const ex = fx + (i === 0 ? -fr * 0.5 : fr * 0.55);
    g.beginPath();
    g.ellipse(ex, fy, fr * 0.3, fr * 0.36, 0, 0, Math.PI * 2);
    g.fillStyle = PAL.ink;
    g.fill();
    g.beginPath();
    g.arc(ex + fr * 0.08, fy - fr * 0.04, fr * 0.09, 0, Math.PI * 2);
    g.fillStyle = PAL.paperLit;
    g.fill();
  }
  shape(g, [
    [fx - fr * 0.7, fy + fr * 0.9], [fx, fy + fr * 1.4],
    [fx + fr * 0.75, fy + fr * 0.85], [fx, fy + fr * 1.05],
  ], { fill: PAL.ink, line: 1.4, tension: 0.4, seed: S + 80 });

  drawHead(g, rig, p, { fill: PAL.paperLit, shade: 0.5, seed: S + 90 });
}

/** 幽霊 Yurei — the drowned ghost. No feet; she trails away. */
function drawYurei(g, pose, opts = {}) {
  const p = scaleP(HERO_P, 0.74, {
    headR: 6.8, torsoW: 15, upperArmW: 2.5, elbowW: 2.0, wristW: 1.7,
  });
  const rig = buildRig(p, { ...pose, legA: 0.05, legB: -0.05, kneeA: 0.1, kneeB: 0.1, bob: pose.bob * 0.4 });
  const drift = opts.wind == null ? 2 : opts.wind;
  const S = 1300;

  // The tail: a burial robe dissolving into wisps instead of legs.
  const hipY = rig.hip[1];
  const tailLen = p.h * 0.5;
  const tail = [
    [rig.hip[0] - p.torsoW * 0.6, hipY - 4],
    [rig.hip[0] - p.torsoW * 0.8 - drift, hipY + tailLen * 0.4],
    [rig.hip[0] - p.torsoW * 0.2 - drift * 1.8, hipY + tailLen],
    [rig.hip[0] + p.torsoW * 0.15 - drift * 1.2, hipY + tailLen * 0.72],
    [rig.hip[0] + p.torsoW * 0.66, hipY + tailLen * 0.3],
    [rig.hip[0] + p.torsoW * 0.6, hipY - 4],
  ];
  shape(g, tail, {
    fill: PAL.paperLit, line: 1.6, tension: 0.5,
    shade: 0.62, seed: S, contrast: 1.4, gap: 5.0,
  });
  folds(g, rig.hip[0], hipY, Math.PI * 0.52, 5, tailLen * 0.85, 0.8,
    { seed: S + 4, width: 0.85 });
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    lock(g, lerp(rig.hip[0] - p.torsoW * 0.5, rig.hip[0] + p.torsoW * 0.4, t),
      hipY + tailLen * (0.55 + wobble(i, 9) * 0.2),
      Math.PI * 0.5 - 0.3 + t * 0.6, p.h * 0.15, 0.9,
      { curve: 0.5 - t, seed: 130 + i, gloss: false, colour: PAL.ink });
  }

  // Arms hanging limp in front — the classic yurei pose.
  for (let s2 = 0; s2 < 2; s2++) {
    const arm = rig.arms[s2];
    const wristY = arm.sh[1] + p.upperArm + p.foreArm * 0.6;
    limb(g, arm.sh[0], arm.sh[1], arm.sh[0] + 4 + s2, arm.sh[1] + p.upperArm,
      p.upperArmW, p.elbowW, { fill: PAL.paperLit, line: 1.4, shade: s2 ? 0.75 : 0.5, seed: S + 10 + s2 });
    limb(g, arm.sh[0] + 4 + s2, arm.sh[1] + p.upperArm, arm.sh[0] + 11 + s2 * 2, wristY,
      p.elbowW, p.wristW, { fill: PAL.paperLit, line: 1.4, bow: 1.5, shade: s2 ? 0.75 : 0.5, seed: S + 14 + s2 });
    for (let f = 0; f < 4; f++) {
      brush(g, [[arm.sh[0] + 11 + s2 * 2, wristY],
        [arm.sh[0] + 11.2 + s2 * 2 + f * 0.9, wristY + 4.2 - f * 0.4]],
      { width: 0.28, taper: "end", jitter: 0.2, seed: 140 + f + s2 * 3, colour: PAL.ink });
    }
  }

  drawTorso(g, rig, p, { fill: PAL.paperLit, shade: 0.48, seed: S + 20 });
  brush(g, [[rig.neck[0] - p.torsoW * 0.3, rig.neck[1] + 3],
    [rig.chest[0] + p.torsoW * 0.1, rig.chest[1] + 6],
    [rig.hip[0] - p.torsoW * 0.2, rig.hip[1] - 2]],
  { width: 0.42, taper: "both", jitter: 0.2, seed: 150, colour: PAL.ink });

  drawNeck(g, rig, p, { fill: PAL.paperLit, shade: false });
  drawHead(g, rig, p, { fill: PAL.paperLit, shade: 0.44, seed: S + 30 });
  const [hx, hy] = rig.headC;
  const r = p.headR;
  ctxEye(g, hx + r * 0.58, hy + r * 0.05, r * 0.21);
  brush(g, [[hx + r * 0.3, hy + r * 0.72], [hx + r * 0.72, hy + r * 0.66]],
    { width: r * 0.05, taper: "both", jitter: 0.2, seed: 158, colour: PAL.ink });

  hairMass(g, hx, hy, r, {
    dir: Math.PI * 0.62, len: p.h * 0.44, curl: -0.12 - drift * 0.01,
    wave: 0.3, phase: opts.phase || 0, seed: 160, tips: 6, thick: 1.05,
  });
  hairMass(g, hx + r * 0.5, hy - r * 0.1, r * 0.8, {
    dir: Math.PI * 0.44, len: p.h * 0.3, curl: 0.16,
    wave: 0.35, phase: (opts.phase || 0) + 2.2, seed: 166, tips: 4, thick: 0.8,
  });
}

/** 河童 Kappa — the river imp. Shell, beak, and a dish of water. */
function drawKappa(g, pose, opts = {}) {
  const p = scaleP(HERO_P, 0.6, {
    headR: 6.8, torsoW: 17, thighW: 3.2, kneeW: 2.6, ankleW: 2.2, foot: 6,
    upperArmW: 2.6, elbowW: 2.1, wristW: 1.9,
  });
  const rig = buildRig(p, { ...pose, lean: 6 });
  const S = 1600;

  drawArm(g, rig.arms[1], p, { fill: PAL.paperLit, line: 1.3, shade: 0.8, seed: S });
  drawLeg(g, rig.legs[1], p, { fill: PAL.paperLit, line: 1.3, shade: 0.76, seed: S + 2 });
  drawLeg(g, rig.legs[0], p, { fill: PAL.paperLit, line: 1.5, shade: 0.52, seed: S + 4 });

  // Shell on the back — dark dome, plate seams cut in white.
  const { chest, hip } = rig;
  const sx = chest[0] - p.torsoW * 0.5;
  const sy = (chest[1] + hip[1]) / 2;
  const shell = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI * 0.35 + (i / 12) * Math.PI * 1.3;
    shell.push([sx + Math.cos(a) * p.torsoW * 0.64, sy + Math.sin(a) * p.torsoW * 0.8]);
  }
  shape(g, shell, { fill: PAL.ink, line: 1.9, tension: 0.4, seed: S + 6 });
  for (let i = 1; i < 5; i++) {
    const a = Math.PI * 0.45 + (i / 5) * Math.PI * 1.05;
    brush(g, [[sx, sy], [sx + Math.cos(a) * p.torsoW * 0.6, sy + Math.sin(a) * p.torsoW * 0.76]],
      { width: 0.32, taper: "start", jitter: 0.15, seed: 170 + i, colour: PAL.paperLit });
  }

  drawTorso(g, rig, p, { fill: PAL.paperLit, shade: 0.46, seed: S + 10, stipple: 0.1 });
  drawArm(g, rig.arms[0], p, { fill: PAL.paperLit, line: 1.5, shade: 0.46, seed: S + 12 });

  // Head: flat crown holding the dish, beak forward.
  const [hx, hy] = rig.headC;
  const r = p.headR;
  shape(g, [
    [hx - r * 0.95, hy - r * 0.3],
    [hx - r * 0.5, hy - r * 0.95],
    [hx + r * 0.5, hy - r * 0.95],
    [hx + r * 0.95, hy - r * 0.15],
    [hx + r * 0.7, hy + r * 0.85],
    [hx - r * 0.6, hy + r * 0.8],
  ], { fill: PAL.paperLit, line: 1.6, tension: 0.45, shade: 0.42, seed: S + 20 });
  g.beginPath();
  g.ellipse(hx, hy - r * 0.82, r * 0.62, r * 0.24, 0, 0, Math.PI * 2);
  g.fillStyle = PAL.paperDeep;
  g.fill();
  g.strokeStyle = PAL.ink;
  g.lineWidth = 1.2;
  g.stroke();
  shape(g, [
    [hx + r * 0.5, hy + r * 0.08],
    [hx + r * 1.6, hy + r * 0.3],
    [hx + r * 0.55, hy + r * 0.55],
  ], { fill: PAL.ink, line: 1.3, tension: 0.2, seed: S + 24 });
  ctxEye(g, hx + r * 0.15, hy - r * 0.2, r * 0.2);
  ctxEye(g, hx + r * 0.68, hy - r * 0.18, r * 0.18);
}

/** 付喪神 Tsukumogami — a lantern that lived a hundred years. */
function drawTsukumo(g, pose, opts = {}) {
  const h = 32;
  const bob = pose.bob || 0;
  const y = -h * 0.55 - bob;
  const rw = 9;
  const S = 1900;

  const body = [
    [-rw * 0.55, y + h * 0.44],
    [-rw, y],
    [-rw * 0.6, y - h * 0.44],
    [rw * 0.6, y - h * 0.44],
    [rw, y],
    [rw * 0.55, y + h * 0.44],
  ];
  shape(g, body, {
    fill: PAL.paperLit, line: 1.8, tension: 0.5,
    shade: 0.5, seed: S, contrast: 1.4, gap: 4.4,
  });
  g.save();
  g.beginPath();
  smoothPath(g, body, true, 0.5);
  g.clip();
  for (let i = -3; i <= 3; i++) {
    brush(g, [[-rw * 1.2, y + i * 3.6], [rw * 1.2, y + i * 3.6 + wobble(i, 4) * 0.9]],
      { width: 0.26, taper: "both", jitter: 0.3, seed: 180 + i, colour: PAL.ink });
  }
  g.restore();
  shape(g, [[-rw * 0.62, y - h * 0.42], [rw * 0.62, y - h * 0.42], [rw * 0.5, y - h * 0.58], [-rw * 0.5, y - h * 0.58]],
    { fill: PAL.ink, line: 1.3, tension: 0.1, seed: S + 4 });
  shape(g, [[-rw * 0.6, y + h * 0.42], [rw * 0.6, y + h * 0.42], [rw * 0.48, y + h * 0.58], [-rw * 0.48, y + h * 0.58]],
    { fill: PAL.ink, line: 1.3, tension: 0.1, seed: S + 6 });

  ctxEye(g, 1.5, y - 3, 2.8);
  shape(g, [[-3.8, y + 4], [-1, y + 7.4], [1.5, y + 4.6], [4.2, y + 8], [4.6, y + 4], [-3.9, y + 3.2]],
    { fill: PAL.ink, line: 0.9, tension: 0.05, seed: S + 8 });

  for (let s2 = 0; s2 < 2; s2++) {
    const swing = s2 === 0 ? pose.legA : pose.legB;
    const lx = (s2 === 0 ? 3 : -3);
    const ly = y + h * 0.56;
    brush(g, [[lx, ly], [lx + Math.sin(swing) * 5, ly + 7]],
      { width: 0.55, taper: "none", jitter: 0.1, seed: 190 + s2, colour: PAL.ink });
  }
}

/** 怨霊 Onryo — the vengeful spirit. Elite: taller, arms wide. */
function drawOnryo(g, pose, opts = {}) {
  const p = scaleP(HERO_P, 0.9, {
    headR: 7.2, torsoW: 17, upperArmW: 2.9, elbowW: 2.3, wristW: 1.9,
  });
  const rig = buildRig(p, { ...pose, legA: 0.1, legB: -0.1, kneeA: 0.1, kneeB: 0.1, bob: (pose.bob || 0) * 0.5 });
  const drift = opts.wind == null ? 3 : opts.wind;
  const S = 2200;

  // Trailing robe.
  const hipY = rig.hip[1];
  const tailLen = p.h * 0.58;
  const tail = [
    [rig.hip[0] - p.torsoW * 0.7, hipY - 5],
    [rig.hip[0] - p.torsoW * 1.05 - drift, hipY + tailLen * 0.45],
    [rig.hip[0] - p.torsoW * 0.3 - drift * 2.2, hipY + tailLen],
    [rig.hip[0] + p.torsoW * 0.5 - drift * 1.4, hipY + tailLen * 0.68],
    [rig.hip[0] + p.torsoW * 0.85, hipY + tailLen * 0.25],
    [rig.hip[0] + p.torsoW * 0.7, hipY - 5],
  ];
  shape(g, tail, {
    fill: PAL.paperLit, line: 2, tension: 0.5,
    shade: 0.7, seed: S, contrast: 1.5, gap: 5.0,
  });
  folds(g, rig.hip[0], hipY - 2, Math.PI * 0.54, 6, tailLen * 0.9, 0.9,
    { seed: S + 4, width: 1.0 });
  // Blood soaking up the hem — the one place colour is allowed.
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    splat(g, lerp(rig.hip[0] - p.torsoW * 0.5, rig.hip[0] + p.torsoW * 0.35, t),
      hipY + tailLen * (0.72 + wobble(i, 3) * 0.16), 2.2 + wobble(i * 2, 7) * 1.4,
      { seed: S + 10 + i, colour: PAL.blood, drops: 2, rough: 0.7 });
  }

  // Arms reaching forward and down, claws spread.
  for (const s2 of [1, 0]) {
    const arm = rig.arms[s2];
    const reach = 1 - s2 * 0.22;
    const ex = arm.sh[0] + 10 * reach;
    const ey = arm.sh[1] + 13;
    const wx = ex + 13 * reach;
    const wy = ey + 9 - s2 * 2;
    shape(g, [
      [arm.sh[0] - 3, arm.sh[1] - 1],
      [ex + 3, ey + 2],
      [ex - 2, ey + 17 + s2 * 3],
      [arm.sh[0] - 6 - drift * 0.6, arm.sh[1] + 19],
    ], {
      fill: PAL.paperLit, line: 1.5, tension: 0.42,
      shade: s2 === 0 ? 0.5 : 0.78, seed: S + 20 + s2,
    });
    limb(g, arm.sh[0], arm.sh[1], ex, ey, p.upperArmW, p.elbowW,
      { fill: PAL.paperLit, line: 1.5, shade: s2 === 0 ? 0.48 : 0.78, seed: S + 24 + s2 });
    limb(g, ex, ey, wx, wy, p.elbowW, p.wristW,
      { fill: PAL.paperLit, line: 1.5, shade: s2 === 0 ? 0.48 : 0.78, seed: S + 28 + s2 });
    for (let f = 0; f < 4; f++) {
      const a = -0.15 + f * 0.3;
      brush(g, [[wx, wy], [wx + Math.cos(a) * 7, wy + Math.sin(a) * 7]],
        { width: 0.34, taper: "end", jitter: 0.15, seed: 200 + f + s2 * 5, colour: PAL.ink });
    }
  }

  drawTorso(g, rig, p, { fill: PAL.paperLit, shade: 0.5, seed: S + 40 });

  // Hair thrown up and back, drawn BEFORE the head so the face reads.
  const [hx, hy] = rig.headC;
  const r = p.headR;
  hairMass(g, hx, hy, r, {
    dir: Math.PI * (1.16 - drift * 0.01), len: p.h * 0.36, curl: -0.5,
    wave: 0.7, phase: opts.phase || 0, seed: 220, tips: 6, thick: 1.05,
  });
  hairMass(g, hx - r * 0.2, hy, r * 0.85, {
    dir: Math.PI * 0.9, len: p.h * 0.3, curl: -0.9,
    wave: 0.6, phase: (opts.phase || 0) + 1.4, seed: 226, tips: 5, thick: 0.8,
  });

  drawNeck(g, rig, p, { fill: PAL.paperLit, shade: false });
  drawHead(g, rig, p, { fill: PAL.paperLit, shade: 0.46, seed: S + 50 });

  for (let i = 0; i < 2; i++) {
    const ex = hx + r * (0.2 + i * 0.5);
    ctxEye(g, ex, hy + r * 0.02, r * 0.21);
    brush(g, [[ex, hy + r * 0.3], [ex - r * 0.05, hy + r * 1.35]],
      { width: r * 0.055, taper: "end", jitter: 0.2, seed: 210 + i, colour: PAL.ink });
  }
  brush(g, [[hx + r * 0.1, hy + r * 0.72], [hx + r * 0.5, hy + r * 0.9], [hx + r * 0.85, hy + r * 0.66]],
    { width: r * 0.05, taper: "both", jitter: 0.2, seed: 214, colour: PAL.ink });
  for (let i = 0; i < 3; i++) {
    lock(g, hx - r * 0.5 + i * r * 0.55, hy - r * 0.8, Math.PI * (0.56 + i * 0.06),
      r * 0.9, r * 0.11, { curve: 0.2, seed: 230 + i, glossFrom: 0.1, glossTo: 0.5 });
  }
}

/** 大百足 Ōmukade — the armoured centipede. A fast segmented rusher. */
function drawMukade(g, pose, opts = {}) {
  const seg = 8;
  const bob = pose.bob || 0;
  const phase = pose.phase || 0;
  const baseY = -15 - bob;
  const S = 2500;
  const spine = [];
  for (let i = 0; i < seg; i++) {
    const t = i / (seg - 1);
    spine.push([18 - t * 46, baseY + Math.sin(phase * Math.PI * 2 + t * 4.2) * 5]);
  }

  for (let i = 1; i < seg; i++) {
    for (let s2 = -1; s2 <= 1; s2 += 2) {
      const p0 = spine[i];
      const a = Math.PI * 0.5 + s2 * 0.42 + Math.sin(phase * Math.PI * 2 + i * 1.2) * 0.5;
      brush(g, [p0, [p0[0] + Math.cos(a) * 10, p0[1] + Math.sin(a) * 14]],
        { width: 0.5, taper: "end", jitter: 0.15, seed: 230 + i * 3 + s2, colour: PAL.ink });
    }
  }
  for (let i = seg - 1; i >= 1; i--) {
    const p0 = spine[i];
    const r = 7.5 - i * 0.5;
    shape(g, [
      [p0[0] - r, p0[1]], [p0[0] - r * 0.4, p0[1] - r * 0.95],
      [p0[0] + r * 0.6, p0[1] - r * 0.8], [p0[0] + r, p0[1] + r * 0.1],
      [p0[0] + r * 0.4, p0[1] + r * 0.85], [p0[0] - r * 0.5, p0[1] + r * 0.8],
    ], {
      fill: i % 2 ? PAL.ink : PAL.paperLit, line: 1.5, tension: 0.45,
      shade: i % 2 ? 0 : 0.5, seed: S + i,
    });
  }
  const hp = spine[0];
  shape(g, [
    [hp[0] - 8, hp[1] - 1], [hp[0] - 2, hp[1] - 8],
    [hp[0] + 8, hp[1] - 4], [hp[0] + 10, hp[1] + 2],
    [hp[0] + 2, hp[1] + 8], [hp[0] - 7, hp[1] + 7],
  ], { fill: PAL.ink, line: 1.7, tension: 0.45, seed: S + 40 });
  for (let s2 = -1; s2 <= 1; s2 += 2) {
    brush(g, [[hp[0] + 6, hp[1] + s2 * 3], [hp[0] + 14, hp[1] + s2 * 7], [hp[0] + 18, hp[1] + s2 * 1]],
      { width: 0.7, taper: "end", jitter: 0.1, seed: 250 + s2, colour: PAL.ink });
    brush(g, [[hp[0] + 6, hp[1] + s2 * 3], [hp[0] + 14, hp[1] + s2 * 7], [hp[0] + 18, hp[1] + s2 * 1]],
      { width: 0.22, taper: "end", jitter: 0.1, seed: 254 + s2, colour: PAL.paperLit });
  }
  ctxEye(g, hp[0] + 2, hp[1] - 2, 1.9);
}

/** 餓者髑髏 Gashadokuro — the famine skeleton, built from the dead. */
function drawGashadokuro(g, pose, opts = {}) {
  const p = scaleP(HERO_P, 1.75, {
    headR: 21, torsoW: 34, hipW: 18, shoulderW: 44, shoulderDrop: 3,
    thighW: 5.5, kneeW: 4.5, ankleW: 4, foot: 14,
    upperArmW: 5, elbowW: 4, wristW: 3.4,
  });
  const rig = buildRig(p, pose);

  // Bone limbs: thin shafts with knobbed joints.
  const boneLimb = (a, b, w) => {
    limb(g, a[0], a[1], b[0], b[1], w, w * 0.85, { fill: PAL.paperLit, line: 2.2 });
    for (const j of [a, b]) {
      g.beginPath();
      g.arc(j[0], j[1], w * 1.5, 0, Math.PI * 2);
      g.fillStyle = PAL.paperLit;
      g.fill();
      g.strokeStyle = PAL.ink;
      g.lineWidth = 2;
      g.stroke();
    }
  };

  for (const s of [1, 0]) {
    const leg = rig.legs[s];
    boneLimb(leg.hip, leg.knee, p.thighW);
    boneLimb(leg.knee, leg.ankle, p.ankleW);
    // Splayed foot bones.
    for (let f = 0; f < 3; f++) {
      brush(g, [leg.ankle, [leg.ankle[0] + 6 + f * 4, leg.ankle[1] + 3 - f]],
        { width: 2, taper: "end", jitter: 0.1, seed: 300 + f + s * 3, colour: PAL.paperLit });
      brush(g, [leg.ankle, [leg.ankle[0] + 6 + f * 4, leg.ankle[1] + 3 - f]],
        { width: 0.7, taper: "end", jitter: 0.1, seed: 305 + f + s * 3, colour: PAL.ink });
    }
  }

  const armS = rig.arms[1];
  boneLimb(armS.sh, armS.elbow, p.upperArmW);
  boneLimb(armS.elbow, armS.wrist, p.wristW);

  // Ribcage.
  const { chest, hip, neck } = rig;
  const spineTop = neck[1] + 4;
  const spineBot = hip[1] - 2;
  brush(g, [[neck[0], spineTop], [chest[0], (spineTop + spineBot) / 2], [hip[0], spineBot]],
    { width: 4, taper: "none", jitter: 0.1, seed: 320, colour: PAL.paperLit });
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const y = lerp(spineTop + 4, spineBot - 6, t);
    const w2 = p.torsoW * (0.62 - Math.abs(t - 0.35) * 0.5);
    for (const s of [-1, 1]) {
      const rib = [
        [neck[0] + s * 2, y],
        [neck[0] + s * w2, y + 5],
        [neck[0] + s * w2 * 0.7, y + 12],
      ];
      brush(g, rib, { width: 2.6, taper: "end", jitter: 0.12, seed: 330 + i * 2 + s, colour: PAL.paperLit });
      brush(g, rib, { width: 0.9, taper: "end", jitter: 0.12, seed: 340 + i * 2 + s, colour: PAL.ink });
    }
  }
  // Pelvis.
  shape(g, [
    [hip[0] - p.hipW, hip[1] - 6], [hip[0] + p.hipW, hip[1] - 6],
    [hip[0] + p.hipW * 0.7, hip[1] + 5], [hip[0], hip[1] + 1], [hip[0] - p.hipW * 0.7, hip[1] + 5],
  ], { fill: PAL.paperLit, line: 2.2, tension: 0.4 });

  const armF = rig.arms[0];
  boneLimb(armF.sh, armF.elbow, p.upperArmW);
  boneLimb(armF.elbow, armF.wrist, p.wristW);
  // Grasping finger bones.
  for (let f = 0; f < 4; f++) {
    const a = -0.9 + f * 0.4;
    const fp = [[armF.wrist[0], armF.wrist[1]],
      [armF.wrist[0] + Math.cos(a) * 12, armF.wrist[1] + Math.sin(a) * 12]];
    brush(g, fp, { width: 2, taper: "end", jitter: 0.12, seed: 350 + f, colour: PAL.paperLit });
    brush(g, fp, { width: 0.7, taper: "end", jitter: 0.12, seed: 355 + f, colour: PAL.ink });
  }

  // Skull.
  const [hx, hy] = rig.headC;
  const r = p.headR;
  shape(g, [
    [hx - r * 0.95, hy - r * 0.15], [hx - r * 0.72, hy - r * 0.9],
    [hx + r * 0.1, hy - r * 1.12], [hx + r * 0.92, hy - r * 0.72],
    [hx + r * 1.0, hy + r * 0.1], [hx + r * 0.72, hy + r * 0.5],
    [hx + r * 0.62, hy + r * 1.05], [hx - r * 0.2, hy + r * 1.0],
    [hx - r * 0.42, hy + r * 0.45],
  ], { fill: PAL.paperLit, line: 2.6, tension: 0.5 });
  // Sockets — deep, black, with a pinprick of light.
  for (let i = 0; i < 2; i++) {
    const ex = hx + r * (0.05 + i * 0.58);
    shape(g, [
      [ex - r * 0.26, hy - r * 0.22], [ex + r * 0.24, hy - r * 0.3],
      [ex + r * 0.3, hy + r * 0.22], [ex - r * 0.16, hy + r * 0.26],
    ], { fill: PAL.ink, line: 1.6, tension: 0.4 });
    g.beginPath();
    g.arc(ex + r * 0.08, hy + r * 0.02, r * 0.07, 0, Math.PI * 2);
    g.fillStyle = PAL.paperLit;
    g.fill();
  }
  // Nasal cavity + teeth.
  shape(g, [[hx + r * 0.42, hy + r * 0.3], [hx + r * 0.6, hy + r * 0.52], [hx + r * 0.36, hy + r * 0.54]],
    { fill: PAL.ink, line: 1.2, tension: 0.2 });
  for (let i = 0; i < 7; i++) {
    const tx = hx - r * 0.2 + i * r * 0.16;
    brush(g, [[tx, hy + r * 0.66], [tx, hy + r * 1.0]],
      { width: r * 0.045, taper: "none", jitter: 0.1, seed: 370 + i, colour: PAL.ink });
  }
  brush(g, [[hx - r * 0.28, hy + r * 0.66], [hx + r * 0.78, hy + r * 0.62]],
    { width: r * 0.05, taper: "both", jitter: 0.1, seed: 380, colour: PAL.ink });
}

/** 鬼 Oni — horns, iron club, and far too many teeth. */
function drawOni(g, pose, opts = {}) {
  const p = scaleP(HERO_P, 1.3, {
    headR: 15, torsoW: 34, hipW: 16, shoulderW: 40, shoulderDrop: 3,
    thighW: 8, kneeW: 6.5, ankleW: 5.5, foot: 11,
    upperArmW: 8.5, elbowW: 7, wristW: 6,
  });
  const rig = buildRig(p, pose);

  const S = 3000;
  drawOniClub(g, rig, p);
  drawArm(g, rig.arms[1], p, { fill: PAL.paperLit, line: 1.8, shade: 0.82, seed: S });
  drawLeg(g, rig.legs[1], p, { fill: PAL.paperLit, line: 1.8, shade: 0.78, seed: S + 2 });
  drawLeg(g, rig.legs[0], p, { fill: PAL.paperLit, line: 2.2, shade: 0.52, seed: S + 4 });

  // Slab torso, heavy pectorals.
  const { chest, hip, neck } = rig;
  const w = p.torsoW;
  const body = [
    [neck[0] - w * 0.5, neck[1] + 2], [neck[0] + w * 0.5, neck[1] + 2],
    [chest[0] + w * 0.6, chest[1] + 4], [hip[0] + w * 0.34, hip[1] + 2],
    [hip[0] - w * 0.34, hip[1] + 2], [chest[0] - w * 0.6, chest[1] + 4],
  ];
  shape(g, body, {
    fill: PAL.paperLit, line: 2.4, tension: 0.45,
    shade: 0.62, seed: S + 10, stipple: 0.16, contrast: 1.4, gap: 4.0,
  });
  // Musculature: pectoral shelf, sternum, three belly bands. Kept to
  // a handful of confident strokes — more than that at this size
  // stops reading as anatomy and starts reading as scribble.
  brush(g, [[chest[0] - w * 0.36, chest[1] + 5], [chest[0], chest[1] + 10], [chest[0] + w * 0.36, chest[1] + 4]],
    { width: 0.62, taper: "both", jitter: 0.15, seed: 400, colour: PAL.ink });
  brush(g, [[chest[0], chest[1] + 6], [chest[0] - 1, chest[1] + 18]],
    { width: 0.4, taper: "both", jitter: 0.25, seed: 402, colour: PAL.ink });
  for (let i = 0; i < 3; i++) {
    const y = chest[1] + 16 + i * 6;
    brush(g, [[chest[0] - w * 0.22, y], [chest[0], y + 1.4], [chest[0] + w * 0.22, y]],
      { width: 0.45, taper: "both", jitter: 0.25, seed: 405 + i, colour: PAL.ink });
  }
  // Old scars across the ribs.
  for (let i = 0; i < 3; i++) {
    brush(g, [
      [chest[0] - w * 0.4 + i * 5, chest[1] + 4 + i * 9],
      [chest[0] + w * 0.24 + i * 3, chest[1] + 14 + i * 8],
    ], { width: 0.42, taper: "both", jitter: 0.4, seed: 408 + i, colour: PAL.ink });
  }

  // Tiger-skin loincloth.
  shape(g, [
    [hip[0] - w * 0.4, hip[1] - 4], [hip[0] + w * 0.4, hip[1] - 4],
    [hip[0] + w * 0.34, hip[1] + 22], [hip[0], hip[1] + 16], [hip[0] - w * 0.34, hip[1] + 22],
  ], { fill: PAL.paperLit, line: 2, tension: 0.3, shade: 0.4, seed: S + 20 });
  for (let i = 0; i < 4; i++) {
    brush(g, [[hip[0] - w * 0.3 + i * w * 0.2, hip[1] - 2], [hip[0] - w * 0.26 + i * w * 0.2, hip[1] + 14]],
      { width: 0.8, taper: "both", jitter: 0.3, seed: 410 + i, colour: PAL.ink });
  }

  drawArm(g, rig.arms[0], p, { fill: PAL.paperLit, line: 2.2, shade: 0.5, seed: S + 30 });

  // Head: broad, snarling, two horns.
  const [hx, hy] = rig.headC;
  const r = p.headR;

  // Mane goes down first so the horns and skull sit on top of it.
  hairMass(g, hx, hy, r, {
    dir: Math.PI * 0.98, len: r * 2.6, curl: -0.35, wave: 0.5,
    phase: opts.phase || 0, seed: 450, tips: 5, thick: 1.15,
  });
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const aa = lerp(Math.PI * 1.12, Math.PI * 1.52, t);
    lock(g, hx - r * 0.55 + t * r * 0.45, hy - r * 0.5 + t * r * 0.45, aa,
      r * (0.8 + wobble(i, 8) * 0.4), r * 0.18,
      { curve: 0.45, seed: 456 + i, glossFrom: 0.12, glossTo: 0.55, glossWidth: 0.2 });
  }

  shape(g, [
    [hx - r * 0.9, hy - r * 0.35], [hx - r * 0.55, hy - r * 0.95],
    [hx + r * 0.5, hy - r * 1.0], [hx + r * 1.0, hy - r * 0.3],
    [hx + r * 0.92, hy + r * 0.62], [hx + r * 0.1, hy + r * 1.1],
    [hx - r * 0.62, hy + r * 0.6],
  ], { fill: PAL.paperLit, line: 2.4, tension: 0.5, shade: 0.56, seed: S + 40, stipple: 0.12 });

  // Horns. Curved, thick at the base, swept OUT and back — straight
  // vertical spikes on a round skull read as rabbit ears.
  for (let s2 = 0; s2 < 2; s2++) {
    const side = s2 === 0 ? -1 : 1;
    const bx = hx + side * r * 0.52;
    const by = hy - r * 0.66;
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const ang = -Math.PI * 0.5 + side * (0.55 + t * 0.75);
      pts.push([
        bx + Math.cos(ang) * r * 1.7 * t,
        by + Math.sin(ang) * r * 1.7 * t - t * t * r * 0.3,
      ]);
    }
    const wA = [];
    const wB = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const w2 = r * 0.3 * (1 - t * 0.88);
      const q = pts[i];
      const q2 = pts[Math.min(5, i + 1)];
      const dx = q2[0] - q[0]; const dy = q2[1] - q[1];
      const l = Math.hypot(dx, dy) || 1;
      wA.push([q[0] - dy / l * w2, q[1] + dx / l * w2]);
      wB.push([q[0] + dy / l * w2, q[1] - dx / l * w2]);
    }
    shape(g, wA.concat(wB.reverse()), {
      fill: PAL.paperLit, line: 2, tension: 0.35, shade: 0.62, seed: S + 50 + s2,
    });
    // Growth rings.
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      brush(g, [wA[i], wB[5 - i]],
        { width: 0.3, taper: "both", jitter: 0.3, seed: S + 60 + s2 * 4 + i, colour: PAL.ink });
    }
  }
  // Furious brow + eyes.
  for (let i = 0; i < 2; i++) {
    const ex = hx + r * (0.08 + i * 0.55);
    brush(g, [[ex - r * 0.3, hy - r * 0.34 + i * r * 0.06], [ex + r * 0.28, hy - r * 0.12]],
      { width: r * 0.14, taper: "both", jitter: 0.1, seed: 440 + i, colour: PAL.ink });
    ctxEye(g, ex, hy + r * 0.02, r * 0.16);
  }
  // Grin full of tusks.
  shape(g, [
    [hx - r * 0.35, hy + r * 0.5], [hx + r * 0.3, hy + r * 0.78],
    [hx + r * 0.92, hy + r * 0.42], [hx + r * 0.3, hy + r * 0.55],
  ], { fill: PAL.ink, line: 1.6, tension: 0.3 });
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const tx = lerp(hx - r * 0.28, hx + r * 0.8, t);
    const ty = lerp(hy + r * 0.52, hy + r * 0.46, t);
    shape(g, [[tx - r * 0.06, ty], [tx + r * 0.06, ty], [tx, ty + r * (i % 2 ? 0.16 : 0.26)]],
      { fill: PAL.paperLit, line: 0.8, tension: 0.05 });
  }
}

/** 金棒 kanabo — the studded iron club, swung out clear of the body. */
function drawOniClub(g, rig, p) {
  const sh = rig.arms[0].sh;
  const ox = sh[0] + 16;
  const oy = sh[1] - 6;
  const a = -1.05;
  const cl = 62;
  const cx = Math.cos(a); const cy = Math.sin(a);
  const tip = [ox + cx * cl, oy + cy * cl];

  // Haft tapering into a heavy head.
  brush(g, [[ox - cx * 14, oy - cy * 14], [ox + cx * cl * 0.45, oy + cy * cl * 0.45]],
    { width: 2.6, taper: "none", jitter: 0.06, seed: 419, colour: PAL.ink });
  brush(g, [[ox + cx * cl * 0.4, oy + cy * cl * 0.4], tip],
    { width: 6.4, taper: "none", jitter: 0.06, seed: 420, colour: PAL.ink });
  // Cap.
  g.beginPath();
  g.ellipse(tip[0], tip[1], 7, 5, a, 0, Math.PI * 2);
  g.fillStyle = PAL.ink;
  g.fill();

  const rand = rng(4321);
  for (let i = 0; i < 14; i++) {
    const t = 0.45 + rand() * 0.55;
    const px = ox + cx * cl * t + (rand() - 0.5) * 9;
    const py = oy + cy * cl * t + (rand() - 0.5) * 9;
    starburst(g, px, py, 2.2, { points: 4, inner: 0.3, rot: rand(), colour: PAL.paperLit });
  }
}

/** ぬらりひょん Nurarihyon — supreme commander of the night parade. */
function drawNurarihyon(g, pose, opts = {}) {
  const p = scaleP(HERO_P, 1.15, {
    headR: 15, torsoW: 26, hipW: 12, shoulderW: 26, shoulderDrop: 3,
    upperArmW: 4.4, elbowW: 3.6, wristW: 3,
  });
  const rig = buildRig(p, { ...pose, legA: 0.06, legB: -0.06, kneeA: 0.1, kneeB: 0.1, bob: (pose.bob || 0) * 0.4 });
  const drift = opts.wind == null ? 4 : opts.wind;

  // Kimono skirt — an immense dark bell that never touches ground.
  const hipY = rig.hip[1];
  const tailLen = p.h * 0.62;
  const robe = [
    [rig.hip[0] - p.torsoW * 0.8, hipY - 8],
    [rig.hip[0] - p.torsoW * 1.5 - drift * 0.6, hipY + tailLen * 0.55],
    [rig.hip[0] - p.torsoW * 0.6 - drift * 2, hipY + tailLen],
    [rig.hip[0] + p.torsoW * 0.7 - drift * 1.2, hipY + tailLen * 0.86],
    [rig.hip[0] + p.torsoW * 1.45, hipY + tailLen * 0.35],
    [rig.hip[0] + p.torsoW * 0.8, hipY - 8],
  ];
  shape(g, robe, { fill: PAL.ink, line: 2.4, tension: 0.5 });
  // Family crest in white on the skirt.
  const crestX = rig.hip[0] - 3;
  const crestY = hipY + tailLen * 0.42;
  roughCircle(g, crestX, crestY, 8, 3, 0.03);
  g.strokeStyle = PAL.paperLit;
  g.lineWidth = 1.8;
  g.stroke();
  starburst(g, crestX, crestY, 5.5, { points: 3, inner: 0.42, rot: -Math.PI / 2, colour: PAL.paperLit });
  gloss(g, [
    [rig.hip[0] - p.torsoW * 0.5, hipY],
    [rig.hip[0] - p.torsoW * 0.95 - drift, hipY + tailLen * 0.8],
  ], 1.5);

  // Wide sleeves.
  for (let s = 0; s < 2; s++) {
    const arm = rig.arms[s];
    const dir = s === 0 ? 1 : -0.7;
    shape(g, [
      [arm.sh[0] - 4, arm.sh[1] - 2],
      [arm.sh[0] + 22 * dir, arm.sh[1] + 4],
      [arm.sh[0] + 20 * dir, arm.sh[1] + 26],
      [arm.sh[0] - 6, arm.sh[1] + 22],
    ], { fill: PAL.ink, line: 2, tension: 0.45 });
    if (s === 0) {
      // A withered hand emerging.
      const wx = arm.sh[0] + 24; const wy = arm.sh[1] + 14;
      g.beginPath();
      g.arc(wx, wy, 3.4, 0, Math.PI * 2);
      g.fillStyle = PAL.paperLit;
      g.fill();
      g.strokeStyle = PAL.ink;
      g.lineWidth = 1.6;
      g.stroke();
      for (let f = 0; f < 4; f++) {
        const a = -0.5 + f * 0.34;
        brush(g, [[wx, wy], [wx + Math.cos(a) * 7, wy + Math.sin(a) * 7]],
          { width: 0.9, taper: "end", jitter: 0.15, seed: 470 + f, colour: PAL.ink });
      }
    }
  }

  drawTorso(g, rig, p, { fill: PAL.ink });

  // The head: a vast elongated gourd of a skull.
  const [hx, hy] = rig.headC;
  const r = p.headR;
  shape(g, [
    [hx - r * 0.8, hy + r * 0.2], [hx - r * 1.0, hy - r * 0.7],
    [hx - r * 0.5, hy - r * 1.75], [hx + r * 0.5, hy - r * 1.85],
    [hx + r * 1.05, hy - r * 0.85], [hx + r * 1.0, hy + r * 0.15],
    [hx + r * 0.72, hy + r * 0.9], [hx - r * 0.1, hy + r * 1.05],
    [hx - r * 0.55, hy + r * 0.72],
  ], { fill: PAL.paperLit, line: 2.4, tension: 0.5 });
  // Cranial tone + wrinkle lines.
  toneRegion(g, (c) => { c.arc(hx, hy - r * 0.6, r * 1.2, 0, Math.PI * 2); },
    [hx - r * 1.4, hy - r * 2.2, r * 2.8, r * 3.6], 0.24, 4);
  for (let i = 0; i < 3; i++) {
    brush(g, [[hx - r * 0.55, hy - r * (0.5 + i * 0.26)], [hx + r * 0.1, hy - r * (0.62 + i * 0.26)], [hx + r * 0.7, hy - r * (0.44 + i * 0.24)]],
      { width: r * 0.045, taper: "both", jitter: 0.25, seed: 480 + i, colour: PAL.ink });
  }
  // Hooded, ancient eyes.
  for (let i = 0; i < 2; i++) {
    const ex = hx + r * (0.1 + i * 0.5);
    brush(g, [[ex - r * 0.24, hy - r * 0.02], [ex + r * 0.06, hy - r * 0.12], [ex + r * 0.26, hy + r * 0.02]],
      { width: r * 0.09, taper: "both", jitter: 0.1, seed: 490 + i, colour: PAL.ink });
    g.beginPath();
    g.ellipse(ex, hy + r * 0.1, r * 0.13, r * 0.09, 0, 0, Math.PI * 2);
    g.fillStyle = PAL.ink;
    g.fill();
  }
  // A thin, knowing smile.
  brush(g, [[hx + r * 0.05, hy + r * 0.6], [hx + r * 0.42, hy + r * 0.7], [hx + r * 0.78, hy + r * 0.52]],
    { width: r * 0.06, taper: "both", jitter: 0.15, seed: 495, colour: PAL.ink });
  // Wispy side hair.
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < 3; i++) {
      lock(g, hx + (s === 0 ? -r * 0.85 : r * 0.9), hy - r * 0.35 + i * r * 0.2,
        (s === 0 ? Math.PI * 0.85 : Math.PI * 0.15) + i * 0.15, r * (0.9 + i * 0.2), r * 0.07,
        { curve: (s === 0 ? -0.3 : 0.3), seed: 500 + s * 3 + i, gloss: false });
    }
  }
}

/* ---------------------------------------------------------- */
/* Single-figure bake, for art iteration                       */
/* ---------------------------------------------------------- */

/**
 * Bake one figure at an arbitrary scale. Used by the art harness
 * so a character can be inspected at four times game size, which
 * is the only way to judge whether hatch density is reading as
 * strokes or as mud.
 */
export function bakeFigure(name, opts = {}) {
  const scale = opts.scale || 1;
  const t = opts.t == null ? 0.25 : opts.t;
  const pose = opts.pose || runPose(t, { amp: 1, lean: 4 });
  pose.phase = t;

  if (name === "hero") {
    const slash = opts.action === "slash" ? heroSlashPose(t) : null;
    const box = slash ? [-80, -154, 120, 18] : [-64, -144, 70, 10];
    return bakeAt(box, scale, (g) => drawHero(g, slash ? slash.pose : pose, {
      wind: slash ? 5.4 : 3.4,
      phase: slash ? t * 5 : 1.2,
      flare: 1.1,
      slashAngle: slash?.angle,
      slashProgress: slash ? t : undefined,
      ...opts.draw,
    }), { shade: 0, grime: opts.grime == null ? 3 : opts.grime, seed: 900 });
  }
  const def = CAST[name];
  if (!def) throw new Error(`no such figure: ${name}`);
  const p2 = runPose(opts.t == null ? 0.25 : opts.t, { amp: def.amp, lean: def.boss ? 2 : 3 });
  p2.phase = opts.t == null ? 0.25 : opts.t;
  return bakeAt(def.box, scale, (g) => def.draw(g, p2, { wind: def.wind, phase: 1.4 }),
    { shade: 0, grime: def.boss ? 10 : 5, seed: 1400 });
}

function bakeAt(box, scale, drawFn, finish) {
  const [l, t, r, b] = box;
  const S = PX_PER_UNIT * SS * scale;
  const c = makeCanvas((r - l) * S, (b - t) * S);
  const g = ctxOf(c);
  g.save();
  g.scale(S, S);
  g.translate(-l, -t);
  g.lineJoin = "round";
  g.lineCap = "round";
  drawFn(g);
  g.restore();
  if (finish.grime) grime(g, finish.seed || 7, finish.grime);
  return { canvas: c, ox: -l * S, oy: -t * S, w: c.width, h: c.height, scale };
}

/* ---------------------------------------------------------- */
/* The registry                                                */
/* ---------------------------------------------------------- */

/**
 * box = bake extents in figure units, frames = walk-cycle length.
 * `wind` scales how much hair/cloth reacts.
 */
export const CAST = {
  gaki: { draw: drawGaki, box: [-30, -80, 34, 6], frames: 6, amp: 0.75, wind: 2 },
  kamaitachi: { draw: drawKamaitachi, box: [-34, -60, 42, 6], frames: 6, amp: 1.25, wind: 3 },
  nurikabe: { draw: drawNurikabe, box: [-54, -92, 46, 8], frames: 6, amp: 0.5, wind: 1 },
  yurei: { draw: drawYurei, box: [-40, -92, 44, 24], frames: 6, amp: 0.5, wind: 3 },
  kappa: { draw: drawKappa, box: [-32, -72, 40, 6], frames: 6, amp: 0.85, wind: 2 },
  tsukumo: { draw: drawTsukumo, box: [-16, -46, 16, 11], frames: 6, amp: 1, wind: 1 },
  onryo: { draw: drawOnryo, box: [-50, -110, 56, 34], frames: 6, amp: 0.5, wind: 4 },
  mukade: { draw: drawMukade, box: [-46, -34, 42, 8], frames: 6, amp: 1, wind: 1 },
  gashadokuro: { draw: drawGashadokuro, box: [-86, -196, 96, 12], frames: 4, amp: 0.55, wind: 1, boss: true },
  oni: { draw: drawOni, box: [-70, -178, 88, 10], frames: 4, amp: 0.65, wind: 2, boss: true },
  nurarihyon: { draw: drawNurarihyon, box: [-70, -150, 74, 44], frames: 4, amp: 0.4, wind: 4, boss: true },
};

/* ---------------------------------------------------------- */
/* Bake                                                        */
/* ---------------------------------------------------------- */

/**
 * Bake the whole cast. Yields to the event loop between characters
 * so the boot screen can actually paint its progress bar.
 */
export async function bakeCast(onProgress) {
  const out = { hero: {}, cast: {} };
  const names = Object.keys(CAST);
  const total = names.length + 2;
  let done = 0;

  const step = async (label) => {
    done += 1;
    if (onProgress) onProgress(done / total, label);
    await new Promise((res) => setTimeout(res, 0));
  };

  // ---- Hero ----
  const heroBox = [-64, -144, 70, 10];   // top clears the greatsword tip
  const heroSlashBox = [-80, -154, 120, 18];
  out.hero.run = [];
  out.hero.idle = [];
  out.hero.slash = [];
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const pose = runPose(t, { amp: 1, lean: 4 });
    out.hero.run.push(bake(
      heroBox,
      (g) => drawHero(g, pose, { wind: 3 + Math.sin(t * Math.PI * 2) * 2.2, phase: t * 6, flare: 1.1 }),
      { shade: 0.28, grime: 3, seed: 900 + i },
    ));
  }
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    const pose = idlePose(t, { lean: 1.4 });
    out.hero.idle.push(bake(
      heroBox,
      (g) => drawHero(g, pose, { wind: 2 + Math.sin(t * Math.PI * 2) * 1.4, phase: t * 4, flare: 0.85 }),
      { shade: 0.28, grime: 3, seed: 920 + i },
    ));
  }
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const slash = heroSlashPose(t);
    out.hero.slash.push(bake(
      heroSlashBox,
      (g) => drawHero(g, slash.pose, {
        wind: 4.2 + Math.sin(t * Math.PI) * 2.6,
        phase: t * 5,
        flare: 1.4,
        slashAngle: slash.angle,
        slashProgress: t,
      }),
      { shade: 0.28, grime: 3, seed: 940 + i },
    ));
  }
  out.hero.variants = variants(out.hero.run[0]);
  // Per-frame blood silhouettes for the damage flash. Tinting the
  // hero with a source-atop fillRect at draw time instead paints the
  // whole rectangle red, because on the shared game canvas "atop"
  // means atop EVERYTHING already drawn there, not just the sprite.
  out.hero.hurtRun = out.hero.run.map((f) => silhouetteOf(f.canvas, PAL.blood));
  out.hero.hurtIdle = out.hero.idle.map((f) => silhouetteOf(f.canvas, PAL.blood));
  out.hero.hurtSlash = out.hero.slash.map((f) => silhouetteOf(f.canvas, PAL.blood));
  await step("Inking the swordsman");

  // ---- Portrait bust for the HUD ----
  out.hero.portrait = bakePortrait();
  await step("Drawing the title panel");

  // ---- Yokai ----
  for (const name of names) {
    const def = CAST[name];
    const frames = [];
    for (let i = 0; i < def.frames; i++) {
      const t = i / def.frames;
      const pose = runPose(t, { amp: def.amp, lean: def.boss ? 2 : 3 });
      pose.phase = t;
      frames.push(bake(
        def.box,
        (g) => def.draw(g, pose, { wind: def.wind * (1 + Math.sin(t * Math.PI * 2) * 0.4), phase: t * 5 }),
        {
          shade: def.boss ? 0.38 : 0.32,
          grime: def.boss ? 10 : 5,
          seed: 1000 + name.length * 37 + i * 13,
        },
      ));
    }
    out.cast[name] = {
      frames,
      variants: variants(frames[0]),
      flashFrames: frames.map((f) => silhouetteOf(f.canvas, PAL.paperLit)),
      inkFrames: frames.map((f) => silhouetteOf(f.canvas, PAL.ink)),
      boss: !!def.boss,
    };
    await step(`Summoning ${name}`);
  }

  return out;
}

/* ---------------------------------------------------------- */
/* HUD portrait                                                */
/* ---------------------------------------------------------- */

/**
 * A close-crop bust in the top-left panel, drawn at much higher
 * detail than the in-world sprite — the manga cover shot.
 */
function bakePortrait(size = 300) {
  const c = makeCanvas(size, size * 1.12);
  const g = ctxOf(c);
  const H = size * 1.12;

  g.fillStyle = PAL.paperLit;
  g.fillRect(0, 0, size, H);

  // Black ground wedge behind the head.
  g.save();
  g.fillStyle = PAL.ink;
  g.beginPath();
  g.moveTo(0, H);
  g.lineTo(0, H * 0.5);
  g.lineTo(size * 0.44, H * 0.28);
  g.lineTo(size, H * 0.56);
  g.lineTo(size, H);
  g.closePath();
  g.fill();
  g.restore();

  // Converging lines: the manga close-up device.
  const rand = rng(777);
  for (let i = 0; i < 54; i++) {
    const a = rand() * Math.PI * 2;
    const inner = size * (0.36 + rand() * 0.1);
    const outer = size * (0.62 + rand() * 0.5);
    brush(g, [
      [size * 0.5 + Math.cos(a) * inner, H * 0.42 + Math.sin(a) * inner],
      [size * 0.5 + Math.cos(a) * outer, H * 0.42 + Math.sin(a) * outer],
    ], { width: 0.6 + rand() * rand() * 3.4, taper: "start", jitter: 0.1, seed: i, colour: PAL.ink });
  }

  // Head at roughly 4x the in-world scale, fully rendered.
  const p = { ...HERO_P, headR: 42, h: 100, torsoW: 62 };
  g.save();
  g.translate(size * 0.5, H * 0.36);
  const rig = {
    headC: [0, 0], neck: [2, 58], chest: [2, 98], hip: [2, 152],
    arms: [], legs: [],
  };

  drawHairBack(g, rig, p, { wind: 6, phase: 1.2, len: H * 0.46, seed: 12, tips: 6 });

  // Shoulders and collar.
  shape(g, [
    [-size * 0.48, H * 0.6], [-size * 0.26, H * 0.36],
    [-size * 0.09, H * 0.31], [size * 0.11, H * 0.31],
    [size * 0.3, H * 0.37], [size * 0.5, H * 0.62],
  ], { fill: PAL.ink, line: 2.6, tension: 0.4, seed: 41 });

  drawNeck(g, rig, p, { fill: PAL.paperLit, line: 2.2, shade: 0.62 });
  drawHead(g, rig, p, {
    fill: PAL.paperLit, line: 2.8, shade: 0.5, seed: 45, gap: 3.0, stipple: 0.05,
  });
  faceHero(g, rig, p, { glare: 1, scar: true });
  drawHairFront(g, rig, p, { bangs: 6, seed: 12 });

  // Blood on the cheek — the only colour on the page.
  splat(g, 24, 16, 4.6, { seed: 5, colour: PAL.blood, drops: 3, rough: 0.7 });
  splat(g, 33, 29, 2.4, { seed: 9, colour: PAL.blood, drops: 2, rough: 0.8 });
  g.restore();

  return { canvas: c, w: size, h: H };
}
