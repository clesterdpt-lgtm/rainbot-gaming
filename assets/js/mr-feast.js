/* ============================================
   ESCAPE THE STRAIT — Mr. Feast: Last To Leave the Mansion
   --------------------------------------------
   Survival game. Survive 24 hours. Win $1M.
   Resist temptation. Watch an ad for willpower.
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
    hour: 0,
    money: 0,
    temptation: 0,           // 0..100, hits 100 = you cave
    willpower: 100,          // 0..100, drains slowly
    contestants: 10,         // player + 9 bots
    bots: [],                // { x, y, color, resolve, temptation, sleeping }
    currentEvent: null,      // { title, desc, temptationOnTake, temptationOnResist, moneyOnTake, moneyOnResist }
    eventCooldown: 0,        // seconds until next event
    lastEventHour: -1,       // hour of last event
    lastTime: 0,
    hourAccumulator: 0,      // seconds since last hour tick
    secondsPerHour: 5,       // 5s per hour = 24h = 2 min total
    shaking: 0,
    flash: 0,
    particles: [],
  };

  // ----- Event templates -----
  const EVENTS = [
    {
      icon: "🍕",
      title: "Hot pizza arrives",
      desc: "A golden-brown pizza lands on the coffee table. Smells incredible.",
      temptation: 22,
      money: 0,
      resist: "Temptation +0 · Willpower +5",
      take: "Eat the pizza · Temptation +22",
    },
    {
      icon: "💵",
      title: "Mr. Feast appears with $100 bills",
      desc: "He throws a stack of hundreds in the air. 'Take it and walk out. No shame.'",
      temptation: 28,
      money: 500,
      resist: "Temptation +0 · Willpower +8",
      take: "Grab the cash · +$500 · Temptation +28",
    },
    {
      icon: "😭",
      title: "A contestant starts crying",
      desc: "Contestant #3 misses their family. Shoulders shaking.",
      temptation: 8,
      money: 0,
      resist: "Temptation +8 · Willpower +3",
      take: "Comfort them · Temptation +0 · Willpower +10",
    },
    {
      icon: "💩",
      title: "Something smells terrible",
      desc: "A contestant is regretting last night's ghost pepper challenge.",
      temptation: 15,
      money: 0,
      resist: "Temptation +15 · Willpower +5",
      take: "Leave the room · Temptation +5 · Willpower -10",
    },
    {
      icon: "🥩",
      title: "Free steak dinner",
      desc: "Mr. Feast wheels in a 64oz tomahawk. Sizzling. Butter on top.",
      temptation: 30,
      money: 0,
      resist: "Temptation +30 · Willpower +10",
      take: "Eat the steak · Temptation +35 (but yum)",
    },
    {
      icon: "👶",
      title: "A contestant's baby arrives",
      desc: "Crying baby. Won't stop. It's been six hours.",
      temptation: 12,
      money: 0,
      resist: "Endure · Temptation +12 · Willpower +2",
      take: "Help babysit · Temptation +0 · Willpower -8",
    },
    {
      icon: "😴",
      title: "A contestant falls asleep",
      desc: "Contestant #6 is snoring. They'll be removed by morning.",
      temptation: 0,
      money: 0,
      resist: "Do nothing · They're out. You survive longer.",
      take: "—",
      oneSided: true,
    },
    {
      icon: "🏃",
      title: "A contestant stands up",
      desc: "Contestant #9 has had enough. They're walking toward the door.",
      temptation: 5,
      money: 0,
      resist: "Watch them leave. +5 temptation from FOMO.",
      take: "Join them · Temptation +0 · Game over",
      oneSided: true,
    },
    {
      icon: "🚽",
      title: "You need the bathroom",
      desc: "Hour 14. Coffee was a mistake. A HUGE mistake.",
      temptation: 18,
      money: 0,
      resist: "Hold it · Temptation +18 · Willpower +4",
      take: "Bathroom break · Temptation +0 · Lose 30s",
    },
    {
      icon: "💰",
      title: "Mr. Feast offers $10,000 to leave",
      desc: "That's a free $10K. Just walk out. Just this once.",
      temptation: 35,
      money: 10000,
      resist: "Temptation +35 · Willpower +12",
      take: "Take the $10K · Temptation +35 · Game over",
    },
    {
      icon: "📱",
      title: "Your phone buzzes",
      desc: "Twitter notification: 'just setting up my twttr' — no wait, that was 2006. It's actually a crypto ad.",
      temptation: 6,
      money: 0,
      resist: "Ignore it · Temptation +6",
      take: "Check it · Temptation +10 · Lose 20s",
    },
    {
      icon: "🎤",
      title: "Mr. Feast starts an interview",
      desc: "He puts a mic in your face. 'WHY are you still here? Tell the viewers.'",
      temptation: 10,
      money: 0,
      resist: "Stay strong · Temptation +10",
      take: "Quote-unquote villain arc · Temptation +25",
    },
    {
      icon: "🎂",
      title: "It's someone's birthday",
      desc: "Cake appears. Singing. They want you to celebrate.",
      temptation: 14,
      money: 0,
      resist: "Don't engage · Temptation +14",
      take: "Sing happy birthday · Temptation +5 · Willpower -3",
    },
  ];

  // ----- Bot contestants -----
  function buildBots() {
    const positions = [];
    // Arrange 9 bots in a U-shape facing center
    const cx = W / 2;
    const cy = 220;
    const radius = 160;
    const startAngle = -Math.PI * 0.75;
    const endAngle = -Math.PI * 0.25;
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const a = startAngle + t * (endAngle - startAngle);
      positions.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, angle: a + Math.PI / 2 });
    }
    return positions.map((p, i) => ({
      x: p.x, y: p.y, angle: p.angle,
      color: ["#ff5c5c", "#f7d716", "#6bff7d", "#2ee0ff", "#ff8c1a", "#a855f7", "#ff2e88", "#7af716", "#3aaaff"][i],
      resolve: 30 + Math.random() * 50,  // 30..80
      temptation: 0,
      gone: false,
      sleeping: false,
      hasBaby: false,
      id: i + 1,
    }));
  }

  // ----- Game loop -----
  let rafId = null;
  function loop(now) {
    if (!state.running) return;
    if (!state.lastTime) state.lastTime = now;
    const dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;

    if (!state.paused && !state.gameOver) {
      // Hour progress
      state.hourAccumulator += dt;
      if (state.hourAccumulator >= state.secondsPerHour) {
        state.hourAccumulator -= state.secondsPerHour;
        advanceHour();
      }

      // Willpower drain
      state.willpower = Math.max(0, state.willpower - dt * 1.2);

      // Bot temptation
      for (const b of state.bots) {
        if (b.gone) continue;
        // Bot temptation grows over time, faster for low-resolve bots
        b.temptation += dt * (2.5 - b.resolve / 50);
        if (b.temptation >= b.resolve) {
          b.gone = true;
          state.contestants -= 1;
          spawnParticles(b.x, b.y, b.color, 14, 200);
          state.cameraShake = 0.4;
          flash(0.3);
          if (state.contestants <= 1) {
            // Player wins by default
            endGame(true);
          } else {
            RB.toast(`Contestant #${b.id} left the mansion!`, "good");
          }
        }
      }

      // Event cooldown
      if (state.currentEvent) {
        state.eventCooldown -= dt;
        if (state.eventCooldown <= 0) {
          // Event times out — resolve as "resist" by default (no temptation penalty)
          dismissEvent("resist");
        }
      } else {
        state.eventCooldown -= dt;
        if (state.eventCooldown <= 0 && state.hour > 0) {
          triggerRandomEvent();
        }
      }

      // Particles
      for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.age += dt;
        if (p.age >= p.life) { state.particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 180 * dt;
      }

      // Effects decay
      if (state.cameraShake > 0) state.cameraShake = Math.max(0, state.cameraShake - dt * 4);
      if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 3);
    }

    draw();
    rafId = requestAnimationFrame(loop);
  }

  function advanceHour() {
    state.hour += 1;
    state.money += 40000 + Math.floor(Math.random() * 5000);
    state.temptation = Math.min(100, state.temptation + 4 + Math.random() * 3);
    updateHUD();
    if (state.temptation >= 100) {
      endGame(false, "💀 Temptation maxed out — you caved and left the mansion.");
    } else if (state.hour >= 24) {
      endGame(true);
    }
  }

  function triggerRandomEvent() {
    if (state.currentEvent) return;
    // Skip events in the first 30 seconds
    if (state.hour < 1) {
      state.eventCooldown = 1;
      return;
    }
    // Avoid same event twice in a row
    let ev;
    do {
      ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    } while (state.lastEvent && ev.title === state.lastEvent.title);
    state.currentEvent = ev;
    state.lastEvent = ev;
    state.eventCooldown = 8; // player has 8s to choose
    updateHUD();
  }

  function dismissEvent(choice) {
    if (!state.currentEvent) return;
    const ev = state.currentEvent;
    if (choice === "resist") {
      state.temptation = Math.min(100, state.temptation + ev.temptation);
      state.willpower = Math.min(100, state.willpower + (ev.temptation > 15 ? 8 : 4));
      state.money += ev.moneyOnResist || 0;
      RB.toast("💪 Resisted · " + ev.resist, "good");
    } else if (choice === "take") {
      state.temptation = Math.min(100, state.temptation + ev.temptation);
      state.money += ev.moneyOnTake || 0;
      state.willpower = Math.max(0, state.willpower - 5);
      RB.toast("😈 Took it · " + ev.take, "bad");
      // Spawn particles
      spawnParticles(W / 2, H - 80, "#ff2e88", 18, 220);
    }
    state.currentEvent = null;
    state.eventCooldown = 4 + Math.random() * 3;
    updateHUD();
  }

  function endGame(won, reason) {
    state.gameOver = true;
    state.running = false;
    state.won = won;
    RB.recordScore("mrfeast", state.money);
    const high = RB.getHighScore("mrfeast");
    const title = won
      ? state.hour >= 24
        ? "🏆 YOU WIN $1,000,000"
        : "🏆 LAST ONE STANDING"
      : "💀 YOU CAVED";
    const sub = won
      ? `Survived ${state.hour} hours · Walked away with $${state.money.toLocaleString()}`
      : (reason || "Temptation was too much.");
    showOverlay(title, sub, "Play again", `Best run: <strong style="color:var(--accent-3)">$${high.toLocaleString()}</strong>`);
  }

  function spawnParticles(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.5 + Math.random() * 0.7);
      state.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 60,
        life: 0.6 + Math.random() * 0.4,
        age: 0,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function flash(intensity) {
    state.flash = Math.max(state.flash, intensity);
  }

  // ----- Drawing -----
  function draw() {
    const shake = state.cameraShake;
    const sx = (Math.random() - 0.5) * 8 * shake;
    const sy = (Math.random() - 0.5) * 8 * shake;
    ctx.save();
    ctx.translate(sx, sy);

    // Background — living room rug
    const g = ctx.createRadialGradient(W / 2, 240, 100, W / 2, 240, 400);
    g.addColorStop(0, "#3a2a1a");
    g.addColorStop(1, "#1a1208");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Floor planks
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let y = 0; y < H; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Coffee table in center
    drawTable(W / 2, 240);

    // Mr. Feast in the center (big yellow face)
    drawMrFeast(W / 2, 240);

    // Draw 9 bots in U-shape
    for (const b of state.bots) {
      if (b.gone) continue;
      drawContestant(b);
    }

    // Temptation bar at top
    drawTemptationBar();

    // Willpower bar
    drawWillpowerBar();

    // Event card overlay
    if (state.currentEvent) {
      drawEventCard();
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

    // Time-of-day tint
    const tod = state.hour / 24;
    if (tod > 0.5) {
      // darker at night
      ctx.fillStyle = `rgba(0, 0, 30, ${(tod - 0.5) * 0.4})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Pause overlay
    if (state.paused) {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 42px Bungee, Impact, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("⏸ PAUSED", W / 2, H / 2);
    }

    ctx.restore();
  }

  function drawTable(cx, cy) {
    // Round coffee table
    ctx.fillStyle = "#2a1a0a";
    ctx.beginPath();
    ctx.ellipse(cx, cy, 50, 25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#5a3a1a";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Highlight
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.ellipse(cx, cy - 3, 40, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMrFeast(cx, cy) {
    const t = performance.now() / 1000;
    const bob = Math.sin(t * 2) * 2;

    // Big yellow circle head
    ctx.fillStyle = "#f7d716";
    ctx.beginPath();
    ctx.arc(cx, cy - 20 + bob, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#a88a0a";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Sunglasses
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(cx - 22, cy - 28 + bob, 18, 10);
    ctx.fillRect(cx + 4, cy - 28 + bob, 18, 10);
    ctx.fillRect(cx - 4, cy - 25 + bob, 8, 4);
    // Shades reflection
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(cx - 20, cy - 26 + bob, 6, 2);
    ctx.fillRect(cx + 6, cy - 26 + bob, 6, 2);

    // Big smile
    ctx.fillStyle = "#0a0a14";
    ctx.beginPath();
    ctx.arc(cx, cy - 8 + bob, 12, 0, Math.PI, false);
    ctx.fill();

    // Money bag emoji next to him
    ctx.font = "bold 30px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("💰", cx + 45, cy - 30 + bob);
  }

  function drawContestant(b) {
    // Chair
    ctx.fillStyle = "#3a3a3a";
    roundRect(ctx, b.x - 18, b.y - 8, 36, 36, 6);
    ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Chair back
    ctx.fillStyle = "#2a2a2a";
    roundRect(ctx, b.x - 18, b.y - 22, 36, 16, 4);
    ctx.fill();
    ctx.stroke();

    // Body
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y + 8, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#0a0a14";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Head
    ctx.fillStyle = "#f5d4a0";
    ctx.beginPath();
    ctx.arc(b.x, b.y - 4, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Face direction (toward Mr. Feast)
    const angle = Math.atan2(240 - b.y, W / 2 - b.x);
    const eyeX = Math.cos(angle) * 4;
    const eyeY = Math.sin(angle) * 2 - 6;
    ctx.fillStyle = "#0a0a14";
    ctx.beginPath();
    ctx.arc(b.x + eyeX - 3, b.y - 4 + eyeY, 1.5, 0, Math.PI * 2);
    ctx.arc(b.x + eyeX + 3, b.y - 4 + eyeY, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // ID number
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillRect(b.x - 9, b.y - 22, 18, 11);
    ctx.fillStyle = "#0a0a14";
    ctx.fillText("#" + b.id, b.x, b.y - 17);

    // Temptation ring around bot
    if (b.temptation > 5) {
      const ratio = b.temptation / b.resolve;
      ctx.strokeStyle = `rgba(255, 92, 92, ${0.4 + ratio * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 22, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Sleeping indicator
    if (b.sleeping) {
      ctx.font = "bold 16px sans-serif";
      ctx.fillText("💤", b.x + 16, b.y - 14);
    }
  }

  function drawTemptationBar() {
    const barX = 16;
    const barY = 16;
    const barW = W - 32;
    const barH = 14;
    const ratio = state.temptation / 100;

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    roundRect(ctx, barX, barY, barW, barH, 7);
    ctx.fill();

    // Fill (yellow → red)
    const hue = 50 - ratio * 50;
    ctx.fillStyle = `hsl(${hue}, 90%, 55%)`;
    if (ratio > 0) {
      roundRect(ctx, barX, barY, barW * ratio, barH, 7);
      ctx.fill();
    }

    // Label
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("🍔 TEMPTATION " + Math.floor(state.temptation) + "%", barX + 8, barY + barH / 2);
    ctx.textAlign = "right";
    ctx.fillText("HOUR " + state.hour + " / 24", barX + barW - 8, barY + barH / 2);
  }

  function drawWillpowerBar() {
    const barX = 16;
    const barY = 36;
    const barW = W - 32;
    const barH = 8;
    const ratio = state.willpower / 100;

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    roundRect(ctx, barX, barY, barW, barH, 4);
    ctx.fill();
    ctx.fillStyle = "#2ee0ff";
    if (ratio > 0) {
      roundRect(ctx, barX, barY, barW * ratio, barH, 4);
      ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.font = "9px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("💪 WILLPOWER " + Math.floor(state.willpower) + "%", barX + 6, barY + barH / 2);
    ctx.textAlign = "right";
    ctx.fillText("💰 $" + (state.money / 1000).toFixed(0) + "K", barX + barW - 6, barY + barH / 2);
  }

  function drawEventCard() {
    const ev = state.currentEvent;
    const cardX = W / 2 - 220;
    const cardY = H - 140;
    const cardW = 440;
    const cardH = 120;

    // Card background
    ctx.fillStyle = "rgba(20, 20, 30, 0.96)";
    roundRect(ctx, cardX, cardY, cardW, cardH, 12);
    ctx.fill();
    ctx.strokeStyle = "#ff2e88";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Icon
    ctx.font = "48px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(ev.icon, cardX + 16, cardY + 12);

    // Title
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px Bungee, Impact, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(ev.title.toUpperCase(), cardX + 80, cardY + 16);

    // Description
    ctx.fillStyle = "#a8a8b8";
    ctx.font = "12px Inter, sans-serif";
    ctx.fillText(ev.desc, cardX + 80, cardY + 42, cardW - 100);

    // Buttons
    const btnY = cardY + cardH - 32;
    const resistX = cardX + 80;
    const takeX = cardX + 250;

    // RESIST button
    if (ev.oneSided) {
      ctx.fillStyle = "#2ee0ff";
      roundRect(ctx, resistX, btnY, 200, 24, 4);
      ctx.fill();
      ctx.fillStyle = "#0a0a14";
      ctx.font = "bold 11px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("OK", resistX + 100, btnY + 12);
    } else {
      ctx.fillStyle = "#2ee0ff";
      roundRect(ctx, resistX, btnY, 160, 24, 4);
      ctx.fill();
      ctx.fillStyle = "#0a0a14";
      ctx.font = "bold 11px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("RESIST (R)", resistX + 80, btnY + 12);

      ctx.fillStyle = "#ff5c5c";
      roundRect(ctx, takeX, btnY, 160, 24, 4);
      ctx.fill();
      ctx.fillStyle = "#0a0a14";
      ctx.fillText("TAKE IT (T)", takeX + 80, btnY + 12);
    }

    // Timer ring
    const ratio = state.eventCooldown / 8;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + ratio * 0.5})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cardX + cardW - 24, cardY + 24, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText(Math.ceil(state.eventCooldown), cardX + cardW - 24, cardY + 27);
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
    document.getElementById("hud-hour").textContent = state.hour;
    document.getElementById("hud-money").textContent = "$" + (state.money / 1000).toFixed(0) + "K";
    document.getElementById("hud-count").textContent = state.contestants;
    document.getElementById("hud-high").textContent = "$" + (RB.getHighScore("mrfeast") / 1000).toFixed(0) + "K";
  }

  // ----- Powerups -----
  function renderPowerups() {
    const slot = document.getElementById("powerups");
    const s = RB.state;
    const items = [
      { key: "shield", icon: "🛡", label: "Willpower Boost", desc: "Reset temptation to 0" },
      { key: "boost",  icon: "⏸", label: "Bathroom Break",   desc: "Freeze temptation for 30s" },
      { key: "nuke",   icon: "💰", label: "Mega Tip",         desc: "+$50,000 instantly" },
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
      state.temptation = 0;
      spawnParticles(W / 2, 30, "#2ee0ff", 20, 240);
      RB.toast("💪 Willpower restored · Temptation reset", "good");
    } else if (key === "boost") {
      state.secondsPerHour = 8; // slower hour progression for 30s
      RB.toast("⏸ Bathroom break — slow-mo for 30s", "good");
      setTimeout(() => { state.secondsPerHour = 5; }, 30000);
    } else if (key === "nuke") {
      state.money += 50000;
      spawnParticles(W / 2, 240, "#f7d716", 30, 280);
      RB.toast("💰 +$50,000 from a generous viewer", "good");
    }
    updateHUD();
  }

  // ----- Input -----
  document.addEventListener("keydown", (e) => {
    if (e.key === "r" || e.key === "R") {
      if (state.currentEvent && !state.currentEvent.oneSided) dismissEvent("resist");
    } else if (e.key === "t" || e.key === "T") {
      if (state.currentEvent && !state.currentEvent.oneSided) dismissEvent("take");
    } else if (e.key === " " || e.key === "Enter") {
      if (state.currentEvent) dismissEvent(state.currentEvent.oneSided ? "resist" : "resist");
    }
  });

  // Click on event buttons
  function handleCanvasAction(e) {
    if (!state.currentEvent) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const cardX = W / 2 - 220;
    const cardY = H - 140;
    const btnY = cardY + 120 - 32;
    if (state.currentEvent.oneSided) {
      // OK button
      if (x >= cardX + 80 && x <= cardX + 280 && y >= btnY && y <= btnY + 24) {
        dismissEvent("resist");
      }
    } else {
      // RESIST button
      if (x >= cardX + 80 && x <= cardX + 240 && y >= btnY && y <= btnY + 24) {
        dismissEvent("resist");
      }
      // TAKE button
      else if (x >= cardX + 250 && x <= cardX + 410 && y >= btnY && y <= btnY + 24) {
        dismissEvent("take");
      }
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
    if (state.gameOver) {
      scoreEl.style.display = "block";
      scoreEl.innerHTML = (extra || "") + (extra ? "<br>" : "") + `Final: <strong style="color:var(--accent-3)">$${state.money.toLocaleString()}</strong>`;
    } else {
      scoreEl.style.display = "none";
    }
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
    state.hour = 0;
    state.money = 0;
    state.temptation = 0;
    state.willpower = 100;
    state.contestants = 10;
    state.hourAccumulator = 0;
    state.secondsPerHour = 5;
    state.currentEvent = null;
    state.eventCooldown = 4;
    state.lastEvent = null;
    state.bots = buildBots();
    state.particles = [];
    state.cameraShake = 0;
    state.flash = 0;
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
    showOverlay("🍔 MR. FEAST", "Restart the mansion challenge?", "Enter the mansion");
  });
  const resistButton = document.getElementById("btn-resist");
  const takeButton = document.getElementById("btn-take");
  if (resistButton) {
    resistButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (state.currentEvent) dismissEvent("resist");
    });
  }
  if (takeButton) {
    takeButton.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      if (state.currentEvent && !state.currentEvent.oneSided) dismissEvent("take");
    });
  }

  RB.subscribe(renderPowerups);
  updateHUD();
  renderPowerups();
  draw();
})();
