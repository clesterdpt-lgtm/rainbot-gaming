/* ============================================
   SKIBIDI TOILET TOWER DEFENSE
   --------------------------------------------
   Static canvas tower defense for Rainbot Gaming.
   Build towers on fixed pads, hold each map, and
   use the existing RB rewarded-ad hooks for boosts.
   ============================================ */

(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const GAME_ID = "skibidi_toilet_tower_defense";

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
    map: document.getElementById("hud-map"),
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
    levelSelect: document.getElementById("level-select"),
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

  const LEVELS = [
    {
      id: "bathroom",
      name: "Bathroom Breach",
      hudName: "Breach",
      difficulty: "Normal",
      banner: "BATHROOM BREACH",
      intro: "Build camera turrets, speaker stacks, and plunger traps around the bathroom portal.",
      startCash: 245,
      lives: 18,
      waves: 10,
      enemyCountScale: 1.05,
      hpGrowth: 0.2,
      speedGrowth: 0.04,
      maxSpeedBonus: 0.62,
      rewardScale: 1,
      spawnGapScale: 0.94,
      bossWaves: [5, 10],
      pathWidth: 66,
      palette: {
        top: "#05070d",
        mid: "#0d1726",
        bottom: "#031420",
        path: "#2c3147",
        pathTrim: "#23dff2",
        grid: "rgba(113,132,156,0.16)",
        wash: "rgba(255,20,144,0.05)",
        pad: "#23dff2",
        prop: "rgba(35,223,242,0.18)",
        accent: "#ff1490",
        exit: "#48f35a",
      },
      path: [
        { x: -44, y: 96 },
        { x: 148, y: 96 },
        { x: 148, y: 244 },
        { x: 386, y: 244 },
        { x: 386, y: 390 },
        { x: 668, y: 390 },
        { x: 668, y: 162 },
        { x: 848, y: 162 },
      ],
      pads: [
        { id: 1, x: 64, y: 180 },
        { id: 2, x: 224, y: 82 },
        { id: 3, x: 248, y: 160 },
        { id: 4, x: 278, y: 326 },
        { id: 5, x: 455, y: 196 },
        { id: 6, x: 506, y: 306 },
        { id: 7, x: 580, y: 474 },
        { id: 8, x: 742, y: 284 },
        { id: 9, x: 617, y: 96 },
        { id: 10, x: 740, y: 78 },
      ],
    },
    {
      id: "sewer",
      name: "Subway Sewers",
      hudName: "Sewers",
      difficulty: "Hard",
      banner: "SUBWAY SEWER SURGE",
      intro: "A longer service-tunnel route sends quicker rushes through wide speaker lanes.",
      startCash: 285,
      lives: 20,
      waves: 11,
      enemyCountScale: 1.16,
      hpGrowth: 0.22,
      speedGrowth: 0.047,
      maxSpeedBonus: 0.74,
      rewardScale: 1.08,
      spawnGapScale: 0.82,
      bossWaves: [6, 11],
      pathWidth: 64,
      palette: {
        top: "#03110e",
        mid: "#071c1c",
        bottom: "#06101b",
        path: "#233d3e",
        pathTrim: "#6bff7d",
        grid: "rgba(107,255,125,0.10)",
        wash: "rgba(107,255,125,0.06)",
        pad: "#6bff7d",
        prop: "rgba(255,212,59,0.18)",
        accent: "#23dff2",
        exit: "#ffd43b",
      },
      path: [
        { x: -44, y: 410 },
        { x: 122, y: 410 },
        { x: 122, y: 126 },
        { x: 306, y: 126 },
        { x: 306, y: 318 },
        { x: 506, y: 318 },
        { x: 506, y: 84 },
        { x: 690, y: 84 },
        { x: 690, y: 430 },
        { x: 848, y: 430 },
      ],
      pads: [
        { id: 1, x: 42, y: 330 },
        { id: 2, x: 194, y: 236 },
        { id: 3, x: 210, y: 42 },
        { id: 4, x: 380, y: 208 },
        { id: 5, x: 214, y: 390 },
        { id: 6, x: 430, y: 402 },
        { id: 7, x: 590, y: 236 },
        { id: 8, x: 604, y: 166 },
        { id: 9, x: 766, y: 196 },
        { id: 10, x: 610, y: 456 },
        { id: 11, x: 766, y: 346 },
      ],
    },
    {
      id: "rooftop",
      name: "Rooftop Relay",
      hudName: "Relay",
      difficulty: "Expert",
      banner: "ROOFTOP RELAY",
      intro: "Tight skyline corners reward crossfire, but late bosses hit harder.",
      startCash: 315,
      lives: 22,
      waves: 12,
      enemyCountScale: 1.22,
      hpGrowth: 0.24,
      speedGrowth: 0.046,
      maxSpeedBonus: 0.78,
      rewardScale: 1.14,
      spawnGapScale: 0.78,
      bossWaves: [6, 10, 12],
      pathWidth: 62,
      palette: {
        top: "#071024",
        mid: "#121a33",
        bottom: "#070a12",
        path: "#342c50",
        pathTrim: "#ff1490",
        grid: "rgba(255,255,255,0.10)",
        wash: "rgba(46,224,255,0.06)",
        pad: "#ff1490",
        prop: "rgba(46,224,255,0.18)",
        accent: "#ffd43b",
        exit: "#23dff2",
      },
      path: [
        { x: -44, y: 260 },
        { x: 116, y: 260 },
        { x: 116, y: 104 },
        { x: 332, y: 104 },
        { x: 332, y: 422 },
        { x: 538, y: 422 },
        { x: 538, y: 226 },
        { x: 704, y: 226 },
        { x: 704, y: 88 },
        { x: 848, y: 88 },
      ],
      pads: [
        { id: 1, x: 40, y: 170 },
        { id: 2, x: 194, y: 34 },
        { id: 3, x: 236, y: 176 },
        { id: 4, x: 254, y: 330 },
        { id: 5, x: 414, y: 276 },
        { id: 6, x: 610, y: 466 },
        { id: 7, x: 612, y: 350 },
        { id: 8, x: 622, y: 142 },
        { id: 9, x: 766, y: 270 },
        { id: 10, x: 622, y: 52 },
        { id: 11, x: 670, y: 302 },
      ],
    },
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
    jet: {
      name: "Jet Toilet",
      hp: 44,
      speed: 92,
      reward: 10,
      score: 75,
      drain: 1,
      size: 16,
      color: "#a8f7ff",
      slowResist: 0.24,
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
    cluster: {
      name: "Clog Cluster",
      hp: 112,
      speed: 39,
      reward: 18,
      score: 140,
      drain: 2,
      size: 24,
      color: "#c8ffe8",
      splitInto: [
        { type: "runner", hpScale: 0.72, rewardScale: 0.45, scoreScale: 0.45 },
        { type: "runner", hpScale: 0.72, rewardScale: 0.45, scoreScale: 0.45 },
      ],
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
      armor: 0.12,
      stunResist: 0.18,
    },
    shield: {
      name: "Shield Bowl",
      hp: 168,
      speed: 31,
      reward: 28,
      score: 215,
      drain: 2,
      size: 26,
      color: "#d7e8ff",
      armor: 0.28,
      slowResist: 0.18,
      stunResist: 0.42,
    },
    leaker: {
      name: "Leaky Royal",
      hp: 118,
      speed: 37,
      reward: 24,
      score: 185,
      drain: 2,
      size: 23,
      color: "#baffd4",
      regen: 5.5,
      slowResist: 0.12,
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
      armor: 0.16,
      regen: 3,
      slowResist: 0.42,
      stunResist: 0.68,
    },
  };

  let activeLevel = LEVELS[0];
  let path = activeLevel.path;
  let pads = activeLevel.pads;
  let segments = [];
  let pathLength = 0;

  function rebuildPathMetrics() {
    path = activeLevel.path;
    pads = activeLevel.pads;
    segments = [];
    pathLength = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      segments.push({ a, b, len, start: pathLength });
      pathLength += len;
    }
  }

  rebuildPathMetrics();

  const state = {
    running: false,
    paused: false,
    gameOver: false,
    won: false,
    cash: activeLevel.startCash,
    lives: activeLevel.lives,
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
    time: 0,
    nextId: 1,
    screenShake: 0,
    flash: 0,
  };
  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 1 });
  let saveMenu = null;

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

  function maxWaves() {
    return activeLevel.waves;
  }

  function scoreKey() {
    return `${GAME_ID}_${activeLevel.id}`;
  }

  function canSwitchLevel() {
    return !state.running || state.gameOver || (!state.waveActive && !state.towers.length && state.wave === 1 && state.score === 0);
  }

  function resetPreviewState() {
    state.running = false;
    state.paused = false;
    state.gameOver = false;
    state.won = false;
    state.cash = activeLevel.startCash;
    state.lives = activeLevel.lives;
    state.wave = 1;
    state.score = 0;
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
    state.time = 0;
    state.screenShake = 0;
    state.flash = 0;
  }

  function showLevelIntro() {
    showOverlay(
      "🚽 SKIBIDI TOILET TOWER DEFENSE",
      `${activeLevel.intro}<br><br><strong>Hold ${activeLevel.name} for ${activeLevel.waves} waves.</strong>`,
      `Start ${activeLevel.hudName}`,
    );
    if (saveMenu) saveMenu.refresh();
  }

  function selectLevel(id) {
    const next = LEVELS.find((level) => level.id === id);
    if (!next || next.id === activeLevel.id) return;
    if (!canSwitchLevel()) {
      api.toast("Restart before switching maps", "bad");
      return;
    }
    activeLevel = next;
    rebuildPathMetrics();
    resetPreviewState();
    showLevelIntro();
    updateHUD();
    updateLevelSelect();
    updateShop();
    updateInspector();
    draw();
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
    if (saveSlot) saveSlot.clear();
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.won = false;
    state.cash = activeLevel.startCash;
    state.lives = activeLevel.lives;
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
    state.time = 0;
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
    const pressure = activeLevel.enemyCountScale;
    const runnerCount = Math.round((6 + wave * 1.5) * pressure);
    const jetCount = Math.round(Math.max(0, wave - 1) * 0.55 * pressure);
    const singerCount = Math.round(Math.max(0, wave - 2) * 0.62 * pressure);
    const clusterCount = Math.round(Math.max(0, wave - 4) * 0.35 * pressure);
    const chromeCount = Math.round(Math.max(0, Math.floor((wave - 3) * 0.62)) * pressure);
    const shieldCount = Math.round(Math.max(0, wave - 5) * 0.3 * pressure);
    const leakerCount = Math.round(Math.max(0, wave - 6) * 0.25 * pressure);

    for (let i = 0; i < runnerCount; i++) queue.push({ type: "runner", gap: 0.55 });
    for (let i = 0; i < jetCount; i++) queue.push({ type: "jet", gap: 0.44 });
    for (let i = 0; i < singerCount; i++) queue.push({ type: "singer", gap: 0.78 });
    for (let i = 0; i < clusterCount; i++) queue.push({ type: "cluster", gap: 0.92 });
    for (let i = 0; i < chromeCount; i++) queue.push({ type: "chrome", gap: 1.05 });
    for (let i = 0; i < shieldCount; i++) queue.push({ type: "shield", gap: 1.15 });
    for (let i = 0; i < leakerCount; i++) queue.push({ type: "leaker", gap: 0.96 });
    if (activeLevel.bossWaves.includes(wave) || wave === activeLevel.waves) queue.push({ type: "boss", gap: 1.25 });

    const lead = queue.splice(0, Math.min(4, queue.length));
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    return lead.concat(queue).map((entry) => ({ ...entry, gap: entry.gap * activeLevel.spawnGapScale }));
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

  function spawnEnemy(kind, options = {}) {
    const def = ENEMIES[kind];
    const scale = 1 + (state.wave - 1) * activeLevel.hpGrowth;
    const speedScale = 1 + Math.min(activeLevel.maxSpeedBonus, (state.wave - 1) * activeLevel.speedGrowth);
    const distance = Math.max(0, options.distance || 0);
    const p = pointAt(distance);
    const enemy = {
      id: state.nextId++,
      kind,
      name: def.name,
      distance,
      x: p.x,
      y: p.y,
      angle: p.angle,
      hp: Math.round(def.hp * scale * (options.hpScale || 1)),
      maxHp: Math.round(def.hp * scale * (options.hpScale || 1)),
      speed: def.speed * speedScale,
      reward: Math.max(1, Math.round(def.reward * activeLevel.rewardScale * (1 + state.wave * 0.04) * (options.rewardScale || 1))),
      score: Math.max(1, Math.round(def.score * (1 + state.wave * 0.08) * (options.scoreScale || 1))),
      drain: def.drain,
      size: def.size,
      color: def.color,
      armor: def.armor || 0,
      regen: def.regen || 0,
      slowResist: def.slowResist || 0,
      stunResist: def.stunResist || 0,
      splitInto: def.splitInto || null,
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
          applySlow(enemy, 1.7, 0.52);
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

  function applySlow(enemy, duration, mult) {
    const resist = clamp(enemy.slowResist || 0, 0, 0.9);
    const effectiveDuration = duration * (1 - resist);
    const effectiveMult = 1 - (1 - mult) * (1 - resist);
    if (effectiveDuration <= 0.05) return;
    enemy.slowTime = Math.max(enemy.slowTime, effectiveDuration);
    enemy.slowMult = Math.min(enemy.slowMult, effectiveMult);
  }

  function applyStun(enemy, duration) {
    const resist = clamp(enemy.stunResist || 0, 0, 0.92);
    const effectiveDuration = duration * (1 - resist);
    if (effectiveDuration <= 0.05) return;
    enemy.stunTime = Math.max(enemy.stunTime, effectiveDuration);
  }

  function damageEnemy(enemy, amount, tower) {
    if (!enemy.alive) return;
    const armor = clamp(enemy.armor || 0, 0, 0.75);
    const dealt = Math.max(1, Math.round(amount * (1 - armor)));
    enemy.hp -= dealt;
    enemy.hitFlash = 0.18;
    if (enemy.hp <= 0) {
      enemy.alive = false;
      if (tower) tower.kills += 1;
      state.cash += enemy.reward;
      state.score += enemy.score;
      burst(enemy.x, enemy.y, enemy.color, enemy.kind === "boss" ? 46 : 16, enemy.kind === "boss" ? 260 : 120);
      addFloat(enemy.x, enemy.y - enemy.size - 10, `+$${enemy.reward}`, COLORS.green, 0.8);
      spawnSplitEnemies(enemy);
    }
  }

  function spawnSplitEnemies(enemy) {
    if (!enemy.splitInto || enemy.distance >= pathLength - 42) return;
    enemy.splitInto.forEach((child, index) => {
      spawnEnemy(child.type, {
        distance: Math.max(0, enemy.distance - 18 + index * 20),
        hpScale: child.hpScale || 1,
        rewardScale: child.rewardScale || 0.5,
        scoreScale: child.scoreScale || 0.5,
      });
    });
    addFloat(enemy.x, enemy.y - enemy.size - 28, "SPLIT!", COLORS.pink, 0.7);
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
    if (saveSlot) saveSlot.clear();
    const high = api.recordScore(scoreKey(), state.score);
    updateHUD();
    if (won) {
      showOverlay(
        "🚽 DEFENSE COMPLETE",
        `${activeLevel.name} is clear. The toilet rush has been flushed back into the algorithm, and the plungers are heroes.`,
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
    if (state.wave >= maxWaves()) {
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
    state.time += dt;

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
      if (enemy.regen > 0 && enemy.hitFlash <= 0 && enemy.hp < enemy.maxHp) {
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.regen * dt);
      }
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
        if (p.stun && target.alive) applyStun(target, p.stun);
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
    el.wave.textContent = `${state.wave}/${maxWaves()}`;
    el.map.textContent = activeLevel.hudName;
    el.score.textContent = format(state.score);
    el.high.textContent = format(api.getHighScore(scoreKey()));
    el.startWave.disabled = state.paused || state.waveActive || state.gameOver;
    el.startWave.textContent = state.waveActive ? "Wave running" : `Start wave ${state.wave}`;
    el.pause.textContent = state.paused ? "Resume" : "Pause";
    updateShop();
    updateLevelSelect();
  }

  function updateLevelSelect() {
    if (!el.levelSelect) return;
    const locked = !canSwitchLevel();
    el.levelSelect.querySelectorAll("[data-level]").forEach((button) => {
      const level = LEVELS.find((candidate) => candidate.id === button.dataset.level);
      button.classList.toggle("is-selected", level && level.id === activeLevel.id);
      button.disabled = locked && (!level || level.id !== activeLevel.id);
    });
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
    const palette = activeLevel.palette;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, palette.top);
    g.addColorStop(0.55, palette.mid);
    g.addColorStop(1, palette.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawLevelTexture();

    ctx.strokeStyle = palette.grid;
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

    ctx.fillStyle = palette.wash;
    ctx.fillRect(0, 0, W, 38);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "700 11px JetBrains Mono, monospace";
    ctx.fillText(`RAINBOT DEFENSE GRID · ${activeLevel.banner}`, 18, 24);

    drawMapBadge();
  }

  function drawLevelTexture() {
    if (activeLevel.id === "bathroom") drawBathroomTexture();
    if (activeLevel.id === "sewer") drawSewerTexture();
    if (activeLevel.id === "rooftop") drawRooftopTexture();
  }

  function drawBathroomTexture() {
    ctx.save();
    ctx.strokeStyle = "rgba(249,251,255,0.08)";
    ctx.lineWidth = 2;
    for (let x = 20; x < W; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 44);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 70; y < H; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(46,224,255,0.20)";
    ctx.lineWidth = 3;
    for (const drain of [{ x: 52, y: 462 }, { x: 724, y: 42 }, { x: 732, y: 470 }]) {
      ctx.beginPath();
      ctx.arc(drain.x, drain.y, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(drain.x, drain.y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(249,251,255,0.08)";
    roundedRect(516, 48, 104, 32, 6);
    ctx.fill();
    roundedRect(34, 312, 92, 28, 6);
    ctx.fill();
    ctx.restore();
  }

  function drawSewerTexture() {
    ctx.save();
    ctx.strokeStyle = "rgba(107,255,125,0.14)";
    ctx.lineWidth = 18;
    for (const pipe of [{ y: 54, r: 25 }, { y: 484, r: 32 }]) {
      ctx.beginPath();
      ctx.moveTo(0, pipe.y);
      ctx.quadraticCurveTo(210, pipe.y + pipe.r, 420, pipe.y);
      ctx.quadraticCurveTo(610, pipe.y - pipe.r, W, pipe.y + 6);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,212,59,0.22)";
    for (let x = 18; x < W; x += 42) {
      ctx.beginPath();
      ctx.moveTo(x, 488);
      ctx.lineTo(x + 18, 508);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(107,255,125,0.13)";
    for (const bubble of [{ x: 56, y: 116, r: 6 }, { x: 732, y: 262, r: 5 }, { x: 414, y: 464, r: 7 }, { x: 560, y: 142, r: 4 }]) {
      ctx.beginPath();
      ctx.arc(bubble.x, bubble.y + Math.sin(state.time * 2 + bubble.x) * 3, bubble.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRooftopTexture() {
    ctx.save();
    ctx.fillStyle = "rgba(5,7,13,0.42)";
    for (const building of [
      { x: 0, y: 402, w: 84, h: 118 },
      { x: 92, y: 430, w: 78, h: 90 },
      { x: 178, y: 386, w: 118, h: 134 },
      { x: 606, y: 382, w: 76, h: 138 },
      { x: 690, y: 416, w: 110, h: 104 },
    ]) {
      ctx.fillRect(building.x, building.y, building.w, building.h);
      ctx.fillStyle = "rgba(46,224,255,0.12)";
      for (let x = building.x + 10; x < building.x + building.w - 8; x += 22) {
        for (let y = building.y + 12; y < H - 10; y += 24) ctx.fillRect(x, y, 7, 10);
      }
      ctx.fillStyle = "rgba(5,7,13,0.42)";
    }
    ctx.strokeStyle = "rgba(255,20,144,0.34)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(654, 138);
    ctx.lineTo(654, 54);
    ctx.moveTo(654, 70);
    ctx.lineTo(614, 104);
    ctx.moveTo(654, 70);
    ctx.lineTo(694, 104);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,212,59,0.28)";
    ctx.lineWidth = 1;
    for (const star of [{ x: 56, y: 70 }, { x: 188, y: 42 }, { x: 450, y: 68 }, { x: 746, y: 42 }]) {
      ctx.beginPath();
      ctx.moveTo(star.x - 5, star.y);
      ctx.lineTo(star.x + 5, star.y);
      ctx.moveTo(star.x, star.y - 5);
      ctx.lineTo(star.x, star.y + 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMapBadge() {
    ctx.save();
    ctx.textAlign = "right";
    ctx.font = "800 10px JetBrains Mono, monospace";
    ctx.fillStyle = "rgba(5,7,13,0.68)";
    roundedRect(W - 178, 10, 158, 24, 6);
    ctx.fill();
    ctx.strokeStyle = activeLevel.palette.pathTrim;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = activeLevel.palette.pathTrim;
    ctx.fillText(`${activeLevel.name.toUpperCase()} · ${activeLevel.difficulty.toUpperCase()}`, W - 28, 26);
    ctx.restore();
  }

  function drawPath() {
    const palette = activeLevel.palette;
    const width = activeLevel.pathWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = width + 22;
    ctx.strokeStyle = "#02050a";
    strokePath();
    ctx.lineWidth = width;
    ctx.strokeStyle = palette.path;
    strokePath();
    ctx.lineWidth = width + 8;
    ctx.strokeStyle = "rgba(249,251,255,0.08)";
    strokePath();
    ctx.lineWidth = 6;
    ctx.strokeStyle = palette.pathTrim;
    ctx.setLineDash([24, 22]);
    ctx.lineDashOffset = -state.time * 58;
    strokePath();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    drawPathArrows();

    const entrance = pointAt(40);
    const exit = pointAt(Math.max(0, pathLength - 40));
    drawPortal(entrance.x, entrance.y, "IN", palette.accent);
    drawPortal(exit.x, exit.y, "EXIT", palette.exit);
  }

  function drawPathArrows() {
    ctx.save();
    ctx.fillStyle = activeLevel.palette.pathTrim;
    ctx.globalAlpha = 0.72;
    for (let d = 130 + (state.time * 40) % 160; d < pathLength - 90; d += 160) {
      const p = pointAt(d);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-10, -10);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-10, 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  function strokePath() {
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
  }

  function drawPortal(x, y, label, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = label === "IN" ? "rgba(255,20,144,0.24)" : "rgba(72,243,90,0.20)";
    ctx.strokeStyle = color;
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
      ctx.shadowBlur = tower ? 0 : hovering ? 18 : 9;
      ctx.shadowColor = activeLevel.palette.pad;
      ctx.fillStyle = tower ? "rgba(5,7,13,0.78)" : "rgba(5,7,13,0.50)";
      ctx.strokeStyle = hovering && !tower ? COLORS.yellow : tower ? "rgba(249,251,255,0.32)" : activeLevel.palette.pad;
      ctx.lineWidth = hovering ? 4 : 2;
      roundedRect(-26, -26, 52, 52, 9);
      ctx.fill();
      ctx.stroke();
      if (!tower) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = activeLevel.palette.accent;
        ctx.beginPath();
        ctx.moveTo(-11, 0);
        ctx.lineTo(11, 0);
        ctx.moveTo(0, -11);
        ctx.lineTo(0, 11);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
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
      drawTowerBase(tower, def);
      if (tower.kind === "camera") drawCameraTower(tower, def);
      if (tower.kind === "speaker") drawSpeakerTower(tower, def);
      if (tower.kind === "plunger") drawPlungerTower(tower, def);
      drawLevelPips(tower.x, tower.y + 33, tower.level, def.color);
    }
  }

  function drawTowerBase(tower, def) {
    ctx.save();
    ctx.translate(tower.x, tower.y);
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.beginPath();
    ctx.ellipse(0, 24, 30, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.globalAlpha = 0.56;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 28 + Math.sin(state.time * 4 + tower.id) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
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

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 35, 24, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    if (enemy.slowTime > 0) {
      ctx.strokeStyle = "rgba(35,223,242,0.6)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 4, 31, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (enemy.kind === "shield") {
      ctx.strokeStyle = "rgba(247,217,36,0.72)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 2, 35, -0.35, Math.PI * 1.35);
      ctx.stroke();
      ctx.strokeStyle = "rgba(35,223,242,0.46)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 2, 41, 0.2, Math.PI * 1.1);
      ctx.stroke();
    }

    if (enemy.kind === "jet") {
      const flicker = Math.sin(enemy.wobble * 4) * 4;
      ctx.fillStyle = "rgba(35,223,242,0.78)";
      ctx.beginPath();
      ctx.moveTo(-18, 28);
      ctx.lineTo(-8, 28);
      ctx.lineTo(-14, 48 + flicker);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,20,144,0.6)";
      ctx.beginPath();
      ctx.moveTo(8, 28);
      ctx.lineTo(18, 28);
      ctx.lineTo(13, 44 - flicker);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = enemy.hitFlash > 0 ? COLORS.red : enemy.color;
    ctx.strokeStyle = "#05070d";
    ctx.lineWidth = 4;
    ctx.shadowBlur = enemy.kind === "boss" ? 18 : 8;
    ctx.shadowColor = enemy.kind === "boss" ? COLORS.yellow : "rgba(35,223,242,0.45)";
    roundedRect(-24, 0, 48, 33, 11);
    ctx.fill();
    ctx.shadowBlur = 0;
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

    if (enemy.kind === "chrome" || enemy.kind === "shield" || enemy.kind === "boss") {
      ctx.strokeStyle = "rgba(35,223,242,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-17, 9);
      ctx.lineTo(18, 5);
      ctx.moveTo(-15, 20);
      ctx.lineTo(16, 17);
      ctx.stroke();
    }

    if (enemy.kind === "cluster") {
      ctx.fillStyle = "#05070d";
      ctx.beginPath();
      ctx.arc(-14, 9, 4, 0, Math.PI * 2);
      ctx.arc(14, 9, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-15, 9, 9, 0, Math.PI * 2);
      ctx.arc(15, 9, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

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

    if (enemy.kind === "leaker") {
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.lineTo(0, -12);
      ctx.moveTo(-6, -18);
      ctx.lineTo(6, -18);
      ctx.stroke();
      ctx.fillStyle = "rgba(72,243,90,0.5)";
      ctx.beginPath();
      ctx.arc(18, 20 + Math.sin(enemy.wobble * 2), 4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (enemy.kind === "singer") {
      ctx.strokeStyle = COLORS.pink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(18, -24);
      ctx.lineTo(18, -40);
      ctx.quadraticCurveTo(28, -42, 29, -34);
      ctx.stroke();
    }

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
    const w = enemy.kind === "boss" ? 64 : enemy.kind === "shield" ? 48 : 40;
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
        applySlow(enemy, 2.8, 0.38);
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

    if (el.levelSelect) {
      el.levelSelect.querySelectorAll("[data-level]").forEach((button) => {
        button.addEventListener("click", () => selectLevel(button.dataset.level));
      });
    }

    canvas.addEventListener("click", handleCanvasClick);
    canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      event.preventDefault();
      handleCanvasClick(event);
    });
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

  function snapshot() {
    return JSON.parse(JSON.stringify({
      activeLevelId: activeLevel.id,
      state: {
        ...state,
        particles: state.particles.slice(0, 80),
        floats: state.floats.slice(0, 80),
      },
    }));
  }

  function restoreGame(saved) {
    const data = saved && saved.data;
    const savedState = data && data.state;
    if (!savedState) return;
    const level = LEVELS.find((item) => item.id === data.activeLevelId) || LEVELS[0];
    activeLevel = level;
    rebuildPathMetrics();
    Object.assign(state, {
      ...savedState,
      towers: Array.isArray(savedState.towers) ? savedState.towers : [],
      enemies: Array.isArray(savedState.enemies) ? savedState.enemies : [],
      projectiles: Array.isArray(savedState.projectiles) ? savedState.projectiles : [],
      particles: Array.isArray(savedState.particles) ? savedState.particles : [],
      floats: Array.isArray(savedState.floats) ? savedState.floats : [],
      queue: Array.isArray(savedState.queue) ? savedState.queue : [],
      running: true,
      paused: false,
      gameOver: false,
      lastTime: 0,
    });
    hideOverlay();
    updateHUD();
    updateLevelSelect();
    updateShop();
    updateInspector();
    if (!rafId) rafId = requestAnimationFrame(loop);
    draw();
  }

  function selectType(kind) {
    state.selectedType = kind;
    state.selectedTowerId = null;
    updateShop();
    updateInspector();
  }

  bindEvents();
  if (saveSlot) {
    saveMenu = saveSlot.attachButtons({
      primary: el.primary,
      scoreEl: el.overlayScore,
      continueLabel: "Continue defense",
      newLabel: "New defense",
      onContinue: restoreGame,
      summary: (saved) => {
        const data = saved.data || {};
        const savedState = data.state || {};
        return `${window.RBGameSaves.formatSavedAt(saved.savedAt)} · Wave <strong>${Number(savedState.wave || 1)}</strong> · Score <strong>${format(Number(savedState.score || 0))}</strong>`;
      },
    });
    saveSlot.startAutosave(snapshot, () => state.running && !state.gameOver);
  }
  updateHUD();
  updateInspector();
  showLevelIntro();
  draw();
})();
