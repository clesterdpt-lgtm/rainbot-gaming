/* ============================================================
   RIZZ-CRAFT — a Rainbot parody mining sandbox
   ------------------------------------------------------------
   2D Minecraft-style world made of pure brainrot. Mine blocks,
   craft tools at a Crafting Toilet, light Rizz Torches, and
   survive the night when the Skibidi Toilets crawl out of Ohio.

   Vanilla JS, single <canvas>, no assets — everything is drawn
   with canvas primitives. Debug hook: window.__RIZZ
   ============================================================ */
(() => {
  "use strict";

  const GAME_ID = "rizz-craft";
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // ---- World / view geometry ----
  const TILE = 32;
  const W = canvas.width;            // 832
  const H = canvas.height;           // 512
  const VIEW_W = W / TILE;           // 26 tiles
  const VIEW_H = H / TILE;           // 16 tiles
  const WORLD_W = 96;
  const WORLD_H = 64;

  // ============================================================
  // Block + item registry
  // ============================================================
  // Block codes 1..99 are placeable tiles, item codes 100+ are
  // inventory-only (gems, sticks, tools).
  const AIR = 0;
  const GRASS = 1, DIRT = 2, STONE = 3, BEDROCK = 4, LOG = 5, LEAVES = 6,
        PLANKS = 7, TABLE = 8, COAL_ORE = 9, RIZZ_ORE = 10, SIGMA_ORE = 11,
        TORCH = 12;
  const STICK = 100, COAL = 101, RIZZ = 102, SIGMA = 103;
  const PICK_WOOD = 110, PICK_STONE = 111, AXE_WOOD = 112,
        SWORD_WOOD = 113, SWORD_STONE = 114, SWORD_SIGMA = 115;

  // Every code has a definition. Blocks carry hardness/solidity,
  // tools carry combat + mining multipliers.
  const DEF = {};
  function def(code, d) { d.code = code; DEF[code] = d; }

  // --- tiles ---
  def(GRASS, { name: "Grass", kind: "block", solid: true, opaque: true,
    hardness: 0.5, best: "shovel", drop: DIRT, palette: ["#5fd35a", "#7a5a3a"] });
  def(DIRT, { name: "Dirt", kind: "block", solid: true, opaque: true,
    hardness: 0.5, best: "shovel", palette: ["#8a623c", "#6e4d2e"] });
  def(STONE, { name: "Ohio Stone", kind: "block", solid: true, opaque: true,
    hardness: 1.4, best: "pick", needTool: "pick", drop: STONE, palette: ["#8b8b9a", "#6d6d7d"] });
  def(BEDROCK, { name: "Bedrock", kind: "block", solid: true, opaque: true,
    hardness: Infinity, palette: ["#2a2a33", "#1a1a22"] });
  def(LOG, { name: "Skibidi Log", kind: "block", solid: true, opaque: true,
    hardness: 0.9, best: "axe", drop: LOG, palette: ["#7a5230", "#4f3620"] });
  def(LEAVES, { name: "Brainrot Leaves", kind: "block", solid: true, opaque: false,
    hardness: 0.25, drop: null, palette: ["#3fae46", "#2f8a36"] });
  def(PLANKS, { name: "Toilet Planks", kind: "block", solid: true, opaque: true,
    hardness: 0.6, best: "axe", drop: PLANKS, palette: ["#bd8b4f", "#9c7038"] });
  def(TABLE, { name: "Crafting Toilet", kind: "block", solid: true, opaque: true,
    hardness: 0.8, best: "axe", drop: TABLE, palette: ["#cfd6dd", "#9aa3ad"] });
  def(COAL_ORE, { name: "Gyatt Coal Ore", kind: "block", solid: true, opaque: true,
    hardness: 1.6, best: "pick", needTool: "pick", drop: COAL, palette: ["#7d7d8c", "#24242c"] });
  def(RIZZ_ORE, { name: "Rizz Ore", kind: "block", solid: true, opaque: true,
    hardness: 1.9, best: "pick", needTool: "pick", drop: RIZZ, palette: ["#7d7d8c", "#ffcf3a"] });
  def(SIGMA_ORE, { name: "Sigma Ore", kind: "block", solid: true, opaque: true,
    hardness: 2.6, best: "pick", needTool: "pick", needTier: 2, drop: SIGMA, palette: ["#7d7d8c", "#46e8ff"] });
  def(TORCH, { name: "Rizz Torch", kind: "block", solid: false, opaque: false,
    hardness: 0.05, drop: TORCH, light: 0.95, palette: ["#caa15a", "#ffcf3a"] });

  // --- items ---
  def(STICK, { name: "Ohio Stick", kind: "item" });
  def(COAL, { name: "Gyatt Coal", kind: "item" });
  def(RIZZ, { name: "Rizz Crystal", kind: "item" });
  def(SIGMA, { name: "Sigma Gem", kind: "item" });
  def(PICK_WOOD, { name: "Wood Pickaxe", kind: "item", stack: 1, tool: { type: "pick", tier: 1, mult: 3 } });
  def(PICK_STONE, { name: "Stone Pickaxe", kind: "item", stack: 1, tool: { type: "pick", tier: 2, mult: 5 } });
  def(AXE_WOOD, { name: "Wood Axe", kind: "item", stack: 1, tool: { type: "axe", tier: 1, mult: 3 } });
  def(SWORD_WOOD, { name: "Wood Sword", kind: "item", stack: 1, tool: { type: "sword", tier: 1, damage: 3 } });
  def(SWORD_STONE, { name: "Stone Sword", kind: "item", stack: 1, tool: { type: "sword", tier: 2, damage: 5 } });
  def(SWORD_SIGMA, { name: "Sigma Blade", kind: "item", stack: 1, tool: { type: "sword", tier: 3, damage: 10 } });

  const isPlaceable = (code) => code !== AIR && DEF[code] && DEF[code].kind === "block";
  const maxStack = (code) => (DEF[code] && DEF[code].stack) || 99;

  // ============================================================
  // Recipes
  // ============================================================
  const RECIPES = [
    { out: { code: PLANKS, n: 4 }, in: [[LOG, 1]], table: false },
    { out: { code: STICK, n: 4 }, in: [[PLANKS, 2]], table: false },
    { out: { code: TABLE, n: 1 }, in: [[PLANKS, 4]], table: false },
    { out: { code: TORCH, n: 4 }, in: [[COAL, 1], [STICK, 1]], table: false },
    { out: { code: PICK_WOOD, n: 1 }, in: [[PLANKS, 3], [STICK, 2]], table: true },
    { out: { code: AXE_WOOD, n: 1 }, in: [[PLANKS, 3], [STICK, 2]], table: true },
    { out: { code: SWORD_WOOD, n: 1 }, in: [[PLANKS, 2], [STICK, 1]], table: true },
    { out: { code: PICK_STONE, n: 1 }, in: [[STONE, 3], [STICK, 2]], table: true },
    { out: { code: SWORD_STONE, n: 1 }, in: [[STONE, 2], [STICK, 1]], table: true },
    { out: { code: SWORD_SIGMA, n: 1 }, in: [[SIGMA, 2], [STICK, 1]], table: true },
  ];

  // ============================================================
  // Game state
  // ============================================================
  const HOTBAR = 9;
  const PLAYER_W = 0.62, PLAYER_H = 1.82;
  const GRAVITY = 42, JUMP_V = 13.0, MOVE_V = 6.4, MAX_FALL = 26;
  const REACH = 4.6;          // tiles, mining/placing
  const MELEE = 2.6;          // tiles, attacking
  const MAX_HP = 20;
  const DAY_LEN = 95, NIGHT_LEN = 60;     // seconds
  const CYCLE = DAY_LEN + NIGHT_LEN;

  const state = {
    started: false,
    over: false,
    paused: false,
    crafting: false,
    world: new Int16Array(WORLD_W * WORLD_H),
    skyTop: new Int16Array(WORLD_W),     // y of highest opaque block per column
    lightMap: new Float32Array(WORLD_W * WORLD_H),  // torch light 0..1
    torches: new Set(),
    player: null,
    mobs: [],
    floats: [],            // floating pickup / damage text
    particles: [],
    hotbar: [],            // {code, n}
    selected: 0,
    time: 0.18,            // 0..1 within cycle; start mid-morning
    day: 1,
    nightsSurvived: 0,
    mined: 0,
    score: 0,
    high: 0,
    mode: "mine",          // touch action mode: mine | place
    placedTable: false,
    sigmaForged: false,
  };
  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 1 });
  let saveMenu = null;

  // input
  const keys = {};
  const mouse = { x: 0, y: 0, tx: 0, ty: 0, down: false, right: false };
  let miningTile = null;     // {x,y,progress,need}
  let attackCd = 0;
  let placeCd = 0;
  const touch = { left: false, right: false, jump: false };

  // ============================================================
  // Small helpers
  // ============================================================
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const idx = (x, y) => y * WORLD_W + x;
  const inBounds = (x, y) => x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H;
  function getTile(x, y) { return inBounds(x, y) ? state.world[idx(x, y)] : BEDROCK; }
  function isSolid(x, y) { const c = getTile(x, y); return DEF[c] && DEF[c].solid; }

  function rng(a, b) { return a + Math.random() * (b - a); }
  function chance(p) { return Math.random() < p; }

  // ============================================================
  // World generation
  // ============================================================
  function genWorld() {
    const w = state.world;
    w.fill(AIR);
    const base = 22;
    const surface = new Int16Array(WORLD_W);
    for (let x = 0; x < WORLD_W; x++) {
      const h = base
        + 4 * Math.sin(x * 0.13)
        + 2.4 * Math.sin(x * 0.052 + 1.7)
        + 1.6 * Math.sin(x * 0.31 + 0.5);
      surface[x] = clamp(Math.round(h), 10, WORLD_H - 12);
    }
    for (let x = 0; x < WORLD_W; x++) {
      const s = surface[x];
      for (let y = s; y < WORLD_H; y++) {
        let c = STONE;
        if (y === s) c = GRASS;
        else if (y < s + 4) c = DIRT;
        else if (y >= WORLD_H - 1) c = BEDROCK;
        else {
          // ores by depth
          c = STONE;
          const depth = y - s;
          if (depth > 4 && chance(0.045)) c = COAL_ORE;
          if (depth > 12 && chance(0.03)) c = RIZZ_ORE;
          if (depth > 26 && chance(0.014)) c = SIGMA_ORE;
        }
        w[idx(x, y)] = c;
      }
    }
    // simple caves: a few short, small worms carve pockets deep in the stone
    for (let i = 0; i < 16; i++) {
      let cx = (Math.random() * WORLD_W) | 0;
      let cy = (rng(34, WORLD_H - 6)) | 0;
      const len = (rng(4, 10)) | 0;
      let ang = rng(0, Math.PI * 2);
      for (let s = 0; s < len; s++) {
        const r = rng(0.8, 1.6);
        for (let oy = -2; oy <= 2; oy++)
          for (let ox = -2; ox <= 2; ox++) {
            if (ox * ox + oy * oy <= r * r) {
              const x = cx + ox, y = cy + oy;
              if (inBounds(x, y) && y < WORLD_H - 1 && getTile(x, y) !== BEDROCK)
                w[idx(x, y)] = AIR;
            }
          }
        ang += rng(-0.6, 0.6);
        cx = clamp(Math.round(cx + Math.cos(ang)), 1, WORLD_W - 2);
        cy = clamp(Math.round(cy + Math.sin(ang) * 0.7), 34, WORLD_H - 3);
      }
    }
    // trees on grassy, flat-ish columns
    for (let x = 3; x < WORLD_W - 3; x++) {
      const s = surface[x];
      const flat = Math.abs(surface[x - 1] - s) <= 1 && Math.abs(surface[x + 1] - s) <= 1;
      if (flat && getTile(x, s) === GRASS && chance(0.16)) {
        const th = (rng(4, 6)) | 0;
        for (let t = 1; t <= th; t++) w[idx(x, s - t)] = LOG;
        const topY = s - th;
        for (let ly = -2; ly <= 0; ly++)
          for (let lx = -2; lx <= 2; lx++) {
            const x2 = x + lx, y2 = topY + ly;
            if (Math.abs(lx) === 2 && ly === 0) continue;
            if (inBounds(x2, y2) && getTile(x2, y2) === AIR) w[idx(x2, y2)] = LEAVES;
          }
        w[idx(x, topY - 1)] = LEAVES;
        x += 2; // spacing
      }
    }
    rebuildSkyAll();
    return surface;
  }

  function rebuildSkyColumn(x) {
    let top = WORLD_H;
    for (let y = 0; y < WORLD_H; y++) {
      const c = state.world[idx(x, y)];
      if (DEF[c] && DEF[c].opaque) { top = y; break; }
    }
    state.skyTop[x] = top;
  }
  function rebuildSkyAll() { for (let x = 0; x < WORLD_W; x++) rebuildSkyColumn(x); }

  // ---- torch lighting (radial, recomputed on change) ----
  function rebuildLight() {
    const lm = state.lightMap;
    lm.fill(0);
    const R = 6;
    state.torches.forEach((i) => {
      const tx = i % WORLD_W, ty = (i / WORLD_W) | 0;
      for (let oy = -R; oy <= R; oy++)
        for (let ox = -R; ox <= R; ox++) {
          const x = tx + ox, y = ty + oy;
          if (!inBounds(x, y)) continue;
          const d = Math.sqrt(ox * ox + oy * oy);
          if (d > R) continue;
          const v = clamp(1 - d / R, 0, 1) * 0.95;
          const k = idx(x, y);
          if (v > lm[k]) lm[k] = v;
        }
    });
  }

  // ============================================================
  // Inventory
  // ============================================================
  function initHotbar() {
    state.hotbar = [];
    for (let i = 0; i < HOTBAR; i++) state.hotbar.push(null);
  }
  function giveItem(code, n = 1) {
    if (code == null || n <= 0) return;
    const cap = maxStack(code);
    // top up existing stacks
    for (const slot of state.hotbar) {
      if (slot && slot.code === code && slot.n < cap) {
        const add = Math.min(n, cap - slot.n);
        slot.n += add; n -= add;
        if (n <= 0) return;
      }
    }
    // new slots
    for (let i = 0; i < state.hotbar.length && n > 0; i++) {
      if (!state.hotbar[i]) {
        const add = Math.min(n, cap);
        state.hotbar[i] = { code, n: add }; n -= add;
      }
    }
  }
  function countItem(code) {
    let t = 0;
    for (const s of state.hotbar) if (s && s.code === code) t += s.n;
    return t;
  }
  function takeItem(code, n) {
    let need = n;
    for (const s of state.hotbar) {
      if (s && s.code === code) {
        const d = Math.min(need, s.n); s.n -= d; need -= d;
        if (s.n <= 0) { const i = state.hotbar.indexOf(s); state.hotbar[i] = null; }
        if (need <= 0) break;
      }
    }
  }
  function selectedSlot() { return state.hotbar[state.selected]; }
  function selectedTool() {
    const s = selectedSlot();
    return s && DEF[s.code] && DEF[s.code].tool ? DEF[s.code].tool : null;
  }

  // ============================================================
  // Player
  // ============================================================
  function spawnPlayer(surface) {
    const sx = WORLD_W >> 1;
    let sy = surface ? surface[sx] : 22;
    state.player = {
      x: sx + 0.2, y: sy - PLAYER_H - 0.05,
      vx: 0, vy: 0, onGround: false, face: 1,
      hp: MAX_HP, hurtCd: 0, regenCd: 0, swing: 0,
    };
  }

  function tilesUnderAABB(px, py, pw, ph) {
    const x0 = Math.floor(px), x1 = Math.floor(px + pw - 1e-6);
    const y0 = Math.floor(py), y1 = Math.floor(py + ph - 1e-6);
    return { x0, x1, y0, y1 };
  }

  function moveEntity(e, w, h, dt) {
    // X axis
    let nx = e.x + e.vx * dt;
    if (e.vx !== 0) {
      const dir = Math.sign(e.vx);
      const probeX = dir > 0 ? nx + w : nx;
      const { y0, y1 } = tilesUnderAABB(e.x, e.y, w, h);
      const tx = Math.floor(probeX);
      let hit = false;
      for (let y = y0; y <= y1; y++) if (isSolid(tx, y)) hit = true;
      if (hit) {
        nx = dir > 0 ? tx - w : tx + 1;
        e.vx = 0;
      }
    }
    e.x = clamp(nx, 0, WORLD_W - w);

    // Y axis
    let ny = e.y + e.vy * dt;
    e.onGround = false;
    if (e.vy !== 0) {
      const dir = Math.sign(e.vy);
      const probeY = dir > 0 ? ny + h : ny;
      const { x0, x1 } = tilesUnderAABB(e.x, e.y, w, h);
      const ty = Math.floor(probeY);
      let hit = false;
      for (let x = x0; x <= x1; x++) if (isSolid(x, ty)) hit = true;
      if (hit) {
        if (dir > 0) { ny = ty - h; e.onGround = true; }
        else { ny = ty + 1; }
        e.vy = 0;
      }
    }
    e.y = clamp(ny, 0, WORLD_H - h);
  }

  function updatePlayer(dt) {
    const p = state.player;
    const left = keys["a"] || keys["arrowleft"] || touch.left;
    const right = keys["d"] || keys["arrowright"] || touch.right;
    const jump = keys["w"] || keys[" "] || keys["arrowup"] || touch.jump;

    let move = (right ? 1 : 0) - (left ? 1 : 0);
    p.vx = move * MOVE_V;
    if (move !== 0) p.face = move;
    if (jump && p.onGround) { p.vy = -JUMP_V; p.onGround = false; }

    p.vy = clamp(p.vy + GRAVITY * dt, -JUMP_V, MAX_FALL);
    moveEntity(p, PLAYER_W, PLAYER_H, dt);

    if (p.swing > 0) p.swing -= dt;
    if (p.hurtCd > 0) p.hurtCd -= dt;
    // passive regen when not recently hurt
    if (p.hp < MAX_HP) {
      p.regenCd -= dt;
      if (p.hurtCd <= 0 && p.regenCd <= 0) { p.hp = Math.min(MAX_HP, p.hp + 1); p.regenCd = 2.2; }
    }
    // void / suffocation safety
    if (p.y > WORLD_H - 1) hurtPlayer(4, 0);
  }

  function hurtPlayer(dmg, knockDir) {
    const p = state.player;
    if (p.hurtCd > 0) return;
    p.hp -= dmg; p.hurtCd = 0.7; p.regenCd = 5;
    p.vy = -6; p.vx = knockDir * 6;
    addFloat(p.x, p.y, "-" + dmg, "#ff5a7a");
    shake = 6;
    if (p.hp <= 0) playerDie();
  }

  function playerDie() {
    addFloat(state.player.x, state.player.y, "FLUSHED 🚽", "#ff5a7a");
    RB.toast("You got flushed. Respawning…", "bad");
    // respawn at surface center, clear mobs, jump to morning
    const sx = WORLD_W >> 1;
    let sy = state.skyTop[sx]; if (sy >= WORLD_H) sy = 22;
    state.player.x = sx + 0.2;
    state.player.y = sy - PLAYER_H - 0.05;
    state.player.vx = state.player.vy = 0;
    state.player.hp = MAX_HP; state.player.hurtCd = 1.2;
    state.mobs.length = 0;
    state.time = 0.06; // dawn
  }

  // ============================================================
  // Mobs
  // ============================================================
  const MOB = {
    toilet: { name: "Skibidi Toilet", hp: 8, speed: 2.6, dmg: 3, w: 0.8, h: 0.9, score: 12 },
    grimace: { name: "Grimace Shake", hp: 16, speed: 1.7, dmg: 5, w: 0.95, h: 1.2, score: 24 },
  };

  function spawnMob() {
    const p = state.player;
    const day = state.day;
    const cap = Math.min(4 + day * 2, 16);
    if (state.mobs.length >= cap) return;
    // pick an x a bit away from the player, on a sky-exposed surface
    for (let tries = 0; tries < 12; tries++) {
      const off = (rng(9, 20)) | 0;
      const x = clamp(Math.round(p.x + (chance(0.5) ? off : -off)), 2, WORLD_W - 3);
      const sy = state.skyTop[x];
      if (sy >= WORLD_H - 2) continue;
      // must be dark there (no torch light)
      if (state.lightMap[idx(x, sy)] > 0.25) continue;
      const type = day >= 2 && chance(0.32) ? "grimace" : "toilet";
      const t = MOB[type];
      state.mobs.push({
        type, x: x + 0.1, y: sy - t.h - 0.05, vx: 0, vy: 0,
        onGround: false, hp: t.hp, hitCd: 0, face: 1, anim: Math.random() * 6,
      });
      return;
    }
  }

  function updateMobs(dt) {
    const p = state.player;
    for (let i = state.mobs.length - 1; i >= 0; i--) {
      const m = state.mobs[i];
      const t = MOB[m.type];
      m.anim += dt * 6;
      const dx = (p.x + PLAYER_W / 2) - (m.x + t.w / 2);
      const dir = Math.sign(dx) || 1;
      m.face = dir;
      m.vx = dir * t.speed;
      // jump if blocked horizontally and on ground
      if (m.onGround) {
        const ahead = Math.floor(m.x + (dir > 0 ? t.w + 0.1 : -0.1));
        const footY = Math.floor(m.y + t.h - 0.1);
        if (isSolid(ahead, footY) && !isSolid(ahead, footY - 1)) m.vy = -11;
      }
      m.vy = clamp(m.vy + GRAVITY * dt, -JUMP_V, MAX_FALL);
      moveEntity(m, t.w, t.h, dt);
      if (m.hitCd > 0) m.hitCd -= dt;

      // contact damage
      if (aabb(p.x, p.y, PLAYER_W, PLAYER_H, m.x, m.y, t.w, t.h)) {
        if (m.hitCd <= 0) { hurtPlayer(t.dmg, dir); m.hitCd = 0.9; }
      }
      // mobs burn off in daylight (morning)
      if (daylight() > 0.55 && state.skyTop[Math.floor(m.x)] >= Math.floor(m.y)) {
        m.hp -= dt * 6;
        if (chance(0.3)) addParticle(m.x + t.w / 2, m.y, "#caa15a");
      }
      if (m.hp <= 0) {
        addFloat(m.x, m.y, "+" + t.score, "#9be870");
        for (let s = 0; s < 6; s++) addParticle(m.x + t.w / 2, m.y + t.h / 2, m.type === "grimace" ? "#8b4fb0" : "#dfe6ec");
        addScore(t.score);
        state.mobs.splice(i, 1);
      }
    }
  }

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // ============================================================
  // Mining / placing / attacking
  // ============================================================
  function reachable(tx, ty) {
    const p = state.player;
    const cx = p.x + PLAYER_W / 2, cy = p.y + PLAYER_H / 2;
    const dx = (tx + 0.5) - cx, dy = (ty + 0.5) - cy;
    return dx * dx + dy * dy <= REACH * REACH;
  }

  function breakTimeFor(code) {
    const d = DEF[code];
    if (!d || d.hardness === Infinity) return Infinity;
    const tool = selectedTool();
    let time = d.hardness;
    if (d.best && tool && tool.type === d.best) time /= tool.mult;
    else time *= 1.4; // wrong / no tool penalty
    // can't usefully break if needs a tool we don't have a category for
    return Math.max(0.08, time);
  }

  function canDrop(code) {
    const d = DEF[code];
    if (!d.needTool) return true;
    const tool = selectedTool();
    if (!tool || tool.type !== d.needTool) return false;
    if (d.needTier && tool.tier < d.needTier) return false;
    return true;
  }

  function startMine(tx, ty) {
    const code = getTile(tx, ty);
    if (code === AIR || code === BEDROCK) { miningTile = null; return; }
    const need = breakTimeFor(code);
    if (!isFinite(need)) { miningTile = null; return; }
    if (!miningTile || miningTile.x !== tx || miningTile.y !== ty) {
      miningTile = { x: tx, y: ty, progress: 0, need };
    }
  }

  function finishMine() {
    const { x, y } = miningTile;
    const code = getTile(x, y);
    const d = DEF[code];
    setTile(x, y, AIR);
    state.mined++;
    addScore(1);
    // drops
    if (d.drop !== null && canDrop(code)) {
      const dropCode = d.drop !== undefined ? d.drop : code;
      giveItem(dropCode, 1);
      addFloat(x, y, "+1 " + DEF[dropCode].name, "#9be870");
    } else if (d.drop !== null && d.needTool) {
      addFloat(x, y, "needs " + d.needTool, "#ffb648");
    }
    for (let i = 0; i < 5; i++) addParticle(x + 0.5, y + 0.5, d.palette[0]);
    miningTile = null;
  }

  function setTile(x, y, code) {
    if (!inBounds(x, y)) return;
    const prev = state.world[idx(x, y)];
    state.world[idx(x, y)] = code;
    if (prev === TORCH) state.torches.delete(idx(x, y));
    if (code === TORCH) state.torches.add(idx(x, y));
    rebuildSkyColumn(x);
    if (prev === TORCH || code === TORCH || (DEF[prev] && DEF[prev].opaque) || (DEF[code] && DEF[code].opaque))
      rebuildLight();
  }

  function tryPlace(tx, ty) {
    if (placeCd > 0) return;
    if (!reachable(tx, ty)) return;
    if (getTile(tx, ty) !== AIR) return;
    const slot = selectedSlot();
    if (!slot || !isPlaceable(slot.code)) return;
    // don't place inside the player
    const p = state.player;
    if (DEF[slot.code].solid && aabb(p.x, p.y, PLAYER_W, PLAYER_H, tx, ty, 1, 1)) return;
    // require an adjacent solid/support (except torch needs solid neighbour)
    const support = isSolid(tx + 1, ty) || isSolid(tx - 1, ty) || isSolid(tx, ty + 1) || isSolid(tx, ty - 1);
    if (!support) return;
    setTile(tx, ty, slot.code);
    if (slot.code === TABLE) state.placedTable = true;
    slot.n--; if (slot.n <= 0) state.hotbar[state.selected] = null;
    placeCd = 0.16;
  }

  function tryAttack() {
    if (attackCd > 0) return;
    const p = state.player;
    const tool = selectedTool();
    const dmg = tool && tool.type === "sword" ? tool.damage : 1;
    let hit = null, best = MELEE * MELEE;
    for (const m of state.mobs) {
      const t = MOB[m.type];
      const mx = m.x + t.w / 2, my = m.y + t.h / 2;
      // must be near the cursor and within melee reach of player
      const cdx = mx - (mouse.tx + 0.5), cdy = my - (mouse.ty + 0.5);
      const pdx = mx - (p.x + PLAYER_W / 2), pdy = my - (p.y + PLAYER_H / 2);
      const pd = pdx * pdx + pdy * pdy;
      if (Math.abs(cdx) < 1.2 && Math.abs(cdy) < 1.2 && pd < best) { best = pd; hit = m; }
    }
    if (!hit) return false;
    const t = MOB[hit.type];
    hit.hp -= dmg; hit.vx = Math.sign(hit.x - p.x) * 7; hit.vy = -5;
    addFloat(hit.x, hit.y, "-" + dmg, "#ffd43b");
    p.swing = 0.18; attackCd = 0.36;
    return true;
  }

  // ============================================================
  // Crafting
  // ============================================================
  function nearTable() {
    const p = state.player;
    const px = Math.floor(p.x + PLAYER_W / 2), py = Math.floor(p.y + PLAYER_H / 2);
    for (let oy = -3; oy <= 3; oy++)
      for (let ox = -3; ox <= 3; ox++)
        if (getTile(px + ox, py + oy) === TABLE) return true;
    return false;
  }
  function canCraft(r) {
    if (r.table && !nearTable()) return false;
    return r.in.every(([c, n]) => countItem(c) >= n);
  }
  function doCraft(r) {
    if (!canCraft(r)) return false;
    r.in.forEach(([c, n]) => takeItem(c, n));
    giveItem(r.out.code, r.out.n);
    if (r.out.code === SWORD_SIGMA && !state.sigmaForged) {
      state.sigmaForged = true;
      addScore(500);
      RB.toast("🗡️ SIGMA BLADE FORGED — certified alpha", "good");
    }
    RB.toast("Crafted " + DEF[r.out.code].name, "good");
    renderCrafting();
    syncHud();
    return true;
  }

  // ============================================================
  // Floating text + particles
  // ============================================================
  function addFloat(x, y, text, color) {
    state.floats.push({ x, y, text, color, life: 1 });
    if (state.floats.length > 24) state.floats.shift();
  }
  function addParticle(x, y, color) {
    state.particles.push({ x, y, vx: rng(-3, 3), vy: rng(-6, -1), life: rng(0.3, 0.7), color });
    if (state.particles.length > 200) state.particles.shift();
  }
  function updateFx(dt) {
    for (let i = state.floats.length - 1; i >= 0; i--) {
      const f = state.floats[i]; f.y -= dt * 1.4; f.life -= dt * 0.9;
      if (f.life <= 0) state.floats.splice(i, 1);
    }
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pp = state.particles[i];
      pp.vy += GRAVITY * 0.4 * dt; pp.x += pp.vx * dt; pp.y += pp.vy * dt; pp.life -= dt;
      if (pp.life <= 0) state.particles.splice(i, 1);
    }
  }

  // ============================================================
  // Scoring / HUD
  // ============================================================
  function addScore(n) {
    state.score += n;
    if (state.score > state.high) {
      state.high = state.score;
      if (window.RB) RB.recordScore(GAME_ID, state.high);
    }
    syncHud();
  }
  function daylight() {
    // smooth curve: 1 at noon (t=0.25), 0 across the night
    const t = state.time;
    const raw = Math.cos((t - 0.25) * Math.PI * 2);
    return clamp(raw * 1.35 + 0.35, 0, 1);
  }
  const isNight = () => daylight() < 0.22;

  const hud = {
    hp: document.getElementById("hud-hp"),
    day: document.getElementById("hud-day"),
    mined: document.getElementById("hud-mined"),
    score: document.getElementById("hud-score"),
    high: document.getElementById("hud-high"),
  };
  function syncHud() {
    if (hud.hp) hud.hp.textContent = Math.max(0, Math.ceil(state.player ? state.player.hp : MAX_HP)) + "/" + MAX_HP;
    if (hud.day) hud.day.textContent = (isNight() ? "🌙 " : "☀️ ") + state.day;
    if (hud.mined) hud.mined.textContent = state.mined;
    if (hud.score) hud.score.textContent = state.score;
    if (hud.high) hud.high.textContent = state.high;
  }

  // ============================================================
  // Time
  // ============================================================
  function updateTime(dt) {
    const prev = state.time;
    state.time = (state.time + dt / CYCLE) % 1;
    // new day at sunrise wrap
    if (state.time < prev) {
      state.day++;
      state.nightsSurvived++;
      addScore(60);
      RB.toast("☀️ Survived the night! Day " + state.day, "good");
      state.mobs.length = 0;
    }
    // mob spawning at night
    if (isNight() && state.started && !state.over) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) { spawnMob(); spawnTimer = rng(1.4, 3.2); }
    }
  }
  let spawnTimer = 2;

  // ============================================================
  // Camera + rendering
  // ============================================================
  let camX = 0, camY = 0, shake = 0;
  function updateCamera() {
    const p = state.player;
    const tx = (p.x + PLAYER_W / 2) - VIEW_W / 2;
    const ty = (p.y + PLAYER_H / 2) - VIEW_H / 2;
    camX = clamp(tx, 0, WORLD_W - VIEW_W);
    camY = clamp(ty, 0, WORLD_H - VIEW_H);
  }

  function skyColors() {
    const d = daylight();
    // night -> day gradient endpoints
    const topNight = [10, 12, 30], topDay = [86, 170, 255];
    const botNight = [22, 20, 46], botDay = [180, 222, 255];
    const top = topNight.map((c, i) => Math.round(lerp(c, topDay[i], d)));
    const bot = botNight.map((c, i) => Math.round(lerp(c, botDay[i], d)));
    return {
      top: `rgb(${top[0]},${top[1]},${top[2]})`,
      bot: `rgb(${bot[0]},${bot[1]},${bot[2]})`,
      d,
    };
  }

  function drawSky() {
    const sc = skyColors();
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sc.top); g.addColorStop(1, sc.bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // stars at night
    if (sc.d < 0.5) {
      ctx.globalAlpha = (0.5 - sc.d) * 2;
      ctx.fillStyle = "#fff";
      for (let i = 0; i < 40; i++) {
        const sx = (i * 97) % W, sy = (i * 53) % (H * 0.6);
        ctx.fillRect(sx, sy, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    // sun / moon arc across the sky
    const t = state.time;
    const ang = (t - 0.25) * Math.PI * 2; // noon at top
    const ox = W / 2 + Math.sin((t) * Math.PI * 2) * (W * 0.42);
    const oy = H * 0.62 - Math.cos((t - 0.25) * Math.PI * 2) * (H * 0.5);
    if (sc.d > 0.18) {
      ctx.fillStyle = "#ffd84a"; ctx.beginPath(); ctx.arc(ox, oy, 26, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(ox, oy, 40, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#dfe6ec"; ctx.beginPath(); ctx.arc(W - ox, oy, 20, 0, Math.PI * 2); ctx.fill();
    }

    // parallax hills
    const hillShift = -camX * TILE * 0.25;
    ctx.fillStyle = `rgba(20,40,30,${0.35 + sc.d * 0.2})`;
    drawHills(hillShift, H * 0.72, 60, 70);
    ctx.fillStyle = `rgba(14,28,22,${0.45 + sc.d * 0.2})`;
    drawHills(hillShift * 1.6 + 120, H * 0.8, 90, 50);
  }
  function drawHills(shift, baseY, span, amp) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 10) {
      const y = baseY + Math.sin((x - shift) / span) * amp * 0.5 - amp * 0.5;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  }

  function drawBlock(code, sx, sy, tx, ty) {
    const d = DEF[code];
    const p = d.palette;
    switch (code) {
      case GRASS:
        ctx.fillStyle = p[1]; ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = p[0]; ctx.fillRect(sx, sy, TILE, 9);
        ctx.fillStyle = "#4cbf48"; ctx.fillRect(sx, sy + 7, TILE, 3);
        speckle(sx, sy + 10, "#6e4d2e", tx, ty); break;
      case DIRT:
        ctx.fillStyle = p[0]; ctx.fillRect(sx, sy, TILE, TILE);
        speckle(sx, sy, p[1], tx, ty); break;
      case STONE:
        ctx.fillStyle = p[0]; ctx.fillRect(sx, sy, TILE, TILE);
        speckle(sx, sy, p[1], tx, ty); break;
      case BEDROCK:
        ctx.fillStyle = p[0]; ctx.fillRect(sx, sy, TILE, TILE);
        speckle(sx, sy, p[1], tx, ty); break;
      case LOG:
        ctx.fillStyle = p[0]; ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = p[1]; ctx.fillRect(sx + 5, sy, 4, TILE); ctx.fillRect(sx + 21, sy, 4, TILE);
        ctx.fillStyle = "#6b4426"; ctx.fillRect(sx + 13, sy, 3, TILE); break;
      case LEAVES:
        ctx.fillStyle = p[1]; ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = p[0]; speckle(sx, sy, p[0], tx, ty); speckle(sx + 4, sy + 4, "#58c95f", tx + 1, ty); break;
      case PLANKS:
        ctx.fillStyle = p[0]; ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = p[1]; ctx.fillRect(sx, sy + 10, TILE, 2); ctx.fillRect(sx, sy + 21, TILE, 2);
        ctx.fillRect(sx + 15, sy, 2, 10); ctx.fillRect(sx + 9, sy + 12, 2, 9); break;
      case TABLE:
        ctx.fillStyle = "#9aa3ad"; ctx.fillRect(sx, sy, TILE, TILE);
        ctx.fillStyle = "#fff"; ctx.fillRect(sx + 4, sy + 4, TILE - 8, TILE - 10);
        ctx.fillStyle = "#05070d"; ctx.fillRect(sx + 9, sy + 9, 4, 4); ctx.fillRect(sx + 19, sy + 9, 4, 4);
        ctx.fillStyle = "#2ee0ff"; ctx.fillRect(sx + 6, sy + TILE - 6, TILE - 12, 3); break;
      case COAL_ORE:
      case RIZZ_ORE:
      case SIGMA_ORE:
        ctx.fillStyle = "#7d7d8c"; ctx.fillRect(sx, sy, TILE, TILE);
        speckle(sx, sy, "#6d6d7d", tx, ty);
        oreSpeckle(sx, sy, p[1], tx, ty, code === SIGMA_ORE);
        break;
      case TORCH:
        // drawn as entity-ish: stick + flame
        ctx.fillStyle = "#7a5230"; ctx.fillRect(sx + 13, sy + 12, 6, 18);
        const fl = 0.5 + Math.sin(performance.now() / 90 + tx) * 0.5;
        ctx.fillStyle = "#ff8a1e"; ctx.beginPath(); ctx.arc(sx + 16, sy + 10, 6 + fl, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffd43b"; ctx.beginPath(); ctx.arc(sx + 16, sy + 9, 3 + fl * 0.6, 0, Math.PI * 2); ctx.fill();
        break;
      default:
        ctx.fillStyle = p[0]; ctx.fillRect(sx, sy, TILE, TILE);
    }
    // subtle edge
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    if (code !== TORCH) ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
  }
  // deterministic speckle so blocks don't shimmer
  function speckle(sx, sy, color, tx, ty) {
    ctx.fillStyle = color;
    let s = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    for (let i = 0; i < 5; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const px = (s % (TILE - 6)) + 2;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const py = (s % (TILE - 6)) + 2;
      ctx.fillRect(sx + px, sy + py, 3, 3);
    }
  }
  function oreSpeckle(sx, sy, color, tx, ty, glow) {
    let s = ((tx * 12289) ^ (ty * 786433)) >>> 0;
    for (let i = 0; i < 4; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const px = (s % (TILE - 10)) + 4;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const py = (s % (TILE - 10)) + 4;
      if (glow) { ctx.fillStyle = color; ctx.globalAlpha = 0.4; ctx.fillRect(sx + px - 2, sy + py - 2, 8, 8); ctx.globalAlpha = 1; }
      ctx.fillStyle = color; ctx.fillRect(sx + px, sy + py, 5, 5);
    }
  }

  function worldToScreen(wx, wy) {
    return [(wx - camX) * TILE, (wy - camY) * TILE];
  }

  function drawWorld() {
    const x0 = Math.floor(camX), x1 = Math.min(WORLD_W - 1, Math.floor(camX + VIEW_W) + 1);
    const y0 = Math.floor(camY), y1 = Math.min(WORLD_H - 1, Math.floor(camY + VIEW_H) + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const code = state.world[idx(x, y)];
        if (code === AIR) continue;
        const sx = Math.round((x - camX) * TILE), sy = Math.round((y - camY) * TILE);
        drawBlock(code, sx, sy, x, y);
      }
    }
    // mining crack overlay
    if (miningTile && state.world[idx(miningTile.x, miningTile.y)] !== AIR) {
      const [sx, sy] = worldToScreen(miningTile.x, miningTile.y);
      const stage = Math.min(9, Math.floor((miningTile.progress / miningTile.need) * 10));
      ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 2;
      for (let i = 0; i <= stage; i++) {
        const o = i * 3;
        ctx.beginPath();
        ctx.moveTo(sx + 4 + o, sy + 4); ctx.lineTo(sx + 8 + o, sy + 14); ctx.lineTo(sx + 4 + o, sy + 26);
        ctx.stroke();
      }
    }
  }

  function drawDarkness() {
    const d = daylight();
    const x0 = Math.floor(camX), x1 = Math.min(WORLD_W - 1, Math.floor(camX + VIEW_W) + 1);
    const y0 = Math.floor(camY), y1 = Math.min(WORLD_H - 1, Math.floor(camY + VIEW_H) + 1);
    const MAXDARK = 0.86;
    const p = state.player;
    const pcx = p.x + PLAYER_W / 2, pcy = p.y + PLAYER_H / 2;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const skyExposed = y <= state.skyTop[x];
        let light = skyExposed ? d : 0.05;
        const tl = state.lightMap[idx(x, y)];
        if (tl > light) light = tl;
        // small glow around the player so caves stay navigable
        const dx = (x + 0.5) - pcx, dy = (y + 0.5) - pcy;
        const pd = Math.sqrt(dx * dx + dy * dy);
        if (pd < 4.5) light = Math.max(light, (1 - pd / 4.5) * 0.5);
        const dark = clamp(MAXDARK * (1 - light), 0, MAXDARK);
        if (dark <= 0.02) continue;
        ctx.fillStyle = `rgba(4,5,14,${dark.toFixed(3)})`;
        ctx.fillRect(Math.round((x - camX) * TILE), Math.round((y - camY) * TILE), TILE + 1, TILE + 1);
      }
    }
  }

  function drawPlayer() {
    const p = state.player;
    const [sx, sy] = worldToScreen(p.x, p.y);
    const w = PLAYER_W * TILE, h = PLAYER_H * TILE;
    ctx.save();
    if (p.hurtCd > 0.4) ctx.globalAlpha = 0.6;
    // body (hoodie)
    ctx.fillStyle = "#2ee0ff";
    roundRect(sx, sy + h * 0.36, w, h * 0.64, 4); ctx.fill();
    // legs
    ctx.fillStyle = "#19182d";
    ctx.fillRect(sx + 1, sy + h - 8, w / 2 - 1, 8);
    ctx.fillRect(sx + w / 2, sy + h - 8, w / 2 - 1, 8);
    // head
    ctx.fillStyle = "#f4c9a0";
    roundRect(sx - 1, sy, w + 2, h * 0.4, 5); ctx.fill();
    // hair
    ctx.fillStyle = "#3a2a1a"; ctx.fillRect(sx - 1, sy, w + 2, 6);
    // sigma shades
    ctx.fillStyle = "#05070d";
    ctx.fillRect(sx + (p.face > 0 ? 3 : 1), sy + 9, w - 4, 5);
    ctx.fillStyle = "#2ee0ff"; ctx.fillRect(sx + (p.face > 0 ? w - 9 : 4), sy + 10, 3, 3);
    // swing arm / tool
    if (p.swing > 0) {
      ctx.strokeStyle = "#f4c9a0"; ctx.lineWidth = 4; ctx.beginPath();
      ctx.moveTo(sx + w / 2, sy + h * 0.5);
      ctx.lineTo(sx + w / 2 + p.face * 16, sy + h * 0.35);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMobs() {
    for (const m of state.mobs) {
      const t = MOB[m.type];
      const [sx, sy] = worldToScreen(m.x, m.y);
      const w = t.w * TILE, h = t.h * TILE;
      const bob = Math.sin(m.anim) * 2;
      if (m.type === "toilet") {
        // bowl
        ctx.fillStyle = "#e9eef2";
        roundRect(sx, sy + h * 0.35 + bob, w, h * 0.65, 6); ctx.fill();
        // seat lid
        ctx.fillStyle = "#cfd6dd";
        roundRect(sx - 2, sy + h * 0.1 + bob, w + 4, h * 0.34, 6); ctx.fill();
        // face
        ctx.fillStyle = "#05070d";
        ctx.fillRect(sx + w * 0.22, sy + h * 0.45 + bob, 5, 6);
        ctx.fillRect(sx + w * 0.6, sy + h * 0.45 + bob, 5, 6);
        ctx.fillStyle = "#b5202f";
        ctx.fillRect(sx + w * 0.28, sy + h * 0.7 + bob, w * 0.4, 4);
      } else {
        // grimace blob
        ctx.fillStyle = "#7a3fa0";
        roundRect(sx, sy + bob, w, h, 10); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(sx + w * 0.32, sy + h * 0.42 + bob, 5, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(sx + w * 0.68, sy + h * 0.42 + bob, 5, 0, 7); ctx.fill();
        ctx.fillStyle = "#05070d";
        ctx.beginPath(); ctx.arc(sx + w * 0.32, sy + h * 0.42 + bob, 2, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(sx + w * 0.68, sy + h * 0.42 + bob, 2, 0, 7); ctx.fill();
        ctx.fillStyle = "#3a1a4a"; ctx.fillRect(sx + w * 0.3, sy + h * 0.66 + bob, w * 0.4, 5);
      }
      // hp pip
      if (m.hp < t.hp) {
        ctx.fillStyle = "#05070d"; ctx.fillRect(sx, sy - 7, w, 4);
        ctx.fillStyle = "#9be870"; ctx.fillRect(sx, sy - 7, w * (m.hp / t.hp), 4);
      }
    }
  }

  function drawFx() {
    for (const pp of state.particles) {
      const [sx, sy] = worldToScreen(pp.x, pp.y);
      ctx.globalAlpha = clamp(pp.life * 1.6, 0, 1);
      ctx.fillStyle = pp.color; ctx.fillRect(sx - 2, sy - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.font = "700 13px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    for (const f of state.floats) {
      const [sx, sy] = worldToScreen(f.x + 0.5, f.y);
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(f.text, sx + 1, sy + 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, sx, sy);
    }
    ctx.globalAlpha = 1; ctx.textAlign = "left";
  }

  function drawCursor() {
    if (!reachable(mouse.tx, mouse.ty)) return;
    const [sx, sy] = worldToScreen(mouse.tx, mouse.ty);
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
  }

  function drawHearts() {
    const p = state.player;
    const full = Math.floor(p.hp / 2), half = p.hp % 2;
    ctx.save();
    for (let i = 0; i < 10; i++) {
      const x = 12 + i * 17, y = 12;
      ctx.font = "15px sans-serif";
      ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillText("♥", x + 1, y + 13);
      if (i < full) ctx.fillStyle = "#ff3b6b";
      else if (i === full && half) ctx.fillStyle = "#ff8aa6";
      else ctx.fillStyle = "#3a3650";
      ctx.fillText("♥", x, y + 12);
    }
    ctx.restore();
  }

  // in-canvas hotbar
  let hotbarRects = [];
  function drawHotbar() {
    const slotSize = 40, gap = 4;
    const totalW = HOTBAR * slotSize + (HOTBAR - 1) * gap;
    const x0 = (W - totalW) / 2, y0 = H - slotSize - 10;
    hotbarRects = [];
    for (let i = 0; i < HOTBAR; i++) {
      const x = x0 + i * (slotSize + gap);
      hotbarRects.push({ x, y: y0, w: slotSize, h: slotSize, i });
      ctx.fillStyle = "rgba(8,8,16,0.78)";
      roundRect(x, y0, slotSize, slotSize, 6); ctx.fill();
      ctx.strokeStyle = i === state.selected ? "#ffd43b" : "rgba(255,255,255,0.18)";
      ctx.lineWidth = i === state.selected ? 3 : 1.5;
      roundRect(x, y0, slotSize, slotSize, 6); ctx.stroke();
      const slot = state.hotbar[i];
      if (slot) {
        drawItemIcon(slot.code, x + 6, y0 + 6, slotSize - 12);
        if (slot.n > 1) {
          ctx.font = "700 12px 'JetBrains Mono', monospace"; ctx.textAlign = "right";
          ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillText(slot.n, x + slotSize - 3, y0 + slotSize - 3);
          ctx.fillStyle = "#fff"; ctx.fillText(slot.n, x + slotSize - 4, y0 + slotSize - 4);
          ctx.textAlign = "left";
        }
      }
      // hotkey number
      ctx.font = "9px 'JetBrains Mono', monospace"; ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText(i + 1, x + 3, y0 + 11);
    }
  }

  function drawItemIcon(code, x, y, size) {
    const d = DEF[code];
    ctx.save();
    if (d.kind === "block") {
      // mini block render
      const p = d.palette;
      ctx.fillStyle = p[0]; roundRect(x, y, size, size, 3); ctx.fill();
      if (code === GRASS) { ctx.fillStyle = "#5fd35a"; ctx.fillRect(x, y, size, size * 0.32); ctx.fillStyle = "#7a5a3a"; ctx.fillRect(x, y + size * 0.32, size, size * 0.68); }
      else if (code === LOG) { ctx.fillStyle = p[1]; ctx.fillRect(x + size * 0.3, y, size * 0.18, size); ctx.fillRect(x + size * 0.62, y, size * 0.18, size); }
      else if (code === TORCH) { ctx.fillStyle = "#7a5230"; ctx.fillRect(x + size * 0.4, y + size * 0.35, size * 0.2, size * 0.6); ctx.fillStyle = "#ffd43b"; ctx.beginPath(); ctx.arc(x + size * 0.5, y + size * 0.28, size * 0.22, 0, 7); ctx.fill(); }
      else if (code === COAL_ORE || code === RIZZ_ORE || code === SIGMA_ORE) { ctx.fillStyle = p[1]; ctx.fillRect(x + size * 0.25, y + size * 0.25, size * 0.22, size * 0.22); ctx.fillRect(x + size * 0.55, y + size * 0.5, size * 0.2, size * 0.2); }
      else if (code === TABLE) { ctx.fillStyle = "#fff"; ctx.fillRect(x + size * 0.2, y + size * 0.2, size * 0.6, size * 0.5); ctx.fillStyle = "#05070d"; ctx.fillRect(x + size * 0.32, y + size * 0.34, size * 0.1, size * 0.1); ctx.fillRect(x + size * 0.56, y + size * 0.34, size * 0.1, size * 0.1); }
    } else {
      // items
      drawNonBlockIcon(code, x, y, size);
    }
    ctx.restore();
  }
  function drawNonBlockIcon(code, x, y, size) {
    const cx = x + size / 2, cy = y + size / 2;
    if (code === STICK) {
      ctx.strokeStyle = "#7a5230"; ctx.lineWidth = Math.max(3, size * 0.16);
      ctx.beginPath(); ctx.moveTo(x + size * 0.3, y + size * 0.85); ctx.lineTo(x + size * 0.7, y + size * 0.15); ctx.stroke();
    } else if (code === COAL || code === RIZZ || code === SIGMA) {
      ctx.fillStyle = code === COAL ? "#2a2a33" : code === RIZZ ? "#ffcf3a" : "#46e8ff";
      ctx.beginPath(); ctx.moveTo(cx, y + 2); ctx.lineTo(x + size - 2, cy); ctx.lineTo(cx, y + size - 2); ctx.lineTo(x + 2, cy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1; ctx.stroke();
    } else if (DEF[code].tool) {
      const tool = DEF[code].tool;
      const handle = "#7a5230";
      const headColor = tool.tier >= 3 ? "#46e8ff" : tool.tier >= 2 ? "#9aa3ad" : "#bd8b4f";
      // handle
      ctx.strokeStyle = handle; ctx.lineWidth = Math.max(3, size * 0.14);
      ctx.beginPath(); ctx.moveTo(x + size * 0.32, y + size * 0.88); ctx.lineTo(x + size * 0.62, y + size * 0.38); ctx.stroke();
      ctx.fillStyle = headColor;
      if (tool.type === "pick") {
        ctx.lineWidth = Math.max(3, size * 0.12); ctx.strokeStyle = headColor;
        ctx.beginPath(); ctx.moveTo(x + size * 0.32, y + size * 0.28); ctx.quadraticCurveTo(x + size * 0.62, y + size * 0.12, x + size * 0.9, y + size * 0.3); ctx.stroke();
      } else if (tool.type === "axe") {
        ctx.beginPath(); ctx.moveTo(x + size * 0.55, y + size * 0.2); ctx.quadraticCurveTo(x + size * 0.92, y + size * 0.28, x + size * 0.7, y + size * 0.5); ctx.closePath(); ctx.fill();
      } else { // sword
        ctx.beginPath(); ctx.moveTo(x + size * 0.6, y + size * 0.42); ctx.lineTo(x + size * 0.88, y + size * 0.1); ctx.lineTo(x + size * 0.78, y + size * 0.34); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#ffd43b"; ctx.lineWidth = Math.max(2, size * 0.08);
        ctx.beginPath(); ctx.moveTo(x + size * 0.46, y + size * 0.5); ctx.lineTo(x + size * 0.66, y + size * 0.3); ctx.stroke();
      }
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render() {
    ctx.save();
    if (shake > 0) { ctx.translate(rng(-shake, shake), rng(-shake, shake)); shake -= 0.6; if (shake < 0) shake = 0; }
    drawSky();
    drawWorld();
    drawMobs();
    drawPlayer();
    drawFx();
    drawDarkness();
    drawCursor();
    ctx.restore();
    // UI (no shake)
    drawHearts();
    drawHotbar();
    if (nearTable()) {
      ctx.font = "700 12px 'JetBrains Mono', monospace"; ctx.fillStyle = "#2ee0ff";
      ctx.textAlign = "center"; ctx.fillText("Crafting Toilet ready — press E", W / 2, H - 64); ctx.textAlign = "left";
    }
  }

  // ============================================================
  // Main loop
  // ============================================================
  let last = 0, raf = 0;
  function frame(ts) {
    raf = requestAnimationFrame(frame);
    if (!last) last = ts;
    let dt = (ts - last) / 1000; last = ts;
    dt = Math.min(dt, 1 / 30);
    if (state.started && !state.paused && !state.over && !state.crafting) {
      step(dt);
    }
    render();
  }

  function step(dt) {
    updateTime(dt);
    updatePlayer(dt);
    updateMobs(dt);
    updateFx(dt);
    if (attackCd > 0) attackCd -= dt;
    if (placeCd > 0) placeCd -= dt;

    // continuous mining / placing / attacking while held
    updateCursorTile();
    if (mouse.down) {
      if (!tryAttack()) {
        if (reachable(mouse.tx, mouse.ty) && getTile(mouse.tx, mouse.ty) !== AIR) {
          startMine(mouse.tx, mouse.ty);
          if (miningTile) {
            miningTile.progress += dt;
            if (miningTile.progress >= miningTile.need) finishMine();
          }
        } else miningTile = null;
      }
    } else miningTile = null;
    if (mouse.right) tryPlace(mouse.tx, mouse.ty);

    updateCamera();
    syncHud();
  }

  function updateCursorTile() {
    const wx = camX + mouse.x / TILE, wy = camY + mouse.y / TILE;
    mouse.tx = Math.floor(wx); mouse.ty = Math.floor(wy);
  }

  // ============================================================
  // Input wiring
  // ============================================================
  function onKey(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return; // don't hijack the nav search
    const k = e.key.toLowerCase();
    keys[k] = down;
    if (!down) return;
    if (k >= "1" && k <= "9") { state.selected = parseInt(k, 10) - 1; }
    if (k === "e") toggleCrafting();
    if (k === "p") togglePause();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  }
  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: cx * (W / r.width), y: cy * (H / r.height) };
  }

  function hotbarHit(x, y) {
    for (const r of hotbarRects) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.i;
    return -1;
  }

  canvas.addEventListener("mousemove", (e) => { const p = canvasPos(e); mouse.x = p.x; mouse.y = p.y; });
  canvas.addEventListener("mousedown", (e) => {
    canvas.focus();
    const p = canvasPos(e); mouse.x = p.x; mouse.y = p.y;
    const hb = hotbarHit(p.x, p.y);
    if (hb >= 0) { state.selected = hb; return; }
    if (e.button === 2) mouse.right = true;
    else mouse.down = true;
    updateCursorTile();
    if (mouse.right) tryPlace(mouse.tx, mouse.ty);
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 2) mouse.right = false; else mouse.down = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.selected = (state.selected + (e.deltaY > 0 ? 1 : -1) + HOTBAR) % HOTBAR;
  }, { passive: false });

  // touch
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const p = canvasPos(e); mouse.x = p.x; mouse.y = p.y;
    const hb = hotbarHit(p.x, p.y);
    if (hb >= 0) { state.selected = hb; return; }
    updateCursorTile();
    if (state.mode === "place") mouse.right = true; else mouse.down = true;
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault(); const p = canvasPos(e); mouse.x = p.x; mouse.y = p.y;
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => { e.preventDefault(); mouse.down = false; mouse.right = false; }, { passive: false });

  // ============================================================
  // Crafting UI (DOM)
  // ============================================================
  const overlay = document.getElementById("overlay");
  const craftPanel = document.getElementById("craft-panel");
  const craftList = document.getElementById("craft-list");

  function toggleCrafting() {
    if (!state.started || state.over) return;
    state.crafting = !state.crafting;
    if (craftPanel) craftPanel.classList.toggle("is-open", state.crafting);
    if (state.crafting) renderCrafting();
  }
  window.__rizzToggleCraft = toggleCrafting;

  function renderCrafting() {
    if (!craftList) return;
    const near = nearTable();
    craftList.innerHTML = RECIPES.map((r, i) => {
      const ok = canCraft(r);
      const needs = r.in.map(([c, n]) => {
        const have = countItem(c);
        return `<span class="craft-need ${have >= n ? "ok" : "no"}">${DEF[c].name} ${have}/${n}</span>`;
      }).join("");
      const lock = r.table && !near ? `<span class="craft-lock">needs Crafting Toilet</span>` : "";
      return `<button class="craft-recipe ${ok ? "" : "is-locked"}" data-recipe="${i}" ${ok ? "" : "disabled"}>
        <span class="craft-out"><b>${DEF[r.out.code].name}</b>${r.out.n > 1 ? " ×" + r.out.n : ""}</span>
        <span class="craft-ins">${needs}${lock}</span>
      </button>`;
    }).join("");
    craftList.querySelectorAll("[data-recipe]").forEach((b) => {
      b.addEventListener("click", () => doCraft(RECIPES[parseInt(b.dataset.recipe, 10)]));
    });
  }

  // ============================================================
  // Pause / start / restart
  // ============================================================
  function togglePause() {
    if (!state.started || state.over) return;
    state.paused = !state.paused;
    if (overlay) {
      if (state.paused) {
        overlay.classList.add("overlay--show");
        document.getElementById("overlay-title").textContent = "⏸ Paused";
        document.getElementById("overlay-sub").innerHTML = "Touch grass. Or don't.<br>Press <b>P</b> or the button to resume.";
        document.getElementById("overlay-score").innerHTML = "";
        document.getElementById("btn-primary").textContent = "Resume";
      } else overlay.classList.remove("overlay--show");
    }
  }

  function startGame() {
    if (state.started) return;
    if (saveSlot) saveSlot.clear();
    state.started = true; state.paused = false; state.over = false;
    if (overlay) overlay.classList.remove("overlay--show");
    canvas.focus();
  }

  function restart() {
    if (saveSlot) saveSlot.clear();
    cancelAnimationFrame(raf); raf = 0; last = 0;
    initGame();
    state.started = true;
    if (overlay) overlay.classList.remove("overlay--show");
    raf = requestAnimationFrame(frame);
  }

  function initGame() {
    state.started = false; state.over = false; state.paused = false; state.crafting = false;
    state.mobs = []; state.floats = []; state.particles = [];
    state.torches = new Set();
    state.time = 0.18; state.day = 1; state.nightsSurvived = 0;
    state.mined = 0; state.score = 0; state.selected = 0;
    state.placedTable = false; state.sigmaForged = false;
    state.high = window.RB ? RB.getHighScore(GAME_ID) : 0;
    if (craftPanel) craftPanel.classList.remove("is-open");
    initHotbar();
    const surface = genWorld();
    spawnPlayer(surface);
    // starter kit so the loop is reachable in the first day
    giveItem(PICK_WOOD, 1);
    giveItem(SWORD_WOOD, 1);
    giveItem(TORCH, 6);
    rebuildLight();
    updateCamera();
    syncHud();
  }

  function snapshot() {
    return {
      started: state.started,
      over: state.over,
      paused: state.paused,
      crafting: state.crafting,
      world: Array.from(state.world),
      torches: Array.from(state.torches),
      player: state.player ? { ...state.player } : null,
      mobs: state.mobs.map((mob) => ({ ...mob })),
      floats: state.floats.slice(0, 50),
      particles: state.particles.slice(0, 100),
      hotbar: state.hotbar.map((item) => (item ? { ...item } : item)),
      selected: state.selected,
      time: state.time,
      day: state.day,
      nightsSurvived: state.nightsSurvived,
      mined: state.mined,
      score: state.score,
      mode: state.mode,
      placedTable: state.placedTable,
      sigmaForged: state.sigmaForged,
    };
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    if (!data || !Array.isArray(data.world) || data.world.length !== state.world.length) return;
    state.world.set(data.world);
    state.torches = new Set(Array.isArray(data.torches) ? data.torches : []);
    state.player = data.player ? { ...data.player } : state.player;
    state.mobs = Array.isArray(data.mobs) ? data.mobs.map((mob) => ({ ...mob })) : [];
    state.floats = Array.isArray(data.floats) ? data.floats : [];
    state.particles = Array.isArray(data.particles) ? data.particles : [];
    state.hotbar = Array.isArray(data.hotbar) ? data.hotbar.map((item) => (item ? { ...item } : item)) : state.hotbar;
    state.selected = Number(data.selected) || 0;
    state.time = Number(data.time) || 0.18;
    state.day = Number(data.day) || 1;
    state.nightsSurvived = Number(data.nightsSurvived) || 0;
    state.mined = Number(data.mined) || 0;
    state.score = Number(data.score) || 0;
    state.mode = data.mode === "place" ? "place" : "mine";
    state.placedTable = Boolean(data.placedTable);
    state.sigmaForged = Boolean(data.sigmaForged);
    state.started = true;
    state.over = false;
    state.paused = false;
    state.crafting = false;
    rebuildSkyAll();
    rebuildLight();
    updateCamera();
    updateModeButtons();
    syncHud();
    if (craftPanel) craftPanel.classList.remove("is-open");
    if (overlay) overlay.classList.remove("overlay--show");
    canvas.focus();
  }

  // ============================================================
  // Buttons
  // ============================================================
  const btnPrimary = document.getElementById("btn-primary");
  if (btnPrimary) btnPrimary.addEventListener("click", () => {
    if (state.paused) { togglePause(); return; }
    if (!state.started) startGame();
  });
  bind("btn-pause", togglePause);
  bind("btn-restart", restart);
  bind("btn-craft", toggleCrafting);
  bind("btn-craft-close", toggleCrafting);
  bind("btn-left", null, "left");
  bind("btn-right", null, "right");
  bind("btn-jump", null, "jump");
  bind("btn-mine", () => { state.mode = "mine"; updateModeButtons(); });
  bind("btn-place", () => { state.mode = "place"; updateModeButtons(); });

  function updateModeButtons() {
    const m = document.getElementById("btn-mine"), pl = document.getElementById("btn-place");
    if (m) m.classList.toggle("is-active", state.mode === "mine");
    if (pl) pl.classList.toggle("is-active", state.mode === "place");
  }

  function bind(id, fn, holdKey) {
    const el = document.getElementById(id);
    if (!el) return;
    if (holdKey) {
      const on = (e) => { e.preventDefault(); touch[holdKey] = true; };
      const off = (e) => { e.preventDefault(); touch[holdKey] = false; };
      el.addEventListener("touchstart", on, { passive: false });
      el.addEventListener("touchend", off, { passive: false });
      el.addEventListener("mousedown", on);
      el.addEventListener("mouseup", off);
      el.addEventListener("mouseleave", off);
    } else if (fn) {
      el.addEventListener("click", fn);
    }
  }

  // ad-boost buttons
  bind("btn-heal", async () => {
    if (!state.started) return RB.toast("Start the game first", "");
    const ok = RB.isAdFree() || await RB.showRewarded();
    if (ok) { state.player.hp = MAX_HP; giveItem(TORCH, 16); syncHud(); RB.toast("Full heal + 16 torches", "good"); }
  });
  bind("btn-kit", async () => {
    if (!state.started) return RB.toast("Start the game first", "");
    const ok = RB.isAdFree() || await RB.showRewarded();
    if (ok) { giveItem(PICK_STONE, 1); giveItem(SWORD_STONE, 1); giveItem(TABLE, 1); RB.toast("Sigma starter kit dropped", "good"); }
  });

  // ============================================================
  // Boot
  // ============================================================
  initGame();
  updateModeButtons();
  raf = requestAnimationFrame(frame);
  if (saveSlot) {
    saveMenu = saveSlot.attachButtons({
      primary: btnPrimary,
      scoreEl: document.getElementById("overlay-score"),
      continueLabel: "Continue world",
      newLabel: "New world",
      onContinue: restoreGame,
      summary: (saved) => {
        const data = saved.data || {};
        return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Day <strong>${Number(data.day || 1)}</strong> · Score <strong>${Number(data.score || 0).toLocaleString()}</strong>`;
      },
    });
    saveSlot.startAutosave(snapshot, () => state.started && !state.over);
  }

  // Debug hook (convention: window.__RIZZ)
  window.__RIZZ = {
    state, DEF, RECIPES, startGame, restart, giveItem, spawnMob,
    setTime: (t) => { state.time = t; },
    setTile, genWorld, daylight, isNight,
    get player() { return state.player; },
    teleportSurface() { const x = WORLD_W >> 1; state.player.x = x; state.player.y = state.skyTop[x] - PLAYER_H; },
  };
})();
