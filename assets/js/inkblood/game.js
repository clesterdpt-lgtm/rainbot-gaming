/* ============================================================
   INKBLOOD — game.js
   The loop, the world, and everything that owns state.

   Structure notes for anyone editing this:

   * ONE array per entity class, all pooled, all swept with a
     backwards splice. Nothing allocates during a frame except
     projectiles at fire time.
   * A uniform-grid spatial hash is rebuilt each frame from enemy
     positions. Every "what is near X" query in the game goes
     through it — projectile hits, player contact, separation.
     With several hundred bodies on screen, doing any of those
     pairwise is the difference between 60fps and 12.
   * Rendering is strictly layered and y-sorted. The draw list is
     rebuilt each frame and sorted once.
   ============================================================ */

"use strict";

import {
  PAL, paper, makeCanvas, ctxOf, inkText, panelFrame, brush, splat, rng,
  starburst, roughCircle, fillToneDevice, tone, focusLines, feather, wobble,
  drawInkSigil,
} from "./art.js?v=20260803-2";
import { bakeCast } from "./sprites.js?v=20260803-2";
import {
  bakeProps, drawGround, Ash, installGeneratedEnvironment, BACKGROUND,
} from "./props.js?v=20260803-calm-1";
import { bakeFx, Fx, ATLAS } from "./fx.js?v=20260803-close-slash-1";
import {
  WEAPONS, PASSIVES, WEP_ART, bakeWeaponArt, makeProjectile, stepProjectile,
  drawProjectile, drawChains,
} from "./weapons.js?v=20260803-close-slash-1";
import { ENEMIES, Director, stepEnemy, RUN_LENGTH } from "./enemies.js?v=20260803-calm-1";
import { Audio } from "./audio.js?v=20260803-actions-1";
import { Input } from "./input.js?v=20260803-actions-1";
import { Hud } from "./hud.js?v=20260803-close-slash-1";
import { loadGeneratedAssets } from "./generated-assets.js?v=20260803-calm-1";
import { ActionSystem } from "./actions.js?v=20260803-actions-1";

// The camera guarantees a minimum window onto the world in BOTH
// axes. Driving zoom from height alone is fine on a laptop and
// disastrous in portrait, where it leaves a phone player seeing
// under three hundred world units across — barely wider than the
// character — and unable to see what is about to hit them.
const WORLD_VIEW_H = 700;
const WORLD_VIEW_W = 780;
const MAX_ENEMIES = 340;
const CELL = 72;
// The baked gait reads forward when its planted foot travels from
// front to back. The original runtime advanced it in the opposite
// order, giving every moving figure a moonwalk/backpedal read.
const WALK_CYCLE_DIRECTION = -1;

/**
 * Safe cyclic frame index. Guards against a negative or NaN time
 * producing arr[-1] / arr[NaN], which is a silent undefined and
 * then a crash three lines later inside drawImage.
 */
export function frameAt(list, t, rate) {
  const n = list.length;
  if (!n) return null;
  const raw = Math.floor((t || 0) * rate);
  const i = ((raw % n) + n) % n;
  return list[i];
}

/** Shared forward gait order for the hero and every walking yokai. */
export function gaitFrameIndex(t, rate, frameCount, phase = 0) {
  if (!frameCount) return -1;
  const raw = Math.floor((t || 0) * rate * WALK_CYCLE_DIRECTION + phase);
  return ((raw % frameCount) + frameCount) % frameCount;
}

export const FONTS = {
  display: (px) => `${px.toFixed(1)}px "Bebas Neue", "Arial Narrow", Impact, sans-serif`,
  impact: (px) => `${px.toFixed(1)}px "Anton", Impact, "Arial Black", sans-serif`,
  jp: (px) => `900 ${px.toFixed(1)}px "Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif`,
  body: (px) => `${px.toFixed(1)}px system-ui, -apple-system, "Segoe UI", sans-serif`,
};

// The title treatment was composed around the original long, dry-brush cut.
// Keep that one plate for the poster while generated combat uses the richer
// painted slash everywhere in the world.
let titleSlash = null;

function installGeneratedCombat(combat) {
  if (!combat) return;

  for (const key of ["gem", "gemBig", "coin", "heart", "chest", "magnet", "bomb"]) {
    if (combat[key]) ATLAS[key] = combat[key];
  }
  if (combat.slash) {
    titleSlash ||= ATLAS.slash[0] || null;
    ATLAS.slash = Array.from({ length: 4 }, () => combat.slash);
  }
  if (combat.bloodSplat) ATLAS.bloodSplat = Array.from({ length: 6 }, () => combat.bloodSplat);
  if (combat.inkHit) ATLAS.inkHit = Array.from({ length: 5 }, () => combat.inkHit);
  if (combat.enemyShot) ATLAS.enemyShot = combat.enemyShot;

  for (const key of ["kunai", "ofuda", "sickle", "fang"]) {
    if (combat[key]) WEP_ART[key] = combat[key];
  }
  if (Array.isArray(combat.crow) && combat.crow.length >= 2) WEP_ART.crow = combat.crow;
}

/* ---------------------------------------------------------- */
/* Spatial hash                                                */
/* ---------------------------------------------------------- */

class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  clear() { this.map.clear(); }
  key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }
  insert(e) {
    const cx = Math.floor(e.x / this.cell);
    const cy = Math.floor(e.y / this.cell);
    const k = this.key(cx, cy);
    let b = this.map.get(k);
    if (!b) { b = []; this.map.set(k, b); }
    b.push(e);
  }
  /** Calls fn for every entity in cells overlapping the circle. */
  query(x, y, r, fn) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c);
    const y1 = Math.floor((y + r) / c);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.map.get(this.key(cx, cy));
        if (!b) continue;
        for (let i = 0; i < b.length; i++) fn(b[i]);
      }
    }
  }
}

