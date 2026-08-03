/* ============================================================
   INKBLOOD — enemies.js
   The Night Parade of One Hundred Demons, and the director that
   decides who walks in it.

   Fifteen minutes, three bosses, and a difficulty curve that comes
   from three independent dials rather than one: WHO spawns (the
   roster opens up over time), HOW MANY (rate climbs), and HOW
   TOUGH (hp/speed multipliers). Turning them separately is what
   keeps minute 12 feeling different from minute 3 rather than just
   being minute 3 with bigger numbers.
   ============================================================ */

"use strict";

import { PAL } from "./art.js?v=20260803-2";

/* ---------------------------------------------------------- */
/* Roster                                                      */
/* ---------------------------------------------------------- */

export const ENEMIES = {
  gaki: {
    id: "gaki", sprite: "gaki", name: "Gaki", jp: "餓鬼",
    hp: 10, speed: 44, damage: 5, xp: 1, h: 60, radius: 17, mass: 1,
    behavior: "chase",
  },
  tsukumo: {
    id: "tsukumo", sprite: "tsukumo", name: "Tsukumogami", jp: "付喪神",
    hp: 5, speed: 66, damage: 4, xp: 1, h: 34, radius: 12, mass: 0.6,
    behavior: "chase", bob: 8,
  },
  kamaitachi: {
    id: "kamaitachi", sprite: "kamaitachi", name: "Kamaitachi", jp: "鎌鼬",
    hp: 16, speed: 94, damage: 8, xp: 2, h: 46, radius: 16, mass: 0.8,
    behavior: "dash",
  },
  kappa: {
    id: "kappa", sprite: "kappa", name: "Kappa", jp: "河童",
    hp: 26, speed: 40, damage: 8, xp: 3, h: 50, radius: 18, mass: 1.1,
    behavior: "ranged", range: 340, shotCd: 2.4, shotSpeed: 260, shotDamage: 10,
  },
  nurikabe: {
    id: "nurikabe", sprite: "nurikabe", name: "Nurikabe", jp: "塗壁",
    hp: 130, speed: 26, damage: 14, xp: 6, h: 80, radius: 32, mass: 4,
    behavior: "chase", kbResist: 0.72,
  },
  yurei: {
    id: "yurei", sprite: "yurei", name: "Yurei", jp: "幽霊",
    hp: 42, speed: 58, damage: 10, xp: 4, h: 72, radius: 19, mass: 0.4,
    behavior: "drift", ghost: true, bob: 6,
  },
  mukade: {
    id: "mukade", sprite: "mukade", name: "Omukade", jp: "大百足",
    hp: 34, speed: 116, damage: 12, xp: 4, h: 30, radius: 18, mass: 0.9,
    behavior: "chase",
  },
  onryo: {
    id: "onryo", sprite: "onryo", name: "Onryo", jp: "怨霊",
    hp: 240, speed: 52, damage: 18, xp: 14, h: 90, radius: 26, mass: 2.4,
    behavior: "drift", ghost: true, elite: true, kbResist: 0.6, bob: 5,
  },

  /* ---- bosses ---- */
  gashadokuro: {
    id: "gashadokuro", sprite: "gashadokuro", name: "Gashadokuro", sigil: "boss-skull", jp: "餓者髑髏",
    title: "THE FAMINE SKELETON",
    hp: 9000, speed: 40, damage: 30, xp: 240, h: 190, radius: 56, mass: 30,
    behavior: "boss", kbResist: 0.96, boss: true,
    slamCd: 4.2, slamRadius: 250, slamDamage: 30,
  },
  oni: {
    id: "oni", sprite: "oni", name: "Oni", sigil: "boss-oni", jp: "鬼",
    title: "THE RED-BROWED",
    hp: 34000, speed: 56, damage: 38, xp: 420, h: 155, radius: 48, mass: 30,
    behavior: "boss", kbResist: 0.96, boss: true,
    slamCd: 3.2, slamRadius: 210, slamDamage: 38, chargeCd: 7,
  },
  nurarihyon: {
    id: "nurarihyon", sprite: "nurarihyon", name: "Nurarihyon", sigil: "boss-command", jp: "ぬらりひょん",
    title: "SUPREME COMMANDER OF THE NIGHT PARADE",
    hp: 90000, speed: 48, damage: 44, xp: 900, h: 145, radius: 46, mass: 30,
    behavior: "boss", kbResist: 0.98, boss: true, ghost: true,
    slamCd: 3.0, slamRadius: 260, slamDamage: 44, summonCd: 8,
  },
};

/* ---------------------------------------------------------- */
/* Wave schedule                                               */
/* ---------------------------------------------------------- */

/**
 * Each entry opens at `from` seconds. `pool` is a weighted roster,
 * `rate` is spawns per second before the global multiplier.
 */
