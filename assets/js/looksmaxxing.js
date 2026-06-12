/* ============================================
   LOOKSMAXXING GRINDSET
   --------------------------------------------
   Parody clicker. Click GRIND. Build routines.
   Evolve from basement arc to mirror final boss.
   ============================================ */

(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const STAT_CAP = 240;
  const WIN_LOOKSMAX = 100;
  const DAY_LENGTH = 10;
  const TOTAL_DAYS = 30;
  const IDLE_DRAIN_DELAY = 2.2;
  const IDLE_STAT_DRAIN = 1.05;
  const IDLE_SCORE_DRAIN = 42;
  const CHARACTER_STAGE_BASE = "../assets/img/looksmaxxing/character-stages";

  // ----- Game state -----
  const state = {
    running: false,
    paused: false,
    gameOver: false,
    started: false,
    won: false,
    clicks: 0,
    combo: 0,
    lastClickTime: 0,
    comboWindow: 1.5,
    score: 0,                  // total tier-up score
    stats: { gym: 0, mewing: 0, jawline: 0, skincare: 0, sleep: 0, nofap: 0 },
    baseDecay: 0.42,           // stat points lost per second
    lastTime: 0,
    clickPower: 1,
    decayImmune: 0,           // seconds of immunity
    lastBoostUsed: 0,
    currentEvent: null,
    eventCooldown: 0,
    flash: 0,
    shake: 0,
    particles: [],
    auraSize: 0,
    maxTier: 0,
    playTime: 0,
    day: 1,
    routineIndex: 0,
    recentRoutine: null,
    grindPulse: 0,
    comboPulse: 0,
    idleDrain: 0,
    idleWarning: 0,
    flashColor: "#ffffff",
    lastScoreDelta: 0,
    scoreDeltaTimer: 0,
    ending: false,
  };

  // ----- Stat metadata -----
  const STAT_META = [
    { key: "gym",      label: "GYM",      icon: "🏋️", color: "#ff5c5c", y: 0 },
    { key: "mewing",   label: "MEWING",   icon: "👅", color: "#ff2e88", y: 1 },
    { key: "jawline",  label: "JAWLINE",  icon: "🦷", color: "#b36bff", y: 2 },
    { key: "skincare", label: "SKINCARE", icon: "🧴", color: "#2ee0ff", y: 3 },
    { key: "sleep",    label: "SLEEP",    icon: "😴", color: "#f7d716", y: 4 },
    { key: "nofap",    label: "NOFAP",    icon: "🚫", color: "#6bff7d", y: 5 },
  ];

  const ROUTINES = [
    { label: "Push day", stats: ["gym", "jawline"], color: "#ff5c5c" },
    { label: "Mirror reps", stats: ["mewing", "jawline"], color: "#ff2e88" },
    { label: "Serum stack", stats: ["skincare", "sleep"], color: "#2ee0ff" },
    { label: "Sleepmaxx", stats: ["sleep", "nofap"], color: "#f7d716" },
    { label: "Hydration arc", stats: ["skincare", "gym"], color: "#6bff7d" },
    { label: "Silent walk", stats: ["nofap", "mewing"], color: "#b36bff" },
  ];

  const characterStageImages = Array.from({ length: 10 }, (_, i) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (!state.running) draw();
    };
    img.src = `${CHARACTER_STAGE_BASE}/looksmax-stage-${String(i + 1).padStart(2, "0")}.png`;
    return img;
  });

  // ----- Tier definitions -----
  const TIERS = [
    { min: 0,  num: 1,  title: "BASEMENT ARC",      color: "#777788" },
    { min: 10, num: 2,  title: "BEDHEAD",           color: "#8f94aa" },
    { min: 20, num: 3,  title: "PUMP PENDING",      color: "#a8a8d4" },
    { min: 30, num: 4,  title: "NORMIE CUT",        color: "#cdcdcd" },
    { min: 40, num: 5,  title: "SKIN GLOW",         color: "#6bff7d" },
    { min: 50, num: 6,  title: "JAWLINE LOADING",   color: "#2ee0ff" },
    { min: 60, num: 7,  title: "CHAD LITE",         color: "#f7d716" },
    { min: 70, num: 8,  title: "CHAD",              color: "#ff8c1a" },
    { min: 82, num: 9,  title: "GIGACHAD",          color: "#ff2e88" },
    { min: 94, num: 10, title: "MIRROR FINAL BOSS", color: "#ffd700" },
  ];

  function getTier(score) {
    let t = TIERS[0];
    for (const tier of TIERS) {
      if (score >= tier.min) t = tier;
    }
    return t;
  }

  function getLooksmax() {
    const sum = Object.values(state.stats).reduce((a, b) => a + b, 0);
    return Math.min(100, Math.round((sum / (STAT_CAP * STAT_META.length)) * 100));
  }

  function clampStat(value) {
    return Math.max(0, Math.min(STAT_CAP, value));
  }

  function getDayProgress() {
    return Math.min(1, (state.day - 1) / (TOTAL_DAYS - 1));
  }

  // ----- Event templates -----
  const EVENTS = [
    { tone: "good", icon: "😊", text: "She said you have a nice smile", impact: "+stats", effect: () => { bumpAll(2); addScore(80); } },
    { tone: "bad", icon: "😴", text: "Your mom said you look tired", impact: "-stats -score", effect: () => { bumpAll(-3); damageScore(130); } },
    { tone: "good", icon: "💊", text: "You discovered creatine", impact: "+gym", effect: () => { state.stats.gym = clampStat(state.stats.gym + 8); addScore(60); } },
    { tone: "bad", icon: "🤡", text: "You forgot your supplements", impact: "-stats -score", effect: () => { bumpAll(-4); damageScore(180); } },
    { tone: "good", icon: "💪", text: "Someone called you gigachad", impact: "+stats", effect: () => { bumpAll(3); addScore(90); } },
    { tone: "bad", icon: "📱", text: "You stayed up late on TikTok", impact: "-sleep -score", effect: () => { hitStats(["sleep", "nofap"], 12); damageScore(220); } },
    { tone: "bad", icon: "🍕", text: "You ate a whole pizza standing up", impact: "-stats -score", effect: () => { bumpAll(-5); damageScore(190); } },
    { tone: "good", icon: "💕", text: "You went on a date", impact: "+stats", effect: () => { bumpAll(2); addScore(70); } },
    { tone: "bad", icon: "📸", text: "Bad lighting front camera incident", impact: "-jaw -skin -score", effect: () => { hitStats(["jawline", "skincare"], 14); damageScore(260); } },
    { tone: "good", icon: "🎥", text: "You saw a video of a man yelling", impact: "+mewing +jaw", effect: () => { state.stats.mewing = clampStat(state.stats.mewing + 8); state.stats.jawline = clampStat(state.stats.jawline + 5); addScore(60); } },
    { tone: "good", icon: "💇", text: "You tried a new haircut", impact: "+jaw +skin", effect: () => { state.stats.jawline = clampStat(state.stats.jawline + 5); state.stats.skincare = clampStat(state.stats.skincare + 5); addScore(70); } },
    { tone: "good", icon: "😂", text: "She laughed at your joke", impact: "+stats", effect: () => { bumpAll(1); addScore(45); } },
    { tone: "bad", icon: "📷", text: "Your friend took a better photo", impact: "-stats -score", effect: () => { bumpAll(-3); damageScore(160); } },
    { tone: "good", icon: "🥶", text: "You took a cold shower", impact: "+sleep +gym", effect: () => { state.stats.sleep = clampStat(state.stats.sleep + 6); state.stats.gym = clampStat(state.stats.gym + 4); addScore(55); } },
    { tone: "good", icon: "🧘", text: "You tried meditating", impact: "+sleep +mewing", effect: () => { state.stats.sleep = clampStat(state.stats.sleep + 7); state.stats.mewing = clampStat(state.stats.mewing + 3); addScore(65); } },
    { tone: "good", icon: "👑", text: "You walked into a room and people noticed", impact: "+stats", effect: () => { bumpAll(4); addScore(120); } },
    { tone: "good", icon: "🪞", text: "The mirror finally respected you", impact: "+stats", effect: () => { bumpAll(5); addScore(150); } },
    { tone: "good", icon: "🧃", text: "You drank exactly enough water", impact: "+skin +sleep", effect: () => { state.stats.skincare = clampStat(state.stats.skincare + 8); state.stats.sleep = clampStat(state.stats.sleep + 3); addScore(55); } },
    { tone: "bad", icon: "🧢", text: "Hat phase delayed the glow-up", impact: "-jaw -score", effect: () => { hitStats(["jawline"], 12); damageScore(150); } },
    { tone: "bad", icon: "🧂", text: "Salt bloat jumpscare", impact: "-skin -jaw -score", effect: () => { hitStats(["skincare", "jawline"], 11); damageScore(210); } },
    { tone: "bad", icon: "💤", text: "Three-hour nap became nine hours", impact: "-gym -score", effect: () => { hitStats(["gym", "nofap"], 13); damageScore(170); } },
    { tone: "bad", icon: "🧻", text: "Group chat found your yearbook photo", impact: "-all -score", effect: () => { bumpAll(-6); damageScore(300); } },
    { tone: "bad", icon: "🥤", text: "Gas station pastry bulk arc", impact: "-all -score", effect: () => { bumpAll(-5); damageScore(230); } },
    { tone: "bad", icon: "📉", text: "Algorithm served doomscroll spiral", impact: "-sleep -score", effect: () => { hitStats(["sleep", "nofap", "skincare"], 13); damageScore(280); } },
  ];

  function bumpAll(delta) {
    for (const k of Object.keys(state.stats)) {
      state.stats[k] = clampStat(state.stats[k] + delta);
    }
  }

  function hitStats(keys, amount) {
    keys.forEach((key) => {
      state.stats[key] = clampStat(state.stats[key] - amount);
    });
  }

  function addScore(amount) {
    state.score += amount;
    state.lastScoreDelta = amount;
    state.scoreDeltaTimer = 1.1;
  }

  function damageScore(amount) {
    state.score = Math.max(0, state.score - amount);
    state.lastScoreDelta = -amount;
    state.scoreDeltaTimer = 1.25;
  }

  // ----- Game loop -----
  let rafId = null;
  function loop(now) {
    if (!state.running) return;
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;

    if (!state.paused && !state.gameOver) {
      state.playTime += dt;
      state.day = Math.min(TOTAL_DAYS, 1 + Math.floor(state.playTime / DAY_LENGTH));

      // Combo decay
      if (now - state.lastClickTime > state.comboWindow * 1000) {
        state.combo = 0;
      }

      // Decay
      if (state.decayImmune > 0) {
        state.decayImmune = Math.max(0, state.decayImmune - dt);
        state.idleDrain = 0;
        state.idleWarning = Math.max(0, state.idleWarning - dt * 2.5);
      } else {
        for (const k of Object.keys(state.stats)) {
          state.stats[k] = Math.max(0, state.stats[k] - state.baseDecay * dt);
        }
        applyIdleDrain(now, dt);
      }

      // Event cooldown
      state.eventCooldown -= dt;
      if (state.eventCooldown <= 0 && !state.currentEvent) {
        triggerRandomEvent();
      }

      // Effect decay
      if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 3);
      if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 4);
      if (state.grindPulse > 0) state.grindPulse = Math.max(0, state.grindPulse - dt * 5);
      if (state.comboPulse > 0) state.comboPulse = Math.max(0, state.comboPulse - dt * 4);
      if (state.scoreDeltaTimer > 0) state.scoreDeltaTimer = Math.max(0, state.scoreDeltaTimer - dt * 1.8);

      // Aura size smoothing
      const targetAura = getLooksmax() / 100;
      state.auraSize += (targetAura - state.auraSize) * 0.1;

      // Particles
      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.age += dt;
        if (p.age >= p.life) { state.particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 200 * dt;
      }

      // Check win
      if (getLooksmax() >= WIN_LOOKSMAX && !state.ending) {
        beginWinReveal();
      }
    }

    draw();
    updateHUD();
    rafId = requestAnimationFrame(loop);
  }

  function applyIdleDrain(now, dt) {
    const idleSeconds = Math.max(0, (now - state.lastClickTime) / 1000 - IDLE_DRAIN_DELAY);
    if (idleSeconds <= 0) {
      state.idleDrain = Math.max(0, state.idleDrain - dt * 3);
      state.idleWarning = Math.max(0, state.idleWarning - dt * 3);
      return;
    }

    const pressure = Math.min(1, idleSeconds / 5);
    state.idleDrain = pressure;
    state.idleWarning = Math.min(1, state.idleWarning + dt * 2.2);
    const statLoss = IDLE_STAT_DRAIN * (0.6 + pressure * 1.8) * dt;
    for (const k of Object.keys(state.stats)) {
      state.stats[k] = Math.max(0, state.stats[k] - statLoss);
    }
    const scoreLoss = IDLE_SCORE_DRAIN * (0.35 + pressure * 1.5) * dt;
    if (scoreLoss > 0) {
      state.score = Math.max(0, state.score - scoreLoss);
      state.lastScoreDelta = -scoreLoss;
      state.scoreDeltaTimer = Math.max(state.scoreDeltaTimer, 0.35);
    }
  }

  function triggerRandomEvent() {
    if (state.currentEvent) return;
    const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    state.currentEvent = ev;
    state.eventCooldown = 4;
  }

  function dismissEvent() {
    if (!state.currentEvent) return;
    const ev = state.currentEvent;
    const bad = ev.tone === "bad";
    ev.effect();
    state.flash = bad ? 0.75 : 0.5;
    state.flashColor = bad ? "#ff3b54" : "#ffffff";
    if (bad) {
      state.shake = Math.max(state.shake, 0.55);
    }
    spawnParticles(W / 2, 200, bad ? "#ff3b54" : "#f7d716", bad ? 22 : 14, bad ? 250 : 200);
    state.currentEvent = null;
    state.eventCooldown = 9 + Math.random() * 6;
  }

  function grind() {
    if (!state.running || state.paused || state.gameOver || state.ending) return;
    const now = performance.now();
    if (now - state.lastClickTime < state.comboWindow * 1000) {
      state.combo = Math.min(99, state.combo + 1);
    } else {
      state.combo = 1;
    }
    state.lastClickTime = now;
    state.clicks += 1;
    state.grindPulse = 1;
    state.idleDrain = 0;
    state.idleWarning = 0;
    state.comboPulse = Math.min(1, state.combo / 28);

    const routine = ROUTINES[state.routineIndex % ROUTINES.length];
    state.routineIndex += 1;
    state.recentRoutine = routine;

    // Combo bonus
    const bonus = state.combo >= 80 ? 2 : state.combo >= 35 ? 1 : 0;
    const power = state.clickPower + bonus;
    for (const k of Object.keys(state.stats)) {
      const focused = routine.stats.includes(k);
      const delta = focused ? power + 1 : Math.max(0.32, power * 0.42);
      state.stats[k] = clampStat(state.stats[k] + delta);
    }

    // Combo score
    addScore(state.combo + Math.round(getLooksmax() * 0.3));

    // Tier up bonus
    const tier = getTier(getLooksmax());
    if (tier.num > state.maxTier) {
      state.maxTier = tier.num;
      addScore(tier.num * 100);
      state.flash = 0.7;
      state.flashColor = "#ffffff";
      state.shake = 0.3;
      state.comboPulse = 1;
      spawnParticles(W / 2, 200, tier.color, 30, 280);
      RB.toast(`⬆ TIER UP · ${tier.title} (${tier.num}/10)`, "good");
    } else {
      spawnParticles(W / 2, 238, routine.color, 5 + Math.min(12, Math.floor(state.combo / 8)), 90);
    }
  }

  function spawnParticles(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random() * 0.7);
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 80,
        life: 0.6 + Math.random() * 0.4,
        age: 0,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function endGame(won) {
    state.gameOver = true;
    state.running = false;
    state.won = won;
    const finalScore = Math.round(state.score + getLooksmax() * 10);
    RB.recordScore("looksmax", finalScore);
    const high = RB.getHighScore("looksmax");
    const tier = getTier(getLooksmax());
    const title = won
      ? "👑 MIRROR FINAL BOSS"
      : `💪 ${tier.title.toUpperCase()}`;
    const sub = won
      ? `You did it. 10/10. The mirror blinked first. Final day: ${state.day}/${TOTAL_DAYS}.`
      : `Click RESTART to grind again.`;
    showOverlay(title, sub, "Grind again", `Final tier: <strong style="color:${tier.color}">${tier.title} ${tier.num}/10</strong> · Score: <strong style="color:var(--accent-3)">${finalScore.toLocaleString()}</strong> · High: <strong>${high.toLocaleString()}</strong>`);
  }

  function beginWinReveal() {
    state.ending = true;
    state.won = true;
    state.currentEvent = null;
    state.decayImmune = Math.max(state.decayImmune, 3);
    state.comboPulse = 1;
    state.flash = 1;
    state.flashColor = "#ffd700";
    state.shake = 0.85;
    spawnParticles(W / 2, 210, "#ffd700", 70, 380);
    RB.toast("🗿 FINAL FORM UNLOCKED", "good");
    setTimeout(() => {
      if (state.ending && state.running) endGame(true);
    }, 1800);
  }

  // ----- Drawing -----
  function draw() {
    const sh = state.shake;
    const sx = (Math.random() - 0.5) * 6 * sh;
    const sy = (Math.random() - 0.5) * 6 * sh;
    const time = performance.now() / 1000;
    ctx.save();
    ctx.translate(sx, sy);

    const tier = getTier(getLooksmax());
    drawMirrorRoom(tier, time);
    drawTopHud(tier);
    drawIdleWarning();

    // Avatar
    const ax = W / 2;
    const ay = 188;
    drawGeneratedCharacter(ax, ay, tier, time);

    // Stat bars
    drawStats();

    // GRIND button
    drawGrindButton();

    // Event popup
    if (state.currentEvent) {
      drawEventPopup();
    }

    // Particles
    for (const p of state.particles) {
      const a = 1 - (p.age / p.life);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Flash
    if (state.flash > 0) {
      ctx.fillStyle = hexToRgba(state.flashColor, state.flash * 0.3);
      ctx.fillRect(0, 0, W, H);
    }

    // Pause overlay
    if (state.paused) {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 36px Bungee, Impact, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⏸ PAUSED", W / 2, H / 2);
    }

    ctx.restore();
  }

  function drawMirrorRoom(tier, time) {
    const looksmax = getLooksmax();
    const mood = looksmax / 100;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#090916");
    bg.addColorStop(0.45, mood > 0.55 ? "#1b1832" : "#131326");
    bg.addColorStop(1, "#05050c");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Neon wall wash
    const glow = ctx.createRadialGradient(W / 2, 180, 40, W / 2, 180, 320);
    glow.addColorStop(0, hexToRgba(tier.color, 0.34 + mood * 0.16));
    glow.addColorStop(0.55, "rgba(255,46,136,0.10)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Floor grid
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = mood > 0.55 ? "#2ee0ff" : "#5f4aa0";
    ctx.lineWidth = 1;
    for (let y = 392; y < H; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y + (y - 392) * 0.18);
      ctx.stroke();
    }
    for (let x = -120; x <= W + 120; x += 38) {
      ctx.beginPath();
      ctx.moveTo(W / 2, 388);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.restore();

    // Mirror frame
    const mx = 66;
    const my = 50;
    const mw = W - 132;
    const mh = 268;
    const mirror = ctx.createLinearGradient(0, my, 0, my + mh);
    mirror.addColorStop(0, "rgba(255,255,255,0.08)");
    mirror.addColorStop(0.45, "rgba(46,224,255,0.08)");
    mirror.addColorStop(1, "rgba(255,46,136,0.08)");
    ctx.fillStyle = "rgba(5,5,12,0.78)";
    roundRect(ctx, mx - 16, my - 16, mw + 32, mh + 32, 24);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(tier.color, 0.8);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = mirror;
    roundRect(ctx, mx, my, mw, mh, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Vanity bulbs
    for (let i = 0; i < 7; i++) {
      const bx = mx - 20;
      const by = my + 18 + i * 36;
      drawBulb(bx, by, tier.color, time + i * 0.3);
      drawBulb(mx + mw + 20, by, tier.color, time + i * 0.3);
    }
    for (let i = 0; i < 5; i++) {
      drawBulb(mx + 38 + i * 58, my - 20, tier.color, time + i * 0.2);
    }

    // Locker shelf silhouettes
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    roundRect(ctx, 24, 330, 452, 50, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(46,224,255,0.18)";
    roundRect(ctx, 42, 342, 82, 18, 5);
    ctx.fill();
    ctx.fillStyle = "rgba(255,46,136,0.22)";
    roundRect(ctx, 342, 339, 34, 25, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(247,215,22,0.18)";
    roundRect(ctx, 386, 344, 70, 15, 5);
    ctx.fill();
  }

  function drawBulb(x, y, color, time) {
    const pulse = 0.7 + Math.sin(time * 2.4) * 0.2 + state.comboPulse * 0.3;
    ctx.fillStyle = hexToRgba(color, 0.18 * pulse);
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexToRgba(color, 0.78);
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTopHud(tier) {
    const looksmax = getLooksmax();
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    roundRect(ctx, 10, 10, W - 20, 46, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = tier.color;
    ctx.font = "bold 17px Bungee, Impact, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${tier.num}/10`, 20, 25);
    ctx.font = "bold 10px JetBrains Mono, monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(tier.title, 76, 25);

    const barX = 20;
    const barY = 40;
    const barW = 220;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, barX, barY, barW, 7, 4);
    ctx.fill();
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    grad.addColorStop(0, "#ff2e88");
    grad.addColorStop(0.55, "#2ee0ff");
    grad.addColorStop(1, "#f7d716");
    ctx.fillStyle = grad;
    roundRect(ctx, barX, barY, barW * (looksmax / 100), 7, 4);
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`DAY ${state.day}/${TOTAL_DAYS}`, W - 16, 20);
    ctx.fillText(`SCORE ${Math.floor(state.score).toLocaleString()}`, W - 16, 38);

    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, W - 116, 44, 100, 5, 3);
    ctx.fill();
    ctx.fillStyle = hexToRgba(tier.color, 0.9);
    roundRect(ctx, W - 116, 44, 100 * getDayProgress(), 5, 3);
    ctx.fill();

    if (state.scoreDeltaTimer > 0 && Math.abs(state.lastScoreDelta) > 0.1) {
      const good = state.lastScoreDelta > 0;
      ctx.fillStyle = good ? "#6bff7d" : "#ff5c5c";
      ctx.globalAlpha = 0.65 + state.scoreDeltaTimer * 0.2;
      ctx.font = "bold 10px JetBrains Mono, monospace";
      ctx.fillText(`${good ? "+" : "-"}${Math.ceil(Math.abs(state.lastScoreDelta))}`, W - 16, 54);
      ctx.globalAlpha = 1;
    }
  }

  function drawIdleWarning() {
    if (state.idleWarning <= 0) return;
    const a = state.idleWarning;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(255, 30, 72, 0.14)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    roundRect(ctx, 56, 64, W - 112, 30, 8);
    ctx.fill();
    ctx.strokeStyle = "#ff5c5c";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ff5c5c";
    ctx.font = "bold 12px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("IDLE DRAIN - SCORE FALLING", W / 2, 79);
    ctx.restore();
  }

  function drawGeneratedCharacter(cx, cy, tier, time) {
    const looksmax = getLooksmax();
    const t = looksmax / 100;
    const stageIndex = Math.max(0, Math.min(characterStageImages.length - 1, tier.num - 1));
    const img = characterStageImages[stageIndex];

    // Keep the generated portrait embedded in the same mirror treatment.
    if (t > 0.24) {
      const auraR = 84 + state.auraSize * 76;
      const grad = ctx.createRadialGradient(cx, cy + 6, 28, cx, cy + 6, auraR);
      grad.addColorStop(0, hexToRgba(tier.color, 0.24 + state.auraSize * 0.28));
      grad.addColorStop(0.58, hexToRgba("#ff2e88", 0.12));
      grad.addColorStop(1, "rgba(255, 215, 0, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy + 6, auraR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (t > 0.62) {
      ctx.save();
      ctx.translate(cx, cy + 22);
      ctx.rotate(time * 0.22);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        ctx.fillStyle = hexToRgba(tier.color, 0.11 + state.comboPulse * 0.12);
        ctx.fillRect(84, -1.5, 36 + t * 26, 3);
      }
      ctx.restore();
    }

    if (img.complete && img.naturalWidth > 0) {
      const pulse = 1 + state.grindPulse * 0.018 + (tier.num === 10 ? Math.sin(time * 3) * 0.008 : 0);
      const drawSize = (264 + Math.min(24, tier.num * 2.4)) * pulse;
      const dx = cx - drawSize / 2;
      const dy = 56 - Math.min(10, tier.num * 0.8);
      ctx.save();
      ctx.shadowColor = hexToRgba(tier.color, 0.32 + state.comboPulse * 0.28);
      ctx.shadowBlur = 22 + state.comboPulse * 18;
      ctx.drawImage(img, dx, dy, drawSize, drawSize);
      ctx.restore();
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.46)";
      roundRect(ctx, cx - 86, cy - 86, 172, 196, 18);
      ctx.fill();
      ctx.strokeStyle = tier.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("LOADING FORM", cx, cy + 8);
    }

    // Floating rating badge.
    ctx.save();
    ctx.translate(cx + 91, cy - 42);
    ctx.rotate(Math.sin(time * 1.8) * 0.04);
    ctx.fillStyle = "rgba(0,0,0,0.66)";
    roundRect(ctx, -42, -19, 84, 38, 10);
    ctx.fill();
    ctx.strokeStyle = tier.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = tier.color;
    ctx.font = "bold 16px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${tier.num}/10`, 0, -1);
    ctx.restore();
  }

  function drawAvatar(cx, cy, tier, time = performance.now() / 1000) {
    const looksmax = getLooksmax();
    const t = looksmax / 100; // 0..1
    const tnow = time;

    // Aura (size scales with tier)
    if (t > 0.3) {
      const auraR = 90 + state.auraSize * 50;
      const auraOpacity = 0.1 + state.auraSize * 0.25;
      const grad = ctx.createRadialGradient(cx, cy, 30, cx, cy, auraR);
      grad.addColorStop(0, `rgba(255, 215, 0, ${auraOpacity})`);
      grad.addColorStop(0.5, `rgba(255, 46, 136, ${auraOpacity * 0.6})`);
      grad.addColorStop(1, "rgba(255, 215, 0, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, auraR, 0, Math.PI * 2);
      ctx.fill();

      // Rotating rays
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tnow * 0.3);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = `rgba(255, 215, 0, ${0.1 + state.auraSize * 0.2})`;
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(80, -1, 30, 2);
      }
      ctx.restore();
    }

    // Torso and shoulders
    const bodyY = cy + 70;
    const shoulderW = 128 + t * 32;
    const shoulderH = 40 + t * 10;
    const torso = ctx.createLinearGradient(0, bodyY, 0, bodyY + 90);
    torso.addColorStop(0, t > 0.55 ? "#3b214f" : "#272741");
    torso.addColorStop(1, t > 0.55 ? "#090912" : "#101020");
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.beginPath();
    ctx.ellipse(cx, bodyY + 20, shoulderW * 0.62, shoulderH * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = torso;
    ctx.beginPath();
    ctx.moveTo(cx - shoulderW / 2, bodyY + 24);
    ctx.quadraticCurveTo(cx - 58, bodyY - 4, cx - 30, bodyY - 8);
    ctx.lineTo(cx + 30, bodyY - 8);
    ctx.quadraticCurveTo(cx + 58, bodyY - 4, cx + shoulderW / 2, bodyY + 24);
    ctx.lineTo(cx + 44, bodyY + 86);
    ctx.lineTo(cx - 44, bodyY + 86);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexToRgba(tier.color, 0.55);
    ctx.lineWidth = 2;
    ctx.stroke();

    // Tank top stripe / chain
    ctx.strokeStyle = t > 0.65 ? "#f7d716" : "rgba(255,255,255,0.22)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, bodyY + 4, 28 + t * 5, 0.18 * Math.PI, 0.82 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = hexToRgba(tier.color, 0.28 + t * 0.22);
    roundRect(ctx, cx - 42, bodyY + 34, 84, 10, 5);
    ctx.fill();

    // Head circle
    const skinColor = t > 0.9
      ? `rgb(196, 230, 226)`
      : t < 0.3
      ? `rgb(${180 + t * 100}, ${120 + t * 100}, ${100 + t * 100})`
      : t < 0.6
      ? `rgb(220, 180, 150)`
      : `rgb(245, 220, 180)`;
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 50, 56, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0a0a14";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cheekbone glow
    if (t > 0.35) {
      ctx.strokeStyle = hexToRgba("#ffffff", 0.12 + t * 0.14);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 37, cy + 13);
      ctx.quadraticCurveTo(cx - 22, cy + 18, cx - 10, cy + 14);
      ctx.moveTo(cx + 37, cy + 13);
      ctx.quadraticCurveTo(cx + 22, cy + 18, cx + 10, cy + 14);
      ctx.stroke();
    }

    // Hair (fullness based on tier)
    const hairColor = t > 0.5 ? "#3a1a0a" : t > 0.2 ? "#1a1a1a" : "#0a0a0a";
    ctx.fillStyle = hairColor;
    ctx.beginPath();
    const hairTop = cy - 56;
    const hairH = 8 + t * 18; // more hair at higher tier
    ctx.ellipse(cx, hairTop + 2, 50, hairH, 0, Math.PI, 0);
    ctx.fill();
    if (t < 0.4) {
      // Receding hairline
      ctx.fillStyle = skinColor;
      ctx.beginPath();
      ctx.ellipse(cx, hairTop + 8, 35, 6, 0, 0, Math.PI);
      ctx.fill();
    }

    // Acne (only at low tier)
    if (t < 0.5) {
      ctx.fillStyle = "#ff5c5c";
      for (let i = 0; i < 4; i++) {
        const a = Math.PI + (i / 3) * Math.PI;
        const ax = cx + Math.cos(a) * 40;
        const ay = cy + Math.sin(a) * 20;
        ctx.beginPath();
        ctx.arc(ax, ay, 2.5 - t * 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Eyes
    const eyeY = cy - 8;
    const eyeSpacing = 14 + t * 4;
    const eyeSize = 4 + t * 3;
    // Eye whites
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(cx - eyeSpacing, eyeY, eyeSize, eyeSize * 0.7, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + eyeSpacing, eyeY, eyeSize, eyeSize * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Pupils (look forward)
    ctx.fillStyle = t > 0.6 ? "#2ee0ff" : "#0a0a14";
    ctx.beginPath();
    ctx.arc(cx - eyeSpacing, eyeY, eyeSize * 0.5, 0, Math.PI * 2);
    ctx.arc(cx + eyeSpacing, eyeY, eyeSize * 0.5, 0, Math.PI * 2);
    ctx.fill();
    // Eye glow at high tier
    if (t > 0.7) {
      ctx.fillStyle = "rgba(255, 215, 0, 0.4)";
      ctx.beginPath();
      ctx.arc(cx - eyeSpacing, eyeY, eyeSize * 1.3, 0, Math.PI * 2);
      ctx.arc(cx + eyeSpacing, eyeY, eyeSize * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Eyebrows (thicker at higher tier)
    const browY = cy - 22;
    const browH = 2 + t * 3;
    ctx.strokeStyle = hairColor;
    ctx.lineWidth = browH;
    ctx.lineCap = "round";
    // Angry / determined at high tier
    if (t > 0.5) {
      ctx.beginPath();
      ctx.moveTo(cx - eyeSpacing - 6, browY + (t > 0.7 ? 4 : 0));
      ctx.lineTo(cx - eyeSpacing + 6, browY - 2);
      ctx.moveTo(cx + eyeSpacing + 6, browY + (t > 0.7 ? 4 : 0));
      ctx.lineTo(cx + eyeSpacing - 6, browY - 2);
      ctx.stroke();
    } else {
      // Sad eyebrows at low tier
      ctx.beginPath();
      ctx.moveTo(cx - eyeSpacing - 6, browY - 2);
      ctx.lineTo(cx - eyeSpacing + 6, browY + 2);
      ctx.moveTo(cx + eyeSpacing + 6, browY - 2);
      ctx.lineTo(cx + eyeSpacing - 6, browY + 2);
      ctx.stroke();
    }
    ctx.lineCap = "butt";

    // Nose
    ctx.strokeStyle = "rgba(10,10,20,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + 2, cy - 2);
    ctx.quadraticCurveTo(cx + 8, cy + 10, cx + 1, cy + 15);
    ctx.stroke();

    // Jawline (sharper at higher tier)
    const jawW = 50 - t * 18;
    const jawY = cy + 30;
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.moveTo(cx - 50, cy + 56);
    ctx.lineTo(cx - jawW, jawY + 20);
    ctx.quadraticCurveTo(cx, jawY + 30, cx + jawW, jawY + 20);
    ctx.lineTo(cx + 50, cy + 56);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#0a0a14";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (t > 0.78) {
      drawSculptedJaw(cx, cy, t, skinColor, tier);
    }

    // Beard (only at high tier)
    if (t > 0.5) {
      const beardDensity = (t - 0.5) * 2; // 0..1
      ctx.fillStyle = hairColor;
      ctx.beginPath();
      ctx.moveTo(cx - jawW + 3, jawY + 5);
      ctx.quadraticCurveTo(cx, jawY + 18 + beardDensity * 5, cx + jawW - 3, jawY + 5);
      ctx.lineTo(cx + jawW - 6, jawY + 18);
      ctx.quadraticCurveTo(cx, jawY + 28 + beardDensity * 5, cx - jawW + 6, jawY + 18);
      ctx.closePath();
      ctx.globalAlpha = beardDensity * 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Mouth
    if (t > 0.84) {
      const sculpt = Math.min(1, (t - 0.84) / 0.16);
      ctx.fillStyle = "#f08ca8";
      ctx.beginPath();
      ctx.ellipse(cx, cy + 36 + sculpt * 4, 11 + sculpt * 5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0a0a14";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 12 - sculpt * 4, cy + 36 + sculpt * 4);
      ctx.quadraticCurveTo(cx, cy + 40 + sculpt * 6, cx + 12 + sculpt * 4, cy + 36 + sculpt * 4);
      ctx.stroke();
    } else if (t < 0.3) {
      // Frown
      ctx.strokeStyle = "#0a0a14";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy + 24, 6, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
    } else if (t < 0.6) {
      // Neutral
      ctx.strokeStyle = "#0a0a14";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy + 22);
      ctx.lineTo(cx + 6, cy + 22);
      ctx.stroke();
    } else {
      // Smirk / smile
      ctx.strokeStyle = "#0a0a14";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy + 22, 8, 0, Math.PI, false);
      ctx.stroke();
    }

    // Glasses at very high tier
    if (t > 0.75) {
      ctx.strokeStyle = "#0a0a14";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx - eyeSpacing, eyeY, eyeSize + 4, 0, Math.PI * 2);
      ctx.arc(cx + eyeSpacing, eyeY, eyeSize + 4, 0, Math.PI * 2);
      ctx.moveTo(cx - eyeSpacing + eyeSize + 4, eyeY);
      ctx.lineTo(cx + eyeSpacing - eyeSize - 4, eyeY);
      ctx.stroke();
    }

    // Floating rating badge
    ctx.save();
    ctx.translate(cx + 78, cy - 42);
    ctx.rotate(Math.sin(tnow * 1.8) * 0.04);
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    roundRect(ctx, -40, -18, 80, 36, 10);
    ctx.fill();
    ctx.strokeStyle = tier.color;
    ctx.stroke();
    ctx.fillStyle = tier.color;
    ctx.font = "bold 16px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${tier.num}/10`, 0, -2);
    ctx.restore();
  }

  function drawSculptedJaw(cx, cy, t, skinColor, tier) {
    const sculpt = Math.min(1, (t - 0.78) / 0.22);
    const cheek = 46 + sculpt * 20;
    const jaw = 34 + sculpt * 32;
    const chinDrop = 20 + sculpt * 32;
    const jawY = cy + 32;
    const chinY = cy + 70 + chinDrop;

    ctx.save();
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.moveTo(cx - 44, cy + 18);
    ctx.lineTo(cx - cheek, jawY + 18);
    ctx.lineTo(cx - jaw, chinY - 14);
    ctx.quadraticCurveTo(cx, chinY + 8, cx + jaw, chinY - 14);
    ctx.lineTo(cx + cheek, jawY + 18);
    ctx.lineTo(cx + 44, cy + 18);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#05070d";
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // Faceted cheek and jaw planes for the sculpted statue gag.
    ctx.strokeStyle = hexToRgba("#ffffff", 0.22 + sculpt * 0.2);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 42, cy + 24);
    ctx.lineTo(cx - cheek + 7, jawY + 14);
    ctx.lineTo(cx - jaw + 8, chinY - 16);
    ctx.moveTo(cx + 42, cy + 24);
    ctx.lineTo(cx + cheek - 7, jawY + 14);
    ctx.lineTo(cx + jaw - 8, chinY - 16);
    ctx.moveTo(cx - 26, chinY - 4);
    ctx.quadraticCurveTo(cx, chinY + 6, cx + 26, chinY - 4);
    ctx.stroke();

    ctx.strokeStyle = hexToRgba(tier.color, 0.42 + sculpt * 0.28);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - cheek + 4, jawY + 19);
    ctx.lineTo(cx - jaw + 4, chinY - 12);
    ctx.moveTo(cx + cheek - 4, jawY + 19);
    ctx.lineTo(cx + jaw - 4, chinY - 12);
    ctx.stroke();

    if (sculpt > 0.72) {
      ctx.fillStyle = hexToRgba("#ffffff", 0.14);
      ctx.beginPath();
      ctx.moveTo(cx - 18, cy + 8);
      ctx.lineTo(cx - 68, jawY + 14);
      ctx.lineTo(cx - 32, jawY + 25);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 18, cy + 8);
      ctx.lineTo(cx + 68, jawY + 14);
      ctx.lineTo(cx + 32, jawY + 25);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStats() {
    const startY = 322;
    const rowH = 23;
    const barX = 132;
    const barW = W - 154;
    const barH = 13;
    const focusedStats = state.recentRoutine ? state.recentRoutine.stats : [];

    ctx.fillStyle = "rgba(0,0,0,0.38)";
    roundRect(ctx, 16, startY - 12, W - 32, rowH * STAT_META.length + 18, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    for (let i = 0; i < STAT_META.length; i++) {
      const meta = STAT_META[i];
      const y = startY + i * rowH;
      const v = state.stats[meta.key];
      const ratio = v / STAT_CAP;
      const focused = focusedStats.includes(meta.key);

      // Label
      ctx.fillStyle = focused ? "#ffffff" : "#a8a8b8";
      ctx.font = "bold 10.5px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(meta.icon + " " + meta.label, 16, y + barH / 2);

      // Bar background
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      roundRect(ctx, barX, y, barW, barH, 4);
      ctx.fill();

      // Bar fill
      if (ratio > 0) {
        const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        grad.addColorStop(0, meta.color);
        grad.addColorStop(1, focused ? "#ffffff" : hexToRgba(meta.color, 0.62));
        ctx.fillStyle = grad;
        roundRect(ctx, barX, y, barW * ratio, barH, 4);
        ctx.fill();
      }

      if (focused && state.grindPulse > 0) {
        ctx.strokeStyle = hexToRgba(meta.color, 0.22 + state.grindPulse * 0.42);
        ctx.lineWidth = 2;
        roundRect(ctx, barX - 3, y - 3, barW + 6, barH + 6, 6);
        ctx.stroke();
      }

      // Value
      ctx.fillStyle = "#fff";
      ctx.font = "bold 10px JetBrains Mono, monospace";
      ctx.textAlign = "right";
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.lineWidth = 3;
      ctx.strokeText(Math.floor(v), W - 16, y + barH / 2);
      ctx.fillText(Math.floor(v), W - 16, y + barH / 2);
    }
  }

  function drawGrindButton() {
    const bx = 30;
    const by = 488;
    const bw = W - 60;
    const bh = 78;
    const pulse = state.grindPulse;
    const routine = state.recentRoutine || ROUTINES[0];

    // Glow
    ctx.fillStyle = hexToRgba(routine.color, 0.18 + pulse * 0.22);
    roundRect(ctx, bx - 6 - pulse * 2, by - 6 - pulse * 2, bw + 12 + pulse * 4, bh + 12 + pulse * 4, 14);
    ctx.fill();

    // Button
    const grad = ctx.createLinearGradient(0, by, 0, by + bh);
    grad.addColorStop(0, routine.color);
    grad.addColorStop(0.58, "#ff2e88");
    grad.addColorStop(1, "#32112a");
    ctx.fillStyle = grad;
    roundRect(ctx, bx, by, bw, bh, 10);
    ctx.fill();
    ctx.strokeStyle = pulse > 0 ? "#ffffff" : "#0a0a14";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 30px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("💪 GRIND", W / 2, by + 30);
    ctx.font = "bold 10px JetBrains Mono, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(`${routine.label.toUpperCase()} · SPACE / TAP`, W / 2, by + 54);

    // Combo indicator
    if (state.combo > 2) {
      ctx.fillStyle = "#f7d716";
      ctx.font = "bold 14px Bungee, Impact, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText("🔥 " + state.combo + "x", bx + bw - 12, by + 22);
    }
  }

  function drawEventPopup() {
    const ev = state.currentEvent;
    const bad = ev.tone === "bad";
    const px = 20;
    const py = 560;
    const pw = W - 40;
    const ph = 64;

    ctx.fillStyle = bad ? "rgba(34, 8, 18, 0.97)" : "rgba(20, 20, 30, 0.96)";
    roundRect(ctx, px, py, pw, ph, 8);
    ctx.fill();
    ctx.strokeStyle = bad ? "#ff5c5c" : "#f7d716";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = "32px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(ev.icon, px + 14, py + ph / 2);

    ctx.fillStyle = bad ? "#ffe4e8" : "#fff";
    ctx.font = "bold 12px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(ev.text, px + 60, py + ph / 2 - 6);

    ctx.fillStyle = bad ? "#ff9cab" : "#a8a8b8";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillText(`${ev.impact || ""}  [CLICK or SPACE] continue`, px + 60, py + ph / 2 + 12);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexToRgba(hex, alpha) {
    const value = hex.replace("#", "");
    const bigint = parseInt(value.length === 3
      ? value.split("").map((c) => c + c).join("")
      : value, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ----- HUD -----
  function updateHUD() {
    const looksmax = getLooksmax();
    const tier = getTier(looksmax);
    document.getElementById("hud-tier").textContent = tier.num + "/10";
    document.getElementById("hud-tier").style.color = tier.color;
    const dayEl = document.getElementById("hud-day");
    if (dayEl) dayEl.textContent = state.day + "/" + TOTAL_DAYS;
    const scoreEl = document.getElementById("hud-score");
    if (scoreEl) scoreEl.textContent = Math.floor(state.score).toLocaleString();
    document.getElementById("hud-combo").textContent = state.combo + "x";
    document.getElementById("hud-clicks").textContent = state.clicks;
    document.getElementById("hud-high").textContent = RB.getHighScore("looksmax").toLocaleString();
  }

  // ----- Powerups -----
  function renderPowerups() {
    const slot = document.getElementById("powerups");
    const s = RB.state;
    const items = [
      { key: "shield", icon: "📚", label: "Mewing Masterclass", desc: "2x click power for 45s" },
      { key: "boost",  icon: "🧠", label: "Looksmaxx Guru",     desc: "+18 to all stats" },
      { key: "nuke",   icon: "🛡", label: "Cope Harder",         desc: "45s immunity to decay" },
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
      state.clickPower = 2;
      RB.toast("📚 Mewing Masterclass active — 2x click power for 45s", "good");
      setTimeout(() => { state.clickPower = 1; }, 45000);
    } else if (key === "boost") {
      bumpAll(18);
      state.flash = 0.5;
      state.shake = 0.4;
      spawnParticles(W / 2, 200, "#f7d716", 40, 320);
      RB.toast("🧠 Looksmaxx Guru: +18 to ALL stats", "good");
    } else if (key === "nuke") {
      state.decayImmune = 45;
      spawnParticles(W / 2, H / 2, "#2ee0ff", 30, 280);
      RB.toast("🛡 Cope activated — stats frozen for 45s", "good");
    }
  }

  // ----- Input -----
  document.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (state.currentEvent) {
        dismissEvent();
      } else {
        grind();
      }
    } else if (e.key === "g" || e.key === "G") {
      grind();
    }
  });

  function handleCanvasAction(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Event popup
    if (state.currentEvent) {
      dismissEvent();
      return;
    }
    // GRIND button
    if (x >= 30 && x <= W - 30 && y >= 488 && y <= 566) {
      grind();
    }
  }

  canvas.addEventListener("click", handleCanvasAction);
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    e.preventDefault();
    handleCanvasAction(e);
  });

  // ----- Overlay -----
  function showOverlay(title, sub, btn, extra) {
    const ov = document.getElementById("overlay");
    document.getElementById("overlay-title").textContent = title;
    document.getElementById("overlay-sub").innerHTML = sub;
    const scoreEl = document.getElementById("overlay-score");
    scoreEl.style.display = extra ? "block" : "none";
    if (extra) scoreEl.innerHTML = extra;
    document.getElementById("btn-primary").textContent = btn;
    ov.classList.add("overlay--show");
  }
  function hideOverlay() { document.getElementById("overlay").classList.remove("overlay--show"); }

  function startGame() {
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.ending = false;
    state.started = true;
    state.won = false;
    state.clicks = 0;
    state.combo = 0;
    state.lastClickTime = performance.now();
    state.score = 0;
    state.maxTier = 0;
    state.stats = { gym: 0, mewing: 0, jawline: 0, skincare: 0, sleep: 0, nofap: 0 };
    state.clickPower = 1;
    state.decayImmune = 0;
    state.currentEvent = null;
    state.eventCooldown = 5;
    state.auraSize = 0;
    state.particles = [];
    state.playTime = 0;
    state.day = 1;
    state.routineIndex = 0;
    state.recentRoutine = ROUTINES[0];
    state.grindPulse = 0;
    state.comboPulse = 0;
    state.idleDrain = 0;
    state.idleWarning = 0;
    state.flashColor = "#ffffff";
    state.lastScoreDelta = 0;
    state.scoreDeltaTimer = 0;
    state.lastTime = 0;
    hideOverlay();
    updateHUD();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function pauseGame() {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    document.getElementById("btn-pause").textContent = state.paused ? "Resume" : "Pause";
  }

  // ----- Wire up -----
  document.getElementById("btn-primary").addEventListener("click", startGame);
  document.getElementById("btn-pause").addEventListener("click", pauseGame);
  document.getElementById("btn-restart").addEventListener("click", () => {
    state.running = false;
    state.paused = false;
    state.gameOver = true;
    state.ending = false;
    if (rafId) cancelAnimationFrame(rafId);
    document.getElementById("btn-pause").textContent = "Pause";
    showOverlay("💪 LOOKSMAXXING GRINDSET", "Restart the 30-day mirror arc?", "Start the grind");
  });
  const grindButton = document.getElementById("btn-grind-action");
  if (grindButton) {
    grindButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (state.currentEvent) dismissEvent();
      else grind();
    });
  }

  RB.subscribe(renderPowerups);
  updateHUD();
  renderPowerups();
  draw();
})();