/* ---------------------------------------------------------- */
/* Game                                                        */
/* ---------------------------------------------------------- */

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d", { alpha: false });
    this.fx = new Fx();
    this.audio = new Audio();
    this.input = new Input(canvas);
    this.hud = new Hud(FONTS);
    this.actions = new ActionSystem(this);
    this.director = new Director();
    this.grid = new Grid(CELL);
    this.ash = new Ash(BACKGROUND.ashCount);

    this.enemies = [];
    this.projectiles = [];
    this.enemyShots = [];
    this.pickups = [];
    this.timers = [];
    this.drawList = [];

    this.maxEnemies = MAX_ENEMIES;
    this.phase = "boot";
    this.time = 0;
    this.realTime = 0;
    this.paused = false;
    this.slowmo = 0;
    this.dpr = 1;
    // The status ledger is still available through the debug toggle, but the
    // combat view now follows the reference's clean, top-weighted hierarchy.
    this.showStats = false;
    this.frame = 0;
    this.fpsSamples = [];
    this.fps = 60;

    this.onScore = null;   // set by main.js so the site can record it
    this.onUiState = null;
    this.onActionState = null;
    this.lastUiPhase = "";

    this.bindCanvas();
  }

  /* ------------------------------------------------------- */
  /* Boot                                                    */
  /* ------------------------------------------------------- */

  async load(onProgress) {
    const step = (p, label) => onProgress && onProgress(p, label);
    step(0.04, "Mixing ink");
    await new Promise((r) => setTimeout(r, 0));

    bakeFx();
    step(0.16, "Cutting screentone");
    await new Promise((r) => setTimeout(r, 0));

    bakeProps();
    step(0.24, "Raising the torii");
    await new Promise((r) => setTimeout(r, 0));

    bakeWeaponArt();
    step(0.28, "Folding paper charms");
    await new Promise((r) => setTimeout(r, 0));

    try {
      const generated = await loadGeneratedAssets((p, label) => {
        step(0.3 + p * 0.66, label || "Mounting manga plates");
      });
      this.art = generated.art;
      installGeneratedEnvironment(generated);
      installGeneratedCombat(generated.combat);
      this.generatedAssets = { mode: "generated", ...generated.manifest };
    } catch (error) {
      console.warn("[inkblood] generated manga art unavailable; using procedural fallback", error);
      this.generatedAssets = {
        mode: "procedural-fallback",
        loaded: 0,
        failed: [String(error?.message || error)],
      };
      this.art = await bakeCast((p, label) => step(0.3 + p * 0.66, label));
    }

    step(0.99, "Opening the gate");
    this.titleBg = this.bakeTitleArt();
    this.titleCrowd = this.bakeTitleCrowd();
    this.ready = true;
  }

  /* ------------------------------------------------------- */
  /* Canvas                                                  */
  /* ------------------------------------------------------- */

  bindCanvas() {
    this.resize();
    let resizeFrame = 0;
    const scheduleResize = () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        this.resize();
      });
    };
    window.addEventListener("resize", scheduleResize);
    if (typeof ResizeObserver === "function" && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(scheduleResize);
      this.resizeObserver.observe(this.canvas.parentElement);
    }
    this.canvas.addEventListener("pointerdown", (e) => this.onPointer(e));
  }

  resize() {
    const host = this.canvas.parentElement;
    const w = Math.max(1, Math.round(host?.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.round(host?.clientHeight || window.innerHeight));
    // Cap the backing store: a 4K display would otherwise ask the
    // 2D context to fill 8M pixels of screentone every frame.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.w === w && this.h === h && this.dpr === dpr) return;
    this.dpr = dpr;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.w = w;
    this.h = h;
    this.zoom = Math.min(h / WORLD_VIEW_H, w / WORLD_VIEW_W);
    this.hud.layout(w, h);
    this.paperPattern = null;
    this.vignette = this.bakeVignette();
  }

  onPointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (this.phase === "levelup") {
      const i = this.hud.hitTest(x, y);
      if (i >= 0) { this.selected = i; this.takeChoice(); }
    } else if (this.phase === "title" || this.phase === "dead" || this.phase === "won") {
      this.onConfirm();
    }
  }

  togglePause() {
    if (this.phase === "playing") this.phase = "paused";
    else if (this.phase === "paused") this.phase = "playing";
    else return false;
    return true;
  }

  tryDodge() { return this.actions.tryDodge(); }

  trySpecial() { return this.actions.trySpecial(); }

  actionState() { return this.actions.state(); }

  /* ------------------------------------------------------- */
  /* Run lifecycle                                           */
  /* ------------------------------------------------------- */

  newRun() {
    this.input.clearActionPresses();
    this.input.takePressed();
    this.time = 0;
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.enemyShots.length = 0;
    this.pickups.length = 0;
    this.timers.length = 0;
    this.fx.reset();
    this.director.reset();
    this.kills = 0;
    this.coins = 0;
    this.boss = null;
    this.slowmo = 0;

    this.player = {
      x: 0, y: 0, vx: 0, vy: 0,
      h: 95, radius: 20,
      facing: 1,
      hp: 120, maxHp: 120,
      level: 1, xp: 0, xpNeed: this.xpFor(1),
      invuln: 0, hurtFlash: 0,
      animT: 0, moving: false,
      slashT: 0, slashDuration: 0.34,
      regenAcc: 0,
    };
    this.actions.reset(this.player);

    this.baseStats = {
      might: 1, cooldown: 1, area: 1, duration: 1, amount: 0,
      armor: 0, moveSpeed: 1, magnet: 1, luck: 1, maxHp: 120, regen: 0, revives: 0,
    };
    this.stats = { ...this.baseStats };

    this.weapons = [];
    this.passives = [];
    this.addWeapon("crimsonArc");
    this.recomputeStats();
    this.player.hp = this.player.maxHp;

    this.phase = "playing";
    this.audio.startMusic();
  }

  xpFor(level) {
    // Steep enough that a full fifteen minutes lands somewhere around
    // level seventy rather than a hundred and twenty, which is well
    // past the point where every line is maxed and the choice screen
    // has nothing left to offer.
    return Math.floor(3 + level * 2.6 + Math.pow(level, 1.8));
  }

  /* ------------------------------------------------------- */
  /* Loadout                                                 */
  /* ------------------------------------------------------- */

  addWeapon(id) {
    const def = WEAPONS[id];
    const w = { id, level: 1, cd: 0, orbs: [], orb: null };
    this.weapons.push(w);
    if (def.persistent) w.cd = 0.05;
    return w;
  }

  addPassive(id) {
    const p = { id, level: 1 };
    this.passives.push(p);
    return p;
  }

  recomputeStats() {
    const s = { ...this.baseStats };
    for (const p of this.passives) PASSIVES[p.id].apply(s, p.level);
    s.cooldown = Math.max(0.35, s.cooldown);
    const oldMax = this.player.maxHp;
    this.stats = s;
    this.player.maxHp = s.maxHp;
    if (s.maxHp > oldMax) this.player.hp += s.maxHp - oldMax;
    this.player.hp = Math.min(this.player.hp, this.player.maxHp);
  }

  /** Weapon numbers after the player's global multipliers. */
  scaled(w) {
    const def = WEAPONS[w.id];
    const base = def.stats(w.level);
    const s = this.stats;
    return {
      damage: base.damage * s.might,
      cooldown: Math.max(0.08, (base.cooldown || 1) * s.cooldown),
      area: (base.area == null ? 1 : base.area) * s.area,
      amount: (base.amount == null ? 1 : base.amount) + (def.persistent || base.amount != null ? s.amount : 0),
      speed: base.speed || 400,
      pierce: base.pierce || 1,
      knockback: base.knockback || 120,
      reach: (base.reach || 0) * s.area,
      length: base.length || 0,
      turn: base.turn || 6,
      double: base.double,
      both: base.both,
      tickRate: base.tickRate,
      drain: base.drain,
    };
  }

  /* ------------------------------------------------------- */
  /* Facade handed to weapons                                */
  /* ------------------------------------------------------- */

  after(delay, fn) { this.timers.push({ t: delay, fn }); }

  animatePlayerSlash(angle = 0, duration = 0.34) {
    const p = this.player;
    if (!p) return;
    if (Math.abs(Math.cos(angle)) > 0.08) p.facing = Math.cos(angle) >= 0 ? 1 : -1;
    p.slashDuration = Math.max(0.18, duration);
    p.slashT = p.slashDuration;
  }

  nearestEnemy(x, y, maxDist) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - x;
      const dy = (e.y - e.h * 0.4) - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  nearestEnemies(x, y, maxDist, n) {
    const found = [];
    const lim = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - x;
      const dy = (e.y - e.h * 0.4) - y;
      const d = dx * dx + dy * dy;
      if (d < lim) found.push([d, e]);
    }
    found.sort((a, b) => a[0] - b[0]);
    return found.slice(0, n).map((f) => f[1]);
  }

  randomEnemies(n, maxDist) {
    const pool = [];
    const lim = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - this.player.x;
      const dy = e.y - this.player.y;
      if (dx * dx + dy * dy < lim) pool.push(e);
    }
    const out = [];
    for (let i = 0; i < n && pool.length; i++) {
      out.push(pool[(Math.random() * pool.length) | 0]);
    }
    return out;
  }

  areaDamage(x, y, r, damage, opts = {}) {
    const r2 = r * r;
    this.grid.query(x, y, r + 40, (e) => {
      if (e.dead || e.hitMark === this.frame) return;
      const dx = e.x - x;
      const dy = (e.y - e.h * 0.4) - y;
      if (dx * dx + dy * dy > r2) return;
      e.hitMark = this.frame;
      this.damageEnemy(e, damage, Math.atan2(dy, dx), {
        knockback: opts.knockback || 120,
        colour: opts.colour,
      });
    });
  }

  spawnRadius() {
    return Math.hypot(this.w / this.zoom, this.h / this.zoom) * 0.56 + 90;
  }

  edgeSpawnPoint() {
    const a = Math.random() * Math.PI * 2;
    const rx = (this.w / this.zoom) * 0.58 + 80;
    const ry = (this.h / this.zoom) * 0.58 + 80;
    return [this.player.x + Math.cos(a) * rx, this.player.y + Math.sin(a) * ry];
  }

  spawnEnemyShot(e, dx, dy, def) {
    this.enemyShots.push({
      x: e.x, y: e.y - e.h * 0.5,
      vx: dx * def.shotSpeed, vy: dy * def.shotSpeed,
      damage: def.shotDamage * (e.damageMult || 1),
      t: 0, life: 3, r: 12, dead: false, spin: 6, rot: 0,
    });
    this.audio.pop(0.7);
  }

  bossSlam(e) {
    const def = e.def;
    this.fx.ring(e.x, e.y - 10, 20, def.slamRadius, 0.42,
      { colour: PAL.ink, width: 14, spokes: 12 });
    this.fx.word(e.x, e.y - e.h - 20, "huge", { scale: 1.4 });
    this.fx.shake(18);
    this.fx.screenFlash(0.2, true);
    this.audio.boom(1.6);
    const dx = this.player.x - e.x;
    const dy = (this.player.y - this.player.h * 0.35) - (e.y - 10);
    if (dx * dx + dy * dy < def.slamRadius * def.slamRadius) {
      this.hurtPlayer(def.slamDamage * (e.damageMult || 1), Math.atan2(dy, dx));
    }
  }

  bossSummon(e) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.spawnEnemy("yurei", e.x + Math.cos(a) * 120, e.y + Math.sin(a) * 90,
        this.director.curve(this.time));
    }
    this.fx.ring(e.x, e.y - 20, 10, 160, 0.4, { colour: PAL.arcane, width: 8, spokes: 8 });
    this.audio.swarm(0.8);
  }

  /* ------------------------------------------------------- */
  /* Entities                                                */
  /* ------------------------------------------------------- */

  spawnEnemy(type, x, y, curve) {
    if (this.enemies.length >= this.maxEnemies) return null;
    const def = ENEMIES[type];
    const hp = def.hp * curve.hp;
    const e = {
      def, type,
      x, y,
      vx: 0, vy: 0, wantX: 0, wantY: 0,
      hp, maxHp: hp,
      h: def.h, radius: def.radius,
      speedMult: curve.speed,
      damageMult: curve.damage,
      // Every baked figure faces +x. Enemies spawned to the right of
      // the player immediately need the mirrored drawing so their
      // first visible frame does not moonwalk toward the fight.
      flip: this.player ? x > this.player.x : false,
      animT: Math.random() * 4,
      attackT: 0,
      attackDuration: 0.36,
      attackKind: "",
      attackFlip: null,
      attackProgressStart: 0,
      hitFlash: 0,
      dead: false,
      contactCd: 0,
      seed: Math.random() * 10,
      hitMark: -1,
      bobPhase: Math.random() * 6.283,
      id: this.nextId = (this.nextId || 0) + 1,
    };
    this.enemies.push(e);
    return e;
  }

  spawnBoss(type, curve) {
    const def = ENEMIES[type];
    const a = Math.random() * Math.PI * 2;
    const R = this.spawnRadius() * 0.9;
    const e = this.spawnEnemy(type, this.player.x + Math.cos(a) * R, this.player.y + Math.sin(a) * R, curve);
    if (!e) return;
    e.boss = true;
    this.boss = e;
    this.fx.showPanel("boss", { name: def.name, sigil: def.sigil, title: def.title, sprite: type }, 2.6);
    this.fx.screenFlash(0.55, true);
    this.fx.shake(20);
    this.fx.focusTarget = 0.9;
    this.audio.bossRoar();
    this.slowmo = 0.9;
  }

  /**
   * Cap on loose pickups.
   *
   * A player who never walks over their souls leaves one gem per
   * kill lying on the field — nearly two thousand of them by the
   * fifteenth minute in testing, every one of them updated and
   * drawn every frame forever. When the field is full the oldest
   * distant gems are collapsed into the newest one so no experience
   * is actually lost, just the object.
   */
  trimPickups() {
    const MAX = 320;
    if (this.pickups.length <= MAX) return;
    const px = this.player.x;
    const py = this.player.y;
    let merged = 0;
    for (let i = 0; i < this.pickups.length && this.pickups.length - i > MAX * 0.8; i++) {
      const u = this.pickups[i];
      if (u.kind !== "gem" || u.magnet) continue;
      const dx = u.x - px;
      const dy = u.y - py;
      if (dx * dx + dy * dy < 900 * 900) continue;   // still nearby, leave it
      merged += u.value;
      this.pickups.splice(i, 1);
      i--;
    }
    if (merged > 0) {
      // Fold the lost value into the most recent gem so the run's
      // total experience is unchanged.
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        if (this.pickups[i].kind === "gem") { this.pickups[i].value += merged; return; }
      }
      this.gainXp(merged);
    }
  }

  dropPickup(kind, x, y, value) {
    this.pickups.push({
      kind, x, y, value,
      vx: (Math.random() - 0.5) * 90, vy: -110 - Math.random() * 70,
      z: 0, vz: 0, grounded: false,
      t: 0, magnet: false, dead: false,
      bob: Math.random() * 6.283,
    });
  }

  /* ------------------------------------------------------- */
  /* Damage                                                  */
  /* ------------------------------------------------------- */

  damageEnemy(e, damage, dir, opts = {}) {
    if (e.dead) return;
    const crit = Math.random() < 0.08;
    const dmg = damage * (crit ? 2 : 1);
    e.hp -= dmg;
    e.hitFlash = 0.09;

    const hx = e.x + Math.cos(dir) * e.radius * 0.4;
    const hy = e.y - e.h * 0.45 + Math.sin(dir) * e.radius * 0.3;
    const power = Math.min(3, 0.5 + dmg / 42);
    const showNumber = opts.number === false
      ? false
      : (crit || !!e.boss || this.fx.floaters.length < 26);
    this.fx.hit(hx, hy, dir, dmg, { power, crit, big: !!e.boss, number: showNumber });

    const kb = (opts.knockback || 100) * (1 - (e.def.kbResist || 0));
    e.vx += Math.cos(dir) * kb;
    e.vy += Math.sin(dir) * kb * 0.7;

    if (crit) {
      this.fx.word(hx, hy - 24, "heavy", { scale: 0.8 });
      this.audio.impact(1.4);
    } else if (Math.random() < 0.06) {
      this.fx.word(hx, hy - 18, "light", { scale: 0.52, life: 0.45 });
    }
    if (Math.random() < 0.3) this.audio.impact(0.7);

    if (e.hp <= 0) this.killEnemy(e, dir);
  }

  killEnemy(e, dir) {
    e.dead = true;
    this.kills++;
    this.actions.onKill(e);

    const big = !!e.boss || !!e.def.elite;
    this.fx.stain(e.x, e.y, big ? 2.4 : 0.9);
    this.fx.motesBurst(e.x, e.y - e.h * 0.4, big ? 40 : 10, PAL.blood, big ? 460 : 250, { decal: true });
    this.fx.bursts.push({
      x: e.x, y: e.y - e.h * 0.45, dir: dir || 0, t: 0, life: 0.3,
      idx: (this.frame + e.id) % ATLAS.bloodBurst.length,
      scale: big ? 2.2 : 0.7,
    });

    const luck = this.stats.luck;
    const xp = Math.max(1, Math.round(e.def.xp * luck));
    if (e.def.xp >= 100) {
      // Bosses shower the field.
      for (let i = 0; i < 24; i++) this.dropPickup("gem", e.x, e.y, Math.ceil(xp / 24));
      for (let i = 0; i < 10; i++) this.dropPickup("coin", e.x, e.y, 25);
      this.dropPickup("chest", e.x, e.y, 1);
      this.dropPickup("heart", e.x, e.y, 40);
    } else {
      this.dropPickup("gem", e.x, e.y, xp);
      if (Math.random() < 0.03 * luck) this.dropPickup("coin", e.x, e.y, 1 + ((Math.random() * 6) | 0));
      if (Math.random() < 0.006) this.dropPickup("heart", e.x, e.y, 18);
      if (e.def.elite) this.dropPickup("chest", e.x, e.y, 1);
    }

    if (e.boss) {
      this.fx.showPanel("kill", { name: e.def.name, sigil: e.def.sigil }, 2.2);
      this.fx.screenFlash(0.7);
      this.fx.shake(24);
      this.slowmo = 1.4;
      this.audio.death();
      this.boss = null;
      if (e.type === "nurarihyon") this.after(2.4, () => this.win());
    } else {
      this.fx.word(e.x, e.y - e.h - 6, big ? "heavy" : "light",
        { scale: big ? 1 : 0.45, life: big ? 0.7 : 0.36 });
    }
  }

  hurtPlayer(damage, dir) {
    const p = this.player;
    if (p.invuln > 0 || this.phase !== "playing") return;
    const net = Math.max(1, damage - this.stats.armor);
    p.hp -= net;
    p.invuln = 0.55;
    p.hurtFlash = 0.3;
    this.fx.shake(7);
    this.fx.screenFlash(0.22);
    this.fx.damage(p.x, p.y - p.h * 0.7, net, false);
    this.fx.motesBurst(p.x, p.y - p.h * 0.5, 8, PAL.blood, 220, { decal: true });
    this.audio.hurt();
    if (p.hp <= 0) {
      if (this.stats.revives > 0) {
        this.stats.revives--;
        this.baseStats.revives = this.stats.revives;
        p.hp = p.maxHp;
        p.invuln = 3;
        this.fx.showPanel("revive", {}, 1.8);
        this.fx.screenFlash(0.9);
        this.clearField(520);
        this.audio.levelUp();
      } else {
        this.die();
      }
    }
  }

  clearField(radius) {
    const oldSuppress = this.actions.suppressCharge;
    this.actions.suppressCharge = true;
    try {
      for (const e of this.enemies) {
        if (e.dead || e.boss) continue;
        const dx = e.x - this.player.x;
        const dy = e.y - this.player.y;
        if (dx * dx + dy * dy < radius * radius) this.damageEnemy(e, 99999, Math.atan2(dy, dx));
      }
    } finally {
      this.actions.suppressCharge = oldSuppress;
    }
  }

  die() {
    this.phase = "dead";
    this.fx.showPanel("death", {}, 3.4);
    this.fx.screenFlash(0.9, true);
    this.fx.shake(26);
    this.audio.death();
    this.audio.stopMusic();
    this.report();
  }

  win() {
    this.phase = "won";
    this.fx.showPanel("win", {}, 4);
    this.fx.screenFlash(1);
    this.audio.stopMusic();
    this.report();
  }

  report() {
    if (this.onScore) this.onScore(this.score());
  }

  score() {
    return Math.round(this.kills * 10 + this.time * 12 + this.coins * 5 + this.player.level * 150);
  }

  /* ------------------------------------------------------- */
  /* Level up                                                */
  /* ------------------------------------------------------- */

  gainXp(n) {
    const p = this.player;
    p.xp += n;
    while (p.xp >= p.xpNeed) {
      p.xp -= p.xpNeed;
      p.level++;
      p.xpNeed = this.xpFor(p.level);
      this.queuedLevels = (this.queuedLevels || 0) + 1;
    }
    if (this.queuedLevels > 0 && this.phase === "playing") this.openLevelUp();
  }

  buildChoices() {
    const out = [];
    const wIds = this.weapons.map((w) => w.id);
    const pIds = this.passives.map((p) => p.id);

    // Evolutions first — they are the payoff and should never be
    // crowded out by an ordinary +8 damage.
    for (const w of this.weapons) {
      const def = WEAPONS[w.id];
      if (!def.evolve || w.level < def.max) continue;
      const req = this.passives.find((p) => p.id === def.evolve.requires);
      if (!req || req.level < PASSIVES[def.evolve.requires].max) continue;
      const ev = WEAPONS[def.evolve.into];
      out.push({
        kind: "evolve", id: def.evolve.into, from: w.id,
        name: ev.name, sigil: ev.sigil, desc: ev.desc, evolved: true, level: 0,
      });
    }
    if (out.length) return out.slice(0, 3);

    const pool = [];
    for (const w of this.weapons) {
      const def = WEAPONS[w.id];
      if (def.evolved || w.level >= def.max) continue;
      pool.push({
        kind: "weaponUp", id: w.id, name: def.name, sigil: def.sigil, level: w.level + 1,
        desc: def.levelText ? def.levelText[w.level] : def.desc, weight: 10,
      });
    }
    for (const p of this.passives) {
      const def = PASSIVES[p.id];
      if (p.level >= def.max) continue;
      pool.push({
        kind: "passiveUp", id: p.id, name: def.name, sigil: def.sigil, level: p.level + 1,
        desc: def.desc, weight: 8,
      });
    }
    if (this.weapons.length < 6) {
      for (const id in WEAPONS) {
        const def = WEAPONS[id];
        if (def.evolved || wIds.includes(id)) continue;
        pool.push({
          kind: "newWeapon", id, name: def.name, sigil: def.sigil, level: 0,
          desc: def.desc, isNew: true, weight: 14,
        });
      }
    }
    if (this.passives.length < 6) {
      for (const id in PASSIVES) {
        if (pIds.includes(id)) continue;
        const def = PASSIVES[id];
        pool.push({
          kind: "newPassive", id, name: def.name, sigil: def.sigil, level: 0,
          desc: def.desc, isNew: true, weight: 10,
        });
      }
    }

    if (!pool.length) {
      return [
        { kind: "heal", name: "Rice Offering", sigil: "rice", desc: "Restore 40 life.", level: 0 },
        { kind: "coins", name: "Found Coin", sigil: "coin", desc: "+80 coin.", level: 0 },
      ];
    }

    // Weighted draw without replacement.
    const picks = [];
    const work = pool.slice();
    for (let i = 0; i < 3 && work.length; i++) {
      let total = 0;
      for (const c of work) total += c.weight;
      let r = Math.random() * total;
      let idx = 0;
      for (let j = 0; j < work.length; j++) {
        r -= work[j].weight;
        if (r <= 0) { idx = j; break; }
      }
      picks.push(work.splice(idx, 1)[0]);
    }
    return picks;
  }

  openLevelUp() {
    this.choices = this.buildChoices();
    this.selected = 0;
    this.levelAnim = 0;
    this.phase = "levelup";
    this.fx.focusTarget = 0.5;
    this.audio.levelUp();
  }

  takeChoice() {
    const c = this.choices[this.selected];
    if (!c) return;
    switch (c.kind) {
      case "evolve": {
        const w = this.weapons.find((x) => x.id === c.from);
        w.id = c.id;
        w.level = 1;
        w.orbs = [];
        if (w.orb) { w.orb.dead = true; w.orb = null; }
        this.fx.showPanel("evolve", { name: WEAPONS[c.id].name, sigil: WEAPONS[c.id].sigil }, 2);
        break;
      }
      case "weaponUp": this.weapons.find((x) => x.id === c.id).level++; break;
      case "passiveUp": this.passives.find((x) => x.id === c.id).level++; break;
      case "newWeapon": this.addWeapon(c.id); break;
      case "newPassive": this.addPassive(c.id); break;
      case "heal": this.player.hp = Math.min(this.player.maxHp, this.player.hp + 40); break;
      case "coins": this.coins += 80; break;
      default: break;
    }
    this.recomputeStats();
    this.queuedLevels--;
    if (this.queuedLevels > 0) this.openLevelUp();
    else { this.phase = "playing"; this.choices = null; }
  }

  /* ------------------------------------------------------- */
  /* Update                                                  */
  /* ------------------------------------------------------- */

  step(dtReal) {
    this.realTime += dtReal;
    this.input.update();
    const phaseAtInput = this.phase;

    if (this.input.consumePause()) {
      this.togglePause();
    }

    // Action intents are deliberately discarded while a screen or pause is
    // in control. Space can start/restart/confirm without leaking a dodge
    // into the first resumed combat frame; Q cannot queue an Eclipse.
    if (phaseAtInput !== "playing" || this.phase !== "playing") this.input.clearActionPresses();

    if (this.phase === "title") {
      this.fx.update(dtReal);
      this.ash.update(dtReal, this.w, this.h);
      if (this.input.consumeAny()) { this.audio.init(); this.audio.resume(); this.newRun(); }
      return;
    }
    if (this.phase === "levelup") {
      this.levelAnim += dtReal;
      this.fx.update(dtReal * 0.4);
      this.handleLevelUpInput();
      return;
    }
    if (this.phase === "paused") {
      this.input.takePressed();
      this.fx.update(dtReal * 0.2);
      return;
    }
    if (this.phase === "dead" || this.phase === "won") {
      this.fx.update(dtReal);
      this.ash.update(dtReal, this.w, this.h);
      this.deadFor = (this.deadFor || 0) + dtReal;
      if (this.deadFor > 1.6 && this.input.consumeAny()) { this.deadFor = 0; this.newRun(); }
      return;
    }
    if (this.phase !== "playing") return;

    // Slow motion on dramatic beats.
    let scale = 1;
    if (this.slowmo > 0) {
      this.slowmo -= dtReal;
      scale = 0.28;
    }
    const dt = Math.min(0.05, dtReal) * scale;

    this.frame++;
    this.time += dt;

    if (this.input.consumeDodge()) this.tryDodge();
    if (this.input.consumeSpecial()) this.trySpecial();

    this.updateTimers(dt);
    this.updatePlayer(dt);
    this.director.update(dt, this);
    this.rebuildGrid();
    this.updateEnemies(dt);
    this.updateWeapons(dt);
    this.updateProjectiles(dt);
    this.updateEnemyShots(dt);
    this.updatePickups(dt);
    this.fx.update(dt);
    this.ash.update(dtReal, this.w, this.h);

    // Music tightens with the crowd.
    this.audio.setIntensity(Math.min(1, this.enemies.length / 180));
    this.audio.updateMusic(dtReal);

    // The page itself reacts: more bodies, more speed lines.
    const pressure = Math.min(1, this.enemies.length / 220);
    this.fx.focusTarget = Math.max(this.fx.focusTarget, pressure * 0.2);
  }

  updateTimers(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }
  }

  handleLevelUpInput() {
    // Edge-triggered, from the input queue rather than the held-key
    // set: a tap shorter than one frame never appears in `keys`, so
    // polling silently swallowed quick presses on the choice screen.
    const n = this.choices.length;
    for (const key of this.input.takePressed()) {
      if (key === "arrowleft" || key === "a") this.selected = (this.selected + n - 1) % n;
      else if (key === "arrowright" || key === "d") this.selected = (this.selected + 1) % n;
      else if (key === "enter" || key === " ") { this.takeChoice(); return; }
      else {
        const num = Number(key);
        if (num >= 1 && num <= n) { this.selected = num - 1; this.takeChoice(); return; }
      }
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    const action = this.actions.update(dt);
    if (action === "none") {
      const speed = 232 * this.stats.moveSpeed;
      const ix = this.input.x;
      const iy = this.input.y;
      p.vx = ix * speed;
      p.vy = iy * speed * 0.86;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.moving = Math.abs(ix) + Math.abs(iy) > 0.05;
      if (Math.abs(ix) > 0.05) p.facing = ix > 0 ? 1 : -1;
      p.animT += dt * (p.moving ? 1 : 0.55);
    } else if (action === "dodge") {
      p.animT += dt * 2.7;
    } else {
      p.animT += dt * 0.72;
    }
    if (p.slashT > 0) p.slashT = Math.max(0, p.slashT - dt);
    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
    if (p.hurtFlash > 0) p.hurtFlash = Math.max(0, p.hurtFlash - dt);

    if (this.stats.regen > 0 && p.hp < p.maxHp) {
      p.regenAcc += this.stats.regen * dt;
      if (p.regenAcc >= 1) {
        const n = Math.floor(p.regenAcc);
        p.regenAcc -= n;
        p.hp = Math.min(p.maxHp, p.hp + n);
      }
    }
  }

  rebuildGrid() {
    this.grid.clear();
    for (const e of this.enemies) if (!e.dead) this.grid.insert(e);
  }

  updateEnemies(dt) {
    const p = this.player;
    const cullR = this.spawnRadius() * 2.4;
    const cull2 = cullR * cullR;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) { this.enemies.splice(i, 1); continue; }

      stepEnemy(e, dt, this);

      // The walk cycle is authored facing +x. `flip` used to stay at
      // its spawn default forever, so anything travelling left moved
      // feet-first while looking right. Follow locomotion intent (not
      // knockback or separation) and retain the last facing during a
      // nearly vertical approach to prevent horizontal jitter.
      if (e.attackT > 0 && typeof e.attackFlip === "boolean") e.flip = e.attackFlip;
      else if (Math.abs(e.wantX) > 1) e.flip = e.wantX < 0;

      // Knockback decays, desired velocity blends in.
      e.vx *= Math.pow(0.0009, dt);
      e.vy *= Math.pow(0.0009, dt);
      e.x += (e.wantX + e.vx) * dt;
      e.y += (e.wantY + e.vy) * dt;
      e.animT += dt * (0.9 + e.speedMult * 0.4);
      if (e.attackT > 0) {
        e.attackT = Math.max(0, e.attackT - dt);
        if (e.attackT === 0) {
          e.attackKind = "";
          e.attackFlip = null;
          e.attackProgressStart = 0;
        }
      }
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.contactCd > 0) e.contactCd -= dt;

      // Separation: ghosts pass through, everyone else shoulders.
      if (!e.def.ghost) {
        let sx = 0;
        let sy = 0;
        let n = 0;
        this.grid.query(e.x, e.y, e.radius * 2, (o) => {
          if (o === e || o.dead || o.def.ghost || n > 5) return;
          const dx = e.x - o.x;
          const dy = (e.y - o.y) * 1.6;
          const d2 = dx * dx + dy * dy;
          const rr = (e.radius + o.radius) * 0.9;
          if (d2 > rr * rr || d2 < 0.0001) return;
          const d = Math.sqrt(d2);
          const push = (rr - d) / rr;
          const w = o.def.mass / (e.def.mass + o.def.mass);
          sx += (dx / d) * push * w;
          sy += (dy / d) * push * w;
          n++;
        });
        if (n) {
          e.x += sx * 220 * dt;
          e.y += sy * 130 * dt;
        }
      }

      // Contact damage.
      const dx = e.x - p.x;
      const dy = (e.y - e.h * 0.35) - (p.y - p.h * 0.35);
      const rr = e.radius + p.radius;
      if (dx * dx + dy * dy * 1.6 < rr * rr && e.contactCd <= 0) {
        e.contactCd = 0.55;
        // Do not interrupt a more expressive authored action (dash,
        // cast or boss wind-up), but give ordinary contact damage a
        // visible claw/lunge frame instead of a sliding walk pose.
        if (e.attackT <= 0) {
          e.attackT = 0.3;
          e.attackDuration = 0.3;
          e.attackKind = "contact";
          e.attackFlip = p.x < e.x;
          e.attackProgressStart = 0.25;
        }
        this.hurtPlayer(e.def.damage * e.damageMult, Math.atan2(dy, dx));
      }

      // Cull the far-away, but never the boss.
      if (!e.boss) {
        const cx = e.x - p.x;
        const cy = e.y - p.y;
        if (cx * cx + cy * cy > cull2) { this.enemies.splice(i, 1); }
      }
    }
  }

  updateWeapons(dt) {
    for (const w of this.weapons) {
      const def = WEAPONS[w.id];
      if (def.tick) def.tick(this, w, dt);
      if (!def.fire) continue;
      const s = this.scaled(w);
      w.cd -= dt;
      if (w.cd <= 0) {
        w.cd += s.cooldown;
        if (w.cd < 0) w.cd = s.cooldown;
        def.fire(this, w);
      }
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      stepProjectile(p, dt, this);

      if (p.pierce > 0 || p.hitCooldown > 0) {
        if (p.capsule) this.projectileCapsuleHits(p, dt);
        else this.projectileCircleHits(p, dt);
      }

      if (p.dead) { this.projectiles.splice(i, 1); }
    }
  }

  projectileCircleHits(p, dt) {
    const r = p.r;
    const r2 = r * r;
    this.grid.query(p.x, p.y, r + 40, (e) => {
      if (e.dead || p.dead) return;
      if (p.hits.has(e.id) && !p.hitCooldown) return;
      if (p.hitCooldown) {
        if (!p.reticks) p.reticks = new Map();
        const next = p.reticks.get(e.id) || 0;
        if (this.time < next) return;
      }
      const dx = e.x - p.x;
      const dy = (e.y - e.h * 0.45) - p.y;
      const rr = r + e.radius;
      if (dx * dx + dy * dy > rr * rr) return;

      // Sector weapons (the arc) only bite inside their wedge.
      if (p.sector) {
        // The visual crescent is offset from the player, but its blade begins
        // at the cast origin. Measuring from the crescent centre made nearby
        // enemies look behind the wedge and slip through the main attack.
        const sectorDx = e.x - (p.sector.originX ?? p.x);
        const sectorDy = (e.y - e.h * 0.45) - (p.sector.originY ?? p.y);
        const a = Math.atan2(sectorDy, sectorDx);
        let d = a - p.sector.angle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) > p.sector.spread) return;
      }

      p.hits.add(e.id);
      if (p.hitCooldown) p.reticks.set(e.id, this.time + p.hitCooldown);
      const dir = Math.atan2(dy, dx) || 0;
      this.damageEnemy(e, p.damage, dir, { knockback: p.knockback });
      if (p.drain && Math.random() < p.drain) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
      }
      if (p.onHit) p.onHit(this, p);
      if (!p.hitCooldown) {
        p.pierce--;
        if (p.pierce <= 0) p.dead = true;
      }
    });
  }

  /** Beam weapons: distance from a point to the segment. */
  projectileCapsuleHits(p) {
    const ax = p.x;
    const ay = p.y;
    const bx = p.x2;
    const by = p.y2;
    const dxs = bx - ax;
    const dys = by - ay;
    const len2 = dxs * dxs + dys * dys || 1;
    const midX = (ax + bx) / 2;
    const midY = (ay + by) / 2;
    const reach = Math.hypot(dxs, dys) / 2 + p.r + 60;

    this.grid.query(midX, midY, reach, (e) => {
      if (e.dead) return;
      if (!p.hits.has(e.id)) {
        const ex = e.x;
        const ey = e.y - e.h * 0.45;
        let t = ((ex - ax) * dxs + (ey - ay) * dys) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = ax + dxs * t;
        const py = ay + dys * t;
        const dx = ex - px;
        const dy = ey - py;
        const rr = p.r * 0.5 + e.radius;
        if (dx * dx + dy * dy > rr * rr) return;
        p.hits.add(e.id);
        this.damageEnemy(e, p.damage, Math.atan2(dys, dxs), { knockback: p.knockback });
      }
    });
  }

  updateEnemyShots(dt) {
    const p = this.player;
    for (let i = this.enemyShots.length - 1; i >= 0; i--) {
      const s = this.enemyShots[i];
      s.t += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.spin * dt;
      const dx = s.x - p.x;
      const dy = s.y - (p.y - p.h * 0.4);
      if (dx * dx + dy * dy < (s.r + p.radius) * (s.r + p.radius)) {
        this.hurtPlayer(s.damage, Math.atan2(dy, dx));
        s.dead = true;
      }
      if (s.t >= s.life || s.dead) this.enemyShots.splice(i, 1);
    }
  }

  updatePickups(dt) {
    this.trimPickups();
    const p = this.player;
    const magnetR = 155 * this.stats.magnet;
    const m2 = magnetR * magnetR;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const u = this.pickups[i];
      u.t += dt;
      if (!u.grounded) {
        u.x += u.vx * dt;
        u.y += u.vy * dt;
        u.vy += 620 * dt;
        u.vx *= 1 - 2 * dt;
        if (u.vy > 0 && u.t > 0.25) { u.grounded = true; u.vx = 0; u.vy = 0; }
      }
      const dx = p.x - u.x;
      const dy = (p.y - p.h * 0.3) - u.y;
      const d2 = dx * dx + dy * dy;
      if (u.magnet || d2 < m2) {
        u.magnet = true;
        const d = Math.sqrt(d2) || 1;
        const pull = 420 + (1 - Math.min(1, d / 400)) * 900;
        u.x += (dx / d) * pull * dt;
        u.y += (dy / d) * pull * dt;
      }
      if (d2 < 40 * 40) {
        this.collect(u);
        this.pickups.splice(i, 1);
      }
    }
  }

  collect(u) {
    switch (u.kind) {
      case "gem":
        this.gainXp(u.value);
        this.audio.gem();
        this.fx.motesBurst(u.x, u.y, 3, PAL.arcane, 120, { gravity: 0, life: 0.3 });
        break;
      case "coin":
        this.coins += Math.round(u.value * this.stats.luck);
        this.audio.coin();
        break;
      case "heart":
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + u.value);
        this.fx.damage(this.player.x, this.player.y - this.player.h, u.value, false);
        this.audio.gem();
        break;
      case "chest": {
        // An instant level in a weapon you already carry.
        const cands = this.weapons.filter((w) => {
          const d = WEAPONS[w.id];
          return !d.evolved && w.level < d.max;
        });
        if (cands.length) {
          const w = cands[(Math.random() * cands.length) | 0];
          w.level++;
          this.fx.showPanel("chest", { name: WEAPONS[w.id].name, level: w.level }, 1.8);
        } else {
          this.coins += 200;
        }
        this.recomputeStats();
        this.audio.levelUp();
        this.fx.screenFlash(0.4);
        break;
      }
      default: break;
    }
  }

  /* ------------------------------------------------------- */
  /* Render                                                  */
  /* ------------------------------------------------------- */

  render() {
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;

    g.setTransform(1, 0, 0, 1, 0, 0);
    if (!this.paperPattern) this.paperPattern = g.createPattern(paper(), "repeat");
    g.fillStyle = this.paperPattern;
    g.fillRect(0, 0, W, H);

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (this.phase === "boot") return;
    if (this.phase === "title") { this.renderTitle(g); return; }

    const p = this.player;
    const zoom = this.zoom;

    g.save();
    g.translate(this.w / 2 + this.fx.shakeX, this.h / 2 + this.fx.shakeY);
    g.scale(zoom, zoom);
    g.translate(-p.x, -p.y + this.h / (2 * zoom) - this.h / (2 * zoom));

    const view = {
      x: p.x - this.w / (2 * zoom), y: p.y - this.h / (2 * zoom),
      w: this.w / zoom, h: this.h / zoom,
    };

    drawGround(g, view);
    this.fx.drawGround(g);
    this.drawEntities(g);
    drawChains(g, this.projectiles);
    for (const pr of this.projectiles) drawProjectile(g, pr);
    this.drawEnemyShots(g);
    this.fx.drawWorld(g);
    this.fx.drawText(g, FONTS);
    g.restore();

    this.ash.draw(g, this.w, this.h);
    this.fx.drawOverlay(g, this.w, this.h, this.w / 2, this.h / 2);

    this.hud.draw(g, this.hudState());
    this.drawPageFrame(g);

    if (this.phase === "levelup") {
      this.hud.drawLevelUp(g, this.hudState(), this.choices, this.selected, this.levelAnim);
    }
    if (this.fx.panel) this.drawDramaPanel(g, this.fx.panel);
    if (this.phase === "paused") this.drawPause(g);
    if (this.phase === "dead") this.drawEnd(g, false);
    if (this.phase === "won") this.drawEnd(g, true);

    this.drawTouchStick(g);

    if (this.lastUiPhase !== this.phase) {
      this.lastUiPhase = this.phase;
      if (this.onUiState) this.onUiState(this.phase);
    }
    if (this.onActionState) this.onActionState(this.actionState(), this.phase);
  }

  /** One y-sorted pass over everything that stands on the ground. */
  drawEntities(g) {
    const list = this.drawList;
    list.length = 0;
    for (const e of this.enemies) if (!e.dead) list.push(e);
    for (const u of this.pickups) list.push(u);
    list.push(this.player);
    list.sort((a, b) => a.y - b.y);

    for (const ent of list) {
      if (ent === this.player) this.drawPlayer(g);
      else if (ent.def) this.drawEnemy(g, ent);
      else this.drawPickup(g, ent);
    }
  }

  shadow(g, x, y, rx) {
    g.beginPath();
    g.ellipse(x, y, rx, rx * 0.34, 0, 0, Math.PI * 2);
    fillToneDevice(g, 0.5, 3);
  }

  drawPlayer(g) {
    const p = this.player;
    const art = this.art.hero;
    const moving = p.moving;
    const special = p.specialT > 0 && art.slash?.length;
    const dodging = !special && p.dodgeT > 0 && art.run?.length;
    const slashing = !special && !dodging && p.slashT > 0 && art.slash?.length;
    const set = special || slashing ? art.slash : ((moving || dodging) ? art.run : art.idle);
    const rate = dodging ? 22 : ((moving || dodging) ? 11 : 3.4);
    const actionProgress = special
      ? 1 - (p.specialT / Math.max(0.001, p.specialDuration))
      : (slashing ? 1 - (p.slashT / Math.max(0.001, p.slashDuration)) : 0);
    const slashIndex = special || slashing
      ? Math.min(set.length - 1, Math.floor(actionProgress * set.length))
      : -1;
    const gaitIndex = moving || dodging ? gaitFrameIndex(p.animT, rate, set.length) : -1;
    const f = special || slashing
      ? set[slashIndex]
      : ((moving || dodging) ? set[gaitIndex] : frameAt(set, p.animT, rate));
    if (!f) return;

    // The echoes are full authored run poses—not translucent ovals—so the
    // action reads as a swordsman vanishing through sequential manga panels.
    if (art.run?.length && p.dodgeTrail?.length) {
      for (const echo of p.dodgeTrail) {
        const k = echo.t / echo.life;
        const echoIndex = gaitFrameIndex(echo.animT + echo.t * 1.8, 18, art.run.length);
        const ef = art.run[echoIndex];
        if (!ef) continue;
        g.save();
        g.translate(echo.x, echo.y);
        if (echo.facing < 0) g.scale(-1, 1);
        g.globalAlpha = Math.max(0, (1 - k) * 0.32);
        g.shadowColor = PAL.blood;
        g.shadowBlur = 12 * (1 - k);
        g.drawImage(ef.canvas, -ef.ox / 2, -ef.oy / 2, ef.canvas.width / 2, ef.canvas.height / 2);
        g.restore();
      }
    }

    this.shadow(g, p.x, p.y - 2, 26);

    g.save();
    g.translate(p.x, p.y);
    if (p.facing < 0) g.scale(-1, 1);
    const w = f.canvas.width / 2;
    const h = f.canvas.height / 2;
    const ox = -f.ox / 2;
    const oy = -f.oy / 2;
    if (special) {
      g.shadowColor = PAL.blood;
      g.shadowBlur = 18 + Math.sin(this.realTime * 34) * 6;
    }
    if (p.invuln > 0 && !dodging && !special && Math.floor(this.realTime * 22) % 2 === 0) {
      g.globalAlpha = 0.45;
    }
    g.drawImage(f.canvas, ox, oy, w, h);
    if (p.hurtFlash > 0) {
      const hurtSet = special || slashing ? art.hurtSlash : ((moving || dodging) ? art.hurtRun : art.hurtIdle);
      const hf = special || slashing
        ? hurtSet?.[slashIndex]
        : ((moving || dodging) ? hurtSet?.[gaitIndex] : frameAt(hurtSet, p.animT, rate));
      if (hf) {
        g.globalAlpha = Math.min(1, p.hurtFlash * 3);
        g.drawImage(hf, ox, oy, w, h);
      }
    }
    g.restore();
  }

  drawEnemy(g, e) {
    const rec = this.art.cast[e.def.sprite];
    if (!rec) return;
    const floating = e.def.locomotion === "float";
    const attacking = !floating && e.attackT > 0 && rec.attackFrames?.length;
    const set = attacking ? rec.attackFrames : rec.frames;
    const n = set.length;
    const attackElapsed = attacking
      ? 1 - e.attackT / Math.max(0.001, e.attackDuration || 0.36)
      : 0;
    const attackStart = attacking
      ? Math.max(0, Math.min(0.75, e.attackProgressStart || 0))
      : 0;
    const attackProgress = attacking
      ? attackStart + attackElapsed * (1 - attackStart)
      : 0;
    const idx = attacking
      ? Math.min(n - 1, Math.max(0, Math.floor(attackProgress * n)))
      : (floating ? 0 : gaitFrameIndex(e.animT, 8, n, e.seed));
    const f = set[idx];
    const bob = e.def.bob ? Math.sin(this.time * 3 + e.bobPhase) * e.def.bob : 0;

    if (!e.def.ghost) this.shadow(g, e.x, e.y - 2, e.radius * 0.95);

    g.save();
    g.translate(e.x, e.y + bob);
    if (e.flip) g.scale(-1, 1);
    const w = f.canvas.width / 2;
    const h = f.canvas.height / 2;
    const ox = -f.ox / 2;
    const oy = -f.oy / 2;
    if (e.def.ghost) g.globalAlpha = 0.82;
    if (e.hitFlash > 0) {
      const flash = attacking ? rec.attackFlashFrames?.[idx] : rec.flashFrames[idx];
      g.drawImage(flash || f.canvas, ox, oy, w, h);
    } else {
      g.drawImage(f.canvas, ox, oy, w, h);
    }
    g.restore();

    // Boss telegraph: the ground under the slam goes black.
    if (e.telegraph > 0) {
      const k = 1 - e.telegraph / 0.62;
      g.save();
      g.globalAlpha = 0.25 + k * 0.4;
      g.strokeStyle = PAL.ink;
      g.lineWidth = 8;
      roughCircle(g, e.x, e.y, e.def.slamRadius * (0.4 + k * 0.6), 3, 0.04);
      g.stroke();
      g.restore();
    }
  }

  drawPickup(g, u) {
    let img;
    let scale = 1;
    switch (u.kind) {
      case "gem": img = u.value > 4 ? ATLAS.gemBig : ATLAS.gem; break;
      case "coin": img = ATLAS.coin; break;
      case "heart": img = ATLAS.heart; break;
      case "chest": img = ATLAS.chest; scale = 1.15; break;
      default: img = ATLAS.gem;
    }
    const bob = Math.sin(this.time * 4 + u.bob) * 3;
    g.save();
    g.translate(u.x, u.y + bob);
    g.scale(scale, scale);
    g.drawImage(img, -img.width / 2, -img.height / 2);
    g.restore();
  }

  drawEnemyShots(g) {
    for (const s of this.enemyShots) {
      g.save();
      g.translate(s.x, s.y);
      g.rotate(s.rot);
      if (ATLAS.enemyShot) {
        const img = ATLAS.enemyShot;
        g.drawImage(img, -img.width / 2, -img.height / 2);
      } else {
        g.fillStyle = PAL.ink;
        starburst(g, 0, 0, 11, { points: 5, inner: 0.42, colour: PAL.ink });
        g.fillStyle = PAL.paperLit;
        g.beginPath();
        g.arc(0, 0, 3.4, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }

  /**
   * The page: a hatched vignette creeping in from the edges, then a
   * heavy inked border. The vignette is baked once per resize —
   * hatching several thousand strokes every frame would cost more
   * than the entire rest of the render.
   */
  bakeVignette() {
    const W = Math.ceil(this.w);
    const H = Math.ceil(this.h);
    const c = makeCanvas(W, H);
    const g = ctxOf(c);
    const inset = Math.min(W, H) * 0.16;
    // Four edge bands of feathered hatching, densest at the border.
    const band = (x, y, w, h, angle, gx, gy, seed) => {
      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();
      feather(g, {
        x, y, w, h, angle, gap: 5.5, weight: 1.0, seed, colour: PAL.ink,
        gx, gy, dash: 26,
        density: (t) => Math.pow(Math.max(0, 1 - t), 2.2) * 0.55,
      });
      g.restore();
    };
    band(0, 0, W, inset, 0.5, 0, 1, 11);              // top
    band(0, H - inset, W, inset, -0.5, 0, -1, 23);    // bottom
    band(0, 0, inset, H, -1.1, 1, 0, 37);             // left
    band(W - inset, 0, inset, H, 1.1, -1, 0, 51);     // right
    return c;
  }

  drawPageFrame(g) {
    if (this.vignette) {
      g.save();
      g.globalAlpha = 0.38;
      g.drawImage(this.vignette, 0, 0, this.w, this.h);
      g.restore();
    }
    const m = 7;
    g.save();
    panelFrame(g, m, m, this.w - m * 2, this.h - m * 2,
      { weight: 5, seed: 3, jitter: 2.4 });
    g.restore();
  }

  hudState() {
    const positions = [];
    const step = Math.max(1, Math.ceil(this.enemies.length / 140));
    for (let i = 0; i < this.enemies.length; i += step) {
      const e = this.enemies[i];
      positions.push([e.x, e.y, !!e.boss || !!e.def.elite]);
    }
    return {
      hp: this.player.hp, maxHp: this.player.maxHp,
      xp: this.player.xp, xpNeed: this.player.xpNeed, level: this.player.level,
      time: this.time, kills: this.kills, coins: this.coins,
      weapons: this.weapons, passives: this.passives,
      stats: this.stats, portrait: this.art.hero.portrait,
      showStats: this.showStats,
      actions: this.actionState(),
      enemyPositions: positions, px: this.player.x, py: this.player.y,
      boss: this.boss,
    };
  }

  /* ------------------------------------------------------- */
  /* Screens                                                 */
  /* ------------------------------------------------------- */

  /**
   * The title plate.
   *
   * Baked once at boot into a 16:9 canvas and then drawn to fit, so
   * the menu costs one blit a frame. Composition is a straight lift
   * of a chapter splash: converging lines, a black ground with a
   * torn edge, a crowd of silhouettes on it, one enormous yokai
   * looming at the back, and the hero small but dead centre.
   */
  bakeTitleArt() {
    const W = 1920;
    const H = 1080;
    const c = makeCanvas(W, H);
    const g = ctxOf(c);
    const focusX = W * 0.5;
    const focusY = H * 0.52;

    g.fillStyle = PAL.paperLit;
    g.fillRect(0, 0, W, H);

    // Converging lines.
    const rand = rng(4242);
    for (let i = 0; i < 240; i++) {
      const a = rand() * Math.PI * 2;
      const inner = 210 + rand() * rand() * 260;
      const outer = 900 + rand() * 900;
      brush(g, [
        [focusX + Math.cos(a) * inner, focusY + Math.sin(a) * inner],
        [focusX + Math.cos(a) * outer, focusY + Math.sin(a) * outer],
      ], { width: 0.8 + rand() * rand() * 7, taper: "start", jitter: 0.1, seed: i, colour: PAL.ink });
    }

    // Ground: a black mass with a torn upper edge.
    const horizon = H * 0.68;
    const edge = [];
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      edge.push([t * W, horizon + Math.sin(t * 9.3) * 16 + wobble(t * 7, 3) * 34]);
    }
    g.beginPath();
    g.moveTo(0, H);
    edge.forEach((q) => g.lineTo(q[0], q[1]));
    g.lineTo(W, H);
    g.closePath();
    g.fillStyle = PAL.ink;
    g.fill();

    return { canvas: c, focusX: focusX / W, focusY: focusY / H, horizon: horizon / H };
  }

  /** Silhouetted crowd + the looming boss, drawn once art exists. */
  bakeTitleCrowd() {
    const W = 1920;
    const H = 1080;
    const c = makeCanvas(W, H);
    const g = ctxOf(c);
    const horizon = H * 0.68;
    const rand = rng(99);

    // One enormous skeleton at the back, half swallowed by the page.
    const boss = this.art.cast.gashadokuro;
    if (boss) {
      const img = boss.inkFrames[0];
      const k = (H * 0.86) / (img.height / 2);
      const bw = (img.width / 2) * k;
      const bh = (img.height / 2) * k;
      g.globalAlpha = 0.92;
      g.drawImage(img, W * 0.76 - bw / 2, horizon + 40 - bh, bw, bh);
      g.globalAlpha = 1;
    }

    // A rank of lesser yokai along the horizon, all solid ink.
    const roster = ["gaki", "kamaitachi", "yurei", "tsukumo", "gaki", "kappa", "gaki", "onryo"];
    for (let i = 0; i < 26; i++) {
      const rec = this.art.cast[roster[i % roster.length]];
      if (!rec) continue;
      const img = rec.inkFrames[i % rec.inkFrames.length];
      const depth = rand();
      const k = (0.42 + depth * 0.5) * 1.5;
      const w = (img.width / 2) * k;
      const h = (img.height / 2) * k;
      const x = rand() * W;
      const y = horizon + 10 + depth * 120;
      g.save();
      g.globalAlpha = 0.85 + depth * 0.15;
      g.translate(x, y);
      if (rand() < 0.5) g.scale(-1, 1);
      g.drawImage(img, -w / 2, -h, w, h);
      g.restore();
    }

    // Foreground: paper-white grave markers and bones cut out of the
    // black ground, so the bottom third is not dead space.
    for (let i = 0; i < 16; i++) {
      const x = rand() * W;
      const y = horizon + 70 + rand() * (H - horizon - 90);
      const sc = 0.5 + (y - horizon) / (H - horizon) * 1.5;
      g.save();
      g.translate(x, y);
      g.rotate((rand() - 0.5) * 0.3);
      g.scale(sc, sc);
      if (rand() < 0.55) {
        brush(g, [[-14, 0], [-12, -46], [0, -56], [12, -46], [14, 0]],
          { width: 2.4, taper: "none", jitter: 0.2, seed: 700 + i, colour: "#2a2a31" });
      } else {
        for (let k = 0; k < 3; k++) {
          const a = rand() * Math.PI;
          brush(g, [[-Math.cos(a) * 16, -Math.sin(a) * 8], [Math.cos(a) * 16, Math.sin(a) * 8]],
            { width: 1.8, taper: "none", jitter: 0.2, seed: 720 + i * 4 + k, colour: "#2a2a31" });
        }
      }
      g.restore();
    }
    return c;
  }

  renderTitle(g) {
    const W = this.w;
    const H = this.h;
    const t = this.realTime;

    const plate = this.titleBg;
    const img = plate.canvas;
    const k = Math.max(W / img.width, H / img.height);
    const dx = (W - img.width * k) / 2;
    const dy = (H - img.height * k) / 2;
    g.drawImage(img, dx, dy, img.width * k, img.height * k);
    if (this.titleCrowd) {
      g.drawImage(this.titleCrowd, dx, dy, img.width * k, img.height * k);
    }

    const horizonY = dy + plate.horizon * img.height * k;

    // The hero, standing on the horizon, breathing. He is drawn in
    // full detail, which means his pale hatching would disappear
    // against the bright sky — so a torn ink backing goes down first.
    const f = frameAt(this.art.hero.idle, t, 3);
    if (f) {
      const s = Math.min(3.4, H / 320);
      const hh = (f.canvas.height / 2) * s;
      g.save();
      g.translate(W / 2, horizonY + 26);
      // A torn ink wash, not a splat: satellite droplets from splat()
      // land in the middle of the sky and read as printing faults.
      const bw = hh * 0.62;
      const back = [];
      for (let i = 0; i <= 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const rr = 1 + wobble(a * 3 + 2, 5) * 0.16;
        back.push([Math.cos(a) * bw * 0.62 * rr, -hh * 0.5 + Math.sin(a) * hh * 0.56 * rr]);
      }
      g.beginPath();
      back.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
      g.closePath();
      g.fillStyle = PAL.ink;
      g.fill();
      g.scale(s, s);
      g.drawImage(f.canvas, -f.ox / 2, -f.oy / 2, f.canvas.width / 2, f.canvas.height / 2);
      g.restore();
    }

    // One crimson cut across the whole plate.
    const slash = titleSlash || ATLAS.slash[0];
    g.save();
    g.globalAlpha = 0.95;
    g.translate(W * 0.46, H * 0.5);
    g.rotate(-0.28);
    const ss = Math.max(W, H) / 175;
    g.scale(ss, ss * 0.5);
    g.drawImage(slash, -slash.width / 2, -slash.height / 2);
    g.restore();

    this.ash.draw(g, W, H);

    // Lettering. Solid ink with a fat paper halo — an outlined title
    // on a white page is invisible.
    const ts = Math.min(1.5, W / 1000);
    inkText(g, "INKBLOOD", W / 2, H * 0.27, {
      font: FONTS.impact(118 * ts), halo: 26, outline: 0,
      colour: PAL.ink, align: "center",
    });
    inkText(g, "血 墨", W / 2, H * 0.375, {
      font: FONTS.jp(76 * ts), halo: 16, outline: 4,
      colour: PAL.blood, outlineColour: PAL.paperLit, align: "center",
    });
    inkText(g, "NIGHT PARADE OF ONE HUNDRED DEMONS", W / 2, H * 0.425, {
      font: FONTS.display(24 * ts), halo: 10, outline: 0,
      colour: PAL.ink, align: "center",
    });

    if (this.bestScore) {
      inkText(g, `BEST  ${this.bestScore.toLocaleString()}`, W / 2, H * 0.465, {
        font: FONTS.display(18 * ts), halo: 8, outline: 0, colour: PAL.blood, align: "center",
      });
    }

    if (this.posterMode) { this.drawPageFrame(g); return; }

    if (Math.floor(t * 1.6) % 2 === 0) {
      inkText(g, "PRESS ANY KEY  ·  TAP TO BEGIN", W / 2, H * 0.93, {
        font: FONTS.display(26 * ts), halo: 0, outline: 0, colour: PAL.paperLit, align: "center",
      });
    }
    inkText(g, "WASD / ARROWS  MOVE      SPACE / SHIFT  INK STEP      Q  BLOOD ECLIPSE      P  PAUSE", W / 2, H * 0.972, {
      font: FONTS.display(16 * ts), halo: 0, outline: 0, colour: "#c8c2b5", align: "center",
    });

    this.drawPageFrame(g);
  }

  drawDramaPanel(g, panel) {
    const W = this.w;
    const H = this.h;
    const k = panel.t / panel.life;
    const inK = Math.min(1, panel.t / 0.24);
    const outK = k > 0.78 ? 1 - (k - 0.78) / 0.22 : 1;
    const alpha = Math.min(inK, outK);
    if (alpha <= 0) return;

    g.save();
    g.globalAlpha = alpha;
    const bandH = H * 0.3;
    const y = H * 0.34;

    g.save();
    g.translate(0, y);
    g.rotate(-0.018);
    g.fillStyle = PAL.ink;
    g.fillRect(-40, 0, W + 80, bandH);
    // Focus lines inside the band.
    g.save();
    g.beginPath();
    g.rect(-40, 0, W + 80, bandH);
    g.clip();
    const fimg = ATLAS.focus[1];
    const size = W * 1.5;
    g.globalAlpha = alpha * 0.5;
    g.globalCompositeOperation = "destination-out";
    g.drawImage(fimg, W / 2 - size / 2, bandH / 2 - size / 2, size, size);
    g.restore();
    g.restore();

    const cy = y + bandH * 0.5;
    const p = panel.payload || {};
    const ts = Math.min(1.3, W / 1100);

    if (panel.kind === "boss") {
      // Show the thing itself, huge, half-out of the band. A name on
      // a black bar is a caption; the silhouette is the reveal.
      const rec = this.art.cast[p.sprite];
      if (rec) {
        const f = rec.frames[0];
        const target = bandH * 1.5;
        const k = target / (f.canvas.height / 2);
        const bw = (f.canvas.width / 2) * k;
        const bh = (f.canvas.height / 2) * k;
        g.save();
        g.beginPath();
        g.rect(-40, y - bandH * 0.55, W + 80, bandH * 1.6);
        g.clip();
        g.globalAlpha = alpha * 0.95;
        g.drawImage(rec.inkFrames[0], W * 0.22 - bw / 2 + 7, y + bandH * 0.98 - bh + 7, bw, bh);
        g.globalAlpha = alpha;
        g.drawImage(f.canvas, W * 0.22 - bw / 2, y + bandH * 0.98 - bh, bw, bh);
        g.restore();
      }
      drawInkSigil(g, p.sigil || "boss-skull", W / 2, cy - 29 * ts, 68 * ts, {
        colour: PAL.paperLit, accent: PAL.blood, paper: PAL.ink,
      });
      inkText(g, p.name.toUpperCase(), W / 2, cy + 34 * ts, {
        font: FONTS.display(40 * ts), halo: 0, outline: 0, colour: PAL.paperLit, align: "center",
      });
      inkText(g, p.title || "", W / 2, cy + 62 * ts, {
        font: FONTS.display(19 * ts), halo: 0, outline: 0, colour: "#c9c4b8", align: "center",
      });
    } else if (panel.kind === "kill") {
      drawInkSigil(g, "kill", W / 2, cy - 28 * ts, 68 * ts, {
        colour: PAL.paperLit, accent: PAL.blood, paper: PAL.ink,
      });
      inkText(g, "BOSS SLAIN", W / 2, cy + 29 * ts, {
        font: FONTS.display(36 * ts), halo: 0, outline: 0, colour: PAL.blood, align: "center",
      });
      inkText(g, `${p.name.toUpperCase()} FALLS`, W / 2, cy + 59 * ts, {
        font: FONTS.display(30 * ts), halo: 0, outline: 0, colour: PAL.paperLit, align: "center",
      });
    } else if (panel.kind === "evolve") {
      drawInkSigil(g, p.sigil || "slash", W / 2, cy - 29 * ts, 72 * ts, {
        colour: PAL.paperLit, accent: PAL.blood, paper: PAL.ink, evolved: true,
      });
      inkText(g, `${p.name.toUpperCase()}`, W / 2, cy + 42 * ts, {
        font: FONTS.display(34 * ts), halo: 0, outline: 0, colour: PAL.paperLit, align: "center",
      });
    } else if (panel.kind === "revive") {
      drawInkSigil(g, "revive", W / 2, cy - 24 * ts, 70 * ts, {
        colour: PAL.paperLit, accent: PAL.blood, paper: PAL.ink,
      });
      inkText(g, "RISE AGAIN", W / 2, cy + 43 * ts, {
        font: FONTS.display(36 * ts), halo: 0, outline: 0, colour: PAL.paperLit, align: "center",
      });
    } else if (panel.kind === "chest") {
      inkText(g, `${p.name.toUpperCase()}  →  LV ${p.level}`, W / 2, cy + 10 * ts, {
        font: FONTS.display(35 * ts), halo: 0, outline: 0, colour: PAL.paperLit, align: "center",
      });
    }
    g.restore();
  }

  drawPause(g) {
    const W = this.w;
    const H = this.h;
    g.save();
    g.globalAlpha = 0.82;
    g.fillStyle = PAL.paperLit;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    g.beginPath();
    g.rect(0, 0, W, H);
    fillToneDevice(g, 0.24, 4);
    g.restore();
    inkText(g, "PAUSED", W / 2, H / 2 - 10, {
      font: FONTS.display(68), halo: 7, outline: 2.6, colour: PAL.ink, align: "center",
    });
    drawInkSigil(g, "pause", W / 2, H / 2 - 92, 54, {
      colour: PAL.blood, accent: PAL.blood,
    });
    inkText(g, "P OR Ⅱ TO CONTINUE", W / 2, H / 2 + 82, {
      font: FONTS.display(21), halo: 3, outline: 1.2, colour: PAL.inkSoft, align: "center",
    });
  }

  drawEnd(g, won) {
    const W = this.w;
    const H = this.h;
    const k = Math.min(1, (this.deadFor || 0) / 0.8);
    g.save();
    g.globalAlpha = 0.9 * k;
    g.fillStyle = won ? PAL.paperLit : PAL.ink;
    g.fillRect(0, 0, W, H);
    g.restore();

    const ts = Math.min(1.3, W / 1100);
    const fg = won ? PAL.ink : PAL.paperLit;

    drawInkSigil(g, won ? "sunrise" : "defeat", W / 2, H * 0.36, 132 * ts, {
      colour: fg, accent: PAL.blood, paper: won ? PAL.paperLit : PAL.ink,
    });
    inkText(g, won ? "THE PARADE ENDS" : "YOU ARE ONE OF THEM NOW",
      W / 2, H * 0.48, {
        font: FONTS.display(43 * ts), halo: 0, outline: 0, colour: fg, align: "center",
      });

    const rows = [
      ["SURVIVED", `${Math.floor(this.time / 60)}:${String(Math.floor(this.time % 60)).padStart(2, "0")}`],
      ["SLAIN", `${this.kills}`],
      ["LEVEL", `${this.player.level}`],
      ["COIN", `${this.coins}`],
      ["SCORE", `${this.score()}`],
    ];
    rows.forEach((r, i) => {
      const y = H * 0.56 + i * 30 * ts;
      inkText(g, r[0], W / 2 - 16 * ts, y, {
        font: FONTS.display(21 * ts), halo: 0, outline: 0, colour: fg, align: "right",
      });
      inkText(g, r[1], W / 2 + 16 * ts, y, {
        font: FONTS.display(21 * ts), halo: 0, outline: 0,
        colour: i === 4 ? PAL.blood : fg, align: "left",
      });
    });

    if ((this.deadFor || 0) > 1.6 && Math.floor(this.realTime * 1.6) % 2 === 0) {
      inkText(g, "PRESS ANY KEY TO BEGIN AGAIN", W / 2, H * 0.9, {
        font: FONTS.display(24 * ts), halo: 0, outline: 0, colour: fg, align: "center",
      });
    }
  }

  drawTouchStick(g) {
    const info = this.input.stickInfo();
    if (!info) return;
    const rect = this.canvas.getBoundingClientRect();
    const ox = info.ox - rect.left;
    const oy = info.oy - rect.top;
    const nx = info.nx - rect.left;
    const ny = info.ny - rect.top;
    g.save();
    g.globalAlpha = 0.4;
    g.strokeStyle = PAL.ink;
    g.lineWidth = 3;
    roughCircle(g, ox, oy, 54, 3, 0.05);
    g.stroke();
    const dx = nx - ox;
    const dy = ny - oy;
    const d = Math.min(54, Math.hypot(dx, dy)) || 0;
    const a = Math.atan2(dy, dx);
    g.globalAlpha = 0.7;
    g.fillStyle = PAL.ink;
    roughCircle(g, ox + Math.cos(a) * d, oy + Math.sin(a) * d, 20, 7, 0.06);
    g.fill();
    g.restore();
  }

  onConfirm() {
    if (this.phase === "title") { this.audio.init(); this.audio.resume(); this.newRun(); }
    else if ((this.phase === "dead" || this.phase === "won") && (this.deadFor || 0) > 1.2) {
      this.deadFor = 0;
      this.newRun();
    }
  }

  /* ------------------------------------------------------- */
  /* Loop                                                    */
  /* ------------------------------------------------------- */

  start() {
    this.phase = "title";
    let last = performance.now();
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      let dt = (now - last) / 1000;
      last = now;
      // The first rAF timestamp can predate the performance.now()
      // captured just before the loop was scheduled, which yields a
      // negative dt, a negative accumulated time, and then negative
      // animation frame indices. Clamp both ends.
      if (!(dt > 0)) dt = 0;
      if (dt > 0.25) dt = 0.25;    // tab was backgrounded
      this.step(dt);
      this.render();

      this.fpsSamples.push(dt);
      if (this.fpsSamples.length > 40) this.fpsSamples.shift();
      const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
      this.fps = 1 / (avg || 0.016);
    };
    this.raf = requestAnimationFrame(loop);
  }
}
