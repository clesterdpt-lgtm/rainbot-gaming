/* ============================================
   ESCAPE THE STRAIT — A-Pop Demon Hunters
   --------------------------------------------
   Beat-based action parody. Pop stars vs demon elites.
   Sync attacks to the beat for 2x damage.
   Survive 3 stages. Defeat Lavish Larry.
   ============================================ */

(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const LANES = 4;
  const LANE_HEIGHT = H / LANES;

  // ----- Game state -----
  const state = {
    running: false,
    paused: false,
    gameOver: false,
    won: false,
    started: false,
    score: 0,
    combo: 0,
    hp: 100,
    maxHp: 100,
    stage: 1,            // 1..3
    stageTimer: 0,       // seconds in current stage
    stageLength: 30,     // seconds per stage
    enemies: [],
    boss: null,          // active boss
    bossPhase: 0,
    particles: [],
    notes: [],           // visual beat markers
    beatPhase: 0,        // 0..1 within current beat
    lastBeatTime: 0,
    beatPulse: 0,        // animation
    lastTime: 0,
    bpm: 110,
    inBeatWindow: false,
    shaking: 0,
    flash: 0,
    bgHue: 0,            // background stage color
    invulnTime: 0,       // seconds of invuln remaining
    dmgMult: 1,          // damage multiplier (boost power-up)
    bossSpawned: false,
    transition: 0,       // 0..1 stage transition fade
    transitioning: false,
    nextStage: 0,
    spawnTimer: 0,
    defeated: 0,         // enemies defeated
  };

  // ----- Player -----
  const player = {
    lane: 1,
    x: 80,
    y: 0,
    targetY: 0,
    swingT: 0,           // 0..1 swing animation
    swingCooldown: 0,
    specialCharge: 0,    // 0..1
  };

  // ----- Enemy types (parody "demon elites") -----
  const ENEMY_TYPES = [
    { name: "Lavish Larry Jr",  hp: 22, dmg: 6,  speed: 70,  color: "#f7d716", icon: "💰", lane: -1 },
    { name: "Davos Donna",       hp: 28, dmg: 8,  speed: 55,  color: "#ff2e88", icon: "🎀", lane: -1 },
    { name: "Tech Bro Trent",    hp: 24, dmg: 7,  speed: 85,  color: "#2ee0ff", icon: "📱", lane: -1 },
    { name: "Hedge Fund Henrietta", hp: 32, dmg: 10, speed: 50, color: "#a855f7", icon: "📊", lane: -1 },
    { name: "Media Mogul Mark",  hp: 26, dmg: 7,  speed: 75,  color: "#22c55e", icon: "📺", lane: -1 },
    { name: "Wokescold Wendy",   hp: 24, dmg: 7,  speed: 80,  color: "#fb923c", icon: "📢", lane: -1 },
  ];

  // ----- Boss: Lavish Larry -----
  const BOSS = {
    name: "Lavish Larry, Demon of Endless Foreclosure",
    icon: "👔",
    maxHp: 180,
    hp: 180,
    dmg: 12,
    x: 0,
    y: 0,
    lane: 1,
    color: "#f7d716",
    phase: 0,           // 0..2
    attackCooldown: 0,
    chargeTelegraph: 0, // 0..1 visual telegraph for charge
    attacking: false,
    attackLane: 0,
    facing: 1,          // 1 = facing right
    defeated: false,
  };

  // ----- Helpers -----
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function choose(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ----- Particle system -----
  function spawnHit(x, y, color, count = 8, speed = 200) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(50, speed);
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.3, 0.6),
        maxLife: 0.6,
        color,
        size: rand(3, 6),
      });
    }
  }

  function spawnText(x, y, text, color = "#f7d716") {
    state.particles.push({
      x, y,
      vx: 0,
      vy: -60,
      life: 1.0,
      maxLife: 1.0,
      color,
      text,
      size: 16,
    });
  }

  // ----- Spawn enemies -----
  function spawnEnemy(stage) {
    const types = ENEMY_TYPES.slice(0, Math.min(3 + stage, ENEMY_TYPES.length));
    const type = choose(types);
    const hpScale = 1 + (stage - 1) * 0.4;
    const speedScale = 1 + (stage - 1) * 0.15;
    state.enemies.push({
      type,
      x: W + 40,
      lane: randInt(0, LANES - 1),
      hp: Math.floor(type.hp * hpScale),
      maxHp: Math.floor(type.hp * hpScale),
      dmg: Math.floor(type.dmg * (1 + (stage - 1) * 0.2)),
      speed: type.speed * speedScale,
      color: type.color,
      icon: type.icon,
      name: type.name,
      hitFlash: 0,
      lastAtk: 0,
      wobble: 0,
    });
  }

  function spawnBoss() {
    state.boss = { ...BOSS, x: W - 130, y: H / 2 - 30, lane: 1, hp: BOSS.maxHp, maxHp: BOSS.maxHp, phase: 0, attackCooldown: 0, chargeTelegraph: 0, attacking: false, facing: 1 };
  }

  // ----- Beat -----
  const BEAT_MS = () => 60000 / state.bpm;
  function getBeatPhase(time) {
    return (time * 1000 % BEAT_MS()) / BEAT_MS();
  }
  function inBeatWindow() {
    const p = getBeatPhase(state.lastTime);
    return p < 0.18 || p > 0.82;
  }

  // ----- Combat -----
  function attack() {
    if (!state.running || state.paused || state.gameOver) return;
    if (player.swingCooldown > 0) return;
    player.swingT = 1;
    player.swingCooldown = 0.25;
    const onBeat = inBeatWindow();
    const baseDmg = 12;
    const dmg = baseDmg * state.dmgMult * (onBeat ? 2 : 1);

    const playerLane = player.lane;
    let hitAny = false;

    // Hit boss
    if (state.boss && !state.boss.defeated) {
      if (Math.abs(state.boss.lane - playerLane) <= 1 && Math.abs(state.boss.x - player.x) < 130) {
        state.boss.hp -= dmg;
        state.boss.chargeTelegraph = 0;
        spawnHit(state.boss.x, state.boss.y + 20, "#f7d716", 10);
        if (onBeat) {
          spawnText(state.boss.x, state.boss.y - 20, "PERFECT", "#22c55e");
        }
        state.score += (onBeat ? 80 : 30) * (state.combo + 1);
        state.combo++;
        state.flash = 0.1;
        hitAny = true;
        if (state.boss.hp <= 0) {
          state.boss.hp = 0;
          state.boss.defeated = true;
          state.score += 5000;
          spawnHit(state.boss.x, state.boss.y, "#f7d716", 60, 400);
          spawnText(W / 2, H / 2 - 60, "🎤 LAVISH LARRY DOWN", "#f7d716");
          setTimeout(() => {
            state.gameOver = true;
            state.won = true;
            onGameOver();
          }, 1500);
        }
      }
    }

    // Hit regular enemies
    for (const e of state.enemies) {
      if (Math.abs(e.lane - playerLane) <= 1 && e.x - player.x < 130 && e.x - player.x > -30) {
        e.hp -= dmg;
        e.hitFlash = 0.2;
        spawnHit(e.x, e.lane * LANE_HEIGHT + 30, e.color, 6);
        state.score += (onBeat ? 60 : 25) * (state.combo + 1);
        state.combo++;
        state.flash = 0.06;
        hitAny = true;
      }
    }
    state.enemies = state.enemies.filter(e => e.hp > 0);
    state.defeated += state.enemies.filter(e => e.hp > 0).length === 0 ? 0 : 0;

    if (hitAny) {
      state.shaking = Math.min(0.6, state.shaking + (onBeat ? 0.5 : 0.2));
      player.specialCharge = Math.min(1, player.specialCharge + (onBeat ? 0.15 : 0.08));
    } else {
      state.combo = Math.max(0, state.combo - 1);
    }
    updateHUD();
  }

  function special() {
    if (!state.running || state.paused || state.gameOver) return;
    if (player.specialCharge < 1) return;
    player.specialCharge = 0;
    state.combo = Math.max(state.combo, 5);
    let total = 0;
    for (const e of state.enemies) {
      e.hp -= 40;
      spawnHit(e.x, e.lane * LANE_HEIGHT + 30, "#f7d716", 8);
      total++;
    }
    if (state.boss && !state.boss.defeated) {
      state.boss.hp -= 30;
      spawnHit(state.boss.x, state.boss.y, "#f7d716", 30, 350);
      if (state.boss.hp <= 0) {
        state.boss.hp = 0;
        state.boss.defeated = true;
        state.score += 5000;
        setTimeout(() => {
          state.gameOver = true;
          state.won = true;
          onGameOver();
        }, 1500);
      }
    }
    state.enemies = state.enemies.filter(e => e.hp > 0);
    state.shaking = 1.2;
    state.flash = 0.2;
    spawnText(W / 2, 80, "💥 SURPRISE ALBUM DROP", "#ff2e88");
    state.score += 1000;
    updateHUD();
  }

  // ----- Movement -----
  function moveLane(dir) {
    if (!state.running || state.paused || state.gameOver) return;
    player.lane = clamp(player.lane + dir, 0, LANES - 1);
  }

  // ----- Update -----
  function update(dt) {
    if (state.transitioning) {
      state.transition += dt * 2;
      if (state.transition >= 1) {
        state.transition = 1;
        state.transitioning = false;
        state.stage = state.nextStage;
        state.stageTimer = 0;
        state.enemies = [];
        state.spawnTimer = 0;
        if (state.stage === 3 && !state.bossSpawned) {
          spawnBoss();
          state.bossSpawned = true;
        }
        spawnText(W / 2, H / 2, "STAGE " + state.stage, "#f7d716");
      }
      return;
    }

    if (state.transition > 0) {
      state.transition -= dt * 1.5;
      if (state.transition < 0) state.transition = 0;
    }

    state.stageTimer += dt;
    state.bgHue = (state.bgHue + dt * 8) % 360;
    state.beatPhase = getBeatPhase(state.lastTime);
    state.beatPulse = Math.max(0, state.beatPulse - dt * 4);

    if (state.shaking > 0) state.shaking = Math.max(0, state.shaking - dt * 2);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 3);
    if (state.invulnTime > 0) state.invulnTime -= dt;
    if (player.swingCooldown > 0) player.swingCooldown -= dt;
    if (player.swingT > 0) player.swingT = Math.max(0, player.swingT - dt * 4);

    // Player target Y
    player.targetY = player.lane * LANE_HEIGHT + LANE_HEIGHT / 2;
    player.y = lerp(player.y, player.targetY, 0.25);

    // Spawn regular enemies (only stages 1 and 2)
    if (state.stage < 3) {
      // Grace period at the start of each stage
      if (state.stageTimer < 3) {
        // Do nothing during grace
      } else {
        state.spawnTimer += dt;
        const spawnRate = Math.max(1.5, 2.8 - state.stage * 0.3);
        if (state.spawnTimer >= spawnRate) {
          state.spawnTimer = 0;
          spawnEnemy(state.stage);
          // Sometimes spawn a pair (less often in stage 1)
          if (state.stage >= 2 && Math.random() < 0.2) {
            setTimeout(() => {
              if (state.running && !state.gameOver) spawnEnemy(state.stage);
            }, 500);
          }
        }
      }
    }

    // Update regular enemies
    for (const e of state.enemies) {
      e.x -= e.speed * dt;
      e.wobble = (e.wobble || 0) + dt * 6;
      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.lastAtk > 0) e.lastAtk -= dt;
      // Hit player when in same lane and close
      if (e.lane === player.lane && e.x - player.x < 40 && e.x - player.x > -10 && e.lastAtk <= 0) {
        if (state.invulnTime <= 0) {
          state.hp -= e.dmg;
          state.combo = 0;
          e.lastAtk = 1.2;
          state.shaking = 0.4;
          state.flash = 0.15;
          spawnHit(player.x, player.y, "#ff2e88", 12);
          if (state.hp <= 0) {
            state.hp = 0;
            state.gameOver = true;
            onGameOver();
          }
          updateHUD();
        }
      }
      // Bounce off left wall — remove if past player
      if (e.x < -60) e.hp = 0;
    }
    state.enemies = state.enemies.filter(e => e.hp > 0);

    // Update boss
    if (state.boss && !state.boss.defeated) {
      const b = state.boss;
      // Phase progression
      const hpPct = b.hp / b.maxHp;
      b.phase = hpPct > 0.66 ? 0 : hpPct > 0.33 ? 1 : 2;

      // Bob
      b.y = H / 2 - 30 + Math.sin(state.stageTimer * 4) * (8 + b.phase * 4);

      // Move toward player slightly
      b.x = lerp(b.x, W - 130 - b.phase * 30, 0.02);

      // Attack patterns
      b.attackCooldown -= dt;
      if (b.attackCooldown <= 0) {
        // Choose a random lane to attack
        b.attackLane = randInt(0, LANES - 1);
        b.chargeTelegraph = 0.7;
        b.attackCooldown = Math.max(1.0, 2.5 - b.phase * 0.6);
      }
      if (b.chargeTelegraph > 0) {
        b.chargeTelegraph -= dt;
        if (b.chargeTelegraph <= 0) {
          // Slam that lane
          if (b.attackLane === player.lane && state.invulnTime <= 0) {
            state.hp -= b.dmg + b.phase * 5;
            state.combo = 0;
            state.shaking = 0.8;
            state.flash = 0.2;
            spawnHit(player.x, player.y, "#ff2e88", 24);
            if (state.hp <= 0) {
              state.hp = 0;
              state.gameOver = true;
              onGameOver();
            }
            updateHUD();
          }
          spawnHit(b.x, b.attackLane * LANE_HEIGHT + 30, "#f7d716", 16, 300);
        }
      }
    }

    // Stage progression
    if (state.stage < 3 && state.stageTimer >= state.stageLength) {
      if (state.enemies.length === 0) {
        state.transitioning = true;
        state.nextStage = state.stage + 1;
        state.transition = 0;
      }
    }

    // Particles
    for (const p of state.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (!p.text) p.vy += 200 * dt;
    }
    state.particles = state.particles.filter(p => p.life > 0);
  }

  // ----- Render -----
  function draw() {
    // Camera shake
    let sx = 0, sy = 0;
    if (state.shaking > 0) {
      sx = (Math.random() - 0.5) * state.shaking * 20;
      sy = (Math.random() - 0.5) * state.shaking * 20;
    }
    ctx.save();
    ctx.translate(sx, sy);

    // Stage background gradient
    const stageColors = [
      ["#0a0a14", "#1a0a2e"],  // stage 1
      ["#1a0a14", "#2a0a1e"],  // stage 2
      ["#1a1a0a", "#0a0a14"],  // stage 3 boss
    ];
    const [c1, c2] = stageColors[state.stage - 1] || stageColors[0];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // Spotlight cones
    ctx.fillStyle = `hsla(${(state.bgHue + 0) % 360}, 80%, 50%, 0.06)`;
    for (let i = 0; i < 4; i++) {
      const x = 100 + i * 200;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - 50, H);
      ctx.lineTo(x + 50, H);
      ctx.closePath();
      ctx.fill();
    }

    // Lane dividers
    for (let i = 1; i < LANES; i++) {
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.beginPath();
      ctx.moveTo(0, i * LANE_HEIGHT);
      ctx.lineTo(W, i * LANE_HEIGHT);
      ctx.stroke();
    }

    // Stage floor
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, H - 50, W, 50);

    // Crowd silhouette
    ctx.fillStyle = "#0a0a14";
    for (let i = 0; i < 40; i++) {
      const x = i * 22;
      const y = H - 20;
      ctx.fillRect(x, y, 12, 20);
      ctx.beginPath();
      ctx.arc(x + 6, y - 4, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    // Crowd glow / phone lights
    for (let i = 0; i < 40; i++) {
      const x = i * 22 + (Math.sin(state.stageTimer * 2 + i) * 2);
      const y = H - 28;
      ctx.fillStyle = `rgba(255, 220, 100, ${0.3 + Math.sin(state.stageTimer * 4 + i) * 0.2})`;
      ctx.fillRect(x, y, 3, 5);
    }

    // Stage lights bars
    ctx.fillStyle = `rgba(255, 200, 50, ${0.1 + Math.sin(state.stageTimer * 3) * 0.05})`;
    for (let i = 0; i < 8; i++) {
      const x = i * 100;
      ctx.fillRect(x, 0, 2, H - 50);
    }

    // Boss
    if (state.boss && !state.boss.defeated) {
      drawBoss(state.boss);
    }

    // Enemies
    for (const e of state.enemies) {
      drawEnemy(e);
    }

    // Player
    drawPlayer();

    // Beat indicator (right side)
    drawBeatIndicator();

    // Attack telegraph (lane under attack)
    if (state.boss && !state.boss.defeated && state.boss.chargeTelegraph > 0) {
      const a = state.boss.attackLane;
      ctx.fillStyle = `rgba(255, 46, 136, ${0.3 + state.boss.chargeTelegraph * 0.5})`;
      ctx.fillRect(0, a * LANE_HEIGHT, W, LANE_HEIGHT);
      ctx.strokeStyle = "#ff2e88";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, a * LANE_HEIGHT, W, LANE_HEIGHT);
    }

    // Particles
    for (const p of state.particles) {
      if (p.text) {
        ctx.globalAlpha = clamp(p.life * 1.5, 0, 1);
        ctx.fillStyle = p.color;
        ctx.font = "bold " + p.size + "px Bungee, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.text, p.x, p.y);
      } else {
        ctx.globalAlpha = clamp(p.life * 1.5, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;

    // Invuln flash overlay
    if (state.invulnTime > 0) {
      ctx.fillStyle = `rgba(34, 197, 94, ${0.2 + Math.sin(state.stageTimer * 20) * 0.1})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Flash
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${state.flash})`;
      ctx.fillRect(0, 0, W, H);
    }

    // HP bar (top under HUD)
    const hpW = 240;
    const hpX = 20;
    const hpY = H - 20;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(hpX - 2, hpY - 12, hpW + 4, 16);
    ctx.fillStyle = state.hp > 30 ? "#22c55e" : "#ef4444";
    ctx.fillRect(hpX, hpY - 10, hpW * (state.hp / state.maxHp), 12);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("HP " + state.hp, hpX + 4, hpY - 4);

    // Special charge bar
    if (player.specialCharge > 0) {
      const sx = hpX + hpW + 20;
      const sw = 120;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(sx - 2, hpY - 12, sw + 4, 16);
      ctx.fillStyle = "#f7d716";
      ctx.fillRect(sx, hpY - 10, sw * player.specialCharge, 12);
      ctx.fillStyle = "#0a0a14";
      ctx.font = "bold 10px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(player.specialCharge >= 1 ? "💥 NUKE READY (X)" : "NUKE " + Math.floor(player.specialCharge * 100) + "%", sx + sw / 2, hpY - 4);
    }

    // Stage transition
    if (state.transition > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${state.transition * 0.8})`;
      ctx.fillRect(0, 0, W, H);
      if (state.transition > 0.5) {
        const a = (state.transition - 0.5) * 2;
        ctx.fillStyle = `rgba(247, 215, 22, ${a})`;
        ctx.font = "bold 48px Bungee, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("STAGE " + state.nextStage, W / 2, H / 2);
        ctx.font = "20px Inter, sans-serif";
        ctx.fillText(state.nextStage === 3 ? "Final boss: Lavish Larry" : "Get ready for the next act", W / 2, H / 2 + 50);
      }
    }

    // Game over / win overlay
    if (state.gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.fillStyle = state.won ? "#f7d716" : "#ef4444";
      ctx.font = "bold 56px Bungee, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(state.won ? "🎤 STAGE COMPLETE" : "💀 GAME OVER", W / 2, H / 2 - 30);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px Inter, sans-serif";
      ctx.fillText("Score: " + state.score.toLocaleString(), W / 2, H / 2 + 30);
      ctx.font = "14px Inter, sans-serif";
      ctx.fillStyle = "#a8a8b8";
      ctx.fillText(state.won ? "Lavish Larry, Demon of Endless Foreclosure: defeated." : "The demon elite wins. For now.", W / 2, H / 2 + 60);
      ctx.fillStyle = "#f7d716";
      ctx.font = "bold 16px Inter, sans-serif";
      ctx.fillText("Click anywhere to play again", W / 2, H / 2 + 100);
    }

    ctx.restore();
  }

  function drawPlayer() {
    if (state.invulnTime > 0 && Math.floor(state.stageTimer * 20) % 2 === 0) return;
    const px = player.x;
    const py = player.y;

    // Body
    ctx.fillStyle = "#ec1a5e";
    ctx.beginPath();
    ctx.arc(px, py - 18, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f7d716";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Hair (pink swoosh)
    ctx.fillStyle = "#ff5c8a";
    ctx.beginPath();
    ctx.ellipse(px - 2, py - 38, 22, 10, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Face
    ctx.fillStyle = "#fde2c5";
    ctx.beginPath();
    ctx.arc(px, py - 18, 17, 0, Math.PI * 2);
    ctx.fill();

    // Star eyes
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(px - 8, py - 22, 3, 3);
    ctx.fillRect(px + 5, py - 22, 3, 3);
    ctx.fillStyle = "#f7d716";
    ctx.fillRect(px - 8, py - 22, 1, 1);
    ctx.fillRect(px + 5, py - 22, 1, 1);

    // Red lips
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(px - 5, py - 11, 10, 4);

    // Mic (right hand)
    ctx.save();
    ctx.translate(px + 18, py - 18);
    if (player.swingT > 0) {
      // Swing animation
      const swing = (1 - player.swingT) * Math.PI * 0.5;
      ctx.rotate(swing);
    }
    // Mic handle
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(-3, -3, 6, 22);
    // Mic head
    ctx.fillStyle = "#f7d716";
    ctx.beginPath();
    ctx.arc(0, -8, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ec1a5e";
    ctx.fillRect(-3, -10, 6, 4);
    ctx.restore();
  }

  function drawEnemy(e) {
    const ey = e.lane * LANE_HEIGHT + LANE_HEIGHT / 2;
    const wob = Math.sin(e.wobble) * 2;

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(e.x, ey + 28, 24, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body (suit)
    ctx.fillStyle = e.hitFlash > 0 ? "#fff" : e.color;
    ctx.beginPath();
    ctx.arc(e.x, ey - 14 + wob, 22, 0, Math.PI * 2);
    ctx.fill();

    // Sunglasses
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(e.x - 14, ey - 22 + wob, 11, 7);
    ctx.fillRect(e.x + 3, ey - 22 + wob, 11, 7);
    ctx.fillRect(e.x - 3, ey - 19 + wob, 6, 2);
    // Glare
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(e.x - 12, ey - 20 + wob, 3, 3);
    ctx.fillRect(e.x + 5, ey - 20 + wob, 3, 3);

    // Smirk
    ctx.strokeStyle = "#0a0a14";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e.x - 7, ey - 6 + wob);
    ctx.quadraticCurveTo(e.x, ey - 3 + wob, e.x + 7, ey - 6 + wob);
    ctx.stroke();

    // Icon above
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(e.icon, e.x, ey - 40 + wob);

    // HP bar
    if (e.hp < e.maxHp) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(e.x - 20, ey - 50 + wob, 40, 4);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(e.x - 20, ey - 50 + wob, 40 * (e.hp / e.maxHp), 4);
    }
  }

  function drawBoss(b) {
    const by = b.y;
    // Aura
    ctx.fillStyle = `rgba(247, 215, 22, ${0.1 + Math.sin(state.stageTimer * 4) * 0.05})`;
    ctx.beginPath();
    ctx.arc(b.x, by + 20, 70, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = b.chargeTelegraph > 0 ? "#ff2e88" : b.color;
    ctx.beginPath();
    ctx.arc(b.x, by + 20, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0a0a14";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Tie
    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.moveTo(b.x, by + 5);
    ctx.lineTo(b.x - 8, by + 10);
    ctx.lineTo(b.x - 4, by + 50);
    ctx.lineTo(b.x + 4, by + 50);
    ctx.lineTo(b.x + 8, by + 10);
    ctx.closePath();
    ctx.fill();

    // Sunglasses
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(b.x - 22, by - 5, 18, 10);
    ctx.fillRect(b.x + 4, by - 5, 18, 10);
    ctx.fillRect(b.x - 4, by, 8, 3);
    ctx.fillStyle = "rgba(247,215,22,0.5)";
    ctx.fillRect(b.x - 20, by - 3, 6, 4);
    ctx.fillRect(b.x + 6, by - 3, 6, 4);

    // Gold chains
    ctx.strokeStyle = "#f7d716";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x - 18, by + 5);
    ctx.quadraticCurveTo(b.x, by + 20, b.x + 18, by + 5);
    ctx.stroke();
    ctx.fillStyle = "#f7d716";
    ctx.beginPath();
    ctx.arc(b.x, by + 22, 5, 0, Math.PI * 2);
    ctx.fill();

    // Icon
    ctx.font = "28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("👔", b.x, by - 50);

    // Phase indicator
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("PHASE " + (b.phase + 1) + "/3", b.x, by - 70);

    // HP bar
    const hpW = 100;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(b.x - hpW / 2 - 2, by - 64, hpW + 4, 8);
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(b.x - hpW / 2, by - 62, hpW * (b.hp / b.maxHp), 4);
    ctx.fillStyle = "#f7d716";
    ctx.fillRect(b.x - hpW / 2, by - 58, hpW * (b.hp / b.maxHp), 2);
  }

  function drawBeatIndicator() {
    const cx = W - 60;
    const cy = H - 70;
    const radius = 32;
    const onBeat = inBeatWindow();
    const pulse = 1 + Math.sin(state.beatPhase * Math.PI * 2) * 0.1;

    // Outer ring
    ctx.strokeStyle = onBeat ? "#22c55e" : `rgba(255, 255, 255, ${0.2 + state.beatPhase})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * pulse, 0, Math.PI * 2);
    ctx.stroke();

    // Inner fill
    ctx.fillStyle = onBeat ? "rgba(34, 197, 94, 0.5)" : `rgba(247, 215, 22, ${0.2 + state.beatPhase * 0.5})`;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Strike zone indicator
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.75, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = onBeat ? "#22c55e" : "#fff";
    ctx.font = "bold 10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(onBeat ? "HIT Z!" : "BEAT", cx, cy);
    ctx.fillText("BPM " + state.bpm, cx, cy + radius + 14);
  }

  // ----- HUD -----
  function updateHUD() {
    document.getElementById("hud-score").textContent = state.score.toLocaleString();
    document.getElementById("hud-stage").textContent = state.stage + "/3";
    document.getElementById("hud-hp").textContent = state.hp;
    document.getElementById("hud-combo").textContent = state.combo + "x";
    document.getElementById("hud-high").textContent = RB.getHighScore("apop").toLocaleString();
  }

  // ----- Powerups -----
  function renderPowerups() {
    const slot = document.getElementById("powerups");
    const s = RB.state;
    const items = [
      { key: "shield", icon: "🛡", label: "Crowd Surf",   desc: "Invincible 5s" },
      { key: "boost",  icon: "⚡", label: "Power Note",   desc: "2x damage for 8s" },
      { key: "nuke",   icon: "💣", label: "Smash Hit",    desc: "All elites take 30 damage" },
    ];
    slot.innerHTML = items.map((it) => {
      const count = s.powerups[it.key] || 0;
      const have = count > 0;
      return `
        <button class="powerup ${have ? "" : "powerup--locked"}" data-key="${it.key}" title="${it.desc}">
          <span class="powerup__icon">${it.icon}</span>
          <span class="powerup__label">${it.label}</span>
          <span class="powerup__cost">${have ? "USE" : "AD"}</span>
        </button>
      `;
    }).join("");

    slot.querySelectorAll(".powerup").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key;
        if ((RB.state.powerups[key] || 0) > 0) {
          usePowerup(key);
        } else {
          RB.showRewarded().then((finished) => {
            if (finished) {
              RB.grantPowerup(key);
              RB.toast(`+1 ${btn.querySelector(".powerup__label").textContent} claimed!`, "good");
            }
          });
        }
      });
    });
  }

  function usePowerup(key) {
    if (!RB.consumePowerup(key)) return;
    if (key === "shield") {
      state.invulnTime = 5;
      spawnHit(player.x, player.y, "#22c55e", 24, 250);
      RB.toast("🛡 Crowd Surf! Invincible 5s", "good");
    } else if (key === "boost") {
      state.dmgMult = 2;
      setTimeout(() => { state.dmgMult = 1; }, 8000);
      RB.toast("⚡ Power Note! 2x damage for 8s", "good");
    } else if (key === "nuke") {
      let count = 0;
      for (const e of state.enemies) {
        e.hp -= 30;
        spawnHit(e.x, e.lane * LANE_HEIGHT + 30, "#f7d716", 6);
        count++;
      }
      if (state.boss && !state.boss.defeated) {
        state.boss.hp -= 30;
        spawnHit(state.boss.x, state.boss.y, "#f7d716", 20, 350);
        if (state.boss.hp <= 0) {
          state.boss.hp = 0;
          state.boss.defeated = true;
          state.score += 5000;
          setTimeout(() => {
            state.gameOver = true;
            state.won = true;
            onGameOver();
          }, 1500);
        }
      }
      state.enemies = state.enemies.filter(e => e.hp > 0);
      state.shaking = 0.6;
      RB.toast(`💣 Smash Hit! ${count} elites damaged`, "good");
    }
    updateHUD();
  }

  // ----- Game over -----
  function onGameOver() {
    RB.recordScore("apop", state.score);
    updateHUD();
  }

  // ----- Overlay helpers -----
  function showOverlay(title, sub, btn, extra) {
    const ov = document.getElementById("overlay");
    document.getElementById("overlay-title").textContent = title;
    document.getElementById("overlay-sub").innerHTML = sub;
    const scoreEl = document.getElementById("overlay-score");
    if (state.gameOver) {
      scoreEl.style.display = "block";
      scoreEl.innerHTML = (extra || "") + (extra ? "<br>" : "") + `Final: <strong style="color:var(--accent-3)">${state.score.toLocaleString()}</strong>`;
    } else {
      scoreEl.style.display = "none";
    }
    document.getElementById("btn-primary").textContent = btn;
    ov.classList.add("overlay--show");
  }
  function hideOverlay() { document.getElementById("overlay").classList.remove("overlay--show"); }

  // ----- Start / restart -----
  function startGame() {
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.won = false;
    state.started = true;
    state.score = 0;
    state.combo = 0;
    state.hp = 100;
    state.maxHp = 100;
    state.stage = 1;
    state.stageTimer = 0;
    state.enemies = [];
    state.boss = null;
    state.bossSpawned = false;
    state.particles = [];
    state.transition = 0;
    state.transitioning = false;
    state.nextStage = 0;
    state.spawnTimer = 0;
    state.dmgMult = 1;
    state.invulnTime = 0;
    state.shaking = 0;
    state.flash = 0;
    state.lastTime = 0;
    player.lane = 1;
    player.y = player.lane * LANE_HEIGHT + LANE_HEIGHT / 2;
    player.targetY = player.y;
    player.swingT = 0;
    player.swingCooldown = 0;
    player.specialCharge = 0;
    hideOverlay();
    updateHUD();
  }

  function pauseGame() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    document.getElementById("btn-pause").textContent = state.paused ? "Resume" : "Pause";
  }

  // ----- Input -----
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      e.preventDefault();
      moveLane(-1);
    } else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
      e.preventDefault();
      moveLane(1);
    } else if (e.key === "z" || e.key === "Z") {
      e.preventDefault();
      attack();
    } else if (e.key === "x" || e.key === "X") {
      e.preventDefault();
      special();
    }
  });

  // Click on overlay / game over to restart
  canvas.addEventListener("click", (e) => {
    if (state.gameOver) {
      startGame();
    }
  });

  function bindMobileButton(id, action) {
    const button = document.getElementById(id);
    if (!button) return;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      action();
    });
  }

  bindMobileButton("btn-lane-up", () => moveLane(-1));
  bindMobileButton("btn-lane-down", () => moveLane(1));
  bindMobileButton("btn-attack", attack);
  bindMobileButton("btn-special", special);

  // ----- Wire up buttons -----
  document.getElementById("btn-primary").addEventListener("click", () => {
    if (state.gameOver) {
      startGame();
    } else {
      startGame();
    }
  });
  document.getElementById("btn-pause").addEventListener("click", pauseGame);
  document.getElementById("btn-restart").addEventListener("click", () => {
    showOverlay("🎤 A-POP DEMON HUNTERS", "Restart the show?", "Take the stage");
  });

  // ----- Main loop -----
  let rafId = null;
  function loop(time) {
    if (!state.lastTime) state.lastTime = time;
    const dt = Math.min(0.05, (time - state.lastTime) / 1000);
    state.lastTime = time;
    if (state.running && !state.paused) update(dt);
    draw();
    rafId = requestAnimationFrame(loop);
  }

  // ----- Init -----
  RB.subscribe(renderPowerups);
  updateHUD();
  renderPowerups();
  draw();
  rafId = requestAnimationFrame(loop);
})();
