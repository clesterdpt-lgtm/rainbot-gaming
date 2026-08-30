/* ============================================================
   INKBLOOD — fx.js
   Impacts, blood, lettering and the page itself.

   Two rules govern this file:

   1. COLOUR IS RATIONED. Ink black, paper white and screentone
      grey are free. Crimson is reserved for blood and for the
      player's own steel; violet is reserved for arcane energy and
      soul-shards. Nothing else may be coloured, ever. That
      restriction is the entire art direction — the moment a third
      hue appears the page stops looking like manga.

   2. NOTHING EXPENSIVE HAPPENS PER HIT. At full tilt the game
      resolves a few hundred hits a second. Every splat, spray and
      slash arc is therefore baked once at boot into a small atlas
      and blitted with a rotation, never re-inked live.
   ============================================================ */

"use strict";

import {
  PAL, makeCanvas, ctxOf, brush, splat, spray, rng, wobble, focusLines,
  starburst, boltPath, roughCircle, tone, inkText,
} from "./art.js?v=20260803-2";

/* ---------------------------------------------------------- */
/* Baked effect atlas                                          */
/* ---------------------------------------------------------- */

export const ATLAS = {
  bloodSplat: [],   // ground decals
  bloodBurst: [],   // directional sprays, anchored at the left edge
  inkHit: [],       // black impact blots
  slash: [],        // crimson brush arcs
  focus: [],        // 集中線 overlays
  gem: null,
  gemBig: null,
  coin: null,
  heart: null,
  chest: null,
  magnet: null,
  bomb: null,
};

export function bakeFx() {
  // --- Ground blood decals -------------------------------------
  for (let v = 0; v < 6; v++) {
    const S = 120;
    const c = makeCanvas(S, S);
    const g = ctxOf(c);
    const rand = rng(3100 + v * 17);
    splat(g, S / 2, S / 2, 20 + rand() * 14, {
      seed: 3100 + v, colour: PAL.blood, drops: 10, rough: 0.55, lobes: 7 + (v % 4),
    });
    // A darker core gives the pool depth without a second hue.
    splat(g, S / 2 + (rand() - 0.5) * 8, S / 2 + (rand() - 0.5) * 8, 10 + rand() * 8, {
      seed: 3200 + v, colour: PAL.bloodDeep, drops: 3, rough: 0.6,
    });
    ATLAS.bloodSplat.push(c);
  }

  // --- Directional blood bursts --------------------------------
  // Anchored at (0, H/2) and pointing +x so the caller only has to
  // translate to the wound and rotate.
  for (let v = 0; v < 6; v++) {
    const W = 200; const H = 150;
    const c = makeCanvas(W, H);
    const g = ctxOf(c);
    spray(g, 6, H / 2, 0, 1.05, 96 + v * 12, {
      seed: 4100 + v * 23, colour: PAL.blood, count: 12 + (v % 3) * 3, width: 5.5,
    });
    spray(g, 6, H / 2, 0, 0.5, 60, {
      seed: 4200 + v * 13, colour: PAL.bloodDeep, count: 5, width: 3.4,
    });
    ATLAS.bloodBurst.push(c);
  }

  // --- Ink impact blots ----------------------------------------
  for (let v = 0; v < 5; v++) {
    const S = 110;
    const c = makeCanvas(S, S);
    const g = ctxOf(c);
    const rand = rng(5100 + v * 31);
    // Radiating spikes then a ragged core: the classic manga "hit".
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rand() * 0.4;
      const l = 22 + rand() * 26;
      brush(g, [
        [S / 2 + Math.cos(a) * 8, S / 2 + Math.sin(a) * 8],
        [S / 2 + Math.cos(a) * l, S / 2 + Math.sin(a) * l],
      ], { width: 4 + rand() * 4, taper: "end", jitter: 0.2, seed: i + v * 7, colour: PAL.ink });
    }
    splat(g, S / 2, S / 2, 15, { seed: 5100 + v, colour: PAL.ink, drops: 6, rough: 0.5 });
    ATLAS.inkHit.push(c);
  }

  // --- Crimson slash arcs --------------------------------------
  // Anchored centre; a wide crescent sweeping through 0 radians.
  for (let v = 0; v < 4; v++) {
    const S = 260;
    const c = makeCanvas(S, S);
    const g = ctxOf(c);
    const R = S * 0.4;
    const spread = 2.1 + v * 0.16;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const a = -spread / 2 + spread * t;
      pts.push([S / 2 + Math.cos(a) * R, S / 2 + Math.sin(a) * R]);
    }
    // A cut is fat in the middle and vanishes at both tips. Without a
    // hard taper the arc reads as a bent bar, not a sword stroke.
    const press = (t) => Math.pow(Math.sin(Math.PI * t), 1.25);
    brush(g, pts, {
      width: 11 - v, jitter: 0.14, seed: 61 + v, colour: PAL.blood, press,
    });
    brush(g, pts.map((q) => [q[0] - 2.5, q[1] - 2.5]), {
      width: 3.6, jitter: 0.3, seed: 71 + v, colour: PAL.bloodHot, press,
    });
    // A thin leading edge, white, where the blade actually passed.
    brush(g, pts.map((q) => [(q[0] - S / 2) * 1.045 + S / 2, (q[1] - S / 2) * 1.045 + S / 2]), {
      width: 1.6, jitter: 0.2, seed: 66 + v, colour: PAL.paperLit, press,
    });
    // Trailing flick lines that make the arc feel fast.
    for (let i = 0; i < 7; i++) {
      const t = 0.12 + (i / 7) * 0.76;
      const a = -spread / 2 + spread * t;
      const r0 = R + 10 + (i % 3) * 5;
      const r1 = r0 + 16 + (i % 4) * 8;
      brush(g, [
        [S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0],
        [S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1],
      ], { width: 3, taper: "end", jitter: 0.2, seed: 81 + i + v * 5, colour: PAL.blood });
    }
    ATLAS.slash.push(c);
  }

  // --- Focus-line overlays -------------------------------------
  for (let v = 0; v < 2; v++) {
    ATLAS.focus.push(focusLines(1500, {
      seed: 91 + v * 7, count: 420, hole: 0.28, width: 5.5,
    }));
  }

  // --- Pickups -------------------------------------------------
  ATLAS.gem = bakeGem(21, PAL.arcane);
  ATLAS.gemBig = bakeGem(32, PAL.arcane, true);
  ATLAS.coin = bakeCoin(30);
  ATLAS.heart = bakeHeart(34);
  ATLAS.chest = bakeChest(58);
  ATLAS.magnet = bakeMagnet(38);
  ATLAS.bomb = bakeBomb(40);
}

