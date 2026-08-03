/* ============================================================
   INKBLOOD — actions.js
   Player-controlled combat verbs: Ink Step and Blood Eclipse.

   These live outside the automatic weapon loop on purpose. They
   are short, readable manga beats with their own input edges,
   animation state, invulnerability, charge economy and FX timing.
   ============================================================ */

"use strict";

import { PAL } from "./art.js?v=20260803-2";

export const ACTION_CONFIG = Object.freeze({
  dodge: Object.freeze({
    name: "INK STEP",
    duration: 0.2,
    cooldown: 1.08,
    speed: 840,
    invuln: 0.28,
    trailLife: 0.3,
    trailInterval: 0.038,
  }),
  special: Object.freeze({
    name: "BLOOD ECLIPSE",
    maxCharge: 30,
    duration: 0.82,
    windup: 0.31,
    radius: 370,
    baseDamage: 235,
    levelDamage: 7,
    invuln: 0.94,
  }),
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class ActionSystem {
  constructor(game) {
    this.game = game;
    this.suppressCharge = false;
    this.charge = 0;
    this.specialImpactDone = false;
    this.trailAcc = 0;
  }

  reset(player) {
    this.charge = 0;
    this.suppressCharge = false;
    this.specialImpactDone = false;
    this.trailAcc = 0;

    player.dodgeT = 0;
    player.dodgeCd = 0;
    player.dodgeDirX = player.facing || 1;
    player.dodgeDirY = 0;
    player.dodgeTrail = [];
    player.specialT = 0;
    player.specialDuration = ACTION_CONFIG.special.duration;
  }

  tryDodge() {
    const game = this.game;
    const p = game.player;
    const cfg = ACTION_CONFIG.dodge;
    if (!p || game.phase !== "playing" || p.dodgeCd > 0 || p.dodgeT > 0 || p.specialT > 0) return false;

    let dx = game.input.x;
    let dy = game.input.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.08) {
      dx /= len;
      dy /= len;
    } else {
      dx = p.facing || 1;
      dy = 0;
    }

    p.dodgeDirX = dx;
    p.dodgeDirY = dy;
    p.dodgeT = cfg.duration;
    p.dodgeCd = cfg.cooldown;
    p.invuln = Math.max(p.invuln, cfg.invuln);
    p.facing = dx < -0.05 ? -1 : (dx > 0.05 ? 1 : p.facing);
    p.slashT = 0;
    this.trailAcc = 0;
    this.captureTrail();

    const endX = p.x + dx * cfg.speed * cfg.duration;
    const endY = p.y + dy * cfg.speed * cfg.duration * 0.86;
    game.fx.dash(p.x, p.y - p.h * 0.42, endX, endY - p.h * 0.42, {
      colour: PAL.blood,
      life: cfg.duration + 0.16,
    });
    game.fx.ring(p.x, p.y - 6, 34, 8, 0.22, { colour: PAL.ink, width: 7, spokes: 5 });
    game.fx.focusTarget = Math.max(game.fx.focusTarget, 0.48);
    game.fx.shake(3.5);
    game.audio.dodge();
    return true;
  }

  trySpecial() {
    const game = this.game;
    const p = game.player;
    const cfg = ACTION_CONFIG.special;
    if (!p || game.phase !== "playing" || p.dodgeT > 0 || p.specialT > 0
      || this.charge < cfg.maxCharge) return false;

    this.charge = 0;
    this.specialImpactDone = false;
    p.specialT = cfg.duration;
    p.specialDuration = cfg.duration;
    p.invuln = Math.max(p.invuln, cfg.invuln);
    p.vx = 0;
    p.vy = 0;
    p.moving = false;
    p.slashT = 0;

    game.fx.eclipse(p.x, p.y - 16, cfg.radius, cfg.duration, {
      follow: p,
      offsetY: -16,
      impactAt: cfg.windup / cfg.duration,
    });
    game.fx.ring(p.x, p.y - 16, cfg.radius * 0.72, 28, cfg.windup, {
      colour: PAL.arcane,
      width: 9,
      spokes: 12,
      follow: p,
    });
    game.fx.motesBurst(p.x, p.y - p.h * 0.46, 20, PAL.arcaneHot, 210, {
      life: 0.48,
      gravity: -70,
      r: 3.4,
    });
    game.fx.word(p.x, p.y - p.h - 30, "huge", {
      text: "ECLIPSE",
      scale: 0.72,
      life: 0.64,
      colour: PAL.ink,
      vy: -8,
      drift: 0,
      rot: -0.04,
    });
    game.fx.focusTarget = Math.max(game.fx.focusTarget, 0.94);
    game.audio.special();
    return true;
  }

  /** Advance cooldowns, authored action movement and afterimages. */
  update(dt) {
    const p = this.game.player;
    if (!p) return "none";

    p.dodgeCd = Math.max(0, p.dodgeCd - dt);
    for (let i = p.dodgeTrail.length - 1; i >= 0; i--) {
      const echo = p.dodgeTrail[i];
      echo.t += dt;
      if (echo.t >= echo.life) p.dodgeTrail.splice(i, 1);
    }

    if (p.specialT > 0) {
      const before = p.specialDuration - p.specialT;
      p.specialT = Math.max(0, p.specialT - dt);
      const after = p.specialDuration - p.specialT;
      if (!this.specialImpactDone && before < ACTION_CONFIG.special.windup
        && after >= ACTION_CONFIG.special.windup) {
        this.impactSpecial();
      }
      p.vx = 0;
      p.vy = 0;
      p.moving = false;
      return "special";
    }

    if (p.dodgeT > 0) {
      const travel = Math.min(dt, p.dodgeT);
      p.dodgeT = Math.max(0, p.dodgeT - dt);
      p.vx = p.dodgeDirX * ACTION_CONFIG.dodge.speed;
      p.vy = p.dodgeDirY * ACTION_CONFIG.dodge.speed * 0.86;
      p.x += p.vx * travel;
      p.y += p.vy * travel;
      p.moving = true;

      this.trailAcc -= travel;
      while (this.trailAcc <= 0) {
        this.captureTrail();
        this.trailAcc += ACTION_CONFIG.dodge.trailInterval;
      }

      if (p.dodgeT === 0) {
        this.game.fx.ring(p.x, p.y - 4, 8, 46, 0.2, {
          colour: PAL.blood,
          width: 5,
          spokes: 4,
        });
      }
      return "dodge";
    }

    return "none";
  }

  captureTrail() {
    const p = this.game.player;
    if (!p) return;
    p.dodgeTrail.push({
      x: p.x,
      y: p.y,
      facing: p.facing,
      animT: p.animT,
      t: 0,
      life: ACTION_CONFIG.dodge.trailLife,
    });
    if (p.dodgeTrail.length > 7) p.dodgeTrail.shift();
  }

  impactSpecial() {
    const game = this.game;
    const p = game.player;
    const cfg = ACTION_CONFIG.special;
    this.specialImpactDone = true;

    const damage = (cfg.baseDamage + p.level * cfg.levelDamage) * game.stats.might;
    const radius2 = cfg.radius * cfg.radius;
    const oldSuppress = this.suppressCharge;
    this.suppressCharge = true;
    try {
      for (const enemy of game.enemies) {
        if (enemy.dead) continue;
        const dx = enemy.x - p.x;
        const dy = (enemy.y - enemy.h * 0.4) - (p.y - 16);
        if (dx * dx + dy * dy > radius2) continue;
        game.damageEnemy(enemy, damage, Math.atan2(dy, dx), {
          knockback: 540,
          number: !!enemy.boss,
        });
      }
    } finally {
      this.suppressCharge = oldSuppress;
    }

    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2 + (i % 2 ? 0.12 : -0.08);
      game.fx.slash(p.x + Math.cos(angle) * 58, p.y - 20 + Math.sin(angle) * 46,
        angle, 1.12 + (i % 3) * 0.13, { life: 0.36 });
    }
    game.fx.ring(p.x, p.y - 16, 26, cfg.radius, 0.45, {
      colour: PAL.blood,
      width: 16,
      spokes: 18,
    });
    game.fx.ring(p.x, p.y - 16, 18, cfg.radius * 0.82, 0.34, {
      colour: PAL.ink,
      width: 7,
      spokes: 10,
    });
    game.fx.motesBurst(p.x, p.y - 28, 54, PAL.blood, 520, {
      life: 0.72,
      gravity: 560,
      r: 4.2,
      decal: true,
    });
    game.fx.screenFlash(0.34);
    game.fx.shake(22);
    game.fx.focusTarget = Math.max(game.fx.focusTarget, 1);
    game.slowmo = Math.max(game.slowmo, 0.2);
    game.audio.boom(1.05);
  }

  onKill(enemy) {
    if (this.suppressCharge || !enemy) return;
    const cfg = ACTION_CONFIG.special;
    const amount = enemy.boss ? cfg.maxCharge : (enemy.def?.elite ? 4 : 1);
    this.gainCharge(amount);
  }

  gainCharge(amount, { quiet = false } = {}) {
    const cfg = ACTION_CONFIG.special;
    const before = this.charge;
    this.charge = Math.max(0, Math.min(cfg.maxCharge, before + amount));
    if (!quiet && before < cfg.maxCharge && this.charge >= cfg.maxCharge) {
      const p = this.game.player;
      this.game.fx.ring(p.x, p.y - 28, 18, 112, 0.48, {
        colour: PAL.arcaneHot,
        width: 8,
        spokes: 8,
        follow: p,
      });
      this.game.fx.motesBurst(p.x, p.y - p.h * 0.48, 22, PAL.arcaneHot, 250, {
        life: 0.62,
        gravity: -120,
        r: 3.1,
      });
      this.game.fx.word(p.x, p.y - p.h - 20, "heavy", {
        text: "READY",
        scale: 0.68,
        life: 0.8,
        colour: PAL.arcane,
        drift: 0,
      });
      this.game.fx.focusTarget = Math.max(this.game.fx.focusTarget, 0.62);
      this.game.audio.specialReady();
    }
    return this.charge;
  }

  setCharge(value, opts = {}) {
    const cfg = ACTION_CONFIG.special;
    const target = clamp01(value / cfg.maxCharge) * cfg.maxCharge;
    const delta = target - this.charge;
    return this.gainCharge(delta, opts);
  }

  state() {
    const p = this.game.player;
    const dodgeCd = p?.dodgeCd || 0;
    const specialCfg = ACTION_CONFIG.special;
    const dodgeCfg = ACTION_CONFIG.dodge;
    return {
      dodge: {
        name: dodgeCfg.name,
        active: Boolean(p && p.dodgeT > 0),
        ready: Boolean(p && dodgeCd <= 0 && p.specialT <= 0),
        cooldown: dodgeCd,
        cooldownMax: dodgeCfg.cooldown,
        progress: clamp01(1 - dodgeCd / dodgeCfg.cooldown),
      },
      special: {
        name: specialCfg.name,
        active: Boolean(p && p.specialT > 0),
        ready: this.charge >= specialCfg.maxCharge,
        charge: this.charge,
        maxCharge: specialCfg.maxCharge,
        progress: clamp01(this.charge / specialCfg.maxCharge),
        radius: specialCfg.radius,
      },
    };
  }
}
