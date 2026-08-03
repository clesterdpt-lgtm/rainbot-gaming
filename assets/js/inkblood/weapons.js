/* ============================================================
   INKBLOOD — weapons.js

   Nine attack lines, each with a max-level evolution that needs a
   specific passive maxed alongside it.

   A weapon is data plus two optional hooks:

     stats(level)      -> the numbers at that level, BEFORE the
                          player's global multipliers
     fire(ctx, w)      -> called when the cooldown elapses
     tick(ctx, w, dt)  -> called every frame (orbitals, auras)

   `ctx` is the live game facade defined in game.js: it exposes the
   player, the enemy query helpers, the projectile pool, the fx
   system and the audio bus. Weapons never touch globals.

   Projectiles are plain objects in one pooled array. `kind` picks
   the motion integrator, `art` picks the renderer. Keeping those
   separate means a homing projectile can look like a talisman or a
   crow without duplicating any movement code.
   ============================================================ */

"use strict";

import {
  PAL, makeCanvas, ctxOf, brush, splat, rng, starburst, roughCircle, boltPath,
} from "./art.js?v=20260803-1";
import { shape, smoothPath, gloss } from "./figure.js?v=20260803-1";

/* ---------------------------------------------------------- */
/* Projectile art                                              */
/* ---------------------------------------------------------- */

export const WEP_ART = { kunai: null, ofuda: null, crow: [], sickle: null, fang: null };

export function bakeWeaponArt() {
  // Kunai — anchored centre, pointing +x.
  WEP_ART.kunai = (() => {
    const c = makeCanvas(56, 24);
    const g = ctxOf(c);
    shape(g, [[6, 12], [30, 5], [50, 12], [30, 19]],
      { fill: PAL.paperLit, line: 2.2, tension: 0.05 });
    brush(g, [[10, 12], [44, 12]], { width: 1, taper: "both", jitter: 0.1, seed: 2, colour: PAL.ink });
    shape(g, [[2, 9], [10, 9], [10, 15], [2, 15]], { fill: PAL.ink, line: 1.6, tension: 0.02 });
    g.beginPath();
    g.arc(4, 12, 4.4, 0, Math.PI * 2);
    g.strokeStyle = PAL.ink;
    g.lineWidth = 2;
    g.stroke();
    return c;
  })();

  // Ofuda — a paper charm with a crimson seal.
  WEP_ART.ofuda = (() => {
    const c = makeCanvas(34, 62);
    const g = ctxOf(c);
    shape(g, [[6, 4], [28, 4], [28, 52], [17, 60], [6, 52]],
      { fill: PAL.paperLit, line: 2.4, tension: 0.05 });
    for (let i = 0; i < 3; i++) {
      brush(g, [[12, 14 + i * 12], [22, 14 + i * 12]],
        { width: 1.8, taper: "both", jitter: 0.3, seed: 10 + i, colour: PAL.blood });
    }
    brush(g, [[17, 12], [17, 46]], { width: 1.4, taper: "both", jitter: 0.3, seed: 20, colour: PAL.blood });
    return c;
  })();

  // Ink crows, seen from above with wings spread.
  //
  // Drawn as ONE closed silhouette. A body with separate wing shapes
  // laid over it merges into an unreadable blob the moment it is
  // solid black, and these are solid black by definition — so the
  // bird has to be legible from its outline alone. Top-down also
  // matches the camera, which the side view never did.
  for (let v = 0; v < 2; v++) {
    WEP_ART.crow.push((() => {
      const W = 96;
      const H = 76;
      const c = makeCanvas(W, H);
      const g = ctxOf(c);
      const cy = H / 2;
      const spread = v === 0 ? 1 : 0.52;      // wings up / wings pulled in
      const sweep = v === 0 ? 0 : 8;

      const wingTip = 30 * spread;
      const pts = [
        [78, cy],                                     // beak
        [64, cy - 7],                                 // head
        [53, cy - 11],                                // shoulder
        [36 + sweep, cy - 30 * spread],               // leading edge
        [12 + sweep, cy - wingTip],                   // wingtip
        [30 + sweep, cy - 13],                        // trailing edge
        [12, cy - 11],                                // tail root
        [1, cy - 5], [1, cy + 5],                     // tail fan
        [12, cy + 11],
        [30 + sweep, cy + 13],
        [12 + sweep, cy + wingTip],
        [36 + sweep, cy + 30 * spread],
        [53, cy + 11],
        [64, cy + 7],
      ];
      shape(g, pts, { fill: PAL.ink, line: 2.2, tension: 0.3, seed: 300 + v, rim: false });

      // Primaries: white gaps cut into each wing so the silhouette
      // has feathers rather than being a pair of paddles.
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const t = 0.3 + i * 0.22;
          brush(g, [
            [34 + sweep - i * 3, cy + side * 14],
            [16 + sweep + i * 4, cy + side * (wingTip - 4 - i * 3)],
          ], { width: 0.7, taper: "end", jitter: 0.2, seed: 310 + v * 9 + i + (side + 1) * 3, colour: PAL.paperLit });
        }
      }
      // Tail feathers.
      for (let i = -1; i <= 1; i++) {
        brush(g, [[12, cy + i * 4], [3, cy + i * 5]],
          { width: 0.55, taper: "end", jitter: 0.2, seed: 330 + v * 3 + i, colour: PAL.paperLit });
      }
      // Eye.
      g.beginPath();
      g.arc(62, cy - 3, 2.6, 0, Math.PI * 2);
      g.fillStyle = PAL.paperLit;
      g.fill();
      g.beginPath();
      g.arc(62.4, cy - 3, 1.2, 0, Math.PI * 2);
      g.fillStyle = PAL.ink;
      g.fill();
      return c;
    })());
  }

  // Kusarigama sickle head.
  WEP_ART.sickle = (() => {
    const c = makeCanvas(70, 60);
    const g = ctxOf(c);
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * 0.85 - (i / 12) * Math.PI * 1.15;
      pts.push([34 + Math.cos(a) * 26, 34 + Math.sin(a) * 26]);
    }
    brush(g, pts, { width: 5.5, taper: "end", jitter: 0.06, seed: 3, colour: PAL.paperLit });
    brush(g, pts, { width: 1.6, taper: "end", jitter: 0.06, seed: 4, colour: PAL.ink });
    shape(g, [[24, 30], [40, 30], [40, 44], [24, 44]], { fill: PAL.ink, line: 2, tension: 0.05 });
    return c;
  })();

  // Blood fang: the Crimson Arc's follow-up shard.
  WEP_ART.fang = (() => {
    const c = makeCanvas(54, 26);
    const g = ctxOf(c);
    shape(g, [[2, 13], [26, 4], [52, 13], [26, 22]],
      { fill: PAL.blood, line: 2.2, tension: 0.05 });
    brush(g, [[10, 13], [42, 11]], { width: 1.4, taper: "both", jitter: 0.2, seed: 5, colour: PAL.bloodHot });
    return c;
  })();
}