export const WAVES = [
  // Opening minute is deliberately thin. One weapon at level 1 that
  // only swings in the direction you face cannot hold a crowd, and a
  // survivor game that kills a standing player inside thirty seconds
  // has not taught them anything yet.
  { from: 0, rate: 1.0, pool: { gaki: 1 } },
  { from: 45, rate: 1.7, pool: { gaki: 3, tsukumo: 1 } },
  { from: 100, rate: 2.4, pool: { gaki: 3, tsukumo: 2, kamaitachi: 1 } },
  { from: 165, rate: 3.1, pool: { gaki: 3, tsukumo: 2, kamaitachi: 2, kappa: 1 } },
  { from: 240, rate: 3.9, pool: { gaki: 3, tsukumo: 2, kamaitachi: 2, kappa: 2, mukade: 1 } },
  { from: 330, rate: 4.7, pool: { gaki: 2, tsukumo: 2, kamaitachi: 2, kappa: 2, mukade: 2, nurikabe: 1 } },
  { from: 420, rate: 5.6, pool: { gaki: 2, kamaitachi: 2, kappa: 2, mukade: 2, nurikabe: 2, yurei: 2 } },
  { from: 520, rate: 6.5, pool: { kamaitachi: 3, kappa: 2, mukade: 3, nurikabe: 2, yurei: 3, tsukumo: 2 } },
  { from: 640, rate: 7.4, pool: { kamaitachi: 3, mukade: 3, nurikabe: 3, yurei: 3, onryo: 1, kappa: 2 } },
  { from: 760, rate: 8.4, pool: { kamaitachi: 3, mukade: 4, nurikabe: 3, yurei: 4, onryo: 2 } },
];

/** Scripted set pieces: rings, boss entrances, elite packs. */
export const EVENTS = [
  { at: 70, kind: "ring", type: "gaki", count: 26 },
  { at: 150, kind: "ring", type: "tsukumo", count: 34 },
  { at: 205, kind: "pack", type: "kamaitachi", count: 16 },
  { at: 300, kind: "boss", type: "gashadokuro" },
  { at: 380, kind: "ring", type: "kappa", count: 24 },
  { at: 460, kind: "pack", type: "nurikabe", count: 10 },
  { at: 545, kind: "ring", type: "yurei", count: 30 },
  { at: 600, kind: "boss", type: "oni" },
  { at: 690, kind: "pack", type: "onryo", count: 5 },
  { at: 745, kind: "ring", type: "mukade", count: 36 },
  { at: 820, kind: "pack", type: "onryo", count: 8 },
  { at: 870, kind: "ring", type: "gaki", count: 60 },
  { at: 900, kind: "boss", type: "nurarihyon" },
];

export const RUN_LENGTH = 900; // 15:00

/* ---------------------------------------------------------- */
/* Director                                                    */
/* ---------------------------------------------------------- */

export class Director {
  constructor() { this.reset(); }

  reset() {
    this.acc = 0;
    this.firedEvents = new Set();
    this.waveIndex = 0;
  }

  /**
   * Difficulty multipliers as a function of elapsed time.
   *
   * The exponent matters more than it looks. At 1.62 the fifteenth
   * minute multiplied health by thirty, which was survivable for the
   * rank and file but turned the authored 16k final boss into a
   * half-million-hitpoint wall and stretched a fifteen-minute run
   * past thirty. Bosses now opt out of the curve entirely (see
   * `bossCurve`) and the rank-and-file ramp is gentler.
   */
  curve(t) {
    const m = t / 60;
    return {
      hp: 1 + Math.pow(m, 1.28) * 0.24,
      speed: 1 + Math.min(0.5, m * 0.024),
      damage: 1 + m * 0.07,
      rate: 1 + m * 0.09,
    };
  }

  /**
   * Bosses appear at fixed times with authored health, so scaling
   * them a second time by the clock double-counts. Only their damage
   * tracks the curve, so a late boss still hurts.
   */
  bossCurve(t) {
    const c = this.curve(t);
    return { ...c, hp: 1 };
  }

  activeWave(t) {
    let w = WAVES[0];
    for (const cand of WAVES) if (t >= cand.from) w = cand;
    return w;
  }

  update(dt, ctx) {
    const t = ctx.time;
    const c = this.curve(t);
    const wave = this.activeWave(t);

    // Scripted events first — they get priority over the cap.
    for (let i = 0; i < EVENTS.length; i++) {
      const ev = EVENTS[i];
      if (t >= ev.at && !this.firedEvents.has(i)) {
        this.firedEvents.add(i);
        this.runEvent(ev, ctx, c);
      }
    }

    if (ctx.enemies.length >= ctx.maxEnemies) return;

    this.acc += dt * wave.rate * c.rate;
    let budget = Math.min(12, Math.floor(this.acc));
    this.acc -= budget;
    while (budget-- > 0) {
      const type = pickWeighted(wave.pool);
      const [x, y] = ctx.edgeSpawnPoint();
      ctx.spawnEnemy(type, x, y, c);
    }
  }

