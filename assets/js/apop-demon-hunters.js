/* ============================================
   APOP DEMON MOGGERS
   --------------------------------------------
   2D side-scrolling platformer-shooter parody.
   K-pop had demon HUNTERS. America has demon MOGGERS.
   Run, jump, and blast demons back to the group chat
   with your Mog Beam. Survive 3 stages, then disband
   the demon boy band "Boyz II Hell" and their frontman
   Lucifer Lipsync. Stay on beat for bonus damage.

   Parody / satire. All characters fictional.
   Debug hook: window.__APOP
   ============================================ */

(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;   // 750
  const H = canvas.height;  // 500

  // ----- World / physics constants -----
  const GROUND_Y = H - 64;        // y of the stage floor surface
  const GRAVITY = 2400;           // px/s^2
  const MAX_RUN = 270;            // px/s
  const RUN_ACCEL = 2000;
  const RUN_FRICTION = 1900;
  const JUMP_V = 760;             // initial jump velocity
  const BEAM_SPEED = 640;
  const MAX_JUMPS = 2;

  // ----- Brand palette -----
  const PINK = "#ec1a5e";
  const HOT = "#ff5c8a";
  const CYAN = "#2ee0ff";
  const GOLD = "#f7d716";
  const GREEN = "#22c55e";

  // ----- Game state -----
  const state = {
    running: false,
    paused: false,
    gameOver: false,
    won: false,
    started: false,
    score: 0,
    combo: 0,
    comboTimer: 0,
    hp: 100,
    maxHp: 100,
    stage: 1,
    stageDef: null,
    enemies: [],
    beams: [],          // player projectiles
    hostiles: [],       // enemy/boss projectiles
    particles: [],
    boss: null,
    bossIntro: 0,       // boss entrance timer
    camX: 0,
    bgScroll: 0,
    lastTime: 0,
    shaking: 0,
    flash: 0,
    flashColor: "255,255,255",
    invulnTime: 0,      // powerup invuln
    hurtCd: 0,          // i-frames after a hit
    dmgMult: 1,
    mog: 0,             // special meter 0..1
    bpm: 124,
    beatPulse: 0,
    bannerText: "",
    bannerSub: "",
    bannerT: 0,
    transition: 0,
    transitioning: false,
    nextStage: 0,
    defeated: 0,
  };

  // ----- Player -----
  const player = {
    x: 80, y: GROUND_Y - 48,
    w: 30, h: 48,
    vx: 0, vy: 0,
    facing: 1,
    onGround: true,
    jumps: 0,
    shootCd: 0,
    shootT: 0,
    runPhase: 0,
    hitFlash: 0,
  };

  // ----- Held-key input -----
  const input = { left: false, right: false };

  // ----- Funny on-mog text -----
  const MOG_WORDS = ["MOGGED", "RATIO'D", "L + RATIO", "REJECTED", "CRINGE",
                     "GET MOGGED", "FLOPPED", "SO OVER", "UNSUBSCRIBED", "GYATT"];
  const HURT_WORDS = ["OW MY VIBE", "NOT SLAY", "RUDE", "MY EDGES!", "UNALIVED"];

  // ----- Enemy archetypes (American-pop demon parody) -----
  const ENEMY_TYPES = {
    imp:    { name: "Auto-Tune Imp",     hp: 18, dmg: 8,  speed: 95,  color: "#a855f7", icon: "🎤", w: 28, h: 40, behavior: "walk",  score: 100 },
    lackey: { name: "Lip-Sync Lackey",   hp: 14, dmg: 7,  speed: 165, color: "#fb923c", icon: "👄", w: 26, h: 38, behavior: "walk",  score: 120 },
    plant:  { name: "Industry Plant",    hp: 26, dmg: 10, speed: 0,   color: "#22c55e", icon: "🪴", w: 32, h: 44, behavior: "shoot", score: 160 },
    pig:    { name: "Pay-Pig Gremlin",   hp: 46, dmg: 12, speed: 70,  color: "#f472b6", icon: "🐷", w: 38, h: 46, behavior: "walk",  score: 200 },
    bat:    { name: "Stan-Account Bat",  hp: 16, dmg: 8,  speed: 130, color: "#2ee0ff", icon: "📱", w: 30, h: 26, behavior: "fly",   score: 150 },
  };

  // ----- Boss: Lucifer Lipsync, frontman of "Boyz II Hell" -----
  const BOSS_TAUNTS = [
    "We're going on tour… IN HELL.",
    "Smash that SUBSCRIBE or I smash YOU.",
    "I have nine million monthly listeners!",
    "You can't mog perfection, sweetie.",
    "This is my VILLAIN ERA.",
    "My label OWNS your soul.",
  ];

  // ----- Stage definitions -----
  // Each: name, sub, worldWidth, palette, platforms[], spawns[{x, type}], boss flag.
  function buildStages() {
    return [
      {
        name: "THE MALL FOOD COURT",
        sub: "A demon flash mob broke out by the Cinnabon.",
        worldWidth: 3200,
        sky: ["#1a0a2e", "#2a0a3e"],
        accent: PINK,
        platforms: [
          { x: 520, y: GROUND_Y - 110, w: 150, h: 16 },
          { x: 900, y: GROUND_Y - 150, w: 140, h: 16 },
          { x: 1500, y: GROUND_Y - 120, w: 170, h: 16 },
          { x: 1900, y: GROUND_Y - 175, w: 130, h: 16 },
          { x: 2350, y: GROUND_Y - 120, w: 160, h: 16 },
        ],
        spawns: [
          { x: 620, type: "imp" }, { x: 760, type: "imp" },
          { x: 1050, type: "lackey" }, { x: 1300, type: "plant" },
          { x: 1600, type: "imp" }, { x: 1640, type: "lackey" },
          { x: 1980, type: "bat" }, { x: 2200, type: "pig" },
          { x: 2500, type: "imp" }, { x: 2560, type: "lackey" }, { x: 2620, type: "imp" },
        ],
      },
      {
        name: "THE AWARDS-SHOW RED CARPET",
        sub: "They rigged the fan vote. Take it back.",
        worldWidth: 3600,
        sky: ["#0a1430", "#241038"],
        accent: CYAN,
        platforms: [
          { x: 480, y: GROUND_Y - 130, w: 140, h: 16 },
          { x: 820, y: GROUND_Y - 190, w: 120, h: 16 },
          { x: 1150, y: GROUND_Y - 130, w: 150, h: 16 },
          { x: 1550, y: GROUND_Y - 200, w: 120, h: 16 },
          { x: 1850, y: GROUND_Y - 140, w: 150, h: 16 },
          { x: 2300, y: GROUND_Y - 190, w: 130, h: 16 },
          { x: 2750, y: GROUND_Y - 130, w: 160, h: 16 },
        ],
        spawns: [
          { x: 560, type: "lackey" }, { x: 700, type: "plant" },
          { x: 980, type: "bat" }, { x: 1020, type: "bat" },
          { x: 1250, type: "pig" }, { x: 1450, type: "imp" }, { x: 1500, type: "lackey" },
          { x: 1800, type: "plant" }, { x: 1950, type: "bat" },
          { x: 2150, type: "pig" }, { x: 2380, type: "lackey" }, { x: 2440, type: "imp" },
          { x: 2700, type: "bat" }, { x: 2900, type: "pig" }, { x: 2960, type: "imp" }, { x: 3020, type: "lackey" },
        ],
      },
      {
        name: "BOYZ II HELL — THE REUNION TOUR",
        sub: "Final boss: Lucifer Lipsync.",
        worldWidth: 1500,            // small arena, then boss
        sky: ["#2a0608", "#120216"],
        accent: GOLD,
        platforms: [
          { x: 250, y: GROUND_Y - 150, w: 150, h: 16 },
          { x: 1050, y: GROUND_Y - 150, w: 150, h: 16 },
        ],
        spawns: [],
        boss: true,
      },
    ];
  }

  let STAGES = buildStages();

  // ----- Helpers -----
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function choose(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // ----- Beat (light pop-rhythm bonus) -----
  const BEAT_MS = () => 60000 / state.bpm;
  function beatPhase() { return (state.lastTime % BEAT_MS()) / BEAT_MS(); }
  function inBeatWindow() {
    const p = beatPhase();
    return p < 0.16 || p > 0.84;
  }

  // ----- Particles -----
  function spawnBurst(x, y, color, count = 8, speed = 220) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(40, speed);
      state.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60,
        life: rand(0.3, 0.7), maxLife: 0.7, color, size: rand(3, 7), grav: true,
      });
    }
  }
  function spawnConfetti(x, y, count = 14) {
    const cols = [PINK, CYAN, GOLD, HOT, GREEN, "#a855f7"];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(80, 320);
      state.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120,
        life: rand(0.6, 1.1), maxLife: 1.1, color: choose(cols), size: rand(3, 6), grav: true,
      });
    }
  }
  function spawnText(x, y, text, color = GOLD, size = 18) {
    state.particles.push({
      x, y, vx: rand(-20, 20), vy: -70, life: 1.0, maxLife: 1.0, color, text, size,
    });
  }

  // ----- Spawning enemies (lazy, as camera reveals them) -----
  function spawnEnemy(type, x) {
    const t = ENEMY_TYPES[type];
    const scale = 1 + (state.stage - 1) * 0.25;
    const e = {
      type,
      name: t.name, icon: t.icon, color: t.color, behavior: t.behavior,
      w: t.w, h: t.h,
      x, y: t.behavior === "fly" ? GROUND_Y - 170 : GROUND_Y - t.h,
      vx: 0, vy: 0,
      hp: Math.round(t.hp * scale), maxHp: Math.round(t.hp * scale),
      dmg: Math.round(t.dmg * (1 + (state.stage - 1) * 0.15)),
      speed: t.speed,
      score: t.score,
      hitFlash: 0, contactCd: 0, shootCd: rand(0.6, 1.6), wobble: rand(0, 6.28),
      bob: rand(0, 6.28),
    };
    state.enemies.push(e);
  }

  function activateSpawns() {
    if (!state.stageDef) return;
    const revealAt = state.camX + W + 60;
    for (const s of state.stageDef.spawns) {
      if (!s._done && s.x <= revealAt) {
        s._done = true;
        spawnEnemy(s.type, s.x);
      }
    }
  }

  function spawnBoss() {
    state.boss = {
      name: "Lucifer Lipsync",
      title: "Frontman of Boyz II Hell",
      x: state.stageDef.worldWidth - 150, y: GROUND_Y - 120,
      w: 90, h: 120,
      hp: 520, maxHp: 520,
      phase: 0,
      vx: 0, vy: 0,
      onGround: true, jumps: 0,
      atkCd: 1.6, action: "idle", actionT: 0,
      telegraph: 0, telegraphKind: "", leaped: false,
      facing: -1,
      hitFlash: 0, contactCd: 0,
      taunt: "", tauntT: 0,
      defeated: false, bob: 0,
    };
    state.bossIntro = 2.4;
  }

  function bossSay(msg, t = 2.4) {
    if (!state.boss) return;
    state.boss.taunt = msg;
    state.boss.tauntT = t;
  }

  // ----- Banner -----
  function showBanner(text, sub, t = 2.4) {
    state.bannerText = text;
    state.bannerSub = sub || "";
    state.bannerT = t;
  }

  // ----- Stage setup -----
  function loadStage(n) {
    state.stage = n;
    state.stageDef = STAGES[n - 1];
    state.camX = 0;
    state.enemies = [];
    state.beams = [];
    state.hostiles = [];
    state.boss = null;
    player.x = 80;
    player.y = GROUND_Y - player.h;
    player.vx = 0; player.vy = 0;
    player.onGround = true; player.jumps = 0;
    for (const s of state.stageDef.spawns) s._done = false;
    showBanner("STAGE " + n + " / 3", state.stageDef.name);
    if (state.stageDef.boss) {
      // brief arena, then boss appears
      spawnBoss();
      showBanner("BOSS", "Lucifer Lipsync — Boyz II Hell", 2.6);
    }
  }

  // ----- Combat: player shoots Mog Beam -----
  function shoot() {
    if (!state.running || state.paused || state.gameOver) return;
    if (player.shootCd > 0) return;
    player.shootCd = 0.2;
    player.shootT = 1;
    const onBeat = inBeatWindow();
    const dmg = 11 * state.dmgMult * (onBeat ? 1.7 : 1);
    const muzzleX = player.x + player.w / 2 + player.facing * 22;
    const muzzleY = player.y + 14;
    state.beams.push({
      x: muzzleX - 6, y: muzzleY - 6, w: 18, h: 12,
      vx: player.facing * BEAM_SPEED, vy: 0,
      life: 1.1, dmg, onBeat, hue: onBeat ? GREEN : HOT,
    });
    if (onBeat) {
      state.beatPulse = 1;
      spawnText(muzzleX, muzzleY - 18, "🎵", GREEN, 16);
    }
    spawnBurst(muzzleX, muzzleY, onBeat ? GREEN : HOT, 4, 120);
  }

  function gainMog(amt) { state.mog = clamp(state.mog + amt, 0, 1); }

  function bumpCombo() {
    state.combo++;
    state.comboTimer = 2.6;
  }

  function comboMult() { return 1 + Math.min(state.combo, 30) * 0.08; }

  // ----- Special: Mog Aura -----
  function special() {
    if (!state.running || state.paused || state.gameOver) return;
    if (state.mog < 1) return;
    state.mog = 0;
    state.shaking = 1.2;
    state.flash = 0.35; state.flashColor = "255,92,138";
    spawnConfetti(player.x + player.w / 2, player.y + 10, 40);
    spawnText(player.x + player.w / 2, player.y - 20, "💅 MOG AURA", PINK, 26);
    state.hostiles.length = 0; // wipe incoming projectiles
    const cx = player.x + player.w / 2;
    for (const e of state.enemies) {
      const d = Math.abs((e.x + e.w / 2) - cx);
      if (d < 360) {
        e.hp -= 90;
        e.hitFlash = 0.2;
        spawnBurst(e.x + e.w / 2, e.y + e.h / 2, PINK, 10);
      }
    }
    if (state.boss && !state.boss.defeated && Math.abs((state.boss.x + state.boss.w / 2) - cx) < 460) {
      state.boss.hp -= 70;
      state.boss.hitFlash = 0.3;
      spawnBurst(state.boss.x + state.boss.w / 2, state.boss.y + 40, PINK, 18);
      checkBossDeath();
    }
    cullEnemies();
    state.score += 500;
    updateHUD();
  }

  // ----- Jump -----
  function jump() {
    if (!state.running || state.paused || state.gameOver) return;
    if (player.jumps < MAX_JUMPS) {
      player.vy = -JUMP_V;
      player.jumps++;
      player.onGround = false;
      spawnBurst(player.x + player.w / 2, player.y + player.h, "#ffffff", 4, 90);
    }
  }

  // ----- Damage to player -----
  function hurtPlayer(amount, knock = 0) {
    if (state.invulnTime > 0 || state.hurtCd > 0 || state.gameOver) return;
    state.hp -= amount;
    state.hurtCd = 0.85;   // i-frames after a hit (forgiving when shoving through a crowd)
    state.combo = 0;
    state.shaking = Math.max(state.shaking, 0.5);
    state.flash = 0.18; state.flashColor = "255,46,136";
    player.hitFlash = 0.4;
    player.vx += knock;
    player.vy = Math.min(player.vy, -200);
    spawnBurst(player.x + player.w / 2, player.y + player.h / 2, PINK, 12);
    spawnText(player.x + player.w / 2, player.y - 14, choose(HURT_WORDS), PINK, 14);
    if (state.hp <= 0) {
      state.hp = 0;
      endGame(false);
    }
    updateHUD();
  }

  function onEnemyKilled(e) {
    state.score += Math.round(e.score * comboMult());
    state.defeated++;
    bumpCombo();
    gainMog(0.14);
    state.shaking = Math.max(state.shaking, 0.3);
    spawnConfetti(e.x + e.w / 2, e.y + e.h / 2, 12);
    spawnText(e.x + e.w / 2, e.y - 8, choose(MOG_WORDS), choose([GOLD, CYAN, GREEN, HOT]), 17);
  }

  function cullEnemies() {
    for (const e of state.enemies) {
      if (e.hp <= 0 && !e._dead) { e._dead = true; onEnemyKilled(e); }
    }
    state.enemies = state.enemies.filter(e => e.hp > 0 && e.x > state.camX - 360);
  }

  function checkBossDeath() {
    const b = state.boss;
    if (b && !b.defeated && b.hp <= 0) {
      b.hp = 0;
      b.defeated = true;
      state.score += 5000;
      state.shaking = 1.4;
      state.flash = 0.4; state.flashColor = "247,215,22";
      spawnConfetti(b.x + b.w / 2, b.y + 40, 60);
      spawnText(b.x + b.w / 2, b.y - 10, "DISBANDED 💔", GOLD, 26);
      setTimeout(() => endGame(true), 1700);
    }
  }

  // ----- Update -----
  function update(dt) {
    state.beatPulse = Math.max(0, state.beatPulse - dt * 3);
    if (state.shaking > 0) state.shaking = Math.max(0, state.shaking - dt * 1.8);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 2.2);
    if (state.invulnTime > 0) state.invulnTime -= dt;
    if (state.hurtCd > 0) state.hurtCd -= dt;
    if (state.bannerT > 0) state.bannerT -= dt;
    if (state.comboTimer > 0) { state.comboTimer -= dt; if (state.comboTimer <= 0) state.combo = 0; }
    if (state.bossIntro > 0) state.bossIntro -= dt;

    if (state.transitioning) {
      state.transition += dt * 1.6;
      if (state.transition >= 1) {
        state.transition = 1;
        state.transitioning = false;
        loadStage(state.nextStage);
      }
      return;
    }
    if (state.transition > 0) state.transition = Math.max(0, state.transition - dt * 1.4);

    updatePlayer(dt);
    activateSpawns();
    updateEnemies(dt);
    updateBoss(dt);
    updateBeams(dt);
    updateHostiles(dt);
    updateParticles(dt);
    updateCamera();
    checkStageClear();
  }

  function updatePlayer(dt) {
    // Horizontal accel/friction
    if (input.left && !input.right) {
      player.vx -= RUN_ACCEL * dt; player.facing = -1;
    } else if (input.right && !input.left) {
      player.vx += RUN_ACCEL * dt; player.facing = 1;
    } else {
      const f = RUN_FRICTION * dt;
      if (player.vx > 0) player.vx = Math.max(0, player.vx - f);
      else if (player.vx < 0) player.vx = Math.min(0, player.vx + f);
    }
    player.vx = clamp(player.vx, -MAX_RUN, MAX_RUN);

    // Gravity
    player.vy += GRAVITY * dt;
    if (player.vy > 1400) player.vy = 1400;

    const prevFeet = player.y + player.h;
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // World bounds
    const maxX = state.stageDef.worldWidth - player.w;
    player.x = clamp(player.x, 0, maxX);

    // Ground collision
    player.onGround = false;
    if (player.y + player.h >= GROUND_Y) {
      player.y = GROUND_Y - player.h;
      player.vy = 0; player.onGround = true; player.jumps = 0;
    }

    // One-way platform landing
    if (player.vy >= 0) {
      const feet = player.y + player.h;
      for (const p of state.stageDef.platforms) {
        if (player.x + player.w > p.x + 4 && player.x < p.x + p.w - 4) {
          if (prevFeet <= p.y + 2 && feet >= p.y) {
            player.y = p.y - player.h;
            player.vy = 0; player.onGround = true; player.jumps = 0;
            break;
          }
        }
      }
    }

    // Run animation
    if (player.onGround && Math.abs(player.vx) > 30) {
      player.runPhase += dt * (6 + Math.abs(player.vx) / 50);
    } else {
      player.runPhase = 0;
    }

    if (player.shootCd > 0) player.shootCd -= dt;
    if (player.shootT > 0) player.shootT = Math.max(0, player.shootT - dt * 4);
    if (player.hitFlash > 0) player.hitFlash -= dt;
  }

  function updateEnemies(dt) {
    const pcx = player.x + player.w / 2;
    for (const e of state.enemies) {
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.contactCd > 0) e.contactCd -= dt;
      e.wobble += dt * 6;
      const dir = (pcx < e.x + e.w / 2) ? -1 : 1;

      if (e.behavior === "walk") {
        e.vy += GRAVITY * dt;
        e.x += dir * e.speed * dt;
        e.y += e.vy * dt;
        if (e.y + e.h >= GROUND_Y) { e.y = GROUND_Y - e.h; e.vy = 0; }
      } else if (e.behavior === "fly") {
        e.bob += dt * 3;
        const targetY = player.y - 30 + Math.sin(e.bob) * 30;
        e.y = lerp(e.y, clamp(targetY, 40, GROUND_Y - e.h), 0.04);
        e.x += dir * e.speed * dt;
      } else if (e.behavior === "shoot") {
        // stationary; fire toward player if on screen
        const onScreen = e.x > state.camX - 40 && e.x < state.camX + W + 40;
        e.shootCd -= dt;
        if (onScreen && e.shootCd <= 0 && Math.abs(pcx - (e.x + e.w / 2)) < 520) {
          e.shootCd = rand(1.6, 2.4);
          fireHostile(e.x + e.w / 2, e.y + 8, "seed");
        }
      }

      // Contact damage
      if (e.contactCd <= 0 && aabb(player, e)) {
        e.contactCd = 0.8;
        hurtPlayer(e.dmg, dir * -140);
      }
    }
    cullEnemies();
  }

  function fireHostile(x, y, kind) {
    const pcx = player.x + player.w / 2;
    const pcy = player.y + player.h / 2;
    const dx = pcx - x, dy = pcy - y;
    const d = Math.hypot(dx, dy) || 1;
    const spd = kind === "disc" ? 360 : 300;
    state.hostiles.push({
      x: x - 8, y: y - 8, w: 16, h: 16,
      vx: dx / d * spd, vy: dy / d * spd,
      life: 3, dmg: kind === "disc" ? 12 : 10, kind, spin: 0,
    });
  }

  function updateBoss(dt) {
    const b = state.boss;
    if (!b || b.defeated) return;
    if (b.hitFlash > 0) b.hitFlash -= dt;
    if (b.tauntT > 0) b.tauntT -= dt;
    if (b.contactCd > 0) b.contactCd -= dt;
    b.bob += dt * 3;

    if (state.bossIntro > 0) {
      b.y = GROUND_Y - b.h + Math.sin(b.bob) * 4;
      return;
    }

    // Phase by HP
    const pct = b.hp / b.maxHp;
    const newPhase = pct > 0.66 ? 0 : pct > 0.33 ? 1 : 2;
    if (newPhase !== b.phase) {
      b.phase = newPhase;
      bossSay(choose(BOSS_TAUNTS));
      state.flash = 0.25; state.flashColor = "247,215,22";
    }

    // Gravity / ground for boss
    b.vy += GRAVITY * dt;
    b.y += b.vy * dt;
    if (b.y + b.h >= GROUND_Y) { b.y = GROUND_Y - b.h; b.vy = 0; b.onGround = true; }
    else b.onGround = false;

    const pcx = player.x + player.w / 2;
    b.facing = (pcx < b.x + b.w / 2) ? -1 : 1;

    // Action timer / AI
    b.atkCd -= dt;
    if (b.action === "idle") {
      // drift toward a comfortable distance from player
      const want = pcx + b.facing * -260;
      b.x = lerp(b.x, clamp(want, 40, state.stageDef.worldWidth - b.w - 40), 0.02);
      b.y = GROUND_Y - b.h + Math.sin(b.bob) * 4;
      if (b.atkCd <= 0) chooseBossAction();
    } else if (b.action === "throw") {
      b.actionT -= dt;
      if (b.actionT <= 0) {
        const n = 1 + b.phase;          // more discs in later phases
        for (let i = 0; i < n; i++) {
          setTimeout(() => {
            if (state.boss && !state.boss.defeated && !state.paused) {
              fireHostile(b.x + b.w / 2, b.y + 30, "disc");
            }
          }, i * 180);
        }
        bossSay(choose(BOSS_TAUNTS), 1.6);
        endBossAction(1.6 - b.phase * 0.3);
      }
    } else if (b.action === "stomp") {
      // telegraph -> leap -> slam shockwave
      b.actionT -= dt;
      if (b.telegraph > 0) {
        b.telegraph -= dt;
        b.y = GROUND_Y - b.h + Math.sin(b.bob * 3) * 3; // crouch wiggle
        if (b.telegraph <= 0) { b.vy = -600; b.onGround = false; b.leaped = true; }
      } else if (b.leaped && b.onGround) {
        // landed: shockwave
        b.leaped = false;
        state.shaking = 1.0;
        state.flash = 0.2; state.flashColor = "247,215,22";
        spawnBurst(b.x + b.w / 2, GROUND_Y, GOLD, 24, 320);
        if (player.onGround && Math.abs(pcx - (b.x + b.w / 2)) < 220) {
          hurtPlayer(18, (player.x < b.x ? -1 : 1) * 180);
        }
        endBossAction(1.4 - b.phase * 0.25);
      } else if (b.leaped) {
        // hop toward player while airborne
        b.x = lerp(b.x, clamp(pcx - b.w / 2, 40, state.stageDef.worldWidth - b.w - 40), 0.05);
      }
      if (b.actionT <= 0 && b.onGround) endBossAction(1.4); // failsafe
    } else if (b.action === "summon") {
      b.actionT -= dt;
      if (b.actionT <= 0) {
        spawnEnemy("bat", b.x - 30);
        spawnEnemy(b.phase >= 2 ? "pig" : "lackey", b.x + 30);
        bossSay("BACKUP DANCERS!", 1.4);
        endBossAction(1.6);
      }
    }

    // Contact damage
    if (b.contactCd <= 0 && aabb(player, b)) {
      b.contactCd = 0.9;
      hurtPlayer(14, (player.x < b.x ? -1 : 1) * 200);
    }
  }

  function chooseBossAction() {
    const b = state.boss;
    const r = Math.random();
    if (b.phase === 0) {
      if (r < 0.7) startThrow(); else startStomp();
    } else if (b.phase === 1) {
      if (r < 0.45) startThrow(); else if (r < 0.8) startStomp(); else startSummon();
    } else {
      if (r < 0.4) startThrow(); else if (r < 0.8) startStomp(); else startSummon();
    }
  }
  function startThrow() { state.boss.action = "throw"; state.boss.actionT = 0.5; }
  function startStomp() { const b = state.boss; b.action = "stomp"; b.actionT = 2.2; b.telegraph = 0.6; }
  function startSummon() { state.boss.action = "summon"; state.boss.actionT = 0.7; }
  function endBossAction(cd) { state.boss.action = "idle"; state.boss.atkCd = Math.max(0.6, cd); state.boss.telegraph = 0; }

  function updateBeams(dt) {
    for (const m of state.beams) {
      m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt;
      // hit enemies
      for (const e of state.enemies) {
        if (e.hp > 0 && aabb(m, e)) {
          e.hp -= m.dmg; e.hitFlash = 0.18;
          spawnBurst(m.x, m.y, e.color, 5, 120);
          bumpCombo(); gainMog(0.02);
          state.score += Math.round(6 * comboMult());
          m.life = 0;
          break;
        }
      }
      // hit boss
      if (m.life > 0 && state.boss && !state.boss.defeated && state.bossIntro <= 0 && aabb(m, state.boss)) {
        state.boss.hp -= m.dmg; state.boss.hitFlash = 0.12;
        spawnBurst(m.x, m.y, GOLD, 6, 140);
        bumpCombo(); gainMog(0.025);
        state.score += Math.round(10 * comboMult());
        if (m.onBeat) spawnText(m.x, m.y - 10, "PERFECT", GREEN, 13);
        m.life = 0;
        checkBossDeath();
      }
    }
    state.beams = state.beams.filter(m => m.life > 0 &&
      m.x > state.camX - 80 && m.x < state.camX + W + 80);
    cullEnemies();
    updateHUD();
  }

  function updateHostiles(dt) {
    for (const h of state.hostiles) {
      h.x += h.vx * dt; h.y += h.vy * dt; h.life -= dt; h.spin += dt * 12;
      if (aabb(h, player)) { h.life = 0; hurtPlayer(h.dmg, h.vx > 0 ? 120 : -120); }
    }
    state.hostiles = state.hostiles.filter(h => h.life > 0 &&
      h.x > state.camX - 120 && h.x < state.camX + W + 120 && h.y < H + 40);
  }

  function updateParticles(dt) {
    for (const p of state.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.grav) p.vy += 520 * dt;
    }
    state.particles = state.particles.filter(p => p.life > 0);
  }

  function updateCamera() {
    const target = player.x + player.w / 2 - W * 0.4;
    const maxCam = Math.max(0, state.stageDef.worldWidth - W);
    state.camX = clamp(lerp(state.camX, target, 0.12), 0, maxCam);
    state.bgScroll = state.camX;
  }

  function checkStageClear() {
    if (state.transitioning || state.gameOver) return;
    const def = state.stageDef;
    if (def.boss) return; // boss stage ends on boss death (endGame)
    // cleared when player reaches the end and remaining enemies are few/far
    if (player.x >= def.worldWidth - player.w - 30) {
      const ahead = state.enemies.length;
      if (ahead <= 1) {
        state.nextStage = state.stage + 1;
        state.transitioning = true;
        state.transition = 0;
        state.score += 1000;
        spawnText(player.x + 10, player.y - 20, "STAGE CLEAR +1000", GOLD, 18);
      }
    }
  }

  // ===================================================================
  //  RENDER
  // ===================================================================
  function draw() {
    let sx = 0, sy = 0;
    if (state.shaking > 0) {
      sx = (Math.random() - 0.5) * state.shaking * 18;
      sy = (Math.random() - 0.5) * state.shaking * 18;
    }
    ctx.save();
    ctx.translate(sx, sy);

    const def = state.stageDef || STAGES[0];
    drawBackground(def);

    const cam = state.camX;
    ctx.save();
    ctx.translate(-cam, 0);

    drawPlatforms(def);
    // entities
    for (const e of state.enemies) drawEnemy(e);
    if (state.boss && !state.boss.defeated) drawBoss(state.boss);
    for (const h of state.hostiles) drawHostile(h);
    drawBeams();
    drawPlayer();
    drawParticles();
    // goal flag (non-boss stages)
    if (!def.boss) drawGoal(def);

    ctx.restore(); // end world transform

    drawHUDOverlays(def);

    // flash
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(${state.flashColor}, ${state.flash})`;
      ctx.fillRect(-30, -30, W + 60, H + 60);
    }
    // invuln tint
    if (state.invulnTime > 0) {
      ctx.fillStyle = `rgba(34,197,94,${0.12 + Math.sin(state.lastTime / 60) * 0.06})`;
      ctx.fillRect(-30, -30, W + 60, H + 60);
    }

    drawBanner();
    drawTransition();
    if (state.gameOver) drawEndScreen();

    ctx.restore();
  }

  function drawBackground(def) {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, def.sky[0]);
    grad.addColorStop(1, def.sky[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(-30, -30, W + 60, H + 60);

    // moving spotlights from the rafters
    const t = state.lastTime / 1000;
    for (let i = 0; i < 4; i++) {
      const baseX = (i * 220 - (state.bgScroll * 0.15) % 220);
      const sway = Math.sin(t * 0.7 + i) * 60;
      const x = ((baseX % (W + 220)) + (W + 220)) % (W + 220) - 110;
      ctx.fillStyle = `hsla(${(t * 30 + i * 70) % 360}, 90%, 60%, 0.07)`;
      ctx.beginPath();
      ctx.moveTo(x + sway, -20);
      ctx.lineTo(x - 70, GROUND_Y);
      ctx.lineTo(x + 70, GROUND_Y);
      ctx.closePath();
      ctx.fill();
    }

    // far skyline (parallax 0.3)
    const off1 = (state.bgScroll * 0.3) % 160;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let i = -1; i < W / 80 + 2; i++) {
      const x = i * 80 - off1;
      const bh = 70 + ((i * 53) % 7) * 14;
      ctx.fillRect(x, GROUND_Y - bh, 60, bh);
    }
    // near skyline (parallax 0.55) with lit windows
    const off2 = (state.bgScroll * 0.55) % 130;
    for (let i = -1; i < W / 110 + 2; i++) {
      const x = i * 110 - off2;
      const bh = 120 + ((i * 31) % 5) * 22;
      ctx.fillStyle = "rgba(10,8,24,0.7)";
      ctx.fillRect(x, GROUND_Y - bh, 84, bh);
      ctx.fillStyle = `rgba(247,215,22,${0.18 + Math.sin(t * 2 + i) * 0.08})`;
      for (let wy = GROUND_Y - bh + 14; wy < GROUND_Y - 16; wy += 22) {
        for (let wx = x + 10; wx < x + 74; wx += 22) {
          if ((wx + wy + i) % 3 === 0) ctx.fillRect(wx, wy, 8, 10);
        }
      }
    }
  }

  function drawPlatforms(def) {
    // ground floor (tiled neon-edged stage)
    ctx.fillStyle = "#120a1e";
    ctx.fillRect(state.camX - 40, GROUND_Y, W + 80, H - GROUND_Y + 40);
    ctx.fillStyle = def.accent;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(state.camX - 40, GROUND_Y, W + 80, 3);
    ctx.globalAlpha = 1;
    // floor stripes
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    const stripeOff = state.camX % 60;
    for (let x = state.camX - stripeOff; x < state.camX + W + 60; x += 60) {
      ctx.fillRect(x, GROUND_Y + 8, 30, H - GROUND_Y);
    }
    // crowd silhouette bobbing along the floor
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    const cOff = state.camX % 26;
    for (let x = state.camX - cOff; x < state.camX + W + 26; x += 26) {
      const head = 6 + Math.sin(state.lastTime / 200 + x) * 2;
      ctx.beginPath();
      ctx.arc(x + 13, GROUND_Y + 18 - head, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // platforms
    for (const p of def.platforms) {
      ctx.fillStyle = "#241433";
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = def.accent;
      ctx.fillRect(p.x, p.y, p.w, 3);
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(p.x, p.y + p.h, p.w, 5);
    }
  }

  function drawGoal(def) {
    const gx = def.worldWidth - 24;
    const t = state.lastTime / 200;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(gx, GROUND_Y - 150, 4, 150);
    // sparkly banner
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(gx + 4, GROUND_Y - 150);
    ctx.lineTo(gx + 50 + Math.sin(t) * 4, GROUND_Y - 138);
    ctx.lineTo(gx + 4, GROUND_Y - 120);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0a0a14";
    ctx.font = "bold 10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("EXIT", gx + 24, GROUND_Y - 132);
  }

  function drawPlayer() {
    const flickr = state.hurtCd > 0 && Math.floor(state.lastTime / 60) % 2 === 0;
    if (flickr) return;
    const px = player.x + player.w / 2;
    const baseY = player.y + player.h;     // feet
    ctx.save();
    ctx.translate(px, baseY);
    ctx.scale(player.facing, 1);

    const run = player.runPhase;
    const legSwing = player.onGround ? Math.sin(run) * 8 : 6;
    const bodyBob = player.onGround ? Math.abs(Math.sin(run)) * 2 : 0;

    // Legs (sparkly boots)
    ctx.strokeStyle = "#3a1030";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-4, -16); ctx.lineTo(-4 - legSwing, 0);
    ctx.moveTo(4, -16); ctx.lineTo(4 + legSwing, 0);
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.fillRect(-7 - legSwing, -3, 8, 4);
    ctx.fillRect(0 + legSwing, -3, 8, 4);

    // Dress (neon pink triangle with gold trim)
    const topY = -48 + bodyBob;
    ctx.fillStyle = PINK;
    ctx.beginPath();
    ctx.moveTo(0, topY + 6);
    ctx.lineTo(-18, -10);
    ctx.lineTo(18, -10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2;
    ctx.stroke();
    // sparkle on dress
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(-2, topY + 16, 2, 2);
    ctx.fillRect(6, -4, 2, 2);
    ctx.fillRect(-9, -2, 2, 2);

    // Back arm (free hand, raised)
    ctx.strokeStyle = "#fde2c5";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-10, topY + 14);
    ctx.lineTo(-20, topY + 4 + Math.sin(run) * 3);
    ctx.stroke();

    // Head
    const hy = topY - 8;
    ctx.fillStyle = "#fde2c5";
    ctx.beginPath();
    ctx.arc(0, hy, 13, 0, Math.PI * 2);
    ctx.fill();
    // Hair (big cyan-to-pink pop swoosh)
    ctx.fillStyle = HOT;
    ctx.beginPath();
    ctx.ellipse(-2, hy - 9, 17, 11, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.ellipse(-12, hy - 2, 7, 13, 0.4, 0, Math.PI * 2);
    ctx.fill();
    // Face details
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(4, hy - 3, 3, 3);   // eye (facing forward-right)
    ctx.fillStyle = GOLD;
    ctx.fillRect(4, hy - 3, 1, 1);   // star glint
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(2, hy + 4, 7, 3);   // lips

    // Mic arm + mic (front hand)
    ctx.save();
    ctx.translate(12, topY + 14);
    if (player.shootT > 0) ctx.rotate(-0.5 + player.shootT * 0.3);
    ctx.strokeStyle = "#fde2c5";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-4, 0); ctx.lineTo(10, -4);
    ctx.stroke();
    // mic handle
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(10, -7, 5, 12);
    // mic head — glows on beat
    const beatGlow = state.beatPulse;
    ctx.fillStyle = beatGlow > 0.3 ? GREEN : GOLD;
    ctx.beginPath();
    ctx.arc(12, -10, 6 + beatGlow * 2, 0, Math.PI * 2);
    ctx.fill();
    if (player.shootT > 0.5) {
      ctx.fillStyle = "rgba(255,92,138,0.7)";
      ctx.beginPath();
      ctx.arc(20, -10, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // hit flash overlay
    if (player.hitFlash > 0) {
      ctx.globalAlpha = player.hitFlash;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(0, topY - 8, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawEnemy(e) {
    const cx = e.x + e.w / 2;
    const wob = Math.sin(e.wobble) * 2;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(cx, GROUND_Y - 2, e.w / 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // body
    ctx.fillStyle = e.hitFlash > 0 ? "#fff" : e.color;
    if (e.behavior === "fly") {
      // little floating phone-bat
      ctx.beginPath();
      ctx.ellipse(cx, e.y + e.h / 2 + wob, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // wings
      ctx.fillStyle = e.hitFlash > 0 ? "#fff" : "rgba(46,224,255,0.6)";
      const flap = Math.sin(state.lastTime / 80) * 6;
      ctx.beginPath();
      ctx.moveTo(cx - e.w / 2, e.y + 6 + wob);
      ctx.lineTo(cx - e.w / 2 - 12, e.y - 2 + flap + wob);
      ctx.lineTo(cx - e.w / 2, e.y + 16 + wob);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + e.w / 2, e.y + 6 + wob);
      ctx.lineTo(cx + e.w / 2 + 12, e.y - 2 + flap + wob);
      ctx.lineTo(cx + e.w / 2, e.y + 16 + wob);
      ctx.closePath(); ctx.fill();
    } else {
      // suited demon goon — rounded rect body
      roundRect(e.x, e.y + 4 + wob, e.w, e.h - 4, 8);
      ctx.fill();
      // little horns
      ctx.fillStyle = e.hitFlash > 0 ? "#fff" : "#7a1f1f";
      ctx.beginPath();
      ctx.moveTo(e.x + 5, e.y + 6 + wob); ctx.lineTo(e.x + 9, e.y - 4 + wob); ctx.lineTo(e.x + 12, e.y + 6 + wob);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(e.x + e.w - 12, e.y + 6 + wob); ctx.lineTo(e.x + e.w - 9, e.y - 4 + wob); ctx.lineTo(e.x + e.w - 5, e.y + 6 + wob);
      ctx.closePath(); ctx.fill();
    }

    // sunglasses + smirk
    const eyY = (e.behavior === "fly" ? e.y + 8 : e.y + 16) + wob;
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(cx - 12, eyY, 9, 5);
    ctx.fillRect(cx + 3, eyY, 9, 5);
    ctx.fillRect(cx - 3, eyY + 1, 6, 2);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(cx - 10, eyY + 1, 2, 2);
    ctx.fillStyle = "#0a0a14";
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#0a0a14";
    ctx.beginPath();
    ctx.moveTo(cx - 5, eyY + 11); ctx.quadraticCurveTo(cx, eyY + 9, cx + 5, eyY + 11);
    ctx.stroke();

    // icon
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(e.icon, cx, e.y - 8 + wob);

    // hp bar
    if (e.hp < e.maxHp) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(cx - 18, e.y - 22 + wob, 36, 4);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(cx - 18, e.y - 22 + wob, 36 * (e.hp / e.maxHp), 4);
    }
  }

  function drawBoss(b) {
    const cx = b.x + b.w / 2;
    const intro = state.bossIntro > 0;
    // aura
    ctx.fillStyle = `rgba(247,215,22,${0.08 + Math.sin(b.bob) * 0.04})`;
    ctx.beginPath();
    ctx.arc(cx, b.y + 50, 90, 0, Math.PI * 2);
    ctx.fill();

    // telegraph ring on stomp
    if (b.action === "stomp" && b.telegraph > 0) {
      ctx.strokeStyle = `rgba(247,215,22,${0.5 + b.telegraph})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, GROUND_Y, 220, Math.PI, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(cx, b.y);
    ctx.scale(b.facing, 1);

    // body (slick demon-idol suit)
    ctx.fillStyle = b.hitFlash > 0 ? "#fff" : "#1a0a1e";
    roundRectXY(-b.w / 2, 20, b.w, b.h - 20, 14); ctx.fill();
    // glowing red lapels
    ctx.fillStyle = b.hitFlash > 0 ? "#fff" : "#7a1f1f";
    ctx.beginPath();
    ctx.moveTo(-6, 26); ctx.lineTo(-22, 30); ctx.lineTo(-6, 80); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6, 26); ctx.lineTo(22, 30); ctx.lineTo(6, 80); ctx.closePath(); ctx.fill();
    // gold chain
    ctx.strokeStyle = GOLD; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-16, 28); ctx.quadraticCurveTo(0, 50, 16, 28); ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.arc(0, 48, 6, 0, Math.PI * 2); ctx.fill();

    // head
    ctx.fillStyle = b.hitFlash > 0 ? "#fff" : "#c97b54";
    ctx.beginPath();
    ctx.arc(0, 6, 22, 0, Math.PI * 2);
    ctx.fill();
    // horns
    ctx.fillStyle = b.hitFlash > 0 ? "#fff" : "#7a1f1f";
    ctx.beginPath(); ctx.moveTo(-16, -8); ctx.lineTo(-26, -30); ctx.lineTo(-8, -12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(16, -8); ctx.lineTo(26, -30); ctx.lineTo(8, -12); ctx.closePath(); ctx.fill();
    // frosted-tips hair
    ctx.fillStyle = "#e5e7eb";
    ctx.beginPath();
    ctx.ellipse(0, -10, 20, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // shades
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(-18, 0, 15, 9);
    ctx.fillRect(3, 0, 15, 9);
    ctx.fillRect(-3, 2, 6, 3);
    ctx.fillStyle = "rgba(247,215,22,0.5)";
    ctx.fillRect(-15, 2, 5, 3);
    // smirk
    ctx.strokeStyle = "#3a0a0a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-7, 16); ctx.quadraticCurveTo(0, 22, 9, 14); ctx.stroke();

    // mic in hand
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(b.w / 2 - 8, 30, 6, 16);
    ctx.fillStyle = b.action === "throw" ? PINK : GOLD;
    ctx.beginPath(); ctx.arc(b.w / 2 - 5, 28, 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (!intro) {
      // name + HP bar fixed above boss in world space
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("👔 LUCIFER LIPSYNC — PHASE " + (b.phase + 1) + "/3", cx, b.y - 24);
      const hw = 130;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(cx - hw / 2 - 2, b.y - 20, hw + 4, 8);
      ctx.fillStyle = "#dc2626";
      ctx.fillRect(cx - hw / 2, b.y - 18, hw * (b.hp / b.maxHp), 4);
      ctx.fillStyle = GOLD;
      ctx.fillRect(cx - hw / 2, b.y - 14, hw * (b.hp / b.maxHp), 2);
    }

    // speech bubble taunt
    if (b.tauntT > 0) {
      drawSpeechBubble(cx, b.y - 36, b.taunt);
    }
  }

  function drawSpeechBubble(cx, cy, text) {
    ctx.font = "bold 12px Inter, sans-serif";
    const w = Math.min(260, ctx.measureText(text).width + 24);
    const h = 26;
    const x = clamp(cx - w / 2, state.camX + 8, state.camX + W - w - 8);
    const y = cy - h;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    roundRectXY(x, y, w, h, 8); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 6, y + h); ctx.lineTo(cx + 6, y + h); ctx.lineTo(cx, y + h + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#7a1f1f";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + h / 2);
  }

  function drawBeams() {
    for (const m of state.beams) {
      ctx.save();
      ctx.translate(m.x + m.w / 2, m.y + m.h / 2);
      // glowing musical note / heart bolt
      ctx.fillStyle = m.hue;
      ctx.globalAlpha = 0.4;
      ctx.beginPath(); ctx.ellipse(0, 0, m.w, m.h * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, m.w * 0.6, m.h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(-2, -1, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawHostile(h) {
    ctx.save();
    ctx.translate(h.x + h.w / 2, h.y + h.h / 2);
    ctx.rotate(h.spin);
    if (h.kind === "disc") {
      // flaming vinyl mixtape
      ctx.fillStyle = "#0a0a0a";
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#ff7a18"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
    } else {
      // industry-plant seed pod
      ctx.fillStyle = GREEN;
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#14532d";
      ctx.fillRect(-1, -8, 2, 5);
    }
    ctx.restore();
  }

  function drawParticles() {
    for (const p of state.particles) {
      const a = clamp(p.life / p.maxLife * 1.3, 0, 1);
      ctx.globalAlpha = a;
      if (p.text) {
        ctx.fillStyle = p.color;
        ctx.font = "bold " + p.size + "px Bungee, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  // screen-space HUD bars
  function drawHUDOverlays(def) {
    // HP bar
    const hpW = 220, hpX = 16, hpY = 16;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(hpX - 2, hpY - 2, hpW + 4, 18);
    ctx.fillStyle = state.hp > 30 ? GREEN : "#ef4444";
    ctx.fillRect(hpX, hpY, hpW * (state.hp / state.maxHp), 14);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("HP " + Math.max(0, Math.round(state.hp)), hpX + 6, hpY + 7);

    // Mog meter
    const mX = 16, mY = 38, mW = 220;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(mX - 2, mY - 2, mW + 4, 14);
    ctx.fillStyle = state.mog >= 1 ? PINK : "#a855f7";
    ctx.fillRect(mX, mY, mW * state.mog, 10);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.fillText(state.mog >= 1 ? "💅 MOG AURA READY (K / X)" : "MOG " + Math.floor(state.mog * 100) + "%", mX + 6, mY + 5);

    // Score + stage (top center) — keeps the count visible in max-screen mode
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "bold 16px Bungee, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(state.score.toLocaleString(), W / 2, 12);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.fillText("STAGE " + state.stage + "/3", W / 2, 32);

    // Combo (right)
    if (state.combo > 1) {
      ctx.fillStyle = GOLD;
      ctx.font = "bold 22px Bungee, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(state.combo + "x", W - 16, 14);
      ctx.fillStyle = HOT;
      ctx.font = "bold 10px JetBrains Mono, monospace";
      ctx.fillText("MOG STREAK", W - 16, 40);
    }

    // beat dot
    const onBeat = inBeatWindow();
    ctx.fillStyle = onBeat ? GREEN : "rgba(255,255,255,0.3)";
    ctx.beginPath();
    ctx.arc(W - 20, H - 20, 6 + (onBeat ? 3 : 0), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = onBeat ? GREEN : "rgba(255,255,255,0.4)";
    ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.fillText(onBeat ? "ON BEAT" : "🎵", W - 32, H - 20);

    // distance / progress (non-boss)
    if (!def.boss) {
      const prog = clamp(player.x / (def.worldWidth - player.w), 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(W / 2 - 70, H - 16, 140, 6);
      ctx.fillStyle = def.accent;
      ctx.fillRect(W / 2 - 70, H - 16, 140 * prog, 6);
    }
  }

  function drawBanner() {
    if (state.bannerT <= 0) return;
    const a = clamp(state.bannerT, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = GOLD;
    ctx.font = "bold 40px Bungee, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.bannerText, W / 2, H / 2 - 30);
    ctx.fillStyle = "#fff";
    ctx.font = "600 17px Inter, sans-serif";
    ctx.fillText(state.bannerSub, W / 2, H / 2 + 8);
    ctx.globalAlpha = 1;
  }

  function drawTransition() {
    if (state.transition <= 0) return;
    ctx.fillStyle = `rgba(0,0,0,${state.transition * 0.85})`;
    ctx.fillRect(-30, -30, W + 60, H + 60);
  }

  function drawEndScreen() {
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillRect(-30, -30, W + 60, H + 60);
    ctx.fillStyle = state.won ? GOLD : "#ef4444";
    ctx.font = "bold 46px Bungee, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.won ? "💅 DEMONS REJECTED" : "💀 OUT-MOGGED", W / 2, H / 2 - 56);
    ctx.fillStyle = "#fff";
    ctx.font = "600 18px Inter, sans-serif";
    ctx.fillText(state.won
      ? "Boyz II Hell disbanded. Lucifer's crying in the green room."
      : "The demon boy band goes platinum. For now.", W / 2, H / 2 - 12);
    ctx.fillStyle = CYAN;
    ctx.font = "bold 22px Inter, sans-serif";
    ctx.fillText("Score: " + state.score.toLocaleString(), W / 2, H / 2 + 26);
    ctx.fillStyle = "#a8a8b8";
    ctx.font = "14px Inter, sans-serif";
    ctx.fillText("High: " + RB.getHighScore("apop").toLocaleString(), W / 2, H / 2 + 52);
    ctx.fillStyle = GOLD;
    ctx.font = "bold 15px Inter, sans-serif";
    ctx.fillText("Click anywhere to run it back", W / 2, H / 2 + 88);
  }

  // ----- canvas rounded-rect helpers (use current path) -----
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function roundRectXY(x, y, w, h, r) { roundRect(x, y, w, h, r); }

  // ----- HUD -----
  function updateHUD() {
    document.getElementById("hud-score").textContent = state.score.toLocaleString();
    document.getElementById("hud-stage").textContent = state.stage + "/3";
    document.getElementById("hud-hp").textContent = Math.max(0, Math.round(state.hp));
    document.getElementById("hud-combo").textContent = state.combo + "x";
    document.getElementById("hud-high").textContent = RB.getHighScore("apop").toLocaleString();
  }

  // ----- Powerups (reuse site economy) -----
  function renderPowerups() {
    const slot = document.getElementById("powerups");
    if (!slot) return;
    const s = RB.state;
    const items = [
      { key: "shield", icon: "🛡", label: "Crowd Surf", desc: "Invincible 6s" },
      { key: "boost",  icon: "⚡", label: "Power Note", desc: "2x mog damage 8s" },
      { key: "nuke",   icon: "💣", label: "Encore Blast", desc: "Wipe demons on screen" },
    ];
    slot.innerHTML = items.map((it) => {
      const count = s.powerups[it.key] || 0;
      const have = count > 0;
      return `
        <button class="powerup ${have ? "" : "powerup--locked"}" data-key="${it.key}" title="${it.desc}">
          <span class="powerup__icon">${it.icon}</span>
          <span class="powerup__label">${it.label}</span>
          <span class="powerup__cost">${have ? "USE" : "AD"}</span>
        </button>`;
    }).join("");
    slot.querySelectorAll(".powerup").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        if ((RB.state.powerups[key] || 0) > 0) usePowerup(key);
        else RB.showRewarded().then((done) => {
          if (done) {
            RB.grantPowerup(key);
            RB.toast(`+1 ${btn.querySelector(".powerup__label").textContent} claimed!`, "good");
          }
        });
      });
    });
  }

  function usePowerup(key) {
    if (!RB.consumePowerup(key)) return;
    if (key === "shield") {
      state.invulnTime = 6;
      spawnConfetti(player.x + player.w / 2, player.y, 18);
      RB.toast("🛡 Crowd Surf! Invincible 6s", "good");
    } else if (key === "boost") {
      state.dmgMult = 2;
      clearTimeout(state._boostT);
      state._boostT = setTimeout(() => { state.dmgMult = 1; }, 8000);
      RB.toast("⚡ Power Note! 2x mog damage", "good");
    } else if (key === "nuke") {
      let n = 0;
      for (const e of state.enemies) { e.hp -= 60; e.hitFlash = 0.2; spawnBurst(e.x + e.w / 2, e.y + e.h / 2, GOLD, 8); n++; }
      if (state.boss && !state.boss.defeated) { state.boss.hp -= 50; state.boss.hitFlash = 0.3; checkBossDeath(); }
      state.hostiles.length = 0;
      state.shaking = 0.7;
      cullEnemies();
      RB.toast(`💣 Encore Blast! ${n} demons hit`, "good");
    }
    updateHUD();
  }

  // ----- Game lifecycle -----
  function endGame(won) {
    if (state.gameOver) return;
    state.gameOver = true;
    state.won = won;
    state.running = false;
    RB.recordScore("apop", state.score);
    updateHUD();
    showOverlayEnd(won);
  }

  function showOverlayEnd(won) {
    const ov = document.getElementById("overlay");
    document.getElementById("overlay-title").textContent = won ? "💅 DEMONS REJECTED" : "💀 OUT-MOGGED";
    document.getElementById("overlay-sub").innerHTML = won
      ? "You disbanded <strong>Boyz II Hell</strong> and out-mogged Lucifer Lipsync himself. America's pop divas remain undefeated."
      : "The demon boy band out-mogged you and went platinum. Run it back?";
    const scoreEl = document.getElementById("overlay-score");
    scoreEl.style.display = "block";
    scoreEl.innerHTML = `Score: <strong style="color:var(--accent-3)">${state.score.toLocaleString()}</strong> · High: ${RB.getHighScore("apop").toLocaleString()}`;
    document.getElementById("btn-primary").textContent = "Run it back";
    ov.classList.add("overlay--show");
  }

  function hideOverlay() { document.getElementById("overlay").classList.remove("overlay--show"); }

  function startGame() {
    STAGES = buildStages();
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.won = false;
    state.started = true;
    state.score = 0;
    state.combo = 0;
    state.comboTimer = 0;
    state.hp = 100;
    state.maxHp = 100;
    state.particles = [];
    state.beams = [];
    state.hostiles = [];
    state.shaking = 0;
    state.flash = 0;
    state.invulnTime = 0;
    state.hurtCd = 0;
    state.dmgMult = 1;
    state.mog = 0;
    state.lastTime = 0;
    state.transition = 0;
    state.transitioning = false;
    state.bossIntro = 0;
    player.shootCd = 0;
    player.shootT = 0;
    player.hitFlash = 0;
    loadStage(1);
    hideOverlay();
    updateHUD();
    canvas.focus();
  }

  function pauseGame() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    document.getElementById("btn-pause").textContent = state.paused ? "Resume" : "Pause";
  }

  // ----- Input -----
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") { input.left = true; e.preventDefault(); }
    else if (k === "arrowright" || k === "d") { input.right = true; e.preventDefault(); }
    else if (k === "arrowup" || k === "w" || k === " ") { if (!e.repeat) jump(); e.preventDefault(); }
    else if (k === "z" || k === "j") { e.preventDefault(); shoot(); }
    else if (k === "x" || k === "k") { e.preventDefault(); special(); }
    else if (k === "p") { pauseGame(); }
  });
  document.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") input.left = false;
    else if (k === "arrowright" || k === "d") input.right = false;
  });

  canvas.addEventListener("click", () => { if (state.gameOver) startGame(); });

  // Mobile controls
  function bindHold(id, on, off) {
    const b = document.getElementById(id);
    if (!b) return;
    const start = (ev) => { ev.preventDefault(); on(); };
    const end = (ev) => { ev.preventDefault(); if (off) off(); };
    b.addEventListener("pointerdown", start);
    b.addEventListener("pointerup", end);
    b.addEventListener("pointerleave", end);
    b.addEventListener("pointercancel", end);
  }
  bindHold("btn-left", () => { input.left = true; }, () => { input.left = false; });
  bindHold("btn-right", () => { input.right = true; }, () => { input.right = false; });
  function bindTap(id, fn) {
    const b = document.getElementById(id);
    if (!b) return;
    b.addEventListener("pointerdown", (ev) => { ev.preventDefault(); fn(); });
  }
  bindTap("btn-jump", jump);
  bindTap("btn-mog", shoot);
  bindTap("btn-special", special);

  // ----- Max screen (fullscreen) -----
  const fsBtn = document.getElementById("btn-fullscreen");
  const fsTarget = canvas.closest(".canvas-wrap") || canvas.parentElement;

  function isMaxed() { return fsTarget.classList.contains("is-maxed"); }
  function nativeFsEl() { return document.fullscreenElement || document.webkitFullscreenElement; }

  function updateFsBtn() {
    if (!fsBtn) return;
    const on = isMaxed();
    fsBtn.textContent = on ? "✕" : "⛶";
    fsBtn.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
    fsBtn.setAttribute("title", on ? "Exit" : "Max screen");
  }

  function setMaxed(on) {
    fsTarget.classList.toggle("is-maxed", on);
    updateFsBtn();
    // let main.js re-fit any non-maximized canvases
    window.dispatchEvent(new Event("resize"));
    if (on) canvas.focus();
  }

  function toggleFullscreen() {
    const on = !isMaxed();
    setMaxed(on);
    // Pair with the native Fullscreen API where supported (hides browser chrome).
    // The .is-maxed class is what actually drives layout, so this is best-effort.
    if (on) {
      const req = fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen;
      if (req) {
        try {
          const ret = req.call(fsTarget);
          if (ret && ret.catch) ret.catch(() => {}); // ignore rejection; pseudo-fullscreen still applies
        } catch (e) { /* pseudo-fullscreen still applies */ }
      }
    } else if (nativeFsEl()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) { try { exit.call(document); } catch (e) {} }
    }
  }

  if (fsBtn) fsBtn.addEventListener("click", toggleFullscreen);

  // If the user leaves native fullscreen (e.g. Esc / system gesture), drop pseudo too.
  function onNativeFsChange() {
    if (!nativeFsEl() && isMaxed()) { setMaxed(false); }
  }
  document.addEventListener("fullscreenchange", onNativeFsChange);
  document.addEventListener("webkitfullscreenchange", onNativeFsChange);
  // Esc exits pseudo-fullscreen when the native API isn't engaged.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isMaxed() && !nativeFsEl()) setMaxed(false);
  });
  updateFsBtn();

  // Buttons
  document.getElementById("btn-primary").addEventListener("click", startGame);
  document.getElementById("btn-pause").addEventListener("click", pauseGame);
  document.getElementById("btn-restart").addEventListener("click", () => {
    state.running = false;
    state.gameOver = false;
    const ov = document.getElementById("overlay");
    document.getElementById("overlay-title").textContent = "🎤 APOP DEMON MOGGERS";
    document.getElementById("overlay-sub").innerHTML = OVERLAY_INTRO;
    document.getElementById("overlay-score").style.display = "none";
    document.getElementById("btn-primary").textContent = "Take the stage";
    ov.classList.add("overlay--show");
  });

  const OVERLAY_INTRO = document.getElementById("overlay-sub") ? document.getElementById("overlay-sub").innerHTML : "";

  // ----- Main loop -----
  function loop(time) {
    const dt = loop._t ? Math.min(0.04, (time - loop._t) / 1000) : 0;
    loop._t = time;
    state.lastTime += dt * 1000;   // visual + beat clock, always advancing
    if (state.running && !state.paused) update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // ----- Init -----
  RB.subscribe(renderPowerups);
  updateHUD();
  renderPowerups();
  state.stageDef = STAGES[0];
  draw();
  requestAnimationFrame(loop);

  // ----- Debug hook (preview-driven testing) -----
  window.__APOP = {
    state, player,
    get enemies() { return state.enemies; },
    get boss() { return state.boss; },
    start: startGame,
    pause: pauseGame,
    god(on = true) { state.invulnTime = on ? 1e9 : 0; },
    fillMog() { state.mog = 1; },
    hurt(n = 20) { hurtPlayer(n); },
    skipToBoss() {
      startGame();
      state.score = 1000;
      loadStage(3);
    },
    killStage() { for (const e of state.enemies) e.hp = 0; cullEnemies(); },
    damageBoss(n = 100) { if (state.boss) { state.boss.hp -= n; checkBossDeath(); } },
    win() { if (state.boss) { state.boss.hp = 0; checkBossDeath(); } else endGame(true); },
    teleport(x) { player.x = x; },
  };
})();