/* ---------------------------------------------------------- */
/* Projectile factory                                          */
/* ---------------------------------------------------------- */

export function makeProjectile(o) {
  return {
    dead: false,
    x: 0, y: 0, vx: 0, vy: 0,
    kind: "linear",
    art: "kunai",
    damage: 10,
    pierce: 1,
    hits: null,          // Set of enemy ids already struck
    life: 2,
    t: 0,
    r: 16,
    rot: 0,
    spin: 0,
    knockback: 90,
    owner: null,
    crit: 0,
    hitCooldown: 0,      // for lingering areas: seconds between reticks
    reticks: null,       // Map enemyId -> next allowed hit time
    ...o,
  };
}

/* ---------------------------------------------------------- */
/* Motion integrators                                          */
/* ---------------------------------------------------------- */

export function stepProjectile(p, dt, ctx) {
  p.t += dt;
  switch (p.kind) {
    case "linear":
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      break;

    case "gravity":
      p.vy += 620 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      break;

    case "homing": {
      const target = p.target && !p.target.dead ? p.target : ctx.nearestEnemy(p.x, p.y, 900);
      p.target = target;
      if (target) {
        const dx = target.x - p.x;
        const dy = target.y - p.y - target.h * 0.4;
        const d = Math.hypot(dx, dy) || 1;
        const turn = (p.turn || 7) * dt;
        p.vx += (dx / d * p.speed - p.vx) * Math.min(1, turn);
        p.vy += (dy / d * p.speed - p.vy) * Math.min(1, turn);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      break;
    }

    case "orbit": {
      const a = p.baseAngle + p.t * p.orbitSpeed;
      const radius = p.orbitR * (1 + Math.sin(p.t * 2.4) * 0.06);
      p.x = ctx.player.x + Math.cos(a) * radius;
      p.y = ctx.player.y - ctx.player.h * 0.35 + Math.sin(a) * radius * 0.62;
      p.rot = a + Math.PI / 2;
      break;
    }

    case "anchor":
      // Locked to the player: auras and mandalas.
      p.x = ctx.player.x;
      p.y = ctx.player.y - ctx.player.h * 0.35;
      break;

    case "boomerang": {
      const k = p.t / p.life;
      const ease = Math.sin(k * Math.PI);
      p.x = p.ox + p.dx * ease * p.reach;
      p.y = p.oy + p.dy * ease * p.reach;
      p.rot += p.spin * dt;
      break;
    }

    case "static":
      break;

    default:
      p.x += p.vx * dt;
      p.y += p.vy * dt;
  }

  p.rot += p.spin * dt;
  if (p.kind === "linear" || p.kind === "homing") {
    if (p.faceVelocity !== false) p.rot = Math.atan2(p.vy, p.vx);
  }
  if (p.t >= p.life) p.dead = true;
}

/* ---------------------------------------------------------- */
/* Projectile rendering                                        */
/* ---------------------------------------------------------- */

export function drawProjectile(g, p) {
  const fade = p.t > p.life - 0.18 ? Math.max(0, (p.life - p.t) / 0.18) : 1;
  g.save();
  g.globalAlpha = fade;
  g.translate(p.x, p.y);

  switch (p.art) {
    case "kunai":
    case "fang": {
      const img = p.art === "kunai" ? WEP_ART.kunai : WEP_ART.fang;
      g.rotate(p.rot);
      const s = p.scale || 1;
      g.drawImage(img, -img.width * 0.5 * s, -img.height * 0.5 * s, img.width * s, img.height * s);
      break;
    }
    case "ofuda": {
      const img = WEP_ART.ofuda;
      g.rotate(p.rot + Math.PI / 2 + Math.sin(p.t * 9) * 0.24);
      const s = p.scale || 1;
      g.drawImage(img, -img.width * 0.5 * s, -img.height * 0.5 * s, img.width * s, img.height * s);
      break;
    }
    case "crow": {
      const img = WEP_ART.crow[(p.t * 7) % 2 < 1 ? 0 : 1];
      // Face along the orbit, and squash vertically to sit in the
      // same flattened perspective as the rest of the world.
      g.rotate(p.rot - Math.PI / 2);
      const s = p.scale || 1;
      g.scale(s, s * 0.82);
      g.drawImage(img, -img.width / 2, -img.height / 2);
      break;
    }
    case "sickle": {
      const img = WEP_ART.sickle;
      g.rotate(p.rot);
      const s = p.scale || 1;
      g.drawImage(img, -img.width * 0.5 * s, -img.height * 0.5 * s, img.width * s, img.height * s);
      break;
    }
    case "aura": {
      // A drawn ring, not a coloured disc. A wide translucent violet
      // circle at this radius covers a third of the screen and turns
      // the page lavender, which breaks the one rule the art has.
      const pulse = 1 + Math.sin(p.t * 4) * 0.03;
      const R = p.r * pulse;
      g.globalAlpha = fade * 0.85;
      g.strokeStyle = PAL.ink;
      g.lineWidth = 2.4;
      roughCircle(g, 0, 0, R, 3, 0.05);
      g.stroke();
      g.globalAlpha = fade * 0.55;
      g.strokeStyle = PAL.arcane;
      g.lineWidth = 1.6;
      roughCircle(g, 0, 0, R * 0.965, 11, 0.06);
      g.stroke();
      // Ticks around the rim, like a summoning circle.
      g.globalAlpha = fade * 0.7;
      g.strokeStyle = PAL.ink;
      g.lineWidth = 1.8;
      for (let i = 0; i < 18; i++) {
        const a = p.t * 0.5 + (i / 18) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9);
        g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
        g.stroke();
      }
      for (let i = 0; i < 4; i++) {
        const a = p.t * 1.2 + (i / 4) * Math.PI * 2;
        g.globalAlpha = fade * 0.9;
        starburst(g, Math.cos(a) * R * 0.94, Math.sin(a) * R * 0.94, 6,
          { points: 4, inner: 0.18, rot: a, colour: PAL.arcane });
      }
      break;
    }
    case "nova": {
      const k = p.t / p.life;
      g.globalAlpha = fade * (1 - k * 0.5);
      g.strokeStyle = PAL.blood;
      g.lineWidth = 10 * (1 - k * 0.5);
      roughCircle(g, 0, 0, p.r, 5, 0.05);
      g.stroke();
      g.strokeStyle = PAL.bloodHot;
      g.lineWidth = 3;
      roughCircle(g, 0, 0, p.r * 0.93, 9, 0.06);
      g.stroke();
      break;
    }
    case "beam": {
      const k = p.t / p.life;
      g.globalAlpha = fade * (1 - k * 0.4);
      g.rotate(p.rot);
      const L = p.length;
      const W = p.r;
      // A tapered crimson wedge with white speed lines inside.
      shape(g, [[0, -W * 0.5], [L, -W * 0.16], [L, W * 0.16], [0, W * 0.5]],
        { fill: PAL.blood, line: 0, tension: 0.02 });
      g.globalAlpha = fade * 0.9;
      for (let i = 0; i < 6; i++) {
        const yy = (-W * 0.32) + (i / 5) * W * 0.64;
        brush(g, [[L * 0.06, yy], [L * 0.94, yy * 0.4]],
          { width: 1.8, taper: "both", jitter: 0.2, seed: 40 + i, colour: PAL.paperLit });
      }
      break;
    }
    default:
      break;
  }
  g.restore();
}

