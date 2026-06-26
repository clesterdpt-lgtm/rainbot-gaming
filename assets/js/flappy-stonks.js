/* ============================================
   FLAPPY STONKS
   - One-button stock-market runner.
   - The player's y-position is sampled into a scrolling chart trail.
   - Debug hook: window.__FLAPPY_STONKS
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "flappy-stonks";
  const W = 900;
  const H = 600;
  const PLAYER_X = 190;
  const PLAYER_R = 24;
  const FLOOR = H - 44;
  const CEILING = 34;
  const GRAVITY = 1050;
  const START_VY = -160;
  const FLAP_VY = -430;
  const SHIELD_BOUNCE_VY = -360;
  const MAX_FALL_VY = 640;

  const C = {
    bg0: "#05070d",
    bg1: "#09131f",
    grid: "rgba(46, 224, 255, 0.16)",
    ink: "#fbfaf4",
    dim: "#aeb5c7",
    green: "#58ff8a",
    red: "#ff4f68",
    cyan: "#2ee0ff",
    yellow: "#ffd43b",
    pink: "#ff2e88",
    purple: "#b06cff",
    dark: "#020409",
  };

  const HEADLINES = [
    { label: "FED SNEEZED", sub: "gravity +", duration: 4600, gravity: 1.16, speed: 1.02, gap: 0 },
    { label: "CEO TWEET", sub: "gap -", duration: 4300, gravity: 1, speed: 1.08, gap: -18 },
    { label: "AI BUBBLE", sub: "speed +", duration: 4600, gravity: 0.96, speed: 1.18, gap: 4 },
    { label: "EARNINGS MISS", sub: "market dump", duration: 4300, gravity: 1.08, speed: 1.08, gap: -12 },
    { label: "SHORT SQUEEZE", sub: "lighter tape", duration: 3800, gravity: 0.86, speed: 1.12, gap: 10 },
    { label: "TRADING HALT?", sub: "fakeout", duration: 3300, gravity: 1.04, speed: 0.86, gap: -8 },
  ];

  const api =
    (typeof RB !== "undefined" && RB) ||
    window.RB || {
      recordScore() { return false; },
      getHighScore() { return 0; },
      toast() {},
    };

  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const wrap = canvas.closest(".canvas-wrap");
  const overlayEl = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySub = document.getElementById("overlay-sub");
  const overlayScore = document.getElementById("overlay-score");
  const btnPrimary = document.getElementById("btn-primary");
  const btnNew = document.getElementById("btn-new");
  const btnPause = document.getElementById("btn-pause");
  const btnSound = document.getElementById("btn-sound");
  const scoreEl = document.getElementById("hud-score");
  const priceEl = document.getElementById("hud-price");
  const marketEl = document.getElementById("hud-market");
  const bestEl = document.getElementById("hud-best");

  const saveSlot = window.RBGameSaves && window.RBGameSaves.create(GAME_ID, { version: 1 });
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const SOUND_PREF_KEY = GAME_ID + ":sound";
  const PLAYER_SPRITE_SRC = (() => {
    const scriptSrc = document.currentScript && document.currentScript.src;
    if (scriptSrc) {
      return new URL("../img/flappy-stonks/flappy-stonks-bird.png?v=20260626-1", scriptSrc).href;
    }
    return "../assets/img/flappy-stonks/flappy-stonks-bird.png?v=20260626-1";
  })();
  let audioCtx = null;
  let soundOn = readSoundPreference();
  let playerSpriteReady = false;

  const playerSprite = new Image();
  playerSprite.decoding = "async";
  playerSprite.onload = () => {
    playerSpriteReady = true;
    render();
  };
  playerSprite.onerror = () => {
    playerSpriteReady = false;
  };
  playerSprite.src = PLAYER_SPRITE_SRC;

  const player = {
    x: PLAYER_X,
    y: H * 0.5,
    vy: 0,
    rot: 0,
    shield: 0,
    pulse: 0,
  };

  let phase = "idle";
  let paused = false;
  let score = 0;
  let dividends = 0;
  let best = 0;
  let price = 100;
  let marketLabel = "OPEN";
  let running = false;
  let lastT = 0;
  let rafId = 0;
  let timeMs = 0;
  let spawnT = 0;
  let trailT = 0;
  let eventT = 0;
  let headlineT = 0;
  let distance = 0;
  let shake = 0;
  let candles = [];
  let pickups = [];
  let particles = [];
  let floats = [];
  let trail = [];
  let headline = null;
  let closeLine = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function choice(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function format(value) {
    return Math.round(value).toLocaleString();
  }

  function readSoundPreference() {
    try {
      return localStorage.getItem(SOUND_PREF_KEY) !== "off";
    } catch (_) {
      return true;
    }
  }

  function writeSoundPreference() {
    try {
      localStorage.setItem(SOUND_PREF_KEY, soundOn ? "on" : "off");
    } catch (_) {}
  }

  function ensureAudio() {
    if (!soundOn || !AudioContextCtor) return null;
    if (!audioCtx) audioCtx = new AudioContextCtor();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, duration, options) {
    const ac = ensureAudio();
    if (!ac) return;
    const opts = options || {};
    const t0 = ac.currentTime + (opts.delay || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.gain || 0.03, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.04);
  }

  function noise(duration, gainValue) {
    const ac = ensureAudio();
    if (!ac) return;
    const len = Math.max(1, Math.floor(ac.sampleRate * duration));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    src.buffer = buf;
    gain.gain.setValueAtTime(gainValue || 0.04, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
    src.connect(gain);
    gain.connect(ac.destination);
    src.start();
  }

  function sfx(name) {
    if (!soundOn) return;
    if (name === "flap") {
      tone(520, 0.08, { type: "triangle", to: 820, gain: 0.032 });
    } else if (name === "dividend") {
      tone(660, 0.08, { type: "square", gain: 0.025 });
      tone(990, 0.09, { type: "triangle", delay: 0.06, gain: 0.022 });
    } else if (name === "shield") {
      tone(330, 0.08, { type: "sine", gain: 0.03 });
      tone(660, 0.18, { type: "triangle", delay: 0.05, gain: 0.024 });
    } else if (name === "break") {
      noise(0.18, 0.07);
      tone(180, 0.16, { type: "sawtooth", to: 80, gain: 0.035 });
    } else if (name === "score") {
      tone(760, 0.055, { type: "square", gain: 0.018 });
    } else if (name === "event") {
      tone(260, 0.08, { type: "sawtooth", gain: 0.026 });
      tone(420, 0.08, { type: "sawtooth", delay: 0.08, gain: 0.023 });
    } else if (name === "over") {
      tone(280, 0.18, { type: "sawtooth", to: 95, gain: 0.04 });
      noise(0.22, 0.04);
    } else if (name === "pause") {
      tone(260, 0.08, { type: "sine", gain: 0.02 });
    }
  }

  function setSoundLabel() {
    if (!btnSound) return;
    if (!AudioContextCtor) {
      btnSound.textContent = "Sound Off";
      btnSound.setAttribute("aria-pressed", "false");
      btnSound.disabled = true;
      return;
    }
    btnSound.textContent = soundOn ? "Sound On" : "Sound Off";
    btnSound.setAttribute("aria-pressed", String(soundOn));
  }

  function toggleSound() {
    soundOn = !soundOn;
    writeSoundPreference();
    setSoundLabel();
    if (soundOn) sfx("dividend");
  }

  function loadBest() {
    best = api.getHighScore(GAME_ID) || 0;
    if (!best && saveSlot) {
      const saved = saveSlot.read();
      if (saved && saved.data) best = Number(saved.data.best || 0);
    }
  }

  function updateHud() {
    if (scoreEl) scoreEl.textContent = format(score);
    if (priceEl) priceEl.textContent = "$" + price.toFixed(2);
    if (marketEl) marketEl.textContent = marketLabel;
    if (bestEl) bestEl.textContent = format(Math.max(best, score));
  }

  function showOverlay(title, sub, button, scoreHtml) {
    overlayTitle.textContent = title;
    overlaySub.innerHTML = sub;
    overlayScore.innerHTML = scoreHtml || "";
    btnPrimary.textContent = button;
    overlayEl.classList.add("overlay--show");
  }

  function hideOverlay() {
    overlayEl.classList.remove("overlay--show");
  }

  function resetTrail() {
    trail = [];
    const baseline = player.y;
    for (let x = -18; x <= PLAYER_X; x += 18) {
      trail.push({ x, y: baseline + Math.sin(x * 0.035) * 8, age: 0 });
    }
  }

  function resetGame() {
    phase = "play";
    paused = false;
    running = true;
    player.y = H * 0.5;
    player.vy = START_VY;
    player.rot = 0;
    player.shield = 0;
    player.pulse = 0;
    score = 0;
    dividends = 0;
    price = 100;
    marketLabel = "OPEN";
    spawnT = 520;
    trailT = 0;
    eventT = 5500;
    headlineT = 0;
    distance = 0;
    shake = 0;
    candles = [];
    pickups = [];
    particles = [];
    floats = [];
    headline = null;
    closeLine = null;
    resetTrail();
    spawnCandle(W + 120, true);
    spawnCandle(W + 460, false);
    hideOverlay();
    if (wrap) wrap.classList.remove("is-paused");
    updateHud();
    canvas.focus({ preventScroll: true });
    sfx("flap");
  }

  function currentDifficulty() {
    return clamp(score / 26, 0, 1);
  }

  function activeMods() {
    if (!headline || headlineT <= 0) return { gravity: 1, speed: 1, gap: 0 };
    return {
      gravity: headline.gravity || 1,
      speed: headline.speed || 1,
      gap: headline.gap || 0,
    };
  }

  function baseSpeed() {
    return 205 + currentDifficulty() * 72;
  }

  function gapSize() {
    const mods = activeMods();
    return clamp(192 - currentDifficulty() * 44 + mods.gap, 138, 218);
  }

  function spawnCandle(x, first) {
    const gap = first ? 250 : gapSize();
    const margin = 92;
    const last = candles[candles.length - 1];
    const center = last ? clamp(last.gapY + rand(-120, 120), margin + gap / 2, H - margin - gap / 2) : H * 0.5;
    const red = Math.random() < 0.52;
    const width = rand(76, 94);
    const candle = {
      x,
      w: width,
      gapY: center,
      targetGapY: center,
      gap,
      passed: false,
      color: red ? C.red : C.green,
      wick: red ? "#ff8898" : "#a7ffbe",
      bodyPulse: rand(0, Math.PI * 2),
      drift: rand(-16, 16),
      label: choice(["$YOLO", "$DIP", "$BAG", "$MOON", "$OOF", "$HODL"]),
    };
    candles.push(candle);

    if (!first && Math.random() < 0.72) {
      pickups.push({
        type: Math.random() < 0.78 ? "dividend" : "shield",
        x: x + width * 0.5,
        y: center + rand(-gap * 0.22, gap * 0.22),
        r: 15,
        taken: false,
        t: rand(0, Math.PI * 2),
      });
    }
  }

  function triggerHeadline(force) {
    if (!force && score < 3) return;
    headline = choice(HEADLINES);
    headlineT = headline.duration;
    marketLabel = headline.label;
    addFloat(W * 0.52, 82, headline.label, C.yellow);
    sfx("event");
  }

  function flap() {
    if (phase === "idle" || phase === "over") {
      resetGame();
      return;
    }
    if (phase !== "play") return;
    if (paused) {
      togglePause(false);
      return;
    }
    const mods = activeMods();
    player.vy = FLAP_VY / Math.sqrt(mods.gravity || 1);
    player.pulse = 1;
    addParticles(player.x - 20, player.y + 8, C.cyan, 8, -150);
    sfx("flap");
  }

  function togglePause(playSound) {
    if (phase !== "play") return;
    paused = !paused;
    running = !paused;
    if (wrap) wrap.classList.toggle("is-paused", paused);
    if (btnPause) btnPause.textContent = paused ? "Resume" : "Pause";
    if (paused) {
      showOverlay(
        "MARKET PAUSED",
        "Trading desk frozen. Resume before your fake portfolio gets ideas.",
        "Resume trading",
        `Score: <strong>${format(score)}</strong> - Price: <strong>$${price.toFixed(2)}</strong>`
      );
    } else {
      hideOverlay();
      lastT = performance.now();
      canvas.focus({ preventScroll: true });
    }
    if (playSound !== false) sfx("pause");
  }

  function addFloat(x, y, text, color) {
    floats.push({ x, y, text, color, life: 950, ttl: 950 });
  }

  function addParticles(x, y, color, count, vxBias) {
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x,
        y,
        vx: (vxBias || 0) + rand(-90, 90),
        vy: rand(-130, 90),
        r: rand(2, 5),
        color,
        life: rand(360, 720),
        ttl: 720,
      });
    }
  }

  function collectPickup(pickup) {
    pickup.taken = true;
    if (pickup.type === "dividend") {
      dividends += 1;
      score += 2;
      price += 3.5;
      addFloat(pickup.x, pickup.y - 16, "+DIV", C.yellow);
      addParticles(pickup.x, pickup.y, C.yellow, 12, -80);
      sfx("dividend");
    } else {
      player.shield = Math.min(2, player.shield + 1);
      addFloat(pickup.x, pickup.y - 16, "STOP LOSS", C.cyan);
      addParticles(pickup.x, pickup.y, C.cyan, 16, -60);
      sfx("shield");
    }
  }

  function circleRect(cx, cy, r, rx, ry, rw, rh) {
    const px = clamp(cx, rx, rx + rw);
    const py = clamp(cy, ry, ry + rh);
    const dx = cx - px;
    const dy = cy - py;
    return dx * dx + dy * dy <= r * r;
  }

  function hitCandle(candle) {
    if (player.shield > 0) {
      player.shield -= 1;
      player.vy = SHIELD_BOUNCE_VY;
      shake = 16;
      candle.x = -999;
      addParticles(player.x + 12, player.y, C.cyan, 26, -160);
      addFloat(player.x + 40, player.y - 30, "STOP-LOSS FILLED", C.cyan);
      sfx("shield");
      return false;
    }
    gameOver("margin-called by a candle wall");
    return true;
  }

  function gameOver(reason) {
    if (phase === "over") return;
    phase = "over";
    running = false;
    closeLine = { price, reason };
    marketLabel = "CLOSED";
    shake = 22;
    addParticles(player.x, player.y, C.red, 34, -130);
    sfx("over");
    const newHigh = api.recordScore(GAME_ID, score);
    best = Math.max(best, score);
    if (saveSlot) {
      saveSlot.save({
        best,
        lastScore: score,
        lastPrice: Number(price.toFixed(2)),
        dividends,
        reason,
      }, { score, label: "Flappy Stonks" });
    }
    if (newHigh && score > 0) api.toast("New Flappy Stonks high score!", "good");
    updateHud();
    showOverlay(
      "MARKET CLOSED",
      `$STONK closed after being ${reason}. The chart behind you is your actual run history.`,
      "Trade again",
      `Score: <strong>${format(score)}</strong> - Close: <strong>$${price.toFixed(2)}</strong>${newHigh ? " - <strong>New high</strong>" : ""}`
    );
  }

  function update(dt) {
    timeMs += dt;
    if (!running) {
      updateEffects(dt);
      return;
    }

    const dts = dt / 1000;
    const mods = activeMods();
    const speed = baseSpeed() * mods.speed;
    const gravity = GRAVITY * mods.gravity;
    distance += speed * dts;
    spawnT -= dt;
    eventT -= dt;
    trailT -= dt;

    if (headlineT > 0) {
      headlineT -= dt;
      if (headlineT <= 0) {
        headline = null;
        marketLabel = "OPEN";
      }
    }
    if (eventT <= 0) {
      eventT = rand(8200, 12000);
      triggerHeadline(false);
    }

    player.vy = Math.min(MAX_FALL_VY, player.vy + gravity * dts);
    player.y += player.vy * dts;
    player.rot = clamp(player.vy / 760, -0.55, 0.78);
    player.pulse = Math.max(0, player.pulse - dts * 3.8);

    const priceTarget = 100 + score * 2.8 + dividends * 3.5 + (H * 0.5 - player.y) * 0.07;
    price = Math.max(0.01, lerp(price, priceTarget, 0.045));

    if (trailT <= 0) {
      trailT = 34;
      trail.push({ x: player.x - 10, y: player.y, age: 0 });
    }

    for (const point of trail) {
      point.x -= speed * dts;
      point.age += dt;
    }
    trail = trail.filter((point) => point.x > -30);

    if (spawnT <= 0) {
      const spacing = clamp(330 - currentDifficulty() * 34, 285, 340);
      spawnT += (spacing / speed) * 1000;
      const last = candles[candles.length - 1];
      spawnCandle(Math.max(W + 70, last ? last.x + spacing : W + 70), false);
    }

    for (const candle of candles) {
      candle.x -= speed * dts;
      candle.bodyPulse += dts * 2.2;
      candle.gapY += Math.sin(timeMs * 0.0015 + candle.drift) * 0.05 * currentDifficulty();
      if (!candle.passed && candle.x + candle.w < player.x - PLAYER_R) {
        candle.passed = true;
        score += 1;
        price += 1.25;
        addFloat(player.x + 40, player.y - 28, "+1", C.green);
        sfx("score");
      }
    }
    candles = candles.filter((candle) => candle.x > -160);

    for (const pickup of pickups) {
      pickup.x -= speed * dts;
      pickup.t += dts * 4;
      const dx = pickup.x - player.x;
      const dy = pickup.y - player.y;
      if (!pickup.taken && dx * dx + dy * dy < (PLAYER_R + pickup.r) * (PLAYER_R + pickup.r)) {
        collectPickup(pickup);
      }
    }
    pickups = pickups.filter((pickup) => pickup.x > -60 && !pickup.taken);

    if (player.y < CEILING + PLAYER_R * 0.55 || player.y > FLOOR - PLAYER_R * 0.55) {
      gameOver(player.y < H * 0.5 ? "rejected at resistance" : "liquidated below support");
      updateEffects(dt);
      return;
    }

    for (const candle of candles) {
      const gapTop = candle.gapY - candle.gap / 2;
      const gapBottom = candle.gapY + candle.gap / 2;
      if (
        circleRect(player.x, player.y, PLAYER_R, candle.x, 0, candle.w, gapTop) ||
        circleRect(player.x, player.y, PLAYER_R, candle.x, gapBottom, candle.w, FLOOR - gapBottom)
      ) {
        if (hitCandle(candle)) break;
      }
    }

    updateEffects(dt);
    updateHud();
  }

  function updateEffects(dt) {
    shake = Math.max(0, shake - dt * 0.045);
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      p.vy += 420 * dt / 1000;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const f of floats) {
      f.life -= dt;
      f.y -= dt * 0.035;
      f.x -= dt * 0.015;
    }
    floats = floats.filter((f) => f.life > 0);
  }

  function drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, C.bg1);
    gradient.addColorStop(1, C.bg0);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = (-(distance * 0.24) % 60); x < W; x += 60) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, FLOOR);
    }
    for (let y = 70; y < FLOOR; y += 56) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.font = "700 12px JetBrains Mono, monospace";
    ctx.fillText("$STONK / 1m", 24, 30);
    ctx.fillText("VOL " + Math.round((currentDifficulty() * 90) + (headline ? 34 : 8)) + "%", W - 116, 30);

    ctx.fillStyle = "rgba(0, 0, 0, 0.36)";
    ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.strokeStyle = "rgba(255, 212, 59, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR + 0.5);
    ctx.lineTo(W, FLOOR + 0.5);
    ctx.stroke();
  }

  function drawTrail() {
    if (trail.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let layer = 0; layer < 2; layer += 1) {
      ctx.lineWidth = layer === 0 ? 14 : 5;
      ctx.globalAlpha = layer === 0 ? 0.16 : 0.98;
      for (let i = 1; i < trail.length; i += 1) {
        const a = trail[i - 1];
        const b = trail[i];
        ctx.strokeStyle = b.y <= a.y ? C.green : C.red;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    const last = trail[trail.length - 1];
    ctx.fillStyle = C.yellow;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4.5 + Math.sin(timeMs * 0.01) * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCandles() {
    candles.forEach((candle) => {
      const gapTop = candle.gapY - candle.gap / 2;
      const gapBottom = candle.gapY + candle.gap / 2;
      drawCandleBlock(candle.x, 0, candle.w, gapTop, candle);
      drawCandleBlock(candle.x, gapBottom, candle.w, FLOOR - gapBottom, candle);
      ctx.save();
      ctx.globalAlpha = 0.76;
      ctx.fillStyle = "rgba(2, 4, 9, 0.74)";
      ctx.fillRect(candle.x - 3, gapTop - 28, candle.w + 6, 18);
      ctx.fillStyle = C.ink;
      ctx.font = "800 11px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(candle.label, candle.x + candle.w / 2, gapTop - 15);
      ctx.restore();
    });
  }

  function drawCandleBlock(x, y, w, h, candle) {
    if (h <= 0) return;
    const pulse = 0.08 + Math.sin(candle.bodyPulse) * 0.035;
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
    ctx.fillRect(x + 9, y + 9, w, h);
    ctx.strokeStyle = candle.wick;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y + 8);
    ctx.lineTo(x + w * 0.5, y + h - 8);
    ctx.stroke();
    ctx.fillStyle = candle.color;
    ctx.globalAlpha = 0.94;
    roundRect(x, y, w, h, 9);
    ctx.fill();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#ffffff";
    roundRect(x + 7, y + 7, Math.max(4, w * 0.18), Math.max(8, h - 14), 5);
    ctx.fill();
    ctx.restore();
  }

  function drawPickups() {
    pickups.forEach((pickup) => {
      const bob = Math.sin(pickup.t) * 5;
      ctx.save();
      ctx.translate(pickup.x, pickup.y + bob);
      if (pickup.type === "dividend") {
        ctx.fillStyle = C.yellow;
        ctx.strokeStyle = "#fff3a6";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, pickup.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = C.dark;
        ctx.font = "900 18px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("$", 0, 1);
      } else {
        ctx.fillStyle = C.cyan;
        ctx.strokeStyle = "#c5f7ff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = -Math.PI / 2 + i * Math.PI / 3;
          const r = i % 2 ? pickup.r * 0.76 : pickup.r;
          const x = Math.cos(a) * r;
          const y = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = C.dark;
        ctx.font = "900 14px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("SL", 0, 1);
      }
      ctx.restore();
    });
  }

  function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.rot);
    const scale = 1 + player.pulse * 0.08;
    ctx.scale(scale, scale);

    if (player.shield > 0) {
      ctx.strokeStyle = "rgba(46, 224, 255, 0.72)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_R + 9 + Math.sin(timeMs * 0.01) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
    ctx.beginPath();
    ctx.ellipse(-4, 8, 38, 25, 0, 0, Math.PI * 2);
    ctx.fill();

    if (playerSpriteReady) {
      const spriteH = 92;
      const spriteW = spriteH * (playerSprite.naturalWidth / playerSprite.naturalHeight);
      ctx.drawImage(playerSprite, -spriteW * 0.5, -spriteH * 0.52, spriteW, spriteH);
      ctx.restore();
      return;
    }

    ctx.fillStyle = C.cyan;
    ctx.beginPath();
    ctx.moveTo(34, 0);
    ctx.quadraticCurveTo(0, -30, -38, -12);
    ctx.quadraticCurveTo(-20, 6, -38, 24);
    ctx.quadraticCurveTo(0, 22, 34, 0);
    ctx.fill();

    ctx.fillStyle = C.yellow;
    ctx.beginPath();
    ctx.moveTo(18, 0);
    ctx.lineTo(45, -12);
    ctx.lineTo(32, 13);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.arc(-8, -5, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.dark;
    ctx.beginPath();
    ctx.arc(-4, -7, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = C.pink;
    ctx.beginPath();
    ctx.moveTo(-34, 0);
    ctx.lineTo(-64, -15);
    ctx.lineTo(-56, 10);
    ctx.lineTo(-66, 28);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = C.dark;
    ctx.font = "900 12px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", -4, 14);

    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.ttl, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawFloats() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "900 16px JetBrains Mono, monospace";
    floats.forEach((f) => {
      ctx.globalAlpha = clamp(f.life / f.ttl, 0, 1);
      ctx.fillStyle = f.color;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.82)";
      ctx.lineWidth = 4;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.restore();
  }

  function drawHeadline() {
    if (!headline || headlineT <= 0) return;
    const alpha = clamp(headlineT / 500, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, 72);
    ctx.fillStyle = "rgba(2, 4, 9, 0.82)";
    ctx.strokeStyle = C.yellow;
    ctx.lineWidth = 2;
    roundRect(-158, -28, 316, 56, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.yellow;
    ctx.font = "900 20px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(headline.label, 0, -4);
    ctx.fillStyle = C.dim;
    ctx.font = "800 11px JetBrains Mono, monospace";
    ctx.fillText(headline.sub, 0, 19);
    ctx.restore();
  }

  function drawClosedTape() {
    if (!closeLine) return;
    ctx.save();
    ctx.fillStyle = "rgba(2, 4, 9, 0.74)";
    ctx.strokeStyle = "rgba(255, 79, 104, 0.66)";
    ctx.lineWidth = 2;
    roundRect(22, FLOOR - 56, 324, 36, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.font = "900 13px JetBrains Mono, monospace";
    ctx.fillText("$STONK CLOSED $" + closeLine.price.toFixed(2), 42, FLOOR - 34);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
  }

  function render() {
    ctx.save();
    if (shake > 0) {
      ctx.translate(rand(-shake, shake) * 0.3, rand(-shake, shake) * 0.3);
    }
    drawBackground();
    drawTrail();
    drawPickups();
    drawCandles();
    drawPlayer();
    drawParticles();
    drawFloats();
    drawHeadline();
    drawClosedTape();
    ctx.restore();
  }

  function frame(t) {
    const dt = Math.min(50, t - (lastT || t));
    lastT = t;
    update(dt || 16);
    render();
    rafId = requestAnimationFrame(frame);
  }

  function pointerFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const clientX = event.clientX == null && event.touches && event.touches[0] ? event.touches[0].clientX : event.clientX;
    const clientY = event.clientY == null && event.touches && event.touches[0] ? event.touches[0].clientY : event.clientY;
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * W,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * H,
    };
  }

  function bindInput() {
    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      flap();
    });

    document.addEventListener("keydown", (event) => {
      const tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === " " || event.key === "ArrowUp" || event.key === "w" || event.key === "W") {
        event.preventDefault();
        flap();
      } else if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        togglePause();
      } else if (event.key === "Enter" && (phase === "idle" || phase === "over")) {
        event.preventDefault();
        resetGame();
      }
    });

    if (btnPrimary) btnPrimary.addEventListener("click", () => {
      if (paused) togglePause(false);
      else resetGame();
    });
    if (btnNew) btnNew.addEventListener("click", resetGame);
    if (btnPause) btnPause.addEventListener("click", () => togglePause());
    if (btnSound) btnSound.addEventListener("click", toggleSound);
  }

  function bindFullscreen() {
    const fsBtn = document.getElementById("btn-fullscreen");
    const fsTarget = wrap || canvas.parentElement;
    if (!fsBtn || !fsTarget) return;
    const isMaxed = () => fsTarget.classList.contains("is-maxed");
    const nativeFsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    const updateBtn = () => {
      const on = isMaxed();
      fsBtn.textContent = on ? "Exit" : "Max";
      fsBtn.setAttribute("aria-label", on ? "Exit max screen" : "Max screen");
      fsBtn.setAttribute("title", on ? "Exit" : "Max screen");
    };
    const setMaxed = (on) => {
      fsTarget.classList.toggle("is-maxed", on);
      document.body.classList.toggle("rb-game-maxed", on);
      updateBtn();
      if (on) canvas.focus({ preventScroll: true });
    };
    fsBtn.addEventListener("click", () => {
      const on = !isMaxed();
      setMaxed(on);
      if (on) {
        const req = fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen;
        if (req) {
          try {
            const result = req.call(fsTarget);
            if (result && result.catch) result.catch(() => {});
          } catch (_) {}
        }
      } else if (nativeFsEl()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) {
          try { exit.call(document); } catch (_) {}
        }
      }
    });
    const onNativeFsChange = () => {
      if (!nativeFsEl() && isMaxed()) setMaxed(false);
    };
    document.addEventListener("fullscreenchange", onNativeFsChange);
    document.addEventListener("webkitfullscreenchange", onNativeFsChange);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isMaxed() && !nativeFsEl()) setMaxed(false);
    });
    updateBtn();
  }

  function idleScene() {
    player.y = H * 0.5;
    player.vy = 0;
    resetTrail();
    candles = [];
    pickups = [];
    particles = [];
    floats = [];
    spawnCandle(W + 140, true);
    spawnCandle(W + 500, false);
    updateHud();
    render();
  }

  loadBest();
  best = Math.max(best, 0);
  bindInput();
  bindFullscreen();
  setSoundLabel();
  idleScene();
  updateHud();
  if (saveSlot) {
    const saved = saveSlot.read();
    if (saved && saved.data && saved.data.lastScore) {
      overlayScore.innerHTML = `Last close: <strong>${format(saved.data.lastScore)}</strong> at <strong>$${Number(saved.data.lastPrice || 0).toFixed(2)}</strong>`;
    }
  }
  lastT = performance.now();
  rafId = requestAnimationFrame(frame);

  window.__FLAPPY_STONKS = {
    start: resetGame,
    flap,
    pause: togglePause,
    event: () => triggerHeadline(true),
    shield: () => { player.shield += 1; updateHud(); },
    dividend: () => collectPickup({ type: "dividend", x: player.x, y: player.y, r: 20 }),
    over: () => gameOver("manually closed"),
    get state() {
      return {
        phase,
        paused,
        score,
        price: Number(price.toFixed(2)),
        y: Math.round(player.y),
        vy: Math.round(player.vy),
        trail: trail.length,
        candles: candles.length,
        nextCandle: candles[0]
          ? {
              x: Math.round(candles[0].x),
              gapY: Math.round(candles[0].gapY),
              gap: Math.round(candles[0].gap),
            }
          : null,
        pickups: pickups.length,
        shield: player.shield,
        market: marketLabel,
      };
    },
  };

  window.addEventListener("beforeunload", () => {
    if (rafId) cancelAnimationFrame(rafId);
  });
})();