/* ---------------------------------------------------------- */
/* Pickup art                                                  */
/* ---------------------------------------------------------- */

/**
 * Soul shard.
 *
 * Kept mostly WHITE with only a violet core. A hundred solid-violet
 * crystals on the floor at once turns the whole page purple and the
 * black-and-white premise dies; a hundred white crystals with a
 * violet heart still reads as ink-and-paper with points of colour
 * in it, which is the entire brief.
 */
function bakeGem(S, colour, big = false) {
  const c = makeCanvas(S, S * 1.25);
  const g = ctxOf(c);
  const w = S * 0.3;
  const h = S * 0.44;
  const cx = S / 2;
  const cy = S * 0.62;
  const facets = [
    [cx, cy - h], [cx + w, cy - h * 0.25], [cx + w * 0.62, cy + h],
    [cx - w * 0.62, cy + h], [cx - w, cy - h * 0.25],
  ];
  const path = () => {
    g.beginPath();
    facets.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
  };
  path();
  g.fillStyle = PAL.paperLit;
  g.fill();
  path();
  g.strokeStyle = PAL.ink;
  g.lineWidth = big ? 3 : 2.4;
  g.lineJoin = "round";
  g.stroke();

  // The violet lives only in the middle third.
  g.save();
  path();
  g.clip();
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(cx, cy - h * 0.42);
  g.lineTo(cx + w * 0.5, cy + h * 0.1);
  g.lineTo(cx, cy + h * 0.62);
  g.lineTo(cx - w * 0.5, cy + h * 0.1);
  g.closePath();
  g.fill();
  g.restore();

  // Cut facets in ink so it reads as a crystal, not a lozenge.
  g.strokeStyle = PAL.ink;
  g.lineWidth = big ? 1.6 : 1.2;
  g.beginPath();
  g.moveTo(cx, cy - h); g.lineTo(cx - w * 0.3, cy + h * 0.16); g.lineTo(cx - w * 0.62, cy + h);
  g.moveTo(cx, cy - h); g.lineTo(cx + w * 0.3, cy + h * 0.18);
  g.stroke();
  if (big) {
    starburst(g, cx + w * 0.42, cy - h * 0.5, S * 0.13,
      { points: 4, inner: 0.12, colour: PAL.arcane });
  }
  return c;
}