/* ---------------------------------------------------------- */
/* Helpers used by fire()                                      */
/* ---------------------------------------------------------- */

function spawn(ctx, o) {
  const p = makeProjectile(o);
  p.hits = new Set();
  ctx.projectiles.push(p);
  return p;
}

const TAU = Math.PI * 2;

/* ---------------------------------------------------------- */
/* The arsenal                                                 */
/* ---------------------------------------------------------- */

export const WEAPONS = {
  /* ---- 1. Crimson Arc ------------------------------------- */
  crimsonArc: {
    id: "crimsonArc",
    name: "Crimson Arc",
    sigil: "slash",
    jp: "斬",
    kana: "クリムゾン・アーク",
    desc: "A drawn cut that opens a crescent of blood in front of you.",
    levelText: [
      "Crescents open in front of you and behind.",
      "+9 damage.",
      "A third crescent.",
      "+10 damage.",
      "+1 arc.",
      "+14 damage, wider sweep.",
      "Cuts leave a lingering wound.",
      "+1 arc.",
    ],
    max: 8,
    evolve: { into: "requiem", requires: "might" },
    stats(l) {
      return {
        damage: 20 + l * 9,
        cooldown: 1.1 - l * 0.045,
        area: 1 + l * 0.09,
        // TWO arcs from level one, front and back. With a single
        // forward arc the opening minutes are unwinnable: you spend
        // them retreating, the cut lands on empty ground, no souls
        // drop, no levels arrive, and the run never starts.
        amount: 2 + (l >= 3 ? 1 : 0) + (l >= 5 ? 1 : 0) + (l >= 8 ? 1 : 0),
        knockback: 200,
      };
    },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      const base = ctx.player.facing >= 0 ? 0 : Math.PI;
      ctx.animatePlayerSlash(base, 0.34);
      // Extra arcs alternate FRONT and BEHIND rather than fanning
      // forward. A survivor spends most of the run retreating, and a
      // weapon that only cuts the way you face kills nothing at all
      // while you are running away from the thing chasing you.
      const OFFSETS = [0, Math.PI, 0.62, Math.PI - 0.62, -0.62, Math.PI + 0.62];
      for (let i = 0; i < s.amount; i++) {
        const ang = base + (OFFSETS[i] == null ? (i * 1.1) : OFFSETS[i]);
        const dist = 66 * s.area;
        const px = ctx.player.x + Math.cos(ang) * dist;
        const py = ctx.player.y - ctx.player.h * 0.42 + Math.sin(ang) * dist * 0.5;
        ctx.fx.slash(px, py, ang, 0.62 * s.area);
        spawn(ctx, {
          kind: "static", art: "none",
          x: px, y: py, r: 92 * s.area,
          damage: s.damage, pierce: 999, life: 0.16,
          knockback: s.knockback, sector: { angle: ang, spread: 1.5 },
          hitCooldown: w.level >= 7 ? 0.35 : 0,
        });
      }
      ctx.audio.slash();
      ctx.fx.shake(2.5);
    },
  },

  requiem: {
    id: "requiem", evolved: true,
    name: "Thousand-Cut Requiem",
    sigil: "slash",
    jp: "千斬",
    kana: "センザン・レクイエム",
    desc: "The cut no longer needs a direction. Everything around you opens at once.",
    max: 1,
    stats() {
      return { damage: 78, cooldown: 0.78, area: 1.6, amount: 5, knockback: 300 };
    },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      ctx.animatePlayerSlash(ctx.player.facing >= 0 ? 0 : Math.PI, 0.32);
      for (let i = 0; i < s.amount; i++) {
        const ang = (i / s.amount) * TAU + ctx.time * 1.7;
        const dist = 74 * s.area;
        const px = ctx.player.x + Math.cos(ang) * dist;
        const py = ctx.player.y - ctx.player.h * 0.42 + Math.sin(ang) * dist * 0.5;
        ctx.fx.slash(px, py, ang, 0.8 * s.area);
        spawn(ctx, {
          kind: "static", art: "none",
          x: px, y: py, r: 96 * s.area,
          damage: s.damage, pierce: 999, life: 0.18,
          knockback: s.knockback, sector: { angle: ang, spread: 1.7 },
          hitCooldown: 0.3,
        });
      }
      ctx.fx.word(ctx.player.x, ctx.player.y - 120, "heavy", { scale: 0.9 });
      ctx.audio.slash(1.3);
      ctx.fx.shake(6);
      ctx.fx.focusTarget = Math.max(ctx.fx.focusTarget, 0.34);
    },
  },

  /* ---- 2. Kunai ------------------------------------------- */
  kunai: {
    id: "kunai",
    name: "Kunai Fan",
    sigil: "kunai",
    jp: "苦無",
    kana: "クナイ",
    desc: "Throws steel at whatever is closest. Simple. Reliable.",
    levelText: [
      "Throws one kunai at the nearest yokai.",
      "+1 kunai.", "+6 damage.", "+1 kunai.",
      "Kunai pass through one more body.", "+8 damage.",
      "+1 kunai.", "Kunai fly faster and cut deeper.",
    ],
    max: 8,
    evolve: { into: "nailStorm", requires: "twin" },
    stats(l) {
      return {
        damage: 11 + l * 5,
        cooldown: 1.0 - l * 0.05,
        amount: 1 + (l >= 2 ? 1 : 0) + (l >= 4 ? 1 : 0) + (l >= 7 ? 1 : 0),
        pierce: 1 + (l >= 5 ? 1 : 0) + (l >= 8 ? 1 : 0),
        speed: 560 + (l >= 8 ? 180 : 0),
        area: 1,
      };
    },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      const targets = ctx.nearestEnemies(ctx.player.x, ctx.player.y, 1000, s.amount);
      for (let i = 0; i < s.amount; i++) {
        const t = targets[i] || targets[0];
        let a;
        if (t) a = Math.atan2((t.y - t.h * 0.4) - (ctx.player.y - ctx.player.h * 0.4), t.x - ctx.player.x);
        else a = ctx.player.facing >= 0 ? 0 : Math.PI;
        a += (Math.random() - 0.5) * 0.12;
        spawn(ctx, {
          kind: "linear", art: "kunai",
          x: ctx.player.x, y: ctx.player.y - ctx.player.h * 0.42,
          vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed,
          damage: s.damage, pierce: s.pierce, life: 1.8, r: 20 * s.area,
          spin: 0, scale: 0.8 * s.area, knockback: 130,
        });
      }
      ctx.audio.throwHit();
    },
  },

  nailStorm: {
    id: "nailStorm", evolved: true,
    name: "Storm of Nails",
    sigil: "kunai",
    jp: "鉄雨",
    kana: "ネイル・ストーム",
    desc: "A wall of steel, thrown wide enough that aiming stops mattering.",
    max: 1,
    stats() {
      return { damage: 44, cooldown: 0.52, amount: 7, pierce: 4, speed: 780, area: 1.2 };
    },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      const t = ctx.nearestEnemy(ctx.player.x, ctx.player.y, 1200);
      const base = t
        ? Math.atan2(t.y - t.h * 0.4 - (ctx.player.y - ctx.player.h * 0.4), t.x - ctx.player.x)
        : (ctx.player.facing >= 0 ? 0 : Math.PI);
      for (let i = 0; i < s.amount; i++) {
        const a = base + ((i - (s.amount - 1) / 2) * 0.19);
        spawn(ctx, {
          kind: "linear", art: "kunai",
          x: ctx.player.x, y: ctx.player.y - ctx.player.h * 0.42,
          vx: Math.cos(a) * s.speed, vy: Math.sin(a) * s.speed,
          damage: s.damage, pierce: s.pierce, life: 1.6, r: 22 * s.area,
          scale: 0.95 * s.area, knockback: 170,
        });
      }
      ctx.audio.throwHit(1.2);
    },
  },

  /* ---- 3. Ofuda ------------------------------------------- */
  ofuda: {
    id: "ofuda",
    name: "Ofuda Talismans",
    sigil: "ofuda",
    jp: "御札",
    kana: "オフダ",
    desc: "Paper seals that hunt on their own and burst on contact.",
    levelText: [
      "One seal seeks a target and bursts.",
      "+1 seal.", "Bursts are larger.", "+10 damage.",
      "+1 seal.", "Seals turn more sharply.", "Bursts are larger.", "+1 seal.",
    ],
    max: 8,
    evolve: { into: "sutra", requires: "ink" },
    stats(l) {
      return {
        damage: 16 + l * 6,
        cooldown: 2.0 - l * 0.09,
        amount: 1 + (l >= 2 ? 1 : 0) + (l >= 5 ? 1 : 0) + (l >= 8 ? 1 : 0),
        area: 1 + (l >= 3 ? 0.25 : 0) + (l >= 7 ? 0.3 : 0),
        speed: 300,
        turn: l >= 6 ? 9 : 5.5,
      };
    },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      for (let i = 0; i < s.amount; i++) {
        const a = Math.random() * TAU;
        spawn(ctx, {
          kind: "homing", art: "ofuda",
          x: ctx.player.x, y: ctx.player.y - ctx.player.h * 0.5,
          vx: Math.cos(a) * 160, vy: Math.sin(a) * 160,
          speed: s.speed, turn: s.turn,
          damage: s.damage, pierce: 1, life: 3.4, r: 22 * s.area,
          scale: 0.85 * s.area, knockback: 120,
          onHit: (c, p) => {
            c.fx.ring(p.x, p.y, 8, 74 * s.area, 0.3, { colour: PAL.blood, width: 7 });
            c.fx.motesBurst(p.x, p.y, 8, PAL.blood, 200);
            c.areaDamage(p.x, p.y, 74 * s.area, s.damage * 0.7, { knockback: 140, source: p });
            c.audio.pop();
          },
        });
      }
    },
  },

  sutra: {
    id: "sutra", evolved: true,
    name: "Sutra of Ruin",
    sigil: "ofuda",
    jp: "破滅経",
    kana: "スートラ",
    desc: "The seals no longer burn out. They circle, and they keep reading.",
    max: 1,
    stats() {
      return { damage: 52, cooldown: 1.5, amount: 5, area: 1.7, speed: 340, turn: 11 };
    },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      for (let i = 0; i < s.amount; i++) {
        const a = (i / s.amount) * TAU;
        spawn(ctx, {
          kind: "homing", art: "ofuda",
          x: ctx.player.x, y: ctx.player.y - ctx.player.h * 0.5,
          vx: Math.cos(a) * 200, vy: Math.sin(a) * 200,
          speed: s.speed, turn: s.turn,
          damage: s.damage, pierce: 3, life: 5, r: 26 * s.area,
          scale: 1.1 * s.area, knockback: 150,
          onHit: (c, p) => {
            c.fx.ring(p.x, p.y, 8, 96 * s.area, 0.34, { colour: PAL.blood, width: 9, spokes: 6 });
            c.areaDamage(p.x, p.y, 96 * s.area, s.damage * 0.8, { knockback: 180, source: p });
            c.audio.pop(1.2);
          },
        });
      }
    },
  },

  /* ---- 4. Blood Lotus ------------------------------------- */
  bloodLotus: {
    id: "bloodLotus",
    name: "Blood Lotus",
    sigil: "lotus",
    jp: "血蓮",
    kana: "ブラッド・ロータス",
    desc: "Opens a ring of your own blood that shoves everything away.",
    levelText: [
      "A ring bursts outward from you.",
      "+12 damage.", "Wider ring.", "+1 ring per cast.",
      "+16 damage.", "Wider ring.", "Rings knock harder.", "+1 ring per cast.",
    ],
    max: 8,
    evolve: { into: "redBloom", requires: "reach" },
    stats(l) {
      return {
        damage: 20 + l * 9,
        cooldown: 3.2 - l * 0.14,
        area: 1 + l * 0.13,
        amount: 1 + (l >= 4 ? 1 : 0) + (l >= 8 ? 1 : 0),
        knockback: 260 + (l >= 7 ? 220 : 0),
      };
    },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      for (let i = 0; i < s.amount; i++) {
        ctx.after(i * 0.22, () => {
          const R = 210 * s.area;
          ctx.fx.ring(ctx.player.x, ctx.player.y - ctx.player.h * 0.35, 24, R, 0.42,
            { colour: PAL.blood, width: 12, spokes: 10 });
          ctx.areaDamage(ctx.player.x, ctx.player.y - ctx.player.h * 0.35, R, s.damage,
            { knockback: s.knockback });
          ctx.fx.motesBurst(ctx.player.x, ctx.player.y - ctx.player.h * 0.35, 16, PAL.blood, 420,
            { decal: true });
          ctx.audio.boom();
          ctx.fx.shake(7);
        });
      }
    },
  },

  redBloom: {
    id: "redBloom", evolved: true,
    name: "Red Bloom",
    sigil: "lotus",
    jp: "紅蓮",
    kana: "レッド・ブルーム",
    desc: "Three rings, one after another, and the ground stays wet.",
    max: 1,
    stats() { return { damage: 96, cooldown: 2.4, area: 2.1, amount: 3, knockback: 620 }; },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      for (let i = 0; i < s.amount; i++) {
        ctx.after(i * 0.16, () => {
          const R = 240 * s.area;
          ctx.fx.ring(ctx.player.x, ctx.player.y - ctx.player.h * 0.35, 20, R, 0.46,
            { colour: PAL.blood, width: 16, spokes: 14 });
          ctx.areaDamage(ctx.player.x, ctx.player.y - ctx.player.h * 0.35, R, s.damage,
            { knockback: s.knockback });
          ctx.fx.motesBurst(ctx.player.x, ctx.player.y - ctx.player.h * 0.35, 26, PAL.blood, 520,
            { decal: true });
          ctx.audio.boom(1.3);
          ctx.fx.shake(12);
        });
      }
      ctx.fx.word(ctx.player.x, ctx.player.y - 150, "huge", { scale: 1.1 });
    },
  },

  /* ---- 5. Ink Crows --------------------------------------- */
  crows: {
    id: "crows",
    name: "Ink Crows",
    sigil: "crow",
    jp: "烏",
    kana: "インク・クロウ",
    desc: "Birds cut out of wet ink. They circle you and they are always hungry.",
    levelText: [
      "One crow circles you.",
      "+1 crow.", "+7 damage.", "+1 crow.",
      "They fly a wider ring.", "+9 damage.", "+1 crow.", "They circle faster.",
    ],
    max: 8,
    persistent: true,
    evolve: { into: "murder", requires: "haste" },
    stats(l) {
      return {
        damage: 10 + l * 5,
        cooldown: 0.4,
        amount: 1 + (l >= 2 ? 1 : 0) + (l >= 4 ? 1 : 0) + (l >= 7 ? 1 : 0),
        area: 1 + (l >= 5 ? 0.32 : 0),
        speed: (l >= 8 ? 2.6 : 1.9),
      };
    },
    tick(ctx, w, dt) {
      const s = ctx.scaled(w);
      const want = s.amount;
      w.orbs = (w.orbs || []).filter((p) => !p.dead);
      while (w.orbs.length < want) {
        const idx = w.orbs.length;
        const p = spawn(ctx, {
          kind: "orbit", art: "crow",
          baseAngle: (idx / want) * TAU, orbitSpeed: s.speed,
          orbitR: 132 * Math.sqrt(s.area),
          damage: s.damage, pierce: 999, life: 1e9, r: 30 * s.area,
          scale: 0.42 * Math.sqrt(s.area), knockback: 90, hitCooldown: 0.42,
          persistent: true,
        });
        w.orbs.push(p);
      }
      while (w.orbs.length > want) { const p = w.orbs.pop(); p.dead = true; }
      w.orbs.forEach((p, i) => {
        p.baseAngle = (i / want) * TAU;
        p.orbitSpeed = s.speed;
        p.orbitR = 132 * Math.sqrt(s.area);
        p.damage = s.damage;
        p.scale = 0.42 * Math.sqrt(s.area);
        p.flip = Math.cos(p.baseAngle + p.t * p.orbitSpeed) < 0;
      });
    },
  },

  murder: {
    id: "murder", evolved: true,
    name: "A Murder of Ink",
    sigil: "crow",
    jp: "烏群",
    kana: "マーダー",
    desc: "The flock doubles and the ring widens until it is simply a wall of birds.",
    max: 1,
    persistent: true,
    stats() { return { damage: 58, cooldown: 0.4, amount: 9, area: 1.9, speed: 3.1 }; },
    tick(ctx, w, dt) { WEAPONS.crows.tick(ctx, w, dt); },
  },

  /* ---- 6. Raijin ------------------------------------------ */
  raijin: {
    id: "raijin",
    name: "Raijin's Wrath",
    sigil: "lightning",
    jp: "雷",
    kana: "ライジン",
    desc: "The thunder god notices you. Bolts fall where the crowd is thickest.",
    levelText: [
      "A bolt falls on a random yokai.",
      "+1 bolt.", "+14 damage.", "+1 bolt.",
      "Bolts scorch a wider circle.", "+18 damage.", "+1 bolt.", "Bolts strike twice.",
    ],
    max: 8,
    evolve: { into: "tally", requires: "charm" },
    stats(l) {
      return {
        damage: 30 + l * 12,
        cooldown: 3.4 - l * 0.16,
        amount: 1 + (l >= 2 ? 1 : 0) + (l >= 4 ? 1 : 0) + (l >= 7 ? 1 : 0),
        area: 1 + (l >= 5 ? 0.4 : 0),
        double: l >= 8,
      };
    },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      const picks = ctx.randomEnemies(s.amount, 900);
      const strikes = s.double ? 2 : 1;
      for (let k = 0; k < strikes; k++) {
        for (const e of picks) {
          ctx.after(k * 0.13 + Math.random() * 0.12, () => {
            const tx = e && !e.dead ? e.x : ctx.player.x + (Math.random() - 0.5) * 400;
            const ty = e && !e.dead ? e.y : ctx.player.y + (Math.random() - 0.5) * 300;
            ctx.fx.bolt(tx + (Math.random() - 0.5) * 40, ty - 620, tx, ty,
              { segments: 10, amp: 30, colour: PAL.arcane, width: 8, life: 0.24 });
            ctx.fx.ring(tx, ty, 6, 92 * s.area, 0.28, { colour: PAL.arcane, width: 6 });
            ctx.areaDamage(tx, ty, 92 * s.area, s.damage, { knockback: 200, colour: PAL.arcane });
            ctx.fx.motesBurst(tx, ty, 10, PAL.arcane, 260, { gravity: 200 });
            ctx.fx.screenFlash(0.16);
            ctx.audio.thunder();
          });
        }
      }
    },
  },

  tally: {
    id: "tally", evolved: true,
    name: "Heaven's Tally",
    sigil: "lightning",
    jp: "天罰",
    kana: "テンバツ",
    desc: "Judgement stops being selective.",
    max: 1,
    stats() { return { damage: 150, cooldown: 2.1, amount: 6, area: 1.8, double: true }; },
    fire(ctx, w) { WEAPONS.raijin.fire(ctx, w); },
  },

  /* ---- 7. Severing Line ----------------------------------- */
  severing: {
    id: "severing",
    name: "Severing Line",
    sigil: "severing",
    jp: "一閃",
    kana: "イッセン",
    desc: "One line, drawn all the way across the page. Everything on it is already cut.",
    levelText: [
      "A cutting line sweeps out in front.",
      "+16 damage.", "The line reaches further.", "+1 line.",
      "+22 damage.", "The line is thicker.", "+1 line.", "Lines fire in both directions.",
    ],
    max: 8,
    evolve: { into: "horizon", requires: "swift" },
    stats(l) {
      return {
        damage: 34 + l * 14,
        cooldown: 2.6 - l * 0.1,
        area: 1 + l * 0.08,
        amount: 1 + (l >= 4 ? 1 : 0) + (l >= 7 ? 1 : 0),
        both: l >= 8,
        length: 460 + l * 34,
      };
    },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      const dirs = [];
      const t = ctx.nearestEnemy(ctx.player.x, ctx.player.y, 1400);
      const base = t
        ? Math.atan2(t.y - t.h * 0.4 - (ctx.player.y - ctx.player.h * 0.4), t.x - ctx.player.x)
        : (ctx.player.facing >= 0 ? 0 : Math.PI);
      ctx.animatePlayerSlash(base, 0.3);
      for (let i = 0; i < s.amount; i++) {
        dirs.push(base + (i - (s.amount - 1) / 2) * 0.5);
      }
      if (s.both) dirs.push(...dirs.map((d) => d + Math.PI));
      for (const a of dirs) {
        const p = spawn(ctx, {
          kind: "static", art: "beam",
          x: ctx.player.x, y: ctx.player.y - ctx.player.h * 0.42,
          rot: a, length: s.length * s.area, r: 46 * s.area,
          damage: s.damage, pierce: 999, life: 0.3, knockback: 240,
          capsule: true, hitCooldown: 0.2,
        });
        p.x2 = p.x + Math.cos(a) * p.length;
        p.y2 = p.y + Math.sin(a) * p.length;
      }
      ctx.audio.slash(0.8);
      ctx.fx.shake(4);
      ctx.fx.focusTarget = Math.max(ctx.fx.focusTarget, 0.22);
    },
  },

  horizon: {
    id: "horizon", evolved: true,
    name: "Horizon Cut",
    sigil: "severing",
    jp: "地平斬",
    kana: "ホライズン",
    desc: "Six lines, every direction, the width of the panel.",
    max: 1,
    stats() { return { damage: 190, cooldown: 2.0, area: 1.9, amount: 6, both: false, length: 900 }; },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      ctx.animatePlayerSlash(ctx.player.facing >= 0 ? 0 : Math.PI, 0.32);
      for (let i = 0; i < s.amount; i++) {
        const a = (i / s.amount) * TAU + ctx.time * 0.6;
        const p = spawn(ctx, {
          kind: "static", art: "beam",
          x: ctx.player.x, y: ctx.player.y - ctx.player.h * 0.42,
          rot: a, length: s.length * s.area, r: 56 * s.area,
          damage: s.damage, pierce: 999, life: 0.34, knockback: 300,
          capsule: true, hitCooldown: 0.2,
        });
        p.x2 = p.x + Math.cos(a) * p.length;
        p.y2 = p.y + Math.sin(a) * p.length;
      }
      ctx.fx.word(ctx.player.x, ctx.player.y - 140, "crit", { text: "X", scale: 1.2 });
      ctx.audio.slash(1.5);
      ctx.fx.shake(10);
      ctx.fx.focusTarget = 0.6;
    },
  },

  /* ---- 8. Oni Aura ---------------------------------------- */
  oniAura: {
    id: "oniAura",
    name: "Oni Breath",
    sigil: "oni",
    jp: "鬼氣",
    kana: "オニ・オーラ",
    desc: "Something old is standing very close to you, and it is not friendly to them.",
    levelText: [
      "A field around you grinds anything inside it.",
      "+4 damage.", "Wider field.", "+5 damage.",
      "Grinds faster.", "Wider field.", "+7 damage.", "Grinds much faster.",
    ],
    max: 8,
    persistent: true,
    evolve: { into: "mandala", requires: "guard" },
    stats(l) {
      return {
        damage: 6 + l * 3.4,
        cooldown: 0.5,
        area: 1 + l * 0.11,
        tickRate: l >= 8 ? 0.24 : (l >= 5 ? 0.36 : 0.5),
      };
    },
    tick(ctx, w, dt) {
      const s = ctx.scaled(w);
      if (!w.orb || w.orb.dead) {
        w.orb = spawn(ctx, {
          kind: "anchor", art: "aura",
          damage: s.damage, pierce: 999, life: 1e9, r: 96 * s.area,
          knockback: 30, hitCooldown: s.tickRate, persistent: true,
        });
      }
      w.orb.r = 96 * s.area;
      w.orb.damage = s.damage;
      w.orb.hitCooldown = s.tickRate;
    },
  },

  mandala: {
    id: "mandala", evolved: true,
    name: "Demon Mandala",
    sigil: "oni",
    jp: "鬼曼荼羅",
    kana: "マンダラ",
    desc: "The field becomes a wheel, and the wheel does not stop turning.",
    max: 1,
    persistent: true,
    stats() { return { damage: 40, cooldown: 0.5, area: 2.0, tickRate: 0.18 }; },
    tick(ctx, w, dt) { WEAPONS.oniAura.tick(ctx, w, dt); },
  },

  /* ---- 9. Kusarigama -------------------------------------- */
  kusarigama: {
    id: "kusarigama",
    name: "Chain Sickle",
    sigil: "chain",
    jp: "鎖鎌",
    kana: "クサリガマ",
    desc: "Thrown out on a chain and hauled back through whatever it caught.",
    levelText: [
      "The sickle lashes out and returns.",
      "+9 damage.", "+1 sickle.", "Longer chain.",
      "+12 damage.", "+1 sickle.", "Longer chain.", "+1 sickle.",
    ],
    max: 8,
    evolve: { into: "tether", requires: "vitality" },
    stats(l) {
      return {
        damage: 18 + l * 8,
        cooldown: 1.9 - l * 0.08,
        area: 1 + l * 0.06,
        amount: 1 + (l >= 3 ? 1 : 0) + (l >= 6 ? 1 : 0) + (l >= 8 ? 1 : 0),
        reach: 250 + (l >= 4 ? 90 : 0) + (l >= 7 ? 90 : 0),
      };
    },
    fire(ctx, w) {
      const s = ctx.scaled(w);
      for (let i = 0; i < s.amount; i++) {
        const targets = ctx.nearestEnemies(ctx.player.x, ctx.player.y, 900, s.amount);
        const t = targets[i];
        let a;
        if (t) a = Math.atan2(t.y - t.h * 0.4 - (ctx.player.y - ctx.player.h * 0.42), t.x - ctx.player.x);
        else a = (ctx.player.facing >= 0 ? 0 : Math.PI) + (i - (s.amount - 1) / 2) * 0.6;
        const p = spawn(ctx, {
          kind: "boomerang", art: "sickle",
          ox: ctx.player.x, oy: ctx.player.y - ctx.player.h * 0.42,
          dx: Math.cos(a), dy: Math.sin(a) * 0.75,
          reach: s.reach * s.area,
          x: ctx.player.x, y: ctx.player.y - ctx.player.h * 0.42,
          spin: 16, scale: 0.95 * s.area,
          damage: s.damage, pierce: 999, life: 0.85, r: 34 * s.area,
          knockback: 180, hitCooldown: 0.4, chain: true,
        });
        p.anchor = ctx.player;
      }
      ctx.audio.chain();
    },
  },

  tether: {
    id: "tether", evolved: true,
    name: "Reaper's Tether",
    sigil: "chain",
    jp: "死鎖",
    kana: "テザー",
    desc: "Four chains, always out, and each one drags a little life back to you.",
    max: 1,
    stats() { return { damage: 86, cooldown: 1.05, area: 1.6, amount: 4, reach: 520, drain: true }; },
    fire(ctx, w) {
      WEAPONS.kusarigama.fire(ctx, w);
      // Marks the newest projectiles as life-stealing.
      for (let i = ctx.projectiles.length - 1, n = 0; i >= 0 && n < 4; i--, n++) {
        if (ctx.projectiles[i].chain) ctx.projectiles[i].drain = 0.5;
      }
    },
  },
};

