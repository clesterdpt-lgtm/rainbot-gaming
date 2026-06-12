/* ============================================
   SKIBIDI TOILET TOWER DEFENSE
   --------------------------------------------
   Static canvas tower defense for Rainbot Gaming.
   Build towers on fixed pads, hold 10 waves, and
   use the existing RB rewarded-ad hooks for boosts.
   ============================================ */

(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const GAME_ID = "skibidi_toilet_tower_defense";
  const MAX_WAVES = 10;

  const api = window.RB || {
    showRewarded: () => Promise.resolve(true),
    isAdFree: () => false,
    recordScore: () => false,
    getHighScore: () => 0,
    toast: (message) => console.log(message),
  };

  const el = {
    cash: document.getElementById("hud-cash"),
    lives: document.getElementById("hud-lives"),
    wave: document.getElementById("hud-wave"),
    score: document.getElementById("hud-score"),
    high: document.getElementById("hud-high"),
    overlay: document.getElementById("overlay"),
    overlayTitle: document.getElementById("overlay-title"),
    overlaySub: document.getElementById("overlay-sub"),
    overlayScore: document.getElementById("overlay-score"),
    primary: document.getElementById("btn-primary"),
    startWave: document.getElementById("btn-start-wave"),
    pause: document.getElementById("btn-pause"),
    restart: document.getElementById("btn-restart"),
    flush: document.getElementById("btn-flush"),
    repair: document.getElementById("btn-repair"),
    shop: document.getElementById("tower-shop"),
    inspector: document.getElementById("tower-inspector"),
  };

  const COLORS = {
    bg: "#05070d",
    path: "#2c3147",
    pink: "#ff1490",
    cyan: "#23dff2",
    yellow: "#f7d924",
    green: "#48f35a",
    red: "#ff5c5c",
    white: "#f9fbff",
    muted: "#9eb6cb",
  };

  const path = [
    { x: -44, y: 96 },
    { x: 148, y: 96 },
    { x: 148, y: 244 },
    { x: 386, y: 244 },
    { x: 386, y: 390 },
    { x: 668, y: 390 },
    { x: 668, y: 162 },
    { x: 848, y: 162 },
  ];

  const pads = [
    { id: 1, x: 86, y: 180 },
    { id: 2, x: 224, y: 82 },
    { id: 3, x: 248, y: 178 },
    { id: 4, x: 278, y: 326 },
    { id: 5, x: 480, y: 178 },
    { id: 6, x: 506, y: 306 },
    { id: 7, x: 580, y: 454 },
    { id: 8, x: 742, y: 284 },
    { id: 9, x: 606, y: 82 },
    { id: 10, x: 740, y: 96 },
  ];

  const TOWERS = {
    camera: {
      name: "Camera Turret",
      icon: "📷",
      cost: 90,
      range: 138,
      damage: 18,
      cooldown: 0.48,
      color: COLORS.cyan,
      desc: "Fast single-target laser",
    },
    speaker: {
      name: "Speaker Stack",
      icon: "🔊",
      cost: 130,
      range: 124,
      damage: 11,
      cooldown: 1.15,
      splash: 62,
      color: COLORS.yellow,
      desc: "Splash damage and slow",
    },
    plunger: {
      name: "Plunger Trap",
      icon: "🪠",
      cost: 70,
      range: 98,
      damage: 8,
      cooldown: 0.34,
      color: COLORS.pink,
      desc: "Cheap rapid stuns",
    },
  };

  const ENEMIES = {
    runner: {
      name: "Tiny Toilet",
      hp: 34,
      speed: 62,
      reward: 8,
      score: 45,
      drain: 1,
      size: 17,
      color: "#dff6ff",
    },
    singer: {
      name: "Singing Bowl",
      hp: 78,
      speed: 42,
      reward: 14,
      score: 95,
      drain: 1,
      size: 21,
      color: "#f9fbff",
    },
    chrome: {
      name: "Chrome Clogger",
      hp: 126,
      speed: 34,
      reward: 22,
      score: 155,
      drain: 2,
      size: 24,
      color: "#b9d5e4",
    },
    boss: {
      name: "G-Man Flush",
      hp: 420,
      speed: 25,
      reward: 90,
      score: 900,
      drain: 5,
      size: 34,
      color: "#f7d924",
    },
  };

  const segments = [];
  let pathLength = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segments.push({ a, b, len, start: pathLength });
    pathLength += len;
  }

  const state = {
    running: false,
    paused: false,
    gameOver: false,
    won: false,
    cash: 260,
    lives: 20,
    wave: 1,
    score: 0,
    selectedType: "camera",
    selectedTowerId: null,
    hoverPadId: null,
    towers: [],
    enemies: [],
    projectiles: [],
    particles: [],
    floats: [],
    waveActive: false,
    queue: [],
    spawnTimer: 0,
    lastTime: 0,
    nextId: 1,
    screenShake: 0,
    flash: 0,
  };

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function format(n) {
    return Math.floor(n).toLocaleString();
  }

  function pointAt(distance) {
    const d = clamp(distance, 0, pathLength);
    for (const seg of segments) {
      if (d <= seg.start + seg.len) {
        const t = (d - seg.start) / seg.len;
        return {
          x: lerp(seg.a.x, seg.b.x, t),
          y: lerp(seg.a.y, seg.b.y, t),
          angle: Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x),
        };
      }
    }
    const last = path[path.length - 1];
    return { x: last.x, y: last.y, angle: 0 };
  }

  function resetGame() {
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.won = false;
    state.cash = 260;
    state.lives = 20;
    state.wave = 1;
    state.score = 0;
    state.selectedType = "camera";
    state.selectedTowerId = null;
    state.hoverPadId = null;
    state.towers = [];
    state.enemies = [];
    state.projectiles = [];
    state.particles = [];
    state.floats = [];
    state.waveActive = false;
    state.queue = [];
    state.spawnTimer = 0;
    state.lastTime = 0;
    state.nextId = 1;
    state.screenShake = 0;
    state.flash = 0;
    hideOverlay();
    updateHUD();
    updateShop();
    updateInspector();
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  function showOverlay(title, body, actionText, scoreHtml = "") {
    el.overlayTitle.innerHTML = title;
    el.overlaySub.innerHTML = body;
    el.overlayScore.innerHTML = scoreHtml;
    el.primary.textContent = actionText;
    el.overlay.classList.add("overlay--show");
  }

  function hideOverlay() {
    el.overlay.classList.remove("overlay--show");
  }

  function makeWave(wave) {
    const queue = [];
    const runnerCount = 7 + wave * 2;
    const singerCount = Math.max(0, wave - 1);
    const chromeCount = Math.max(0, Math.floor((wave - 3) * 0.75));

    for (let i = 0; i < runnerCount; i++) queue.push({ type: "runner", gap: 0.55 });
    for (let i = 0; i < singerCount; i++) queue.push({ type: "singer", gap: 0.78 });
    for (let i = 0; i < chromeCount; i++) queue.push({ type: "chrome", gap: 1.05 });
    if (wave === 5 || wave === 10) queue.push({ type: "boss", gap: 1.25 });

    const lead = queue.splice(0, Math.min(4, queue.length));
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    return lead.concat(queue);
  }

  function startWave() {
    if (!state.running) resetGame();
    if (state.paused || state.waveActive || state.gameOver) return;
    state.waveActive = true;
    state.queue = makeWave(state.wave);
    state.spawnTimer = 0;
    state.selectedTowerId = null;
    addFloat(W / 2, 44, `WAVE ${state.wave}`, COLORS.yellow, 1.2, 0);
    api.toast(`Wave ${state.wave} incoming`, "good");
    updateHUD();
    updateInspector();
  }

  function spawnEnemy(kind) {
    const def = ENEMIES[kind];
    const scale = 1 + (state.wave - 1) * 0.18;
    const speedScale = 1 + Math.min(0.55, (state.wave - 1) * 0.035);
    const enemy = {
      id: state.nextId++,
      kind,
      name: def.name,
      distance: 0,
      x: path[0].x,
      y: path[0].y,
      angle: 0,
      hp: Math.round(def.hp * scale),
      maxHp: Math.round(def.hp * scale),
      speed: def.speed * speedScale,
      reward: Math.round(def.reward * (1 + state.wave * 0.04)),
      score: Math.round(def.score * (1 + state.wave * 0.08)),
      drain: def.drain,
      size: def.size,
      color: def.color,
      slowTime: 0,
      slowMult: 1,
      stunTime: 0,
      wobble: Math.random() * Math.PI * 2,
      hitFlash: 0,
      alive: true,
    };
    state.enemies.push(enemy);
  }

  function placeTower(pad, kind) {
    const def = TOWERS[kind];
    const occupied = state.towers.some((tower) => tower.padId === pad.id);
    if (!def || occupied || state.cash < def.cost) {
      if (def && !occupied) api.toast("Need more cash", "bad");
      return;
    }

    const tower = {
      id: state.nextId++,
      padId: pad.id,
      kind,
      x: pad.x,
      y: pad.y,
      level: 1,
      cooldown: 0,
      angle: -Math.PI / 2,
      pulse: 0,
      kills: 0,
    };
    state.cash -= def.cost;
    state.towers.push(tower);
    state.selectedTowerId = tower.id;
    burst(pad.x, pad.y, def.color, 18, 120);
    addFloat(pad.x, pad.y - 34, def.name, def.color, 0.9);
    updateHUD();
    updateShop();
    updateInspector();
  }

  function getPadAt(x, y) {
    return pads.find((pad) => Math.hypot(pad.x - x, pad.y - y) <= 32) || null;
  }

  function getTowerAt(x, y) {
    return state.towers.find((tower) => Math.hypot(tower.x - x, tower.y - y) <= 30) || null;
  }

  function towerDef(tower) {
    return TOWERS[tower.kind];
  }

  function towerStats(tower) {
    const def = towerDef(tower);
    const levelBoost = tower.level - 1;
    return {
      range: def.range + levelBoost * 18,
      damage: Math.round(def.damage * (1 + levelBoost * 0.62)),
      cooldown: Math.max(0.18, def.cooldown * (1 - levelBoost * 0.12)),
      splash: def.splash ? def.splash + levelBoost * 10 : 0,
    };
  }

  function upgradeCost(tower) {
    const def = towerDef(tower);
    return Math.round(def.cost * (0.65 + tower.level * 0.55));
  }

  function sellValue(tower) {
    const def = towerDef(tower);
    let spent = def.cost;
    for (let level = 1; level < tower.level; level++) {
      spent += Math.round(def.cost * (0.65 + level * 0.55));
    }
    return Math.round(spent * 0.58);
  }

  function upgradeSelected() {
    const tower = getSelectedTower();
    if (!tower || tower.level >= 3) return;
    const cost = upgradeCost(tower);
    if (state.cash < cost) {
      api.toast("Need more cash", "bad");
      return;
    }
    state.cash -= cost;
    tower.level += 1;
    tower.pulse = 0.8;
    burst(tower.x, tower.y, towerDef(tower).color, 22, 150);
    addFloat(tower.x, tower.y - 38, `LEVEL ${tower.level}`, COLORS.yellow, 0.9);
    updateHUD();
    updateShop();
    updateInspector();
  }

  function sellSelected() {
    const tower = getSelectedTower();
    if (!tower) return;
    state.cash += sellValue(tower);
    state.towers = state.towers.filter((candidate) => candidate.id !== tower.id);
    state.selectedTowerId = null;
    burst(tower.x, tower.y, COLORS.muted, 12, 90);
    updateHUD();
    updateShop();
    updateInspector();
  }

  function getSelectedTower() {
    return state.towers.find((tower) => tower.id === state.selectedTowerId) || null;
  }

  function acquireTarget(tower, stats) {
    let best = null;
    let bestDistance = -Infinity;
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      const d = Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
      if (d <= stats.range && enemy.distance > bestDistance) {
        best = enemy;
        bestDistance = enemy.distance;
      }
    }
    return best;
  }

  function fireTower(tower, target, stats) {
    const def = towerDef(tower);
    tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
    tower.pulse = 0.32;

    if (tower.kind === "speaker") {
      state.particles.push({
        type: "ring",
        x: tower.x,
        y: tower.y,
        radius: 12,
        maxRadius: stats.range,
        life: 0.38,
        maxLife: 0.38,
        color: def.color,
      });
      for (const enemy of state.enemies) {
        if (!enemy.alive) continue;
        const d = Math.hypot(enemy.x - target.x, enemy.y - target.y);
        if (d <= stats.splash) {
          damageEnemy(enemy, stats.damage, tower);
          enemy.slowTime = Math.max(enemy.slowTime, 1.7);
          enemy.slowMult = Math.min(enemy.slowMult, 0.52);
        }
      }
      burst(target.x, target.y, def.color, 8, 80);
      return;
    }

    state.projectiles.push({
      x: tower.x,
      y: tower.y,
      targetId: target.id,
      damage: stats.damage,
      kind: tower.kind,
      color: def.color,
      speed: tower.kind === "plunger" ? 470 : 560,
      radius: tower.kind === "plunger" ? 6 : 4,
      fromTowerId: tower.id,
      stun: tower.kind === "plunger" ? 0.34 + tower.level * 0.06 : 0,
    });
  }

  function damageEnemy(enemy, amount, tower) {
    if (!enemy.alive) return;
    enemy.hp -= amount;
    enemy.hitFlash = 0.18;
    if (enemy.hp <= 0) {
      enemy.alive = false;
      if (tower) tower.kills += 1;
      state.cash += enemy.reward;
      state.score += enemy.score;
      burst(enemy.x, enemy.y, enemy.color, enemy.kind === "boss" ? 46 : 16, enemy.kind === "boss" ? 260 : 120);
      addFloat(enemy.x, enemy.y - enemy.size - 10, `+$${enemy.reward}`, COLORS.green, 0.8);
    }
  }

  function burst(x, y, color, count = 10, speed = 120) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const v = rand(speed * 0.25, speed);
      state.particles.push({
        type: "dot",
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        life: rand(0.35, 0.8),
        maxLife: 0.8,
        color,
        size: rand(2, 5),
      });
    }
  }

  function addFloat(x, y, text, color = COLORS.yellow, life = 0.9, vy = -38) {
    state.floats.push({ x, y, text, color, life, maxLife: life, vy });
  }

  function endGame(won) {
    state.gameOver = true;
    state.won = won;
    state.waveActive = false;
    const high = api.recordScore(GAME_ID, state.score);
    updateHUD();
    if (won) {
      showOverlay(
        "🚽 DEFENSE COMPLETE",
        "The toilet rush has been flushed back into the algorithm. The camera towers are exhausted. The plungers are heroes.",
        "Play again",
        `<strong>${format(state.score)}</strong> points${high ? " · new high score" : ""}`,
      );
    } else {
      showOverlay(
        "💀 BASE CLOGGED",
        "Too many toilets reached the exit. Rebuild the line, upgrade earlier, and do not underestimate the singing bowls.",
        "Try again",
        `<strong>${format(state.score)}</strong> points${high ? " · new high score" : ""}`,
      );
    }
  }

  function finishWaveIfClear() {
    if (!state.waveActive || state.queue.length || state.enemies.some((enemy) => enemy.alive)) return;
    state.waveActive = false;
    state.projectiles = [];
    const bonus = 55 + state.wave * 12 + Math.max(0, state.lives - 10) * 2;
    state.cash += bonus;
    addFloat(W / 2, 62, `WAVE CLEAR +$${bonus}`, COLORS.green, 1.3, 0);
    if (state.wave >= MAX_WAVES) {
      endGame(true);
      return;
    }
    state.wave += 1;
    api.toast(`Wave clear. $${bonus} bonus.`, "good");
    updateHUD();
    updateShop();
  }

  let rafId = null;
  function loop(now) {
    if (!state.running) {
      rafId = null;
      return;
    }
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;

    if (!state.paused && !state.gameOver) update(dt);
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function update(dt) {
    if (state.waveActive) {
      state.spawnTimer -= dt;
      while (state.spawnTimer <= 0 && state.queue.length) {
        const next = state.queue.shift();
        spawnEnemy(next.type);
        state.spawnTimer += next.gap;
      }
    }

    for (const tower of state.towers) {
      const stats = towerStats(tower);
      tower.cooldown = Math.max(0, tower.cooldown - dt);
      tower.pulse = Math.max(0, tower.pulse - dt);
      if (tower.cooldown <= 0) {
        const target = acquireTarget(tower, stats);
        if (target) {
          fireTower(tower, target, stats);
          tower.cooldown = stats.cooldown;
        }
      }
    }

    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.wobble += dt * 5;
      if (enemy.stunTime > 0) {
        enemy.stunTime = Math.max(0, enemy.stunTime - dt);
      } else {
        const slow = enemy.slowTime > 0 ? enemy.slowMult : 1;
        enemy.distance += enemy.speed * slow * dt;
      }
      if (enemy.slowTime > 0) {
        enemy.slowTime = Math.max(0, enemy.slowTime - dt);
        if (enemy.slowTime === 0) enemy.slowMult = 1;
      }
      const p = pointAt(enemy.distance);
      enemy.x = p.x;
      enemy.y = p.y;
      enemy.angle = p.angle;
      if (enemy.distance >= pathLength) {
        enemy.alive = false;
        state.lives -= enemy.drain;
        state.screenShake = 0.5;
        state.flash = 0.32;
        addFloat(W - 78, 166, `-${enemy.drain} LIFE`, COLORS.red, 0.9);
        if (state.lives <= 0) {
          state.lives = 0;
          endGame(false);
        }
      }
    }
    state.enemies = state.enemies.filter((enemy) => enemy.alive);

    updateProjectiles(dt);
    updateParticles(dt);
    state.screenShake = Math.max(0, state.screenShake - dt * 1.8);
    state.flash = Math.max(0, state.flash - dt * 2.8);
    finishWaveIfClear();
    updateHUD();
  }

  function updateProjectiles(dt) {
    for (let i = state.projectiles.length - 1; i >= 0; i--) {
      const p = state.projectiles[i];
      const target = state.enemies.find((enemy) => enemy.id === p.targetId && enemy.alive);
      if (!target) {
        state.projectiles.splice(i, 1);
        continue;
      }
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < Math.max(12, target.size * 0.7)) {
        damageEnemy(target, p.damage, state.towers.find((tower) => tower.id === p.fromTowerId));
        if (p.stun && target.alive) target.stunTime = Math.max(target.stunTime, p.stun);
        burst(target.x, target.y, p.color, 6, 90);
        state.projectiles.splice(i, 1);
        continue;
      }
      const step = Math.min(d, p.speed * dt);
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      if (p.type === "dot") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.97;
        p.vy *= 0.97;
      } else if (p.type === "ring") {
        p.radius = lerp(p.radius, p.maxRadius, 0.16);
      }
    }

    for (let i = state.floats.length - 1; i >= 0; i--) {
      const f = state.floats[i];
      f.life -= dt;
      f.y += f.vy * dt;
      if (f.life <= 0) state.floats.splice(i, 1);
    }
  }

  function updateHUD() {
    el.cash.textContent = `$${format(state.cash)}`;
    el.lives.textContent = String(state.lives);
    el.wave.textContent = `${state.wave}/${MAX_WAVES}`;
    el.score.textContent = format(state.score);
    el.high.textContent = format(api.getHighScore(GAME_ID));
    el.startWave.disabled = state.paused || state.waveActive || state.gameOver;
    el.startWave.textContent = state.waveActive ? "Wave running" : `Start wave ${state.wave}`;
    el.pause.textContent = state.paused ? "Resume" : "Pause";
    updateShop();
  }

  function updateShop() {
    el.shop.querySelectorAll("[data-tower]").forEach((button) => {
      const kind = button.dataset.tower;
      const def = TOWERS[kind];
      button.classList.toggle("is-selected", state.selectedType === kind && !state.selectedTowerId);
      button.disabled = state.cash < def.cost || state.gameOver;
    });
  }

  function updateInspector() {
    const tower = getSelectedTower();
    if (!tower) {
      const def = TOWERS[state.selectedType];
      el.inspector.innerHTML = `
        <strong>${def.icon} ${def.name} selected</strong>
        ${def.desc}. Click an empty glowing pad to build for $${def.cost}.
      `;
      return;
    }

    const def = towerDef(tower);
    const stats = towerStats(tower);
    const nextCost = tower.level < 3 ? upgradeCost(tower) : 0;
    el.inspector.innerHTML = `
      <strong>${def.icon} ${def.name} · Lv ${tower.level}</strong>
      Damage ${stats.damage} · Range ${Math.round(stats.range)} · Kills ${tower.kills}
      <div class="tower-inspector__actions">
        <button class="btn btn--secondary" id="btn-upgrade-tower" style="font-size:12px;padding:8px 10px;" ${tower.level >= 3 ? "disabled" : ""}>
          ${tower.level >= 3 ? "Max level" : `Upgrade $${nextCost}`}
        </button>
        <button class="btn btn--ghost" id="btn-sell-tower" style="font-size:12px;padding:8px 10px;">Sell $${sellValue(tower)}</button>
      </div>
    `;
    const upgrade = document.getElementById("btn-upgrade-tower");
    const sell = document.getElementById("btn-sell-tower");
    if (upgrade) upgrade.addEventListener("click", upgradeSelected);
    if (sell) sell.addEventListener("click", sellSelected);
  }

  function draw() {
    const shakeX = state.screenShake ? rand(-6, 6) * state.screenShake : 0;
    const shakeY = state.screenShake ? rand(-5, 5) * state.screenShake : 0;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate(shakeX, shakeY);
    drawBackground();
    drawPath();
    drawPads();
    drawTowers();
    drawEnemies();
    drawProjectiles();
    drawParticles();
    drawSelection();
    drawFloats();
    if (state.paused) drawPaused();
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255,92,92,${state.flash * 0.28})`;
      ctx.fillRect(-10, -10, W + 20, H + 20);
    }
    ctx.restore();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#05070d");
    g.addColorStop(0.55, "#0d1726");
    g.addColorStop(1, "#031420");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(113,132,156,0.16)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255,20,144,0.05)";
    ctx.fillRect(0, 0, W, 38);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "700 11px JetBrains Mono, monospace";
    ctx.fillText("RAINBOT DEFENSE GRID · BATHROOM BREACH", 18, 24);
  }

  function drawPath() {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 86;
    ctx.strokeStyle = "#02050a";
    strokePath();
    ctx.lineWidth = 66;
    ctx.strokeStyle = COLORS.path;
    strokePath();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(35,223,242,0.72)";
    ctx.setLineDash([24, 22]);
    strokePath();
    ctx.setLineDash([]);

    drawPortal(path[0].x + 36, path[0].y, "IN");
    drawPortal(W - 34, 162, "EXIT");
  }

  function strokePath() {
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
  }

  function drawPortal(x, y, label) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = label === "IN" ? "rgba(255,20,144,0.24)" : "rgba(72,243,90,0.20)";
    ctx.strokeStyle = label === "IN" ? COLORS.pink : COLORS.green;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.white;
    ctx.font = "800 10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, 0, 4);
    ctx.restore();
  }

  function drawPads() {
    for (const pad of pads) {
      const tower = state.towers.find((candidate) => candidate.padId === pad.id);
      const hovering = state.hoverPadId === pad.id;
      ctx.save();
      ctx.translate(pad.x, pad.y);
      ctx.fillStyle = tower ? "rgba(5,7,13,0.78)" : "rgba(35,223,242,0.09)";
      ctx.strokeStyle = hovering && !tower ? COLORS.yellow : tower ? "rgba(249,251,255,0.26)" : "rgba(35,223,242,0.62)";
      ctx.lineWidth = hovering ? 4 : 2;
      roundedRect(-26, -26, 52, 52, 9);
      ctx.fill();
      ctx.stroke();
      if (!tower) {
        ctx.strokeStyle = "rgba(255,20,144,0.42)";
        ctx.beginPath();
        ctx.moveTo(-11, 0);
        ctx.lineTo(11, 0);
        ctx.moveTo(0, -11);
        ctx.lineTo(0, 11);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawTowers() {
    for (const tower of state.towers) {
      const selected = tower.id === state.selectedTowerId;
      const def = towerDef(tower);
      const stats = towerStats(tower);
      if (selected) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, stats.range, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.48;
        ctx.strokeStyle = def.color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
      if (tower.kind === "camera") drawCameraTower(tower, def);
      if (tower.kind === "speaker") drawSpeakerTower(tower, def);
      if (tower.kind === "plunger") drawPlungerTower(tower, def);
      drawLevelPips(tower.x, tower.y + 33, tower.level, def.color);
    }
  }

  function drawCameraTower(tower, def) {
    ctx.save();
    ctx.translate(tower.x, tower.y);
    ctx.rotate(tower.angle);
    ctx.fillStyle = "#10151f";
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 3;
    roundedRect(-22, -16, 38, 32, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#05070d";
    ctx.beginPath();
    ctx.arc(2, 0, 9 + tower.pulse * 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.white;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(2, 0, 4 + tower.pulse * 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#182336";
    ctx.fillRect(-28, 13, 42, 9);
    ctx.restore();
  }

  function drawSpeakerTower(tower, def) {
    ctx.save();
    ctx.translate(tower.x, tower.y);
    ctx.fillStyle = "#10151f";
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 3;
    roundedRect(-22, -25, 44, 50, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#05070d";
    ctx.beginPath();
    ctx.arc(0, -10, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 13, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -10, 6 + tower.pulse * 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 13, 4 + tower.pulse * 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlungerTower(tower, def) {
    ctx.save();
    ctx.translate(tower.x, tower.y);
    ctx.rotate(tower.angle + Math.PI / 2);
    ctx.fillStyle = "#6b171c";
    ctx.strokeStyle = "#170508";
    ctx.lineWidth = 3;
    roundedRect(-6, -24, 12, 45, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.ellipse(0, -25, 22 + tower.pulse * 4, 12 + tower.pulse * 2, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#381218";
    ctx.fillRect(-16, 20, 32, 9);
    ctx.restore();
  }

  function drawLevelPips(x, y, level, color) {
    ctx.save();
    ctx.translate(x, y);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < level ? color : "rgba(249,251,255,0.16)";
      ctx.fillRect(-15 + i * 11, -3, 7, 6);
    }
    ctx.restore();
  }

  function drawEnemies() {
    const sorted = [...state.enemies].sort((a, b) => a.y - b.y);
    for (const enemy of sorted) drawToiletEnemy(enemy);
  }

  function drawToiletEnemy(enemy) {
    const wobble = Math.sin(enemy.wobble) * 2.5;
    ctx.save();
    ctx.translate(enemy.x, enemy.y + wobble);
    ctx.rotate(Math.sin(enemy.wobble * 0.7) * 0.06);
    const scale = enemy.size / 22;
    ctx.scale(scale, scale);

    if (enemy.slowTime > 0) {
      ctx.strokeStyle = "rgba(35,223,242,0.6)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 4, 31, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = enemy.hitFlash > 0 ? COLORS.red : enemy.color;
    ctx.strokeStyle = "#05070d";
    ctx.lineWidth = 4;
    roundedRect(-24, 0, 48, 33, 11);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f9fbff";
    roundedRect(-16, -29, 32, 30, 7);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#b9d5e4";
    ctx.beginPath();
    ctx.ellipse(0, 13, 17, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#05070d";
    ctx.beginPath();
    ctx.arc(-7, -16, 3.4, 0, Math.PI * 2);
    ctx.arc(7, -16, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = enemy.kind === "boss" ? COLORS.pink : COLORS.cyan;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(1, -5, enemy.kind === "runner" ? 5 : 8, 0.15, Math.PI - 0.15);
    ctx.stroke();

    if (enemy.kind === "boss") {
      ctx.strokeStyle = COLORS.yellow;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-27, -20);
      ctx.lineTo(-42, -33);
      ctx.moveTo(27, -20);
      ctx.lineTo(42, -33);
      ctx.stroke();
    }

    ctx.restore();
    drawHealth(enemy);
  }

  function drawHealth(enemy) {
    const w = enemy.kind === "boss" ? 60 : 40;
    const pct = clamp(enemy.hp / enemy.maxHp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    roundedRect(enemy.x - w / 2, enemy.y - enemy.size - 31, w, 7, 3);
    ctx.fill();
    ctx.fillStyle = pct > 0.5 ? COLORS.green : pct > 0.22 ? COLORS.yellow : COLORS.red;
    roundedRect(enemy.x - w / 2, enemy.y - enemy.size - 31, w * pct, 7, 3);
    ctx.fill();
  }

  function drawProjectiles() {
    for (const p of state.projectiles) {
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 12;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawParticles() {
    for (const p of state.particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (p.type === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawSelection() {
    const pad = pads.find((candidate) => candidate.id === state.hoverPadId);
    if (!pad) return;
    const tower = state.towers.find((candidate) => candidate.padId === pad.id);
    if (tower) return;
    const def = TOWERS[state.selectedType];
    ctx.save();
    ctx.globalAlpha = state.cash >= def.cost ? 0.16 : 0.08;
    ctx.fillStyle = state.cash >= def.cost ? def.color : COLORS.red;
    ctx.beginPath();
    ctx.arc(pad.x, pad.y, def.range, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFloats() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "800 16px JetBrains Mono, monospace";
    for (const f of state.floats) {
      const alpha = clamp(f.life / f.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#05070d";
      ctx.fillText(f.text, f.x + 2, f.y + 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  function drawPaused() {
    ctx.save();
    ctx.fillStyle = "rgba(5,7,13,0.72)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COLORS.white;
    ctx.font = "900 42px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", W / 2, H / 2);
    ctx.font = "700 13px JetBrains Mono, monospace";
    ctx.fillStyle = COLORS.muted;
    ctx.fillText("Press P or click Resume", W / 2, H / 2 + 34);
    ctx.restore();
  }

  function roundedRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * W,
      y: ((event.clientY - rect.top) / rect.height) * H,
    };
  }

  function handleCanvasClick(event) {
    if (!state.running || state.gameOver || state.paused) return;
    const p = canvasPoint(event);
    const tower = getTowerAt(p.x, p.y);
    if (tower) {
      state.selectedTowerId = tower.id;
      updateInspector();
      return;
    }
    const pad = getPadAt(p.x, p.y);
    if (pad) {
      const existing = state.towers.find((candidate) => candidate.padId === pad.id);
      if (existing) {
        state.selectedTowerId = existing.id;
        updateInspector();
      } else {
        state.selectedTowerId = null;
        placeTower(pad, state.selectedType);
      }
    }
  }

  async function rewardedBoost(kind) {
    if (!state.running || state.gameOver) return;
    const ok = api.isAdFree() ? true : await api.showRewarded();
    if (!ok) return;
    if (kind === "flush") {
      for (const enemy of state.enemies) {
        enemy.slowTime = Math.max(enemy.slowTime, 2.8);
        enemy.slowMult = Math.min(enemy.slowMult, 0.38);
        damageEnemy(enemy, 36 + state.wave * 5, null);
      }
      state.cash += 80;
      state.screenShake = 0.55;
      state.flash = 0.45;
      addFloat(W / 2, 88, "EMERGENCY FLUSH +$80", COLORS.cyan, 1.4, 0);
      api.toast("Emergency flush activated", "good");
    } else {
      const before = state.lives;
      state.lives = Math.min(25, state.lives + 5);
      state.cash += 35;
      addFloat(W / 2, 88, `REPAIR +${state.lives - before} LIVES`, COLORS.green, 1.4, 0);
      api.toast("Base repaired", "good");
    }
    updateHUD();
  }

  function bindEvents() {
    el.primary.addEventListener("click", resetGame);
    el.startWave.addEventListener("click", startWave);
    el.pause.addEventListener("click", () => {
      if (!state.running || state.gameOver) return;
      state.paused = !state.paused;
      updateHUD();
    });
    el.restart.addEventListener("click", resetGame);
    el.flush.addEventListener("click", () => rewardedBoost("flush"));
    el.repair.addEventListener("click", () => rewardedBoost("repair"));

    el.shop.querySelectorAll("[data-tower]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedType = button.dataset.tower;
        state.selectedTowerId = null;
        updateShop();
        updateInspector();
      });
    });

    canvas.addEventListener("click", handleCanvasClick);
    canvas.addEventListener("mousemove", (event) => {
      const p = canvasPoint(event);
      const pad = getPadAt(p.x, p.y);
      state.hoverPadId = pad ? pad.id : null;
    });
    canvas.addEventListener("mouseleave", () => {
      state.hoverPadId = null;
    });

    window.addEventListener("keydown", (event) => {
      if (event.code === "Digit1") selectType("camera");
      if (event.code === "Digit2") selectType("speaker");
      if (event.code === "Digit3") selectType("plunger");
      if (event.code === "Space") {
        event.preventDefault();
        startWave();
      }
      if (event.code === "KeyP" && state.running && !state.gameOver) {
        state.paused = !state.paused;
        updateHUD();
      }
      if (event.code === "Escape" && state.selectedTowerId) {
        state.selectedTowerId = null;
        updateInspector();
      }
    });
  }

  function selectType(kind) {
    state.selectedType = kind;
    state.selectedTowerId = null;
    updateShop();
    updateInspector();
  }

  bindEvents();
  updateHUD();
  updateInspector();
  draw();
})();