function bakeCoin(S) {
  const c = makeCanvas(S, S);
  const g = ctxOf(c);
  roughCircle(g, S / 2, S / 2, S * 0.36, 4, 0.04);
  g.fillStyle = PAL.paperLit;
  g.fill();
  g.strokeStyle = PAL.ink;
  g.lineWidth = 2.6;
  g.stroke();
  // Square hole — a mon, not a dollar.
  g.fillStyle = PAL.ink;
  g.fillRect(S / 2 - S * 0.09, S / 2 - S * 0.09, S * 0.18, S * 0.18);
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.26, Math.PI * 0.7, Math.PI * 1.35);
  g.strokeStyle = PAL.ink;
  g.lineWidth = 1.6;
  g.stroke();
  return c;
}

function bakeHeart(S) {
  const c = makeCanvas(S, S);
  const g = ctxOf(c);
  // A rice ball, not a heart — the healing item of the genre.
  g.beginPath();
  g.moveTo(S * 0.5, S * 0.18);
  g.quadraticCurveTo(S * 0.9, S * 0.72, S * 0.82, S * 0.8);
  g.lineTo(S * 0.18, S * 0.8);
  g.quadraticCurveTo(S * 0.1, S * 0.72, S * 0.5, S * 0.18);
  g.closePath();
  g.fillStyle = PAL.paperLit;
  g.fill();
  g.strokeStyle = PAL.ink;
  g.lineWidth = 2.6;
  g.lineJoin = "round";
  g.stroke();
  g.fillStyle = PAL.ink;
  g.fillRect(S * 0.3, S * 0.56, S * 0.4, S * 0.26);
  g.beginPath();
  g.moveTo(S * 0.36, S * 0.42);
  g.lineTo(S * 0.44, S * 0.34);
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 2;
  g.stroke();
  return c;
}

function bakeChest(S) {
  const c = makeCanvas(S, S * 0.82);
  const g = ctxOf(c);
  const H = S * 0.82;
  g.fillStyle = PAL.paperLit;
  g.beginPath();
  g.rect(S * 0.1, H * 0.4, S * 0.8, H * 0.5);
  g.fill();
  g.strokeStyle = PAL.ink;
  g.lineWidth = 3;
  g.stroke();
  g.beginPath();
  g.moveTo(S * 0.1, H * 0.42);
  g.quadraticCurveTo(S * 0.5, H * 0.02, S * 0.9, H * 0.42);
  g.closePath();
  g.fillStyle = PAL.ink;
  g.fill();
  g.fillStyle = PAL.ink;
  g.fillRect(S * 0.44, H * 0.38, S * 0.12, H * 0.24);
  g.strokeStyle = PAL.ink;
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(S * 0.1, H * 0.62); g.lineTo(S * 0.9, H * 0.62);
  g.stroke();
  return c;
}

function bakeMagnet(S) {
  const c = makeCanvas(S, S);
  const g = ctxOf(c);
  g.strokeStyle = PAL.ink;
  g.lineWidth = S * 0.2;
  g.lineCap = "butt";
  g.beginPath();
  g.arc(S / 2, S * 0.55, S * 0.28, Math.PI, 0);
  g.stroke();
  g.strokeStyle = PAL.arcane;
  g.lineWidth = S * 0.1;
  g.beginPath();
  g.moveTo(S * 0.22, S * 0.55); g.lineTo(S * 0.22, S * 0.8);
  g.moveTo(S * 0.78, S * 0.55); g.lineTo(S * 0.78, S * 0.8);
  g.stroke();
  return c;
}

function bakeBomb(S) {
  const c = makeCanvas(S, S);
  const g = ctxOf(c);
  roughCircle(g, S / 2, S * 0.6, S * 0.32, 7, 0.05);
  g.fillStyle = PAL.ink;
  g.fill();
  brush(g, [[S * 0.56, S * 0.3], [S * 0.68, S * 0.16], [S * 0.82, S * 0.2]],
    { width: 2.4, taper: "end", jitter: 0.2, seed: 5, colour: PAL.ink });
  starburst(g, S * 0.84, S * 0.18, S * 0.16, { points: 5, inner: 0.35, colour: PAL.blood });
  g.beginPath();
  g.arc(S * 0.4, S * 0.5, S * 0.07, 0, Math.PI * 2);
  g.fillStyle = PAL.paperLit;
  g.fill();
  return c;
}

/* ---------------------------------------------------------- */
/* Impact marks                                                */
/* ---------------------------------------------------------- */

/** Graphic marks, roughly ordered by how hard the hit was. */
export const SFX_WORDS = {
  light: ["!", "•", "×", ">", "/"],
  heavy: ["!!", "X", "//", "◆", "!"],
  huge: ["!!!", "✦", "X", "///", "◆"],
  crit: ["CRIT", "X", "✦", "!!"],
};