  runEvent(ev, ctx, c) {
    if (ev.kind === "ring") {
      const R = ctx.spawnRadius() * 1.05;
      for (let i = 0; i < ev.count; i++) {
        const a = (i / ev.count) * Math.PI * 2 + Math.random() * 0.1;
        ctx.spawnEnemy(ev.type, ctx.player.x + Math.cos(a) * R, ctx.player.y + Math.sin(a) * R * 0.8, c);
      }
      ctx.fx.word(ctx.player.x, ctx.player.y - 200, "heavy", { text: "•••", scale: 1.2, life: 1.2 });
      ctx.audio.swarm();
    } else if (ev.kind === "pack") {
      const a0 = Math.random() * Math.PI * 2;
      const R = ctx.spawnRadius();
      for (let i = 0; i < ev.count; i++) {
        const a = a0 + (Math.random() - 0.5) * 0.9;
        const r = R * (0.95 + Math.random() * 0.25);
        ctx.spawnEnemy(ev.type, ctx.player.x + Math.cos(a) * r, ctx.player.y + Math.sin(a) * r * 0.8, c);
      }
      ctx.audio.swarm(1.2);
    } else if (ev.kind === "boss") {
      ctx.spawnBoss(ev.type, this.bossCurve(ctx.time));
    }
  }
}

function pickWeighted(pool) {
  let total = 0;
  for (const k in pool) total += pool[k];
  let r = Math.random() * total;
  for (const k in pool) {
    r -= pool[k];
    if (r <= 0) return k;
  }
  return Object.keys(pool)[0];
}

/* ---------------------------------------------------------- */
/* Per-enemy AI                                                */
/* ---------------------------------------------------------- */

/**
 * Behaviour update for a single enemy. Kept free of rendering and
 * of collision resolution — game.js owns both — so this stays a
 * pure "decide where I want to be" function.
 */
export function stepEnemy(e, dt, ctx) {
  const px = ctx.player.x;
  const py = ctx.player.y - ctx.player.h * 0.35;
  const ex = e.x;
  const ey = e.y - e.h * 0.35;
  let dx = px - ex;
  let dy = py - ey;
  const dist = Math.hypot(dx, dy) || 1;
  dx /= dist; dy /= dist;

  const def = e.def;
  let want = def.speed * e.speedMult;

  switch (def.behavior) {
    case "dash": {
      e.dashT = (e.dashT || 0) - dt;
      if (e.dashT <= 0) {
        if (e.dashing) { e.dashing = false; e.dashT = 1.1 + Math.random() * 0.8; }
        else if (dist < 420) {
          e.dashing = true; e.dashT = 0.42;
          e.dashX = dx; e.dashY = dy;
          ctx.fx.word(e.x, e.y - e.h - 8, "light", { text: ">>", scale: 0.5, life: 0.4 });
        } else e.dashT = 0.4;
      }
      if (e.dashing) {
        want *= 3.6;
        dx = e.dashX; dy = e.dashY;
      } else want *= 0.5;
      break;
    }

    case "ranged": {
      e.shotT = (e.shotT || Math.random() * def.shotCd) - dt;
      if (dist < def.range) {
        want *= dist < def.range * 0.7 ? -0.55 : 0.12;    // hold the line
        if (e.shotT <= 0) {
          e.shotT = def.shotCd * (0.8 + Math.random() * 0.4);
          ctx.spawnEnemyShot(e, dx, dy, def);
        }
      }
      break;
    }

    case "drift":
      // Ghosts ignore each other and glide straight through.
      want *= 1 + Math.sin(ctx.time * 1.6 + e.seed) * 0.16;
      break;

    case "boss": {
      e.slamT = (e.slamT || def.slamCd) - dt;
      if (e.slamT <= 0 && dist < def.slamRadius * 1.5) {
        e.slamT = def.slamCd;
        e.telegraph = 0.62;
      }
      if (e.telegraph > 0) {
        e.telegraph -= dt;
        want *= 0.12;
        if (e.telegraph <= 0) ctx.bossSlam(e);
      }
      if (def.summonCd) {
        e.summonT = (e.summonT || def.summonCd) - dt;
        if (e.summonT <= 0) { e.summonT = def.summonCd; ctx.bossSummon(e); }
      }
      if (def.chargeCd) {
        e.chargeT = (e.chargeT || def.chargeCd) - dt;
        if (e.chargeT <= 0 && dist > 200) {
          e.chargeT = def.chargeCd;
          e.charging = 1.1;
        }
        if (e.charging > 0) { e.charging -= dt; want *= 3.1; }
      }
      break;
    }

    default:
      break;
  }

  e.wantX = dx * want;
  e.wantY = dy * want * 0.82;   // slightly flatter approach reads better top-down
  if (Math.abs(dx) > 0.08) e.flip = dx < 0;
}
