/* ============================================
   ESCAPE THE STRAIT — Looksmaxxing Grindset
   --------------------------------------------
   Parody clicker. Click GRIND. Build stats.
   Evolve from 1/10 sadge to 10/10 gigachad.
   ============================================ */

(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

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
    baseDecay: 0.6,            // stat points lost per second
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
  };

  // ----- Stat metadata -----
  const STAT_META = [
    { key: "gym",      label: "GYM",      icon: "🏋️", color: "#ff5c5c", y: 0 },
    { key: "mewing",   label: "MEWING",   icon: "👅", color: "#ff2e88", y: 1 },
    { key: "jawline",  label: "JAWLINE",  icon: "🦷", color: "#a855f7", y: 2 },
    { key: "skincare", label: "SKINCARE", icon: "🧴", color: "#2ee0ff", y: 3 },
    { key: "sleep",    label: "SLEEP",    icon: "😴", color: "#f7d716", y: 4 },
    { key: "nofap",    label: "NOFAP",    icon: "🚫", color: "#6bff7d", y: 5 },
  ];

  // ----- Tier definitions -----
  const TIERS = [
    { min: 0,  num: 1,  title: "SADGE",         color: "#666" },
    { min: 10, num: 2,  title: "SUBHUMAN",      color: "#888" },
    { min: 20, num: 3,  title: "BELOW AVERAGE", color: "#a8a8b8" },
    { min: 30, num: 4,  title: "NORMIE",        color: "#cdcdcd" },
    { min: 40, num: 5,  title: "ABOVE AVERAGE", color: "#6bff7d" },
    { min: 50, num: 6,  title: "CUTE",          color: "#2ee0ff" },
    { min: 60, num: 7,  title: "CHAD LITE",     color: "#f7d716" },
    { min: 70, num: 8,  title: "CHAD",          color: "#ff8c1a" },
    { min: 80, num: 9,  title: "GIGACHAD",      color: "#ff2e88" },
    { min: 90, num: 10, title: "ULTRA GIGACHAD", color: "#ffd700" },
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
    return Math.round((sum / 600) * 100); // 0..100
  }

  // ----- Event templates -----
  const EVENTS = [
    { icon: "😊", text: "She said you have a nice smile", effect: () => bumpAll(2) },
    { icon: "😴", text: "Your mom said you look tired", effect: () => bumpAll(-2) },
    { icon: "💊", text: "You discovered creatine", effect: () => { state.stats.gym = Math.min(100, state.stats.gym + 5); } },
    { icon: "🤡", text: "You forgot your supplements", effect: () => bumpAll(-3) },
    { icon: "💪", text: "Someone called you gigachad", effect: () => bumpAll(3) },
    { icon: "📱", text: "You stayed up late on TikTok", effect: () => { state.stats.sleep = Math.max(0, state.stats.sleep - 8); } },
    { icon: "🍕", text: "You ate a whole pizza", effect: () => bumpAll(-3) },
    { icon: "💕", text: "You went on a date", effect: () => bumpAll(2) },
    { icon: "📸", text: "Your ex posted a thirst trap", effect: () => { state.stats.jawline = Math.max(0, state.stats.jawline - 4); } },
    { icon: "🎥", text: "You saw a video of a man yelling", effect: () => { state.stats.mewing = Math.min(100, state.stats.mewing + 6); state.stats.jawline = Math.min(100, state.stats.jawline + 3); } },
    { icon: "💇", text: "You tried a new haircut", effect: () => { state.stats.jawline = Math.min(100, state.stats.jawline + 3); state.stats.skincare = Math.min(100, state.stats.skincare + 3); } },
    { icon: "😂", text: "She laughed at your joke", effect: () => bumpAll(1) },
    { icon: "📷", text: "Your friend took a better photo", effect: () => bumpAll(-2) },
    { icon: "🥶", text: "You took a cold shower", effect: () => { state.stats.sleep = Math.min(100, state.stats.sleep + 4); state.stats.gym = Math.min(100, state.stats.gym + 2); } },
    { icon: "🧘", text: "You tried meditating", effect: () => { state.stats.sleep = Math.min(100, state.stats.sleep + 5); state.stats.mewing = Math.min(100, state.stats.mewing + 2); } },
    { icon: "👑", text: "You walked into a room and people noticed", effect: () => bumpAll(4) },
  ];

  function bumpAll(delta) {
    for (const k of Object.keys(state.stats)) {
      state.stats[k] = Math.max(0, Math.min(100, state.stats[k] + delta));
    }
  }

  // ----- Game loop -----
  let rafId = null;
  function loop(now) {
    if (!state.running) return;
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;

    if (!state.paused && !state.gameOver) {
      // Combo decay
      if (now - state.lastClickTime > state.comboWindow * 1000) {
        state.combo = 0;
      }

      // Decay
      if (state.decayImmune > 0) {
        state.decayImmune = Math.max(0, state.decayImmune - dt);
      } else {
        for (const k of Object.keys(state.stats)) {
          state.stats[k] = Math.max(0, state.stats[k] - state.baseDecay * dt);
        }
      }

      // Event cooldown
      state.eventCooldown -= dt;
      if (state.eventCooldown <= 0 && !state.currentEvent) {
        triggerRandomEvent();
      }

      // Effect decay
      if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 3);
      if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 4);

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
      if (getLooksmax() >= 100) {
        endGame(true);
      }
    }

    draw();
    updateHUD();
    rafId = requestAnimationFrame(loop);
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
    ev.effect();
    state.flash = 0.5;
    spawnParticles(W / 2, 200, "#f7d716", 14, 200);
    state.currentEvent = null;
    state.eventCooldown = 8 + Math.random() * 4;
  }

  function grind() {
    if (state.paused || state.gameOver) return;
    const now = performance.now();
    if (now - state.lastClickTime < state.comboWindow * 1000) {
      state.combo = Math.min(99, state.combo + 1);
    } else {
      state.combo = 1;
    }
    state.lastClickTime = now;
    state.clicks += 1;

    // Combo bonus
    const bonus = state.combo > 10 ? 1 : 0;
    const power = state.clickPower + bonus;
    for (const k of Object.keys(state.stats)) {
      state.stats[k] = Math.min(100, state.stats[k] + power);
    }

    // Combo score
    state.score += state.combo;

    // Tier up bonus
    const tier = getTier(getLooksmax());
    if (tier.num > state.maxTier) {
      state.maxTier = tier.num;
      state.score += tier.num * 100;
      state.flash = 0.7;
      state.shake = 0.3;
      spawnParticles(W / 2, 200, tier.color, 30, 280);
      RB.toast(`⬆ TIER UP · ${tier.title} (${tier.num}/10)`, "good");
    } else {
      spawnParticles(W / 2, 220, "#f7d716", 4, 80);
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
    const finalScore = state.score + getLooksmax() * 10;
    RB.recordScore("looksmax", finalScore);
    const high = RB.getHighScore("looksmax");
    const tier = getTier(getLooksmax());
    const title = won
      ? "👑 ULTRA GIGACHAD"
      : `💪 ${tier.title.toUpperCase()}`;
    const sub = won
      ? `You did it. 10/10. The grindset is complete. You may now rest. (Actually no, you can't. There's no end.)`
      : `Click RESTART to grind again.`;
    showOverlay(title, sub, "Grind again", `Final tier: <strong style="color:${tier.color}">${tier.title} ${tier.num}/10</strong> · Score: <strong style="color:var(--accent-3)">${finalScore.toLocaleString()}</strong> · High: <strong>${high.toLocaleString()}</strong>`);
  }

  // ----- Drawing -----
  function draw() {
    const sh = state.shake;
    const sx = (Math.random() - 0.5) * 6 * sh;
    const sy = (Math.random() - 0.5) * 6 * sh;
    ctx.save();
    ctx.translate(sx, sy);

    // Background gradient (gets more colorful with higher tier)
    const tier = getTier(getLooksmax());
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a0a14");
    g.addColorStop(0.5, "#1a1a2e");
    g.addColorStop(1, "#0a0a14");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Decorative top bar
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, W, 36);

    // Tier display
    ctx.fillStyle = tier.color;
    ctx.font = "bold 18px Bungee, Impact, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${tier.num}/10`, 16, 18);
    ctx.font = "bold 12px Bungee, Impact, sans-serif";
    ctx.fillText(tier.title, 60, 18);

    // Score / combo / clicks
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText("🔥 " + state.combo + "x", W - 16, 14);
    ctx.fillText("👆 " + state.clicks, W - 16, 28);

    // Avatar
    const ax = W / 2;
    const ay = 170;
    drawAvatar(ax, ay, tier);

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
      ctx.fillStyle = `rgba(255, 255, 255, ${state.flash * 0.3})`;
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

  function drawAvatar(cx, cy, tier) {
    const looksmax = getLooksmax();
    const t = looksmax / 100; // 0..1
    const tnow = performance.now() / 1000;

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

    // Head circle
    const skinColor = t < 0.3
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
    if (t < 0.3) {
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
  }

  function drawStats() {
    const startY = 290;
    const rowH = 26;
    const labelW = 100;
    const barX = 110;
    const barW = W - 110 - 50;
    const barH = 14;

    for (let i = 0; i < STAT_META.length; i++) {
      const meta = STAT_META[i];
      const y = startY + i * rowH;
      const v = state.stats[meta.key];
      const ratio = v / 100;

      // Label
      ctx.fillStyle = "#a8a8b8";
      ctx.font = "bold 11px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(meta.icon + " " + meta.label, 16, y + barH / 2);

      // Bar background
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      roundRect(ctx, barX, y, barW, barH, 4);
      ctx.fill();

      // Bar fill
      if (ratio > 0) {
        ctx.fillStyle = meta.color;
        roundRect(ctx, barX, y, barW * ratio, barH, 4);
        ctx.fill();
      }

      // Value
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px JetBrains Mono, monospace";
      ctx.textAlign = "right";
      ctx.fillText(Math.floor(v), W - 16, y + barH / 2);
    }
  }

  function drawGrindButton() {
    const bx = 30;
    const by = 460;
    const bw = W - 60;
    const bh = 90;

    // Glow
    ctx.fillStyle = "rgba(255, 46, 136, 0.2)";
    roundRect(ctx, bx - 4, by - 4, bw + 8, bh + 8, 12);
    ctx.fill();

    // Button
    const grad = ctx.createLinearGradient(0, by, 0, by + bh);
    grad.addColorStop(0, "#ff2e88");
    grad.addColorStop(1, "#cc1f6a");
    ctx.fillStyle = grad;
    roundRect(ctx, bx, by, bw, bh, 10);
    ctx.fill();
    ctx.strokeStyle = "#0a0a14";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 32px Bungee, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("💪 GRIND", W / 2, by + bh / 2 - 8);
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("SPACE / CLICK · +1 ALL STATS", W / 2, by + bh / 2 + 16);

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
    const px = 20;
    const py = 560;
    const pw = W - 40;
    const ph = 64;

    ctx.fillStyle = "rgba(20, 20, 30, 0.96)";
    roundRect(ctx, px, py, pw, ph, 8);
    ctx.fill();
    ctx.strokeStyle = "#f7d716";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = "32px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(ev.icon, px + 14, py + ph / 2);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(ev.text, px + 60, py + ph / 2 - 6);

    ctx.fillStyle = "#a8a8b8";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillText("[CLICK or SPACE] continue", px + 60, py + ph / 2 + 12);
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

  // ----- HUD -----
  function updateHUD() {
    const looksmax = getLooksmax();
    const tier = getTier(looksmax);
    document.getElementById("hud-tier").textContent = tier.num + "/10";
    document.getElementById("hud-tier").style.color = tier.color;
    document.getElementById("hud-combo").textContent = state.combo + "x";
    document.getElementById("hud-clicks").textContent = state.clicks;
    document.getElementById("hud-high").textContent = RB.getHighScore("looksmax").toLocaleString();
  }

  // ----- Powerups -----
  function renderPowerups() {
    const slot = document.getElementById("powerups");
    const s = RB.state;
    const items = [
      { key: "shield", icon: "📚", label: "Mewing Masterclass", desc: "2x click power for 30s" },
      { key: "boost",  icon: "🧠", label: "Looksmaxx Guru",     desc: "+10 to all stats" },
      { key: "nuke",   icon: "🛡", label: "Cope Harder",         desc: "30s immunity to decay" },
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
      RB.toast("📚 Mewing Masterclass active — 2x click power for 30s", "good");
      setTimeout(() => { state.clickPower = 1; }, 30000);
    } else if (key === "boost") {
      bumpAll(10);
      state.flash = 0.5;
      state.shake = 0.4;
      spawnParticles(W / 2, 200, "#f7d716", 40, 320);
      RB.toast("🧠 Looksmaxx Guru: +10 to ALL stats", "good");
    } else if (key === "nuke") {
      state.decayImmune = 30;
      spawnParticles(W / 2, H / 2, "#2ee0ff", 30, 280);
      RB.toast("🛡 Cope activated — stats frozen for 30s", "good");
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

    // GRIND button
    if (x >= 30 && x <= W - 30 && y >= 460 && y <= 550) {
      grind();
      return;
    }
    // Event popup
    if (state.currentEvent) {
      dismissEvent();
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
    state.started = true;
    state.won = false;
    state.clicks = 0;
    state.combo = 0;
    state.score = 0;
    state.maxTier = 0;
    state.stats = { gym: 0, mewing: 0, jawline: 0, skincare: 0, sleep: 0, nofap: 0 };
    state.clickPower = 1;
    state.decayImmune = 0;
    state.currentEvent = null;
    state.eventCooldown = 5;
    state.auraSize = 0;
    state.particles = [];
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
    showOverlay("💪 LOOKSMAXXING GRINDSET", "Restart the grind?", "Start the grind");
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