/** Compact, lightly outlined combat numbers that stay readable in a crowd. */
export const DAMAGE_NUMBER_STYLE = Object.freeze({
  normalFontPx: 21,
  critFontPx: 27,
  normalHalo: 1.8,
  critHalo: 2.6,
  normalOutline: 0.45,
  critOutline: 0.7,
  normalScale: 0.9,
  critScale: 1.15,
});

/* ---------------------------------------------------------- */
/* The effect system                                           */
/* ---------------------------------------------------------- */

export class Fx {
  constructor() {
    this.decals = [];     // persistent ground blood, oldest culled
    this.bursts = [];     // short-lived directional sprays
    this.hits = [];       // ink impact blots
    this.floaters = [];   // damage numbers
    this.words = [];      // graphic impact marks
    this.rings = [];      // expanding shockwaves
    this.slashes = [];    // crimson arcs
    this.dashes = [];     // authored Ink Step speed cuts
    this.eclipses = [];   // staged Blood Eclipse tableaux
    this.bolts = [];      // lightning
    this.motes = [];      // blood droplets / ink flecks
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeAmt = 0;
    this.focus = 0;       // 0..1 speed-line intensity
    this.focusTarget = 0;
    this.flash = 0;       // full-screen white/black flash
    this.flashInk = false;
    this.panel = null;    // dramatic panel takeover
    this.seed = 1;
    this.maxDecals = 150;
  }

  reset() {
    this.decals.length = 0; this.bursts.length = 0; this.hits.length = 0;
    this.floaters.length = 0; this.words.length = 0; this.rings.length = 0;
    this.slashes.length = 0; this.dashes.length = 0; this.eclipses.length = 0;
    this.bolts.length = 0; this.motes.length = 0;
    this.shakeAmt = 0; this.focus = 0; this.focusTarget = 0; this.flash = 0;
    this.panel = null;
  }

  nextSeed() { this.seed = (this.seed + 1) % 100000; return this.seed; }

  /* --- emitters --------------------------------------------- */

  shake(amount) {
    this.shakeAmt = Math.min(26, Math.max(this.shakeAmt, amount));
  }

  screenFlash(amount = 0.6, ink = false) {
    this.flash = Math.max(this.flash, amount);
    this.flashInk = ink;
  }