/** Draw the chain trailing behind a kusarigama head. */
export function drawChains(g, projectiles) {
  for (const p of projectiles) {
    if (!p.chain || !p.anchor) continue;
    const ax = p.anchor.x;
    const ay = p.anchor.y - p.anchor.h * 0.42;
    const dx = p.x - ax; const dy = p.y - ay;
    const n = 9;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const sag = Math.sin(t * Math.PI) * 12;
      g.beginPath();
      g.arc(ax + dx * t, ay + dy * t + sag, 3.1, 0, Math.PI * 2);
      g.fillStyle = PAL.ink;
      g.fill();
    }
  }
}

export const PASSIVES = {
  might: { id: "might", name: "Ogre Charm", sigil: "might", jp: "力", desc: "All damage +12%.", max: 5, apply: (s, l) => { s.might += 0.12 * l; } },
  haste: { id: "haste", name: "Whetstone", sigil: "haste", jp: "疾", desc: "Attacks come 8% sooner.", max: 5, apply: (s, l) => { s.cooldown -= 0.08 * l; } },
  reach: { id: "reach", name: "Lens of Ma", sigil: "reach", jp: "域", desc: "Area of effect +14%.", max: 5, apply: (s, l) => { s.area += 0.14 * l; } },
  ink: { id: "ink", name: "Ink Pot", sigil: "ink", jp: "墨", desc: "Effects last 16% longer.", max: 5, apply: (s, l) => { s.duration += 0.16 * l; } },
  twin: { id: "twin", name: "Twin Blade", sigil: "twin", jp: "双", desc: "+1 projectile at levels 2 and 4.", max: 5, apply: (s, l) => { s.amount += (l >= 2 ? 1 : 0) + (l >= 4 ? 1 : 0); } },
  guard: { id: "guard", name: "Iron Ward", sigil: "guard", jp: "護", desc: "Armour +1. Blunts every hit.", max: 5, apply: (s, l) => { s.armor += l; } },
  swift: { id: "swift", name: "Wind Sandals", sigil: "swift", jp: "韋", desc: "Move speed +9%.", max: 5, apply: (s, l) => { s.moveSpeed += 0.09 * l; } },
  charm: { id: "charm", name: "Soul Charm", sigil: "charm", jp: "縁", desc: "Pickup range +28%.", max: 5, apply: (s, l) => { s.magnet += 0.28 * l; } },
  fortune: { id: "fortune", name: "Fortune Cat", sigil: "fortune", jp: "運", desc: "Souls and coin are worth 12% more.", max: 5, apply: (s, l) => { s.luck += 0.12 * l; } },
  vitality: { id: "vitality", name: "Rice God", sigil: "vitality", jp: "命", desc: "+24 max life, and you knit back together slowly.", max: 5, apply: (s, l) => { s.maxHp += 24 * l; s.regen += 0.32 * l; } },
};