  /**
   * The standard "something got cut" package: an ink blot, a blood
   * burst along the hit direction, a scatter of droplets and a
   * damage number.
   */
  hit(x, y, dir, damage, opts = {}) {
    const s = this.nextSeed();
    const power = opts.power == null ? 1 : opts.power;

    this.hits.push({
      x, y, t: 0, life: 0.2 + power * 0.06,
      idx: s % ATLAS.inkHit.length,
      rot: (s * 0.7) % (Math.PI * 2),
      scale: (0.34 + power * 0.2) * (opts.big ? 1.8 : 1),
    });

    if (opts.blood !== false) {
      this.bursts.push({
        x, y, dir, t: 0, life: 0.26 + power * 0.05,
        idx: s % ATLAS.bloodBurst.length,
        scale: (0.4 + power * 0.25) * (opts.big ? 1.7 : 1),
      });
      const n = Math.min(14, 3 + Math.round(power * 4));
      for (let i = 0; i < n; i++) {
        const a = dir + (Math.random() - 0.5) * 1.5;
        const sp = 130 + Math.random() * 320 * power;
        this.motes.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
          r: 1.6 + Math.random() * 3.4 * power, t: 0,
          life: 0.4 + Math.random() * 0.5, colour: PAL.blood, gravity: 900, decal: true,
        });
      }
    }

    if (damage != null && opts.number !== false) {
      this.damage(x, y - 12, damage, opts.crit);
    }
  }

  damage(x, y, value, crit = false) {
    this.floaters.push({
      x: x + (Math.random() - 0.5) * 14,
      y,
      vy: -78 - Math.random() * 34,
      vx: (Math.random() - 0.5) * 46,
      t: 0,
      life: crit ? 1.15 : 0.82,
      text: String(Math.max(1, Math.round(value))),
      crit,
      rot: (Math.random() - 0.5) * 0.3,
      scale: crit ? DAMAGE_NUMBER_STYLE.critScale : DAMAGE_NUMBER_STYLE.normalScale,
    });
  }

  word(x, y, tier = "light", opts = {}) {
    const pool = SFX_WORDS[tier] || SFX_WORDS.light;
    const text = opts.text || pool[(Math.random() * pool.length) | 0];
    this.words.push({
      x, y, t: 0,
      life: opts.life || 0.7,
      text, tier,
      rot: opts.rot == null ? (Math.random() - 0.5) * 0.42 : opts.rot,
      scale: opts.scale || 1,
      vy: opts.vy == null ? -26 : opts.vy,
      colour: opts.colour || PAL.ink,
      drift: opts.drift == null ? (Math.random() - 0.5) * 30 : opts.drift,
    });
  }

  ring(x, y, r0, r1, life, opts = {}) {
    this.rings.push({
      x, y, r0, r1, t: 0, life,
      colour: opts.colour || PAL.blood,
      width: opts.width || 8,
      spokes: opts.spokes || 0,
      seed: this.nextSeed(),
      follow: opts.follow || null,
    });
  }

  slash(x, y, angle, scale, opts = {}) {
    this.slashes.push({
      x, y, angle, scale, t: 0,
      life: opts.life || 0.24,
      idx: this.nextSeed() % ATLAS.slash.length,
      colour: opts.colour || null,
      follow: opts.follow || null,
    });
  }

  /** Three dry-brush cuts preview the full path of an Ink Step. */
  dash(x0, y0, x1, y1, opts = {}) {
    this.dashes.push({
      x0, y0, x1, y1,
      t: 0,
      life: opts.life || 0.34,
      colour: opts.colour || PAL.blood,
      seed: this.nextSeed(),
    });
  }

  /** One effect owns the Eclipse wind-up, black sun and impact bloom. */
  eclipse(x, y, radius, life, opts = {}) {
    this.eclipses.push({
      x, y, radius,
      t: 0,
      life: life || 0.82,
      impactAt: opts.impactAt == null ? 0.38 : opts.impactAt,
      follow: opts.follow || null,
      offsetX: opts.offsetX || 0,
      offsetY: opts.offsetY || 0,
      seed: this.nextSeed(),
    });
  }

  bolt(x0, y0, x1, y1, opts = {}) {
    const seed = this.nextSeed();
    const pts = boltPath(x0, y0, x1, y1, opts.segments || 14, opts.amp || 64, seed);
    // Two short branches off random joints — lightning that never
    // forks reads as a ribbon, not a discharge.
    const forks = [];
    for (let i = 0; i < 2; i++) {
      const j = 3 + ((seed + i * 5) % Math.max(1, pts.length - 6));
      const a = pts[j];
      const b = pts[Math.min(pts.length - 1, j + 2)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const side = i % 2 ? 1 : -1;
      forks.push(boltPath(a[0], a[1],
        a[0] + dx * 1.6 + dy * 0.9 * side, a[1] + dy * 1.6 - dx * 0.9 * side,
        5, 22, seed + i * 17));
    }
    this.bolts.push({
      pts, forks,
      t: 0, life: opts.life || 0.22,
      colour: opts.colour || PAL.arcane,
      width: opts.width || 6,
    });
  }

  /** Ground blood that persists — the battlefield accumulates. */
  stain(x, y, scale = 1) {
    const s = this.nextSeed();
    this.decals.push({
      x, y, idx: s % ATLAS.bloodSplat.length,
      rot: (s * 1.37) % (Math.PI * 2),
      scale: scale * (0.5 + Math.random() * 0.55),
      t: 0, life: 14 + Math.random() * 8,
    });
    if (this.decals.length > this.maxDecals) this.decals.shift();
  }

  motesBurst(x, y, count, colour, speed = 240, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.35 + Math.random());
      this.motes.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        r: (opts.r || 3) * (0.4 + Math.random()), t: 0,
        life: opts.life || 0.5 + Math.random() * 0.4,
        colour, gravity: opts.gravity == null ? 700 : opts.gravity,
        decal: !!opts.decal,
      });
    }
  }

  /** A full-screen dramatic panel: boss reveal, level up, death. */
  showPanel(kind, payload, life = 1.6) {
    this.panel = { kind, payload, t: 0, life };
  }

  /* --- update ------------------------------------------------ */

  update(dt) {
    const decay = (arr) => {
      for (let i = arr.length - 1; i >= 0; i--) {
        arr[i].t += dt;
        if (arr[i].t >= arr[i].life) arr.splice(i, 1);
      }
    };

    decay(this.hits);
    decay(this.bursts);
    decay(this.rings);
    decay(this.slashes);
    decay(this.dashes);
    decay(this.eclipses);
    decay(this.bolts);
    decay(this.decals);

    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      f.y += f.vy * dt;
      f.x += f.vx * dt;
      f.vy += 150 * dt;
      f.vx *= 1 - 2.2 * dt;
      if (f.t >= f.life) this.floaters.splice(i, 1);
    }

    for (let i = this.words.length - 1; i >= 0; i--) {
      const w = this.words[i];
      w.t += dt;
      w.y += w.vy * dt;
      w.x += w.drift * dt;
      w.vy *= 1 - 1.4 * dt;
      if (w.t >= w.life) this.words.splice(i, 1);
    }

    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      m.t += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.vy += m.gravity * dt;
      m.vx *= 1 - 1.1 * dt;
      if (m.t >= m.life) {
        if (m.decal && m.r > 2.2) this.stain(m.x, m.y, m.r * 0.16);
        this.motes.splice(i, 1);
      }
    }

    // Shake decays fast and is re-randomised per frame.
    this.shakeAmt *= Math.pow(0.0016, dt);
    if (this.shakeAmt < 0.05) this.shakeAmt = 0;
    this.shakeX = (Math.random() - 0.5) * 2 * this.shakeAmt;
    this.shakeY = (Math.random() - 0.5) * 2 * this.shakeAmt;

    this.focus += (this.focusTarget - this.focus) * Math.min(1, dt * 4);
    this.focusTarget *= Math.pow(0.25, dt);
    this.flash *= Math.pow(0.0009, dt);
    if (this.flash < 0.01) this.flash = 0;

    if (this.panel) {
      this.panel.t += dt;
      if (this.panel.t >= this.panel.life) this.panel = null;
    }
  }

  /* --- draw -------------------------------------------------- */

  /** Ground layer: stains only. Drawn under every entity. */
  drawGround(g) {
    for (const d of this.decals) {
      const fade = d.t > d.life - 3 ? Math.max(0, (d.life - d.t) / 3) : 1;
      const img = ATLAS.bloodSplat[d.idx];
      g.save();
      g.globalAlpha = 0.82 * fade;
      g.translate(d.x, d.y);
      g.rotate(d.rot);
      g.scale(d.scale, d.scale * 0.62);   // squashed: it is on the floor
      g.drawImage(img, -img.width / 2, -img.height / 2);
      g.restore();
    }
  }

  /** Mid layer: impacts and energy, drawn over the entities. */
  drawWorld(g) {
    for (const d of this.dashes) {
      const k = d.t / d.life;
      const dx = d.x1 - d.x0;
      const dy = d.y1 - d.y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const drawCut = (offset, width, colour, seed) => {
        const lead = 0.02 + k * 0.2;
        const tail = Math.min(1, 0.8 + k * 0.35);
        brush(g, [
          [d.x0 + dx * lead + nx * offset, d.y0 + dy * lead + ny * offset],
          [d.x0 + dx * tail + nx * offset, d.y0 + dy * tail + ny * offset],
        ], { width, taper: "both", jitter: 0.3, seed, colour });
      };
      g.save();
      g.globalAlpha = Math.max(0, 1 - k * k);
      drawCut(5, 12 * (1 - k * 0.5), PAL.paperLit, d.seed + 1);
      drawCut(2, 7 * (1 - k * 0.55), PAL.ink, d.seed + 2);
      drawCut(0, 3.6 * (1 - k * 0.6), d.colour, d.seed + 3);
      drawCut(-12, 2.6 * (1 - k), PAL.ink, d.seed + 4);
      drawCut(16, 1.8 * (1 - k), d.colour, d.seed + 5);
      g.restore();
    }

    for (const e of this.eclipses) {
      const k = e.t / e.life;
      const cx = e.follow ? e.follow.x + e.offsetX : e.x;
      const cy = e.follow ? e.follow.y + e.offsetY : e.y;
      const impact = Math.max(0.05, e.impactAt);
      g.save();
      if (k < impact) {
        const q = k / impact;
        const outer = e.radius * (0.78 - q * 0.63);
        const moon = 12 + 35 * Math.pow(q, 1.7);
        g.globalAlpha = 0.22 + q * 0.72;
        g.fillStyle = PAL.ink;
        roughCircle(g, cx, cy, moon, e.seed, 0.075);
        g.fill();
        g.strokeStyle = PAL.arcaneHot;
        g.lineWidth = 8 - q * 3;
        roughCircle(g, cx, cy, outer, e.seed + 2, 0.035);
        g.stroke();
        g.strokeStyle = PAL.blood;
        g.lineWidth = 3.5;
        roughCircle(g, cx, cy, outer + 12, e.seed + 3, 0.05);
        g.stroke();
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + e.seed * 0.13;
          const r0 = outer + 18;
          const r1 = outer + 52 + (i % 3) * 8;
          brush(g, [
            [cx + Math.cos(a) * r0, cy + Math.sin(a) * r0],
            [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1],
          ], { width: 2.4, taper: "both", jitter: 0.25, seed: e.seed + i, colour: PAL.ink });
        }
      } else {
        const q = (k - impact) / (1 - impact);
        const rad = 35 + (e.radius - 35) * Math.pow(q, 0.52);
        g.globalAlpha = Math.max(0, 1 - q * q);
        g.strokeStyle = PAL.ink;
        g.lineWidth = 19 * (1 - q * 0.72);
        roughCircle(g, cx, cy, rad + 4, e.seed + 4, 0.065);
        g.stroke();
        g.strokeStyle = PAL.blood;
        g.lineWidth = 10 * (1 - q * 0.62);
        roughCircle(g, cx, cy, rad, e.seed + 5, 0.055);
        g.stroke();
        g.strokeStyle = PAL.paperLit;
        g.lineWidth = 2.2 * (1 - q);
        roughCircle(g, cx, cy, rad - 8, e.seed + 6, 0.04);
        g.stroke();
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2 + e.seed * 0.07;
          const inner = rad * (0.68 + (i % 2) * 0.08);
          const outer = rad * (1.08 + (i % 3) * 0.07);
          brush(g, [
            [cx + Math.cos(a) * inner, cy + Math.sin(a) * inner],
            [cx + Math.cos(a) * outer, cy + Math.sin(a) * outer],
          ], {
            width: 4.8 * (1 - q * 0.72), taper: "both", jitter: 0.3,
            seed: e.seed + 30 + i, colour: i % 4 === 0 ? PAL.blood : PAL.ink,
          });
        }
      }
      g.restore();
    }

    for (const s of this.slashes) {
      const k = s.t / s.life;
      const img = ATLAS.slash[s.idx];
      const x = s.follow ? s.follow.x : s.x;
      const y = s.follow ? s.follow.y : s.y;
      g.save();
      g.globalAlpha = 1 - k * k;
      g.translate(x, y);
      g.rotate(s.angle);
      const sc = s.scale * (0.86 + k * 0.3);
      g.scale(sc, sc);
      g.drawImage(img, -img.width / 2, -img.height / 2);
      g.restore();
    }

    for (const b of this.bursts) {
      const k = b.t / b.life;
      const img = ATLAS.bloodBurst[b.idx];
      g.save();
      g.globalAlpha = 1 - k;
      g.translate(b.x, b.y);
      g.rotate(b.dir);
      const sc = b.scale * (0.7 + k * 0.55);
      g.scale(sc, sc);
      g.drawImage(img, 0, -img.height / 2);
      g.restore();
    }

    for (const h of this.hits) {
      const k = h.t / h.life;
      const img = ATLAS.inkHit[h.idx];
      g.save();
      g.globalAlpha = 1 - k * k;
      g.translate(h.x, h.y);
      g.rotate(h.rot);
      const sc = h.scale * (0.6 + k * 0.7);
      g.scale(sc, sc);
      g.drawImage(img, -img.width / 2, -img.height / 2);
      g.restore();
    }

    for (const r of this.rings) {
      const k = r.t / r.life;
      const rad = r.r0 + (r.r1 - r.r0) * Math.pow(k, 0.62);
      const cx = r.follow ? r.follow.x : r.x;
      const cy = r.follow ? r.follow.y : r.y;
      g.save();
      g.globalAlpha = (1 - k) * 0.95;
      // Ink first so the coloured ring has a drawn edge.
      g.strokeStyle = PAL.ink;
      g.lineWidth = r.width * (1 - k * 0.55) * 0.5;
      roughCircle(g, cx, cy, rad + 2, r.seed + 1, 0.05);
      g.stroke();
      g.strokeStyle = r.colour;
      g.lineWidth = r.width * (1 - k * 0.55);
      roughCircle(g, cx, cy, rad, r.seed, 0.045);
      g.stroke();
      if (r.spokes) {
        g.lineWidth = r.width * 0.4;
        for (let i = 0; i < r.spokes; i++) {
          const a = (i / r.spokes) * Math.PI * 2 + r.seed;
          g.beginPath();
          g.moveTo(cx + Math.cos(a) * rad * 0.86, cy + Math.sin(a) * rad * 0.86);
          g.lineTo(cx + Math.cos(a) * rad * 1.2, cy + Math.sin(a) * rad * 1.2);
          g.stroke();
        }
      }
      g.restore();
    }

    for (const b of this.bolts) {
      const k = b.t / b.life;
      g.save();
      g.globalAlpha = 1 - k;
      // Ink shadow, coloured body, white core. Without the ink the
      // bolt is a soft violet band with nothing holding its edge.
      brush(g, b.pts.map((q) => [q[0] + 2.5, q[1] + 2.5]),
        { width: b.width * 0.5, taper: "both", jitter: 0.2, seed: 2, colour: PAL.ink });
      brush(g, b.pts, { width: b.width * 0.42, taper: "both", jitter: 0.2, seed: 3, colour: b.colour });
      brush(g, b.pts, { width: b.width * 0.16, taper: "both", jitter: 0.15, seed: 4, colour: PAL.paperLit });
      // Forks off the main channel.
      if (b.forks) {
        for (const fk of b.forks) {
          brush(g, fk, { width: b.width * 0.2, taper: "end", jitter: 0.25, seed: 5, colour: b.colour });
          brush(g, fk, { width: b.width * 0.08, taper: "end", jitter: 0.2, seed: 6, colour: PAL.paperLit });
        }
      }
      g.restore();
    }

    for (const m of this.motes) {
      const k = m.t / m.life;
      g.globalAlpha = 1 - k * k;
      g.fillStyle = m.colour;
      g.beginPath();
      g.ellipse(m.x, m.y, m.r, m.r * 0.8, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /** Impact marks and numbers, drawn last so they are never occluded. */
  drawText(g, fonts) {
    for (const w of this.words) {
      const k = w.t / w.life;
      const pop = k < 0.18 ? k / 0.18 : 1;
      const sc = w.scale * (0.7 + pop * 0.4) * (1 + k * 0.12);
      g.save();
      g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      g.translate(w.x, w.y);
      g.rotate(w.rot);
      g.scale(sc, sc);
      // Procedural speed/impact strokes carry the manga energy that
      // used to come from repeated katakana, while the central mark
      // stays legible at thumbnail size.
      if (w.tier === "huge") {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          brush(g, [[Math.cos(a) * 29, Math.sin(a) * 29], [Math.cos(a) * 50, Math.sin(a) * 50]],
            { width: 2.2, taper: "end", jitter: 0.16, seed: 90 + i, colour: w.colour });
        }
      } else if (w.tier === "heavy" || w.tier === "crit") {
        brush(g, [[-38, 25], [38, -25]],
          { width: 2.4, taper: "both", jitter: 0.16, seed: 98, colour: w.colour });
        brush(g, [[-30, -26], [30, 26]],
          { width: 1.4, taper: "both", jitter: 0.16, seed: 99, colour: w.colour });
      } else {
        brush(g, [[-34, 15], [-18, 5]],
          { width: 1.5, taper: "both", jitter: 0.14, seed: 100, colour: w.colour });
      }
      inkText(g, w.text, 0, 0, {
        font: fonts.display(w.text.length > 3 ? 31 : 39),
        halo: 5,
        outline: 2.2,
        colour: w.colour,
        align: "center",
        baseline: "middle",
      });
      g.restore();
    }

    for (const f of this.floaters) {
      const k = f.t / f.life;
      const pop = k < 0.12 ? k / 0.12 : 1;
      g.save();
      g.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      g.translate(f.x, f.y);
      g.rotate(f.rot);
      const sc = f.scale * (0.55 + pop * 0.5);
      g.scale(sc, sc);
      inkText(g, f.text, 0, 0, {
        font: fonts.display(f.crit ? DAMAGE_NUMBER_STYLE.critFontPx : DAMAGE_NUMBER_STYLE.normalFontPx),
        halo: f.crit ? DAMAGE_NUMBER_STYLE.critHalo : DAMAGE_NUMBER_STYLE.normalHalo,
        outline: f.crit ? DAMAGE_NUMBER_STYLE.critOutline : DAMAGE_NUMBER_STYLE.normalOutline,
        colour: f.crit ? PAL.blood : PAL.ink,
        align: "center",
        baseline: "middle",
      });
      g.restore();
    }
    g.globalAlpha = 1;
  }

  /** Screen-space overlays: focus lines and flashes. */
  drawOverlay(g, w, h, cx, cy) {
    if (this.focus > 0.02) {
      const img = ATLAS.focus[0];
      const size = Math.max(w, h) * 2.1;
      g.save();
      g.globalAlpha = Math.min(0.85, this.focus);
      g.translate(cx, cy);
      g.rotate(this.focus * 0.2);
      g.drawImage(img, -size / 2, -size / 2, size, size);
      g.restore();
    }
    if (this.flash > 0.01) {
      g.save();
      g.globalAlpha = Math.min(1, this.flash);
      g.fillStyle = this.flashInk ? PAL.ink : PAL.paperLit;
      g.fillRect(0, 0, w, h);
      g.restore();
    }
  }
}
